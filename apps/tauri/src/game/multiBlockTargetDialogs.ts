import { NetCommandId } from '@fumbbl40k/ffb-protocol';
import { reRollSourceName } from './reRollDecisionProjection';
import { composedChoiceLabel, directTeamChoices, driveBonusInfo, genericDriveBonusName, mascotChoices, proChoices } from './teamReRollComposer';
import { terms } from '../i18n';

/**
 * BB2025 Multiple Block dialogs answered per target.
 *
 * opponentBlockSelectionProperties (DialogOpponentBlockSelectionPropertiesParameter.java toJsonValue):
 *   { dialogId, blockRolls: BlockRollProperties[], playerId: <TEAM id of the defending team> }.
 *   Raised by bb2025 StepBlockRollMultiple.decideNextStep:321-326 for every roll the attacker does not choose
 *   (ownChoice false, i.e. an uphill block: :227-228). The handler answers one target per close
 *   (DialogOpponentBlockSelectionPropertiesHandler.dialogClosed: sendBlockOrReRollChoiceForTarget(target, index, null, 0));
 *   the step stores the choice (handleCommand:157-171), and decideNextStep re-raises the dialog for what is left.
 *
 * reRollForTargets (DialogReRollForTargetsParameter.java toJsonValue): keys playerIds (targets), reRolledAction,
 *   reRollAvailableFor, proReRollOption, teamReRollOption, minimumRolls {targetId: n}, playerId (acting player),
 *   skill, reRollSourceSingleUse, consummateOption. Raised by AbstractStepModifierMultipleBlock.decideNextStep:117-137
 *   (BB2025 Foul Appearance during a Multiple Block). Answer: ClientCommandUseReRollForTarget
 *   { reRolledAction, reRollSource, playerId: <target> }; the No Reroll button closes with both null
 *   (AbstractDialogForTargets.java:28-37), which the step reads as "no reroll" (handleExecuteStepHook:67-68).
 */

export interface OpponentBlockSelectionRow {
  targetId: string;
  dice: number[];
  nrOfDice: number;
}

/** The rows the defending coach still has to pick: not the attacker's own choice and not yet selected
 *  (BlockRollProperties.needsSelection = selectedIndex < 0). */
export function opponentBlockSelectionRows(dp: Record<string, unknown> | null | undefined): OpponentBlockSelectionRow[] {
  const raw = Array.isArray(dp?.blockRolls) ? (dp!.blockRolls as Record<string, unknown>[]) : [];
  return raw
    .filter((r) => r && r.isOwnChoice !== true && Number(r.selectedIndex ?? -1) < 0 && typeof r.playerId === 'string' && r.playerId)
    .map((r) => ({
      targetId: String(r.playerId),
      dice: Array.isArray(r.blockRoll) ? (r.blockRoll as unknown[]).map(Number) : [],
      nrOfDice: Number(r.nrOfDice ?? 0),
    }))
    .filter((r) => r.dice.length > 0);
}

/** The defending team the dialog addresses (the wire key is `playerId`, but it carries a TEAM id). */
export function opponentBlockSelectionTeamId(dp: Record<string, unknown> | null | undefined): string {
  return String(dp?.playerId ?? '');
}

export function buildOpponentBlockSelectionCommand(targetId: string, diceIndex: number): Record<string, unknown> {
  return {
    netCommandId: NetCommandId.CLIENT_BLOCK_OR_RE_ROLL_CHOICE_FOR_TARGET,
    playerId: targetId,
    diceIndex,
    proIndex: 0,
    reRollSource: null,
  };
}

export interface ReRollForTargetsTarget {
  targetId: string;
  minimumRoll: number | null;
}

export interface ReRollForTargetsOption {
  label: string;
  source: string;
  /** Owner 11-21: the "i" text of an answer that spends a drive bonus reroll (it reads and looks like the Team reroll). */
  info?: string;
}

/** Targets the coach may reroll against: the dialog's targets filtered by reRollAvailableFor, in the dialog's order
 *  (DialogReRollForTargets.java:63-66). */
export function reRollForTargetsTargets(dp: Record<string, unknown> | null | undefined): ReRollForTargetsTarget[] {
  const ids = Array.isArray(dp?.playerIds) ? (dp!.playerIds as unknown[]).map(String) : [];
  const available = new Set(Array.isArray(dp?.reRollAvailableFor) ? (dp!.reRollAvailableFor as unknown[]).map(String) : []);
  const mins = dp?.minimumRolls && typeof dp.minimumRolls === 'object' ? (dp.minimumRolls as Record<string, unknown>) : {};
  return ids.filter((id) => id && available.has(id)).map((targetId) => {
    const n = Number(mins[targetId]);
    return { targetId, minimumRoll: Number.isFinite(n) && mins[targetId] != null ? n : null };
  });
}

