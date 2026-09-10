import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { wideRailActivationMenuOptions } from './availableActions';

export interface WideRailAvailabilityNoticeContext {
  /** Live player seat, never replay/spectator presentation. */
  isPlaying: boolean;
  /** The local coach owns the current turn. */
  myTurn: boolean;
  /** The clicked player belongs to the local coach and is currently controllable. */
  controlsPlayer: boolean;
  /** The click opened the fresh SELECT_PLAYER declaration menu. */
  freshActionMenu: boolean;
  /** The rendered menu has at least one enabled parent-action declaration. */
  hasDeclarableAction: boolean;
}

/**
 * Informational copy for one explicit fresh-menu-open gesture. The caller owns
 * event frequency: invoke from the click path after placing the menu, never
 * from a model watcher or menu refresh. Multiple rules retain the source-pinned
 * property-map order and each receives the owner's exact sentence.
 */
export function wideRailAvailabilityNotice(
  game: GameJson | null | undefined,
  playerId: string,
  context: WideRailAvailabilityNoticeContext,
): string | null {
  if (!game || !context.isPlaying || !context.myTurn || !context.controlsPlayer
    || !context.freshActionMenu || !context.hasDeclarableAction) {
    return null;
  }
  const options = wideRailActivationMenuOptions(game, playerId);
  if (options.length === 0) return null;
  return options
    .map(({ label }) => `${label} is available. Actions must be declared.`)
    .join('\n');
}
