import type { GameJson } from '@fumbbl40k/ffb-protocol';

/** Durable board/coach-panel facts. No receive trackers, effects or renderer sequence numbers. */
export interface BoardProjection {
  playingIsHome: boolean | null;
  sawActiveBit: boolean;
  turnKey: string;
  activePlayerId: string | null;
  actedPlayers: string[];
}
export function createBoardProjection(): BoardProjection {
  return { playingIsHome: null, sawActiveBit: false, turnKey: '', activePlayerId: null, actedPlayers: [] };
}
export function boardTurnKey(g: GameJson): string {
  return `${g.turnMode}:${g.homePlaying}:${g.turnDataHome?.turnNr}:${g.turnDataAway?.turnNr}`;
}
export function reduceBoardProjection(previous: BoardProjection, game: GameJson, input: {
  recoveringPlayers: readonly string[];
  reports: readonly Record<string, unknown>[];
  /** Player-seat acknowledgement policy; spectator/replay readers pass the cursor's acting id. */
  acknowledgedActingId: string | null;
  followupAttackerId: string | null;
}): BoardProjection {
  const rawHome = !!game.homePlaying;
  const playingIsHome = previous.playingIsHome === null || game.turnMode !== 'betweenTurns'
    ? rawHome : previous.playingIsHome;
  const players = game.fieldModel.playerDataArray;
  const homeIds = new Set(game.teamHome.playerArray.map((p) => p.playerId));
  const movingId = players.find((p) => (p.playerState & 0xff) === 2)?.playerId ?? null;
  const activeBitId = players.find((p) => (p.playerState & 0x100) !== 0 && homeIds.has(p.playerId) === rawHome)?.playerId ?? null;
  const activeByState = input.acknowledgedActingId ?? movingId;
  const sawActiveBit = previous.sawActiveBit || !!activeBitId || !!activeByState;
  const acting = game.actingPlayer?.playerId ?? null;
  const notation = input.reports.map((r) => r.actingPlayerId ?? r.playerId ?? r.defenderId).find((id): id is string => typeof id === 'string') ?? null;
  const over = game.turnMode === 'endGame' || !!game.finished
    || !!game.gameResult?.teamResultHome?.conceded || !!game.gameResult?.teamResultAway?.conceded;
  let activePlayerId = over ? null : sawActiveBit ? activeByState : activeByState ?? acting ?? notation;
  if (!over && acting && input.followupAttackerId === acting) activePlayerId = acting;
  const turnKey = boardTurnKey(game);
  if (turnKey !== previous.turnKey) activePlayerId = null;
  const actedPlayers = over ? [] : players.filter((p) => {
    if (p.playerId === activePlayerId || (p.playerState & 0x100) !== 0 || homeIds.has(p.playerId) !== playingIsHome) return false;
    const base = p.playerState & 0xff;
    if (base !== 1 && !(base === 3 && !input.recoveringPlayers.includes(p.playerId))) return false;
    const c = p.playerCoordinate;
    return !!c && c[0] >= 0 && c[0] <= 25 && c[1] >= 0 && c[1] <= 14;
  }).map((p) => p.playerId);
  return { playingIsHome, sawActiveBit, turnKey, activePlayerId, actedPlayers };
}
