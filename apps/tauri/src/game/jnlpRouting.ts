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
import {
  correctStoredCoachName,
  correctStoredCoachNameWithNotice,
  coachCorrectedNotice,
  differsOnlyInCase,
  equalsIgnoringAsciiCase,
  listEntryCoaches,
  resolveExactCoachName,
  storedFumbblCoach,
  storedFumbblPassword,
  type CoachLookup,
} from './officialCoachName';
import {
  clearOfficialRejoinTarget,
  officialRejoinProblem,
  peekOfficialRejoinTarget,
  setOfficialRejoinTarget,
  usableOfficialRejoinTarget,
  type OfficialJoinTarget,
} from './officialRejoinTarget';
import { isNotYourTeamStatus, rejoinFlow, trackOfficialJoin, type RejoinLaunch } from './rejoinFlow';
import { pickTeam, type TeamChoiceEntry } from './teamChoice';

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
  /** Owner 09-24: opened with the stored coach + password (no JNLP) — the list needs no credential, the join
   *  runs the normal password challenge; the coach picks the game AND its own team from the server's list. */
  password?: boolean;
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

/** S44 round 2: the one kept rejoin target lives in officialRejoinTarget.ts (account-bound, cleared on the events listed there). */
export type { OfficialJoinTarget };
let preparedFumbblServer: { url: string; compression: boolean } | null = null;
/** the tracked attempt (rejoinFlow window) the lobby handlers report into; valid only while it is still the live window */
let activeOfficialLaunch: RejoinLaunch | null = null;
let officialStatusOff: (() => void) | null = null;
let officialTeamListOff: (() => void) | null = null;
/** test seam: the public coach lookup used as the second source of the exact spelling */
let coachLookupOverride: CoachLookup | undefined;
export function setOfficialCoachLookup(lookup: CoachLookup | undefined): void { coachLookupOverride = lookup; }

function currentOfficialLaunch(): RejoinLaunch | null {
  return activeOfficialLaunch && rejoinFlow.launch === activeOfficialLaunch ? activeOfficialLaunch : null;
}

/** A failure before the game arrived that the server did not announce as a refusal: show it in the window too. */
function surfaceOfficialFailure(message: string): void {
  const launch = currentOfficialLaunch();
  if (launch && !launch.launchError && !launch.refusal) launch.launchError = message;
}

/** The rejoin target for the "Connection closed" prompt: only with a stored password and the account it was made for. */
export function officialRejoinTarget(): OfficialJoinTarget | null {
  return usableOfficialRejoinTarget();
}

/** Plain words for why a kept target cannot be used now (null when it can, or when none is kept). */
export function officialRejoinBlocker(): string | null {
  return officialRejoinProblem();
}

export function forgetOfficialRejoinTarget(): void {
  clearOfficialRejoinTarget();
}

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
  stageFumbblLobby(lobby, (prepared) => prepared.prepareFumbblLobby({
    coach: lobby.coach,
    password: '',
    gameId: 0,
    mode: 'player',
    teamId: lobby.teamId || undefined,
    teamName: lobby.teamName || undefined,
    fumbblAuthToken: auth,
  }));
}

/** Owner 09-24: "My FUMBBL games" — open the lobby with the saved coach + password and list the coach's open
 *  games straight away. No JNLP, no website round-trip; the join authenticates with the password challenge. */
export function stageFumbblPasswordLobby(
  coach: string,
  password: string,
  /** S44: a rejoin names its own server and skips the list request (the game id is already known) */
  options: { server?: { url: string; compression: boolean }; list?: boolean } = {},
): void {
  const lobby: FumbblLobby = { coach, teamId: '', teamName: '', sourceName: 'My FUMBBL games', password: true };
  stageFumbblLobby(lobby, (prepared) => prepared.prepareFumbblLobbyWithPassword({ coach, password, gameId: 0, mode: 'player' }), options.server);
  const prepared = preparedFumbblSession;
  const generation = preparedFumbblGeneration;
  if (!prepared || options.list === false) return;
  const off = prepared.on('state', (state) => {
    if (state !== 'ready') return;
    off();
    if (prepared === preparedFumbblSession && generation === preparedFumbblGeneration) fumbblListGames();
  });
}

