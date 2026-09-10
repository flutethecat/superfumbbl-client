import { reactive, watch } from 'vue';
import type { EdgePanelPosition } from './edgePanelLayout';
import { md5Hex } from '@fumbbl40k/ffb-protocol';
import { normalizeLegalAcceptanceVersion } from './legalNotice';

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
const SETTINGS_VERSION = 31; // v31: uniform figure scale is per orientation (E-W on by default)

/** Load-path health (P1 08-18: blank credentials). notices non-empty = a degraded settings read
 *  happened this session; loadedFromDefaults = BOTH blob and backup were unreadable, and the
 *  persist watcher is guarded (see persistSettings) so defaults can never overwrite a good blob. */
export const settingsHealth = reactive({ loadedFromDefaults: false, notices: [] as string[] });

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

/** Owner 2026-07-21 (#102): the Super FUMBBL FORK server HOST — a DDNS hostname, single source. Distributed/tester
 *  builds must always reach the fork here; the connection (settings.url) + config-web (:4310) resolve to this.
 *  DDNS (superfumbbltest.duckdns.org) tracks the fork host's dynamic ISP IP, so an IP change needs NO rebuild —
 *  this replaces the old hardcoded raw IP that broke every distributed build when the ISP reassigned it (#102).
 *  An explicit `settings.forkHost` (empty by default) overrides the game WS at runtime (belt-and-braces).
 *  (Local dev uses the separate 'local' SERVER_TARGET = localhost.) */
export const FORK_SERVER_HOST = 'superfumbbltest.duckdns.org';
export const FORK_WS_URL = `ws://${FORK_SERVER_HOST}:22227/command`;

