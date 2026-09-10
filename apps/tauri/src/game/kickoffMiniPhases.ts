import type { GameJson } from '@fumbbl40k/ffb-protocol';

export type KickoffBannerPalette = 'home' | 'away' | 'neutral' | null;

const ACTIVE_SEAT_KICKOFFS = new Set(['blitz', 'charge', 'quicksnap', 'soliddefence', 'highkick']);
/** Owner 09-07: which side ACTS for each seat-aware kickoff — the KICKING team (Blitz!, Solid Defence, Charge) or the
 *  RECEIVING team (Quick Snap, High Kick). With the kicking side known (latched off the last setup frame — the
 *  kicker sets up second) the banner no longer trusts `homePlaying` at the report frame, which lagged the flip in
 *  spectate (a blue Solid Defence for the red team). */
const KICKING_SIDE_KICKOFFS = new Set(['blitz', 'charge', 'soliddefence']);

const normalizeKickoffName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Resolve a kickoff card's palette from the authoritative beneficiary/winner state. */
export function kickoffBannerPalette(
  name: string,
  reports: Record<string, unknown>[],
  game: Pick<GameJson, 'homePlaying' | 'teamHome' | 'teamAway'>,
  kickingSide: 'home' | 'away' | null = null,
): KickoffBannerPalette {
  const normalizedName = normalizeKickoffName(name);
  if (ACTIVE_SEAT_KICKOFFS.has(normalizedName)) {
    if (kickingSide) {
      const kickerActs = KICKING_SIDE_KICKOFFS.has(normalizedName);
      return kickerActs ? kickingSide : kickingSide === 'home' ? 'away' : 'home';
    }
    return game.homePlaying ? 'home' : 'away';
  }

  if (normalizedName === 'brilliantcoaching') {
    const report = reports.find((candidate) => String(candidate.reportId ?? '') === 'extraReRoll');
    if (!report) return null;
    const teamId = typeof report.teamId === 'string' ? report.teamId : '';
    if (teamId === game.teamHome.teamId) return 'home';
    if (teamId === game.teamAway.teamId) return 'away';
    const homeWins = report.homeGainsReRoll === true;
    const awayWins = report.awayGainsReRoll === true;
    if (homeWins !== awayWins) return homeWins ? 'home' : 'away';
    return 'neutral';
  }

  if (normalizedName === 'cheeringfans') {
    const report = reports.find((candidate) => String(candidate.reportId ?? '') === 'cheeringFans');
    if (!report) return null;
    const winners = new Set(
      Array.isArray(report.teamIdsAdditionalAssist)
        ? report.teamIdsAdditionalAssist.map(String)
        : [],
    );
    const homeWins = winners.has(game.teamHome.teamId);
    const awayWins = winners.has(game.teamAway.teamId);
    if (homeWins !== awayWins) return homeWins ? 'home' : 'away';
    return 'neutral';
  }

  return null;
}
