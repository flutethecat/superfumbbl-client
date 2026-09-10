// ORDER 66 — Phase A.2: the INTERACTION ROUTER (surface ① of the wiring model).
//
// The port of each state's playerInteraction/fieldInteraction: given the server-synced model and a click,
// return the INTENT the UI should carry out. Pure + side-effect-free — it decides *what* the click means from
// state + server data only (never predicts legality); the flag-gated SpectateView branch executes the intent
// against the store senders. This is the ⚖ law structurally: a step target is legal iff the server offered it
// in moveSquareArray, an action is offered iff availableActions() lists it.
//
// A.2 SCOPE: SELECT_PLAYER (click own player → action menu) and MOVE (click a server move square → step,
// click the acting player → End-Move menu). BLOCK/BLITZ/FOUL/PASS click semantics land in their phases.

import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { deriveClientState, isActiveActivation, type ClientStateContext, type ClientStateId } from './clientStateMachine';
import { availableActions, adjacentStandingEnemyIds, adjacentDownEnemyIds, adjacentOwnTeammateIds, serverMoveSquares, sameSquare, normSquare, highKickNomineeIds, canBeBlocked, blockTargetDecorated, playerSideIsHome, passRangeSquares, ttmRangeSquares, kickEmCommitAllowed, blastinTargetIds, type CoachAction } from './availableActions';

export type EndActivationConfirmKind = 'blitz' | 'punt' | 'generic';
export type FriendlyActivationSwitchDisposition = 'refund' | 'end';

// R2: the view projects its richer menu rows through this pure acting-player right-click seam.
export interface RightClickRow { disabled?: boolean; endActivation?: boolean }
/** Owner 09-09 (fork game 947, Ivar / Raiding Party): states where the declared action is still WAITING FOR A
 *  TARGET click on the pitch — a stray right-click on the actor must not silently end the activation. */
export const TARGET_PENDING_STATES: ReadonlySet<ClientStateId> = new Set<ClientStateId>([
  'BLOCK', 'SELECT_BLITZ_TARGET', 'KICK_EM_BLOCK', 'SYNCHRONOUS_MULTI_BLOCK', 'FOUL', 'BOMB', 'THROW_KEG',
  'THROW_TEAM_MATE', 'KICK_TEAM_MATE', 'GAZE', 'HAND_OVER', 'PASS',
]);
export function selectedActingRightClick(rows: ReadonlyArray<RightClickRow>, state?: ClientStateId | '' | null): 'menu' | 'cancel' {
  if (rows.some((row) => !row.disabled && !row.endActivation)) return 'menu';
  return state && TARGET_PENDING_STATES.has(state) ? 'menu' : 'cancel';
}

/** Shared view contract for Blitz-shaped movement controls. The store routes Kick 'Em through ordinary
 * movement while preserving its declaration; its adjacent downed-player terminal is dedicated CLIENT_BLOCK. */
export function isBlitzMovementState(state: ClientStateId | '' | null | undefined): boolean {
  return state === 'BLITZ' || state === 'KICK_EM_BLITZ';
}

/** Every live Blitz-family state whose activation may only be ended through the explicit confirmation card. */
export function requiresBlitzEndConfirmation(state: ClientStateId | '' | null | undefined): boolean {
  return state === 'SELECT_BLITZ_TARGET' || state === 'BLITZ'
    || state === 'KICK_EM_BLITZ' || state === 'PUTRID_REGURGITATION_BLITZ';
}

export type PassActionIdentity = 'pass' | 'hailMaryPass';
export interface SubmittedPassBridge {
  square: [number, number];
  origin: [number, number];
  playerId: string;
  playerAction: string;
  planSeq: number | null;
}
export interface ActivePlanIdentity {
  seq: number;
  playerId: string;
  playerAction: string;
  actKind: string;
}
export interface AcceptedPassPlanSubmission {
  seq: number;
  playerId: string;
  square: [number, number];
}

/** Collapse moving/standing Pass to one rail while keeping Hail Mary Pass distinct. */
export function passActionIdentity(action: unknown): PassActionIdentity | null {
  const value = String(action ?? '');
  if (value === 'pass' || value === 'passMove') return 'pass';
  return value === 'hailMaryPass' ? 'hailMaryPass' : null;
}

/** Presentation-only local pass bridge. A planned target belongs to the exact plan instance until that plan's
 * terminal send is accepted; only that accepted submission may carry it to the canonical server echo. A direct
 * target has no plan id and remains bound to its exact acting player/Pass rail. */
export function projectSubmittedPassBridge(
  bridge: SubmittedPassBridge | null,
  current: {
    playerId: string;
    playerAction: string;
    clientState: string;
    activePlan: ActivePlanIdentity | null;
    acceptedSubmission: AcceptedPassPlanSubmission | null;
  },
): [number, number] | null {
  if (!bridge) return null;
  if (current.activePlan) {
    return current.activePlan.actKind === 'pass'
      && bridge.planSeq === current.activePlan.seq
      && bridge.playerId === current.activePlan.playerId
      && passActionIdentity(bridge.playerAction) === passActionIdentity(current.activePlan.playerAction)
      ? bridge.square
      : null;
  }
  if (bridge.planSeq !== null) {
    const accepted = current.acceptedSubmission;
    return accepted?.seq === bridge.planSeq
      && accepted.playerId === bridge.playerId
      && accepted.square[0] === bridge.square[0]
      && accepted.square[1] === bridge.square[1]
      && current.clientState === 'PASS'
      && current.playerId === bridge.playerId
      && passActionIdentity(current.playerAction) === passActionIdentity(bridge.playerAction)
      ? bridge.square
      : null;
  }
  return current.clientState === 'PASS'
    && current.playerId === bridge.playerId
    && passActionIdentity(current.playerAction) === passActionIdentity(bridge.playerAction)
    ? bridge.square
    : null;
}

/** The roll-cue twin of projectSubmittedPassBridge. Keeping the planned throw origin on the same exact-plan
 * bridge prevents a move-then-pass preview from falling back to the model's pre-walk player coordinate. */
export function projectSubmittedPassPresentation(
  bridge: SubmittedPassBridge | null,
  current: Parameters<typeof projectSubmittedPassBridge>[1],
): { origin: [number, number]; square: [number, number] } | null {
  const square = projectSubmittedPassBridge(bridge, current);
  return bridge && square
    ? { origin: [bridge.origin[0], bridge.origin[1]], square: [square[0], square[1]] }
    : null;
}

/** W27 reacting-move click classification. This does not own a route or send anything: PASS_BLOCK and
 * KICKOFF_RETURN still execute in SpectateView's shared move planner. It makes the newly admitted first-click /
 * same-destination-confirm boundary independently testable while regular-turn clicks retain their old inline
 * predicate byte-for-byte. */
export function reactingMovePlanClick(
  pendingDestination: [number, number] | null,
  clicked: [number, number],
): 'plan' | 'waypoint' | 'confirm' {
  if (!pendingDestination) return 'plan';
  return sameSquare(pendingDestination, clicked) ? 'confirm' : 'waypoint';
}

export type EscCascadePrompt =
  | 'blitzSpecial'
  | 'wisdom'
  | 'endActivation'
  | 'endTurn'
  | 'followup'
  | 'skillChoice'
  | 'reroll';

export interface EscCascadeInput {
  blitzBlockChoiceHeld: boolean;
  /** #310: the target-click blitz-window election card (Frenzied Rush + siblings) — armed LAST relative to
   *  Wisdom (SR-235 newest-armed-wins), so it takes Esc priority when both could theoretically be visible. */
  blitzSpecialPromptVisible: boolean;
  wisdomPromptVisible: boolean;
  endActivationConfirmVisible: boolean;
  endTurnWarnVisible: boolean;
  followupChoiceVisible: boolean;
  ownSkillChoiceVisible: boolean;
  ownRerollPromptVisible: boolean;
  pendingMove: boolean;
  pendingPass: boolean;
  pendingPunt: boolean;
  pendingHandOff: boolean;
  pendingFoul: boolean;
  pendingGaze: boolean;
  thrownMatePending: boolean;
  pendingBlock: boolean;
  aggroStage: 1 | 2 | null;
  contextMenuVisible: boolean;
  gameMenuOpen: boolean;
  settingsOpen: boolean;
  popupVisible: boolean;
  myTurn: boolean;
  actingPlayerId: string | null;
  clientState: ClientStateId | null;
  hasSelection: boolean;
}

export type EscCascadeDecision =
  | { level: 1; kind: 'hold-keep'; closeContextMenu: boolean; wire: 'none' }
  | { level: 1; kind: 'dismiss-prompt'; prompt: EscCascadePrompt; wire: 'none' }
  | { level: 1; kind: 'abort-preview'; wire: 'none' }
  | { level: 1; kind: 'undeclare'; wire: 'end-activation' }
  | { level: 2; kind: 'close-menu'; target: 'context' | 'game-settings' | 'popup'; wire: 'none' }
  | { level: 3; kind: 'ask-end-activation'; confirmKind: EndActivationConfirmKind; wire: 'none' }
  | { level: 3; kind: 'clear-selection'; wire: 'none' }
  | { level: 4; kind: 'game-menu'; wire: 'none' };

