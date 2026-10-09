/** Owner 10-09: "For the follow/stay decision pop, can we add logic to have it dodge the cursor position so we avoid
 *  misclicks?" ... "Same for skill decisions".
 *
 *  A decision card (Follow up / Stay, "Use <skill>?") opens while the coach is clicking on the pitch; when one of
 *  its buttons lands under the pointer, the click already on its way answers the server for them. Two parts:
 *
 *  1. the DODGE (promptDodgeOffset): decided once when the card opens - shift the card by the smallest move that
 *     leaves no button under the pointer or within a margin of it. It never chases the pointer afterwards.
 *  2. the open-click GUARD (promptPressAnswers) for what a dodge cannot cover (button already held, a click in
 *     flight, touch, pointer position unknown, no room): a pointer click on a card button answers only when the
 *     card itself saw its press, PROMPT_OPEN_GUARD_MS or more after the card opened. Nothing is ever sent by the
 *     guard and the keyboard is never touched.
 *
 *  Pure geometry and decisions only; the DOM side lives in promptDodgeDom.ts. */

export interface DodgeRect { left: number; top: number; right: number; bottom: number }
export interface DodgePoint { x: number; y: number }

/** Clearance kept between the pointer and every button, at the default interface text size. */
export const PROMPT_DODGE_MARGIN_PX = 24;
/** The interface text size (Settings, `--ui-min-text-size`) the margin above is tuned for. */
export const PROMPT_DODGE_BASE_TEXT_PX = 12;
const PROMPT_DODGE_MARGIN_MAX_PX = 48;

/** The margin grows with the coach's interface text size (buttons grow with it), never below the base and capped. */
export function promptDodgeMargin(uiTextPx?: number | null): number {
  const size = Number(uiTextPx);
  if (!Number.isFinite(size) || size <= PROMPT_DODGE_BASE_TEXT_PX) return PROMPT_DODGE_MARGIN_PX;
  return Math.min(PROMPT_DODGE_MARGIN_MAX_PX, Math.round(PROMPT_DODGE_MARGIN_PX * size / PROMPT_DODGE_BASE_TEXT_PX));
}

export interface PromptDodgeInput {
  /** The card as laid out at its normal position. */
  card: DodgeRect;
  /** Its clickable controls, same coordinate space. */
  buttons: readonly DodgeRect[];
  /** Last known pointer position; null when unknown (never moved over the app, touch lifted, left the window). */
  pointer: DodgePoint | null;
  /** The card must stay inside this (the pitch host, cut to the window). */
  bounds: DodgeRect;
  margin: number;
  /** The coach dragged the card: their position wins. */
  dragged?: boolean;
}

const inside = (p: DodgePoint, r: DodgeRect, dx = 0, dy = 0) =>
  p.x >= r.left + dx && p.x <= r.right + dx && p.y >= r.top + dy && p.y <= r.bottom + dy;

const grow = (r: DodgeRect, by: number): DodgeRect => ({ left: r.left - by, top: r.top - by, right: r.right + by, bottom: r.bottom + by });

/** Is the pointer on a button, or within `margin` of one? */
export function pointerThreatensButtons(buttons: readonly DodgeRect[], pointer: DodgePoint | null, margin: number): boolean {
  if (!pointer) return false;
  return buttons.some((button) => inside(pointer, grow(button, margin)));
}

/** The offset to open the card at.
 *  - `{ x: 0, y: 0 }`: stay at the normal position (pointer unknown, nowhere near a button, or the card was dragged);
 *  - another offset: the smallest shift that clears every button from the pointer and keeps the card inside `bounds`
 *    (one axis when one is enough - the shorter one - otherwise both);
 *  - `null`: the pointer threatens a button and there is no room to clear it. The caller keeps the normal position
 *    and relies on the open-click guard. */
export function promptDodgeOffset(input: PromptDodgeInput): DodgePoint | null {
  const { card, buttons, pointer, bounds, margin, dragged } = input;
  if (dragged || !pointer) return { x: 0, y: 0 };
  const zones = buttons.map((button) => grow(button, Math.max(0, margin)));
  if (!zones.some((zone) => inside(pointer, zone))) return { x: 0, y: 0 };
  // The travel the bounds allow. A card that already pokes out of the bounds is never asked to move further in
  // than it sits today: zero is always allowed, the shift only may not push it (further) out.
  const minX = Math.min(0, bounds.left - card.left);
  const maxX = Math.max(0, bounds.right - card.right);
  const minY = Math.min(0, bounds.top - card.top);
  const maxY = Math.max(0, bounds.bottom - card.bottom);
  // Every shift that puts one zone edge just past the pointer, per axis; zero = that axis does not move.
  const xs = new Set<number>([0]);
  const ys = new Set<number>([0]);
  for (const zone of zones) {
    xs.add(Math.floor(pointer.x - zone.left) + 1); // card right: the zone's left edge passes the pointer
    xs.add(Math.ceil(pointer.x - zone.right) - 1); // card left
    ys.add(Math.floor(pointer.y - zone.top) + 1); // card down
    ys.add(Math.ceil(pointer.y - zone.bottom) - 1); // card up
  }
  let best: DodgePoint | null = null;
  let bestCost = Infinity;
  for (const x of xs) {
    if (x < minX || x > maxX) continue;
    for (const y of ys) {
      if (y < minY || y > maxY) continue;
      if (zones.some((zone) => inside(pointer, zone, x, y))) continue;
      // shortest travel wins; on a tie a one-axis move beats a diagonal one
      const cost = x * x + y * y + (x !== 0 && y !== 0 ? 0.5 : 0);
      if (cost < bestCost) { best = { x, y }; bestCost = cost; }
    }
  }
  return best;
}

