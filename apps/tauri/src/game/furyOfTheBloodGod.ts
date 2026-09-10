import type { GameJson } from '@fumbbl40k/ffb-protocol';

export const FURY_OF_THE_BLOOD_GOD = 'Fury of the Blood God';

export interface FurySecondBlockTargeting {
  playerId: string;
  targetIds: string[];
  targetSquares: [number, number][];
}

function square(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

/**
 * Project the exact server-owned pause between Scyla's first and second block.
 *
 * BB2025 StepEndBlocking enters this state by clearing defenderId, resetting
 * hasBlocked, pushing a new Block sequence with publishDefender=true, and then
 * broadcasting ServerUtilBlock's dice decorations. Fury itself was marked used
 * when its skillUse answer was accepted. Requiring all of those model facts
 * avoids mistaking the original block declaration for the second-target pause,
 * while remaining reconnect-safe without replaying a client-side rules engine.
 */
export function furySecondBlockTargeting(game: GameJson): FurySecondBlockTargeting | null {
  const acting = game.actingPlayer as {
    playerId?: string | null;
    playerAction?: string | null;
    hasBlocked?: boolean;
    usedSkills?: string[];
  } | null;
  const playerId = String(acting?.playerId ?? '');
  if (!playerId || String(acting?.playerAction ?? '') !== 'block') return null;
  if (acting?.hasBlocked !== false || game.defenderId != null) return null;
  if (!(acting?.usedSkills ?? []).includes(FURY_OF_THE_BLOOD_GOD)) return null;

  const data = game.fieldModel.playerDataArray as { playerId?: string; playerCoordinate?: unknown }[];
  const targetIds: string[] = [];
  const targetSquares: [number, number][] = [];
  for (const raw of game.fieldModel.diceDecorationArray ?? []) {
    const targetSquare = square((raw as { coordinate?: unknown }).coordinate);
    if (!targetSquare) continue;
    const target = data.find((entry) => {
      const playerSquare = square(entry.playerCoordinate);
      return playerSquare?.[0] === targetSquare[0] && playerSquare[1] === targetSquare[1];
    });
    if (!target?.playerId || targetIds.includes(target.playerId)) continue;
    targetIds.push(target.playerId);
    targetSquares.push(targetSquare);
  }
  return targetIds.length > 0 ? { playerId, targetIds, targetSquares } : null;
}
