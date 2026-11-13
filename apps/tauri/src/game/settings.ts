import { reactive, watch } from 'vue';
import { SPECTATOR_TACKLE_ZONE_MODES, type SpectatorTackleZoneMode } from './tackleZoneQuickBar';
import { FORK_EDITION } from './edition';
import { FORK_SERVER_HOST, LOCAL_CONFIG_WEB_PORT, effectiveForkHost, forkConfigWebBase, forkHostFrozen, registerConfigWebResolver, forkFeaturesEnabled, forkHostFromLaunch, isLocalForkHost, launchFlagsSettled, registerSettingsForkHostReader } from './forkAccess';
import { setWireLogSecondClientProbe } from './bugReportHost';
import { requireForkBaseUrl } from './forkBase';
import type { EdgePanelPosition } from './edgePanelLayout';
import { FLOAT_QUEUE_MIN, sanitizeFloatPos, sanitizeFloatSize, sanitizeFloatZoom } from './fumbblFloatLayout';
import { PLAYER_CARD_MIN_SIZE } from './playerCardGeometry';
export { PLAYER_CARD_MIN_SIZE };
/** The selected-player card's stored geometry: anything malformed reads as "never moved / resized" (the docked
 *  default). The view clamps a valid value into the pitch host when the card shows. */
export function sanitizePlayerCardPos(value: unknown): { x: number; y: number } | null {
  const pos = sanitizeFloatPos(value);
  return pos ? { x: Math.max(0, Math.round(pos.x)), y: Math.max(0, Math.round(pos.y)) } : null;
}
export function sanitizePlayerCardSize(value: unknown): { w: number; h: number } | null {
  return sanitizeFloatSize(value, PLAYER_CARD_MIN_SIZE);
}
import { md5Hex } from '@fumbbl40k/ffb-protocol';
import { bundledTurfOptions } from '@fumbbl40k/ffb-pitch';
import { normalizeLegalAcceptanceVersion } from './legalNotice';
import { CONFIRMATION_DEFAULTS, normalizeConfirmationSettings, type ConfirmationSettings } from './confirmationSettings';
import { applyLayerConfirmations, CONTROL_LAYER_DEFAULTS, normalizeControlLayerSettings, type ControlLayerSettings } from './controlLayer';
import { chordLabel, defaultFumbblKeyBindings, fumbblKeyAction, fumbblKeyHolder, isFumbblChord, normalizeFumbblKeyBindings, type FumbblKeyActionId, type FumbblKeyBindings } from './fumbblKeys';
import { STICK_DEADZONE, clampDeadzone } from './gamepad';
import { TOUCH_BUTTON_PX, TOUCH_HOLD_MS, clampTouchButtonPx, clampTouchHoldMs, normaliseTouchModeChoice, normaliseTouchModeSetting, type TouchModeChoice, type TouchModeSetting } from './touchMode';
import { CROSSHAIR_SPEED_DEFAULT, clampCrosshairSpeed } from './crosshair';
import { DEFAULT_SPECTATOR_VIEW, normalizeSpectatorView, type SpectatorView } from './spectatorView';
import { CONTROL_ACTIONS, CONTROL_BINDINGS_REVISION, MOUSE_MIDDLE, isMouseInput, bindingConflict, controlAction, getBinding, normaliseBindingsRevision, defaultControlBindings, migrateControlBindings, type BindingMethod, type BindingSlot, type ControlActionId, type ControlBindings, type InputMethod } from './controls';
import { FPS_CAP_CHOICES, RENDER_SCALE_CHOICES, normalizeLowPerformanceRestore, type LowPerformanceRestore } from './lowPerformanceMode';
import { $t, mapLegacyEnglish, normalizeLocale, systemLanguageTags, type Locale } from '../i18n';

/**
 * App settings, persisted to localStorage (works in the web preview and the
 * Tauri webview alike; never committed anywhere). Sections mirror the
 * settings pane: Hotkeys, Markings, Client options.
 */

const SETTINGS_KEY = 'fumbbl40k.settings';
/** Last-good copy of the blob, refreshed on every successful load. A transiently unreadable/
 *  corrupt primary (WebView2 profile lock, crash mid-write, quota) restores from here instead of
 *  silently becoming DEFAULTS — the one-bad-read wipe behind the blank-credentials P1 (08-18). */
const BACKUP_KEY = 'fumbbl40k.settings.bak';
/** An unparseable primary is parked here (not destroyed) before defaults may overwrite it. */
const CORRUPT_KEY = 'fumbbl40k.settings.corrupt';
/** Bump when a default change must be FORCED onto existing installs (see load()). */
const SETTINGS_VERSION = 36; // v36: the retired Classic view's settings (uiMode 'classic', classicEffects) migrate to Modern

/** Load-path health (P1 08-18: blank credentials). notices non-empty = a degraded settings read
 *  happened this session; loadedFromDefaults = BOTH blob and backup were unreadable, and the
 *  persist watcher is guarded (see persistSettings) so defaults can never overwrite a good blob. */
export const settingsHealth = reactive({ loadedFromDefaults: false, notices: [] as string[] });
/** Owner 10-23 (Astra r1): where this launch's settings came from. `freshInstall` = nothing was stored anywhere before
 *  this launch (no localStorage blob or backup, and - in the shell - no settings file, backup or recovery file). The
 *  setup wizard adopts the system language only then. */
export const settingsProvenance = { freshInstall: false };

function noteSettingsIssue(msg: string): void {
  settingsHealth.notices.push(msg);
  try { console.warn(`[settings] ${msg}`); } catch { /* ignore */ }
}

/** May the persist watcher overwrite the on-disk blob? Granted when load() consumed a REAL blob
 *  (primary or backup), or by persistSettings' mayPersistOverDisk() check when the disk is
 *  genuinely absent/junk. A session that never read a real blob — a transient throw, or a null
 *  read of an existing key (which is indistinguishable from a fresh install at load time) —
 *  must never write defaults over a blob that reads fine at persist time. */
let diskAuthority = false;

/** Owner ruling 11-01: the Super FUMBBL FORK server's default host is baked again (single source: forkAccess.ts,
 *  re-exported here). The effective host is the launch flag's (`--fork-server=<host>`), or in the FORK edition
 *  `settings.forkHost` / VITE_FORK_SERVER_HOST, else this default (game/forkAccess.ts effectiveForkHost). The game WS
 *  rides port 22227 on that host (an optional `:port` in the flag is the config-web port, see configWebBaseFor).
 *  (Local dev uses the separate 'local' SERVER_TARGET.) */
export { FORK_SERVER_HOST };
export function forkWsUrlFor(host: string): string {
  const hostname = host.replace(/:\d+$/, '');
  return `ws://${hostname}:22227/command`;
}
export const FORK_WS_URL = forkWsUrlFor(FORK_SERVER_HOST);
/** Owner 10-31: a PUBLIC session that loaded a persisted 'fork' target before the launch flag was read: coerced to
 *  FUMBBL at load, restored once the flag resolves (reconcileForkTarget). Declared before load() runs. */
let publicForkTargetPending = false;
/** Owner 10-31 (Sol r6): the last malformed settings bytes this session quarantined, kept IN MEMORY only in a public
 *  build (they may name another edition's fork host and cannot be sanitised structurally). Declared before load(). */
let publicCorruptSettingsInMemory: string | null = null;
/** Sol r6/r7: a PUBLIC load notes a malformed localStorage blob as a host-free marker in CORRUPT_KEY (raw bytes in
 *  memory only). It never removes or rewrites the primary / backup key itself: another window may have just repaired
 *  it, and a pre-existing malformed key written by another edition persists nothing new. The normal save path
 *  (mayPersistOverDisk) replaces a junk primary when this window next saves. FORK edition: untouched. */
function quarantinePublicMalformed(text: string): void {
  if (FORK_EDITION || isJsonObjectText(text)) return;
  try { localStorage.setItem(CORRUPT_KEY, publicDiskText(text)); } catch { /* ignore */ }
}
export const FUMBBL_WS_URL = 'ws://fumbbl.com:22223/command';

/** Owner 10-02: keys the fixed shortcuts already own - a rebindable hotkey may not take one (or the other rebindable key). */
// Defined before load() runs at module init (the loader validates rosterKey with hotkeyConflict).
export const FIXED_SHORTCUT_CODES: readonly string[] = [
  'Escape', 'Enter', 'F11', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'Backquote',
];
/** Astra review: keys a rebindable hotkey may never take - focus movement and modifiers (a modifier binding could never
 *  fire: the handlers ignore modified presses). */