/** Pure #48 Escape cascade classification. Effects (including the one legal undeclare wire) stay in the view. */
export function escCascadeDecision(input: EscCascadeInput): EscCascadeDecision {
  // #111: a held Blitz block-flavor choice is committed and cannot be safely aborted with Escape.
  if (input.blitzBlockChoiceHeld) {
    return { level: 1, kind: 'hold-keep', closeContextMenu: input.contextMenuVisible, wire: 'none' };
  }

  if (input.blitzSpecialPromptVisible) return { level: 1, kind: 'dismiss-prompt', prompt: 'blitzSpecial', wire: 'none' };
  if (input.wisdomPromptVisible) return { level: 1, kind: 'dismiss-prompt', prompt: 'wisdom', wire: 'none' };
  if (input.endActivationConfirmVisible) return { level: 1, kind: 'dismiss-prompt', prompt: 'endActivation', wire: 'none' };
  if (input.endTurnWarnVisible) return { level: 1, kind: 'dismiss-prompt', prompt: 'endTurn', wire: 'none' };
  if (input.followupChoiceVisible) return { level: 1, kind: 'dismiss-prompt', prompt: 'followup', wire: 'none' };
  if (input.ownSkillChoiceVisible) return { level: 1, kind: 'dismiss-prompt', prompt: 'skillChoice', wire: 'none' };
  if (input.ownRerollPromptVisible) return { level: 1, kind: 'dismiss-prompt', prompt: 'reroll', wire: 'none' };

  if (input.aggroStage === 2) return { level: 1, kind: 'undeclare', wire: 'end-activation' };
  // A nominated foul target belongs to an already server-declared FOUL activation. Backing out must send the
  // same acting-player-null cancellation as Blitz so the authoritative, still-unspent Foul budget is restored.
  // Pre-declaration previews in other states remain local-only aborts.
  if (input.pendingFoul && input.clientState === 'FOUL') {
    return { level: 1, kind: 'undeclare', wire: 'end-activation' };
  }
  if (input.pendingMove || input.pendingPass || input.pendingPunt || input.pendingHandOff
    || input.pendingFoul || input.thrownMatePending || input.pendingBlock
    || input.aggroStage === 1) {
    return { level: 1, kind: 'abort-preview', wire: 'none' };
  }

  if (input.contextMenuVisible) return { level: 2, kind: 'close-menu', target: 'context', wire: 'none' };
  if (input.gameMenuOpen || input.settingsOpen) return { level: 2, kind: 'close-menu', target: 'game-settings', wire: 'none' };
  if (input.popupVisible) return { level: 2, kind: 'close-menu', target: 'popup', wire: 'none' };

  if (input.pendingGaze) {
    return { level: 3, kind: 'ask-end-activation', confirmKind: 'generic', wire: 'none' };
  }

  if (input.myTurn && input.actingPlayerId && input.clientState && isActiveActivation(input.clientState)) {
    const confirmKind: EndActivationConfirmKind = input.clientState === 'BLITZ' ? 'blitz'
      : input.clientState === 'PUNT' ? 'punt' : 'generic';
    return { level: 3, kind: 'ask-end-activation', confirmKind, wire: 'none' };
  }
  if (input.hasSelection) return { level: 3, kind: 'clear-selection', wire: 'none' };

  return { level: 4, kind: 'game-menu', wire: 'none' };
}

export type Interaction =
  /** Open the action menu for a player (content already resolved from availableActions). */
  | { kind: 'openActionMenu'; playerId: string; actions: CoachAction[] }
  /** Step the acting player to a server-offered move square. */
  | { kind: 'step'; toSquare: [number, number] }
  /** Send a server-offered square through the existing clientFieldCoordinate wire. */
  | { kind: 'fieldCoordinate'; square: [number, number] }
  /** Swoop: choose one exact server-offered cardinal coordinate. Both field clicks and clicks on a player
   *  occupying that coordinate produce this same intent; consumers send CLIENT_SWOOP without transforming it. */
  | { kind: 'swoopCoordinate'; square: [number, number] }
  /** A.3: block the clicked adjacent enemy (the acting player is in the BLOCK state).
   *  #181 Wave B (Meero SR-148, PL-1): optional `blockKind` carries a star block-VARIANT flag (Putrid Regurgitation
   *  → 'vomit', The Flashing Blade → 'stab'). ABSENT MEANS ABSENT — no default, no inference: the consumer maps a
   *  present kind through the existing `blockFlagsFromKind`/`o66BlockFlags` helper, and an absent one sends a plain
   *  flagless block. ⚠ Vicious Vines stays flagless ON PURPOSE — it is action-driven (the server has no VINES
   *  block-kind; it resolves the vine off `playerAction === 'viciousVines'`), whereas Putrid/Flashing Blade are
   *  FLAG-driven (the server dispatches the block-kind off USING_VOMIT/USING_STAB, `StepInitSelecting`). Do NOT
   *  "fix" that asymmetry by giving Vines a kind — a plain block IS the correct vine send. */
  | { kind: 'block'; defenderId: string; blockKind?: 'vomit' | 'stab' | 'chainsaw' }
  /** #58: TOGGLE a defender in/out of the SYNCHRONOUS Multiple Block selection (SYNCHRONOUS_MULTI_BLOCK state).
   *  The store sequences SET/UNSET + auto-commits at 2 and owns the isBlockable + dice-decoration SET gate (ML-8). */
  | { kind: 'multiBlockToggle'; defenderId: string }
  /** A.4: nominate the blitz target (SELECT_BLITZ_TARGET) — wire `targetSelected{playerId}`. */
  | { kind: 'targetSelected'; defenderId: string }
  /** A.4: step the blitzing player toward contact (BLITZ) — dedicated `clientBlitzMove`, NOT clientMove. */
  | { kind: 'blitzStep'; toSquare: [number, number] }
  /** g478 #1: HIGH_KICK — nominate an eligible own player to be moved onto the ball's landing square
   *  (wire `clientSetupPlayer{playerId, coordinate=ballCoordinate}`); the SpectateView resolves the coord. */
  | { kind: 'highKickNominate'; playerId: string }
  /** A.5 (o66j #8): FOUL the clicked adjacent DOWN enemy — wire `clientFoul{defenderId}` (state = FOUL). */
  | { kind: 'foulTarget'; defenderId: string }
  /** Star S8 (KE-1): Kick 'em — chainsaw the clicked ADJACENT PRONE/STUNNED enemy. Deliberately NOT
   *  the shared 'block' kind: sendBlock's downed-defender guard is correct for every other block, so this rides
   *  its own store sender (plain CLIENT_BLOCK, usingChainsaw:true). Kick Em Blitz approaches on the shared Blitz
   *  movement rail; its adjacent terminal is presented by the store-owned target rail. */
  | { kind: 'kickEmBlock'; defenderId: string }
  /** Star S8: Blastin' target commit (THEN_I_STARTED_BLASTIN) — wire `clientTargetSelected{playerId}`. */
  | { kind: 'blastinTarget'; targetId: string }
  /** A.5 (o66j #8): HAND-OFF to the clicked adjacent own teammate — wire `clientHandOver{catcherId}`. */
  | { kind: 'handOverTarget'; catcherId: string }
  /** A.5 (o66j #8): PASS to the clicked square (a player's square or open ground in range) —
   *  wire `clientPass{targetCoordinate}`; the server resolves the throw + any interception. */
  | { kind: 'passTarget'; square: [number, number] }
  /** Optional friendly-player switch. `refund` means the server still exposes its clean undo boundary; `end`
   * means authoritative progress has been consumed, so the clicked player must not be auto-declared. */
  | { kind: 'switchFriendlyActivation'; playerId: string; actions: CoachAction[]; disposition: FriendlyActivationSwitchDisposition }
  /** Implicit deselection: clicking the acting player with no declare available ends the activation
   *  (clientActingPlayer{null}) — an AWT click behaviour, not a menu item (req #3). */
  | { kind: 'endMove' }
  /** Owner 09-09 (fork game 947, Ivar after Raiding Party): a self LEFT-click while a BLOCK-family target is still
   *  pending re-surfaces the "Pick Block Target" pill instead of the AWT end-activation; End Activation stays in
   *  the right-click menu. Presentation-only divergence (no wire). */
  | { kind: 'targetPending'; playerAction: string }
  /** Read-only opponent inspection during a movement activation. The view keeps the actor and plan authoritative. */
  | { kind: 'inspect'; playerId: string }
  /** Nothing to do (with an optional reason for the dev log / a rejection toast). */
  | { kind: 'ignore'; reason?: string };

/**
 * WALK states: the actor can still step server move squares while the action is declared — the AWT DELEGATE
 * mechanism (req #1), where PASS/HAND_OVER/PUNT/FOUL re-dispatch field clicks to the MOVE handler WITHOUT a
 * state switch. A.2 only exercises MOVE, but the seam exists so the retrofit is free when those phases land.
 */
// #116: HIT_AND_RUN is also a walk state — after a block, the actor steps the server's move-away squares. It
// enters via a DISTINCT wire command though: the fork's StepHitAndRun accepts ONLY clientFieldCoordinate (per
// square) + clientEndTurn, NOT clientMove — so the store's o66Move sends clientFieldCoordinate under turnMode
// 'hitAndRun' (the pure step intent is identical; only the command the store emits differs).
const WALK_STATES = new Set<ClientStateId>([
  'MOVE', 'PASS', 'HAND_OVER', 'PUNT', 'FOUL', 'HIT_AND_RUN',
  // ClientStatePassBlock.java:32 + PassBlockLogicModule.java:43-48: shared move state; only a server MoveSquare steps.
  'PASS_BLOCK',
  // ClientStateKickoffReturn.java:30 + KickoffReturnLogicModule.java:39-44: identical server-MoveSquare step surface.
  'KICKOFF_RETURN',
]);

