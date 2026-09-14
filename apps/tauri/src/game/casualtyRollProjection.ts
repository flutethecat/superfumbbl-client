import type { GameJson } from '@fumbbl40k/ffb-protocol';

export interface CasualtyRollEntry { playerId: string; oldRoll: number | null; newRoll: number | null }
export interface CasualtyRollProjection { players: CasualtyRollEntry[] }
export const createCasualtyRollProjection = (): CasualtyRollProjection => ({ players: [] });
export const casualtyRollFor = (projection: CasualtyRollProjection, playerId: string): CasualtyRollEntry | undefined => projection.players.find((p) => p.playerId === playerId);
export function reduceCasualtyRollProjection(previous: CasualtyRollProjection, reports: readonly Record<string, unknown>[], game: GameJson): CasualtyRollProjection {
  const roster = new Set([...game.teamHome.playerArray, ...game.teamAway.playerArray].map((p) => p.playerId));
  const players = new Map(previous.players.filter((p) => roster.has(p.playerId)).map((p) => [p.playerId, { ...p }]));
  for (const report of reports) {
    const isNew = report.reportId === 'apothecaryRoll';
    if (!isNew && report.reportId !== 'injury') continue;
    const type = injuryTypeName(report.injuryType).toLowerCase();
    if (!isNew && report.armorBroken !== true && !['crowd', 'rock', 'bitten'].some((v) => type.includes(v))) continue;
    const playerId = String((isNew ? report.playerId : report.defenderId ?? report.playerId) ?? '');
    const roll = Array.isArray(report.casualtyRoll) ? report.casualtyRoll[0] : null;
    if (!roster.has(playerId) || typeof roll !== 'number' || !Number.isFinite(roll)) continue;
    const entry = players.get(playerId) ?? { playerId, oldRoll: null, newRoll: null };
    if (isNew) entry.newRoll = roll;
    else entry.oldRoll = roll;
    players.set(playerId, entry);
  }
  return { players: [...players.values()] };
}

export function injuryTypeName(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'name' in v) return String((v as { name: unknown }).name ?? '');
  return '';
}

export function casualtyRollLabel(roll: number): string {
  if (roll < 1 || roll > 16) return '';
  if (roll >= 15) return 'DEAD';
  if (roll >= 13) return 'LASTING INJURY';
  if (roll >= 11) return 'SERIOUS INJURY';
  if (roll >= 9) return 'SERIOUSLY HURT';
  return 'BADLY HURT';
}

export function casualtyRollBase(roll: number): number {
  if (roll < 1 || roll > 16) return 0;
  if (roll >= 15) return 0x08;
  if (roll >= 9) return 0x07;
  return 0x06;
}
