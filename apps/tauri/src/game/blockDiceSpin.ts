/**
 * Owner 11-03: the "Stab or Block?" card previews the Block's dice as real block-die faces that cycle through the
 * faces on a loop (purely decorative: never a result, never a send). One shared interval drives every die; each die
 * is offset so they do not change in lockstep. Reduced motion = static faces. The interval runs only while the card
 * shows dice and stops when the owner scope is disposed (the view unmounts), so nothing leaks.
 */
import { onScopeDispose, ref, watch, type Ref } from 'vue';
import type { BlockDieFaceValue } from './blockDieLog';

/** The face sequence each die cycles through (attacker down, both down, push, defender stumbles, pow, push). */
export const BLOCK_DICE_SPIN_FACES: readonly BlockDieFaceValue[] = [1, 2, 3, 5, 6, 4];
export const BLOCK_DICE_SPIN_MS = 300;

/** The face die `index` shows at `tick`: offset by two faces per die so neighbours never match. */
export function blockDiceSpinFace(tick: number, index: number): BlockDieFaceValue {
  const n = BLOCK_DICE_SPIN_FACES.length;
  return BLOCK_DICE_SPIN_FACES[(((tick + index * 2) % n) + n) % n]!;
}

export interface BlockDiceSpinSources {
  /** The card is showing a dice row. */
  active(): boolean;
  /** prefers-reduced-motion: reduce. */
  reducedMotion(): boolean;
}
export interface BlockDiceSpin {
  readonly tick: Ref<number>;
  /** True while the shared interval is running (tests / diagnostics). */
  running(): boolean;
}

/** The shared spin clock. Call inside a component setup (or effect scope): it tears down with that scope. */
export function createBlockDiceSpin(sources: BlockDiceSpinSources, intervalMs = BLOCK_DICE_SPIN_MS): BlockDiceSpin {
  const tick = ref(0);
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = (): void => { if (timer) { clearInterval(timer); timer = null; } };
  watch(() => sources.active() && !sources.reducedMotion(), (spin) => {
    stop();
    tick.value = 0;
    if (spin) timer = setInterval(() => { tick.value += 1; }, intervalMs);
  }, { immediate: true });
  onScopeDispose(stop);
  return { tick, running: () => timer !== null };
}
