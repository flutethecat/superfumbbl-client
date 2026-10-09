/** DOM side of the decision-card dodge + open-click guard (owner 10-09; decisions in promptDodge.ts).
 *
 *  - a passive pointer POSITION tracker: where the pointer last was over the app. It reads events only - it never
 *    stops, prevents or sends anything - and knows nothing about presses;
 *  - the `v-prompt-dodge` directive for a decision card: on open it measures the card and its buttons where they
 *    will SETTLE (entry animation at its end state) and, if a button would sit under the pointer, opens the card
 *    shifted (CSS `translate`, so the shift rides on top of whatever left / top / transform the card's own
 *    positioning writes each frame - the offset stays relative to a moving anchor). It decides again only on a new
 *    prompt in the same element, on its anchor becoming known and on a window resize; never because the pointer
 *    moved. Every layout the applied shift is pulled back as far as needed to keep the card inside the pitch host.
 *    A dragged card loses the shift: the coach's position wins.
 *  - the open-click guard, entirely on the card (promptPressAnswers has the rule and why it is sound): the card's
 *    root records each primary press it sees and whether it came late enough; a pointer click on an answer button
 *    answers only with such a record, from a press on that same button. Dropping = stopping the DOM event in the
 *    capture phase before any handler sees it (the focusClickGuard idiom). */
import type { ObjectDirective } from 'vue';
import {
  clampDodgeOffset, entryAnimationMs, isPrimaryPress, promptDodgeMargin, promptDodgeOffset, promptPressAnswers,
  type DodgePoint, type DodgeRect,
} from './promptDodge';

/** The clickable controls of a reactive prompt card (also what a body drag must not start on). */
export const PROMPT_ANSWER_SELECTOR = 'button, .reroll-menu-item, .reroll-menu-decline, .bl-opt, .pick-confirm, .pick-decline, .sc-yes, .sc-no, .sendoff-btn, input, a, label, [role=button]';

// ── pointer tracker ──────────────────────────────────────────────────────────────────────────────────────────
let trackedPointer: DodgePoint | null = null;
let trackerUsers = 0;
let stopTracker: (() => void) | null = null;

const pointerIdOf = (event: Event): number | undefined => {
  const id = (event as PointerEvent).pointerId;
  return typeof id === 'number' ? id : undefined;
};

/** Last known pointer position over the app (client coordinates), or null when it is not known. */
export function promptPointerPosition(): DodgePoint | null {
  return trackedPointer ? { ...trackedPointer } : null;
}

/** Start tracking. Counted: every caller gets a release function, the listeners go with the last one (the Modern
 *  view releases on unmount, so nothing outlives it or piles up under HMR). */
export function installPromptPointerTracker(target: Window = window): () => void {
  trackerUsers++;
  if (!stopTracker) {
    const doc = target.document;
    const track = (event: Event) => {
      const e = event as PointerEvent;
      if (typeof e.clientX === 'number' && typeof e.clientY === 'number') trackedPointer = { x: e.clientX, y: e.clientY };
    };
    // a lifted / cancelled finger or pen is nowhere: the next tap can land anywhere, so there is nothing to dodge
    const end = (event: Event) => {
      const type = (event as PointerEvent).pointerType;
      if (type && type !== 'mouse') trackedPointer = null;
      else track(event);
    };
    // The pointer is somewhere we cannot see (outside the window, over the native website pane, another app in
    // front): its position is unknown - the next card takes its normal place and the open-click guard covers it.
    const gone = () => { trackedPointer = null; };
    const hidden = () => { if (doc.visibilityState === 'hidden') gone(); };
    const options = { capture: true, passive: true } as const;
    const root = doc.documentElement;
    for (const type of ['pointermove', 'pointerdown']) target.addEventListener(type, track, options);
    for (const type of ['pointerup', 'pointercancel']) target.addEventListener(type, end, options);
    root.addEventListener('pointerleave', gone);
    target.addEventListener('blur', gone);
    doc.addEventListener('visibilitychange', hidden);
    stopTracker = () => {
      for (const type of ['pointermove', 'pointerdown']) target.removeEventListener(type, track, options);
      for (const type of ['pointerup', 'pointercancel']) target.removeEventListener(type, end, options);
      root.removeEventListener('pointerleave', gone);
      target.removeEventListener('blur', gone);
      doc.removeEventListener('visibilitychange', hidden);
      trackedPointer = null;
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--trackerUsers > 0) return;
    trackerUsers = 0;
    stopTracker?.();
    stopTracker = null;
  };
}

