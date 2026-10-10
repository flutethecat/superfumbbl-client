import type { AutoMarkingRecord } from './markings';
import { settings, type SkillBehaviour, type SkillConfigEntry } from './settings';
import { INJURY_CONFIG_KEYS, isInjuryConfigKey, markerTableDecides, perSkillMarkingRecords, singleSkillRecord } from './skillDisplay';

/**
 * Owner 10-09 (JLeav: "Can't undo automatic skill markings now (text), it won't import a blank set of skill
 * markings either"): ONE model over the two places a skill marking is stored, so a marking a coach removes is
 * removed everywhere it lives.
 *
 * The two stores (both persisted in the settings blob):
 *  - `settings.markingsConfig`: the FUMBBL auto-marking JSON (`autoMarkingRecords`, the exact shape fumbbl.com
 *    serves from `api/clientoptions/get/<coach>` and the FFB server reads; see markings.ts);
 *  - `settings.skillConfig[skill]`: the per-skill MARKER table (`markerText`, `markerMine`, `markerOpp`,
 *    `markerImported`). Since 09-25 the import projects single-skill rules onto this table.
 *
 * The bug: the import wrote a single-skill rule to BOTH stores, the Settings rule list showed (and removed from) the
 * JSON only, and the pitch drew the table's copy (effectiveMarkingConfig lets the table win for a skill it covers).
 *
 * STORAGE RULE (Modern; Astra review 10-09):
 *  - a skill (or injury) with ONE rule lives in the per-skill table;
 *  - a skill with SEVERAL rules (a marking for my team and another for the opposition) lives in the JSON, one record
 *    per rule, and the table carries no marker for it: every listed row is its own stored rule, so editing or removing
 *    a row never touches another;
 *  - combination rules live in the JSON.
 * The list is the EFFECTIVE config (exactly what the pitch draws). A config this build has not touched draws exactly
 * as it did: nothing is rewritten at load, and the shadowed JSON copies an old import left are dropped only when the
 * coach changes that skill (or imports again).
 */

export interface MarkingStores {
  markingsConfig: string;
  skillConfig: Record<string, SkillConfigEntry>;
}

export type MarkingApplyTo = AutoMarkingRecord['applyTo'];

/** One row of the effective config: a rule the pitch is drawing right now. */
export interface MarkingRuleRow {
  /** Stable within one render: `t:<skill>:<applyTo>` (per-skill table) or `j:<index>` (JSON record). */
  id: string;
  source: 'table' | 'json';
  /** The per-skill table key (`source: 'table'`). */
  skill?: string;
  /** Index into the JSON's `autoMarkingRecords` (`source: 'json'`). */
  jsonIndex?: number;
  skills: string[];
  injuries: string[];
  marking: string;
  applyTo: MarkingApplyTo;
  gainedOnly: boolean;
  applyRepeatedly: boolean;
  /** Came from "Import from fumbbl.com" and has not been edited here since. */
  imported: boolean;
}

export interface MarkingRulePatch {
  marking?: string;
  applyTo?: MarkingApplyTo;
  gainedOnly?: boolean;
  applyRepeatedly?: boolean;
}

export interface NewMarkingRule {
  skills: string[];
  marking: string;
  applyTo: MarkingApplyTo;
  gainedOnly: boolean;
}

/** A stored JSON record. `local` (client-only, ignored by the generator) marks a rule the coach added or edited here,
 *  so an import - which replaces the JSON with the site's - carries it over instead of dropping it. */
export type StoredMarkingRecord = Partial<AutoMarkingRecord> & { local?: boolean };
type JsonConfig = Record<string, unknown> & { autoMarkingRecords?: StoredMarkingRecord[] };

// ── import generation (Astra F5) ────────────────────────────────────────────────────────────────────────────────────
// A reply from fumbbl.com is applied only if nothing touched the markings since the request left: every change made
// through commitMarkingStores, a newer import, and closing / cancelling Settings all move the epoch on.
let epoch = 0;
/** A new import starts: older pending imports become stale. Returns the token to check the reply against. */
export function beginMarkingsImport(): number { epoch += 1; return epoch; }
export function markingsImportIsCurrent(token: number): boolean { return token === epoch; }
/** The markings changed (or Settings closed): any pending import's reply must be dropped. */
export function invalidateMarkingsImports(): void { epoch += 1; }

