/**
 * Owner 2026-10-08: the floating FUMBBL window (components/FumbblFloat.vue) - the docked site kept open in a small
 * movable frame while the user watches a game or a replay (the Gamefinder queue stays alive in it).
 *
 * Pure geometry and persisted-value hygiene only. The position itself is an EdgePanelPosition handled by the shared
 * helpers in edgePanelLayout.ts (anchorPanelPosition / persistClampedPanelPosition); nothing here clamps a position.
 */
import type { EdgePanelPosition, LayoutSize } from './edgePanelLayout';

export interface FloatSize {
  w: number;
  h: number;
}

/** Whole frame (header + site + resize strip), CSS pixels. */
export const FLOAT_DEFAULT_SIZE: FloatSize = { w: 480, h: 420 };
export const FLOAT_MIN_W = 320;
export const FLOAT_MIN_H = 240;
/** Nothing sane is larger; a stored value past this is treated as damage and capped. */
export const FLOAT_MAX_EDGE = 8192;
/** Kept clear of the viewport edges when the window is smaller than the stored size (same margin as the chat pop-out). */
export const FLOAT_VIEWPORT_MARGIN = 16;
/** First placement: this far from the bottom-right corner. */
export const FLOAT_DEFAULT_INSET = 24;

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The smallest whole frame while it shows the whole page; the queue view has its own (FLOAT_QUEUE_MIN). */
export const FLOAT_MIN: FloatSize = { w: FLOAT_MIN_W, h: FLOAT_MIN_H };

/** A stored size: whole pixels, never under the minimum. Anything that is not two finite numbers is "never resized". */
export function sanitizeFloatSize(value: unknown, min: FloatSize = FLOAT_MIN): FloatSize | null {
  if (!value || typeof value !== 'object') return null;
  const { w, h } = value as Record<string, unknown>;
  if (!finiteNumber(w) || !finiteNumber(h)) return null;
  return {
    w: Math.min(FLOAT_MAX_EDGE, Math.max(min.w, Math.round(w))),
    h: Math.min(FLOAT_MAX_EDGE, Math.max(min.h, Math.round(h))),
  };
}

/** A stored position: finite x / y, and edge metadata only when all four fields are well-formed (a half-written anchor
 *  is dropped, leaving the absolute x / y for the lazy re-anchor). Anything else is "never moved". */
export function sanitizeFloatPos(value: unknown): EdgePanelPosition | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!finiteNumber(raw.x) || !finiteNumber(raw.y)) return null;
  const position: EdgePanelPosition = { x: raw.x, y: raw.y };
  const anchored = (raw.edgeX === 'left' || raw.edgeX === 'right')
    && (raw.edgeY === 'top' || raw.edgeY === 'bottom')
    && finiteNumber(raw.offsetX) && finiteNumber(raw.offsetY);
  if (anchored) {
    position.edgeX = raw.edgeX as EdgePanelPosition['edgeX'];
    position.edgeY = raw.edgeY as EdgePanelPosition['edgeY'];
    position.offsetX = raw.offsetX as number;
    position.offsetY = raw.offsetY as number;
  }
  return position;
}

/** The size the frame is drawn at in `available` space: whole pixels, at least the minimum, and no larger than the
 *  space less the margin (the minimum wins in a window smaller than it). Idempotent. */
export function fitFloatSize(
  size: FloatSize | null, available: LayoutSize, margin = FLOAT_VIEWPORT_MARGIN, min: FloatSize = FLOAT_MIN,
): FloatSize {
  const wanted = sanitizeFloatSize(size, min) ?? FLOAT_DEFAULT_SIZE;
  const maxW = Math.max(min.w, Math.floor(available.width - margin));
  const maxH = Math.max(min.h, Math.floor(available.height - margin));
  return { w: Math.min(wanted.w, maxW), h: Math.min(wanted.h, maxH) };
}

// --- the queue view's frame (owner 10-09: "reduce the viewfinder window to just the blackbox section") -------------------

/** What the frame itself takes around the site's rectangle in the queue view: the 1 px border on each side; the header
 *  (28) + the tools strip (28) + the resize strip (14) + the border (2). FumbblFloat.vue's CSS is checked against these. */
export const FLOAT_QUEUE_CHROME: FloatSize = { w: 2, h: 72 };
/** The queue view's own minimum, smaller than the whole-page 320 x 240: the Blackbox box is compact. 260 wide still
 *  holds the header (title, Close) and the whole strip (Fit, -, a short slider, +, the percentage: about 250 px);
 *  150 tall leaves 78 px of the page under the 72 px of chrome. */