// ── directive ────────────────────────────────────────────────────────────────────────────────────────────────
export interface PromptDodgeBinding {
  /** The coach has dragged this card (its remembered drag position is set): no dodge. */
  dragged?: boolean;
  /** Identifies the prompt shown in the element; a change is a new opening (decide again, guard again). */
  epoch?: unknown;
  /** Changes when the same prompt is laid out somewhere else without the pointer having a say (its anchor became
   *  known): the dodge is decided again, the guard window is NOT restarted - it runs from the prompt's first
   *  appearance (Astra 10-09: a late anchor re-armed the guard for another 200 ms). */
  layout?: unknown;
  /** The element the card must stay inside; defaults to the card's offset parent. */
  bounds?: () => Element | null | undefined;
}

interface CardState {
  /** First appearance of this prompt (epoch): the guard window runs from here and nothing else restarts it. */
  openedAt: number;
  /** The primary presses THIS card saw since this prompt opened, by pointer id: was the press late enough, and on
   *  which answer control (null = the card body, e.g. the start of a drag - such a press never answers anything).
   *  In press order. A record is consumed by its click, removed by pointercancel and replaced by that pointer's
   *  next press; a new prompt (epoch) clears them all. Nothing else touches them: no release, blur or timer is involved. */
  presses: Map<number, { ok: boolean; control: Element | null }>;
  epoch: unknown;
  layout: unknown;
  dragged: boolean;
  /** A measurement waiting for the entry animation to end (engines that cannot hold animations at their end). */
  settleTimer: ReturnType<typeof setTimeout> | null;
  /** When the element was inserted: its entry animation runs from here. */
  mountedAt: number;
  /** The shift decided at the opening; what is applied each layout is this, clamped to the bounds. */
  chosen: DodgePoint;
  applied: DodgePoint;
  binding: PromptDodgeBinding;
  releaseTracker: () => void;
  onPress: (event: Event) => void;
  onCancel: (event: Event) => void;
  onClick: (event: Event) => void;
  onResize: () => void;
}
const cards = new WeakMap<HTMLElement, CardState>();
const ZERO: DodgePoint = { x: 0, y: 0 };

const rectOf = (el: Element): DodgeRect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};
const unshift = (r: DodgeRect, by: DodgePoint): DodgeRect => ({ left: r.left - by.x, top: r.top - by.y, right: r.right - by.x, bottom: r.bottom - by.y });

/** Run `measure` with the element's own animations held at their END state, then put them back where they were.
 *  A card is measured where it will settle, not where its entry animation happens to have it (Astra 10-09: the
 *  skill card's `forwards` animation ends on a different transform than the card's resting style, so its buttons
 *  settled half a card away from where they were measured). Nothing visible changes: it is all within one task.
 *  `settled` is false when the engine cannot do this (no getAnimations, or it throws): the measurement is then of
 *  the current frame and the caller decides whether that is good enough. Never throws. */
function atSettledLayout<T>(el: HTMLElement, measure: () => T): { value: T; settled: boolean } {
  const held: Array<{ animation: Animation; time: Animation['currentTime'] }> = [];
  let settled = true;
  try {
    if (typeof el.getAnimations !== 'function') settled = false;
    else {
      for (const animation of el.getAnimations()) {
        const end = Number(animation.effect?.getComputedTiming().endTime);
        if (!Number.isFinite(end)) continue; // an endless animation has no settled state
        const time = animation.currentTime;
        animation.currentTime = end;
        held.push({ animation, time });
      }
    }
  } catch {
    settled = false;
  }
  try {
    return { value: measure(), settled };
  } finally {
    for (const { animation, time } of held) {
      try { animation.currentTime = time ?? 0; } catch { /* a removed animation */ }
    }
  }
}

/** How long until the card's entry animation is over (ms from now; 0 = it is, or there is none). */
function animationRemainingMs(el: HTMLElement, state: CardState): number {
  try {
    const style = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
    const total = entryAnimationMs(style.animationName, style.animationDuration, style.animationDelay);
    return Math.max(0, total - (performance.now() - state.mountedAt));
  } catch {
    return 0;
  }
}

function boundsOf(el: HTMLElement, binding: PromptDodgeBinding): DodgeRect {
  const view = el.ownerDocument.defaultView ?? window;
  const viewport: DodgeRect = { left: 0, top: 0, right: view.innerWidth, bottom: view.innerHeight };
  const host = binding.bounds?.() ?? el.offsetParent;
  if (!host) return viewport;
  const r = rectOf(host);
  if (r.right - r.left <= 0 || r.bottom - r.top <= 0) return viewport;
  return {
    left: Math.max(r.left, viewport.left), top: Math.max(r.top, viewport.top),
    right: Math.min(r.right, viewport.right), bottom: Math.min(r.bottom, viewport.bottom),
  };
}

