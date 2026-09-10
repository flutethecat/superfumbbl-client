/**
 * Spike Trophy-inspired cursor theme.
 *
 * Both images share the same 64x64 canvas and 12,8 hotspot. Keeping the
 * hotspot fixed prevents the pointer from jumping when a target becomes
 * clickable and the gold action rays appear.
 */
export const SPIKE_CURSOR_HOTSPOT = { x: 12, y: 8 } as const;

const spikeGauntletUrl = new URL('../assets/cursors/spike-gauntlet.png', import.meta.url).href;
const spikeGauntletPrimedUrl = new URL('../assets/cursors/spike-gauntlet-primed.png', import.meta.url).href;

function cursor(url: string, fallback: 'default' | 'pointer'): string {
  return `url("${url}") ${SPIKE_CURSOR_HOTSPOT.x} ${SPIKE_CURSOR_HOTSPOT.y}, ${fallback}`;
}

/** Resting cursor used over non-interactive client and pitch surfaces. */
export const SPIKE_CURSOR = cursor(spikeGauntletUrl, 'default');

/** Gold-rayed cursor used when the current surface will accept a click. */
export const SPIKE_CURSOR_PRIMED = cursor(spikeGauntletPrimedUrl, 'pointer');
