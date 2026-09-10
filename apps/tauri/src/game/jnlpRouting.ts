import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  GameSession,
  isRecoverableFumbblLobbyStatus,
  type GameListEntry,
  type SessionState,
} from '@fumbbl40k/ffb-protocol';
import { gameStore, playerJoinSupported } from './store';
import { ui } from './ui';
import {
  activeServerTarget,
  applyServerTarget,
  forkServerUrl,
  FUMBBL_SITE,
  resolveJoinCreds,
} from './settings';
import {
  parseClassifiedJnlp,
  resolveClassifiedJnlpChoice,
  type ClassifiedJnlpJoinRequest,
  type JnlpJoinRequest,
} from './jnlpCompat';
import { selectedLocalFumbblAssetUrl } from './fumbblAssetCache';

export interface BrowserTeam {
  side: string;
  name: string;
  coach: string;
  race: string;
  score: number;
  teamId?: string | number;
  teamValue?: number;
  tv?: number;
  logoUrl?: string;
  baseIconPath?: string;
}

export interface BrowserMatch {
  id: number;
  half: number;
  turn: number;
  teams: BrowserTeam[];
}

export interface FumbblLobby {
  coach: string;
  teamId: string;
  teamName: string;
  gameId?: number;
  sourceName?: string;
}

export const fumbblLobby = ref<FumbblLobby | null>(null);
export const fumbblLobbyGameName = ref('');
export const fumbblLobbyGames = ref<GameListEntry[]>([]);
export const fumbblLobbyState = ref<SessionState>('idle');
export const fumbblLobbyError = ref('');
export const fumbblLobbyListRequested = ref(false);
/** Human-readable target retained only for the Play blade while the prepared socket waits.
 *  It contains no credential and is cleared with the lobby. */
export const fumbblLobbyWaitTarget = ref('');

/** Covers only opening/version negotiation. Matchmaking may legitimately wait much longer and
 *  is deliberately excluded once the session leaves `connecting`/`versioning`. */
export const FUMBBL_LOBBY_CONNECT_TIMEOUT_MS = 15_000;

let preparedFumbblSession: GameSession | null = null;
let preparedFumbblGeneration = 0;
let preparedFumbblHandedOff = false;
let preparedFumbblConnectTimer: ReturnType<typeof setTimeout> | null = null;
let preparedFumbblActiveParams: {
  url: string;
  compression: boolean;
  coach: string;
  teamId?: string;
  teamName?: string;
  gameId?: number;
  gameName?: string;
  opponentTeamId?: string;
  opponentCoach?: string;
  officialFumbbl: true;
} | null = null;

function clearPreparedFumbblConnectTimer(): void {
  if (preparedFumbblConnectTimer !== null) {
    clearTimeout(preparedFumbblConnectTimer);
    preparedFumbblConnectTimer = null;
  }
}

function closePreparedFumbblSession(): void {
  clearPreparedFumbblConnectTimer();
  preparedFumbblGeneration += 1;
  const prepared = preparedFumbblSession;
  preparedFumbblSession = null;
  preparedFumbblHandedOff = false;
  preparedFumbblActiveParams = null;
  if (prepared && prepared.state !== 'closed') prepared.close();
}

function releaseAcceptedFumbblLobby(prepared: GameSession, generation: number): void {
  if (prepared !== preparedFumbblSession || generation !== preparedFumbblGeneration) return;
  preparedFumbblSession = null;
  preparedFumbblHandedOff = false;
  preparedFumbblActiveParams = null;
  preparedFumbblGeneration += 1;
  fumbblLobby.value = null;
  fumbblLobbyGameName.value = '';
  fumbblLobbyGames.value = [];
  fumbblLobbyListRequested.value = false;
  fumbblLobbyWaitTarget.value = '';
  fumbblLobbyState.value = 'idle';
  fumbblLobbyError.value = '';
}

