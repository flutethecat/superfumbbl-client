import type { GameJson, PlayerJson, TeamJson } from '@fumbbl40k/ffb-protocol';
import { decodePlayerSkills, normalizeSkillName, playerSkillDisplayEntries, playerSkillNames } from '@fumbbl40k/ffb-protocol';
import type { AutoMarkingConfig, AutoMarkingRecord } from './markings';
import {
  settings,
  iconBehaviourDefault,
  MARKER_BEHAVIOUR_DEFAULT,
  type SkillBehaviour,
  type SkillConfigEntry,
  type AppSettings,
} from './settings';

/**
 * Per-skill display config (owner 2026-07-03 r6f). Turns the sparse
 * `settings.skillConfig` into the per-player icon-skill lists + marker strings the
 * renderer draws (renderer.setPlayerIconSkills / setPlayerMarkings), honouring the
 * MY TEAM (home coach) / OPPOSITION (away coach) behaviour columns:
 *   - "All the time" (always) — always show the skill,
 *   - "Only if added" (added) — show only when the skill was GAINED as an
 *     advancement (i.e. NOT a baseline positional skill),
 *   - "Never" — always hidden.
 * Markers additionally carry a per-skill glyph (`markerText`), pre-filled from the
 * imported FUMBBL JSON but overridden by a user value.
 */

interface PositionLike {
  positionId: string;
  skillArray?: string[];
  /** Parallel to skillArray: the position's own skill values ("3" for Loner, a Hatred keyword) and display values. */
  skillValues?: (string | null)[];
  skillDisplayValues?: (string | null)[];
  movement?: number;
  strength?: number;
  agility?: number;
  passing?: number;
  armour?: number;
}

function baselineSkillsFor(team: TeamJson, player: PlayerJson): Set<string> {
  const roster = team.roster as { positionArray?: PositionLike[] };
  const position = roster.positionArray?.find((p) => p.positionId === player.positionId);
  return new Set(position?.skillArray ?? []);
}

/** Does a skill show given its behaviour and whether it's a baseline (positional) skill? */
function shows(behaviour: SkillBehaviour, isBaseline: boolean): boolean {
  return behaviour === 'always' ? true : behaviour === 'added' ? !isBaseline : false;
}

function iconBehaviour(skill: string, mine: boolean): SkillBehaviour {
  const entry = settings.skillConfig[skill];
  const v = mine ? entry?.iconMine : entry?.iconOpp;
  return v ?? iconBehaviourDefault();
}

function markerBehaviour(skill: string, mine: boolean): SkillBehaviour {
  const entry = settings.skillConfig[skill];
  const v = mine ? entry?.markerMine : entry?.markerOpp;
  return v ?? MARKER_BEHAVIOUR_DEFAULT;
}

/**
 * Base + TEMPORARY skills, through the one shared decoder. The Wisdom-only special case (which scraped the
 * protocol's `ffb40k:` diagnostic log because incremental changes never reached the model) is gone: every
 * temporary grant — prayers, Intensive Training, cards, Wisdom — now lands in `temporarySkillsMap` under its
 * upstream source name on both the incremental and the full-sync path, and expires through
 * FIELD_MODEL_REMOVE_PRAYER / REMOVE_SKILL_ENHANCEMENTS.
 */
function displayedSkills(player: PlayerJson): string[] {
  return playerSkillNames(player);
}

/** Owner 10-02 (S94): the INJURY rows of the per-skill table - a niggling injury and every stat bust. Their keys are
 *  the status tokens the icon rail and the marking generator already use, so one setting drives both views. */
export const INJURY_CONFIG_KEYS: readonly { key: string; label: string }[] = [
  { key: 'NI', label: 'Niggling Injury' },
  { key: '-MA', label: 'Movement reduction (-MA)' },
  { key: '-ST', label: 'Strength reduction (-ST)' },
  { key: '-AG', label: 'Agility reduction (-AG)' },
  { key: '-PA', label: 'Passing reduction (-PA)' },
  { key: '-AV', label: 'Armour reduction (-AV)' },
];
const INJURY_KEYS = new Set(INJURY_CONFIG_KEYS.map((entry) => entry.key));
export function isInjuryConfigKey(key: string): boolean { return INJURY_KEYS.has(key); }

