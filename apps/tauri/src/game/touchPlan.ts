// Touch mode: ONE preview value, drawn and sent from the same squares (round-5 review: drawing and Confirm diverged by
// ordering). The view builds the current plan - its kind, the exact route (square list) and the target - from the
// preview the coordinator holds; in touch mode the pitch path is drawn ONLY from that plan (every other path draw is
// ignored, see the view's renderer gate), and Confirm sends from that plan after checking that what is on screen is
// still exactly it. Mouse mode never builds a plan.
//
//   TouchPlan = { kind, actorId, route: Square[] | null, target: player id | square | null }
//
// Notes from the preview refs are queued and applied once the tap's handler has finished (createTouchNoteQueue), so a
// preview is judged on its complete value, never half-built (round-5 finding 3: the pass target was judged before its
// kind was set).

import type { TouchPreviewKind } from './touchPreview';

export type Square = [number, number];
export type TouchPlanTarget = string | Square | null;

export interface TouchPlan {
  kind: TouchPreviewKind;
  actorId: string;
  /** Exactly the squares Confirm walks (never including the start square); null = no walk. */
  route: Square[] | null;
  target: TouchPlanTarget;
}

export interface TouchPlanSources {
  kind: TouchPreviewKind | null;
  actorId: string;
  /** The preview route (o66PendingMove.route) - the one route a non-stage plan may walk. */
  previewRoute: Square[] | null;
  /** A staged tap's own walk (Throw Team-Mate pickup), when the plan is a stage. */
  stageRoute: Square[] | null;
  targets: Partial<Record<TouchPreviewKind, TouchPlanTarget>>;
}

const copy = (r: Square[] | null): Square[] | null => (r && r.length ? r.map((s) => [s[0], s[1]] as Square) : null);

export function buildTouchPlan(src: TouchPlanSources): TouchPlan | null {
  if (!src.kind) return null;
  const route = src.kind === 'stage' ? copy(src.stageRoute) : copy(src.previewRoute);
  return { kind: src.kind, actorId: src.actorId, route, target: src.targets[src.kind] ?? null };
}

export function sameSquares(a: Square[] | null, b: Square[] | null): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((s, i) => s[0] === y[i]![0] && s[1] === y[i]![1]);
}
export function sameTarget(a: TouchPlanTarget, b: TouchPlanTarget): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a[0] === b[0] && a[1] === b[1];
  return a === b;
}

/** What the pitch shows: drawn only through `publish`, which records what it drew. */
export interface TouchPlanDrawer {
  publish(plan: TouchPlan | null, origin: Square | null): void;
  /** The plan last drawn (route squares and target). */
  drawn(): { route: Square[] | null; target: TouchPlanTarget } | null;
  /** True when the screen shows exactly this plan. */
  shows(plan: TouchPlan | null): boolean;
}

export function createTouchPlanDrawer(draw: (path: Square[], moverId: string) => void): TouchPlanDrawer {
  let last: { route: Square[] | null; target: TouchPlanTarget } | null = null;
  return {
    publish(plan, origin) {
      const route = plan?.route ?? null;
      draw(route && origin ? [origin, ...route] : [], plan?.actorId ?? '');
      last = plan ? { route: copy(route), target: plan.target } : null;
    },
    drawn: () => last,
    shows(plan) {
      if (!plan) return !last || (!last.route && !last.target);
      return !!last && sameSquares(last.route, plan.route) && sameTarget(last.target, plan.target);
    },
  };
}

/** Queue preview notes during a tap and apply them, in order, once the handler has finished. */
export function createTouchNoteQueue(apply: (kind: TouchPreviewKind) => void, schedule: (fn: () => void) => void = (fn) => queueMicrotask(fn)) {
  let queue: TouchPreviewKind[] = [];
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const kinds = queue;
    queue = [];
    for (const k of kinds) apply(k);
  };
  return {
    note(kind: TouchPreviewKind) {
      queue.push(kind);
      if (!scheduled) { scheduled = true; schedule(flush); }
    },
    flush,
  };
}
