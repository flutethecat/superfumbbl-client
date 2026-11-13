import * as THREE from 'three';
import packJson from '../../assets/stadium3d/stadium-pack.json';
import { mergeStadiumGeometry, parseStadiumGlb, disposeObjectTree, type StadiumBakePack } from './stadium';
import { APRON_RECT, APRON_Y, createStandSkinMaterial, stadiumTierTops } from './standSkin';
import { buildStandFurniture, paintSeatAtlas, standPitchward, surfaceSamplerFromGeometry, STAND_SEAT_ART_URLS, type AtlasImage, type Canvas2DLike } from './standSeats';
import { CROWD_ART_URLS, CROWD_FRONT_OFFSET, CROWD_HEIGHT, chairsPerStand, crowdGeometry, paintCrowdAtlas, seatCrowd, type CrowdDensity } from './crowd';

/**
 * Owner 11-09 (reconfirmed 11-12): the 3D stadium in the 2D client as a BAKED BACKDROP. The purchased stadium model,
 * skinned as in Modern 3D (stone walls and cobble), with its 3D chairs, aisle stairs and bench shelters, is rendered
 * ONCE with three.js into an offscreen WebGL2 canvas from a fixed orthographic camera that looks up the 2D screen
 * (from the near side, `elevation` above the ground), copied into a 2D canvas, and every three.js object (renderer,
 * context, scene, geometries, materials, textures, shadow map) is released before the promise resolves. The 2D
 * renderer lays the image around the pitch on a mesh whose vertices sit at extPoint() of the ground point each texel
 * shows, so the ground registers on the 2D squares exactly and height reads as the lean of the 2D view.
 */

export const STADIUM_BAKE_PACK = packJson as unknown as StadiumBakePack;
/**
 * Owner 11-12: the purchased model is installer-only. It sits on public-export.exclude, so a public source checkout has
 * no .glb: it is GLOBBED (a missing file is an empty map, not a build error) and a tree without it bakes nothing; the
 * bake then fails as a missing pack and the client keeps the classic 2D stands. Private-tree builds bundle it.
 */
const MODEL_URLS = import.meta.glob<string>('../../assets/stadium3d/*.glb', { eager: true, query: '?url', import: 'default' });
/** The bundled model URL the manifest names, or null when the file is absent (the public source export). */
export function bundledStadiumModelUrl(urls: Readonly<Record<string, string>>, pack: StadiumBakePack): string | null {
  const name = `/${pack.model.path.replace(/^\.\//, '')}`;
  return Object.entries(urls).find(([path]) => path.endsWith(name))?.[1] ?? null;
}
export const STADIUM_BAKE_MODEL_URL: string | null = bundledStadiumModelUrl(MODEL_URLS, STADIUM_BAKE_PACK);
export const STADIUM_BAKE_COBBLE_URL = new URL('../../assets/ground/cobble.png', import.meta.url).href;
export const STADIUM_BAKE_WALL_URL = new URL('../../assets/stadium/stand_wall_stone.png', import.meta.url).href;

/** Pitch centre in pitch space: the camera aims here. */
const CENTRE = new THREE.Vector3(13, 0, 7.5);
const CAMERA_DISTANCE = 200;

export interface StadiumBakeRequest {
  /** The ground direction (x, z) that runs UP the 2D screen (the far direction): one of +-x, +-z. */
  farDir: readonly [number, number];
  /** Camera elevation above the ground plane, radians (the 2D view's square foreshortening: asin(TILE_H / TILE_W)). */
  elevation: number;
  /** Wanted texels per square across the screen; capped so neither image side exceeds maxSidePx. */
  pixelsPerSquare: number;
  maxSidePx: number;
  /** Crowd attendance per side (renderer.ts fanDensity of each team's Dedicated Fans), 0..1. */
  crowd: CrowdDensity;
}

