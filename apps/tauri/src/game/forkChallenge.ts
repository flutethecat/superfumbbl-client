import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { md5Hex } from '@fumbbl40k/ffb-protocol';
import { parseJnlp } from './jnlpCompat';
import { gameStore } from './store';
import {
  activeServerTarget,
  applyServerTarget,
  botConfigBaseUrl,
  configWebUnreachableMessage,
  forkServerUrl,
  resolveJoinCreds,
  settings,
} from './settings';
import { coachPassword } from './credentials';
import { authorizeForkRequest, shouldRetryAfterUnauthorized } from './configWebAuth';

export type ForkPayload = Record<string, unknown>;
export type ForkTransport = (input: string, init?: RequestInit) => Promise<Response>;

export interface ForkApi {
  get(path: string, params: Record<string, string>): Promise<ForkPayload>;
  post(path: string, body: Record<string, unknown>): Promise<ForkPayload>;
  /** Authenticated config-web mutation. Optional so older test doubles remain source-compatible. */
  request?(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: Record<string, unknown>): Promise<ForkPayload>;
}

export interface LibraryTeam {
  teamId: string;
  teamName: string;
  race: string;
  coach?: string;
  teamValue?: number;
  gold?: number;
  rerolls?: number;
  fanFactor?: number;
  apothecary?: boolean;
  forkLoadable?: boolean;
  ingestedAt?: string;
}

// Ported from SpectateView.vue:6310-6368. The row remains server-derived.
export interface CoachGameRow {
  gameId: number;
  status: 'scheduled' | 'starting' | 'active' | 'paused';
  inProgress: boolean;
  started: string | null;
  scheduled: string | null;
  half: number;
  turn: number;
  seat: 'home' | 'away';
  myTeamId: string;
  myTeamName: string;
  opponentCoach: string;
  opponentTeamName: string;
  // scope: 'finished' contract (config-web deploy pending) — present only once the server has
  // been upgraded; its absence is how callers detect an old server still returning the active set.
  finished?: string | null;
}

const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
const defaultTransport: ForkTransport = (input, init) => inTauri ? tauriFetch(input, init) : fetch(input, init);

export function errText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  try {
    const text = JSON.stringify(error);
    if (text && text !== '{}' && text !== 'null') return text;
  } catch { /* noop */ }
  return String(error);
}

async function readPayload(response: Response): Promise<ForkPayload> {
  const data = (await response.json().catch(() => ({}))) as ForkPayload;
  if (!response.ok || data.error) throw new Error(String(data.error ?? `HTTP ${response.status}`));
  return data;
}

/** The creds the token exchange is made with — the fork account, same pair the settings panel holds. */
function forkCreds(): { coach: string; password: string } {
  return { coach: settings.coach40k ?? '', password: coachPassword() };
}

// Existing config-web routes only; ported from SpectateView.vue:6475-6488.
// Owner ruling 08-17: carries `Authorization: Bearer <token>` when one can be obtained, and the
// token then REPLACES the password parameter on guarded routes (see configWebAuth.ts). A 401 on an
// authorized call means the token died server-side — re-exchange and retry exactly once.
export async function botGet(
  path: string,
  params: Record<string, string>,
  transport: ForkTransport = defaultTransport,
  baseUrl = botConfigBaseUrl(),
): Promise<ForkPayload> {
  let retried = false;
  for (;;) {
    const auth = await authorizeForkRequest(path, params, forkCreds(), transport, baseUrl);
    const query = new URLSearchParams(auth.payload as Record<string, string>).toString();
    const url = `${baseUrl}/api/fork/${path}?${query}`;
    let response: Response;
    try {
      response = await transport(url, Object.keys(auth.headers).length ? { headers: auth.headers } : undefined);
    } catch (error) {
      throw new Error(configWebUnreachableMessage(baseUrl, errText(error)));
    }
    if (shouldRetryAfterUnauthorized(response.status, auth.authorized, retried)) {
      retried = true;
      continue;
    }
    return readPayload(response);
  }
}

// Existing config-web routes only; ported from SpectateView.vue:6333-6347.
export async function botPost(
  path: string,
  body: Record<string, unknown>,
  transport: ForkTransport = defaultTransport,
  baseUrl = botConfigBaseUrl(),
): Promise<ForkPayload> {
  const url = `${baseUrl}/api/fork/${path}`;
  let retried = false;
  for (;;) {
    const auth = await authorizeForkRequest(path, body, forkCreds(), transport, baseUrl);
    let response: Response;
    try {
      response = await transport(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth.headers },
        body: JSON.stringify(auth.payload),
      });
    } catch (error) {
      throw new Error(configWebUnreachableMessage(baseUrl, errText(error)));
    }
    if (shouldRetryAfterUnauthorized(response.status, auth.authorized, retried)) {
      retried = true;
      continue;
    }
    return readPayload(response);
  }
}

