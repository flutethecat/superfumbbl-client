/**
 * Resolve the persistent selection-arrow IDs for shaded picks. Charge supplies the complete multi-pick in
 * `arrowIds`; High Kick supplies its separate single staged nominee. Eligibility remains server-owned.
 */
export function shadedPlayerPickArrowIds(
  shaded: boolean,
  eligibleIds: ReadonlySet<string> | null,
  arrowIds: ReadonlySet<string> | null,
  selectedId: string | null,
): string[] {
  if (!shaded) return [];
  if (arrowIds) {
    return [...arrowIds].filter((playerId) => eligibleIds?.has(playerId));
  }
  return selectedId ? [selectedId] : [];
}
