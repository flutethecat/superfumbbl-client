/**
 * Controller support P2a (owner 10-07, spec-controller-support.md "Rail crosshair" + owner rounds 2-8): the pitch
 * crosshair's state. Controller mode only (`activeInput === 'controller'`).
 *
 *  - `target`: the square the crosshair sits on (or, in setup, a reserve's dugout token), null before the first reset.
 *  - Left stick: one square per step in 8 directions (from the stick angle), mapped through the LIVE projection so
 *    "stick right" moves the crosshair right on screen in either pitch orientation; first step at once on a tilt, then
 *    FLAT linear stepping every 1000 / crosshairSpeed ms (owner o66mh; Settings > Controls, 3-15 squares/s, default
 *    8). Optional acceleration (Settings "Crosshair acceleration", default off): from the slider speed up to 2x over
 *    1 s of travel in one direction, reset on release / direction change. Clamped to the pitch.
 *  - Precision (owner round 7: an L3 TOGGLE): halves the speed (both modes). Off when controller mode ends.
 *  - D-pad left / right (cyclePlayerPrev / Next): jump to my previous / next player who can still act, wrapping (the
 *    host supplies the ordered list; in setup: reserves, then placed players).
 *  - `crosshairSuppressed`: a card / menu owns focus — the crosshair hides and the stick / A / X are inert (P2b sets it
 *    for server cards).
 *
 * Pure state + logic (Vue refs only); SpectateView wires it to the renderer (rail + hover) and the action runner.
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { activeInput, type ActiveInput } from './controls';

export type CrosshairSquare = [number, number];
export type CrosshairTarget = { square: CrosshairSquare } | { dugoutPlayerId: string };

export const CROSSHAIR_COLS = 26;
export const CROSSHAIR_ROWS = 15;
/** The stick counts as pointing once its deadzoned magnitude passes this (as the Phase 1 stick directions). */
export const CROSSHAIR_STICK_THRESHOLD = 0.5;
/** Owner o66mh: crosshair speed in squares per second (Settings > Controls slider). */
export const CROSSHAIR_SPEED_DEFAULT = 8;
export const CROSSHAIR_SPEED_MIN = 3;
export const CROSSHAIR_SPEED_MAX = 15;
/** Acceleration (optional): the speed reaches CROSSHAIR_ACCEL_MAX x the slider speed after CROSSHAIR_ACCEL_MS. */
export const CROSSHAIR_ACCEL_MAX = 2;
export const CROSSHAIR_ACCEL_MS = 1000;
export function clampCrosshairSpeed(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : CROSSHAIR_SPEED_DEFAULT;
  return Math.min(CROSSHAIR_SPEED_MAX, Math.max(CROSSHAIR_SPEED_MIN, n));
}
/** The step interval (ms) `elapsed` ms into a tilt. */
export function crosshairStepInterval(speed: number, opts: { precision?: boolean; acceleration?: boolean; elapsed?: number } = {}): number {
  let squaresPerSecond = clampCrosshairSpeed(speed);
  if (opts.acceleration) squaresPerSecond *= 1 + (CROSSHAIR_ACCEL_MAX - 1) * Math.min(1, Math.max(0, (opts.elapsed ?? 0) / CROSSHAIR_ACCEL_MS));
  if (opts.precision) squaresPerSecond /= 2;
  return 1000 / squaresPerSecond;
}

/** A card / menu owns focus: the crosshair hides (P2b's server cards set this). */
export const crosshairSuppressed = ref(false);

export interface ScreenPoint { x: number; y: number }

/** Screen steps by octant (0 = right, clockwise with y down); also the 8 game-square neighbours. */
const OCTANT_STEPS: readonly CrosshairSquare[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const NEIGHBOURS = OCTANT_STEPS;

/** One of 8 screen directions (y down) from a stick reading, or null under the threshold. */
export function stickOctant(x: number, y: number, threshold = CROSSHAIR_STICK_THRESHOLD): { dx: number; dy: number; key: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < threshold) return null;
  const key = ((Math.round(Math.atan2(y, x) / (Math.PI / 4)) % 8) + 8) % 8; // 0 = right, 2 = down, 4 = left, 6 = up
  const [dx, dy] = OCTANT_STEPS[key]!;
  return { dx, dy, key };
}


