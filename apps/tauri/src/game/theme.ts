// Theme engine (owner-commissioned 2026-07-14; spec docs/artifact-orchestration/black-red-ui-scheme.md).
// A user picks two colours (Primary + Secondary) in Settings → Accessibility; deriveTheme() computes the full
// `--ui-*` token set from them, with the TEXT tokens auto-chosen by WCAG luminance so even a low-contrast pick
// still yields legible text. Presets are just predefined (Primary, Secondary) pairs. The status semantics
// (danger/success/info) are FIXED — theme-INDEPENDENT — so a casualty toast never collapses into the accent.
//
// deriveTheme is PURE (returns the token record) so Echo's headless WCAG guard can assert on it without a DOM;
// applyTheme() is the app-side side-effect that writes the record onto :root.

export type ThemeId = 'brand-red' | 'fumbbl' | 'custom';

export type ThemeTokenName =
  | '--ui-primary' | '--ui-secondary' | '--ui-surface' | '--ui-surface-2' | '--ui-accent'
  | '--ui-hover' | '--ui-active' | '--ui-border' | '--ui-text-on-primary' | '--ui-text-on-secondary' | '--ui-text-on-accent'
  | '--ui-text' | '--ui-muted' | '--ui-text-dim' | '--ui-heading' | '--ui-focus' | '--ui-focus-halo'
  | '--ui-danger' | '--ui-success' | '--ui-info'
  | ConsoleTokenName;

// Console-UI redesign palette (owner program 2026-08-04; handoff design_handoff_super_fumbbl_console_ui). These
// are FIXED brand design constants (theme-INDEPENDENT, like SEMANTIC) — the handoff's literal hexes get a token
// here so components reference `--ui-*`, NEVER a hardcoded hex (Claude-Design mandate; Kallus grep-gates
// `#[0-9a-f]{6}` in new view code against this map). Tuned for the Black/Red console surface; a future light-theme
// pass may adapt the cream/skill set (flagged in console-ui-token-map.md). Skill-category colours are the fixed
// FUMBBL legend; gold = SL-budget/stamps; eggshell/old-lace = cream accents; forest = pitch/success surface;
// tier badges T1-T4 (blue/green/gold/dark-red).
export type ConsoleTokenName =
  | '--ui-skill-general' | '--ui-skill-agility' | '--ui-skill-strength' | '--ui-skill-passing'
  | '--ui-skill-mutation' | '--ui-skill-trait'
  | '--ui-gold' | '--ui-gold-bright' | '--ui-eggshell' | '--ui-old-lace' | '--ui-forest'
  | '--ui-tier-1' | '--ui-tier-2' | '--ui-tier-3' | '--ui-tier-4';
export const CONSOLE_PALETTE: Readonly<Record<ConsoleTokenName, string>> = {
  '--ui-skill-general': '#6ea8ff',
  '--ui-skill-agility': '#ffd23d',
  '--ui-skill-strength': '#ff6b6b',
  '--ui-skill-passing': '#ffffff',   // Devious/Passing
  '--ui-skill-mutation': '#6fcf6f',
  '--ui-skill-trait': '#b08b5a',
  '--ui-gold': '#e8a33d',
  '--ui-gold-bright': '#ffd23d',
  '--ui-eggshell': '#E7DDC7',
  '--ui-old-lace': '#F8F5E7',
  '--ui-forest': '#1A401C',
  '--ui-tier-1': '#12459c',   // T1 blue (info family)
  '--ui-tier-2': '#3fb463',   // T2 green (success family)
  '--ui-tier-3': '#e8a33d',   // T3 gold
  '--ui-tier-4': '#5a0004',   // T4 dark red (panel-border family)
};
export type ThemeTokens = Record<ThemeTokenName, string>;

// ---- colour maths (WCAG) ----------------------------------------------------------------------
function clamp255(n: number): number { return Math.max(0, Math.min(255, Math.round(n))); }
function parseHex(hex: string): [number, number, number] {
  let h = (hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) h = '000000';
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a); const [br, bg, bb] = parseHex(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}
/** WCAG relative luminance (0..1). */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio between two hex colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
/** Black or white — whichever reads more legibly on `bg` (WCAG contrast). The accessibility contract: a
 *  user's colour pick can never yield unreadable text because the text token is chosen for max contrast. */
export function textOn(bg: string): string {
  // Dark option = PURE black #000000 (not #111111): closes Echo audit gap #1 — the mid-grey trap #767676 capped
  // at 4.478 (<4.5 AA) with #111111; #000000 lifts it to ~4.6, so every pick clears WCAG 1.4.3.
  return contrastRatio('#ffffff', bg) >= contrastRatio('#000000', bg) ? '#ffffff' : '#000000';
}

