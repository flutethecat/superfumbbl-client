import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { hasTackleZones } from '@fumbbl40k/ffb-pitch/src/playerState';
import type { ClientStateId } from './clientStateMachine';
import type { CoachAction } from './availableActions';

/**
 * FUMBBL Controls (owner 11-03, spec-fumbbl-controls-2026-11-03.md): the PURE half of the FUMBBL control layer - the
 * FFB-Client mouse state machine (spec-direct-click-mode-2026-11-03.md §1, upstream/master a0e6e7b9b) as decisions
 * the game view executes with the EXISTING senders. Nothing here sends.
 *
 * The rules mirrored (L/ = ffb-client-logic/.../client/, CM/ = ffb-common/.../ffb/):
 *  - L/state/logic/MoveLogicModule.fieldInteraction: a click on a server move square steps at once; any other square
 *    walks the Automove path at once (no confirm), when Automove is on and the player can automove; else nothing.
 *  - CM/util/pathfinding/PathFinderWithPassBlockSupport.getShortestPath: the Automove path never enters an opposing
 *    tackle zone except as its LAST square, never starts next to a tackle-zone holder, never crosses a player or the
 *    loose ball (the ball square may be the destination), never leaves the end zone with the ball, and is capped at
 *    MA minus the moves already used (so it never plans a GFI).
 *  - Targets fire on ONE click when adjacent; a non-adjacent target does nothing (no walk-then-act composites).
 */
export type Square = [number, number];

const COLS = 26;
const ROWS = 15;
const key = (x: number, y: number): string => `${x},${y}`;
const onField = (s: readonly [number, number]): boolean => s[0] >= 0 && s[0] < COLS && s[1] >= 0 && s[1] < ROWS;
const chebyshev = (a: readonly [number, number], b: readonly [number, number]): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
export const isAdjacent = (a: readonly [number, number], b: readonly [number, number]): boolean => chebyshev(a, b) === 1;

function coord(raw: unknown): Square | null {
  if (Array.isArray(raw) && raw.length >= 2 && Number.isFinite(Number(raw[0])) && Number.isFinite(Number(raw[1]))) return [Number(raw[0]), Number(raw[1])];
  if (raw && typeof raw === 'object') {
    const o = raw as { x?: unknown; y?: unknown; coordinate?: unknown; fieldCoordinate?: unknown };
    if (Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.y)) && o.x !== null && o.y !== null) return [Number(o.x), Number(o.y)];
    return coord(o.coordinate ?? o.fieldCoordinate);
  }
  return null;
}

interface PlayerData { playerId: string; playerCoordinate?: unknown; playerState?: number }

/**
 * FFB-safe Automove path for `playerId` to `target` (excluding the start square), or null. `maxDistance` = MA minus the
 * moves already used (the renderer's normal, rush-free budget). Mirrors PathFinderWithPassBlockSupport.getShortestPath
 * with the normal-move context (tackle zones block; no jump).
 */