const UNBINDABLE_CODES: readonly string[] = ['Tab', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'ContextMenu', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn'];

// Before load(): the loader validates the stored rebindable keys with hotkeyConflict at module init.
export type RebindableKey = 'confirmKey' | 'rosterKey' | 'logExpandKey';
export { SPECTATOR_TACKLE_ZONE_MODES, type SpectatorTackleZoneMode };
const REBINDABLE_LABEL: Record<RebindableKey, string> = { get confirmKey() { return $t('settings.rebindableLabel.confirmMovePassTarget'); }, get rosterKey() { return $t('settings.rebindableLabel.rosterPopOut'); }, get logExpandKey() { return $t('settings.rebindableLabel.enlargeTheLogWindow'); } };
const REBINDABLE_ACTION: Record<RebindableKey, ControlActionId> = { confirmKey: 'confirm', rosterKey: 'roster', logExpandKey: 'logExpand' };

// Owner 10-04: each client confirmation prompt has its own on/off line (confirmationSettings.ts; all default on).
/** Owner 10-20: coach rank badge art set. */
export type CoachBadgeStyle = 'realistic' | 'retro';

// =====================================================================================================================
// SETTINGS REFLOW - NEW FEATURES (lane C, spec-settings-reflow-2026-11-03.md section 2). ONE block: the keys, their
// defaults, the load-merge validation and the one-time migration. Rows: docs/artifact-orchestration/
// settings-features-rows.md (the descriptors live in game/settingsFeatureRows.ts). The Super FUMBBL cursor toggle
// reuses the existing `useFantasyCursor` key (no new key: the stored value carries over).
// =====================================================================================================================
export type TelestratorMode = 'replays' | 'all' | 'off';
export const TELESTRATOR_MODES: readonly TelestratorMode[] = ['replays', 'all', 'off'];
export type TurnClockWarning = '2m' | '1m' | '30s' | 'off';
export const TURN_CLOCK_WARNINGS: readonly TurnClockWarning[] = ['2m', '1m', '30s', 'off'];
/** Edge-of-screen pan speed, screen px per frame at full glide (the WASD scale: renderer setPanSpeed clamps 2-30). */
export const EDGE_PAN_SPEED = { min: 4, max: 30, step: 2, default: 12 } as const;
/** UI zoom, percent of the normal interface size. */
export const UI_ZOOM = { min: 80, max: 150, step: 5, default: 100 } as const;
/** Bump to re-run the one-time migration below for every install (each step must stay idempotent). */
export const REFLOW_FEATURES_MIGRATION = 1;

export interface SettingsReflowFeatures {
  /** Edge-of-screen panning: the camera glides while the pointer rests at the pitch edge (default off). */
  edgePan: boolean;
  edgePanSpeed: number;
  /** Where the telestrator exists: the replay viewer only (default), every game, or nowhere. */
  telestratorMode: TelestratorMode;
  /** Interface zoom in percent (80-150). Scales the client interface; the pitch keeps its own camera. */
  uiZoom: number;
  highContrast: boolean;
  /** Shorter / no decorative animation. Never touches the roll-beat hold or any server-paced timing. */
  reduceMotion: boolean;
  /** No strobing or rapid flashing effects. */
  reduceFlashing: boolean;
  /** A short on-screen label whenever a sound cue plays. */
  visualSoundCues: boolean;
  /** Bigger hit areas for small HUD buttons and chips. */
  largerTargets: boolean;
  /** When my turn clock warns before the last-seconds countdown (the countdown itself is unchanged). */
  turnClockWarning: TurnClockWarning;
  /** REFLOW_FEATURES_MIGRATION of the stored blob (0 = before these settings existed). */
  reflowFeaturesMigrated: number;
}

export const REFLOW_FEATURE_DEFAULTS: SettingsReflowFeatures = {
  edgePan: false,
  edgePanSpeed: EDGE_PAN_SPEED.default,
  telestratorMode: 'replays', // owner 11-03: "force this on for all players" - migrated onto every install once
  uiZoom: UI_ZOOM.default,
  highContrast: false,
  reduceMotion: false,
  reduceFlashing: false,
  visualSoundCues: false,
  largerTargets: false,
  turnClockWarning: '1m', // today's one-minute warning
  reflowFeaturesMigrated: REFLOW_FEATURES_MIGRATION,
};

function snapNumber(value: unknown, range: { min: number; max: number; step: number; default: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return range.default;
  const snapped = Math.round((value - range.min) / range.step) * range.step + range.min;
  return Math.min(range.max, Math.max(range.min, snapped));
}
export function clampEdgePanSpeed(value: unknown): number { return snapNumber(value, EDGE_PAN_SPEED); }
export function clampUiZoom(value: unknown): number { return snapNumber(value, UI_ZOOM); }

/**
 * Load-merge validation of the block above, plus the one-time migration (marker `reflowFeaturesMigrated`):
 *  - telestratorMode becomes 'replays' for EVERY existing install once (owner 11-03); a later pick ('all' / 'off') is
 *    kept because the stamped marker stops the step from running again.
 *  - turnClockWarning replaces the "Turn clock 1 minute" sound toggle (soundStyles.turnClockMinute): a coach who had
 *    it off gets 'off' (the warning tones stay silent, exactly as before) and the old toggle entry is retired so the
 *    select alone decides from now on.
 * `raw` is the stored blob; `merged` already holds DEFAULTS + raw with soundStyles validated. Mutates `merged`.
 */
export function normalizeReflowFeatures(raw: Partial<SettingsReflowFeatures>, merged: SettingsReflowFeatures & { soundStyles: Record<string, string> }): void {
  merged.edgePan = raw.edgePan === true;
  merged.edgePanSpeed = clampEdgePanSpeed(raw.edgePanSpeed);
  merged.telestratorMode = TELESTRATOR_MODES.includes(raw.telestratorMode as TelestratorMode) ? raw.telestratorMode as TelestratorMode : REFLOW_FEATURE_DEFAULTS.telestratorMode;
  merged.uiZoom = clampUiZoom(raw.uiZoom);
  merged.highContrast = raw.highContrast === true;
  merged.reduceMotion = raw.reduceMotion === true;
  merged.reduceFlashing = raw.reduceFlashing === true;
  merged.visualSoundCues = raw.visualSoundCues === true;
  merged.largerTargets = raw.largerTargets === true;
  merged.turnClockWarning = TURN_CLOCK_WARNINGS.includes(raw.turnClockWarning as TurnClockWarning) ? raw.turnClockWarning as TurnClockWarning : REFLOW_FEATURE_DEFAULTS.turnClockWarning;
  const migrated = typeof raw.reflowFeaturesMigrated === 'number' && Number.isFinite(raw.reflowFeaturesMigrated) ? raw.reflowFeaturesMigrated : 0;
  if (migrated < 1) {
    merged.telestratorMode = 'replays';
    if (merged.soundStyles.turnClockMinute === 'off') merged.turnClockWarning = 'off'; // the old silence, mapped once
  }
  // Sol r1: the retired toggle's entry goes on EVERY load (sounds.ts never reads it either): the select decides.
  delete merged.soundStyles.turnClockMinute;
  merged.reflowFeaturesMigrated = Math.max(migrated, REFLOW_FEATURES_MIGRATION);
}
// ============================================ end of SETTINGS REFLOW - NEW FEATURES ==================================

export interface AppSettings extends ConfirmationSettings, SettingsReflowFeatures, ControlLayerSettings {
  // hotkeys (KeyboardEvent.code values)
  confirmKey: string;
  /** Owner 10-02: toggles the Helmet roster pop-out (KeyboardEvent.code; default H). */
  rosterKey: string;
  /** Owner 10-02: toggles the Log window between its size and double (KeyboardEvent.code; default L). */
  logExpandKey: string;
  /** Owner 09-05: WASD camera glide speed, screen px per frame (2-30, 9 = original). */
  cameraPanSpeed: number;
  /** Owner 10-10: controller support is OPT-IN (Settings > Controls "Enable controller support", default off). While
   *  off nothing reads a gamepad: no poller, no listeners, no input switching, no crosshair / glyphs / rumble / toasts
   *  (game/controllerRuntime.ts). Ticking the box asks first (the "mostly untested" notice). */
  controllerSupportEnabled: boolean;
  /** Touch mode (spec-touch-mode-2026-11-12 section 3): 'auto' = finger-primary devices start in touch mode (game/
   *  touchMode.ts resolveTouchMode); 'on' / 'off' pin it. Settings > Controls "Touch controls (beta)". */
  touchMode: TouchModeSetting;
  /** The remembered answer to the one-time Touch / Mouse question on a device with both ('' = never asked). */
  touchModeChoice: TouchModeChoice;
  /** Touch mode: how long End Turn / End Setup must be held, ms (400-2000, default 800). */
  touchEndTurnHoldMs: number;
  /** Touch mode: minimum action-center / touch button size, CSS px (48-72, default 48). */
  touchButtonSize: number;
  /** Controller support P1 (owner 10-07): 'auto' (default) follows the last device used (game/controls.ts activeInput);
   *  'keyboard' / 'controller' pin it. The mouse and keyboard keep working in every mode. */
  inputMethod: InputMethod;
  /** The 1.5 s corner notice on each auto switch ("Controller" / "Mouse & keyboard"); default on. */
  showInputSwitchNotice: boolean;
  /** Every action's keyboard + controller bindings (game/controls.ts). The keyboard primary of confirm / roster /
   *  log lives in confirmKey / rosterKey / logExpandKey (mirrored here). */
  controlBindings: ControlBindings;
  /** FUMBBL keyboard shortcuts (owner 11-03): one chord per FFB key action (game/fumbblKeys.ts); live only while
   *  `fumbblShortcuts` is on. */
  fumbblKeyBindings: FumbblKeyBindings;
  /** game/controls.ts CONTROL_BINDINGS_REVISION of the stored map (drives default-move migrations). */
  controlBindingsRevision: number;
  /** Settings > Controls: rumble on dice / turnover / casualty (arrives in P4; owner round 2: default on). */
  controllerRumble: boolean;
  /** Owner round 2 (10-07): radial stick deadzones, rescaled response (0.05-0.40, default 0.15). */
  stickDeadzoneLeft: number;
  stickDeadzoneRight: number;
  /** Controller support P2a (owner round 2, 10-07): the player card loads on a player click ('auto', the existing
   *  behaviour) or only when called (key P / pad Y / double-click / roster row). Settings > UI. */
  playerCardMode: PlayerCardMode;
  /** Owner o66mh: pad crosshair speed, squares per second (Settings > Controls slider 3-15, default 8). */
  crosshairSpeed: number;
  /** Owner o66mh: the crosshair speeds up to 2x over 1 s of travel in one direction (default off = flat). */
  crosshairAcceleration: boolean;
  // markings
  tackleZoneMode: 'off' | 'opposition' | 'friendly' | 'both';
  /** Owner 10-12: spectate / replay only (play keeps tackleZoneMode). Absolute teams: whose zones the quick bar shows
   *  while watching, regardless of whose turn it is. Default 'none' = no change until the viewer presses it. */
  spectatorTackleZoneMode: SpectatorTackleZoneMode;
  showDefaultSkills: boolean;
  showPositionRings: boolean;
  /** Owner 10-18: the Hatred icon draws only while a player on the OTHER team carries a hated keyword (hatredIconGate). */
  hatredIconNeedsTarget: boolean;
  /** Owner 2026-07-08: persistently show the block-dice preview (count over each
   *  adjacent opponent's head) for the selected/active player. */
  showBlockDice: boolean;
  /** FUMBBL auto-marking config JSON (UI-6); '' = markings off. */
  markingsConfig: string;
  /** Owner 10-09: where the current markings were imported from (Settings shows it); '' / 0 = never imported, or
   *  cleared since. Display only: nothing re-imports on its own. */
  markingsImportCoach: string;
  markingsImportAt: number;
  /** B2-17: skill icons and skill markings are mutually exclusive. */
  skillDisplay: 'icons' | 'markings';
  /** On-pitch skill-marking typography. Markings stay one line; these settings
   *  tune the shared Modern/Classic Pixi label without changing its contents. */
  skillMarkingColor: string;
  skillMarkingFont: 'arial' | 'helvetica' | 'system' | 'nuffle';
  skillMarkingSize: number;
  /** Owner 11-11 (opt-in, default off): text markings draw stat increases, stat decreases and niggling injuries on
   *  their own line above the skill marks, for every player (game/markings.ts generateMarkingLines). */
  markingStatusLine: boolean;
  /** Owner 09-15: the font of the position letter on the Checkers discs (Display > Player sprites). */
  checkerLetterFont: 'arial' | 'helvetica' | 'system' | 'nuffle';
  /** One-shot legacy BB2/BB3 migration hint; installed-pack identity owns rendering. */
  skillIconStyle: 'bb3' | 'bb2';
  /** Owner 09-09: which BUNDLED skill-badge family serves when no pack is assigned to the skill-icon slot —
   *  'default' = the flat badges ("Built-in default"), 'illustrated' = the illustrated set ("Illustrated - Default"). */
  skillBadgeFamily: 'default' | 'illustrated';
  /** Owner 10-06: which BUNDLED block-dice face family serves when no pack is assigned to the block-dice slot —
   *  'default' = the Super FUMBBL faces ("Built-in default"), 'krisb' = Kristofer Bengtsson's faces ("Rick dice (built-in)"),
   *  'fumbbl' (owner 11-04) = WhatBall's FUMBBL dice ("FUMBBL dice (built-in)"). */
  blockDiceFamily: 'default' | 'krisb' | 'fumbbl';
  /** Owner 10-06: the plate the bundled block-die faces sit on — 'auto' (default) matches the face set (black for the
   *  Super FUMBBL and FUMBBL faces, white for KrisB; resolveBlockDieSurface), or an explicit 'black' / 'white'. Pack-bound faces
   *  are complete images and are drawn as they are. Owner 10-13: 'team' = "Brushed metal, home and away" - the dice
   *  of the displayed home side (the local coach in play, the server home team for spectators) on the blue blank, the
   *  away side's on the red one; dice with no known owner keep the 'auto' surface. */
  blockDiceSurface: 'auto' | 'black' | 'white' | 'team';
  /** Immutable native installation identity for the selected skill-icon mod pack.
   *  Never a filesystem path; empty uses generated initials. */
  skillIconPackInstallId: string | null;
  /** One immutable installed identity per independent presentation capability. */
  assetPackAssignments: { skillIcons: string; playerSprites: string; walkSheets: string; soundEvents: string; teamLogos: string; blockDice: string };
  // client options
  url: string;
  /** FUMBBL (official) account credentials. */
  coach: string;
  password: string;
  /** Owner 2026-07-04: Super FUMBBL (fork) account credentials — kept SEPARATE from
   *  the FUMBBL account so a coach can log into either service. Used when the
   *  active server target is our fork (auth 'standalone'). */
  coach40k: string;
  /** ⚠ NO `password40k` here. The fork password lives in the OS credential store
   *  (game/credentials.ts) — settings is serialized to localStorage in clear. */
  compression: boolean;
  /** Self-host (self-host-plan §4): which backend preset from SERVER_TARGETS
   *  is active. The picker derives url + compression from it. */
  activeServerTarget: string;
  /** Owner 2026-07-07 / 2026-07-21 (#102): OPTIONAL override for the effective FORK host (game WS + config-web).
   *  Owner 10-31: FORK edition only (the public build never reads or writes it). EMPTY by default → the host comes
   *  from the launch flag or VITE_FORK_SERVER_HOST (game/forkAccess.ts). A non-empty value re-points the fork to
   *  `ws://<forkHost>:22227/command` (+ config-web) at runtime with no rebuild. */
  forkHost: string;
  /** Owner 2026-07-08: base URL of the Tournament Bot's config-web server, which exposes the
   *  fork-JNLP endpoint (`/api/fork/jnlp`) used for one-click "Launch" joins. Empty = derive
   *  `http://<forkHost>:4310` (the Bot runs on the fork host). Editable so it can point elsewhere. */
  botConfigUrl: string;
  /** Sol r21 (FORK edition): the fork target's `url` is a custom value the coach typed in the raw Server input (not
   *  the preset derived from the fork host). false = derive it from the effective host at load. Never persisted by the
   *  public build. */
  forkUrlCustom: boolean;
  // video (F-2): renderScale 1 = 100% default; 0 remains the explicit Auto option. FPS is always bounded.
  renderScale: number;
  /** 'display' (owner 10-13) = match the monitor's measured refresh rate; resolved to a number before the renderer. */
  fpsCap: number | 'display';
  /** Owner 08-19: stadium bowl on/off (Modern; Classic forces off via its preset). */
  showStadium: boolean;
  /** Owner 11-12: one switch for weak machines (game/lowPerformanceMode.ts). On = the preset's low video values were
   *  written into the individual settings; the coach may still change any of them while it stays on. */
  lowPerformanceMode: boolean;
  /** The coach's own values of the preset keys from before Low performance mode was switched on; null = none held.
   *  Turning the mode off restores each one whose setting still holds the preset's low value. */
  lowPerformanceRestore: LowPerformanceRestore | null;
  /** Owner 09-25: stand art — 'crowd' = baked-crowd tiles, 'classic' = seat atlas + fan sprites (default again, owner 10-05). */
  stadiumStands: 'crowd' | 'classic';
  /** Owner 10-12: what sits behind the stadium. 'skybox' = the fantasy skybox (default, unchanged), 'space', 'parking'
   *  = the old night parking lot, 'galaxy' = ESA/Hubble's Whirlpool Galaxy (credited in Settings), 'color' = a plain fill in `backdropColor`. */
  backdrop: BackdropSetting;
  /** Owner 10-12: the plain backdrop colour (CSS #rrggbb), used when `backdrop` is 'color'. */
  backdropColor: string;
  /** Owner 2026-07-04e: UI-CUSTOMIZE mode — when on, the corner panels grow a
   *  drag grip (top-left) + a resizer (bottom-right) so they can be moved/scaled. */
  uiCustomize: boolean;
  /** Per-panel layout overrides (edge-relative position + scale; x/y retained for v11 compatibility). Empty = CSS default;
   *  a panel only gets an entry once the user drags/resizes it. Keyed by panel id
   *  ('coach-home' / 'coach-away' / 'scoreboard' / 'config-bar'). */
  uiLayout: Record<string, EdgePanelPosition & { scale: number }>;
  /** Renderer brightness/gamma in percent (100 = neutral, 50–150). */
  brightness: number;
  /** F-3: 0 = muted, 100 = full. */
  soundVolume: number;
  /** Per-event built-in sound style. Missing keys use the manifest default. */
  soundStyles: Record<string, string>;
  // B2-8/9 (UI7): log window customization
  logOpacity: number;
  /** Owner 09-23: log line timestamps — OFF by default (clutter). */
  logTimestamps: boolean;
  /** Owner 09-24: Discord Rich Presence (local Discord shows the current game) + the Spectate button for friends. */
  discordPresence: boolean;
  discordSpectateInvites: boolean;
  logFontSize: number;
  logFont: 'nuffle' | 'arial' | 'mono';
  /** Owner 09-16 (Settings > Display > Log): dice ROLLS render as one summed number instead of die faces. */
  logDiceAsNumbers: boolean;
  /** Owner 09-16: the NEEDED roll renders as a number instead of a die face. */
  logNeededAsNumbers: boolean;
  /** Owner 10-15 (Settings > Display > Log > Log style): 'text' = the plain log (default); 'graphical' = every line a
   *  row tinted with the acting team's colour, with the action's icon (and a reroll's source icon) on its left;
   *  'fumbbl' (owner 10-16) = the upstream FUMBBL client's own log wording and layout. */
  logStyle: 'text' | 'graphical' | 'fumbbl';
  /** Owner 10-16 (Settings > Display > Log > Chat style): 'bubbles' = each chat message a bubble shaded with a dark
   *  version of the speaker's team colour, the chat building from the bottom (default); 'text' = the plain chat lines. */
  chatStyle: 'text' | 'bubbles';
  /** Owner 10-15 (Settings > Display > Log > Row colour strength): 0-100, how strong the Graphical rows' team tints
   *  paint (100 = the launch look, which the owner found a little bright). */
  logTintStrength: number;
  /** Display-only match-log preference. Internal plan/play sequencing remains stored
   *  for bug reports and developer diagnostics when hidden. */
  showServerSequencingEvents: boolean;
  logPos: EdgePanelPosition | null;
  logSize: { w: number; h: number } | null;
  /** The selected-player card's dragged position (pitch-host px, left/top) and resized box. Null keeps the docked
   *  default / the CSS size. Written at the end of a drag or resize; clamped into the host when the card shows. */
  playerCardPos: { x: number; y: number } | null;
  playerCardSize: { w: number; h: number } | null;
  /** Floating setup-template browser geometry. Null keeps the compact responsive default. */
  setupBrowserPos: EdgePanelPosition | null;
  setupBrowserSize: { w: number; h: number } | null;
  /** Owner 2026-07-08: swap the bottom bars — Quick bar to the bottom-RIGHT, Log to
   *  the bottom-LEFT (Log leads, matching left-to-right reading). Default true. */
  bottomBarsSwapped: boolean;
  /** Owner 10-02: the roster moved to the Helmet quick-bar pop-out; true brings the old Roster tab back to the
   *  Log | Chat dock. Default false. */
  chatDockRosterTab: boolean;
  // B2-13: skill-description text styling
  /** B3-8: UI-wide font choice (Settings pane always Arial/Helvetica). */
  uiFont: 'nuffle' | 'system' | 'arial';
  /** Accessibility floor for all client text. The UI never renders numeric text below this size. */
  uiTextSize: number;
  /** Spike Trophy-inspired app/pitch cursor theme. False restores platform cursors. */
  useFantasyCursor: boolean;
  /** B4-2: movement depiction. Owner 2026-07-05: default is `trail` (slide + echo);
   *  `slide` is the plain FUMBBL-style depiction (marked in the UI). */
  moveStyle: 'walk' | 'hop' | 'trail' | 'slide' | 'hoptrail';
  spriteSet: 'classic' | 'checkers' | 'chess' | 'walk';
  walkAnimation: boolean;
  walkFps: number | null;
  /** Owner 2026-09-04: idle walkers face the camera (south) instead of their end-zone forward. */
  walkFaceCamera: boolean;
  /** Owner 09-06: fake-sun cast shadow under each standing walker (prototype; default on). */
  castShadows: boolean;
  /** Owner 10-03: blood splatter decals on the tile where a player was casualtied (Settings > Display). */
  bloodSplatters: boolean;
  /** Owner 10-21: the movement-left badge at the acting / selected player's feet. */
  moveBadge: boolean;
  /** Owner 10-22: route / reach roll chips wear the mover's Home / Away die (Settings > Display); off = neutral grey. */
  plannerDiceSeatTint: boolean;
  /** Owner 10-22 ("Option A"): lets a second client instance start (Settings > General > Client windows). The shell
   *  reads this key from settings.json at startup (second_client.rs), before any page loads. */
  allowSecondClient: boolean;
  /** The edition ('public' / 'fork') that turned allowSecondClient on. Both builds share the settings file; the shell
   *  honours allowSecondClient only when this names its own edition (Astra 10-22). Written with the checkbox. */
  allowSecondClientEdition: string;
  /** Owner 09-09 ("option 3"): players and their markers stay one size on every square; the ground keeps its
   *  perspective with a softer far edge. Off = Madden depth scaling. */
  uniformFigures: boolean;
  /** Owner 09-10: the same switch for EAST-WEST mode, independent of the N-S one; on by default. */
  uniformFiguresEw: boolean;
  /** Owner 09-06: active-player action decorations — the approved artwork (default) or the emoji glyphs. */
  actionDecorations: 'art' | 'emoji';
  /** Per-square confirmed movement speed (ms per tile). Lower = faster.
   * Picker options 50/100/150/200/300/400; default 100. */
  moveSpeedMs: number;
  /** Owner 09-06: block-dice tumble lead-in (ms) before the real faces reveal; slider 100-600, default 250. */
  blockTumbleMs: number;
  /** Render the block chooser's authoritative dice with the bundled 3D model when available. */
  blockDice3d: boolean;
  /** Owner 2026-07-04: colour of the Slide+Path-Trail echoes. 'auto' = white on a
   *  dark background, black on a light one. */
  trailColor: 'auto' | 'white' | 'black' | 'gold';
  /** Owner 09-16: movement planner colours (Settings > Movement planner) — Primary = the route line, dots and
   *  plot numbers; Secondary = every step that owes a roll (dodge / rush / pickup). Defaults: plot blue + gold. */
  plannerPrimaryColor: string;
  plannerSecondaryColor: string;
  /** Owner 2026-07-08: what the movement trail leaves — 'echo' (fading footprints,
   *  default) or 'numbers' (1,2,3… counting each square moved this activation). */
  trailMarks: 'echo' | 'numbers';
  /** Owner 2026-07-05: where the incoming-chat toast lives on screen. */
  chatToastPos: 'left' | 'right' | 'bottomLeft' | 'top' | 'center';
  /** Text size for authored Final-Fantasy chat toasts only. The global UI text
   *  floor can still raise the effective size above this preference. */
  chatToastTextSize: number;
  /** Owner 2026-07-08: pop a toast on an incoming chat line (default on). When OFF,
   *  new chat is surfaced only as an unread-count badge on the CHAT tab. */
  chatToastsEnabled: boolean;
  /** Owner ruling 2026-08-17: disable chat entirely — hides the CHAT tab (falls back to
   *  LOG if it was active) and suppresses chat toasts. Display-only: the client still
   *  receives/stores chat lines, so re-enabling shows the history. Default false (chat on). */
  chatDisabled: boolean;
  /** Owner ruling 2026-08-17 (rebuild 08-18): pop the Chat tab out into a floating,
   *  draggable/resizable panel. While popped out, chat toasts are suppressed (the panel is
   *  itself always visible). Pos/size below; null = never moved/resized (default corner +
   *  size). Fail-closed to DOCKED (false) on load so a corrupt value can never strand the
   *  user in a floating state whose dock control they cannot reach. */
  chatPoppedOut: boolean;
  chatPopPos: EdgePanelPosition | null;
  chatPopSize: { w: number; h: number } | null;
  /** Replay transport geometry. Null retains the centered responsive default. */
  replayControlsPos: EdgePanelPosition | null;
  replayControlsSize: { w: number; h: number } | null;
  /** Owner 10-06: Replay pane search - show "vs" instead of scores / results (spoiler-free browsing). */
  replaySearchHideScores: boolean;
  /** B5-2: spectator-clean — hide planner + dice previews while spectating. */
  spectatorClean: boolean;
  /** Owner 10-11: which end each team is drawn at while spectating, in a replay and in review (never in play).
   *  'drive' (default) follows the drive as before; 'home' / 'away' keep that team at the bottom; 'mine' keeps the
   *  viewer's own team there when the viewer coached one of the two teams (else follows the drive). game/spectatorView.ts. */
  spectatorView: SpectatorView;
  /** B6-4: when cinematic injury playback fires.
   *  'armor-break' (default) = every armor break; 'casualty' = casualties
   *  only; 'off' = never (splash still shows). */
  /** Owner 08-19: RETIRED (zero consumers — dead since the injury-banner rework); field kept
   *  out of the UI; type retained so old persisted blobs still parse. */
  cinematicMode: 'armor-break' | 'casualty' | 'off';
  /** B8-8: pitch orientation. 'ns' (default) = end zones top/bottom;
   *  'ew' = end zones left/right (the projection rotated 90°). */
  pitchOrientation: 'ns' | 'ew';
  /** Owner 10-12: the pitch VIEW turned around 180 degrees (north / south or east / west swapped). A view choice only:
   *  teams, HUD seats and every command are unchanged. Toggled by the `pitchFlip` action and the Settings checkbox beside the pitch orientation. */
  pitchFlipped: boolean;
  /** ORDER 66 (A.2): route play-mode interaction through the ported state machine (deriveClientState →
   *  action menu + click-per-square move) instead of the hotbar/planner. Off = legacy path untouched. */
  order66: boolean;
  /** Blitz declaration entry gesture. FUMBBL keeps context-menu-first declaration;
   *  Modern enables the friendly-player → opponent two-click planner. */
  declareBlitzBehavior: 'modern' | 'fumbbl';
  /** Clicking another friendly during a declared movement rail refunds or ends the current activation. */
  friendlyPlayerSwitch: boolean;
  /** Owner 10-05: the previous player's end is sent only when the newly clicked player is actually activated. */
  deferFriendlySwitchEnd: boolean;
  /** Friendly player left-clicks show their legal action menu instead of auto-declaring Move. */
  leftClickOpensContextMenu: boolean;
  /** Owner 2026-07-10: DEVELOPER mode — unlocked by the `-dev` exe arg / `?dev`. Gates the
   *  Settings → Developer section + the live Developer log panel. */
  devMode: boolean;
  coachBrain: 'none' | 'random' | 'fly-chaos';
  flyBrainUrl: string;
  /** Developer log panel visible. */
  devPanelOpen: boolean;
  /** Feed wire traffic (reports/dialogs/turnMode + outbound commands) into the Developer log. */
  devWireCapture: boolean;
  /** B9-1: log verbosity. false (default) = dice rolls only (deduped);
   *  true = every report, no dedup (debugging). */
  debugLog: boolean;
  /** Owner 2026-07-07: VERBOSE WIRE LOG — when true, tee every wire frame (inbound
   *  serverModelSync + outbound client commands) to a JSONL file in the app log dir,
   *  ONE FILE PER OBSERVED GAME (for live diagnostics / ingest, e.g. TTM validation).
   *  Tauri-only (a no-op in the browser); off by default. */
  wireLog: boolean;
  /** Owner 2026-07-03: "Auto Director" — one toggle for the automatic camera work
   *  in spectate: cinematic ZOOM to the action, TRACKing + a camera NUDGE to keep
   *  the active player in view. Off = a calm, static camera (dice/splashes still
   *  play, the camera just doesn't move). Replaces the old `followActivePlayer`. */
  autoDirector: boolean;
  /** Turf/tileset theme (owner 2026-07-03: moved off the quick config-bar into
   *  Settings → Client). Options come from the renderer (`turfCatalog`). */
  turf: string;
  // --- accessibility (owner 2026-07-03 r3) ---
  /** Opacity of the two coach corner panel surfaces (content remains fully legible). */
  hudCoachOpacity: number;
  /** Opacity of the central scoreboard surface. */
  hudScoreboardOpacity: number;
  /** Opacity of the bottom quick-bar surface. */
  hudQuickBarOpacity: number;
  /** Opacity of incoming chat-toast surfaces. */
  hudToastOpacity: number;
  /** Owner 10-08: opacity of the Roster pop-out window (it used to follow the Log window's opacity). */
  rosterOpacity: number;
  /** Owner 10-08: hide the bottom "Confirm ..." bar (move / block / blitz / foul). Space and the second click still confirm. */
  hideConfirmBar: boolean;
  /** Show the pitch grid/yard lines (off = clean field for legibility). */
  gridLines: boolean;
  /** Grid line width multiplier (0.5–3, 1 = default). */
  gridLineWidth: number;
  /** Grid line colour (hex). Default matches the classic off-white line. */
  gridLineColor: string;
  /** Owner 09-05: grid line opacity multiplier (0.1-1, 1 = the renderer's own per-line alphas). */
  gridLineOpacity: number;
  /** Owner 2026-07-04f: colour of the pitch MARKINGS (Mark Square/Row/Column
   *  light columns). Accessibility setting; default red. */
  markColor: string;
  /** Colourblind mode (owner 09-10): a daltonization colour-matrix filter over the whole shell (pitch canvas + UI) —
   *  no asset conversion. deuteranopia/protanopia also keep the green→blue UI-accent remap; 'redgreen' (legacy) = deuteranopia. */
  colorblindMode: 'off' | 'redgreen' | 'deuteranopia' | 'protanopia' | 'tritanopia';
  /** Owner 10-23: client language (src/i18n). Applies live; every client-authored string and every server game term
   *  the client labels follows it. Server report text stays English (server-derived law). */
  language: Locale;
  /** Owner 10-23 (Astra r1): the user picked `language` explicitly (the setup wizard's Language card or the Settings
   *  dropdown, English included). Until then the wizard may adopt the system language - and only on a fresh install. */
  languageChosen: boolean;
  /** Owner 11-03: English split into English (US) `en` and English (UK) `en-GB`. True once a stored legacy `en` has been
   *  mapped onto its variant (i18n/englishVariant.ts mapLegacyEnglish) - so the mapping runs once per install and a
   *  later explicit English (US) pick is never re-mapped. A fresh install starts settled (the setup wizard detects). */
  englishVariantSettled: boolean;
  /** UI theme engine (owner 2026-07-14, spec black-red-ui-scheme.md): a preset or a custom Primary/Secondary
   *  pair drives the derived `--ui-*` token set (Settings → Accessibility). Default = the Black/Red headline. */
  uiTheme: 'brand-red' | 'fumbbl' | 'custom';
  uiPrimary: string;
  uiSecondary: string;
  /** Owner 11-03 (spec-client-restyle-and-team-port): interface style of the menu blades. 'modern' (default, new and
   *  existing installs) = the League Manager look (styles/lm-theme.css, opted into per blade with the `.sf-lm` class);
   *  'retro' = today's look. In-game HUD and Classic are unaffected. */
  uiStyle: 'modern' | 'retro';
  /** Owner 11-03: Modern's colour scheme. 'dark' (default) or 'light' (the League Manager's derived light values).
   *  Separate from `uiTheme` (the colour preset), which still recolours Modern's accents (game/lmTheme.ts). */
  uiColorScheme: 'dark' | 'light';
  /** Owner 11-03 (in-game redesign, "a new path"; coordinator ruling B): the in-game look. 'retro' (default) = today's
   *  HUD, panels and dialogs, unchanged; 'modern' = the League Manager look in a game (styles/lm-game/*.css under the
   *  `.sf-lm.lm-game` root). Separate from `uiStyle` until the owner folds the two together (game/lmTheme.ts
   *  inGameModern is the one-line switch). */
  uiGameStyle: 'modern' | 'retro';
  /** Show the on-pitch row-number markers (2/4/6/8/10/12). */
  showRowMarkers: boolean;
  /** Show the midfield sweet-spot crosshair markers. */
  showSweetSpot: boolean;
  /** Show the faded on-field team logos at the sweet spots. */
  showFieldLogos: boolean;
  /** Owner 10-06: prefix dugout band labels with the box's player count ("2 RESERVES"). Default OFF. */
  dugoutCounts: boolean;
  /** Owner 10-13: drop a coach-corner reroll chip once its count is 0 (no empty "0" chip). Default OFF. */
  hideZeroRerolls: boolean;
  /** Owner 10-13: show the Setup rules card when a setup phase starts. Default ON; off = starts closed, the reopen tab stays. */
  setupRulesCard: boolean;
  /** Owner 10-13: show the Formations panel when a setup phase starts. Default ON; off = starts closed, the reopen tab stays. */
  setupFormationsPanel: boolean;
  /** Owner 10-13: draw the green/red setup zone shading on the pitch during setup. Default ON. */
  setupZoneHelpers: boolean;
  /** Owner 10-06: the "N RES / N OUT" tab hanging off each coach corner panel. Default ON; right-click on it hides it. */
  coachCornerCounts: boolean;
  /** Owner 10-14: when a knockdown ends in a CASUALTY (the server's injury report says so), skip the armour dice and go
   *  straight from the knockdown to the casualty result, its sound and the apothecary offer. Default OFF. Presentation only. */
  skipArmourDiceOnCasualty: boolean;
  /** Owner 10-10: the roster panes (H pop-out, post-game Roster / MVP tabs, MVP nomination, Assign Touchdown) list only
   *  the skills a player GAINED; position (innate) skills are left out. Default ON; the panes' own checkbox flips it. */
  rosterHideInnateSkills: boolean;
  /** Owner 2026-07-08: end-zone label — 'team' (default, mirrors FUMBBL: each end
   *  bears its team's name) or 'touchdown' (just the word "TOUCHDOWN"). */
  endZoneLabel: 'team' | 'touchdown';
  /** Owner 09-05: the red/blue team shading over the end zones (tile turf + Acasas pack). */
  endZoneTint: boolean;
  /** Show the player number on each token (home team). Off by default (owner 2026-07-04). */
  showPlayerNumbers: boolean;
  /** Local presentation override: use the first upstream icon-sheet variant for every
   *  player sharing a team position. Server player/icon indices remain untouched. */
  oneSpritePerPosition: boolean;
  /** Position-ring density (opacity multiplier, 0.3–1.5, 1 = default). */
  positionRingDensity: number;
  /** Position-ring colour: 'auto' = per-position palette, else a hex override. */
  positionRingColor: string;
  /** Migration-only legacy SoundId → data URL map. Cleared only after native
   *  conversion into an owner draft and installed sound-events pack succeeds. */
  soundOverrides: Record<string, string>;
  /** Pre-game / kick-off splash cinematics wait for a click to dismiss instead
   *  of auto-advancing on a timer. */
  clickDismissCinematics: boolean;
  /** Play-permission token issued by OUR fork server. Required to join a game
   *  as a PLAYER while `requirePlayAuthToken` is on; sent on the join so the
   *  fork can validate it server-side (FM1/ffb-league). */
  playAuthToken: string;
  /** The token check. ON (default): no token → the client refuses/drops player
   *  play. OFF: the owner-elected official-FUMBBL path — play proceeds on the
   *  player's own FUMBBL account with no fork token. */
  requirePlayAuthToken: boolean;
  /** Per-skill display config (owner 2026-07-03 r6f): keyed by skill name, sparse
   *  (only customised skills are stored — the rest use the behaviour defaults).
   *  MY TEAM = home coach, OPPOSITION = away coach. `markerText` is the exact glyph
   *  shown at the player's feet (a user value OVERRIDES the JSON pre-fill). */
  skillConfig: Record<string, SkillConfigEntry>;
  /** Where skill ICONS render (owner 2026-07-03 r6f): 'head' (default, over the
   *  head — the classic badge position) or 'feet' (like the markers). */
  iconPosition: SkillRenderPosition;
  /** Where skill MARKERS render: 'feet' (default, foot text) or 'head' (over the
   *  head — like the icons). */
  markerPosition: SkillRenderPosition;
  /** Owner 2026-07-04: where the on-pitch die-roll-CAUSE tag (yellow dodge D,
   *  skill-icon pickup/catch/…, reroll ↻) sits on the action d6 — 'corner'
   *  (default, top-right offset to the edge), 'top', 'side', 'bottom', or 'off'. */
  dieTagPosition: DieTagPosition;
  /** Owner 10-14: planned-path roll tags. 'dieWord' (default) = D6 face + "+" over RUSH / DODGE / PICKUP;
   *  'letter' = the 1.0.204 plates R2+ / D4+ / P3+. */
  plannerTagStyle: 'dieWord' | 'letter';
  /** Owner 10-14: blitz target badge lifetime. 'turn' (default) = kept for the rest of the turn; 'fumbbl' = cleared when the
   *  server clears its blitz target (end of the blitz), as base FUMBBL. The blitzer's own badge is unchanged. */
  blitzTargetMarker: 'turn' | 'fumbbl';
  /** Owner 10-15 (UAT 1.0.208 JLeav): while a declared Block/Blitz awaits its target click, show the server's block
   *  dice dots over every decorated target. Default on; off = dots only after the target click (the pre-1.0.216 look). */
  preClickBlockDice: boolean;
  /** Visual treatment for every D6 surface. Brushed metal is the install default;
   *  the original black set remains available as a local presentation choice. */
  d6FaceVariant: 'brushed-metal' | 'black' | 'team'; // owner 10-13: 'team' = blue home / red away D6s (d6.ts)
  /** Owner 10-20: the coach rank badge art (Play coach card, game-load rank panel) - the realistic set
   *  (public/badges/coach) or the retro pixel-art set (public/badges/coach-retro). */
  coachBadgeStyle: CoachBadgeStyle;
  /** Owner 2026-07-06: PER-AURA shading, each surfaced independently —
   *  'always' every emitter, 'selected' only the selected player, 'off' none.
   *  Colours are friendly/opposition (home = friendly): Disturbing Presence =
   *  blue/red, Pick-Me-Up = green/beige. */
  auraDisturbingPresence: 'always' | 'selected' | 'off';
  auraPickMeUp: 'always' | 'selected' | 'off';
  /** Owner 2026-07-08 (pipeline Phase 3b): how a STUN injury result is presented —
   *  'banner' (default, the full injury banner like every other result) or 'tag' (a
   *  lightweight token-anchored tag like the KO toast, so a stun no longer interrupts
   *  hard). Injury-pacing-review §4-1. Stun only; KO/casualty are unaffected. */
  /** Owner 2026-07-08: show the full-width CASUALTY SPLASH banner on a casualty.
   *  Default OFF — the token-anchored casualty toast (red) carries it; the splash is
   *  opt-in. The toast is unaffected by this. */
  casualtySplash: boolean;
  /** Owner 2026-07-04f: FLAT (non-isometric) render — no perspective taper + no
   *  off-centre token nudge. Off = the default isometric/Madden look. */
  flatRender: boolean;
  /** Owner 2026-07-07: show the on-pitch turn/score/re-roll tracks (the SW + NE off-pitch grids). */
  turnTrack: boolean;
  /** Owner 2026-07-06: DEPRECATED gold-echo pop when the active player changes.
   *  Off by default — the halo "selection pop" (grow→settle) is the primary
   *  active-player indicator now; enable this to also flash the old echo ring. */
  activePlayerEcho: boolean;
  /** Owner 2026-07-04: a small faint echo at the cursor on EVERY click (app-wide). */
  clickEcho: boolean;
  /** Colour of the click echo (default gold). */
  clickEchoColor: string;
  /** Owner 2026-07-06: click-echo size multiplier (0.5–2, 1 = the 9px default). */
  echoSize: number;
  /** Owner 2026-07-03 r6f: the first-run FUMBBL-credentials prompt has been shown
   *  (so it doesn't re-appear every launch). */
  completedFirstRun: boolean;
  /** Last legal-notice revision explicitly acknowledged on this install. This is
   *  deliberately independent of settingsVersion: each legal revision gates all
   *  existing and fresh installs once, without replaying unrelated migrations. */
  legalAcceptanceVersion: number;
  /** Last first-open contributions-screen revision seen (owner 08-27); shows once per revision, after the legal notice. */
  contributionsSeenVersion: number;
  /** Last first-launch setup-wizard revision completed (owner 10-06); the wizard shows while this is below
   *  SETUP_WIZARD_VERSION (game/setupWizard.ts) — for EVERY install, new or existing — after the contributions screen. */
  setupWizardSeenVersion: number;
  /** Owner 10-06: last FUMBBL.COM walkthrough revision completed or skipped (game/homeTour.ts
   *  HOME_TOUR_VERSION); the walkthrough runs while this is lower. Settings > General can reset it. */
  homeTourSeenVersion: number;
  /** Owner 10-06: last client walkthrough revision completed or skipped (game/clientTour.ts CLIENT_TOUR_VERSION). */
  clientTourSeenVersion: number;
  /** Owner 10-06: zoom of the docked FUMBBL site, 0.75-2 (game/fumbblHome.ts clampHomeZoom). */
  homePaneZoom: number;
  /** Owner 10-08: the floating FUMBBL window's place and whole-frame size (game/fumbblFloatLayout.ts). Null = never
   *  moved / resized (bottom-right corner, default size). Whether it is floating is session state (ui.fumbblFloating). */
  fumbblFloatPos: EdgePanelPosition | null;
  fumbblFloatSize: { w: number; h: number } | null;
  /** Owner 10-09: the frame's size while it shows the QUEUE view (the page cropped to the Gamefinder's queue panel),
   *  separate from fumbblFloatSize (the frame when it has to show the whole page: an older shell, a page without the
   *  panel). Null = never resized by the coach: the frame fits the Blackbox box at the current zoom. */
  fumbblFloatQueueSize: { w: number; h: number } | null;
  /** Owner 10-09: the floating window's OWN zoom (its slider; 0.5-2, default 100 %). Independent of homePaneZoom:
   *  the docked pane's zoom comes back when the page returns to the pane. */
  fumbblFloatZoom: number;
  /** Skip the welcome splash on launch (Settings toggle). */
  hideWelcomeSplash: boolean;
  /** Owner 08-18: "Skip this next time" on the account-setup splash. RETIRED 10-06 — the first-launch setup wizard
   *  replaced that splash; kept only so existing blobs round-trip. Nothing reads it. */
  hideCredsSplash: boolean;
  /** Skip the getting-started/tutorial splash on launch ("don't show again"). */
  hideTutorialSplash: boolean;
  /** Owner 2026-07-06: DODGE re-roll handling. 'auto' (default) = when a failed
   *  dodge offers the natural Dodge skill as a re-roll, spend it automatically
   *  without surfacing a prompt; 'manual' = surface the interactive re-roll
   *  prompt and wait for the coach. Only affects OUR players in play mode.
   *  Surfaced as the "Dodge" toggle in AUTOMATIC SKILL USAGE ('auto' == on). */
  dodgeReroll: 'auto' | 'manual';
  /** Owner 2026-07-14: AUTOMATIC SKILL USAGE (Settings → Gameplay). For each skill, ON = the client
   *  auto-answers the server's `skillUse` prompt by USING the skill (for OUR players in play mode),
   *  with no interactive Yes/No; OFF (default) = surface the interactive skill-choice prompt (today's
   *  behaviour). These are all "may choose to use" reactive skills the server offers as a skillUse
   *  dialog. Dodge is handled separately by `dodgeReroll` (a re-roll, not a skillUse) — it's shown in
   *  the same UI group but keys off that field. */
  autoUseSkills: {
    fend: boolean;
    standFirm: boolean;
    tackle: boolean;
    sidestep: boolean;
    taunt: boolean;
  };
  /** Owner 2026-07-08 (FC): UI presentation fork. 'fumbbl40k' = the Modern view, the only one since owner 11-05
   *  retired the FUMBBL-Classic view ('classic' survives only as a store-level value; load() always pins 'fumbbl40k'). */
  uiMode: 'fumbbl40k' | 'classic';
  /** Modern/Order66 HUD shell. Minimalist preserves the compact first-pass panels;
   *  chrome adds the molded console treatment without changing controls or layout. */
  modernHudStyle: 'chrome' | 'minimalist';
  /** Local-only saved-setup previews. The upstream list wire carries names, not coordinates. */
  savedSetupPreviews: Record<string, Record<string, {
    playerNumbers: number[];
    playerCoordinates: [number, number][];
  }>>;
  /** Owner 10-11: which of each FUMBBL coach account's teams were played on this machine, newest first (game/
   *  recentPlayedTeams.ts). Local only: leads the recent-games team order, and is left out of bug reports. The coach
   *  name is a VALUE (`account`), never a key: stripSecretFields deletes keys that look like a credential. */
  recentPlayedTeams: { account: string; teams: { teamId: number; at: number }[] }[];
  /** Owner 2026-07-05: persisted-settings schema version. Bumped when a default
   *  change should be FORCED onto existing installs (see `load()` migrations). */
  settingsVersion: number;
}

/** Where a skill icon/marker draws relative to the player token. */
/** 'centre' (owner 09-15): ON the token — the Checkers chip face or the sprite's centre (explicit choice, any mode). */
export type SkillRenderPosition = 'head' | 'feet' | 'centre';

/** Where the on-pitch die-roll-cause tag sits on the action d6. */
export type DieTagPosition = 'corner' | 'top' | 'side' | 'bottom' | 'off';

/** All-the-time = always show; Only-if-added = show only when the skill was GAINED
 *  as an advancement (not a baseline positional skill); Never = always hidden. */
export type SkillBehaviour = 'always' | 'added' | 'never';

export interface SkillConfigEntry {
  /** Skill-icon (badge) behaviour for the home coach's players. */
  iconMine?: SkillBehaviour;
  /** Skill-icon (badge) behaviour for the away coach's players. */
  iconOpp?: SkillBehaviour;
  /** Skill-marker (foot text) behaviour for the home coach's players. */
  markerMine?: SkillBehaviour;
  /** Skill-marker (foot text) behaviour for the away coach's players. */
  markerOpp?: SkillBehaviour;
  /** The exact marker glyph shown at the feet (overrides the FUMBBL JSON pre-fill). */
  markerText?: string;
  /** Owner 09-25: the marker fields came from "Import markings from fumbbl.com" — a re-import replaces them and
   *  retires entries whose rule no longer exists; hand-set entries are never touched by the retire pass. */
  markerImported?: boolean;
  /** Owner 10-10: an IMPORTED single-skill rule's own "repeat for each time it matches", stored only when it differs
   *  from the table's default (a characteristic improvement repeats, any other skill does not). Absent = the default. */
  markerRepeat?: boolean;
}

export type PlayerCardMode = 'auto' | 'called';

/** Owner 10-12: the Whirlpool Galaxy image is ESA/Hubble heic0506a, CC BY 4.0: its credit must be visible and unaltered. */
export const GALAXY_BACKDROP_CREDIT = 'Image: NASA, ESA, S. Beckwith (STScI), and The Hubble Heritage Team (STScI/AURA)';
export const GALAXY_BACKDROP_URL = 'https://esahubble.org/images/heic0506a/';
/** The renderer's clear colour: the plain backdrop starts there. */
export const DEFAULT_BACKDROP_COLOR = '#14161a';

const DEFAULTS: AppSettings = {
  confirmKey: 'Space', // owner 2026-07-02: Space confirms queued moves
  rosterKey: 'KeyH', // owner 10-02: H opens the roster pop-out
  logExpandKey: 'KeyL', // owner 10-02: L doubles the Log window, L again restores it
  cameraPanSpeed: 16, // owner 10-07: 9 -> 16 px per frame
  controllerSupportEnabled: false, // owner 10-10: opt-in
  touchMode: 'auto',
  touchModeChoice: '',
  touchEndTurnHoldMs: TOUCH_HOLD_MS.default,
  touchButtonSize: TOUCH_BUTTON_PX.default,
  inputMethod: 'auto',
  showInputSwitchNotice: true,
  controlBindings: defaultControlBindings(),
  controlBindingsRevision: CONTROL_BINDINGS_REVISION,
  controllerRumble: true,
  stickDeadzoneLeft: STICK_DEADZONE,
  stickDeadzoneRight: STICK_DEADZONE,
  playerCardMode: 'auto',
  crosshairSpeed: CROSSHAIR_SPEED_DEFAULT,
  crosshairAcceleration: false,
  tackleZoneMode: 'opposition',
  spectatorTackleZoneMode: 'none',
  showDefaultSkills: false,
  showPositionRings: true,
  hatredIconNeedsTarget: true,
  showBlockDice: false,
  markingsConfig: '',
  markingsImportCoach: '',
  markingsImportAt: 0,
  skillDisplay: 'icons',
  skillMarkingColor: '#f5c542',
  skillMarkingFont: 'arial',
  skillMarkingSize: 12,
  markingStatusLine: false,
  checkerLetterFont: 'arial',
  skillIconStyle: 'bb3',
  skillBadgeFamily: 'illustrated', // owner 09-10: the illustrated set is the default
  blockDiceFamily: 'default', // owner 10-06: KrisB faces are opt-in
  blockDiceSurface: 'auto', // owner 10-06: per face set, so existing users see no change
  skillIconPackInstallId: null,
  assetPackAssignments: { skillIcons: '', playerSprites: '', walkSheets: '', soundEvents: '', teamLogos: '', blockDice: '' },
  url: FORK_EDITION ? FORK_WS_URL : FUMBBL_WS_URL, // as on base (Sol r20); hydrate() re-derives a 'fork' target's url from the effective host. Owner 2026-07-13: match the default target ('fork' below; public edition = Official FUMBBL) — was ws://fumbbl.com (a fresh install then connected to FUMBBL, not the fork). RC/public builds set BOTH this + activeServerTarget to fumbbl.
  coach: '',
  password: '',
  coach40k: '',
  compression: true,
  // Owner 2026-07-07: TEST builds default to the FORK server. ⚠ RC/public builds MUST ship this
  // 'fumbbl' (see docs/release-checklist.md). Only affects fresh installs; a user's pick wins.
  activeServerTarget: FORK_EDITION ? 'fork' : 'fumbbl', // owner 09-10: the public edition has no fork target
  forkHost: '', // owner 10-31: FORK edition override of the effective fork host (empty → launch flag / VITE_FORK_SERVER_HOST)
  botConfigUrl: '', // empty → derive http://<forkHost>:4310 (Tournament Bot config-web / fork-JNLP endpoint)
  forkUrlCustom: false, // Sol r21: the fork url is the derived preset until the coach types a custom one
  renderScale: 0, // owner 09-05: Auto (= devicePixelRatio) — a 1x canvas upscaled on a hi-DPI screen read soft everywhere
  uiCustomize: false,
  uiLayout: {},
  fpsCap: 60,
  showStadium: true,
  lowPerformanceMode: false, // owner 11-12: opt-in only; never auto-enabled
  lowPerformanceRestore: null,
  stadiumStands: 'classic',
  backdrop: 'skybox',
  backdropColor: DEFAULT_BACKDROP_COLOR,
  brightness: 100,
  soundVolume: 20,
  soundStyles: {},
  logOpacity: 0.79,
  logTimestamps: false,
  discordPresence: FORK_EDITION, // public edition: opt-in
  discordSpectateInvites: true,
  logFontSize: 15, // owner 2026-07-08: larger default Log/Chat/Roster text (was 11.5)
  logFont: 'arial', // owner 09-06: Arial default (was 'nuffle')
  logDiceAsNumbers: false,
  logNeededAsNumbers: false,
  logStyle: 'text', // owner 10-15: Graphical is opt-in while the owner tests it
  chatStyle: 'bubbles', // owner 10-16: Bubbles by default; Text keeps the plain chat lines
  logTintStrength: 75,
  showServerSequencingEvents: false,
  logPos: null,
  chatDockRosterTab: false, // owner 10-02: roster lives in the Helmet pop-out; Settings > UI brings the dock tab back
  bottomBarsSwapped: true, // owner 2026-07-08: Log bottom-left, Quick bar bottom-right (default)
  logSize: null,
  playerCardPos: null,
  playerCardSize: null,
  setupBrowserPos: null,
  setupBrowserSize: null,
  uiFont: 'nuffle',
  uiTextSize: 12,
  useFantasyCursor: true,
  moveStyle: 'hoptrail', // owner 08-18: installer default = Hop + path trail (was 'trail')
  spriteSet: 'walk', // owner 09-04: Super FUMBBL Placeholder is the only default; FUMBBL modes need a pack
  walkAnimation: true,
  walkFps: null,
  walkFaceCamera: true, // owner 09-04: on by default
  castShadows: true, // owner 09-06: prototype on by default
  bloodSplatters: true, // owner 10-03: on by default; Settings > Display turns them off
  moveBadge: true, // owner 10-21: Settings > Display turns it off
  plannerDiceSeatTint: false, // owner 10-22: route chips stay the neutral grey die unless turned on
  allowSecondClient: false, // owner 10-22: off by default; Settings > General turns it on (applies after a restart)
  allowSecondClientEdition: '',
  uniformFigures: false, // owner 09-10: N-S OFF by default (classic depth scaling); was on 09-09
  uniformFiguresEw: true, // owner 09-10: E-W on by default, independent
  actionDecorations: 'art', // owner 09-06: artwork by default; emoji kept as the Appearance option
  moveSpeedMs: 200, // owner 09-10: back to 200ms — headroom for renderer latency by default
  blockTumbleMs: 250,
  blockDice3d: true,
  trailColor: 'auto',
  plannerPrimaryColor: '#66ccff',
  plannerSecondaryColor: '#f5c542',
  trailMarks: 'numbers', // owner 08-18: installer default = Numbers (was 'echo')
  chatToastPos: 'left',
  chatToastTextSize: 17, // owner 09-05: 17 px default (was 14.4)
  chatToastsEnabled: true,
  chatDisabled: false,
  chatPoppedOut: false,
  chatPopPos: null,
  chatPopSize: null,
  replayControlsPos: null,
  replayControlsSize: null,
  replaySearchHideScores: true, // owner 10-06: on by default (spoiler-safe)
  spectatorClean: false,
  spectatorView: DEFAULT_SPECTATOR_VIEW,
  cinematicMode: 'armor-break',
  pitchOrientation: 'ns',
  pitchFlipped: false,
  // Owner 2026-07-10: DEVELOPER mode — unlocked by the `-dev` exe arg (or `?dev` URL query). Gates the
  // Settings → Developer section + the live Developer log panel (client `log()` fires incl. the block/
  // action drop-watchdog + the server-side/client-side wire traffic). NOT persisted-on by default; a
  // stored `true` from a prior `-dev` launch still opens it (owner can toggle off). devWireCapture feeds
  // the meaningful wire events (reports/dialogs/turnMode + all outbound commands) into the dev log.
  order66: true, // owner 2026-07-13: the 0.3.0 release IS the ORDER 66 port — ON by default (was dev-only default-off). Legacy path only via the toggle (devMode).
  declareBlitzBehavior: 'fumbbl',
  friendlyPlayerSwitch: true,
  deferFriendlySwitchEnd: false,
  leftClickOpensContextMenu: false,
  ...CONFIRMATION_DEFAULTS,
  ...CONTROL_LAYER_DEFAULTS, // FUMBBL Controls (owner 11-03): Super FUMBBL Controls is the default layer
  fumbblKeyBindings: defaultFumbblKeyBindings(),
  devMode: false,
  coachBrain: 'none',
  flyBrainUrl: 'http://127.0.0.1:8766',
  devPanelOpen: false,
  devWireCapture: true,
  debugLog: false,
  // Owner 2026-07-07: DEFAULT ON for TEST builds (gather live wire data for validation).
  // ⚠ RELEASE CANDIDATES / public releases MUST ship this false — flip it back before an RC
  // build (see docs/release-checklist.md). Only affects fresh installs; a user's stored choice wins.
  wireLog: true,
  autoDirector: false, // owner 10-06: off by default - the camera stays where the user put it
  clickDismissCinematics: false,
  playAuthToken: '',
  requirePlayAuthToken: false, // owner 2026-07-04: play auth is server-determined now (token UI deprecated)
  turf: 'acasas-weather-fx', // Owner 09-10: Acasas (strong) is the bundle default (was Pixel, 09-05). Installer-only family — a public checkout without it falls back to the first available turf at mount (SpectateView).
  hudCoachOpacity: 0.9,
  hudScoreboardOpacity: 0.9,
  hudQuickBarOpacity: 0.9,
  hudToastOpacity: 0.92,
  rosterOpacity: 0.79, // the Log window's default, which the roster followed before it had its own setting
  hideConfirmBar: false,
  gridLines: true,
  gridLineWidth: 0.5, // owner 09-05: default 1 -> 0.5
  gridLineColor: '#e8e4d8',
  gridLineOpacity: 1,
  markColor: '#e03030', // owner 2026-07-04f: pitch markings default red
  colorblindMode: 'off',
  language: 'en',
  languageChosen: false,
  englishVariantSettled: true,
  uiTheme: 'brand-red',
  uiPrimary: '#A10005',
  uiSecondary: '#000000',
  showRowMarkers: true,
  showSweetSpot: true,
  showFieldLogos: true,
  dugoutCounts: false,
  hideZeroRerolls: false,
  setupRulesCard: true,
  setupFormationsPanel: true,
  setupZoneHelpers: true,
  coachCornerCounts: true,
  skipArmourDiceOnCasualty: false,
  rosterHideInnateSkills: true,
  endZoneLabel: 'team',
  endZoneTint: true,
  showPlayerNumbers: false,
  oneSpritePerPosition: false,
  positionRingDensity: 1,
  positionRingColor: 'auto',
  soundOverrides: {},
  skillConfig: {},
  iconPosition: 'head',
  markerPosition: 'feet',
  dieTagPosition: 'corner',
  plannerTagStyle: 'dieWord',
  blitzTargetMarker: 'turn',
  preClickBlockDice: true,
  d6FaceVariant: 'brushed-metal',
  coachBadgeStyle: 'realistic',
  auraDisturbingPresence: 'selected',
  auraPickMeUp: 'selected',
  casualtySplash: false, // owner 2026-07-08: casualty splash defaults OFF (the red toast remains)
  flatRender: false,
  turnTrack: true, // owner 2026-07-07: on-pitch turn/score/re-roll tracks shown by default
  activePlayerEcho: false, // owner 2026-07-06: deprecated echo, off by default
  clickEcho: true,
  clickEchoColor: '#f5c518', // gold
  echoSize: 1,

  // #166 (owner auto-use policy 2026-07-23): DEFAULT = INTERACTIVE. Flipped from 'auto' → 'manual' — the coach
  // opts into auto-spending a natural Dodge re-roll; out of the box the interactive re-roll prompt surfaces.
  dodgeReroll: 'manual',
  // Owner 2026-07-14 / #166: auto-use defaults OFF for the reactive skillUse skills — the interactive prompt
  // surfaces out of the box; the coach opts each one into auto-fire. (Dodge auto lives in dodgeReroll above.)
  autoUseSkills: { fend: false, standFirm: false, tackle: false, sidestep: false, taunt: false },
  uiMode: 'fumbbl40k', // owner 2026-07-08 (FC): current UI is the default
  uiStyle: 'modern', // owner 11-03: the League Manager look by default; Retro keeps today's look
  uiColorScheme: 'dark', // owner 11-03: dark by default, light is opt-in
  uiGameStyle: 'retro', // owner 11-03 / coordinator ruling B: the in-game Modern look is opt-in
  modernHudStyle: 'minimalist', // owner 10-05: minimalist panels are the default (was chrome)
  savedSetupPreviews: {},
  recentPlayedTeams: [],
  completedFirstRun: false,
  legalAcceptanceVersion: 0,
  contributionsSeenVersion: 0,
  setupWizardSeenVersion: 0, // owner 10-06: first-launch setup wizard not yet completed
  homeTourSeenVersion: 0,
  clientTourSeenVersion: 0,
  homePaneZoom: 1,
  fumbblFloatPos: null,
  fumbblFloatSize: null,
  fumbblFloatQueueSize: null,
  fumbblFloatZoom: 1,
  hideCredsSplash: false, // owner 08-18: opt-out checkbox on the setup splash
  hideWelcomeSplash: true, // owner 2026-07-04: welcome splash deprecated at launch (still in the build; re-enable via Settings → Connection / "Replay the intro screens")
  hideTutorialSplash: true, // owner 2026-07-14: getting-started tour off by default too (needs revising; re-enable via Settings → Connection / "Replay the intro screens")
  ...REFLOW_FEATURE_DEFAULTS, // Settings reflow lane C: the new-features block (above AppSettings)
  settingsVersion: SETTINGS_VERSION,
};

// Per-skill display defaults when a skill has no explicit config. Icons default to
// the legacy global `showDefaultSkills` (off → only gained/added skills show);
// markers default to Never so the FUMBBL-JSON marking path stays the source until
// the user opts a skill into the per-skill marker system.
export function iconBehaviourDefault(): SkillBehaviour {
  return settings.showDefaultSkills ? 'always' : 'added';
}
export const MARKER_BEHAVIOUR_DEFAULT: SkillBehaviour = 'never';

/** Owner 10-12: backdrop choices behind the stadium (Settings -> Stadium). */
export type BackdropSetting = 'skybox' | 'space' | 'galaxy' | 'parking' | 'color';
export const BACKDROP_OPTIONS: readonly { value: BackdropSetting; label: string }[] = [
  { value: 'skybox', get label() { return $t('settings.backdropOptions.fantasySkybox'); } },
  { value: 'space', get label() { return $t('settings.backdropOptions.space'); } },
  { value: 'galaxy', get label() { return $t('settings.backdropOptions.whirlpoolGalaxyHubble'); } },
  { value: 'parking', get label() { return $t('settings.backdropOptions.nightParkingLot'); } },
  { value: 'color', get label() { return $t('settings.backdropOptions.plainColour'); } },
];
/** Owner 11-03: interface style; anything but an explicit 'retro' is the Modern default. */
export function normalizeUiStyle(value: unknown): AppSettings['uiStyle'] {
  return value === 'retro' ? 'retro' : 'modern';
}
/** Owner 11-03: Modern colour scheme; anything but an explicit 'light' is the dark default. */
/** Owner 11-03: in-game style; anything but an explicit 'modern' is the Retro default (today's in-game look). */
export function normalizeUiGameStyle(value: unknown): AppSettings['uiGameStyle'] {
  return value === 'modern' ? 'modern' : 'retro';
}
export function normalizeUiColorScheme(value: unknown): AppSettings['uiColorScheme'] {
  return value === 'light' ? 'light' : 'dark';
}
export function normalizeBackdrop(value: unknown): BackdropSetting {
  return BACKDROP_OPTIONS.some((o) => o.value === value) ? value as BackdropSetting : 'skybox';
}
/** A #rrggbb string (any case; #rgb expands), else the default colour. */
export function normalizeBackdropColor(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_BACKDROP_COLOR;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return DEFAULT_BACKDROP_COLOR;
}

/** Human-readable, provider-neutral turf labels for the Settings picker. */
export const TURF_LABELS: Record<string, string> = {
  get 'default-weather'() { return $t('settings.turfLabels.defaultWeatherPack'); },
  get 'pixel-weather'() { return $t('settings.turfLabels.pixelWeatherPack'); },
  get 'acasas-weather'() { return $t('settings.turfLabels.acasasWeatherPack'); }, // installer-only family; absent from public checkouts
  get 'acasas-weather-fx'() { return $t('settings.turfLabels.acasasWeatherPackStrong'); }, // owner 09-07: stronger sunny/heat/blizzard language; installer-only
  get grass1() { return $t('settings.turfLabels.basic'); }, // owner 09-05: renamed from 'Grass 1' (the Acasas 64 px leafy tile)
  get grass2() { return $t('settings.turfLabels.grass2'); },
  // #56 WT-7 (owner/Yularen 07-16): every FUMBBL pack is weather-responsive (swaps the field photo with
  // fieldModel.weather) — the "(weather)" suffix flags that behaviour vs the static grass tile themes.
  get 'fumbbl-basic'() { return $t('settings.turfLabels.basicWeather'); },
  get 'fumbbl-default'() { return $t('settings.turfLabels.defaultWeather'); },
  get 'fumbbl-blackbox'() { return $t('settings.turfLabels.blackboxWeather'); },
  get 'fumbbl-fumbblcup'() { return $t('settings.turfLabels.cupWeather'); },
  get 'fumbbl-chaos'() { return $t('settings.turfLabels.chaosWeather'); },
  get 'fumbbl-darkelf'() { return $t('settings.turfLabels.darkElfWeather'); },
  get 'fumbbl-goblin'() { return $t('settings.turfLabels.goblinWeather'); },
  get 'fumbbl-khorne'() { return $t('settings.turfLabels.khorneWeather'); },
  get 'fumbbl-necromantic'() { return $t('settings.turfLabels.necromanticWeather'); },
  get 'fumbbl-norse'() { return $t('settings.turfLabels.norseWeather'); },
  get 'fumbbl-nurgle'() { return $t('settings.turfLabels.nurgleWeather'); },
  get 'fumbbl-skaven'() { return $t('settings.turfLabels.skavenWeather'); },
  get 'fumbbl-slaanesh'() { return $t('settings.turfLabels.slaaneshWeather'); },
  get 'fumbbl-tzeentch'() { return $t('settings.turfLabels.tzeentchWeather'); },
  get 'fumbbl-vampire'() { return $t('settings.turfLabels.vampireWeather'); },
};

/** Available turf themes for the Settings picker. Populated at runtime from
 *  `renderer.turfOptions()` on mount (SpectateView) so the picker always mirrors
 *  what the renderer actually has loaded. */
// Owner 09-10: seeded from the build's bundled families (Acasas/Basic included in installer builds) so the picker is
// right from the console; the pitch view refreshes it with pack-bound pitches on mount.
export const turfCatalog = reactive<{ options: string[] }>({ options: bundledTurfOptions() });

/** Reader for the fork coach password, INJECTED by game/credentials.ts at import time. Injection
 *  (rather than an import) keeps settings ↔ credentials acyclic; credentials.ts needs load()'s
 *  legacy capture below, so the dependency can only run one way. Default '' until installed —
 *  main.ts awaits initCredentials() before mount, so no join can outrun it. */
let coachPassword40k: () => string = () => '';

export function installCoachPassword40kReader(read: () => string): void {
  coachPassword40k = read;
}

/** Reader for the fork password that must survive in the blob, INJECTED by game/credentials.ts.
 *  Returns '' in the normal case (the OS credential store holds it) and the live password only
 *  while that store is DEGRADED — when the clear-text copy is the one and only surviving copy. */
let forkPasswordFallback: () => string = () => '';

export function installForkPasswordFallbackReader(read: () => string): void {
  forkPasswordFallback = read;
}

/** The pre-keychain clear-text `password40k`, captured at load and kept OUT of the reactive
 *  settings object (so the persist watcher can never re-serialize it). game/credentials.ts
 *  consumes it once and migrates it into the OS credential store. */
let legacyPassword40k = '';

export interface V26UserOverrideMigration {
  sprites: Record<string, string>;
  sounds: Record<string, string>;
  logos: Record<string, string>;
}

let v26UserOverrideMigration: V26UserOverrideMigration | null = null;
/** While true, the authoritative v26 blob is left byte-for-byte durable. The
 * native migration completes before we stamp v27, making a process crash retry
 * the idempotent writes instead of losing files that had not been copied yet. */
let v26UserOverrideMigrationPending = false;

/** In-memory handoff. Completion clears it only after every best-effort native
 * write has been attempted; the durable v26 source remains intact meanwhile. */
export function takeV26UserOverrideMigration(): V26UserOverrideMigration | null {
  return v26UserOverrideMigration;
}

/** One-shot: the legacy clear-text fork password, if this install still has one. */
export function takeLegacyPassword40k(): string {
  const value = legacyPassword40k;
  legacyPassword40k = '';
  return value;
}

function purgeStoredSecret(field: 'password40k' | 'password'): void {
  // Both on-disk copies: the blob AND its last-good backup — clear-text retirement must be total.
  for (const key of [SETTINGS_KEY, BACKUP_KEY]) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      if (!(field in raw)) continue;
      delete raw[field];
      // Sol r5: a public run never re-writes another edition's fork fields while retiring a secret.
      localStorage.setItem(key, JSON.stringify(publicPersistable(raw)));
    } catch { /* ignore */ }
  }
}

