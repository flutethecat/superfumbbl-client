import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { $t } from '../i18n';

/** Owner 10-30 (BB2025 Swarming): StepSwarming rolls a D3 per eligible team and writes report
 *  `swarmingPlayersRoll { teamId, swarmingPlayerRoll }` to EVERY seat (the `swarming` dialog reaches only the choosing
 *  coach). Each report becomes one kick-off-event-styled splash: the big name "Swarming" and the side-coloured line
 *  "<Team> may place N Swarming player(s)". Pure: server-derived, one splash per report. */
export type SwarmingSplash = { teamId: string; side: 'home' | 'away'; team: string; amount: number; text: string; /** the report's position in its frame */ index: number };

/** The D3 of a `swarmingPlayersRoll` report (BB2020 reports carry `swarmingPlayerAmount`); null when it is not a count. */
export function swarmingRollAmount(report: Record<string, unknown>): number | null {
  const amount = Number(report.swarmingPlayerRoll ?? report.swarmingPlayerAmount);
  return Number.isInteger(amount) && amount >= 0 ? amount : null;
}

export function swarmingSplashText(team: string, amount: number): string {
  return $t('hud.swarmingOutcome', { team, n: amount });
}

export function swarmingSplashes(reports: readonly Record<string, unknown>[], g: GameJson | null): SwarmingSplash[] {
  if (!g) return [];
  const out: SwarmingSplash[] = [];
  for (const [index, report] of reports.entries()) {
    if (String(report.reportId ?? '') !== 'swarmingPlayersRoll') continue;
    const teamId = String(report.teamId ?? '');
    const amount = swarmingRollAmount(report);
    if (!teamId || amount === null) continue;
    const side: 'home' | 'away' | null = String(g.teamHome?.teamId ?? '') === teamId ? 'home'
      : String(g.teamAway?.teamId ?? '') === teamId ? 'away' : null;
    if (!side) continue;
    const owner = side === 'home' ? g.teamHome : g.teamAway;
    const team = String(owner?.teamName ?? '').trim() || String(owner?.coach ?? '').trim() || teamId;
    out.push({ teamId, side, team, amount, text: swarmingSplashText(team, amount), index });
  }
  return out;
}

/** Once per report occurrence: game, half, turn, team, the frame's occurrence (its command number, else a stable
 *  identity the store assigns to an unnumbered frame) and the report's position in it. A reconnect / rewind re-applying
 *  the same frame replays the same key; the kicking and receiving passes differ by team and frame. */
export function swarmingSplashKey(g: GameJson | null, occurrence: string | number | null, teamId: string, index = 0): string {
  const model = g as { gameId?: unknown; half?: unknown; turnDataHome?: { turnNr?: unknown }; turnDataAway?: { turnNr?: unknown } } | null;
  const turn = `${String(model?.turnDataHome?.turnNr ?? '?')}/${String(model?.turnDataAway?.turnNr ?? '?')}`;
  return `${String(model?.gameId ?? 'unknown')}:${String(model?.half ?? '?')}:${turn}:${teamId}:${occurrence ?? 'unknown'}:${index}:swarming`;
}
