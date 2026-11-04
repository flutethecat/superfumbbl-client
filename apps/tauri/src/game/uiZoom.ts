import { UI_ZOOM, clampUiZoom } from './settings';
import { uiZoomState } from './uiZoomShell';

/**
 * Settings reflow (owner 11-03): Settings > Accessibility "UI zoom" (80-150 %, default 100 %) scales the whole client
 * interface - HUD, dialogs, Settings, menus.
 *
 * HOW: the main webview's own zoom (Tauri `Webview.setZoom`, the browser's page zoom), not CSS `zoom` on the app root.
 * Page zoom keeps every coordinate space the client uses in agreement: event.clientX, getBoundingClientRect, offset*,
 * style px, window.innerWidth, ResizeObserver and media queries all change together (the CSS px simply get bigger).
 * So the renderer's pointer math (pitch clicks, drags, marker placement, the telestrator) and the HUD's panel layout
 * (game/edgePanelLayout.ts, drag / resize / clamp) need no change at all. CSS `zoom` on the root would split those
 * spaces (rects and clientX in screen px, style / offset px in zoomed px; WebKit on macOS / Linux differs again from
 * Chromium) and every one of the ~180 rect / clientX sites in the renderer and SpectateView would have to divide by it.
 *
 * THE PITCH: Pixi renders the canvas at devicePixelRatio, which page zoom raises with the CSS px, so the pitch stays
 * sharp and keeps its device-pixel size; an untouched camera re-fits the (now fewer) CSS px of the host on the
 * resize, so the pitch fills the window exactly as before and the camera's own zoom is never touched.
 *
 * WHAT ELSE CHANGES: only the shell's child webview (the FUMBBL.COM pane / floating window) is placed in window
 * logical px, so its bounds are multiplied by the applied factor (scaleBoundsForShell) before they reach the shell.
 *
 * NEEDS: the `core:webview:allow-set-webview-zoom` capability (src-tauri/capabilities/default.json), which only an
 * installer built after 11-03 carries. AVAILABILITY PROBE (owner 11-03: hide the row until that installer ships):
 * before any real request, the client sends ONE `setZoom(1)`. A webview always starts at 1, so the probe changes
 * nothing on screen either way; an old shell rejects it on the capability check alone (permission denied).
 *  - accepted: `uiZoomState.available = true` and the stored zoom applies as built;
 *  - refused (or outside the shell, or an exception): `available = false`, the stored zoom is NEVER sent, nothing
 *    warns or errors, and Settings hides the row (`v-if="uiZoomState.available"`).
 * Why this probe: the shell exposes no capability or version query the client could ask, and every alternative (the app
 * version, a feature flag) can disagree with the binary actually running. The one call it needs is the call itself,
 * at the factor the webview is already at.
 */

export function uiZoomFactor(percent: unknown): number {
  return clampUiZoom(percent) / 100;
}

export interface UiZoomDeps {
  inShell(): boolean;
  setZoom(factor: number): Promise<void>;
  warn(message: string, error: unknown): void;
}

function defaultDeps(): UiZoomDeps {
  return {
    // A real shell runtime only: a missing or stub `__TAURI_INTERNALS__` (jsdom tests, a browser preview) has no
    // working invoke / transformCallback, so it counts as no shell - the probe then never sends, and never throws.
    inShell: () => {
      if (typeof window === 'undefined') return false;
      const internals = (window as { __TAURI_INTERNALS__?: { invoke?: unknown; transformCallback?: unknown } }).__TAURI_INTERNALS__;
      return !!internals && typeof internals.invoke === 'function' && typeof internals.transformCallback === 'function';
    },
    setZoom: async (factor) => {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      await getCurrentWebview().setZoom(factor);
    },
    warn: (message, error) => console.warn(message, error),
  };
}

/** What the client wants the webview at (the latest request). */
let desiredFactor = 1;
/** What the native webview was last CONFIRMED at (a fresh webview starts at 1). */
let shellFactor = 1;
/** The factor whose native request last failed (no retry loop for it until another is asked for). */
let failedFactor: number | null = null;
let draining: Promise<void> | null = null;
let warned = false;