/** Drop the legacy clear-text fork password from the stored blob. Called ONLY after the OS
 *  credential store has confirmed the write — a failed keychain must not lose the password. */
export function purgeStoredPassword40k(): void {
  password40kConfirmed = true;
  purgeStoredSecret('password40k');
  // A confirmed keychain write is also the durable-import confirmation the recovery file waits on.
  if (recoveryPendingPurge) {
    recoveryPendingPurge = false;
    void invokeTauri('settings_purge_recovery').catch(() => { /* retried next boot */ });
  }
}

/** Same retirement for the FUMBBL (official) password, once its keychain row confirms. */
export function purgeStoredPassword(): void {
  purgeStoredSecret('password');
}

/** Write the clear-text fork password INTO the stored blob. The degraded-store counterpart of
 *  purgeStoredPassword40k(): called by credentials.ts when the OS store refused the write, so the
 *  password still survives a restart instead of dying with the session. Empty value removes it. */
export function stampStoredPassword40k(value: string): void {
  stampStoredSecret('password40k', value);
}

/** FUMBBL-password counterpart: the localStorage blob is the degraded-keychain fallback. The
 *  SETTINGS FILE is never a fallback — its serializer strips secrets by construction. */
export function stampStoredPassword(value: string): void {
  stampStoredSecret('password', value);
}

