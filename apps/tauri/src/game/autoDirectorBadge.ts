/** Owner 10-30: the Auto Director badge under the scoreboard. It shows while Settings' Auto Director is on and dims
 *  ("Auto Director paused") while the camera director is held off. Presentation-only; nothing reaches the server. */

export interface AutoDirectorBadgeInputs {
  /** settings.autoDirector. */
  enabled: boolean;
  /** The spectator review is paused or seeking (the view's spectatorDirectorSuspended). */
  reviewSuspended: boolean;
  /** Live playback is catching up (gameStore.playbackCatchingUp). */
  catchingUp: boolean;
  /** The renderer's manual camera hold: the 1.5 s manual-input hold, drag, multitouch, keyboard/stick panning,
   *  residual pan velocity, or the pad crosshair. Cinematic / kick-off camera ownership is NOT a manual hold - that
   *  is still automatic camera work and leaves the badge bright. */
  manualHold: boolean;
}

export interface AutoDirectorBadgeState {
  shown: boolean;
  paused: boolean;
}

export function autoDirectorBadgeState(inputs: AutoDirectorBadgeInputs): AutoDirectorBadgeState {
  if (!inputs.enabled) return { shown: false, paused: false };
  return { shown: true, paused: inputs.reviewSuspended || inputs.catchingUp || inputs.manualHold };
}

/** The slice of PitchRenderer the badge reads. */
export interface AutoDirectorManualHoldSource {
  onAutoDirectorManualHoldChange: ((held: boolean) => void) | null;
  /** The state as last raised through the hook (keeps a late-bound sink in step with the renderer's edges). */
  readonly autoDirectorManualHeld: boolean;
}

/** Mirrors the renderer's edge-triggered manual hold into `sink` (no polling): seeds it from the last reported state, then
 *  follows the renderer's hook. Returns an unbind that clears the hook and resets the sink. */
export function bindAutoDirectorManualHold(source: AutoDirectorManualHoldSource, sink: { value: boolean }): () => void {
  const listener = (held: boolean) => { sink.value = held; };
  source.onAutoDirectorManualHoldChange = listener;
  sink.value = source.autoDirectorManualHeld;
  return () => {
    if (source.onAutoDirectorManualHoldChange === listener) source.onAutoDirectorManualHoldChange = null;
    sink.value = false;
  };
}
