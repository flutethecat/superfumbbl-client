import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PITCH_COLS, PITCH_ROWS } from '../geometry';
import type { StadiumStandColour, StadiumStandSide } from '../stadiumTiles';
import { STAND_COLOUR, standClassicColumn, type StandTierTop } from './standSkin';

/**
 * The stand furniture of the Modern 3D stadium (pitch3d/standSeats.ts, the owner's 11-06 'chairs' pick), lifted for the
 * 2D baked backdrop: an art-wrapped low-poly chair on every seat slot of every tier top (SakPix seat art, one colour per
 * stand), stair strips where the 2D stands have their aisles, and the covered bench shelters along the back wall of
 * each reserves box. The seat cards and their camera skew are not brought over (the bake has one fixed camera).
 */

/** Main and dark colours sampled from seat_single_<colour>.png. */
export const SEAT_COLOURS: Readonly<Record<StadiumStandColour, { main: number; dark: number }>> = {
  blue: { main: 0x0172e8, dark: 0x00368e },
  red: { main: 0xfa1000, dark: 0x7d0800 },
  yellow: { main: 0xfacf00, dark: 0xca7401 },
  green: { main: 0x1aaa39, dark: 0x016a1f },
};

export const SEAT_SPACING = 0.5;
export const SEAT_CONTACT = 0.002;
/** The chair's back plane sits this far in front of the tier's back edge (the riser of the tier behind). */
export const CHAIR_BACK_OFFSET = 0.2;

export interface SeatSlot { stand: StadiumStandSide; colour: StadiumStandColour; x: number; y: number; z: number; n: [number, number]; r: [number, number] }
export interface AisleSlot { stand: StadiumStandSide; x: number; y: number; z: number; n: [number, number]; r: [number, number]; width: number; depth: number }

/** Toward the pitch from a stand (the seat fronts), and the right of a viewer on the pitch looking at it (Y x n). */
export function standPitchward(stand: StadiumStandSide): [number, number] {
  return stand === 'home' ? [0, 1] : stand === 'away' ? [0, -1] : stand === 'nearEnd' ? [1, 0] : [-1, 0];
}
export function standRightward(stand: StadiumStandSide): [number, number] { const [nx, nz] = standPitchward(stand); return [nz, -nx]; }
/** World x, z of a point given by its along-tier and outward coordinates (stadiumTierTops axes). */
export function standWorld(stand: StadiumStandSide, along: number, out: number): [number, number] {
  return stand === 'home' ? [along, -out] : stand === 'away' ? [along, out] : stand === 'nearEnd' ? [-out, along] : [out, along];
}

/** Seats along each tier top at SEAT_SPACING, the back `backOffset` in front of the tier's back edge; where the 2D
 *  stands had an aisle (atlas column 3) the cell is an aisle instead. `probe` rejects positions where the tier top is
 *  not under the slot (gaps, entrances). */
export function seatSlotsFromTops(tops: readonly StandTierTop[], backOffset: number, probe?: (x: number, z: number, y: number) => boolean):
  { seats: SeatSlot[]; aisles: AisleSlot[] } {
  const seats: SeatSlot[] = [], aisles = new Map<string, AisleSlot>();
  for (const top of tops) {
    const depth = top.outer - top.inner, n = standPitchward(top.stand), r = standRightward(top.stand);
    for (let a = top.along0 + SEAT_SPACING / 2; a <= top.along1 - SEAT_SPACING / 2 + 1e-6; a += SEAT_SPACING) {
      const [cx, cz] = standWorld(top.stand, a, (top.inner + top.outer) / 2);
      if (probe && !probe(cx, cz, top.y)) continue;
      if (standClassicColumn(top.stand, Math.floor(cx), Math.floor(cz)) === 3) {
        const key = `${top.stand}|${Math.floor(a)}|${top.y.toFixed(3)}`;
        if (!aisles.has(key)) {
          const [ax, az] = standWorld(top.stand, Math.floor(a) + 0.5, (top.inner + top.outer) / 2);
          aisles.set(key, { stand: top.stand, x: ax, y: top.y, z: az, n, r, width: 0.9, depth: depth * 0.96 });
        }
        continue;
      }
      if (depth < backOffset + 0.15) continue;
      const [x, z] = standWorld(top.stand, a, top.outer - backOffset);
      seats.push({ stand: top.stand, colour: STAND_COLOUR[top.stand], x, y: top.y + SEAT_CONTACT, z, n, r });
    }
  }
  return { seats, aisles: [...aisles.values()] };
}