export interface AppSettings {
  // hotkeys (KeyboardEvent.code values)
  confirmKey: string;
  /** Owner 09-05: WASD camera glide speed, screen px per frame (2-30, 9 = original). */
  cameraPanSpeed: number;
  // markings
  tackleZoneMode: 'off' | 'opposition' | 'friendly' | 'both';
  showDefaultSkills: boolean;
  showPositionRings: boolean;
  /** Owner 2026-07-08: persistently show the block-dice preview (count over each
   *  adjacent opponent's head) for the selected/active player. */
  showBlockDice: boolean;
  /** FUMBBL auto-marking config JSON (UI-6); '' = markings off. */
  markingsConfig: string;
  /** B2-17: skill icons and skill markings are mutually exclusive. */
  skillDisplay: 'icons' | 'markings';
  /** On-pitch skill-marking typography. Markings stay one line; these settings
   *  tune the shared Modern/Classic Pixi label without changing its contents. */
  skillMarkingColor: string;
  skillMarkingFont: 'arial' | 'helvetica' | 'system' | 'nuffle';
  skillMarkingSize: number;
  /** One-shot legacy BB2/BB3 migration hint; installed-pack identity owns rendering. */
  skillIconStyle: 'bb3' | 'bb2';
  /** Owner 09-09: which BUNDLED skill-badge family serves when no pack is assigned to the skill-icon slot —
   *  'default' = the flat badges ("Built-in default"), 'illustrated' = the illustrated set ("Illustrated - Default"). */
  skillBadgeFamily: 'default' | 'illustrated';
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
   *  EMPTY by default → the client uses the baked DDNS FORK_SERVER_HOST. A non-empty value re-points the fork
   *  to `ws://<forkHost>:22227/command` (+ `http://<forkHost>:4310`) at runtime with no rebuild — belt-and-braces
   *  for a future address change. Empty-default so a stale value can never misdirect distributed builds. */
  forkHost: string;
  /** Owner 2026-07-08: base URL of the Tournament Bot's config-web server, which exposes the
   *  fork-JNLP endpoint (`/api/fork/jnlp`) used for one-click "Launch" joins. Empty = derive
   *  `http://<forkHost>:4310` (the Bot runs on the fork host). Editable so it can point elsewhere. */
  botConfigUrl: string;
  // video (F-2): renderScale 1 = 100% default; 0 remains the explicit Auto option. FPS is always bounded.
  renderScale: number;
  fpsCap: number;
  /** Owner 08-19: stadium bowl on/off (Modern; Classic forces off via its preset). */
  showStadium: boolean;
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
  logFontSize: number;
  logFont: 'nuffle' | 'arial' | 'mono';
  /** Display-only match-log preference. Internal plan/play sequencing remains stored
   *  for bug reports and developer diagnostics when hidden. */
  showServerSequencingEvents: boolean;
  logPos: EdgePanelPosition | null;
  logSize: { w: number; h: number } | null;
  /** Floating setup-template browser geometry. Null keeps the compact responsive default. */
  setupBrowserPos: EdgePanelPosition | null;
  setupBrowserSize: { w: number; h: number } | null;
  /** Owner 2026-07-08: swap the bottom bars — Quick bar to the bottom-RIGHT, Log to
   *  the bottom-LEFT (Log leads, matching left-to-right reading). Default true. */
  bottomBarsSwapped: boolean;
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
  spriteSet: 'classic' | 'checkers' | 'walk';
  walkAnimation: boolean;
  walkFps: number | null;
  /** Owner 2026-09-04: idle walkers face the camera (south) instead of their end-zone forward. */
  walkFaceCamera: boolean;
  /** Owner 09-06: fake-sun cast shadow under each standing walker (prototype; default on). */
  castShadows: boolean;
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
  /** B5-2: spectator-clean — hide planner + dice previews while spectating. */
  spectatorClean: boolean;
  /** B6-4: when cinematic injury playback fires.
   *  'armor-break' (default) = every armor break; 'casualty' = casualties
   *  only; 'off' = never (splash still shows). */
  /** Owner 08-19: RETIRED (zero consumers — dead since the injury-banner rework); field kept
   *  out of the UI; type retained so old persisted blobs still parse. */
  cinematicMode: 'armor-break' | 'casualty' | 'off';
  /** B8-8: pitch orientation. 'ns' (default) = end zones top/bottom;
   *  'ew' = end zones left/right (the projection rotated 90°). */
  pitchOrientation: 'ns' | 'ew';
  /** ORDER 66 (A.2): route play-mode interaction through the ported state machine (deriveClientState →
   *  action menu + click-per-square move) instead of the hotbar/planner. Off = legacy path untouched. */
  order66: boolean;
  /** Blitz declaration entry gesture. FUMBBL keeps context-menu-first declaration;
   *  Modern enables the friendly-player → opponent two-click planner. */
  declareBlitzBehavior: 'modern' | 'fumbbl';
  /** Clicking another friendly during a declared movement rail refunds or ends the current activation. */
  friendlyPlayerSwitch: boolean;
  /** Friendly player left-clicks show their legal action menu instead of auto-declaring Move. */
  leftClickOpensContextMenu: boolean;
  /** Owner 2026-07-10: DEVELOPER mode — unlocked by the `-dev` exe arg / `?dev`. Gates the
   *  Settings → Developer section + the live Developer log panel. */
  devMode: boolean;
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
  /** Red-green colourblind mode: remaps confusable green UI accents to blue. */
  colorblindMode: 'off' | 'redgreen';
  /** UI theme engine (owner 2026-07-14, spec black-red-ui-scheme.md): a preset or a custom Primary/Secondary
   *  pair drives the derived `--ui-*` token set (Settings → Accessibility). Default = the Black/Red headline. */
  uiTheme: 'brand-red' | 'fumbbl' | 'custom';
  uiPrimary: string;
  uiSecondary: string;
  /** Show the on-pitch row-number markers (2/4/6/8/10/12). */
  showRowMarkers: boolean;
  /** Show the midfield sweet-spot crosshair markers. */
  showSweetSpot: boolean;
  /** Show the faded on-field team logos at the sweet spots. */
  showFieldLogos: boolean;
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
  /** Visual treatment for every D6 surface. Brushed metal is the install default;
   *  the original black set remains available as a local presentation choice. */
  d6FaceVariant: 'brushed-metal' | 'black';
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
  stunDisplay: 'banner' | 'tag';
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
  /** Skip the welcome splash on launch (Settings toggle). */
  hideWelcomeSplash: boolean;
  /** Owner 08-18: "Skip this next time" on the account-setup splash. */
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
  /** Owner 2026-07-08 (FC): UI presentation fork. 'fumbbl40k' (default) = the
   *  current UI; 'classic' = the FUMBBL-Classic view (docs/fumbbl-classic-mode-plan.md).
   *  A VIEW-layer switch only — the store/protocol/settings/assets are shared. */
  uiMode: 'fumbbl40k' | 'classic';
  /** Modern/Order66 HUD shell. Minimalist preserves the compact first-pass panels;
   *  chrome adds the molded console treatment without changing controls or layout. */
  modernHudStyle: 'chrome' | 'minimalist';
  /** Owner 2026-07-08 (FC-D3): FUMBBL Classic is EFFECTS-OFF by default (pure
   *  classic look). Opt-IN wires our cinematics (push arrows, turnover…) into the
   *  classic view. Only consulted when uiMode==='classic'. */
  classicEffects: boolean;
  /** Local-only saved-setup previews. The upstream list wire carries names, not coordinates. */
  savedSetupPreviews: Record<string, Record<string, {
    playerNumbers: number[];
    playerCoordinates: [number, number][];
  }>>;
  /** Owner 2026-07-05: persisted-settings schema version. Bumped when a default
   *  change should be FORCED onto existing installs (see `load()` migrations). */
  settingsVersion: number;
}

