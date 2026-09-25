import type { TeamSide } from './teamSide';
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { projectKickScatterPreview, type KickScatterPreview } from './kickElection';
import { kickoffArcNeedsDecisionDwell } from './kickoffArcDwell';
import { kickoffBannerPalette, kickoffOutcome, type KickoffBannerPalette, type KickoffOutcome } from './kickoffMiniPhases';
import { playerName } from './reportFormatter';
import { PRAYER_TABLE, prayerForPlayerEventMessage } from './prayerCatalog';

export interface KickoffWeatherContext {
  kickingSide: TeamSide | null;
  pendingWinner: { result: string; roll: number[] } | null;
  weatherMageRoll: number[] | null;
  pendingPrayerEffects: { roll: number; team: string }[];
}

export const createKickoffWeatherContext = (
  snapshot?: Pick<GameJson, 'turnMode' | 'homePlaying'> | null,
): KickoffWeatherContext => ({
  kickingSide: snapshot?.turnMode === 'setup' ? (snapshot.homePlaying ? 'home' : 'away') : null,
  pendingWinner: null,
  weatherMageRoll: null,
  pendingPrayerEffects: [],
});

export interface FanFactorPresentationRoll { fans: number; roll: number; total: number }
export type PregamePresentationCue =
  | { kind: 'fanFactor'; home: FanFactorPresentationRoll; away: FanFactorPresentationRoll }
  | { kind: 'coin'; result: 'heads' | 'tails'; coach: string; won: boolean; called: 'heads' | 'tails' }
  | { kind: 'masterChef'; team: string; stolen: number; rolls: number[] }
  | { kind: 'riotousRookies'; coach: string; amount: number; rolls: number[] }
  | { kind: 'prayer'; roll: number; name: string; icon: string; team: string; text: string; lines: string[]; playerId?: string }
  | { kind: 'rockMiss'; playerId: string; square: [number, number] };

export interface KickoffWeatherPresentation {
  context: KickoffWeatherContext;
  scatterPreview: KickScatterPreview | null;
  kickoff: { result: string; roll: number[]; palette: KickoffBannerPalette; outcome: KickoffOutcome | null; decisionDwell: boolean } | null;
  weather: { roll: number[]; weather: string; source: 'weather' | 'weatherMage' }[];
  weatherMageUse: { side: 'home' | 'away'; coach: string; logo: string | null } | null;
  dodgySnack: { rollHome: number; rollAway: number; players: string[]; sentOff: string[] } | null;
  victims: { kind: 'officiousRef' | 'pitchInvasion'; victimIds: string[] } | null;
  /** Invocation order for non-kickoff/weather pregame families. */
  pregame: PregamePresentationCue[];
  scatterError: string | null;
}

const normalized = (value: unknown): string => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const numbers = (value: unknown): number[] => Array.isArray(value)
  ? value.map(Number).filter(Number.isFinite) : [];

/**
 * Project the kickoff/weather reports whose presentation can span command boundaries.
 * Keep the returned context with the checkpoint/cursor so a direct seek can resume it.
 */
