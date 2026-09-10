import { Assets, Container, Graphics, Rectangle, Sprite, Texture, type TextureSource } from 'pixi.js';
import { getOrientation, PITCH_COLS, PITCH_ROWS, squareAnchor, TILE_H, TILE_W } from './geometry';
import type { PlayerDataJson, PlayerJson, TeamJson } from '@fumbbl40k/ffb-protocol';
import type { AssetSide } from './skillIcons';
import { resolveBundledWalkRole, rosterRaceKey } from './bundledWalk';

export type Dir8 = 'S' | 'SE' | 'E' | 'NE' | 'N' | 'NW' | 'W' | 'SW';

/** Transport shape as received from Tauri (numbers, not literals). */
export interface WalkSheetSpecTransport {
  frame: number;
  rows: string[];
  columns: number;
  idleColumn: number;
  fps: number;
  footY?: number;
  /** Owner 09-05: per-sheet VISUAL scale on top of WALKER_SPRITE_SCALE — narrow figures (a Grail Knight) at the
   *  same 60 px height read smaller than the Skaven Blitzer, so blitzer-class sheets carry sqrt(refMass/mass). */
  visualScale?: number;
}

/** Narrowed by prepareWalkSheets (the trust boundary). */
export interface ValidatedWalkSheetSpec {
  /** Frame size in WORLD UNITS (64 = the standard grid; 72 = the 144 px big-guy masters, owner 09-06; 96 reserved). Pixels per unit
 *  come from the sheet itself (source.resolution: 2 on the 128 px-per-64-unit masters). */
  frame: number;
  rows: Dir8[];
  columns: number;
  idleColumn: 0;
  fps: number;
  footY: number;
  visualScale: number;
}

export interface WalkerAsset {
  key: string;
  sheet: TextureSource;
  frames: Texture[][];
  spec: ValidatedWalkSheetSpec;
  figureHeight: number;
  /** Owner 09-05 (round 17): measured on the S idle frame, in 64-unit space — the rings/shadows key to these. */
  figureWidth?: number;
  feetWidth?: number;
  /** Owner 09-05: optional HALF-resolution frames (32 px art per 64-unit frame, exact 2x2 box average, source.resolution 1/2) — drawn
   *  1:1 with nearest sampling at the default zoom so the pixel detail survives; the full frames serve zoom-in. */
  displayFrames?: Texture[][];
}

export interface BundledWalkEntry {
  race: string;
  role: string;
  /** 'any' = a single-kit race whose one sheet serves both sides. */
  side: 'home' | 'away' | 'any';
  url: string;
  /** Owner 09-05: the 37 px display sheet for this entry (bundled set). */
  displayUrl?: string;
  footY: number;
  columns: number;
  fps: number;
  rows: string[];
  visualScale?: number;
  /** Frame size in world units (default 64; 72 for the 144 px big-guy tier; 96 reserved). */
  frame?: number;
}

export interface PreparedWalkSheets {
  readonly generation: number;
  dispose(): void;
}

/** Read-only view of a moveTweens entry. */
export interface TweenView {
  token: Container;
  waypoints: { x: number; y: number }[];
  start: number;
  segmentMs: number;
  style: string;
  arc?: number;
  reconcileKey?: string;
  postStepCorrectionKey?: string;
}

export interface FacingGeometry {
  homeForward: { dx: number; dy: number };
  awayForward: { dx: number; dy: number };
}

/** Every member is a bound PitchRenderer method with that method's exact signature. */
export interface WalkerHelpers {
  addPositionRing(token: Container, player: PlayerJson, team: TeamJson, body: number, opts?: { centreY?: number; bodyRing?: boolean; rx?: number; ry?: number }): void;
  buildProneShadow(): Container;
  showStunMark(data: PlayerDataJson): boolean;
  addDownDecoration(token: Container, stunned: boolean, stunCaption: boolean, centreY?: number): void;
  addSkillBadges(
    token: Container,
    player: PlayerJson,
    data: PlayerDataJson,
    trim: number,
    team: TeamJson,
    baselineSkills?: Set<string>,
    badgeOccluded?: boolean,
  ): void;
  addMarkingText(token: Container, player: PlayerJson, down: boolean): void;
  applyActivationShading(token: Container, data: PlayerDataJson, isHome: boolean, strength: number): void;
  addPlayerNumber(token: Container, player: PlayerJson, isHome: boolean, down: boolean): void;
}

export interface WalkerTokenArgs {
  token: Container;
  walker: WalkerAsset;
  player: PlayerJson;
  team: TeamJson;
  isHome: boolean;
  down: boolean;
  data: PlayerDataJson;
  includeBadges: boolean;
  shading: boolean;
  baselineSkills?: Set<string>;
  badgeOccluded?: boolean;
  stunCaption: boolean;
  trim: number;
  body: number;
  ownerId: symbol;
  facing: FacingGeometry;
  helpers: WalkerHelpers;
}

export interface WalkSheetBindingTransport extends WalkSheetSpecTransport {
  teamId: string;
  positionId: string;
  side?: AssetSide;
  url: string;
}

/**
 * Owner 2026-09-04: bundled/pack walk sprites render at the SAME visual size as the FUMBBL classic icons.
 * Measured: a FUMBBL human body is ~25 px inside its ~30 px frame, drawn on the 36 px classic canvas
 * (PLAYER_SPRITE_BASE = TILE_W * 0.82) => ~31 px on screen. Our 64 px canvases carry a modal human figure of
 * 53 px (measured across the 180 bundled sheets). One FIXED scale (31/53) is applied to every sheet so the
 * art's own proportions survive (big guys stay bigger, halflings smaller), exactly as the classic path draws
 * every frame on the same canvas. Token-level Strength scaling composes on top for both paths.
 */
/** Owner 09-05 (round 15): figures FIT THE SQUARE again (the classic-icon parity, 31 px per modal 53-unit figure),
 *  but the art never lands on a fractional grid: snapWalker moves each sprite from this ideal onto the nearest
 *  CLEAN art->device ratio (1/4, 1/2, 1, 2, 3 ... — halves are exact box-average mip levels, wholes are exact
 *  magnifications). So at the fit zoom (2 screen px per world px) the 128 px art draws at 1:2 (53 px figures in an
 *  88 px square), at zoom 4 it is 1:1, at zoom 6 it is 2:1. */
export const WALKER_TARGET_FIGURE_PX = 31;
export const WALKER_REFERENCE_FIGURE_PX = 53;
export const WALKER_SPRITE_SCALE = WALKER_TARGET_FIGURE_PX / WALKER_REFERENCE_FIGURE_PX;
/** Prone keeps the static branch's 40:48 lying-to-standing ratio. */
/** Owner 09-05: a prone walker keeps the STANDING figure size (was 40/48 and an extra 0.8 squash — read too small). */
export const WALKER_PRONE_SCALE = WALKER_SPRITE_SCALE;
/** Owner 09-05: every player token sits with its base toward the BOTTOM of the square — an 11 px downward
 *  shift shared with the classic icons (renderer TOKEN_BASE_SHIFT_PX). Walker feet land at anchor.y + this. */
export const WALKER_FEET_Y_PX = 11;

/** Owner 09-06: fake-sun CAST SHADOW prototype. The sheets carry no height/normal data, so the walker's LIVE frame is
 *  drawn a second time under the sprite: black, translucent, feet-anchored, squashed onto the ground (`length` x the
 *  figure height) and sheared by `skew` rad. No filters — it shares the sprite's texture, so it walks, turns and
 *  snaps with the figure. Prone figures keep the soft glow only.
 *  Owner verdicts (09-06): length 0.55, alpha 0.35; the sun sits at the window's SE corner for the home seat, one
 *  per orientation (castDirection), and its screen quadrant comes from the projection (squareAnchor) so the
 *  spectator drive-north mirror reverses it for free. */
export const CAST_SHADOW = { skew: 0.6, length: 0.55, alpha: 0.35, proneOffset: 1.25 }; // owner 09-06: prone offset 5 -> 2.5 -> 1.25, tighter to the body
/** Owner 09-06 r3: weather scales the cast (length x, ink alpha) — very sunny = long and hard; sweltering heat = a
 *  high sun, short and hard; rain = short and faint; blizzard = overcast, snow-scattered light, shortest and faintest
 *  (owner to confirm). Keys = renderer pitchWeatherKey. */
