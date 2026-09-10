/** #233 (owner P1, 2026-07-29) — the SEND-TIME ball-possession predicate.
 *  Extracted PURE (Echo item-① ruling 08-03, extract-and-SHARE) so the ffb-protocol rig can pin its fidelity to
 *  upstream `UtilPlayer.hasBall(Game, Player)` (ffb-common `UtilPlayer.java:513-519`):
 *      isBallInPlay() && !isBallMoving() && getBallCoordinate() != null
 *          && getBallCoordinate().equals(getPlayerCoordinate(player))
 *  A player "holds the ball" iff the ball is in play, NOT mid-scatter/bounce, and its square equals the player's.
 *
 *  Upstream gates pass AVAILABILITY on this (`bb2025/PassLogicModule`); the fork relocates it to SEND-time because
 *  the owner keeps DECLARE legal (declare a pass at turn start, then walk to the ball). This is a VERBATIM port —
 *  every conjunct matches — just relocated (the g478 emitter-re-verify pattern). Structural fieldModel typing keeps
 *  the module free of store/Vue deps so the rig can import it. */
export interface HoldsBallFieldModel {
  ballInPlay?: boolean;
  ballMoving?: boolean;
  ballCoordinate?: [number, number] | null;
  playerDataArray: { playerId?: string | null; playerCoordinate?: [number, number] | null }[];
}

export function holdsBall(fieldModel: HoldsBallFieldModel, playerId: string): boolean {
  if (!fieldModel.ballInPlay || fieldModel.ballMoving) return false;
  const ball = fieldModel.ballCoordinate;
  if (!Array.isArray(ball)) return false;
  const playerSq = fieldModel.playerDataArray.find((d) => d.playerId === playerId)?.playerCoordinate;
  if (!Array.isArray(playerSq)) return false;
  return playerSq[0] === ball[0] && playerSq[1] === ball[1];
}