/** The shift actually applied this layout: the chosen one, pulled back toward zero as far as needed to keep the
 *  card inside `bounds` (Astra 10-09: a kept shift defeated the anchor's own edge clamp and pushed the card out of
 *  the pitch host). `card` is the card at its normal, unshifted position. It never grows the shift, never flips its
 *  direction and never looks at the pointer: this is containment, not a second dodge. */
export function clampDodgeOffset(card: DodgeRect, offset: DodgePoint, bounds: DodgeRect): DodgePoint {
  const axis = (value: number, roomBack: number, roomForward: number) =>
    value < 0 ? Math.max(value, Math.min(0, roomBack)) : Math.min(value, Math.max(0, roomForward));
  return {
    x: axis(offset.x, bounds.left - card.left, bounds.right - card.right),
    y: axis(offset.y, bounds.top - card.top, bounds.bottom - card.bottom),
  };
}

/** How long after a card appears a pointer press on one of its buttons is still taken to be a click that was
 *  already on its way to the pitch. 200 ms sits at the fast end of human visual reaction time (roughly 180-250 ms
 *  to react to something appearing, before any reading or choosing): no coach can have seen the card, read it and
 *  aimed at an answer sooner, while a click committed before the card showed lands well inside it. It is shorter
 *  than the focus-click grace (250 ms) so a quick deliberate answer is never eaten. */
export const PROMPT_OPEN_GUARD_MS = 200;

/** THE guard rule (owner / coordinator 10-09, after three rounds of a window-level press tracker each grew new
 *  edge cases): a click on one of the card's answer buttons answers if and only if it was produced by a primary
 *  press that THE CARD ITSELF saw, at or after `openedAt + guardMs`.
 *
 *  Why that is enough, with no bookkeeping that can go stale:
 *  - a native click only targets a button when both the press and the release happened on it, so every real click
 *    on an answer button has its own press on the card;
 *  - a press that began before the card appeared (a held pointer) cannot produce a click on a card button at all;
 *    should an engine ever deliver one, it has no card-seen press and is dropped;
 *  - a fresh deliberate press after the window is always seen by the card and always answers, whatever happened
 *    before it and whatever other buttons or pointers are doing; other buttons never record;
 *  - there is no release tracking, so no lost release, no tail to expire and nothing carried across pointers.
 *  This function is the whole time rule: was that press late enough? */
export function promptPressAnswers(pressedAt: number, openedAt: number, guardMs = PROMPT_OPEN_GUARD_MS): boolean {
  return pressedAt >= openedAt + guardMs;
}

/** Is this pointer event a PRIMARY press (left mouse button, the first finger, a pen tip)? `button` is the button
 *  that changed, `buttons` the set held afterwards. A mouse sends `pointerdown` only for the first button pressed:
 *  a left press made while another button is already held arrives as a `pointermove` with `button === 0` and the
 *  primary bit set - it must count, or the answer buttons would be dead while a right button is held. Decided from
 *  this one event alone. */
export function isPrimaryPress(event: { type: string; button: number; buttons: number; isPrimary?: boolean; pointerType?: string }): boolean {
  if (event.button !== 0) return false;
  if (event.isPrimary === false && event.pointerType !== 'mouse') return false; // a second finger never clicks
  if (event.type === 'pointerdown') return true;
  return event.type === 'pointermove' && (event.buttons & 1) === 1;
}

/** The longest entry animation (delay + duration, ms) in a computed `animation-duration` / `animation-delay` pair;
 *  0 when the element does not animate. Used only where the engine cannot hold animations at their end state. */
export function entryAnimationMs(name: string | null | undefined, durations: string | null | undefined, delays: string | null | undefined): number {
  if (!name || name.split(',').every((n) => n.trim() === 'none' || n.trim() === '')) return 0;
  const ms = (value: string) => {
    const v = value.trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? (v.endsWith('ms') ? n : n * 1000) : 0;
  };
  const d = (durations ?? '').split(',').map(ms);
  const w = (delays ?? '').split(',').map(ms);
  let longest = 0;
  for (let i = 0; i < Math.max(d.length, 1); i++) longest = Math.max(longest, (d[i] ?? 0) + Math.max(0, w[i % Math.max(w.length, 1)] ?? 0));
  return longest;
}
