import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { botConfigBaseUrl } from './settings';
import { requireForkBaseUrl } from './forkBase';
import { claimDesktopDiscordSession, DesktopSignInCancelled } from './desktopAuth';
import {
  clearAccountSession as clearSecureAccountSession,
  loadAccountSession as loadSecureAccountSession,
  saveAccountSession as saveSecureAccountSession,
} from './accountSession';
import {
  adoptConfigWebSession,
  challengeForkCredentials,
  clearConfigWebToken,
  clearConfigWebTokenFor,
  configWebBearerHeaders,
  configWebCoordinationIdentity,
  configWebSessionOrigin,
} from './configWebAuth';
import { configWebOrigin, isDefaultConfigWebOrigin } from './forkAccess';

/** Sol r9/r11: the config-web this run talks to (absolute; throws when there is none). Account sessions are scoped to
 *  its ORIGIN: the in-memory token is only ever sent back to the origin that issued it. ONLY the default origin
 *  (forkAccess DEFAULT_CONFIG_WEB_ORIGIN) reads, writes or deletes the stored session (the existing, legacy keychain
 *  slot - so a legacy unscoped token restores for the default origin only); any other origin (a FORK-edition override
 *  or flag host) keeps its session in memory for the run. */
function accountBase(): string {
  return requireForkBaseUrl(botConfigBaseUrl());
}
function persistsSessions(base: string): boolean {
  return isDefaultConfigWebOrigin(base);
}
/** Sol r12: has the current destination moved away from the base an operation captured? */
function destinationChanged(base: string): boolean {
  try { return configWebOrigin(accountBase()) !== configWebOrigin(base); } catch { return true; }
}
import { t } from '../i18n';

export interface AccountIdentity {
  ffbCoachId: string;
  level: 'player' | 'organizer' | 'admin';
  banned: boolean;
  silenced: boolean;
  identities: {
    discordUserId?: string;
    discordUsername?: string;
    email?: string;
    nafName?: string;
    nafId?: string;
  };
  profile: { displayName?: string; avatar?: string; [key: string]: string | undefined };
  scheduling?: { timezone?: string; availability?: Array<{ day: string; start: string; end: string }> };
  updatedAt: string;
}

export interface TournamentClientNotification {
  id: string;
  kind: 'match-waiting' | 'test';
  scheduledMatchId: string;
  statusRevision: number;
  message: string;
  opponent?: string;
  gameId?: string;
  createdAt: string;
}

type FetchLike = typeof fetch;

function desktopFetch(): FetchLike {
  return (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window))
    ? tauriFetch as FetchLike
    : fetch;
}

/** Sol r12: every account request runs against ONE base captured by its operation (default: read once, here). */
async function jsonRequest<T>(path: string, init: RequestInit = {}, fetchFn: FetchLike = desktopFetch(), base: string = accountBase()): Promise<T> {
  const response = await fetchFn(`${base}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...configWebBearerHeaders(base),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Config-Web returned HTTP ${response.status}.`);
  return body;
}

async function desktopAuthRequest(path: string, init: RequestInit, fetchFn: FetchLike, base: string) {
  const response = await fetchFn(`${base}${path}`, { credentials: 'include', ...init });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  return {
    status: response.status,
    ok: response.ok,
    data,
    errorText: typeof data.error === 'string' ? data.error : t('login.text.configWebReturnedHttp', { status: response.status }),
  };
}

export async function authenticateAccount(coach: string, password: string, fetchFn?: FetchLike): Promise<AccountIdentity> {
  const base = accountBase(); // Sol r12: login, persistence and the account read all use this one base
  const login = await challengeForkCredentials({ coach, password }, fetchFn ?? desktopFetch(), base);
  if (login.kind !== 'ok') throw new Error('Config-Web did not issue an account session.');
  if (persistsSessions(base)) await saveSecureAccountSession(login.token);
  return getAccountAt(base, fetchFn);
}

/** Drop the session `base` issued: the in-memory one only when that origin issued it, the stored one only when that
 *  origin is the default one. Another origin's session is never deleted. */
async function clearSessionFor(base: string): Promise<void> {
  clearConfigWebTokenFor(base);
  if (persistsSessions(base)) await clearSecureAccountSession();
}

/** Sign-out / refusal for the CURRENT config-web (see clearSessionFor). */
export async function clearAccountSession(): Promise<void> {
  let base = '';
  try { base = accountBase(); } catch { /* no config-web: nothing of ours to clear */ }
  if (base) await clearSessionFor(base);
}

function hasSessionFor(base: string): boolean {
  return configWebCoordinationIdentity() !== null && configWebSessionOrigin() === configWebOrigin(base);
}

/** A held session issued by the current config-web. */
export function hasAccountSession(): boolean {
  try { return hasSessionFor(accountBase()); } catch { return false; }
}

function getAccountAt(base: string, fetchFn?: FetchLike): Promise<AccountIdentity> {
  return jsonRequest<AccountIdentity>('/api/account', {}, fetchFn ?? desktopFetch(), base);
}

export function getAccount(fetchFn?: FetchLike): Promise<AccountIdentity> {
  return getAccountAt(accountBase(), fetchFn);
}

