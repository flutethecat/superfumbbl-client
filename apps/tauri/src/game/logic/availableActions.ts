// ORDER 66 — Phase A.2: the ACTION-MENU content (surface ③ of the wiring model).
//
// `availableActions()` is the pure companion to `deriveClientState()`: given the server-synced model and the
// selected player, it returns the actions the coach MAY declare in the current client state — the port of
// upstream's per-state action list + its availability checks (SelectLogicModule et al.). The UI never decides
// what's legal; it renders this list and forwards the chosen declare. Pure + side-effect-free so the golden
// harness can assert the menu content per captured frame (same contract as clientStateMachine.ts).
//
// A.2 SCOPE: the SELECT_PLAYER starter set (Move / Stand Up / Secure the Ball / End) + MOVE's End Move. The 10
// façade "Special" labels and the other declares (Blitz/Foul/Pass/Hand-over/bomb/keg/gaze…) become real entries
// here in the BLOCK/BLITZ/micro-states phases — each is one row with its own availability check (Group A of
// order66-special-actions-review.md names every check verbatim).

import type { GameJson, PlayerJson } from '@fumbbl40k/ffb-protocol';
import { effectiveArmour, effectiveMovement, effectiveStat, normalizeSkillName, playerSkillNames } from '@fumbbl40k/ffb-protocol';
import { deriveClientState, type ClientStateContext } from './clientStateMachine';
import { starUseSkillElection } from './coachActionDispatch';
import { onTheBallPlayerStateIsAbleToMove } from '../onTheBallController';
import {
  WIDE_RAIL_PRE_ACTION_RULES,
  wideRailPreActionModeForPlayerAction,
  type WideRailPreActionRuleId,
} from './wideRailPreAction';

/** declare = clientActingPlayer{action}; endMove = clientActingPlayer{playerId:null}. */
export type CoachActionKind = 'declare' | 'endMove';

/** BB2025 block flavors — carried as a flag on clientBlock (usingStab/Chainsaw/Vomit/BreatheFire/Chomp). The
 *  DECLARE is always plain `block` (binding §5); the flavor rides sendBlock at the target click. */
export type BlockKind = 'stab' | 'chainsaw' | 'vomit' | 'breatheFire' | 'chomp';

export interface BlockAlternativeOffer {
  property: BlockAlternativeProperty;
  kind: Exclude<BlockKind, 'chomp'>;
  label: string;
}

export type BlockAlternativeProperty =
  | 'providesChainsawBlockAlternative'
  | 'providesStabBlockAlternative'
  | 'canPerformArmourRollInsteadOfBlockThatMightFail'
  | 'canPerformArmourRollInsteadOfBlockThatMightFailWithTurnover';

export interface CoachAction {
  /** Wire playerAction for ordinary declares; synthetic control verbs (for example `jump`) are intercepted by
   *  both views before the generic clientActingPlayer sender. Empty string is reserved for end-move. */
  action: string;
  label: string;
  kind: CoachActionKind;
  /** false → render shaded/disabled with `reason` (the affordance is shown, not hidden — legibility). */
  enabled: boolean;
  reason?: string;
  /** A.3: for a Block declare, the flavor whose flag rides clientBlock (undefined = plain block). */
  blockKind?: BlockKind;
  /** Owner ruling 08-17: skill name whose icon renders inline on this row (Jump Up on Move only, no text
   *  prefix). Generic slot, not a Move-row special case — populated only where a row earns it. */
  icon?: string;
  /** Star S4: for a `starUseSkill` row, the STAR_RULE_REGISTRY ruleId the generic store sender commits. */
  ruleId?: string;
}

// PlayerState low byte = base state (ffb-common PlayerState.java; drivePregame isProne: `& 0xff === 3`).
const BASE_STANDING = 1;
const BASE_MOVING = 2; // #93: PlayerState.canBeBlocked() = STANDING || MOVING (MOVING is a transient mid-move base).
const BASE_PRONE = 3;
// STUNNED = 4 (ffb-common PlayerState). A foul targets a DOWN enemy — upstream isProneOrStunned():236
// (`PRONE || STUNNED`). Both bases are the legal foul victims.
const BASE_STUNNED = 4;
const BASE_BLOCKED = 12;
// PlayerState flags (ffb-common PlayerState.java, mirrored in store.ts:1258/3522): ACTIVE = activatable,
// CONFUSED = failed-negatrait / hypnotic-gaze victim. `isActive()`/`isConfused()` in upstream LogicModule.
export const FLAG_ACTIVE = 0x100;
const FLAG_CONFUSED = 0x200;
const FLAG_ROOTED = 0x400;
const FLAG_HYPNOTIZED = 0x800; // ffb-common PlayerState _BIT_HYPNOTIZED — isDistracted() = confused || hypnotized
const FLAG_EYE_GOUGED = 0x20000; // ffb-common PlayerState _BIT_EYE_GOUGED
const FLAG_CHOMPED = 0x40000;

interface PlayerDataLike {
  playerId: string;
  playerCoordinate: unknown;
  playerState?: number;
}

function baseState(ps: number | undefined): number {
  return (ps ?? 0) & 0xff;
}

// A.3 BLOCK — block-kind skill → flavor + display label. Skill names are normalized (lowercased, alpha-only).
const BLOCK_KIND_BY_SKILL: Record<string, BlockKind> = {
  stab: 'stab', chainsaw: 'chainsaw', projectilevomit: 'vomit', breathefire: 'breatheFire',
};

// #207 OFFER DISCIPLINE. These are property-keyed grantor sets, not action/skill-name tests. Keep the four bare
// NamedProperties keys greppable: upstream bb2025/SelectLogicModule.java:267-289 gates each one independently by
// specialBlocksAvailable + canDeclareSkillAction. A bare-property grep at upstream/master finds the BB2025 grantors
// listed here (including a roster-granted Chainsaw such as Helmut Wulf, with no player-name special case).
const BLOCK_ALTERNATIVE_GRANTORS: Record<BlockAlternativeProperty, readonly string[]> = {
  providesStabBlockAlternative: ['Stab'],
  providesChainsawBlockAlternative: ['Chainsaw'],
  canPerformArmourRollInsteadOfBlockThatMightFail: ['Projectile Vomit', 'Putrid Regurgitation'],
  canPerformArmourRollInsteadOfBlockThatMightFailWithTurnover: ['Breathe Fire'],
};
// BB2025 `NamedProperties.canPinPlayers` has exactly one grantor: Monstrous Mouth
// (skill/bb2025/MonstrousMouth.java:14,18-21). Chomp is not a skill name and is deliberately separate from the
// four `BLOCK_ALTERNATIVE_GRANTORS` properties above.
const CHOMP_GRANTORS: readonly string[] = ['Monstrous Mouth'];
const BLOCK_ALTERNATIVE_KIND: Record<BlockAlternativeProperty, Exclude<BlockKind, 'chomp'>> = {
  providesStabBlockAlternative: 'stab',
  providesChainsawBlockAlternative: 'chainsaw',
  canPerformArmourRollInsteadOfBlockThatMightFail: 'vomit',
  canPerformArmourRollInsteadOfBlockThatMightFailWithTurnover: 'breatheFire',
};
export const BLOCK_KIND_LABEL: Record<BlockKind, string> = {
  stab: 'Stab', chainsaw: 'Chainsaw', vomit: 'Projectile Vomit', breatheFire: 'Breathe Fire', chomp: 'Chomp',
};

/** Display-only summary for the pre-send two-click attack confirmation. The server remains authoritative for
 * every roll and modifier; these values mirror the BB2025 block steps so selecting a flavor never invents a
 * second command path. */
export interface BlockAttackPreview {
  kind: BlockKind;
  title: string;
  emoji: string;
  activationTarget: number | null;
  armourTarget: number | null;
  detail: string;
}

const BLOCK_KIND_EMOJI: Record<BlockKind, string> = {
  stab: '🔪', chainsaw: '🪚', vomit: '🤮', breatheFire: '🔥', chomp: '👄',
};

export function blockAttackPreview(game: GameJson, defenderId: string, kind: BlockKind): BlockAttackPreview {
  const armourTarget = blockAlternativeArmourTarget(game, defenderId, kind);
  switch (kind) {
    case 'stab':
      return { kind, title: 'STAB!', emoji: BLOCK_KIND_EMOJI[kind], activationTarget: null, armourTarget, detail: 'Armour roll' };
    case 'chainsaw':
      return {
        kind, title: 'CHAINSAW!', emoji: BLOCK_KIND_EMOJI[kind], activationTarget: 2, armourTarget,
        detail: hasSkill(game, defenderId, 'Iron Hard Skin') ? 'Kickback on 1 · Iron Hard Skin cancels +3 AV' : 'Kickback on 1 · +3 to armour',
      };
    case 'vomit':
      return { kind, title: 'VOMIT!', emoji: BLOCK_KIND_EMOJI[kind], activationTarget: 2, armourTarget, detail: 'On 1, the attacker is hit instead' };
    case 'breatheFire': {
      const defender = findRosterPlayer(game, defenderId);
      const strongOpponent = defender ? effectiveStat(defender, 'ST') > 4 : false;
      return {
        kind, title: 'BREATHE FIRE!', emoji: BLOCK_KIND_EMOJI[kind], activationTarget: strongOpponent ? 3 : 2, armourTarget,
        detail: `1: attacker down · ${strongOpponent ? 5 : 4}+: target prone · 6: knockdown + armour`,
      };
    }
    case 'chomp':
      return { kind, title: 'CHOMP!', emoji: BLOCK_KIND_EMOJI[kind], activationTarget: 3, armourTarget: null, detail: 'Pins the target on success' };
  }
}

/** Which side a player is on by TRUE roster identity: true = teamHome, false = teamAway, null = not found.
 *  EXPORTED for #173 (`order66Interaction.actionSurfaceLock`) — dialog OWNERSHIP is a true-roster question
 *  (which coach was asked), the same fact this already answers; re-deriving it there would be a second copy. */
export function playerSideIsHome(game: GameJson, playerId: string): boolean | null {
  const home = ((game.teamHome as { playerArray?: { playerId: string }[] })?.playerArray ?? []);
  if (home.some((p) => p.playerId === playerId)) return true;
  const away = ((game.teamAway as { playerArray?: { playerId: string }[] })?.playerArray ?? []);
  if (away.some((p) => p.playerId === playerId)) return false;
  return null;
}

/**
 * ALL of the player's skills — roster/learned (`skillArray`) UNIONED with every temporary grant
 * (`temporarySkillsMap`: prayers, cards, Wisdom). Upstream every availability check runs over
 * `Player.getSkillsIncludingTemporaryOnes()` (Player.java:328-330), never over the base list, so reading
 * `skillArray` alone silently dropped e.g. Stiletto's Stab — and Stab CHANGES the offered block alternatives
 * (docs/prayers-to-nuffle-current-client-audit-2026-08-17.md §58-71). Single funnel: `hasSkill`,
 * `blockKindsOf`, `hasUnusedGrantor` and the Right Stuff scan all read through here.
 */
function findSkillArray(game: GameJson, playerId: string): string[] {
  return playerSkillNames(findRosterPlayer(game, playerId));
}

function findRosterPlayer(game: GameJson, playerId: string): PlayerJson | undefined {
  const all = [
    ...((game.teamHome as { playerArray?: PlayerJson[] })?.playerArray ?? []),
    ...((game.teamAway as { playerArray?: PlayerJson[] })?.playerArray ?? []),
  ];
  return all.find((p) => p.playerId === playerId);
}

function chebyshev(a: [number, number], b: [number, number]): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

/** Standing enemies (opposite true side) orthogonally/diagonally adjacent to `playerId` — the legal block
 *  targets (a rules gate, NOT a prediction: the server validates the clientBlock). Exported for the router. */
export function adjacentStandingEnemyIds(game: GameJson, playerId: string): string[] {
  const me = findPlayer(game, playerId);
  const myPos = normSquare(me?.playerCoordinate);
  const iAmHome = playerSideIsHome(game, playerId);
  if (!myPos || iAmHome === null) return [];
  const out: string[] = [];
  for (const p of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    if (p.playerId === playerId || baseState(p.playerState) !== BASE_STANDING) continue;
    const side = playerSideIsHome(game, p.playerId);
    if (side === null || side === iAmHome) continue; // same side or off-roster
    const pos = normSquare(p.playerCoordinate);
    if (pos && chebyshev(myPos, pos) === 1) out.push(p.playerId);
  }
  return out;
}

/** #58 §7.1 (Yularen ruled 07-22): adjacent OPPONENTS that `canBeBlocked` (STANDING||MOVING) — the upstream-EXACT
 *  count for the block-family OFFER predicates. Mirrors `UtilPlayer.findAdjacentBlockablePlayers` →
 *  `PlayerState.canBeBlocked()` (STANDING||MOVING, ffb-common :247-249). SHARED by #50 (plain Block offer) + #58
 *  (multipleBlock count>1) — discharges #50's DISCLOSED STANDING-only narrowing (fidelity corollary; a MOVING
 *  opponent never occurs on MY turn so it is behaviour-identical in practice, but faithful). Same true-roster-side
 *  opponent detection as adjacentStandingEnemyIds (spectator-safe, multiblock-58-wire-pin §5 — NOT the upstream
 *  getTeamAway() shortcut). */
export function adjacentBlockableEnemyIds(game: GameJson, playerId: string): string[] {
  const me = findPlayer(game, playerId);
  const myPos = normSquare(me?.playerCoordinate);
  const iAmHome = playerSideIsHome(game, playerId);
  if (!myPos || iAmHome === null) return [];
  const out: string[] = [];
  for (const p of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    if (p.playerId === playerId) continue;
    const b = baseState(p.playerState);
    if (b !== BASE_STANDING && b !== BASE_MOVING) continue; // canBeBlocked() = STANDING || MOVING
    const side = playerSideIsHome(game, p.playerId);
    if (side === null || side === iAmHome) continue; // same side or off-roster
    const pos = normSquare(p.playerCoordinate);
    if (pos && chebyshev(myPos, pos) === 1) out.push(p.playerId);
  }
  return out;
}

/** #93 (owner): a player can be BLOCKED / BLITZ-targeted iff its base is STANDING or MOVING — never prone/stunned.
 *  EXACT mirror of `PlayerState.canBeBlocked()` (ffb-common: `STANDING || MOVING`), which is the upstream blitz-
 *  target gate: bb2025 `SelectBlitzTargetLogicModule.playerInteraction` → `BlockLogicExtension.isValidBlitzTarget`
 *  → `isBlockable` (`:202-215`) → `defenderState.canBeBlocked()`. The caller checks opponent + on-pitch. (Plain
 *  BLOCK already gates on the stricter STANDING-only `adjacentStandingEnemyIds`, so a prone Block was never offered
 *  — this closes the BLITZ-target leak where any enemy click was forwarded as the nominee regardless of state.) */
export function canBeBlocked(game: GameJson, playerId: string): boolean {
  const b = baseState(findPlayer(game, playerId)?.playerState);
  return b === BASE_STANDING || b === BASE_MOVING;
}

/** #181 W0/VV-3 (Vicious Vines offer, Meero SR-143): the client-side mirror of the server property `canBlockOverDistance`.
 *  Grantor SET, exactly the #179 `canLeap` / #50 `canStandUpForFree` pattern — the client models skills by NAME, so
 *  a property is mirrored by its grantor set, maintained in ONE greppable place.
 *  ⚠ JL-2 instrument (re-run when adding a skill or moving ruleset; grep the property BARE so cancellers show too):
 *      git grep -n "NamedProperties.canBlockOverDistance" upstream/master -- '*.java'
 *  At `upstream/master` that returns exactly ONE bb2025 registrant — `skill/bb2025/special/ViciousVines.java` (a
 *  `registerProperty`, no conflicting-property registrant) — hence the single entry below. The three-vocabulary rule
 *  applies: this is the ROSTER string; the wire token is `viciousVines`; the upstream class is `ViciousVines`. */
const CAN_BLOCK_OVER_DISTANCE_SKILLS = ['Vicious Vines'];

/** A player's used-skill list (per-half/game once-use tracking). Mirrors `findSkillArray`: `usedSkills` rides the
 *  SAME `team.playerArray[]` model as `skillArray`, populated by the `playerMarkSkillUsed` model change and carrying
 *  skill NAMES (upstream `ModelChangeDataType.SKILL` → `toEnumWithName`/SkillFactory ⇒ the display-name vocabulary,
 *  source-pinned — verified at [SOURCE] because our 773 game logs contain ZERO mark-used events to capture). */
function findUsedSkills(game: GameJson, playerId: string): string[] {
  const all = [
    ...((game.teamHome as { playerArray?: { playerId: string; usedSkills?: string[] }[] })?.playerArray ?? []),
    ...((game.teamAway as { playerArray?: { playerId: string; usedSkills?: string[] }[] })?.playerArray ?? []),
  ];
  return all.find((p) => p.playerId === playerId)?.usedSkills ?? [];
}

/** Mirror of `Player.hasUnusedSkillProperty(<property>)`: holds a grantor-set skill whose NAME is NOT in this
 *  player's `usedSkills`. The once-per-X star declares (canBlockOverDistance / canStabAndMoveAfterwards /
 *  canThrowKeg) all gate on this shape, so the check is generic over the grantor set — normalised name compare,
 *  same vocabulary as `hasSkill`; `usedSkills` carries skill NAMES (source-pinned via toEnumWithName/SkillFactory).
 *  ⚖ Fail-safe UNDER-offer (Meero VV-3): an unreadable used-state ⇒ unmatched ⇒ NOT offered, never a re-offer of a
 *  spent skill (the server rejects a second use anyway; withholding is the costless direction). */
function hasUnusedGrantor(game: GameJson, playerId: string, skills: readonly string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const used = new Set(findUsedSkills(game, playerId).map(norm));
  return skills.some((s) => hasSkill(game, playerId, s) && !used.has(norm(s)));
}

/** Star S1 (Yoink!): `Player.hasUnused(<skill>)` for ONE server-named skill — the same used-name compare as
 *  `hasUnusedGrantor`, but over a name the SERVER sent (the interception offer's `skill`), never a client-side
 *  grantor set. Upstream gates on exactly this: `InterceptionLogicModule.isInterceptor` (`pPlayer.hasUnused(
 *  interceptionSkill)`) and `DialogInterceptionHandler.dialogClosed` (filters interceptors by `hasUnused`);
 *  the server re-checks it (`bb2025/pass/StepIntercept.intercept:189`), so this is an offer-shaping mirror only. */
export function hasUnusedSkillNamed(game: GameJson, playerId: string, skill: string): boolean {
  return hasUnusedGrantor(game, playerId, [skill]);
}

/** #181 VV-3: opponents `canBeBlocked` at chebyshev EXACTLY 2 (adjacent EXCLUDED). Upstream
 *  `UtilPlayer.findBlockablePlayersTwoSquaresAway = findBlockablePlayers(…,2) MINUS the adjacent set` — the
 *  Vicious Vines target is a 2-away enemy, never an adjacent one (a normal Block covers adjacency). */
export function blockableEnemiesTwoAway(game: GameJson, playerId: string): string[] {
  const me = findPlayer(game, playerId);
  const myPos = normSquare(me?.playerCoordinate);
  const iAmHome = playerSideIsHome(game, playerId);
  if (!myPos || iAmHome === null) return [];
  const out: string[] = [];
  for (const p of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    if (p.playerId === playerId) continue;
    const b = baseState(p.playerState);
    if (b !== BASE_STANDING && b !== BASE_MOVING) continue; // canBeBlocked() = STANDING || MOVING
    const side = playerSideIsHome(game, p.playerId);
    if (side === null || side === iAmHome) continue;
    const pos = normSquare(p.playerCoordinate);
    if (pos && chebyshev(myPos, pos) === 2) out.push(p.playerId); // EXACTLY 2, adjacent-excluded
  }
  return out;
}

/** #183/BA-1 (Meero SR-173, Yularen-ruled P2 ⚖-legality tag): port of `GameMechanic.isBlockActionAllowed:90`
 *  = `TurnMode.BLITZ != turnMode`. In the Blitz! kickoff event (turnMode `'blitz'`) a coach MAY declare a Blitz but
 *  MAY NOT declare a standalone Block or any star block-variant. Upstream enforces this CLIENT-SIDE ONLY (zero server
 *  consumers, SR-171) and the server EXECUTES an unguarded block there (`StepInitSelecting:116-140` dispatches BLOCK
 *  with no turnMode check · `StepBlitzTurn:79-82` pushes the generic Select sequence · `StepEndBlocking:322` is
 *  proof-of-life, running only after a block executed) — a [[server-derived-law]] FIDELITY COROLLARY: reproduce it or
 *  a coach gets a FREE block that doesn't consume the Blitz. Consumed at the FOUR block-family OFFERS (mirroring
 *  upstream's four gate sites `LogicModule:289/548/650/724`): plain `block` (+ its flavour block-kind entries),
 *  `theFlashingBladeAvailable`, `viciousVinesAvailable`, `multipleBlock`. ⛔ NOT `blitzMove` (upstream PERMITS the
 *  Blitz action here — BA-1a) and ⛔ NOT the `'regular'|'blitz'` state fold (`clientStateMachine:125-126` is correct,
 *  a Blitz! turn IS a playable SELECT_PLAYER turn — BA-1b). One rule, four consumers (the `kegTargetIds` shape). */
function blockActionAllowed(game: GameJson): boolean {
  return String((game as { turnMode?: string }).turnMode ?? '') !== 'blitz';
}

/** BB2025 GameMechanic forbids these three declarations during the Charge mini-turn. */
function chargeRestrictedSpecialActionAllowed(game: GameJson): boolean {
  return String((game as { turnMode?: string }).turnMode ?? '') !== 'blitz';
}

/** #181 VV-3: the Vicious Vines OFFER — port of upstream `LogicModule.isViciousVinesAvailable:649-653`, condition-
 *  for-condition: acting player STANDING + a block-family turnMode + `hasUnusedSkillProperty(canBlockOverDistance)`
 *  + a 2-away blockable opponent exists. INERT until a caller consults it (the right-click Special submenu, Fives) —
 *  a pure offer predicate, no wire, no state. ✅ The `isBlockActionAllowed(turnMode)` limb is now ported — `blockActionAllowed(game)`
 *  (BA-1, #183): the Blitz!-kickoff turnMode forbids this standalone block-variant. */
export function viciousVinesAvailable(game: GameJson, playerId: string): boolean {
  if (!blockActionAllowed(game)) return false; // BA-1: no standalone block-variant in the Blitz! kickoff (turnMode 'blitz')
  const b = baseState(findPlayer(game, playerId)?.playerState);
  if (b !== BASE_STANDING) return false;
  if (!hasUnusedGrantor(game, playerId, CAN_BLOCK_OVER_DISTANCE_SKILLS)) return false;
  return blockableEnemiesTwoAway(game, playerId).length > 0;
}

/** #181 (B) grantor sets — the client-side mirrors of two more star properties, one bb2025 registrant each
 *  (JL-2 instrument: `git grep -n "NamedProperties.<prop>" upstream/master -- '*.java'`, bare so cancellers show).
 *  Three-vocabulary: these are the ROSTER strings (= the display names); the wire tokens are `theFlashingBlade` /
 *  `throwKey`; the upstream classes are `TheFlashingBlade` / `BeerBarrelBash`. */
const CAN_STAB_AND_MOVE_SKILLS = ['The Flashing Blade']; // canStabAndMoveAfterwards — skill/mixed/special/TheFlashingBlade.java:20
const CAN_THROW_KEG_SKILLS = ['Beer Barrel Bash!'];      // canThrowKeg — skill/mixed/special/BeerBarrelBash.java:18
const CAN_THROW_BOMB_TWICE_SKILLS = ['All You Can Eat']; // canUseThrowBombActionTwice — skill/mixed/special/AllYouCanEat.java:18 (sole BB2025 grantor; bare property grep finds no cancellers)
const CAN_VOMIT_AFTER_BLOCK_SKILLS = ['Putrid Regurgitation']; // canUseVomitAfterBlock — skill/bb2025/special/PutridRegurgitation.java:17 (ONCE_PER_HALF; JL-2 bare grep: registrants bb2020+bb2025 only, NO cancellers)
// Star S8 grantor sets (terminal trio). Roster strings = display names; wire tokens are the declare ids.
const KICK_EM_SKILLS = ["Kick 'em while they're down!"]; // canUseChainsawOnDownedOpponents — skill/mixed/special/KickEmWhileTheyReDown.java:14 (ONCE_PER_GAME)
const FURIOUS_OUTBURST_SKILLS = ['Furious Outburst'];    // canTeleportBeforeAndAfterAvRollAttack — skill/mixed/special/FuriousOutburst.java:15 (ONCE_PER_HALF)
const BLASTIN_SKILLS = ['"Blastin\' Solves Everything"']; // canBlastRemotePlayer — skill/bb2025/special/BlastinSolvesEverything.java:14 (ONCE_PER_HALF; quotes are roster bytes)
const CAN_MOVE_OPEN_TEAM_MATE_SKILLS = ['Raiding Party']; // mixed/special/RaidingParty.java:13,18 — sole canMoveOpenTeamMate grantor; bare-property sweep finds no canceller
const CAN_GRANT_SKILLS_TO_TEAM_MATES_SKILLS = ['Wisdom of the White Dwarf']; // bb2025/special/WisdomOfTheWhiteDwarf.java:19,24 — sole BB2025 grantor; bare-property sweep finds no canceller
const CAN_GET_BALL_ON_GROUND_SKILLS = ['Catch of the Day']; // ffb-common .../skill/mixed/special/CatchOfTheDay.java registers NamedProperties.canGetBallOnGround
const CAN_GAIN_FRENZY_FOR_BLITZ_SKILLS = ['Frenzied Rush']; // skill/bb2025/special/FrenziedRush.java registers NamedProperties.canGainFrenzyForBlitz
const CAN_GAIN_CLAWS_FOR_BLITZ_SKILLS = ['Slashing Nails']; // skill/bb2025/special/SlashingNails.java registers NamedProperties.canGainClawsForBlitz (ONCE_PER_HALF)
const CAN_GAZE_AUTOMATICALLY_SKILLS = ['Black Ink']; // skill/mixed/special/BlackInk.java registers NamedProperties.canGazeAutomatically, ONCE_PER_GAME — distinct from Zoat's canGazeAutomaticallyThreeSquaresAway grantor
const WISDOM_GRANTABLE_SKILLS = ['Break Tackle', 'Dauntless', 'Mighty Blow', 'Sure Feet'] as const; // Constant.java:24-36

/** #226: Wisdom's mid-activation offer, mirroring LogicModule.java:175-182 and bb2025
 * GameMechanic.java:229-246. ActingPlayer.hasActed() is the same observable union used by Raiding Party;
 * upstream also includes `forgone`, but that limb is not carried by this fork's wire model. The server remains
 * authoritative and revalidates the target and its missing grantable skills. */
