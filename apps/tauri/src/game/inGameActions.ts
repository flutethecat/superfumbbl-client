/**
 * Controller support P1 (owner 10-07): the in-game action dispatcher and the camera-stick handler, as pure factories.
 * SpectateView builds both from its own closures: its keydown handler and the gamepad router (game/controls.ts
 * dispatchControlAction / dispatchAnalog) land in the SAME runner, so a controller button runs exactly the keyboard's
 * code. Kept out of the 20k-line view so tests drive the real runner.
 */
import { requestPlayerCard, type ControlActionId, type InputSource } from './controls';
import { lockedControlAction } from './logic/confirmCardLock';

export interface InGameActionDeps {
  /** An app-shell modal (Settings, the setup wizard rerun) owns input: the shell's handler answers instead. */
  shellModalOpen(): boolean;
  /** The shared input guard (see SpectateView `controllerInputBlocked`): a focused text field / chat entry, or the
   *  unanswered-prompt panel. Keyboard presses run it in the keydown handler before reaching the runner. */
  inputBlocked(source: InputSource): boolean;
  /** Astra B2 parity: while the unanswered-prompt panel is up, a pad action that stands in for a gated key (Start =
   *  Esc, View = Enter, confirm = Space) gets the keyboard gate's handling; true = swallowed (no game command). Other
   *  pad actions (LT chords, zoom) pass, like H / L do. */
  unknownPanelGate?(id: ControlActionId, source: InputSource): boolean;
  rosterOpen(): boolean;
  closeRoster(): void;
  /** The Esc cascade (#48). */
  escapeCascade(): void;
  /** The confirm key's body; false = nothing to confirm. */
  confirm(): boolean;
  /** The End Turn / Confirm Setup button is live. */
  endTurnAvailable(): boolean;
  endTurn(): void;
  toggleRoster(): void;
  toggleLogExpand(): void;
  cycleTackleZones(): void;
  toggleAutoDirector(): void;
  /** False when chat is disabled. */
  openChat(): boolean;
  /** False when the telestrator is not mounted. */
  toggleTelestrator(): boolean;
  /** False when there is no renderer. */
  zoom(direction: 1 | -1): boolean;
  /** Owner 10-10: flip the player-card mode (cards on / off); absent = not offered here. */
  togglePlayerCards?(): boolean;
  /** Owner 10-12: turn the pitch view around (settings.pitchFlipped); absent = not offered here. */
  togglePitchFlip?(): boolean;
  /** Controller support P2a: the pitch crosshair (absent = the pad's A / X / B / L3 / D-pad do nothing here). */
  crosshair?: CrosshairActionDeps;
  /** Controller support P2b: the setup shortcuts (absent / false = not in setup, the press goes on). */
  setup?: SetupPadDeps;
  /** Owner 10-15: a coach confirmation card is open (game/logic/confirmCardLock.ts). Absent = never locked. */
  confirmCardLock?: ConfirmCardLockDeps;
}

/** Owner 10-15: "No other actions can be planned while any confirm modal is up." While `locked()`, gameplay actions
 *  are swallowed (`nudge` draws the eye to the card), Esc / Start runs only the card's own Esc answer, the confirm key
 *  only the card's own confirm; camera, chat, Log, roster and display toggles keep working (lockedControlAction). */
export interface ConfirmCardLockDeps {
  locked(): boolean;
  nudge(): void;
  /** Esc with a card open: the card's own Esc answer, else nothing (the host nudges). */
  escape(): void;
  /** The confirm key with a card open: true = handled (answered, consumed or swallowed). */
  confirm(): boolean;
}

/** P2b (owner round 2): setup — LB places the current player on the next free line-of-scrimmage square, RB sends it to
 *  the reserves; both through the existing setup place / remove wire. False = not in setup (or nothing to do). */
export interface SetupPadDeps {
  active(): boolean;
  placeOnLos(): boolean;
  sendToReserve(): boolean;
}

/** P2a: what the crosshair buttons run. `select` / `context` route through the renderer's OWN click / right-click
 *  bodies at the crosshair (no second code path); `cancel` = the right-click-on-grass cancel (inert on mandatory
 *  server choices). Each returns false when it had nothing to act on. */
