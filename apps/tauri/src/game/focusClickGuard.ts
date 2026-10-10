/** Owner 10-05: "A first click on an unfocused window should be swallowed by the client. Click focuses the window,
 *  next click accepts input."
 *
 *  A click that brings the window back into focus is a "give me the window" gesture, not an order: on the pitch it
 *  used to select a player, plot a step or answer a prompt. While the window is not focused the guard is armed; the
 *  pointer press that arrives as (or just after) the window regains focus is swallowed together with the rest of
 *  THAT pointer's gesture (release, click, context menu) - however long it is held and however late its click comes.
 *  Focus regained WITHOUT a click (Alt+Tab, taskbar) disarms after a short grace, so the next real click is never
 *  eaten. Other pointers and the keyboard are never touched. Nothing is sent and nothing is held: it only drops DOM
 *  events at the window, before any handler sees them. */
export const FOCUS_CLICK_GRACE_MS = 250;

/** Owner 10-08 (the floating FUMBBL window): a press on an element carrying this attribute (or inside one) is never
 *  swallowed. The site in that window is a separate native webview: a click into it takes keyboard focus away from
 *  this page (the window "blurs" although the app never left the foreground), and the frame's own header - move,
 *  Return, Close - must answer the very next press. Such a press is no order to the pitch; it still disarms the guard,
 *  because it is the press that brought focus back. */
export const FOCUS_CLICK_THROUGH_ATTRIBUTE = 'data-focus-click-through';

function pressIsExempt(event: Event): boolean {
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  return typeof target?.closest === 'function' && target.closest(`[${FOCUS_CLICK_THROUGH_ATTRIBUTE}]`) != null;
}

export interface FocusClickState {
  /** The window lost focus and has not yet been clicked back / grace-expired. */
  armed: boolean;
  /** When focus came back (0 while blurred or disarmed). */
  focusedAt: number;
}

export const initialFocusClickState = (): FocusClickState => ({ armed: false, focusedAt: 0 });

export function onWindowBlur(): FocusClickState {
  return { armed: true, focusedAt: 0 };
}

export function onWindowFocus(state: FocusClickState, now: number): FocusClickState {
  return state.armed ? { ...state, focusedAt: now } : state;
}

/** A pointer PRESS: is it the click that focused the window? Either way the guard disarms. */
export function onPress(state: FocusClickState, now: number, hasFocus: boolean, graceMs = FOCUS_CLICK_GRACE_MS): { state: FocusClickState; swallow: boolean } {
  if (!state.armed) return { state, swallow: false };
  // still unfocused (the press arrived before the focus event), or it is the press that came with the focus;
  // otherwise focus came back some time ago without a click (Alt+Tab) and this is a real click
  const focusing = !hasFocus || state.focusedAt === 0 || now - state.focusedAt <= graceMs;
  return { state: initialFocusClickState(), swallow: focusing };
}

/** The one swallowed gesture, identified by its pointer (Astra 10-05: a shared flag let a second touch or a late
 *  release through). It lasts until the NEXT pointer press - never a timer - so a late click cannot slip out. */
export interface SwallowedGesture {
  pointerId: number;
  /** The mouse button of the swallowed press (2 = right): its context menu is part of the gesture. */
  button: number;
  /** 0 while the pointer is still down; the release time afterwards. */
  releasedAt: number;
}

/** For events that carry NO pointer id (older engines' click / context menu, compatibility mouse events): how long
 *  after the release they are still taken to be the swallowed gesture's. Identified events need no window. */
export const UNIDENTIFIED_TAIL_MS = 1000;
/** A released swallowed gesture is forgotten after this long (its click, if it was ever coming, is long gone). */
export const SWALLOWED_GESTURE_FORGET_MS = 10_000;

/** Does this follow-up event belong to the swallowed gesture?
 *  `pointerId` is undefined for events that carry none and -1 for keyboard-generated clicks; `lastPointerDownId` is
 *  the pointer pressed most recently (an unidentified event can only belong to that one). */
