<script setup lang="ts">
/**
 * Owner 2026-10-08: the floating FUMBBL window.
 *
 * "When a user clicks 'Join the Draw' in Gamefinder, can we keep that window open in the background and surface a
 * floating window ... It should be movable. The goal is to allow users to spectate games and replays while in queue."
 *
 * This is the SAME live site as the FUMBBL.COM blade - the one shell-owned native webview (src-tauri/src/fumbbl_home.rs)
 * - shown small over whatever else is on screen. Nothing is reloaded: the page (and a Gamefinder queue in it) simply
 * keeps running. App.vue mounts this while ui.fumbblFloating is on and the blade itself is not the current view.
 *
 * Shape (same rules as ChatDock / RosterPopout):
 *  - Mounted INSIDE the shell (App.vue's <main class="shell">), never teleported; the root IS the frame - one
 *    positioned box, never a viewport-sized layer. Astra 10-08 (P2): a colourblind correction is a CSS filter on the
 *    shell, which makes the shell one stacking context. A frame on <body> then sat above EVERY dialog, menu and alert
 *    in the shell whatever their z-index, and stayed there (opaque, taking the pointer) after the site itself had been
 *    hidden for them. Inside the shell its z-index is compared with theirs in every colour mode, and it gets the
 *    shell's filter for free (so it carries none of its own).
 *  - The header (move, Close), the tools strip and the resize strip are OUTSIDE the placeholder that hosts the site: a
 *    native surface draws above all HTML, so anything inside that rectangle would be covered by the page.
 *  - Position is an edge-anchored EdgePanelPosition handled only by the shared helpers in game/edgePanelLayout.ts
 *    (no clamp of its own - a persisted-panel clamp must be idempotent on fractional rects, and that one is).
 *  - Owner 10-09 ("Resizing the window blanks the preview ... maintain visibility of the viewport during resizing"):
 *    the site STAYS VISIBLE while the frame is moved or resized and follows it. The first build hid it for the length
 *    of the gesture, for one reason only: every bounds update is a round trip to the shell's main thread. The driver
 *    already answers that - one update per animation frame at most, one in flight, the latest wins (game/fumbblHome.ts
 *    flush) - so the hide bought nothing but a blank frame (and its focus hand-over between the two webviews is what
 *    used to end a drag early). The site may trail the frame by a frame; it is never hidden for a gesture.
 *    A move / resize ends only when the pointer is let go (bindHeldPointerCompletion).
 *  - When our own UI is in front of it (a dialog, a menu) the driver hides the site (game/fumbblHome.ts); the note
 *    underneath then explains the empty frame.
 *  - No role="dialog": the app's Esc handling treats dialogs specially, and this is not one.
 *
 * Owner 2026-10-09: what the frame shows, and how big.
 *  - ALWAYS the QUEUE view: the page cropped to the Gamefinder's queue panel, anchored at the frame's top-left
 *    (game/fumbblHome.ts homeFocus -> the shell -> the runtime inside the site's webview). "We really don't need to
 *    have them able to access the whole page. I really just need the queue focused and targeted" - the whole page is
 *    what the docked FUMBBL.COM pane is for. There is no Return button either: opening the FUMBBL.COM blade docks the
 *    page (this frame unmounts while that blade is on screen; floating stays on, so it comes back when the coach
 *    leaves the blade), and Close ends floating.
 *  - By default the frame is exactly the BLACKBOX box ("reduce the viewfinder window to just the blackbox section ...
 *    Allow users to resize to fit"): the page reports that box's size and the frame fits it at the current zoom
 *    (game/fumbblFloatLayout.ts fitQueueSize). Dragging the grip sets the coach's own size (settings.
 *    fumbblFloatQueueSize) - larger brings Match Offers, directly below, into view - and from then on frame and zoom
 *    are independent. "Fit" goes back to the automatic size.
 *  - The ZOOM slider is how big the content is drawn: the float's own setting (fumbblFloatZoom, 50-200 %, default
 *    100 %). The docked pane's saved zoom is sent back when this window lets go of the site.
 *  - Astra 10-09 (R1): what the coach needs is never under the frame's edge. While Match Offers has something in it
 *    (the page says so, by structure) the frame GROWS to the whole panel whatever its size, with the line "Match offer
 *    received", and goes back to the coach's size when the offers are gone; a dialog inside the panel is grown to in
 *    the same way.
 *  - When the crop is NOT in effect the frame shows the page as it is, at the whole-page size (settings.
 *    fumbblFloatSize), and one line says why: no such panel on this page, the site showing a dialog of its own (the
 *    crop is dropped so nothing of the site's is ever out of view), the page not answering, or an older shell.
 *  - All of it needs a shell with fumbbl_home_focus_region. On an older shell `enhanced` stays false: no strip, no
 *    slider, no crop, no zoom of its own.
 *  - The strip sits in the frame's own chrome, above the placeholder, so the site never covers it.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  anchorPanelPosition,
  bindHeldPointerCompletion,
  persistClampedPanelPosition,
  resizablePanelStyle,
  type EdgePanelPosition,
} from '../game/edgePanelLayout';
import {
  FLOAT_NOTICE_H,
  FLOAT_STATUS_H,
  FLOAT_ZOOM_MIN,
  defaultFloatPosition,
  fitFloatSize,
  fitQueueSize,
  nextQueueBox,
  sanitizeQueueBox,
  unionQueueBox,
} from '../game/fumbblFloatLayout';
import { FOCUS_CLICK_THROUGH_ATTRIBUTE } from '../game/focusClickGuard';
import { colorblindFilter } from '../game/colorblindFilters';
import {
  HOME_ZOOM_MAX,
  HOME_ZOOM_STEP,
  clampHomeZoom,
  dismissHomeSite,
  homeFocus,
  homeQueued,
  homeSurface,
  homeZoomLabel,
  sendHomeFilter,
  sendHomeZoom,
  startHomeJoinWatch,
  stepHomeZoom,
} from '../game/fumbblHome';
import { settings } from '../game/settings';
import { ui } from '../game/ui';

const frameEl = ref<HTMLElement | null>(null);
const hostEl = ref<HTMLElement | null>(null);
const surface = homeSurface.state;

const viewport = ref({
  width: typeof window === 'undefined' ? 0 : window.innerWidth,
  height: typeof window === 'undefined' ? 0 : window.innerHeight,
});
const dragging = ref(false);
const resizing = ref(false);
/** The frame's top-left pinned for the length of a resize (the stored anchor may be the right / bottom edge). */
const resizeOrigin = ref<{ x: number; y: number } | null>(null);
const moving = computed(() => dragging.value || resizing.value);

