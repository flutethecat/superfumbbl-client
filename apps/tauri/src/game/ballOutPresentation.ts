/**
 * Owner 10-07: "render the ball bouncing out of the pitch on a kick-off ... This should also occur on any bounced ball."
 *
 * Pure projection of the server's own out-of-bounds facts into one presentation cue (no model writes, no timers):
 *  - `scatterBall` (ReportScatterBall: directions only) in a frame that sets `fieldModelOutOfBounds` true.
 *    Upstream StepCatchScatterThrowIn.bounceBall() moves the ball onto the off-pitch square and sets outOfBounds;
 *    StepMissedPass leaves the ball on the last in-bounds square and its LAST reported direction is the one that
 *    left the pitch. During a kick-off the same fact is the touchback (StepCatchScatterThrowIn publishes TOUCHBACK,
 *    the next frame enters turnMode `touchback`).
 *  - `kickoffScatter` (ReportKickoffScatter.ballCoordinateEnd) off the pitch, or with outOfBounds set in the same
 *    frame (StepKickoffScatterRoll: the ball is outside the receiving half, so TOUCHBACK).
 *  - `throwIn` (ReportThrowIn + Animation PASS from the throw-in square) with no exit shown yet (the 3-square
 *    scatter stops on the last in-bounds square and reports no leaving direction): the exit side is the one the
 *    server itself derives from that square (bb2025 ThrowInMechanic: x<1 west end zone, x>24 east, y<1 north
 *    sideline, y>13 south, corners diagonal).
 * Nothing here invents a rule: every square and direction is read off the wire; the only client choice is the visual
 * overshoot (the ball comes to rest BALL_OUT_OVERSHOOT squares past the edge, in the stands).
 */

export type BallOutLabel = 'TOUCHBACK' | 'OUT OF BOUNDS';

export interface BallOutCue {
  /** In-bounds squares the ball visits, start first; the last entry is the last in-bounds square (length >= 1). */
  path: [number, number][];
  /** Fractional square coordinate in the stands where the ball comes to rest; null = the ball stayed on the pitch
   *  (a kick-off touchback in the kicking half) and only the stamp shows, at the end of `path`. */
  exit: [number, number] | null;
  label: BallOutLabel;
}

export const PITCH_COLS = 26;
export const PITCH_ROWS = 15;
/** Squares beyond the pitch edge the ball comes to rest (owner spec: "~0.8 square beyond the edge"). */
export const BALL_OUT_OVERSHOOT = 0.8;
/** One hop, same cadence as the renderer's on-pitch ball scatter hops (SCATTER_SEG, before presentationMs). */
export const BALL_OUT_HOP_MS = 200;
/** The ball fades in the stands after it lands there. */
export const BALL_OUT_FADE_MS = 250;
/** The stamp's on-screen time, above the 450 ms viewer-visible floor (owner 09-05). */
export const BALL_OUT_STAMP_MS = 1200;

const DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  NORTH: [0, -1], NORTHEAST: [1, -1], EAST: [1, 0], SOUTHEAST: [1, 1],
  SOUTH: [0, 1], SOUTHWEST: [-1, 1], WEST: [-1, 0], NORTHWEST: [-1, -1],
};

export function directionDelta(direction: unknown): readonly [number, number] | null {
  return DIRECTIONS[String(direction ?? '').toUpperCase()] ?? null;
}

function square(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = Number(value[0]), y = Number(value[1]);
  return Number.isInteger(x) && Number.isInteger(y) ? [x, y] : null;
}

export function onPitch(value: readonly number[] | null | undefined): boolean {
  return !!value && value[0]! >= 0 && value[0]! < PITCH_COLS && value[1]! >= 0 && value[1]! < PITCH_ROWS;
}

/** The point in the stands the ball reaches leaving `last` (an in-bounds square) along `dir`: the hop continues
 *  until it is BALL_OUT_OVERSHOOT past the edge it crosses (edges sit half a square outside the edge squares). */
