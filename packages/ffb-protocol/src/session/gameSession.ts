import { FfbConnection, type FfbConnectionOptions } from '../transport/connection';
import { NetCommandId } from '../commands/netCommandId';
import { createChallengeResponse, fromHexString, isMd5Hex, respondToChallenge } from '../auth/passwordChallenge';
import type {
  ClientMode,
  NetCommand,
  ServerCommand,
  ServerCommandGameState,
  ServerCommandGameList,
  ServerCommandJoin,
  ServerCommandModelSync,
  ServerCommandPasswordChallenge,
  ServerCommandTalk,
  ServerCommandStatus,
  ServerCommandVersion,
} from '../commands/types';

export interface GameSessionParams {
  coach: string;
  /** Clear-text password. Prefer `passwordMd5` where the caller already holds the digest —
   *  see below. Ignored when `passwordMd5` is a valid digest. */
  password: string;
  /** hex md5(pw), when the credential reached us already hashed (a `-passwordMd5` fork JNLP,
   *  owner security ruling 08-17). Feeds the SAME upstream computation: the challenge
   *  response is keyed on md5(pw), so a caller holding the digest never needs the clear
   *  text at all. Takes precedence over `password` when well-formed. */
  passwordMd5?: string;
  gameId: number;
  mode: ClientMode;
  gameName?: string;
  teamId?: string;
  teamName?: string;
  /** Play-permission token issued by OUR fork server (spectator-build gate).
   *  Sent on the join when present; upstream FUMBBL ignores unknown JSON fields
   *  and the fork validates it server-side at FM1 (ffb-league). */
  authToken?: string;
  /** FUMBBL one-time join token from a player JNLP's `-auth` arg. When present it
   *  REPLACES the HMAC password challenge: after SERVER_VERSION the join is sent with this
   *  token as the CLIENT_JOIN password and NO clientPasswordChallenge round-trip —
   *  mirroring the upstream client (LoginLogicModule.sendChallenge():
   *  `if (auth) sendJoin(auth) else sendPasswordChallenge()`). Distinct from
   *  `authToken` (the fork gate token, which is an extra field on a normal join). */
  fumbblAuthToken?: string;
}

export type SessionState =
  | 'idle'
  | 'connecting'
  | 'versioning'
  | 'ready'
  | 'authenticating'
  | 'joining'
  | 'joined'
  | 'closed';