/** Permanent characteristic changes and niggling injuries are status icons, not
 * configurable skills. Keep them at the front of the four-icon rail so a lasting
 * injury cannot be hidden behind ordinary skill badges. */
function characteristicStatusIcons(team: TeamJson, player: PlayerJson): string[] {
  const roster = team.roster as { positionArray?: PositionLike[] };
  const position = roster.positionArray?.find((candidate) => candidate.positionId === player.positionId);
  const icons: string[] = [];
  const compare = (
    key: 'MA' | 'ST' | 'AG' | 'PA' | 'AV',
    current: number | undefined,
    base: number | undefined,
    lowerIsBetter: boolean,
  ) => {
    if (!Number.isFinite(current) || !Number.isFinite(base) || current === base) return;
    const improved = lowerIsBetter ? current! < base! : current! > base!;
    icons.push(`${improved ? '+' : '-'}${key}`);
  };
  if (position) {
    compare('MA', player.movement, position.movement, false);
    compare('ST', player.strength, position.strength, false);
    compare('AG', player.agility, position.agility, true);
    compare('PA', player.passing, position.passing, true);
    compare('AV', player.armour, position.armour, false);
  }
  if ((player.lastingInjuries ?? []).some((injury) => /niggl|\bNI\b/i.test(String(injury)))) icons.push('NI');
  return icons;
}

/** Upstream SkillValueEvaluator.ROLL skills (Loner, Bloodlust, Hypnotic Gaze, Secret Weapon): the wire carries the bare
 *  target number ("4"); the Java client shows it as a roll ("4+"). Owner 10-06: "Loner (3+) / (4+) / (5+)" on the card. */
const ROLL_VALUED_SKILLS = new Set(['loner', 'bloodlust', 'hypnoticgaze', 'secretweapon']);
/** Upstream SkillValueEvaluator.MODIFIER skills (Mighty Blow, Dirty Player): bare "1" on the wire, shown as "(+1)". */
const MODIFIER_VALUED_SKILLS = new Set(['mightyblow', 'dirtyplayer']);
export function formatSkillValue(skill: string, value: string): string {
  const v = value.trim();
  const key = normalizeSkillName(skill);
  if (!/^\d+$/.test(v)) return v;
  if (ROLL_VALUED_SKILLS.has(key)) return `${v}+`;
  if (MODIFIER_VALUED_SKILLS.has(key)) return `+${v}`;
  return v;
}

export interface PlayerDetailSkill {
  /** Canonical key retained for icons and rules text. */
  name: string;
  /** Human-readable label, including server-valued skills. */
  label: string;
  /** Not part of the positional baseline (Classic's green-acquired style). */
  added: boolean;
}

/** Shared Modern/Classic player-card skill projection. */
export function playerDetailSkills(
  player: PlayerJson,
  baselineSkills: ReadonlySet<string> = new Set(),
): PlayerDetailSkill[] {
  // Owner 10-06: the value comes through the canonical decoder (display map > display array > value map > value
  // array) - a team serialization carries Loner's roll only in the parallel `skillValues`, which the map-only read
  // missed, so the card said "Loner" with no roll.
  const decoded = decodePlayerSkills(player);
  return playerSkillDisplayEntries(player).map((entry) => {
    const value = decoded.find((skill) => skill.name === entry.name && skill.value?.trim())?.value?.trim() ?? '';
    return {
      name: entry.name,
      label: entry.label !== entry.name
        ? entry.label
        : value ? `${entry.name} (${formatSkillValue(entry.name, value)})` : entry.name,
      added: !baselineSkills.has(entry.name),
    };
  });
}

/** Owner 10-01 (S87): a player CARD's skills with `added` judged against the player's own roster position - the
 *  profile popup and the apothecary card called `playerDetailSkills(player)` with no baseline, which marks EVERY
 *  skill as added. A position the roster does not list (no baseline to compare with) marks nothing as added. */
