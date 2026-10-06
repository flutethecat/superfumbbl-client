/**
 * P1 (owner 10-06, FUMBBL game 1950446 investigation): upstream answers a PLAYER join that carried no teamId into an
 * unscheduled, unstarted game with `serverTeamList` (ServerCommandHandlerJoinApproved.sendTeamList) and waits for the
 * client to join again WITH a teamId. The official client asks the coach (DialogTeamChoice). This client picks only
 * when the answer is unambiguous; otherwise the coach chooses. The client never guesses.
 */
import type { TeamListEntry } from '@fumbbl40k/ffb-protocol';

export interface TeamChoiceEntry {
  teamId: string;
  /** the server's own team name, exactly as sent ('' when it sent none) — the only name matched or put on the wire */
  teamName: string;
  /** display label: the server's name, or "Team <id>" when it sent none (never matched, never sent) */
  label: string;
  race: string;
  teamValue: number | null;
}

export type TeamPick =
  | { kind: 'auto'; entry: TeamChoiceEntry; reason: 'teamId' | 'teamName' | 'single' }
  | { kind: 'choose'; entries: TeamChoiceEntry[] }
  | { kind: 'empty' };

/** The usable rows of a server team list (a row without a teamId cannot be joined with). */
export function teamChoiceEntries(entries: readonly TeamListEntry[] | null | undefined): TeamChoiceEntry[] {
  const out: TeamChoiceEntry[] = [];
  for (const entry of entries ?? []) {
    const teamId = String(entry?.teamId ?? '').trim();
    if (!teamId) continue;
    const tv = Number(entry.teamValue);
    const teamName = String(entry.teamName ?? '');
    out.push({
      teamId,
      teamName,
      label: teamName.trim() || `Team ${teamId}`,
      race: String(entry.race ?? '').trim(),
      teamValue: entry.teamValue != null && Number.isFinite(tv) ? tv : null,
    });
  }
  return out;
}

/** The pick rule: the row matching the known teamId, else the known team name (ignoring case), else the only row. */
export function pickTeam(
  entries: readonly TeamListEntry[] | null | undefined,
  known: { teamId?: string | null; teamName?: string | null },
): TeamPick {
  const rows = teamChoiceEntries(entries);
  if (rows.length === 0) return { kind: 'empty' };
  const teamId = String(known.teamId ?? '').trim();
  if (teamId) {
    const byId = rows.find((row) => row.teamId === teamId);
    if (byId) return { kind: 'auto', entry: byId, reason: 'teamId' };
  }
  const teamName = String(known.teamName ?? '').trim().toLowerCase();
  if (teamName) {
    const byName = rows.filter((row) => row.teamName.trim() !== '' && row.teamName.trim().toLowerCase() === teamName);
    if (byName.length === 1) return { kind: 'auto', entry: byName[0]!, reason: 'teamName' };
  }
  if (rows.length === 1) return { kind: 'auto', entry: rows[0]!, reason: 'single' };
  return { kind: 'choose', entries: rows };
}

/** "1,150k" style team value for the chooser rows (upstream team values are in gold pieces). */
export function formatTeamValue(teamValue: number | null): string {
  if (teamValue == null) return '';
  return `${Math.round(teamValue / 1000).toLocaleString('en-US')}k`;
}
