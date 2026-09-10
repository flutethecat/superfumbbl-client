export interface PositionGroupCap {
  positions: readonly string[];
  max: number;
  label?: string;
}

export type PositionCounts = ReadonlyMap<string, number> | Readonly<Record<string, number>>;

export interface PositionGroupCapState {
  allowed: boolean;
  capped: boolean;
  blockingGroups: readonly PositionGroupCap[];
}

function countFor(positionCounts: PositionCounts, positionId: string): number {
  const mapLike = positionCounts as ReadonlyMap<string, number>;
  const raw = typeof mapLike.get === 'function'
    ? mapLike.get(positionId)
    : (positionCounts as Readonly<Record<string, number>>)[positionId];
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/**
 * Project whether one more player may be added under roster-wide position groups.
 * A position can belong to several groups; reaching any of them blocks the add.
 */
export function positionGroupCapState(
  candidatePositionId: string,
  positionGroups: readonly PositionGroupCap[] | null | undefined,
  positionCounts: PositionCounts,
  exempt = false,
): PositionGroupCapState {
  if (exempt || !candidatePositionId || !positionGroups) {
    return { allowed: true, capped: false, blockingGroups: [] };
  }

  const blockingGroups: PositionGroupCap[] = [];
  for (const group of positionGroups) {
    const rawGroup = group as Partial<PositionGroupCap> | null | undefined;
    if (!rawGroup || !Array.isArray(rawGroup.positions) || typeof rawGroup.max !== 'number' || !Number.isFinite(rawGroup.max)) continue;
    const positionIds = [...new Set<string>(rawGroup.positions.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0))];
    if (!positionIds.includes(candidatePositionId)) continue;
    const groupCount = positionIds.reduce((sum, positionId) => sum + countFor(positionCounts, positionId), 0);
    if (groupCount >= rawGroup.max) blockingGroups.push(group);
  }

  return {
    allowed: blockingGroups.length === 0,
    capped: blockingGroups.length > 0,
    blockingGroups,
  };
}

/**
 * Remove later slots that overflow a position group, retaining the earliest legal picks.
 * Slot indices, nulls, unaffected entries, and retained object identities stay unchanged.
 */
export function normalizeSlotsForPositionGroups<T extends { positionId: string }>(
  slots: readonly (T | null)[],
  positionGroups: readonly PositionGroupCap[] | null | undefined,
): Array<T | null> {
  const acceptedCounts = new Map<string, number>();
  return slots.map((slot) => {
    if (!slot) return null;
    if (positionGroupCapState(slot.positionId, positionGroups, acceptedCounts).capped) return null;
    acceptedCounts.set(slot.positionId, (acceptedCounts.get(slot.positionId) ?? 0) + 1);
    return slot;
  });
}
