// ORDER 66 — Phase A, step 1: the ClientStateMachine skeleton.
//
// A faithful TS port of the official FUMBBL client's `ClientStateFactory.getStateForGame()`
// (`ffb-client-logic/.../client/state/ClientStateFactory.java`). The client's interactive state is a PURE
// FUNCTION of the server-synced game model — no timers, no ack-waits, no prediction: a command can only be
// issued from a state the server has already confirmed, because the state literally IS the model. This is
// the ⚖ server-derived law implemented structurally, and the contract the server was built against.
//
// Spec: docs/artifact-orchestration/logic-module-binding.md · upstream-client-activation-reference.md.
// This file is the SKELETON only — it derives the state id. The per-state input handling (SELECT/MOVE/…)
// and the UI wiring land in the following Phase-A steps. Pure + side-effect-free so Echo's golden-master
// harness can assert `deriveClientState(capturedModel) === official-client-state` per frame.
//
// ⚠ Perspective (owner correction 2026-07-11): the RENDER mirrors the local team to the bottom, but the MODEL
// and every WIRE reference keep the TRUE Home/Away identity the matchmaker assigned — `game.homePlaying` and
// `pushbackSquare.homeChoice` are true-home values, NOT "my side". So "is it my turn / my choice" is computed
// relative to the local coach's TRUE side (`ctx.myIsHome`, resolved by coach match like store.isMyTurn), same
// as upstream getStateForGame combines `game.isHomePlaying()` with the client's own home flag. Do NOT assume
// homePlaying === my turn — that only holds when the local coach is true-home.

import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { PLAYER_ACTION_REGISTRY, playerActionFallbackState } from '../playerActionRegistry';

/** The client interactive states (subset of upstream's 53 ClientStateIds — the ones our dispatch reaches).
 *  `WAIT` = it's the opponent's move (upstream WAIT_FOR_OPPONENT); `WAIT_SETUP` = opponent setting up. */
export type ClientStateId =
  | 'REPLAY' | 'LOGIN' | 'SPECTATE' | 'START_GAME'
  | 'WAIT' | 'WAIT_SETUP'
  | 'SELECT_PLAYER' | 'PUSHBACK'
  | 'MOVE' | 'BLITZ' | 'BLOCK' | 'SYNCHRONOUS_MULTI_BLOCK'
  | 'FOUL' | 'HAND_OVER' | 'PASS' | 'PUNT'
  | 'THROW_TEAM_MATE' | 'KICK_TEAM_MATE' | 'KICK_TEAM_MATE_THROW'
  | 'SWOOP' | 'GAZE' | 'GAZE_MOVE' | 'BOMB' | 'THROW_KEG'
  | 'MAXIMUM_CARNAGE' | 'PUTRID_REGURGITATION_BLITZ' | 'PUTRID_REGURGITATION_BLOCK'
  | 'KICK_EM_BLITZ' | 'KICK_EM_BLOCK' | 'STAB' | 'FURIOUS_OUTBURST'
  | 'SELECT_BLITZ_TARGET' | 'SELECT_GAZE_TARGET' | 'SELECT_BLOCK_KIND' | 'HIT_AND_RUN' | 'THEN_I_STARTED_BLASTIN'
  | 'KICKOFF' | 'KICKOFF_RETURN' | 'SWARMING' | 'PASS_BLOCK'
  | 'SETUP' | 'SOLID_DEFENCE' | 'HIGH_KICK' | 'QUICK_SNAP' | 'ILLEGAL_SUBSTITUTION'
  | 'TOUCHBACK' | 'INTERCEPTION' | 'DUMP_OFF' | 'WIZARD' | 'PLACE_BALL'
  // spec-199 R-B1 (Fable/Meero SR-191): the trickster hole + the full turnMode audit vs upstream ClientStateFactory.
  // These five top-level turnModes derived UNKNOWN (unmapped) → both seats' lock DISENGAGED while a coach was
  // choosing. Mapped verbatim to upstream getStateForGame (ClientStateFactory:341 TRICKSTER, :320 PLACE_CARRIED_PLAYER,
  // :328 RAIDING_PARTY, :355 DWARFEN_WISDOM, :362 END_GAME→wait-both).
  | 'TRICKSTER' | 'PLACE_CARRIED_PLAYER' | 'RAIDING_PARTY' | 'DWARFEN_WISDOM'
  | 'UNKNOWN';

