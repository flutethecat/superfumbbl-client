import type {
  GameJson,
  PlayerDataJson,
  PlayerJson,
  PlayerResultJson,
  TeamJson,
  TeamResultJson,
} from '@fumbbl40k/ffb-protocol';

export interface ServerAddPlayerCommand {
  teamId: unknown;
  player: unknown;
  playerState?: unknown;
  sendToBoxReason?: unknown;
  sendToBoxTurn?: unknown;
  sendToBoxHalf?: unknown;
}

export interface ServerAddPlayerResult {
  playerId: string;
  side: 'home' | 'away';
  coordinate: [number, number] | null;
  inserted: boolean;
}

function rosterPlayer(value: unknown): PlayerJson {
  if (!value || typeof value !== 'object') throw new Error('serverAddPlayer is missing player');
  const player = value as PlayerJson;
  if (player.playerKind !== 'rosterPlayer' || typeof player.playerId !== 'string' || !player.playerId) {
    throw new Error('serverAddPlayer requires a rosterPlayer with playerId');
  }
  return player;
}

function wireInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`serverAddPlayer requires integer ${field}`);
  }
  return value;
}

function teamForId(game: GameJson, teamId: unknown): { team: TeamJson; result: TeamResultJson; side: 'home' | 'away' } {
  const id = String(teamId ?? '');
  if (id === game.teamHome.teamId) {
    return { team: game.teamHome, result: game.gameResult.teamResultHome, side: 'home' };
  }
  if (id === game.teamAway.teamId) {
    return { team: game.teamAway, result: game.gameResult.teamResultAway, side: 'away' };
  }
  throw new Error(`serverAddPlayer names unknown team ${id}`);
}

function boxX(side: 'home' | 'away', playerState: number): number | null {
  const offset = new Map<number, number>([
    [0x09, 0], // reserve
    [0x0e, 0], // exhausted
    [0x14, 0], // setup prevented
    [0x05, 1], // knocked out
    [0x06, 2], // badly hurt
    [0x07, 3], // serious injury
    [0x08, 4], // dead
    [0x0d, 5], // banned
    [0x0a, 6], // missing next game
  ]).get(playerState & 0xff);
  return offset === undefined ? null : side === 'home' ? -1 - offset : 30 + offset;
}

function nextBoxCoordinate(
  game: GameJson,
  side: 'home' | 'away',
  playerState: number,
  playerId: string,
): [number, number] | null {
  const x = boxX(side, playerState);
  if (x === null) return null;
  const occupied = new Set(game.fieldModel.playerDataArray
    .filter((data) => data.playerId !== playerId)
    .map((data) => data.playerCoordinate)
    .filter((coordinate): coordinate is [number, number] => Boolean(coordinate && coordinate[0] === x))
    .map((coordinate) => coordinate[1]));
  let y = 0;
  while (occupied.has(y)) y += 1;
  return [x, y];
}

function newPlayerResult(
  playerId: string,
  sendToBoxReason: unknown,
  sendToBoxTurn: number,
  sendToBoxHalf: number,
): PlayerResultJson {
  return {
    playerId,
    completions: 0,
    completionsWithAdditionalSpp: 0,
    touchdowns: 0,
    interceptions: 0,
    casualties: 0,
    casualtiesWithAdditionalSpp: 0,
    catchesWithAdditionalSpp: 0,
    playerAwards: 0,
    blocks: 0,
    fouls: 0,
    rushing: 0,
    passing: 0,
    landings: 0,
    currentSpps: 0,
    seriousInjury: null,
    seriousInjuryDecay: null,
    sendToBoxReason: sendToBoxReason ?? null,
    sendToBoxTurn,
    sendToBoxHalf,
    sendToBoxByPlayerId: null,
    turnsPlayed: 0,
    hasUsedSecretWeapon: false,
    defecting: false,
    gainedHatred: [],
  };
}

