/**
 * Owner 10-16: the pane search state for the Log / Chat pane (see game/paneSearch.ts for the rules). The view hands in
 * the active pane's <pre> and a stable key per row (to keep the current match on the same line when the log moves);
 * the match text is read from the RENDERED rows, so it is exactly what the coach sees in every log and chat style.
 * The marks are re-applied whenever the pane's DOM changes (a new line, a style switch, a tab switch: a
 * MutationObserver on the pane) and the pane scrolls only when the coach types or steps (a new message never moves it).
 */
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { applyPaneSearch, clearPaneSearch, paneSearchCounter, paneSearchMatches, paneSearchOrder, paneRowsHost, paneSearchRowText, paneSearchStep, revealPaneRow } from './paneSearch';

export function usePaneSearch(opts: { keys: () => readonly unknown[]; container: () => HTMLElement | null }) {
  const query = ref('');
  const current = ref(0);
  const order = shallowRef<number[]>([]);
  let currentKey: unknown = undefined;
  /** Fallback identity of the current row when its key object was rebuilt: its text and its index. */
  let currentText = '';
  let currentIndex = -1;

  const count = computed(() => order.value.length);
  const counter = computed(() => paneSearchCounter(current.value, count.value));
  const currentRow = computed<number | null>(() => (count.value ? order.value[Math.min(current.value, count.value - 1)]! : null));

  let marked: HTMLElement | null = null;
  /** Re-read the rendered rows, re-mark them; `mode` says whether the current match restarts and the pane scrolls. */
  function refresh(mode: 'keep' | 'restart' | 'step'): void {
    const container = opts.container();
    if (marked && marked !== container) { clearPaneSearch(marked); marked = null; }
    if (!query.value.trim()) {
      // no search: drop the marks once, then leave the pane alone (no history scan on every new line, Astra 10-16)
      if (marked) { clearPaneSearch(marked); marked = null; }
      order.value = [];
      current.value = 0;
      currentKey = undefined;
      currentText = '';
      currentIndex = -1;
      return;
    }
    marked = container;
    const texts = container ? Array.from(paneRowsHost(container).children, (row) => paneSearchRowText(row)) : [];
    order.value = paneSearchOrder(paneSearchMatches(texts, query.value));
    const keys = opts.keys();
    if (mode === 'restart') current.value = 0;
    else if (mode === 'keep') {
      let keep = currentKey === undefined ? -1 : order.value.findIndex((i) => keys[i] === currentKey);
      if (keep < 0 && currentText) {
        // the entry object was rebuilt (a recomputed Graphical row): the same text nearest its old place
        let best = Infinity;
        order.value.forEach((row, at) => {
          const d = Math.abs(row - currentIndex);
          if (texts[row] === currentText && d < best) { best = d; keep = at; }
        });
      }
      current.value = keep >= 0 ? keep : 0;
    }
    current.value = count.value ? Math.min(current.value, count.value - 1) : 0;
    currentKey = currentRow.value != null ? keys[currentRow.value] : undefined;
    currentText = currentRow.value != null ? texts[currentRow.value]! : '';
    currentIndex = currentRow.value ?? -1;
    const { current: currentRanges } = applyPaneSearch(container, order.value, currentRow.value, query.value);
    // reveal after Vue has rendered what the new count changes (the counter and step buttons can re-wrap the bar and
    // resize the pane), so the measured position is the final one (Astra 10-16)
    if (mode !== 'keep') void nextTick(() => { if (opts.container() === container) revealPaneRow(container, currentRow.value, currentRanges[0]); });
  }

  // Watch the pane's DOM: any re-render (new rows, a style switch, Vue replacing the rows) re-marks without scrolling.
  let observer: MutationObserver | null = null;
  let pending = false;
  function schedule(): void {
    if (pending || !query.value.trim()) return;
    pending = true;
    queueMicrotask(() => { pending = false; refresh('keep'); });
  }
  watch(
    () => opts.container(),
    (el) => {
      observer?.disconnect();
      observer = null;
      if (el && typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(schedule);
        observer.observe(el, { childList: true, subtree: true, characterData: true });
      }
      refresh('keep');
      // Another pane (a tab switch, the pane reopened): the search starts again at that pane's newest match and reveals
      // it AFTER the view's own open-at-the-bottom scroll (Astra 10-16), hence the macrotask.
      if (el && query.value.trim()) setTimeout(() => { if (opts.container() === el) refresh('restart'); }, 0);
    },
    { flush: 'post', immediate: true },
  );
  watch(query, () => refresh('restart'), { flush: 'post' });
  onBeforeUnmount(() => { observer?.disconnect(); clearPaneSearch(marked); });

  function step(dir: 'older' | 'newer'): void {
    if (!count.value) return;
    current.value = paneSearchStep(current.value, count.value, dir);
    refresh('step');
  }
  function clear(): void {
    query.value = '';
  }

  return { query, current, count, counter, currentRow, older: () => step('older'), newer: () => step('newer'), clear, active: computed(() => count.value > 0) };
}
