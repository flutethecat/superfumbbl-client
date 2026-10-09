/**
 * Owner 10-09: "During inducements, users should be able to select and click the chat/log box. That should bring the
 * chat/log box briefly above the z-layer of the inducement panels so that it's interactable."
 *
 * VIEW-LAYER state only (no store, no wire): one reactive flag, `raised`, that the Modern view turns into a class on
 * the Log/Chat dock. The dock normally sits UNDER the inducement panes for the whole phase; while `raised` it rides
 * above them.
 *
 *   raise   a press anywhere on the dock, keyboard focus entering it (the Enter chat hotkey focuses the entry), or
 *           the phase's own Chat button (`raise()`).
 *   lower   a press anywhere that is NOT the dock (the inducement panes, the pitch host, anything else), focus moving
 *           from the dock to another element, or the phase ending.
 *
 * There is deliberately NO timer: nothing may pull the dock away mid-sentence. Lowering never touches the chat entry's
 * text (the view's `chatInput` model owns it), and nothing here answers, cancels or edits the purchase.
 */
import { onScopeDispose, readonly, ref, watch, type Ref } from 'vue';

export interface ChatOverInducementsOptions {
  /** True while the inducement phase screen is mounted (either seat, spectator, preset or replay review). */
  phaseOpen: () => boolean;
  /** The Log/Chat dock root. Presses and focus inside it keep it raised. */
  panel: () => HTMLElement | null;
  /** Other elements that belong to the dock for this purpose (the phase's Chat button). Optional. */
  alsoInside?: (target: Node) => boolean;
  /** Listener root; the document by default. Tests pass their own. */
  root?: () => Pick<Document, 'addEventListener' | 'removeEventListener'>;
}

export interface ChatOverInducements {
  /** The dock rides above the inducement panes. Always false outside the phase. */
  raised: Readonly<Ref<boolean>>;
  /** Raise the dock (no-op outside the phase). */
  raise(): void;
  /** Drop the dock back under the panes. */
  lower(): void;
  /** Bind to the dock root: `@pointerdown.capture`. */
  onPanelPointerDown(): void;
  /** Bind to the dock root: `@focusin`. */
  onPanelFocusIn(): void;
  /** Bind to the dock root: `@focusout`. */
  onPanelFocusOut(event: FocusEvent): void;
  /**
   * Bind to the phase container: `@pointerdown.self`. Only reachable where the container still owns the gaps between
   * its panes (the one-column layout, where it has to keep its scrollbar): a press on the bare container over the
   * dock's box brings the dock forward. That press is spent on raising; the next one reaches the dock's controls.
   */
  onPhaseGapPointerDown(event: Pick<PointerEvent, 'clientX' | 'clientY'>): void;
}

export function useChatOverInducements(options: ChatOverInducementsOptions): ChatOverInducements {
  const raised = ref(false);
  const root = () => options.root?.() ?? document;

  const inside = (target: EventTarget | null): boolean => {
    if (!(target instanceof Node)) return false;
    return !!options.panel()?.contains(target) || !!options.alsoInside?.(target);
  };

  function raise(): void {
    if (options.phaseOpen()) raised.value = true;
  }
  function lower(): void {
    raised.value = false;
  }

  /** A press that is not on the dock means the coach went back to the inducements (or anything else). */
  function onOutsidePointerDown(event: Event): void {
    if (raised.value && !inside(event.target)) lower();
  }

  function onPanelFocusOut(event: FocusEvent): void {
    // Focus going NOWHERE (a click on the scrollback, the window losing focus) is not "left for the inducements":
    // only a move to another element outside the dock lowers it.
    const next = event.relatedTarget;
    if (next instanceof Node && !inside(next)) lower();
  }

  function onPhaseGapPointerDown(event: Pick<PointerEvent, 'clientX' | 'clientY'>): void {
    const box = options.panel()?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) raise();
  }

  // The outside-press listener exists only while raised: nothing is attached outside the phase.
  let attachedTo: ReturnType<typeof root> | null = null;
  function detach(): void {
    attachedTo?.removeEventListener('pointerdown', onOutsidePointerDown, true);
    attachedTo = null;
  }
  watch(raised, (on) => {
    detach();
    if (!on) return;
    attachedTo = root();
    attachedTo.addEventListener('pointerdown', onOutsidePointerDown, true);
  }, { flush: 'sync' });
  // Phase end always lowers. A phase that opens while the coach is already typing in the dock starts raised.
  watch(options.phaseOpen, (open) => {
    if (!open) lower();
    else if (typeof document !== 'undefined' && inside(document.activeElement)) raise();
  }, { flush: 'sync' });
  onScopeDispose(detach);

  return { raised: readonly(raised), raise, lower, onPanelPointerDown: raise, onPanelFocusIn: raise, onPanelFocusOut, onPhaseGapPointerDown };
}