/** Write a change to the live settings (one reassign each → persist + re-render) and drop any pending import. */
export function commitMarkingStores(next: MarkingStores): void {
  invalidateMarkingsImports();
  if (next.markingsConfig !== settings.markingsConfig) settings.markingsConfig = next.markingsConfig;
  if (next.skillConfig !== settings.skillConfig) settings.skillConfig = next.skillConfig;
}
export function currentMarkingStores(): MarkingStores {
  return { markingsConfig: settings.markingsConfig, skillConfig: settings.skillConfig };
}

// ── JSON helpers ────────────────────────────────────────────────────────────────────────────────────────────────────
function parseJson(raw: string): JsonConfig | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonConfig : null;
  } catch {
    return null;
  }
}

function jsonRecords(json: JsonConfig | null): StoredMarkingRecord[] {
  return Array.isArray(json?.autoMarkingRecords) ? json!.autoMarkingRecords! : [];
}

/** Write the records back, keeping the JSON's other keys (separator, sort mode). No records and nothing else worth
 *  keeping = '' (the settings default, "markings off"). */
function writeJson(json: JsonConfig | null, records: StoredMarkingRecord[]): string {
  const rest: JsonConfig = { ...(json ?? {}) };
  delete rest.autoMarkingRecords;
  if (!records.length && !Object.keys(rest).length) return '';
  return JSON.stringify({ ...rest, autoMarkingRecords: records });
}

function stripMarkerFields(entry: SkillConfigEntry): SkillConfigEntry | null {
  const kept: SkillConfigEntry = { ...entry };
  delete kept.markerImported; delete kept.markerText; delete kept.markerMine; delete kept.markerOpp;
  return Object.keys(kept).length ? kept : null; // icon settings survive
}

function withoutMarker(config: Record<string, SkillConfigEntry>, skill: string): Record<string, SkillConfigEntry> {
  const next = { ...config };
  const kept = config[skill] ? stripMarkerFields(config[skill]!) : null;
  if (kept) next[skill] = kept; else delete next[skill];
  return next;
}

function behaviourOf(gainedOnly: boolean, injury: boolean): SkillBehaviour {
  return gainedOnly && !injury ? 'added' : 'always';
}

function dropJsonSingles(markingsConfig: string, skill: string): string {
  const json = parseJson(markingsConfig);
  const records = jsonRecords(json);
  const kept = records.filter((record) => singleSkillRecord(record) !== skill);
  return kept.length === records.length ? markingsConfig : writeJson(json, kept);
}

/**
 * Drop the JSON's single-skill records for every skill the table covers. They are shadowed duplicates (the table
 * wins for a skill it covers, so they draw nothing), and leaving them behind is what let a reset marking come back.
 * No visible change; idempotent; a JSON without such records is returned untouched (same object).
 */
export function normalizeMarkingStores(stores: MarkingStores): MarkingStores {
  const json = parseJson(stores.markingsConfig);
  const records = jsonRecords(json);
  const kept = records.filter((record) => {
    const single = singleSkillRecord(record);
    return single === null || !markerTableDecides(stores.skillConfig[single]);
  });
  if (kept.length === records.length) return stores;
  return { markingsConfig: writeJson(json, kept), skillConfig: stores.skillConfig };
}

