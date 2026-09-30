// Owner 09-29 (S25): the Hail Mary Pass targeting notice docks under the top-centre panel like the On the Ball
// waiting notice — the panel's left edge, bottom + 8, the panel's width. No panel box falls back to the
// component's centred default (undefined). The card is click-through and not draggable (the whole pitch is a target).
export type HmpDockBox = { left: number; center: number; bottom: number };
export type HmpDockStyle = Record<string, string>;

// Sits just above the pitch chrome the old hint used (z 13) and below menus, confirmation cards and the target cue.
export const HMP_NOTICE_Z_INDEX = 14;

export function hailMaryPassNoticeStyle(box: HmpDockBox | null): HmpDockStyle | undefined {
  if (!box) return undefined;
  return {
    left: `${box.left}px`,
    top: `${box.bottom + 8}px`,
    transform: 'none',
    width: `${Math.round((box.center - box.left) * 2)}px`,
  };
}
