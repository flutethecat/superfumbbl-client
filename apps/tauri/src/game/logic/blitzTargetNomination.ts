/**
 * Keep a concrete Blitz target click single-owned. A wide-rail election must retain the target locally until the
 * coach answers its skill prompt; an ordinary Blitz target goes straight to the authoritative sender and never
 * touches the quick-Blitz echo ref (whose synchronous watcher is a separate producer).
 */
export function nominateBlitzTarget(
  defenderId: string,
  wideRailElection: (defenderId: string) => unknown,
  holdForWideRail: (defenderId: string) => void,
  send: (defenderId: string) => void,
): 'held' | 'sent' {
  if (wideRailElection(defenderId)) {
    holdForWideRail(defenderId);
    return 'held';
  }
  send(defenderId);
  return 'sent';
}
