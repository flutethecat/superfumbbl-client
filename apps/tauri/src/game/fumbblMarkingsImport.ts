import { FUMBBL_SITE, settings } from './settings';
import { applyImportedMarkings } from './skillDisplay';

/**
 * #16 (owner 08-11) / owner 09-25: import a coach's skill markings from fumbbl.com. Shared by Settings → Skills
 * ("Import markings from fumbbl.com") and the first-launch setup wizard (owner 10-06) so both run the SAME routine.
 * User-initiated only; sends nothing but the coach name in the request path. Returns the status line to show.
 *
 * ⚖ upstream-does-it: the Java client reads this same endpoint (user-initiated fetch of a coach's client options).
 * The import REPLACES what an earlier import wrote (glyph AND behaviour, gainedOnly/applyTo honoured) and retires
 * rules deleted on fumbbl.com; combo / injury rules stay in the JSON and draw from there.
 */
export async function importFumbblMarkings(
  coachInput: string,
  onProgress?: (status: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const coach = coachInput.trim();
  if (!coach) return 'Enter a coach name to import markings from.';
  onProgress?.(`Fetching markings for ${coach}…`);
  try {
    const res = await fetchImpl(`${FUMBBL_SITE}/api/clientoptions/get/${encodeURIComponent(coach)}`);
    if (!res.ok) throw new Error(`fumbbl.com returned ${res.status}`);
    const text = await res.text();
    const parsed = JSON.parse(text) as { autoMarkingRecords?: { skillArray?: string[]; marking?: string }[] };
    if (!Array.isArray(parsed.autoMarkingRecords)) throw new Error('this coach has no markings configured');
    settings.markingsConfig = JSON.stringify(parsed);
    const { next, imported, combos } = applyImportedMarkings(parsed.autoMarkingRecords, settings.skillConfig);
    settings.skillConfig = next; // one reassign → persist + re-render
    return `Imported ${imported} skill marking${imported === 1 ? '' : 's'} from ${coach}`
      + (combos ? ` (+${combos} combo/injury rule${combos === 1 ? '' : 's'} from the JSON)` : '') + '.';
  } catch (error) {
    return `Import failed for ${coach}: ${error instanceof Error ? error.message : String(error)}`;
  }
}
