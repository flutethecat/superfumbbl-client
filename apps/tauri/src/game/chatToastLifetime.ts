export const AUTHORED_CHAT_TOAST_LIFETIME_MS = 15_000;

/** Return chat occurrences appended since the previous computed snapshot. Identity, rather than length, keeps
 * this working when the shared 400-entry game-log ring evicts an older talk line as a new one arrives. */
export function newlyAppendedChatOccurrences<T>(current: readonly T[], previous: readonly T[]): T[] {
  if (current.length === 0) return [];
  if (previous.length === 0) return [...current];
  const priorTail = previous.at(-1);
  const tailIndex = priorTail === undefined ? -1 : current.lastIndexOf(priorTail);
  return tailIndex >= 0 ? current.slice(tailIndex + 1) : [current.at(-1)!];
}

/**
 * Expire the exact toast occurrence that created this timer. Callers retain the
 * timer handle so replacement, queue eviction, and teardown can cancel it.
 */
export function scheduleAuthoredChatToastExpiry(
  toastId: number,
  removeToast: (toastId: number) => void,
  delayMs = AUTHORED_CHAT_TOAST_LIFETIME_MS,
): number {
  return window.setTimeout(() => removeToast(toastId), delayMs);
}