export function playerCardSkills(team: TeamJson, player: PlayerJson): PlayerDetailSkill[] {
  const roster = team.roster as { positionArray?: PositionLike[] } | undefined;
  const position = roster?.positionArray?.find((p) => p.positionId === player.positionId);
  if (!position) return playerDetailSkills(player).map((skill) => ({ ...skill, added: false }));
  return playerDetailSkills(player, new Set(position.skillArray ?? []));
}

export interface RosterSkill extends PlayerDetailSkill {
  /** The position's OWN entry, unchanged: the roster panes' "Hide innate skills" box hides exactly these. */
  innate: boolean;
}

/**
 * Owner 10-10 (roster panes, "Hide innate skills") + Astra review: which of a player's skill chips is the POSITION's
 * own entry. `added` (the gold outline) compares by NAME only, so a Troll Slayer granted Hatred (Orc) on top of his
 * innate Hatred (Troll), or a prayer's Mighty Blow on a player who has it innately, reads "not added" - hiding by
 * `!added` would drop a gained skill. A chip is innate only when ALL of these hold; anything the model cannot tell
 * apart stays VISIBLE:
 *   - the position lists the skill (RosterPosition skillArray);
 *   - the player is not zapped (a frog's skills are its own, whatever the old position listed);
 *   - no temporary grant carries it (temporarySkillsMap: prayers, cards, Intensive Training, FIELD_MODEL_ADD_HATRED
 *     -> modelChangeProcessor addHatred); for Hatred, no temporary grant of THAT keyword;
 *   - the player has no entry of his own for it: upstream RosterPlayer fills skillValues / displayValues only from the
 *     player's own team-XML <skill> elements (RosterPlayer.java:542-544), never for position skills (:280), so a key
 *     in skillValuesMap / skillDisplayValuesMap is a skill the PLAYER carries (a learned copy, an improved value);
 *   - its keyword / value equals the position's (RosterPlayer.java:211-212: own value, else the position's).
 */
export function playerRosterSkills(player: PlayerJson, position: PositionLike | undefined): RosterSkill[] {
  const positionSkills = position?.skillArray ?? [];
  const detail = playerDetailSkills(player, new Set(positionSkills));
  if (!position || String(player.playerKind) === 'zappedPlayer') return detail.map((skill) => ({ ...skill, innate: false }));
  const text = (v: unknown): string => String(v ?? '').trim().toLowerCase();
  const positionValue = (name: string): string => {
    const index = positionSkills.indexOf(name);
    return text(position.skillDisplayValues?.[index]) || text(position.skillValues?.[index]);
  };
  const decoded = decodePlayerSkills(player);
  const ownKeys = new Set([...Object.keys(player.skillValuesMap ?? {}), ...Object.keys(player.skillDisplayValuesMap ?? {})]);
  return detail.map((skill) => {
    if (!positionSkills.includes(skill.name) || ownKeys.has(skill.name)) return { ...skill, innate: false };
    const mine = decoded.filter((entry) => entry.name === skill.name);
    const temporary = mine.filter((entry) => entry.source !== null);
    const wanted = positionValue(skill.name);
    if (normalizeSkillName(skill.name) === 'hatred') {
      // One chip per keyword: the position's only when it shows the position's keyword and no grant carries that keyword.
      // A bare "Hatred" chip means no entry carried a keyword at all (model sync leaves the position's keyword on the
      // position): it is the position's unless a grant is among them.
      const keyword = text(/^.+? \((.+)\)$/.exec(skill.label)?.[1]);
      if (!keyword) return { ...skill, innate: temporary.length === 0 };
      return { ...skill, innate: keyword === wanted && !temporary.some((entry) => text(entry.value) === keyword) };
    }
    // one chip per name: a temporary grant of the same name shares it, so the chip stays
    if (temporary.length) return { ...skill, innate: false };
    // the team-array serialization carries every base skill's value beside it: a value other than the position's is the player's
    const base = text(mine.find((entry) => entry.source === null)?.value);
    return { ...skill, innate: base === '' || base === wanted };
  });
}