export function stageFumbblPlayerLobby(lobby: FumbblLobby, auth: string): void {
  closePreparedFumbblSession();
  const generation = preparedFumbblGeneration;
  const target = activeServerTarget();
  const prepared = new GameSession({ url: target.url, compression: target.compression });
  preparedFumbblSession = prepared;
  preparedFumbblHandedOff = false;
  preparedFumbblActiveParams = null;
  fumbblLobby.value = lobby;
  fumbblLobbyGameName.value = '';
  fumbblLobbyGames.value = [];
  fumbblLobbyError.value = '';
  fumbblLobbyListRequested.value = false;
  fumbblLobbyWaitTarget.value = '';
  fumbblLobbyState.value = 'connecting';

  preparedFumbblConnectTimer = setTimeout(() => {
    if (generation !== preparedFumbblGeneration || prepared !== preparedFumbblSession) return;
    if (prepared.state !== 'connecting' && prepared.state !== 'versioning') return;
    fumbblLobbyError.value = 'FUMBBL did not finish connecting. Cancel and load a fresh JNLP to try again.';
    fumbblLobbyState.value = 'closed';
    closePreparedFumbblSession();
  }, FUMBBL_LOBBY_CONNECT_TIMEOUT_MS);

  prepared.on('state', (state) => {
    if (generation === preparedFumbblGeneration && prepared === preparedFumbblSession) {
      fumbblLobbyState.value = state;
      if (state !== 'connecting' && state !== 'versioning') clearPreparedFumbblConnectTimer();
    }
  });
  prepared.on('gameList', (command) => {
    if (generation !== preparedFumbblGeneration || prepared !== preparedFumbblSession) return;
    fumbblLobbyGames.value = [...(command.gameList?.gameListEntries ?? [])]
      .filter((entry) => Number.isInteger(Number(entry.gameId)) && Number(entry.gameId) > 0)
      .sort((left, right) => Number(right.gameId) - Number(left.gameId));
    fumbblLobbyListRequested.value = true;
    fumbblLobbyError.value = '';
  });
  prepared.on('status', (command) => {
    if (generation !== preparedFumbblGeneration || prepared !== preparedFumbblSession) return;
    const message = command.message?.trim()
      || command.serverStatus?.trim()
      || 'FUMBBL rejected the lobby request.';
    fumbblLobbyError.value = message;
    if (isRecoverableFumbblLobbyStatus(command.serverStatus)) return;
    fumbblLobbyState.value = 'closed';
    closePreparedFumbblSession();
  });
  prepared.on('error', (error) => {
    if (generation !== preparedFumbblGeneration || prepared !== preparedFumbblSession) return;
    fumbblLobbyError.value = error instanceof Error ? error.message : String(error);
  });
  prepared.on('close', (code, reason) => {
    if (generation !== preparedFumbblGeneration || prepared !== preparedFumbblSession) return;
    preparedFumbblSession = null;
    if (!fumbblLobbyError.value) {
      fumbblLobbyError.value = `FUMBBL lobby connection closed (${code}${reason ? `: ${reason}` : ''}). Reload the JNLP to try again.`;
    }
  });

  void prepared.prepareFumbblLobby({
    coach: lobby.coach,
    password: '',
    gameId: 0,
    mode: 'player',
    teamId: lobby.teamId || undefined,
    teamName: lobby.teamName || undefined,
    fumbblAuthToken: auth,
  }).catch((error) => {
    if (generation !== preparedFumbblGeneration || prepared !== preparedFumbblSession) return;
    fumbblLobbyError.value = error instanceof Error ? error.message : String(error);
  });
}

function logJnlp(text: string): void {
  gameStore.state.log.push({ time: new Date().toLocaleTimeString(), kind: 'system', text });
}

type FumbblJoinTarget = {
  gameId?: number;
  gameName?: string;
  opponentTeamId?: string;
  opponentCoach?: string;
  opponentLabel?: string;
};

