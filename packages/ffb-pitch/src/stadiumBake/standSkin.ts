import * as THREE from 'three';
import type { StadiumStandColour, StadiumStandSide } from '../stadiumTiles';

/**
 * The stand skin of the Modern 3D stadium, lifted from pitch3d/standSkin.ts for the 2D baked backdrop, in the mode the
 * owner picked on 11-06 (3D chairs on the tiers): every upright face of the stadium model (the tier fronts, the
 * risers) wears the stone wall module, every level face (tier tops, floor slabs, the apron) the cobble. The painted
 * seat atlases and baked-crowd tiles of the flat mode are not brought over: the chairs ARE the seats.
 */

export interface StandBand { stand: StadiumStandSide; colour: StadiumStandColour; x0: number; x1: number; z0: number; z1: number }
/** renderer.ts drawBand calls: home blue, away red, near end yellow, far end green (inclusive cell ranges). */
export const STAND_BANDS: readonly StandBand[] = Object.freeze([
  { stand: 'home', colour: 'blue', x0: -1, x1: 26, z0: -10, z1: -5 },
  { stand: 'away', colour: 'red', x0: -1, x1: 26, z0: 19, z1: 24 },
  { stand: 'nearEnd', colour: 'yellow', x0: -7, x1: -2, z0: -10, z1: 24 },
  { stand: 'farEnd', colour: 'green', x0: 27, x1: 32, z0: -10, z1: 24 },
]);
/** The 2D band colour of each stand (renderer.ts drawBand): the seat colours of the baked stands. */
export const STAND_COLOUR: Readonly<Record<StadiumStandSide, StadiumStandColour>> = { home: 'blue', away: 'red', nearEnd: 'yellow', farEnd: 'green' };

/** Every stand seat faces the pitch; r = the tile's right on the ground (x, z). The 2D seat atlas advances along r. */
export const STAND_TILE_RIGHT: Readonly<Record<StadiumStandSide, readonly [number, number]>> = Object.freeze({
  home: [1, 0], away: [-1, 0], nearEnd: [0, -1], farEnd: [0, 1],
});
/** Atlas column of a 2D classic seat tile; column 3 is the aisle (stairs), so the baked aisles fall where 2D drew them. */
export function standClassicColumn(stand: StadiumStandSide, x: number, z: number): number {
  const r = STAND_TILE_RIGHT[stand], along = x * r[0] + z * r[1];
  return ((along % 4) + 4) % 4;
}

/** The stand a model point belongs to. */
export function standOfPoint(x: number, z: number): StadiumStandSide {
  return x < -1 ? 'nearEnd' : x >= 27 ? 'farEnd' : z < 7.5 ? 'home' : 'away';
}

/** The cobble apron under the whole bake: the 2D stand footprint (cells x -7..32, z -10..24) plus a square of margin
 *  for the model's outer walls (it reaches z -10.4 / 25.4). */
export const APRON_Y = -0.025;
export const APRON_RECT = Object.freeze({ x0: -7, x1: 33, z0: -11, z1: 26 });

/** One model tier top: its stand, height, and extent in the stand's outward axis (inner = pitch edge, outer = back)
 *  and along axis (x on the long stands, z on the ends). */
export interface StandTierTop { stand: StadiumStandSide; y: number; inner: number; outer: number; along0: number; along1: number }

/**
 * The model's flat tier tops (pitch3d/standSkin.ts stadiumTierAnalysis): upward faces above the seat floor joined into
 * connected surfaces (union-find over shared vertex positions), split per stand; a group 0.2..2.5 squares deep is a tier
 * (deeper ones are floor slabs and roofs). `geometry` is world space and non-indexed (mergeStadiumGeometry).
 */
export function stadiumTierTops(geometry: THREE.BufferGeometry, seatMinY = 0.12): StandTierTop[] {
  const position = geometry.getAttribute('position'), count = position.count;
  const outward = (stand: StadiumStandSide, x: number, z: number) => stand === 'home' ? -z : stand === 'away' ? z : stand === 'nearEnd' ? -x : x;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const tris: Array<{ t: number; stand: StadiumStandSide }> = [], parent: number[] = [], byVertex = new Map<string, number>();
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  const vkey = (v: THREE.Vector3) => `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
  for (let t = 0; t + 2 < count; t += 3) {
    a.fromBufferAttribute(position, t); b.fromBufferAttribute(position, t + 1); c.fromBufferAttribute(position, t + 2);
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    if (n.y < 0.64 || Math.min(a.y, b.y, c.y) < seatMinY) continue;
    const index = tris.length; tris.push({ t, stand: standOfPoint((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3) }); parent.push(index);
    for (const v of [a, b, c]) {
      const key = vkey(v), other = byVertex.get(key);
      if (other === undefined) byVertex.set(key, index); else { const ra = find(other), rb = find(index); if (ra !== rb) parent[rb] = ra; }
    }
  }
  const groups = new Map<string, { min: number; max: number; a0: number; a1: number; y: number; stand: StadiumStandSide }>();
  tris.forEach(({ t, stand }, index) => {
    const key = `${find(index)}|${stand}`, group = groups.get(key) ?? { min: Infinity, max: -Infinity, a0: Infinity, a1: -Infinity, y: 0, stand };
    for (let k = 0; k < 3; k++) {
      const x = position.getX(t + k), z = position.getZ(t + k), o = outward(stand, x, z), al = stand === 'home' || stand === 'away' ? x : z;
      group.min = Math.min(group.min, o); group.max = Math.max(group.max, o); group.a0 = Math.min(group.a0, al); group.a1 = Math.max(group.a1, al);
      group.y = Math.max(group.y, position.getY(t + k));
    }
    groups.set(key, group);
  });
  const tops: StandTierTop[] = [];
  for (const group of groups.values()) {
    const depth = group.max - group.min;
    if (depth < 0.2 || depth > 2.5) continue;
    tops.push({ stand: group.stand, y: group.y, inner: group.min, outer: group.max, along0: group.a0, along1: group.a1 });
  }
  return tops;
}

const FRAGMENT_HEADER = /* glsl */`
uniform sampler2D skinCobble;
uniform sampler2D skinWall;
varying vec3 vSkinPos;
varying vec3 vSkinNormal;
vec3 skinAlbedo() {
  vec3 n = normalize(vSkinNormal);
  if (abs(n.y) < 0.5) return texture2D(skinWall, vec2((vSkinPos.x + vSkinPos.z) / 1.9, vSkinPos.y / 0.32)).rgb * 0.9;
  return texture2D(skinCobble, vSkinPos.xz).rgb * 0.82;
}
`;

/** Patch a MeshStandardMaterial shader with the skin (exported so tests can check the include anchors resolve). */
export function patchStandSkinShader(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }, uniforms: Record<string, THREE.IUniform>): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vSkinPos;\nvarying vec3 vSkinNormal;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvSkinPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSkinNormal = normalize(mat3(modelMatrix) * objectNormal);');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAGMENT_HEADER}`)
    .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= skinAlbedo();');
}

/** The skin material over the stadium model and the apron; the caller owns (and disposes) both textures. */
export function createStandSkinMaterial(cobble: THREE.Texture, wall: THREE.Texture): THREE.MeshStandardMaterial {
  const uniforms: Record<string, THREE.IUniform> = { skinCobble: { value: cobble }, skinWall: { value: wall } };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93 });
  material.name = 'stand-skin';
  material.onBeforeCompile = (shader) => patchStandSkinShader(shader, uniforms);
  material.customProgramCacheKey = () => 'stand-skin-baked';
  return material;
}
