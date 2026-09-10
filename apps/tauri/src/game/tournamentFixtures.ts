import type { Tournament, TournamentApi, TournamentDetail, TournamentNextOpponent, TournamentTeamBuild } from './tournamentApi';

const tournament: Tournament = {
  id: 'iron-cup-26', name: 'Iron Cup 2026', status: 'active', format: 'swiss', roundCount: 5, currentRound: 3,
  tiebreakers: ['sonnebornBerger', 'buchholz', 'touchdownDifferential', 'casualtyDifferential'], points: { win: 3, draw: 1, loss: 0, bye: 3 },
  createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z', entrantCount: 3,
};

export const tournamentFixture: TournamentDetail = {
  tournament,
  entrants: [
    { entrantId: 'entrant-101', id: 'entrant-101', tournamentId: tournament.id, seed: 1, coachId: 'coach-1', coach: { coachId: 'coach-1', ffbCoachId: 'tk421rig' }, teamId: 'team-101', teamName: 'Void Reavers', race: 'Dark Elf', logoUrl: null, registeredAt: '2026-08-01T00:00:00Z', droppedAt: null },
    { entrantId: 'entrant-202', id: 'entrant-202', tournamentId: tournament.id, seed: 2, coachId: 'coach-2', coach: { coachId: 'coach-2', ffbCoachId: 'RivalCoach' }, teamId: 'team-202', teamName: 'Forge Wardens', race: 'Dwarf', logoUrl: null, registeredAt: '2026-08-01T00:00:00Z', droppedAt: null },
    { entrantId: 'entrant-303', id: 'entrant-303', tournamentId: tournament.id, seed: 3, coachId: 'coach-3', coach: { coachId: 'coach-3', ffbCoachId: 'Mira' }, teamId: 'team-303', teamName: 'Ashen Comets', race: 'Human', logoUrl: null, registeredAt: '2026-08-01T00:00:00Z', droppedAt: null },
  ],
  rounds: [],
  standings: [
    { rank: 1, entrantId: 'entrant-101', coachId: 'coach-1', teamId: 'team-101', played: 3, wins: 2, draws: 1, losses: 0, byes: 0, points: 7, sonnebornBerger: 12.5, buchholz: 15, touchdownsFor: 7, touchdownsAgainst: 3, touchdownDifferential: 4, casualtiesFor: 8, casualtiesAgainst: 6, casualtyDifferential: 2, opponentWinPercentage: .67, seed: 1 },
    { rank: 2, entrantId: 'entrant-202', coachId: 'coach-2', teamId: 'team-202', played: 3, wins: 2, draws: 0, losses: 1, byes: 0, points: 6, sonnebornBerger: 10, buchholz: 14, touchdownsFor: 5, touchdownsAgainst: 3, touchdownDifferential: 2, casualtiesFor: 9, casualtiesAgainst: 5, casualtyDifferential: 4, opponentWinPercentage: .62, seed: 2 },
    { rank: 3, entrantId: 'entrant-303', coachId: 'coach-3', teamId: 'team-303', played: 3, wins: 1, draws: 1, losses: 1, byes: 0, points: 4, sonnebornBerger: 9.5, buchholz: 11, touchdownsFor: 4, touchdownsAgainst: 4, touchdownDifferential: 0, casualtiesFor: 4, casualtiesAgainst: 5, casualtyDifferential: -1, opponentWinPercentage: .5, seed: 3 },
  ],
  scheduledMatches: [{
    matchId: 'iron-r3-m8', round: 3, status: 'scheduled', scheduledAt: '2026-08-28T02:00:00Z', myTeamId: 'team-101',
    opponentTeamId: 'team-202', opponentCoach: 'RivalCoach', opponentTeamName: 'Forge Wardens', opponentLogoUrl: null,
    canLaunch: true, waiting: false, waitingCoachIds: [],
    routeMetadata: { challenge: '/api/fork/challenge', matchstatus: '/api/fork/matchstatus', cancel: '/api/fork/cancel', jnlp: '/api/fork/jnlp' },
  }],
};

