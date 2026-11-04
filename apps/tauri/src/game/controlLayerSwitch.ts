import { ref, watch, type WatchStopHandle } from 'vue';
import { applyLayerConfirmations, type ControlLayer, type ControlLayerSettings } from './controlLayer';
import type { ConfirmationSettings } from './confirmationSettings';

/**
 * FUMBBL Controls §6 (owner 11-03): switching the control layer.
 *
 * In Settings at any time. During the coach's OWN activation the switch waits: a modal says "Your controls will switch
 * to <layer> when <player>'s activation ends." (OK only) and Settings shows it as pending. It applies at the first of:
 * activation end, turn end, game end, disconnect.
 *
 * LATCHES FAIL OPEN (P0 10-16): the pending switch waits on server state, so it has releases that do not depend on that
 * state ever arriving - the game view's probe is re-read on every frame AND by a watchdog timer; a probe that is gone
 * (the view unmounted, the game closed) releases at once; and a hard cap releases it whatever the probe says.
 *
 * `settings.controlLayer` always holds the coach's pick (it persists at once, so a restart applies it - fail open). The
 * EFFECTIVE layer is the held one while a switch waits.
 */
export interface ActivationProbe {
  /** The coach's own activation is in progress (a player of theirs is acting / declared on their turn). */
  ownActivation: boolean;
  /** Identifies this activation (game, turn, player): any change ends the wait. */
  activationKey: string;
  playerName: string;
}

export interface PendingControlLayerSwitch {
  from: ControlLayer;
  to: ControlLayer;
  activationKey: string;
  playerName: string;
  since: number;
}

type LayerSettings = ControlLayerSettings & ConfirmationSettings;

/** The game view's probe (pure). Null = no activation can hold a switch: not playing, the transport closed (Sol r1 #5:
 *  a closed socket keeps play.active and the last model, so the retained actor must not hold it), the game finished
 *  or at endGame (even with an actor retained). Latches fail open. */
export function activationProbeFrom(i: {
  playing: boolean; connectionClosed: boolean; finished: boolean; turnMode: string;
  actingId: string; myTurn: boolean; controlsActing: boolean; playerName: string; activationKey: string;
}): ActivationProbe | null {
  if (!i.playing || i.connectionClosed || i.finished || i.turnMode === 'endGame') return null;
  return { ownActivation: !!i.actingId && i.myTurn && i.controlsActing, activationKey: i.activationKey, playerName: i.playerName };
}

/** Watchdog period: the probe is re-read this often while a switch waits. */
export const PENDING_SWITCH_WATCHDOG_MS = 3_000;
/** Hard cap: a switch never waits longer than this (a turn is 4 minutes at most). */
export const PENDING_SWITCH_MAX_MS = 10 * 60_000;

export const pendingControlLayerSwitch = ref<PendingControlLayerSwitch | null>(null);
/** The OK-only notice (§6). Set when a switch starts waiting; the modal clears it. */
export const controlLayerSwitchNotice = ref<PendingControlLayerSwitch | null>(null);

let probe: (() => ActivationProbe | null) | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;
let now: () => number = () => Date.now();
let logLine: (line: string) => void = () => undefined;

/** The game view installs its probe while mounted (null when it unmounts: a waiting switch then applies). */
export function setControlLayerActivationProbe(fn: (() => ActivationProbe | null) | null, log?: (line: string) => void): void {
  probe = fn;
  if (log) logLine = log;
  if (!fn) recheckPendingControlLayer('the game view closed');
}
/** Unmount: drop `fn` only if it is still the installed probe (another view may have installed its own since). */
export function clearControlLayerActivationProbe(fn: () => ActivationProbe | null): void {
  if (probe === fn) setControlLayerActivationProbe(null);
}

/** The layer in effect right now. */
export function effectiveControlLayer(s: Pick<ControlLayerSettings, 'controlLayer'>): ControlLayer {
  return pendingControlLayerSwitch.value?.from ?? s.controlLayer;
}

function stopWatchdog(): void {
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
}

let applyTarget: LayerSettings | null = null;
function applyNow(s: LayerSettings, reason: string): void {
  const pending = pendingControlLayerSwitch.value;
  pendingControlLayerSwitch.value = null;
  controlLayerSwitchNotice.value = null;
  stopWatchdog();
  applyLayerConfirmations(s, s.controlLayer);
  if (pending) logLine(`controls: switched to ${s.controlLayer === 'fumbbl' ? 'FUMBBL Controls' : 'Super FUMBBL Controls'} (${reason})`);
}

