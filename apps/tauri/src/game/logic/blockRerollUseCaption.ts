// Owner 09-28 (Spec S8 follow-up, coordinator-simplified after Sol's re-review of 3a6e0274..c8d0594d): the
// re-roll splash already named the rule, but it rendered off the block dice panel (a `.text` toast on a fixed
// screen band, behind the still-open, higher z-index panel) — and the acting coach gets no playback hold in
// live play (`store.ts` ~5424-5430), so nothing visibly changed even though the skill was spent (g987: Lord
// Borak's Lord of Chaos, re-rolling a 5 back into a 5). The fix names the use directly ON the panel.
//
// This is the SIMPLIFIED design (die-marking was removed): the caption comes ONLY from a `blockReRoll` report
// in the SAME frame as the re-presented block dialog. `blockReRoll` is block-dice-SPECIFIC and is sent only
// when block dice were actually re-rolled — unlike the generic `reRoll` report, which can co-occur with an
// unrelated, FAILED team-reroll attempt that never touched the block dice at all (verified against both g987
// wire logs: cmd 762 carries `reRoll` Leader then `reRoll` Loner, both `successful:false`, blockRoll unchanged
// at [2,1], and NO `blockReRoll` report — captioning that frame would have named a rule that reroled nothing).
// No die index is derived or marked: it is not reliably knowable (an unchanged face is indistinguishable from
// "nothing happened" without an index the SERVER never reports), so the caption instead names the re-rolled
// RESULT — every face in the report's own `blockRoll` — which is true for the acting coach, the opponent and
// spectators alike, with no per-audience difference.

import { blockDieFaceName } from '../reportFormatter';
import { valuedSkillLabel } from '../reRollDecisionProjection';

export interface BlockRerollReport {
  playerId: string;
  source: string;
  /** The NEW face(s) the re-roll produced, verbatim from the `blockReRoll` report — 1 for Pro/Consummate/Single
   *  Block Die/Hatred, 2+ for a multi-dice source (Savage Blow). A whole-block Team Re-roll / Mascot sends no
   *  `blockReRoll` (bb2025 StepBlockRoll), so those never caption. */
  blockRoll: number[];
}

/** Finds the block-specific reroll (if any) reported in the SAME frame as a re-presented block dialog. ONLY
 *  `blockReRoll` counts (see the module comment above) — a generic `reRoll` is never enough on its own. */
export function findBlockRerollReport(reports: readonly Record<string, unknown>[]): BlockRerollReport | null {
  const report = reports.find((r) =>
    r.reportId === 'blockReRoll'
    && typeof r.reRollSource === 'string' && r.reRollSource
    && typeof r.playerId === 'string' && r.playerId
    && Array.isArray(r.blockRoll) && r.blockRoll.length > 0);
  if (!report) return null;
  return {
    playerId: String(report.playerId),
    source: String(report.reRollSource),
    blockRoll: (report.blockRoll as unknown[]).map(Number),
  };
}

/** "Team ReRoll" has no natural word-break for `valuedSkillLabel`/`prettySkillName` to split (it already
 *  contains a space before "ReRoll"), so it is special-cased to the spelling used elsewhere on this panel
 *  ("Team Re-roll"). Every other source (skill names) is already coach-facing as reported by the server. */
function prettyBlockRerollSourceName(raw: string): string {
  if (raw === 'Team ReRoll') return 'Team Reroll';
  return valuedSkillLabel(raw, undefined);
}

/** Builds the "<Player> used <Source> - new result: <faces>" caption text. An unknown player (not found on
 *  either roster — `playerName` is null) omits the name rather than printing a raw id: "<Source> used - ...". */
export function buildBlockRerollUseCaptionText(report: BlockRerollReport, playerName: string | null): string {
  const source = prettyBlockRerollSourceName(report.source);
  const faces = report.blockRoll.map(blockDieFaceName).join(', ');
  const who = playerName ? `${playerName} used ${source}` : `${source} used`;
  return `${who} - new result: ${faces}`;
}