/** Owner 10-05: a valued skill's value - Hatred's keyword ("Hatred (Orc)" -> "Orc") - is written in small text under the
 *  card chip's icon so it says WHO the hatred is for without the tooltip. Other labels carry no value (null). */
export function chipSubtext(skill: Pick<PlayerDetailSkill, 'label'>): string | null {
  const m = /^(.+?) \((.+)\)$/.exec(skill.label);
  if (!m) return null;
  const skillName = normalizeSkillName(m[1]!);
  // Hatred's keyword, and a roll-valued skill's target ("Loner (4+)" -> "4+"); other parentheses are not values.
  return skillName === 'hatred' || ROLL_VALUED_SKILLS.has(skillName) ? m[2]!.trim() : null;
}

/** Owner 10-01 (S87): added skills go to the END of a card's list; the order inside each group is kept. */
export function addedSkillsLast<T extends { added: boolean }>(skills: readonly T[]): T[] {
  return [...skills.filter((skill) => !skill.added), ...skills.filter((skill) => skill.added)];
}

/** The glyph a marker shows for a skill — the user text if set, else the skill's
 *  short initials (upstream markings use the config text; JSON pre-fill fills it).
 *  Owner 2026-07-08: exported — the reroll menu (markings mode) shows each skill
 *  source with the SAME glyph the user's markings use on the pitch. */
export function markerGlyph(skill: string): string {
  const text = settings.skillConfig[skill]?.markerText;
  if (text && text.trim()) return text.trim();
  // fallback: the skill initials (e.g. "Sure Hands" → "SH"), so an enabled marker
  // without a configured glyph still shows something legible.
  return skill.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').join('').slice(0, 3);
}

/** Per-player list of skills to draw as ICONS, honouring the per-skill config +
 *  MY TEAM / OPPOSITION behaviour + the baseline (only-if-added) rule. */
export function computeIconSkills(game: GameJson): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [team, mine] of [
    [game.teamHome, true],
    [game.teamAway, false],
  ] as [TeamJson, boolean][]) {
    for (const player of team.playerArray) {
      const baseline = baselineSkillsFor(team, player);
      const skills = displayedSkills(player).filter((s) => shows(iconBehaviour(s, mine), baseline.has(s)));
      // Owner 09-06: a stat increase already arrives as a '+ST'/'+AG'/… SKILL in skillArray AND as a characteristic
      // diff vs the roster position — one icon, not two (Set keeps first-seen order: characteristic icons lead).
      // S94: an injury icon (NI / a stat bust) follows its row in the table - shown unless set to Never (an injury is
      // never part of the position, so All the time and Gained both show it). Stat INCREASES are unaffected.
      const status = characteristicStatusIcons(team, player).filter((icon) => !INJURY_KEYS.has(icon) || iconBehaviour(icon, mine) !== 'never');
      out.set(player.playerId, [...new Set([...status, ...skills])]);
    }
  }
  return out;
}

/** True when the user has opted at least one skill into the per-skill MARKER
 *  system (any marker behaviour set to something other than Never). While false,
 *  the FUMBBL-JSON marking path stays the marking source. */
export function anyMarkerConfigured(): boolean {
  return Object.values(settings.skillConfig).some(
    (e) => (e.markerMine && e.markerMine !== 'never') || (e.markerOpp && e.markerOpp !== 'never'),
  );
}

/** Per-player marker string built from the per-skill MARKER config (glyphs joined,
 *  most specific — gained/added — first). Empty when nothing applies. */
export function computeConfigMarkings(game: GameJson): Map<string, string> {
  const out = new Map<string, string>();
  for (const [team, mine] of [
    [game.teamHome, true],
    [game.teamAway, false],
  ] as [TeamJson, boolean][]) {
    for (const player of team.playerArray) {
      const baseline = baselineSkillsFor(team, player);
      const glyphs: string[] = [];
      for (const skill of displayedSkills(player)) {
        if (shows(markerBehaviour(skill, mine), baseline.has(skill))) glyphs.push(markerGlyph(skill));
      }
      // Pitch markers are a compact glyph rail, not prose. Keep independently
      // configured skill glyphs adjacent so a five-skill player does not span
      // several squares before the renderer applies its width guard.
      const marking = glyphs.filter(Boolean).join('');
      if (marking) out.set(player.playerId, marking);
    }
  }
  return out;
}