export const CAST_SHADOW_WEATHER: Record<string, { length: number; alpha: number }> = {
  nice: { length: 1, alpha: 1 },
  sunny: { length: 1.35, alpha: 1.3 },
  heat: { length: 0.7, alpha: 1.3 },
  rain: { length: 0.55, alpha: 0.5 }, // owner 09-06: +5 points (0.45 -> 0.5)
  blizzard: { length: 0.45, alpha: 0.35 },
};
let castWeather = CAST_SHADOW_WEATHER.nice!;
/** The renderer feeds the match weather key (pitchWeatherKey); every live walker re-syncs at once. */
export function setWalkCastWeather(key: string): void {
  const next = CAST_SHADOW_WEATHER[key] ?? CAST_SHADOW_WEATHER.nice!;
  if (next === castWeather) return;
  castWeather = next;
  for (const record of liveWalkers.values()) { syncCastShadow(record); dirtyOwners.add(record.ownerId); }
}
/** Screen direction the shadow falls (unit signs), away from the sun corner. Owner 09-06 r5: ONE sun per
 *  orientation, each at the window's SOUTH-EAST corner as the home seat sees it — N-S: pitch corner (0, 14); E-W: its
 *  own light at pitch corner (25, 0), which that projection draws bottom-right (a world-fixed sun read wrong in E-W).
 *  Casts rise up-left in both; the spectator drive-north mirror reverses them through squareAnchor. */
function castDirection(): { ux: number; uy: number } {
  const ew = getOrientation() === 'ew';
  const sun = ew ? squareAnchor(PITCH_COLS - 1, 0) : squareAnchor(0, PITCH_ROWS - 1);
  const opposite = ew ? squareAnchor(0, PITCH_ROWS - 1) : squareAnchor(PITCH_COLS - 1, 0);
  return { ux: sun.x > opposite.x ? -1 : 1, uy: sun.y > opposite.y ? -1 : 1 };
}
/** Owner 09-06 r2: a PRONE figure lies flat, so its cast is the same frame (unsquashed, same rotation) offset
 *  `proneOffset` units (at figure scale 1) toward the shadow side — a low drop shadow, so it no longer reads flat
 *  against the standing casts. */
let castShadows = true;
/** Settings > Video toggle (settings.castShadows). Applies to every live walker at once. */
export function setWalkCastShadows(on: boolean): void {
  if (castShadows === on) return;
  castShadows = on;
  for (const record of liveWalkers.values()) {
    if (record.castShadow && !record.castShadow.destroyed) record.castShadow.visible = on;
    dirtyOwners.add(record.ownerId);
  }
}
export function walkCastShadowsEnabled(): boolean { return castShadows; }

const DIRECTIONS: readonly Dir8[] = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];
const directionIndex = new Map<Dir8, number>(DIRECTIONS.map((direction, index) => [direction, index]));

interface AssetRecord {
  asset: WalkerAsset;
  url: string;
  root: Texture;
  refs: number;
  retired: boolean;
}

interface PreparedInternal extends PreparedWalkSheets {
  assets: Map<string, WalkerAsset>;
  disposed: boolean;
  committed: boolean;
}

interface WalkerTokenRecord {
  /** Owner 09-05 motion tracking: last ticked token position, motion-window end, motion start (frame clock). */
  lastPos?: { x: number; y: number };
  movingUntil?: number | null;
  motionStart?: number | null;
  /** Owner 09-05: the sprite scale as built (WALKER_SPRITE_SCALE x visual [x prone]); the integer snap multiplies it. */
  baseSpriteScale?: number;
  /** Owner 09-05 (round 16): decorations (shadow, rings, badges, number, markings, stun mark) scale WITH the figure
   *  about its feet — their unscaled placement is captured here the first time each child is seen. */
  decorBase?: WeakMap<Container, { x: number; y: number; sx: number; sy: number; w: number }>;
  boundsBase?: Rectangle;
  decorScale?: number;
  /** y the decorations scale about: the feet line (standing) or the square centre (prone). */
  decorPivotY?: number;
  /** Owner 09-05 (round 8): this token draws from the exact-half sheet (its own art->device ratio snapped there). */
  useHalfSheet?: boolean;
  /** Owner 09-05: a tween that was live when the walker was force-settled (activation end / another player's
   *  action). It no longer counts as motion; a NEW tween object (a fresh move) lifts the hold. */
  settledTween?: TweenView | null;
  /** Owner 09-06: motion state at the previous tick — the settle edge (true -> false) lands the idle facing. */
  wasInMotion?: boolean;
  token: Container;
  asset: WalkerAsset;
  sprite: Sprite;
  /** Owner 09-06: the cast shadow — tracks the sprite's texture and scale, never decor scale. */
  castShadow?: Sprite;
  prone?: boolean;
  ownerId: symbol;
  playerId: string;
  isHome: boolean;
  facingGeometry: FacingGeometry;
  facing: Dir8;
}

let preparationGeneration = 0;
let activeAssets = new Map<string, WalkerAsset>();
const bundledAssets = new Map<string, WalkerAsset>();
const assetRecords = new Map<WalkerAsset, AssetRecord>();
const retiredAssets = new Set<WalkerAsset>();
const retiringUrls = new Map<string, Promise<void>>();
const retirementWaiters = new Set<() => void>();
let retirementFrameScheduled = false;
const walkerTokens = new WeakMap<Container, WalkerTokenRecord>();
const liveWalkers = new Map<Container, WalkerTokenRecord>();
const dirtyOwners = new Set<symbol>();
let walkAnimation = true;
let walkFps: number | null = null;
/** Owner 2026-09-04: idle walkers face the camera (screen-south) instead of their own end-zone forward vector. */
let walkFaceCamera = true; // owner 09-04: on by default (mirrors settings DEFAULTS)

function targetKey(teamId: string, positionId: string, side: AssetSide = 'any'): string {
  return `${teamId}\u0000${positionId}\u0000${side}`;
}

function bundledKey(race: string, role: string, side: 'home' | 'away' | 'any'): string {
  return `bundled\u0000${race}\u0000${role}\u0000${side}`;
}

/** Installed packs stay on the 64-unit grid (their native validator is 576x512); bundled sheets may use the 72-unit
 *  (144 px) big-guy tier (owner 09-06) or the reserved 96-unit tier. */
function validateSpec(entry: WalkSheetBindingTransport, allowedFrames: readonly number[] = [64]): ValidatedWalkSheetSpec {
  const frame = entry.frame;
  if (!Number.isInteger(frame) || !allowedFrames.includes(frame)) {
    throw new Error(`Invalid walk-sheet frame for ${entry.teamId}/${entry.positionId}`);
  }
  if (entry.idleColumn !== 0) throw new Error(`Invalid walk-sheet idle column for ${entry.teamId}/${entry.positionId}`);
  if (!Array.isArray(entry.rows) || entry.rows.length !== DIRECTIONS.length
    || new Set(entry.rows).size !== DIRECTIONS.length
    || entry.rows.some((row) => !directionIndex.has(row as Dir8))) {
    throw new Error(`Invalid walk-sheet rows for ${entry.teamId}/${entry.positionId}`);
  }
  if (!Number.isInteger(entry.columns) || entry.columns < 2 || entry.columns > 16) {
    throw new Error(`Invalid walk-sheet columns for ${entry.teamId}/${entry.positionId}`);
  }
  if (!Number.isInteger(entry.fps) || entry.fps < 1 || entry.fps > 30) {
    throw new Error(`Invalid walk-sheet fps for ${entry.teamId}/${entry.positionId}`);
  }
  const footY = entry.footY === undefined ? 61 : entry.footY;
  if (!Number.isInteger(footY) || footY < 1 || footY > frame - 1) {
    throw new Error(`Invalid walk-sheet foot row for ${entry.teamId}/${entry.positionId}`);
  }
  const visualScale = entry.visualScale === undefined ? 1 : entry.visualScale;
  if (!Number.isFinite(visualScale) || visualScale < 0.5 || visualScale > 2) {
    throw new Error(`Invalid walk-sheet visual scale for ${entry.teamId}/${entry.positionId}`);
  }
  return {
    frame,
    rows: [...entry.rows] as Dir8[],
    columns: entry.columns,
    idleColumn: 0,
    fps: entry.fps,
    footY,
    visualScale,
  };
}

/** Pixel size of one frame on this sheet (frame units x pixels-per-unit; 128 on the bundled 64-unit masters). */
function framePx(source: TextureSource, frame: number): number {
  const res = source.resolution || 1;
  return Math.max(1, Math.round(frame * res));
}

