import { LiveSpectateHistory, spectatorCheckpointBytes } from './liveSpectateHistory';
import { sameSpectatorIdentity, type SpectatorCheckpoint, type SpectatorCursor, type SpectatorEvent } from './spectatorCheckpoint';

export type SpectatorPresentationSource = 'live' | 'live-review';
export type SpectatorReviewPhase = 'live' | 'pausing' | 'paused' | 'playing' | 'seeking' | 'returning' | 'disposed';
export interface SpectatorPresentationAdapter {
  /** Synchronous single publish of model AND durable HUD. Must not initiate async hydration. */
  publish(checkpoint: SpectatorCheckpoint, snap: boolean): void;
  /** Only transient effects; never writes durable state. Abort must settle promptly. */
  present(event: SpectatorEvent, signal: AbortSignal): Promise<void>;
  /** Optional synchronous cue for accelerated playback only; silent seek never calls this. */
  presentCollapsed?(event: SpectatorEvent): void;
  cancelTransients(): void;
  prepareReturn?(): Promise<void>;
  onChange?(): void;
}

/** Presentation ownership foundation. No socket or gameplay-send capability is available here. */
export class LiveSpectateReview {
  private visibleValue: SpectatorCheckpoint | null = null;
  private candidate: SpectatorCheckpoint | null = null;
  private active: AbortController | null = null;
  private activeCompletion: Promise<void> | null = null;
  private presentationGeneration = 0;
  private phaseValue: SpectatorReviewPhase = 'live';
  private sourceValue: SpectatorPresentationSource = 'live';
  private pauseCompletion: Promise<void> | null = null;
  private scrubEnd: SpectatorCursor | null = null;
  private failureValue: string | null = null;

