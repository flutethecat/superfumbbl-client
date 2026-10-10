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
  /** Owner 10-06: the first-launch setup wizard re-run from Settings is open over the live shell (it owns the keyboard). */
  setupWizardRerunOpen: false,
  /** Owner 10-06: the client walkthrough (components/ClientTour.vue) is running - the FUMBBL.COM site stays hidden. */
  clientTourActive: false,
  /** Owner 10-08: the FUMBBL site is kept open in the floating window (components/FumbblFloat.vue) whenever the
   *  FUMBBL.COM blade itself is not on screen. Session state on purpose - never persisted: after a restart the site
   *  must not appear over the app unasked. Turned on by "Float this page" or by the coach pressing the Gamefinder's
   *  "Join the Draw" (owner 10-09); ended by Close, the pane's toggle, or the coach's own match starting. */
  fumbblFloating: false,
  /** When a launch taken from the page ended the floating window (Date.now(); 0 = none). App.vue brings the window
   *  back if that launch turns out to be a game to WATCH or a replay (game/fumbblFloatLayout.ts floatAfterLaunch). */
  fumbblFloatHeldAt: 0,
  /** The coach is IN their own match as a player right now (App.vue keeps it). Nothing turns floating on while they
   *  are (Astra 10-09, N1: a late answer about a "Join the Draw" press must never put the window over their game). */
  fumbblOwnMatchPlaying: false,
  /** Owner 10-09: the Blackbox box the floating window's automatic fit uses, in the page's CSS pixels (null = not
   *  measured yet this session). Kept here so a window that is closed and opened again starts at the right size. */
  fumbblFloatQueueBox: null as { w: number; h: number } | null,
});