export const FLOAT_QUEUE_MIN: FloatSize = { w: 260, h: 150 };
/** The one-line status in the frame's chrome (a fixed height, so the frame can make room for it exactly). */
export const FLOAT_STATUS_H = 22;
/** The "leave the draw first" notice in the frame's chrome: up to three wrapped lines and a row of buttons. */
export const FLOAT_NOTICE_H = 88;

/** A measured box of the page, in the page's own CSS pixels. */
export interface QueueBox {
  w: number;
  h: number;
}

/** The smallest box that holds both (either may be missing). */
export function unionQueueBox(a: QueueBox | null, b: QueueBox | null): QueueBox | null {
  if (!a || !b) return a ?? b;
  return { w: Math.max(a.w, b.w), h: Math.max(a.h, b.h) };
}

/** A box the page reported: two positive finite numbers, else null (a shell that predates the measurement sends none). */
export function sanitizeQueueBox(width: unknown, height: unknown): QueueBox | null {
  if (!finiteNumber(width) || !finiteNumber(height) || !(width >= 1) || !(height >= 1)) return null;
  return { w: Math.min(FLOAT_MAX_EDGE, Math.ceil(width)), h: Math.min(FLOAT_MAX_EDGE, Math.ceil(height)) };
}

/**
 * The box the automatic fit uses, given the one it used so far and what the page reports now. The HEIGHT always
 * follows the page (a line appearing in the box makes the frame taller). The WIDTH only ever grows on its own: the
 * frame's width is the page's viewport, so on a page whose box is laid out against the viewport a narrower frame would
 * report a narrower box, and following that down would shrink the frame step by step. `reset` (the Fit control) takes
 * the page's word for both. Returns `previous` itself when nothing changed.
 */
export function nextQueueBox(previous: QueueBox | null, reported: QueueBox | null, reset = false): QueueBox | null {
  if (!reported) return previous;
  if (!previous || reset) return previous && previous.w === reported.w && previous.h === reported.h ? previous : reported;
  const w = Math.max(previous.w, reported.w);
  return w === previous.w && reported.h === previous.h ? previous : { w, h: reported.h };
}

/** Whole frame for `box` drawn at `zoom`: the box in screen pixels plus the frame's own chrome. Whole pixels, rounded up
 *  (a fraction of the box's last pixel is never cut off). */
export function queueFrameSize(box: QueueBox, zoom: number): FloatSize {
  const factor = finiteNumber(zoom) && zoom > 0 ? zoom : 1;
  return {
    w: Math.ceil(box.w * factor - 1e-6) + FLOAT_QUEUE_CHROME.w,
    h: Math.ceil(box.h * factor - 1e-6) + FLOAT_QUEUE_CHROME.h,
  };
}

/**
 * The queue view's frame in `available` space.
 *  - `stored` (the coach resized it): that size, whatever the zoom - frame and zoom are independent once it is set.
 *  - otherwise the automatic fit: exactly the Blackbox box (`primary`) at the current zoom.
 *  - nothing measured yet: `fallback` (the whole-page size), so the frame does not jump before the page has answered.
 * Never larger than the whole panel (`region`, when known) at this zoom - the view is a crop, and a frame larger than
 * the panel would show the page around it - never under the queue minimum, never larger than the space. Idempotent.
 *
 * Astra 10-09 (R1): `attention` is how much of the panel MUST be in view right now (Match Offers with something in it,
 * a dialog inside the panel). While it is set the frame is never smaller than that - whatever the coach's size or the
 * automatic one - plus `extraHeight` (the status line); the stored size is not touched, so the frame goes back to it
 * when the need is over. Only the window itself can hold it smaller (the view then scrolls inside the panel).
 */
export function fitQueueSize(input: {
  stored: FloatSize | null; primary: QueueBox | null; region: QueueBox | null; zoom: number;
  available: LayoutSize; fallback: FloatSize; margin?: number; attention?: QueueBox | null; extraHeight?: number;
}): FloatSize {
  const stored = sanitizeFloatSize(input.stored, FLOAT_QUEUE_MIN);
  let wanted = stored ?? (input.primary ? queueFrameSize(input.primary, input.zoom) : input.fallback);
  if (input.region) {
    const most = queueFrameSize({
      w: Math.max(input.region.w, input.primary?.w ?? 0),
      h: Math.max(input.region.h, input.primary?.h ?? 0),
    }, input.zoom);
    wanted = { w: Math.min(wanted.w, most.w), h: Math.min(wanted.h, most.h) };
  }
  if (input.attention) {
    const must = queueFrameSize(input.attention, input.zoom);
    wanted = { w: Math.max(wanted.w, must.w), h: Math.max(wanted.h, must.h + (input.extraHeight ?? 0)) };
  }
  return fitFloatSize(wanted, input.available, input.margin ?? FLOAT_VIEWPORT_MARGIN, FLOAT_QUEUE_MIN);
}

