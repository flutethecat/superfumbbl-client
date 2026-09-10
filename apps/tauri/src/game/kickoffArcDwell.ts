import { watch, type WatchStopHandle } from 'vue';

const INTERACTIVE_KICKOFF_EVENTS = new Set([
  'soliddefence',
  'soliddefense',
  'perfectdefence',
  'perfectdefense',
  'highkick',
  'quicksnap',
  'charge',
  'blitz',
]);

/**
 * Kick-off events in this set open a server-owned coach mini-phase after the
 * result card. Those are the only results that should keep the ball waiting at
 * the apex; ordinary resolved events can descend as soon as the fly-in ends.
 */
export function kickoffArcNeedsDecisionDwell(eventName: unknown): boolean {
  const key = String(eventName ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return INTERACTIVE_KICKOFF_EVENTS.has(key);
}

export interface KickoffArcDecisionDwellBridge {
  needsDecisionDwell(): boolean;
  arcActive(): boolean;
  catchingUp(): boolean;
  mayHold(): boolean;
  hold(ms: number): void;
  dwellMs: number;
}

/**
 * The kick aim normally arrives before the authoritative kick-off result. Bridge
 * that later false -> true decision edge into the already-armed renderer while
 * the ball is still waiting to descend. The aim watcher covers the inverse
 * ordering (result before aim), so neither wire ordering loses the mini-phase
 * dwell and resolved events never acquire one.
 */
export function watchKickoffArcDecisionDwell(
  bridge: KickoffArcDecisionDwellBridge,
): WatchStopHandle {
  return watch(
    bridge.needsDecisionDwell,
    (needsDecisionDwell, previous) => {
      if (!needsDecisionDwell || previous === true
          || !bridge.arcActive() || bridge.catchingUp() || !bridge.mayHold()) return;
      bridge.hold(bridge.dwellMs);
    },
    { flush: 'sync' },
  );
}
