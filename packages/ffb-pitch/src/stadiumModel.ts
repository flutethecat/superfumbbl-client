/**
 * Stadium GLB ingestion (owner 09-05, "option 1"): a stadium pack's glTF-binary model is rendered ONCE, top-down,
 * to a plan-view texture at a fixed pixel density, and the renderer lays that texture onto the pitch's own
 * perspective quad (PerspectiveMesh) exactly like the turf. Zero per-frame 3D cost; the ground plane registers
 * pixel-for-pixel with the squares. Everything on the ground is exact; tall structures show their tops (a tilt can
 * be added per pack later — `render.tiltDegrees` is reserved).
 *
 * Pack contract = `stadium-pack.json` schemaVersion 1 (the Stadium3dModel prototype schema): the model's pitch
 * surface is registered by its four corner points in MODEL units (`pitchRegistration`), Y up, and `logicalSize`
 * gives the pitch in squares (26 x 15). Model X/Z map linearly onto square coordinates from those corners.
 * three.js is imported lazily so the 3D stack stays out of the main bundle until a pack is present.
 */
import { Texture } from 'pixi.js';

export interface StadiumPackManifest {
  schemaVersion: 1;
  id: string;
  name?: string;
  version?: string;
  model: { path: string; sha256?: string; mime?: string };
  pitchRegistration: {
    logicalSize: [number, number];
    northWest: [number, number, number];
    northEast: [number, number, number];
    southEast: [number, number, number];
    southWest: [number, number, number];
    overlayElevation?: number;
  };
  render?: {
    /** Plan-view density; default 64 (the turf's own density). Output is capped at 4096 px per side. */
    pixelsPerSquare?: number;
    /** Squares of stadium beyond the pitch to include per side; default = the whole model. */
    margin?: number;
    /** Reserved: a camera tilt for facades. Ignored (0) today. */
    tiltDegrees?: number;
    /** Hex background behind the model; default transparent. */
    background?: string;
  };
  /** Owner 09-06 (stadium-3d-dugouts handoff): `provided` = the model carries the dugout floors + box chrome at the
   *  client's dugout rectangles, so drawDugouts skips its procedural ground/trim/separators and keeps only the
   *  labels, tokens, markers and hit areas. Only honoured while the pack's plan is actually on screen. */
  dugouts?: { provided?: boolean };
  /** Free-form provenance record (source / author / license / notes) — informational, never validated. */
  provenance?: { source?: string; author?: string; license?: string; notes?: string };
}

/** A rectangle in SQUARE coordinates: (0,0) = the pitch's north-west corner, x east 0..cols, y south 0..rows. */
export interface SquareRect { x0: number; y0: number; x1: number; y1: number }

export interface RenderedStadium {
  texture: Texture;
  /** The square-space extent the plan covers (axis-aligned bounds of `corners`). */
  footprint: SquareRect;
  /** Where the IMAGE's four corners land in square coordinates — top-left / top-right / bottom-right / bottom-left
   *  of the plan texture. NOT the same as the footprint corners: the plan is a true top-down view (model +X right,
   *  +Z down the image), and with the prototype registration north = +Z, so the image's top edge is the SOUTH edge
   *  of the footprint. The renderer maps these through the pitch projection so registration, not the image layout,
   *  decides where the model lands. */
  corners: PlanCorners;
  pixelsPerSquare: number;
  /** The manifest's `dugouts.provided` (false when absent). */
  dugoutsProvided: boolean;
}

export interface PlanCorners {
  tl: { u: number; v: number };
  tr: { u: number; v: number };
  br: { u: number; v: number };
  bl: { u: number; v: number };
}

interface Bounds3 { min: [number, number, number]; max: [number, number, number] }

/** Model (x, z) -> square coordinates, from the registration corners. Pure; unit-tested. */
export function modelToSquare(manifest: StadiumPackManifest, x: number, z: number): { u: number; v: number } {
  const r = manifest.pitchRegistration;
  const [cols, rows] = r.logicalSize;
  const ex = r.northEast[0] - r.northWest[0]; // east axis in model X
  const sz = r.southWest[2] - r.northWest[2]; // south axis in model Z
  const u = ex === 0 ? 0 : ((x - r.northWest[0]) / ex) * cols;
  const v = sz === 0 ? 0 : ((z - r.northWest[2]) / sz) * rows;
  return { u: u === 0 ? 0 : u, v: v === 0 ? 0 : v }; // (-0 -> 0)
}

/** The square-space footprint of a model's bounds (optionally clipped to `margin` squares around the pitch). */
export function stadiumFootprint(manifest: StadiumPackManifest, bounds: Bounds3): SquareRect {
  const corners = [
    modelToSquare(manifest, bounds.min[0], bounds.min[2]),
    modelToSquare(manifest, bounds.max[0], bounds.min[2]),
    modelToSquare(manifest, bounds.min[0], bounds.max[2]),
    modelToSquare(manifest, bounds.max[0], bounds.max[2]),
  ];
  let x0 = Math.min(...corners.map((c) => c.u)), x1 = Math.max(...corners.map((c) => c.u));
  let y0 = Math.min(...corners.map((c) => c.v)), y1 = Math.max(...corners.map((c) => c.v));
  const margin = manifest.render?.margin;
  if (margin !== undefined && Number.isFinite(margin)) {
    const [cols, rows] = manifest.pitchRegistration.logicalSize;
    x0 = Math.max(x0, -margin); y0 = Math.max(y0, -margin);
    x1 = Math.min(x1, cols + margin); y1 = Math.min(y1, rows + margin);
  }
  return { x0, y0, x1, y1 };
}

