import { reactive } from 'vue';

/** Settings reflow (11-03): the UI zoom the main webview is at (game/uiZoom.ts applies it). Kept apart from uiZoom.ts so
 *  the FUMBBL.COM pane driver can scale its bounds without importing the settings store. */
export const uiZoomState = reactive({
  /** The factor the webview is at, as far as the client knows (1 until a setZoom succeeds). */
  applied: 1,
  /** The shell refused the zoom (no capability in this build). */
  unavailable: false,
  /** Owner 11-03: the startup probe found a shell that can zoom (game/uiZoom.ts probeUiZoom). Settings shows the UI
   *  zoom row only while this is true; false until the probe answers, and outside the shell. */
  available: false,
  /** Sol r5: a native setZoom call is in flight (its page resize may land before its confirmation). */
  inFlight: false,
});

/** The zoom factor the shell's child webview bounds must be multiplied by. */
export function appliedUiZoom(): number {
  const z = uiZoomState.applied;
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/** CSS-px bounds (getBoundingClientRect) to the window's logical px under the applied page zoom. */
export function scaleBoundsForShell<T extends { x: number; y: number; width: number; height: number }>(bounds: T, factor = appliedUiZoom()): T {
  if (factor === 1) return bounds;
  return {
    ...bounds,
    x: Math.round(bounds.x * factor),
    y: Math.round(bounds.y * factor),
    width: Math.round(bounds.width * factor),
    height: Math.round(bounds.height * factor),
  };
}


