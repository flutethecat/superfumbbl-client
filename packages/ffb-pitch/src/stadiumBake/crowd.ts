import * as THREE from 'three';
import type { StadiumStandSide } from '../stadiumTiles';
import type { AtlasImage, Canvas2DLike, PlacedSeat } from './standSeats';
import { peopleWithRole } from '../stadiumPeople';

/**
 * Owner 11-12 ("Yes, fans should be in the seats."): the crowd of the baked 3D stadium. The RULES are the classic 2D
 * stands' (renderer.ts drawStadiumBody / drawBand): attendance per stand from crowdDensityFromFans and the same fan
 * figures (stadiumPeople.ts, owner 11-21). Owner 11-12 (second ruling): in the bake the
 * attendance is the share of the stand's CHAIRS holding a fan, so a full fan factor is a full stadium (seatCrowd). The billboard pieces (opaque-crop atlas, upright camera-facing cards, the Modern 3D crowd height) are lifted
 * from pitch3d/crowd.ts, without its per-frame turning, anchors data or sign holders.
 */

/** renderer.ts turfNoise (private there; the formula is the contract). */
export function standNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** The stands' per-side attendance (renderer.ts stadiumFanDensities). Owner 11-21: the END stands (north / south,
 *  behind the end zones; nearEnd = x < 0 = the home end zone) hold each team's Dedicated Fans; the SIDE stands (east /
 *  west, along the sidelines; `home` / `away`) each team's rolled Fan Factor from the pre-game Fans roll (Dedicated
 *  Fans + the roll), once it is known. */
export interface CrowdDensity { home: number; away: number; nearEnd: number; farEnd: number }
export function standDensity(stand: StadiumStandSide, density: CrowdDensity): number {
  return density[stand];
}
/** Dedicated Fans that fill an end stand. */
export const END_FULL_FANS = 7;
/** Rolled Fan Factor that fills a side stand (7 Dedicated Fans + a 3 on the D3). */
export const SIDE_FULL_FAN_FACTOR = 10;
/** The four densities from the server-sent values. Dedicated Fans: finite and positive, else 3. A Fan Factor that is
 *  missing or not positive (before the pre-game Fans roll, or a ruleset without it) falls back to that team's
 *  Dedicated Fans on the end-stand scale. */
export function crowdDensityFromFans(home: unknown, away: unknown, homeFanFactor?: unknown, awayFanFactor?: unknown): CrowdDensity {
  const count = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 3; };
  const rolled = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };
  const h = count(home), a = count(away);
  const side = (fanFactor: unknown, fans: number) => {
    const n = rolled(fanFactor);
    return n === null ? Math.min(1, fans / END_FULL_FANS) : Math.min(1, n / SIDE_FULL_FAN_FACTOR);
  };
  return { home: side(homeFanFactor, h), away: side(awayFanFactor, a), nearEnd: Math.min(1, h / END_FULL_FANS), farEnd: Math.min(1, a / END_FULL_FANS) };
}
/** Owner 11-21: the crowd is the generated fan figures (stadiumPeople.ts, role `fan`), in that order; the bake and
 *  the 2D stands pick per stand from the facing the camera sees (front / side / back, side mirrored as needed). */
export const CROWD_PEOPLE = Object.freeze(peopleWithRole('fan'));
export const CROWD_ART_URLS = Object.freeze(CROWD_PEOPLE.map((p) => p.url));
/** Range of a fan's `pick` (seatCrowd): the sprite is pick modulo the facing's pool size. */
export const CROWD_PICK_RANGE = 9973;
export interface CrowdFan {
  x: number; y: number; z: number; stand: StadiumStandSide;
  /** From seatCrowd: a stable per-seat number; the bake turns it into an atlas index for the facing it sees. */
  sprite: number;
  /** Mirror the art (a profile figure facing left). */
  flip?: boolean;
}

/** How many of a stand's chairs hold a fan at an attendance (0..1): a share of the chairs, a full house at 1. The renderer's
 *  bake key uses the same count, so attendances that seat the same fans never re-bake. */
export function seatedCount(attendance: number, chairs: number): number {
  return Math.max(0, Math.min(chairs, Math.round(attendance * chairs)));
}

/** A chair's fixed place in its stand's fill order and its sprite: per-seat noise from the chair's own position. */
function seatNoise(chair: Pick<PlacedSeat, 'x' | 'z'>): number {
  const x = Math.round(chair.x * 100), z = Math.round(chair.z * 100);
  return standNoise(x * 0.013 + z * 0.007 + 3, x * 0.005 - z * 0.011 + 1);
}

/** Front-row bias (owner 11-21): a row's share of fans relative to the front row falls quadratically with its depth,
 *  1 - BACK_ROW_DROP x t^2 (t = 0 front row .. 1 back row), so the back row fills at 1 - BACK_ROW_DROP of the front
 *  row's rate. A full house still fills every chair. */
