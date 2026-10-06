/**
 * Owner 10-06: the block die SURFACE — the bundled block-die faces drawn on a black or a white plate, independent of
 * the face family (Super FUMBBL default / KrisB). Assets come from scripts/gen-block-die-glyphs.py:
 *   assets/blockdice/glyph/face_*.png        default glyphs (tile knocked out), registered on the 1254 px tile
 *   assets/blockdice-krisb/glyph/face_*.png  KrisB glyphs (KrisB faces carry no tile; faint backing haze removed)
 *   assets/blockdice/plate/plate_{black,white}.png  the baked default tile without its glyph, and its cream recolour
 *
 * The family's NATIVE look is never recomposed: default-on-black is the original baked face art (byte-identical to
 * before this setting existed). Every other family x surface pair is composed once (plate + glyph, straight-alpha
 * source-over, at COMPOSED_FACE_PX) into a cached PNG data URL that every surface — the Pixi dice, the 3D die, the
 * Classic/modern block dialogs, the Configured-assets rows, the setup wizard — shares. Pack-bound faces are complete
 * images and never pass through here.
 */
export type BlockDieSurface = 'black' | 'white';
/** The stored setting: 'auto' (default) = the face set's own surface (see resolveBlockDieSurface). */
export type BlockDieSurfaceSetting = 'auto' | BlockDieSurface;
export type BlockDieGlyphFamily = 'default' | 'krisb';

/** Face order everywhere: the renderer's tumble order. */
export const BLOCK_DIE_SURFACE_FACES = ['skull', 'bothdown', 'push', 'powpush', 'pow'] as const;

/** Plate colours sampled from the generated plates (interior fill) — the black one is the baked default tile's own
 *  interior; the white one is the cream the generator fills. Used for the 3D die's inset face and for tests. */
export const BLOCK_DIE_SURFACE_COLOURS: Readonly<Record<BlockDieSurface, { fill: string; edge: string }>> = {
  black: { fill: '#000000', edge: '#a0a4a6' },
  white: { fill: '#f3efe6', edge: '#26221e' },
};

/** Where a family's glyph sits on the plate, as fractions of the plate edge [x, y, w, h]. Mirrors GLYPH_RECT in
 *  scripts/gen-block-die-glyphs.py. Default glyphs were registered on the full tile; KrisB glyphs fill their whole
 *  canvas and are inset into the tile interior. */
export const BLOCK_GLYPH_RECT: Readonly<Record<BlockDieGlyphFamily, readonly [number, number, number, number]>> = {
  default: [0, 0, 1, 1],
  krisb: [0.13, 0.125, 0.74, 0.74],
};

/** Edge (px) of a composed face. The on-pitch dice and the 3D die draw well below this. */
export const COMPOSED_FACE_PX = 512;

export function normalizeBlockDieSurface(value: unknown): BlockDieSurface {
  return value === 'white' ? 'white' : 'black';
}

/** The stored setting, tolerant: 'black' / 'white' kept, anything else 'auto'. */
export function normalizeBlockDieSurfaceSetting(value: unknown): BlockDieSurfaceSetting {
  return value === 'black' || value === 'white' ? value : 'auto';
}

/** THE resolver (owner 10-06 follow-up): the surface a family is drawn on for a setting. 'auto' = per face set —
 *  black for the Super FUMBBL default faces, white for KrisB. Every surface reads through this. */
export function resolveBlockDieSurface(family: BlockDieGlyphFamily | string, setting: unknown): BlockDieSurface {
  const explicit = normalizeBlockDieSurfaceSetting(setting);
  if (explicit !== 'auto') return explicit;
  return family === 'krisb' ? 'white' : 'black';
}

/** Owner 10-06 follow-up: KrisB's line art is black, so on the BLACK plate its glyph gets a thin light outline
 *  (alpha dilation of the glyph, drawn UNDER it). Never on white, never for the default family. Radius is in px of a
 *  COMPOSED_FACE_PX face. Mirrors KRISB_BLACK_OUTLINE in scripts/gen-block-die-glyphs.py (contact sheet). */
export const KRISB_BLACK_OUTLINE = { rgb: [0xe8, 0xe4, 0xda] as const, radius: 2 };

export function blockGlyphOutline(family: BlockDieGlyphFamily, surface: BlockDieSurface): typeof KRISB_BLACK_OUTLINE | null {
  return family === 'krisb' && surface === 'black' ? KRISB_BLACK_OUTLINE : null;
}

