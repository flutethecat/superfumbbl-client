<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, watchEffect } from 'vue';
import SpectateView from './views/SpectateView.vue';
import ClassicView from './views/ClassicView.vue';
import ProtocolConsole from './views/ProtocolConsole.vue';
import DevPanel from './views/DevPanel.vue';
import PlayView from './views/console/PlayView.vue';
import TeamBuilderView from './views/console/TeamBuilderView.vue';
import TournamentsView from './views/console/TournamentsView.vue';
import StatisticsView from './views/console/StatisticsView.vue';
import SpectateBrowserView from './views/console/SpectateBrowserView.vue';
import RejoinProgressModal from './views/console/play/RejoinProgressModal.vue';
import ReplayLauncherView from './views/ReplayLauncherView.vue';
import AssetPackSettings from './components/AssetPackSettings.vue';
import AccountSettings from './components/AccountSettings.vue';
import FirstOpenLegalNotice from './components/FirstOpenLegalNotice.vue';
import FirstOpenContributions from './components/FirstOpenContributions.vue';
import SettingsCategoryNav from './components/SettingsCategoryNav.vue';
import FieldManual from './components/FieldManual.vue';
import { detectDevMode } from './game/devMode';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { botConfigBaseUrl, flushSettingsFile, forkRegisterUrl, FUMBBL_SITE, keyLabel, settings, resolveJoinCreds, prepareSelectedSpectateConnection, turfCatalog, TURF_LABELS, iconBehaviourDefault, MARKER_BEHAVIOUR_DEFAULT, type SkillBehaviour } from './game/settings';
import { coachPassword, coachPasswordModel, credentialStore, flushCoachPassword, setCoachPassword } from './game/credentials';
import { clearConfigWebToken } from './game/configWebAuth';
import {
  IDLE as CHALLENGE_IDLE,
  fumbblCheckingMessage,
  forkCheckingMessage,
  isChecking,
  runForkChallenge,
  runFumbblChallenge,
  type ChallengeState,
} from './game/authChallenge';
import { ui } from './game/ui';
import { gameStore } from './game/store';
import {
  ambiguousJnlpEntry,
  cancelAmbiguousJnlpEntry,
  jnlpEntryError,
  readJnlpFile,
  resolveAmbiguousJnlpEntry,
  routeJnlpRequest,
  useNativeJnlpIntake,
  type JnlpRouteResult,
} from './game/jnlpRouting';
import {
  classifyReplayFileContent,
  sharedReplayFileImporter,
  type ReplayFileImportTicket,
} from './game/replay/replayFileImport';
import { applyTheme, deriveTheme, resolveThemeColors, THEME_PRESETS, type ThemeId } from './game/theme';
import { dialogDescriptor } from './game/dialogRegistry';
import { endGameExitPlan, type EndGameExit } from './game/spectatorEndGame';
import { assetMods, beginAssetAssignmentIntent, commitAssetAssignments, packSupports, type InstalledAssetPack } from './game/assetMods';
import { CHRISTER_MIT_LICENSE, CLIENT_MIT_LICENSE, LEGAL_ACCEPTANCE_VERSION, needsLegalAcknowledgement } from './game/legalNotice';
import type { JnlpJoinRequest } from './game/jnlpCompat';
import { installNativeContextMenuSuppression } from './game/nativeContextMenu';
import { readFullscreenSurface, toggleFullscreenSurface, type NativeFullscreenHost } from './game/fullscreen';

let removeNativeContextMenuSuppression: (() => void) | null = null;
onMounted(() => { removeNativeContextMenuSuppression = installNativeContextMenuSuppression(); });
onBeforeUnmount(() => {
  removeNativeContextMenuSuppression?.();
  removeNativeContextMenuSuppression = null;
});
import { authenticateAccount, rehydrateAccountSession, signInWithDiscordAccount } from './game/accountApi';
import { DesktopSignInCancelled } from './game/desktopAuth';
import {
  dismissTournamentNotification,
  startTournamentNotificationPolling,
  tournamentNotificationState,
} from './game/tournamentNotificationClient';

// Owner 2026-07-07: the app version (injected by Vite from package.json) shown in the header tag.
// Owner 2026-07-10 (dev-version nomenclature): appVersion carries the dev LETTER (0.2.8d) for dev cuts,
// bare (0.2.8) for the published release; gitSha is the exact source commit. Both are shown in the
// header tag + the OS window title so any build self-identifies. See dev-version-nomenclature.md.
declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
const appVersion = __APP_VERSION__;
const gitSha = typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : 'nogit';
// ORDER 66 (A.2): a port-branch build (0.2.8-o66a…) — surfaces the order66 toggle without needing -dev.
const isO66Build = appVersion.includes('o66');

// Legal acceptance is a revisioned launch gate rather than a dismissible preference. Missing or
// malformed persistence fails closed, including for existing installs that predate this field.
// The normal shell is not mounted and native JNLP requests are held in memory until the explicit
// acknowledgement has reached the durable settings lane.
const legalNoticeBusy = ref(false);
const legalNoticeOpen = computed(() => legalNoticeBusy.value || needsLegalAcknowledgement(settings.legalAcceptanceVersion));
// First-open contributions screen (owner 08-27): shown once, AFTER the legal notice clears —
// Christer + the FUMBBL contributors first, then Super FUMBBL. Informational, not consent:
// a failed persist closes it anyway (it simply reappears next launch).
const CONTRIBUTIONS_VERSION = 1;
const contributionsOpen = computed(() => !legalNoticeOpen.value && settings.contributionsSeenVersion < CONTRIBUTIONS_VERSION);
const firstOpenGateOpen = computed(() => legalNoticeOpen.value || contributionsOpen.value);
async function continueContributions(): Promise<void> {
  settings.contributionsSeenVersion = CONTRIBUTIONS_VERSION;
  try {
    await nextTick();
    await flushSettingsFile();
  } catch {
    // Informational screen: never block the shell on a persistence hiccup.
  }
}

// First-open retro intro (owner 08-27): rides the same first-open condition as the legal notice and
// plays BEFORE it. Sound at 30% (owner). Skippable (button / Esc / Enter / Space); a load error or
// unsupported codec fails OPEN to the legal notice — the intro must never block the acknowledgement gate.
const INTRO_VOLUME = 0.3;
const INTRO_VIDEO_URL = '/intro.mp4';
const introVideo = ref<HTMLVideoElement | null>(null);
const introDone = ref(false);
const introNeedsGesture = ref(false);
const introOpen = computed(() => legalNoticeOpen.value && !introDone.value);
function finishIntro(): void {
  introDone.value = true;
  introNeedsGesture.value = false;
}
function startIntroPlayback(): void {
  const video = introVideo.value;
  if (!video) return;
  video.volume = INTRO_VOLUME;
  // Autoplay with sound is allowed in the shipped WebView (autoplay policy relaxed in tauri.conf);
  // a browser preview that blocks it gets an explicit play control instead of a silent hang.
  video.play().then(() => { introNeedsGesture.value = false; }).catch(() => { introNeedsGesture.value = true; });
}
function onIntroKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    finishIntro();
  }
}
watch(introOpen, (open) => {
  if (open) {
    window.addEventListener('keydown', onIntroKeydown);
    void nextTick(() => startIntroPlayback());
  } else {
    window.removeEventListener('keydown', onIntroKeydown);
    introVideo.value?.pause();
  }
}, { immediate: true });
const legalNoticeError = ref('');
const legalHeldJnlps: JnlpJoinRequest[] = [];

async function acknowledgeLegalNotice(): Promise<void> {
  if (legalNoticeBusy.value || !legalNoticeOpen.value) return;
  legalNoticeBusy.value = true;
  legalNoticeError.value = '';
  const previous = settings.legalAcceptanceVersion;
  settings.legalAcceptanceVersion = LEGAL_ACCEPTANCE_VERSION;
  try {
    // Let the deep settings watcher observe this same-tick mutation before forcing its
    // crash-safe file flush. In browser preview, nextTick likewise completes localStorage.
    await nextTick();
    await flushSettingsFile();
  } catch (error) {
    settings.legalAcceptanceVersion = previous;
    legalNoticeError.value = `The acknowledgement could not be saved: ${error instanceof Error ? error.message : String(error)}`;
    legalNoticeBusy.value = false;
    return;
  }
  legalNoticeBusy.value = false;
}
// A JNLP opened before acceptance remains usable, but no route (and therefore no socket
// connection or game command) is allowed until the WHOLE first-open gate (legal +
// contributions) has closed.
watch(firstOpenGateOpen, (open) => {
  if (open) return;
  for (const request of legalHeldJnlps.splice(0)) routeNativeJnlp(request);
});

// Settings > General "Associate .jnlp files with this app" (Windows only, per-user HKCU;
// see src-tauri/src/lib.rs jnlp_assoc). Hidden entirely when the native command reports
// unsupported (non-Windows or browser preview) rather than shown disabled.
const jnlpAssocSupported = ref(false);
const jnlpAssocOn = ref(false);
const jnlpAssocBusy = ref(false);
const jnlpAssocError = ref('');
async function refreshJnlpAssocStatus() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    jnlpAssocSupported.value = await invoke<boolean>('jnlp_association_supported');
    if (jnlpAssocSupported.value) jnlpAssocOn.value = await invoke<boolean>('jnlp_association_status');
  } catch {
    jnlpAssocSupported.value = false; // browser build / API unavailable
  }
}
async function toggleJnlpAssociation() {
  if (jnlpAssocBusy.value) return;
  jnlpAssocBusy.value = true;
  jnlpAssocError.value = '';
  const next = !jnlpAssocOn.value;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_jnlp_association', { enable: next });
    jnlpAssocOn.value = next;
  } catch {
    jnlpAssocError.value = next
      ? 'Could not associate .jnlp files — try again, or check Windows permissions.'
      : 'Could not remove the .jnlp association — try again.';
  } finally {
    jnlpAssocBusy.value = false;
  }
}
onMounted(() => { void refreshJnlpAssocStatus(); });
// Stamp the OS window title with the full build id (guarded: no-op in the plain browser build).
onMounted(async () => {
  const title = `Super FUMBBL ${appVersion} (${gitSha})`;
  document.title = title;
  try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().setTitle(title); } catch { /* browser build / API unavailable */ }
  detectDevMode(); // owner 2026-07-10: unlock the Developer panel when launched with -dev (or ?dev)
});
let stopTournamentNotificationPolling: (() => void) | undefined;
onMounted(async () => {
  try {
    const restored = await rehydrateAccountSession();
    if (!restored) {
      if (!settings.coach40k.trim() || !coachPassword()) return;
      await authenticateAccount(settings.coach40k, coachPassword());
    }
    stopTournamentNotificationPolling = startTournamentNotificationPolling();
  } catch {
    // Account pane surfaces actionable auth errors; ordinary game startup remains available.
  }
});
onBeforeUnmount(() => stopTournamentNotificationPolling?.());

function openTournamentNotification() {
  const notification = tournamentNotificationState.active;
  if (!notification) return;
  window.dispatchEvent(new CustomEvent('fumbbl40k:scheduled-match-open', {
    detail: { matchId: notification.scheduledMatchId, gameId: notification.gameId },
  }));
  dismissTournamentNotification(notification.id);
}
import { SOUND_CATALOG, previewSound, invalidateSoundCache } from './game/sounds';
import { prefillMarkerTextFromJson } from './game/skillDisplay';
import { restoreSettingsSnapshotTransaction } from './game/assetModUi';
import {
  SETTINGS_SECTIONS,
  acceptSettingsPreview,
  cancelSettingsPreview,
  focusFirstInDialog,
  focusInitialSettingsControl,
  restoreDialogFocus,
  resolveSettingsTab,
  runConfirmedImmediateOperation,
  settingsTransactionIsBusy,
  settingsEscapeAction,
  settingsTransactionSnapshot,
  trapDialogFocus,
  type SettingsTab,
} from './game/settingsDialog';
import skillDescriptions from './assets/skillDescriptions.json';
import helmetIconUrl from './assets/resources/football-helmet.png';
import tabblLogoUrl from './assets/resources/tabbl-logo.png';
// Owner 2026-07-11: rebrand to the working name "Super FUMBBL" (display only — server/identifier/
// installer names stay Super FUMBBL). The processed logo (green plate keyed to transparency).
import superFumbblLogoUrl from './assets/resources/super-fumbbl-logo.png';

// Launch flow: optional intro, FUMBBL login, then tutorial. Twitch parent must match the host.
onMounted(() => {
  window.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!settings.clickEcho || e.button === 2) return;
    const el = document.createElement('div');
    el.className = 'click-echo';
    el.style.left = `${e.clientX}px`;
    el.style.top = `${e.clientY}px`;
    el.style.setProperty('--click-echo-color', settings.clickEchoColor || '#f5c518');
    el.style.setProperty('--echo-scale', String(settings.echoSize || 1));
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    // safety net if the animation event is missed
    setTimeout(() => el.remove(), 600);
  });
});

const skipSplash =
  import.meta.env.VITE_SKIP_SPLASH === 'true' ||
  (typeof location !== 'undefined' && new URLSearchParams(location.search).has('skipSplash'));
// Owner 2026-07-14: the welcome/creds splash stays ON by default (shown until an account is set). The
// getting-started TUTORIAL, however, no longer auto-opens — it's surfaced on demand from the hamburger's
// "Help / Tutorial" entry (see guideOpen below).
const startAtCreds = !skipSplash && !settings.hideCredsSplash && (!settings.completedFirstRun || !settings.coach.trim()); // owner 08-18: hideCredsSplash = the splash's own opt-out
const credsOpen = ref(startAtCreds);
// Owner 2026-07-04: the tabbed credentials menu (FUMBBL | Super FUMBBL), opened by a
// button from the launch splash or Settings → Connection.
const credsMenuOpen = ref(false);
const credsMenuTab = ref<'fumbbl' | 'fumbbl40k'>('fumbbl');
const credsMenuDialog = ref<HTMLElement | null>(null);
let credsMenuOpener: HTMLElement | null = null;
function openCredsMenu(tab: 'fumbbl' | 'fumbbl40k' = 'fumbbl') {
  credsMenuOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  credsMenuTab.value = tab;
  credsMenuOpen.value = true;
}

// Owner 2026-08-18: an auth-challenge button per tab, so a coach can confirm their details work
// from the dialog instead of finding out at connect time. Per-tab state — switching tabs must not
// show the other tab's verdict — and see game/authChallenge.ts for why the two tabs prove DIFFERENT
// things (the fork check is a real credential challenge; the FUMBBL one is a name lookup only).
const forkChallenge = ref<ChallengeState>(CHALLENGE_IDLE);
const fumbblChallenge = ref<ChallengeState>(CHALLENGE_IDLE);
// A stale result outlives the values it described, so a verdict is dropped the moment either field
// is edited. Never the values themselves — a failed check must not cost the user their typing.
watch(() => [settings.coach40k, coachPasswordModel.value], () => { forkChallenge.value = CHALLENGE_IDLE; });
watch(() => [settings.coach, settings.password], () => { fumbblChallenge.value = CHALLENGE_IDLE; });

async function verifyForkCredentials() {
  if (isChecking(forkChallenge.value)) return;
  forkChallenge.value = { kind: 'checking', message: forkCheckingMessage(settings.coach40k) };
  // The Tauri HTTP client where we have one: the browser fetch is same-origin-restricted and the
  // config-web host is not our origin.
  const transport = inTauri ? tauriFetch : fetch;
  forkChallenge.value = await runForkChallenge(
    settings.coach40k,
    coachPasswordModel.value,
    transport as typeof fetch,
    botConfigBaseUrl(),
  );
}

async function checkFumbblCoach() {
  if (isChecking(fumbblChallenge.value)) return;
  fumbblChallenge.value = { kind: 'checking', message: fumbblCheckingMessage(settings.coach) };
  fumbblChallenge.value = await runFumbblChallenge(settings.coach, inTauri ? (tauriFetch as typeof fetch) : fetch);
}
// Owner 2026-07-14: the welcome splash now offers TWO setup entries — "Set Up FUMBBL" (official account creds
// + disclaimers) and "Set up Super FUMBBL" (create fork account / log in / how to set up teams). setupMenu
// drives which splash sub-menu is open; superLoginOpen reveals the fork login fields; teamHelpOpen is the
// "how to set up teams" pop-up (explains the Import Team + Roster Builder flows).
const setupMenu = ref<null | 'fumbbl' | 'super'>(null);
const superLoginOpen = ref(false);
const teamHelpOpen = ref(false);
const setupDiscordBusy = ref(false);
const setupDiscordStatus = ref('');
let setupDiscordAbort: AbortController | null = null;

async function startSetupDiscordSignIn() {
  if (setupDiscordBusy.value) return;
  const coach = settings.coach40k.trim();
  if (!coach) {
    setupDiscordStatus.value = 'Enter your existing Super FUMBBL coach name below first.';
    superLoginOpen.value = true;
    return;
  }
  const controller = new AbortController();
  setupDiscordAbort = controller;
  setupDiscordBusy.value = true;
  setupDiscordStatus.value = `Waiting for Discord authorization for ${coach}…`;
  try {
    const identity = await signInWithDiscordAccount({
      coach,
      signal: controller.signal,
      openAuthorization: openExternal,
    });
    settings.coach40k = identity.ffbCoachId;
    setupDiscordStatus.value = `Signed in as ${identity.ffbCoachId}.`;
    stopTournamentNotificationPolling = startTournamentNotificationPolling();
  } catch (error) {
    setupDiscordStatus.value = error instanceof DesktopSignInCancelled
      ? 'Discord sign-in cancelled.'
      : error instanceof Error ? error.message : String(error);
  } finally {
    if (setupDiscordAbort === controller) setupDiscordAbort = null;
    setupDiscordBusy.value = false;
  }
}

function cancelSetupDiscordSignIn() { setupDiscordAbort?.abort(); }
onBeforeUnmount(() => setupDiscordAbort?.abort());

// The fork password field debounces its keychain write by 400ms (game/credentials.ts). Dismissing
// the panel that holds it is faster than that, so EVERY close path flushes first — otherwise the
// last thing typed is dropped with no error to show for it, which reads to the user as "the app
// doesn't save my credentials". Covers Done, ✕ and backdrop, for both surfaces that host the field.
function closeCredsMenu() { void flushCoachPassword(); credsMenuOpen.value = false; }
function closeSetupMenu() { void flushCoachPassword(); setupMenu.value = null; }

// Fork registration uses a distinct password and config-web's idempotent registration endpoint.
const registerModalOpen = ref(false);
const registerDialog = ref<HTMLElement | null>(null);
let registerModalOpener: HTMLElement | null = null;
const registerCoach = ref('');
const registerPassword = ref('');
const registerStatus = ref('');
const registering = ref(false);
function openRegisterModal() {
  registerModalOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  registerCoach.value = settings.coach40k.trim();
  registerPassword.value = '';
  registerStatus.value = '';
  registerModalOpen.value = true;
}
function closeRegisterModal() { registerModalOpen.value = false; }
async function registerForkAccount() {
  const coach = registerCoach.value.trim();
  const password = registerPassword.value;
  if (!coach) { registerStatus.value = 'Enter a coach name.'; return; }
  if (password.length < 4) { registerStatus.value = 'Choose a password (at least 4 characters).'; return; }
  registering.value = true;
  registerStatus.value = `Registering “${coach}” on the fork…`;
  try {
    // Owner ruling 08-17: the chosen password is hashed before it leaves — forkRegisterUrl sends
    // passwordMd5, which is exactly what ffb_coaches stores, so the clear text never enters a
    // query string (and so never enters an access or proxy log). See game/settings.ts.
    const url = forkRegisterUrl({ coach, password });
    const res = inTauri ? await tauriFetch(url) : await fetch(url);
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    settings.coach40k = coach;
    await setCoachPassword(password); // OS credential store, not localStorage
    // Owner ruling 08-17: the coach identity just changed, so any held config-web session token
    // belongs to the previous one. Drop it; the next guarded call exchanges these creds for a fresh
    // token (see game/configWebAuth.ts). Registration still transmits a credential — it SETS it —
    // but only the digest, never the clear text.
    clearConfigWebToken();
    registerStatus.value = `✓ Registered “${coach}”. You can play on the fork now.`;
    setTimeout(closeRegisterModal, 1200);
  } catch (e) {
    registerStatus.value = `Couldn't register (${(e as Error).message}). Is the Tournament Bot reachable?`;
  } finally {
    registering.value = false;
  }
}
const splashOpen = ref(false); // welcome splash deprecated — shown only via replayIntro()
// Owner 2026-07-14: the getting-started tutorial is OFF at launch for now (a nuisance, needs revising) —
// hardcoded off so it's suppressed even for existing installs whose hideTutorialSplash is persisted false.
// Still reachable on demand via Settings → Connection ("Replay the intro screens") / Play Tutorial.
const guideOpen = ref(false);
function finishCreds() {
  settings.completedFirstRun = true;
  credsOpen.value = false;
  if (!settings.hideTutorialSplash) guideOpen.value = true; // straight to the tutorial (welcome deprecated)
}
function nextSplash() {
  splashOpen.value = false;
  if (!settings.hideTutorialSplash) guideOpen.value = true;
}
// "Play Tutorial": clear the splashes, ensure the spectate HUD is up, and kick off
// the guided tour (SpectateView watches ui.tutorialTick). Cold start has no game, so
// SpectateView isn't mounted — load the demo first, let it mount, THEN tick the tour.
async function playTutorial() {
  splashOpen.value = false;
  guideOpen.value = false;
  view.value = 'spectate';
  if (!gameStore.game.value) await gameStore.loadDemo();
  await nextTick(); // SpectateView mounts off game.value; its tutorialTick watcher must exist first
  ui.tutorialTick += 1;
}
/** Re-show the welcome + tutorial splashes on demand (Settings → Connection). */
function replayIntro() {
  ui.settingsOpen = false;
  credsOpen.value = false;
  guideOpen.value = false;
  splashOpen.value = true;
}
const twitchEmbedUrl = computed(() => {
  const host = window.location.hostname || 'localhost';
  const parents = [...new Set([host, 'localhost', 'tauri.localhost'])].map((p) => `parent=${p}`).join('&');
  return `https://player.twitch.tv/?channel=flutethecat&${parents}&muted=true&autoplay=false`;
});
const twitchChannelUrl = 'https://twitch.tv/flutethecat';
// Owner 2026-07-03: in the packaged build the webview origin is `tauri.localhost`,
// which Twitch REJECTS as an embed `parent` — so the player iframe is broken there.
// Show the live embed only on the web/dev origin; the desktop build gets a clickable
// "Watch on Twitch" card that opens the channel in the system browser instead.
const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
/** Open an external URL in the system browser (Tauri opener plugin; window.open on
 *  the web). External links don't navigate/embed inside the packaged webview. */
async function openExternal(url: string): Promise<void> {
  if (inTauri) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch {
      /* fall through to window.open */
    }
  }
  window.open(url, '_blank', 'noopener');
}

// Owner ruling (console shell restructure): Hub is deprecated — Play is the console shell's landing/home blade.
type AppView = 'spectate' | 'play' | 'replay' | 'console' | 'team' | 'tournaments' | 'statistics' | 'league' | 'players' | 'store';
const view = ref<AppView>('play');
function handleScheduledMatchOpen(): void {
  // Notification navigation is intentionally presentation-only. The tournament blade
  // still requires the coach to select Launch, so a popup can never auto-join a match.
  view.value = 'tournaments';
}

onMounted(() => window.addEventListener('fumbbl40k:scheduled-match-open', handleScheduledMatchOpen));
onBeforeUnmount(() => window.removeEventListener('fumbbl40k:scheduled-match-open', handleScheduledMatchOpen));