function stageFumbblLobby(
  lobby: FumbblLobby,
  prepareLobby: (prepared: GameSession) => Promise<void>,
  server?: { url: string; compression: boolean },
): void {
  closePreparedFumbblSession();
  activeOfficialLaunch = null;
  const generation = preparedFumbblGeneration;
  const target = server ?? activeServerTarget();
  preparedFumbblServer = { url: target.url, compression: target.compression };
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
    fumbblLobbyError.value = lobby.password ? 'FUMBBL did not finish connecting. Try again in a moment.' : 'FUMBBL did not finish connecting. Cancel and load a fresh JNLP to try again.';
    surfaceOfficialFailure(fumbblLobbyError.value);
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
    if (!preparedFumbblHandedOff) surfaceOfficialFailure(fumbblLobbyError.value);
  });
  prepared.on('close', (code, reason) => {
    if (generation !== preparedFumbblGeneration || prepared !== preparedFumbblSession) return;
    preparedFumbblSession = null;
    if (!fumbblLobbyError.value) {
      fumbblLobbyError.value = `FUMBBL lobby connection closed (${code}${reason ? `: ${reason}` : ''}). ${lobby.password ? 'Open My FUMBBL games again to retry.' : 'Reload the JNLP to try again.'}`;
      if (!preparedFumbblHandedOff) surfaceOfficialFailure(fumbblLobbyError.value);
    }
  });

  void prepareLobby(prepared).catch((error) => {
    if (generation !== preparedFumbblGeneration || prepared !== preparedFumbblSession) return;
    fumbblLobbyError.value = error instanceof Error ? error.message : String(error);
    surfaceOfficialFailure(fumbblLobbyError.value);
  });
}

function logJnlp(text: string): void {
  gameStore.appendSystemNotice(text);
}

type FumbblJoinTarget = {
  gameId?: number;
  gameName?: string;
  opponentTeamId?: string;
  opponentCoach?: string;
  opponentLabel?: string;
  /** S44: the lobby's coach name is already the account's exact spelling (a rejoin or a corrected retry): no lookup */
  coachIsExact?: boolean;
};

function isForkHost(url: string): boolean {
  try { return new URL(url).host === new URL(forkServerUrl()).host; } catch { return false; }
}

function officialGameLabel(target: FumbblJoinTarget): string | undefined {
  return target.gameId ? undefined : target.gameName ? `“${target.gameName}”` : 'the game';
}

/** The tracked attempt for one official join: reuse the one a rejoin/retry already opened, else open it now. */
function beginOfficialLaunch(lobby: FumbblLobby, target: FumbblJoinTarget, url: string): RejoinLaunch {
  const opponent = target.opponentLabel || target.opponentCoach;
  const existing = currentOfficialLaunch();
  if (existing) {
    existing.gameId = target.gameId ?? 0;
    existing.gameLabel = officialGameLabel(target);
    existing.coach = lobby.coach;
    existing.opponent = opponent;
    return existing;
  }
  // a new official join from the Play page: no earlier game's target may survive into it
  clearOfficialRejoinTarget();
  const launch = trackOfficialJoin({
    action: 'join', gameId: target.gameId ?? 0, gameLabel: officialGameLabel(target),
    coach: lobby.coach, url, opponent, launchError: null, tryAgain: officialTryAgain,
  });
  activeOfficialLaunch = launch;
  return launch;
}

/** "Try again" of a failed official window: one click, a password join by id of the kept target. */
function officialTryAgain(): (() => void) | null {
  const kept = usableOfficialRejoinTarget();
  if (!kept) return null;
  return () => { const now = usableOfficialRejoinTarget(); if (now) startOfficialPasswordJoin(now, { action: 'rejoin' }); };
}

/** Keep THE rejoin target once the server accepted the join (and again with the served game id). Only for the stored
 *  account, and only while a password is stored: no other login could rejoin it. Holds no token and no password. */
function recordOfficialJoin(params: NonNullable<typeof preparedFumbblActiveParams>, viaJnlp: boolean, servedGameId?: number): void {
  if (!storedFumbblPassword() || !equalsIgnoringAsciiCase(storedFumbblCoach(), params.coach)) {
    clearOfficialRejoinTarget();
    return;
  }
  const gameId = servedGameId && servedGameId > 0 ? servedGameId : params.gameId;
  if (!(gameId && gameId > 0) && !params.gameName) { clearOfficialRejoinTarget(); return; }
  setOfficialRejoinTarget({
    url: params.url, compression: params.compression, coach: params.coach,
    gameId: gameId && gameId > 0 ? gameId : undefined, gameName: params.gameName,
    teamId: params.teamId, teamName: params.teamName,
    opponentTeamId: params.opponentTeamId, opponentCoach: params.opponentCoach,
    viaJnlp,
  });
}