// ── the list ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The effective rules, in draw-config order: JSON records the table does not shadow, then the per-skill table. */
export function listMarkingRules(stores: MarkingStores, importedJson = false): MarkingRuleRow[] {
  const rows: MarkingRuleRow[] = [];
  jsonRecords(parseJson(stores.markingsConfig)).forEach((record, index) => {
    const single = singleSkillRecord(record);
    if (single !== null && markerTableDecides(stores.skillConfig[single])) return;
    rows.push({
      id: `j:${index}`, source: 'json', jsonIndex: index,
      skills: [...(record.skillArray ?? [])], injuries: [...(record.injuryAttributes ?? [])],
      marking: record.marking ?? '', applyTo: record.applyTo ?? 'BOTH',
      gainedOnly: !!record.gainedOnly, applyRepeatedly: !!record.applyRepeatedly, imported: importedJson && !record.local,
    });
  });
  for (const [skill, entry] of Object.entries(stores.skillConfig)) {
    for (const record of perSkillMarkingRecords({ [skill]: entry })) {
      rows.push({
        id: `t:${skill}:${record.applyTo}`, source: 'table', skill,
        skills: [...record.skillArray], injuries: [...record.injuryAttributes],
        marking: record.marking, applyTo: record.applyTo,
        gainedOnly: record.gainedOnly, applyRepeatedly: record.applyRepeatedly, imported: !!entry.markerImported,
      });
    }
  }
  return rows;
}

/** What a rule matches, as a MULTISET: order-free but count-sensitive ("+ST, +ST" is two strength gains, a different
 *  subject from "+ST"). Used for every comparison: collisions, replace, and the import's merge with local rules. */
function subjectKey(rule: { skills: readonly string[]; injuries: readonly string[] }): string {
  // JSON of the sorted lists: no separator a name could contain (an imported "Block|Guard" is one odd skill name, not
  // Block + Guard). Names compare literally, exactly as the generator matches them (no "MA" / "-MA" aliasing).
  return JSON.stringify([[...rule.skills].sort(), [...rule.injuries].sort()]);
}
function sidesOverlap(a: MarkingApplyTo, b: MarkingApplyTo): boolean {
  return a === 'BOTH' || b === 'BOTH' || a === b;
}
/** Split typed names into skills and injury keys, the way a stored rule carries them. */
export function splitMarkingSubject(names: readonly string[]): { skills: string[]; injuries: string[] } {
  return { skills: names.filter((name) => !isInjuryConfigKey(name)), injuries: names.filter(isInjuryConfigKey) };
}

/**
 * Astra F3: the existing rules a new or edited rule would collide with - the same skills, on a side it also covers
 * (two rules for one skill are fine when one is for my team and the other for the opposition). `ignoreId` is the row
 * being edited.
 */
export function findMarkingConflicts(
  rows: readonly MarkingRuleRow[],
  candidate: { skills: readonly string[]; injuries: readonly string[]; applyTo: MarkingApplyTo },
  ignoreId?: string,
): MarkingRuleRow[] {
  const key = subjectKey(candidate);
  return rows.filter((row) => row.id !== ignoreId && subjectKey(row) === key && sidesOverlap(row.applyTo, candidate.applyTo));
}

// ── mutations (pure: stores in, stores out) ─────────────────────────────────────────────────────────────────────────
function tableRowsOf(skill: string, entry: SkillConfigEntry | undefined): AutoMarkingRecord[] {
  return entry ? perSkillMarkingRecords({ [skill]: entry }) : [];
}

/** Move a skill's table rule(s) into the JSON, one record per rule, and take its marker off the table. */
function tableSkillToJson(stores: MarkingStores, skill: string): { stores: MarkingStores; indexByApplyTo: Map<MarkingApplyTo, number> } {
  const entry = stores.skillConfig[skill];
  const moved = tableRowsOf(skill, entry);
  const json = parseJson(dropJsonSingles(stores.markingsConfig, skill)); // the table covered the skill: those were shadowed
  const records = jsonRecords(json);
  const indexByApplyTo = new Map<MarkingApplyTo, number>();
  const appended: StoredMarkingRecord[] = moved.map((record, i) => {
    indexByApplyTo.set(record.applyTo, records.length + i);
    return entry?.markerImported ? { ...record } : { ...record, local: true };
  });
  return {
    stores: { markingsConfig: writeJson(json, [...records, ...appended]), skillConfig: withoutMarker(stores.skillConfig, skill) },
    indexByApplyTo,
  };
}