/** Authenticated JSON mutation used by revisioned tournament administration routes. */
export async function botRequest(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body: Record<string, unknown> = {},
  transport: ForkTransport = defaultTransport,
  baseUrl = botConfigBaseUrl(),
): Promise<ForkPayload> {
  const url = `${baseUrl}/api/fork/${path}`;
  let retried = false;
  for (;;) {
    const auth = await authorizeForkRequest(path, body, forkCreds(), transport, baseUrl);
    let response: Response;
    try {
      response = await transport(url, {
        method,
        headers: { 'content-type': 'application/json', ...auth.headers },
        body: JSON.stringify(auth.payload),
      });
    } catch (error) {
      throw new Error(configWebUnreachableMessage(baseUrl, errText(error)));
    }
    if (shouldRetryAfterUnauthorized(response.status, auth.authorized, retried)) {
      retried = true;
      continue;
    }
    return readPayload(response);
  }
}

export interface ForkTextDownload { text: string; filename?: string; contentType?: string }

/** Authenticated text download, currently used by the owner-only NAF XML export. */
export async function botDownloadText(
  path: string,
  transport: ForkTransport = defaultTransport,
  baseUrl = botConfigBaseUrl(),
): Promise<ForkTextDownload> {
  let retried = false;
  for (;;) {
    const auth = await authorizeForkRequest(path, {}, forkCreds(), transport, baseUrl);
    let response: Response;
    try {
      response = await transport(`${baseUrl}/api/fork/${path}`, Object.keys(auth.headers).length ? { headers: auth.headers } : undefined);
    } catch (error) {
      throw new Error(configWebUnreachableMessage(baseUrl, errText(error)));
    }
    if (shouldRetryAfterUnauthorized(response.status, auth.authorized, retried)) {
      retried = true;
      continue;
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as ForkPayload;
      throw new Error(String(data.error ?? `HTTP ${response.status}`));
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
    return { text: await response.text(), ...(filename ? { filename } : {}), contentType: response.headers.get('content-type') ?? undefined };
  }
}

export function createForkApi(
  transport: ForkTransport = defaultTransport,
  baseUrl: () => string = botConfigBaseUrl,
): ForkApi {
  return {
    get: (path, params) => botGet(path, params, transport, baseUrl()),
    post: (path, body) => botPost(path, body, transport, baseUrl()),
    request: (method, path, body) => botRequest(method, path, body, transport, baseUrl()),
  };
}

export const forkApi = createForkApi();

export interface MyGamesState {
  games: CoachGameRow[];
  loading: boolean;
  error: string | null;
  loadedFor: string;
}

export function createMyGamesState(): MyGamesState {
  return { games: [], loading: false, error: null, loadedFor: '' };
}

// Empty coach is an empty result; failures deliberately remain uncached.
// `scope` is additive per the server contract (config-web deploy pending): omitted keeps the
// current "active" behavior (CreateGameModal's rejoin list), 'finished' asks for finished-game
// history and is ignored harmlessly by a not-yet-upgraded server (which returns the active set).
export async function loadMyGames(
  state: MyGamesState,
  creds: { coach: string; password: string },
  force = false,
  api: ForkApi = forkApi,
  scope?: 'active' | 'finished',
): Promise<void> {
  const coach = creds.coach.trim();
  if (!coach) {
    state.games = [];
    state.error = null;
    state.loadedFor = '';
    return;
  }
  if (!force && state.loadedFor === coach && state.games.length) return;
  state.loading = true;
  state.error = null;
  try {
    const body: Record<string, unknown> = { coach, password: creds.password };
    if (scope) body.scope = scope;
    const data = await api.post('my-games', body);
    state.games = Array.isArray(data.games) ? data.games as CoachGameRow[] : [];
    state.loadedFor = coach;
  } catch (error) {
    state.games = [];
    state.error = errText(error);
    state.loadedFor = '';
  } finally {
    state.loading = false;
  }
}

// Same payload shape as TeamBuilderView.vue:40-52,262-274.
export function deriveLibraryTeams(payload: ForkPayload): LibraryTeam[] {
  return Array.isArray(payload.teams) ? payload.teams as LibraryTeam[] : [];
}

/** Free-entry library filter used by the challenge team picker. Match only the two visible identity fields the
 * coach asked to search, preserve server order, and treat surrounding whitespace/case as presentation details. */
export function filterLibraryTeams(teams: readonly LibraryTeam[], query: string): LibraryTeam[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...teams];
  return teams.filter((team) => (team.teamName ?? '').toLocaleLowerCase().includes(needle)
    || (team.race ?? '').toLocaleLowerCase().includes(needle));
}

export async function loadTeamLibrary(coach: string, api: ForkApi = forkApi): Promise<LibraryTeam[]> {
  const name = coach.trim();
  if (!name) return [];
  return deriveLibraryTeams(await api.get('library', { coach: name }));
}

