export interface MatchLogVisibilityEntry {
  kind: 'report' | 'talk' | 'system';
  category?: 'server-sequencing';
}

/** Internal client sequencing is stored with the ordinary match log so diagnostics and
 * bug reports retain it. The user preference only controls whether that history is shown. */
export function sequencingCategory(
  kind: MatchLogVisibilityEntry['kind'],
  text: string,
): MatchLogVisibilityEntry['category'] | undefined {
  const serverSequencedPlay = text.startsWith('play:') && [
    'server resolves',
    'server-sequenced',
    'server confirms',
    'server re-rolls + re-presents',
    'server scatters',
    'server rolls confuse',
    'awaiting server',
  ].some((marker) => text.includes(marker));
  const turnoverLifecycle = text.startsWith('↩ turnover armed')
    || text.startsWith('↩ turnover splash fired');
  // Owner 09-09: the socket close trio after a game ("connection: closed", "connection closed (1000)",
  // "connection closed after game end ... suppressing reconnect prompt") is transport chatter — kept for
  // diagnostics, hidden from the default log.
  const connectionClose = text.startsWith('connection: closed') || text.startsWith('connection closed');
  return kind === 'system' && (text.startsWith('plan:') || serverSequencedPlay || turnoverLifecycle || connectionClose)
    ? 'server-sequencing'
    : undefined;
}

export function visibleMatchLogEntries<T extends MatchLogVisibilityEntry>(
  entries: readonly T[],
  showServerSequencingEvents: boolean,
): T[] {
  return entries.filter((entry) =>
    entry.kind !== 'talk'
      && (showServerSequencingEvents || entry.category !== 'server-sequencing'),
  );
}
