import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { projectAuthoritativeKick, projectKickScatterPreview, type AuthoritativeKickBeat, type KickPlaybackContext, type KickScatterPreview } from './kickElection';
import { movesRandomly } from './logic/availableActions';

export type ThrowPresentationKind = 'pass' | 'punt' | 'throwTeamMate' | 'throwBomb' | 'throwARock' | 'throwKeg';

const THROW_KIND_BY_WIRE: Readonly<Record<string, Exclude<ThrowPresentationKind, 'punt'>>> = {
  pass: 'pass', hailMaryPass: 'pass', throwTeamMate: 'throwTeamMate',
  throwBomb: 'throwBomb', hailMaryBomb: 'throwBomb', throwARock: 'throwARock', throwKeg: 'throwKeg',
};

export const KNOWN_PROJECTILE_ANIMATION_TYPES = new Set([
  'kick', 'bombExplosion', 'trickster', 'spellFireball', 'spellZap', 'spellLightning',
  'thenIStartedBlastin', ...Object.keys(THROW_KIND_BY_WIRE),
]);

const DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  NORTH: [0, -1], NORTHEAST: [1, -1], EAST: [1, 0], SOUTHEAST: [1, 1],
  SOUTH: [0, 1], SOUTHWEST: [-1, 1], WEST: [-1, 0], NORTHWEST: [-1, -1],
};

function pitchCoordinate(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2 || !Number.isInteger(value[0]) || !Number.isInteger(value[1])) return null;
  const coordinate: [number, number] = [value[0], value[1]];
  return coordinate[0] >= 0 && coordinate[0] < 26 && coordinate[1] >= 0 && coordinate[1] < 15 ? coordinate : null;
}

/** PASS is also the upstream wire animation for Punt, so reports/acting state select its presentation. */
export function throwPresentationKind(
  animationType: unknown,
  reports: readonly Record<string, unknown>[],
  actingPlayerAction?: unknown,
): ThrowPresentationKind | undefined {
  const wireType = String(animationType);
  const baseKind = THROW_KIND_BY_WIRE[wireType];
  if (wireType !== 'pass' || baseKind !== 'pass') return baseKind;
  const puntReported = reports.some((report) => ['puntDistanceRoll', 'puntDirectionRoll'].includes(String(report.reportId)));
  return puntReported || /^punt/i.test(String(actingPlayerAction ?? '')) ? 'punt' : 'pass';
}

export function scatterPathFromStart(start: unknown, directions: unknown): [number, number][] | null {
  const coordinate = pitchCoordinate(start);
  if (!coordinate || !Array.isArray(directions) || directions.length === 0) return null;
  const path: [number, number][] = [[coordinate[0], coordinate[1]]];
  let x = coordinate[0], y = coordinate[1];
  for (const direction of directions) {
    const delta = DIRECTIONS[String(direction).toUpperCase()];
    if (!delta) return null;
    x += delta[0]; y += delta[1];
    path.push([x, y]);
  }
  return path;
}

/** ReportScatterBall carries only directions; the applied model supplies its authoritative endpoint. */
export function scatterPathFromEnd(end: unknown, directions: unknown): [number, number][] | null {
  const coordinate = pitchCoordinate(end);
  if (!coordinate || !Array.isArray(directions) || directions.length === 0) return null;
  let x = coordinate[0], y = coordinate[1];
  const reverse: [number, number][] = [[x, y]];
  for (let index = directions.length - 1; index >= 0; index--) {
    const delta = DIRECTIONS[String(directions[index]).toUpperCase()];
    if (!delta) return null;
    x -= delta[0]; y -= delta[1];
    reverse.push([x, y]);
  }
  return reverse.reverse();
}

export interface BallProjectilePresentation {
  context: BallProjectileContext;
  /** Undefined leaves the rail alone; null explicitly retires it. */
  passBallHold: [number, number] | null | undefined;
  kickScatterPreview: KickScatterPreview | null | undefined;
  suppressedBallScatter: boolean;
  authoritativeKick: Readonly<AuthoritativeKickBeat> | null;
  catchPlayerId: string | null;
  direction: { playerId: string; direction: string } | null;
  ballScatter: { path: [number, number][]; sound?: 'bounce' } | null;
  playerScatter: { playerId: string; path: [number, number][] } | null;
  bomb: { square: [number, number]; sound: 'explode' } | null;
  fireball: { square: [number, number]; sound: 'fireball' } | null;
  throw: { kind: ThrowPresentationKind; from: [number, number]; to: [number, number]; thrownId?: string; sound: 'throw' | 'woooaaah' } | null;
  trickster: { playerId: string; from: [number, number]; to: [number, number] } | null;
  leap: { playerId: string; kind: 'crossing' | 'inPlace'; sound: 'boing' } | null;
  ballAndChainScatter: { playerId: string; roll: number; from: [number, number]; dest: [number, number] } | null;
  sounds: { id: 'zap' | 'blunder' | 'hypno'; when: 'immediate' | 'tricksterArrival' }[];
  unknownAnimationType: string | null;
}

