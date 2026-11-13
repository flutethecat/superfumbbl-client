import { DISPLAY_CAPS_LEAD_SCALE, displayCapsRuns, displayGraphemes, type DisplayCapsRun } from './displayCaps';
import { FALLBACK_FONT_FACES, FONT_DISPLAY_FAMILY, FONT_FALLBACK_FAMILY, FONT_GRADUATE_FAMILY, FONT_SNES_FAMILY } from './fontStacks';

/**
 * Pitch lettering in the "Graduate C" style (owner 10-11): each word's first letter in Nuffle, 25% larger, the rest
 * in Graduate small capitals, whatever case the text was typed in (displayCaps.ts holds the casing rules). One
 * compositor for every pitch surface that carries it: the end zones, the dugout box labels and the apothecary
 * caption; a surface is a `DisplayLetteringStyle` (size, lead size, weight, letter spacing, colour, outline).
 *
 * Owner 10-11 (ruling on the small-cap "S" reading as an "8"): on the PITCH the Graduate letters are drawn 15% larger
 * and without an outline, the Nuffle lead letter unchanged, so the lead is 1.25 / 1.15 = about 1.09 times the rest
 * (PITCH_LEAD_SCALE). The Esc Game Menu keeps the 1.25 lead (DISPLAY_CAPS_LEAD_SCALE, DisplayCaps.vue).
 *
 * A Pixi `Text` holds ONE font family, so the two-font word is drawn once to a 2D canvas (every run on one common
 * alphabetic baseline) and the renderer wraps that canvas in a texture: 4x raster, linear filtering and mipmaps, the
 * same quality rule the old single `Text` objects used (owner 09-14 / 09-16). The renderer keeps the texture per
 * surface and label, so a redraw does not rasterise again.
 *
 * Characters neither font carries fall to the rest of the font stack (fontStacks.ts: the Cyrillic / Greek system
 * faces, then the CJK faces), per glyph, by the browser: nothing to throw.
 *
 * Script support (owner 10-23): a word whose first letter is not Latin, Greek or Cyrillic (displayCaps.ts rule 7) is
 * drawn WHOLE in the fallback face (FONT_FALLBACK_FAMILY), sized so a full-width reference glyph (U+53E3) stands as
 * tall as the lead capitals, and centred on the capitals' middle: a mixed name shares one centre line, and its Latin
 * baseline is exactly where an all-Latin label puts it.
 */

/** The rest of each word: Graduate (its lowercase glyphs are small capitals), then Nuffle and the script tail. */
export const DISPLAY_REST_FONT_FAMILY = FONT_GRADUATE_FAMILY;
/** The lead letter of each word: the display font these labels always used, then the script tail. */
export const DISPLAY_LEAD_FONT_FAMILY = FONT_DISPLAY_FAMILY;
/** A fallback word (kana, kanji, Hangul...): the script tail alone. */
export const DISPLAY_FALLBACK_FONT_FAMILY = FONT_FALLBACK_FAMILY;
/** The full-width glyph a fallback word is sized and centred by: its ink box is an ideograph's em box, near enough. */
export const FALLBACK_REFERENCE_GLYPH = '\u53e3';
/** The fallback face's size stays within this share of the lead size, whatever a measurement returns. */
const FALLBACK_SIZE_RANGE = [0.6, 1.5] as const;