/** Re-read the probe; release a waiting switch when its activation is over (or nothing can tell any more). */
export function recheckPendingControlLayer(reason?: string): void {
  const pending = pendingControlLayerSwitch.value;
  const s = applyTarget;
  if (!pending || !s) return;
  if (s.controlLayer === pending.from) { // the coach switched back before it applied: nothing to do
    pendingControlLayerSwitch.value = null;
    controlLayerSwitchNotice.value = null;
    stopWatchdog();
    return;
  }
  const p = probe?.() ?? null;
  if (reason) return applyNow(s, reason);
  if (!p) return applyNow(s, 'no game in progress');
  if (!p.ownActivation) return applyNow(s, 'the activation ended');
  if (p.activationKey !== pending.activationKey) return applyNow(s, 'the activation ended');
  if (now() - pending.since >= PENDING_SWITCH_MAX_MS) return applyNow(s, 'watchdog');
}

/** Apply the coach's pick now, or hold it until the current own activation ends. */
export function requestControlLayer(s: LayerSettings, from: ControlLayer): void {
  applyTarget = s;
  const to = s.controlLayer;
  const pending = pendingControlLayerSwitch.value;
  // A switch already waiting keeps its original layer in effect (switching back cancels it).
  const effective = pending?.from ?? from;
  if (to === effective) {
    if (pending) { pendingControlLayerSwitch.value = null; controlLayerSwitchNotice.value = null; stopWatchdog(); }
    applyLayerConfirmations(s, to);
    return;
  }
  const p = probe?.() ?? null;
  if (!p || !p.ownActivation) {
    pendingControlLayerSwitch.value = null;
    applyNow(s, 'immediate');
    return;
  }
  const next: PendingControlLayerSwitch = { from: effective, to, activationKey: p.activationKey, playerName: p.playerName, since: now() };
  pendingControlLayerSwitch.value = next;
  controlLayerSwitchNotice.value = next;
  stopWatchdog();
  watchdog = setInterval(() => recheckPendingControlLayer(), PENDING_SWITCH_WATCHDOG_MS);
  logLine(`controls: switch to ${to === 'fumbbl' ? 'FUMBBL Controls' : 'Super FUMBBL Controls'} waits for ${p.playerName}'s activation to end`);
}

/** The flat confirmation values belong to the layer IN EFFECT (the held one while a switch waits). Idempotent. */
export function reconcileControlLayerConfirmations(s: LayerSettings): boolean {
  return applyLayerConfirmations(s, effectiveControlLayer(s));
}

let stopLayerWatch: WatchStopHandle | null = null;
/** App wiring: every change of `settings.controlLayer` goes through requestControlLayer. Idempotent. */
export function installControlLayerWatch(s: LayerSettings): void {
  applyTarget = s;
  if (stopLayerWatch) return;
  // Not `sync` (Sol r1 P0): a Settings Cancel restores the whole snapshot with one Object.assign; a sync watcher would swap
  // the confirmation values halfway through it (after controlLayer, before the flat confirm* keys) and overwrite the
  // restored ones. The pre-flush watcher runs once the restore is complete, when the pair is already consistent.
  // Sol r2 P0: also watch confirmationsLayer. A Settings Cancel can restore a snapshot whose controlLayer equals the
  // current one while its confirmation ownership is another layer's (e.g. captured before a pending switch released):
  // the flat confirm* values are then re-owned by the layer in effect even though the layer string did not change.
  stopLayerWatch = watch(() => [s.controlLayer, s.confirmationsLayer] as const, ([to], [from]) => {
    if (to !== from) requestControlLayer(s, from);
    reconcileControlLayerConfirmations(s);
  });
}

/** @internal tests */
export function resetControlLayerSwitchForTests(opts: { now?: () => number } = {}): void {
  stopLayerWatch?.();
  stopLayerWatch = null;
  stopWatchdog();
  pendingControlLayerSwitch.value = null;
  controlLayerSwitchNotice.value = null;
  probe = null;
  applyTarget = null;
  now = opts.now ?? (() => Date.now());
  logLine = () => undefined;
}
