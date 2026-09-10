import {
  FfbConnection,
  NetCommandId,
  type FfbConnectionOptions,
  type GameJson,
  type NetCommand,
} from '@fumbbl40k/ffb-protocol';
import {
  ReplayChunkAssembler,
  ReplayFailure,
  MAX_REPLAY_COMMANDS,
  type ReplayChunk,
  type ReplayCommand,
} from './replayController';

export interface ReplayBundle {
  finalState: GameJson;
  commands: readonly ReplayCommand[];
  source: 'server' | 'file';
}

export interface ReplayDownloadRequest {
  url: string;
  compression?: boolean;
  gameId: number;
  coach: string;
  /** Optional upstream one-time replay token. It is spent once in the replay-mode join handshake. */
  auth?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface ReplayConnection {
  readonly isOpen: boolean;
  on(event: 'command', listener: (command: NetCommand) => void): () => void;
  on(event: 'error', listener: (error: unknown) => void): () => void;
  on(event: 'close', listener: (code: number, reason: string) => void): () => void;
  connect(): Promise<void>;
  send(command: NetCommand): void;
  close(): void;
}

export type ReplayConnectionFactory = (options: FfbConnectionOptions) => ReplayConnection;

const MAX_REPLAY_VALUE_DEPTH = 128;
const MAX_REPLAY_VALUE_NODES = 1_000_000;

function assertReplayStructure(value: unknown, label: string): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (!entry.value || typeof entry.value !== 'object') continue;
    if (entry.depth > MAX_REPLAY_VALUE_DEPTH) throw new Error(`${label} exceeds the maximum nesting depth.`);
    if (seen.has(entry.value)) throw new Error(`${label} contains a cyclic object graph.`);
    seen.add(entry.value);
    nodes += 1;
    if (nodes > MAX_REPLAY_VALUE_NODES) throw new Error(`${label} exceeds the structural node limit.`);
    for (const child of Object.values(entry.value as Record<string, unknown>)) {
      if (child && typeof child === 'object') pending.push({ value: child, depth: entry.depth + 1 });
    }
  }
}

function positiveGameId(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error('Replay gameId must be a positive integer.');
  return Number(value);
}

function replayCommand(value: unknown): ReplayCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Replay command must be an object.');
  assertReplayStructure(value, 'Replay command');
  const command = value as Record<string, unknown>;
  if (!Number.isInteger(command.commandNr) || typeof command.netCommandId !== 'string') {
    throw new Error('Replay command requires integer commandNr and string netCommandId.');
  }
  return structuredClone(command) as ReplayCommand;
}

function replayChunk(value: Record<string, unknown>): ReplayChunk {
  if (!Array.isArray(value.commandArray)) throw new Error('SERVER_REPLAY is missing commandArray.');
  return {
    commands: value.commandArray.map(replayCommand),
    totalNrOfCommands: Number(value.totalNrOfCommands),
    lastCommand: value.lastCommand === true,
  };
}

function gameState(value: unknown): GameJson {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Replay is missing its final game state.');
  assertReplayStructure(value, 'Replay final game state');
  if (JSON.stringify(value).length * 2 > MAX_REPLAY_FILE_BYTES) {
    throw new Error('Replay final game state exceeds the 64 MB retained-data limit.');
  }
  const game = value as Partial<GameJson>;
  if (!Number.isInteger(game.gameId) || !game.teamHome || !game.teamAway || !game.fieldModel) {
    throw new Error('Replay final game state is malformed.');
  }
  return structuredClone(game) as GameJson;
}

/**
 * Dedicated replay acquisition. Anonymous loads send only REQUEST_VERSION and
 * CLIENT_REPLAY; authenticated JNLP loads additionally spend one replay-mode JOIN.
 */
