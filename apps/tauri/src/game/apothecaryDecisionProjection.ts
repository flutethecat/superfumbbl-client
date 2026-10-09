import type { TeamSide } from './teamSide';
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { apothecaryNoneLabel, apothecaryTypeOptions, parseApothecaryOffer, type ApothecaryOffer } from './logic/apothecaryOffer';
import { playerName } from './reportFormatter';
import { playerStateBase } from './logic/apothecaryOffer';
import { casualtyRollFor, casualtyRollBase, casualtyRollLabel, type CasualtyRollProjection } from './casualtyRollProjection';
import { casualtyTierLabel } from './injuryOutcomeProjection';

const COARSE_INJURY_LABELS: Record<number, string> = { 4: 'STUNNED', 5: 'KNOCKED OUT', 6: 'BADLY HURT', 7: 'SERIOUS INJURY', 8: 'DEAD' };

function seriousInjuryName(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'name' in value) return String((value as { name: unknown }).name ?? '');
  return '';
}

/** One side of the `apothecaryChoice` dialog as a label. The dialog's own playerState + seriousInjury are the
 *  authority (owner 10-09): the raw D16 is NOT, because the server adds casualty modifiers to it and downgrades an
 *  irreducible Lasting Injury to Seriously Hurt (bb2025 RollMechanic.interpretCasualtyRollAndAddModifiers / mapSIRoll),
 *  so a raw 13 can be "Seriously Hurt". A Lasting Injury carries its stat, else two of them read identically. The raw
 *  roll only labels a base-7 side whose injury string is absent or unrecognised. */
function apothecarySideLabel(base: number, serious: unknown, raw: number | null, rawMatchesBase: boolean): string {
  const name = seriousInjuryName(serious);
  const tier = base === 6 || base === 8 || (base === 7 && name) ? casualtyTierLabel(name, base) : null;
  if (tier && !(base === 7 && tier.tier === 'BADLY_HURT')) {
    return (tier.stat ? `${tier.label} (${tier.stat})` : tier.label).toUpperCase();
  }
  return rawMatchesBase && raw !== null ? casualtyRollLabel(raw) : COARSE_INJURY_LABELS[base] ?? 'INJURY';
}

export function buildApothecaryResult(game: GameJson, dialog: Record<string, unknown>, rolls: CasualtyRollProjection) {
  const playerId = String(dialog.playerId ?? '');
  const entry = casualtyRollFor(rolls, playerId);
  const oldBase = playerStateBase(dialog.playerStateOld) ?? 0;
  const newBase = playerStateBase(dialog.playerStateNew) ?? 0;
  const oldRaw = entry?.oldRoll ?? null;
  const newRaw = entry?.newRoll ?? null;
  const oldOk = oldRaw !== null && casualtyRollBase(oldRaw) === oldBase;
  const newOk = newRaw !== null && casualtyRollBase(newRaw) === newBase;
  const data = game.fieldModel.playerDataArray.find((p) => p.playerId === playerId);
  const side: TeamSide = game.teamHome.playerArray.some((p) => p.playerId === playerId) ? 'home' : 'away';
  return {
    playerId, player: playerName(game, playerId), side,
    square: data?.playerCoordinate && data.playerCoordinate[0] >= 0 ? [...data.playerCoordinate] as [number, number] : null,
    oldInjury: apothecarySideLabel(oldBase, dialog.seriousInjuryOld, oldRaw, oldOk),
    newInjury: apothecarySideLabel(newBase, dialog.seriousInjuryNew, newRaw, newOk),
    oldRoll: oldOk ? oldRaw : null, newRoll: newOk ? newRaw : null,
  };
}
export type ApothecaryResultProjection = ReturnType<typeof buildApothecaryResult>;

export function buildApothecaryDecision(g: GameJson, prompt: ApothecaryOffer) {
  const firstInjuredId = prompt.injuries[0]?.playerId;
  const decidingTeam = prompt.teamId != null
    ? (prompt.teamId === g.teamAway.teamId ? g.teamAway : g.teamHome)
    : (g.teamAway.playerArray.some((player) => player.playerId === firstInjuredId) ? g.teamAway : g.teamHome);
  const injuries = prompt.injuries.map((offer, index) => {
    const data = g.fieldModel.playerDataArray.find((player) => player.playerId === offer.playerId);
    const side: TeamSide = g.teamHome.playerArray.some((player) => player.playerId === offer.playerId)
      ? 'home' : 'away';
    return {
      index,
      playerId: offer.playerId,
      player: playerName(g, offer.playerId),
      side,
      square: data?.playerCoordinate && data.playerCoordinate[0] >= 0
        ? [data.playerCoordinate[0], data.playerCoordinate[1]] as [number, number]
        : null,
      base: offer.base,
      outcome: offer.outcome,
      injury: offer.injury,
      offeredTypes: [...offer.offeredTypes],
      options: [...apothecaryTypeOptions(offer.offeredTypes, prompt.kind === 'single')],
    };
  });
  const primary = injuries[0]!;
  return {
    kind: prompt.kind,
    // Owner 09-06 (game 943): the single useApothecary dialog carries NO teamId (playerId only) — the deciding team is
    // the INJURED PLAYER's team, else the card named the home coach and sat under the wrong panel.
    teamId: prompt.teamId ?? decidingTeam.teamId,
    ...primary,
    noneLabel: apothecaryNoneLabel(prompt),
    coach: String(decidingTeam.coach ?? ''),
    injuries,
  };
}
export type ApothecaryDecisionProjection = ReturnType<typeof buildApothecaryDecision>;

export function apothecaryDecisionFromModel(game: GameJson): ApothecaryDecisionProjection | null {
  const dialog = game.dialogParameter;
  if (!dialog || !['useApothecary', 'useApothecaries'].includes(String(dialog.dialogId))) return null;
  const bases = Object.fromEntries(game.fieldModel.playerDataArray.map((p) => [p.playerId, p.playerState & 0xff]));
  const offer = parseApothecaryOffer(dialog, bases, (message) => { throw new Error(message); });
  return offer ? buildApothecaryDecision(game, offer) : null;
}