const liveViewport = () => ({ width: window.innerWidth, height: window.innerHeight });

// ---- what the frame shows (owner 10-09: always the queue view) --------------------------------------------------------

const focus = homeFocus.state;
/** This shell has the queue-focus command. False / unknown: nothing below is shown or sent. */
const enhanced = computed(() => focus.supported === true);
/** The site is on screen in THIS frame. */
const floatShowing = computed(() => surface.showing && surface.owner === 'float');
/** The frame is the queue view's: the page is cropped to the panel, or the answer is still out. False = the page shows
 *  as it is (no panel here, a dialog of the site's, no answer, an older shell). */
const queueSized = computed(() => enhanced.value && focus.found !== false);

const zoom = ref(clampHomeZoom(settings.fumbblFloatZoom, FLOAT_ZOOM_MIN));

/** The whole panel as the page last measured it (the frame never grows past it: beyond it is the rest of the page). */
const regionBox = computed(() => (focus.found === true ? sanitizeQueueBox(focus.width, focus.height) : null));

/** Astra 10-09 (R1): how much of the panel MUST be in view right now, beyond whatever size the frame has - the whole
 *  panel while Match Offers has something in it (an arriving offer must never sit under the frame's edge), and as far
 *  as a dialog inside the panel reaches. Null = nothing more than the coach's own size. */
/** The X was pressed and the coach was told to leave the draw first (see close()). */
const noticeUp = ref(false);
/** The coach has been told to leave the draw first: the Blackbox box stays whole in view until they are out. */
const leaveFirst = ref(false);
/** May the coach be in the draw? The app's one answer (game/fumbblHome.ts homeQueued) - this component only draws it. */
const queued = homeQueued.state;
/**
 * What the notice says - drawn from the driver's CURRENT state every time, never remembered here:
 *  'queued'     'yes': the page shows them in the draw - no way round it but leaving;
 *  'unreadable' 'maybe': they may be in it and the page has not settled it - "Close anyway" once that has lasted;
 *  ''           nothing to say (not up, or 'no').
 */
