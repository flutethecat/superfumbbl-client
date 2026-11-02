/**
 * Owner 11-02: the Log and Chat panes keep following the newest line through pane resizes.
 *
 * The chat entry box grows with a wrapping message and the pane above it shrinks; the browser clamps / anchors the
 * scroll and fires a scroll event although the reader never scrolled. The old rule set the follow flag from EVERY
 * scroll event, so the pane stopped following. This helper:
 *  1. keeps a following pane pinned to its end when the pane resizes (ResizeObserver on the pane), when any row grows
 *     or a row is added (ResizeObserver on the pane's single row block, `[data-pane-rows]`: inline rows are not
 *     observable one by one, the block that holds them all is), when its rows change (MutationObserver) and when an
 *     image in it loads;
 *  2. says whether a scroll event stops the follow: only when the pane moved UP from the last offset we saw or pinned
 *     AND the reader is acting (wheel, a scrolling key, touch, a pointer held on the pane or its scrollbar, each within
 *     its window, or a middle-click autoscroll still running). Our pins only ever move the pane down, and layout (the
 *     pane shrinking, rows growing, the browser clamping or anchoring) keeps or raises the offset, so downward or
 *     neutral movement never stops the follow, even inside the reader's window; an upward move by the reader still
 *     does when a resize lands in the same frame (Sol 11-02 rounds 2-3). "Up" is measured from the highest offset seen
 *     since the last pin, so a run of tiny (fractional) upward steps adds up instead of each one being too small.
 *  3. `settle()` after the view measures something that briefly resizes the pane (the chat entry box sets its height to
 *     auto to read its scrollHeight): a following pane goes straight back to its end before the clamped offset's scroll
 *     event can be read as the reader's (Sol 11-02 round 4).
 * The view keeps the flag, the "new events" pill and the idle snap-back; this module only pins and classifies.
 */

/** A scroll by the reader that leaves the pane within this many px of the end still counts as "at the end". */
export const PANE_FOLLOW_THRESHOLD_PX = 8;
/** A wheel / key signal attributes the scroll events of the next this-many ms to the reader (smooth scrolling). */
export const PANE_USER_SCROLL_MS = 450;
/** After the finger lifts, a touch fling keeps scrolling for a while: still the reader's. */
export const PANE_TOUCH_FLING_MS = 1200;
/** Fail-open cap on a middle-click autoscroll whose end the page never saw (latches fail open). */
export const PANE_AUTOSCROLL_MAX_MS = 10000;

/** Keys that scroll a focused pane. Space scrolls too (Shift+Space upward). */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);
/** The native scrolling combos with Ctrl / Cmd: to the top / end (Ctrl+Home/End, Cmd+Up/Down) and by line (Ctrl+Up/Down). */
const MODIFIED_SCROLL_KEYS = new Set(['Home', 'End', 'ArrowUp', 'ArrowDown']);

/** A key the reader pressed to scroll the pane (not a copy, not a bare modifier, not typing into a field). */
export function isPaneScrollKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.altKey) return false;
  if (!SCROLL_KEYS.has(e.key)) return false;
  if ((e.ctrlKey || e.metaKey) && !MODIFIED_SCROLL_KEYS.has(e.key)) return false;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return false;
  return true;
}

export function paneAtBottom(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - PANE_FOLLOW_THRESHOLD_PX;
}

export interface PaneFollowOptions {
  /** The view's follow flag for this pane, as it stands now. */
  isFollowing: () => boolean;
  now?: () => number;
  /** Injection points for tests; default to the globals (absent ones simply skip that observer). */
  ResizeObserver?: typeof ResizeObserver;
  MutationObserver?: typeof MutationObserver;
}

export interface PaneFollower {
  /** Attach to the pane's element (or null when it unmounts); the previous element is detached first. */
  attach(el: HTMLElement | null): void;
  detach(): void;
  /** Our own scroll to the end (never the reader's). */
  pin(): void;
  /** After a measurement that briefly resized the pane: a following pane goes back to its end, any other pane's
   *  baseline offset is refreshed. Call it synchronously, right after the measurement. */
  settle(): void;
  /** True when the latest scroll on the attached pane is the reader moving it UP. Call it for EVERY scroll event of
   *  the pane (at the end too), so the last-seen offset stays current. */
  scrollStopsFollow(): boolean;
  readonly element: HTMLElement | null;
}

