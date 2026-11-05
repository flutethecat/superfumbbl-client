/**
 * Controller support P2b (owner 10-07, spec-controller-support.md rounds 2-5): generic focus for server cards and
 * confirmations.
 *
 * A card root carries `v-pad-focus` (directive below). While at least one such card is mounted and has an actionable
 * control, the TOPMOST (last mounted) one owns the pad:
 *  - D-pad / left-stick directions move a focus ring among its controls (geometry-aware: rows and columns of a grid;
 *    DOM order when the layout has no geometry, e.g. a headless test),
 *  - A activates the focused control (a real `click()` — the card's own handler, no second code path),
 *  - B = the card's cancel / decline (`cancel` option, else the control marked `data-pad-cancel`), otherwise INERT
 *    (owner round 3: B does nothing on a mandatory choice),
 *  - X / Y / LB / RB / View run the card's own key bindings (`keys` option, or a control marked `data-pad-key="X"`).
 * Default focus = the control marked `data-pad-primary`, else the first control that is not a decline.
 *
 * Pitch scopes (`pitch: true`, e.g. a player-pick bar over an armed pitch pick): A and the directions stay with the
 * pitch crosshair; only B and the key bindings are taken.
 *
 * The ring never moves DOM focus (a card popping up must not steal the chat input): it is a virtual focus drawn by
 * the overlay (components/PadFocusOverlay.vue). Keyboard Tab moves real focus; a `focusin` inside a scope moves the
 * ring with it, so the ring is also a keyboard aid (nothing controller-only). Glyph badges show in controller mode.
 */
import { ref, shallowRef, type Directive } from 'vue';
import { activeInput, setCameraStickDirectionTaker, type ActiveInput } from './controls';
import type { PadEvent } from './gamepad';
import { promptCardAcceptsPress } from './promptDodgeDom';

export type PadFocusKey = 'X' | 'Y' | 'LB' | 'RB' | 'View';
export type PadDir = 'Up' | 'Down' | 'Left' | 'Right';
export interface PadFocusOptions {
  /** B. Absent = the `[data-pad-cancel]` control, else B is inert. */
  cancel?: (() => void) | null;
  keys?: Partial<Record<PadFocusKey, () => void>>;
  /** A + directions stay with the pitch crosshair (pick bars over an armed pitch pick). */
  pitch?: boolean;
  /** Not focus-owning right now (a spectator view of the card, …). */
  disabled?: boolean;
  /** Stacking priority (Astra P1-1): the open card with the highest priority owns the pad — not the last mounted.
   *  Ties: the higher computed z-index, then the later in DOM order, then the later registered. */
  priority?: number;
  /** A MANDATORY server choice (block dice pick, team chooser, a required list, the Kick election, ...): it outranks
   *  every confirmation / dismissable card while open (Astra P2-a), and B is always inert on it. */
  mandatory?: boolean;
  /** Owner 10-15 (Astra r12): a client MODAL notice (the match-start beta notice, the declaration watcher's card). It
   *  outranks every other scope, mandatory server cards included, and swallows every pad input it does not use, so
   *  nothing behind it (a hidden server card, View's End Turn / Confirm Setup) is reachable while it is up. B runs its
   *  cancel / decline when it has one, otherwise it is inert. */
  exclusive?: boolean;
  /** A scrollable body inside the card: the right stick scrolls it (Up / Down, with the stick's repeat). Given the
   *  step's direction, so a card with nested scroll boxes can hand the step to the box that can still move that way. */
  scroll?: (direction: 'Up' | 'Down') => HTMLElement | null;
}

/** One right-stick step of a card's scrollable body, in pixels. */
export const PAD_SCROLL_STEP_PX = 80;

/** Host priorities, applied AFTER the mandatory rank (a mandatory server card always comes first): among the rest the
 *  unanswered-prompt panel, then confirmations, then server cards, informational notices last. */
export const PAD_FOCUS_PRIORITY = { unknownPanel: 100, confirmation: 80, card: 50, info: 10 } as const;

export const PAD_FOCUS_SELECTOR = [
  'button', '[data-pad-focus]', '[role="option"]', '[role="menuitem"]', '[role="button"]', 'a[href]',
  'input:not([type="hidden"])', 'select', 'li.reroll-menu-item',
].join(', ');

interface Scope {
  el: HTMLElement;
  options: PadFocusOptions;
  focused: HTMLElement | null;
  order: number;
  /** The ring was moved by keyboard Tab (shown in mouse mode too). */
  keyboard: boolean;
  onFocusIn(event: Event): void;
  onPointerDown(event: Event): void;
}