/** Pure: an outline layer for an RGBA glyph of `width` px — every pixel takes the MAX glyph alpha within a disc of
 *  `radius`, coloured `rgb`. Composed under the glyph it reads as an outline exactly `radius` px wide. */
export function glyphOutlinePixels(glyph: Uint8ClampedArray, width: number, rgb: readonly [number, number, number], radius: number): Uint8ClampedArray {
  const height = glyph.length / 4 / width;
  const offsets: [number, number][] = [];
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius + 0.5) offsets.push([dx, dy]);
  const out = new Uint8ClampedArray(glyph.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let a = 0;
      for (const [dx, dy] of offsets) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const v = glyph[(yy * width + xx) * 4 + 3]!;
        if (v > a) { a = v; if (a === 255) break; }
      }
      if (!a) continue;
      const i = (y * width + x) * 4;
      out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2]; out[i + 3] = a;
    }
  }
  return out;
}

/** The surface a family's original bundled art already is (null: the art has no plate and is always composed). */
export function nativeBlockDieSurface(family: BlockDieGlyphFamily): BlockDieSurface | null {
  return family === 'default' ? 'black' : null;
}

export function blockGlyphUrls(family: BlockDieGlyphFamily): string[] {
  return BLOCK_DIE_SURFACE_FACES.map((face) => family === 'krisb'
    ? new URL(`../assets/blockdice-krisb/glyph/face_${face}.png`, import.meta.url).href
    : new URL(`../assets/blockdice/glyph/face_${face}.png`, import.meta.url).href);
}

export function blockPlateUrl(surface: BlockDieSurface): string {
  return surface === 'white'
    ? new URL('../assets/blockdice/plate/plate_white.png', import.meta.url).href
    : new URL('../assets/blockdice/plate/plate_black.png', import.meta.url).href;
}

/** Pixel rectangle of the glyph on a `size` px plate. */
export function blockGlyphRectPx(family: BlockDieGlyphFamily, size: number): { x: number; y: number; w: number; h: number } {
  const [x, y, w, h] = BLOCK_GLYPH_RECT[family];
  return { x: Math.round(x * size), y: Math.round(y * size), w: Math.round(w * size), h: Math.round(h * size) };
}

/**
 * Pure straight-alpha source-over of `glyph` onto `plate` (both RGBA, same length), written into a new buffer.
 * Where the glyph is transparent the plate shows unchanged; where it is opaque the glyph shows unchanged.
 */
export function composeBlockFacePixels(plate: Uint8ClampedArray, glyph: Uint8ClampedArray): Uint8ClampedArray {
  if (plate.length !== glyph.length) throw new Error('composeBlockFacePixels: buffer sizes differ');
  const out = new Uint8ClampedArray(plate.length);
  for (let i = 0; i < plate.length; i += 4) {
    const sa = glyph[i + 3]! / 255;
    const da = plate[i + 3]! / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) continue;
    const k = da * (1 - sa);
    out[i] = (glyph[i]! * sa + plate[i]! * k) / oa;
    out[i + 1] = (glyph[i + 1]! * sa + plate[i + 1]! * k) / oa;
    out[i + 2] = (glyph[i + 2]! * sa + plate[i + 2]! * k) / oa;
    out[i + 3] = oa * 255;
  }
  return out;
}

/** Composed sets IN HAND (composed this session, or read back from storage AND decoded): the only sets served. */
const composed = new Map<string, string[]>();
const composing = new Map<string, Promise<string[]>>();
const key = (family: BlockDieGlyphFamily, surface: BlockDieSurface) => `${family}:${surface}`;

/**
 * Launch flicker (Astra): the ACTIVE composed pair persists in localStorage, keyed by family x surface x an asset hash
 * (the built asset URLs carry Vite's content hashes) x COMPOSE_VERSION, so new art or a new composer never serves a
 * stale set. One pair only (~1.1 MB of PNG data URLs): writing it drops every other entry under the prefix; wizard
 * previews are never persisted. A stored set is NEVER served on trust (Astra F1): composeBlockFaces decodes all five
 * entries and checks their size before it counts as composed; a bad entry is evicted and the pair composed afresh.
 * Every storage call is guarded (F2): quota, private mode, disabled storage or a throwing getItem only cost a compose.
 */
export const COMPOSE_VERSION = 2;
export const COMPOSED_STORAGE_PREFIX = 'superfumbbl.blockDieFaces.';

