import type { GameJson } from '@fumbbl40k/ffb-protocol';

// Owner 09-28 (UAT g992, Spec S16): a Hail Mary Pass scatters three times and Blast It! may re-roll each step.
// The server keeps the CONFIRMED position on the ball coordinate, names the direction of the step under decision
// on the scatterBall report beside the skillUse dialog, and keeps passCoordinate on the ORIGINAL aim until the
// last step (StepMissedPass). This reducer folds those received facts into a small trail; it predicts no roll and
// no landing, owns no clock, and sends nothing. It runs inside the durable skill-decision projection, so the live
// coach, a spectator and a replay checkpoint all derive the same trail from the same frames.
export type HmpSquare = [number, number];

export interface HmpScatterTrail {
  gameId: string;
  playerId: string;
  /** The original target (passCoordinate before the first scatter). */
  aim: HmpSquare;
  /** Last ball square seen; a change while scattering is a confirmed step. */
  ball: HmpSquare | null;
  /** A scatterBall report has been seen for this pass. */
  scattering: boolean;
  /** The pass landed or went out: the server set the final passCoordinate (the trail then holds every on-pitch
   *  step and is frozen; the throw-in, bounces and catches that follow are not scatter steps). */
  final: boolean;
  /** The first scatter was not observed (mid-pass join): the ordinal is unknowable, so nothing is marked. */
  lost: boolean;
  /** Confirmed step squares in order (may include an off-pitch square; the renderer skips those). */
  steps: HmpSquare[];
  /** The Blast It! prompt live for the next step: its ordinal (1..3), the direction the server reported, and the
   *  square the SERVER sent for it (StepMissedPass adds one MoveSquare on the rolled square; null when the frame
   *  carries none, which may be off the pitch). */
  decision: { ordinal: number; direction: string; square: HmpSquare | null } | null;
}

export interface HmpScatterMarks {
  aim: HmpSquare;
  steps: HmpSquare[];
  /** `square` is null when the rolled direction leads off the pitch (the card text is then the only statement). */
  decision: { ordinal: number; square: HmpSquare | null } | null;
  final: boolean;
}

const DELTA: Record<string, HmpSquare> = {
  north: [0, -1], northeast: [1, -1], east: [1, 0], southeast: [1, 1],
  south: [0, 1], southwest: [-1, 1], west: [-1, 0], northwest: [-1, -1],
  n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1],
};
const norm = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
const onPitch = (s: readonly number[]) => s[0]! >= 0 && s[0]! < 26 && s[1]! >= 0 && s[1]! < 15;
const same = (a: readonly number[] | null | undefined, b: readonly number[] | null | undefined) =>
  !!a && !!b && a[0] === b[0] && a[1] === b[1];

function square(raw: unknown): HmpSquare | null {
  return Array.isArray(raw) && raw.length >= 2 && Number.isInteger(raw[0]) && Number.isInteger(raw[1])
    ? [raw[0] as number, raw[1] as number] : null;
}

/** One scatter step in the RECEIVING seat's frame: the away seat receives mirrored coordinates and mirrored
 *  direction names, so applying the received name to the received square is right in both seats. */
export function hmpScatterStep(from: readonly number[], direction: string): HmpSquare | null {
  const d = DELTA[norm(direction)];
  return d ? [from[0]! + d[0], from[1]! + d[1]] : null;
}

/** Walk `directions` from `from`; stops after the first off-pitch square (the server stops scattering there). */
function walk(from: HmpSquare, directions: readonly unknown[]): HmpSquare[] | null {
  const out: HmpSquare[] = [];
  let at = from;
  for (const direction of directions.slice(0, 3)) {
    const next = hmpScatterStep(at, String(direction));
    if (!next) return null;
    out.push(next);
    at = next;
    if (!onPitch(next)) break;
  }
  return out;
}

const scatterReports = (reports: readonly Record<string, unknown>[]) =>
  reports.filter((r) => r.reportId === 'scatterBall' && Array.isArray(r.directionArray) && r.directionArray.length > 0);

/** The one square the server put on the field model as a MoveSquare for the step under decision. */
function serverPendingSquare(game: GameJson): HmpSquare | null {
  const squares = ((game.fieldModel as { moveSquareArray?: { coordinate?: unknown }[] } | undefined)?.moveSquareArray ?? [])
    .map((m) => square(m?.coordinate));
  return squares.length === 1 ? squares[0]! : null;
}

