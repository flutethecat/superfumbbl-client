import type { GameJson, PlayerJson, TeamJson } from '@fumbbl40k/ffb-protocol';

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
const STAT_DECREASE: Record<string, string> = { MA: '-MA', ST: '-ST', AG: '-AG', PA: '-PA', AV: '-AV' };

function positionFor(team: TeamJson, positionId: string): PositionLike | undefined {
  const roster = team.roster as { positionArray?: PositionLike[] };
  return roster.positionArray?.find((p) => p.positionId === positionId);
}

/** Mirrors MarkerGenerator.statDiff — positive = increase, negative = injury. */
function statDiffs(player: PlayerJson, position: PositionLike): Map<string, number> {
  const diffs = new Map<string, number>();
  const value = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  diffs.set('MA', player.movement - value(position.movement, player.movement));
  diffs.set('ST', player.strength - value(position.strength, player.strength));
  // AG/PA: BB2025 target numbers — improvement DECREASES the value
  diffs.set('AG', value(position.agility, player.agility) - player.agility);
  diffs.set('PA', value(position.passing, player.passing) - player.passing);
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

/** Mirrors MarkerGenerator.generate for one player. */
export function generateMarking(
  game: GameJson,
  team: TeamJson,
  player: PlayerJson,
  config: AutoMarkingConfig,
  playsForMarkingCoach: boolean,
): string {
  const position = positionFor(team, player.positionId);
  const baseSkills = [...(position?.skillArray ?? [])];
  const gainedSkills = (player.skillArray ?? []).filter((s) => {
    const idx = baseSkills.indexOf(s);
    return idx === -1;
  });
  const injuryAttributes: string[] = [];

  if (position) {
    for (const [key, diff] of statDiffs(player, position)) {
      if (diff > 0) for (let i = 0; i < diff; i++) gainedSkills.push(STAT_INCREASE[key]!);
      else if (diff < 0) for (let i = 0; i < -diff; i++) injuryAttributes.push(STAT_DECREASE[key]!);
    }
  }
  // Niggling injuries only carry a name on the wire (C14a); stat losses are
  // already covered by the stat diff above
  for (const injury of player.lastingInjuries ?? []) {
    if (/niggl|\bNI\b/i.test(String(injury))) injuryAttributes.push('NI');
  }

  const separator = config.separator ?? '';
  // Normalize each record so a partial/older export (missing injuryAttributes /
  // gainedOnly / applyTo / applyRepeatedly) no longer throws and blank the markings.
  const applicable = (config.autoMarkingRecords ?? []).map(normalizeRecord).filter((record) => {
    const applyTo = record.applyTo;
    return playsForMarkingCoach ? applyTo !== 'OPPONENT' : applyTo !== 'OWN';
  });

  // sorted mode (upstream default): most-specific records first
  const sorted =
    config.sortMode === 'NONE'
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

  const parts =
    config.sortMode === 'NONE'
      ? toApply
      : [...toApply].sort(
          (a, b) =>
            Number(a.skillArray.length === 0) - Number(b.skillArray.length === 0) ||
            a.marking.localeCompare(b.marking),
        );
  return parts.map((r) => r.marking).filter(Boolean).join(separator);
}

function applyToRank(record: AutoMarkingRecord): number {
  return record.applyTo === 'BOTH' ? 0 : record.applyTo === 'OWN' ? 1 : 2;
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
