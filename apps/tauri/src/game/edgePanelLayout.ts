export type HorizontalPanelEdge = 'left' | 'right';
export type VerticalPanelEdge = 'top' | 'bottom';

/** Backward-compatible persisted panel position. x/y retain the last absolute position for v11 clients;
 * edge metadata is authoritative when present so newer clients track viewport changes without rewriting it. */
export type EdgePanelPosition = {
  x: number;
  y: number;
  edgeX?: HorizontalPanelEdge;
  edgeY?: VerticalPanelEdge;
  offsetX?: number;
  offsetY?: number;
};

export type LayoutSize = { width: number; height: number };
export type LayoutRect = { x: number; y: number; width: number; height: number };
export type ScaledPanelLayout = EdgePanelPosition & { scale: number };

const finite = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function clampPanelPositionExact(
  position: { x: number; y: number }, panel: LayoutSize, viewport: LayoutSize,
): { x: number; y: number } {
  const maxX = Math.max(0, finite(viewport.width) - Math.max(0, finite(panel.width)));
  const maxY = Math.max(0, finite(viewport.height) - Math.max(0, finite(panel.height)));
  return {
    x: Math.min(Math.max(0, finite(position.x)), maxX),
    y: Math.min(Math.max(0, finite(position.y)), maxY),
  };
}

export function clampPanelPosition(
  position: { x: number; y: number },
  panel: LayoutSize,
  viewport: LayoutSize,
): { x: number; y: number } {
  const clamped = clampPanelPositionExact(position, panel, viewport);
  return {
    x: Math.round(clamped.x),
    y: Math.round(clamped.y),
  };
}

/** Move a default panel the shortest clamped distance needed to avoid another floating panel.
 * Persisted user positions should bypass this helper: it is only a first-load layout courtesy. */
export function dodgePanelObstacle(
  position: { x: number; y: number }, panel: LayoutSize, obstacle: LayoutRect, viewport: LayoutSize, gap = 10,
): { x: number; y: number } {
  const start = clampPanelPosition(position, panel, viewport);
  const overlaps = (candidate: { x: number; y: number }) => !(
    candidate.x + panel.width <= obstacle.x - gap
    || candidate.x >= obstacle.x + obstacle.width + gap
    || candidate.y + panel.height <= obstacle.y - gap
    || candidate.y >= obstacle.y + obstacle.height + gap
  );
  if (!overlaps(start)) return start;
  const candidates = [
    { x: start.x, y: obstacle.y - panel.height - gap },
    { x: start.x, y: obstacle.y + obstacle.height + gap },
    { x: obstacle.x - panel.width - gap, y: start.y },
    { x: obstacle.x + obstacle.width + gap, y: start.y },
  ].map((candidate) => clampPanelPosition(candidate, panel, viewport));
  const clear = candidates.filter((candidate) => !overlaps(candidate));
  const pool = clear.length > 0 ? clear : candidates;
  return pool.reduce((best, candidate) => {
    const d = (candidate.x - start.x) ** 2 + (candidate.y - start.y) ** 2;
    const bestD = (best.x - start.x) ** 2 + (best.y - start.y) ** 2;
    return d < bestD ? candidate : best;
  });
}

function anchorPanelPositionExact(
  position: { x: number; y: number }, panel: LayoutSize, viewport: LayoutSize,
): EdgePanelPosition {
  const clamped = clampPanelPositionExact(position, panel, viewport);
  const right = Math.max(0, viewport.width - (clamped.x + panel.width));
  const bottom = Math.max(0, viewport.height - (clamped.y + panel.height));
  const edgeX: HorizontalPanelEdge = right < clamped.x ? 'right' : 'left';
  const edgeY: VerticalPanelEdge = bottom < clamped.y ? 'bottom' : 'top';
  return {
    ...clamped,
    edgeX,
    edgeY,
    offsetX: edgeX === 'right' ? right : clamped.x,
    offsetY: edgeY === 'bottom' ? bottom : clamped.y,
  };
}