export type ChallengePhase = 'idle' | 'submitting' | 'waiting' | 'matched' | 'error' | 'cancelled';

export interface ChallengeState {
  phase: ChallengePhase;
  message: string;
  error: string | null;
  match: ForkPayload | null;
}

export interface ChallengeRequest {
  coach: string;
  password: string;
  teamId: string;
  opponent: string;
}

export function createChallengeState(): ChallengeState {
  return { phase: 'idle', message: '', error: null, match: null };
}

interface ChallengeControllerOptions {
  api?: ForkApi;
  onMatched?: (payload: ForkPayload) => void | Promise<void>;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export interface ChallengeController {
  submit(request: ChallengeRequest): Promise<void>;
  pollOnce(): Promise<void>;
  cancel(): Promise<void>;
  dispose(): void;
}

// Ported from SpectateView.vue:6541-6596; polling remains the existing 2s matchstatus route.
export function createChallengeController(
  state: ChallengeState,
  options: ChallengeControllerOptions = {},
): ChallengeController {
  const api = options.api ?? forkApi;
  const onMatched = options.onMatched ?? (() => undefined);
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  let request: ChallengeRequest | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let generation = 0;

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearIntervalFn(pollTimer);
      pollTimer = null;
    }
  }

  async function landMatch(payload: ForkPayload, ticket: number): Promise<void> {
    if (ticket !== generation) return;
    stopPolling();
    state.match = payload;
    state.phase = 'matched';
    state.message = `Matched with ${String(payload.opponent ?? request?.opponent ?? '')}.`;
    state.error = null;
    try {
      await onMatched(payload);
    } catch (error) {
      if (ticket !== generation) return;
      state.phase = 'error';
      state.error = errText(error);
      state.message = state.error;
    }
  }

  async function pollOnce(): Promise<void> {
    if (state.phase !== 'waiting' || !request) return;
    const ticket = generation;
    try {
      const payload = await api.get('matchstatus', { coach: request.coach });
      if (payload.status === 'matched') await landMatch(payload, ticket);
    } catch { /* transient: keep polling */ }
  }

  function startPolling(): void {
    stopPolling();
    pollTimer = setIntervalFn(() => { void pollOnce(); }, 2000);
  }

  async function submit(next: ChallengeRequest): Promise<void> {
    const ticket = ++generation;
    stopPolling();
    request = { ...next, coach: next.coach.trim(), opponent: next.opponent.trim() };
    state.phase = 'submitting';
    state.message = '';
    state.error = null;
    state.match = null;
    try {
      const payload = await api.get('challenge', {
        coach: request.coach,
        teamId: request.teamId,
        opponent: request.opponent,
        // Pre-hashed (owner ruling 08-17): config-web verifies against ffb_coaches, which stores
        // md5(pw), and carries the same digest into the matched side's JNLP. No clear text in the
        // query string. A token can't replace it — it IS the game-server join credential.
        passwordMd5: md5Hex(request.password),
      });
      if (ticket !== generation) return;
      if (payload.status === 'matched') {
        await landMatch(payload, ticket);
        return;
      }
      state.phase = 'waiting';
      state.message = `Waiting for ${request.opponent} to accept the challenge…`;
      startPolling();
    } catch (error) {
      if (ticket !== generation) return;
      state.phase = 'error';
      state.error = errText(error);
      state.message = `Couldn't start the challenge (${state.error}).`;
    }
  }

  async function cancel(): Promise<void> {
    const coach = request?.coach ?? '';
    ++generation;
    stopPolling();
    state.phase = 'cancelled';
    state.message = 'Challenge cancelled.';
    state.error = null;
    if (!coach) return;
    try {
      await api.get('cancel', { coach });
    } catch { /* best effort */ }
  }

  function dispose(): void {
    ++generation;
    stopPolling();
  }

  return { submit, pollOnce, cancel, dispose };
}

// Existing matched-JNLP player join; argument shape mirrors SpectateView.vue:6569-6588.
export function connectMatchedChallenge(payload: ForkPayload): void {
  const jnlp = typeof payload.jnlp === 'string' ? payload.jnlp : '';
  const request = parseJnlp(jnlp);
  if (!request.fork || request.mode !== 'player' || !request.teamId || (!request.gameName && !request.gameId)) {
    throw new Error(`Matched with ${String(payload.opponent ?? '')}, but the server returned no valid JNLP.`);
  }
  applyServerTarget('fork');
  const target = activeServerTarget();
  const creds = resolveJoinCreds();
  void gameStore.connectAsPlayer({
    url: forkServerUrl(),
    compression: target.compression,
    coach: request.coach ?? creds.coach,
    password: request.password ?? creds.password,
    gameName: request.gameName ?? undefined,
    teamId: request.teamId,
    gameId: request.gameId ?? undefined,
  });
}
