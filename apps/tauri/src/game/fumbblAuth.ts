/**
 * JNLP-free FUMBBL login — mint a one-time play token via FUMBBL's public API.
 *
 * The ffblive.jnlp file is only a DELIVERY ENVELOPE for a one-time `-auth` token;
 * FUMBBL's public API mints the exact same token directly (verified from
 * fumbbl.com/apidoc — see docs/artifact-orchestration/ffb-game-connect-architecture.md
 * §"Tokens WITHOUT a JNLP"):
 *
 *   1. POST /api/oauth/token   Authorization: Basic base64(client_id:client_secret)
 *                              (client-credentials grant)            → { access_token }
 *   2. POST /api/auth/getToken Authorization: Bearer <access_token>  → one-time play token
 *
 * The token from step 2 IS the JNLP's `-auth` value (the FFB server's
 * FumbblRequestCheckAuthorization verifies coach+token the same way), so
 * connectAsPlayer consumes it UNCHANGED — no ffblive.jnlp download, and a fresh
 * token can be minted on demand (no more spent-token pain).
 *
 * SEAM — SINGLE APPLICATION CREDENTIAL (owner 2026-07-09): the client_id/secret are
 * the APP's OWN fumbbl.com API client, provisioned at BUILD TIME (env → import.meta.env),
 * NOT a per-user setting. They are deliberately OCCLUDED from the settings pane and never
 * written to localStorage. A build without the credential provisioned reports
 * fumbblApiConfigured()===false and the UI falls back to Open .jnlp; nothing hits the
 * live FUMBBL mint endpoint until the token is baked in.
 *
 * ⚠ Per the live-play constraints, the JOIN path is fork-validated; this mint path is
 * left to live validation. CORS: fumbbl.com/api sends Access-Control-Allow-Origin:* for
 * reads; the OAuth POSTs carry an Authorization header, so a preflight may apply — a
 * live-validation item.
 */

import { FUMBBL_SITE } from './settings';

/** The application's fumbbl.com API client, injected at build time (Vite env). Empty in an
 *  unprovisioned build (e.g. local dev) → JNLP-free login is unavailable and the UI uses a JNLP.
 *  Kept OUT of settings/localStorage so it can't be read or edited from the client UI. */
const APP_CLIENT_ID = (import.meta.env.VITE_FUMBBL_APP_CLIENT_ID ?? '').trim();
const APP_CLIENT_SECRET = (import.meta.env.VITE_FUMBBL_APP_CLIENT_SECRET ?? '').trim();

/** Thrown when this build has no application API credential provisioned. The UI catches it
 *  to fall back to Open .jnlp rather than erroring hard. */
export class FumbblCredentialsMissing extends Error {
  constructor() {
    super("This build isn't set up for API login — open a FUMBBL .jnlp to play instead.");
    this.name = 'FumbblCredentialsMissing';
  }
}

/** True when the build carries the application API credential (so JNLP-free login is available). */
export function fumbblApiConfigured(): boolean {
  return !!APP_CLIENT_ID && !!APP_CLIENT_SECRET;
}

interface OAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

/** Step 1 — client-credentials grant → a short-lived bearer access token. */
async function fetchAccessToken(): Promise<string> {
  const basic = btoa(`${APP_CLIENT_ID}:${APP_CLIENT_SECRET}`);
  const res = await fetch(`${FUMBBL_SITE}/api/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`FUMBBL oauth/token failed (${res.status} ${res.statusText})`);
  const data = (await res.json()) as OAuthTokenResponse;
  if (!data.access_token) throw new Error('FUMBBL oauth/token returned no access_token');
  return data.access_token;
}

/** Step 2 — a one-time play token (the JNLP's `-auth`), bound to the app's account. */
async function fetchPlayToken(accessToken: string): Promise<string> {
  const res = await fetch(`${FUMBBL_SITE}/api/auth/getToken`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`FUMBBL auth/getToken failed (${res.status} ${res.statusText})`);
  // The endpoint returns the raw token string ("Generate a one-time token"); tolerate a
  // JSON-quoted or {token:…} shape just in case.
  const bodyText = (await res.text()).trim();
  let token = bodyText;
  if (bodyText.startsWith('{')) {
    try { token = (JSON.parse(bodyText) as { token?: string }).token ?? ''; } catch { /* keep raw */ }
  }
  token = token.replace(/^"|"$/g, '').trim();
  if (!token) throw new Error('FUMBBL auth/getToken returned an empty token');
  return token;
}

/**
 * Mint a fresh one-time FUMBBL play token — the JNLP-free equivalent of downloading
 * ffblive.jnlp and reading its `-auth`. The returned token is handed directly to the
 * prepared socket lobby and is never placed in reactive UI state.
 *
 * Throws FumbblCredentialsMissing when the build has no application credential (the seam),
 * or a plain Error on an API/network failure.
 */
export async function mintFumbblToken(): Promise<string> {
  if (!fumbblApiConfigured()) throw new FumbblCredentialsMissing();
  const accessToken = await fetchAccessToken();
  return fetchPlayToken(accessToken);
}

/** Best-effort team-name lookup by id (a nicety for the lobby label). Never throws —
 *  returns null if the API shape isn't as expected or the fetch fails. */
export async function fetchTeamName(teamId: string): Promise<string | null> {
  try {
    const res = await fetch(`${FUMBBL_SITE}/api/team/get/${encodeURIComponent(teamId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { name?: string };
    return data.name?.trim() || null;
  } catch {
    return null;
  }
}