/**
 * S44 point 8 (owner 09-29): a `Not Your Team` refusal means the server's letter-for-letter ownership check failed
 * although the name was admitted ignoring case. Look for the account's exact spelling among what the server itself
 * sent for THIS game (its list entry, any game state already received), else the public coach lookup. Only a
 * case-only difference corrects anything: the stored name is updated, the window says so, and ONE "Try again"
 * click repeats the join. Never retries by itself.
 */
async function correctNotYourTeam(launch: RejoinLaunch, sent: string, serverNames: () => string[], target: OfficialJoinTarget): Promise<void> {
  // The handler works on the STORED name only. A refusal of some other name (a JNLP of another account) changes nothing.
  const stored = storedFumbblCoach();
  if (!equalsIgnoringAsciiCase(stored, sent)) return;
  const exact = await resolveExactCoachName(stored, serverNames(), coachLookupOverride, 'server-game');
  if (currentOfficialLaunch() !== launch || !differsOnlyInCase(stored, exact.name)) return;
  if (!correctStoredCoachName(exact.name)) return; // the text below appears only when the stored name really changed
  const retryable = !!storedFumbblPassword();
  launch.correction = {
    text: coachCorrectedNotice(stored, exact.name),
    retry: retryable ? () => { startOfficialPasswordJoin({ ...target, coach: exact.name }, { action: 'join' }); } : null,
  };
  if (!retryable) launch.jnlpNeeded = true;
}

/** Report every server refusal of this attempt into its window (recoverable ones too), and run point 8 on Not Your Team. */
function watchOfficialRefusal(
  prepared: GameSession,
  launch: RejoinLaunch,
  target: OfficialJoinTarget,
  entryNames: string[],
): void {
  officialStatusOff?.();
  const gameNames: string[] = [];
  // the furthest step the socket demonstrably reached (a close leaves no evidence of its own)
  launch.reachedStep = Math.max(launch.reachedStep ?? 0, 1);
  const offState = prepared.on('state', (state) => {
    const step = state === 'joined' ? 2 : state === 'versioning' || state === 'ready' || state === 'authenticating' || state === 'joining' ? 1 : 0;
    if (step > (launch.reachedStep ?? 0)) launch.reachedStep = step;
  });
  const offGame = prepared.on('gameState', (command) => {
    const game = command.game as { teamHome?: { coach?: string }; teamAway?: { coach?: string } } | undefined;
    for (const name of [game?.teamHome?.coach, game?.teamAway?.coach]) if (name) gameNames.push(name);
  });
  const offStatus = prepared.on('status', (command) => {
    if (currentOfficialLaunch() !== launch) return;
    const status = String(command.serverStatus ?? '');
    launch.refusal = { status, message: command.message?.trim() || status.trim() || 'FUMBBL rejected the join.' };
    if (isNotYourTeamStatus(status) && !isForkHost(target.url)) {
      void correctNotYourTeam(launch, target.coach, () => [...entryNames, ...gameNames], target);
    }
  });
  officialStatusOff = () => { offGame(); offStatus(); offState(); };
}

/**
 * P1 10-06: upstream answers a PLAYER join without a teamId into an unscheduled, unstarted game with `serverTeamList`
 * and waits for the same join again WITH a teamId (ServerCommandHandlerJoinApproved.sendTeamList; the official client
 * asks in DialogTeamChoice). Pick only when it is unambiguous (the lobby's teamId, else its team name, else the only
 * team); otherwise the join window shows the list and the coach chooses. Never a guess.
 */