/** Native login parity: only the named-game collision leaves the prepared token/socket reusable. */
export function isRecoverableFumbblLobbyStatus(serverStatus: unknown): boolean {
  return String(serverStatus ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'gameinuse';
}

export interface GameSessionEvents {
  state: (state: SessionState) => void;
  version: (command: ServerCommandVersion) => void;
  join: (command: ServerCommandJoin) => void;
  gameState: (command: ServerCommandGameState) => void;
  gameList: (command: ServerCommandGameList) => void;
  status: (command: ServerCommandStatus) => void;
  modelSync: (command: ServerCommandModelSync) => void;
  talk: (command: ServerCommandTalk) => void;
  command: (command: ServerCommand) => void;
  error: (error: unknown) => void;
  close: (code: number, reason: string) => void;
}

const DEFAULT_PING_INTERVAL_MS = 8_000;

/**
 * Handshake state machine, mirroring the flow in the upstream client
 * (LoginLogicModule.java):
 *
 *   connect → clientRequestVersion → serverVersion → clientPasswordChallenge(coach)
 *     → serverPasswordChallenge(challenge)
 *     → clientJoin(coach, password=HMAC-MD5 response, gameId, mode)
 *     → serverJoin + serverGameState → joined; serverModelSync stream follows.
 *
 * Token mode (FUMBBL player JNLP with a `-auth` token): the challenge is skipped —
 *   connect → clientRequestVersion → serverVersion → clientJoin(coach, password=token, gameId, mode)
 * matching the upstream client's `if (auth) sendJoin(auth) else sendPasswordChallenge()`.
 */
export class GameSession {
  readonly connection: FfbConnection;
  private currentState: SessionState = 'idle';
  private params: GameSessionParams | null = null;
  private oneTimeFumbblToken: string | null = null;
  private versionReady = false;
  private autoJoinAfterVersion = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners: { [K in keyof GameSessionEvents]: Set<GameSessionEvents[K]> } = {
    state: new Set(),
    version: new Set(),
    join: new Set(),
    gameState: new Set(),
    gameList: new Set(),
    status: new Set(),
    modelSync: new Set(),
    talk: new Set(),
    command: new Set(),
    error: new Set(),
    close: new Set(),
  };

  constructor(connectionOptions: FfbConnectionOptions) {
    this.connection = new FfbConnection(connectionOptions);
    this.connection.on('command', (command) => this.handleCommand(command as ServerCommand));
    this.connection.on('error', (error) => this.emit('error', error));
    this.connection.on('close', (code, reason) => {
      this.stopPing();
      this.scrubCredentials();
      this.setState('closed');
      this.emit('close', code, reason);
    });
  }

  get state(): SessionState {
    return this.currentState;
  }

  on<K extends keyof GameSessionEvents>(event: K, listener: GameSessionEvents[K]): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  async join(params: GameSessionParams): Promise<void> {
    await this.prepare(params, true);
  }

  /**
   * Opens and versions one socket without spending a FUMBBL JNLP token. The lobby may
   * request the coach's server-side game list and then join a selected/named game over
   * this same socket.
   */
  async prepareFumbblLobby(params: GameSessionParams): Promise<void> {
    if (!params.fumbblAuthToken || params.mode !== 'player') {
      throw new Error('A FUMBBL player token is required to prepare the lobby');
    }
    await this.prepare(params, false);
  }

  private async prepare(params: GameSessionParams, autoJoinAfterVersion: boolean): Promise<void> {
    this.scrubCredentials();
    const { fumbblAuthToken, ...safeParams } = params;
    this.params = safeParams;
    this.oneTimeFumbblToken = fumbblAuthToken ?? null;
    this.autoJoinAfterVersion = autoJoinAfterVersion;
    this.versionReady = false;
    this.setState('connecting');
    try {
      await this.connection.connect();
    } catch (error) {
      this.scrubCredentials();
      this.setState('closed');
      throw error;
    }
    this.setState('versioning');
    this.connection.send({ netCommandId: NetCommandId.CLIENT_REQUEST_VERSION });
  }

  /** Ask upstream for the unfinished games belonging to this coach. */
  requestPreparedGameList(): void {
    this.requirePreparedFumbblLobby();
    this.sendJoinCommand(this.oneTimeFumbblToken!, {
      gameId: 0,
      gameName: null,
      teamId: null,
      teamName: null,
      joining: false,
    });
  }

  /** Spend the prepared token on one exact server-listed game or an explicit game name. */
  joinPreparedFumbblGame(target: { gameId?: number; gameName?: string; teamId?: string; teamName?: string }): void {
    this.requirePreparedFumbblLobby();
    const gameId = Number(target.gameId ?? 0);
    // FUMBBL game names are case-sensitive. Use trim only to reject an empty name;
    // the wire value must remain exactly what the coach entered.
    const gameName = typeof target.gameName === 'string' && target.gameName.trim()
      ? target.gameName
      : null;
    if (!(Number.isInteger(gameId) && gameId > 0) && !gameName) {
      throw new Error('A positive gameId or non-empty gameName is required');
    }
    const token = this.oneTimeFumbblToken!;
    try {
      this.sendJoinCommand(token, {
        gameId: gameId > 0 ? gameId : 0,
        gameName,
        teamId: target.teamId ?? null,
        teamName: target.teamName ?? null,
        joining: true,
      });
    } catch (error) {
      // A failed write cannot make a one-time JNLP credential safe to retry.
      this.oneTimeFumbblToken = null;
      throw error;
    }
  }

  private requirePreparedFumbblLobby(): void {
    if (this.currentState !== 'ready' || !this.versionReady || !this.params || !this.oneTimeFumbblToken || !this.connection.isOpen) {
      throw new Error('FUMBBL lobby socket is not ready');
    }
  }

  /** Send CLIENT_JOIN with the given password (HMAC challenge response, or a FUMBBL
   *  one-time -auth token). Shared by both join paths. */
  private sendJoinCommand(password: string, override?: {
    gameId: number;
    gameName: string | null;
    teamId: string | null;
    teamName: string | null;
    joining: boolean;
  }): void {
    const params = this.params;
    if (!params) return;
    if (override?.joining !== false) this.setState('joining');
    this.connection.send({
      netCommandId: NetCommandId.CLIENT_JOIN,
      clientMode: params.mode,
      coach: params.coach,
      password,
      gameId: override?.gameId ?? params.gameId,
      gameName: override ? override.gameName : params.gameName ?? null,
      teamId: override ? override.teamId : params.teamId ?? null,
      teamName: override ? override.teamName : params.teamName ?? null,
      // fork play-permission token (our fork; FUMBBL ignores unknown fields)
      ...(params.authToken ? { authToken: params.authToken } : {}),
    } as NetCommand);
  }

  sendTalk(talk: string): void {
    this.connection.send({ netCommandId: NetCommandId.CLIENT_TALK, talk });
  }

  send(command: NetCommand): void {
    this.connection.send(command);
  }

  close(): void {
    if (this.currentState === 'closed') {
      this.scrubCredentials();
      return;
    }
    this.stopPing();
    if (this.connection.isOpen) {
      this.connection.send({ netCommandId: NetCommandId.CLIENT_CLOSE_SESSION });
    }
    this.connection.close();
    this.scrubCredentials();
    this.setState('closed');
  }

  private handleCommand(command: ServerCommand): void {
    switch (command.netCommandId) {
      case NetCommandId.SERVER_VERSION: {
        // SERVER_VERSION is a one-shot response to CLIENT_REQUEST_VERSION. A duplicate
        // packet must never regress a prepared/joining/joined session or re-arm auth.
        if (this.currentState !== 'versioning' || this.versionReady) break;
        // The server announces client properties, including the required ping
        // cadence (client.ping.interval); the upstream client pings from the
        // moment it learns it, or the session-timeout will drop us.
        const version = command as ServerCommandVersion;
        const properties = version.clientProperties ?? [];
        const values = version.clientPropertyValues ?? [];
        const pingIndex = properties.indexOf('client.ping.interval');
        const interval = pingIndex >= 0 ? Number(values[pingIndex]) : NaN;
        this.startPing(Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_PING_INTERVAL_MS);
        this.versionReady = true;
        this.emit('version', version);
        if (this.autoJoinAfterVersion) {
          this.autoJoinAfterVersion = false;
          if (this.oneTimeFumbblToken) {
            const token = this.oneTimeFumbblToken;
            this.sendJoinCommand(token);
          } else if (this.params) {
            this.setState('authenticating');
            this.connection.send({ netCommandId: NetCommandId.CLIENT_PASSWORD_CHALLENGE, coach: this.params.coach });
          }
        } else {
          this.setState('ready');
        }
        break;
      }
      case NetCommandId.SERVER_PASSWORD_CHALLENGE: {
        const params = this.params;
        if (!params) break;
        const challenge = (command as ServerCommandPasswordChallenge).challenge;
        // Both branches run upstream's PasswordChallenge.createResponse; they differ only in
        // where md5(pw) came from. A pre-hashed credential means the clear text never had to
        // exist on this side of the launch at all.
        this.sendJoinCommand(
          isMd5Hex(params.passwordMd5)
            ? createChallengeResponse(challenge, fromHexString(params.passwordMd5!.toLowerCase()))
            : respondToChallenge(challenge, params.password),
        );
        break;
      }
      case NetCommandId.SERVER_JOIN:
        // Acceptance consumes the JNLP token. A named-game collision arrives as
        // SERVER_STATUS before this point and therefore retains it for correction.
        this.oneTimeFumbblToken = null;
        this.setState('joined');
        this.emit('join', command as ServerCommandJoin);
        break;
      case NetCommandId.SERVER_GAME_STATE:
        this.emit('gameState', command as ServerCommandGameState);
        break;
      case NetCommandId.SERVER_GAME_LIST:
        this.emit('gameList', command as ServerCommandGameList);
        break;
      case NetCommandId.SERVER_STATUS:
        {
          const status = command as ServerCommandStatus;
          this.emit('status', status);
          if (isRecoverableFumbblLobbyStatus(status.serverStatus) && this.oneTimeFumbblToken) {
            this.setState('ready');
          } else {
            this.close();
          }
        }
        break;
      case NetCommandId.SERVER_MODEL_SYNC:
        this.emit('modelSync', command as ServerCommandModelSync);
        break;
      case NetCommandId.SERVER_TALK:
        this.emit('talk', command as ServerCommandTalk);
        break;
      default:
        break;
    }
    this.emit('command', command);
  }

  private startPing(intervalMs: number): void {
    this.stopPing();
    const ping = () => {
      if (this.connection.isOpen) {
        this.connection.send({ netCommandId: NetCommandId.CLIENT_PING, timestamp: Date.now() });
      }
    };
    ping(); // upstream pings immediately (Timer.schedule delay 0)
    this.pingTimer = setInterval(ping, intervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer != null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scrubCredentials(): void {
    this.oneTimeFumbblToken = null;
    this.params = null;
    this.autoJoinAfterVersion = false;
    this.versionReady = false;
  }

  private setState(state: SessionState): void {
    this.currentState = state;
    this.emit('state', state);
  }

  private emit<K extends keyof GameSessionEvents>(event: K, ...args: Parameters<GameSessionEvents[K]>): void {
    for (const listener of this.listeners[event]) {
      (listener as (...a: unknown[]) => void)(...args);
    }
  }
}
