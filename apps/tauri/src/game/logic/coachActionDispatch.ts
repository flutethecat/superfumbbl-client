/**
 * COACH ACTION DISPATCH — S0 star-rule descriptor registry (view-independent, pure logic).
 *
 * This registry DESCRIBES the 63 BB2025 star special rules and the seam each one's coach election will
 * mount on. It does NOT dispatch: no offer predicate, no sender, no store/view import. Actual election
 * mounting lands in S2+ (see docs/star-program-s0-registry.md for the land order).
 *
 * Source of record: docs/bb2025-star-special-rule-surfacing-audit-2026-08-18.md (Modern matrix,
 * client authority ffcc6d13). `evidence` is that matrix's "Current Modern surfacing point" cell, verbatim.
 * `surfacing` is the first classification token of its "Modern result" verdict.
 *
 * ⚠ COVERAGE DISCRIMINATOR is `evidence`/`surfacing` here, NOT playerActionRegistry.source. blackInk is
 * registry-'unhandled' yet genuinely Surfaced through the blitz-window card (verified). The two registries
 * answer different questions: playerActionRegistry classifies a wire PlayerAction; this one classifies a
 * RULE's coach-decision surface.
 *
 * Both Modern and Classic are meant to consume this seam, so no row may encode a view.
 */
import { NetCommandId, type NetCommandIdValue } from '@fumbbl40k/ffb-protocol';

/** How completely the client exposes the rule's upstream coach decision today. */
export type StarSurfacing =
  | 'explicit'      // named client action/election for this rule
  | 'generic'       // exposed through a shared server-bounded dialog/reroll/modifier surface
  | 'server-owned'  // no coach decision; the server owns the effect, the client renders the result
  | 'partial'       // some state/wire exists, one legal entry or continuation cannot complete
  | 'missing'       // upstream offers a distinct coach decision with no complete surface
  | 'upstream-gap'; // the rule is real, upstream registers no BB2025 producer — client prediction prohibited

/** The six action rails plus the two non-declaration seams star rules ride. */
export type StarRail =
  | 'move' | 'block' | 'blitz' | 'foul' | 'pass-bomb-ttm' | 'special-action'
  | 'reroll-handler' | 'passive';

/** The command SHAPE by which the coach's choice is committed — the thing S2+ must mount. */
export type StarElectionKind =
  | 'use-skill'         // CLIENT_USE_SKILL / skillUse dialog answer
  | 'player-choice'     // CLIENT_PLAYER_CHOICE over a server-offered ID set
  | 'field-coordinate'  // a server-bounded square/target commit
  | 'toggle'            // rail-local true/false
  | 'none';             // no distinct election; rides an existing declaration or reroll surface

export interface StarRuleDescriptor {
  /** Stable client key. Not a wire value. */
  readonly ruleId: string;
  readonly star: string;
  /**
   * Exact upstream Skill.getName() spelling, keying BB2025_SPECIAL_VOCABULARY.
   * null ⇒ no BB2025 upstream producer exists (the single 'upstream-gap' row).
   */
  readonly upstreamSkill: string | null;
  readonly surfacing: StarSurfacing;
  readonly rail: StarRail;
  readonly electionKind: StarElectionKind;
  /** Exact wire commands the completed rule uses. Empty ⇒ purely received-state, zero-send. */
  readonly wireCommands: readonly NetCommandIdValue[];
  /** The surfacing point — audit matrix column 4, verbatim. */
  readonly evidence: string;
}

const C = NetCommandId;

