import { NetCommandId, decodePlayerSkills, normalizeSkillName, playerHasSkill, type GameJson, type PositionSkillValues } from '@fumbbl40k/ffb-protocol';
import { prettySkillName } from './logic/prettySkillName';
import { starRuleById } from './logic/coachActionDispatch';
import type { PassReRollResult, ServerPassRollTruth } from './actionRollProjection';
import { actionRollFor, type ActionRollProjection } from './actionRollProjection';
import { d6RerollNeeded, d6RerollRoll } from './d6Log';
import { playerName } from './reportFormatter';
import { adjacentSavageryTargetIds, dodgeSkillCancelledAt, normSquare, skillMarkedUsed } from './logic/availableActions';
import { jumpKindFor } from './logActionPlates';
import type { ObservedMovementOccurrence } from './movementOccurrenceProjection';
import { t, terms, data } from '../i18n';
import { serverExplanationLines } from './serverExplanation';
const PRIMAL_SAVAGERY_SKILL = starRuleById('primalSavagery')?.upstreamSkill ?? 'Primal Savagery';
const normSkill = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

export interface ReRollDecisionProjection extends ReRollPromptPresentation {
  playerId: string;
  reRolledAction: string;
  label: string;
  lonerValue?: string;
  options: ReRollPromptOption[];
  /** S36: set (to `reRollModifierChoice`) only for that dialog; omitted for every older re-roll dialog. */
  dialogId?: string;
  /** S36: the dialog's `modifierCombinations`, information only (never clickable). Omitted when empty. */
  combinations?: ModifierChoiceCombination[];
}

/** Complete card content, independent of sequence counters, send authority and presentation timers. */
export function buildReRollDecision(game: GameJson, dialog: Record<string, unknown>, rolls: ActionRollProjection, mine = false, suppliedOptions?: ReRollPromptOption[], movement?: ObservedMovementOccurrence | null): ReRollDecisionProjection | null {
  const playerId = String(dialog.playerId ?? '');
  const player = playerById(game, playerId);
  const offered = suppliedOptions ?? offeredReRollOptions(dialog, player?.skillDisplayValuesMap);
  const modifierChoice = isReRollModifierChoice(dialog);
  // S36 / spec 3.12: on this dialog the server withholds a cancelled Dodge itself (canceledReRollSkills -> ignoreSkills).
  const options = modifierChoice ? [...offered] : withoutCancelledDodgeSkill(offered, dialog, game, movement);
  const clientWithheld = options.length < offered.length; // S18: the client emptied a card the server did offer
  if (!suppliedOptions && primalSavageryAvailable(dialog, player, game.actingPlayer as unknown as Record<string, unknown>, game)) {
    options.push({ label: PRIMAL_SAVAGERY_SKILL, source: PRIMAL_SAVAGERY_SKILL, response: 'primal-savagery', role: 'modifier' });
  }
  if (!options.length && !clientWithheld) return null; // a client-withheld card stays up (empty) for the coach's own decline
  const prior = actionRollFor(rolls, playerId);
  const passTruth = prior?.pass ?? undefined;
  // Owner 10-19: a Leap / Pogo Stick player's failed jump is offered as "Leap" / "Pogo Stick", not "Jump" (the wire says Jump).
  const jumpKind = jumpKindFor(game, playerId);
  const presentation = reRollPromptPresentation(dialog, passTruth, jumpKind);
  const modifier = reRollSourceName(dialog.modifyingSkill);
  const action = jumpActionName(reRollActionName(dialog.reRolledAction), jumpKind);
  const name = playerName(game, playerId);
  const label = /foul ?appearance/i.test(String(dialog.reRolledAction ?? ''))
    ? (mine ? t('dialogs.reroll.label.nameFailedTheirFoul', { name }) : t('dialogs.reroll.label.nameIsDecidingWhether', { name }))
    : modifier ? t('dialogs.reroll.short.orUse', { action: terms(action), skill: terms(prettySkillName(modifier)) }) : t('dialogs.reroll.short.plain', { action: terms(action) });
  const rulesVersion = game.gameOptions.gameOptionArray.find((o) => o.gameOptionId === 'rulesVersion')?.gameOptionValue;
  // S36 / spec 3.2: `reRollModifierChoice` carries the rolled die and the roll needed itself; they come from the dialog,
  // never from the client's roll tracking.
  const roll = modifierChoice ? d6Value(dialog.roll)
    : presentation.roll ?? d6RerollRoll(prior?.roll ?? undefined, rulesVersion, dialog.reRolledAction);
  const needed = modifierChoice ? modifierChoiceNeeded(dialog.minimumRoll)
    : passTruth ? presentation.needed : presentation.needed ?? d6RerollNeeded(dialog.minimumRoll, prior?.needed ?? undefined, rulesVersion, dialog.reRolledAction, presentation.thresholdless);
  const lonerValue = lonerValueForPlayer(game, playerId);
  // Optional fields are omitted, never undefined, so card content survives strict JSON checkpoints.
  const result: ReRollDecisionProjection = { playerId, reRolledAction: String(dialog.reRolledAction ?? ''), label, options,
    title: presentation.title, question: presentation.question, messages: presentation.messages,
    fumble: presentation.fumble, loner: presentation.loner, thresholdless: presentation.thresholdless };
  if (presentation.result !== undefined) result.result = presentation.result;
  if (roll !== undefined) result.roll = roll;
  if (needed !== undefined) result.needed = needed;
  if (lonerValue !== undefined) result.lonerValue = lonerValue;
  if (modifierChoice) {
    result.dialogId = RE_ROLL_MODIFIER_CHOICE_DIALOG;
    const combinations = modifierChoiceCombinations(dialog);
    if (combinations.length) result.combinations = combinations;
  }
  return result;
}

