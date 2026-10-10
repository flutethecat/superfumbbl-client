// Owner 10-06 (spec-dice-queue): the store publishes every action-dice batch onto `state.actionDiceQueue` as well as the
// single `state.actionDice` slot. Two batches landing in one tick (two serverModelSync frames from one socket drain, or a
// deferred gaze/fireball surface beside a fresh one) used to collapse into the last one under Vue's batched watcher, so
// the first die never rendered. The view now DRAINS the queue in order and runs the per-cue logic for each batch here:
// camera nudge, the pickup-on-arrival wait (keyed by that batch's seq; superseded -> shows at once), then onDiceCue. Pure so it is
// testable without mounting SpectateView.
import type { ActionDieRoll, LifecycleScheduler } from './actionDiceLifecycle';

/** Owner 10-10: the die causes of the server's pickUpRoll report: the ordinary pick-up and Secure the Ball (the same
 *  report with `secureTheBallUsed`, only the badge differs). Every pick-up rule keyed on the cause goes through here. */
export function isPickupDieCause(cause: string | undefined): boolean {
  return cause === 'pickup' || cause === 'secureTheBall';
}

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
  /** Owner 10-09 (a Dodge / Rush / Leap die waits for its mover as well): is that player's token still on its way -
   *  a confirmed step queued or on screen, or a tween in flight? While it is, the die keeps waiting (up to
   *  arrivalCapMs). Absent = never moving. */
  moverMoving?: (playerId: string) => boolean;
  /** Owner 10-09: batch `seq` is being shown, on screen in `msUntilShown` ms (camera pan / order floor). The store
   *  starts the die's read beat from this, not from an estimate. Not called for a batch that is dropped. */
  onShown?: (seq: number, msUntilShown: number) => void;
  /** The bounded fail-open of that wait once nothing is moving the token any more (one step + a margin): a token the
   *  renderer never brings onto the square cannot hold the die longer than this. */
  arrivalGraceMs?: () => number;
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
  const cue = (batch: ActionDiceBatch, ownWait: number) => {
    const now = deps.now();
    const wait = Math.max(0, ownWait, lastShowAt - now);
    lastShowAt = now + wait;
    deps.lifecycle.onDiceCue(batch.rolls, wait);
    deps.onShown?.(batch.seq, wait);
  };
  // seq -> pending pickup wait: with a queue, two pickup waits can overlap (one per batch). `showNow` flushes it.
  const pickupWaits = new Map<number, { timer: number; showNow: () => void; superseded?: (by: ActionDiceBatch) => void }>();

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
    // Astra review of ccc6bf1c5 (P2-2): a MOVEMENT die is not flushed like that - it is never shown on a square its
    // token has not reached. Superseded, it shows now only if the token is already there; a newer roll on the SAME
    // square (its reroll) replaces it; otherwise it keeps waiting for its own arrival (see `superseded` below).
    for (const [pendingSeq, wait] of [...pickupWaits]) {
      if (pendingSeq >= batch.seq) continue;
      if (wait.superseded) wait.superseded(batch);
      else { deps.scheduler.clear(wait.timer); wait.showNow(); }
    }
    const renderer = deps.renderer();
    if (!renderer) return;
    // Owner 2026-07-06 (event pacing): an OFF-camera roll nudges the camera first; the die shows once the pan arrives.
    const delay = batch.rolls[0] ? renderer.ensureOnCamera(batch.rolls[0].square) : 0;
    // Owner 10-05: a PICKUP die waits until the mover's token is drawn on the ball square (polled, fail-open cap).
    // Owner 10-06: superseded by a newer cue it shows at once instead of dropping; a seek / teardown still drops it.
    // Every other cause keeps its timing.
    // Owner 10-09: a movement roll's die (awaitsArrival: Dodge / Rush / Leap, FAILED or passed) waits the same way, so
    // the result is never announced on a square the figure has not reached. Its wait is bounded tighter than the
    // pickup's: it lasts only while the token is actually being moved (moverMoving), plus arrivalGraceMs.
    // Owner 10-10: a Secure the Ball roll is a pickUpRoll wearing its own badge cause - same wait, same beat.
    const ballPickup = batch.rolls.find((r) => isPickupDieCause(r.cause));
    const pickup = ballPickup ?? batch.rolls.find((r) => r.awaitsArrival);
    const moverId = pickup ? deps.pickupMoverAt(pickup.square) : null;
    if (!pickup || !moverId) {
      const pickupBeat = ballPickup ? deps.pickupBeatMs() : 0; // mover unknown: the old fixed beat
      cue(batch, delay + pickupBeat);
      return;
    }
    // A ball pickup keeps its plain cap. A movement die waits only while its token is still coming.
    const moverStillComing = (elapsed: number) => !!ballPickup || !!deps.moverMoving?.(moverId) || elapsed < (deps.arrivalGraceMs?.() ?? 0);
    const seq = batch.seq;
    const epoch = deps.lifecycle.epoch; // a seek / teardown advances it: the wait dies with its presentation
    const started = deps.now();
    const showNow = () => {
      pickupWaits.delete(seq);
      if (!deps.renderer() || deps.lifecycle.epoch !== epoch) return; // torn down
      cue(batch, 0); // still floored: never before the previous show
    };
    // A movement die that a newer batch overtakes (only a ball pickup is flushed at once).
    const superseded = ballPickup ? undefined : (by: ActionDiceBatch) => {
      const pending = pickupWaits.get(seq);
      const live = deps.renderer();
      if (!pending || !live || deps.lifecycle.epoch !== epoch) return;
      if (live.playerDrawnAt(moverId, pickup.square)) { deps.scheduler.clear(pending.timer); showNow(); return; } // arrived: in order, now
      if (by.rolls.some((r) => r.square[0] === pickup.square[0] && r.square[1] === pickup.square[1])) {
        deps.scheduler.clear(pending.timer); pickupWaits.delete(seq); // its own reroll is being shown there: that replaces it
      }
      // else: keep polling - it appears when (and only if) its token reaches the square
    };
    const showOnArrival = () => {
      pickupWaits.delete(seq);
      const live = deps.renderer();
      if (!live || deps.lifecycle.epoch !== epoch) return; // torn down
      if (ballPickup) {
        if (deps.newestSeq() !== seq) { showNow(); return; } // superseded: show now, never drop
      }
      if (!live.playerDrawnAt(moverId, pickup.square) && deps.now() - started < deps.arrivalCapMs) {
        if (moverStillComing(deps.now() - started)) {
          pickupWaits.set(seq, { timer: deps.scheduler.set(showOnArrival, pollMs), showNow, superseded });
          return;
        }
      }
      // A superseded movement die whose token never reached the square is dropped: late, on a square the figure is
      // not on, it would say nothing true. (Still the newest one, the bounded fail-open shows it as before.)
      if (!ballPickup && deps.newestSeq() !== seq && !live.playerDrawnAt(moverId, pickup.square)) return;
      cue(batch, Math.max(0, delay - (deps.now() - started)));
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