export async function rehydrateAccountSession(fetchFn?: FetchLike): Promise<AccountIdentity | null> {
  const base = accountBase();
  // Sol r9: the stored (legacy, unscoped) session belongs to the default origin - never restored for another one.
  const persists = persistsSessions(base);
  if (!hasSessionFor(base) && persists) {
    const token = await loadSecureAccountSession();
    if (token) adoptConfigWebSession({ token, coach: 'restored-session', source: 'discord', origin: base });
  }
  const session = await jsonRequest<{ authenticated: boolean }>('/api/auth/session', {}, fetchFn ?? desktopFetch(), base);
  if (!session.authenticated) {
    await clearSessionFor(base); // the refusal came from `base`: only its session is dropped
    return null;
  }
  const identity = await getAccountAt(base, fetchFn);
  const token = persists ? await loadSecureAccountSession() : '';
  if (token) adoptConfigWebSession({ token, coach: identity.ffbCoachId, displayName: identity.profile.displayName, source: 'discord', origin: base });
  return identity;
}

export async function signInWithDiscordAccount(options: {
  coach: string;
  openAuthorization: (url: string) => Promise<void>;
  signal: AbortSignal;
  fetchFn?: FetchLike;
}): Promise<AccountIdentity> {
  const base = accountBase();
  // Sol r12: the whole flow (start, claim, cancel, the account read) is bound to the base captured here. If the
  // destination moves while authorisation is open, the flow is aborted - its cancel still goes to `base` - so the flow
  // id, state and PKCE verifier never reach another origin.
  const flow = new AbortController();
  if (options.signal.aborted) flow.abort();
  else options.signal.addEventListener('abort', () => flow.abort(), { once: true });
  const fetchFn = options.fetchFn ?? desktopFetch();
  const result = await claimDesktopDiscordSession({
    coach: options.coach,
    baseUrl: base,
    request: (path, init) => {
      if (path !== '/api/auth/desktop/cancel' && destinationChanged(base)) {
        flow.abort();
        return Promise.reject(new DesktopSignInCancelled());
      }
      return desktopAuthRequest(path, init, fetchFn, base);
    },
    openAuthorization: options.openAuthorization,
    // Sol r9: only the default origin's session is stored (a custom origin's stays in memory for the run).
    saveSession: (token: string) => (persistsSessions(base) ? saveSecureAccountSession(token) : Promise.resolve()),
    signal: flow.signal,
  });
  adoptConfigWebSession({
    token: result.token,
    coach: result.coach,
    source: 'discord',
    expiresAt: Date.parse(result.expiresAt),
    origin: base,
  });
  return getAccountAt(base, options.fetchFn);
}

export async function signOutAccount(fetchFn?: FetchLike): Promise<void> {
  const base = accountBase(); // Sol r12: the logout and its cleanup target the same config-web
  try {
    await jsonRequest('/api/auth/logout', { method: 'POST', headers: { 'X-CW-Auth': '1' } }, fetchFn ?? desktopFetch(), base);
  } finally {
    await clearSessionFor(base);
  }
}

export function updateAccount(
  patch: { profile?: Record<string, string>; scheduling?: { timezone?: string; availability?: Array<{ day: string; start: string; end: string }> } },
  fetchFn?: FetchLike,
): Promise<AccountIdentity> {
  return jsonRequest('/api/account', {
    method: 'PATCH',
    headers: { 'X-CW-Auth': '1' },
    body: JSON.stringify(patch),
  }, fetchFn ?? desktopFetch());
}

/** Browser-only SSO entry retained for config-web pages and compatibility tests. */
export function discordSsoStartUrl(): string {
  return `${botConfigBaseUrl()}/api/auth/discord/start`;
}

export async function fetchTournamentNotifications(fetchFn?: FetchLike): Promise<TournamentClientNotification[]> {
  const base = accountBase();
  if (!hasSessionFor(base)) return [];
  const result = await jsonRequest<{ notifications: TournamentClientNotification[] }>('/api/tournament/notifications', {}, fetchFn ?? desktopFetch(), base);
  return Array.isArray(result.notifications) ? result.notifications : [];
}

export function renewWaitingPresence(scheduledMatchId: string, fetchFn?: FetchLike): Promise<{ leaseSeconds: number; notifications: TournamentClientNotification[] }> {
  return jsonRequest(`/api/scheduled-matches/${encodeURIComponent(scheduledMatchId)}/presence`, {
    method: 'POST',
    body: '{}',
  }, fetchFn ?? desktopFetch());
}

export function clearWaitingPresence(scheduledMatchId: string, fetchFn?: FetchLike): Promise<{ cleared: boolean }> {
  return jsonRequest(`/api/scheduled-matches/${encodeURIComponent(scheduledMatchId)}/presence`, {
    method: 'DELETE',
    body: '{}',
  }, fetchFn ?? desktopFetch());
}

export const accountApiTest = {
  setToken(token: string, coach = 'Tarkin') {
    if (!token) clearConfigWebToken();
    else adoptConfigWebSession({ token, coach, source: 'userid-password', origin: botConfigBaseUrl() });
  },
};
