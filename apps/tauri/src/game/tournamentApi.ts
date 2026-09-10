import { botDownloadText, forkApi, type ChallengeRequest, type ForkApi, type ForkTextDownload } from './forkChallenge';

export type TournamentMatchStatus = 'scheduled' | 'launching' | 'launched' | 'launch_failed' | 'dismissed' | 'completed' | 'cancelled';
export type TournamentTiebreaker = 'buchholz' | 'sonnebornBerger' | 'opponentWinPercentage' | 'headToHead' | 'touchdownDifferential' | 'touchdownsFor' | 'casualtyDifferential' | 'casualtiesFor' | 'seed';
export interface TournamentPoints { win: number; draw: number; loss: number; bye: number }

/** Exact config-web tournament entity; entrantCount is added by the active-list alias. */
export interface Tournament {
  id: string; name: string; status: string; format: 'swiss' | 'roundRobin' | 'knockout'; roundCount: number; currentRound: number;
  /** Organizer live-edit contract (tournament-api.md): emitted when present on the record. */
  maxPlayers?: number; startsAt?: string;
  rulesetPackName?: string; stuntyRaceSet?: string[]; lifecycle?: 'active' | 'future' | 'finished' | string;
  tiebreakers: TournamentTiebreaker[]; points: TournamentPoints; createdAt: string; updatedAt: string; entrantCount?: number;
  winnerEntrantId?: string; awards?: Partial<Record<TournamentAwardKey, TournamentAwardRecord>>;
}
export interface TournamentEntrantCoach { coachId: string; ffbCoachId: string }
export interface TournamentEntrant {
  entrantId: string; id: string; tournamentId: string; seed: number; coachId: string; coach: TournamentEntrantCoach;
  teamId: string; teamName?: string; race?: string; logoUrl?: string | null; registeredAt: string; droppedAt?: string | null;
}
export interface TournamentStanding {
  rank: number; entrantId: string; coachId: string; teamId: string; played: number; wins: number; draws: number;
  losses: number; byes: number; points: number; touchdownsFor: number; touchdownsAgainst: number;
  touchdownDifferential: number; casualtiesFor: number; casualtiesAgainst: number; casualtyDifferential: number;
  buchholz: number; sonnebornBerger: number; opponentWinPercentage: number; seed: number;
}
export interface TournamentScheduledMatchRoutes {
  challenge: '/api/fork/challenge'; matchstatus: '/api/fork/matchstatus'; cancel: '/api/fork/cancel'; jnlp: '/api/fork/jnlp';
}
export interface TournamentScheduledMatch {
  matchId: string; round: number; status: TournamentMatchStatus; scheduledAt: string | null; myTeamId?: string;
  opponentTeamId?: string; opponentCoach?: string; opponentTeamName?: string; opponentLogoUrl?: string | null;
  canLaunch: boolean; waiting: boolean; waitingCoachIds: string[]; routeMetadata: TournamentScheduledMatchRoutes;
  revision?: number; home?: TournamentMatchSide; away?: TournamentMatchSide;
}
export interface TournamentMatchSide { entrantId: string; teamId: string; coach: TournamentEntrantCoach }
export interface TournamentDetail {
  tournament: Tournament; entrants: TournamentEntrant[]; rounds: unknown[]; standings: TournamentStanding[];
  /** Empty for public/no-token reads; coach-scoped when a Bearer identity is present. */
  scheduledMatches: TournamentScheduledMatch[];
}
export interface InertCapability { available: false; reason: string }
export interface TeamDetailCapability { available: boolean; reason?: string }
export interface TeamDetailPlayer {
  id: string; number: number; name: string; position: string | null; positionId: string; skills: string[]; injuries: string[];
  spp: number; earnedSpp: number | null; advancements: number; rank: string;
  advancementCosts: { randomPrimary: number; chosenPrimary: number; chosenSecondary: number; characteristic: number } | null;
  advancementMethods: Record<'randomPrimary' | 'chosenPrimary' | 'chosenSecondary' | 'characteristic', TeamDetailCapability>;
  pendingAdvancement: Record<string, unknown> | null; primaryCategories: string[]; secondaryCategories: string[];
  primarySkills: string[]; secondarySkills: string[]; movement: number | null; strength: number | null;
  agility: number | null; passing: number | null; armour: number | null; currentValue: number; mng: boolean; status: string | null;
}
export interface TeamDetail {
  id: string; name: string; race: string; rerolls: number; apothecary: boolean; fanFactor: number;
  assistantCoaches: number; cheerleaders: number; treasury: number; teamValue: number; rulesetPackName: string | null;
  leagues: string[]; specialRules: string[]; canEditRoster: TeamDetailCapability; revision: string; players: TeamDetailPlayer[];
}
export interface TournamentTeamBuild {
  tournamentId: string; entrantId: string; team: TeamDetail; inert: true;
  capabilities: { editRoster: InertCapability; retire: InertCapability; launchUnscheduled: InertCapability };
}
export interface TournamentNextOpponent {
  tournamentId: string; entrantId: string; roundNumber?: number; provisional: boolean; scheduledMatchId?: string;
  opponent: { entrantId: string; coachId: string; teamId: string } | null;
}
export type TournamentCategory = 'active' | 'future' | 'finished';
export type TournamentAwardKey = 'winner' | 'runnerUp' | 'bestDefense' | 'mostTouchdowns' | 'mostBrutal' | 'bestStunty';
export interface TournamentAwardRecord { generatedCandidateEntrantIds: string[]; recipientEntrantIds: string[]; overridden: boolean }
export interface TournamentListPage {
  tournaments: Tournament[]; category: TournamentCategory; page: number; pageSize: number; total: number; hasMore: boolean;
}
export type TournamentApplicationStatus = 'submitted' | 'pending' | 'approved' | 'declined' | 'banned';
export interface TournamentApplication {
  id: string; tournamentId: string; coachId: string; team: { teamId: string }; status: TournamentApplicationStatus;
  revision: number; submittedAt: string; updatedAt: string; feedback?: string;
}
export interface TournamentApplicationValidation { valid: boolean; errors: string[]; warnings: string[]; checkedAt: string }
export interface TournamentApplicationView { application: TournamentApplication; validation: TournamentApplicationValidation }
export interface TournamentAdministration { tournamentId: string; revision: number; ownerCoachIds: string[] }
export interface TournamentAdministrationView { administration: TournamentAdministration; audit: unknown[] }
export type TournamentApplicationAction = 'pending' | 'approve' | 'decline' | 'ban';
export interface TournamentApi {
  /** Organizer/admin: create a draft tournament (mirrors the tournaments.html panel's POST body). */
  createTournament(body: { name: string; packageName: string; maxPlayers: number; format: string; primaryTiebreaker?: string }): Promise<Tournament>;
  /** Organizer live-edit (tournament-api.md): PATCH partial body — maxPlayers (floor = entrants),
   *  format + packageName (locked once rounds exist), startsAt (ISO-8601). Server-authoritative. */
  editTournament(tournamentId: string, body: Partial<{ maxPlayers: number; format: string; packageName: string; startsAt: string; primaryTiebreaker: string }>): Promise<Record<string, unknown>>;
  listActiveTournaments(coach: string): Promise<Tournament[]>;
  listTournaments(category: TournamentCategory, coach: string, options?: { query?: string; page?: number; compactFinished?: boolean }): Promise<TournamentListPage>;
  getTournament(tournamentId: string, coach: string): Promise<TournamentDetail>;
  getNextOpponent(tournamentId: string, coach: string): Promise<TournamentNextOpponent>;
  getTeamBuild(tournamentId: string, entrantId: string, coach: string): Promise<TournamentTeamBuild>;
  getMyApplication(tournamentId: string): Promise<TournamentApplication | null>;
  submitApplication(tournamentId: string, teamId: string, revision?: number): Promise<TournamentApplicationView>;
  getAdministration(tournamentId: string): Promise<TournamentAdministrationView>;
  listApplications(tournamentId: string): Promise<TournamentApplicationView[]>;
  applicationAction(tournamentId: string, coachId: string, action: TournamentApplicationAction, body: Record<string, unknown>): Promise<Record<string, unknown>>;
  adjudicate(tournamentId: string, matchId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
  replaceEntrant(tournamentId: string, entrantId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
  dropEntrant(tournamentId: string, entrantId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
  finishTournament(tournamentId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
  overrideAward(tournamentId: string, award: TournamentAwardKey, body: Record<string, unknown>): Promise<Record<string, unknown>>;
  downloadNaf(tournamentId: string): Promise<ForkTextDownload>;
}

export function scheduledChallengeRequest(match: TournamentScheduledMatch, creds: { coach: string; password: string }): ChallengeRequest {
  if (!match.myTeamId || !match.opponentCoach) throw new Error('This scheduled match is not launchable by the current account.');
  return { coach: creds.coach.trim(), password: creds.password, teamId: match.myTeamId, opponent: match.opponentCoach };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label} response.`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}.`);
  return value;
}
function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : string(value, label);
}
function nullableString(value: unknown, label: string): string | null { return optionalString(value, label) ?? null; }
function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
function optionalNumber(value: unknown, label: string): number | undefined {
  return value === undefined || value === null ? undefined : number(value, label);
}
function nullableNumber(value: unknown, label: string): number | null { return value === null ? null : number(value, label); }
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}.`);
  return value;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
function matchStatus(value: unknown): TournamentMatchStatus {
  if (value === 'scheduled' || value === 'launching' || value === 'launched' || value === 'launch_failed' || value === 'dismissed' || value === 'completed' || value === 'cancelled') return value;
  throw new Error('Invalid scheduledMatch.status.');
}
function tiebreaker(value: unknown): TournamentTiebreaker {
  const code = string(value, 'tournament.tiebreaker') as TournamentTiebreaker;
  if (!['buchholz', 'sonnebornBerger', 'opponentWinPercentage', 'headToHead', 'touchdownDifferential', 'touchdownsFor', 'casualtyDifferential', 'casualtiesFor', 'seed'].includes(code)) throw new Error('Invalid tournament.tiebreaker.');
  return code;
}

export function decodeTournament(value: unknown): Tournament {
  const item = record(value, 'tournament');
  const points = record(item.points, 'tournament.points');
  // Create/edit offer all three formats now (the old swiss-only guard threw on RR/knockout drafts).
  if (item.format !== 'swiss' && item.format !== 'roundRobin' && item.format !== 'knockout') throw new Error('Invalid tournament.format.');
  return {
    id: string(item.id, 'tournament.id'), name: string(item.name, 'tournament.name'),
    status: string(item.status, 'tournament.status'), format: item.format,
    rulesetPackName: optionalString(item.rulesetPackName, 'tournament.rulesetPackName'),
    stuntyRaceSet: item.stuntyRaceSet === undefined ? undefined : array(item.stuntyRaceSet, 'tournament.stuntyRaceSet').map((race) => string(race, 'tournament.stuntyRace')),
    lifecycle: optionalString(item.lifecycle, 'tournament.lifecycle'),
    roundCount: number(item.roundCount, 'tournament.roundCount'), currentRound: number(item.currentRound, 'tournament.currentRound'),
    tiebreakers: array(item.tiebreakers, 'tournament.tiebreakers').map(tiebreaker),
    points: { win: number(points.win, 'tournament.points.win'), draw: number(points.draw, 'tournament.points.draw'), loss: number(points.loss, 'tournament.points.loss'), bye: number(points.bye, 'tournament.points.bye') },
    createdAt: string(item.createdAt, 'tournament.createdAt'), updatedAt: string(item.updatedAt, 'tournament.updatedAt'),
    entrantCount: optionalNumber(item.entrantCount, 'tournament.entrantCount'),
    maxPlayers: optionalNumber(item.maxPlayers, 'tournament.maxPlayers'),
    startsAt: optionalString(item.startsAt, 'tournament.startsAt'),
    winnerEntrantId: optionalString(item.winnerEntrantId, 'tournament.winnerEntrantId'),
    awards: decodeAwards(item.awards),
  };
}

function decodeAwards(value: unknown): Tournament['awards'] {
  if (value === undefined || value === null) return undefined;
  const source = record(value, 'tournament.awards');
  return Object.fromEntries(Object.entries(source).map(([key, raw]) => {
    const award = record(raw, `tournament.awards.${key}`);
    return [key, {
      generatedCandidateEntrantIds: array(award.generatedCandidateEntrantIds ?? [], `tournament.awards.${key}.generatedCandidateEntrantIds`).map((id) => string(id, 'award candidate')),
      recipientEntrantIds: array(award.recipientEntrantIds ?? [], `tournament.awards.${key}.recipientEntrantIds`).map((id) => string(id, 'award recipient')),
      overridden: boolean(award.overridden, `tournament.awards.${key}.overridden`),
    }];
  })) as Tournament['awards'];
}

function decodeEntrant(value: unknown): TournamentEntrant {
  const item = record(value, 'entrant');
  const coach = record(item.coach, 'entrant.coach');
  return {
    entrantId: string(item.entrantId, 'entrant.entrantId'), id: string(item.id, 'entrant.id'),
    tournamentId: string(item.tournamentId, 'entrant.tournamentId'), seed: number(item.seed, 'entrant.seed'),
    coachId: string(item.coachId, 'entrant.coachId'),
    coach: { coachId: string(coach.coachId, 'entrant.coach.coachId'), ffbCoachId: string(coach.ffbCoachId, 'entrant.coach.ffbCoachId') },
    teamId: string(item.teamId, 'entrant.teamId'), teamName: optionalString(item.teamName, 'entrant.teamName'),
    race: optionalString(item.race, 'entrant.race'), logoUrl: nullableString(item.logoUrl, 'entrant.logoUrl'),
    registeredAt: string(item.registeredAt, 'entrant.registeredAt'), droppedAt: nullableString(item.droppedAt, 'entrant.droppedAt'),
  };
}

function decodeStanding(value: unknown): TournamentStanding {
  const item = record(value, 'standing');
  return {
    rank: number(item.rank, 'standing.rank'), entrantId: string(item.entrantId, 'standing.entrantId'),
    coachId: string(item.coachId, 'standing.coachId'), teamId: string(item.teamId, 'standing.teamId'),
    played: number(item.played, 'standing.played'), wins: number(item.wins, 'standing.wins'), draws: number(item.draws, 'standing.draws'),
    losses: number(item.losses, 'standing.losses'), byes: number(item.byes, 'standing.byes'), points: number(item.points, 'standing.points'),
    touchdownsFor: number(item.touchdownsFor, 'standing.touchdownsFor'), touchdownsAgainst: number(item.touchdownsAgainst, 'standing.touchdownsAgainst'),
    touchdownDifferential: number(item.touchdownDifferential, 'standing.touchdownDifferential'),
    casualtiesFor: number(item.casualtiesFor, 'standing.casualtiesFor'), casualtiesAgainst: number(item.casualtiesAgainst, 'standing.casualtiesAgainst'),
    casualtyDifferential: number(item.casualtyDifferential, 'standing.casualtyDifferential'),
    buchholz: number(item.buchholz, 'standing.buchholz'), sonnebornBerger: number(item.sonnebornBerger, 'standing.sonnebornBerger'),
    opponentWinPercentage: number(item.opponentWinPercentage, 'standing.opponentWinPercentage'), seed: number(item.seed, 'standing.seed'),
  };
}

function decodeScheduledMatch(value: unknown): TournamentScheduledMatch {
  const item = record(value, 'scheduledMatch');
  const routes = record(item.routeMetadata, 'scheduledMatch.routeMetadata');
  const routeMetadata = {
    challenge: string(routes.challenge, 'scheduledMatch.routeMetadata.challenge'),
    matchstatus: string(routes.matchstatus, 'scheduledMatch.routeMetadata.matchstatus'),
    cancel: string(routes.cancel, 'scheduledMatch.routeMetadata.cancel'),
    jnlp: string(routes.jnlp, 'scheduledMatch.routeMetadata.jnlp'),
  };
  if (routeMetadata.challenge !== '/api/fork/challenge' || routeMetadata.matchstatus !== '/api/fork/matchstatus'
    || routeMetadata.cancel !== '/api/fork/cancel' || routeMetadata.jnlp !== '/api/fork/jnlp') throw new Error('Unsupported scheduledMatch.routeMetadata.');
  const side = (raw: unknown, label: string): TournamentMatchSide | undefined => {
    if (raw === undefined) return undefined;
    const entry = record(raw, label); const coach = record(entry.coach, `${label}.coach`);
    return { entrantId: string(entry.entrantId, `${label}.entrantId`), teamId: string(entry.teamId, `${label}.teamId`), coach: { coachId: string(coach.coachId, `${label}.coach.coachId`), ffbCoachId: string(coach.ffbCoachId, `${label}.coach.ffbCoachId`) } };
  };
  return {
    matchId: string(item.matchId, 'scheduledMatch.matchId'), round: number(item.round, 'scheduledMatch.round'),
    status: matchStatus(item.status), scheduledAt: nullableString(item.scheduledAt, 'scheduledMatch.scheduledAt'),
    myTeamId: optionalString(item.myTeamId, 'scheduledMatch.myTeamId'), opponentTeamId: optionalString(item.opponentTeamId, 'scheduledMatch.opponentTeamId'),
    opponentCoach: optionalString(item.opponentCoach, 'scheduledMatch.opponentCoach'), opponentTeamName: optionalString(item.opponentTeamName, 'scheduledMatch.opponentTeamName'),
    opponentLogoUrl: nullableString(item.opponentLogoUrl, 'scheduledMatch.opponentLogoUrl'), canLaunch: boolean(item.canLaunch, 'scheduledMatch.canLaunch'),
    waiting: item.waiting === undefined ? false : boolean(item.waiting, 'scheduledMatch.waiting'),
    waitingCoachIds: array(item.waitingCoachIds, 'scheduledMatch.waitingCoachIds').map((id) => string(id, 'scheduledMatch.waitingCoachId')),
    routeMetadata: routeMetadata as TournamentScheduledMatchRoutes,
    revision: optionalNumber(item.revision ?? item.statusRevision, 'scheduledMatch.revision'),
    home: side(item.home, 'scheduledMatch.home'), away: side(item.away, 'scheduledMatch.away'),
  };
}

export function decodeTournamentDetail(value: unknown): TournamentDetail {
  const payload = record(value, 'tournament detail');
  return {
    tournament: decodeTournament(payload.tournament), entrants: array(payload.entrants, 'entrants').map(decodeEntrant),
    rounds: array(payload.rounds, 'rounds'), standings: array(payload.standings, 'standings').map(decodeStanding),
    scheduledMatches: array(payload.scheduledMatches ?? [], 'scheduledMatches').map(decodeScheduledMatch),
  };
}

function unavailableCapability(value: unknown, label: string): InertCapability {
  const item = record(value, label);
  if (item.available !== false) throw new Error(`Invalid ${label}.available.`);
  return { available: false, reason: string(item.reason, `${label}.reason`) };
}
function teamCapability(value: unknown, label: string): TeamDetailCapability {
  const item = record(value, label);
  return { available: boolean(item.available, `${label}.available`), reason: optionalString(item.reason, `${label}.reason`) };
}
function decodeTeamDetail(value: unknown): TeamDetail {
  const team = record(value, 'team build.team');
  return {
    id: string(team.id, 'team build.team.id'), name: string(team.name, 'team build.team.name'), race: string(team.race, 'team build.team.race'),
    rerolls: number(team.rerolls, 'team build.team.rerolls'), apothecary: boolean(team.apothecary, 'team build.team.apothecary'),
    fanFactor: number(team.fanFactor, 'team build.team.fanFactor'), assistantCoaches: number(team.assistantCoaches, 'team build.team.assistantCoaches'),
    cheerleaders: number(team.cheerleaders, 'team build.team.cheerleaders'), treasury: number(team.treasury, 'team build.team.treasury'),
    teamValue: number(team.teamValue, 'team build.team.teamValue'), rulesetPackName: nullableString(team.rulesetPackName, 'team build.team.rulesetPackName'),
    leagues: array(team.leagues, 'team build.team.leagues').map((item) => string(item, 'team build.team.league')),
    specialRules: array(team.specialRules, 'team build.team.specialRules').map((item) => string(item, 'team build.team.specialRule')),
    canEditRoster: teamCapability(team.canEditRoster, 'team build.team.canEditRoster'), revision: string(team.revision, 'team build.team.revision'),
    players: array(team.players, 'team build.team.players').map((raw) => {
      const player = record(raw, 'team build.team.player');
      const costs = player.advancementCosts === null ? null : record(player.advancementCosts, 'team build.team.player.advancementCosts');
      const methods = record(player.advancementMethods, 'team build.team.player.advancementMethods');
      const pending = player.pendingAdvancement === null ? null : record(player.pendingAdvancement, 'team build.team.player.pendingAdvancement');
      return {
        id: string(player.id, 'team build.team.player.id'), number: number(player.number, 'team build.team.player.number'),
        name: string(player.name, 'team build.team.player.name'), position: player.position === null ? null : string(player.position, 'team build.team.player.position'),
        positionId: string(player.positionId, 'team build.team.player.positionId'),
        skills: array(player.skills, 'team build.team.player.skills').map((item) => string(item, 'team build.team.player.skill')),
        injuries: array(player.injuries, 'team build.team.player.injuries').map((item) => string(item, 'team build.team.player.injury')),
        spp: number(player.spp, 'team build.team.player.spp'), earnedSpp: nullableNumber(player.earnedSpp, 'team build.team.player.earnedSpp'),
        advancements: number(player.advancements, 'team build.team.player.advancements'), rank: string(player.rank, 'team build.team.player.rank'),
        advancementCosts: costs ? {
          randomPrimary: number(costs.randomPrimary, 'team build.team.player.advancementCosts.randomPrimary'),
          chosenPrimary: number(costs.chosenPrimary, 'team build.team.player.advancementCosts.chosenPrimary'),
          chosenSecondary: number(costs.chosenSecondary, 'team build.team.player.advancementCosts.chosenSecondary'),
          characteristic: number(costs.characteristic, 'team build.team.player.advancementCosts.characteristic'),
        } : null,
        advancementMethods: {
          randomPrimary: teamCapability(methods.randomPrimary, 'team build.team.player.advancementMethods.randomPrimary'),
          chosenPrimary: teamCapability(methods.chosenPrimary, 'team build.team.player.advancementMethods.chosenPrimary'),
          chosenSecondary: teamCapability(methods.chosenSecondary, 'team build.team.player.advancementMethods.chosenSecondary'),
          characteristic: teamCapability(methods.characteristic, 'team build.team.player.advancementMethods.characteristic'),
        },
        pendingAdvancement: pending,
        primaryCategories: array(player.primaryCategories, 'team build.team.player.primaryCategories').map((item) => string(item, 'team build.team.player.primaryCategory')),
        secondaryCategories: array(player.secondaryCategories, 'team build.team.player.secondaryCategories').map((item) => string(item, 'team build.team.player.secondaryCategory')),
        primarySkills: array(player.primarySkills, 'team build.team.player.primarySkills').map((item) => string(item, 'team build.team.player.primarySkill')),
        secondarySkills: array(player.secondarySkills, 'team build.team.player.secondarySkills').map((item) => string(item, 'team build.team.player.secondarySkill')),
        movement: nullableNumber(player.movement, 'team build.team.player.movement'), strength: nullableNumber(player.strength, 'team build.team.player.strength'),
        agility: nullableNumber(player.agility, 'team build.team.player.agility'), passing: nullableNumber(player.passing, 'team build.team.player.passing'),
        armour: nullableNumber(player.armour, 'team build.team.player.armour'), currentValue: number(player.currentValue, 'team build.team.player.currentValue'),
        mng: boolean(player.mng, 'team build.team.player.mng'), status: player.status === null ? null : string(player.status, 'team build.team.player.status'),
      };
    }),
  };
}
export function decodeTournamentTeamBuild(value: unknown): TournamentTeamBuild {
  const payload = record(value, 'team build');
  const capabilities = record(payload.capabilities, 'team build.capabilities');
  if (payload.inert !== true) throw new Error('Invalid team build.inert.');
  return {
    tournamentId: string(payload.tournamentId, 'team build.tournamentId'), entrantId: string(payload.entrantId, 'team build.entrantId'),
    team: decodeTeamDetail(payload.team),
    inert: true,
    capabilities: {
      editRoster: unavailableCapability(capabilities.editRoster, 'team build.capabilities.editRoster'),
      retire: unavailableCapability(capabilities.retire, 'team build.capabilities.retire'),
      launchUnscheduled: unavailableCapability(capabilities.launchUnscheduled, 'team build.capabilities.launchUnscheduled'),
    },
  };
}

export function decodeTournamentNextOpponent(value: unknown): TournamentNextOpponent {
  const payload = record(value, 'next opponent');
  const opponent = payload.opponent === null ? null : record(payload.opponent, 'next opponent.opponent');
  return {
    tournamentId: string(payload.tournamentId, 'next opponent.tournamentId'), entrantId: string(payload.entrantId, 'next opponent.entrantId'),
    roundNumber: optionalNumber(payload.roundNumber, 'next opponent.roundNumber'), provisional: boolean(payload.provisional, 'next opponent.provisional'),
    scheduledMatchId: optionalString(payload.scheduledMatchId, 'next opponent.scheduledMatchId'),
    opponent: opponent ? {
      entrantId: string(opponent.entrantId, 'next opponent.opponent.entrantId'), coachId: string(opponent.coachId, 'next opponent.opponent.coachId'),
      teamId: string(opponent.teamId, 'next opponent.opponent.teamId'),
    } : null,
  };
}

function decodeApplication(value: unknown): TournamentApplication {
  const item = record(value, 'tournament application');
  const team = record(item.team, 'tournament application.team');
  const status = string(item.status, 'tournament application.status') as TournamentApplicationStatus;
  if (!['submitted', 'pending', 'approved', 'declined', 'banned'].includes(status)) throw new Error('Invalid tournament application.status.');
  return {
    id: string(item.id, 'tournament application.id'), tournamentId: string(item.tournamentId, 'tournament application.tournamentId'),
    coachId: string(item.coachId, 'tournament application.coachId'), team: { teamId: string(team.teamId, 'tournament application.team.teamId') },
    status, revision: number(item.revision, 'tournament application.revision'), submittedAt: string(item.submittedAt, 'tournament application.submittedAt'),
    updatedAt: string(item.updatedAt, 'tournament application.updatedAt'), feedback: optionalString(item.feedback, 'tournament application.feedback'),
  };
}

function decodeValidation(value: unknown): TournamentApplicationValidation {
  const item = record(value, 'tournament validation');
  return {
    valid: boolean(item.valid, 'tournament validation.valid'),
    errors: array(item.errors ?? [], 'tournament validation.errors').map((entry) => string(entry, 'tournament validation.error')),
    warnings: array(item.warnings ?? [], 'tournament validation.warnings').map((entry) => string(entry, 'tournament validation.warning')),
    checkedAt: string(item.checkedAt, 'tournament validation.checkedAt'),
  };
}

function decodeApplicationView(value: unknown): TournamentApplicationView {
  const payload = record(value, 'application view');
  return { application: decodeApplication(payload.application), validation: decodeValidation(payload.validation) };
}

function decodeAdministration(value: unknown): TournamentAdministrationView {
  const payload = record(value, 'tournament administration');
  const administration = record(payload.administration, 'tournament administration.record');
  return {
    administration: {
      tournamentId: string(administration.tournamentId, 'administration.tournamentId'), revision: number(administration.revision, 'administration.revision'),
      ownerCoachIds: array(administration.ownerCoachIds, 'administration.ownerCoachIds').map((owner) => string(owner, 'administration.ownerCoachId')),
    },
    audit: array(payload.audit ?? [], 'administration.audit'),
  };
}

/** Bearer identity, not the compatibility coach query, controls protected rows. */
export function createTournamentApi(
  api: ForkApi = forkApi,
  download: (path: string) => Promise<ForkTextDownload> = botDownloadText,
): TournamentApi {
  const mutate = async (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body: Record<string, unknown> = {}) => {
    if (api.request) return api.request(method, path, body);
    if (method === 'POST') return api.post(path, body);
    throw new Error(`The connected client does not support ${method} tournament requests.`);
  };
  return {
    async createTournament(body) {
      const payload = await mutate('POST', 'tournaments', body);
      return decodeTournament(record(payload, 'create tournament').tournament);
    },
    editTournament(tournamentId, body) {
      return mutate('PATCH', `tournaments/${encodeURIComponent(tournamentId)}`, body);
    },
    async listActiveTournaments(coach) {
      const payload = await api.get('tournaments', { category: 'active', coach: coach.trim() });
      return array(payload.tournaments, 'tournaments').map(decodeTournament);
    },
    async listTournaments(category, coach, options = {}) {
      const params: Record<string, string> = { category, coach: coach.trim() };
      if (options.query?.trim()) params.q = options.query.trim();
      if (options.page !== undefined || (category === 'finished' && options.compactFinished === false)) params.page = String(options.page ?? 1);
      const payload = await api.get('tournaments', params);
      return {
        tournaments: array(payload.tournaments, 'tournaments').map(decodeTournament), category,
        page: number(payload.page, 'tournament list.page'), pageSize: number(payload.pageSize, 'tournament list.pageSize'),
        total: number(payload.total, 'tournament list.total'), hasMore: boolean(payload.hasMore, 'tournament list.hasMore'),
      };
    },
    async getTournament(tournamentId, coach) {
      return decodeTournamentDetail(await api.get(`tournaments/${encodeURIComponent(tournamentId)}`, { coach: coach.trim() }));
    },
    async getNextOpponent(tournamentId, coach) {
      return decodeTournamentNextOpponent(await api.get(`tournaments/${encodeURIComponent(tournamentId)}/next-opponent`, { coach: coach.trim() }));
    },
    async getTeamBuild(tournamentId, entrantId, coach) {
      return decodeTournamentTeamBuild(await api.get(`tournaments/${encodeURIComponent(tournamentId)}/entrants/${encodeURIComponent(entrantId)}/build`, { coach: coach.trim() }));
    },
    async getMyApplication(tournamentId) {
      const payload = await api.get(`tournaments/${encodeURIComponent(tournamentId)}/applications/me`, {});
      return payload.application === null ? null : decodeApplication(payload.application);
    },
    async submitApplication(tournamentId, teamId, revision) {
      const payload = await mutate('POST', `tournaments/${encodeURIComponent(tournamentId)}/applications`, { teamId, ...(revision === undefined ? {} : { revision }) });
      return decodeApplicationView(payload);
    },
    async getAdministration(tournamentId) {
      return decodeAdministration(await api.get(`tournaments/${encodeURIComponent(tournamentId)}/administration`, {}));
    },
    async listApplications(tournamentId) {
      const payload = await api.get(`tournaments/${encodeURIComponent(tournamentId)}/applications`, {});
      return array(payload.applications, 'applications').map(decodeApplicationView);
    },
    applicationAction(tournamentId, coachId, action, body) {
      return mutate('POST', `tournaments/${encodeURIComponent(tournamentId)}/applications/${encodeURIComponent(coachId)}/actions/${action}`, body);
    },
    adjudicate(tournamentId, matchId, body) {
      return mutate('POST', `tournaments/${encodeURIComponent(tournamentId)}/matches/${encodeURIComponent(matchId)}/adjudicate`, body);
    },
    replaceEntrant(tournamentId, entrantId, body) {
      return mutate('PATCH', `tournaments/${encodeURIComponent(tournamentId)}/entrants/${encodeURIComponent(entrantId)}/replace`, body);
    },
    dropEntrant(tournamentId, entrantId, body) {
      return mutate('POST', `tournaments/${encodeURIComponent(tournamentId)}/entrants/${encodeURIComponent(entrantId)}/drop`, body);
    },
    finishTournament(tournamentId, body) {
      return mutate('POST', `tournaments/${encodeURIComponent(tournamentId)}/finish`, body);
    },
    overrideAward(tournamentId, award, body) {
      return mutate('PATCH', `tournaments/${encodeURIComponent(tournamentId)}/awards/${award}`, body);
    },
    downloadNaf(tournamentId) { return download(`tournaments/${encodeURIComponent(tournamentId)}/naf.xml`); },
  };
}