export function exitPoint(last: readonly [number, number], dir: readonly [number, number]): [number, number] {
  const limits: number[] = [];
  if (dir[0] < 0) limits.push((last[0] + 0.5 + BALL_OUT_OVERSHOOT) / -dir[0]);
  if (dir[0] > 0) limits.push((PITCH_COLS - 0.5 + BALL_OUT_OVERSHOOT - last[0]) / dir[0]);
  if (dir[1] < 0) limits.push((last[1] + 0.5 + BALL_OUT_OVERSHOOT) / -dir[1]);
  if (dir[1] > 0) limits.push((PITCH_ROWS - 0.5 + BALL_OUT_OVERSHOOT - last[1]) / dir[1]);
  const t = limits.length ? Math.min(...limits) : 0;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return [round(last[0] + dir[0] * t), round(last[1] + dir[1] * t)];
}

/** Where the pitch edge is crossed on the way from `last` to `exit` (the stamp sits there). */
export function edgeCrossing(last: readonly [number, number], exit: readonly [number, number]): [number, number] {
  const dx = exit[0] - last[0], dy = exit[1] - last[1];
  const limits: number[] = [];
  if (dx < 0) limits.push((last[0] + 0.5) / -dx);
  if (dx > 0) limits.push((PITCH_COLS - 0.5 - last[0]) / dx);
  if (dy < 0) limits.push((last[1] + 0.5) / -dy);
  if (dy > 0) limits.push((PITCH_ROWS - 0.5 - last[1]) / dy);
  const t = limits.length ? Math.min(1, ...limits) : 1;
  return [last[0] + dx * t, last[1] + dy * t];
}

type ModelChangeLike = { modelChangeId?: unknown; modelChangeValue?: unknown };
function modelChangeArray(modelChanges: unknown): ModelChangeLike[] {
  if (Array.isArray(modelChanges)) return modelChanges as ModelChangeLike[];
  const array = (modelChanges as { modelChangeArray?: unknown } | null | undefined)?.modelChangeArray;
  return Array.isArray(array) ? array as ModelChangeLike[] : [];
}

/** Does this frame set fieldModel.outOfBounds = true (FIELD_MODEL_SET_OUT_OF_BOUNDS)? */
export function frameSetsOutOfBounds(modelChanges: unknown): boolean {
  return modelChangeArray(modelChanges).some((change) =>
    String(change.modelChangeId ?? '') === 'fieldModelOutOfBounds' && change.modelChangeValue === true);
}

function walk(start: [number, number], directions: readonly (readonly [number, number])[]): [number, number][] {
  const path: [number, number][] = [[start[0], start[1]]];
  let [x, y] = start;
  for (const [dx, dy] of directions) { x += dx; y += dy; path.push([x, y]); }
  return path;
}

/**
 * A `scatterBall` frame that put the ball out of bounds. `prevBall` is the model ball before the frame,
 * `ballAfter` after it. Returns null unless the frame itself sets outOfBounds (the server's own verdict).
 */