/** Where a skill icon/marker draws relative to the player token. */
export type SkillRenderPosition = 'head' | 'feet';

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
}

const DEFAULTS: AppSettings = {
  confirmKey: 'Space', // owner 2026-07-02: Space confirms queued moves
  cameraPanSpeed: 9,
  tackleZoneMode: 'opposition',
  showDefaultSkills: false,
  showPositionRings: true,
  showBlockDice: false,
  markingsConfig: '',
  skillDisplay: 'icons',
  skillMarkingColor: '#f5c542',
  skillMarkingFont: 'arial',
  skillMarkingSize: 12,
  skillIconStyle: 'bb3',
  skillBadgeFamily: 'default',
  skillIconPackInstallId: null,
  assetPackAssignments: { skillIcons: '', playerSprites: '', walkSheets: '', soundEvents: '', teamLogos: '', blockDice: '' },
  url: FORK_WS_URL, // owner 2026-07-13: match the default target ('fork' below) — was ws://fumbbl.com (a fresh install then connected to FUMBBL, not the fork). RC/public builds set BOTH this + activeServerTarget to fumbbl.
  coach: '',
  password: '',
  coach40k: '',
  compression: true,
  // Owner 2026-07-07: TEST builds default to the FORK server. ⚠ RC/public builds MUST ship this
  // 'fumbbl' (see docs/release-checklist.md). Only affects fresh installs; a user's pick wins.
  activeServerTarget: 'fork',
  forkHost: '', // #102: empty → use the baked DDNS FORK_SERVER_HOST; a non-empty value overrides the fork host (game WS + config-web) at runtime, no rebuild
  botConfigUrl: '', // empty → derive http://<forkHost>:4310 (Tournament Bot config-web / fork-JNLP endpoint)
  renderScale: 0, // owner 09-05: Auto (= devicePixelRatio) — a 1x canvas upscaled on a hi-DPI screen read soft everywhere
  uiCustomize: false,
  uiLayout: {},
  fpsCap: 60,
  showStadium: true,
  brightness: 100,
  soundVolume: 20,
  soundStyles: {},
  logOpacity: 0.79,
  logFontSize: 15, // owner 2026-07-08: larger default Log/Chat/Roster text (was 11.5)
  logFont: 'arial', // owner 09-06: Arial default (was 'nuffle')
  showServerSequencingEvents: false,
  logPos: null,
  bottomBarsSwapped: true, // owner 2026-07-08: Log bottom-left, Quick bar bottom-right (default)
  logSize: null,
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
  uniformFigures: false, // owner 09-10: N-S OFF by default (classic depth scaling); was on 09-09
  uniformFiguresEw: true, // owner 09-10: E-W on by default, independent
  actionDecorations: 'art', // owner 09-06: artwork by default; emoji kept as the Appearance option
  moveSpeedMs: 150,
  blockTumbleMs: 250,
  blockDice3d: true,
  trailColor: 'auto',
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
  spectatorClean: false,
  cinematicMode: 'armor-break',
  pitchOrientation: 'ns',
  // Owner 2026-07-10: DEVELOPER mode — unlocked by the `-dev` exe arg (or `?dev` URL query). Gates the
  // Settings → Developer section + the live Developer log panel (client `log()` fires incl. the block/
  // action drop-watchdog + the server-side/client-side wire traffic). NOT persisted-on by default; a
  // stored `true` from a prior `-dev` launch still opens it (owner can toggle off). devWireCapture feeds
  // the meaningful wire events (reports/dialogs/turnMode + all outbound commands) into the dev log.
  order66: true, // owner 2026-07-13: the 0.3.0 release IS the ORDER 66 port — ON by default (was dev-only default-off). Legacy path only via the toggle (devMode).
  declareBlitzBehavior: 'fumbbl',
  friendlyPlayerSwitch: true,
  leftClickOpensContextMenu: false,
  devMode: false,
  devPanelOpen: false,
  devWireCapture: true,
  debugLog: false,
  // Owner 2026-07-07: DEFAULT ON for TEST builds (gather live wire data for validation).
  // ⚠ RELEASE CANDIDATES / public releases MUST ship this false — flip it back before an RC
  // build (see docs/release-checklist.md). Only affects fresh installs; a user's stored choice wins.
  wireLog: true,
  autoDirector: true,
  clickDismissCinematics: false,
  playAuthToken: '',
  requirePlayAuthToken: false, // owner 2026-07-04: play auth is server-determined now (token UI deprecated)
  turf: 'pixel-weather', // Owner 09-05: the Pixel weather family (sprite-style, ref set) is the install default.
  hudCoachOpacity: 0.9,
  hudScoreboardOpacity: 0.9,
  hudQuickBarOpacity: 0.9,
  hudToastOpacity: 0.92,
  gridLines: true,
  gridLineWidth: 0.5, // owner 09-05: default 1 -> 0.5
  gridLineColor: '#e8e4d8',
  gridLineOpacity: 1,
  markColor: '#e03030', // owner 2026-07-04f: pitch markings default red
  colorblindMode: 'off',
  uiTheme: 'brand-red',
  uiPrimary: '#A10005',
  uiSecondary: '#000000',
  showRowMarkers: true,
  showSweetSpot: true,
  showFieldLogos: true,
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
  d6FaceVariant: 'brushed-metal',
  auraDisturbingPresence: 'selected',
  auraPickMeUp: 'selected',
  stunDisplay: 'banner',
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
  modernHudStyle: 'chrome',
  classicEffects: false, // owner 2026-07-08 (FC-D3): classic is effects-off by default
  savedSetupPreviews: {},
  completedFirstRun: false,
  legalAcceptanceVersion: 0,
  contributionsSeenVersion: 0,
  hideCredsSplash: false, // owner 08-18: opt-out checkbox on the setup splash
  hideWelcomeSplash: true, // owner 2026-07-04: welcome splash deprecated at launch (still in the build; re-enable via Settings → Connection / "Replay the intro screens")
  hideTutorialSplash: true, // owner 2026-07-14: getting-started tour off by default too (needs revising; re-enable via Settings → Connection / "Replay the intro screens")
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

/** Human-readable, provider-neutral turf labels for the Settings picker. */
export const TURF_LABELS: Record<string, string> = {
  'default-weather': 'Default - Weather pack',
  'pixel-weather': 'Pixel - Weather pack',
  'acasas-weather': 'Acasas - Weather pack', // installer-only family; absent from public checkouts
  'acasas-weather-fx': 'Acasas - Weather pack (strong)', // owner 09-07: stronger sunny/heat/blizzard language; installer-only
  grass1: 'Basic', // owner 09-05: renamed from 'Grass 1' (the Acasas 64 px leafy tile)
  grass2: 'Grass 2',
  // #56 WT-7 (owner/Yularen 07-16): every FUMBBL pack is weather-responsive (swaps the field photo with
  // fieldModel.weather) — the "(weather)" suffix flags that behaviour vs the static grass tile themes.
  'fumbbl-basic': 'Basic (weather)',
  'fumbbl-default': 'Default (weather)',
  'fumbbl-blackbox': 'Blackbox (weather)',
  'fumbbl-fumbblcup': 'Cup (weather)',
  'fumbbl-chaos': 'Chaos (weather)',
  'fumbbl-darkelf': 'Dark Elf (weather)',
  'fumbbl-goblin': 'Goblin (weather)',
  'fumbbl-khorne': 'Khorne (weather)',
  'fumbbl-necromantic': 'Necromantic (weather)',
  'fumbbl-norse': 'Norse (weather)',
  'fumbbl-nurgle': 'Nurgle (weather)',
  'fumbbl-skaven': 'Skaven (weather)',
  'fumbbl-slaanesh': 'Slaanesh (weather)',
  'fumbbl-tzeentch': 'Tzeentch (weather)',
  'fumbbl-vampire': 'Vampire (weather)',
};

/** Available turf themes for the Settings picker. Populated at runtime from
 *  `renderer.turfOptions()` on mount (SpectateView) so the picker always mirrors
 *  what the renderer actually has loaded. */
export const turfCatalog = reactive<{ options: string[] }>({ options: ['default-weather', 'pixel-weather'] });

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
      localStorage.setItem(key, JSON.stringify(raw));
    } catch { /* ignore */ }
  }
}

