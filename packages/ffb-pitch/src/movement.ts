import { PITCH_COLS, PITCH_ROWS } from './geometry';

/**
 * Movement planning (Match10 / activation_logic.md O8): uniform-cost BFS over
 * the square grid, 8-directional, occupied squares block. Distances feed the
 * range overlay (normal MA vs Rush squares) and queued-path extension.
 */

export type Square = [number, number];

/** Input guard, NOT a rule. A player's movement limit is the budget its caller passes: MA + that player's rush
 *  allowance from the game state (renderer o66MovementBudgetAt / selectionInfo, rushAllowanceFor), so a roster above
 *  the usual MA cap plans its full walk (owner 11-13: a fixed rules ceiling here cut the legal 13th square). The guard
 *  exists because a NaN budget (a player whose `movement` arrived undefined, 2026-07-08 queue 9) made the BFS bound
 *  `currentCost >= maxSteps` always false and flooded the whole pitch: NaN / ±Infinity / negatives answer 0, and a
 *  finite value is floored and clamped to the pitch's diameter. 25 = max(PITCH_COLS, PITCH_ROWS) - 1, the most steps
 *  between two squares of an open pitch (8-way moves: the end-to-end walk across 26 columns); a bigger budget reaches
 *  nothing more on an open pitch and only bounds the per-level planner (planPath runs one level per budget step). */
export const BUDGET_SANITY_BOUND = Math.max(PITCH_COLS, PITCH_ROWS) - 1;
function sanitizeBudget(steps: number): number {
  return Number.isFinite(steps) ? Math.min(Math.max(0, Math.floor(steps)), BUDGET_SANITY_BOUND) : 0;
}

export function squareKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Owner 08-18: budget left AFTER `steps` locally-plotted planner squares, for a reach re-anchored at the
 *  waypoint. Upstream never needs this — a click there COMMITS the step (MoveLogicModule.movePlayer:248-280 →
 *  sendPlayerMove), so the server republishes moveSquareArray from the new square with currentMove incremented
 *  (UtilServerPlayerMove.updateMoveSquares:78-86) and the rush boundary follows from UtilPlayer.
 *  isNextMoveGoingForIt:571-589 (`currentMove >= MA`). Our planner defers the send, so the same decrement is
 *  applied locally: every plotted step costs 1 (BB grid), steps beyond the remaining normal MA burn a rush. */
export function budgetAfterPlannedSteps(
  normal: number,
  rushes: number,
  steps: number,
): { normal: number; rushes: number } {
  const planned = sanitizeBudget(steps);
  const safeNormal = sanitizeBudget(normal);
  const safeRushes = sanitizeBudget(rushes);
  return {
    normal: Math.max(0, safeNormal - planned),
    rushes: Math.max(0, safeRushes - Math.max(0, planned - safeNormal)),
  };
}

function neighbors(x: number, y: number): Square[] {
  const result: Square[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < PITCH_COLS && ny >= 0 && ny < PITCH_ROWS) result.push([nx, ny]);
    }
  }
  return result;
}

export interface ReachResult {
  /** squareKey → step cost from the origin (origin itself not included). */
  costs: Map<string, number>;
  /** squareKey → previous square on a shortest path (for path extraction). */
  parents: Map<string, Square>;
}

/**
 * All squares reachable within maxSteps of `from`, avoiding occupied squares.
 * Every step (orthogonal or diagonal) costs 1, as on the Blood Bowl grid.
 */
export function reachableSquares(occupied: ReadonlySet<string>, from: Square, maxSteps: number): ReachResult {
  const costs = new Map<string, number>();
  const parents = new Map<string, Square>();
  maxSteps = sanitizeBudget(maxSteps); // queue 9: NaN/oversize floods the pitch
  if (maxSteps <= 0) return { costs, parents };
  const queue: Square[] = [from];
  const seen = new Set<string>([squareKey(from[0], from[1])]);
  const costAt = new Map<string, number>([[squareKey(from[0], from[1]), 0]]);
  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    const currentCost = costAt.get(squareKey(cx, cy))!;
    if (currentCost >= maxSteps) continue;
    for (const [nx, ny] of neighbors(cx, cy)) {
      const key = squareKey(nx, ny);
      if (seen.has(key) || occupied.has(key)) continue;
      seen.add(key);
      costAt.set(key, currentCost + 1);
      costs.set(key, currentCost + 1);
      parents.set(key, [cx, cy]);
      queue.push([nx, ny]);
    }
  }
  return { costs, parents };
}