export function ffbSafePath(game: GameJson, playerId: string, target: readonly [number, number], maxDistance: number): Square[] | null {
  const fm = game.fieldModel as { playerDataArray?: PlayerData[]; ballCoordinate?: unknown; ballInPlay?: boolean; trapDoors?: unknown[] } | undefined;
  const players = fm?.playerDataArray ?? [];
  const me = players.find((p) => p.playerId === playerId);
  const start = coord(me?.playerCoordinate);
  const end: Square = [target[0], target[1]];
  if (!start || !onField(start) || !onField(end) || maxDistance <= 0) return null;
  const turnMode = String(game.turnMode ?? '');
  // ClientStateKickoffReturn: the kick-off return walk stays in the receiving half (the renderer's window rule).
  if (turnMode === 'kickoffReturn') {
    const home = !!game.homePlaying;
    if ((home && end[0] > 12) || (!home && end[0] < 13)) return null;
  }
  const homeIds = new Set(((game.teamHome as { playerArray?: { playerId: string }[] } | undefined)?.playerArray ?? []).map((p) => p.playerId));
  const moverHome = homeIds.has(playerId);
  const blocked = new Set<string>();
  const tz = new Set<string>();
  for (const p of players) {
    if (p.playerId === playerId) continue;
    const c = coord(p.playerCoordinate);
    if (!c || !onField(c)) continue;
    blocked.add(key(c[0], c[1]));
    if (homeIds.has(p.playerId) === moverHome) continue;
    if (!hasTackleZones(Number(p.playerState ?? 0))) continue;
    if (isAdjacent(c, start)) return null; // "Don't allow an initial dodge"
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const t: Square = [c[0] + dx, c[1] + dy];
      if (onField(t)) tz.add(key(t[0], t[1]));
    }
  }
  const ball = coord(fm?.ballCoordinate);
  // "Handle the square with the ball by marking it as a TZ": into it, never through it.
  if (ball && onField(ball) && fm?.ballInPlay) tz.add(key(ball[0], ball[1]));
  // "Treat trapdoor fields as tackle zones to avoid paths crossing them."
  for (const door of fm?.trapDoors ?? []) { const c = coord(door); if (c && onField(c)) tz.add(key(c[0], c[1])); }
  const hasBall = !!ball && ball[0] === start[0] && ball[1] === start[1];
  const endzoneX = moverHome ? COLS - 1 : 0;
  const endKey = key(end[0], end[1]);
  if (blocked.has(endKey)) return null;
  // Breadth-first: every step costs one, so the first arrival is a shortest path (as the upstream A*).
  const parent = new Map<string, string | null>([[key(start[0], start[1]), null]]);
  let frontier: Square[] = [start];
  for (let distance = 0; frontier.length && distance < maxDistance; distance++) {
    const next: Square[] = [];
    for (const cur of frontier) {
      const curKey = key(cur[0], cur[1]);
      if (curKey !== key(start[0], start[1]) && tz.has(curKey)) continue; // a tackle zone is a path's end only
      const inEndzone = cur[0] === endzoneX;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const n: Square = [cur[0] + dx, cur[1] + dy];
        const nKey = key(n[0], n[1]);
        if (!onField(n) || parent.has(nKey) || blocked.has(nKey)) continue;
        if (tz.has(nKey) && nKey !== endKey) continue;
        if (hasBall && inEndzone && n[0] !== endzoneX) continue; // never carry the ball back out of the end zone
        parent.set(nKey, curKey);
        if (nKey === endKey) {
          const path: Square[] = [];
          let k: string | null = nKey;
          while (k && k !== key(start[0], start[1])) {
            const [x, y] = k.split(',').map(Number) as Square;
            path.unshift([x, y]);
            k = parent.get(k) ?? null;
          }
          return path;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The decision table (spec §10): state × input → effect. The view routes each FUMBBL Controls click through these.
// ---------------------------------------------------------------------------------------------------------------------

/** States whose acting player walks on square clicks (the move family: Move, Blitz, Foul, Pass, Hand-off, and the
 *  other actions declared as their moving variant). */
export const FUMBBL_MOVE_FAMILY_STATES: ReadonlySet<string> = new Set([
  'MOVE', 'BLITZ', 'FOUL', 'PASS', 'HAND_OVER', 'PUNT', 'THROW_TEAM_MATE', 'KICK_TEAM_MATE', 'GAZE_MOVE', 'GAZE',
  'PUTRID_REGURGITATION_BLITZ', 'KICK_EM_BLITZ', 'PASS_BLOCK', 'KICKOFF_RETURN',
]);

export type FumbblSquareEffect =
  | { kind: 'step'; square: Square }
  | { kind: 'autoMove'; route: Square[] }
  | { kind: 'ignore' };

export interface FumbblSquareInput {
  square: Square;
  /** The server's move squares (moveSquareArray): the adjacent squares it offers, dodge / GFI included. */
  serverMoveSquares: readonly Square[];
  automove: boolean;
  /** Ball & Chain (preventAutoMove) and the On the Ball moves: square by square only. */
  preventAutoMove: boolean;
  /** The FFB-safe path to `square` (ffbSafePath); read only when needed. */
  safePath: () => Square[] | null;
}

/** MoveLogicModule.fieldInteraction: a move square steps; otherwise the Automove path walks at once; else nothing. */
export function fumbblSquareClick(input: FumbblSquareInput): FumbblSquareEffect {
  const { square } = input;
  if (input.serverMoveSquares.some((s) => s[0] === square[0] && s[1] === square[1])) return { kind: 'step', square: [square[0], square[1]] };
  if (!input.automove || input.preventAutoMove) return { kind: 'ignore' };
  const route = input.safePath();
  // A one-square route the server did not offer is not a legal step: nothing.
  if (!route || route.length < 2) return { kind: 'ignore' };
  return { kind: 'autoMove', route };
}

export type FumbblPlayerInput =
  | { kind: 'ownPlayer'; isActing: boolean; /** another own player is acting */ otherActing: boolean; /** the acting player's menu has a row besides End */ actingHasOptions?: boolean }
  | { kind: 'opponent'; adjacent: boolean; standing: boolean; down: boolean; validBlitzTarget?: boolean }
  | { kind: 'teammate'; adjacent: boolean; inPassRange: boolean; rightStuff: boolean };

export type FumbblPlayerEffect =
  | 'openMenu' | 'actingMenu' | 'deselect' | 'block' | 'targetSelected' | 'foul' | 'handOver' | 'pass' | 'gaze'
  | 'pickUpMate' | 'toggleMultiBlock' | 'ignore';

export type FumbblRuleset = 'bb2016' | 'bb2020' | 'bb2025';

/**
 * The FFB player-click rows (spec-direct-click §1). `state` is our derived client state; BB2016 has no Blitz
 * target-selection step (the server never enters selectBlitzTarget), so its Blitz walks and blocks an adjacent target.
 */
export function fumbblPlayerClick(state: ClientStateId | string, input: FumbblPlayerInput, ruleset: FumbblRuleset): FumbblPlayerEffect {
  if (input.kind === 'ownPlayer') {
    if (input.isActing) return input.actingHasOptions === false ? 'deselect' : 'actingMenu';
    // SelectLogicModule: a click on an own active player always opens the action menu (never a local select).
    if (state === 'SELECT_PLAYER') return 'openMenu';
    // Another of our players is acting: the existing switch preference decides (its menu follows the switch).
    return input.otherActing ? 'openMenu' : 'openMenu';
  }
  if (input.kind === 'opponent') {
    switch (state) {
      case 'SELECT_BLITZ_TARGET':
        // bb2020/25 target selection: hover shows the path, the click sends targetSelected (any valid target).
        return ruleset === 'bb2016' ? 'ignore' : (input.validBlitzTarget === false ? 'ignore' : 'targetSelected');
      case 'BLOCK':
      case 'BLITZ':
        return input.adjacent && input.standing ? 'block' : 'ignore';
      case 'SYNCHRONOUS_MULTI_BLOCK':
        return input.adjacent && input.standing ? 'toggleMultiBlock' : 'ignore';
      case 'FOUL':
        return input.adjacent && input.down ? 'foul' : 'ignore';
      case 'GAZE_MOVE':
      case 'GAZE':
        return input.adjacent && input.standing ? 'gaze' : 'ignore';
      default:
        return 'ignore'; // MoveLogicModule.playerInteraction ignores an opponent click (no click-to-act)
    }
  }
  switch (state) {
    case 'HAND_OVER':
      return input.adjacent ? 'handOver' : 'ignore';
    case 'PASS':
      return input.inPassRange ? 'pass' : 'ignore';
    case 'THROW_TEAM_MATE':
    case 'KICK_TEAM_MATE':
      return input.adjacent && input.rightStuff ? 'pickUpMate' : 'ignore';
    default:
      return 'ignore';
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Walk-then-act composites (spec §9 partial-gating risk): every site in SpectateView that plans a walk before an action
// is gated by ONE predicate, fumbblControls(). Each site carries the marker `fumbbl-gate:<id>` on the gating line; the
// structural test (fumbblControlsSites.test.ts) requires exactly this list.
// ---------------------------------------------------------------------------------------------------------------------
export const FUMBBL_GATED_SITES = [
  'blitz-to-contact', // a Blitz target click auto-walks to contact, then blocks
  'quick-click-blitz', // a distant opponent click in MOVE stages a Blitz walk
  'click-to-act-block', // an adjacent opponent click in MOVE declares Block (FFB ignores it)
  'foul-distant', // a distant Foul victim plots then walks to contact
  'pass-after-walk', // a pass target with a plotted route walks then throws
  'hand-off-at-destination', // a Hand-off receiver with a plotted route walks then hands off
  'ttm-walk', // a Throw Team-Mate click walks to the mate, then picks up
  'gaze-approach', // a distant Gaze victim plots then walks to contact
  'planner-preview', // the move-family square click: route preview, waypoints, click-again confirm
  'local-select', // a left click on an own player selects it locally (FFB opens the menu)
  'two-click-target', // the two-click nominate / confirm of a throw or Block
] as const;
export type FumbblGatedSite = (typeof FUMBBL_GATED_SITES)[number];

// ---------------------------------------------------------------------------------------------------------------------
// The action menu (spec §2): FFB's rows in FFB's order on one list, shortcut letters only with FUMBBL keyboard shortcuts.
// ---------------------------------------------------------------------------------------------------------------------

/** FFB ClientAction for one of our menu rows (null = a row FFB lacks). */
export function ffbClientAction(a: Pick<CoachAction, 'action' | 'kind' | 'blockKind' | 'ruleId'> & { ffbAction?: string }): string | null {
  if (a.kind === 'endMove') return 'END_MOVE';
  if (a.ffbAction) return a.ffbAction; // audit round 2: an explicit presentation identity (the return-to-walk rows are MOVE)
  if (ffbLacksRow(a)) return null;
  switch (a.action) {
    case 'block':
      switch (a.blockKind) {
        case undefined: return 'BLOCK';
        case 'stab': return 'STAB';
        case 'chainsaw': return 'CHAINSAW';
        case 'vomit': return 'PROJECTILE_VOMIT';
        case 'breatheFire': return 'BREATHE_FIRE';
        case 'chomp': return 'CHOMP';
        default: return 'BLOCK';
      }
    case 'multipleBlock': return 'MULTIPLE_BLOCK';
    case 'throwBomb': return 'BOMB';
    case 'shotToNothingBomb': return 'SHOT_TO_NOTHING_BOMB';
    case 'gazeMove': return 'GAZE';
    case 'move': return 'MOVE';
    case 'jump': return 'JUMP';
    case 'blitzMove': return 'BLITZ';
    case 'frenziedRush': return 'FRENZIED_RUSH';
    case 'foulMove': return 'FOUL';
    case 'passMove': return 'PASS';
    case 'toggleHailMaryPass': return 'SHOT_TO_NOTHING';
    case 'punt': case 'puntMove': return 'PUNT';
    case 'handOverMove': return 'HAND_OVER';
    case 'throwTeamMateMove': return 'THROW_TEAM_MATE';
    case 'kickTeamMateMove': return 'KICK_TEAM_MATE';
    case 'throwKeg': return 'BEER_BARREL_BASH';
    case 'allYouCanEat': return 'ALL_YOU_CAN_EAT';
    case 'kickEmBlock': return 'KICK_EM_BLOCK';
    case 'kickEmBlitz': return 'KICK_EM_BLITZ';
    case 'theFlashingBlade': return 'THE_FLASHING_BLADE';
    case 'viciousVines': return 'VICIOUS_VINES';
    case 'furiousOutburst': return 'FURIOUS_OUTBURST';
    case 'removeConfusion': return 'RECOVER';
    case 'standUp': return 'STAND_UP';
    case 'secureTheBall': return 'SECURE_THE_BALL';
    case 'forgo': return 'FORGO'; // F2-1: IPlayerPopupMenuKeys.KEY_FORGO (F)
    case 'toggleHandOverAnyone': return 'HAND_OVER'; // F1-1: the in-action ClientAction.HAND_OVER toggle (H)
    case 'thenIStartedBlastin': return 'THEN_I_STARTED_BLASTIN';
    case 'fumblerooskie': return 'FUMBLEROOSKIE';
    case 'illCarryYou': case 'placeCarriedPlayer': return 'ILL_CARRY_YOU';
    case 'wisdom': return 'WISDOM';
    case 'raidingParty': return 'RAIDING_PARTY';
    case 'blackInk': return 'BLACK_INK';
    case 'catchOfTheDay': return 'CATCH_OF_THE_DAY';
    case 'incorporeal': return 'INCORPOREAL';
    case 'slashingNails': return 'SLASHING_NAILS';
    case 'putridRegurgitationBlitz': return 'PROJECTILE_VOMIT';
    case 'starUseSkill': return 'STAR_SKILL';
    default: return null;
  }
}

/** Rows FFB has no counterpart for (hidden under FUMBBL Controls, never given a letter): an unavailable star rule, and
 *  our Big Guy "Activate" row (a Move declare that also arms the roll-on-end; FFB offers only Move - rig g1100 #3,
 *  where "Activate M" and "Move M" shared a letter). */
export function ffbLacksRow(a: Pick<CoachAction, 'action' | 'ruleId'>): boolean {
  return a.action === 'starRuleNotAvailable' || a.ruleId === 'bigGuyActivate';
}

/** FFB's popup order: SelectLogicModule (bb2025 / mixed) for a fresh player, then MoveLogicModule's acting rows. */
export const FFB_MENU_ORDER: readonly string[] = [
  'PASS_ANY_SQUARE',
  'BLOCK', 'STAB', 'CHAINSAW', 'PROJECTILE_VOMIT', 'BREATHE_FIRE', 'MULTIPLE_BLOCK', 'BOMB', 'SHOT_TO_NOTHING_BOMB',
  'GAZE', 'MOVE', 'JUMP', 'BOUNDING_LEAP', 'BLITZ', 'FRENZIED_RUSH', 'FOUL', 'PASS', 'SHOT_TO_NOTHING', 'PUNT',
  'HAND_OVER', 'THROW_TEAM_MATE', 'KICK_TEAM_MATE', 'BEER_BARREL_BASH', 'ALL_YOU_CAN_EAT', 'KICK_EM_BLOCK',
  'KICK_EM_BLITZ', 'THE_FLASHING_BLADE', 'VICIOUS_VINES', 'FURIOUS_OUTBURST', 'RECOVER', 'STAND_UP_BLITZ', 'STAND_UP',
  'SECURE_THE_BALL', 'FORGO', 'THEN_I_STARTED_BLASTIN', 'CHOMP', 'FUMBLEROOSKIE', 'END_MOVE', 'ILL_CARRY_YOU',
  'TREACHEROUS', 'WISDOM', 'RAIDING_PARTY', 'LOOK_INTO_MY_EYES', 'BALEFUL_HEX', 'BLACK_INK', 'CATCH_OF_THE_DAY',
  'AUTO_GAZE_ZOAT', 'INCORPOREAL', 'SLASHING_NAILS', 'STAR_SKILL',
];

/** IPlayerPopupMenuKeys: the letter each FFB row answers to while its popup is open. */
export const FFB_MENU_LETTERS: Readonly<Record<string, string>> = {
  BLOCK: 'B', STAB: 'Q', CHAINSAW: 'C', PROJECTILE_VOMIT: 'V', BREATHE_FIRE: 'I', MULTIPLE_BLOCK: 'U', BOMB: 'O',
  SHOT_TO_NOTHING_BOMB: 'V', GAZE: 'G', MOVE: 'M', JUMP: 'J', BOUNDING_LEAP: 'N', BLITZ: 'Z', FRENZIED_RUSH: 'Q', FOUL: 'F',
  PASS: 'P', PASS_ANY_SQUARE: 'P', SHOT_TO_NOTHING: 'N', PUNT: 'A', HAND_OVER: 'H', THROW_TEAM_MATE: 'T', KICK_TEAM_MATE: 'K',
  BEER_BARREL_BASH: 'L', ALL_YOU_CAN_EAT: 'Y', KICK_EM_BLOCK: 'C', KICK_EM_BLITZ: 'I', THE_FLASHING_BLADE: 'D',
  VICIOUS_VINES: '+', FURIOUS_OUTBURST: '*', RECOVER: 'R', STAND_UP_BLITZ: 'W', STAND_UP: 'S', SECURE_THE_BALL: 'E',
  FORGO: 'F', THEN_I_STARTED_BLASTIN: '!', CHOMP: '1', FUMBLEROOSKIE: '4', END_MOVE: 'E', ILL_CARRY_YOU: '3',
  TREACHEROUS: 'A', WISDOM: 'W', RAIDING_PARTY: '2', LOOK_INTO_MY_EYES: 'Y', BALEFUL_HEX: 'X', BLACK_INK: 'L',
  CATCH_OF_THE_DAY: 'D', AUTO_GAZE_ZOAT: 'Z', INCORPOREAL: 'U', SLASHING_NAILS: 'S',
};

/** One row of our menu, tagged for the FFB pass: `ffb` = its FFB ClientAction (null = a row FFB lacks). */
export interface FfbMenuRow<T> { item: T; ffb: string | null; hidden?: boolean }

/** Order rows as FFB's popup does and hide the rows FFB lacks (the caller tags those `hidden`). Rows without an FFB
 *  action that are not hidden keep their relative place after the FFB rows (nothing the server offers is lost). */
export function ffbOrderedRows<T>(rows: readonly FfbMenuRow<T>[]): FfbMenuRow<T>[] {
  const rank = (r: FfbMenuRow<T>): number => {
    const i = r.ffb ? FFB_MENU_ORDER.indexOf(r.ffb) : -1;
    return i < 0 ? FFB_MENU_ORDER.length : i;
  };
  return rows.filter((r) => !r.hidden).map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((e) => e.r);
}

/** The shortcut letter shown on a row (only while FUMBBL keyboard shortcuts are on), or null. */
export function ffbMenuLetter(ffb: string | null): string | null {
  return ffb ? (FFB_MENU_LETTERS[ffb] ?? null) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Keyboard (spec §5): the eight step keys are SCREEN directions (FFB's field is drawn north-up); our pitch can be turned
// and flipped, so the step lands on the neighbour whose on-screen direction is closest to the key's.
// ---------------------------------------------------------------------------------------------------------------------
export type StepDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
const DIRECTION_VECTOR: Record<StepDirection, [number, number]> = {
  n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1],
};

/** The neighbour of `from` that lies in screen direction `dir` (toScreen = the square's on-screen centre). */
export function stepSquareForDirection(from: readonly [number, number], dir: StepDirection, toScreen: (sq: Square) => { x: number; y: number } | null): Square | null {
  const origin = toScreen([from[0], from[1]]);
  if (!origin) return null;
  const [vx, vy] = DIRECTION_VECTOR[dir];
  const vlen = Math.hypot(vx, vy);
  let best: Square | null = null;
  let bestCos = -Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (!dx && !dy) continue;
    const sq: Square = [from[0] + dx, from[1] + dy];
    if (!onField(sq)) continue;
    const p = toScreen(sq);
    if (!p) continue;
    const ux = p.x - origin.x;
    const uy = p.y - origin.y;
    const ulen = Math.hypot(ux, uy);
    if (!ulen) continue;
    const cos = (ux * vx + uy * vy) / (ulen * vlen);
    if (cos > bestCos) { bestCos = cos; best = sq; }
  }
  // The closest of the eight (the projection may skew the diagonals); a square behind the key's direction never steps.
  return best && bestCos > 0 ? best : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Right Click (spec §3, FFB ClientStateAwt.mouseReleased "Right Click Behaviour"), both control layers.
// ---------------------------------------------------------------------------------------------------------------------
export type RightClickEffect =
  | 'today' // the Super FUMBBL cascade (the renderer's own right-click)
  | 'nothing'
  | 'leftClick' // the left click at that point
  | 'playerMenu' // that player's menu, opened WITHOUT executing anything (no block / foul / hand-off / pass / move)
  | 'endActivation' // the acting player's End (its confirmation, if on, still asks)
  | 'clearSelection';

export interface RightClickInput {
  behaviour: 'super' | 'endAction' | 'leftClick' | 'contextMenu' | 'disabled';
  layer: 'super' | 'fumbbl';
  /** An open confirmation / decision owns the right-click (it answers "Go back" there). */
  promptOpen: boolean;
  onPlayer: boolean;
  /** My player is acting (on my turn). */
  myActingPlayer: boolean;
  hasSelection: boolean;
}

export function rightClickEffect(i: RightClickInput): RightClickEffect {
  if (i.behaviour === 'super') return 'today';
  if (i.behaviour === 'disabled') return 'nothing';
  if (i.promptOpen) return 'today';
  if (i.behaviour === 'leftClick') return 'leftClick'; // SETTING_RIGHT_CLICK_LEGACY_MODE: clickOnPlayer / clickOnField
  if (i.behaviour === 'contextMenu') {
    // SETTING_RIGHT_CLICK_OPENS_CONTEXT_MENU (orchestrator ruling, Sol r1): it is NOT "Works like Left Click" - on a
    // player it only opens that player's menu, never a target action; on the field it does nothing. Both layers.
    return i.onPlayer ? 'playerMenu' : 'nothing';
  }
  // SETTING_RIGHT_CLICK_END_ACTION_ON: endPlayerActivation with an acting player; our selection otherwise.
  if (i.myActingPlayer) return 'endActivation';
  return i.hasSelection ? 'clearSelection' : 'nothing';
}

/** FUMBBL Controls (Sol r1 #7): does the acting player's assembled menu (assembleActingPlayerRows: the router's rows
 *  plus Pass Ball (any square), Bounding Leap and the Blitz flavors) offer anything besides End? FFB opens the popup
 *  then; otherwise the click deselects. */
export function actingMenuHasOptions(rows: readonly { endActivation?: boolean; disabled?: boolean; ffbHidden?: boolean }[]): boolean {
  return rows.some((row) => !row.endActivation && !row.disabled && !row.ffbHidden);
}

/** FUMBBL Controls (Sol r1 #3): a square click in PASS that lands on a team-mate inside the armed range template is the
 *  pass to that team-mate (PassLogicModule), not a move: the renderer routes eligible template squares as tiles, so the
 *  receiver can arrive here instead of as a player click. A server move square still steps. */
export function fumbblTileIsPassTarget(i: { state: string; serverMoveSquare: boolean; inTemplate: boolean; teammateOnSquare: boolean }): boolean {
  return i.state === 'PASS' && !i.serverMoveSquare && i.inTemplate && i.teammateOnSquare;
}

/** FUMBBL Controls (Sol r1 #4): a Throw Team-Mate pick-up needs the mate ADJACENT now. An unknown square or a missing /
 *  empty contact path never counts as adjacent (an unreachable distant mate used to slip through as an empty route). */
export function ttmMateAdjacent(thrower: readonly [number, number] | null, mate: readonly [number, number] | null): boolean {
  return !!thrower && !!mate && isAdjacent(thrower, mate);
}

/** FFB getShortestPathToPlayer (Sol r1 #10): the safe Automove path to the nearest free square beside `target` (an
 *  opponent's square) - what the hover draws over a Blitz target or any opponent. [] when already beside it. */
export function ffbSafePathToPlayer(game: GameJson, playerId: string, target: readonly [number, number], maxDistance: number): Square[] | null {
  const fm = game.fieldModel as { playerDataArray?: PlayerData[] } | undefined;
  const me = coord(fm?.playerDataArray?.find((p) => p.playerId === playerId)?.playerCoordinate);
  if (!me) return null;
  if (isAdjacent(me, target)) return [];
  let best: Square[] | null = null;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (!dx && !dy) continue;
    const path = ffbSafePath(game, playerId, [target[0] + dx, target[1] + dy], maxDistance);
    if (path && path.length && (!best || path.length < best.length)) best = path;
  }
  return best;
}

/** Plain movement states (Sol r2 P2): a Super step key sends the one square directly only here. */
export const KEY_STEP_MOVE_STATES: ReadonlySet<string> = new Set([
  'MOVE', 'BLITZ', 'FOUL', 'PASS', 'HAND_OVER', 'PUNT', 'GAZE_MOVE', 'THROW_TEAM_MATE', 'KICK_TEAM_MATE',
  'PUTRID_REGURGITATION_BLITZ', 'KICK_EM_BLITZ', 'PASS_BLOCK', 'KICKOFF_RETURN',
]);

/** FUMBBL keyboard step (Sol r1 #8, r2 P2): the key steps at once in EITHER layer, only onto a server move square.
 *  - FUMBBL Controls: the square click already steps -> 'tilePick' (special picks keep their own tile handlers).
 *  - Super FUMBBL Controls: in a plain movement state the click would only plot a route, so the key sends the one square
 *    ('step'); every other state (Swoop, Furious Outburst, Hit and Run, Blitz target selection, a Jump / Ball & Chain
 *    square) takes the same tile handler a click on that square uses ('tilePick').
 *  - A Punt target is never a step: the key does nothing there (a keypress must not kick the ball). */
export function fumbblStepKeyEffect(i: { layer: 'super' | 'fumbbl'; serverMoveSquare: boolean; state: string; puntTargeting?: boolean; singleSquarePick?: boolean }): 'tilePick' | 'step' | 'none' {
  if (!i.serverMoveSquare || i.puntTargeting) return 'none';
  if (i.layer === 'fumbbl' || !KEY_STEP_MOVE_STATES.has(i.state) || i.singleSquarePick) return 'tilePick';
  return 'step';
}
