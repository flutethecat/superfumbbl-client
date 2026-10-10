/**
 * Owner 2026-10-06: the CLIENT walkthrough (docs/artifact-orchestration/spec-client-walkthrough.md) - the pure step model.
 *
 * Runs after the first-launch setup wizard and, in a build with the FUMBBL.COM pane, after the site walkthrough; it ends
 * on the third-party disclaimer. Drawn in the main webview by components/ClientTour.vue; it switches blades, opens the
 * Details popup and walks the Settings tabs through a host API (never by clicking the DOM). Anchors are `data-tour`
 * attributes on the real elements. Public-edition code: no import from the FUMBBL.COM pane modules.
 */
import type { SettingsTab } from './settingsDialog';

export const CLIENT_TOUR_VERSION = 1;

export type BladeId = 'home' | 'play' | 'spectate' | 'replay';
export const TOUR_BLADES: readonly BladeId[] = ['home', 'play', 'spectate', 'replay'];

export type ClientStepId =
  | 'nav'
  | 'play-refresh'
  | 'play-recent'
  | 'play-details'
  | 'play-replay'
  | 'spectate'
  | 'replay'
  // Owner 10-06 addendum (spec-client-walkthrough-hud.md): the in-game HUD, on the bundled demo game.
  | 'hud-coaches'
  | 'hud-centre'
  | 'hud-log'
  | 'hud-chat-settings'
  | 'hud-bar-telestrator'
  | 'hud-bar-menu'
  | 'hud-bar-tackle'
  | 'hud-bar-sprites'
  | 'hud-bar-skills'
  | 'hud-bar-director'
  | 'hud-bar-roster'
  | 'hud-roster'
  | 'hud-bar-report'
  | 'hud-card'
  | 'esc'
  | 'settings-general'
  | 'settings-accessibility'
  | 'settings-display'
  | 'settings-mods'
  | 'settings-ui'
  | 'settings-credits'
  | 'disclaimer';

export const CLIENT_STEPS: readonly ClientStepId[] = [
  'nav',
  'play-refresh',
  'play-recent',
  'play-details',
  'play-replay',
  'spectate',
  'replay',
  'hud-coaches',
  'hud-centre',
  'hud-log',
  'hud-chat-settings',
  'hud-bar-telestrator',
  'hud-bar-menu',
  'hud-bar-tackle',
  'hud-bar-sprites',
  'hud-bar-skills',
  'hud-bar-director',
  'hud-bar-roster',
  'hud-roster',
  'hud-bar-report',
  'hud-card',
  'esc',
  'settings-general',
  'settings-accessibility',
  'settings-display',
  'settings-mods',
  'settings-ui',
  'settings-credits',
  'disclaimer',
];

/** Where the card sits: under the blade ribbon, near its first anchor, centred at the top, or docked beside Settings. */
export type CardPlacement = 'below-blades' | 'near' | 'top' | 'dock-settings' | 'centre';

export interface ClientStep {
  id: ClientStepId;
  title: string;
  /** Paragraphs (blank-line separated when rendered). */
  body: string[];
  /** What the arrows point at, in order: a `data-tour` name, or a CSS selector (starting with `.`, `#` or `[`). A
   *  missing one is skipped (logged), never a stuck tour. */
  anchors: string[];
  /** A short label at each arrow's target (same order as `anchors`; null = none). */
  labels?: (string | null)[];
  /** Anchors that are often absent (e.g. inducements the demo team did not buy): skipped without a warning. */
  optional?: string[];
  placement: CardPlacement;
  /** The blade the step needs on screen (the tour selects it when the step is entered). */
  blade?: BladeId;
  /** The Settings tab the step shows (settings-* steps). */
  settingsTab?: SettingsTab;
  /** No Next: the step waits for something (the real Esc, or "Open Settings"). */
  waits?: boolean;
}

export const BLADE_LABEL: Record<BladeId, string> = { home: 'FUMBBL.COM', play: 'Play', spectate: 'Spectate', replay: 'Replays' };