export interface CrosshairActionDeps {
  /** The crosshair is shown (controller mode, placed, not suppressed by a card / menu). */
  active(): boolean;
  select(): boolean;
  context(): boolean;
  cancel(): boolean;
  cycle(direction: 1 | -1): boolean;
  togglePrecision(): void;
}

/** False = not handled here (the app shell gets the offer). */
export function createInGameActionRunner(deps: InGameActionDeps): (id: ControlActionId, source: InputSource) => boolean {
  return (id, source) => {
    if (deps.shellModalOpen()) return false;
    if (deps.inputBlocked(source)) return source === 'controller'; // swallowed: never reaches the shell either
    if (source === 'controller' && deps.unknownPanelGate?.(id, source)) return true;
    if (deps.confirmCardLock?.locked()) {
      const verdict = lockedControlAction(id);
      if (verdict === 'escape') {
        if (deps.rosterOpen()) deps.closeRoster(); // the roster pop-out is non-game UI: Esc still closes it first
        else deps.confirmCardLock.escape();
        return true;
      }
      if (verdict === 'confirm') return deps.confirmCardLock.confirm();
      if (verdict === 'swallow') { deps.confirmCardLock.nudge(); return true; }
    }
    switch (id) {
      case 'gameMenu':
        // Owner 10-02: Esc closes the Helmet roster pop-out first (and does nothing else).
        if (deps.rosterOpen()) deps.closeRoster();
        else deps.escapeCascade();
        return true;
      case 'confirm': return deps.confirm();
      case 'endTurn':
        // View = the End Turn / Confirm Setup button, only while that button is live; endTurn() runs its confirmations.
        if (!deps.endTurnAvailable()) return source === 'controller';
        deps.endTurn();
        return true;
      case 'roster': deps.toggleRoster(); return true;
      case 'logExpand': deps.toggleLogExpand(); return true;
      case 'tackleZones': deps.cycleTackleZones(); return true;
      case 'autoDirector': deps.toggleAutoDirector(); return true;
      case 'openChat': return deps.openChat();
      case 'telestrator': return deps.toggleTelestrator();
      // Owner round 2 (10-07): P / Y = the player card. P1 stub: the hook is a no-op until the P2 card surface.
      case 'playerCard': requestPlayerCard(source); return true;
      // Owner 10-10: "Player portraits on / off" (default: the middle mouse button on the pitch).
      case 'playerCardsToggle': return deps.togglePlayerCards?.() ?? false;
      // Owner 10-12: "Flip the pitch view" (a view change only: no command, no seat change).
      case 'pitchFlip': return deps.togglePitchFlip?.() ?? false;
      // Owner round 2: LB / RB zoom in game (one wheel rung about the screen centre).
      case 'zoomIn': return deps.zoom(1);
      case 'zoomOut': return deps.zoom(-1);
      // Controller support P2a: the crosshair. Pad-only (the mouse is their keyboard side); a pad press is swallowed
      // even when there is nothing to act on, so it never falls through to the shell.
      case 'crosshairSelect':
        if (source !== 'controller' || !deps.crosshair) return false;
        if (deps.crosshair.active()) deps.crosshair.select();
        return true;
      case 'crosshairContext':
        if (source !== 'controller' || !deps.crosshair) return false;
        if (deps.crosshair.active()) deps.crosshair.context();
        return true;
      case 'crosshairCancel':
        // B works while a card / menu suppresses the crosshair (it closes them).
        if (source !== 'controller' || !deps.crosshair) return false;
        deps.crosshair.cancel();
        return true;
      case 'precisionToggle':
        if (source !== 'controller' || !deps.crosshair) return false;
        deps.crosshair.togglePrecision();
        return true;
      case 'cyclePlayerPrev':
      case 'cyclePlayerNext':
        if (!deps.crosshair) return false;
        if (deps.crosshair.active()) deps.crosshair.cycle(id === 'cyclePlayerNext' ? 1 : -1);
        return source === 'controller' || deps.crosshair.active();
      case 'setupPlaceLos':
      case 'setupReserve':
        if (!deps.setup?.active()) return false;
        if (id === 'setupPlaceLos') deps.setup.placeOnLos(); else deps.setup.sendToReserve();
        return true;
      // virtualKeyboard (RT+X) is a reserved binding — P3.
      default: return false;
    }
  };
}

