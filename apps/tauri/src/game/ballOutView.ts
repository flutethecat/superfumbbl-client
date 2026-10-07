import { watch, type WatchStopHandle } from 'vue';

/** Owner 10-07: the Modern view's half of the ball-out cue (kept out of SpectateView.vue so it is testable). */
export interface BallOutCueView {
  path: [number, number][];
  exit: [number, number] | null;
  label: string;
  delayMs: number;
  seq: number;
}
export interface BallOutRendererLike {
  playBallOut(cue: { path: [number, number][]; exit: [number, number] | null; label: string; delayMs?: number }): void;
}

/** Plays every new ball-out cue (by seq) on the renderer. Default ('pre') flush, like the scatter cue it may follow. */
export function bindBallOutCue(cue: () => BallOutCueView | null, renderer: () => BallOutRendererLike | null | undefined): WatchStopHandle {
  return watch(
    () => cue()?.seq,
    () => {
      const current = cue();
      const target = renderer();
      if (current && target) target.playBallOut({ path: current.path, exit: current.exit, label: current.label, delayMs: current.delayMs });
    },
  );
}

/** Modern skips the legacy loose-ball scatter cue a ball-out emits for Classic (playBallOut draws that hop). */
export function modernScatterCue<T extends { ballOutOwned?: boolean }>(cue: T | null | undefined): T | null {
  return cue && !cue.ballOutOwned ? cue : null;
}

/** Modern flies a throw-in from where the ball came to rest in the stands; Classic keeps the server square. */
export function modernThrowOrigin(cue: { from: [number, number]; fromPoint?: [number, number] }): [number, number] {
  return cue.fromPoint ?? cue.from;
}
