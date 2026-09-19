import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { interceptors } from '@fumbbl40k/ffb-pitch';
import { actionRollFor, type ActionRollProjection } from './actionRollProjection';
import { PRAYER_TABLE, type PrayerCatalogEntry } from './prayerCatalog';
import { dialogInstanceKey } from './logic/dialogDispatch';
import { prettySkillName } from './logic/prettySkillName';
import { projectOnTheBallWaiting } from './onTheBallController';
import type { SpectatorCheckpoint } from './replay/spectatorCheckpoint';
const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const PRAYER_PLAYER_CHOICE_MODES = new Set(['ironman', 'knuckledusters']);
const rulesVersionOf = (g: GameJson): string => normKey(String(
  g.gameOptions?.gameOptionArray?.find((option) => option.gameOptionId === 'rulesVersion')?.gameOptionValue ?? '',
));
export const isPrayerPlayerChoiceMode = (mode: unknown, g: GameJson) => {
  const key = normKey(String(mode ?? ''));
  // BB2025 Blessing is random. The similarly-named BB2020 prayer is coach-selected and still uses this mode.
  return PRAYER_PLAYER_CHOICE_MODES.has(key) || (key === 'blessedstatueofnuffle' && rulesVersionOf(g) !== 'bb2025');
};
export const isIntensiveTrainingMode = (mode: unknown) => normKey(String(mode ?? '')) === 'intensivetraining';
export type InteractivePrayerDialog = {
  kind: 'player' | 'skill';
  instanceKey: string;
  ownerTeamId: string;
  coach: string;
  team: string;
  entry: PrayerCatalogEntry | null;
};

export function interactivePrayerDialog(g: GameJson): InteractivePrayerDialog | null {
  const dp = g.dialogParameter as {
    dialogId?: string; teamId?: string; playerId?: string;
    playerChoiceMode?: string; skillChoiceMode?: string;
  } | null;
  const playerMode = dp?.dialogId === 'playerChoice' && isPrayerPlayerChoiceMode(dp.playerChoiceMode, g);
  const skillMode = dp?.dialogId === 'selectSkill' && isIntensiveTrainingMode(dp.skillChoiceMode);
  if (!playerMode && !skillMode) return null;
  const ownerTeam = playerMode
    ? [g.teamHome, g.teamAway].find((team) => team.teamId === dp!.teamId)
    : [g.teamHome, g.teamAway].find((team) => team.playerArray.some((player) => player.playerId === dp!.playerId));
  if (!ownerTeam?.teamId) return null;
  const modeKey = normKey(String(dp?.playerChoiceMode ?? ''));
  const entry = skillMode ? PRAYER_TABLE[15] ?? null
    : modeKey === 'ironman' ? PRAYER_TABLE[3] ?? null
      : modeKey === 'knuckledusters' ? PRAYER_TABLE[4] ?? null
        : null;
  const instanceKey = dialogInstanceKey(g)
    ?? `${dp!.dialogId}|${dp!.teamId ?? ''}|${dp!.playerId ?? ''}|${dp!.playerChoiceMode ?? dp!.skillChoiceMode ?? ''}`;
  return {
    kind: playerMode ? 'player' : 'skill',
    instanceKey,
    ownerTeamId: ownerTeam.teamId,
    coach: ownerTeam.coach || ownerTeam.teamName || 'The opposing coach',
    team: ownerTeam.teamName || ownerTeam.coach || 'Team',
    entry,
  };
}

export function passDestinationFromGame(
  g: GameJson | null,
): { square: [number, number]; kind: 'ball' | 'bomb' | 'stunty' } | null {
  if (!g) return null;
  const square = g.passCoordinate;
  if (!Array.isArray(square) || square.length < 2) return null;
  const x = square[0];
  const y = square[1];
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= 26 || y < 0 || y >= 15) return null;
  const actions = [
    String((g as { throwerAction?: unknown }).throwerAction ?? ''),
    String((g.actingPlayer as { playerAction?: unknown } | undefined)?.playerAction ?? ''),
  ].map((action) => action.toLowerCase().replace(/[^a-z]/g, ''));
  const kind = actions.some((action) => action.includes('bomb'))
    ? 'bomb'
    : actions.some((action) => action === 'swoop' || action.includes('throwteammate') || action.includes('kickteammate'))
      ? 'stunty'
      : 'ball';
  return { square: [x, y], kind };
}

export function penaltyShootoutPresentation(g: GameJson, payload: Readonly<Record<string, unknown>>) {
  const nums = (value: unknown) => Array.isArray(value) ? value.map(Number) : [];
  const homeRolls = nums(payload.rollsHome);
  const awayRolls = nums(payload.rollsAway);
  const wins = Array.isArray(payload.penaltyWins) ? payload.penaltyWins.map(Boolean) : [];
  const labels = Array.isArray(payload.descriptions) ? payload.descriptions.map(String) : [];
  return {
    rounds: homeRolls.map((home, index) => ({
      home,
      away: awayRolls[index] ?? 0,
      homeWon: !!wins[index],
      label: labels[index] ?? String(index + 1),
    })),
    scoreHome: Number(payload.penaltyScoreHome ?? 0),
    scoreAway: Number(payload.penaltyScoreAway ?? 0),
    homeWins: !!payload.homeTeam,
    homeName: g.teamHome?.teamName ?? 'Home',
    awayName: g.teamAway?.teamName ?? 'Away',
  };
}

