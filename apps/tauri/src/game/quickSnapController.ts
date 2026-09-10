import { PlayerStateFlag, rendersOnPitch } from '@fumbbl40k/ffb-pitch';

/**
 * BB2025 Quick Snap — ONE behavioural controller, projected into Modern and Classic.
 *
 * Upstream sources:
 *  - ffb-server/.../step/bb2025/kickoff/StepApplyKickoffResult.handleQuickSnap (:582-676): entry flips to
 *    the receiving side, enters TurnMode.QUICK_SNAP, rolls D3 and sets the allowance to roll+3, then clears
 *    ACTIVE on every acting-team player standing in an opposing tacklezone. Each accepted move goes through
 *    UtilServerSetup.setupPlayer, which in QUICK_SNAP sets STANDING + changeActive(false) — a moved player is
 *    spent. Reports carry the ABSOLUTE moved tally, the allowance, and the remaining open count.
 *  - ffb-client-logic/.../state/logic/QuickSnapLogicModule (+ ClientStateQuickSnap): a target square must be
 *    ON PITCH, EMPTY, and the SAME or ADJACENT square to the drag start.
 *
 * Candidate membership is therefore exactly: own side, on pitch, and ACTIVE in the RECEIVED model.
 */

export const QUICK_SNAP_TURN_MODE = 'quickSnap';

export interface QuickSnapModelPlayer {
  playerId: string;
  /** Belongs to the acting (receiving) team in the transformed received model. */
  mine: boolean;
  playerState: number;
  coordinate: readonly [number, number] | null | undefined;
}

export interface QuickSnapCandidate {
  playerId: string;
  coord: [number, number];
  /** QS-2 anchor: the square this player held at phase entry, pinned by the caller. */
  startCoord: [number, number];
}

export interface QuickSnapAllowance {
  /** ABSOLUTE moved tally from the server (kickoffSequenceActivationsCount.nrOfPlayers). */
  moved: number;
  /** D3+3 allowance (quickSnapRoll.nrOfPlayers, re-confirmed by …Count.nrOfPlayersAllowed). */
  allowed: number;
  /** Open players still on the pitch (…Count.number). Null until the first count report. */
  available: number | null;
}

export interface QuickSnapExhaustion {
  /** kickoffSequenceActivationsExhausted.limitReached — true = allowance spent, false = no open players left. */
  limitReached: boolean;
}

export function isOnPitch(coordinate: readonly [number, number] | null | undefined): coordinate is [number, number] {
  return !!coordinate && coordinate[0] >= 0 && coordinate[0] <= 25 && coordinate[1] >= 0 && coordinate[1] <= 14;
}

/** Own side + on pitch + ACTIVE in the received model (StepApplyKickoffResult :660-670 spends ACTIVE per move). */
export function isQuickSnapCandidate(player: QuickSnapModelPlayer): boolean {
  if (!player.mine) return false;
  if (!isOnPitch(player.coordinate)) return false;
  if (!rendersOnPitch(player.playerState)) return false;
  return (player.playerState & PlayerStateFlag.ACTIVE) !== 0;
}

export function quickSnapCandidates(
  players: readonly QuickSnapModelPlayer[],
  startCoordinates: ReadonlyMap<string, [number, number]>,
): QuickSnapCandidate[] {
  const out: QuickSnapCandidate[] = [];
  for (const player of players) {
    if (!isQuickSnapCandidate(player)) continue;
    const start = startCoordinates.get(player.playerId);
    if (!start) continue; // never pinned (joined the pitch after entry) — not a Quick Snap mover
    const coordinate = player.coordinate as [number, number];
    out.push({ playerId: player.playerId, coord: [coordinate[0], coordinate[1]], startCoord: [start[0], start[1]] });
  }
  return out;
}

/** QuickSnapLogicModule.squaresAreSameOrAdjacent — Chebyshev ≤ 1 (the same square counts). */
export function sameOrAdjacent(a: readonly [number, number], b: readonly [number, number]): boolean {
  return Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1;
}

/**
 * Legal destinations for ONE candidate: on-pitch, EMPTY, same-or-adjacent to the pinned anchor, and not the
 * player's own current square (upstream short-circuits an identical coordinate as a no-op, :592-597).
 * `occupied` must exclude the moving player's own square.
 */
export function quickSnapLegalTargets(
  candidate: QuickSnapCandidate | null | undefined,
  occupied: ReadonlySet<string>,
): [number, number][] {
  if (!candidate) return [];
  const [sx, sy] = candidate.startCoord;
  const out: [number, number][] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const target: [number, number] = [sx + dx, sy + dy];
      if (!isOnPitch(target)) continue;
      if (!sameOrAdjacent(candidate.startCoord, target)) continue;
      if (target[0] === candidate.coord[0] && target[1] === candidate.coord[1]) continue;
      if (occupied.has(`${target[0]},${target[1]}`)) continue;
      out.push(target);
    }
  }
  return out;
}

export interface QuickSnapMoveRequest {
  playerId: string;
  coordinate: [number, number];
}

export type QuickSnapRefusal =
  | 'not-armed'
  | 'not-a-candidate'
  | 'illegal-square'
  | 'allowance-spent'
  | 'in-flight';

export interface QuickSnapMoveDecision {
  allowed: boolean;
  refusal: QuickSnapRefusal | null;
}

/**
 * The single admission gate both views go through. Refuses a second send while one is still un-echoed:
 * upstream only spends the allowance when the model comes back, so a double click before the echo would
 * burn two activations (or be silently bounced by :640-643).
 */
export function decideQuickSnapMove(input: {
  armed: boolean;
  candidates: readonly QuickSnapCandidate[];
  allowance: QuickSnapAllowance | null;
  inFlight: boolean;
  occupied: ReadonlySet<string>;
  request: QuickSnapMoveRequest;
}): QuickSnapMoveDecision {
  const refuse = (refusal: QuickSnapRefusal): QuickSnapMoveDecision => ({ allowed: false, refusal });
  if (!input.armed) return refuse('not-armed');
  if (input.inFlight) return refuse('in-flight');
  const candidate = input.candidates.find((c) => c.playerId === input.request.playerId);
  if (!candidate) return refuse('not-a-candidate');
  if (input.allowance && input.allowance.moved >= input.allowance.allowed) return refuse('allowance-spent');
  const legal = quickSnapLegalTargets(candidate, input.occupied)
    .some((square) => square[0] === input.request.coordinate[0] && square[1] === input.request.coordinate[1]);
  return legal ? { allowed: true, refusal: null } : refuse('illegal-square');
}

/** Remaining activations from the authoritative pair; null while the allowance is unknown. */
export function quickSnapRemaining(allowance: QuickSnapAllowance | null): number | null {
  return allowance ? Math.max(0, allowance.allowed - allowance.moved) : null;
}

/** Upstream KickoffSequenceActivationsCountMessage / …ExhaustedMessage / QuickSnapRollMessage copy. */
export function quickSnapAllowanceText(teamName: string, roll: number, allowed: number): string {
  return `Quick Snap Roll [ ${roll} ] — ${teamName} may move ${allowed} open players 1 square each`;
}

export function quickSnapCountText(available: number, used: number, limit: number): string {
  return `Max ${limit} open players can be used - ${used} used (${available} ${available === 1 ? 'remains' : 'remain'} open).`;
}

export function quickSnapExhaustedText(limitReached: boolean): string {
  return limitReached ? 'Moved allowed number of players.' : 'No more open players available.';
}
