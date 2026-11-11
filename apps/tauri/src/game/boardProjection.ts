import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { turnSideIsHome } from './blastinSecondBeat';

/** Durable board/coach-panel facts. No receive trackers, effects or renderer sequence numbers. */
export interface BoardProjection {
  playingIsHome: boolean | null;
  sawActiveBit: boolean;
  turnKey: string;
  activePlayerId: string | null;
  actedPlayers: string[];
}
export function createBoardProjection(): BoardProjection {
  return { playingIsHome: null, sawActiveBit: false, turnKey: '', activePlayerId: null, actedPlayers: [] };
}
/** Turn modes the server enters INSIDE a coach's activation and leaves again with the same acting player (the blitz
 *  target pick: regular -> selectBlitzTarget -> regular). They are not a turn boundary: Elyod 10-16 (1.0.228, three
 *  reports) could not End a blitz after its block because the flip back to regular had nulled the receive-time
 *  acting mirror and marked the actor cleared (the P0 #2 boundary reset), so the cancel was refused as "nothing
 *  declared"; a Jump toggle (a fresh declaration echo) un-wedged it. */
/** Owner 10-16 (regression sweep): every mode the fork server enters INSIDE a coach's turn and leaves again
 *  (setTurnMode(getLastTurnMode()) in StepSelectBlitzTarget / StepSelectGazeTarget / StepLookIntoMyEyes /
 *  StepInitBlocking (selectBlockKind) / StepRaidingParty / StepHitAndRun / StepThenIStartedBlastin / StepPlaceBall
 *  (safePairOfHands), and the passing / bomb / wizard / trickster / illegal-substitution sub-modes the behaviours set
 *  and their end steps restore). None of them is a team turn; the side / turn numbers in the key still are. */
const MID_ACTIVATION_SUB_MODES: Record<string, string> = {
  ...Object.fromEntries(['selectBlitzTarget', 'selectGazeTarget', 'selectBlockKind', 'raidingParty', 'hitAndRun', 'thenIStartedBlastin',
    'safePairOfHands', 'trickster', 'dumpOff', 'interception', 'bombHome', 'bombAway', 'wizard', 'illegalSubstitution',
    // Upstream 3.4.0 (43a845f6c / 351cdeed9): the ACTIVE team's On the Ball reaction to an opposing Dump-off. homePlaying
    // does not flip, the acting player goes null / the pass blocker and the interrupted actor is restored afterwards
    // (StepPassBlock restoreFrom), so it sits inside the blitzer's activation like the dump-off itself.
    'dumpOffPassBlock'].map((mode) => [mode, 'regular'])),
  // Astra 10-18: the kick-off Bombardier modes sit inside the `blitz` kick-off phase (upstream BombardierBehaviour), not the regular turn
  bombHomeBlitz: 'blitz', bombAwayBlitz: 'blitz',
};
/** A bomb mode names the BOMBER's team (Home / Away): the acting player changes team on every return throw (upstream
 *  StepEndBomb), so a bomb's side comes from its mode, never from the current catcher. null = not a bomb mode. */
function bombSideIsHome(mode: string): boolean | null {
  return mode.startsWith('bombHome') ? true : mode.startsWith('bombAway') ? false : null;
}
/** A `skillUse` prompt addressed to a player of the team that is NOT the activation's (the defender's Safe Pair of
 *  Hands / Trickster ...): the server flips homePlaying to that coach for the prompt while the mode is still `regular`
 *  (upstream StepPlaceBall for Safe Pair of Hands); it is part of the reaction, not a team turn. */
