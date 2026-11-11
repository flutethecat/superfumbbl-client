/**
 * ONE shared all-skills / effective-stats decoder — the single place the client answers "what skills does this
 * player have RIGHT NOW" and "what is its effective MA/AV".
 *
 * Upstream a player's skills are the union of `getSkills()` (the roster/learned set, our wire `skillArray`) and
 * `getTemporarySkills()` (`temporarySkillsMap`, keyed by ENHANCEMENT SOURCE — a prayer name, a card name,
 * "Granted by Wisdom of the White Dwarf", ...): Player.java:321-330 `getSkillsIncludingTemporaryOnes()`. Every
 * upstream rules check — `has`, `hasSkillProperty`, `canDeclareSkillAction`, `getSkillIntValue` — runs over that
 * UNION, so a client check that reads `skillArray` alone silently drops every prayer/card/Wisdom grant
 * (docs/prayers-to-nuffle-current-client-audit-2026-08-17.md §58-71: Stab from Stiletto must change the offered
 * actions, not just the player card).
 *
 * Wire encoding (ffb-common/.../json/JsonSkillWithValuesMapOption.java:38-48,60-73): each temporarySkillsMap
 * entry is `SkillName` or `SkillName_value`, split on the FIRST `_` (Java `split("_")` takes parts[0]/parts[1]).
 *
 * Stats: Player.java:245-262 `getStatWithModifiers` sums `temporaryModifiersMap`'s +1/-1 modifiers onto the BASE
 * roster stat and clamps with the ruleset's PlayerStatLimit — but ONLY when at least one modifier targets that
 * stat, and treating a 0 bound as "no bound". The base roster stat is never mutated.
 */
import {
  BB2025_SKILL_DEFAULT_VALUES,
  BB2025_STAT_LIMITS,
  type PrayerSkillGrant,
} from './prayerEnhancements.generated';
import type { PlayerJson } from './types';

export interface DecodedSkill {
  /** Skill.getName() verbatim, e.g. `Mighty Blow`. */
  readonly name: string;
  /** The SkillWithValue value when the grant carried one (`Loner_2` -> `2`), else null. */
  readonly value: string | null;
  /** Enhancement source key, or null for a base (`skillArray`) skill. */
  readonly source: string | null;
}

export interface PlayerSkillDisplayEntry {
  /** Canonical skill key used for icons/rules lookup. */
  readonly name: string;
  /** Player-detail label, including an authoritative valued Hatred keyword. */
  readonly label: string;
}

/** Upstream compares skills by identity; the wire gives us names, so every client comparison normalizes the
 *  same way the pre-existing rules checks did (lower-case, letters only) — `Mighty Blow` == `mightyblow`. */
export function normalizeSkillName(skill: string): string {
  return String(skill).toLowerCase().replace(/[^a-z]/g, '');
}

/** Decode ONE `temporarySkillsMap` entry. Mirrors JsonSkillWithValuesMapOption.getFrom:38-48. */
export function decodeSkillWithValue(entry: string): { name: string; value: string | null } {
  const text = String(entry);
  const separator = text.indexOf('_');
  if (separator < 0) return { name: text, value: null };
  return { name: text.slice(0, separator), value: text.slice(separator + 1) };
}

/** Encode a SkillWithValue back to the wire form — JsonSkillWithValuesMapOption.addTo:60-73. */
export function encodeSkillWithValue(grant: PrayerSkillGrant | { name: string; value: string | null }): string {
  return grant.value === null || grant.value === undefined ? grant.name : `${grant.name}_${grant.value}`;
}

type PlayerLike = Partial<Pick<PlayerJson, 'skillArray' | 'temporarySkillsMap' | 'temporaryModifiersMap'
  | 'movement' | 'armour' | 'strength' | 'agility' | 'passing' | 'skillValues' | 'skillDisplayValues'
  | 'skillValuesMap' | 'skillDisplayValuesMap'>> | null | undefined;

/** The roster position's skills with their parallel values (RosterPosition skillArray / skillValues /
 *  skillDisplayValues). */
