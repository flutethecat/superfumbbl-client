/** Presentation-only review after both coaches' final inducements become visible. */

export interface UnderdogRevealHoldEligibility {
  isPlaying: boolean;
  myRole: 'overdog' | 'underdog' | null;
  presetMode: boolean;
  bothConfirmed: boolean;
}

/** Both seated coaches get the same post-selection review hold. */
export function shouldHoldUnderdogInducementReveal(input: UnderdogRevealHoldEligibility): boolean {
  return input.isPlaying
    && input.myRole !== null
    && !input.presetMode
    && input.bothConfirmed;
}

/**
 * Keeps one immutable view snapshot visible until the shared authoritative setup
 * transition dismisses it. Later frames may enrich the snapshot (for example, a
 * second star arriving); a delayed frame after dismissal cannot reopen the pane.
 */
export class UnderdogInducementRevealHold<Snapshot> {
  private phaseKey: string | null = null;
  private active = false;

  constructor(private readonly publish: (snapshot: Snapshot | null) => void) {}

  present(phaseKey: string, snapshot: Snapshot): 'started' | 'updated' | 'ignored' {
    if (this.phaseKey === phaseKey) {
      if (!this.active) return 'ignored';
      this.publish(snapshot);
      return 'updated';
    }

    this.phaseKey = phaseKey;
    this.active = true;
    this.publish(snapshot);
    return 'started';
  }

  /** Seal this game's review at the authoritative setup boundary. */
  dismiss(phaseKey: string): void {
    this.phaseKey = phaseKey;
    this.active = false;
    this.publish(null);
  }

  reset(): void {
    this.phaseKey = null;
    this.active = false;
    this.publish(null);
  }

  dispose(): void {
    this.active = false;
    this.publish(null);
  }
}