/** Capture the nearest horizontal and vertical edges at drag end. */
export function anchorPanelPosition(
  position: { x: number; y: number },
  panel: LayoutSize,
  viewport: LayoutSize,
): EdgePanelPosition {
  const clamped = clampPanelPosition(position, panel, viewport);
  const right = Math.max(0, viewport.width - (clamped.x + panel.width));
  const bottom = Math.max(0, viewport.height - (clamped.y + panel.height));
  const edgeX: HorizontalPanelEdge = right < clamped.x ? 'right' : 'left';
  const edgeY: VerticalPanelEdge = bottom < clamped.y ? 'bottom' : 'top';
  return {
    ...clamped,
    edgeX,
    edgeY,
    offsetX: Math.round(edgeX === 'right' ? right : clamped.x),
    offsetY: Math.round(edgeY === 'bottom' ? bottom : clamped.y),
  };
}

export function hasEdgeAnchor(position: EdgePanelPosition): boolean {
  return (position.edgeX === 'left' || position.edgeX === 'right')
    && (position.edgeY === 'top' || position.edgeY === 'bottom')
    && Number.isFinite(position.offsetX) && Number.isFinite(position.offsetY);
}

/** Resolve an anchored position for tests/clamping. Existing v11 x/y-only entries remain readable. */
export function resolvePanelPosition(
  position: EdgePanelPosition,
  panel: LayoutSize,
  viewport: LayoutSize,
): { x: number; y: number } {
  if (!hasEdgeAnchor(position)) return clampPanelPosition(position, panel, viewport);
  const raw = {
    x: position.edgeX === 'right'
      ? viewport.width - panel.width - finite(position.offsetX)
      : finite(position.offsetX),
    y: position.edgeY === 'bottom'
      ? viewport.height - panel.height - finite(position.offsetY)
      : finite(position.offsetY),
  };
  return clampPanelPosition(raw, panel, viewport);
}

/** Clamp an anchored entry after a viewport contraction. A recovery may choose a new nearest
 * edge so the recovered geometry is representable and does not request the same write forever. */
export function clampAnchoredPanelPosition(
  position: EdgePanelPosition,
  panel: LayoutSize,
  viewport: LayoutSize,
): EdgePanelPosition {
  if (!hasEdgeAnchor(position)) return anchorPanelPosition(resolvePanelPosition(position, panel, viewport), panel, viewport);
  const raw = {
    x: position.edgeX === 'right' ? viewport.width - panel.width - finite(position.offsetX) : finite(position.offsetX),
    y: position.edgeY === 'bottom' ? viewport.height - panel.height - finite(position.offsetY) : finite(position.offsetY),
  };
  const projected = clampPanelPosition(raw, panel, viewport);
  // Projection movement is not persistence movement. A valid right/bottom anchor naturally resolves to new
  // absolute x/y as the viewport changes; retain the compatibility x/y bytes and avoid a settings write.
  if (projected.x === Math.round(raw.x) && projected.y === Math.round(raw.y)) return position;
  const recovered = anchorPanelPosition(projected, panel, viewport);
  return {
    ...position,
    ...recovered,
  };
}

/** The production persistence seam used by resize listeners. Referential equality distinguishes a
 * harmless viewport projection from a real migration/recovery and therefore prevents write churn. */
export function persistClampedPanelPosition<T extends EdgePanelPosition>(
  position: T,
  panel: LayoutSize,
  viewport: LayoutSize,
  persist: (next: T) => void,
): T {
  const next = clampAnchoredPanelPosition(position, panel, viewport) as T;
  if (next !== position) persist(next);
  return next;
}

