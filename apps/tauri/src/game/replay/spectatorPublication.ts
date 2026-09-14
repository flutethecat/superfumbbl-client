import { shallowReadonly, shallowRef } from 'vue';
import { passiveSpectatorProjection } from '../passiveSpectatorProjection';
import { spectatorCheckpointBytes } from './liveSpectateHistory';
import { freezeSpectatorValue, validateSpectatorCheckpoint, type SpectatorCheckpoint } from './spectatorCheckpoint';

export interface SpectatorPublishedPosition {
  checkpoint: SpectatorCheckpoint;
  passive: ReturnType<typeof passiveSpectatorProjection>;
  /** Renderer transition identity, deliberately outside the durable checkpoint. Bumps on EVERY publish. */
  epoch: number;
  /** Bumps only on a snap publish (join/reconnect snapshot, pause landing, GO TO LIVE landing). The store's
   *  `snapshotEpoch` reads THIS: the view rebuilds every token on that tick, which must never run per presented
   *  event — it wiped each walk tween a millisecond after it started (owner UAT 09-08/09-14: no animations). */
  snapshotEpoch: number;
  snap: boolean;
}

/** One reactive root for model, durable HUD, passive cards, clock and cursor.
 * Preparation can fail without notifying readers or changing the previous position. */
export class SpectatorPublication {
  private readonly current = shallowRef<SpectatorPublishedPosition | null>(null);
  readonly position = shallowReadonly(this.current);
  private epoch = 0;
  private snapshotEpoch = 0;
  constructor(private readonly budgetBytes = 16 * 1024 * 1024) {}
  publish(checkpoint: SpectatorCheckpoint, snap: boolean): void {
    validateSpectatorCheckpoint(checkpoint);
    const prepared = { checkpoint, passive: passiveSpectatorProjection(checkpoint), epoch: this.epoch + 1,
      snapshotEpoch: snap ? this.snapshotEpoch + 1 : this.snapshotEpoch, snap };
    // Derivation must not introduce NaN/undefined from malformed dialog content.
    const passiveJson = JSON.stringify(prepared.passive, (_key, value: unknown) => {
      if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Invalid passive spectator content');
      return value;
    });
    // Perf 09-14: the checkpoint's bytes are memoised per frozen graph (history already measured this head); the
    // envelope is the passive JSON plus the two epochs and the flag (~60 chars), not a second ~200 KB stringify.
    const envelope = JSON.stringify({ epoch: prepared.epoch, snapshotEpoch: prepared.snapshotEpoch, snap });
    if (spectatorCheckpointBytes(checkpoint) + (passiveJson.length + envelope.length + 32) * 2 > this.budgetBytes) throw new Error('Visible spectator position exceeds its memory budget');
    const next = freezeSpectatorValue(prepared);
    this.epoch = next.epoch;
    this.snapshotEpoch = next.snapshotEpoch;
    this.current.value = next;
  }
  clear(): void { this.current.value = null; }
}
