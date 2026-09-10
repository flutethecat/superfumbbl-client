/**
 * #157-v2 (owner 08-18): player NAMES in the log carry a TEAM tag emitted at FORMAT time
 * (reportFormatter marks each name it resolves from a playerId), so the view never has to
 * regex roster names back out of finished text — a name that collides with copy, or with a
 * name on the other roster, can no longer be mis-tinted.
 *
 * The token is deliberately the TEAM identity (home/away), NOT a colour and NOT "mine/theirs":
 * the same formatted entry has to re-map when the reader's seat differs (a playing coach sees
 * mine/opponent; a spectator or replay viewer sees native home/away), and log entries are
 * formatted once and kept. Seat-relativisation therefore lives at RENDER time in the view.
 */

export type LogNameTeam = 'home' | 'away';

/** One tagged player name inside a formatted log line. `index` is an offset into the entry text.
 *  Owner 08-19: `playerId` rides along (additive — offsets untouched) so the view can make the
 *  name CLICKABLE: click puts the locate cue (renderer.showRosterAttentionCue) on the player,
 *  the same behaviour a roster-row click has. The formatter knows the id at tag time (pn()
 *  resolves the name FROM the id), so no reverse name→id lookup ever happens in the view. */
export interface LogNameToken {
  index: number;
  length: number;
  team: LogNameTeam;
  playerId?: string;
}

/**
 * Seat-relative mapping: which seat COLOUR a tagged name takes for this reader.
 *   mySeat null (spectating / replay) -> native, the name's own team colour.
 *   mySeat set (playing)              -> my players take the home/friendly colour and the
 *                                        opponent's the away/enemy one, whichever seat I hold,
 *                                        so the pairing is identical from either chair.
 * Pure so both the view and its tests can read the same table.
 */
export function logNameSeatKey(team: LogNameTeam, mySeat: LogNameTeam | null): LogNameTeam {
  if (!mySeat) return team;
  return team === mySeat ? 'home' : 'away';
}

export type LogNamePart =
  | { text: string; team?: never; playerId?: never }
  | { text: string; team: LogNameTeam; playerId?: string };

/**
 * Split ONE contiguous text run of a log entry into plain / tagged-name parts.
 * `start` is the run's absolute offset in the entry text, because a run handed to us is
 * usually a slice between rendered dice glyphs while the tokens are entry-absolute.
 * Tokens outside the run, or that would run past its end, are ignored (fail-soft: the text
 * still renders, just untinted).
 */
export function logNameParts(run: string, start: number, tokens: readonly LogNameToken[] | undefined): LogNamePart[] {
  const end = start + run.length;
  const inRun = (tokens ?? [])
    .filter((t) => Number.isInteger(t.index) && t.length > 0 && t.index >= start && t.index + t.length <= end)
    .sort((a, b) => a.index - b.index);
  if (!inRun.length) return run ? [{ text: run }] : [];

  const parts: LogNamePart[] = [];
  let cursor = start;
  for (const token of inRun) {
    if (token.index < cursor) continue; // overlapping tags: first one wins
    if (token.index > cursor) parts.push({ text: run.slice(cursor - start, token.index - start) });
    parts.push({
      text: run.slice(token.index - start, token.index + token.length - start),
      team: token.team,
      ...(token.playerId ? { playerId: token.playerId } : {}),
    });
    cursor = token.index + token.length;
  }
  if (cursor < end) parts.push({ text: run.slice(cursor - start) });
  return parts;
}
