/** Owner 10-01: client-local text labels on Shift+click annotations (square marks and player arrows).
 *  Pure text shaping only — the renderer draws the lines, the view hosts the input. Never sent on the wire. */

/** Square label input cap (the field's maxlength). */
export const SQUARE_MARK_LABEL_MAX_CHARS = 24;
/** Player label input cap: 2 lines x 6 characters (owner 10-08, bug report JLeav: "only 3 characters before it breaks
 *  into a new line"). A line of 1-3 characters draws at the full markings size; 4-6 characters SHRINK the text so the
 *  line still fits the figure (see playerMarkLabelScale) before any line break happens. */
export const PLAYER_MARK_LABEL_MAX_CHARS = 12;
export const PLAYER_MARK_LABEL_LINE_CHARS = 6;
export const PLAYER_MARK_LABEL_MAX_LINES = 2;
/** Characters that fit a line at full size; longer lines scale down. */
export const PLAYER_MARK_LABEL_FULL_SIZE_CHARS = 3;
/** The smallest scale: a 6-character line at 3 / 6 is exactly as wide as a 3-character line at full size, so the
 *  label never grows past the footprint it always had (Astra 10-08: a 0.55 floor overhung a checkers disc). */
export const PLAYER_MARK_LABEL_MIN_SCALE = 0.5;

/** Font scale for a shaped player label: 1 up to 3 characters on the longest line, then width-preserving (3 / n)
 *  down to PLAYER_MARK_LABEL_MIN_SCALE at 6 characters. */
export function playerMarkLabelScale(lines: readonly string[]): number {
  const longest = lines.reduce((max, line) => Math.max(max, markLabelCharacters(line).length), 0);
  if (longest <= PLAYER_MARK_LABEL_FULL_SIZE_CHARS) return 1;
  return Math.max(PLAYER_MARK_LABEL_MIN_SCALE, PLAYER_MARK_LABEL_FULL_SIZE_CHARS / longest);
}

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

/** At most 2 lines of at most 6 characters. A space or line break typed by the user splits the lines; otherwise
 *  characters 1-6 are line one and 7-12 line two. Overflow is dropped. */
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
