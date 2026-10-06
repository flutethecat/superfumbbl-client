<script setup lang="ts">
/**
 * Owner 2026-10-05: the Home blade - the FUMBBL website in the main window (Home > Play > Spectate ...).
 * In every edition since the owner's 10-06 decision.
 *
 * This element is a placeholder: the site itself is a shell-owned native webview positioned over it
 * (src-tauri/src/fumbbl_home.rs). The rules for when it may show live in game/fumbblHome.ts.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ui } from '../game/ui';
import { flushSettingsFile, settings } from '../game/settings';
import { HOME_TOUR_VERSION, shouldStartTour, tourCall } from '../game/homeTour';
import { colorblindFilter } from '../game/colorblindFilters';
import { createTourController } from '../game/homeTourController';
import {
  FUMBBL_HOME_URL,
  HOME_BLOCKED,
  HOME_ZOOM_MAX,
  HOME_ZOOM_MIN,
  HOME_ZOOM_STEP,
  clampHomeZoom,
  homeZoomLabel,
  sendHomeFilter,
  sendHomeZoom,
  stepHomeZoom,
  desiredHomeState,
  detectHomeShell,
  hideHomeQuietly,
  isHomeBlockedError,
  isPaneOccluded,
  sameDesired,
  sendHomeState,
  type HomeDesired,
  type HomeShellState,
} from '../game/fumbblHome';


const host = ref<HTMLElement | null>(null);
const shell = ref<HomeShellState | 'detecting'>('detecting');
const failed = ref(false);
const showing = ref(false);
/** The shell's loop guard stopped the pane (the site kept leaving fumbbl.com). Only "Try again" restarts it. */
const blocked = ref(false);
/** The next show carries `retry` so the shell resets its guard (set by Try again on the blocked notice). */
let retryArmed = false;

let mounted = false;
let lastSent: HomeDesired | null = null;
let sending = false;
let resend = false;
let frameQueued = false;
let frame = 0;
let interval = 0;
let resizeObserver: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let dprQuery: MediaQueryList | null = null;
let unlistenHidden: (() => void) | null = null;
let unlistenBlocked: (() => void) | null = null;
let unlistenTour: (() => void) | null = null;
let unlistenTourPage: (() => void) | null = null;

/** Owner 10-06: page zoom of the docked site (Settings key homePaneZoom). The shell re-applies it after every page load
 *  and show; the page sends it once the shell is known and on every change. */
const zoom = ref(clampHomeZoom(settings.homePaneZoom));
function setZoom(value: number): void {
  const next = clampHomeZoom(value);
  zoom.value = next;
  settings.homePaneZoom = next;
  if (shell.value === 'available') void sendHomeZoom(next);
}

/** Owner 10-06: the site walkthrough (game/homeTour.ts), drawn inside the site webview. Its last step hands off to the
 *  client walkthrough (components/ClientTour.vue, mounted by App.vue), which ends on the third-party disclaimer. */
const tour = createTourController({
  invoke: async (command, args) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command, args);
  },
  markSeen: async () => {
    settings.homeTourSeenVersion = HOME_TOUR_VERSION;
    await nextTick();
    await flushSettingsFile();
  },
  log: (message) => console.warn(message),
});
let tourListening = false;

/** Starts the walkthrough the first time the site is actually on screen (after first-launch setup), and again when
 *  Settings > General resets the seen version. */
function maybeStartTour(): void {
  if (!mounted || !tourListening || !showing.value || tour.running()) return;
  if (!shouldStartTour({
    homeTourSeenVersion: settings.homeTourSeenVersion,
    completedFirstRun: settings.completedFirstRun,
    setupWizardSeenVersion: settings.setupWizardSeenVersion, // the first-launch setup wizard (on the base since 1.0.113)
  })) return;
  void tour.start(settings.coach);
}
watch(() => ui.clientTourActive, () => invalidate());
// Owner 10-06: the site follows the client's colorblind mode, live.
watch(() => settings.colorblindMode, (mode) => { if (shell.value === 'available') void sendHomeFilter(colorblindFilter(mode)); });
watch(() => [showing.value, settings.homeTourSeenVersion, settings.completedFirstRun, settings.setupWizardSeenVersion], maybeStartTour);


function compute(): HomeDesired {
  const el = host.value;
  const state = shell.value === 'detecting' ? 'needs-installer' : shell.value;
  if (!el || !mounted) return { visible: false };
  const box = el.getBoundingClientRect();
  const rect = { x: box.left, y: box.top, width: box.width, height: box.height };
  const occluded = isPaneOccluded(el, rect, document, (e) => getComputedStyle(e));
  return desiredHomeState({
    shell: state,
    // Owner 10-06: the client walkthrough (main webview) runs with the site hidden, so its cards are never under it.
    active: !failed.value && !blocked.value && !ui.clientTourActive,
    documentVisible: document.visibilityState !== 'hidden',
    rect,
    occluded,
  });
}

