import { playerHasSkill, type GameJson } from '@fumbbl40k/ffb-protocol';
import { prettySkillName } from './logic/prettySkillName';
import { starRuleById } from './logic/coachActionDispatch';
import type { PassReRollResult, ServerPassRollTruth } from './actionRollProjection';
import { actionRollFor, type ActionRollProjection } from './actionRollProjection';
import { d6RerollNeeded, d6RerollRoll } from './d6Log';
import { playerName } from './reportFormatter';
import { adjacentSavageryTargetIds, dodgeSkillCancelledAt, normSquare, skillMarkedUsed } from './logic/availableActions';
import type { ObservedMovementOccurrence } from './movementOccurrenceProjection';
const PRIMAL_SAVAGERY_SKILL = starRuleById('primalSavagery')?.upstreamSkill ?? 'Primal Savagery';
const normSkill = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

export interface ReRollDecisionProjection extends ReRollPromptPresentation {
  playerId: string;
  reRolledAction: string;
  label: string;
  lonerValue?: string;
  options: ReRollPromptOption[];
}

/** Complete card content, independent of sequence counters, send authority and presentation timers. */
export function buildReRollDecision(game: GameJson, dialog: Record<string, unknown>, rolls: ActionRollProjection, mine = false, suppliedOptions?: ReRollPromptOption[], movement?: ObservedMovementOccurrence | null): ReRollDecisionProjection | null {
  const playerId = String(dialog.playerId ?? '');
  const player = playerById(game, playerId);
  const offered = suppliedOptions ?? offeredReRollOptions(dialog, player?.skillDisplayValuesMap);
  const options = withoutCancelledDodgeSkill(offered, dialog, game, movement);
  const clientWithheld = options.length < offered.length; // S18: the client emptied a card the server did offer
  if (!suppliedOptions && primalSavageryAvailable(dialog, player, game.actingPlayer as unknown as Record<string, unknown>, game)) {
    options.push({ label: PRIMAL_SAVAGERY_SKILL, source: PRIMAL_SAVAGERY_SKILL, response: 'primal-savagery', role: 'modifier' });
  }
  if (!options.length && !clientWithheld) return null; // a client-withheld card stays up (empty) for the coach's own decline
  const prior = actionRollFor(rolls, playerId);
  const passTruth = prior?.pass ?? undefined;
  const presentation = reRollPromptPresentation(dialog, passTruth);
  const modifier = reRollSourceName(dialog.modifyingSkill);
  const action = reRollActionName(dialog.reRolledAction);
  const name = playerName(game, playerId);
  const label = /foul ?appearance/i.test(String(dialog.reRolledAction ?? ''))
    ? (mine ? `${name} failed their Foul Appearance roll. Use a reroll?` : `${name} is deciding whether to reroll…`)
    : `Reroll ${action}${modifier ? ` or use ${prettySkillName(modifier)}` : ''}?`;
  const rulesVersion = game.gameOptions.gameOptionArray.find((o) => o.gameOptionId === 'rulesVersion')?.gameOptionValue;
  const roll = presentation.roll ?? d6RerollRoll(prior?.roll ?? undefined, rulesVersion, dialog.reRolledAction);
  const needed = passTruth ? presentation.needed : presentation.needed ?? d6RerollNeeded(dialog.minimumRoll, prior?.needed ?? undefined, rulesVersion, dialog.reRolledAction, presentation.thresholdless);
  const lonerValue = lonerValueForPlayer(game, playerId);
  // Optional fields are omitted, never undefined, so card content survives strict JSON checkpoints.
  const result: ReRollDecisionProjection = { playerId, reRolledAction: String(dialog.reRolledAction ?? ''), label, options,
    title: presentation.title, question: presentation.question, messages: presentation.messages,
    fumble: presentation.fumble, loner: presentation.loner, thresholdless: presentation.thresholdless };
  if (presentation.result !== undefined) result.result = presentation.result;
  if (roll !== undefined) result.roll = roll;
  if (needed !== undefined) result.needed = needed;
  if (lonerValue !== undefined) result.lonerValue = lonerValue;
  return result;
}

export const RE_ROLL_RESPONSES = ['reroll', 'skill', 'primal-savagery'] as const;
export const RE_ROLL_OPTION_ROLES = ['source', 'reroll-skill', 'modifier'] as const;
export interface ReRollPromptOption {
  label: string;
  source: string;
  response: (typeof RE_ROLL_RESPONSES)[number];
  role: (typeof RE_ROLL_OPTION_ROLES)[number];
}

export function skillNameWithValue(displayValue: string | undefined, skillName: string): string {
  const value = displayValue?.trim();
  return value ? `${skillName} (${value})` : skillName;
}