/** #6 (owner ruling 08-17, refined 08-17b): decides how a CoachAction.icon (currently only 'Jump Up', Move row
 *  only — availableActions.ts) presents in the SpectateView context menu, branching on the SAME skillDisplay
 *  field the skill-marking cycle button + pitch glyphs use (see SpectateView skillMode/cycleSkillDisplay).
 *  TEXT mode ('markings') has no icon glyphs to reuse, so it falls back to the pre-#6 "Jump Up Move" text
 *  prefix; icon-capable modes ('icons', either bb3/bb2 style) keep the row label plain and let the caller
 *  resolve the icon (SpectateView owns skillIconUrl/effectiveIconStyle, kept out of this pure module). */
export function jumpUpMenuPresentation(
  icon: string | undefined,
  label: string,
  skillDisplay: AppSettings['skillDisplay'],
): { label: string; useIcon: boolean } {
  if (!icon) return { label, useIcon: false };
  if (skillDisplay === 'markings') return { label: `${icon} ${label}`, useIcon: false };
  return { label, useIcon: true };
}

/**
 * Owner 09-25 (import review): the on-pitch markings come from ONE effective FUMBBL-style config, so the upstream
 * precedence rules (a combo rule suppresses its single-skill subsets, applyTo, gainedOnly, injuries) apply to
 * everything at once:
 *  - every multi-skill / injury record of the imported JSON as-is;
 *  - one record per skill from the per-skill MARKER table (glyph = markerText, behaviour → gainedOnly/applyTo);
 *  - the JSON's single-skill records only for skills the table does not cover.
 * Before this, the moment a marker was configured (which the import itself did) the JSON was ignored entirely,
 * so combo rules never drew, and the import mapped every rule to "always" (gainedOnly lost).
 */
export function singleSkillRecord(record: Partial<AutoMarkingRecord>): string | null {
  return (record.skillArray?.length ?? 0) === 1 && (record.injuryAttributes?.length ?? 0) === 0 ? record.skillArray![0]! : null;
}
/** The per-skill table COVERS a skill's marker when either side is set to show it; the imported JSON's single-skill
 *  rule for that skill then draws nothing. A skill left on Never / Never is NOT covered (its JSON rule still draws):
 *  that is how every config stored before 10-09 reads, and it must keep drawing the same until the coach changes
 *  something. Turning a marker off in this build removes the JSON rule instead (markingRules.setTableMarker). */
export function markerTableDecides(entry: SkillConfigEntry | undefined): boolean {
  return (!!entry?.markerMine && entry.markerMine !== 'never') || (!!entry?.markerOpp && entry.markerOpp !== 'never');
}
export function perSkillMarkingRecords(config: Record<string, SkillConfigEntry> = settings.skillConfig): AutoMarkingRecord[] {
  const out: AutoMarkingRecord[] = [];
  for (const [skill, entry] of Object.entries(config)) {
    const mine = entry.markerMine ?? 'never';
    const opp = entry.markerOpp ?? 'never';
    if (mine === 'never' && opp === 'never') continue;
    const marking = markerGlyphFor(skill, config);
    // S94: an injury row matches the player's injury attributes (one marking per bust, like FUMBBL's own rules)
    const injury = INJURY_KEYS.has(skill);
    const rec = (applyTo: AutoMarkingRecord['applyTo'], behaviour: SkillBehaviour): AutoMarkingRecord => injury
      ? { skillArray: [], injuryAttributes: [skill], marking, gainedOnly: false, applyTo, applyRepeatedly: true }
      : { skillArray: [skill], injuryAttributes: [], marking, gainedOnly: behaviour === 'added', applyTo, applyRepeatedly: false };
    if (mine === opp) out.push(rec('BOTH', mine));
    else {
      if (mine !== 'never') out.push(rec('OWN', mine));
      if (opp !== 'never') out.push(rec('OPPONENT', opp));
    }
  }
  return out;
}
function markerGlyphFor(skill: string, config: Record<string, SkillConfigEntry>): string {
  const text = config[skill]?.markerText;
  if (text && text.trim()) return text.trim();
  if (INJURY_KEYS.has(skill)) return skill; // S94: '-MA', 'NI' read as themselves
  return skill.split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').join('').slice(0, 3);
}
export function effectiveMarkingConfig(rawJson: string, config: Record<string, SkillConfigEntry> = settings.skillConfig): AutoMarkingConfig | null {
  let json: AutoMarkingConfig | null = null;
  const raw = rawJson.trim();
  if (raw) { try { json = JSON.parse(raw) as AutoMarkingConfig; } catch { json = null; } }
  const covered = new Set(Object.entries(config).filter(([, e]) => markerTableDecides(e)).map(([skill]) => skill));
  const fromJson = (json?.autoMarkingRecords ?? []).filter((record) => { const single = singleSkillRecord(record); return single === null || !covered.has(single); });
  const records = [...fromJson, ...perSkillMarkingRecords(config)];
  if (!records.length) return null;
  return { autoMarkingRecords: records, separator: json?.separator, sortMode: json?.sortMode };
}

