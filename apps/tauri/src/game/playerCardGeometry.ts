/** The selected-player card's geometry (SpectateView .player-card): the user's PREFERRED place and size (what they
 *  set, persisted in settings.playerCardPos / playerCardSize) kept apart from the DISPLAYED geometry (the preference
 *  fitted into the current pitch host). A smaller window or a larger text size moves only the displayed card; when
 *  room comes back the card returns to the preferred spot. Only a real gesture (the pointer moved past a small
 *  threshold) writes the preference, and a fit never runs mid-gesture: it is deferred to the gesture's end, where the
 *  final layout is measured, the card fitted, then saved. DOM access stays in the view through the `env` hooks, so
 *  this module is testable on its own. */

export interface CardPos { x: number; y: number }
export interface CardSize { w: number; h: number }
export interface CardPreference { pos: CardPos | null; size: CardSize | null }
interface Cell<T> { value: T }

/** The smallest resize (the card's own handle clamps to the same box). */
export const PLAYER_CARD_MIN_SIZE: Readonly<CardSize> = { w: 154, h: 84 };
/** Pointer travel (px, either axis) below which a press-and-release is a click, not a move / resize. */
export const CARD_GESTURE_THRESHOLD_PX = 3;
/** A dragged card keeps at least this much of itself inside the host (the historical drag bounds). */
const DRAG_KEEP = { w: 120, h: 60 };
const RESIZE_EDGE = 4;

/** The preferred size, shrunk (never grown) to fit the host. */
export function fitCardSize(pref: CardSize | null, host: CardSize): CardSize | null {
  if (!pref) return null;
  return {
    w: Math.min(pref.w, Math.max(PLAYER_CARD_MIN_SIZE.w, host.w - RESIZE_EDGE)),
    h: Math.min(pref.h, Math.max(PLAYER_CARD_MIN_SIZE.h, host.h - RESIZE_EDGE)),
  };
}

/** The preferred position, moved just enough that the RENDERED card (CSS min sizes can make it bigger than the
 *  stored size) lies inside the host. */
export function fitCardPos(pref: CardPos | null, host: CardSize, rendered: CardSize): CardPos | null {
  if (!pref) return null;
  return {
    x: Math.max(0, Math.min(pref.x, host.w - rendered.w)),
    y: Math.max(0, Math.min(pref.y, host.h - rendered.h)),
  };
}

/** One pointer event as the gesture sees it: the pointer's id, its position in host coordinates and (on a move)
 *  the buttons the engine reported (informational only: never used to end a gesture). */
export interface CardPointerEvent { id: number; x: number; y: number; buttons?: number }
/** The pointer that starts a gesture. */
export interface CardPointerStart { id: number; button: number; pointerType?: string }

/** Only a primary press starts a drag / resize: the left mouse button, a touch contact or a pen tip (all button 0).
 *  Right, middle, back / forward and a pen's barrel or eraser button never move or resize the card. */
export function isPrimaryCardPointer(start: Pick<CardPointerStart, 'button'>): boolean {
  return start.button === 0;
}
/** What the gesture listens to while it runs. `cancel` with an id is that pointer's pointercancel /
 *  lostpointercapture; without one it is a window blur. */
export interface CardGestureHandlers {
  move(e: CardPointerEvent): void;
  up(e: CardPointerEvent): void;
  cancel(id?: number): void;
}

export interface PlayerCardGeometryEnv {
  /** The pitch host's inner size, or null when there is no host / card on screen (hidden). */
  host(): CardSize | null;
  /** The card's rendered size (after layout), or null when it is not on screen. */
  rendered(): CardSize | null;
  /** Resolves once a geometry change has been laid out (Vue nextTick in the view). */
  afterLayout(): Promise<void>;
  /** Persist the preference (settings.playerCardPos / playerCardSize). */
  save(pref: CardPreference): void;
  /** Attach the gesture's listeners (window pointermove / pointerup / pointercancel / blur and the handle's
   *  lostpointercapture in the view); returns the detach. Called once per gesture; the detach runs exactly once. */
  listen(handlers: CardGestureHandlers): () => void;
}

type GestureInit = { pointerId: number; moved: boolean; start: CardPos } & (
  | { kind: 'drag'; grab: CardPos }
  | { kind: 'resize'; left: number; bottom: number; w: number; h: number });
type Gesture = GestureInit & { detach: () => void };