const scopes: Scope[] = [];
let scopeOrder = 0;
/** Swallow the release of an LB / RB press a card consumed (the router acts on a plain LB at release). */
const consumedPress = new Set<string>();
/** True while a pad input must not reach the cards (a shell modal is open). */
let guard: () => boolean = () => false;
export function setPadFocusGuard(fn: (() => boolean) | null): void { guard = fn ?? (() => false); }

let activeState: { value: ActiveInput } = activeInput;
/** Tests: read a different active-input state. */
export function setPadFocusInputState(state: { value: ActiveInput } | null): void { activeState = state ?? activeInput; }

/** Mounted scopes (the overlay runs its frame loop only while there are any). */
export const padFocusScopeCount = ref(0);
/** A focus-owning (non-pitch) card is up — the crosshair hides. */
export const padFocusOwnsInput = ref(false);

export interface PadFocusRect { left: number; top: number; width: number; height: number }
export interface PadFocusBadge { name: string; rect: PadFocusRect }
export interface PadFocusView {
  /** The focus ring, or null when hidden. */
  ring: PadFocusRect | null;
  /** Glyph badges beside controls (controller mode only): A at the ring, B at the decline, X / Y at key controls. */
  badges: PadFocusBadge[];
}
export const padFocusView = shallowRef<PadFocusView>({ ring: null, badges: [] });

function hiddenEl(el: HTMLElement): boolean {
  if (el.closest('[hidden], [aria-hidden="true"], [data-pad-skip]')) return true;
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return true;
  const style = el.style;
  return style.display === 'none' || style.visibility === 'hidden';
}

/** The actionable controls of a card, DOM order. Nested scopes' controls belong to the nested scope. */
export function focusableControls(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>(PAD_FOCUS_SELECTOR).forEach((el) => {
    if (hiddenEl(el)) return;
    const owner = el.parentElement?.closest('[data-pad-scope]');
    if (owner && owner !== root && root.contains(owner)) return;
    out.push(el);
  });
  return out;
}

/** Default focus: the primary, else the first control that is not a decline — never a decline (Astra P3: a card whose
 *  only live control is its decline starts with no focus; B / a direction reaches it). */
function defaultControl(items: HTMLElement[]): HTMLElement | null {
  return items.find((el) => el.hasAttribute('data-pad-primary'))
    ?? items.find((el) => !el.hasAttribute('data-pad-cancel'))
    ?? null;
}

