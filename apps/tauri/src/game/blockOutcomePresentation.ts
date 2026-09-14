import { playerHasSkill, type GameJson } from '@fumbbl40k/ffb-protocol';
import type { BlockContextProjection } from './blockDecisionProjection';

export type BlockResultSymbol =
  | 'attacker-down'
  | 'both-down'
  | 'push'
  | 'defender-stumbles'
  | 'pow';

export interface BlockResultStamp {
  symbol: BlockResultSymbol;
  playerIds: string[];
}

export interface BlockOutcomePresentation {
  /** Undefined means this event did not resolve a block. Null explicitly retires an older stamp. */
  stamp: BlockResultStamp | null | undefined;
  choiceIndex: number | null;
  dice: number[];
  defenderSquare: [number, number] | null;
  rerolled: boolean;
  dauntlessBeat: boolean;
}

function blockSymbol(result: unknown): BlockResultSymbol | null {
  const normalized = String(result ?? '').toUpperCase();
  if (normalized.includes('SKULL')) return 'attacker-down';
  if (normalized.includes('BOTH')) return 'both-down';
  if (normalized.includes('POW') && normalized.includes('PUSH')) return 'defender-stumbles';
  if (normalized.includes('POW')) return 'pow';
  if (normalized.includes('PUSH')) return 'push';
  return null;
}

/**
 * Pure block-resolution projection shared by live and historical readers.
 * The caller owns sequence numbers, timing, publication and cancellation.
 */
export function blockOutcomePresentation(
  reports: readonly Record<string, unknown>[],
  game: GameJson,
  context: Pick<BlockContextProjection, 'attackerId' | 'defenderId' | 'defenderSquare'> & {
    /** The choice report may omit the already-shown dice. */
    previousDice?: readonly number[];
  },
): BlockOutcomePresentation {
  const roll = reports.find((report) => String(report.reportId) === 'blockRoll');
  const choice = [...reports].reverse().find((report) => String(report.reportId) === 'blockChoice');
  const source = roll ?? choice;
  const reportedDice = Array.isArray(source?.blockRoll) ? source.blockRoll.map(Number).filter(Number.isFinite) : [];
  const dice = reportedDice.length ? reportedDice : choice && context.previousDice ? [...context.previousDice] : [];
  const choiceIndexRaw = Number(choice?.diceIndex);
  const choiceIndex = Number.isInteger(choiceIndexRaw) && choiceIndexRaw >= 0 && choiceIndexRaw < dice.length
    ? choiceIndexRaw : null;
  const defenderId = String(choice?.defenderId ?? roll?.defenderId ?? context.defenderId ?? '');
  const attackerId = String(context.attackerId ?? game.actingPlayer?.playerId ?? '');
  let stamp: BlockResultStamp | null | undefined;

  if (choice) {
    const symbol = blockSymbol(choice.blockResult);
    if (!symbol) {
      stamp = null;
    } else {
      const hasBlock = (playerId: string): boolean => {
        const player = [...game.teamHome.playerArray, ...game.teamAway.playerArray]
          .find((candidate) => candidate.playerId === playerId);
        return !!player && playerHasSkill(player, 'Block');
      };
      const affected = symbol === 'attacker-down' ? [attackerId]
        : symbol === 'both-down' ? [attackerId, defenderId].filter((id) => id && !hasBlock(id))
          : [defenderId];
      const playerIds = affected.filter(Boolean);
      stamp = playerIds.length ? { symbol, playerIds } : null;
    }
  }

  return {
    stamp,
    choiceIndex,
    dice,
    defenderSquare: context.defenderSquare ? [...context.defenderSquare] : null,
    rerolled: reports.some((report) => {
      const id = String(report.reportId);
      return id === 'blockReRoll'
        || (id === 'reRoll' && report.reRollSource != null && !!roll);
    }),
    dauntlessBeat: reports.some((report) => String(report.reportId) === 'dauntlessRoll') && dice.length > 0,
  };
}
