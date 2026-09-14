import { prettySkillName } from './logic/prettySkillName';
const normalized = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
export function reportedAutomaticRerollSkill(report: Record<string, unknown>): string | null {
  return normalized(report.reportId) === 'reroll' && normalized(report.reRollSource) === 'blindrage' ? 'Blind Rage' : null;
}
/** Classify only server-reported grants and failures; never infer an outcome from team resources. */
export function rerollPresentation(reports: readonly Record<string, unknown>[]) {
  const report = reports.find((r) => (r.reportId === 'reRoll' || r.reportId === 'blockReRoll') && r.reRollSource != null);
  const pid = report ? String(report.playerId ?? '') : '';
  if (!report || !pid) return null;
  const raw = String(report.reRollSource);
  const isTeam = normalized(raw).includes('teamreroll');
  const isPro = /^Pro\b/i.test(prettySkillName(raw));
  const proSucceeded = isPro && report.successful === true;
  const proFailed = isPro && report.successful === false;
  const roll = Number(report.roll);
  return { pid, raw, isTeam, source: isTeam ? 'a team reroll' : prettySkillName(raw), proSucceeded, proFailed,
    skill: proSucceeded ? 'Pro' : isPro ? null : reportedAutomaticRerollSkill(report),
    isBlockReroll: report.reportId === 'blockReRoll' || reports.some((r) => r.reportId === 'blockRoll'),
    lonerFailed: isTeam && report.successful === false && Number.isInteger(roll) && roll > 0 };
}