/** The top surface under a ground point (null = nothing there). Seats are planted from it, never from a nominal plane. */
export type SurfaceSampler = (x: number, z: number) => number | null;

/** Upward faces of a world-space geometry bucketed on a one-square grid: the highest face over a point. */
export function surfaceSamplerFromGeometry(geometry: THREE.BufferGeometry): SurfaceSampler {
  const position = geometry.getAttribute('position'), index = geometry.index;
  const count = index ? index.count : position.count, buckets = new Map<string, number[]>(), tris: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const vertex = (k: number, v: THREE.Vector3) => v.fromBufferAttribute(position, index ? index.getX(k) : k);
  for (let t = 0; t + 2 < count; t += 3) {
    vertex(t, a); vertex(t + 1, b); vertex(t + 2, c);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-14 || n.normalize().y < 0.5) continue;
    const id = tris.length / 9; tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let gx = Math.floor(Math.min(a.x, b.x, c.x)); gx <= Math.floor(Math.max(a.x, b.x, c.x)); gx++)
      for (let gz = Math.floor(Math.min(a.z, b.z, c.z)); gz <= Math.floor(Math.max(a.z, b.z, c.z)); gz++) {
        const key = `${gx},${gz}`; const list = buckets.get(key) ?? []; list.push(id); buckets.set(key, list);
      }
  }
  return (x, z) => {
    let best: number | null = null;
    for (const id of buckets.get(`${Math.floor(x)},${Math.floor(z)}`) ?? []) {
      const o = id * 9, ax = tris[o]!, az = tris[o + 2]!, bx = tris[o + 3]!, bz = tris[o + 5]!, cx = tris[o + 6]!, cz = tris[o + 8]!;
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-12) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den, w = 1 - u - v;
      if (u < -1e-7 || v < -1e-7 || w < -1e-7) continue;
      const y = u * tris[o + 1]! + v * tris[o + 4]! + w * tris[o + 7]!;
      if (best === null || y > best) best = y;
    }
    return best;
  };
}

/** A seat's footprint on the ground: half width along its right vector, depth behind and in front along its facing. */
export interface SeatFootprint { halfWidth: number; back: number; front: number }
export const CHAIR_FOOTPRINT: SeatFootprint = { halfWidth: 0.2, back: 0.16, front: 0.17 }; // artChairGeometry's XZ bounds
/** How far a seat may be pulled toward the pitch to clear the riser behind it, and the step. */
export const SEAT_MAX_PULL = 0.45;
const SEAT_PULL_STEP = 0.01;

export function footprintCorners(x: number, z: number, n: readonly [number, number], r: readonly [number, number], f: SeatFootprint): Array<[number, number]> {
  const w = f.halfWidth, b = f.back, fr = f.front;
  return [[-w, -b], [w, -b], [w, fr], [-w, fr]].map(([u, v]) => [x + r[0] * u! + n[0] * v!, z + r[1] * u! + n[1] * v!] as [number, number]);
}

export interface PlacedSeat extends SeatSlot { surface: number }

/** Plant a seat from the surface under its footprint: pull it toward the pitch until every footprint corner meets ONE
 *  flat tier top at the seat's tier height, then stand it there; no such position within SEAT_MAX_PULL drops it. */
export function plantSeat(seat: SeatSlot, f: SeatFootprint, sample: SurfaceSampler): PlacedSeat | null {
  const tierY = seat.y - SEAT_CONTACT;
  for (let pull = 0; pull <= SEAT_MAX_PULL + 1e-9; pull += SEAT_PULL_STEP) {
    const px = seat.x + seat.n[0] * pull, pz = seat.z + seat.n[1] * pull, corners = footprintCorners(px, pz, seat.n, seat.r, f);
    const ys = corners.map(([cx, cz]) => sample(cx, cz));
    if (ys.some((y) => y === null)) continue;
    const hi = Math.max(...(ys as number[])), lo = Math.min(...(ys as number[]));
    if (hi - lo > 0.006 || Math.abs(hi - tierY) > 0.01) continue;
    return { ...seat, x: px, z: pz, y: hi + SEAT_CONTACT, surface: hi };
  }
  return null;
}

