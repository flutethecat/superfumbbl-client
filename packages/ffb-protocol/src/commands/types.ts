import { NetCommandId } from './netCommandId';

/** Every wire message carries a netCommandId discriminator. */
export interface NetCommand {
  netCommandId: string;
  [key: string]: unknown;
}

/** Server->client commands additionally carry a sequence number. */
export interface ServerCommand extends NetCommand {
  commandNr?: number;
}

export type ClientMode = 'player' | 'spectator' | 'replay';

// --- M1a handshake subset (hand-written; full surface arrives via codegen) ---

export interface ClientCommandRequestVersion extends NetCommand {
  netCommandId: typeof NetCommandId.CLIENT_REQUEST_VERSION;
}

export interface ServerCommandVersion extends ServerCommand {
  netCommandId: typeof NetCommandId.SERVER_VERSION;
  serverVersion: string;
  clientVersion: string;
  clientProperties?: string[];
  clientPropertyValues?: string[];
  testing?: boolean;
}

/** Requests a challenge; the coach name rides in the `coach` field. */
export interface ClientCommandPasswordChallenge extends NetCommand {
  netCommandId: typeof NetCommandId.CLIENT_PASSWORD_CHALLENGE;
  coach: string;
}

export interface ServerCommandPasswordChallenge extends ServerCommand {
  netCommandId: typeof NetCommandId.SERVER_PASSWORD_CHALLENGE;
  challenge: string;
}

/**
 * Join is sent AFTER the challenge; `password` carries the challenge response
 * (see auth/passwordChallenge.ts), never the clear-text password.
 * gameId 0 asks the server for the coach's game list instead of joining.
 */
export interface ClientCommandJoin extends NetCommand {
  netCommandId: typeof NetCommandId.CLIENT_JOIN;
  clientMode: ClientMode;
  coach: string;
  password: string;
  gameId: number;
  gameName?: string;
  teamId?: string;
  teamName?: string;
}

export interface ServerCommandJoin extends ServerCommand {
  netCommandId: typeof NetCommandId.SERVER_JOIN;
  coach: string;
  clientMode: ClientMode;
  spectators?: number;
  playerNames?: string[];
  /** Upstream `spectatorNames` (IJsonOption.SPECTATOR_NAMES): every spectating coach, also on serverLeave. */
  spectatorNames?: string[];
}

/** One unfinished game returned by FUMBBL's coach-scoped lobby query. */
export interface GameListEntry {
  gameId: number;
  started?: string | number | null;
  teamHomeId?: string | null;
  teamHomeName?: string | null;
  teamHomeCoach?: string | null;
  teamAwayId?: string | null;
  teamAwayName?: string | null;
  teamAwayCoach?: string | null;
}

export interface ServerCommandGameList extends ServerCommand {
  netCommandId: typeof NetCommandId.SERVER_GAME_LIST;
  gameList?: { gameListEntries?: GameListEntry[] } | null;
}

/** Login/lobby failure surface. `serverStatus` is an upstream enum name. */
export interface ServerCommandStatus extends ServerCommand {
  netCommandId: typeof NetCommandId.SERVER_STATUS;
  serverStatus?: string | null;
  message?: string | null;
}

export interface ServerCommandGameState extends ServerCommand {
  netCommandId: typeof NetCommandId.SERVER_GAME_STATE;
  /** Full Game snapshot; typed loosely until the model mirror lands (M1b). */
  game: Record<string, unknown>;
}

export interface ServerCommandModelSync extends ServerCommand {
  netCommandId: typeof NetCommandId.SERVER_MODEL_SYNC;
  modelChangeList?: Record<string, unknown>;
  reportList?: Record<string, unknown>;
  animation?: Record<string, unknown> | null;
  sound?: string | null;
  gameTime?: number;
  turnTime?: number;
}

export interface ClientCommandPing extends NetCommand {
  netCommandId: typeof NetCommandId.CLIENT_PING;
  timestamp: number;
}

export interface ServerCommandPong extends ServerCommand {
  netCommandId: typeof NetCommandId.SERVER_PONG;
  timestamp: number;
}

export interface ClientCommandTalk extends NetCommand {
  netCommandId: typeof NetCommandId.CLIENT_TALK;
  talk: string;
}

/** Wizard dialog answer; command coordinates use UtilJson's compact array form. */
export interface ClientCommandWizardSpell extends NetCommand {
  netCommandId: typeof NetCommandId.CLIENT_WIZARD_SPELL;
  wizardSpell: 'fireball' | 'zap' | null;
  targetCoordinate: [number, number] | null;
}

/** SWOOP glide-square pick, answering `StepSwoop`'s wait for `state.coordinateTo`
 *  (`ClientCommandSwoop.java:26-27`; `IJsonOption.java:12` actingPlayerId, `:566` targetCoordinate compact array —
 *  same shape as `ClientCommandWizardSpell` above). game 864 P1: this command had a wire type but no sender. */
export interface ClientCommandSwoop extends NetCommand {
  netCommandId: typeof NetCommandId.CLIENT_SWOOP;
  actingPlayerId: string;
  targetCoordinate: [number, number];
}

export interface ServerCommandTalk extends ServerCommand {
  netCommandId: typeof NetCommandId.SERVER_TALK;
  coach?: string;
  talks?: string[];
}
