/**
 * Owner 2026-10-06: the colorblind corrections - ONE source of truth for the client shell (App.vue renders these as SVG
 * <filter>s and applies `filter: url(#cb-<mode>)` on the shell) and the FUMBBL.COM site webview (FumbblHomePane sends
 * the same matrix to the shell, which re-injects it into every page it loads). Daltonization matrices
 * = I + M·(I − S), S = Machado 2009 full-severity simulation.
 */
export type ColorblindMode = 'off' | 'deuteranopia' | 'protanopia' | 'tritanopia';

/** feColorMatrix `values` (4x5, row-major) per correcting mode. */
export const COLORBLIND_MATRICES: Record<Exclude<ColorblindMode, 'off'>, string> = {
  deuteranopia: '1 0 0 0 0  0.163 0.725 0.112 0 0  0.455 -0.645 1.191 0 0  0 0 0 1 0',
  protanopia: '1 0 0 0 0  0.479 0.477 0.044 0 0  0.597 -0.689 1.091 0 0  0 0 0 1 0',
  tritanopia: '0.741 -0.407 0.666 0 0  0.075 0.585 0.340 0 0  0 0 1 0 0  0 0 0 1 0',
};

export const COLORBLIND_FILTER_MODES = Object.keys(COLORBLIND_MATRICES) as Exclude<ColorblindMode, 'off'>[];

/** What a document needs for `mode`: the filter element id and its matrix; null for 'off' / unknown. */
export function colorblindFilter(mode: string): { id: string; matrix: string } | null {
  const matrix = (COLORBLIND_MATRICES as Record<string, string>)[mode];
  return matrix ? { id: `cb-${mode}`, matrix } : null;
}

/** The CSS `filter` value the client applies for a mode (the shell; the walkthrough layer and disclaimer, which live
 *  on <body> outside the shell, apply the same). 'redgreen' (an old stored value) reads as deuteranopia. */
export function colorblindCssFilter(mode: string): string | undefined {
  const m = mode === 'redgreen' ? 'deuteranopia' : mode;
  return colorblindFilter(m) ? `url(#cb-${m})` : undefined;
}
