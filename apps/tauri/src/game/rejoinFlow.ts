/**
 * Owner 08-18: REJOIN from the Super FUMBBL play menu (CreateGameModal) failed SILENTLY — the
 * joinError / waitingForMatch overlays live inside SpectateView.vue, which only mounts once
 * gameStore.game is set, and a failed rejoin never sets game (App.vue keeps showing the Play
 * blade, looking as if the click did nothing). Same silent-death class as the 08-18 spectate
 * fix (App.vue spectateConnectError modal).
 *
 * This module wraps the EXISTING rejoin wire (gameStore.rejoinById → connectAsPlayer — no wire
 * changes) in a tracked attempt, and maps the store's already-reactive join signals into one
 * modal state so EVERY exit path of the flow lands somewhere visible:
 *   - a throw out of the connect call itself      → failed (launchError)
 *   - close before a game arrived                 → failed (store joinError)
 *   - join timeout / unreachable server           → failed (store joinError)
 *   - drop into auto-reconnect without a game     → failed w/ reconnecting note (connectionClosed)
 *   - join acked but the opponent absent          → waiting (store waitingForMatch)
 *   - gameState received                          → closed (the game view takes over)
 * The mapping is a pure function over a snapshot so each branch is unit-testable.
 */
import { reactive, watch } from 'vue';
import type { SessionState } from '@fumbbl40k/ffb-protocol';
import { gameStore } from './store';

export interface RejoinLaunch {
  gameId: number;
  coach: string;
  /** server ws url — shown as the connect-step target */
  url: string;
  opponent?: string;
  /** a throw/rejection out of rejoinById itself (pre-socket) — nothing else would surface it */
  launchError: string | null;
}

export type RejoinStepStatus = 'pending' | 'active' | 'done' | 'failed';
export interface RejoinStep {
  key: 'connect' | 'join' | 'game';
  label: string;
  status: RejoinStepStatus;
}

export type RejoinModalState =
  | { kind: 'closed' }
  | { kind: 'progress'; steps: RejoinStep[] }
  | { kind: 'waiting'; steps: RejoinStep[]; message: string }
  | { kind: 'failed'; steps: RejoinStep[]; message: string; detail: string | null };

/** The store signals the mapping reads — kept as a plain snapshot so tests need no store. */
export interface RejoinSnapshot {
  hasGame: boolean;
  sessionState: SessionState;
  joinError: string | null;
  waitingForMatch: boolean;
  /** state.connectionClosed when set (no-game case = drop straight into auto-reconnect) */
  connectionClosed: { code: number; reconnecting: boolean } | null;
}

export function shouldShowRejoinBrowser(browserRequested: boolean, sessionActive: boolean): boolean {
  return browserRequested && !sessionActive;
}

function hostOf(url: string): string {
  try { return new URL(url).host || url; } catch { return url; }
}

function baseSteps(launch: RejoinLaunch): RejoinStep[] {
  return [
    { key: 'connect', label: `Connecting to ${hostOf(launch.url)}…`, status: 'pending' },
    { key: 'join', label: `Joining game ${launch.gameId} as ${launch.coach}…`, status: 'pending' },
    { key: 'game', label: 'Waiting for the game state…', status: 'pending' },
  ];
}

/** done up to (exclusive) `activeIndex`, active there, pending after. */
function markProgress(steps: RejoinStep[], activeIndex: number): RejoinStep[] {
  return steps.map((s, i) => ({
    ...s,
    status: i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending',
  }));
}

/** the step the session died on: everything the session state completed stays done. */
function markFailedAt(steps: RejoinStep[], failIndex: number): RejoinStep[] {
  return steps.map((s, i) => ({
    ...s,
    status: i < failIndex ? 'done' : i === failIndex ? 'failed' : 'pending',
  }));
}

/** How far the socket demonstrably got, as an index into baseSteps. */
function reachedIndex(sessionState: SessionState): number {
  switch (sessionState) {
    case 'idle':
    case 'connecting':
    case 'closed': // a close leaves no evidence past the step already reached before it
      return 0;
    case 'versioning':
    case 'ready':
    case 'authenticating':
    case 'joining':
      return 1;
    case 'joined':
      return 2;
  }
}