/** What one surface's lettering looks like. Sizes are logical px: the unit the old `Text` style used. */
export interface DisplayLetteringStyle {
  /** Size of the rest of each word. */
  fontPx: number;
  /** How much larger than `fontPx` the lead letter is drawn. */
  leadScale: number;
  /** CSS font weight for both faces. Each face ships ONE regular weight: 600+ is synthesised faux bold, which smears
   *  the glyphs; 'normal' is the real weight. */
  fontWeight: string;
  /** Per-face overrides of `fontWeight` (default: `fontWeight`): the Nuffle lead letter and the Graduate rest. */
  leadWeight?: string;
  restWeight?: string;
  /** Extra advance after every character. */
  letterSpacing: number;
  /** CSS colour of the letters. */
  fill: string;
  /** Graduate ships one (regular) weight and its small capitals are lighter than Nuffle's heavy caps: the rest of
   *  each word can be given a thin same-colour outline of this width so the two faces read as one weight. 0 = none
   *  (owner 10-11: none on the pitch - the outline closed up the small "S"). */
  restOutline: number;
  /** The fit box's height is the lead letter's cap height divided by this, i.e. the big capitals fill this share. */
  capFill: number;
  /** Raster scale of the canvas (the old `Text` objects used `resolution: 4`). */
  resolution: number;
  /** Owner 11-11: 'snes' draws the whole label in SNES Italic capitals (the wordmark face) instead of Graduate C. The
   *  caller decides per label with `snesCovers`; this compositor does not fall back on its own. */
  face?: 'graduate-c' | 'snes';
}

/** Owner 10-11: on the pitch the Graduate letters are 15% larger than in the first cut, the Nuffle lead unchanged. */
export const PITCH_REST_GROWTH = 1.15;
export const PITCH_LEAD_SCALE = DISPLAY_CAPS_LEAD_SCALE / PITCH_REST_GROWTH;

/** End zones (owner 10-13: weight reduced slightly: the Nuffle lead stays bold, the Graduate rest is its real regular
 *  weight instead of a faux bold). B2-16/UI11 + owner 09-16: heavy, bold WHITE at full alpha; sized at render time to span the end-zone
 *  length. The lead is 35 px (as approved), the rest 28 * 1.15 = 32.2 px. The old all-Nuffle capitals filled 0.69 of
 *  their line box (cap 25 of a 36 line at 28 px); the lead is taken higher (0.88, and the renderer gives the box 85%
 *  of the band). */
export const ENDZONE_LETTERING: DisplayLetteringStyle = {
  fontPx: 28 * PITCH_REST_GROWTH, leadScale: PITCH_LEAD_SCALE, fontWeight: 'bold', restWeight: 'normal', letterSpacing: 6, fill: '#ffffff', restOutline: 0, capFill: 0.88, resolution: 4,
};
/** Owner 11-11: the end-zone lettering is drawn slightly see-through so it reads as PAINTED on the grass (the turf
 *  texture shows through the white) rather than laid on top of it. The letters keep their weight (no bolder face);
 *  the alpha applies to the whole composed label, so overlapping glyph edges never double up. */
export const ENDZONE_LETTERING_ALPHA = 0.8;
/** Owner 11-11: the end-zone lettering in SNES Italic, the "Super FUMBBL" wordmark face, for a label the font fully
 *  draws (`snesCovers`). The face has one weight and only capitals (its lowercase code points carry the capital
 *  glyphs), so the label is drawn upper case, the wordmark's own look (lm-blades.css: text-transform uppercase). Its
 *  capitals stand 0.70 em, so 40 px puts them near the Graduate C lead capitals (35 px Nuffle); the renderer fits the
 *  label to the band either way. */
export const ENDZONE_SNES_LETTERING: DisplayLetteringStyle = {
  fontPx: 40, leadScale: 1, fontWeight: 'normal', letterSpacing: 3, fill: '#ffffff', restOutline: 0, capFill: 0.88, resolution: 4, face: 'snes',
};

/** Every character SNES-Italic.ttf (apps/tauri/public/fonts) draws with ink, read from its own cmap + glyf (11-11): the
 *  space, ! ' , . ?, the digits and A-Z / a-z (identical capital glyphs). Its cmap also maps the rest of Latin-1 (every
 *  accented letter), the hyphen, & : / ( ) and the typographic quotes, but to EMPTY glyphs: a "covered" code point
 *  there draws a blank, which is why the cmap alone is no test (lm-theme.css limits its "SF Band Italic" alias to the
 *  same set). */
