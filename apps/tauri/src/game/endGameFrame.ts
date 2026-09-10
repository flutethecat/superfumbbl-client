import type { GameJson, ServerCommand } from '@fumbbl40k/ffb-protocol';
import type { EndGameDialog, EndGameFrame, EndGameReport } from './endGameHandler';

type EndGameServerCommand = Pick<ServerCommand, 'commandNr'> & {
  reportList?: { reports?: readonly Record<string, unknown>[] };
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).filter(Boolean) : [];

const numbers = (value: unknown): number[] =>
  Array.isArray(value) ? value.map(Number) : [];

const booleans = (value: unknown): boolean[] =>
  Array.isArray(value) ? value.map(Boolean) : [];

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function adaptDialog(game: GameJson): EndGameDialog | null {
  const raw = game.dialogParameter as Record<string, unknown> | null;
  if (!raw?.dialogId) return null;

  return {
    id: String(raw.dialogId),
    ...(raw.teamId != null ? { teamId: String(raw.teamId) } : {}),
    ...(raw.playerChoiceMode != null ? { playerChoiceMode: String(raw.playerChoiceMode) } : {}),
    ...(Array.isArray(raw.playerIds) ? { playerIds: strings(raw.playerIds) } : {}),
    ...(raw.minSelects != null ? { minSelects: Number(raw.minSelects) } : {}),
    ...(raw.maxSelects != null ? { maxSelects: Number(raw.maxSelects) } : {}),
    payload: raw,
  };
}

function adaptReport(raw: Record<string, unknown>): EndGameReport | null {
  switch (String(raw.reportId ?? '')) {
    case 'playerEvent':
      return {
        kind: 'playerEvent',
        playerId: String(raw.playerId ?? ''),
        text: String(raw.message ?? ''),
      };
    case 'penaltyShootout':
      return { kind: 'penaltyShootout', payload: raw };
    case 'mostValuablePlayers':
      return {
        kind: 'mostValuablePlayers',
        homeIds: strings(raw.playerIdsHome),
        awayIds: strings(raw.playerIdsAway),
      };
    case 'winnings':
      return {
        kind: 'winnings',
        home: Number(raw.winningsHome ?? 0),
        away: Number(raw.winningsAway ?? 0),
      };
    case 'dedicatedFans':
      return { kind: 'dedicatedFans', payload: raw };
    case 'defectingPlayers':
      return {
        kind: 'defectingPlayers',
        playerIds: strings(raw.playerIds),
        rolls: numbers(raw.rolls ?? raw.rollArray),
        defecting: booleans(raw.defectingArray),
      };
    default:
      return null;
  }
}

/**
 * Reconstruct report-backed EndGame facts that survive in a full GameJson snapshot.
 * Only non-default snapshot facts are usable as phase evidence because GameJson also
 * serializes zero-valued pre-EndGame defaults. This lets a mid-sequence join recover
 * public phase state without promoting an ambiguous snapshot.
 */
function modelFactReports(game: GameJson, already: readonly EndGameReport[]): EndGameReport[] {
  const home = game.gameResult.teamResultHome as Record<string, unknown>;
  const away = game.gameResult.teamResultAway as Record<string, unknown>;
  const result: EndGameReport[] = [];
  const kinds = new Set(already.map((report) => report.kind));

  if (!kinds.has('mostValuablePlayers')) {
    const awarded = (teamResult: Record<string, unknown>): string[] => {
      const playerResults = Array.isArray(teamResult.playerResults)
        ? teamResult.playerResults as Record<string, unknown>[]
        : [];
      return playerResults
        .filter((player) => Number(player.playerAwards ?? 0) > 0)
        .map((player) => String(player.playerId ?? ''))
        .filter(Boolean);
    };
    const homeIds = awarded(home);
    const awayIds = awarded(away);
    if (homeIds.length || awayIds.length) result.push({ kind: 'mostValuablePlayers', homeIds, awayIds });
  }

  const winningsHome = Number(home.winnings ?? 0);
  const winningsAway = Number(away.winnings ?? 0);
  if (!kinds.has('winnings') && hasOwn(home, 'winnings') && hasOwn(away, 'winnings')
      && (winningsHome !== 0 || winningsAway !== 0)) {
    result.push({ kind: 'winnings', home: winningsHome, away: winningsAway });
  }

  const dedicatedFansHome = Number(home.dedicatedFans ?? 0);
  const dedicatedFansAway = Number(away.dedicatedFans ?? 0);
  if (!kinds.has('dedicatedFans')
      && (hasOwn(home, 'dedicatedFans') || hasOwn(away, 'dedicatedFans'))
      && (dedicatedFansHome !== 0 || dedicatedFansAway !== 0)) {
    result.push({
      kind: 'dedicatedFans',
      payload: {
        dedicatedFansModifierHome: dedicatedFansHome,
        dedicatedFansModifierAway: dedicatedFansAway,
      },
    });
  }

  return result;
}

/** Pure GameJson/ServerCommand -> ordered EndGame frame adapter. */
export function endGameFrameFromServer(game: GameJson, command?: EndGameServerCommand): EndGameFrame {
  const dialog = adaptDialog(game);
  // GameJson models the authoritative finished fact as its server timestamp.
  const finishedValue = (game as unknown as { finished?: unknown }).finished;
  const finished = finishedValue === true || (typeof finishedValue === 'string' && finishedValue.length > 0);
  const active = game.turnMode === 'endGame' || finished || dialog?.id === 'gameStatistics';
  const wireReports = active
    ? (command?.reportList?.reports ?? []).map(adaptReport).filter((report): report is EndGameReport => report != null)
    : [];
  const reports = active ? [...wireReports, ...modelFactReports(game, wireReports)] : [];
  const commandNr = Number(command?.commandNr ?? 0);

  return {
    gameId: String(game.gameId),
    commandNr: Number.isFinite(commandNr) ? commandNr : 0,
    turnMode: game.turnMode,
    finished,
    dialog,
    reports,
  };
}
