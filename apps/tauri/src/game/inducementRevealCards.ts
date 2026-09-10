import { KIND_LABEL, bladeOf, type Blade } from './inducementsPhase';
import type { InducementPortraitView } from './inducementPortrait';

export interface RevealedInducementChoice {
  items: { key: string; label: string; count: number }[];
  stars: { positionId: string; name: string; playerId?: string }[];
}

export interface RevealedInducementCard {
  key: string;
  name: string;
  blade: Blade;
  kind: string;
  qty: number;
  totalLabel: null;
  showBadge: boolean;
  portrait: InducementPortraitView;
  skills: string[];
}

/** Project both a coach's own confirmed choice and the opponent reveal through
 *  the same key-aware card rail. In particular, `merc:*` remains a mercenary
 *  card instead of being flattened into a generic inducement after confirm. */
export function revealedInducementCards(
  choice: RevealedInducementChoice | null,
  labelOf: (key: string) => string,
  details: (key: string) => { portrait: InducementPortraitView; skills: string[] },
): RevealedInducementCard[] {
  if (!choice) return [];
  const card = (key: string, suppliedName: string, qty: number): RevealedInducementCard => {
    const blade = bladeOf(key);
    const resolved = details(key);
    return {
      key,
      name: suppliedName || labelOf(key),
      blade,
      kind: KIND_LABEL[blade],
      qty,
      totalLabel: null,
      showBadge: qty > 1,
      portrait: resolved.portrait,
      skills: resolved.skills,
    };
  };
  const cards = [
    ...choice.items.map((item) => card(item.key, item.label, item.count)),
    ...choice.stars.map((star) => card(`star:${star.positionId}`, star.name, 1)),
  ];
  const order: Record<Blade, number> = { inducements: 0, stars: 1, mercenaries: 2 };
  return cards.sort((a, b) => order[a.blade] - order[b.blade]);
}
