/**
 * Astra P3 on the replayer (09-14): a snap publish (join snapshot, pause landing, GO TO LIVE landing) reaches the
 * view twice — the game watcher restores the position (a full rebuild) AND the snapshotEpoch watcher rebuilds
 * again. The epoch watcher skips its rebuild only when the game watcher already handled THIS exact publication;
 * a same-model pause landing never fires the game watcher, so identity (not `snap` alone) is the gate.
 */
export function snapshotTickNeedsRebuild(
  published: { readonly snap: boolean } | null | undefined,
  lastRestored: object | null,
): boolean {
  return !(published?.snap && published === lastRestored);
}
