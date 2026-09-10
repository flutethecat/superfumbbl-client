import type { Blade } from './inducementsPhase';
import type { InducementPortraitView } from './inducementPortrait';

interface RosteredStarPlayer {
  playerId?: string;
  positionId?: string;
  playerName?: string;
  playerType?: string;
  skillArray?: string[];
}

interface RosteredStarPosition {
  positionId?: string;
  positionName?: string;
  playerType?: string;
  skillArray?: string[];
}

export interface RosteredStarTeam {
  playerArray?: RosteredStarPlayer[];
  roster?: { positionArray?: RosteredStarPosition[] };
}

export interface RosteredStarCard {
  key: string;
  name: string;
  blade: 'stars';
  kind: string;
  qty: number;
  totalLabel: null;
  showBadge: false;
  portrait: InducementPortraitView;
  skills: string[];
  removable: false;
}

const normalizedType = (value: unknown): string =>
  String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * Team Builder stars are already members of the team before inducement buying
 * begins, so they never appear in the server's purchase selection. Project them
 * directly from the authoritative team roster for display only.
 */
export function rosteredStarCards(
  team: RosteredStarTeam | null | undefined,
  portraitFor: (key: string) => InducementPortraitView,
): RosteredStarCard[] {
  const positions = team?.roster?.positionArray ?? [];
  const positionById = new Map(positions.map((position) => [String(position.positionId ?? ''), position] as const));
  const cards: RosteredStarCard[] = [];
  const seen = new Set<string>();

  for (const player of team?.playerArray ?? []) {
    const positionId = String(player.positionId ?? '');
    if (!positionId || seen.has(positionId)) continue;
    const position = positionById.get(positionId);
    const isStar = normalizedType(player.playerType) === 'star'
      || normalizedType(position?.playerType) === 'star';
    if (!isStar) continue;
    seen.add(positionId);
    const key = `star:${positionId}`;
    cards.push({
      key,
      name: String(player.playerName || position?.positionName || 'Star Player'),
      blade: 'stars',
      kind: 'Rostered Star Player',
      qty: 1,
      totalLabel: null,
      showBadge: false,
      portrait: portraitFor(key),
      skills: [...(player.skillArray ?? position?.skillArray ?? [])],
      removable: false,
    });
  }
  return cards;
}

/** Keep the established Inducements -> Stars -> Mercenaries order and let an
 * actual phase selection/reveal win when the same star is already represented. */
export function mergeRosteredStarCards<T extends { key: string; blade: Blade }>(
  phaseCards: readonly T[],
  rosterCards: readonly T[],
): T[] {
  const keys = new Set(phaseCards.map((card) => card.key));
  const order: Record<Blade, number> = { inducements: 0, stars: 1, mercenaries: 2 };
  return [...phaseCards, ...rosterCards.filter((card) => !keys.has(card.key))]
    .sort((a, b) => order[a.blade] - order[b.blade]);
}
