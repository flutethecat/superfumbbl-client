/**
 * Owner 10-16: SEARCH in the match log and the chat (the search box on the right of the pane's settings bar).
 * Find-in-page, never a filter: every row stays, matching rows are marked, the matched run is highlighted inside the
 * text, and an "N of M" counter steps through the matches. The search works UPWARD from the bottom: the current match
 * starts at the NEWEST matching row ("1 of M"), "older" steps up the log, "newer" steps back down, wrapping at both
 * ends. Matching is a case-insensitive substring over each row's VISIBLE text as rendered (names included, the
 * displayed direction words, numbers shown as numbers; the transparent copy layers under dice and icons are not
 * visible text); a chat emoji matches by its literal :shortcode: and is highlighted as a whole. The query lives only in
 * the view: it never reaches the wire or the log entries.
 */

/**
 * Case-fold that keeps the string length and ignores context (Astra 10-16): each character is lowered on its own
 * (the same letter folds the same everywhere, so "ΟΣ" is found in "ΟΣΑ"), the Greek final sigma folds to sigma, and
 * a character whose lower case has a different length ("İ" -> "i̇") stays as it is, so offsets in the folded text are
 * offsets in the original.
 */
export function paneSearchFold(text: string): string {
  let out = '';
  for (const ch of text) {
    const lower = ch === 'ς' ? 'σ' : ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

/** Row indices (ascending, oldest first) whose text contains the query; an empty / blank query matches nothing. */
/** The query as typed (no trimming: " roll" is not "roll"); a blank query is no query. */
function searchNeedle(query: string): string {
  return query.trim() ? paneSearchFold(query) : '';
}

export function paneSearchMatches(texts: readonly string[], query: string): number[] {
  const q = searchNeedle(query);
  if (!q) return [];
  const out: number[] = [];
  texts.forEach((t, i) => { if (paneSearchFold(t).includes(q)) out.push(i); });
  return out;
}

/** The matches in counter order: index 0 = the newest (bottom-most) match. */
export function paneSearchOrder(matches: readonly number[]): number[] {
  return [...matches].reverse();
}

/** Step the current position (counter order, 0 = newest): 'older' goes up the log, 'newer' back down; wraps. */
export function paneSearchStep(current: number, count: number, dir: 'older' | 'newer'): number {
  if (count <= 0) return 0;
  const c = Math.min(Math.max(0, current), count - 1);
  return dir === 'older' ? (c + 1) % count : (c - 1 + count) % count;
}

/** "N of M" (N is 1-based, 1 = the newest match); "0 of 0" without matches. */
export function paneSearchCounter(current: number, count: number): string {
  return count > 0 ? `${Math.min(Math.max(0, current), count - 1) + 1} of ${count}` : '0 of 0';
}

/** Highlight registry names (CSS: ::highlight(pane-search) / ::highlight(pane-search-current)). */
export const PANE_SEARCH_HIGHLIGHT = 'pane-search';
export const PANE_SEARCH_HIGHLIGHT_CURRENT = 'pane-search-current';

/** Visual blocks inside a row (the bubble's name / time / text): a separator follows each, so no match spans two. */
const BLOCK_PARTS = '.chat-bubble-head, .chat-bubble-name, .chat-bubble-time, .chat-bubble-text';
/** Copy layers that sit transparent under artwork (selectable, never seen): not part of the visible text. */
const INVISIBLE_COPY = '.log-hidden, .log-armour-glyph, .log-stat-down-copy, .block-die-result, .d6-face-value:not(.visible)';

type Piece = { start: number; text: string } & ({ node: Text; atom?: never } | { atom: Element; node?: never });

/** The row's visible text as pieces: text nodes, and each chat emoji as one atom whose text is its :shortcode:. */
function rowPieces(row: Element): { pieces: Piece[]; text: string } {
  const pieces: Piece[] = [];
  let text = '';
  const walk = (el: Element) => {
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) {
        const t = child as Text;
        if (!t.data) continue;
        pieces.push({ start: text.length, text: t.data, node: t });
        text += t.data;
      } else if (child.nodeType === 1) {
        const e = child as Element;
        if (e.matches(INVISIBLE_COPY)) continue;
        // atoms: a chat emoji reads as its :shortcode:; a die whose artwork failed shows its number through CSS
        // (::after attr(data-value)), so that number is its visible text (Astra 10-16)
        const fallbackDie = e.matches('.d6-face-fallback, .block-die-fallback');
        if (e.classList.contains('chat-emoji') || fallbackDie) {
          const code = fallbackDie ? e.getAttribute('data-value') ?? '' : e.getAttribute('aria-label') || e.textContent || '';
          pieces.push({ start: text.length, text: code, atom: e });
          text += code;
          continue;
        }
        walk(e);
        if (e.matches(BLOCK_PARTS)) text += '\n'; // a separator no typed query contains
      }
    }
  };
  walk(row);
  return { pieces, text };
}

/** A row's visible text (what the search matches): see rowPieces. */
export function paneSearchRowText(row: Element): string {
  return rowPieces(row).text;
}

