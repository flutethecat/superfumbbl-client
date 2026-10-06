import { getCurrentScope, onScopeDispose, ref, watch, type Ref } from 'vue';

/** setTimeout / clearTimeout, injectable for tests. */
export interface PresenceScheduler { set(fn: () => void, ms: number): number; clear(id: number): void; }
const windowScheduler: PresenceScheduler = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
};

/**
 * Owner 10-06: "a slight presentation hold for '<Coach> is choosing push direction' — only appear after 1500 ms".
 * A notice that is re-derived on every frame flickers if it is shown the instant it exists; this ref turns true only
 * once `source` has been continuously truthy for `holdMs`, and drops to false the moment the source clears. The
 * source is compared by VALUE (pass the message string, not the object), so a re-derived identical notice does not
 * restart the hold.
 */
export function useDelayedPresence(
  source: () => string | null | undefined,
  holdMs: number,
  scheduler: PresenceScheduler = windowScheduler,
): { shown: Ref<boolean>; dispose: () => void } {
  const shown = ref(false);
  let timer: number | null = null;
  const clear = () => { if (timer !== null) { scheduler.clear(timer); timer = null; } };
  const stop = watch(source, (value, prev) => {
    if (!value) { clear(); shown.value = false; return; }
    if (value === prev && (shown.value || timer !== null)) return; // same notice still pending/showing: keep the clock
    clear(); shown.value = false;
    timer = scheduler.set(() => { timer = null; shown.value = true; }, holdMs);
  }, { immediate: true });
  const dispose = () => { stop(); clear(); };
  if (getCurrentScope()) onScopeDispose(dispose); // a component unmount drops the pending timer
  return { shown, dispose };
}
