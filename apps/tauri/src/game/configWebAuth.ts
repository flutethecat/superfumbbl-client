// Owner security ruling 2026-08-17: "Passwords are being sent in the JSON inspector view for team
// creation. Can we do auth through tokens or cookies so these aren't sent? Passwords are being sent
// in plaintext and this is insecure."
//
// This module is the client half. The coach's fork password is exchanged ONCE for a session token
// (POST /api/fork/login on config-web — see the server's apps/config-web/src/auth/coachLogin.ts) and
// every guarded config-web call afterwards carries `Authorization: Bearer <token>` INSTEAD of a
// password parameter. The password stops appearing in request bodies, query strings, the devtools
// network inspector, and anything that logs URLs.
//
// Bearer, not a cookie: the Tauri HTTP plugin has no shared cookie jar for the client to inherit a
// same-origin session from, and a header the client sets explicitly is also immune to CSRF — the
// server relies on exactly that to exempt us from its X-CW-Auth ceremony.
//
// ⚠ NOT a TLS substitute. config-web is plain http:// over LAN/DDNS, so a token on the wire is still
// observable to anyone on-path. What tokens fix is REPEATED exposure (one credential moment instead
// of one per request), inspector/log visibility, and blast radius (a token expires; a password does
// not). TLS remains owed — it is a separate gap, not closed here.
//
// PRE-HASHING (owner ruling 08-17, follow-up): the routes that still MUST carry a credential —
// `challenge`, `jnlp`, `register`, and the login exchange itself — now send `passwordMd5`
// (hex md5 of the password) rather than the clear text. `ffb_coaches.password` IS that digest, so
// the fork needs nothing more, and config-web dual-accepts both forms for one release. The clear
// text stops appearing in bodies, query strings, proxy logs and downloaded JNLP files.
// The digest is still bearer-equivalent — see md5Hex's note in ffb-protocol. What it removes is the
// exposure of the coach's REUSED secret, not on-path replay.
//
// Back-compat is deliberate: if the exchange fails for ANY reason (an older config-web with no login
// route, fork DB down, wrong password), we attach no header and callers keep their password
// parameter. A client pointed at a server that predates this change must keep working.

import { md5Hex } from '@fumbbl40k/ffb-protocol';
import { requireForkBaseUrl } from './forkBase';
import { configWebOrigin } from './forkAccess';

export type AuthTransport = (input: string, init?: RequestInit) => Promise<Response>;

export interface ForkCreds {
  coach: string;
  password: string;
}

export interface ConfigWebCoordinationIdentity {
  token: string;
  coach: string;
  displayName: string;
  avatarUrl: string | null;
  source: 'discord' | 'userid-password';
  /** Epoch ms. We renew a little early rather than eat a guaranteed 401. */
  expiresAt: number;
  /** Sol r9: the config-web origin (scheme + host + port) that issued the token; it is only ever sent back there. */
  origin: string;
}

/** Renew this long before the server's stated expiry, so a token never dies mid-flight. */
const RENEW_MARGIN_MS = 60_000;

// Memory only — deliberately NOT persisted. The token is short-lived and a fresh app launch simply
// performs one exchange; persisting it would put a second credential at rest for no gain. (The
// password itself is no longer on disk either — it moved to the OS store, see credentials.ts.)
let held: ConfigWebCoordinationIdentity | null = null;
/** Sol r10: pending login exchanges, keyed by the NORMALISED config-web origin + coach - a caller only ever joins an
 *  exchange for its own origin and coach, and each promise removes only its own entry when it settles. */
const inFlight = new Map<string, Promise<string | null>>();
function exchangeKey(baseUrl: string, coach: string): string {
  return `${configWebOrigin(baseUrl)}\n${coach.trim().toLowerCase()}`;
}

/**
 * Routes whose credential was ONLY ever an auth credential, so a held token replaces it outright.
 * Deliberately EXCLUDES the game-server join path: `challenge` and `jnlp` carry the credential into
 * the fork-join JNLP — it is the FFB game-server credential, not a config-web one, so no token can
 * stand in for it. Also excludes `register`, which SETS the password.
 *
 * Those three no longer send clear text either: they send `passwordMd5`, which is exactly what the
 * fork stores and what upstream's own client derives before joining. (An earlier note here said the
 * JNLP needed cleartext because "the fork stores md5"; that had it backwards — storing md5 is
 * precisely why the digest suffices. See docs/credential-plaintext-audit.md §3.)
 */
export const TOKEN_GUARDED_PATHS = new Set(['my-games', 'team-builder/build', 'team-builder/preview']);

/** The held token for `coach`. `origin` (the config-web about to receive it) must match the issuer's when given. */
export function heldTokenFor(coach: string, now = Date.now(), origin?: string): string | null {
  if (!held) return null;
  if (origin !== undefined && held.origin !== configWebOrigin(origin)) return null;
  if (held.coach.toLowerCase() !== coach.trim().toLowerCase()) return null;
  if (held.expiresAt - RENEW_MARGIN_MS <= now) return null;
  return held.token;
}