export const BACK_ROW_DROP = 0.6;

/** How many fans each row seats: `total` spread over rows of the given capacities (front first) in proportion to
 *  capacity x the quadratic row weight, a full row passing its surplus on to the others. Sums to min(total, capacity)
 *  and never decreases in any row as `total` grows. */
export function fansPerRow(capacities: readonly number[], total: number): number[] {
  const rows = capacities.length;
  const capacity = capacities.reduce((sum, c) => sum + c, 0);
  const target = Math.max(0, Math.min(capacity, Math.round(total)));
  const counts = capacities.map(() => 0);
  const weight = capacities.map((c, r) => c * (1 - BACK_ROW_DROP * (rows > 1 ? r / (rows - 1) : 0) ** 2));
  // One fan at a time to the row furthest below its weighted share (front row first on ties): the count of every row
  // only ever grows with `total`, so a fuller crowd is a superset of a thinner one.
  for (let n = 0; n < target; n++) {
    let best = -1, bestLoad = Infinity;
    for (let r = 0; r < rows; r++) {
      if (counts[r]! >= capacities[r]! || weight[r]! <= 0) continue;
      const load = (counts[r]! + 0.5) / weight[r]!;
      if (load < bestLoad) { best = r; bestLoad = load; }
    }
    if (best < 0) break;
    counts[best]!++;
  }
  return counts;
}

/** The same front bias for rows of EQUAL size, as a fill rate per row (front first, 0..1) whose mean is `attendance`:
 *  the classic 2D stands seat a cell when its noise falls under its row's rate. Rates only grow with attendance; 1
 *  fills every row. */
export function rowFillRates(rows: number, attendance: number): number[] {
  const a = Math.max(0, Math.min(1, attendance));
  if (rows <= 0) return [];
  const weight = Array.from({ length: rows }, (_, r) => 1 - BACK_ROW_DROP * (rows > 1 ? r / (rows - 1) : 0) ** 2);
  const at = (scale: number) => weight.map((w) => Math.min(1, scale * w));
  const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
  let lo = 0, hi = 1 / Math.min(...weight);
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (mean(at(mid)) < a) lo = mid; else hi = mid; }
  return at(hi);
}

/**
 * Who sits where (owner 11-12: "A full dedicated fan factor should be a full stadium"). Each stand's attendance
 * (crowdDensityFromFans) seats that SHARE of the stand's chairs: attendance 1 fills every chair. Owner 11-21: the fans
 * favour the front - rows (chairs at the same tier height, lowest = front) get fansPerRow's quadratically falling
 * share; inside a row the chairs are ordered once by per-seat noise and the first ones take a fan. The same inputs
 * always give the same picture and a fuller crowd is a superset of a thinner one. The sprite comes from the same
 * per-seat noise over the 2D pool.
 */