/** Step 2's per-blade mini-cards (owner copy, verbatim). */
export const BLADE_INFO: Record<BladeId, string> = {
  home: "FUMBBL.com is the website where you'll manage teams and interface with the community.",
  play: "Play Blade is where you'll see any active games you've got going on and be able to see details and find replays of games.",
  spectate: 'Spectate is where you can see any active games occurring in the community and join them live.',
  replay: 'Replays is where you can search for replays by coach or by league name and find games in that specific group.',
};

/** The six Settings tab one-liners (written from what each tab holds on 10-06; owner review pending). */
/** The HUD steps run on the bundled demo game (the tour loads it, and leaves it before the Esc step). */
export function isHudStep(id: ClientStepId | 'done'): boolean {
  return typeof id === 'string' && id.startsWith('hud-');
}

/** A chip label may carry a longer legend text after " — " (the chip decision reads the short name only). */
export const RES_OUT_LABEL = 'Reserves · Out — how many players are in the dugout and how many are out of the game';

const ROW = '.roster-popout .pg-roster-list > li:first-child';
const CARD = '.player-card';
/** The quick-bar sub-steps: anchor + owner copy (left to right). */
const BAR: Record<string, { anchor: string; label: string; body: string }> = {
  'hud-bar-telestrator': { anchor: 'hud-telestrator', label: 'Telestrator', body: "Telestrator — draw on the pitch to plan or explain a play. The tools appear when it's on." },
  'hud-bar-menu': { anchor: 'hud-menu', label: 'Game menu', body: 'Opens the Esc menu.' },
  'hud-bar-tackle': { anchor: 'hud-tackle', label: 'Tackle zones', body: 'Toggles tackle-zone shading: off, opposition, friendly or both.' },
  'hud-bar-sprites': { anchor: 'hud-sprites', label: 'Sprites', body: 'Cycles the player artwork between the sprite sets. Pick the look you read best.' },
  'hud-bar-skills': { anchor: 'hud-skills', label: 'Skill display', body: 'Switches between skill icons and FUMBBL-style markings.' },
  'hud-bar-director': { anchor: 'hud-director', label: 'Auto-director', body: 'Follows the action on the pitch; it starts off, so the camera stays where you put it.' },
  'hud-bar-roster': { anchor: 'hud-roster-btn', label: 'Roster', body: 'Opens the roster pane.' },
  'hud-bar-report': { anchor: 'hud-report', label: 'Report', body: 'Sends me a bug report with the wire log when something goes wrong.' },
};

export const SETTINGS_LINES: Record<SettingsTab, string> = {
  general: 'General holds your connection, keyboard and mouse controls, confirmations, the movement planner and diagnostics.',
  accessibility: 'Accessibility sets text size and contrast, pitch grid lines and the click echo.',
  display: 'Display covers video, the pitch, player sprites, movement animation, dice, the log and skill markings.',
  mods: 'Mods is where you import and manage mod packs: sprites, sounds and icons from friends or online.',
  ui: 'UI arranges the HUD layout, theme, element opacity, chat and notifications, the telestrator and sound.',
  credits: 'Credits shows the client version, the attributions and licences, and the FUMBBL contributors behind it all.',
};

const SETTINGS_ORDER: readonly SettingsTab[] = ['general', 'accessibility', 'display', 'mods', 'ui', 'credits'];