function stampStoredSecret(field: 'password40k' | 'password', value: string): void {
  try {
    // A NULL primary with a live backup is the transient-fault fingerprint (see load()): basing
    // this read-modify-write on '{}' would replace the whole blob with a password-only object —
    // the next load then parses it fine and every other field becomes DEFAULTS (the silent
    // variant of the one-bad-read wipe). Fall back to the backup as the base instead.
    const rawText = localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem(BACKUP_KEY);
    const raw = JSON.parse(rawText ?? '{}') as Record<string, unknown>;
    if (value) raw[field] = value;
    else if (field in raw) delete raw[field];
    else return;
    // Sol r5: sanitised in a public run (the backup this may copy from can carry fork fields); credentials untouched.
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(publicPersistable(raw)));
  } catch { /* ignore */ }
}

/** Parse + migrate ONE raw blob text. Throws on unparseable JSON — the caller decides what a
 *  failure means (try the backup / guard the persist). Returning DEFAULTS from in here is what
 *  let a single bad read become a persisted wipe of coach/password (P1 08-18). */
function hydrate(rawText: string | null, stampToLocalStorage = true): AppSettings {
  {
    const raw = JSON.parse(rawText ?? '{}') as Partial<AppSettings> & {
      stateMarkerStyle?: unknown;
      configuredSoundOverrides?: unknown;
      spriteOverrides?: unknown;
      logoOverrides?: unknown;
    };
    // Sol r7: a settings blob is a JSON OBJECT. null, an array or a primitive is malformed (exactly like unparseable
    // text) - rejected before anything is spread into settings or stamped back to storage.
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('settings blob is not a JSON object');
    const rawConfiguredSounds = raw.configuredSoundOverrides;
    const rawSprites = raw.spriteOverrides;
    const rawLogos = raw.logoOverrides;
    delete raw.configuredSoundOverrides;
    delete raw.spriteOverrides;
    delete raw.logoOverrides;
    // v15 retired the opt-in classic state-marker artwork. Strip the legacy key
    // before merging so old settings cannot keep feeding or re-persisting it.
    delete raw.stateMarkerStyle;
    // v36 (owner 11-05): the FUMBBL-Classic view is retired; its effects opt-in has nothing left to configure.
    delete (raw as { classicEffects?: unknown }).classicEffects;
    const merged: AppSettings = { ...DEFAULTS, ...raw };
    const opacity = (value: unknown, fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value)
        ? Math.min(1, Math.max(0.2, value))
        : fallback;
    merged.hudCoachOpacity = opacity(merged.hudCoachOpacity, DEFAULTS.hudCoachOpacity);
    merged.hudScoreboardOpacity = opacity(merged.hudScoreboardOpacity, DEFAULTS.hudScoreboardOpacity);
    merged.hudQuickBarOpacity = opacity(merged.hudQuickBarOpacity, DEFAULTS.hudQuickBarOpacity);
    merged.hudToastOpacity = opacity(merged.hudToastOpacity, DEFAULTS.hudToastOpacity);
    // Owner 10-08: a blob from before the setting existed keeps the look it had - the roster followed logOpacity.
    merged.rosterOpacity = opacity(
      raw.rosterOpacity === undefined ? raw.logOpacity : merged.rosterOpacity,
      DEFAULTS.rosterOpacity,
    );
    merged.uiStyle = normalizeUiStyle(raw.uiStyle); // owner 11-03: missing / unknown -> 'modern'
    merged.uiColorScheme = normalizeUiColorScheme(raw.uiColorScheme); // owner 11-03: missing / unknown -> 'dark'
    merged.uiGameStyle = normalizeUiGameStyle(raw.uiGameStyle); // owner 11-03: missing / unknown -> 'retro'
    merged.spectatorView = normalizeSpectatorView(raw.spectatorView); // owner 10-11: missing / unknown -> 'drive' (today's view)
    merged.modernHudStyle = raw.modernHudStyle === 'chrome' ? 'chrome' : 'minimalist'; // owner 10-05: a stored chrome pick is kept; everything else is minimalist
    // Current-version blobs bypass migrations, so malformed video values must be
    // normalized independently. Only choices exposed by Settings are accepted;
    // legacy uncapped FPS (0), strings, NaN-like values and arbitrary scales fall
    // back to the safe install defaults.
    const videoChoice = (value: unknown, allowed: readonly number[], fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value) && allowed.includes(value) ? value : fallback;
    merged.renderScale = videoChoice(merged.renderScale, RENDER_SCALE_CHOICES, DEFAULTS.renderScale); // owner 09-05: 300/400% added
    merged.fpsCap = merged.fpsCap === 'display' ? 'display' : videoChoice(merged.fpsCap, FPS_CAP_CHOICES, 60); // owner 10-13: 'Match display'; never 0 / unbounded
    merged.soundStyles = raw.soundStyles && typeof raw.soundStyles === 'object' && !Array.isArray(raw.soundStyles)
      ? Object.fromEntries(Object.entries(raw.soundStyles).filter(([key, value]) => key.length > 0 && typeof value === 'string'))
      : { ...DEFAULTS.soundStyles };
    normalizeReflowFeatures(raw, merged); // Settings reflow lane C: validation + one-time migration (after soundStyles)
    const dataUrlMap = (value: unknown, validKey: (key: string) => boolean): Record<string, string> =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).filter(([key, entry]) => validKey(key)
          && typeof entry === 'string' && /^data:[^,]+,/i.test(entry)))
        : {};
    merged.soundOverrides = dataUrlMap(raw.soundOverrides, (key) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key));
    v26UserOverrideMigrationPending = (raw.settingsVersion ?? 0) === 26;
    v26UserOverrideMigration = v26UserOverrideMigrationPending ? {
      sounds: dataUrlMap(rawConfiguredSounds, (key) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)),
      sprites: dataUrlMap(rawSprites, (key) =>
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._:-]{0,95}\/(?:any|home|away)$/.test(key)),
      logos: dataUrlMap(rawLogos, (key) => /^[a-z][a-z0-9]{0,63}$/.test(key)),
    } : null;
    merged.spriteSet = ['classic', 'checkers', 'chess', 'walk'].includes(String(raw.spriteSet))
      ? raw.spriteSet as AppSettings['spriteSet']
      : DEFAULTS.spriteSet;
    merged.walkAnimation = typeof raw.walkAnimation === 'boolean' ? raw.walkAnimation : DEFAULTS.walkAnimation;
    merged.walkFaceCamera = typeof raw.walkFaceCamera === 'boolean' ? raw.walkFaceCamera : DEFAULTS.walkFaceCamera;
    merged.castShadows = typeof raw.castShadows === 'boolean' ? raw.castShadows : DEFAULTS.castShadows;
    merged.bloodSplatters = typeof raw.bloodSplatters === 'boolean' ? raw.bloodSplatters : DEFAULTS.bloodSplatters;
    merged.moveBadge = typeof raw.moveBadge === 'boolean' ? raw.moveBadge : DEFAULTS.moveBadge;
    merged.plannerDiceSeatTint = typeof raw.plannerDiceSeatTint === 'boolean' ? raw.plannerDiceSeatTint : DEFAULTS.plannerDiceSeatTint;
    merged.allowSecondClient = typeof raw.allowSecondClient === 'boolean' ? raw.allowSecondClient : DEFAULTS.allowSecondClient;
    merged.allowSecondClientEdition = raw.allowSecondClientEdition === 'public' || raw.allowSecondClientEdition === 'fork' ? raw.allowSecondClientEdition : DEFAULTS.allowSecondClientEdition;
    merged.uniformFigures = typeof raw.uniformFigures === 'boolean' ? raw.uniformFigures : DEFAULTS.uniformFigures;
    merged.uniformFiguresEw = typeof raw.uniformFiguresEw === 'boolean' ? raw.uniformFiguresEw : DEFAULTS.uniformFiguresEw;
    merged.blockDice3d = raw.blockDice3d !== false;
    merged.lowPerformanceMode = raw.lowPerformanceMode === true;
    merged.lowPerformanceRestore = normalizeLowPerformanceRestore(raw.lowPerformanceRestore);
    merged.actionDecorations = raw.actionDecorations === 'emoji' ? 'emoji' : 'art';
    merged.walkFps = typeof raw.walkFps === 'number' && Number.isInteger(raw.walkFps)
      && raw.walkFps >= 1 && raw.walkFps <= 30 ? raw.walkFps : null;
    merged.uiTextSize = typeof raw.uiTextSize === 'number' && Number.isFinite(raw.uiTextSize)
      ? Math.round(Math.min(20, Math.max(12, raw.uiTextSize)))
      : DEFAULTS.uiTextSize;
    // Independent from logFontSize and the global UI floor: older blobs simply adopt
    // the appearance-preserving default, while corrupt/current blobs cannot create
    // unreadably small or layout-breaking authored chat toasts.
    merged.chatToastTextSize = typeof raw.chatToastTextSize === 'number' && Number.isFinite(raw.chatToastTextSize)
      ? Math.round(Math.min(28, Math.max(12, raw.chatToastTextSize)) * 10) / 10
      : DEFAULTS.chatToastTextSize;
    // Skill markings are an explicit pitch-overlay override. They may be
    // smaller than the global 12px UI accessibility floor; all ordinary UI
    // typography continues to use uiTextSize and its independent 12px clamp.
    merged.skillMarkingSize = typeof raw.skillMarkingSize === 'number' && Number.isFinite(raw.skillMarkingSize)
      ? Math.round(Math.min(24, Math.max(6, raw.skillMarkingSize)))
      : DEFAULTS.skillMarkingSize;
    merged.skillMarkingColor = typeof raw.skillMarkingColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.skillMarkingColor)
      ? raw.skillMarkingColor
      : DEFAULTS.skillMarkingColor;
    merged.plannerPrimaryColor = typeof raw.plannerPrimaryColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.plannerPrimaryColor)
      ? raw.plannerPrimaryColor
      : DEFAULTS.plannerPrimaryColor;
    merged.plannerSecondaryColor = typeof raw.plannerSecondaryColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.plannerSecondaryColor)
      ? raw.plannerSecondaryColor
      : DEFAULTS.plannerSecondaryColor;
    merged.skillMarkingFont = ['arial', 'helvetica', 'system', 'nuffle'].includes(String(raw.skillMarkingFont))
      ? raw.skillMarkingFont as AppSettings['skillMarkingFont']
      : DEFAULTS.skillMarkingFont;
    merged.markingStatusLine = raw.markingStatusLine === true;
    merged.checkerLetterFont = ['arial', 'helvetica', 'system', 'nuffle'].includes(String(raw.checkerLetterFont))
      ? raw.checkerLetterFont as AppSettings['checkerLetterFont']
      : DEFAULTS.checkerLetterFont;
    merged.legalAcceptanceVersion = normalizeLegalAcceptanceVersion(raw.legalAcceptanceVersion);
    merged.contributionsSeenVersion = typeof raw.contributionsSeenVersion === 'number' && Number.isSafeInteger(raw.contributionsSeenVersion) && raw.contributionsSeenVersion >= 0
      ? raw.contributionsSeenVersion
      : DEFAULTS.contributionsSeenVersion;
    merged.setupWizardSeenVersion = typeof raw.setupWizardSeenVersion === 'number' && Number.isSafeInteger(raw.setupWizardSeenVersion) && raw.setupWizardSeenVersion >= 0
      ? raw.setupWizardSeenVersion
      : DEFAULTS.setupWizardSeenVersion;
    merged.homeTourSeenVersion = typeof raw.homeTourSeenVersion === 'number' && Number.isSafeInteger(raw.homeTourSeenVersion) && raw.homeTourSeenVersion >= 0
      ? raw.homeTourSeenVersion
      : DEFAULTS.homeTourSeenVersion;
    merged.clientTourSeenVersion = typeof raw.clientTourSeenVersion === 'number' && Number.isSafeInteger(raw.clientTourSeenVersion) && raw.clientTourSeenVersion >= 0
      ? raw.clientTourSeenVersion
      : DEFAULTS.clientTourSeenVersion;
    // Range check only (the slider snaps; the shell clamps again). Anything else - missing, NaN, a string - is 100 %.
    merged.homePaneZoom = typeof raw.homePaneZoom === 'number' && Number.isFinite(raw.homePaneZoom) && raw.homePaneZoom >= 0.75 && raw.homePaneZoom <= 2
      ? raw.homePaneZoom
      : DEFAULTS.homePaneZoom;
    // Geometry of the floating FUMBBL window: anything malformed reads as "never moved / resized".
    merged.fumbblFloatPos = sanitizeFloatPos(raw.fumbblFloatPos);
    merged.fumbblFloatSize = sanitizeFloatSize(raw.fumbblFloatSize);
    merged.fumbblFloatQueueSize = sanitizeFloatSize(raw.fumbblFloatQueueSize, FLOAT_QUEUE_MIN);
    merged.fumbblFloatZoom = sanitizeFloatZoom(raw.fumbblFloatZoom);
    merged.playerCardPos = sanitizePlayerCardPos(raw.playerCardPos);
    merged.playerCardSize = sanitizePlayerCardSize(raw.playerCardSize);
    merged.tackleZoneMode = ['off', 'opposition', 'friendly', 'both'].includes(String(raw.tackleZoneMode))
      ? raw.tackleZoneMode as AppSettings['tackleZoneMode']
      : DEFAULTS.tackleZoneMode;
    merged.spectatorTackleZoneMode = typeof raw.spectatorTackleZoneMode === 'string' && (SPECTATOR_TACKLE_ZONE_MODES as readonly string[]).includes(raw.spectatorTackleZoneMode)
      ? raw.spectatorTackleZoneMode as SpectatorTackleZoneMode
      : DEFAULTS.spectatorTackleZoneMode;
    merged.plannerTagStyle = raw.plannerTagStyle === 'letter' ? 'letter' : 'dieWord'; // owner 10-14: die + word unless the letter plates were chosen
    merged.blitzTargetMarker = raw.blitzTargetMarker === 'fumbbl' ? 'fumbbl' : 'turn';
    merged.preClickBlockDice = raw.preClickBlockDice !== false; // owner 10-15: on unless the user turned it off
    merged.d6FaceVariant = raw.d6FaceVariant === 'black' || raw.d6FaceVariant === 'team' ? raw.d6FaceVariant : 'brushed-metal';
    merged.coachBadgeStyle = raw.coachBadgeStyle === 'retro' ? 'retro' : 'realistic'; // owner 10-20: realistic unless retro was chosen
    // Local presentation override only. Malformed/older blobs retain upstream variants.
    merged.hideZeroRerolls = raw.hideZeroRerolls === true; // owner 10-13: off unless the user turned it on
    merged.dugoutCounts = raw.dugoutCounts === true; // owner 10-06: off unless the user turned it on
    merged.setupRulesCard = raw.setupRulesCard !== false; // owner 10-13: on unless the user turned it off
    merged.setupFormationsPanel = raw.setupFormationsPanel !== false; // owner 10-13: on unless the user turned it off
    merged.setupZoneHelpers = raw.setupZoneHelpers !== false; // owner 10-13: on unless the user turned it off
    merged.coachCornerCounts = raw.coachCornerCounts !== false; // owner 10-06: on unless the user turned it off
    merged.skipArmourDiceOnCasualty = raw.skipArmourDiceOnCasualty === true; // owner 10-14: off unless the user turned it on
    merged.rosterHideInnateSkills = raw.rosterHideInnateSkills !== false; // owner 10-10: on unless the user turned it off
    merged.oneSpritePerPosition = raw.oneSpritePerPosition === true;
    merged.pitchFlipped = raw.pitchFlipped === true; // owner 10-12: only an explicit true flips the view
    // Keychain move: password40k is no longer a settings field. Lift any stored copy out of the
    // merged object so the deep watcher below never writes it back, and hand it to credentials.ts.
    const storedPw = (raw as { password40k?: unknown }).password40k;
    legacyPassword40k = typeof storedPw === 'string' ? storedPw : '';
    delete (merged as { password40k?: unknown }).password40k;
    // fail-closed: a non-boolean/corrupted stored value resolves to the default (chat enabled).
    merged.chatDisabled = raw.chatDisabled === true;
    merged.logDiceAsNumbers = raw.logDiceAsNumbers === true;
    merged.stadiumStands = raw.stadiumStands === 'crowd' ? 'crowd' : 'classic'; // owner 10-05: classic is the default again
    merged.backdrop = normalizeBackdrop(raw.backdrop); // owner 10-12: missing or unknown -> the skybox
    merged.backdropColor = normalizeBackdropColor(raw.backdropColor);
    merged.logTimestamps = raw.logTimestamps === true; // owner 09-23: off unless the user turned it on
    merged.hideConfirmBar = raw.hideConfirmBar === true; // owner 10-08: the bar shows unless the user hid it
    merged.replaySearchHideScores = raw.replaySearchHideScores !== false; // owner 10-06: ON by default; only an explicit false turns it off
    // owner 10-07: camera pan speed default 9 -> 16; a blob still on the old default (or without the key) takes the new one
    if ((raw.settingsVersion ?? 0) < 35 && (raw.cameraPanSpeed == null || raw.cameraPanSpeed === 9)) merged.cameraPanSpeed = 16;
    merged.discordPresence = typeof raw.discordPresence === 'boolean' ? raw.discordPresence : DEFAULTS.discordPresence;
    merged.discordSpectateInvites = raw.discordSpectateInvites !== false;
    merged.logNeededAsNumbers = raw.logNeededAsNumbers === true;
    merged.logStyle = raw.logStyle === 'graphical' || raw.logStyle === 'fumbbl' ? raw.logStyle : 'text'; // owner 10-15: Text unless the user picked another style
    merged.chatStyle = raw.chatStyle === 'text' ? 'text' : 'bubbles'; // owner 10-16: Bubbles unless the user picked Text
    { const v = Number(raw.logTintStrength); merged.logTintStrength = Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : DEFAULTS.logTintStrength; }
    // Fail closed to the quiet match log for fresh, older, or corrupted settings blobs.
    merged.showServerSequencingEvents = raw.showServerSequencingEvents === true;
    // Only an explicit false disables the default cursor theme. Older or malformed
    // settings keep the Spike presentation enabled.
    merged.useFantasyCursor = raw.useFantasyCursor !== false;
    // fail-closed: pop-out resolves to DOCKED unless the stored value is literally true.
    merged.chatPoppedOut = raw.chatPoppedOut === true;
    // Owner 10-02: the dock's Roster tab is off unless the stored value is literally true.
    merged.chatDockRosterTab = raw.chatDockRosterTab === true;
    // Controller support P1: the legacy keys validate among themselves first (the registry, migrated below from the raw
    // stored map, never displaces a coach's existing key — a new action's default yields instead).
    delete (merged as Partial<AppSettings>).controlBindings;
    // Owner 10-02: default H - but never the confirm key (a coach who already bound Confirm to H gets R, then J).
    // Astra review: a hand-edited / stale value goes through the same rules as a rebind in Settings.
    merged.rosterKey = typeof raw.rosterKey === 'string' && !hotkeyConflict('rosterKey', raw.rosterKey, merged)
      ? raw.rosterKey : (['KeyH', 'KeyR', 'KeyJ'].find((k) => !hotkeyConflict('rosterKey', k, merged)) ?? 'KeyH');
    merged.logExpandKey = typeof raw.logExpandKey === 'string' && !hotkeyConflict('logExpandKey', raw.logExpandKey, merged)
      ? raw.logExpandKey : (['KeyL', 'KeyK', 'KeyO'].find((k) => !hotkeyConflict('logExpandKey', k, merged)) ?? 'KeyL');
    // Controller support P1 (owner 10-07): the registry keeps every stored binding and takes the (validated) legacy
    // keys above as their actions' keyboard primary — an existing coach's H / L / Space carry over untouched.
    merged.controllerSupportEnabled = raw.controllerSupportEnabled === true; // owner 10-10: off unless the coach ticked the box
    merged.touchMode = normaliseTouchModeSetting(raw.touchMode);
    merged.touchModeChoice = normaliseTouchModeChoice(raw.touchModeChoice);
    merged.touchEndTurnHoldMs = clampTouchHoldMs(raw.touchEndTurnHoldMs);
    merged.touchButtonSize = clampTouchButtonPx(raw.touchButtonSize);
    merged.inputMethod = raw.inputMethod === 'controller' || raw.inputMethod === 'keyboard' ? raw.inputMethod : 'auto';
    merged.showInputSwitchNotice = raw.showInputSwitchNotice !== false;
    // An older stored map (no revision) is r1: LT chords move to LB, untouched LB / RB zoom defaults take the new ones.
    merged.controlBindings = migrateControlBindings(raw.controlBindings, merged,
      raw.controlBindings ? normaliseBindingsRevision(raw.controlBindingsRevision) : CONTROL_BINDINGS_REVISION,
      [...FIXED_SHORTCUT_CODES, ...UNBINDABLE_CODES]); // Astra P2 10-10: a stored map never takes an existing key
    merged.controlBindingsRevision = CONTROL_BINDINGS_REVISION;
    merged.controllerRumble = raw.controllerRumble !== false;
    merged.stickDeadzoneLeft = clampDeadzone(raw.stickDeadzoneLeft);
    merged.stickDeadzoneRight = clampDeadzone(raw.stickDeadzoneRight);
    merged.playerCardMode = raw.playerCardMode === 'called' ? 'called' : 'auto';
    merged.crosshairSpeed = clampCrosshairSpeed(raw.crosshairSpeed);
    merged.crosshairAcceleration = raw.crosshairAcceleration === true;
    const installedIdentity = (value: unknown) => typeof value === 'string'
      && (/^[a-f0-9]{32}$/.test(value) || value === '')
      ? value : '';
    merged.skillIconPackInstallId = raw.skillIconPackInstallId === ''
      ? ''
      : typeof raw.skillIconPackInstallId === 'string' && /^[a-f0-9]{32}$/.test(raw.skillIconPackInstallId)
        ? raw.skillIconPackInstallId
        : null;
    const rawAssignments = raw.assetPackAssignments as Partial<AppSettings['assetPackAssignments']> | undefined;
    merged.assetPackAssignments = {
      skillIcons: installedIdentity(rawAssignments?.skillIcons),
      playerSprites: installedIdentity(rawAssignments?.playerSprites),
      walkSheets: installedIdentity(rawAssignments?.walkSheets),
      soundEvents: installedIdentity(rawAssignments?.soundEvents),
      teamLogos: installedIdentity(rawAssignments?.teamLogos), // owner 09-07
      blockDice: installedIdentity(rawAssignments?.blockDice),
    };
    merged.skillBadgeFamily = raw.skillBadgeFamily === 'default' ? 'default' : 'illustrated'; // owner 09-10: illustrated unless the flat set was chosen
    merged.blockDiceFamily = raw.blockDiceFamily === 'krisb' || raw.blockDiceFamily === 'fumbbl' ? raw.blockDiceFamily : 'default'; // owner 10-06: default unless KrisB (11-04: or FUMBBL) was chosen
    merged.blockDiceSurface = raw.blockDiceSurface === 'black' || raw.blockDiceSurface === 'white' || raw.blockDiceSurface === 'team' ? raw.blockDiceSurface : 'auto'; // owner 10-06: explicit picks kept, else per face set (10-13: + team)
    // Owner 2026-07-05 migration: FORCE the new defaults onto pre-v2 installs (whose
    // persisted settings still carry the old walk / 60% values). Runs once — after
    // it stamps settingsVersion, future user changes to these keys stick.
    if ((raw.settingsVersion ?? 0) < 2) {
      merged.moveStyle = DEFAULTS.moveStyle; // Slide + echo
      merged.soundVolume = DEFAULTS.soundVolume; // 20%
      merged.chatToastPos = DEFAULTS.chatToastPos; // left
      merged.settingsVersion = 2;
    }
    // Owner 2026-07-06 migration (v3): the single `auraDisplay` split into per-aura
    // settings — seed both new keys from the user's old choice so it carries over.
    if ((raw.settingsVersion ?? 0) < 3) {
      const legacy = (raw as { auraDisplay?: 'always' | 'selected' | 'off' }).auraDisplay;
      if (legacy) { merged.auraDisturbingPresence = legacy; merged.auraPickMeUp = legacy; }
      merged.settingsVersion = 3;
    }
    // Owner 2026-07-13 migration (v4): the 0.3.0 release IS the ORDER 66 port — FORCE order66 ON for existing
    // installs whose persisted value is the old dev default (false), else they'd stay on the legacy planner.
    // ONLY touches order66 (connection/url etc. untouched — a stale dev value survives).
    if ((raw.settingsVersion ?? 0) < 4) {
      merged.order66 = true;
      merged.settingsVersion = 4;
    }
    // #13 (owner ruling 08-11): LEGACY INTERACTION FULLY DEPRECATED — Order 66 is the gold standard. Hard-pin
    // order66 TRUE UNCONDITIONALLY (the v4 migration above only caught pre-v4 installs; a later install that
    // unchecked the now-removed toggle would persist `false`). This makes it impossible for a stale settings file
    // to resurrect the legacy planner. Phase ② excises the flag + dead legacy consumers progressively.
    merged.order66 = true;
    merged.coachBrain = FORK_EDITION && (raw.coachBrain === 'random' || raw.coachBrain === 'fly-chaos') ? raw.coachBrain : 'none';
    merged.flyBrainUrl = typeof raw.flyBrainUrl === 'string' && raw.flyBrainUrl.trim()
      ? raw.flyBrainUrl.trim() : DEFAULTS.flyBrainUrl;
    merged.declareBlitzBehavior = raw.declareBlitzBehavior === 'modern' ? 'modern' : 'fumbbl';
    merged.friendlyPlayerSwitch = raw.friendlyPlayerSwitch !== false;
    merged.deferFriendlySwitchEnd = raw.deferFriendlySwitchEnd === true;
    merged.leftClickOpensContextMenu = raw.leftClickOpensContextMenu === true;
    Object.assign(merged, normalizeConfirmationSettings(raw as Record<string, unknown>)); // only an explicit false turns a prompt off
    // FUMBBL Controls (owner 11-03): the control layer, Automove, Right Click per layer, the other layer's confirmation
    // values, FUMBBL keyboard shortcuts. A switch that was still waiting when the app closed applies now (fail open):
    // the flat confirmation values are moved to the stored layer's.
    Object.assign(merged, normalizeControlLayerSettings(raw as Record<string, unknown>));
    applyLayerConfirmations(merged, merged.controlLayer);
    merged.fumbblKeyBindings = normalizeFumbblKeyBindings(raw.fumbblKeyBindings);
    // v5 (owner 2026-07-14): the theme engine. Existing installs adopt the Black/Red default; a later user
    // change to the theme fields sticks (stamped below).
    if ((raw.settingsVersion ?? 0) < 5) {
      merged.uiTheme = raw.uiTheme ?? 'brand-red';
      merged.uiPrimary = raw.uiPrimary ?? '#A10005';
      merged.uiSecondary = raw.uiSecondary ?? '#000000';
      merged.settingsVersion = 5;
    }
    // v6 (owner 2026-07-14): AUTOMATIC SKILL USAGE. New nested record — ensure every key is present
    // (shallow {...DEFAULTS,...raw} would keep a partial older object), defaulting to OFF (interactive).
    if ((raw.settingsVersion ?? 0) < 6) {
      merged.autoUseSkills = { ...DEFAULTS.autoUseSkills, ...(raw.autoUseSkills ?? {}) };
      merged.settingsVersion = 6;
    }
    // v7 (owner 2026-07-14): Taunt joined AUTOMATIC SKILL USAGE — backfill the new key for v6 installs
    // (the top-level autoUseSkills object would otherwise carry over without it). Idempotent.
    if ((raw.settingsVersion ?? 0) < 7) {
      merged.autoUseSkills = { ...DEFAULTS.autoUseSkills, ...merged.autoUseSkills };
      merged.settingsVersion = 7;
    }
    // v8 (owner 2026-07-21, #102): existing installs persist TWO stale copies of the old fork IP: (a) forkHost, and
    // (b) url. BOTH must be refreshed — (b) because SPECTATE dials the RAW settings.url (Meero FR-1). CLEAR forkHost
    // and the stale fork url here; owner 10-31: a 'fork' target's url is then re-derived from the effective fork host
    // at the end of hydrate (or falls back to FUMBBL when no host is available). Non-fork targets keep their url.
    if ((raw.settingsVersion ?? 0) < 8) {
      merged.forkHost = '';
      if (merged.activeServerTarget === 'fork') merged.url = FORK_WS_URL; // as on base (the baked default's url)
      merged.settingsVersion = 8;
    }
    // v9 (owner 2026-07-22, #127): FUMBBL-Default is the install-default turf (DEFAULTS.turf since #66 `9da3520c`,
    // which shipped with NO migration). Existing installs still on the OLD implicit default adopt it — default-
    // follows-default. Keyed on the exact old default 'grass1' (the ONLY turf default that ever existed pre-#66):
    // every OTHER persisted turf is an explicit user pick (grass1 was the sole default ⇒ any other value was chosen)
    // and is LEFT UNTOUCHED (semantic ②). FR-1 swept: `turf` has ONE persisted copy (settings.turf in the single
    // `fumbbl40k.settings` blob) — no sibling stringified copy to migrate. ⚠ COLLATERAL (Yularen-ruled, owner-noted):
    // a user who EXPLICITLY picked Grass-1 is indistinguishable from the old default (full-object persist, no
    // explicit-choice marker) → reverts ONCE to fumbbl-default; re-pickable + sticky post-stamp. settingsVersion is
    // set unconditionally so the migration runs exactly once for EVERY pre-v9 install (turf≠grass1 still stamps).
    if ((raw.settingsVersion ?? 0) < 9) {
      if (raw.turf === 'grass1') merged.turf = 'fumbbl-default';
      merged.settingsVersion = 9;
    }
    // Owner 2026-08-19 migration (v10): Uncapped FPS removed — an unbounded render loop is never
    // wanted. Persisted 0 (the old uncapped default) migrates to the bounded 60 FPS default; any explicit
    // 30/60/120 pick survives.
    if ((raw.settingsVersion ?? 0) < 10) {
      if (!merged.fpsCap) merged.fpsCap = 60;
      merged.settingsVersion = 10;
    }
    // v11: split one global icon identity into three independently hot-swappable
    // capability assignments. The legacy field stays read-only until startup has
    // resolved its one-shot BB2/BB3 migration against the installed registry.
    if ((raw.settingsVersion ?? 0) < 11) {
      if (!merged.assetPackAssignments.skillIcons && typeof merged.skillIconPackInstallId === 'string') {
        merged.assetPackAssignments.skillIcons = merged.skillIconPackInstallId;
      }
      merged.settingsVersion = 11;
    }
    // v12: confirmed movement now has a bounded next-frame first-stride anticipation and a faster 100ms tile target.
    // Migrate the value equal to the prior 150ms install default; every other explicit selection stays untouched.
    if ((raw.settingsVersion ?? 0) < 12) {
      if (raw.moveSpeedMs === 150) merged.moveSpeedMs = 100;
      merged.settingsVersion = 12;
    }
    // v13: upstream pitch art is no longer bundled or fetched. Existing installs
    // parked on one of the old built-in FUMBBL themes return to our base turf;
    // an explicitly installed asset pack can still be selected afterward.
    if ((raw.settingsVersion ?? 0) < 13) {
      if (typeof merged.turf === 'string' && merged.turf.startsWith('fumbbl-')) merged.turf = 'grass1';
      merged.settingsVersion = 13;
    }
    // v14: restore the requested 150ms movement-animation default. Existing
    // installs still carrying the former 100ms default follow the new default;
    // every other explicit speed selection remains untouched.
    if ((raw.settingsVersion ?? 0) < 14) {
      if (merged.moveSpeedMs === 100) merged.moveSpeedMs = 150;
      merged.settingsVersion = 14;
    }
    // v15: the classic confused/chomped/bloodlust PNG treatment and its picker
    // were removed. The stale key was already deleted before the settings merge.
    if ((raw.settingsVersion ?? 0) < 15) merged.settingsVersion = 15;
    // v16: the five locally authored weather textures replace Grass 1 as the
    // install default. Existing installs still following that prior default
    // move once; every other explicitly selected turf remains untouched.
    if ((raw.settingsVersion ?? 0) < 16) {
      if (merged.turf === 'grass1') merged.turf = 'default-weather';
      merged.settingsVersion = 16;
    }
    // v17 (owner 2026-09-05): the Pixel weather family becomes the install default. Installs still
    // following the v16 default move once; every explicitly selected turf stays untouched.
    if ((raw.settingsVersion ?? 0) < 17) {
      if (merged.turf === 'default-weather') merged.turf = 'pixel-weather';
      merged.settingsVersion = 17;
    }
    // v18 (owner 2026-09-05): grid lines default to 0.5x width (opacity stays 100%). Installs still on the old
    // 1x default move once; any other explicitly chosen width stays untouched.
    if ((raw.settingsVersion ?? 0) < 18) {
      if (merged.gridLineWidth === 1) merged.gridLineWidth = 0.5;
      merged.settingsVersion = 18;
    }
    // v19 (owner 2026-09-05): render scale defaults to Auto (device pixel ratio) — the fixed 1x canvas was being
    // upscaled by the OS on hi-DPI screens and every edge read muddled. Installs still on the old 1x default move
    // once; an explicit 0.5/0.75/1.5/2 stays.
    if ((raw.settingsVersion ?? 0) < 19) {
      if (merged.renderScale === 1) merged.renderScale = 0;
      merged.settingsVersion = 19;
    }
    // v20 (owner 2026-09-05): the separate 'FUMBBL Classic' sprite mode is gone — installed mods (and FUMBBL upstream
    // icons) ride the sprite chain under the user's selection. A persisted 'classic' becomes the Super FUMBBL set.
    if ((raw.settingsVersion ?? 0) < 20) {
      if (merged.spriteSet === 'classic') merged.spriteSet = 'walk';
      merged.settingsVersion = 20;
    }
    // v21 (owner 2026-09-05): chat-toast text default 14.4 -> 17 px. Only a blob still on the OLD default moves;
    // a user-chosen size sticks.
    if ((raw.settingsVersion ?? 0) < 21) {
      if (raw.chatToastTextSize === undefined || Math.abs(Number(raw.chatToastTextSize) - 14.4) < 1e-6) merged.chatToastTextSize = 17;
      merged.settingsVersion = 21;
    }
    // v22: block-dice tumble lead-in became a slider (default 250 ms); the missing key takes the default.
    if ((raw.settingsVersion ?? 0) < 22) merged.settingsVersion = 22;
    // v23 (owner 09-06): cast-shadow toggle; the missing key takes the default (on).
    if ((raw.settingsVersion ?? 0) < 23) merged.settingsVersion = 23;
    // v24 (owner 09-06): Log/Chat font default -> Arial at the slider's mid-point (15 px, range 8-22). A blob still
    // on the old Nuffle default moves; an explicit Arial/Mono choice sticks. A size under the mid-point rises to it.
    if ((raw.settingsVersion ?? 0) < 24) {
      if (raw.logFont === undefined || raw.logFont === 'nuffle') merged.logFont = 'arial';
      if (!(typeof raw.logFontSize === 'number') || raw.logFontSize < 15) merged.logFontSize = 15;
      merged.settingsVersion = 24;
    }
    // v25 (owner 09-06): action decorations (art | emoji); the missing key takes the default (art).
    if ((raw.settingsVersion ?? 0) < 25) merged.settingsVersion = 25;
    if ((raw.settingsVersion ?? 0) < 26) merged.settingsVersion = 26;
    // v27: per-item files are migrated asynchronously at boot into the native
    // synthetic pack. Their data URLs were captured above and deliberately
    // deleted before the reactive/persisted object was constructed.
    if ((raw.settingsVersion ?? 0) < 27) {
      // Keep the reactive version at 26 too: even an unexpected serializer
      // cannot falsely record completion before the native writes finish.
      merged.settingsVersion = v26UserOverrideMigrationPending ? 26 : 27;
    }
    // v28: add the independent block-dice pack assignment.
    if ((raw.settingsVersion ?? 0) < 28 && !v26UserOverrideMigrationPending) {
      merged.settingsVersion = 28;
    }
    // v29: the bundled 3D chooser is opt-out. The normal defaults merge supplies
    // true for older blobs; only an explicit persisted false disables it.
    if ((raw.settingsVersion ?? 0) < 29 && !v26UserOverrideMigrationPending) {
      merged.settingsVersion = 29;
    }
    // v30: uniform figure scale is opt-out (owner 09-09); the defaults merge supplies true for older blobs.
    if ((raw.settingsVersion ?? 0) < 30 && !v26UserOverrideMigrationPending) {
      merged.settingsVersion = 30;
    }
    // v31 (owner 09-10): E-W gets its own uniform-figures switch (on); N-S flips to OFF by default — the v30 stamp
    // wrote `true` into every blob, so an untouched v30 value is reset to the new default here.
    if ((raw.settingsVersion ?? 0) < 31 && !v26UserOverrideMigrationPending) {
      merged.uniformFigures = false;
      merged.settingsVersion = 31;
    }
    // v32 (owner 09-10): the illustrated skill badges become the default family — the earlier defaults merge stamped
    // 'default' (the flat set) into every blob, so an untouched pre-v32 value moves to 'illustrated' here.
    if ((raw.settingsVersion ?? 0) < 32 && !v26UserOverrideMigrationPending) {
      merged.skillBadgeFamily = 'illustrated';
      merged.settingsVersion = 32;
    }
    // v33 (owner 09-10): Acasas (strong) becomes the bundle default turf. Installs still following the v17 Pixel default
    // move once; every explicitly selected turf stays untouched (the mount-time catalog check handles a checkout without the family).
    if ((raw.settingsVersion ?? 0) < 33 && !v26UserOverrideMigrationPending) {
      if (merged.turf === 'pixel-weather') merged.turf = 'acasas-weather-fx';
      merged.settingsVersion = 33;
    }
    // v34 (owner 09-10): movement animation default returns to 200ms (renderer-latency headroom). Installs still on the
    // v14 150ms default move once; every explicit speed pick stays untouched.
    if ((raw.settingsVersion ?? 0) < 34 && !v26UserOverrideMigrationPending) {
      if (merged.moveSpeedMs === 150) merged.moveSpeedMs = 200;
      merged.settingsVersion = 34;
    }
    // v36 (owner 11-05): the FUMBBL-Classic view is retired. A stored Classic choice moves to Modern once (the pin
    // below keeps any later blob there too); any unknown value is treated the same way, never as a crash.
    if ((raw.settingsVersion ?? 0) < 36 && !v26UserOverrideMigrationPending) {
      if (merged.uiMode !== 'fumbbl40k') merged.uiMode = 'fumbbl40k';
      merged.settingsVersion = 36;
    }
    // Owner 09-10: the public edition has no local-dev target, and (owner 10-31) a fork target only in a run launched
    // with --fork-server. Load runs BEFORE the async launch-flag read, so a persisted 'fork' is coerced to FUMBBL now
    // and remembered; reconcileForkTarget() restores it once the flag resolves (and drops it when no flag comes).
    // Sol r3: the deferred restore is RECOMPUTED for every adopted blob (a later authoritative settings file decides,
    // not the first localStorage read); applyServerTarget() cancels it on any explicit selection.
    if (!FORK_EDITION) {
      const wasFork = merged.activeServerTarget === 'fork';
      const keepFork = wasFork && forkFeaturesEnabled();
      publicForkTargetPending = wasFork && !keepFork && !launchFlagsSettled.value;
      if (merged.activeServerTarget !== 'fumbbl' && !keepFork) {
        merged.activeServerTarget = 'fumbbl';
        merged.url = FUMBBL_WS_URL;
      }
    }
    // Owner 10-31: a 'fork' target's url derives from the effective host. Sol r20/r21: the FORK edition keeps a url the
    // coach typed in the raw Server input (forkUrlCustom) exactly as on base, and re-derives the preset otherwise (so a
    // host change saved after the freeze lands on restart); a public run's fork target (flag-only, never persisted)
    // always derives it. Settings saved before the flag existed: a non-preset fork url is inferred custom once.
    const derivedForkUrl = merged.activeServerTarget === 'fork' ? forkWsUrlFor(effectiveForkHost(() => merged.forkHost)) : '';
    if (typeof (raw as { forkUrlCustom?: unknown }).forkUrlCustom !== 'boolean') {
      const stored = (merged.url || '').trim();
      merged.forkUrlCustom = FORK_EDITION && merged.activeServerTarget === 'fork' && stored !== '' && stored !== FORK_WS_URL && stored !== derivedForkUrl;
    }
    merged.forkUrlCustom = FORK_EDITION && merged.forkUrlCustom === true;
    if (merged.activeServerTarget === 'fork' && !merged.forkUrlCustom) merged.url = derivedForkUrl;
    // Owner 09-10: public edition — wire log file always on (bug reports carry it), developer panel never shown.
    if (!FORK_EDITION) { merged.wireLog = true; merged.devPanelOpen = false; }
    // Owner 11-03 settings reflow / owner 11-05: Classic is retired (no view, no Settings row), so no run can be left
    // in a mode it has no way back out of. (Was: owner 09-12, Classic fork-edition only.)
    merged.uiMode = 'fumbbl40k';
    // Owner 11-03: LZ-String compression is always on (upstream FFB and FUMBBL both use it); its row is gone.
    merged.compression = true;
    // Owner 11-03: the "Log bottom-left, Quick bar bottom-right" row is gone; the layout is always the default one.
    merged.bottomBarsSwapped = DEFAULTS.bottomBarsSwapped;
    merged.casualtySplash = false; // owner 09-10: toggle cut from Settings; the token-anchored toast carries casualties
    // Owner 09-10: the legacy red-green accent remap becomes the deuteranopia filter; anything unknown → off.
    if ((merged.colorblindMode as string) === 'redgreen') merged.colorblindMode = 'deuteranopia';
    if (!['off', 'deuteranopia', 'protanopia', 'tritanopia'].includes(merged.colorblindMode)) merged.colorblindMode = 'off';
    merged.language = normalizeLocale(merged.language); // owner 10-23: unknown / missing -> English
    merged.languageChosen = merged.languageChosen === true; // Astra r1: only an explicit pick sets it
    // Owner 11-03: a blob saved before English split into US / UK stored `en` for "English": it now means English (US),
    // or English (UK) when the system's first English preference is a UK-family region. Once per install.
    if (rawText !== null && raw.englishVariantSettled !== true) merged.language = mapLegacyEnglish(merged.language, systemLanguageTags());
    merged.englishVariantSettled = true;
    // stamp any migration immediately so it runs ONCE (not every launch) and a
    // later user change to these keys sticks. rawText===null means NO blob was readable — a
    // fresh install needs no migration, and a transiently-null read of an EXISTING blob must
    // not let this stamp write DEFAULTS over it (the no-exception variant of the P1 wipe).
    // Owner 11-03 (Sol r1 #3): the English-variant mapping is a migration too: stamp it even on a current-version blob,
    // so it runs once and is not recomputed on every launch until some other setting happens to be saved.
    if (stampToLocalStorage && rawText !== null
      && ((raw.settingsVersion ?? 0) < SETTINGS_VERSION || raw.englishVariantSettled !== true)
      && !v26UserOverrideMigrationPending) {
      // Keep the legacy clear-text password in the blob until credentials.ts confirms the keychain
      // write — a migration stamp must not be the thing that loses it.
      const stamped = publicPersistable(legacyPassword40k ? { ...merged, password40k: legacyPassword40k } : { ...merged });
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(stamped)); } catch { /* ignore */ }
    }
    return merged;
  }
}