const tournamentBuilderPackage = ref('');
const tournamentBuilderLaunchRevision = ref(0);
function openTournamentTeamBuilder(rulesetPackName: string): void {
  tournamentBuilderPackage.value = rulesetPackName;
  tournamentBuilderLaunchRevision.value += 1;
  view.value = 'team';
}
function applyJnlpResultView(result: JnlpRouteResult): void {
  if (result === 'replay') view.value = 'replay';
  else if (result === 'spectate') view.value = 'spectate';
  else if (result === 'fork-player' || result === 'fumbbl-player' || result === 'fumbbl-staged') view.value = 'play';
}
function routeNativeJnlp(request: JnlpJoinRequest): void {
  const result = routeJnlpRequest(request, {
    deferFumbblPlayer: view.value === 'play' && settings.activeServerTarget === 'fumbbl',
    sourceName: 'Opened .jnlp file',
  });
  applyJnlpResultView(result);
}
// One app-lifetime native JNLP consumer prevents drain_launch_jnlps queue races.
// Only the official-server Play blade defers a player request for its preview.
useNativeJnlpIntake((request) => {
  if (firstOpenGateOpen.value) {
    legalHeldJnlps.push(request);
    return;
  }
  routeNativeJnlp(request);
});
function chooseAmbiguousJnlp(choice: 'replay' | 'live'): void {
  applyJnlpResultView(resolveAmbiguousJnlpEntry(choice));
}
// Connect bar removed (owner 2026-07-03 r6f Option A): the header hosts the primary
// Owner 08-18: the header session chip + Disconnect (Option-A connect-bar leftovers)
// are RETIRED — leave/disconnect lives in the Game Menu + the connection-closed modal.
const liveGameMode = computed<'spectate' | 'play' | 'replay'>(() =>
  gameStore.isReplay.value ? 'replay' : gameStore.isPlaying.value ? 'play' : 'spectate',
);
const gameSessionActive = computed(() => !!gameStore.game.value || gameStore.state.sessionState === 'joined');
watchEffect(() => {
  if (gameSessionActive.value && ui.browserOpen) ui.browserOpen = false;
});

// owner 2026-07-07: Debug pane — copy the current verbose wire-log file path to the clipboard.
const wireLogCopied = ref(false);
async function copyWireLogPath() {
  const path = gameStore.state.wireLogFile;
  if (!path) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(path);
    else throw new Error('no clipboard api');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = path;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(ta);
  }
  wireLogCopied.value = true;
  setTimeout(() => { wireLogCopied.value = false; }, 1500);
}
// Dev controls (owner 2026-07-03 r6f): the Protocol console is now tucked behind a
// "Dev controls" section in the hamburger menu rather than a top-nav button.
const devOpen = ref(false);
function openConsole() {
  view.value = 'console';
  menuOpen.value = false;
}

/** Owner 2026-07-02: hamburger menu at the top left hosts the settings page. */
const menuOpen = ref(false);
const hamburgerButton = ref<HTMLButtonElement | null>(null);
// Owner: the menu binds to the hamburger's ACTUAL location — the panel was hard-anchored top-right
// (top:52px/right:12px) and detached from the button whenever a layout places it elsewhere (owner saw a
// bottom-right hamburger with a top-right menu). Measure the button at open time: right-align to it,
// open downward from the top half of the viewport and UPWARD from the bottom half, viewport-clamped.
const menuAnchor = ref<Record<string, string> | null>(null);
function computeMenuAnchor(el: HTMLElement | null): Record<string, string> | null {
  const rect = el?.getBoundingClientRect();
  if (!rect) return null;
  const right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  return rect.top > window.innerHeight / 2
    ? { top: 'auto', bottom: `${window.innerHeight - rect.top + 8}px`, right, maxHeight: `${Math.max(120, rect.top - 20)}px` }
    : { top: `${rect.bottom + 8}px`, bottom: 'auto', right, maxHeight: `${Math.max(120, window.innerHeight - rect.bottom - 20)}px` };
}
function toggleAppMenu(): void {
  if (!menuOpen.value) menuAnchor.value = computeMenuAnchor(hamburgerButton.value);
  menuOpen.value = !menuOpen.value;
}
// In-game the opener is SpectateView's quick-bar ☰ (not the shell-header hamburger,
// which isn't mounted there) — measure IT, or the panel falls back to top-right.
function openGameMenu(): void {
  menuAnchor.value = computeMenuAnchor(document.querySelector<HTMLElement>('.quick-menu[aria-label="Menu"]'));
  menuOpen.value = true;
}
const replayFileInput = ref<HTMLInputElement | null>(null);
const replayFileBusy = ref(false);
const replayFileError = ref('');
interface ReplayFileSessionSnapshot {
  game: typeof gameStore.game.value;
  sessionKey: string;
  loading: boolean;
  source: typeof gameStore.replay.source;
  sessionState: typeof gameStore.state.sessionState;
  replayActive: boolean;
}
const stopReplayFileBusy = sharedReplayFileImporter.subscribeBusy((busy) => { replayFileBusy.value = busy; });
let replayFileTicket: ReplayFileImportTicket<ReplayFileSessionSnapshot> | null = null;
function replayFileSessionSnapshot(): ReplayFileSessionSnapshot {
  return {
    game: gameStore.game.value,
    sessionKey: gameStore.replay.sessionKey,
    loading: gameStore.replay.loading,
    source: gameStore.replay.source,
    sessionState: gameStore.state.sessionState,
    replayActive: gameStore.replay.active,
  };
}
function replayFileSessionIsCurrent(snapshot: ReplayFileSessionSnapshot): boolean {
  const current = replayFileSessionSnapshot();
  return current.game === snapshot.game
    && current.sessionKey === snapshot.sessionKey
    && current.loading === snapshot.loading
    && current.source === snapshot.source
    && current.sessionState === snapshot.sessionState
    && current.replayActive === snapshot.replayActive;
}
function restoreReplayFileFocus(): void {
  requestAnimationFrame(() => hamburgerButton.value?.focus());
}
function openReplayFilePicker(): void {
  if (gameStore.replay.loading || replayFileBusy.value) return;
  if (gameStore.game.value) {
    const subject = gameStore.isReplay.value ? 'current replay and its telestrator marks' : 'current game';
    if (!window.confirm(`Loading another replay will replace the ${subject}. Continue?`)) return;
  }
  replayFileError.value = '';
  replayFileTicket = sharedReplayFileImporter.begin(replayFileSessionSnapshot());
  menuOpen.value = false;
  replayFileInput.value?.click();
}
function cancelReplayFilePicker(): void {
  sharedReplayFileImporter.cancel(replayFileTicket);
  replayFileTicket = null;
  if (replayFileInput.value) replayFileInput.value.value = '';
  restoreReplayFileFocus();
}
async function loadReplayFileFromMenu(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const ticket = replayFileTicket;
  replayFileTicket = null;
  input.value = '';
  if (!file || !ticket) {
    sharedReplayFileImporter.cancel(ticket);
    restoreReplayFileFocus();
    return;
  }
  const result = await sharedReplayFileImporter.load({
    ticket,
    file,
    isCurrent: replayFileSessionIsCurrent,
    commit: async (text, byteLength) => {
      if (classifyReplayFileContent(text) === 'json') {
        gameStore.loadReplayFile(text, byteLength);
        view.value = 'replay';
        return;
      }
      const request = await readJnlpFile({ text: async () => text });
      const routeResult = routeJnlpRequest(request, { sourceName: 'Opened replay file' });
      if (routeResult === 'host-rejected') throw new Error(jnlpEntryError.value);
      if (routeResult === 'invalid') throw new Error(jnlpEntryError.value || 'JNLP could not be used.');
      applyJnlpResultView(routeResult);
    },
  });
  if (result.status === 'loaded') {
    replayFileError.value = '';
  } else if (result.status === 'session-changed') {
    replayFileError.value = 'The game or replay session changed while the file was loading. Choose the file again.';
  } else if (result.status === 'failed') {
    replayFileError.value = `Could not load replay: ${result.error.message}`;
  }
  restoreReplayFileFocus();
}
onBeforeUnmount(() => {
  stopReplayFileBusy();
  sharedReplayFileImporter.invalidate();
});
const settingsOpen = computed({
  get: () => ui.settingsOpen,
  set: (v: boolean) => (ui.settingsOpen = v),
});
const settingsTab = computed({
  get: () => resolveSettingsTab(ui.settingsTab),
  set: (v: SettingsTab) => (ui.settingsTab = resolveSettingsTab(v)),
});
const activeSettingsSection = computed(() => SETTINGS_SECTIONS.find((section) => section.id === settingsTab.value) ?? SETTINGS_SECTIONS[0]!);
const footstepStyle = computed({
  get: () => settings.soundStyles.step ?? 'tick',
  set: (value: string) => { settings.soundStyles.step = value; previewSound('step'); },
});
// Owner 2026-07-14: the "Dodge" row of AUTOMATIC SKILL USAGE — a checkbox view over the dodgeReroll field
// (a re-roll, kept on its own proven path). On == 'auto' (auto-spend), off == 'manual' (prompt).
const autoDodge = computed({
  get: () => settings.dodgeReroll === 'auto',
  set: (v: boolean) => { settings.dodgeReroll = v ? 'auto' : 'manual'; },
});
// Owner 2026-07-14 (theme engine, spec black-red-ui-scheme.md): apply the derived --ui-* tokens to :root,
// re-running whenever the theme settings change (deriveTheme is pure; applyTheme writes :root).
watchEffect(() => applyTheme(settings.uiTheme, settings.uiPrimary, settings.uiSecondary));
function selectThemePreset(id: ThemeId) {
  settings.uiTheme = id;
  if (id !== 'custom') { settings.uiPrimary = THEME_PRESETS[id].primary; settings.uiSecondary = THEME_PRESETS[id].secondary; }
}
function onThemeColorEdit() { settings.uiTheme = 'custom'; } // editing a colour field switches the choice to Custom
const themePreview = computed(() => {
  const { primary, secondary } = resolveThemeColors(settings.uiTheme, settings.uiPrimary, settings.uiSecondary);
  return deriveTheme(primary, secondary);
});
/** When set, the next keydown rebinds this hotkey. */
const capturingKey = ref<'confirmKey' | null>(null);

/**
 * UI-6: pulls the coach's auto-marking config from FUMBBL — the same
 * endpoint the FFB server uses (`api/clientoptions/get/<coach>`, edited via
 * fumbbl.com's client-options/markings page) — through the dev proxy.
 */
const markingsStatus = ref('Empty config = markings off.');

/**
 * B2-14: structured auto-marking rule editor, mirroring the fumbbl.com
 * Client Options page. Reads/writes the same markingsConfig JSON that the
 * import fills, so both paths stay interchangeable.
 */
interface EditableRule {
  skillArray: string[];
  injuryAttributes: string[];
  marking: string;
  gainedOnly: boolean;
  applyTo: 'OWN' | 'OPPONENT' | 'BOTH';
  applyRepeatedly: boolean;
}
const newRule = reactive({ skills: '', marking: '', applyTo: 'BOTH' as EditableRule['applyTo'], gainedOnly: true });

const markingRules = computed<EditableRule[]>(() => {
  try {
    const parsed = JSON.parse(settings.markingsConfig || '{}') as { autoMarkingRecords?: EditableRule[] };
    return (parsed.autoMarkingRecords ?? []).map((r) => ({
      skillArray: r.skillArray ?? [],
      injuryAttributes: r.injuryAttributes ?? [],
      marking: r.marking ?? '',
      gainedOnly: !!r.gainedOnly,
      applyTo: r.applyTo ?? 'BOTH',
      applyRepeatedly: !!r.applyRepeatedly,
    }));
  } catch {
    return [];
  }
});

function writeMarkingRules(rules: EditableRule[]) {
  const parsed = (() => {
    try {
      return JSON.parse(settings.markingsConfig || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  parsed.autoMarkingRecords = rules;
  settings.markingsConfig = JSON.stringify(parsed);
}

function addMarkingRule() {
  const skills = newRule.skills.split(',').map((s) => s.trim()).filter(Boolean);
  if (!newRule.marking || skills.length === 0) return;
  writeMarkingRules([
    ...markingRules.value,
    {
      skillArray: skills,
      injuryAttributes: [],
      marking: newRule.marking,
      gainedOnly: newRule.gainedOnly,
      applyTo: newRule.applyTo,
      applyRepeatedly: false,
    },
  ]);
  newRule.skills = '';
  newRule.marking = '';
}

function removeMarkingRule(index: number) {
  writeMarkingRules(markingRules.value.filter((_, i) => i !== index));
}

// --- Per-skill display config (owner 2026-07-03 r6f) ------------------------
// A menu over EVERY skill in the game (keys of skillDescriptions.json), grouped
// into "Skill Icons" and "Skill Markers". Each skill has a MY TEAM (home coach)
// and OPPOSITION (away coach) behaviour dropdown; Markers add a per-skill glyph.
const allSkills = Object.keys(skillDescriptions as Record<string, unknown>).sort((a, b) => a.localeCompare(b));
const skillConfigGroup = ref<'icons' | 'markers'>('icons');
const skillFilter = ref('');
const showImportInstructions = ref(false);
const skillPrefillStatus = ref('');
const filteredSkills = computed(() => {
  const q = skillFilter.value.trim().toLowerCase();
  return q ? allSkills.filter((s) => s.toLowerCase().includes(q)) : allSkills;
});
const skillKind = computed<'icon' | 'marker'>(() => (skillConfigGroup.value === 'icons' ? 'icon' : 'marker'));
/** Render position for the CURRENT group (owner 2026-07-03 r6f): icons default to
 *  'head', markers to 'feet'; either can be switched to the other. */
const skillGroupPosition = computed<'head' | 'feet'>({
  get: () => (skillConfigGroup.value === 'icons' ? settings.iconPosition : settings.markerPosition),
  set: (v) => {
    if (skillConfigGroup.value === 'icons') settings.iconPosition = v;
    else settings.markerPosition = v;
  },
});
const BEHAVIOUR_OPTIONS: { value: SkillBehaviour; label: string }[] = [
  { value: 'always', label: 'All the time' },
  { value: 'added', label: 'Gained' }, // #15 addendum (owner 08-11): label-only rename (value/semantics unchanged)
  { value: 'never', label: 'Never' },
];
type SkillCol = 'Mine' | 'Opp';
/** Effective behaviour for a skill/kind/column (falls back to the group default). */
function skillBehaviour(skill: string, kind: 'icon' | 'marker', col: SkillCol): SkillBehaviour {
  const entry = settings.skillConfig[skill];
  const v = entry?.[`${kind}${col}` as 'iconMine' | 'iconOpp' | 'markerMine' | 'markerOpp'];
  return v ?? (kind === 'icon' ? iconBehaviourDefault() : MARKER_BEHAVIOUR_DEFAULT);
}
function setSkillBehaviour(skill: string, kind: 'icon' | 'marker', col: SkillCol, value: SkillBehaviour) {
  const entry = { ...(settings.skillConfig[skill] ?? {}) };
  entry[`${kind}${col}` as 'iconMine' | 'iconOpp' | 'markerMine' | 'markerOpp'] = value;
  settings.skillConfig = { ...settings.skillConfig, [skill]: entry };
}
function skillMarkerText(skill: string): string {
  return settings.skillConfig[skill]?.markerText ?? '';
}
function setSkillMarkerText(skill: string, value: string) {
  const entry = { ...(settings.skillConfig[skill] ?? {}) };
  if (value) entry.markerText = value;
  else delete entry.markerText;
  settings.skillConfig = { ...settings.skillConfig, [skill]: entry };
}
/** Seed the per-skill marker glyphs from the imported FUMBBL markings JSON. */
function prefillMarkerGlyphs() {
  try {
    const config = JSON.parse(settings.markingsConfig || '{}');
    const n = prefillMarkerTextFromJson(config);
    settings.skillConfig = { ...settings.skillConfig }; // persist + re-render
    skillPrefillStatus.value =
      n > 0 ? `Pre-filled ${n} marker glyph(s) from the markings JSON (yours are kept).`
        : 'No single-skill markings found in the JSON to pre-fill.';
  } catch {
    skillPrefillStatus.value = 'The markings JSON is empty or invalid — import or paste it first.';
  }
}
function resetSkillConfig() {
  settings.skillConfig = {};
  skillPrefillStatus.value = 'Per-skill config reset to defaults.';
}

/** B3-8: UI-wide font choice — drives the CSS variable the root font uses.
 *  Nuffle ships embedded (public/fonts, FontFace-loaded in main.ts). */
const UI_FONTS: Record<string, string> = {
  nuffle: "'Nuffle', system-ui, sans-serif",
  system: 'system-ui, sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
};
watchEffect(() => {
  document.documentElement.style.setProperty('--ui-font', UI_FONTS[settings.uiFont] ?? UI_FONTS.nuffle!);
  document.documentElement.style.setProperty('--ui-min-text-size', `${settings.uiTextSize}px`);
  // Two-tier floor (owner 08-27): PRIMARY text never drops below 16px; sub-headers/annotations
  // keep the slider floor (12px default). The slider still raises both once it passes 16.
  const primaryFloor = Math.max(16, settings.uiTextSize);
  document.documentElement.style.setProperty('--ui-min-primary-text-size', `${primaryFloor}px`);
  document.body.style.fontSize = `${primaryFloor}px`;
});

/** F-2: packaged builds use the OS window's real fullscreen mode. Web preview
 *  retains document fullscreen as a fallback so the same control remains testable. */
type ObservableNativeFullscreenHost = NativeFullscreenHost & {
  onResized(handler: () => void): Promise<() => void>;
};
const fullscreen = ref(false);
const fullscreenIsNative = ref(false);
let nativeFullscreenHost: ObservableNativeFullscreenHost | null = null;
let removeNativeFullscreenObserver: (() => void) | null = null;
let fullscreenSyncTimer: ReturnType<typeof setTimeout> | null = null;

async function syncFullscreenState(): Promise<void> {
  const state = await readFullscreenSurface(nativeFullscreenHost, document);
  fullscreen.value = state.active;
  fullscreenIsNative.value = state.native;
}
const onDocumentFullscreenChange = () => { void syncFullscreenState(); };
const scheduleNativeFullscreenSync = () => {
  if (fullscreenSyncTimer !== null) clearTimeout(fullscreenSyncTimer);
  fullscreenSyncTimer = setTimeout(() => {
    fullscreenSyncTimer = null;
    void syncFullscreenState();
  }, 120);
};
document.addEventListener('fullscreenchange', onDocumentFullscreenChange);

onMounted(async () => {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    nativeFullscreenHost = getCurrentWindow() as ObservableNativeFullscreenHost;
    removeNativeFullscreenObserver = await nativeFullscreenHost.onResized(scheduleNativeFullscreenSync);
  } catch {
    nativeFullscreenHost = null;
  }
  await syncFullscreenState();
});
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onDocumentFullscreenChange);
  removeNativeFullscreenObserver?.();
  removeNativeFullscreenObserver = null;
  if (fullscreenSyncTimer !== null) clearTimeout(fullscreenSyncTimer);
  fullscreenSyncTimer = null;
  nativeFullscreenHost = null;
});

async function toggleFullscreen(): Promise<void> {
  const state = await toggleFullscreenSurface(nativeFullscreenHost, document);
  fullscreen.value = state.active;
  fullscreenIsNative.value = state.native;
}