export const STAR_RULE_REGISTRY: readonly StarRuleDescriptor[] = [
  {
    ruleId: 'blindRage', star: 'Akhorne the Squirrel', upstreamSkill: 'Blind Rage',
    surfacing: 'generic', rail: 'reroll-handler', electionKind: 'none',
    wireCommands: [C.CLIENT_USE_RE_ROLL],
    evidence: 'Server reroll source on Dauntless; generic reroll surface.',
  },
  {
    ruleId: 'savageBlow', star: 'Anqi Panqi', upstreamSkill: 'Savage Blow',
    surfacing: 'explicit', rail: 'reroll-handler', electionKind: 'none',
    wireCommands: [C.CLIENT_USE_MULTI_BLOCK_DICE_RE_ROLL, C.CLIENT_USE_SINGLE_BLOCK_DIE_RE_ROLL],
    evidence: 'Multi-block/block partial-reroll surface with selected dice indexes.',
  },
  {
    ruleId: 'blastIt', star: 'Barik Farblast', upstreamSkill: 'Blast It!',
    surfacing: 'generic', rail: 'pass-bomb-ttm', electionKind: 'none',
    wireCommands: [C.CLIENT_PASS, C.CLIENT_USE_RE_ROLL],
    evidence: 'Hail Mary Pass rail; scatter reroll is generic and catch modifier is server-owned.',
  },
  {
    ruleId: 'putridRegurgitation', star: 'Bilerot Vomitflesh', upstreamSkill: 'Putrid Regurgitation',
    surfacing: 'explicit', rail: 'block', electionKind: 'none',
    wireCommands: [C.CLIENT_ACTING_PLAYER, C.CLIENT_BLOCK],
    evidence: 'Named Projectile Vomit election after Block plus block-flavor routing.',
  },
  {
    ruleId: 'lookIntoMyEyes', star: "Boa Kon'ssstriktr", upstreamSkill: 'Look Into My Eyes',
    surfacing: 'explicit', rail: 'special-action', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'S4 registry-mounted use-skill election row → exact `CLIENT_USE_SKILL`; target/roll server-owned (StepLookIntoMyEyes), reroll rides the generic surface.',
  },
  {
    ruleId: 'kaboom', star: 'Bomber Dribblesnot', upstreamSkill: 'Kaboom!',
    surfacing: 'generic', rail: 'pass-bomb-ttm', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'Bomb catch/explosion decision rides the existing server skill-use/bomb flow.',
  },
  {
    ruleId: 'tastyMorsel', star: 'Captain Karina von Riesz', upstreamSkill: 'Tasty Morsel',
    surfacing: 'generic', rail: 'special-action', electionKind: 'player-choice',
    wireCommands: [C.CLIENT_USE_SKILL, C.CLIENT_PLAYER_CHOICE],
    evidence: 'Server-bounded Bloodlust/skill choice and player selection use generic reactive rails.',
  },
  {
    ruleId: 'allYouCanEat', star: 'Cindy Piewhistle', upstreamSkill: 'All You Can Eat',
    surfacing: 'explicit', rail: 'pass-bomb-ttm', electionKind: 'none',
    wireCommands: [C.CLIENT_ACTING_PLAYER, C.CLIENT_PASS],
    evidence: 'Named declaration and double-bomb continuation.',
  },
  {
    ruleId: 'starOfTheShow', star: 'Count Luthor von Drakenborg', upstreamSkill: 'Star of the Show',
    surfacing: 'generic', rail: 'reroll-handler', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL, C.CLIENT_USE_RE_ROLL],
    evidence: 'Generic skill-use election lets the coach accept the offer; the server then grants the temporary drive reroll and ordinary reroll UI consumes it.',
  },
  {
    ruleId: 'reliable', star: 'Deeproot Strongbranch', upstreamSkill: 'Reliable',
    surfacing: 'server-owned', rail: 'pass-bomb-ttm', electionKind: 'none',
    wireCommands: [C.CLIENT_THROW_TEAM_MATE],
    evidence: 'StepRightStuff automatically turns a fumbled TTM landing into a success and emits ReportSkillUse(FUMBLED_PLAYER_LANDS_SAFELY); there is no coach election or extra client command.',
  },
  {
    ruleId: 'aSneakyPair', star: 'Dribl and Drull', upstreamSkill: 'A Sneaky Pair',
    surfacing: 'generic', rail: 'passive', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'Pair enrollment/hiring is server-owned; the Armour-versus-Injury use is an optional generic modifier election.',
  },
  {
    ruleId: 'mesmerisingDance', star: 'Eldril Sidewinder', upstreamSkill: 'Mesmerising Dance',
    surfacing: 'generic', rail: 'special-action', electionKind: 'none',
    wireCommands: [C.CLIENT_GAZE, C.CLIENT_USE_RE_ROLL],
    evidence: 'Gaze rail plus generic reroll source.',
  },
  {
    ruleId: 'balefulHex', star: 'Estelle la Veneaux', upstreamSkill: 'Baleful Hex',
    surfacing: 'explicit', rail: 'special-action', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL, C.CLIENT_PLAYER_CHOICE],
    evidence: 'S4 registry-mounted use-skill election row → `CLIENT_USE_SKILL`; the bounded `playerChoiceMode:balefulHex` answer rides the generic player-choice surface.',
  },
  {
    ruleId: 'whirlingDervish', star: 'Fungus the Loon', upstreamSkill: 'Whirling Dervish',
    surfacing: 'generic', rail: 'move', electionKind: 'none',
    wireCommands: [C.CLIENT_USE_RE_ROLL],
    evidence: 'Ball & Chain rail and ordinary reroll handling.',
  },
  {
    ruleId: 'frenziedRush', star: 'Glart Smashrip', upstreamSkill: 'Frenzied Rush',
    surfacing: 'explicit', rail: 'blitz', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL, C.CLIENT_BLITZ_TARGET_SELECTED],
    evidence: 'Unified activation election after the exact Blitz declaration echo → `CLIENT_USE_SKILL`; target selection then rides its ordinary sender.',
  },
  {
    ruleId: 'shotToNothing', star: 'Gloriel Summerbloom', upstreamSkill: 'Shot to Nothing',
    // S7 flip: composite SELECT declares. `shotToNothing` / `shotToNothingBomb` rows ride the real
    // passMove / throwBomb declaration and the store pairs the exact CLIENT_USE_SKILL after the ack
    // (SelectLogicModule bb2025:182-201 order: actingPlayer → Shot to Nothing → Treacherous-if-available).
    // The server grants Hail Mary as a temporary enhancement (StepInitSelecting:366-368); the pass/bomb
    // itself rides the existing CLIENT_PASS rail.
    surfacing: 'explicit', rail: 'pass-bomb-ttm', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_ACTING_PLAYER, C.CLIENT_USE_SKILL, C.CLIENT_PASS],
    evidence: 'S7 composite declares — Shot to Nothing (pass) / Shot to Nothing Bomb send the legal passMove/throwBomb declaration then the ack-gated exact `CLIENT_USE_SKILL`; Hail Mary lands as a server enhancement and the throw rides `CLIENT_PASS`.',
  },
  {
    ruleId: 'primalSavagery', star: 'Glotl Stop', upstreamSkill: 'Primal Savagery',
    surfacing: 'generic', rail: 'block', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'Server skill-use election; Animal Savagery uses existing trait dialog.',
  },
  {
    ruleId: 'illCarryYou', star: 'Grak and Crumbleberry', upstreamSkill: "I'll Carry You",
    // S3 flip: named declared-rail elections (pick-up used=true / place-and-end used=false → CLIENT_USE_SKILL),
    // playerChoiceMode:illCarryYou through the generic server-bounded pick, and the placeCarriedPlayer
    // turn-mode square pick sending CLIENT_FIELD_COORDINATE over the server's move squares.
    surfacing: 'explicit', rail: 'special-action', electionKind: 'player-choice',
    wireCommands: [C.CLIENT_USE_SKILL, C.CLIENT_PLAYER_CHOICE, C.CLIENT_FIELD_COORDINATE],
    evidence: 'Named I\'ll Carry You elections on the declared rails, generic playerChoice:illCarryYou pick, and server-square placeCarriedPlayer placement.',
  },
  {
    ruleId: 'goredByTheBull', star: 'Grashnak Blackhoof', upstreamSkill: 'Gored By The Bull',
    surfacing: 'explicit', rail: 'block', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL, C.CLIENT_BLOCK],
    evidence: 'Star S5: blitz block-commit chooser card (store holdBlitzBlockChoice) offers Gored when goredByTheBullAvailable mirrors BlockLogicExtension.isGoredAvailable (SELECTED target, unused skill, decorated 1/2-die — 3 only vs unused canMoveBeforeBeingBlocked — adjacent); accept sends CLIENT_USE_SKILL then plain CLIENT_BLOCK (BlockKindLogicModule GORED_BY_THE_BULL pair; bb2025 StepInitBlocking:146-158 commits off the USE_SKILL).',
  },
  {
    ruleId: 'incorporeal', star: 'Gretchen Wächter', upstreamSkill: 'Incorporeal',
    surfacing: 'explicit', rail: 'move', electionKind: 'toggle',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'S9 rail-local true/false `CLIENT_USE_SKILL` toggle; active = received `Incorporeal` enhancement source (`ffb-common/.../bb2025/special/Incorporeal.java` `postConstruct`; `ffb-client-logic/.../LogicModule.java` `isIncorporealAvailable`; `ffb-server/.../StepInitSelecting.java` `handleCommand`).',
  },
  {
    ruleId: 'consummateProfessional', star: 'Griff Oberwald', upstreamSkill: null,
    surfacing: 'upstream-gap', rail: 'reroll-handler', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'Upstream still has only the BB2020 once-per-game single-die reroll class and emits no BB2025 +1-to-an-Agility-Test offer.',
  },
  {
    ruleId: 'slayer', star: 'Grim Ironjaw', upstreamSkill: 'Slayer',
    surfacing: 'generic', rail: 'block', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'Multiple Block/base block plus generic post-roll modifier choice.',
  },
  {
    ruleId: 'wisdomOfTheWhiteDwarf', star: 'Grombrindal', upstreamSkill: 'Wisdom of the White Dwarf',
    surfacing: 'explicit', rail: 'special-action', electionKind: 'player-choice',
    wireCommands: [C.CLIENT_ACTING_PLAYER, C.CLIENT_USE_TEAM_MATES_WISDOM],
    evidence: 'Named election, setup target, skill choice and temporary-skill projection.',
  },
  {
    ruleId: 'quickBite', star: 'Guffle Pusmaw', upstreamSkill: 'Quick Bite',
    // S2: split from Bloodlust (the bite card is `feed`). Multi-attacker `playerChoiceMode:quickBite`
    // now rides the generic server-bounded pick rail; single-attacker rides the generic skill-use election.
    surfacing: 'generic', rail: 'special-action', electionKind: 'player-choice',
    wireCommands: [C.CLIENT_USE_SKILL, C.CLIENT_PLAYER_CHOICE],
    evidence: 'Multi-attacker `playerChoiceMode:quickBite` takes the generic pick rail — offered IDs are the eligible attackers, verbatim; one pick or [] refuses (`CLIENT_PLAYER_CHOICE`). Single-attacker rides the generic skill-use election.',
  },
  {
    ruleId: 'treacherous', star: 'Hakflem Skuttlespike', upstreamSkill: 'Treacherous',
    // S7 flip: two seams, one skill. (1) Fresh-declare widening: Pass/Hand-off/Punt become
    // declarable off `treacherousAvailable` (LogicModule isPass/isPunt/isHandOverActionAvailable
    // treacherousAvailable limbs :375-405); owner sequencing routes the skill through the same explicit
    // post-ack election instead of the upstream auto-answer. (2) Context/reconnect: the registry-mounted election;
    // owner sequencing retains a guarded PASS/PUNT row even though upstream historically omitted those context
    // rows because it auto-answered them. Stab, ball move and injury are server-owned (StepTreacherous).
    surfacing: 'explicit', rail: 'pass-bomb-ttm', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_ACTING_PLAYER, C.CLIENT_USE_SKILL],
    evidence: 'S7 — widened Pass/Hand-off/Punt declarations and every other mapped parent action use the owner-required exact-ack election before `CLIENT_USE_SKILL`; the stab and ball transfer are server-owned.',
  },
  {
    ruleId: 'oldPro', star: 'Helmut Wulf', upstreamSkill: 'Old Pro',
    surfacing: 'generic', rail: 'block', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL, C.CLIENT_USE_RE_ROLL],
    evidence: 'Chainsaw rail plus generic reroll/skill-use handling; Old Pro report is formatted.',
  },
  {
    ruleId: 'unstoppableMomentum', star: "H'thark the Unstoppable", upstreamSkill: 'Unstoppable Momentum',
    surfacing: 'generic', rail: 'reroll-handler', electionKind: 'none',
    wireCommands: [C.CLIENT_USE_SINGLE_BLOCK_DIE_RE_ROLL],
    evidence: 'Single Block Die source on the block reroll surface.',
  },
  {
    ruleId: 'dwarvenScourge', star: 'Ivan “the Animal” Deathshroud', upstreamSkill: 'Dwarven Scourge',
    surfacing: 'generic', rail: 'passive', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'Injury modification is server-owned and standard modifier dialogs are supported.',
  },
  {
    ruleId: 'raidingParty', star: 'Ivar Eriksson', upstreamSkill: 'Raiding Party',
    surfacing: 'explicit', rail: 'special-action', electionKind: 'player-choice',
    wireCommands: [C.CLIENT_ACTING_PLAYER, C.CLIENT_PLAYER_CHOICE, C.CLIENT_FIELD_COORDINATE],
    evidence: 'Named election and server-square/player placement flow.',
  },
  {
    ruleId: 'theFlashingBlade', star: 'Jeremiah Kool', upstreamSkill: 'The Flashing Blade',
    surfacing: 'explicit', rail: 'block', electionKind: 'none',
    wireCommands: [C.CLIENT_ACTING_PLAYER, C.CLIENT_BLOCK],
    evidence: 'Named declaration, flagged Stab, then the server-owned Move continuation.',
  },
  {
    ruleId: 'swiftAsTheBreeze', star: 'Jordell Freshbreeze', upstreamSkill: 'Swift As The Breeze',
    surfacing: 'generic', rail: 'move', electionKind: 'none',
    wireCommands: [C.CLIENT_MOVE],
    evidence: 'Movement rail plus generic server roll/reaction handling.',
  },
  {
    ruleId: 'dwarfenGrit', star: 'Josef Bugman', upstreamSkill: 'Dwarfen Grit',
    surfacing: 'generic', rail: 'reroll-handler', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'Optional post-roll Armour reroll through the generic skill-use election (`SkillUse.RE_ROLL_ARMOUR`).',
  },
  {
    ruleId: 'indomitable', star: 'Karla von Kill', upstreamSkill: 'Indomitable',
    surfacing: 'generic', rail: 'block', electionKind: 'player-choice',
    wireCommands: [C.CLIENT_USE_SKILL, C.CLIENT_PLAYER_CHOICE],
    evidence: 'Generic `skillUse` for one target and server-bounded player choice for multiple targets.',
  },
  {
    ruleId: 'blackInk', star: 'Kiroth Krakeneye', upstreamSkill: 'Black Ink',
    surfacing: 'explicit', rail: 'blitz', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL, C.CLIENT_BLITZ_TARGET_SELECTED],
    evidence: 'Unified activation election exposes exact `CLIENT_USE_SKILL` after the parent-action echo; target selection remains separate.',
  },
  {
    ruleId: 'illBeBack', star: 'Kreek Rustgouger', upstreamSkill: "I'll be back!",
    surfacing: 'server-owned', rail: 'passive', electionKind: 'none',
    wireCommands: [],
    evidence: 'Removal/return is server-owned; Ball & Chain is supported.',
  },
  {
    ruleId: 'lordOfChaos', star: 'Lord Borak the Despoiler', upstreamSkill: 'Lord of Chaos',
    surfacing: 'generic', rail: 'reroll-handler', electionKind: 'none',
    wireCommands: [C.CLIENT_USE_SINGLE_BLOCK_DIE_RE_ROLL],
    evidence: 'Single Block Die reroll source plus ordinary foul rail.',
  },
  {
    ruleId: 'viciousVines', star: 'Maple Highgrove', upstreamSkill: 'Vicious Vines',
    surfacing: 'explicit', rail: 'block', electionKind: 'none',
    wireCommands: [C.CLIENT_ACTING_PLAYER, C.CLIENT_BLOCK],
    evidence: 'Named action and target routing.',
  },
  {
    ruleId: 'maximumCarnage', star: 'Max Spleenripper', upstreamSkill: 'Maximum Carnage',
    surfacing: 'explicit', rail: 'block', electionKind: 'none',
    wireCommands: [C.CLIENT_ACTING_PLAYER, C.CLIENT_BLOCK, C.CLIENT_END_TURN],
    evidence: 'Server-derived continuation state, notice, second-target routing and decline path.',
  },
  {
    ruleId: 'theBallista', star: "Morg 'n' Thorg", upstreamSkill: 'The Ballista',
    surfacing: 'generic', rail: 'pass-bomb-ttm', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_THROW_TEAM_MATE, C.CLIENT_USE_SKILL, C.CLIENT_USE_RE_ROLL],
    evidence: 'A failed/subpar TTM PA test arrives as reRollProperties with skill=The Ballista. Yes sends CLIENT_USE_SKILL with the exact reRolledAction; No sends CLIENT_USE_RE_ROLL with a null source. The server consumes the once-per-game skill only after Yes.',
  },
  {
    ruleId: 'kickEmWhileTheyReDown', star: 'Nobbla Blackwart', upstreamSkill: "Kick 'em while they're down!",
    surfacing: 'explicit', rail: 'blitz', electionKind: 'none',
    wireCommands: [C.CLIENT_ACTING_PLAYER, C.CLIENT_BLITZ_MOVE, C.CLIENT_BLOCK],
    evidence: 'Star S8: fresh kickEmBlock/kickEmBlitz SELECT declares (kickEm(Block|Blitz)Available mirrors LogicModule.isKickEmAvailable:513-539); the Blitz variant walks on CLIENT_BLITZ_MOVE (KickEmBlitzLogicModule extends BlitzLogicModule); a click on an adjacent prone/stunned opponent commits the chainsaw block — plain CLIENT_BLOCK with usingChainsaw:true (Kick(Em)*LogicModule.playerInteraction → extension.block(…, chainsaw)); End Activation = acting-null.',
  },
  {
    ruleId: 'halflingLuck', star: 'Puggy Baconbreath', upstreamSkill: 'Halfling Luck',
    surfacing: 'generic', rail: 'reroll-handler', electionKind: 'none',
    wireCommands: [C.CLIENT_USE_RE_ROLL],
    evidence: 'Unified reroll-source surface.',
  },
  {
    ruleId: 'toxinConnoisseur', star: 'Rashnak Backstabber', upstreamSkill: 'Toxin Connoisseur',
    surfacing: 'generic', rail: 'block', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'Stab rail plus ordinary injury-modifier choice.',
  },
  {
    ruleId: 'thinkingMansTroll', star: 'Ripper Bolgrot', upstreamSkill: "Thinking Man's Troll",
    surfacing: 'generic', rail: 'pass-bomb-ttm', electionKind: 'none',
    wireCommands: [C.CLIENT_THROW_TEAM_MATE, C.CLIENT_USE_RE_ROLL],
    evidence: 'Throw Team-mate plus unified reroll-source surface.',
  },
  {
    ruleId: 'catchOfTheDay', star: 'Rodney Roachbait', upstreamSkill: 'Catch of the Day',
    surfacing: 'explicit', rail: 'special-action', electionKind: 'none',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'LogicModule offers the unused skill during an activation; StepInitSelecting dispatches the exact CLIENT_USE_SKILL election to StepCatchOfTheDay, which owns usage, roll, reroll, report, and ball transfer.',
  },
  {
    ruleId: 'boundingLeap', star: 'Rowana Forestfoot', upstreamSkill: 'Bounding Leap',
    surfacing: 'explicit', rail: 'move', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'S6: exact `CLIENT_USE_SKILL` election on every upstream Jump-legal movement state (Move family incl. Blitz/Putrid/TTM/KTM, Foul, Hand Over, Pass, Punt, plus the On-the-Ball Pass Block controller), availability via the shared #431 helper.',
  },
  {
    ruleId: 'slashingNails', star: 'Roxanna Darknail', upstreamSkill: 'Slashing Nails',
    surfacing: 'explicit', rail: 'blitz', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL, C.CLIENT_BLITZ_TARGET_SELECTED],
    evidence: 'Unified activation election after the exact Blitz declaration echo → `CLIENT_USE_SKILL`; target selection then remains separate.',
  },
  {
    ruleId: 'ram', star: 'Rumbelow Sheepskin', upstreamSkill: 'Ram',
    surfacing: 'generic', rail: 'block', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'The coach chooses the Armour or Injury modifier through the generic skill-use election.',
  },
  {
    ruleId: 'yoink', star: 'Scrappa Sorehead', upstreamSkill: 'Yoink!',
    surfacing: 'partial', rail: 'passive', electionKind: 'player-choice',
    wireCommands: [C.CLIENT_INTERCEPTOR_CHOICE],
    evidence: 'The interception picker exists, but Modern sends only `interceptorId`. Upstream requires `CLIENT_INTERCEPTOR_CHOICE` to carry the selected `interceptionSkill`.',
  },
  {
    ruleId: 'furyOfTheBloodGod', star: 'Scyla Anfingrimm', upstreamSkill: 'Fury of the Blood God',
    surfacing: 'generic', rail: 'block', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL, C.CLIENT_BLOCK],
    evidence: 'Generic skill-use election after failed Unchannelled Fury, followed by the existing two-block continuation.',
  },
  {
    ruleId: 'masterAssassin', star: 'Skitter Stab-stab', upstreamSkill: 'Master Assassin',
    surfacing: 'generic', rail: 'block', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_ACTING_PLAYER, C.CLIENT_USE_SKILL],
    evidence: 'Existing Stab declaration followed by an optional post-roll Armour reroll through the generic skill-use election (`SkillUse.RE_ROLL_ARMOUR`).',
  },
  {
    ruleId: 'pumpUpTheCrowd', star: 'Skrorg Snowpelt', upstreamSkill: 'Pump Up The Crowd',
    surfacing: 'server-owned', rail: 'reroll-handler', electionKind: 'none',
    wireCommands: [C.CLIENT_USE_RE_ROLL],
    evidence: 'Server grants/consumes the reroll; ordinary reroll UI exposes it.',
  },
  {
    ruleId: 'strongPassingGame', star: 'Skrull Halfheight', upstreamSkill: 'Strong Passing Game',
    surfacing: 'generic', rail: 'pass-bomb-ttm', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_PASS, C.CLIENT_USE_SKILL],
    evidence: 'Existing Pass rail followed by an optional post-pass `modifyingSkill` choice.',
  },
  {
    ruleId: 'furiousOutburst', star: 'Swiftvine Glimmershard', upstreamSkill: 'Furious Outburst',
    surfacing: 'explicit', rail: 'special-action', electionKind: 'field-coordinate',
    wireCommands: [C.CLIENT_ACTING_PLAYER, C.CLIENT_PLAYER_CHOICE, C.CLIENT_FIELD_COORDINATE],
    evidence: 'Star S8: fresh SELECT declare `furiousOutburst` (furiousOutburstAvailable mirrors LogicModule:656-668); target pick rides the generic playerChoiceMode:furiousOutburst card (StepInitFuriousOutburst, declinable ⇒ end); both teleports click SERVER move squares → CLIENT_FIELD_COORDINATE (StepFirst-/SecondMoveFuriousOutburst eligibleSquares); exit = acting-player-null (FuriousOutburstLogicModule END_MOVE).',
  },
  {
    ruleId: 'sneakiestOfTheLot', star: 'The Black Gobbo', upstreamSkill: 'Sneakiest of the Lot',
    surfacing: 'server-owned', rail: 'foul', electionKind: 'none',
    wireCommands: [C.CLIENT_FOUL, C.CLIENT_PASS],
    evidence: 'Bomb and Foul rails exist; server owns the additional-use allowance.',
  },
  {
    ruleId: 'crushingBlow', star: 'The Mighty Zug', upstreamSkill: 'Crushing Blow',
    surfacing: 'generic', rail: 'block', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'Ordinary skill-use modifier choice.',
  },
  {
    ruleId: 'workingInTandem', star: 'The Swift Twins', upstreamSkill: 'Working in Tandem',
    surfacing: 'generic', rail: 'reroll-handler', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SINGLE_BLOCK_DIE_RE_ROLL, C.CLIENT_USE_SKILL],
    evidence: "Lucien uses a block reroll source; Valen's pass modifier is an optional generic choice, while pair enrollment is server-owned.",
  },
  {
    ruleId: 'beerBarrelBash', star: 'Thorsson Stoutmead', upstreamSkill: 'Beer Barrel Bash!',
    surfacing: 'explicit', rail: 'special-action', electionKind: 'field-coordinate',
    wireCommands: [C.CLIENT_ACTING_PLAYER, C.CLIENT_THROW_KEG],
    evidence: 'Named declaration, server-valid target shading, target command and cue.',
  },
  {
    ruleId: 'krumpAndSmash', star: 'Varag Ghoul-Chewer', upstreamSkill: 'Krump and Smash',
    surfacing: 'generic', rail: 'block', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'Optional post-roll Armour reroll through the generic skill-use election (`SkillUse.RE_ROLL_ARMOUR`).',
  },
  {
    ruleId: 'savageMauling', star: 'Wilhelm Chaney', upstreamSkill: 'Savage Mauling',
    surfacing: 'generic', rail: 'block', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL],
    evidence: 'Optional post-roll Injury reroll through the generic skill-use election (`SkillUse.RE_ROLL_INJURY`).',
  },
  {
    ruleId: 'woodlandFury', star: 'Willow Rosebark', upstreamSkill: 'Woodland Fury',
    surfacing: 'generic', rail: 'reroll-handler', electionKind: 'none',
    wireCommands: [C.CLIENT_USE_SINGLE_BLOCK_DIE_RE_ROLL],
    evidence: 'Single Block Die source on the reroll surface.',
  },
  {
    ruleId: 'watchOut', star: 'Withergrasp Doubledrool', upstreamSkill: 'Watch Out!',
    surfacing: 'server-owned', rail: 'passive', electionKind: 'none',
    wireCommands: [],
    evidence: 'Server automatically treats the first qualifying Defender Stumbles as Dodge.',
  },
  {
    ruleId: 'excuseMeAreYouAZoat', star: 'Zolcath the Zoat', upstreamSkill: '"Excuse Me, Are You a Zoat?"',
    surfacing: 'explicit', rail: 'special-action', electionKind: 'use-skill',
    wireCommands: [C.CLIENT_USE_SKILL, C.CLIENT_PLAYER_CHOICE],
    evidence: 'S4 registry-mounted use-skill election row → `CLIENT_USE_SKILL`; the bounded `playerChoiceMode:autoGazeZoat` answer rides the generic player-choice surface.',
  },
  {
    ruleId: 'blastinSolvesEverything', star: 'Zzharg Madeye', upstreamSkill: '"Blastin\' Solves Everything"',
    surfacing: 'explicit', rail: 'special-action', electionKind: 'field-coordinate',
    wireCommands: [C.CLIENT_ACTING_PLAYER, C.CLIENT_USE_SKILL, C.CLIENT_TARGET_SELECTED, C.CLIENT_END_TURN],
    evidence: 'Star S8: fresh SELECT pair-declare — CLIENT_ACTING_PLAYER{thenIStartedBlastin} then CLIENT_USE_SKILL (bb2025 SelectLogicModule:240-244; the USE_SKILL is what StepInitSelecting:389-392 force-dispatches on); the turnMode:thenIStartedBlastin target beat clicks a standing opponent within 3 → CLIENT_TARGET_SELECTED (blastinTargetIds mirrors ThenIStartedBlastinLogicModule.isValidTarget); decline stays CLIENT_END_TURN. Mid-action adds are bb2020/mixed-plugin-only — the bb2025 plugin set carries none, so no declared-rail row exists, matching upstream.',
  },
];

