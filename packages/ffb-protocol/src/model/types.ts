/**
 * TS mirror of the FFB game model in its WIRE shape (the JSON produced by
 * ffb-common toJsonValue). We keep server JSON as the client state — the
 * ModelChangeProcessor patches it in place — so snapshot comparison against a
 * reconnect ServerCommandGameState is byte-honest.
 *
 * Scope: BB2025 (per EC-3). Derived from fixtures/local-away.jsonl and
 * ffb-common model classes.
 */

/** [x, y]; on-pitch x 0..25, y 0..14. Off-pitch zones use sentinel x values. */
export type FieldCoordinateJson = [number, number];

/** Bitmask (see ffb-common PlayerState.java). */
export type PlayerStateJson = number;

export interface PlayerDataJson {
  playerId: string;
  playerCoordinate: FieldCoordinateJson | null;
  playerState: PlayerStateJson;
  cards: unknown[];
  cardEffects: unknown[];
  [key: string]: unknown;
}

export interface FieldModelJson {
  weather: string;
  ballCoordinate: FieldCoordinateJson | null;
  ballInPlay: boolean;
  ballMoving: boolean;
  bombCoordinate: FieldCoordinateJson | null;
  bombMoving: boolean;
  bloodspotArray: unknown[];
  pushbackSquareArray: unknown[];
  moveSquareArray: unknown[];
  trackNumberArray: unknown[];
  diceDecorationArray: unknown[];
  fieldMarkerArray: unknown[];
  playerMarkerArray: unknown[];
  playerDataArray: PlayerDataJson[];
  trapDoors: unknown[];
  outOfBounds: boolean;
  /** chomper player id -> chompee player ids (FieldModel.addChomp/removeChomp/notChomped). */
  chomped: Record<string, string[]>;
  rangeRuler?: unknown;
  targetSelectionState?: unknown;
  [key: string]: unknown;
}

export interface PlayerJson {
  playerKind: string;
  playerId: string;
  playerNr: number;
  positionId: string;
  playerName: string;
  playerGender: string | null;
  playerType: string;
  movement: number;
  strength: number;
  agility: number;
  passing: number;
  armour: number;
  lastingInjuries: string[];
  recoveringInjury: string | null;
  skillArray: string[];
  usedSkills: string[];
  temporarySkillsMap: Record<string, unknown>;
  temporaryModifiersMap: Record<string, unknown>;
  temporaryPropertiesMap: Record<string, unknown>;
  skillValuesMap: Record<string, unknown>;
  skillDisplayValuesMap: Record<string, unknown>;
  /** Owner 09-09: the team-array serialization carries the BASE skill values as arrays parallel to skillArray
   *  (`"skillValues":[null,null,"undead","4",…]`, e.g. Hatred's keyword, Loner's 4+) — the map form above is what
   *  a model sync carries. Either may be present. */
  skillValues?: (string | null)[];
  skillDisplayValues?: (string | null)[];
  [key: string]: unknown;
}

export interface TeamJson {
  teamId: string;
  teamName: string;
  coach: string;
  race: string;
  reRolls: number;
  apothecaries: number;
  cheerleaders: number;
  assistantCoaches: number;
  fanFactor: number;
  teamValue: number;
  treasury: number;
  dedicatedFans: number;
  specialRules: string[];
  playerArray: PlayerJson[];
  roster: Record<string, unknown>;
  [key: string]: unknown;
}

export interface InducementSetJson {
  inducementArray: unknown[];
  cardsAvailable: unknown[];
  cardsActive: unknown[];
  cardsDeactivated: unknown[];
  prayers: unknown[];
  [key: string]: unknown;
}

export interface TurnDataJson {
  homeData: boolean;
  turnStarted: boolean;
  turnNr: number;
  firstTurnAfterKickoff: boolean;
  reRolls: number;
  apothecaries: number;
  wanderingApothecaries: number;
  plagueDoctors: number;
  blitzUsed: boolean;
  foulUsed: boolean;
  reRollUsed: boolean;
  handOverUsed: boolean;
  passUsed: boolean;
  ttmUsed: boolean;
  ktmUsed: boolean;
  coachBanned: boolean;
  leaderState: string;
  inducementSet: InducementSetJson;
  [key: string]: unknown;
}

export interface PlayerResultJson {
  playerId: string;
  [key: string]: unknown;
}

export interface TeamResultJson {
  score: number;
  conceded: boolean;
  playerResults: PlayerResultJson[];
  [key: string]: unknown;
}

export interface GameResultJson {
  teamResultHome: TeamResultJson;
  teamResultAway: TeamResultJson;
  [key: string]: unknown;
}

export interface ActingPlayerJson {
  playerId: string | null;
  currentMove: number;
  usedSkills: string[];
  initialAdjacentPartnerIds?: string[];
  skillsGrantedBy: Record<string, unknown>;
  playerAction: string | null;
  [key: string]: unknown;
}

export interface GameOptionJson {
  gameOptionId: string;
  gameOptionValue: string;
  [key: string]: unknown;
}

export interface GameJson {
  gameId: number;
  scheduled: string | null;
  started: string | null;
  finished: string | null;
  homePlaying: boolean;
  half: number;
  turnMode: string;
  lastTurnMode: string | null;
  defenderId: string | null;
  lastDefenderId: string | null;
  defenderAction: string | null;
  passCoordinate: FieldCoordinateJson | null;
  throwerId: string | null;
  throwerAction: string | null;
  teamHome: TeamJson;
  teamAway: TeamJson;
  turnDataHome: TurnDataJson;
  turnDataAway: TurnDataJson;
  fieldModel: FieldModelJson;
  actingPlayer: ActingPlayerJson;
  gameResult: GameResultJson;
  gameOptions: { gameOptionArray: GameOptionJson[] };
  dialogParameter: { dialogId: string; [key: string]: unknown } | null;
  concededLegally: boolean;
  [key: string]: unknown;
}

export interface ModelChangeJson {
  modelChangeId: string;
  modelChangeKey: string | null;
  modelChangeValue: unknown;
}

export interface ModelChangeListJson {
  modelChangeArray: ModelChangeJson[];
}
