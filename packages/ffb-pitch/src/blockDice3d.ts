/**
 * Optional 3D renderer for the DOM block-dice chooser. Three.js and the GLB are
 * deliberately kept behind this lazily imported module; the ordinary PNG dice
 * path does not pay their startup cost.
 */

export const BLOCK_DICE_MODEL_URL = new URL('../assets/blockdice/super-fumbbl-block-die.glb', import.meta.url).href;
export const BLOCK_DICE_CLIP_DURATION_MS = 1650;

export const BLOCK_DICE_CLIPS = [
  '',
  'roll-to-attacker-down',
  'roll-to-both-down',
  'roll-to-push-back',
  'roll-to-push-back-2',
  'roll-to-defender-stumbles',
  'roll-to-defender-down',
] as const;

export type BlockDiceBasis = Readonly<{
  right: readonly [number, number, number];
  up: readonly [number, number, number];
  normal: readonly [number, number, number];
}>;

/** Model-space face bases from the delivered face-orientations.json. */
export const BLOCK_DICE_SETTLE_BASES: Readonly<Record<number, BlockDiceBasis>> = {
  1: { right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1] },
  2: { right: [0, 0, -1], up: [0, 1, 0], normal: [1, 0, 0] },
  3: { right: [0, 0, 1], up: [0, 1, 0], normal: [-1, 0, 0] },
  4: { right: [-1, 0, 0], up: [0, 1, 0], normal: [0, 0, -1] },
  5: { right: [1, 0, 0], up: [0, 0, -1], normal: [0, 1, 0] },
  6: { right: [1, 0, 0], up: [0, 0, 1], normal: [0, -1, 0] },
};

export function blockDiceClip(result: number): string {
  if (!Number.isInteger(result) || result < 1 || result > 6) throw new Error(`Invalid block-die result: ${result}`);
  return BLOCK_DICE_CLIPS[result]!;
}

export function blockDiceTimeScale(durationMs: number): number {
  return BLOCK_DICE_CLIP_DURATION_MS / Math.max(1, durationMs);
}

export function changedBlockDiceIndices(previous: readonly number[] | null, next: readonly number[]): number[] {
  if (!previous || previous.length !== next.length) return next.map((_value, index) => index);
  return next.flatMap((value, index) => value === previous[index] ? [] : [index]);
}

export interface BlockDiceFallbackState {
  enabled: boolean;
  spectatorClean: boolean;
  catchingUp: boolean;
  reducedMotion: boolean;
  replaySeeking: boolean;
  failed: boolean;
  webglAvailable: boolean;
}

export function blockDicePresentationPath(state: BlockDiceFallbackState): '3d' | 'png' {
  return state.enabled && !state.spectatorClean && !state.catchingUp && !state.reducedMotion
    && !state.replaySeeking && !state.failed && state.webglAvailable ? '3d' : 'png';
}

export interface BlockDiceRuntime {
  readonly canvas: HTMLCanvasElement;
  setCount(count: number): void;
  stopActions(): void;
  playDie(index: number, clipName: string, timeScale: number): void;
  settleDie(index: number, basis: BlockDiceBasis): void;
  update(deltaSeconds: number): void;
  render(): void;
  updateFaceTextures(urls: readonly string[]): Promise<void>;
  dispose(): void;
}

export type BlockDiceRuntimeFactory = (
  host: HTMLElement,
  onFailure: (error: unknown) => void,
  slots?: () => readonly BlockDiceSlot[],
) => Promise<BlockDiceRuntime>;

export interface BlockDiceScheduler {
  now(): number;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
}

const browserScheduler: BlockDiceScheduler = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

/** Owner 09-08: where each die sits, in CSS px relative to the host's padding box — the centre of the
 *  matching `.bp-die` button and the cube's on-screen edge length. The row never invents its own spacing. */
export interface BlockDiceSlot { cx: number; cy: number; size: number }

/** Fraction of a die button's inner box the cube face fills (the framed art keeps a little breathing room). */
export const BLOCK_DICE_SLOT_FILL = 0.9;

/** Build slots from the host rect and its die-button rects (DOMRect-shaped inputs; pure, testable). */
export function blockDiceSlotsFromRects(
  host: { left: number; top: number },
  buttons: readonly { left: number; top: number; width: number; height: number }[],
  fill = BLOCK_DICE_SLOT_FILL,
): BlockDiceSlot[] {
  return buttons.map((r) => ({
    cx: r.left - host.left + r.width / 2,
    cy: r.top - host.top + r.height / 2,
    size: Math.max(1, Math.min(r.width, r.height) * fill),
  }));
}