/** Drop the legacy clear-text fork password from the stored blob. Called ONLY after the OS
 *  credential store has confirmed the write — a failed keychain must not lose the password. */
export function purgeStoredPassword40k(): void {
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
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(raw));
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
    const rawConfiguredSounds = raw.configuredSoundOverrides;
    const rawSprites = raw.spriteOverrides;
    const rawLogos = raw.logoOverrides;
    delete raw.configuredSoundOverrides;
    delete raw.spriteOverrides;
    delete raw.logoOverrides;
    // v15 retired the opt-in classic state-marker artwork. Strip the legacy key
    // before merging so old settings cannot keep feeding or re-persisting it.
    delete raw.stateMarkerStyle;
    const merged: AppSettings = { ...DEFAULTS, ...raw };
    const opacity = (value: unknown, fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value)
        ? Math.min(1, Math.max(0.2, value))
        : fallback;
    merged.hudCoachOpacity = opacity(merged.hudCoachOpacity, DEFAULTS.hudCoachOpacity);
    merged.hudScoreboardOpacity = opacity(merged.hudScoreboardOpacity, DEFAULTS.hudScoreboardOpacity);
    merged.hudQuickBarOpacity = opacity(merged.hudQuickBarOpacity, DEFAULTS.hudQuickBarOpacity);
    merged.hudToastOpacity = opacity(merged.hudToastOpacity, DEFAULTS.hudToastOpacity);
    merged.modernHudStyle = raw.modernHudStyle === 'minimalist' ? 'minimalist' : 'chrome';
    // Current-version blobs bypass migrations, so malformed video values must be
    // normalized independently. Only choices exposed by Settings are accepted;
    // legacy uncapped FPS (0), strings, NaN-like values and arbitrary scales fall
    // back to the safe install defaults.
    const videoChoice = (value: unknown, allowed: readonly number[], fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value) && allowed.includes(value) ? value : fallback;
    merged.renderScale = videoChoice(merged.renderScale, [0, 0.5, 0.75, 1, 1.5, 2, 3, 4], DEFAULTS.renderScale); // owner 09-05: 300/400% added
    merged.fpsCap = videoChoice(merged.fpsCap, [30, 60, 120], DEFAULTS.fpsCap);
    merged.soundStyles = raw.soundStyles && typeof raw.soundStyles === 'object' && !Array.isArray(raw.soundStyles)
      ? Object.fromEntries(Object.entries(raw.soundStyles).filter(([key, value]) => key.length > 0 && typeof value === 'string'))
      : { ...DEFAULTS.soundStyles };
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
    merged.spriteSet = ['classic', 'checkers', 'walk'].includes(String(raw.spriteSet))
      ? raw.spriteSet as AppSettings['spriteSet']
      : DEFAULTS.spriteSet;
    merged.walkAnimation = typeof raw.walkAnimation === 'boolean' ? raw.walkAnimation : DEFAULTS.walkAnimation;
    merged.walkFaceCamera = typeof raw.walkFaceCamera === 'boolean' ? raw.walkFaceCamera : DEFAULTS.walkFaceCamera;
    merged.castShadows = typeof raw.castShadows === 'boolean' ? raw.castShadows : DEFAULTS.castShadows;
    merged.uniformFigures = typeof raw.uniformFigures === 'boolean' ? raw.uniformFigures : DEFAULTS.uniformFigures;
    merged.uniformFiguresEw = typeof raw.uniformFiguresEw === 'boolean' ? raw.uniformFiguresEw : DEFAULTS.uniformFiguresEw;
    merged.blockDice3d = raw.blockDice3d !== false;
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
    merged.skillMarkingFont = ['arial', 'helvetica', 'system', 'nuffle'].includes(String(raw.skillMarkingFont))
      ? raw.skillMarkingFont as AppSettings['skillMarkingFont']
      : DEFAULTS.skillMarkingFont;
    merged.legalAcceptanceVersion = normalizeLegalAcceptanceVersion(raw.legalAcceptanceVersion);
    merged.contributionsSeenVersion = typeof raw.contributionsSeenVersion === 'number' && Number.isSafeInteger(raw.contributionsSeenVersion) && raw.contributionsSeenVersion >= 0
      ? raw.contributionsSeenVersion
      : DEFAULTS.contributionsSeenVersion;
    merged.tackleZoneMode = ['off', 'opposition', 'friendly', 'both'].includes(String(raw.tackleZoneMode))
      ? raw.tackleZoneMode as AppSettings['tackleZoneMode']
      : DEFAULTS.tackleZoneMode;
    merged.d6FaceVariant = raw.d6FaceVariant === 'black' ? 'black' : 'brushed-metal';
    // Local presentation override only. Malformed/older blobs retain upstream variants.
    merged.oneSpritePerPosition = raw.oneSpritePerPosition === true;
    // Keychain move: password40k is no longer a settings field. Lift any stored copy out of the
    // merged object so the deep watcher below never writes it back, and hand it to credentials.ts.
    const storedPw = (raw as { password40k?: unknown }).password40k;
    legacyPassword40k = typeof storedPw === 'string' ? storedPw : '';
    delete (merged as { password40k?: unknown }).password40k;
    // fail-closed: a non-boolean/corrupted stored value resolves to the default (chat enabled).
    merged.chatDisabled = raw.chatDisabled === true;
    // Fail closed to the quiet match log for fresh, older, or corrupted settings blobs.
    merged.showServerSequencingEvents = raw.showServerSequencingEvents === true;
    // Only an explicit false disables the default cursor theme. Older or malformed
    // settings keep the Spike presentation enabled.
    merged.useFantasyCursor = raw.useFantasyCursor !== false;
    // fail-closed: pop-out resolves to DOCKED unless the stored value is literally true.
    merged.chatPoppedOut = raw.chatPoppedOut === true;
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
    merged.skillBadgeFamily = raw.skillBadgeFamily === 'illustrated' ? 'illustrated' : 'default'; // owner 09-09
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
    merged.declareBlitzBehavior = raw.declareBlitzBehavior === 'modern' ? 'modern' : 'fumbbl';
    merged.friendlyPlayerSwitch = raw.friendlyPlayerSwitch !== false;
    merged.leftClickOpensContextMenu = raw.leftClickOpensContextMenu === true;
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
    // v8 (owner 2026-07-21, #102): the fork address moved from a hardcoded raw IP to the baked DDNS
    // FORK_SERVER_HOST, and settings.forkHost became an OPTIONAL empty-default override (game WS + config-web).
    // Existing installs persist TWO stale copies of the old fork IP ('75.172.13.17'): (a) forkHost, and (b) url
    // (DEFAULTS.url was the old FORK_WS_URL, kept by the {...DEFAULTS,...raw} merge). BOTH must be refreshed or
    // already-installed testers keep dialing the dead IP: (a) the play-join override path, and — Meero FR-1 — (b)
    // SPECTATE, whose connect() dials the RAW settings.url (SpectateView:4325 / ClassicView:1223, not forkServerUrl).
    // CLEAR forkHost; and for a FORK install reset url to the baked DDNS FORK_WS_URL (non-fork targets — fumbbl/
    // local — keep their deliberate url). Load-bearing: without BOTH resets the fix doesn't reach existing installs.
    if ((raw.settingsVersion ?? 0) < 8) {
      merged.forkHost = '';
      if (merged.activeServerTarget === 'fork') merged.url = FORK_WS_URL;
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
    // stamp any migration immediately so it runs ONCE (not every launch) and a
    // later user change to these keys sticks. rawText===null means NO blob was readable — a
    // fresh install needs no migration, and a transiently-null read of an EXISTING blob must
    // not let this stamp write DEFAULTS over it (the no-exception variant of the P1 wipe).
    if (stampToLocalStorage && rawText !== null && (raw.settingsVersion ?? 0) < SETTINGS_VERSION
      && !v26UserOverrideMigrationPending) {
      // Keep the legacy clear-text password in the blob until credentials.ts confirms the keychain
      // write — a migration stamp must not be the thing that loses it.
      const stamped = legacyPassword40k ? { ...merged, password40k: legacyPassword40k } : merged;
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
      try { localStorage.setItem(BACKUP_KEY, rawText); } catch { /* ignore */ }
      return loaded;
    } catch (e) {
      noteSettingsIssue(`settings blob corrupt (${(e as Error)?.message ?? String(e)}) — trying last-good backup`);
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
      try { localStorage.setItem(SETTINGS_KEY, bakText); } catch { /* ignore */ }
      const loaded = hydrate(bakText);
      diskAuthority = true;
      noteSettingsIssue('settings restored from last-good backup');
      return loaded;
    } catch {
      noteSettingsIssue('backup blob corrupt too');
    }
  }
  // Genuine fresh install: nothing stored anywhere and the store itself is healthy.
  if (!readFailed && rawText === null && bakText === null) return hydrate(null);
  // Nothing readable. Run on DEFAULTS, but the persist watcher is GUARDED (persistSettings):
  // defaults must never overwrite a blob that reads fine later — the one-bad-read wipe.
  settingsHealth.loadedFromDefaults = true;
  noteSettingsIssue('settings unrecoverable this session — running on DEFAULTS; persisting is guarded');
  return { ...DEFAULTS };
}