/** The game-square step whose on-screen direction best matches a screen direction, through the live projection. */
export function screenDirectionToStep(from: CrosshairSquare, dir: { dx: number; dy: number }, screenOf: (sq: CrosshairSquare) => ScreenPoint): CrosshairSquare {
  const origin = screenOf(from);
  const len = Math.hypot(dir.dx, dir.dy) || 1;
  let best: CrosshairSquare = [0, 0];
  let bestScore = -Infinity;
  for (const [gx, gy] of NEIGHBOURS) {
    const p = screenOf([from[0] + gx, from[1] + gy]);
    const vx = p.x - origin.x;
    const vy = p.y - origin.y;
    const vlen = Math.hypot(vx, vy);
    if (!vlen) continue;
    const score = (vx * dir.dx + vy * dir.dy) / (vlen * len);
    if (score > bestScore + 1e-9) { bestScore = score; best = [gx, gy]; }
  }
  return best;
}

export function clampSquare(sq: CrosshairSquare, cols = CROSSHAIR_COLS, rows = CROSSHAIR_ROWS): CrosshairSquare {
  return [Math.min(cols - 1, Math.max(0, Math.round(sq[0]))), Math.min(rows - 1, Math.max(0, Math.round(sq[1])))];
}

export function sameCrosshairTarget(a: CrosshairTarget | null, b: CrosshairTarget | null): boolean {
  if (!a || !b) return a === b;
  if ('square' in a && 'square' in b) return a.square[0] === b.square[0] && a.square[1] === b.square[1];
  if ('dugoutPlayerId' in a && 'dugoutPlayerId' in b) return a.dugoutPlayerId === b.dugoutPlayerId;
  return false;
}

/** Start square (owner round 4): the acting player, else the ball, else the pitch centre. */
export function crosshairStart(acting: CrosshairSquare | null | undefined, ball: CrosshairSquare | null | undefined, cols = CROSSHAIR_COLS, rows = CROSSHAIR_ROWS): CrosshairSquare {
  const onPitch = (sq: CrosshairSquare | null | undefined): sq is CrosshairSquare => !!sq && sq[0] >= 0 && sq[0] < cols && sq[1] >= 0 && sq[1] < rows;
  if (onPitch(acting)) return [acting[0], acting[1]];
  if (onPitch(ball)) return [ball[0], ball[1]];
  return [Math.floor(cols / 2), Math.floor(rows / 2)];
}

export interface CrosshairDeps {
  /** Canvas pixel of a square (the renderer's live projection); defaults to a flat N-S-like layout. */
  screenOf?(sq: CrosshairSquare): ScreenPoint;
  /** The pitch square nearest a dugout token (a stick move from a reserve starts there). */
  dugoutSquare?(playerId: string): CrosshairSquare | null;
  now?(): number;
  cols?: number;
  rows?: number;
  /** The active input read for visibility (defaults to the app's activeInput). */
  state?: { value: ActiveInput };
  suppressed?: Ref<boolean>;
  /** Settings crosshairSpeed (squares / s) and crosshairAcceleration, read live. */
  speed?(): number;
  acceleration?(): boolean;
  /** P2b (owner round 3): while a server player pick is armed the stick JUMPS between the eligible players' squares
   *  (camera locked to them) instead of stepping square by square. Empty / absent = free movement. */
  snapTargets?(): readonly CrosshairSquare[];
}

/** The eligible square a screen direction jumps to: the nearest one inside a ±67.5° cone of the direction (sideways
 *  drift weighs double), through the live projection. Null when nothing lies that way. */
export function snapStep(from: CrosshairSquare, dir: { dx: number; dy: number }, targets: readonly CrosshairSquare[], screenOf: (sq: CrosshairSquare) => ScreenPoint): CrosshairSquare | null {
  const o = screenOf(from);
  const len = Math.hypot(dir.dx, dir.dy) || 1;
  const ux = dir.dx / len;
  const uy = dir.dy / len;
  let best: CrosshairSquare | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
    if (t[0] === from[0] && t[1] === from[1]) continue;
    const p = screenOf(t);
    const vx = p.x - o.x;
    const vy = p.y - o.y;
    const along = vx * ux + vy * uy;
    const side = Math.abs(vx * uy - vy * ux);
    if (along <= 1e-9 || side > along * Math.tan((67.5 * Math.PI) / 180)) continue;
    const score = along + side * 2;
    if (score < bestScore) { bestScore = score; best = [t[0], t[1]]; }
  }
  return best;
}