// #16 (owner 08-11): the import coach — AUTOFILLED with the user's own FUMBBL coach, freely editable to any coach.
const importCoach = ref(settings.coach);
async function importMarkings() {
  const coach = importCoach.value.trim();
  if (!coach) {
    markingsStatus.value = 'Enter a coach name to import markings from.';
    return;
  }
  markingsStatus.value = `Fetching markings for ${coach}…`;
  try {
    // ⚖ upstream-does-it: the Java client reads this same endpoint (user-initiated fetch of a coach's client options).
    const res = await fetch(`${FUMBBL_SITE}/api/clientoptions/get/${encodeURIComponent(coach)}`);
    if (!res.ok) throw new Error(`fumbbl.com returned ${res.status}`);
    const text = await res.text();
    const parsed = JSON.parse(text) as { autoMarkingRecords?: { skillArray?: string[]; marking?: string }[] };
    if (!Array.isArray(parsed.autoMarkingRecords)) throw new Error('this coach has no markings configured');
    settings.markingsConfig = JSON.stringify(parsed);
    // #16 ③: AUTO-FILL the per-skill table — glyph AND behaviour — so imported markings actually show (composes with
    // the #15 glyph column). A user's own glyph/behaviour is kept (never overwritten). Multi-skill / blank rows skip.
    const nextConfig = { ...settings.skillConfig };
    let imported = 0, skipped = 0;
    for (const rec of parsed.autoMarkingRecords) {
      if (rec.skillArray?.length === 1 && rec.marking) {
        const skill = rec.skillArray[0]!;
        const entry = { ...(nextConfig[skill] ?? {}) };
        if (!entry.markerText?.trim()) entry.markerText = rec.marking; // glyph
        if (entry.markerMine == null) entry.markerMine = 'always';     // behaviour — show it
        if (entry.markerOpp == null) entry.markerOpp = 'always';
        nextConfig[skill] = entry;
        imported++;
      } else skipped++;
    }
    settings.skillConfig = nextConfig; // one reassign → persist + re-render
    markingsStatus.value = `Imported ${imported} skill marking${imported === 1 ? '' : 's'} from ${coach}`
      + (skipped ? ` (${skipped} multi-skill/blank rule${skipped === 1 ? '' : 's'} skipped)` : '') + '.';
  } catch (error) {
    markingsStatus.value = `Import failed for ${coach}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const settingsDialog = ref<HTMLElement | null>(null);
let settingsOpener: HTMLElement | null = null;

function appMenuFocusFallback(): HTMLElement | null {
  return hamburgerButton.value
    ?? document.querySelector<HTMLElement>('.hamburger')
    ?? document.querySelector<HTMLElement>('.quick-menu[aria-label="Menu"]');
}
function settingsModalFocusFallback(): HTMLElement | null {
  return settingsDialog.value?.querySelector<HTMLElement>('.settings-x') ?? appMenuFocusFallback();
}
function credentialsModalFocusFallback(): HTMLElement | null {
  return credsMenuDialog.value?.querySelector<HTMLElement>('.creds-menu-close') ?? settingsModalFocusFallback();
}

function openSettings(tab: unknown = 'general') {
  settingsOpener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement : null;
  ui.settingsTab = resolveSettingsTab(tab);
  ui.settingsOpen = true;
  menuOpen.value = false;
  ui.gameMenuOpen = false;
}

// Settings remain live-preview: renderer/UI watchers see each edit immediately. Apply accepts the
// current preview as the new rollback point; Cancel restores the most recent accepted snapshot.
const settingsSnapshot = ref<string | null>(null);
const settingsDiscardBusy = ref(false);
const settingsDiscardError = ref('');
const settingsApplyBusy = ref(false);
const settingsApplyError = ref('');
const settingsTransactionBusy = computed(() => settingsTransactionIsBusy({
  discarding: settingsDiscardBusy.value,
  applying: settingsApplyBusy.value,
  creatorApplying: assetMods.creatorApplyBusy,
  assignmentPending: !!assetMods.pendingAssignments,
}));

// Owner 2026-09-04: Settings > Appearance > Player sprites lists ONLY what is actually available:
// the bundled Super FUMBBL Placeholder set (always), the FUMBBL Classic/Checkers modes only when an
// installed pack supplies FUMBBL iconsets, and one entry per installed sprite/walk-sheet pack.
const FUMBBL_ICONSET_CAPABILITIES = ['player-iconsets', 'fumbbl-id-images'];
const fumbblSpriteModesAvailable = computed(() =>
  assetMods.installed.some((pack) => pack.capabilities.some((name) => FUMBBL_ICONSET_CAPABILITIES.includes(name))));
const spritePackOptions = computed(() =>
  assetMods.installed.filter((pack) => packSupports(pack, 'playerSprites') || packSupports(pack, 'walkSheets')));
function spritePackValue(pack: InstalledAssetPack): string { return `pack:${pack.installId}`; }
const spriteChoice = computed<string>({
  get: () => {
    const active = settings.assetPackAssignments;
    const packId = active.playerSprites || active.walkSheets;
    return packId ? `pack:${packId}` : settings.spriteSet;
  },
  set: (value) => { void selectSpriteChoice(value); },
});
async function selectSpriteChoice(value: string): Promise<void> {
  const persist = (active: typeof settings.assetPackAssignments) => {
    settings.assetPackAssignments = active;
    settings.skillIconPackInstallId = active.skillIcons;
  };
  if (value.startsWith('pack:')) {
    const pack = assetMods.installed.find((candidate) => candidate.installId === value.slice(5));
    if (!pack) return;
    settings.spriteSet = 'walk'; // pack sprites take precedence; the placeholder set sits beneath them
    await commitAssetAssignments({
      ...settings.assetPackAssignments,
      playerSprites: packSupports(pack, 'playerSprites') ? pack.installId : '',
      walkSheets: packSupports(pack, 'walkSheets') ? pack.installId : '',
    }, persist, beginAssetAssignmentIntent());
    return;
  }
  settings.spriteSet = value as typeof settings.spriteSet;
  if (settings.assetPackAssignments.playerSprites || settings.assetPackAssignments.walkSheets) {
    await commitAssetAssignments({ ...settings.assetPackAssignments, playerSprites: '', walkSheets: '' }, persist, beginAssetAssignmentIntent());
  }
}
// A FUMBBL mode persisted from an older build (or a pack that was removed) falls back to the placeholder set.
watchEffect(() => {
  if (!fumbblSpriteModesAvailable.value && settings.spriteSet !== 'walk') settings.spriteSet = 'walk';
});

function escSettings(e: KeyboardEvent) {
  if (e.code !== 'Escape') return;
  const action = settingsEscapeAction({
    settingsOpen: ui.settingsOpen,
    credentialsOpen: credsMenuOpen.value,
    registrationOpen: registerModalOpen.value,
    capturingKey: !!capturingKey.value,
  });
  if (!action) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (action === 'cancel-key-capture') {
    capturingKey.value = null;
    return;
  }
  if (action === 'close-registration') {
    closeRegisterModal();
    return;
  }
  if (action === 'close-credentials') {
    closeCredsMenu();
    return;
  }
  void cancelSettingsChanges();
}
watch(() => ui.settingsOpen, (open) => {
  if (open) {
    if (!settingsOpener && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      settingsOpener = document.activeElement;
    }
    settingsSnapshot.value = settingsFingerprint();
    settingsDiscardBusy.value = false;
    settingsDiscardError.value = '';
    settingsApplyBusy.value = false;
    settingsApplyError.value = '';
    void nextTick(() => { if (settingsDialog.value) focusInitialSettingsControl(settingsDialog.value); });
  } else {
    const opener = settingsOpener;
    settingsOpener = null;
    void nextTick(() => { restoreDialogFocus(opener, appMenuFocusFallback()); });
  }
});
watch([() => ui.settingsOpen, credsMenuOpen, registerModalOpen], ([settingsUp, credsUp, registerUp], previous) => {
  const anyOpen = settingsUp || credsUp || registerUp;
  const wasOpen = previous?.some(Boolean) ?? false;
  if (anyOpen && !wasOpen) window.addEventListener('keydown', escSettings, true);
  else if (!anyOpen && wasOpen) window.removeEventListener('keydown', escSettings, true);
});
watch(credsMenuOpen, (open) => {
  if (open) void nextTick(() => { if (credsMenuDialog.value) focusFirstInDialog(credsMenuDialog.value, '.creds-panel input'); });
  else {
    const opener = credsMenuOpener;
    credsMenuOpener = null;
    void nextTick(() => { restoreDialogFocus(opener, ui.settingsOpen ? settingsModalFocusFallback() : appMenuFocusFallback()); });
  }
});
watch(registerModalOpen, (open) => {
  if (open) void nextTick(() => { if (registerDialog.value) focusFirstInDialog(registerDialog.value, 'input'); });
  else {
    const opener = registerModalOpener;
    registerModalOpener = null;
    void nextTick(() => { restoreDialogFocus(opener, credsMenuOpen.value ? credentialsModalFocusFallback() : (ui.settingsOpen ? settingsModalFocusFallback() : appMenuFocusFallback())); });
  }
});
onBeforeUnmount(() => window.removeEventListener('keydown', escSettings, true));
// Owner UAT 08-12: positional/layout state — the log panel's pos+size and the custom panel layout — is written
// IN-GAME by drag / the window-resize reanchor / the panel ResizeObserver (SpectateView), NOT by a settings-pane
// edit. It must NOT count toward the close-time dirty check: otherwise a background reflow while settings is open
// (the big modal can trigger one) leaves settings perpetually "dirty", so the ✕/Esc only ever raises the
// save/discard card and never closes (owner: "the X still stays up"). The fingerprint drops these app-managed keys.
function settingsFingerprint(): string {
  return settingsTransactionSnapshot(settings as unknown as Record<string, unknown>);
}
const settingsDirty = computed(() => settingsSnapshot.value != null && settingsFingerprint() !== settingsSnapshot.value);
function requestCloseSettings() {
  void cancelSettingsChanges();
}

async function applySettingsChanges(closeAfter = false): Promise<boolean> {
  if (settingsTransactionBusy.value) return false;
  settingsApplyBusy.value = true;
  settingsApplyError.value = '';
  try {
    settingsSnapshot.value = await acceptSettingsPreview(flushSettingsFile, settingsFingerprint);
    if (closeAfter) ui.settingsOpen = false;
    return true;
  } catch (error) {
    settingsApplyError.value = `Settings could not be saved: ${error instanceof Error ? error.message : String(error)}`;
    return false;
  } finally {
    settingsApplyBusy.value = false;
  }
}

async function cancelSettingsChanges(): Promise<boolean> {
  if (settingsTransactionBusy.value) return false;
  if (!settingsDirty.value || settingsSnapshot.value == null) {
    ui.settingsOpen = false;
    return true;
  }
  settingsDiscardBusy.value = true;
  settingsDiscardError.value = '';
  settingsApplyError.value = '';
  const restored = await cancelSettingsPreview(settingsSnapshot.value, (snapshotText) =>
    restoreSettingsSnapshotTransaction({
      snapshotText,
      restoreAssets: async (requested) => {
        const ok = await commitAssetAssignments(
          requested as Partial<typeof settings.assetPackAssignments>,
          () => undefined,
          beginAssetAssignmentIntent(),
        );
        return ok ? { ...assetMods.activeAssignments } : null;
      },
      apply: (snapshot) => Object.assign(settings, snapshot),
    }));
  if (!restored) {
    settingsDiscardBusy.value = false;
    settingsDiscardError.value = 'The previous asset selection could not be restored. Your current settings are still active.';
    return false;
  }
  settingsDiscardBusy.value = false;
  ui.settingsOpen = false;
  return true;
}

function selectSettingsTab(tab: unknown, focusContent = false) {
  settingsTab.value = resolveSettingsTab(tab);
  if (focusContent) {
    void nextTick(() => settingsDialog.value?.querySelector<HTMLElement>('.settings-content h2')?.focus());
  }
}

function trapSettingsFocus(event: KeyboardEvent) {
  if (credsMenuOpen.value || registerModalOpen.value) return;
  trapDialogFocus(event, settingsDialog.value);
}
function trapCredsFocus(event: KeyboardEvent) { if (!registerModalOpen.value) trapDialogFocus(event, credsMenuDialog.value); }
function trapRegisterFocus(event: KeyboardEvent) { trapDialogFocus(event, registerDialog.value); }

function resetPanelLayoutImmediately() {
  runConfirmedImmediateOperation(
    () => window.confirm('Reset every panel position and size now? This immediate layout change is not undone by Cancel.'),
    () => { settings.uiLayout = {}; },
  );
}

// owner 2026-07-21 (#102): the fork server address is the baked DDNS FORK_SERVER_HOST (settings.ts); the old
// editable IP input + applyForkIp were removed so distributed builds can't be misdirected. An advanced
// settings.forkHost override exists (empty by default) but has no dedicated input yet. Local dev = 'local' target.

// Owner ruling (08-18): the header server plates are DEPRECATED as controls — the FUMBBL plate is
// removed entirely and the Super FUMBBL plate is now inert branding (see the header template below).
// selectServerTop (formerly wired to both plates' @click) has no remaining caller — target selection
// now lives on the blades themselves: CreateGameModal (Play → Super FUMBBL) applies 'fork' itself,
// the Play blade's "PLAY ON FUMBBL" card opens a .jnlp whose routing sets the target, and the Spectate
// blade's own selector (SpectateBrowserView.vue) applies 'fumbbl' when a Spectate action needs it.
// No flow was found whose ONLY server-switch path was the header plate.

function selectMode(mode: 'play' | 'spectate' | 'team') {
  view.value = mode;
  ui.browserOpen = false;
}

function selectBlade(nextView: AppView) {
  if (nextView === 'team') {
    tournamentBuilderPackage.value = '';
    tournamentBuilderLaunchRevision.value += 1;
  }
  view.value = nextView;
  ui.browserOpen = false;
}

/** Connect through the target selected by the Spectate row action. FUMBBL and Super FUMBBL each apply their
 * target before emitting; overriding it here strands fork game ids on the official server. */
function openSpectateGame(gameId: number) {
  view.value = 'spectate';
  ui.browserOpen = false;
  void gameStore.connect({
    ...prepareSelectedSpectateConnection(),
    gameId: Number(gameId),
  });
}

/** Owner 08-18 sighting: dismiss the spectate connect-error modal below without waiting for a
 *  fresh connect() to clear it (e.g. the user just wants the browser list back). */
function dismissSpectateError(): void {
  gameStore.state.spectateConnectError = null;
  gameStore.state.joinError = null;
}
/** Retry the same attempt via the store's existing Reconnect path (re-uses lastConnect, which
 *  connect() records before it can fail — so it's populated even for a first-attempt failure). */
function retrySpectate(): void {
  dismissSpectateError();
  gameStore.reconnect();
}

/**
 * Q5 (owner 2026-07-02): the Game Menu embeds FFB-style game statistics.
 * Everything here is SERVER-provided — sums over gameResult playerResults —
 * mirroring upstream DialogGameStatistics' team comparison.
 */
const statsOpen = ref(false);

const gameStats = computed(() => {
  const game = gameStore.game.value;
  if (!game) return null;
  const sum = (side: 'Home' | 'Away', field: string) =>
    (game.gameResult[`teamResult${side}`].playerResults as Record<string, unknown>[]).reduce(
      (total, r) => total + (Number(r[field]) || 0),
      0,
    );
  const rows: [string, number, number][] = [
    ['Touchdowns', game.gameResult.teamResultHome.score, game.gameResult.teamResultAway.score],
    ['Blocks', sum('Home', 'blocks'), sum('Away', 'blocks')],
    ['Fouls', sum('Home', 'fouls'), sum('Away', 'fouls')],
    ['Completions', sum('Home', 'completions'), sum('Away', 'completions')],
    ['Interceptions', sum('Home', 'interceptions'), sum('Away', 'interceptions')],
    ['Casualties', sum('Home', 'casualties'), sum('Away', 'casualties')],
    ['Passing yards', sum('Home', 'passing'), sum('Away', 'passing')],
    ['Carried ball', sum('Home', 'rushing'), sum('Away', 'rushing')],
    ['Earned SPPs', sum('Home', 'currentSpps'), sum('Away', 'currentSpps')],
  ];
  return { home: game.teamHome.teamName, away: game.teamAway.teamName, rows };
});

const LEAVE_GAME_DIALOG_ID = 'leaveGame' as const;
const leaveGameDialog = dialogDescriptor(LEAVE_GAME_DIALOG_ID);
const leaveGamePrompt = ref(false);
const leaveGamePromptMessage = computed(() => gameStore.isPlaying.value
  ? 'The game is saved. You do not concede or forfeit.'
  : 'You will stop spectating. The game is saved.');

function requestLeaveGame() {
  // Registry-owned as a client-local dialog: opening this gate never resolves or
  // synthesizes a server dialog/wire command.
  if (leaveGameDialog?.handling !== 'client-local-only') return;
  leaveGamePrompt.value = true;
}

function cancelLeaveGame() {
  leaveGamePrompt.value = false;
}

function confirmLeaveGame() {
  leaveGamePrompt.value = false;
  ui.gameMenuOpen = false;
  statsOpen.value = false;
  gameStore.leaveGame();
  // Teardown first so the live-game render precedence and hidden blade ribbon are gone
  // before selecting Play (the console shell's landing blade, owner ruling: Hub deprecated).
  selectBlade('play');
}

/** Owner 08-19: endgame exits (spectate pair + the player card's Return to Menu) — the confirm-free
 *  leave-game path (the game is over, nothing to concede) landing in the BLADE shell per
 *  endGameExitPlan: menu → Play-blade home, browser → Spectate blade (SpectateBrowserView).
 *  browserOpen stays false — the legacy in-game browser overlay is deprecated as an endgame target. */
function onEndGameExit(exit: EndGameExit) {
  const plan = endGameExitPlan(exit);
  leaveGamePrompt.value = false;
  ui.gameMenuOpen = false;
  statsOpen.value = false;
  gameStore.leaveGame();
  view.value = plan.view;
  ui.browserOpen = plan.browserOpen;
}

function escLeaveGame(event: KeyboardEvent) {
  if (event.code !== 'Escape' || !leaveGamePrompt.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  cancelLeaveGame();
}

watch(leaveGamePrompt, (open) => {
  if (open) window.addEventListener('keydown', escLeaveGame, true);
  else window.removeEventListener('keydown', escLeaveGame, true);
});
onBeforeUnmount(() => window.removeEventListener('keydown', escLeaveGame, true));

function captureKey(event: KeyboardEvent) {
  if (!capturingKey.value) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.code !== 'Escape') settings[capturingKey.value] = event.code;
  capturingKey.value = null;
}
</script>

<template>
  <main v-if="!firstOpenGateOpen" class="shell" :class="{ 'cb-redgreen': settings.colorblindMode === 'redgreen' }">
    <header v-if="!gameStore.game.value || settings.uiMode === 'classic'" class="shell-header"
      :class="{ 'header-compact': !!gameStore.game.value }">
      <button ref="hamburgerButton" class="hamburger" type="button" title="Menu"
        :aria-expanded="menuOpen" :aria-busy="replayFileBusy" @click="toggleAppMenu">☰</button>
      <!-- Owner ruling (08-18): the header server plates are DEPRECATED as CONTROLS — the blades now own
           target selection (Play blade cards, Spectate's own selector, TeamBuilder etc). The FUMBBL plate
           is removed entirely; Super FUMBBL stays as pure INERT branding (a logo, not a button) — no click
           handler, no data-active/aria-pressed, no hover affordance. The ALPHA RELEASE stamp stays. -->
      <div class="server-switcher" role="group" aria-label="Server">
        <div class="server-plate server-plate-super server-plate-inert" aria-label="Super FUMBBL">
          <img :src="superFumbblLogoUrl" alt="Super FUMBBL" />
        </div>
      </div>
      <!-- owner 2026-07-03 r5: stencil "ALPHA RELEASE" stamp -->
      <span class="alpha-stamp" aria-label="Alpha release">ALPHA RELEASE</span>
      <!-- owner 2026-07-14: build credit + Twitch link MOVED off the menu bar to the bottom-left of the
           opening credentials splash panel (.splash-build-credit below). -->
      <!-- session state + Disconnect, moved off the removed connect bar (Option A) -->
      <!-- Owner ruling (08-18): the "Signed in as" identity block and the "Alpha — spectate & play
           vX" tagline both move OUT of the header — identity relocates to the bottom-right corner
           stack (with the version stamp, below); the tagline text is dropped outright (the ALPHA
           RELEASE stamp above already carries the alpha branding, and the version now lives only in
           the corner stamp). With the FUMBBL plate gone too (ruling 4), the header's right side is
           just the hamburger. -->
    </header>

    <!-- Fives integration (risk-b): the blade ribbon is the console shell nav — HIDE it during a live game so it
         doesn't steal ~42px above the pitch AND so a mid-game blade click can't desync `view` under the live-game
         render precedence (which always wins while gameStore.game is set). The in-game menu (☰) owns navigation then. -->
    <!-- Owner ruling (console shell restructure): the ribbon is ONE merged blade tree — Hub is gone (Play is
         the landing blade for both server plates), and the fork-only blades (Team/League/Players/Store) stay
         reachable alongside Play/Spectate/Replay rather than swapping out under a second parallel branch. -->
    <nav v-if="!gameStore.game.value" class="blade-ribbon" aria-label="Console views">
      <template v-if="view === 'console'">
        <button class="blade" type="button" :data-active="true" @click="view = 'console'">Protocol console</button>
      </template>
      <template v-else>
        <button class="blade" type="button" :data-active="view === 'play'" @click="selectBlade('play')">Play</button>
        <button class="blade" type="button" :data-active="view === 'spectate'" @click="selectBlade('spectate')">Spectate</button>
        <button class="blade" type="button" :data-active="view === 'replay'" @click="selectBlade('replay')">Replay</button>
        <span class="blade-ribbon-sep" aria-hidden="true"></span>
        <button class="blade" type="button" :data-active="view === 'team'" @click="selectBlade('team')">Team</button>
        <!-- Tournaments / Statistics ribbon entries pulled (owner 09-07: "for now") — like the League/Players/Store
             entries removed 08-18 ("scope those back in later"): AppView values + mounts kept for the return; the
             scheduled-match notification can still route to the tournaments view. -->
      </template>
    </nav>

    <div v-if="menuOpen" class="app-menu" @click.self="menuOpen = false">
      <div class="app-menu-panel" :style="menuAnchor ?? undefined">
        <!-- Owner ruling (console shell restructure): the fork quick-play stopgap is retired — the Play blade
             (ribbon default) now owns both "PLAY ON FUMBBL" / "PLAY ON SUPER FUMBBL" entry cards directly. -->
        <button type="button" :disabled="replayFileBusy || gameStore.replay.loading" :aria-busy="replayFileBusy"
          @click="openReplayFilePicker">{{ replayFileBusy ? 'Reading Replay File…' : 'Load Replay File' }}</button>
        <!-- owner 2026-07-04: a single Settings entry into the full settings tree
             (the individual tabs live inside the modal). -->
        <button @click="openSettings()">Settings</button>
        <!-- owner 2026-07-14: the getting-started guide is surfaced on demand here (no longer auto-launch).
             owner 2026-08-27: it's the paginated Field Manual now. -->
        <button @click="menuOpen = false; guideOpen = true">Help / Field Manual</button>
        <!-- owner 2026-07-03 r6f: dev-only tools hidden behind a Dev controls toggle -->
        <button class="menu-section" @click="devOpen = !devOpen">Dev controls {{ devOpen ? '▾' : '▸' }}</button>
        <button v-if="devOpen" class="menu-sub" @click="openConsole()">Protocol console</button>
      </div>
    </div>
    <input ref="replayFileInput" type="file" hidden
      accept="application/json,application/x-java-jnlp-file,text/xml,.json,.ffbreplay,.jnlp"
      aria-hidden="true" tabindex="-1" @change="loadReplayFileFromMenu" @cancel="cancelReplayFilePicker" />
    <div v-if="ambiguousJnlpEntry" class="launch-splash" role="alertdialog" aria-modal="true"
      aria-labelledby="jnlp-choice-title">
      <div class="splash-content">
        <h2 id="jnlp-choice-title">Open this JNLP as replay or live?</h2>
        <p>The JNLP does not match one unique upstream launch shape: {{ ambiguousJnlpEntry.request.entryClassification.reason }}</p>
        <div class="splash-actions">
          <button type="button" @click="chooseAmbiguousJnlp('replay')">Replay</button>
          <button type="button" @click="chooseAmbiguousJnlp('live')">Live</button>
          <button type="button" @click="cancelAmbiguousJnlpEntry()">Cancel</button>
        </div>
      </div>
    </div>
    <div v-if="replayFileError" class="replay-file-alert" role="alert" aria-live="assertive">
      <span>{{ replayFileError }}</span>
      <button type="button" aria-label="Dismiss replay file error" @click="replayFileError = ''">×</button>
    </div>

    <!-- owner 2026-07-08 (FC): view-layer fork — the FUMBBL-Classic presentation
         mounts instead of SpectateView when the mode is set (shared store). -->
    <template v-if="!!gameStore.game.value">
      <ClassicView v-if="settings.uiMode === 'classic' && !gameStore.isReplay.value" :mode="liveGameMode as 'play' | 'spectate'" @select-mode="selectMode" />
      <SpectateView v-else :mode="liveGameMode" @end-game-exit="onEndGameExit" @open-menu="openGameMenu" />
    </template>
    <!-- Owner ruling (console shell restructure): Play blade is up for BOTH server plates — the "PLAY ON
         SUPER FUMBBL" entry card (CreateGameModal) replaces the old fork stopgap that routed here into
         SpectateView's play mode. Hub is deprecated — its dashboard was placeholder-only (no live target
         for Next Match / Team Snapshot / Upcoming Matches / the three Quick Action buttons), so it retires
         with no migration rather than adding dead weight to Play. -->
    <!-- Owner: the current BUILD survives clicking away — the blade switch rides inside a KeepAlive that
         caches ONLY TeamBuilderView (include filter; every other blade mounts/unmounts exactly as before),
         so returning to Team restores the draft (slots, name, mode, pack, skills) instead of a reset.
         Entering a live game unmounts the KeepAlive (the game branch above) — that edge drops the draft. -->
    <KeepAlive v-else include="TeamBuilderView">
      <PlayView v-if="view === 'play'" />
      <SpectateBrowserView v-else-if="view === 'spectate'" @spectate="openSpectateGame" />
      <ReplayLauncherView v-else-if="view === 'replay'" />
      <TeamBuilderView v-else-if="view === 'team'" :initial-mode="tournamentBuilderPackage ? 'tournament' : 'create'" :initial-package-name="tournamentBuilderPackage" :launch-revision="tournamentBuilderLaunchRevision" />
      <TournamentsView v-else-if="view === 'tournaments'" @create-team="openTournamentTeamBuilder" />
      <StatisticsView v-else-if="view === 'statistics'" />
      <div v-else-if="view === 'league'" class="ui-placeholder">League — Place Holder</div>
      <div v-else-if="view === 'players'" class="ui-placeholder">Players — Place Holder</div>
      <div v-else-if="view === 'store'" class="ui-placeholder">Store — Place Holder</div>
      <ProtocolConsole v-else />
    </KeepAlive>

    <!-- Owner 08-18 sighting fix: a spectate connect failure previously left NO trace anywhere the
         user could see — the joinError/connectionClosed overlays live inside SpectateView.vue, which
         only mounts once gameStore.game is set, and a failed connect never sets game (App.vue falls
         back to SpectateBrowserView instead, looking as if nothing happened). This modal renders at
         the app-shell level, keyed on gameStore.state.spectateConnectError, so every silent-death
         path (socket refused/errored before open, join timeout, close before a game arrived) is
         visible regardless of which blade is showing. Reuses the save-prompt modal idiom (W30). -->
    <div v-if="!gameStore.game.value && gameStore.state.spectateConnectError" class="modal-backdrop save-prompt-backdrop"
      @click.self="dismissSpectateError()">
      <div class="save-prompt spectate-error-prompt">
        <h3>Couldn't spectate game {{ gameStore.state.spectateConnectError.gameId }}</h3>
        <p class="hint">{{ gameStore.state.spectateConnectError.message }}</p>
        <p class="hint spectate-error-detail">{{ gameStore.state.spectateConnectError.detail }}</p>
        <div class="save-prompt-actions">
          <button class="primary" @click="retrySpectate()">Retry</button>
          <button @click="dismissSpectateError()">Dismiss</button>
        </div>
      </div>
    </div>

    <!-- Owner 08-18: REJOIN progress/failure modal — same silent-death class as the spectate fix
         above (join overlays live in SpectateView, which never mounts when the join fails before
         a game arrives). App-shell mount so the Play-blade rejoin is visible end-to-end; renders
         nothing unless a tracked rejoin attempt is live (rejoinFlow.ts). -->
    <RejoinProgressModal />

    <!-- owner 2026-07-10: Developer log panel (unlocked by `-dev`, toggled in Settings → Developer). -->
    <DevPanel v-if="settings.devPanelOpen" />

    <!-- Game Menu (Esc; owner 2026-07-02 — first step toward the BB3-style shell) -->
    <div v-if="ui.gameMenuOpen" class="modal-backdrop game-menu-backdrop" @click.self="ui.gameMenuOpen = false">
      <div class="game-menu" :data-wide="statsOpen">
        <h2>Game Menu</h2>
        <template v-if="!statsOpen">
          <button @click="ui.gameMenuOpen = false">Resume</button>
          <button :disabled="!gameStats" :title="gameStats ? '' : 'No game loaded'"
            @click="statsOpen = true">Game statistics</button>
          <button @click="openSettings('general')">Settings</button>
          <button :disabled="!gameStore.game.value"
            :title="gameStore.game.value ? '' : 'No game loaded'"
            @click="requestLeaveGame()">Return to Menu</button>
          <!-- Owner 2026-07-06 (note 5): request to concede (play mode only). The
               server confirms via the concedeGame dialog if concession is legal. -->
          <button :disabled="!gameStore.canConcedeGame"
            :title="gameStore.canConcedeGame ? 'Request to concede the game' : 'Available only at the start of your turn'"
            @click="gameStore.concedeGame(); ui.gameMenuOpen = false">Concede</button>
          <p class="hint">Esc closes</p>
        </template>
        <template v-else-if="gameStats">
          <table class="stats-table">
            <thead>
              <tr>
                <th class="home">{{ gameStats.home }}</th>
                <th></th>
                <th class="away">{{ gameStats.away }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="[label, home, away] in gameStats.rows" :key="label">
                <td class="home">{{ home }}</td>
                <td class="stat-label">{{ label }}</td>
                <td class="away">{{ away }}</td>
              </tr>
            </tbody>
          </table>
          <button @click="statsOpen = false">Back</button>
        </template>
      </div>
    </div>

    <!-- W30: reuse the owner-approved compact save-prompt visual. SpectateView's
         yes/no rail is activation-scoped and must not own app-shell navigation. -->
    <div v-if="leaveGamePrompt" class="modal-backdrop save-prompt-backdrop"
      :data-dialog-id="LEAVE_GAME_DIALOG_ID" @click.self="cancelLeaveGame()">
      <div class="save-prompt">
        <h3>Leave the game and return to the menu?</h3>
        <p class="hint">{{ leaveGamePromptMessage }}</p>
        <div class="save-prompt-actions">
          <button class="primary" @click="confirmLeaveGame()">Return to Menu</button>
          <button @click="cancelLeaveGame()">Stay in game</button>
        </div>
      </div>
    </div>

    <div v-if="tournamentNotificationState.active" class="match-ready-popup" role="alertdialog" aria-live="assertive">
      <button class="match-ready-close" type="button" title="Dismiss" @click="dismissTournamentNotification(tournamentNotificationState.active!.id)">✕</button>
      <h3>{{ tournamentNotificationState.active.kind === 'test' ? 'Notification test' : 'Your opponent is waiting' }}</h3>
      <p>{{ tournamentNotificationState.active.message }}</p>
      <button v-if="tournamentNotificationState.active.kind === 'match-waiting'" class="primary" type="button" @click="openTournamentNotification">Open tournament match</button>
    </div>
    <div v-if="settingsOpen" class="modal-backdrop" @click.self="requestCloseSettings()"
      @keydown.capture="captureKey" tabindex="-1">
      <!-- owner 2026-07-06: large settings window — left sidebar of categories,
           the selected category's controls fill the scrollable content pane. -->
      <div ref="settingsDialog" class="settings-pane" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title"
        @keydown="trapSettingsFocus">
        <button class="settings-x" type="button" aria-label="Cancel changes and close settings" title="Close settings" @click="requestCloseSettings()">✕</button>
        <SettingsCategoryNav v-model="settingsTab" />

        <div class="settings-main">
          <SettingsCategoryNav v-model="settingsTab" compact @content-focus="selectSettingsTab(settingsTab, true)" />
        <div :id="`settings-panel-${settingsTab}`" class="settings-content" role="tabpanel"
          :aria-labelledby="`settings-tab-${settingsTab}`">
        <h2 tabindex="-1">{{ activeSettingsSection.label }}</h2>
        <!-- ============================ GENERAL ============================ -->
        <section v-if="settingsTab === 'general'">
          <AccountSettings />

          <fieldset class="settings-group">
            <legend>Connection</legend>
            <label>Login credentials
              <button type="button" class="creds-open-btn" @click="openCredsMenu('fumbbl')">Manage login credentials ▸</button>
            </label>
            <p class="settings-immediate-note">Account and verification changes take effect immediately and are not undone by Cancel.</p>
            <p class="creds-status">
              <span>FUMBBL: <b>{{ settings.coach.trim() || '—' }}</b></span>
              <span class="connection-fork-status">
                <span>Super FUMBBL:
                  <b v-if="forkChallenge.kind === 'ok'">✓ {{ settings.coach40k.trim() }}</b>
                  <button
                    v-else
                    type="button"
                    class="creds-challenge-btn"
                    :disabled="forkChallenge.kind === 'checking'"
                    @click="verifyForkCredentials"
                  >{{ forkChallenge.kind === 'checking' ? 'Verifying…' : 'Verify' }}</button>
                </span>
                <span
                  v-if="forkChallenge.kind === 'checking' || forkChallenge.kind === 'warn' || forkChallenge.kind === 'fail'"
                  class="creds-challenge-result"
                  :data-kind="forkChallenge.kind"
                >{{ forkChallenge.message }}</span>
              </span>
            </p>
            <p class="hint">Credentials are stored locally on this machine only.</p>
            <label>Server
              <input v-model="settings.url" placeholder="ws://host:port/command" />
            </label>
            <label>Tournament Bot URL <span class="hint-inline">(optional — blank = https://&lt;fork host&gt;, or http://&lt;local host&gt;:4310)</span>
              <input v-model="settings.botConfigUrl" type="text" placeholder="bot URL (optional)" />
            </label>
            <label class="row"><input v-model="settings.compression" type="checkbox" /> LZ-String compression</label>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Launch screens</legend>
            <label class="row"><input v-model="settings.hideWelcomeSplash" type="checkbox" /> <span>Hide the welcome splash on launch</span></label>
            <label class="row"><input v-model="settings.hideCredsSplash" type="checkbox" /> <span>Hide the account-setup splash on launch</span></label>
            <label class="row"><input v-model="settings.hideTutorialSplash" type="checkbox" /> <span>Hide the getting-started tutorial on launch</span></label>
            <div class="actions" style="justify-content: flex-start">
              <button type="button" @click="replayIntro()">Replay the intro screens now</button>
            </div>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Gameplay assistance</legend>
            <label class="row">
              <span>Tackle zones shown</span>
              <select v-model="settings.tackleZoneMode">
                <option value="opposition">Opposition</option>
                <option value="friendly">Friendly</option>
                <option value="both">Both</option>
              </select>
            </label>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Movement planner</legend>
            <label class="row">
              <span>Declare Blitz</span>
              <select v-model="settings.declareBlitzBehavior">
                <option value="fumbbl">FUMBBL (default)</option>
                <option value="modern">Modern</option>
              </select>
            </label>
            <p class="hint">FUMBBL: declare Blitz from the player context menu. Modern: select your player,
              then an opponent; click the target again (or use Confirm) to commit the previewed route.</p>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Auras</legend>
            <label class="row">
              <span>Disturbing Presence <em class="aura-swatch dp-friendly" />/<em class="aura-swatch dp-opp" /></span>
              <select v-model="settings.auraDisturbingPresence">
                <option value="selected">On when selected (default)</option>
                <option value="always">Always on</option>
                <option value="off">Off</option>
              </select>
            </label>
            <label class="row">
              <span>Pick-Me-Up <em class="aura-swatch pmu-friendly" />/<em class="aura-swatch pmu-opp" /></span>
              <select v-model="settings.auraPickMeUp">
                <option value="selected">On when selected (default)</option>
                <option value="always">Always on</option>
                <option value="off">Off</option>
              </select>
            </label>
            <p class="hint">Each aura shades a 3-square radius. Colour marks side —
              friendly (home) vs opposition (away): Disturbing Presence blue/red, Pick-Me-Up green/beige.</p>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Keyboard</legend>
            <label class="row">
              <span>Confirm move / pass target</span>
              <button class="keybind" @click="capturingKey = 'confirmKey'">
                {{ capturingKey === 'confirmKey' ? 'press a key…' : keyLabel(settings.confirmKey) }}
              </button>
            </label>
            <div class="row"><span>Clear selection / close</span><span class="keybind static">Esc</span></div>
            <div class="row"><span>Pick action 1–6 (selected player)</span><span class="keybind static">1 – 6</span></div>
            <div class="row"><span>Camera pan</span><span class="keybind static">W A S D</span></div>
            <div class="row"><span>Open chat</span><span class="keybind static">Enter</span></div>
            <div class="row"><span>Mark square / player arrow</span><span class="keybind static">Shift + click</span></div>
            <div class="row"><span>Mark row · column</span><span class="keybind static">Ctrl+Shift · Alt+Shift + click</span></div>
            <label class="row">
              <span>Camera pan speed</span>
              <input v-model.number="settings.cameraPanSpeed" type="range" min="2" max="30" step="1" />
              <span>{{ settings.cameraPanSpeed }} px</span>
            </label>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Mouse</legend>
            <label class="row">
              <input v-model="settings.friendlyPlayerSwitch" type="checkbox" />
              <span>Left click switches friendly players</span>
            </label>
            <p class="hint">Refunds an untouched declaration. After the server confirms any movement, action,
              skill, or effect was consumed, the click ends the current activation without activating the next player.</p>
            <label class="row">
              <input v-model="settings.leftClickOpensContextMenu" type="checkbox" />
              <span>Left click opens context menu</span>
            </label>
            <p class="hint">Shows the selected friendly player's legal actions instead of immediately declaring Move.
              Right click always opens the player context menu; Shift+click marks (see Keyboard).</p>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Cinematics</legend>
            <!-- Owner 08-19: "Injury cinematics" retired — cinematicMode had zero consumers (dead since
                 the injury-banner rework); the dropdown promised behavior that no longer exists. -->
            <label class="row">
              <input v-model="settings.clickDismissCinematics" type="checkbox" />
              <span>Require click to dismiss splash screens</span>
            </label>
          </fieldset>

          <fieldset v-if="jnlpAssocSupported" class="settings-group">
            <legend>FUMBBL join files (.jnlp)</legend>
            <p class="hint">
              Opening a FUMBBL <code>.jnlp</code> join/replay link launches this app instead of Java
              Web Start. Per-user setting only — no admin rights needed, and reversible any time.
            </p>
            <p class="settings-immediate-note">This changes Windows immediately and is not undone by Cancel.</p>
            <div class="actions" style="justify-content: flex-start">
              <button type="button" :disabled="jnlpAssocBusy" @click="toggleJnlpAssociation()">
                {{ jnlpAssocOn ? 'Remove .jnlp association' : 'Associate .jnlp files with this app' }}
              </button>
              <span v-if="jnlpAssocOn" class="hint">Currently associated with this app.</span>
            </div>
            <p v-if="jnlpAssocError" class="hint" style="color: var(--danger, #e05555)">{{ jnlpAssocError }}</p>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Match log</legend>
            <label class="row">
              <input v-model="settings.showServerSequencingEvents" type="checkbox" />
              <span>Show server sequencing events</span>
            </label>
            <p class="hint">Shows internal plan and play steps such as server-resolved movement. Hidden entries remain available and appear immediately when enabled.</p>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Diagnostics</legend>
            <label class="row">
              <input v-model="settings.debugLog" type="checkbox" />
              <span>Verbose log (all events, not just dice rolls)</span>
            </label>
            <label class="row">
              <input v-model="settings.wireLog" type="checkbox" />
              <span>Verbose wire log → file (one per game)</span>
            </label>
            <div v-if="settings.wireLog" style="margin: 2px 0 4px 24px;">
              <template v-if="gameStore.state.wireLogFile">
                <input type="text" readonly :value="gameStore.state.wireLogFile"
                  @focus="($event.target as HTMLInputElement).select()"
                  style="width: 100%; font-size: max(var(--ui-min-text-size, 12px), 11px); padding: 3px 5px; box-sizing: border-box;" />
                <button type="button" @click="copyWireLogPath" style="margin-top: 4px; font-size: max(var(--ui-min-text-size, 12px), 11px);">
                  {{ wireLogCopied ? 'Copied!' : 'Copy path' }}
                </button>
              </template>
              <span v-else class="hint">Writes one JSONL file per game to the app log folder (packaged build only).</span>
            </div>
            <label class="row">
              <input v-model="settings.devPanelOpen" type="checkbox" />
              <span>Show developer log panel</span>
            </label>
            <span class="hint">The dev stream is always captured (it rides bug reports); this only shows the live panel.</span>
          </fieldset>
        </section>

        <!-- ============================ ACCESSIBILITY ============================ -->
        <section v-if="settingsTab === 'accessibility'">
          <fieldset class="settings-group">
            <legend>Text and contrast</legend>
            <label class="row">
              <span>UI font</span>
              <select v-model="settings.uiFont">
                <option value="nuffle">Nuffle (Blood Bowl)</option>
                <option value="system">System</option>
                <option value="arial">Arial / Helvetica</option>
              </select>
            </label>
            <label class="row">
              <span>Minimum text size</span>
              <input v-model.number="settings.uiTextSize" type="range" min="12" max="20" step="1" />
              <span>{{ settings.uiTextSize }}px</span>
            </label>
            <p class="hint">Sub-headers and annotations are kept at or above this size; primary text never drops below 16px. Raising this past 16 lifts everything together.</p>
            <label class="row">
              <span>Brightness</span>
              <input v-model.number="settings.brightness" type="range" min="50" max="150" step="5" />
              <span>{{ settings.brightness }}%</span>
            </label>
            <label class="row">
              <span>Colourblind mode</span>
              <select v-model="settings.colorblindMode">
                <option value="off">Off</option>
                <option value="redgreen">Red-green (remap green accents to blue)</option>
              </select>
            </label>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Grid lines</legend>
            <label class="row">
              <input v-model="settings.gridLines" type="checkbox" />
              <span>Show pitch grid lines</span>
            </label>
            <label class="row">
              <span>Line width</span>
              <input v-model.number="settings.gridLineWidth" type="range" min="0.1" max="3" step="0.1" :disabled="!settings.gridLines" />
              <span>{{ settings.gridLineWidth }}×</span>
            </label>
            <label class="row">
              <span>Line color</span>
              <input v-model="settings.gridLineColor" type="color" :disabled="!settings.gridLines" />
            </label>
            <label class="row">
              <span>Line opacity</span>
              <input v-model.number="settings.gridLineOpacity" type="range" min="0.1" max="1" step="0.05" :disabled="!settings.gridLines" />
              <span>{{ Math.round(settings.gridLineOpacity * 100) }}%</span>
            </label>
            <p class="hint">Turning grid lines off, widening or recolouring them helps legibility over busy pitch textures.</p>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Echos</legend>
            <label class="row">
              <input v-model="settings.activePlayerEcho" type="checkbox" />
              <span>Selection echo (on the active player)</span>
            </label>
            <label class="row">
              <input v-model="settings.clickEcho" type="checkbox" />
              <span>Cursor click echo</span>
            </label>
            <label class="row">
              <span>Echo colour</span>
              <input v-model="settings.clickEchoColor" type="color" :disabled="!settings.clickEcho" />
            </label>
            <label class="row">
              <span>Echo size</span>
              <input v-model.number="settings.echoSize" type="range" min="0.5" max="2" step="0.1" :disabled="!settings.clickEcho" />
              <span>{{ settings.echoSize }}×</span>
            </label>
            <div class="echo-preview" :style="{ '--click-echo-color': settings.clickEchoColor, '--echo-scale': settings.echoSize }">
              <span class="echo-preview-ring"></span>
              <em>preview</em>
            </div>
          </fieldset>
        </section>

        <!-- ============================ DISPLAY ============================ -->
        <section v-if="settingsTab === 'display'">
          <fieldset class="settings-group">
            <legend>Video</legend>
            <label class="row">
              <span>Resolution scale</span>
              <select v-model.number="settings.renderScale">
                <option :value="0">Auto (display native)</option>
                <option :value="0.5">50%</option>
                <option :value="0.75">75%</option>
                <option :value="1">100% (display native)</option>
                <option :value="1.5">150%</option>
                <option :value="2">200%</option>
                <option :value="3">300%</option>
                <option :value="4">400%</option>
              </select>
            </label>
            <label class="row">
              <span>FPS limit</span>
              <select v-model.number="settings.fpsCap">
                <option :value="30">30</option>
                <option :value="60">60</option>
                <option :value="120">120</option>
              </select>
            </label>
            <div class="actions" style="justify-content: flex-start">
              <button @click="toggleFullscreen">{{ fullscreen ? 'Exit native fullscreen' : 'Native fullscreen' }}</button>
            </div>
            <p class="hint">Uses the desktop window's native fullscreen mode{{ fullscreenIsNative ? '.' : '; browser preview uses webpage fullscreen.' }}</p>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Pitch</legend>
            <label class="row">
              <span>Pitch orientation</span>
              <select v-model="settings.pitchOrientation">
                <option value="ns">North–south (end zones top/bottom)</option>
                <option value="ew">East–west (end zones left/right)</option>
              </select>
            </label>
            <label class="row">
              <input v-model="settings.flatRender" type="checkbox" />
              <span>Flat (non-isometric) pitch</span>
            </label>
            <label class="row">
              <input v-model="settings.showStadium" type="checkbox" />
              <span>Stadium</span>
            </label>
            <label class="row">
              <span>Tileset (turf)</span>
              <select v-model="settings.turf">
                <option v-for="t in turfCatalog.options" :key="t" :value="t">{{ TURF_LABELS[t] ?? t }}</option>
              </select>
            </label>
            <label v-if="settings.uiMode === 'classic'" class="row">
              <span>Classic effects</span>
              <input type="checkbox" v-model="settings.classicEffects" />
            </label>
            <p v-if="settings.uiMode === 'classic'" class="hint">Off = the pure classic look. On opts our cinematics (push arrows, turnover…) into FUMBBL Classic.</p>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Player sprites</legend>
            <label class="row">
              <span>Player sprites</span>
              <select v-model="spriteChoice">
                <option value="walk">Super FUMBBL</option>
                <template v-if="fumbblSpriteModesAvailable">
                  <option value="checkers">FUMBBL Checkers</option>
                </template>
                <option v-for="pack in spritePackOptions" :key="pack.installId" :value="spritePackValue(pack)">{{ pack.name }} {{ pack.version }}</option>
              </select>
            </label>
            <p class="hint">Super FUMBBL is the built-in set: animated walk cycles for every BB2025 roster (Human, Necromantic Horror and Orc carry separate home/away kits; other teams share one kit), placeholder tokens for anything else. Installed sprite mods appear here by name and take precedence for the players they cover.<template v-if="fumbblSpriteModesAvailable"> FUMBBL Classic and Checkers draw from the installed FUMBBL iconset pack.</template></p>
            <label class="row">
              <input v-model="settings.walkAnimation" type="checkbox" />
              <span>Animate player walk cycles</span>
            </label>
            <label class="row">
              <span>Walk-cycle FPS (optional)</span>
              <input v-model.number="settings.walkFps" type="number" min="1" max="30" step="1"
                placeholder="Sheet default" :disabled="!settings.walkAnimation" />
            </label>
            <label class="row">
              <input v-model="settings.walkFaceCamera" type="checkbox" />
              <span>Idle players face the camera (home team faces south)</span>
            </label>
            <label class="row">
              <input v-model="settings.castShadows" type="checkbox" />
              <span>Cast shadows on players</span>
            </label>
            <label class="row">
              <input v-model="settings.uniformFigures" type="checkbox" />
              <span>Players stay one size across the pitch (North-South)</span>
            </label>
            <label class="row">
              <input v-model="settings.uniformFiguresEw" type="checkbox" />
              <span>Players stay one size across the pitch (East-West)</span>
            </label>
            <p class="hint">Sprites, dice and markers render at the same scale on every square and the far end of the pitch narrows less. Off is the classic depth scaling. North-South starts off, East-West starts on; each orientation keeps its own choice.</p>
            <label class="row">
              <input v-model="settings.oneSpritePerPosition" type="checkbox" />
              <span>One sprite per position</span>
            </label>
            <p class="hint">Uses the first available sprite variant for every player sharing the same position on a team. This is a local display override only.</p>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Movement animation</legend>
            <label class="row">
              <span>Movement animation</span>
              <select v-model="settings.moveStyle">
                <option value="trail">Slide + echo</option>
                <option value="slide">Slide (direct)</option>
                <option value="walk">Walk (tile-by-tile, step bob)</option>
                <option value="hop">Hop (per-tile arc)</option>
                <option value="hoptrail">Hop + path trail (bob with echo, default)</option>
              </select>
            </label>
            <label class="row">
              <span>Movement speed</span>
              <select v-model.number="settings.moveSpeedMs">
                <option :value="50">50ms — fastest</option>
                <option :value="100">100ms</option>
                <option :value="150">150ms (default)</option>
                <option :value="200">200ms</option>
                <option :value="300">300ms</option>
                <option :value="400">400ms — slowest</option>
              </select>
            </label>
            <label class="row" v-if="settings.moveStyle === 'trail' || settings.moveStyle === 'hoptrail'">
              <span>Path-trail colour</span>
              <select v-model="settings.trailColor">
                <option value="auto">Auto (contrast with background)</option>
                <option value="white">White</option>
                <option value="black">Black</option>
                <option value="gold">Gold</option>
              </select>
            </label>
            <label class="row" v-if="settings.moveStyle === 'trail' || settings.moveStyle === 'hoptrail'">
              <span>Path-trail marks</span>
              <select v-model="settings.trailMarks">
                <option value="echo">Echo footprints</option>
                <option value="numbers">Numbers (count squares moved, default)</option>
              </select>
            </label>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Dice</legend>
            <label class="row">
              <input v-model="settings.blockDice3d" type="checkbox" />
              <span>3D block dice</span>
            </label>
            <label class="row">
              <span>D6 style</span>
              <select v-model="settings.d6FaceVariant">
                <option value="brushed-metal">Brushed metal (default)</option>
                <option value="black">White</option>
              </select>
            </label>
            <label class="row">
              <span>Dice tumble ({{ settings.blockTumbleMs }}ms)</span>
              <input v-model.number="settings.blockTumbleMs" type="range" min="100" max="600" step="25" />
            </label>
            <label class="row">
              <span>Die-roll tag position</span>
              <select v-model="settings.dieTagPosition">
                <option value="corner">On die — top-right corner (default)</option>
                <option value="top">On die — top</option>
                <option value="side">To the side of the die</option>
                <option value="bottom">On die — bottom</option>
                <option value="off">Off</option>
              </select>
            </label>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Skill display</legend>
            <!-- B2-17: icons and markings are mutually exclusive display modes -->
            <label class="row">
              <span>Skill display</span>
              <select v-model="settings.skillDisplay">
                <option value="icons">Skill icons (badges)</option>
                <option value="markings">Skill markings (text)</option>
              </select>
            </label>
            <label class="row">
              <span>Action decorations</span>
              <select v-model="settings.actionDecorations">
                <option value="art">Super FUMBBL artwork</option>
                <option value="emoji">Emoji glyphs</option>
              </select>
            </label>
            <fieldset v-if="settings.skillDisplay === 'markings'" class="settings-group">
              <legend>Skill marking appearance</legend>
              <label class="row">
                <span>Color</span>
                <input v-model="settings.skillMarkingColor" type="color" />
              </label>
              <label class="row">
                <span>Font</span>
                <select v-model="settings.skillMarkingFont">
                  <option value="arial">Arial / Helvetica</option>
                  <option value="helvetica">Helvetica / Arial</option>
                  <option value="system">System sans</option>
                  <option value="nuffle">Nuffle</option>
                </select>
              </label>
              <label class="row">
                <span>Size</span>
                <input v-model.number="settings.skillMarkingSize" type="range" min="6" max="24" step="1" />
                <span>{{ settings.skillMarkingSize }}px</span>
              </label>
              <p class="hint">All glyphs for a player are antialiased and kept together on one line.</p>
            </fieldset>
            <!-- Per-skill display config (owner 2026-07-03 r6f): every skill in the
                 game, grouped into Skill Icons / Skill Markers, each with MY TEAM
                 (home coach) / OPPOSITION (away coach) behaviour + a marker glyph. -->
            <details class="skill-config">
              <summary>Skill display config — per-skill icons &amp; markers</summary>
              <div class="sc-instructions">
                <button type="button" class="sc-help-toggle" @click="showImportInstructions = !showImportInstructions">
                  {{ showImportInstructions ? '▾' : '▸' }} How to import FUMBBL skill markers (JSON)
                </button>
                <ol v-if="showImportInstructions" class="sc-steps">
                  <li>On <b>fumbbl.com</b>, open <b>Settings → Client Options → Markings</b> and set up the
                    markings you want (each rule = a skill/combo → a short marking).</li>
                  <li>Enter that same FUMBBL <b>coach name</b> under <b>Settings → General</b> here.</li>
                  <li>Choose <b>Skill Markings</b> above, then use the <b>“Import markings from
                    fumbbl.com”</b> button (or paste the raw JSON there).</li>
                  <li>Choose <b>Skill Markers</b> in the group dropdown and click
                    <b>“Pre-fill marker glyphs from JSON”</b> — this copies the FUMBBL glyphs into the
                    per-skill text fields. A value you type <b>overrides</b> the imported one.</li>
                  <li>Set each skill’s <b>My team</b> / <b>Opposition</b> behaviour to show the marker.</li>
                </ol>
              </div>
              <label class="row">
                <span>Configure</span>
                <select v-model="skillConfigGroup">
                  <option value="icons">Skill Icons</option>
                  <option value="markers">Skill Markers</option>
                </select>
              </label>
              <label class="row">
                <span>Render position</span>
                <select v-model="skillGroupPosition">
                  <option value="head">Over head</option>
                  <option value="feet">At feet</option>
                </select>
              </label>
              <div v-if="skillConfigGroup === 'markers'" class="sc-prefill">
                <button type="button" @click="prefillMarkerGlyphs">Pre-fill marker glyphs from JSON</button>
                <span class="hint">{{ skillPrefillStatus }}</span>
              </div>
              <input class="sc-filter" v-model="skillFilter" placeholder="Filter skills…" spellcheck="false" />
              <div class="sc-table" :data-markers="skillConfigGroup === 'markers'">
                <div class="sc-thead">
                  <span class="sc-skill">Skill</span>
                  <span v-if="skillConfigGroup === 'markers'">Marker</span>
                  <span>My team</span>
                  <span>Opposition</span>
                </div>
                <div v-for="skill in filteredSkills" :key="skill" class="sc-trow">
                  <span class="sc-skill" :title="skill">{{ skill }}</span>
                  <input v-if="skillConfigGroup === 'markers'" class="sc-glyph"
                    :value="skillMarkerText(skill)"
                    @input="setSkillMarkerText(skill, ($event.target as HTMLInputElement).value)"
                    maxlength="6" spellcheck="false" placeholder="glyph" />
                  <select :value="skillBehaviour(skill, skillKind, 'Mine')"
                    @change="setSkillBehaviour(skill, skillKind, 'Mine', ($event.target as HTMLSelectElement).value as SkillBehaviour)">
                    <option v-for="o in BEHAVIOUR_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                  <select :value="skillBehaviour(skill, skillKind, 'Opp')"
                    @change="setSkillBehaviour(skill, skillKind, 'Opp', ($event.target as HTMLSelectElement).value as SkillBehaviour)">
                    <option v-for="o in BEHAVIOUR_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </div>
              </div>
              <div class="actions" style="justify-content: flex-start">
                <button type="button" @click="resetSkillConfig">Reset per-skill config</button>
              </div>
            </details>
            <!-- owner 2026-07-06: FUMBBL auto-marking rules only surface when Skill
                 Markings are the chosen display (the raw-JSON box was removed). -->
            <div v-if="settings.skillDisplay === 'markings'" class="marking-editor">
              <div class="marking-rules" v-if="markingRules.length">
                <div v-for="(rule, i) in markingRules" :key="i" class="marking-rule">
                  <b>{{ rule.marking }}</b>
                  <span>{{ rule.skillArray.join(', ') || rule.injuryAttributes.join(', ') }}</span>
                  <em>{{ rule.applyTo.toLowerCase() }}{{ rule.gainedOnly ? ' · gained' : '' }}{{ rule.applyRepeatedly ? ' · repeat' : '' }}</em>
                  <button title="Remove rule" @click="removeMarkingRule(i)">✕</button>
                </div>
              </div>
              <div class="marking-add">
                <input v-model="newRule.skills" placeholder="Skills (comma-sep)" style="width: 130px" />
                <input v-model="newRule.marking" placeholder="Mark" style="width: 44px" />
                <select v-model="newRule.applyTo">
                  <option value="BOTH">Both</option>
                  <option value="OWN">Own</option>
                  <option value="OPPONENT">Opponent</option>
                </select>
                <label class="row"><input v-model="newRule.gainedOnly" type="checkbox" />gained</label>
                <button @click="addMarkingRule">Add</button>
              </div>
              <!-- #16 (owner 08-11): coach selector — autofilled with your coach, editable to import any coach's markings. -->
              <div class="actions" style="justify-content: flex-start; gap: 6px; flex-wrap: wrap;">
                <label class="row" style="gap: 4px;">Coach
                  <input v-model="importCoach" type="text" spellcheck="false" placeholder="FUMBBL coach" style="width: 11em;" /></label>
                <button @click="importMarkings">Import markings from fumbbl.com</button>
              </div>
              <p class="hint">{{ markingsStatus }}</p>
            </div>
          </fieldset>

          <fieldset class="settings-group">
            <legend>On-field markings</legend>
            <label class="row">
              <input v-model="settings.showRowMarkers" type="checkbox" />
              <span>Show row-number markers</span>
            </label>
            <label class="row">
              <input v-model="settings.showSweetSpot" type="checkbox" />
              <span>Show sweet-spot markers</span>
            </label>
            <label class="row">
              <input v-model="settings.showFieldLogos" type="checkbox" />
              <span>Show on-field team logos</span>
            </label>
            <!-- Owner 08-19: showPlayerNumbers + showBlockDice rows RETIRED from Settings > UI
                 (settings keep their defaults; toggles no longer surfaced). -->
            <!-- owner 2026-07-08: end-zone label — team name (FUMBBL) or TOUCHDOWN -->
            <label class="row">
              <span>End-zone label</span>
              <select v-model="settings.endZoneLabel">
                <option value="team">Team name</option>
                <option value="touchdown">TOUCHDOWN only</option>
              </select>
            </label>
            <!-- owner 09-05: red/blue end-zone shading (tile turf + Acasas pack) -->
            <label class="row">
              <input v-model="settings.endZoneTint" type="checkbox" />
              <span>Red/blue end-zone tint</span>
            </label>
            <!-- owner 2026-07-07: toggle the on-pitch turn/score/re-roll tracks -->
            <label class="row">
              <input v-model="settings.turnTrack" type="checkbox" />
              <span>On-pitch turn/score/re-roll tracks</span>
            </label>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Position rings</legend>
            <label class="row">
              <input v-model="settings.showPositionRings" type="checkbox" />
              <span>Show position rings under players</span>
            </label>
            <label class="row">
              <span>Ring density</span>
              <input v-model.number="settings.positionRingDensity" type="range" min="0.3" max="1.5" step="0.1" :disabled="!settings.showPositionRings" />
              <span>{{ settings.positionRingDensity }}×</span>
            </label>
            <label class="row">
              <span>Ring colour</span>
              <select v-model="settings.positionRingColor" :disabled="!settings.showPositionRings">
                <option value="auto">Auto (per position)</option>
                <option value="#f5c542">Gold</option>
                <option value="#ffffff">White</option>
                <option value="#66e0ff">Cyan</option>
                <option value="#ff8a8a">Red</option>
                <option value="#9ab8ff">Blue</option>
              </select>
            </label>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Injury results</legend>
            <label class="row">
              <span>Stun display</span>
              <select v-model="settings.stunDisplay">
                <option value="banner">Banner (full)</option>
                <option value="tag">Token tag (light)</option>
              </select>
            </label>
            <p class="hint">A STUN either interrupts with the full injury banner, or shows a light
              tag over the stunned player's token. KO &amp; casualties use the token-anchored toast.</p>
            <label class="row">
              <span>Casualty splash</span>
              <input type="checkbox" v-model="settings.casualtySplash" />
            </label>
            <p class="hint">The full-width casualty banner. Off by default — the red casualty toast over
              the square carries it; turn this on to also show the big splash.</p>
          </fieldset>
        </section>

        <!-- ============================ MODS ============================ -->
        <section v-if="settingsTab === 'mods'">
          <AssetPackSettings :live-game="gameStore.game.value" />
        </section>

        <!-- ============================ UI ============================ -->
        <section v-if="settingsTab === 'ui'">
          <fieldset class="settings-group">
            <legend>HUD layout</legend>
            <label class="row">
              <span>UI mode</span>
              <select v-model="settings.uiMode">
                <option value="fumbbl40k">Super FUMBBL (default)</option>
                <option value="classic">FUMBBL Classic</option>
              </select>
            </label>
            <p class="hint">FUMBBL Classic mirrors the classic Java client's layout &amp; prompts (preview).</p>
            <label v-if="settings.uiMode === 'fumbbl40k'" class="row">
              <span>Modern HUD style</span>
              <select v-model="settings.modernHudStyle">
                <option value="chrome">Console chrome (default)</option>
                <option value="minimalist">Minimalist</option>
              </select>
            </label>
            <p v-if="settings.uiMode === 'fumbbl40k'" class="hint">Chrome adds the molded retro-console casing. Minimalist keeps the compact, flatter HUD.</p>
            <label class="row">
              <input v-model="settings.bottomBarsSwapped" type="checkbox" />
              <span>Log bottom-left, Quick bar bottom-right</span>
            </label>
            <p class="hint">Puts the Log window at the bottom-left and the Quick bar (settings, tackle
              zones, skill icons, …) at the bottom-right, so the Log leads in reading order. On by
              default; uncheck to swap them back (Quick bar left, Log right).</p>
            <label class="row">
              <input v-model="settings.uiCustomize" type="checkbox" />
              <span>Customize UI layout (move / resize panels)</span>
            </label>
            <div v-if="settings.uiCustomize" class="actions" style="justify-content: flex-start">
              <button type="button" @click="resetPanelLayoutImmediately">Reset all panels now…</button>
            </div>
            <p v-if="settings.uiCustomize" class="settings-immediate-note">Resetting every panel changes the live layout immediately and is not undone by Cancel.</p>
            <p v-if="settings.uiCustomize" class="hint">Drag the ⠿ grip (top-left) to move a panel, the
              ⤡ handle (bottom-right) to resize it (contents scale with it), or ↺ to reset one. Panels:
              both coach corners, the scoreboard, and the quick bar.</p>
          </fieldset>

          <fieldset class="settings-group">
            <legend>UI theme</legend>
            <div class="theme-presets">
              <button type="button" class="theme-preset" :data-active="settings.uiTheme === 'brand-red'"
                @click="selectThemePreset('brand-red')">
                <span class="theme-swatch" :style="{ background: THEME_PRESETS['brand-red'].secondary, borderColor: THEME_PRESETS['brand-red'].primary }"></span>
                <span>Black / Red</span>
              </button>
              <button type="button" class="theme-preset" :data-active="settings.uiTheme === 'fumbbl'"
                @click="selectThemePreset('fumbbl')">
                <span class="theme-swatch" :style="{ background: THEME_PRESETS['fumbbl'].secondary, borderColor: THEME_PRESETS['fumbbl'].primary }"></span>
                <span>FUMBBL</span>
              </button>
              <button type="button" class="theme-preset" :data-active="settings.uiTheme === 'custom'"
                @click="selectThemePreset('custom')">
                <span class="theme-swatch" :style="{ background: settings.uiSecondary, borderColor: settings.uiPrimary }"></span>
                <span>Custom</span>
              </button>
            </div>
            <label class="row">
              <span>Primary (accent)</span>
              <input v-model="settings.uiPrimary" type="color" @input="onThemeColorEdit" />
            </label>
            <label class="row">
              <span>Secondary (base)</span>
              <input v-model="settings.uiSecondary" type="color" @input="onThemeColorEdit" />
            </label>
            <div class="theme-preview">
              <span class="theme-chip" :style="{ background: themePreview['--ui-primary'], color: themePreview['--ui-text-on-primary'] }">Primary</span>
              <span class="theme-chip" :style="{ background: themePreview['--ui-surface'], color: themePreview['--ui-text'], borderColor: themePreview['--ui-border'] }">Surface</span>
              <span class="theme-chip" :style="{ background: themePreview['--ui-active'], color: themePreview['--ui-text-on-primary'] }">Active</span>
              <span class="theme-chip" :style="{ background: themePreview['--ui-danger'], color: '#fff' }">Danger</span>
              <span class="theme-chip" :style="{ background: themePreview['--ui-success'], color: '#111' }">Success</span>
            </div>
            <p class="hint">Text colour is chosen automatically for legibility — even a low-contrast custom pick stays readable. Status colours (danger/success/info) stay fixed across themes.</p>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Element opacity</legend>
            <label class="row">
              <span>Coach panels</span>
              <input v-model.number="settings.hudCoachOpacity" type="range" min="0.2" max="1" step="0.01" />
              <span>{{ Math.round(settings.hudCoachOpacity * 100) }}%</span>
            </label>
            <label class="row">
              <span>Scoreboard</span>
              <input v-model.number="settings.hudScoreboardOpacity" type="range" min="0.2" max="1" step="0.01" />
              <span>{{ Math.round(settings.hudScoreboardOpacity * 100) }}%</span>
            </label>
            <label class="row">
              <span>Quick bar</span>
              <input v-model.number="settings.hudQuickBarOpacity" type="range" min="0.2" max="1" step="0.01" />
              <span>{{ Math.round(settings.hudQuickBarOpacity * 100) }}%</span>
            </label>
            <label class="row">
              <span>Chat toasts</span>
              <input v-model.number="settings.hudToastOpacity" type="range" min="0.2" max="1" step="0.01" />
              <span>{{ Math.round(settings.hudToastOpacity * 100) }}%</span>
            </label>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Log window</legend>
            <label class="row">
              <span>Opacity</span>
              <input v-model.number="settings.logOpacity" type="range" min="0.2" max="1" step="0.01" />
              <span>{{ Math.round(settings.logOpacity * 100) }}%</span>
            </label>
            <label class="row">
              <span>Font size</span>
              <input v-model.number="settings.logFontSize" type="range" min="8" max="22" step="0.5" />
              <span>{{ settings.logFontSize }}px</span>
            </label>
            <label class="row">
              <span>Font</span>
              <select v-model="settings.logFont">
                <option value="nuffle">Nuffle (Blood Bowl)</option>
                <option value="arial">Arial / Helvetica</option>
                <option value="mono">Monospace</option>
              </select>
            </label>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Chat &amp; notifications</legend>
          <label class="row">
            <span>Disable chat</span>
            <input v-model="settings.chatDisabled" type="checkbox" />
          </label>
          <label class="row" v-if="!settings.chatDisabled">
            <span>Chat toasts</span>
            <input v-model="settings.chatToastsEnabled" type="checkbox" />
          </label>
          <label class="row" v-if="!settings.chatDisabled && settings.chatToastsEnabled">
            <span>Chat toast position</span>
            <select v-model="settings.chatToastPos">
              <option value="left">Left (default)</option>
              <option value="right">Right</option>
              <option value="bottomLeft">Bottom-left</option>
              <option value="top">Top</option>
              <option value="center">Center</option>
            </select>
          </label>
            <label class="row">
              <span>Chat toast text size</span>
              <input v-model.number="settings.chatToastTextSize" type="range" min="12" max="28" step="1"
                aria-describedby="chat-toast-text-size-help" />
              <span>{{ settings.chatToastTextSize }}px</span>
            </label>
            <p id="chat-toast-text-size-help" class="hint">Changes the coach name and message in incoming
              chat toasts only. The minimum text-size accessibility setting can raise this further.</p>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Telestrator</legend>
            <label class="row">
              <span>Pitch marking color</span>
              <input v-model="settings.markColor" type="color" />
            </label>
          </fieldset>

          <fieldset class="settings-group">
            <legend>Sound</legend>
            <label class="row">
              <span>Game sound</span>
              <input v-model.number="settings.soundVolume" type="range" min="0" max="100" step="5" />
              <span>{{ settings.soundVolume === 0 ? 'muted' : settings.soundVolume + '%' }}</span>
            </label>
            <label class="row">
              <span>Footstep style</span>
              <select v-model="footstepStyle">
                <option value="tick">Tick</option>
                <option value="footsteps">Footsteps by weather</option>
              </select>
            </label>
            <p class="hint">Event-specific sound packs are managed in Mods.</p>
          </fieldset>
        </section>

        <!-- ============================ CREDITS ============================= -->
        <section v-if="settingsTab === 'credits'">
          <h3 class="credits-head">Attributions</h3>
          <p class="hint">Third-party assets and fonts used in Super FUMBBL, with thanks to their creators.</p>
          <ul class="credits-list">
            <li>Boxing bell by Benboncan, Dramatic Organ by InspectorJ and Chainsaw by ItsTheGoodstuff (freesound.org), CC BY 4.0. Referee whistle by SpliceSound and Videogame Menu Button Click by Christopherderp (CC0).</li>
            <li>
              <img class="credits-icon" :src="helmetIconUrl" alt="" />
              <span>Roster tab helmet —
                <a href="https://www.flaticon.com/free-icons/american-football"
                  @click.prevent="openExternal('https://www.flaticon.com/free-icons/american-football')"
                  title="american football icons">American football icons created by justicon — Flaticon</a>
              </span>
            </li>
            <li>
              <span>"Super FUMBBL" wordmark font (SNES Italic) —
                <a href="https://famfonts.com/super-nintendo/"
                  @click.prevent="openExternal('https://famfonts.com/super-nintendo/')"
                  title="Super Nintendo font by 629Fonts">629Fonts — FamFonts</a>
              </span>
            </li>
            <li>
              <span>UI font (Nuffle) —
                <a href="http://www.pixelsagas.com"
                  @click.prevent="openExternal('http://www.pixelsagas.com')"
                  title="Nuffle by Neale Davidson (Pixel Sagas, SIL Open Font License 1.1)">Neale Davidson — Pixel Sagas (OFL 1.1)</a>
              </span>
            </li>
            <!-- Owner 09-09: licensed and generated art credited here to match docs/licenses/ and the provenance ledger. -->
            <li>
              <span>Stadium props (cameras, light towers, stands) — "Football Championship Megapack" by
                <a href="https://sakpix.itch.io/football-championship-megapack-top-down-pixel-art-sports-collection"
                  @click.prevent="openExternal('https://sakpix.itch.io/football-championship-megapack-top-down-pixel-art-sports-collection')"
                  title="SakPix on itch.io">SakPix</a> (licensed purchase).
              </span>
            </li>
            <li><span>Pitch textures (grass, dugout stone) — Acasas and unTied, licensed via GameDev Market. Sign fans — licensed purchase.</span></li>
            <li><span>Sound effects — The Sound Guild, Gamemaster Audio and Khron Studio libraries (licensed purchases), plus owner recordings.</span></li>
            <li><span>Player sprites, star players, team crests and dugout cobble — original pixel art produced with PixelLab. Skill badges — Super FUMBBL originals; the illustrated set via Codex image generation.</span></li>
            <li><span>Kickoff banners, stadium skybox, crest and decoration art — generated with OpenAI, Codex and Gemini image models from Super FUMBBL prompts; no third-party source imagery.</span></li>
            <li><span>FUMBBL logo — used under FUMBBL's branding guidelines (FUMBBL Branding page). FUMBBL is Christer Kaivo-oja's site; Super FUMBBL is an independent client.</span></li>
          </ul>
          <h3 class="credits-head license-head">License</h3>
          <p class="hint">Super FUMBBL's code is released under the MIT License (also in the LICENSE file at the project root).</p>
          <p class="hint">Super FUMBBL's original artwork (sprites, crests, skill badges, decorations, pitches, banners, dice, wordmark) is licensed under the Super FUMBBL Media License: use, modify and distribute for non-commercial purposes; no selling the assets or using them on merchandise; credit Super FUMBBL with a link and indicate any changes. Full text: docs/licenses/super-fumbbl-media-license.md.</p>
          <pre class="license-text">{{ CLIENT_MIT_LICENSE }}</pre>
          <h3 class="credits-head license-head">Upstream FFB license</h3>
          <p class="hint">Super FUMBBL builds on the FFB client/server by Christer Kaivo-oja, also released under the MIT License.</p>
          <pre class="license-text">{{ CHRISTER_MIT_LICENSE }}</pre>

          <!-- FUMBBL Contributors mirror (owner 2026-07-23). Mirrors
               https://fumbbl.com/p/attribution in its entirety (also ATTRIBUTION.md at the
               repo root). If the source page changes, re-mirror BOTH copies. -->
          <h3 class="credits-head license-head">FUMBBL Contributors</h3>
          <p class="hint">Mirrored from
            <a href="https://fumbbl.com/p/attribution"
              @click.prevent="openExternal('https://fumbbl.com/p/attribution')"
              title="FUMBBL attribution page">fumbbl.com/p/attribution</a>
            — see that page for updates and corrections.</p>
          <div class="attribution-mirror">
            <p>This page lists people who have contributed assets (images, sounds, code, etc) to FUMBBL, with information on what they have contributed and additional information requested as part of the licensing terms. Contributors are listed in roughly chronological order.</p>
            <p>If you think you should be here, or find errors or omissions, don't hesitate to get in touch with Christer and it will be resolved promptly.</p>
            <h4>Licenses and policies</h4>
            <h5>Code</h5>
            <p>Any code contributed to the open parts of the FUMBBL codebase are licensed under the MIT License. Contributions should only be made if you agree to this license.</p>
            <h5>Graphics and sounds</h5>
            <p>Licensing of media assets has historically been a little bit complicated. All contributions in the past have given FUMBBL permission to use the assets for any purpose, but limited ability to redistribute them. Going forward, we are asking contributors to agree to a somewhat more permissive license when it comes to third parties using the content. The Modern FUMBBL Media License is as follows:</p>
            <ul>
              <li>FUMBBL is granted a license to use, modify, and distribute the contributed media assets for any purpose, including commercial purposes.</li>
              <li>Third parties are granted a license to use, modify, and distribute the contributed media assets for non-commercial purposes but may not use them for direct commercial purposes. This includes selling the assets or using them on merchandise or products that are sold.</li>
              <li>Third parties can also use the assets on sites and services that are commercial in nature, as long as the assets themselves are not sold or used on merchandise.</li>
              <li>Appropriate credit must be given to the original creator(s), a link to the FUMBBL website must be provided, and any changes made to the original assets must be indicated.</li>
            </ul>
            <p>Content licensed under this license is marked with an icon on the source page (icon markers are not reproduced in this mirror).</p>
            <h4>Developers</h4>
            <ul>
              <li><b>Christer</b> — Site owner and website developer. Assistant FFB developer.</li>
              <li><b>Mr-Klipp</b> — Co-developer in the early days of FUMBBL, contributed with various core code for the site.</li>
              <li><b>SkiJunkie</b> — JavaBBowl developer, the original client used by FUMBBL.</li>
              <li><b>Kalimar</b> — Primary FFB developer between October 2013 through May 2017.</li>
              <li><b>Candlejack</b> — Primary FFB developer as of March 2019. Dice Stats module.</li>
              <li><b>HimalayaP1C7</b> — Front-end for Gamefinder 2.0 and Blackbox 2.0 systems.</li>
            </ul>
            <h4>Roster Logos</h4>
            <ul>
              <li><b>Mr_Foulscumm</b> — Chaos Chosen, Dark Elf, Dwarf, Elven Union, Goblin, High Elf, Khemri, Lizardmen, Necromantic Horror, Norse, Nurgle, Ogre, Orc, Skaven, Vampire, Wood Elf</li>
              <li><b>Qaz</b> — Amazon, Chaos Dwarf, Halfling, Human, Undead</li>
              <li><b>Frylen</b> — Black Orc, Imperial Nobility, Khorne, Old World Alliance, Snotling, Underworld, Bretonnian</li>
              <li><b>Garion</b> — Chaos Renegades</li>
              <li><b>ryanfitz</b> — Gnome</li>
            </ul>
            <h4>Sounds</h4>
            <ul>
              <li><b>PurpleChest</b> — Hurt sound for the FFB Client.</li>
              <li><b>bigbullies</b> — Projectile Vomit sound.</li>
              <li><b>Mischa Kissin Tip</b> — Pump Up The Crowd and Trapdoor sounds.</li>
            </ul>
            <h4>Portraits</h4>
            <ul>
              <li><b>Knut_Rockie</b> — Portraits for Amazon, Black Orc, Chaos Chosen, Chaos Renegade, Dark Elf, Dwarf, Elven Union, Goblin, Halfling, High Elf, Human, Imperial Nobility, Khorne, Lizardmen, Necromantic Horror, Norse, Nurgle, Ogre, Old World Alliance, Orc, Shambling Undead, Skaven, Snotling, Tomb Kings, Underworld Denizens, Vampire, Wood Elf positionals.</li>
              <li><b>ryanfitz</b> — Colouring of portraits by Knut Rockie.</li>
              <li><b>Garion</b> — Drawing and colouring a number of star player portraits.</li>
              <li><b>Marcepan</b> — Portraits for unique Gnome positionals: Beastmaster, Illusionist, Woodland Fox, Lineman.</li>
            </ul>
            <h4>Icons</h4>
            <ul>
              <li><b>Pat</b> — Original JavaBBowl icons</li>
              <li><b>Nick Kelsh</b> — 2nd generation icons</li>
              <li><b>WhatBall</b> — 3rd gen icons</li>
              <li><b>Cowhead</b> — 3rd gen icon contributor</li>
              <li><b>harvestmouse</b> — 3rd gen icon contributor</li>
              <li><b>Balle2000</b> — 3rd gen icon contributor</li>
              <li><b>MisterFurious</b> — 3rd gen icon contributor</li>
              <li><b>Marcepan</b> — 3rd gen icon contributor</li>
              <li><b>Tussock</b> — 3rd gen icon contributor</li>
            </ul>
            <h4>Other Graphics</h4>
            <ul>
              <li><b>ArrestedDevelopment</b> — Minor tournament banners</li>
              <li><b>Garion</b> — Pitches: Basic, Blackbox, Chaos, Dark Elf, Fumbbl Cup, Goblin, Khorne, Necromantic, Norse, Nurgle, Skaven, Slaanesh, Tzeentch, Vampire. Tournament Banners: Steel Gauntlet</li>
              <li><b>Kam</b> — Tournament Banners: FUMBBL Cup, Warpstone Open, Ulthuan Invitational, Grotty Little Tournament, Crown of Sand, XFL</li>
              <li><b>Whatball</b> — Pitches: Default (edited by Garion)</li>
              <li><b>Angelux</b> — Pitches: Tomb Kings (edited by Garion)</li>
              <li><b>ZioCrock</b> — Pitches: Amazon, High Elf, Lizardman (all edited by Garion)</li>
            </ul>
          </div>
        </section>
        </div>
        <footer class="settings-footer">
          <p v-if="settingsDiscardError || settingsApplyError" class="settings-footer-error" role="alert">
            {{ settingsDiscardError || settingsApplyError }}
          </p>
          <span v-else class="settings-footer-status" role="status" aria-live="polite">
            {{ assetMods.creatorApplyBusy || assetMods.pendingAssignments ? 'Finishing the asset-pack change…' : (settingsDirty ? 'Changes are previewing live.' : 'Settings are up to date.') }}
          </span>
          <div class="settings-footer-actions">
            <button type="button" :disabled="settingsTransactionBusy" @click="cancelSettingsChanges()">
              {{ settingsDiscardBusy ? 'Restoring…' : 'Cancel' }}
            </button>
            <button type="button" :disabled="!settingsDirty || settingsTransactionBusy" @click="applySettingsChanges(false)">
              {{ settingsApplyBusy ? 'Applying…' : 'Apply' }}
            </button>
            <button type="button" class="primary" :disabled="settingsTransactionBusy" @click="applySettingsChanges(true)">
              OK
            </button>
          </div>
        </footer>
        </div>
      </div>
    </div>

    <!-- First-run FUMBBL credentials prompt (owner 2026-07-03 r6f). Backdrop does
         NOT dismiss — the user must Continue or Skip. -->
    <!-- owner 2026-07-14: welcome splash — a BLACK backdrop featuring the Super FUMBBL logo; the TABBL
         watermark is dropped. Two setup entries (FUMBBL creds / Super FUMBBL account + teams) replace the
         single (broken) "Enter login credentials" button. -->
    <div v-if="credsOpen" class="launch-splash splash-dark">
      <form class="splash-content splash-creds" @submit.prevent="finishCreds()">
        <img class="splash-logo" :src="superFumbblLogoUrl" alt="Super FUMBBL" />
        <p>Set up your accounts — a <b>FUMBBL</b> login lets you spectate live matches; a <b>Super FUMBBL</b>
          account lets you play on the fork. You can change these any time in <b>Settings → General</b>.</p>
        <div class="setup-entries">
          <button type="button" class="setup-btn" @click="setupMenu = 'fumbbl'">
            <span class="setup-title">Set Up FUMBBL</span>
            <span class="setup-sub">Official account — spectate live · <b>{{ settings.coach.trim() || 'not set' }}</b></span>
          </button>
          <button type="button" class="setup-btn setup-super" @click="setupMenu = 'super'; superLoginOpen = false">
            <span class="setup-title">Set Up Super FUMBBL</span>
            <span class="setup-sub">Fork account &amp; teams — play on the fork · <b>{{ settings.coach40k.trim() || 'not set' }}</b></span>
          </button>
        </div>
        <p class="splash-credit">Stored locally on this machine only — never sent anywhere but the server you connect to.</p>
        <label class="row splash-skip-next"><input v-model="settings.hideCredsSplash" type="checkbox" /> <span>Skip this next time</span></label>
        <div class="guide-actions">
          <button type="submit" class="splash-continue guide-tour">Save &amp; continue ▸</button>
          <!-- owner 2026-07-03: FUMBBL credentials are required to spectate, so
               skipping isn't "just spectate" — warn the user with a tooltip. -->
          <span class="skip-wrap">
            <button type="button" class="splash-continue guide-start"
              title="FUMBBL credentials are required to spectate live games — skip only to explore the demo."
              @click="finishCreds()">Skip for now</button>
            <span class="skip-tooltip" role="tooltip">
              ⚠ FUMBBL credentials are <b>required to spectate</b> live matches. Skipping only lets you explore
              the <b>demo</b> — you won't be able to watch live games until you add them (Settings&nbsp;→&nbsp;Connection).
            </span>
          </span>
        </div>
        <!-- owner 2026-07-14: build credit + Twitch link, moved here from the menu bar — small, bottom-left. -->
        <div class="splash-build-credit">
          Client built by FluteTheCat
          <a class="twitch-link" href="https://twitch.tv/flutethecat" title="twitch.tv/flutethecat"
            @click.prevent="openExternal('https://twitch.tv/flutethecat')">
            <svg viewBox="0 0 24 24" width="12" height="12" aria-label="Twitch" role="img">
              <path fill="currentColor" d="M4.3 0 1 3.3v17.4h5.9V24l3.3-3.3h4.9L21.9 14V0H4.3Zm15.4 13.1-3.3 3.3h-3.3l-2.9 2.9v-2.9H6.3V1.6h13.4v11.5Z"/>
              <path fill="currentColor" d="M15.7 4.9h-1.6v4.9h1.6V4.9Zm-4.4 0H9.7v4.9h1.6V4.9Z"/>
            </svg>
          </a>
        </div>
      </form>

      <!-- "Set Up FUMBBL" sub-menu: official-account creds + the spectate disclaimer. -->
      <div v-if="setupMenu === 'fumbbl'" class="modal-backdrop creds-menu-backdrop" @click.self="setupMenu = null">
        <div class="creds-menu">
          <div class="creds-menu-head">
            <h2>Set Up FUMBBL</h2>
            <button type="button" class="creds-menu-close" @click="setupMenu = null">✕</button>
          </div>
          <section class="creds-panel">
            <p class="hint">Your official <b>FUMBBL</b> account — required to spectate live matches. Enter the same
              coach name you use on <b>fumbbl.com</b> so opponents recognise you.</p>
            <label class="creds-field">Coach name
              <input v-model="settings.coach" type="text" autocomplete="username" placeholder="your FUMBBL coach name" />
            </label>
            <label class="creds-field">Password
              <input v-model="settings.password" type="password" autocomplete="current-password" placeholder="FUMBBL password" />
            </label>
            <p class="hint">⚠ Live spectating needs these credentials. Stored locally only.</p>
          </section>
          <div class="creds-menu-actions">
            <button type="button" class="creds-menu-done" @click="setupMenu = null">Done</button>
          </div>
        </div>
      </div>

      <!-- "Set Up Super FUMBBL" sub-menu: create a fork account / log in / how to set up teams. -->
      <div v-if="setupMenu === 'super'" class="modal-backdrop creds-menu-backdrop" @click.self="closeSetupMenu">
        <div class="creds-menu">
          <div class="creds-menu-head">
            <h2>Set Up Super FUMBBL</h2>
            <button type="button" class="creds-menu-close" @click="closeSetupMenu">✕</button>
          </div>
          <section class="creds-panel">
            <p class="hint">Your <b>Super FUMBBL</b> (fork) account lets you play on the test server.</p>
            <div class="setup-options">
              <button type="button" class="setup-option" :disabled="setupDiscordBusy" @click="startSetupDiscordSignIn()">
                <span class="setup-title">{{ setupDiscordBusy ? 'Waiting for Discord…' : 'Sign in with Discord' }}</span>
                <span class="setup-sub">Authorize in your system browser; this client securely claims the session.</span>
              </button>
              <button v-if="setupDiscordBusy" type="button" class="setup-option" @click="cancelSetupDiscordSignIn()">
                <span class="setup-title">Cancel sign-in</span>
                <span class="setup-sub">Invalidate the pending desktop claim.</span>
              </button>
              <p v-if="setupDiscordStatus" class="hint" aria-live="polite">{{ setupDiscordStatus }}</p>
              <button type="button" class="setup-option" @click="openRegisterModal()">
                <span class="setup-title">Create an account</span>
                <span class="setup-sub">No fork account yet? Register one — no FUMBBL account needed.</span>
              </button>
              <button type="button" class="setup-option" @click="superLoginOpen = !superLoginOpen">
                <span class="setup-title">Log in to an existing account {{ superLoginOpen ? '▾' : '▸' }}</span>
                <span class="setup-sub">Already have a fork account? Enter its credentials.</span>
              </button>
              <div v-if="superLoginOpen" class="super-login">
                <label class="creds-field">Coach name
                  <input v-model="settings.coach40k" type="text" autocomplete="username" placeholder="your Super FUMBBL coach name" />
                </label>
                <label class="creds-field">Password
                  <input v-model="coachPasswordModel" type="password" autocomplete="current-password" placeholder="Super FUMBBL password" />
                  <!-- Same honesty as the Login Credentials dialog: this surface hosts the SAME field,
                       so an unusable credential store has to say so here too or it looks like silence. -->
                  <p v-if="credentialStore.notice" class="hint">{{ credentialStore.notice }}</p>
                </label>
              </div>
              <button type="button" class="setup-option" @click="teamHelpOpen = true">
                <span class="setup-title">How to set up teams</span>
                <span class="setup-sub">Import a team from FUMBBL or build one in the Roster Builder.</span>
              </button>
            </div>
          </section>
          <div class="creds-menu-actions">
            <button type="button" class="creds-menu-done" @click="closeSetupMenu">Done</button>
          </div>
        </div>
      </div>

      <!-- "How to set up teams" pop-up: explains the Import Team + Roster Builder flows. -->
      <div v-if="teamHelpOpen" class="modal-backdrop creds-menu-backdrop" @click.self="teamHelpOpen = false">
        <div class="creds-menu team-help">
          <div class="creds-menu-head">
            <h2>Setting up teams</h2>
            <button type="button" class="creds-menu-close" @click="teamHelpOpen = false">✕</button>
          </div>
          <section class="creds-panel">
            <p class="hint">Once you're signed in to Super FUMBBL, open <b>Team Management</b> from the header
              (under the Super FUMBBL menu). You have two ways to get a team onto the fork:</p>
            <p><b>Import Team</b> — bring in an existing team from FUMBBL by its <b>Team ID</b> or URL. The team's
              details are previewed from the website, then bound to your fork coach on confirm.</p>
            <p><b>Create Team (Roster Builder)</b> — build a legal BB2025 team from any of the races: pick a race,
              add players within the 1000k budget, and it's installed straight onto the fork.</p>
            <p class="hint">Your teams then appear in <b>Team Management → Your teams</b>.</p>
          </section>
          <div class="creds-menu-actions">
            <button type="button" class="creds-menu-done" @click="teamHelpOpen = false">Got it</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Owner 2026-07-04: tabbed LOGIN CREDENTIALS menu — FUMBBL (official account)
         + Super FUMBBL (fork account), each entered separately. Opened by the button
         on the launch splash or Settings → Connection. -->
    <div v-if="credsMenuOpen" class="modal-backdrop creds-menu-backdrop" @click.self="closeCredsMenu">
      <div ref="credsMenuDialog" class="creds-menu" role="dialog" aria-modal="true" aria-labelledby="credentials-dialog-title"
        @keydown="trapCredsFocus">
        <div class="creds-menu-head">
          <h2 id="credentials-dialog-title">Login credentials</h2>
          <button class="creds-menu-close" @click="closeCredsMenu">✕</button>
        </div>
        <div class="creds-tabs">
          <button :data-active="credsMenuTab === 'fumbbl'" @click="credsMenuTab = 'fumbbl'">FUMBBL</button>
          <button :data-active="credsMenuTab === 'fumbbl40k'" @click="credsMenuTab = 'fumbbl40k'">Super FUMBBL</button>
        </div>
        <section v-if="credsMenuTab === 'fumbbl'" class="creds-panel">
          <p class="hint">Your official <b>FUMBBL</b> account — required to spectate live matches.</p>
          <label class="creds-field">Coach name
            <input v-model="settings.coach" type="text" autocomplete="username" placeholder="your FUMBBL coach name" />
          </label>
          <label class="creds-field">Password
            <input v-model="settings.password" type="password" autocomplete="current-password" placeholder="FUMBBL password" />
          </label>
          <!-- Owner 08-18 auth-challenge. "Check name", NOT "Verify": fumbbl.com gives this client no
               way to prove a coach's password, so the button is labelled for what it actually does. -->
          <div class="creds-challenge">
            <button
              type="button"
              class="creds-challenge-btn"
              :disabled="fumbblChallenge.kind === 'checking'"
              @click="checkFumbblCoach"
            >{{ fumbblChallenge.kind === 'checking' ? 'Checking…' : 'Check name' }}</button>
            <p v-if="fumbblChallenge.kind !== 'idle'" class="creds-challenge-result" :data-kind="fumbblChallenge.kind">
              {{ fumbblChallenge.message }}
            </p>
          </div>
        </section>
        <section v-else class="creds-panel">
          <p class="hint">Your <b>Super FUMBBL</b> (fork) account — used to play on the Super FUMBBL server.</p>
          <label class="creds-field">Coach name
            <input v-model="settings.coach40k" type="text" autocomplete="username" placeholder="your Super FUMBBL coach name" />
          </label>
          <label class="creds-field">Password
            <input v-model="coachPasswordModel" type="password" autocomplete="current-password" placeholder="Super FUMBBL password" />
            <!-- Non-blocking honesty: the OS credential store is unusable, so the password is session-only. -->
            <p v-if="credentialStore.notice" class="hint">{{ credentialStore.notice }}</p>
          </label>
          <!-- Owner 08-18 auth-challenge. A REAL credential check here — config-web's fork login is a
               yes/no oracle for coach+password — so this one gets to say "Verified". -->
          <div class="creds-challenge">
            <button
              type="button"
              class="creds-challenge-btn"
              :disabled="forkChallenge.kind === 'checking'"
              @click="verifyForkCredentials"
            >{{ forkChallenge.kind === 'checking' ? 'Verifying…' : 'Verify' }}</button>
            <p v-if="forkChallenge.kind !== 'idle'" class="creds-challenge-result" :data-kind="forkChallenge.kind">
              {{ forkChallenge.message }}
            </p>
          </div>
          <!-- Owner 2026-07-08: register a fork account straight from here — no FUMBBL account needed. -->
          <div class="creds-register">
            <button type="button" class="creds-register-btn" @click="openRegisterModal">Register a new fork account ✦</button>
            <p class="hint">No Super FUMBBL account yet? Register one here — no FUMBBL account needed.</p>
          </div>
        </section>
        <p class="creds-menu-note">Stored locally on this machine only — never sent anywhere but the server you connect to.</p>
        <div class="creds-menu-actions">
          <button class="creds-menu-done" @click="closeCredsMenu">Done</button>
        </div>
      </div>
    </div>

    <!-- Owner 2026-07-08: REGISTER a new fork account. Asks the user to match their real FUMBBL name
         (so opponents recognise them) and to choose a DIFFERENT password than their FUMBBL one. -->
    <div v-if="registerModalOpen" class="modal-backdrop creds-menu-backdrop" @click.self="closeRegisterModal">
      <form ref="registerDialog" class="creds-menu register-modal" role="dialog" aria-modal="true"
        aria-labelledby="register-dialog-title" @keydown="trapRegisterFocus" @submit.prevent="registerForkAccount">
        <div class="creds-menu-head">
          <h2 id="register-dialog-title">Register a Super FUMBBL account</h2>
          <button type="button" class="creds-menu-close" @click="closeRegisterModal">✕</button>
        </div>
        <div class="creds-panel">
          <label class="creds-field">Coach name
            <input v-model="registerCoach" type="text" autocomplete="username" placeholder="your coach name" />
          </label>
          <p class="hint">Please use your <b>actual FUMBBL name</b> — it's how opponents will recognise and
            challenge you on the fork.</p>
          <label class="creds-field">Password
            <input v-model="registerPassword" type="password" autocomplete="new-password" placeholder="choose a fork password" />
          </label>
          <p class="hint">⚠ Use a <b>different password</b> than your FUMBBL account — fork passwords are stored
            for this test server, so don't reuse a real one.</p>
        </div>
        <p v-if="registerStatus" class="creds-menu-note register-status">{{ registerStatus }}</p>
        <div class="creds-menu-actions">
          <button type="button" class="register-cancel" @click="closeRegisterModal">Cancel</button>
          <button type="submit" class="creds-menu-done" :disabled="registering">
            {{ registering ? 'Registering…' : 'Create account' }}
          </button>
        </div>
      </form>
    </div>

    <!-- Launch splash (owner 2026-07-03 r6f): thank-you + community links over the
         TABBL logo watermark + a Twitch channel preview. Click anywhere to clear;
         the content card stops propagation so the links/embed stay usable. -->
    <div v-if="splashOpen" class="launch-splash" @click="nextSplash()">
      <img class="splash-watermark" :src="tabblLogoUrl" alt="" />
      <div class="splash-content" @click.stop>
        <h1 class="splash-title splash-title-oneline">Thanks so much for trying out FUMBBL 40k</h1>
        <p>Please report any bugs or issues.</p>
        <p>If you haven't already, join us on the TABBL Discord at
          <a href="https://discord.gg/JxySytA297" @click.prevent="openExternal('https://discord.gg/JxySytA297')">discord.gg/JxySytA297</a>
        </p>
        <p>And go give me a follow at
          <a :href="twitchChannelUrl" @click.prevent="openExternal(twitchChannelUrl)">twitch.tv/flutethecat</a>
        </p>
        <!-- owner 2026-07-03: Twitch REJECTS the tauri.localhost embed parent, so the
             live iframe only works on the web origin; the desktop build gets a
             clickable card that opens the channel externally. -->
        <div v-if="!inTauri" class="splash-twitch">
          <iframe :src="twitchEmbedUrl" title="Twitch — flutethecat" allowfullscreen
            frameborder="0" scrolling="no" loading="lazy"></iframe>
        </div>
        <button v-else type="button" class="splash-twitch splash-twitch-card"
          @click="openExternal(twitchChannelUrl)" title="Open flutethecat's Twitch channel">
          <span class="twitch-glyph">▶</span>
          <span class="twitch-cta">Watch <b>flutethecat</b> on Twitch</span>
          <span class="twitch-host">twitch.tv/flutethecat</span>
        </button>
        <p class="splash-credit">Credit to AjaxTheRiot
          (<a href="https://twitch.tv/ajaxtheriot" @click.prevent="openExternal('https://twitch.tv/ajaxtheriot')">twitch.tv/ajaxtheriot</a>)
          for coming up with this idea to rebuild the client to begin with.</p>
        <button class="splash-continue" @click="nextSplash()">Next: getting started ▸</button>
      </div>
    </div>

    <!-- Second splash (owner 2026-07-03 r6f; owner 2026-08-27): the getting-started guide is now the
         Field Manual — a paginated in-game help guide (console → six rails → showtime → settings
         deep-links). Also reachable any time from ☰ → Help / Field Manual. -->
    <FieldManual v-if="guideOpen" @close="guideOpen = false" @play-tutorial="playTutorial()"
      @open-settings="(tab) => { guideOpen = false; openSettings(tab); }" />
    <!-- Owner ruling (08-18): the header's "Signed in as" identity block relocates here, stacked directly
         above the version stamp — same quiet/muted styling family, bottom-left, under every panel (owner 08-18 2nd). -->
    <div class="corner-stamp">
      <div class="header-identity" aria-label="Signed in accounts">
        <span class="identity-label">Signed in as</span>
        <span class="identity-account">
          <span class="identity-service">FUMBBL</span>
          <span class="identity-name" :class="{ 'is-signed-out': !settings.coach.trim() }"
            :title="settings.coach.trim() || 'Signed out'">{{ settings.coach.trim() || '—' }}</span>
        </span>
        <span class="identity-account">
          <span class="identity-service">SuperFUMBBL</span>
          <span class="identity-name" :class="{ 'is-signed-out': !settings.coach40k.trim() }"
            :title="settings.coach40k.trim() || 'Signed out'">{{ settings.coach40k.trim() || '—' }}</span>
        </span>
      </div>
      <!-- Owner commission 08-12: persistent version stamp, bottom-right of every view. Reads the SAME build-injected
           __APP_VERSION__ (package.json + dev letter) the release stamps use — never hand-maintained, and it shows the
           BARE version so a stray dev letter would be visible here (leak canary). -->
      <div class="version-stamp" :title="`build ${gitSha}`">v{{ appVersion }}</div>
    </div>
  </main>
  <div v-else-if="introOpen" class="intro-splash" role="dialog" aria-label="Super FUMBBL intro">
    <video
      ref="introVideo"
      class="intro-video"
      :src="INTRO_VIDEO_URL"
      playsinline
      @ended="finishIntro"
      @error="finishIntro"
    ></video>
    <button v-if="introNeedsGesture" class="intro-play" type="button" aria-label="Play intro" @click="startIntroPlayback">▶</button>
    <button class="intro-skip" type="button" @click="finishIntro">Skip ▸</button>
  </div>
  <FirstOpenLegalNotice
    v-else-if="legalNoticeOpen"
    :client-license="CLIENT_MIT_LICENSE"
    :busy="legalNoticeBusy"
    :error="legalNoticeError"
    @acknowledge="acknowledgeLegalNotice"
  />
  <FirstOpenContributions v-else @continue="continueContributions" />
</template>

<style>
/* First-open retro intro (owner 08-27) — fullscreen black stage ahead of the legal notice. */
.intro-splash {
  position: fixed;
  inset: 0;
  z-index: 13000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
}
.intro-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}
.intro-skip {
  position: absolute;
  right: 24px;
  bottom: 20px;
  padding: 8px 18px;
  color: var(--ui-text);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  letter-spacing: 0.06em;
  background: color-mix(in srgb, var(--ui-surface) 72%, transparent);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  cursor: pointer;
}
.intro-skip:hover { color: var(--ui-heading); border-color: var(--ui-heading); }
.intro-play {
  position: absolute;
  width: 96px;
  height: 96px;
  color: var(--ui-text);
  font-size: max(var(--ui-min-primary-text-size, 16px), 2.4rem);
  line-height: 1;
  background: color-mix(in srgb, var(--ui-surface) 72%, transparent);
  border: 2px solid var(--ui-border);
  border-radius: 50%;
  cursor: pointer;
}
.intro-play:hover { color: var(--ui-heading); border-color: var(--ui-heading); }

.match-ready-popup {
  position: fixed;
  z-index: 12000;
  right: 24px;
  top: 72px;
  width: min(380px, calc(100vw - 48px));
  padding: 18px;
  border: 1px solid var(--ui-primary);
  border-left-width: 5px;
  border-radius: 8px;
  background: var(--ui-surface);
  color: var(--ui-text);
  box-shadow: 0 12px 36px rgba(0, 0, 0, .55);
}
.match-ready-popup h3 { margin: 0 28px 8px 0; }
.match-ready-popup p { line-height: 1.45; }
.match-ready-close { position: absolute; right: 8px; top: 8px; }
/* Console-UI PLACEHOLDER law (owner 2026-08-04, spec-console-ui-program): undesigned / question-blocked
   sections ship as this shared zebra block — testers SEE the stripes by owner intent; questions queue,
   never block. Theme-token only (no hardcoded hex, per the Claude-Design mandate). The consuming component
   supplies the label text, e.g. <div class="ui-placeholder">League — Place Holder</div>. */
.ui-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  padding: 16px;
  border: 2px dashed var(--ui-border);
  border-radius: 6px;
  color: var(--ui-muted);
  font-family: 'Nuffle', system-ui, sans-serif;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-align: center;
  background: repeating-linear-gradient(45deg, var(--ui-surface) 0 12px, var(--ui-surface-2) 12px 24px);
}
/* Owner 2026-07-04: app-wide click echo — small, gold (configurable), 15% opacity,
   short-lived, centred on the cursor. ~40% of the earlier pitch-echo size. */
.click-echo {
  position: fixed;
  z-index: 9999;
  /* owner 2026-07-06: size scaled by settings.echoSize (--echo-scale, 1 = 9px). */
  width: calc(9px * var(--echo-scale, 1));
  height: calc(9px * var(--echo-scale, 1));
  margin: calc(-4.5px * var(--echo-scale, 1)) 0 0 calc(-4.5px * var(--echo-scale, 1)); /* centre on the cursor point */
  border-radius: 50%;
  border: 1.5px solid var(--click-echo-color, #f5c518);
  background: var(--click-echo-color, #f5c518);
  opacity: 0.3;
  pointer-events: none;
  /* Owner 2026-07-05: half-diameter (9px), 30% opacity. */
  animation: click-echo-pop 440ms ease-out forwards;
}
@keyframes click-echo-pop {
  from { transform: scale(0.4); opacity: 0.3; }
  to { transform: scale(2); opacity: 0; }
}

:root {
  color-scheme: dark;
  /* Sampled from the on-pitch sprite ramps in UAT: navy/royal/electric blue
     and oxblood/crimson/coral red. Text variants retain the sampled hue while
     lifting luminance for small-copy contrast. */
  --seat-home-deep: #080c64;
  --seat-home-mid: #003eb3;
  --seat-home-bright: #0058fe;
  --seat-home-text: #4a86fe;
  --seat-away-deep: #7f0000;
  --seat-away-mid: #b30000;
  --seat-away-bright: #fe0000;
  --seat-away-text: #fe6666;
  /* B2-16/UI11 + B3-8: display font is user-selectable (default Nuffle) */
  font-family: var(--ui-font, 'Nuffle', system-ui, sans-serif);
  /* Owner 2026-07-05: base UI 20% larger. The whole shell is rem-based, so scaling
     the root font-size grows every panel/dialog/button/label 20%; the JS-sized pitch
     canvas is unaffected. */
  font-size: max(var(--ui-min-text-size, 12px), 120%);
  background: var(--ui-surface);
  color: var(--ui-text);
}
body {
  margin: 0;
}
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  /* Owner 2026-07-11: the game canvas can render wider than the window; without this the body
     scrolls horizontally and the full-width header (incl. its motherboard background) is dragged
     past the viewport's right edge and clipped. Clip horizontal overflow to the viewport so the
     top bar always ends exactly at the window edge. (Canvas pan is handled inside the renderer, not
     by DOM scroll, so nothing interactive is lost.) */
  overflow-x: hidden;
  max-width: 100vw;
  /* Owner UX 08-12: the chrome is INERT to text-selection app-wide (labels/buttons/panels can't be highlighted). */
  user-select: none;
  -webkit-user-select: none;
}
/* Owner UX 08-12: positive carve-outs that STAY selectable — the log/chat panel (owner-named copy-pastable) and
   EVERY editable field (user-select:none must NEVER reach an input/textarea). Global (App.vue is un-scoped), so it
   reaches all views incl. the console (team-builder names, filters) and Classic inherits at Pellaeon's re-sync. */
input, textarea, [contenteditable="true"], .log-panel {
  user-select: text;
  -webkit-user-select: text;
}
/* Owner 2026-07-11: motherboard PCB texture behind the top bar. A dark gradient
   overlay rides on top of the image so the Super FUMBBL logo + menu stay legible. */
.shell-header {
  display: flex;
  align-items: center;
  /* owner 2026-07-14: wrap as a safety net so the top-right hamburger can never be clipped off a narrow
     window (it wraps to a new line instead of overflowing under .shell's overflow-x:hidden). */
  flex-wrap: wrap;
  gap: 1rem;
  padding: 0.6rem 1.25rem;
  background-color: #0c1408; /* PCB-dark fallback before the image paints */
  background-image:
    linear-gradient(90deg, rgba(10, 16, 8, 0.82) 0%, rgba(10, 16, 8, 0.5) 35%, rgba(10, 16, 8, 0.5) 65%, rgba(10, 16, 8, 0.82) 100%),
    url('./assets/resources/motherboard-header.jpg');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  border-bottom: 1px solid #16391a;
}
/* owner 2026-07-14: once a game is loaded, the menu bar SHRINKS to give the pitch more room. */
.shell-header.header-compact { padding: 0.25rem 1rem; gap: 0.6rem; }
.shell-header.header-compact .build-credit,
.shell-header.header-compact .alpha-stamp { display: none; }
.shell-header.header-compact .server-plate { width: 92px; height: 32px; padding: 0 0.45rem; }
.shell-header.header-compact .server-plate-super img { max-height: 25px; }
.shell-header .hamburger {
  background: transparent;
  color: var(--ui-text);
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  padding: 0.25rem 0.55rem;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  cursor: pointer;
  order: 100; /* owner 2026-07-11: move the menu to the TOP-RIGHT (past the auto-margin group) */
  margin-left: auto; /* owner 08-18: the retired session chip carried the auto-margin spacer — the
                        hamburger now pins itself to the right edge */
  flex-shrink: 0; /* owner 2026-07-14: the menu button never shrinks — always fully clickable */
}
/* Keep the top-right menu visible on narrower windows: shed the decorative build credit first,
   then (tighter) the ALPHA RELEASE stamp — so the essential hamburger/nav never clip. */
@media (max-width: 1400px) {
  .shell-header .build-credit { display: none; }
}
@media (max-width: 1120px) {
  .shell-header .alpha-stamp { display: none; }
}
/* owner 2026-07-14: on narrow windows shrink the server buttons so the whole header (incl. the
   top-right hamburger) stays on one line instead of overflowing / clipping the menu. */
@media (max-width: 720px) {
  .shell-header { gap: 0.5rem; padding: 0.5rem 0.7rem; }
  .shell-header .server-plate { width: 86px; height: 36px; padding: 0 0.35rem; }
  .shell-header .server-plate-super img { max-height: 26px; max-width: 72px; }
}

/* Console-UI S2: server switcher plates are a matched 52px-high bevelled pair. */
.server-switcher {
  display: inline-flex;
  gap: 0.45rem;
  flex-shrink: 0;
}
.server-plate {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 132px;
  height: 52px;
  padding: 0 0.6rem;
  border: 2px outset color-mix(in srgb, var(--ui-text) 28%, var(--ui-surface-2));
  border-radius: 6px;
  cursor: pointer;
  box-shadow:
    inset 1px 1px 0 rgba(255, 255, 255, 0.32),
    inset -1px -1px 2px rgba(0, 0, 0, 0.55),
    0 2px 6px rgba(0, 0, 0, 0.5);
  transition: filter 0.15s ease, opacity 0.15s ease;
}
.server-plate img { display: block; width: auto; }
.server-plate-super { background: var(--ui-surface); }
.server-plate-super img { max-width: 112px; max-height: 42px; }
.server-plate-fumbbl { background: var(--ui-eggshell); }
.server-plate-fumbbl img { max-width: 108px; max-height: 24px; }
.server-plate:not([data-active='true']) { opacity: 0.55; filter: grayscale(1); }
.server-plate:not([data-active='true']):hover { opacity: 1; filter: grayscale(0); }
.server-plate[data-active='true'] {
  opacity: 1;
  filter: none;
}
.server-plate-super[data-active='true'] {
  box-shadow:
    inset 1px 1px 0 rgba(255, 255, 255, 0.32),
    inset -1px -1px 2px rgba(0, 0, 0, 0.55),
    inset 0 -3px 0 var(--ui-heading),
    0 2px 6px rgba(0, 0, 0, 0.5);
}
.server-plate-fumbbl[data-active='true'] {
  /* README signature exception: the FUMBBL plate underline is the fixed brand-red bevel edge. */
  box-shadow:
    inset 1px 1px 0 rgba(255, 255, 255, 0.32),
    inset -1px -1px 2px rgba(0, 0, 0, 0.55),
    inset 0 -3px 0 #A10005,
    0 2px 6px rgba(0, 0, 0, 0.5);
}
/* Owner ruling (08-18): the header's Super FUMBBL plate is pure branding now — no button semantics,
   no dimmed/grayscale idle state (it carries no [data-active] to trigger the rule above), no hover
   affordance, default cursor. It's a logo, always shown at full strength. */
.server-plate.server-plate-inert {
  cursor: default;
  opacity: 1;
  filter: none;
}
.server-plate.server-plate-inert:hover { opacity: 1; filter: none; }

/* Console-UI S2 blade ribbon: the selected server owns the complete horizontal blade set. */
.blade-ribbon {
  display: flex;
  flex-shrink: 0;
  align-items: stretch;
  min-height: 42px;
  padding: 0 1.25rem;
  overflow-x: auto;
  background: var(--ui-surface-2);
  border-bottom: 3px solid var(--ui-primary);
}
.blade {
  flex: 0 0 auto;
  padding: 0.55rem 1.15rem;
  border: 0;
  color: var(--ui-muted);
  background: transparent;
  font-family: inherit;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.125rem);
  line-height: 1;
  letter-spacing: 0.04em;
  cursor: pointer;
}
.blade:hover { color: var(--ui-text); background: var(--ui-hover); }
.blade[data-active='true'] {
  color: var(--ui-text);
  background: var(--ui-primary);
  font-weight: 700;
  box-shadow: inset 0 3px 0 var(--ui-heading);
}
/* Owner ruling (console shell restructure): a hairline divider marks the merged tree's Super FUMBBL section
   (Team/League/Players/Store) without splitting the ribbon into a separate parallel branch. */
.blade-ribbon-sep {
  flex: 0 0 auto;
  align-self: center;
  width: 1px;
  height: 1.4rem;
  margin: 0 0.35rem;
  background: var(--ui-border);
}
/* owner 2026-07-12: the standalone Browse button was dropped — the FUMBBL / Super FUMBBL server
   buttons now open the browser (selectServer). Session state + Disconnect stay grouped on the right. */
/* owner 2026-07-03 r5: stencil-style ALPHA RELEASE stamp */
.alpha-stamp {
  margin-left: 16px;
  padding: 2px 9px;
  border: 2px solid #c0532f;
  border-radius: 3px;
  color: #d5643a;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-weight: 800;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  transform: rotate(-6deg);
  opacity: 0.9;
  box-shadow: inset 0 0 0 1px #c0532f55;
  text-shadow: 0 0 1px #c0532f66;
  user-select: none;
  white-space: nowrap;
}
/* owner 2026-07-08: build credit + Twitch link beside the ALPHA stamp */
.build-credit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
  font-size: max(var(--ui-min-text-size, 12px), 0.68rem);
  color: var(--ui-muted);
  white-space: nowrap;
}
.build-credit .twitch-link {
  display: inline-flex;
  align-items: center;
  color: #9146ff; /* Twitch brand purple */
  cursor: pointer;
  transition: color 0.15s ease, filter 0.15s ease;
}
.build-credit .twitch-link:hover {
  color: #a970ff;
  filter: drop-shadow(0 0 4px #9146ff88);
}
/* Owner ruling (08-18): the header's mode/version tagline is dropped outright (the ALPHA RELEASE
   stamp already carries the alpha branding); the "Signed in as" identity block relocates here,
   stacked directly above the persistent version stamp (owner commission 08-12) in one quiet,
   muted corner group — bottom-right, clear of the scrollbar gutter. */
.corner-stamp {
  position: fixed;
  left: 20px; /* owner 08-18 (2nd): bottom-LEFT — the right corner collided with the in-game quick bar */
  bottom: 4px;
  z-index: 1; /* owner 08-18 (2nd): under every panel/toolbar — game UI draws over it, never the reverse */
  /* owner 08-19: ONE line + visible on any background — row layout inside a soft dark pill,
     light text with a dark outline so it reads over pitch green and light paper alike. */
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 8px;
  padding: 2px 8px;
  border-radius: 5px;
  background: rgba(10, 12, 14, 0.55);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
  pointer-events: none;
  user-select: none;
}
.corner-stamp .header-identity { flex-wrap: nowrap; white-space: nowrap; }
.corner-stamp, .corner-stamp .identity-label, .corner-stamp .identity-service, .corner-stamp .identity-name { color: #e8ecef; }
.corner-stamp .header-identity {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: baseline;
  gap: 0.5rem;
  max-width: 60vw;
}
.corner-stamp .identity-label,
.corner-stamp .identity-service,
.corner-stamp .identity-name {
  color: var(--ui-muted);
  font-size: max(var(--ui-min-text-size, 12px), 10px);
  font-weight: 400;
  letter-spacing: 0.03em;
  opacity: 0.65;
}
.corner-stamp .identity-label { text-transform: uppercase; }
.corner-stamp .identity-account { display: inline-flex; align-items: baseline; min-width: 0; gap: 0.25rem; }
.corner-stamp .identity-name {
  max-width: 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.corner-stamp .version-stamp {
  position: static;
  color: var(--ui-muted);
  font-size: max(var(--ui-min-text-size, 12px), 10px);
  letter-spacing: 0.03em;
  opacity: 0.65;
}
.app-menu {
  position: fixed;
  inset: 0;
  z-index: 90;
}
.app-menu-panel {
  position: absolute;
  top: 52px;
  /* Owner 2026-07-11: the hamburger lives top-RIGHT (.hamburger order:100), so the dropdown must
     open on the right under it — not top-left where it used to be. */
  right: 12px;
  display: flex;
  flex-direction: column;
  min-width: 220px;
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  box-shadow: 0 6px 22px #000b;
  /* Owner 2026-07-11: bind the dropdown to the viewport (same convention as the quick-bar/log clamp +
     the .game-menu cap) — never run off the bottom edge; scroll internally if it ever grows taller than
     the window. top:52px + a 12px bottom gutter = 64px reserved. */
  max-height: calc(100vh - 64px);
  overflow-x: hidden;
  overflow-y: auto;
}
.app-menu-panel button {
  background: transparent;
  color: var(--ui-text);
  border: none;
  border-bottom: 1px solid var(--ui-border);
  padding: 0.6rem 0.9rem;
  text-align: left;
  cursor: pointer;
}
.app-menu-panel button:last-child { border-bottom: none; }
.app-menu-panel button:hover { background: var(--ui-hover); }
/* Dev controls section (owner 2026-07-03 r6f) */
.app-menu-panel button.menu-section {
  margin-top: 0.2rem;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-muted);
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem);
  font-weight: 700;
}
.app-menu-panel button.menu-sub { padding-left: 1.6rem; color: var(--ui-muted); font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); }
.app-menu-panel button:disabled { opacity: 0.55; cursor: wait; }
.replay-file-alert {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 210;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  max-width: min(440px, calc(100vw - 32px));
  padding: 12px 14px;
  color: #ffe8e8;
  border: 1px solid #b84a4a;
  border-radius: 6px;
  background: #351313;
  box-shadow: 0 6px 22px #000b;
}
.replay-file-alert button {
  padding: 0;
  color: inherit;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: max(var(--ui-min-primary-text-size, 16px), 18px);
  line-height: 1;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: #0008;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.game-menu-backdrop { background: #000a; }
/* Owner UAT 08-12: the settings save/discard confirm is a SMALL reactive-style dialog (it was mis-styled
   with .settings-pane = the giant 920x680 window). Compact card, centered by .modal-backdrop, z-ordered
   ABOVE the credentials panel (.creds-menu-backdrop = z 110) so it lands over the top of the join creds. */
.save-prompt-backdrop { z-index: 200; }
.save-prompt {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  width: min(320px, 92vw);
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  padding: 1.1rem 1.3rem;
  box-shadow: 0 8px 30px #000a;
  text-align: center;
  font-family: Arial, Helvetica, sans-serif;
}
.save-prompt h3 { margin: 0; font-size: max(var(--ui-min-primary-text-size, 16px), 0.98rem); letter-spacing: 0.03em; }
.save-prompt .hint { margin: 0; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 0.74rem); line-height: 1.35; }
.save-prompt-actions { display: flex; justify-content: center; gap: 0.6rem; margin-top: 0.2rem; }
.save-prompt-actions button {
  flex: 1;
  padding: 0.45rem 0.7rem;
  color: var(--ui-text);
  background: var(--ui-surface-2);
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem);
  white-space: nowrap;
  cursor: pointer;
}
.save-prompt-actions button:hover { background: color-mix(in srgb, var(--ui-primary) 25%, var(--ui-surface-2)); }
.save-prompt-actions .primary { color: var(--ui-text-on-primary); background: var(--ui-primary); border-color: var(--ui-primary); }
/* Owner 08-18: spectate connect-error modal — the raw transport detail renders small/muted beneath
   the plain-language reason (fail-open honesty: never nothing, but the friendly line leads). */
.spectate-error-prompt .spectate-error-detail { font-size: max(var(--ui-min-text-size, 12px), 0.66rem); opacity: 0.75; word-break: break-word; }
.game-menu {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  /* Owner 2026-07-08: Join/Spectate-flow panes cap to the viewport so they never overflow
     a narrow window, and scroll internally when the content (creds / register form) is tall. */
  width: min(260px, 92vw);
  max-height: 88vh;
  overflow-y: auto;
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  padding: 1.4rem 1.6rem;
  text-align: center;
}
.game-menu h2 {
  margin: 0 0 0.4rem;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem);
  letter-spacing: 0.08em;
}
.game-menu button {
  background: var(--ui-surface-2);
  color: var(--ui-text);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  padding: 0.55rem 0;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.92rem);
  cursor: pointer;
}
.game-menu button:hover:not(:disabled) { background: #3a5f3f; }
.game-menu button:disabled { color: var(--ui-text-dim); cursor: default; }
.game-menu .hint { margin: 0.3rem 0 0; color: var(--ui-text-dim); font-size: max(var(--ui-min-text-size, 12px), 0.72rem); }
.game-menu[data-wide='true'] { width: min(380px, 92vw); }
.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem);
  margin-bottom: 0.5rem;
}
.stats-table th {
  padding: 0.3rem 0.4rem;
  border-bottom: 1px solid var(--ui-border);
  font-size: max(var(--ui-min-text-size, 12px), 0.78rem);
}
.stats-table td { padding: 0.28rem 0.4rem; }
.stats-table tbody tr:nth-child(odd) { background: var(--ui-surface-2); }
.stats-table .stat-label { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 0.74rem); text-align: center; }
.stats-table .home { color: var(--seat-home-text); text-align: right; }
.stats-table .away { color: var(--seat-away-text); text-align: left; }
.stats-table th.home, .stats-table th.away { text-align: center; }
.settings-pane {
  /* B2-16 (owner): Settings render in Arial/Helvetica, not the display font */
  font-family: Arial, Helvetica, sans-serif;
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  /* owner 2026-07-06: large window — left sidebar + scrollable content pane. */
  position: relative;
  display: flex;
  flex-direction: row;
  width: min(920px, 94vw);
  height: min(680px, 88vh);
  overflow: hidden;
}
/* owner 2026-07-06: top-right close ✕ (replaces the old bottom Close button). */
.settings-x {
  position: absolute;
  top: 0.5rem;
  right: 0.6rem;
  z-index: 2;
  width: 1.7rem;
  height: 1.7rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--ui-muted);
  border: none;
  border-radius: 5px;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  line-height: 1;
  cursor: pointer;
}
.settings-x:hover { background: var(--ui-hover); color: var(--ui-text); }
/* --- left sidebar: category list --------------------------------------- */
.settings-sidebar {
  flex: 0 0 190px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1.1rem 0.8rem;
  background: var(--ui-surface-2);
  border-right: 1px solid var(--ui-border);
  min-height: 0;
}
.settings-sidebar h3 { margin: 0 0 0.4rem 0.3rem; }
.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1;
  overflow-y: auto;
}
.settings-nav button {
  text-align: left;
  background: transparent;
  color: var(--ui-muted);
  border: none;
  border-radius: 5px;
  padding: 0.5rem 0.7rem;
  cursor: pointer;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem);
}
.settings-nav button:hover { background: var(--ui-hover); color: var(--ui-text); }
.settings-nav button[data-active='true'] {
  background: var(--ui-hover);
  color: var(--ui-text);
  box-shadow: inset 3px 0 0 var(--ui-primary);
}
/* --- right content pane ------------------------------------------------- */
.settings-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.settings-category-select { display: none !important; }
.settings-content {
  flex: 1;
  min-height: 0;
  min-width: 0;
  /* extra top padding so controls clear the absolute top-right ✕ */
  padding: 2.4rem 1.4rem 1.2rem;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.settings-content > h2 {
  margin: 0 2.2rem 0.8rem 0;
  color: var(--ui-text);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem);
}
.settings-content > h2:focus { outline: none; }
.settings-content section {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.settings-footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  min-height: 58px;
  padding: 0.65rem 1.1rem;
  border-top: 1px solid var(--ui-border);
  background: var(--ui-surface-2);
}
.settings-footer-status,
.settings-footer-error {
  min-width: 0;
  margin: 0;
  color: var(--ui-muted);
  font-size: max(var(--ui-min-text-size, 12px), 0.76rem);
}
.settings-footer-error { color: var(--ui-danger); }
.settings-footer-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
.settings-footer-actions button {
  min-width: 76px;
  padding: 0.48rem 0.8rem;
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  background: var(--ui-surface);
  color: var(--ui-text);
  cursor: pointer;
}
.settings-footer-actions button.primary {
  border-color: var(--ui-primary);
  background: var(--ui-primary);
  color: var(--ui-text-on-primary);
}
.settings-footer-actions button:disabled { cursor: default; opacity: 0.5; }
.settings-immediate-note,
.asset-pack-immediate {
  margin: 0;
  color: var(--ui-info, #8bb8e8);
  font-size: max(var(--ui-min-text-size, 12px), 0.74rem);
}

@media (max-width: 640px), (max-height: 500px) {
  .settings-pane {
    width: min(96vw, 920px);
    height: min(94dvh, 680px);
  }
  .settings-sidebar { display: none; }
  .settings-category-select {
    display: flex !important;
    flex: 0 0 auto;
    flex-direction: column !important;
    gap: 0.25rem !important;
    padding: 0.75rem 3rem 0.65rem 0.9rem;
    border-bottom: 1px solid var(--ui-border);
    background: var(--ui-surface-2);
  }
  .settings-category-select select { width: 100%; }
  .settings-content { padding: 1rem 0.9rem; }
  .settings-content > h2 { margin-right: 0; }
  .settings-pane label.row { align-items: stretch; flex-wrap: wrap; }
  .settings-pane label.row > select,
  .settings-pane label.row > input:not([type='checkbox']):not([type='color']) { max-width: 100%; }
  .settings-footer { align-items: stretch; flex-direction: column; gap: 0.45rem; }
  .settings-footer-actions { width: 100%; }
  .settings-footer-actions button { flex: 1; }
}
/* --- grouped controls (fieldset) --------------------------------------- */
/* owner 2026-07-14: UI theme picker (Settings → Accessibility). */
.theme-presets { display: flex; gap: 10px; margin-bottom: 8px; }
.theme-preset { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 8px 12px; border: 1px solid var(--ui-border); border-radius: 8px; background: var(--ui-surface-2); color: var(--ui-text); cursor: pointer; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); }
.theme-preset:hover { border-color: var(--ui-primary); }
.theme-preset[data-active='true'] { border-color: var(--ui-primary); box-shadow: inset 0 0 0 1px var(--ui-primary); }
.theme-swatch { width: 34px; height: 22px; border-radius: 4px; border: 2px solid; display: block; }
.theme-preview { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.theme-chip { padding: 4px 10px; border-radius: 5px; border: 1px solid transparent; font-size: max(var(--ui-min-text-size, 12px), 0.75rem); font-weight: 700; }
/* owner 2026-07-14 (Yularen button contract): keyboard focus ring on every interactive control — the
   accessibility must-have. Themed via --ui-focus (surface-aware, high-contrast on any preset). */
button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
}
.settings-group {
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  padding: 0.5rem 0.8rem 0.7rem;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.settings-group legend {
  padding: 0 0.4rem;
  font-size: max(var(--ui-min-text-size, 12px), 0.78rem);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  /* owner 2026-07-14: ALL settings section headers = a fixed brand red, not the dark Carmine --ui-primary
     (too dim). Toned down a notch from the first #ff3b3b (owner: "a bit too bright"). Fixed like the
     semantic tokens so it stays consistent on any theme. */
  color: #e23b3b;
  font-weight: 700;
}
/* aura colour-legend swatches next to each aura label */
.aura-swatch {
  display: inline-block;
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 2px;
  vertical-align: -1px;
  border: 1px solid rgba(0, 0, 0, 0.4);
}
.aura-swatch.dp-friendly { background: #4a8cff; }
.aura-swatch.dp-opp { background: #e0402f; }
.aura-swatch.pmu-friendly { background: #2ec24f; }
.aura-swatch.pmu-opp { background: #d8c9a0; }
/* --- echo preview swatch ------------------------------------------------ */
.echo-preview {
  position: relative;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--ui-border);
  border-radius: 5px;
  background: var(--ui-surface);
}
.echo-preview em { color: var(--ui-text-dim); font-size: max(var(--ui-min-text-size, 12px), 0.72rem); }
.echo-preview-ring {
  position: absolute;
  width: calc(9px * var(--echo-scale, 1));
  height: calc(9px * var(--echo-scale, 1));
  border-radius: 50%;
  border: 1.5px solid var(--click-echo-color, #f5c518);
  background: var(--click-echo-color, #f5c518);
  animation: click-echo-pop 1200ms ease-out infinite;
}
.settings-pane label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem);
  /* owner 2026-07-14: settings-menu body/label text = WHITE (max-contrast body token). Grey is reserved
     for SUBTEXT only — the descriptive .hint lines below each control keep --ui-muted. */
  color: var(--ui-text);
}
.settings-pane label.row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}
/* #166/#163: a toggle the client CANNOT honour (behaviourless skill → always prompted). Dimmed + not-allowed so it
   reads as deliberately unavailable rather than broken, with the reason inline. */
.settings-pane label.row.locked {
  opacity: 0.62;
  cursor: not-allowed;
}
.settings-pane label.row.locked input { cursor: not-allowed; }
.settings-pane .locked-tag {
  margin-left: auto;
  font-size: max(var(--ui-min-text-size, 12px), 0.78rem);
  font-style: italic;
  color: var(--ui-text-dim);
  white-space: nowrap;
}
.settings-pane input:not([type='checkbox']),
.settings-pane select {
  background: var(--ui-surface-2);
  color: var(--ui-text);
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  padding: 0.4rem 0.55rem;
}
.settings-pane .keybind {
  background: var(--ui-surface-2);
  color: var(--ui-text);
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  padding: 0.35rem 0.8rem;
  cursor: pointer;
  min-width: 110px;
}
.settings-pane .hint { margin: 0; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 0.72rem); }
.settings-pane .actions {
  display: flex;
  justify-content: flex-end;
}
.settings-pane .actions .primary {
  background: var(--ui-primary);
  color: var(--ui-text-on-primary);
  border: none;
  border-radius: 4px;
  padding: 0.4rem 0.9rem;
  cursor: pointer;
}
/* B2-14: marking rule editor */
.marking-rules { display: flex; flex-direction: column; gap: 2px; max-height: 140px; overflow-y: auto; }
.marking-rule {
  display: flex;
  gap: 6px;
  align-items: baseline;
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
}
.marking-rule b { color: var(--ui-accent); min-width: 30px; }
.marking-rule span { flex: 1; color: var(--ui-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.marking-rule em { color: var(--ui-text-dim); font-style: normal; }
.marking-rule button { background: none; border: none; color: var(--ui-muted); cursor: pointer; }
.marking-add { display: flex; gap: 5px; align-items: center; font-size: max(var(--ui-min-text-size, 12px), 0.75rem); flex-wrap: wrap; }
.marking-add input,
.marking-add select {
  background: var(--ui-surface);
  color: inherit;
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  padding: 0.25rem 0.4rem;
}
.marking-add button { background: #3a5f3f; color: inherit; border: none; border-radius: 4px; padding: 0.25rem 0.7rem; cursor: pointer; }

/* Per-skill display config (owner 2026-07-03 r6f) */
.skill-config { margin: 0.3rem 0; border: 1px solid var(--ui-border); border-radius: 6px; padding: 0.3rem 0.5rem; }
.skill-config summary { cursor: pointer; color: var(--ui-accent); font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); padding: 0.2rem 0; font-weight: 600; }
.sc-instructions { margin: 0.3rem 0; }
.sc-help-toggle {
  background: transparent; border: none; color: var(--ui-accent); cursor: pointer;
  font-size: max(var(--ui-min-text-size, 12px), 0.78rem); padding: 0.15rem 0; text-align: left;
}
.sc-steps { margin: 0.2rem 0 0.4rem; padding-left: 1.2rem; color: var(--ui-text); font-size: max(var(--ui-min-text-size, 12px), 0.74rem); line-height: 1.5; }
.sc-steps b { color: var(--ui-text); }
.sc-prefill { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0.2rem 0; }
.sc-prefill button { background: #3a4f6f; color: inherit; border: none; border-radius: 4px; padding: 0.25rem 0.7rem; cursor: pointer; font-size: max(var(--ui-min-text-size, 12px), 0.76rem); }
.sc-filter {
  width: 100%; box-sizing: border-box; margin: 0.3rem 0;
  background: var(--ui-surface); color: inherit; border: 1px solid var(--ui-border); border-radius: 4px; padding: 0.3rem 0.5rem;
}
.sc-table { max-height: 260px; overflow-y: auto; border: 1px solid var(--ui-border); border-radius: 5px; }
.sc-thead, .sc-trow {
  display: grid;
  grid-template-columns: 1fr 8.5em 8.5em;
  gap: 5px; align-items: center; padding: 2px 6px;
}
.sc-table[data-markers='true'] .sc-thead,
.sc-table[data-markers='true'] .sc-trow {
  /* #15 (owner 08-11): the Marker glyph column sits LEFT of the My-team/Opposition dropdowns. */
  grid-template-columns: 1fr 4.5em 8em 8em;
}
.sc-thead { position: sticky; top: 0; background: var(--ui-surface-2); color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 0.68rem); font-weight: 700; z-index: 1; }
.sc-trow { font-size: max(var(--ui-min-text-size, 12px), 0.74rem); border-top: 1px solid var(--ui-border); }
.sc-trow:nth-child(odd) { background: var(--ui-surface-2); }
.sc-skill { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-trow select, .sc-glyph {
  background: var(--ui-surface); color: inherit; border: 1px solid var(--ui-border); border-radius: 4px;
  padding: 0.15rem 0.25rem; font-size: max(var(--ui-min-text-size, 12px), 0.72rem); width: 100%; box-sizing: border-box;
}
.sc-glyph { text-align: center; }

/* Credits / attributions pane (owner 2026-07-03 r6f) */
.credits-head { margin: 0 0 0.2rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); color: var(--ui-text); }
.credits-list { list-style: none; margin: 0.4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.credits-list li { display: flex; align-items: center; gap: 0.6rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: var(--ui-text); }
.credits-icon { width: 28px; height: 28px; object-fit: contain; flex: none; }
.credits-list a { color: var(--ui-accent); text-decoration: none; }
.credits-list a:hover { text-decoration: underline; }
.license-head { margin-top: 1rem; }
.license-text { margin: 0.4rem 0 0; padding: 0.6rem 0.8rem; font-size: max(var(--ui-min-text-size, 12px), 0.7rem); line-height: 1.4; color: var(--ui-text); background: rgba(0, 0, 0, 0.2); border-radius: 4px; white-space: pre-wrap; }
.attribution-mirror { margin-top: 0.4rem; font-size: max(var(--ui-min-text-size, 12px), 0.75rem); line-height: 1.45; color: var(--ui-text); }
.attribution-mirror h4 { margin: 0.8rem 0 0.2rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); color: var(--ui-text); }
.attribution-mirror h5 { margin: 0.5rem 0 0.2rem; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); color: var(--ui-text); }
.attribution-mirror p { margin: 0.3rem 0; }
.attribution-mirror ul { margin: 0.2rem 0 0.4rem; padding-left: 1.1rem; }
.attribution-mirror li { margin: 0.15rem 0; }
.attribution-mirror a { color: var(--ui-accent); text-decoration: none; }
.attribution-mirror a:hover { text-decoration: underline; }

/* Launch splash (owner 2026-07-03 r6f) */
.launch-splash {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4vh 4vw;
  cursor: pointer;
  background: radial-gradient(ellipse at center, #0b1a12f2 0%, #05080cf7 70%, #020304fb 100%);
  backdrop-filter: blur(3px);
  animation: splash-in 0.35s ease-out;
}
@keyframes splash-in { from { opacity: 0; } to { opacity: 1; } }
.splash-watermark {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(82vmin, 720px);
  height: min(82vmin, 720px);
  transform: translate(-50%, -50%);
  object-fit: contain;
  opacity: 0.14;
  filter: saturate(1.1);
  pointer-events: none;
  user-select: none;
}
.splash-content {
  position: relative;
  z-index: 1;
  max-width: 560px;
  width: 100%;
  box-sizing: border-box;
  max-height: 92vh;
  /* owner 2026-07-14: overflow-y:auto alone forces overflow-x to compute to `auto` → a stray horizontal
     scrollbar; pin overflow-x hidden so only the vertical scroll can appear. */
  overflow: hidden auto;
  text-align: center;
  padding: 26px 30px 22px;
  border-radius: 14px;
  background: #0e1512d9;
  border: 1px solid #2f6b3e88;
  box-shadow: 0 16px 50px #000c, inset 0 0 0 1px #ffffff08;
  cursor: default;
  color: #dfe6df;
  /* Owner 2026-07-04g: splash BODY text in Helvetica/Arial (headings + CTA
     buttons keep their Nuffle display font via their own font-family). */
  font-family: Arial, Helvetica, sans-serif;
}
.splash-title {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.55rem);
  font-weight: 900;
  margin: 0 0 0.5rem;
  color: #eafbea;
  text-shadow: 0 2px 10px #000c, 0 0 18px #2f6b3e66;
  letter-spacing: 0.01em;
}
/* owner 2026-07-03: keep the welcome header on ONE line — shrink to fit the card
   width and never wrap. */
.splash-title-oneline {
  white-space: nowrap;
  font-size: max(var(--ui-min-primary-text-size, 16px), clamp(0.82rem, 3.1vw, 1.2rem));
}
.splash-content p { margin: 0.5rem 0; font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); line-height: 1.5; }
.splash-content a { color: #7fd68f; text-decoration: none; font-weight: 700; }
.splash-content a:hover { text-decoration: underline; color: #9deaad; }
.splash-twitch {
  margin: 0.9rem auto 0.4rem;
  width: 100%;
  max-width: 460px;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #333a46;
  background: #000;
}
.splash-twitch iframe { width: 100%; height: 100%; display: block; border: 0; }
/* owner 2026-07-03: desktop-build Twitch card (the live embed can't render there) */
.splash-twitch-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  cursor: pointer;
  color: #efeaff;
  background: linear-gradient(160deg, #6441a5 0%, #9146ff 55%, #772ce8 100%);
  border: 1px solid #a970ff;
  aspect-ratio: 16 / 6;
  font-family: 'Nuffle', system-ui, sans-serif;
  transition: filter 0.15s ease, transform 0.1s ease;
}
.splash-twitch-card:hover { filter: brightness(1.12); }
.splash-twitch-card:active { transform: translateY(1px); }
.splash-twitch-card .twitch-glyph { font-size: max(var(--ui-min-primary-text-size, 16px), 1.5rem); line-height: 1; opacity: 0.95; }
.splash-twitch-card .twitch-cta { font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); }
.splash-twitch-card .twitch-cta b { color: #fff; }
.splash-twitch-card .twitch-host { font-size: max(var(--ui-min-text-size, 12px), 0.78rem); opacity: 0.85; letter-spacing: 0.02em; }
.splash-skip-next { justify-content: center; margin: 6px 0 2px; color: var(--ui-muted); font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); }
.splash-credit { font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem) !important; color: #9aa8a0; margin-top: 0.9rem !important; }
.splash-continue {
  margin-top: 1rem;
  background: #2f6b3e;
  color: #eafbea;
  border: 1px solid #4a8a58;
  border-radius: 7px;
  padding: 0.5rem 1.4rem;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem);
  font-weight: 700;
  cursor: pointer;
  animation: splash-hint 1.6s ease-in-out infinite;
}
.splash-continue:hover { background: #3a8350; }
@keyframes splash-hint { 0%, 100% { opacity: 0.72; } 50% { opacity: 1; } }
/* owner 2026-07-14: the welcome splash on a BLACK backdrop (Super FUMBBL logo up top, no TABBL watermark). */
.launch-splash.splash-dark { background: radial-gradient(ellipse at center, color-mix(in srgb, var(--ui-secondary) 92%, #202024) 0%, var(--ui-secondary) 72%); }
.launch-splash.splash-dark .splash-content { background: var(--ui-surface); border-color: var(--ui-border); }
.splash-logo { display: block; width: min(62vmin, 300px); height: auto; margin: 2px auto 10px; user-select: none; }
.setup-entries { display: flex; flex-direction: column; gap: 10px; margin: 14px 0 4px; }
.setup-btn {
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  padding: 12px 16px;
  border-radius: 9px;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface-2);
  color: var(--ui-text);
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.setup-btn:hover { border-color: var(--ui-primary); background: var(--ui-hover); }
.setup-btn.setup-super { border-color: var(--ui-primary); background: var(--ui-hover); }
.setup-btn.setup-super:hover { border-color: var(--ui-primary); filter: brightness(1.15); }
.setup-title { font-weight: 700; font-size: max(var(--ui-min-primary-text-size, 16px), 0.98rem); }
.setup-sub { font-size: max(var(--ui-min-text-size, 12px), 0.78rem); color: var(--ui-muted); }
.setup-options { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.setup-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
  color: var(--ui-text);
  cursor: pointer;
}
.setup-option:hover { border-color: var(--ui-primary); background: var(--ui-hover); }
.super-login { display: flex; flex-direction: column; gap: 8px; padding: 6px 4px 2px; }
.team-help .creds-panel p { text-align: left; }
/* Getting-started guide markup replaced by components/FieldManual.vue (owner 08-27);
   .guide-actions/.guide-tour/.guide-start stay — the credentials splash CTAs use them. */
.guide-actions { display: flex; flex-wrap: wrap; gap: 0.7rem; justify-content: center; margin-top: 1rem; }
.guide-actions .splash-continue { margin-top: 0; animation: none; }
/* owner 2026-07-14: SWAPPED the splash CTAs — Save & Continue = GREEN (go), Skip for now = RED (caution). */
.guide-tour { background: #2f6b3e; border-color: #4a8a58; color: #eafbea; }
.guide-tour:hover { background: #3a8350; }
.guide-start { background: var(--ui-primary); border-color: var(--ui-accent); color: var(--ui-text-on-primary); }
.guide-start:hover { background: var(--ui-accent); }
/* first-run credentials prompt */
.splash-creds { max-width: 420px; padding-bottom: 30px; }
/* owner 2026-07-14: build credit anchored to the panel's bottom-left (moved off the menu bar), small +
   muted. The action buttons are centered so the far-left corner is clear — no overlap. */
.splash-build-credit {
  position: absolute;
  left: 16px;
  bottom: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: max(var(--ui-min-text-size, 12px), 0.62rem);
  color: var(--ui-muted);
  letter-spacing: 0.01em;
}
.splash-build-credit .twitch-link { display: inline-flex; align-items: center; color: #9146ff; }
.splash-build-credit .twitch-link:hover { color: #b48cff; }
/* owner 2026-07-04: the credentials button + status on the splash / Connection tab */
.creds-open-btn {
  padding: 0.55rem 1rem;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem);
  font-weight: 700;
  color: var(--ui-text-on-primary);
  background: var(--ui-primary);
  border: 1px solid var(--ui-primary);
  border-radius: 8px;
  cursor: pointer;
}
.creds-open-btn:hover { filter: brightness(1.15); }
.creds-status { display: flex; gap: 1.2rem; justify-content: center; margin: 0.5rem 0 0; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: var(--ui-muted); }
.creds-status b { color: var(--ui-text); }
.connection-fork-status { display: flex; flex-direction: column; }
/* owner 2026-07-04: tabbed FUMBBL / Super FUMBBL credentials menu */
.creds-menu-backdrop { z-index: 110; } /* above the settings modal (z 100) + launch splash */
.creds-menu {
  width: 380px;
  max-width: 92vw;
  /* Owner 2026-07-08: tall creds/register forms scroll inside the pane instead of
     overflowing the viewport on a short window. */
  max-height: 88vh;
  overflow-y: auto;
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  padding: 14px 16px 16px;
  box-shadow: 0 10px 40px #000b;
  color: var(--ui-text);
}
.creds-menu-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.creds-menu-head h2 { margin: 0; font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem); font-family: 'Nuffle', system-ui, sans-serif; color: var(--ui-primary); }
.creds-menu-close { background: none; border: none; color: var(--ui-muted); font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem); cursor: pointer; }
.creds-menu-close:hover { color: var(--ui-text); }
.creds-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
.creds-tabs button {
  flex: 1;
  padding: 7px 0;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.88rem);
  font-weight: 700;
  color: var(--ui-muted);
  background: var(--ui-surface-2);
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  cursor: pointer;
}
.creds-tabs button[data-active='true'] { color: var(--ui-text-on-primary); background: var(--ui-primary); border-color: var(--ui-primary); }
.creds-panel { display: flex; flex-direction: column; gap: 0.4rem; }
.creds-panel .hint { margin: 0 0 0.4rem; }
.creds-menu-note { margin: 0.8rem 0 0; font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: var(--ui-muted); text-align: center; }
.creds-menu-actions { display: flex; justify-content: flex-end; margin-top: 0.9rem; }
.creds-menu-done {
  padding: 0.45rem 1.2rem;
  font-weight: 700;
  color: var(--ui-text-on-primary);
  background: var(--ui-primary);
  border: 1px solid var(--ui-primary);
  border-radius: 8px;
  cursor: pointer;
}
.creds-menu-done:hover { filter: brightness(1.15); }
/* owner 2026-07-08: register-a-fork-account control in the Super FUMBBL creds tab */
/* owner 2026-08-18: per-tab auth challenge. Secondary styling on purpose — Done stays the primary
   action, since checking is optional and a coach who skips it must not feel blocked. */
.creds-challenge { margin-top: 0.7rem; padding-top: 0.7rem; border-top: 1px solid #2c332c; }
.creds-challenge-btn {
  padding: 0.4rem 0.9rem;
  font-weight: 600;
  color: var(--ui-text);
  background: var(--ui-surface-2);
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  cursor: pointer;
}
.creds-challenge-btn:hover:not(:disabled) { border-color: var(--ui-primary); color: var(--ui-primary); }
.creds-challenge-btn:disabled { opacity: 0.6; cursor: default; }
.creds-challenge-result { margin: 0.45rem 0 0; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); line-height: 1.35; color: #cbd4cb; }
/* `warn` is the FUMBBL name check: it passed, but it did not prove the password — so it is
   deliberately NOT the same green as a real verification. */
.creds-challenge-result[data-kind='ok'] { color: #7fd18a; }
.creds-challenge-result[data-kind='warn'] { color: #d9c07a; }
.creds-challenge-result[data-kind='fail'] { color: #e2867f; }

.creds-register { margin-top: 0.7rem; padding-top: 0.7rem; border-top: 1px solid #2c332c; }
.creds-register-btn {
  padding: 0.4rem 0.9rem;
  font-weight: 600;
  color: var(--ui-text-on-primary);
  background: var(--ui-primary);
  border: 1px solid var(--ui-primary);
  border-radius: 8px;
  cursor: pointer;
}
.creds-register-btn:hover:not(:disabled) { filter: brightness(1.15); }
.creds-register-btn:disabled { opacity: 0.6; cursor: default; }
.creds-register-status { margin: 0.4rem 0 0; color: #cbd4cb; }
/* owner 2026-07-08: register-account modal */
.register-modal { max-width: min(400px, 92vw); }
.register-status { text-align: left; color: #cbd4cb; }
.register-cancel {
  margin-right: auto;
  padding: 0.45rem 1rem;
  color: var(--ui-text);
  background: var(--ui-surface-2);
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  cursor: pointer;
}
.register-cancel:hover { filter: brightness(1.2); }
.creds-menu-done:disabled { opacity: 0.6; cursor: default; }
/* owner 2026-07-03: warning tooltip on "Skip for now" — FUMBBL credentials are
   required to spectate, so skipping only reaches the demo. Shows on hover/focus. */
.skip-wrap { position: relative; display: inline-flex; }
.skip-tooltip {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  width: 250px;
  padding: 8px 11px;
  background: var(--ui-surface-2);
  border: 1px solid var(--ui-accent);
  border-radius: 7px;
  color: var(--ui-text);
  font-size: max(var(--ui-min-text-size, 12px), 0.76rem);
  line-height: 1.4;
  text-align: left;
  box-shadow: 0 8px 22px #000c;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s ease;
  z-index: 5;
  pointer-events: none;
}
.skip-tooltip b { color: var(--ui-accent); }
.skip-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: var(--ui-accent);
}
.skip-wrap:hover .skip-tooltip,
.skip-wrap:focus-within .skip-tooltip { opacity: 1; visibility: visible; }
.creds-field { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; margin: 0.6rem 0; text-align: left; font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); color: var(--ui-muted); }
.creds-field input {
  width: 100%; box-sizing: border-box;
  background: var(--ui-surface-2); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 6px; padding: 0.45rem 0.6rem;
}
.creds-field input:focus { outline: none; border-color: var(--ui-primary); }
.splash-dontshow { display: inline-flex; align-items: center; gap: 6px; margin-top: 0.9rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); color: #b8c0b8; cursor: pointer; }
.splash-dontshow input { cursor: pointer; }

/* Red-green colourblind mode (owner 2026-07-03 r3): the app's success/primary
   accents are green (#3a5f3f family), confusable with red danger/away states for
   red-green colourblind users. Remap those greens to a distinguishable blue so
   green-vs-red reads as blue-vs-red. Applied via `.cb-redgreen` on the shell.
   Global styles (App.vue + SpectateView are un-scoped) so this reaches both. */
.cb-redgreen .menubar button,
.cb-redgreen .game-browser button,
.cb-redgreen .marking-add button,
.cb-redgreen .settings-pane .actions .primary,
.cb-redgreen .confirm-move,
.cb-redgreen .apo-actions .apo-use,
.cb-redgreen .sc-yes {
  background: #2f6fb0;
  border-color: #4a86c8;
}
.cb-redgreen .menubar button:hover,
.cb-redgreen .game-menu button:hover:not(:disabled),
.cb-redgreen .end-turn:hover:not(:disabled),
.cb-redgreen .confirm-move:hover,
.cb-redgreen .sc-yes:hover {
  background: #3d84cf;
}
</style>