export interface PositionSkillValues {
  readonly skillArray?: readonly string[] | null;
  readonly skillValues?: readonly (string | null)[] | null;
  readonly skillDisplayValues?: readonly (string | null)[] | null;
}

const pickValue = (v: unknown): string | null => (v == null || String(v).trim() === '' ? null : String(v));

/** Owner 11-11 (RickWreckless g1962735, "Loner not listed as x+"): the position's value for a skill it lists (display
 *  value first), else null. A model sync leaves an innate skill's value ONLY here (an Ogre's Loner "3"). */
export function positionSkillValue(position: PositionSkillValues | null | undefined, name: string): string | null {
  const index = position?.skillArray?.indexOf(name) ?? -1;
  if (index < 0) return null;
  return pickValue(position?.skillDisplayValues?.[index]) ?? pickValue(position?.skillValues?.[index]);
}

/** Owner 09-09: a BASE skill's value — the parallel `skillValues` array (team serialization) or the
 *  `skillValuesMap` (model sync); the display variants win when the server filled them. Owner 11-11: else the roster
 *  position's (RosterPlayer.getSkillValue / getDisplayValue, RosterPlayer.java:211-217: own value, else the
 *  position's). Null when unvalued. */
function baseSkillValue(player: PlayerLike, name: string, index: number, position?: PositionSkillValues | null): string | null {
  return pickValue(player?.skillDisplayValuesMap?.[name]) ?? pickValue(player?.skillDisplayValues?.[index])
    ?? pickValue(player?.skillValuesMap?.[name]) ?? pickValue(player?.skillValues?.[index])
    ?? positionSkillValue(position, name);
}

function temporaryEntries(player: PlayerLike): [string, string][] {
  const out: [string, string][] = [];
  for (const [source, value] of Object.entries(player?.temporarySkillsMap ?? {})) {
    if (Array.isArray(value)) for (const entry of value) out.push([source, String(entry)]);
  }
  return out;
}

/**
 * Every skill the player has, base + temporary, with duplicates preserved per source — the decoded form of
 * Player.getSkillsIncludingTemporaryOnesWithDuplicates (Player.java:321-326). `position` (owner 11-11): the player's
 * roster position, which supplies a base skill's value when the player has none (never pass it for a zapped player).
 */
export function decodePlayerSkills(player: PlayerLike, position?: PositionSkillValues | null): DecodedSkill[] {
  const out: DecodedSkill[] = [];
  for (const [source, entry] of temporaryEntries(player)) {
    const { name, value } = decodeSkillWithValue(entry);
    out.push({ name, value, source });
  }
  (player?.skillArray ?? []).forEach((skill, index) => {
    out.push({ name: String(skill), value: baseSkillValue(player, String(skill), index, position), source: null });
  });
  return out;
}

/** De-duplicated skill NAMES (base + temporary) — the list display surfaces and rules checks iterate. */
export function playerSkillNames(player: PlayerLike): string[] {
  return [...new Set(decodePlayerSkills(player).map((skill) => skill.name))];
}

/**
 * A characteristic improvement: one of the five upstream `SkillCategory.STAT_INCREASE` skills, whose names are fixed
 * in ffb-common (MovementIncrease "+MA", StrengthIncrease "+ST", AgilityIncrease "+AG", PassingIncrease "+PA",
 * ArmourIncrease "+AV"). The wire carries a skill as its NAME only (no category), so the name is the category here.
 * They are the one kind of skill a player can hold SEVERAL of: RosterPlayer.addSkill (RosterPlayer.java:194-198)
 * skips its "already has it" check for STAT_INCREASE, so a player who took +MA twice has "+MA" twice in `skillArray`.
 */
const STAT_INCREASE_SKILLS: ReadonlySet<string> = new Set(['+MA', '+ST', '+AG', '+PA', '+AV']);
export function isStatIncreaseSkill(skill: string): boolean {
  return STAT_INCREASE_SKILLS.has(String(skill).trim().toUpperCase());
}