/** CSS edge projection. The browser performs live viewport reflow without a persistence write loop. */
export function edgePanelStyle(position: EdgePanelPosition): Record<string, string> {
  if (!hasEdgeAnchor(position)) {
    return { left: `${finite(position.x)}px`, top: `${finite(position.y)}px`, right: 'auto', bottom: 'auto' };
  }
  return {
    left: position.edgeX === 'left' ? `${Math.max(0, finite(position.offsetX))}px` : 'auto',
    right: position.edgeX === 'right' ? `${Math.max(0, finite(position.offsetX))}px` : 'auto',
    top: position.edgeY === 'top' ? `${Math.max(0, finite(position.offsetY))}px` : 'auto',
    bottom: position.edgeY === 'bottom' ? `${Math.max(0, finite(position.offsetY))}px` : 'auto',
  };
}

/** Custom HUD panels scale from a visible SE handle. While active, pin their live top-left; after release,
 * restore the persisted edge-relative transform origin. */
export function scaledPanelStyle(position: EdgePanelPosition, scale: number, resizing = false): Record<string, string> {
  if (resizing) return {
    left: `${finite(position.x)}px`, top: `${finite(position.y)}px`, right: 'auto', bottom: 'auto',
    transform: `scale(${scale})`, transformOrigin: 'top left',
  };
  return {
    ...edgePanelStyle(position),
    transform: `scale(${scale})`,
    transformOrigin: `${position.edgeX === 'right' ? 'right' : 'left'} ${position.edgeY === 'bottom' ? 'bottom' : 'top'}`,
  };
}

/** Convert horizontal pointer travel into scale so the visible SE edge tracks the pointer exactly.
 *  Owner 09-06: callers pass their own bounds (coach panels floor at 0.5 so a 64 px inducement icon never draws
 *  under 32 px); the defaults are the historical 0.4..2.5. */
export function scaleFromPointerDelta(baseScale: number, renderedWidth: number, deltaX: number, minScale = 0.4, maxScale = 2.5): number {
  const lo = Math.min(minScale, maxScale);
  return Math.max(lo, Math.min(Math.max(lo, maxScale), baseScale + deltaX * baseScale / Math.max(1, renderedWidth)));
}

/** Owner 09-06: HARD BOUNDARY LOCK — the largest scale at which a panel pinned at (x, y) still fits inside the
 *  host (`unscaled` = the panel's size at scale 1). */
export function hostBoundScale(unscaled: LayoutSize, at: { x: number; y: number }, host: LayoutSize): number {
  const w = Math.max(1, unscaled.width);
  const h = Math.max(1, unscaled.height);
  return Math.max(0.05, Math.min((host.width - at.x) / w, (host.height - at.y) / h));
}

/** Read the scale currently painted by CSS, including a coach's active-seat and responsive variants.
 * Capturing the live matrix prevents first-time customization from replacing .864/.9408 etc. with 1. */
export function renderedElementScale(element: HTMLElement): number {
  const transform = getComputedStyle(element).transform;
  const matrix3d = transform.match(/^matrix3d\(([^)]+)\)$/)?.[1]
    ?.split(',').map((part) => Number.parseFloat(part.trim()));
  if (matrix3d && matrix3d.length === 16) {
    const scale = Math.hypot(matrix3d[0] ?? 1, matrix3d[1] ?? 0, matrix3d[2] ?? 0);
    if (Number.isFinite(scale) && scale > 0) return scale;
  }
  const matrix = transform.match(/^matrix\(([^)]+)\)$/)?.[1]
    ?.split(',').map((part) => Number.parseFloat(part.trim()));
  if (matrix && matrix.length >= 2) {
    const scale = Math.hypot(matrix[0] ?? 1, matrix[1] ?? 0);
    if (Number.isFinite(scale) && scale > 0) return scale;
  }
  const direct = Number.parseFloat(transform.match(/scale\(\s*([-+\d.eE]+)/)?.[1] ?? '');
  return Number.isFinite(direct) && direct > 0 ? direct : 1;
}

/** First-customization capture. Position and dimensions are the live rendered rectangle; scale is
 * the live computed CSS scale, so installing the equivalent inline edge layout is pixel-invariant. */
