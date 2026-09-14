/**
 * Owner 09-14: the on-pitch action d6 as a 3D cube — the block-die GLB with the six d6 faces on its six face
 * materials, drawn on an overlay canvas over the pitch and parked on each live action die's screen slot every
 * pitch frame. A re-roll tumbles the SAME cube in place. Lazily imported like the block-dice chooser; the PNG die
 * path pays nothing for Three.js or the GLB.
 */
import { BLOCK_DICE_CLIP_DURATION_MS, BLOCK_DICE_SETTLE_BASES, blockDiceClip, loadSharedBlockDiceModel, type BlockDiceBasis } from './blockDice3d';

/** Owner 09-14: a short tumble before the result surfaces (owner 09-14 UAT: 200 ms, up from 125, on rolls and re-rolls). */
export const ACTION_DIE_TUMBLE_MS = 200;
/** Largest mixer step for a clip that STARTED this frame (Astra rounds 11/12: a 400 ms stalled tick jumped a fresh
 *  200 ms clip to its end pose; clamping every die instead starved steady low-fps devices). */
export const ACTION_DICE_MAX_STEP_S = 0.05;
/** The most dice one frame can show (a Multiple Block's rolls plus a few stragglers). */
export const ACTION_DICE_MAX = 8;

/** Six face materials on the cube; d6 face k rides material k so block result k's settle basis puts face k up. */
export const ACTION_D6_FACE_MATERIALS: readonly string[] = [
  'attacker-down', 'both-down', 'push-back', 'push-back-2', 'defender-stumbles', 'defender-down',
].map((name) => `Super FUMBBL client ${name}`);

export function actionDieTimeScale(durationMs: number): number {
  return BLOCK_DICE_CLIP_DURATION_MS / Math.max(1, durationMs);
}

/** A d6 face other than `previous` for the 2D tumble; the caller supplies the random source. */
export function nextTumbleFace(previous: number, random: () => number = Math.random): number {
  const face = 1 + Math.floor(random() * 6);
  if (face !== previous) return Math.min(6, Math.max(1, face));
  return face === 6 ? 1 : face + 1;
}

export interface ActionDieSlot {
  id: number;
  /** Screen centre in CSS px of the overlay host. */
  cx: number;
  cy: number;
  /** On-screen edge length in CSS px. */
  size: number;
  /** 0..1 — follows the Pixi die's pop-in/fade so the cube and its tags read as one thing. */
  alpha: number;
  /** The die's result: a cube adopted without a tumble (layer enabled mid-life, pool re-admission) settles on it. */
  value: number;
}

/** A decoded d6 face image — the SAME bitmap Pixi already holds for the PNG die (owner UAT 09-14: a second URL
 *  loader never delivered in the built app and the GLB's embedded block faces showed through). */
export type ActionDieFaceSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

export interface ActionDiceRuntime {
  readonly canvas: HTMLCanvasElement;
  /** Position/scale/opacity one die, creating it on first sight ('created'); false when the pool is exhausted. */
  place(slot: ActionDieSlot): 'created' | 'placed' | false;
  /** Hide every die not in `ids` (a released toast). */
  retain(ids: ReadonlySet<number>): void;
  playDie(id: number, clipName: string, timeScale: number): void;
  settleDie(id: number, basis: BlockDiceBasis): void;
  /** Advance every mixer by `deltaSeconds`; dice in `freshIds` (clip started this frame) by at most ACTION_DICE_MAX_STEP_S. */
  update(deltaSeconds: number, freshIds?: ReadonlySet<number>): void;
  render(): void;
  /** Six decoded faces, face k on material k; throws when any is missing (the layer then falls back to PNG dice). */
  updateFaceTextures(sources: readonly (ActionDieFaceSource | null | undefined)[]): Promise<void>;
  dispose(): void;
}

/** `anchor` = the Pixi canvas the overlay must sit EXACTLY over (the host carries padding + a border, so the host box
 *  is not the canvas box — owner UAT 09-14: the cube drew 7 px left / 5 px up of its die). */
export type ActionDiceRuntimeFactory = (host: HTMLElement, onFailure: (error: unknown) => void, anchor?: HTMLElement) => Promise<ActionDiceRuntime>;

