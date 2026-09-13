import type { FieldCoordinateJson } from '@fumbbl40k/ffb-protocol';

export const DEFAULT_FLY_BRAIN_URL = 'http://127.0.0.1:8766';
export type FlyVerdict = 'escape' | 'forward' | 'backward' | 'left' | 'right' | 'groom' | 'none';
export interface FlyDecision {
  ok: true;
  verdict: FlyVerdict;
  focus: FieldCoordinateJson | null;
  counts: Record<'GF' | 'DNp09' | 'MDN' | 'DNa02_L' | 'DNa02_R' | 'groom', number>;
  wall_ms: number;
}
export interface FlyRequest {
  gameKey: string;
  turnKey: string;
  seed: number;
  mySide: 'home' | 'away';
  state: string;
  selectedPlayerId: string | null;
  players: { id: string; x: number; y: number; mine: boolean; standing: boolean;
    selected: boolean; carrier: boolean; active: boolean }[];
  ball: FieldCoordinateJson | null;
  legalSquares: FieldCoordinateJson[];
  scoreDiff: number;
  rerolls: number;
  turnNr: number;
  half: number;
  onPitch: { mine: number; theirs: number };
  ms: number;
}
export interface SidecarOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class SidecarClient {
  constructor(readonly baseUrl = DEFAULT_FLY_BRAIN_URL, private readonly options: SidecarOptions = {}) {}

  private async request(path: 'health' | 'reset' | 'decide', signal: AbortSignal, body?: unknown): Promise<unknown> {
    const url = new URL(this.baseUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        || url.username || url.password || url.search || url.hash) throw new Error('Invalid local sidecar URL');
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path}`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const cancelled = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Sidecar request aborted')), { once: true });
      });
      if (signal.aborted) abort();
      timer = setTimeout(abort, this.options.timeoutMs ?? 2000);
      const response = await Promise.race([cancelled, (async () => {
        if (controller.signal.aborted) throw new Error('Sidecar request aborted');
        const result = await (this.options.fetch ?? globalThis.fetch)(url.href, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
          redirect: 'error',
        });
        if (!result.ok) throw new Error(`Sidecar HTTP ${result.status}`);
        const json: unknown = await result.json();
        if (!json || typeof json !== 'object' || (json as { ok?: unknown }).ok !== true) {
          throw new Error('Sidecar returned non-ok');
        }
        return json;
      })()]);
      if (controller.signal.aborted) throw new Error('Sidecar request aborted');
      return response;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }

  health(signal: AbortSignal): Promise<unknown> { return this.request('health', signal); }

  async reset(body: { gameKey: string; seed: number; turnKey?: string }, signal: AbortSignal): Promise<void> {
    await this.request('reset', signal, body);
  }

  async decide(body: FlyRequest, signal: AbortSignal): Promise<FlyDecision> {
    const result = await this.request('decide', signal, body) as Partial<FlyDecision>;
    const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
    if (!['escape', 'forward', 'backward', 'left', 'right', 'groom', 'none'].includes(String(result.verdict))
        || !(result.focus === null || (Array.isArray(result.focus) && result.focus.length === 2 && result.focus.every(finite)))
        || !result.counts || !['GF', 'DNp09', 'MDN', 'DNa02_L', 'DNa02_R', 'groom'].every(
          (key) => finite((result.counts as Record<string, unknown>)[key]),
        ) || !finite(result.wall_ms)) throw new Error('Malformed sidecar decision');
    return result as FlyDecision;
  }
}
