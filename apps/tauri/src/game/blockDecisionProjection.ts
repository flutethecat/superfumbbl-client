import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { playerById, valuedSkillLabel } from './reRollDecisionProjection';

export interface BlockContextProjection {
  attackerId: string | null;
  defenderId: string | null;
  defenderSquare: [number, number] | null;
  chosenDice: number[] | null;
  rollOccurrence: number;
}
export const createBlockContext = (): BlockContextProjection => ({ attackerId: null, defenderId: null, defenderSquare: null, chosenDice: null, rollOccurrence: 0 });
export function reduceBlockContext(previous: BlockContextProjection, game: GameJson, reports: readonly Record<string, unknown>[], coordinates: ReadonlyMap<string, readonly number[] | null>): BlockContextProjection {
  const next = { ...previous };
  const block = reports.find((r) => r.reportId === 'block');
  if (block) {
    next.attackerId = String(block.playerId ?? block.attackerId ?? game.actingPlayer?.playerId ?? '') || next.attackerId;
    next.defenderId = String(block.defenderId ?? '') || next.defenderId;
    next.chosenDice = null;
    next.defenderSquare = null; // a new block starts clean: the square is re-read at its roll (09-14 review-path anchor)
  }
  const roll = reports.find((r) => r.reportId === 'blockRoll');
  const choice = reports.find((r) => r.reportId === 'blockChoice');
  if (roll || reports.some((r) => r.reportId === 'blockReRoll')) next.rollOccurrence++;
  if (roll || choice) {
    next.defenderId = String(roll?.defenderId ?? choice?.defenderId ?? next.defenderId ?? '') || next.defenderId;
    const square = next.defenderId ? coordinates.get(next.defenderId) : null;
    if (square && square[0]! >= 0 && square[0]! < 26 && square[1]! >= 0 && square[1]! < 15) next.defenderSquare = [square[0]!, square[1]!];
  }
  if (choice && Array.isArray(choice.blockRoll) && Number.isInteger(choice.diceIndex)) {
    const die = choice.blockRoll[Number(choice.diceIndex)];
    next.chosenDice = typeof die === 'number' ? [die] : null;
  }
  return next;
}

export function buildBlockDecision(game: GameJson | null, dp: Record<string, unknown>, readOnly: boolean) {
  const rr = readOnly ? [] : (Array.isArray(dp.reRollProperties) ? (dp.reRollProperties as unknown[]).map(String) : []);
  // Uphill phase one offers attacker rerolls; enable die commit only for the current chooser or when rerolls are exhausted.
  const nrOfDice = Number(dp.nrOfDice ?? 0);
  // Derive Pro/Brawler/Consummate from reRollActionToSourceMap; legacy booleans are fallback only.
  const a2s = (dp.reRollActionToSourceMap && typeof dp.reRollActionToSourceMap === 'object')
    ? (dp.reRollActionToSourceMap as Record<string, unknown>) : {};
  const srcTeam = rr.includes('TRR') || rr.includes('MASCOT') || !!dp.teamReRollOption;
  const srcPro = rr.includes('PRO') || !!a2s['Single Die Per Activation'] || !!dp.proReRollOption;
  const srcBrawler = !!a2s['Single BothDown'] || !!dp.brawlerOption;
  const srcConsummate = !!a2s['Single Die'] || !!dp.consummateOption;
  const consummateSrc = typeof a2s['Single Die'] === 'string' ? String(a2s['Single Die']) : (dp.consummateOption ? 'Consummate Professional' : null);
  const singleBlockDieSrc = typeof a2s['Single Block Die'] === 'string' ? String(a2s['Single Block Die']) : null;
  const multiBlockDiceSrc = typeof a2s['Multi Block Dice'] === 'string' ? String(a2s['Multi Block Dice']) : null;
  // Hatred: reRollActionToSourceMap['Single Skull']='Hatred' (upstream Hatred.java; g483 captured frame).
  const singleSkullSrc = typeof a2s['Single Skull'] === 'string' ? String(a2s['Single Skull']) : null;
  const actingId = String(dp.playerId ?? (game?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  const actingSkillValues = playerById(game, actingId)?.skillDisplayValuesMap;
  const hasAnyReroll = srcTeam || srcPro || srcBrawler || srcConsummate || !!singleBlockDieSrc || !!multiBlockDiceSrc || !!singleSkullSrc;
  return {
    dice: Array.isArray(dp.blockRoll) ? (dp.blockRoll as unknown[]).map(Number) : [],
    nrOfDice,
    // readOnly (non-chooser #5): FORCE pickable off — the `nrOfDice>0` shortcut would otherwise make a downhill watcher pickable. The chooser path is unchanged.
    pickable: readOnly ? false : (nrOfDice > 0 || !hasAnyReroll),
    // #38: phase-1 of the uphill two-phase — I'm the defender-VIEW (readOnly), it's uphill (nrOfDice<0), and the
    // attacker still has a re-roll to decide (hasAnyReroll). Flips false at the phase-2 flip / downhill / no re-roll.
    opponentRerollPending: readOnly && nrOfDice < 0 && hasAnyReroll,
    chooserTeamRerollAvailable: readOnly && srcTeam, // owner 09-07: watcher-side cue only (never a button)
    // TRR / MASCOT both re-roll the whole block via CLIENT_USE_RE_ROLL (proven live);
    // LONER just gates TRR with a roll the server applies, so it still shows the button.
    // readOnly: suppress EVERY reroll source (they belong to the chooser — the `dp.*Option` flags read below
    // are the chooser's; showing them to the non-chooser would let the wrong coach spend a re-roll).
    teamRR: !readOnly && srcTeam,
    // Keep Mascot distinct from TRR and suppress plain TRR when Mascot is available.
    mascot: !readOnly && rr.includes('MASCOT'),
    mascotTrr: !readOnly && rr.includes('MASCOT') && rr.includes('TRR'),
    pro: !readOnly && srcPro,
    brawler: !readOnly && srcBrawler,
    consummate: !readOnly && srcConsummate,
    consummateLabel: readOnly ? null : (consummateSrc ? valuedSkillLabel(consummateSrc, actingSkillValues) : null),
    singleBlockDie: readOnly ? null : singleBlockDieSrc,
    singleBlockDieLabel: readOnly ? null : (singleBlockDieSrc ? valuedSkillLabel(singleBlockDieSrc, actingSkillValues) : null),
    multiBlockDice: readOnly ? null : multiBlockDiceSrc,
    multiBlockDiceLabel: readOnly ? null : (multiBlockDiceSrc ? valuedSkillLabel(multiBlockDiceSrc, actingSkillValues) : null),
    singleSkull: readOnly ? null : singleSkullSrc,
    singleSkullLabel: readOnly ? null : (singleSkullSrc ? valuedSkillLabel(singleSkullSrc, actingSkillValues) : null),
  };
}
export type BlockDecisionProjection = ReturnType<typeof buildBlockDecision>;