const freshTrail = (gameId: string, playerId: string, aim: HmpSquare, ball: HmpSquare | null): HmpScatterTrail =>
  ({ gameId, playerId, aim, ball, scattering: false, final: false, lost: false, steps: [], decision: null });

export function reduceHmpScatterTrail(
  previous: HmpScatterTrail | null, game: GameJson, reports: readonly Record<string, unknown>[],
): HmpScatterTrail | null {
  const acting = game.actingPlayer as { playerAction?: unknown; playerId?: unknown } | undefined;
  const action = norm(acting?.playerAction ?? (game as { throwerAction?: unknown }).throwerAction);
  const playerId = String(acting?.playerId ?? '');
  const aimNow = square(game.passCoordinate);
  if (action !== 'hailmarypass' || !playerId || !aimNow) return null;
  const gameId = String(game.gameId ?? '');
  const ball = square(game.fieldModel?.ballCoordinate);
  const scatters = scatterReports(reports);
  const continuing = !!previous && previous.gameId === gameId && previous.playerId === playerId;
  const trail = continuing ? structuredClone(previous!) : freshTrail(gameId, playerId, aimNow, ball);

  // Landed / out of bounds: frozen. Nothing after the final passCoordinate is a scatter step.
  if (trail.final || trail.lost) return trail;
  if (!trail.scattering && !trail.lost && scatters.length === 0) {
    trail.aim = aimNow; // still aiming: a re-target moves the aim
    trail.ball = ball;
    return trail;
  }

  // The frame that sets the final passCoordinate also carries the summary report (all directions). When a step
  // leaves the pitch the server stops scattering, sets passCoordinate to the LAST VALID square and flags the
  // field model out of bounds (StepMissedPass); the summary then ends off the pitch.
  const summary = scatters.at(-1);
  const walked = summary ? walk(trail.aim, summary.directionArray as unknown[]) : null;
  if (walked?.length) {
    const offEnd = !onPitch(walked.at(-1)!);
    const inBounds = walked.filter(onPitch);
    const lastValid = inBounds.at(-1) ?? trail.aim;
    const outOfBounds = (game.fieldModel as { outOfBounds?: unknown } | undefined)?.outOfBounds === true;
    if (same(lastValid, aimNow) && (offEnd ? outOfBounds : (walked.length > 1 || !same(aimNow, trail.aim)))) {
      return { ...trail, scattering: true, final: true, ball, steps: inBounds.slice(0, 3), decision: null };
    }
  }

  if (!trail.scattering) {
    // First scatter frame: the aim was observed before it and the ball still stands on it (the pass roll put it
    // there). Anything else is a mid-pass join, where earlier steps are unknown.
    if (!continuing || !same(ball, trail.aim)) return { ...trail, lost: true };
    trail.scattering = true;
    trail.ball = ball;
  } else if (ball && !same(ball, trail.ball)) {
    if (trail.steps.length < 3) trail.steps.push(ball);
    trail.ball = ball;
  }

  const dialog = game.dialogParameter as { dialogId?: unknown; skill?: unknown } | null;
  const blastIt = dialog?.dialogId === 'skillUse' && norm(dialog.skill) === 'blastit';
  const ordinal = trail.steps.length + 1;
  const single = [...scatters].reverse().find((r) => (r.directionArray as unknown[]).length === 1);
  if (!blastIt || ordinal > 3) trail.decision = null;
  else if (single) trail.decision = { ordinal, direction: String((single.directionArray as unknown[])[0]), square: serverPendingSquare(game) };
  else if (trail.decision?.ordinal !== ordinal) trail.decision = null;
  return trail;
}

/** The pitch marks for a trail, or null when nothing beyond the ordinary destination marker should show. */
export function hmpScatterMarksFrom(trail: HmpScatterTrail | null | undefined): HmpScatterMarks | null {
  if (!trail || !trail.scattering || trail.lost) return null;
  // The pending step's square is the one the server sent; never computed here.
  const decision = trail.decision
    ? { ordinal: trail.decision.ordinal, square: trail.decision.square && onPitch(trail.decision.square) ? [...trail.decision.square] as HmpSquare : null }
    : null;
  return { aim: [...trail.aim], steps: trail.steps.map((s) => [...s] as HmpSquare), decision, final: trail.final };
}
