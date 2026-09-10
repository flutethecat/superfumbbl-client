/** Owner 09-07: the FUMBBL live list grouped by COMPETITION. /api/match/current carries `division`
 *  ("League" / "Competitive"), `scheduler` ("Blackbox"…) and, for tournament games, `tournament: { id, group }`
 *  (ids only) — the names come from /api/group/get/<group> and /api/tournament/get/<id>, cached by the view. */
export interface CompetitionMatchLike {
  division?: string | null;
  scheduler?: string | null;
  tournament?: { id?: number | string; group?: number | string } | null;
}

export interface CompetitionNames {
  groups: Record<string, string>;
  tournaments: Record<string, string>;
}

export interface CompetitionGroup<M> { key: string; label: string; matches: M[] }

export function competitionKeyOf(match: CompetitionMatchLike): string {
  const t = match.tournament;
  if (t && (t.id != null || t.group != null)) return `t:${String(t.group ?? '')}:${String(t.id ?? '')}`;
  return `d:${String(match.division ?? '')}:${String(match.scheduler ?? '')}`;
}

export function competitionLabel(match: CompetitionMatchLike, names: CompetitionNames): string {
  const t = match.tournament;
  if (t && (t.id != null || t.group != null)) {
    const group = t.group != null ? names.groups[String(t.group)] ?? `Group ${t.group}` : '';
    const tour = t.id != null ? names.tournaments[String(t.id)] ?? `Tournament ${t.id}` : '';
    return [group, tour].filter(Boolean).join(' · ');
  }
  const division = String(match.division ?? '').trim() || 'Other';
  const scheduler = String(match.scheduler ?? '').trim();
  return scheduler ? `${division} · ${scheduler}` : division;
}

/** Owner 09-07: Blackbox always on top, Gamefinder next, other Competitive schedulers after those; then the
 *  tournaments (alphabetical by label); leagues at the bottom. Input order within a group is preserved (the caller
 *  sorts by progress first). */
export function groupByCompetition<M extends CompetitionMatchLike>(matches: readonly M[], names: CompetitionNames): CompetitionGroup<M>[] {
  const groups = new Map<string, CompetitionGroup<M>>();
  for (const match of matches) {
    const key = competitionKeyOf(match);
    let group = groups.get(key);
    if (!group) { group = { key, label: competitionLabel(match, names), matches: [] }; groups.set(key, group); }
    group.matches.push(match);
  }
  const rank = (g: CompetitionGroup<M>): number => {
    const k = g.key.toLowerCase();
    if (k.startsWith('d:competitive:blackbox') || k.endsWith(':blackbox')) return 0;
    if (k.includes('gamefinder')) return 1;
    if (k.startsWith('d:competitive')) return 2;
    if (k.startsWith('t:')) return 3;
    if (k.startsWith('d:league')) return 4;
    return 5;
  };
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/** The group / tournament ids the list refers to that the cache does not know yet. */
export function missingCompetitionIds(matches: readonly CompetitionMatchLike[], names: CompetitionNames): { groups: string[]; tournaments: string[] } {
  const groups = new Set<string>();
  const tournaments = new Set<string>();
  for (const m of matches) {
    const t = m.tournament;
    if (!t) continue;
    if (t.group != null && !(String(t.group) in names.groups)) groups.add(String(t.group));
    if (t.id != null && !(String(t.id) in names.tournaments)) tournaments.add(String(t.id));
  }
  return { groups: [...groups], tournaments: [...tournaments] };
}
