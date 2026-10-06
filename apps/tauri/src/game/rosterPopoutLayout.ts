/**
 * Owner 10-06: the roster pop-out opens at the lower LEFT of the pitch area (its left edge 88 px in, its bottom edge
 * 130 px above the bottom of the pitch host - clear of the bottom bars). Pure so the component and the tests share it.
 * Coordinates are relative to the pitch host's top-left; the caller adds the host's viewport origin.
 */
export const ROSTER_DEFAULT_LEFT = 88;
export const ROSTER_DEFAULT_BOTTOM_GAP = 130;
export const ROSTER_DEFAULT_MIN_TOP = 80;

export function defaultRosterPosition(o: { hostWidth: number; hostHeight: number; panelWidth: number; panelHeight: number }): { x: number; y: number } {
  const maxX = Math.max(0, o.hostWidth - o.panelWidth);
  const maxY = Math.max(0, o.hostHeight - o.panelHeight);
  const x = Math.min(ROSTER_DEFAULT_LEFT, maxX);
  const y = Math.min(Math.max(ROSTER_DEFAULT_MIN_TOP, o.hostHeight - o.panelHeight - ROSTER_DEFAULT_BOTTOM_GAP), maxY);
  return { x: Math.max(0, x), y: Math.max(0, y) };
}