function opposingSkillPromptOpen(g: GameJson, activationIsHome: boolean): boolean {
  const dp = g.dialogParameter as { dialogId?: unknown; playerId?: unknown } | null | undefined;
  if (!dp || String(dp.dialogId ?? '') !== 'skillUse') return (g as { waitingForOpponent?: unknown }).waitingForOpponent === true;
  const pid = String(dp.playerId ?? '');
  const promptedIsHome = g.teamHome.playerArray.some((p) => p.playerId === pid) ? true : g.teamAway.playerArray.some((p) => p.playerId === pid) ? false : null;
  return promptedIsHome !== null && promptedIsHome !== activationIsHome;
}
export const MID_ACTIVATION_TURN_MODES: ReadonlySet<string> = new Set(Object.keys(MID_ACTIVATION_SUB_MODES));
/** The team whose activation is running: the acting player's team; null without one or when he is on neither roster. */
function activationSideIsHome(g: GameJson): boolean | null {
  const id = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (!id) return null;
  if (g.teamHome.playerArray.some((p) => p.playerId === id)) return true;
  if (g.teamAway.playerArray.some((p) => p.playerId === id)) return false;
  return null;
}
export function boardTurnKey(g: GameJson): string {
  const turnMode = String(g.turnMode);
  // Astra 10-18: a bomb (or an interception nested in one, lastTurnMode = the bomb mode) belongs to the bomber's team
  const bombMode = bombSideIsHome(turnMode) !== null ? turnMode : turnMode === 'interception' && bombSideIsHome(String(g.lastTurnMode ?? '')) !== null ? String(g.lastTurnMode) : null;
  // Astra 10-18 r3: with no prior key (a seed inside a bomb) the bomb's side is UNKNOWN to this reader - the mode name
  // is in the server's orientation (wrong for the away coach's transformed feed) and upstream keeps both teams'
  // turnStarted true through a bomb. The key says so ('?'): boardTurnKeyAfter carries it until the turn numbers move
  // (every real team-turn boundary increments the incoming team's turnNr, StepEndTurn), so no side flip inside this
  // turn, the bomb's end included, is read as a boundary.
  if (bombMode) return `${MID_ACTIVATION_SUB_MODES[bombMode]}:?:${g.turnDataHome?.turnNr}:${g.turnDataAway?.turnNr}`;
  // RickWreckless 10-20 (FUMBBL g1955027 #106-#108, 1.0.246): a Blitz on the kick-off Blitz! / Charge free turn (turn mode
  // `blitz`) enters selectBlitzTarget and returns to `blitz` (upstream setTurnMode(getLastTurnMode())). The table's
  // `regular` parent read that as two team-turn boundaries inside the free turn: the acting mirror was cleared and the
  // end of the blitz read "nothing declared". A sub-mode's parent is the phase it returns to: the server's lastTurnMode
  // when that is one of the activation phases (`regular` / `blitz`), else the table's default.
  const sub = MID_ACTIVATION_SUB_MODES[turnMode];
  const lastMode = String(g.lastTurnMode ?? '');
  const mode = sub ? (sub !== 'blitz' && (lastMode === 'regular' || lastMode === 'blitz') ? lastMode : sub) : g.turnMode;
  // JamToast / JDWhitee 10-18 (1.0.235-236, FUMBBL g1954283 #3290-3293, g1954254 #1751-1754): a defender's Trickster
  // runs as a sub-mode of the blitzing team's turn AND flips homePlaying to the defender for its frames. The side of a
  // mid-activation sub-mode is the ACTIVATION's team (the acting player's), never the flipped homePlaying, so the key
  // stays that of the regular turn it sits in (1.0.230 keyed the mode but still read the flipped side: the team-turn
  // reset cleared the acting mirror and End Blitz read "nothing declared").
  const activation = activationSideIsHome(g);
  // Sol r1 (dump-off pass block): a sub-mode entered from ANOTHER sub-mode (dumpOff -> dumpOffPassBlock, dumpOff ->
  // interception ...) cannot name its activation phase - lastTurnMode is the other sub-mode. Its phase is unknown ('~')
  // to this reader; boardTurnKeyAfter inherits the prior key, and a key SEEDED here (reconnect inside the reaction)
  // holds until the turn numbers or the side move, so the return to `blitz` / `regular` is no false boundary.
  if (sub && MID_ACTIVATION_SUB_MODES[lastMode] && bombSideIsHome(lastMode) === null) {
    return `~:${activation ?? turnSideIsHome(g)}:${g.turnDataHome?.turnNr}:${g.turnDataAway?.turnNr}`;
  }
  // Astra 10-18 (Safe Pair of Hands): still `regular`, the side flipped to the opposing coach for his skill prompt
  const reactionPrompt = !sub && turnMode === 'regular' && activation !== null && activation !== turnSideIsHome(g) && opposingSkillPromptOpen(g, activation);
  const side = sub ? (activation ?? turnSideIsHome(g)) : reactionPrompt ? activation : turnSideIsHome(g);
  return `${mode}:${side}:${g.turnDataHome?.turnNr}:${g.turnDataAway?.turnNr}`; // S46: the Blastin' second-beat flip is not a turn change
}
/** Astra 10-18 r2: the bomb modes name the bomber's team in the SERVER's orientation (bombHome / bombAway), but the away
 *  coach is served a transformed model (rosters swapped, homePlaying flipped: upstream Game.transform) while turn modes
 *  keep their names - so the name alone cannot say which model-side the bomb belongs to. A bomb is thrown inside a
 *  turn this reader already keyed: while a bomb mode (or an interception nested in one) is up, the key is the PRIOR
 *  key when that key sits in the bomb's parent phase with the same turn numbers; the name-derived key is only the
 *  fallback (a seed inside a bomb, where the prior key is primed from the same model anyway). */