export function reRollSourceName(v: unknown): string | null {
  if (!v) return null;
  // ⚠ RAW — this value is also sent back as the wire `reRollSource`; prettify only at DISPLAY sites.
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'name' in v) return String((v as { name: unknown }).name);
  return null;
}

export function playerById(g: GameJson | null | undefined, playerId: string) {
  return g ? [...g.teamHome.playerArray, ...g.teamAway.playerArray].find((player) => player.playerId === playerId) : undefined;
}

export function explicitLashOutCapability(
  dp: Record<string, unknown>,
  player: ReturnType<typeof playerById>,
  actingPlayer?: Record<string, unknown> | null,
): boolean | null {
  const records = [dp, dp.actingPlayer, actingPlayer, player].filter(
    (value): value is Record<string, unknown> => typeof value === 'object' && value !== null,
  );
  for (const record of records) {
    for (const key of ['canLashOutAtEnemyPlayers', 'canLashOut', 'lashOut']) {
      if (typeof record[key] === 'boolean') return record[key];
    }
  }
  return null;
}

export function primalSavageryAvailable(
  dp: Record<string, unknown>,
  player: ReturnType<typeof playerById>,
  actingPlayer?: Record<string, unknown> | null,
  game?: GameJson | null,
): boolean {
  // Live fork wire (game 889 command 381) uses the FQ class id
  // `com.fumbbl.ffb.skill.mixed.AnimalSavagery`; older fixtures/forks use the
  // friendly `Animal Savagery`. Share the display canonicalizer so both exact
  // server-authored forms identify the same prompt without suffix guessing.
  if (normSkill(reRollActionName(dp.reRolledAction)) !== 'animalsavagery') return false;
  const explicit = explicitLashOutCapability(dp, player, actingPlayer);
  if (!(explicit ?? playerHasSkill(player, PRIMAL_SAVAGERY_SKILL))) return false;
  // Owner 09-28 (S12): the server (bb2025 AnimalSavageryBehaviour ~140-153) offers Primal Savagery only when the
  // skill is UNUSED and an opponent target is adjacent. No game state = nothing to derive it from = not offered.
  if (!game || !player) return false;
  return !skillMarkedUsed(game, player.playerId, PRIMAL_SAVAGERY_SKILL)
    && adjacentSavageryTargetIds(game, player.playerId).length > 0;
}

/** The square the dodging player left for this step, from RECEIVED frames only: the observed-movement occurrence for
 *  that player whose destination is where the model holds him now. Anything else (reconnect into the open dialog, a
 *  non-adjacent jump, a stale occurrence) is unknown - null. */
export function dodgeOriginSquare(game: GameJson, playerId: string, movement: ObservedMovementOccurrence | null | undefined): [number, number] | null {
  if (!movement || movement.playerId !== playerId) return null;
  const now = normSquare(game.fieldModel.playerDataArray.find((data) => data.playerId === playerId)?.playerCoordinate);
  return now && now[0] === movement.to[0] && now[1] === movement.to[1] ? [movement.from[0], movement.from[1]] : null;
}

/** Owner 09-28 (S18, game 992): drop the Dodge SKILL option from a Dodge re-roll when the server's own rule withholds
 *  it (an adjacent-at-origin opposing Tackle player, see `dodgeSkillCancelledAt`) though its dialog still lists it.
 *  Every other option, skill and rolled action passes through; an unknown origin leaves the card as the server sent it. */
export function withoutCancelledDodgeSkill(
  options: ReRollPromptOption[],
  dialog: Record<string, unknown>,
  game: GameJson | null | undefined,
  movement: ObservedMovementOccurrence | null | undefined,
): ReRollPromptOption[] {
  if (!game || normSkill(reRollActionName(dialog.reRolledAction)) !== 'dodge') return options;
  const isDodgeSkill = (option: ReRollPromptOption) => option.response === 'skill' && option.role === 'reroll-skill' && normSkill(option.source) === 'dodge';
  if (!options.some(isDodgeSkill)) return options;
  const playerId = String(dialog.playerId ?? '');
  const origin = dodgeOriginSquare(game, playerId, movement);
  return origin && dodgeSkillCancelledAt(game, playerId, origin) ? options.filter((option) => !isDodgeSkill(option)) : options;
}

export function valuedSkillLabel(rawSkill: string, displayValues: Record<string, unknown> | undefined): string {
  const skillName = rawSkill.includes(' ') ? rawSkill : prettySkillName(rawSkill);
  const rawValue = displayValues?.[skillName] ?? displayValues?.[rawSkill];
  const displayValue = rawValue == null ? undefined : String(rawValue);
  return skillNameWithValue(displayValue, skillName);
}

export function lonerValueForPlayer(g: GameJson | null | undefined, playerId: string): string | undefined {
  const player = playerById(g, playerId);
  const rawValue = player?.skillDisplayValuesMap?.Loner ?? player?.skillValuesMap?.Loner;
  if (rawValue == null) return undefined;
  const value = String(rawValue).trim();
  if (!value) return undefined;
  return /^\d+$/.test(value) ? `${value}+` : value;
}

