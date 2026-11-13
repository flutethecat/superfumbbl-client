import type { GameJson, PlayerJson, StatsMechanic, TeamJson } from '@fumbbl40k/ffb-protocol';
import { statsMechanicFor } from '@fumbbl40k/ffb-protocol';

/**
 * FUMBBL automatic player markings (UI-6, owner 2026-07-02): a TS mirror of
 * the upstream server's MarkerGenerator + AutoMarkingConfig
 * (ffb-server/…/server/marking/). The config JSON is the exact payload the
 * coach edits on fumbbl.com (client options page) and the FFB server fetches
 * from `api/clientoptions/get/<coach>` — import uses the same endpoint.
 *
 * Spectator-prototype scope notes (server stays authority in play mode):
 * - "playsForMarkingCoach" maps to the home perspective until M4 ownership.
 * - Stat diffs derive from wire stats vs roster position stats (wire values
 *   are pre-injury-reduced per C14a, matching upstream *WithModifiers).
 * - BB2025 stat semantics: AG/PA lower-is-better, MA/ST/AV higher-is-better.
 */

export interface AutoMarkingRecord {
  skillArray: string[];
  injuryAttributes: string[];
  marking: string;
  gainedOnly: boolean;
  applyTo: 'OWN' | 'OPPONENT' | 'BOTH';
  applyRepeatedly: boolean;
}

export interface AutoMarkingConfig {
  autoMarkingRecords: AutoMarkingRecord[];
  separator?: string;
  sortMode?: 'NONE' | string;
}

interface PositionLike {
  positionId: string;
  skillArray?: string[];
  movement?: number;
  strength?: number;
  agility?: number;
  passing?: number;
  armour?: number;
}

const STAT_INCREASE: Record<string, string> = { MA: '+MA', ST: '+ST', AG: '+AG', PA: '+PA', AV: '+AV' };
const STAT_INCREASE_NAMES: ReadonlySet<string> = new Set(Object.values(STAT_INCREASE));
const STAT_DECREASE: Record<string, string> = { MA: '-MA', ST: '-ST', AG: '-AG', PA: '-PA', AV: '-AV' };

function positionFor(team: TeamJson, positionId: string): PositionLike | undefined {
  const roster = team.roster as { positionArray?: PositionLike[] };
  return roster.positionArray?.find((p) => p.positionId === positionId);
}

/** Mirrors MarkerGenerator.statDiff — positive = increase, negative = injury. */
function statDiffs(player: PlayerJson, position: PositionLike, mechanic: StatsMechanic): Map<string, number> {
  const diffs = new Map<string, number>();
  const value = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  diffs.set('MA', player.movement - value(position.movement, player.movement));
  diffs.set('ST', player.strength - value(position.strength, player.strength));
  // MarkerGenerator.java:138-148: AG/PA are target numbers from BB2020 on (improvement DECREASES the value); in BB2016
  // a higher AG is the improvement and there is no PA.
  const agility = value(position.agility, player.agility) - player.agility;
  diffs.set('AG', mechanic.improvementIncreasesValue ? -agility : agility);
  diffs.set('PA', mechanic.drawPassing ? value(position.passing, player.passing) - player.passing : 0);
  diffs.set('AV', player.armour - value(position.armour, player.armour));
  return diffs;
}

/** Mirrors MarkerGenerator.isSubSetWithDuplicates. */
function subsetMatches(subset: string[], superset: string[]): number {
  if (subset.length === 0) return Number.MAX_SAFE_INTEGER;
  const count = (list: string[]) => {
    const map = new Map<string, number>();
    for (const item of list) map.set(item, (map.get(item) ?? 0) + 1);
    return map;
  };
  const sub = count(subset);
  const sup = count(superset);
  let min = Number.MAX_SAFE_INTEGER;
  for (const [key, need] of sub) {
    const have = sup.get(key) ?? 0;
    min = Math.min(min, Math.floor(have / need));
  }
  return min;
}

function isSubsetOf(a: AutoMarkingRecord, b: AutoMarkingRecord): boolean {
  return (
    a.skillArray.every((s) => b.skillArray.includes(s)) &&
    a.injuryAttributes.every((i) => b.injuryAttributes.includes(i))
  );
}