function watchOfficialTeamList(prepared: GameSession, launch: RejoinLaunch, lobby: FumbblLobby, retryTarget: OfficialJoinTarget): void {
  officialTeamListOff?.();
  const joinWith = (entry: TeamChoiceEntry): void => {
    // only the server's own name goes anywhere a name is compared or sent; the "Team <id>" label is display-only
    const teamName = entry.teamName.trim() ? entry.teamName : undefined;
    lobby.teamId = entry.teamId;
    lobby.teamName = teamName ?? '';
    if (preparedFumbblActiveParams) {
      preparedFumbblActiveParams.teamId = entry.teamId;
      preparedFumbblActiveParams.teamName = teamName;
    }
    // a later corrected-name "Try again" of this attempt keeps the chosen team
    retryTarget.teamId = entry.teamId;
    retryTarget.teamName = teamName;
    if (gameStore.state.waitingForMatch) gameStore.state.waitingForMatch.teamName = teamName;
    try {
      prepared.joinPreparedFumbblGameWithTeam({ teamId: entry.teamId, teamName });
    } catch (error) {
      fumbblLobbyError.value = error instanceof Error ? error.message : String(error);
      surfaceOfficialFailure(fumbblLobbyError.value);
    }
  };
  officialTeamListOff = prepared.on('teamList', (command) => {
    if (currentOfficialLaunch() !== launch || !prepared.awaitingTeamChoice) return;
    const pick = pickTeam(command.teamList?.teamListEntries, { teamId: lobby.teamId, teamName: lobby.teamName });
    if (pick.kind === 'empty') {
      logJnlp('FUMBBL asked for a team, but lists none for this coach.');
      launch.refusal = { status: 'teamList', message: 'FUMBBL asked which team to play with, but lists no team for this coach.' };
      prepared.close();
      return;
    }
    if (pick.kind === 'auto') {
      logJnlp(`FUMBBL asked for a team: joining with ${pick.entry.label} (${pick.reason === 'single' ? 'your only team' : `matched by ${pick.reason === 'teamId' ? 'team id' : 'team name'}`}).`);
      joinWith(pick.entry);
      return;
    }
    logJnlp(`FUMBBL asked for a team: ${pick.entries.length} teams listed, waiting for your choice.`);
    const entries = pick.entries;
    launch.teamChoice = {
      entries,
      choose: (teamId: string) => {
        const entry = entries.find((row) => row.teamId === teamId);
        if (!entry || currentOfficialLaunch() !== launch || !launch.teamChoice) return;
        launch.teamChoice = null;
        joinWith(entry);
      },
    };
  });
}

function connectFumbblPlayer(
  lobby: FumbblLobby,
  target: FumbblJoinTarget,
): void {
  const prepared = preparedFumbblSession;
  if (!prepared || prepared.state !== 'ready') {
    if (!fumbblLobbyError.value) fumbblLobbyError.value = 'The FUMBBL lobby is not ready yet.';
    return;
  }
  const fumbbl = preparedFumbblServer ?? activeServerTarget();
  ui.browserOpen = false;
  const generation = preparedFumbblGeneration;
  const launch = beginOfficialLaunch(lobby, target, fumbbl.url);
  // S44: a password join puts the account's exact spelling on the wire (source order: the server's own list entry
  // for this game, the public coach lookup, the name as typed). A JNLP join keeps the JNLP's own name and wire.
  const entry = target.gameId ? fumbblLobbyGames.value.find((e) => Number(e.gameId) === target.gameId) : undefined;
  if (!lobby.password || target.coachIsExact) {
    proceedFumbblPlayer(prepared, generation, lobby, target, fumbbl, launch, listEntryCoaches(entry));
    return;
  }
  void resolveExactCoachName(lobby.coach, listEntryCoaches(entry), coachLookupOverride).then((exact) => {
    if (prepared !== preparedFumbblSession || generation !== preparedFumbblGeneration) return;
    if (currentOfficialLaunch() !== launch) { closePreparedFumbblSession(); return; } // cancelled while looking up
    if (exact.source !== 'typed') {
      const notice = correctStoredCoachNameWithNotice(exact.name);
      if (notice) launch.notice = notice;
    }
    lobby.coach = exact.name;
    launch.coach = exact.name;
    proceedFumbblPlayer(prepared, generation, lobby, target, fumbbl, launch, listEntryCoaches(entry));
  });
}

