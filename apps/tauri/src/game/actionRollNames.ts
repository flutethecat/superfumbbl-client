/**
 * Owner 11-04 / 11-19: the ACTION ROLL kinds as people read them - their group (Movement, Ball handling, Negative traits,
 * Other) and their name. Shared by the Coach Stats "Action rolls" pop-out (coachStats.ts / CoachStatsPanel.vue) and the
 * end-of-game Dice pane's "Action rolls" sub-pane (postGameProjection.ts pgActionRolls / PostGamePanel.vue), so the two
 * analyzers name, group and order the kinds the same way. A kind is the server report id (`leapRoll:leap` = a jump made
 * with Leap / Pogo; see diceStats.ts jumpKind).
 */
import { t, terms } from '../i18n';

export type ActionRollGroup = 'movement' | 'ballHandling' | 'specialActions' | 'negativeTraits' | 'other';
export const ACTION_ROLL_GROUPS: readonly ActionRollGroup[] = ['movement', 'ballHandling', 'specialActions', 'negativeTraits', 'other'];

/** The group of each roll kind. Anything not listed is "other". Review 11-19: the rolls of a declared SPECIAL ACTION (the
 *  rulebook's term: Hypnotic Gaze, Breathe Fire, Projectile Vomit, Chainsaw) have their own group. */
const ACTION_ROLL_GROUP: Record<string, ActionRollGroup> = {
  dodgeRoll: 'movement', goForItRoll: 'movement', leapRoll: 'movement', 'leapRoll:leap': 'movement', jumpRoll: 'movement',
  standUpRoll: 'movement', jumpUpRoll: 'movement',
  hypnoticGazeRoll: 'specialActions', breatheFire: 'specialActions', projectileVomit: 'specialActions', chainsawRoll: 'specialActions',
  pickUpRoll: 'ballHandling', catchRoll: 'ballHandling', passRoll: 'ballHandling', interceptionRoll: 'ballHandling',
  throwTeamMateRoll: 'ballHandling', rightStuffRoll: 'ballHandling', safeThrowRoll: 'ballHandling', kickTeamMateRoll: 'ballHandling',
  foulAppearanceRoll: 'negativeTraits', reallyStupidRoll: 'negativeTraits', bloodLustRoll: 'negativeTraits', boneHeadRoll: 'negativeTraits',
  wildAnimalRoll: 'negativeTraits', animalSavageryRoll: 'negativeTraits', takeRootRoll: 'negativeTraits', unchannelledFuryRoll: 'negativeTraits',
  confusionRoll: 'negativeTraits', alwaysHungryRoll: 'negativeTraits', escapeRoll: 'negativeTraits', animosityRoll: 'negativeTraits',
};
export function actionRollGroup(kind: string): ActionRollGroup { return ACTION_ROLL_GROUP[kind] ?? 'other'; }

/** The i18n key of each group's heading. */
export const ACTION_ROLL_GROUP_LABEL: Record<ActionRollGroup, string> = {
  movement: 'coachStats.actionRolls.group.movement', ballHandling: 'coachStats.actionRolls.group.ballHandling',
  specialActions: 'coachStats.actionRolls.group.specialActions',
  negativeTraits: 'coachStats.actionRolls.group.negativeTraits', other: 'coachStats.actionRolls.group.other',
};

/** Our own label keys for the roll kinds the game terms do not name. */
const ROLL_KEY: Record<string, string> = {
  goForItRoll: 'coachStats.roll.rush', leapRoll: 'coachStats.roll.jump', jumpRoll: 'coachStats.roll.jump', standUpRoll: 'coachStats.roll.standUp',
  pickUpRoll: 'coachStats.roll.pickUp', throwTeamMateRoll: 'coachStats.roll.throwTeamMate', wildAnimalRoll: 'coachStats.roll.wildAnimal',
  escapeRoll: 'coachStats.roll.escape', confusionRoll: 'coachStats.roll.confusion', gettingEvenRoll: 'coachStats.roll.gettingEven',
};
/** The rulebook's skill names (the game-terms translations, terms()) for the rest. */
const ROLL_TERM: Record<string, string> = {
  dodgeRoll: 'Dodge', 'leapRoll:leap': 'Leap', jumpUpRoll: 'Jump Up', catchRoll: 'Catch', passRoll: 'Pass', interceptionRoll: 'Interception',
  rightStuffRoll: 'Right Stuff', safeThrowRoll: 'Safe Pass', foulAppearanceRoll: 'Foul Appearance', reallyStupidRoll: 'Really Stupid',
  bloodLustRoll: 'Bloodlust', boneHeadRoll: 'Bone Head', animalSavageryRoll: 'Animal Savagery', takeRootRoll: 'Take Root',
  unchannelledFuryRoll: 'Unchannelled Fury', alwaysHungryRoll: 'Always Hungry', animosityRoll: 'Animosity', regenerationRoll: 'Regeneration',
  hypnoticGazeRoll: 'Hypnotic Gaze', dauntlessRoll: 'Dauntless', chainsawRoll: 'Chainsaw', breatheFire: 'Breathe Fire',
  projectileVomit: 'Projectile Vomit', steadyFootingRoll: 'Steady Footing',
};

/** A readable name for a roll kind no label covers: `chompRoll` -> "Chomp", `catchOfTheDay` -> "Catch Of The Day". */
export function actionRollFallbackName(kind: string): string {
  const base = kind.replace(/:.*$/, '').replace(/Roll$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : kind;
}

/** The name of a roll kind in the current language. */
export function actionRollName(kind: string): string {
  if (ROLL_KEY[kind]) return t(ROLL_KEY[kind]!);
  if (ROLL_TERM[kind]) return terms(ROLL_TERM[kind]!);
  return actionRollFallbackName(kind);
}