/**
 * Upstream StatsMechanic, the two answers the display needs. BB2016 (mechanics/bb2016/StatsMechanic.java:13-15,33-35):
 * a HIGHER agility is the better one and there is no passing characteristic. BB2020 and BB2025 share
 * mechanics/mixed/StatsMechanic.java:14-16,34-36: AG / PA are target numbers (lower is better) and PA is drawn.
 * statSuffix (:18-20 / mixed :19-21) is how the Java client writes AG / PA / AV: "3+" from BB2020 on, "3" in BB2016.
 * The ruleset is the game's own `rulesVersion` option; a game without one reads as the current rules.
 */
export interface StatsMechanic {
  readonly improvementIncreasesValue: boolean;
  readonly drawPassing: boolean;
  /** statSuffix(): what follows a roll-target stat (AG / PA / AV) - "+" from BB2020 on, nothing in BB2016. */
  readonly statSuffix: '+' | '';
}
export function statsMechanicFor(
  game: { gameOptions?: { gameOptionArray?: readonly { gameOptionId?: unknown; gameOptionValue?: unknown }[] } | null } | null | undefined,
): StatsMechanic {
  const version = game?.gameOptions?.gameOptionArray?.find((option) => option.gameOptionId === 'rulesVersion')?.gameOptionValue;
  const legacy = /^BB2016$/i.test(String(version ?? '').trim());
  return { improvementIncreasesValue: legacy, drawPassing: !legacy, statSuffix: legacy ? '' : '+' };
}

/**
 * The skill names a DISPLAY surface lists: `playerSkillNames` (one per name, same order), except that a
 * characteristic improvement appears once per time the server lists it ("+MA", "+MA" for two improvements), the
 * copies side by side at the first one's place. Rules checks keep `playerSkillNames` / `playerHasSkill`.
 */
export function playerSkillDisplayNames(player: PlayerLike): string[] {
  const decoded = decodePlayerSkills(player);
  return playerSkillNames(player).flatMap((name) => (isStatIncreaseSkill(name)
    ? decoded.filter((skill) => skill.name === name).map(() => name)
    : [name]));
}

function compareKeyword(a: string, b: string): number {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA < lowerB) return -1;
  if (lowerA > lowerB) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Detail-card projection over the canonical decoder. Ordinary skills retain
 * the existing de-duplicated name list; a characteristic improvement taken N
 * times is N entries (playerSkillDisplayNames). Hatred is value-bearing: each distinct
 * authoritative keyword is shown as `Hatred (Keyword)`, sorted independently
 * of temporarySkillsMap insertion order; a missing/blank value fails soft to
 * the bare `Hatred` label.
 */
export function playerSkillDisplayEntries(player: PlayerLike, position?: PositionSkillValues | null): PlayerSkillDisplayEntry[] {
  const decoded = decodePlayerSkills(player, position);
  const out: PlayerSkillDisplayEntry[] = [];
  for (const name of playerSkillDisplayNames(player)) {
    if (normalizeSkillName(name) !== 'hatred') {
      out.push({ name, label: name });
      continue;
    }
    // Owner 09-09: the wire keyword is lower-case ("undead", "orc"); the card reads "Hatred (Orc)".
    const keywords = decoded
      .filter((skill) => normalizeSkillName(skill.name) === 'hatred')
      // owner 11-11 (Sol): a value may list several keywords ("troll;orc", HatredKeyword ';'-joined) - one chip each;
      // every word capitalised ("big guy" -> "Big Guy")
      .flatMap((skill) => (skill.value ?? '').split(';'))
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .map((keyword) => keyword.replace(/(^|\s)(\S)/g, (_m, space: string, first: string) => space + first.toUpperCase()))
      .sort(compareKeyword);
    const seen = new Set<string>();
    for (const keyword of keywords) {
      const key = keyword.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, label: `Hatred (${keyword})` });
    }
    if (seen.size === 0) out.push({ name, label: name });
  }
  return out;
}

/** Player.has / getSkillsIncludingTemporaryOnes.contains (Player.java:328-330,451-453), name-normalized. */
export function playerHasSkill(player: PlayerLike, skill: string): boolean {
  const wanted = normalizeSkillName(skill);
  return decodePlayerSkills(player).some((entry) => normalizeSkillName(entry.name) === wanted);
}