/** Turn modes that map straight to an active-coach state when it's my turn (else I'm waiting). */
const TURNMODE_ACTIVE_STATE: Record<string, ClientStateId> = {
  hitAndRun: 'HIT_AND_RUN', selectBlitzTarget: 'SELECT_BLITZ_TARGET', selectGazeTarget: 'SELECT_GAZE_TARGET',
  // #48/EC-3b (fork bb2025 StepThenIStartedBlastin.java:129 setTurnMode(THEN_I_STARTED_BLASTIN)): the "Blastin Solves
  // Everything" remote-block target-select runs under its OWN turnMode → upstream getStateForGame (ClientStateFactory
  // :348) maps it to ClientStateId.THEN_I_STARTED_BLASTIN. We were deriving UNKNOWN (unmapped turnMode) — NOT the
  // SELECT_PLAYER the view's EC-3b patch (d2fbcfc2) assumed — so that patch's Esc-cancel gate never matched. end-
  // Activation cancels it via CLIENT_END_TURN (de647e20). Now a mapped active state; isActiveActivation includes it.
  thenIStartedBlastin: 'THEN_I_STARTED_BLASTIN',
  // bb2025 StepInitBlocking sets this turnMode for a deferred block-kind pick (stab/chainsaw/vomit/…);
  // upstream getStateForGame → SELECT_BLOCK_KIND. Was deriving UNKNOWN (order66-special-actions-review §1).
  selectBlockKind: 'SELECT_BLOCK_KIND',
  kickoff: 'KICKOFF', kickoffReturn: 'KICKOFF_RETURN', swarming: 'SWARMING', passBlock: 'PASS_BLOCK',
  highKick: 'HIGH_KICK', quickSnap: 'QUICK_SNAP', illegalSubstitution: 'ILLEGAL_SUBSTITUTION',
  wizard: 'WIZARD', safePairOfHands: 'PLACE_BALL',
  bombHome: 'BOMB', bombHomeBlitz: 'BOMB', bombAway: 'BOMB', bombAwayBlitz: 'BOMB',
  // spec-199 R-B1: the trickster hole + audit finds — all `isHomePlaying ? STATE : WAIT_FOR_OPPONENT` upstream
  // (ClientStateFactory:341/:320/:328), so the `default` branch's `iAmActing ? active : 'WAIT'` mirrors them exactly.
  trickster: 'TRICKSTER', placeCarriedPlayer: 'PLACE_CARRIED_PLAYER', raidingParty: 'RAIDING_PARTY',
};

/** spec-220 M-1 / SR-243 Q-2: interactive kickoff events are structural members of the active-state map. */
export function turnModeIsInteractive(turnMode: string | null | undefined): boolean {
  return TURNMODE_ACTIVE_STATE[String(turnMode ?? '')] != null;
}

export interface ClientStateContext {
  /** 'player' = we can act; 'spectator'/'replay' short-circuit to a passive view. */
  mode: 'player' | 'spectator' | 'replay';
  /** Has the game model arrived (team names present)? false → LOGIN/loading. */
  loggedIn: boolean;
  /**
   * The local coach's TRUE side (matchmaker/wire identity): true iff my team is `teamHome`. This is a
   * SEPARATE fact from the render mirror (we always DRAW the local team at the bottom) — `homePlaying`,
   * `homeChoice`, and every wire reference are true-home values, so "is it my turn / my choice" must be
   * computed relative to my true side, NOT assumed home. Resolve it like store.isMyTurn (match `play.coach`
   * against teamHome/teamAway). Defaults to `true` (self-play / home coach) so existing callers + goldens are
   * unchanged; the SpectateView wiring passes the resolved value so the away coach derives correctly.
   */
  myIsHome?: boolean;
  /** True while a skill lets this player block two foes at once (MULTIPLE_BLOCK → multi-block state). */
  canBlockTwoAtOnce?: boolean;
  /** Gameplay preference: a friendly-player click may leave the current movement activation. */
  friendlyPlayerSwitch?: boolean;
}

