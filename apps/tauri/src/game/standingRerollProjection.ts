import { ModelChangeId } from '@fumbbl40k/ffb-protocol';

type StandingRerollField = 'rerollPumpUpTheCrowdOneDrive' | 'rerollShowStarOneDrive' | 'singleUseReRolls';
export type ReplayedStandingRerolls = Record<'home' | 'away', Partial<Record<StandingRerollField, number>>>;

function normalizedWireName(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

/** Fold only the standing re-roll setters needed to repair an upstream TurnData snapshot.
 *  Star's upstream setter currently publishes the Pump model-change id, so its paired
 *  report identifies which field the model-change value belongs to. The value itself
 *  always comes from the model change, never from report text or client arithmetic. */
export function inferStandingRerollsFromReplay(commands: readonly Record<string, unknown>[]): ReplayedStandingRerolls {
  const result: ReplayedStandingRerolls = { home: {}, away: {} };
  for (const command of commands) {
    const changes = (command.modelChangeList as {
      modelChangeArray?: { modelChangeId?: unknown; modelChangeKey?: unknown; modelChangeValue?: unknown }[];
    } | undefined)?.modelChangeArray ?? [];
    if (changes.length === 0) continue;
    const reports = (command.reportList as { reports?: Record<string, unknown>[] } | undefined)?.reports ?? [];
    const reportIds = new Set(reports.map((report) => normalizedWireName(report.reportId)));
    const reRollSources = new Set(reports
      .filter((report) => normalizedWireName(report.reportId) === 'reroll')
      .map((report) => normalizedWireName(report.reRollSource)));
    const starFrame = reportIds.has('showstarreroll') || reportIds.has('showstarrerolllost')
      || reRollSources.has('staroftheshow');
    const pumpFrame = reportIds.has('pumpupthecrowdreroll') || reportIds.has('pumpupthecrowdrerolllost')
      || reRollSources.has('pumpupthecrowd');

    for (const change of changes) {
      const side = change.modelChangeKey === 'home' ? 'home' : change.modelChangeKey === 'away' ? 'away' : null;
      const value = change.modelChangeValue;
      if (!side || typeof value !== 'number' || !Number.isInteger(value) || value < 0) continue;
      switch (change.modelChangeId) {
        case ModelChangeId.TURN_DATA_SET_RE_ROLLS_SHOW_STAR_ONE_DRIVE:
          result[side].rerollShowStarOneDrive = value;
          break;
        case ModelChangeId.TURN_DATA_SET_RE_ROLLS_SINGLE_USE:
          result[side].singleUseReRolls = value;
          break;
        case ModelChangeId.TURN_DATA_SET_RE_ROLLS_PUMP_UP_THE_CROWD_ONE_DRIVE:
          // Upstream TurnData.setReRollShowStarOneDrive emits this literal Pump id.
          // A drive-expiry frame can clear both pools together, in which case both
          // paired loss reports are present and the model-change values are zero.
          if (starFrame) result[side].rerollShowStarOneDrive = value;
          if (pumpFrame || !starFrame) result[side].rerollPumpUpTheCrowdOneDrive = value;
          break;
      }
    }
  }
  return result;
}