export function concedeNoticeFromGame(g: GameJson): { teamName: string; coach: string; side: 'home' | 'away' } | null {
  const gr = g.gameResult as { teamResultHome?: { conceded?: boolean }; teamResultAway?: { conceded?: boolean } } | undefined;
  const side = gr?.teamResultHome?.conceded ? 'home' : gr?.teamResultAway?.conceded ? 'away' : null;
  if (!side) return null;
  const team = side === 'home' ? g.teamHome : g.teamAway;
  return { teamName: team.teamName ?? '', coach: team.coach ?? '', side };
}

export function interceptionWaitFromGame(g: GameJson, rolls: ActionRollProjection, ownedPlayerIds: ReadonlySet<string> = new Set()) {
  const dialog = g.dialogParameter as Record<string, unknown> | null;
  if (dialog?.dialogId !== 'interception') return null;
  const throwerId = String(dialog.throwerId ?? (g as { throwerId?: string | null }).throwerId ?? '');
  const target = g.passCoordinate as [number, number] | null;
  const from = g.fieldModel.playerDataArray.find((d) => d.playerId === throwerId)?.playerCoordinate;
  if (!throwerId || !from || !target) return null;
  const candidates = interceptors(g, throwerId, from, target);
  if (candidates.some((c) => ownedPlayerIds.has(c.playerId))) return null;
  // Owner 09-15: the viewer (passer's coach, spectators) sees WHO may intercept — the same candidate set the
  // chooser is offered (upstream UtilServerCatchScatterThrowIn / interceptors(): every opponent within 1.5 squares
  // of the pass line who may catch), with the interference roll each would need.
  return {
    throwerId, target: [...target] as [number, number], passRoll: actionRollFor(rolls, throwerId)?.pass ?? null,
    candidates: candidates.map((c) => ({ playerId: c.playerId, square: [c.square[0], c.square[1]] as [number, number], roll: c.roll })),
  };
}

/** A playerChoice dialog serialises PLAYER_IDS (no singular playerId): the shadower is the first entry — the same
 *  fallback the live applier uses (store: dp.playerId ?? dp.playerIds[0]). */
function shadowingPlayerId(dialog: Record<string, unknown> | null): string | null {
  if (!dialog) return null;
  if (typeof dialog.playerId === 'string' && dialog.playerId) return dialog.playerId;
  const ids = dialog.playerIds;
  return Array.isArray(ids) && typeof ids[0] === 'string' && ids[0] ? ids[0] : null;
}
/** Closed passive content projection. All inputs belong to one checkpoint; no live
 * caches, player capabilities, animation counters or dismissal state are consulted. */
export function passiveSpectatorProjection(checkpoint: SpectatorCheckpoint) {
  const g = checkpoint.model;
  const p = checkpoint.durableProjection;
  const dialog = g.dialogParameter as Record<string, unknown> | null;
  const offered = p.pendingDecision?.state === 'offered';
  const prayer = offered ? interactivePrayerDialog(g) : null;
  const usingCard = p.skillDecision.current?.using ? p.skillDecision.current : null;
  const skill = offered && dialog?.dialogId === 'skillUse' ? {
    playerId: String(dialog.playerId ?? ''), skill: String(dialog.skill ?? ''),
    label: prettySkillName(String(dialog.skill ?? '')), minimumRoll: Number(dialog.minimumRoll ?? 0),
    ...(p.skillDecision.current?.details ?? {}),
  } : usingCard ? { // owner 09-15: "<Coach> is using <Skill>" while the follow-up choice (push square) is open
    playerId: usingCard.playerId, skill: usingCard.skill, label: prettySkillName(usingCard.skill), minimumRoll: 0, using: true,
  } : null;
  const shadowTeam = offered && dialog?.dialogId === 'playerChoice' && dialog.playerChoiceMode === 'shadowing'
    ? [g.teamHome, g.teamAway].find((team) => team.teamId === dialog.teamId) : null;
  const followupTeam = offered && dialog?.dialogId === 'followupChoice'
    ? [g.teamHome, g.teamAway].find((team) => team.playerArray.some((player) => player.playerId === g.actingPlayer?.playerId)) : null;
  const followupWaiting = offered && dialog?.dialogId === 'followupChoice'
    ? (followupTeam?.coach || followupTeam?.teamName || 'The blocking coach') + ' is deciding whether to follow up' : null;
  return {
    passDestination: passDestinationFromGame(g),
    interceptWait: offered ? interceptionWaitFromGame(g, p.actionRolls) : null,
    prayerChoiceWait: prayer ? { coach: prayer.coach, instanceKey: prayer.instanceKey } : null,
    skillChoice: skill,
    opponentReviewingDice: !!(g as Record<string, unknown>).waitingForOpponent && !!p.blockCard && !!dialog?.choosingTeamId,
    opponentChoicePending: shadowTeam ? (shadowTeam.coach || shadowTeam.teamName || 'Opponent') + ' is deciding to shadow' : followupWaiting,
    // Owner 09-14: the pending pill parks at this player's token (the blocker for a follow-up decision, the named
    // shadower for Shadowing); without it the review-to-live HUD fell back to the top-centre band.
    opponentChoicePendingPlayerId: shadowTeam ? shadowingPlayerId(dialog)
      : followupWaiting ? String(g.actingPlayer?.playerId ?? '') || null : null,
    // Existing On-the-Ball copy is opponent-player-only; spectators have no owned reaction turn.
    onTheBallWaiting: projectOnTheBallWaiting({ audience: 'spectator', turnMode: String(g.turnMode ?? ''), homePlaying: !!g.homePlaying, teamHome: g.teamHome, teamAway: g.teamAway }),
    penaltyShootout: p.endGame.dialog?.id === 'penaltyShootout' ? penaltyShootoutPresentation(g, p.endGame.dialog.payload ?? {}) : null,
    concedeNotice: concedeNoticeFromGame(g),
    endGameSettled: p.endGame.finalPresentationReady,
  };
}
