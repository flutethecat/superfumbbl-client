import { PITCH_COLS, PITCH_ROWS } from './geometry';

/**
 * Movement planning (Match10 / activation_logic.md O8): uniform-cost BFS over
 * the square grid, 8-directional, occupied squares block. Distances feed the
 * range overlay (normal MA vs Rush squares) and queued-path extension.
 */

export type Square = [number, number];

/** Owner 2026-07-08 (queue 9): hard ceiling on any movement budget — Blood Bowl MA
 *  caps at 9 and Sprint adds 3, so no legal activation exceeds 12 squares. A
 *  non-finite budget (a player whose `movement` arrived undefined → NaN) made the
 *  BFS bound `currentCost >= maxSteps` ALWAYS false, flooding the ENTIRE pitch —
 *  the "planner distance wildly off" bug. Every entry point now sanitizes. */
const MAX_REACH_STEPS = 12;
function sanitizeBudget(steps: number): number {
  return Number.isFinite(steps) ? Math.min(Math.max(0, Math.floor(steps)), MAX_REACH_STEPS) : 0;
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
 * minimum dice-rolls to reach each square in exactly stepsUsed+L steps.
 * Returns the best path (fewest rolls, then fewest steps) or null.
 */
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
  const toTarget = ([ax, ay]: Square) => (ax - to[0]) ** 2 + (ay - to[1]) ** 2;

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
      const stepRolls = (marked.has(key) ? 1 : 0) + (stepsUsed + level > normal ? 1 : 0);
      for (const [nx, ny] of neighbors(cx, cy).sort((a, b) => toTarget(a) - toTarget(b))) {
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
