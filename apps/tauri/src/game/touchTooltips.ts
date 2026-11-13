// Touch mode press-and-hold tooltips (spec-touch-mode-2026-11-12 section 7): "press-and-hold any control: shows its
// tooltip, handled once for the whole client". One document-level handler: a finger (or pen) held on an element that
// carries a `title` (or `data-tooltip`) for LONG_PRESS_MS shows that text in a bubble beside it, and the click that
// follows the lift is swallowed so the hold never also activates the control. The browser / WebView context menu a
// long-press fires is suppressed for finger pointers while touch mode is on. The pitch canvas has its own long-press
// (renderer onLongPress) and is skipped here.
import { LONG_PRESS_MS, createLongPress, isFingerPointer, tapSlopFor, type LongPressTimers } from '@fumbbl40k/ffb-pitch';

export interface TouchTooltipDeps {
  /** Touch mode is on now. */
  active: () => boolean;
  doc?: Document;
  timers?: LongPressTimers;
  /** How long the bubble stays up, ms. */
  showMs?: number;
}

/** The tooltip text a held element offers (its own or its nearest titled ancestor's), or null. */
export function tooltipTarget(start: Element | null): { el: HTMLElement; text: string } | null {
  for (let node: Element | null = start; node; node = node.parentElement) {
    if (node instanceof HTMLCanvasElement) return null; // the pitch handles its own long-press
    const el = node as HTMLElement;
    const text = (el.getAttribute?.('data-tooltip') || el.getAttribute?.('title') || '').trim();
    if (text) return { el, text };
  }
  return null;
}

export function installTouchTooltips(deps: TouchTooltipDeps): () => void {
  const doc = deps.doc ?? document;
  const showMs = deps.showMs ?? 2500;
  let bubble: HTMLDivElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let swallowClickUntil = 0;
  /** Review finding 9: the finger whose press showed a tooltip. Every click is swallowed while it is down, and the
   *  click window starts only at its release. */
  let consumedPointer: number | null = null;
  let downPointer: number | null = null;
  let lastFingerDownAt = Number.NEGATIVE_INFINITY;

  const hide = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    bubble?.remove();
    bubble = null;
  };
  const show = (target: { el: HTMLElement; text: string }) => {
    hide();
    bubble = doc.createElement('div');
    bubble.className = 'touch-tooltip';
    bubble.setAttribute('role', 'tooltip');
    bubble.setAttribute('data-testid', 'touch-tooltip');
    bubble.textContent = target.text;
    doc.body.appendChild(bubble);
    try {
      const r = target.el.getBoundingClientRect();
      const view = doc.defaultView;
      const vw = view?.innerWidth ?? 1024;
      const left = Math.max(8, Math.min(vw - 8 - 280, r.left + r.width / 2 - 140));
      const top = r.top > 64 ? r.top - 8 : r.bottom + 8;
      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
      if (r.top > 64) bubble.style.transform = 'translateY(-100%)';
    } catch { /* no layout */ }
    hideTimer = setTimeout(hide, showMs);
  };

  const press = createLongPress<{ el: HTMLElement; text: string }>((target) => {
    show(target);
    consumedPointer = downPointer;
  }, (id) => tapSlopFor(pointerTypes.get(id) ?? 'touch'), LONG_PRESS_MS, deps.timers);
  const pointerTypes = new Map<number, string>();

  const onDown = (event: PointerEvent) => {
    if (!deps.active() || !isFingerPointer(event.pointerType)) return;
    lastFingerDownAt = Date.now();
    hide();
    const target = tooltipTarget(event.target as Element | null);
    if (!target) { press.cancel(); return; }
    pointerTypes.set(event.pointerId, event.pointerType);
    downPointer = event.pointerId;
    press.down(event.pointerId, event.clientX, event.clientY, target);
  };
  const onMove = (event: PointerEvent) => press.move(event.pointerId, event.clientX, event.clientY);
  const onUp = (event: PointerEvent) => {
    press.up(event.pointerId);
    pointerTypes.delete(event.pointerId);
    if (consumedPointer !== null && consumedPointer === event.pointerId) {
      consumedPointer = null;
      swallowClickUntil = Date.now() + 700; // the click that follows this release
    }
  };
  const onCancel = () => { press.cancel(); consumedPointer = null; };
  const onClick = (event: MouseEvent) => {
    if (consumedPointer === null && Date.now() > swallowClickUntil) return;
    if (consumedPointer === null) swallowClickUntil = 0;
    event.preventDefault();
    event.stopPropagation();
  };
  // A finger long-press fires `contextmenu` in a WebView; in touch mode it never opens a menu (the pitch canvas keeps
  // its own handler, which ignores finger long-presses in touch mode).
  const onContextMenu = (event: Event) => {
    if (!deps.active()) return;
    const pointerType = (event as PointerEvent).pointerType;
    const fromFinger = isFingerPointer(pointerType) || (!pointerType && Date.now() - lastFingerDownAt < 1500);
    if (!fromFinger) return;
    if (event.target instanceof HTMLCanvasElement) return;
    event.preventDefault();
  };

  doc.addEventListener('pointerdown', onDown, true);
  doc.addEventListener('pointermove', onMove, true);
  doc.addEventListener('pointerup', onUp, true);
  doc.addEventListener('pointercancel', onCancel, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('contextmenu', onContextMenu, true);
  return () => {
    doc.removeEventListener('pointerdown', onDown, true);
    doc.removeEventListener('pointermove', onMove, true);
    doc.removeEventListener('pointerup', onUp, true);
    doc.removeEventListener('pointercancel', onCancel, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('contextmenu', onContextMenu, true);
    press.cancel();
    hide();
  };
}