export function belongsToSwallowedGesture(
  gesture: SwallowedGesture | null,
  event: { pointerId?: number; detail?: number; kind: 'pointer' | 'mouse' | 'click' | 'contextmenu' },
  now: number,
  lastPointerDownId: number = gesture?.pointerId ?? -1,
): boolean {
  if (!gesture) return false;
  if (event.kind === 'pointer') return event.pointerId === gesture.pointerId;
  // identified click / context menu: the pointer id decides, whenever it arrives (a keyboard activation is -1)
  if (event.pointerId !== undefined && event.kind !== 'mouse') return event.pointerId === gesture.pointerId;
  // unidentified: only if the swallowed pointer is still the latest one pressed, and soon after its release
  if (lastPointerDownId !== gesture.pointerId) return false;
  if (gesture.releasedAt !== 0 && now - gesture.releasedAt > UNIDENTIFIED_TAIL_MS) return false;
  if (event.kind === 'mouse') return true; // compatibility mousedown / mouseup of the swallowed press
  // A swallowed RIGHT press's menu, while it is held or within the unidentified window after its release. An event
  // with no pointer id and detail 0 is also what the keyboard's menu key sends; inside that window it is dropped
  // too - a lost menu-key press (recoverable by pressing again) is the accepted cost of never letting the swallowed
  // right-click's menu reach a handler (Astra round 6: on the pitch that menu can cancel a Blitz).
  if (event.kind === 'contextmenu') return gesture.button === 2 || (event.detail ?? 0) !== 0;
  return (event.detail ?? 0) !== 0; // detail 0 = keyboard activation (Enter / Space on a focused button)
}

const pointerIdOf = (event: Event): number | undefined => {
  const id = (event as PointerEvent).pointerId;
  return typeof id === 'number' ? id : undefined;
};

/** Install on a window. Returns the uninstaller. */
export function installFocusClickGuard(target: Window = window): () => void {
  let state = initialFocusClickState();
  let gesture: SwallowedGesture | null = null;
  /** The pointer pressed most recently: unidentified events belong to it, swallowed or not. */
  let lastPointerDownId = -1;
  const drop = (event: Event) => { event.stopImmediatePropagation(); event.preventDefault(); };
  const blur = () => { state = onWindowBlur(); gesture = null; };
  const focus = () => { state = onWindowFocus(state, performance.now()); };
  const pointerDown = (event: Event) => {
    const now = performance.now();
    const pointerId = pointerIdOf(event) ?? 1;
    lastPointerDownId = pointerId;
    // The SAME pointer pressing again ends the swallowed gesture (a new gesture of its own; if its release never
    // reached this window, this is where that is noticed). ANOTHER pointer pressing never does (Astra round 5: it
    // let the swallowed pointer's delayed click out) - that gesture is only forgotten once it is long over.
    if (gesture && (gesture.pointerId === pointerId
      || (gesture.releasedAt !== 0 && now - gesture.releasedAt > SWALLOWED_GESTURE_FORGET_MS))) gesture = null;
    const result = onPress(state, now, target.document.hasFocus());
    state = result.state;
    if (result.swallow && pressIsExempt(event)) return; // disarmed, not swallowed (see FOCUS_CLICK_THROUGH_ATTRIBUTE)
    if (!result.swallow) return; // an unrelated pointer proceeds, and does not release a swallowed one
    gesture = { pointerId, button: Number((event as MouseEvent).button ?? 0), releasedAt: 0 };
    drop(event);
  };
  const pointerEnd = (event: Event) => {
    const now = performance.now();
    if (!belongsToSwallowedGesture(gesture, { kind: 'pointer', pointerId: pointerIdOf(event) ?? 1 }, now, lastPointerDownId)) return;
    drop(event);
    gesture = { ...gesture!, releasedAt: now }; // no timer: the release is dropped whenever it comes
  };
  const mouseCompat = (event: Event) => {
    if (belongsToSwallowedGesture(gesture, { kind: 'mouse' }, performance.now(), lastPointerDownId)) drop(event);
  };
  const click = (kind: 'click' | 'contextmenu') => (event: Event) => {
    if (belongsToSwallowedGesture(gesture, { kind, pointerId: pointerIdOf(event), detail: (event as MouseEvent).detail }, performance.now(), lastPointerDownId)) drop(event);
  };
  const onClick = click('click');
  const onContextMenu = click('contextmenu');
  const options = { capture: true } as const;
  target.addEventListener('blur', blur);
  target.addEventListener('focus', focus);
  target.addEventListener('pointerdown', pointerDown, options);
  for (const type of ['pointerup', 'pointercancel']) target.addEventListener(type, pointerEnd, options);
  for (const type of ['mousedown', 'mouseup']) target.addEventListener(type, mouseCompat, options);
  for (const type of ['click', 'auxclick', 'dblclick']) target.addEventListener(type, onClick, options);
  target.addEventListener('contextmenu', onContextMenu, options);
  return () => {
    gesture = null;
    target.removeEventListener('blur', blur);
    target.removeEventListener('focus', focus);
    target.removeEventListener('pointerdown', pointerDown, options);
    for (const type of ['pointerup', 'pointercancel']) target.removeEventListener(type, pointerEnd, options);
    for (const type of ['mousedown', 'mouseup']) target.removeEventListener(type, mouseCompat, options);
    for (const type of ['click', 'auxclick', 'dblclick']) target.removeEventListener(type, onClick, options);
    target.removeEventListener('contextmenu', onContextMenu, options);
  };
}
