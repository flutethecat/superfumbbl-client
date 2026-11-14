// Bug 11-12 (JLeav, client 1.0.321, sideways): scrolled to the very bottom, the quick bar (settings ... Report) at the
// bottom-right covered half a row of the INJURED box in the bottom sideline band. The mirror of bug 10-13 at the top
// (hudTopClearance.ts): the host reports how much of the canvas's bottom edge the bar covers and the renderer lets the
// E-W pan bring the bottom band up to clear it.

export interface ClientRectLike { top: number; bottom: number; width: number; height: number }
/** The pitch canvas in client px, and its own pixel height (they differ when the canvas is CSS-scaled). */
export interface CanvasBoxLike { top: number; bottom: number; height: number; screenHeight: number }

/** Breathing room between the covered area's top edge and the band, in client px. */
export const HUD_BOTTOM_GAP_PX = 6;
/** The bar counts as bottom chrome only while it sits within this distance of the canvas's bottom edge (a coach can
 *  move HUD panels; a bar parked elsewhere pins nothing). */
export const HUD_BOTTOM_DOCK_SLACK_PX = 32;
/** Never reserve more than this fraction of the canvas height. */
export const HUD_BOTTOM_MAX_FRACTION = 0.25;

/**
 * Canvas px above the canvas's bottom edge that the bottom chrome covers (0 = nothing to keep clear).
 * `parts[0]` is the quick bar (it decides whether the chrome is docked at the bottom); the rest are visible pieces
 * hanging off it (the match-controls row above it). All rects in client px.
 */
export function hudBottomClearance(canvas: CanvasBoxLike | null, parts: readonly ClientRectLike[]): number {
  const bar = parts[0];
  if (!canvas || !bar || canvas.height <= 0 || canvas.screenHeight <= 0 || bar.width <= 0 || bar.height <= 0) return 0;
  if (bar.bottom < canvas.bottom - HUD_BOTTOM_DOCK_SLACK_PX) return 0; // not docked at the bottom
  if (bar.top >= canvas.bottom) return 0; // entirely below the canvas
  let top = bar.top;
  for (const part of parts.slice(1)) {
    if (part.width > 0 && part.height > 0 && part.bottom > canvas.top && part.top < top) top = part.top;
  }
  const coveredClient = canvas.bottom - top + HUD_BOTTOM_GAP_PX;
  const covered = coveredClient * (canvas.screenHeight / canvas.height); // client px -> canvas px
  return Math.max(0, Math.min(Math.round(covered), Math.round(canvas.screenHeight * HUD_BOTTOM_MAX_FRACTION)));
}