export interface ActionDiceLayer {
  readonly canvas: HTMLCanvasElement;
  /** Start (or restart — a re-roll in place) a tumble on die `id` that settles on `value` `durationMs` after it
   *  starts; `delayMs` holds the start (a fresh die tumbles AFTER its pop-in, never while it is a dot). */
  tumble(id: number, value: number, durationMs: number, now?: number, delayMs?: number): void;
  /** Per pitch frame: park each live die on its slot, advance tumbles, draw. Dice absent from `slots` disappear.
   *  Returns the ids the overlay is actually drawing — a die past the pool cap, or every die until the faces have
   *  been applied, keeps its PNG face instead. */
  sync(slots: readonly ActionDieSlot[], deltaSeconds: number, now?: number): ReadonlySet<number>;
  updateFaceTextures(sources: readonly (ActionDieFaceSource | null | undefined)[]): Promise<void>;
  dispose(): void;
}

export interface ActionDiceLayerOptions {
  runtimeFactory?: ActionDiceRuntimeFactory;
  onFailure?: (error: unknown) => void;
  now?: () => number;
  /** The Pixi canvas; the overlay copies its offset and size inside `host` (default: the host's padding box). */
  anchor?: HTMLElement;
}

class ActionDiceLayerController implements ActionDiceLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly tumbles = new Map<number, { value: number; durationMs: number; startAt: number; settleAt: number; started: boolean; settled: boolean }>();
  private disposed = false;
  private drewSomething = false;
  /** No cube is drawn until the d6 faces are on it — the GLB's block faces must never surface. */
  private facesReady = false;

  constructor(
    private readonly runtime: ActionDiceRuntime,
    private readonly onFailure: (error: unknown) => void,
    private readonly clock: () => number,
  ) { this.canvas = runtime.canvas; }

  tumble(id: number, value: number, durationMs: number, now = this.clock(), delayMs = 0): void {
    if (this.disposed) return;
    try {
      blockDiceClip(value); // throws on a non-d6 value
      const startAt = now + Math.max(0, delayMs);
      const length = Math.max(1, durationMs);
      this.tumbles.set(id, { value, durationMs: length, startAt, settleAt: startAt + length, started: false, settled: false });
      if (delayMs <= 0) this.startTumble(id, now);
    } catch (error) { this.fail(error); }
  }
  private startTumble(id: number, now: number): void {
    const t = this.tumbles.get(id);
    if (!t || t.started) return;
    t.started = true;
    // A late start (a stalled frame past startAt) keeps its FULL length from the moment it starts (Astra round 10:
    // clamping the pre-fixed deadline compressed it to the residual — a 1 ms clip nobody sees).
    t.settleAt = now + t.durationMs;
    this.runtime.playDie(id, blockDiceClip(t.value), actionDieTimeScale(t.durationMs));
  }

  sync(slots: readonly ActionDieSlot[], deltaSeconds: number, now = this.clock()): ReadonlySet<number> {
    const live = new Set<number>();
    if (this.disposed || !this.facesReady) return live;
    try {
      const wanted = new Set(slots.map((slot) => slot.id));
      const fresh = new Set<number>();
      for (const slot of slots) {
        const placed = this.runtime.place(slot);
        if (!placed) continue; // pool exhausted: the caller keeps this die's PNG face; its tumble entry waits
        live.add(slot.id);
        const t = this.tumbles.get(slot.id);
        if (t && !t.started && now >= t.startAt && placed !== 'created') { this.startTumble(slot.id, now); fresh.add(slot.id); }
        if (t && !t.settled && (now >= t.settleAt || (placed === 'created' && t.started))) {
          // Past the deadline — or admitted mid-tumble with no clip ever started (Astra): the result, not the rest pose.
          t.settled = true;
          this.runtime.settleDie(slot.id, BLOCK_DICE_SETTLE_BASES[t.value]!);
        } else if (t && !t.started && placed === 'created') {
          // Created before its (delayed) tumble starts: rest on the result until then.
          if (isD6(slot.value)) this.runtime.settleDie(slot.id, BLOCK_DICE_SETTLE_BASES[slot.value]!);
        } else if (placed === 'created' && !t) {
          // Adopted without a tumble (layer enabled mid-life / re-admitted): show the result, not the rest pose.
          if (isD6(slot.value)) this.runtime.settleDie(slot.id, BLOCK_DICE_SETTLE_BASES[slot.value]!);
        }
      }
      for (const id of [...this.tumbles.keys()]) if (!wanted.has(id)) this.tumbles.delete(id);
      this.runtime.retain(live);
      if (live.size === 0 && !this.drewSomething) return live; // idle: nothing on the overlay, nothing to clear
      // A stalled frame (tab hidden, GC pause) must not fast-forward a clip that only just started; running clips
      // keep real elapsed time so a steady low frame rate still reaches the settle pose on schedule.
      this.runtime.update(Math.max(0, deltaSeconds), fresh);
      this.runtime.render();
      this.drewSomething = live.size > 0;
    } catch (error) { this.fail(error); }
    return live;
  }

  updateFaceTextures(sources: readonly (ActionDieFaceSource | null | undefined)[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.runtime.updateFaceTextures(sources).then(() => {
      if (this.disposed) return;
      this.facesReady = true;
      if (this.drewSomething) this.runtime.render();
    }).catch((error) => { this.facesReady = false; this.fail(error); });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.tumbles.clear();
    this.runtime.dispose();
  }

  private fail(error: unknown): void {
    this.onFailure(error);
  }
}