/** Pure flow-state mapping: (tracked attempt, store snapshot) → what the modal shows. */
export function deriveRejoinModal(launch: RejoinLaunch | null, snap: RejoinSnapshot): RejoinModalState {
  if (!launch) return { kind: 'closed' };
  // Success: the game snapshot arrived — SpectateView mounts over the Play blade; modal gone.
  if (snap.hasGame) return { kind: 'closed' };
  const steps = baseSteps(launch);
  if (launch.launchError) {
    return {
      kind: 'failed',
      steps: markFailedAt(steps, 0),
      message: `Couldn't start the rejoin of game ${launch.gameId}.`,
      detail: launch.launchError,
    };
  }
  if (snap.joinError) {
    return {
      kind: 'failed',
      steps: markFailedAt(steps, reachedIndex(snap.sessionState)),
      message: snap.joinError,
      detail: null,
    };
  }
  if (snap.connectionClosed) {
    return {
      kind: 'failed',
      steps: markFailedAt(steps, reachedIndex(snap.sessionState)),
      message: `Connection closed (code ${snap.connectionClosed.code}) before the game loaded.`,
      detail: snap.connectionClosed.reconnecting ? 'Attempting to reconnect automatically…' : null,
    };
  }
  if (snap.waitingForMatch) {
    return {
      kind: 'waiting',
      steps: markProgress(steps, 2),
      message: launch.opponent
        ? `Joined — waiting for ${launch.opponent} to reconnect.`
        : 'Joined — waiting for the other coach to reconnect.',
    };
  }
  return { kind: 'progress', steps: markProgress(steps, reachedIndex(snap.sessionState)) };
}

/** Read the live store into the mapping's snapshot shape. */
export function storeRejoinSnapshot(): RejoinSnapshot {
  const closed = gameStore.state.connectionClosed;
  return {
    hasGame: !!gameStore.game.value,
    sessionState: gameStore.state.sessionState,
    joinError: gameStore.state.joinError,
    waitingForMatch: !!gameStore.state.waitingForMatch,
    connectionClosed: closed ? { code: closed.code, reconnecting: !!closed.reconnecting } : null,
  };
}

export const rejoinFlow = reactive<{ launch: RejoinLaunch | null }>({ launch: null });

// Success is TERMINAL: once the game snapshot arrives the attempt is over. Without this the
// launch survived the whole game — hasGame flipping false again (back to menu) re-derived the
// modal over the Play blade (owner 08-27: "auto connector stays loaded after returning to menu").
watch(() => gameStore.game.value, (game) => {
  if (game && rejoinFlow.launch) rejoinFlow.launch = null;
});

/** Start a tracked rejoin: same wire as before (rejoinById), plus a catch so an unexpected
 *  throw out of the flow lands in the modal instead of a voided rejected promise. */
export function startRejoin(params: {
  url: string; compression?: boolean; coach: string; password?: string;
  gameId: number; opponent?: string;
}): void {
  rejoinFlow.launch = {
    gameId: params.gameId, coach: params.coach, url: params.url,
    opponent: params.opponent, launchError: null,
  };
  const launch = rejoinFlow.launch;
  void (async () => {
    try {
      await gameStore.rejoinById({
        url: params.url, compression: params.compression,
        coach: params.coach, password: params.password, gameId: params.gameId,
      });
    } catch (error) {
      if (rejoinFlow.launch === launch) {
        launch.launchError = error instanceof Error ? error.message : String(error);
      }
    }
  })();
}

/** Close the modal. `cancel` also tears the pending session down (Cancel while in progress /
 *  waiting); a plain Close after a failure clears the store error so it can't leak elsewhere. */
export function dismissRejoin(opts?: { cancel?: boolean }): void {
  rejoinFlow.launch = null;
  if (opts?.cancel) gameStore.disconnect(); // also clears waitingForMatch + the join timer
  gameStore.state.joinError = null;
}