function hashString(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function composedStorageKey(family: BlockDieGlyphFamily, surface: BlockDieSurface): string {
  const assets = [blockPlateUrl(surface), ...blockGlyphUrls(family)].join('|');
  return `${COMPOSED_STORAGE_PREFIX}${family}.${surface}.${hashString(`${COMPOSE_VERSION}|${assets}`)}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
function safeGet(storageKey: string): string | null {
  try { return storage()?.getItem(storageKey) ?? null; } catch { return null; }
}
function safeSet(storageKey: string, value: string): boolean {
  try { const s = storage(); if (!s) return false; s.setItem(storageKey, value); return true; } catch { return false; }
}
function safeRemove(storageKey: string): void {
  try { storage()?.removeItem(storageKey); } catch { /* ignore */ }
}
function storedKeys(): string[] {
  try {
    const s = storage();
    if (!s) return [];
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(COMPOSED_STORAGE_PREFIX)) keys.push(k);
    }
    return keys;
  } catch {
    return [];
  }
}

/** The storage key this session last wrote or validated, so the active pair is not rewritten on every prepare. */
let persistedKey: string | null = null;

function readStoredCandidate(family: BlockDieGlyphFamily, surface: BlockDieSurface): string[] | null {
  const raw = safeGet(composedStorageKey(family, surface));
  if (!raw) return null;
  try {
    const urls = JSON.parse(raw) as unknown;
    if (Array.isArray(urls) && urls.length === BLOCK_DIE_SURFACE_FACES.length
      && urls.every((url) => typeof url === 'string' && url.startsWith('data:image/png;base64,'))) return urls as string[];
  } catch { /* unparseable */ }
  return null;
}

function writeStored(family: BlockDieGlyphFamily, surface: BlockDieSurface, urls: string[]): void {
  const storageKey = composedStorageKey(family, surface);
  for (const k of storedKeys()) if (k !== storageKey) safeRemove(k);
  if (safeSet(storageKey, JSON.stringify(urls))) persistedKey = storageKey; // OVERWRITES a stale / truncated entry
}

/** Persist an in-memory composed pair as THE stored pair (overwriting whatever is stored under its key). */
export function persistComposedBlockFaces(family: BlockDieGlyphFamily, surface: BlockDieSurface): boolean {
  const urls = composed.get(key(family, surface));
  if (!urls) return false;
  if (persistedKey !== composedStorageKey(family, surface)) writeStored(family, surface, urls);
  return true;
}

/** Drop every stored pair (the active pair is native art: nothing to keep). */
export function clearStoredBlockFaces(): void {
  for (const k of storedKeys()) safeRemove(k);
  persistedKey = null;
}

/** Forget a composed pair everywhere (memory and storage): its textures failed to load — compose it afresh. */
export function evictComposedBlockFaces(family: BlockDieGlyphFamily, surface: BlockDieSurface): void {
  composed.delete(key(family, surface));
  const storageKey = composedStorageKey(family, surface);
  safeRemove(storageKey);
  if (persistedKey === storageKey) persistedKey = null;
}

/** The five composed face URLs for a family x surface once IN HAND (composed, or restored from storage and decoded),
 *  else null. Synchronous; never composes, never trusts storage. */
export function composedBlockFaceUrls(family: BlockDieGlyphFamily, surface: BlockDieSurface): string[] | null {
  return composed.get(key(family, surface)) ?? null;
}

/** True when a family x surface can be drawn without waiting: its native art, or a composed set in hand. */
export function blockFacesReady(family: BlockDieGlyphFamily, surface: BlockDieSurface): boolean {
  return nativeBlockDieSurface(family) === surface || composedBlockFaceUrls(family, surface) !== null;
}

/** An image that never loads (jsdom, a stalled asset) must not hold a compose — and the renderer init awaiting it —
 *  forever: give up after this long and fall back to the original art. */
export const COMPOSE_IMAGE_TIMEOUT_MS = 8_000;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') { reject(new Error('block die surface: no Image')); return; }
    const img = new Image();
    const timer = setTimeout(() => reject(new Error('block die surface: timed out loading an image')), COMPOSE_IMAGE_TIMEOUT_MS);
    img.decoding = 'async';
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('block die surface: failed to load an image')); };
    img.src = url;
  });
}

/** Decodes one image URL to its pixel size (the stored-set validator). Test seam: setBlockFaceDecoderForTests. */
let decoder: (url: string) => Promise<{ width: number; height: number }> = async (url) => {
  const img = await loadImage(url);
  return { width: img.naturalWidth, height: img.naturalHeight };
};

async function storedSetDecodes(urls: string[]): Promise<boolean> {
  try {
    const sizes = await Promise.all(urls.map((url) => decoder(url)));
    return sizes.every((s) => s.width === COMPOSED_FACE_PX && s.height === COMPOSED_FACE_PX);
  } catch {
    return false;
  }
}

function pixelsOf(img: CanvasImageSource, size: number, rect: { x: number; y: number; w: number; h: number }): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('block die surface: no 2D canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
  return ctx.getImageData(0, 0, size, size).data;
}

/** The canvas composition itself (plate, KrisB-on-black outline, glyph) -> five PNG data URLs. */
async function composeWithCanvas(family: BlockDieGlyphFamily, surface: BlockDieSurface): Promise<string[]> {
  if (typeof document === 'undefined') throw new Error('block die surface: no DOM');
  const size = COMPOSED_FACE_PX;
  const [plateImg, ...glyphImgs] = await Promise.all([blockPlateUrl(surface), ...blockGlyphUrls(family)].map(loadImage));
  const plate = pixelsOf(plateImg!, size, { x: 0, y: 0, w: size, h: size });
  const rect = blockGlyphRectPx(family, size);
  const outline = blockGlyphOutline(family, surface);
  return glyphImgs.map((img) => {
    const glyph = pixelsOf(img, size, rect);
    const base = outline ? composeBlockFacePixels(plate, glyphOutlinePixels(glyph, size, outline.rgb, outline.radius)) : plate;
    const pixels = composeBlockFacePixels(base, glyph);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('block die surface: no 2D canvas');
    ctx.putImageData(new ImageData(pixels as unknown as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
    return canvas.toDataURL('image/png');
  });
}

let composer: (family: BlockDieGlyphFamily, surface: BlockDieSurface) => Promise<string[]> = composeWithCanvas;

export interface ComposeOptions {
  /** Persist the set as THE stored pair if this still holds when the set is in hand (Astra F3: re-read at persist
   *  time, so a superseded compose never rewrites the cache). */
  persistIf?: () => boolean;
}

/** Compose (once, cached in memory; persisted when `persistIf()` holds at completion) the five faces of a family on a
 *  surface — from a validated stored set when there is one. Rejects when no DOM/canvas is available or an asset fails
 *  (or stalls); callers keep the family's original art in that case. */
export function composeBlockFaces(family: BlockDieGlyphFamily, surface: BlockDieSurface, opts: ComposeOptions = {}): Promise<string[]> {
  const k = key(family, surface);
  const persistIfStill = (urls: string[]) => {
    if (opts.persistIf?.()) persistComposedBlockFaces(family, surface);
    return urls;
  };
  const done = composed.get(k);
  if (done) return Promise.resolve(persistIfStill(done));
  let run = composing.get(k);
  if (!run) {
    run = (async () => {
      const stored = readStoredCandidate(family, surface);
      if (stored && await storedSetDecodes(stored)) {
        composed.set(k, stored);
        // Astra P3: the entry may have been cleared (default on black became active) while it was decoding — only a
        // still-present entry counts as persisted, so a later persist writes it back instead of skipping.
        const storageKey = composedStorageKey(family, surface);
        if (safeGet(storageKey) !== null) persistedKey = storageKey;
        return stored;
      }
      if (safeGet(composedStorageKey(family, surface)) !== null) evictComposedBlockFaces(family, surface); // bad entry
      const urls = await composer(family, surface);
      composed.set(k, urls);
      return urls;
    })();
    composing.set(k, run);
    const settled = run;
    settled.catch(() => undefined).finally(() => { if (composing.get(k) === settled) composing.delete(k); });
  }
  return run.then(persistIfStill);
}

/** Test seam: replace the canvas composition (null restores it). */
export function setBlockFaceComposerForTests(next: typeof composer | null): void {
  composer = next ?? composeWithCanvas;
}

/** Test seam: replace the stored-set decoder (null restores the Image decoder). */
export function setBlockFaceDecoderForTests(next: typeof decoder | null): void {
  decoder = next ?? (async (url) => {
    const img = await loadImage(url);
    return { width: img.naturalWidth, height: img.naturalHeight };
  });
}

/** Test seam. */
export function resetComposedBlockFacesForTests(seed?: Record<string, string[]>): void {
  composed.clear();
  composing.clear();
  persistedKey = null;
  for (const [k, urls] of Object.entries(seed ?? {})) composed.set(k, urls);
}