function isD6(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 6;
}

export async function createActionDiceLayer(host: HTMLElement, options: ActionDiceLayerOptions = {}): Promise<ActionDiceLayer> {
  const onFailure = options.onFailure ?? (() => undefined);
  const runtime = await (options.runtimeFactory ?? createThreeActionDiceRuntime)(host, onFailure, options.anchor);
  return new ActionDiceLayerController(runtime, onFailure, options.now ?? (() => performance.now()));
}

type MeshMaterial = import('three').MeshStandardMaterial;

async function createThreeActionDiceRuntime(host: HTMLElement, onFailure: (error: unknown) => void, anchor?: HTMLElement): Promise<ActionDiceRuntime> {
  const { THREE, gltf } = await loadSharedBlockDiceModel();
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'action-dice-3d-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  // Over the Pixi canvas, never in the way of the pointer: the pitch keeps every click/hover.
  Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '3' });
  host.appendChild(canvas);
  /** The box the overlay copies: the anchor canvas's offset + client size inside the host, else the host itself. */
  const frame = () => anchor
    ? { left: anchor.offsetLeft, top: anchor.offsetTop, width: Math.max(1, anchor.clientWidth), height: Math.max(1, anchor.clientHeight) }
    : { left: 0, top: 0, width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight) };

  const scene = new THREE.Scene();
  // Pixel-space orthographic camera (x right, y down via negative world y), 1 world unit = 1 CSS px — like the
  // chooser row, so a slot in host px lands the cube exactly on the Pixi die it replaces.
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

  const template = gltf.scene.clone(true);
  const ownedGeometries = new Set<import('three').BufferGeometry>();
  template.traverse((object) => {
    const mesh = object as import('three').Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone();
    ownedGeometries.add(mesh.geometry);
  });
  const edgeBox = new THREE.Box3().setFromObject(template);
  const cubeEdge = Math.max(1e-6, Math.max(edgeBox.max.x - edgeBox.min.x, edgeBox.max.y - edgeBox.min.y, edgeBox.max.z - edgeBox.min.z));
  const clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));

  interface Die { holder: import('three').Group; object: import('three').Object3D; mixer: import('three').AnimationMixer; materials: MeshMaterial[] }
  const dice = new Map<number, Die>();
  const faceTextures: (import('three').Texture | null)[] = ACTION_D6_FACE_MATERIALS.map(() => null);
  const externalTextures = new Set<import('three').Texture>();
  let disposed = false;
  let textureGeneration = 0;

  const applyFaces = (die: Die) => {
    for (const material of die.materials) {
      const index = ACTION_D6_FACE_MATERIALS.indexOf(material.name);
      if (index < 0) continue;
      const texture = faceTextures[index];
      if (!texture) continue;
      // Owner UAT 09-14 ("all number faces carry their block die equivalent"): the GLB face materials hold the block
      // symbol TWICE — base map AND an emissive map (factor 0.18, alpha-masked). Swapping the base map alone left the
      // symbol glowing under the pips; the d6 face takes both slots.
      material.map = texture;
      material.emissiveMap = texture;
      material.needsUpdate = true;
    }
  };
  const createDie = (): Die => {
    const object = template.clone(true);
    const materials: MeshMaterial[] = [];
    // Own materials per die: opacity follows the Pixi die's fade independently of its neighbours.
    object.traverse((child) => {
      const mesh = child as import('three').Mesh;
      if (!mesh.isMesh) return;
      const list = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material) => {
        const copy = material.clone() as MeshMaterial;
        copy.transparent = true;
        materials.push(copy);
        return copy;
      });
      mesh.material = Array.isArray(mesh.material) ? list : list[0]!;
    });
    const holder = new THREE.Group();
    holder.add(object);
    scene.add(holder);
    const die: Die = { holder, object, mixer: new THREE.AnimationMixer(object), materials };
    applyFaces(die);
    return die;
  };

  const resize = () => {
    if (disposed) return;
    const { left, top, width, height } = frame();
    Object.assign(canvas.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    renderer.setSize(width, height, false);
    camera.left = 0; camera.right = width; camera.top = 0; camera.bottom = -height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  if (anchor) observer.observe(anchor);
  resize();
  // A lost context renders nothing; report it so the renderer drops the layer and shows the PNG faces again.
  const contextLost = (event: Event) => {
    event.preventDefault();
    onFailure(new Error(event.type === 'webglcontextlost' ? '3D action-dice WebGL context lost' : '3D action-dice WebGL context restored'));
  };
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextLost);

  const runtime: ActionDiceRuntime = {
    canvas,
    place(slot) {
      let die = dice.get(slot.id);
      let created = false;
      if (!die) {
        if (dice.size >= ACTION_DICE_MAX) return false;
        die = createDie();
        dice.set(slot.id, die);
        created = true;
      }
      die.holder.visible = slot.alpha > 0.01;
      die.holder.position.set(slot.cx, -slot.cy, 0);
      die.holder.scale.setScalar(Math.max(1e-3, slot.size) / cubeEdge);
      const opacity = Math.max(0, Math.min(1, slot.alpha));
      for (const material of die.materials) material.opacity = opacity;
      return created ? 'created' : 'placed';
    },
    retain(ids) {
      for (const [id, die] of dice) {
        if (ids.has(id)) continue;
        die.mixer.stopAllAction();
        die.mixer.uncacheRoot(die.object);
        scene.remove(die.holder);
        die.materials.forEach((material) => material.dispose());
        dice.delete(id);
      }
    },
    playDie(id, clipName, timeScale) {
      const die = dice.get(id) ?? (dice.size < ACTION_DICE_MAX ? createDie() : null);
      if (!die) return;
      dice.set(id, die);
      const clip = clips.get(clipName);
      if (!clip) throw new Error(`Missing block-die clip: ${clipName}`);
      die.object.position.set(0, 0, 0);
      die.object.quaternion.identity();
      die.mixer.stopAllAction();
      const action = die.mixer.clipAction(clip);
      action.reset().setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.timeScale = timeScale;
      action.play();
    },
    settleDie(id, basis) {
      const die = dice.get(id);
      if (!die) return;
      die.mixer.stopAllAction();
      die.object.position.set(0, 0, 0);
      const matrix = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...basis.right), new THREE.Vector3(...basis.up), new THREE.Vector3(...basis.normal),
      );
      die.object.quaternion.setFromRotationMatrix(matrix.transpose());
    },
    update(deltaSeconds, freshIds) {
      for (const [id, die] of dice) die.mixer.update(freshIds?.has(id) ? Math.min(ACTION_DICE_MAX_STEP_S, deltaSeconds) : deltaSeconds);
    },
    render() {
      if (!disposed) renderer.render(scene, camera);
    },
    async updateFaceTextures(sources) {
      if (sources.length !== ACTION_D6_FACE_MATERIALS.length) throw new Error(`Expected six d6 faces, got ${sources.length}`);
      const missing = sources.findIndex((source) => !source);
      if (missing >= 0) throw new Error(`d6 face ${missing + 1} is not decoded yet`);
      if (disposed) return;
      ++textureGeneration;
      // Wrap the bitmaps Pixi already decoded: no second loader, no protocol/CSP difference between dev and the
      // built app, and never the GLB's embedded block faces.
      sources.forEach((source, index) => {
        const texture = new THREE.Texture(source as ActionDieFaceSource);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        texture.needsUpdate = true;
        const previous = faceTextures[index];
        faceTextures[index] = texture;
        externalTextures.add(texture);
        if (previous) { externalTextures.delete(previous); previous.dispose(); }
      });
      for (const die of dice.values()) applyFaces(die);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextLost);
      runtime.retain(new Set());
      externalTextures.forEach((texture) => texture.dispose());
      ownedGeometries.forEach((geometry) => geometry.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
  return runtime;
}
