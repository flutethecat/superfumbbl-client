import type { BlockContextProjection } from './blockDecisionProjection';

export interface SkillUseCue {
  playerId: string; skill: string; square: [number, number]; name: string;
  toast?: string; anchored?: boolean; declined?: boolean;
}
/** Report-owned transient cue; never mutates the model or resolves a decision. */
export function skillUsePresentation(report: Readonly<Record<string, unknown>>, coordinate: readonly number[] | null | undefined,
  block: BlockContextProjection, name: string): SkillUseCue | null {
  if (report.reportId !== 'skillUse' || typeof report.playerId !== 'string' || typeof report.skill !== 'string') return null;
  const declined = report.used === false;
  if (declined && report.skill.toLowerCase().replace(/[^a-z]/g, '') !== 'standfirm') return null;
  if (!coordinate || !(coordinate[0]! >= 0 && coordinate[0]! < 26 && coordinate[1]! >= 0 && coordinate[1]! < 15)) return null;
  const anchored = report.playerId === block.defenderId && !!block.defenderSquare;
  const square: [number, number] = anchored ? [...block.defenderSquare!] : [coordinate[0]!, coordinate[1]!];
  const cancelled = /^cancel([A-Z].*)$/.exec(String(report.skillUse ?? ''))?.[1];
  const toast = cancelled ? report.skill + ' cancels ' + cancelled.replace(/([a-z])([A-Z])/g, '$1 $2') + '!' : undefined;
  return declined ? { playerId: report.playerId, skill: report.skill, square, anchored, declined: true, name }
    : { playerId: report.playerId, skill: report.skill, square, anchored, toast, name };
}
