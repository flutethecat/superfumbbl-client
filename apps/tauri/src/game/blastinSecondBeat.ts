import type { GameJson } from '@fumbbl40k/ffb-protocol';

// S46: the SECOND beat of "Blastin' Solves Everything". A failed roll that is not a 1 and has no re-roll (fork
// StepThenIStartedBlastin, cmd 49) flips homePlaying to the OPPOSING coach inside turnMode thenIStartedBlastin, sets
// game.defenderId to the original target and waits for that coach's CLIENT_TARGET_SELECTED (cmd 50 flips it back).
// It is a pick inside the shooter's activation, never a turn change. Pure: game (+ the report-derived fact) in, no store.

const MODE = 'thenIStartedBlastin';

/** The last thenIStartedBlastin report of this activation, kept only while the turn mode stands (store projection). */
export interface BlastinBeatFact {
  actingId: string;
  /** state.appliedFrameSeq of the frame that carried the report. */
  seq: number;
  targetPlayerId: string;
  successful: boolean;
  fumble: boolean;
}

function actingIdOf(game: GameJson): string {
  return String((game.actingPlayer as { playerId?: string | null } | null | undefined)?.playerId ?? '');
}

/** true = home, false = away, null = unknown player. */
function sideOf(game: GameJson, playerId: string): boolean | null {
  if (!playerId) return null;
  if ((game.teamHome?.playerArray ?? []).some((p) => p.playerId === playerId)) return true;
  if ((game.teamAway?.playerArray ?? []).some((p) => p.playerId === playerId)) return false;
  return null;
}

/** The side whose turn it IS. `homePlaying`, except inside turn mode thenIStartedBlastin, where the flip to the choosing
 *  coach is not a turn change: the turn stays with the shooter's side through both beats. Every turn-boundary reader
 *  (turn key, banners, planner, clocks, log turn lines, coach panel) takes this instead of the raw flag. */
export function turnSideIsHome(game: GameJson): boolean {
  if (String(game.turnMode ?? '') === MODE) {
    const shooter = sideOf(game, actingIdOf(game));
    if (shooter !== null) return shooter;
  }
  return !!game.homePlaying;
}

/** Second beat: turn mode thenIStartedBlastin, the shooter belongs to the side that is NOT playing (the flip happened),
 *  and this activation's failed report was not a fumble. Seat-free: the choosing coach is the side homePlaying names. */
export function isBlastinSecondBeat(game: GameJson | null | undefined, fact?: BlastinBeatFact | null): boolean {
  if (!game || String(game.turnMode ?? '') !== MODE) return false;
  const actingId = actingIdOf(game);
  const shooter = sideOf(game, actingId);
  if (shooter === null || shooter === !!game.homePlaying) return false;
  if (fact && fact.actingId === actingId && (fact.fumble || fact.successful)) return false;
  return true;
}

/** The choosing coach's seat: mine when homePlaying names my side during the second beat. */
export function blastinChooserIsMe(game: GameJson | null | undefined, myIsHome: boolean, fact?: BlastinBeatFact | null): boolean {
  return isBlastinSecondBeat(game, fact) && !!game!.homePlaying === myIsHome;
}

/** Where the 3-square range is measured from: the original target (game.defenderId, else the failed report's target). */
export function blastinBeatOriginId(game: GameJson, reportedTargetId?: string | null): string {
  const defender = String((game as { defenderId?: unknown }).defenderId ?? '');
  return defender || String(reportedTargetId ?? '');
}

/** Next projection after a frame. Cleared the moment the turn mode leaves thenIStartedBlastin, when the activation
 *  changes, and on a successful report (the hit frame). */
export function nextBlastinBeatFact(
  previous: BlastinBeatFact | null,
  game: GameJson,
  reports: readonly Record<string, unknown>[],
  seq: number,
): BlastinBeatFact | null {
  if (String(game.turnMode ?? '') !== MODE) return null;
  const actingId = actingIdOf(game);
  let next = previous && previous.actingId === actingId ? previous : null;
  for (const r of reports) {
    if (String(r.reportId ?? '') !== MODE) continue;
    const successful = r.successful === true;
    next = { actingId, seq, targetPlayerId: String(r.targetPlayerId ?? ''), successful, fumble: r.fumble === true };
  }
  return next;
}

/** The waiting line for the shooter's seat and spectators; null outside the second beat. */
export function blastinChoosingText(game: GameJson | null | undefined, fact?: BlastinBeatFact | null): string | null {
  if (!game || !isBlastinSecondBeat(game, fact)) return null;
  const team = game.homePlaying ? game.teamHome : game.teamAway;
  const coach = String(team?.coach ?? team?.teamName ?? '').trim() || 'Opponent';
  return `${coach} is choosing who is hit`;
}

/** The chooser's own notice: "<shooter>'s shot went wide - choose who is hit". */
export function blastinShotWideText(game: GameJson): string {
  const id = actingIdOf(game);
  const player = [...(game.teamHome?.playerArray ?? []), ...(game.teamAway?.playerArray ?? [])].find((p) => p.playerId === id);
  const name = String((player as { playerName?: string } | undefined)?.playerName ?? '').trim() || 'The shooter';
  return `${name}'s shot went wide - choose who is hit`;
}

/** S46 round 3: the server never hides the shooter's failed-roll re-roll card (`StepThenIStartedBlastin.fail()`), so a
 *  `reRoll` / `reRollProperties` dialog for the ACTING player (or naming BlastinSolvesEverything) stands through the whole
 *  second beat. It is stale for everyone but that shooter's own already-answered card: it must not veto the picker's send,
 *  hide the marks, or show a waiting surface. Structural, like the beat itself. */
export function blastinStaleRerollDialog(game: GameJson | null | undefined): boolean {
  if (!game || !isBlastinSecondBeat(game)) return false;
  const dp = game.dialogParameter as { dialogId?: unknown; playerId?: unknown; reRolledAction?: unknown } | null | undefined;
  if (!dp || (dp.dialogId !== 'reRoll' && dp.dialogId !== 'reRollProperties')) return false;
  return String(dp.playerId ?? '') === actingIdOf(game) || /BlastinSolvesEverything/i.test(String(dp.reRolledAction ?? ''));
}
