// Owner 10-06 (spec-dice-queue): the store publishes every action-dice batch onto `state.actionDiceQueue` as well as the
// single `state.actionDice` slot. Two batches landing in one tick (two serverModelSync frames from one socket drain, or a
// deferred gaze/fireball surface beside a fresh one) used to collapse into the last one under Vue's batched watcher, so
// the first die never rendered. The view now DRAINS the queue in order and runs the per-cue logic for each batch here:
// camera nudge, the pickup-on-arrival wait (keyed by that batch's seq; superseded -> shows at once), then onDiceCue. Pure so it is
// testable without mounting SpectateView.
import type { ActionDieRoll, LifecycleScheduler } from './actionDiceLifecycle';

/** One published batch (the store's `state.actionDice` / `state.actionDiceQueue` element). */
export interface ActionDiceBatch { rolls: readonly ActionDieRoll[]; seq: number }

/** The renderer surface the drain reads (a subset of PitchRenderer). */
export interface ActionDiceDrainRenderer {
  /** Nudge the camera to the square; returns the pan wait in ms (0 = already on camera). */
  ensureOnCamera(square: [number, number]): number;
  /** True once the mover's token is drawn on the square (fail-open when the token is gone). */
  playerDrawnAt(playerId: string, square: readonly [number, number]): boolean;
}

export interface ActionDiceQueueDrainDeps {
  renderer: () => ActionDiceDrainRenderer | null;
  /** The lifecycle controller: the cue sink and the presentation epoch (a seek / teardown advances it). */
  lifecycle: { onDiceCue(rolls: readonly ActionDieRoll[], wait: number): void; readonly epoch: number };
  scheduler: LifecycleScheduler;
  now: () => number;
  /** `state.actionDice?.seq`: the NEWEST published batch. A pickup wait whose seq is no longer newest is superseded
   *  and shows at once (owner 10-06), never dropped. */
  newestSeq: () => number | undefined;
  /** The player the model has standing on that square (the mover a pickup roll belongs to), or null. */
  pickupMoverAt: (square: readonly [number, number]) => string | null;
  /** The old fixed pickup beat (one movement step), used when the mover is unknown. */
  pickupBeatMs: () => number;
  /** Fail-open cap for the pickup-on-arrival poll. */
  arrivalCapMs: number;
  /** Poll interval for the pickup-on-arrival wait. */
  pollMs?: number;
}

export interface ActionDiceQueueDrain {
  /** Run every queued batch in order and splice them out of `queue` (an empty queue is left untouched). */
  drain(queue: ActionDiceBatch[]): void;
  /** Cancel every pending pickup-on-arrival wait (teardown, seek, unmount). */
  cancelPickupWaits(): void;
  /** Test/inspection: pending pickup waits keyed by batch seq. */
  readonly pendingPickupSeqs: number[];
}

export function createActionDiceQueueDrain(deps: ActionDiceQueueDrainDeps): ActionDiceQueueDrain {
  const pollMs = deps.pollMs ?? 50;
  // Astra P2 (10-06): render order = publish order. Each batch's own wait (camera pan / pickup beat) differs, so an
  // off-camera batch (420 ms pan) followed by an on-camera one (0) rendered the NEWER die first. Every show is floored
  // at the previous show's time: effective wait = max(own wait, previous show - now). Equal waits keep order because
  // the lifecycle's timers fire in scheduling order. Reset with the pending waits (seek / teardown).
  let lastShowAt = Number.NEGATIVE_INFINITY;
  const cue = (rolls: readonly ActionDieRoll[], ownWait: number) => {
    const now = deps.now();
    const wait = Math.max(0, ownWait, lastShowAt - now);
    lastShowAt = now + wait;
    deps.lifecycle.onDiceCue(rolls, wait);
  };
  // seq -> pending pickup wait: with a queue, two pickup waits can overlap (one per batch). `showNow` flushes it.
  const pickupWaits = new Map<number, { timer: number; showNow: () => void }>();

  let lastSeq = Number.NEGATIVE_INFINITY;
  const runBatch = (batch: ActionDiceBatch) => {
    // A seq that did not advance means a reset the view never saw as null: the old presentation's floor is void.
    if (batch.seq <= lastSeq) lastShowAt = Number.NEGATIVE_INFINITY;
    lastSeq = batch.seq;
    // The seq restarts after a reset: a pending wait whose seq is not OLDER than this batch belongs to the presentation
    // before that reset (the view may never have seen the null in between) - cancel it, never let it share a key.
    for (const [pendingSeq, wait] of pickupWaits) {
      if (pendingSeq >= batch.seq) { deps.scheduler.clear(wait.timer); pickupWaits.delete(pendingSeq); }
    }
    // Owner 10-06: an OLDER pickup wait superseded by this batch shows NOW (at its ball square), before this batch, so
    // the dice keep their order and the pickup die is never lost. Only an epoch change / null teardown drops one.
    for (const [pendingSeq, wait] of [...pickupWaits]) {
      if (pendingSeq < batch.seq) { deps.scheduler.clear(wait.timer); wait.showNow(); }
    }
    const renderer = deps.renderer();
    if (!renderer) return;
    // Owner 2026-07-06 (event pacing): an OFF-camera roll nudges the camera first; the die shows once the pan arrives.
    const delay = batch.rolls[0] ? renderer.ensureOnCamera(batch.rolls[0].square) : 0;
    // Owner 10-05: a PICKUP die waits until the mover's token is drawn on the ball square (polled, fail-open cap).
    // Owner 10-06: superseded by a newer cue it shows at once instead of dropping; a seek / teardown still drops it.
    // Every other cause keeps its timing.
    const pickup = batch.rolls.find((r) => r.cause === 'pickup');
    const moverId = pickup ? deps.pickupMoverAt(pickup.square) : null;
    if (!pickup || !moverId) {
      const pickupBeat = pickup ? deps.pickupBeatMs() : 0; // mover unknown: the old fixed beat
      cue(batch.rolls, delay + pickupBeat);
      return;
    }
    const seq = batch.seq;
    const epoch = deps.lifecycle.epoch; // a seek / teardown advances it: the wait dies with its presentation
    const started = deps.now();
    const showNow = () => {
      pickupWaits.delete(seq);
      if (!deps.renderer() || deps.lifecycle.epoch !== epoch) return; // torn down
      cue(batch.rolls, 0); // still floored: never before the previous show
    };
    const showOnArrival = () => {
      pickupWaits.delete(seq);
      const live = deps.renderer();
      if (!live || deps.lifecycle.epoch !== epoch) return; // torn down
      if (deps.newestSeq() !== seq) { showNow(); return; } // superseded: show now, never drop
      if (!live.playerDrawnAt(moverId, pickup.square) && deps.now() - started < deps.arrivalCapMs) {
        pickupWaits.set(seq, { timer: deps.scheduler.set(showOnArrival, pollMs), showNow });
        return;
      }
      cue(batch.rolls, Math.max(0, delay - (deps.now() - started)));
    };
    showOnArrival();
  };

  return {
    drain(queue) {
      if (queue.length === 0) return;
      const batches = queue.splice(0, queue.length);
      for (const batch of batches) runBatch(batch);
    },
    cancelPickupWaits() {
      for (const wait of pickupWaits.values()) deps.scheduler.clear(wait.timer);
      pickupWaits.clear();
      lastShowAt = Number.NEGATIVE_INFINITY;
    },
    get pendingPickupSeqs() { return [...pickupWaits.keys()]; },
  };
}