export interface SquarePoint { u: number; v: number }
/** Where the image's four corners land in square coordinates (u = game x, v = game y), all integers. */
export interface StadiumBakeCorners { tl: SquarePoint; tr: SquarePoint; br: SquarePoint; bl: SquarePoint }

export interface StadiumBakeResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  corners: StadiumBakeCorners;
  pixelsPerSquare: number;
  stats: { ms: number; chairs: number; aisles: number; shelters: number; fans: number;
    /** Chairs on each stand: the renderer keys bakes on seated counts (crowd.ts seatedCount) once it knows them. */
    chairsByStand?: Record<'home' | 'away' | 'nearEnd' | 'farEnd', number> };
  /** Where each baked fan stands (pitch space: feet x/z, the tier y under the feet, card height), for the renderer's
   *  logical crowd anchors (rocks, quips and cheers start from a real baked fan). */
  fans: BakedFan[];
}
export interface BakedFan { x: number; y: number; z: number; height: number; stand: 'home' | 'away' | 'end' }

/** Everything the bake reaches outside three.js, injectable for tests. */
export interface StadiumBakeDeps {
  /** The model to bake (default: the bundled one, null when the file is absent). */
  modelUrl?: string | null;
  /** Cheap support check before any load (the context itself is created only after every asset has arrived). */
  hasWebGL2(): boolean;
  /** A canvas plus its WebGL2 context (null = none could be created). */
  createGlContext(): { canvas: HTMLCanvasElement; context: StadiumBakeGl } | null;
  createCanvas(): Canvas2DLike & CanvasImageSource;
  createRenderer(params: { canvas: HTMLCanvasElement; context: StadiumBakeGl }): StadiumBakeRenderer;
  loadModel(url: string, signal?: AbortSignal): Promise<ArrayBuffer>;
  loadImage(url: string, signal?: AbortSignal): Promise<AtlasImage>;
  now(): number;
  /** Test hook: the finished scene, just before it is released. */
  inspectScene?(scene: THREE.Scene): void;
}

/** The slice of THREE.WebGLRenderer the bake uses. */
export interface StadiumBakeRenderer {
  readonly domElement: HTMLCanvasElement;
  outputColorSpace: string;
  shadowMap: { enabled: boolean; type: THREE.ShadowMapType };
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
  getContext(): { isContextLost(): boolean; drawingBufferWidth: number; drawingBufferHeight: number };
  dispose(): void;
  forceContextLoss(): void;
}

/** The slice of the WebGL2 context the bake reads (its size limits) and releases. */
export interface StadiumBakeGl {
  readonly MAX_TEXTURE_SIZE: number; readonly MAX_RENDERBUFFER_SIZE: number; readonly MAX_VIEWPORT_DIMS: number;
  getParameter(name: number): unknown;
  getExtension(name: string): unknown;
}

/** The largest square image both limits of a context allow (texture, renderbuffer and viewport). */
export function contextMaxSide(gl: StadiumBakeGl): number {
  const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : Infinity);
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as ArrayLike<number> | null;
  return Math.min(num(gl.getParameter(gl.MAX_TEXTURE_SIZE)), num(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),
    num(viewport?.[0]), num(viewport?.[1]));
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('stadium bake cancelled');
}

export function browserStadiumBakeDeps(): StadiumBakeDeps {
  return {
    hasWebGL2: () => typeof WebGL2RenderingContext !== 'undefined' && typeof document !== 'undefined',
    createGlContext() {
      if (typeof document === 'undefined') return null;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
      return context ? { canvas, context: context as unknown as StadiumBakeGl } : null;
    },
    createCanvas: () => document.createElement('canvas'),
    createRenderer: ({ canvas, context }) => new THREE.WebGLRenderer({ canvas, context: context as unknown as WebGL2RenderingContext, alpha: true, antialias: true, preserveDrawingBuffer: true }),
    async loadModel(url, signal) {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`stadium model request failed (${response.status})`);
      return response.arrayBuffer();
    },
    loadImage: (url, signal) => new Promise((resolve, reject) => {
      const image = new Image();
      const onAbort = () => { image.onload = image.onerror = null; image.src = ''; reject(abortError(signal!)); };
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
      image.onload = () => { signal?.removeEventListener('abort', onAbort); resolve(image); };
      image.onerror = () => { signal?.removeEventListener('abort', onAbort); reject(new Error(`stadium art failed: ${url}`)); };
      image.src = url;
    }),
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  };
}

