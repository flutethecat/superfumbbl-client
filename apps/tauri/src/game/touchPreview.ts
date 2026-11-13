// Touch mode: ONE current preview at a time (round-2 review findings 2, 3 and 6).
//
// The match view keeps its previews in separate refs (a plotted route, a Block / Blitz stage, a thrown-ball target, a
// punt square, a foul victim, an armed gaze victim) plus the touch stage (game/touchStage.ts). In touch mode the view
// reports every preview it creates here; the newest one becomes `current` and every preview that does not belong to
// it is retired. Confirm dispatches only the current one, through a dispatcher that must name every preview kind.
//
// What "belongs to it" means: a target preview (Block / Blitz, throw, foul, gaze) may keep the route plotted to reach
// it, and a route re-plotted toward an armed target keeps the target - the walk-then-act composites the mouse flow
// already has. The touch stage belongs to nothing: creating it retires everything else, and anything else retires it.

export const TOUCH_PREVIEW_KINDS = ['stage', 'move', 'aggro', 'throw', 'punt', 'foul', 'gaze'] as const;
export type TouchPreviewKind = (typeof TOUCH_PREVIEW_KINDS)[number];

/** Target previews whose walk is a plotted route (route + target = one action). */
const WALKS_TO_TARGET: ReadonlySet<TouchPreviewKind> = new Set(['aggro', 'throw', 'foul', 'gaze']);

export interface TouchPreviewSlots {
  isSet(kind: TouchPreviewKind): boolean;
  clear(kind: TouchPreviewKind): void;
  /** Round-4 finding 1: the drawn route still serves this walk-then-act target (ends next to the victim / target, or
   *  keeps the receiver in range). Absent = always (the round-2 behaviour). */
  routeServes?(target: TouchPreviewKind): boolean;
}

export interface TouchPreviewCoordinator {
  /** A preview of `kind` was just created (or replaced): it becomes current; unrelated previews are retired. */
  note(kind: TouchPreviewKind): void;
  /** The kind Confirm acts on: the current one while it is still set, else the first set kind, else null. */
  dispatchKind(): TouchPreviewKind | null;
  current(): TouchPreviewKind | null;
  reset(): void;
}

export function belongsTogether(a: TouchPreviewKind, b: TouchPreviewKind): boolean {
  if (a === 'stage' || b === 'stage') return false;
  return (a === 'move' && WALKS_TO_TARGET.has(b)) || (b === 'move' && WALKS_TO_TARGET.has(a));
}

export function createTouchPreviewCoordinator(slots: TouchPreviewSlots, onCurrent: (kind: TouchPreviewKind | null) => void = () => undefined): TouchPreviewCoordinator {
  let current: TouchPreviewKind | null = null;
  const setCurrent = (k: TouchPreviewKind | null) => { current = k; onCurrent(k); };
  return {
    note(kind) {
      setCurrent(kind);
      for (const other of TOUCH_PREVIEW_KINDS) {
        if (other === kind || !slots.isSet(other)) continue;
        if (belongsTogether(kind, other)) {
          // Round-4 finding 1: a pair stays together only while the drawn route serves the target. A re-plot away from
          // the target retires the target (the route alone is the preview); a target created over a route that does
          // not serve it retires that route (the target alone is the preview). Nothing is ever substituted at Confirm.
          const target = kind === 'move' ? other : kind;
          if (!slots.routeServes || slots.routeServes(target)) continue;
          slots.clear(kind === 'move' ? target : 'move');
          continue;
        }
        slots.clear(other);
      }
    },
    dispatchKind() {
      const k = current && slots.isSet(current) ? current : (TOUCH_PREVIEW_KINDS.find((x) => slots.isSet(x)) ?? null);
      // Round-3 finding 1: a walk-then-act pair is owned by its target (the plan on the pitch is walk + act).
      if (k === 'move') return TOUCH_PREVIEW_KINDS.find((x) => WALKS_TO_TARGET.has(x) && slots.isSet(x)) ?? k;
      return k;
    },
    current: () => current,
    reset() { setCurrent(null); },
  };
}

/** Confirm's dispatcher: one handler per preview kind, enforced at build time (Record) and at run time (throws). */
export function createTouchConfirmDispatcher(handlers: Record<TouchPreviewKind, () => void>): (kind: TouchPreviewKind | null) => boolean {
  for (const k of TOUCH_PREVIEW_KINDS) if (typeof handlers[k] !== 'function') throw new Error(`touch confirm: no dispatcher for ${k}`);
  return (kind) => {
    if (!kind) return false;
    handlers[kind]();
    return true;
  };
}