/** Square-space rect -> model-space X/Z rect (inverse of modelToSquare), for the orthographic camera frustum. */
export function squareRectToModel(manifest: StadiumPackManifest, rect: SquareRect): { x0: number; z0: number; x1: number; z1: number } {
  const r = manifest.pitchRegistration;
  const [cols, rows] = r.logicalSize;
  const ex = (r.northEast[0] - r.northWest[0]) / cols;
  const sz = (r.southWest[2] - r.northWest[2]) / rows;
  const xa = r.northWest[0] + rect.x0 * ex, xb = r.northWest[0] + rect.x1 * ex;
  const za = r.northWest[2] + rect.y0 * sz, zb = r.northWest[2] + rect.y1 * sz;
  return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(za, zb), z1: Math.max(za, zb) };
}

/**
 * Square-space positions of a plan image's four corners. The image is a true top-down view of the model X/Z rect:
 * left = min X, right = max X, top = min Z, bottom = max Z (see renderStadiumPack's camera). Pure; unit-tested —
 * with north = +Z the top-left of the image lands at the footprint's SOUTH-west corner.
 */
export function planImageCorners(manifest: StadiumPackManifest, model: { x0: number; z0: number; x1: number; z1: number }): PlanCorners {
  return {
    tl: modelToSquare(manifest, model.x0, model.z0),
    tr: modelToSquare(manifest, model.x1, model.z0),
    br: modelToSquare(manifest, model.x1, model.z1),
    bl: modelToSquare(manifest, model.x0, model.z1),
  };
}

export function validateStadiumPack(raw: unknown): StadiumPackManifest {
  const m = raw as StadiumPackManifest;
  if (!m || m.schemaVersion !== 1 || typeof m.id !== 'string' || !m.model?.path) throw new Error('Invalid stadium pack manifest');
  const r = m.pitchRegistration;
  const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n));
  if (!r || !Array.isArray(r.logicalSize) || r.logicalSize.length !== 2 || !r.logicalSize.every((n) => Number.isInteger(n) && n > 0)
    || !isVec3(r.northWest) || !isVec3(r.northEast) || !isVec3(r.southEast) || !isVec3(r.southWest)) {
    throw new Error('Invalid stadium pack registration');
  }
  if (r.northEast[0] === r.northWest[0] || r.southWest[2] === r.northWest[2]) throw new Error('Degenerate stadium pack registration');
  if (m.dugouts !== undefined && (typeof m.dugouts !== 'object' || m.dugouts === null || (m.dugouts.provided !== undefined && typeof m.dugouts.provided !== 'boolean'))) {
    throw new Error('Invalid stadium pack dugouts flag');
  }
  return m;
}

const MAX_SIDE_PX = 4096;

/**
 * Load the GLB and render it once, top-down, into a Pixi texture. Model X runs left->right in the image and model
 * Z runs top->bottom (a true plan view of a Y-up scene: right = +X, up = -Z), so the image's top-left corner is
 * (min X, min Z). The returned `corners` carry each image corner through the registration, and the renderer
 * projects THOSE through the pitch geometry — whichever way north points in the model, the plan lands registered
 * (09-06: with north = +Z the image is laid on the quad south-edge-up; nothing is mirrored in GL or in the asset).
 */
export async function renderStadiumPack(manifest: StadiumPackManifest, modelUrl: string): Promise<RenderedStadium> {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const scene = new THREE.Scene();
  scene.add(gltf.scene);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(-1, 3, 1.5); // above, from the south-west
  scene.add(sun);

  const box = new THREE.Box3().setFromObject(gltf.scene);
  const bounds: Bounds3 = { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
  const footprint = stadiumFootprint(manifest, bounds);
  const model = squareRectToModel(manifest, footprint);
  const requested = manifest.render?.pixelsPerSquare ?? 64;
  const spanX = footprint.x1 - footprint.x0, spanY = footprint.y1 - footprint.y0;
  const pixelsPerSquare = Math.max(4, Math.min(requested, MAX_SIDE_PX / Math.max(spanX, spanY)));
  const width = Math.max(1, Math.round(spanX * pixelsPerSquare));
  const height = Math.max(1, Math.round(spanY * pixelsPerSquare));

  // orthographic plan view: camera above the model, looking straight down; +X right, +Z down the image
  const camera = new THREE.OrthographicCamera(model.x0, model.x1, -model.z0, -model.z1, 0.1, (box.max.y - box.min.y) + 20);
  // (top = -z0, bottom = -z1 with `up` = -Z puts min Z at the top of the image and +X to the right)
  camera.position.set(0, box.max.y + 10, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  const gl = new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true });
  try {
    gl.setPixelRatio(1);
    gl.setSize(width, height, false);
    gl.outputColorSpace = THREE.SRGBColorSpace;
    const bg = manifest.render?.background;
    gl.setClearColor(bg ? new THREE.Color(bg) : 0x000000, bg ? 1 : 0);
    gl.render(scene, camera);
    // copy the pixels out so the GL context can be released (the Pixi texture keeps the 2D canvas)
    const copy = document.createElement('canvas');
    copy.width = width; copy.height = height;
    const ctx = copy.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable for the stadium plan');
    ctx.drawImage(gl.domElement, 0, 0);
    const texture = Texture.from(copy);
    texture.source.scaleMode = 'nearest';
    texture.source.autoGenerateMipmaps = true;
    return { texture, footprint, corners: planImageCorners(manifest, model), pixelsPerSquare, dugoutsProvided: manifest.dugouts?.provided === true };
  } finally {
    gl.dispose();
    gl.forceContextLoss();
    gltf.scene.traverse((o) => {
      const mesh = o as { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] };
      mesh.geometry?.dispose?.();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose()); else mat?.dispose?.();
    });
  }
}
