/**
 * Canonical teardown order for an intentional leave.
 *
 * This is data, rather than a second implementation of the teardown, so the
 * store and its ordering test consume the same sequence. Socket/session work
 * must finish before the rendered game is removed; reconnect intent and every
 * game-scoped transient are retired before the Hub can become visible.
 */
export const LEAVE_GAME_TEARDOWN_STEPS = [
  'disconnect',
  'forgetReconnect',
  'clearCinematics',
  'resetPresentation',
  'clearResidualState',
  'clearGame',
] as const;

export type LeaveGameTeardownStep = (typeof LEAVE_GAME_TEARDOWN_STEPS)[number];

/** Return a fresh, immutable-by-caller view of the production teardown order. */
export function leaveGameTeardownSteps(): readonly LeaveGameTeardownStep[] {
  return [...LEAVE_GAME_TEARDOWN_STEPS];
}