/**
 * Auto-pathing (O8, owner 2026-07-02): plans from `from` to `to` AVOIDING
 * dice rolls first, then minimizing steps. A step rolls dice when it
 * - leaves a square marked by an opposition tackle zone (dodge), or
 * - exceeds the normal Movement Allowance (rush).
 * Level-by-level DP: the step count IS the level, so each level L holds the
 * minimum roll cost to reach each square in exactly stepsUsed+L steps.
 * Owner 10-03 ("prefer rushes over dodges where possible"): a dodge costs DODGE_ROLL_COST and a rush 1, so the
 * planner takes the fewest dodges first, then the fewest rushes, then the fewest steps - it will rush around a
 * tackle zone it can avoid rather than dodge out of it. A heuristic only: roll targets (AG, tackle zones on the
 * destination, skills) are not weighed.
 * Returns the best path (lowest roll cost, then fewest steps) or null.
 */
/** Invariant: more than the roll cost of any dodge-free route, i.e. more than the rushes one route can hold. planPath
 *  never runs past the sanitized budget (at most BUDGET_SANITY_BOUND steps, each at most one rush), so bound + 1 makes
 *  the sum order routes by (dodges, rushes) exactly - no count of rushes outweighs a dodge. Only that order matters:
 *  the raw sum (pathRollCost) is only compared between routes or tested against 0, never shown or stored. */
export const DODGE_ROLL_COST = BUDGET_SANITY_BOUND + 1;
export function planPath(
  occupied: ReadonlySet<string>,
  /** squares marked by ≥1 opposition tackle zone (dodge to leave them) */
  marked: ReadonlySet<string>,
  from: Square,
  to: Square,
  /** steps already queued before `from` (rush accounting is global) */
  stepsUsed: number,
  /** squares movable without rushing, for the whole activation */
  normal: number,
  /** normal + available rushes */
  total: number,
): Square[] | null {
  const remaining = sanitizeBudget(total - stepsUsed); // queue 9: NaN-proof
  const fromKey = squareKey(from[0], from[1]);
  const toKey = squareKey(to[0], to[1]);
  if (remaining <= 0 || toKey === fromKey || occupied.has(toKey)) return null;
  // Review 11-13 (hover lag on large budgets): three cuts, each output-identical. Pinned by test/movement-13-steps
  // (planner golden) and test/contact-golden (walk-to-contact stance + route), both recorded before the change.
  // (1) neighbors() only yields pitch squares, so an off-pitch target (a stance beyond the edge) never arrives: null.
  if (to[0] < 0 || to[0] >= PITCH_COLS || to[1] < 0 || to[1] >= PITCH_ROWS) return null;
  const toTarget = ([ax, ay]: Square) => (ax - to[0]) ** 2 + (ay - to[1]) ** 2;
  const stepsToTarget = (x: number, y: number) => Math.max(Math.abs(x - to[0]), Math.abs(y - to[1]));
  // Cut (2) counts steps as whole-square distances, which holds on the grid only: off-grid input (Square accepts any
  // number; float error, e.g. 2.2 - 1.2 > 1) runs the search unpruned, exactly as before the cuts. Every caller passes
  // grid squares (server coordinates, worldToSquare's floored indices); this keeps the old answer for anything else.
  const prune = Number.isInteger(from[0]) && Number.isInteger(from[1]) && Number.isInteger(to[0]) && Number.isInteger(to[1]);
  const stepRollsAt = (key: string, level: number) => (marked.has(key) ? DODGE_ROLL_COST : 0) + (stepsUsed + level > normal ? 1 : 0);

  interface Entry {
    rolls: number;
    parent: string | null;
  }
  const levels: Map<string, Entry>[] = [new Map([[fromKey, { rolls: 0, parent: null }]])];
  let best: { level: number; rolls: number } | null = null;

  for (let level = 1; level <= remaining; level++) {
    const previous = levels[level - 1]!;
    const current = new Map<string, Entry>();
    // expand nearest-to-target first so equal-roll ties produce straight paths
    const expansion = [...previous.entries()].sort(
      (a, b) => toTarget(a[0].split(',').map(Number) as Square) - toTarget(b[0].split(',').map(Number) as Square),
    );
    for (const [key, entry] of expansion) {
      const [cx, cy] = key.split(',').map(Number) as Square;
      const stepRolls = stepRollsAt(key, level);
      for (const [nx, ny] of neighbors(cx, cy).sort((a, b) => toTarget(a) - toTarget(b))) {
        // (2) a square more steps from the target than the levels left can never lie on an arrival, nor can any square
        // reached from it (a neighbour is at most one step nearer). Every square that CAN is only ever entered from
        // squares that can too, so the kept entries get the same rolls, parents and insertion order (the stable sort
        // keeps their relative order) as without the cut: the target's chain and every tie break are unchanged.
        if (prune && stepsToTarget(nx, ny) > remaining - level) continue;
        const nk = squareKey(nx, ny);
        if (occupied.has(nk)) continue;
        const rolls = entry.rolls + stepRolls;
        const existing = current.get(nk);
        if (!existing || rolls < existing.rolls) current.set(nk, { rolls, parent: key });
      }
    }
    levels.push(current);
    const arrival = current.get(toKey);
    if (arrival && (!best || arrival.rolls < best.rolls)) best = { level, rolls: arrival.rolls };
    if (best && best.rolls === 0) break; // can't beat a roll-free path
    if (current.size === 0) break; // nothing left that can still arrive
    // (3) proven minimum: each entry holds the least rolls of any `level`-step walk to it, and every later step adds
    // >= 0, so an arrival after this level costs at least min(rolls + the next step's rolls). A later arrival only
    // replaces `best` when strictly cheaper, so once best.rolls is at or under that bound the answer is final. This is
    // the zero-cost exit above generalised: it also ends a search whose first step is an unavoidable dodge.
    if (best) {
      let next = Number.POSITIVE_INFINITY;
      for (const [key, entry] of current) next = Math.min(next, entry.rolls + stepRollsAt(key, level + 1));
      if (best.rolls <= next) break;
    }
  }
  if (!best) return null;

  const path: Square[] = [];
  let key: string | null = toKey;
  for (let level = best.level; level > 0 && key; level--) {
    path.unshift(key.split(',').map(Number) as Square);
    key = levels[level]!.get(key)!.parent;
  }
  return path;
}

