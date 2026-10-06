/**
 * Owner 2026-10-06: the client walkthrough's glue between the pure step model (clientTour.ts) and the app (a host API
 * App.vue provides: blades, Settings, the Play blade's Details popup). Public-edition code: no pane dependency.
 */
import { ref, type Ref } from 'vue';
import type { SettingsTab } from './settingsDialog';
import {
  clientTourReduce,
  startClientTour,
  type BladeId,
  type ClientTourEffect,
  type ClientTourInput,
  type ClientTourState,
} from './clientTour';

export interface ClientTourHost {
  /** The build has the FUMBBL.COM blade (its blade can be selected / pointed at). */
  hasPane: boolean;
  selectBlade(blade: BladeId): void;
  openSettings(tab: SettingsTab): void;
  selectSettingsTab(tab: SettingsTab): void;
  /** Close Settings through the Settings transaction (cancelSettingsChanges: unsaved edits are reverted). False = it
   *  could not close (the transaction is busy): the tour then stays where it was. */
  closeSettings(): Promise<boolean>;
  /** Open the Play blade's Details popup on the first stored game, else the bundled example. */
  openDetails(): Promise<'real' | 'example' | 'none'>;
  /** Its Dice tab; false when the popup is not up. */
  openDice(): boolean;
  closeDetails(): void;
  /** The HUD steps: load the bundled demo game (resolves once the match view can be driven) / leave it. */
  loadDemo(): Promise<boolean>;
  leaveDemo(): void;
  showLog(): void;
  openLogSettings(): void;
  closeLogSettings(): void;
  openRoster(): void;
  closeRoster(): void;
  openPlayerCard(): boolean;
  closePlayerCard(): void;
  /** Persist the walkthrough as done: `acknowledged` = "Let's play" (also marks the site walkthrough seen). */
  markSeen(how: 'skip' | 'acknowledged'): Promise<void>;
  log?(message: string): void;
  /** Injected for tests. */
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export interface ClientTourController {
  state: Ref<ClientTourState | null>;
  disclaimerOpen: Ref<boolean>;
  /** The Details popup the tour opened is up ('real' / 'example'), or null. */
  details: Ref<'real' | 'example' | null>;
  start(): Promise<void>;
  dispatch(input: ClientTourInput): Promise<void>;
  running(): boolean;
  /** Forget the tour (unmount): pending timers are cancelled. */
  stop(): void;
}

export function createClientTourController(host: ClientTourHost): ClientTourController {
  const state = ref<ClientTourState | null>(null);
  const disclaimerOpen = ref(false);
  const details = ref<'real' | 'example' | null>(null);
  const setTimer = host.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = host.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const log = host.log ?? ((m: string) => console.warn(m));
  let timers: unknown[] = [];
  let generation = 0;
  let chain: Promise<void> = Promise.resolve();
  /** Set by a failed load-demo: the queued transition is followed by a 'hud-unavailable' one. */
  let hudUnavailable = false;

  function cancelTimers(): void {
    for (const t of timers) clearTimer(t);
    timers = [];
  }

  /** Runs a transition's effects in order. False = it was refused part-way (Settings would not close): the caller puts
   *  the previous state back. */
  async function run(effects: ClientTourEffect[], how: 'skip' | 'acknowledged', gen: number): Promise<boolean> {
    let diceDelay = 0;
    for (const effect of effects) if (effect.kind === 'open-dice') diceDelay = effect.delayMs;
    for (const effect of effects) {
      if (gen !== generation) return true;
      try {
        switch (effect.kind) {
          case 'select-blade':
            if (effect.blade !== 'home' || host.hasPane) host.selectBlade(effect.blade);
            break;
          case 'open-settings':
            host.openSettings(effect.tab);
            break;
          case 'select-settings-tab':
            host.selectSettingsTab(effect.tab);
            break;
          case 'close-settings':
            if (!(await host.closeSettings())) {
              log('[client-tour] Settings could not close (busy): staying on this step');
              return false;
            }
            break;
          case 'load-demo':
            if (!(await host.loadDemo())) {
              log('[client-tour] the in-match view did not come up: skipping the in-match steps');
              hudUnavailable = true;
              return true;
            }
            break;
          case 'leave-demo':
            host.leaveDemo();
            break;
          case 'show-log':
            host.showLog();
            break;
          case 'open-log-settings':
            host.openLogSettings();
            break;
          case 'close-log-settings':
            host.closeLogSettings();
            break;
          case 'open-roster':
            host.openRoster();
            break;
          case 'close-roster':
            host.closeRoster();
            break;
          case 'open-player-card':
            if (!host.openPlayerCard()) log('[client-tour] no player card to open');
            break;
          case 'close-player-card':
            host.closePlayerCard();
            break;
          case 'open-details': {
            const step = state.value?.step;
            timers.push(setTimer(() => {
              if (gen !== generation || state.value?.step !== step) return;
              void host.openDetails().then((opened) => {
                if (gen !== generation || state.value?.step !== step) { if (opened !== 'none') host.closeDetails(); return; }
                if (opened === 'none') { log('[client-tour] the Play blade could not open a Details popup'); return; }
                details.value = opened;
                timers.push(setTimer(() => {
                  if (gen !== generation || state.value?.step !== step) return;
                  if (!host.openDice()) log('[client-tour] the Details popup has no Dice tab to open');
                }, diceDelay));
              });
            }, effect.delayMs));
            break;
          }
          case 'open-dice':
            break; // scheduled by open-details
          case 'close-details':
            cancelTimers();
            details.value = null;
            host.closeDetails();
            break;
          case 'show-disclaimer':
            disclaimerOpen.value = true;
            break;
          case 'hide-disclaimer':
            disclaimerOpen.value = false;
            break;
          case 'seen':
            await host.markSeen(how);
            break;
        }
      } catch (error) {
        log(`[client-tour] ${effect.kind} failed: ${String(error)}`);
      }
    }
    return true;
  }

  function enqueue(input: ClientTourInput): Promise<void> {
    const gen = generation;
    chain = chain.then(async () => {
      if (gen !== generation) return;
      const previous = state.value;
      const result = input.type === 'start' ? startClientTour() : clientTourReduce(state.value, input);
      state.value = result.state;
      const done = await run(result.effects, input.type === 'acknowledged' ? 'acknowledged' : 'skip', gen);
      if (!done && gen === generation) state.value = previous;
      if (hudUnavailable && gen === generation) {
        hudUnavailable = false;
        const skipped = clientTourReduce(state.value, { type: 'hud-unavailable' });
        state.value = skipped.state;
        await run(skipped.effects, 'skip', gen);
      }
    }).catch((error) => log(`[client-tour] ${String(error)}`));
    return chain;
  }

  return {
    state,
    disclaimerOpen,
    details,
    start: () => enqueue({ type: 'start' }),
    dispatch: enqueue,
    running: () => state.value !== null && state.value.step !== 'done',
    stop() {
      generation += 1;
      cancelTimers();
      state.value = null;
      disclaimerOpen.value = false;
      details.value = null;
    },
  };
}
