import type { GameJson } from '@fumbbl40k/ffb-protocol';

export interface HeldTeamMate { thrownId: string; throwerId: string; fromSquare: [number, number] }
export interface FumblerooskieMarker { playerId: string }

export function reduceHeldTeamMate(previous: HeldTeamMate | null, beforeCoordinates: ReadonlyMap<string, readonly number[] | null>, game: GameJson): HeldTeamMate | null {
  const thrownId = String(game.defenderId ?? '');
  const thrown = game.fieldModel.playerDataArray.find((p) => p.playerId === thrownId);
  if (!thrownId || ((thrown?.playerState ?? 0) & 0xff) !== 0x10) return null;
  if (previous?.thrownId === thrownId) return previous;
  const throwerId = String(game.actingPlayer?.playerId ?? '');
  const thrower = game.fieldModel.playerDataArray.find((p) => p.playerId === throwerId);
  const from = beforeCoordinates.get(thrownId) ?? thrown?.playerCoordinate ?? thrower?.playerCoordinate ?? [0, 0];
  return { thrownId, throwerId, fromSquare: [from[0]!, from[1]!] };
}

export function reduceFumblerooskie(previous: FumblerooskieMarker | null, reports: readonly Record<string, unknown>[], game: GameJson): FumblerooskieMarker | null {
  let marker = previous;
  const election = [...reports].reverse().find((r) => r.reportId === 'fumblerooskie');
  if (election) {
    const playerId = String(election.playerId ?? '');
    if (election.used === true && playerId && game.fieldModel.ballMoving) marker = { playerId };
    else if (election.used === false) marker = null;
  }
  return marker && game.fieldModel.ballMoving && game.actingPlayer?.playerId === marker.playerId ? marker : null;
}

export function reduceDodgySnackPlayers(previous: readonly string[], reports: readonly Record<string, unknown>[], game: GameJson): string[] {
  if (game.turnMode === 'setup') return [];
  let players = reports.some((r) => r.reportId === 'kickoffResult') ? [] : [...previous];
  const snack = [...reports].reverse().find((r) => r.reportId === 'kickoffDodgySnack');
  if (snack && Array.isArray(snack.playerIds)) players = snack.playerIds.filter((id): id is string => typeof id === 'string');
  const sentOff = new Set(reports.filter((r) => r.reportId === 'dodgySnackRoll' && Number(r.roll) === 1).map((r) => r.playerId));
  return players.filter((id) => !sentOff.has(id));
}

/** Snapshot state alone cannot distinguish recovery from a wrestled prone player. */
export function stunnedPlayerIds(game: GameJson): string[] {
  return game.fieldModel.playerDataArray.filter((p) => (p.playerState & 0xff) === 4).map((p) => p.playerId);
}

export function reduceRecoveringPlayers(previous: readonly string[], beforeStunned: readonly string[], game: GameJson): string[] {
  const latched = new Set([...previous, ...beforeStunned]);
  return game.fieldModel.playerDataArray.filter((p) => latched.has(p.playerId)
    && (p.playerState & 0xff) === 3 && (p.playerState & 0x100) === 0).map((p) => p.playerId);
}

/** CONFUSED alone does not establish gaze provenance; only an observed success does. */
export function reduceGazeVictims(previous: readonly string[], reports: readonly Record<string, unknown>[], game: GameJson): string[] {
  const victims = new Set(previous);
  for (const report of reports) {
    if (report.reportId === 'hypnoticGazeRoll' && report.successful === true && typeof report.defenderId === 'string') {
      victims.add(report.defenderId);
    }
  }
  const confused = new Set(game.fieldModel.playerDataArray.filter((p) => (p.playerState & 0x200) !== 0).map((p) => p.playerId));
  return [...victims].filter((id) => confused.has(id));
}