/** The roll cost planPath assigns to a finished route (same rule: DODGE_ROLL_COST per step that leaves a marked
 *  square, 1 per step beyond the normal allowance). Lets a caller compare routes to DIFFERENT squares - the
 *  blitz / foul stance choice - by the planner's own preference instead of by length. */
export function pathRollCost(
  marked: ReadonlySet<string>,
  from: Square,
  path: readonly Square[],
  stepsUsed: number,
  normal: number,
): number {
  let cost = 0;
  let at: Square = from;
  path.forEach((step, index) => {
    if (marked.has(squareKey(at[0], at[1]))) cost += DODGE_ROLL_COST;
    if (stepsUsed + index + 1 > normal) cost += 1;
    at = step;
  });
  return cost;
}

/** The one rule for choosing between finished routes to DIFFERENT squares (the stance beside a blitz / foul
 *  target): lower planner roll cost first (fewest dodges, then fewest rushes), then the shorter walk. Returns
 *  "candidate beats incumbent". Astra review 10-03: every stance picker shares this, so none ranks by raw length
 *  or by an unweighted roll count. */
export function routePreference(
  marked: ReadonlySet<string>,
  from: Square,
  stepsUsed: number,
  normal: number,
): (candidate: readonly Square[], incumbent: readonly Square[]) => boolean {
  const cost = (path: readonly Square[]) => pathRollCost(marked, from, path, stepsUsed, normal);
  return (candidate, incumbent) => {
    const a = cost(candidate);
    const b = cost(incumbent);
    return a < b || (a === b && candidate.length < incumbent.length);
  };
}

/**
 * Shortest path from `from` to `to` (exclusive of `from`, inclusive of `to`),
 * or null if unreachable within maxSteps. Among equally short paths, prefers
 * squares closer to the target so straight-line clicks produce straight
 * paths instead of BFS-ordering zigzags.
 */
export function shortestPath(
  occupied: ReadonlySet<string>,
  from: Square,
  to: Square,
  maxSteps: number,
): Square[] | null {
  maxSteps = sanitizeBudget(maxSteps); // queue 9: NaN-proof
  if (maxSteps <= 0) return null;
  const toKey = squareKey(to[0], to[1]);
  const fromKey = squareKey(from[0], from[1]);
  if (toKey === fromKey || occupied.has(toKey)) return null;
  // squared euclidean: breaks ties between equally-short steps in favour of
  // the straight line (chebyshev alone can't tell straight from diagonal drift)
  const toTarget = ([ax, ay]: Square) => (ax - to[0]) ** 2 + (ay - to[1]) ** 2;

  const parents = new Map<string, Square>();
  const costAt = new Map<string, number>([[fromKey, 0]]);
  let queue: Square[] = [from];
  while (queue.length > 0) {
    // process a whole BFS level, visiting target-nearest squares first
    queue.sort((a, b) => toTarget(a) - toTarget(b));
    const next: Square[] = [];
    for (const [cx, cy] of queue) {
      const currentCost = costAt.get(squareKey(cx, cy))!;
      if (currentCost >= maxSteps) continue;
      for (const [nx, ny] of neighbors(cx, cy).sort((a, b) => toTarget(a) - toTarget(b))) {
        const key = squareKey(nx, ny);
        if (costAt.has(key) || occupied.has(key)) continue;
        costAt.set(key, currentCost + 1);
        parents.set(key, [cx, cy]);
        if (key === toKey) {
          const path: Square[] = [];
          let current: Square = to;
          while (squareKey(current[0], current[1]) !== fromKey) {
            path.unshift(current);
            current = parents.get(squareKey(current[0], current[1]))!;
          }
          return path;
        }
        next.push([nx, ny]);
      }
    }
    queue = next;
  }
  return null;
}