/** Where a never-moved frame starts: the bottom-right corner. Absolute top-left; the caller anchors it. */
export function defaultFloatPosition(size: FloatSize, viewport: LayoutSize): { x: number; y: number } {
  return {
    x: Math.max(0, Math.round(viewport.width - size.w - FLOAT_DEFAULT_INSET)),
    y: Math.max(0, Math.round(viewport.height - size.h - FLOAT_DEFAULT_INSET)),
  };
}

// --- the floating window's own zoom (owner 10-09) -------------------------------------------------------------------------

/** The float's slider: 50 %-200 %, in the pane's 5 % steps (game/fumbblHome.ts HOME_ZOOM_STEP / HOME_ZOOM_MAX). Lower
 *  than the docked pane's 75 % because the frame is small. */
export const FLOAT_ZOOM_MIN = 0.5;
export const FLOAT_ZOOM_MAX = 2;
export const FLOAT_ZOOM_DEFAULT = 1;

/** A stored float zoom: a finite number inside the slider's range (the slider snaps; the shell clamps again).
 *  Anything else - missing, NaN, a string, out of range - is 100 %. */
export function sanitizeFloatZoom(value: unknown): number {
  return finiteNumber(value) && value >= FLOAT_ZOOM_MIN && value <= FLOAT_ZOOM_MAX ? value : FLOAT_ZOOM_DEFAULT;
}

// --- a launch taken from the page while floating ------------------------------------------------------------------------

/** How long after the shell hid the site for a launch that launch's routing may still bring the window back. */
export const FLOAT_LAUNCH_HOLD_MS = 120_000;

/** Launches that seat the coach in their own match (game/jnlpRouting.ts JnlpRouteResult). */
const OWN_MATCH_RESULTS: readonly string[] = ['fork-player', 'fumbbl-player', 'fumbbl-staged'];

export type FloatLaunchOutcome = 'own-match' | 'restore' | 'keep-holding' | 'expired' | 'none';

/**
 * A launch taken from the site (the shell hid it and said so) ended the floating window at `heldAt`. Now that the
 * launch has been routed as `result`:
 *  - the coach's own match ('own-match'): the window comes back as well - floating is exactly what it was - and is
 *    dismissed only once the coach is actually IN the game (floatOnOwnMatch). Nothing is decided at the launch: it may
 *    only stage the game, and a staged game can be cancelled or fail to connect (Astra 10-09, R3);
 *  - still undecided (the "replay or live?" question): keep waiting for the answer;
 *  - anything else - a game to watch, a replay, or a launch that came to nothing: the window comes back. Watching
 *    while the queue runs is what it is for.
 * Nothing held: 'none'. Held too long ago to be this launch: 'expired' - the hold is over and NOTHING else follows from
 * it (Astra 10-09, F5: an expired hold used to read as the own-match outcome, which dismisses the page - a spectate
 * launch that arrived late unloaded a live queue).
 */
export function floatAfterLaunch(heldAt: number, now: number, result: string): FloatLaunchOutcome {
  // (see floatOnOwnMatch below for what follows an 'own-match')
  if (!(heldAt > 0)) return 'none';
  if (now < heldAt || now - heldAt > FLOAT_LAUNCH_HOLD_MS) return 'expired';
  if (result === 'ambiguous') return 'keep-holding';
  return OWN_MATCH_RESULTS.includes(result) ? 'own-match' : 'restore';
}

// --- the coach's own match (owner 10-09: "When the queue pops and a game is joined, the queue view should be dismissed") --

export type OwnMatchFloatAction = 'dismiss' | 'none';

/**
 * What the coach's OWN match (as a player - never a game they watch, never a replay) means for the floating window:
 * with the window floating and the coach IN the game, DISMISS - our frame closes, floating goes off and the queue page
 * is parked, as Close does. Nothing on the FUMBBL page is touched; a docked-only page (not floating) is left alone.
 *
 * Nothing else changes the float state. Astra 10-09 (R3): a launch that is the coach's own match used to turn floating
 * off and wait for the game; but a launch may only STAGE the game, and a staged game that is cancelled, cleared, or
 * never connects reached no state this could see - floating stayed off. So no exit needs handling: staging, the
 * lobby, the waiting board and a failed or timed-out connection all leave floating exactly as it was.
 */
export function floatOnOwnMatch(input: { playing: boolean; floating: boolean; held?: boolean }): OwnMatchFloatAction {
  // `held`: a launch taken from the page ended the window a moment ago and has not been settled yet - still this
  // floating session's page.
  return input.playing && (input.floating || input.held === true) ? 'dismiss' : 'none';
}