export function placeChairs(seats: readonly SeatSlot[], sample: SurfaceSampler): PlacedSeat[] {
  return seats.flatMap((seat) => { const p = plantSeat(seat, CHAIR_FOOTPRINT, sample); return p ? [p] : []; });
}

/** The 2D dugout layout (renderer.ts drawDugouts; pitch3d pitchSpace DUGOUT_LAYOUT): three cell columns beside a sideline
 *  (home y 15.5..18.5, away -3.5..-0.5), from the team's end zone toward midfield, 12 rows (INJURED 5 + RESERVES 7). */
export function dugoutBoxRect(isHome: boolean): { x0: number; x1: number; outerZ: number } {
  const rows = 12;
  return isHome
    ? { x0: 0, x1: rows, outerZ: PITCH_ROWS + 3.5 }
    : { x0: PITCH_COLS - rows, x1: PITCH_COLS, outerZ: -3.5 };
}

/** The reserves boxes' covered bench shelters: along each box's back (outer) wall, facing the pitch. */
export interface ShelterSlot { isHome: boolean; x: number; y: number; z: number; n: [number, number]; r: [number, number]; width: number }
export const SHELTER_WIDTH = 2.2;
export function shelterSlots(): ShelterSlot[] {
  const out: ShelterSlot[] = [];
  for (const isHome of [true, false]) {
    const box = dugoutBoxRect(isHome);
    const n: [number, number] = isHome ? [0, -1] : [0, 1], r: [number, number] = [n[1], -n[0]];
    const count = Math.floor((box.x1 - box.x0) / (SHELTER_WIDTH + 0.2));
    const span = count * SHELTER_WIDTH + (count - 1) * 0.2, start = (box.x0 + box.x1) / 2 - span / 2 + SHELTER_WIDTH / 2;
    for (let i = 0; i < count; i++) out.push({ isHome, x: start + i * (SHELTER_WIDTH + 0.2), y: SEAT_CONTACT, z: box.outerZ + n[1] * 0.15, n, r, width: SHELTER_WIDTH });
  }
  return out;
}

export const STAND_SEAT_ART_URLS = Object.freeze({
  seats: (['blue', 'red', 'yellow', 'green'] as const).map((c) => new URL(`../../assets/stadium/seat_single_${c}.png`, import.meta.url).href),
  stairs: new URL('../../assets/stadium/stand_stairs.png', import.meta.url).href,
  shelters: [new URL('../../assets/stadium/bench_shelter_blue.png', import.meta.url).href, new URL('../../assets/stadium/bench_shelter_red.png', import.meta.url).href],
});
const COLOUR_INDEX: Record<StadiumStandColour, number> = { blue: 0, red: 1, yellow: 2, green: 3 };

export interface UvRect { u0: number; v0: number; u1: number; v1: number }
export interface AtlasRect extends UvRect { aspect: number }
/** Where each piece of seat art sits in the 512 x 512 furniture atlas canvas. */
export interface SeatAtlasLayout { seats: AtlasRect[]; stairs: AtlasRect; shelters: AtlasRect[]; dark: AtlasRect[]; shelterDark: AtlasRect[] }

export type AtlasImage = CanvasImageSource & { width: number; height: number };
export interface Canvas2DLike { width: number; height: number; getContext(type: '2d'): CanvasRenderingContext2D | null }

