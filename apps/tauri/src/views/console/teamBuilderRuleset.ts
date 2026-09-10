/**
 * Tournament Slot Builder — derived ruleset panels (owner 08-18).
 *
 * The ruleset note used to render the package's whole prose description (the Spike! 2026
 * paragraph wall). It now renders DATA served by config-web's GET /api/packages/<name>
 * `rules` block: a compact tier summary of the tournament by default, and — once a
 * roster/race is selected and the server resolved it — THAT race's specific rules (its
 * tier, choose-one packs, star SP pricing, bans). Everything here derives from the
 * package config; the only prose kept is the pack's own small `dataNote` caveat.
 *
 * Pure module (no Vue) so the panel choice + formatting are unit-testable.
 */

export interface PackSummary {
  label: string;
  gold: number;
  skillPointBudget: number;
  maxPerPlayer: number | null;
}

export interface TierSummaryRow {
  tier: number;
  label: string;
  rosters: string[];
  gold: number | null;
  skillPointBudget: number | null;
  packs: PackSummary[];
}

export interface StarSpCost {
  name: string;
  sp: number;
}

/** Owner 09-09: the pack's SP prices (config-web packageRaceRules.skillCosts) — the live tracker prices skills
 *  exactly as the validator does: primary/secondary base, +elite surcharge, +stack surcharge for every added
 *  skill beyond a player's FIRST (NAF World Cup: 6/10, +2 elite, +2 stacking → 2nd primary = 8, 2nd secondary = 12). */
export interface SkillCosts {
  primary: number;
  secondary: number;
  eliteSurcharge: number;
  stackSurcharge: number;
  eliteSkills: string[];
}

/** The owner's default SP model, used when an older server sends no skillCosts. */
export const DEFAULT_SKILL_COSTS: SkillCosts = { primary: 1, secondary: 2, eliteSurcharge: 0.5, stackSurcharge: 0, eliteSkills: ['Block', 'Guard', 'Mighty Blow', 'Dodge'] };

/** SP a player's added skills cost under `costs`; `secondaryOf(name)` = whether the pick is a secondary access. */
export function playerSkillSp(names: readonly string[], secondaryOf: (name: string) => boolean, costs: SkillCosts): number {
  const elite = new Set(costs.eliteSkills.map((s) => s.toLowerCase().replace(/[^a-z]/g, '')));
  const base = names.reduce((sum, name) => sum
    + (secondaryOf(name) ? costs.secondary : costs.primary)
    + (elite.has(name.toLowerCase().replace(/[^a-z]/g, '')) ? costs.eliteSurcharge : 0), 0);
  return base + Math.max(0, names.length - 1) * costs.stackSurcharge;
}

export interface RaceRulesInfo {
  roster: string;
  source: string;
  tierNumber?: number;
  tierLabel?: string;
  gold: number | null;
  skillPointBudget: number;
  /** Owner 09-09: absent on an older server → DEFAULT_SKILL_COSTS. */
  skillCosts?: SkillCosts;
  maxPerPlayer: number | null;
  packs: PackSummary[];
  stars: {
    allowed: boolean;
    maxCount: number | null;
    paidInSkillPoints: boolean;
    spCosts?: StarSpCost[];
  };
  bannedStars: string[];
}

/** The `rules` block of GET /api/packages/<name> (config-web teamBuilderPackage.ts
 *  packageRulesInfo). `budget`/`race` present only when the request carried ?roster=. */
export interface PackageRules {
  name: string;
  dataNote?: string;
  budget?: number | null;
  tierSummary: TierSummaryRow[];
  race?: RaceRulesInfo;
}

/** Parse a response's `rules` field. Null for an old server that doesn't send one —
 *  the view falls back to the prose description note in that case. */
export function packageRulesFrom(value: unknown): PackageRules | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string' || !Array.isArray(v.tierSummary)) return null;
  return v as unknown as PackageRules;
}

export type RulesetPanel =
  | { kind: 'none' }
  | { kind: 'summary'; name: string; dataNote?: string; tiers: TierSummaryRow[] }
  | { kind: 'race'; name: string; dataNote?: string; race: RaceRulesInfo };

/** Which panel the note area shows: default = the tournament's tier summary; a selected
 *  race (that the server resolved) = that race's rules. 'none' = nothing derived is
 *  available (no rules block / non-tiered pack with no race yet) — caller falls back. */
export function rulesetPanel(rules: PackageRules | null, raceSelected: boolean): RulesetPanel {
  if (!rules) return { kind: 'none' };
  if (raceSelected && rules.race) {
    return { kind: 'race', name: rules.name, dataNote: rules.dataNote, race: rules.race };
  }
  if (rules.tierSummary.length) {
    return { kind: 'summary', name: rules.name, dataNote: rules.dataNote, tiers: rules.tierSummary };
  }
  return { kind: 'none' };
}

/** 1_100_000 → "1100k"; null/undefined → em-dash. */
export const goldK = (gold: number | null | undefined): string =>
  gold == null ? '—' : `${Math.round(gold / 1000)}k`;

/** Compact pack chip for tier-summary rows: "1100k/6SP". */
export const packShort = (p: PackSummary): string => `${goldK(p.gold)}/${p.skillPointBudget}SP`;

/** Detail half of packLine (no label) — the pack button's second line. */
export const packDetail = (p: PackSummary): string =>
  `${goldK(p.gold)} / ${p.skillPointBudget} SP` +
  (p.maxPerPlayer != null ? ` · ${p.maxPerPlayer} skill${p.maxPerPlayer === 1 ? '' : 's'}/player` : '');

/** Full pack line for the race panel: "Pack 2: 1070k / 7 SP · 1 skill/player". */
export const packLine = (p: PackSummary): string => `${p.label}: ${packDetail(p)}`;