export interface BlockDiceRowOptions {
  runtimeFactory?: BlockDiceRuntimeFactory;
  scheduler?: BlockDiceScheduler;
  onFailure?: (error: unknown) => void;
  onSettled?: () => void;
  /** Current die-button slots; read on every resize/count change so the cubes track the buttons' layout. */
  slots?: () => readonly BlockDiceSlot[];
}

export interface BlockDiceRow {
  readonly canvas: HTMLCanvasElement;
  play(results: readonly number[], durationMs: number, changedIndices?: readonly number[]): void;
  settle(results: readonly number[]): void;
  updateFaceTextures(urls: readonly string[]): Promise<void>;
  dispose(): void;
}

class BlockDiceRowController implements BlockDiceRow {
  readonly canvas: HTMLCanvasElement;
  private previousResults: number[] | null = null;
  private currentResults: number[] = [];
  private frame = 0;
  private animationStarted = 0;
  private animationDuration = 0;
  private lastFrameAt = 0;
  private disposed = false;

  constructor(
    private readonly runtime: BlockDiceRuntime,
    private readonly scheduler: BlockDiceScheduler,
    private readonly onSettled?: () => void,
    private readonly onFailure?: (error: unknown) => void,
  ) {
    this.canvas = runtime.canvas;
  }

  play(results: readonly number[], durationMs: number, changedIndices?: readonly number[]): void {
    try {
      this.assertResults(results);
      if (this.disposed) return;
      this.cancelAnimation();
      this.currentResults = [...results];
      const changed = changedIndices
        ? [...new Set(changedIndices)].filter((index) => index >= 0 && index < results.length)
        : changedBlockDiceIndices(this.previousResults, results);
      this.previousResults = [...results];
      this.runtime.setCount(results.length);
      this.runtime.stopActions();
      results.forEach((result, index) => this.runtime.settleDie(index, BLOCK_DICE_SETTLE_BASES[result]!));
      const timeScale = blockDiceTimeScale(durationMs);
      changed.forEach((index) => this.runtime.playDie(index, blockDiceClip(results[index]!), timeScale));
      this.runtime.render();
      if (changed.length === 0) {
        this.onSettled?.();
        return;
      }
      this.animationStarted = this.scheduler.now();
      this.lastFrameAt = this.animationStarted;
      this.animationDuration = Math.max(1, durationMs);
      this.frame = this.scheduler.requestFrame(this.tick);
    } catch (error) {
      this.fail(error);
    }
  }

  settle(results: readonly number[]): void {
    try {
      this.assertResults(results);
      if (this.disposed) return;
      this.cancelAnimation();
      this.currentResults = [...results];
      this.previousResults = [...results];
      this.runtime.setCount(results.length);
      this.runtime.stopActions();
      results.forEach((result, index) => this.runtime.settleDie(index, BLOCK_DICE_SETTLE_BASES[result]!));
      this.runtime.render();
    } catch (error) {
      this.fail(error);
    }
  }

