import { onBeforeUnmount, watch } from 'vue';

export const CHAT_TOAST_QUIET_CLEAR_MS = 5000;

interface ChatToastQuietClearOptions {
  open: () => boolean;
  /** Identity of the newest chat occurrence; unlike length, this changes at the capped-log limit. */
  chatRevision: () => unknown;
  clearToasts: () => void;
  delayMs?: number;
}

/**
 * One quiet-window per Chat-pane opening. A changed chat log cancels that
 * opening's clear instead of restarting it; closing and reopening creates the
 * next independent window. This affects presentation only, never chat send or
 * stored history.
 */
export function useChatToastQuietClear(options: ChatToastQuietClearOptions): () => void {
  const delayMs = options.delayMs ?? CHAT_TOAST_QUIET_CLEAR_MS;
  let timer: number | null = null;

  const cancelTimer = () => {
    if (timer == null) return;
    window.clearTimeout(timer);
    timer = null;
  };

  const stopOpen = watch(options.open, (open, wasOpen) => {
    if (!open) {
      cancelTimer();
      return;
    }
    if (wasOpen === true) return;
    cancelTimer();
    const revisionAtOpen = options.chatRevision();
    timer = window.setTimeout(() => {
      timer = null;
      if (options.open() && options.chatRevision() === revisionAtOpen) options.clearToasts();
    }, delayMs);
  }, { immediate: true });

  const stopRevision = watch(options.chatRevision, (revision, previous) => {
    if (!Object.is(revision, previous) && options.open()) cancelTimer();
  });

  const stop = () => {
    cancelTimer();
    stopOpen();
    stopRevision();
  };
  onBeforeUnmount(stop);
  return stop;
}