  constructor(readonly history: LiveSpectateHistory, private readonly adapter: SpectatorPresentationAdapter) {}
  get visible(): SpectatorCheckpoint | null { return this.visibleValue; }
  get source(): SpectatorPresentationSource { return this.sourceValue; }
  get phase(): SpectatorReviewPhase { return this.phaseValue; }
  get failure(): string | null { return this.failureValue; }
  get pinned(): boolean { return !!this.visibleValue && !this.history.contains(this.visibleValue.cursor); }
  get generation(): number { return this.presentationGeneration; }
  private changed(): void { this.adapter.onChange?.(); }
  private publish(checkpoint: SpectatorCheckpoint, snap: boolean): boolean {
    try { this.adapter.publish(checkpoint, snap); return true; }
    catch (error) {
      this.cancel();
      this.phaseValue = 'paused';
      this.sourceValue = 'live-review';
      this.failureValue = `Position publication failed: ${String(error)}`;
      this.changed();
      return false;
    }
  }
  private fits(checkpoint: SpectatorCheckpoint): boolean {
    if (spectatorCheckpointBytes(checkpoint) <= this.history.limits.activeGraphBytes) return true;
    this.failureValue = 'History unavailable: active position exceeds the history budget';
    this.changed();
    return false;
  }
  /** Handover from an already paced live reader. No newer received head is selected. */
  adoptDisplayed(checkpoint: SpectatorCheckpoint): boolean {
    if (this.phaseValue !== 'live' || this.active || this.visibleValue || !this.fits(checkpoint)) return false;
    const head = this.history.head;
    if (!head || checkpoint.cursor.sessionId !== head.cursor.sessionId) return false;
    this.visibleValue = checkpoint;
    this.changed();
    return true;
  }
  /** Call only after ordered ingress has committed. Never buffers a second event queue. */
  received(): void {
    if (this.phaseValue !== 'live' || this.active || this.history.staleReason) return;
    const head = this.history.head;
    if (!head) return;
    if (!this.visibleValue || !sameSpectatorIdentity(this.visibleValue.cursor, head.cursor)
      || !this.history.contains(this.visibleValue.cursor)) {
      if (!this.publish(head, true)) return;
      this.visibleValue = head;
      this.changed();
      return;
    }
    const event = this.history.eventAfter(this.visibleValue.cursor);
    if (event) void this.present(event, 'live');
    else if (this.visibleValue !== head && this.visibleValue.cursor.sequence === head.cursor.sequence) {
      if (!this.publish(head, false)) return;
      this.visibleValue = head;
      this.changed();
    }
  }
  private async present(event: SpectatorEvent, expectedPhase: 'live' | 'playing'): Promise<boolean> {
    if (this.active || this.phaseValue !== expectedPhase) return false;
    const checkpoint = this.history.checkpointAt(event.cursor);
    if (!checkpoint || !this.fits(checkpoint)) return false;
    const generation = this.presentationGeneration;
    const active = new AbortController();
    this.active = active;
    this.candidate = checkpoint;
    // Candidate is complete before the first transient starts. Visible P remains independently owned.
    if (!this.publish(checkpoint, false)) return false;
    const transient = Promise.resolve().then(() => {
      if (!active.signal.aborted) return this.adapter.present(event, active.signal);
    });
    let releaseAbort!: () => void;
    const aborted = new Promise<void>((resolve) => { releaseAbort = resolve; active.signal.addEventListener('abort', releaseAbort, { once: true }); });
    const completion = Promise.race([transient, aborted]);
    this.activeCompletion = completion;
    try {
      await completion;
      if (generation !== this.presentationGeneration || this.active !== active) return false;
      this.visibleValue = checkpoint;
      return true;
    } catch (error) {
      if (generation === this.presentationGeneration && !active.signal.aborted) {
        this.failureValue = String(error);
        this.cancel();
        this.sourceValue = 'live-review';
        this.phaseValue = 'paused';
        if (this.publish(checkpoint, true)) this.visibleValue = checkpoint;
      }
      return false;
    } finally {
      active.signal.removeEventListener('abort', releaseAbort);
      if (this.active === active) { this.active = null; this.activeCompletion = null; this.candidate = null; }
      this.changed();
      if (this.phaseValue === 'live' && generation === this.presentationGeneration) this.received();
    }
  }
  /** `force` (stale-feed hand-off) pauses onto the displayed position even when the history is no longer recording. */
  pause(force = false): Promise<void> {
    if (this.pauseCompletion) return this.pauseCompletion;
    if (this.phaseValue !== 'live' || !this.visibleValue || (!force && !this.history.recording)) return Promise.resolve();
    // Close the reader gate synchronously, before observing/awaiting any completion.
    this.phaseValue = 'pausing';
    this.sourceValue = 'live-review';
    this.changed();
    this.pauseCompletion = this.finishPause().finally(() => { this.pauseCompletion = null; });
    return this.pauseCompletion;
  }
  private async finishPause(): Promise<void> {
    const generation = this.presentationGeneration;
    const checkpoint = this.candidate ?? this.visibleValue;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      if (this.activeCompletion) await Promise.race([
        this.activeCompletion.catch(() => undefined),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, 500); }),
      ]);
      if (generation !== this.presentationGeneration || this.phaseValue !== 'pausing') return;
      this.cancel();
      if (checkpoint) {
        if (!this.publish(checkpoint, true)) return;
        this.visibleValue = checkpoint;
      }
      this.phaseValue = 'paused';
      this.changed();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private cancel(): void {
    this.presentationGeneration++;
    this.active?.abort();
    this.active = null;
    this.activeCompletion = null;
    this.candidate = null;
    try { this.adapter.cancelTransients(); }
    catch (error) { this.failureValue = `Presentation cancellation failed: ${String(error)}`; }
  }
  async seek(cursor: SpectatorCursor): Promise<boolean> {
    if (this.sourceValue !== 'live-review' || this.phaseValue === 'disposed') return false;
    this.cancel();
    const generation = this.presentationGeneration;
    this.phaseValue = 'seeking';
    this.changed();
    // Allows newer seeks/return/route changes to invalidate preparation. Ingress does not bump generation.
    await Promise.resolve();
    if (generation !== this.presentationGeneration) return false;
    const checkpoint = this.history.checkpointAt(cursor);
    if (!checkpoint || !this.fits(checkpoint)) {
      this.failureValue = 'Earlier history limit reached';
      this.phaseValue = 'paused';
      this.changed();
      return false;
    }
    if (!this.publish(checkpoint, true)) return false;
    this.visibleValue = checkpoint;
    this.phaseValue = 'paused';
    this.changed();
    return true;
  }
  async stepForward(present = true): Promise<boolean> {
    if (this.sourceValue !== 'live-review' || this.phaseValue !== 'paused' || !this.visibleValue || this.pinned) return false;
    const event = this.history.eventAfter(this.visibleValue.cursor);
    if (!event) return false;
    if (!present) {
      const expectedGeneration = this.presentationGeneration + 1;
      const completed = await this.seek(event.cursor);
      if (!completed || expectedGeneration !== this.presentationGeneration || this.phaseValue !== 'paused') return false;
      try { this.adapter.presentCollapsed?.(event); }
      catch (error) { this.failureValue = String(error); this.changed(); return false; }
      return true;
    }
    this.phaseValue = 'playing';
    const generation = this.presentationGeneration;
    const completed = await this.present(event, 'playing');
    if (generation !== this.presentationGeneration) return false;
    this.phaseValue = 'paused';
    this.changed();
    return completed;
  }
  /** Stop historical autoplay immediately, retaining its already-complete candidate. */
  pausePlayback(): void {
    if (this.sourceValue !== 'live-review' || this.phaseValue === 'disposed' || this.phaseValue === 'returning' || this.phaseValue === 'paused') return;
    const checkpoint = this.candidate ?? this.visibleValue;
    this.cancel();
    if (checkpoint && this.publish(checkpoint, true)) this.visibleValue = checkpoint;
    this.phaseValue = 'paused';
    this.changed();
  }
  async goToLive(): Promise<boolean> {
    if (this.phaseValue === 'disposed' || this.sourceValue !== 'live-review') return false;
    this.cancel();
    const generation = this.presentationGeneration;
    this.phaseValue = 'returning';
    this.changed();
    try { await this.adapter.prepareReturn?.(); }
    catch (error) {
      if (generation === this.presentationGeneration) { this.phaseValue = 'paused'; this.failureValue = String(error); this.changed(); }
      return false;
    }
    if (generation !== this.presentationGeneration) return false;
    // Publication barrier: select CURRENT H only after preparation. No await or clone below.
    const head = this.history.head;
    if (!head || this.history.staleReason || !this.fits(head)) {
      this.phaseValue = 'paused';
      this.failureValue = this.history.staleReason ?? 'No trusted live position available';
      this.changed();
      return false;
    }
    if (!this.publish(head, true)) return false;
    this.visibleValue = head;
    this.sourceValue = 'live';
    this.phaseValue = 'live';
    this.scrubEnd = null;
    this.failureValue = null;
    this.changed();
    this.received();
    return true;
  }
  beginScrub(): SpectatorCursor | null {
    if (!this.visibleValue) return null;
    const segment = this.history.coverage().find((s) => sameSpectatorIdentity(s.identity, this.visibleValue!.cursor));
    this.scrubEnd = segment ? { ...segment.identity, sequence: segment.end } : null;
    return this.scrubEnd && { ...this.scrubEnd };
  }
  get scrubMaximum(): SpectatorCursor | null { return this.scrubEnd && { ...this.scrubEnd }; }
  endScrub(): void { this.scrubEnd = null; }
  dispose(): void {
    this.cancel();
    this.phaseValue = 'disposed';
    this.visibleValue = null;
    this.scrubEnd = null;
    this.changed();
  }
}
