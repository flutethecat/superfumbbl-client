import type { ObjectDirective } from 'vue';

/** Owner 11-05 ("SEASON ONL"): a one-line heading shrinks its font until the text fits its box, instead of being cut
 *  off. It starts from the stylesheet size every time, so a wider box (or a shorter label) grows it back. The
 *  stylesheet's ellipsis stays as the last resort below the floor size. */
export const FIT_TEXT_MIN_PX = 11;

export function fitTextToBox(el: HTMLElement, minPx = FIT_TEXT_MIN_PX): void {
  el.style.fontSize = '';
  const base = Number.parseFloat(getComputedStyle(el).fontSize);
  if (!Number.isFinite(base) || base <= 0) return;
  let size = base;
  // A few passes: the box can widen a little as the text shrinks (flex siblings), so one ratio may undershoot.
  for (let pass = 0; pass < 3; pass++) {
    const avail = el.clientWidth;
    const need = el.scrollWidth;
    if (avail <= 0 || need <= avail) return;
    const next = Math.max(minPx, Math.floor(size * (avail / need) * 10) / 10);
    if (next >= size) return;
    size = next;
    el.style.fontSize = `${size}px`;
    if (size <= minPx) return;
  }
}

type FitEl = HTMLElement & { __fitText?: { observer?: ResizeObserver } };

/** `v-fit-text`: refits on mount, on every update of the owning component and whenever the heading's row is resized. */
export const vFitText: ObjectDirective<FitEl> = {
  mounted(el) {
    const state: { observer?: ResizeObserver } = {};
    el.__fitText = state;
    fitTextToBox(el);
    const box = el.parentElement ?? el;
    if (typeof ResizeObserver !== 'undefined') {
      state.observer = new ResizeObserver(() => fitTextToBox(el));
      state.observer.observe(box);
    }
    // The pitch font may still be loading on first paint; measure again once it has.
    void document.fonts?.ready?.then(() => { if (el.isConnected) fitTextToBox(el); });
  },
  // Every component update refits, not only a label change: a sibling (the live game count) can narrow the heading
  // while its row keeps its size, which the row observer never sees (Sol hp1 P2).
  updated(el) {
    if (el.__fitText) fitTextToBox(el);
  },
  beforeUnmount(el) {
    el.__fitText?.observer?.disconnect();
    delete el.__fitText;
  },
};
