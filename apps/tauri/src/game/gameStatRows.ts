// Owner 09-22: ONE statistics table for the end-of-game Statistics tab and the Esc > Game statistics pane — the
// same rows, the same numbers, the same three-column crest layout. Pure over the game JSON + the dice tallies.
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { assetMods } from './assetMods';
import { diceStats, emptyTally, type DiceTally } from './diceStats';
import { selectedLocalFumbblAssetUrl } from './fumbblAssetCache';
import { crestDataUrl, type CrestSide } from './teamCrests';

export interface PgStatRow { key: string; label: string; home: string; away: string; homeLead: boolean; awayLead: boolean }

/** wire PlayerResult fields (server PlayerResult.java) summed per team */
export const POSTGAME_STATS: { key: string; label: string }[] = [
  { key: 'touchdowns', label: 'Touchdowns' },
  { key: 'casualties', label: 'Casualties' },
  { key: 'completions', label: 'Completions' },
  { key: 'passing', label: 'Passing yards' },
  { key: 'rushing', label: 'Rushing yards' },
  { key: 'interceptions', label: 'Interceptions' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'fouls', label: 'Fouls' },
  { key: 'spp', label: 'SPP earned' },
];

type Side = 'home' | 'away';
const num = (r: Record<string, unknown>, k: string) => Number(r[k] ?? 0);
/** Game-earned SPP from the serialized achievement fields, not lifetime currentSpps. */
export const sppEarned = (r: Record<string, unknown>) =>
  num(r, 'playerAwards') * 4 + num(r, 'touchdowns') * 3 + num(r, 'casualties') * 2 +
  num(r, 'interceptions') * 2 + num(r, 'completions') + num(r, 'deflections') +
  num(r, 'completionsWithAdditionalSpp') + num(r, 'casualtiesWithAdditionalSpp') + num(r, 'catchesWithAdditionalSpp');

function playerResults(game: GameJson, side: Side): Record<string, unknown>[] {
  const tr = side === 'home' ? game.gameResult?.teamResultHome : game.gameResult?.teamResultAway;
  return ((tr?.playerResults ?? []) as unknown) as Record<string, unknown>[];
}

/** Per-team totals keyed by POSTGAME_STATS. */
export function teamStatTotals(game: GameJson, side: Side): Record<string, number> {
  const results = playerResults(game, side);
  const totals: Record<string, number> = {};
  for (const { key } of POSTGAME_STATS) {
    totals[key] = key === 'spp' ? results.reduce((a, r) => a + sppEarned(r), 0) : results.reduce((a, r) => a + num(r, key), 0);
  }
  return totals;
}

/** Upstream SendToBoxReason: only the BAN reasons are a send-off (foulBan, secretWeaponBan, officiousRef,
 *  threwToBombs); the rest name why a player reached the KO / casualty box. */
export function teamSentOff(game: GameJson, side: Side): number {
  return playerResults(game, side).filter((r) => /^(foulBan|secretWeaponBan|officiousRef|threwToBombs)$/.test(String(r.sendToBoxReason ?? ''))).length;
}

export function teamDiceTally(game: GameJson, side: Side): DiceTally {
  const teamId = side === 'home' ? game.teamHome?.teamId : game.teamAway?.teamId;
  return (teamId && diceStats.teams[teamId]) || emptyTally();
}

/** The Statistics rows: Touchdowns, Casualties, Completions, Passing/Rushing yards, Interceptions, Blocks / Dodges /
 *  Pickups as "attempts / failed", Fouls, Sent off, SPP earned. */
export function gameStatRows(game: GameJson | null | undefined, tallies?: { home: DiceTally; away: DiceTally }): PgStatRow[] {
  if (!game) return [];
  const home = teamStatTotals(game, 'home');
  const away = teamStatTotals(game, 'away');
  // Owner 09-25: a cached end-game snapshot carries its own tallies (the live accumulator belongs to the current game).
  const th = tallies?.home ?? teamDiceTally(game, 'home');
  const ta = tallies?.away ?? teamDiceTally(game, 'away');
  const rows: PgStatRow[] = [];
  const plain = (key: string, label: string) => {
    const h = home[key] ?? 0; const a = away[key] ?? 0;
    rows.push({ key, label, home: String(h), away: String(a), homeLead: h > a, awayLead: a > h });
  };
  const pair = (key: string, label: string, h: number, hf: number, a: number, af: number) =>
    rows.push({ key, label, home: `${h} / ${hf}`, away: `${a} / ${af}`, homeLead: h > a, awayLead: a > h });
  for (const { key, label } of POSTGAME_STATS) {
    if (key === 'blocks') {
      pair('blocks', 'Blocks', home.blocks ?? 0, th.failedBlocks, away.blocks ?? 0, ta.failedBlocks);
      pair('dodges', 'Dodges', th.dodges, th.failedDodges, ta.dodges, ta.failedDodges);
      pair('pickups', 'Pickups', th.pickups, th.failedPickups, ta.pickups, ta.failedPickups); // owner 09-17
      pair('rushes', 'Rushes', th.rushes, th.failedRushes, ta.rushes, ta.failedRushes); // owner 09-22
    } else if (key === 'fouls') {
      plain(key, label);
      const sh = teamSentOff(game, 'home'); const sa = teamSentOff(game, 'away');
      rows.push({ key: 'sentOff', label: 'Sent off', home: String(sh), away: String(sa), homeLead: sh > sa, awayLead: sa > sh });
    } else plain(key, label);
  }
  return rows;
}

/** Generic shield crest for a team without a FUMBBL logo or a bundled race crest. */
export const GENERIC_TEAM_LOGO =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#4a5568"/><stop offset="1" stop-color="#232a36"/></linearGradient></defs>' +
      '<path d="M30 3 L54 11 V31 C54 44 44 53 30 58 C16 53 6 44 6 31 V11 Z" fill="url(#g)" stroke="var(--ui-accent)" stroke-width="2"/>' +
      '<path d="M30 17 l3.7 8.2 8.9 0.8 -6.7 5.9 2 8.8 -7.9 -4.7 -7.9 4.7 2 -8.8 -6.7 -5.9 8.9 -0.8 Z" fill="var(--ui-accent)" opacity="0.92"/>' +
      '</svg>',
  );

/** The team crest: the FUMBBL roster logo when the server names one, else the bundled race crest, else the shield. */
export function teamLogo(team: unknown, side: CrestSide): string {
  void assetMods.logoRevision; // owner 09-05: pack logos hot-swap — re-render when the bindings change
  const t = team as { race?: string; roster?: { logoUrl?: string; baseIconPath?: string } } | undefined;
  const viaServer = selectedLocalFumbblAssetUrl(t?.roster?.logoUrl, t?.roster?.baseIconPath); // = jnlpRouting.fumbblAsset, without its import graph
  if (viaServer) return viaServer;
  return crestDataUrl(t?.race, side) ?? GENERIC_TEAM_LOGO;
}