/** Read the blob non-destructively: primary → last-good backup → DEFAULTS (guarded). Every
 *  degraded step leaves a settingsHealth notice so a future blank is attributable, not silent. */
function load(): AppSettings {
  let rawText: string | null = null;
  let readFailed = false;
  try {
    rawText = localStorage.getItem(SETTINGS_KEY);
  } catch (e) {
    readFailed = true;
    noteSettingsIssue(`settings read failed (${(e as Error)?.message ?? String(e)}) — trying last-good backup`);
  }
  if (!readFailed && rawText !== null) {
    try {
      const loaded = hydrate(rawText);
      diskAuthority = true;
      // Refresh the last-good backup (verbatim, so a surviving password40k rides along —
      // purgeStoredPassword40k retires the clear text from BOTH keys once the keychain confirms).
      try { localStorage.setItem(BACKUP_KEY, publicDiskText(rawText)); } catch { /* ignore */ }
      return loaded;
    } catch (e) {
      noteSettingsIssue(`settings blob corrupt (${(e as Error)?.message ?? String(e)}) — trying last-good backup`);
      quarantinePublicMalformed(rawText);
    }
  }
  // Primary missing, unreadable, or corrupt: recover from the last-good backup.
  let bakText: string | null = null;
  try { bakText = localStorage.getItem(BACKUP_KEY); } catch { /* whole store down */ }
  if (bakText !== null) {
    try {
      // Heal the primary FIRST so the targeted read-modify-write helpers (purge/stamp/persist
      // carry-forward) see good data; hydrate()'s migration stamp then overwrites with the
      // migrated form where one applies.
      // Sol r6: a public build heals the primary only from a backup that is a JSON object (sanitised); a malformed backup
      // is left alone (a marker in the primary would read as a real blob and block this session's persists).
      if (FORK_EDITION || isJsonObjectText(bakText)) {
        try { localStorage.setItem(SETTINGS_KEY, publicDiskText(bakText)); } catch { /* ignore */ }
      }
      const loaded = hydrate(bakText);
      diskAuthority = true;
      noteSettingsIssue('settings restored from last-good backup');
      return loaded;
    } catch {
      noteSettingsIssue('backup blob corrupt too');
      quarantinePublicMalformed(bakText);
    }
  }
  // Genuine fresh install: nothing stored anywhere and the store itself is healthy.
  if (!readFailed && rawText === null && bakText === null) { settingsProvenance.freshInstall = true; return hydrate(null); }
  // Nothing readable. Run on DEFAULTS, but the persist watcher is GUARDED (persistSettings):
  // defaults must never overwrite a blob that reads fine later — the one-bad-read wipe.
  settingsHealth.loadedFromDefaults = true;
  noteSettingsIssue('settings unrecoverable this session — running on DEFAULTS; persisting is guarded');
  return { ...DEFAULTS };
}

