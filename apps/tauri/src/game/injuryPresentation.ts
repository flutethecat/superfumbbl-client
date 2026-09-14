import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { injuryTypeName } from './casualtyRollProjection';
import { casualtyTierLabel } from './injuryOutcomeProjection';
export interface InjuryEvent {
  type: string;
  player: string;
  playerId: string;
  /** B6-1: team the injured player belongs to (banner colour + logo). */
  side: 'home' | 'away';
  logoUrl: string | null;
  /** B7-3: team name shown under the logo. */
  teamName: string;
  square: [number, number] | null;
  foul: boolean;
  isCasualty: boolean;
  /** Owner 07-04: FFB PlayerStateBase byte at injury time — drives the rising injury symbol (KO / cross / skull). */
  injuryBase: number;
  /** Owner 07-08: server-resolved casualty RESULT string (e.g. "Dead (RIP)") — the server applied the casualty table; the toast maps it by keyword. Null for plain Badly Hurt / KO. */
  seriousInjury?: string | null;
  /** #64: split injury taxonomy — `injuryRoll` = the INJURY-ROLL result (STUNNED/KO/CASUALTY); `casualty` = the D16 CASUALTY-ROLL tier/label (+D6 stat for a Lasting Injury). Display-only, derived from injuryBase + seriousInjury. */
  injuryRoll: string;
  casualty?: { tier: string; label: string; stat: string | null } | null;
  /** Owner 07-03: CROWD-PUSH injury (injuryType crowdpush/crowdpushForSpp/ktmCrowd) — crowd-surf cinematic plays BEFORE the injury anim. */
  crowdSurf?: boolean;
  /** Owner 07-04: THROW-A-ROCK injury (injuryType throwARock) — rock-throw cinematic plays BEFORE the injury anim. */
  rockThrow?: boolean;
  /** A stalling rock hit whose authoritative armour roll held. It gets an impact toast, never an invented injury tier. */
  rockImpactOnly?: boolean;
  /** Owner 07-08: VAMPIRE FEED (injuryType "bitten") — 🧛 marker pops over the bitten Thrall BEFORE the injury roll. */
  bitten?: boolean;
}

const INJURY_LABELS: Record<number, string> = {
  0x04: 'STUNNED',
  0x05: 'KNOCKED OUT',
  0x06: 'BADLY HURT',
  0x07: 'SERIOUS INJURY',
  0x08: 'DEAD',
};

/** #64 ([RULES] bb2025): INJURY-ROLL result, 3 tiers — STUNNED (0x04) / KNOCKED OUT (0x05) / all casualty bases ≥0x06 collapse to CASUALTY (severity = the separate 5-step below). */
function injuryRollLabel(base: number): string {
  if (base === 0x04) return 'STUNNED';
  if (base === 0x05) return 'KNOCKED OUT';
  if (base >= 0x06) return 'CASUALTY';
  return 'INJURED';
}


/** Pure injury event conversion; the active presenter owns timing and effects. */
export function injuryPresentation(report: Record<string, unknown>, game: GameJson, coordinate: readonly number[] | null | undefined, foul: boolean): InjuryEvent | null {
  if (report.reportId !== 'injury') return null;
  const armorBroke = report.armorBroken === true;
  const kind = injuryTypeName(report.injuryType).toLowerCase();
  if (!armorBroke && !['crowd', 'rock', 'bitten'].some((type) => kind.includes(type))) return null;
  const playerId = String(report.defenderId ?? report.playerId ?? '');
  if (!playerId) return null;
  const side = game.teamHome.playerArray.some((p) => p.playerId === playerId) ? 'home' : 'away';
  const team = side === 'home' ? game.teamHome : game.teamAway;
  const player = team.playerArray.find((p) => p.playerId === playerId);
  const data = game.fieldModel.playerDataArray.find((p) => p.playerId === playerId);
  const reported = Number(report.injury ?? 0);
  const base = reported >= 4 && reported <= 8 ? reported : (data?.playerState ?? 0) & 0xff;
  const results = side === 'home' ? game.gameResult.teamResultHome.playerResults : game.gameResult.teamResultAway.playerResults;
  const modelSerious = results.find((r) => r.playerId === playerId)?.seriousInjury;
  const seriousInjury = typeof report.seriousInjury === 'string' && report.seriousInjury.trim() ? report.seriousInjury
    : base >= 7 && typeof modelSerious === 'string' ? modelSerious : null;
  const square: [number, number] | null = coordinate && coordinate[0]! >= 0 && coordinate[0]! < 26 && coordinate[1]! >= 0 && coordinate[1]! < 15 ? [coordinate[0]!, coordinate[1]!] : null;
  const rockThrow = kind.includes('rock') && !!square;
  return { type: INJURY_LABELS[base] ?? 'INJURED', injuryRoll: injuryRollLabel(base), casualty: casualtyTierLabel(seriousInjury, base),
    player: player?.playerName ?? '', playerId, side, logoUrl: (team.roster as { logoUrl?: string }).logoUrl ?? null,
    teamName: team.teamName ?? '', square, foul, isCasualty: base >= 6, injuryBase: base, seriousInjury,
    crowdSurf: kind.includes('crowd') && !!square, rockThrow, rockImpactOnly: rockThrow && !armorBroke, bitten: kind.includes('bitten') && !!square };
}

export function armourPresentation(report: Record<string, unknown>, coordinate: readonly number[] | null | undefined) {
  if (report.reportId !== 'injury' || !Array.isArray(report.armorRoll) || report.armorRoll.length !== 2
    || !coordinate || !(coordinate[0]! >= 0 && coordinate[0]! < 26 && coordinate[1]! >= 0 && coordinate[1]! < 15)) return null;
  return { square: [coordinate[0]!, coordinate[1]!] as [number, number],
    rolls: [Number(report.armorRoll[0]), Number(report.armorRoll[1])] as [number, number], broken: !!report.armorBroken };
}
