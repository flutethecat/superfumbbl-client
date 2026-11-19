export type BlitzSquare = [number, number];

export interface BlitzContactRoute {
  route: BlitzSquare[];
  source: 'waypoint-adjacent' | 'waypoint-extension' | 'direct';
}

function adjacent(a: BlitzSquare, b: BlitzSquare): boolean {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) === 1;
}

/**
 * Build the left-click Blitz preview without inventing movement legality.
 * Every candidate route is supplied by the renderer's existing authoritative
 * movement planner. A prior waypoint is retained as the route origin; when its
 * endpoint already touches the defender, no extra square is appended.
 */
export function leftClickBlitzContactRoute(input: {
  target: BlitzSquare;
  waypointRoute: readonly BlitzSquare[];
  directContact: () => BlitzSquare[] | null;
  extendWaypoint: (route: BlitzSquare[], destination: BlitzSquare) => BlitzSquare[] | null;
  /** Owner 10-03 (prefer rushes over dodges): the planner's roll cost of a WHOLE candidate route. When supplied, the
   *  waypoint extension takes the cheapest route (then the shortest) instead of the shortest alone. */
  routeCost?: (route: BlitzSquare[]) => number;
  pitchCols?: number;
  pitchRows?: number;
}): BlitzContactRoute | null {
  const prior = input.waypointRoute.map((square) => [square[0], square[1]] as BlitzSquare);
  const end = prior.at(-1);
  if (end && adjacent(end, input.target)) return { route: prior, source: 'waypoint-adjacent' };

  if (prior.length > 0) {
    const cols = input.pitchCols ?? 26;
    const rows = input.pitchRows ?? 15;
    let best: BlitzSquare[] | null = null;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const destination: BlitzSquare = [input.target[0] + dx, input.target[1] + dy];
      if (destination[0] < 0 || destination[0] >= cols || destination[1] < 0 || destination[1] >= rows) continue;
      const candidate = input.extendWaypoint(prior, destination);
      if (!candidate || candidate.length === 0) continue;
      if (!best) { best = candidate; continue; }
      const candidateCost = input.routeCost ? input.routeCost(candidate) : 0;
      const bestCost = input.routeCost ? input.routeCost(best) : 0;
      // explicit compares (not a subtraction): two unpriceable routes (Infinity) fall through to the length rule
      if (candidateCost < bestCost || (!(bestCost < candidateCost) && candidate.length < best.length)) best = candidate;
    }
    return best ? { route: best, source: 'waypoint-extension' } : null;
  }

  const direct = input.directContact();
  return direct ? { route: direct, source: 'direct' } : null;
}

/** The renderer's reason-returning walk-to-contact plot (`o66ContactReach`), passed in so this module stays renderer-free. */
export type ContactReachResult = { status: string; path: BlitzSquare[] } | null;

export type PlannedContactStep =
  | { kind: 'route'; route: BlitzSquare[]; source: BlitzContactRoute['source'] }
  | { kind: 'unreachable'; surrounded: boolean };

/**
 * Owner 11-18 ("a planned route is prioritized and the path is not replanned"): Foul and Hypnotic Gaze choose their
 * walk to a target exactly as the left-click Blitz does (leftClickBlitzContactRoute):
 *  1. a planned route that already ends next to the target is used unchanged;
 *  2. a planned route that stops short is EXTENDED from its last square to the cheapest, then shortest, square around
 *     the target - never replanned from the player's square;
 *  3. only with no planned route is the direct walk to contact plotted (`contactReach`, the renderer's stance picker).
 * A planned route that cannot be extended to contact is 'unreachable' (the caller keeps the plan and refuses the
 * target), never silently swapped for a fresh route. No square is held back for a block (Blitz's reserveForBlock).
 * Review 11-18: the extension is APPEND-ONLY - `extendWaypoint` must be the renderer's append-only extension, and a
 * candidate that does not keep the whole planned route as its prefix (a trim back to a square on the route) is never
 * taken, so the coach's route is never shortened by a target click.
 */
export function plannedContactStep(input: {
  target: BlitzSquare;
  waypointRoute: readonly BlitzSquare[];
  contactReach: () => ContactReachResult;
  extendWaypoint: (route: BlitzSquare[], destination: BlitzSquare) => BlitzSquare[] | null;
  routeCost?: (route: BlitzSquare[]) => number;
  pitchCols?: number;
  pitchRows?: number;
}): PlannedContactStep {
  let reach: ContactReachResult = null;
  const picked = leftClickBlitzContactRoute({
    target: input.target,
    waypointRoute: input.waypointRoute,
    directContact: () => {
      reach = input.contactReach();
      return reach && reach.status === 'PATH' && reach.path.length > 0 ? reach.path : null;
    },
    extendWaypoint: (route, destination) => {
      const candidate = input.extendWaypoint(route, destination);
      return candidate && keepsPrefix(candidate, input.waypointRoute) ? candidate : null;
    },
    routeCost: input.routeCost,
    pitchCols: input.pitchCols,
    pitchRows: input.pitchRows,
  });
  if (picked && picked.route.length > 0) return { kind: 'route', route: picked.route, source: picked.source };
  return { kind: 'unreachable', surrounded: (reach as ContactReachResult)?.status === 'SURROUNDED' };
}

/** The route's last square touches the target (a planned walk that already reaches it). */
export function routeEndsBeside(route: readonly BlitzSquare[] | null | undefined, target: BlitzSquare | null | undefined): boolean {
  const end = route && route.length > 0 ? route[route.length - 1]! : null;
  return !!end && !!target && adjacent(end, target);
}

/** The candidate keeps every square of `prefix`, in order, and adds at least one square after it. */
function keepsPrefix(candidate: readonly BlitzSquare[], prefix: readonly BlitzSquare[]): boolean {
  if (candidate.length <= prefix.length) return false;
  return prefix.every((square, i) => candidate[i]![0] === square[0] && candidate[i]![1] === square[1]);
}