/**
 * Sol r2 P2 (client onboarding): an opaque handle on ONE held session, so a multi-request flow (check the account, read,
 * then write) can bind every request to the session it checked, even if a login / token exchange replaces the held
 * session meanwhile. The handle carries the issuing origin and coach only; its token stays in this module (a WeakMap).
 */
export interface ConfigWebSessionHandle { readonly origin: string; readonly coach: string }
const handleTokens = new WeakMap<ConfigWebSessionHandle, string>();

/** A handle on the session held right now for `origin` (null when none is held, or another origin issued it). */
export function captureConfigWebSession(origin: string, now = Date.now()): ConfigWebSessionHandle | null {
  if (!held || held.expiresAt - RENEW_MARGIN_MS <= now) return null;
  if (!held.origin || held.origin !== configWebOrigin(origin)) return null;
  const handle: ConfigWebSessionHandle = Object.freeze({ origin: held.origin, coach: held.coach });
  handleTokens.set(handle, held.token);
  return handle;
}

/** Is `handle` still the held session (same token, not expired)? False once a login or sign-out replaced it. */
export function configWebSessionIs(handle: ConfigWebSessionHandle | null, now = Date.now()): boolean {
  if (!handle || !held || held.expiresAt - RENEW_MARGIN_MS <= now) return false;
  return held.origin === handle.origin && held.token === handleTokens.get(handle);
}

/** The Bearer header for exactly the captured session, and only toward the origin that issued it ({} otherwise). */
export function configWebBearerHeadersFor(handle: ConfigWebSessionHandle, origin: string): Record<string, string> {
  const token = handleTokens.get(handle);
  if (!token || handle.origin !== configWebOrigin(origin)) return {};
  return { authorization: `Bearer ${token}` };
}

/** Read-only snapshot for coordination UI. The secret token never leaves this module. */
export function configWebCoordinationIdentity(now = Date.now()): Omit<ConfigWebCoordinationIdentity, 'token' | 'origin'> | null {
  if (!held || held.expiresAt - RENEW_MARGIN_MS <= now) return null;
  const { token: _token, origin: _origin, ...identity } = held;
  return { ...identity };
}

/** The issuing config-web origin of the held session ('' when none). */
export function configWebSessionOrigin(): string {
  return held?.origin ?? '';
}

/** Header projection for Config-Web API modules; they never receive or retain the token itself. Sol r9: only for the
 *  origin that issued the token - another config-web gets no header. */
export function configWebBearerHeaders(origin: string, now = Date.now()): Record<string, string> {
  if (!held || held.expiresAt - RENEW_MARGIN_MS <= now) return {};
  if (!held.origin || held.origin !== configWebOrigin(origin)) return {};
  return { authorization: `Bearer ${held.token}` };
}

/** Import an OAuth-claimed session into the same single holder used by userid/password exchange. */
export function adoptConfigWebSession(input: {
  token: string;
  coach: string;
  displayName?: string;
  avatarUrl?: string | null;
  expiresAt?: number;
  source: 'discord' | 'userid-password';
  /** The issuing config-web (any URL on it); '' / absent = unscoped (tests only: never sent as a header). */
  origin?: string;
}, now = Date.now()): boolean {
  const token = input.token.trim();
  const coach = input.coach.trim();
  if (!token || !coach) return false;
  held = {
    token,
    coach,
    displayName: input.displayName?.trim() || coach,
    avatarUrl: input.avatarUrl ?? null,
    source: input.source,
    expiresAt: input.expiresAt && input.expiresAt > now ? input.expiresAt : now + 8 * 60 * 60 * 1000,
    origin: input.origin ? configWebOrigin(input.origin) : '',
  };
  return true;
}

/** Drop the held token — on a 401, on sign-out, or when the coach identity changes. */
export function clearConfigWebToken(): void {
  held = null;
  inFlight.clear();
}

/** Sol r9: drop the held token only when it was issued by this config-web (a refusal from another one never clears it). */
export function clearConfigWebTokenFor(origin: string): void {
  if (held && held.origin === configWebOrigin(origin)) clearConfigWebToken();
}

/**
 * Why the login result is a discriminated union and not `string | null`:
 *
 * The token plumbing only ever needed "did we get a token" — every failure folds into the same
 * password-parameter fallback. The Verify button in the credentials dialog needs the opposite: an
 * unreachable server and a wrong password are DIFFERENT things to tell a user, and reporting a dead
 * LAN link as "password incorrect" sends them off to reset a password that was fine. So the one
 * exchange reports the distinction, and `exchange()` below flattens it back for its own callers.
 *
 * `unsupported` (404) is separate again: a config-web that predates the login route hasn't rejected
 * anything, so it must not be described as a credential failure either.
 */
export type ForkLoginOutcome =
  | { kind: 'ok'; coach: string; token: string }
  | { kind: 'rejected'; status: number }
  | { kind: 'unsupported'; status: number }
  | { kind: 'unreachable'; detail: string };

/**
 * The ONE fork-login call. Adopts the token into the single held slot on success — callers that
 * only want a credential CHECK still leave the session better off, never with a second copy.
 */