/** The z-index a host paints at: its own or its nearest positioned ancestor's numeric computed z-index (0 if none). */
function stackZ(el: HTMLElement): number {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    let z = '';
    try { z = getComputedStyle(node).zIndex; } catch { z = node.style.zIndex; }
    const n = Number.parseInt(z, 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
/** Positive when `a` stacks above `b`. */
function compareStack(a: Scope, b: Scope): number {
  const ea = a.options.exclusive ? 1 : 0;
  const eb = b.options.exclusive ? 1 : 0;
  if (ea !== eb) return ea - eb; // a client modal notice above everything
  const ma = a.options.mandatory ? 1 : 0;
  const mb = b.options.mandatory ? 1 : 0;
  if (ma !== mb) return ma - mb; // a mandatory server card first, whatever its priority
  const pa = a.options.priority ?? PAD_FOCUS_PRIORITY.card;
  const pb = b.options.priority ?? PAD_FOCUS_PRIORITY.card;
  if (pa !== pb) return pa - pb;
  const za = stackZ(a.el);
  const zb = stackZ(b.el);
  if (za !== zb) return za - zb;
  if (a.el !== b.el) {
    const pos = a.el.compareDocumentPosition(b.el);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1; // b after a → b on top
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  }
  return a.order - b.order;
}

/** A pad press on a control: a real click event with detail 1 (a pointer-style activation — handlers that ignore
 *  keyboard-synthesised clicks, `detail === 0`, still accept the pad, Astra P2-4).
 *  Public integration (10-10): decision cards carry the open-click guard since 1.0.153 (game/promptDodgeDom.ts): a
 *  pointer click answers only with a press the card itself saw. The pad has no pointer press, so (a) its click carries
 *  pointer id -1 — the id of a keyboard activation, which the guard never drops — and (b) the press is held to the
 *  guard's own time rule instead: one that lands inside the window after the prompt opened answers nothing. Returns
 *  whether the control was activated. */
export function padActivate(el: HTMLElement): boolean {
  if (!promptCardAcceptsPress(el)) return false;
  const view = el.ownerDocument?.defaultView as (Window & typeof globalThis) | null;
  const init = { bubbles: true, cancelable: true, composed: true, detail: 1 };
  const PointerEventCtor = view?.PointerEvent ?? (typeof PointerEvent !== 'undefined' ? PointerEvent : undefined);
  let event: Event;
  if (PointerEventCtor) event = new PointerEventCtor('click', { ...init, pointerId: -1 });
  else {
    event = new (view?.MouseEvent ?? MouseEvent)('click', init);
    Object.defineProperty(event, 'pointerId', { value: -1 });
  }
  el.dispatchEvent(event);
  return true;
}

let mandatoryPitch: () => boolean = () => false;
/** Astra P2-a: a mandatory PITCH choice (push direction, kick aim) has no DOM card to rank, so while it is open no
 *  card owns the pad unless it is itself mandatory: A / the stick reach the crosshair, B stays inert. */
export function setPadFocusMandatoryPitch(fn: (() => boolean) | null): void { mandatoryPitch = fn ?? (() => false); }

/** Owner 10-10 (controller support is opt-in): while off no card owns anything — no ring (keyboard Tab included), no
 *  badges, `padFocusOwnsInput` stays false, no Tab listener. Scopes still register (bookkeeping only), so ticking the
 *  box takes effect on the cards already open. */
let enabled = false;
export function setPadFocusEnabled(on: boolean): void {
  enabled = on;
  if (on) watchTab(); else unwatchTab();
  refreshPadFocus();
}
export function padFocusEnabled(): boolean { return enabled; }

function liveScopes(): Scope[] {
  if (!enabled) return [];
  const pitchHeld = mandatoryPitch();
  return scopes.filter((s) => !s.options.disabled && s.el.isConnected && focusableControls(s.el).length > 0
    && (!pitchHeld || !!s.options.mandatory || !!s.options.exclusive)); // Astra r13: a modal notice keeps the pad
}
/** The card that owns the pad (topmost focus-owning scope), or null. */
function activeScope(): Scope | null {
  const live = liveScopes();
  return live.length ? live.reduce((a, b) => (compareStack(b, a) > 0 ? b : a)) : null;
}

function ensureFocus(scope: Scope): HTMLElement | null {
  const items = focusableControls(scope.el);
  if (!scope.focused || !items.includes(scope.focused)) { scope.focused = defaultControl(items); scope.keyboard = false; }
  return scope.focused;
}

function rectOf(el: Element): PadFocusRect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * The control a direction moves to from `from`. With geometry: the nearest control whose centre lies in that
 * direction (a cone of ±60°), weighting sideways drift double — rows and columns of a grid fall out of it; nothing
 * there = stay. Without geometry (all rects empty): DOM order, Up / Left = previous, Down / Right = next, wrapping.
 */
export function nextControl(items: HTMLElement[], from: HTMLElement | null, dir: PadDir): HTMLElement | null {
  if (!items.length) return null;
  const i = from ? items.indexOf(from) : -1;
  if (i < 0) return defaultControl(items) ?? items[0]!;
  const rects = items.map(rectOf);
  const flat = rects.every((r) => r.width === 0 && r.height === 0);
  if (flat) {
    const step = dir === 'Up' || dir === 'Left' ? -1 : 1;
    return items[(i + step + items.length) % items.length]!;
  }
  const c = (r: PadFocusRect): { x: number; y: number } => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const o = c(rects[i]!);
  // Astra P2-e: controls drawn on the same screen point (Kick election candidates clamped to one spot) are walked in
  // logical (DOM) order first: Right / Down to the next of the stack, Left / Up to the previous, then on by geometry.
  const stack = items.filter((_, j) => { const p = c(rects[j]!); return Math.hypot(p.x - o.x, p.y - o.y) < 1; });
  if (stack.length > 1) {
    const k = stack.indexOf(items[i]!);
    const forward = dir === 'Right' || dir === 'Down';
    const next = stack[k + (forward ? 1 : -1)];
    if (next) return next;
  }
  const [ux, uy] = dir === 'Left' ? [-1, 0] : dir === 'Right' ? [1, 0] : dir === 'Up' ? [0, -1] : [0, 1];
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  items.forEach((el, j) => {
    if (j === i) return;
    const p = c(rects[j]!);
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    const along = dx * ux + dy * uy;
    const side = Math.abs(dx * uy - dy * ux);
    if (along <= 0.5 || side > along * Math.tan(Math.PI / 3)) return;
    if (stack.includes(el)) return;
    const score = along + side * 2;
    if (score < bestScore) { bestScore = score; best = el; }
  });
  return best ?? items[i]!;
}

function controllerMode(): boolean { return activeState.value === 'controller'; }
/** True while the controller is the active input (the mode in which a card's pad focus, not the keyboard's, acts). */
export function padFocusControllerMode(): boolean { return controllerMode(); }

/** Recompute the overlay (ring + glyph badges) and `padFocusOwnsInput`. Cheap; the overlay calls it per frame. */
export function refreshPadFocus(): void {
  const scope = activeScope();
  padFocusOwnsInput.value = !!scope && !scope.options.pitch;
  if (!scope) { if (padFocusView.value.ring || padFocusView.value.badges.length) padFocusView.value = { ring: null, badges: [] }; return; }
  const focused = scope.options.pitch ? null : ensureFocus(scope);
  const pad = controllerMode();
  const showRing = !!focused && (pad || scope.keyboard);
  const badges: PadFocusBadge[] = [];
  if (pad) {
    if (focused) badges.push({ name: 'A', rect: rectOf(focused) });
    for (const el of focusableControls(scope.el)) {
      const key = el.getAttribute('data-pad-key');
      if (key) badges.push({ name: key, rect: rectOf(el) });
      else if (el.hasAttribute('data-pad-cancel') && !scope.options.cancel) badges.push({ name: 'B', rect: rectOf(el) });
    }
  }
  padFocusView.value = { ring: showRing && focused ? rectOf(focused) : null, badges };
}

function typingOutside(scope: Scope): boolean {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  return el instanceof HTMLElement && !!el.closest('input, textarea, select, [contenteditable="true"]') && !scope.el.contains(el);
}

function runKey(scope: Scope, key: string): boolean {
  const fn = scope.options.keys?.[key as PadFocusKey];
  if (fn) { fn(); return true; }
  const el = focusableControls(scope.el).find((c) => c.getAttribute('data-pad-key') === key);
  if (el) { padActivate(el); return true; }
  return false;
}

/** The focused control of the owning card (for card bindings that act on it, e.g. inducement remove). */
export function padFocusedControl(): HTMLElement | null {
  const scope = activeScope();
  return scope && !scope.options.pitch ? ensureFocus(scope) : null;
}

/** Sol r4: the router keeps the camera stick's directions for the camera, except while the card that owns the pad has a
 *  `scroll` body - then the right stick's steps come here and scroll it. */
setCameraStickDirectionTaker((event) => {
  if (event.type !== 'direction' || event.stick !== 'right' || !controllerMode() || guard()) return false;
  const scope = activeScope();
  return !!scope && !scope.options.pitch && !!scope.options.scroll;
});

/** Pad router interceptor: true = the card consumed the event. */
export function handlePadFocusEvent(event: PadEvent): boolean {
  if (event.type === 'release') {
    if (consumedPress.delete(event.input)) return true;
    return false;
  }
  if (event.type !== 'press' && event.type !== 'direction') return false;
  if (!controllerMode() || guard()) return false;
  const scope = activeScope();
  if (!scope || typingOutside(scope)) return false;
  const pitch = !!scope.options.pitch;
  const move = (dir: PadDir): boolean => {
    if (pitch) return false;
    const items = focusableControls(scope.el);
    const next = nextControl(items, ensureFocus(scope), dir);
    if (next) { scope.focused = next; scope.keyboard = false; }
    refreshPadFocus();
    return true;
  };
  if (event.type === 'direction') {
    if (event.stick === 'left') return move(event.direction);
    const body = event.stick === 'right' && (event.direction === 'Up' || event.direction === 'Down') ? scope.options.scroll?.(event.direction) ?? null : null;
    if (!body) return false;
    body.scrollTop += event.direction === 'Down' ? PAD_SCROLL_STEP_PX : -PAD_SCROLL_STEP_PX;
    refreshPadFocus();
    return true;
  }
  switch (event.input) {
    case 'DpadUp': return move('Up');
    case 'DpadDown': return move('Down');
    case 'DpadLeft': return move('Left');
    case 'DpadRight': return move('Right');
    case 'A': {
      if (pitch) return false;
      const focused = ensureFocus(scope);
      if (focused) padActivate(focused);
      refreshPadFocus();
      return true;
    }
    case 'B': {
      if (scope.options.mandatory && !scope.options.exclusive) return true; // never answers a mandatory server choice
      if (scope.options.cancel) { scope.options.cancel(); return true; }
      const decline = focusableControls(scope.el).find((c) => c.hasAttribute('data-pad-cancel'));
      if (decline) { padActivate(decline); return true; }
      return !pitch; // inert on a mandatory card; a pitch pick's B goes on to the pitch cancel (itself inert there)
    }
    case 'X': case 'Y': case 'LB': case 'RB': case 'View': {
      if (runKey(scope, event.input)) {
        if (event.input === 'LB' || event.input === 'RB') consumedPress.add(event.input);
        refreshPadFocus();
        return true;
      }
      // X / Y must not open the pitch context menu / player card behind a focus-owning card.
      if (scope.options.exclusive) { consumedPress.add(event.input); return true; } // a modal notice swallows the rest
      return !pitch && (event.input === 'X' || event.input === 'Y');
    }
    default:
      if (scope.options.exclusive) { consumedPress.add(event.input); return true; }
      return false;
  }
}

function normalise(value: PadFocusOptions | boolean | null | undefined): PadFocusOptions {
  if (value === false) return { disabled: true };
  return value && typeof value === 'object' ? value : {};
}

let lastTabAt = Number.NEGATIVE_INFINITY;
let tabListener = false;
const onTabKey = (e: KeyboardEvent): void => { if (e.key === 'Tab') lastTabAt = Date.now(); };
function watchTab(): void {
  if (tabListener || typeof window === 'undefined') return;
  tabListener = true;
  window.addEventListener('keydown', onTabKey, { capture: true, passive: true });
}
function unwatchTab(): void {
  if (!tabListener || typeof window === 'undefined') return;
  tabListener = false;
  window.removeEventListener('keydown', onTabKey, { capture: true });
}

export function registerPadFocusScope(el: HTMLElement, options: PadFocusOptions = {}): void {
  if (enabled) watchTab();
  unregisterPadFocusScope(el);
  const scope: Scope = {
    el, options, focused: null, order: ++scopeOrder, keyboard: false,
    onFocusIn(event) {
      const t = event.target instanceof HTMLElement ? event.target : null;
      if (!t || !focusableControls(el).includes(t)) return;
      scope.focused = t;
      // A Tab just pressed (or the browser's own keyboard-focus heuristic) = a keyboard move: the ring shows.
      let visible = false;
      try { visible = t.matches(':focus-visible'); } catch { visible = false; }
      scope.keyboard = visible || Date.now() - lastTabAt < 1000;
      refreshPadFocus();
    },
    onPointerDown(event) {
      const t = event.target instanceof Element ? event.target.closest<HTMLElement>(PAD_FOCUS_SELECTOR) : null;
      if (t && focusableControls(el).includes(t)) { scope.focused = t; scope.keyboard = false; }
    },
  };
  el.setAttribute('data-pad-scope', '');
  el.addEventListener('focusin', scope.onFocusIn);
  el.addEventListener('pointerdown', scope.onPointerDown, { capture: true });
  scopes.push(scope);
  padFocusScopeCount.value = scopes.length;
  refreshPadFocus();
}
export function updatePadFocusScope(el: HTMLElement, options: PadFocusOptions): void {
  const scope = scopes.find((s) => s.el === el);
  if (!scope) { registerPadFocusScope(el, options); return; }
  scope.options = options;
  refreshPadFocus();
}
export function unregisterPadFocusScope(el: HTMLElement): void {
  const i = scopes.findIndex((s) => s.el === el);
  if (i < 0) return;
  const [scope] = scopes.splice(i, 1);
  el.removeEventListener('focusin', scope!.onFocusIn);
  el.removeEventListener('pointerdown', scope!.onPointerDown, { capture: true });
  el.removeAttribute('data-pad-scope');
  padFocusScopeCount.value = scopes.length;
  refreshPadFocus();
}
/** Tests: drop every scope. */
export function resetPadFocus(): void {
  for (const s of [...scopes]) unregisterPadFocusScope(s.el);
  consumedPress.clear();
  refreshPadFocus();
}

/** `v-pad-focus` / `v-pad-focus="{ cancel, keys, pitch }"` / `v-pad-focus="false"`. */
export const vPadFocus: Directive<HTMLElement, PadFocusOptions | boolean | null | undefined> = {
  mounted(el, binding) { registerPadFocusScope(el, normalise(binding.value)); },
  updated(el, binding) { updatePadFocusScope(el, normalise(binding.value)); },
  beforeUnmount(el) { unregisterPadFocusScope(el); },
};