function connectFumbblPlayer(
  lobby: FumbblLobby,
  target: FumbblJoinTarget,
): void {
  const prepared = preparedFumbblSession;
  if (!prepared || prepared.state !== 'ready') {
    if (!fumbblLobbyError.value) fumbblLobbyError.value = 'The FUMBBL lobby is not ready yet.';
    return;
  }
  const fumbbl = activeServerTarget();
  ui.browserOpen = false;
  const activeParams = preparedFumbblActiveParams ?? {
    url: fumbbl.url,
    compression: fumbbl.compression,
    coach: lobby.coach,
    teamId: lobby.teamId || undefined,
    teamName: lobby.teamName || undefined,
    officialFumbbl: true as const,
  };
  activeParams.gameId = target.gameId;
  activeParams.gameName = target.gameName;
  activeParams.opponentTeamId = target.opponentTeamId;
  activeParams.opponentCoach = target.opponentCoach;
  preparedFumbblActiveParams = activeParams;
  fumbblLobbyWaitTarget.value = target.gameName
    ? `opponent in ${target.gameName}`
    : target.opponentLabel || target.opponentCoach || 'scheduled opponent';
  fumbblLobbyError.value = '';
  gameStore.state.joinError = null;
  gameStore.state.waitingForMatch = {
    gameName: target.gameName,
    teamName: lobby.teamName || undefined,
    coach: lobby.coach,
    opponentCoach: target.opponentCoach,
  };

  if (preparedFumbblHandedOff) {
    try {
      prepared.joinPreparedFumbblGame({
        gameId: target.gameId,
        gameName: target.gameName,
        teamId: lobby.teamId || undefined,
        teamName: lobby.teamName || undefined,
      });
    } catch (error) {
      fumbblLobbyError.value = error instanceof Error ? error.message : String(error);
    }
    return;
  }

  preparedFumbblHandedOff = true;
  const generation = preparedFumbblGeneration;
  void gameStore.connectAsPlayer(activeParams, {
    session: prepared,
    launch: () => prepared.joinPreparedFumbblGame({
      gameId: target.gameId,
      gameName: target.gameName,
      teamId: lobby.teamId || undefined,
      teamName: lobby.teamName || undefined,
    }),
    onAccepted: () => releaseAcceptedFumbblLobby(prepared, generation),
  });
}

function connectFumbblPlayerWhenReady(
  lobby: FumbblLobby,
  target: FumbblJoinTarget,
): void {
  const prepared = preparedFumbblSession;
  const generation = preparedFumbblGeneration;
  if (!prepared) return;
  if (prepared.state === 'ready') {
    connectFumbblPlayer(lobby, target);
    return;
  }
  const off = prepared.on('state', (state) => {
    if (state !== 'ready') return;
    off();
    if (prepared === preparedFumbblSession && generation === preparedFumbblGeneration) {
      connectFumbblPlayer(lobby, target);
    }
  });
}

export function fumbblListGames(): void {
  try {
    if (!preparedFumbblSession) {
      if (!fumbblLobbyError.value) fumbblLobbyError.value = 'Load the JNLP again to reconnect to FUMBBL.';
      return;
    }
    fumbblLobbyError.value = '';
    preparedFumbblSession.requestPreparedGameList();
  } catch (error) {
    fumbblLobbyError.value = error instanceof Error ? error.message : String(error);
  }
}

/** Existing FUMBBL lobby path: both coaches submit the same game name. */
export function fumbblJoinByName(): void {
  const lobby = fumbblLobby.value;
  const gameName = fumbblLobbyGameName.value;
  if (!lobby || !gameName.trim()) return;
  connectFumbblPlayer(lobby, { gameName });
}

/** The Play blade spends the loaded token through the same implementation as both lobby paths. */
export function fumbblJoinLoaded(gameId?: number, match?: BrowserMatch): void {
  const lobby = fumbblLobby.value;
  if (!lobby || (gameId !== undefined && (!Number.isInteger(gameId) || gameId <= 0))) return;
  const ownTeam = match?.teams.find((team) => lobby.teamId && String(team.teamId ?? '') === lobby.teamId)
    ?? match?.teams.find((team) => team.coach?.toLowerCase() === lobby.coach.toLowerCase());
  const opponent = match?.teams.find((team) => team !== ownTeam);
  connectFumbblPlayer(lobby, {
    gameId,
    opponentTeamId: opponent?.teamId == null ? undefined : String(opponent.teamId),
    opponentCoach: opponent?.coach || undefined,
    opponentLabel: opponent?.name || opponent?.coach || undefined,
  });
}

export function clearFumbblLobby(): void {
  closePreparedFumbblSession();
  fumbblLobby.value = null;
  fumbblLobbyGameName.value = '';
  fumbblLobbyGames.value = [];
  fumbblLobbyError.value = '';
  fumbblLobbyListRequested.value = false;
  fumbblLobbyWaitTarget.value = '';
  fumbblLobbyState.value = 'idle';
}

export type JnlpRouteResult =
  | 'fork-player'
  | 'fumbbl-player'
  | 'fumbbl-staged'
  | 'spectate'
  | 'replay'
  | 'ambiguous'
  | 'host-rejected'
  | 'invalid';

export interface JnlpRouteOptions {
  /** The official-server Play blade previews a valid player request before spending its token. */
  deferFumbblPlayer?: boolean;
  sourceName?: string;
}

