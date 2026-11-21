import * as THREE from 'three';
import type { StadiumStandSide } from '../stadiumTiles';
import type { AtlasImage, Canvas2DLike, PlacedSeat } from './standSeats';

/**
 * Owner 11-12 ("Yes, fans should be in the seats."): the crowd of the baked 3D stadium. The RULES are the classic 2D
 * stands' (renderer.ts drawStadiumBody / drawBand): attendance per side from each team's Dedicated Fans (finite and
 * positive, else 3; min(1, fans / 7)), the end stands from each team's rolled Fan Factor, and the same sprite pool (crowd_1-4, the
 * five fantasy fans, and crowd_1 tinted as the standing "risen corpse"). Owner 11-12 (second ruling): in the bake the
 * attendance is the share of the stand's CHAIRS holding a fan, so a full fan factor is a full stadium (seatCrowd). The billboard pieces (opaque-crop atlas, upright camera-facing cards, the Modern 3D crowd height) are lifted
 * from pitch3d/crowd.ts, without its per-frame turning, anchors data or sign holders.
 */

/** renderer.ts turfNoise (private there; the formula is the contract). */
export function standNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** The stands' per-side attendance (renderer.ts stadiumFanDensities). Side stands (home / away, along the sidelines):
 *  that team's Dedicated Fans. End stands (behind each end zone; nearEnd = x < 0 = the home end zone): that team's
 *  rolled Fan Factor from the pre-game Fans roll (Dedicated Fans + the roll), once it is known. */
export interface CrowdDensity { home: number; away: number; nearEnd: number; farEnd: number }
export function standDensity(stand: StadiumStandSide, density: CrowdDensity): number {
  return density[stand];
}
/** Dedicated Fans that fill a side stand. */
export const SIDE_FULL_FANS = 7;
/** Rolled Fan Factor that fills an end stand (7 Dedicated Fans + a 3 on the D3). */
export const END_FULL_FAN_FACTOR = 10;
/** The four densities from the server-sent values. Dedicated Fans: finite and positive, else 3. A Fan Factor that is
 *  missing or not positive (before the pre-game Fans roll, or a ruleset without it) falls back to the mean of the two
 *  Dedicated Fans on the side-stand scale, as both end stands showed before. */
export function crowdDensityFromFans(home: unknown, away: unknown, homeFanFactor?: unknown, awayFanFactor?: unknown): CrowdDensity {
  const count = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 3; };
  const rolled = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };
  const h = count(home), a = count(away);
  const fallback = Math.min(1, (h + a) / 2 / SIDE_FULL_FANS);
  const end = (value: unknown) => { const n = rolled(value); return n === null ? fallback : Math.min(1, n / END_FULL_FAN_FACTOR); };
  return { home: Math.min(1, h / SIDE_FULL_FANS), away: Math.min(1, a / SIDE_FULL_FANS), nearEnd: end(homeFanFactor), farEnd: end(awayFanFactor) };
}
/** renderer.ts crowdTextures, in order: index = floor(noise * 97) % pool size. Entry 9 is crowd_1 tinted. */
export const CROWD_ART_URLS = Object.freeze(['crowd_1', 'crowd_2', 'crowd_3', 'crowd_4', 'fan_skeleton', 'fan_lizardman', 'fan_mummy', 'fan_wolfman', 'fan_orc']
  .map((name) => new URL(`../../assets/stadium/${name}.png`, import.meta.url).href));
export const CROWD_ZOMBIE_TINT = 0x7d9a5c;
export const CROWD_POOL_SIZE = CROWD_ART_URLS.length + 1;

export interface CrowdFan { x: number; y: number; z: number; stand: StadiumStandSide; sprite: number }

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
        fans.push({ x: chair.x, y: chair.surface, z: chair.z, stand, sprite: Math.floor(noise * 97) % CROWD_POOL_SIZE });
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

/** Paint the pool (plus the tinted corpse) into `canvas`, one 192 px cell each, and crop each entry to its opaque
 *  pixels so a card's bottom edge is the sprite's feet row. `measure` canvases read the alpha (a canvas without pixel
 *  access keeps the whole image). */
export function paintCrowdAtlas(canvas: Canvas2DLike, images: readonly AtlasImage[], createCanvas: () => Canvas2DLike & CanvasImageSource): CrowdAtlasEntry[] {
  const tinted = createCanvas(); tinted.width = images[0]!.width; tinted.height = images[0]!.height;
  const tctx = tinted.getContext('2d');
  if (tctx) {
    tctx.drawImage(images[0]!, 0, 0);
    tctx.globalCompositeOperation = 'multiply'; tctx.fillStyle = `#${CROWD_ZOMBIE_TINT.toString(16).padStart(6, '0')}`; tctx.fillRect(0, 0, tinted.width, tinted.height);
    tctx.globalCompositeOperation = 'destination-in'; tctx.drawImage(images[0]!, 0, 0);
  }
  const pool: AtlasImage[] = [...images, (tctx ? tinted : images[0]!) as AtlasImage];
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
      aspect: (ox1 - ox0) / Math.max(1e-6, oy1 - oy0), heightRatio: (o.y1 - o.y0) / Math.max(1, image.height) };
  });
}

/** The Modern 3D crowd height (pitch3d/crowd.ts CROWD_HEIGHT), in squares, before the opaque crop. */
export const CROWD_HEIGHT = 0.78;
/** How far in front of its chair's centre a fan stands (toward the pitch), so the chair does not cut its legs. */
export const CROWD_FRONT_OFFSET = 0.08;

/** One mesh of upright cards facing the bake camera (`toCamera` = the horizontal direction to it), feet on the tier. */
export function crowdGeometry(fans: readonly CrowdFan[], entries: readonly CrowdAtlasEntry[], toCamera: readonly [number, number],
  pitchward: (stand: StadiumStandSide) => readonly [number, number]): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const right: [number, number] = [toCamera[1], -toCamera[0]];
  for (const fan of fans) {
    const entry = entries[fan.sprite % entries.length]!;
    const height = CROWD_HEIGHT * entry.heightRatio, half = height * entry.aspect / 2;
    const n = pitchward(fan.stand), x = fan.x + n[0] * CROWD_FRONT_OFFSET, z = fan.z + n[1] * CROWD_FRONT_OFFSET, y = fan.y + 0.002;
    const base = positions.length / 3;
    positions.push(x - right[0] * half, y, z - right[1] * half, x + right[0] * half, y, z + right[1] * half,
      x + right[0] * half, y + height, z + right[1] * half, x - right[0] * half, y + height, z - right[1] * half);
    uvs.push(entry.u0, entry.v0, entry.u1, entry.v0, entry.u1, entry.v1, entry.u0, entry.v1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(indices);
  g.computeVertexNormals(); // lit like the stadium (a card without normals renders black under MeshStandardMaterial)
  return g;
}
