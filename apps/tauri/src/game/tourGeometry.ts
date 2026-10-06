/**
 * Owner 2026-10-06: the pure geometry of the walkthrough cards and arrows - shared by the FUMBBL.COM site walkthrough
 * (homeTourGeometry.ts re-exports it; its injected runtime src-tauri/src/home_tour_runtime.js carries a line-for-line copy
 * that test/homeTour.test.ts checks against this module) and the client walkthrough (components/ClientTour.vue).
 * Public-edition code: no pane dependency.
 */

export interface TourRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TourArrow {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** False when the card and the target overlap or are too close for an arrow to read. */
  visible: boolean;
}

/** Space left between the arrow head and the element it points at. */
export const ARROW_GAP = 8;
/** Margin kept between the card and the viewport edge / a target it must not cover. */
export const CARD_MARGIN = 24;

function center(r: TourRect): [number, number] {
  return [r.x + r.width / 2, r.y + r.height / 2];
}

/** Where a ray from the rect's centre towards (tx, ty) leaves the rect. */
function rayExit(r: TourRect, tx: number, ty: number): [number, number] {
  const [cx, cy] = center(r);
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const sx = dx === 0 ? Infinity : r.width / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : r.height / 2 / Math.abs(dy);
  const s = Math.min(sx, sy, 1);
  return [cx + dx * s, cy + dy * s];
}

function overlaps(a: TourRect, b: TourRect, margin: number): boolean {
  return a.x - margin < b.x + b.width && b.x < a.x + a.width + margin && a.y - margin < b.y + b.height && b.y < a.y + a.height + margin;
}

/** An arrow from the card's edge to the target's edge, along the line between their centres. */
export function arrowBetween(card: TourRect, target: TourRect): TourArrow {
  const [tcx, tcy] = center(target);
  const [ccx, ccy] = center(card);
  const [x1, y1] = rayExit(card, tcx, tcy);
  const [ex, ey] = rayExit(target, ccx, ccy);
  const len = Math.hypot(ex - x1, ey - y1);
  if (overlaps(card, target, 0) || len <= ARROW_GAP * 2) {
    return { x1, y1, x2: ex, y2: ey, visible: false };
  }
  const k = (len - ARROW_GAP) / len;
  return { x1, y1, x2: x1 + (ex - x1) * k, y2: y1 + (ey - y1) * k, visible: true };
}

/** Where the card goes: centred, unless that covers a target - then the bottom, then the top, else the least covering
 *  of the three. `corner` (the login step) always sits bottom-right so the site's own form stays free. */
export function placeCard(
  viewport: { width: number; height: number },
  card: { width: number; height: number },
  targets: TourRect[],
  placement: 'center' | 'corner' | 'upper-right',
): { x: number; y: number } {
  const w = Math.min(card.width, Math.max(0, viewport.width - 2 * CARD_MARGIN));
  // A card taller than the window is capped (its copy scrolls inside; the runtime's CSS does the same).
  const h = Math.min(card.height, Math.max(0, viewport.height - 2 * CARD_MARGIN));
  const x = Math.max(CARD_MARGIN, (viewport.width - w) / 2);
  if (placement === 'corner') {
    return { x: Math.max(CARD_MARGIN, viewport.width - w - CARD_MARGIN), y: Math.max(CARD_MARGIN, viewport.height - h - CARD_MARGIN) };
  }
  if (placement === 'upper-right') {
    // Up and to the right of where the centred card sits: right edge at the margin, top a card-height above centre.
    return { x: Math.max(CARD_MARGIN, viewport.width - w - CARD_MARGIN), y: Math.max(CARD_MARGIN, (viewport.height - h) / 2 - h * 0.75) };
  }
  const candidates = [
    Math.max(CARD_MARGIN, (viewport.height - h) / 2),
    Math.max(CARD_MARGIN, viewport.height - h - CARD_MARGIN),
    CARD_MARGIN,
  ];
  let best = candidates[0]!;
  let bestCover = Infinity;
  for (const y of candidates) {
    const rect = { x, y, width: w, height: h };
    let cover = 0;
    for (const t of targets) {
      if (!overlaps(rect, t, CARD_MARGIN / 2)) continue;
      const ox = Math.min(rect.x + rect.width, t.x + t.width) - Math.max(rect.x, t.x);
      const oy = Math.min(rect.y + rect.height, t.y + t.height) - Math.max(rect.y, t.y);
      cover += Math.max(1, ox) * Math.max(1, oy);
    }
    if (cover === 0) return { x, y };
    if (cover < bestCover) {
      bestCover = cover;
      best = y;
    }
  }
  return { x, y: best };
}
