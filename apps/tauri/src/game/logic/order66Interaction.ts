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
import { availableActions, actingHasActed, isBallCarrier, illCarryYouAvailable, jumpCapabilityAvailable, canPlaceCarriedPlayerNow, hasCanDropBallProperty, adjacentStandingEnemyIds, adjacentDownEnemyIds, adjacentOwnTeammateIds, serverMoveSquares, sameSquare, normSquare, highKickNomineeIds, canBeBlocked, blockTargetDecorated, playerSideIsHome, passRangeSquares, ttmRangeSquares, kickEmCommitAllowed, blastinTargetIds, blitzBlockMoveVerdict, rushPromptBeforeAttack, handOffCatcherAllowed, passTargetAllowed, type CoachAction } from './availableActions';
import { isBlastinSecondBeat } from '../blastinSecondBeat';
import { t } from '../../i18n';

export type EndActivationConfirmKind = 'blitz' | 'punt' | 'handOver' | 'pass' | 'foul' | 'generic';

/** Owner 10-04 (FUMBBL g1949714, KrisB): a declared Hand-off / Pass is a once-per-turn action, so ending it asks
 *  first - a stray right-click on the grass silently sent the end and the turn's hand-off was spent with the
 *  ball still in hand. Null for every other state. */
export function ballActionEndConfirmKind(state: ClientStateId | '' | null | undefined): 'handOver' | 'pass' | null {
  return state === 'HAND_OVER' ? 'handOver' : state === 'PASS' ? 'pass' : null;
}
/** Owner 10-07: "We should extend the confirm modal for cancelling an action to Foul actions." A declared Foul (FOUL,
 *  target nominated or not) is once per turn too, so its cancel / end asks under its own line. Every gesture that asks
 *  for a Hand-off / Pass (right-click on grass, Escape, End, End Turn) reads this one classifier. */
export function declaredActionEndConfirmKind(state: ClientStateId | '' | null | undefined): 'handOver' | 'pass' | 'foul' | null {
  return ballActionEndConfirmKind(state) ?? (state === 'FOUL' ? 'foul' : null);
}

/** Spec S15B: how an end-activation confirm was opened. An explicit End gesture (End row, click on self) may roll a held
 *  Big Guy Activate intent; Esc and every other cancel gesture never does. */
export type EndActivationOrigin = 'explicit' | 'cancel';
/** The End Activation prompt an End gesture opens in this client state (null = nothing asks: the end goes straight to
 *  the wire). The same order SpectateView.requestEndActivation dispatches in. */
export function endActivationPromptKind(input: {
  clientState: ClientStateId | '' | null | undefined; gazeIntentLive: boolean;
}): EndActivationConfirmKind | null {
  if (requiresBlitzEndConfirmation(input.clientState)) return 'blitz';
  if (input.clientState === 'PUNT') return 'punt';
  return declaredActionEndConfirmKind(input.clientState) ?? (input.gazeIntentLive ? 'generic' : null);
}
/** Bug report 10-09 (Elyod, FUMBBL g1951755, 1.0.151): "I blitzed ... pushed it twice, and then, with movement
 *  remaining, was unable to dodge/move away". The End Activation row (and a right-click on the acting player whose menu
 *  holds nothing else, e.g. a blitzer after his block) tore the planner arms down - selection, movement overlay, route -
 *  BEFORE the "End your blitz?" prompt was answered. "Go back" then left the server's blitzMove with no movement
 *  surface: nothing re-arms it until the next frame, and the server sends none while it waits for the coach.
 *  When a prompt is about to ask, the prompt owns the cleanup: Confirm clears (confirmEndActivation), Go back leaves
 *  the activation exactly as it was. True = no prompt will open, so the arms are cleared now (the pre-prompt R3 path). */
/** Astra review of the g1951755 fix (10-10): the movement surface (selection, reach overlay, tile pick) was armed only
 *  as a side effect of a watched change, so a cold renderer mount (rejoin while the server waits in blitzMove) or a
 *  prompt cancelled after something had cleared the board left dead tiles until the next frame. The view now owns ONE
 *  state-derived re-arm, run at renderer mount and from every prompt cancel. This is its selection half: re-select the
 *  acting player only when the server is waiting on a move from this seat and nothing else owns the pitch.
 *  moveSquareCount is the freshly derived surface (0 = the state offers no movement: nothing is armed). */
export function movementSurfaceReselectsActing(input: {
  playing: boolean; myTurn: boolean; actingId: string; controlsActing: boolean; selectedId: string | null;
  moveSquareCount: number; serverDialogOpen: boolean; clientPromptOpen: boolean; planActive: boolean;
}): boolean {
  if (!input.playing || !input.myTurn || !input.actingId || !input.controlsActing) return false;
  if (input.moveSquareCount <= 0 || input.serverDialogOpen || input.clientPromptOpen || input.planActive) return false;
  return input.selectedId === null; // never steal a selection the coach made (an inspected opponent, a team-mate)
}
export function endRowClearsArmsBeforeEnding(input: { promptKind: EndActivationConfirmKind | null; promptEnabled: boolean }): boolean {
  return !(input.promptKind !== null && input.promptEnabled);
}
/** g1960010 (Elyod 11-03, latches fail open): an End gesture that cleared the planner arms first (the End row, an End
 *  confirmation, Esc's undeclare) and then sent nothing - the store refused it, no frame will follow - re-arms the
 *  movement surface from state, so the coach is never left without the picker the server is still waiting on.
 *  'none': something was sent (the server's frame re-arms), a cancel of ours is pending (re-armed when it settles) or
 *  no player is acting. 'defer' (Sol r1 P2): a server dialog or a pitch-owning prompt is up - never arm movement under
 *  it; the view re-arms once the pitch is free again for the same acting player. */
export function refusedEndRearmsSurface(input: {
  sentBefore: number; sentAfter: number; cancelInFlight: boolean; actingId: string;
  serverDialogOpen: boolean; pitchPromptOpen: boolean;
}): 'rearm' | 'defer' | 'none' {
  if (input.sentAfter !== input.sentBefore || input.cancelInFlight || !input.actingId) return 'none';
  return input.serverDialogOpen || input.pitchPromptOpen ? 'defer' : 'rearm';
}
/** Sol r3 P1 (g1960010): the turn modes whose ENTRY retires an open client End Activation / End Blitz card or End Turn
 *  warning: phases where that card's answer would be the wrong command. In hitAndRun an End is "Cancel Hit and Run"
 *  (CLIENT_END_TURN{hitAndRun}), never the activation's end or the turn's end. Keep this explicit and minimal: ordinary
 *  Blitz subphase flips (selectBlitzTarget <-> regular / blitz with the same actor, e.g. the target acknowledgement in
 *  g1951755's quick-click capture) keep the card up and the planner paused under it. */
export const CONFIRMATION_RETIRING_TURN_MODES: ReadonlySet<string> = new Set(['hitAndRun']);
/** True when the server moved INTO a CONFIRMATION_RETIRING_TURN_MODES phase since the card / warning opened. */
export function confirmationOutlivedPhase(openedTurnMode: string, turnMode: string): boolean {
  return turnMode !== openedTurnMode && CONFIRMATION_RETIRING_TURN_MODES.has(turnMode);
}
/** g1960010: the Hit and Run instruction is shown while my acting player is in HIT_AND_RUN with the server's squares.
 *  Pure received state: it goes when the server leaves hitAndRun (a square stepped, or the End's CLIENT_END_TURN). */
