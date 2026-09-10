export interface ForkGameResponse {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  homeCoach: string;
  awayCoach: string;
  half: number;
  turn: number;
  started: string;
}

export interface ForkGameRow {
  gameId: number;
  homeTeam: string;
  awayTeam: string;
  homeCoach: string;
  awayCoach: string;
  half: number;
  turn: number;
  started: string;
}

export function deriveForkGameRows(payload: unknown): ForkGameRow[] {
  if (!Array.isArray(payload)) throw new Error('Invalid live-games response.');
  return payload.map((game, index) => {
    if (!game || typeof game !== 'object') throw new Error(`Invalid live game at row ${index + 1}.`);
    const value = game as Partial<ForkGameResponse>;
    const gameId = Number(value.gameId);
    if (!value.gameId || !Number.isSafeInteger(gameId)) {
      throw new Error(`Invalid game id at row ${index + 1}.`);
    }
    return {
      gameId,
      homeTeam: String(value.homeTeam ?? ''),
      awayTeam: String(value.awayTeam ?? ''),
      homeCoach: String(value.homeCoach ?? ''),
      awayCoach: String(value.awayCoach ?? ''),
      half: Number(value.half ?? 0),
      turn: Number(value.turn ?? 0),
      started: String(value.started ?? ''),
    };
  });
}

export function routeForkSpectate(
  gameId: number,
  applyTarget: (target: string) => void,
  emitSpectate: (id: number) => void,
): void {
  applyTarget('fork');
  emitSpectate(gameId);
}
