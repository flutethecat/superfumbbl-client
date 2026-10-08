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

/**
 * Owner 10-08 (Modern): no victim is named at declare. A click on an opposing player during a live gaze activation
 * is read against the gazer's CURRENT square:
 *  - 'confirm'  the armed victim, gazeable from here: the second click sends the one CLIENT_GAZE;
 *  - 'arm'      gazeable from here, not armed yet: the first click arms it (replacing any other armed victim);
 *  - 'approach' a legal victim that is not adjacent: the view plots the walk to a square next to it;
 *  - 'refused'  adjacent but the send-time check fails (see gazeConfirmRefusalReason);
 *  - 'ordinary' not a gaze victim at all (own side, off pitch, no tackle zones): the click keeps its usual meaning.
 */
export type GazeVictimClick = 'confirm' | 'arm' | 'approach' | 'refused' | 'ordinary';

export function gazeVictimClick(game: GameJson, intent: GazeIntent | null, clickedId: string): GazeVictimClick {
  if (!intent || intent.phase !== 'active') return 'ordinary';
  if (!canNominateGazeVictim(game, intent.actingPlayerId, clickedId)) return 'ordinary';
  // BB2020: the server already holds the declared target; any other opponent is not a gaze victim this activation.
  if (!matchesDeclaredGazeTarget(game, clickedId)) return 'ordinary';
  const actor = game.fieldModel.playerDataArray.find((player) => player.playerId === intent.actingPlayerId);
  const victim = game.fieldModel.playerDataArray.find((player) => player.playerId === clickedId);
  if (!actor || !victim || !Array.isArray(actor.playerCoordinate) || !Array.isArray(victim.playerCoordinate)) return 'ordinary';
  const adjacent = Math.max(
    Math.abs(actor.playerCoordinate[0] - victim.playerCoordinate[0]),
    Math.abs(actor.playerCoordinate[1] - victim.playerCoordinate[1]),
  ) === 1;
  if (!adjacent) return 'approach';
  if (gazeConfirmRefusalReason(game, { ...intent, victimId: clickedId }) !== null) return 'refused';
  return (intent.victimId ?? intent.pendingVictimId) === clickedId ? 'confirm' : 'arm';
}

/** The victim the acting coach's confirm would send: Classic's locked declaration, else Modern's armed victim. */
export function armedGazeVictim(intent: GazeIntent | null | undefined): string | null {
  return intent?.phase === 'active' ? (intent.victimId ?? intent.pendingVictimId) : null;
}

/** The player wearing the gaze target marker: the local armed victim first, else the wire's declared target that
 *  every seat sees. Pure so a freshly mounted view can seed the renderer from the store exactly as its watcher does. */
export function gazeTargetMarkerId(
  intent: GazeIntent | null | undefined,
  reveal: { targetId: string } | null | undefined,
): string | null {
  return armedGazeVictim(intent) ?? reveal?.targetId ?? null;
}

type GazeSquare = [number, number];
/** The shared walk-to-contact plot (renderer `o66ContactReach`), passed in so this module stays renderer-free. */
export type GazeContactReach = { status: string; path: GazeSquare[] } | null;
export type GazeApproachStep =
  | { kind: 'plot'; route: GazeSquare[] }
  | { kind: 'walk'; route: GazeSquare[] }
  | { kind: 'unreachable'; surrounded: boolean };

/**
 * Owner 10-08: a click on a legal gaze victim that is NOT adjacent. Click 1 plots the walk to a square next to it
 * (the existing stance picker decides the square - this only reads its answer); click 2 on the SAME victim walks the
 * plotted route, honouring a route the coach re-plotted by hand as long as it still ends next to the victim. The walk
 * is an ordinary gaze move: nothing here sends, and the gaze itself still needs its own click once adjacent.
 */
export function gazeApproachClick(input: {
  victimId: string;
  victimSquare: GazeSquare | null;
  armedVictimId: string | null;
  plannedRoute: GazeSquare[] | null;
  contactReach: (victimSquare: GazeSquare) => GazeContactReach;
}): GazeApproachStep {
  const { victimSquare, plannedRoute } = input;
  if (!victimSquare) return { kind: 'unreachable', surrounded: false };
  const last = plannedRoute && plannedRoute.length > 0 ? plannedRoute[plannedRoute.length - 1]! : null;
  const endsNextToVictim = !!last
    && Math.max(Math.abs(last[0] - victimSquare[0]), Math.abs(last[1] - victimSquare[1])) === 1;
  if (input.armedVictimId === input.victimId && endsNextToVictim) return { kind: 'walk', route: plannedRoute! };
  const reach = input.contactReach(victimSquare);
  if (!reach || reach.status !== 'PATH' || reach.path.length === 0) {
    return { kind: 'unreachable', surrounded: reach?.status === 'SURROUNDED' };
  }
  return { kind: 'plot', route: reach.path };
}

/**
 * BB2020 only: the target the server recorded from the `selectGazeTarget` answer (StepSelectGazeTarget sets
 * `fieldModel.targetSelectionState` SELECTED with that player). Upstream bb2020 GazeMoveLogicModule gazes through
 * `UtilPlayer.isAdjacentGazeTarget`, which accepts only that selected id, and the server does not re-check the victim
 * a CLIENT_GAZE names - so the client must. Read only during a gaze action, so a blitz selection never counts.
 * BB2025 has no selection step: this is null there and every legal victim stays available.
 */
export function declaredGazeTargetId(game: GameJson): string | null {
  const action = String((game.actingPlayer as { playerAction?: string | null } | null | undefined)?.playerAction ?? '');
  if (!/gaze/i.test(action)) return null;
  const selection = (game.fieldModel as { targetSelectionState?: { playerId?: unknown; targetSelectionStatus?: unknown } | null } | undefined)
    ?.targetSelectionState;
  if (!selection || String(selection.targetSelectionStatus ?? '') !== 'SELECTED') return null;
  const id = String(selection.playerId ?? '');
  return id || null;
}

/** True when no target is declared (BB2025), or this player IS the declared one (upstream compares ignoring case). */
export function matchesDeclaredGazeTarget(game: GameJson, playerId: string): boolean {
  const declared = declaredGazeTargetId(game);
  return declared === null || declared.toLowerCase() === playerId.toLowerCase();
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
  if (!matchesDeclaredGazeTarget(game, intent.victimId)) return 'a different player is the declared gaze target';
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
