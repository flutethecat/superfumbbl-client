import { reactive } from 'vue';
import type { SettingsTab } from './settingsDialog';

/**
 * Cross-component UI state (not persisted). First piece of the BB3-style
 * shell (owner 2026-07-02, Q5): Esc opens the Game Menu when there is
 * nothing left to cancel; the menu grows toward BB3's full-screen layout.
 */
export const ui = reactive({
  gameMenuOpen: false,
  settingsOpen: false,
  // OBS-style settings shell: one persistent category rail and one scrollable pane.
  settingsTab: 'general' as SettingsTab,
  /** Bump to (re)start the guided tour (owner 2026-07-03 r6f). App.vue's splash
   *  "Play Tutorial" increments it; SpectateView watches and runs the tour. */
  tutorialTick: 0,
  /** Game browser (owner 2026-07-03 r6f Option A): the connect bar is gone; the
   *  header "Browse" button opens the game browser as the primary entry point
   *  (game-id / game-name entry now lives inside the browser). App.vue toggles
   *  this; SpectateView renders the browser and refreshes its list when opened. */
  browserOpen: false,
});
