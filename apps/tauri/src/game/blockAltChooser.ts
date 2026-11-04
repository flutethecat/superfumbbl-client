/**
 * Owner 11-03 (option A): the "Stab or Block?" chooser that asks before every block while the attacker has a block
 * alternative (store state.blitzBlockChoice, origin 'blitz' or 'block'). Pure presentation helpers for its card:
 * the title, and the block-dice preview drawn above the Block button.
 *
 * The dice preview is server-derived only: it reads the dice decoration the server put on the target's square
 * (FieldModel.diceDecoration, ServerUtilBlock.updateDiceDecorations — the same source the on-pitch dice dots draw
 * verbatim). nrOfDice is signed: a negative count means the DEFENDER chooses the die (uphill). No decoration, or a
 * count outside 1..3, means no preview: the row is left out rather than guessed.
 */
import type { GameJson } from '@fumbbl40k/ffb-protocol';

export interface BlockChoiceDicePreview {
  /** Number of block dice the Block would roll (1-3). */
  dice: number;
  /** true = the attacker picks the die; false = the defender picks (uphill). */
  attackerChooses: boolean;
}

/** The block dice a plain Block on `targetId` would roll, from the server's decoration on the target square. */
export function blockChoiceDicePreview(game: GameJson | null | undefined, targetId: string): BlockChoiceDicePreview | null {
  if (!game || !targetId) return null;
  const data = (game.fieldModel?.playerDataArray ?? []).find((d) => d.playerId === targetId) as { playerCoordinate?: unknown } | undefined;
  const at = data?.playerCoordinate;
  if (!Array.isArray(at) || at.length < 2) return null;
  const decorations = ((game.fieldModel as { diceDecorationArray?: unknown[] } | undefined)?.diceDecorationArray ?? []) as { coordinate?: unknown; nrOfDice?: unknown }[];
  const decoration = decorations.find((d) => Array.isArray(d?.coordinate)
    && Number((d.coordinate as unknown[])[0]) === Number(at[0]) && Number((d.coordinate as unknown[])[1]) === Number(at[1]));
  if (!decoration) return null;
  const signed = Number(decoration.nrOfDice);
  if (!Number.isInteger(signed) || signed === 0 || Math.abs(signed) > 3) return null;
  return { dice: Math.abs(signed), attackerChooses: signed > 0 };
}

/** The card title: "<Alternative> or Block?" for exactly one alternative, else the generic "Choose the … attack". */
export function blockChoiceTitle(offers: readonly { kind: string; label: string }[], origin: 'blitz' | 'block'):
  { key: 'hud.blockAltModal.p0OrBlock'; params: { p0: string } } | { key: 'hud.blockAltModal.chooseTheP0Attack'; params: { p0: string } } {
  if (offers.length === 1) return { key: 'hud.blockAltModal.p0OrBlock', params: { p0: offers[0]!.label } };
  return { key: 'hud.blockAltModal.chooseTheP0Attack', params: { p0: origin === 'blitz' ? 'blitz' : 'block' } };
}