export function clientStep(id: ClientStepId): ClientStep {
  switch (id) {
    case 'nav':
      return {
        id,
        title: 'Navigation bar',
        body: ['Super FUMBBL has 4 panes that each give you access to different information. Click on each of them to get info.'],
        anchors: TOUR_BLADES.map((b) => `blade-${b}`),
        placement: 'below-blades',
      };
    case 'play-refresh':
      return {
        id,
        title: 'Play',
        body: ["If you've got an active game to play, it should show up here. Just hit refresh and you'll get a join button."],
        anchors: ['play-refresh'],
        placement: 'near',
        blade: 'play',
      };
    case 'play-recent':
      return {
        id,
        title: 'Play',
        body: ['My recent games shows you a whole lot of your recent games and lets you instantly see stats about them.'],
        anchors: ['play-recent'],
        placement: 'near',
        blade: 'play',
      };
    case 'play-details':
      return {
        id,
        title: 'Play',
        body: ['Details shows you the stats from the page and lets you pull up the end-game Dice pane as well.'],
        anchors: ['play-details'],
        placement: 'top',
        blade: 'play',
      };
    case 'play-replay':
      return {
        id,
        title: 'Play',
        body: ['Replay lets you immediately access the replay from that game from the start.'],
        anchors: ['play-replay'],
        placement: 'near',
        blade: 'play',
      };
    case 'spectate':
      return {
        id,
        title: 'Spectate',
        body: [
          'Spectate lets you see all of the live games!',
          "You can see the coach, what league it's part of, what turn and half it is, and join by clicking the spectate button.",
        ],
        // Owner 10-06: the Spectate tab itself first, then the row's parts (numbered chips + legend).
        anchors: ['blade-spectate', 'spectate-league', 'spectate-coach', 'spectate-phase', 'spectate-button'],
        labels: ['Spectate tab', 'League', 'Coach', 'Half · Turn', 'Spectate button'],
        placement: 'centre',
        blade: 'spectate',
      };
    case 'replay':
      return {
        id,
        title: 'Replays',
        body: [
          'Replays let you search for coaches and leagues and get detailed info from them.',
          'By default, we hide results here so you can watch as you go as if you were there.',
        ],
        // Owner 10-06: the Replay tab itself first, then the search box and Hide scores.
        anchors: ['blade-replay', 'replay-search', 'replay-hide-scores'],
        labels: ['Replay tab', 'Search', 'Hide scores'],
        placement: 'centre',
        blade: 'replay',
      };
    case 'hud-coaches':
      return {
        id,
        title: 'In a match',
        body: ['The coach panels show each team: coach name, team name, rerolls, apothecary and the inducements they bought.'],
        anchors: [
          '.coach-panel.home .coach-lines',
          '.coach-panel.away .coach-lines',
          '.coach-panel .inducement[data-chip="re_roll"]',
          '.coach-panel .inducement[data-chip="apothecary"]',
          '.coach-panel .inducement[data-chip="inducement"]',
          // Owner 10-06: the coach-corner "N RES / N OUT" tab (CoachCornerCounts.vue; absent when Settings hides it).
          '.coach-corner-counts[data-side="home"]',
        ],
        labels: ['Coach · Team', 'Coach · Team', 'Rerolls', 'Apothecary', 'Inducements', RES_OUT_LABEL],
        optional: ['.coach-panel .inducement[data-chip="apothecary"]', '.coach-panel .inducement[data-chip="inducement"]', '.coach-corner-counts[data-side="home"]'],
        placement: 'centre',
      };
    case 'hud-centre':
      return {
        id,
        title: 'In a match',
        body: ['Score, half and weather live here.'],
        anchors: ['.hud-center.scoreboard .sb-score', '.hud-center.scoreboard .sb-half', '.hud-center.scoreboard .sb-weather', '.hud-center.scoreboard .sb-turn.home'],
        labels: [
          'Score',
          'Half',
          'Weather',
          "This always turns at the START of your turn. So during setup and kickoff, just know you're one turn behind what you're seeing.",
        ],
        placement: 'centre',
      };
    case 'hud-log':
      return {
        id,
        title: 'In a match',
        body: ['The log records every roll and event; drag the grip to move it, the corner handle to resize it.'],
        anchors: ['hud-log-grip', 'hud-log-resize', 'hud-log-tab', 'hud-chat-tab'],
        labels: ['Grip (drag)', 'Resize', 'Log', 'Chat'],
        optional: ['hud-chat-tab'],
        placement: 'centre',
      };
    case 'hud-chat-settings':
      return {
        id,
        title: 'In a match',
        body: ['Change the chat font and text size here.'],
        anchors: ['hud-log-font', 'hud-log-size'],
        labels: ['Font', 'Text size'],
        placement: 'centre',
      };
    case 'hud-roster':
      return {
        id,
        title: 'Roster',
        body: ['Added skills have gold outlines and come at the end of the list.'],
        anchors: [
          '.roster-popout .pg-roster-team-toggle',
          `${ROW} .pg-roster-lvl`,
          `${ROW} .pg-roster-name`,
          `${ROW} .pg-roster-pos`,
          '.roster-popout .pg-roster-skills', // owner 10-10: innate skills are hidden by default, so the first row may have none
          `${ROW} .pg-roster-value`,
          `${ROW} .pg-roster-spp`,
          '.roster-popout [data-added="true"]',
        ],
        labels: ['Team', 'Level · Injury', 'Name', 'Position', 'Skills', 'Value', 'SPP', 'Added skill'],
        optional: ['.roster-popout .pg-roster-skills', '.roster-popout [data-added="true"]'],
        placement: 'top',
      };
    case 'hud-card':
      return {
        id,
        title: 'Player card',
        body: ['Click any player for their card: everything about them at a glance.'],
        anchors: [
          `${CARD} .card-name`,
          `${CARD} .card-position-main`,
          `${CARD} .card-spp`,
          `${CARD} .card-spp-gain`,
          `${CARD} .card-keywords`,
          `${CARD} .card-stats`,
          `${CARD} .card-portrait`,
          `${CARD} .card-skills`,
          `${CARD} .card-skills [data-added="true"]`,
        ],
        labels: ['Number · Name', 'Position', 'SPP', 'SPP gained', 'Keywords', 'MA / ST / AG / PA / AV', 'Portrait', 'Skills', 'Added skills'],
        optional: [`${CARD} .card-spp-gain`, `${CARD} .card-keywords`, `${CARD} .card-skills [data-added="true"]`],
        placement: 'top',
      };
    case 'esc':
      return { id, title: 'Settings', body: ['Press Esc to open the settings menu.'], anchors: [], placement: 'top', waits: true };
    case 'disclaimer':
      return { id, title: '', body: [], anchors: [], placement: 'top' };
    default: {
      const bar = BAR[id];
      if (bar) return { id, title: 'Quick bar', body: [bar.body], anchors: [bar.anchor], labels: [bar.label], placement: 'centre' };
      const tab = id.slice('settings-'.length) as SettingsTab;
      return { id, title: 'Settings', body: [SETTINGS_LINES[tab]], anchors: [`settings-tab-${tab}`], placement: 'dock-settings', settingsTab: tab };
    }
  }
}

