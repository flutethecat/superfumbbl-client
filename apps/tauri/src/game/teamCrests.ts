import { rosterRaceKey } from '@fumbbl40k/ffb-pitch';
/**
 * Bundled per-race team crests (owner 2026-09-04): 31 original SVG shields authored for
 * Super FUMBBL, one per BB2025 roster plus Slann. Our standalone server sends no
 * `logoUrl`, so the HUD corner panels, the end-game summary and the pitch sweet-spot
 * logos fall back to these. Each crest paints its kit areas with CSS custom properties
 * (`--crest-team`, `--crest-team-dark`); an `<img>`/Pixi texture cannot read page CSS,
 * so the colours are substituted here per side (home red, away blue — the same kit
 * convention as the sprite sheets).
 *
 * Source of truth for the artwork: `Super FUMBBL Team Icons/logos/v01` (spec + validator).
 * Placeholders until raster logos land; swap the files, keep the keys.
 */

const RAW = import.meta.glob('../assets/crests/*.svg', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

const CRESTS: Record<string, string> = {};
for (const [path, svg] of Object.entries(RAW)) {
  const key = path.replace(/^.*\/([a-z]+)\.svg$/, '$1');
  CRESTS[key] = svg;
}

export type CrestSide = 'home' | 'away';

/**
 * Owner 2026-09-04: finished raster crests (PixelLab, 128×128, home kit red) replace the SVG
 * placeholder for a race as they are accepted — `<key>.png` for home and `<key>-away.png`
 * for the blue away recolour. Both files must exist for the raster to win; otherwise the
 * SVG keeps serving both sides so the kits never mismatch.
 */
const RASTER = import.meta.glob('../assets/crests/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const RASTER_BY_KEY: Record<string, Partial<Record<CrestSide, string>>> = {};
for (const [path, url] of Object.entries(RASTER)) {
  const m = /\/([a-z]+)(-away)?\.png$/.exec(path);
  if (!m) continue;
  (RASTER_BY_KEY[m[1]!] ??= {})[m[2] ? 'away' : 'home'] = url;
}

function rasterCrest(key: string, side: CrestSide): string | null {
  const r = RASTER_BY_KEY[key];
  return r?.home && r.away ? r[side] ?? null : null;
}

const KIT: Record<CrestSide, { team: string; dark: string }> = {
  home: { team: '#C2333C', dark: '#7E1F27' },
  away: { team: '#3663C9', dark: '#22418A' },
};

/** Roster/race name → crest key: lower-case, letters only (`Chaos Chosen` → `chaoschosen`). */
export function crestKey(race: string | null | undefined): string | null {
  const key = rosterRaceKey(race).replace(/[^a-z]/g, ''); // owner 09-07: "BB2025 Lizardmen" -> lizardmen
  return key && key in CRESTS ? key : null;
}

export function hasCrest(race: string | null | undefined): boolean {
  return crestKey(race) !== null;
}

const cache = new Map<string, string>();

/**
 * Data URL for a race's crest in the given side's kit colours, or null when no crest is
 * bundled for that race. The SVG gets explicit pixel dimensions so image decoders (and
 * Pixi's texture loader) rasterise it square instead of at the 300×150 SVG default.
 */
export function crestDataUrl(race: string | null | undefined, side: CrestSide, size = 256): string | null {
  const key = crestKey(race);
  if (!key) return null;
  return rasterCrest(key, side) ?? svgCrestDataUrl(race, side, size);
}

/** The SVG placeholder path on its own (kept for races without an accepted raster pair, and for tests). */
export function svgCrestDataUrl(race: string | null | undefined, side: CrestSide, size = 256): string | null {
  const key = crestKey(race);
  if (!key) return null;
  const cacheKey = `${key}:${side}:${size}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const kit = KIT[side];
  const source = CRESTS[key];
  if (!source) return null;
  const svg = source
    .replace(/var\(--crest-team-dark\s*,\s*[^)]+\)/g, kit.dark)
    .replace(/var\(--crest-team\s*,\s*[^)]+\)/g, kit.team)
    .replace(/<svg\b([^>]*)>/, (m, attrs: string) =>
      /\bwidth=/.test(attrs) ? m : `<svg${attrs} width="${size}" height="${size}">`);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  cache.set(cacheKey, url);
  return url;
}

/** Keys of every bundled crest (for tests and asset tooling). */
export function bundledCrestKeys(): string[] {
  return Object.keys(CRESTS).sort();
}

/** Keys whose crest is served from the finished raster pair rather than the SVG placeholder. */
export function rasterCrestKeys(): string[] {
  return Object.keys(RASTER_BY_KEY).filter((k) => rasterCrest(k, 'home') !== null).sort();
}
