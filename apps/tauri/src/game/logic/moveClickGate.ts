/**
 * Owner 09-27 ("the planner still accepts clicks during a move animation", live g1947538 on 1.0.25): the 09-23
 * click swallow sat in the renderer's legacy planner, which is OFF in order-66 play — live tile clicks run the
 * view's o66 route, which had no such hold. This is that hold, as a pure decision so it can be unit-tested.
 *
 * A click is dropped while the actor's confirmed move is still on screen. Wedge immunity: the hold FAILS OPEN when
 * the token has not moved for `stallMs` — a signal that never clears costs one short wait, never the activation.
 */
export const MOVE_CLICK_STALL_MS = 4000;

export interface MovementOnScreen {
  /** The actor's confirmed movement is still being presented (or the plan is still dripping its steps). */
  inFlight: boolean;
  /** Anything that changes while the token visibly advances (its rendered position). */
  progress: string;
}

export function createMoveClickGate(stallMs: number = MOVE_CLICK_STALL_MS) {
  let heldPlayer = '';
  let heldProgress = '';
  let heldSince = 0;
  return {
    /** true = drop this click. */
    swallow(playerId: string, seen: MovementOnScreen, now: number): boolean {
      if (!seen.inFlight) { heldPlayer = ''; return false; }
      if (playerId !== heldPlayer || seen.progress !== heldProgress) {
        heldPlayer = playerId; heldProgress = seen.progress; heldSince = now;
        return true;
      }
      return now - heldSince < stallMs;
    },
  };
}
