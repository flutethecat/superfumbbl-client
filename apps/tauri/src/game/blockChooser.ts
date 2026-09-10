export type BlockChooserSide = 'home' | 'away';

export interface BlockChooserTeamLike {
  teamId?: unknown;
  coach?: unknown;
  playerArray?: { playerId?: unknown }[];
}

export interface BlockChooserGameLike {
  teamHome?: BlockChooserTeamLike | null;
  teamAway?: BlockChooserTeamLike | null;
  dialogParameter?: { dialogId?: unknown; choosingTeamId?: unknown; playerId?: unknown } | null;
}

function normalizedCoach(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

/** Strict presentation identity: unlike command liveness, this never falls back to Home. */
export function strictBlockPresentationSeat(
  game: BlockChooserGameLike | null | undefined,
  playing: boolean,
  playCoach: unknown,
): BlockChooserSide | null {
  if (!playing) return null;
  const coach = normalizedCoach(playCoach);
  if (!coach) return null;
  const homeMatch = normalizedCoach(game?.teamHome?.coach) === coach;
  const awayMatch = normalizedCoach(game?.teamAway?.coach) === coach;
  return homeMatch === awayMatch ? null : homeMatch ? 'home' : 'away';
}

export interface BlockChooserProjection {
  mine: boolean;
  coachName: string;
  side: BlockChooserSide | null;
  spectator: boolean;
}

const BLOCK_CHOICE_DIALOGS = new Set([
  'blockRoll',
  'blockRollProperties',
  'blockRollPartialReRoll',
]);

function exactTeamId(team: BlockChooserTeamLike | null | undefined): string | null {
  return typeof team?.teamId === 'string' && team.teamId.length > 0 ? team.teamId : null;
}

/**
 * Presentation-only projection of the server-declared block chooser.
 *
 * Unknown/malformed IDs deliberately project to a neutral non-owner. That prevents a stale or
 * guessed attacker/defender relationship from ever producing "Your Choice" for the local coach.
 */
export function projectBlockChooser(
  game: BlockChooserGameLike | null | undefined,
  choosingTeamId: unknown,
  localSeat: BlockChooserSide | null,
  spectator: boolean,
): BlockChooserProjection {
  const chooser = typeof choosingTeamId === 'string' && choosingTeamId.length > 0 ? choosingTeamId : null;
  const homeId = exactTeamId(game?.teamHome);
  const awayId = exactTeamId(game?.teamAway);
  const homeMatch = chooser !== null && homeId !== null && chooser === homeId;
  const awayMatch = chooser !== null && awayId !== null && chooser === awayId;
  const side: BlockChooserSide | null = homeMatch === awayMatch ? null : homeMatch ? 'home' : 'away';
  const team = side === 'home' ? game?.teamHome : side === 'away' ? game?.teamAway : null;
  const coach = typeof team?.coach === 'string' ? team.coach.trim() : '';

  return {
    mine: !spectator && side !== null && localSeat === side,
    coachName: coach || (side === 'home' ? 'Home coach' : side === 'away' ? 'Away coach' : 'A coach'),
    side,
    spectator,
  };
}

export function isCurrentBlockChoiceDialog(game: BlockChooserGameLike | null | undefined): boolean {
  return BLOCK_CHOICE_DIALOGS.has(String(game?.dialogParameter?.dialogId ?? ''));
}

/** Read chooser authority only from the currently-live ordinary/partial block dialog. */
export function currentBlockChoosingTeamId(game: BlockChooserGameLike | null | undefined): string | null {
  const dialog = game?.dialogParameter;
  if (!isCurrentBlockChoiceDialog(game)) return null;
  return typeof dialog?.choosingTeamId === 'string' && dialog.choosingTeamId.length > 0
    ? dialog.choosingTeamId
    : null;
}

export function isCurrentMultiBlockChoiceDialog(game: BlockChooserGameLike | null | undefined): boolean {
  return game?.dialogParameter?.dialogId === 'reRollBlockForTargetsProperties';
}

function uniquePlayerSide(game: BlockChooserGameLike | null | undefined, playerId: unknown): BlockChooserSide | null {
  if (typeof playerId !== 'string' || playerId.length === 0) return null;
  const onHome = !!game?.teamHome?.playerArray?.some((player) => player.playerId === playerId);
  const onAway = !!game?.teamAway?.playerArray?.some((player) => player.playerId === playerId);
  return onHome === onAway ? null : onHome ? 'home' : 'away';
}

/** Current reRollBlockForTargetsProperties is addressed to the blocker for all row re-roll elections. */
export function currentMultiBlockChoosingTeamId(game: BlockChooserGameLike | null | undefined): string | null {
  if (!isCurrentMultiBlockChoiceDialog(game)) return null;
  const blockerSide = uniquePlayerSide(game, game?.dialogParameter?.playerId);
  return blockerSide ? exactTeamId(blockerSide === 'home' ? game?.teamHome : game?.teamAway) : null;
}
