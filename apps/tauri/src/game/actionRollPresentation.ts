import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { offeredReRollOptions, playerById } from './reRollDecisionProjection';
import { breatheFirePassed, breatheFireRerollMayBeOfferedUnfailed } from './breatheFireOutcome';
import { disturbingPresenceFromRollModifiers } from '@fumbbl40k/ffb-pitch/src/disturbingPresence';
/** Owner 10-15: the rolls whose tag shows the combined Disturbing Presence modifier the server applied. */
const DISTURBING_PRESENCE_TAG_REPORTS = new Set(['passRoll', 'catchRoll', 'interceptionRoll']);
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
  throwAtStallingPlayer: 'stalling', // owner 10-15: the existing stalling die wears the STALLING badge
};
/** Owner 10-10: a skill roll that had no cause of its own drew a BARE die. Held through a reroll offer (a failed Foul
 *  Appearance roll while the coach decides) nothing on the pitch said what it was once the 3 s skill toast had gone.
 *  These rolls wear their skill's icon on the die (`skill:<name>`), so the marker lives exactly as long as the die. */
export const DIE_CAUSE_SKILL_BY_REPORT: Readonly<Record<string, string>> = {
  foulAppearanceRoll: 'Foul Appearance',
  alwaysHungryRoll: 'Always Hungry',
  escapeRoll: 'Always Hungry',
  animosityRoll: 'Animosity',
  jumpUpRoll: 'Jump Up',
  chainsawRoll: 'Chainsaw',
  steadyFootingRoll: 'Steady Footing',
  safeThrowRoll: 'Safe Throw',
  regenerationRoll: 'Regeneration',
  weepingDaggerRoll: 'Weeping Dagger',
  projectileVomit: 'Projectile Vomit',
  chompRoll: 'Chomp',
};
export const SECURE_THE_BALL_DIE_CAUSE = 'secureTheBall';
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

/** Owner 11-24 (Settings "Hide passed negatrait rolls"): the server reported this negatrait roll PASSED and the coach
 *  hides passed negatrait rolls - none of its on-pitch surfaces (die + tag, negatrait cue, beats) is presented. Two
 *  reports: the confusion roll (Bone Head, Really Stupid, Take Root, Wild Animal, Unchannelled Fury, Animal Savagery)
 *  and Bloodlust's own bloodLustRoll (ffb-server BloodLustBehaviour, every ruleset).
 *  Display only: a failed roll, a roll with no server verdict, every other report and the game log are untouched. */
export function hidesPassedNegatraitRoll(enabled: boolean, report: Readonly<Record<string, unknown>>): boolean {
  const id = String(report.reportId);
  return enabled && (id === 'confusionRoll' || id === 'bloodLustRoll') && report.successful === true;
}

export interface ActionDieCue { square: [number, number]; value: number; cause?: string; failed?: boolean; needed?: number; rerollSkill?: string; rerollTeam?: boolean; opponentRerollPending?: boolean; rerollOfferPending?: boolean; awaitsArrival?: boolean;
  /** Astra 10-10: this roll is NOT failed (no FAILED stamp), yet the server may hold a reroll offer open for it - a
   *  Breathe Fire "no effect" / "placed prone". The die then takes the reroll-offer lifecycle a failed die has (held
   *  while the offer is open, recognised by the prompt, rerolled in place). Only ever set for `breatheFire`. */
  rerollOfferNotFailed?: boolean;
  /** Astra 10-10 (round 2): this is the REROLLED result of a Breathe Fire roll. Only such a result may re-roll in
   *  place the unfailed Breathe Fire die above; any other roll's rerolled result looks for failed dice only. */
  breatheFireReroll?: boolean;
  /** Owner 10-15: the combined Disturbing Presence count from this roll's server `rollModifiers` (interception only;
   *  absent when the server applied none). The die's tag reads "DP −N". */
  disturbingPresence?: number;
  /** Owner 10-22: the rolling player, as the server's report names it (`playerId`). The die's Home / Away colour comes
   *  from this player's team: a movement die is shown on the token's ARRIVAL, by when the model may have moved the
   *  mover on and ended the activation, so the square / acting player at show time cannot name the roller. */
  rollerId?: string }
