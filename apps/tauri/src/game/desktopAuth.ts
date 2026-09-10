export interface DesktopAuthHttpResult {
  status: number;
  ok: boolean;
  data: Record<string, unknown>;
  errorText: string;
}

export interface DesktopAuthResult {
  token: string;
  coach: string;
  expiresAt: string;
}

export interface DesktopAuthProof {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

export class DesktopSignInCancelled extends Error {
  constructor() {
    super('Desktop sign-in was cancelled.');
    this.name = 'DesktopSignInCancelled';
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function createDesktopAuthProof(cryptoApi: Crypto = globalThis.crypto): Promise<DesktopAuthProof> {
  const stateBytes = cryptoApi.getRandomValues(new Uint8Array(32));
  const verifierBytes = cryptoApi.getRandomValues(new Uint8Array(32));
  const state = base64Url(stateBytes);
  const codeVerifier = base64Url(verifierBytes);
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return { state, codeVerifier, codeChallenge: base64Url(new Uint8Array(digest)) };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Desktop sign-in returned no ${label}.`);
  return value;
}

function waitForPoll(signal: AbortSignal, durationMs: number): Promise<void> {
  if (signal.aborted) return Promise.reject(new DesktopSignInCancelled());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, durationMs);
    const cancel = () => {
      clearTimeout(timer);
      reject(new DesktopSignInCancelled());
    };
    signal.addEventListener('abort', cancel, { once: true });
  });
}

export async function claimDesktopDiscordSession(options: {
  coach: string;
  baseUrl: string;
  request: (path: string, init: RequestInit) => Promise<DesktopAuthHttpResult>;
  openAuthorization: (url: string) => Promise<void>;
  saveSession: (token: string) => Promise<void>;
  signal: AbortSignal;
  pollIntervalMs?: number;
  proof?: DesktopAuthProof;
}): Promise<DesktopAuthResult> {
  const coach = options.coach.trim();
  if (!coach) throw new Error('Set your Super FUMBBL fork coach ID before signing in with Discord.');
  const proof = options.proof ?? await createDesktopAuthProof();
  const started = await options.request('/api/auth/desktop/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      coach,
      state: proof.state,
      codeChallenge: proof.codeChallenge,
      codeChallengeMethod: 'S256',
    }),
  });
  if (!started.ok) throw new Error(started.errorText);
  const flowId = requiredString(started.data.flowId, 'flow ID');
  const authorizationPath = requiredString(started.data.authorizationPath, 'authorization URL');
  const claimBody = JSON.stringify({
    flowId,
    state: proof.state,
    codeVerifier: proof.codeVerifier,
  });
  const cancel = async () => {
    try {
      await options.request('/api/auth/desktop/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: claimBody,
      });
    } catch {
      // Best effort: the server-side claim expires and destroys an unclaimed session.
    }
  };

  if (options.signal.aborted) {
    await cancel();
    throw new DesktopSignInCancelled();
  }

  try {
    const authorizationUrl = new URL(authorizationPath, `${options.baseUrl.replace(/\/$/, '')}/`).toString();
    await options.openAuthorization(authorizationUrl);
    for (;;) {
      if (options.signal.aborted) throw new DesktopSignInCancelled();
      const claimed = await options.request('/api/auth/desktop/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: claimBody,
      });
      if (claimed.status === 202) {
        await waitForPoll(options.signal, options.pollIntervalMs ?? 750);
        continue;
      }
      if (!claimed.ok) throw new Error(claimed.errorText);
      const result = {
        token: requiredString(claimed.data.token, 'session token'),
        coach: requiredString(claimed.data.coach, 'fork coach ID'),
        expiresAt: requiredString(claimed.data.expiresAt, 'session expiry'),
      };
      await options.saveSession(result.token);
      return result;
    }
  } catch (error) {
    if (error instanceof DesktopSignInCancelled || options.signal.aborted) {
      await cancel();
      throw new DesktopSignInCancelled();
    }
    throw error;
  }
}
