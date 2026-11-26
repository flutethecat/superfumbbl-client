import { watch, type WatchStopHandle } from 'vue';

/** The slice of a store square pick this watcher reads. */
export interface FireballPickLike {
  kind: string;
  skill?: string;
  seq: number;
}

/** The renderer's pointer hover feed while the Fireball square is chosen (renderer.onHoverSquare, SpectateView). It is
 *  the POINTER's feed (mouse, pen, pad crosshair): its null is a pointer hover-clear, and the store clears only a
 *  preview a pointer made (Fireball round 4: a touch tap's preview survives a resting mouse's hover teardown). */
export function createFireballHoverHandler(opts: {
  pick: () => FireballPickLike | null | undefined;
  preview: (square: [number, number] | null, source: 'pointer') => unknown;
}): (coord: [number, number] | null) => void {
  return (coord) => {
    const sp = opts.pick();
    if (sp?.kind !== 'wizard' || sp.skill !== 'Fireball') return;
    opts.preview(coord, 'pointer');
  };
}

/**
 * Release review (Sol, P2): a mouse pointer or pad crosshair already parked on the pitch when the Fireball pick arms
 * previews its square at once (the renderer reports a hover only on a CHANGE of square, and a cast needs the preview of
 * that square). Fireball round 3 (Sol): this runs ONLY when the Fireball pick itself arms or re-arms, never when the
 * preview changes, and a parked pointer that is on no square (touch: there is no hover) leaves the preview alone - the
 * earlier watcher also ran on every preview change and fed the renderer's empty hover back in, which erased each touch
 * preview the moment it was drawn. SpectateView installs exactly this watcher.
 */
export function watchFireballPickSeed(opts: {
  pick: () => FireballPickLike | null | undefined;
  hovered: () => [number, number] | null;
  preview: (square: [number, number]) => void;
}): WatchStopHandle {
  return watch(
    () => {
      const sp = opts.pick();
      return sp?.kind === 'wizard' && sp.skill === 'Fireball' ? sp.seq : null;
    },
    (seq) => {
      if (seq == null) return;
      const at = opts.hovered();
      if (at) opts.preview(at);
    },
    { immediate: true },
  );
}