/**
 * BB2025 specials that are registered upstream but are NOT star-player profile rules, so they carry no
 * registry row. Each needs a rationale — this set is what keeps an upstream ADD from silently passing
 * the drift guard: a new special must be claimed by a row or listed here on purpose.
 */
export const NON_STAR_BB2025_SPECIALS: Readonly<Record<string, string>> = {
  "Bugman's XXXXXX": 'Josef Bugman\'s BB2020 rule; his BB2025 profile rule is Dwarfen Grit. KO-recovery reroll, no coach election.',
  'Keen Player': 'Journeyman/roster-eligibility trait (canJoinTeamIfLessThanEleven), not a star profile rule.',
  'Team Captain': 'BB2025 team-captain roster trait (canSaveReRolls/needsToBeSetUp), not a star profile rule.',
};

export const starRuleById = (ruleId: string): StarRuleDescriptor | undefined =>
  STAR_RULE_REGISTRY.find((rule) => rule.ruleId === ruleId);

export const starRulesByRail = (rail: StarRail): readonly StarRuleDescriptor[] =>
  STAR_RULE_REGISTRY.filter((rule) => rule.rail === rail);

/** Rows S1+ must still flip. */
export const OPEN_SURFACINGS: readonly StarSurfacing[] = ['partial', 'missing', 'upstream-gap'];