export function isSettingsStep(id: ClientStepId | 'done'): boolean {
  return typeof id === 'string' && id.startsWith('settings-');
}

/** Gating: after the first-launch setup wizard, until seen. (Owner 10-06, final: the launch lands on Play, so it no
 *  longer waits for the FUMBBL.COM site walkthrough, which runs when the coach first opens that blade.) */
export function shouldStartClientTour(s: { clientTourSeenVersion: number; setupWizardDone: boolean }): boolean {
  return s.setupWizardDone && !(s.clientTourSeenVersion >= CLIENT_TOUR_VERSION);
}

// --- the state machine ----------------------------------------------------------------------------------------------

export interface ClientTourState {
  step: ClientStepId | 'done';
  /** Step 2: blades whose mini-card was read (ticked on the chips). */
  read: BladeId[];
  /** Step 2: the blade whose mini-card shows. */
  focusBlade: BladeId | null;
  /** The in-match steps could not run (no Modern match view, e.g. the Classic UI mode): skipped. */
  hudSkipped?: boolean;
}

export type ClientTourEffect =
  | { kind: 'select-blade'; blade: BladeId }
  | { kind: 'open-settings'; tab: SettingsTab }
  | { kind: 'select-settings-tab'; tab: SettingsTab }
  | { kind: 'close-settings' }
  /** After `delayMs` (the arrow to the Details button shows first). */
  | { kind: 'open-details'; delayMs: number }
  /** The Dice tab of the opened Details popup, after `delayMs`. */
  | { kind: 'open-dice'; delayMs: number }
  | { kind: 'close-details' }
  /** The HUD steps: load the bundled demo game (no-op when it is already up) / leave it (only the demo). */
  | { kind: 'load-demo' }
  | { kind: 'leave-demo' }
  | { kind: 'show-log' }
  | { kind: 'open-log-settings' }
  | { kind: 'close-log-settings' }
  | { kind: 'open-roster' }
  | { kind: 'close-roster' }
  | { kind: 'open-player-card' }
  | { kind: 'close-player-card' }
  | { kind: 'show-disclaimer' }
  | { kind: 'hide-disclaimer' }
  | { kind: 'seen' };