export function wisdomAvailable(game: GameJson, playerId: string): boolean {
  const acting = game.actingPlayer as {
    playerId?: string | null; hasMoved?: boolean; hasFouled?: boolean; hasBlocked?: boolean; hasPassed?: boolean;
    hasTriggeredEffect?: boolean; usedSkills?: string[];
  } | undefined;
  if (String(acting?.playerId ?? '') !== playerId) return false;
  if (acting?.hasMoved || acting?.hasFouled || acting?.hasBlocked || acting?.hasPassed
      || acting?.hasTriggeredEffect || (acting?.usedSkills?.length ?? 0) > 0) return false;
  if (!hasUnusedGrantor(game, playerId, CAN_GRANT_SKILLS_TO_TEAM_MATES_SKILLS)) return false;
  const origin = normSquare(findPlayer(game, playerId)?.playerCoordinate);
  const side = playerSideIsHome(game, playerId);
  if (!origin || side === null) return false;
  // The base+temporary union is now the shared decoder's job (playerSkillNames), so this no longer has to
  // scrape the `ffb40k:` diagnostic property log — FIELD_MODEL_ADD_WISDOM writes a real temporarySkillsMap
  // entry under `Granted by Wisdom of the White Dwarf`, and REMOVE_SKILL_ENHANCEMENTS drops it again.
  const hasIncludingTemporary = (targetId: string, skill: string): boolean => {
    const wanted = normalizeSkillName(skill);
    return findSkillArray(game, targetId).some((name) => normalizeSkillName(name) === wanted);
  };
  return ((game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]).some((mate) => {
    if (mate.playerId === playerId || playerSideIsHome(game, mate.playerId) !== side) return false;
    const base = baseState(mate.playerState);
    if ((base !== BASE_STANDING && base !== BASE_PRONE) || !((mate.playerState ?? 0) & FLAG_ACTIVE)) return false;
    const square = normSquare(mate.playerCoordinate);
    return !!square && chebyshev(origin, square) <= 2
      && WISDOM_GRANTABLE_SKILLS.some((skill) => !hasIncludingTemporary(mate.playerId, skill));
  });
}

/** #221: exact client offer from LogicModule.isRaidingPartyAvailable:201-236. "Open" here means a STANDING
 * team-mate within five squares who is outside every opposing tacklezone and has an adjacent empty square which
 * itself neighbours an opponent. The acting player must not yet have acted; ActingPlayer.hasActed:464-466 is the
 * union below. The server revalidates and owns the final eligible-player/square sets. */
export function raidingPartyAvailable(game: GameJson, playerId: string): boolean {
  const acting = game.actingPlayer as {
    playerId?: string | null; hasMoved?: boolean; hasFouled?: boolean; hasBlocked?: boolean; hasPassed?: boolean;
    hasTriggeredEffect?: boolean; forgone?: boolean; usedSkills?: string[];
  } | undefined;
  if (String(acting?.playerId ?? '') !== playerId) return false;
  if (acting?.hasMoved || acting?.hasFouled || acting?.hasBlocked || acting?.hasPassed
      || acting?.hasTriggeredEffect || acting?.forgone || (acting?.usedSkills?.length ?? 0) > 0) return false;
  if (!hasUnusedGrantor(game, playerId, CAN_MOVE_OPEN_TEAM_MATE_SKILLS)) return false;
  const carrier = normSquare(findPlayer(game, playerId)?.playerCoordinate);
  const side = playerSideIsHome(game, playerId);
  if (!carrier || side === null) return false;
  const field = (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[];
  const occupied = new Set(field.map((p) => normSquare(p.playerCoordinate)).filter((c): c is [number, number] => !!c).map((c) => `${c[0]},${c[1]}`));
  const opponents = field.filter((p) => playerSideIsHome(game, p.playerId) === !side);
  const hasTacklezones = (ps: number | undefined): boolean => {
    const st = ps ?? 0;
    const b = baseState(st);
    return (b === BASE_STANDING || b === BASE_MOVING || b === BASE_BLOCKED) && !(st & FLAG_CONFUSED) && !(st & FLAG_HYPNOTIZED);
  };
  const neighbours = ([x, y]: [number, number]): [number, number][] => {
    const out: [number, number][] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if ((dx || dy) && x + dx >= 0 && x + dx < 26 && y + dy >= 0 && y + dy < 15) out.push([x + dx, y + dy]);
    }
    return out;
  };
  return field.some((mate) => {
    if (playerSideIsHome(game, mate.playerId) !== side || baseState(mate.playerState) !== BASE_STANDING) return false;
    const square = normSquare(mate.playerCoordinate);
    if (!square || chebyshev(square, carrier) > 5) return false;
    if (opponents.some((opp) => hasTacklezones(opp.playerState) && chebyshev(normSquare(opp.playerCoordinate) ?? [-99, -99], square) === 1)) return false;
    return neighbours(square).some((dest) => !occupied.has(`${dest[0]},${dest[1]}`)
      && opponents.some((opp) => chebyshev(normSquare(opp.playerCoordinate) ?? [-99, -99], dest) === 1));
  });
}

/** Catch of the Day offer from LogicModule.java:162-172: an unused canGetBallOnGround grantor may act when a
 * MOVING loose ball is within three steps. StepCatchOfTheDay rechecks the same `isBallMoving()` predicate before
 * rolling, then settles a success on the acting player; the client must not substitute a settled-ball heuristic. */
export function catchOfTheDayAvailable(game: GameJson, playerId: string): boolean {
  const acting = game.actingPlayer as {
    playerId?: string | null; hasMoved?: boolean; hasFouled?: boolean; hasBlocked?: boolean; hasPassed?: boolean;
    hasTriggeredEffect?: boolean; forgone?: boolean; usedSkills?: string[];
  } | undefined;
  if (String(acting?.playerId ?? '') !== playerId) return false;
  if (acting?.hasMoved || acting?.hasFouled || acting?.hasBlocked || acting?.hasPassed
      || acting?.hasTriggeredEffect || acting?.forgone || (acting?.usedSkills?.length ?? 0) > 0) return false;
  const fm = game.fieldModel as { ballInPlay?: boolean; ballMoving?: boolean } | undefined;
  if (!hasUnusedGrantor(game, playerId, CAN_GET_BALL_ON_GROUND_SKILLS) || !(fm?.ballInPlay && fm.ballMoving)) return false;
  const player = normSquare(findPlayer(game, playerId)?.playerCoordinate);
  const ball = normSquare(game.fieldModel?.ballCoordinate);
  return !!player && !!ball && chebyshev(player, ball) <= 3;
}

/** `SelectBlitzTargetLogicModule(bb2025):99 isFrenziedRushAvailable`: the acting player has an unused
 * canGainFrenzyForBlitz grantor. The server owns ONCE_PER_HALF usage and revalidates. */
