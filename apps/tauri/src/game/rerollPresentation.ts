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
  const isProSource = (value: unknown) => /^Pro\b/i.test(prettySkillName(String(value ?? '')));
  const isReroll = (r: Record<string, unknown>) => (r.reportId === 'reRoll' || r.reportId === 'blockReRoll') && r.reRollSource != null;
  const isPro = isProSource(raw);
  // Owner 10-10: Pro with a fallback (sources Pro TRR / Pro Mascot / Pro Mascot TRR, bb2025 RollMechanic.useReRoll
  // :319-361) reports the Pro roll, the fallback it spent, then the Pro roll AGAIN in one frame. The frame's Pro
  // outcome is its LAST Pro report: a first failure the fallback rescued is not a failed Pro.
  const proReports = isPro ? reports.filter((r) => isReroll(r) && String(r.playerId ?? '') === pid && isProSource(r.reRollSource)) : [];
  const finalPro = proReports[proReports.length - 1] ?? report;
  // The fallback is whatever the server reported BETWEEN this player's first and last Pro roll.
  const between = proReports.length > 1 ? reports.slice(reports.indexOf(report) + 1, reports.indexOf(finalPro)) : [];
  const proSucceeded = isPro && finalPro.successful === true;
  const proFailed = isPro && finalPro.successful === false;
  const proRescued = proSucceeded && proReports.length > 1 && report.successful === false;
  // What the server reported between the two Pro rolls: a team-reroll family report (Team ReRoll, Leader, Brilliant
  // Coaching...) or, with none, a successful mascotUsed. Unknown stays unnamed.
  const fallback = proRescued ? between.find((r) => isReroll(r) && String(r.playerId ?? '') === pid && !isProSource(r.reRollSource) && normalized(r.reRollSource) !== 'loner') : undefined;
  const proRescuedBy = !proRescued ? null
    : fallback ? (normalized(fallback.reRollSource).includes('teamreroll') ? 'a team reroll' : prettySkillName(String(fallback.reRollSource)))
      : between.some((r) => r.reportId === 'mascotUsed' && r.successful === true) ? 'the Team Mascot' : '';
  const roll = Number(report.roll);
  return { pid, raw, isTeam, source: isTeam ? 'a team reroll' : prettySkillName(raw), proSucceeded, proFailed,
    /** null = not a rescued Pro; '' = rescued, fallback not named by the frame; else the fallback's display name. */
    proRescuedBy,
    skill: proSucceeded ? 'Pro' : isPro ? null : reportedAutomaticRerollSkill(report),
    isBlockReroll: report.reportId === 'blockReRoll' || reports.some((r) => r.reportId === 'blockRoll'),
    lonerFailed: isTeam && report.successful === false && Number.isInteger(roll) && roll > 0 };
}