async function flush(): Promise<void> {
  if (sending) {
    resend = true;
    return;
  }
  sending = true;
  try {
    do {
      resend = false;
      let desired: HomeDesired;
      try {
        desired = compute();
      } catch {
        desired = { visible: false }; // cannot tell what is on screen: never show the site blind
      }
      if (sameDesired(lastSent, desired)) continue;
      try {
        const retry = desired.visible && retryArmed;
        await sendHomeState(desired, { retry });
        if (retry) retryArmed = false;
        lastSent = desired;
        showing.value = desired.visible;
      } catch (error) {
        if (desired.visible && isHomeBlockedError(error)) {
          markBlocked(); // the event was missed (or raced this show): same outcome
        } else if (desired.visible) {
          // Creation (or a bounds update) failed: stop trying and offer the browser instead of an empty area.
          failed.value = true;
          showing.value = false;
          lastSent = null;
          hideHomeQuietly();
        }
      }
    } while (resend && mounted);
  } finally {
    sending = false;
  }
}

function schedule(): void {
  if (frameQueued || !mounted || shell.value !== 'available') return;
  frameQueued = true;
  frame = requestAnimationFrame(() => {
    frameQueued = false;
    void flush();
  });
}

/** Forget what we last sent so the next check re-sends (the shell hid it on its own, or the DPI changed). */
function invalidate(): void {
  lastSent = null;
  schedule();
}

/** The shell stopped the pane: it already hid and blanked the webview; show the notice instead of an empty area. */
function markBlocked(): void {
  blocked.value = true;
  retryArmed = false;
  showing.value = false;
  lastSent = null;
}

function watchDpr(): void {
  dprQuery?.removeEventListener('change', onDprChange);
  dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  dprQuery.addEventListener('change', onDprChange);
}
function onDprChange(): void {
  watchDpr();
  invalidate();
}

async function start(): Promise<void> {
  shell.value = await detectHomeShell();
  if (!mounted || shell.value !== 'available') return;
  // Before the first show: the shell applies both to the webview it creates (the zoom, then the client's colorblind
  // correction - the same matrix the shell uses). One after the other: two concurrent first loads of the IPC module
  // race under the test runner's module mock.
  void sendHomeZoom(zoom.value).then(() => sendHomeFilter(colorblindFilter(settings.colorblindMode)));
  // Listeners BEFORE anything can send a show: the shell's stop event (fumbbl-home-blocked) can follow the very first
  // show (fumbbl.com redirecting off-domain on creation) and must never be missed.
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen('fumbbl-home-hidden', invalidate);
    if (mounted) unlistenHidden = unlisten;
    else unlisten();
    const unlistenStop = await listen(HOME_BLOCKED, markBlocked);
    if (mounted) unlistenBlocked = unlistenStop;
    else unlistenStop();
    const offTour = await listen('fumbbl-home:tour', (e) => { void tour.siteEvent(e.payload); });
    if (mounted) unlistenTour = offTour;
    else offTour();
    const offTourPage = await listen('fumbbl-home:page-load', (e) => { void tour.pageLoad(e.payload); });
    if (mounted) unlistenTourPage = offTourPage;
    else offTourPage();
    tourListening = mounted;
  } catch {
    /* the periodic check still runs; a stopped shell also refuses every show with the blocked error */
  }
  if (!mounted) return;
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);
  document.addEventListener('visibilitychange', schedule);
  resizeObserver = new ResizeObserver(schedule);
  if (host.value) resizeObserver.observe(host.value);
  // Anything of ours appearing, moving or disappearing (dialogs, menus, toasts, splash, layout shifts).
  mutationObserver = new MutationObserver(schedule);
  mutationObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'aria-modal', 'role'],
  });
  watchDpr();
  // Safety net for changes no observer reports (CSS transitions, position-only moves).
  interval = window.setInterval(schedule, 250);
  schedule();
}

function retry(): void {
  failed.value = false;
  invalidate();
}

function retryBlocked(): void {
  blocked.value = false;
  retryArmed = true;
  invalidate();
}

async function openInBrowser(): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(FUMBBL_HOME_URL);
  } catch {
    window.open(FUMBBL_HOME_URL, '_blank', 'noopener');
  }
}

function onPageHide(): void {
  hideHomeQuietly();
}

onMounted(() => {
  mounted = true;
  window.addEventListener('pagehide', onPageHide);
  void start();
});