/** Owner 2026-07-06 (bug): a real fumbbl.com markings export (or a hand-edited /
 *  partial config) can OMIT the non-essential fields — `injuryAttributes`,
 *  `gainedOnly`, `applyTo`, `applyRepeatedly` (and even `skillArray`/`marking`). The
 *  generator then hit `undefined.length` and THREW; the caller (`applyMarkings`)
 *  swallowed it in a try/catch, so ALL markings silently vanished. Fill the defaults
 *  so a minimal `{skillArray, marking}` record works exactly like the full form. */
function normalizeRecord(r: Partial<AutoMarkingRecord> | undefined): AutoMarkingRecord {
  return {
    skillArray: r?.skillArray ?? [],
    injuryAttributes: r?.injuryAttributes ?? [],
    marking: r?.marking ?? '',
    gainedOnly: !!r?.gainedOnly,
    applyTo: r?.applyTo ?? 'BOTH',
    applyRepeatedly: !!r?.applyRepeatedly,
  };
}

/** The player's marking subjects, as MarkerGenerator.generate derives them. */
interface MarkingSubjects {
  baseSkills: string[];
  gainedSkills: string[];
  injuryAttributes: string[];
}

function markingSubjects(game: GameJson, team: TeamJson, player: PlayerJson): MarkingSubjects {
  const position = positionFor(team, player.positionId);
  const baseSkills = [...(position?.skillArray ?? [])];
  // MarkerGenerator.java:30-31: the stat-increase skills are left out here; the stat diff below adds one per step.
  // Without this a "+MA" in skillArray was counted twice (once here, once from the diff).
  const gainedSkills = (player.skillArray ?? []).filter((s) => {
    const idx = baseSkills.indexOf(s);
    return idx === -1 && !STAT_INCREASE_NAMES.has(s);
  });
  const injuryAttributes: string[] = [];

  if (position) {
    for (const [key, diff] of statDiffs(player, position, statsMechanicFor(game))) {
      if (diff > 0) for (let i = 0; i < diff; i++) gainedSkills.push(STAT_INCREASE[key]!);
      else if (diff < 0) for (let i = 0; i < -diff; i++) injuryAttributes.push(STAT_DECREASE[key]!);
    }
  }
  // Niggling injuries only carry a name on the wire (C14a); stat losses are
  // already covered by the stat diff above
  for (const injury of player.lastingInjuries ?? []) {
    if (/niggl|\bNI\b/i.test(String(injury))) injuryAttributes.push('NI');
  }
  return { baseSkills, gainedSkills, injuryAttributes };
}

/** Normalised records that apply to this side (applyTo vs the marking coach). */
function applicableRecords(config: AutoMarkingConfig, playsForMarkingCoach: boolean): AutoMarkingRecord[] {
  // Normalize each record so a partial/older export (missing injuryAttributes /
  // gainedOnly / applyTo / applyRepeatedly) no longer throws and blank the markings.
  return (config.autoMarkingRecords ?? []).map(normalizeRecord).filter((record) => {
    const applyTo = record.applyTo;
    return playsForMarkingCoach ? applyTo !== 'OPPONENT' : applyTo !== 'OWN';
  });
}

/** Mirrors MarkerGenerator.generate's record selection and ordering: the records drawn, in drawing order (a record
 *  matched N times with applyRepeatedly appears N times). */
