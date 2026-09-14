/**
 * Owner 09-14: the end-screen MVP view tells the coach when a player has banked enough SPP for their next advancement.
 * BB2020/BB2025 improvement table — SPP required for advancement N (1-based) by method:
 *   random primary · chosen primary or random secondary · chosen secondary · characteristic.
 * The message names the BEST method the SPP can buy, in the owner's wording.
 */
export const ADVANCEMENT_COSTS: readonly { randomPrimary: number; chosenPrimaryOrRandomSecondary: number; chosenSecondary: number; characteristic: number }[] = [
  { randomPrimary: 6, chosenPrimaryOrRandomSecondary: 12, chosenSecondary: 18, characteristic: 18 },
  { randomPrimary: 8, chosenPrimaryOrRandomSecondary: 14, chosenSecondary: 20, characteristic: 20 },
  { randomPrimary: 12, chosenPrimaryOrRandomSecondary: 18, chosenSecondary: 24, characteristic: 24 },
  { randomPrimary: 16, chosenPrimaryOrRandomSecondary: 22, chosenSecondary: 28, characteristic: 28 },
  { randomPrimary: 20, chosenPrimaryOrRandomSecondary: 26, chosenSecondary: 32, characteristic: 32 },
  { randomPrimary: 24, chosenPrimaryOrRandomSecondary: 30, chosenSecondary: 36, characteristic: 36 },
];

/** Learned skills that are NOT advancements (upstream NamedProperties.doesNotCountAsAdvancement, bb2025). */
const NOT_AN_ADVANCEMENT = new Set(['Hatred', 'Team Captain']);
/** Skills that grant Pro alongside themselves (NamedProperties.canSaveReRolls): that Pro must not count either. */
const GRANTS_PRO = new Set(['Team Captain']);

/**
 * Advancements already taken from the LEARNED skill list, mirroring bb2025 SkillMechanic.countAdvancements: stat
 * decreases and doesNotCountAsAdvancement skills are skipped, and a Team Captain's granted Pro is offset.
 */
export function advancementsTaken(learnedSkills: readonly string[]): number {
  // A Set, like upstream's Collectors.toSet(): two "+MA" advancements collapse to one there too (parity, not a fix).
  const gained = new Set(learnedSkills.filter((name) => !name.startsWith('-')));
  const offset = [...gained].some((name) => GRANTS_PRO.has(name)) ? 1 : 0;
  return Math.max(0, [...gained].filter((name) => !NOT_AN_ADVANCEMENT.has(name)).length - offset);
}

export type AdvancementReadiness = { level: 'primary' | 'primaryOrSecondary' | 'characteristic'; text: string } | null;

/** `advancementsTaken` = skills beyond the position's base plus characteristic improvements (temporary grants excluded). */
export function advancementReadiness(sppTotal: number, advancementsTaken: number): AdvancementReadiness {
  if (!Number.isFinite(sppTotal) || sppTotal <= 0) return null;
  const row = ADVANCEMENT_COSTS[Math.min(Math.max(0, Math.floor(advancementsTaken)), ADVANCEMENT_COSTS.length - 1)]!;
  if (advancementsTaken >= ADVANCEMENT_COSTS.length) return null; // the table ends at the sixth advancement
  if (sppTotal >= row.characteristic) return { level: 'characteristic', text: 'Advancement ready! Upgrade a characteristic!' };
  if (sppTotal >= row.chosenPrimaryOrRandomSecondary) return { level: 'primaryOrSecondary', text: 'Advancement ready! Take a primary or secondary!' };
  if (sppTotal >= row.randomPrimary) return { level: 'primary', text: 'Advancement ready! Take a primary!' };
  return null;
}
