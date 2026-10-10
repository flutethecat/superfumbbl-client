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

/** ffb-common PlayerState._BIT_USED_PRO (PlayerState.java:37). The bb2025 server sets it whenever it rolls for Pro,
 *  whatever the source and outcome (RollMechanic.useReRoll:319-322), sends it as fieldModelSetPlayerState ahead of
 *  the re-presented dialog in the same sync (live g1920044: state change index 0, dialog index 3), refuses any
 *  further Pro while it is set (:319-320) and clears it at the team's next turn (UtilPlayer.refreshPlayersForTurnStart
 *  :420-425). */
export const PLAYER_STATE_USED_PRO = 0x02000;
/** True when the server's own state says this player's Pro is spent. The block dialogs can still LIST Pro after a
 *  Pro-with-fallback whose fallback ran: those branches return before the skill is marked used (RollMechanic
 *  :343-360 vs :374-380) and the dialog's source map reads the skill bookkeeping (UtilCards.getUnusedRerollSource
 *  :160). Answering such an offer rerolls nothing and costs the roll its remaining rerolls. Used only to HIDE. */
export function playerProSpent(game: GameJson | null | undefined, playerId: string): boolean {
  const state = Number(game?.fieldModel?.playerDataArray?.find((data) => data.playerId === playerId)?.playerState);
  return Number.isInteger(state) && (state & PLAYER_STATE_USED_PRO) !== 0;
}

/** Upstream ReRollSources names of the Pro-with-fallback block sources (ffb-common ReRollSources.java:39-41). */
export const BLOCK_PRO_COMPOSITES = [
  { kind: 'proTrr', source: 'Pro TRR', label: 'Pro + RR', title: 'Pro, then a Team Reroll of the Pro roll if it fails' },
  { kind: 'proMascot', source: 'Pro Mascot', label: 'Pro + Mascot', title: 'Pro, then the Team Mascot if the Pro roll fails (no Team Reroll)' },
  { kind: 'proMascotTrr', source: 'Pro Mascot TRR', label: 'Pro + Mascot + RR', title: 'Pro, then the Team Mascot, then a Team Reroll if both fail' },
] as const;
export type BlockProCompositeOption = (typeof BLOCK_PRO_COMPOSITES)[number];
export type BlockProCompositeKind = BlockProCompositeOption['kind'];

/** Owner 10-10: the "Pro, then Team Reroll" answers of a BLOCK dialog, offered as upstream's own client offers them
 *  (DialogBlockRollProperties.proMascotPanelSingle:271-296 / determineProReRollSource:760-773, and the per-target
 *  DialogReRollBlockForTargetsProperties:208-236, 338-352). `roll` is the dialog parameter (single block) or one
 *  `blockRolls[]` entry (multiple block). The rule is NOT the action-dice one (proCompositeReRollOptions):
 *   - Pro comes from reRollActionToSourceMap['Single Die Per Activation'], never from a PRO reroll property;
 *   - the fallback needs the TRR property itself (the server spends a team reroll without re-checking,
 *     bb2025 RollMechanic.useReRoll:354-355), so LONER / Brilliant Coaching alone never offer it;
 *   - with a usable Team Mascot (MASCOT and no Brilliant Coaching / Pump up the Crowd / Star of the Show, upstream
 *     DialogExtensionMascot.teamReRollSource) the fallbacks are Mascot and Mascot-then-TRR; plain Pro TRR is not
 *     reachable there (the TRR box is disabled until Mascot is ticked). In the multiple-block dialog's one-die
 *     panel that box is never enabled (its Mascot box has no listener, :223-233), so upstream cannot send
 *     Pro Mascot TRR from there and neither do we.
 *  ONE-DIE rolls only. Upstream also shows the boxes on 2 and 3 dice, but its answer for a composite source carries
 *  no usable die index (single block: sendUseReRoll(BLOCK, source), DialogBlockRollPropertiesHandler:108) and the
 *  server then rerolls EVERY die (bb2025 StepBlockRoll:242-278 and StepBlockRollMultiple.roll:401-424 test
 *  `== ReRollSources.PRO` by identity, so a composite falls to the whole-roll branch). A die-select that rerolls
 *  the whole roll is not offered; on one die the two are the same reroll. */
export function blockProCompositeOptions(dialogId: unknown, roll: Record<string, unknown>): BlockProCompositeOption[] {
  if (dialogId !== 'blockRollProperties' && dialogId !== 'reRollBlockForTargetsProperties') return [];
  const a2s = (roll.reRollActionToSourceMap && typeof roll.reRollActionToSourceMap === 'object')
    ? (roll.reRollActionToSourceMap as Record<string, unknown>) : {};
  if (a2s['Single Die Per Activation'] !== 'Pro' || Number(roll.nrOfDice) !== 1) return [];
  const rr = Array.isArray(roll.reRollProperties) ? (roll.reRollProperties as unknown[]).map(String) : [];
  const trr = rr.includes('TRR');
  const mascot = rr.includes('MASCOT') && !['BRILLIANT_COACHING', 'PUMP_UP_THE_CROWD', 'SHOW_STAR'].some((p) => rr.includes(p));
  const sources = mascot
    ? (trr && dialogId === 'blockRollProperties' ? ['Pro Mascot', 'Pro Mascot TRR'] : ['Pro Mascot'])
    : trr ? ['Pro TRR'] : [];
  return BLOCK_PRO_COMPOSITES.filter((option) => sources.includes(option.source));
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
