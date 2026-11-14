/**
 * Owner 11-12: the Sprites and Skill display buttons left the in-game quick bar (SpectateView). The default log width
 * (no saved logSize) was the bar's width WITH them, so it is measured as if they were still there: the in-flow content
 * plus the two retired buttons (each as wide as the Tackle zones button, 43.2 px by default) and their gaps, never below
 * the bar's own min-width (the coach-panel match). A coach who never used either button keeps the log width they had.
 * Only this SIZE is pinned: what docks beside the bar (the minimized log, the player card, the telestrator toolbar)
 * follows the bar's real edges.
 */
export const RETIRED_QUICK_BUTTONS = 2;

export function quickBarWidthWithRetiredButtons(bar: HTMLElement): number {
  const style = getComputedStyle(bar);
  const sample = bar.querySelector<HTMLElement>('[data-quick-tip="tackleZones"]');
  // the CSS width (43.2 px), not the rounded offsetWidth
  const buttonW = (sample && parseFloat(getComputedStyle(sample).width)) || sample?.offsetWidth || 43.2;
  const retiredW = RETIRED_QUICK_BUTTONS * (buttonW + (parseFloat(style.columnGap) || 2.4));
  const inFlow = Array.from(bar.children).filter((c): c is HTMLElement => c instanceof HTMLElement && getComputedStyle(c).position !== 'absolute');
  if (!inFlow.length) return bar.offsetWidth + retiredW;
  const left = Math.min(...inFlow.map((c) => c.offsetLeft));
  const right = Math.max(...inFlow.map((c) => c.offsetLeft + c.offsetWidth));
  const chrome = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0) + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
  const content = right - left + chrome;
  return Math.max(parseFloat(style.minWidth) || 0, content + retiredW);
}
