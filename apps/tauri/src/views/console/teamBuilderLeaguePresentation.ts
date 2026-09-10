export interface LeagueFieldPresentation {
  visible: boolean;
  interactive: boolean;
  disabled: boolean;
  required: boolean;
  selectionRequired: boolean;
  selectedValid: boolean;
}

export interface LeagueSelection {
  selectedLeague: string;
  explicit: boolean;
}

export function normalizeLeagueOptions(leagueOptions: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const option of leagueOptions ?? []) {
    const league = option.trim();
    if (!league || seen.has(league)) continue;
    seen.add(league);
    normalized.push(league);
  }
  return normalized;
}

export function leagueFieldPresentation(
  leagueOptions: readonly string[],
  selection: LeagueSelection,
): LeagueFieldPresentation {
  const hasLeagueMenu = leagueOptions.length > 1;
  const selectedValid = leagueOptions.includes(selection.selectedLeague)
    && (!hasLeagueMenu || selection.explicit);
  return {
    visible: leagueOptions.length > 0,
    interactive: hasLeagueMenu,
    disabled: !hasLeagueMenu,
    required: hasLeagueMenu,
    selectionRequired: hasLeagueMenu && !selectedValid,
    selectedValid,
  };
}

/** Reconcile refreshed options without promoting an automatic sole option to an explicit choice. */
export function reconcileLeagueSelection(
  leagueOptions: readonly string[],
  current: LeagueSelection,
): LeagueSelection {
  if (leagueOptions.length === 1) {
    return { selectedLeague: leagueOptions[0] ?? '', explicit: false };
  }
  if (
    leagueOptions.length > 1
    && current.explicit
    && leagueOptions.includes(current.selectedLeague)
  ) {
    return current;
  }
  return { selectedLeague: '', explicit: false };
}

export function explicitLeagueSelection(
  leagueOptions: readonly string[],
  selectedLeague: string,
): LeagueSelection {
  return reconcileLeagueSelection(leagueOptions, { selectedLeague, explicit: true });
}

export function explicitLeagueSpecialRule(
  leagueOptions: readonly string[],
  selection: LeagueSelection,
): string | undefined {
  if (leagueOptions.length <= 1 || !selection.explicit) return undefined;
  return leagueOptions.includes(selection.selectedLeague) ? selection.selectedLeague : undefined;
}

const normalizedRule = (value: string): string => value.trim().toLocaleLowerCase();

/**
 * Resolve one roster-intrinsic star against the team's selectable league affiliation.
 *
 * A star can be available through the chosen affiliation, through an always-on roster
 * rule (for example Chaos Clash), or universally. Morg's upstream eligibility is the
 * inverse form: `(Negate Availability), Sylvanian Spotlight`.
 */
export function starEligibleForLeagueSelection(
  playsFor: readonly string[] | undefined,
  leagueOptions: readonly string[],
  selectedLeague: string,
): boolean {
  if (leagueOptions.length === 0) return true;
  if (!leagueOptions.includes(selectedLeague)) return false;

  const rules = (playsFor ?? []).map(normalizedRule).filter(Boolean);
  if (rules.length === 0 || rules.includes('(any)')) return true;

  const selected = normalizedRule(selectedLeague);
  if (rules.includes('(negate availability)')) {
    return !rules.some((rule) => rule !== '(negate availability)' && rule === selected);
  }
  if (rules.includes(selected)) return true;

  // An affiliation which is not one of the pick-one league options is an intrinsic,
  // always-on roster rule. Khorne/Nurgle Chaos Clash stars use this path.
  const selectableRules = new Set(leagueOptions.map(normalizedRule));
  return !rules.some((rule) => selectableRules.has(rule));
}