onBeforeUnmount(() => {
  mounted = false;
  if (frameQueued) cancelAnimationFrame(frame);
  frameQueued = false;
  window.clearInterval(interval);
  window.removeEventListener('resize', schedule);
  window.removeEventListener('scroll', schedule, true);
  window.removeEventListener('pagehide', onPageHide);
  document.removeEventListener('visibilitychange', schedule);
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  dprQuery?.removeEventListener('change', onDprChange);
  unlistenHidden?.();
  unlistenBlocked?.();
  unlistenTour?.();
  unlistenTourPage?.();
  // Leaving mid-walkthrough: take the overlay off the site; it starts over the next time the pane shows.
  if (tour.running()) {
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('fumbbl_home_tour', { call: tourCall('clear') }))
      .catch(() => undefined);
  }
  tour.stop();
  // Leaving the blade (or a game taking the window over): the site must never sit on top of what comes next.
  hideHomeQuietly();
});
</script>

<template>
  <div class="fumbbl-home-blade">
  <section ref="host" class="fumbbl-home-pane" aria-label="FUMBBL.COM" :data-showing="showing">
    <div v-if="shell === 'detecting'" class="fumbbl-home-note" role="note">
      <p class="hint">Loading FUMBBL…</p>
    </div>
    <div v-else-if="shell !== 'available'" class="fumbbl-home-note" role="note">
      <h3>FUMBBL.COM</h3>
      <p class="hint">The FUMBBL.COM pane needs the latest installer.</p>
      <button type="button" @click="openInBrowser()">Open in browser</button>
    </div>
    <div v-else-if="blocked" class="fumbbl-home-note" role="note">
      <h3>FUMBBL.COM</h3>
      <p class="hint">The page kept leaving fumbbl.com, so it was stopped here.</p>
      <div class="fumbbl-home-actions">
        <button type="button" class="primary" @click="openInBrowser()">Open in browser</button>
        <button type="button" @click="retryBlocked()">Try again</button>
      </div>
    </div>
    <div v-else-if="failed" class="fumbbl-home-note" role="note">
      <h3>FUMBBL.COM</h3>
      <p class="hint">The FUMBBL website could not be shown here.</p>
      <div class="fumbbl-home-actions">
        <button type="button" class="primary" @click="retry()">Try again</button>
        <button type="button" @click="openInBrowser()">Open in browser</button>
      </div>
    </div>
    <div v-else class="fumbbl-home-note fumbbl-home-under" aria-hidden="true">
      <p class="hint">Loading FUMBBL…</p>
    </div>
  </section>
  <!-- Owner 10-06: zoom for the docked site ("text can be a bit small"). A strip BELOW the pane element, never over it:
       the site's bounds are the pane's own rect, so the native webview never covers this control and the occlusion
       probe never sees it. -->
  <div v-if="shell === 'available'" class="fumbbl-home-zoom">
    <button type="button" class="zoom-step" aria-label="Zoom out" :disabled="zoom <= HOME_ZOOM_MIN" @click="setZoom(stepHomeZoom(zoom, -1))">−</button>
    <input
      class="zoom-range"
      type="range"
      :min="HOME_ZOOM_MIN"
      :max="HOME_ZOOM_MAX"
      :step="HOME_ZOOM_STEP"
      :value="zoom"
      aria-label="FUMBBL page zoom"
      :aria-valuetext="homeZoomLabel(zoom)"
      @input="setZoom(($event.target as HTMLInputElement).valueAsNumber)"
    />
    <button type="button" class="zoom-step" aria-label="Zoom in" :disabled="zoom >= HOME_ZOOM_MAX" @click="setZoom(stepHomeZoom(zoom, 1))">+</button>
    <button type="button" class="zoom-value" title="Reset to 100%" @click="setZoom(1)">{{ homeZoomLabel(zoom) }}</button>
  </div>
  </div>
</template>

<style scoped>
.fumbbl-home-blade {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.fumbbl-home-pane {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  background: var(--ui-surface);
}
.fumbbl-home-zoom {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  background: var(--ui-surface-2, var(--ui-surface));
  border-top: 1px solid var(--ui-border);
}
.fumbbl-home-zoom .zoom-range { width: 140px; accent-color: var(--ui-accent); }
.fumbbl-home-zoom button {
  min-width: 26px;
  height: 22px;
  padding: 0 6px;
  color: var(--ui-text);
  font-size: max(var(--ui-min-text-size, 12px), 0.85rem);
  line-height: 1;
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  cursor: pointer;
}
.fumbbl-home-zoom button:disabled { opacity: 0.45; cursor: default; }
.fumbbl-home-zoom .zoom-value { min-width: 48px; font-variant-numeric: tabular-nums; }
.fumbbl-home-note {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 1.5rem;
  text-align: center;
}
.fumbbl-home-note h3 { margin: 0; }
.fumbbl-home-actions { display: flex; gap: 0.6rem; }
</style>