function apply(el: HTMLElement, state: CardState, offset: DodgePoint) {
  state.applied = offset;
  const value = offset.x === 0 && offset.y === 0 ? '' : `${offset.x}px ${offset.y}px`;
  if (el.style.getPropertyValue('translate') === value) return;
  if (value) el.style.setProperty('translate', value);
  else el.style.removeProperty('translate');
}

/** A new opening / layout (or a resize): measure the card at its normal, settled position and choose the shift.
 *  `pointer` is given only by the deferred run below: it then uses the pointer as it was at the opening, so a
 *  late measurement can never flee a pointer that has since moved onto a button. */
function decide(el: HTMLElement, state: CardState, pointer: DodgePoint | null = promptPointerPosition()) {
  if (state.settleTimer !== null) { clearTimeout(state.settleTimer); state.settleTimer = null; }
  state.chosen = ZERO;
  apply(el, state, ZERO);
  if (state.dragged || !pointer) return;
  const { value: measured, settled } = atSettledLayout(el, () => ({
    card: rectOf(el),
    buttons: Array.from(el.querySelectorAll(PROMPT_ANSWER_SELECTOR)).map(rectOf).filter((r) => r.right - r.left > 0 && r.bottom - r.top > 0),
  }));
  if (!settled) {
    // The animations could not be held at their end (API missing or throwing). Mid-animation boxes are not where
    // the buttons will be, so wait the animation out and measure then - against the pointer of the OPENING. Until
    // then the card keeps its normal place and the open-click guard covers it.
    const wait = animationRemainingMs(el, state);
    if (wait > 0) {
      state.settleTimer = setTimeout(() => { state.settleTimer = null; if (cards.get(el) === state) decide(el, state, pointer); }, wait + 34);
      return;
    }
  }
  const view = el.ownerDocument.defaultView ?? window;
  const textSize = parseFloat(view.getComputedStyle(el.ownerDocument.documentElement).getPropertyValue('--ui-min-text-size'));
  const offset = promptDodgeOffset({ ...measured, pointer, bounds: boundsOf(el, state.binding), margin: promptDodgeMargin(textSize) });
  // null = no room to clear the pointer: the card keeps its normal position and the open-click guard covers it
  if (!offset) return;
  state.chosen = offset;
  apply(el, state, offset);
}

/** Every layout while a shift is in force: the anchor may have carried the card to an edge where the anchor's own
 *  clamp holds it - the shift must not push it out past that. Containment only: the pointer is never consulted. */
function contain(el: HTMLElement, state: CardState) {
  if (state.chosen.x === 0 && state.chosen.y === 0) return;
  // the card's own style binding can drop the whole style attribute (anchored -> unanchored): the shift went with it
  if (el.style.getPropertyValue('translate') === '') state.applied = ZERO;
  const base = unshift(atSettledLayout(el, () => rectOf(el)).value, state.applied);
  apply(el, state, clampDodgeOffset(base, state.chosen, boundsOf(el, state.binding)));
}

const answerControl = (el: HTMLElement, target: EventTarget | null): Element | null => {
  const node = target as Element | null;
  if (!node?.closest || !el.contains(node)) return null;
  const control = node.closest(PROMPT_ANSWER_SELECTOR);
  return control && el.contains(control) ? control : null;
};

const MAX_PRESS_RECORDS = 16;
const sameControl = (pressed: Element | null, clicked: Element | null): boolean =>
  pressed === clicked || (!!pressed && !!clicked && (pressed.contains(clicked) || clicked.contains(pressed)));

/** Capture `pointerdown` / `pointermove` on the card root: record a primary press the card itself sees. The map is
 *  kept in press order (a pointer pressing again moves to the end). */
function recordPress(el: HTMLElement, state: CardState, event: Event) {
  const e = event as PointerEvent;
  if (!isPrimaryPress({ type: e.type, button: Number(e.button ?? -1), buttons: Number(e.buttons ?? 0), isPrimary: e.isPrimary, pointerType: e.pointerType })) return;
  const id = pointerIdOf(event) ?? 1;
  state.presses.delete(id);
  if (state.presses.size >= MAX_PRESS_RECORDS) {
    // touch pointer ids keep counting up: make room by dropping ONE record - a body press (it can never answer) if
    // there is one, else the oldest. Never the whole map (Astra N7: that dropped a held press's own click).
    let evict: number | undefined;
    for (const [key, record] of state.presses) {
      if (evict === undefined) evict = key;
      if (!record.control) { evict = key; break; }
    }
    if (evict !== undefined) state.presses.delete(evict);
  }
  state.presses.set(id, { ok: promptPressAnswers(performance.now(), state.openedAt), control: answerControl(el, event.target) });
}