function proceedFumbblPlayer(
  prepared: GameSession,
  generation: number,
  lobby: FumbblLobby,
  target: FumbblJoinTarget,
  fumbbl: { url: string; compression: boolean },
  launch: RejoinLaunch,
  entryNames: string[],
): void {
  const activeParams = preparedFumbblActiveParams ?? {
    url: fumbbl.url,
    compression: fumbbl.compression,
    coach: lobby.coach,
    teamId: lobby.teamId || undefined,
    teamName: lobby.teamName || undefined,
    officialFumbbl: true as const,
  };
  activeParams.coach = lobby.coach;
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
    // owner 10-06 VS banner: the ids this join knows (the store sets the same shape once connectAsPlayer runs)
    ...(target.gameId && target.gameId > 0 ? { gameId: target.gameId } : {}),
    ...(lobby.teamId ? { teamId: lobby.teamId } : {}),
    ...(target.opponentTeamId ? { opponentTeamId: target.opponentTeamId } : {}),
    official: true,
  };
  const retryTarget: OfficialJoinTarget = {
    url: activeParams.url, compression: activeParams.compression, coach: lobby.coach,
    gameId: target.gameId, gameName: target.gameName,
    teamId: lobby.teamId || undefined, teamName: lobby.teamName || undefined,
    opponentTeamId: target.opponentTeamId, opponentCoach: target.opponentCoach,
    viaJnlp: !lobby.password,
  };
  watchOfficialRefusal(prepared, launch, retryTarget, entryNames);
  watchOfficialTeamList(prepared, launch, lobby, retryTarget);

  const joinNow = () => prepared.joinPreparedFumbblGame({
    gameId: target.gameId,
    gameName: target.gameName,
    teamId: lobby.teamId || undefined,
    teamName: lobby.teamName || undefined,
    ...(lobby.password ? { coach: lobby.coach } : {}),
  });

  if (preparedFumbblHandedOff) {
    try {
      joinNow();
    } catch (error) {
      fumbblLobbyError.value = error instanceof Error ? error.message : String(error);
      surfaceOfficialFailure(fumbblLobbyError.value);
    }
    return;
  }

  // Owner 10-08: a JNLP join by game id (Gamefinder / a scheduled match) carries no team and never listed the
  // lobby, so the waiting board's VS banner had nothing but the coach name. The server's own open-games list is
  // the one source naming both teams of a game that has not started: ask for it once, on this socket, before the
  // join (the list branch spends no token - the same request "List Games" makes). Never blocks or fails the join.
  if (!lobby.password && target.gameId && !fumbblLobbyGames.value.some((e) => Number(e.gameId) === target.gameId)) {
    try { prepared.requestPreparedGameList(); } catch { /* the banner keeps what the join knew */ }
  }

  preparedFumbblHandedOff = true;
  void gameStore.connectAsPlayer(activeParams, {
    session: prepared,
    launch: joinNow,
    // the server accepted the join (before any game state): from here a drop can be rejoined
    onJoinAccepted: () => {
      if (preparedFumbblActiveParams) recordOfficialJoin(preparedFumbblActiveParams, !lobby.password);
    },
    onAccepted: (servedGameId) => {
      const params = preparedFumbblActiveParams;
      releaseAcceptedFumbblLobby(prepared, generation);
      officialStatusOff?.();
      officialStatusOff = null;
      officialTeamListOff?.();
      officialTeamListOff = null;
      if (params) recordOfficialJoin(params, !lobby.password, servedGameId);
      // the correction is told once, in the join window; nothing about it goes to the game log
    },
  });
}

/**
 * S44: join (or rejoin) an official game by id/name with the stored coach + password: password lobby, then the join.
 * The password is read from the credential holder here, at the moment of the attempt. Every call is one click;
 * nothing schedules it. Returns false (with the reason in the window) when it cannot start.
 */
export function startOfficialPasswordJoin(target: OfficialJoinTarget, options: { action?: 'join' | 'rejoin'; opponent?: string } = {}): boolean {
  const password = storedFumbblPassword();
  const opponent = options.opponent ?? target.opponentCoach;
  const sameAccount = equalsIgnoringAsciiCase(storedFumbblCoach(), target.coach);
  const launch = trackOfficialJoin({
    action: options.action ?? 'rejoin', gameId: target.gameId ?? 0, gameLabel: officialGameLabel(target),
    coach: target.coach, url: target.url, opponent, launchError: null, jnlpNeeded: !password || !sameAccount,
    tryAgain: officialTryAgain,
  });
  if (!password || !sameAccount) {
    // never make a password response for another account's game
    launch.launchError = !password
      ? 'No FUMBBL password is saved.'
      : 'The saved FUMBBL account is not the one this game was joined with.';
    clearOfficialRejoinTarget();
    return false;
  }
  if (!(target.gameId && target.gameId > 0) && !target.gameName) {
    launch.launchError = 'This game cannot be found again without its number.';
    return false;
  }
  setOfficialRejoinTarget(target); // the one target, held for this attempt so its failure window can offer Try again
  stageFumbblPasswordLobby(target.coach, password, { server: { url: target.url, compression: target.compression }, list: false });
  const lobby = fumbblLobby.value;
  if (!lobby) return false;
  activeOfficialLaunch = launch;
  lobby.teamId = target.teamId ?? '';
  lobby.teamName = target.teamName ?? '';
  connectFumbblPlayerWhenReady(lobby, {
    gameId: target.gameId, gameName: target.gameName,
    opponentTeamId: target.opponentTeamId, opponentCoach: target.opponentCoach, opponentLabel: opponent,
    coachIsExact: true,
  });
  return true;
}

