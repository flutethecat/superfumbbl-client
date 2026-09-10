import type { GameJson, PlayerJson } from '@fumbbl40k/ffb-protocol';
import { baseState, PlayerStateBase } from './playerState';

export type FormationSquare = [number, number];

/** Home-relative, LOS-first; copied from apps/tauri/src/game/store.ts:4488 (KICKING_SETUP_FORMATION). */
export const PRE_SETUP_FORMATION: readonly { capacity: number; squares: readonly FormationSquare[] }[] = [
  { capacity: 5, squares: [[12, 5], [12, 6], [12, 7], [12, 8], [12, 9]] },
  { capacity: 3, squares: [[11, 4], [11, 7], [11, 10]] },
  { capacity: 3, squares: [[9, 6], [9, 7], [9, 8]] },
];

const SETUP_TURN_MODES = new Set(['setup', 'solidDefence']);

function onPitch(coordinate: readonly number[] | null | undefined): boolean {
  return !!coordinate
    && coordinate[0]! >= 0 && coordinate[0]! <= 25
    && coordinate[1]! >= 0 && coordinate[1]! <= 14;
}

/** Game 834 owner ruling: presentation exists only before the first real setup. */
export function isPreSetupWindow(game: GameJson): boolean {
  const turnMode = game.turnMode ?? '';
  if (game.half !== 0 || game.finished || SETUP_TURN_MODES.has(turnMode)) return false;
  // Board emptiness is authoritative; a deny-list of live turn modes cannot stay correct.
  return !(game.fieldModel?.playerDataArray ?? []).some((data) => onPitch(data.playerCoordinate));
}

function canField(playerState: number): boolean {
  // Same state exclusions as apps/tauri/src/game/store.ts:6039 canFieldInSetup.
  const state = baseState(playerState);
  return state !== PlayerStateBase.KNOCKED_OUT
    && state !== PlayerStateBase.BADLY_HURT
    && state !== PlayerStateBase.SERIOUS_INJURY
    && state !== PlayerStateBase.RIP
    && state !== PlayerStateBase.MISSING
    && state !== PlayerStateBase.BANNED;
}

function orderedPlayers(game: GameJson, players: readonly PlayerJson[]): PlayerJson[] {
  const dataById = new Map(game.fieldModel.playerDataArray.map((data) => [data.playerId, data]));
  return players
    .filter((player) => canField(dataById.get(player.playerId)?.playerState ?? PlayerStateBase.UNKNOWN))
    // Mirror apps/tauri/src/game/store.ts:5809 placeSetup: stars first, then player number.
    .sort((a, b) => Number(b.playerType === 'Star') - Number(a.playerType === 'Star') || a.playerNr - b.playerNr)
    .slice(0, 11);
}

export function preSetupPlacements(game: GameJson): Map<string, FormationSquare> {
  const placements = new Map<string, FormationSquare>();
  if (!isPreSetupWindow(game)) return placements;

  const formation = PRE_SETUP_FORMATION.flatMap((band) => band.squares.slice(0, band.capacity));
  for (const [team, away] of [[game.teamHome, false], [game.teamAway, true]] as const) {
    orderedPlayers(game, team.playerArray).forEach((player, index) => {
      const [x, y] = formation[index]!;
      placements.set(player.playerId, [away ? 25 - x : x, y]);
    });
  }

  // Overflow/unfieldable players receive no synthetic square; existing dugout hit-testing still picks them.
  return placements;
}