export function scatterBallOut(input: {
  directions: unknown;
  prevBall: unknown;
  ballAfter: unknown;
  modelChanges: unknown;
  kickoff: boolean;
  bomb?: boolean;
}): BallOutCue | null {
  if (input.bomb || !frameSetsOutOfBounds(input.modelChanges) || !Array.isArray(input.directions)) return null;
  const deltas = input.directions.map(directionDelta);
  if (deltas.length === 0 || deltas.some((delta) => !delta)) return null;
  const dirs = deltas as (readonly [number, number])[];
  const label: BallOutLabel = input.kickoff ? 'TOUCHBACK' : 'OUT OF BOUNDS';
  const prev = square(input.prevBall);
  const after = square(input.ballAfter);
  // bounceBall(): the ball was in bounds before the frame and the reported directions walk it off the pitch (the
  // model's off-pitch coordinate is not used for drawing: FUMBBL has been seen to report it beyond the first
  // off-pitch square, g1949714 [30,7] after an East bounce from [25,7]).
  if (prev && onPitch(prev) && (!after || !onPitch(after))) {
    const path = walk(prev, dirs);
    const out = path.findIndex((step) => !onPitch(step));
    if (out > 0) return { path: path.slice(0, out), exit: exitPoint(path[out - 1]!, dirs[out - 1]!), label };
  }
  // A bounce that stays on the pitch but outside the kick-off bounds (the kicking half): stamp at the landing.
  if (prev && onPitch(prev) && after && onPitch(after)) {
    const path = walk(prev, dirs);
    const end = path.at(-1)!;
    if (end[0] === after[0] && end[1] === after[1] && path.every(onPitch)) return { path, exit: null, label };
  }
  // StepMissedPass: the ball stays on the last in-bounds square; the last reported direction left the pitch.
  if (after && onPitch(after)) {
    const last = dirs.at(-1)!;
    const beyond: [number, number] = [after[0] + last[0], after[1] + last[1]];
    if (!onPitch(beyond)) {
      const back: [number, number][] = [[after[0], after[1]]];
      let [x, y] = after;
      for (let index = dirs.length - 2; index >= 0; index--) { x -= dirs[index]![0]; y -= dirs[index]![1]; back.push([x, y]); }
      const path = back.reverse();
      return { path: path.every(onPitch) ? path : [[after[0], after[1]]], exit: exitPoint(after, last), label };
    }
    return { path: [[after[0], after[1]]], exit: null, label };
  }
  return null;
}

/** Re-anchor a kick-off cue on the KICK's landing square (the flight's own end), keeping its leaving direction. */
export function anchorBallOutAt(cue: BallOutCue, landing: readonly [number, number]): BallOutCue {
  const last = cue.path.at(-1)!;
  if (last[0] === landing[0] && last[1] === landing[1]) return cue;
  if (!cue.exit) return { ...cue, path: [[landing[0], landing[1]]] };
  const dir: [number, number] = [Math.sign(cue.exit[0] - last[0]), Math.sign(cue.exit[1] - last[1])];
  return { ...cue, path: [[landing[0], landing[1]]], exit: exitPoint(landing, dir) };
}

/** The side the server throws in from (bb2025 ThrowInMechanic.interpretThrowInDirectionRoll), pointing OUT. */
export function throwInOutwardDirection(start: readonly [number, number]): [number, number] | null {
  const [x, y] = start;
  const dx = x < 1 ? -1 : x > 24 ? 1 : 0;
  const dy = y < 1 ? -1 : y > 13 ? 1 : 0;
  if (dx === 0 && dy === 0) return null;
  return [dx, dy];
}

/** Does `dir` leave the pitch from `from` on at least one axis? */
function leavesFrom(from: readonly [number, number], dir: readonly [number, number]): boolean {
  return (dir[0] < 0 && from[0] < 1) || (dir[0] > 0 && from[0] > 24)
    || (dir[1] < 0 && from[1] < 1) || (dir[1] > 0 && from[1] > 13);
}

/**
 * A throw-in whose leaving hop was never shown (the 3-square scatter stops on the last in-bounds square and does not
 * report the direction that left). `lastDirection` is the last direction the server reported for the ball reaching
 * that square (scatterBall); it is kept whenever it leaves the pitch from there (a diagonal keeps its diagonal, a
 * corner keeps the axis it crossed). Only with no usable direction does the exit fall back to the side the server
 * derives from the throw-in square (bb2025 ThrowInMechanic).
 */
export function throwInBallOut(start: unknown, lastDirection?: readonly [number, number] | null): BallOutCue | null {
  const from = square(start);
  if (!from || !onPitch(from)) return null;
  const out = lastDirection && leavesFrom(from, lastDirection) ? lastDirection : throwInOutwardDirection(from);
  if (!out) return null;
  return { path: [from], exit: exitPoint(from, out), label: 'OUT OF BOUNDS' };
}