/** Remove ONE rule from wherever it is stored. A table rule also takes the JSON's shadowed copies of that skill. */
export function removeMarkingRule(stores: MarkingStores, row: MarkingRuleRow): MarkingStores {
  if (row.source === 'json') {
    const json = parseJson(stores.markingsConfig);
    const records = jsonRecords(json);
    if (row.jsonIndex === undefined || row.jsonIndex < 0 || row.jsonIndex >= records.length) return stores;
    return { markingsConfig: writeJson(json, records.filter((_, i) => i !== row.jsonIndex)), skillConfig: stores.skillConfig };
  }
  const skill = row.skill;
  const entry = skill ? stores.skillConfig[skill] : undefined;
  if (!skill || !entry) return stores;
  const mine = row.applyTo === 'OPPONENT' ? entry.markerMine ?? 'never' : 'never';
  const opp = row.applyTo === 'OWN' ? entry.markerOpp ?? 'never' : 'never';
  const skillConfig = mine === 'never' && opp === 'never'
    ? withoutMarker(stores.skillConfig, skill)
    : { ...stores.skillConfig, [skill]: { ...entry, markerMine: mine, markerOpp: opp } };
  return { markingsConfig: dropJsonSingles(stores.markingsConfig, skill), skillConfig };
}

/**
 * Edit ONE rule: its marking text, who it applies to, gained-only, repeat (JSON rules only). Only that rule changes
 * (Astra F4): a table entry that reads as two rows - my team and the opposition sharing one glyph - is first split
 * into two stored rules. The edited rule is the coach's from now on: a later import does not retire it.
 * The caller checks findMarkingConflicts first.
 */
export function updateMarkingRule(stores: MarkingStores, row: MarkingRuleRow, patch: MarkingRulePatch): MarkingStores {
  const marking = (patch.marking ?? row.marking).trim();
  const applyTo = patch.applyTo ?? row.applyTo;
  const gainedOnly = patch.gainedOnly ?? row.gainedOnly;
  // An empty marking is a removal (the caller uses removeMarkingRule) - except for a rule that IS blank: the site
  // allows a blank marking (the rule then only hides the markings of the rules it contains), and it stays editable.
  if (!marking && row.marking.trim()) return stores;
  const editJson = (from: MarkingStores, index: number | undefined): MarkingStores => {
    const json = parseJson(from.markingsConfig);
    const records = jsonRecords(json);
    if (index === undefined || !records[index]) return stores;
    const next = records.map((record, i) => i !== index ? record : {
      ...record, marking, applyTo, gainedOnly, applyRepeatedly: patch.applyRepeatedly ?? !!record.applyRepeatedly, local: true,
    });
    return { markingsConfig: writeJson(json, next), skillConfig: from.skillConfig };
  };
  if (row.source === 'json') return editJson(stores, row.jsonIndex);
  const skill = row.skill;
  const entry = skill ? stores.skillConfig[skill] : undefined;
  if (!skill || !entry) return stores;
  if (tableRowsOf(skill, entry).length > 1) {
    const split = tableSkillToJson(stores, skill);
    return editJson(split.stores, split.indexByApplyTo.get(row.applyTo));
  }
  const behaviour = behaviourOf(gainedOnly, isInjuryConfigKey(skill));
  const next: SkillConfigEntry = {
    ...entry, markerText: marking,
    markerMine: applyTo === 'OPPONENT' ? 'never' : behaviour,
    markerOpp: applyTo === 'OWN' ? 'never' : behaviour,
  };
  delete next.markerImported;
  return { markingsConfig: dropJsonSingles(stores.markingsConfig, skill), skillConfig: { ...stores.skillConfig, [skill]: next } };
}

/**
 * Add a rule. It never changes an existing one (Astra F3): the caller checks findMarkingConflicts and either refuses
 * or passes the colliding rows as `replace` (the coach chose to). A first rule for one skill goes to the per-skill
 * table; a second rule for that skill (the other side) moves the skill to the JSON, one record per rule; a
 * combination goes to the JSON.
 */
