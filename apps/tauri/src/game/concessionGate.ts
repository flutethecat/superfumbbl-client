import type { GameJson } from '@fumbbl40k/ffb-protocol';

export interface ConcessionAudience {
  playing: boolean;
  replay: boolean;
  coach: string;
}

type ConcessionGame = Pick<GameJson, 'teamHome' | 'teamAway' | 'homePlaying'> & {
  concessionPossible?: unknown;
};

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/** Strict seat ownership for the general Game Menu concession request. No home-side liveness fallback. */
export function localConcessionSide(
  game: Pick<GameJson, 'teamHome' | 'teamAway'>,
  coach: string,
): 'home' | 'away' | null {
  const wanted = normalized(coach);
  if (!wanted) return null;
  const home = normalized(game.teamHome.coach) === wanted;
  const away = normalized(game.teamAway.coach) === wanted;
  if (home === away) return null;
  return home ? 'home' : 'away';
}

/**
 * Upstream AbstractStep concession admission, projected from the authoritative game model:
 * a live player seat, owning the currently playing team, while concessionPossible is explicitly true.
 * Setup's fewer-than-three-player concession is a separate server-owned path and does not call this gate.
 */
export function generalConcessionAllowed(
  game: ConcessionGame | null | undefined,
  audience: ConcessionAudience,
): boolean {
  if (!game || !audience.playing || audience.replay || game.concessionPossible !== true) return false;
  const side = localConcessionSide(game, audience.coach);
  return side !== null && Boolean(game.homePlaying) === (side === 'home');
}
