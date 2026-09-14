export interface SpectatorConcedeNotice {
  side: 'home' | 'away';
  teamName: string;
  coach: string;
}

/** Stable through clock refreshes and seeks to the same conceded result. */
export function spectatorConcedeOccurrenceKey(
  source: { sessionId: string } | null | undefined,
  gameId: string | number | null | undefined,
  notice: SpectatorConcedeNotice | null | undefined,
): string | null {
  if (!source || !notice) return null;
  return JSON.stringify([source.sessionId, gameId ?? '', notice.side, notice.teamName, notice.coach]);
}

/** A shootout result is one dismissible occurrence even when its checkpoint is republished. */
export function spectatorPenaltyShootoutOccurrenceKey(
  source: { sessionId: string } | null | undefined,
  gameId: string | number | null | undefined,
  result: Readonly<Record<string, unknown>> | null | undefined,
): string | null {
  if (!source || !result) return null;
  const { seq: _publicationSequence, ...semanticResult } = result;
  return JSON.stringify([source.sessionId, gameId ?? '', 'penalty-shootout', semanticResult]);
}