export interface ActionRollCue {
  reRolled: boolean;
  die: ActionDieCue | null;
  modal: { playerId: string; square: [number, number]; kind: 'pass' | 'catch'; roll: number; needed?: number; ok: boolean; reRolled: boolean;
    /** Owner 10-15: the combined Disturbing Presence count from the server's `rollModifiers` (absent when none). */
    disturbingPresence?: number;
    /** Owner 10-22: the server's reroll offer for this failed roll is open - the die is held until it closes (as an
     *  ActionDieCue's flags: the watching seat / the deciding coach). */
    opponentRerollPending?: boolean; rerollOfferPending?: boolean;
    /** Owner 10-22: this rerolled result answers a failed die of an EARLIER frame (the reroll dialog): it re-rolls
     *  that held die in place under the reroll caption, as a dialog-rerolled dodge does. */
    rerollSkill?: string; rerollTeam?: boolean } | null;
  trait: { playerId: string; trait: string; successful: boolean; roll: number; needed?: number; hasTarget?: boolean } | null;
}
/** Shared report interpretation. Scheduling and UI publication remain with the active reader. */
export function actionRollPresentation(report: Record<string, unknown>, reports: readonly Record<string, unknown>[],
  game: GameJson, coordinate: readonly number[] | null | undefined, passiveViewer: boolean,
  reroll: { raw: string; isTeam: boolean } | null): ActionRollCue | null {
  if (typeof report.playerId !== 'string' || typeof report.roll !== 'number' || !Number.isInteger(report.roll) || report.roll < 1 || report.roll > 6) return null;
  const playerId = report.playerId, roll = report.roll, id = String(report.reportId);
  // Breathe Fire's `successful` means "knocked down", not "passed" - its failed stamp follows the server's result.
  const failed = id === 'breatheFire' ? breatheFirePassed(report) === false : report.successful === false;
  const reRolled = report.reRolled === true;
  const rerollOfferNotFailed = id === 'breatheFire' && !failed && breatheFireRerollMayBeOfferedUnfailed(report);
  // Owner 10-23: the stalling rock carries no minimumRoll; the server hits on roll >= the acting team's turn number.
  const stallingTurn = Number((game.homePlaying ? game.turnDataHome : game.turnDataAway)?.turnNr);
  const neededRaw = id === 'throwAtStallingPlayer' ? stallingTurn : Number(report.minimumRoll);
  const needed = Number.isFinite(neededRaw) && neededRaw >= 2 && neededRaw <= 6 ? neededRaw : undefined;
  const modifierCause = id === 'dodgeRoll' ? dieCauseFromRollModifiers(report.rollModifiers)
    : id === 'standUpRoll' && typeof report.modifier === 'number' && report.modifier > 0 ? 'timmber' : undefined;
  // Owner 09-09: a confusion roll's die tag wears ITS negatrait's icon (`trait:<skill>`) instead of one shared icon.
  const confusionSkill = id === 'confusionRoll' ? String(report.confusionSkill ?? '').trim() : '';
  // Owner 10-10: bb2025 ReportPickupRoll carries `secureTheBallUsed` (StepPickUp: the acting player's action was
  // SECURE_THE_BALL when it rolled). That server field alone picks the Secure the Ball badge; the roll stays a
  // pickUpRoll for every other reader, and `isPickupDieCause` keeps the pick-up die timing for it.
  const secureTheBall = id === 'pickUpRoll' && report.secureTheBallUsed === true;
  const skillCause = DIE_CAUSE_SKILL_BY_REPORT[id];
  // precedence: reroll, roll modifier, confusion trait, Secure the Ball, the report map, then the skill fallback
  const cause = reRolled ? 'reroll' : modifierCause ?? (confusionSkill ? `trait:${confusionSkill}`
    : secureTheBall ? SECURE_THE_BALL_DIE_CAUSE : DIE_CAUSE_BY_REPORT[id] ?? (skillCause ? `skill:${skillCause}` : undefined));
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
  // Owner 10-15: render only what the server sent - the count comes from this report's modifiers, never the board.
  const disturbingPresence = DISTURBING_PRESENCE_TAG_REPORTS.has(id) ? disturbingPresenceFromRollModifiers(report.rollModifiers) : 0;
  const dialog = game.dialogParameter as Record<string, unknown> | null | undefined;
  const dialogId = String(dialog?.dialogId ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // The server's reroll offer for THIS failed roll is open (its dialog names this player and offers a source).
  const offerOpen = (failed || rerollOfferNotFailed) && dialogId.includes('reroll') && String(dialog?.playerId ?? '') === playerId
    && offeredReRollOptions(dialog ?? {}, playerById(game, playerId)?.skillDisplayValuesMap).length > 0;
  if (id === 'passRoll' || id === 'catchRoll') {
    // Owner 10-22 (g1955713 #2052): a failed pass / catch die is held for the server's reroll offer on EVERY seat, like
    // any other failed roll's die - the opposing seat and spectators used to lose it after its ~1.2 s read while the
    // other coach was still deciding. Released by the renderer when the offer closes (the dialog-clearing frame).
    result.modal = { playerId, square, kind: id === 'passRoll' ? 'pass' : 'catch', roll, needed, ok: !failed, reRolled,
      ...(disturbingPresence > 0 ? { disturbingPresence } : {}),
      ...(offerOpen ? (passiveViewer ? { opponentRerollPending: true } : { rerollOfferPending: true }) : {}) };
    return result;
  }
  result.die = { square, value: roll, cause, failed, needed,
    rerollSkill: reRolled && reroll ? reroll.raw : undefined, rerollTeam: reRolled && reroll ? reroll.isTeam : undefined, rollerId: playerId };
  if (disturbingPresence > 0) result.die.disturbingPresence = disturbingPresence;
  // Owner 10-09 ("The FAILED toast is appearing at the square where the player fails their dodge before the player
  // token enters that square"): the first roll of a move into a square is shown on the token's arrival there. A
  // rerolled result replaces a die that is already up; a roller that is not moving is "arrived" at once.
  if (!reRolled && (id === 'dodgeRoll' || id === 'goForItRoll' || id === 'leapRoll')) result.die.awaitsArrival = true;
  // Owner 10-13: the Throw Team-Mate landing roll likewise waits for the thrown player to come down on the square.
  if (!reRolled && id === 'rightStuffRoll') result.die.awaitsArrival = true;
  // Owner 10-05: "The marker that says GFI, Dodge, etc, should persist on a failed roll until the roll is either
  // accepted or cleared. Teardown should occur at the same time as the die." The failed die (with its cause marker)
  // was held through the reroll offer only on the WATCHING client; the rolling coach's own die faded after its
  // normal ~1.6 s while their reroll prompt was still open, and an accepted reroll then drew a fresh die without
  // the cause. Both seats now hold it for as long as the server's reroll offer for that player is open.
  if (rerollOfferNotFailed) result.die.rerollOfferNotFailed = true;
  if (id === 'breatheFire' && reRolled) result.die.breatheFireReroll = true;
  if (offerOpen) {
    if (passiveViewer) result.die.opponentRerollPending = true;
    else result.die.rerollOfferPending = true;
  }
  return result;
}