export function createPlayerCardGeometry(env: PlayerCardGeometryEnv, initial: CardPreference, displayed: { pos: Cell<CardPos | null>; size: Cell<CardSize | null> }) {
  let pref: CardPreference = { pos: initial.pos ? { ...initial.pos } : null, size: initial.size ? { ...initial.size } : null };
  /** The running gesture (pointer down, listening). */
  let gesture: Gesture | null = null;
  /** A released gesture still measuring its drop (listeners already detached). */
  let ending = false;
  let fitRun = 0;

  /** Displayed = preference fitted to the host. Deferred while a gesture runs or finishes (its end fits). */
  async function fit(): Promise<void> {
    if (gesture || ending) return;
    const run = ++fitRun;
    const host = env.host();
    if (!host || host.w <= 0 || host.h <= 0) return;
    displayed.size.value = fitCardSize(pref.size, host);
    if (!pref.pos) { displayed.pos.value = null; return; }
    await env.afterLayout(); // the size above (or a new text size) lays out before the rendered card is measured
    if (gesture || ending || run !== fitRun) return; // a gesture began or a newer fit ran meanwhile
    const rendered = env.rendered();
    const hostNow = env.host();
    if (!rendered || !hostNow) return;
    displayed.pos.value = fitCardPos(pref.pos, hostNow, rendered);
  }

  function crossed(g: Gesture, pointer: CardPos): boolean {
    if (!g.moved) g.moved = Math.abs(pointer.x - g.start.x) > CARD_GESTURE_THRESHOLD_PX || Math.abs(pointer.y - g.start.y) > CARD_GESTURE_THRESHOLD_PX;
    return g.moved;
  }

  /** Detach and forget the running gesture (idempotent). */
  function release(): Gesture | null {
    const g = gesture;
    gesture = null;
    g?.detach();
    return g;
  }

  /** The one abandon path: pointercancel / lostpointercapture of the gesture's pointer, window blur, the card
   *  hiding, unmount. Saves nothing and puts the card back at its fitted preference. Idempotent. */
  function cancel(pointerId?: number): void {
    if (!gesture) return;
    if (pointerId !== undefined && pointerId !== gesture.pointerId) return; // another pointer's cancel
    release();
    void fit();
  }

  function begin(g: GestureInit): boolean {
    if (gesture || ending) return false; // one gesture at a time: a second pointer cannot start or steal one
    const running = { ...g, detach: () => {} } as Gesture;
    gesture = running;
    let detached = false;
    const detach = env.listen({
      // `buttons` is deliberately not read: some engines report 0 on moves of a held drag. A lost release is covered
      // by the capture-phase pointerup / pointercancel listeners and the blur / lost-capture / hide / unmount cancel.
      move: (e) => { if (gesture === running && e.id === running.pointerId) move(e); },
      up: (e) => { if (gesture === running && e.id === running.pointerId) void end(e); },
      cancel: (id) => { if (gesture === running) cancel(id); },
    });
    running.detach = () => { if (!detached) { detached = true; detach(); } };
    return true;
  }

  /** `pointer` and `card` (left/top) in host coordinates. Returns false (ignored) while another gesture runs. */
  function beginDrag(start: CardPointerStart, pointer: CardPos, card: CardPos): boolean {
    if (!isPrimaryCardPointer(start)) return false;
    return begin({ kind: 'drag', pointerId: start.id, moved: false, start: { ...pointer }, grab: { x: pointer.x - card.x, y: pointer.y - card.y } });
  }
  /** `card` is the card's host-relative rectangle; the resize anchors its bottom-left corner. */
  function beginResize(start: CardPointerStart, pointer: CardPos, card: { x: number; y: number; w: number; h: number }): boolean {
    if (!isPrimaryCardPointer(start)) return false;
    return begin({ kind: 'resize', pointerId: start.id, moved: false, start: { ...pointer }, left: card.x, bottom: card.y + card.h, w: card.w, h: card.h });
  }

  function move(pointer: CardPos): void {
    const g = gesture;
    const host = env.host();
    if (!g || !host || !crossed(g, pointer)) return; // under the threshold (or hidden) nothing changes
    if (g.kind === 'drag') {
      displayed.pos.value = {
        x: Math.max(0, Math.min(pointer.x - g.grab.x, host.w - DRAG_KEEP.w)),
        y: Math.max(0, Math.min(pointer.y - g.grab.y, host.h - DRAG_KEEP.h)),
      };
      return;
    }
    // Live host bounds (not the size at the gesture's start), so a host that shrank mid-gesture caps the box.
    const w = Math.max(PLAYER_CARD_MIN_SIZE.w, Math.min(g.w + (pointer.x - g.start.x), host.w - g.left - RESIZE_EDGE));
    const h = Math.max(PLAYER_CARD_MIN_SIZE.h, Math.min(g.h - (pointer.y - g.start.y), g.bottom - RESIZE_EDGE));
    displayed.size.value = { w, h };
    displayed.pos.value = { x: g.left, y: g.bottom - h };
  }

  /** Pointer-up of the gesture's pointer: a click (under the threshold) changes nothing; a real gesture is laid out,
   *  measured, fitted, then saved. A drop that cannot be measured (card hidden) is abandoned, never saved. */
  async function end(pointer: CardPos): Promise<void> {
    if (!gesture) return;
    move(pointer);
    const g = release()!;
    if (!g.moved) { await fit(); return; }
    ending = true;
    try {
      await env.afterLayout();
      const host = env.host();
      const rendered = env.rendered();
      const shown = displayed.pos.value;
      if (!host || !rendered || !shown) return; // hidden at release: nothing measured, nothing saved
      const fitted = fitCardPos(shown, host, rendered)!; // shown is non-null here
      const round = (p: CardPos): CardPos => ({ x: Math.round(p.x), y: Math.round(p.y) });
      if (g.kind === 'drag') {
        // A drag sets where the card is; the preferred SIZE is untouched (a fitted, smaller box is not a choice).
        pref = { pos: round(fitted), size: pref.size };
      } else {
        const size = displayed.size.value ? { w: Math.round(displayed.size.value.w), h: Math.round(displayed.size.value.h) } : pref.size;
        // A resize anchors the bottom-left corner, so it moves the top edge only: shift the preferred position by
        // what the displayed card really moved, keeping a preference the fit had pulled in. A docked card gets its
        // first position.
        const startTop = { x: g.left, y: g.bottom - g.h };
        const pos = pref.pos ? round({ x: pref.pos.x + (fitted.x - startTop.x), y: pref.pos.y + (fitted.y - startTop.y) }) : round(fitted);
        pref = { pos, size };
      }
      env.save({ pos: pref.pos ? { ...pref.pos } : null, size: pref.size ? { ...pref.size } : null });
    } finally {
      ending = false;
      await fit();
    }
  }

  return {
    fit,
    beginDrag,
    beginResize,
    cancel,
    get preference(): CardPreference { return { pos: pref.pos ? { ...pref.pos } : null, size: pref.size ? { ...pref.size } : null }; },
    get active(): boolean { return gesture !== null || ending; },
  };
}
