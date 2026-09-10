import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { hasUnusedSkillNamed } from './logic/availableActions';

export const TASTY_MORSEL_AVAILABLE_COPY = 'Tasty Morsel is available!';

/** Availability is roster/server-state derived: the player owns the exact
 * once-per-game skill and the server has not marked it used. */
export function tastyMorselAvailable(game: GameJson | null | undefined, playerId: string): boolean {
  return !!game && !!playerId && hasUnusedSkillNamed(game, playerId, 'Tasty Morsel');
}
