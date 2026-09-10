import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { casualtySppEarnedThisGame, sppEarnedThisGame } from './logic/sppEarned';

export type SppTotalsSnapshot = ReadonlyMap<string, number>;
export interface SppGainOccurrence { playerId: string; delta: number; total: number; seq: number }
export type SppGainCause = 'casualty' | 'other';
export interface SppGainPart extends Omit<SppGainOccurrence, 'seq'> { cause: SppGainCause }
export type SppBreakdownSnapshot = ReadonlyMap<string, { total: number; casualty: number }>;

function starPlayerIds(game: GameJson): Set<string> {
  const ids = new Set<string>();
  for (const team of [game.teamHome, game.teamAway]) {
    const positions = (team.roster as { positionArray?: Array<{ playerType?: unknown; positionId?: unknown }> } | undefined)
      ?.positionArray ?? [];
    const starPositions = new Set(positions
      .filter((position) => String(position.playerType ?? '').toLowerCase() === 'star')
      .map((position) => String(position.positionId)));
    for (const player of team.playerArray ?? []) {
      if (String(player.playerType ?? '').toLowerCase() === 'star' || starPositions.has(String(player.positionId))) {
        ids.add(player.playerId);
      }
    }
  }
  return ids;
}

/** Snapshot server-owned PlayerResult achievement totals before a model-change frame mutates them in place. */
export function captureSppTotals(game: GameJson): Map<string, number> {
  const totals = new Map<string, number>();
  const gameResult = game.gameResult;
  if (!gameResult) return totals;
  for (const [team, result] of [
    [game.teamHome, gameResult.teamResultHome],
    [game.teamAway, gameResult.teamResultAway],
  ] as const) {
    if (!Array.isArray(result?.playerResults)) continue;
    const rules = (team as { specialRules?: string[] }).specialRules;
    for (const player of result.playerResults) {
      totals.set(player.playerId, sppEarnedThisGame(player as unknown as Record<string, unknown>, rules));
    }
  }
  return totals;
}

export function captureSppBreakdown(game: GameJson): Map<string, { total: number; casualty: number }> {
  const totals = new Map<string, { total: number; casualty: number }>();
  const gameResult = game.gameResult;
  if (!gameResult) return totals;
  for (const [team, result] of [[game.teamHome, gameResult.teamResultHome], [game.teamAway, gameResult.teamResultAway]] as const) {
    if (!Array.isArray(result?.playerResults)) continue;
    const rules = (team as { specialRules?: string[] }).specialRules;
    for (const player of result.playerResults) {
      const record = player as unknown as Record<string, unknown>;
      totals.set(player.playerId, {
        total: sppEarnedThisGame(record, rules),
        casualty: casualtySppEarnedThisGame(record, rules),
      });
    }
  }
  return totals;
}

/** Split authoritative gains so only casualty-owned SPP waits for casualty presentation. */
export function collectSppGainParts(before: SppBreakdownSnapshot, game: GameJson): SppGainPart[] {
  const after = captureSppBreakdown(game);
  const stars = starPlayerIds(game);
  const gains: SppGainPart[] = [];
  for (const [playerId, current] of after) {
    if (stars.has(playerId)) continue;
    const previous = before.get(playerId) ?? { total: 0, casualty: 0 };
    const casualty = Math.max(0, current.casualty - previous.casualty);
    const total = Math.max(0, current.total - previous.total);
    const other = Math.max(0, total - casualty);
    if (other) gains.push({ playerId, delta: other, total: current.total, cause: 'other' });
    if (casualty) gains.push({ playerId, delta: casualty, total: current.total, cause: 'casualty' });
  }
  return gains;
}

/** Compare two authoritative PlayerResult snapshots; no scoring event is inferred from reports or local actions. */
export function collectSppGains(before: SppTotalsSnapshot, game: GameJson): Omit<SppGainOccurrence, 'seq'>[] {
  const after = captureSppTotals(game);
  const stars = starPlayerIds(game);
  const gains: Omit<SppGainOccurrence, 'seq'>[] = [];
  for (const [playerId, total] of after) {
    const delta = total - (before.get(playerId) ?? 0);
    if (delta > 0 && !stars.has(playerId)) gains.push({ playerId, delta, total });
  }
  return gains;
}
