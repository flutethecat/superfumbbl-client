/** Owner 11-24: "Follow/stay toasts should dodge the casualty pill toasts. Currently, they're overlapping and occluding
 *  the result." The passive "follows up" / "stays" toast is mounted over the acting player's head; when he follows into
 *  the square the injury happened on, that is exactly where the injury pill sits. The result is the thing to read, so
 *  the follow / stay toast moves and the pill never does.
 *
 *  Pure geometry (all rectangles in the same coordinate space, px). Every pill is an obstacle; a pill hanging directly
 *  below its armour dice (`belowDice`) is extended upward by `diceClearance` so the dice above it are part of the
 *  obstacle too. The toast keeps its place when it overlaps nothing. Otherwise the candidates are "just above" and
 *  "just below" every obstacle; the one nearest the head that lies inside the bounds and overlaps NO obstacle wins
 *  (Sol r1: a pass-by-pass push could cycle between two pills and stop on one of them). With no clear candidate the
 *  toast stays where it was, clamped. */
export interface PillRect { left: number; top: number; right: number; bottom: number; belowDice: boolean }
export interface FollowToastBox {
  /** The toast's anchor point (its CSS left / top). */
  x: number; y: number;
  /** Its rendered size. */
  width: number; height: number;
  /** Fraction of the height that sits ABOVE the anchor (the CSS translateY, 0.6 for the head-mounted toast). */
  aboveFraction: number;
}
export const FOLLOW_TOAST_PILL_GAP_PX = 4;

interface Span { left: number; top: number; right: number; bottom: number }
function toastRect(box: FollowToastBox, y: number): Span {
  return {
    left: box.x - box.width / 2, right: box.x + box.width / 2,
    top: y - box.height * box.aboveFraction, bottom: y + box.height * (1 - box.aboveFraction),
  };
}
const overlaps = (a: Span, b: Span): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** How much farther the side the toast is already on may be than the other side and still be kept (px). */
export const FOLLOW_TOAST_SIDE_STICK_PX = 48;

/** The anchor y the toast should use so it overlaps no injury pill (nor the armour dice over a below-dice pill);
 *  `box.y` (clamped) when nothing is in the way or no clear spot exists. `diceClearance` = the height of the armour
 *  dice stack above a below-dice pill, in the same px space. `previousY` = what this returned last frame for the same
 *  toast (null on its first frame): while the two sides are nearly tied the toast stays on the side it is on, so a
 *  pill growing by half a pixel during its entrance cannot throw it across (Sol r2). */
export function followToastDodgeY(
  box: FollowToastBox, pills: readonly PillRect[], bounds: { minY: number; maxY: number }, diceClearance = 0,
  previousY: number | null = null,
): number {
  const base = Math.min(Math.max(box.y, bounds.minY), bounds.maxY);
  if (!(box.width > 0) || !(box.height > 0) || pills.length === 0) return base;
  const obstacles: Span[] = pills.map((pill) => ({
    left: pill.left, right: pill.right, bottom: pill.bottom, top: pill.belowDice ? pill.top - Math.max(0, diceClearance) : pill.top,
  }));
  const clearAt = (y: number): boolean => { const r = toastRect(box, y); return !obstacles.some((o) => overlaps(r, o)); };
  if (clearAt(base)) return base;
  const above = box.height * (1 - box.aboveFraction); // anchor-to-bottom distance
  const below = box.height * box.aboveFraction; // anchor-to-top distance
  // The preferred gap first; a slot too tight for the gap is still better than sitting on a pill (Sol r2).
  for (const gap of [FOLLOW_TOAST_PILL_GAP_PX, 0]) {
    let up: number | null = null; // nearest clear candidate above the head position
    let down: number | null = null; // nearest clear candidate below it
    for (const o of obstacles) {
      for (const y of [o.top - gap - above, o.bottom + gap + below]) {
        if (y < bounds.minY || y > bounds.maxY || !clearAt(y)) continue;
        if (y <= base) { if (up === null || base - y < base - up) up = y; } else if (down === null || y - base < down - base) down = y;
      }
    }
    if (up === null && down === null) continue;
    if (up === null) return down!;
    if (down === null) return up;
    const upDist = base - up;
    const downDist = down - base;
    if (previousY !== null && previousY !== base) {
      const wasUp = previousY < base;
      if (wasUp && upDist <= downDist + FOLLOW_TOAST_SIDE_STICK_PX) return up;
      if (!wasUp && downDist <= upDist + FOLLOW_TOAST_SIDE_STICK_PX) return down;
    }
    return upDist <= downDist ? up : down;
  }
  return base;
}
