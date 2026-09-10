import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { botConfigBaseUrl } from './settings';
import { claimDesktopDiscordSession } from './desktopAuth';
import {
  clearAccountSession as clearSecureAccountSession,
  loadAccountSession as loadSecureAccountSession,
  saveAccountSession as saveSecureAccountSession,
} from './accountSession';
import {
  adoptConfigWebSession,
  challengeForkCredentials,
  clearConfigWebToken,
  configWebBearerHeaders,
  configWebCoordinationIdentity,
} from './configWebAuth';

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

async function jsonRequest<T>(path: string, init: RequestInit = {}, fetchFn: FetchLike = desktopFetch()): Promise<T> {
  const response = await fetchFn(`${botConfigBaseUrl()}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...configWebBearerHeaders(),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Config-Web returned HTTP ${response.status}.`);
  return body;
}

async function desktopAuthRequest(path: string, init: RequestInit, fetchFn: FetchLike = desktopFetch()) {
  const response = await fetchFn(`${botConfigBaseUrl()}${path}`, { credentials: 'include', ...init });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  return {
    status: response.status,
    ok: response.ok,
    data,
    errorText: typeof data.error === 'string' ? data.error : `Config-Web returned HTTP ${response.status}.`,
  };
}

export async function authenticateAccount(coach: string, password: string, fetchFn?: FetchLike): Promise<AccountIdentity> {
  const login = await challengeForkCredentials(
    { coach, password }, fetchFn ?? desktopFetch(), botConfigBaseUrl(),
  );
  if (login.kind !== 'ok') throw new Error('Config-Web did not issue an account session.');
  await saveSecureAccountSession(login.token);
  return getAccount(fetchFn);
}

export async function clearAccountSession(): Promise<void> {
  clearConfigWebToken();
  await clearSecureAccountSession();
}

export function hasAccountSession(): boolean {
  return configWebCoordinationIdentity() !== null;
}

export function getAccount(fetchFn?: FetchLike): Promise<AccountIdentity> {
  return jsonRequest<AccountIdentity>('/api/account', {}, fetchFn ?? desktopFetch());
}

export async function rehydrateAccountSession(fetchFn?: FetchLike): Promise<AccountIdentity | null> {
  if (!hasAccountSession()) {
    const token = await loadSecureAccountSession();
    if (token) adoptConfigWebSession({ token, coach: 'restored-session', source: 'discord' });
  }
  const session = await jsonRequest<{ authenticated: boolean }>('/api/auth/session', {}, fetchFn ?? desktopFetch());
  if (!session.authenticated) {
    await clearAccountSession();
    return null;
  }
  const identity = await getAccount(fetchFn);
  const token = await loadSecureAccountSession();
  if (token) adoptConfigWebSession({ token, coach: identity.ffbCoachId, displayName: identity.profile.displayName, source: 'discord' });
  return identity;
}

export async function signInWithDiscordAccount(options: {
  coach: string;
  openAuthorization: (url: string) => Promise<void>;
  signal: AbortSignal;
  fetchFn?: FetchLike;
}): Promise<AccountIdentity> {
  const result = await claimDesktopDiscordSession({
    coach: options.coach,
    baseUrl: botConfigBaseUrl(),
    request: (path, init) => desktopAuthRequest(path, init, options.fetchFn ?? desktopFetch()),
    openAuthorization: options.openAuthorization,
    saveSession: saveSecureAccountSession,
    signal: options.signal,
  });
  adoptConfigWebSession({
    token: result.token,
    coach: result.coach,
    source: 'discord',
    expiresAt: Date.parse(result.expiresAt),
  });
  return getAccount(options.fetchFn);
}

export async function signOutAccount(fetchFn?: FetchLike): Promise<void> {
  try {
    await jsonRequest('/api/auth/logout', { method: 'POST', headers: { 'X-CW-Auth': '1' } }, fetchFn ?? desktopFetch());
  } finally {
    await clearAccountSession();
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
  if (!hasAccountSession()) return [];
  const result = await jsonRequest<{ notifications: TournamentClientNotification[] }>('/api/tournament/notifications', {}, fetchFn ?? desktopFetch());
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
    else adoptConfigWebSession({ token, coach, source: 'userid-password' });
  },
};