export const settings = reactive<AppSettings>(load());
// Owner 10-31: forkAccess reads the FORK edition's override through this (it never imports settings itself).
registerSettingsForkHostReader(() => settings.forkHost);
// Sol r15: how the run's config-web base derives from its host (the FORK edition's explicit botConfigUrl wins).
registerConfigWebResolver((host) => {
  const explicit = FORK_EDITION ? (settings.botConfigUrl || '').trim() : '';
  return explicit ? explicit.replace(/\/+$/, '') : configWebBaseFor(host);
});

/** P1 08-19 (leak #4): TWO instances share one WebView2 profile (same identifier; the
 *  single-instance plugin is opt-in — two-coach testing runs two clients). A window that
 *  loaded the blob BEFORE the creds were typed holds '' in memory, and its next whole-object
 *  persist — which fires with no user input (uiLayout reanchor, logPos ResizeObserver) —
 *  deletes them from disk. Rule: a session may only BLANK a credential field it actually
 *  HELD a value for (a deliberate clear); one that never saw a value carries the disk copy
 *  forward instead. Tracked per-field: seeded from the loaded blob, marked on any non-empty
 *  persist. */
const CRED_FIELDS = ['coach', 'password', 'coach40k'] as const;
const credHeld: Record<(typeof CRED_FIELDS)[number], boolean> = {
  coach: !!settings.coach,
  password: !!settings.password,
  coach40k: !!settings.coach40k,
};

/**
 * Persist the settings blob. `password40k` is NOT a settings field — load() lifts it out — so a
 * plain whole-object serialize DELETES it from disk. That is fine once the OS credential store
 * owns the password, and catastrophic before: while the store is degraded (or the migration has
 * not confirmed yet) the clear-text copy is the ONLY surviving fork password, and an unrelated
 * toggle — volume, a theme pick, devMode at startup — must not be the thing that destroys it.
 * The user sees that as "my password didn't save", silently, because a degrade notice fires at
 * write time and nothing raises one here.
 *
 * Authority to REMOVE `password40k` therefore belongs solely to purgeStoredPassword40k(), which
 * runs only after the keychain has confirmed. Until then this carries the field forward.
 */
let persistRefusalNoted = false;

/** Consulted before the FIRST persist of a session that never loaded a real blob (defaults or a
 *  fresh install): may this session own the disk? Yes when the blob is genuinely absent, or
 *  unparseable junk (parked in CORRUPT_KEY first, never simply destroyed). No when it parses fine
 *  NOW — the load-time miss was TRANSIENT (throwing getItem, null read of an existing key), and
 *  persisting defaults over the good blob is exactly the P1 wipe this guard exists to stop. */
function mayPersistOverDisk(): boolean {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null || raw === '') return true;
    // Sol r7: only a JSON OBJECT "reads fine" (hydrate rejects null / arrays / primitives as malformed too).
    if (isJsonObjectText(raw)) return false;
    try { localStorage.setItem(CORRUPT_KEY, publicDiskText(raw)); } catch { /* ignore */ } // public: a host-free marker
    return true;
  } catch {
    return false;
  }
}