/** True when the player has ANY of the named skills. */
export function playerHasAnySkill(player: PlayerLike, skills: readonly string[]): boolean {
  const wanted = new Set(skills.map(normalizeSkillName));
  return decodePlayerSkills(player).some((entry) => wanted.has(normalizeSkillName(entry.name)));
}

/**
 * Player.getSkillIntValue (Player.java:126-131): the temporary values for the skill, else the skill's Java
 * default. Upstream runs a per-skill SkillValueEvaluator over the value SET; the two evaluators that matter here
 * are DEFAULT (highest wins — Mighty Blow) and ROLL (lowest/best roll wins — Loner 2+ beats Loner 4+), so we
 * take the max for ordinary skills and the min for the roll-valued ones. Returns null for an absent skill.
 */
const ROLL_VALUED_SKILLS = new Set(['loner'].map(normalizeSkillName)); // skill/mixed/Loner.java:38-40 evaluator() == ROLL

export function playerSkillValue(player: PlayerLike, skill: string): number | null {
  const wanted = normalizeSkillName(skill);
  const matches = decodePlayerSkills(player).filter((entry) => normalizeSkillName(entry.name) === wanted);
  if (matches.length === 0) return null;
  const values = matches.map((entry) => entry.value).filter((v): v is string => v !== null)
    .map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (values.length === 0) return BB2025_SKILL_DEFAULT_VALUES[matches[0]!.name] ?? 0;
  return ROLL_VALUED_SKILLS.has(wanted) ? Math.min(...values) : Math.max(...values);
}

// ---- effective stats --------------------------------------------------------------------------------------

/** TemporaryStatModifier.getName() is `${PlayerStatKey}-${canonical class}` (TemporaryStatModifier.java:9,20-23);
 *  the class tail decides the sign (TemporaryStatIncrementer/Decrementer .apply). */
function modifierDelta(name: string): { stat: string; delta: number } | null {
  const separator = String(name).indexOf('-');
  if (separator < 0) return null;
  const stat = String(name).slice(0, separator);
  const cls = String(name).slice(separator + 1);
  if (cls.endsWith('TemporaryStatIncrementer')) return { stat, delta: 1 };
  if (cls.endsWith('TemporaryStatDecrementer')) return { stat, delta: -1 };
  return null;
}

export type PlayerStatKey = 'MA' | 'ST' | 'AG' | 'PA' | 'AV';

const BASE_STAT_FIELD: Record<PlayerStatKey, 'movement' | 'strength' | 'agility' | 'passing' | 'armour'> = {
  MA: 'movement', ST: 'strength', AG: 'agility', PA: 'passing', AV: 'armour',
};

/**
 * Player.getStatWithModifiers (Player.java:245-262) — base roster stat + every temporary modifier for that
 * stat, clamped by the ruleset limit ONLY when a modifier applies. Never mutates the base stat.
 */
export function effectiveStat(player: PlayerLike, stat: PlayerStatKey): number {
  const base = Number(player?.[BASE_STAT_FIELD[stat]] ?? 0);
  let sum = base;
  let modified = false;
  for (const value of Object.values(player?.temporaryModifiersMap ?? {})) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      const parsed = modifierDelta(String(entry));
      if (!parsed || parsed.stat !== stat) continue;
      sum += parsed.delta;
      modified = true;
    }
  }
  if (!modified) return base;
  const limit = BB2025_STAT_LIMITS[stat];
  if (!limit) return sum;
  if (limit.max !== 0) sum = Math.min(limit.max, sum);
  if (limit.min !== 0) sum = Math.max(base === 0 ? 0 : limit.min, sum);
  return sum;
}

/** Effective MA — Greasy Cleats' temporary decrement lands here (Player.java:229-231). */
export function effectiveMovement(player: PlayerLike): number {
  return effectiveStat(player, 'MA');
}

/** Effective AV — Iron Man's temporary increment lands here (Player.java:241-243). */
export function effectiveArmour(player: PlayerLike): number {
  return effectiveStat(player, 'AV');
}