export async function downloadReplay(
  request: ReplayDownloadRequest,
  createConnection: ReplayConnectionFactory = (options) => new FfbConnection(options),
): Promise<ReplayBundle> {
  const gameId = positiveGameId(request.gameId);
  const connection = createConnection({ url: request.url, compression: request.compression ?? true });
  const assembler = new ReplayChunkAssembler();
  let finalState: GameJson | null = null;
  let requested = false;
  let versionSeen = false;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  return new Promise<ReplayBundle>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const armTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(
        () => finish(new Error('Replay download timed out.')),
        request.timeoutMs ?? 30_000,
      );
    };
    const finish = (error?: unknown, commands?: readonly ReplayCommand[]) => {
      if (settled) return;
      settled = true;
      if (pingTimer !== null) clearInterval(pingTimer);
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', abort);
      connection.close();
      if (error) reject(error);
      else if (!finalState || !commands) reject(new Error('Replay download ended without a complete stream.'));
      else resolve({ finalState, commands, source: 'server' });
    };
    const requestReplay = () => {
      if (settled || requested) return;
      requested = true;
      connection.send({
        netCommandId: NetCommandId.CLIENT_REPLAY,
        gameId,
        replayToCommandNr: 0,
        coach: request.coach,
      });
      armTimeout();
    };
    const abort = () => finish(new DOMException('Replay download cancelled.', 'AbortError'));
    armTimeout();
    request.signal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted) {
      abort();
      return;
    }

    connection.on('error', (error) => finish(error));
    connection.on('close', (code, reason) => {
      if (!settled) finish(new Error(`Replay connection closed (${code}${reason ? `: ${reason}` : ''}).`));
    });
    connection.on('command', (wire) => {
      if (settled) return;
      const command = wire as Record<string, unknown>;
      try {
        armTimeout();
        if (command.netCommandId === NetCommandId.SERVER_VERSION && !versionSeen) {
          versionSeen = true;
          const properties = Array.isArray(command.clientProperties) ? command.clientProperties : [];
          const values = Array.isArray(command.clientPropertyValues) ? command.clientPropertyValues : [];
          const pingIndex = properties.indexOf('client.ping.interval');
          const configured = pingIndex >= 0 ? Number(values[pingIndex]) : NaN;
          const interval = Number.isFinite(configured) && configured > 0 ? configured : 8_000;
          const ping = () => {
            if (connection.isOpen) connection.send({ netCommandId: NetCommandId.CLIENT_PING, timestamp: Date.now() });
          };
          ping();
          pingTimer = setInterval(ping, interval);
          if (request.auth) {
            connection.send({
              netCommandId: NetCommandId.CLIENT_JOIN,
              clientMode: 'replay',
              coach: request.coach,
              password: request.auth,
              gameId: 0,
              gameName: null,
              teamId: null,
              teamName: null,
            });
          } else requestReplay();
          return;
        }
        if (command.netCommandId === NetCommandId.SERVER_USER_SETTINGS && request.auth) {
          requestReplay();
          return;
        }
        if (command.netCommandId === NetCommandId.SERVER_STATUS) {
          const status = String(command.serverStatus ?? command.status ?? '');
          if (/replay\s*unavailable/i.test(status)) throw new Error('Replay is unavailable.');
          if (request.auth) requestReplay();
          return;
        }
        if (command.netCommandId === NetCommandId.SERVER_GAME_STATE) {
          finalState = gameState(command.game);
          if (finalState.gameId !== gameId) throw new Error('Replay server returned a different game.');
          return;
        }
        if (command.netCommandId === NetCommandId.SERVER_REPLAY) {
          const commands = assembler.add(replayChunk(command));
          if (commands) finish(undefined, commands);
        }
      } catch (error) {
        finish(error);
      }
    });

    void connection.connect()
      .then(() => {
        if (!settled && !request.signal?.aborted && connection.isOpen) {
          connection.send({ netCommandId: NetCommandId.CLIENT_REQUEST_VERSION });
        }
      })
      .catch((error) => finish(error));
  });
}

export const MAX_REPLAY_FILE_BYTES = 64 * 1024 * 1024;

export interface ReplayFileLike {
  readonly size: number;
  text(): Promise<string>;
}

/** Reads a local replay only after enforcing the pre-decode file bound. */
export async function readReplayFile(file: ReplayFileLike): Promise<{ text: string; byteLength: number }> {
  if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error('Replay file size is invalid.');
  if (file.size > MAX_REPLAY_FILE_BYTES) throw new Error('Replay file exceeds the 64 MB limit.');
  return { text: await file.text(), byteLength: file.size };
}

/** Accepts the exported envelope or a raw capture containing GAME_STATE/REPLAY frames. */
export function parseReplayFile(text: string, byteLength = new TextEncoder().encode(text).byteLength): ReplayBundle {
  if (byteLength > MAX_REPLAY_FILE_BYTES) throw new Error('Replay file exceeds the 64 MB limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('Replay file is not valid JSON.'); }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const envelope = parsed as Record<string, unknown>;
    if (envelope.finalState && Array.isArray(envelope.commands)) {
      if (envelope.commands.length > MAX_REPLAY_COMMANDS) {
        throw new ReplayFailure('memory-budget', `Replay exceeds the ${MAX_REPLAY_COMMANDS}-command limit.`);
      }
      return {
        finalState: gameState(envelope.finalState),
        commands: envelope.commands.map(replayCommand),
        source: 'file',
      };
    }
  }

  if (!Array.isArray(parsed)) throw new Error('Replay file must contain an envelope or a command capture array.');
  let finalState: GameJson | null = null;
  const assembler = new ReplayChunkAssembler();
  let commands: readonly ReplayCommand[] | null = null;
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Replay capture contains a malformed frame.');
    const frame = raw as Record<string, unknown>;
    if (frame.netCommandId === NetCommandId.SERVER_GAME_STATE) finalState = gameState(frame.game);
    if (frame.netCommandId === NetCommandId.SERVER_REPLAY) commands = assembler.add(replayChunk(frame));
  }
  if (!finalState || !commands) throw new Error('Replay capture is incomplete.');
  return { finalState, commands, source: 'file' };
}

export function serializeReplay(bundle: ReplayBundle): string {
  return JSON.stringify({ version: 1, finalState: bundle.finalState, commands: bundle.commands });
}