export type ClientTourInput =
  | { type: 'start' }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'skip' }
  /** Step 2: a blade was clicked (`via: 'blade'`, the view already switched) or its chip (`via: 'chip'`: the tour
   *  switches the view itself - the keyboard route - where the build has that blade). */
  | { type: 'blade'; blade: BladeId; via?: 'blade' | 'chip' }
  /** Step 6: the real Esc opened the Game Menu, or the card's "Open Settings". */
  | { type: 'esc' }
  | { type: 'acknowledged' }
  /** The coach closed Settings himself during the Settings walk (Esc / X): back to the Esc step, nothing to undo. */
  | { type: 'settings-closed' }
  /** The demo's match view never came up (Classic UI mode): skip the HUD steps, straight to Esc. */
  | { type: 'hud-unavailable' };

/** Shown on the Esc card when the in-match steps were skipped. */
export const HUD_UNAVAILABLE_NOTE = 'The in-match tour needs the Modern view.';

/** The Details popup opens this long after the step's arrow appears; its Dice tab ~1.2 s after the popup. */
export const DETAILS_DELAY_MS = 1500;
export const DICE_DELAY_MS = 1200;

function at(step: ClientStepId, delta: 1 | -1): ClientStepId {
  const i = CLIENT_STEPS.indexOf(step);
  return CLIENT_STEPS[Math.min(CLIENT_STEPS.length - 1, Math.max(0, i + delta))]!;
}

/** Effects of leaving `from` for `to` (what `from` opened that `to` does not keep). */
function leave(from: ClientStepId, to: ClientStepId | 'done', effects: ClientTourEffect[]): void {
  if (from === 'play-details') effects.push({ kind: 'close-details' });
  if (from === 'hud-chat-settings') effects.push({ kind: 'close-log-settings' });
  if (from === 'hud-roster') effects.push({ kind: 'close-roster' });
  if (from === 'hud-card') effects.push({ kind: 'close-player-card' });
  if (isHudStep(from) && !isHudStep(to)) effects.push({ kind: 'leave-demo' });
  if (from === 'disclaimer') effects.push({ kind: 'hide-disclaimer' });
  if (isSettingsStep(from) && !isSettingsStep(to)) effects.push({ kind: 'close-settings' });
}

function enter(from: ClientStepId | null, to: ClientStepId, state: ClientTourState, effects: ClientTourEffect[]): ClientTourState {
  const step = clientStep(to);
  if (isHudStep(to) && !(from && isHudStep(from))) effects.push({ kind: 'load-demo' });
  if (to === 'hud-log') effects.push({ kind: 'show-log' });
  if (to === 'hud-chat-settings') effects.push({ kind: 'show-log' }, { kind: 'open-log-settings' });
  if (to === 'hud-roster') effects.push({ kind: 'open-roster' });
  if (to === 'hud-card') effects.push({ kind: 'open-player-card' });
  if (step.blade) effects.push({ kind: 'select-blade', blade: step.blade });
  if (to === 'play-details') effects.push({ kind: 'open-details', delayMs: DETAILS_DELAY_MS }, { kind: 'open-dice', delayMs: DICE_DELAY_MS });
  if (step.settingsTab) {
    effects.push(from && isSettingsStep(from) ? { kind: 'select-settings-tab', tab: step.settingsTab } : { kind: 'open-settings', tab: step.settingsTab });
  }
  if (to === 'disclaimer') effects.push({ kind: 'show-disclaimer' });
  // The HUD section actually starting again (Back -> retry after a failed demo load) forgets the earlier skip.
  const hudSkipped = isHudStep(to) ? false : state.hudSkipped;
  return { ...state, step: to, focusBlade: to === 'nav' ? state.focusBlade : null, hudSkipped };
}