/** The "Connection closed" prompt's Reconnect for an official game: one click, one attempt, for the account it was made for. */
export function rejoinOfficialGame(): boolean {
  const kept = peekOfficialRejoinTarget();
  if (!kept) return false;
  const problem = officialRejoinProblem();
  gameStore.disconnect(); // clears the drop prompt (and the kept target; the attempt below holds it again)
  gameStore.clearFrozenGame(); // and the frozen board, so the join window is what the coach sees
  if (problem) {
    const launch = trackOfficialJoin({
      action: 'rejoin', gameId: kept.gameId ?? 0, gameLabel: officialGameLabel(kept), coach: kept.coach, url: kept.url,
      launchError: problem, jnlpNeeded: true,
    });
    activeOfficialLaunch = launch;
    return false;
  }
  return startOfficialPasswordJoin(kept, { action: 'rejoin' });
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
  // Owner 09-24: a password lobby has no team until the coach picks a listed game — take it from the entry.
  if (lobby.password && !lobby.teamId && ownTeam?.teamId != null) {
    lobby.teamId = String(ownTeam.teamId);
    lobby.teamName = ownTeam.name || '';
  }
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
    // P1 10-06: say which join fields the file carried (values only for the non-secret ids; never the token)
    logJnlp(`jnlp: FUMBBL player request: gameId ${request.gameId ?? 'none'}, teamId ${request.teamId || 'none'}, teamName ${request.teamName ? 'present' : 'none'}, coach ${request.coach ? 'present' : 'none'}, auth token present`);
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
/** A native launch ended without ever reaching the handler: the shell could not read or queue the file, the text did
 *  not parse, or the queue could not be drained. Whoever is waiting on that launch must stop waiting. */
type NativeJnlpFailureHandler = () => void;

const nativeHandlers: Array<{ token: symbol; handler: NativeJnlpHandler; onFailure?: NativeJnlpFailureHandler }> = [];
let nativeSetupPromise: Promise<void> | null = null;
let nativeDrainRunning = false;
let nativeDrainRequested = false;

function currentNativeHandler(): NativeJnlpHandler | undefined {
  return nativeHandlers[nativeHandlers.length - 1]?.handler;
}

function reportNativeJnlpFailure(): void {
  try {
    nativeHandlers[nativeHandlers.length - 1]?.onFailure?.();
  } catch {
    /* a consumer's own bookkeeping never stops the intake */
  }
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
          if ('Err' in item) {
            logJnlp(`jnlp: ${item.Err}`);
            reportNativeJnlpFailure();
            continue;
          }
          let request: ClassifiedJnlpJoinRequest;
          try {
            request = parseClassifiedJnlp(item.Ok);
          } catch {
            // Astra 10-08 (P2): one unreadable file is that launch's end, not the batch's - the items behind it have
            // already left the shell's queue and would otherwise be lost with it.
            logJnlp('jnlp: the launch file could not be read');
            reportNativeJnlpFailure();
            continue;
          }
          currentNativeHandler()?.(request);
        }
      } catch {
        logJnlp('jnlp: native launch intake could not be drained');
        reportNativeJnlpFailure();
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
      reportNativeJnlpFailure();
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
export function useNativeJnlpIntake(handler: NativeJnlpHandler, onFailure?: NativeJnlpFailureHandler): void {
  const token = Symbol('native-jnlp-handler');
  onMounted(() => {
    nativeHandlers.push({ token, handler, onFailure });
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
