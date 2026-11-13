import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The purchased stadium model for the 2D client's baked backdrop (owner 11-09: "We can merge the 3d stadium in"), lifted
 * from the Modern 3D branch (pitch3d/stadium.ts): the pack's registration onto pitch space and the merge into ONE
 * skinned mesh. Pitch space = the 3D convention: x = game x (0..26 along the long axis), z = game y (0..15), y up, one
 * unit per square. Nothing here keeps a GPU resource; bake.ts owns and disposes everything it builds.
 */
export interface StadiumBakePack {
  schemaVersion: 2;
  id: string;
  model: { path: string; sha256?: string };
  pitchRegistration: {
    logicalSize: [number, number];
    northWest: [number, number, number];
    northEast: [number, number, number];
    southEast: [number, number, number];
    southWest: [number, number, number];
    overlayElevation?: number;
  };
  scene3d?: {
    /** Scale about the registered 26x15 centre, then translate in pitch-space X/Z units. */
    horizontalFit?: { scale: [number, number]; offset?: [number, number] };
    /** Exact glTF node/mesh names left out of the bake (the field debris under the pitch). */
    hiddenMeshes?: string[];
  };
}

function horizontalFit(pack: StadiumBakePack): { sx: number; sz: number; ox: number; oz: number } {
  const fit = pack.scene3d?.horizontalFit;
  return { sx: fit?.scale[0] ?? 1, sz: fit?.scale[1] ?? 1, ox: fit?.offset?.[0] ?? 0, oz: fit?.offset?.[1] ?? 0 };
}

/** Model point -> pitch space. Registration is affine and right-handed; the fit expands around the pitch centre. */
export function stadiumModelPointToWorld(pack: StadiumBakePack, point: Pick<THREE.Vector3, 'x' | 'y' | 'z'>): THREE.Vector3 {
  const r = pack.pitchRegistration;
  const [cols, rows] = r.logicalSize;
  const ex = r.northEast[0] - r.northWest[0];
  const sz = r.southWest[2] - r.northWest[2];
  const registeredX = (point.x - r.northWest[0]) / ex * cols;
  const registeredZ = (point.z - r.northWest[2]) / sz * rows;
  const fit = horizontalFit(pack);
  return new THREE.Vector3(
    cols / 2 + (registeredX - cols / 2) * fit.sx + fit.ox,
    point.y - r.northWest[1] + (r.overlayElevation ?? 0),
    rows / 2 + (registeredZ - rows / 2) * fit.sz + fit.oz,
  );
}

/** Matrix form of stadiumModelPointToWorld, applied once to the loaded root. */
export function stadiumRegistrationMatrix(pack: StadiumBakePack): THREE.Matrix4 {
  const origin = stadiumModelPointToWorld(pack, { x: 0, y: 0, z: 0 });
  const x = stadiumModelPointToWorld(pack, { x: 1, y: 0, z: 0 }).sub(origin);
  const y = stadiumModelPointToWorld(pack, { x: 0, y: 1, z: 0 }).sub(origin);
  const z = stadiumModelPointToWorld(pack, { x: 0, y: 0, z: 1 }).sub(origin);
  return new THREE.Matrix4().set(
    x.x, y.x, z.x, origin.x,
    x.y, y.y, z.y, origin.y,
    x.z, y.z, z.z, origin.z,
    0, 0, 0, 1,
  );
}

/** Exact-name visibility plus registration. */
export function prepareStadiumObject(root: THREE.Object3D, pack: StadiumBakePack): THREE.Object3D {
  const hidden = new Set(pack.scene3d?.hiddenMeshes ?? []);
  root.traverse((object) => { if (hidden.has(object.name)) object.visible = false; });
  root.applyMatrix4(stadiumRegistrationMatrix(pack));
  root.updateMatrixWorld(true);
  return root;
}

export async function parseStadiumGlb(data: ArrayBuffer, pack: StadiumBakePack): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().parseAsync(data, '');
  return prepareStadiumObject(gltf.scene, pack);
}

/** Every visible node baked to world space (position + normal) as ONE geometry, for the stand skin. */
export function mergeStadiumGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    let visible = object.visible;
    for (let parent = object.parent; visible && parent; parent = parent.parent) visible = parent.visible;
    if (!visible) return;
    const geometry = (object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()).applyMatrix4(object.matrixWorld);
    for (const name of Object.keys(geometry.attributes)) if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    geometry.morphAttributes = {};
    parts.push(geometry);
  });
  if (!parts.length) return null;
  const geometry = parts.length === 1 ? parts[0]! : mergeGeometries(parts, false);
  if (parts.length > 1) parts.forEach((part) => part.dispose());
  return geometry ?? null;
}

/** Release every geometry, material and texture under a loaded glTF root. */
export function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      (material as THREE.MeshStandardMaterial).map?.dispose();
      material.dispose();
    }
  });
}