export function addMarkingRule(stores: MarkingStores, rule: NewMarkingRule, replace: readonly MarkingRuleRow[] = []): MarkingStores {
  const names = rule.skills.map((skill) => skill.trim()).filter(Boolean);
  const marking = rule.marking.trim();
  if (!marking || !names.length) return stores;
  let current = stores;
  // highest JSON index first so the remaining indices stay valid
  for (const row of [...replace].sort((a, b) => (b.jsonIndex ?? -1) - (a.jsonIndex ?? -1))) current = removeMarkingRule(current, row);
  const subject = splitMarkingSubject(names);
  const key = subjectKey(subject);
  const single = names.length === 1 ? names[0]! : null;
  const siblings = listMarkingRules(current).filter((row) => subjectKey(row) === key);
  if (single !== null && !siblings.length) {
    const behaviour = behaviourOf(rule.gainedOnly, isInjuryConfigKey(single));
    const entry: SkillConfigEntry = {
      ...(current.skillConfig[single] ?? {}),
      markerText: marking,
      markerMine: rule.applyTo === 'OPPONENT' ? 'never' : behaviour,
      markerOpp: rule.applyTo === 'OWN' ? 'never' : behaviour,
    };
    delete entry.markerImported; // hand-made: a later import must not retire it
    return { markingsConfig: dropJsonSingles(current.markingsConfig, single), skillConfig: { ...current.skillConfig, [single]: entry } };
  }
  // A second rule for a skill the table holds: the table has one glyph per skill, so the skill moves to the JSON.
  if (single !== null && siblings.some((row) => row.source === 'table')) current = tableSkillToJson(current, single).stores;
  const json = parseJson(current.markingsConfig);
  const record: StoredMarkingRecord = {
    skillArray: subject.skills, injuryAttributes: subject.injuries, marking,
    gainedOnly: rule.gainedOnly && subject.skills.length > 0, applyTo: rule.applyTo,
    applyRepeatedly: subject.skills.length === 0, // an injury-only rule marks every such injury, like the table's
    local: true,
  };
  return { markingsConfig: writeJson(json, [...jsonRecords(json), record]), skillConfig: current.skillConfig };
}

/**
 * The per-skill Markers table (Settings → Skill display config) changes a skill's marker. From then on the table
 * decides that skill, Never included: the JSON's single-skill rules for it go, so a marker switched off there stays
 * off. (A config nobody touched keeps drawing as before: nothing here runs until the coach changes a value.)
 */
export function setTableMarker(
  stores: MarkingStores,
  skill: string,
  patch: { markerMine?: SkillBehaviour; markerOpp?: SkillBehaviour; markerText?: string },
): MarkingStores {
  const entry: SkillConfigEntry = { ...(stores.skillConfig[skill] ?? {}) };
  if (patch.markerMine !== undefined) entry.markerMine = patch.markerMine;
  if (patch.markerOpp !== undefined) entry.markerOpp = patch.markerOpp;
  if (patch.markerText !== undefined) { if (patch.markerText) entry.markerText = patch.markerText; else delete entry.markerText; }
  delete entry.markerImported;
  const behaviourChanged = patch.markerMine !== undefined || patch.markerOpp !== undefined;
  return {
    markingsConfig: behaviourChanged || markerTableDecides(entry) ? dropJsonSingles(stores.markingsConfig, skill) : stores.markingsConfig,
    skillConfig: { ...stores.skillConfig, [skill]: entry },
  };
}

/**
 * A PARTIAL import (some of the site's records could not be read) writes ONE readable site rule, and nothing else:
 * no rule an earlier import wrote is removed or switched off, in the table or the JSON (Astra round 4). The rule
 * replaces exactly its own (subject, side): an existing rule for the same subject keeps every side the new rule does
 * not cover (a BOTH rule met by a "my team" rule stays on for the opposition, with its own marking).
 */