function sourcePixels(source: TextureSource, sourceRow: number, frame: number): Uint8ClampedArray | null {
  const px = framePx(source, frame);
  const resource = source.resource as {
    width?: number;
    height?: number;
    getContext?: (kind: string, options?: unknown) => CanvasRenderingContext2D | null;
  } | null;
  try {
    const direct = resource?.getContext?.('2d', { willReadFrequently: true });
    if (direct) return direct.getImageData(0, sourceRow * px, px, px).data;
    const Canvas = globalThis.OffscreenCanvas;
    if (Canvas && resource) {
      const canvas = new Canvas(px, px);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        context.drawImage(resource as CanvasImageSource, 0, sourceRow * px, px, px, 0, 0, px, px);
        return context.getImageData(0, 0, px, px).data;
      }
    }
    if (typeof document !== 'undefined' && resource) {
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        context.drawImage(resource as CanvasImageSource, 0, sourceRow * px, px, px, 0, 0, px, px);
        return context.getImageData(0, 0, px, px).data;
      }
    }
  } catch {
    // Native validation guarantees the image. A non-readable source only loses
    // transparent-margin compensation; it never weakens the transport checks.
  }
  return null;
}

export interface FigureMetrics { height: number; width: number; feetWidth: number }
/** Figure metrics of the S idle frame in 64-UNIT space: height, widest span, and the span of the bottom ~8% of the
 *  figure (the FEET). The standing ring/shadow is keyed to the feet, the prone ring to height x width. */
function measureFigure(source: TextureSource, sourceRow: number, frame = 64): FigureMetrics {
  const fallback = { height: 50, width: 34, feetWidth: 24 };
  const pixels = sourcePixels(source, sourceRow, frame);
  if (!pixels) return fallback;
  const px = framePx(source, frame);
  const res = source.resolution || 1;
  let top = px, bottom = -1, left = px, right = -1;
  const rowMin = new Int32Array(px).fill(px), rowMax = new Int32Array(px).fill(-1);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      if (pixels[(y * px + x) * 4 + 3]! > 0) {
        top = Math.min(top, y); bottom = Math.max(bottom, y);
        left = Math.min(left, x); right = Math.max(right, x);
        rowMin[y] = Math.min(rowMin[y]!, x); rowMax[y] = Math.max(rowMax[y]!, x);
      }
    }
  }
  if (bottom < top) return fallback;
  const height = bottom - top + 1;
  const feetRows = Math.max(2, Math.round(height * 0.08));
  let fl = px, fr = -1;
  for (let y = bottom - feetRows + 1; y <= bottom; y++) { if (rowMax[y]! >= 0) { fl = Math.min(fl, rowMin[y]!); fr = Math.max(fr, rowMax[y]!); } }
  const feet = fr >= fl ? fr - fl + 1 : right - left + 1;
  return { height: Math.round(height / res), width: Math.round((right - left + 1) / res), feetWidth: Math.round(feet / res) };
}
function measureFigureHeight(source: TextureSource, sourceRow: number, frame = 64): number {
  return measureFigure(source, sourceRow, frame).height;
}
function figureFields(m: FigureMetrics): { figureHeight: number; figureWidth: number; feetWidth: number } {
  return { figureHeight: m.height, figureWidth: m.width, feetWidth: m.feetWidth };
}

/** Owner 09-05 (round 3): sampling follows the EFFECTIVE on-screen scale — NEAREST when the sheet is magnified (hi-DPI
 *  canvas / zoomed in: crisp pixel art), LINEAR when minified (a 1x canvas: bilinear keeps the edge from dropping
 *  pixels). The renderer calls setWalkSheetSampling every frame with the mode it needs; flips are cheap. */
let sheetSampling: 'nearest' | 'linear' = 'nearest'; // 09-05: pixel art — nearest from the first upload
/** Owner 09-05: when the effective on-screen scale is near the display sheets' 37/64, draw THOSE (1:1, nearest);
 *  the renderer flips this per frame from resolution x zoom. */
let useDisplaySheets = false;
/** Owner 09-05 (round 5): integer SNAP — the renderer picks the sheet whose art->device ratio is closest to a whole
 *  number and nudges the sprite scale onto that integer (<= ~12%), so nearest sampling never doubles every other
 *  pixel row (the 'uneven' look at 200%). 1 = no snap. */
let spriteSnap = 1;
export function setWalkDisplaySheets(on: boolean): void {
  if (on === useDisplaySheets) return;
  useDisplaySheets = on;
  for (const record of liveWalkers.values()) dirtyOwners.add(record.ownerId);
}
export function setWalkSpriteSnap(factor: number): void {
  const next = Number.isFinite(factor) && factor > 0 ? factor : 1;
  if (Math.abs(next - spriteSnap) < 1e-4) return;
  spriteSnap = next;
  for (const record of liveWalkers.values()) {
    if (record.baseSpriteScale && !record.sprite.destroyed) record.sprite.scale.set(record.baseSpriteScale * spriteSnap);
    syncCastShadow(record);
    dirtyOwners.add(record.ownerId);
  }
}
export function walkSpriteSnap(): number { return spriteSnap; }
export function walkDisplaySheetsActive(): boolean { return useDisplaySheets; }
function framesOf(asset: WalkerAsset, useHalf = useDisplaySheets): Texture[][] {
  return useHalf && asset.displayFrames ? asset.displayFrames : asset.frames;
}
export function setWalkSheetSampling(mode: 'nearest' | 'linear'): void {
  if (mode === sheetSampling) return;
  sheetSampling = mode;
  for (const asset of [...activeAssets.values(), ...bundledAssets.values()]) {
    asset.sheet.scaleMode = mode;
    // Pixi 8.19: the scaleMode setter assigns the filters WITHOUT emitting the style change, so the GPU sampler
    // would keep the old state — push the update explicitly (review finding 09-05).
    asset.sheet.style.update();
  }
}
export function walkSheetSampling(): 'nearest' | 'linear' { return sheetSampling; }

function buildFrames(root: Texture, spec: ValidatedWalkSheetSpec): Texture[][] {
  // Owner 09-05: the sheets are 1-bit alpha (no soft edge in the art) and draw MINIFIED (53 px reference ->
  // 31 px on the square, x depth). Nearest sampling at ~0.58x drops or keeps whole edge pixels -> harsh
  // stair-stepped silhouettes against the turf. Linear + mipmaps average the edge with its transparent
  // neighbour, which is the anti-aliasing the art itself does not carry.
  root.source.scaleMode = sheetSampling;
  // Owner 09-05 (round 14): the bundled sheets are now the 128 px PixelLab MASTERS (the old 64 px sheets were
  // nearest-neighbour decimations: 3 of every 4 art pixels gone). The sheet keeps the 64-UNIT frame grid through
  // source.resolution (pixel / logical = 2), so every layout constant (footY, feet, bounds) stays in 64-space and
  // one art pixel is HALF a world pixel. The camera lands on even world scales (2, 4, 6 -> 1:1, 2:1, 3:1) and
  // below that the sampler's mip levels are exact 2x2 / 4x4 box averages (nearest mipmapFilter at LOD 1 / 2).
  const unit = root.source.pixelWidth / (spec.columns * spec.frame);
  if (Number.isInteger(unit) && unit >= 1 && root.source.resolution !== unit) root.source.resolution = unit;
  root.source.autoGenerateMipmaps = unit > 1;
  const frames = DIRECTIONS.map(() => [] as Texture[]);
  for (let sourceRow = 0; sourceRow < spec.rows.length; sourceRow++) {
    const targetRow = directionIndex.get(spec.rows[sourceRow]!)!;
    for (let column = 0; column < spec.columns; column++) {
      frames[targetRow]!.push(new Texture({
        source: root.source,
        frame: new Rectangle(column * spec.frame, sourceRow * spec.frame, spec.frame, spec.frame),
      }));
    }
  }
  return frames;
}

function destroyFrameHandles(asset: WalkerAsset): void {
  for (const row of asset.frames) for (const frame of row) if (!frame.destroyed) frame.destroy(false);
  for (const row of asset.displayFrames ?? []) for (const frame of row) if (!frame.destroyed) frame.destroy(false);
}

function urlStillOwned(url: string): boolean {
  for (const record of assetRecords.values()) if (record.url === url) return true;
  return false;
}

function retireUrl(url: string): void {
  if (urlStillOwned(url) || retiringUrls.has(url)) return;
  const retiring = Assets.unload(url)
    .catch(() => { /* best effort after all client handles have retired */ })
    .finally(() => {
      retiringUrls.delete(url);
      resolveRetirementWaiters();
    });
  retiringUrls.set(url, retiring);
}

