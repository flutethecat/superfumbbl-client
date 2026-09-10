/**
 * AUTH CHALLENGE — the "does this actually work?" check behind the Login Credentials dialog.
 *
 * Owner ask 2026-08-18: "add an auth-challenge button to these windows — I want the user to confirm
 * their info here so we know it works." The dialog has two tabs and they are NOT symmetrical, so the
 * honest answer differs per tab:
 *
 *  • Super FUMBBL (fork) — a REAL credential challenge. config-web's `POST /api/fork/login` is exactly a
 *    "are these creds good" oracle, so the button proves coach+password end to end. It reuses
 *    configWebAuth's own login path, which means the pre-hashed payload (`passwordMd5`, never the
 *    clear text) and the single held-token slot are shared, not duplicated here.
 *
 *  • FUMBBL (official) — NOT a credential challenge, and this module refuses to pretend otherwise.
 *    fumbbl.com exposes no endpoint this client can use to prove a coach's password: the JNLP-free
 *    login path (game/fumbblAuth.ts) authenticates the APPLICATION's build-time API client and mints
 *    a token bound to that, so it would return "success" for a completely wrong coach password — the
 *    user's password is never sent to it at all. The user's FUMBBL password is only ever proven by
 *    the game server at connect time. So this tab gets a NAME check against the public, read-only
 *    coach lookup, labelled as a name check, with the password gap stated in the result line. A
 *    green tick that means less than the user thinks is worse than no button.
 *
 * Both challenges are plain HTTP. Neither touches the game websocket, and neither writes anything:
 * the fork side acquires a session token it was going to acquire anyway, and the FUMBBL side is a
 * public GET carrying no credential whatsoever.
 */

import { challengeForkCredentials, type AuthTransport, type ForkLoginOutcome } from './configWebAuth';
import { fetchFumbblCoachTeams, type FumbblCoachTeamsResult } from './fumbblCoachTeams';

/**
 * What the dialog renders under the button. `warn` is the state that keeps the FUMBBL tab honest —
 * the lookup succeeded but it did not prove what a tick would imply.
 */
export type ChallengeState =
  | { kind: 'idle' }
  | { kind: 'checking'; message: string }
  | { kind: 'ok'; message: string }
  | { kind: 'warn'; message: string }
  | { kind: 'fail'; message: string };

export const IDLE: ChallengeState = { kind: 'idle' };

/** True while a check is in flight — the button binds `:disabled` to this so it can't be spammed. */
export function isChecking(state: ChallengeState): boolean {
  return state.kind === 'checking';
}

// ─── Super FUMBBL (fork) ────────────────────────────────────────────────────────────────────────────

/**
 * Outcome → what the user reads. Split out from the call so the mapping is testable without a
 * transport, and so every wording change is one edit in one place.
 */
export function forkChallengeState(outcome: ForkLoginOutcome): ChallengeState {
  switch (outcome.kind) {
    case 'ok':
      return { kind: 'ok', message: `✓ Verified as ${outcome.coach} on the Super FUMBBL server.` };
    case 'rejected':
      // The server answered and said no. This is the ONLY branch allowed to blame the credential.
      return { kind: 'fail', message: '✗ Coach name or password incorrect.' };
    case 'unsupported':
      return {
        kind: 'fail',
        message: "✗ This server can't check credentials (it predates the login route). Your details are saved.",
      };
    case 'unreachable':
      return {
        kind: 'fail',
        message: `✗ Couldn't reach the Super FUMBBL server, so your details weren't checked (${outcome.detail}).`,
      };
  }
}

/**
 * Challenge the fork account. `coach`/`password` come straight from the dialog's own v-model targets
 * — the password one being credentials.ts's keychain-backed model — and are NEVER cleared by this
 * function, whatever the answer: a failed check must leave the user's typing exactly as they left it.
 */
export async function runForkChallenge(
  coach: string,
  password: string,
  transport: AuthTransport,
  baseUrl: string,
): Promise<ChallengeState> {
  const trimmed = coach.trim();
  if (!trimmed) return { kind: 'fail', message: 'Enter a coach name first.' };
  if (!password) return { kind: 'fail', message: 'Enter a password first.' };
  return forkChallengeState(await challengeForkCredentials({ coach: trimmed, password }, transport, baseUrl));
}

export function forkCheckingMessage(coach: string): string {
  return `Checking ${coach.trim()} against the Super FUMBBL server…`;
}

// ─── FUMBBL (official) ───────────────────────────────────────────────────────────────────────────

/**
 * The password caveat, stated every time the name check passes. Deliberately part of the SUCCESS
 * copy rather than a footnote: the moment a user sees a tick is the moment they stop reading.
 */
const FUMBBL_PASSWORD_CAVEAT =
  'FUMBBL has no password check for this app, so your password is only proven when you connect.';

export function fumbblCoachState(result: FumbblCoachTeamsResult, typed: string): ChallengeState {
  if (result.kind === 'not-found') {
    return { kind: 'fail', message: `✗ No FUMBBL coach called ${typed.trim()}.` };
  }
  const name = result.coachName.trim() || typed.trim();
  return { kind: 'warn', message: `✓ Coach ${name} exists on FUMBBL. ${FUMBBL_PASSWORD_CAVEAT}` };
}

export function fumbblUnreachableState(detail: string): ChallengeState {
  return { kind: 'fail', message: `✗ Couldn't reach fumbbl.com, so your name wasn't checked (${detail}).` };
}

/**
 * fetchFumbblCoachTeams throws `HTTP <status>` on a non-2xx, which lumps "fumbbl.com answered, and
 * the answer was no such coach" in with "fumbbl.com never answered". A thrown status means the site
 * WAS reached, so it must not be reported as unreachable.
 */
export function fumbblThrownState(error: unknown, typed: string): ChallengeState {
  const detail = (error as Error)?.message ?? String(error);
  const status = Number(/^HTTP (\d{3})$/.exec(detail)?.[1] ?? NaN);
  if (status === 404) return { kind: 'fail', message: `✗ No FUMBBL coach called ${typed.trim()}.` };
  if (Number.isFinite(status)) {
    return { kind: 'fail', message: `✗ FUMBBL couldn't answer the lookup (${detail}), so your name wasn't checked.` };
  }
  return fumbblUnreachableState(detail);
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Check the coach NAME against fumbbl.com's public coach lookup. No credential is sent — not the
 * password, not a token — and nothing is created server-side; it is the same read the team-import
 * and lobby screens already perform.
 */
export async function runFumbblChallenge(coach: string, fetcher: FetchLike): Promise<ChallengeState> {
  const trimmed = coach.trim();
  if (!trimmed) return { kind: 'fail', message: 'Enter a coach name first.' };
  try {
    return fumbblCoachState(await fetchFumbblCoachTeams(trimmed, fetcher), trimmed);
  } catch (e) {
    return fumbblThrownState(e, trimmed);
  }
}

export function fumbblCheckingMessage(coach: string): string {
  return `Looking up ${coach.trim()} on FUMBBL…`;
}