// ---- FIXED semantic status tokens (theme-INDEPENDENT — do NOT derive from Primary/Secondary) ---
// --ui-danger is a BRIGHT alert red, perceptibly distinct from Carmine #790004 so under Black/Red it never
// blurs into the accent (Yularen ruling; Echo's guard asserts danger != primary distinguishability).
export const SEMANTIC: Readonly<Record<'--ui-danger' | '--ui-success' | '--ui-info', string>> = {
  '--ui-danger': '#ff4d4d',
  '--ui-success': '#3fb463',
  '--ui-info': '#4a86c8',
};

// ---- the derive fn (PURE — returns the record; Echo's headless guard asserts on this) ----------
export function deriveTheme(primary: string, secondary: string): ThemeTokens {
  // Secondary is the base "canvas"; surfaces step off it toward/away from black by its darkness. Primary is
  // the accent. All neutral roles derive; only the two text tokens flip by WCAG contrast.
  const darkBase = luminance(secondary) < 0.4;
  const surface = darkBase ? mix(secondary, '#ffffff', 0.05) : mix(secondary, '#000000', 0.05);
  const surface2 = darkBase ? mix(secondary, '#ffffff', 0.14) : mix(secondary, '#000000', 0.11);
  const border = mix(primary, secondary, 0.5);          // a dark accent border
  const hover = mix(surface, primary, 0.22);            // primary-tinted hover surface
  const active = primary;                               // active element background = primary
  // --ui-accent — the highlight/POP role (stars, active states, selection). Starts at primary but LIFTS its
  // luminance toward the surface's bright pole until it clears WCAG 1.4.11 3:1 vs surface, so accents pop on ANY
  // theme — Black/Red's dark carmine primary is ~1.4:1 vs the near-black surface (invisible); FUMBBL's light
  // surface already pops so this no-ops. Same nudge idiom as focus/heading/danger; stays red-family (brand).
  // Yularen ruling 2026-07-14: accent ≠ primary (primary = surfaces/buttons; accent = the brighter pop role).
  const accentPole = luminance(surface) < 0.5 ? '#ffffff' : '#000000';
  let accent = primary;
  // Iteration cap raised 8→16 so the lift also clears 3:1 on an equiluminant mid-grey surface (Echo: capped at
  // ~2.85-2.89 with 8 iters). Preset values are UNCHANGED — the loop exits at the first ≥3 value, which the presets
  // hit early (brand-red #a55456, fumbbl no-op); only the awful equiluminant mid-grey pick uses the extra iters.
  for (let i = 0; i < 16 && contrastRatio(accent, surface) < 3; i++) accent = mix(accent, accentPole, 0.18);
  const text = darkBase ? '#e6e9ef' : '#141414';
  const muted = mix(text, surface, 0.45);
  const textDim = mix(text, surface, 0.62);            // disabled-control text (dimmer than muted)
  // Focus ring — RED per the owner's ruling (07-14; supersedes Tarkin's shipped BLUE #7ab8ff/#12459c). Drawn as
  // the OUTER ring against --ui-surface. Seed a bright red on dark bases / a deep red on light ones, then NUDGE it
  // toward the higher-contrast pole (white on a dark surface, black on a light/mid one) until it clears WCAG
  // 1.4.11 3:1 vs the surface — same idiom as the danger collision-nudge below. This closes Echo's 3 residual
  // mid-grey `focus-vs-surface` gaps (a bright red on a mid-grey surface was ~1.0-1.15): a mid/light surface
  // darkens the red toward maroon until it separates; a dark surface leaves the bright red untouched. Stays a
  // red-derived ring on every pick. (The vs-BUTTON-fill leg — a red ring can't beat a red/green button — is still
  // carried by --ui-focus-halo, the inner layer.) ⚠ Echo touched this per an owner directive (2026-07-14) — the
  // maroon shade on mid/light surfaces is a contrast pick, flagged to Fives for visual sign-off.
  const focusSeed = darkBase ? '#ff3b3b' : '#8b1a1a';
  const focusPole = luminance(surface) < 0.2 ? '#ffffff' : '#000000';
  let focus = focusSeed;
  for (let i = 0; i < 6 && contrastRatio(focus, surface) < 3; i++) focus = mix(focus, focusPole, 0.2);
  // Focus HALO — the INNER layer of a dual-ring focus indicator (the layer that touches the BUTTON fill). A red
  // ring alone can't clear 3:1 vs a red/green button, so the apply CSS draws this halo hugging the control +
  // --ui-focus (red) outside it against the surface. The halo flips by PRIMARY (button) luminance — white on a
  // dark button, black on a light one — so it clears 3:1 vs the fill on ANY theme (both presets have DARK
  // buttons → white). --ui-focus (surface-flipped red) covers the outer edge. Echo asserts the ring+halo
  // COMPOSITE; SpectateView + App.vue reference both tokens identically.
  const focusHalo = luminance(primary) < 0.5 ? '#ffffff' : '#000000';
  // gap-#3 (Yularen ruling): --ui-danger stays FIXED, but a user's near-red custom PRIMARY can blur into it
  // (danger-collision: primary #ff4d4d vs the fixed danger #ff4d4d = 1:1). Nudge danger DARKER until it
  // re-separates from primary (Echo's guard asserts danger-vs-primary ≥ 1.6; margin to 1.7). Fires ONLY on a
  // genuine collision — the presets and any non-red primary leave danger untouched.
  let danger = SEMANTIC['--ui-danger'];
  for (let i = 0; i < 5 && contrastRatio(danger, primary) < 1.7; i++) danger = mix(danger, '#000000', 0.3);
  // --ui-heading — section-header TEXT = fixed bright red #ff3b3b (owner ruling; Tarkin landed it inline in
  // App.vue, now centralised as a token). Theme-independent like the semantics, BUT as text it must clear WCAG
  // 4.5:1 vs the surface it sits on — bright #ff3b3b fails on the FUMBBL light eggshell (~2.35) — so darken it
  // toward the surface's contrast pole until it clears 4.5 (same idiom as the focus nudge, stricter TEXT
  // threshold). Black/Red keeps the bright red untouched (clears ~5.3 on its near-black surface).
  let heading = '#ff3b3b';
  const headingPole = luminance(surface) < 0.5 ? '#ffffff' : '#000000';
  for (let i = 0; i < 8 && contrastRatio(heading, surface) < 4.5; i++) heading = mix(heading, headingPole, 0.2);
  // Fallback (Yularen ruling 07-14): on an equiluminant MID-GREY surface no red can clear 4.5:1 as text (the
  // nudge caps out red-hued), so legibility outranks the brand red — fall back to textOn (pure black/white, always
  // ≥4.58:1). Fires ONLY on deliberately-awful mid-grey picks; presets + every realistic theme keep the red
  // (they clear 4.5 above, so this is skipped). Same law as the whole engine: a user can never produce unreadable text.
  if (contrastRatio(heading, surface) < 4.5) heading = textOn(surface);
  return {
    '--ui-primary': primary,
    '--ui-secondary': secondary,
    '--ui-surface': surface,
    '--ui-surface-2': surface2,
    '--ui-accent': accent,
    '--ui-text-on-accent': textOn(accent),
    '--ui-hover': hover,
    '--ui-active': active,
    '--ui-border': border,
    '--ui-text-on-primary': textOn(primary),
    '--ui-text-on-secondary': textOn(secondary),
    '--ui-text': text,
    '--ui-muted': muted,
    '--ui-text-dim': textDim,
    '--ui-heading': heading,
    '--ui-focus': focus,
    '--ui-focus-halo': focusHalo,
    ...SEMANTIC,
    '--ui-danger': danger, // gap-#3 nudge overrides the fixed SEMANTIC danger on a primary collision
    ...CONSOLE_PALETTE, // fixed console-UI brand constants (theme-independent; see console-ui-token-map.md)
  };
}