export function seatCrowd(chairs: readonly PlacedSeat[], density: CrowdDensity): CrowdFan[] {
  const byStand = new Map<StadiumStandSide, Map<number, Array<{ chair: PlacedSeat; noise: number }>>>();
  for (const chair of chairs) {
    const rows = byStand.get(chair.stand) ?? new Map<number, Array<{ chair: PlacedSeat; noise: number }>>();
    const row = Math.round(chair.surface * 1000); // tier tops are flat: one height per row
    const list = rows.get(row) ?? [];
    list.push({ chair, noise: seatNoise(chair) });
    rows.set(row, list);
    byStand.set(chair.stand, rows);
  }
  const fans: CrowdFan[] = [];
  for (const [stand, rowMap] of byStand) {
    const rows = [...rowMap.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
    const chairCount = rows.reduce((n, list) => n + list.length, 0);
    const perRow = fansPerRow(rows.map((list) => list.length), seatedCount(standDensity(stand, density), chairCount));
    rows.forEach((list, r) => {
      list.sort((a, b) => a.noise - b.noise || a.chair.x - b.chair.x || a.chair.z - b.chair.z);
      for (const { chair, noise } of list.slice(0, perRow[r])) {
        fans.push({ x: chair.x, y: chair.surface, z: chair.z, stand, sprite: Math.floor(noise * CROWD_PICK_RANGE) });
      }
    });
  }
  return fans;
}
/** Chairs per stand (the bake reports them so the renderer can key on seated counts). */
export function chairsPerStand(chairs: readonly Pick<PlacedSeat, 'stand'>[]): Record<StadiumStandSide, number> {
  const counts: Record<StadiumStandSide, number> = { home: 0, away: 0, nearEnd: 0, farEnd: 0 };
  for (const chair of chairs) counts[chair.stand]++;
  return counts;
}

/** Opaque bounds of an RGBA image (x1/y1 exclusive), or null when nothing is opaque. */
export interface OpaqueBounds { x0: number; y0: number; x1: number; y1: number }
export function opaqueBounds(rgba: ArrayLike<number>, width: number, height: number, alphaMin = 8): OpaqueBounds | null {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (rgba[(y * width + x) * 4 + 3]! < alphaMin) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

export interface CrowdAtlasEntry { u0: number; v0: number; u1: number; v1: number; aspect: number; heightRatio: number }
const CELL = 192, COLUMNS = 5;

/** Paint the pool into `canvas`, one 192 px cell each, and crop each entry to its opaque
 *  pixels so a card's bottom edge is the sprite's feet row. `measure` canvases read the alpha (a canvas without pixel
 *  access keeps the whole image). */
export function paintCrowdAtlas(canvas: Canvas2DLike, images: readonly AtlasImage[], createCanvas: () => Canvas2DLike & CanvasImageSource): CrowdAtlasEntry[] {
  const pool: AtlasImage[] = [...images];
  // Owner 11-21: the figures keep their relative sizes (an ogre stands taller than a goblin): heights are measured
  // against the tallest image of the pool.
  const tallest = Math.max(1, ...pool.map((image) => image.height));
  const rows = Math.ceil(pool.length / COLUMNS), width = COLUMNS * CELL, height = rows * CELL;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for the crowd atlas');
  ctx.imageSmoothingEnabled = false;
  return pool.map((image, i) => {
    let opaque: OpaqueBounds | null = null;
    try {
      const probe = createCanvas(); probe.width = image.width; probe.height = image.height;
      const pctx = probe.getContext('2d');
      if (pctx?.getImageData) { pctx.drawImage(image, 0, 0); opaque = opaqueBounds(pctx.getImageData(0, 0, image.width, image.height).data, image.width, image.height); }
    } catch { opaque = null; }
    const o = opaque ?? { x0: 0, y0: 0, x1: image.width, y1: image.height };
    const col = i % COLUMNS, row = Math.floor(i / COLUMNS);
    const scale = Math.min((CELL - 8) / image.width, (CELL - 8) / image.height);
    const w = Math.round(image.width * scale), h = Math.round(image.height * scale);
    const dx = col * CELL + Math.floor((CELL - w) / 2), dy = row * CELL + CELL - h - 4;
    ctx.drawImage(image, dx, dy, w, h);
    const sx = w / image.width, sy = h / image.height;
    const ox0 = dx + o.x0 * sx, ox1 = dx + o.x1 * sx, oy0 = dy + o.y0 * sy, oy1 = dy + o.y1 * sy;
    return { u0: ox0 / width, u1: ox1 / width, v0: 1 - oy1 / height, v1: 1 - oy0 / height,
      aspect: (ox1 - ox0) / Math.max(1e-6, oy1 - oy0), heightRatio: (o.y1 - o.y0) / tallest };
  });
}

/** The Modern 3D crowd height (pitch3d/crowd.ts CROWD_HEIGHT), in squares, before the opaque crop. */
export const CROWD_HEIGHT = 0.78;
/** How far in front of its chair's centre a fan stands (toward the pitch), so the chair does not cut its legs. */
export const CROWD_FRONT_OFFSET = 0.08;

/** One mesh of upright cards facing the bake camera (`toCamera` = the horizontal direction to it), feet on the tier. */
export function crowdGeometry(fans: readonly CrowdFan[], entries: readonly CrowdAtlasEntry[], toCamera: readonly [number, number],
  pitchward: (stand: StadiumStandSide) => readonly [number, number], elevation = 0): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const right: [number, number] = [toCamera[1], -toCamera[0]];
  // Owner 11-21: the cards lean back by the camera elevation, so they face the camera squarely (an upright card was
  // foreshortened to cos(elevation) of its height: squat, half-hidden fans). The feet stay on the tier.
  const lean = Math.sin(elevation), rise = Math.cos(elevation);
  const up: [number, number, number] = [-toCamera[0] * lean, rise, -toCamera[1] * lean];
  for (const fan of fans) {
    const entry = entries[fan.sprite % entries.length]!;
    const height = CROWD_HEIGHT * entry.heightRatio, half = height * entry.aspect / 2;
    const n = pitchward(fan.stand), x = fan.x + n[0] * CROWD_FRONT_OFFSET, z = fan.z + n[1] * CROWD_FRONT_OFFSET, y = fan.y + 0.002;
    const base = positions.length / 3;
    const tx = up[0] * height, ty = up[1] * height, tz = up[2] * height;
    positions.push(x - right[0] * half, y, z - right[1] * half, x + right[0] * half, y, z + right[1] * half,
      x + right[0] * half + tx, y + ty, z + right[1] * half + tz, x - right[0] * half + tx, y + ty, z - right[1] * half + tz);
    const [ua, ub] = fan.flip ? [entry.u1, entry.u0] : [entry.u0, entry.u1];
    uvs.push(ua, entry.v0, ub, entry.v0, ub, entry.v1, ua, entry.v1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(indices);
  g.computeVertexNormals(); // lit like the stadium (a card without normals renders black under MeshStandardMaterial)
  return g;
}