/** Minimal cross-command flight state; safe to retain in spectator checkpoints. */
export interface BallProjectileContext {
  passAwaitingAuthoritativeThrow: boolean;
  passOrigin: [number, number] | null;
  kickAwaitingAuthoritativeThrow: boolean;
  kickPreview: KickScatterPreview | null;
}

export const createBallProjectileContext = (): BallProjectileContext => ({
  passAwaitingAuthoritativeThrow: false, passOrigin: null,
  kickAwaitingAuthoritativeThrow: false, kickPreview: null,
});

/**
 * Derive renderer-ready ball, projectile and spell cues without touching the model or UI.
 * The caller decides whether a ball scatter belongs behind a kickoff/pass transaction.
 */
export function ballProjectilePresentation(
  command: Readonly<Record<string, unknown>>,
  reports: readonly Record<string, unknown>[],
  game: GameJson,
  context: {
    playback: KickPlaybackContext;
    previous?: Readonly<BallProjectileContext>;
    fallbackThrownPlayerId?: string | null;
    priorCoordinates?: ReadonlyMap<string, readonly number[] | null>;
  },
): BallProjectilePresentation {
  const nextContext: BallProjectileContext = {
    ...(context.previous ?? createBallProjectileContext()),
    passOrigin: context.previous?.passOrigin ? [...context.previous.passOrigin] : null,
    kickPreview: context.previous?.kickPreview ? structuredClone(context.previous.kickPreview) : null,
  };
  let passBallHold: BallProjectilePresentation['passBallHold'];
  let kickScatterPreview: BallProjectilePresentation['kickScatterPreview'];
  const animation = command.animation as {
    animationType?: unknown; thrownPlayerId?: unknown; startCoordinate?: unknown;
    endCoordinate?: unknown; interceptorCoordinate?: unknown;
  } | null | undefined;
  const animationType = animation?.animationType == null ? '' : String(animation.animationType);
  const catchReport = reports.find((report) => String(report.reportId) === 'catchRoll');
  const directionReport = [...reports].reverse().find((report) =>
    ['puntDirectionRoll', 'swoopDirectionRoll'].includes(String(report.reportId)));
  const scatterBall = reports.find((report) => String(report.reportId) === 'scatterBall');
  const ballDirections = scatterBall?.directionArray ?? scatterBall?.directions;
  const kickoffScatter = reports.find((report) => String(report.reportId) === 'kickoffScatter');
  if (kickoffScatter) {
    try {
      const preview = projectKickScatterPreview(kickoffScatter);
      nextContext.kickAwaitingAuthoritativeThrow = true;
      nextContext.kickPreview = preview;
      kickScatterPreview = preview;
    } catch { /* kickoffWeatherPresentation owns the diagnostic */ }
  }
  const passRoll = reports.find((report) => String(report.reportId) === 'passRoll');
  const passResult = String(passRoll?.passResult ?? '').toUpperCase();
  if (passRoll && passRoll.bomb !== true && passResult.includes('INACCURATE')) {
    const passerId = String(passRoll.playerId ?? (game as { throwerId?: unknown }).throwerId ?? '');
    const current = game.fieldModel.playerDataArray.find((player) => player.playerId === passerId)?.playerCoordinate;
    const origin = pitchCoordinate(context.priorCoordinates?.get(passerId) ?? current);
    if (origin) {
      nextContext.passAwaitingAuthoritativeThrow = true;
      nextContext.passOrigin = origin;
      passBallHold = origin;
    }
  } else if (passRoll && (passResult.includes('FUMBLE') || passRoll.successful === true)) {
    nextContext.passAwaitingAuthoritativeThrow = false;
    nextContext.passOrigin = null;
    passBallHold = null;
  }
  const preflightBallScatter = !!scatterBall
    && (nextContext.passAwaitingAuthoritativeThrow || nextContext.kickAwaitingAuthoritativeThrow);
  if (preflightBallScatter) {
    if (nextContext.passOrigin) passBallHold = [...nextContext.passOrigin];
    if (nextContext.kickPreview) kickScatterPreview = structuredClone(nextContext.kickPreview);
  }
  const ballPath = preflightBallScatter ? null : scatterPathFromEnd(game.fieldModel.ballCoordinate, ballDirections);
  const scatterPlayer = reports.find((report) => String(report.reportId) === 'scatterPlayer');
  const playerPath = scatterPathFromStart(scatterPlayer?.startCoordinate,
    scatterPlayer?.directionArray ?? scatterPlayer?.directions);
  const thrownPlayerId = String(animation?.thrownPlayerId ?? context.fallbackThrownPlayerId
    ?? (game as { defenderId?: unknown }).defenderId ?? '');
  const playerScatterCoveredByThrow = scatterPlayer?.isScatter === true
    && animationType === 'throwTeamMate' && String(animation?.thrownPlayerId ?? '') === thrownPlayerId;
  const sounds: BallProjectilePresentation['sounds'] = [];
  if (animationType === 'spellZap' || animationType === 'spellLightning') sounds.push({ id: 'zap', when: 'immediate' });
  if (animationType === 'thenIStartedBlastin') sounds.push({ id: 'blunder', when: 'immediate' });
  if (animationType === 'trickster') sounds.push(
    { id: 'hypno', when: 'immediate' }, { id: 'blunder', when: 'tricksterArrival' },
  );

  const from = pitchCoordinate(animation?.startCoordinate);
  const ordinaryEnd = animationType === 'pass' && pitchCoordinate(animation?.interceptorCoordinate)
    ? animation!.interceptorCoordinate : animation?.endCoordinate;
  const to = pitchCoordinate(ordinaryEnd);
  const kind = throwPresentationKind(animationType, reports, game.actingPlayer?.playerAction);
  const throwCue = kind && from && to ? {
    kind, from: [from[0], from[1]] as [number, number], to: [to[0], to[1]] as [number, number],
    ...(thrownPlayerId ? { thrownId: thrownPlayerId } : {}),
    sound: (kind === 'throwTeamMate' ? 'woooaaah' : 'throw') as 'throw' | 'woooaaah',
  } : null;
  if (kind === 'pass' && throwCue) {
    nextContext.passAwaitingAuthoritativeThrow = false;
    nextContext.passOrigin = null;
    passBallHold = null;
  }
  if (animationType === 'kick') {
    nextContext.kickAwaitingAuthoritativeThrow = false;
    nextContext.kickPreview = null;
    kickScatterPreview = null;
  }
  if (reports.some((report) => String(report.reportId) === 'turnEnd')) {
    nextContext.passAwaitingAuthoritativeThrow = false;
    nextContext.passOrigin = null;
    passBallHold = null;
  }
  const square = pitchCoordinate(animation?.startCoordinate);
  const leapReport = reports.find((report) => String(report.reportId) === 'leapRoll');
  const leapPlayerId = typeof leapReport?.playerId === 'string' ? leapReport.playerId : '';
  const leapBefore = leapPlayerId ? context.priorCoordinates?.get(leapPlayerId) : null;
  const leapAfter = leapPlayerId
    ? game.fieldModel.playerDataArray.find((player) => player.playerId === leapPlayerId)?.playerCoordinate : null;
  const leapBeforeCoordinate = pitchCoordinate(leapBefore);
  const leapAfterCoordinate = pitchCoordinate(leapAfter);
  const leapMoved = !!leapBeforeCoordinate && !!leapAfterCoordinate
    && (leapBeforeCoordinate[0] !== leapAfterCoordinate[0] || leapBeforeCoordinate[1] !== leapAfterCoordinate[1]);
  const actingPlayerId = String(game.actingPlayer?.playerId ?? '');
  const bncRoll = Array.isArray(scatterPlayer?.rolls) ? Number(scatterPlayer.rolls[0]) : NaN;
  const bncFrom = pitchCoordinate(scatterPlayer?.startCoordinate);
  const bncTo = pitchCoordinate(scatterPlayer?.endCoordinate);
  const ballAndChainScatter = scatterPlayer && actingPlayerId && movesRandomly(game, actingPlayerId)
    && Number.isFinite(bncRoll) && bncFrom && bncTo
    ? { playerId: actingPlayerId, roll: bncRoll,
      from: [bncFrom[0], bncFrom[1]] as [number, number], dest: [bncTo[0], bncTo[1]] as [number, number] }
    : null;

  let authoritativeKick: Readonly<AuthoritativeKickBeat> | null = null;
  try {
    authoritativeKick = projectAuthoritativeKick(String(game.gameId ?? 'unknown'), command as Record<string, unknown>, context.playback);
  } catch { /* caller may log malformed wire data without losing the model frame */ }
  return {
    context: nextContext,
    passBallHold,
    kickScatterPreview,
    suppressedBallScatter: preflightBallScatter,
    authoritativeKick,
    catchPlayerId: typeof catchReport?.playerId === 'string' ? catchReport.playerId : null,
    direction: typeof directionReport?.playerId === 'string' && typeof directionReport.direction === 'string'
      ? { playerId: directionReport.playerId, direction: directionReport.direction } : null,
    ballScatter: ballPath ? { path: ballPath, ...(command.sound === 'bounce' ? { sound: 'bounce' as const } : {}) } : null,
    playerScatter: playerPath && thrownPlayerId && !playerScatterCoveredByThrow && !ballAndChainScatter
      ? { playerId: thrownPlayerId, path: playerPath } : null,
    bomb: animationType === 'bombExplosion' && square ? { square, sound: 'explode' } : null,
    fireball: animationType === 'spellFireball' && square ? { square, sound: 'fireball' } : null,
    throw: throwCue,
    trickster: animationType === 'trickster' && thrownPlayerId && from && to
      ? { playerId: thrownPlayerId, from: [from[0], from[1]], to: [to[0], to[1]] } : null,
    leap: leapPlayerId ? { playerId: leapPlayerId, kind: leapMoved ? 'crossing' : 'inPlace', sound: 'boing' } : null,
    ballAndChainScatter,
    sounds,
    unknownAnimationType: animationType && !KNOWN_PROJECTILE_ANIMATION_TYPES.has(animationType) ? animationType : null,
  };
}
