/**
 * Pushback wire helpers.
 *
 * The server's ClientCommandPushback wraps a **Pushback** object
 * (`{ playerId, coordinate }` — the pushed player + the target square), NOT the
 * raw fieldModel PushbackSquare (`{ coordinate, direction, locked, selected,
 * homeChoice }`). Sending the PushbackSquare directly leaves `playerId` null,
 * and StepPushback then does `game.getPlayerById(null)` → `pushPlayer(null, …)`
 * → NPE → the server shuts the game down (WS 1000 close). See the fork server's
 * bb2020/block/StepPushback.java:215 and PushbackLogicModule.getPushback().
 */
import type { GameJson, FieldCoordinateJson } from './types';

/** One entry of fieldModel.pushbackSquareArray (server PushbackSquare JSON). */
export interface PushbackSquareJson {
  coordinate?: FieldCoordinateJson;
  direction?: string;
  selected?: boolean;
  locked?: boolean;
  homeChoice?: boolean;
}

/**
 * The pushed player stands on the square the push comes FROM — offset from the
 * target square in the OPPOSITE of the push direction. Mirrors the official
 * client (PushbackLogicModule.getPushback): fromSquare = toSquare + delta. Keys
 * are lower-cased so both "East" (server model JSON) and "EAST" match.
 */
const FROM_DELTA: Record<string, [number, number]> = {
  north: [0, 1], northeast: [-1, 1], east: [-1, 0], southeast: [-1, -1],
  south: [0, -1], southwest: [1, -1], west: [1, 0], northwest: [1, 1],
};

/**
 * The playerId of the player being pushed into `square`, derived the way the
 * server expects. Reverses the square's push direction to the origin square and
 * reads the occupant (correct for chain pushes, where the pushed player changes
 * each step); falls back to game.defenderId when the direction/occupant can't be
 * resolved. Returns undefined only if nothing at all is known.
 */
export function pushedPlayerId(game: GameJson, square: PushbackSquareJson): string | undefined {
  const coord = square?.coordinate;
  const delta = FROM_DELTA[String(square?.direction ?? '').toLowerCase()];
  if (coord && delta) {
    const fx = coord[0] + delta[0];
    const fy = coord[1] + delta[1];
    const occ = (game.fieldModel?.playerDataArray ?? []).find(
      (p) => p.playerCoordinate?.[0] === fx && p.playerCoordinate?.[1] === fy,
    );
    if (occ) return occ.playerId;
  }
  return game.defenderId ?? undefined;
}

/**
 * Build the `pushback` field of a CLIENT_PUSHBACK command (server Pushback
 * shape: `{ playerId, coordinate }`). Coordinates are sent egocentric — the
 * server transforms the away side.
 */
export function pushbackPayload(game: GameJson, square: PushbackSquareJson) {
  return { playerId: pushedPlayerId(game, square), coordinate: square.coordinate };
}