export function createPaneFollower(opts: PaneFollowOptions): PaneFollower {
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const RO = opts.ResizeObserver ?? (typeof ResizeObserver !== 'undefined' ? ResizeObserver : undefined);
  const MO = opts.MutationObserver ?? (typeof MutationObserver !== 'undefined' ? MutationObserver : undefined);

  let el: HTMLElement | null = null;
  let resizeObs: ResizeObserver | null = null;
  let mutationObs: MutationObserver | null = null;
  let content: Element | null = null;
  let userSignalAt = -Infinity;
  let userWindow = PANE_USER_SCROLL_MS;
  let pointerHeld = false;
  let touchHeld = false;
  /** A middle-click autoscroll keeps scrolling after the button is released, until the next click / key / wheel / blur. */
  let autoscroll = false;
  /** The pointerdown that ended an autoscroll does not start another one. */
  let autoscrollJustEnded = false;
  /** The starting middle press is still down: its own release keeps the autoscroll (toggled mode). */
  let autoscrollPressDown = false;
  let autoscrollSince = -Infinity;
  /** The highest offset seen since the last pin (or the current one while not following): the reference for "moved up". */
  let lastTop = 0;

  const signal = (windowMs: number) => { userSignalAt = now(); userWindow = windowMs; };
  const onWheel = () => signal(PANE_USER_SCROLL_MS);
  const onKey = (e: KeyboardEvent) => { if (isPaneScrollKey(e)) signal(PANE_USER_SCROLL_MS); };
  const onPointerDown = (e: PointerEvent) => {
    pointerHeld = true;
    signal(PANE_USER_SCROLL_MS);
    if (e.button === 1 && !autoscrollJustEnded) {
      autoscroll = true;
      autoscrollPressDown = true;
      autoscrollSince = now();
    }
  };
  // window, capture: runs before the pane's own pointerdown, so the click that ends an autoscroll does not restart it
  const onAnyPointerDown = () => { autoscrollJustEnded = autoscroll; autoscroll = false; autoscrollPressDown = false; };
  const endAutoscroll = () => { autoscroll = false; autoscrollPressDown = false; };
  const onPointerUp = () => {
    // the starting press's own release keeps a toggled autoscroll; any other release ends it (Chromium swallows the
    // cancelling click's pointerdown before the page sees it, but not its release)
    if (autoscroll) {
      if (autoscrollPressDown) autoscrollPressDown = false;
      else autoscroll = false;
    }
    if (pointerHeld) { pointerHeld = false; signal(PANE_USER_SCROLL_MS); }
  };
  const onTouchStart = () => { touchHeld = true; signal(PANE_TOUCH_FLING_MS); };
  const onTouchEnd = () => { touchHeld = false; signal(PANE_TOUCH_FLING_MS); };

  function remember(): void {
    if (el) lastTop = el.scrollTop;
  }

  function pin(): void {
    if (!el) return;
    el.scrollTop = el.scrollHeight; // leaves the reader's input signal intact: a gesture under way still counts
    remember();
  }

  /** Something changed the pane's size or content: a following pane goes back to its end. */
  function repin(): void {
    if (el && opts.isFollowing()) pin();
    else remember();
  }

  function autoscrolling(): boolean {
    if (autoscroll && now() - autoscrollSince > PANE_AUTOSCROLL_MAX_MS) autoscroll = false; // fail open
    return autoscroll;
  }

  /** Watch the block holding every row, so any row that grows after render (a wrap, a late plate, font metrics) is followed. */
  function trackContent(): void {
    if (!el || !resizeObs) return;
    const first = el.firstElementChild;
    const block = first && first.hasAttribute('data-pane-rows') ? first : null;
    if (block === content) return;
    if (content) resizeObs.unobserve(content);
    content = block;
    if (block) resizeObs.observe(block);
  }

  function detach(): void {
    if (!el) return;
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchend', onTouchEnd);
    el.removeEventListener('touchcancel', onTouchEnd);
    el.removeEventListener('load', repin, true);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      window.removeEventListener('pointerdown', onAnyPointerDown, true);
      window.removeEventListener('keydown', endAutoscroll, true);
      window.removeEventListener('wheel', endAutoscroll, true);
      window.removeEventListener('blur', endAutoscroll);
    }
    resizeObs?.disconnect();
    mutationObs?.disconnect();
    resizeObs = null;
    mutationObs = null;
    content = null;
    el = null;
    pointerHeld = false;
    touchHeld = false;
    autoscroll = false;
    autoscrollJustEnded = false;
    autoscrollPressDown = false;
  }

  function attach(next: HTMLElement | null): void {
    if (next === el) return;
    detach();
    if (!next) return;
    el = next;
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('keydown', onKey);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('load', repin, true); // an image in a row (emoji, plate art) finished loading
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerup', onPointerUp, true);
      window.addEventListener('pointercancel', onPointerUp, true);
      window.addEventListener('pointerdown', onAnyPointerDown, true);
      window.addEventListener('keydown', endAutoscroll, true); // Escape included
      window.addEventListener('wheel', endAutoscroll, { capture: true, passive: true });
      window.addEventListener('blur', endAutoscroll);
    }
    if (RO) {
      resizeObs = new RO(() => repin());
      resizeObs.observe(el);
      trackContent();
    }
    if (MO) {
      mutationObs = new MO(() => { trackContent(); repin(); });
      mutationObs.observe(el, { childList: true, subtree: true, characterData: true });
    }
    remember();
  }

  function scrollStopsFollow(): boolean {
    if (!el) return false;
    const top = el.scrollTop;
    if (!opts.isFollowing()) { lastTop = top; return false; } // nothing to stop: just keep the baseline current
    // measured from the highest offset since the last pin, so small upward steps accumulate
    const movedUp = top < lastTop - 0.5;
    if (top > lastTop) lastTop = top;
    if (!movedUp) return false; // down or nowhere: our pins and layout, never a reason to stop following
    return pointerHeld || touchHeld || autoscrolling() || now() - userSignalAt <= userWindow;
  }

  return {
    attach,
    detach,
    pin,
    settle: repin,
    scrollStopsFollow,
    get element() { return el; },
  };
}