export interface CameraStickDeps {
  /** Same modal guard as WASD: no pan behind Settings / the wizard. */
  shellModalOpen(): boolean;
  /** renderer.setPanDirection (false when there is no renderer). */
  setPan(x: number, y: number): boolean;
  /** Hand the glide back to the held keys (updatePanDir). */
  restoreKeys(): void;
}
export interface CameraStickHandler {
  (stick: 'left' | 'right', x: number, y: number): boolean;
  /** Fail-safe: drop a pad pan (the glide never outlives the stick). No-op when no pad pan is active. */
  neutralise(): void;
  readonly panning: boolean;
}

/** Controller camera stick = the WASD glide with magnitude (W = stick up). A "pad pan active" flag lets every
 *  fail-safe path stop the glide even when the zero stick never arrives. */
export function createCameraStickHandler(deps: CameraStickDeps): CameraStickHandler {
  let panning = false;
  const neutralise = (): void => {
    if (!panning) return;
    panning = false;
    deps.restoreKeys();
  };
  const handler = ((_stick: 'left' | 'right', x: number, y: number): boolean => {
    if (x === 0 && y === 0) { neutralise(); return true; }
    if (deps.shellModalOpen()) { neutralise(); return true; }
    if (!deps.setPan(-x, -y)) return false;
    panning = true;
    return true;
  }) as CameraStickHandler;
  handler.neutralise = neutralise;
  Object.defineProperty(handler, 'panning', { get: () => panning });
  return handler;
}

/** Owner 10-07: a held trigger zooms continuously at one wheel step per 250 ms (4 steps / s). */
export const zoomRatePerSecond = 1000 / 250;

export interface HoldZoomDeps {
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  /** renderer.zoomBySteps (false when there is no renderer). */
  zoomSteps(steps: number): boolean;
  /** Re-checked every frame (Astra review): the runner's guards — a shell modal, chat / text focus. False stops it. */
  allowed?(): boolean;
}
/** A frame never applies more than this much elapsed time (a stalled / backgrounded tab cannot jump the zoom). */
export const HOLD_MAX_FRAME_MS = 100;
export interface HoldZoom {
  start(direction: 1 | -1): void;
  stop(): void;
  readonly active: boolean;
}
/**
 * Astra review: hold ownership per TRIGGER. Each held trigger records its direction; the most recent one drives the
 * zoom, releasing it falls back to the other trigger still held, and releasing the last one stops. (LT bound as a zoom
 * IN secondary is just another trigger holding +1.)
 */
export function createHoldZoomOwner(zoom: Pick<HoldZoom, 'start' | 'stop'>): (id: ControlActionId, active: boolean, trigger: 'LT' | 'RT') => boolean {
  const held: { trigger: 'LT' | 'RT'; direction: 1 | -1 }[] = [];
  const drive = (): void => {
    const top = held[held.length - 1];
    if (top) zoom.start(top.direction); else zoom.stop();
  };
  return (id, active, trigger) => {
    if (id !== 'zoomIn' && id !== 'zoomOut') return false;
    const at = held.findIndex((h) => h.trigger === trigger);
    if (at >= 0) held.splice(at, 1);
    if (active) held.push({ trigger, direction: id === 'zoomIn' ? 1 : -1 });
    drive();
    return true;
  };
}

/** Continuous zoom while a trigger is held: each frame applies rate × elapsed steps (linear in zoom level). */
export function createHoldZoom(deps: HoldZoomDeps): HoldZoom {
  let direction: 1 | -1 | 0 = 0;
  let last = 0;
  let frame: number | null = null;
  const tick = (): void => {
    frame = null;
    if (!direction) return;
    if (deps.allowed && !deps.allowed()) { direction = 0; return; }
    const t = deps.now();
    const elapsed = Math.max(0, Math.min(HOLD_MAX_FRAME_MS, t - last));
    const steps = (elapsed / 1000) * zoomRatePerSecond * direction;
    last = t;
    if (steps !== 0 && !deps.zoomSteps(steps)) { direction = 0; return; }
    frame = deps.requestFrame(tick);
  };
  const stop = (): void => {
    direction = 0;
    if (frame !== null) deps.cancelFrame(frame);
    frame = null;
  };
  return {
    start(dir) {
      stop();
      if (deps.allowed && !deps.allowed()) return;
      direction = dir;
      last = deps.now();
      frame = deps.requestFrame(tick);
    },
    stop,
    get active() { return direction !== 0; },
  };
}