/** The camera frame of a bake: the integer ground rectangle the image covers and the orthographic frustum over it. */
export interface StadiumBakeFrame {
  /** Camera right on the ground (x, z) and the far direction. */
  right: [number, number];
  far: [number, number];
  /** Frustum in camera units: left/right along `right`, bottom/top = sin(elevation) x the ground depth range. */
  left: number; rightEdge: number; bottom: number; top: number;
  /** Ground extent in squares across (along `right`) and deep (along `far`). */
  across: number; deep: number;
  corners: StadiumBakeCorners;
}

/**
 * Pure framing. A point at height y over ground (x, z) shows in the image where the ground point `y / tan(elevation)`
 * squares further along `far` would, so the content box's corners are carried to that "ground-equivalent" depth, the
 * hull is rounded OUT to whole squares, and the frustum is fitted to that integer ground rectangle: every image edge
 * then lies on a square boundary, which is what lets the 2D mesh register exactly.
 */
export function stadiumBakeFrame(farDir: readonly [number, number], elevation: number, content: THREE.Box3): StadiumBakeFrame {
  const far: [number, number] = [Math.sign(farDir[0]) || 0, Math.sign(farDir[1]) || 0];
  if (Math.abs(far[0]) + Math.abs(far[1]) !== 1) throw new Error('stadium bake: farDir must be an axis direction');
  const right: [number, number] = [-far[1], far[0]];
  const cot = 1 / Math.tan(elevation), sin = Math.sin(elevation);
  const along = (x: number, z: number) => (x - CENTRE.x) * right[0] + (z - CENTRE.z) * right[1];
  const depth = (x: number, z: number) => (x - CENTRE.x) * far[0] + (z - CENTRE.z) * far[1];
  let a0 = Infinity, a1 = -Infinity, d0 = Infinity, d1 = -Infinity;
  for (const x of [content.min.x, content.max.x]) for (const y of [content.min.y, content.max.y]) for (const z of [content.min.z, content.max.z]) {
    const a = along(x, z), d = depth(x, z) + y * cot;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); d0 = Math.min(d0, d); d1 = Math.max(d1, d);
  }
  // Back to world, round out to whole squares, then forward again.
  const world = (a: number, d: number): [number, number] => [CENTRE.x + a * right[0] + d * far[0], CENTRE.z + a * right[1] + d * far[1]];
  const hull = [world(a0, d0), world(a1, d0), world(a0, d1), world(a1, d1)];
  const x0 = Math.floor(Math.min(...hull.map((p) => p[0])) + 1e-9), x1 = Math.ceil(Math.max(...hull.map((p) => p[0])) - 1e-9);
  const z0 = Math.floor(Math.min(...hull.map((p) => p[1])) + 1e-9), z1 = Math.ceil(Math.max(...hull.map((p) => p[1])) - 1e-9);
  const rect = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]] as const;
  const as = rect.map(([x, z]) => along(x, z)), ds = rect.map(([x, z]) => depth(x, z));
  const left = Math.min(...as), rightEdge = Math.max(...as), dMin = Math.min(...ds), dMax = Math.max(...ds);
  const square = (a: number, d: number): SquarePoint => { const [u, v] = world(a, d); return { u: Math.round(u), v: Math.round(v) }; };
  return {
    right, far, left, rightEdge, bottom: dMin * sin, top: dMax * sin, across: rightEdge - left, deep: dMax - dMin,
    corners: { tl: square(left, dMax), tr: square(rightEdge, dMax), br: square(rightEdge, dMin), bl: square(left, dMin) },
  };
}