/** Sol r1 P1: native requests are SERIALIZED and COALESCED. One request is in flight at a time; when it settles, the
 *  loop compares the shell with the LATEST desired factor (a reset to 100 % included) and sends again until they agree.
 *  `uiZoomState.applied` only ever holds a factor the shell confirmed. */
async function drain(deps: UiZoomDeps): Promise<void> {
  for (;;) {
    const target = desiredFactor;
    if (target === shellFactor) {
      uiZoomState.applied = shellFactor;
      if (failedFactor !== target) uiZoomState.unavailable = false;
      return;
    }
    if (target === failedFactor) return; // already refused: wait for a different request
    uiZoomState.inFlight = true; // the pitch renderer reads the page zoom from the DPR until this settles
    try {
      await deps.setZoom(target);
      uiZoomState.inFlight = false;
      shellFactor = target;
      failedFactor = null;
      uiZoomState.applied = target;
      uiZoomState.unavailable = false;
    } catch (error) {
      // The native side is unchanged (the call was refused): the shell keeps its last confirmed factor.
      uiZoomState.inFlight = false;
      failedFactor = target;
      uiZoomState.applied = shellFactor;
      // Sol final r3: EVERY refused change is a failure, a return to 100 % included (the shell is then not at 1).
      uiZoomState.unavailable = true;
      if (!warned) { warned = true; deps.warn('UI zoom: this shell build cannot zoom its webview; the interface stays at 100 %', error); }
      if (desiredFactor === target) return;
    }
  }
}

/** Apply `percent` to the main webview. Resolves once the shell agrees with the latest request (or refused it). */
let probe: Promise<boolean> | null = null;
/** The startup availability probe (see the header): one `setZoom(1)`, once per session. */
export function probeUiZoom(deps: UiZoomDeps = defaultDeps()): Promise<boolean> {
  if (!probe) {
    probe = (async () => {
      let ok = false;
      try {
        if (deps.inShell()) { uiZoomState.inFlight = true; await deps.setZoom(1); ok = true; }
      } catch { ok = false; } // an old shell: expected, silent
      uiZoomState.inFlight = false;
      shellFactor = 1;
      uiZoomState.available = ok;
      uiZoomState.unavailable = !ok;
      uiZoomState.applied = 1;
      return ok;
    })();
  }
  return probe;
}

/** Apply `percent` to the main webview once the probe says it can be zoomed; never sends anything otherwise. */
export function applyUiZoom(percent: unknown, deps: UiZoomDeps = defaultDeps()): Promise<void> {
  desiredFactor = uiZoomFactor(percent);
  if (!deps.inShell()) { uiZoomState.available = false; return Promise.resolve(); }
  return probeUiZoom(deps).then((available) => (available ? reconcile(deps) : undefined));
}

function reconcile(deps: UiZoomDeps): Promise<void> {
  if (draining) return draining; // the running loop re-reads desiredFactor after every native call
  const run = (async () => {
    try { await drain(deps); } finally { draining = null; }
    // A request that landed between the loop's last check and this point: reconcile it too.
    if (desiredFactor !== shellFactor && desiredFactor !== failedFactor) await reconcile(deps);
  })();
  draining = run;
  return run;
}

/** The native factor last confirmed (bug reports; tests). */
export function confirmedShellZoom(): number { return shellFactor; }

/** Test seam. */
export function resetUiZoomForTests(): void {
  desiredFactor = 1;
  shellFactor = 1;
  failedFactor = null;
  draining = null;
  probe = null;
  warned = false;
  uiZoomState.available = false;
  uiZoomState.inFlight = false;
  uiZoomState.applied = 1;
  uiZoomState.unavailable = false;
}

export { UI_ZOOM, uiZoomState };
export { appliedUiZoom, scaleBoundsForShell } from './uiZoomShell';
