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