function move(state: ClientTourState, to: ClientStepId, effects: ClientTourEffect[]): ClientTourState {
  const from = state.step as ClientStepId;
  leave(from, to, effects);
  return enter(from, to, state, effects);
}

export function startClientTour(): { state: ClientTourState; effects: ClientTourEffect[] } {
  const effects: ClientTourEffect[] = [];
  return { state: enter(null, 'nav', { step: 'nav', read: [], focusBlade: null }, effects), effects };
}

/** Pure transition. `state` null = no tour running. */
export function clientTourReduce(state: ClientTourState | null, input: ClientTourInput): { state: ClientTourState | null; effects: ClientTourEffect[] } {
  if (input.type === 'start') return startClientTour();
  const effects: ClientTourEffect[] = [];
  if (!state || state.step === 'done') return { state, effects };
  const step = state.step;
  switch (input.type) {
    case 'skip':
      leave(step, 'done', effects);
      effects.push({ kind: 'seen' });
      return { state: { ...state, step: 'done' }, effects };
    case 'blade':
      if (step !== 'nav') return { state, effects };
      if (input.via === 'chip') effects.push({ kind: 'select-blade', blade: input.blade });
      return { state: { ...state, focusBlade: input.blade, read: state.read.includes(input.blade) ? state.read : [...state.read, input.blade] }, effects };
    case 'esc':
      if (step !== 'esc') return { state, effects };
      return { state: move(state, 'settings-general', effects), effects };
    case 'next':
      // Esc waits for the real Esc; the disclaimer finishes with "Let's play".
      if (clientStep(step).waits || step === 'disclaimer') return { state, effects };
      return { state: move(state, at(step, 1), effects), effects };
    case 'back':
      if (step === 'nav') return { state, effects };
      // With the in-match steps skipped, Back from Esc returns past them to the Replay step.
      if (step === 'esc' && state.hudSkipped) return { state: move(state, 'replay', effects), effects };
      return { state: move(state, at(step, -1), effects), effects };
    case 'hud-unavailable': {
      if (!isHudStep(step)) return { state, effects };
      leave(step, 'esc', effects);
      return { state: { ...state, step: 'esc', focusBlade: null, hudSkipped: true }, effects };
    }
    case 'settings-closed':
      if (!isSettingsStep(step)) return { state, effects };
      return { state: { ...state, step: 'esc' }, effects };
    case 'acknowledged':
      if (step !== 'disclaimer') return { state, effects };
      effects.push({ kind: 'hide-disclaimer' }, { kind: 'seen' });
      return { state: { ...state, step: 'done' }, effects };
  }
  return { state, effects };
}

export const SETTINGS_STEP_ORDER = SETTINGS_ORDER.map((t) => `settings-${t}` as ClientStepId);

// --- geometry -------------------------------------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Step 6: the card beside the Settings dialog - right of it if there is room, else left, else over its lower-right
 *  corner (a window too narrow for both). Never off screen. */
export function dockBeside(viewport: { width: number; height: number }, pane: Rect, card: { width: number; height: number }, margin = 16): { x: number; y: number } {
  const y = Math.max(margin, Math.min(pane.y, viewport.height - card.height - margin));
  if (pane.x + pane.width + margin + card.width + margin <= viewport.width) return { x: pane.x + pane.width + margin, y };
  if (pane.x - margin - card.width >= margin) return { x: pane.x - margin - card.width, y };
  return {
    x: Math.max(margin, Math.min(viewport.width - card.width - margin, pane.x + pane.width - card.width - margin)),
    y: Math.max(margin, Math.min(viewport.height - card.height - margin, pane.y + pane.height - card.height - margin)),
  };
}