function persistSettings(value: AppSettings): void {
  // Do not replace the only durable copy of v26's data URLs until the native
  // Your files migration has attempted every entry.
  if (v26UserOverrideMigrationPending) return;
  // File lane (owner 08-19): once the JSON file is adopted, localStorage is retired to a
  // tombstone and every persist rides the debounced atomic file write instead.
  if (fileMode) {
    scheduleFilePersist();
    return;
  }
  if (!diskAuthority) {
    if (!mayPersistOverDisk()) {
      if (!persistRefusalNoted) {
        persistRefusalNoted = true;
        noteSettingsIssue('persist refused: this session never loaded the on-disk blob, but it reads fine now — not overwriting it');
      }
      return;
    }
    diskAuthority = true; // disk is absent/quarantined junk — this session may own it now
  }
  try {
    const payload = publicPersistable({ ...value }) as Record<string, unknown>;
    // One disk read serves the password40k carry-forward and the cred-clobber guard below.
    // Own try: a corrupt/unreadable blob (already quarantined above) must not abort the write.
    let disk: Record<string, unknown> = {};
    try {
      disk = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Record<string, unknown>;
    } catch { /* ignore */ }
    // Degraded store: stamp the LIVE password, so an edit made this session survives the restart.
    const fallback = forkPasswordFallback();
    if (fallback) payload.password40k = fallback;
    // Not degraded: carry forward an un-purged legacy copy rather than dropping it here.
    else if (typeof disk.password40k === 'string') payload.password40k = disk.password40k;
    // Cred-clobber guard (leak #4, see credHeld): never write '' over a disk value this
    // session never held — a stale sibling instance has no authority to blank credentials.
    for (const field of CRED_FIELDS) {
      if (payload[field]) { credHeld[field] = true; continue; }
      if (credHeld[field]) continue; // deliberate clear by the session that held it
      const onDisk = disk[field];
      if (typeof onDisk === 'string' && onDisk) payload[field] = onDisk;
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
  } catch { /* ignore */ }
}

watch(settings, persistSettings, { deep: true });

/** Owner 10-31: the PUBLIC build persists nothing about the fork. Every public payload (localStorage, its backup and
 *  migration stamp, the settings file, the bug-report settings) carries the Official FUMBBL target and url - always,
 *  whatever the live url says - and no `forkHost` / `botConfigUrl` at all. Credential fields are left as they are
 *  (their own carry-forward rules apply). Mutates and returns the given (already copied) object; FORK edition: as is. */
export function publicPersistable<T extends object>(value: T): T {
  if (FORK_EDITION) return value;
  const rec = value as Record<string, unknown>;
  rec.activeServerTarget = 'fumbbl';
  rec.url = FUMBBL_WS_URL;
  delete rec.forkHost;
  delete rec.botConfigUrl;
  delete rec.forkUrlCustom;
  return value;
}

/** @internal test seam / diagnostics. */
export function lastCorruptSettingsInMemory(): string | null { return publicCorruptSettingsInMemory; }

/** publicPersistable for raw blob text written to a localStorage key (backup refresh / heal / corrupt quarantine).
 *  Public build: a JSON object is parsed and sanitised; anything else (unparseable or not an object) is NEVER written
 *  as is (Sol r6) - the raw bytes stay in memory and a host-free marker {corrupt, length, at} is persisted instead.
 *  FORK edition: unchanged. */
function isJsonObjectText(text: string): boolean {
  try {
    const v = JSON.parse(text) as unknown;
    return !!v && typeof v === 'object' && !Array.isArray(v);
  } catch {
    return false;
  }
}

export function publicDiskText(text: string): string {
  if (FORK_EDITION) return text;
  try {
    const raw = JSON.parse(text) as unknown;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return JSON.stringify(publicPersistable(raw as Record<string, unknown>));
  } catch { /* malformed: the marker below */ }
  publicCorruptSettingsInMemory = text;
  return JSON.stringify({ corrupt: true, length: text.length, at: new Date().toISOString() });
}

/** The edition name the shell compares against (second_client.rs running_edition). */
export const SECOND_CLIENT_EDITION: 'public' | 'fork' = FORK_EDITION ? 'fork' : 'public';

/** The EFFECTIVE second-client setting for this build: on only when the flag is on AND it was turned on by this
 *  edition (Astra round 2). A pair saved by the other edition (shared settings file) reads OFF here and is left exactly
 *  as loaded - never re-stamped by a watcher, hydration or migration. */
export function secondClientEnabled(s: Pick<AppSettings, 'allowSecondClient' | 'allowSecondClientEdition'> = settings): boolean {
  return s.allowSecondClient === true && s.allowSecondClientEdition === SECOND_CLIENT_EDITION;
}

// The bug-report host attaches only this window's own tagged wire log while the setting is effectively on.
setWireLogSecondClientProbe(() => secondClientEnabled());

/** True when the flag is on but was turned on by the other edition (the Settings hint says so). */
export function secondClientEnabledElsewhere(s: Pick<AppSettings, 'allowSecondClient' | 'allowSecondClientEdition'> = settings): boolean {
  return s.allowSecondClient === true && s.allowSecondClientEdition !== SECOND_CLIENT_EDITION;
}

/** The checkbox's own change handler - the ONLY writer of allowSecondClientEdition: on stamps this build's edition,
 *  off clears both. */
export function setAllowSecondClient(on: boolean): void {
  if (on === true) patchModeSession = true;
  settings.allowSecondClient = on === true;
  settings.allowSecondClientEdition = on === true ? SECOND_CLIENT_EDITION : '';
}

// --- File persistence (owner 08-19) --------------------------------------------
// The durable settings store is `settings.json` in the app data dir, written ATOMICALLY by the
// Rust side (settings_save: tmp + fsync + rename). WebView2 localStorage is no longer trusted:
// the 08-18 runtime auto-update silently stopped committing the old profile's Local Storage to
// disk. Load order: file → file.bak → localStorage legacy → recovery file → defaults, never
// destructive. NO SECRETS IN THE FILE, EVER — the serializer strips them by construction.

const FILE_DEBOUNCE_MS = 300;

const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

interface SettingsFilePayload { primary: string | null; backup: string | null; recovery: string | null }

/** True once settings.json is the adopted durable store; flips the persist watcher's lane. */
let fileMode = false;
let fileWriteTimer: ReturnType<typeof setTimeout> | null = null;
let v26DeferredFileAdoption = false;
let v26DeferredRecoveryAdoption = false;
/** Serializes settings_save invokes so writes land in order; never left rejected. */
let fileWriteChain: Promise<void> = Promise.resolve();
/** Owner 10-22 (second client window): this window's own value of every top-level key (JSON text) as of its last
 *  load / write. A key whose live value still equals it was not changed HERE; a two-client save sends only the changed
 *  keys as `patch`, and the shell merges them onto the CURRENT file under its cross-process lock (lib.rs
 *  save_settings_in), so another window's unrelated edits survive. */
let fileBaseline: Map<string, string> | null = null;
/** Astra r3: once this session has had the second-client setting on (at load or by the checkbox), every save for the
 *  rest of the session is a patch - including the one that turns it off - so a sibling window's newer values are never
 *  replaced by this window's full blob. Sessions that started with it off and never turned it on keep the full blob. */
let patchModeSession = false;
/** Astra r3: a startup repair (backup recovery, migration, retired keys, stale .bak) not yet CONFIRMED by the shell.
 *  The baseline only advances after a confirmed write, and every persist - even a "nothing changed" flush - retries
 *  this first. `restore` = the primary was unreadable and this window runs on the backup: the shell decides under its
 *  lock (Astra r4) - still unreadable -> backup + this window's own changes; repaired meanwhile by another window -> only
 *  this window's own changes, .bak left alone. Else a patch against the disk baseline. */
let pendingRepair: { restore: boolean; retire: string[]; rawBackup?: Map<string, string>; afterBackupOk?: () => void } | null = null;
// Astra r6: a repair whose primary committed but whose .bak refresh failed becomes { restore: false, retire: [] } -
// a "backup refresh pending" that the next save retries (refreshBackup + its patch, plain branch) until the shell
// reports the .bak ok.
/** The recovery file may only be deleted after its cleartext password CONFIRMS in the keychain
 *  (purgeStoredPassword40k is that signal — the f983443c pattern). */
let recoveryPendingPurge = false;
/** True once the keychain confirmed the fork password this session (purgeStoredPassword40k). */
let password40kConfirmed = false;

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/** Any key whose NAME says credential is refused, at every depth — a denylist by construction,
 *  so a future `xTokenY` field can never leak into the file or a bug report. */
const SECRET_KEY_RE = /password|token|secret/i;

export function stripSecretFields<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) stripSecretFields(item);
  } else if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (SECRET_KEY_RE.test(key)) delete rec[key];
      else stripSecretFields(rec[key]);
    }
  }
  return value;
}

/** The ONE serializer for the on-disk file AND the bug-report attachment: pretty-printed,
 *  secret-free. The JSON round-trip also sheds Vue's reactive proxy before the strip mutates. */
export function serializeSettingsForFile(value: AppSettings): string {
  const copy = publicPersistable(JSON.parse(JSON.stringify(value)) as AppSettings) as unknown as Record<string, unknown>;
  return JSON.stringify(stripSecretFields(copy), null, 2);
}

function noteFileBaseline(payload: Record<string, unknown>): void {
  fileBaseline = canonicalMap(payload);
}

/** JSON with object keys sorted at every depth: the shell's merge writes keys in its own order, so "same content" is
 *  compared on this form, never on raw text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec).sort().filter((k) => rec[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** The keys of `ours` that differ from `base` (a per-key JSON map, e.g. the window baseline or the parsed disk file),
 *  as a patch object. Without a base every key is in it. Empty object = nothing changed. */
export function settingsPatch(ours: Record<string, unknown>, base: ReadonlyMap<string, string> | null): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(ours)) {
    if (!base || base.get(key) !== canonicalJson(ours[key])) patch[key] = ours[key];
  }
  return patch;
}

function canonicalMap(rec: Record<string, unknown>): Map<string, string> {
  return new Map(Object.keys(rec).map((key) => [key, canonicalJson(rec[key])]));
}

/** Ordered, result-visible settings_save. The chain keeps concurrent saves in write order. */
function fileWrite(contents: string, refreshBackup: boolean, patch?: Record<string, unknown>, retire?: string[], restorePatch?: Record<string, unknown>): Promise<SettingsSaveOutcome | null> {
  // `patch` (owner 10-22): the shell merges just these keys onto the CURRENT file under its lock, keeping every other
  // key on disk; `retire` names the only keys it may remove; `restoreFromBackup` (Astra r4) makes a backup recovery
  // conditional on the primary still being unreadable when the shell holds the lock; `restorePatch` (Astra r5) is what
  // that branch applies to the raw backup (migration diff + own changes). An older shell ignores them and writes
  // `contents` whole.
  // Sol r5: a public patch save always states the official target + url and retires the fork keys, so the merge can
  // never keep another edition's values (the public shell enforces the same under its lock).
  if (!FORK_EDITION && patch) {
    patch = publicPersistable({ ...patch, activeServerTarget: 'fumbbl' });
    retire = [...new Set([...(retire ?? []), 'forkHost', 'botConfigUrl'])];
    if (restorePatch) restorePatch = publicPersistable({ ...restorePatch, activeServerTarget: 'fumbbl' });
  }
  const args: Record<string, unknown> = patch
    ? {
      contents, refreshBackup, patch: JSON.stringify(patch),
      ...(retire && retire.length ? { retire } : {}),
      ...(restorePatch ? { restoreFromBackup: true, restorePatch: JSON.stringify(restorePatch) } : {}),
    }
    : { contents, refreshBackup };
  const next = fileWriteChain
    .catch(() => { /* earlier failure already noticed */ })
    .then(() => invokeTauri<SettingsSaveOutcome | null | undefined>('settings_save', args));
  fileWriteChain = next.then(() => undefined, () => { /* keep the chain alive */ });
  return next.then((outcome) => outcome ?? null);
}

/** Astra r6: what the shell's save achieved. Older shells return nothing (null): treated as complete. */
interface SettingsSaveOutcome { primary?: string; backup?: 'ok' | 'failed' | 'skipped' }

/** False only when the shell reports that a requested .bak refresh failed. */
export function backupRefreshOk(outcome: SettingsSaveOutcome | null): boolean {
  return outcome?.backup !== 'failed';
}

/** Adopt a hydrated blob into the live reactive object and re-seed the cred-clobber guard. */
function adoptLoaded(loaded: AppSettings): void {
  // The file never carries secrets, so a file-load merges '' over a password already captured
  // from the localStorage/recovery blob at module eval — keep that copy for credentials.ts.
  const heldPassword = settings.password;
  Object.assign(settings, loaded);
  if (!settings.password && heldPassword) settings.password = heldPassword;
  for (const field of CRED_FIELDS) if (settings[field]) credHeld[field] = true;
}

/** After confirmed file adoption, localStorage keeps only a tombstone — plus any clear-text
 *  secret still awaiting its keychain confirmation (purge/stamp keep operating on it). */
function retireLocalStorageBlob(): void {
  for (const key of [SETTINGS_KEY, BACKUP_KEY]) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      const tomb: Record<string, unknown> = { movedToFile: true };
      if (typeof raw.password40k === 'string' && raw.password40k) tomb.password40k = raw.password40k;
      if (typeof raw.password === 'string' && raw.password) tomb.password = raw.password;
      localStorage.setItem(key, JSON.stringify(tomb));
    } catch { /* ignore */ }
  }
}

/**
 * Adopt the file store. Awaited by main.ts BEFORE initCredentials (so a recovery-file password
 * reaches the keychain migration) and before mount. Every failure degrades to the previous lane
 * (localStorage) with a settingsHealth notice; fileMode stays off, so a session that never read
 * the real file can never overwrite it — the file-lane mirror of the one-bad-read guard.
 */
/** Astra r7: an import (localStorage, recovery file, deferred v26 adoption) writes the primary AND the .bak through the
 *  same tracked path as a startup repair. A primary failure throws (the caller keeps its old lane). Primary ok + .bak
 *  failed -> "backup refresh pending" (notice shown, the next save retries with refreshBackup) and `retireSource` - the
 *  import source's retirement - runs only once BOTH are ok; the source stays the safety net until then. */
async function importToFile(retireSource: () => void): Promise<void> {
  const blob = serializeSettingsForFile(settings);
  const outcome = await fileWrite(blob, true);
  fileMode = true;
  noteFileBaseline(JSON.parse(blob) as Record<string, unknown>);
  if (backupRefreshOk(outcome)) { retireSource(); return; }
  pendingRepair = { restore: false, retire: [], afterBackupOk: retireSource };
  noteSettingsIssue('settings backup refresh failed - retried on the next save');
}

/** Retiring the recovery file: at once, or - when it carried a clear-text fork password the keychain has not
 *  confirmed yet - when purgeStoredPassword40k() runs. */
function retireRecoveryFile(hadLegacyPassword: boolean): void {
  if (hadLegacyPassword && !password40kConfirmed) recoveryPendingPurge = true;
  else void invokeTauri('settings_purge_recovery').catch(() => { /* retried next boot */ });
}

export async function initSettingsFile(): Promise<void> {
  if (!inTauri) return;
  let payload: SettingsFilePayload;
  try {
    payload = await invokeTauri<SettingsFilePayload>('settings_load');
  } catch (e) {
    noteSettingsIssue(`settings file unavailable (${(e as Error)?.message ?? String(e)}) — staying on localStorage this session`);
    return;
  }
  // file → file.bak
  for (const [text, source] of [[payload.primary, 'file'], [payload.backup, 'file backup']] as const) {
    if (text === null) continue;
    settingsProvenance.freshInstall = false; // a settings file existed before this launch (readable or not)
    try {
      adoptLoaded(hydrate(text, false));
      fileMode = true;
      diskAuthority = true;
      const loadedBlob = serializeSettingsForFile(settings);
      const loaded = JSON.parse(loadedBlob) as Record<string, unknown>;
      if (secondClientEnabled()) patchModeSession = true;
      noteFileBaseline(loaded);
      // Refresh the .bak ONLY from a blob that just parsed + hydrated clean (9f9eddbb doctrine);
      // this same write heals a primary that was recovered from the backup.
      // Owner 10-22 (Astra P2): from the primary, write only what the migration CHANGED (as a patch the shell merges
      // under its lock), never the unchanged snapshot - a second window's newer save must survive this boot. An
      // identical primary + backup is not rewritten at all; a stale backup alone is refreshed with an empty patch
      // (the shell re-reads the current file and copies it).
      // Astra r3: the repair is PENDING until the shell confirms it; the baseline stays at what is actually on disk
      // (nothing, for an unreadable primary) so a failed write is retried by the next persist / flush.
      if (!v26UserOverrideMigrationPending) {
        if (source !== 'file') {
          // Baseline = what was loaded, so `patch` is only THIS window's own later changes (the repaired-primary branch).
          // Astra r5: the still-corrupt branch restores the RAW backup, so its patch is measured against that raw blob:
          // the hydration's migration diff (version key included) + own changes, and `retire` drops the legacy keys.
          let rawRec: Record<string, unknown> = {};
          try { rawRec = JSON.parse(text) as Record<string, unknown>; } catch { /* hydrate parsed it; unreachable */ }
          const rawRetire = Object.keys(rawRec).filter((key) => !Object.prototype.hasOwnProperty.call(loaded, key));
          pendingRepair = { restore: true, retire: rawRetire, rawBackup: canonicalMap(rawRec) };
        } else {
          let diskRec: Record<string, unknown> = {};
          try { diskRec = JSON.parse(text) as Record<string, unknown>; } catch { /* hydrate parsed it; unreachable */ }
          const patch = settingsPatch(loaded, canonicalMap(diskRec));
          // The explicit retired-keys list: fields on disk this build's hydration dropped (a migration retired them).
          const retire = Object.keys(diskRec).filter((key) => !Object.prototype.hasOwnProperty.call(loaded, key));
          let backupStale = true;
          try { backupStale = payload.backup === null || canonicalJson(JSON.parse(payload.backup)) !== canonicalJson(diskRec); } catch { /* unreadable backup */ }
          if (Object.keys(patch).length > 0 || retire.length > 0 || backupStale) {
            fileBaseline = canonicalMap(diskRec);
            pendingRepair = { restore: false, retire };
          }
        }
        if (pendingRepair) void persistToFile().catch(() => { /* noted; retried by the next persist */ });
      }
      if (source !== 'file') noteSettingsIssue('settings restored from file backup');
      return;
    } catch (e) {
      noteSettingsIssue(`settings ${source} corrupt (${(e as Error)?.message ?? String(e)})`);
      // Park, never destroy: the unreadable bytes survive for diagnosis before anything overwrites.
      if (source === 'file') { try { localStorage.setItem(CORRUPT_KEY, publicDiskText(text)); } catch { /* ignore */ } }
    }
  }
  // No readable file: one-shot import. localStorage first — module eval already hydrated it when
  // it was real (diskAuthority), so the live object IS the import.
  if (diskAuthority) {
    if (v26UserOverrideMigrationPending) {
      v26DeferredFileAdoption = true;
      return;
    }
    try {
      await importToFile(retireLocalStorageBlob);
    } catch (e) {
      noteSettingsIssue(`settings file write failed (${(e as Error)?.message ?? String(e)}) — staying on localStorage`);
    }
    return;
  }
  // Recovery file (owner's 08-18 salvage): its cleartext password40k is captured by hydrate()
  // for the keychain route and NEVER written to settings.json (stripped by construction).
  if (payload.recovery !== null) {
    try {
      adoptLoaded(hydrate(payload.recovery, false));
      settingsProvenance.freshInstall = false;
      diskAuthority = true;
      if (v26UserOverrideMigrationPending) {
        v26DeferredFileAdoption = true;
        v26DeferredRecoveryAdoption = true;
        return;
      }
      const hadLegacyPassword = !!legacyPassword40k; // deleted once the keychain confirms
      await importToFile(() => retireRecoveryFile(hadLegacyPassword));
      noteSettingsIssue('settings imported from the 08-18 recovery file');
      return;
    } catch (e) {
      noteSettingsIssue(`recovery import failed (${(e as Error)?.message ?? String(e)})`);
    }
  }
  // Genuine fresh install (or nothing readable anywhere): the file lane owns persistence now.
  fileMode = true;
}

function scheduleFilePersist(): void {
  if (fileWriteTimer) clearTimeout(fileWriteTimer);
  fileWriteTimer = setTimeout(() => { fileWriteTimer = null; void persistToFile(); }, FILE_DEBOUNCE_MS);
}

// Astra r7: saves are SERIALISED - one in flight at a time; a save asked for meanwhile is queued (coalesced into one)
// and runs only after the in-flight one completes, so its diff is taken at send time against the baseline the
// completed save advanced to. A stalled older save can therefore never land after (and over) a newer edit.
let persistRunning: Promise<void> | null = null;
let persistQueued: Promise<void> | null = null;

function persistToFile(propagateFailure = false): Promise<void> {
  let run: Promise<void>;
  if (!persistRunning) {
    run = persistRunning = persistOnce().finally(() => { persistRunning = null; });
  } else {
    persistQueued ??= persistRunning.catch(() => undefined).then(() => {
      persistQueued = null;
      return persistToFile(true);
    });
    run = persistQueued;
  }
  return propagateFailure ? run : run.catch(() => undefined);
}

async function persistOnce(): Promise<void> {
  if (v26UserOverrideMigrationPending) return;
  const live = JSON.parse(serializeSettingsForFile(settings)) as Record<string, unknown>;
  const payload: Record<string, unknown> = { ...live };
  // Cred-clobber guard (leak #4, 322b209d) ported to the file lane: never write '' over a disk
  // value this session never held. password never rides the file, so only the coach names apply.
  try {
    const disk = await invokeTauri<SettingsFilePayload>('settings_load');
    const onDisk = JSON.parse(disk.primary ?? '{}') as Record<string, unknown>;
    for (const field of ['coach', 'coach40k'] as const) {
      if (payload[field]) { credHeld[field] = true; continue; }
      if (credHeld[field]) continue; // deliberate clear by the session that held it
      const value = onDisk[field];
      if (typeof value === 'string' && value) payload[field] = value;
    }
  } catch { /* disk unreadable — write what we have; last-writer-wins is accepted */ }
  // Owner 10-22: with a second client window allowed, only the keys THIS window changed go to the shell (patch), which
  // merges them onto the current file under its cross-process lock; nothing changed here = no write at all (e.g. the
  // close-path flush). Setting off: the full blob, as before (same lock + unique temp on the shell side).
  // Astra r2: nothing changed since this window's last load / write = no write at all, in either mode (the post-load
  // debounce and the close flush no longer rewrite an identical snapshot - e.g. the other edition's untouched pair).
  // Astra r3: a pending startup repair always goes (refreshing the .bak); the session's patch mode is sticky.
  if (secondClientEnabled()) patchModeSession = true;
  const repair = pendingRepair;
  const changed = settingsPatch(payload, fileBaseline);
  const sameShape = !!fileBaseline && fileBaseline.size === Object.keys(payload).length;
  if (!repair && fileBaseline && sameShape && Object.keys(changed).length === 0) return;
  let patch: Record<string, unknown> | undefined = patchModeSession ? changed : undefined;
  let retire: string[] | undefined;
  let restorePatch: Record<string, unknown> | undefined;
  if (repair) {
    patch = changed;
    retire = repair.retire;
    if (repair.restore) restorePatch = settingsPatch(payload, repair.rawBackup ?? null);
  }
  try {
    const outcome = await fileWrite(JSON.stringify(payload, null, 2), !!repair, patch, retire, restorePatch);
    noteFileBaseline(live);
    if (repair && pendingRepair === repair) {
      // The primary is now readable (this window wrote it); only the .bak may still be owed.
      if (backupRefreshOk(outcome)) {
        pendingRepair = null;
        repair.afterBackupOk?.();
      } else {
        pendingRepair = { restore: false, retire: [], afterBackupOk: repair.afterBackupOk };
        noteSettingsIssue('settings backup refresh failed - retried on the next save');
      }
    }
  } catch (e) {
    noteSettingsIssue(`settings file write failed (${(e as Error)?.message ?? String(e)})`);
    throw e;
  }
}

/** Commit the v26 -> v27 boundary only after the native user-pack migration has
 * attempted every entry. Until this resolves, the original data URLs remain in
 * whichever durable lane supplied them. */
export async function completeV26UserOverrideMigration(): Promise<void> {
  if (!v26UserOverrideMigrationPending) return;
  v26UserOverrideMigrationPending = false;
  settings.settingsVersion = SETTINGS_VERSION;
  try {
    if (v26DeferredFileAdoption) {
      const withRecovery = v26DeferredRecoveryAdoption;
      const hadLegacyPassword = !!legacyPassword40k;
      await importToFile(() => {
        retireLocalStorageBlob();
        if (withRecovery) retireRecoveryFile(hadLegacyPassword);
      });
      v26DeferredFileAdoption = false;
      v26DeferredRecoveryAdoption = false;
    } else if (fileMode) {
      await persistToFile(true);
    } else {
      persistSettings(settings);
    }
    v26UserOverrideMigration = null;
  } catch (error) {
    // The old durable blob was not replaced, so preserve retry semantics in
    // memory too. Native writes are idempotent on the next launch.
    settings.settingsVersion = 26;
    v26UserOverrideMigrationPending = true;
    throw error;
  }
}

