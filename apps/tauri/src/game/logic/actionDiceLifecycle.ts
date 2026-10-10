// Owner 09-28 (Spec S7 v3): the SpectateView dice/turnover WIRING decisions, extracted into a pure controller so the
// store -> view -> renderer contract is testable without mounting the 13k-line .vue. The view instantiates one of these
// and forwards raw events (a dice cue arriving with its computed camera/pickup wait, a turnover object transitioning,
// a live catch-up / reset nulling the dice, a seek). The controller OWNS the deferred-show timers and the presentation
// epoch, re-validates the opponent-reroll hold against the live dialog at show time, and carries each die's staged turn
// key through to the renderer for occurrence-correlated teardown.
import { opponentRerollHoldAtShow } from './opponentRerollHold';

/** One staged action-die roll (a subset of the store's `state.actionDice.rolls` element). */
export interface ActionDieRoll {
  square: [number, number];
  value: number;
  cause?: string;
  failed?: boolean;
  needed?: number;
  rerollSkill?: string;
  rerollTeam?: boolean;
  opponentRerollPending?: boolean;
  /** Owner 10-05: the ROLLING coach's own failed roll while their reroll offer is open (same hold, own seat). */
  rerollOfferPending?: boolean;
  /** Owner 10-09: a movement roll's die (Dodge / Rush / Leap, first roll) belongs to the square the mover is entering:
   *  it is shown when the mover's token has arrived there (actionDiceQueueDrain), not while it is still walking in. */
  awaitsArrival?: boolean;
}

/** The turnover splash object the store publishes (subset of `state.turnover`). */
export interface TurnoverSplash { seq: number }

/** The renderer surface the lifecycle drives (a subset of PitchRenderer). */
export interface ActionDiceRenderer {
  showActionDie(square: [number, number], value: number, cause?: string, failed?: boolean, needed?: number,
    rerollSkill?: string, rerollTeam?: boolean, opponentRerollPending?: boolean, rerollOfferPending?: boolean): void;
  releaseDiceAtTurnover(): void;
  clearActionDice(): void;
  setTurnoverSplashShowing(showing: boolean): void;
  settleWalkersAfterTurnover(): void;
}

/** setTimeout / clearTimeout, injectable for tests. */
export interface LifecycleScheduler { set(fn: () => void, ms: number): number; clear(id: number): void; }

export interface ActionDiceLifecycleDeps {
  /** The live renderer (null before mount / after teardown). */
  renderer: () => ActionDiceRenderer | null;
  scheduler: LifecycleScheduler;
  /** The CURRENT server dialog id, read synchronously at show time (re-validates the opponent hold). */
  currentDialogId: () => unknown;
  /** True while fast-forwarding to the live tail (suppresses the walker settle). */
  catchingUp: () => boolean;
}

export interface ActionDiceLifecycle {
  /** A dice cue arrived; `wait` is the view-computed camera-pan + pickup-beat delay (0 = show now). */
  onDiceCue(rolls: readonly ActionDieRoll[], wait: number): void;
  /** `state.actionDice` went null (live catch-up / reset): tear the dice down and neuter pending shows. */
  onDiceCleared(): void;
  /** `state.turnover` transitioned; feeds splash-showing, settles walkers on start, releases every die on end. */
  onTurnover(turnover: TurnoverSplash | null | undefined, prev: TurnoverSplash | null | undefined): void;
  /** Seek / match-presentation cancel: advance the epoch and cancel pending shows (no dice clear here). */
  cancelPending(): void;
  /** Seed the renderer's splash-showing flag on mount. */
  seedSplashShowing(showing: boolean): void;
  /** Test/inspection. */
  readonly epoch: number;
  readonly pendingCount: number;
}

export function createActionDiceLifecycle(deps: ActionDiceLifecycleDeps): ActionDiceLifecycle {
  let epoch = 0;
  const timers = new Set<number>();
  const cancelTimers = () => { for (const id of timers) deps.scheduler.clear(id); timers.clear(); };

  const showBatch = (rolls: readonly ActionDieRoll[], expectedEpoch: number) => {
    if (expectedEpoch !== epoch) return; // a stale deferred show is a no-op after a teardown / seek
    const renderer = deps.renderer();
    if (!renderer) return;
    const dialogId = deps.currentDialogId();
    for (const roll of rolls) {
      const opponentRerollPending = opponentRerollHoldAtShow(roll.opponentRerollPending, dialogId);
      // the same re-validation for the rolling coach's own offer: a deferred show after the offer closed takes no hold
      const rerollOfferPending = opponentRerollHoldAtShow(roll.rerollOfferPending, dialogId);
      renderer.showActionDie(roll.square, roll.value, roll.cause, roll.failed, roll.needed,
        roll.rerollSkill, roll.rerollTeam, opponentRerollPending, rerollOfferPending);
    }
  };

  return {
    onDiceCue(rolls, wait) {
      if (!deps.renderer()) return;
      const expectedEpoch = epoch;
      if (wait > 0) {
        const id = deps.scheduler.set(() => { timers.delete(id); showBatch(rolls, expectedEpoch); }, wait);
        timers.add(id);
      } else {
        showBatch(rolls, expectedEpoch);
      }
    },
    onDiceCleared() {
      epoch++; // neuter any pending deferred show so a stale closure cannot recreate a die after the teardown
      cancelTimers();
      deps.renderer()?.clearActionDice();
    },
    onTurnover(turnover, prev) {
      const renderer = deps.renderer();
      if (!renderer) return;
      const showing = !!turnover;
      renderer.setTurnoverSplashShowing(showing);
      if (showing && !prev && !deps.catchingUp()) renderer.settleWalkersAfterTurnover();
      if (!showing && prev) renderer.releaseDiceAtTurnover();
    },
    cancelPending() {
      epoch++;
      cancelTimers();
    },
    seedSplashShowing(showing) {
      deps.renderer()?.setTurnoverSplashShowing(showing);
    },
    get epoch() { return epoch; },
    get pendingCount() { return timers.size; },
  };
}
