import { FUMBBL_SITE, settings } from './settings';
import { applyImportedMarkings } from './skillDisplay';
import {
  beginMarkingsImport, commitMarkingStores, currentMarkingStores, invalidateMarkingsImports, localJsonRecords, markingRecordsCollide,
  markingsImportIsCurrent, normalizeMarkingStores, upsertImportedRule, type StoredMarkingRecord,
} from './markingRules';

/** Astra 10-09: a request that never answers must not leave Settings busy for ever. */
export const MARKINGS_IMPORT_TIMEOUT_MS = 20_000;

/** undefined (key absent) or a list of strings. */
const isNameList = (value: unknown): value is string[] | undefined =>
  value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
const isFlag = (value: unknown): boolean => value === undefined || typeof value === 'boolean';
/**
 * A record this client can read (Astra rounds 3-4): an object with a `skillArray` and / or `injuryAttributes` list of
 * strings (either may be empty), a `marking` that is a string - BLANK IS VALID: upstream lets a blank-marking rule
 * suppress the rules it contains (MarkerGenerator.populateMarkingRecords) - or absent, `applyTo` absent or OWN /
 * OPPONENT / BOTH (the serializer omits a null one), and `gainedOnly` / `applyRepeatedly` booleans or absent.
 * `{}`, `{unexpected: true}`, null, a non-object or a field of the wrong type is unreadable.
 */
function readableRecord(record: unknown): record is StoredMarkingRecord {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const r = record as Record<string, unknown>;
  if (!isNameList(r.skillArray) || !isNameList(r.injuryAttributes)) return false;
  if (r.skillArray === undefined && r.injuryAttributes === undefined) return false; // no rule shape at all
  if (!(r.marking === undefined || typeof r.marking === 'string')) return false;
  if (!(r.applyTo === undefined || r.applyTo === 'OWN' || r.applyTo === 'OPPONENT' || r.applyTo === 'BOTH')) return false;
  return isFlag(r.gainedOnly) && isFlag(r.applyRepeatedly);
}
/** A readable record with no skill and no injury matches nobody (upstream: findMin(MAX, MAX) = 0): read, then ignored. */
const hasSubject = (record: StoredMarkingRecord): boolean => (record.skillArray?.length ?? 0) + (record.injuryAttributes?.length ?? 0) > 0;

export interface MarkingsImportResult {
  /** `imported`: rules applied. `blank`: the site sent an explicit empty set, applied. `ambiguous`: nothing usable
   *  came back (unknown coach, or a coach with no options saved) - NOTHING changed. `unreadable`: records came back
   *  but none could be read - NOTHING changed. `stale`: the markings were changed, or Settings closed, while the
   *  request was out - the reply was dropped. `error`: the request failed or timed out. */
  kind: 'imported' | 'blank' | 'ambiguous' | 'unreadable' | 'stale' | 'error';
  /** The settings were updated from the reply. */
  ok: boolean;
  /** The status line to show. */
  status: string;
  /** Single-skill markings written. */
  imported: number;
  /** Combination / injury rules kept in the JSON. */
  combos: number;
}

const result = (kind: MarkingsImportResult['kind'], status: string, imported = 0, combos = 0): MarkingsImportResult =>
  ({ kind, ok: kind === 'imported' || kind === 'blank', status, imported, combos });

/**
 * #16 (owner 08-11) / owner 09-25: import a coach's skill markings from fumbbl.com. Shared by Settings → Skills
 * ("Import from fumbbl.com") and the first-launch setup wizard (owner 10-06) so both run the SAME routine.
 * User-initiated only (nothing in the client calls this on its own); sends nothing but the coach name in the path.
 *
 * ⚖ upstream-does-it: the Java client reads this same endpoint (user-initiated fetch of a coach's client options).
 * The import REPLACES what an earlier import wrote (glyph AND behaviour, gainedOnly/applyTo honoured) and retires
 * rules deleted on fumbbl.com; combo / injury rules stay in the JSON and draw from there. Rules the coach added or
 * edited here ride along unless the site has a rule for the same skills on the same side.
 *
 * Owner 10-09 (JLeav: "it won't import a blank set of skill markings either"), Astra F6: only an EXPLICIT
 * `autoMarkingRecords: []` is a blank set, and it retires what the earlier import wrote. A `null` body, a non-object
 * or a reply without the key could as well be a mistyped coach (what the site sends for either is not known), so it
 * changes nothing and does not record the coach; Settings then offers "Remove my imported markings anyway".
 *
 * Only an array that is LITERALLY empty is a blank set: a non-empty array whose records cannot be read changes
 * nothing ("could not be read"). A PARTIAL read (some records readable, some not) retires NOTHING and switches
 * nothing off, in the table or the JSON: each readable rule is written on exactly its own (subject, side)
 * (markingRules.upsertImportedRule) - an unreadable record may be the very rule that would otherwise be deleted.
 * Only a fully readable reply may retire rules no longer on the site.
 *
 * Astra F5: the reply is applied only if nothing touched the markings since the request left (markingRules' epoch).
 * A request that has not answered after `timeoutMs` is given up: its generation is retired, so a late reply is dropped.
 */
