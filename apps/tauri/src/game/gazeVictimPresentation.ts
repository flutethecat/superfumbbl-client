import { watch } from 'vue';

export interface GazeVictimPresentationRenderer {
  setGazeVictims(ids: string[]): void;
}

/**
 * Keep the renderer's report-authoritative Hypnotic Gaze victim set in sync.
 * `publish()` is intentionally exposed for the renderer-construction seam: views
 * call it after init and before their first setGame, while the watcher owns later
 * authoritative updates and clears.
 */
export function installGazeVictimPresentation(
  readVictims: () => readonly string[] | null | undefined,
  readRenderer: () => GazeVictimPresentationRenderer | null,
): { publish: () => void } {
  const publish = () => {
    const renderer = readRenderer();
    if (renderer) renderer.setGazeVictims([...(readVictims() ?? [])]);
  };
  watch(readVictims, publish, { deep: true });
  return { publish };
}
