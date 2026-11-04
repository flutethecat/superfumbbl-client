/**
 * Settings reflow (owner 11-03): edge-of-screen panning (Settings > Controls > Camera, default off).
 *
 * While the pointer rests within EDGE_PAN_ZONE_PX of the pitch viewport's edge, the camera glides that way through
 * the renderer's WASD glide (renderer.setEdgePanDirection; the pan direction uses the WASD convention: +x = the view
 * looks left, +y = the view looks up). The glide PAUSES (direction cleared) whenever:
 *  - the setting is off, or the pad drives the pitch (controller mode: the crosshair owns the camera);
 *  - a menu, dialog, context menu or the Settings / Game Menu is open, or a text field has focus;
 *  - the pointer is over anything but the pitch itself (a HUD panel at the edge keeps its clicks), or a button is held
 *    (a drag owns the pointer);
 *  - the window loses focus, the page is hidden, or the pointer leaves the window.
 * Presentation only: nothing here reads or sends the wire.
 */

/** How close to the pitch viewport's edge (CSS px) the pointer must be. */
export const EDGE_PAN_ZONE_PX = 8;
/** While a glide runs, the gates are re-checked this often (a dialog can open under a resting pointer). */
export const EDGE_PAN_RECHECK_MS = 120;

export interface EdgeRect { left: number; top: number; right: number; bottom: number }
export interface PanDirection { x: number; y: number }

const NONE: PanDirection = Object.freeze({ x: 0, y: 0 });

/** The pan direction for a pointer at (x, y) over `rect`: 0 inside, +-1 per axis within `zone` px of an edge, and 0 when
 *  the pointer is outside the rect altogether. */
export function edgePanDirection(x: number, y: number, rect: EdgeRect | null, zone = EDGE_PAN_ZONE_PX): PanDirection {
  if (!rect || !Number.isFinite(x) || !Number.isFinite(y)) return NONE;
  if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return NONE;
  if (rect.right - rect.left <= zone * 2 || rect.bottom - rect.top <= zone * 2) return NONE; // a sliver: never pans
  const dx = x - rect.left < zone ? 1 : rect.right - 1 - x < zone ? -1 : 0;
  const dy = y - rect.top < zone ? 1 : rect.bottom - 1 - y < zone ? -1 : 0;
  return dx === 0 && dy === 0 ? NONE : { x: dx, y: dy };
}

/** Everything that pauses the glide, as read at one moment. */
export interface EdgePanGate {
  enabled: boolean;
  controllerMode: boolean;
  overlayOpen: boolean;
  textInputFocused: boolean;
  pointerOverPitch: boolean;
  buttonsDown: boolean;
  windowFocused: boolean;
  pointerInWindow: boolean;
}

export function edgePanAllowed(gate: EdgePanGate): boolean {
  return gate.enabled && !gate.controllerMode && !gate.overlayOpen && !gate.textInputFocused && gate.pointerOverPitch
    && !gate.buttonsDown && gate.windowFocused && gate.pointerInWindow;
}

/** A pointer sample the controller keeps (the last move). */
export interface EdgePointer { clientX: number; clientY: number; target: EventTarget | null; buttons: number }

export interface EdgePanDeps {
  /** renderer.setEdgePanDirection (no-op without a renderer). */
  setDirection(dx: number, dy: number): void;
  /** The pitch viewport's client rect (null = no pitch). */
  hostRect(): EdgeRect | null;
  /** Reads the gates for the given pointer (pointerOverPitch / buttonsDown come from it). windowFocused and
   *  pointerInWindow are tracked by the controller itself and override what this returns. */
  gate(pointer: EdgePointer): EdgePanGate;
  /** Sol r1: the element under (x, y) NOW (document.elementFromPoint). Every evaluation uses it in place of the move's
   *  own target, so a HUD panel / dialog appearing under a resting pointer stops the glide on the next recheck. */
  hitTest?(x: number, y: number): EventTarget | null;
  zonePx?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export interface EdgePanController {
  pointerMove(pointer: EdgePointer): void;
  /** A button went down / up or the pointer was cancelled: the held-buttons mask now (0 = none). */
  pointerButtons(buttons: number): void;
  /** The pointer left the window (mouseout with no related target / mouseleave on the document). */
  pointerLeftWindow(): void;
  /** window blur / page hidden. */
  windowBlurred(): void;
  windowFocused(): void;
  /** Re-run the gates against the last pointer (a menu opened, the setting changed). */
  recheck(): void;
  /** The direction the controller last set. */
  direction(): PanDirection;
  dispose(): void;
}

export function createEdgePanController(deps: EdgePanDeps): EdgePanController {
  const every = deps.setInterval ?? ((fn: () => void, ms: number) => globalThis.setInterval(fn, ms));
  const stopEvery = deps.clearInterval ?? ((handle: unknown) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>));
  let last: EdgePointer | null = null;
  let focused = true;
  let inWindow = true;
  let current: PanDirection = NONE;
  let timer: unknown = null;

  function apply(next: PanDirection): void {
    if (next.x === current.x && next.y === current.y) return;
    current = next;
    // Latches fail open: the timer only exists while a glide runs, and every exit path clears both.
    if (next.x === 0 && next.y === 0) {
      if (timer !== null) { stopEvery(timer); timer = null; }
    } else if (timer === null) timer = every(evaluate, EDGE_PAN_RECHECK_MS);
    deps.setDirection(next.x, next.y);
  }

