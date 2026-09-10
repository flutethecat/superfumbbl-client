import { PlayerStateBase, PlayerStateFlag } from '@fumbbl40k/ffb-pitch';

/** BB2025 Solid Defence re-setup gate.
 *
 *  ffb-server/.../step/bb2025/kickoff/StepApplyKickoffResult.java:
 *   - offer (:318-345): every acting-team player OFF the field whose base is RESERVE is flipped to
 *     PRONE, so the bench cannot be fielded during the mini-phase; on-field players with no adjacent
 *     opposing tacklezone become the eligible set behind `playerChoice:solidDefence`.
 *   - selection (:305-315): SELECTED players are boxed (base → RESERVE); every other on-field player
 *     keeps STANDING but is `changeActive(false)`.
 *   - re-placement: UtilServerSetup.setupPlayer sets STANDING + `changeActive(true)`.
 *   - leave (:356-366): PRONE goes back to RESERVE.
 *
 *  The movable set is therefore fully SERVER-DERIVED and survives a reconnect: RESERVE (a selected
 *  player still in the box) or STANDING+ACTIVE (a selected player already put back on the pitch).
 *  Non-selected on-field players are STANDING without ACTIVE; the bench is PRONE. */
export interface SolidDefencePlayer {
  playerId: string;
  playerState: number;
}

export interface SolidDefencePlayerGate {
  playerId: string;
  movable: boolean;
}

export interface SolidDefenceGate {
  active: boolean;
  players: SolidDefencePlayerGate[];
}

export const SOLID_DEFENCE_TURN_MODE = 'solidDefence';

/** Server-derived movability for ONE player state (see the module cite above). */
export function solidDefencePlayerIsMovable(playerState: number): boolean {
  const base = playerState & 0xff;
  if (base === PlayerStateBase.RESERVE) return true;
  return base === PlayerStateBase.STANDING && (playerState & PlayerStateFlag.ACTIVE) !== 0;
}

/**
 * `retainedSelection` is the exact `playerChoice:solidDefence` occurrence this client answered.
 * When it is present and non-empty it NARROWS the model-derived set (belt and braces against a
 * frame where the server has not yet echoed the deactivations). It is never widening, and an
 * absent retention (reconnect, spectator hand-off) falls back to the model alone.
 */
export function solidDefenceSetupGate(
  turnMode: string | null | undefined,
  players: readonly SolidDefencePlayer[],
  retainedSelection?: readonly string[] | null,
): SolidDefenceGate {
  if (turnMode !== SOLID_DEFENCE_TURN_MODE) return { active: false, players: [] };
  const retained = retainedSelection && retainedSelection.length > 0 ? new Set(retainedSelection) : null;
  return {
    active: true,
    players: players.map((player) => ({
      playerId: player.playerId,
      movable: solidDefencePlayerIsMovable(player.playerState)
        && (!retained || retained.has(player.playerId)),
    })),
  };
}

export interface SolidDefenceCoordinatePlayer {
  playerId: string;
  playerState: number;
  coordinate: readonly [number, number] | null | undefined;
}

/**
 * The authoritative `playersAtCoordinates` map upstream's setup End Turn carries
 * (ffb-client-logic/.../net/ClientCommunication.java:586-596 `playerCoordinates`): every player of
 * the acting team whose state `canBeMovedDuringSetup()` (PlayerState.java:226-228 = STANDING or
 * RESERVE), at its CURRENT model coordinate. The server re-applies it in
 * AbstractStep.setPlayerCoordinates:319 and then diffs it against the offer-time snapshot to decide
 * which players moved (StepApplyKickoffResult:289-291).
 */
export function solidDefencePlayersAtCoordinates(
  players: readonly SolidDefenceCoordinatePlayer[],
): Record<string, [number, number]> {
  const map: Record<string, [number, number]> = {};
  for (const player of players) {
    const base = player.playerState & 0xff;
    if (base !== PlayerStateBase.STANDING && base !== PlayerStateBase.RESERVE) continue;
    const coordinate = player.coordinate;
    if (!coordinate || !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) continue;
    map[player.playerId] = [coordinate[0], coordinate[1]];
  }
  return map;
}

export interface InvalidSolidDefenceNotice {
  amount: number;
  limit: number;
}

/**
 * `DialogInvalidSolidDefenceParameter` (ffb-common/.../dialog): wire keys `teamId`, `nrOfPlayers`
 * (amount moved illegally) and `nrOfPlayersAllowed` (limit). Upstream's
 * DialogInvalidSolidDefenceHandler shows it ONLY to the PLAYER-mode client whose team matches, and
 * closes it locally — the dialog carries NO response command. Returns null for every audience that
 * must stay silent.
 */
export function invalidSolidDefenceNotice(
  dialog: { dialogId?: unknown; teamId?: unknown; nrOfPlayers?: unknown; nrOfPlayersAllowed?: unknown } | null | undefined,
  myTeamId: string | null | undefined,
  audienceIsActingCoach: boolean,
): InvalidSolidDefenceNotice | null {
  if (!dialog || dialog.dialogId !== 'invalidSolidDefence') return null;
  if (!audienceIsActingCoach) return null;
  if (!myTeamId || String(dialog.teamId ?? '') !== myTeamId) return null;
  const amount = Number(dialog.nrOfPlayers);
  const limit = Number(dialog.nrOfPlayersAllowed);
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    limit: Number.isFinite(limit) ? limit : 0,
  };
}
