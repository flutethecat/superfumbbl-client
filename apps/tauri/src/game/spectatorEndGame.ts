/**
 * Spectate-seat end-game exit rail (owner 08-19).
 *
 * The spectate seat's end-of-game surface has three model-keyed facts (no timers):
 * - MVP-PENDING: the server hasn't delivered the Statistics & MVP data yet
 *   (endGame.finalPresentationReady is the arrival transition) — show the
 *   "Players are selecting MVP" placeholder where that panel will land.
 * - EXIT ACTIONS: Return to Menu / Spectate Another Game appear with the MVP
 *   stage and REMAIN once the final panel lands (persistent, never withdrawn).
 * - EXIT PLAN: both exits ride the confirm-free leave-game path (the game is
 *   over — nothing to concede) and land in the BLADE shell. browserOpen stays
 *   false: the legacy in-game browser overlay is deprecated as an endgame
 *   target (owner 08-19 — it popped over the end screen from the old
 *   Play Game / Spectate Game pair).
 */
import type { EndGamePhase } from './endGameHandler';

export type EndGameSeat = 'spectate' | 'play' | 'replay';

/** Phases from MVP selection onward (endGameHandler's ordered phase rail). */
const MVP_OR_LATER: ReadonlySet<EndGamePhase> = new Set<EndGamePhase>([
  'mvp', 'winnings', 'dedicatedFans', 'playerLoss', 'statistics', 'complete',
]);

export interface SpectatorEndGameInput {
  seat: EndGameSeat;
  phase: EndGamePhase;
  finalPresentationReady: boolean;
  /** store state.endGameSettled — the existing settle/cap beat before the final panel shows. */
  endGameSettled: boolean;
}

/**
 * MVP-pending placeholder: spectate seat only, from the MVP stage until the
 * final panel is actually presentable (finalPresentationReady AND settled — the
 * settle beat is covered so the surface never flickers between pending and final).
 */
export function spectatorMvpPending(input: SpectatorEndGameInput): boolean {
  return input.seat === 'spectate'
    && MVP_OR_LATER.has(input.phase)
    && !(input.finalPresentationReady && input.endGameSettled);
}

/** The persistent exit pair: up from the MVP stage onward, never withdrawn. */
export function spectatorExitActionsVisible(input: SpectatorEndGameInput): boolean {
  return input.seat === 'spectate' && MVP_OR_LATER.has(input.phase);
}

export type EndGameExit = 'menu' | 'browser';

export interface EndGameExitPlan {
  /** Always the confirm-free teardown — requestLeaveGame's prompt is for LIVE games. */
  leaveGame: true;
  /** Blade to land on: menu → the Play-blade home, browser → the Spectate blade (SpectateBrowserView). */
  view: 'play' | 'spectate';
  /** Never re-open the legacy in-game browser overlay (deprecated endgame target). */
  browserOpen: false;
}

export function endGameExitPlan(exit: EndGameExit): EndGameExitPlan {
  return { leaveGame: true, view: exit === 'browser' ? 'spectate' : 'play', browserOpen: false };
}