/** The last direction of a non-bomb scatterBall report and the square it brought the ball to (model ball after). */
export function lastScatterDirection(reports: readonly Record<string, unknown>[], ballAfter: unknown): { square: [number, number]; dir: [number, number] } | null {
  const report = reports.find((r) => String(r.reportId) === 'scatterBall' && r.bomb !== true);
  const dirs = report ? (report.directionArray ?? report.directions) : null;
  const at = square(ballAfter);
  if (!Array.isArray(dirs) || dirs.length === 0 || !at) return null;
  const delta = directionDelta(dirs.at(-1));
  return delta ? { square: at, dir: [delta[0], delta[1]] } : null;
}

/**
 * Owner 10-07 + Astra review: the kick-off touchback is decided on the frame that SETS fieldModelOutOfBounds (and the
 * final ball square), never from the provisional `kickoffScatter` report alone. StepKickoffScatterRollAskAfter
 * publishes that report with the FULL scatter end before the Kick dialog; the answer frame sets the clamped ball and
 * outOfBounds with no new scatter report, only ReportSkillUse(halveKickoffScatter) when Kick was used (distance
 * ceil(d/2)). The report supplies the line (start = end - direction * distance); the final distance picks the end:
 * off the pitch -> the ball hops off from the model ball's square; on the pitch (outside the receiving half) -> stamp.
 * Returns null unless this frame sets outOfBounds true.
 */
export function kickoffTouchbackBallOut(input: {
  scatterReport: Record<string, unknown> | null | undefined;
  /** The report arrived in this same frame (StepKickoffScatterRoll / no Kick): its distance is already final. */
  reportInThisFrame: boolean;
  reports: readonly Record<string, unknown>[];
  ballAfter: unknown;
  modelChanges: unknown;
}): BallOutCue | null {
  if (!frameSetsOutOfBounds(input.modelChanges)) return null;
  const report = input.scatterReport;
  const ball = square(input.ballAfter);
  const end = report ? square(report.ballCoordinateEnd) : null;
  const dir = report ? directionDelta(report.scatterDirection) : null;
  const distance = Number(report?.rollScatterDistance);
  if (!ball || !onPitch(ball)) return null;
  if (!end || !dir || !Number.isInteger(distance) || distance < 0) return { path: [ball], exit: null, label: 'TOUCHBACK' };
  const halved = !input.reportInThisFrame && input.reports.some((r) => String(r.reportId) === 'skillUse'
    && r.used !== false && String(r.skillUse ?? '').toLowerCase() === 'halvekickoffscatter');
  const finalDistance = halved ? Math.ceil(distance / 2) : distance;
  const start: [number, number] = [end[0] - dir[0] * distance, end[1] - dir[1] * distance];
  const finalEnd: [number, number] = [start[0] + dir[0] * finalDistance, start[1] + dir[1] * finalDistance];
  if (onPitch(finalEnd)) return { path: [ball], exit: null, label: 'TOUCHBACK' };
  return { path: [ball], exit: exitPoint(ball, dir), label: 'TOUCHBACK' };
}

/** Is this frame a throw-in (ReportThrowIn)? */
export function hasThrowInReport(reports: readonly Record<string, unknown>[]): boolean {
  return reports.some((report) => String(report.reportId) === 'throwIn');
}

/** Wall-clock length of the cue's own motion before the stamp appears (presentation ms before scaling). */
export function ballOutTravelMs(cue: BallOutCue): number {
  return Math.max(0, cue.path.length - 1) * BALL_OUT_HOP_MS + (cue.exit ? BALL_OUT_HOP_MS : 0);
}

/** How long the cue holds what follows it (hops, the exit hop, the stamp's read). */
export function ballOutHoldMs(cue: BallOutCue): number {
  return ballOutTravelMs(cue) + Math.max(450, BALL_OUT_STAMP_MS);
}