/** S36 Sol r1 #4: the server sends any integer >= 2 (bb2025 AgilityMechanic has no upper bound); shown as sent. */
function modifierChoiceNeeded(value: unknown): number | undefined {
  const n = Number(value);
  return value != null && Number.isInteger(n) && n >= 2 ? n : undefined;
}

function d6Value(value: unknown): number | undefined {
  const n = Number(value);
  return value != null && Number.isInteger(n) && n >= 1 && n <= 6 ? n : undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// S36 (STAGED): BB2025 `reRollModifierChoice` (upstream master e7f9858a1, DialogReRollModifierChoiceParameter /
// ModifierChoiceOption / ClientCommandReRollModifierChoice). The dialog is the re-roll prompt of every BB2025 Agility
// Test (dodge, pick up, jump, jump up, catch, interception, landing) plus optional modifier skills (Break Tackle,
// Consummate Professional, Swift As The Breeze). The server accepts a modifier answer ONLY when its skill set equals
// one offered option (OfferedSkillService.isOfferedModifierOption) - anything else is silently dropped and wedges the
// game - so the client sends exactly one RECEIVED option's skillArray, never a list of its own.
// ---------------------------------------------------------------------------------------------------------------------

export const RE_ROLL_MODIFIER_CHOICE_DIALOG = 'reRollModifierChoice';

/** One `ModifierChoiceOption` exactly as received (toJsonValue keys: skillArray, modifier, minimumRoll, name). */
export interface ModifierChoiceWireOption {
  skillArray: string[];
  modifier: number;
  minimumRoll: number;
  name: string;
}

export interface ModifierChoiceCombination {
  label: string;
  minimumRoll: number;
}

export function isReRollModifierChoice(dp: Record<string, unknown> | null | undefined): boolean {
  return String(dp?.dialogId ?? '') === RE_ROLL_MODIFIER_CHOICE_DIALOG;
}

/** The received options of `key`; `null` when the field is present but not the upstream shape (an unrecognised offer,
 *  never guessed at). A missing field is an empty list (upstream initFrom tolerates a null array). */
export function modifierChoiceWireOptions(
  dp: Record<string, unknown>,
  key: 'modifierOptions' | 'modifierCombinations',
): ModifierChoiceWireOption[] | null {
  const raw = dp[key];
  if (raw == null) return [];
  if (!Array.isArray(raw)) return null;
  const options: ModifierChoiceWireOption[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const option = entry as Record<string, unknown>;
    const skills = option.skillArray;
    if (!Array.isArray(skills) || skills.length === 0 || skills.some((skill) => typeof skill !== 'string' || !skill)) return null;
    const minimumRoll = Number(option.minimumRoll);
    if (option.minimumRoll == null || !Number.isFinite(minimumRoll)) return null;
    options.push({
      skillArray: [...(skills as string[])],
      modifier: Number(option.modifier ?? 0),
      minimumRoll,
      name: typeof option.name === 'string' ? option.name : (skills as string[]).join(' + '),
    });
  }
  return options;
}

function modifierChoiceLabel(option: ModifierChoiceWireOption): string {
  // The server's own label is the skill names joined with " + "; the names are game terms (identity in English).
  return option.skillArray.map((skill) => terms(skill)).join(' + ');
}

/** The dialog's actionable options as card buttons, in received order. `source` is a card-local key (the button
 *  identity); the wire payload is the option's own `skillArray`. */
export function modifierChoiceOptions(dp: Record<string, unknown>): ReRollPromptOption[] {
  if (!isReRollModifierChoice(dp)) return [];
  return (modifierChoiceWireOptions(dp, 'modifierOptions') ?? []).map((option, index) => ({
    label: modifierChoiceLabel(option),
    source: `modifierOption:${index}`,
    response: 'modifier-choice' as const,
    role: 'modifier' as const,
    skillArray: [...option.skillArray],
    minimumRoll: option.minimumRoll,
  }));
}

export function modifierChoiceCombinations(dp: Record<string, unknown>): ModifierChoiceCombination[] {
  if (!isReRollModifierChoice(dp)) return [];
  return (modifierChoiceWireOptions(dp, 'modifierCombinations') ?? [])
    .map((option) => ({ label: modifierChoiceLabel(option), minimumRoll: option.minimumRoll }));
}

/** The received option whose `skillArray` is EXACTLY `skillArray` (same names, same order), or null. */
export function receivedModifierOption(
  dp: Record<string, unknown> | null | undefined,
  skillArray: readonly string[] | null | undefined,
): ModifierChoiceWireOption | null {
  if (!dp || !isReRollModifierChoice(dp) || !skillArray?.length) return null;
  const options = modifierChoiceWireOptions(dp, 'modifierOptions') ?? [];
  return options.find((option) => option.skillArray.length === skillArray.length
    && option.skillArray.every((skill, index) => skill === skillArray[index])) ?? null;
}

/** ClientCommandReRollModifierChoice.toJsonValue key order: netCommandId, playerId, skillArray, reRolledAction. */
export function buildReRollModifierChoiceCommand(
  playerId: string,
  skillArray: readonly string[],
  reRolledAction: string,
): Record<string, unknown> {
  return {
    netCommandId: NetCommandId.CLIENT_RE_ROLL_MODIFIER_CHOICE,
    playerId,
    skillArray: [...skillArray],
    reRolledAction,
  };
}

export const RE_ROLL_RESPONSES = ['reroll', 'skill', 'primal-savagery', 'modifier-choice'] as const;
export const RE_ROLL_OPTION_ROLES = ['source', 'reroll-skill', 'modifier'] as const;
export interface ReRollPromptOption {
  label: string;
  source: string;
  response: (typeof RE_ROLL_RESPONSES)[number];
  role: (typeof RE_ROLL_OPTION_ROLES)[number];
  /** S36 `modifier-choice` only: the received option's skills, sent verbatim. */
  skillArray?: string[];
  /** S36 `modifier-choice` only: the roll the test needs with this option applied (the option's own minimumRoll). */
  minimumRoll?: number;
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

/** The player's roster position (null for a zapped player, whose skills are his own). */
function rosterPositionOf(g: GameJson | null | undefined, player: ReturnType<typeof playerById>): PositionSkillValues | null {
  if (!g || !player || String((player as { playerKind?: unknown }).playerKind) === 'zappedPlayer') return null;
  for (const team of [g.teamHome, g.teamAway]) {
    if (!team?.playerArray?.some((p) => p.playerId === player.playerId)) continue;
    const positions = ((team as { roster?: { positionArray?: unknown[] } }).roster?.positionArray ?? []) as (PositionSkillValues & { positionId?: string })[];
    return positions.find((entry) => entry.positionId === player.positionId) ?? null;
  }
  return null;
}

/** Loner's roll for the reroll prompt - Java Player.getSkillIntValue with the ROLL evaluator (owner 11-11, Sol): the
 *  LOWEST numeric value over the base Loner (the player's own, else his roster position's: an Ogre's "3") and every
 *  temporary Loner grant; a non-numeric display value is shown as sent. */
export function lonerValueForPlayer(g: GameJson | null | undefined, playerId: string): string | undefined {
  const player = playerById(g, playerId);
  if (!player) return undefined;
  const values = decodePlayerSkills(player, rosterPositionOf(g, player))
    .filter((skill) => normalizeSkillName(skill.name) === 'loner')
    .map((skill) => String(skill.value ?? '').trim())
    .filter(Boolean);
  if (!values.length) return undefined;
  // Sol r2: a display value ("2+") carries the same number as the raw one
  const numbers = values.map((v) => /^\+?(\d+)\+?$/.exec(v)?.[1]).filter((n): n is string => n != null).map(Number);
  return numbers.length ? `${Math.min(...numbers)}+` : values[0];
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

/** Owner 10-19: the wire's "Jump" reads as the mover's own skill - "Leap" or "Pogo Stick" (logActionPlates.jumpKindFor). */
export function jumpActionName(action: string, jumpKind: 'jump' | 'leap' | 'pogo' | undefined): string {
  if (!/^jump$/i.test(action.trim()) || !jumpKind || jumpKind === 'jump') return action;
  return terms(jumpKind === 'leap' ? 'Leap' : 'Pogo Stick');
}

export function reRollPromptPresentation(
  dp: Record<string, unknown>,
  passRoll?: ServerPassRollTruth,
  jumpKind?: 'jump' | 'leap' | 'pogo',
): ReRollPromptPresentation {
  const action = jumpActionName(reRollActionName(dp.reRolledAction), jumpKind);
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
  // Owner 10-26: the shown lines go through the shared server-explanation projection (trimmed, de-duplicated, server
  // order, data()-marked English wire text), e.g. the reRollModifierChoice Diving Tackle look-ahead line. The card has
  // no explanatory copy of its own for these: its Loner line renders the server's LONER re-roll property (a different
  // subject, drawn by the Java client next to the server messages too), so it stays.
  const messages = serverExplanationLines(rawMessages.filter(
    (message) => !/^\s*you need a:?\s*$/i.test(message)
      && !/^\s*[•·\-*]?\s*\d\+?\s+to\s+/i.test(message)
      // The TTM result and Superb threshold are already rendered above the offer. This crossed-out server
      // explainer sat between Needed and the Loner warning and duplicated that result without adding a choice.
      && !(passTruth?.reportId === 'throwTeamMateRoll' && /has no effect on a superb result/i.test(message))
      // The result/Needed rows and the question already convey this entire sentence. Keep it in rawMessages for
      // ttmSuperbTarget above, but do not repeat it in the dialog body.
      && !(passTruth?.reportId === 'throwTeamMateRoll' && /^\s*this is an?\s+(?:subpar|superb)\s+result\b/i.test(message)),
  ));
  const modifier = reRollSourceName(dp.modifyingSkill);
  const failed = hasExplicitMinimum && minimumRollRaw > 0;
  // Owner 08-18 (B&C screenshot): the Ball & Chain DIRECTION re-roll offer (ReRolledActions.DIRECTION,
  // StepMoveBallAndChain) is the one prompt that MUST stay small — it sits on the acting square with the
  // scatter destination and the direction arrow right underneath it. The generic sentence ("Do you want to
  // re-roll the Direction?") only restates the title line above it, so collapse it to one compact line.
  // Exact-match the raw wire action so `Punt Direction` (a different, unaffected offer) is not caught.
  const isBncDirection = String(dp.reRolledAction ?? '').trim() === 'Direction';
  const question = isBncDirection
    ? t('dialogs.reroll.question.rerollDirection')
    // i18n (Astra r1 #8): four whole questions; the action and skill are game terms in the active locale.
    : isReRollModifierChoice(dp) && Array.isArray(dp.modifierOptions) && dp.modifierOptions.length > 0
      ? t('dialogs.reroll.question.failedSkillOrReroll', { action: terms(action) })
    : modifier
      ? t(failed ? 'dialogs.reroll.question.failedOrUse' : 'dialogs.reroll.question.orUse', { action: terms(action), skill: terms(prettySkillName(modifier)) })
      : t(failed ? 'dialogs.reroll.question.failed' : 'dialogs.reroll.question.plain', { action: terms(action) });
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
  // S36: a `reRollModifierChoice` dialog's modifier options come first, in received order (spec 3.3).
  const options: ReRollPromptOption[] = modifierChoiceOptions(dp);
  const singleUse = singleUseReRollName(dp);
  const skillName = reRollSkillName(dp);
  const modifyingSkill = reRollSourceName(dp.modifyingSkill);
  const rrProps = Array.isArray(dp.reRollProperties) ? (dp.reRollProperties as unknown[]).map(String) : [];
  const hasPro = rrProps.includes('PRO') || !!dp.proReRollOption;
  const hasMascot = rrProps.includes('MASCOT');
  const specialTeamLabel = rrProps.includes('BRILLIANT_COACHING') ? t('dialogs.reroll.specialTeamLabel.brilliantCoaching')
    : rrProps.includes('PUMP_UP_THE_CROWD') ? t('dialogs.reroll.specialTeamLabel.pumpUpTheCrowd')
      : rrProps.includes('SHOW_STAR') ? t('dialogs.reroll.specialTeamLabel.starOfTheShow')
        : null;
  // Owner 09-19 (wire g1944287 seq 295/470): the server only enters useTeamReRoll for the "Team ReRoll" source
  // (upstream bb2025 RollMechanic.useReRoll:288-314) and picks the special source itself, Brilliant Coaching
  // before TRR (findUsedTeamReRollSource:441-458). A "Brilliant Coaching ReRoll" source has no skill behind
  // it, so the server dropped the answer: no re-roll, nothing consumed, the pick-up failure stood.
  const specialTeamSource = specialTeamLabel ? data('Team ReRoll') : null; // wire value, never localised
  const hasTeam = rrProps.some((property) =>
    ['TRR', 'LONER', 'BRILLIANT_COACHING', 'PUMP_UP_THE_CROWD', 'SHOW_STAR'].includes(property))
    || !!dp.teamReRollOption;
  if (singleUse) options.push({ label: valuedSkillLabel(singleUse, skillDisplayValues), source: singleUse, response: 'reroll', role: 'source' });
  if (skillName) options.push({ label: valuedSkillLabel(skillName, skillDisplayValues), source: skillName, response: 'skill', role: 'reroll-skill' });
  if (modifyingSkill && modifyingSkill !== skillName) {
    options.push({ label: valuedSkillLabel(modifyingSkill, skillDisplayValues), source: modifyingSkill, response: 'skill', role: 'modifier' });
  }
  if (hasPro) options.push({ get label() { return t('dialogs.reroll.text.pro'); }, source: 'Pro', response: 'reroll', role: 'source' });
  for (const composite of proCompositeReRollOptions(rrProps)) {
    options.push({ ...composite, response: 'reroll', role: 'source' });
  }
  if (specialTeamLabel && specialTeamSource) {
    options.push({ label: specialTeamLabel, source: specialTeamSource, response: 'reroll', role: 'source' });
  } else if (hasMascot) {
    options.push({ get label() { return t('dialogs.reroll.text.teamMascotNoReroll'); }, source: 'Team Mascot', response: 'reroll', role: 'source' });
    if (hasTeam) options.push({ get label() { return t('dialogs.reroll.text.mascotRr'); }, source: 'Mascot TRR', response: 'reroll', role: 'source' });
  } else if (hasTeam) {
    options.push({ get label() { return t('dialogs.reroll.text.teamReroll'); }, source: 'Team ReRoll', response: 'reroll', role: 'source' });
  }
  return options;
}

export function proCompositeReRollOptions(rrProps: string[]): { label: string; source: string }[] {
  if (!rrProps.includes('PRO')) return [];
  const hasMascot = rrProps.includes('MASCOT');
  const hasTeam = rrProps.some((property) =>
    ['TRR', 'LONER', 'BRILLIANT_COACHING', 'PUMP_UP_THE_CROWD', 'SHOW_STAR'].includes(property));
  const options: { label: string; source: string }[] = [];
  if (hasTeam) options.push({ get label() { return t('dialogs.reroll.text.proThenTeamReroll'); }, source: 'Pro TRR' });
  if (hasMascot) options.push({ get label() { return t('dialogs.reroll.text.proThenTeamMascot'); }, source: 'Pro Mascot' });
  if (hasMascot && hasTeam) {
    options.push({ get label() { return t('dialogs.reroll.text.proThenTeamMascot2'); }, source: 'Pro Mascot TRR' });
  }
  return options;
}
