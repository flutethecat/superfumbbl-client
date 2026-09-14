import type { GameJson } from '@fumbbl40k/ffb-protocol';

export const DRIVE_PROVENANCES = ['snapshotEstimate', 'kickoff'] as const;
export interface DriveProjection { offenseIsHome: boolean; provenance: (typeof DRIVE_PROVENANCES)[number] }
export function reduceDriveProjection(previous: DriveProjection | null, reports: readonly Record<string, unknown>[], game: GameJson): DriveProjection {
  const scatter = reports.find((r) => r.reportId === 'kickoffScatter');
  if (Array.isArray(scatter?.ballCoordinateEnd) && typeof scatter.ballCoordinateEnd[0] === 'number' && Number.isFinite(scatter.ballCoordinateEnd[0])) {
    return { offenseIsHome: scatter.ballCoordinateEnd[0] <= 12, provenance: 'kickoff' };
  }
  if (previous) return previous;
  const fm = game.fieldModel;
  const ball = fm.ballCoordinate;
  if (fm.ballInPlay && !fm.ballMoving && Array.isArray(ball)) {
    const carrier = fm.playerDataArray.find((p) => p.playerCoordinate?.[0] === ball[0] && p.playerCoordinate?.[1] === ball[1]);
    if (carrier) return { offenseIsHome: game.teamHome.playerArray.some((p) => p.playerId === carrier.playerId), provenance: 'snapshotEstimate' };
  }
  return { offenseIsHome: Number(game.half ?? 1) === 2 ? !game.homeFirstOffense : !!game.homeFirstOffense, provenance: 'snapshotEstimate' };
}