/** Paint the seat, stair and shelter art plus the dark swatches into `canvas` (512 x 512) and return the layout. */
export function paintSeatAtlas(canvas: Canvas2DLike, images: { seats: AtlasImage[]; stairs: AtlasImage; shelters: AtlasImage[] }): SeatAtlasLayout {
  const W = 512, H = 512;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for the seat atlas');
  ctx.imageSmoothingEnabled = false;
  const rect = (x: number, y: number, w: number, h: number): AtlasRect => ({ u0: x / W, u1: (x + w) / W, v1: 1 - y / H, v0: 1 - (y + h) / H, aspect: w / h });
  const seats = images.seats.map((img, i) => { ctx.drawImage(img, i * 96, 0); return rect(i * 96, 0, img.width, img.height); });
  ctx.drawImage(images.stairs, 384, 0); const stairs = rect(384, 0, images.stairs.width, images.stairs.height);
  const shelters = images.shelters.map((img, i) => { ctx.drawImage(img, i * 212, 100); return rect(i * 212, 100, img.width, img.height); });
  const swatch = (i: number, colour: number) => { ctx.fillStyle = `#${colour.toString(16).padStart(6, '0')}`; ctx.fillRect(i * 16, 240, 16, 16); return rect(i * 16 + 4, 244, 8, 8); };
  const dark = (['blue', 'red', 'yellow', 'green'] as const).map((c, i) => swatch(i, SEAT_COLOURS[c].dark));
  const shelterDark = [swatch(4, 0x1d2a4a), swatch(5, 0x4a1d1d)];
  return { seats, stairs, shelters, dark, shelterDark };
}

/** Quad builder: upright card (base centre, right, height) or flat quad (centre, right, forward). Front faces only. */
class QuadBuffer {
  positions: number[] = []; uvs: number[] = []; indices: number[] = [];
  private push(v: THREE.Vector3[], rect: UvRect): void {
    const base = this.positions.length / 3;
    for (const p of v) this.positions.push(p.x, p.y, p.z);
    this.uvs.push(rect.u0, rect.v0, rect.u1, rect.v0, rect.u1, rect.v1, rect.u0, rect.v1);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  card(x: number, y: number, z: number, r: [number, number], width: number, height: number, rect: UvRect, back?: UvRect): void {
    const R = new THREE.Vector3(r[0], 0, r[1]).multiplyScalar(width / 2), up = new THREE.Vector3(0, height, 0), p = new THREE.Vector3(x, y, z);
    const v0 = p.clone().sub(R), v1 = p.clone().add(R);
    this.push([v0, v1, v1.clone().add(up), v0.clone().add(up)], rect);
    if (back) { const b0 = v1.clone(), b1 = v0.clone(); this.push([b0, b1, b1.clone().add(up), b0.clone().add(up)], back); }
  }
  flat(x: number, y: number, z: number, r: [number, number], fwd: [number, number], width: number, depth: number, rect: UvRect): void {
    const R = new THREE.Vector3(r[0], 0, r[1]).multiplyScalar(width / 2), F = new THREE.Vector3(fwd[0], 0, fwd[1]).multiplyScalar(depth / 2), p = new THREE.Vector3(x, y, z);
    const v = [p.clone().sub(R).sub(F), p.clone().add(R).sub(F), p.clone().add(R).add(F), p.clone().sub(R).add(F)];
    const normalY = new THREE.Vector3().subVectors(v[1]!, v[0]!).cross(new THREE.Vector3().subVectors(v[2]!, v[0]!)).y;
    if (normalY < 0) { this.push([v[1]!, v[0]!, v[3]!, v[2]!], { ...rect, u0: rect.u1, u1: rect.u0 }); return; }
    this.push(v, rect);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2)); g.setIndex(this.indices);
    g.computeVertexNormals(); return g;
  }
}

/** Seat crop regions (fractions of the single-seat crop, canvas y down). */
export const ART_REGIONS = Object.freeze({
  backFront: { x0: 0.08, x1: 0.92, y0: 0.06, y1: 0.55 },
  seatFront: { x0: 0.08, x1: 0.92, y0: 0.55, y1: 0.8 },
  seatTop: { x0: 0.1, x1: 0.9, y0: 0.58, y1: 0.72 },
  backTop: { x0: 0.1, x1: 0.9, y0: 0.05, y1: 0.14 },
});
const subRect = (r: UvRect, f: { x0: number; x1: number; y0: number; y1: number }): UvRect =>
  ({ u0: r.u0 + (r.u1 - r.u0) * f.x0, u1: r.u0 + (r.u1 - r.u0) * f.x1, v1: r.v1 - (r.v1 - r.v0) * f.y0, v0: r.v1 - (r.v1 - r.v0) * f.y1 });