export interface Crosshair {
  readonly target: Ref<CrosshairTarget | null>;
  readonly precision: Ref<boolean>;
  readonly suppressed: Ref<boolean>;
  /** Controller mode, not suppressed, and placed. */
  readonly visible: ComputedRef<boolean>;
  /** How the target last moved: a stick 'step', or a 'jump' (reset / D-pad cycle / moveTo) — the camera follow uses it. */
  readonly lastMove: 'step' | 'jump';
  /** Owner 10-08: true when the last move came from the pad (stick / D-pad step / cycle / an explicit moveTo), false
   *  after a reset (mount, controller-mode entry, turn / setup reseat). The camera follow releases a running cinematic
   *  only for a user move. */
  readonly lastMoveByUser: boolean;
  reset(target: CrosshairTarget | null): void;
  moveTo(target: CrosshairTarget | null): boolean;
  /** One step in a screen direction (dx, dy ∈ {-1, 0, 1}). True when the target moved. */
  step(dir: { dx: number; dy: number }): boolean;
  /** A (deadzoned) left-stick reading; handles fresh tilts and the repeat. True when the target moved. */
  stick(x: number, y: number): boolean;
  /** Jump to the previous / next entry of `order`, wrapping. True when there was somewhere to go. */
  cycle(direction: 1 | -1, order: readonly CrosshairTarget[]): boolean;
  togglePrecision(): boolean;
}

export function createCrosshair(deps: CrosshairDeps = {}): Crosshair {
  const cols = deps.cols ?? CROSSHAIR_COLS;
  const rows = deps.rows ?? CROSSHAIR_ROWS;
  const screenOf = deps.screenOf ?? ((sq: CrosshairSquare) => ({ x: sq[1], y: -sq[0] }));
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const state = deps.state ?? activeInput;
  const target = ref<CrosshairTarget | null>(null);
  const precision = ref(false);
  const suppressed = deps.suppressed ?? crosshairSuppressed;
  const visible = computed(() => state.value === 'controller' && !suppressed.value && target.value !== null);
  let repeat: { key: number | null; nextAt: number; start: number } = { key: null, nextAt: 0, start: 0 };
  let lastMove: 'step' | 'jump' = 'jump';
  let lastMoveByUser = false;
  const speed = deps.speed ?? (() => CROSSHAIR_SPEED_DEFAULT);
  const acceleration = deps.acceleration ?? (() => false);
  const interval = (t: number): number => crosshairStepInterval(speed(), { precision: precision.value, acceleration: acceleration(), elapsed: t - repeat.start });
  /** The last cycled entry, so a cycle from a square that is not in the list keeps its place. */
  let cycleIndex = -1;

  const moveTo = (next: CrosshairTarget | null): boolean => {
    const clamped: CrosshairTarget | null = next && 'square' in next ? { square: clampSquare(next.square, cols, rows) } : next;
    if (sameCrosshairTarget(target.value, clamped)) return false;
    target.value = clamped;
    return true;
  };
  const currentSquare = (): CrosshairSquare => {
    const t = target.value;
    if (t && 'square' in t) return t.square;
    if (t && 'dugoutPlayerId' in t) {
      const sq = deps.dugoutSquare?.(t.dugoutPlayerId);
      if (sq) return clampSquare(sq, cols, rows);
    }
    return [Math.floor(cols / 2), Math.floor(rows / 2)];
  };
  const nearest = (from: CrosshairSquare, list: readonly CrosshairSquare[]): CrosshairSquare | null => {
    let best: CrosshairSquare | null = null;
    let d = Infinity;
    for (const t of list) {
      const dd = Math.hypot(t[0] - from[0], t[1] - from[1]);
      if (dd < d) { d = dd; best = t; }
    }
    return best;
  };
  const step = (dir: { dx: number; dy: number }): boolean => {
    if (!dir.dx && !dir.dy) return false;
    const from = currentSquare();
    const fromDugout = !!target.value && 'dugoutPlayerId' in target.value;
    const snaps = deps.snapTargets?.() ?? [];
    if (snaps.length) {
      const onTarget = snaps.some((t) => t[0] === from[0] && t[1] === from[1]);
      // Off every target (first move of the pick): the nearest eligible player in that direction, else the nearest.
      const jump = snapStep(from, dir, snaps, screenOf) ?? (onTarget ? null : nearest(from, snaps));
      if (!jump) return false;
      const movedSnap = moveTo({ square: jump });
      if (movedSnap) cycleIndex = -1;
      return movedSnap;
    }
    const [gx, gy] = screenDirectionToStep(from, dir, screenOf);
    const moved = moveTo({ square: fromDugout ? from : [from[0] + gx, from[1] + gy] });
    if (moved) cycleIndex = -1;
    return moved;
  };
  const crosshair: Crosshair = {
    target,
    precision,
    suppressed,
    visible,
    get lastMove() { return lastMove; },
    get lastMoveByUser() { return lastMoveByUser; },
    reset(next) {
      repeat = { key: null, nextAt: 0, start: 0 };
      cycleIndex = -1;
      lastMove = 'jump';
      lastMoveByUser = false;
      if (next === null) { target.value = null; return; }
      moveTo(next);
    },
    moveTo(next) { lastMove = 'jump'; lastMoveByUser = true; return moveTo(next); },
    step(dir) { lastMove = 'step'; lastMoveByUser = true; return step(dir); },
    stick(x, y) {
      const oct = stickOctant(x, y);
      if (!oct) { repeat = { key: null, nextAt: 0, start: 0 }; return false; }
      const t = now();
      if (oct.key !== repeat.key) {
        // A fresh tilt (or a new direction): step at once; the acceleration clock restarts.
        repeat = { key: oct.key, nextAt: 0, start: t };
        repeat.nextAt = t + interval(t);
        lastMove = 'step';
        lastMoveByUser = true;
        return step(oct);
      }
      if (t < repeat.nextAt) return false;
      // Constant cadence (flat) or the ramp: schedule from the due time so a slow frame never drifts the speed.
      repeat.nextAt = Math.max(repeat.nextAt + interval(t), t + 1);
      lastMove = 'step';
      lastMoveByUser = true;
      return step(oct);
    },
    cycle(direction, order) {
      if (!order.length) return false;
      let i = order.findIndex((entry) => sameCrosshairTarget(entry, target.value));
      if (i < 0 && cycleIndex >= 0 && cycleIndex < order.length) i = cycleIndex;
      const next = i < 0 ? (direction > 0 ? 0 : order.length - 1) : (i + direction + order.length) % order.length;
      cycleIndex = next;
      lastMove = 'jump';
      lastMoveByUser = true;
      moveTo(order[next]!);
      return true;
    },
    togglePrecision() {
      precision.value = !precision.value;
      return precision.value;
    },
  };
  return crosshair;
}

