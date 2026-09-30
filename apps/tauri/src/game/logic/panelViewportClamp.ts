// Owner 09-28 (Spec S8 follow-up, Sol review of 3a6e0274): the block-dice panel's screen anchor used fixed
// 90 px / 96 px margins (SpectateView.vue's `trackBlockReroll`) that ignore the panel's REAL size — and the S8
// naming change (visible text under icons, wrapping options) made the panel bigger. On an edge or corner
// defender square, especially at the 800x600 minimum window (`src-tauri/tauri.conf.json`), a wider/taller panel
// than the old fixed margins assumed could run off-screen. Pure clamp so the .vue only measures + calls.

export interface PanelSize { width: number; height: number }
export interface ViewportSize { width: number; height: number }
export interface PanelAnchor { x: number; y: number }

/** Clamps an anchor point so a panel — horizontally CENTRED on `x`, top edge at `y` — stays fully inside the
 *  viewport with `margin` px of breathing room on every side. Falls back to pinning the panel against the near
 *  edge (rather than a negative or overflowing position) when the panel itself is wider/taller than the
 *  viewport minus margins — the CSS max-width/max-height + overflow safety net covers that rarer case. */
export function clampPanelAnchor(
  anchor: PanelAnchor,
  panel: PanelSize,
  viewport: ViewportSize,
  margin = 8,
): PanelAnchor {
  const halfW = Math.max(0, panel.width) / 2;
  const minX = Math.min(halfW + margin, viewport.width / 2);
  const maxX = Math.max(viewport.width - halfW - margin, minX);
  const x = Math.min(Math.max(anchor.x, minX), maxX);

  const minY = margin;
  const maxY = Math.max(viewport.height - Math.max(0, panel.height) - margin, minY);
  const y = Math.min(Math.max(anchor.y, minY), maxY);

  return { x, y };
}