/** Image size for a frame: square texels on the ground's across axis, capped at maxSidePx on either side. */
export function stadiumBakeSize(frame: StadiumBakeFrame, elevation: number, pixelsPerSquare: number, maxSidePx: number): { width: number; height: number; pixelsPerSquare: number } {
  const sin = Math.sin(elevation);
  const pps = Math.max(1, Math.min(pixelsPerSquare, maxSidePx / frame.across, maxSidePx / (frame.deep * sin)));
  return { width: Math.max(1, Math.round(frame.across * pps)), height: Math.max(1, Math.round(frame.deep * sin * pps)), pixelsPerSquare: pps };
}

function imageTexture(image: AtlasImage, repeat: boolean): THREE.Texture {
  const texture = new THREE.Texture(image as unknown as HTMLImageElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Bake the stadium once. Throws (after releasing everything) when WebGL2 is missing, the context is lost, the pack or
 * its art fails to load, the drawing buffer cannot take the image, the signal aborts, or anything else goes wrong; the
 * caller keeps the 2D stands then. Nothing three.js creates here outlives the call.
 *
 * Review r1 #3: every asynchronous step (asset loads, the glTF parse) finishes BEFORE the WebGL context exists, and the
 * signal is checked after each; from the context's creation to its release the bake is synchronous, so a stalled
 * request or an unmount can never strand a live context. Review r1 #1: the image is capped at the caller's limit (the
 * 2D renderer's texture size) and at the bake context's own texture, renderbuffer and viewport limits, and the drawing
 * buffer must come out at exactly that size.
 */
export async function bakeStadium(request: StadiumBakeRequest, deps: StadiumBakeDeps = browserStadiumBakeDeps(), signal?: AbortSignal): Promise<StadiumBakeResult> {
  const started = deps.now();
  const checkAbort = () => { if (signal?.aborted) throw abortError(signal); };
  checkAbort();
  const modelUrl = deps.modelUrl === undefined ? STADIUM_BAKE_MODEL_URL : deps.modelUrl;
  if (!modelUrl) throw new Error('stadium model not bundled'); // the public source export: classic stands
  if (!deps.hasWebGL2()) throw new Error('WebGL2 unavailable');
  const textures = new Set<THREE.Texture>();
  const scene = new THREE.Scene();
  let gl: { canvas: HTMLCanvasElement; context: StadiumBakeGl } | null = null;
  let renderer: StadiumBakeRenderer | null = null;
  let loaded: THREE.Object3D | null = null;
  let lost = false;
  const onLost = () => { lost = true; };
  try {
    const [model, cobble, wall, seats, stairs, shelters, crowdArt] = await Promise.all([
      deps.loadModel(modelUrl, signal),
      deps.loadImage(STADIUM_BAKE_COBBLE_URL, signal),
      deps.loadImage(STADIUM_BAKE_WALL_URL, signal),
      Promise.all(STAND_SEAT_ART_URLS.seats.map((url) => deps.loadImage(url, signal))),
      deps.loadImage(STAND_SEAT_ART_URLS.stairs, signal),
      Promise.all(STAND_SEAT_ART_URLS.shelters.map((url) => deps.loadImage(url, signal))),
      Promise.all(CROWD_ART_URLS.map((url) => deps.loadImage(url, signal))),
    ]);
    checkAbort();

    // Stadium model: registered, merged into one skinned mesh; the glTF's own resources are released at once.
    loaded = await parseStadiumGlb(model, STADIUM_BAKE_PACK);
    checkAbort();
    const merged = mergeStadiumGeometry(loaded);
    disposeObjectTree(loaded); loaded = null;
    if (!merged) throw new Error('stadium model has no visible geometry');
    const cobbleTexture = imageTexture(cobble, true), wallTexture = imageTexture(wall, true);
    textures.add(cobbleTexture); textures.add(wallTexture);
    const skin = createStandSkinMaterial(cobbleTexture, wallTexture);
    const stadium = new THREE.Mesh(merged, skin);
    stadium.name = 'baked-stadium'; stadium.castShadow = true; stadium.receiveShadow = true;
    const apronGeometry = new THREE.PlaneGeometry(APRON_RECT.x1 - APRON_RECT.x0, APRON_RECT.z1 - APRON_RECT.z0); apronGeometry.rotateX(-Math.PI / 2);
    const apron = new THREE.Mesh(apronGeometry, skin);
    apron.position.set((APRON_RECT.x0 + APRON_RECT.x1) / 2, APRON_Y, (APRON_RECT.z0 + APRON_RECT.z1) / 2);
    apron.name = 'baked-apron'; apron.receiveShadow = true;
    scene.add(apron, stadium);

    // Chairs, aisle stairs and bench shelters on the model's tier tops.
    const atlasCanvas = deps.createCanvas();
    const layout = paintSeatAtlas(atlasCanvas, { seats, stairs, shelters });
    const atlasTexture = new THREE.CanvasTexture(atlasCanvas as unknown as HTMLCanvasElement);
    atlasTexture.colorSpace = THREE.SRGBColorSpace; atlasTexture.magFilter = THREE.NearestFilter; atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
    const pixelTexture = new THREE.CanvasTexture(atlasCanvas as unknown as HTMLCanvasElement);
    pixelTexture.colorSpace = THREE.SRGBColorSpace; pixelTexture.magFilter = THREE.NearestFilter; pixelTexture.minFilter = THREE.NearestFilter; pixelTexture.generateMipmaps = false;
    textures.add(atlasTexture); textures.add(pixelTexture);
    const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), origin = new THREE.Vector3();
    const probe = (x: number, z: number, y: number) => { ray.set(origin.set(x, 50, z), down); const hit = ray.intersectObject(stadium, false)[0]; return !!hit && Math.abs(hit.point.y - y) < 0.03; };
    const furniture = buildStandFurniture({ layout, atlasTexture, pixelTexture, tops: stadiumTierTops(merged), probe, sampler: surfaceSamplerFromGeometry(merged) });
    scene.add(...furniture.meshes);

    // Owner 11-12: fans in the seats, by the classic 2D stands' rules (crowd.ts), as camera-facing cards.
    const fans = seatCrowd(furniture.placed, request.crowd);
    const crowdCanvas = deps.createCanvas();
    const crowdEntries = paintCrowdAtlas(crowdCanvas, crowdArt, () => deps.createCanvas());
    const crowdTexture = new THREE.CanvasTexture(crowdCanvas as unknown as HTMLCanvasElement);
    crowdTexture.colorSpace = THREE.SRGBColorSpace; crowdTexture.magFilter = THREE.NearestFilter; crowdTexture.minFilter = THREE.LinearMipmapLinearFilter;
    textures.add(crowdTexture);
    const toCamera: [number, number] = [-Math.sign(request.farDir[0]) || 0, -Math.sign(request.farDir[1]) || 0];
    const crowd = new THREE.Mesh(crowdGeometry(fans, crowdEntries, toCamera, standPitchward),
      new THREE.MeshStandardMaterial({ map: crowdTexture, alphaTest: 0.5, roughness: 1, side: THREE.DoubleSide }));
    crowd.name = 'baked-crowd'; crowd.receiveShadow = true;
    scene.add(crowd);
    const bakedFans: BakedFan[] = fans.map((fan) => {
      const entry = crowdEntries[fan.sprite % crowdEntries.length]!, n = standPitchward(fan.stand);
      return { x: fan.x + n[0] * CROWD_FRONT_OFFSET, y: fan.y, z: fan.z + n[1] * CROWD_FRONT_OFFSET, height: CROWD_HEIGHT * entry.heightRatio,
        stand: fan.stand === 'home' || fan.stand === 'away' ? fan.stand : 'end' };
    });

    // Light: the Modern 3D sky and sun, the sun behind the camera and to its left so casts fall up-screen and right.
    const content = new THREE.Box3().setFromObject(stadium);
    for (const mesh of furniture.meshes) content.union(new THREE.Box3().setFromObject(mesh));
    content.max.y += 0.8; // room for a fan on the top tier whatever the attendance: the frame never depends on the crowd
    const frame = stadiumBakeFrame(request.farDir, request.elevation, content);
    scene.add(new THREE.HemisphereLight(0xdcecff, 0x294623, 1.6));
    const sun = new THREE.DirectionalLight(0xfff3dc, 2.3);
    sun.position.set(CENTRE.x - frame.right[0] * 16 - frame.far[0] * 10, 20, CENTRE.z - frame.right[1] * 16 - frame.far[1] * 10);
    sun.target.position.copy(CENTRE);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.left = -30; sun.shadow.camera.right = 30; sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);

    const camera = new THREE.OrthographicCamera(frame.left, frame.rightEdge, frame.top, frame.bottom, 0.1, CAMERA_DISTANCE * 2);
    const dir = new THREE.Vector3(frame.far[0] * Math.cos(request.elevation), -Math.sin(request.elevation), frame.far[1] * Math.cos(request.elevation));
    camera.position.copy(CENTRE).addScaledVector(dir, -CAMERA_DISTANCE);
    camera.up.set(0, 1, 0);
    camera.lookAt(CENTRE);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);

    // Only now, with every asset in hand, the context: from here to the finally block nothing awaits.
    checkAbort();
    gl = deps.createGlContext();
    if (!gl) throw new Error('WebGL2 unavailable');
    gl.canvas.addEventListener?.('webglcontextlost', onLost);
    const size = stadiumBakeSize(frame, request.elevation, request.pixelsPerSquare, Math.min(request.maxSidePx, contextMaxSide(gl.context)));
    renderer = deps.createRenderer(gl);
    renderer.setPixelRatio(1);
    renderer.setSize(size.width, size.height, false);
    const buffer = renderer.getContext();
    if (buffer.drawingBufferWidth !== size.width || buffer.drawingBufferHeight !== size.height) {
      throw new Error(`drawing buffer ${buffer.drawingBufferWidth}x${buffer.drawingBufferHeight} is not the ${size.width}x${size.height} asked for`);
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);
    if (lost || renderer.getContext().isContextLost()) throw new Error('WebGL context lost');
    const out = deps.createCanvas();
    out.width = size.width; out.height = size.height;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable for the stadium bake');
    ctx.drawImage(renderer.domElement, 0, 0);
    deps.inspectScene?.(scene);
    return {
      canvas: out as unknown as HTMLCanvasElement, width: size.width, height: size.height, corners: frame.corners, pixelsPerSquare: size.pixelsPerSquare,
      stats: { ms: Math.round(deps.now() - started), chairs: furniture.chairs, aisles: furniture.aisles, shelters: furniture.shelters, fans: fans.length, chairsByStand: chairsPerStand(furniture.placed) },
      fans: bakedFans,
    };
  } finally {
    gl?.canvas.removeEventListener?.('webglcontextlost', onLost);
    if (loaded) disposeObjectTree(loaded);
    releaseScene(scene);
    for (const texture of textures) texture.dispose();
    if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
    else (gl?.context.getExtension('WEBGL_lose_context') as { loseContext(): void } | null | undefined)?.loseContext();
  }
}

/** Dispose every geometry, material, instanced buffer and light shadow under the scene, then empty it. */
export function releaseScene(scene: THREE.Scene): void {
  const materials = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>();
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      if (object instanceof THREE.InstancedMesh) object.dispose();
    }
    if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  scene.clear();
}
