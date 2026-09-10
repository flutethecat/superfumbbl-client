export const SPECTATOR_PACING_FACTOR = 1.1; // owner 08-23: passive spectating 1.2→1.1

/**
 * `replay` is presentation-only just like `spectator`, but its command cadence is
 * already owned by ReplayAutoPlayer. It therefore uses the unscaled animation
 * bases so recorded deadlines are not taxed a second time.
 */
export type PresentationMode = 'live' | 'spectator' | 'replay';

let presentationMode: PresentationMode = 'live';

export function setPresentationMode(mode: PresentationMode): void {
  presentationMode = mode;
}

/**
 * Game-presentation beats scale. Input affordances, network/retry policy,
 * polling, cleanup, and fail-open safety stay fixed.
 */
export function presentationMs(base: number, spectatorTrim = 1): number {
  // spectatorTrim is retained for explicitly owner-tuned non-parity beats; live is always the untrimmed base.
  // Owner 09-06: BLOCK-rail parity sites use the default so their only spectator adjustment is the shared factor.
  return presentationMode === 'spectator'
    ? Math.round(base * SPECTATOR_PACING_FACTOR * spectatorTrim)
    : base;
}