export const SNES_INKED_CHARACTERS = " !',.0123456789?ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SNES_INKED = new Set(SNES_INKED_CHARACTERS);
/** True when SNES Italic draws EVERY character of `label` (and it has at least one letter or digit). A name with even
 *  one character outside the set (an accent, a hyphen, a non-Latin letter) is drawn whole in Graduate C instead:
 *  never two faces inside one name. */
export function snesCovers(label: string): boolean {
  const text = label.trim();
  if (!/[0-9A-Za-z]/.test(text)) return false;
  for (const ch of text) if (!SNES_INKED.has(ch)) return false;
  return true;
}

/** Where the SNES face stands: 'loaded', 'pending' (registered, not loaded yet), 'error', 'absent' (not registered:
 *  main.ts registers it only once loaded, so absent at draw time normally means its load failed) or 'unsupported'
 *  (no Font Loading API). Only 'loaded' letters an end zone in SNES. */
export function snesFontState(): 'loaded' | 'pending' | 'error' | 'absent' | 'unsupported' {
  try {
    if (typeof document === 'undefined' || !document.fonts?.forEach) return 'unsupported';
    const own: FontFace[] = [];
    (document.fonts as unknown as FontFaceSetLike).forEach((face) => { if (familyOf(face) === 'SNES') own.push(face); });
    if (own.some((face) => face.status === 'loaded')) return 'loaded';
    if (own.some((face) => face.status === 'unloaded' || face.status === 'loading')) return 'pending';
    return own.length ? 'error' : 'absent';
  } catch {
    return 'unsupported';
  }
}

/** Start loading a registered SNES face that has not loaded yet. Resolves when it settles; never rejects. */
export async function loadSnesFont(): Promise<void> {
  try {
    if (typeof document === 'undefined' || !document.fonts?.forEach) return;
    const pending: FontFace[] = [];
    (document.fonts as unknown as FontFaceSetLike).forEach((face) => {
      if (familyOf(face) === 'SNES' && (face.status === 'unloaded' || face.status === 'loading')) pending.push(face);
    });
    await Promise.all(pending.map((face) => face.load().catch(() => undefined)));
  } catch {
    /* the end zones keep Graduate C */
  }
}

/** Dugout box labels (INJURED / RESERVES) and the APOTHECARY caption. Owner 2026-07-02: bold white, no dark outline;
 *  they were 11 px Nuffle bold with 2 px tracking (capitals 9.8 px tall). The lead is 17.5 px, the rest
 *  14 * 1.15 = 16.1 px, so the Graduate small capitals stand a little taller than those old capitals; the renderer
 *  then holds the label inside its band (length and thickness). */
export const DUGOUT_LETTERING: DisplayLetteringStyle = {
  fontPx: 14 * PITCH_REST_GROWTH, leadScale: PITCH_LEAD_SCALE, fontWeight: 'bold', letterSpacing: 2, fill: '#ffffff', restOutline: 0, capFill: 0.9, resolution: 4,
};

/** The CSS font shorthands a style is drawn with. `fallback(px)` is the fallback face at `px` (default: the lead
 *  size; the compositor sizes it from a measurement), in the lead's weight. */
export function displayLetteringFonts(style: DisplayLetteringStyle): { rest: string; lead: string; fallback: (px?: number) => string } {
  const leadPx = style.fontPx * style.leadScale;
  const leadWeight = style.leadWeight ?? style.fontWeight;
  return {
    rest: `${style.restWeight ?? style.fontWeight} ${style.fontPx}px ${DISPLAY_REST_FONT_FAMILY}`,
    lead: `${leadWeight} ${leadPx}px ${DISPLAY_LEAD_FONT_FAMILY}`,
    fallback: (px = leadPx) => `${leadWeight} ${Number.isFinite(px) && px > 0 ? px : leadPx}px ${DISPLAY_FALLBACK_FONT_FAMILY}`,
  };
}

/** The two families the lettering is drawn with. */
const DISPLAY_FAMILIES = ['Graduate', 'Nuffle'] as const;
type FaceState = 'loaded' | 'pending' | 'error' | 'absent';
/** Every display face has arrived: lettering drawn now is final. */
export const DISPLAY_FONTS_LOADED = 'loaded/loaded';
/** No Font Loading API (a test runtime): nothing to wait for or watch. */
export const DISPLAY_FONTS_UNSUPPORTED = 'unsupported';

