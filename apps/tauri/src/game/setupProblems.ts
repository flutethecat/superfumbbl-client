import { isLeftWideColumn, isRightWideColumn, MAX_PER_WIDE_ZONE, MIN_ON_LOS, type SetupValidation } from '@fumbbl40k/ffb-pitch';

/** Owner 10-03: "If the user has setup incorrectly, the modal should pop and indicate what they did wrong with arrows
 *  on offending players." One line per failed setup condition (the same four the setup pane lists) and the placed
 *  players that cause it. An over-full wide zone names its players; a short line of scrimmage, or a wrong number of
 *  players on the pitch, has no single culprit, so it is text only. Empty `problems` = the setup is legal. */
export interface SetupProblemReview {
  problems: string[];
  offenders: string[];
}

export function setupProblems(
  players: readonly { playerId: string; coord: [number, number] | null; inert?: boolean }[],
  validation: SetupValidation,
): SetupProblemReview {
  const problems: string[] = [];
  const offenders = new Set<string>();
  // Astra review 10-03: an inert player (Solid Defence / Dwarfen Wisdom lock) cannot be moved, so it is never pointed at.
  const placed = players.filter((player): player is { playerId: string; coord: [number, number] } => !!player.coord && player.inert !== true);
  if (!validation.losOk) {
    const needed = Math.min(MIN_ON_LOS, validation.available);
    problems.push(`Only ${validation.onLos} on the line of scrimmage. You need ${needed} in the centre (the wide zones don't count).`);
  }
  if (!validation.leftOk) {
    problems.push(`${validation.leftWide} players in the left wide zone. The limit is ${MAX_PER_WIDE_ZONE}.`);
    for (const player of placed) if (isLeftWideColumn(player.coord[1])) offenders.add(player.playerId);
  }
  if (!validation.rightOk) {
    problems.push(`${validation.rightWide} players in the right wide zone. The limit is ${MAX_PER_WIDE_ZONE}.`);
    for (const player of placed) if (isRightWideColumn(player.coord[1])) offenders.add(player.playerId);
  }
  if (!validation.countOk) {
    problems.push(validation.placed < validation.required
      ? `${validation.placed} of ${validation.required} players placed. Field ${validation.required - validation.placed} more.`
      : `${validation.placed} players placed. The limit is ${validation.required}: send ${validation.placed - validation.required} back to reserves.`);
  }
  return { problems, offenders: [...offenders] };
}
