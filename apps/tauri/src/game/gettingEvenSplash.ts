import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { hatredTrait, playerName } from './reportFormatter';
import { $t } from '../i18n';

/** Owner g1957941 (1.0.296): when the Getting Even choice resolves, the server's `gettingEvenRoll` report
 *  ({playerId, successful, roll, minimumRoll, reRolled, keyword}) is splashed on the pitch for every seat, in the log's
 *  own words (reportFormatter gettingEvenRoll): "<Player> learns to hate <Trait>" on a success, "<Player> doesn't let
 *  the hate toward <Trait> settle in their heart" on a failure, on the Pastries-style toast (title "Getting Even").
 *  Pure: server-derived, one splash per report. `side` = the injured player's team. */
export type GettingEvenSplash = { playerId: string; side: 'home' | 'away'; outcome: 'success' | 'failed'; text: string };

export function gettingEvenSplashes(reports: readonly Record<string, unknown>[], g: GameJson | null): GettingEvenSplash[] {
  if (!g) return [];
  const out: GettingEvenSplash[] = [];
  for (const report of reports) {
    if (String(report.reportId ?? '') !== 'gettingEvenRoll' || report.playerId == null || report.playerId === '') continue;
    if (typeof report.successful !== 'boolean') continue; // the log shows nothing without an outcome either
    const playerId = String(report.playerId);
    const p0 = playerName(g, playerId);
    const trait = hatredTrait(report);
    const text = report.successful
      ? $t('store.text.p0LearnsToHate', { p0, trait })
      : $t('store.text.p0HateDoesNotSettle', { p0, trait });
    const side: 'home' | 'away' = g.teamAway?.playerArray?.some((pl) => String(pl.playerId) === playerId) ? 'away' : 'home';
    out.push({ playerId, side, outcome: report.successful ? 'success' : 'failed', text });
  }
  return out;
}

/** Once per report occurrence: the game, the command number and the player (a rewind / re-sync replays the same key). */
export function gettingEvenSplashKey(g: GameJson | null, commandNr: number | null, playerId: string): string {
  return `${String((g as { gameId?: unknown } | null)?.gameId ?? 'unknown')}:${commandNr ?? 'unknown'}:${playerId}:gettingEven`;
}