  function evaluate(): void {
    if (!last || !focused || !inWindow) { apply(NONE); return; }
    let next: PanDirection = NONE;
    try {
      const now: EdgePointer = deps.hitTest ? { ...last, target: deps.hitTest(last.clientX, last.clientY) } : last;
      const gate = { ...deps.gate(now), windowFocused: focused, pointerInWindow: inWindow };
      if (edgePanAllowed(gate)) next = edgePanDirection(last.clientX, last.clientY, deps.hostRect(), deps.zonePx);
    } catch {
      next = NONE; // a failed read never leaves the camera gliding
    }
    apply(next);
  }

  return {
    pointerMove(pointer) { last = pointer; inWindow = true; evaluate(); },
    pointerButtons(buttons) {
      if (last) last = { ...last, buttons };
      evaluate();
    },
    pointerLeftWindow() { inWindow = false; apply(NONE); },
    windowBlurred() { focused = false; apply(NONE); },
    windowFocused() { focused = true; },
    recheck: evaluate,
    direction: () => current,
    dispose() { last = null; apply(NONE); },
  };
}

/** DOM read: a modal, dialog or menu is open (rendered: a v-show'd one that is hidden does not count). Sol r2: the
 *  in-game confirmation / decision cards (PitchConfirmationPanel: End Activation, End Turn, Keep Blitz, a server yes /
 *  no...) carry no dialog role, so they are named here too - every answerable one (instruction strips, read-only
 *  waits, lingering results and the opponent-setup notice are not questions and do not pause the camera). */
export const EDGE_PAN_CONFIRM_CARD_SELECTOR = '.pitch-confirm-panel:not(.pitch-instruction):not(.readonly):not(.lingering):not(.opponent-setup-notice)';
export const EDGE_PAN_OVERLAY_SELECTOR = `[aria-modal="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], ${EDGE_PAN_CONFIRM_CARD_SELECTOR}`;
export function domOverlayOpen(doc: Pick<Document, 'querySelectorAll'>): boolean {
  const found = doc.querySelectorAll(EDGE_PAN_OVERLAY_SELECTOR);
  for (let i = 0; i < found.length; i += 1) {
    const el = found[i] as Element;
    if (typeof el.getClientRects !== 'function' || el.getClientRects().length > 0) return true;
  }
  return false;
}

/** DOM read: the focused element takes typing (a text input, a textarea, a select, an editable region). */
export function textInputFocused(active: Element | null): boolean {
  if (!active) return false;
  const tag = active.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = ((active as HTMLInputElement).type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type);
  }
  return (active as HTMLElement).isContentEditable === true;
}

/**
 * The DOM listeners the controller needs (SpectateView installs them for its lifetime). Pointer moves feed position and
 * buttons; pointerdown / pointerup / pointercancel feed the buttons mask at once (a press without a move pauses the
 * glide); the pointer leaving the document, the window blurring and the page hiding pause it.
 */
export function installEdgePanListeners(
  controller: EdgePanController,
  env: { win: Window; doc: Document; active: () => boolean },
): () => void {
  const { win, doc } = env;
  const idleOff = (): boolean => !env.active() && controller.direction().x === 0 && controller.direction().y === 0;
  const move = (event: PointerEvent): void => {
    if (idleOff()) return; // off and still: no DOM reads
    controller.pointerMove({ clientX: event.clientX, clientY: event.clientY, target: event.target, buttons: event.buttons });
  };
  const buttons = (event: PointerEvent): void => { if (!idleOff()) controller.pointerButtons(event.buttons ?? 0); };
  const cancel = (): void => { if (!idleOff()) controller.pointerButtons(0); };
  const out = (event: PointerEvent): void => { if (!event.relatedTarget) controller.pointerLeftWindow(); };
  const leave = (): void => controller.pointerLeftWindow();
  const blur = (): void => controller.windowBlurred();
  const focus = (): void => controller.windowFocused();
  const visibility = (): void => { if (doc.visibilityState === 'hidden') controller.windowBlurred(); };
  win.addEventListener('pointermove', move as EventListener, { passive: true });
  win.addEventListener('pointerdown', buttons as EventListener, { capture: true });
  win.addEventListener('pointerup', buttons as EventListener, { capture: true });
  win.addEventListener('pointercancel', cancel, { capture: true });
  doc.addEventListener('pointerout', out as EventListener);
  doc.documentElement.addEventListener('mouseleave', leave);
  win.addEventListener('blur', blur);
  win.addEventListener('focus', focus);
  doc.addEventListener('visibilitychange', visibility);
  return () => {
    win.removeEventListener('pointermove', move as EventListener);
    win.removeEventListener('pointerdown', buttons as EventListener, { capture: true });
    win.removeEventListener('pointerup', buttons as EventListener, { capture: true });
    win.removeEventListener('pointercancel', cancel, { capture: true });
    doc.removeEventListener('pointerout', out as EventListener);
    doc.documentElement.removeEventListener('mouseleave', leave);
    win.removeEventListener('blur', blur);
    win.removeEventListener('focus', focus);
    doc.removeEventListener('visibilitychange', visibility);
    controller.dispose();
  };
}