export function kickoffWeatherPresentation(
  previous: Readonly<KickoffWeatherContext>,
  reports: readonly Record<string, unknown>[],
  game: GameJson,
  previousGame?: Pick<GameJson, 'turnMode' | 'homePlaying'> | null,
): KickoffWeatherPresentation {
  const context: KickoffWeatherContext = {
    kickingSide: previous.kickingSide,
    pendingWinner: previous.pendingWinner ? { result: previous.pendingWinner.result, roll: [...previous.pendingWinner.roll] } : null,
    weatherMageRoll: previous.weatherMageRoll ? [...previous.weatherMageRoll] : null,
    pendingPrayerEffects: previous.pendingPrayerEffects.map((pending) => ({ ...pending })),
  };
  const setupGame = previousGame?.turnMode === 'setup' ? previousGame : game.turnMode === 'setup' ? game : null;
  if (setupGame) context.kickingSide = setupGame.homePlaying ? 'home' : 'away';

  let scatterPreview: KickScatterPreview | null = null;
  let scatterError: string | null = null;
  let kickoffReport: { result: string; roll: number[] } | null = null;
  const weather: KickoffWeatherPresentation['weather'] = [];
  let weatherMageUse: KickoffWeatherPresentation['weatherMageUse'] = null;
  let dodgySnack: KickoffWeatherPresentation['dodgySnack'] = null;
  let officiousRef: string[] | null = null;
  let pitchInvasion: string[] | null = null;
  const sentOff: string[] = [];
  const fanRolls = new Map<'home' | 'away', FanFactorPresentationRoll>();
  const pregame: PregamePresentationCue[] = [];
  const prayerRolls: { roll: number; team: string }[] = [];
  const playerEvents: { playerId: string; message: string }[] = [];
  const prayerWasted: string[] = [];
  const throwAtPlayers: { playerId: string; roll: number; successful: boolean }[] = [];

  for (const report of reports) {
    const id = String(report.reportId);
    if (id === 'kickoffScatter') {
      try { scatterPreview = projectKickScatterPreview(report); }
      catch (error) { scatterError = String(error); }
    }
    else if (id === 'kickoffResult') kickoffReport = {
      result: String(report.kickoffResult ?? ''), roll: numbers(report.kickoffRoll),
    };
    else if (id === 'weather') weather.push({ roll: numbers(report.weatherRoll), weather: String(report.weather ?? ''), source: 'weather' });
    else if (id === 'weatherMageRoll') context.weatherMageRoll = numbers(report.weatherRoll);
    else if (id === 'weatherMageResult') {
      weather.push({ roll: context.weatherMageRoll ?? [], weather: String(report.weather ?? ''), source: 'weatherMage' });
      const side: 'home' | 'away' = game.homePlaying ? 'home' : 'away';
      const team = side === 'home' ? game.teamHome : game.teamAway;
      weatherMageUse = { side, coach: String(team.coach ?? 'Coach'),
        logo: (team.roster as { logoUrl?: string } | undefined)?.logoUrl ?? null };
      context.weatherMageRoll = null;
    } else if (id === 'kickoffDodgySnack') {
      const players = Array.isArray(report.playerIds) ? report.playerIds.map(String) : [];
      dodgySnack = {
        rollHome: Number(report.rollHome ?? 0), rollAway: Number(report.rollAway ?? 0),
        players: players.map((playerId) => playerName(game, playerId)), sentOff,
      };
    } else if (id === 'dodgySnackRoll' && Number(report.roll) === 1 && typeof report.playerId === 'string') {
      sentOff.push(playerName(game, report.playerId));
    } else if (id === 'kickoffOfficiousRef') {
      officiousRef = Array.isArray(report.playerIdsHit) ? report.playerIdsHit.map(String) : [];
    } else if (id === 'kickoffPitchInvasion') {
      pitchInvasion = Array.isArray(report.playerIds) ? report.playerIds.map(String) : [];
    } else if (id === 'fanFactor') {
      const side: 'home' | 'away' = String(report.teamId ?? '') === game.teamHome.teamId ? 'home' : 'away';
      const fans = Number(report.dedicatedFans ?? 0);
      const roll = Number(report.dedicatedFansRoll ?? 0);
      fanRolls.set(side, { fans, roll,
        total: report.dedicatedFansResult == null ? fans + roll : Number(report.dedicatedFansResult) });
    } else if (id === 'coinThrow') {
      const heads = !!report.coinThrowHeads;
      pregame.push({ kind: 'coin', result: heads ? 'heads' : 'tails', coach: String(report.coach ?? ''),
        won: report.coinThrowHeads === report.coinChoiceHeads, called: report.coinChoiceHeads ? 'heads' : 'tails' });
    } else if (id === 'masterChefRoll') {
      const stolen = Number(report.reRollsStolen ?? 0);
      if (stolen > 0) {
        const team = String(report.teamId ?? '') === game.teamHome.teamId ? game.teamHome : game.teamAway;
        pregame.push({ kind: 'masterChef', team: String(team.teamName ?? ''), stolen, rolls: numbers(report.masterChefRoll) });
      }
    } else if (id === 'riotousRookies') {
      const amount = Number(report.riotousAmount ?? 0);
      if (amount > 0) {
        const team = String(report.teamId ?? '') === game.teamHome.teamId ? game.teamHome : game.teamAway;
        pregame.push({ kind: 'riotousRookies', coach: String(team.coach ?? ''), amount, rolls: numbers(report.riotousRoll) });
      }
    } else if (id === 'prayerRoll') {
      const roll = Number(report.roll);
      if (Number.isInteger(roll) && roll >= 1 && roll <= 16) prayerRolls.push({ roll, team: String(report.teamName ?? '') });
    } else if (id === 'playerEvent') {
      const playerId = String(report.playerId ?? '');
      const message = String(report.message ?? '').trim();
      if (playerId && message) playerEvents.push({ playerId, message });
    } else if (id === 'prayerWasted') {
      const name = String(report.prayer ?? report.name ?? '').trim();
      if (name) prayerWasted.push(name);
    } else if (id === 'throwAtPlayer') {
      const playerId = String(report.playerId ?? '');
      const roll = Number(report.roll);
      if (playerId && Number.isInteger(roll)) throwAtPlayers.push({ playerId, roll, successful: report.successful === true });
    }
  }
  if (dodgySnack) dodgySnack.sentOff = [...sentOff];
  const homeFans = fanRolls.get('home');
  const awayFans = fanRolls.get('away');
  if (homeFans && awayFans) pregame.unshift({ kind: 'fanFactor', home: homeFans, away: awayFans });

  for (const prayer of prayerRolls) {
    const entry = PRAYER_TABLE[prayer.roll - 1];
    if (!entry) continue;
    pregame.push({ kind: 'prayer', roll: entry.roll, name: entry.name, icon: entry.icon, team: prayer.team,
      text: entry.text(prayer.team), lines: [] });
    if (entry.playerEventMessage || entry.deferredEffect) context.pendingPrayerEffects.push({ roll: entry.roll, team: prayer.team });
    else if (!entry.laterInvocation) pregame.push({ kind: 'prayer', roll: entry.roll, name: entry.name,
      icon: entry.icon, team: prayer.team, text: `${entry.name} takes effect`, lines: [entry.effect] });
  }
  for (const event of playerEvents) {
    const entry = prayerForPlayerEventMessage(event.message)
      ?? (event.message.startsWith('gains ') && context.pendingPrayerEffects.some((pending) => pending.roll === 16)
        ? PRAYER_TABLE[15] ?? null : null);
    if (!entry) continue;
    const pendingIndex = context.pendingPrayerEffects.findIndex((pending) => pending.roll === entry.roll);
    if (pendingIndex < 0) continue;
    const pending = context.pendingPrayerEffects.splice(pendingIndex, 1)[0]!;
    pregame.push({ kind: 'prayer', roll: entry.roll, name: entry.name, icon: entry.icon, team: pending.team,
      text: `${pending.team}'s ${entry.name} takes effect`, lines: [`${playerName(game, event.playerId)} ${event.message}`],
      ...(entry.roll === 16 ? { playerId: event.playerId } : {}) });
  }
  for (const wasted of prayerWasted) {
    const entry = PRAYER_TABLE.find((candidate) => normalized(candidate.name) === normalized(wasted));
    if (!entry) continue;
    const pendingIndex = context.pendingPrayerEffects.findIndex((pending) => pending.roll === entry.roll);
    if (pendingIndex < 0) continue;
    const pending = context.pendingPrayerEffects.splice(pendingIndex, 1)[0]!;
    pregame.push({ kind: 'prayer', roll: entry.roll, name: entry.name, icon: entry.icon, team: pending.team,
      text: `${entry.name} is wasted`, lines: ['No eligible recipient was available.'] });
  }
  for (const result of throwAtPlayers) {
    const entry = PRAYER_TABLE[13]!;
    const targetIsHome = game.teamHome.playerArray.some((player) => player.playerId === result.playerId);
    const prayerTeam = targetIsHome ? game.teamAway : game.teamHome;
    const team = String(prayerTeam.teamName ?? prayerTeam.coach ?? '');
    pregame.push({ kind: 'prayer', roll: entry.roll, name: entry.name, icon: entry.icon, team,
      text: `${entry.name} targets ${playerName(game, result.playerId)}`,
      lines: [`Rolled ${result.roll} — ${result.successful ? 'hit' : 'miss'}.`] });
    const target = game.fieldModel.playerDataArray.find((player) => player.playerId === result.playerId)?.playerCoordinate;
    if (!result.successful && target && target[0] >= 0 && target[0] < 26 && target[1] >= 0 && target[1] < 15) {
      pregame.push({ kind: 'rockMiss', playerId: result.playerId, square: [target[0], target[1]] });
    }
  }

  if (kickoffReport) {
    const key = normalized(kickoffReport.result);
    if (key === 'brilliantcoaching' || key === 'cheeringfans') {
      const palette = kickoffBannerPalette(kickoffReport.result, [...reports], game, context.kickingSide);
      if (palette) context.pendingWinner = null;
      else {
        context.pendingWinner = kickoffReport;
        kickoffReport = null;
      }
    } else context.pendingWinner = null;
  } else if (context.pendingWinner) {
    const palette = kickoffBannerPalette(context.pendingWinner.result, [...reports], game, context.kickingSide);
    if (palette) {
      kickoffReport = context.pendingWinner;
      context.pendingWinner = null;
    }
  }

  const kickoffPalette = kickoffReport ? kickoffBannerPalette(kickoffReport.result, [...reports], game, context.kickingSide) : null;
  const kickoff = kickoffReport ? {
    result: kickoffReport.result,
    roll: [...kickoffReport.roll],
    palette: kickoffPalette,
    outcome: kickoffOutcome(kickoffReport.result, kickoffPalette, [...reports], game),
    decisionDwell: kickoffArcNeedsDecisionDwell(kickoffReport.result),
  } : null;
  const victims = officiousRef?.length ? { kind: 'officiousRef' as const, victimIds: officiousRef }
    : pitchInvasion?.length ? { kind: 'pitchInvasion' as const, victimIds: pitchInvasion } : null;
  const order: Record<PregamePresentationCue['kind'], number> = {
    fanFactor: 0, coin: 1, masterChef: 2, prayer: 3, rockMiss: 4, riotousRookies: 5,
  };
  pregame.sort((left, right) => order[left.kind] - order[right.kind]);

  return { context, scatterPreview, kickoff, weather, weatherMageUse, dodgySnack, victims, pregame, scatterError };
}