export function upsertImportedRule(stores: MarkingStores, site: StoredMarkingRecord): MarkingStores {
  const subject = { skills: site.skillArray ?? [], injuries: site.injuryAttributes ?? [] };
  const applyTo: MarkingApplyTo = site.applyTo ?? 'BOTH';
  const key = subjectKey(subject);
  const single = singleSkillRecord(site);
  const marking = (site.marking ?? '').trim();
  const siblings = listMarkingRules(stores).filter((row) => subjectKey(row) === key);
  if (single !== null && marking && !siblings.length) {
    // the first rule for this skill: the per-skill table, flagged as the import's (as a full import stores it)
    const behaviour: SkillBehaviour = site.gainedOnly ? 'added' : 'always';
    const entry: SkillConfigEntry = {
      ...(stores.skillConfig[single] ?? {}),
      markerText: site.marking!,
      markerMine: applyTo === 'OPPONENT' ? 'never' : behaviour,
      markerOpp: applyTo === 'OWN' ? 'never' : behaviour,
      markerImported: true,
    };
    return { markingsConfig: dropJsonSingles(stores.markingsConfig, single), skillConfig: { ...stores.skillConfig, [single]: entry } };
  }
  // The subject already has rules (or this is a combination / blank rule): work on JSON records, one per rule.
  let current = stores;
  for (const tableSkill of new Set(siblings.filter((row) => row.source === 'table').map((row) => row.skill!))) {
    current = tableSkillToJson(current, tableSkill).stores; // keeps each rule's marking, sides and imported flag
  }
  const json = parseJson(current.markingsConfig);
  const next: StoredMarkingRecord[] = [];
  for (const old of jsonRecords(json)) {
    if (!markingRecordsCollide(old, site)) { next.push(old); continue; }
    const oldSide: MarkingApplyTo = old.applyTo ?? 'BOTH';
    if (oldSide === 'BOTH' && applyTo !== 'BOTH') next.push({ ...old, applyTo: applyTo === 'OWN' ? 'OPPONENT' : 'OWN' }); // keeps its other side
    // otherwise the old rule sits entirely on a side the site's rule now owns: replaced
  }
  const record: StoredMarkingRecord = { ...site };
  delete record.local;
  return { markingsConfig: writeJson(json, [...next, record]), skillConfig: current.skillConfig };
}

/** The JSON rules the coach added or edited here (not the import's): an import keeps them. */
export function localJsonRecords(markingsConfig: string): StoredMarkingRecord[] {
  return jsonRecords(parseJson(markingsConfig)).filter((record) => record.local);
}

/** Do two stored records collide (same skills and injuries, a side in common)? */
export function markingRecordsCollide(a: StoredMarkingRecord, b: StoredMarkingRecord): boolean {
  const subject = (record: StoredMarkingRecord) => subjectKey({ skills: record.skillArray ?? [], injuries: record.injuryAttributes ?? [] });
  return subject(a) === subject(b) && sidesOverlap(a.applyTo ?? 'BOTH', b.applyTo ?? 'BOTH');
}

/** Clear ALL skill markings (imported and hand-made): the client's default, nothing drawn. Icon settings are kept. */
export function clearAllMarkings(stores: MarkingStores): MarkingStores {
  const skillConfig: Record<string, SkillConfigEntry> = {};
  for (const [skill, entry] of Object.entries(stores.skillConfig)) {
    const kept = stripMarkerFields(entry);
    if (kept) skillConfig[skill] = kept;
  }
  return { markingsConfig: '', skillConfig };
}

/** Remove what an import brought in (and the coach has not edited since); hand-made markings stay. */
export function removeImportedMarkings(stores: MarkingStores, importedJson: boolean): MarkingStores {
  const skillConfig: Record<string, SkillConfigEntry> = {};
  for (const [skill, entry] of Object.entries(stores.skillConfig)) {
    const kept = entry.markerImported ? stripMarkerFields(entry) : entry;
    if (kept) skillConfig[skill] = kept;
  }
  const json = parseJson(stores.markingsConfig);
  const records = jsonRecords(json);
  return { markingsConfig: importedJson ? writeJson(json, records.filter((record) => record.local)) : stores.markingsConfig, skillConfig };
}

/** How many markings came from an import. */
export function importedMarkingCount(stores: MarkingStores, importedJson: boolean): number {
  return listMarkingRules(stores, importedJson).filter((row) => row.imported).length;
}

/** What a rule matches, as the Settings table words it: skills, then injuries by their Settings label. */
export function markingRuleSubject(row: Pick<MarkingRuleRow, 'skills' | 'injuries'>): string {
  const injuryLabel = (key: string): string => INJURY_CONFIG_KEYS.find((entry) => entry.key === key)?.label ?? key;
  return [...row.skills, ...row.injuries.map(injuryLabel)].join(' + ');
}