interface FieldModelLike { pushbackSquareArray?: { homeChoice?: boolean }[] }
interface ActingLike { playerId?: string | null; playerAction?: string | null }

/**
 * Derive the client's interactive state id from the server model — the pure-function port of
 * `getStateForGame()`. No side effects; reads only the (model-immediate / receive-time) game model.
 */
export function deriveClientState(game: GameJson | null | undefined, ctx: ClientStateContext): ClientStateId {
  if (!game) return 'LOGIN';
  if (ctx.mode === 'replay') return 'REPLAY';
  if (!ctx.loggedIn) return 'LOGIN';
  if (ctx.mode === 'spectator') return 'SPECTATE';
  if ((game as { finished?: unknown }).finished != null) return 'SPECTATE';

  const myIsHome = ctx.myIsHome ?? true;
  // iAmActing = is it MY side's turn — the true-home `homePlaying` flag matched against my true side. NOT the
  // render mirror. (Default myIsHome=true ⇒ iAmActing===homePlaying, identical to the pre-perspective build.)
  const iAmActing = !!game.homePlaying === myIsHome;
  const acting = (game.actingPlayer ?? {}) as ActingLike;
  const field = (game.fieldModel ?? {}) as FieldModelLike;
  const turnMode = String(game.turnMode ?? '');

  // waitingForOpponent during my own setup/turn = wait.
  if (iAmActing && (game as { waitingForOpponent?: boolean }).waitingForOpponent) return 'WAIT';

  switch (turnMode) {
    case 'regular':
    case 'blitz': {
      if (!iAmActing) return findPassiveState(game); // opponent's turn → reaction/passive states
      if (!acting.playerId) return 'SELECT_PLAYER';     // no acting player → pick one (the ONLY declare state)
      if (hasPushback(field)) return 'PUSHBACK';        // server offered pushback squares → pick direction
      const action = String(acting.playerAction ?? '');
      // #58: a `multipleBlock` declare routes to SYNCHRONOUS_MULTI_BLOCK only for a `canBlockTwoAtOnce` carrier (the
      // BB2025 "Multiple Block" skill), else it degrades to a single BLOCK. Derive the carrier from the acting
      // player's skillArray (the same match availableActions' offer uses) — `ctx.canBlockTwoAtOnce` stays an optional
      // OVERRIDE (goldens/tests). This is the derive that "lands last": until it returned true the seam was inert
      // (the offer fell back to BLOCK), so the store senders + the router's multiBlockToggle were unreachable.
      if (action === 'multipleBlock') {
        const canTwo = ctx.canBlockTwoAtOnce ?? actingHasMultipleBlock(game, String(acting.playerId ?? ''));
        return canTwo ? 'SYNCHRONOUS_MULTI_BLOCK' : 'BLOCK';
      }
      return playerActionFallbackState(action);
    }
    case 'startGame': return 'START_GAME';
    // Between-turns transition (turnover/end-of-turn interval): neither coach acts — passive WAIT for both
    // sides (upstream getStateForGame yields a wait-like state). Graduates Echo's 6 'no-UNKNOWN' goldens.
    case 'betweenTurns': return 'WAIT';
    // spec-199 R-B2 (the sixth gap Echo's completeness tooth 489c2589 surfaced; Yularen GO 07-29): NO_PLAYERS_TO_FIELD
    // has NO explicit case in upstream ClientStateFactory.getStateForGame — like BETWEEN_TURNS it falls to `default:
    // break` leaving clientStateId null (getStateForId(null) → no interactive ClientState = wait-like). Transient
    // setup mode (StepSetup.java:132 sets it, StepEndTurn.java:228 auto-resolves — a coach with no players to field
    // ends the turn); neither seat acts. Map → WAIT both seats, the betweenTurns precedent, so the lock ENGAGES
    // rather than disengaging on UNKNOWN. (TurnMode.java:15 wire string "noPlayersToField".)
    case 'noPlayersToField': return 'WAIT';
    case 'setup':
    case 'perfectDefence': return iAmActing ? 'SETUP' : 'WAIT_SETUP';
    case 'solidDefence': return iAmActing ? 'SOLID_DEFENCE' : 'WAIT_SETUP';
    // touchback / interception / dump-off are the passive coach's reaction states (opponent's turn)
    case 'touchback': return !iAmActing ? 'TOUCHBACK' : 'WAIT';
    case 'interception': return reactionSide(game, myIsHome) ? 'INTERCEPTION' : 'WAIT';
    case 'dumpOff': return !iAmActing ? 'DUMP_OFF' : 'WAIT';
    // spec-199 R-B1 audit finds that don't fit the isHomePlaying→active default: dwarfenWisdom's non-acting seat is
    // WAIT_FOR_SETUP (not _OPPONENT), and endGame is WAIT for BOTH (server auto-rolls the finish). Mirrors
    // ClientStateFactory:355 / :362.
    case 'dwarfenWisdom': return iAmActing ? 'DWARFEN_WISDOM' : 'WAIT_SETUP';
    case 'endGame': return 'WAIT';
    default: {
      const active = TURNMODE_ACTIVE_STATE[turnMode];
      if (active) return iAmActing ? active : 'WAIT';
      return 'UNKNOWN'; // a turnMode the skeleton hasn't mapped yet (surfaced, never silently mis-stated)
    }
  }
}

