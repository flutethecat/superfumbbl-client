import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { exertsTacklezone, FLAG_ACTIVE, playerSideIsHome } from './availableActions';

export type GazeMovementState = 'GAZE_MOVE' | 'GAZE';

export interface GazeIntent {
  actingPlayerId: string;
  victimId: string | null;
  pendingVictimId: string | null;
  phase: 'declaring' | 'targeting' | 'targetSelected' | 'active';
  /** Target selection and confirmation bump this so presentation can re-arm. */
  seq: number;
}

export function isGazeMovementState(state: string): state is GazeMovementState {
  return state === 'GAZE_MOVE' || state === 'GAZE';
}

export type GazeTargetClick = 'confirmDeclared' | 'confirmCandidate' | 'nominate' | 'ordinary';

/** Locked activations intercept only their declared victim; every other click stays ordinary. */
export function gazeTargetClick(intent: GazeIntent | null, candidateId: string | null, clickedId: string): GazeTargetClick {
  if (!intent) return 'ordinary';
  if (intent.phase === 'active') return intent.victimId === clickedId ? 'confirmDeclared' : 'ordinary';
  if (intent.phase !== 'targeting' && intent.phase !== 'targetSelected') return 'ordinary';
  return candidateId === clickedId ? 'confirmCandidate' : 'nominate';
}

const normSkill = (skill: string) => skill.toLowerCase().replace(/[^a-z]/g, '');

function rosterPlayer(game: GameJson, playerId: string): { skillArray?: string[]; usedSkills?: string[] } | undefined {
  const players = [
    ...((game.teamHome as { playerArray?: { playerId: string; skillArray?: string[]; usedSkills?: string[] }[] }).playerArray ?? []),
    ...((game.teamAway as { playerArray?: { playerId: string; skillArray?: string[]; usedSkills?: string[] }[] }).playerArray ?? []),
  ];
  return players.find((player) => player.playerId === playerId);
}

function isOpposingOnPitch(game: GameJson, actingPlayerId: string, victimId: string): boolean {
  const actorSide = playerSideIsHome(game, actingPlayerId);
  const victimSide = playerSideIsHome(game, victimId);
  const victim = game.fieldModel.playerDataArray.find((player) => player.playerId === victimId);
  const coordinate = victim?.playerCoordinate;
  return actorSide !== null && victimSide !== null && actorSide !== victimSide
    && Array.isArray(coordinate) && coordinate[0] >= 0 && coordinate[0] <= 25 && coordinate[1] >= 0 && coordinate[1] <= 14;
}

/** Target declaration is range-free but otherwise mirrors upstream canGaze victim semantics. */
export function canNominateGazeVictim(game: GameJson, actingPlayerId: string, victimId: string): boolean {
  const victim = game.fieldModel.playerDataArray.find((player) => player.playerId === victimId);
  return isOpposingOnPitch(game, actingPlayerId, victimId) && exertsTacklezone(victim?.playerState, true);
}

/**
 * Exact send-time client mirror of bb2025 GazeLogicModule.canBeGazed + UtilPlayer.canGaze.
 * It reads only server-model state: unused Hypnotic Gaze, active actor, current adjacency, opposing side,
 * and victim PlayerState.hasTacklezones (STANDING/MOVING/BLOCKED and not confused/hypnotized).
 */
export function gazeConfirmRefusalReason(game: GameJson, intent: GazeIntent | null): string | null {
  if (!intent?.victimId) return 'there is no nominated victim';
  if (!isOpposingOnPitch(game, intent.actingPlayerId, intent.victimId)) return 'the nominated victim is no longer available';
  const actor = game.fieldModel.playerDataArray.find((player) => player.playerId === intent.actingPlayerId);
  const victim = game.fieldModel.playerDataArray.find((player) => player.playerId === intent.victimId);
  if (!actor || !victim || !Array.isArray(actor.playerCoordinate) || !Array.isArray(victim.playerCoordinate)) {
    return 'the gazer or nominated victim is no longer on the pitch';
  }

  const actorRoster = rosterPlayer(game, intent.actingPlayerId);
  const skills = new Set((actorRoster?.skillArray ?? []).map(normSkill));
  const used = new Set((actorRoster?.usedSkills ?? []).map(normSkill));
  if (used.has('hypnoticgaze')) return 'Hypnotic Gaze has already been used';
  if (!skills.has('hypnoticgaze') || !(Number(actor.playerState ?? 0) & FLAG_ACTIVE)) {
    return 'the gazer can no longer use Hypnotic Gaze';
  }

  // Unlike the settled planner callers of exertsTacklezone, upstream Gaze accepts the transient MOVING/BLOCKED
  // bases too. Opt in here to preserve that exact send-time predicate without duplicating PlayerState bits.
  const hasTacklezones = exertsTacklezone(victim.playerState, true);
  if (!hasTacklezones) return 'the nominated victim has no tackle zones';
  const adjacent = Math.max(
    Math.abs(actor.playerCoordinate[0] - victim.playerCoordinate[0]),
    Math.abs(actor.playerCoordinate[1] - victim.playerCoordinate[1]),
  ) === 1;
  if (!adjacent) return 'the gazer is not adjacent to the nominated victim yet';
  return null;
}

export function canConfirmGazeAtCurrentPosition(game: GameJson, intent: GazeIntent | null): boolean {
  return gazeConfirmRefusalReason(game, intent) === null;
}
