<script setup lang="ts">
/**
 * Owner 2026-10-05: the Home blade - the FUMBBL website in the main window (Home > Play > Spectate ...).
 * In every edition since the owner's 10-06 decision.
 *
 * This element is a placeholder: the site itself is a shell-owned native webview positioned over it
 * (src-tauri/src/fumbbl_home.rs). The rules for when it may show live in game/fumbblHome.ts.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ui } from '../game/ui';
import { flushSettingsFile, settings } from '../game/settings';
import { HOME_TOUR_VERSION, shouldStartTour, tourCall } from '../game/homeTour';
import { colorblindFilter } from '../game/colorblindFilters';
import { createTourController } from '../game/homeTourController';
import {
  FUMBBL_HOME_URL,
  HOME_ZOOM_MAX,
  HOME_ZOOM_MIN,
  HOME_ZOOM_STEP,
  clampHomeZoom,
  homeFocus,
  homeJoinWatch,
  homeSurface,
  homeZoomLabel,
  sendHomeFilter,
  sendHomeZoom,
  startHomeJoinWatch,
  stepHomeZoom,
} from '../game/fumbblHome';


const host = ref<HTMLElement | null>(null);
/** Owner 10-08: every show / hide of the site goes through the one driver (game/fumbblHome.ts homeSurface), which the
 *  floating FUMBBL window shares. This pane only says "my element is the host" and reads the driver's state. */
const surface = homeSurface.state;
const shell = computed(() => surface.shell);
const failed = computed(() => surface.failed);
const blocked = computed(() => surface.blocked);
/** The site is on screen over THIS pane. */
const showing = computed(() => surface.showing && surface.owner === 'pane');

let mounted = false;
let release: (() => void) | null = null;
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
watch(() => ui.clientTourActive, () => homeSurface.invalidate());
// Owner 10-06: the site follows the client's colorblind mode, live.
watch(() => settings.colorblindMode, (mode) => { if (shell.value === 'available') void sendHomeFilter(colorblindFilter(mode)); });
watch(() => [showing.value, settings.homeTourSeenVersion, settings.completedFirstRun, settings.setupWizardSeenVersion], maybeStartTour);

/** The walkthrough's two shell events, registered before the driver's first show for this pane (onShell below). */
async function listenForTour(): Promise<void> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const offTour = await listen('fumbbl-home:tour', (e) => { void tour.siteEvent(e.payload); });
    if (mounted) unlistenTour = offTour;
    else offTour();
    const offTourPage = await listen('fumbbl-home:page-load', (e) => { void tour.pageLoad(e.payload); });
    if (mounted) unlistenTourPage = offTourPage;
    else offTourPage();
    tourListening = mounted;
    maybeStartTour();
  } catch {
    /* no walkthrough without its events; the site itself is unaffected */
  }
}

function retry(): void {
  homeSurface.retry();
}

function retryBlocked(): void {
  homeSurface.retryBlocked();
}

async function openInBrowser(): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(FUMBBL_HOME_URL);
  } catch {
    window.open(FUMBBL_HOME_URL, '_blank', 'noopener');
  }
}

/** Owner 10-08: keep the site open in the floating window while another blade, a game or a replay is on screen. */
function toggleFloating(): void {
  ui.fumbblFloating = !ui.fumbblFloating;
  ui.fumbblFloatHeldAt = 0; // the user's own choice: no launch brings it back or takes it away
}

onMounted(() => {
  mounted = true;
  if (!host.value) return;
  release = homeSurface.attach('pane', host.value, {
    // Owner 10-06: the client walkthrough (main webview) runs with the site hidden, so its cards are never under it.
    active: () => !ui.clientTourActive,
    onShell: (detected) => {
      if (!mounted || detected !== 'available') return undefined;
      // Before the first show: the shell applies both to the webview it creates (the zoom, then the client's colorblind
      // correction - the same matrix the shell uses). One after the other: two concurrent first loads of the IPC module
      // race under the test runner's module mock.
      // Owner 10-09: the docked page is always the WHOLE page at the pane's own zoom - the floating window's queue
      // view and its own zoom never follow the site back here (the zoom just sent is the pane's saved one).
      // Astra 10-09 (F3): "off" is sent every time the pane takes the site (forced), whatever the driver believes -
      // the docked page must never be left cropped.
      void sendHomeZoom(zoom.value)
        .then(() => sendHomeFilter(colorblindFilter(settings.colorblindMode)))
        .then(() => { if (mounted) homeFocus.set('off', true); })
        // Owner 10-09: pressing the page's "Join the Draw" turns floating on. The watch belongs to the app, not to
        // this pane (Astra R2): it only has to be started once the shell is known to have the site.
        .then(() => startHomeJoinWatch());
      return listenForTour();
    },
  });
});

onBeforeUnmount(() => {
  mounted = false;
  // Leaving the blade straight after pressing "Join the Draw" is the natural gesture: ask once more now, rather than
  // waiting for the watch's next turn - the floating window then appears at once.
  if (shell.value === 'available') void homeJoinWatch.poll();
  tourListening = false;
  unlistenTour?.();
  unlistenTourPage?.();
  // Leaving mid-walkthrough: take the overlay off the site; it starts over the next time the pane shows.
  if (tour.running()) {
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('fumbbl_home_tour', { call: tourCall('clear') }))
      .catch(() => undefined);
  }
  tour.stop();
  // Leaving the blade (or a game taking the window over): the site must never sit on top of what comes next. The driver
  // hides it - unless the floating window takes the site over in the same tick.
  release?.();
  release = null;
});
</script>

<template>
  <div class="fumbbl-home-blade">
  <!-- Owner 10-09: the Float control sits in its own strip ABOVE the pane, at the top right (in the bottom strip it
       ran under the shell's version / signed-in text). Above the pane element, never over it: the site's bounds are
       the pane's own rect, so the native webview never covers it and the occlusion probe never sees it. -->
  <div v-if="shell === 'available'" class="fumbbl-home-top">
    <!-- Owner 10-08: keep the site (and a Gamefinder queue in it) open in a small movable window while watching a game
         or a replay. In this strip, never over the site. -->
    <!-- Owner 10-09: no explanatory line beside the button ("Delete this"); the button's title carries it. -->
    <button
      type="button"
      class="float-toggle"
      data-testid="fumbbl-float-toggle"
      :aria-pressed="ui.fumbblFloating"
      :title="ui.fumbblFloating
        ? 'FUMBBL stays open in a small window when you leave this page. Click to turn that off.'
        : 'Keep FUMBBL open in a small movable window while you watch a game or a replay - for example while you wait in the Gamefinder queue.'"
      @click="toggleFloating()"
    >{{ ui.fumbblFloating ? 'Keeping Queue Open' : 'Keep Queue Open' }}</button>
  </div>
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
.fumbbl-home-top {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  background: var(--ui-surface-2, var(--ui-surface));
  border-bottom: 1px solid var(--ui-border);
}
.fumbbl-home-top .float-toggle {
  flex: none;
  height: 22px;
  padding: 0 10px;
  color: var(--ui-text);
  font-size: max(var(--ui-min-text-size, 12px), 0.85rem);
  line-height: 1;
  white-space: nowrap;
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  cursor: pointer;
}
.fumbbl-home-top .float-toggle[aria-pressed='true'] { border-color: var(--ui-accent); box-shadow: inset 0 0 0 1px var(--ui-accent); }
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