const notice = computed<'' | 'queued' | 'unreadable'>(() => {
  if (!noticeUp.value) return '';
  return queued.queued === 'yes' ? 'queued' : queued.queued === 'maybe' ? 'unreadable' : '';
});
const canCloseAnyway = computed(() => notice.value === 'unreadable' && queued.closeAnyway);

const attention = computed(() => {
  if (focus.found !== true) return null;
  const needed = sanitizeQueueBox(focus.needWidth, focus.needHeight);
  // The coach was told to leave the draw: the page's own "Leave the Draw" button is in the Blackbox box, so the whole
  // of that box is kept in view - whatever size the frame had been given - until they are out.
  return unionQueueBox(needed, leaveFirst.value ? sanitizeQueueBox(focus.primaryWidth, focus.primaryHeight) : null);
});
const offersWaiting = computed(() => focus.found === true && focus.offers === true);

/** Whole pixels, at least the minimum, never larger than the window. The stored sizes are left alone when the window
 *  is merely too small for them: they come back when the window grows. */
const pageSize = computed(() => fitFloatSize(settings.fumbblFloatSize, viewport.value));
const size = computed(() => (queueSized.value
  ? fitQueueSize({
    stored: settings.fumbblFloatQueueSize,
    primary: ui.fumbblFloatQueueBox,
    region: regionBox.value,
    zoom: zoom.value,
    available: viewport.value,
    fallback: pageSize.value,
    attention: attention.value,
    // The "Match offer received" line takes its own room; so does the "leave the draw first" notice.
    extraHeight: (offersWaiting.value ? FLOAT_STATUS_H : 0) + (notice.value ? FLOAT_NOTICE_H : 0),
  })
  : pageSize.value));
const panel = computed(() => ({ width: size.value.w, height: size.value.h }));
const position = computed<EdgePanelPosition>(() => settings.fumbblFloatPos ?? defaultFloatPosition(size.value, viewport.value));

const frameStyle = computed(() => ({
  ...resizablePanelStyle(position.value, panel.value, viewport.value, resizeOrigin.value),
  width: `${size.value.w}px`,
  height: `${size.value.h}px`,
}));

/** The Blackbox box the automatic fit uses follows what the page reports (see nextQueueBox for the one exception). */
let refit = false;
watch(() => [focus.found, focus.primaryWidth, focus.primaryHeight] as const, ([found, width, height]) => {
  if (found !== true) return;
  const next = nextQueueBox(ui.fumbblFloatQueueBox, sanitizeQueueBox(width, height), refit);
  refit = false;
  if (next !== ui.fumbblFloatQueueBox) ui.fumbblFloatQueueBox = next;
}, { immediate: true });

/** "Fit": back to the automatic size - exactly the Blackbox box at the current zoom, measured afresh. */
function fitToPanel(): void {
  settings.fumbblFloatQueueSize = null;
  refit = true;
  if (focus.found === true) {
    const measured = sanitizeQueueBox(focus.primaryWidth, focus.primaryHeight);
    if (measured) {
      ui.fumbblFloatQueueBox = measured;
      refit = false;
    }
  }
  if (enhanced.value && floatShowing.value) homeFocus.set('queue');
}

/** One line in the frame's chrome whenever the queue view is NOT what the frame shows, saying why. */
const status = computed(() => {
  if (surface.shell !== 'available') return '';
  if (focus.supported === false) return 'This version of the app cannot show only the queue - showing the whole page. The latest installer can.';
  if (enhanced.value && offersWaiting.value) return 'Match offer received';
  if (!enhanced.value || focus.found !== false) return '';
  switch (focus.reason) {
    case 'dialog': return 'FUMBBL is showing a dialog - showing the whole page until it closes.';
    case 'frame': return 'The queue panel is inside a frame on this page - showing the whole page.';
    case 'shadow': return 'The queue panel is inside a component this window cannot crop - showing the whole page.';
    case 'error': return `The page reported an error${focus.error ? ` (${focus.error})` : ''} - showing the whole page.`;
    // Owner 10-09 ("The screen is black on the float"): a frame is never silently empty. If the page would cut the
    // panel off, the crop is not used at all and the frame says so.
    case 'clipped': return 'The queue view cannot be drawn on this page - showing the whole page.';
    case 'no-answer': return 'The page did not answer - showing the whole page.';
    case 'loading': return '';
    default: return 'Queue panel not found on this page - showing the page.';
  }
});