/** One art-wrapped chair (front toward local +Z, standing on y = 0): pedestal, seat block and backrest block. */
export function artChairGeometry(seat: UvRect, dark: UvRect): THREE.BufferGeometry {
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, faces: Partial<Record<number, UvRect>>) => {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let face = 0; face < 6; face++) {
      const rect = faces[face] ?? dark;
      for (let k = 0; k < 4; k++) {
        const i = face * 4 + k;
        uv.setXY(i, rect.u0 + uv.getX(i) * (rect.u1 - rect.u0), rect.v0 + uv.getY(i) * (rect.v1 - rect.v0));
      }
    }
    return g;
  };
  const parts = [
    box(0.1, 0.12, 0.1, 0, 0.06, 0, {}),
    box(0.4, 0.1, 0.3, 0, 0.17, 0.02, { 2: subRect(seat, ART_REGIONS.seatTop), 4: subRect(seat, ART_REGIONS.seatFront) }),
    box(0.4, 0.34, 0.06, 0, 0.39, -0.13, { 2: subRect(seat, ART_REGIONS.backTop), 4: subRect(seat, ART_REGIONS.backFront) }),
  ];
  const merged = mergeGeometries(parts, false)!; parts.forEach((part) => part.dispose()); return merged;
}

/** The furniture meshes for one bake: one stair/shelter mesh (unlit atlas) and one chair InstancedMesh per colour. The
 *  caller adds them to its scene and disposes their geometries and materials; the two textures stay the caller's. */
export function buildStandFurniture(options: {
  layout: SeatAtlasLayout;
  atlasTexture: THREE.Texture;
  pixelTexture: THREE.Texture;
  tops: readonly StandTierTop[];
  probe?: (x: number, z: number, y: number) => boolean;
  sampler: SurfaceSampler;
}): { meshes: THREE.Mesh[]; placed: PlacedSeat[]; chairs: number; aisles: number; shelters: number } {
  const { layout } = options, quads = new QuadBuffer();
  const slots = seatSlotsFromTops(options.tops, CHAIR_BACK_OFFSET, options.probe);
  // Stairs: the art's top (the far step) toward the stand's back, flat on the tier top.
  for (const aisle of slots.aisles) quads.flat(aisle.x, aisle.y + 0.003, aisle.z, aisle.r, [-aisle.n[0], -aisle.n[1]], aisle.width, aisle.depth, layout.stairs);
  const shelters = shelterSlots();
  for (const shelter of shelters) {
    const i = shelter.isHome ? 0 : 1, rect = layout.shelters[i]!;
    quads.card(shelter.x, shelter.y, shelter.z, shelter.r, shelter.width, shelter.width / rect.aspect, rect, layout.shelterDark[i]);
  }
  const meshes: THREE.Mesh[] = [];
  const furniture = new THREE.Mesh(quads.geometry(), new THREE.MeshBasicMaterial({ map: options.atlasTexture, alphaTest: 0.5, toneMapped: false }));
  furniture.name = 'stand-furniture'; meshes.push(furniture);
  const placed = placeChairs(slots.seats, options.sampler);
  for (const colour of ['blue', 'red', 'yellow', 'green'] as const) {
    const seats = placed.filter((seat) => seat.colour === colour);
    if (!seats.length) continue;
    const geometry = artChairGeometry(layout.seats[COLOUR_INDEX[colour]]!, layout.dark[COLOUR_INDEX[colour]]!);
    const material = new THREE.MeshStandardMaterial({ map: options.pixelTexture, roughness: 0.85 });
    const mesh = new THREE.InstancedMesh(geometry, material, seats.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
    seats.forEach((seat, i) => {
      q.setFromAxisAngle(yAxis, Math.atan2(seat.n[0], seat.n[1])); // local +Z (the chair's front) -> the pitch
      m.compose(new THREE.Vector3(seat.x, seat.y, seat.z), q, new THREE.Vector3(1, 1, 1)); mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.name = `stand-chairs-${colour}`; mesh.castShadow = true; mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  return { meshes, placed, chairs: placed.length, aisles: slots.aisles.length, shelters: shelters.length };
}