export function captureScaledPanelLayout(panel: HTMLElement, host: HTMLElement): ScaledPanelLayout {
  const rect = panel.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  return {
    ...anchorPanelPositionExact(
      { x: rect.left - hostRect.left, y: rect.top - hostRect.top },
      { width: rect.width, height: rect.height },
      { width: hostRect.width, height: hostRect.height },
    ),
    scale: renderedElementScale(panel),
  };
}

/** Production pointer controller for custom HUD scaling. It pins the rendered top-left while the
 * SE handle is active, applies pointer travel in rendered pixels, then recaptures the final edges. */
export function beginScaledPanelResize(options: {
  event: PointerEvent;
  panel: HTMLElement;
  host: HTMLElement;
  entry: ScaledPanelLayout;
  write(next: ScaledPanelLayout): void;
  setActive(active: boolean): void;
  /** Owner 09-06: per-panel scale floor/ceiling (coach panels: 0.5 = 32 px inducement icons). */
  minScale?: number;
  maxScale?: number;
}): () => void {
  const { event, panel, host } = options;
  const rect = panel.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  let current: ScaledPanelLayout = {
    ...options.entry,
    x: rect.left - hostRect.left,
    y: rect.top - hostRect.top,
  };
  const commit = (next: ScaledPanelLayout) => { current = next; options.write(next); };
  commit(current);
  options.setActive(true);
  const startX = event.clientX;
  const baseScale = current.scale;
  // Owner 09-06: the panel may never grow past the host edge from its pinned top-left (boundary lock).
  const unscaled = { width: rect.width / Math.max(0.01, baseScale), height: rect.height / Math.max(0.01, baseScale) };
  const ceiling = Math.min(options.maxScale ?? 2.5, hostBoundScale(unscaled, { x: current.x, y: current.y }, { width: hostRect.width, height: hostRect.height }));
  const move = (nextEvent: PointerEvent) => commit({
    ...current,
    scale: scaleFromPointerDelta(baseScale, rect.width, nextEvent.clientX - startX, options.minScale ?? 0.4, ceiling),
  });
  const finish = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    const finalRect = panel.getBoundingClientRect();
    const finalHostRect = host.getBoundingClientRect();
    commit({
      ...current,
      ...anchorPanelPositionExact(
        { x: finalRect.left - finalHostRect.left, y: finalRect.top - finalHostRect.top },
        { width: finalRect.width, height: finalRect.height },
        { width: finalHostRect.width, height: finalHostRect.height },
      ),
    });
    options.setActive(false);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', finish);
  return finish;
}

/** Top-left CSS projection for a native SE-resizable panel. During a resize the captured origin
 * wins; on release callers recapture an edge-relative position from the final rectangle. */
export function resizablePanelStyle(
  position: EdgePanelPosition,
  panel: LayoutSize,
  viewport: LayoutSize,
  resizeOrigin: { x: number; y: number } | null = null,
): Record<string, string> {
  const projected = resizeOrigin ?? resolvePanelPosition(position, panel, viewport);
  return { left: `${projected.x}px`, top: `${projected.y}px`, right: 'auto', bottom: 'auto' };
}

/** Complete a pointer interaction exactly once even if WebView cancels capture or
 * the window blurs before pointerup. The returned teardown is silent. */
export function bindPointerCompletion(
  windowTarget: EventTarget,
  captureTarget: EventTarget,
  complete: () => void,
): () => void {
  let active = true;
  const remove = () => {
    windowTarget.removeEventListener('pointerup', finish);
    windowTarget.removeEventListener('pointercancel', finish);
    windowTarget.removeEventListener('blur', finish);
    captureTarget.removeEventListener('lostpointercapture', finish);
  };
  const finish = () => {
    if (!active) return;
    active = false;
    remove();
    complete();
  };
  windowTarget.addEventListener('pointerup', finish);
  windowTarget.addEventListener('pointercancel', finish);
  windowTarget.addEventListener('blur', finish);
  captureTarget.addEventListener('lostpointercapture', finish);
  return () => {
    if (!active) return;
    active = false;
    remove();
  };
}