// ---- presets (values cited from docs/super-fumbbl-brand-palette.md) ----------------------------
// Black/Red = Carmine / Black (the commissioned headline). FUMBBL = Forest / Eggshell (the classic FUMBBL
// light look: forest-green accents on eggshell, per the brand palette). Custom = the user's two fields.
export const THEME_PRESETS: Record<Exclude<ThemeId, 'custom'>, { primary: string; secondary: string; label: string }> = {
  'brand-red': { primary: '#790004', secondary: '#000000', label: 'Black / Red' },
  'fumbbl': { primary: '#1A401C', secondary: '#E7DDC7', label: 'FUMBBL' },
};

/** Effective (primary, secondary) for a theme choice — presets resolve to their pair; custom uses the fields. */
export function resolveThemeColors(theme: ThemeId, customPrimary: string, customSecondary: string): { primary: string; secondary: string } {
  if (theme === 'custom') return { primary: customPrimary || '#790004', secondary: customSecondary || '#000000' };
  return THEME_PRESETS[theme];
}

/** Write the derived token set onto :root. The pure deriveTheme stays DOM-free; this is the app side-effect. */
export function applyTheme(theme: ThemeId, customPrimary: string, customSecondary: string): void {
  if (typeof document === 'undefined') return;
  const { primary, secondary } = resolveThemeColors(theme, customPrimary, customSecondary);
  const tokens = deriveTheme(primary, secondary);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
}
