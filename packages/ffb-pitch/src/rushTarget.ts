import type { GameJson } from '@fumbbl40k/ffb-protocol';

const normalize = (value: unknown): string => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function prayerName(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const prayer = value as { name?: unknown; prayer?: unknown; prayerName?: unknown };
  return String(prayer.name ?? prayer.prayer ?? prayer.prayerName ?? '');
}

function hasMoles(game: GameJson, home: boolean): boolean {
  const prayers = (home ? game.turnDataHome : game.turnDataAway)?.inducementSet?.prayers ?? [];
  return prayers.some((prayer) => normalize(prayerName(prayer)) === 'molesunderthepitch');
}

/**
 * Presentation projection of the authoritative BB2025 Rush modifier collection.
 *
 * Server-provided `minimumRollGfi` values remain preferable wherever they exist. This
 * function covers client-plotted/reachable steps for which no per-square server value
 * is available. BB2025 adds Blizzard and an opposing team's Moles under the Pitch as
 * separate +1 modifiers, so they intentionally stack to 4+.
 */
export function rushTargetForPlayer(game: GameJson | null | undefined, playerId: string | null | undefined): number {
  if (!game) return 2;

  const id = String(playerId ?? '');
  const isHome = game.teamHome.playerArray.some((player) => String(player.playerId) === id);
  const isAway = game.teamAway.playerArray.some((player) => String(player.playerId) === id);
  const blizzard = normalize(game.fieldModel.weather) === 'blizzard';
  const opposingMoles = isHome ? hasMoles(game, false) : isAway ? hasMoles(game, true) : false;

  return 2 + Number(blizzard) + Number(opposingMoles);
}
