// Touch mode press-and-hold rules (spec-touch-mode-2026-11-12 sections 5 and 7), timers injected for tests.
//  - createHoldAction: End Turn / End Setup. Held for `durationMs` it fires; released early it cancels and a release
//    reports 'hint' so the view can show "Hold to end turn".
//  - createLongPress (re-exported from @fumbbl40k/ffb-pitch touchInput.ts): the inspection / tooltip long-press.

export interface HoldTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  now: () => number;
}

export const defaultHoldTimers: HoldTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

export type HoldRelease = 'fired' | 'hint' | 'idle';

export interface HoldAction {
  press(): void;
  /** Lift: 'fired' when the hold already completed, 'hint' when it was released early, 'idle' when not pressed. */
  release(): HoldRelease;
  /** Abandon without a hint (pointer left / cancelled). */
  cancel(): void;
  holding(): boolean;
  /** 0..1 of the hold so far. */
  progress(): number;
}

export function createHoldAction(durationMs: () => number, onFire: () => void, timers: HoldTimers = defaultHoldTimers): HoldAction {
  let timer: unknown = null;
  let startedAt = 0;
  let fired = false;
  let pressed = false;
  const clear = () => { if (timer !== null) timers.clearTimeout(timer); timer = null; };
  return {
    press() {
      clear();
      pressed = true;
      fired = false;
      startedAt = timers.now();
      timer = timers.setTimeout(() => { timer = null; fired = true; onFire(); }, Math.max(0, durationMs()));
    },
    release() {
      if (!pressed) return 'idle';
      pressed = false;
      clear();
      return fired ? 'fired' : 'hint';
    },
    cancel() { pressed = false; clear(); },
    holding() { return pressed && !fired; },
    progress() {
      if (!pressed) return 0;
      if (fired) return 1;
      const d = Math.max(1, durationMs());
      return Math.min(1, (timers.now() - startedAt) / d);
    },
  };
}

// The long-press itself lives with the pitch renderer (one rule for the canvas and the shell).
export { LONG_PRESS_MS, createLongPress, type LongPress } from '@fumbbl40k/ffb-pitch';