export const ambiguousJnlpEntry = ref<{
  request: ClassifiedJnlpJoinRequest;
  options: JnlpRouteOptions;
} | null>(null);
export const jnlpEntryError = ref('');

function classifiedRequest(request: JnlpJoinRequest): ClassifiedJnlpJoinRequest | null {
  return 'entryClassification' in request ? request as ClassifiedJnlpJoinRequest : null;
}

/**
 * The one JNLP decision tree used by native intake, manual file intake, and SpectateView.
 * Official player requests always stage on the Play blade. The public REST match feed is
 * spectator presentation only; FUMBBL's socket-side game list is the player authority.
 */
export function routeJnlpRequest(
  request: JnlpJoinRequest,
  options: JnlpRouteOptions = {},
): JnlpRouteResult {
  const classified = classifiedRequest(request);
  if (classified?.validation === 'host-policy') {
    jnlpEntryError.value = 'JNLP rejected by host policy: only app-owned server targets may be used.';
    logJnlp(jnlpEntryError.value);
    return 'host-rejected';
  }
  if (classified?.entryClassification.kind === 'ambiguous') {
    ambiguousJnlpEntry.value = { request: classified, options };
    jnlpEntryError.value = '';
    return 'ambiguous';
  }
  if (classified?.validation === 'invalid') {
    jnlpEntryError.value = 'JNLP could not be used because its arguments are invalid.';
    logJnlp(jnlpEntryError.value);
    return 'invalid';
  }
  if (classified && (
    (classified.entryClassification.kind === 'replay') !== (request.mode === 'replay')
  )) {
    jnlpEntryError.value = 'JNLP entry classification did not match its validated client mode.';
    logJnlp(jnlpEntryError.value);
    return 'invalid';
  }
  jnlpEntryError.value = '';

  if (request.mode === 'replay' && request.gameId) {
    ui.settingsOpen = false;
    ui.browserOpen = false;
    // owner ruling 2026-08-17: official fumbbl.com replay+live permitted.
    applyServerTarget(request.fork ? 'fork' : 'fumbbl');
    const target = activeServerTarget();
    const credentials = resolveJoinCreds();
    void gameStore.connectReplay({
      // The XML-declared host/port are intentionally ignored. Only an app-owned target may be dialled.
      url: target.url,
      compression: target.compression,
      coach: request.coach ?? credentials.coach,
      auth: request.auth ?? undefined,
      gameId: request.gameId,
    });
    return 'replay';
  }

  if (request.fork && request.mode === 'player' && request.teamId && (request.gameName || request.gameId)) {
    ui.settingsOpen = false;
    ui.browserOpen = false;
    applyServerTarget('fork');
    void gameStore.connectAsPlayer({
      url: forkServerUrl(),
      compression: activeServerTarget().compression,
      coach: request.coach ?? '',
      // Prefer the pre-hashed credential (owner ruling 08-17): a `-passwordMd5` JNLP means the
      // coach's clear-text password was never written to the downloaded file. Both feed the same
      // upstream challenge computation, which is keyed on md5(pw) either way.
      password: request.password ?? '',
      passwordMd5: request.passwordMd5 ?? undefined,
      gameName: request.gameName ?? undefined,
      teamId: request.teamId,
      gameId: request.gameId ?? undefined,
    });
    return 'fork-player';
  }

  if (!request.fork && request.mode === 'player' && request.auth && (request.teamId || request.gameId)) {
    ui.settingsOpen = false;
    ui.browserOpen = false;
    if (!playerJoinSupported()) {
      jnlpEntryError.value = 'This build is spectator-only; FUMBBL player JNLPs cannot be opened.';
      logJnlp(jnlpEntryError.value);
      return 'invalid';
    }
    // owner ruling 2026-08-17: official fumbbl.com replay+live permitted.
    applyServerTarget('fumbbl');
    const lobby: FumbblLobby = {
      coach: request.coach ?? '',
      teamId: request.teamId ?? '',
      teamName: request.teamName ?? '',
      gameId: request.gameId ?? undefined,
      sourceName: options.sourceName,
    };

    stageFumbblPlayerLobby(lobby, request.auth);

    if (request.gameId) {
      connectFumbblPlayerWhenReady(lobby, { gameId: request.gameId });
      return 'fumbbl-player';
    }

    ui.browserOpen = false;
    logJnlp(`FUMBBL player request loaded for ${lobby.coach || lobby.teamName || lobby.teamId}.`);
    return 'fumbbl-staged';
  }

  if (!request.gameId) {
    ui.settingsOpen = false;
    logJnlp('jnlp: no gameId / fork join found in file');
    return 'invalid';
  }

  if (request.mode === 'player') {
    logJnlp(
      `jnlp: PLAYER join for game ${request.gameId} (coach ${request.coach}) \u2014 no -auth token in file; spectating instead`,
    );
  }
  ui.browserOpen = false;
  // owner ruling 2026-08-17: official fumbbl.com replay+live permitted.
  applyServerTarget(request.fork ? 'fork' : 'fumbbl');
  const target = activeServerTarget();
  void gameStore.connect({
    url: target.url,
    compression: target.compression,
    ...resolveJoinCreds(),
    gameId: request.gameId,
  });
  return 'spectate';
}

