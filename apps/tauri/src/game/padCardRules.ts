/**
 * Controller support P2b (owner rounds 2-3): per-card pad rules that are data, not layout.
 *  - Reroll card: a focused LIST of the server's options, Team Reroll first (and focused); Y = the single skill
 *    reroll when exactly one is offered.
 *  - Raise the Dead: A = Zombie, X = Skeleton (by the server's position label).
 */
export interface PadRerollOption { source: string }

/** The team-pool sources (everything else on the card is a skill / modifier option). */
/** Owner 11-21: a direct drive bonus reroll is presented as the Team reroll, so the pad treats it as one too. */
export const TEAM_REROLL_SOURCES: ReadonlySet<string> = new Set(['Team ReRoll', 'Drive Bonus ReRoll', 'Mascot TRR', 'Team Mascot']);

/** Team Reroll first, every other option in the server's order. */
export function padRerollOrder<T extends PadRerollOption>(options: readonly T[]): T[] {
  const first = (o: PadRerollOption) => o.source === 'Team ReRoll' || o.source === 'Drive Bonus ReRoll';
  return [...options.filter(first), ...options.filter((o) => !first(o))];
}

/** The source Y takes: the only skill reroll offered, else null. */
export function padRerollYSource(options: readonly PadRerollOption[]): string | null {
  const skills = options.filter((o) => !TEAM_REROLL_SOURCES.has(o.source));
  return skills.length === 1 ? skills[0]!.source : null;
}

/** Raise the Dead position pick: which pad button a position answers to. */
export function raiseDeadPadKey(label: string): 'A' | 'X' | null {
  if (/zombie/i.test(label)) return 'A';
  if (/skeleton/i.test(label)) return 'X';
  return null;
}