function selectRecords(applicable: AutoMarkingRecord[], subjects: MarkingSubjects, sortMode: AutoMarkingConfig['sortMode']): AutoMarkingRecord[] {
  const { baseSkills, gainedSkills, injuryAttributes } = subjects;
  // sorted mode (upstream default): most-specific records first
  const sorted =
    sortMode === 'NONE'
      ? applicable
      : [...applicable].sort(
          (r1, r2) =>
            Number(r1.skillArray.length === 0) - Number(r2.skillArray.length === 0) ||
            r2.skillArray.length - r1.skillArray.length ||
            r2.injuryAttributes.length - r1.injuryAttributes.length ||
            applyToRank(r1) - applyToRank(r2) ||
            Number(r1.gainedOnly) - Number(r2.gainedOnly) ||
            Number(r2.applyRepeatedly) - Number(r1.applyRepeatedly) ||
            r1.marking.localeCompare(r2.marking),
        );

  const toApply: AutoMarkingRecord[] = [];
  for (const record of sorted) {
    if (toApply.some((applied) => isSubsetOf(record, applied))) continue;
    const skillsToCheck = record.gainedOnly ? gainedSkills : [...gainedSkills, ...baseSkills];
    let matches = Math.min(
      subsetMatches(record.skillArray, skillsToCheck),
      subsetMatches(record.injuryAttributes, injuryAttributes),
    );
    if (matches === Number.MAX_SAFE_INTEGER) matches = 0;
    if (!record.applyRepeatedly) matches = Math.min(1, matches);
    if (matches > 0) {
      for (let i = toApply.length - 1; i >= 0; i--) if (isSubsetOf(toApply[i]!, record)) toApply.splice(i, 1);
      for (let i = 0; i < matches; i++) toApply.push(record);
    }
  }

  return sortMode === 'NONE'
    ? toApply
    : [...toApply].sort(
        (a, b) =>
          Number(a.skillArray.length === 0) - Number(b.skillArray.length === 0) ||
          a.marking.localeCompare(b.marking),
      );
}

/** Mirrors MarkerGenerator.generate for one player. */
export function generateMarking(
  game: GameJson,
  team: TeamJson,
  player: PlayerJson,
  config: AutoMarkingConfig,
  playsForMarkingCoach: boolean,
): string {
  const separator = config.separator ?? '';
  const parts = selectRecords(applicableRecords(config, playsForMarkingCoach), markingSubjects(game, team, player), config.sortMode);
  return parts.map((r) => r.marking).filter(Boolean).join(separator);
}

function applyToRank(record: AutoMarkingRecord): number {
  return record.applyTo === 'BOTH' ? 0 : record.applyTo === 'OWN' ? 1 : 2;
}

// ── Two-line form (owner 11-11, opt-in setting markingStatusLine) ────────────────────────────────────────────────────
// A text-markings user asked for stat increases, stat decreases and niggling injuries on a separate line ABOVE the
// skill marks so they cannot be mistaken for skills. The status line is built for every player on both teams; the
// coach's own stat/injury-only rules keep their text there (and leave the skill line), every change no rule speaks
// for gets a built-in default. generateMarking above is untouched: it mirrors upstream and stays the one-line form.

/** One piece of the status line. `increase` = a characteristic improvement; `decrease` = a reduction or a niggle. */
export interface StatusMarkPart {
  text: string;
  tone: 'increase' | 'decrease';
}

export interface MarkingLines {
  /** Stat increases, stat decreases and niggling injuries, drawn above the skill line. */
  status: StatusMarkPart[];
  /** The ordinary skill marking (generateMarking without the stat/injury-only rules). */
  skills: string;
}

const STAT_KEYS = ['MA', 'ST', 'AG', 'PA', 'AV'] as const;
const STATUS_INJURY_NAMES: ReadonlySet<string> = new Set([...Object.values(STAT_DECREASE), 'NI']);

/** A rule whose whole subject is stat changes and/or niggling injuries (no ordinary skill). */
export function isStatusOnlyRecord(record: Partial<AutoMarkingRecord>): boolean {
  const r = normalizeRecord(record);
  if (r.skillArray.length + r.injuryAttributes.length === 0) return false;
  return r.skillArray.every((s) => STAT_INCREASE_NAMES.has(s)) && r.injuryAttributes.every((i) => STATUS_INJURY_NAMES.has(i));
}

/** The built-in status mark for `count` of one token: "+ST" / "+2ST", "-MA" / "-2MA", "N" / "N2". */
export function defaultStatusMark(token: string, count: number): string {
  if (count <= 0) return '';
  if (token === 'NI') return count > 1 ? `N${count}` : 'N';
  return count > 1 ? `${token[0]}${count}${token.slice(1)}` : token;
}

