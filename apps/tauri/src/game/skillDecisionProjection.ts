import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { serverPassRollTruth, type PassReRollResult } from './actionRollProjection';
import { oldProArmorDice, savageMaulingInjuryResult, type InjuryResultName } from './skillUseCardPresentation';

export interface SkillDecisionDetails {
  roll?: number;
  result?: PassReRollResult;
  needed?: number;
  injuryResult?: InjuryResultName;
  armorDice?: [number, number];
  hmpScatter?: { ordinal: number; direction: string; showNeverUse: boolean };
}
export interface SkillDecisionProjection {
  current: { occurrence: string; playerId: string; skill: string; details: SkillDecisionDetails } | null;
  lastScatter: { occurrence: string; gameId: string; playerId: string; context: NonNullable<SkillDecisionDetails['hmpScatter']> } | null;
}
export const createSkillDecisionProjection = (): SkillDecisionProjection => ({ current: null, lastScatter: null });
const normalized = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');

/** Occurrence is supplied by the ingress owner, including for identical fresh dialogs.
 * No object identities, clocks, player permissions, or send callbacks enter this state. */
export function reduceSkillDecisionProjection(
  previous: SkillDecisionProjection, game: GameJson,
  reports: readonly Record<string, unknown>[], occurrence: string,
): SkillDecisionProjection {
  const next = structuredClone(previous);
  const action = game.actingPlayer?.playerAction ?? (game as { throwerAction?: unknown }).throwerAction;
  if (normalized(action) !== 'hailmarypass') next.lastScatter = null;
  const dialog = game.dialogParameter as Record<string, unknown> | null;
  if (dialog?.dialogId !== 'skillUse') { next.current = null; return next; }
  const playerId = String(dialog.playerId ?? '');
  const skill = String(dialog.skill ?? '');
  if (next.current?.occurrence !== occurrence || next.current.playerId !== playerId || next.current.skill !== skill) {
    next.current = { occurrence, playerId, skill, details: {} };
  }
  const details = next.current.details;
  if (normalized(skill) === 'pass') {
    for (const report of reports) {
      if (report.reportId !== 'passRoll' || String(report.playerId ?? '') !== playerId) continue;
      const truth = serverPassRollTruth(report);
      if (truth) {
        details.roll = truth.roll;
        if (truth.result !== undefined) details.result = truth.result;
        if (truth.minimumRoll !== undefined) details.needed = truth.minimumRoll;
      }
    }
  }
  if (normalized(skill) === 'savagemauling') {
    const injury = savageMaulingInjuryResult(reports, playerId);
    if (injury !== undefined) details.injuryResult = injury;
  }
  const dice = oldProArmorDice(reports, playerId, skill);
  if (dice) details.armorDice = dice;
  if (normalized(skill) === 'blastit' && normalized(action) === 'hailmarypass' && typeof dialog.showNeverUse === 'boolean') {
    const gameId = String(game.gameId ?? '');
    const last = next.lastScatter;
    if (last?.occurrence === occurrence && last.gameId === gameId && last.playerId === playerId) {
      details.hmpScatter = { ...last.context };
    } else {
      const scatter = [...reports].reverse().find((r) => r.reportId === 'scatterBall');
      const direction = String(Array.isArray(scatter?.directionArray) ? scatter.directionArray.at(-1) ?? '' : '').trim();
      // A mid-pass join cannot establish the ordinal without the first scatter.
      const knownPass = last?.gameId === gameId && last?.playerId === playerId;
      if (direction && (dialog.showNeverUse || knownPass)) {
        const first = dialog.showNeverUse || last?.gameId !== gameId || last?.playerId !== playerId;
        const context = { ordinal: first ? 1 : Math.min(3, (last?.context.ordinal ?? 0) + 1), direction, showNeverUse: dialog.showNeverUse };
        next.lastScatter = { occurrence, gameId, playerId, context };
        details.hmpScatter = { ...context };
      }
    }
  }
  return next;
}
