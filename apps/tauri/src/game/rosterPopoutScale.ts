/**
 * Owner 10-02: the Roster pop-out's grow-with-the-window rule. Taller = more rows at the base size until ELEVEN rows
 * are in view; past that the whole content scales so exactly eleven rows fill the list (players 12+ scroll). Wider
 * allows the scale-up too: scale = max(1, min(heightFit, widthFit)).
 */
export const ROSTER_POPOUT_ROWS = 11;

export interface RosterPopoutMetrics {
  /** The frame's inner size, px. */
  frameHeight: number;
  frameWidth: number;
  /** Measured at scale 1: the header bar, the body minus its list (padding + team switch), one row. */
  headH: number;
  chromeH: number;
  rowH: number;
  /** The frame's inner width the base (scale 1) layout was designed at. */
  baseWidth: number;
}

/** Height that shows `rows` rows at scale 1. */
export function rosterPopoutHeightFor(m: Pick<RosterPopoutMetrics, 'headH' | 'chromeH' | 'rowH'>, rows: number): number {
  return m.headH + m.chromeH + rows * m.rowH;
}

export function rosterPopoutScale(m: RosterPopoutMetrics): number {
  const need = rosterPopoutHeightFor(m, ROSTER_POPOUT_ROWS);
  if (!(need > 0) || !(m.baseWidth > 0) || !(m.frameHeight > 0) || !(m.frameWidth > 0)) return 1;
  const fit = Math.min(m.frameHeight / need, m.frameWidth / m.baseWidth);
  return Math.max(1, Math.floor(fit * 100) / 100); // floored: eleven rows never spill a sliver of scrollbar
}
