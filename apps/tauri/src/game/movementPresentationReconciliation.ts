import { nextTick, watch, type WatchStopHandle } from 'vue';

export type MovementPresentationFence = {
  playerId: string;
  coordinate: [number, number] | null;
  occurrenceId: number;
  phase: 'failed' | 'resolved';
  expectedRttMs: number;
  seq: number;
};

export interface MovementPresentationReconciliationRenderer {
  reconcileMovementPresentation(fence: MovementPresentationFence): void;
}

export type MovementPresentationRecovery = {
  gameId: string;
  playerId: string;
  occurrenceId: number;
  expectedRttMs: number;
  seq: number;
};

export interface MovementPresentationRecoveryRenderer {
  reconcileMovementPresentationRecovery(recovery: MovementPresentationRecovery): void;
}

export type BoardPresentationFence = {
  players: { playerId: string; coordinate: [number, number] | null; playerState: number }[];
  expectedRttMs: number;
  seq: number;
};

export interface BoardPresentationReconciliationRenderer {
  reconcileBoardPresentation(fence: BoardPresentationFence): void;
}

/**
 * Deliver the server-coordinate fence after ordinary presentation/intent watchers in the same Vue flush. The
 * fence is the final word for that occurrence: it cannot be replaced by an older walk snapshot or local projection.
 */
export function watchMovementPresentationReconciliation(
  fence: () => MovementPresentationFence | null,
  renderer: () => MovementPresentationReconciliationRenderer | null,
  enabled: () => boolean = () => true,
): WatchStopHandle {
  return watch(
    () => fence()?.seq,
    () => {
      const current = fence();
      if (current && enabled()) renderer()?.reconcileMovementPresentation(current);
    },
    { flush: 'pre' },
  );
}

/** A walk-gate timeout can fire after the cursor has already become null. Consume its independent pulse only
 * after Vue's latest post-flush setGame pass, then make one bounded next-frame retry if renderer recovery throws. */
export function watchMovementPresentationRecovery(
  recovery: () => MovementPresentationRecovery | null,
  renderer: () => MovementPresentationRecoveryRenderer | null,
  enabled: () => boolean = () => true,
  diagnostic: (message: string, error: unknown) => void = (message, error) => console.warn(message, error),
): WatchStopHandle {
  return watch(
    () => recovery()?.seq,
    (_seq, _prior, onCleanup) => {
      let cancelled = false;
      let cancelRetry: (() => void) | null = null;
      onCleanup(() => {
        cancelled = true;
        cancelRetry?.();
      });
      void nextTick().then(() => {
        const current = recovery();
        if (cancelled || !current || !enabled()) return;
        const target = renderer();
        if (!target) return;
        try {
          target.reconcileMovementPresentationRecovery(current);
        } catch (error) {
          diagnostic(`movement presentation recovery ${current.seq} failed; retrying next frame`, error);
          const retry = () => {
            cancelRetry = null;
            if (cancelled || recovery()?.seq !== current.seq || !enabled()) return;
            try {
              renderer()?.reconcileMovementPresentationRecovery(current);
            } catch (retryError) {
              diagnostic(`movement presentation recovery ${current.seq} retry failed`, retryError);
            }
          };
          if (typeof requestAnimationFrame === 'function') {
            const frame = requestAnimationFrame(retry);
            cancelRetry = () => cancelAnimationFrame(frame);
          } else {
            const timer = setTimeout(retry, 0);
            cancelRetry = () => clearTimeout(timer);
          }
        }
      });
    },
    { flush: 'post' },
  );
}

/** Board recovery uses the same pre-flush capture / post-flush setGame contract. It is presentation-only and is
 * disabled during historical replay catch-up, where snapReplayFrame owns exact model placement. */
export function watchBoardPresentationReconciliation(
  fence: () => BoardPresentationFence | null,
  renderer: () => BoardPresentationReconciliationRenderer | null,
  enabled: () => boolean = () => true,
): WatchStopHandle {
  return watch(
    () => fence()?.seq,
    () => {
      const current = fence();
      if (current && enabled()) renderer()?.reconcileBoardPresentation(current);
    },
    { flush: 'pre' },
  );
}