async function login(
  creds: ForkCreds,
  transport: AuthTransport,
  baseUrl: string,
  now: number,
): Promise<ForkLoginOutcome> {
  requireForkBaseUrl(baseUrl); // owner 10-31 (Sol r2): never a relative request without a fork host
  let response: Response;
  try {
    response = await transport(`${baseUrl}/api/fork/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Pre-hashed: the clear text never reaches the wire or the network inspector.
      body: JSON.stringify({ coach: creds.coach.trim(), passwordMd5: md5Hex(creds.password) }),
    });
  } catch (e) {
    // config-web unreachable — DNS, refused connection, TLS. Not a statement about the credential.
    return { kind: 'unreachable', detail: (e as Error)?.message ?? String(e) };
  }
  if (response.status === 404) return { kind: 'unsupported', status: 404 }; // older server, no login route
  if (!response.ok) return { kind: 'rejected', status: response.status };
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof data.token === 'string' ? data.token : '';
  // A 200 with no token is a server we can't take a "yes" from; treat it as a refusal, not a pass.
  if (!token) return { kind: 'rejected', status: response.status };
  const parsed = typeof data.expiresAt === 'string' ? Date.parse(data.expiresAt) : NaN;
  const coach = typeof data.coach === 'string' && data.coach ? data.coach : creds.coach.trim();
  adoptConfigWebSession({
    token,
    coach,
    displayName: coach,
    source: 'userid-password',
    // A server that gives us no usable expiry still gets a bounded token life on our side.
    expiresAt: Number.isFinite(parsed) ? parsed : now + 60 * 60 * 1000,
    origin: baseUrl,
  }, now);
  return { kind: 'ok', coach, token };
}

/**
 * Prove a coach/password pair against the fork, reporting WHY it failed. Shares `login` — and so the
 * pre-hashed payload and the single held-token slot — with the token exchange; a successful check
 * simply leaves a usable token behind rather than storing anything of its own.
 */
export async function challengeForkCredentials(
  creds: ForkCreds,
  transport: AuthTransport,
  baseUrl: string,
  now = Date.now(),
): Promise<ForkLoginOutcome> {
  return login(creds, transport, baseUrl, now);
}

async function exchange(
  creds: ForkCreds,
  transport: AuthTransport,
  baseUrl: string,
  now: number,
): Promise<string | null> {
  // 404 on an older server, 401 on bad creds, a throw when it's unreachable — for the token
  // plumbing these are all the same answer: no token, so the caller keeps its password parameter.
  const outcome = await login(creds, transport, baseUrl, now);
  return outcome.kind === 'ok' ? outcome.token : null;
}

/**
 * The held token for these creds, exchanging once if we don't have one. Concurrent callers share a
 * single in-flight exchange — otherwise the first screen to load fires four logins at once.
 */
export async function ensureConfigWebToken(
  creds: ForkCreds,
  transport: AuthTransport,
  baseUrl: string,
  now = Date.now(),
): Promise<string | null> {
  if (!creds.coach.trim() || !creds.password) return null;
  const existing = heldTokenFor(creds.coach, now, baseUrl);
  if (existing) return existing;
  const key = exchangeKey(baseUrl, creds.coach);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise: Promise<string | null> = exchange(creds, transport, baseUrl, now).finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key); // per-promise cleanup: never a newer exchange's entry
  });
  inFlight.set(key, promise);
  return promise;
}

export interface AuthorizedRequest {
  headers: Record<string, string>;
  /** The caller's params/body with `password` removed IFF a token replaced it. */
  payload: Record<string, unknown>;
  authorized: boolean;
}

/**
 * The ONE place the header goes on. Returns the auth header plus a payload with the now-redundant
 * password stripped — stripping and attaching in the same step is what makes it impossible to end up
 * sending both, or neither.
 */
export async function authorizeForkRequest(
  path: string,
  payload: Record<string, unknown>,
  creds: ForkCreds,
  transport: AuthTransport,
  baseUrl: string,
): Promise<AuthorizedRequest> {
  requireForkBaseUrl(baseUrl); // callers fetch `${baseUrl}/...` next: refuse a relative base before anything goes out
  const token = await ensureConfigWebToken(creds, transport, baseUrl);
  if (!token) return { headers: {}, payload, authorized: false };
  // Sol r10: revalidate the issuer before attaching - only a token held for THIS origin and coach goes on the request.
  if (heldTokenFor(creds.coach, Date.now(), baseUrl) !== token) return { headers: {}, payload, authorized: false };
  const next = { ...payload };
  if (TOKEN_GUARDED_PATHS.has(path)) delete next.password;
  return { headers: { authorization: `Bearer ${token}` }, payload: next, authorized: true };
}

/**
 * A 401 on a request we authorized means the token died (server restart, expiry, revocation). Drop
 * it and tell the caller to retry ONCE — a second 401 is a real credential failure and must surface,
 * never become a retry loop against a locked-out account.
 */
export function shouldRetryAfterUnauthorized(status: number, wasAuthorized: boolean, alreadyRetried: boolean): boolean {
  if (status !== 401 || !wasAuthorized || alreadyRetried) return false;
  clearConfigWebToken();
  return true;
}
