import { effectiveStat, NetCommandId, type ClientCommandWizardSpell } from '@fumbbl40k/ffb-protocol';
import {
  assertDecisionAuthority,
  type DecisionAuthority,
} from './inducementPurchase';

export type WizardSpell = 'fireball' | 'zap';
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

/**
 * Exact WizardLogicModule legality port. Zap requires an opposing RosterPlayer
 * on the clicked coordinate (lines 123-127). Fireball requires a non-prone,
 * non-stunned opposing player in the radius-one neighborhood including its
 * center (lines 129-143); FieldModel.java:546-561 defines that neighborhood.
 */
export function isWizardTargetLegal(
  spell: WizardSpell,
  coordinate: readonly [number, number],
  opponentPlayers: readonly WizardTargetPlayer[],
): boolean {
  if (!onPitch(coordinate)) return false;
  if (spell === 'zap') {
    return opponentPlayers.some((player) => player.rosterPlayer
      && player.coordinate?.[0] === coordinate[0]
      && player.coordinate[1] === coordinate[1]);
  }
  return opponentPlayers.some((player) => player.coordinate != null
    && onPitch(player.coordinate)
    && isStandingWizardVictim(player)
    && Math.abs(player.coordinate[0] - coordinate[0]) <= 1
    && Math.abs(player.coordinate[1] - coordinate[1]) <= 1);
}

/** FieldCoordinateBounds.java:103-110 enumerates FIELD with x outer/y inner. */
export function wizardTargetSquares(
  spell: WizardSpell,
  opponentPlayers: readonly WizardTargetPlayer[],
): [number, number][] {
  const result: [number, number][] = [];
  for (let x = 0; x <= 25; x += 1) {
    for (let y = 0; y <= 14; y += 1) {
      if (isWizardTargetLegal(spell, [x, y], opponentPlayers)) result.push([x, y]);
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
): [number, number][] {
  if (!onPitch(coordinate)) return [];
  return players.flatMap((player): [number, number][] => {
    const square = player.coordinate;
    if (!square || !onPitch(square) || !isStandingWizardVictim(player)) return [];
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
    opponentPlayers: readonly WizardTargetPlayer[];
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
  if (!isWizardTargetLegal(choice.spell, choice.coordinate, choice.opponentPlayers)) {
    throw new Error('illegal wizard target');
  }
  return {
    netCommandId: NetCommandId.CLIENT_WIZARD_SPELL,
    wizardSpell: choice.spell,
    targetCoordinate: [choice.coordinate[0], choice.coordinate[1]],
  };
}
