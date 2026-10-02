/**
 * Owner 10-02: the roster's player VALUE ("170k") and LEVEL ("LVL n"), PURE over the game JSON's player + roster
 * position. Mirrors the team builder server (bb-tournament-validator apps/config-web/src/teamAdvancement.ts,
 * `playerProgression` / `advancementCount` / `statImprovements` / CHARACTERISTIC_VALUE) so the two never disagree:
 *   value = position cost
 *         + per ADDED skill (player skills minus the position's, non-trait): 40k when its category is one of the
 *           position's SECONDARY (skillCategoriesDouble) categories, else 20k; +10k when the skill is Elite
 *         + per characteristic improvement: AV 10k, MA 20k, PA 20k, AG 30k, ST 60k
 *   advancements = added non-trait skills + characteristic improvements.
 * A characteristic improvement = the player's stat beyond the position's base (MA/ST/AV higher is better, AG/PA
 * LOWER is better), or the number of "+MA"-style tokens on the skill list, whichever is larger (an injury can hide
 * the stat gain; the token still records it). Temporary in-game grants live in temporarySkillsMap, never skillArray,
 * so they never count. Star players and mercenaries are worth their position cost and have no advancements.
 */
import { skillAdvanceCategory } from './skillCategory';

export type Characteristic = 'MA' | 'ST' | 'AG' | 'PA' | 'AV';

/** config-web CHARACTERISTIC_VALUE. */
export const CHARACTERISTIC_VALUE: Readonly<Record<Characteristic, number>> = { AV: 10_000, MA: 20_000, PA: 20_000, AG: 30_000, ST: 60_000 };
export const PRIMARY_SKILL_VALUE = 20_000;
export const SECONDARY_SKILL_VALUE = 40_000;
export const ELITE_SKILL_SURCHARGE = 10_000;
/** Rulebook-Elite skills: the `elite: true` entries of the validator dataset (packages/bb-validator/src/dataset/bb2025/skills.json). */
export const ELITE_SKILLS: ReadonlySet<string> = new Set(['block', 'dodge', 'guard', 'mightyblow']);

export interface ValuePosition {
  cost?: number;
  movement?: number;
  strength?: number;
  agility?: number;
  passing?: number;
  armour?: number;
  skillArray?: string[];
  skillCategoriesNormal?: string[];
  skillCategoriesDouble?: string[];
  playerType?: string;
}
export interface ValuePlayer {
  movement?: number;
  strength?: number;
  agility?: number;
  passing?: number;
  armour?: number;
  skillArray?: string[];
  playerType?: string;
}
export interface PlayerProgress {
  /** Current value in gold; null when the roster does not list the player's position. */
  value: number | null;
  advancements: number;
}

const STAT_FIELD: Readonly<Record<Characteristic, keyof ValuePlayer & keyof ValuePosition>> = {
  MA: 'movement', ST: 'strength', AG: 'agility', PA: 'passing', AV: 'armour',
};
const STAT_TOKEN = /^\+(MA|ST|AG|PA|AV)$/i;

