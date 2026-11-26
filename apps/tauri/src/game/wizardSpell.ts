import { effectiveStat, NetCommandId, type ClientCommandWizardSpell } from '@fumbbl40k/ffb-protocol';
import {
  assertDecisionAuthority,
  type DecisionAuthority,
} from './inducementPurchase';

export type WizardSpell = 'fireball' | 'zap';
/**
 * Which upstream WizardLogicModule the target rule follows. `legacy` = client/state/logic/mixed/WizardLogicModule
 * (Zap: an opposing RosterPlayer; Fireball: a standing opponent in the 3x3), the rule every server up to 3.3.1 runs.
 * `bb2025` = FFB 3.4.0 client/state/logic/bb2025/WizardLogicModule (Zap: any RosterPlayer of either team; Fireball:
 * any player in any state in the 3x3), served by bb2025/StepWizard. Chosen by `wizardTargetRuleFor`.
 */
export type WizardTargetRule = 'legacy' | 'bb2025';
export type WizardSpellChoice = { kind: 'spell'; spell: WizardSpell } | { kind: 'cancel' };

export interface WizardInducementWire {
  inducementType?: unknown;
  value?: unknown;
  uses?: unknown;
}

export interface WizardSpellOffer {
  commandNr: number;
  teamId: string;
  enabledSpells: readonly WizardSpell[];
  authority: DecisionAuthority;
}

export interface WizardSpellSnapshot {
  commandNr: number;
  turnMode: unknown;
  dialogId: unknown;
  dialogTeamId: unknown;
  myTeamId: string | null | undefined;
  inducements: readonly WizardInducementWire[];
}

export interface WizardTargetPlayer {
  playerId: string;
  coordinate: readonly [number, number] | null;
  playerState: number;
  /** WizardLogicModule's Zap rule requires `instanceof RosterPlayer`. */
  rosterPlayer: boolean;
  /** The casting coach's own player. The legacy rule never targets these; the bb2025 rule may (friendly fire). */
  ownTeam?: boolean;
  /** Base + temporary ST facts carried by PlayerJson; Zap's server target is getStrengthWithModifiers(). */
  strength?: number;
  temporaryModifiersMap?: Record<string, unknown>;
}

export type WizardSpellCommand = ClientCommandWizardSpell & Record<string, unknown>;

/**
 * DialogWizardSpell.java:151-158 enables effects only when a SPELL-use
 * inducement has uses left. Inducement.java:71-72 defines uses-left as
 * max(0, value - uses), and the common wizard's effects are exactly FIREBALL
 * and ZAP (InducementCollection.java:38-56).
 */
export function enabledWizardSpells(inducements: readonly WizardInducementWire[]): WizardSpell[] {
  const wizard = inducements.find((row) => row.inducementType === 'wizard');
  const value = Number(wizard?.value);
  const uses = Number(wizard?.uses);
  return Number.isInteger(value) && Number.isInteger(uses) && value - uses > 0
    ? ['fireball', 'zap']
    : [];
}

/** DialogWizardSpell.java:46-70 presents each enabled spell and Cancel. */
export function wizardSpellChoices(offer: WizardSpellOffer): WizardSpellChoice[] {
  return [
    ...offer.enabledSpells.map((spell) => ({ kind: 'spell' as const, spell })),
    { kind: 'cancel' as const },
  ];
}

/** A parking-dialog instance is identified by the command that opened it. */
export function wizardSpellKey(commandNr: number): string {
  if (!Number.isInteger(commandNr) || commandNr < 0) throw new Error('invalid wizard-spell command number');
  return `wizardSpell:${commandNr}`;
}

function onPitch(coordinate: readonly [number, number]): boolean {
  // FieldCoordinateBounds.java:14-15 defines FIELD as inclusive (0,0)..(25,14).
  return Number.isInteger(coordinate[0]) && Number.isInteger(coordinate[1])
    && coordinate[0] >= 0 && coordinate[0] <= 25
    && coordinate[1] >= 0 && coordinate[1] <= 14;
}

function isStandingWizardVictim(player: WizardTargetPlayer): boolean {
  // PlayerState.java:12-13 are PRONE/STUNNED; WizardLogicModule.java:129-143
  // excludes those two bases from the opponent players making Fireball legal.
  const base = player.playerState & 0xff;
  return base !== 0x03 && base !== 0x04;
}