function pruneRetiredAssets(): void {
  const urls = new Set<string>();
  for (const asset of [...retiredAssets]) {
    const record = assetRecords.get(asset);
    if (!record || record.refs > 0 || !record.retired) continue;
    retiredAssets.delete(asset);
    assetRecords.delete(asset);
    destroyFrameHandles(asset);
    urls.add(record.url);
  }
  for (const url of urls) retireUrl(url);
}

function retirementIdle(): boolean {
  return !retirementFrameScheduled && retiredAssets.size === 0 && retiringUrls.size === 0;
}

function resolveRetirementWaiters(): void {
  if (!retirementIdle()) return;
  for (const resolve of retirementWaiters) resolve();
  retirementWaiters.clear();
}

function scheduleRetirement(): void {
  if (retirementFrameScheduled || !retiredAssets.size) {
    resolveRetirementWaiters();
    return;
  }
  if (typeof requestAnimationFrame !== 'function') {
    pruneRetiredAssets();
    resolveRetirementWaiters();
    return;
  }
  retirementFrameScheduled = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    retirementFrameScheduled = false;
    pruneRetiredAssets();
    resolveRetirementWaiters();
  }));
}

function disposePrepared(prepared: PreparedInternal): void {
  if (prepared.disposed || prepared.committed) return;
  prepared.disposed = true;
  for (const asset of prepared.assets.values()) {
    const record = assetRecords.get(asset);
    if (!record) continue;
    record.retired = true;
    retiredAssets.add(asset);
  }
  prepared.assets.clear();
  scheduleRetirement();
}

export async function prepareWalkSheets(
  entries: WalkSheetBindingTransport[],
  generation: number,
): Promise<PreparedWalkSheets> {
  preparationGeneration = generation;
  const validated = entries.map((entry) => ({ entry, spec: validateSpec(entry) }));
  const targets = new Set<string>();
  for (const { entry } of validated) {
    if (!entry.teamId || !entry.positionId || !entry.url) throw new Error('Invalid walk-sheet binding target');
    const key = targetKey(entry.teamId, entry.positionId, entry.side ?? 'any');
    if (targets.has(key)) throw new Error(`Duplicate walk-sheet target ${entry.teamId}/${entry.positionId}`);
    targets.add(key);
  }

  const loadResults = await Promise.allSettled(validated.map(({ entry }) =>
    Assets.load<Texture>({ src: entry.url, parser: 'loadTextures' })));
  const assets = new Map<string, WalkerAsset>();
  const prepared: PreparedInternal = {
    generation,
    assets,
    disposed: false,
    committed: false,
    dispose() { disposePrepared(prepared); },
  };
  try {
    const failed = loadResults.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    for (let index = 0; index < validated.length; index++) {
      const { entry, spec } = validated[index]!;
      const root = (loadResults[index] as PromiseFulfilledResult<Texture>).value;
      if (!(root instanceof Texture) || !root.source) throw new Error('Installed walk-sheet texture could not be decoded');
      const key = targetKey(entry.teamId, entry.positionId, entry.side ?? 'any');
      const asset: WalkerAsset = {
        key,
        sheet: root.source,
        frames: buildFrames(root, spec),
        spec,
        ...figureFields(measureFigure(root.source, spec.rows.indexOf('S'), spec.frame)),
      };
      assets.set(key, asset);
      assetRecords.set(asset, { asset, url: entry.url, root, refs: 0, retired: false });
    }
    return prepared;
  } catch (error) {
    disposePrepared(prepared);
    const loadedUrls = validated
      .filter((_, index) => loadResults[index]?.status === 'fulfilled')
      .map(({ entry }) => entry.url);
    for (const url of new Set(loadedUrls)) retireUrl(url);
    throw error;
  }
}

/** Owner 09-05 (round 15): bundled sheets load INCREMENTALLY, per sheet — the renderer asks for the two rosters of
 *  the current game (bundledWalkEntriesForRaces) instead of all 326 masters (1.5 GB decoded; it starved later
 *  texture uploads and broke the pack hot-swap). Sheets already loaded or in flight are reused; a failed sheet is
 *  retried on the next request. Identical in-flight requests share one promise. */
const bundledPending = new Map<string, Promise<void>>();
const bundledRequests = new Map<string, Promise<void>>();

export function loadBundledWalkSheets(entries: BundledWalkEntry[]): Promise<void> {
  const validated = entries.map((entry) => ({
    entry,
    key: bundledKey(entry.race, entry.role, entry.side),
    spec: validateSpec({
      teamId: `bundled:${entry.race}`,
      positionId: entry.role,
      side: entry.side,
      url: entry.url,
      frame: entry.frame ?? 64,
      rows: entry.rows,
      columns: entry.columns,
      idleColumn: 0,
      fps: entry.fps,
      footY: entry.footY,
      visualScale: entry.visualScale,
    }, [64, 72, 96]), // owner 09-06: 72 = the 144 px big-guy masters (1.125x the figure, same grid)
  }));
  const targets = new Set<string>();
  for (const { entry, key } of validated) {
    if (!entry.race || !entry.role || !entry.url || targets.has(key)) {
      throw new Error(`Invalid bundled walk-sheet target ${entry.race}/${entry.role}/${entry.side}`);
    }
    targets.add(key);
  }
  const requestKey = [...targets].sort().join('\n');
  const shared = bundledRequests.get(requestKey);
  if (shared) return shared;

  const todo = validated.filter(({ key }) => !bundledAssets.has(key) && !bundledPending.has(key));
  const waits = validated.map(({ key }) => bundledPending.get(key)).filter((p): p is Promise<void> => !!p);
  const batch = todo.length === 0 ? Promise.resolve() : Promise.allSettled(
    todo.map(({ entry }) => Assets.load<Texture>({ src: entry.url, parser: 'loadTextures' })),
  ).then((loadResults) => {
    for (let index = 0; index < todo.length; index++) {
      const { entry, spec, key } = todo[index]!;
      const result = loadResults[index]!;
      try {
        if (result.status === 'rejected') throw result.reason;
        const root = result.value;
        if (!(root instanceof Texture) || !root.source) {
          throw new Error('Bundled walk-sheet texture could not be decoded');
        }
        const asset: WalkerAsset = {
          key: `bundled ${entry.race} ${entry.role} ${entry.side}`,
          sheet: root.source,
          frames: buildFrames(root, spec),
          spec,
          ...figureFields(measureFigure(root.source, spec.rows.indexOf('S'), spec.frame)),
        };
        bundledAssets.set(key, asset);
        assetRecords.set(asset, { asset, url: entry.url, root, refs: 0, retired: false });
      } catch (error) {
        console.warn(`Bundled walk sheet failed: ${entry.race}/${entry.role}/${entry.side}`, error);
      } finally {
        bundledPending.delete(key);
      }
    }
  });
  for (const { key } of todo) bundledPending.set(key, batch);
  const all = Promise.all([batch, ...waits]).then(() => undefined);
  bundledRequests.set(requestKey, all);
  void all.finally(() => { if (bundledRequests.get(requestKey) === all) bundledRequests.delete(requestKey); });
  return all;
}

export function bundledWalkSheetFor(
  race: string,
  positionName: string | undefined,
  side: 'home' | 'away',
): WalkerAsset | undefined {
  const target = resolveBundledWalkRole(race, positionName);
  if (!target) return undefined;
  // Two-kit races bind home/away; single-kit races bind 'any' and serve both sides.
  return bundledAssets.get(bundledKey(target.race, target.role, side))
    ?? bundledAssets.get(bundledKey(target.race, target.role, 'any'));
}

export function bundledWalkSheetsReady(): boolean {
  return bundledAssets.size > 0;
}

export function commitWalkSheets(value: PreparedWalkSheets): void {
  const prepared = value as PreparedInternal;
  if (!prepared || prepared.disposed || prepared.committed) return;
  if (prepared.generation !== preparationGeneration) {
    prepared.dispose();
    return;
  }
  const previous = activeAssets;
  activeAssets = prepared.assets;
  prepared.assets = new Map();
  prepared.committed = true;
  for (const asset of activeAssets.values()) {
    const record = assetRecords.get(asset);
    if (record) record.retired = false;
  }
  for (const asset of previous.values()) {
    if ([...activeAssets.values()].includes(asset)) continue;
    const record = assetRecords.get(asset);
    if (!record) continue;
    record.retired = true;
    retiredAssets.add(asset);
  }
  scheduleRetirement();
}

