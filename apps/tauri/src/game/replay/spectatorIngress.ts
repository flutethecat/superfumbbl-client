import type { GameSession, ServerCommand } from '@fumbbl40k/ffb-protocol';
import type { SpectatorCursor } from './spectatorCheckpoint';
import { LiveSpectateHistory, type IngressResult } from './liveSpectateHistory';

export interface SpectatorReceipt {
  cursor?: SpectatorCursor;
  order: number;
  receivedWallAt: number;
  receivedMonotonicAt: number;
}
export interface SpectatorIngressOptions {
  current(): boolean;
  receipt(): Omit<SpectatorReceipt, 'order'> & { order?: number };
  route(command: ServerCommand, receipt: SpectatorReceipt, result: IngressResult): void;
}

/** Exactly one generic subscription owns packet admission. Specialized session events
 * remain available for transport bookkeeping, but are not input to this dispatcher. */
export class SpectatorIngress {
  private order = 0;
  private unsubscribe: (() => void) | null;
  constructor(session: Pick<GameSession, 'on'>, readonly history: LiveSpectateHistory,
    readonly generation: number, private readonly options: SpectatorIngressOptions) {
    this.unsubscribe = session.on('command', (command) => this.receive(command));
  }
  private receive(command: ServerCommand): void {
    if (!this.unsubscribe || !this.options.current() || this.generation !== this.history.generation) return;
    const sample = this.options.receipt();
    const order = sample.order ?? this.order + 1;
    if (!Number.isSafeInteger(order) || order <= this.order) throw new Error('Spectator receipt order must increase');
    this.order = order;
    const receipt: SpectatorReceipt = { ...sample, order };
    const result = this.history.admit(command as unknown as Record<string, unknown>, this.generation,
      receipt.receivedWallAt, receipt.receivedMonotonicAt, receipt.order);
    if (result.kind === 'duplicate') return;
    if (result.kind === 'committed') receipt.cursor = result.checkpoint.cursor;
    this.options.route(command, receipt, result);
  }
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.history.disconnect(this.generation);
  }
}
