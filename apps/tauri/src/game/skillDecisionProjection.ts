import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { serverPassRollTruth, type PassReRollResult } from './actionRollProjection';
import { oldProArmorDice, savageMaulingInjuryResult, type InjuryResultName } from './skillUseCardPresentation';
import { reduceHmpScatterTrail, type HmpScatterTrail } from './hmpScatterTrail';

export interface SkillDecisionDetails {
  roll?: number;
  result?: PassReRollResult;
  needed?: number;
  injuryResult?: InjuryResultName;
  armorDice?: [number, number];
  /** S40: the dialog's second, modifying skill (RAW, sent back as the wire skill) and the server's modifiedPassResult for it. */
  modifyingSkill?: string;
  modifiedResult?: PassReRollResult;
  hmpScatter?: { ordinal: number; direction: string; showNeverUse: boolean };
}
/** Owner 09-15: skills whose USE hands the same coach a follow-up choice on the pitch (Side Step: the push square).
 *  The passive card persists through that choice as "<Coach> is using <Skill>"; instant-resolving skills clear. */
const FOLLOWUP_SKILLS = new Set(['sidestep']);
export function skillUseHasFollowup(skill: unknown): boolean { return FOLLOWUP_SKILLS.has(normalized(skill)); }
/** The follow-up choice is still open while the server keeps push-back squares on the field model. */
export function skillUseFollowupPending(game: GameJson): boolean {
  return ((game.fieldModel?.pushbackSquareArray ?? []) as unknown[]).length > 0;
}
export interface SkillDecisionProjection {
  current: { occurrence: string; playerId: string; skill: string; details: SkillDecisionDetails; using?: boolean } | null;
  lastScatter: { occurrence: string; gameId: string; playerId: string; context: NonNullable<SkillDecisionDetails['hmpScatter']> } | null;
  /** Owner 09-28 (S16): the Hail Mary scatter squares for the pitch marks, folded from the same frames. */
  hmpTrail: HmpScatterTrail | null;
}
export const createSkillDecisionProjection = (): SkillDecisionProjection => ({ current: null, lastScatter: null, hmpTrail: null });
/** The server's own pass-result enum names; anything else (absent, unknown) yields no result line. */
const SERVER_PASS_RESULT_LABELS: Record<string, PassReRollResult> = {
  ACCURATE: 'Accurate', INACCURATE: 'Inaccurate', WILDLY_INACCURATE: 'Wildly Inaccurate', FUMBLE: 'Fumble',
};
const normalized = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');

/** Occurrence is supplied by the ingress owner, including for identical fresh dialogs.
 * No object identities, clocks, player permissions, or send callbacks enter this state. */
export function reduceSkillDecisionProjection(
  previous: SkillDecisionProjection, game: GameJson,
  reports: readonly Record<string, unknown>[], occurrence: string,
): SkillDecisionProjection {
  const next = structuredClone(previous);
  next.hmpTrail = reduceHmpScatterTrail(previous.hmpTrail ?? null, game, reports);
  const action = game.actingPlayer?.playerAction ?? (game as { throwerAction?: unknown }).throwerAction;
  if (normalized(action) !== 'hailmarypass') next.lastScatter = null;
  const dialog = game.dialogParameter as Record<string, unknown> | null;
  if (dialog?.dialogId !== 'skillUse') {
    // Owner 09-15: a follow-up skill just USED keeps its card ("is using") while the push square is still open.
    const cur = next.current;
    if (cur && skillUseHasFollowup(cur.skill) && skillUseFollowupPending(game)) {
      const usedNow = reports.some((r) => r.reportId === 'skillUse' && String(r.playerId ?? '') === cur.playerId
        && normalized(r.skill) === normalized(cur.skill) && (r as { used?: unknown }).used !== false);
      if (cur.using || usedNow) { next.current = { ...cur, using: true }; return next; }
    }
    next.current = null; return next;
  }
  const playerId = String(dialog.playerId ?? '');
  const skill = String(dialog.skill ?? '');
  let opened = false;
  if (next.current?.occurrence !== occurrence || next.current.playerId !== playerId || next.current.skill !== skill) {
    next.current = { occurrence, playerId, skill, details: {} };
    opened = true;
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
  // S40: a skillUse dialog that names a modifying skill (official DialogSkillUse three-way choice). The
  // modifiedPassResult report must ride the frame that OPENED this dialog instance; the server's word only.
  // Wire shape as the re-roll dialog reads it (reRollSourceName): a plain name or a `{name}` object.
  const rawModifier = dialog.modifyingSkill;
  const modifier = typeof rawModifier === 'string' ? rawModifier
    : rawModifier && typeof rawModifier === 'object' && 'name' in rawModifier ? String((rawModifier as { name: unknown }).name) : '';
  if (modifier && normalized(modifier) !== normalized(skill)) {
    details.modifyingSkill = modifier;
    if (opened) {
      for (const report of reports) {
        if (report.reportId !== 'modifiedPassResult' || normalized(report.skill) !== normalized(modifier)) continue;
        const result = SERVER_PASS_RESULT_LABELS[String(report.passResult ?? '')];
        if (result !== undefined) details.modifiedResult = result;
      }
    }
  } else { delete details.modifyingSkill; delete details.modifiedResult; }
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
