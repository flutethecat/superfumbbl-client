import type { TelestratorMode } from './settings';

/**
 * Settings reflow (owner 11-03): Settings > UI "Telestrator" decides where the telestrator exists.
 *  - 'replays' (default, migrated onto every install once): only in the replay viewer - a recorded replay, or a
 *    spectator's review (rewind) of a live game, which opens the same replay toolbar;
 *  - 'all': every game (live play, spectating, the demo and replays - the behaviour before 11-03);
 *  - 'off': nowhere.
 * When it does not exist, the launcher, the drawings and every telestrator shortcut (Ctrl+1..5, Ctrl+Z, the pad
 * chord) are gone: ReplayTelestrator renders nothing and ignores keys while `enabled` is false.
 * Presentation only: the telestrator never sends anything to the server.
 */
export interface TelestratorContext {
  /** The view is the replay viewer: a replay, or a spectator review of a live game. */
  replayViewer: boolean;
}

export function telestratorAvailable(mode: TelestratorMode | string | null | undefined, context: TelestratorContext): boolean {
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return context.replayViewer; // 'replays', and any unknown value fails to the default
}