// ── S4: the first CoachActionDispatch CONSUMER — the rail-local use-skill election seam ──────────────
//
// A mounted row projects to one CLIENT_USE_SKILL transport: skill is the row's upstreamSkill and
// playerId is acting. Use-skill rows send true; toggle rows supply their received-state boolean.
// The server drives every follow-up (LIME: target/roll; balefulHex/autoGazeZoat: playerChoice).
// A later slice mounts another CLIENT_USE_SKILL row by adding one label entry + its availability predicate
// (availableActions.ts) — never a new sender. The registry stays the single source of skill spelling.

/** A registry row's live use-skill election: everything a view/store needs to offer + commit it. */
export interface StarUseSkillElection {
  readonly ruleId: string;
  /** Byte-exact upstream `Skill.getName()` — the CLIENT_USE_SKILL `skill` payload (Zoat keeps its quotes). */
  readonly skill: string;
  /** Menu row copy (display form — no wire quotes). */
  readonly label: string;
}

/** Rows whose CLIENT_USE_SKILL election is MOUNTED (S4+). Adding an entry here without landing
 *  the row flip + tests fails review (star-program-s0-registry.md §"How S1+ slices flip rows"). */
const MOUNTED_USE_SKILL_LABELS: Readonly<Record<string, string>> = {
  lookIntoMyEyes: 'Look Into My Eyes',
  balefulHex: 'Baleful Hex',
  excuseMeAreYouAZoat: 'Excuse Me, Are You a Zoat?',
  treacherous: 'Treacherous', // S7 mid-rail election (MoveLogicModule:138-143 + the bespoke modules)
  incorporeal: 'Incorporeal', // S9 true/false toggle (MoveLogicPlugin.performAvailableAction)
};

export const MOUNTED_USE_SKILL_RULE_IDS: readonly string[] = Object.keys(MOUNTED_USE_SKILL_LABELS);

/** A mounted CLIENT_USE_SKILL transport; `toggle` rows supply their received-state boolean at dispatch. */
export function starUseSkillElection(ruleId: string): StarUseSkillElection | null {
  const label = MOUNTED_USE_SKILL_LABELS[ruleId];
  if (!label) return null;
  const row = starRuleById(ruleId);
  if (!row || (row.electionKind !== 'use-skill' && row.electionKind !== 'toggle') || !row.upstreamSkill) return null;
  return { ruleId, skill: row.upstreamSkill, label };
}