export async function importFumbblMarkingsDetailed(
  coachInput: string,
  onProgress?: (status: string) => void,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = MARKINGS_IMPORT_TIMEOUT_MS,
): Promise<MarkingsImportResult> {
  const coach = coachInput.trim();
  if (!coach) return result('error', 'Enter a coach name to import markings from.');
  const token = beginMarkingsImport();
  onProgress?.(`Fetching markings for ${coach}…`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const TIMED_OUT = Symbol('timed out');
  try {
    const request = (async () => {
      const res = await fetchImpl(`${FUMBBL_SITE}/api/clientoptions/get/${encodeURIComponent(coach)}`);
      if (!res.ok) throw new Error(`fumbbl.com returned ${res.status}`);
      return res.text();
    })();
    request.catch(() => undefined); // a rejection after the timeout has nobody left to report to
    const text = await Promise.race([request, new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs); })]);
    if (text === TIMED_OUT) {
      if (markingsImportIsCurrent(token)) invalidateMarkingsImports(); // retire this generation: a late reply is dropped
      return result('error', `Import for ${coach} timed out: fumbbl.com did not answer. Nothing was changed.`);
    }
    if (!markingsImportIsCurrent(token)) return result('stale', `Import for ${coach} dropped: the markings were changed while it was running.`);
    const parsed = JSON.parse(text) as { autoMarkingRecords?: StoredMarkingRecord[] } | null;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.autoMarkingRecords === undefined || parsed.autoMarkingRecords === null) {
      return result('ambiguous', `No markings came back for ${coach}. Check the coach name.`);
    }
    if (!Array.isArray(parsed.autoMarkingRecords)) throw new Error('unexpected reply from fumbbl.com');
    const sent: unknown[] = parsed.autoMarkingRecords;
    const readable = sent.filter(readableRecord);
    const skipped = sent.length - readable.length;
    // Records came back but none can be read: that is not a blank set. Nothing changes, the coach is not recorded.
    if (sent.length > 0 && readable.length === 0) return result('unreadable', `The markings for ${coach} could not be read.`);
    const records = readable.filter(hasSubject).map((record) => {
      const site = { ...record };
      delete site.local; // a client-only tag: the site's rules are never "local"
      return site;
    });
    // Astra round 5: records came back and all were readable, but none has a skill or an injury, so there is no
    // rule to apply. That is not a blank set either (only the literally empty array is): nothing changes.
    if (sent.length > 0 && records.length === 0) return result('unreadable', `No usable markings came back for ${coach}. Nothing was changed.`);
    if (skipped > 0) {
      // PARTIAL read: each readable rule is written on its own (subject, side); nothing else is touched.
      let stores = currentMarkingStores();
      for (const record of records) stores = upsertImportedRule(stores, record);
      commitMarkingStores(normalizeMarkingStores(stores));
      settings.markingsImportCoach = coach;
      settings.markingsImportAt = Date.now();
      return result('imported', `${records.length} marking${records.length === 1 ? '' : 's'} updated from ${coach}, `
        + `${skipped} could not be read; nothing was removed.`, records.length, 0);
    }
    // A fully readable reply replaces what the last import brought in. The coach's own JSON rules ride along, unless
    // the site now has a rule for the same skills on the same side. Blank-marking rules are stored and handed to the
    // generator as written, exactly as before this branch.
    const kept = localJsonRecords(settings.markingsConfig).filter((old) => !records.some((site) => markingRecordsCollide(site, old)));
    const { next, imported, combos } = applyImportedMarkings(records, settings.skillConfig, kept);
    const stored = [...records, ...kept];
    commitMarkingStores(normalizeMarkingStores({
      markingsConfig: stored.length ? JSON.stringify({ ...parsed, autoMarkingRecords: stored }) : '',
      skillConfig: next,
    }));
    settings.markingsImportCoach = coach;
    settings.markingsImportAt = Date.now();
    if (!records.length) return result('blank', `${coach} has no skill markings on fumbbl.com. Markings from an earlier import were removed.`);
    return result('imported', `Imported ${imported} skill marking${imported === 1 ? '' : 's'} from ${coach}`
      + (combos ? ` (+${combos} combo/injury rule${combos === 1 ? '' : 's'})` : '') + '.', imported, combos);
  } catch (error) {
    if (!markingsImportIsCurrent(token)) return result('stale', `Import for ${coach} dropped: the markings were changed while it was running.`);
    return result('error', `Import failed for ${coach}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The status line only (the first-launch setup wizard shows nothing else). */
export async function importFumbblMarkings(
  coachInput: string,
  onProgress?: (status: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  return (await importFumbblMarkingsDetailed(coachInput, onProgress, fetchImpl)).status;
}
