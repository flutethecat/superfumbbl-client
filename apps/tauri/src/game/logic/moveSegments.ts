/**
 * Move batching, safe runs (spec-move-batching-safe-runs-2026-11-22.md, revision 4 + owner ruling 13).
 *
 * The PURE half: which squares of a planned route go out in ONE clientMove / clientBlitzMove. Nothing here reads the
 * store or sends. The planner (store.ts) collects the facts, asks `nextSegment` for the next [fromIdx..toIdx] and
 * sends that slice through the shared send boundary, which checks the same slice again (outbound invariant).
 *
 * Rules (spec 11.1 with sections 13 and 14 applied):
 *  - not eligible (not BB2025, not a live planner walk, ...) -> one square;
 *  - every ROLL square (dodge, rush, jump / non-adjacent edge) is sent ALONE (owner 11-23, parity with upstream's
 *    Automove, which never starts from a marked square);
 *  - section 14: so is every square whose departure LEAVES an opposing tackle zone, geometrically, even when the
 *    mover ignores tackle zones (active Incorporeal: no dodge is rolled, yet the square is still a head sent alone);
 *  - an ENDPOINT (loose ball, server-sent trapdoor, the carrier's end zone) ends its array; one at the head is alone;
 *  - a roll-free run extends while every later square: has a prediction, leaves no tackle zone and is no rush
 *    (uncertain = cut), is NOT adjacent to (or equal to) the send's origin (the server reads a later square's dodge flag
 *    from the cache built at the origin), is adjacent to the square before it, and follows no endpoint;
 *  - a prone player's first send of the activation -> one square (the server's trim ignores the stand-up cost).
 *
 * Predictions are ANNOTATIONS on the route `planPath` returned; nothing here changes which route is chosen (12.1).
 */

export type Sq = readonly [number, number];

const chebyshev = (a: Sq, b: Sq): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const adjacent = (a: Sq, b: Sq): boolean => chebyshev(a, b) === 1;
const same = (a: Sq, b: Sq): boolean => a[0] === b[0] && a[1] === b[1];

/** Decision 9: arrays longer than one only when the raw `rulesVersion` game option, trimmed and upper-cased, is
 *  exactly "BB2025". BB2020, BB2016, missing or anything else: one square. Deliberately NOT rulesOf / dodgeRulesVersion
 *  (they map BB2016 and a missing option to other versions). */
export function isBatchingRulesVersion(raw: unknown): boolean {
  return typeof raw === 'string' && raw.trim().toUpperCase() === 'BB2025';
}

/** A player standing beside the route, as the prediction needs it. */
export interface OpponentFact {
  coordinate: Sq;
  /** PlayerState.hasTacklezones (standing / moving / blocked, not confused or hypnotized; rooted keeps them). */
  hasTacklezones: boolean;
}

/** Spec 14: `leavesTacklezone` (the square left is in an opposing tackle zone) drives segmenting; `dodge`
 *  (= leavesTacklezone && !moverIgnoresTacklezones) drives the obligation and the chip. */
export interface IndexPrediction { leavesTacklezone: boolean; dodge: boolean; rush: boolean }
/** The server's offer for the head square: the rolls it will ask for. */
export interface HeadOffer { dodge: boolean; rush: boolean }

/** Spec 12.1: the prediction record handed to the planner. `perIndex` is indexed by ABSOLUTE route index; indexes
 *  before `routeBaseIdx` are null (not predicted). */
export interface RoutePrediction {
  actorId: string;
  modelRevision: number;
  origin: [number, number];
  routeBaseIdx: number;
  effectiveMA: number;
  /** Authoritative `currentMove` when the record was made. */
  movementUsed: number;
  standUpCharged: boolean;
  /** Sprint / unused Burst of Speed: extends the rush ALLOWANCE, never the normal-MA threshold. Recorded only. */
  extraRushAllowance: number;
  moverIgnoresTacklezones: boolean;
  perIndex: (IndexPrediction | null)[];
}

export interface PredictionInput {
  actorId: string;
  modelRevision: number;
  origin: Sq;
  route: readonly Sq[];
  routeBaseIdx: number;
  effectiveMA: number;
  movementUsed: number;
  /** The player is prone / stunned-free and must stand up as part of this activation. */
  prone: boolean;
  standUpCharged: boolean;
  extraRushAllowance: number;
  moverIgnoresTacklezones: boolean;
  opponents: readonly OpponentFact[];
}

/** Spec 12.1 / 14. leavesTacklezone at k: the square LEFT (origin for the first predicted index, else route[k-1]) is in
 *  the tackle zone of an opponent with tackle zones; dodge at k: that, unless the mover ignores tackle zones when moving
 *  (active Incorporeal). Rush at k:
 *  movementUsed (+ an uncharged stand-up) + local steps > effective MA. The offset is LOCAL to the suffix. */
