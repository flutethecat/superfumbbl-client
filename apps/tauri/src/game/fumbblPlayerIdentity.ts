export interface FumbblPlayerIdentity {
  coach: string;
  teamId?: string;
  gameId?: number;
  opponentTeamId?: string;
  opponentCoach?: string;
}

/** Reject a server snapshot before it can become renderer state unless it matches the lobby choice. */
export function validateOfficialPlayerSnapshot(
  snapshot: Record<string, unknown>,
  expected: FumbblPlayerIdentity,
): string | null {
  const servedGameId = Number(snapshot.gameId ?? 0);
  if (expected.gameId && servedGameId !== expected.gameId) {
    return `FUMBBL returned game ${servedGameId || '?'} instead of selected game ${expected.gameId}.`;
  }
  const teams = [snapshot.teamHome, snapshot.teamAway]
    .filter((team): team is Record<string, unknown> => !!team && typeof team === 'object');
  const expectedTeamId = String(expected.teamId ?? '');
  const team = expectedTeamId
    ? teams.find((candidate) => String(candidate.teamId ?? '') === expectedTeamId)
    : teams.find((candidate) => String(candidate.coach ?? '').trim().toLowerCase() === expected.coach.trim().toLowerCase());
  if (!team) return `FUMBBL game ${servedGameId || '?'} does not contain team ${expectedTeamId || '(missing)'}.`;
  if (String(team.coach ?? '').trim().toLowerCase() !== expected.coach.trim().toLowerCase()) {
    return `FUMBBL returned team ${expectedTeamId} for a different coach.`;
  }
  if (expected.opponentTeamId || expected.opponentCoach) {
    const opponent = teams.find((candidate) => candidate !== team);
    if (expected.opponentTeamId && String(opponent?.teamId ?? '') !== expected.opponentTeamId) {
      return `FUMBBL returned a different opponent team than ${expected.opponentTeamId}.`;
    }
    if (expected.opponentCoach
      && String(opponent?.coach ?? '').trim().toLowerCase() !== expected.opponentCoach.trim().toLowerCase()) {
      return `FUMBBL returned a different opponent than ${expected.opponentCoach}.`;
    }
  }
  return null;
}