type FontFaceSetLike = { forEach(callback: (face: FontFace) => void): void };
const familyOf = (face: FontFace): string => face.family.replace(/^["']|["']$/g, '');

function displayFaces(): FontFace[] {
  const faces: FontFace[] = [];
  (document.fonts as unknown as FontFaceSetLike).forEach((face) => {
    if ((DISPLAY_FAMILIES as readonly string[]).includes(familyOf(face))) faces.push(face);
  });
  return faces;
}

/**
 * Where the two display faces stand, read from the registered FontFace objects themselves, e.g. "loaded/loaded",
 * "pending/loaded", "absent/loaded". (`document.fonts.check` is no use for this: it answers true for a family that
 * is not registered and, in Chromium, for a registered face that has not loaded yet.) The renderer keys its lettering
 * on this string, so lettering rasterised in the fallback font is rebuilt when a face arrives.
 *
 * Script support (Astra 10-23 P2): a bundled last-resort face (FALLBACK_FONT_FACES) the browser has started to fetch
 * adds "+<n>~" while it loads and "+<n>" once it has, n = its index; one that is only registered adds nothing (it is
 * fetched on demand, never by loadDisplayFonts). Lettering drawn before such a face arrived (boxes on a host with no
 * CJK system font) is therefore rebuilt when it has.
 */
export function displayFontState(): string {
  try {
    if (typeof document === 'undefined' || !document.fonts?.forEach) return DISPLAY_FONTS_UNSUPPORTED;
    const faces = displayFaces();
    const main = DISPLAY_FAMILIES.map((name): FaceState => {
      const own = faces.filter((face) => familyOf(face) === name);
      if (own.some((face) => face.status === 'loaded')) return 'loaded';
      if (own.some((face) => face.status === 'unloaded' || face.status === 'loading')) return 'pending';
      return own.length ? 'error' : 'absent';
    }).join('/');
    return main + fallbackFaceState();
  } catch {
    return DISPLAY_FONTS_UNSUPPORTED;
  }
}

const FALLBACK_FAMILIES = FALLBACK_FONT_FACES.map((face) => face.family);
/** The bundled last-resort faces the browser has fetched ("+n") or is fetching ("+n~"); '' when none. */
function fallbackFaceState(): string {
  const status = new Map<number, string>();
  (document.fonts as unknown as FontFaceSetLike).forEach((face) => {
    const index = FALLBACK_FAMILIES.indexOf(familyOf(face));
    if (index < 0) return;
    if (face.status === 'loaded') status.set(index, `+${index}`);
    else if (face.status === 'loading' && status.get(index) !== `+${index}`) status.set(index, `+${index}~`);
  });
  return [...status.entries()].sort((a, b) => a[0] - b[0]).map(([, part]) => part).join('');
}

/** Start loading any registered display face that has not loaded yet. Resolves when they settle; never rejects. */
export async function loadDisplayFonts(): Promise<void> {
  try {
    if (typeof document === 'undefined' || !document.fonts?.forEach) return;
    await Promise.all(displayFaces().filter((face) => face.status === 'unloaded' || face.status === 'loading')
      .map((face) => face.load().catch(() => undefined)));
  } catch {
    /* a face that fails to load keeps the fallback stack */
  }
}

export interface DisplayLettering {
  canvas: HTMLCanvasElement;
  /** Logical size (canvas pixels / style.resolution). The canvas is the fit box, grown only if ink would clip. */
  width: number;
  height: number;
  /** The box the renderer fits into its band: the inked advance width, and the cap-height box. Both are centred
   *  on the canvas centre, so a centre-anchored sprite puts the capitals' middle on the band's middle. */
  fitWidth: number;
  fitHeight: number;
  /** The full height of the INK, measured, symmetric about the same centre: Nuffle's capitals carry spurs below the
   *  baseline, and a name can stack accents or hang descenders well past the cap box. The renderer also keeps THIS
   *  inside the band, so such a label shrinks instead of leaving it; ordinary lettering already fits and is not
   *  made smaller by it. */
  inkHeight: number;
  /** The same ink, as it really lies about the canvas centre: how far it reaches above it and below it. `inkTall`
   *  says it reaches past what plain capitals do (their cap height, and the spur Nuffle's capitals carry below the
   *  baseline) by more than a rounding: only then does the renderer re-fit and re-centre a label on its ink. */
  inkUp: number;
  inkDown: number;
  inkTall: boolean;
  /** Height of the lead capitals and of the Graduate small capitals, logical px (for sizing and reports). */
  capHeight: number;
  smallCapHeight: number;
  /** The Latin alphabetic baseline (lead and rest runs), logical px from the canvas top. */
  baseline: number;
  /** Where each run was drawn: its font, left edge and baseline (logical px). A fallback run's baseline is set so its
   *  reference glyph is centred on the capitals' middle. */
  runs: DisplayLetteringRun[];
}

/** One drawn run of a composed label. */
export interface DisplayLetteringRun { text: string; kind: 'lead' | 'rest' | 'fallback'; font: string; x: number; baseline: number; width: number }

/** `drop`: how far the run's baseline sits below the capitals' middle. */
interface MeasuredRun { run: DisplayCapsRun; kind: DisplayLetteringRun['kind']; font: string; width: number; drop: number }

type SpacingContext = CanvasRenderingContext2D & { letterSpacing?: string };

/** Draw `label` in the Graduate C style. Returns null where there is no 2D canvas (a headless test runtime) or the
 *  label has nothing to draw; the caller then draws nothing. */
export function composeDisplayLettering(label: string, style: DisplayLetteringStyle): DisplayLettering | null {
  if (typeof document === 'undefined') return null;
  if (style.face === 'snes') return composeSnesLettering(label, style);
  const runs = displayCapsRuns(label);
  if (!runs.length) return null;
  let canvas: HTMLCanvasElement;
  let ctx: SpacingContext | null;
  try {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d') as SpacingContext | null;
  } catch {
    return null;
  }
  if (!ctx) return null;
  const fonts = displayLetteringFonts(style);
  const nativeSpacing = 'letterSpacing' in ctx;
  const prepare = (target: SpacingContext, font: string): void => {
    target.font = font;
    target.lineJoin = 'round';
    target.lineWidth = style.restOutline;
    target.strokeStyle = style.fill;
    target.fillStyle = style.fill;
    if (nativeSpacing) target.letterSpacing = `${style.letterSpacing}px`;
    target.textBaseline = 'alphabetic';
    target.textAlign = 'left';
  };
  // Without native letter spacing each character is advanced by hand (Pixi's own fallback does the same): one
  // GRAPHEME at a time, so a letter keeps its combining marks and an emoji sequence is one piece.
  // KNOWN LIMITATION (Astra review 10-23, inherited from da3ad3aa3, out of scope): on this no-letterSpacing path a
  // right-to-left fallback word (Arabic, Hebrew) is also drawn grapheme by grapheme at increasing x, so Arabic loses
  // its joining and Hebrew comes out in reversed visual order. Engines with native canvas letterSpacing (Chromium /
  // WebView2, Safari 18.4+) draw every run whole and are unaffected.
  const pieces = (text: string): string[] => (nativeSpacing ? [text] : displayGraphemes(text));
  const advance = (target: SpacingContext, text: string): number =>
    target.measureText(text).width + (nativeSpacing ? 0 : style.letterSpacing);

  prepare(ctx, fonts.lead);
  const capMetrics = ctx.measureText('H');
  const capHeight = capMetrics.actualBoundingBoxAscent || style.fontPx * style.leadScale * 0.7;
  const capDescent = capMetrics.actualBoundingBoxDescent || 0;
  prepare(ctx, fonts.rest);
  const smallCapHeight = ctx.measureText('h').actualBoundingBoxAscent || style.fontPx * 0.68;

  // Fallback words (rule 7): sized so the reference glyph's ink is as tall as the lead capitals, and dropped so that
  // ink is centred on the capitals' middle. Measured once per label, only when the label has such a word.
  const leadPx = style.fontPx * style.leadScale;
  let fallbackFont = fonts.fallback(leadPx);
  let fallbackDrop = capHeight / 2;
  if (runs.some((run) => run.fallback)) {
    prepare(ctx, fallbackFont);
    const probe = ctx.measureText(FALLBACK_REFERENCE_GLYPH);
    const probeHeight = (probe.actualBoundingBoxAscent || 0) + (probe.actualBoundingBoxDescent || 0);
    const ratio = probeHeight > 0 ? capHeight / probeHeight : 1;
    const scale = Math.min(FALLBACK_SIZE_RANGE[1], Math.max(FALLBACK_SIZE_RANGE[0], Number.isFinite(ratio) ? ratio : 1));
    fallbackFont = fonts.fallback(leadPx * scale);
    prepare(ctx, fallbackFont);
    const ref = ctx.measureText(FALLBACK_REFERENCE_GLYPH);
    const refAscent = ref.actualBoundingBoxAscent || capHeight;
    const refDescent = ref.actualBoundingBoxDescent || 0;
    fallbackDrop = (refAscent - refDescent) / 2;
  }

  const measured: MeasuredRun[] = [];
  let total = 0;
  // The ink's reach about the capitals' middle (up / down), over every run; plain capitals reach half the cap height.
  let inkUp = capHeight / 2;
  let inkDown = capHeight / 2;
  for (const run of runs) {
    const kind: DisplayLetteringRun['kind'] = run.fallback ? 'fallback' : run.lead ? 'lead' : 'rest';
    const font = kind === 'fallback' ? fallbackFont : kind === 'lead' ? fonts.lead : fonts.rest;
    const drop = kind === 'fallback' ? fallbackDrop : capHeight / 2;
    prepare(ctx, font);
    let width = 0;
    for (const piece of pieces(run.text)) width += advance(ctx, piece);
    const metrics = ctx.measureText(run.text);
    inkUp = Math.max(inkUp, (metrics.actualBoundingBoxAscent || 0) - drop);
    inkDown = Math.max(inkDown, (metrics.actualBoundingBoxDescent || 0) + drop);
    measured.push({ run, kind, font, width, drop });
    total += width;
  }
  // The last character's trailing spacing is not ink: the word is centred on its letters.
  const fitWidth = Math.max(1, total - style.letterSpacing);
  // Symmetric about the capitals' middle, so the canvas centre IS the cap centre. The ink's own reach (measured,
  // above and below) is reported beside the cap box: the renderer keeps both inside the band.
  const inkHalf = Math.max(inkUp, inkDown);
  // "Tall": past the plain capitals' own reach by more than 3% of the cap height (round letters overshoot a little).
  // This gate is a step: ink just under it keeps the ordinary placement, ink just over it is re-fitted and
  // re-centred. Accepted (review 10-11): no pair of glyphs in the bundled fonts straddles it - their ink is either a
  // plain capital's or an accent / descender well past 3%.
  const slack = capHeight * 0.03;
  const inkTall = inkUp > capHeight / 2 + slack || inkDown > capHeight / 2 + capDescent + slack;
  const fitHeight = capHeight / style.capFill;
  const inkHeight = inkHalf * 2;
  const pad = 3;
  const half = Math.max(fitHeight / 2, inkHalf + pad);
  const width = Math.ceil(fitWidth + pad * 2 + style.fontPx); // side room for italic / faux-bold overhang
  const height = Math.ceil(half * 2);
  canvas.width = Math.max(1, Math.ceil(width * style.resolution));
  canvas.height = Math.max(1, Math.ceil(height * style.resolution));
  // Resizing a canvas resets its context state.
  ctx.setTransform(style.resolution, 0, 0, style.resolution, 0, 0);
  const centre = height / 2;
  const baseline = centre + capHeight / 2;
  const drawn: DisplayLetteringRun[] = [];
  let x = (width - fitWidth) / 2;
  for (const entry of measured) {
    prepare(ctx, entry.font);
    const runBaseline = centre + entry.drop;
    drawn.push({ text: entry.run.text, kind: entry.kind, font: entry.font, x, baseline: runBaseline, width: entry.width });
    for (const piece of pieces(entry.run.text)) {
      ctx.fillText(piece, x, runBaseline);
      if (entry.kind === 'rest' && style.restOutline > 0) ctx.strokeText(piece, x, runBaseline);
      x += advance(ctx, piece);
    }
  }
  return { canvas, width, height, fitWidth, fitHeight, inkHeight, inkUp, inkDown, inkTall, capHeight, smallCapHeight, baseline, runs: drawn };
}

/** Owner 11-11: the whole label in SNES Italic capitals, one run. The italic leans its tops to the right of its
 *  advance, so the label is centred on its measured INK (actualBoundingBoxLeft / Right), not on the advance: the
 *  slant then stays inside the band symmetrically in both orientations and under the 180 degree turn. */
function composeSnesLettering(label: string, style: DisplayLetteringStyle): DisplayLettering | null {
  const text = label.trim().replace(/ +/g, ' ').toUpperCase();
  if (!text) return null;
  let canvas: HTMLCanvasElement;
  let ctx: SpacingContext | null;
  try {
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d') as SpacingContext | null;
  } catch {
    return null;
  }
  if (!ctx) return null;
  const font = `italic ${style.fontWeight} ${style.fontPx}px ${FONT_SNES_FAMILY}`;
  const nativeSpacing = 'letterSpacing' in ctx;
  const prepare = (target: SpacingContext): void => {
    target.font = font;
    target.fillStyle = style.fill;
    if (nativeSpacing) target.letterSpacing = `${style.letterSpacing}px`;
    target.textBaseline = 'alphabetic';
    target.textAlign = 'left';
  };
  prepare(ctx);
  const cap = ctx.measureText('H');
  const capHeight = cap.actualBoundingBoxAscent || style.fontPx * 0.7;
  const metrics = ctx.measureText(text);
  const advance = metrics.width;
  // Ink extent about the pen origin; a stand-in without bounding boxes falls back to the advance.
  const inkLeft = Number.isFinite(metrics.actualBoundingBoxLeft) ? metrics.actualBoundingBoxLeft : 0;
  const inkRight = Number.isFinite(metrics.actualBoundingBoxRight) && metrics.actualBoundingBoxRight > 0
    ? metrics.actualBoundingBoxRight : advance - (nativeSpacing ? style.letterSpacing : 0);
  const fitWidth = Math.max(1, inkLeft + inkRight);
  const inkUp = Math.max(capHeight / 2, (metrics.actualBoundingBoxAscent || capHeight) - capHeight / 2);
  const inkDown = Math.max(capHeight / 2, (metrics.actualBoundingBoxDescent || 0) + capHeight / 2);
  const inkHalf = Math.max(inkUp, inkDown);
  const fitHeight = capHeight / style.capFill;
  const pad = 3;
  const half = Math.max(fitHeight / 2, inkHalf + pad);
  const width = Math.ceil(fitWidth + pad * 2);
  const height = Math.ceil(half * 2);
  canvas.width = Math.max(1, Math.ceil(width * style.resolution));
  canvas.height = Math.max(1, Math.ceil(height * style.resolution));
  ctx.setTransform(style.resolution, 0, 0, style.resolution, 0, 0);
  prepare(ctx); // resizing the canvas reset the context state
  const centre = height / 2;
  const baseline = centre + capHeight / 2;
  const x = (width - fitWidth) / 2 + inkLeft; // the pen origin that puts the ink's middle on the canvas middle
  ctx.fillText(text, x, baseline);
  const slack = capHeight * 0.03;
  return {
    canvas, width, height, fitWidth, fitHeight, inkHeight: inkHalf * 2, inkUp, inkDown,
    inkTall: inkUp > capHeight / 2 + slack || inkDown > capHeight / 2 + slack,
    capHeight, smallCapHeight: capHeight, baseline,
    runs: [{ text, kind: 'lead', font, x, baseline, width: advance }],
  };
}

/** A point on screen. */
export interface LetteringPoint { x: number; y: number }

/**
 * How much room a label has across a band, measured where the label actually is. `edges` are the band's two long
 * edges as screen polylines (a perspective band tapers, and its edges need not be parallel to the label); the label
 * sits at `centre`, turned by `rotation`, and reaches `halfExtent` along its own axis either way. Returns the
 * NARROWEST clearance over that extent on the label's own up side and down side (its local -y / +y), sampling both
 * ends, the middle and every edge vertex in between. 0 when an edge is not on its side at all.
 */
export function bandClearance(edges: readonly [readonly LetteringPoint[], readonly LetteringPoint[]], centre: LetteringPoint, rotation: number, halfExtent: number): { up: number; down: number } {
  const ux = Math.cos(rotation), uy = Math.sin(rotation); // along the text
  const dx = -uy, dy = ux; // the text's own "down"
  const local = (edge: readonly LetteringPoint[]): { a: number; b: number }[] =>
    edge.map((q) => ({ a: (q.x - centre.x) * ux + (q.y - centre.y) * uy, b: (q.x - centre.x) * dx + (q.y - centre.y) * dy })).sort((p, q) => p.a - q.a);
  const acrossAt = (points: { a: number; b: number }[], a: number): number => {
    if (points.length === 1) return points[0]!.b;
    let i = 0;
    while (i < points.length - 2 && points[i + 1]!.a < a) i++;
    const p = points[i]!, q = points[i + 1]!;
    const span = q.a - p.a;
    return span === 0 ? p.b : p.b + ((q.b - p.b) * (a - p.a)) / span; // extrapolates past the ends
  };
  let up = Infinity;
  let down = Infinity;
  for (const edge of edges) {
    const points = local(edge);
    if (!points.length) continue;
    const samples = [-halfExtent, 0, halfExtent, ...points.map((p) => p.a).filter((a) => a > -halfExtent && a < halfExtent)];
    const across = samples.map((a) => acrossAt(points, a));
    if (acrossAt(points, 0) >= 0) down = Math.min(down, ...across);
    else up = Math.min(up, ...across.map((b) => -b));
  }
  return { up: Number.isFinite(up) ? Math.max(0, up) : 0, down: Number.isFinite(down) ? Math.max(0, down) : 0 };
}

/**
 * Fit a label with TALL ink (stacked accents, deep descenders) strictly inside its band: the scale is cut until the
 * whole ink (`inkUp + inkDown`, at that scale) fits the narrowest clearance over the label's own extent, and the ink
 * is centred in that room. `scale` is the scale the ordinary fit chose (never raised). Returns the scale and where
 * the centre of the INK goes. One re-measure, because a smaller label covers a shorter stretch of the band.
 */
export function fitInkInBand(input: {
  edges: readonly [readonly LetteringPoint[], readonly LetteringPoint[]]; centre: LetteringPoint; rotation: number;
  scale: number; fitWidth: number; inkUp: number; inkDown: number;
}): { scale: number; x: number; y: number } {
  const ink = Math.max(1e-6, input.inkUp + input.inkDown);
  let scale = input.scale;
  let room = bandClearance(input.edges, input.centre, input.rotation, (scale * input.fitWidth) / 2);
  for (let pass = 0; pass < 2; pass++) {
    const most = (room.up + room.down) / ink;
    if (!(most > 0) || scale <= most) break;
    scale = most;
    room = bandClearance(input.edges, input.centre, input.rotation, (scale * input.fitWidth) / 2);
  }
  const shift = (room.down - room.up) / 2; // along the text's own "down"
  return { scale, x: input.centre.x - Math.sin(input.rotation) * shift, y: input.centre.y + Math.cos(input.rotation) * shift };
}