/** Steps 2-5: the card under the blade ribbon (`below-blades`) or near its first anchor, kept on screen. */
export function placeNear(viewport: { width: number; height: number }, anchor: Rect | null, card: { width: number; height: number }, margin = 16): { x: number; y: number } {
  if (!anchor) return { x: Math.max(margin, (viewport.width - card.width) / 2), y: Math.max(margin, (viewport.height - card.height) / 3) };
  const below = anchor.y + anchor.height + 28;
  const y = below + card.height + margin <= viewport.height ? below : Math.max(margin, anchor.y - card.height - 28);
  const x = Math.max(margin, Math.min(viewport.width - card.width - margin, anchor.x + anchor.width / 2 - card.width / 2));
  return { x, y };
}

// --- multi-arrow labels: numbered chips + a legend on the card (UAT 10-06: free labels piled on each other) -----------

/** A label longer than this stays a callout beside its target (e.g. the Turn note); shorter ones become numbered chips.
 *  Only the part before " — " counts: the rest is legend text (e.g. "Reserves · Out — how many ..."). */
export const CALLOUT_MIN_LENGTH = 25;
/** Chips closer than this (centre to centre) are nudged apart along their target's edge. */
export const CHIP_MIN_GAP = 22;

export interface LabelPlan {
  /** Per target (same order): its chip number, or null (no chip: a callout or no label). */
  chips: (number | null)[];
  /** Per target: a long label shown as a callout beside it, or null. */
  callouts: (string | null)[];
  /** The legend on the card: each number once, in order (a label repeated on several targets shares its number). */
  legend: { n: number; label: string }[];
}

/** Single-arrow steps keep their label beside the target; with several arrows the short labels become numbered chips. */
export function planLabels(labels: (string | null)[]): LabelPlan {
  const multi = labels.length > 1;
  const chips: (number | null)[] = [];
  const callouts: (string | null)[] = [];
  const legend: { n: number; label: string }[] = [];
  for (const label of labels) {
    const short = label?.split(' — ')[0] ?? '';
    if (!label || !multi || short.length >= CALLOUT_MIN_LENGTH) {
      chips.push(null);
      callouts.push(label);
      continue;
    }
    let entry = legend.find((e) => e.label === label);
    if (!entry) {
      entry = { n: legend.length + 1, label };
      legend.push(entry);
    }
    chips.push(entry.n);
    callouts.push(null);
  }
  return { chips, callouts, legend };
}

/** Where each target's chip sits (its centre): at the target's top-right corner, else - when a chip already placed is
 *  closer than `gap` - the first point along the target's edge (top edge leftwards, then the left edge down, the bottom
 *  edge rightwards, the right edge up) that keeps the gap; when none does, the corner. Deterministic. (The chip is drawn
 *  over the target's ring, so a count badge in that corner may sit under it; the legend on the card names it.) */
export function placeChips(targets: Rect[], gap: number = CHIP_MIN_GAP): { x: number; y: number }[] {
  const placed: { x: number; y: number }[] = [];
  const clear = (p: { x: number; y: number }) => placed.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= gap);
  for (const r of targets) {
    const right = r.x + r.width;
    const bottom = r.y + r.height;
    const path: { x: number; y: number }[] = [];
    for (let x = right; x >= r.x; x -= gap / 2) path.push({ x, y: r.y });
    for (let y = r.y; y <= bottom; y += gap / 2) path.push({ x: r.x, y });
    for (let x = r.x; x <= right; x += gap / 2) path.push({ x, y: bottom });
    for (let y = bottom; y >= r.y; y -= gap / 2) path.push({ x: right, y });
    const spot = path.find(clear) ?? { x: right, y: r.y };
    placed.push({ x: Math.round(spot.x), y: Math.round(spot.y) });
  }
  return placed;
}

// --- the disclaimer links (components/ThirdPartyDisclaimer.vue) ---------------------------------------------------

export const TWITCH_CHANNEL = 'flutethecat';
export const TWITCH_CHANNEL_URL = `https://twitch.tv/${TWITCH_CHANNEL}`;
export const FUMBBL_DONATE_URL = 'https://fumbbl.com/p/donate';