/** Movement-capable declared actions whose otherwise-inert opponent clicks are read-only inspections. Target
 * branches stay ahead of this fallback, so block/foul/gaze/pass/TTM clicks retain their existing meaning. */
const OPPONENT_INSPECTION_STATES = new Set<ClientStateId>([
  ...WALK_STATES,
  'BLITZ', 'GAZE_MOVE',
]);

/** Friendly-player switching is deliberately limited to declared movement rails where another friendly token is
 * not itself a terminal target. PASS/HAND_OVER/TTM keep their receiver/mate click semantics. */
const FRIENDLY_SWITCH_STATES = new Set<ClientStateId>(['MOVE', 'BLITZ', 'SELECT_BLITZ_TARGET', 'FOUL', 'GAZE_MOVE']);

/** SR-244 RG-3: declared-action states which do not reach the shared WALK self-click/menu branch. Keep this
 *  explicit: MAXIMUM_CARNAGE is server-derived, has END_MOVE only upstream, and must remain a bare endMove. */
const NON_WALK_DECLARED_ACTION_STATES = new Set<ClientStateId>([
  'BLITZ', 'BLOCK', 'SYNCHRONOUS_MULTI_BLOCK', 'SELECT_BLITZ_TARGET', 'BOMB', 'THROW_KEG',
  'THROW_TEAM_MATE', 'KICK_TEAM_MATE', 'GAZE', 'GAZE_MOVE', 'PUTRID_REGURGITATION_BLITZ', 'KICK_EM_BLITZ',
  'KICK_EM_BLOCK', // Star S8: block-family self-click menu (KickEmBlockLogicModule inherits Block's actionContext)
]);

const STEP_ECHO_DEBOUNCE_MS = 350;
const PLAYER_BASE_STANDING = 1;
const PLAYER_BASE_MOVING = 2;
const PLAYER_FLAG_ACTIVE = 0x100;
let stepEchoGuard: { square: [number, number]; arrivedAt?: number } | null = null;

/**
 * SR-247: the router is the only place that observes the step-send trigger, so this module-level guard and clock
 * are a deliberate, documented exception to this file's pure/side-effect-free header. The guard lives while the
 * model says the acting player is still travelling to the destination, then for 350ms after arrival is first
 * observed. A missing/downed actor disarms it so a failed dodge/GFI cannot leave a permanent guard. Accepted
 * residual: a deliberate "step then immediately end on the actor's square" inside that grace is swallowed; click
 * again after the window. This is by design: do not narrow the destination-square-only guard.
 */
function consumeStepEcho(game: GameJson, square: [number, number]): boolean {
  const guard = stepEchoGuard;
  if (!guard) return false;
  if (!sameSquare(guard.square, square)) {
    stepEchoGuard = null;
    return false;
  }

  const actingId = actingPlayerId(game);
  const acting = (game.fieldModel?.playerDataArray ?? [])
    .find((d) => (d as { playerId?: string }).playerId === actingId) as
      { playerCoordinate?: unknown; playerState?: number } | undefined;
  const actingSquare = normSquare(acting?.playerCoordinate);
  const baseState = (acting?.playerState ?? 0) & 0xff;
  if (!actingId || !actingSquare || (baseState !== PLAYER_BASE_STANDING && baseState !== PLAYER_BASE_MOVING)) {
    stepEchoGuard = null;
    return false;
  }

  if (!sameSquare(actingSquare, guard.square)) return true;

  const now = Date.now();
  guard.arrivedAt ??= now;
  if (now - guard.arrivedAt <= STEP_ECHO_DEBOUNCE_MS) return true;

  stepEchoGuard = null;
  return false;
}

function armStepEcho(square: [number, number]): void {
  stepEchoGuard = { square };
}