function refreshRosterPlayer(existing: PlayerJson, incoming: PlayerJson): PlayerJson {
  const mutable = existing;
  for (const field of ['movement', 'strength', 'agility', 'passing', 'armour'] as const) {
    mutable[field] = incoming[field];
  }
  mutable.lastingInjuries = structuredClone(incoming.lastingInjuries);
  mutable.recoveringInjury = incoming.recoveringInjury;
  mutable.urlPortrait = incoming.urlPortrait;
  mutable.urlIconSet = incoming.urlIconSet;
  mutable.nrOfIcons = incoming.nrOfIcons;
  mutable.skillArray = structuredClone(incoming.skillArray);
  mutable.playerStatus = incoming.playerStatus;
  return mutable;
}

function restorePlayerOrder(team: TeamJson, result: TeamResultJson): void {
  team.playerArray.sort((left, right) => Number(left.playerNr) - Number(right.playerNr));
  const resultById = new Map(result.playerResults.map((entry) => [entry.playerId, entry]));
  result.playerResults = team.playerArray
    .map((entry) => resultById.get(entry.playerId))
    .filter((entry): entry is PlayerResultJson => Boolean(entry));
}

function restoreFieldOrder(game: GameJson): void {
  const byId = new Map(game.fieldModel.playerDataArray.map((entry) => [entry.playerId, entry]));
  const orderedIds = [...game.teamHome.playerArray, ...game.teamAway.playerArray].map((entry) => entry.playerId);
  const known = new Set(orderedIds);
  game.fieldModel.playerDataArray = [
    ...orderedIds.map((id) => byId.get(id)).filter((entry): entry is PlayerDataJson => Boolean(entry)),
    ...game.fieldModel.playerDataArray.filter((entry) => !known.has(entry.playerId)),
  ];
}

/** Mirrors upstream ClientCommandHandlerAddPlayer + UtilBox.putPlayerIntoBox. */
export function applyServerAddPlayer(game: GameJson, command: ServerAddPlayerCommand): ServerAddPlayerResult {
  const incoming = rosterPlayer(command.player);
  const state = wireInteger(command.playerState, 'playerState');
  const sendToBoxTurn = wireInteger(command.sendToBoxTurn, 'sendToBoxTurn');
  const sendToBoxHalf = wireInteger(command.sendToBoxHalf, 'sendToBoxHalf');
  const { team, result, side } = teamForId(game, command.teamId);
  const existingIndex = team.playerArray.findIndex((candidate) => candidate.playerId === incoming.playerId);
  if (existingIndex >= 0 && team.playerArray[existingIndex]?.playerKind !== 'rosterPlayer') {
    throw new Error(`serverAddPlayer cannot reinitialize ${team.playerArray[existingIndex]?.playerKind}`);
  }
  const player = existingIndex >= 0
    ? refreshRosterPlayer(team.playerArray[existingIndex]!, incoming)
    : structuredClone(incoming);
  if (existingIndex < 0) team.playerArray.push(player);

  const existingData = game.fieldModel.playerDataArray.find((data) => data.playerId === player.playerId);
  const boxedCoordinate = nextBoxCoordinate(game, side, state, player.playerId);
  // UtilBox leaves an existing on-pitch coordinate unchanged when the state has no box column.
  const coordinate = boxedCoordinate ?? existingData?.playerCoordinate ?? null;
  if (existingData) {
    existingData.playerState = state;
    existingData.playerCoordinate = coordinate;
    existingData.cards ??= [];
    existingData.cardEffects ??= [];
  } else {
    const data: PlayerDataJson = {
      playerId: player.playerId,
      playerState: state,
      playerCoordinate: coordinate,
      cards: [],
      cardEffects: [],
    };
    game.fieldModel.playerDataArray.push(data);
  }

  const existingResult = result.playerResults.find((candidate) => candidate.playerId === player.playerId);
  if (existingResult) {
    existingResult.sendToBoxReason = command.sendToBoxReason ?? null;
    existingResult.sendToBoxTurn = sendToBoxTurn;
    existingResult.sendToBoxHalf = sendToBoxHalf;
  } else {
    result.playerResults.push(newPlayerResult(player.playerId, command.sendToBoxReason, sendToBoxTurn, sendToBoxHalf));
  }
  restorePlayerOrder(team, result);
  restoreFieldOrder(game);

  return { playerId: player.playerId, side, coordinate, inserted: existingIndex < 0 };
}