export function boardTurnKeyAfter(priorKey: string | null | undefined, g: GameJson): string {
  const fresh = boardTurnKey(g);
  if (!priorKey) return fresh;
  const [priorPhase, priorSide, priorHomeNr, priorAwayNr] = priorKey.split(':');
  const [freshPhase, , freshHomeNr, freshAwayNr] = fresh.split(':');
  const sameTurn = priorHomeNr === freshHomeNr && priorAwayNr === freshAwayNr;
  // Astra 10-18 r3: a key seeded inside a bomb (side '?') stays until the turn numbers move: the bomb's end is no boundary
  if (priorSide === '?' && priorPhase === freshPhase && sameTurn) return priorKey;
  const turnMode = String(g.turnMode);
  const bombMode = bombSideIsHome(turnMode) !== null ? turnMode : turnMode === 'interception' && bombSideIsHome(String(g.lastTurnMode ?? '')) !== null ? String(g.lastTurnMode) : null;
  if (!bombMode) {
    // A sub-mode entered from ANOTHER sub-mode (dumpOff -> dumpOffPassBlock -> dumpOff, dumpOff -> interception) cannot
    // name its activation phase from lastTurnMode (that is the other sub-mode), so the table's `regular` default would
    // read a kick-off Blitz! free turn's dump-off reaction as a team-turn boundary. Same turn numbers, same side and a
    // prior key in an activation phase: the prior key stands.
    const [, freshSide] = fresh.split(':');
    const activationPhase = (phase: string | undefined) => phase === 'regular' || phase === 'blitz' || phase === '~';
    // a chained sub-mode ('~') inside a keyed activation phase, or a '~' seed returning to its activation phase
    if ((freshPhase === '~' || priorPhase === '~') && activationPhase(priorPhase) && activationPhase(freshPhase)
      && priorSide === freshSide && sameTurn) return priorKey;
    return fresh;
  }
  const parent = MID_ACTIVATION_SUB_MODES[bombMode];
  return priorPhase === parent && sameTurn ? priorKey : fresh;
}
export function reduceBoardProjection(previous: BoardProjection, game: GameJson, input: {
  recoveringPlayers: readonly string[];
  reports: readonly Record<string, unknown>[];
  /** Player-seat acknowledgement policy; spectator/replay readers pass the cursor's acting id. */
  acknowledgedActingId: string | null;
  followupAttackerId: string | null;
}): BoardProjection {
  const rawHome = turnSideIsHome(game);
  const playingIsHome = previous.playingIsHome === null || game.turnMode !== 'betweenTurns'
    ? rawHome : previous.playingIsHome;
  const players = game.fieldModel.playerDataArray;
  const homeIds = new Set(game.teamHome.playerArray.map((p) => p.playerId));
  const movingId = players.find((p) => (p.playerState & 0xff) === 2)?.playerId ?? null;
  const activeBitId = players.find((p) => (p.playerState & 0x100) !== 0 && homeIds.has(p.playerId) === rawHome)?.playerId ?? null;
  const activeByState = input.acknowledgedActingId ?? movingId;
  const sawActiveBit = previous.sawActiveBit || !!activeBitId || !!activeByState;
  const acting = game.actingPlayer?.playerId ?? null;
  const notation = input.reports.map((r) => r.actingPlayerId ?? r.playerId ?? r.defenderId).find((id): id is string => typeof id === 'string') ?? null;
  const over = game.turnMode === 'endGame' || !!game.finished
    || !!game.gameResult?.teamResultHome?.conceded || !!game.gameResult?.teamResultAway?.conceded;
  let activePlayerId = over ? null : sawActiveBit ? activeByState : activeByState ?? acting ?? notation;
  if (!over && acting && input.followupAttackerId === acting) activePlayerId = acting;
  const turnKey = boardTurnKeyAfter(previous.turnKey, game);
  if (turnKey !== previous.turnKey) activePlayerId = null;
  const actedPlayers = over ? [] : players.filter((p) => {
    if (p.playerId === activePlayerId || (p.playerState & 0x100) !== 0 || homeIds.has(p.playerId) !== playingIsHome) return false;
    const base = p.playerState & 0xff;
    if (base !== 1 && !(base === 3 && !input.recoveringPlayers.includes(p.playerId))) return false;
    const c = p.playerCoordinate;
    return !!c && c[0] >= 0 && c[0] <= 25 && c[1] >= 0 && c[1] <= 14;
  }).map((p) => p.playerId);
  return { playingIsHome, sawActiveBit, turnKey, activePlayerId, actedPlayers };
}
