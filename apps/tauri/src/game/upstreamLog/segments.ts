import type { Orientation } from '@fumbbl40k/ffb-pitch';
import type { LogNameTeam } from '../logNames';
import { screenDirection } from '../logDirection';
import type { UpstreamLogLine, UpstreamSpanStyle } from './types';

/** One run of an upstream line with one look: its text styles and, for a player / team / coach name, the team. */
export interface UpstreamLogSegment {
  text: string;
  styles: UpstreamSpanStyle[];
  team?: LogNameTeam;
  playerId?: string;
  /** A field direction word: the view names it for the pitch as shown (upstreamDirectionWord). */
  direction?: string;
  lower?: true;
}

const SCREEN_COMPASS: Record<string, string> = {
  up: 'North', 'up-right': 'Northeast', right: 'East', 'down-right': 'Southeast',
  down: 'South', 'down-left': 'Southwest', left: 'West', 'up-left': 'Northwest',
};
/** Upstream's mapToLocal(direction).getName(): the compass word of the direction as the reader sees the pitch (screen
 *  up = North; a landscape pitch shown unflipped reads the field direction unchanged, a portrait one turns it, as
 *  upstream's PitchDimensionProvider does). Lower-cased where upstream lower-cases it. */
export function upstreamDirectionWord(direction: string, lower: boolean, orientation: Orientation, flipped: boolean): string {
  const screen = screenDirection(direction, orientation, flipped);
  const word = screen ? SCREEN_COMPASS[screen.word] ?? direction : direction;
  return lower ? word.toLowerCase() : word;
}

/** Split an upstream line at every span and name boundary (tokens outside the text are ignored, fail-soft). */
export function upstreamLogSegments(line: UpstreamLogLine): UpstreamLogSegment[] {
  const text = line.text ?? '';
  const inText = <T extends { length: number }>(start: number, item: T) => Number.isInteger(start) && item.length > 0 && start >= 0 && start + item.length <= text.length;
  const spans = (line.spans ?? []).filter((s) => inText(s.start, s));
  const names = (line.names ?? []).filter((n) => inText(n.index, n));
  const dirs = (line.dirs ?? []).filter((d) => inText(d.index, d));
  const cuts = new Set<number>([0, text.length]);
  for (const s of spans) { cuts.add(s.start); cuts.add(s.start + s.length); }
  for (const n of names) { cuts.add(n.index); cuts.add(n.index + n.length); }
  for (const d of dirs) { cuts.add(d.index); cuts.add(d.index + d.length); }
  const points = [...cuts].sort((a, b) => a - b);
  const out: UpstreamLogSegment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (end <= start) continue;
    const styles = spans.filter((s) => s.start <= start && s.start + s.length >= end).map((s) => s.style);
    const name = names.find((n) => n.index <= start && n.index + n.length >= end);
    const dir = dirs.find((d) => d.index <= start && d.index + d.length >= end);
    out.push({
      text: text.slice(start, end),
      styles: [...new Set(styles)],
      ...(name ? { team: name.team } : {}),
      ...(name?.playerId ? { playerId: name.playerId } : {}),
      ...(dir ? { direction: dir.direction, ...(dir.lower ? { lower: true as const } : {}) } : {}),
    });
  }
  return out;
}

function joinParagraph(head: UpstreamLogLine, tail: UpstreamLogLine): UpstreamLogLine {
  const at = head.text.length;
  const dirs = [...(head.dirs ?? []), ...(tail.dirs ?? []).map((d) => ({ ...d, index: d.index + at }))];
  return {
    text: head.text + tail.text,
    indent: tail.indent,
    ...(tail.space ? { space: tail.space } : {}),
    spans: [...head.spans, ...tail.spans.map((s) => ({ ...s, start: s.start + at }))],
    names: [...head.names, ...tail.names.map((n) => ({ ...n, index: n.index + at }))],
    ...(dirs.length ? { dirs } : {}),
    ...(head.continues ? { continues: true as const } : {}),
    ...(tail.open ? { open: true as const } : {}),
  };
}

/** A log entry as the FUMBBL style reads it. */
export interface UpstreamLogRowEntry {
  kind: string;
  text: string;
  names?: import('../logNames').LogNameToken[];
  u?: UpstreamLogLine[];
}

/**
 * The FUMBBL style's rows: a report entry shows its upstream lines (none when it has none, e.g. a line the client
 * writes itself), any other entry (a client notice) its own text on one line.
 */
export function upstreamLogRows<T extends UpstreamLogRowEntry>(entries: readonly T[]): { entry: T; line: UpstreamLogLine; first: boolean }[] {
  const rows: { entry: T; line: UpstreamLogLine; first: boolean }[] = [];
  let openRow = -1;
  for (const entry of entries) {
    if (entry.kind === 'report') {
      (entry.u ?? []).forEach((line, index) => {
        // a paragraph the previous report left open: the continuation joins it into ONE paragraph, which takes the
        // paragraph style of its last print (upstream's ChatLogTextPane sets it per print)
        if (line.continues && openRow >= 0) {
          rows[openRow] = stableRow(rows[openRow]!.entry, joinedParagraph(rows[openRow]!.line, line), rows[openRow]!.first);
          if (!line.open) openRow = -1;
          return;
        }
        rows.push(stableRow(entry, line, index === 0));
        openRow = line.open ? rows.length - 1 : -1;
      });
    } else {
      rows.push(stableRow(entry, noticeLine(entry), true));
    }
  }
  return rows;
}

// Perf (JLeav 1.0.296): the rows above keep their identity across calls - a row is memoised on its line, a joined
// paragraph on its two halves, a notice's line on its entry (all immutable) - so the view's Log keys and memoises
// them by identity and a new line renders only the new row.
const rowCache = new WeakMap<UpstreamLogLine, { entry: unknown; line: UpstreamLogLine; first: boolean }>();
function stableRow<T>(entry: T, line: UpstreamLogLine, first: boolean): { entry: T; line: UpstreamLogLine; first: boolean } {
  const hit = rowCache.get(line);
  if (hit && hit.entry === entry && hit.first === first) return hit as { entry: T; line: UpstreamLogLine; first: boolean };
  const row = { entry, line, first };
  rowCache.set(line, row);
  return row;
}
const joinCache = new WeakMap<UpstreamLogLine, WeakMap<UpstreamLogLine, UpstreamLogLine>>();
function joinedParagraph(head: UpstreamLogLine, tail: UpstreamLogLine): UpstreamLogLine {
  let byTail = joinCache.get(head);
  if (!byTail) joinCache.set(head, byTail = new WeakMap());
  let joined = byTail.get(tail);
  if (!joined) byTail.set(tail, joined = joinParagraph(head, tail));
  return joined;
}
const noticeLines = new WeakMap<object, UpstreamLogLine>();
function noticeLine(entry: UpstreamLogRowEntry): UpstreamLogLine {
  let line = noticeLines.get(entry);
  if (!line) noticeLines.set(entry, line = { text: entry.text, indent: 0, spans: [], names: entry.names ?? [] });
  return line;
}