function inFireballArea(player: WizardTargetPlayer, coordinate: readonly [number, number]): boolean {
  return player.coordinate != null
    && onPitch(player.coordinate)
    && Math.abs(player.coordinate[0] - coordinate[0]) <= 1
    && Math.abs(player.coordinate[1] - coordinate[1]) <= 1;
}

function onSquare(player: WizardTargetPlayer, coordinate: readonly [number, number]): boolean {
  return player.coordinate?.[0] === coordinate[0] && player.coordinate[1] === coordinate[1];
}

/**
 * Exact WizardLogicModule legality port.
 * legacy (mixed/WizardLogicModule): Zap requires an opposing RosterPlayer on the clicked coordinate (lines 123-127).
 * Fireball requires a non-prone, non-stunned opposing player in the radius-one neighborhood including its center
 * (lines 129-143); FieldModel.java:546-561 defines that neighborhood. Own-team players never count.
 * bb2025 (FFB 3.4.0 bb2025/WizardLogicModule isValidZapTarget / fireballAffectsPlayer): Zap = any RosterPlayer on the
 * square, either team; Fireball = any player with a state in the 3x3, either team.
 */
export function isWizardTargetLegal(
  spell: WizardSpell,
  coordinate: readonly [number, number],
  players: readonly WizardTargetPlayer[],
  rule: WizardTargetRule = 'legacy',
): boolean {
  if (!onPitch(coordinate)) return false;
  const eligible = rule === 'bb2025' ? players : players.filter((player) => player.ownTeam !== true);
  if (spell === 'zap') {
    return eligible.some((player) => player.rosterPlayer && onSquare(player, coordinate));
  }
  return eligible.some((player) => inFireballArea(player, coordinate)
    && (rule === 'bb2025' || isStandingWizardVictim(player)));
}

/**
 * The bb2025 friendly-fire case, exactly upstream's: c66198ac4 bb2025 ClientStateWizard.showFriendlyFireConfirmation
 * (:153-163) asks DialogConfirmWizardFriendlyFire ("<Spell> will affect one or more of your own players.") whenever
 * WizardLogicModule.affectsOwnPlayer (:132-142) holds - Zap: an own RosterPlayer on the square; Fireball: ANY own player
 * with a state in the 3x3 (fireballAffectsPlayer(coordinate, ownTeamOnly = true), :117-130). The caster's own players
 * affected, in board order. Always empty under the legacy rule (mixed ClientStateWizard has no such confirmation).
 */
export function wizardOwnPlayersAffected(
  spell: WizardSpell,
  coordinate: readonly [number, number],
  players: readonly WizardTargetPlayer[],
  rule: WizardTargetRule,
): WizardTargetPlayer[] {
  if (rule !== 'bb2025' || !onPitch(coordinate)) return [];
  return spell === 'zap'
    ? players.filter((player) => player.ownTeam === true && player.rosterPlayer && onSquare(player, coordinate))
    : players.filter((player) => player.ownTeam === true && inFireballArea(player, coordinate));
}

/** FieldCoordinateBounds.java:103-110 enumerates FIELD with x outer/y inner. */
export function wizardTargetSquares(
  spell: WizardSpell,
  players: readonly WizardTargetPlayer[],
  rule: WizardTargetRule = 'legacy',
): [number, number][] {
  const result: [number, number][] = [];
  for (let x = 0; x <= 25; x += 1) {
    for (let y = 0; y <= 14; y += 1) {
      if (isWizardTargetLegal(spell, [x, y], players, rule)) result.push([x, y]);
    }
  }
  return result;
}

/**
 * DiceInterpreter.isSpecialEffectSuccesful(ZAP) succeeds on a natural 6 or a non-1 roll at least equal to
 * targetPlayer.getStrengthWithModifiers(). Express that exact server predicate as the one displayed D6 target.
 */
export function wizardZapRequiredRoll(player: WizardTargetPlayer): number {
  return Math.max(2, Math.min(6, effectiveStat(player, 'ST')));
}