export function clearWalkSheets(): void {
  preparationGeneration++;
  const previous = activeAssets;
  activeAssets = new Map();
  for (const asset of previous.values()) {
    const record = assetRecords.get(asset);
    if (!record) continue;
    record.retired = true;
    retiredAssets.add(asset);
  }
  scheduleRetirement();
}

export async function waitForWalkSheetRetirement(): Promise<void> {
  scheduleRetirement();
  if (retirementIdle()) return;
  await new Promise<void>((resolve) => retirementWaiters.add(resolve));
}

export function walkSheetFor(
  teamId: string,
  positionId: string,
  side: Exclude<AssetSide, 'any'> | undefined,
  race: string,
): WalkerAsset | undefined {
  const raceTarget = race ? `race:${race.toLowerCase().replace(/[^a-z0-9]/g, '')}` : '';
  // Owner 09-07: ruleset-tagged roster names also try the plain race's pack bindings (after the exact ones).
  const plainRace = race ? rosterRaceKey(race) : '';
  const plainTarget = plainRace && `race:${plainRace}` !== raceTarget ? `race:${plainRace}` : '';
  const candidates = [
    side ? targetKey(teamId, positionId, side) : '',
    targetKey(teamId, positionId, 'any'),
    side && raceTarget ? targetKey(raceTarget, positionId, side) : '',
    raceTarget ? targetKey(raceTarget, positionId, 'any') : '',
    side && plainTarget ? targetKey(plainTarget, positionId, side) : '',
    plainTarget ? targetKey(plainTarget, positionId, 'any') : '',
  ].filter(Boolean);
  for (const key of candidates) {
    const asset = activeAssets.get(key);
    if (asset) return asset;
  }
  return undefined;
}

function defaultFacing(isHome: boolean, geometry: FacingGeometry, previous: Dir8): Dir8 {
  if (walkFaceCamera) return 'S'; // toward the camera = screen-south under every orientation/flip
  const forward = isHome ? geometry.homeForward : geometry.awayForward;
  return dir8(forward.dx, forward.dy, previous);
}

function releaseAsset(asset: WalkerAsset): void {
  const record = assetRecords.get(asset);
  if (!record) return;
  record.refs = Math.max(0, record.refs - 1);
  if (record.retired && record.refs === 0) scheduleRetirement();
}

/** Owner 2026-09-04: the FUMBBL classic icons carry a baked foot shadow; the generated sheets have none, so a
 *  standing walker gets a flattened ground ellipse under its feet (same ink as the prone shadow, smaller). */
/** `k` = the figure's size relative to the 53 px reference (owner 09-05: a Strength-1 snotling wore a lineman's
 *  shadow — both shadows now follow the figure). */
/** Owner 09-05 (round 17, annotated example): STANDING — the ring/shadow sits on the feet line, only slightly wider
 *  than the FEET (x1.15), flat (ry = rx/2). PRONE — the ring surrounds the lying body (length = figure height,
 *  thickness = figure width, x1.08) and its interior is shaded. All in units at decor scale 1. */
export function walkerRingGeometry(walker: Pick<WalkerAsset, 'figureHeight' | 'figureWidth' | 'feetWidth' | 'spec'>, down: boolean): { cx: number; cy: number; rx: number; ry: number } {
  const visual = walker.spec.visualScale;
  if (down) {
    const length = walker.figureHeight * visual;
    const thick = (walker.figureWidth ?? walker.figureHeight * 0.62) * visual;
    // ring hugs the lying body (owner 09-05 round 18), centred on the SQUARE; owner 09-06: diameter reduced 33%
    const k = 0.67;
    return { cx: 0, cy: 0, rx: length * 0.5 * k, ry: Math.max(thick * 0.5, length * 0.4) * k };
  }
  // Owner 09-05 (round 20): wide-rooted models (treemen 49u) read as a disc at 1.15x — ring now 1.05x the feet, flatter
  const feet = (walker.feetWidth ?? walker.figureHeight * 0.5) * visual;
  const rx = Math.max(6, feet * 0.525); // half the feet span x 1.05
  return { cx: 0, cy: WALKER_FEET_Y_PX - 1, rx, ry: rx * 0.42 };
}

function buildGroundShadow(g: { cx: number; cy: number; rx: number; ry: number }): Graphics {
  const shadow = new Graphics()
    .ellipse(g.cx, g.cy, g.rx, g.ry)
    .fill({ color: 0x000000, alpha: 0.25 }); // owner 09-05: 0.28 -> 0.5 -> 0.7; owner 09-06: 0.25 — the cast shadow carries the figure now, this is just a shaded contact patch
  shadow.label = 'groundShadow';
  return shadow;
}

/** Owner 09-05 (round 18): NO prone shadow ellipse — a small soft GLOW instead, darkening the ground right around the
 *  lying figure and fading out (stacked ellipses inside the body ring, densest at the body). */
function buildProneShadow(g: { cx: number; cy: number; rx: number; ry: number }): Graphics {
  const glow = new Graphics();
  for (const [k, alpha] of [[1.0, 0.08], [0.88, 0.1], [0.76, 0.12], [0.64, 0.14], [0.52, 0.16]] as [number, number][]) {
    glow.ellipse(g.cx, g.cy, g.rx * k, g.ry * k).fill({ color: 0x000000, alpha });
  }
  glow.label = 'proneShadow';
  return glow;
}

/** True for a token built by buildWalkerToken (the renderer uses it to place the carried ball at the walker's
 *  visual centre — walkers anchor at the FEET, classic sprites at the body centre). */
export function isWalkerToken(token: Container): boolean {
  return walkerTokens.has(token);
}

export function buildWalkerToken(args: WalkerTokenArgs): Container {
  const {
    token, walker, player, team, isHome, down, data, includeBadges, shading,
    baselineSkills, badgeOccluded, stunCaption, trim, body, ownerId, facing, helpers,
  } = args;
  const initialFacing = travelFacing.get(player.playerId) ?? defaultFacing(isHome, facing, 'S');
  const row = directionIndex.get(initialFacing)!;
  // Owner 09-05: the POSITION ring stays (at the feet, under the ground shadow); only the inner team-colour body
  // ring is dropped on walkers — the kits already carry the team colour, and it cut the figure at the waist.
  // Owner 09-05: blitzer-class sheets carry a visual scale (mass parity with the Skaven Blitzer); feet stay planted.
  const visual = walker.spec.visualScale;
  // Owner 09-05 (round 17): the ring and the shadow share ONE ellipse — standing: on the feet line, slightly wider
  // than the feet; prone: around the lying body, interior shaded.
  const ringGeo = walkerRingGeometry(walker, down);
  helpers.addPositionRing(token, player, team, body, { centreY: ringGeo.cy, bodyRing: false, rx: ringGeo.rx, ry: ringGeo.ry });
  if (down) token.addChild(buildProneShadow(ringGeo));
  else token.addChild(buildGroundShadow(ringGeo));
  const sprite = new Sprite(framesOf(walker)[row]![walker.spec.idleColumn]!);
  if (down) {
    const scale = WALKER_PRONE_SCALE * visual;
    sprite.anchor.set(0.5, 0.5);
    sprite.scale.set(scale, scale); // no squash: same visual size as the standing token
    sprite.rotation = Math.PI / 2; // owner 09-05: head to the RIGHT, matching the classic prone pose (renderer.ts classic path)
    sprite.position.set(0, 0); // owner 09-05 (round 17): the prone figure is CENTRED in its square
  } else {
    const scale = WALKER_SPRITE_SCALE * visual;
    // anchor ON the foot row, so the integer snap rescales the figure about its feet (they never drift)
    sprite.anchor.set(0.5, (walker.spec.footY + 1) / walker.spec.frame);
    sprite.scale.set(scale);
    sprite.position.set(0, WALKER_FEET_Y_PX);
  }
  // Owner 09-06: cast shadow UNDER the figure (above the ground ellipse / prone glow), sharing the live frame texture.
  const castShadow = new Sprite(sprite.texture);
  castShadow.label = 'castShadow';
  castShadow.tint = 0x000000;
  castShadow.alpha = CAST_SHADOW.alpha;
  castShadow.anchor.copyFrom(sprite.anchor);
  castShadow.rotation = sprite.rotation;
  castShadow.position.copyFrom(sprite.position);
  castShadow.visible = castShadows;
  token.addChild(castShadow);
  token.addChild(sprite);
  // Owner 09-05: overhead decorations (skill/SPP badges, active marker, injury cards) anchor on the token's
  // local bounds. A walker's bounds were the whole 64px frame, whose transparent padding floated them well
  // above the head. Pin the bounds to the FIGURE instead (feet -> head top; prone: the lying figure).
  // Owner 09-05 (round 19): bounds (and everything the helpers place from them — skill badges, acted tick, active
  // marker) are laid out in DECOR-1 space (the full-size figure); applyDecorScale then scales them WITH the figure.
  // Using the drawn scale here double-scaled the badges into the torso.
  const figureH = walker.figureHeight * visual;
  const figureW = Math.max(12, Math.round(figureH * 0.62));
  if (down) token.boundsArea = new Rectangle(-figureH / 2, -figureW * 0.4, figureH, figureW * 0.8);
  else token.boundsArea = new Rectangle(-figureW / 2, sprite.position.y - figureH, figureW, figureH);
  // Owner 09-05: the stun X is centred on the PRONE FIGURE (its sprite sits at WALKER_FEET_Y_PX-9), not the
  // classic icon's body centre.
  if (down && helpers.showStunMark(data)) helpers.addDownDecoration(token, true, stunCaption, 0);
  helpers.addPlayerNumber(token, player, isHome, down);
  if (includeBadges) helpers.addSkillBadges(token, player, data, trim, team, baselineSkills, badgeOccluded);
  helpers.addMarkingText(token, player, down);
  if (shading) helpers.applyActivationShading(token, data, isHome, player.strength);

  // Ref acquisition is deliberately the last construction step.
  const assetRecord = assetRecords.get(walker);
  if (!assetRecord) throw new Error('Walk-sheet asset is no longer available');
  const record: WalkerTokenRecord = {
    token,
    asset: walker,
    sprite,
    castShadow,
    prone: down,
    baseSpriteScale: sprite.scale.x, // 09-05: integer snap multiplies this
    decorBase: new WeakMap(),
    decorPivotY: down ? 0 : WALKER_FEET_Y_PX,
    boundsBase: token.boundsArea ? token.boundsArea.clone() : undefined,
    ownerId,
    playerId: player.playerId,
    isHome,
    facingGeometry: facing,
    facing: initialFacing,
  };
  walkerTokens.set(token, record);
  syncCastShadow(record);
  applyDecorScale(record, sprite.scale.x); // decorations start at the figure's own scale (fg proportions)
  const previousDestroy = token.destroy.bind(token);
  let destroyed = false;
  token.destroy = ((options?: Parameters<Container['destroy']>[0]) => {
    if (destroyed) return;
    destroyed = true;
    liveWalkers.delete(token);
    walkerTokens.delete(token);
    try {
      previousDestroy(options);
    } finally {
      releaseAsset(walker);
    }
  }) as Container['destroy'];
  assetRecord.refs++;
  return token;
}

