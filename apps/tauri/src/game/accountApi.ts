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
  ensureConfigWebToken,
  captureConfigWebSession,
  configWebSessionIs,
  configWebBearerHeadersFor,
  type ConfigWebSessionHandle,
} from './configWebAuth';
import { configWebOrigin, isDefaultConfigWebOrigin } from './forkAccess';
import { configWebHttpError } from './configWebErrors';

export { ConfigWebHttpError, isOnboardingRequired, ONBOARDING_REQUIRED_MESSAGE } from './configWebErrors';

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

/** Sol r12: every account request runs against ONE base captured by its operation (default: read once, here).
 *  Sol r2 P2 (onboarding): with an explicit `session` the request carries exactly that session's token (never whatever
 *  is held by the time it is sent); a session another origin issued is refused before anything goes out. */
async function jsonRequest<T>(
  path: string,
  init: RequestInit = {},
  fetchFn: FetchLike = desktopFetch(),
  base: string = accountBase(),
  session?: ConfigWebSessionHandle,
): Promise<T> {
  if (session && session.origin !== configWebOrigin(base)) throw new Error('Config-Web session belongs to another server.');
  const response = await fetchFn(`${base}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(session ? configWebBearerHeadersFor(session, base) : configWebBearerHeaders(base)),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  // Owner 11-06: the status rides along (ConfigWebHttpError), so the onboarding gate's 428 and a 429 are recognisable;
  // the message stays the server's `error` text verbatim.
  if (!response.ok) throw configWebHttpError(response, body, `Config-Web returned HTTP ${response.status}.`);
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

function getAccountAt(base: string, fetchFn?: FetchLike, session?: ConfigWebSessionHandle): Promise<AccountIdentity> {
  return jsonRequest<AccountIdentity>('/api/account', {}, fetchFn ?? desktopFetch(), base, session);
}

/** `session` (optional): read the account of exactly that captured session (see captureAccountSession). */
export function getAccount(fetchFn?: FetchLike, session?: ConfigWebSessionHandle): Promise<AccountIdentity> {
  return getAccountAt(accountBase(), fetchFn, session);
}

export type { ConfigWebSessionHandle };

/** Sol r2 P2: a handle on the session held now for the current config-web (null = none). Pass it to getAccount /
 *  getOnboarding / completeOnboarding to bind them to this one session. */
export function captureAccountSession(): ConfigWebSessionHandle | null {
  try { return captureConfigWebSession(accountBase()); } catch { return null; }
}

/** Is the captured session still the held one? False once a login, exchange or sign-out replaced it. */
export function accountSessionIs(session: ConfigWebSessionHandle | null): boolean {
  return configWebSessionIs(session);
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

/** Owner 11-06 (client onboarding): config-web's new-user view, GET/POST /api/me/onboarding (config-web
 *  src/auth/onboarding.ts OnboardingView). `reaccept` = an earlier privacy notice was accepted (only the privacy step). */
export interface OnboardingPhone { number: string; country?: string; label?: string }
export interface OnboardingView {
  needed: boolean;
  reaccept: boolean;
  prefill: {
    preferredName: string;
    email: string | null;
    emailSource: 'discord' | 'user';
    country: string | null;
    phones: OnboardingPhone[];
    leagueContact: boolean;
  };
  privacyVersion: string;
  leagueContactText: string;
  leagueContactVersion: string;
}

/** The POST body: config-web refuses any other key ("Unknown field"). `email` must be present (null = none); `phones`
 *  / `leagueContact` absent = keep what is stored; `privacyVersion` = the view's (a stale one is refused). */
export interface OnboardingSubmission {
  preferredName: string;
  email: string | null;
  country?: string;
  phones?: Array<{ number: string; country?: string }>;
  leagueContact?: boolean;
  privacyAccepted: true;
  privacyVersion: string;
}

export const ONBOARDING_BODY_KEYS = ['preferredName', 'email', 'country', 'phones', 'leagueContact', 'privacyAccepted', 'privacyVersion'] as const;

/** The /app/privacy page on the config-web this run talks to (the full notice; opened in the system browser). */
export function privacyNoticeUrl(): string {
  return `${configWebOrigin(accountBase())}/app/privacy`;
}

/** A config-web session for the onboarding calls: the held one when this config-web issued it, else one exchanged from
 *  the fork account's saved credentials (the same exchange every guarded fork call makes, configWebAuth.ts). False
 *  when neither is available (the coach signs in under Settings > Account). */
export async function ensureOnboardingSession(creds: { coach: string; password: string }, fetchFn?: FetchLike): Promise<boolean> {
  const base = accountBase();
  if (hasSessionFor(base)) return true;
  const token = await ensureConfigWebToken(creds, fetchFn ?? desktopFetch(), base).catch(() => null);
  return Boolean(token) && hasSessionFor(base);
}

export function getOnboarding(fetchFn?: FetchLike, session?: ConfigWebSessionHandle): Promise<OnboardingView> {
  return jsonRequest<OnboardingView>('/api/me/onboarding', {}, fetchFn ?? desktopFetch(), accountBase(), session);
}

export function completeOnboarding(body: OnboardingSubmission, fetchFn?: FetchLike, session?: ConfigWebSessionHandle): Promise<OnboardingView> {
  // Only the allowed keys leave, whatever the caller built (config-web answers 400 "Unknown field" to anything else).
  const clean: Record<string, unknown> = {};
  for (const key of ONBOARDING_BODY_KEYS) if (key in body && body[key] !== undefined) clean[key] = body[key];
  if (!('email' in clean)) clean.email = null;
  return jsonRequest<OnboardingView>('/api/me/onboarding', {
    method: 'POST',
    headers: { 'X-CW-Auth': '1' },
    body: JSON.stringify(clean),
  }, fetchFn ?? desktopFetch(), accountBase(), session);
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
