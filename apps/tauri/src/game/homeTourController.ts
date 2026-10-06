/**
 * Owner 2026-10-06: the Home pane walkthrough - glue between the pure step model (homeTour.ts) and the shell.
 *
 * FumbblHomePane.vue is its only user.
 */
import {
  parseTourEvent,
  startTour,
  tourCall,
  tourReduce,
  type TourEffect,
  type TourInput,
  type TourState,
} from './homeTour';

export interface TourHost {
  invoke(command: 'fumbbl_home_tour' | 'fumbbl_home_navigate', args: Record<string, unknown>): Promise<unknown>;
  /** The site walkthrough finished: the client walkthrough takes over (App.vue gates it on homeTourSeenVersion). */
  handoff?(): void;
  /** Persist homeTourSeenVersion = HOME_TOUR_VERSION (completed or skipped). */
  markSeen(): Promise<void>;
  log(message: string): void;
  /** Injected for tests. */
  delay?(ms: number): Promise<void>;
}

const NAVIGATE_RETRY_MS = 800;

export interface TourController {
  start(fallbackCoach: string): Promise<void>;
  pageLoad(payload: unknown): Promise<void>;
  siteEvent(payload: unknown): Promise<void>;
  /** A tour is between start and done/skip. */
  running(): boolean;
  /** The pane is going away: forget the tour (the caller clears the site overlay). */
  stop(): void;
}

export function createTourController(host: TourHost): TourController {
  let state: TourState | null = null;
  /** start() was called and its transition has not run yet (running() must already say yes). */
  let starting = false;
  let chain: Promise<void> = Promise.resolve();
  /** Bumped by stop(): a transition in flight checks it after every await and abandons its remaining effects. */
  let generation = 0;
  const delay = host.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function call(command: 'fumbbl_home_tour' | 'fumbbl_home_navigate', args: Record<string, unknown>): Promise<boolean> {
    try {
      await host.invoke(command, args);
      return true;
    } catch (error) {
      host.log(`[home-tour] ${command} failed: ${String(error)}`);
      return false;
    }
  }

  async function run(effects: TourEffect[], gen: number): Promise<void> {
    for (const effect of effects) {
      if (gen !== generation) return;
      switch (effect.kind) {
        case 'arm':
          await call('fumbbl_home_tour', { call: tourCall('arm') });
          break;
        case 'navigate':
          // The webview can still be on its boot page right after creation: one retry.
          if (!(await call('fumbbl_home_navigate', { url: effect.url }))) {
            await delay(NAVIGATE_RETRY_MS);
            if (gen !== generation) return; // stopped while waiting: no retry
            await call('fumbbl_home_navigate', { url: effect.url });
          }
          break;
        case 'show':
          await call('fumbbl_home_tour', { call: tourCall('show', effect.payload) });
          break;
        case 'clear':
          await call('fumbbl_home_tour', { call: tourCall('clear') });
          break;
        case 'handoff':
          host.handoff?.();
          break;
        case 'seen':
          try {
            await host.markSeen();
          } catch (error) {
            host.log(`[home-tour] could not save the walkthrough as seen: ${String(error)}`);
          }
          break;
        case 'log':
          host.log(`[home-tour] ${effect.message}`);
          break;
      }
    }
  }

  /** Inputs are applied one at a time, in arrival order (each one's shell calls finish before the next is reduced). */
  function enqueue(input: TourInput | 'start', fallbackCoach = ''): Promise<void> {
    const gen = generation;
    chain = chain.then(async () => {
      if (gen !== generation) return; // queued before a stop()
      if (input === 'start') starting = false;
      const result = input === 'start' ? startTour(fallbackCoach) : tourReduce(state, input);
      state = result.state;
      await run(result.effects, gen);
    }).catch((error) => host.log(`[home-tour] ${String(error)}`));
    return chain;
  }

  return {
    start(fallbackCoach) {
      starting = true;
      return enqueue('start', fallbackCoach);
    },
    pageLoad(payload) {
      const p = (payload ?? {}) as { url?: unknown; loggedIn?: unknown; coach?: unknown };
      return enqueue({
        type: 'page-load',
        url: typeof p.url === 'string' ? p.url : '',
        loggedIn: p.loggedIn === true,
        coach: typeof p.coach === 'string' ? p.coach : '',
      });
    },
    siteEvent(payload) {
      const raw = (payload ?? {}) as { event?: unknown };
      const event = typeof raw.event === 'string' ? parseTourEvent(raw.event) : null;
      if (!event) return Promise.resolve();
      return enqueue({ type: 'event', event });
    },
    running: () => starting || (state !== null && state.step !== 'done'),
    stop() {
      generation += 1;
      starting = false;
      state = null;
    },
  };
}