export function registerLiveWalker(token: Container): void {
  if (liveWalkers.has(token)) return;
  const record = walkerTokens.get(token);
  if (!record || token.destroyed) return;
  liveWalkers.set(token, record);
  if (record.baseSpriteScale && spriteSnap !== 1) record.sprite.scale.set(record.baseSpriteScale * spriteSnap);
  dirtyOwners.add(record.ownerId);
}

/** Owner 09-06: a camera zoom change dirties EVERY live walker so the next ticker pass re-snaps sprites AND
 *  decorations at once — idle tokens were skipping the tick and held the old scale until something else woke them
 *  (badges read huge for a moment after zooming in). */
export function markWalkersDirty(): void {
  for (const record of liveWalkers.values()) dirtyOwners.add(record.ownerId);
}

export function walkersNeedTick(ownerId: symbol): boolean {
  return dirtyOwners.has(ownerId);
}

/** Owner 09-05: a walker counts as moving for this long after its token last changed position. */
const MOTION_HOLD_MS = 120;

/** Owner 09-05: a walker keeps its direction of TRAVEL across token rebuilds until its activation ends; then the
 *  idle facing resets (face-camera / forward). playerId -> last motion-derived facing. */
const travelFacing = new Map<string, Dir8>();

/** Owner 09-06: the ACTIVE player per renderer owner. Only the active walker keeps its travel facing while it
 *  pauses; every other walker settles back to the idle facing the moment its motion stops (see tickWalkers). */
const activeWalkerByOwner = new Map<symbol, string | null>();

/** Owner 09-06: the renderer's activation signal. The activation-end reset (resetWalkerFacing) lands at the wire
 *  signal, but the last tile / follow-up / hit-and-run tween is often still moving the token at that instant and
 *  the motion re-derives the facing afterwards — so the idle facing must also land when the motion SETTLES. */
export function setActiveWalkerPlayer(ownerId: symbol, playerId: string | null): void {
  if (playerId == null) activeWalkerByOwner.delete(ownerId); else activeWalkerByOwner.set(ownerId, playerId);
}

function validGroundTween(record: WalkerTokenRecord, key: string, tween: TweenView | undefined): tween is TweenView {
  return key !== '__ball__'
    && tween?.token === record.token
    && tween.arc == null
    && !tween.reconcileKey
    && !tween.postStepCorrectionKey
    && tween.waypoints.length >= 2
    && tween.segmentMs > 0;
}

/** A tween whose travel time has elapsed AND whose token already sits on its last waypoint has ARRIVED; it may
 *  still be in the map (presentation step not yet consumed) but it is no longer motion. */
/** Owner 09-05 (round 3): a tween whose travel time elapsed this long ago is STALE whatever the token position says
 *  (a projection nudge or a rebuild can leave the token a pixel off its last waypoint forever). 1.5 s clears every
 *  legitimate frame-cycling test contract (a 100 ms tween still wraps its 8th column at 800 ms). */
const STALE_TWEEN_GRACE_MS = 1500;

function tweenArrived(tween: TweenView, now: number, x: number, y: number): boolean {
  const total = (tween.waypoints.length - 1) * tween.segmentMs;
  if (now - tween.start <= total) return false;
  if (now - tween.start > total + STALE_TWEEN_GRACE_MS) return true; // stale: no longer motion, wherever the token sits
  const end = tween.waypoints[tween.waypoints.length - 1]!;
  return Math.abs(end.x - x) < 0.5 && Math.abs(end.y - y) < 0.5;
}

function setWalkerFrame(record: WalkerTokenRecord, column: number): void {
  const row = directionIndex.get(record.facing)!;
  const texture = framesOf(record.asset, record.useHalfSheet ?? useDisplaySheets)[row]?.[column];
  if (texture && record.sprite.texture !== texture) record.sprite.texture = texture;
  syncCastShadow(record);
}

/** Owner 09-06: the cast shadow follows the sprite exactly — same frame, same drawn scale (so the integer snap and
 *  the free-rung exemption apply to it too), squashed by the weather-scaled length. With the anchor on the feet the
 *  head end lands at (-h sin(skew) sy, -h cos(skew) sy), so the cast falls along (ux, uy) when sy = -uy x length and
 *  skew = ux x uy x CAST_SHADOW.skew. Prone: same pose, offset a few units along (ux, uy) instead. */
function syncCastShadow(record: WalkerTokenRecord): void {
  const shadow = record.castShadow;
  if (!shadow || shadow.destroyed || record.sprite.destroyed) return;
  if (shadow.texture !== record.sprite.texture) shadow.texture = record.sprite.texture;
  const { ux, uy } = castDirection();
  const alpha = Math.min(1, CAST_SHADOW.alpha * castWeather.alpha);
  if (Math.abs(shadow.alpha - alpha) > 1e-6) shadow.alpha = alpha;
  const sx = record.sprite.scale.x;
  if (record.prone) {
    const k = (CAST_SHADOW.proneOffset * castWeather.length * sx) / WALKER_SPRITE_SCALE;
    const px = record.sprite.position.x + ux * k * Math.sin(CAST_SHADOW.skew);
    const py = record.sprite.position.y + uy * k * Math.cos(CAST_SHADOW.skew);
    if (Math.abs(shadow.scale.x - sx) > 1e-6 || Math.abs(shadow.scale.y - record.sprite.scale.y) > 1e-6) shadow.scale.set(sx, record.sprite.scale.y);
    if (Math.abs(shadow.position.x - px) > 1e-6 || Math.abs(shadow.position.y - py) > 1e-6) shadow.position.set(px, py);
    return;
  }
  const sy = -uy * record.sprite.scale.y * CAST_SHADOW.length * castWeather.length;
  const skew = ux * uy * CAST_SHADOW.skew;
  if (Math.abs(shadow.scale.x - sx) > 1e-6 || Math.abs(shadow.scale.y - sy) > 1e-6) shadow.scale.set(sx, sy);
  if (Math.abs(shadow.skew.x - skew) > 1e-6) shadow.skew.x = skew;
}