function key(skill: string): string {
  return skill.replace(/\s*\(.*\)\s*$/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function isStarOrMercenary(player: ValuePlayer, position: ValuePosition | undefined): boolean {
  return /star|mercenary/i.test(String(player.playerType ?? '')) || /star|mercenary/i.test(String(position?.playerType ?? ''));
}

/** Star players never buy skills - anything beyond the position list is an in-game grant, so a star is worth its cost. */
export function isStar(player: ValuePlayer, position: ValuePosition | undefined): boolean {
  return /star/i.test(String(player.playerType ?? '')) || /star/i.test(String(position?.playerType ?? ''));
}

/** Skills on the player beyond the position's base list (one base entry absorbs one player entry). */
export function addedSkills(player: ValuePlayer, position: ValuePosition | undefined): string[] {
  const base = new Map<string, number>();
  for (const s of position?.skillArray ?? []) base.set(key(s), (base.get(key(s)) ?? 0) + 1);
  const out: string[] = [];
  for (const s of player.skillArray ?? []) {
    const k = key(s);
    const left = base.get(k) ?? 0;
    if (left > 0) base.set(k, left - 1);
    else out.push(s);
  }
  return out;
}

export function statImprovements(player: ValuePlayer, position: ValuePosition | undefined): Record<Characteristic, number> {
  const out: Record<Characteristic, number> = { MA: 0, ST: 0, AG: 0, PA: 0, AV: 0 };
  if (!position) return out;
  const tokens = (player.skillArray ?? []).map((s) => s.trim().match(STAT_TOKEN)?.[1]?.toUpperCase()).filter(Boolean) as Characteristic[];
  for (const stat of Object.keys(out) as Characteristic[]) {
    const field = STAT_FIELD[stat];
    const base = position[field];
    const current = finite(player[field]) ? player[field] : base;
    let diff = 0;
    // A base PA of 0 = no PA ("-"): only the token can say it improved.
    if (finite(base) && finite(current) && !(stat === 'PA' && (base === 0 || current === 0))) {
      diff = stat === 'AG' || stat === 'PA' ? Math.max(0, base - current) : Math.max(0, current - base);
    }
    out[stat] = Math.max(diff, tokens.filter((t) => t === stat).length);
  }
  return out;
}

/** Learned skills that are NOT advancements (upstream NamedProperties.doesNotCountAsAdvancement, bb2025) - the same
 *  rule as postGameAdvancement.advancementsTaken; Team Captain also grants Pro, and that Pro is free (Astra review). */
const NOT_AN_ADVANCEMENT = new Set(['hatred', 'teamcaptain']); // key() form
const GRANTS_PRO = new Set(['teamcaptain']);

/** Added skills that are advancements: categorised (non-trait) skills, never the "+MA" tokens, never Hatred / Team
 *  Captain, and one Pro dropped when Team Captain granted it. */
function advancedSkills(player: ValuePlayer, position: ValuePosition | undefined): string[] {
  const added = addedSkills(player, position);
  const baseName = (s: string) => key(s).replace(/\s*\(.*\)\s*$/, '');
  let freePro = added.some((s) => GRANTS_PRO.has(baseName(s))) ? 1 : 0;
  return added.filter((s) => {
    if (STAT_TOKEN.test(s.trim()) || NOT_AN_ADVANCEMENT.has(baseName(s))) return false;
    if (freePro > 0 && baseName(s) === 'pro') { freePro -= 1; return false; }
    return skillAdvanceCategory(s) !== null;
  });
}

export function advancementCount(player: ValuePlayer, position: ValuePosition | undefined): number {
  if (isStarOrMercenary(player, position)) return 0;
  const stats = statImprovements(player, position);
  return advancedSkills(player, position).length + Object.values(stats).reduce((a, n) => a + n, 0);
}

export function playerProgress(player: ValuePlayer, position: ValuePosition | undefined): PlayerProgress {
  if (!position) return { value: null, advancements: 0 };
  const cost = finite(position.cost) ? position.cost : 0;
  if (isStar(player, position)) return { value: cost, advancements: 0 };
  const secondary = new Set((position.skillCategoriesDouble ?? []).map((c) => c.toLowerCase()));
  const skillValue = advancedSkills(player, position).reduce((sum, s) => {
    const category = skillAdvanceCategory(s)!;
    return sum + (secondary.has(category) ? SECONDARY_SKILL_VALUE : PRIMARY_SKILL_VALUE) + (ELITE_SKILLS.has(key(s)) ? ELITE_SKILL_SURCHARGE : 0);
  }, 0);
  const stats = statImprovements(player, position);
  const statValue = (Object.keys(stats) as Characteristic[]).reduce((sum, s) => sum + CHARACTERISTIC_VALUE[s] * stats[s], 0);
  // Stars / mercenaries never level (advancementCount = 0) but keep the value of skills bought for them (config-web parity).
  return { value: cost + skillValue + statValue, advancements: advancementCount(player, position) };
}

/** "170k" / "112.5k"; empty for an unknown value. */
export function formatPlayerValue(value: number | null | undefined): string {
  if (!finite(value) || value <= 0) return '';
  return `${Math.round(value / 100) / 10}k`;
}
