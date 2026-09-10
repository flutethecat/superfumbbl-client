import {
  adoptConfigWebSession,
  type AuthTransport,
  type ConfigWebCoordinationIdentity,
} from './configWebAuth';

const POLL_INTERVAL_MS = 2_000;
const PAIRING_TIMEOUT_MS = 5 * 60 * 1000;

type PublicIdentity = Omit<ConfigWebCoordinationIdentity, 'token'>;

export type PairingOutcome =
  | { kind: 'ok'; identity: PublicIdentity }
  | { kind: 'expired' }
  | { kind: 'unavailable'; detail: string }
  | { kind: 'cancelled' };

export interface PairingOptions {
  baseUrl: string;
  transport: AuthTransport;
  openSystemBrowser: (url: string) => Promise<void>;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
}
function waitDefault(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
/** Pair through POST-only claim endpoints; only Discord's authorize URL is opened externally. */
export async function pairConfigWebSession(options: PairingOptions): Promise<PairingOutcome> {
  const wait = options.wait ?? waitDefault;
  const now = options.now ?? Date.now;
  const startedAt = now();
  let startResponse: Response;
  try {
    startResponse = await options.transport(`${options.baseUrl}/api/auth/app/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
  } catch (error) {
    return { kind: 'unavailable', detail: (error as Error)?.message ?? String(error) };
  }
  if (!startResponse.ok) return { kind: 'unavailable', detail: `Config-Web returned ${startResponse.status}.` };
  const start = (await startResponse.json().catch(() => ({}))) as Record<string, unknown>;
  const pairingToken = typeof start.pairingToken === 'string' ? start.pairingToken : '';
  const authorizeUrl = typeof start.authorizeUrl === 'string' ? start.authorizeUrl : '';
  if (!pairingToken || !authorizeUrl) return { kind: 'unavailable', detail: 'Config-Web returned an invalid pairing response.' };

  try { await options.openSystemBrowser(authorizeUrl); }
  catch (error) { return { kind: 'unavailable', detail: (error as Error)?.message ?? String(error) }; }

  while (now() - startedAt < PAIRING_TIMEOUT_MS) {
    if (options.signal?.aborted) return { kind: 'cancelled' };
    await wait(POLL_INTERVAL_MS);
    if (options.signal?.aborted) return { kind: 'cancelled' };
    let response: Response;
    try {
      response = await options.transport(`${options.baseUrl}/api/auth/app/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pairingToken }),
      });
    } catch (error) {
      return { kind: 'unavailable', detail: (error as Error)?.message ?? String(error) };
    }
    if (response.status === 202 || response.status === 429) continue;
    if (response.status === 410) return { kind: 'expired' };
    if (!response.ok) return { kind: 'unavailable', detail: `Config-Web returned ${response.status}.` };
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionToken = typeof data.sessionToken === 'string' ? data.sessionToken : '';
    const coach = typeof data.coach === 'string' ? data.coach : '';
    if (!adoptConfigWebSession({
      token: sessionToken,
      coach,
      displayName: typeof data.displayName === 'string' ? data.displayName : coach,
      avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : null,
      source: 'discord',
    }, now())) return { kind: 'unavailable', detail: 'Config-Web returned an invalid claimed session.' };
    const identity: PublicIdentity = {
      coach,
      displayName: typeof data.displayName === 'string' && data.displayName ? data.displayName : coach,
      avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : null,
      source: 'discord',
      expiresAt: now() + 8 * 60 * 60 * 1000,
    };
    return { kind: 'ok', identity };
  }
  return { kind: 'expired' };
}
