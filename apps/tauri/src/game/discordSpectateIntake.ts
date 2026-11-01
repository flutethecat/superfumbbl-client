/**
 * Owner 09-24 / Sol r19: a friend pressed Spectate on Discord and the shell handed this client the secret
 * (`fumbbl|<id>` / `fork|<id>`). Synchronous, in arrival order, as on base: an open, idle Settings dialog starts its
 * normal close (not awaited); a busy one is left alone (a Cancel that lands after this switch re-derives url /
 * compression from the switched target - App.vue, serverSwitchGeneration); then the target is switched and the game
 * opened.
 */
import { parseSpectateSecret } from './discordPresence';

export interface DiscordSpectateDeps {
  forkFeaturesEnabled: () => boolean;
  settingsOpen: () => boolean;
  /** A Settings transaction (Apply / Cancel) is in flight. */
  settingsBusy: () => boolean;
  /** Close Settings the normal way (its Cancel). */
  closeSettings: () => Promise<void>;
  applyServerTarget: (id: 'fumbbl' | 'fork') => void;
  openSpectateGame: (gameId: number) => void;
}

/** Handle one secret; false when it was ignored (malformed, or a fork secret without fork features). */
export function handleDiscordSpectate(payload: unknown, deps: DiscordSpectateDeps): boolean {
  const target = parseSpectateSecret(payload);
  if (!target) return false;
  if (target.server === 'fork' && !deps.forkFeaturesEnabled()) return false; // no fork target without fork features
  if (deps.settingsOpen() && !deps.settingsBusy()) void deps.closeSettings(); // started, not awaited
  deps.applyServerTarget(target.server); // url + compression follow the target (never a stale url)
  deps.openSpectateGame(target.gameId);
  return true;
}
