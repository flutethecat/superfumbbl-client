/**
 * Owner 08-18: kind-tagged DISPLAY-DECORATION tokens in the log, emitted at FORMAT time
 * through the same private-use-area mark idiom as dice + player names (reportFormatter
 * marks the run, decodeDisplay strips the marks back out into indexed tokens) — `text`
 * stays byte-identical to the untagged output, the view gets structure.
 *
 *   'title'  — the leading "Block"/"Uphill Block" literal on block lines; the view gives
 *              it an embossed/raised treatment so the line kind reads at a glance.
 *   'armour' — the word "armour" on armour lines (owner 08-19; was the 🛡 emoji): the view
 *              overlays the breastplate icon art (the same asset the on-pitch armour die
 *              toast uses) while the underlying text node keeps the word, so copy yields
 *              "armour" — the icon alone carries the meaning visually.
 *   'hidden' — a word that stays in the TEXT (copy keeps it) but renders zero-visual —
 *              owner 08-19: the word "rolls" before an inline die glyph ("dodges: ⚃ (⚂+)"
 *              visible, "dodges: rolls 4 (3+)" copied). Same transparent-text technique
 *              as the armour swap, no icon overlay.
 *   'stat-down-ni' — the NI abbreviation in a serious-injury result; the view overlays the
 *                    approved NI stat-down art while copy and assistive text keep "NI".
 *   'fail'   — the word "fails" on a failed roll line (owner 09-09): the view paints it scarlet
 *              so a failure reads at a glance; copy keeps the plain word.
 */

export type LogTagKind = 'title' | 'armour' | 'hidden' | 'stat-down-ni' | 'fail';

/** One tagged run inside a formatted log line. `index` is an offset into the entry text. */
export interface LogTagToken {
  index: number;
  length: number;
  kind: LogTagKind;
}

/** A split piece of a text run. `start` is the piece's ABSOLUTE offset in the entry text so
 *  untagged pieces can be handed straight on to logNameParts (which is entry-absolute too). */
export type LogTagPart = { text: string; start: number; kind?: LogTagKind };

/**
 * Split ONE contiguous text run of a log entry into plain / tagged pieces.
 * Same contract as logNameParts: `start` is the run's absolute offset in the entry text
 * (a run handed to us is usually a slice between rendered dice glyphs); tokens outside the
 * run, or that would overrun its end, are ignored (fail-soft: the text still renders plain).
 */
export function logTagParts(run: string, start: number, tokens: readonly LogTagToken[] | undefined): LogTagPart[] {
  const end = start + run.length;
  const inRun = (tokens ?? [])
    .filter((t) => Number.isInteger(t.index) && t.length > 0 && t.index >= start && t.index + t.length <= end)
    .sort((a, b) => a.index - b.index);
  if (!inRun.length) return run ? [{ text: run, start }] : [];

  const parts: LogTagPart[] = [];
  let cursor = start;
  for (const token of inRun) {
    if (token.index < cursor) continue; // overlapping tags: first one wins
    if (token.index > cursor) parts.push({ text: run.slice(cursor - start, token.index - start), start: cursor });
    parts.push({ text: run.slice(token.index - start, token.index + token.length - start), start: token.index, kind: token.kind });
    cursor = token.index + token.length;
  }
  if (cursor < end) parts.push({ text: run.slice(cursor - start), start: cursor });
  return parts;
}