export function singleUseReRollName(dp: Record<string, unknown>): string | null {
  return reRollSourceName(dp.reRollSourceSingleUse ?? dp.singleUseReRollSource);
}

export function reRollSkillName(dp: Record<string, unknown>): string | null {
  return reRollSourceName(dp.skill ?? dp.reRollSkill);
}

export interface ReRollPromptPresentation {
  title: string;
  question: string;
  result?: PassReRollResult;
  messages: string[];
  fumble: boolean;
  loner: boolean;
  roll?: number;
  needed?: number;
  thresholdless: boolean;
}

export function reRollActionName(value: unknown): string {
  // #214 class: `reRolledAction` sometimes carries a raw FQ skill id (e.g. the bomb/Pass fumble
  // wire `com.fumbbl.ffb.skill.common.Pass`) instead of the usual already-friendly label
  // ("Really Stupid", "Throw Team-Mate"); route through prettySkillName to strip it before display.
  return prettySkillName(String(value ?? 'roll'))
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ttmSuperbTarget(messages: string[]): number | undefined {
  for (const message of messages) {
    const explicit = message.match(/Re-roll needed:\s*(\d)\+/i) ?? message.match(/\((\d)\+/);
    if (explicit) return Number(explicit[1]);
    if (/Re-roll needed:\s*a natural 6/i.test(message)) return 6;
  }
  return undefined;
}

export function reRollPromptPresentation(
  dp: Record<string, unknown>,
  passRoll?: ServerPassRollTruth,
): ReRollPromptPresentation {
  const action = reRollActionName(dp.reRolledAction);
  const passTruth = passRoll?.reportId === 'throwTeamMateRoll'
    ? (/throw team.?mate|kick team.?mate/i.test(action) ? passRoll : undefined)
    : passRoll?.reportId === 'passRoll'
      ? (/pass|bomb/i.test(action) ? passRoll : undefined)
      : undefined;
  const title = passTruth?.bomb ? 'Bomb' : /^right stuff$/i.test(action) ? 'Landing' : action;
  const minimumRollRaw = Number(dp.minimumRoll);
  const hasExplicitMinimum = dp.minimumRoll != null && Number.isFinite(minimumRollRaw);
  const thresholdless = hasExplicitMinimum && minimumRollRaw <= 0;
  const dialogNeeded = hasExplicitMinimum && minimumRollRaw >= 2 && minimumRollRaw <= 6
    ? minimumRollRaw
    : undefined;
  const rawMessages = Array.isArray(dp.messageArray)
    ? (dp.messageArray as unknown[]).filter((message): message is string => typeof message === 'string')
    : [];
  // Owner 08-18 (Breathe Fire screenshot): drop the server's threshold explainer — the "You need a:"
  // header and its "• N+ to <outcome>" bullets. Consequence lines ("You would be knocked down…") and
  // the rolled value stay. Derivations (ttmSuperbTarget) read the RAW list, display reads this one.
  const messages = rawMessages.filter(
    (message) => !/^\s*you need a:?\s*$/i.test(message)
      && !/^\s*[•·\-*]?\s*\d\+?\s+to\s+/i.test(message)
      // The TTM result and Superb threshold are already rendered above the offer. This crossed-out server
      // explainer sat between Needed and the Loner warning and duplicated that result without adding a choice.
      && !(passTruth?.reportId === 'throwTeamMateRoll' && /has no effect on a superb result/i.test(message))
      // The result/Needed rows and the question already convey this entire sentence. Keep it in rawMessages for
      // ttmSuperbTarget above, but do not repeat it in the dialog body.
      && !(passTruth?.reportId === 'throwTeamMateRoll' && /^\s*this is an?\s+(?:subpar|superb)\s+result\b/i.test(message)),
  );
  const modifier = reRollSourceName(dp.modifyingSkill);
  const failed = hasExplicitMinimum && minimumRollRaw > 0;
  // Owner 08-18 (B&C screenshot): the Ball & Chain DIRECTION re-roll offer (ReRolledActions.DIRECTION,
  // StepMoveBallAndChain) is the one prompt that MUST stay small — it sits on the acting square with the
  // scatter destination and the direction arrow right underneath it. The generic sentence ("Do you want to
  // re-roll the Direction?") only restates the title line above it, so collapse it to one compact line.
  // Exact-match the raw wire action so `Punt Direction` (a different, unaffected offer) is not caught.
  const isBncDirection = String(dp.reRolledAction ?? '').trim() === 'Direction';
  const question = isBncDirection
    ? 'Reroll direction?'
    : `Do you want to reroll the ${failed ? 'failed ' : ''}${action}`
      + `${modifier ? ` or use ${prettySkillName(modifier)}` : ''}?`;
  let needed = thresholdless ? undefined : dialogNeeded;
  if (passTruth?.reportId === 'passRoll') needed = passTruth.minimumRoll;
  if (passTruth?.reportId === 'throwTeamMateRoll') needed = ttmSuperbTarget(rawMessages);
  return {
    title,
    question,
    result: passTruth?.result,
    messages,
    fumble: dp.fumble === true,
    loner: Array.isArray(dp.reRollProperties) && (dp.reRollProperties as unknown[]).map(String).includes('LONER'),
    roll: passTruth?.roll,
    needed,
    thresholdless,
  };
}

export function offeredReRollOptions(
  dp: Record<string, unknown>,
  skillDisplayValues?: Record<string, unknown>,
): ReRollPromptOption[] {
  const options: ReRollPromptOption[] = [];
  const singleUse = singleUseReRollName(dp);
  const skillName = reRollSkillName(dp);
  const modifyingSkill = reRollSourceName(dp.modifyingSkill);
  const rrProps = Array.isArray(dp.reRollProperties) ? (dp.reRollProperties as unknown[]).map(String) : [];
  const hasPro = rrProps.includes('PRO') || !!dp.proReRollOption;
  const hasMascot = rrProps.includes('MASCOT');
  const specialTeamLabel = rrProps.includes('BRILLIANT_COACHING') ? 'Brilliant Coaching'
    : rrProps.includes('PUMP_UP_THE_CROWD') ? 'Pump up the Crowd'
      : rrProps.includes('SHOW_STAR') ? 'Star of the Show'
        : null;
  // Owner 09-19 (wire g1944287 seq 295/470): the server only enters useTeamReRoll for the "Team ReRoll" source
  // (upstream bb2025 RollMechanic.useReRoll:288-314) and picks the special source itself, Brilliant Coaching
  // before TRR (findUsedTeamReRollSource:441-458). A "Brilliant Coaching ReRoll" source has no skill behind
  // it, so the server dropped the answer: no re-roll, nothing consumed, the pick-up failure stood.
  const specialTeamSource = specialTeamLabel ? 'Team ReRoll' : null;
  const hasTeam = rrProps.some((property) =>
    ['TRR', 'LONER', 'BRILLIANT_COACHING', 'PUMP_UP_THE_CROWD', 'SHOW_STAR'].includes(property))
    || !!dp.teamReRollOption;
  if (singleUse) options.push({ label: valuedSkillLabel(singleUse, skillDisplayValues), source: singleUse, response: 'reroll', role: 'source' });
  if (skillName) options.push({ label: valuedSkillLabel(skillName, skillDisplayValues), source: skillName, response: 'skill', role: 'reroll-skill' });
  if (modifyingSkill && modifyingSkill !== skillName) {
    options.push({ label: valuedSkillLabel(modifyingSkill, skillDisplayValues), source: modifyingSkill, response: 'skill', role: 'modifier' });
  }
  if (hasPro) options.push({ label: 'Pro', source: 'Pro', response: 'reroll', role: 'source' });
  for (const composite of proCompositeReRollOptions(rrProps)) {
    options.push({ ...composite, response: 'reroll', role: 'source' });
  }
  if (specialTeamLabel && specialTeamSource) {
    options.push({ label: specialTeamLabel, source: specialTeamSource, response: 'reroll', role: 'source' });
  } else if (hasMascot) {
    options.push({ label: 'Team Mascot (no reroll if it fails)', source: 'Team Mascot', response: 'reroll', role: 'source' });
    if (hasTeam) options.push({ label: 'Team Mascot, then Team Reroll', source: 'Mascot TRR', response: 'reroll', role: 'source' });
  } else if (hasTeam) {
    options.push({ label: 'Team Reroll', source: 'Team ReRoll', response: 'reroll', role: 'source' });
  }
  return options;
}

export function proCompositeReRollOptions(rrProps: string[]): { label: string; source: string }[] {
  if (!rrProps.includes('PRO')) return [];
  const hasMascot = rrProps.includes('MASCOT');
  const hasTeam = rrProps.some((property) =>
    ['TRR', 'LONER', 'BRILLIANT_COACHING', 'PUMP_UP_THE_CROWD', 'SHOW_STAR'].includes(property));
  const options: { label: string; source: string }[] = [];
  if (hasTeam) options.push({ label: 'Pro, then Team Reroll', source: 'Pro TRR' });
  if (hasMascot) options.push({ label: 'Pro, then Team Mascot', source: 'Pro Mascot' });
  if (hasMascot && hasTeam) {
    options.push({ label: 'Pro, then Team Mascot, then Team Reroll', source: 'Pro Mascot TRR' });
  }
  return options;
}
