export interface TokenScreenPosition {
  x: number;
  y: number;
}

/** Convert Classic's pitch-canvas or visible sidebar Box token into the Classic root's
 * coordinate space. Off-pitch players without a rendered Box tile deliberately have no anchor. */
export function classicTokenToastScreenPosition(input: {
  root: HTMLElement;
  pitch: HTMLElement | null;
  playerId: string;
  onPitch: boolean;
  canvasPosition: TokenScreenPosition | null | undefined;
}): TokenScreenPosition | null {
  const rootRect = input.root.getBoundingClientRect();
  if (input.onPitch) {
    if (!input.pitch || !input.canvasPosition) return null;
    const pitchRect = input.pitch.getBoundingClientRect();
    return {
      x: pitchRect.left - rootRect.left + input.canvasPosition.x,
      y: pitchRect.top - rootRect.top + input.canvasPosition.y,
    };
  }
  const tile = Array.from(input.root.querySelectorAll<HTMLElement>('.cv-dg-tile[data-player-id]'))
    .find((entry) => entry.dataset.playerId === input.playerId);
  if (!tile) return null;
  const tileRect = tile.getBoundingClientRect();
  return {
    x: tileRect.left - rootRect.left + tileRect.width / 2,
    y: tileRect.top - rootRect.top + tileRect.height / 2,
  };
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