function hasPushback(field: FieldModelLike): boolean {
  return Array.isArray(field.pushbackSquareArray) && field.pushbackSquareArray.length > 0;
}

/** A pushback square the server flagged as MY choice. VERBATIM from upstream `PushbackLogicModule`
 *  (findUnlockedPushbackSquare, ffb-client-logic): the client sends a square iff `pushbackSquare.isHomeChoice()`
 *  — there is NO `game.isHomePlaying()` / true-side comparison. The receiving client's model is perspective-
 *  local, so a square is MINE iff `homeChoice === true`, for whoever holds the model (myIsHome is irrelevant
 *  here). Side Step / chain-pushes route the choice to the defender by setting homeChoice on his squares.
 *  (Was `(homeChoice===true) === myIsHome` — a real Side-Step authority bug: corpus-sidestep-defender is
 *  actingCoach=away with ALL squares homeChoice=true, so the away defender's own squares read "not mine".
 *  The g478 applier dup masked it with a stale homeChoice=false square; Echo/upstream settled 2026-07-12.) */
function pushbackIsMine(field: FieldModelLike): boolean {
  return (field.pushbackSquareArray ?? []).some((s) => s?.homeChoice === true);
}

/** Interception fires for whichever coach ISN'T the thrower — except a DUMP_OFF interception, which the
 *  throwing coach answers. Mirrors getStateForGame's INTERCEPTION guard, relative to my true side. */
function reactionSide(game: GameJson, myIsHome: boolean): boolean {
  const iAmActing = !!game.homePlaying === myIsHome;
  const throwerAction = String((game as { throwerAction?: string | null }).throwerAction ?? '');
  return (!iAmActing && throwerAction !== 'dumpOff') || (iAmActing && throwerAction === 'dumpOff');
}

/** Passive-coach states during the opponent's REGULAR/BLITZ turn. The skeleton returns WAIT; the reaction
 *  states (pushback/interception/dump-off) are reached via their own turnModes above. Fleshed out with the
 *  defender-action handling when the PASS/BLOCK phases land. */