  updateFaceTextures(urls: readonly string[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.runtime.updateFaceTextures(urls).then(() => {
      if (!this.disposed) this.runtime.render();
    }).catch((error) => {
      this.fail(error);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAnimation();
    this.runtime.stopActions();
    this.runtime.dispose();
  }

  private readonly tick = (now: number): void => {
    try {
      if (this.disposed) return;
      const elapsed = now - this.animationStarted;
      const delta = Math.max(0, now - this.lastFrameAt) / 1000;
      this.lastFrameAt = now;
      this.runtime.update(delta);
      this.runtime.render();
      if (elapsed < this.animationDuration) {
        this.frame = this.scheduler.requestFrame(this.tick);
        return;
      }
      this.frame = 0;
      this.runtime.stopActions();
      this.currentResults.forEach((result, index) => this.runtime.settleDie(index, BLOCK_DICE_SETTLE_BASES[result]!));
      // preserveDrawingBuffer keeps this final frame visible with no idle RAF.
      this.runtime.render();
      this.onSettled?.();
    } catch (error) {
      this.fail(error);
    }
  };

  private fail(error: unknown): void {
    this.cancelAnimation();
    this.onFailure?.(error);
  }

  private cancelAnimation(): void {
    if (this.frame) this.scheduler.cancelFrame(this.frame);
    this.frame = 0;
  }

  private assertResults(results: readonly number[]): void {
    if (results.length < 1 || results.length > 3) throw new Error(`Block dice row requires 1-3 results, got ${results.length}`);
    results.forEach(blockDiceClip);
  }
}

export async function createBlockDiceRow(host: HTMLElement, options: BlockDiceRowOptions = {}): Promise<BlockDiceRow> {
  const onFailure = options.onFailure ?? (() => undefined);
  try {
    const runtime = await (options.runtimeFactory ?? createThreeBlockDiceRuntime)(host, onFailure, options.slots);
    return new BlockDiceRowController(runtime, options.scheduler ?? browserScheduler, options.onSettled, onFailure);
  } catch (error) {
    onFailure(error);
    throw error;
  }
}

type LoadedModel = { THREE: typeof import('three'); gltf: Awaited<ReturnType<InstanceType<typeof import('three/examples/jsm/loaders/GLTFLoader.js')['GLTFLoader']>['loadAsync']>> };
let sharedModelPromise: Promise<LoadedModel> | null = null;

function loadSharedModel(): Promise<LoadedModel> {
  if (!sharedModelPromise) {
    sharedModelPromise = Promise.all([
      import('three'),
      import('three/examples/jsm/loaders/GLTFLoader.js'),
    ]).then(async ([THREE, { GLTFLoader }]) => ({ THREE, gltf: await new GLTFLoader().loadAsync(BLOCK_DICE_MODEL_URL) }))
      .catch((error) => {
        sharedModelPromise = null;
        throw error;
      });
  }
  return sharedModelPromise;
}

async function createThreeBlockDiceRuntime(
  host: HTMLElement,
  onFailure: (error: unknown) => void,
  slots?: () => readonly BlockDiceSlot[],
): Promise<BlockDiceRuntime> {
  const { THREE, gltf } = await loadSharedModel();
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'bp-dice-3d-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);

  const scene = new THREE.Scene();
  // Owner 09-08: the scene is laid out in CSS PIXELS of the host (x right, y down via negative world y) so each
  // cube can be parked exactly on its `.bp-die` button; the orthographic camera maps 1 world unit = 1 px.
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, 4000);
  camera.position.set(0, 0, 2000);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x657589, 2));
  const key = new THREE.DirectionalLight(0xfff8ec, 3);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xaddcff, 1);
  rim.position.set(3, 1, -2);
  scene.add(rim);

  // Clone resources once for this controller. Its 1-3 scene clones then share
  // geometry/materials, while disposal cannot invalidate the lifetime GLTF cache.
  const template = gltf.scene.clone(true);
  const ownedGeometries = new Set<import('three').BufferGeometry>();
  const ownedMaterials = new Set<import('three').Material>();
  const embeddedTextures = new Map<string, import('three').Texture>();
  template.traverse((object) => {
    const mesh = object as import('three').Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone();
    ownedGeometries.add(mesh.geometry);
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material) => {
      const copy = material.clone();
      const mapped = copy as import('three').MeshStandardMaterial;
      if (mapped.map) {
        mapped.map = mapped.map.clone();
        mapped.map.needsUpdate = true;
        embeddedTextures.set(mapped.name, mapped.map);
      }
      ownedMaterials.add(copy);
      return copy;
    });
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
  });

  const clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
  const edgeBox = new THREE.Box3().setFromObject(template);
  const cubeEdge = Math.max(1e-6, Math.max(edgeBox.max.x - edgeBox.min.x, edgeBox.max.y - edgeBox.min.y, edgeBox.max.z - edgeBox.min.z));
  const dice = Array.from({ length: 3 }, (_unused, index) => {
    const object = index === 0 ? template : template.clone(true);
    const holder = new THREE.Group();
    holder.add(object);
    scene.add(holder);
    return { holder, object, mixer: new THREE.AnimationMixer(object) };
  });
  const externalTextures = new Set<import('three').Texture>();
  let count = 1;
  let disposed = false;
  let textureGeneration = 0;

  /** Fallback slots when the host supplies none: 60 px dice on a 7 px gap, left-packed like the button row. */
  const fallbackSlots = (): BlockDiceSlot[] => {
    const size = 60 * BLOCK_DICE_SLOT_FILL;
    return Array.from({ length: count }, (_u, i) => ({ cx: 30 + i * 67, cy: Math.max(1, host.clientHeight) / 2, size }));
  };
  const layout = () => {
    const current = (slots?.() ?? []).slice(0, count);
    const placed = current.length >= count ? current : fallbackSlots();
    dice.forEach((die, index) => {
      const slot = placed[index];
      if (!slot || index >= count) return;
      die.holder.position.set(slot.cx, -slot.cy, 0);
      die.holder.scale.setScalar(slot.size / cubeEdge);
    });
  };
  const resize = () => {
    if (disposed) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.left = 0;
    camera.right = width;
    camera.top = 0;
    camera.bottom = -height;
    camera.updateProjectionMatrix();
    layout();
    renderer.render(scene, camera);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  const fail = (event: Event) => {
    event.preventDefault();
    onFailure(new Error(event.type === 'webglcontextlost' ? '3D block-dice WebGL context lost' : '3D block-dice WebGL context restored'));
  };
  canvas.addEventListener('webglcontextlost', fail);
  canvas.addEventListener('webglcontextrestored', fail);

  const materialForName = (name: string): import('three').MeshStandardMaterial | null => {
    for (const material of ownedMaterials) if (material.name === name) return material as import('three').MeshStandardMaterial;
    return null;
  };
  const faceMaterials = [
    ['Super FUMBBL client attacker-down'],
    ['Super FUMBBL client both-down'],
    ['Super FUMBBL client push-back', 'Super FUMBBL client push-back-2'],
    ['Super FUMBBL client defender-stumbles'],
    ['Super FUMBBL client defender-down'],
  ];

  const runtime: BlockDiceRuntime = {
    canvas,
    setCount(nextCount) {
      count = Math.max(1, Math.min(3, nextCount));
      dice.forEach((die, index) => { die.holder.visible = index < count; });
      resize(); // re-reads the button slots — the buttons are re-rendered for the new count by the host

    },
    stopActions() {
      dice.forEach((die) => die.mixer.stopAllAction());
    },
    playDie(index, clipName, timeScale) {
      const die = dice[index];
      const clip = clips.get(clipName);
      if (!die || !clip) throw new Error(`Missing block-die clip: ${clipName}`);
      die.object.position.set(0, 0, 0);
      die.object.quaternion.identity();
      die.mixer.stopAllAction();
      const action = die.mixer.clipAction(clip);
      action.reset().setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.timeScale = timeScale;
      action.play();
    },
    settleDie(index, basis) {
      const die = dice[index];
      if (!die) return;
      die.mixer.stopAllAction();
      die.object.position.set(0, 0, 0);
      const matrix = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...basis.right),
        new THREE.Vector3(...basis.up),
        new THREE.Vector3(...basis.normal),
      );
      die.object.quaternion.setFromRotationMatrix(matrix.transpose());
    },
    update(deltaSeconds) {
      dice.slice(0, count).forEach((die) => die.mixer.update(deltaSeconds));
    },
    render() {
      if (!disposed) renderer.render(scene, camera);
    },
    async updateFaceTextures(urls) {
      if (urls.length !== 5) throw new Error(`Expected five block-face URLs, got ${urls.length}`);
      const generation = ++textureGeneration;
      const loader = new THREE.TextureLoader();
      const loaded = await Promise.allSettled(urls.map((url) => loader.loadAsync(url)));
      if (disposed || generation !== textureGeneration) {
        loaded.forEach((result) => { if (result.status === 'fulfilled') result.value.dispose(); });
        return;
      }
      externalTextures.forEach((texture) => texture.dispose());
      externalTextures.clear();
      loaded.forEach((result, faceIndex) => {
        const texture = result.status === 'fulfilled' ? result.value : null;
        if (texture) {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.flipY = false;
          texture.needsUpdate = true;
          externalTextures.add(texture);
        }
        for (const name of faceMaterials[faceIndex]!) {
          const material = materialForName(name);
          if (!material) continue;
          material.map = texture ?? embeddedTextures.get(name) ?? null;
          material.needsUpdate = true;
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', fail);
      canvas.removeEventListener('webglcontextrestored', fail);
      dice.forEach((die) => {
        die.mixer.stopAllAction();
        die.mixer.uncacheRoot(die.object);
      });
      externalTextures.forEach((texture) => texture.dispose());
      embeddedTextures.forEach((texture) => texture.dispose());
      ownedMaterials.forEach((material) => material.dispose());
      ownedGeometries.forEach((geometry) => geometry.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
  runtime.setCount(1);
  return runtime;
}
