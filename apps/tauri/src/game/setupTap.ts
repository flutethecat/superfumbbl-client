/**
 * Setup click-click: what a tap on one of my setup players does, given the current selection.
 *  - Two different players where at least one is PLACED: swap them (store.setupSwap). Placed + placed trade squares;
 *    placed + reserve (either order, owner 2026-11-12) puts the reserve on the placed player's square and sends the
 *    placed player to the reserves. The pitch count is unchanged, so no formation count can refuse it.
 *  - Otherwise (no selection, the same player again, or two reserves): select the tapped player.
 *  - A tapped player that is not on the setup surface (cannot be fielded) or is inert (Dwarfen Wisdom / Solid Defence
 *    keep it where it is) does nothing. An inert SELECTION never swaps either; store.setupSwap checks both again.
 */
export interface SetupTapPlayer { playerId: string; coord: [number, number] | null; inert?: boolean }

export type SetupTapDecision =
  | { kind: 'swap'; a: string; b: string }
  | { kind: 'select'; playerId: string }
  | { kind: 'none' };

export function setupTapDecision(players: readonly SetupTapPlayer[], selectedId: string | null, tappedId: string): SetupTapDecision {
  const tapped = players.find((p) => p.playerId === tappedId);
  if (!tapped || tapped.inert) return { kind: 'none' };
  const selected = selectedId && selectedId !== tappedId ? players.find((p) => p.playerId === selectedId) : undefined;
  if (selected && !selected.inert && (selected.coord || tapped.coord)) {
    return { kind: 'swap', a: selected.playerId, b: tapped.playerId };
  }
  return { kind: 'select', playerId: tappedId };
}
