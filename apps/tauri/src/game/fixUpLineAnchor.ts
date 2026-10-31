import { watch } from 'vue';
/** Owner 10-30 ("Regen splash is appearing at the center of the pitch rather than at the square where the casualty
 *  occurred"): the board-overlay point a Regeneration line is drawn at - where its player's casualty pill sat, by the
 *  pill's own rule (SpectateView koToastPositions): directly below his armour dice when the pill rode them
 *  (renderer.armourPillAnchor on the dice's square), else 58 px above the pill's resolved square
 *  (renderer.screenPosOf). Null = the centred fix-up rail (apothecary lines, no square, off-screen). */
export const FIX_UP_LINE_ABOVE_SQUARE_PX = 58;
export interface FixUpLineAnchorRenderer {
  armourPillAnchor(square: [number, number]): { x: number; y: number } | null;
  screenPosOf(square: [number, number]): { x: number; y: number } | null;
}
export interface FixUpLineAnchorSource {
  kind: 'apothecary' | 'regeneration';
  square: [number, number] | null;
  armourSquare: [number, number] | null;
  seq: number;
}
export function fixUpLineAnchor(renderer: FixUpLineAnchorRenderer, line: Omit<FixUpLineAnchorSource, 'seq'> | null): { x: number; y: number } | null {
  if (!line || line.kind !== 'regeneration' || !line.square) return null;
  const under = line.armourSquare ? renderer.armourPillAnchor(line.armourSquare) : null;
  if (under) return { x: under.x, y: under.y };
  const p = renderer.screenPosOf(line.square);
  return p ? { x: p.x, y: p.y - FIX_UP_LINE_ABOVE_SQUARE_PX } : null;
}
/** The view's follow for one line: re-reads the anchor every animation frame (pan / zoom) and ends - writing null -
 *  as soon as the line clears or another replaces it, or the renderer goes. Returns the cancel. No timers. */
export function followFixUpLine(
  line: FixUpLineAnchorSource | null,
  current: () => FixUpLineAnchorSource | null,
  renderer: () => FixUpLineAnchorRenderer | null,
  write: (anchor: { x: number; y: number } | null) => void,
  raf: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
  caf: (id: number) => void = (id) => cancelAnimationFrame(id),
): () => void {
  let frame = 0;
  write(null);
  if (!line || line.kind !== 'regeneration' || !line.square || !renderer()) return () => undefined;
  const seq = line.seq;
  const step = () => {
    const now = current();
    const r = renderer();
    if (!now || now.seq !== seq || !r) { frame = 0; write(null); return; }
    write(fixUpLineAnchor(r, now));
    frame = raf(step);
  };
  step();
  return () => { if (frame) caf(frame); frame = 0; };
}
/** Sol r2 P2-1: the view's binding - (re)starts the follow whenever the line OR the renderer's readiness changes, and
 *  at once for a line already up when the view mounts (Classic -> Modern mid-hold; a line that came before the
 *  renderer). Each restart cancels the previous follow. `cancel` ends the current follow (presentation reset). */
export function watchFixUpLine(
  line: () => FixUpLineAnchorSource | null,
  rendererReady: () => unknown,
  renderer: () => FixUpLineAnchorRenderer | null,
  write: (anchor: { x: number; y: number } | null) => void,
  raf?: (cb: () => void) => number,
  caf?: (id: number) => void,
): { cancel: () => void; stop: () => void } {
  let cancelFollow: () => void = () => undefined;
  const stop = watch([line, rendererReady], ([current]) => {
    cancelFollow();
    cancelFollow = followFixUpLine(current, line, renderer, write, raf, caf);
  }, { immediate: true });
  return { cancel: () => { cancelFollow(); cancelFollow = () => undefined; }, stop: () => { stop(); cancelFollow(); } };
}
