// Modern interface style (owner 11-03, spec-client-restyle-and-team-port-2026-11-03.md, lane 1).
//
// styles/lm-theme.css carries the League Manager's tokens and shared controls under a `.sf-lm` class. A blade opts in
// by putting `.sf-lm` on its own root (use `lmRootClass`), so nothing outside an opted-in blade changes: the in-game
// HUD and Classic keep the client theme engine's `--ui-*` tokens (game/theme.ts).
//
// This module is the app-side glue:
//   - `applyLmRoot` stamps `data-ui-style` and `data-ui-color-scheme` on <html> (teleported dialogs included). On their
//     own they style nothing; lm-theme.css reads the colour scheme from there.
//   - Preset interplay (coordinator ruling 11-03): under Modern the existing colour preset (`uiTheme`) recolours only
//     Modern's two accent tokens, --ui-primary (fills) and --ui-heading (band headings, left edges), plus the text drawn
//     on a primary fill. 'brand-red' IS the League Manager pair (#790004 / #ff3b3b), so it writes nothing and the CSS
//     fallbacks (the League Manager's own values, dark and derived light) apply. 'fumbbl' and 'custom' feed their
//     colours in through `--lm-accent-*` custom properties that lm-theme.css reads with the League Manager value as the
//     fallback. Every other token (surfaces, text, lines, gold, seats) stays the League Manager's. Under Retro nothing
//     is written and the preset behaves exactly as today (applyTheme is untouched).
//   - Heading mapping: the current UI's heading is a fixed red nudged for contrast, not derived from the preset, so there
//     is no preset-to-heading mapping to reuse. A non-default preset therefore uses its PRIMARY for both tokens; the
//     heading copy is lifted toward the scheme's contrast pole (theme.ts nudge idiom) until it reads at 4.5:1 on the
//     League Manager --ui-surface of that scheme, so a dark primary (FUMBBL forest) stays legible as band text.

import { contrastRatio, resolveThemeColors, textOn, type ThemeId } from './theme';

export type UiStyle = 'modern' | 'retro';
export type UiColorScheme = 'dark' | 'light';

/** The custom properties lm-theme.css reads for the preset accents (never a `--ui-*` name: those stay the engine's). */
export const LM_ACCENT_VARS = [
  '--lm-accent-primary',
  '--lm-accent-on-primary',
  '--lm-accent-heading-dark',
  '--lm-accent-heading-light',
] as const;
export type LmAccentVar = (typeof LM_ACCENT_VARS)[number];

/** League Manager surfaces per scheme (lm-theme.css token blocks, de887cb9): --ui-surface and --ui-surface-2. The
 *  preset heading is lifted against --ui-surface (the first), the base under every panel; the League Manager's own
 *  dark heading #ff3b3b is held to the same bar (it reads ~4.3:1 on --ui-surface-2). Kept in step with the CSS by
 *  test/lmTheme.test.ts. */
export const LM_SURFACES: Readonly<Record<UiColorScheme, readonly [string, string]>> = {
  dark: ['#0d0d0d', '#242424'],
  light: ['#d2d2d2', '#dcdcdc'],
};

function parseHex(hex: string): [number, number, number] {
  let h = (hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) h = '000000';
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const ch = (x: number, y: number) => Math.max(0, Math.min(255, Math.round(x + (y - x) * t))).toString(16).padStart(2, '0');
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

/** `colour` stepped toward the scheme's pole (white on dark, black on light) until it reads at 4.5:1 on that scheme's
 *  League Manager --ui-surface. */
export function lmHeadingFor(colour: string, scheme: UiColorScheme): string {
  const pole = scheme === 'dark' ? '#ffffff' : '#000000';
  const surface = LM_SURFACES[scheme][0];
  let heading = mix(colour, colour, 0); // normalised #rrggbb
  for (let i = 0; i < 24 && contrastRatio(heading, surface) < 4.5; i++) heading = mix(heading, pole, 0.15);
  return heading;
}

/** The `--lm-accent-*` values for a style + preset; empty under Retro and for the default Black / Red preset. */
export function lmAccentVars(
  style: UiStyle,
  theme: ThemeId,
  customPrimary: string,
  customSecondary: string,
): Partial<Record<LmAccentVar, string>> {
  if (style !== 'modern' || theme === 'brand-red') return {};
  const { primary } = resolveThemeColors(theme, customPrimary, customSecondary);
  const fill = mix(primary, primary, 0);
  return {
    '--lm-accent-primary': fill,
    '--lm-accent-on-primary': textOn(fill),
    '--lm-accent-heading-dark': lmHeadingFor(fill, 'dark'),
    '--lm-accent-heading-light': lmHeadingFor(fill, 'light'),
  };
}

/** The class a blade puts on its root to opt into the Modern look ('' under Retro). */
export function lmRootClass(style: UiStyle): string {
  return style === 'modern' ? 'sf-lm' : '';
}

export interface LmRootState {
  uiStyle: UiStyle;
  uiColorScheme: UiColorScheme;
  uiTheme: ThemeId;
  uiPrimary: string;
  uiSecondary: string;
}

/** Stamp the style / scheme attributes and the preset accents on <html>. Side effect only; styles nothing by itself. */
export function applyLmRoot(state: LmRootState, root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): void {
  if (!root) return;
  root.dataset.uiStyle = state.uiStyle;
  root.dataset.uiColorScheme = state.uiColorScheme;
  const vars = lmAccentVars(state.uiStyle, state.uiTheme, state.uiPrimary, state.uiSecondary);
  for (const name of LM_ACCENT_VARS) {
    const value = vars[name];
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
}

/** Owner 11-03 (in-game redesign; coordinator ruling B): is the game view in the Modern look? Today it reads its own
 *  setting, `uiGameStyle` (default Retro). Folding it into the interface style later is this one line:
 *  `return settings.uiStyle === 'modern';` */
export function inGameModern(settings: { uiGameStyle: UiStyle; uiStyle: UiStyle }): boolean {
  return settings.uiGameStyle === 'modern';
}

/** The classes that put a game surface in the Modern in-game look: the game view root, and any surface teleported out
 *  of it (popped-out chat, roster window, tooltips) adds them to its own root. Empty under Retro. */
export function lmGameRootClass(settings: { uiGameStyle: UiStyle; uiStyle: UiStyle }): string[] {
  return inGameModern(settings) ? ['sf-lm', 'lm-game'] : [];
}
