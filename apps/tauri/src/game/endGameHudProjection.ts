import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { playerName } from './reportFormatter';

export interface EndGameStatsProjection {
  winningsHome: number | null;
  winningsAway: number | null;
  dedFans: { rollHome: number; modHome: number; rollAway: number; modAway: number; concededTeamId: string | null } | null;
}
export interface EndGameHudProjection { stats: EndGameStatsProjection | null; defectorNames: string[] | null }
export function reduceEndGameHud(previous: EndGameHudProjection, reports: readonly Record<string, unknown>[], game: GameJson): EndGameHudProjection {
  let stats = previous.stats;
  let defectorNames = previous.defectorNames;
  for (const report of reports) {
    if (report.reportId === 'defectingPlayers') {
      const ids = Array.isArray(report.playerIds) ? report.playerIds : [];
      const defecting = Array.isArray(report.defectingArray) ? report.defectingArray : [];
      const names = ids.filter((id, i): id is string => typeof id === 'string' && !!defecting[i]).map((id) => playerName(game, id));
      if (names.length) defectorNames = names;
    } else if (report.reportId === 'winnings') {
      stats = { winningsHome: Number(report.winningsHome ?? 0), winningsAway: Number(report.winningsAway ?? 0), dedFans: stats?.dedFans ?? null };
    } else if (report.reportId === 'dedicatedFans' && (report.rollHome != null || report.rollAway != null)) {
      stats = {
        winningsHome: stats?.winningsHome ?? null, winningsAway: stats?.winningsAway ?? null,
        dedFans: {
          rollHome: Number(report.rollHome ?? 0), modHome: Number(report.dedicatedFansModifierHome ?? 0),
          rollAway: Number(report.rollAway ?? 0), modAway: Number(report.dedicatedFansModifierAway ?? 0),
          concededTeamId: report.conceded && typeof report.teamId === 'string' ? report.teamId : null,
        },
      };
    }
  }
  return { stats, defectorNames };
}