/** Owner 09-25: "Import markings from fumbbl.com" projects the coach's single-skill rules onto the per-skill MARKER
 *  table (glyph + behaviour: gainedOnly → only-if-added, applyTo → which side) and REPLACES what an earlier import
 *  wrote; rules removed on fumbbl.com retire their imported entry. Hand-set entries for other skills are kept; a
 *  hand-set entry for an imported skill is overwritten (the coach asked for FUMBBL's version). Multi-skill and
 *  injury rules stay in the JSON and draw through effectiveMarkingConfig. */
export function applyImportedMarkings(records: readonly Partial<AutoMarkingRecord>[], prev: Record<string, SkillConfigEntry>, keptLocal: readonly Partial<AutoMarkingRecord>[] = []): { next: Record<string, SkillConfigEntry>; imported: number; combos: number } {
  const next: Record<string, SkillConfigEntry> = {};
  for (const [skill, entry] of Object.entries(prev)) {
    if (!entry.markerImported) { next[skill] = { ...entry }; continue; }
    const kept: SkillConfigEntry = { ...entry };
    delete kept.markerImported; delete kept.markerText; delete kept.markerMine; delete kept.markerOpp;
    if (Object.keys(kept).length) next[skill] = kept; // icon settings survive a retired import
  }
  // Owner 10-09: a skill with SEVERAL single-skill rules ("B" on my team, "b" on the opposition) does not fit the
  // table's one glyph per skill - the last rule used to win and the others were lost. Those rules stay in the JSON,
  // the table steps aside for the skill, and the generator draws them exactly as written.
  // `keptLocal`: the coach's own JSON rules that ride along with this import count too (a site rule for my team plus
  // the coach's rule for the opposition is two rules for the skill).
  const singles = new Map<string, number>();
  for (const record of [...records, ...keptLocal]) {
    const single = singleSkillRecord(record);
    if (single !== null && record.marking) singles.set(single, (singles.get(single) ?? 0) + 1);
  }
  let imported = 0, combos = 0;
  for (const record of records) {
    const single = singleSkillRecord(record);
    if (single === null) { combos++; continue; }
    if (!record.marking) continue;
    if ((singles.get(single) ?? 0) > 1) {
      const kept: SkillConfigEntry = { ...(next[single] ?? {}) };
      delete kept.markerImported; delete kept.markerText; delete kept.markerMine; delete kept.markerOpp;
      if (Object.keys(kept).length) next[single] = kept; else delete next[single];
      imported++;
      continue;
    }
    const applyTo = record.applyTo ?? 'BOTH';
    const behaviour: SkillBehaviour = record.gainedOnly ? 'added' : 'always';
    next[single] = {
      ...(next[single] ?? {}),
      markerText: record.marking,
      markerMine: applyTo === 'OPPONENT' ? 'never' : behaviour,
      markerOpp: applyTo === 'OWN' ? 'never' : behaviour,
      markerImported: true,
    };
    imported++;
  }
  return { next, imported, combos };
}