// --- Astra review of P2a: what an open card / server choice does to the crosshair buttons ------------------------

/** The surfaces that matter to the crosshair, as booleans (SpectateView builds this from the store + view state). */
export interface CrosshairGateInput {
  /** Focus-owning cards: reroll, skill use, my block-die pick, follow-up, apothecary, team chooser, inducements /
   *  cards / level-up lists, yes / no, the block-kind and foul choosers, the confirmations, the setup confirm, the
   *  unanswered-prompt panel, the wide-rail activation prompt. */
  cardOpen: boolean;
  /** A server SQUARE / PLAYER pick the crosshair serves: push direction, kick aim, square picks (Trickster …),
   *  player picks (touchback receiver, interception), Pick-Me-Up. */
  pitchPickOpen: boolean;
  /** A choice the server REQUIRES an answer to with no decline the pad's B could take: push direction, my block-die
   *  pick, kick aim, the team chooser, a non-declinable player pick, level-up / position / weather lists, the
   *  apothecary, or any open server dialog without a B-answerable card. */
  mandatoryChoiceOpen: boolean;
}

export interface CrosshairGate {
  /** Hide the crosshair (and keep A / X / the stick off the pitch): a card owns focus and no pitch pick is open. */
  suppress: boolean;
  /** The pad's B does nothing (owner round 3: B is inert on mandatory server choices). */
  cancelInert: boolean;
}

export function crosshairGate(input: CrosshairGateInput): CrosshairGate {
  return {
    suppress: input.cardOpen && !input.pitchPickOpen,
    cancelInert: input.mandatoryChoiceOpen,
  };
}