/** Skills registered upstream for ReRolledActions.SINGLE_DIE; each one's ReRollSource carries the skill's own name
 *  (ConsummateProfessional.java, HalflingLuck.java, ThinkingMansTroll.java). */
const SINGLE_DIE_SKILLS = ['Consummate Professional', 'Halfling Luck', "Thinking Man's Troll"] as const;

/**
 * The sources the server offered, in the Java dialog's button order (DialogReRollForTargets.java:89-113):
 * Team Reroll, single-use source, Pro, the single-die skill (consummateOption), the reroll skill.
 * `hasSkill` answers for the acting player (the Java dialog reads the single-die skill off that player).
 */
export function reRollForTargetsOptions(
  dp: Record<string, unknown> | null | undefined,
  hasSkill: (skill: string) => boolean,
): ReRollForTargetsOption[] {
  if (!dp) return [];
  const out: ReRollForTargetsOption[] = [];
  if (dp.teamReRollOption === true) out.push({ label: 'Team Reroll', source: 'Team ReRoll' });
  const singleUse = reRollSourceName(dp.reRollSourceSingleUse);
  if (singleUse) out.push({ label: singleUse, source: singleUse });
  if (dp.proReRollOption === true) out.push({ label: 'Pro', source: 'Pro' });
  if (dp.consummateOption === true) {
    const skill = SINGLE_DIE_SKILLS.find((name) => hasSkill(name));
    if (skill) out.push({ label: skill, source: skill });
  }
  const rrSkill = reRollSourceName(dp.skill);
  if (rrSkill && !out.some((o) => o.source === rrSkill)) out.push({ label: rrSkill, source: rrSkill });
  return out;
}

export const RE_ROLL_FOR_TARGETS_PROPERTIES = 'reRollForTargetsProperties';

/**
 * reRollForTargetsProperties (current server c66198ac4, PR #349; DialogReRollForTargetsPropertiesParameter.toJsonValue):
 * the reRollForTargets keys plus `reRollProperties` (bb2025 AbstractStepModifierMultipleBlock.createDialogParameter:23-36:
 * findTeamReRollProperties, PRO when Pro is usable, LONER for a Loner). Raised for BB2025 Dauntless and Foul Appearance
 * in a Multiple Block. Buttons per target in upstream's order (DialogReRollForTargetsProperties:76-104): the team
 * options (ReRollSourceComposer.teamReRollSources(includeMascot = true): Mascot, drive bonus, Leader, else Team
 * Re-Roll, only with TRR), Pro (PRO property), the single-use source, the single-die skill (consummateOption), the
 * reroll skill. Pro and the Mascot go through the fallback question (DialogReRollForTargetsPropertiesHandler:46-56 ->
 * AbstractReRollDialogHandler); each composed answer is its own button here. Answer: clientUseReRollForTarget
 * {reRolledAction, reRollSource, playerId: target} (sendChoice :59-62).
 */
export function reRollForTargetsPropertiesOptions(
  dp: Record<string, unknown> | null | undefined,
  hasSkill: (skill: string) => boolean,
  driveBonus: () => string = genericDriveBonusName,
): ReRollForTargetsOption[] {
  if (!dp) return [];
  const rr = Array.isArray(dp.reRollProperties) ? (dp.reRollProperties as unknown[]).map(String) : [];
  const out: ReRollForTargetsOption[] = [];
  const composed = [...mascotChoices(rr), ...directTeamChoices(rr), ...(rr.includes('PRO') ? proChoices(rr) : [])];
  for (const c of composed) {
    out.push({ get label() { return composedChoiceLabel(c, driveBonus); }, source: c.source,
      ...(c.team === 'driveBonus' ? { get info() { return driveBonusInfo(c, driveBonus)!; } } : {}) });
  }
  // The label is the skill's name in the coach's language (terms); the source stays the exact wire name.
  const named = (source: string): ReRollForTargetsOption => ({ get label() { return terms(source); }, source });
  const singleUse = reRollSourceName(dp.reRollSourceSingleUse);
  if (singleUse && !out.some((o) => o.source === singleUse)) out.push(named(singleUse));
  if (dp.consummateOption === true) {
    const skill = SINGLE_DIE_SKILLS.find((name) => hasSkill(name));
    if (skill && !out.some((o) => o.source === skill)) out.push(named(skill));
  }
  const rrSkill = reRollSourceName(dp.skill);
  if (rrSkill && !out.some((o) => o.source === rrSkill)) out.push(named(rrSkill));
  return out;
}

export function buildReRollForTargetsCommand(
  reRolledAction: string,
  reRollSource: string | null,
  targetId: string | null,
): Record<string, unknown> {
  return {
    netCommandId: NetCommandId.CLIENT_USE_RE_ROLL_FOR_TARGET,
    reRolledAction,
    reRollSource: reRollSource === null ? null : reRollSource,
    playerId: reRollSource === null ? null : targetId,
  };
}
