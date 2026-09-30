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
  /** S44 (owner 09-29): the same window also tracks every OFFICIAL FUMBBL join (password lobby, JNLP, rejoin).
   *  'rejoin' (default) keeps the fork wording; 'join' says "Joining"/"Join failed". */
  action?: 'join' | 'rejoin';
  /** step label for a join by game name (gameId 0) */
  gameLabel?: string;
  /** one plain line for the coach while the attempt runs (e.g. the stored coach name was corrected up front) */
  notice?: string | null;
  /** the server's own refusal (SERVER_STATUS), set by the official join path — nothing else marks a recoverable one */
  refusal?: { status: string; message: string } | null;
  /** S44 point 8: set only after a Not Your Team refusal found the exact spelling; the ONE "Try again" click */
  correction?: { text: string; retry: (() => void) | null } | null;
  /** official join with no stored password: a refused/closed attempt needs a fresh JNLP */
  jnlpNeeded?: boolean;
  /** S44 round 2: asked when the window fails — a one-click password join by id when a usable rejoin target and a stored
   *  password exist (e.g. a drop after the server accepted us, before the game state), else null */
  tryAgain?: (() => (() => void) | null) | null;
  /** furthest step index the socket demonstrably reached (set by the official join path; a close leaves no evidence) */
  reachedStep?: number;
}

/** The single "Try again" action of a failed window, if any: the corrected-name retry first, else the target rejoin. */
export function retryFor(launch: RejoinLaunch | null): (() => void) | null {
  if (!launch) return null;
  if (launch.correction) return launch.correction.retry;
  // a Not Your Team refusal repeated with the very same name cannot succeed: no retry without a correction
  if (launch.refusal && isNotYourTeamStatus(launch.refusal.status)) return null;
  return launch.tryAgain?.() ?? null;
}

export type RejoinStepStatus = 'pending' | 'active' | 'done' | 'failed';
export interface RejoinStep {
  key: 'connect' | 'join' | 'game';
  label: string;
  status: RejoinStepStatus;
}

export type RejoinModalState =
  | { kind: 'closed' }
  | { kind: 'progress'; title: string; steps: RejoinStep[]; notes: string[] }
  | { kind: 'waiting'; title: string; steps: RejoinStep[]; message: string; notes: string[] }
  | {
    kind: 'failed'; title: string; steps: RejoinStep[]; message: string; detail: string | null; notes: string[];
    /** true when a "Try again" button is offered (S44 point 8) */
    canRetry: boolean;
  };

/** The server status name for a refused team ownership check, in either spelling (`ERROR_NOT_YOUR_TEAM` / "Not Your Team"). */
export function isNotYourTeamStatus(status: unknown): boolean {
  const key = String(status ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return key === 'notyourteam' || key === 'errornotyourteam';
}

function titleFor(launch: RejoinLaunch, kind: 'progress' | 'waiting' | 'failed'): string {
  const join = launch.action === 'join';
  if (kind === 'failed') return join ? 'Join failed' : 'Rejoin failed';
  if (kind === 'waiting') return join ? 'Joined — waiting' : 'Rejoined — waiting';
  return join ? 'Joining your game' : 'Rejoining your game';
}

/** Plain lines under the steps: the up-front notice, the point-8 correction text, and what was sent on Not Your Team. */
function notesFor(launch: RejoinLaunch, failed: boolean): string[] {
  const notes: string[] = [];
  if (launch.notice) notes.push(launch.notice);
  if (failed && launch.correction) notes.push(launch.correction.text);
  if (failed && launch.jnlpNeeded) notes.push('No FUMBBL password is saved, so this game needs a fresh JNLP. Use Open JNLP on the Play page.');
  if (failed && launch.refusal && isNotYourTeamStatus(launch.refusal.status)) {
    notes.push(`The coach name sent was '${launch.coach}'. The server compares it letter for letter.`);
  }
  return notes;
}

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
    { key: 'join', label: `Joining ${launch.gameLabel ?? `game ${launch.gameId}`} as ${launch.coach}…`, status: 'pending' },
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
  const failed = (failIndex: number, message: string, detail: string | null): RejoinModalState => ({
    kind: 'failed',
    title: titleFor(launch, 'failed'),
    steps: markFailedAt(steps, failIndex),
    message,
    detail,
    notes: notesFor(launch, true),
    canRetry: !!retryFor(launch),
  });
  if (launch.launchError) {
    return failed(0, `Couldn't start the ${launch.action === 'join' ? 'join' : 'rejoin'} of ${launch.gameLabel ?? `game ${launch.gameId}`}.`, launch.launchError);
  }
  // the server's own words, whatever else the store made of the close that followed
  if (launch.refusal) {
    return failed(Math.max(reachedIndex(snap.sessionState), launch.reachedStep ?? 0), launch.refusal.message || launch.refusal.status, null);
  }
  if (snap.joinError) {
    return failed(Math.max(reachedIndex(snap.sessionState), launch.reachedStep ?? 0), snap.joinError, null);
  }
  if (snap.connectionClosed) {
    return failed(
      Math.max(reachedIndex(snap.sessionState), launch.reachedStep ?? 0),
      `Connection closed (code ${snap.connectionClosed.code}) before the game loaded.`,
      snap.connectionClosed.reconnecting ? 'Attempting to reconnect automatically…' : null,
    );
  }
  // an official join raises the waiting notice as soon as it starts; "joined — waiting" is only true once the server accepted us
  if (snap.waitingForMatch && snap.sessionState === 'joined') {
    return {
      kind: 'waiting',
      title: titleFor(launch, 'waiting'),
      steps: markProgress(steps, 2),
      message: launch.opponent
        ? `Joined — waiting for ${launch.opponent} to reconnect.`
        : 'Joined — waiting for the other coach to reconnect.',
      notes: notesFor(launch, false),
    };
  }
  return { kind: 'progress', title: titleFor(launch, 'progress'), steps: markProgress(steps, Math.max(reachedIndex(snap.sessionState), launch.reachedStep ?? 0)), notes: notesFor(launch, false) };
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

/** S44: track one OFFICIAL FUMBBL join attempt in the same window (password lobby, JNLP or rejoin). Returns the live
 *  (reactive) launch so the join path can attach a refusal or a correction to it. */
export function trackOfficialJoin(launch: RejoinLaunch): RejoinLaunch {
  rejoinFlow.launch = { action: 'join', ...launch };
  return rejoinFlow.launch;
}

/** S44 point 8: the ONE "Try again" click after a corrected Not Your Team refusal. Never called by the client itself. */
export function retryOfficialJoin(): void {
  const retry = retryFor(rejoinFlow.launch);
  if (!retry) return;
  rejoinFlow.launch = null;
  gameStore.state.joinError = null;
  retry();
}

/** Close the modal. `cancel` also tears the pending session down (Cancel while in progress /
 *  waiting); a plain Close after a failure clears the store error so it can't leak elsewhere. */
export function dismissRejoin(opts?: { cancel?: boolean }): void {
  rejoinFlow.launch = null;
  if (opts?.cancel) gameStore.disconnect(); // also clears waitingForMatch + the join timer
  gameStore.state.joinError = null;
}