export const teamBuildFixture: TournamentTeamBuild = {
  tournamentId: tournament.id, entrantId: 'entrant-101', inert: true,
  team: {
    id: 'team-101', name: 'Void Reavers', race: 'Dark Elf', teamValue: 1_150, treasury: 40_000,
    rerolls: 2, fanFactor: 3, apothecary: true, assistantCoaches: 1, cheerleaders: 2,
    rulesetPackName: 'Iron Cup 2026', leagues: ['Elven Kingdoms League'], specialRules: ['Elven Kingdoms League'],
    canEditRoster: { available: true }, revision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    players: [
      {
        id: 'vr-1', number: 1, name: 'Veyra', position: 'Blitzer', positionId: 'de-blitzer', skills: ['Block', 'Dodge'],
        injuries: ['Smashed Knee'], spp: 12, earnedSpp: 6, advancements: 1, rank: 'Experienced',
        advancementCosts: { randomPrimary: 3, chosenPrimary: 6, chosenSecondary: 12, characteristic: 18 },
        advancementMethods: { randomPrimary: { available: true }, chosenPrimary: { available: true }, chosenSecondary: { available: true }, characteristic: { available: false, reason: 'Not enough SPP.' } },
        pendingAdvancement: null, primaryCategories: ['Agility', 'General'], secondaryCategories: ['Strength'],
        primarySkills: ['Catch'], secondarySkills: ['Guard'], movement: 7, strength: 3, agility: 2, passing: 4, armour: 9,
        currentValue: 120_000, mng: true, status: 'MissNextGame',
      },
      {
        id: 'vr-2', number: 2, name: 'Kheris', position: 'Witch Elf', positionId: 'de-witch', skills: ['Dodge', 'Frenzy', 'Jump Up'],
        injuries: [], spp: 0, earnedSpp: 0, advancements: 0, rank: 'Rookie', advancementCosts: null,
        advancementMethods: { randomPrimary: { available: false }, chosenPrimary: { available: false }, chosenSecondary: { available: false }, characteristic: { available: false } },
        pendingAdvancement: null, primaryCategories: ['Agility', 'General'], secondaryCategories: ['Strength'], primarySkills: [], secondarySkills: [],
        movement: 7, strength: 3, agility: 2, passing: 5, armour: 8, currentValue: 110_000, mng: false, status: 'Active',
      },
    ],
  },
  capabilities: {
    editRoster: { available: false, reason: 'Tournament builds are read-only.' },
    retire: { available: false, reason: 'Tournament entrants cannot retire here.' },
    launchUnscheduled: { available: false, reason: 'Launch the scheduled pairing instead.' },
  },
};

export const nextOpponentFixture: TournamentNextOpponent = {
  tournamentId: tournament.id, entrantId: 'entrant-101', roundNumber: 4, provisional: true,
  opponent: { entrantId: 'entrant-202', coachId: 'coach-2', teamId: 'team-202' },
};

export const activeTournamentFixtures: Tournament[] = [
  tournament,
  { ...tournament, id: 'sector-league-26', name: 'Sector League', currentRound: 5, roundCount: 7, entrantCount: 12 },
];

export function createTournamentFixtureApi(detail: TournamentDetail = tournamentFixture): TournamentApi {
  return {
    async createTournament(body) { return { ...activeTournamentFixtures[0]!, id: 'fixture-created', name: body.name }; },
    async editTournament() { return {}; },
    async listActiveTournaments() { return activeTournamentFixtures; },
    async listTournaments(category) { const items = category === 'active' ? activeTournamentFixtures : []; return { tournaments: items, category, page: 1, pageSize: category === 'finished' ? 3 : 15, total: items.length, hasMore: false }; },
    async getTournament(tournamentId) { return tournamentId === detail.tournament.id ? detail : { ...detail, tournament: activeTournamentFixtures.find((item) => item.id === tournamentId) ?? detail.tournament }; },
    async getNextOpponent(tournamentId) { return { ...nextOpponentFixture, tournamentId }; },
    async getTeamBuild(tournamentId, entrantId) { return { ...teamBuildFixture, tournamentId, entrantId }; },
    async getMyApplication() { return null; },
    async submitApplication() { throw new Error('Fixture does not submit applications.'); },
    async getAdministration() { throw new Error('Fixture account is not an owner.'); },
    async listApplications() { return []; },
    async applicationAction() { return {}; }, async adjudicate() { return {}; }, async replaceEntrant() { return {}; },
    async dropEntrant() { return {}; }, async finishTournament() { return {}; }, async overrideAward() { return {}; },
    async downloadNaf() { return { text: '<nafReport />', filename: 'fixture-naf.xml' }; },
  };
}