function actingPlayerId(game: GameJson): string {
  return String((game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
}

/** Shared Swoop coordinate election. The server's moveSquareArray is the legal set; the cardinal/adjacent and
 * pitch-bounds checks mirror upstream SwoopLogicModule's final client guard and keep malformed/stale snapshots
 * from producing wire commands. Coordinates remain in the recipient's server frame (away-seat transformation is
 * performed by StepSwoop), so this function never mirrors or predicts the eventual landing square. */
export function swoopCoordinateIntent(
  game: GameJson | null | undefined,
  ctx: ClientStateContext,
  square: [number, number],
): Interaction {
  if (!game || deriveClientState(game, ctx) !== 'SWOOP') return { kind: 'ignore', reason: 'not awaiting a Swoop coordinate' };
  const [x, y] = square;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 25 || y < 0 || y > 14) {
    return { kind: 'ignore', reason: 'Swoop coordinate is out of bounds' };
  }
  const acting = actingPlayerId(game);
  const source = normSquare((game.fieldModel?.playerDataArray ?? [])
    .find((data) => (data as { playerId?: string }).playerId === acting)?.playerCoordinate);
  if (!acting || !source) return { kind: 'ignore', reason: 'Swoop acting player has no pitch coordinate' };
  const dx = Math.abs(source[0] - x);
  const dy = Math.abs(source[1] - y);
  if (dx + dy !== 1) return { kind: 'ignore', reason: 'Swoop coordinate is not cardinally adjacent' };
  if (!serverMoveSquares(game).some((offered) => sameSquare(offered, square))) {
    return { kind: 'ignore', reason: 'Swoop coordinate is not in the current server moveSquareArray' };
  }
  return { kind: 'swoopCoordinate', square: [x, y] };
}

/** Exact Swoop affordance set shared by Modern and Classic, including reconnect directly into SWOOP. */
export function swoopCoordinateSquares(
  game: GameJson | null | undefined,
  ctx: ClientStateContext,
): [number, number][] | null {
  if (!game || deriveClientState(game, ctx) !== 'SWOOP') return null;
  return serverMoveSquares(game).filter((square) => swoopCoordinateIntent(game, ctx, square).kind === 'swoopCoordinate');
}

/** Classify a requested friendly-player switch from server truth. An untouched declaration (including a paid
 * stand-up and nothing else) is refundable upstream; any movement/action/skill/effect consumption ends the
 * activation without auto-declaring the clicked player. Action-specific friendly targets are excluded by the
 * explicit state set above, so this never steals a Pass, Hand-off, or Throw Team-Mate click. */
export function friendlyActivationSwitchDisposition(
  game: GameJson | null | undefined,
  ctx: ClientStateContext,
  clickedPlayerId: string,
): FriendlyActivationSwitchDisposition | null {
  if (!game || !ctx.friendlyPlayerSwitch) return null;
  const state = deriveClientState(game, ctx);
  if (!FRIENDLY_SWITCH_STATES.has(state)) return null;
  const acting = game.actingPlayer as {
    playerId?: string | null; playerAction?: string | null; currentMove?: number; standingUp?: boolean;
    hasMoved?: boolean; hasFouled?: boolean; hasBlocked?: boolean; hasPassed?: boolean; hasFed?: boolean;
    hasJumped?: boolean; hasTriggeredEffect?: boolean; forgone?: boolean; usedSkills?: unknown[];
  } | undefined;
  const currentId = String(acting?.playerId ?? '');
  if (!acting || !currentId || currentId === clickedPlayerId) return null;

  const clicked = (game.fieldModel?.playerDataArray ?? [])
    .find((data) => (data as { playerId?: string }).playerId === clickedPlayerId) as { playerState?: number } | undefined;
  const playerState = Number(clicked?.playerState);
  const myIsHome = ctx.myIsHome ?? true;
  if (playerSideIsHome(game, clickedPlayerId) !== myIsHome
      || !Number.isFinite(playerState)
      || (playerState & 0xff) !== PLAYER_BASE_STANDING
      || (playerState & PLAYER_FLAG_ACTIVE) === 0) return null;
  const currentMove = Number(acting.currentMove ?? 0);
  const standUpOnly = acting.standingUp === true && currentMove === 3;
  const consumed = (currentMove !== 0 && !standUpOnly)
    || !!acting.hasMoved || !!acting.hasFouled || !!acting.hasBlocked || !!acting.hasPassed || !!acting.hasFed
    || !!acting.hasJumped || !!acting.hasTriggeredEffect || !!acting.forgone
    || (acting.usedSkills?.length ?? 0) > 0;
  return consumed ? 'end' : 'refund';
}

/** Backwards-compatible sender guard for the existing direct pristine-Move replacement. */
export function canSwitchMoveActingPlayer(
  game: GameJson | null | undefined,
  ctx: ClientStateContext,
  clickedPlayerId: string,
): boolean {
  if (!game || deriveClientState(game, ctx) !== 'MOVE') return false;
  const switchCtx = { ...ctx, friendlyPlayerSwitch: true };
  return friendlyActivationSwitchDisposition(game, switchCtx, clickedPlayerId) === 'refund';
}

/** PC-1 (Meero SR-211, PC-1 row): a pass target is routable only when it sits in the bb2025 pass-range TEMPLATE
 *  (`passRangeSquares` — the same reach the surface arms). ⚖ only-surface-what-the-server-offers: an out-of-range
 *  CLIENT_PASS is a send upstream's client cannot emit, so gate it HERE so the out-of-range throw dies at source
 *  rather than reaching `sendPassTarget`. `from` = the acting passer's square. */
export function passTargetInTemplate(game: GameJson, actingId: string, target: [number, number]): boolean {
  // ⚠ HAIL MARY carve-out (Nom Anor adversarial review of PC-1; SR-217/SR-229 sibling omission): `hailMaryPass`
  // shares ClientStateId 'PASS' and `hailMaryBomb` shares ClientStateId 'BOMB', so both reach this gate — but by
  // rule each may target ANY on-pitch square (unlimited range; the bb2025 throwing-range table does NOT bound it
  // and the server accepts the far throw). Range-gating either would silently DROP a legal declared Hail Mary.
  // The template gate applies ONLY to standard pass/passMove; a hailMaryPass or hailMaryBomb click (always a real
  // pitch square) is always routable. The carve-out previously covered hailMaryPass only (SR-217/SR-229).
  if (['hailMaryPass', 'hailMaryBomb'].includes(String((game.actingPlayer as { playerAction?: string } | undefined)?.playerAction ?? ''))) return true;
  const ap = (game.fieldModel?.playerDataArray ?? []).find((d) => (d as { playerId?: string }).playerId === actingId) as { playerCoordinate?: unknown } | undefined;
  const from = normSquare(ap?.playerCoordinate);
  if (!from) return false;
  return passRangeSquares(game, from).some((s) => sameSquare(s, target));
}

/** Stable owner for one server TTM/KTM activation. It deliberately excludes mutable movement/target fields so a
 * reconnect or delayed frame from the cancelled activation cannot manufacture a fresh targeting instance. */
export function ttmActivationKey(game: GameJson | null | undefined): string | null {
  const acting = game?.actingPlayer as { playerId?: unknown; playerAction?: unknown } | undefined;
  const playerId = String(acting?.playerId ?? '');
  const rawAction = String(acting?.playerAction ?? '').replace(/[^a-z]/gi, '').toLowerCase();
  const action = rawAction.startsWith('throwteammate') ? 'throwTeamMate'
    : rawAction.startsWith('kickteammate') ? 'kickTeamMate' : '';
  if (!playerId || !action) return null;
  const turnData = game?.homePlaying ? game?.turnDataHome : game?.turnDataAway;
  return [game?.gameId ?? '', game?.half ?? '', game?.homePlaying ? 'home' : 'away',
    (turnData as { turnNr?: unknown } | undefined)?.turnNr ?? '', playerId, action].join(':');
}

export type ThrowTeamMateTerminalReason = 'landing' | 'failed-landing' | 'fumble' | 'ejection';

/** Report-owned terminal edge for the TTM targeting rail. The target command is sent before the throw/landing
 * chain, while the server can retain the same acting action until that chain finishes. These reports are the
 * authoritative point at which a stale ruler/target surface must be impossible to resurrect. */
export function throwTeamMateTerminalReason(
  reports: readonly Record<string, unknown>[] | null | undefined,
): ThrowTeamMateTerminalReason | null {
  for (const report of reports ?? []) {
    const reportId = String(report.reportId ?? '');
    if (reportId === 'rightStuffRoll') return report.successful === false ? 'failed-landing' : 'landing';
    if (reportId === 'injury' && String(report.injuryType ?? '').replace(/[^a-z]/gi, '').toLowerCase() === 'ttmlanding') {
      return 'failed-landing';
    }
    if (reportId === 'scatterPlayer' && report.outOfBounds === true) return 'ejection';
    if (reportId === 'throwTeamMateRoll') {
      const result = String(report.passResult ?? '').replace(/[^a-z]/gi, '').toLowerCase();
      if (report.fumble === true || result.includes('fumble')) return 'fumble';
    }
  }
  return null;
}

export type TtmCancellationDecision = 'cancel-and-end' | 'already-cancelled' | 'ignore';

/** Right-click cancellation policy for a held TTM destination. The view owns presentation teardown; this pure
 * guard ensures one authoritative activation-end attempt, no passive/off-turn send, and deterministic re-entry
 * when a later activation has a different stable key. */
export function ttmCancellationDecision(input: {
  isPlaying: boolean;
  myTurn: boolean;
  controlsActingPlayer: boolean;
  activationKey: string | null;
  cancelledKeys: ReadonlySet<string>;
  hasLocalTarget: boolean;
}): TtmCancellationDecision {
  if (!input.isPlaying || !input.myTurn || !input.controlsActingPlayer || !input.activationKey) return 'ignore';
  if (input.cancelledKeys.has(input.activationKey)) return 'already-cancelled';
  return input.hasLocalTarget ? 'cancel-and-end' : 'ignore';
}

/** TTM/KTM uses only the Quick + Short portion of the regular throwing template. */
export function ttmTargetInTemplate(game: GameJson, actingId: string, target: [number, number]): boolean {
  const ap = (game.fieldModel?.playerDataArray ?? []).find((d) => (d as { playerId?: string }).playerId === actingId) as { playerCoordinate?: unknown } | undefined;
  const from = normSquare(ap?.playerCoordinate);
  return !!from && ttmRangeSquares(game, from).some((square) => sameSquare(square, target));
}

/** spec-252 R-1 (Free-Select Pass, B-4 offerability): may the view surface "Throw Pass (Free Select)"? True iff the
 *  acting side is in a live PASS client state — the SAME derive the router (onPlayerClick/onSquareClick) gates the
 *  standard pass on, so the free-select surface can never outlive the server-offered pass action (⚖ only-surface-
 *  what-the-server-offers). deriveClientState==='PASS' is inherently my-turn/acting-scoped (clientStateMachine's
 *  `if (!iAmActing) return findPassiveState`), so no separate isMyTurn is needed. PURE: game+ctx in, boolean out —
 *  Echo-testable, no store coupling. The view still gates each free-select TARGET on `passTargetInTemplate`
 *  (in-template + Hail-Mary exemption), and the throw stays possession-gated by store `sendPassTarget` (#233). */
export function canFreeSelectPass(game: GameJson | null | undefined, ctx: ClientStateContext): boolean {
  return !!game && deriveClientState(game, ctx) === 'PASS';
}

/** P1 (owner live g870, 2026-08-18) — PASS-AT-REST THROW-SURFACE ARM.
 *
 *  A declared `passMove` walker who SPENDS HIS WHOLE BUDGET (MA + both rushes) has an EMPTY client walk reach.
 *  `o66MoveSquares` then returns `[]`, the SpectateView arm-watch falls into its empty-reach else-branch, and
 *  `renderer.setTilePick(false)` tears the WHOLE tile-pick surface down — including the pass-range template. The
 *  renderer only dispatches `onTilePick` while `tilePickActive` (renderer.ts pointerup), so from that moment NO
 *  pitch square routes anywhere: the passer is holding the ball, the server is still publishing
 *  `actingPlayer{playerAction:'passMove'}` + move squares, and the coach's only remaining affordance is End
 *  Activation. Wire g870 22:13:27.361 (`playerResultSetRushing=2`, `actingPlayerSetCurrentMove=4`) is exactly
 *  that state; the coach then sent two `clientActingPlayer{null}` bails at 22:13:33/34.
 *
 *  ⚖ only-surface-what-the-server-offers is UNCHANGED: this arms the same bb2025 range template the standing
 *  passer already gets (owner o66r "Show pass template"), and every target still passes `passTargetInTemplate`
 *  plus store `sendPassTarget`'s #233 possession gate. It does NOT contradict the owner 08-12 ruling that
 *  suppresses the range TINT "while a declared Pass is WALKING" — a passer with zero budget is not walking, he is
 *  AT REST, which is precisely the case that ruling arms.
 *
 *  Same guard-clear-scope class as the AYCE stationary-bomber re-arm (SpectateView, `bombSt === 'BOMB'`): a
 *  surface armed only on the state-ENTER edge dies at the first empty-reach update and never comes back. BOMB got
 *  the twin; PASS did not.
 *
 *  PURE: game + ctx + the already-computed walk-reach square COUNT in, boolean out (Echo-testable, no renderer or
 *  store coupling). Hail Mary is excluded — it rides the unrestricted raw-pick rail and suppresses the template. */
export function passAtRestArmRequired(
  game: GameJson | null | undefined,
  ctx: ClientStateContext,
  walkReachSquareCount: number,
): boolean {
  if (!game) return false;
  if (deriveClientState(game, ctx) !== 'PASS') return false;
  if (String((game.actingPlayer as { playerAction?: string } | undefined)?.playerAction ?? '') === 'hailMaryPass') return false;
  return walkReachSquareCount === 0;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// #173 (owner P1) — ACTION-SURFACE LOCK: no actions while an OPPONENT choice is pending.
//
// ⚖ server-derived: the whole decision keys off `deriveClientState` (which keys off the SERVER's
// `waitingForOpponent`, set by `UtilServerDialog.showDialog` with the server-COMPUTED
// `!actingTeam.hasPlayer(player)`). We withhold a client affordance; we never predict a server outcome.
//
// WHY THE DECISION LIVES HERE (pure) AND NOT IN THE VIEW (Echo, SR-94 ⑤): `SpectateView` is `<script setup>`
// (internals unexportable) and `apps/tauri` has NO test surface — a guard inlined there is structurally
// un-drift-testable. Keeping the DECISION pure makes it mutation-provable in ffb-protocol and leaves the view a
// one-line consult. Corollary (Meero OL-2): the classification must be decided HERE ONCE, not re-judged at each
// consult site — that per-site judgement is the SR-56 EC-1c drift class.
//
// ⚠ HISTORY — two earlier placements were UNREACHABLE (don't regress to them): a gate inside `availableActions`
// is dead (its only callers are already state-gated away from WAIT), and a gate in this module's routers is
// belt-and-braces (they already default-deny WAIT). The LEAKING sites are the view's pre-router branches +
// un-routed HUD buttons — they are what must consult this.

/** What a coach affordance is asking to do. */
export type ActionClass =
  /** Declare/act: anything that sends a game command (End Turn, confirm move, block commit, …). */
  | 'declare'
  /** Answering a dialog the SERVER addressed to ME (skill-use, re-roll, send-off argue/bribe, player pick …). */
  | 'answerOwnDialog'
  /** Call Time-Out (our button sends CLIENT_ILLEGAL_PROCEDURE — `store.ts callTimeout`).
   *  ⚖ IP-1 (Meero SR-97, re-homing MY mis-scoped cite): do NOT justify this with the CLIENT-side
   *  `ClientStateWaitForOpponent.actionKeyPressed` mapping — that is exact for `WAIT` only, and Kallus caught it
   *  being silently inherited when `LOCKED_STATES` grew to two (`ClientStateWaitForSetup` extends
   *  `ClientStateAwt` with NO override, so upstream's client offers no Call Time-Out during the opponent's
   *  setup). The load-bearing authority is SERVER-side and covers both members:
   *  `AbstractStep.handleCommand:105-120` dispatches `CLIENT_ILLEGAL_PROCEDURE` from the BASE step class — i.e.
   *  admissible at EVERY step, setup included — and `handleIllegalProcedure:287-299` gates the EFFECT on the
   *  server's own `game.isTimeoutPossible()`. (Verified at [SOURCE]; the same base switch also admits
   *  CLIENT_CONCEDE_GAME, which is why concede is likewise never gated here.)
   *  ⚖ IP-2 — the divergence, stated: upstream's CLIENT withholds this during opponent setup; we permit it. That
   *  is NOT "betterment" (my earlier framing, which Meero corrected) — it is ⚖ COMPLIANCE. The server admits the
   *  command at any step and decides its effect itself, so a client that withheld the affordance would be
   *  PREDICTING a server-owned outcome, which is the thing server-derived-law forbids. */
  | 'illegalProcedure';

/** STABLE enum, never prose (Meero OL-4): this rides in a golden-serialisable payload, so re-wording it would
 *  break the drift tooth and train fixture re-blessing. Presentation maps it to text. */
export type LockReason =
  /** MY turn, but the server is waiting on the OPPONENT's choice — #173's target case. */
  | 'waitingForOpponent'
  /** The opponent's turn (or my own passive wait). Locked too — see the OL-3 scope note below. */
  | 'opponentTurn';

export interface ActionSurfaceLock {
  /** true ⇒ the view must suppress every affordance whose class is NOT in `permitted`. */
  locked: boolean;
  reason: LockReason | null;
  /** Classes still allowed. Plain sorted data ⇒ golden-serialisable. */
  permitted: ActionClass[];
}

const ALL_CLASSES: ActionClass[] = ['answerOwnDialog', 'declare', 'illegalProcedure'];

/** The PASSIVE states in which the coach must not declare/act. Echo caught `WAIT_SETUP` missing from the first
 *  cut: during the OPPONENT's setup (`clientStateMachine:147/148`, the `!iAmActing` limbs of
 *  setup/perfectDefence/solidDefence) the derive is `'WAIT_SETUP'`, and leaving it out kept the un-routed HUD
 *  (End Turn / confirm move) live and SENDING — the identical defect class to the P1, one phase over.
 *  ⚠ Safe by inspection: MY OWN setup derives `'SETUP'`/`'SOLID_DEFENCE'` (the `iAmActing` limbs), which are NOT
 *  in this set, so a coach setting up his own team is untouched. Both members carry the same `permitted` set, so
 *  the OL-1 `answerOwnDialog` escape is reachable from either (a defender can hold his own dialog under
 *  `WAIT_SETUP` too — Echo's compounding case). */
const LOCKED_STATES = new Set<ClientStateId>(['WAIT', 'WAIT_SETUP']);

/** Who owns the ONE live dialog. [SOURCE]: the server is single-dialog — `UtilServerDialog.showDialog` does
 *  `game.setDialogParameter(dlg)` (single-valued), so ownership is answerable from the MODEL. Meero OL-1
 *  requires keying off exactly this, NOT a client-side arm that can outlive `hideDialog`. */
function liveDialogOwner(game: GameJson, myIsHome: boolean): 'me' | 'opponent' | 'unknown' | 'none' {
  const dp = game.dialogParameter as { playerId?: unknown; choosingTeamId?: unknown } | null | undefined;
  if (!dp) return 'none';
  // Player-addressed dialogs (skillUse / reRoll / follow-up / send-off …) carry the asked player's id.
  if (typeof dp.playerId === 'string' && dp.playerId) {
    const side = playerSideIsHome(game, dp.playerId);
    if (side === null) return 'unknown';
    return side === myIsHome ? 'me' : 'opponent';
  }
  // Team-addressed dialogs (the blockRoll family) carry `choosingTeamId` (mirrors store.ts:2582).
  if (typeof dp.choosingTeamId === 'string' && dp.choosingTeamId) {
    const myTeam = (myIsHome ? game.teamHome : game.teamAway) as { teamId?: string } | undefined;
    const myTid = myTeam?.teamId;
    if (!myTid) return 'unknown';
    return dp.choosingTeamId === myTid ? 'me' : 'opponent';
  }
  // FO-1a (Meero): a live dialog carrying NEITHER owner key lands here and silently joins the permitted set.
  // Make it observable, so a dialog type added later is visible instead of quietly widening the fail-open.
  // Deduped by dialogId so a per-frame re-derive can't spam the console.
  reportUnknownDialogOwner(String((dp as { dialogId?: unknown }).dialogId ?? '<no dialogId>'));
  return 'unknown';
}

/** FO-1a observability sink. Kept side-effect-light + dedup'd so `actionSurfaceLock` stays safe to call per
 *  frame; `order66Interaction` is otherwise PURE, so this is the one deliberate exception and it only ever
 *  WARNS (never mutates game state, never changes the return value). */
const seenUnknownDialogOwners = new Set<string>();
function reportUnknownDialogOwner(dialogId: string): void {
  if (seenUnknownDialogOwners.has(dialogId)) return;
  seenUnknownDialogOwners.add(dialogId);
  console.warn(`[#173] dialog '${dialogId}' carries neither playerId nor choosingTeamId — ownership indeterminate, `
    + 'answerOwnDialog permitted (fail-open). Classify it if this is a real answerable dialog.');
}

/**
 * #173: may the view offer its action surface, and what survives the lock?
 *
 * ⭐ OL-1 (Meero, the case that decides the shape): `waitingForOpponent` is synced to BOTH clients, so the
 * DEFENDER being asked Stand Firm / Steady Footing ALSO derives 'WAIT' (`iAmActing` false → `findPassiveState`
 * → no pushback squares → 'WAIT') — i.e. he is locked WHILE HE IS THE DECIDER. If his answer control were
 * suppressed the server would sit on `waitingForOpponent` forever: a HARD WEDGE, strictly worse than the bug.
 * Hence `answerOwnDialog` is an explicit permission in the RETURN VALUE, not something each call site re-judges.
 *
 * ⚠ FAIL-OPEN, NARROWLY (Meero FO-1 — the implementation is right, the FIRST justification I gave was WRONG and
 * is corrected here): when a dialog is live but ownership is INDETERMINATE we still permit the answer. The
 * rationale is NOT "an unhandled command is harmless" — that premise is false and my own #173 spec refutes it
 * (`store.ts:5971-5976`: a premature clientPushback NPEs StepPushback and CLOSES THE GAME; the
 * server-wedge-catalog exists for exactly that). Left standing it would justify weakening other gates.
 * The correct, narrower reason: this fail-open is scoped to `answerOwnDialog` — a reply to a dialog the SERVER
 * ITSELF raised and is actively waiting on, therefore admissible by construction at that step — and it is NEVER
 * granted to `declare`. A wrongly-BLOCKED answer is the OL-1 wedge; a permitted answer to a live server dialog
 * is what the server is asking for.
 *
 * OL-3 SCOPE (stated, per Meero): `locked` covers (a) my turn with the server waiting on the opponent (#173's
 * target), (b) the opponent's whole turn, and (c) the opponent's SETUP (`WAIT_SETUP`). (b)+(c) are a deliberate
 * expansion beyond the
 * ticket: a declare during the opponent's turn is exactly as swallowed as one mid-reactive. What a coach
 * legitimately does in (b) stays available: answering his own reactive prompts (`answerOwnDialog`, which is how
 * the #166 auto-answer paths keep working), Call Time-Out (`illegalProcedure`), and — by NOT being consulted at
 * all — chat, settings, camera, the log, and CONCEDE. Only `declare` is withheld, so this is "no ACTIONS on the
 * opponent's turn", never "the client is dead".
 */
export function actionSurfaceLock(
  game: GameJson | null | undefined,
  ctx: ClientStateContext,
): ActionSurfaceLock {
  if (!game) return { locked: false, reason: null, permitted: ALL_CLASSES };
  // ⚖ the DERIVED state, never the raw `waitingForOpponent` flag (Meero-verified): the Side-Step / chain-push
  // DEFENDER has the raw flag true from the ATTACKER's frame but derives PUSHBACK, and must keep his pick.
  // Gating on the derive inherits that carve-out for free; raw-flag gating would break his only answer path.
  const state = deriveClientState(game, ctx);

  // spec-199 R-D1: PUSHBACK is a live server dialog, not a free surface. It is NOT a LOCKED_STATES member, so it
  // fell through to `locked:false, permitted: ALL_CLASSES` below — OVER-GRANTING `declare` while the server is
  // parked in StepPushback waiting for the pick. An un-routed declare (End Turn / confirm) sent there hits a step
  // that accepts only CLIENT_PUSHBACK ⇒ the server-wedge class. Lock it: withhold `declare`, keep `answerOwnDialog`
  // (CLIENT_PUSHBACK is answerOwnDialog-class ⇒ the pick STILL sends — g333 pick-still-sends) + `illegalProcedure`
  // (Call Time-Out / concede are server-admissible at every step). The chooser is the attacker (my turn) or the
  // Side-Step defender (opponent's turn from my frame); `reason` follows iAmActing, mirroring the main return.
  // Kallus measured (inbox L1461): a client CANNOT hold a live pushback surface AND be a LOCKED_STATES member, so
  // this is the SOLE locked entry point for PUSHBACK — no double-lock, and the Side-Step defender's pick survives.
  if (state === 'PUSHBACK') {
    const iAmActingPb = !!game.homePlaying === (ctx.myIsHome ?? true);
    const permitted: ActionClass[] = ['answerOwnDialog', 'illegalProcedure'];
    permitted.sort(); // stable order for the golden payload
    return { locked: true, reason: iAmActingPb ? 'waitingForOpponent' : 'opponentTurn', permitted };
  }

  if (!LOCKED_STATES.has(state)) return { locked: false, reason: null, permitted: ALL_CLASSES };

  const myIsHome = ctx.myIsHome ?? true;
  const iAmActing = !!game.homePlaying === myIsHome;
  const owner = liveDialogOwner(game, myIsHome);

  const permitted: ActionClass[] = ['illegalProcedure'];
  if (owner === 'me') {
    permitted.push('answerOwnDialog');
  } else if (owner === 'unknown') {
    // spec-199 R-C1 (SR-188 RG-4): narrow the ownerless fail-open. A dialog reaching 'unknown' carries neither
    // playerId nor choosingTeamId (FO-1a). `followupChoice` is one such — DialogFollowupChoiceParameter extends
    // DialogWithoutParameter (verified upstream) — but it is SINGLE-SEAT: the follow-up-after-block belongs to
    // the ACTING side only. Failing open there wrongly hands the NON-acting seat an answer control the server
    // never addressed to it, so gate it on iAmActing (OWNER-GATED, not fail-CLOSED — the true owner keeps it).
    // The MUTUAL ownerless dialogs (penaltyShootout coin-toss, informationOkay) are answerable by EITHER seat
    // and stay fail-OPEN, as does any UNENUMERATED ownerless dialog — NEVER fail-CLOSED (RG-4/FO-1: a wrongly-
    // blocked answer to a live server dialog is the OL-1 hard wedge). reportUnknownDialogOwner still makes the
    // unenumerated case observable, so a newly-added single-seat dialog gets classified rather than silently
    // over-granted forever.
    const dialogId = String((game.dialogParameter as { dialogId?: unknown } | null | undefined)?.dialogId ?? '');
    if (dialogId === 'followupChoice') {
      if (iAmActing) permitted.push('answerOwnDialog');
    } else {
      permitted.push('answerOwnDialog');
    }
  }
  permitted.sort(); // stable order for the golden payload

  return { locked: true, reason: iAmActing ? 'waitingForOpponent' : 'opponentTurn', permitted };
}

/** The view's one-line consult: `if (!actionAllowed(g, ctx, 'declare')) return;` */
export function actionAllowed(
  game: GameJson | null | undefined,
  ctx: ClientStateContext,
  cls: ActionClass,
): boolean {
  const lock = actionSurfaceLock(game, ctx);
  return !lock.locked || lock.permitted.includes(cls);
}
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A click on a player. `isMine(playerId)` tells the router which side a player is on (kept as a predicate so
 * this module stays free of the store); the caller supplies the coach's ownership check.
 */
export function onPlayerClick(
  game: GameJson | null | undefined,
  ctx: ClientStateContext,
  clickedPlayerId: string,
  isMine: (playerId: string) => boolean,
): Interaction {
  if (!game) return { kind: 'ignore' };
  const clickedPlayer = (game.fieldModel?.playerDataArray ?? []).find((d) => (d as { playerId?: string }).playerId === clickedPlayerId) as { playerCoordinate?: unknown } | undefined;
  const clickedSquare = normSquare(clickedPlayer?.playerCoordinate);
  const state = deriveClientState(game, ctx);
  // Upstream SwoopLogicModule delegates a player click to fieldInteraction using the occupied coordinate. This
  // must precede ownership/action-menu routing: either team's token may occupy a server-offered Swoop square.
  if (state === 'SWOOP') {
    return clickedSquare
      ? swoopCoordinateIntent(game, ctx, clickedSquare)
      : { kind: 'ignore', reason: 'Swoop target player has no pitch coordinate' };
  }
  if (clickedSquare && consumeStepEcho(game, clickedSquare)) {
    return { kind: 'ignore', reason: 'step-confirm echo debounce (SR-247)' };
  }
  if (!clickedSquare) stepEchoGuard = null;

  if (state === 'SELECT_PLAYER') {
    if (!isMine(clickedPlayerId)) return { kind: 'ignore', reason: 'opponent player (select your own to declare)' };
    return { kind: 'openActionMenu', playerId: clickedPlayerId, actions: availableActions(game, ctx, clickedPlayerId) };
  }

  // Optional Gameplay behavior: another activatable friendly player is a deliberate activation switch on the
  // movement rails where that token has no action-specific target meaning. Keep this ahead of BLITZ's own-player
  // rejection and MOVE/FOUL's generic WALK menu, but after SELECT_PLAYER's ordinary declaration surface.
  if (isMine(clickedPlayerId) && clickedPlayerId !== actingPlayerId(game)) {
    const disposition = friendlyActivationSwitchDisposition(game, ctx, clickedPlayerId);
    if (disposition) {
      return {
        kind: 'switchFriendlyActivation', playerId: clickedPlayerId,
        actions: availableActions(game, ctx, clickedPlayerId), disposition,
      };
    }
  }

  // SR-244 RG-1/RG-4: only the ACTING player's self-click gets the missing non-WALK action menu. Preserve the
  // state's enemy-click routing below (targetSelected / multiBlockToggle / block), and use the established WALK
  // hasDeclare gate: a non-carrier still ends directly instead of flashing a one-item End Activation menu.
  // Upstream SelectBlitzTarget gates its self menu the same way. Blitz/MultiBlock open theirs unconditionally;
  // deliberately requiring a declare here is the benign UX divergence (no wire difference) requested by RG-1.
  if (NON_WALK_DECLARED_ACTION_STATES.has(state) && clickedPlayerId === actingPlayerId(game)) {
    const actions = availableActions(game, ctx, clickedPlayerId);
    const hasDeclare = actions.some((a) => a.kind === 'declare');
    // Blitz self-interaction must remain a menu surface. Returning the direct endMove intent here lets a caller
    // accidentally bypass the mandatory confirmation card; the store backstop also refuses that wire.
    if (!hasDeclare && !requiresBlitzEndConfirmation(state)) {
      if (state === 'BLOCK' || state === 'SYNCHRONOUS_MULTI_BLOCK') { // Kick 'em block keeps its S8 upstream self-click end
        return { kind: 'targetPending', playerAction: String((game.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? 'block') };
      }
      return { kind: 'endMove' };
    }
    return { kind: 'openActionMenu', playerId: clickedPlayerId, actions };
  }

  // A.3 BLOCK: the acting player declared block → BLOCK state → a click on an ADJACENT standing enemy blocks it
  // (adjacency = a rules gate; the server validates the clientBlock). Own-player clicks fall through to the menu.
  if (state === 'BLOCK') {
    if (!isMine(clickedPlayerId)) {
      const acting = actingPlayerId(game);
      // #181 W0/VV-1 (Meero SR-143): VICIOUS VINES routes to BLOCK (clientStateMachine `viciousVines→'BLOCK'`) but
      // its legal targets are 2 squares away — `canBlockOverDistance`. Gating it on `adjacentStandingEnemyIds`
      // (the plain-block rule) rejects every legal vine target: the router refuses the skill's own rule. Gate the
      // vine on the SERVER's dice decorations instead — the server broadcasts one per legal target at declare, so
      // it IS the answer; a client "within-2" derivation would OVER-accept the adjacent squares the vine excludes
      // and send an illegal command (VV-2: do not derive the distance). Plain block is unchanged.
      const actingAction = String((game.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? '');
      if (acting && actingAction === 'viciousVines') {
        if (blockTargetDecorated(game, clickedPlayerId)) return { kind: 'block', defenderId: clickedPlayerId };
        return { kind: 'ignore', reason: 'not a decorated vicious-vines target' };
      }
      if (acting && adjacentStandingEnemyIds(game, acting).includes(clickedPlayerId)) {
        return { kind: 'block', defenderId: clickedPlayerId };
      }
      return { kind: 'ignore', reason: 'not an adjacent standing block target' };
    }
    // clicking own acting player in BLOCK = deselect (rare — normally you commit or the server drives on)
    if (clickedPlayerId === actingPlayerId(game)) return { kind: 'ignore', reason: 'law 10e: own-player left-click is inert (End Activation = menu/Esc)' };
    return { kind: 'ignore', reason: 'own player during block target select' };
  }

  // #207/SR-241: MAXIMUM_CARNAGE is not a declare. The SERVER changes the acting action after the first chainsaw
  // block (bb2025 StepEndBlocking:435); ClientStateFactory:176 derives this state and PlayerAction:22 has
  // parent/delegate=null. Mirror MaximumCarnageLogicModule.playerInteraction: any opposing player except the
  // server-sent lastDefenderId is a second target, and the click sends clientBlock directly with the established
  // USING_CHAINSAW flag — never CLIENT_ACTING_PLAYER and never a new wire token.
  if (state === 'MAXIMUM_CARNAGE') {
    if (!isMine(clickedPlayerId)) {
      const lastDefenderId = String((game as { lastDefenderId?: string | null }).lastDefenderId ?? '');
      if (clickedPlayerId !== lastDefenderId) {
        return { kind: 'block', defenderId: clickedPlayerId, blockKind: 'chainsaw' };
      }
      return { kind: 'ignore', reason: 'maximum-carnage cannot target the previous defender' };
    }
    if (clickedPlayerId === actingPlayerId(game)) return { kind: 'ignore', reason: 'law 10e: own-player left-click is inert (End Activation = menu/Esc)' };
    return { kind: 'ignore', reason: 'own player during maximum-carnage target select' };
  }

  // Star S8 (KE-1 — the branch the Wave-B note reserved): the successful stationary KICK_EM_BLOCK path stays a
  // direct token interaction. KICK_EM_BLITZ approaches on the shared blitzStep rail; once adjacent, its
  // store-owned target rail installs the same legal predicate and commits this exact terminal sender once.
  if (state === 'KICK_EM_BLOCK') {
    if (!isMine(clickedPlayerId)) {
      const acting = actingPlayerId(game);
      if (acting && kickEmCommitAllowed(game, acting, clickedPlayerId)) {
        return { kind: 'kickEmBlock', defenderId: clickedPlayerId };
      }
      return { kind: 'ignore', reason: 'not an adjacent downed kick-em target (walk adjacent first on a Blitz)' };
    }
    if (clickedPlayerId === actingPlayerId(game)) return { kind: 'ignore', reason: 'law 10e: own-player left-click is inert (End Activation = menu/Esc)' };
    return { kind: 'ignore', reason: 'own player during kick-em target select' };
  }

  // Star S8: Blastin' target beat (turnMode thenIStartedBlastin). ThenIStartedBlastinLogicModule.playerInteraction —
  // a valid target (standing opponent within 3, blastinTargetIds) sends CLIENT_TARGET_SELECTED; the acting player's
  // self-click is the END_MOVE menu (endMove here → the store's endActivation routes this turnMode → CLIENT_END_TURN).
  if (state === 'THEN_I_STARTED_BLASTIN') {
    if (clickedPlayerId === actingPlayerId(game)) return { kind: 'endMove' };
    const acting = actingPlayerId(game);
    if (acting && blastinTargetIds(game, acting).includes(clickedPlayerId)) {
      return { kind: 'blastinTarget', targetId: clickedPlayerId };
    }
    return { kind: 'ignore', reason: "blastin': click a STANDING opponent within 3 squares, or your own player to decline" };
  }

  // Star S8: Furious Outburst teleport beats are SQUARE picks (fieldInteraction only). Self-click = END_MOVE
  // menu (acting-null exit); every other player click ignores (eligible squares are EMPTY by construction).
  if (state === 'FURIOUS_OUTBURST') {
    if (clickedPlayerId === actingPlayerId(game)) return { kind: 'endMove' };
    return { kind: 'ignore', reason: 'furious outburst: click a highlighted square, or your own player to finish' };
  }

  // #181 Wave B (Meero SR-148, PR-1/PR-2/FB-1): the star block-VARIANT actions derive their OWN states (not BLOCK),
  // so they inherited no click routing at all — enter-and-can't-act. Each resolves as a FLAGGED block on a
  // SERVER-DECORATED target: Putrid Regurgitation → vomit (blitz + after-block variants), The Flashing Blade →
  // stab. The gate is the server's dice decorations (`blockTargetDecorated`, the VV-1 answer), NEVER a client
  // geometry rule. The flag rides `blockKind` on the return (PL-1) — a plain flagless block would fire a NORMAL
  // block, since the server dispatches the block-kind off USING_VOMIT/USING_STAB (`StepInitSelecting`), not the
  // action. ⚠ Kick-em's DOWNED-target rule is deliberately NOT here — it keeps its own branch (KE-1), because a
  // distinct rule owes a distinct predicate; these three genuinely share the one decoration gate and differ only
  // in the flag, which is why they share a branch and Kick-em does not.
  const STAR_BLOCK_KIND: Record<string, 'vomit' | 'stab'> = {
    PUTRID_REGURGITATION_BLITZ: 'vomit', PUTRID_REGURGITATION_BLOCK: 'vomit', STAB: 'stab',
  };
  const starBlockKind = STAR_BLOCK_KIND[state];
  if (starBlockKind) {
    if (!isMine(clickedPlayerId)) {
      if (blockTargetDecorated(game, clickedPlayerId)) return { kind: 'block', defenderId: clickedPlayerId, blockKind: starBlockKind };
      return { kind: 'ignore', reason: `not a decorated ${starBlockKind}-block target` };
    }
    if (clickedPlayerId === actingPlayerId(game)) return { kind: 'ignore', reason: 'law 10e: own-player left-click is inert (End Activation = menu/Esc)' };
    return { kind: 'ignore', reason: 'own player during star-block target select' };
  }

  // A.4 SELECT_BLITZ_TARGET: after declaring a blitz the server asks for the target — a click on an ENEMY
  // nominates it (`targetSelected`). Reach/legality is the server's call; we only forward the pick.
  if (state === 'SELECT_BLITZ_TARGET') {
    if (isMine(clickedPlayerId)) {
      if (clickedPlayerId === actingPlayerId(game)) return { kind: 'ignore', reason: 'law 10e: own-player left-click is inert (End Activation = menu/Esc)' }; // 10e: was re-click-self-abort
      return { kind: 'ignore', reason: 'own player during blitz target select' };
    }
    // #93 (owner): a blitz can only TARGET a player that canBeBlocked (STANDING || MOVING) — a prone/stunned enemy
    // is NOT a valid blitz target (upstream SelectBlitzTargetLogicModule → isBlockable → canBeBlocked). Without
    // this the router forwarded ANY enemy click as the nominee. Plain Block is already prone-safe (its target set
    // is the STANDING-only adjacentStandingEnemyIds).
    if (!canBeBlocked(game, clickedPlayerId)) return { kind: 'ignore', reason: 'down enemy — a blitz can only target a standing player' };
    return { kind: 'targetSelected', defenderId: clickedPlayerId };
  }

  // A.4 BLITZ: the target is nominated and the blitzer walks to contact (BLITZ ≠ a plain WALK state — the walk
  // rides clientBlitzMove, so it is handled explicitly, not via WALK_STATES/step). Once adjacent, a click on the
  // adjacent standing enemy commits the block (server accepts clientBlock while playerAction == blitzMove).
  if (state === 'BLITZ') {
    if (!isMine(clickedPlayerId)) {
      const acting = actingPlayerId(game);
      if (acting && adjacentStandingEnemyIds(game, acting).includes(clickedPlayerId)) {
        return { kind: 'block', defenderId: clickedPlayerId };
      }
      return { kind: 'inspect', playerId: clickedPlayerId };
    }
    if (clickedPlayerId === actingPlayerId(game)) return { kind: 'ignore', reason: 'law 10e: own-player left-click is inert (End Activation = menu/Esc)' };
    return { kind: 'ignore', reason: 'own player during blitz' };
  }

  // #58 SYNCHRONOUS_MULTI_BLOCK: a `canBlockTwoAtOnce` carrier (BB2025 "Multiple Block") declared multipleBlock, so
  // the server decorated every legal target. A click on an adjacent blockable ENEMY TOGGLES it in/out of the 2-block
  // selection — the store sequences SET/UNSET and AUTO-COMMITS at the 2nd target (no confirm), owning the
  // isBlockable + dice-decoration SET gate (ML-8; an already-selected UNSET is not re-gated — upstream's
  // selected-first ordering). Own acting-player click ENDS the activation (endActivation unsets each SET target then
  // acting-null — the abandon). `canBeBlocked` is the cheap pre-filter (a prone enemy is never a target). Mirrors
  // upstream SynchronousMultiBlockLogicModule.playerInteraction/handlePlayerSelection. ML-8: this gated defender
  // click is the ONLY SET route — upstream's ungated menu `case BLOCK → selectPlayer` is deliberately NOT ported.
  if (state === 'SYNCHRONOUS_MULTI_BLOCK') {
    if (isMine(clickedPlayerId)) {
      if (clickedPlayerId === actingPlayerId(game)) return { kind: 'endMove' }; // abandon (unset each + acting-null)
      return { kind: 'ignore', reason: 'own player during multi-block target select' };
    }
    if (canBeBlocked(game, clickedPlayerId)) return { kind: 'multiBlockToggle', defenderId: clickedPlayerId };
    return { kind: 'ignore', reason: 'down enemy — not a multi-block target' };
  }

  // g478 #1 HIGH_KICK: post-kickoff the RECEIVING (acting) coach nominates ONE eligible player to be moved onto
  // the ball's landing square. Eligibility = upstream HighKickLogicModule.isPlayerSelectable (active + acting
  // side; NO tackle-zone check). The server SILENTLY drops an ineligible nominee, so a non-nominee click ignores
  // with a reason and the SpectateView raises a toast (the designed gap) rather than a dead click.
  if (state === 'HIGH_KICK') {
    if (!isMine(clickedPlayerId)) return { kind: 'ignore', reason: 'opponent player (high kick: nominate your own)' };
    if (!highKickNomineeIds(game).includes(clickedPlayerId)) {
      return { kind: 'ignore', reason: 'not an eligible high-kick nominee (must be active, your side)' };
    }
    return { kind: 'highKickNominate', playerId: clickedPlayerId };
  }

  // A.5 (o66j #8) FOUL: the acting player declared `foulMove` → a click on an ADJACENT DOWN enemy is the boot
  // (clientFoul). Own-player clicks fall through to the WALK handling (switch/menu/end). The player may still
  // WALK to the victim first (onSquareClick steps server move squares — FOUL is a WALK_STATE).
  if (state === 'FOUL') {
    if (!isMine(clickedPlayerId)) {
      const acting = actingPlayerId(game);
      if (acting && adjacentDownEnemyIds(game, acting).includes(clickedPlayerId)) return { kind: 'foulTarget', defenderId: clickedPlayerId };
      return { kind: 'inspect', playerId: clickedPlayerId };
    }
    // own player → shared switch/menu/end handling below
  }

  // A.5 (o66j #8) HAND_OVER: completion is exactly one click on an ADJACENT OWN teammate (clientHandOver;
  // game_801 15:25). The acting-player re-click still falls through to shared end/menu handling; every OTHER
  // own-player click is terminal here so it cannot open the generic WALK_STATES action menu.
  if (state === 'HAND_OVER' && isMine(clickedPlayerId)) {
    const acting = actingPlayerId(game);
    if (clickedPlayerId !== acting && acting && adjacentOwnTeammateIds(game, acting).includes(clickedPlayerId)) {
      return { kind: 'handOverTarget', catcherId: clickedPlayerId };
    }
    if (clickedPlayerId !== acting) {
      return { kind: 'ignore', reason: 'own player not adjacent during hand-off' };
    }
  }

  // A.5 (o66j #8) PASS: the target is a SQUARE — a click on ANY non-acting player throws to their square (the
  // common case is an own receiver; the server validates range + resolves interception). A self-click must fall
  // through to the shared WALK menu below: PassLogicModule.actionContext (bb2025:190-195) can add the in-action
  // HAIL_MARY_PASS choice there, alongside the activation actions from availableActions.
  if (state === 'PASS' && clickedPlayerId !== actingPlayerId(game)) {
    const acting = actingPlayerId(game);
    const tp = (game.fieldModel?.playerDataArray ?? []).find((d) => (d as { playerId?: string }).playerId === clickedPlayerId) as { playerCoordinate?: unknown } | undefined;
    const sq = normSquare(tp?.playerCoordinate);
    if (!sq) return { kind: 'ignore', reason: 'pass target has no square' };
    // PC-1 (Meero SR-211): only route the throw when the receiver's square is in the pass-range template — an
    // out-of-range send dies here (only-surface-what-the-server-offers), never reaching sendPassTarget.
    if (!passTargetInTemplate(game, acting, sq)) {
      return isMine(clickedPlayerId)
        ? { kind: 'ignore', reason: 'pass target out of range template' }
        : { kind: 'inspect', playerId: clickedPlayerId };
    }
    return { kind: 'passTarget', square: sq };
  }

  // BB2025 Punt targets may be occupied. Upstream delegates every non-acting player click to fieldInteraction
  // (`PuntLogicModule.java:38-45`), which admits only a server MoveSquare and sends FIELD_COORDINATE (:56-69).
  if (state === 'PUNT'
      && String((game.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? '') === 'punt'
      && clickedPlayerId !== actingPlayerId(game)) {
    if (clickedSquare && serverMoveSquares(game).some((sq) => sameSquare(sq, clickedSquare))) {
      return { kind: 'fieldCoordinate', square: clickedSquare };
    }
    return isMine(clickedPlayerId)
      ? { kind: 'ignore', reason: 'square not in server punt moveSquareArray' }
      : { kind: 'inspect', playerId: clickedPlayerId };
  }

  // #116 HIT_AND_RUN: a field-square click steps a server move-away square (WALK_STATES → onSquareClick). A click
  // on the ACTING player CANCELS the move-away = end it (upstream "Cancel Hit And Run" → sendEndTurn(turnMode);
  // the store's endActivation routes hitAndRun → CLIENT_END_TURN). No action menu here — the only choices are
  // "step to a highlighted square" or "finish". Handled before the generic WALK_STATES menu path below.
  if (state === 'HIT_AND_RUN') {
    if (clickedPlayerId === actingPlayerId(game)) return { kind: 'endMove' };
    return { kind: 'ignore', reason: 'hit & run: click a highlighted square to move away, or your own player to finish' };
  }

  // With the friendly-switch preference disabled, a different player remains inert during MOVE. With it enabled,
  // the shared switch branch above has already returned the server-derived refund/end disposition.
  if (state === 'MOVE' && clickedPlayerId !== actingPlayerId(game)) {
    if (!isMine(clickedPlayerId)) return { kind: 'inspect', playerId: clickedPlayerId };
    return { kind: 'ignore', reason: 'friendly-player switching is disabled or clicked player is not activatable' };
  }

  if (WALK_STATES.has(state)) {
    if (!isMine(clickedPlayerId)) return { kind: 'inspect', playerId: clickedPlayerId };
    const actions = availableActions(game, ctx, clickedPlayerId);
    const hasDeclare = actions.some((a) => a.kind === 'declare');
    // Req #3: clicking the acting player with no declare available is an implicit deselect (End Move), not a
    // 1-item menu. Once later phases add in-move declares, the same click opens the menu instead.
    if (clickedPlayerId === actingPlayerId(game) && !hasDeclare) return { kind: 'ignore', reason: 'law 10e: own-player left-click is inert (End Activation = menu/Esc)' };
    return { kind: 'openActionMenu', playerId: clickedPlayerId, actions };
  }

  if (!isMine(clickedPlayerId) && OPPONENT_INSPECTION_STATES.has(state)) {
    return { kind: 'inspect', playerId: clickedPlayerId };
  }
  return { kind: 'ignore', reason: `no player interaction in ${state}` };
}

/** A click on an empty square. Only meaningful in MOVE: step iff the server offered that square. */
export function onSquareClick(
  game: GameJson | null | undefined,
  ctx: ClientStateContext,
  square: [number, number],
): Interaction {
  if (!game) return { kind: 'ignore' };
  const state = deriveClientState(game, ctx);
  if (state === 'SWOOP') return swoopCoordinateIntent(game, ctx, square);
  if (consumeStepEcho(game, square)) {
    return { kind: 'ignore', reason: 'step-confirm echo debounce (SR-247)' };
  }

  // Any WALK state steps a server move square (MOVE natively; PASS/HAND_OVER/PUNT/FOUL via DELEGATE, req #1).
  if (WALK_STATES.has(state)) {
    const legal = serverMoveSquares(game).some((sq) => sameSquare(sq, square));
    if (legal) {
      // `PuntLogicModule.fieldInteraction` splits on the RAW action: puntMove delegates to walking, but punt sends
      // FIELD_COORDINATE for the server-provided target square (`PuntLogicModule.java:56-69`). StepInitPunt creates
      // exactly the four orthogonal targets as MoveSquares (`StepInitPunt.java:140-163,170-188`).
      if (state === 'PUNT'
          && String((game.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? '') === 'punt') {
        return { kind: 'fieldCoordinate', square };
      }
      armStepEcho(square);
      return { kind: 'step', toSquare: square };
    }
    // A.5 (o66j #8) PASS: a click on OPEN ground that is NOT a walk square is the throw target (the server
    // validates range + resolves scatter/interception). Other WALK states have no open-square target.
    // PC-1 (Meero SR-211): gate the open-ground throw on the pass-range template too — out-of-range dies at source.
    if (state === 'PASS') {
      if (passTargetInTemplate(game, actingPlayerId(game), square)) return { kind: 'passTarget', square };
      return { kind: 'ignore', reason: 'pass target out of range template' };
    }
    return { kind: 'ignore', reason: 'square not in server moveSquareArray' };
  }

  // Star S8: FURIOUS_OUTBURST teleport pick — a SERVER-offered square (StepFirst-/SecondMoveFuriousOutburst
  // eligibleSquares arrive as moveSquares) sends CLIENT_FIELD_COORDINATE (FuriousOutburstLogicModule
  // fieldInteraction: getMoveSquare(coordinate) != null → sendFieldCoordinate). Never a client-derived square.
  if (state === 'FURIOUS_OUTBURST') {
    if (serverMoveSquares(game).some((sq) => sameSquare(sq, square))) {
      return { kind: 'fieldCoordinate', square };
    }
    return { kind: 'ignore', reason: 'square not in server moveSquareArray' };
  }

  // A.4 BLITZ walk: same server-offered-square gate, but the step rides clientBlitzMove (not clientMove).
  // Kick 'Em shares the movement gesture; the store sends CLIENT_MOVE without redeclaring blitzMove.
  if (isBlitzMovementState(state)) {
    const legal = serverMoveSquares(game).some((sq) => sameSquare(sq, square));
    if (legal) {
      armStepEcho(square);
      return { kind: 'blitzStep', toSquare: square };
    }
    return { kind: 'ignore', reason: 'square not in server moveSquareArray' };
  }

  return { kind: 'ignore', reason: `no square interaction in ${state}` };
}
