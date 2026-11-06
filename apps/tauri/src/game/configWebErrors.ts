/**
 * Owner 11-06 (client onboarding): config-web errors that keep their HTTP status, so a caller can tell the League
 * Manager's new-user gate apart from any other refusal. No imports: the account API (accountApi.ts) and the fork
 * routes (forkChallenge.ts, forkRegistration.ts) both throw / inspect these.
 *
 * The gate (config-web src/auth/onboarding.ts): while a signed-in coach has not accepted the current privacy notice,
 * every state-changing /api request (and the legacy GET /api/fork/challenge, /register, /matchstatus) answers
 * HTTP 428 `{ error: "Complete your profile first.", onboarding: true }`. config-web ALSO answers 428 for an unrelated
 * reason on a few organiser routes (the admin console's dry-run revision, the badges revision), so a 428 that names a
 * different error is NOT the gate.
 */

/** The gate's exact message (config-web ONBOARDING_REQUIRED_MESSAGE). */
export const ONBOARDING_REQUIRED_MESSAGE = 'Complete your profile first.';

export class ConfigWebHttpError extends Error {
  readonly status: number;
  /** Seconds from a `retry-after` header (a 429), when the server sent one. */
  readonly retryAfterSeconds: number | null;
  /** The body's `onboarding: true` marker (the gate's 428). */
  readonly onboarding: boolean;

  constructor(message: string, status: number, options: { retryAfterSeconds?: number | null; onboarding?: boolean } = {}) {
    super(message);
    this.name = 'ConfigWebHttpError';
    this.status = status;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.onboarding = options.onboarding === true;
  }
}

/** A `retry-after` header in seconds (delta-seconds only; an HTTP date or junk = null). */
export function retryAfterSeconds(headers: { get(name: string): string | null } | undefined | null): number | null {
  const raw = headers?.get('retry-after')?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The error a failed config-web response becomes: the body's `error` text verbatim (else "HTTP <status>"). */
export function configWebHttpError(response: { status: number; headers?: { get(name: string): string | null } }, data: unknown, fallback?: string): ConfigWebHttpError {
  const body = (data && typeof data === 'object' ? data : {}) as { error?: unknown; onboarding?: unknown };
  const message = typeof body.error === 'string' && body.error ? body.error : (fallback ?? `HTTP ${response.status}`);
  return new ConfigWebHttpError(message, response.status, {
    retryAfterSeconds: retryAfterSeconds(response.headers),
    onboarding: body.onboarding === true,
  });
}

const isGateMessage = (value: unknown): boolean => typeof value === 'string' && value.trim() === ONBOARDING_REQUIRED_MESSAGE;

/**
 * Is this the onboarding gate's answer, from ANY config-web call? True for: a 428 carrying the gate's marker or exact
 * message, a 428 with no error text of its own, or any error / outcome / string whose message is exactly
 * "Complete your profile first." (callers that flatten errors to text keep working). A 428 naming another error (an
 * organiser route's missing revision) is not the gate.
 */
export function isOnboardingRequired(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'string') return isGateMessage(error);
  if (typeof error !== 'object') return false;
  const e = error as { status?: unknown; message?: unknown; error?: unknown; onboarding?: unknown };
  if (isGateMessage(e.message) || isGateMessage(e.error)) return true;
  if (e.status !== 428) return false;
  if (e.onboarding === true) return true;
  const text = typeof e.message === 'string' ? e.message : typeof e.error === 'string' ? e.error : '';
  return !text || text === 'HTTP 428';
}
