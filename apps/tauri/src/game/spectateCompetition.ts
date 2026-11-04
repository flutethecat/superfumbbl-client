/** Owner 09-07: the FUMBBL live list grouped by COMPETITION. /api/match/current carries `division`
 *  ("League" / "Competitive"), `scheduler` ("Blackbox"…) and, for tournament games, `tournament: { id, group }`
 *  (ids only) — the names come from /api/group/get/<group> and /api/tournament/get/<id>, cached by the view. */
import { t } from '../i18n';
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
  // Owner 09-15: a Competitive scheduler (Blackbox, Gamefinder) reads by its own name — "Competitive ·" was noise.
  if (scheduler && /^competitive$/i.test(division)) return scheduler;
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

/** Owner 11-03 (Modern Spectate): a tidy display name for a group label (buttons and sub-band headings). The group
 *  keys and the Retro headings are unchanged.
 *  - FUMBBL's scheduler id "Blackbox" reads "Black Box".
 *  - A game with no competition ("League · None", or no division at all) reads "Other".
 *  - A League-division game from a scheduler ("League · Gamefinder") is a different FUMBBL division from the
 *    Competitive one ("Gamefinder"), so it stays its own group, labelled "Gamefinder (League)". */
export function lmGroupLabel(label: string): string {
  const tidy = label.replace(/\bblack ?box\b/gi, 'Black Box').trim();
  const [first, ...rest] = tidy.split(' · ');
  const second = rest.join(' · ');
  if (!tidy || /^other$/i.test(tidy) || (rest.length && /^none$/i.test(second))) return t('lmBlades.group.other');
  if (rest.length && /^league$/i.test(first ?? '') && !/^none$/i.test(second)) return t('lmBlades.group.inLeague', { name: second });
  return tidy;
}

/** Owner 11-03: the live groups under their tidy labels, groups that read the same merged (e.g. two kinds of
 *  "Other"), in the order groupByCompetition gave. The key is the tidy label. */
export function lmMergeGroups<M>(groups: readonly CompetitionGroup<M>[]): CompetitionGroup<M>[] {
  const merged = new Map<string, CompetitionGroup<M>>();
  for (const group of groups) {
    const label = lmGroupLabel(group.label);
    const into = merged.get(label);
    if (into) into.matches.push(...group.matches);
    else merged.set(label, { key: `lm:${label}`, label, matches: [...group.matches] });
  }
  return [...merged.values()];
}
