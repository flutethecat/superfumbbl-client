import { watch, type WatchStopHandle } from 'vue';
import type { GameJson } from '@fumbbl40k/ffb-protocol';

/** The narrow renderer surface used by Modern's confirmed-step presentation bridge. */
export interface ConfirmedMovementRenderer {
  setConfirmedMovementPresentation(active: boolean): void;
  setGame(game: GameJson | null): void;
}

/**
 * Keep the renderer capability current as soon as the store publishes it. `pre` is intentional: an
 * applyFrame changes both this flag and game.value, while the board redraw is a post-flush watcher.
 */
export function watchConfirmedMovementPresentation(
  active: () => boolean,
  renderer: () => Pick<ConfirmedMovementRenderer, 'setConfirmedMovementPresentation'> | null,
): WatchStopHandle {
  return watch(active, (enabled) => renderer()?.setConfirmedMovementPresentation(enabled), { flush: 'pre' });
}

/**
 * The redraw-side invariant as a final backstop: publish the current ownership flag immediately before
 * every Modern setGame, including the mount seed and a catch-up -> live-tail boundary in the same tick.
 */
export function setGameWithConfirmedMovement(
  renderer: ConfirmedMovementRenderer,
  active: boolean,
  game: GameJson | null,
): void {
  renderer.setConfirmedMovementPresentation(active);
  renderer.setGame(game);
}
