import { NetCommandId, type GameJson } from '@fumbbl40k/ffb-protocol';
import { PITCH_ROWS, isOwnHalf } from '@fumbbl40k/ffb-pitch';

export interface SavedSetupTeamLike {
  teamId?: string;
  playerArray?: { playerId: string; playerNr: number }[];
}

export interface SavedSetupDeps {
  game: () => GameJson | null;
  armed: () => boolean;
  myTeam: () => SavedSetupTeamLike | null;
  send: (command: unknown) => void;
}

export interface SavedSetupPayload {
  setupName: string;
  playerNumbers: number[];
  playerCoordinates: [number, number][];
}

function ready(deps: SavedSetupDeps): boolean {
  // bb2025 StepSetup.java:49-62: every team-setup command is setup-step-only and belongs to a playing seat.
  return deps.armed() && deps.myTeam() !== null;
}

export function requestSavedSetups(deps: SavedSetupDeps): boolean {
  if (!ready(deps)) return false;
  // SetupLogicModule.java:51-52 / UtilServerSetup.loadTeamSetup:29-56: LOAD without setupName requests the list.
  deps.send({ netCommandId: NetCommandId.CLIENT_TEAM_SETUP_LOAD });
  return true;
}

export function loadSavedSetup(deps: SavedSetupDeps, setupName: string): boolean {
  if (!setupName.trim() || !ready(deps)) return false;
  // UtilServerSetup.loadTeamSetup:38-45: server-side apply only; never confirm/end setup here.
  // This player-number-fixed LOAD is saved-setup-only; predicate templates keep their CLIENT_SETUP_PLAYER path.
  deps.send({ netCommandId: NetCommandId.CLIENT_TEAM_SETUP_LOAD, setupName });
  return true;
}

export function deleteSavedSetup(deps: SavedSetupDeps, setupName: string): boolean {
  if (!setupName.trim() || !ready(deps)) return false;
  // UtilServerSetup.deleteTeamSetup:90-110; IJsonOption.java:367.
  deps.send({ netCommandId: NetCommandId.CLIENT_TEAM_SETUP_DELETE, setupName });
  return true;
}

export function saveCurrentSetup(deps: SavedSetupDeps, setupName: string): SavedSetupPayload | null {
  // UtilServerSetup.saveTeamSetup:59-87: StringTool.isProvided rejects blank names.
  if (!setupName.trim() || !ready(deps)) return null;
  const game = deps.game();
  const team = deps.myTeam();
  if (!game || !team) return null;

  const dataById = new Map(
    (game.fieldModel?.playerDataArray ?? []).map((data) => [data.playerId, data] as const),
  );
  const payload: SavedSetupPayload = { setupName, playerNumbers: [], playerCoordinates: [] };
  // DialogTeamSetupHandler.java:57-67 / TeamSetup.java: key by player nr and include HALF_HOME only.
  for (const player of team.playerArray ?? []) {
    const coordinate = dataById.get(player.playerId)?.playerCoordinate;
    if (!coordinate || !isOwnHalf(coordinate[0]) || coordinate[1] < 0 || coordinate[1] >= PITCH_ROWS) continue;
    payload.playerNumbers.push(player.playerNr);
    payload.playerCoordinates.push([coordinate[0], coordinate[1]]);
  }

  // IJsonOption.java:367,499-500; NetCommandId.java:24-26.
  deps.send({ netCommandId: NetCommandId.CLIENT_TEAM_SETUP_SAVE, ...payload });
  return payload;
}

export function replaceSavedSetupNames(
  target: string[],
  command: { setupNames?: unknown },
): boolean {
  if (!Array.isArray(command.setupNames) || !command.setupNames.every((name) => typeof name === 'string')) return false;
  // ServerCommandTeamSetupList / IJsonOption.java:386: the inbound list replaces prior names.
  target.splice(0, target.length, ...command.setupNames);
  return true;
}
