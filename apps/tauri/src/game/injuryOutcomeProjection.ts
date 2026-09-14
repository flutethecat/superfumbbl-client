import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { casualtyRollFor, reduceCasualtyRollProjection, injuryTypeName, type CasualtyRollProjection } from './casualtyRollProjection';

export interface OriginalInjuryOutcome { playerId: string; injury: string; roll: number | null; square: [number, number] | null }
export interface InjuryOutcomeProjection { players: OriginalInjuryOutcome[] }
export const createInjuryOutcomeProjection = (): InjuryOutcomeProjection => ({ players: [] });
export const injuryOutcomeFor = (projection: InjuryOutcomeProjection, playerId: string): OriginalInjuryOutcome | undefined => projection.players.find((p) => p.playerId === playerId);

/** Preserve original casualty facts across the later apothecary election and acceptance. */
export function reduceInjuryOutcomes(previous: InjuryOutcomeProjection, priorRolls: CasualtyRollProjection, reports: readonly Record<string, unknown>[], game: GameJson, coordinates: ReadonlyMap<string, readonly number[] | null>): InjuryOutcomeProjection {
  const roster = new Set([...game.teamHome.playerArray, ...game.teamAway.playerArray].map((p) => p.playerId));
  const players = new Map(previous.players.filter((p) => roster.has(p.playerId)).map((p) => [p.playerId, p]));
  const seen = new Set<string>();
  let rolls = priorRolls;
  for (const report of reports) {
    rolls = reduceCasualtyRollProjection(rolls, [report], game);
    if (report.reportId !== 'injury') continue;
    const type = injuryTypeName(report.injuryType).toLowerCase();
    if (report.armorBroken !== true && !['crowd', 'rock', 'bitten'].some((v) => type.includes(v))) continue;
    const playerId = String(report.defenderId ?? report.playerId ?? '');
    if (!roster.has(playerId) || seen.has(playerId)) continue;
    seen.add(playerId);
    const data = game.fieldModel.playerDataArray.find((p) => p.playerId === playerId);
    const reportedBase = Number(report.injury ?? 0);
    const base = reportedBase >= 4 && reportedBase <= 8 ? reportedBase : (data?.playerState ?? 0) & 0xff;
    if (base < 6) continue;
    const results = game.teamHome.playerArray.some((p) => p.playerId === playerId) ? game.gameResult.teamResultHome.playerResults : game.gameResult.teamResultAway.playerResults;
    const serious = base >= 7 ? report.seriousInjury ?? results.find((p) => p.playerId === playerId)?.seriousInjury ?? null : null;
    const square = coordinates.get(playerId);
    const onPitch = square && square[0]! >= 0 && square[0]! < 26 && square[1]! >= 0 && square[1]! < 15;
    players.set(playerId, { playerId, injury: casualtyTierLabel(serious == null ? null : String(serious), base)?.label ?? 'Injury',
      roll: casualtyRollFor(rolls, playerId)?.oldRoll ?? null,
      square: onPitch ? [square[0]!, square[1]!] : null });
  }
  return { players: [...players.values()] };
}

export function casualtyTierLabel(seriousInjury: string | null | undefined, base: number): { tier: string; label: string; stat: string | null } | null {
  if (base < 0x06) return null; // not a casualty (stun/KO)
  const s = String(seriousInjury ?? '');
  if (base === 0x08 || /\bdead\b|\(rip\)/i.test(s)) return { tier: 'DEAD', label: 'Dead', stat: null };
  // Lasting Injury (SeriousInjury showSiRoll group) — a stat reduction; the (-XX) suffix is the D6-picked stat.
  const statMatch = s.match(/\(\s*-\s*(AV|MA|PA|AG|ST)\s*\)/i);
  if (statMatch || /head injury|smashed knee|broken arm|dislocated (?:hip|shoulder)/i.test(s)) {
    return { tier: 'LASTING_INJURY', label: 'Lasting Injury', stat: statMatch ? `-${(statMatch[1] ?? '').toUpperCase()}` : null };
  }
  if (/serious injury|\(ni\)/i.test(s)) return { tier: 'SERIOUS_INJURY', label: 'Serious Injury', stat: null };
  if (/seriously hurt|\(mng\)/i.test(s)) return { tier: 'SERIOUSLY_HURT', label: 'Seriously Hurt', stat: null };
  return { tier: 'BADLY_HURT', label: 'Badly Hurt', stat: null }; // base 0x06, or 0x07 with no matched string
}