export function frenziedRushAvailable(game: GameJson, playerId: string): boolean {
  const actingId = String((game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  return actingId === playerId && hasUnusedGrantor(game, playerId, CAN_GAIN_FRENZY_FOR_BLITZ_SKILLS);
}

/** `SelectBlitzTargetLogicModule(bb2025):100 isSlashingNailsAvailable` (via base `LogicModule.isSlashingNailsAvailable`
 *  :685-687): same bare-grantor shape as Frenzied Rush, no `hasActed` gate. `skill/bb2025/special/SlashingNails.java`
 *  registers `NamedProperties.canGainClawsForBlitz`, ONCE_PER_HALF (server-owned + revalidated). */
export function slashingNailsAvailable(game: GameJson, playerId: string): boolean {
  const actingId = String((game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  return actingId === playerId && hasUnusedGrantor(game, playerId, CAN_GAIN_CLAWS_FOR_BLITZ_SKILLS);
}

/** `LogicModule.isBlackInkAvailable(ActingPlayer)` (:185-187): `!hasActed() && !isStandingUp()` (ActingPlayer.hasActed
 *  = hasMoved||hasFouled||hasBlocked||hasPassed||hasTriggeredEffect||usedSkills-nonempty, the same union `wisdomAvailable`
 *  mirrors) `&& isBlackInkAvailable(Player)` (:189-199): unused `canGazeAutomatically` grantor AND an adjacent
 *  (Chebyshev-1) OPPONENT that is standing-or-prone and NOT distracted (`PlayerState.isDistracted()` = confused ||
 *  hypnotized, ffb-common PlayerState.java — mirrors `FLAG_CONFUSED`/`FLAG_HYPNOTIZED` above). `skill/mixed/special/
 *  BlackInk.java` registers the grantor, ONCE_PER_GAME. Distinct from Zoat's `canGazeAutomaticallyThreeSquaresAway`. */
export function blackInkAvailable(game: GameJson, playerId: string): boolean {
  const acting = game.actingPlayer as {
    playerId?: string | null; hasMoved?: boolean; hasFouled?: boolean; hasBlocked?: boolean; hasPassed?: boolean;
    hasTriggeredEffect?: boolean; standingUp?: boolean; usedSkills?: string[];
  } | undefined;
  if (String(acting?.playerId ?? '') !== playerId) return false;
  if (acting?.hasMoved || acting?.hasFouled || acting?.hasBlocked || acting?.hasPassed
      || acting?.hasTriggeredEffect || acting?.standingUp || (acting?.usedSkills?.length ?? 0) > 0) return false;
  if (!hasUnusedGrantor(game, playerId, CAN_GAZE_AUTOMATICALLY_SKILLS)) return false;
  const myPos = normSquare(findPlayer(game, playerId)?.playerCoordinate);
  const iAmHome = playerSideIsHome(game, playerId);
  if (!myPos || iAmHome === null) return false;
  for (const p of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    const side = playerSideIsHome(game, p.playerId);
    if (side === null || side === iAmHome) continue; // opponents only
    const b = baseState(p.playerState);
    if (b !== BASE_STANDING && b !== BASE_PRONE) continue;
    if ((p.playerState ?? 0) & (FLAG_CONFUSED | FLAG_HYPNOTIZED)) continue; // isDistracted()
    const pos = normSquare(p.playerCoordinate);
    if (pos && chebyshev(myPos, pos) === 1) return true;
  }
  return false;
}

// ── Star S4: the gaze-trio use-skill elections (Look Into My Eyes / Baleful Hex / Auto Gaze Zoat) ─────
// Grantor sets (JL-2 bare-property grep at upstream/master finds exactly one registrant each, no cancellers):
const CAN_STEAL_BALL_SKILLS = ['Look Into My Eyes']; // canStealBallFromOpponent — skill/mixed/special/LookIntoMyEyes.java:19 (ONCE_PER_GAME)
const CAN_MAKE_OPPONENT_MISS_TURN_SKILLS = ['Baleful Hex']; // canMakeOpponentMissTurn — skill/mixed/special/BalefulHex.java:22 (ONCE_PER_GAME)
const CAN_GAZE_THREE_AWAY_SKILLS = ['"Excuse Me, Are You a Zoat?"']; // canGazeAutomaticallyThreeSquaresAway — skill/bb2025/special/ExcuseMeAreYouAZoat.java:26 (ONCE_PER_GAME); distinct from Black Ink's canGazeAutomatically

/** ActingPlayer.hasActed():464-466 — hasMoved||hasFouled||hasBlocked||hasPassed||hasTriggeredEffect||usedSkills||forgone. */
function actingHasActed(game: GameJson, playerId: string): boolean {
  const acting = game.actingPlayer as {
    playerId?: string | null; hasMoved?: boolean; hasFouled?: boolean; hasBlocked?: boolean; hasPassed?: boolean;
    hasTriggeredEffect?: boolean; forgone?: boolean; usedSkills?: string[];
  } | undefined;
  if (String(acting?.playerId ?? '') !== playerId) return false;
  return !!(acting?.hasMoved || acting?.hasFouled || acting?.hasBlocked || acting?.hasPassed
      || acting?.hasTriggeredEffect || acting?.forgone || (acting?.usedSkills?.length ?? 0) > 0);
}

/** PlayerState.hasTacklezones():230-233 — base STANDING|MOVING|BLOCKED, not confused, not hypnotized. */
function stateHasTacklezones(ps: number | undefined): boolean {
  const st = ps ?? 0;
  const b = baseState(st);
  return (b === BASE_STANDING || b === BASE_MOVING || b === BASE_BLOCKED) && !(st & FLAG_CONFUSED) && !(st & FLAG_HYPNOTIZED);
}

/** `LogicModule.isLookIntoMyEyesAvailable(ActingPlayer)`:239-243 — `!hasActed()` AND the PRE-activation state
 *  had tackle zones (`actingPlayer.getOldPlayerState().hasTacklezones()`; wire mirror `actingPlayer.playerStateOld`)
 *  — AND `(Player)`:245-251: unused `canStealBallFromOpponent` grantor + an ADJACENT blockable opponent
 *  (`findAdjacentBlockablePlayers` ⇒ base STANDING|MOVING, PlayerState.canBeBlocked():247-249) who HAS the ball
 *  (`UtilPlayer.hasBall`:513-519 = ball in play, NOT moving, on that opponent's square). The server owns
 *  ONCE_PER_GAME, the target pick (StepInitLookIntoMyEyes takes the FIRST adjacent carrier) and the roll. */
export function lookIntoMyEyesAvailable(game: GameJson, playerId: string): boolean {
  if (actingHasActed(game, playerId)) return false;
  const acting = game.actingPlayer as { playerId?: string | null; playerStateOld?: number | null } | undefined;
  const oldState = String(acting?.playerId ?? '') === playerId
    ? acting?.playerStateOld
    : findPlayer(game, playerId)?.playerState;
  if (oldState == null || !stateHasTacklezones(oldState)) return false;
  if (!hasUnusedGrantor(game, playerId, CAN_STEAL_BALL_SKILLS)) return false;
  const fm = game.fieldModel as { ballInPlay?: boolean; ballMoving?: boolean; ballCoordinate?: unknown } | undefined;
  if (!fm?.ballInPlay || fm.ballMoving) return false;
  const ball = normSquare(fm.ballCoordinate);
  const myPos = normSquare(findPlayer(game, playerId)?.playerCoordinate);
  const iAmHome = playerSideIsHome(game, playerId);
  if (!ball || !myPos || iAmHome === null) return false;
  for (const p of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    const side = playerSideIsHome(game, p.playerId);
    if (side === null || side === iAmHome) continue; // opponents only
    const b = baseState(p.playerState);
    if (b !== BASE_STANDING && b !== BASE_MOVING) continue; // canBeBlocked()
    const pos = normSquare(p.playerCoordinate);
    if (pos && chebyshev(myPos, pos) === 1 && pos[0] === ball[0] && pos[1] === ball[1]) return true;
  }
  return false;
}

/** `LogicModule.isBalefulHexAvailable(ActingPlayer)`:253-255 — `!hasActed()` — and `(Player)`:257-267: unused
 *  `canMakeOpponentMissTurn` grantor + ANY opponent within `distanceInSteps <= 5` (Chebyshev; NO stance/TZ
 *  filter — a prone or stunned opponent still qualifies). Target choice, roll and the missed-turn enhancement
 *  are server-owned (StepBalefulHex; >1 eligible ⇒ `playerChoiceMode:balefulHex`, declinable). */
export function balefulHexAvailable(game: GameJson, playerId: string): boolean {
  if (actingHasActed(game, playerId)) return false;
  if (!hasUnusedGrantor(game, playerId, CAN_MAKE_OPPONENT_MISS_TURN_SKILLS)) return false;
  const myPos = normSquare(findPlayer(game, playerId)?.playerCoordinate);
  const iAmHome = playerSideIsHome(game, playerId);
  if (!myPos || iAmHome === null) return false;
  return ((game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]).some((p) => {
    if (playerSideIsHome(game, p.playerId) !== (!iAmHome as boolean)) return false; // strict: null side never matches
    const pos = normSquare(p.playerCoordinate);
    return !!pos && chebyshev(myPos, pos) <= 5;
  });
}

/** `LogicModule.isZoatGazeAvailable(ActingPlayer)`:693-695 — `!hasActed() && !isStandingUp()` — and
 *  `(Player)`:697-706: unused `canGazeAutomaticallyThreeSquaresAway` grantor + an opponent WITH tackle zones
 *  (`findPlayersWithTackleZones` ⇒ hasTacklezones():230-233) within 3 squares who is not already distracted
 *  (`!isDistracted()`; hasTacklezones already excludes confused/hypnotized — both limbs kept, byte-faithful).
 *  The bounded pick + the distracted flag are server-owned (StepAutoGazeZoat ⇒ `playerChoiceMode:autoGazeZoat`). */
export function autoGazeZoatAvailable(game: GameJson, playerId: string): boolean {
  if (actingHasActed(game, playerId)) return false;
  const acting = game.actingPlayer as { playerId?: string | null; standingUp?: boolean } | undefined;
  if (String(acting?.playerId ?? '') === playerId && acting?.standingUp) return false;
  if (String(acting?.playerId ?? '') !== playerId
      && baseState(findPlayer(game, playerId)?.playerState) !== BASE_STANDING) return false;
  if (!hasUnusedGrantor(game, playerId, CAN_GAZE_THREE_AWAY_SKILLS)) return false;
  const myPos = normSquare(findPlayer(game, playerId)?.playerCoordinate);
  const iAmHome = playerSideIsHome(game, playerId);
  if (!myPos || iAmHome === null) return false;
  return ((game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]).some((p) => {
    if (playerSideIsHome(game, p.playerId) !== (!iAmHome as boolean)) return false; // strict: null side never matches
    if (!stateHasTacklezones(p.playerState) || ((p.playerState ?? 0) & (FLAG_CONFUSED | FLAG_HYPNOTIZED))) return false;
    const pos = normSquare(p.playerCoordinate);
    return !!pos && chebyshev(myPos, pos) <= 3;
  });
}

// ── Star S7: Treacherous (Hakflem Skuttlespike) + Shot to Nothing (Gloriel Summerbloom) ───────────────
// Grantor sets (bare-property grep at upstream/master, one registrant each, no cancellers):
const CAN_STAB_TEAM_MATE_SKILLS = ['Treacherous']; // canStabTeamMateForBall — skill/mixed/special/Treacherous.java:22 (ONCE_PER_GAME)
export const SHOT_TO_NOTHING_SKILL = 'Shot to Nothing'; // canGainHailMary — skill/mixed/special/ShotToNothing.java:26 (ONCE_PER_GAME)

/** `LogicModule.isTreacherousAvailable(Player)`:154-160 — unused `canStabTeamMateForBall` grantor + an
 *  ADJACENT SAME-TEAM blockable player (`findAdjacentBlockablePlayers` over the ACTING team ⇒
 *  `canBeBlocked()` = base STANDING|MOVING) who HAS the ball (`UtilPlayer.hasBall`:513-519 — in play, NOT
 *  moving, on that team-mate's square). The stab, ball transfer, injury and once-per-game bookkeeping are
 *  server-owned (bb2025 StepTreacherous). */
export function treacherousAvailable(game: GameJson, playerId: string): boolean {
  if (!hasUnusedGrantor(game, playerId, CAN_STAB_TEAM_MATE_SKILLS)) return false;
  const fm = game.fieldModel as { ballInPlay?: boolean; ballMoving?: boolean; ballCoordinate?: unknown } | undefined;
  if (!fm?.ballInPlay || fm.ballMoving) return false;
  const ball = normSquare(fm.ballCoordinate);
  const myPos = normSquare(findPlayer(game, playerId)?.playerCoordinate);
  const iAmHome = playerSideIsHome(game, playerId);
  if (!ball || !myPos || iAmHome === null) return false;
  for (const p of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    if (p.playerId === playerId) continue;
    if (playerSideIsHome(game, p.playerId) !== iAmHome) continue; // team-mates only (null side never matches)
    const b = baseState(p.playerState);
    if (b !== BASE_STANDING && b !== BASE_MOVING) continue; // canBeBlocked()
    const pos = normSquare(p.playerCoordinate);
    if (pos && chebyshev(myPos, pos) === 1 && pos[0] === ball[0] && pos[1] === ball[1]) return true;
  }
  return false;
}

/** `(ActingPlayer)`:150-152 — `!hasActed()` + the player-level check; gates the mid-rail election. */
export function treacherousActingAvailable(game: GameJson, playerId: string): boolean {
  return !actingHasActed(game, playerId) && treacherousAvailable(game, playerId);
}

/** Star S3 (I'll Carry You). Grantor of canCarryPartner — skill/bb2025/special/IllCarryYou.java:70 (ONCE_PER_HALF).
 *  Rides with a roster skill VALUE: "Carrier" on Grak, "Carried" on Crumbleberry (IllCarryYou.VARIANT_* compare
 *  equalsIgnoreCase). While carrying, the CARRIER gains the skill as an active ENHANCEMENT (Break Tackle + Dodge). */
export const ILL_CARRY_YOU_SKILL = "I'll Carry You";

/** Player.getSkillValueExcludingTemporaryOnes mirror (RosterPlayer.java:212): the player's own skillValuesMap
 *  entry, else the roster POSITION's parallel skillArray/skillValues pair (where star variants actually live). */
function skillValueExcludingTemporary(game: GameJson, playerId: string, skillName: string): string {
  const p = findRosterPlayer(game, playerId);
  if (!p) return '';
  const own = (p.skillValuesMap as Record<string, unknown> | undefined)?.[skillName];
  if (own != null) return String(own);
  for (const team of [game.teamHome, game.teamAway]) {
    const positions = ((team as { roster?: { positionArray?: unknown[] } }).roster?.positionArray ?? []) as {
      positionId?: string; skillArray?: string[]; skillValues?: (string | null)[];
    }[];
    const pos = positions.find((entry) => entry.positionId === p.positionId);
    if (pos) {
      const i = (pos.skillArray ?? []).indexOf(skillName);
      return i >= 0 ? String(pos.skillValues?.[i] ?? '') : '';
    }
  }
  return '';
}

/** Player.hasActiveEnhancement(canCarryPartner) mirror: getEnhancementSources() = the union of the three
 *  temporary-map key sets (RosterPlayer.java:792-799); the carry enhancement's source is the skill NAME. */
export function hasActiveCarryEnhancement(game: GameJson, playerId: string): boolean {
  const p = findRosterPlayer(game, playerId);
  if (!p) return false;
  return ILL_CARRY_YOU_SKILL in (p.temporaryModifiersMap ?? {})
    || ILL_CARRY_YOU_SKILL in (p.temporarySkillsMap ?? {})
    || ILL_CARRY_YOU_SKILL in (p.temporaryPropertiesMap ?? {});
}

const INCORPOREAL_SKILL = 'Incorporeal';

/** `ffb-common/.../Player.java` `hasActiveEnhancement` + `RosterPlayer.java` `getEnhancementSources`:
 *  the source is present in any received temporary map. No click-local state participates. */
export function incorporealIsActive(game: GameJson, playerId: string): boolean {
  const p = findRosterPlayer(game, playerId);
  return !!p && (INCORPOREAL_SKILL in (p.temporaryModifiersMap ?? {})
    || INCORPOREAL_SKILL in (p.temporarySkillsMap ?? {})
    || INCORPOREAL_SKILL in (p.temporaryPropertiesMap ?? {}));
}

/** `ffb-client-logic/.../LogicModule.java` `isIncorporealAvailable`: currentMove 0 or
 *  `ffb-common/.../ActingPlayer.java` `hasOnlyStandingUpMove`, then unused canAvoidDodging or active. */
export function incorporealAvailable(game: GameJson, playerId: string): boolean {
  const acting = game.actingPlayer as {
    playerId?: string | null; currentMove?: number; standingUp?: boolean;
  } | undefined;
  if (String(acting?.playerId ?? '') !== playerId) return false;
  if (typeof acting?.currentMove !== 'number' || !Number.isFinite(acting.currentMove)) return false;
  const currentMove = acting.currentMove;
  const atToggleBoundary = currentMove === 0 || (acting?.standingUp === true && currentMove === 3);
  return atToggleBoundary
    && (hasUnusedGrantor(game, playerId, [INCORPOREAL_SKILL]) || incorporealIsActive(game, playerId));
}

/** UtilPlayer.findPickUpPartners (:717-728) ∩ ActingPlayer.isInitialAdjacentPartner (:514): unused CARRIER-variant
 *  skill on the acting player; candidates = currently-adjacent same-side CARRIED-variant holders who were also
 *  adjacent at declaration (the server-synced initialAdjacentPartnerIds). Offer-shaping only; the server re-derives
 *  the candidate set for the playerChoice dialog. */
export function illCarryYouCandidates(game: GameJson, playerId: string): string[] {
  if (!hasUnusedGrantor(game, playerId, [ILL_CARRY_YOU_SKILL])) return [];
  if (skillValueExcludingTemporary(game, playerId, ILL_CARRY_YOU_SKILL).toLowerCase() !== 'carrier') return [];
  const origin = normSquare(findPlayer(game, playerId)?.playerCoordinate);
  const side = playerSideIsHome(game, playerId);
  if (!origin || side === null) return [];
  const initial = new Set(((game.actingPlayer as { initialAdjacentPartnerIds?: string[] } | undefined)
    ?.initialAdjacentPartnerIds ?? []));
  return ((game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[])
    .filter((mate) => {
      if (mate.playerId === playerId || !initial.has(mate.playerId)) return false;
      if (playerSideIsHome(game, mate.playerId) !== side) return false;
      const square = normSquare(mate.playerCoordinate);
      if (!square || chebyshev(origin, square) !== 1) return false;
      return skillValueExcludingTemporary(game, mate.playerId, ILL_CARRY_YOU_SKILL).toLowerCase() === 'carried';
    })
    .map((mate) => mate.playerId);
}

/** LogicModule.isIllCarryYouAvailable (:754-762): not already carrying, and a pick-up candidate exists. */
export function illCarryYouAvailable(game: GameJson, playerId: string): boolean {
  const actingId = String((game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (actingId !== playerId || hasActiveCarryEnhancement(game, playerId)) return false;
  return illCarryYouCandidates(game, playerId).length > 0;
}

/** The paired skill exists on both stars, but only Grak's CARRIER-valued copy owns the activation rail. */
function illCarryYouIsCarrier(game: GameJson, playerId: string): boolean {
  return skillValueExcludingTemporary(game, playerId, ILL_CARRY_YOU_SKILL).toLowerCase() === 'carrier';
}

export type FreshStarActivationRuleId =
  | 'lookIntoMyEyes' | 'balefulHex' | 'excuseMeAreYouAZoat' | 'raidingParty' | 'blackInk';

/** Revalidate activation-entry/interleaved STAR elections from received state. */
export function freshStarActivationAvailable(
  game: GameJson,
  playerId: string,
  ruleId: FreshStarActivationRuleId,
): boolean {
  const player = findPlayer(game, playerId);
  const base = baseState(player?.playerState);
  const isActing = String((game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '') === playerId;
  const legalBase = base === BASE_STANDING || base === BASE_PRONE
    || (isActing && (base === BASE_MOVING || base === BASE_BLOCKED));
  if (!player || !((player.playerState ?? 0) & FLAG_ACTIVE) || !legalBase) return false;
  switch (ruleId) {
    case 'lookIntoMyEyes': return lookIntoMyEyesAvailable(game, playerId);
    case 'balefulHex': return balefulHexAvailable(game, playerId);
    case 'excuseMeAreYouAZoat': return autoGazeZoatAvailable(game, playerId);
    case 'raidingParty': return raidingPartyAvailable(game, playerId);
    case 'blackInk': return blackInkAvailable(game, playerId);
  }
}

/** LogicModule.canPlaceCarriedPlayer (:769-772): carrying and not yet acted (ActingPlayer.hasActed:464-466 —
 *  the raidingParty union INCLUDING forgone). Backs the MOVE-rail "Place Carried Player And End Action" item
 *  (AbstractClientStateMove.java:173-174; MoveLogicPlugin(bb2025) sends useSkill used=false). */
export function canPlaceCarriedPlayerNow(game: GameJson, playerId: string): boolean {
  const acting = game.actingPlayer as {
    playerId?: string | null; hasMoved?: boolean; hasFouled?: boolean; hasBlocked?: boolean; hasPassed?: boolean;
    hasTriggeredEffect?: boolean; forgone?: boolean; usedSkills?: string[];
  } | undefined;
  if (String(acting?.playerId ?? '') !== playerId) return false;
  if (acting?.hasMoved || acting?.hasFouled || acting?.hasBlocked || acting?.hasPassed
      || acting?.hasTriggeredEffect || acting?.forgone || (acting?.usedSkills?.length ?? 0) > 0) return false;
  return hasActiveCarryEnhancement(game, playerId);
}

export interface WideRailActivationOption {
  readonly ruleId: WideRailPreActionRuleId;
  readonly label: string;
}

/** Server-state-driven instruction for Furious Outburst's two square-selection beats. */
export function furiousOutburstCoordinatePrompt(game: GameJson): string | null {
  if (String(game.actingPlayer?.playerAction ?? '') !== 'furiousOutburst'
      || serverMoveSquares(game).length === 0) return null;
  const defenderId = String(game.defenderId ?? '');
  const defender = defenderId
    ? game.fieldModel.playerDataArray.find((player) => player.playerId === defenderId)
    : null;
  return defender && (Number(defender.playerState ?? 0) & 0x01000) !== 0
    ? 'Select square to stab from'
    : 'Select square to end in';
}

/**
 * Rules whose unused property makes a fresh player require the explicit
 * activation menu. This intentionally mirrors the pre-ack carrier check: the
 * parent action has not been declared yet, so action-specific target gates are
 * not available until the server acknowledges that declaration.
 */
export function wideRailActivationMenuOptions(
  game: GameJson,
  playerId: string,
): WideRailActivationOption[] {
  return WIDE_RAIL_PRE_ACTION_RULES
    .filter((rule) => {
      // Frenzied Rush / Slashing Nails exist only in SelectBlitzTarget upstream. They cannot make a fresh
      // player require the full action menu: the coach may still select the player for an ordinary Move, and
      // a Blitz election is armed only by the later legal target click.
      if (rule.blitzTargetStageOnly) return false;
      if (rule.ruleId === 'wisdomOfTheWhiteDwarf') {
        return hasUnusedGrantor(game, playerId, CAN_GRANT_SKILLS_TO_TEAM_MATES_SKILLS);
      }
      if (rule.ruleId === 'illCarryYou') {
        return hasUnusedGrantor(game, playerId, [ILL_CARRY_YOU_SKILL]) && illCarryYouIsCarrier(game, playerId);
      }
      // Owner 08-22: Hakflem must not announce that Treacherous is available merely because the
      // once-per-game skill is unused. The declaration menu is shown before a parent action is chosen,
      // but the complete upstream predicate is already knowable here: Hakflem must be adjacent to the
      // team-mate who currently possesses the ball. This also prevents a dead correlation from making a
      // remote Hakflem look like he has to declare a special action.
      if (rule.ruleId === 'treacherous') return treacherousAvailable(game, playerId);
      // Owner 09-09: Look Into My Eyes (Boa) and Baleful Hex forced the menu on EVERY activation just for carrying
      // the unused skill. Both upstream predicates are knowable before the declare (adjacent blockable ball carrier /
      // any opponent within 5), so gate the forced menu on them exactly like Treacherous.
      if (rule.ruleId === 'lookIntoMyEyes') return lookIntoMyEyesAvailable(game, playerId);
      if (rule.ruleId === 'balefulHex') return balefulHexAvailable(game, playerId);
      if (rule.ruleId === 'incorporeal' && incorporealIsActive(game, playerId)) return true;
      return !!rule.skill && hasUnusedGrantor(game, playerId, [rule.skill]);
    })
    .map(({ ruleId, label }) => ({ ruleId, label }));
}

/**
 * True when the fresh player has an unused grantor from upstream's activation-
 * menu property map (or an active Incorporeal enhancement that can be toggled
 * off). This pre-ack gate cannot yet evaluate action-context target conditions;
 * its only effect is replacing the standing left-click auto-Move shortcut with
 * the already-existing full legal action menu so the parent action is explicit.
 * Consumed stars therefore retain the ordinary byte-identical shortcut.
 */
export function hasWideRailActivationRule(game: GameJson, playerId: string): boolean {
  return wideRailActivationMenuOptions(game, playerId).length > 0;
}

/** Declaration correlation gate: unlike the menu-only carrier check, the player's own unused property must
 * belong to a staged rule on this exact parent action. Auto-paired and source-excluded rails never arm a session. */
export function hasWideRailActivationRuleForAction(
  game: GameJson,
  playerId: string,
  playerAction: string,
): boolean {
  return WIDE_RAIL_PRE_ACTION_RULES.some((rule) => {
    if (wideRailPreActionModeForPlayerAction(rule.ruleId, playerAction) !== 'staged') return false;
    if (rule.ruleId === 'wisdomOfTheWhiteDwarf') {
      return hasUnusedGrantor(game, playerId, CAN_GRANT_SKILLS_TO_TEAM_MATES_SKILLS);
    }
    if (rule.ruleId === 'illCarryYou') {
      return hasUnusedGrantor(game, playerId, [ILL_CARRY_YOU_SKILL]) && illCarryYouIsCarrier(game, playerId);
    }
    // Treacherous is an activation-start decision. Do not arm a post-ack prompt unless its
    // adjacent-ball-carrier condition was true at the declaration boundary.
    if (rule.ruleId === 'treacherous') return treacherousAvailable(game, playerId);
    if (rule.ruleId === 'incorporeal' && incorporealIsActive(game, playerId)) return true;
    return !!rule.skill && hasUnusedGrantor(game, playerId, [rule.skill]);
  });
}

/**
 * Client-owned election evaluated only after the server has echoed an exact
 * acting player + PlayerAction. Each predicate is the existing upstream port;
 * the descriptor adds the per-action-module membership filter. Owner-routed
 * Treacherous Pass/Hand-off/Punt choices use this same explicit post-ack election.
 */
export function wideRailActivationOptions(
  game: GameJson,
  playerId: string,
  playerAction: string,
): WideRailActivationOption[] {
  const eligible: Partial<Record<WideRailPreActionRuleId, boolean>> = {
    treacherous: treacherousActingAvailable(game, playerId),
    wisdomOfTheWhiteDwarf: wisdomAvailable(game, playerId),
    raidingParty: raidingPartyAvailable(game, playerId),
    lookIntoMyEyes: lookIntoMyEyesAvailable(game, playerId),
    balefulHex: balefulHexAvailable(game, playerId),
    catchOfTheDay: catchOfTheDayAvailable(game, playerId),
    blackInk: blackInkAvailable(game, playerId),
    excuseMeAreYouAZoat: autoGazeZoatAvailable(game, playerId),
    incorporeal: incorporealAvailable(game, playerId),
    illCarryYou: illCarryYouAvailable(game, playerId),
    frenziedRush: frenziedRushAvailable(game, playerId),
    slashingNails: slashingNailsAvailable(game, playerId),
  };
  return WIDE_RAIL_PRE_ACTION_RULES
    .filter((rule) => wideRailPreActionModeForPlayerAction(rule.ruleId, playerAction) === 'staged'
      && eligible[rule.ruleId] === true)
    .map(({ ruleId, label }) => ({ ruleId, label }));
}

/** #181 (B): The Flashing Blade OFFER — port of `LogicModule.isFlashingBladeAvailable:540`:
 *  active + NOT prone + unused `canStabAndMoveAfterwards` (ONCE_PER_GAME) + an ADJACENT blockable enemy
 *  (`findAdjacentBlockablePlayers`, the stab is adjacent). Declares `theFlashingBlade` → STAB state → the
 *  order66Interaction star-block branch routes the decorated click (usingStab). Pure; INERT until consulted.
 *  ✅ FB-2 RESOLVED (BA-1, #183): the `mechanic.isBlockActionAllowed(getTurnMode())` limb is now ported via the shared
 *  `blockActionAllowed(game)`. TM-1 REFUTED the original kickoffReturn/passBlock worry (upstream ALLOWS block there —
 *  `GameMechanic:90` = `turnMode != BLITZ`); the real gate is the Blitz!-kickoff turnMode `'blitz'`, shared by all four
 *  block-family offers. */
export function theFlashingBladeAvailable(game: GameJson, playerId: string): boolean {
  if (!blockActionAllowed(game)) return false; // BA-1: no standalone block-variant in the Blitz! kickoff (turnMode 'blitz')
  const b = baseState(findPlayer(game, playerId)?.playerState);
  if (b !== BASE_STANDING) return false; // active && base != PRONE (the acting set is already isActive-gated)
  if (!hasUnusedGrantor(game, playerId, CAN_STAB_AND_MOVE_SKILLS)) return false;
  return adjacentBlockableEnemyIds(game, playerId).length > 0;
}

/** #181 (B): Beer Barrel Bash! OFFER — port of `LogicModule.isBeerBarrelBashAvailable:500`: REGULAR turnMode +
 *  standing + unused `canThrowKeg` (ONCE_PER_DRIVE). No target requirement in the offer (the keg picks its target
 *  at the arm). Consumed by the `throwKey` declare below → Fives' target-arm sends `CLIENT_THROW_KEG`.
 *  ⚠ CORRECTED (Meero SR-154): the earlier note said the keg "couples to `playerThrowKeg`" — that function has ZERO
 *  callers (dead code) and carries two divergences (it declares `throwBomb`, and passes `leaping: isJumping()` where
 *  upstream passes false). Upstream makes the keg a plain top-level declare (`SelectLogicModule` →
 *  `sendActingPlayer(THROW_KEG)`), so it IS a `playerDeclareSet` entry, and the bespoke body is retired, not reused
 *  — a dead function reading as a contract was the trap. */
export function beerBarrelBashAvailable(game: GameJson, playerId: string): boolean {
  if (String((game as { turnMode?: string }).turnMode ?? '') !== 'regular') return false;
  const b = baseState(findPlayer(game, playerId)?.playerState);
  if (b !== BASE_STANDING) return false;
  return hasUnusedGrantor(game, playerId, CAN_THROW_KEG_SKILLS);
}

/** #181 PR-1 (Meero SR-166): the Putrid Regurgitation OFFER (declarability only) — port of
 *  `PutridRegurgitationBlitzLogicModule.isPutridRegurgitationAvailable:83`. A Putrid carrier who has just BLOCKED may
 *  declare an ADDITIONAL Projectile Vomit attack (upstream `PlayerAction:24` "performs an ADDITIONAL Projectile Vomit
 *  attack"). ⚠ PU-1 (the sharp one): reads the RAW acting `playerAction`, NOT the derived state — `clientStateMachine:57`
 *  maps BOTH `putridRegurgitationMove` and `putridRegurgitationBlitz` onto the single state `PUTRID_REGURGITATION_BLITZ`,
 *  so gating on the state would re-offer the vomit AFTER it is already declared. Upstream's `!isMoveAvailable` limb is
 *  OVERRIDDEN (`PutridBlitz:102`) to `playerAction == PUTRID_REGURGITATION_BLITZ` — a RE-DECLARE guard, not a
 *  movement-budget check. The ENTRY into the vomit context is SERVER-driven (the PR-2 skillUse dialog → server sets
 *  `_BLOCK`/`_MOVE` itself); this offer is the `_MOVE`-phase ATTACK declare, sent via the generic `declareAction` (no
 *  new wire), its target click routed by the live star-block branch (`e8bd87b4` + Fives' `6e88f4db`). ⛔ PU-2: the
 *  generic `leaping: isJumping()` in `declareAction` is CORRECT here (upstream passes it, `PutridBlitz:71`) — do NOT
 *  extend the keg's per-site `leaping:false` carve-out; the carve-out is per-site, so no store.ts change is owed. */
export function putridRegurgitationAvailable(game: GameJson, playerId: string): boolean {
  const acting = game.actingPlayer as { playerId?: string | null; playerAction?: string | null; hasBlocked?: boolean } | undefined;
  if (String(acting?.playerId ?? '') !== playerId) return false;                       // acting player only (mid-activation)
  if (String(acting?.playerAction ?? '') === 'putridRegurgitationBlitz') return false; // PU-1: not ALREADY declared (raw action, not state)
  if (acting?.hasBlocked !== true) return false;                                       // must have blocked (modelChangeProcessor:216, synced :242)
  if (!hasUnusedGrantor(game, playerId, CAN_VOMIT_AFTER_BLOCK_SKILLS)) return false;   // unused canUseVomitAfterBlock (ONCE_PER_HALF)
  return adjacentBlockableEnemyIds(game, playerId).length > 0;                         // a legal adjacent vomit target (canBeBlocked)
}

/** #223(b): All You Can Eat OFFER — exact extra limbs from upstream `LogicModule.isAllYouCanEatAvailable:507-510`
 *  on top of the existing Throw Bomb offer: REGULAR turnMode + an unused `canUseThrowBombActionTwice` grantor.
 *  Declaring `allYouCanEat` is the once-per-game commitment; both bombs and the referee roll remain server-owned. */
export function allYouCanEatAvailable(game: GameJson, playerId: string): boolean {
  if (String((game as { turnMode?: string }).turnMode ?? '') !== 'regular') return false;
  const p = findPlayer(game, playerId);
  if (baseState(p?.playerState) !== BASE_STANDING) return false;
  const side = playerSideIsHome(game, playerId);
  if (side === null || !hasSkill(game, playerId, 'bombardier') || teamTurnFlag(game, side, 'bombUsed')) return false;
  return hasUnusedGrantor(game, playerId, CAN_THROW_BOMB_TWICE_SKILLS);
}

/** Star S8: Kick 'em While They're Down! — port of `LogicModule.isKickEmAvailable:521-539`: active state,
 *  `(!blitzUsed || !moveAllowed)`, unused `canUseChainsawOnDownedOpponents` grantor AND `blocksLikeChainsaw`
 *  (sole BB2025 grantor skill/bb2025/Chainsaw.java), plus an opponent whose state `canBeFouled()` (PRONE|STUNNED,
 *  PlayerState.java:251-253) — adjacent for the Block variant, anywhere for the Blitz (walk-to) variant. */
function kickEmOnPitchSquare(coordinate: unknown): [number, number] | null {
  const square = normSquare(coordinate);
  if (!square || square[0] < 0 || square[0] >= PITCH_COLS_A || square[1] < 0 || square[1] >= PITCH_ROWS_A) return null;
  return square;
}

/** The two upstream property limbs shared by the offer and the terminal commit. `Chainsaw` is the sole
 * BB2025 grantor of `blocksLikeChainsaw`; keep this name mirror narrow until that upstream property gains
 * another registrant. Active is server PlayerState.isActive(), not a client-side activation prediction. */
function kickEmCarrierEligible(game: GameJson, playerId: string): boolean {
  const p = findPlayer(game, playerId);
  if (!((p?.playerState ?? 0) & FLAG_ACTIVE) || !kickEmOnPitchSquare(p?.playerCoordinate)) return false;
  return hasUnusedGrantor(game, playerId, KICK_EM_SKILLS) && hasSkill(game, playerId, 'Chainsaw');
}

function kickEmAvailable(game: GameJson, playerId: string, moveAllowed: boolean): boolean {
  const p = findPlayer(game, playerId);
  if (!kickEmCarrierEligible(game, playerId)) return false;
  const side = playerSideIsHome(game, playerId);
  if (side === null) return false;
  if (moveAllowed && teamTurnFlag(game, side, 'blitzUsed')) return false; // (!blitzUsed || !moveAllowed)
  const myPos = kickEmOnPitchSquare(p?.playerCoordinate);
  if (!myPos) return false;
  return ((game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]).some((o) => {
    if (playerSideIsHome(game, o.playerId) !== (!side as boolean)) return false; // opponents only, strict
    const b = baseState(o.playerState);
    if (b !== BASE_PRONE && b !== BASE_STUNNED) return false; // canBeFouled()
    const pos = kickEmOnPitchSquare(o.playerCoordinate);
    return !!pos && (moveAllowed || chebyshev(myPos, pos) === 1);
  });
}

/** `LogicModule.isKickEmBlockAvailable:513` — the stationary variant (adjacent downed target required). */
export function kickEmBlockAvailable(game: GameJson, playerId: string): boolean {
  return kickEmAvailable(game, playerId, false);
}

/** `LogicModule.isKickEmBlitzAvailable:517` — the walking variant. Any on-pitch downed opponent makes the
 * declaration available; the shared Blitz movement rail approaches it, then the target rail owns the adjacent
 * PRONE/STUNNED terminal. Do not narrow the context-menu offer to an already-adjacent target: that removes the
 * only legal way to begin the approach and wedges the declared action. */
export function kickEmBlitzAvailable(game: GameJson, playerId: string): boolean {
  return kickEmAvailable(game, playerId, true);
}

/** Shared Kick 'Em target truth. Both variants may target only opposing, on-pitch PRONE/STUNNED
 * players. The stationary variant narrows that set to adjacent players; the Blitz variant uses the
 * wider set only for declaration availability and never pre-nominates one of them. */
export function kickEmTargetIds(game: GameJson, actingId: string, adjacentOnly: boolean): string[] {
  if (!kickEmCarrierEligible(game, actingId)) return [];
  const actorSquare = kickEmOnPitchSquare(findPlayer(game, actingId)?.playerCoordinate);
  const side = playerSideIsHome(game, actingId);
  if (!actorSquare || side === null) return [];
  const out: string[] = [];
  for (const target of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    if (playerSideIsHome(game, target.playerId) !== (!side as boolean)) continue;
    const base = baseState(target.playerState);
    if (base !== BASE_PRONE && base !== BASE_STUNNED) continue;
    const square = kickEmOnPitchSquare(target.playerCoordinate);
    if (!square || (adjacentOnly && chebyshev(actorSquare, square) !== 1)) continue;
    out.push(target.playerId);
  }
  return out;
}

/** Star S8: Furious Outburst — port of `LogicModule.isFuriousOutburstAvailable:656-668`: active + STANDING base
 *  + `!blitzUsed` + unused `canTeleportBeforeAndAfterAvRollAttack` grantor + a blockable opponent
 *  (`findBlockablePlayers` ⇒ canBeBlocked = STANDING|MOVING) within Chebyshev 3. Target pick
 *  (playerChoiceMode:furiousOutburst), both teleport square sets, the AV-roll attack and the exit are
 *  server-owned (StepInitFuriousOutburst / StepFirst-/SecondMoveFuriousOutburst). */
export function furiousOutburstAvailable(game: GameJson, playerId: string): boolean {
  const p = findPlayer(game, playerId);
  const ps = p?.playerState ?? 0;
  if (!(ps & FLAG_ACTIVE) || baseState(ps) !== BASE_STANDING) return false;
  const side = playerSideIsHome(game, playerId);
  if (side === null || teamTurnFlag(game, side, 'blitzUsed')) return false;
  if (!hasUnusedGrantor(game, playerId, FURIOUS_OUTBURST_SKILLS)) return false;
  const myPos = normSquare(p?.playerCoordinate);
  if (!myPos) return false;
  return ((game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]).some((o) => {
    if (playerSideIsHome(game, o.playerId) !== (!side as boolean)) return false;
    const b = baseState(o.playerState);
    if (b !== BASE_STANDING && b !== BASE_MOVING) return false; // canBeBlocked()
    const pos = normSquare(o.playerCoordinate);
    return !!pos && chebyshev(myPos, pos) <= 3;
  });
}

/** Star S8: "Blastin' Solves Everything" — port of `LogicModule.isThenIStartedBlastinAvailable:273-280`:
 *  unused `canBlastRemotePlayer` grantor + ANY opponent within `distanceInSteps <= 3` (Chebyshev; NO stance
 *  filter — the offer is looser than the commit, which is standing-only, mirroring upstream exactly). BB2025
 *  offers this ONLY from the fresh SELECT declare menu (bb2025 SelectLogicModule:87/:240-244/:369-370); the
 *  mid-action adds are bb2020/mixed plugins the bb2025 plugin set replaces (plugin/bb2025/* carry no
 *  THEN_I_STARTED_BLASTIN), so no declared-rail row exists here on purpose. */
export function thenIStartedBlastinAvailable(game: GameJson, playerId: string): boolean {
  if (!hasUnusedGrantor(game, playerId, BLASTIN_SKILLS)) return false;
  const myPos = normSquare(findPlayer(game, playerId)?.playerCoordinate);
  const side = playerSideIsHome(game, playerId);
  if (!myPos || side === null) return false;
  return ((game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]).some((o) => {
    if (playerSideIsHome(game, o.playerId) !== (!side as boolean)) return false;
    const pos = normSquare(o.playerCoordinate);
    return !!pos && chebyshev(myPos, pos) <= 3;
  });
}

/** Star S8: the legal Blastin' TARGET set — port of `ThenIStartedBlastinLogicModule.isValidTarget:76-92`
 *  for the acting-team seat: Chebyshev ≤ 3 from the acting player, base STANDING (strict — NOT canBeBlocked),
 *  opposing team. The commit is `CLIENT_TARGET_SELECTED{playerId}`; the roll/injury are server-owned
 *  (bb2025 StepThenIStartedBlastin). One rule, two consumers: the router's click gate and any range cue. */
export function blastinTargetIds(game: GameJson, actingId: string): string[] {
  const myPos = normSquare(findPlayer(game, actingId)?.playerCoordinate);
  const side = playerSideIsHome(game, actingId);
  if (!myPos || side === null) return [];
  const out: string[] = [];
  for (const o of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    if (playerSideIsHome(game, o.playerId) !== (!side as boolean)) continue;
    if (baseState(o.playerState) !== BASE_STANDING) continue; // STANDING-strict (:90)
    const pos = normSquare(o.playerCoordinate);
    if (pos && chebyshev(myPos, pos) <= 3) out.push(o.playerId);
  }
  return out;
}

/** Star S8: the Kick 'em chainsaw COMMIT gate — Kick(Em)(Block|Blitz)LogicModule.playerInteraction: unused
 *  `canUseChainsawOnDownedOpponents` + target `isProneOrStunned()` + adjacency. The commit is a plain
 *  CLIENT_BLOCK carrying `usingChainsaw:true` (extension.block(…, false, TRUE, false, false, false)). */
export function kickEmCommitAllowed(game: GameJson, actingId: string, defenderId: string): boolean {
  return kickEmTargetIds(game, actingId, true).includes(defenderId);
}

/** #236: FUMBLEROOSKI mid-move offer — exact port of upstream `LogicModule.java:579-586`:
 *  acting player + uncanceled `canDropBall` + non-null action whose `allowsFumblerooskie()` is true + has ball.
 *  `allowsFumblerooskie()` delegates to `PlayerAction.isMoving()` (`PlayerAction.java:68-71,79-81`), hence the
 *  complete wire-name set below. The BB2025 roster name is exactly "Fumblerooski"
 *  (`skill/bb2025/Fumblerooski.java:11-17`); `My Ball` is the sole BB2025 canceller of `canDropBall`
 *  (`skill/mixed/MyBall.java:10-22`), so its presence makes the grant unavailable. Ball ownership reuses this
 *  module's established `isBallCarrier` mirror of `UtilPlayer.hasBall` rather than deriving a second rule. */
const FUMBLEROOSKI_MOVING_ACTIONS = new Set([
  'move', 'blitzMove', 'handOverMove', 'passMove', 'foulMove', 'throwTeamMateMove',
  'kickTeamMateMove', 'gazeMove', 'putridRegurgitationMove', 'kickEmBlitz', 'secureTheBall', 'puntMove',
]);

/** The wire action half of upstream `PlayerAction.allowsFumblerooskie()` (`PlayerAction.java:68-71,79-81`).
 *  Exported so the post-election view can keep the same already-declared moving action on its movement rail; it
 *  must never infer a fresh MOVE declaration after the dedicated use command. */
export function allowsFumblerooskieAction(action: string | null | undefined): boolean {
  return !!action && FUMBLEROOSKI_MOVING_ACTIONS.has(action);
}

export function fumblerooskieAvailable(game: GameJson, playerId: string): boolean {
  const acting = game.actingPlayer as { playerId?: string | null; playerAction?: string | null } | undefined;
  if (String(acting?.playerId ?? '') !== playerId) return false; // LogicModule.java:580-582 — acting player's skill
  const action = acting?.playerAction;
  if (!allowsFumblerooskieAction(action)) return false; // LogicModule.java:583-584; PlayerAction.java:68-71,79-81
  if (!hasSkill(game, playerId, 'Fumblerooski') || hasSkill(game, playerId, 'My Ball')) return false; // LogicModule.java:582; cited grantor/canceller above
  return isBallCarrier(game, playerId); // LogicModule.java:585 — UtilPlayer.hasBall
}

/** #181 KG-6 (Meero SR-160): the LEGAL keg-target set — port of `bb2025/ThrowKegLogicModule.isValidTarget`:
 *  `distance <= 3 && playerState.getBase() == STANDING && player.getTeam() != actingTeam` — chebyshev ≤ 3 (the keg's
 *  range-3 field), STANDING-strict (NOT canBeBlocked — a keg can't hit a prone/moving player), opposing team only.
 *  ONE rule, TWO consumers: Fives' target-arm (was computing `≤3 ∧ standing ∧ opposing` inline in SpectateView) and
 *  Voss's KG-6 range/peek sink. A second hand-rolled copy of this predicate is the JV-1/#179 duplication shape — the
 *  one that produced the "Pogo Stick" spelling defect — so it lives once, here, and both consumers read it. SR-152:
 *  which players are legal targets is OFFERABILITY, not presentation ⇒ the pure layer. Pure; the server still
 *  validates the send (this only mirrors the constraint, it does not replace the server's check). ⚖ Team idiom is
 *  `playerSideIsHome` opposition — identical to the reviewed sibling `blockableEnemiesTwoAway:181`, and equivalent to
 *  the view's `!iControl` since the thrower is on the acting side. */
export function kegTargetIds(game: GameJson, throwerId: string): string[] {
  const me = findPlayer(game, throwerId);
  const myPos = normSquare(me?.playerCoordinate);
  const iAmHome = playerSideIsHome(game, throwerId);
  if (!myPos || iAmHome === null) return [];
  const out: string[] = [];
  for (const p of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    if (p.playerId === throwerId) continue;
    if (baseState(p.playerState) !== BASE_STANDING) continue; // STANDING-strict (upstream getBase() == STANDING)
    const side = playerSideIsHome(game, p.playerId);
    if (side === null || side === iAmHome) continue;          // opposing team only (team != actingTeam)
    const pos = normSquare(p.playerCoordinate);
    if (pos && chebyshev(myPos, pos) <= 3) out.push(p.playerId); // range-3 field, chebyshev (distanceInSteps)
  }
  return out;
}

/** #181 W0/VV-1 (Meero SR-143): is `defenderId` a legal block target? The server normally broadcasts one dice
 *  decoration per target at declare. The Flashing Blade is the upstream exception: `ClientStateStab` uses
 *  `findAdjacentBlockablePlayers` because `THE_FLASHING_BLADE` is not decorated. Keeping that action intact lets
 *  `StepEndBlocking` continue as MOVE after the stab. Decorations remain the only correct gate for Vicious Vines, whose
 *  legal set is exactly-2-adjacent-excluded (`findBlockablePlayersTwoSquaresAway`): a client "within-2-when-skilled"
 *  rule would OVER-accept adjacent squares the server never decorated and send an illegal command. Do not derive it.
 *  ⚠ TWIN: `store.ts` (#58 SYNCHRONOUS_MULTI_BLOCK SET path) carries an INLINE copy of this same decoration read.
 *  That copy is on #58's frozen block rail; it is NOT touched here (a separate feature owes its own review). When
 *  that rail is next opened, consolidate onto this shared predicate — flag-not-fix, the #179 `movesRandomly` rule. */
export function blockTargetDecorated(game: GameJson, defenderId: string): boolean {
  const acting = game.actingPlayer as { playerId?: string | null; playerAction?: string | null } | undefined;
  const actingId = String(acting?.playerId ?? '');
  if (actingId && acting?.playerAction === 'theFlashingBlade') {
    return adjacentBlockableEnemyIds(game, actingId).includes(defenderId);
  }
  const defCoord = normSquare(findPlayer(game, defenderId)?.playerCoordinate);
  if (!defCoord) return false;
  const decorations = ((game.fieldModel as { diceDecorationArray?: { coordinate?: [number, number] }[] })?.diceDecorationArray) ?? [];
  return decorations.some((dd) => {
    const c = dd.coordinate;
    return Array.isArray(c) && c[0] === defCoord[0] && c[1] === defCoord[1];
  });
}

/** A.5 FOUL — standing DOWN (prone or stunned) enemies adjacent to `playerId`: the legal foul victims (a rules
 *  gate, NOT a prediction — the server validates the clientFoul). Exported for the router's FOUL target click. */
export function adjacentDownEnemyIds(game: GameJson, playerId: string): string[] {
  const me = findPlayer(game, playerId);
  const myPos = normSquare(me?.playerCoordinate);
  const iAmHome = playerSideIsHome(game, playerId);
  if (!myPos || iAmHome === null) return [];
  const out: string[] = [];
  for (const p of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    if (p.playerId === playerId) continue;
    const base = baseState(p.playerState);
    if (base !== BASE_PRONE && base !== BASE_STUNNED) continue; // down enemies only (isProneOrStunned)
    const side = playerSideIsHome(game, p.playerId);
    if (side === null || side === iAmHome) continue; // same side or off-roster
    const pos = normSquare(p.playerCoordinate);
    if (pos && chebyshev(myPos, pos) === 1) out.push(p.playerId);
  }
  return out;
}

/** #113 (bb2025 `JumpMechanic.hasProneOrStunnedPlayersAdjacent`): is a PRONE or STUNNED player (EITHER TEAM)
 *  adjacent to `playerId`? Upstream `hasProneOrStunnedPlayers` does NOT filter side — you may jump over your own
 *  prone teammate too — so this is the any-team variant of adjacentDownEnemyIds. An input to the jump offer-gate. */
export function hasAdjacentProneOrStunned(game: GameJson, playerId: string): boolean {
  const me = findPlayer(game, playerId);
  const myPos = normSquare(me?.playerCoordinate);
  if (!myPos) return false;
  for (const p of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    if (p.playerId === playerId) continue;
    const base = baseState(p.playerState);
    if (base !== BASE_PRONE && base !== BASE_STUNNED) continue;
    const pos = normSquare(p.playerCoordinate);
    if (pos && chebyshev(myPos, pos) === 1) return true;
  }
  return false;
}

/** #113 (bb2025 `JumpMechanic.isAvailableAsNextMove` = `canStillJump && isNextMovePossible`, ported
 *  condition-for-condition — JC-2, Meero SR-46 ↳): may `playerId` declare a JUMP as their next move?
 *    canStillJump = (has the Leap skill OR a prone/stunned player is adjacent, either team) AND NOT movesRandomly;
 *    isNextMovePossible(game, FALSE) = `!isHeldInPlace() && hasMoveLeft(game, false)` — the offer uses jumping=FALSE
 *    (the 2-square jump's affordability is the server's, on the leaping:true send). hasMoveLeft(false), normal turn,
 *    = `currentMove < movement + (goingForIt ? rushes : 0)` (rushes = 2, +1 Sprint — the reach-budget allowance
 *    :269); KICKOFF_RETURN/PASS_BLOCK cap at `< 3`. So the gate is "has a normal step OR a rush left", NOT "≥2 MA"
 *    (my earlier read; ≥2 under-offered the GFI edge + skipped heldInPlace — Meero conceded, refined here).
 *  ⚖ The jump ELIGIBILITY + RESOLUTION (target must be prone/stunned, the AG test, the −(higher of current/dest
 *  marking) modifier, nat-1-fails, fall-over) are the SERVER's — the client only OFFERS the toggle; the server
 *  returns the valid 2-away jump squares on the `leaping:true` re-send (JC-6, [[server-derived-law]]). */
export function jumpAvailable(game: GameJson, playerId: string): boolean {
  if (!jumpCapabilityAvailable(game, playerId)) return false;
  const acting = game.actingPlayer as { playerId?: string; currentMove?: number; heldInPlace?: boolean; goingForIt?: boolean } | undefined;
  if (acting?.playerId !== playerId) return false;   // isNextMovePossible reads the acting player — only it jumps
  if (acting.heldInPlace) return false;              // !isHeldInPlace() — a held player has no next move
  const ma = playerMovement(game, playerId);
  if (!Number.isFinite(ma)) return false;
  const used = Math.max(0, Number(acting.currentMove) || 0);
  const tm = String((game as { turnMode?: string }).turnMode ?? '');
  if (tm === 'kickoffReturn' || tm === 'passBlock') return used < 3; // KICKOFF_RETURN/PASS_BLOCK cap (non-jumping)
  const extraMove = acting.goingForIt ? (hasSkill(game, playerId, 'sprint') ? 3 : 2) : 0; // GFI rushes, once in GFI territory
  return used < (ma + extraMove); // hasMoveLeft(false): a normal step or a rush remains
}

/** Shared Jump/Pogo/Leap capability gate. Ordinary Jump needs an adjacent prone/stunned player; the canLeap
 *  property granted by Leap and Pogo removes that adjacency requirement. Ball & Chain cancels the property and
 *  cannot elect a chosen jump. This is intentionally phase-agnostic: fresh activation and live movement consume
 *  the same truth instead of letting each view re-derive it. */
export function jumpCapabilityAvailable(game: GameJson, playerId: string): boolean {
  return !movesRandomly(game, playerId)
    && (canLeap(game, playerId) || hasAdjacentProneOrStunned(game, playerId));
}

/** A fresh Jump-family activation is a Move declaration with `leaping:true`. The surrounding action builder owns
 *  turn/seat/declare-state gating; this helper owns the player's authoritative activatable stance and capability. */
export function jumpActivationAvailable(game: GameJson, playerId: string): boolean {
  const player = findPlayer(game, playerId);
  const ps = Number(player?.playerState ?? 0);
  const base = baseState(ps);
  return !!player && !!(ps & FLAG_ACTIVE) && (base === BASE_STANDING || base === BASE_PRONE)
    && jumpCapabilityAvailable(game, playerId);
}

/** Display hierarchy follows the strongest capability name. `Pogo Stick` is legacy roster spelling but presents
 *  as Pogo. The returned label is presentation-only; all three choices use the same Jump wire contract. */
export function jumpVerbForPlayer(game: GameJson, playerId: string): 'Pogo' | 'Leap' | 'Jump' {
  if (hasSkill(game, playerId, 'Pogo') || hasSkill(game, playerId, 'Pogo Stick')) return 'Pogo';
  if (hasSkill(game, playerId, 'Leap')) return 'Leap';
  return 'Jump';
}

/** One action projection shared by Modern, Classic, the store sender and the Move rail. Fresh selection declares
 *  Move already in jump mode; live movement toggles the server-echoed leaping flag on the current action. */
export function jumpActionOffer(
  game: GameJson,
  playerId: string,
  phase: 'activation' | 'movement',
): CoachAction | null {
  const available = phase === 'activation'
    ? jumpActivationAvailable(game, playerId)
    : jumpAvailable(game, playerId);
  if (!available) return null;
  const verb = jumpVerbForPlayer(game, playerId);
  const leaping = phase === 'movement'
    && !!(game.actingPlayer as { leaping?: boolean } | undefined)?.leaping;
  return {
    action: 'jump',
    label: leaping ? `Don't ${verb}` : verb,
    kind: 'declare',
    enabled: true,
  };
}

/** #431 (S6 substrate): the OtB frame's jump inputs, read from the acting mover.
 *  PassBlockLogicModule.actionContext:127-140 — JUMP iff isJumpAvailableAsNextMove(game, acting, false);
 *  BOUNDING_LEAP via LogicModule.isBoundingLeapAvailable:570-577 = jump available && an UNUSED skill with
 *  canIgnoreJumpModifiers (sole grantor BoundingLeap.java:24). Mode gating (passBlock-only, !leaping) stays
 *  in OnTheBallController. */
export function onTheBallReactionAvailability(game: GameJson): { jumpAvailable: boolean; boundingLeapSkill: string | null } {
  const actingId = String((game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (!actingId) return { jumpAvailable: false, boundingLeapSkill: null };
  const jump = jumpAvailable(game, actingId);
  return {
    jumpAvailable: jump,
    boundingLeapSkill: jump && hasUnusedSkillNamed(game, actingId, 'Bounding Leap') ? 'Bounding Leap' : null,
  };
}

/** S6: the upstream ordinary-movement states whose actionContext admits BOUNDING_LEAP (BB2025).
 *  MoveLogicModule.actionContext:413-421 — inherited by BlitzLogicModule:21, mixed/PutridRegurgitation-
 *  BlitzLogicModule (extends Blitz), ThrowTeamMateLogicModule:19, bb2020/KickTeamMateLikeThrowLogicModule:19;
 *  own blocks: bb2025/FoulLogicModule:173-175, bb2025/HandOverLogicModule:110-113, bb2025/PassLogicModule
 *  :202-205, bb2025/PuntLogicModule:135-138, PassBlockLogicModule:132-135. GAZE_MOVE (bb2025 module extends
 *  GazeLogicModule, no Jump/BL) and KICKOFF_RETURN (never Jump/BL, drift-guard pinned) stay out. */
export const BOUNDING_LEAP_STATES: ReadonlySet<string> = new Set([
  'MOVE', 'BLITZ', 'PUTRID_REGURGITATION_BLITZ', 'THROW_TEAM_MATE', 'KICK_TEAM_MATE',
  'FOUL', 'HAND_OVER', 'PASS', 'PUNT', 'PASS_BLOCK',
]);

/** S6: Bounding Leap offer on the ordinary-movement rails. Availability is the #431 helper VERBATIM
 *  (never a re-derived Jump predicate); !leaping mirrors every upstream site's isJumping() else-branch. */
export function boundingLeapOffer(game: GameJson, ctx: ClientStateContext): string | null {
  if (!BOUNDING_LEAP_STATES.has(deriveClientState(game, ctx))) return null;
  if ((game.actingPlayer as { leaping?: boolean } | undefined)?.leaping) return null;
  return onTheBallReactionAvailability(game).boundingLeapSkill;
}

/** Owner o66r #6/#12: is there ANY DOWN (prone/stunned) enemy on the pitch that `playerId` could foul? The FOUL
 *  declare must NOT require the victim be ADJACENT (that blocked walk-to-foul — e.g. Rogbut after a pickup) — the
 *  player declares Foul, WALKS to a down enemy (foulMove reach), then boots it. The router still gates the actual
 *  clientFoul on adjacency at target-click; the server validates. (Per owner: strip all foul-declare logic beyond
 *  "a down enemy exists to walk to".) */
export function hasDownEnemy(game: GameJson, playerId: string): boolean {
  const iAmHome = playerSideIsHome(game, playerId);
  if (iAmHome === null) return false;
  return ((game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]).some((p) => {
    const base = baseState(p.playerState);
    if (base !== BASE_PRONE && base !== BASE_STUNNED) return false;
    const side = playerSideIsHome(game, p.playerId);
    return side !== null && side !== iAmHome;
  });
}

/** A.5 HAND-OFF — own standing teammates adjacent to `playerId` (the ball carrier): the legal hand-off catchers
 *  (rules gate; server validates clientHandOver). Exported for the router's HAND_OVER target click. */
export function adjacentOwnTeammateIds(game: GameJson, playerId: string): string[] {
  const me = findPlayer(game, playerId);
  const myPos = normSquare(me?.playerCoordinate);
  const iAmHome = playerSideIsHome(game, playerId);
  if (!myPos || iAmHome === null) return [];
  const out: string[] = [];
  for (const p of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    if (p.playerId === playerId || baseState(p.playerState) !== BASE_STANDING) continue;
    if (playerSideIsHome(game, p.playerId) !== iAmHome) continue; // my side only
    const pos = normSquare(p.playerCoordinate);
    if (pos && chebyshev(myPos, pos) === 1) out.push(p.playerId);
  }
  return out;
}

/** HIGH_KICK server floor mirrors `HighKickLogicModule.isPlayerSelectable` (:68-76): ACTIVE + acting team.
 *  The acting team is keyed by `homePlaying`, not upstream's literal `getTeamHome()`; that rejects every AWAY nominee.
 *  Local eligibility restores that bit's standing-on-pitch meaning, minus opposing tackle zones exactly as
 *  bb2025 `SetupMechanic.pinPlayersInTacklezones` (:135-148). */
export function highKickNomineeIds(game: GameJson): string[] {
  const actingSide = !!(game as { homePlaying?: boolean }).homePlaying;
  const out: string[] = [];
  for (const p of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    if (playerSideIsHome(game, p.playerId) !== actingSide) continue; // acting-side team only
    const serverOffered = ((p.playerState ?? 0) & FLAG_ACTIVE) !== 0; // isActive()
    const square = highKickPitchSquare(p.playerCoordinate);
    /*
     * OWNER-RULED CLIENT-SIDE DIVERGENCE (2026-08-17): upstream StepDwarfenWisdom.leave() never restores
     * cleared ACTIVE bits; union local eligibility with the server-sent set. See
     * ../docs/artifact-orchestration/upstream-contribution-candidates.md (08-17).
     * Yularen 2026-07-12 (no client TZ gate) is superseded for LOCAL only; the server floor is never TZ-filtered.
     */
    const locallyEligible = square !== null
      && baseState(p.playerState) === BASE_STANDING
      && tzPlayersAdjacent(game, square, !actingSide).length === 0;
    if (serverOffered || locallyEligible) out.push(p.playerId);
  }
  return out;
}

function highKickPitchSquare(coordinate: unknown): [number, number] | null {
  const square = normSquare(coordinate);
  if (!square || square[0] < 0 || square[0] >= PITCH_COLS_A || square[1] < 0 || square[1] >= PITCH_ROWS_A) return null;
  return square;
}

/**
 * EFFECTIVE MA for the movement budgets — `Player.getMovementWithModifiers()` (Player.java:229-231), i.e. the
 * base roster MA plus every `temporaryModifiersMap` MA modifier, clamped by the ruleset limit. Greasy Cleats'
 * temporary -1 must shrink the offer budget; the base roster stat itself is never mutated. NaN when the player
 * is unknown, so the existing `Number.isFinite` guards still fire.
 */
function playerMovement(game: GameJson, playerId: string): number {
  const player = findRosterPlayer(game, playerId);
  return player ? effectiveMovement(player) : Number.NaN;
}

/** True if `playerId` carries `skill` (name-normalized: lowercase, alpha-only). "No Hands" → "nohands". */
function hasSkill(game: GameJson, playerId: string, skill: string): boolean {
  const norm = skill.toLowerCase().replace(/[^a-z]/g, '');
  return findSkillArray(game, playerId).some((s) => s.toLowerCase().replace(/[^a-z]/g, '') === norm);
}

/** Mirror the server properties `NamedProperties.preventRegularPassAction` and
 *  `NamedProperties.preventRegularHandOverAction`, checked by `LogicModule.isPassActionAvailable`
 *  (`LogicModule.java:375-383`, property check at :382) and `isHandOverActionAvailable`
 *  (`LogicModule.java:397-405`, property check at :404). `UtilPlayer.isBallAvailable` (`UtilPlayer.java:505-511`)
 *  and `hasBall` (:512-518) carry NO property clause: upstream's No Ball / No Hands exclusion in those two action
 *  predicates is entirely the direct property clauses at `LogicModule.java:382` and :404, exactly what this set
 *  mirrors. The properties share the same grantors today: BB2025 `BallAndChain.java:27-28`, BB2025
 *  `NoBall.java:26-27`, mixed `MyBall.java:20-21`, and bb2020 `NoHands.java:26-27` (bb2016 `NoHands.java`
 *  likewise). No Hands is out of the BB2025 collection but already live in this name-modelled client, so it belongs
 *  in the single property mirror. Maintain this list by re-running a bare grep for both property names; if a future
 *  skill registers only one property, split this into separate grantor sets and helpers. */
const PREVENT_REGULAR_PASS_OR_HAND_OVER_SKILLS = ['My Ball', 'Ball and Chain', 'No Ball', 'No Hands'];
function preventsRegularPassOrHandOver(game: GameJson, playerId: string): boolean {
  return PREVENT_REGULAR_PASS_OR_HAND_OVER_SKILLS.some((s) => hasSkill(game, playerId, s));
}

// Recover-block grantors — bb2025 `BallAndChain.java:29-30` is the SOLE grantor of BOTH properties (bare-property
// grep). Kept as two named sets to mirror the DISTINCT upstream properties: if a future skill registers only one,
// the gate splits without touching call sites. Eye-gouge Recover has NO property guard (LogicModule:670-675).
const PREVENT_RECOVER_FROM_CONFUSION_SKILLS = ['Ball and Chain']; // NamedProperties.preventRecoverFromConcusionAction
const PREVENT_RECOVER_FROM_GAZE_SKILLS = ['Ball and Chain']; // NamedProperties.preventRecoverFromGazeAction
function preventsRecoverFromConfusion(game: GameJson, playerId: string): boolean {
  return PREVENT_RECOVER_FROM_CONFUSION_SKILLS.some((s) => hasSkill(game, playerId, s));
}
function preventsRecoverFromGaze(game: GameJson, playerId: string): boolean {
  return PREVENT_RECOVER_FROM_GAZE_SKILLS.some((s) => hasSkill(game, playerId, s));
}

/** Hail Mary Pass is the sole `canPassToAnySquare` grantor. */
const CAN_PASS_TO_ANY_SQUARE_SKILLS = ['Hail Mary Pass'];
function canPassToAnySquare(game: GameJson, playerId: string): boolean {
  return CAN_PASS_TO_ANY_SQUARE_SKILLS.some((s) => hasSkill(game, playerId, s));
}

/** BB2025 Punt property mirrors. `Punt.java:13-20` is the sole `canPunt` grantor; `NoBall.java:18-29`
 *  names the sole `preventPuntAction` grantor exactly "No Ball". Keep these as capabilities, not inline names. */
const CAN_PUNT_SKILLS = ['Punt'];
const PREVENT_PUNT_ACTION_SKILLS = ['No Ball'];
function canPunt(game: GameJson, playerId: string): boolean {
  return CAN_PUNT_SKILLS.some((s) => hasSkill(game, playerId, s));
}
function preventsPuntAction(game: GameJson, playerId: string): boolean {
  return PREVENT_PUNT_ACTION_SKILLS.some((s) => hasSkill(game, playerId, s));
}

function gameOptionEnabled(game: GameJson, optionId: string): boolean {
  const value = game.gameOptions?.gameOptionArray?.find((option) => option.gameOptionId === optionId)?.gameOptionValue;
  return value === 'true' || value === '1';
}

/** Law 10d: fresh declares are legal only before the acting player has activation progress. This port can call
 *  `playerDeclareSet` for an already-acting player because `deriveClientState` falls back to SELECT_PLAYER when its
 *  action is null/unmapped (`clientStateMachine.ts:144-156`; call site below). Every field read here is carried by
 *  our acting-player model: initial JSON is `ActingPlayer.java:521-548`, and incremental setters are
 *  `modelChangeProcessor.ts:213-248`. */
function declaresAllowed(game: GameJson): boolean {
  const acting = game.actingPlayer as {
    playerId?: string | null; playerAction?: string | null; currentMove?: number; standingUp?: boolean;
    hasMoved?: boolean; hasFouled?: boolean; hasBlocked?: boolean; hasPassed?: boolean; hasFed?: boolean;
    hasJumped?: boolean; hasTriggeredEffect?: boolean; usedSkills?: unknown[];
  } | undefined;
  if (!acting?.playerId) return true;
  // ⚖ [SOURCE] the switch-away boundary is `currentMove == 0 || hasOnlyStandingUpMove()`
  //  (bb2025 `StepInitSelecting.java:149-151,157` — the clean-undo switch boundary), where
  //  `ActingPlayer.hasOnlyStandingUpMove() = isStandingUp() && currentMove == MINIMUM_MOVE_TO_STAND_UP`
  //  (`ActingPlayer.java:498`; `Constant.MINIMUM_MOVE_TO_STAND_UP = 3`). A player who has ONLY stood up can still
  //  be switched away from — counting the stand-up move as progress over-blocks the legal stand-then-switch
  //  (Meero, Echo R1). So BOTH stand-up spendings are exempt: a paid stand-up (currentMove == 3, standingUp) via
  //  hasOnlyStandingUpMove, and a free stand-up (currentMove == 0, canStandUpForFree) via the currentMove == 0 arm;
  //  the old `!standingUp` clause wrongly blocked both. Real progress (moved/blocked/etc.) still empties the menu.
  //  ⚖ `!playerAction` is DROPPED (Meero/Kallus/Echo, [SOURCE] StepInitSelecting.java:127 setStandingUp(true) +
  //  :137 changePlayerAction + :144 reads getPlayerAction().isBlitzing()): a stood-up actor RETAINS a non-null
  //  playerAction (standUp/MOVE), so ANDing `!playerAction` made the exemption a no-op. Upstream's clean-undo
  //  boundary (:149-151) gates on action-UNUSED + zero-progress (`unusedBlitz = isBlitzing() && !hasBlocked()`) —
  //  NEVER on playerAction-presence; the real-progress cluster below IS that "unused" check and stays load-bearing.
  const currentMove = Number(acting?.currentMove ?? 0);
  const hasOnlyStandingUpMove = !!acting?.standingUp && currentMove === 3;
  return (currentMove === 0 || hasOnlyStandingUpMove)
    && !acting?.hasMoved && !acting?.hasFouled
    && !acting?.hasBlocked && !acting?.hasPassed && !acting?.hasFed && !acting?.hasJumped
    && !acting?.hasTriggeredEffect && (acting?.usedSkills?.length ?? 0) === 0;
}

/** #50 (SR-10 / SL-1): mirror the server's `player.hasSkillProperty(NamedProperties.canStandUpForFree)` — the
 *  CAPABILITY, not a scattered skill-name check. Upstream's block predicate (`LogicModule.isBlockActionAvailable`,
 *  LogicModule.java:290-291) lets a PRONE player declare Block iff they hold this property. The property is
 *  registered by EXACTLY ONE skill, UNCONDITIONALLY — Jump Up (`JumpUp.java:27`
 *  `registerProperty(NamedProperties.canStandUpForFree)`; verified the SOLE grantor across upstream, no state
 *  grants/denies it in the predicate). The client models skills by NAME, so the grantor set is the client-side
 *  mirror of the property — if a future BB2025 skill registers `canStandUpForFree`, add it to THIS list (one
 *  place), keeping the capability (not an inline `hasSkill('Jump Up')`) as the source of truth. */
const CAN_STAND_UP_FOR_FREE_SKILLS = ['Jump Up'];
function canStandUpForFree(game: GameJson, playerId: string): boolean {
  return CAN_STAND_UP_FOR_FREE_SKILLS.some((s) => hasSkill(game, playerId, s));
}

/** #179 (P2, Meero SR-138 JL-1/JL-2): mirror `player.hasSkillProperty(NamedProperties.canLeap)` — the CAPABILITY,
 *  exactly as the `canStandUpForFree` set above does. This one is NOT a hypothetical: the jump offer used to test
 *  the NAME `'Leap'` inline, and bb2025 has a SECOND grantor, so **Goblin Pogoers and Snotling Fun-hoppas were
 *  refused a jump the server would have allowed** — an ordinary-play denial of a legal action, not a rare path.
 *  ⚠ JL-2 — THE INSTRUMENT, so the next person EXTENDS THE SET BY RE-RUNNING IT rather than trusting this line.
 *  Grep the PROPERTY BARE — not `registerProperty(...)`:
 *      git grep -n "NamedProperties.canLeap" upstream/master -- '*.java'
 *  ⚠ IN-1 (Meero SR-139, and the narrow form was MY error): the obvious grep `registerProperty(NamedProperties
 *  .canLeap)` misses **`registerConflictingProperty(...)`** — which is how `BallAndChain` relates to this property,
 *  and Echo's broader sweep is what surfaced it while my recorded instrument would not have. **A grantor sweep
 *  that cannot see CANCELLERS is not a sweep of the capability.** The bare grep returns both kinds; read each hit
 *  and route it: GRANTERS join the set below, CANCELLERS belong on an exclusion limb.
 *  At `upstream/master` it returns bb2016 `Leap`, bb2020 `Leap` + `PogoStick`, and for OUR ruleset exactly
 *  **`skill/bb2025/Leap.java:26` and `skill/bb2025/Pogo.java:20`** as GRANTERS — hence the entries below — plus
 *  **`bb2025/BallAndChain.java:53` as a CANCELLER**, which is deliberately NOT handled here: `movesRandomly`
 *  already excludes it upstream of this check, and duplicating that would give one rule two homes.
 *  ⚠ SAME CLASS ONE FUNCTION OVER, flagged not fixed (it is a BEHAVIOUR change and so owes the JL-1 tooth
 *  pairing, which a comment-only touch must not smuggle in): `movesRandomly` is itself a single-name test for
 *  `'Ball and Chain'`. Correct today; give it this same treatment when it is next touched.
 *  ⚠ WHY A NAME SET AT ALL: the wire models skills by NAME only (no property payload), so a grantor set is the
 *  only client-side mirror available — the same structural limit recorded on `canStandUpForFree`.
 *  ⚠⚠ AND WHY `'Pogo Stick'` IS HERE despite NOT being a bb2025 grantor — this is the half the code sweep alone
 *  would have missed, and it nearly shipped missing. Matching happens against the ROSTER's skill strings, and the
 *  roster data is whatever FUMBBL exported, not what our ruleset spells: `roster_team_1064979.xml` is LIVE (not
 *  quarantined) and carries the bb2020 spelling **"Pogo Stick"**, which `hasSkill` normalises to `pogostick` —
 *  no match for `pogo`. Six live rosters say `Pogo`, a seventh says `Pogo Stick`; a set built only from the
 *  bb2025 source sweep fixes six teams and silently keeps the bug for the seventh.
 *  ⇒ **THE SET IS THE UNION OF TWO SWEEPS, and both must be re-run: the PROPERTY over upstream source (JL-2
 *  above), and the SKILL STRING over the live roster data.** Source tells you which capability; data tells you
 *  what it is called here. Either sweep alone is a wrong answer that looks complete.
 *  📌 THE LESSON THIS SET EXISTS TO CARRY (mine, and it is why JL-2 asks for the instrument rather than the list):
 *  the `canStandUpForFree` comment TOLD the next reader to maintain a grantor set — and the very next capability
 *  I wrote used an inline name test anyway. **A rule stated in one function does not propagate to the next by
 *  being true.** Prefer grepping the property over reading either comment. */
const CAN_LEAP_SKILLS = ['Leap', 'Pogo', 'Pogo Stick'];
function canLeap(game: GameJson, playerId: string): boolean {
  return CAN_LEAP_SKILLS.some((s) => hasSkill(game, playerId, s));
}

/** Owner o66ad #8: BLITZ is offered only when a standing enemy is within MOVE distance — i.e. this player could
 *  reach a square ADJACENT to it. Rough (chebyshev, roll-free) budget = MA − currentMove − (prone ? 3 : 0) + rushes;
 *  reaching adjacency to an enemy at chebyshev D costs ≥ D−1 steps, so the gate is `D − 1 ≤ budget`. This is a
 *  PERMISSIVE lower bound (ignores blockers/dodges) so it never HIDES a legal blitz — it only drops the obviously
 *  out-of-range declare (⚖ same reach-geometry allowance as the movement planner; the server still validates). */
function blitzableEnemyExists(game: GameJson, playerId: string, p: PlayerDataLike): boolean {
  const myPos = normSquare(p.playerCoordinate);
  const iAmHome = playerSideIsHome(game, playerId);
  if (!myPos || iAmHome === null) return false;
  let ma = playerMovement(game, playerId);
  ma = Number.isFinite(ma) && ma >= 0 ? Math.min(ma, 9) : 6; // NaN-proof, matches renderer safeMovement
  const acting = game.actingPlayer as { playerId?: string; currentMove?: number } | undefined;
  const used = acting?.playerId === playerId ? Math.max(0, Number(acting.currentMove) || 0) : 0;
  ma = Math.max(0, ma - used);
  if (baseState(p.playerState) === BASE_PRONE) ma = Math.max(0, ma - 3); // stand-up costs 3
  const budget = ma + (hasSkill(game, playerId, 'sprint') ? 3 : 2);
  for (const q of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    if (q.playerId === playerId || baseState(q.playerState) !== BASE_STANDING) continue;
    const side = playerSideIsHome(game, q.playerId);
    if (side === null || side === iAmHome) continue; // standing enemy only
    const pos = normSquare(q.playerCoordinate);
    if (pos && chebyshev(myPos, pos) - 1 <= budget) return true;
  }
  return false;
}

/** Owner o66am (TTM, pass-rail): is there a THROWABLE (Right Stuff) same-side team-mate ON THE PITCH for
 *  `playerId` to throw? (isThrowTeamMateActionAvailable's core — the thrower has the skill, gated by the caller;
 *  the walk-to-adjacent + can-be-thrown adjacency is enforced at the team-mate click / server.) */
function hasThrowableTeammate(game: GameJson, playerId: string): boolean {
  const iAmHome = playerSideIsHome(game, playerId);
  if (iAmHome === null) return false;
  return ((game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]).some((p) => {
    if (p.playerId === playerId) return false;
    const pos = normSquare(p.playerCoordinate);
    if (!pos || pos[0] < 0 || pos[0] > 25 || pos[1] < 0 || pos[1] > 14) return false; // on-pitch
    if (playerSideIsHome(game, p.playerId) !== iAmHome) return false; // my side
    return findSkillArray(game, p.playerId).some((s) => s.toLowerCase().replace(/[^a-z]/g, '') === 'rightstuff');
  });
}

/** The block-kind flavors `playerId` can use (from its skillArray). */
export function blockKindsOf(game: GameJson, playerId: string): BlockKind[] {
  const out: BlockKind[] = [];
  for (const s of findSkillArray(game, playerId)) {
    const k = BLOCK_KIND_BY_SKILL[s.toLowerCase().replace(/[^a-z]/g, '')];
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** #207: server-mirrored block-alternative offers. These are block KINDS, never PlayerAction declares: on both a
 * standalone Block and a Blitz the selected kind rides the existing `clientBlock` USING_* flags. Used-state applies
 * only to the two upstream `getUnusedSkillWithProperty` alternatives. No target/odds eligibility is invented here. */
export function blockAlternativeOffers(game: GameJson, playerId: string): BlockAlternativeOffer[] {
  const p = findPlayer(game, playerId);
  const base = baseState(p?.playerState);
  if (base !== BASE_STANDING && base !== BASE_MOVING) return []; // specialBlocksAvailable / declare-condition stance
  const unusedProperties = new Set<BlockAlternativeProperty>([
    'canPerformArmourRollInsteadOfBlockThatMightFail',
    'canPerformArmourRollInsteadOfBlockThatMightFailWithTurnover',
  ]);
  return (Object.keys(BLOCK_ALTERNATIVE_GRANTORS) as BlockAlternativeProperty[]).flatMap((property) => {
    const grantors = BLOCK_ALTERNATIVE_GRANTORS[property];
    const offered = unusedProperties.has(property)
      ? hasUnusedGrantor(game, playerId, grantors)
      : grantors.some((skill) => hasSkill(game, playerId, skill));
    if (!offered) return [];
    const kind = BLOCK_ALTERNATIVE_KIND[property];
    return [{ property, kind, label: BLOCK_KIND_LABEL[kind] }];
  });
}

// Star S5 (Gored by the Bull) grantor sets — one-to-one with upstream NamedProperties:
// canAddBlockDie ⇒ Gored By The Bull ONLY (skill/mixed/special/GoredByTheBull.java:19-20, TRAIT ONCE_PER_GAME);
// canMoveBeforeBeingBlocked ⇒ Ball and Chain (skill/bb2025/BallAndChain.java:14) + Trickster (skill/mixed/Trickster.java:14).
const CAN_ADD_BLOCK_DIE_SKILLS: readonly string[] = ['Gored By The Bull'];
const CAN_MOVE_BEFORE_BEING_BLOCKED_SKILLS: readonly string[] = ['Ball and Chain', 'Trickster'];

/** Star S5: mirror of upstream `BlockLogicExtension.isGoredAvailable()` (ffb-client-logic, :224-239), evaluated at
 *  the blitz block-commit against the SERVER's own decorations — never a client dice derivation:
 *  • a live target selection whose selected id IS this defender (upstream reads `targetSelectionState.getSelectedPlayerId()`;
 *    the id-match is the fail-safe under-offer direction when a caller's held target races a model change);
 *  • the blitzer holds UNUSED canAddBlockDie (`UtilCards.hasUnusedSkillWithProperty`);
 *  • the server decorated the target square, with nrOfDice 1 or 2 — or 3 only when the DEFENDER holds unused
 *    canMoveBeforeBeingBlocked (upstream `opponentCanMove`); uphill (negative) decorations never qualify;
 *  • blitzer adjacent to the target (`targetCoordinate.isAdjacent(playerCoordinate)`).
 *  Offered only from the blitz commit (upstream gates `isGoredAvailable() && pDoBlitz`, :190); a standalone Block
 *  has no target selection so this returns false there by construction. */
export function goredByTheBullAvailable(game: GameJson, playerId: string, targetId: string): boolean {
  const tss = (game.fieldModel as { targetSelectionState?: { playerId?: unknown; targetSelectionStatus?: unknown } | null } | undefined)?.targetSelectionState;
  if (!tss || String(tss.targetSelectionStatus ?? '') !== 'SELECTED' || String(tss.playerId ?? '') !== targetId) return false;
  if (!hasUnusedGrantor(game, playerId, CAN_ADD_BLOCK_DIE_SKILLS)) return false;
  const myPos = normSquare(findPlayer(game, playerId)?.playerCoordinate);
  const targetPos = normSquare(findPlayer(game, targetId)?.playerCoordinate);
  if (!myPos || !targetPos || chebyshev(myPos, targetPos) !== 1) return false;
  const decorations = ((game.fieldModel as { diceDecorationArray?: { coordinate?: [number, number]; nrOfDice?: number }[] })?.diceDecorationArray) ?? [];
  const decoration = decorations.find((d) => Array.isArray(d.coordinate) && d.coordinate[0] === targetPos[0] && d.coordinate[1] === targetPos[1]);
  if (!decoration) return false;
  const dice = Number(decoration.nrOfDice ?? 0);
  return dice === 1 || dice === 2 || (dice === 3 && hasUnusedGrantor(game, targetId, CAN_MOVE_BEFORE_BEING_BLOCKED_SKILLS));
}

/** BB2025 Chomp offer, condition-for-condition: the special-block stance is STANDING/MOVING
 * (`LogicModule.isSpecialBlockActionAvailable:719-730`); `canChomp` is `canPinPlayers`, granted by Monstrous Mouth
 * (`LogicModule:750-752`; `MonstrousMouth.java:14,18-21`); and at least one adjacent blockable opponent has not
 * already been chomped by this player (`LogicModule.isChompAvailable:740-747`). The map lookup is the upstream
 * once-per-chomper/chompee-pair rule (`FieldModel.notChomped:1069-1071`). The surrounding emit branch owns the
 * block-action turn rail and adjacency shared by the sibling rows. */
export function chompAvailable(game: GameJson, playerId: string): boolean {
  const base = baseState(findPlayer(game, playerId)?.playerState);
  if (base !== BASE_STANDING && base !== BASE_MOVING) return false;
  if (!CHOMP_GRANTORS.some((skill) => hasSkill(game, playerId, skill))) return false;
  const chompedTargets = (game.fieldModel?.chomped?.[playerId] as string[] | undefined) ?? [];
  return adjacentBlockableEnemyIds(game, playerId).some((targetId) => !chompedTargets.includes(targetId));
}

/** Display-only armour target for the special-attack preview; it never mutates or predicts game state. Chainsaw
 * applies +3 unless Iron Hard Skin cancels skill armour modifiers; Stab/Vomit/Breathe Fire use the defender's
 * effective armour unchanged. Breathe Fire reaches that roll only on its server-owned natural-6 result. */
export function blockAlternativeArmourTarget(game: GameJson, defenderId: string, kind: BlockKind): number | null {
  const player = findRosterPlayer(game, defenderId);
  const av = player ? effectiveArmour(player) : Number.NaN;
  if (!Number.isFinite(av) || av <= 0) return null;
  if (kind === 'chainsaw') return hasSkill(game, defenderId, 'Iron Hard Skin') ? av : Math.max(2, av - 3);
  if (kind === 'stab' || kind === 'vomit' || kind === 'breatheFire') return av;
  return null;
}

function findPlayer(game: GameJson, id: string): PlayerDataLike | undefined {
  const arr = (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[];
  return arr.find((p) => p.playerId === id);
}

/** Normalize a model/click coordinate ([x,y] tuple or {x,y} object) to a tuple; null if unrecognized. */
export function normSquare(c: unknown): [number, number] | null {
  if (Array.isArray(c) && c.length >= 2) return [Number(c[0]), Number(c[1])];
  if (typeof c === 'object' && c && 'x' in c && 'y' in c) return [Number((c as { x: number }).x), Number((c as { y: number }).y)];
  return null;
}

/** Coordinate equality tolerant of [x,y] tuples or {x,y} objects (model uses tuples; be defensive). */
export function sameSquare(a: unknown, b: unknown): boolean {
  const na = normSquare(a), nb = normSquare(b);
  return !!na && !!nb && na[0] === nb[0] && na[1] === nb[1];
}

/** The server-offered move squares (fieldModel.moveSquareArray) as tuples — the ONLY legal step targets. */
export function serverMoveSquares(game: GameJson): [number, number][] {
  const arr = (game.fieldModel?.moveSquareArray ?? []) as { coordinate?: unknown }[];
  return arr.map((sq) => normSquare(sq?.coordinate)).filter((c): c is [number, number] => c != null);
}

/** Ball & Chain (the movesRandomly trait): the player's move is a random SCATTER, not a chosen walk. Upstream
 *  (UtilServerPlayerMove:87-97 + StepMoveBallAndChain) sends ≤4 orthogonal AIM squares in fieldModel.
 *  moveSquareArray; the coach clicks one as a FACING, the server rolls the throw-in template (3 dirs) → the
 *  Fanatic scatters 1 square (2-in-3 lands elsewhere, maybe off-board). ⟹ the o66 overlay must arm the SERVER's
 *  aim set verbatim (serverMoveSquares), never the client MA reach, and the click is a single stepMove (no walk,
 *  no optimistic placement). Detected by the Ball and Chain skill (grants NamedProperties.movesRandomly). */
export function movesRandomly(game: GameJson, playerId: string): boolean {
  return hasSkill(game, playerId, 'Ball and Chain');
}

interface MoveSquareLike { coordinate?: unknown; minimumRollGfi?: number; minimumRollDodge?: number }
/** The server's move squares as `x,y`→{gfi,dodge} where each value is the SERVER-derived MINIMUM ROLL for that
 *  square (0 = not required), read from MoveSquare.minimumRollGfi/minimumRollDodge (⚖: Go-For-It + dodge are
 *  the server's numbers — upstream MoveLogicModule.kind(); we never compute the roll client-side). The o66 move
 *  overlay renders the actual "D N+" dodge chip + rush die from these. (Boolean truthiness — `?.gfi`/`?.dodge`
 *  — still works: 0 is falsy, a real roll >0 is truthy, so the route-risk tiebreak is unaffected.) */
export function moveSquareInfo(game: GameJson): Map<string, { gfi: number; dodge: number }> {
  const m = new Map<string, { gfi: number; dodge: number }>();
  for (const sq of (game.fieldModel?.moveSquareArray ?? []) as MoveSquareLike[]) {
    const c = normSquare(sq?.coordinate);
    if (c) m.set(`${c[0]},${c[1]}`, { gfi: Number(sq.minimumRollGfi ?? 0), dodge: Number(sq.minimumRollDodge ?? 0) });
  }
  return m;
}

/**
 * AUTOMOVE routing (owner-directed, ported from upstream MoveLogicModule.automovePath / PathFinder): the shortest
 * route from `from` to `to` stepping ONLY through server-offered move squares — never off the reachable set the
 * server sent (⚖: the reach is the server's, we only pick a path THROUGH it). Among shortest routes prefers fewer
 * rush/dodge squares (the server's own per-square minimums, not client roll math). Returns the path EXCLUDING
 * `from`, or null if `to` isn't a server square / unreachable within the offered set. 8-directional (BB movement).
 */
export function routeThroughMoveSquares(
  game: GameJson,
  from: [number, number],
  to: [number, number],
): [number, number][] | null {
  const info = moveSquareInfo(game);
  const toKey = `${to[0]},${to[1]}`;
  if (!info.has(toKey)) return null; // destination is not a server-offered square
  const fromKey = `${from[0]},${from[1]}`;
  // #144 (owner fg-g759): reproduce upstream PathFinderWithPassBlockSupport — "move INTO the ball, but not THROUGH
  // it" (ffb-common pathfinding, gated isOnField(ballCoord) && isBallInPlay()). A SETTLED loose ball on the pitch
  // (ballInPlay && !ballMoving — our pickable-ball predicate, availableActions:538) is a pickup square: stepping
  // onto it forces a pickup roll. The automove route may END there (a deliberate pickup) but must never route an
  // INTERMEDIATE step through it (an unintended mid-walk pickup → a likely dropped ball / turnover). Make the ball
  // square TERMINAL: it stays reachable/settable as a destination (the `to` break below fires first), but is never
  // EXPANDED FROM, so no shortest path passes through it. A player STARTING on the ball square (carrying it) is
  // exempt — the ball travels with them, there is nothing to avoid.
  const fm = game.fieldModel as { ballInPlay?: boolean; ballMoving?: boolean; ballCoordinate?: unknown } | undefined;
  const ballSq = fm?.ballInPlay && !fm.ballMoving ? normSquare(fm.ballCoordinate) : null;
  const ballKey = ballSq ? `${ballSq[0]},${ballSq[1]}` : null;
  // Dijkstra with cost = steps*1000 + risk (rush/dodge count) → shortest first, low-risk tiebreak.
  const risk = (key: string) => { const i = info.get(key); return i && (i.gfi || i.dodge) ? 1 : 0; };
  const dist = new Map<string, number>([[fromKey, 0]]);
  const prev = new Map<string, [number, number]>();
  const pq: { key: string; c: number; xy: [number, number] }[] = [{ key: fromKey, c: 0, xy: from }];
  while (pq.length > 0) {
    pq.sort((a, b) => a.c - b.c);
    const cur = pq.shift()!;
    if (cur.key === toKey) break;
    if (cur.c > (dist.get(cur.key) ?? Infinity)) continue;
    if (ballKey && cur.key === ballKey && cur.key !== fromKey) continue; // #144: into-not-through — never route PAST the ball
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = cur.xy[0] + dx, ny = cur.xy[1] + dy, nkey = `${nx},${ny}`;
      if (!info.has(nkey)) continue; // step only onto server-offered squares
      const nc = cur.c + 1000 + risk(nkey);
      if (nc < (dist.get(nkey) ?? Infinity)) {
        dist.set(nkey, nc); prev.set(nkey, cur.xy);
        pq.push({ key: nkey, c: nc, xy: [nx, ny] });
      }
    }
  }
  if (!dist.has(toKey)) return null;
  const path: [number, number][] = [];
  let step: [number, number] | undefined = to;
  while (step && `${step[0]},${step[1]}` !== fromKey) { path.unshift(step); step = prev.get(`${step[0]},${step[1]}`); }
  return path.length > 0 ? path : null;
}

// FFB pitch bounds (geometry.ts: 26 long × 15 across) — the pass-range scan is clamped to these.
const PITCH_COLS_A = 26;
const PITCH_ROWS_A = 15;
// bb2025 throwing-range table (VERBATIM upstream PassMechanic.throwingRangeTable): row index = |Δy|, the char at
// column |Δx|*2 gives the pass category — 'T' = thrower's own square, Q/S/L/B = throwable (Quick/Short/Long/Bomb),
// space = OUT OF RANGE. Blizzard removes Long + Long Bomb (findPassingDistance). ⚖ deterministic geometry (the
// template), like the move reach; the server validates the exact modifier + resolves the throw.
const THROWING_RANGE_TABLE = [
  'T Q Q Q S S S L L L L B B B',
  'Q Q Q Q S S S L L L L B B B',
  'Q Q Q S S S S L L L L B B B',
  'Q Q S S S S S L L L B B B  ',
  'S S S S S S L L L L B B B  ',
  'S S S S S L L L L B B B    ',
  'S S S S L L L L L B B B    ',
  'L L L L L L L L B B B      ',
  'L L L L L L L B B B B      ',
  'L L L L L B B B B B        ',
  'L L L B B B B B B          ',
  'B B B B B B B              ',
  'B B B B B                  ',
  'B B B                      ',
];
/** The pass category for a throw of Δx,Δy — 'Q'|'S'|'L'|'B', or null if out of range (blizzard removes L/B). */
function passCategory(dx: number, dy: number, blizzard: boolean): string | null {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax >= 14 || ay >= 14) return null;
  const row = THROWING_RANGE_TABLE[ay] ?? '';
  const ch = ax * 2 < row.length ? row.charAt(ax * 2) : ' ';
  if (ch === 'Q' || ch === 'S') return ch;
  if ((ch === 'L' || ch === 'B') && !blizzard) return ch;
  return null;
}
/** Every square a thrower at `from` may PASS to — bounded by the bb2025 range template. The server validates the
 *  exact distance/modifier + resolves interception; this is only the clickable-target gate (⚖ like the reach). */
export function passRangeSquares(game: GameJson, from: [number, number]): [number, number][] {
  const blizzard = String((game.fieldModel as { weather?: string } | undefined)?.weather ?? '').toLowerCase().includes('blizzard');
  const out: [number, number][] = [];
  for (let y = 0; y < PITCH_ROWS_A; y++) {
    for (let x = 0; x < PITCH_COLS_A; x++) {
      if (x === from[0] && y === from[1]) continue;
      if (passCategory(x - from[0], y - from[1], blizzard)) out.push([x, y]);
    }
  }
  return out;
}

/** BB2025 Throw Team-Mate range is the regular throwing template through Short Pass: every Q/S cell, no L/B. */
export function ttmRangeSquares(_game: GameJson, from: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < PITCH_ROWS_A; y++) {
    for (let x = 0; x < PITCH_COLS_A; x++) {
      if (x === from[0] && y === from[1]) continue;
      const category = passCategory(x - from[0], y - from[1], false);
      if (category === 'Q' || category === 'S') out.push([x, y]);
    }
  }
  return out;
}

/** Count of OPPOSING players (relative to `playerId`) with an active tackle zone orthogonally/diagonally adjacent
 *  to that player — the bb2025 PASS modifier (PassMechanic.passModifiers → UtilPlayer.findTacklezonePlayers: +1
 *  per marking opponent). A TZ = base STANDING && !isDistracted() (confused/hypnotized), matching the STB/dodge
 *  helpers. A geometry read of server state (⚖ — the server still resolves the actual throw). */
function tackleZonesAdjacentTo(game: GameJson, playerId: string, at?: [number, number]): number {
  const me = findPlayer(game, playerId);
  const myPos = at ?? normSquare(me?.playerCoordinate);
  const iAmHome = playerSideIsHome(game, playerId);
  if (!myPos || iAmHome === null) return 0;
  let n = 0;
  for (const p of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    const side = playerSideIsHome(game, p.playerId);
    if (side === null || side === iAmHome) continue; // opponents only
    const st = p.playerState ?? 0;
    if (baseState(st) !== BASE_STANDING || (st & FLAG_CONFUSED) || (st & FLAG_HYPNOTIZED)) continue; // has a TZ
    const pos = normSquare(p.playerCoordinate);
    if (pos && chebyshev(myPos, pos) === 1) n++;
  }
  return n;
}

/** PassModifierFactory always applies opposing Disturbing Presence independently of tackle zones. Unlike a TZ,
 *  its source need only be on-field and within three steps; Nerves of Steel does not suppress it. */
function disturbingPresencesAt(game: GameJson, playerId: string, at: [number, number]): number {
  const iAmHome = playerSideIsHome(game, playerId);
  if (iAmHome === null) return 0;
  let n = 0;
  for (const p of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    const side = playerSideIsHome(game, p.playerId);
    if (side === null || side === iAmHome || !hasSkill(game, p.playerId, 'Disturbing Presence')) continue;
    const pos = normSquare(p.playerCoordinate);
    if (pos && pos[0] >= 0 && pos[0] < PITCH_COLS_A && pos[1] >= 0 && pos[1] < PITCH_ROWS_A
        && chebyshev(at, pos) <= 3) n++;
  }
  return n;
}

/** Shared BB2025 pass-modifier sum. Nerves of Steel mirrors ignoreTacklezonesWhenPassing for a normal pass only;
 *  PassModifierFactory deliberately retains tackle zones for TTM. Weather, Disturbing Presence and the
 *  distance-scoped passing skills remain independent modifiers. */
function passModifierTotal(
  game: GameJson,
  from: [number, number],
  throwerId: string,
  category: string,
  ttm: boolean,
): number {
  const ignoresTackleZones = !ttm && hasSkill(game, throwerId, 'Nerves of Steel');
  const tackleZones = ignoresTackleZones ? 0 : tackleZonesAdjacentTo(game, throwerId, from);
  const disturbingPresence = disturbingPresencesAt(game, throwerId, from);
  const verySunny = String(game.fieldModel?.weather ?? '').toLowerCase().replace(/[^a-z]/g, '').includes('verysunny') ? 1 : 0;
  let skillModifier = 0;
  if (!ttm && (category === 'Q' || category === 'S') && hasSkill(game, throwerId, 'Accurate')) skillModifier -= 1;
  if (!ttm && (category === 'L' || category === 'B') && hasSkill(game, throwerId, 'Cannoneer')) skillModifier -= 1;
  if (ttm && hasSkill(game, throwerId, 'Strong Arm')) skillModifier -= 1;
  return tackleZones + disturbingPresence + verySunny + skillModifier;
}

/** Owner o66 #14 (canonical parity): per-square PASS minimum-roll for a thrower at `from`. Exact bb2025 formula
 *  (bb2025 PassMechanic.minimumRoll): max(2, PA_with_mods + distance.getModifier2020() + PassModifierFactory's
 *  tackle-zone, Disturbing Presence, weather, and skill modifiers), where distanceModifier2020 = Quick 0 / Short
 *  1 / Long 2 / Long-Bomb 3 (PassingDistance). Nerves of Steel removes only the tackle-zone component. A natural 6
 *  is always ACCURATE (evaluatePass), so the target never usefully exceeds 6 — clamped 2..6 for the chip. PA<=0
 *  (no Passing Ability) → the throw auto-fumbles (minimumRoll = Optional.empty), so NO target gets a roll. A state
 *  READ of server data (⚖ — the server resolves the real throw + interception), like the block-dice preview. */
export function passRollSquares(game: GameJson, from: [number, number], throwerId: string): Map<string, number> {
  const m = new Map<string, number>();
  // Live PlayerData carries placement/state only. Characteristics belong to the roster player;
  // test fixtures that duplicated `passing` into PlayerData masked this on real team-builder stars.
  const thrower = findRosterPlayer(game, throwerId);
  const pa = Number(thrower?.passing ?? 0);
  if (!thrower || pa <= 0) return m; // no Passing Ability → auto-fumble, no chip
  const blizzard = String((game.fieldModel as { weather?: string } | undefined)?.weather ?? '').toLowerCase().includes('blizzard');
  const DIST_MOD: Record<string, number> = { Q: 0, S: 1, L: 2, B: 3 };
  for (let y = 0; y < PITCH_ROWS_A; y++) {
    for (let x = 0; x < PITCH_COLS_A; x++) {
      if (x === from[0] && y === from[1]) continue;
      const cat = passCategory(x - from[0], y - from[1], blizzard);
      if (!cat) continue;
      m.set(`${x},${y}`, Math.min(6, Math.max(2,
        pa + (DIST_MOD[cat] ?? 0) + passModifierTotal(game, from, throwerId, cat, false))));
    }
  }
  return m;
}

/** Owner 08-17 (thrower roll-chip parity): per-square THROW TEAM-MATE minimum-roll for a thrower at `from`. bb2025
 *  TtmMechanic.minimumRoll = 2 + modifierSum(distance, passModifiers), modifierSum = distance.getModifier2020() +
 *  Σ passModifiers [ffb-common mechanics/bb2025/TtmMechanic.java:52-58; ThrowTeamMateBehaviour.java uses the SAME
 *  PassModifierFactory as a real pass]. Unlike passRollSquares this is NOT keyed off the thrower's Passing stat —
 *  upstream's minimumRoll never reads it (only evaluatePass's fumble check does) — so it mirrors passRollSquares'
 *  tz-only modifier approximation with a fixed base of 2 instead of PA. Clamped 2..6 to match the chip convention;
 *  no PA gate (a TTM thrower with PA<=0 still gets a target here, same as upstream's minimumRoll). */
export function ttmRollSquares(game: GameJson, from: [number, number], throwerId: string): Map<string, number> {
  const m = new Map<string, number>();
  const DIST_MOD: Record<string, number> = { Q: 0, S: 1 };
  for (const [x, y] of ttmRangeSquares(game, from)) {
    const cat = passCategory(x - from[0], y - from[1], false)!;
    m.set(`${x},${y}`, Math.min(6, Math.max(2,
      2 + (DIST_MOD[cat] ?? 0) + passModifierTotal(game, from, throwerId, cat, true))));
  }
  return m;
}

/** The single TTM throw-roll for a landing at `to` — the TTM twin of passThrowTargetAt (#151), for the
 *  over-the-thrower chip during a Throw/Kick Team-Mate landing. Returns null when `to` is out of range. */
export function ttmThrowTargetAt(game: GameJson, from: [number, number], to: [number, number], throwerId: string): number | null {
  return ttmRollSquares(game, from, throwerId).get(`${to[0]},${to[1]}`) ?? null;
}

/** Presentation-only per-square roll-chip surface for one throw-targeting stage. PASS, BOMB, and TTM/KTM all use
 *  the shared pass rail, clickable range surface, hover readout, and nominated-destination preview; repeating the
 *  same requirement as a chip on every eligible square obscures those controls. Keep all three ruler-only. */
export function throwRollSurface(
  game: GameJson,
  from: [number, number],
  throwerId: string,
  st: 'PASS' | 'BOMB' | 'TTM_LANDING',
  _freeSelect: boolean,
): Map<string, number | FreeSelectPassRollTag> | null {
  return null;
}

/** #77 (owner 07-18): the client-DERIVED pickup-difficulty target at the ball square — the pickup analog of the
 *  planner's dodge chip. ⚠ Unlike dodge (server-sent per MoveSquare.minimumRollDodge), MoveSquare carries NO pickup
 *  minimum (only dodge + GFI), so the pickup target MUST be derived here — reproduced EXACTLY from bb2025
 *  AgilityMechanic.minimumRollPickup = minimumRoll(agilityWithModifiers, pickupModifiers) = max(2, AG + Σ modifiers)
 *  [ffb-common bb2025/AgilityMechanic.java:44-45 (minimumRollPickup) + :147-148 (minimumRoll = Math.max(2, agility +
 *  Σ getModifier))]. Pickup modifiers [ffb-common modifiers/PickupModifierCollection.java]: +1 "Pouring Rain"
 *  (weather==POURING_RAIN) and +1 per opposing TACKLEZONE on the BALL square (1..8, ModifierType.TACKLEZONE); Big
 *  Hand ignores ALL negative modifiers — BOTH the tacklezones AND Pouring Rain [ffb-common skill/bb2025/BigHand.java
 *  — "ignoring all negative modifiers due to Big Hand"; every PickupModifierCollection entry raises the target]. A geometry+stat READ of server state (⚖ fidelity corollary — the server still resolves the
 *  real pickup roll), same class + shape as passRollSquares above. No upper clamp: minimumRollPickup is max(2,…)
 *  only (a natural 6 always succeeds at roll time), matching the server dodge chip which also renders raw. Returns
 *  null when there is no pending pickup to preview (ball not in play / still bouncing, or the picker has no AG). */
export function pickupTargetAtBall(game: GameJson, playerId: string): number | null {
  const fm = game.fieldModel;
  const ball = normSquare(fm?.ballCoordinate);
  if (!fm?.ballInPlay || fm.ballMoving || !ball) return null; // only a settled ball on the pitch is pickable
  const me = findPlayer(game, playerId);
  const iAmHome = playerSideIsHome(game, playerId);
  if (!me || iAmHome === null) return null;
  const ag = Number((me as { agility?: number }).agility ?? 0);
  if (ag <= 0) return null;
  // +1 per OPPOSING standing, non-distracted player whose tackle zone covers the BALL square (adjacent to it) —
  // the bb2025 pickup TACKLEZONE modifier. Same TZ predicate as tackleZonesAdjacentTo, anchored on the ball square.
  let tz = 0;
  for (const p of (fm.playerDataArray ?? []) as PlayerDataLike[]) {
    const side = playerSideIsHome(game, p.playerId);
    if (side === null || side === iAmHome) continue; // opponents of the picker only
    const st = p.playerState ?? 0;
    if (baseState(st) !== BASE_STANDING || (st & FLAG_CONFUSED) || (st & FLAG_HYPNOTIZED)) continue; // must exert a TZ
    const pos = normSquare(p.playerCoordinate);
    if (pos && chebyshev(ball, pos) === 1) tz++;
  }
  // Big Hand "ignores ALL negative modifiers due to Big Hand" (BigHand.java) — that is BOTH the tacklezone
  // modifiers AND Pouring Rain (every pickup modifier in PickupModifierCollection raises the target = negative).
  // So a Big Hand carrier picks up at base AG regardless of TZ/weather (Echo #77 drift-guard caught the earlier
  // TZ-only reading). Without Big Hand: +1 per marking opponent TZ, +1 in Pouring Rain.
  const pouringRain = String((fm as { weather?: string }).weather ?? '').toLowerCase().includes('pouring') ? 1 : 0;
  const negMods = hasSkill(game, playerId, 'Big Hand') ? 0 : (tz + pouringRain);
  // Extra Arms — a SKILL-registered EASING pickup modifier of −1 [ffb-common skill/common/ExtraArms.java:25
  // `registerModifier(new PickupModifier("Extra Arms", -1, ModifierType.REGULAR))`]. It lives OUTSIDE the static
  // PickupModifierCollection (why the item-71 review + Kallus's collection-only re-verify both missed it), and it
  // is a BONUS (lowers the target), so Big Hand's ignore-negative-modifiers does NOT suppress it — Extra Arms
  // applies regardless of Big Hand. Big Hand + Extra Arms ⇒ max(2, AG − 1). The only two skill-registered pickup
  // modifiers in bb2025 are Big Hand (handled above) and Extra Arms (verified: sole `new PickupModifier` sites).
  const extraArms = hasSkill(game, playerId, 'Extra Arms') ? -1 : 0;
  return Math.max(2, ag + negMods + extraArms);
}

type PreviewCatchMode = 'CATCH_ACCURATE_PASS' | 'CATCH_ACCURATE_BOMB';

/** Shared accurate-target catch stack. Upstream's CatchModifierFactory applies Disturbing Presence to every catch
 *  and tackle zones unless ignoreTacklezonesWhenCatching is present [ffb-common factory/CatchModifierFactory.java:
 *  38-45]. Its collection supplies +1 per TACKLEZONE, +1 per DISTURBING_PRESENCE, and +1 Pouring Rain
 *  [ffb-common modifiers/CatchModifierCollection.java:9-33]; UtilDisturbingPresence counts opposing, in-bounds
 *  sources within distanceInSteps<=3 [ffb-common util/UtilDisturbingPresence.java:17-32]. Extra Arms is a regular
 *  −1 catch modifier [ffb-common skill/common/ExtraArms.java:23-27]. Diving Catch is −1 in BOTH accurate target
 *  modes [ffb-common skill/common/DivingCatch.java:35-40]. */
function accurateCatchTargetAt(game: GameJson, square: [number, number], mode: PreviewCatchMode): number | null {
  const fm = game.fieldModel;
  if (!fm) return null;
  // The server only enters the accurate catch branch for a player with tackle zones (StepResolvePass.java:49-71).
  let catcher: PlayerDataLike | undefined;
  for (const p of (fm.playerDataArray ?? []) as PlayerDataLike[]) {
    const pos = normSquare(p.playerCoordinate);
    if (pos && sameSquare(pos, square) && exertsTacklezone(p.playerState)) { catcher = p; break; }
  }
  if (!catcher) return null;
  const catcherId = catcher.playerId;
  const catcherIsHome = playerSideIsHome(game, catcherId);
  if (catcherIsHome === null) return null;
  // As with Passing above, live PlayerData is placement truth, not characteristic truth.
  const ag = Number(findRosterPlayer(game, catcherId)?.agility ?? 0);
  if (ag <= 0) return null;
  // +1 per OPPOSING tackle zone on the catcher's square — Nerves of Steel ignores tackle zones when catching.
  const tz = hasSkill(game, catcherId, 'Nerves of Steel') ? 0 : tzPlayersAdjacent(game, square, !catcherIsHome).length;
  // +1 per OPPOSING Disturbing Presence within Chebyshev 3 of the catcher (state-agnostic, on-field).
  let dp = 0;
  for (const p of (fm.playerDataArray ?? []) as PlayerDataLike[]) {
    const side = playerSideIsHome(game, p.playerId);
    if (side === null || side === catcherIsHome) continue; // opponents of the catcher only
    const pos = normSquare(p.playerCoordinate);
    if (!pos || pos[0] < 0 || pos[0] >= PITCH_COLS_A || pos[1] < 0 || pos[1] >= PITCH_ROWS_A) continue; // on-field
    if (chebyshev(square, pos) <= 3 && hasSkill(game, p.playerId, 'Disturbing Presence')) dp++;
  }
  const rain = String((fm as { weather?: string }).weather ?? '').toLowerCase().includes('pouring') ? 1 : 0;
  const divingCatch = (mode === 'CATCH_ACCURATE_PASS' || mode === 'CATCH_ACCURATE_BOMB')
    && hasSkill(game, catcherId, 'Diving Catch') ? -1 : 0;
  const extraArms = hasSkill(game, catcherId, 'Extra Arms') ? -1 : 0;
  return Math.max(2, ag + tz + dp + rain + divingCatch + extraArms);
}

/** #151 (owner fg-g759): the client-DERIVED catch-difficulty target for the player standing on `square` — the
 *  catch analog of pickupTargetAtBall (#77), for the pass-preview chip shown OVER THE TARGET-IN-SQUARE. Returns
 *  null when no standing player occupies the square (open ground/down player → no accurate catcher to preview).
 *  Reproduces CATCH_ACCURATE_PASS: bb2025 AgilityMechanic.minimumRollCatch = max(2, AG + Σ modifiers)
 *  [ffb-common mechanics/bb2025/AgilityMechanic.java:64-65,143-148], using the shared stack above. Diving Catch −1
 *  applies to CATCH_ACCURATE_PASS [ffb-common skill/common/DivingCatch.java:35-40]. The bb2025 mode-only
 *  "Inaccurate Pass or Scatter" +1 and "Blast It!" −1 do not apply [ffb-common modifiers/bb2025/
 *  CatchModifierCollection.java:19-42]. ⚖ Preview only: the server resolves accuracy, interception, and the catch. */
export function catchTargetAt(game: GameJson, square: [number, number]): number | null {
  return accurateCatchTargetAt(game, square, 'CATCH_ACCURATE_PASS');
}

/** W29: the client-DERIVED bomb-catch target for a standing player on the nominated square. The authoritative
 *  bb2025 thrown-bomb branch publishes CATCH_ACCURATE_BOMB after an ACCURATE throw to a catcher with tackle zones
 *  [ffb-server step/bb2025/pass/StepResolvePass.java:49-71], so this uses the shared tackle-zone, Disturbing
 *  Presence, Pouring Rain, Extra Arms, and minimum-roll stack above. Diving Catch DOES apply to this exact mode
 *  [ffb-common skill/common/DivingCatch.java:35-40]. "Inaccurate Pass or Scatter" +1 applies only to CATCH_BOMB /
 *  CATCH_SCATTER, while "Blast It!" −1 applies only to CATCH_SCATTER / CATCH_MISSED_PASS [ffb-common modifiers/
 *  bb2025/CatchModifierCollection.java:19-42], so neither belongs in this accurate target-square preview. ⚖ Preview
 *  only: an inaccurate bomb uses CATCH_BOMB after it lands elsewhere; the server resolves that later outcome. */
export function bombCatchTargetAt(game: GameJson, square: [number, number]): number | null {
  return accurateCatchTargetAt(game, square, 'CATCH_ACCURATE_BOMB');
}

export interface FreeSelectPassRollTag {
  pass?: number;
  catch?: number;
}

/** W29 free-select presentation seam. THROW values come only from passRollSquares; PASS/BOMB catch values come
 *  only from the cited calculators above. UAT row D suppresses each noise-only 2+ tag on this surface. Keeping the
 *  filter here (rather than the renderer) leaves ffb-pitch formula-free and keeps normal passRollSquares unchanged. */
export function freeSelectPassRolls(
  game: GameJson,
  from: [number, number],
  throwerId: string,
  mode: 'PASS' | 'BOMB',
): Map<string, FreeSelectPassRollTag> {
  const tags = new Map<string, FreeSelectPassRollTag>();
  const catchTarget = mode === 'BOMB' ? bombCatchTargetAt : catchTargetAt;
  for (const [key, pass] of passRollSquares(game, from, throwerId)) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    const caught = catchTarget(game, [x, y]);
    const tag: FreeSelectPassRollTag = {};
    if (pass > 2) tag.pass = pass;
    if (caught != null && caught > 2) tag.catch = caught;
    if (tag.pass != null || tag.catch != null) tags.set(key, tag);
  }
  return tags;
}

/** #151 (owner fg-g759): the accurate-pass THROW target — the single roll shown OVER THE PASSER for a throw from
 *  `from` to `to` by `throwerId`. A single-square read of passRollSquares (#14 — the ⚖-cleared bb2025
 *  PassMechanic.minimumRoll reproduction: PA + distance mod + tackle zones on the thrower). Voss renders the
 *  over-passer chip off this (the catchTargetAt twin over the target), so the throw roll is NOT recomputed in
 *  ffb-pitch (⚖: no renderer-local pass formula = no leak class, per Voss's #77 note). `from` = the passer's throw
 *  square — its current square OR a planner move-waypoint (recomputes the TZ/distance from there for free). Returns
 *  null when `to` is out of range or the thrower has no Passing Ability (auto-fumble → no chip). */
export function passThrowTargetAt(game: GameJson, from: [number, number], to: [number, number], throwerId: string): number | null {
  return passRollSquares(game, from, throwerId).get(`${to[0]},${to[1]}`) ?? null;
}

/** BB2025 Hail Mary Pass is selectable at any on-pitch square and is resolved as a Long Bomb for its
 * minimum-roll presentation (StepHailMaryPass -> PassingDistance.LONG_BOMB). It therefore cannot use the
 * bounded regular-pass map above. The server remains authoritative; this is the same modifier projection used
 * by the ordinary pass destination control, with the HMP Long Bomb base of 5+ (2 + distance modifier 3). */
export function hailMaryPassThrowTarget(
  game: GameJson,
  from: [number, number],
  throwerId: string,
): number {
  return Math.min(6, Math.max(2, 5 + passModifierTotal(game, from, throwerId, 'B', false)));
}

export interface PassDestinationRollPreview {
  throwSquare: [number, number];
  targetSquare: [number, number];
  throwRoll: number;
  catchRoll: number | null;
}

/** Keep the TTM requirement clear of the held-player marker over the thrower.
 * Ordinary Pass/Bomb requirements remain attached to the player making the throw. */
export function throwRollCueSquare(
  preview: PassDestinationRollPreview | null | undefined,
  mode: 'PASS' | 'BOMB' | 'TTM_LANDING' | 'HAIL_MARY_PASS',
): [number, number] | null {
  if (!preview) return null;
  return mode === 'TTM_LANDING' ? preview.targetSquare : preview.throwSquare;
}

/** One presentation-only projection for a nominated or committed throw destination. The throw requirement is
 *  always derived from the actual/planned throw square. A catch requirement exists only when the destination is
 *  occupied by a standing player; empty turf therefore keeps its Pass N+ cue without inventing a Catch roll. */
export function passDestinationRollPreview(
  game: GameJson,
  from: [number, number],
  to: [number, number],
  throwerId: string,
  mode: 'PASS' | 'BOMB' | 'TTM_LANDING' | 'HAIL_MARY_PASS' = 'PASS',
): PassDestinationRollPreview | null {
  const throwRoll = mode === 'TTM_LANDING'
    ? ttmThrowTargetAt(game, from, to, throwerId)
    : mode === 'HAIL_MARY_PASS'
      ? hailMaryPassThrowTarget(game, from, throwerId)
      : passThrowTargetAt(game, from, to, throwerId);
  if (throwRoll == null) return null;
  const catchRoll = mode === 'TTM_LANDING'
    ? null
    : mode === 'BOMB' ? bombCatchTargetAt(game, to) : catchTargetAt(game, to);
  return {
    throwSquare: [from[0], from[1]],
    targetSquare: [to[0], to[1]],
    throwRoll,
    catchRoll,
  };
}

// #73: bb2025 canAlwaysAssistFouls is granted by EXACTLY ONE skill — Put the Boot In (PutTheBootIn.java:17
// `registerProperty(canAlwaysAssistFouls)`; unlike bb2016/2020 it is NOT gated on a game option, bb2025
// SkillMechanic.canAlwaysAssistFoul:88) — and CANCELLED by an adjacent enemy carrying Defensive
// (Defensive.java:19 `CancelSkillProperty(canAlwaysAssistFouls)`). Capability mirrors (add here if a future
// bb2025 skill registers the same property), same one-place pattern as CAN_STAND_UP_FOR_FREE_SKILLS.
const CAN_ALWAYS_ASSIST_FOUL_SKILLS = ['Put the Boot In'];
const CANCELS_ALWAYS_ASSIST_FOUL_SKILLS = ['Defensive'];

/** A player EXERTS a tacklezone (mirror of bb2025 PlayerState.hasTacklezones and its distracted flags).
 *  Existing settled-view callers retain the STANDING-only predicate used by tackleZonesAdjacentTo /
 *  pickupTargetAtBall: the transient MOVING/BLOCKED bases upstream also accepts never occur while choosing a
 *  foul. Send-time mirrors such as Gaze may opt into those transient bases without duplicating state bits. */
export function exertsTacklezone(ps: number | undefined, includeTransientBases = false): boolean {
  const st = ps ?? 0;
  const base = baseState(st);
  const hasTacklezoneBase = base === BASE_STANDING
    || (includeTransientBases && (base === BASE_MOVING || base === BASE_BLOCKED));
  return hasTacklezoneBase && !(st & FLAG_CONFUSED) && !(st & FLAG_HYPNOTIZED);
}

/** Players of one side (home iff `wantHome`) exerting a tacklezone on `coord` (Chebyshev-1). Mirror of
 *  UtilPlayer.findAdjacentPlayersWithTacklezones(team, coord) — includes any such player, does NOT exclude the
 *  fouler/victim (the server's assist geometry counts them too; they are filtered by side/state where needed). */
function tzPlayersAdjacent(game: GameJson, coord: [number, number], wantHome: boolean): PlayerDataLike[] {
  const out: PlayerDataLike[] = [];
  for (const p of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    if (playerSideIsHome(game, p.playerId) !== wantHome || !exertsTacklezone(p.playerState)) continue;
    const pos = normSquare(p.playerCoordinate);
    if (pos && chebyshev(coord, pos) === 1) out.push(p);
  }
  return out;
}

/** Base (current, injury-adjusted) armour value of a roster player — the AV the server breaks. Read from the
 *  authoritative team roster (same source markings.ts uses), NOT fieldModel.playerDataArray. */
function rosterArmour(game: GameJson, playerId: string): number {
  const all = [...game.teamHome.playerArray, ...game.teamAway.playerArray];
  const player = all.find((p) => p.playerId === playerId);
  return player ? effectiveArmour(player) : 0;
}

/** #73 (owner 07-18): the client-DERIVED foul armour-break target — the minimum 2d6 an armour roll must reach to
 *  break the DOWN `defenderId`'s armour when `attackerId` FOULS it. The foul analog of the planner dodge chip.
 *  ⚠ Unlike dodge (server-sent per MoveSquare.minimumRollDodge), NO pre-foul armour target is on the wire — the
 *  server computes it only at foul RESOLUTION — so it MUST be derived here, reproduced EXACTLY from the bb2025
 *  armour-foul path (⚖ fidelity corollary — the server still rolls the real armour):
 *   • BREAK CONDITION [ffb-common mixed/StatsMechanic.armourIsBroken, @RulesCollection BB2025]: `reduceArmour(av,8)
 *     <= roll[0]+roll[1]+armorModifierTotal` — bb2025 uses `<=` (NOT bb2016's `<`), so the min 2d6 to break =
 *     `AV − Σ modifiers`. reduceArmour is identity here (Claw's reducesArmourToFixedValue is a BLOCK modifier,
 *     absent on a foul).
 *   • FOUL ASSIST modifiers [InjuryTypeFoul.armourRoll:72-74 → ArmorModifierContext(…, findFoulAssists) →
 *     FoulAssistArmorModifier]: net = offensive − defensive [UtilPlayer.findFoulAssists:287], contributing +net to the
 *     modifier total (each offensive +1, each defensive −1). Offensive assist = an attacker-team TZ-player adjacent
 *     to the VICTIM that is itself unmarked by an enemy TZ, OR carries Put the Boot In (canAlwaysAssistFouls) not
 *     cancelled by an adjacent enemy's Defensive [findOffensiveFoulAssists]. Defensive assist = a defender-team
 *     TZ-player adjacent to the ATTACKER marked by FEWER THAN 2 attacker-team TZ-players [findDefensiveFoulAssists].
 *   • +1 "Foul" bonus [ArmorModifiers(bb2025) StaticArmourModifier "Foul"]: iff GameOption FOUL_BONUS on, OR
 *     FOUL_BONUS_OUTSIDE_TACKLEZONE on AND the attacker has no opposing tacklezone on it. Off in standard BB2025.
 *  NOT baked in: Dirty Player / Sneaky-Git-pair (+1) are the server's SECOND-pass, player-CHOICE (armour-vs-injury),
 *  applied only after the FIRST armour roll FAILS [InjuryTypeFoul.armourRoll:78-93] — unpredictable pre-roll, so
 *  the preview shows the deterministic first-roll target. Defensive-assist geometry reads the attacker's CURRENT
 *  square (exact for an in-place foul; a walk-to-foul preview refreshes as the fouler advances, like the dodge
 *  chip is per-square). Clamped to a 2 floor (2d6 minimum). Returns null when `defenderId` is not a DOWN
 *  (prone/stunned) opponent of `attackerId` (no foul to preview) or the victim has no AV.
 *  ⚠ DRIFT-GUARD (Meero SR-27 FT-1, ML-12 class): the assist counting RE-IMPLEMENTS the shared server util
 *  UtilPlayer.findFoulAssists in TS — faithful now, but a change to the server's foul-assist rule must be mirrored
 *  HERE. Tracked as porting-decisions register row 28 (docs/wiki/porting-decisions.md). */
export function foulArmourTargetAt(game: GameJson, attackerId: string, defenderId: string): number | null {
  const attackerHome = playerSideIsHome(game, attackerId);
  const defenderHome = playerSideIsHome(game, defenderId);
  if (attackerHome === null || defenderHome === null || attackerHome === defenderHome) return null; // opponents only
  const atk = findPlayer(game, attackerId);
  const def = findPlayer(game, defenderId);
  if (!atk || !def) return null;
  const defBase = baseState(def.playerState);
  if (defBase !== BASE_PRONE && defBase !== BASE_STUNNED) return null; // a foul only hits a DOWN enemy
  const atkCoord = normSquare(atk.playerCoordinate);
  const defCoord = normSquare(def.playerCoordinate);
  if (!atkCoord || !defCoord) return null;
  const av = rosterArmour(game, defenderId);
  if (av <= 0) return null;

  // OFFENSIVE assists: attacker-team TZ-players adjacent to the VICTIM (≠ the fouler) that are unmarked, or carry
  // Put the Boot In uncancelled by an adjacent enemy's Defensive.
  let offensive = 0;
  for (const p of tzPlayersAdjacent(game, defCoord, attackerHome)) {
    if (p.playerId === attackerId) continue; // the fouler himself is not an assist
    const pos = normSquare(p.playerCoordinate);
    if (!pos) continue;
    const markers = tzPlayersAdjacent(game, pos, defenderHome); // enemy TZ-players marking this assist
    const canAlways = CAN_ALWAYS_ASSIST_FOUL_SKILLS.some((s) => hasSkill(game, p.playerId, s))
      && !markers.some((m) => CANCELS_ALWAYS_ASSIST_FOUL_SKILLS.some((s) => hasSkill(game, m.playerId, s)));
    if (markers.length < 1 || canAlways) offensive++;
  }

  // DEFENSIVE assists: defender-team TZ-players adjacent to the ATTACKER (≠ the victim) marked by <2 attacker-team
  // TZ-players (the fouler counts among those markers — server includes the attacker's own team at the assist).
  let defensive = 0;
  for (const p of tzPlayersAdjacent(game, atkCoord, defenderHome)) {
    if (p.playerId === defenderId) continue; // the victim himself is not a defensive assist
    const pos = normSquare(p.playerCoordinate);
    if (!pos) continue;
    if (tzPlayersAdjacent(game, pos, attackerHome).length < 2) defensive++;
  }

  const netAssists = offensive - defensive;

  // +1 "Foul" bonus — house-rule game options (foulBonus / foulBonusOutsideTacklezone); standard BB2025 = off.
  const opts = (game as { gameOptions?: { gameOptionArray?: { gameOptionId: string; gameOptionValue: string }[] } })
    .gameOptions?.gameOptionArray;
  const optOn = (key: string) => {
    const v = opts?.find((o) => o.gameOptionId === key)?.gameOptionValue;
    return v === 'true' || v === '1';
  };
  const foulBonus = optOn('foulBonus')
    || (optOn('foulBonusOutsideTacklezone') && tackleZonesAdjacentTo(game, attackerId) < 1) ? 1 : 0;

  return Math.max(2, av - netAssists - foulBonus);
}

/** A once-per-turn action flag from the acting team's turnData (blitzUsed/foulUsed/handOverUsed/passUsed/
 *  secureTheBallUsed — the server sets these on resolution). side null → treat as used (offer nothing). A rules
 *  gate, not a prediction: it stops offering a spent action so the declare can't be a dead click. */
function teamTurnFlag(game: GameJson, side: boolean | null, flag: string): boolean {
  if (side === null) return true;
  const td = (side ? game.turnDataHome : game.turnDataAway) as Record<string, unknown> | undefined;
  return !!td?.[flag];
}

/** True when `playerId` is the standing ball carrier (on the ball, ball in play & not loose). */
function isBallCarrier(game: GameJson, playerId: string): boolean {
  const fm = game.fieldModel;
  if (!fm?.ballInPlay || fm.ballMoving) return false;
  const p = findPlayer(game, playerId);
  return !!p && sameSquare(p.playerCoordinate, fm.ballCoordinate);
}

/** The ball is on the pitch and NOT held by anyone (loose/settled on the ground) — so a player could MOVE onto
 *  it, pick it up, THEN pass/hand-off. Owner o66p #15/#16: Pass/Hand-off must be declarable in this case, not
 *  only when already carrying (upstream isPassActionAvailable gates on isBallAvailable, not hasBall). */
function isBallLoose(game: GameJson): boolean {
  const fm = game.fieldModel;
  if (!fm?.ballInPlay) return false;
  const ball = normSquare(fm.ballCoordinate);
  if (!ball) return false;
  // held iff some player stands on the ball square.
  return !((fm.playerDataArray ?? []) as PlayerDataLike[]).some((p) => {
    const pos = normSquare(p.playerCoordinate);
    return pos && pos[0] === ball[0] && pos[1] === ball[1];
  });
}

/** Owner o66p #15/#16: PASS / HAND-OFF are available when the ball is GETTABLE by this player — it carries the
 *  ball, OR the ball is loose on the pitch (pick-up-then-pass). Mirrors upstream isBallAvailable(game, player)
 *  (we don't model the per-square reach — the server validates; this only decides whether to OFFER the declare). */
function ballAvailableTo(game: GameJson, playerId: string): boolean {
  return isBallCarrier(game, playerId) || isBallLoose(game);
}

/** Is there an OPPOSING player (relative to `playerId`) with a tackle zone within 2 squares of the ball? Faithful
 *  mirror of upstream findPlayersWithTackleZonesTwoSquaresAway → findPlayersWithTackleZones(dist 2): a player with
 *  a TZ = base STANDING && !isDistracted() (isDistracted = confused || hypnotized); "within 2" = chebyshev 1..2 of
 *  the ball (findAdjacentCoordinates distance 2 excludes the centre). All inputs are server state (ball coord +
 *  player positions/states) — a geometry read, not a prediction. NOTE upstream hardcodes `game.getTeamAway()` as
 *  the opponent set (a home-perspective literal); we use the securer's ACTUAL opponent so it is correct for an
 *  away securer too (the owner's intent: "no opposition tackle zone within 2 of the ball"). */
function opposingTackleZoneNearBall(game: GameJson, playerId: string): boolean {
  const ball = normSquare(game.fieldModel?.ballCoordinate);
  const iAmHome = playerSideIsHome(game, playerId);
  if (!ball || iAmHome === null) return false;
  for (const p of (game.fieldModel?.playerDataArray ?? []) as PlayerDataLike[]) {
    const side = playerSideIsHome(game, p.playerId);
    if (side === null || side === iAmHome) continue; // opponents of the securer only
    const st = p.playerState ?? 0;
    if (baseState(st) !== BASE_STANDING || (st & FLAG_CONFUSED) || (st & FLAG_HYPNOTIZED)) continue; // has a TZ
    const pos = normSquare(p.playerCoordinate);
    if (!pos) continue;
    const d = chebyshev(ball, pos);
    if (d >= 1 && d <= 2) return true;
  }
  return false;
}

/** Big Guy = the position KEYWORD (upstream Keyword.BIG_GUY). Keywords live on the roster position, not the field
 *  player, so look up the player's positionId in the team roster's positionArray. */
function isBigGuy(game: GameJson, playerId: string): boolean {
  const side = playerSideIsHome(game, playerId);
  if (side === null) return false;
  const team = (side ? game.teamHome : game.teamAway) as {
    playerArray?: { playerId: string; positionId?: string | number }[];
    roster?: { positionArray?: { positionId?: string | number; keywords?: string[] }[] };
  };
  const player = (team.playerArray ?? []).find((p) => p.playerId === playerId);
  if (!player) return false;
  const pos = (team.roster?.positionArray ?? []).find((q) => String(q.positionId) === String(player.positionId));
  return (pos?.keywords ?? []).includes('Big Guy');
}

// Activation-starting negatraits. "Activate" is an explicit zero-route affordance for a standing Big Guy:
// it deliberately sends the ordinary MOVE declaration so the server remains the sole owner of the trait roll.
// Always Hungry is excluded because it is checked when Throw Team-Mate is attempted, not when the player activates.
const BIG_GUY_ACTIVATION_NEGATRAITS = [
  'Animal Savagery', 'Blood Lust', 'Bone Head', 'Really Stupid', 'Take Root', 'Unchannelled Fury', 'Wild Animal',
] as const;

function hasBigGuyActivationNegatrait(game: GameJson, playerId: string): boolean {
  return BIG_GUY_ACTIVATION_NEGATRAITS.some((skill) => hasSkill(game, playerId, skill));
}

/** SECURE THE BALL availability — a FAITHFUL port of upstream LogicModule.isSecureTheBallActionAvailable:332
 *  (owner 2026-07-14 #8, option A = match the official client, reading server state not predicting): the ball is
 *  IN PLAY **and MOVING**, the team hasn't secured this turn, the player is not a Big Guy, does not hold
 *  preventSecureTheBallAction (bb2025 Unsteady / No Ball / Ball & Chain — verified upstream), AND there is no
 *  opposing tackle zone within 2 squares of the ball. (Owner o66j earlier fixed the ball-state gate: it was
 *  wrongly on isBallCarrier — a SETTLED ball — the opposite of `ballMoving`.) */
function isSecureTheBallAvailable(game: GameJson, playerId: string): boolean {
  const fm = game.fieldModel;
  if (!fm?.ballInPlay || !fm.ballMoving) return false; // in play AND moving (loose/bouncing)
  if (teamTurnFlag(game, playerSideIsHome(game, playerId), 'secureTheBallUsed')) return false;
  // preventSecureTheBallAction holders (bb2025): Unsteady, No Ball, Ball & Chain.
  if (hasSkill(game, playerId, 'unsteady') || hasSkill(game, playerId, 'No Ball') || hasSkill(game, playerId, 'Ball and Chain')) return false;
  if (isBigGuy(game, playerId)) return false;
  if (opposingTackleZoneNearBall(game, playerId)) return false;
  return true;
}

/**
 * The declarable actions for the current state + selected player. `selectedPlayerId` must be one of the
 * coach's own players (the interaction router gates that); pass '' when no player is selected.
 */
/**
 * The DECLARE rows for one player, from that player's OWN state (standing/prone/carrier/adjacency) — NOT the
 * game's client-state. Factored out so it drives BOTH the fresh SELECT_PLAYER menu AND the mid-activation
 * SWITCH menu (owner o66j #13): while player A is acting the coach may click a DIFFERENT own player B; B's
 * declares must surface so the click can switch to B (the store's `declareAction`→`whenPriorActivationEnded`
 * ends A's activation first, then declares B). Keying this on the player, not on deriveClientState landing in
 * MOVE, is what makes the switch work without a manual End Activation first.
 */
function playerDeclareSet(game: GameJson, playerId: string, p: PlayerDataLike): CoachAction[] {
  const out: CoachAction[] = [];
  const ps = p.playerState ?? 0;
  const base = baseState(ps);
  const side = playerSideIsHome(game, playerId);
  const standing = base === BASE_STANDING;
  const prone = base === BASE_PRONE;
  // Owner 2026-07-13 (#10 part 1): a player that is NOT ACTIVE (0x100 clear) can't be activated — upstream gates
  // every declare on isActive(). Offer nothing for an inactive player (a stun-recovering / missed-turn player, OR
  // one that has already acted) so the menu never surfaces a Stand Up/Move the server rejects (dead click). The
  // CURRENTLY-ACTING player is EXEMPT: their activation is in progress. Verified against the corpus: a stand-up-
  // able prone player is 0x103 (ACTIVE), so the gate correctly ALLOWS it; a2 switch-player + inactive-own tests
  // exercise the active/inactive branches. (The bit is set for both teams at a turn flip, but availableActions
  // only builds for MY side on MY turn, so the raw !active read is safe here.)
  const isActing = String((game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '') === playerId;
  if (!(ps & FLAG_ACTIVE) && !isActing) return out; // not activatable → no declares
  // Owner 2026-08-22: an otherwise-normal standing Big Guy with an activation negatrait gets an explicit
  // top-row Activate affordance. It is intentionally a second presentation of `move`: unlike Recover it does
  // not mutate a status locally or send removeConfusion; the normal clientActingPlayer{playerAction:'move'}
  // declaration lets the server roll Animal Savagery / Bone Head / Really Stupid / etc. The ordinary Move row
  // remains below for route-oriented play. Negative-state players retain the established Recover rail instead.
  const negativeState = !!(ps & (FLAG_CONFUSED | FLAG_HYPNOTIZED | FLAG_EYE_GOUGED));
  if (standing && !negativeState && isBigGuy(game, playerId) && hasBigGuyActivationNegatrait(game, playerId)) {
    out.push({ action: 'move', label: 'Activate', kind: 'declare', enabled: true });
  }
  // A.4 NEGATRAIT RIDER — Recover (removeConfusion). Owner 2026-07-13 (cited fidelity fix): a confused (0x200)
  // active (0x100) non-prone player is offered Recover ALONGSIDE the normal action set — NOT Recover-only. The
  // old short-circuit (return after pushing Recover) was a DIVERGENCE: upstream bb2025 SelectLogicModule adds
  // RECOVER (isRecoverFromConfusionActionAvailable) independently, and Move/Block/Blitz/Foul/Pass gate on
  // LogicModule predicates that do NOT check isConfused (isMoveActionAvailable == PlayerState.isAbleToMove(),
  // isBlock/Blitz/FoulActionAvailable — all verified against upstream: none exclude confused). So a confused
  // player keeps the full predicate-gated set. Recover pushed first (menu order); no early return — the
  // standing/prone declares below build as normal.
  // Owner 2026-08-13: offer Recover for THREE statuses, same `removeConfusion` declare (SelectLogicModule(bb2025):169,
  // offered at :352-354), each base != PRONE — predicates verbatim from LogicModule.java:
  //   confusion :485-491 = isConfused(0x200) && isActive(0x100) && !preventRecoverFromConcusion
  //   gaze      :493-498 = isHypnotized(0x800)                  && !preventRecoverFromGaze     (⚠ NO isActive)
  //   eye-gouge :670-675 = isEyeGouged(0x20000) && isActive(0x100)                             (no property guard)
  // preventRecover* grantor (bb2025) = Ball and Chain only ⇒ guards confusion+gaze, NOT eye-gouge.
  const recoverFromConfusion = !!(ps & FLAG_CONFUSED) && !!(ps & FLAG_ACTIVE) && !preventsRecoverFromConfusion(game, playerId);
  const recoverFromGaze = !!(ps & FLAG_HYPNOTIZED) && !preventsRecoverFromGaze(game, playerId);
  const recoverFromEyeGouge = !!(ps & FLAG_EYE_GOUGED) && !!(ps & FLAG_ACTIVE);
  if (!prone && (recoverFromConfusion || recoverFromGaze || recoverFromEyeGouge)) {
    out.push({ action: 'removeConfusion', label: 'Recover', kind: 'declare', enabled: true });
  }
  // A prone player may Stand Up (stand and stop). Upstream ALSO offers MOVE and BLITZ from prone —
  // isMoveActionAvailable/isBlitzActionAvailable gate on PlayerState.isAbleToMove() which is TRUE for
  // PRONE (base STANDING|MOVING|PRONE), the server folding the stand-up into the first move/blitz square.
  // RULING (upstream source, 2026-07-11): a prone blitz emits plain `blitzMove`, NOT `standUpBlitz`.
  // MENU ORDER — #187 (owner-ruled reorder, 2026-07-28): for a prone player the menu now leads with Move, then
  // "Stand up and End Activation", then the rest ending with Foul (push-order: move · standUp+endActivation · … ·
  // foul). SUPERSEDES the o66ad #8 order (Stand Up · Move · Block · …). The standUp/move DISTINCTION (owner #9,
  // 2026-07-14, REVERTS 0ca53a54) is UNCHANGED: the explicit "Stand up and End Activation" declares the rigid
  // `standUp` action = STAND AND END the activation (StepEndSelecting, the old/validated behavior), NOT a
  // move-wired stand-into-move; a single-click / the "Move" entry declares `move` directly (SpectateView; the
  // server folds the 3-MA stand into the first move square) = stands and WALKS. Reverting the stand-into-move
  // also kills #15 (the stood-up-in-place state that illegally re-offered plain Block). Both entries shown for
  // prone (owner: show both). clientStateMachine maps `standUp`→MOVE transiently; StepEndSelecting then ends it.
  if (standing || prone) {
    // Owner ruling 08-17 (supersedes 2026-08-05 label-prefix): a prone free-stand (Jump Up) no longer prefixes
    // row text — it renders the skill icon inline, MOVE ROW ONLY. Other rows below are plain labels again.
    const jumpUpFreeStand = prone && canStandUpForFree(game, playerId);
    out.push({ action: 'move', label: 'Move', kind: 'declare', enabled: true, icon: jumpUpFreeStand ? 'Jump Up' : undefined });
    // Owner 08-24: Pogo/Leap are first-class activation choices, not acting-player-only UI decorations. Selecting
    // this row sends Move with leaping=true; ordinary Jump appears here only when a down adjacent player enables it.
    const jump = jumpActionOffer(game, playerId, 'activation');
    if (jump) out.push(jump);
    // #187: Move leads; Stand-up-and-End follows (prone-only; the distinct stand-&-END item vs a bare Move = stand-and-walk, #97).
    if (prone) out.push({ action: 'standUp', label: 'Stand up and End Activation', kind: 'declare', enabled: true });
    // Owner 2026-07-14 (#12): a PRONE player gets the full MOVE-FAMILY declare set, not just Stand Up + Move —
    // upstream's availability predicates make Foul/Pass/Hand-off/Gaze/Throw-Team-Mate available from prone (the
    // server folds the 3-MA stand-up into the action). Cited vs LogicModule.java: isFoulActionAvailable (L355 —
    // NO prone check), isPassActionAvailable (L375) / isHandOverActionAvailable (L397) / isThrowTeamMateAction-
    // Available (L407/434) all gate on PlayerState.isAbleToMove() which is TRUE for PRONE, and Gaze defers to the
    // move-family (canGaze, no prone exclusion). So the guards below drop `standing &&` — we are already inside
    // the `standing || prone` block, so removing it means "standing OR prone". STILL standing-only (cited): BLOCK
    // (L282 excludes PRONE unless canStandUpForFree/Jump-Up), THROW BOMB (L319 !isProneOrStunned). #218 (Meero SR-219):
    // Secure the Ball is NOT standing-only — `isSecureTheBallActionAvailable` (LogicModule.java:332) has NO stance
    // clause. Deliberate-absence proof (MS-2): `isThrowBombActionAvailable` sits directly above it at :319 WITH
    // `!isProneOrStunned()` — upstream writes stance guards where it intends them, so secureTheBall's `standing &&`
    // was a client invention, dropped below (offered from prone; stunned/inactive still excluded by the enclosures).
    // `block` (binding §5); each server-mirrored block alternative adds a flavor item whose flag rides sendBlock.
    // #50 (SR-10/SL-1): a PRONE player who can STAND UP FOR FREE (Jump Up) may ALSO declare Block — the server
    // folds the free stand into a plain `block` from prone (ADJACENT only; a prone player who must MOVE to a
    // target is a Blitz, handled below via blitzMove). Mirrors upstream `isBlockActionAvailable`
    // (LogicModule.java:288-291): PRONE excluded from Block UNLESS `canStandUpForFree`. The client was too
    // RESTRICTIVE — it failed to OFFER a block the server already accepts (fidelity corollary). #58 §7.1 (Yularen
    // 07-22): the adjacent-enemy count now uses the upstream-EXACT `adjacentBlockableEnemyIds` (canBeBlocked =
    // STANDING||MOVING) shared with #58, discharging #50's disclosed STANDING-only narrowing (behaviour-identical
    // in practice — an opponent is never MOVING on my turn — but faithful; the defender click-target gate is a
    // separate surface, unchanged).
    // #183/BA-1 (Meero SR-173): the `'blitz'` (Blitz! kickoff) turnMode forbids a standalone Block — gate the branch,
    // which also covers the property-keyed alternatives and the separate Chomp entry below.
    if (blockActionAllowed(game) && (standing || (prone && canStandUpForFree(game, playerId))) && adjacentBlockableEnemyIds(game, playerId).length > 0) {
      out.push({ action: 'block', label: 'Block', kind: 'declare', enabled: true });
      // #207/SR-241: the four block-alternative rows use the same property-keyed offer set as the Blitz chooser.
      // Every row still declares NORMAL `block`; only the later clientBlock's existing USING_* flag changes.
      for (const offer of blockAlternativeOffers(game, playerId)) {
        out.push({ action: 'block', label: offer.label, kind: 'declare', enabled: true, blockKind: offer.kind });
      }
      // Chomp stays a separate menu row outside #207's four-property chooser set. Upstream adds it when
      // specialBlocksAvailable && isChompAvailable (bb2025/SelectLogicModule.java:372-374), and the block/blitz
      // plugin uses that same predicate (bb2025/BlockLogicExtensionPlugin.java:49-53). Grantor, adjacency and
      // once-per-pair bookkeeping are cited at chompAvailable (LogicModule.java:735-752; MonstrousMouth.java;
      // FieldModel.java:1069-1071). The row remains a plain `block` declare carrying only blockKind:'chomp'.
      if (chompAvailable(game, playerId)) {
        out.push({ action: 'block', label: BLOCK_KIND_LABEL.chomp, kind: 'declare', enabled: true, blockKind: 'chomp' });
      }
    }
    // Look Into My Eyes is a wide-rail election, not a top-level skill declaration. A fresh carrier must
    // choose the ordinary parent action first; only its exact acting-player echo may surface the property-map
    // election below. The declared-state `starUseSkill` row remains mounted for reconnect parity.
    // #181 (B, Meero SR-152/154): STAR SELECT declares. The pure layer decides offerability + what the action IS;
    // the view supplies its target (order66Interaction's star-block branch, or Fives' keg arm). Each sends the exact
    // wire its upstream popup pick sends (SelectLogicModule bb2025) and gates on an unused-property predicate.
    // THREE top-level select declares live here: Vicious Vines, The Flashing Blade, Beer Barrel Bash! (keg).
    // ⚠ Putrid Regurgitation is NOT a select declare — it is a MID-ACTIVATION follow-up
    // (`PutridRegurgitationBlitzLogicModule.isPutridRegurgitationAvailable` = !isMoveAvailable && hasBlocked() &&
    // unused canUseVomitAfterBlock), its base `isPutridRegurgitationAvailable()` returns false, and its BLOCK
    // variant is already server-driven (the skillUse dialog, PR-2 live) — a different CONTEXT, routed to Meero, not
    // a fourth entry here. ⚠ Keg came home HERE (SR-154): I first routed it to a `playerThrowKeg` reuse that turned
    // out to be DEAD CODE — a dead function read as a contract.
    if (viciousVinesAvailable(game, playerId)) out.push({ action: 'viciousVines', label: 'Vicious Vines', kind: 'declare', enabled: true });
    if (theFlashingBladeAvailable(game, playerId)) out.push({ action: 'theFlashingBlade', label: 'The Flashing Blade', kind: 'declare', enabled: true });
    // Beer Barrel Bash! (Meero SR-154): a plain top-level declare, `throwKey` (the upstream `PlayerAction.THROW_KEG`
    // JSON key — an upstream TYPO, sent verbatim). Enters the THROW_KEG state; Fives' target-arm sends
    // CLIENT_THROW_KEG{target} on the target click (co-land seam, cross-referenced). ⚠ leaping fidelity: the generic
    // `declareAction` send passes `leaping: isJumping()` while upstream passes false for the keg — these AGREE
    // because a fresh select-menu declare has no jump toggled (isJumping reads the mid-move leaping flag, which is
    // clear before the first move); checked, not assumed, per the invisible-divergence lesson this seam taught.
    if (beerBarrelBashAvailable(game, playerId)) out.push({ action: 'throwKey', label: 'Throw Keg', kind: 'declare', enabled: true });
    // Star S8 SELECT declares (bb2025 SelectLogicModule:80-87/:212-244): each sends its exact PlayerAction wire
    // token via the generic declare (leaping=false, matching upstream's literal `false` argument). Blastin' is
    // the pair declare — declareAction chases the acting-player command with the skill's CLIENT_USE_SKILL
    // (SelectLogicModule:240-244); the server flips turnMode:thenIStartedBlastin for the target beat.
    if (kickEmBlockAvailable(game, playerId)) out.push({ action: 'kickEmBlock', label: "Kick 'Em", kind: 'declare', enabled: true });
    if (kickEmBlitzAvailable(game, playerId)) out.push({ action: 'kickEmBlitz', label: "Kick 'em - Blitz", kind: 'declare', enabled: true });
    if (furiousOutburstAvailable(game, playerId)) out.push({ action: 'furiousOutburst', label: 'Furious Outburst', kind: 'declare', enabled: true });
    if (thenIStartedBlastinAvailable(game, playerId)) out.push({ action: 'thenIStartedBlastin', label: "Blastin' Solves Everything", kind: 'declare', enabled: true });
    // #58 (SR-54): MULTIPLE BLOCK — a `canBlockTwoAtOnce` carrier (the BB2025 "Multiple Block" skill) with >1
    // adjacent blockable opponent may block TWO at once. Mirrors upstream `isMultiBlockActionAvailable`
    // (LogicModule.java:300-316), NARROWED to the canBlockTwoAtOnce limb only — CITE-THE-MECHANISM (ML-9): the
    // disjunction's other limb `canBlockMoreThanOnce` has exactly one BB2025 grantor, Ball & Chain, which ALSO
    // registers `CancelSkillProperty(canBlockMoreThanOnce)` (bb2025/BallAndChain:32+:42) → provably dead on our
    // ruleset; and `providesMultipleBlockAlternative` (the Stab-alt branch) has ZERO BB2025 grantors (only
    // bb2020/Stab:31). Both omitted as UNREACHABLE-by-construction, NOT unsafe — the cancel-checks are what make
    // upstream's disjunction safe; re-open if a BB2025 skill grants either property. ML-11: cancel semantics are
    // NOT on the wire (the client sees skillArray strings only), so the canceller-set for canBlockTwoAtOnce is an
    // explicit EMPTY-but-cited set (nothing cancels it on BB2025 today; one place to extend). Same #50 clauses
    // (isActive via the :787 gate; PRONE ⇒ canStandUpForFree). Count via the shared canBeBlocked helper (§7.1).
    // clientStateMachine:125 routes `multipleBlock` → SYNCHRONOUS_MULTI_BLOCK for this carrier.
    if (blockActionAllowed(game) // #183/BA-1: no standalone Multiple Block in the Blitz! kickoff (turnMode 'blitz')
        && (standing || (prone && canStandUpForFree(game, playerId)))
        && hasSkill(game, playerId, 'Multiple Block') // canBlockTwoAtOnce grantor; canceller-set = {} (BB2025: nothing cancels it)
        && adjacentBlockableEnemyIds(game, playerId).length > 1) {
      out.push({ action: 'multipleBlock', label: 'Multiple Block', kind: 'declare', enabled: true });
    }
    // A.4 BLITZ: Move + one block if the team hasn't blitzed this turn AND a standing enemy sits within move
    // distance (owner o66ad #8 — no dead Blitz declare when nobody's reachable). Declare `blitzMove`; the server
    // surfaces selectBlitzTarget → the target/reach is picked + validated server-side (never predicted).
    if (!teamTurnFlag(game, side, 'blitzUsed') && blitzableEnemyExists(game, playerId, p)) {
      // Owner o66w (RE-CORRECTED from source + live): a prone Blitz declares `blitzMove`, NOT `standUpBlitz`.
      // Fork StepEndSelecting: standUpBlitz → setBlitzUsed + endGenerator = "stand up AND END blitz" (skill-gated,
      // ends the activation — the owner-observed bug). blitzMove → blitzMoveGenerator = the real move+block, with
      // the 3-MA stand-up folded into the first squares. So the SAME declare stands + walks + blocks from prone.
      out.push({ action: 'blitzMove', label: 'Blitz', kind: 'declare', enabled: true });
    }
    // HYPNOTIC GAZE (owner o66al): a player carrying the skill may GAZE — verbatim-shaped on upstream's blitz
    // (SelectLogicModule bb2025: `case GAZE → sendActingPlayer(GAZE_MOVE)`; GazeMoveLogicModule extends
    // MoveLogicModule, so it WALKS like a move, then a click on an ADJACENT enemy fires the gaze → CONFUSED on the
    // server roll). Offered for a standing gazer with a standing enemy within move distance (same gate as Blitz).
    if (chargeRestrictedSpecialActionAllowed(game)
        && hasSkill(game, playerId, 'hypnoticGaze') && blitzableEnemyExists(game, playerId, p)) {
      out.push({ action: 'gazeMove', label: 'Hypnotic Gaze', kind: 'declare', enabled: true });
    }
    // FOUL (owner o66j #8 + o66r #6/#12): a standing player may Foul once per turn (foulUsed) whenever a DOWN
    // enemy exists to WALK to — NOT only when already adjacent (that blocked walk-to-foul). Declared `foulMove`
    // (moving variant → walk to the victim); the boot rides the target click (router gates adjacency there).
    // #41 (2026-07-16): once-per-turn — hide Foul after the team has fouled, UNLESS this actor has "Sneakiest of
    // the Lot" (NamedProperties.allowsAdditionalFoul, the only skill granting it) → a legit 2nd foul. Mirrors the
    // server gate `!foulUsed || hasSkillProperty(allowsAdditionalFoul)` (StepInitSelecting:220-221 / LogicModule:363).
    if (chargeRestrictedSpecialActionAllowed(game)
        && (!teamTurnFlag(game, side, 'foulUsed') || hasSkill(game, playerId, 'Sneakiest of the Lot')) && hasDownEnemy(game, playerId)) {
      out.push({ action: 'foulMove', label: 'Foul', kind: 'declare', enabled: true });
    }
    // PASS + HAND-OFF (owner o66ad #8): declarable whenever the ball is GETTABLE (carrying, or loose on the pitch).
    // The No Hands / No Ball / My Ball / Ball and Chain exclusion rides the property-mirror set above; nothing finer
    // gates walk-to-pass / walk-to-hand-off (the server validates pickup + the throw). Each is once per turn.
    // Declared as the MOVING variant (`passMove`/`handOverMove`) so the player may WALK first; the final
    // CLIENT_PASS/CLIENT_HAND_OVER rides the target click, the state being the ack.
    // Star S7 widening: upstream isPass/isPunt/isHandOverActionAvailable (LogicModule.java:375-405) each take a
    // `treacherousAvailable` limb — Hakflem may declare a ball action WITHOUT the ball when an adjacent team-mate
    // carrier can be stabbed for it. The influence labels mirror ClientStateSelect(bb2025):323-339 (" (Treacherous)"
    // on Pass / Shot To Nothing / Hand Over / Punt only — never the bomb variant). Owner sequencing supersedes the
    // upstream auto-pair: the declaration echo opens the unified explicit Treacherous election.
    const treacherous = treacherousAvailable(game, playerId);
    const treacherousSuffix = treacherous ? ' (Treacherous)' : '';
    const ballAvailable = ballAvailableTo(game, playerId) || treacherous;
    if (ballAvailable) {
      const regularPassAvailable = !teamTurnFlag(game, side, 'passUsed') && !preventsRegularPassOrHandOver(game, playerId);
      if (regularPassAvailable) {
        out.push({ action: 'passMove', label: `Pass${treacherousSuffix}`, kind: 'declare', enabled: true });
        // Owner 08-21: Shot to Nothing is elected only after the ordinary Pass declaration's exact
        // server echo. It is deliberately absent here: no second declaration row and no pre-ack use.
      }
    }
    /* OWNER AMENDMENTS (08-05; verbatim):
     * 1. "Punt should exist at the start of a player's activation before they move."
     * 2. "Punt should *never* surface mid-move." — any activation progress (currentMove > 0, hasMoved/standing-up spent, any declared-action progression) => NO Punt menu entry, no exceptions.
     * 3. "It *must* be declared at the start of the activation." — Punt is a START-OF-ACTIVATION DECLARE: the declare initiates the punt ACTION (movement then happens INSIDE the declared punt action per the action's own rules, like the pass/hand-off *Move variants); it is not an in-move election.
     * Structural upstream truth: `bb2025/SelectLogicModule.java:41-50,253-319` builds the declare menu only in
     * SELECT_PLAYER. The canonical `declaresAllowed` guard at the `playerDeclareSet` call site closes this port's
     * null/unmapped-action SELECT fallback for every fresh declare. */
    // BB2025 predicate, term-for-term from `LogicModule.isPuntActionAvailable` (`LogicModule.java:385-395`):
    // unused `puntUsed` (`IJsonOption.java:414`); sole canPunt grantor Punt (`skill/bb2025/Punt.java:13-20`);
    // ball available (the HMP twin likewise has no local Treacherous mirror); non-null state; able-to-move OR
    // carrying; prone only with allowSpecialActionsFromProne; and no sole preventer "No Ball"
    // (`skill/bb2025/NoBall.java:18-29`). Declare id is `puntMove` (`PlayerAction.java:34`).
    const ableToMove = (standing || prone) && !!(ps & FLAG_ACTIVE) && !(ps & FLAG_ROOTED) && !(ps & FLAG_CHOMPED);
    if (!teamTurnFlag(game, side, 'puntUsed')
        && canPunt(game, playerId)
        && ballAvailable
        && p.playerState != null
        && (ableToMove || isBallCarrier(game, playerId) || treacherous) // S7: :391 `|| treacherousAvailable`
        && (!prone || gameOptionEnabled(game, 'allowSpecialActionsFromProne'))
        && !preventsPuntAction(game, playerId)) {
      out.push({ action: 'puntMove', label: `Punt${treacherousSuffix}`, kind: 'declare', enabled: true });
    }
    if (ballAvailable
        && !teamTurnFlag(game, side, 'handOverUsed')
        && !preventsRegularPassOrHandOver(game, playerId)) {
      out.push({ action: 'handOverMove', label: `Hand-off${treacherousSuffix}`, kind: 'declare', enabled: true });
    }
    // THROW BOMB (Bombardier) — verified vs upstream LogicModule.isThrowBombActionAvailable (L319-329):
    // standing (!isProneOrStunned) + the enableThrowBombAction skill property (Bombardier) + !turnData.bombUsed
    // + isBombActionAllowed(turnMode) (this declare set only builds in a selecting turnMode). Declares throwBomb
    // (SelectLogicModule bb2025 L175 `case BOMB -> sendActingPlayer(THROW_BOMB, false)`); the bomber does NOT move
    // (no throwBombMove). The BOMB state (clientStateMachine ACTION_STATE) reuses the PASS range template, and the
    // target click rides CLIENT_PASS (sendPassTarget) — the same command playerThrowBomb sends.
    if (chargeRestrictedSpecialActionAllowed(game)
        && standing && hasSkill(game, playerId, 'bombardier') && !teamTurnFlag(game, side, 'bombUsed')) {
      out.push({ action: 'throwBomb', label: 'Throw Bomb', kind: 'declare', enabled: true });
      // Star S7: SelectLogicModule(bb2025):293-297 — BOMB available + unused canGainHailMary ⇒
      // SHOT_TO_NOTHING_BOMB. Composite: throwBomb declare + paired use-skill (store). No treacherous
      // label influence on the bomb variant (ClientStateSelect(bb2025):323-339 renames pass-side rows only).
      if (hasUnusedGrantor(game, playerId, [SHOT_TO_NOTHING_SKILL])) {
        out.push({ action: 'shotToNothingBomb', label: 'Shot to Nothing Bomb', kind: 'declare', enabled: true, ruleId: 'shotToNothing' });
      }
    }
    // ALL YOU CAN EAT (#223b): a separate top-level commitment before bomb one. Upstream SelectLogicModule:207-209
    // sends ALL_YOU_CAN_EAT with leaping=false. The generic declare's isJumping() agrees for this fresh select-menu
    // declare: no jump has been toggled before the activation's first move, so the server-synced leaping flag is false.
    if (allYouCanEatAvailable(game, playerId)) {
      out.push({ action: 'allYouCanEat', label: 'All You Can Eat — Two Bombs', kind: 'declare', enabled: true });
    }
    // THROW TEAM-MATE (owner o66am, PASS-rail — verified vs upstream SelectLogicModule bb2025 'case
    // THROW_TEAM_MATE -> sendActingPlayer(THROW_TEAM_MATE_MOVE)'; ThrowTeamMateLogicModule extends MoveLogicModule).
    // Declared throwTeamMateMove; the thrower WALKS adjacent to a Right Stuff team-mate, clicks them (picks them up
    // = CLIENT_THROW_TEAM_MATE{thrownPlayerId}), then targets a LANDING square (CLIENT_THROW_TEAM_MATE{coordinate}).
    // Owner ruling 08-17: TTM was declarable TWICE in one turn (the menu never checked the once-per-turn flag) —
    // gate it exactly like blitzUsed/foulUsed/ktmUsed. Server field CONFIRMED on the wire: TurnData.java:38/239-248
    // (`ttmUsed` + `setTtmUsed` → notifyObservers(ModelChangeId.TURN_DATA_SET_TTM_USED)), JSON key `IJsonOption.
    // TTM_USED` = "ttmUsed" (IJsonOption.java:614), and the client ALREADY wires it identically to blitzUsed —
    // modelChangeProcessor.ts:492 `[ModelChangeId.TURN_DATA_SET_TTM_USED]: turnDataSetter('ttmUsed')` — this menu
    // predicate was the only missing link. Live-verified game 866: commandNr 574 (21:55:57) sent
    // `{"modelChangeId":"turnDataSetTtmUsed","modelChangeKey":"home"/"away",...}` for BOTH sides. KTM already had
    // its `ktmUsed` gate (below, pre-existing) — TTM was the sole gap in the once-per-turn class.
    if (!teamTurnFlag(game, side, 'ttmUsed') && hasSkill(game, playerId, 'throwTeamMate') && hasThrowableTeammate(game, playerId)) {
      out.push({ action: 'throwTeamMateMove', label: 'Throw Team-Mate', kind: 'declare', enabled: true });
    }
    // BB2025 LogicModule.java:472-475 + TtmMechanic.java:74-75: KTM needs its skill, a kickable
    // Right Stuff team-mate, and the acting team's `ktmUsed` flag clear (TurnData.java:460).
    if (!teamTurnFlag(game, side, 'ktmUsed')
        && hasSkill(game, playerId, 'kickTeamMate')
        && hasThrowableTeammate(game, playerId)) {
      out.push({ action: 'kickTeamMateMove', label: 'Kick Team-Mate', kind: 'declare', enabled: true });
    }
    // SECURE THE BALL (owner o66j fix; #8 order = last): grab a LOOSE, MOVING ball (in play + moving + not used
    // this turn) — NOT a settled-carrier action. Occludes whenever the ball isn't a live moving ball. #218 (owner-fg
    // 07-29, Meero SR-219): dropped the client-invented `standing &&` — upstream `isSecureTheBallActionAvailable`
    // (LogicModule.java:332) has NO stance clause, so a PRONE (non-stunned) securer IS offered it. Safe: we're inside
    // the `standing || prone` enclosure (:1133) + the `!(ps & FLAG_ACTIVE)` early-return (:1108), so a STUNNED/inactive
    // player never reaches here ⇒ post-drop = offered to standing-OR-prone only, byte-faithful to upstream's isActive gate.
    if (isSecureTheBallAvailable(game, playerId)) {
      out.push({ action: 'secureTheBall', label: 'Secure the Ball', kind: 'declare', enabled: true });
    }
  }
  return out;
}

/**
 * A right-click on the acting player may replace an untouched Move/Blitz/Block declaration with another legal
 * activation type. This is the same server-supported action change used by a pristine friendly-player switch,
 * but it is deliberately narrower: once the echoed acting-player model records movement, an attack, a skill, or
 * any other activation progress, the declaration set disappears. Blitz receives one additional authoritative
 * fence: the server's `blitzUsed` turn flag is the explicit point after which its action type cannot be changed,
 * even if another acting-player field arrives a frame later.
 */
function pristineActivationTypeTransitions(
  game: GameJson,
  state: string,
  playerId: string,
  p: PlayerDataLike | undefined,
): CoachAction[] {
  if (!p || !declaresAllowed(game)) return [];
  const acting = game.actingPlayer as { playerAction?: string | null } | undefined;
  const rawAction = String(acting?.playerAction ?? '');
  const currentAction = rawAction === 'move'
    ? 'move'
    : rawAction === 'block'
      ? 'block'
      : (rawAction === 'blitz' || rawAction === 'blitzMove')
        ? 'blitzMove'
        : null;
  const changeableState = state === 'MOVE' || state === 'BLOCK'
    || state === 'BLITZ' || state === 'SELECT_BLITZ_TARGET';
  if (!currentAction || !changeableState) return [];
  if (currentAction === 'blitzMove'
      && teamTurnFlag(game, playerSideIsHome(game, playerId), 'blitzUsed')) return [];
  return playerDeclareSet(game, playerId, p)
    .filter((action) => action.kind === 'declare' && action.action !== currentAction);
}

export function availableActions(
  game: GameJson | null | undefined,
  ctx: ClientStateContext,
  selectedPlayerId: string,
): CoachAction[] {
  if (!game) return [];
  const state = deriveClientState(game, ctx);
  const actingId = String((game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  const p = selectedPlayerId ? findPlayer(game, selectedPlayerId) : undefined;
  const clickedIsActing = !!selectedPlayerId && selectedPlayerId === actingId;

  if (state === 'UNKNOWN') return [];

  // #432: the OtB reaction modes carry their OWN vocabulary — never the general declare set.
  // KickoffReturnLogicModule.actionContext(player):87-100 / PassBlockLogicModule.actionContext(player):117-152:
  // a candidate gets MOVE only while actingPlayer==null && playerState.isAbleToMove(); the acting mover gets
  // END_MOVE; playerInteraction gates on own-team + isActive. Block/Blitz/Foul/Pass are never offered.
  if (state === 'KICKOFF_RETURN' || state === 'PASS_BLOCK') {
    if (clickedIsActing) return [{ action: '', label: 'End Activation', kind: 'endMove', enabled: true }];
    const ps = Number(p?.playerState ?? 0);
    const mine = !!p && playerSideIsHome(game, selectedPlayerId) === (ctx.myIsHome ?? true);
    if (!actingId && mine && (ps & FLAG_ACTIVE) && onTheBallPlayerStateIsAbleToMove(ps)) {
      return [{ action: 'move', label: 'Move', kind: 'declare', enabled: true }];
    }
    return [];
  }

  // AWT parity (medium req): menus are PRESENCE-ONLY — an unavailable action is absent, not a shaded row.
  // SELECT_PLAYER = the fresh declare menu (+ End Turn). SWITCH (owner o66j #13): a selected player who is NOT
  // the current acting player gets that same declare set even mid-activation — clicking them switches (the store
  // ends the prior activation first). An un-actionable player (stunned/off-pitch) contributes no rows.
  if (state === 'SELECT_PLAYER' || (p && !clickedIsActing)) {
    // Owner o66s #7: End Turn is NO LONGER a context-menu item — the coach ends the turn from the HUD End Turn
    // button (which is now disabled off-turn). Keeps the right-click menu to per-player declares only.
    return p && declaresAllowed(game) ? playerDeclareSet(game, selectedPlayerId, p) : [];
  }

  // The acting player itself is clicked mid-activation: the overlay drives the click-to-act; the menu offers the
  // activation-ender plus server-legal action replacements while Move/Blitz/Block is still pristine. Owner o66d:
  // "End Activation" ends just THIS player's action (clientActingPlayer{null}),
  // distinct from "End Turn" (the whole team turn, HUD button). Owner 2026-07-15 (#6.3 stuck): extend beyond MOVE
  // to every DECLARED-action state — after declaring Pass/Throw-Bomb/Throw-Team-Mate/Foul/Blitz/Hand-off/Gaze the
  // coach must be able to ABORT/end the activation (previously only MOVE offered it → a declared TTM with no valid
  // target left the coach stuck with no way to finish the turn).
  // #181 KG-5 (Meero SR-157): THROW_KEG belongs here — a keg declare must survive with an End Activation escape.
  // Upstream `ThrowKegLogicModule.availableActions():91` / `actionContext():107-109` add END_MOVE (gated on
  // isEndPlayerActionAvailable), and it is reachable: `isBeerBarrelBashAvailable` has NO target requirement, so a
  // coach can declare the keg with zero legal targets and would otherwise be stuck. ⚠ REGRESSION the parity fix
  // caused — the retired keg body declared throwBomb ⇒ BOMB (already in this list); correcting the wire to throwKey
  // ⇒ THROW_KEG lost the escape. THE GENERAL FORM: a new declare goes in every STATE-KEYED list (where it must be
  // SURVIVABLE), not just the declare SET (where it is OFFERED).
  // #181 PU-4 (Meero SR-166): PUTRID_REGURGITATION_BLITZ belongs in this state-keyed list — after the vomit is
  // declared the coach keeps an End Activation menu item (upstream offers END_MOVE there). ⚠ PARITY item, NOT a strand
  // fix (Meero SR-174): Esc already ends the activation via ACTIVE_ACTIVATION_STATES (clientStateMachine:220); this
  // restores the menu-item parity, same shape as KG-5's THROW_KEG.
  // Star S8: FURIOUS_OUTBURST offers ONLY End Activation (FuriousOutburstLogicModule.availableActions = {END_MOVE},
  // performAvailableAction END_MOVE → sendActingPlayer(null) — the store's default endActivation wire). Likewise
  // THEN_I_STARTED_BLASTIN offers ONLY End Activation, but its END_MOVE is `sendEndTurn(turnMode)` — endActivation
  // already routes turnMode thenIStartedBlastin → CLIENT_END_TURN. Neither state joins declaredActionStates: the
  // predicate-gated extras there (trio/CotD/wisdom/…) are NOT in these modules' actionContext upstream.
  if (state === 'FURIOUS_OUTBURST' || state === 'THEN_I_STARTED_BLASTIN') {
    return [{ action: '', label: 'End Activation', kind: 'endMove', enabled: true }];
  }
  // Star S8: KICK_EM_BLOCK joins the state-keyed list (KickEmBlockLogicModule extends the mixed BlockLogicModule —
  // its actionContext inherits the block-family extras and END_MOVE); KICK_EM_BLITZ was already present.
  const declaredActionStates = ['MOVE', 'PASS', 'PUNT', 'BOMB', 'THROW_KEG', 'FOUL', 'BLITZ', 'BLOCK', 'SYNCHRONOUS_MULTI_BLOCK', 'SELECT_BLITZ_TARGET', 'SELECT_GAZE_TARGET', 'HAND_OVER', 'THROW_TEAM_MATE', 'KICK_TEAM_MATE', 'GAZE', 'GAZE_MOVE', 'PUTRID_REGURGITATION_BLITZ', 'KICK_EM_BLITZ', 'KICK_EM_BLOCK'];
  if (declaredActionStates.includes(state)) {
    const out: CoachAction[] = clickedIsActing
      ? pristineActivationTypeTransitions(game, state, actingId, p)
      : [];
    // Native moving modules expose JUMP throughout these movement-capable states. Keep the state membership here,
    // while jumpActionOffer owns the capability/move-budget predicate and Pogo > Leap > Jump label hierarchy.
    const jumpActionStates = new Set([
      'MOVE', 'BLITZ', 'FOUL', 'PASS', 'HAND_OVER', 'PUNT', 'THROW_TEAM_MATE', 'KICK_TEAM_MATE',
      'GAZE_MOVE', 'PUTRID_REGURGITATION_BLITZ', 'KICK_EM_BLITZ',
    ]);
    if (jumpActionStates.has(state)) {
      const jump = jumpActionOffer(game, actingId, 'movement');
      if (jump) out.push(jump);
    }
    // SR-244 RG-6: predicates answer whether the skill can fire, but the upstream per-module availableActions()
    // sets also decide whether that action belongs to the current state. Most moving modules inherit Move's set;
    // the bespoke target/throw/block modules do not. Keep both gates so a raw blitzMove in SELECT_BLITZ_TARGET,
    // for example, cannot leak Fumblerooski merely because its skill predicate is otherwise true.
    const fumblerooskiStates = new Set([
      'MOVE', 'PASS', 'PUNT', 'FOUL', 'BLITZ', 'HAND_OVER', 'THROW_TEAM_MATE', 'KICK_TEAM_MATE',
      'GAZE', 'GAZE_MOVE', 'SELECT_GAZE_TARGET', 'KICK_EM_BLITZ',
    ]);
    const wisdomAndRaidingPartyStates = new Set(declaredActionStates.filter((s) => s !== 'PUTRID_REGURGITATION_BLITZ'));
    const putridRegurgitationStates = new Set([
      'MOVE', 'PASS', 'PUNT', 'BLITZ', 'HAND_OVER', 'THROW_TEAM_MATE', 'KICK_TEAM_MATE',
      'GAZE', 'GAZE_MOVE', 'SELECT_GAZE_TARGET', 'PUTRID_REGURGITATION_BLITZ', 'KICK_EM_BLITZ',
    ]);
    const acting = game.actingPlayer as { playerAction?: string | null; hasPassed?: boolean } | undefined;
    const actingAction = String(acting?.playerAction ?? '');
    // U6: PassLogicModule.actionContext (bb2025:190-195) offers HAIL_MARY_PASS in the PASS module iff
    // LogicModule.isHailMaryPassActionAvailable (:635-640: canPassToAnySquare + weather != BLIZZARD),
    // UtilPlayer.hasBall, and !actingPlayer.hasPassed. It does NOT inspect the raw playerAction. Keep that exact
    // gate set here; the server-derived PASS state supplies the module scope and the echoed hasPassed edge owns
    // the pre-CLIENT_PASS lifetime, with no client-side prediction or latch.
    if (state === 'PASS'
        && acting?.hasPassed !== true
        && isBallCarrier(game, actingId)
        && canPassToAnySquare(game, actingId)
        && String(game.fieldModel?.weather ?? '').toLowerCase() !== 'blizzard') {
      out.push({
        action: 'toggleHailMaryPass',
        label: actingAction === 'hailMaryPass' ? 'Cancel Hail Mary Pass' : 'Hail Mary Pass',
        kind: 'declare',
        enabled: true,
      });
    }
    // #236: upstream MoveLogicModule.java:427-428 offers FUMBLEROOSKIE in the mid-activation context alongside
    // END_MOVE; BlitzLogicModule.java:86 includes the same action. It is a no-payload use command, not a declare.
    if (fumblerooskiStates.has(state) && fumblerooskieAvailable(game, actingId)) {
      out.push({ action: 'fumblerooskie', label: 'Fumblerooski — Drop Ball', kind: 'declare', enabled: true });
    }
    // #221: upstream adds Raiding Party to Move/Block and the declared-action extensions, never the fresh Select
    // declare set. Its pick is CLIENT_USE_SKILL, intercepted by the view rather than sent as CLIENT_ACTING_PLAYER.
    if (wisdomAndRaidingPartyStates.has(state)
        && wideRailPreActionModeForPlayerAction('raidingParty', actingAction) === 'staged'
        && raidingPartyAvailable(game, actingId)) {
      out.push({ action: 'raidingParty', label: 'Raiding Party — Reposition Team-Mate', kind: 'declare', enabled: true });
    }
    // #310 / owner 08-20: normal play uses the unified exact-ack election. This canonical row also covers
    // SELECT_BLITZ_TARGET so a reconnect snapshot retains an explicit, guarded Catch of the Day route.
    if (wideRailPreActionModeForPlayerAction('catchOfTheDay', actingAction) === 'staged'
        && catchOfTheDayAvailable(game, actingId)) {
      out.push({ action: 'catchOfTheDay', label: 'Catch of the Day', kind: 'declare', enabled: true });
    }
    if (wideRailPreActionModeForPlayerAction('blackInk', actingAction) === 'staged'
        && blackInkAvailable(game, actingId)) {
      out.push({ action: 'blackInk', label: 'Black Ink', kind: 'declare', enabled: true });
    }
    // #226: upstream offers Wisdom only after an action is declared and before the acting player acts. Its dedicated
    // no-payload command is intercepted by the view; target and skill selection are server-owned dialogs.
    if (wisdomAndRaidingPartyStates.has(state)
        && wideRailPreActionModeForPlayerAction('wisdomOfTheWhiteDwarf', actingAction) === 'staged'
        && wisdomAvailable(game, actingId)) {
      out.push({ action: 'wisdom', label: 'Wisdom of the White Dwarf', kind: 'declare', enabled: true });
    }
    // Star S4 — the gaze trio rides the shared registry-mounted use-skill election (ONE action id; the
    // ruleId selects the STAR_RULE_REGISTRY row and the store's generic sender commits CLIENT_USE_SKILL).
    // State membership mirrors upstream actionContext: MoveLogicModule:452-470 adds all three and every
    // moving module inherits it (Blitz/KickEmBlitz/PutridRegurgitationBlitz/TTM/KTM/Gaze do not override);
    // the bespoke modules add them explicitly (bb2025 Bomb:79-91, ThrowKeg:120-132, Foul (mixed):147-181,
    // BlockLogicExtension:59-82, SynchronousMultiBlock:163-175, SelectBlitzTarget:87-105) — EXCEPT the
    // bb2025 Pass:222/234, HandOver:127/139 and Punt:150/162 overrides, which offer ONLY Hex + Zoat (no
    // Look Into My Eyes: a passer path never steals the ball). Predicates gate the rest (!hasActed ⇒ the
    // rows vanish once the activation acts). Star S7 adds Treacherous through the SAME seam (its own
    // exclusion set: PASS/PUNT — HandOver keeps it upstream).
    {
      const noLimeStates = new Set(['PASS', 'PUNT', 'HAND_OVER']);
      // Owner sequencing override: Treacherous no longer auto-pairs on a fresh Pass/Punt declaration. Keep its
      // canonical context row in PASS/PUNT as the reconnect fallback; locally correlated sessions suppress it in
      // the view and at the store sender. HandOver already shares this same row.
      const mounted: { ruleId: string; predicate: (g: GameJson, id: string) => boolean; excluded?: Set<string> }[] = [
        { ruleId: 'lookIntoMyEyes', predicate: lookIntoMyEyesAvailable, excluded: noLimeStates },
        { ruleId: 'balefulHex', predicate: balefulHexAvailable },
        { ruleId: 'excuseMeAreYouAZoat', predicate: autoGazeZoatAvailable },
        { ruleId: 'treacherous', predicate: treacherousActingAvailable },
      ];
      for (const { ruleId, predicate, excluded } of mounted) {
        if (excluded?.has(state)) continue;
        if (wideRailPreActionModeForPlayerAction(ruleId as WideRailPreActionRuleId, actingAction) !== 'staged') continue;
        if (!predicate(game, actingId)) continue;
        const election = starUseSkillElection(ruleId);
        if (election) out.push({ action: 'starUseSkill', ruleId, label: election.label, kind: 'declare', enabled: true });
      }
    }
    // Membership: `MoveLogicPlugin.actionContext`; `BlitzLogicModule` / bb2025 `FoulLogicModule`
    // `availableActions` + inherited Move context; bespoke HandOver/Pass/Punt/SelectBlitzTarget `actionContext`.
    const incorporealStates = new Set([
      'MOVE', 'PASS', 'PUNT', 'FOUL', 'BLITZ', 'SELECT_BLITZ_TARGET', 'HAND_OVER',
      'THROW_TEAM_MATE', 'KICK_TEAM_MATE', 'GAZE', 'GAZE_MOVE', 'SELECT_GAZE_TARGET', 'KICK_EM_BLITZ',
    ]);
    if (incorporealStates.has(state)
        && wideRailPreActionModeForPlayerAction('incorporeal', actingAction) === 'staged'
        && incorporealAvailable(game, actingId)) {
      const active = incorporealIsActive(game, actingId);
      // `AbstractClientStateMove.itemConfigs` / `influencedItemConfigs`: Incorporeal / Cancel Incorporeal.
      // SelectBlitzTargetLogicModule.actionContext omits INCORPOREAL_ACTIVE, so that state keeps the base label.
      out.push({
        action: 'incorporeal',
        label: active && state !== 'SELECT_BLITZ_TARGET' ? 'Cancel Incorporeal' : 'Incorporeal',
        kind: 'declare',
        enabled: true,
        ruleId: 'incorporeal',
      });
    }
    // #181 PR-1 (Meero SR-166): mid-activation Putrid Regurgitation — a Putrid carrier who has BLOCKED may declare an
    // ADDITIONAL Projectile Vomit attack, offered ALONGSIDE End Activation (not instead). The predicate reads the RAW
    // acting playerAction (PU-1), so once the vomit is declared it returns false and only End Activation remains — no
    // double-offer. Wire = the generic declareAction; the target click rides the live star-block route (e8bd87b4 + 6e88f4db).
    if (putridRegurgitationStates.has(state) && putridRegurgitationAvailable(game, actingId)) {
      out.push({ action: 'putridRegurgitationBlitz', label: 'Projectile Vomit', kind: 'declare', enabled: true });
    }
    // Star S3: upstream adds ILL_CARRY_YOU in the Move(+plugin)/Blitz/Block/Bomb/Foul/HandOver/Pass/Punt/
    // SelectBlitzTarget modules — the declared rails, never the fresh Select menu. Pick-up (used=true) is the
    // isIllCarryYouAvailable case each module carries; the place-and-end variant (used=false) exists only on
    // the MOVE rail (MoveLogicPlugin(bb2025).performAvailableAction, canPlaceCarriedPlayer branch).
    const illCarryYouStates = new Set(['MOVE', 'BLITZ', 'BLOCK', 'BOMB', 'FOUL', 'HAND_OVER', 'PASS', 'PUNT', 'SELECT_BLITZ_TARGET', 'KICK_EM_BLOCK', 'KICK_EM_BLITZ']);
    if (illCarryYouStates.has(state)
        && wideRailPreActionModeForPlayerAction('illCarryYou', actingAction) === 'staged'
        && illCarryYouAvailable(game, actingId)) {
      out.push({ action: 'illCarryYou', label: "I'll Carry You — Pick Up Team-Mate", kind: 'declare', enabled: true });
    }
    if (state === 'SELECT_BLITZ_TARGET') {
      if (wideRailPreActionModeForPlayerAction('frenziedRush', actingAction) === 'staged'
          && frenziedRushAvailable(game, actingId)) {
        out.push({ action: 'frenziedRush', label: 'Frenzied Rush', kind: 'declare', enabled: true });
      }
      if (wideRailPreActionModeForPlayerAction('slashingNails', actingAction) === 'staged'
          && slashingNailsAvailable(game, actingId)) {
        out.push({ action: 'slashingNails', label: 'Slashing Nails', kind: 'declare', enabled: true });
      }
    }
    if (state === 'MOVE' && canPlaceCarriedPlayerNow(game, actingId)) {
      out.push({ action: 'placeCarriedPlayer', label: 'Place Carried Player And End Action', kind: 'declare', enabled: true });
    }
    // In-action escalation mirrors `bb2025/PuntLogicModule.java:116-123`: only PUNT_MOVE while the acting player
    // actually has the ball offers ClientAction.PUNT. The generic declare sender preserves the current jumping flag,
    // matching `PuntLogicModule.java:100-107`, and sends the exact `punt` id (`PlayerAction.java:34`).
    if (state === 'PUNT' && actingAction === 'puntMove' && isBallCarrier(game, actingId)) {
      out.push({ action: 'punt', label: 'Punt', kind: 'declare', enabled: true });
    }
    out.push({ action: '', label: 'End Activation', kind: 'endMove', enabled: true });
    return out;
  }

  return [];
}
