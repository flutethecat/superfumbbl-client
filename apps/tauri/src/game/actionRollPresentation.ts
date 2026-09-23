import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { offeredReRollOptions, playerById } from './reRollDecisionProjection';
const DIE_CAUSE_BY_REPORT: Record<string, string> = {
  dodgeRoll: 'dodge',
  pickUpRoll: 'pickup',
  goForItRoll: 'gfi',
  catchRoll: 'catch',
  pickMeUp: 'pickMeUp', // owner 09-23: bb2025 ReportPickMeUp {playerId, roll, successful} — the die wears the PICK ME UP badge
  passRoll: 'pass',
  interceptionRoll: 'intercept',
  leapRoll: 'leap',
  rightStuffRoll: 'ttm',
  throwTeamMateRoll: 'ttm',
  kickTeamMateRoll: 'ttm',
  confusionRoll: 'trait', // Really Stupid / Bone Head / Take Root / Wild Animal
  standUpRoll: 'standup', // owner 2026-07-08: stand-up roll (Timmm-ber! assist folds into its modifier)
  hypnoticGazeRoll: 'gaze',
  lookIntoMyEyesRoll: 'gaze',
  bloodLustRoll: 'bloodlust', // owner 2026-07-08: vampire Bloodlust roll → 'B' die tag
  breatheFire: 'breatheFire', // owner 08-18: Breathe Fire roll rides the same surface, tagged with its skill icon
  dauntlessRoll: 'dauntless',
  reRoll: 'reroll',
  blockReRoll: 'reroll',
  extraReRoll: 'reroll',
};
const DIE_CAUSE_BY_ROLL_MODIFIER: readonly [prefix: string, cause: string][] = [
  ['Break Tackle', 'breakTackle'],
];
function dieCauseFromRollModifiers(modifiers: unknown): string | undefined {
  if (!Array.isArray(modifiers)) return undefined;
  for (const modifier of modifiers) {
    if (typeof modifier !== 'string') continue;
    const match = DIE_CAUSE_BY_ROLL_MODIFIER.find(([prefix]) => modifier.startsWith(prefix));
    if (match) return match[1];
  }
  return undefined;
}

/** Owner 09-14: the server sends NO skillUse report for Break Tackle (bb2025 StepMoveDodge only marks it used);
 *  the evidence is the dodgeRoll's Break Tackle modifier, which upstream strips again whenever the dodge would have
 *  passed without it — so its presence on a SUCCESSFUL dodge means the skill genuinely carried the roll. */
export function dodgeUsedBreakTackle(report: Readonly<Record<string, unknown>>): boolean {
  return String(report.reportId) === 'dodgeRoll' && report.successful === true
    && dieCauseFromRollModifiers(report.rollModifiers) === 'breakTackle';
}

export interface ActionDieCue { square: [number, number]; value: number; cause?: string; failed?: boolean; needed?: number; rerollSkill?: string; rerollTeam?: boolean; opponentRerollPending?: boolean }
export interface ActionRollCue {
  reRolled: boolean;
  die: ActionDieCue | null;
  modal: { playerId: string; square: [number, number]; kind: 'pass' | 'catch'; roll: number; needed?: number; ok: boolean; reRolled: boolean } | null;
  trait: { playerId: string; trait: string; successful: boolean; roll: number; needed?: number; hasTarget?: boolean } | null;
}
/** Shared report interpretation. Scheduling and UI publication remain with the active reader. */
export function actionRollPresentation(report: Record<string, unknown>, reports: readonly Record<string, unknown>[],
  game: GameJson, coordinate: readonly number[] | null | undefined, passiveViewer: boolean,
  reroll: { raw: string; isTeam: boolean } | null): ActionRollCue | null {
  if (typeof report.playerId !== 'string' || typeof report.roll !== 'number' || !Number.isInteger(report.roll) || report.roll < 1 || report.roll > 6) return null;
  const playerId = report.playerId, roll = report.roll, id = String(report.reportId);
  const failed = report.successful === false, reRolled = report.reRolled === true;
  const neededRaw = Number(report.minimumRoll);
  const needed = Number.isFinite(neededRaw) && neededRaw >= 2 && neededRaw <= 6 ? neededRaw : undefined;
  const modifierCause = id === 'dodgeRoll' ? dieCauseFromRollModifiers(report.rollModifiers)
    : id === 'standUpRoll' && typeof report.modifier === 'number' && report.modifier > 0 ? 'timmber' : undefined;
  // Owner 09-09: a confusion roll's die tag wears ITS negatrait's icon (`trait:<skill>`) instead of one shared icon.
  const confusionSkill = id === 'confusionRoll' ? String(report.confusionSkill ?? '').trim() : '';
  const cause = reRolled ? 'reroll' : modifierCause ?? (confusionSkill ? `trait:${confusionSkill}` : DIE_CAUSE_BY_REPORT[id]);
  const result: ActionRollCue = { reRolled, die: null, modal: null, trait: null };
  if (id === 'confusionRoll') {
    const trait = String(report.confusionSkill ?? '');
    const sibling = failed && trait === 'Animal Savagery' ? reports.find((r) => r.reportId === 'animalSavagery' && String(r.attackerId ?? '') === playerId) : null;
    result.trait = { playerId, trait, successful: !failed, roll, needed,
      hasTarget: sibling ? typeof sibling.defenderId === 'string' : undefined };
  }
  if (id === 'bloodLustRoll' && failed) result.trait = { playerId, trait: 'Blood Lust', successful: false, roll, needed };
  if (!coordinate || !(coordinate[0]! >= 0 && coordinate[0]! < 26 && coordinate[1]! >= 0 && coordinate[1]! < 15)) return result;
  const square: [number, number] = [coordinate[0]!, coordinate[1]!];
  if (id === 'passRoll' || id === 'catchRoll') {
    result.modal = { playerId, square, kind: id === 'passRoll' ? 'pass' : 'catch', roll, needed, ok: !failed, reRolled };
    return result;
  }
  const dialog = game.dialogParameter as Record<string, unknown> | null | undefined;
  const dialogId = String(dialog?.dialogId ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  result.die = { square, value: roll, cause, failed, needed,
    rerollSkill: reRolled && reroll ? reroll.raw : undefined, rerollTeam: reRolled && reroll ? reroll.isTeam : undefined };
  if (failed && passiveViewer && dialogId.includes('reroll') && String(dialog?.playerId ?? '') === playerId
    && offeredReRollOptions(dialog ?? {}, playerById(game, playerId)?.skillDisplayValuesMap).length > 0) result.die.opponentRerollPending = true;
  return result;
}