function findPassiveState(game: GameJson): ClientStateId {
  const field = (game.fieldModel ?? {}) as FieldModelLike;
  // The passive coach answers a push ONLY when the server flagged it his choice (`homeChoice === true` on his
  // perspective-local model) — Side Step and chain-pushes route the direction pick to the defender; a normal
  // attacker-chosen push leaves him waiting. (Was gated on `=== myIsHome`, a Side-Step authority bug — see
  // pushbackIsMine.) ⚠ PUSHBACK phase: verify against the side-step golden (rig invariant #4).
  if (pushbackIsMine(field)) return 'PUSHBACK';
  return 'WAIT';
}

/** #58: does the acting player carry the BB2025 "Multiple Block" skill (the `canBlockTwoAtOnce` grantor)? Reads the
 *  skillArray off the team rosters, normalized exactly like availableActions.hasSkill (lower-case, strip non-letters).
 *  Kept INLINE here (not imported from availableActions) because availableActions imports THIS module — importing back
 *  would be a cycle. This is the property that splits `multipleBlock` → SYNCHRONOUS_MULTI_BLOCK vs a single BLOCK. */
function actingHasMultipleBlock(game: GameJson, playerId: string): boolean {
  if (!playerId) return false;
  const teams = [game.teamHome, game.teamAway] as ({ playerArray?: { playerId?: string; skillArray?: string[] }[] } | undefined)[];
  const skills = teams.flatMap((t) => t?.playerArray ?? []).find((p) => p.playerId === playerId)?.skillArray ?? [];
  return skills.some((s) => s.toLowerCase().replace(/[^a-z]/g, '') === 'multipleblock');
}

/** #48/EC-3 (Fives' Esc-cascade, drift-proof source): the ACTIVE own-activation states — a declared/engaged action
 *  where Esc should END the activation (endActivation) rather than drop to the Game Menu. Built from the registry's
 *  values (EVERY declared action — each runs under the regular/blitz turnMode and cancels via `CLIENT_ACTING_PLAYER
 *  {null}` → StepInitSelecting), PLUS the parking/bespoke-cancel states endActivation handles explicitly:
 *  SELECT_BLITZ_TARGET (CLIENT_TARGET_SELECTED{ownId}), HIT_AND_RUN + THEN_I_STARTED_BLASTIN (CLIENT_END_TURN), and
 *  SYNCHRONOUS_MULTI_BLOCK (#58 — unset each SET target then acting-null). Deriving from ACTION_STATE makes it
 *  DRIFT-PROOF: a new declared action added there is covered automatically (Fives d2fbcfc2's ask — no view
 *  enumeration to keep in sync). EXCLUDES SELECT_PLAYER (no activation yet), PUSHBACK/reaction states (own
 *  resolution), and passive/setup/UNKNOWN. ⚠ The acting-null cancel for each declared action is the EC-1 exhaustive
 *  claim (mechanism: StepInitSelecting honors acting-null for a declared action under regular/blitz) — routed to
 *  Meero for per-state [SOURCE] verification of the enumeration. */
const ACTIVE_ACTIVATION_STATES: ReadonlySet<ClientStateId> = new Set<ClientStateId>([
  ...Object.values(PLAYER_ACTION_REGISTRY).flatMap((entry) => entry.clientState ? [entry.clientState] : []),
  'SYNCHRONOUS_MULTI_BLOCK',
  'SELECT_BLITZ_TARGET', 'HIT_AND_RUN', 'THEN_I_STARTED_BLASTIN',
]);

/** #48/EC-3 (exported for the view's Esc step-3 gate): is `state` an ACTIVE own-activation Esc should END? The
 *  shared, drift-proof replacement for SpectateView's hardcoded active-state whitelist (Fives d2fbcfc2 / Meero SR-53). */
export function isActiveActivation(state: ClientStateId): boolean {
  return ACTIVE_ACTIVATION_STATES.has(state);
}