export const settings = reactive<AppSettings>(load());

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
    try {
      JSON.parse(raw);
      return false;
    } catch {
      try { localStorage.setItem(CORRUPT_KEY, raw); } catch { /* ignore */ }
      return true;
    }
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
    const payload = { ...value } as Record<string, unknown>;
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
/** The recovery file may only be deleted after its cleartext password CONFIRMS in the keychain
 *  (purgeStoredPassword40k is that signal — the f983443c pattern). */
let recoveryPendingPurge = false;

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
  return JSON.stringify(stripSecretFields(JSON.parse(JSON.stringify(value)) as Record<string, unknown>), null, 2);
}

/** Ordered, result-visible settings_save. The chain keeps concurrent saves in write order. */
function fileWrite(contents: string, refreshBackup: boolean): Promise<void> {
  const next = fileWriteChain
    .catch(() => { /* earlier failure already noticed */ })
    .then(() => invokeTauri<void>('settings_save', { contents, refreshBackup }));
  fileWriteChain = next.catch(() => { /* keep the chain alive */ });
  return next;
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
    try {
      adoptLoaded(hydrate(text, false));
      fileMode = true;
      diskAuthority = true;
      // Refresh the .bak ONLY from a blob that just parsed + hydrated clean (9f9eddbb doctrine);
      // this same write heals a primary that was recovered from the backup.
      if (!v26UserOverrideMigrationPending) {
        void fileWrite(serializeSettingsForFile(settings), true).catch(() => { /* noticed on next save */ });
      }
      if (source !== 'file') noteSettingsIssue('settings restored from file backup');
      return;
    } catch (e) {
      noteSettingsIssue(`settings ${source} corrupt (${(e as Error)?.message ?? String(e)})`);
      // Park, never destroy: the unreadable bytes survive for diagnosis before anything overwrites.
      if (source === 'file') { try { localStorage.setItem(CORRUPT_KEY, text); } catch { /* ignore */ } }
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
      await fileWrite(serializeSettingsForFile(settings), true);
      fileMode = true;
      retireLocalStorageBlob();
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
      diskAuthority = true;
      if (v26UserOverrideMigrationPending) {
        v26DeferredFileAdoption = true;
        v26DeferredRecoveryAdoption = true;
        return;
      }
      await fileWrite(serializeSettingsForFile(settings), true);
      fileMode = true;
      if (legacyPassword40k) recoveryPendingPurge = true; // deleted once the keychain confirms
      else void invokeTauri('settings_purge_recovery').catch(() => { /* retried next boot */ });
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

async function persistToFile(propagateFailure = false): Promise<void> {
  if (v26UserOverrideMigrationPending) return;
  const payload = JSON.parse(serializeSettingsForFile(settings)) as Record<string, unknown>;
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
  try {
    await fileWrite(JSON.stringify(payload, null, 2), false);
  } catch (e) {
    noteSettingsIssue(`settings file write failed (${(e as Error)?.message ?? String(e)})`);
    if (propagateFailure) throw e;
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
      await fileWrite(serializeSettingsForFile(settings), true);
      fileMode = true;
      retireLocalStorageBlob();
      if (v26DeferredRecoveryAdoption) {
        if (legacyPassword40k) recoveryPendingPurge = true;
        else void invokeTauri('settings_purge_recovery').catch(() => { /* retried next boot */ });
      }
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
export function keyLabel(code: string): string {
  if (code === 'Space') return '␣ Space';
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

/** Match/API origin only. Media CDN requests are deliberately disabled. */
export const FUMBBL_SITE = import.meta.env.DEV ? '/fumbbl-site' : 'https://fumbbl.com';

/** The backend presets the launch picker offers. The hosted public server
 *  (self-host-plan §1 row 3) is added once a host exists. */
export const SERVER_TARGETS: ServerTarget[] = [
  { id: 'fumbbl', label: 'Official FUMBBL', url: 'ws://fumbbl.com:22223/command', auth: 'fumbbl', compression: true },
  { id: 'local', label: 'Super FUMBBL — local dev', url: 'ws://localhost:22227/command', auth: 'standalone', compression: true },
  // Owner 2026-07-07: the FORK server (external IPv4). TEST builds default to this (see the
  // activeServerTarget default below); RC/public builds default to 'fumbbl' (docs/release-checklist.md).
  { id: 'fork', label: `Super FUMBBL — fork (${FORK_SERVER_HOST})`, url: FORK_WS_URL, auth: 'standalone', compression: true },
];

/** The FORK server's ws URL. Owner 2026-07-21 (#102): resolves to the baked DDNS FORK_SERVER_HOST by default;
 *  an explicit `settings.forkHost` (empty by default) overrides it at runtime — belt-and-braces for a future
 *  address change with no rebuild. Empty-default means a stale persisted value can't misdirect distributed
 *  builds (the v8 migration clears the old baked IP). Local dev uses the separate 'local' target. */
export function forkServerUrl(): string {
  const override = (settings.forkHost || '').trim();
  return override ? `ws://${override}:22227/command` : FORK_WS_URL;
}

/** Owner 2026-07-08: the Tournament Bot config-web base URL (fork-JNLP / team-builder endpoint host). Owner
 *  2026-07-21 (#102): derives from the same effective fork host as the game WS — the empty-default
 *  `settings.forkHost` override (below) covers BOTH surfaces, else DDNS FORK_SERVER_HOST. An explicit
 *  `settings.botConfigUrl` still wins (full-URL escape hatch to point config-web elsewhere entirely, empty by
 *  default). Trailing slash trimmed. */
export function botConfigBaseUrl(): string {
  const explicit = (settings.botConfigUrl || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const host = (settings.forkHost || '').trim() || FORK_SERVER_HOST;
  // TLS cutover (owner 08-18): public hostnames ride the Caddy proxy on 443 (LE cert);
  // loopback/LAN-IP/.local dev forks keep the direct plain-HTTP :4310.
  const local = /^(localhost|127\.|\[?::1|(\d{1,3}\.){3}\d{1,3}$)/i.test(host) || /\.local$/i.test(host);
  return local ? `http://${host}:4310` : `https://${host}`;
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
  return `${botConfigBaseUrl()}/api/fork/jnlp?${q.toString()}`;
}

/** The `/api/fork/register` URL for the Connection pane's "Register this coach on the fork" button.
 *  Registration SETS the password, so it is the one place the client must know the clear text — but
 *  it still sends only `passwordMd5`, because that is exactly the value the fork stores. Previously
 *  the chosen password went out in this query string, i.e. into every access and proxy log on the
 *  way (owner security ruling 08-17). */
export function forkRegisterUrl(params: { coach: string; password: string }): string {
  const q = new URLSearchParams({ coach: params.coach, passwordMd5: md5Hex(params.password) });
  return `${botConfigBaseUrl()}/api/fork/register?${q.toString()}`;
}

/** The currently-selected backend preset (falls back to the first). The 'fork' target's
 *  URL is resolved dynamically from settings.forkHost. */
export function activeServerTarget(): ServerTarget {
  const target = SERVER_TARGETS.find((t) => t.id === settings.activeServerTarget) ?? SERVER_TARGETS[0]!;
  return target.id === 'fork' ? { ...target, url: forkServerUrl() } : target;
}

/** Point the client at a preset backend: remembers the choice and derives
 *  url + compression from it. Auth is resolved per-join by resolveJoinCreds. */
export function applyServerTarget(id: string): void {
  const target = SERVER_TARGETS.find((t) => t.id === id);
  if (!target) return;
  settings.activeServerTarget = target.id;
  settings.url = target.id === 'fork' ? forkServerUrl() : target.url;
  settings.compression = target.compression;
}

/** Owner 2026-07-07 / 2026-07-21 (#102): set the fork-host override (`settings.forkHost`) and re-point the client
 *  immediately if the fork is the active target — a changed fork address takes effect with no rebuild. Empty
 *  string clears the override (back to the baked DDNS FORK_SERVER_HOST). No dedicated UI input yet (deferred). */
export function setForkHost(host: string): void {
  settings.forkHost = host.trim();
  if (settings.activeServerTarget === 'fork') applyServerTarget('fork');
}

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