/** Shown under the site; visible only while the site is not. */
const note = computed(() => {
  if (surface.shell === 'detecting') return 'Loading FUMBBL…';
  if (surface.shell !== 'available') return 'The FUMBBL.COM pane needs the latest installer.';
  if (surface.blocked) return 'The page kept leaving fumbbl.com, so it was stopped. Open the FUMBBL.COM page to try again.';
  if (surface.failed) return 'The FUMBBL website could not be shown here. Open the FUMBBL.COM page to try again.';
  return 'FUMBBL is still open. It is hidden while a menu or dialog is in front of this window.';
});

// ---- move (header only) ---------------------------------------------------------------------------------------------

let endInteraction: (() => void) | null = null;

function startDrag(event: PointerEvent): void {
  if (event.button !== 0 || moving.value) return;
  if ((event.target as HTMLElement | null)?.closest('button')) return; // Close stays clickable
  const el = frameEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const grip = event.currentTarget as HTMLElement;
  const start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
  const move = (next: PointerEvent) => {
    // Captured at every step, like the chat pop-out: the nearest edges are the anchor, so the frame follows the window.
    settings.fumbblFloatPos = anchorPanelPosition(
      { x: start.left + next.clientX - start.x, y: start.top + next.clientY - start.y },
      panel.value,
      liveViewport(),
    );
  };
  grip.setPointerCapture?.(event.pointerId);
  dragging.value = true;
  window.addEventListener('pointermove', move);
  const teardown = bindHeldPointerCompletion(window, event.pointerId, () => {
    window.removeEventListener('pointermove', move);
    endInteraction = null;
    dragging.value = false;
  });
  endInteraction = () => { teardown(); window.removeEventListener('pointermove', move); };
  event.preventDefault();
}

// ---- resize (the strip's corner grip; the site covers any grip inside its own rectangle) ---------------------------

function startResize(event: PointerEvent): void {
  if (event.button !== 0 || moving.value) return;
  const el = frameEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const grip = event.currentTarget as HTMLElement;
  const origin = { x: Math.round(rect.left), y: Math.round(rect.top) };
  const start = { x: event.clientX, y: event.clientY, w: size.value.w, h: size.value.h };
  // The size being set is the one the frame is using: the queue view's own, or the whole-page one.
  const queue = queueSized.value;
  const move = (next: PointerEvent) => {
    const view = liveViewport();
    const wanted = { w: start.w + next.clientX - start.x, h: start.h + next.clientY - start.y };
    // From the pinned top-left the frame may grow to the window's edge, no further.
    const room = { width: view.width - origin.x, height: view.height - origin.y };
    if (queue) {
      // The coach's own size from here on: the automatic fit (and its following of the zoom) ends with the first step.
      settings.fumbblFloatQueueSize = fitQueueSize({
        stored: wanted, primary: null, region: regionBox.value, zoom: zoom.value, available: room, fallback: wanted, margin: 0,
      });
    } else {
      settings.fumbblFloatSize = fitFloatSize(wanted, room, 0);
    }
  };
  grip.setPointerCapture?.(event.pointerId);
  resizeOrigin.value = origin;
  resizing.value = true;
  window.addEventListener('pointermove', move);
  const teardown = bindHeldPointerCompletion(window, event.pointerId, () => {
    window.removeEventListener('pointermove', move);
    endInteraction = null;
    // Recapture the nearest edges from the final rectangle, then let go of the pinned corner.
    settings.fumbblFloatPos = anchorPanelPosition(origin, panel.value, liveViewport());
    resizeOrigin.value = null;
    resizing.value = false;
  });
  endInteraction = () => { teardown(); window.removeEventListener('pointermove', move); };
  event.preventDefault();
}

// ---- viewport -------------------------------------------------------------------------------------------------------

/** Keep a frame saved on a bigger window on screen. The shared helper decides whether anything is written at all
 *  (a harmless projection of a right / bottom anchor is not a write). */
function clampToViewport(): void {
  viewport.value = liveViewport();
  const stored = settings.fumbblFloatPos;
  if (!stored || moving.value) return;
  persistClampedPanelPosition(stored, panel.value, viewport.value, (next) => { settings.fumbblFloatPos = next; });
}

