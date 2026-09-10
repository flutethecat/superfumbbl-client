import {
  applyModelChangeList,
  NetCommandId,
  type GameJson,
  type PlayerJson,
  type PlayerResultJson,
  type TeamJson,
  type TeamResultJson,
  type TurnDataJson,
} from '@fumbbl40k/ffb-protocol';
import { applyServerAddPlayer } from '../serverAddPlayer';
import type { ReplayCommand } from './replayController';

const RESERVE = 0x09;
const MISSING = 0x0a;

function playerId(player: PlayerJson): string {
  const nested = player.player as PlayerJson | undefined;
  return String(player.playerId ?? nested?.playerId ?? '');
}

function transientPlayer(player: PlayerJson): boolean {
  const nested = player.player as PlayerJson | undefined;
  const type = String(player.playerType ?? nested?.playerType ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return !type || type === 'mercenary' || type === 'raisedfromdead';
}

function resetPlayer(player: PlayerJson): void {
  const mutable = (player.originalPlayer ?? player.player ?? player) as PlayerJson;
  if (mutable !== player) resetPlayer(mutable);
  player.usedSkills = [];
  player.temporarySkillsMap = {};
  player.temporaryModifiersMap = {};
  player.temporaryPropertiesMap = {};
}

function zappedPlayer(original: PlayerJson, rulesVersion: string): PlayerJson {
  const legacy = /^BB2016$/i.test(rulesVersion);
  return {
    ...structuredClone(original),
    playerKind: 'zappedPlayer',
    originalPlayer: structuredClone(original),
    movement: 5,
    strength: 1,
    agility: legacy ? 4 : 2,
    passing: 0,
    armour: legacy ? 4 : 5,
    recoveringInjury: null,
    nrOfIcons: 1,
    skillArray: ['Dodge', legacy || /^BB2020$/i.test(rulesVersion) ? 'No Hands' : 'No Ball', 'Titchy', 'Stunty', 'Very Long Legs', 'Leap'],
    skillValuesMap: {},
    skillDisplayValuesMap: {},
  };
}

function keepInitialPlayers(team: TeamJson): Set<string> {
  team.playerArray = team.playerArray.filter((player) => !transientPlayer(player));
  for (const player of team.playerArray) resetPlayer(player);
  return new Set(team.playerArray.map(playerId));
}

function teamForId(game: GameJson, teamId: unknown): TeamJson {
  const id = String(teamId ?? '');
  if (id === game.teamHome.teamId) return game.teamHome;
  if (id === game.teamAway.teamId) return game.teamAway;
  throw new Error(`Replay command names unknown team ${id}`);
}

function teamResultFor(game: GameJson, team: TeamJson): TeamResultJson {
  return team === game.teamHome ? game.gameResult.teamResultHome : game.gameResult.teamResultAway;
}

function freshPlayerResult(player: PlayerJson, prior: PlayerResultJson | undefined): PlayerResultJson {
  return {
    playerId: player.playerId,
    completions: 0,
    completionsWithAdditionalSpp: 0,
    touchdowns: 0,
    interceptions: 0,
    casualties: 0,
    casualtiesWithAdditionalSpp: 0,
    playerAwards: 0,
    blocks: 0,
    fouls: 0,
    rushing: 0,
    passing: 0,
    currentSpps: Number(prior?.currentSpps ?? 0),
    seriousInjury: null,
    seriousInjuryDecay: null,
    sendToBoxReason: player.recoveringInjury ? 'mng' : null,
    sendToBoxTurn: 0,
    sendToBoxHalf: 0,
    sendToBoxByPlayerId: null,
    turnsPlayed: 0,
    hasUsedSecretWeapon: false,
    defecting: false,
    catchesWithAdditionalSpp: 0,
    gainedHatred: [],
    landings: 0,
  };
}

function freshTeamResult(team: TeamJson, prior: TeamResultJson): TeamResultJson {
  const priorById = new Map(prior.playerResults.map((result) => [result.playerId, result]));
  return {
    score: 0,
    conceded: false,
    raisedDead: 0,
    spectators: 0,
    fame: 0,
    winnings: 0,
    fanFactorModifier: 0,
    badlyHurtSuffered: 0,
    seriousInjurySuffered: 0,
    ripSuffered: 0,
    spirallingExpenses: 0,
    playerResults: team.playerArray.map((player) => freshPlayerResult(player, priorById.get(player.playerId))),
    pettyCashFromTvDiff: 0,
    pettyCashTransferred: 0,
    pettyCashUsed: 0,
    teamValue: 0,
    treasuryUsedOnInducements: 0,
    fanFactor: 0,
    dedicatedFans: 0,
    penaltyScore: -1,
    stalling: false,
  };
}

function freshTurnData(homeData: boolean): TurnDataJson {
  return {
    homeData,
    turnStarted: false,
    turnNr: 0,
    firstTurnAfterKickoff: false,
    reRolls: 0,
    rerollBrilliantCoachingOneDrive: 0,
    apothecaries: 0,
    blitzUsed: false,
    foulUsed: false,
    reRollUsed: false,
    handOverUsed: false,
    passUsed: false,
    coachBanned: false,
    ktmUsed: false,
    bombUsed: false,
    secureTheBallUsed: false,
    leaderState: 'none',
    inducementSet: {
      inducementArray: [], cardsAvailable: [], cardsActive: [], cardsDeactivated: [], prayers: [],
    },
    wanderingApothecaries: 0,
    rerollPumpUpTheCrowdOneDrive: 0,
    plagueDoctors: 0,
    ttmUsed: false,
    puntUsed: false,
    cheeringFansBlockAssist: 0,
    blitzingPlayerId: null,
  };
}

/** Mirrors ClientReplayer.createGame(): keep final rosters/options, reset the mutable match model. */
export function createReplaySeed(finalState: Readonly<GameJson>): GameJson {
  const seed = structuredClone(finalState) as GameJson;
  const rulesVersion = seed.gameOptions?.gameOptionArray
    ?.find((option) => option.gameOptionId === 'rulesVersion')?.gameOptionValue ?? 'BB2020';
  for (const team of [seed.teamHome, seed.teamAway]) {
    team.playerArray = team.playerArray.map((player) => {
      const nested = player.player as PlayerJson | undefined;
      return String(player.playerKind) === 'zappedPlayer' && nested ? zappedPlayer(nested, rulesVersion) : player;
    });
  }
  const homePlayers = keepInitialPlayers(seed.teamHome);
  const awayPlayers = keepInitialPlayers(seed.teamAway);

  seed.scheduled = null;
  seed.homePlaying = true;
  seed.half = 0;
  seed.homeFirstOffense = false;
  seed.setupOffense = false;
  seed.waitingForOpponent = false;
  seed.timeoutPossible = false;
  seed.timeoutEnforced = false;
  seed.concessionPossible = false;
  seed.testing = false;
  seed.turnMode = 'startGame';
  seed.lastTurnMode = null;
  seed.started = null;
  seed.finished = null;
  seed.defenderId = null;
  seed.lastDefenderId = null;
  seed.defenderAction = null;
  seed.passCoordinate = null;
  seed.throwerId = null;
  seed.throwerAction = null;
  seed.teamState = 'FULL';
  seed.actingPlayer = {
    playerId: null,
    currentMove: 0,
    goingForIt: false,
    hasBlocked: false,
    hasFed: false,
    hasFouled: false,
    hasMoved: false,
    hasPassed: false,
    usedSkills: [],
    skillsGrantedBy: {},
    playerAction: null,
    standingUp: false,
    sufferingAnimosity: false,
    sufferingBloodlust: false,
    fumblerooskiePending: false,
    jumpsWithoutModifiers: false,
    playerStateOld: null,
    heldInPlace: false,
    mustCompleteAction: false,
    fellFromRush: false,
    hasTriggeredEffect: false,
  };
  seed.dialogParameter = { dialogId: 'startGame' };
  seed.concededLegally = false;

  seed.fieldModel.weather = 'Nice Weather';
  seed.fieldModel.ballCoordinate = null;
  seed.fieldModel.ballInPlay = false;
  seed.fieldModel.ballMoving = false;
  seed.fieldModel.bombCoordinate = null;
  seed.fieldModel.bombMoving = false;
  seed.fieldModel.bloodspotArray = [];
  seed.fieldModel.pushbackSquareArray = [];
  seed.fieldModel.moveSquareArray = [];
  seed.fieldModel.trackNumberArray = [];
  seed.fieldModel.diceDecorationArray = [];
  seed.fieldModel.fieldMarkerArray = [];
  seed.fieldModel.playerMarkerArray = [];
  seed.fieldModel.trapDoors = [];
  seed.fieldModel.outOfBounds = false;
  seed.fieldModel.chomped = {};
  delete seed.fieldModel.rangeRuler;
  delete seed.fieldModel.targetSelectionState;
  const players = [...seed.teamHome.playerArray, ...seed.teamAway.playerArray];
  const boxRows = new Map<number, number>();
  seed.fieldModel.playerDataArray = players.map((player) => {
    const home = homePlayers.has(player.playerId);
    const missing = Boolean(player.recoveringInjury);
    const boxX = missing ? (home ? -7 : 36) : (home ? -1 : 30);
    const boxY = boxRows.get(boxX) ?? 0;
    boxRows.set(boxX, boxY + 1);
    return {
      playerId: player.playerId,
      playerCoordinate: [boxX, boxY],
      playerState: missing ? MISSING : RESERVE,
      cards: [],
      cardEffects: [],
    };
  });

  seed.turnDataHome = freshTurnData(true);
  seed.turnDataAway = freshTurnData(false);

  seed.gameResult = {
    teamResultHome: freshTeamResult(seed.teamHome, finalState.gameResult.teamResultHome),
    teamResultAway: freshTeamResult(seed.teamAway, finalState.gameResult.teamResultAway),
  };
  return seed;
}

function addPlayer(game: GameJson, command: Readonly<ReplayCommand>): void {
  applyServerAddPlayer(game, {
    teamId: command.teamId,
    player: command.player,
    playerState: command.playerState,
    sendToBoxReason: command.sendToBoxReason,
    sendToBoxTurn: command.sendToBoxTurn,
    sendToBoxHalf: command.sendToBoxHalf,
  });
}

function removePlayer(game: GameJson, command: Readonly<ReplayCommand>): void {
  const removedId = String(command.playerId ?? '');
  if (!removedId) throw new Error('serverRemovePlayer is missing playerId');
  for (const team of [game.teamHome, game.teamAway]) {
    team.playerArray = team.playerArray.filter((player) => removedId !== playerId(player));
    teamResultFor(game, team).playerResults = teamResultFor(game, team).playerResults
      .filter((result) => result.playerId !== removedId);
  }
  game.fieldModel.playerDataArray = game.fieldModel.playerDataArray.filter((data) => data.playerId !== removedId);
}

/**
 * Mirror ClientCommandHandlerZapPlayer: the server sends Zap as its own replayable
 * push, outside ServerCommandModelSync, and replaces the team's RosterPlayer with
 * a ZappedPlayer carrying the same stable id.
 */
export function applyZapPlayerCommand(game: GameJson, command: Readonly<ReplayCommand>): void {
  const team = teamForId(game, command.teamId);
  const id = String(command.playerId ?? '');
  const index = team.playerArray.findIndex((player) => playerId(player) === id);
  if (index < 0) throw new Error(`serverZapPlayer names unknown player ${id}`);
  const original = team.playerArray[index]!;
  if (String(original.playerKind) !== 'rosterPlayer') return;
  const rulesVersion = game.gameOptions?.gameOptionArray
    ?.find((option) => option.gameOptionId === 'rulesVersion')?.gameOptionValue ?? 'BB2020';
  team.playerArray[index] = zappedPlayer(original, rulesVersion);
}

/** Mirror ClientCommandHandlerUnzapPlayer when a drive boundary expires Zap. */
export function applyUnzapPlayerCommand(game: GameJson, command: Readonly<ReplayCommand>): void {
  const team = teamForId(game, command.teamId);
  const id = String(command.playerId ?? '');
  const index = team.playerArray.findIndex((player) => playerId(player) === id);
  if (index < 0) throw new Error(`serverUnzapPlayer names unknown player ${id}`);
  const current = team.playerArray[index]!;
  if (String(current.playerKind) !== 'zappedPlayer') return;
  const original = current.originalPlayer as PlayerJson | undefined;
  if (!original) throw new Error(`serverUnzapPlayer has no original player for ${id}`);
  team.playerArray[index] = structuredClone(original);
}

export const REPLAY_MODEL_COMMANDS = new Set<string>([
  NetCommandId.SERVER_MODEL_SYNC,
  NetCommandId.SERVER_ADD_PLAYER,
  NetCommandId.SERVER_REMOVE_PLAYER,
  NetCommandId.SERVER_ZAP_PLAYER,
  NetCommandId.SERVER_UNZAP_PLAYER,
  NetCommandId.SERVER_UPDATE_LOCAL_PLAYER_MARKERS,
  NetCommandId.SERVER_ADD_SKETCHES,
  NetCommandId.SERVER_REMOVE_SKETCHES,
  NetCommandId.SERVER_SKETCH_ADD_COORDINATE,
  NetCommandId.SERVER_SKETCH_SET_COLOR,
  NetCommandId.SERVER_SKETCH_SET_LABEL,
  NetCommandId.SERVER_CLEAR_SKETCHES,
  NetCommandId.SERVER_SET_PREVENT_SKETCHING,
]);

export function applyReplayCommand(game: GameJson, command: Readonly<ReplayCommand>): void {
  switch (command.netCommandId) {
    case NetCommandId.SERVER_MODEL_SYNC: {
      const result = applyModelChangeList(game, command.modelChangeList as never);
      if (result.unknown.length) throw new Error(`Unknown replay model changes: ${result.unknown.join(', ')}`);
      return;
    }
    case NetCommandId.SERVER_ADD_PLAYER:
      addPlayer(game, command);
      return;
    case NetCommandId.SERVER_REMOVE_PLAYER:
      removePlayer(game, command);
      return;
    case NetCommandId.SERVER_ZAP_PLAYER:
      applyZapPlayerCommand(game, command);
      return;
    case NetCommandId.SERVER_UNZAP_PLAYER:
      applyUnzapPlayerCommand(game, command);
      return;
    case NetCommandId.SERVER_UPDATE_LOCAL_PLAYER_MARKERS:
    case NetCommandId.SERVER_ADD_SKETCHES:
    case NetCommandId.SERVER_REMOVE_SKETCHES:
    case NetCommandId.SERVER_SKETCH_ADD_COORDINATE:
    case NetCommandId.SERVER_SKETCH_SET_COLOR:
    case NetCommandId.SERVER_SKETCH_SET_LABEL:
    case NetCommandId.SERVER_CLEAR_SKETCHES:
    case NetCommandId.SERVER_SET_PREVENT_SKETCHING:
      return;
    default:
      throw new Error(`Unsupported replay command ${command.netCommandId}`);
  }
}

export function replayCommandIsTurnEnd(command: Readonly<ReplayCommand>): boolean {
  if (command.netCommandId !== NetCommandId.SERVER_MODEL_SYNC) return false;
  const reports = (command.reportList as { reports?: readonly { reportId?: unknown }[] } | undefined)?.reports ?? [];
  return reports.some((report) => String(report.reportId) === 'turnEnd');
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stable(entry)]));
}

/**
 * A full serverGameState serializes ZappedPlayer as
 * `{ playerKind: "zappedPlayer", player: <original roster player> }`. The Java
 * client reconstructs the effective frog through Player.createFromJson; flatten
 * that wrapper for every TypeScript model consumer (renderer, cards and skills).
 * This is required on live/spectator reconnect, not only by replay fingerprints.
 */
export function normalizeZappedPlayerSnapshots(game: GameJson): void {
  const rulesVersion = game.gameOptions?.gameOptionArray
    ?.find((option) => option.gameOptionId === 'rulesVersion')?.gameOptionValue ?? 'BB2020';
  for (const team of [game.teamHome, game.teamAway]) {
    team.playerArray = team.playerArray.map((player) => {
      const nested = (player.originalPlayer ?? player.player) as PlayerJson | undefined;
      return String(player.playerKind) === 'zappedPlayer' && nested ? zappedPlayer(nested, rulesVersion) : player;
    });
  }
}

/** Broad deterministic projection used to detect presentation/fold divergence. */
export function replayStateFingerprint(game: Readonly<GameJson>): string {
  const copy = structuredClone(game) as GameJson;
  normalizeZappedPlayerSnapshots(copy);
  return JSON.stringify(stable(copy));
}
