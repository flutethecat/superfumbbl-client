import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { exertsTacklezone, FLAG_ACTIVE, playerSideIsHome } from './availableActions';
import { plannedContactStep, routeEndsBeside, type ContactReachResult } from './leftClickBlitzPlanner';

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

/**
 * Owner 10-08 (Modern): no victim is named at declare. A click on an opposing player during a live gaze activation
 * is read against the gazer's CURRENT square:
 *  - 'confirm'  the armed victim, gazeable from here: the second click sends the one CLIENT_GAZE;
 *  - 'arm'      gazeable from here, not armed yet: the first click arms it (replacing any other armed victim);
 *  - 'approach' a legal victim that is not adjacent: the view plots the walk to a square next to it;
 *  - 'refused'  adjacent but the send-time check fails (see gazeConfirmRefusalReason);
 *  - 'ordinary' not a gaze victim at all (own side, off pitch, no tackle zones): the click keeps its usual meaning.
 * Owner 11-18: with a route laid out (`routeLaidOut`), the route wins over a gaze from here - an adjacent, otherwise
 * gazeable victim is an 'approach' too (walk the planned route, then gaze), unless the walk is spent (gazeWalkSpent).
 */
export type GazeVictimClick = 'confirm' | 'arm' | 'approach' | 'refused' | 'ordinary';

/**
 * The server action is the NON-moving `gaze` (PlayerAction.isMoving:68-71): a CLIENT_GAZE was already taken and not
 * rolled (a final failed Bloodlust roll). Walking from here needs the GAZE -> MOVE action change, which gives the gaze
 * up, so there is no walk-to-contact: only a victim adjacent to the gazer's current square can still be gazed.
 */
export function gazeWalkSpent(game: GameJson): boolean {
  return String((game.actingPlayer as { playerAction?: string | null } | null | undefined)?.playerAction ?? '') === 'gaze';
}

export function gazeVictimClick(game: GameJson, intent: GazeIntent | null, clickedId: string, routeLaidOut = false): GazeVictimClick {
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
  if (!adjacent) return gazeWalkSpent(game) ? 'refused' : 'approach';
  if (gazeConfirmRefusalReason(game, { ...intent, victimId: clickedId }) !== null) return 'refused';
  if (routeLaidOut && !gazeWalkSpent(game)) return 'approach';
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
export type GazeContactReach = ContactReachResult;
export type GazeApproachStep =
  | { kind: 'plot'; route: GazeSquare[] }
  | { kind: 'walk'; route: GazeSquare[] }
  | { kind: 'unreachable'; surrounded: boolean };

/**
 * Owner 10-08 / 11-18: a click on a legal gaze victim the gazer walks to (not adjacent, or adjacent with a route laid
 * out). Click 1 arms the victim and picks the walk the Blitz way (plannedContactStep): a planned route that ends next
 * to the victim is kept unchanged, one that stops short is extended from its last square, and only with no planned
 * route is the stance picker's walk to contact plotted. Click 2 on the SAME victim, with the stored route still ending
 * next to it, is 'walk': the view sends exactly that route as the walk-then-gaze plan (nothing is recomputed). Nothing
 * here sends.
 */
export function gazeApproachClick(input: {
  victimId: string;
  victimSquare: GazeSquare | null;
  armedVictimId: string | null;
  plannedRoute: GazeSquare[] | null;
  contactReach: (victimSquare: GazeSquare) => GazeContactReach;
  /** Extend the planned route from its last square (renderer `o66ExtendPath`); absent = no extension possible. */
  extendWaypoint?: (route: GazeSquare[], destination: GazeSquare) => GazeSquare[] | null;
  routeCost?: (route: GazeSquare[]) => number;
}): GazeApproachStep {
  const { victimSquare, plannedRoute } = input;
  if (!victimSquare) return { kind: 'unreachable', surrounded: false };
  // Owner 11-19: the armed victim with the stored route still beside it is the confirm; otherwise the click is a fresh
  // nomination (the kept route extended append-only to contact below).
  if (input.armedVictimId === input.victimId && routeEndsBeside(plannedRoute, victimSquare)) return { kind: 'walk', route: plannedRoute! };
  const step = plannedContactStep({
    target: victimSquare,
    waypointRoute: plannedRoute ?? [],
    contactReach: () => input.contactReach(victimSquare),
    extendWaypoint: input.extendWaypoint ?? (() => null),
    routeCost: input.routeCost,
  });
  if (step.kind === 'unreachable') return step;
  return { kind: 'plot', route: step.route };
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
  if (!adjacent) {
    return gazeWalkSpent(game)
      ? 'the victim is not adjacent, and walking now gives up the Hypnotic Gaze'
      : 'the gazer is not adjacent to the nominated victim yet';
  }
  return null;
}

export function canConfirmGazeAtCurrentPosition(game: GameJson, intent: GazeIntent | null): boolean {
  return gazeConfirmRefusalReason(game, intent) === null;
}
