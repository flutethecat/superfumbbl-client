// Touch input rules shared by the pitch renderer and the client shell (spec-touch-mode-2026-11-12 section 7).
//  - tapSlopFor: how far a press may travel and still be a tap. A mouse keeps the original 5 px; a finger or a pen
//    gets a wider tolerance (a pen is treated as a finger).
//  - createLongPress: press-and-hold (about 450 ms), cancelled when the press travels past the tap tolerance, lifts,
//    or a second pointer lands. Timers are injected so the timing is unit-testable.

export const MOUSE_TAP_SLOP_PX = 5;
export const TOUCH_TAP_SLOP_PX = 14;
export const LONG_PRESS_MS = 450;

/** Fingers and pens get the wide tolerance; a mouse (or an unknown pointer) keeps 5 px. */
export function tapSlopFor(pointerType: string | null | undefined): number {
  return pointerType === 'touch' || pointerType === 'pen' ? TOUCH_TAP_SLOP_PX : MOUSE_TAP_SLOP_PX;
}
export function isFingerPointer(pointerType: string | null | undefined): boolean {
  return pointerType === 'touch' || pointerType === 'pen';
}

export interface LongPressTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}
const realTimers: LongPressTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

export interface LongPress<T> {
  /** A pointer went down at (x, y) on `target`. A second pointer while one is held cancels (a pinch). */
  down(pointerId: number, x: number, y: number, target: T): void;
  move(pointerId: number, x: number, y: number): void;
  /** Lift: true when the long-press fired for this press (the caller swallows the tap). */
  up(pointerId: number): boolean;
  cancel(): void;
  /** A press is being timed. */
  pending(): boolean;
}

export function createLongPress<T>(
  onLongPress: (target: T, x: number, y: number) => void,
  slopPx: number | ((pointerId: number) => number),
  delayMs = LONG_PRESS_MS,
  timers: LongPressTimers = realTimers,
): LongPress<T> {
  let timer: unknown = null;
  let active: { pointerId: number; x: number; y: number; target: T } | null = null;
  let firedFor: number | null = null;
  const clear = () => { if (timer !== null) timers.clearTimeout(timer); timer = null; };
  const slop = (id: number) => (typeof slopPx === 'function' ? slopPx(id) : slopPx);
  return {
    down(pointerId, x, y, target) {
      if (active && active.pointerId !== pointerId) { clear(); active = null; firedFor = null; return; }
      clear();
      firedFor = null;
      active = { pointerId, x, y, target };
      timer = timers.setTimeout(() => {
        timer = null;
        const a = active;
        if (!a) return;
        firedFor = a.pointerId;
        active = null;
        onLongPress(a.target, a.x, a.y);
      }, delayMs);
    },
    move(pointerId, x, y) {
      if (!active || active.pointerId !== pointerId) return;
      if (Math.hypot(x - active.x, y - active.y) > slop(pointerId)) { clear(); active = null; }
    },
    up(pointerId) {
      if (active?.pointerId === pointerId) { clear(); active = null; }
      const fired = firedFor === pointerId;
      if (fired) firedFor = null;
      return fired;
    },
    cancel() { clear(); active = null; firedFor = null; },
    pending() { return active !== null; },
  };
}