/** Close-path flush: run any pending debounced save NOW and drain the write chain, so app close
 *  cannot lose a completed edit (the Rust write finishes before the invoke resolves). */
export function flushSettingsFile(): Promise<void> {
  if (v26UserOverrideMigrationPending) return fileWriteChain;
  if (!fileMode) return fileWriteChain;
  // Persist unconditionally, not just when a timer is pending: a mutation made this same tick has
  // not fired the (pre-flush) deep watcher yet, and close beats it. Idempotent when unchanged.
  if (fileWriteTimer) {
    clearTimeout(fileWriteTimer);
    fileWriteTimer = null;
  }
  return persistToFile(true);
}

// `pagehide` fires on webview teardown where `beforeunload` may not (same rationale as the
// credentials flush).
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => { void flushSettingsFile().catch(() => undefined); });
}

/** Human-readable label for a KeyboardEvent.code binding. */
/** Null when `code` may be bound to `which`; otherwise why not. */
export function hotkeyConflict(which: RebindableKey, code: string, current: Pick<AppSettings, RebindableKey> & { controlBindings?: ControlBindings; fumbblShortcuts?: boolean; fumbblKeyBindings?: FumbblKeyBindings }): string | null {
  if (!code) return 'No key pressed';
  if (UNBINDABLE_CODES.includes(code)) return `${keyLabel(code)} can't be used as a shortcut`;
  if (FIXED_SHORTCUT_CODES.includes(code)) return `${keyLabel(code)} is already a fixed shortcut`;
  for (const other of Object.keys(REBINDABLE_LABEL) as RebindableKey[]) {
    if (other !== which && current[other] === code) return `${keyLabel(code)} is already bound to ${REBINDABLE_LABEL[other]}`;
  }
  // Controller support P1: the registry's other keyboard cells (secondaries, new actions) count too.
  if (current.controlBindings) {
    const self = REBINDABLE_ACTION[which];
    const holder = bindingConflict({ ...current, controlBindings: current.controlBindings, inputMethod: 'keyboard' } as AppSettings, self, 'keyboard', 'primary', code);
    if (holder) return `${keyLabel(code)} is already bound to ${controlAction(holder).label}`;
  }
  if (current.fumbblShortcuts && current.fumbblKeyBindings) {
    const fumbbl = fumbblKeyHolder(current.fumbblKeyBindings, code);
    if (fumbbl) return `${keyLabel(code)} is already bound to ${fumbblKeyAction(fumbbl).label}`;
  }
  return null;
}

/** Controller support P1: null when `input` may go in that Settings > Controls cell; otherwise why not. Keyboard cells
 *  follow the same rules as the legacy rebind (no Tab / modifiers / fixed shortcuts); both methods refuse an input
 *  another action already holds. */
export function controlBindingConflict(id: ControlActionId, method: BindingMethod, slot: BindingSlot, input: string, current: AppSettings): string | null {
  if (!input) return null;
  const name = method === 'keyboard' ? keyLabel(input) : input;
  if (method === 'keyboard') {
    // Owner 10-10: a mouse button never takes the three legacy keys (Confirm / Roster / Log live in their own key
    // fields, read as keyboard codes all over the client).
    if (isMouseInput(input) && controlAction(id).keyboardAlias) return `${name} can't be bound to ${controlAction(id).label}`;
    if (UNBINDABLE_CODES.includes(input)) return `${name} can't be used as a shortcut`;
    if (FIXED_SHORTCUT_CODES.includes(input)) return `${name} is already a fixed shortcut`;
  }
  const holder = bindingConflict(current, id, method, slot, input);
  if (holder) return `${name} is already bound to ${controlAction(holder).label}`;
  // FUMBBL keyboard shortcuts (owner 11-03): while they are on, their keys are taken too.
  if (method === 'keyboard' && current.fumbblShortcuts) {
    const fumbbl = fumbblKeyHolder(current.fumbblKeyBindings, input);
    if (fumbbl) return `${name} is already bound to ${fumbblKeyAction(fumbbl).label}`;
  }
  return null;
}

/** WASD: the camera-pan keys a FUMBBL shortcut may take (turning FUMBBL keyboard shortcuts on turns WASD pan off). */
const WASD_PAN_CODES: readonly string[] = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
/** FUMBBL keyboard shortcuts (owner 11-03): null when `chord` may go in that FUMBBL cell; otherwise why not. The same
 *  rules as the bindings table: no Tab / modifiers alone / fixed shortcuts (WASD excepted), no key another action
 *  holds - a bindings-table action, the Confirm / Roster / Log keys, or another FUMBBL shortcut. */
export function fumbblKeyConflict(id: FumbblKeyActionId, chord: string, current: AppSettings): string | null {
  if (!chord) return null;
  if (!isFumbblChord(chord)) return `${chord} can't be used as a shortcut`;
  const name = chordLabel(chord, keyLabel);
  const bare = !/\+/.test(chord);
  if (bare && UNBINDABLE_CODES.includes(chord)) return `${name} can't be used as a shortcut`;
  if (bare && FIXED_SHORTCUT_CODES.includes(chord) && !WASD_PAN_CODES.includes(chord)) return `${name} is already a fixed shortcut`;
  const other = fumbblKeyHolder(current.fumbblKeyBindings, chord, id);
  if (other) return `${name} is already bound to ${fumbblKeyAction(other).label}`;
  if (bare) {
    for (const action of CONTROL_ACTIONS) {
      if (action.context !== 'game' && action.context !== 'any') continue;
      // Sol r1 #9: camera pan gives W A S D up while FUMBBL shortcuts are on - its fixed WASD is never a clash here.
      if (action.id === 'cameraPan' && WASD_PAN_CODES.includes(chord)) continue;
      const b = getBinding(current, action.id as ControlActionId).keyboard;
      if (b.primary === chord || b.secondary === chord) return `${name} is already bound to ${action.label}`;
    }
  }
  return null;
}

export function keyLabel(code: string): string {
  if (code === 'Space') return '␣ Space';
  if (code === MOUSE_MIDDLE) return 'Middle mouse'; // owner 10-10: the one mouse button a binding cell may hold
  return code.replace(/^Key/, '').replace(/^Digit/, '');
}

// --- Self-hosting: backend targets (self-host-plan §1/§4) ---------------------

export type ServerAuth = 'anonymous' | 'fumbbl' | 'standalone';

export interface ServerTarget {
  id: string;
  label: string;
  url: string;
  /** anonymous = official spectate (empty creds); fumbbl = official play
   *  (real account); standalone = our fork server (null challenge → md5(pw)). */
  auth: ServerAuth;
  compression: boolean;
}

/** Match/API origin only. Media CDN requests are deliberately disabled.
 *  Owner 10-05 (dev build: "Check name" refused with "URL not allowed on the configured scope:
 *  http://localhost:1420/fumbbl-site/..."): the vite `/fumbbl-site` proxy exists for the BROWSER dev server (CORS).
 *  Inside Tauri the http plugin fetches fumbbl.com directly and its capability scope allows only that origin, so a
 *  `tauri dev` run must not route through the proxy path. */
export const FUMBBL_SITE = import.meta.env.DEV && !inTauri ? '/fumbbl-site' : 'https://fumbbl.com';

/** The backend presets the launch picker offers. The hosted public server
 *  (self-host-plan §1 row 3) is added once a host exists. */
const ALL_SERVER_TARGETS: ServerTarget[] = [
  { id: 'fumbbl', get label() { return $t('settings.allServerTargets.officialFumbbl'); }, url: FUMBBL_WS_URL, auth: 'fumbbl', compression: true },
  { id: 'local', get label() { return $t('settings.allServerTargets.superFumbblLocalDev'); }, url: 'ws://localhost:22227/command', auth: 'standalone', compression: true },
  // Owner 2026-07-07: the FORK server. FORK builds default to this (see the activeServerTarget default below).
  // Owner 10-31: no host in the label or the url - the url resolves from the effective fork host (forkServerUrl).
  { id: 'fork', get label() { return $t('settings.allServerTargets.superFumbblForkFork'); }, get url() { return forkServerUrl(); }, auth: 'standalone', compression: true },
];
/** The targets this run offers. Owner 09-10: the public edition offers Official FUMBBL only - owner 10-31: plus the
 *  fork when launched with --fork-server. The FORK edition always keeps its fork target (only the connection needs a
 *  host: with none, its url is '' and nothing is dialled). */
export function serverTargets(): ServerTarget[] {
  return ALL_SERVER_TARGETS.filter((t) => {
    if (t.id === 'fumbbl') return true;
    if (t.id === 'local') return FORK_EDITION;
    return forkFeaturesEnabled();
  });
}

/** The FORK server's ws URL from the effective fork host (owner 10-31: launch flag; FORK edition: settings.forkHost
 *  / VITE_FORK_SERVER_HOST). '' = no host: the fork is unavailable and its target is hidden (serverTargets). Local dev
 *  uses the separate 'local' target. */
export function forkServerUrl(): string {
  const host = effectiveForkHost();
  return host ? forkWsUrlFor(host) : '';
}

/** Owner 2026-07-08: the Tournament Bot config-web base URL (fork-JNLP / team-builder endpoint host). Derives from
 *  the same effective fork host as the game WS (owner ruling 11-01: launch flag, FORK override, else the baked default). An explicit `settings.botConfigUrl`
 *  still wins in the FORK edition (full-URL escape hatch, empty by default). '' = no host (fork unavailable; callers
 *  a local host on a port other than 4310). Trailing slash trimmed. */
export function botConfigBaseUrl(): string {
  // Sol r15: frozen together with the fork host as one pair (forkAccess) - a later botConfigUrl / forkHost edit applies
  // on the next launch.
  return forkConfigWebBase();
}
watch(() => settings.botConfigUrl, (next, prev) => {
  if (forkHostFrozen() && next !== prev) {
    try { console.info('[settings] config-web URL saved; restart Super FUMBBL to use it (this run keeps its config-web)'); } catch { /* ignore */ }
  }
});

/** The config-web base URL for a fork host. TLS cutover (owner 08-18): public hostnames ride the Caddy proxy on 443
 *  (LE cert), or the flag's explicit port; loopback/LAN-IP/.local dev forks keep the direct plain-HTTP :4310 - the ONLY
 *  plain-HTTP port the shell allows (owner 10-31, Sol r1), so a local host with any other port is '' (unavailable). */
export function configWebBaseFor(host: string): string {
  const portMatch = /:(\d+)$/.exec(host);
  const hostname = portMatch ? host.slice(0, -portMatch[0].length) : host;
  const local = isLocalForkHost(hostname) || /^(127\.|\[?::1)/i.test(hostname);
  if (local) {
    if (portMatch && Number(portMatch[1]) !== LOCAL_CONFIG_WEB_PORT) return '';
    return `http://${hostname}:${LOCAL_CONFIG_WEB_PORT}`;
  }
  return portMatch ? `https://${hostname}:${portMatch[1]}` : `https://${hostname}`;
}

/** Owner ruling 11-01 ("we cannot hide the address if it breaks bug reports"): where a bug report goes. The FORK
 *  edition: its config-web (botConfigBaseUrl, as before this branch). The PUBLIC build: always the config-web of the
 *  baked default host - with or without --fork-server, and even when the flag names a custom host (a tester's private
 *  fork does not receive public reports). */
export function bugReportBaseUrl(): string {
  return FORK_EDITION ? botConfigBaseUrl() : configWebBaseFor(FORK_SERVER_HOST);
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Tester-facing message for a failed config-web fetch (owner 08-17: the old raw
 *  "config-web unreachable at ..." string leaked jargon and, on a loopback host,
 *  named the tester's OWN machine with no hint their setting was the problem. */
export function configWebUnreachableMessage(baseUrl: string, detail: string): string {
  let host = '';
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    /* malformed baseUrl — fall through to the non-loopback message */
  }
  if (LOOPBACK_HOSTS.has(host)) {
    return `Can't reach the Super FUMBBL server — this app is pointing at your own computer (${baseUrl}). `
      + `If you're not running the server locally, clear the Fork server address in Settings → Connection to use `
      + `the default server, or enter the address your organiser gave you. (${detail})`;
  }
  return `Can't reach the Super FUMBBL server at ${baseUrl} — it may be offline, or check the Fork server `
    + `address in Settings → Connection. (${detail})`;
}

/** The fork-JNLP request URL for a one-click Launch: the Bot builds the JNLP (its buildForkJnlp)
 *  from these params and returns it, and the client opens it in-process (parseJnlp → join).
 *
 *  The credential rides PRE-HASHED (owner security ruling 08-17). It has to ride somehow — the
 *  returned JNLP is the FFB game-server join credential, which no session token can stand in for —
 *  but `ffb_coaches.password` IS md5(pw), so the digest is sufficient and the coach's clear-text
 *  password stops appearing in this query string, in the bot's access log, and in the .jnlp file
 *  itself. config-web dual-accepts `password` for one release. */
export function forkJnlpUrl(params: { coach: string; teamId: string; gameName: string; password: string }): string {
  const q = new URLSearchParams({
    coach: params.coach, teamId: params.teamId, gameName: params.gameName, passwordMd5: md5Hex(params.password),
  });
  // Sol r3: never a relative URL (the digest would go to the app origin).
  return `${requireForkBaseUrl(botConfigBaseUrl())}/api/fork/jnlp?${q.toString()}`;
}

/** The `/api/fork/register` URL for the Connection pane's "Register this coach on the fork" button.
 *  Registration SETS the password, so it is the one place the client must know the clear text — but
 *  it still sends only `passwordMd5`, because that is exactly the value the fork stores. Previously
 *  the chosen password went out in this query string, i.e. into every access and proxy log on the
 *  way (owner security ruling 08-17). */
export function forkRegisterUrl(params: { coach: string; password: string }): string {
  const q = new URLSearchParams({ coach: params.coach, passwordMd5: md5Hex(params.password) });
  return `${requireForkBaseUrl(botConfigBaseUrl())}/api/fork/register?${q.toString()}`;
}

/** The currently-selected backend preset (falls back to the first). The 'fork' target's
 *  URL is resolved dynamically from the effective fork host. */
export function activeServerTarget(): ServerTarget {
  const targets = serverTargets();
  const target = targets.find((t) => t.id === settings.activeServerTarget) ?? targets[0]!;
  return target.id === 'fork' ? { ...target, url: forkServerUrl() } : target;
}

/** Point the client at a preset backend: remembers the choice and derives
 *  url + compression from it. Auth is resolved per-join by resolveJoinCreds. */
export function applyServerTarget(id: string): void {
  publicForkTargetPending = false; // Sol r3: an explicit selection always beats a late launch-flag restore
  const target = serverTargets().find((t) => t.id === id);
  if (!target) return;
  settings.forkUrlCustom = false; // Sol r21: picking a target puts its preset url back
  const changed = settings.activeServerTarget !== target.id;
  settings.activeServerTarget = target.id;
  settings.url = target.id === 'fork' ? forkServerUrl() : target.url;
  settings.compression = target.compression;
  // Sol r18: listeners hear only a real target CHANGE (a same-target call - e.g. a spectator JNLP for the selected
  // target - must not rebase an open Settings snapshot, so Cancel still restores e.g. compression as on base).
  if (changed) {
    serverSwitchGeneration += 1; // Sol r19: a Cancel that started before this re-derives url / compression when it lands
    for (const listener of serverTargetSwitchListeners) listener();
  }
}

/** Sol r19: bumped on every real target change. A Settings Cancel captures it when it starts; if it moved by the time
 *  the Cancel applies its snapshot, url / compression are re-derived from the CURRENT target (realignServerConnection). */
let serverSwitchGeneration = 0;
export function serverSwitchGenerationNow(): number {
  return serverSwitchGeneration;
}

/** Sol r19: url + compression re-derived from the CURRENT activeServerTarget (the derivation applyServerTarget uses),
 *  without changing the target - only those two fields. */
export function realignServerConnection(): void {
  const target = serverTargets().find((t) => t.id === settings.activeServerTarget);
  if (!target) return;
  settings.url = target.id === 'fork' ? forkServerUrl() : target.url;
  settings.compression = target.compression;
  settings.forkUrlCustom = false; // Sol r22: a preset url was just installed
}

/** Sol r17/r18: told after an applyServerTarget() call that CHANGED the target (the Settings picker, a Discord spectate, a
 *  JNLP, Play flows). */
const serverTargetSwitchListeners = new Set<() => void>();
export function onServerTargetSwitch(listener: () => void): () => void {
  serverTargetSwitchListeners.add(listener);
  return () => { serverTargetSwitchListeners.delete(listener); };
}

/** Sol r17: rebase an open Settings snapshot (settingsTransactionSnapshot text) onto the CURRENT url / compression after a
 *  target switch, so a later Cancel restores the switched target's own connection - never the previous target's url.
 *  The target itself is outside the snapshot (base behaviour), so the switch is kept like a toggle. */
export function rebaseSettingsSnapshotConnection(snapshot: string, value: Pick<AppSettings, 'url' | 'compression' | 'forkUrlCustom'> = settings): string {
  try {
    const parsed = JSON.parse(snapshot) as Record<string, unknown>;
    if ('url' in parsed) parsed.url = value.url;
    if ('compression' in parsed) parsed.compression = value.compression;
    // Sol r22: the "typed fork url" flag travels with the url it describes (a switch installs a preset: false)
    if ('forkUrlCustom' in parsed) parsed.forkUrlCustom = value.forkUrlCustom;
    return JSON.stringify(parsed);
  } catch {
    return snapshot;
  }
}

/** Owner 2026-07-07 / 2026-07-21 (#102): set the fork-host override (`settings.forkHost`) - no rebuild needed. Empty
 *  string clears the override. No dedicated UI input yet (deferred). Owner 10-31: FORK edition only - the public
 *  build never writes settings.forkHost (nothing persisted). Sol r13: the run's fork host is FROZEN once the launch
 *  flags settle (forkAccess), so a change made after that takes effect on the NEXT launch; before it (start-up) the
 *  client re-points at once, as before. */
export function setForkHost(host: string): void {
  if (!FORK_EDITION) return;
  settings.forkHost = host.trim();
  if (forkHostFrozen()) {
    try { console.info('[settings] fork host override saved; restart Super FUMBBL to use it (this run keeps its fork host)'); } catch { /* ignore */ }
    return;
  }
  // Sol r21: a url the coach typed (forkUrlCustom) is never replaced by a host change; the preset follows the host.
  if (settings.activeServerTarget === 'fork' && !settings.forkUrlCustom) applyServerTarget('fork');
}

/** Sol r21 (FORK edition): the raw Server input changed `settings.url`. It is custom only when the fork is the target
 *  and the value differs from the derived preset; clearing it (or typing the preset) makes it the preset again. */
export function noteForkUrlEdited(): void {
  if (!FORK_EDITION) return;
  const typed = (settings.url || '').trim();
  settings.forkUrlCustom = settings.activeServerTarget === 'fork' && typed !== '' && typed !== forkServerUrl();
}

/** Owner 10-31: re-align the active target with fork availability. Runs when the launch flag resolves (the async
 *  `launch_flags` read lands after load()): a public run WITHOUT the flag is forced to FUMBBL; a run WITH it gets
 *  back the 'fork' target load() deferred, and a 'fork' target's url follows the effective host. */
export function reconcileForkTarget(): void {
  const available = forkFeaturesEnabled();
  if (settings.activeServerTarget === 'fork') {
    // Sol r20: the FORK edition's saved url (e.g. a custom raw Server url) is kept when the launch flags settle, as on base.
    if (available && !FORK_EDITION) settings.url = forkServerUrl();
    else if (!FORK_EDITION) applyServerTarget('fumbbl');
  } else if (!FORK_EDITION && settings.activeServerTarget !== 'fumbbl') {
    applyServerTarget('fumbbl');
  } else if (publicForkTargetPending && available && settings.activeServerTarget === 'fumbbl') {
    applyServerTarget('fork');
  }
  if (available || launchFlagsSettled.value) publicForkTargetPending = false;
}
watch([forkHostFromLaunch, launchFlagsSettled], reconcileForkTarget);

/** Resolve the coach/password a spectate join should send for the active
 *  target. standalone (our local server) falls back to the dev TestCoach when
 *  the user hasn't set creds; official FUMBBL uses the configured login. */
export function resolveJoinCreds(): { coach: string; password: string } {
  const target = activeServerTarget();
  if (target.auth === 'standalone') {
    // Super FUMBBL fork: use the FORK credentials; fall back to the dev TestCoach.
    if (settings.coach40k.trim()) return { coach: settings.coach40k, password: coachPassword40k() };
    return { coach: 'TestCoach', password: 'test' };
  }
  return { coach: settings.coach, password: settings.password };
}

/** Sol r15: the Super FUMBBL FORK account's saved credentials, whatever the active target - what every config-web
 *  (fork) request builder uses. Never the official FUMBBL account, and no dev fallback: empty when not configured, and
 *  the caller then asks for the fork credentials and sends nothing. */
export function forkAccountCreds(): { coach: string; password: string } {
  const coach = settings.coach40k.trim();
  return coach ? { coach, password: coachPassword40k() } : { coach: '', password: '' };
}

/** Build a spectator connection from the target already selected by the initiating blade. This is intentionally
 * side-effect free: the FUMBBL and Super FUMBBL row actions own target selection immediately before emitting. */
export function prepareSelectedSpectateConnection(): {
  url: string;
  compression: boolean;
  coach: string;
  password: string;
} {
  const target = activeServerTarget();
  return { url: target.url, compression: target.compression, ...resolveJoinCreds() };
}

/** Atomically prepare a live-list FUMBBL spectator join. This prevents a
 * persisted local/fork URL from leaking into the official match-list path. */
export function prepareOfficialSpectateConnection(): {
  url: string;
  compression: boolean;
  coach: string;
  password: string;
} {
  applyServerTarget('fumbbl');
  return prepareSelectedSpectateConnection();
}