/** The two-line marking for one player (option ON). `config` may be null: the status line needs no rules. */
export function generateMarkingLines(
  game: GameJson,
  team: TeamJson,
  player: PlayerJson,
  config: AutoMarkingConfig | null,
  playsForMarkingCoach: boolean,
): MarkingLines {
  const effective: AutoMarkingConfig = config ?? { autoMarkingRecords: [] };
  const subjects = markingSubjects(game, team, player);
  const separator = effective.separator ?? '';
  // ONE selection over every applicable record (the upstream matcher, exactly as the one-line form runs it), THEN the
  // surviving records are split between the lines - so a combination rule that suppresses a narrower rule
  // ("Dodge,+ST" over "+ST") still suppresses it here. Every coach rule is explicit: it keeps its literal text and
  // repeat answer; only stat changes / niggles that NO surviving rule covers get a built-in default.
  const survivors = selectRecords(applicableRecords(effective, playsForMarkingCoach), subjects, effective.sortMode);
  const skills = survivors.filter((r) => !isStatusOnlyRecord(r)).map((r) => r.marking).filter(Boolean).join(separator);

  const counts = new Map<string, number>();
  for (const token of [...subjects.gainedSkills.filter((s) => STAT_INCREASE_NAMES.has(s)), ...subjects.injuryAttributes]) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  // A token a surviving rule matched (a status-only rule, or a combination rule on the skill line) gets no default.
  const covered = new Set<string>();
  for (const record of survivors) for (const s of [...record.skillArray, ...record.injuryAttributes]) covered.add(s);

  const status: StatusMarkPart[] = [];
  // The coach's stat/injury-only rules first. Their occurrences join with the configured separator exactly as in the
  // one-line form (a rule matched N times reads N times, "S|S|n"); consecutive occurrences of one tone share a piece.
  // The renderer leaves a small gap between pieces (a tone change, and every built-in default).
  let occurrences = 0;
  for (const record of survivors) {
    if (!isStatusOnlyRecord(record) || !record.marking) continue;
    const text = (occurrences++ > 0 ? separator : '') + record.marking;
    const tone = record.injuryAttributes.length === 0 ? 'increase' : 'decrease';
    const last = status[status.length - 1];
    if (last && last.tone === tone) last.text += text;
    else status.push({ text, tone });
  }
  // Every change no rule spoke for: the built-in default, repeat counts collapsed. Reading order: increases,
  // decreases, then niggles.
  const order = [...STAT_KEYS.map((k) => STAT_INCREASE[k]!), ...STAT_KEYS.map((k) => STAT_DECREASE[k]!), 'NI'];
  for (const token of order) {
    const count = counts.get(token) ?? 0;
    if (!count || covered.has(token)) continue;
    status.push({ text: defaultStatusMark(token, count), tone: STAT_INCREASE_NAMES.has(token) ? 'increase' : 'decrease' });
  }
  return { status, skills };
}

/** Markings for every player in the game; home = the marking coach's side. */
export function generateAllMarkings(game: GameJson, config: AutoMarkingConfig): Map<string, string> {
  const markings = new Map<string, string>();
  for (const [team, own] of [
    [game.teamHome, true],
    [game.teamAway, false],
  ] as [TeamJson, boolean][]) {
    for (const player of team.playerArray) {
      const marking = generateMarking(game, team, player, config, own);
      if (marking) markings.set(player.playerId, marking);
    }
  }
  return markings;
}

/** Two-line markings for every player in the game (the opt-in status line); players with neither line are left out. */
export function generateAllMarkingLines(game: GameJson, config: AutoMarkingConfig | null): Map<string, MarkingLines> {
  const lines = new Map<string, MarkingLines>();
  for (const [team, own] of [
    [game.teamHome, true],
    [game.teamAway, false],
  ] as [TeamJson, boolean][]) {
    for (const player of team.playerArray) {
      const marking = generateMarkingLines(game, team, player, config, own);
      if (marking.skills || marking.status.length) lines.set(player.playerId, marking);
    }
  }
  return lines;
}