export function hitAndRunInstructionVisible(game: GameJson | null | undefined, ctx: ClientStateContext, input: {
  playing: boolean; myTurn: boolean; controlsActing: (playerId: string) => boolean;
}): boolean {
  if (!game || !input.playing || !input.myTurn) return false;
  const actingId = String((game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (!actingId || !input.controlsActing(actingId)) return false;
  return deriveClientState(game, ctx) === 'HIT_AND_RUN' && serverMoveSquares(game).length > 0;
}
/** Review round 2 (11-13): a pitch TILE pick in the pass / hand-off states, decided before any movement-only handling
 *  (Jump landing, Ball and Chain aim, the walk planner). Upstream's AWT client turns a click on an occupied square into
 *  a PLAYER click (ClientStateAwt: clickOnPlayer when a player stands there), so `playerClick` = hand the tile to the
 *  player-click route (onPlayerClick: PassLogicModule.playerInteraction:40-61 / HandOverLogicModule.playerInteraction
 *  :37-46, neither reading the jumping flag). An empty square in PASS / HAIL_MARY_PASS is the stationary throw
 *  (`throw` when passTargetAllowed, else `ignore`: fieldInteraction:70-79). Everything else (`continue`) is movement:
 *  PASS_MOVE / HAND_OVER_MOVE delegate an empty square to Move (fieldInteraction:63-69), where Jump applies. */
export function passFamilyTileRoute(
  game: GameJson | null | undefined,
  ctx: ClientStateContext,
  square: [number, number],
): { kind: 'playerClick'; playerId: string } | { kind: 'throw'; square: [number, number] } | { kind: 'ignore' } | { kind: 'continue' } {
  if (!game) return { kind: 'continue' };
  const state = deriveClientState(game, ctx);
  if (state !== 'PASS' && state !== 'HAND_OVER') return { kind: 'continue' };
  const acting = actingPlayerId(game);
  if (!acting) return { kind: 'continue' };
  const occupant = (game.fieldModel?.playerDataArray ?? [])
    .find((d) => sameSquare((d as { playerCoordinate?: unknown }).playerCoordinate, square)) as { playerId?: string } | undefined;
  const occupantId = String(occupant?.playerId ?? '');
  if (occupantId && occupantId !== acting) return { kind: 'playerClick', playerId: occupantId };
  if (state === 'PASS') {
    const action = String((game.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? '');
    if (action === 'pass' || action === 'hailMaryPass') {
      return passTargetAllowed(game, acting, square) ? { kind: 'throw', square: [square[0], square[1]] } : { kind: 'ignore' };
    }
  }
  return { kind: 'continue' };
}
/** F1-1: the "Hand-off to Any Player" state is on screen while my acting ball carrier is in the HAND_OVER action (not
 *  the ordinary HAND_OVER_MOVE), the one state in which an opponent may take the hand-off (upstream
 *  HandOverLogicModule.actionContext:98-103, HANDS_OVER_TO_ANYONE). Pure received state; sends nothing. */
export function handOffToAnyPlayerActive(game: GameJson | null | undefined, ctx: ClientStateContext, input: {
  playing: boolean; myTurn: boolean; controlsActing: (playerId: string) => boolean;
}): boolean {
  if (!game || !input.playing || !input.myTurn) return false;
  const acting = game.actingPlayer as { playerId?: string | null; playerAction?: string | null } | undefined;
  const actingId = String(acting?.playerId ?? '');
  if (!actingId || !input.controlsActing(actingId) || String(acting?.playerAction ?? '') !== 'handOver') return false;
  return deriveClientState(game, ctx) === 'HAND_OVER' && isBallCarrier(game, actingId);
}
/** Astra 10-04 / 10-07 (P3): a client confirmation (End Activation prompt, End Turn warning) belongs to the activation
 *  it opened in. It is retired, sending nothing, once the turn is no longer mine or the acting player changed. */
export function confirmationOutlivedActivation(mine: boolean, actingId: string, openedForActingId: string): boolean {
  return !mine || actingId !== openedForActingId;
}
/** Astra 10-07 (P2): the right-click route-cancel paths (the plotted-route backstop and the renderer's waypoint
 *  cancel) ask exactly where the Escape cascade asks with a route plotted: a declared FOUL with a nominated target.
 *  Null = the route clear stays a local abort (as Escape's abort-preview). escCascadeDecision reads this too. */
export function plottedRouteCancelConfirmKind(input: { pendingFoul: boolean; clientState: ClientStateId | '' | null | undefined }): EndActivationConfirmKind | null {
  return input.pendingFoul && input.clientState === 'FOUL' ? 'foul' : null;
}
/** `label` is bigGuyRollEndLabel (Spec S23), so the card names the same negatrait as the menu row. */
export function rollEndConfirmCopy(label: string) {
  return { title: label, get text() { return t('hud.actions.text.rollTheNegatraitAnd'); }, confirmLabel: label };
}
/** Pure decision for the generic end-activation confirm: whether confirming rolls, and the copy that says so (null =
 *  keep the ordinary copy). Rolls only for an explicit origin, a generic confirm, and the live intent's own player. */
export function endActivationConfirmDecision(input: {
  origin: EndActivationOrigin; kind: EndActivationConfirmKind; rollPlayerId: string | null; actingId: string; rollLabel?: string;
}): { roll: boolean; copy: ReturnType<typeof rollEndConfirmCopy> | null } {
  const roll = input.origin === 'explicit' && input.kind === 'generic'
    && !!input.rollPlayerId && input.rollPlayerId === input.actingId;
  return { roll, copy: roll ? rollEndConfirmCopy(input.rollLabel ?? 'Roll & End Activation') : null };
}
export type FriendlyActivationSwitchDisposition = 'refund' | 'end';

// R2: the view projects its richer menu rows through this pure acting-player right-click seam.
export interface RightClickRow { disabled?: boolean; endActivation?: boolean }
/** Owner 09-09 (fork game 947, Ivar / Raiding Party): states where the declared action is still WAITING FOR A
 *  TARGET click on the pitch — a stray right-click on the actor must not silently end the activation. */
export const TARGET_PENDING_STATES: ReadonlySet<ClientStateId> = new Set<ClientStateId>([
  'BLOCK', 'SELECT_BLITZ_TARGET', 'KICK_EM_BLOCK', 'SYNCHRONOUS_MULTI_BLOCK', 'FOUL', 'BOMB', 'THROW_KEG',
  'THROW_TEAM_MATE', 'KICK_TEAM_MATE', 'GAZE', 'HAND_OVER', 'PASS',
]);
/** `rollIntentLive` (Spec S23): a live Big Guy Activate intent on the acting player always surfaces the menu, so the
 *  roll row is a deliberate pick and a right-click alone never ends (or rolls) the activation. */
export function selectedActingRightClick(rows: ReadonlyArray<RightClickRow>, state?: ClientStateId | '' | null, rollIntentLive = false): 'menu' | 'cancel' {
  if (rollIntentLive) return 'menu';
  if (rows.some((row) => !row.disabled && !row.endActivation)) return 'menu';
  return state && TARGET_PENDING_STATES.has(state) ? 'menu' : 'cancel';
}

/** Owner 10-20 (RickWreckless, FUMBBL g1955027: "Declared pass and couldn't work out how to pass to empty square, menu
 *  wouldn't open on him"). A right-click while a walk route is plotted:
 *  - on my controlled acting player whose rail menu has an enabled row ('menu'): 'menuWithRouteCancel' = open the rail
 *    menu with a "Cancel plotted route" row (it used to cancel the route and open nothing, so a left-click on any
 *    empty square during a declared pass made the menu unreachable);
 *  - on my controlled acting player with no enabled row ('cancel'): 'passThrough' (today's handling below);
 *  - an OFF-PITCH right-click routed to the acting player (offPitchRightClickRoute 'acting-menu'): unchanged, a 'menu'
 *    disposition cancels the route ('cancelRoute'), a 'cancel' one passes through;
 *  - anywhere else that is not the selected token (empty square, other player): 'cancelRoute' (unchanged);
 *  - no route plotted: 'passThrough'. Esc keeps cancelling the route (escCascadeDecision). */
export function actingRightClickWithRoute(input: {
  hasRoute: boolean; controlledActingTarget: boolean; disposition: 'menu' | 'cancel'; selectedToken: boolean; offPitch?: boolean;
}): 'menuWithRouteCancel' | 'cancelRoute' | 'passThrough' {
  if (!input.hasRoute) return 'passThrough';
  if (input.controlledActingTarget) {
    if (input.disposition !== 'menu') return 'passThrough';
    return input.offPitch ? 'cancelRoute' : 'menuWithRouteCancel';
  }
  return input.selectedToken ? 'passThrough' : 'cancelRoute';
}

/** Owner 10-20: the rail menu row that cancels a plotted route sits just above the End Activation row (or last). */
export const CANCEL_PLOTTED_ROUTE_LABEL = 'Cancel plotted route';
export function withPlottedRouteCancelRow<T extends { endActivation?: boolean }>(rows: ReadonlyArray<T>, hasRoute: boolean, row: T): T[] {
  if (!hasRoute) return [...rows];
  const end = rows.findIndex((r) => r.endActivation);
  const out = [...rows];
  out.splice(end < 0 ? out.length : end, 0, row);
  return out;
}

/** Owner 10-14 (JLeav, 1.0.208: "right clicking off pitch doesn't react like a normal right click"). Routing of a
 *  right-click that landed OFF the 26x15 grid (sidelines, dugouts, surround):
 *  - 'acting-menu': my turn, I control the acting player -> the acting player's rail menu, as right-clicking him does;
 *  - 'as-empty-square': my turn, no controlled acting player -> the empty-square cascade (go back / cancel / clear / deselect);
 *  - 'ignore': spectating / replay / not my turn / not the Order 66 surface -> today's behaviour (nothing).
 *  An on-pitch right-click is never touched here ('as-is'). */
export function offPitchRightClickRoute(input: {
  offPitch: boolean; order66: boolean; isPlaying: boolean; myTurn: boolean; actingControlled: boolean;
}): 'as-is' | 'acting-menu' | 'as-empty-square' | 'ignore' {
  if (!input.offPitch) return 'as-is';
  if (!input.order66 || !input.isPlaying || !input.myTurn) return 'ignore';
  return input.actingControlled ? 'acting-menu' : 'as-empty-square';
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

// Owner 09-28 (S6): the manual walk-by-tile-clicks Blitz path reaches its adjacent terminal through
// confirmAggroStage() with no menu-picked flavor, same as the planner's act leg — it must try the SAME
// blitz-commit hold before sending a plain block, or a Gored/Chainsaw offer never surfaces (g987 #6).
// An explicit ALTERNATIVE the coach already picked from the rail/menu keeps bypassing the chooser. Owner 11-03
// (option A): an explicit pick of plain Block does NOT — the "Stab or Block?" chooser still asks, so the second
// argument no longer changes the answer (kept so every call site reads the same pair).
export function blitzTerminalShouldTryHold(pendingBlitzBlockKind: string | null, _hasExplicitBlockChoice: boolean): boolean {
  return pendingBlitzBlockKind == null;
}

// Owner 09-28 (S6 follow-up, Sol review): the WHOLE adjacent-terminal decision, so confirmAggroStage's blitz
// branch is a thin call. `holdArmed` is the caller's already-observed result of actually attempting the hold
// (gameStore.tryHoldBlitzBlockChoice) when blitzTerminalShouldTryHold said to try it — this function cannot
// attempt the hold itself (that's a store side-effect), only decide what follows from the outcome. `send:false`
// means the chooser card is now up: the view clears its local arm (commitBlitzBlock/dismissBlitzBlockChoice own
// the terminal next); `send:true` means send now with the remembered flavor, exactly as before this fix existed.
export interface BlitzAdjacentTerminalOutcome { send: boolean; blockKind: string | null }
export function blitzAdjacentTerminalDecision(
  pendingBlitzBlockKind: string | null,
  hasExplicitBlockChoice: boolean,
  holdArmed: boolean,
): BlitzAdjacentTerminalOutcome {
  if (blitzTerminalShouldTryHold(pendingBlitzBlockKind, hasExplicitBlockChoice) && holdArmed) {
    return { send: false, blockKind: null };
  }
  return { send: true, blockKind: pendingBlitzBlockKind };
}

// Owner 09-28 (S6 follow-up, Sol BLOCKER 1): a NO-PLAN blitz-commit hold has no planner fail-safe to retire it —
// plannerFlush/plannerRetireQuietly both no-op with no plan (store.ts ~9198/~9205), so it needs the SAME
// staleness triggers the planner's own plannerAdvance() checks against the live model, evaluated every applied
// frame. All server-derived: never a client prediction of the block/skill outcome, only whether the frozen hold
// still names something legal to resume.
export interface BlitzBlockChoiceLifecycleInput {
  actingPlayerId: string | null;
  blitzerId: string;
  turnMode: string | null;
  /** Owner 09-28 (Sol review round 3, item 2): the acting player's `playerAction` RECORDED when the hold armed
   *  (`state.blitzBlockChoice.armedAction`) — null when absent (the standalone-Block chooser never reaches this
   *  predicate at all, since blitzBlockChoiceOnModelApplied only processes `origin: 'blitz'`, but null still means
   *  "do not apply the action-changed check" here, defensively). A FIXED whitelist ('blitz'/'blitzMove' only) is
   *  wrong: Classic's identical hold-arming call site (ClassicView.vue ~805) also arms this hold under Putrid
   *  Regurgitation's `putridRegurgitationBlitz`/`putridRegurgitationBlock` and The Flashing Blade's
   *  `theFlashingBlade` (their router `block` intent, order66Interaction.ts ~1017-1037 above) — comparing against
   *  the RECORDED action instead covers every action a hold can legitimately arm under, not just ordinary blitz. */
  armedAction: string | null;
  /** `game.actingPlayer.playerAction` right now. */
  currentAction: string | null;
  /** Caller-computed: the held target is still an on-pitch STANDING enemy adjacent to the blitzer
   *  (`adjacentStandingEnemyIds(game, blitzerId).includes(targetId)` — false covers both "no longer adjacent"
   *  and "left the pitch/no longer standing"). */
  targetAdjacent: boolean;
  /** Caller-computed: `fieldModel.targetSelectionState` still SELECTS this exact target. Owner 09-28 (Sol review
   *  round 3, item 2): IGNORED unless `armedAction` is a classic blitz action (`blitz`/`blitzMove`) — Putrid
   *  Regurgitation / The Flashing Blade gate their target purely off dice decorations / adjacency
   *  (`blockTargetDecorated`, order66Interaction.ts ~1150 in availableActions.ts) and never populate
   *  `fieldModel.targetSelectionState`, so this would read false there even on a fully live card. */
  targetSelected: boolean;
  /** Owner 09-28 (Sol review round 2, item 2b): caller-computed — every offer kind in the FROZEN held choice is
   *  still present in a fresh `blitzBlockCommitOffers(game, blitzerId, targetId)` re-evaluation (covers the
   *  Gored decoration disappearing, the skill being marked used elsewhere, or the offer set going empty). */
  offersStillLive: boolean;
}
export function blitzBlockChoiceStale(input: BlitzBlockChoiceLifecycleInput): boolean {
  const armedAsBlitz = input.armedAction === 'blitz' || input.armedAction === 'blitzMove';
  return input.actingPlayerId == null
    || input.actingPlayerId !== input.blitzerId
    || (input.turnMode !== 'regular' && input.turnMode !== 'blitz')
    || (input.armedAction != null && input.currentAction !== input.armedAction)
    || !input.targetAdjacent
    || (armedAsBlitz && !input.targetSelected)
    || !input.offersStillLive;
}

// Owner 09-28 (Sol review round 2, item 3/5): the two pitch-click precedence rules while a block-commit chooser
// (plan-owned or not) is held, pulled out of onPlayerClick/onTilePick so the ORDERING itself is unit-tested —
// the bug this fixes was exactly a wrong position for a guard, so a textual/source check alone would not have
// caught it. Both are exhaustive small state machines; the .vue call sites become thin calls to them, and a
// source-guard test remains only as a secondary confirmation that the call sites use the result.
export type TileClickChooserGate = 'serverOwnedPick' | 'swallowed' | 'normal';
/** A SERVER-owned pick (squarePick / an unknown-coordinate resolution) always keeps precedence — the coach is
 *  mid-dialog with the server, not free-clicking the pitch. Only once neither is active does a held chooser
 *  swallow the click ahead of any client-owned movement/targeting branch. */
export function tileClickDuringChooserHold(input: { serverOwnedPickActive: boolean; blitzBlockChoiceHeld: boolean }): TileClickChooserGate {
  if (input.serverOwnedPickActive) return 'serverOwnedPick';
  if (input.blitzBlockChoiceHeld) return 'swallowed';
  return 'normal';
}
export type PlayerClickChooserGate = 'commitPlain' | 'swallowed' | 'normal';
/** A click on the EXACT held target commits the plain block (pre-existing behaviour, unchanged) and must keep
 *  precedence over the generic "no other click may start or extend anything" swallow this fix adds. */
export function playerClickDuringChooserHold(input: { blitzBlockChoiceHeld: boolean; isHeldTarget: boolean }): PlayerClickChooserGate {
  if (input.isHeldTarget) return 'commitPlain';
  if (input.blitzBlockChoiceHeld) return 'swallowed';
  return 'normal';
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
  /** Owner 09-28 (S6 follow-up): a held choice with no plan owning it (gameStore.blitzBlockChoiceDismissible()) —
   *  Esc may close the card locally, sending nothing, instead of the plan-owned #111 hold-keep. */
  blitzBlockChoiceDismissible: boolean;
  /** S42: the Foul / Chainsaw chooser (the same card) is up; Esc closes it, no wire. Optional so older callers compile. */
  foulChoiceHeld?: boolean;
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
  /** Owner 10-08: a gaze victim is ARMED (picked at gaze time). Esc disarms it first; the activation stays. */
  armedGazeVictim?: boolean;
  thrownMatePending: boolean;
  pendingBlock: boolean;
  /** Owner 09-28 (Spec S3 v2 #3, Sol round-3 fix): the Kick 'em Blitz Yes/No commit card (state.yesNo keyed
   *  'kickEmConfirm:') is up — holds exactly like the other prompts above (no dismiss wired for it today; Esc
   *  must not race past it into the nomination-cancel/route/menu cascade below). */
  kickEmConfirmationCardOpen: boolean;
  /** A live Kick 'em Blitz nomination (state.kickEmBlitzTarget) for the CURRENT acting player. Only consulted
   *  when clientState === 'KICK_EM_BLITZ' and neither the card above nor a plotted route (pendingMove) took
   *  precedence first — a plotted route's Esc semantics are already exactly `pendingMove` below (Kick 'em rides
   *  the same o66PendingMove preview as every other movement declare; no separate input needed for it). */
  kickEmNominated: boolean;
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
  | { level: 1; kind: 'dismiss-blitz-hold'; wire: 'none' }
  | { level: 1; kind: 'dismiss-foul-choice'; wire: 'none' }
  | { level: 1; kind: 'dismiss-prompt'; prompt: EscCascadePrompt; wire: 'none' }
  | { level: 1; kind: 'cancel-kick-em-nomination'; wire: 'none' }
  | { level: 1; kind: 'abort-preview'; wire: 'none' }
  | { level: 1; kind: 'undeclare'; wire: 'end-activation' }
  | { level: 2; kind: 'close-menu'; target: 'context' | 'game-settings' | 'popup'; wire: 'none' }
  | { level: 1 | 3; kind: 'ask-end-activation'; confirmKind: EndActivationConfirmKind; wire: 'none' }
  | { level: 3; kind: 'cancel-hit-and-run'; wire: 'cancel-hit-and-run' }
  | { level: 3; kind: 'clear-selection'; wire: 'none' }
  | { level: 4; kind: 'game-menu'; wire: 'none' };

/** Pure #48 Escape cascade classification. Effects (including the one legal undeclare wire) stay in the view. */
export function escCascadeDecision(input: EscCascadeInput): EscCascadeDecision {
  // #111: a PLAN-OWNED Blitz block-flavor hold is committed and cannot be safely aborted with Escape. Owner
  // 09-28 (S6 follow-up): a NO-PLAN hold (the manual walk-then-click path) has nothing mid-flight to strand —
  // Esc closes the card locally and restores the armed confirm stage, sending nothing (spec S6 item 4).
  if (input.blitzBlockChoiceHeld) {
    if (input.blitzBlockChoiceDismissible) return { level: 1, kind: 'dismiss-blitz-hold', wire: 'none' };
    return { level: 1, kind: 'hold-keep', closeContextMenu: input.contextMenuVisible, wire: 'none' };
  }
  // S42: the Foul / Chainsaw chooser sits at the block-kind chooser's rank, ahead of every other surface.
  if (input.foulChoiceHeld) return { level: 1, kind: 'dismiss-foul-choice', wire: 'none' };

  if (input.blitzSpecialPromptVisible) return { level: 1, kind: 'dismiss-prompt', prompt: 'blitzSpecial', wire: 'none' };
  if (input.wisdomPromptVisible) return { level: 1, kind: 'dismiss-prompt', prompt: 'wisdom', wire: 'none' };
  if (input.endActivationConfirmVisible) return { level: 1, kind: 'dismiss-prompt', prompt: 'endActivation', wire: 'none' };
  if (input.endTurnWarnVisible) return { level: 1, kind: 'dismiss-prompt', prompt: 'endTurn', wire: 'none' };
  if (input.followupChoiceVisible) return { level: 1, kind: 'dismiss-prompt', prompt: 'followup', wire: 'none' };
  if (input.ownSkillChoiceVisible) return { level: 1, kind: 'dismiss-prompt', prompt: 'skillChoice', wire: 'none' };
  if (input.ownRerollPromptVisible) return { level: 1, kind: 'dismiss-prompt', prompt: 'reroll', wire: 'none' };

  // Owner 09-28 (Spec S3 v2 #3, Sol round-3 fix): the Kick 'em Blitz Yes/No card is another level-1 hold, at
  // the same priority as the confirmation/follow-up/skill/reroll surfaces just above — Esc must not race past
  // it. No dismiss exists for it today (unchanged), so this simply refuses to advance the cascade underneath it.
  if (input.kickEmConfirmationCardOpen) return { level: 1, kind: 'hold-keep', closeContextMenu: input.contextMenuVisible, wire: 'none' };
  // Kick 'em Blitz precedence (route clear, THEN nomination cancel) runs ahead of the generic abort-preview
  // bucket below: a plotted route (pendingMove — Kick 'em rides the same o66PendingMove preview as any other
  // movement declare, so no separate input is needed) always wins over a held nomination, and a held
  // nomination always wins over falling through to End Activation. Every OTHER client state is untouched —
  // this branch is a no-op for them.
  if (input.clientState === 'KICK_EM_BLITZ') {
    if (input.pendingMove) return { level: 1, kind: 'abort-preview', wire: 'none' };
    if (input.kickEmNominated) return { level: 1, kind: 'cancel-kick-em-nomination', wire: 'none' };
  }

  if (input.aggroStage === 2) return { level: 1, kind: 'undeclare', wire: 'end-activation' };
  // A nominated foul target belongs to an already server-declared FOUL activation. Backing out sends the same
  // acting-player-null cancellation as Blitz so the authoritative, still-unspent Foul budget is restored - but
  // (owner 10-07) only through the "Cancel Foul" confirmation, which sends that same wire when confirmed.
  // Pre-declaration previews in other states remain local-only aborts.
  const routeCancelAsk = plottedRouteCancelConfirmKind(input);
  if (routeCancelAsk) return { level: 1, kind: 'ask-end-activation', confirmKind: routeCancelAsk, wire: 'none' };
  if (input.pendingMove || input.pendingPass || input.pendingPunt || input.pendingHandOff
    || input.pendingFoul || input.thrownMatePending || input.pendingBlock
    || input.armedGazeVictim
    || input.aggroStage === 1) {
    return { level: 1, kind: 'abort-preview', wire: 'none' };
  }

  if (input.contextMenuVisible) return { level: 2, kind: 'close-menu', target: 'context', wire: 'none' };
  if (input.gameMenuOpen || input.settingsOpen) return { level: 2, kind: 'close-menu', target: 'game-settings', wire: 'none' };
  if (input.popupVisible) return { level: 2, kind: 'close-menu', target: 'popup', wire: 'none' };

  if (input.pendingGaze) {
    return { level: 3, kind: 'ask-end-activation', confirmKind: 'generic', wire: 'none' };
  }

  // g1960010 (owner 11-03): Esc in Hit and Run is upstream's "Cancel Hit And Run" - a cancel of the move-away only,
  // never an End Activation card (the server decides whether the activation goes on).
  if (input.myTurn && input.actingPlayerId && input.clientState === 'HIT_AND_RUN') {
    return { level: 3, kind: 'cancel-hit-and-run', wire: 'cancel-hit-and-run' };
  }
  if (input.myTurn && input.actingPlayerId && input.clientState && isActiveActivation(input.clientState)) {
    // Owner 09-28 (Sol round-3 item 3): was `clientState === 'BLITZ'` only, so Esc offered "End Activation" in
    // KICK_EM_BLITZ (and SELECT_BLITZ_TARGET / PUTRID_REGURGITATION_BLITZ) generically-classified — confirming
    // it then sent blitzConfirmed:false and the store's blitzEndConfirmationRequired gate refused the wire
    // ("Blitz end blocked"), so Esc could offer End Activation but never actually end it. Every state
    // requiresBlitzEndConfirmation covers must classify 'blitz' here, matching the right-click path
    // (SpectateView.vue's requestEndActivation) exactly.
    const confirmKind: EndActivationConfirmKind = requiresBlitzEndConfirmation(input.clientState) ? 'blitz'
      : input.clientState === 'PUNT' ? 'punt' : declaredActionEndConfirmKind(input.clientState) ?? 'generic';
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
  /** P0 g1963245: an adjacent Blitz target whose block is NOT available because no square is left to spend on it
   *  (BlockLogicExtension.java:189). Nothing is sent; the view says why (the unavailable-action toast). */
  | { kind: 'blitzBlockUnavailable'; defenderId: string; reason: 'noMoveLeft' }
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

/** States whose upstream logic module answers an acting-player click through MoveLogicModule.playerInteraction:
 *  Move itself and the bb2025 Pass / HandOver / Punt / Foul / Gaze / GazeMove / ThrowTeamMate modules (each calls
 *  `super.playerInteraction` for the acting player; KTM's KickTeamMateLikeThrowLogicModule does the same). */
const MOVE_LOGIC_SELF_CLICK_STATES = new Set<ClientStateId>([
  'MOVE', 'PASS', 'HAND_OVER', 'PUNT', 'FOUL', 'THROW_TEAM_MATE', 'KICK_TEAM_MATE', 'GAZE', 'GAZE_MOVE',
]);
/** bb2025 BombLogicModule / ThrowKegLogicModule.playerInteraction: the acting player always gets the action menu. */
const ALWAYS_MENU_SELF_CLICK_STATES = new Set<ClientStateId>(['BOMB', 'THROW_KEG']);
const TEAM_MATE_THROW_ACTIONS = new Set(['throwTeamMate', 'throwTeamMateMove', 'kickTeamMate', 'kickTeamMateMove']);

/**
 * Owner 11-03 (RickWreckless, client 1.0.301: "declare ttm, moved, left click thrower to bring up menu and it ended
 * activation instead"): match upstream. True when upstream would answer a left-click on the acting player with the
 * action menu (`InteractionResult.selectAction`) rather than `deselectActingPlayer()`.
 *
 * MoveLogicModule.actionAvailable, read from what the server sent:
 *  - actingPlayer.hasActed() → actingHasActed (hasMoved/hasFouled/hasBlocked/hasPassed/hasTriggeredEffect/usedSkills/
 *    forgone), plus hasJumped and a spent step (currentMove > 0 outside a stand-up), the End Activation row's own test;
 *  - canJump → jumpCapabilityAvailable (bb2025 JumpMechanic.canJump: canLeap or a prone/stunned player adjacent, never
 *    movesRandomly; no move budget), checked on its own since not every state carries a Jump row;
 *  - canPlaceCarriedPlayer → canPlaceCarriedPlayerNow; canDropBall with the ball → hasCanDropBallProperty (raw, no
 *    My Ball cancellation) + isBallCarrier (both read directly: their rows exist in fewer states than these hold);
 *  - isSpecialAbilityAvailable → an enabled non-End row the menu already assembled (star rules, I'll Carry You);
 *  - PASS_MOVE or HAND_OVER_MOVE while carrying the ball;
 *  - any Throw / Kick Team-Mate action (always true upstream, so its thrower always gets the menu).
 *  canGazeDuringMove is BB2016-only (HypnoticGaze bb2016) and has no BB2025 carrier.
 * Per-state overrides: bb2025 FoulLogicModule opens the Bloodlust menu (isSufferingBloodLust) ahead of the Move check;
 * bb2025 PuntLogicModule.actionAvailable (:48-53) replaces the Move test with hasActed, PUNT_MOVE with the ball, any
 * PUNT action, or I'll Carry You available.
 */
export function actingSelfClickMenuAvailable(
  game: GameJson | null | undefined,
  state: ClientStateId,
  actions: ReadonlyArray<CoachAction>,
): boolean {
  if (!game) return false;
  if (ALWAYS_MENU_SELF_CLICK_STATES.has(state)) return true;
  if (!MOVE_LOGIC_SELF_CLICK_STATES.has(state)) return false;
  const acting = game.actingPlayer as {
    playerId?: string | null; playerAction?: string | null; currentMove?: number; standingUp?: boolean;
    hasJumped?: boolean; sufferingBloodlust?: boolean;
  } | undefined;
  const actingId = String(acting?.playerId ?? '');
  if (!acting || !actingId) return false;
  const action = String(acting.playerAction ?? '');
  if (state === 'FOUL' && acting.sufferingBloodlust === true) return true;
  const stepped = (Number(acting.currentMove) || 0) > 0 && acting.standingUp !== true;
  const hasActed = actingHasActed(game, actingId) || acting.hasJumped === true || stepped;
  if (state === 'PUNT') {
    return hasActed
      || (action === 'puntMove' && isBallCarrier(game, actingId))
      || action === 'punt'
      || illCarryYouAvailable(game, actingId);
  }
  if (hasActed || jumpCapabilityAvailable(game, actingId)) return true;
  // canPlaceCarriedPlayer and canDropBall-with-the-ball are upstream predicates in their own right: their menu rows
  // are narrower (Place Carried Player is a MOVE-rail row; the Fumblerooski row needs a moving action), so read the
  // server state directly rather than through the rows. The menu may then hold End Activation only, as upstream's.
  if (canPlaceCarriedPlayerNow(game, actingId)) return true;
  // MoveLogicModule.java:365 reads the RAW property (Player.hasSkillProperty, no cancellation): My Ball does not
  // suppress the menu here; it only removes the Fumblerooski row (fumblerooskieAvailable, LogicModule.java:582).
  if (hasCanDropBallProperty(game, actingId) && isBallCarrier(game, actingId)) return true;
  if (actions.some((a) => a.enabled && a.kind !== 'endMove')) return true;
  if ((action === 'passMove' || action === 'handOverMove') && isBallCarrier(game, actingId)) return true;
  return TEAM_MATE_THROW_ACTIONS.has(action);
}

/** Bomb tile clicks. The renderer dispatches an eligible TILE before the token under it, and a stationary bomber with
 *  no walking reach arms an unrestricted tile pick, so the thrower's own square can arrive here as a tile. Upstream
 *  that square is the thrower's token (BombLogicModule.playerInteraction → the action menu); every other square
 *  follows BombLogicModule.fieldInteraction: a Hail Mary Bomb takes any square, a Throw Bomb needs a passing
 *  distance (passTargetInTemplate). `actorMenu` = hand the click to the thrower's player-click route. */
export function bombTileClickRoute(
  game: GameJson | null | undefined,
  ctx: ClientStateContext,
  square: [number, number],
): { kind: 'notBomb' } | { kind: 'actorMenu'; playerId: string } | { kind: 'nominate'; square: [number, number] } | { kind: 'ignore' } {
  if (!game || deriveClientState(game, ctx) !== 'BOMB') return { kind: 'notBomb' };
  const acting = actingPlayerId(game);
  if (!acting) return { kind: 'notBomb' };
  const actorSquare = normSquare((game.fieldModel?.playerDataArray ?? [])
    .find((d) => (d as { playerId?: string }).playerId === acting)?.playerCoordinate);
  if (actorSquare && sameSquare(actorSquare, square)) return { kind: 'actorMenu', playerId: acting };
  return passTargetInTemplate(game, acting, square) ? { kind: 'nominate', square } : { kind: 'ignore' };
}

/** bb2025 BombLogicModule.playerInteraction: the acting player's own token is the action menu (`selectAction`), never
 *  a bomb target; every other token is a square pick (`perform().with(playerCoordinate)`). The view's Bomb token
 *  interception consults this so the actor's click reaches the router (openActionMenu) and sends nothing — for a
 *  Hail Mary Bomb too, whose any-square template would otherwise accept the thrower's own square. */
export function bombPlayerClickRoute(
  game: GameJson | null | undefined,
  ctx: ClientStateContext,
  playerId: string,
): { kind: 'notBomb' } | { kind: 'router' } | { kind: 'nominate'; square: [number, number] } | { kind: 'ignore' } {
  if (!game || deriveClientState(game, ctx) !== 'BOMB') return { kind: 'notBomb' };
  const acting = actingPlayerId(game);
  if (!acting) return { kind: 'notBomb' };
  if (playerId === acting) return { kind: 'router' };
  const square = normSquare((game.fieldModel?.playerDataArray ?? [])
    .find((d) => (d as { playerId?: string }).playerId === playerId)?.playerCoordinate);
  return square && passTargetInTemplate(game, acting, square) ? { kind: 'nominate', square } : { kind: 'ignore' };
}

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

/** Astra 10-10 (P2), seen in g1951755 (Mary Galzar, commandNr 1443-1447): the BB2025 blitz wire is
 *  clientActingPlayer(blitzMove) -> [server: selectBlitzTarget] -> targetSelected -> [server: selection over] -> THEN
 *  clientBlitzMove. The declare frame alone already carries playerAction blitzMove and move squares under turnMode
 *  regular, so "derives BLITZ" is not the acknowledgement: a stored quick-click route started on it sent a
 *  clientBlitzMove the server ignored, and the selectBlitzTarget frame then flushed the plan.
 *
 *  This reads the server's own outcome, by STATUS (upstream TargetSelectionState.Status: STARTED, CANCELED, SELECTED,
 *  SKIPPED, FAILED), never by the mere presence of a player id:
 *   - SELECTED (StepSelectBlitzTarget: a target on the other team; carries its id) -> 'selected': blitz movement
 *     proceeds and that player is the block target (StepSelectBlitzTargetEnd -> BLITZ_MOVE).
 *   - SKIPPED (no standing opponent, `new TargetSelectionState().skip()`: NO id) -> 'skipped': blitz movement
 *     proceeds, there is no block target.
 *   - CANCELED (a self-target: the blitz is called off, the server returns to player selection) and FAILED (Bone Head,
 *     Really Stupid, Animal Savagery, Foul Appearance, Unchannelled Fury, a failed stand-up: the action ends; this one
 *     can still carry the id of the target that was picked) -> 'void': nothing may be sent for this blitz.
 *   - no state yet, STARTED, or the turn mode still selectBlitzTarget -> 'pending'.
 *  The selectBlitzTarget DIALOG is deliberately not read: the server sets the target state and restores the turn mode
 *  in one frame and clears the dialog in a later one (g1951755: 1445 then 1446), and after a self-target cancel it
 *  never clears it at all (g986). Status + turn mode cannot go true early (both land in the same frame, after the
 *  server has finished the selection) and cannot be held false by a dialog that outlived its phase. */
export type BlitzTargetOutcome = { kind: 'pending' } | { kind: 'selected'; targetId: string } | { kind: 'skipped' } | { kind: 'void' };
export function blitzTargetOutcome(game: GameJson | null | undefined): BlitzTargetOutcome {
  if (!game || String(game.turnMode ?? '') === 'selectBlitzTarget') return { kind: 'pending' };
  const state = (game.fieldModel as { targetSelectionState?: { playerId?: unknown; targetSelectionStatus?: unknown } | null } | undefined)?.targetSelectionState;
  const status = String(state?.targetSelectionStatus ?? '');
  if (status === 'SELECTED') {
    const targetId = String(state?.playerId ?? '');
    return targetId ? { kind: 'selected', targetId } : { kind: 'pending' }; // SELECTED always names its target upstream
  }
  if (status === 'SKIPPED') return { kind: 'skipped' };
  if (status === 'CANCELED' || status === 'FAILED') return { kind: 'void' };
  return { kind: 'pending' };
}
/** The server has taken THIS target (or, with no id given, some target) for the blitz. */
export function blitzTargetAcknowledged(game: GameJson | null | undefined, targetId?: string | null): boolean {
  const outcome = blitzTargetOutcome(game);
  return outcome.kind === 'selected' && (!targetId || outcome.targetId === targetId);
}
/** What the view does with a stored quick-click Blitz route on each frame: wait while the selection is pending, start
 *  the approach once the server has taken THAT target, or drop the route for every other outcome (another target, a
 *  skipped / cancelled / failed selection): it was plotted to contact with the player the coach clicked. */
export function storedBlitzRouteDisposition(game: GameJson | null | undefined, targetId: string): 'wait' | 'start' | 'drop' {
  const outcome = blitzTargetOutcome(game);
  if (outcome.kind === 'pending') return 'wait';
  return outcome.kind === 'selected' && outcome.targetId === targetId ? 'start' : 'drop';
}
/** A stored quick-click route belongs to one activation of one player on our own turn. Every other exit (the turn
 *  passed, another player is acting, the seat stopped playing) retires it: nothing else would, and while it is held it
 *  short-circuits enemy clicks, tile clicks and Space. */
export function storedBlitzRouteOutlived(input: { playing: boolean; myTurn: boolean; actingId: string; routePlayerId: string }): boolean {
  return !input.playing || !input.myTurn || (!!input.actingId && input.actingId !== input.routePlayerId);
}
/** May a Blitz plan put its first command on the wire? `targetId` = the plan's block target (null for a walk-only
 *  plan). 'send' once the selection is over in the plan's favour, or after the block (hasBlocked: the server cleared
 *  the selection and returned the blitzer to blitzMove - ordinary movement again). 'wait' while the selection is
 *  pending. 'void' when this plan can never run: the blitz was called off or failed, the server took another target,
 *  or the selection was skipped and the plan wanted a block. */
export function blitzPlanGate(game: GameJson | null | undefined, targetId: string | null): 'send' | 'wait' | 'void' {
  if (actingHasBlocked(game)) return 'send';
  const outcome = blitzTargetOutcome(game);
  if (outcome.kind === 'pending') return 'wait';
  if (outcome.kind === 'void') return 'void';
  if (outcome.kind === 'skipped') return targetId ? 'void' : 'send';
  return !targetId || outcome.targetId === targetId ? 'send' : 'void';
}
/** The acting player's block is on the wire (server actingPlayerSetHasBlocked) - the activation's block is spent. */
export function actingHasBlocked(game: GameJson | null | undefined): boolean {
  return (game?.actingPlayer as { hasBlocked?: boolean } | undefined)?.hasBlocked === true;
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
/** Upstream `ActingPlayer.hasOnlyStandingUpMove` (ActingPlayer.java:497-499): the acting player is standing up and its
 *  currentMove is exactly Constant.MINIMUM_MOVE_TO_STAND_UP (3) - the stand-up the declaration charged
 *  (bb2025 StepInitSelecting.prepareStandingUp:527-533 sets currentMove = min(3, MA)). A player with MA 1 or 2 is charged
 *  less and is NOT covered, exactly as on the server. */
export function standUpOnlyMove(acting: { standingUp?: boolean | null; currentMove?: number | null } | null | undefined): boolean {
  return !!acting && acting.standingUp === true && Number(acting.currentMove ?? 0) === 3;
}

type UntouchedActing = {
  currentMove?: number; standingUp?: boolean; hasMoved?: boolean; hasBlocked?: boolean; hasFouled?: boolean; hasPassed?: boolean;
  hasTriggeredEffect?: boolean; forgone?: boolean; usedSkills?: string[];
};
/** Skills whose use the server rolls back on such an end, so they do not count as acting: Incorporeal
 *  (canAvoidDodging - StepInitSelecting:173-177, :187-196 markSkillUnused) and I'll Carry You (canCarryPartner -
 *  UtilServerGame.undoPickUpPartner on every end branch, :179-181, :190-192, :197-199). */
const END_ROLLBACK_SKILLS = new Set(['incorporeal', 'illcarryyou']);

/** Upstream ActingPlayer.hasActed (ActingPlayer.java:464-467) minus the skills the end rolls back. */
function actedBeyondRollback(ap: UntouchedActing): boolean {
  const norm = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');
  return !!(ap.hasMoved || ap.hasFouled || ap.hasBlocked || ap.hasPassed || ap.hasTriggeredEffect || ap.forgone
    || (ap.usedSkills ?? []).some((skill) => !END_ROLLBACK_SKILLS.has(norm(String(skill)))));
}

/** Ending now backs the activation out without spending it (Pass / Hand-off / Foul / Punt / Move, and a Blitz before its
 *  target is chosen): the actor has not acted - ActingPlayer.hasActed (ActingPlayer.java:464-467), rollback skills aside.
 *  No movement test (review round 2): the plain end (bb2025 StepInitSelecting:186-202) and the no-target Blitz end
 *  (bb2025 StepSelectBlitzTarget:232-242) check only hasActed; UtilActingPlayer.changeActingPlayer:36-46 then puts a
 *  stood-up player back PRONE and leaves it ACTIVE - whatever the stand-up charged (an MA 1-2 player is charged 1-2). */
export function activationUntouched(game: GameJson | null | undefined): boolean {
  const ap = game?.actingPlayer as UntouchedActing | null | undefined;
  return !!ap && !actedBeyondRollback(ap);
}

/** Ending a declared Blitz now refunds it (the copy may say "The blitz will be refunded."), in the server's two phases:
 *  - Target chosen (`fieldModel.targetSelectionState` present): bb2025 StepInitSelecting:149-157, 161-184 - the block
 *    unused (`!hasBlocked`), `currentMove == 0 || hasOnlyStandingUpMove()`, and the selection NOT committed (a committed
 *    one raises the server's own confirmEndAction, :158-160). `hasMoved` is not asked: the target selection's stand-up
 *    (bb2025 SelectBlitzTarget:20-23 -> StepStandUp:137-138) sets it while the charge stays 3. Then blitzUsed(false),
 *    the old state restored as PRONE.
 *  - No target yet: the activation must be untouched (activationUntouched) - a Blitz that has acted (e.g. Baleful Hex
 *    before the target, which spends the skill and the Blitz, bb2025 StepBalefulHex:136, 176, 193-198) is not refunded
 *    (StepSelectBlitzTarget:232-242 asks its own confirmation; UtilActingPlayer:40-46 leaves the player standing and
 *    inactive). */
export function blitzEndRefunds(game: GameJson | null | undefined): boolean {
  const ap = game?.actingPlayer as UntouchedActing | null | undefined;
  if (!game || !ap) return false;
  const tss = (game.fieldModel as { targetSelectionState?: { targetSelectionStatusIsCommitted?: unknown } | null } | undefined)?.targetSelectionState;
  if (tss) {
    // The movement condition lives HERE only (StepInitSelecting:155-157): `currentMove == 0 || hasOnlyStandingUpMove()`.
    const movement = Number(ap.currentMove ?? 0) === 0 || standUpOnlyMove(ap);
    return !ap.hasBlocked && movement && tss.targetSelectionStatusIsCommitted !== true;
  }
  return activationUntouched(game);
}

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
  const standUpOnly = standUpOnlyMove(acting); // the server's hasOnlyStandingUpMove (shared with blitzEndRefunds)
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
  // state's enemy-click routing below (targetSelected / multiBlockToggle / block). Owner 11-03 (match upstream):
  // the menu opens whenever upstream's actionAvailable (per state, actingSelfClickMenuAvailable) holds — a TTM/KTM
  // thrower always, Bomb/Keg always, Gaze once acted — and the direct end stays only where upstream deselects.
  if (NON_WALK_DECLARED_ACTION_STATES.has(state) && clickedPlayerId === actingPlayerId(game)) {
    const actions = availableActions(game, ctx, clickedPlayerId);
    // Owner 09-28 (Spec S5 audit): a disabled "<rule> - Not Available" row must never count as a declare here —
    // without the `.enabled` guard its mere presence would force this self-click into the menu instead of the
    // direct end/target-pending shortcut below, even with zero real actions to take. Currently unreachable in
    // practice (a plain enabled `move` row always survives alongside any disabled row for BLOCK/BLITZ/
    // SELECT_BLITZ_TARGET, and no other NON_WALK state can carry a disabled row at all) — kept as the correct
    // invariant regardless (see starRuleNotAvailable.test.ts's ordering test for the fixture that proves the point).
    const hasDeclare = actions.some((a) => a.kind === 'declare' && a.enabled);
    // Blitz self-interaction must remain a menu surface. Returning the direct endMove intent here lets a caller
    // accidentally bypass the mandatory confirmation card; the store backstop also refuses that wire.
    if (!hasDeclare && !requiresBlitzEndConfirmation(state) && !actingSelfClickMenuAvailable(game, state, actions)) {
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
      // g1950364 (mudarra93, Frenzy blitz): once the block is on the wire (hasBlocked) the server owns the rest of
      // it - dice, pushback, follow-up and a Frenzy second block. A defender click in that window armed a
      // "Confirm Block" stage that outlived the block into the blitzMove rail afterwards.
      if (actingHasBlocked(game)) return { kind: 'ignore', reason: 'the block is already resolving' };
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
    // S46: the second beat is the OPPOSING coach's pick (the shooter is not mine, either team's standing player within 3 of the
    // original target); that coach has no decline, so the shooter's self-click is inert here.
    const secondBeat = isBlastinSecondBeat(game);
    if (clickedPlayerId === actingPlayerId(game)) return secondBeat ? { kind: 'ignore', reason: "blastin': choose who is hit (no decline)" } : { kind: 'endMove' };
    const acting = actingPlayerId(game);
    if (acting && blastinTargetIds(game, acting, ctx.blastinReportedTargetId).includes(clickedPlayerId)) {
      return { kind: 'blastinTarget', targetId: clickedPlayerId };
    }
    return { kind: 'ignore', reason: secondBeat ? "blastin': click a STANDING player within 3 squares of the first target" : "blastin': click a STANDING opponent within 3 squares, or your own player to decline" };
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
      // mixed/PutridRegurgitationBlitzLogicModule.java:39-40: the rush prompt opens the acting player's menu, no send.
      const actingNow = actingPlayerId(game);
      if (state === 'PUTRID_REGURGITATION_BLITZ' && actingNow && rushPromptBeforeAttack(game)) {
        return { kind: 'openActionMenu', playerId: actingNow, actions: availableActions(game, ctx, actingNow) };
      }
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
      // Upstream BlitzLogicModule.playerInteraction offers the block only while !actingPlayer.hasBlocked(): after
      // the blitz block (BB2025 lets the blitzer keep moving) an adjacent opponent is just another opponent.
      if (acting && !actingHasBlocked(game) && adjacentStandingEnemyIds(game, acting).includes(clickedPlayerId)) {
        // P0 g1963245: BlockLogicExtension.java:189 - a Blitz block needs a square left to spend (or a pinned blitzer).
        const verdict = blitzBlockMoveVerdict(game, acting);
        // BlitzLogicModule.java:50-51: the next square is a Rush the server has not flagged - the acting player's menu opens.
        if (verdict === 'rushPrompt') return { kind: 'openActionMenu', playerId: acting, actions: availableActions(game, ctx, acting) };
        if (verdict === 'noMoveLeft') return { kind: 'blitzBlockUnavailable', defenderId: clickedPlayerId, reason: 'noMoveLeft' };
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
      if (acting && adjacentDownEnemyIds(game, acting).includes(clickedPlayerId)) {
        // bb2025 FoulLogicModule.java:43-44: the next square is a Rush the server has not flagged - the acting menu opens.
        if (rushPromptBeforeAttack(game)) return { kind: 'openActionMenu', playerId: acting, actions: availableActions(game, ctx, acting) };
        return { kind: 'foulTarget', defenderId: clickedPlayerId };
      }
      return { kind: 'inspect', playerId: clickedPlayerId };
    }
    // own player → shared switch/menu/end handling below
  }

  // A.5 (o66j #8) HAND_OVER: completion is exactly one click on an ADJACENT OWN teammate (clientHandOver;
  // game_801 15:25). The acting-player re-click still falls through to shared end/menu handling; every OTHER
  // own-player click is terminal here so it cannot open the generic WALK_STATES action menu.
  if (state === 'HAND_OVER' && isMine(clickedPlayerId)) {
    const acting = actingPlayerId(game);
    // Audit 11-12: upstream canPlayerGetHandOver (tackle zones + the Animosity race check, not only adjacency).
    if (clickedPlayerId !== acting && acting && handOffCatcherAllowed(game, acting, clickedPlayerId)) {
      return { kind: 'handOverTarget', catcherId: clickedPlayerId };
    }
    if (clickedPlayerId !== acting) {
      return { kind: 'ignore', reason: 'own player not adjacent during hand-off' };
    }
  }
  // F1-1: an OPPONENT takes the hand-off only in the HAND_OVER action (the coach's "Hand-off to Any Player" toggle),
  // never in the ordinary HAND_OVER_MOVE: bb2025 / mixed HandOverLogicModule.playerInteraction:37-46 sends handOver for
  // any non-acting player that passes canPlayerGetHandOver:62-76 (`|| playerAction == HAND_OVER`) with the ball in
  // hand (:78-85). handOffCatcherAllowed is that check. Any other opponent click stays an inspection.
  if (state === 'HAND_OVER' && !isMine(clickedPlayerId)) {
    const acting = actingPlayerId(game);
    const action = String((game.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? '');
    if (acting && action === 'handOver' && handOffCatcherAllowed(game, acting, clickedPlayerId)) {
      return { kind: 'handOverTarget', catcherId: clickedPlayerId };
    }
  }

  // PASS: a click on a non-acting player throws at their square only where upstream's would (Task 3 below; the A.5
  // "any player's square" variant is kept behind PASS_CLICK_THROWS_AT_ANY_PLAYER_SQUARE, off). A self-click must fall
  // through to the shared WALK menu below: PassLogicModule.actionContext (bb2025:186-195) adds the in-action
  // Pass Ball (any square) / HAIL_MARY_PASS choices there, alongside the activation actions from availableActions.
  if (state === 'PASS' && clickedPlayerId !== actingPlayerId(game)) {
    const acting = actingPlayerId(game);
    const tp = (game.fieldModel?.playerDataArray ?? []).find((d) => (d as { playerId?: string }).playerId === clickedPlayerId) as { playerCoordinate?: unknown } | undefined;
    const sq = normSquare(tp?.playerCoordinate);
    if (!sq) return { kind: 'ignore', reason: 'pass target has no square' };
    // Task 3 (owner 11-13, pass parity): upstream PassLogicModule.playerInteraction:40-61 - nothing once passed; a Hail
    // Mary Pass throws at any player; otherwise in range and, in PASS_MOVE, only at a team-mate who can catch
    // (canPlayerGetPass: tackle zones + the Animosity race check); in PASS at any player. passTargetAllowed owns it (and
    // the kept square-throw variant behind PASS_CLICK_THROWS_AT_ANY_PLAYER_SQUARE). A refused opponent stays an inspection.
    if (!passTargetAllowed(game, acting, sq)) {
      return isMine(clickedPlayerId)
        ? { kind: 'ignore', reason: 'not a pass target (in a Pass Move only a team-mate who can catch, in range)' }
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
  // on the ACTING player is upstream's "Cancel Hit And Run" (sendEndTurn(turnMode)): the store's endActivation routes
  // hitAndRun to cancelHitAndRun, which cancels the move-away only (g1960010). The kind stays endMove so every layout's
  // existing End route reaches it. Handled before the generic WALK_STATES menu path below.
  if (state === 'HIT_AND_RUN') {
    if (clickedPlayerId === actingPlayerId(game)) return { kind: 'endMove' };
    return { kind: 'ignore', reason: 'hit & run: click a highlighted square to move away, or your own player to cancel Hit and Run' };
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
    // Owner 09-28 (Spec S5 audit): same `.enabled` guard as the NON_WALK branch above — a disabled
    // "<rule> - Not Available" row must not turn this implicit deselect into a 1-item menu open.
    const hasDeclare = actions.some((a) => a.kind === 'declare' && a.enabled);
    // Owner 11-03 (match upstream): the acting player's self-click opens the menu wherever upstream's
    // actionAvailable holds (moved, ball carrier on Pass/Hand-off Move, Bloodlust on a Foul, an in-action row).
    // Where upstream would deselect, law 10e keeps this click inert (End Activation = menu/Esc).
    // bb2025 PuntLogicModule.actionAvailable is authoritative for Punt: its Jump / generic rows never open the menu.
    const selfMenu = state === 'PUNT'
      ? actingSelfClickMenuAvailable(game, state, actions)
      : hasDeclare || actingSelfClickMenuAvailable(game, state, actions);
    if (clickedPlayerId === actingPlayerId(game) && !selfMenu) {
      return { kind: 'ignore', reason: 'law 10e: own-player left-click is inert (End Activation = menu/Esc)' };
    }
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
    // PASS open ground (not a walk square); other WALK states have no open-square target. PC-1 (Meero SR-211): the
    // range template still gates it (inside passTargetAllowed). Task 3 (owner 11-13, pass parity): PassLogicModule.fieldInteraction:63-81 - in PASS_MOVE a square click walks
    // (delegates to Move: only a server move square, handled above), it never throws; in PASS / HAIL_MARY_PASS it
    // throws at a square in range. The kept square-throw variant (switch on) throws from passMove too.
    if (state === 'PASS') {
      if (passTargetAllowed(game, actingPlayerId(game), square)) return { kind: 'passTarget', square };
      return { kind: 'ignore', reason: 'not a pass target (a Pass Move square click walks; or out of range)' };
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
