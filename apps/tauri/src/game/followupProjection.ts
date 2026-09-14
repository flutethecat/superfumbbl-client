import type { GameJson } from '@fumbbl40k/ffb-protocol';
export interface FollowupProjection {
  attackerId: string | null;
  defenderId: string | null;
  vacated: [number, number] | null;
  pending: { attackerId: string; from: [number, number]; vacated: [number, number]; resolvingAge: number } | null;
  outcome: { attackerId: string; square: [number, number]; followed: boolean } | null;
}
export const createFollowupProjection = (): FollowupProjection => ({ attackerId: null, defenderId: null, vacated: null, pending: null, outcome: null });
const square = (g: GameJson, id: string): [number, number] | null => {
  const c = g.fieldModel.playerDataArray.find(p => p.playerId === id)?.playerCoordinate;
  return c && Number.isInteger(c[0]) && Number.isInteger(c[1]) && c[0] >= 0 && c[0] < 26 && c[1] >= 0 && c[1] < 15 ? [c[0], c[1]] : null;
};
/** Keeps only observed push origins. A mid-decision snapshot cannot establish a vacated square. */
export function reduceFollowupProjection(previous: FollowupProjection, before: GameJson, game: GameJson,
  lastFrom: ReadonlyMap<string, [number, number]>, reports: readonly Record<string, unknown>[]): FollowupProjection {
  const result = structuredClone(previous);
  result.outcome = null;
  const attackerId = game.actingPlayer?.playerId || null;
  const defenderId = String((game as { defenderId?: string }).defenderId || '') || null;
  const freshBlock = reports.some(r => r.reportId === 'blockRoll' || r.reportId === 'block');
  if (freshBlock) result.pending = null;
  if (attackerId !== result.attackerId || defenderId !== result.defenderId || freshBlock) {
    result.attackerId = attackerId; result.defenderId = defenderId; result.vacated = null;
  }
  if (defenderId && lastFrom.has(defenderId)) result.vacated = [...lastFrom.get(defenderId)!];
  const offered = game.dialogParameter?.dialogId === 'followupChoice';
  if (offered && attackerId) {
    if (result.pending?.resolvingAge) result.pending = null;
    if (result.pending?.attackerId !== attackerId) {
      const from = square(before, attackerId);
      result.pending = from && result.vacated ? { attackerId, from, vacated: [...result.vacated], resolvingAge: 0 } : null;
    }
  }
  const pending = result.pending;
  if (pending) {
    const at = square(game, pending.attackerId);
    const followed = !!at && at[0] === pending.vacated[0] && at[1] === pending.vacated[1];
    if (followed || (!offered && ++pending.resolvingAge > 2)) {
      result.outcome = { attackerId: pending.attackerId, square: at ?? [...pending.from], followed };
      result.pending = null;
      result.vacated = null;
    }
  }
  return result;
}
