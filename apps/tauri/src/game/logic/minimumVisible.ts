/** Owner rule: a viewer-visible surface is on screen for at least ~450 ms, or not shown at all. */
export const VIEWER_VISIBLE_MIN_MS = 450;

/** How much longer a READ-ONLY (watched) card must stay on screen after its state was cleared. A card the local
 *  coach answers closes at once (0): this is presentation only and never delays an answer or the server flow. */
export function watchedCardLingerMs(
  card: { mine: boolean } | null,
  shownAtMs: number,
  nowMs: number,
  minimumMs = VIEWER_VISIBLE_MIN_MS,
): number {
  if (!card || card.mine) return 0;
  const elapsed = nowMs - shownAtMs;
  if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
  return Math.max(0, Math.ceil(minimumMs - elapsed));
}

/** How long the card on screen must still be shown before `incoming` (another card, or null) may take its place.
 *  A card the LOCAL coach must answer is never queued behind anything: 0. */
export function watchedCardHandoffMs(
  shown: { mine: boolean } | null,
  incoming: { mine: boolean } | null,
  shownAtMs: number,
  nowMs: number,
  minimumMs = VIEWER_VISIBLE_MIN_MS,
): number {
  if (incoming?.mine) return 0;
  return watchedCardLingerMs(shown, shownAtMs, nowMs, minimumMs);
}