export function predictRoute(input: PredictionInput): RoutePrediction {
  const perIndex: (IndexPrediction | null)[] = input.route.map(() => null);
  const standUp = input.prone && !input.standUpCharged ? Math.min(3, Math.max(0, input.effectiveMA)) : 0;
  for (let k = input.routeBaseIdx; k < input.route.length; k++) {
    const left = k === input.routeBaseIdx ? input.origin : input.route[k - 1]!;
    const leavesTacklezone = input.opponents.some((o) => o.hasTacklezones && adjacent(o.coordinate, left));
    const dodge = leavesTacklezone && !input.moverIgnoresTacklezones;
    const rush = input.movementUsed + standUp + (k - input.routeBaseIdx + 1) > input.effectiveMA;
    perIndex[k] = { leavesTacklezone, dodge, rush };
  }
  return {
    actorId: input.actorId,
    modelRevision: input.modelRevision,
    origin: [input.origin[0], input.origin[1]],
    routeBaseIdx: input.routeBaseIdx,
    effectiveMA: input.effectiveMA,
    movementUsed: input.movementUsed,
    standUpCharged: input.standUpCharged,
    extraRushAllowance: input.extraRushAllowance,
    moverIgnoresTacklezones: input.moverIgnoresTacklezones,
    perIndex,
  };
}

/** The squares an array must END on (decisions 3-5). `ball` only when a pickup is owed there (possession semantics:
 *  in play and `ballMoving === true`, spec 12.5). `endZoneX` only when the mover carries the ball now. */
export interface SegmentEndpoints {
  ball: Sq | null;
  trapdoors: readonly Sq[];
  endZoneX: number | null;
}

export interface SegmentInput {
  route: readonly Sq[];
  fromIdx: number;
  /** The square the player stands on when the segment is sent. */
  origin: Sq;
  /** Spec 11.6 eligibility (BB2025, live planner walk, regular turn mode, declared action, ...). */
  eligible: boolean;
  /** First send of the activation for a player who must stand up. */
  firstSendProne: boolean;
  /** The server's offer for route[fromIdx] from `origin`, for this exact actor / origin / action occurrence; null when
   *  none (the route prediction is then used for the head). */
  headOffer: HeadOffer | null;
  prediction: RoutePrediction | null;
  endpoints: SegmentEndpoints;
}

export interface Segment { fromIdx: number; toIdx: number }

export function isEndpointSquare(sq: Sq, endpoints: SegmentEndpoints): boolean {
  if (endpoints.ball && same(sq, endpoints.ball)) return true;
  if (endpoints.trapdoors.some((t) => same(t, sq))) return true;
  return endpoints.endZoneX !== null && sq[0] === endpoints.endZoneX;
}

function predictionAt(input: SegmentInput, k: number): IndexPrediction | null {
  const p = input.prediction;
  if (!p || k < p.routeBaseIdx || input.fromIdx < p.routeBaseIdx) return null;
  // The record is valid only while the player stands where it assumed: its own origin at its base index, or the
  // route square just before a later segment's head (each later index was predicted leaving route[k-1]).
  const standsAsPredicted = input.fromIdx === p.routeBaseIdx
    ? same(p.origin, input.origin)
    : same(input.route[input.fromIdx - 1]!, input.origin);
  if (!standsAsPredicted) return null;
  return p.perIndex[k] ?? null;
}

/** Spec 11.1 + sections 13 / 14: the next segment starting at `fromIdx`. Always at least one square; never more than the
 *  route holds. Uncertain = cut. */
export function nextSegment(input: SegmentInput): Segment {
  const i = input.fromIdx;
  const one: Segment = { fromIdx: i, toIdx: i };
  const route = input.route;
  const head = route[i];
  if (!head || !input.eligible || input.firstSendProne) return one;
  if (!adjacent(input.origin, head)) return one; // a jump / malformed edge is never part of an array (12.1)
  const headPrediction = predictionAt(input, i);
  if (!headPrediction || headPrediction.leavesTacklezone) return one; // section 14: leaving a tackle zone = a head alone
  // a roll square is always alone (section 13); the server's offer wins for the head's rolls (12.1 precedence)
  const headRolls = input.headOffer ?? headPrediction;
  if (headRolls.dodge || headRolls.rush) return one;
  if (isEndpointSquare(head, input.endpoints)) return one;
  let to = i;
  for (let k = i + 1; k < route.length; k++) {
    const sq = route[k]!;
    const prev = route[k - 1]!;
    const p = predictionAt(input, k);
    if (!p || p.leavesTacklezone || p.dodge || p.rush) break; // uncertain = cut; a head starts the next send
    if (chebyshev(sq, input.origin) <= 1) break; // origin-cache rule (11.1.6)
    if (isEndpointSquare(prev, input.endpoints)) break; // an endpoint is always the last square of its array
    if (!adjacent(prev, sq)) break; // a non-adjacent edge is a boundary
    to = k;
    if (isEndpointSquare(sq, input.endpoints)) break; // the array ends ON the endpoint
  }
  return { fromIdx: i, toIdx: to };
}

/** Every segment of a route walked without interruption (each send from where the previous one ended). For tests and
 *  the plan's log line; the planner itself asks for one segment at a time against the live model. */
export function segmentRoute(input: Omit<SegmentInput, 'fromIdx' | 'origin' | 'headOffer' | 'firstSendProne'> & {
  origin: Sq; firstSendProne?: boolean; headOffer?: HeadOffer | null;
}): Segment[] {
  const out: Segment[] = [];
  let origin: Sq = input.origin;
  for (let i = 0; i < input.route.length;) {
    const seg = nextSegment({
      ...input,
      fromIdx: i,
      origin,
      firstSendProne: i === 0 && input.firstSendProne === true,
      headOffer: i === 0 ? input.headOffer ?? null : null,
    });
    out.push(seg);
    origin = input.route[seg.toIdx]!;
    i = seg.toIdx + 1;
  }
  return out;
}