export function resolveAmbiguousJnlpEntry(choice: 'replay' | 'live'): JnlpRouteResult {
  const pending = ambiguousJnlpEntry.value;
  if (!pending) return 'invalid';
  ambiguousJnlpEntry.value = null;
  try {
    return routeJnlpRequest(resolveClassifiedJnlpChoice(pending.request, choice), pending.options);
  } catch {
    jnlpEntryError.value = `The JNLP cannot be used as ${choice}; its arguments do not match that upstream mode.`;
    logJnlp(jnlpEntryError.value);
    return 'invalid';
  }
}

export function cancelAmbiguousJnlpEntry(): void {
  ambiguousJnlpEntry.value = null;
}

export async function readJnlpFile(file: Pick<File, 'text'>): Promise<ClassifiedJnlpJoinRequest> {
  return parseClassifiedJnlp(await file.text());
}

type NativeJnlpDrainItem = { Ok: string } | { Err: string };
type NativeJnlpHandler = (request: JnlpJoinRequest) => void;

const nativeHandlers: Array<{ token: symbol; handler: NativeJnlpHandler }> = [];
let nativeSetupPromise: Promise<void> | null = null;
let nativeDrainRunning = false;
let nativeDrainRequested = false;

function currentNativeHandler(): NativeJnlpHandler | undefined {
  return nativeHandlers[nativeHandlers.length - 1]?.handler;
}

async function drainNativeJnlps(): Promise<void> {
  nativeDrainRequested = true;
  if (nativeDrainRunning || !currentNativeHandler()) return;
  nativeDrainRunning = true;
  try {
    while (nativeDrainRequested && currentNativeHandler()) {
      nativeDrainRequested = false;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const items = await invoke<NativeJnlpDrainItem[]>('drain_launch_jnlps');
        for (const item of items) {
          if ('Ok' in item) currentNativeHandler()?.(parseClassifiedJnlp(item.Ok));
          else logJnlp(`jnlp: ${item.Err}`);
        }
      } catch {
        logJnlp('jnlp: native launch intake could not be drained');
      }
    }
  } finally {
    nativeDrainRunning = false;
  }
}

async function setupNativeJnlpIntake(): Promise<void> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    await listen('jnlp-launch-available', () => {
      if (currentNativeHandler()) void drainNativeJnlps();
    });
    await listen('jnlp-launch-failed', () => {
      logJnlp('a second launch could not be read');
    });
    await drainNativeJnlps();
  } catch {
    logJnlp('jnlp: native launch intake is unavailable');
  }
}

/**
 * App.vue owns this composable once for its entire lifetime. Keeping the Tauri listeners
 * module-global makes drain_launch_jnlps a single queue consumer even as shell views swap.
 */
export function useNativeJnlpIntake(handler: NativeJnlpHandler): void {
  const token = Symbol('native-jnlp-handler');
  onMounted(() => {
    nativeHandlers.push({ token, handler });
    const inTauri = typeof window !== 'undefined'
      && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (!inTauri) return;
    nativeSetupPromise ??= setupNativeJnlpIntake();
    void nativeSetupPromise.then(() => drainNativeJnlps());
  });
  onBeforeUnmount(() => {
    const index = nativeHandlers.findIndex((entry) => entry.token === token);
    if (index >= 0) nativeHandlers.splice(index, 1);
  });
}

/** Upstream asset URLs are intentionally disabled. An explicitly selected
 * local pack may satisfy the same immutable wire reference without networking. */
export function fumbblAsset(rel?: string, base?: string): string | null {
  return selectedLocalFumbblAssetUrl(rel, base);
}
