/**
 * S44 (owner 09-29): the official FUMBBL server admits a join comparing coach names ignoring case, then checks team
 * ownership letter for letter and answers "Not Your Team". So a stored `flutethecat` for the account `Flutethecat`
 * is refused. This module holds the ONE rule for "the exact spelling differs only in letter case", the ONE place the
 * stored FUMBBL coach name is written (`settings.coach`; the fork name `coach40k` is a separate field and is never
 * touched here), and the lookup order for the exact spelling. No credential passes through here.
 */
import type { GameListEntry } from '@fumbbl40k/ffb-protocol';
import { settings } from './settings';
import { fetchFumbblCoachTeams, type FumbblCoachTeamsResult } from './fumbblCoachTeams';

export type CoachLookup = (coachName: string) => Promise<FumbblCoachTeamsResult>;
export type ExactCoachSource = 'game-list' | 'server-game' | 'coach-lookup' | 'typed';

const isAsciiLetter = (ch: string): boolean => (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');

/** Equal, or equal after folding ASCII letters only. Locale-independent: no Unicode folding (dotless i, sharp s,
 *  full-width letters) and no trimming, so a trailing space or any other character is a real difference. */
export function equalsIgnoringAsciiCase(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) continue;
    if (!(isAsciiLetter(x) && isAsciiLetter(y) && x.toLowerCase() === y.toLowerCase())) return false;
  }
  return true;
}

/** True only when `exact` is the same name as `stored` and every differing character pair is an ASCII letter pair
 *  (a case difference and nothing else). A different name is never a match. */
export function differsOnlyInCase(stored: string, exact: string): boolean {
  return !!stored && stored !== exact && equalsIgnoringAsciiCase(stored, exact);
}

/** The spelling among `candidates` that equals `stored` ignoring ASCII case (first match wins), else null. */
export function exactSpellingAmong(stored: string, candidates: ReadonlyArray<string | null | undefined>): string | null {
  if (!stored) return null;
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate && equalsIgnoringAsciiCase(stored, candidate)) return candidate;
  }
  return null;
}

/** The coach names of the two teams of one server game list entry, as the server holds them. */
export function listEntryCoaches(entry: GameListEntry | null | undefined): string[] {
  return entry ? [entry.teamHomeCoach, entry.teamAwayCoach].filter((c): c is string => typeof c === 'string' && !!c.trim()) : [];
}

export interface ExactCoachName {
  name: string;
  source: ExactCoachSource;
}

/** Exact spelling for a player join, in this order: (a) candidate names the server itself sent (its game list entry),
 *  (b) the public coach lookup, (c) the name as typed. A lookup that fails or names someone else falls through. */
export async function resolveExactCoachName(
  typed: string,
  serverNames: ReadonlyArray<string | null | undefined>,
  lookup: CoachLookup = (name) => fetchFumbblCoachTeams(name),
  serverSource: ExactCoachSource = 'game-list',
): Promise<ExactCoachName> {
  const fromServer = exactSpellingAmong(typed, serverNames);
  if (fromServer) return { name: fromServer, source: serverSource };
  try {
    const result = await lookup(typed);
    if (result.kind === 'found') {
      const fromLookup = exactSpellingAmong(typed, [result.coachName]);
      if (fromLookup) return { name: fromLookup, source: 'coach-lookup' };
    }
  } catch { /* the website is only a fallback; the name as typed is still tried */ }
  return { name: typed, source: 'typed' };
}

/** The only writer of the stored FUMBBL coach name. Corrects letter case only; returns true when it changed the name. */
export function correctStoredCoachName(exact: string): boolean {
  if (!differsOnlyInCase(settings.coach, exact)) return false;
  settings.coach = exact;
  return true;
}

/** Notice for an exact spelling that differs from the stored name only in case; also writes the corrected stored name.
 *  Null when nothing changed (typed name, other name, or already stored exactly). */
export function correctStoredCoachNameWithNotice(exact: string): string | null {
  const was = settings.coach;
  return correctStoredCoachName(exact) ? coachCorrectedNotice(was, exact) : null;
}

/** The stored FUMBBL coach name, as the settings hold it. */
export function storedFumbblCoach(): string {
  return settings.coach;
}

/** The FUMBBL password as the existing credential holder has it right now (never copied anywhere else). */
export function storedFumbblPassword(): string {
  return settings.password;
}

/** Plain-words notice for a corrected name (shown once: the next join already matches). */
export function coachCorrectedNotice(was: string, exact: string): string {
  return `Your coach name was saved as '${was}'. The server knows you as '${exact}'. It has been corrected.`;
}