/** What the pad's B runs (SpectateView supplies the closures; tests drive the real cascade through `runCascade`). */
export interface PadCancelDeps {
  mandatoryChoiceOpen(): boolean;
  /** A pending player switch dropped (owner 10-05). */
  cancelDeferredSwitch(): boolean;
  /** The right-click waypoint cancel. */
  cancelPlannedRoute(): boolean;
  /** Order 66 live play (the Esc cascade owns cancels there). */
  o66Play(): boolean;
  /** Run the Esc cascade limited to `allowed` outcomes; false when its outcome was refused (nothing done). */
  runCascade(allowed: ReadonlySet<string>): boolean;
  /** Owner o66mh: deselect a player whose activation has not started via the right-click-on-grass path; false when
   *  that does not apply (nothing selected, a plan in progress, or the activation has started). */
  deselectPristine?(): boolean;
  contextMenuVisible(): boolean;
  closeContextMenu(): void;
  gameMenuOpen(): boolean;
  closeGameMenu(): void;
  popupVisible(): boolean;
  closePopup(): void;
  hasSelection(): boolean;
  clearSelection(): void;
}

/** The Esc-cascade outcomes the pad's B may take: dismissals, declines and cancels only — never End Activation, the
 *  end-activation ask or the Game Menu (B is not Esc). `wide-rail-decline` is the activation-rules prompt's decline. */
export const PAD_CANCEL_KINDS: ReadonlySet<string> = new Set([
  'abort-preview', 'close-menu', 'dismiss-foul-choice', 'dismiss-blitz-hold', 'cancel-kick-em-nomination', 'hold-keep',
  'dismiss-prompt', 'clear-selection', 'wide-rail-decline',
  'cancel-hit-and-run', // g1960010 (Sol r1 P2): B cancels the Hit and Run move-away, as Esc does (a cancel, not an End)
]);

/** Owner o66mh: may the pad's B deselect? Exactly when the right-click on grass deselects without asking: my turn, a
 *  selection, no plan in progress, and the acting player (if any) is the selection, untouched (no square, no block)
 *  and not in a state whose end needs a confirmation (Blitz / Punt / ball actions / Gaze). */
export interface PadDeselectInput {
  playing: boolean;
  myTurn: boolean;
  selectedId: string | null;
  actingId: string | null;
  hasPlan: boolean;
  /** No square moved, no block thrown (store blitzUntouched). */
  untouched: boolean;
  /** Ending this activation needs a confirmation (Blitz / Punt / ball action / Gaze). */
  endNeedsConfirm: boolean;
  /** A card / dialog owns focus (it is answered first). */
  cardOpen: boolean;
}
export function padMayDeselect(i: PadDeselectInput): boolean {
  return padPristineAction(i) === 'deselect';
}
/** What B does for an untouched selection — the right-click-on-grass outcome: 'deselect', or (Astra P2-4) 'ask-end'
 *  = open the end-activation confirmation for a declared-but-unmoved Blitz / hand-off / Punt / Gaze (it asks; B never
 *  ends an activation silently); null = not an untouched selection (B keeps its other meanings). */
export function padPristineAction(i: PadDeselectInput): 'deselect' | 'ask-end' | null {
  if (!i.playing || !i.myTurn || !i.selectedId || i.hasPlan || i.cardOpen) return null;
  if (!i.actingId) return 'deselect';
  if (i.actingId !== i.selectedId || !i.untouched) return null;
  return i.endNeedsConfirm ? 'ask-end' : 'deselect';
}

/** B = the right-click-on-grass cancel. Inert on a mandatory server choice (Astra P2-2). When the cascade refuses its
 *  outcome (e.g. `undeclare` with a blitz target armed) B still closes an open menu / card (Astra P2-3). */
export function createPadCancel(deps: PadCancelDeps): () => boolean {
  // Esc's order (Astra P3-b): context menu → Game Menu → player card.
  const closeOverlays = (): boolean => {
    if (deps.contextMenuVisible()) { deps.closeContextMenu(); return true; }
    if (deps.gameMenuOpen()) { deps.closeGameMenu(); return true; }
    if (deps.popupVisible()) { deps.closePopup(); return true; }
    return false;
  };
  return () => {
    if (deps.mandatoryChoiceOpen()) return false;
    if (deps.cancelDeferredSwitch()) { deps.closePopup(); return true; }
    if (deps.cancelPlannedRoute()) return true;
    if (deps.o66Play()) {
      // Owner o66mh: with no menu up, an untouched selection deselects in ONE press (the right-click-on-grass path;
      // it also closes the player's card) — never once the activation has started.
      if (!deps.contextMenuVisible() && !deps.gameMenuOpen() && deps.deselectPristine?.()) return true;
      return deps.runCascade(PAD_CANCEL_KINDS) || closeOverlays();
    }
    if (closeOverlays()) return true;
    if (deps.hasSelection()) { deps.clearSelection(); return true; }
    return false;
  };
}
