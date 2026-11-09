export interface TokenScreenPosition {
  x: number;
  y: number;
}

export const WATCH_OUT_TOAST_COPY = '⭐ Withergrasp gains the Dodge skill!';

export interface TokenToastFollowerDeps {
  playerScreenPos(playerId: string): TokenScreenPosition | null | undefined;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(id: number): void;
  setTimer(callback: () => void, durationMs: number): number;
  clearTimer(timer: number): void;
  onPosition(position: TokenScreenPosition): void;
  onClear(): void;
}

/**
 * Follow a rendered player token for one bounded toast lifetime. Missing tokens are deliberately silent while
 * the RAF keeps looking: a later pitch/dugout render can still acquire the anchor, and timeout/clear always
 * retires the loop. This owns presentation only; it never infers a gameplay occurrence.
 */
export function createTokenToastFollower(deps: TokenToastFollowerDeps) {
  let activePlayerId: string | null = null;
  let frame = 0;
  let timer: number | null = null;

  const clear = () => {
    activePlayerId = null;
    if (frame) deps.cancelFrame(frame);
    frame = 0;
    if (timer) deps.clearTimer(timer);
    timer = null;
    deps.onClear();
  };

  const follow = () => {
    const playerId = activePlayerId;
    if (!playerId) return;
    const position = deps.playerScreenPos(playerId);
    if (position) deps.onPosition(position);
    frame = deps.requestFrame(follow);
  };

  return {
    show(playerId: string, durationMs: number) {
      clear();
      activePlayerId = playerId;
      follow();
      timer = deps.setTimer(clear, durationMs);
    },
    clear,
  };
}