/** Ranges of every case-insensitive occurrence of `query` in a row's visible text (an emoji is covered whole). */
export function paneSearchRanges(row: Element, query: string): Range[] {
  return matchRow(row, query).ranges;
}
/** The matched runs of a row, and the atoms (emoji, fallback dice) a match touches: their glyph or ::after number is
 *  not DOM text a highlight range can paint, so they are marked with data-search-mark instead (Astra 10-16). */
function matchRow(row: Element, query: string): { ranges: Range[]; atoms: Element[] } {
  const q = searchNeedle(query);
  const atoms: Element[] = [];
  if (!q || !row.ownerDocument) return { ranges: [], atoms };
  const doc = row.ownerDocument;
  const { pieces, text } = rowPieces(row);
  const hay = paneSearchFold(text);
  const pieceAt = (pos: number): Piece | undefined => {
    for (let i = pieces.length - 1; i >= 0; i--) if (pos >= pieces[i]!.start) return pieces[i];
    return undefined;
  };
  const ranges: Range[] = [];
  for (let i = hay.indexOf(q); i >= 0; i = hay.indexOf(q, i + q.length)) {
    const a = pieceAt(i);
    const b = pieceAt(i + q.length - 1);
    if (!a || !b) continue;
    try {
      const r = doc.createRange();
      if (a.atom) r.setStartBefore(a.atom); else r.setStart(a.node!, i - a.start);
      if (b.atom) r.setEndAfter(b.atom); else r.setEnd(b.node!, i + q.length - b.start);
      ranges.push(r);
      for (const p of pieces) if (p.atom && p.start < i + q.length && p.start + p.text.length > i) atoms.push(p.atom);
    } catch {
      // a node changed under us mid-render: skip this run, the next refresh marks it
    }
  }
  return { ranges, atoms };
}

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
function highlightRegistry(): { registry: HighlightRegistry; make: (ranges: Range[]) => unknown } | null {
  const css = (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Ctor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!css?.highlights || !Ctor) return null;
  return { registry: css.highlights, make: (ranges) => new Ctor(...ranges) };
}

/** Drop the search marks from a pane (attributes on its rows and the highlight registry entries). */
export function clearPaneSearch(container: Element | null): void {
  applyPaneSearch(container, [], null, '');
}

/**
 * Mark the rows of a pane: every direct child row gets its search attributes cleared, then the hit rows get
 * data-search-hit and the current one data-search-current; the matched runs go to the CSS highlight registry when the
 * engine has one. Returns the ranges (all, current) so callers and tests can see what was marked.
 */
/**
 * The element whose children are the pane's rows: the pane's single row block (`data-pane-rows`, owner 11-02, the block
 * the follow observer sizes) when it has one, else the pane itself.
 */
export function paneRowsHost(container: Element): Element {
  const first = container.firstElementChild;
  return first && first.hasAttribute('data-pane-rows') ? first : container;
}

export function applyPaneSearch(container: Element | null, hitRows: readonly number[], currentRow: number | null, query: string): { all: Range[]; current: Range[] } {
  const reg = highlightRegistry();
  const all: Range[] = [];
  const current: Range[] = [];
  if (container) {
    const rows = paneRowsHost(container).children;
    for (let i = 0; i < rows.length; i++) {
      rows[i]!.removeAttribute('data-search-hit');
      rows[i]!.removeAttribute('data-search-current');
    }
    for (const atom of Array.from(container.querySelectorAll('[data-search-mark]'))) atom.removeAttribute('data-search-mark');
    for (const i of hitRows) {
      const row = rows[i];
      if (!row) continue;
      row.setAttribute('data-search-hit', '');
      const { ranges, atoms } = matchRow(row, query);
      for (const atom of atoms) atom.setAttribute('data-search-mark', i === currentRow ? 'current' : '');
      if (i === currentRow) { row.setAttribute('data-search-current', ''); current.push(...ranges); } else all.push(...ranges);
    }
  }
  if (reg) {
    if (all.length) reg.registry.set(PANE_SEARCH_HIGHLIGHT, reg.make(all)); else reg.registry.delete(PANE_SEARCH_HIGHLIGHT);
    if (current.length) reg.registry.set(PANE_SEARCH_HIGHLIGHT_CURRENT, reg.make(current)); else reg.registry.delete(PANE_SEARCH_HIGHLIGHT_CURRENT);
  }
  return { all: [...all, ...current], current };
}

/**
 * Scroll a row of the pane into view inside the pane only (never the page), centring it when it is off screen. A row
 * taller than the pane reveals its matched text (`match`, the current range) instead of its top (Astra 10-16).
 */
export function revealPaneRow(container: HTMLElement | null, rowIndex: number | null, match?: Range | null): void {
  if (!container || rowIndex == null) return;
  const row = paneRowsHost(container).children[rowIndex] as HTMLElement | undefined;
  if (!row) return;
  const rowRect = row.getBoundingClientRect();
  const box = container.getBoundingClientRect();
  const r = rowRect.height > box.height && match ? match.getBoundingClientRect() : rowRect;
  if (r.top >= box.top && r.bottom <= box.bottom) return;
  container.scrollTop += (r.top - box.top) - Math.max(0, (box.height - r.height) / 2);
}
