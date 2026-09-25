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

/** Owner 09-24: the result line under the kick-off banner — "<Team> wins" for the winner events, the acting team's
 *  verb for the seat-aware ones, coloured by side. `neutral` covers a Brilliant Coaching / Cheering Fans tie. */
export interface KickoffOutcome { side: 'home' | 'away' | 'neutral'; text: string }

const SEAT_VERBS: Record<string, string> = {
  blitz: 'blitzes!', charge: 'charges!', quicksnap: 'quick snaps', soliddefence: 'sets a solid defence', highkick: 'takes the high kick',
};

export function kickoffOutcome(
  name: string,
  palette: KickoffBannerPalette,
  reports: Record<string, unknown>[],
  game: Pick<GameJson, 'teamHome' | 'teamAway'>,
): KickoffOutcome | null {
  if (!palette) return null;
  const key = normalizeKickoffName(name);
  const teamName = (side: 'home' | 'away') => String((side === 'home' ? game.teamHome : game.teamAway)?.teamName ?? '').trim() || (side === 'home' ? 'Home' : 'Away');
  if (key === 'brilliantcoaching' || key === 'cheeringfans') {
    if (palette === 'neutral') {
      const both = key === 'brilliantcoaching'
        ? reports.some((r) => String(r.reportId ?? '') === 'extraReRoll' && r.homeGainsReRoll === true && r.awayGainsReRoll === true)
        : reports.some((r) => String(r.reportId ?? '') === 'cheeringFans' && Array.isArray(r.teamIdsAdditionalAssist) && r.teamIdsAdditionalAssist.length >= 2);
      return { side: 'neutral', text: both ? 'Both teams win' : 'No winner' };
    }
    return { side: palette, text: `${teamName(palette)} wins` };
  }
  const verb = SEAT_VERBS[key];
  if (!verb || palette === 'neutral') return null;
  return { side: palette, text: `${teamName(palette)} ${verb}` };
}