/** Owner 09-05 (round 8): PER-TOKEN integer snap. `deviceScale` = canvas resolution x camera zoom; each token's
 *  own scale (depth x Strength tier) is folded in, so a Tomb Guardian at 1.24 or a far row at 0.9 still lands on a
 *  clean box: native sheet at r:1, or the exact-half sheet at r:1 (half-art steps), whichever is nearer a whole
 *  ratio. The sprite scale is nudged onto that integer (bounded by the half-step granularity, <= ~17%). */
/** Owner 09-05 (round 16): decorations keep the proportions they had against the FULL-size figure (decor 1 = sprite
 *  scale 1). Every non-sprite child scales by the sprite's drawn scale about the feet (WALKER_FEET_Y_PX), so the
 *  shadow, position ring, skill badges, number, markings and stun mark track the figure at every zoom step. */
const SKILL_BADGE_FIT_SCALE = 0.65; // badge scale at decor 0.5 (the fit zoom)
type DecorBase = { x: number; y: number; sx: number; sy: number; w: number };
/** The decoration scale multiplier for one token child at figure decor scale f: skill badges grow slower than the
 *  figure and their row never exceeds one tile width; everything else follows the figure exactly. */
function decorChildScale(child: Container, b: DecorBase, f: number): number {
  let fs = child.label === 'skillBadges' ? SKILL_BADGE_FIT_SCALE * Math.pow(f / 0.5, SKILL_BADGE_GROWTH) : f;
  if (child.label === 'skillBadges' && b.w > 0) fs = Math.min(fs, TILE_W / (b.w * b.sx)); // owner 09-06: row <= one tile
  return fs;
}

/** Owner 09-06: the renderer's overlay-scale pass (updateOverlayScales) used to overwrite a walker child's scale with
 *  the camera factor, undoing the decoration scale until the next walker tick (badges ballooned on a wheel attempt
 *  at max zoom). For a walker token's child it now asks HERE for the authoritative absolute scale; null = not a
 *  walker child (the caller keeps its own rule). */
export function walkerChildScale(token: Container, child: Container): { x: number; y: number } | null {
  const record = walkerTokens.get(token);
  if (!record || child === record.sprite || child === record.castShadow) return null;
  const b = record.decorBase?.get(child);
  if (!b) return null; // not yet captured: the next tick captures it at the current scale
  const f = record.decorScale ?? record.sprite.scale.x;
  const fs = decorChildScale(child, b, f);
  return { x: b.sx * fs, y: b.sy * fs };
}
const SKILL_BADGE_GROWTH = 0.4; // exponent vs the figure's growth (1 = proportional)
function applyDecorScale(record: WalkerTokenRecord, f: number): void {
  if (!Number.isFinite(f) || f <= 0) return;
  const base = record.decorBase ?? (record.decorBase = new WeakMap());
  const py = record.decorPivotY ?? WALKER_FEET_Y_PX;
  for (const child of record.token.children) {
    if (child === record.sprite || child === record.castShadow) continue; // the shadow tracks the sprite (syncCastShadow)
    let b = base.get(child);
    if (!b) {
      // a child added AFTER the first pass (acted tick, active marker) is already at the current decor scale —
      // store its decor-1 placement by un-applying that scale
      const cur = record.decorScale ?? 1;
      // w = the child's own (unscaled) width, so a row of badges can be capped to one tile
      const lb = child.getLocalBounds();
      b = { x: child.position.x / cur, y: py + (child.position.y - py) / cur, sx: child.scale.x / cur, sy: child.scale.y / cur, w: lb.width };
      base.set(child, b);
    }
    // owner 09-06 (round 24): skill badges grow SLOWER than the figure — 0.65 at the fit zoom (decor 0.5, the
    // accepted size) rising as (f/0.5)^0.4, so ~0.86 at 1:1 instead of a proportional 1.3 (read too large zoomed in).
    const fs = decorChildScale(child, b, f);
    child.scale.set(b.sx * fs, b.sy * fs);
    child.position.set(b.x * f, py + (b.y - py) * f);
  }
  const bb = record.boundsBase;
  if (bb) record.token.boundsArea = new Rectangle(bb.x * f, py + (bb.y - py) * f, bb.width * f, bb.height * f);
  record.decorScale = f;
}

/** The current decoration scale of a walker token (1 = full-size figure), or null for a non-walker. */
export function walkerDecorScale(token: Container): number | null {
  const record = walkerTokens.get(token);
  return record ? (record.decorScale ?? record.sprite.scale.x) : null;
}

/** The walker's standing figure height in token units at the CURRENT decor scale (feet line -> head top). */
export function walkerDrawnFigureHeight(token: Container): number | null {
  const record = walkerTokens.get(token);
  if (!record) return null;
  return record.asset.figureHeight * record.asset.spec.visualScale * (record.decorScale ?? record.sprite.scale.x);
}

/** Owner 09-06: the walker's figure HEIGHT relative to the 53 px reference lineman (1 = lineman, ~0.6 snotling,
 *  1.3+ big guys). The carried ball keys its size to this — the ring/feet width shrank the ball on figures that
 *  stand with their feet together (a Str 4 carrier lost its ball). */
export function walkerFigureRatio(token: Container): number | null {
  const record = walkerTokens.get(token);
  if (!record) return null;
  return (record.asset.figureHeight * record.asset.spec.visualScale) / WALKER_REFERENCE_FIGURE_PX;
}

/** Owner 09-06: place a renderer-added decoration (state markers, gaze eye) on a walker token in DECOR-1 units
 *  (x, y, scale as laid out against the full-size figure, feet at WALKER_FEET_Y_PX). applyDecorScale captures a child
 *  added after the build as ALREADY at the current decor scale, so the placement is pre-scaled here — laid out raw,
 *  the eye and the ?/🌱 row ballooned ~1.7x once zoomed in. Non-walker tokens get the plain placement. */
export function placeWalkerDecor(token: Container, child: Container, x: number, y: number, scale = 1): void {
  const record = walkerTokens.get(token);
  if (!record) { child.position.set(x, y); child.scale.set(scale); return; }
  const f = record.decorScale ?? record.sprite.scale.x;
  const py = record.decorPivotY ?? WALKER_FEET_Y_PX;
  child.position.set(x * f, py + (y - py) * f);
  child.scale.set(scale * f);
}

/** Owner 09-08: token-local y (px) of a decor-1 unit y at the walker's CURRENT decor scale — exactly where
 *  placeWalkerDecor / applyDecorScale put a child laid out at that y. World-space overlays (the block dice preview)
 *  read the live chest row from here so they can clear it on every zoom rung. Null for a non-walker token. */
export function walkerDecorLocalY(token: Container, y: number): number | null {
  const record = walkerTokens.get(token);
  if (!record) return null;
  const f = record.decorScale ?? record.sprite.scale.x;
  const py = record.decorPivotY ?? WALKER_FEET_Y_PX;
  return py + (y - py) * f;
}

/** The walker's ring radii in token units at decor scale 1 (the active halo is drawn from these). */
export function walkerShadowRadii(token: Container): { rx: number; ry: number } | null {
  const record = walkerTokens.get(token);
  if (!record) return null;
  const g = walkerRingGeometry(record.asset, false);
  return { rx: g.rx, ry: g.ry };
}

/** Art->device ratios that draw exactly: 1/2^n = box-average mip levels, whole numbers = pixel magnification. */
const CLEAN_ART_RATIOS = [1 / 8, 1 / 4, 1 / 2, 1, 2, 3, 4, 5, 6, 8];
function snapWalker(record: WalkerTokenRecord, deviceScale: number, settled: boolean, exempt = false): void {
  const base = record.baseSpriteScale;
  if (!base || record.sprite.destroyed || !Number.isFinite(deviceScale) || deviceScale <= 0) return;
  // Owner 09-05 (round 9): ONE art set, no sheet swap (it jumped sizes while zooming). While the zoom is moving the
  // sprite draws at its true size; once the renderer reports the zoom SETTLED, snap onto the nearest whole
  // art->device ratio when within 20% (200% / 2x DPR -> 1:1, zoomed -> 2:1 ...). Otherwise stay at true size.
  const unit = record.asset.sheet.resolution || 1; // art px per 64-unit (2 on the bundled 128 px masters)
  const k = deviceScale * record.token.scale.x * base / unit; // device px per ART px at the IDEAL (fit) size
  // Owner 09-05 (round 15): always land on the CLEAN ratio nearest the ideal — never a fractional grid.
  void settled;
  // Owner 09-06: a FREE zoom rung (renderer FREE_ZOOM_RUNGS, 2.25 = 9/8 over fit) draws the true fractional size.
  const r = exempt ? k : CLEAN_ART_RATIOS.reduce((best, v) => (Math.abs(v - k) < Math.abs(best - k) ? v : best), CLEAN_ART_RATIOS[0]!);
  const target = base * (r / k);
  if (Math.abs(record.sprite.scale.x - target) > 1e-4) {
    record.sprite.scale.set(target);
    syncCastShadow(record);
    applyDecorScale(record, target);
  }
}