/** Capture `click` on the card root. Keyboard / programmatic activation (detail 0, pointer id -1) is never guarded.
 *  A pointer click consumes its pointer's record and answers only if that press was late enough and on this same
 *  control; with no record - the press began before the card existed, or somewhere else - it is dropped.
 *  "Same control" is node identity / containment: a button whose DOM node were REPLACED between press and click
 *  would drop - no same-prompt path replaces a button node (Vue patches them in place; Astra 10-09 found none). */
function clickGuard(el: HTMLElement, state: CardState, event: Event) {
  const id = pointerIdOf(event);
  if (((event as MouseEvent).detail ?? 0) === 0 || id === -1) return;
  const control = answerControl(el, event.target);
  let answers: boolean;
  if (id !== undefined) {
    const press = state.presses.get(id);
    state.presses.delete(id);
    answers = !!press?.ok && !!press.control && sameControl(press.control, control);
  } else {
    // An engine whose clicks carry no pointer id: the click cannot be tied to one pointer, so every press the card
    // saw on THIS control speaks. Conservative and order-true: if any of them began inside the window the click is
    // dropped, otherwise it answers; either way the OLDEST of them is spent (clicks arrive in press order). With
    // two pointers on one button nothing that began in the window can answer; at worst one extra click is needed.
    let oldest: number | undefined;
    let allOk = true;
    for (const [key, record] of state.presses) {
      if (!sameControl(record.control, control)) continue;
      if (oldest === undefined) oldest = key;
      if (!record.ok) allOk = false;
    }
    if (oldest !== undefined) state.presses.delete(oldest);
    answers = oldest !== undefined && allOk;
  }
  if (!control || answers) return; // the card body has nothing to answer (its record is spent all the same)
  event.stopImmediatePropagation();
  event.preventDefault();
}

/** `v-prompt-dodge="{ dragged, epoch, bounds }"` on a decision card's root element. */
export const vPromptDodge: ObjectDirective<HTMLElement, PromptDodgeBinding | undefined> = {
  mounted(el, { value }) {
    const view = el.ownerDocument.defaultView ?? window;
    const binding = value ?? {};
    const state: CardState = {
      openedAt: performance.now(),
      epoch: binding.epoch,
      layout: binding.layout,
      dragged: !!binding.dragged,
      settleTimer: null,
      mountedAt: performance.now(),
      chosen: ZERO,
      applied: ZERO,
      binding,
      presses: new Map(),
      releaseTracker: installPromptPointerTracker(view),
      onPress: (event) => recordPress(el, state, event),
      onCancel: (event) => { state.presses.delete(pointerIdOf(event) ?? 1); },
      onClick: (event) => clickGuard(el, state, event),
      onResize: () => decide(el, state),
    };
    cards.set(el, state);
    // all on the card root, capture phase: the buttons inside may be re-rendered freely, these stay
    for (const type of ['pointerdown', 'pointermove']) el.addEventListener(type, state.onPress, true);
    el.addEventListener('pointercancel', state.onCancel, true);
    el.addEventListener('click', state.onClick, true); // primary activations only: nothing else answers a card
    view.addEventListener('resize', state.onResize);
    decide(el, state);
  },
  updated(el, { value }) {
    const state = cards.get(el);
    if (!state) return;
    const binding = value ?? {};
    state.binding = binding;
    if (!Object.is(binding.epoch, state.epoch)) {
      // a new prompt in the same element: a new opening
      state.epoch = binding.epoch;
      state.layout = binding.layout;
      state.dragged = !!binding.dragged;
      state.openedAt = performance.now();
      state.presses.clear(); // a press on the previous prompt's buttons answers nothing here
      decide(el, state);
      return;
    }
    // dragged: the coach's position wins for the rest of this prompt (the shift is dropped, never re-applied)
    if (binding.dragged && !state.dragged) {
      state.dragged = true;
      if (state.settleTimer !== null) { clearTimeout(state.settleTimer); state.settleTimer = null; }
      state.chosen = ZERO;
      apply(el, state, ZERO);
      return;
    }
    if (!Object.is(binding.layout, state.layout)) {
      // same prompt, laid out elsewhere (its anchor became known): choose the shift again; `openedAt` stays - the
      // guard window runs from the prompt's first appearance and is never restarted
      state.layout = binding.layout;
      decide(el, state);
      return;
    }
    contain(el, state);
  },
  beforeUnmount(el) {
    const state = cards.get(el);
    if (!state) return;
    for (const type of ['pointerdown', 'pointermove']) el.removeEventListener(type, state.onPress, true);
    el.removeEventListener('pointercancel', state.onCancel, true);
    el.removeEventListener('click', state.onClick, true);
    if (state.settleTimer !== null) clearTimeout(state.settleTimer);
    (el.ownerDocument.defaultView ?? window).removeEventListener('resize', state.onResize);
    state.releaseTracker();
    cards.delete(el);
  },
};
