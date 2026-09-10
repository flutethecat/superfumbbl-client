/**
 * BB2025 High Kick — ONE behavioural controller, projected into Modern and Classic.
 *
 * Upstream: ffb-server/.../step/bb2025/kickoff/StepApplyKickoffResult.handleHighKick (:400-...) flips to the
 * receiving side, enters TurnMode.HIGH_KICK, pins players standing in opposing tacklezones, and skips the
 * event entirely when there is a touchback or an existing catcher, or when no acting-team player is ACTIVE.
 * ffb-client-logic/.../state/logic/HighKickLogicModule then lets ONE active receiving player be moved to the
 * ball square; End Turn closes the phase (a decline).
 *
 * The wire contract is exact and ordered: an accepted nomination sends CLIENT_SETUP_PLAYER for the nominee at
 * the ball's landing square, and ONLY THEN CLIENT_END_TURN. A decline sends CLIENT_END_TURN alone. Nothing is
 * sent while a nominee is merely staged — the token moves on the server's echo, never on a local guess.
 */

export const HIGH_KICK_TURN_MODE = 'highKick';

export type HighKickNominationResult =
  | { kind: 'stage'; playerId: string }
  | { kind: 'unstage' }
  | { kind: 'refuse'; reason: 'not-armed' | 'not-eligible' | 'no-landing' };

/** The landing square is SERVER-SENT: the kick-aim square, else the model's ball coordinate. Never derived. */
export function highKickLanding(
  kickAimSquare: readonly [number, number] | null | undefined,
  ballCoordinate: readonly [number, number] | null | undefined,
): [number, number] | null {
  const square = kickAimSquare ?? ballCoordinate;
  if (!square || !Number.isFinite(square[0]) || !Number.isFinite(square[1])) return null;
  return [square[0], square[1]];
}

/**
 * Single-slot staging. Re-clicking the staged nominee un-stages it; a different eligible player replaces it.
 * Nothing is ever vacated because nothing was ever sent.
 */
export function decideHighKickNomination(input: {
  armed: boolean;
  nomineeIds: readonly string[];
  landing: readonly [number, number] | null;
  pendingId: string | null;
  playerId: string;
}): HighKickNominationResult {
  if (!input.armed) return { kind: 'refuse', reason: 'not-armed' };
  if (!input.nomineeIds.includes(input.playerId)) return { kind: 'refuse', reason: 'not-eligible' };
  if (input.pendingId === input.playerId) return { kind: 'unstage' };
  if (!input.landing) return { kind: 'refuse', reason: 'no-landing' };
  return { kind: 'stage', playerId: input.playerId };
}

export interface HighKickWireStep {
  command: 'setupPlayer' | 'endTurn';
  playerId?: string;
  coordinate?: [number, number];
}

/**
 * The ordered wire both views must produce for a confirm/decline. Returns an empty list when the surface is
 * not armed, so opponent, spectator and replay seats send nothing at all.
 */
export function highKickConfirmWire(input: {
  armed: boolean;
  pendingId: string | null;
  landing: readonly [number, number] | null;
}): HighKickWireStep[] {
  if (!input.armed) return [];
  const steps: HighKickWireStep[] = [];
  if (input.pendingId && input.landing) {
    steps.push({ command: 'setupPlayer', playerId: input.pendingId, coordinate: [input.landing[0], input.landing[1]] });
  }
  steps.push({ command: 'endTurn' });
  return steps;
}

/** A staged nominee the server has since dropped from the offer must not survive into the confirm. */
export function pruneHighKickStaging(pendingId: string | null, nomineeIds: readonly string[]): string | null {
  return pendingId && nomineeIds.includes(pendingId) ? pendingId : null;
}