// The frame changed size by itself (the fit followed the page or the zoom; the view changed): the stored place is an
// edge anchor, so the anchored corner stays where the coach put it - and the same shared clamp keeps it on screen.
watch(() => `${size.value.w}x${size.value.h}`, () => { if (!moving.value) clampToViewport(); });

// ---- header actions -------------------------------------------------------------------------------------------------

/** Owner 10-09: Close DISMISSES the site - "when the floating pane is dismissed ... the page is then inactive and
 *  closed". The driver parks it (hidden AND unloaded: no timers, no queue, no sounds) once this window has let go;
 *  the FUMBBL.COM blade loads it again, still logged in. */
function dismiss(): void {
  ui.fumbblFloating = false; // App.vue unmounts this; the release below lets go of the site
  ui.fumbblFloatHeldAt = 0;
  dismissHomeSite(); // parks the site - and no "Join the Draw" press from before this moment floats it again
}

/*
 * Owner 10-09: "IF the user has selected Join the draw and the user selects the X then let's pop a modal telling them
 * that they must leave the draw before they can close the pane."
 *
 * Unloading the page does not take the coach out of the draw - the server keeps them in it, and a match could be drawn
 * with nobody watching. So while the page says they are in the draw, the X does not close and nothing is parked: the
 * frame says so, and the coach leaves the draw THEMSELVES, with the site's own button. Nothing on the site is pressed
 * for them - the floating window only ever looks at the page.
 *
 * Where the message is: in the frame's OWN chrome, above the site, never over it. The site is a native surface that
 * draws above all HTML, so a dialog laid over the frame would either be covered by the page or need the page hidden
 * - and the page is exactly what the coach needs next: its "Leave the Draw" button stays visible and clickable right
 * under the message, with the whole Blackbox box kept in view.
 *
 * WHETHER they may be in the draw is not decided here. It is the driver's (game/fumbblHome.ts reduceQueued /
 * homeQueued: one pure state machine at app scope, fed by every report - what the page positively shows, the "Join the
 * Draw" presses, the page load they belong to) and survives this frame coming and going:
 *  'no'    the X closes and parks, as before;
 *  'yes'   the notice, and no way round it;
 *  'maybe' the notice, with "Close anyway" once it has stayed 'maybe' for a moment - so a page that cannot say (the
 *          Blackbox paused, the finder not working) can never trap the window open.
 * Only this button asks. The coach's own game starting, a blade switch and the pane's toggle are as they were.
 */
watch(() => queued.queued, (now) => {
  if (now !== 'no') return;
  // The page has shown the coach out of the draw: nothing left to say; the X closes again.
  leaveFirst.value = false;
  noticeUp.value = false;
}, { immediate: true });

function close(): void {
  if (homeQueued.queued() !== 'no') { // asked of the driver NOW, not read off what was last drawn
    noticeUp.value = true;
    leaveFirst.value = true;
    return; // not closed, nothing parked, nothing sent to the page
  }
  dismiss();
}

function acknowledgeNotice(): void {
  noticeUp.value = false;
}

/** The coach's deliberate choice, only while 'maybe' and only once that has lasted - checked against the driver's
 *  state at the moment of the press: a button drawn a moment ago is not a permission. */
function closeAnyway(): void {
  if (homeQueued.queued() !== 'maybe' || !homeQueued.mayCloseAnyway()) return;
  dismiss();
}

// The site follows the client's colorblind mode, live (the docked pane does the same while it is mounted).
watch(() => settings.colorblindMode, (mode) => {
  if (surface.shell === 'available') void sendHomeFilter(colorblindFilter(mode));
});
watch(() => ui.clientTourActive, () => homeSurface.invalidate());

// ---- the float's own zoom (owner 10-09) -------------------------------------------------------------------------------

/** The slider: how big the content is drawn. The frame's place is untouched; its SIZE follows only while it is still
 *  the automatic fit (so 160 % shows the whole Blackbox box at 160 %) - never once the coach has set a size. */
function setZoom(value: number): void {
  const next = clampHomeZoom(value, FLOAT_ZOOM_MIN);
  zoom.value = next;
  settings.fumbblFloatZoom = next;
  if (enhanced.value) void sendHomeZoom(next, FLOAT_ZOOM_MIN);
}

