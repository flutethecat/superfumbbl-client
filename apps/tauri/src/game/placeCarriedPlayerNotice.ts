// Owner 09-29 (S30): the I'll Carry You placement prompt (turn mode `placeCarriedPlayer` + `informationOkay`,
// confirm:false — the server never waits on it, it waits for CLIENT_FIELD_COORDINATE) is shown as the standard
// red/black notice card instead of the "Server message" card. ONE decision for the store (skip the card) and the
// view (show the notice). Addressing (which coach places) is the caller's check.
export type PlaceCarriedPlayerNotice = { title: string; message: string };

export const PLACE_CARRIED_PLAYER_DEFAULT_TITLE = 'Place carried player';

export function placeCarriedPlayerNotice(
  g: { turnMode?: unknown; dialogParameter?: unknown } | null | undefined,
): PlaceCarriedPlayerNotice | null {
  if (!g || String(g.turnMode ?? '') !== 'placeCarriedPlayer') return null;
  const dp = g.dialogParameter as { dialogId?: unknown; confirm?: unknown; text?: unknown; messageArray?: unknown } | null | undefined;
  if (!dp || String(dp.dialogId ?? '') !== 'informationOkay' || dp.confirm === true) return null;
  const lines = Array.isArray(dp.messageArray) ? (dp.messageArray as unknown[]).map(String) : [];
  const title = typeof dp.text === 'string' ? dp.text.trim() : '';
  return { title: title || PLACE_CARRIED_PLAYER_DEFAULT_TITLE, message: lines.join(' ').trim() };
}

/** The exact `state.infoNotice.text` the store builds for this dialog ("<title>: <messages>", title = raw `text`),
 *  or null when the game is not showing the placement prompt. Mirrors the store's informationOkay branch. */
export function placeCarriedPlayerInfoNoticeText(
  g: { turnMode?: unknown; dialogParameter?: unknown } | null | undefined,
): string | null {
  if (!placeCarriedPlayerNotice(g)) return null;
  const dp = g!.dialogParameter as { text?: unknown; messageArray?: unknown };
  const msgs = Array.isArray(dp.messageArray) ? (dp.messageArray as unknown[]).map(String) : [];
  const title = typeof dp.text === 'string' ? dp.text : '';
  return [title, msgs.join(' ').trim()].filter(Boolean).join(': ') || null;
}

/** What the main view does with the current Server message: hide it while the placement prompt is pending and it IS
 *  the prompt's text; clear it once the prompt is over and it still holds the prompt's text (`lastPromptText`, the
 *  text seen while pending); otherwise show it. Any other server message is never touched. */
export function serverMessageForPlacement(
  g: { turnMode?: unknown; dialogParameter?: unknown } | null | undefined,
  noticeText: string | null | undefined,
  lastPromptText: string | null | undefined,
): 'show' | 'hide' | 'clear' {
  if (!noticeText) return 'show';
  const pending = placeCarriedPlayerInfoNoticeText(g);
  if (pending !== null) return noticeText === pending ? 'hide' : 'show';
  return lastPromptText && noticeText === lastPromptText ? 'clear' : 'show';
}