export function tickWalkers(
  ownerId: symbol,
  now: number,
  moveTweens: ReadonlyMap<string, TweenView>,
  deviceScale = 0,
  zoomSettled = true,
  snapExempt = false,
): void {
  let anyAnimating = false;
  for (const [token, record] of [...liveWalkers]) {
    if (record.ownerId !== ownerId) continue;
    if (token.destroyed) {
      liveWalkers.delete(token);
      continue;
    }
    // Owner 09-05: FACING follows the token's REAL motion (position delta since the last tick) so every mover
    // path — planner tween, confirmed presentation step, post-step correction, reconcile, direct placement —
    // turns the sprite, and it does so even with the walk animation OFF. FRAME CYCLING keeps its tween-timed
    // contract (a valid ground tween cycles from tween.start) and additionally cycles from the first observed
    // motion when a token moves without a valid ground tween; both are gated by `walkAnimation`.
    const { x, y } = token.position;
    const last = record.lastPos;
    let moved = false;
    if (last && (Math.abs(x - last.x) > 0.01 || Math.abs(y - last.y) > 0.01)) {
      record.facing = dir8(x - last.x, y - last.y, record.facing);
      travelFacing.set(record.playerId, record.facing);
      record.movingUntil = now + MOTION_HOLD_MS;
      if (record.motionStart == null) record.motionStart = now;
      moved = true;
    }
    record.lastPos = { x, y };
    if (deviceScale > 0) snapWalker(record, deviceScale, zoomSettled, snapExempt);
    const tween = moveTweens.get(record.playerId);
    if (record.settledTween && tween !== record.settledTween) record.settledTween = null; // a fresh move lifts the hold
    // Owner 09-05: a finished tween can linger in the map until its presentation step is consumed (e.g. while
    // the drain waits on a dialog); it must not keep the walker cycling in place. Only a tween whose travel
    // time has not elapsed counts as motion.
    const tweenValid = validGroundTween(record, record.playerId, tween) && tween !== record.settledTween && !tweenArrived(tween, now, x, y);
    const inMotion = tweenValid || moved || (record.movingUntil != null && now < record.movingUntil);
    // Owner 09-06: motion SETTLED on a walker that is not the active player (its activation already ended, it was
    // pushed, or it was carried) — the idle facing lands now. The activation-end reset alone left the token facing
    // its last tile / follow-up direction whenever that tween was still in flight at the wire signal. A token
    // REBUILT inside the motion-hold window starts at rest with the travel facing baked in (travelFacing survives
    // the rebuild), so a resting non-active walker that still carries one settles too.
    if (!inMotion && activeWalkerByOwner.get(record.ownerId) !== record.playerId
      && (record.wasInMotion || travelFacing.has(record.playerId))) {
      travelFacing.delete(record.playerId);
      record.facing = defaultFacing(record.isHome, record.facingGeometry, record.facing);
    }
    record.wasInMotion = inMotion;
    if (!inMotion || !walkAnimation) {
      if (!inMotion) record.motionStart = null;
      setWalkerFrame(record, record.asset.spec.idleColumn);
      continue;
    }
    if (tweenValid) {
      const elapsed = Math.max(0, now - tween.start);
      const segment = Math.min(tween.waypoints.length - 2, Math.floor(elapsed / tween.segmentMs));
      const a = tween.waypoints[segment]!;
      const b = tween.waypoints[segment + 1]!;
      if (!moved) { record.facing = dir8(b.x - a.x, b.y - a.y, record.facing); travelFacing.set(record.playerId, record.facing); }
      const fps = walkFps ?? record.asset.spec.fps;
      setWalkerFrame(record, 1 + Math.floor(elapsed / (1000 / fps)) % (record.asset.spec.columns - 1));
    } else {
      const elapsed = Math.max(0, now - (record.motionStart ?? now));
      const fps = walkFps ?? record.asset.spec.fps;
      setWalkerFrame(record, 1 + Math.floor(elapsed / (1000 / fps)) % (record.asset.spec.columns - 1));
    }
    anyAnimating = true;
  }
  if (anyAnimating) dirtyOwners.add(ownerId);
  else dirtyOwners.delete(ownerId);
}

/** Owner 09-05 (round 2): FORCE every walker of this renderer to its idle frame — the activation ended on the
 *  server, or another player committed an action (the same signal a blitz raises). Travel facing is kept; the
 *  motion window is cleared and any tween still lingering in the map stops counting as motion until a new one
 *  replaces it, so a token cannot stay frozen mid-stride. */
export function settleWalkersIdle(ownerId: symbol, moveTweens: ReadonlyMap<string, TweenView>): void {
  for (const record of liveWalkers.values()) {
    if (record.ownerId !== ownerId || record.token.destroyed) continue;
    record.movingUntil = null;
    record.motionStart = null;
    record.lastPos = { x: record.token.position.x, y: record.token.position.y };
    record.settledTween = moveTweens.get(record.playerId) ?? null;
    setWalkerFrame(record, record.asset.spec.idleColumn);
  }
  dirtyOwners.add(ownerId);
}

/** Owner 09-05: activation ended (or the acting player changed) — drop the travel facing and settle the idle pose.
 *  `null` resets every walker (game switch / teardown). */
export function resetWalkerFacing(playerId: string | null): void {
  if (playerId == null) travelFacing.clear(); else travelFacing.delete(playerId);
  for (const record of liveWalkers.values()) {
    if (playerId != null && record.playerId !== playerId) continue;
    record.facing = defaultFacing(record.isHome, record.facingGeometry, record.facing);
    setWalkerFrame(record, record.asset.spec.idleColumn);
    dirtyOwners.add(record.ownerId);
  }
}

export function refreshWalkerFacing(ownerId: symbol, geometry: FacingGeometry): void {
  travelFacing.clear(); // screen-relative facings do not survive an orientation/flip change
  for (const record of liveWalkers.values()) {
    if (record.ownerId !== ownerId) continue;
    record.facingGeometry = geometry;
    record.facing = defaultFacing(record.isHome, geometry, record.facing);
    setWalkerFrame(record, record.asset.spec.idleColumn);
  }
  if ([...liveWalkers.values()].some((record) => record.ownerId === ownerId)) dirtyOwners.add(ownerId);
}

export function releaseWalkersOwnedBy(ownerId: symbol): void {
  travelFacing.clear();
  activeWalkerByOwner.delete(ownerId);
  for (const [token, record] of [...liveWalkers]) {
    if (record.ownerId !== ownerId) continue;
    if (!token.destroyed) token.destroy({ children: true });
    else liveWalkers.delete(token);
  }
  dirtyOwners.delete(ownerId);
}

export function setWalkAnimation(on: boolean): void {
  walkAnimation = on;
  for (const record of liveWalkers.values()) {
    setWalkerFrame(record, record.asset.spec.idleColumn);
    dirtyOwners.add(record.ownerId);
  }
}

/** Owner 2026-09-04: Settings > Appearance toggle. Re-pins every live walker's idle facing immediately. */
export function setWalkFaceCamera(on: boolean): void {
  if (walkFaceCamera === on) return;
  walkFaceCamera = on;
  for (const record of liveWalkers.values()) {
    record.facing = defaultFacing(record.isHome, record.facingGeometry, record.facing);
    setWalkerFrame(record, record.asset.spec.idleColumn);
    dirtyOwners.add(record.ownerId);
  }
}

export function walkFaceCameraEnabled(): boolean {
  return walkFaceCamera;
}

export function setWalkFps(fps: number | null): void {
  walkFps = fps !== null && Number.isInteger(fps) && fps >= 1 && fps <= 30 ? fps : null;
  for (const record of liveWalkers.values()) {
    setWalkerFrame(record, record.asset.spec.idleColumn);
    dirtyOwners.add(record.ownerId);
  }
}

export function dir8(dx: number, dy: number, previous: Dir8): Dir8 {
  if (dx === 0 && dy === 0) return previous;
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return (['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const)[(octant + 8) % 8]!;
}