/** How often the frame asks the page whether the queue panel is (still) what it shows. The page cannot tell the host
 *  anything by itself; this is a local question to our own webview, never a request to FUMBBL. Every second: it is
 *  also how the frame hears that the site opened a dialog of its own and the page is showing whole for it. */
const FOCUS_RECHECK_MS = 1000;
let recheck = 0;

// The float takes the site: its own zoom. (The pane sends its saved zoom when it takes it back - and so does the
// unmount below, for a Close with no pane on screen.)
watch(() => enhanced.value && surface.owner === 'float', (mine) => {
  if (mine) void sendHomeZoom(zoom.value, FLOAT_ZOOM_MIN);
}, { immediate: true });

// The crop. Asked for whenever the site (re)appears in this frame - after a dialog of ours, a launch - and re-checked
// while it shows; the page itself keeps the panel anchored while its viewport changes.
watch([enhanced, floatShowing], ([can, showing]) => {
  window.clearInterval(recheck);
  recheck = 0;
  if (!can || !showing) return;
  homeFocus.set('queue');
  recheck = window.setInterval(() => homeFocus.set('queue'), FOCUS_RECHECK_MS);
}, { immediate: true });


let release: (() => void) | null = null;

onMounted(() => {
  window.addEventListener('resize', clampToViewport);
  clampToViewport();
  if (!hostEl.value) return;
  release = homeSurface.attach('float', hostEl.value, {
    // Hidden under the client walkthrough (as the docked pane is). NOT while it is moved or resized (owner 10-09).
    active: () => !ui.clientTourActive,
    // The frame is never its own occluder.
    frame: frameEl.value,
    // Over the match HUD: live regions lying under the frame must not hide the site (dialogs and menus always do).
    refineOverlays: true,
    // Shell known but never asked (the pane has not been open): "off" is the question that tells an older shell apart.
    // Here, after detection - never alongside it (two first loads of the IPC module race under the test runner's mock).
    onShell: (shell) => {
      if (shell !== 'available') return;
      if (focus.supported === null) homeFocus.set('off');
      startHomeJoinWatch(); // the app's one Join watch (it may never have been started: the pane was not opened)
    },
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', clampToViewport);
  endInteraction?.();
  endInteraction = null;
  window.clearInterval(recheck);
  recheck = 0;
  if (enhanced.value) {
    // The site leaves this frame (the blade opened, Close, a launch): the whole page again, at the docked pane's
    // saved zoom.
    homeFocus.set('off');
    void sendHomeZoom(clampHomeZoom(settings.homePaneZoom));
  }
  release?.();
  release = null;
});

const clickThrough = { [FOCUS_CLICK_THROUGH_ATTRIBUTE]: '' };
</script>

<template>
  <section
    ref="frameEl"
    class="fumbbl-float"
    :class="{ 'fumbbl-float--moving': moving }"
    :style="frameStyle"
    aria-label="FUMBBL window"
    data-testid="fumbbl-float"
    v-bind="clickThrough"
  >
    <header class="fumbbl-float-head" data-testid="fumbbl-float-head" @pointerdown="startDrag">
      <span class="fumbbl-float-grip" title="Drag to move" aria-hidden="true">⠿</span>
      <span class="fumbbl-float-title">FUMBBL</span>
      <button
        type="button"
        class="fumbbl-float-btn fumbbl-float-close"
        data-testid="fumbbl-float-close"
        aria-label="Close the FUMBBL window"
        :title="queued.queued === 'yes'
          ? 'You are in the draw: leave the draw on the page before closing this window'
          : queued.queued === 'maybe'
            ? 'You may still be in the draw: this window asks before it closes'
            : 'Close this window and the FUMBBL page in it (it stops running; open FUMBBL.COM to load it again)'"
        :data-queued="queued.queued"
        @click="close()"
      >×</button>
    </header>
    <!-- Owner 10-09: Fit + the float's own zoom. In the frame's chrome, ABOVE the placeholder - the site's bounds are
         the placeholder's rect, so the native webview never covers these. Not a drag handle. -->
    <div v-if="enhanced" class="fumbbl-float-tools" data-testid="fumbbl-float-tools">
      <div class="fumbbl-float-fit">
        <button
          v-if="queueSized"
          type="button"
          class="fumbbl-float-btn"
          data-testid="fumbbl-float-fit"
          :data-auto="settings.fumbblFloatQueueSize === null"
          title="Fit the window to the Blackbox panel"
          @click="fitToPanel()"
        >Fit</button>
      </div>
      <div class="fumbbl-float-zoom">
        <button type="button" class="fumbbl-float-btn" data-testid="fumbbl-float-zoom-out" aria-label="Zoom out" :disabled="zoom <= FLOAT_ZOOM_MIN" @click="setZoom(stepHomeZoom(zoom, -1, FLOAT_ZOOM_MIN))">−</button>
        <input
          class="fumbbl-float-zoom-range"
          data-testid="fumbbl-float-zoom"
          type="range"
          :min="FLOAT_ZOOM_MIN"
          :max="HOME_ZOOM_MAX"
          :step="HOME_ZOOM_STEP"
          :value="zoom"
          aria-label="FUMBBL window zoom"
          :aria-valuetext="homeZoomLabel(zoom, FLOAT_ZOOM_MIN)"
          @input="setZoom(($event.target as HTMLInputElement).valueAsNumber)"
        />
        <button type="button" class="fumbbl-float-btn" data-testid="fumbbl-float-zoom-in" aria-label="Zoom in" :disabled="zoom >= HOME_ZOOM_MAX" @click="setZoom(stepHomeZoom(zoom, 1, FLOAT_ZOOM_MIN))">+</button>
        <button type="button" class="fumbbl-float-btn fumbbl-float-zoom-value" data-testid="fumbbl-float-zoom-reset" title="Reset to 100%" @click="setZoom(1)">{{ homeZoomLabel(zoom, FLOAT_ZOOM_MIN) }}</button>
      </div>
    </div>
    <p v-if="status" class="fumbbl-float-status" role="note" data-testid="fumbbl-float-status" :title="status" :data-reason="focus.supported === false ? 'unsupported' : offersWaiting ? 'offers' : focus.reason">{{ status }}</p>
    <!-- Owner 10-09: "must leave the draw before they can close". In the frame's chrome, ABOVE the site - the page's
         own "Leave the Draw" button stays visible and clickable under it. role="alert": announced, and not a dialog
         (the app's Esc handling treats dialogs specially). -->
    <div v-if="notice" class="fumbbl-float-notice" role="alert" data-testid="fumbbl-float-notice" :data-kind="notice">
      <p class="fumbbl-float-notice-text">{{ notice === 'queued'
        ? 'You are still in the draw. Leave the draw before closing this window.'
        : 'You may still be in the draw: the page is not showing it right now. Leave the draw before closing this window.' }}</p>
      <div class="fumbbl-float-notice-actions">
        <button
          v-if="canCloseAnyway"
          type="button"
          class="fumbbl-float-btn"
          data-testid="fumbbl-float-notice-close"
          title="Close this window and the FUMBBL page in it although you may still be in the draw"
          @click="closeAnyway()"
        >Close anyway</button>
        <button type="button" class="fumbbl-float-btn" data-testid="fumbbl-float-notice-ok" @click="acknowledgeNotice()">OK</button>
      </div>
    </div>
    <div ref="hostEl" class="fumbbl-float-host" :data-showing="surface.showing && surface.owner === 'float'">
      <p class="fumbbl-float-note" role="note">{{ note }}</p>
    </div>
    <footer class="fumbbl-float-foot">
      <span
        class="fumbbl-float-resize"
        data-testid="fumbbl-float-resize"
        title="Drag to resize"
        aria-hidden="true"
        @pointerdown="startResize"
      ></span>
    </footer>
  </section>
</template>

<style scoped>
/* ONE positioned box, sized to itself. Above the match HUD and the console (z <= 61), below every menu and dialog of
   ours (z >= 80): those draw over the frame, and the driver hides the site while they do. That order only holds
   because the frame is in the shell with them (see the header): never teleport it out, never give it a filter,
   transform or other stacking context of its own above the shell. */
.fumbbl-float {
  position: fixed;
  z-index: 75;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--ui-text, #e8ecf2);
  background: var(--ui-surface, #14161a);
  border: 1px solid var(--ui-border, #3a3f47);
  border-radius: 6px;
  box-shadow: 0 4px 18px #000a;
}
.fumbbl-float--moving { border-style: dashed; border-color: var(--ui-accent, #6aa0ff); box-shadow: none; }
.fumbbl-float-head {
  flex: none;
  box-sizing: border-box;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px 0 6px;
  cursor: move;
  user-select: none;
  touch-action: none;
  background: var(--ui-surface-2, rgba(0, 0, 0, 0.25));
  border-bottom: 1px solid var(--ui-border, #3a3f47);
}
.fumbbl-float-grip { color: var(--ui-muted, #98a0ac); letter-spacing: -2px; }
.fumbbl-float-title {
  flex: 1 1 auto;
  min-width: 0;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  font-weight: 800;
  letter-spacing: 0.06em;
}
.fumbbl-float-btn {
  flex: none;
  height: 22px;
  padding: 0 8px;
  color: var(--ui-text, #e8ecf2);
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  line-height: 1;
  white-space: nowrap;
  background: var(--ui-surface, #14161a);
  border: 1px solid var(--ui-border, #3a3f47);
  border-radius: 4px;
  cursor: pointer;
}
.fumbbl-float-btn:hover:not(:disabled) { background: var(--ui-hover, #2a2f37); }
.fumbbl-float-btn:disabled { opacity: 0.45; cursor: default; }
.fumbbl-float-btn[aria-pressed='true'] { border-color: var(--ui-accent, #6aa0ff); box-shadow: inset 0 0 0 1px var(--ui-accent, #6aa0ff); }
/* The frame's own controls: never part of the site's rectangle. */
.fumbbl-float-tools {
  flex: none;
  box-sizing: border-box;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 4px 0 6px;
  background: var(--ui-surface-2, rgba(0, 0, 0, 0.25));
  border-bottom: 1px solid var(--ui-border, #3a3f47);
}
.fumbbl-float-fit { flex: none; display: flex; gap: 4px; }
.fumbbl-float-zoom { flex: 0 1 auto; min-width: 0; display: flex; align-items: center; gap: 4px; }
.fumbbl-float-zoom-range { flex: 0 1 110px; min-width: 40px; width: 110px; accent-color: var(--ui-accent, #6aa0ff); }
.fumbbl-float-zoom-value { min-width: 46px; font-variant-numeric: tabular-nums; }
.fumbbl-float-status {
  flex: none;
  box-sizing: border-box;
  height: 22px;
  margin: 0;
  padding: 3px 8px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  line-height: 15px;
  color: var(--ui-muted, #98a0ac);
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  background: var(--ui-surface-2, rgba(0, 0, 0, 0.25));
  border-bottom: 1px solid var(--ui-border, #3a3f47);
}
/* The "leave the draw first" notice: a fixed block in the chrome, so the frame can make room for it exactly. */
.fumbbl-float-notice {
  flex: none;
  box-sizing: border-box;
  height: 88px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 4px;
  padding: 6px 8px;
  overflow: hidden;
  color: var(--ui-text, #e8ecf2);
  background: var(--ui-surface-2, rgba(0, 0, 0, 0.25));
  border-bottom: 1px solid var(--ui-accent, #6aa0ff);
}
.fumbbl-float-notice-text {
  margin: 0;
  font-size: max(var(--ui-min-text-size, 12px), 0.76rem);
  line-height: 1.25;
  overflow: hidden;
}
.fumbbl-float-notice-actions { flex: none; display: flex; justify-content: flex-end; gap: 6px; }
.fumbbl-float-close { min-width: 24px; padding: 0 6px; font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); }
/* The placeholder the site is positioned over. Its rectangle is the site's bounds. */
.fumbbl-float-host {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  background: var(--ui-surface, #14161a);
}
.fumbbl-float-note {
  margin: auto;
  padding: 12px 16px;
  color: var(--ui-muted, #98a0ac);
  font-size: max(var(--ui-min-text-size, 12px), 0.8rem);
  text-align: center;
}
.fumbbl-float-foot {
  flex: none;
  box-sizing: border-box;
  height: 14px;
  display: flex;
  justify-content: flex-end;
  background: var(--ui-surface-2, rgba(0, 0, 0, 0.25));
  border-top: 1px solid var(--ui-border, #3a3f47);
}
.fumbbl-float-resize {
  width: 22px;
  height: 100%;
  cursor: nwse-resize;
  touch-action: none;
  background: linear-gradient(135deg, transparent 0 50%, var(--ui-muted, #98a0ac) 50% 58%, transparent 58% 70%, var(--ui-muted, #98a0ac) 70% 78%, transparent 78%);
}
</style>
