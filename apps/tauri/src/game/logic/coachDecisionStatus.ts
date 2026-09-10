import type { GameJson } from '@fumbbl40k/ffb-protocol';

export type CoachSide = 'home' | 'away';

type DecisionDialog = {
  choosingTeamId?: unknown;
  teamId?: unknown;
  playerId?: unknown;
  playerIds?: unknown;
};

function teamSide(game: GameJson, teamId: unknown): CoachSide | null {
  if (typeof teamId !== 'string' || teamId.length === 0) return null;
  if (String(game.teamHome.teamId) === teamId) return 'home';
  if (String(game.teamAway.teamId) === teamId) return 'away';
  return null;
}

function playerSide(game: GameJson, playerId: unknown): CoachSide | null {
  if (typeof playerId !== 'string' || playerId.length === 0) return null;
  if (game.teamHome.playerArray.some((player) => player.playerId === playerId)) return 'home';
  if (game.teamAway.playerArray.some((player) => player.playerId === playerId)) return 'away';
  return null;
}

/**
 * Resolve the coach currently holding a live server decision.
 *
 * `waitingForOpponent` supplies the lifetime. Dialog ownership is resolved from
 * the server's team/player keys; only ownerless legacy dialogs fall back to the
 * currently acting side.
 */
export function decidingCoachSide(game: GameJson | null | undefined): CoachSide | null {
  const dialog = game?.dialogParameter as DecisionDialog | null | undefined;
  if (!game || !dialog || !(game as { waitingForOpponent?: unknown }).waitingForOpponent) return null;

  const explicitTeam = teamSide(game, dialog.choosingTeamId) ?? teamSide(game, dialog.teamId);
  if (explicitTeam) return explicitTeam;

  const explicitPlayer = playerSide(game, dialog.playerId);
  if (explicitPlayer) return explicitPlayer;

  if (Array.isArray(dialog.playerIds)) {
    for (const playerId of dialog.playerIds) {
      const side = playerSide(game, playerId);
      if (side) return side;
    }
  }

  return game.homePlaying ? 'home' : 'away';
}

/** Public copy for a player-owned reactive skill decision. The coach name is
 * resolved from the same player ownership used by the decision-side badge. */
export function reactiveSkillDecisionText(
  game: GameJson | null | undefined,
  playerId: string,
  skill: string,
): string {
  const side = game ? playerSide(game, playerId) : null;
  const team = side === 'home' ? game?.teamHome : side === 'away' ? game?.teamAway : null;
  const coach = String(team?.coach ?? team?.teamName ?? 'Opponent').trim() || 'Opponent';
  const skillName = skill.trim() || 'this skill';
  return `${coach} is deciding whether to use ${skillName}`;
}
