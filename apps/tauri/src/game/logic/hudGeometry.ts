/** Keep a stock panel's dependent HUD width stable across its active-seat pulse,
 * while owner-customized panels use the exact transformed width they chose. */
export function stableCoachPanelWidth(
  renderedWidth: number,
  renderedScale: number,
  responsiveBaseScale: number,
  customized: boolean,
): number {
  if (customized) return renderedWidth;
  if (!Number.isFinite(renderedScale) || renderedScale <= 0) return renderedWidth;
  if (!Number.isFinite(responsiveBaseScale) || responsiveBaseScale <= 0) return renderedWidth;
  return renderedWidth * responsiveBaseScale / renderedScale;
}
