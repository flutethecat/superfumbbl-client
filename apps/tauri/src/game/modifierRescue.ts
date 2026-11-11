// Owner 10-26 (g1075, Gondra87): "Jordell's special rule worked but triggered a 'failed roll' result despite using the
// modifier ... Guards should drop when rerollmodifierchoice fires."
//
// Upstream master e7f9858a1: a picked optional modifier makes the SAME die pass and the server sends NO new roll report.
// Its only trace is ReportSkillUse(playerId, skill, used: true, skillUse):
//  - StepMoveDodge.commitModifierSkills: addDodgeModifier, or passDodgeWithoutModifiers (Swift As The Breeze);
//  - StepPickUp / StepCatchScatterThrowIn / StepIntercept / StepRightStuff / StepJumpUp: addAgilityModifier;
//  - StepJump: addAgilityModifier, or passJumpWithoutModifiers (Swift As The Breeze, spent by leap());
// a modifier option is only offered when it makes the die succeed (DodgeModifierSelectionService.findOptions, the
// agility selection services). Swift As The Breeze on a RUSH keeps the old skillUse dialog and reports
// passRushWithoutModifiers (bb2025 StepGoForIt, unchanged). Pure: no store state.

/** The movement roll kinds a guard / fence / plan can wait on (store PlanResolution). */
export type RescuedMovementRoll = 'dodge' | 'gfi' | 'pickup';

const RESCUE_KINDS: Readonly<Record<string, readonly RescuedMovementRoll[]>> = {
  addDodgeModifier: ['dodge'],
  passDodgeWithoutModifiers: ['dodge'],
  addAgilityModifier: ['pickup'],
  passJumpWithoutModifiers: [],
  passRushWithoutModifiers: ['gfi'],
};

/** Sol r1 #2: bb2025 StepJump.commitFreeModifierSkill (251-262) reports addAgilityModifier for a FREE jump skill accepted
 *  on its own skillUse dialog (asked only under the stalling condition). That is no proof of success: the selection
 *  service only checks that all remaining modifiers TOGETHER could succeed (JumpModifierSelectionService.canSucceed,
 *  78-87) and the step re-evaluates and may offer a further choice (StepJump 433-480). The free skills are the ones
 *  usable every turn (isFreeSkill: SkillUsageType.REGULAR, 90-92): Leap, Very Long Legs, Pogo (skill/bb2025). A
 *  reRollModifierChoice option never holds one (findOptions filters `!isFreeSkill`, 39-46). */
const FREE_JUMP_SKILLS = new Set(['leap', 'verylonglegs', 'pogo', 'pogostick']);

/** A used modifier skill that makes the player's failed roll pass (see the header). */
export function isModifierRescueReport(report: Readonly<Record<string, unknown>>): boolean {
  if (String(report.reportId ?? '') !== 'skillUse' || report.used !== true
    || typeof report.playerId !== 'string' || report.playerId === ''
    || !Object.prototype.hasOwnProperty.call(RESCUE_KINDS, String(report.skillUse ?? ''))) return false;
  const skill = String(report.skill ?? '').replace(/[^a-z]/gi, '').toLowerCase();
  // Sol r2 #3: passJumpWithoutModifiers is also Bounding Leap's PRE-roll declaration (canIgnoreJumpModifiers; bb2025
  // StepJump 298-309, bb2020 StepJump 176-185) - only Swift As The Breeze (canChooseToIgnoreJumpModifierAfterRoll,
  // spent after the roll in leap(): bb2025 StepJump 398-405) proves the jump passed.
  if (String(report.skillUse) === 'passJumpWithoutModifiers') return skill === 'swiftasthebreeze';
  return !(String(report.skillUse) === 'addAgilityModifier' && FREE_JUMP_SKILLS.has(skill));
}

/** The movement roll kinds the rescue settles ([] for a rescue that is not a movement roll, and for any other report). */
export function modifierRescueKinds(report: Readonly<Record<string, unknown>>): readonly RescuedMovementRoll[] {
  return isModifierRescueReport(report) ? RESCUE_KINDS[String(report.skillUse)]! : [];
}

export type ModifierPassRoll = 'dodge' | 'jump' | 'agility';

/** Owner 10-26: the splash for "Swift As The Breeze or Consummate Professional used to pass something" - only these two
 *  skills, only the named skillUse values; Break Tackle and every other modifier skill get none. */
export function modifierPassSplashCue(report: Readonly<Record<string, unknown>>): { playerId: string; skill: string; roll: ModifierPassRoll } | null {
  if (!isModifierRescueReport(report)) return null;
  const skill = String(report.skill ?? '');
  const key = skill.replace(/[^a-z]/gi, '').toLowerCase();
  const use = String(report.skillUse);
  const roll: ModifierPassRoll | null = key === 'swiftasthebreeze'
    ? (use === 'passDodgeWithoutModifiers' ? 'dodge' : use === 'passJumpWithoutModifiers' ? 'jump' : null)
    : key === 'consummateprofessional'
      ? (use === 'addDodgeModifier' ? 'dodge' : use === 'addAgilityModifier' ? 'agility' : null)
      : null;
  return roll ? { playerId: String(report.playerId), skill, roll } : null;
}
