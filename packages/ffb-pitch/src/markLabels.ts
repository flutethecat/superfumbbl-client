/** Owner 10-01: client-local text labels on Shift+click annotations (square marks and player arrows).
 *  Pure text shaping only — the renderer draws the lines, the view hosts the input. Never sent on the wire. */

/** Square label input cap (the field's maxlength). */
export const SQUARE_MARK_LABEL_MAX_CHARS = 24;
/** Player label input cap: 2 lines x 3 characters. */
export const PLAYER_MARK_LABEL_MAX_CHARS = 6;
export const PLAYER_MARK_LABEL_LINE_CHARS = 3;
export const PLAYER_MARK_LABEL_MAX_LINES = 2;

/** The user-perceived characters of a string (review r1): an accent stays with its letter and an emoji is one
 *  character. Falls back to code points where Intl.Segmenter is unavailable. */
export function markLabelCharacters(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
  if (!Segmenter) return Array.from(text);
  return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment);
}

/** Break one word into pieces that each measure <= maxWidth (at least one character per piece). */
function breakWord(word: string, measure: (text: string) => number, maxWidth: number): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const ch of markLabelCharacters(word)) {
    if (current && measure(current + ch) > maxWidth) {
      pieces.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Block capitals, word-wrapped to `maxWidth` (via `measure`), long words broken across lines, at most `maxLines`
 *  lines — anything that does not fit is dropped (never shrunk, never overflowing the tile). */
export function shapeSquareMarkLabel(
  text: string,
  measure: (text: string) => number,
  maxWidth: number,
  maxLines = 3,
): string[] {
  const words = text.toUpperCase().split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';
  const push = (line: string): boolean => {
    if (lines.length >= maxLines) return false;
    lines.push(line);
    return lines.length < maxLines;
  };
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth) { current = candidate; continue; }
    if (current) {
      if (!push(current)) return lines;
      current = '';
    }
    if (measure(word) <= maxWidth) { current = word; continue; }
    const pieces = breakWord(word, measure, maxWidth);
    for (let i = 0; i < pieces.length - 1; i++) {
      if (!push(pieces[i]!)) return lines;
    }
    current = pieces[pieces.length - 1] ?? '';
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

/** At most 2 lines of at most 3 characters. A space or line break typed by the user splits the lines; otherwise
 *  characters 1-3 are line one and 4-6 line two. Overflow is dropped. */
export function shapePlayerMarkLabel(text: string): string[] {
  const chunks = text.split(/\s+/).filter((chunk) => chunk.length > 0);
  const lines: string[] = [];
  for (const chunk of chunks) {
    const chars = markLabelCharacters(chunk);
    for (let i = 0; i < chars.length; i += PLAYER_MARK_LABEL_LINE_CHARS) {
      if (lines.length >= PLAYER_MARK_LABEL_MAX_LINES) return lines;
      lines.push(chars.slice(i, i + PLAYER_MARK_LABEL_LINE_CHARS).join(''));
    }
  }
  return lines;
}