/** A full rejoin snapshot can be the only frame carrying the parked dialog. */
export function wizardSpellOfferFromSnapshot(snapshot: WizardSpellSnapshot): WizardSpellOffer | null {
  if (snapshot.turnMode !== 'wizard' || snapshot.dialogId !== 'wizardSpell') return null;
  const teamId = String(snapshot.dialogTeamId ?? '');
  if (!snapshot.myTeamId || teamId !== snapshot.myTeamId) return null;
  return {
    commandNr: snapshot.commandNr,
    teamId,
    enabledSpells: enabledWizardSpells(snapshot.inducements),
    authority: { role: 'player', myTeamId: snapshot.myTeamId, decisionTeamId: teamId },
  };
}

/** Display-only Fireball victims; StepWizard rolls and resolves the effect. */
export function fireballPreviewSquares(
  coordinate: readonly [number, number],
  players: readonly WizardTargetPlayer[],
  rule: WizardTargetRule = 'legacy',
): [number, number][] {
  if (!onPitch(coordinate)) return [];
  return players.flatMap((player): [number, number][] => {
    const square = player.coordinate;
    // bb2025/StepWizard adds every player in the 3x3 to the affected list, whatever its state.
    if (!square || !onPitch(square) || (rule !== 'bb2025' && !isStandingWizardVictim(player))) return [];
    if (Math.abs(square[0] - coordinate[0]) > 1 || Math.abs(square[1] - coordinate[1]) > 1) return [];
    return [[square[0], square[1]]];
  });
}

/**
 * ClientCommandWizardSpell.toJsonValue() writes wizardSpell then
 * targetCoordinate (ClientCommandWizardSpell.java:48-52). JsonFieldCoordinateOption
 * delegates to UtilJson.java:56-63, which writes [x,y]. Dialog cancellation sends
 * both values null (DialogWizardSpellHandler.java:36-44).
 */
export function buildWizardSpellCommand(
  offer: WizardSpellOffer,
  choice: { kind: 'cancel' } | {
    kind: 'target';
    spell: WizardSpell;
    coordinate: readonly [number, number];
    /** legacy: the opposing players; bb2025: every player of both teams (own ones flagged `ownTeam`). */
    opponentPlayers: readonly WizardTargetPlayer[];
    rule?: WizardTargetRule;
  },
): WizardSpellCommand {
  assertDecisionAuthority(offer.authority, offer.teamId);
  if (choice.kind === 'cancel') {
    return {
      netCommandId: NetCommandId.CLIENT_WIZARD_SPELL,
      wizardSpell: null,
      targetCoordinate: null,
    };
  }
  if (!offer.enabledSpells.includes(choice.spell)) throw new Error('wizard spell was not offered');
  if (!isWizardTargetLegal(choice.spell, choice.coordinate, choice.opponentPlayers, choice.rule ?? 'legacy')) {
    throw new Error('illegal wizard target');
  }
  return {
    netCommandId: NetCommandId.CLIENT_WIZARD_SPELL,
    wizardSpell: choice.spell,
    targetCoordinate: [choice.coordinate[0], choice.coordinate[1]],
  };
}

/** The rulesVersion game option, upper-cased ('' = absent). */
function rulesVersionOption(gameOptions: unknown): string {
  const options = (gameOptions as { gameOptionArray?: { gameOptionId?: unknown; gameOptionValue?: unknown }[] } | null | undefined)
    ?.gameOptionArray;
  const value = Array.isArray(options) ? options.find((option) => option?.gameOptionId === 'rulesVersion')?.gameOptionValue : undefined;
  return String(value ?? '').trim().toUpperCase();
}

/**
 * The target rule for this game: bb2025 only when the announced server carries the 3.4.0 bb2025 StepWizard
 * (`serverVersionGate.serverHasBb2025WizardTargeting`, null flag = never) AND the game is BB2025. An absent rulesVersion
 * option reads as BB2025, the server default (as tentaclesRollHeld / swoopChoiceCopy read it). Anything else = legacy.
 */
export function wizardTargetRuleFor(gameOptions: unknown, serverHasBb2025Targeting: boolean): WizardTargetRule {
  if (!serverHasBb2025Targeting) return 'legacy';
  const version = rulesVersionOption(gameOptions);
  return version === '' || version === 'BB2025' ? 'bb2025' : 'legacy';
}
