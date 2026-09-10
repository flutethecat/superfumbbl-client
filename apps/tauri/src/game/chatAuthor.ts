export type ChatAuthorSide = 'home' | 'away' | 'spectator' | 'unknown';
export type ChatToastRole = 'blue' | 'red' | 'green' | 'neutral';
export type ChatViewerSeat = 'home' | 'away' | null;

function normalizedCoach(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Classify a talk command from server-provided coach identity and the two authoritative
 * team coaches. Player display names are deliberately not consulted.
 */
export function chatAuthorSide(
  homeCoach: unknown,
  awayCoach: unknown,
  author: unknown,
): ChatAuthorSide {
  const speaker = normalizedCoach(author);
  if (!speaker || speaker === '?') return 'unknown';
  const home = normalizedCoach(homeCoach);
  const away = normalizedCoach(awayCoach);
  if (home && speaker === home) return 'home';
  if (away && speaker === away) return 'away';
  // An outsider is provably a spectator only when both team-coach identities are present.
  return home && away ? 'spectator' : 'unknown';
}

/**
 * Seat-relative toast mapping. A seated coach always sees their own author as blue and the
 * opponent as red. Spectator/replay viewers retain native home=blue, away=red. Spectator
 * authors are green for every audience; missing authority fails soft to neutral.
 */
export function chatToastRole(
  side: ChatAuthorSide | null | undefined,
  localSeat: ChatViewerSeat,
  seatedPlayer: boolean,
): ChatToastRole {
  if (side === 'spectator') return 'green';
  if (side !== 'home' && side !== 'away') return 'neutral';
  // A connected player whose seat cannot be proven must not silently inherit spectator/native colors.
  if (seatedPlayer && !localSeat) return 'neutral';
  if (!seatedPlayer) return side === 'home' ? 'blue' : 'red';
  return side === localSeat ? 'blue' : 'red';
}
