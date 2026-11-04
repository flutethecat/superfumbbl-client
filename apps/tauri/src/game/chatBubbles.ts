/**
 * Owner 10-16 (Settings > Display > Log > Chat style "Bubbles"): the chat pane as a stack of message bubbles that
 * builds from the bottom. Each bubble is shaded with a DARK version of the speaker's seat colour (the same seat tint
 * the log names use, so home/away read in the pitch's hue family); spectators and unknown speakers get a neutral grey.
 * Pure so the view, the bubble component and the tests read one table.
 */
import { chatLineParts } from './chatLine';
import type { ChatAuthorSide, ChatToastRole } from './chatAuthor';

export type ChatStyle = 'text' | 'bubbles';

/** The chat entry fields the bubbles read (a subset of the store's LogEntry). */
export type ChatBubbleEntry = { text: string; time?: string; side?: ChatAuthorSide | null };

export type ChatBubbleRow = {
  /** Coach name ('' for a line without a "name: " prefix). */
  name: string;
  /** The message words. */
  rest: string;
  side: ChatAuthorSide;
  /** Same speaker as the bubble above: the name label collapses. */
  chained: boolean;
  /** Inline CSS custom properties: the bubble's dark shades and edge colour, plus the speaker's raw seat colour
   *  (--chat-bubble-seat, read only by the Modern in-game skin's side bar; Retro does not use it). */
  style: Record<string, string>;
  /** The dark shade at the bottom of the bubble (also the --chat-bubble-deep value). */
  deep: string;
};

/** The background the dark shades mix towards (near-black, slightly cool, like the toast frame). */
const SHADE_BASE = '#06080b';
/** Fallback seat colours when the renderer has no seat tint yet (same hues as the chat toasts' base colours). */
const ROLE_FALLBACK: Record<ChatToastRole, string> = { blue: '#003eb3', red: '#b30000', green: '#5a6472', neutral: '#5a6472' };
/** Spectators and unknown speakers: a neutral grey bubble (owner 10-16). */
export const CHAT_BUBBLE_NEUTRAL = '#5a6472';

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `t` of colour `a` over `1 - t` of colour `b`, as #rrggbb. Null when either input is not a #rrggbb hex. */
export function mixHex(a: string, b: string, t: number): string | null {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return null;
  const k = Math.min(1, Math.max(0, t));
  return `#${x.map((v, i) => Math.round(v * k + y[i]! * (1 - k)).toString(16).padStart(2, '0')).join('')}`;
}

/** The bubble shades for one seat colour: deep (bottom), mid (top) and the lighter edge, all #rrggbb. */
export function chatBubbleShades(seat: string): { deep: string; mid: string; edge: string } {
  const base = parseHex(seat) ? seat : CHAT_BUBBLE_NEUTRAL;
  return {
    deep: mixHex(base, SHADE_BASE, 0.3)!,
    mid: mixHex(base, SHADE_BASE, 0.46)!,
    edge: mixHex(base, '#ffffff', 0.8)!,
  };
}

/**
 * Build the bubble rows. `seatColor` = the view's logNameColor (seat-relative tint, undefined before the renderer
 * reports one); `role` = chatToastRole for the same seat mapping when no tint exists.
 */
export function chatBubbleRows(
  entries: readonly ChatBubbleEntry[],
  seatColor: (side: 'home' | 'away') => string | undefined,
  role: (side: ChatAuthorSide) => ChatToastRole,
): ChatBubbleRow[] {
  const rows: ChatBubbleRow[] = [];
  let prev: { name: string; side: ChatAuthorSide } | null = null;
  for (const entry of entries) {
    const { name, rest } = chatLineParts(entry.text);
    const side: ChatAuthorSide = entry.side ?? 'unknown';
    const seat = side === 'home' || side === 'away'
      ? (seatColor(side) ?? ROLE_FALLBACK[role(side)])
      : CHAT_BUBBLE_NEUTRAL;
    const shades = chatBubbleShades(seat);
    const chained = !!name && !!prev && prev.name === name && prev.side === side;
    rows.push({
      name,
      rest,
      side,
      chained,
      deep: shades.deep,
      style: { '--chat-bubble-deep': shades.deep, '--chat-bubble-mid': shades.mid, '--chat-bubble-edge': shades.edge, '--chat-bubble-seat': seat },
    });
    prev = { name, side };
  }
  return rows;
}
