import { reactive } from 'vue';
import { fetchTournamentNotifications, type TournamentClientNotification } from './accountApi';
import { FORK_EDITION } from './edition';

export const tournamentNotificationState = reactive({
  active: null as TournamentClientNotification | null,
});

const presented = new Set<string>();
const dismissed = new Set<string>();
let timer: ReturnType<typeof setInterval> | undefined;

export function selectNewNotification(events: readonly TournamentClientNotification[]): TournamentClientNotification | undefined {
  return events.find((event) => !presented.has(event.id) && !dismissed.has(event.id));
}

export function dismissTournamentNotification(id: string): void {
  dismissed.add(id);
  if (tournamentNotificationState.active?.id === id) tournamentNotificationState.active = null;
  // Presentation-only by contract: there is intentionally no API acknowledgement here.
}

export async function pollTournamentNotifications(): Promise<void> {
  const next = selectNewNotification(await fetchTournamentNotifications());
  if (!next) return;
  presented.add(next.id);
  tournamentNotificationState.active = next;
  if (typeof document !== 'undefined' && (document.visibilityState !== 'visible' || !document.hasFocus())) {
    try {
      if (Notification.permission === 'default') await Notification.requestPermission();
      if (Notification.permission === 'granted') new Notification('Super FUMBBL match ready', { body: next.message, tag: next.id });
    } catch {
      // A popup in the app remains the guaranteed foreground presentation.
    }
  }
}

/** Owner 09-10: tournament notifications are fork-edition only (compile-time). Owner 10-31 (Sol r2): enforced HERE, so a
 *  public run that signs in to a fork account (--fork-server) never polls - a no-op stop, no request, no timer. */
export function startTournamentNotificationPolling(intervalMs = 20_000): () => void {
  if (!FORK_EDITION) return () => undefined;
  if (timer) clearInterval(timer);
  void pollTournamentNotifications().catch(() => undefined);
  timer = setInterval(() => void pollTournamentNotifications().catch(() => undefined), intervalMs);
  return () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
}
