<script setup lang="ts">
import CoordinationIdentityChip from '../../components/CoordinationIdentityChip.vue';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { botConfigBaseUrl, settings } from '../../game/settings';
import { rehydrateAccountSession } from '../../game/accountApi';
import { coachPassword } from '../../game/credentials';
import {
  connectMatchedChallenge,
  createChallengeController,
  createChallengeState,
  errText,
  loadTeamLibrary,
  type LibraryTeam,
  type ChallengeState,
} from '../../game/forkChallenge';
import {
  createTournamentApi,
  scheduledChallengeRequest,
  type TournamentApi,
  type TournamentDetail,
  type TournamentEntrant,
  type TournamentNextOpponent,
  type TournamentScheduledMatch,
  type TournamentMatchSide,
  type Tournament,
  type TournamentAdministrationView,
  type TournamentApplication,
  type TournamentApplicationAction,
  type TournamentApplicationView,
  type TournamentAwardKey,
  type TournamentTeamBuild,
} from '../../game/tournamentApi';

interface InitialTournamentData {
  active: Tournament[];
  detail: TournamentDetail;
  nextOpponent?: TournamentNextOpponent;
}

const props = defineProps<{
  api?: TournamentApi;
  initialData?: InitialTournamentData;
}>();
const emit = defineEmits<{ createTeam: [rulesetPackName: string] }>();

const api = props.api ?? createTournamentApi();
const tournaments = ref<Tournament[]>(props.initialData?.active ?? []);
const futureTournaments = ref<Tournament[]>([]);
const finishedTournaments = ref<Tournament[]>([]);
const finishedSearch = ref('');
const finishedPage = ref(1);
const finishedTotal = ref(0);
const finishedHasMore = ref(false);
const finishedExpanded = ref(false);
const selectedTournamentId = ref(props.initialData?.detail.tournament.id ?? '');
const detail = ref<TournamentDetail | null>(props.initialData?.detail ?? null);
const selectedEntrantId = ref('');
const selectedTeamBuild = ref<TournamentTeamBuild | null>(null);
const teamBuildLoading = ref(false);
const teamBuildError = ref('');
const nextOpponent = ref<TournamentNextOpponent | null>(props.initialData?.nextOpponent ?? null);
const nextOpponentError = ref('');
const listLoading = ref(false);
const detailLoading = ref(false);
const listError = ref('');
const detailError = ref('');
const myApplication = ref<TournamentApplication | null>(null);
const myValidation = ref<TournamentApplicationView['validation'] | null>(null);
const applicationBusy = ref(false);
const applicationMessage = ref('');
const libraryTeams = ref<LibraryTeam[]>([]);
const selectedApplicationTeamId = ref('');
const administration = ref<TournamentAdministrationView | null>(null);
const ownerApplications = ref<TournamentApplicationView[]>([]);
const adminBusy = ref(false);
const adminMessage = ref('');
const applicationFeedback = reactive<Record<string, string>>({});
const entrantReason = reactive<Record<string, string>>({});
const replacementCoach = reactive<Record<string, string>>({});
const replacementTeam = reactive<Record<string, string>>({});
const adjudication = reactive<Record<string, { winnerEntrantId: string; winnerScore: number; loserScore: number; winnerCasualties: number; loserCasualties: number; reason: string }>>({});
const finishWinnerId = ref('');
const finishReason = ref('');
const awardRecipients = reactive<Record<string, string[]>>({});
const awardReasons = reactive<Record<string, string>>({});
const currentMatch = ref<TournamentScheduledMatch | null>(null);
const waitingDialogVisible = ref(false);
const waitingDialog = ref<HTMLElement | null>(null);
const challenge = reactive<ChallengeState>(createChallengeState());

const entrantsByTeamId = computed(() => new Map((detail.value?.entrants ?? []).map((entrant) => [entrant.teamId, entrant])));
const selectedEntrant = computed(() => detail.value?.entrants.find((entrant) => entrant.entrantId === selectedEntrantId.value) ?? null);
const likelyOpponent = computed(() => {
  const opponent = nextOpponent.value?.opponent;
  return opponent
    ? detail.value?.entrants.find((entrant) => entrant.entrantId === opponent.entrantId || entrant.teamId === opponent.teamId) ?? null
    : null;
});
// Owner naming ruling: short names (Buchholz / SBR / TDD / CasD — Veers aligning server-side), no
// raw-key duplication in the card, and SEED IS NOT A TIEBREAKER — filtered from the display outright.
const tiebreakerRules = computed(() => (detail.value?.tournament.tiebreakers ?? [])
  .filter((code) => code !== 'seed')
  .map((code, index) => {
    const labels: Record<string, [string, string]> = {
      sonnebornBerger: ['SBR', 'Sonneborn–Berger: full points from defeated opponents plus half from drawn opponents.'],
      buchholz: ['Buchholz', 'Total points scored by all opponents faced.'],
      opponentWinPercentage: ['Opp. Win %', 'Combined win percentage of opponents faced.'],
      headToHead: ['Head-to-Head', 'The direct result between tied teams.'],
      touchdownDifferential: ['TDD', 'Touchdown differential: touchdowns scored minus touchdowns allowed.'],
      touchdownsFor: ['TDs For', 'Total touchdowns scored.'],
      casualtyDifferential: ['CasD', 'Casualty differential: casualties inflicted minus casualties sustained.'],
      casualtiesFor: ['Cas For', 'Total casualties inflicted.'],
    };
    const [label, description] = labels[code] ?? [code, 'Tournament ranking rule.'];
    return { order: index + 1, code, label, description };
  }));
const activeWait = computed(() => challenge.phase === 'submitting' || challenge.phase === 'waiting');
const isFuture = computed(() => detail.value?.tournament.status === 'draft');
const adminRevision = computed(() => administration.value?.administration.revision);
const reviewApplications = computed(() => ownerApplications.value.filter((item) => item.application.status === 'submitted' || item.application.status === 'pending'));
const awardKeys: TournamentAwardKey[] = ['winner', 'runnerUp', 'bestDefense', 'mostTouchdowns', 'mostBrutal', 'bestStunty'];

const challengeController = createChallengeController(challenge, {
  onMatched(payload) {
    waitingDialogVisible.value = false;
    connectMatchedChallenge(payload);
  },
});

function credentials(): { coach: string; password: string } {
  return { coach: settings.coach40k.trim(), password: coachPassword() };
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((word) => word[0]) : [words[0]?.slice(0, 2)])
    .join('').toUpperCase();
}

function formatDate(value: string | null): string {
  if (!value) return 'To be arranged';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatGold(value: number): string {
  return `${Math.round(value / 1_000).toLocaleString()}k`;
}

function formatTeamValue(value: number): string {
  return `${Math.round(value >= 10_000 ? value / 1_000 : value).toLocaleString()}k`;
}

function playerStats(player: TournamentTeamBuild['team']['players'][number]): string {
  const stat = (label: string, value: number | null, target = false) => `${label} ${value === null ? '—' : `${value}${target ? '+' : ''}`}`;
  return [stat('MA', player.movement), stat('ST', player.strength), stat('AG', player.agility, true), stat('PA', player.passing, true), stat('AV', player.armour, true)].join(' · ');
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function teamFor(teamId: string): TournamentEntrant | null {
  return entrantsByTeamId.value.get(teamId) ?? null;
}

function opponentName(match: TournamentScheduledMatch): string {
  return match.opponentTeamName ?? (match.opponentTeamId ? teamFor(match.opponentTeamId)?.teamName : undefined) ?? 'Tournament pairing';
}

function entrantName(entrant: TournamentEntrant): string { return entrant.teamName ?? `Team ${entrant.teamId}`; }
function entrantCoach(entrant: TournamentEntrant): string { return entrant.coach.ffbCoachId || entrant.coachId; }
function awardCandidateNames(award: TournamentAwardKey): string {
  const ids = detail.value?.tournament.awards?.[award]?.generatedCandidateEntrantIds ?? [];
  return ids.map((id) => detail.value?.entrants.find((entrant) => entrant.entrantId === id)?.teamName ?? id).join(', ') || 'None';
}
function teamNameFor(teamId: string): string { const entrant = teamFor(teamId); return entrant ? entrantName(entrant) : teamId; }
function teamCoachFor(teamId: string, fallback: string): string { const entrant = teamFor(teamId); return entrant ? entrantCoach(entrant) : fallback; }

async function showTeam(teamId: string): Promise<void> {
  const entrant = entrantsByTeamId.value.get(teamId);
  if (!entrant || !detail.value) return;
  selectedEntrantId.value = entrant.entrantId;
  selectedTeamBuild.value = null;
  teamBuildError.value = '';
  teamBuildLoading.value = true;
  try {
    selectedTeamBuild.value = await api.getTeamBuild(detail.value.tournament.id, entrant.entrantId, credentials().coach);
  } catch (error) {
    teamBuildError.value = `Couldn't load this team build (${errText(error)}).`;
  } finally {
    teamBuildLoading.value = false;
  }
}

function closeTeam(): void {
  selectedEntrantId.value = '';
  selectedTeamBuild.value = null;
  teamBuildError.value = '';
}

async function loadTournament(tournamentId: string): Promise<void> {
  selectedTournamentId.value = tournamentId;
  selectedEntrantId.value = '';
  selectedTeamBuild.value = null;
  nextOpponent.value = null;
  nextOpponentError.value = '';
  detail.value = null;
  detailError.value = '';
  detailLoading.value = true;
  myApplication.value = null;
  myValidation.value = null;
  applicationMessage.value = '';
  administration.value = null;
  ownerApplications.value = [];
  adminMessage.value = '';
  try {
    const coach = credentials().coach;
    const [detailResult, opponentResult] = await Promise.allSettled([
      api.getTournament(tournamentId, coach), api.getNextOpponent(tournamentId, coach),
    ]);
    if (detailResult.status === 'rejected') throw detailResult.reason;
    detail.value = detailResult.value;
    finishWinnerId.value = detail.value.standings[0]?.entrantId ?? '';
    for (const award of awardKeys) awardRecipients[award] = [...(detail.value.tournament.awards?.[award]?.recipientEntrantIds ?? [])];
    if (opponentResult.status === 'fulfilled') nextOpponent.value = opponentResult.value;
    else nextOpponentError.value = `Next matchup is unavailable (${errText(opponentResult.reason)}).`;
    await loadTournamentAccess();
  } catch (error) {
    detailError.value = `Couldn't load this tournament (${errText(error)}).`;
  } finally {
    detailLoading.value = false;
  }
}

async function loadTournamentAccess(): Promise<void> {
  if (!detail.value || !credentials().coach) return;
  if (detail.value.tournament.status === 'draft') {
    const [applicationResult, libraryResult] = await Promise.allSettled([
      api.getMyApplication(detail.value.tournament.id), loadTeamLibrary(credentials().coach),
    ]);
    if (applicationResult.status === 'fulfilled') {
      myApplication.value = applicationResult.value;
      selectedApplicationTeamId.value = applicationResult.value?.team.teamId ?? '';
    }
    if (libraryResult.status === 'fulfilled') {
      libraryTeams.value = libraryResult.value;
      if (!selectedApplicationTeamId.value) selectedApplicationTeamId.value = libraryTeams.value[0]?.teamId ?? '';
    }
  }
  try {
    administration.value = await api.getAdministration(detail.value.tournament.id);
    ownerApplications.value = await api.listApplications(detail.value.tournament.id).catch(() => []);
  } catch {
    // A protected 403 is the server's authoritative capability denial: keep owner UI absent.
    administration.value = null;
    ownerApplications.value = [];
  }
}

async function loadActiveTournaments(): Promise<void> {
  listLoading.value = true;
  listError.value = '';
  try {
    const coach = credentials().coach;
    const [active, future, finished] = await Promise.all([
      api.listTournaments('active', coach), api.listTournaments('future', coach),
      api.listTournaments('finished', coach, { compactFinished: true }),
    ]);
    tournaments.value = active.tournaments;
    futureTournaments.value = future.tournaments;
    finishedTournaments.value = finished.tournaments;
    finishedTotal.value = finished.total;
    finishedHasMore.value = finished.hasMore;
    finishedPage.value = finished.page;
    const preferred = tournaments.value.find((item) => item.id === selectedTournamentId.value)
      ?? futureTournaments.value.find((item) => item.id === selectedTournamentId.value)
      ?? finishedTournaments.value.find((item) => item.id === selectedTournamentId.value)
      ?? tournaments.value[0] ?? futureTournaments.value[0] ?? finishedTournaments.value[0];
    if (preferred) await loadTournament(preferred.id);
    else detail.value = null;
  } catch (error) {
    tournaments.value = [];
    detail.value = null;
    listError.value = `Couldn't load tournaments (${errText(error)}).`;
  } finally {
    listLoading.value = false;
  }
}

async function loadFinished(page = 1, expand = true): Promise<void> {
  listLoading.value = true;
  listError.value = '';
  try {
    const result = await api.listTournaments('finished', credentials().coach, {
      query: finishedSearch.value, page, compactFinished: !expand,
    });
    finishedTournaments.value = result.tournaments;
    finishedPage.value = result.page;
    finishedTotal.value = result.total;
    finishedHasMore.value = result.hasMore;
    finishedExpanded.value = expand || !!finishedSearch.value;
  } catch (error) {
    listError.value = `Couldn't load finished tournaments (${errText(error)}).`;
  } finally { listLoading.value = false; }
}

function createTournamentTeam(): void {
  if (detail.value?.tournament.rulesetPackName) emit('createTeam', detail.value.tournament.rulesetPackName);
}

async function submitApplication(): Promise<void> {
  if (!detail.value || !selectedApplicationTeamId.value) return;
  applicationBusy.value = true; applicationMessage.value = '';
  try {
    const result = await api.submitApplication(detail.value.tournament.id, selectedApplicationTeamId.value, myApplication.value?.revision);
    myApplication.value = result.application; myValidation.value = result.validation;
    applicationMessage.value = result.validation.valid ? 'Application submitted. The owner will review its current roster.' : 'Application saved, but its current roster is invalid.';
  } catch (error) { applicationMessage.value = `Couldn't submit the application (${errText(error)}).`; }
  finally { applicationBusy.value = false; }
}

async function refreshAfterAdmin(message: string): Promise<void> {
  if (!detail.value) return;
  const tournamentId = detail.value.tournament.id;
  await loadActiveTournaments();
  if (selectedTournamentId.value !== tournamentId) await loadTournament(tournamentId);
  adminMessage.value = message;
}

async function runApplicationAction(view: TournamentApplicationView, action: TournamentApplicationAction): Promise<void> {
  if (!detail.value || adminRevision.value === undefined) return;
  adminBusy.value = true; adminMessage.value = '';
  try {
    await api.applicationAction(detail.value.tournament.id, view.application.coachId, action, {
      revision: view.application.revision,
      ...(action === 'approve' ? { tournamentRevision: adminRevision.value } : {}),
      ...(action === 'decline' ? { feedback: applicationFeedback[view.application.id] ?? '' } : {}),
    });
    await refreshAfterAdmin(`Application ${action}d.`);
  } catch (error) { adminMessage.value = `Couldn't ${action} application (${errText(error)}).`; }
  finally { adminBusy.value = false; }
}

function matchSides(match: TournamentScheduledMatch): TournamentMatchSide[] {
  return [match.home, match.away].filter((side): side is TournamentMatchSide => !!side);
}

function adjudicationState(match: TournamentScheduledMatch) {
  if (!adjudication[match.matchId]) {
    adjudication[match.matchId] = { winnerEntrantId: match.home?.entrantId ?? '', winnerScore: 1, loserScore: 0, winnerCasualties: 0, loserCasualties: 0, reason: '' };
  }
  return adjudication[match.matchId]!;
}

async function adjudicateMatch(match: TournamentScheduledMatch): Promise<void> {
  if (!detail.value || match.revision === undefined || matchSides(match).length !== 2) return;
  const state = adjudicationState(match);
  const loser = matchSides(match).find((side) => side.entrantId !== state.winnerEntrantId);
  if (!loser) return;
  adminBusy.value = true;
  try {
    await api.adjudicate(detail.value.tournament.id, match.matchId, { revision: match.revision, winnerEntrantId: state.winnerEntrantId, loserEntrantId: loser.entrantId, winnerScore: state.winnerScore, loserScore: state.loserScore, winnerCasualties: state.winnerCasualties, loserCasualties: state.loserCasualties, reason: state.reason });
    await refreshAfterAdmin('Match adjudicated.');
  } catch (error) { adminMessage.value = `Couldn't adjudicate match (${errText(error)}).`; }
  finally { adminBusy.value = false; }
}

async function replaceEntrant(entrant: TournamentEntrant): Promise<void> {
  if (!detail.value || adminRevision.value === undefined) return;
  adminBusy.value = true;
  try {
    await api.replaceEntrant(detail.value.tournament.id, entrant.entrantId, { revision: adminRevision.value, coachId: replacementCoach[entrant.entrantId] ?? '', teamId: replacementTeam[entrant.entrantId] ?? '', reason: entrantReason[entrant.entrantId] ?? '' });
    await refreshAfterAdmin('Entrant replaced.');
  } catch (error) { adminMessage.value = `Couldn't replace entrant (${errText(error)}).`; }
  finally { adminBusy.value = false; }
}

async function dropEntrant(entrant: TournamentEntrant): Promise<void> {
  if (!detail.value || adminRevision.value === undefined) return;
  adminBusy.value = true;
  try {
    await api.dropEntrant(detail.value.tournament.id, entrant.entrantId, { revision: adminRevision.value, reason: entrantReason[entrant.entrantId] ?? '' });
    await refreshAfterAdmin('Entrant dropped.');
  } catch (error) { adminMessage.value = `Couldn't drop entrant (${errText(error)}).`; }
  finally { adminBusy.value = false; }
}

async function finishTournament(): Promise<void> {
  if (!detail.value || adminRevision.value === undefined || !finishWinnerId.value) return;
  if (!window.confirm(`Finish ${detail.value.tournament.name} and record the selected winner?`)) return;
  adminBusy.value = true;
  try {
    await api.finishTournament(detail.value.tournament.id, { revision: adminRevision.value, winnerEntrantId: finishWinnerId.value, confirmed: true, reason: finishReason.value });
    await refreshAfterAdmin('Tournament finished and award candidates generated.');
  } catch (error) { adminMessage.value = `Couldn't finish tournament (${errText(error)}).`; }
  finally { adminBusy.value = false; }
}

async function overrideAward(award: TournamentAwardKey): Promise<void> {
  if (!detail.value || adminRevision.value === undefined) return;
  adminBusy.value = true;
  try {
    await api.overrideAward(detail.value.tournament.id, award, { revision: adminRevision.value, recipientEntrantIds: awardRecipients[award] ?? [], reason: awardReasons[award] ?? '' });
    await refreshAfterAdmin('Award recipients updated.');
  } catch (error) { adminMessage.value = `Couldn't update award (${errText(error)}).`; }
  finally { adminBusy.value = false; }
}

async function downloadNaf(): Promise<void> {
  if (!detail.value) return;
  adminBusy.value = true;
  try {
    const file = await api.downloadNaf(detail.value.tournament.id);
    const url = URL.createObjectURL(new Blob([file.text], { type: file.contentType ?? 'application/xml' }));
    const link = document.createElement('a'); link.href = url; link.download = file.filename ?? `${detail.value.tournament.id}-naf.xml`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    adminMessage.value = 'NAF XML downloaded.';
  } catch (error) { adminMessage.value = `Couldn't export NAF XML (${errText(error)}).`; }
  finally { adminBusy.value = false; }
}

async function focusWaitingDialog(): Promise<void> {
  await nextTick();
  waitingDialog.value?.focus();
}

async function launchMatch(match: TournamentScheduledMatch): Promise<void> {
  if (!match.canLaunch) return;
  if (activeWait.value) await challengeController.cancel();
  currentMatch.value = match;
  waitingDialogVisible.value = true;
  void focusWaitingDialog();
  const creds = credentials();
  if (!creds.coach) {
    challenge.phase = 'error';
    challenge.message = 'Set your Super FUMBBL identity in Account before launching this match.';
    challenge.error = challenge.message;
    return;
  }
  await challengeController.submit(scheduledChallengeRequest(match, creds));
}

function dismissWaiting(): void {
  waitingDialogVisible.value = false;
}

async function selectAnotherMatch(): Promise<void> {
  await challengeController.cancel();
  waitingDialogVisible.value = false;
  currentMatch.value = null;
}

async function retryMatch(): Promise<void> {
  if (currentMatch.value) await launchMatch(currentMatch.value);
}

function reopenWaiting(): void {
  waitingDialogVisible.value = true;
  void focusWaitingDialog();
}

// ── Owner: Create Tournament pane (organizers/admins), replicating the tournaments.html panel.
// Gate = the account session's level (rehydrateAccountSession — null/player hides the pane entirely);
// the server re-checks organizer on the POST regardless. Fields/body mirror the web panel verbatim:
// {name, packageName, maxPlayers, format(swiss|roundRobin|knockout)} → POST /api/fork/tournaments.
const accountLevel = ref<'player' | 'organizer' | 'admin' | null>(null);
const canCreateTournament = computed(() => accountLevel.value === 'organizer' || accountLevel.value === 'admin');
const createOpen = ref(false);
const createBusy = ref(false);
const createError = ref('');
const createDraft = reactive({ name: '', packageName: '', maxPlayers: 8, format: 'swiss', primaryTiebreaker: 'buchholz' });
const createPackages = ref<Array<{ name: string }>>([]);
const inTauriShell = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
async function loadCreatePackages(): Promise<void> {
  try {
    const url = `${botConfigBaseUrl()}/api/packages`;
    const response = inTauriShell ? await tauriFetch(url) : await fetch(url);
    const data = (await response.json().catch(() => [])) as unknown;
    const list = Array.isArray(data) ? data : Array.isArray((data as { packages?: unknown[] })?.packages) ? (data as { packages: unknown[] }).packages : [];
    createPackages.value = list.filter((entry): entry is { name: string } => typeof (entry as { name?: unknown })?.name === 'string');
    if (!createDraft.packageName) createDraft.packageName = createPackages.value[0]?.name ?? '';
  } catch (error) {
    createError.value = errText(error);
  }
}
function openCreatePane(): void {
  createError.value = '';
  createOpen.value = true;
  if (!createPackages.value.length) void loadCreatePackages();
}
async function submitCreateTournament(): Promise<void> {
  if (createBusy.value || !createDraft.name.trim() || !createDraft.packageName) return;
  createBusy.value = true;
  createError.value = '';
  try {
    const tournament = await api.createTournament({
      name: createDraft.name.trim(),
      packageName: createDraft.packageName,
      maxPlayers: Math.max(2, Math.floor(createDraft.maxPlayers)),
      format: createDraft.format,
      primaryTiebreaker: createDraft.primaryTiebreaker,
    });
    createOpen.value = false;
    createDraft.name = '';
    await loadActiveTournaments();
    await loadTournament(tournament.id);
  } catch (error) {
    createError.value = errText(error);
  } finally {
    createBusy.value = false;
  }
}

// ── Owner: Edit Tournament panel (organizer live-edit contract, tournament-api.md §organizer-live-edit).
// PATCH /api/fork/tournaments/:id with ONLY the changed fields; maxPlayers floor + the format/package
// rounds-lock are server-enforced (mirrored here as disabled selects with titles once rounds exist).
const editDraft = reactive({ maxPlayers: null as number | null, format: '', packageName: '', startsAt: '', primaryTiebreaker: '' });
const editBusy = ref(false);
const editError = ref('');
const editSeededFor = ref('');
const roundsExist = computed(() => (detail.value?.tournament.currentRound ?? 0) > 0);
function isoToLocalInput(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function seedEditDraft(): void {
  const tournament = detail.value?.tournament;
  if (!tournament || editSeededFor.value === tournament.id) return;
  editSeededFor.value = tournament.id;
  editDraft.maxPlayers = tournament.maxPlayers ?? null;
  editDraft.format = tournament.format;
  editDraft.packageName = tournament.rulesetPackName ?? '';
  editDraft.startsAt = isoToLocalInput(tournament.startsAt);
  editDraft.primaryTiebreaker = tournament.tiebreakers[0] ?? 'buchholz';
  editError.value = '';
  if (!createPackages.value.length) void loadCreatePackages();
}
watch(() => [administration.value, detail.value?.tournament.id], () => { if (administration.value) seedEditDraft(); });
async function submitEditTournament(): Promise<void> {
  const tournament = detail.value?.tournament;
  if (!tournament || editBusy.value) return;
  const body: Partial<{ maxPlayers: number; format: string; packageName: string; startsAt: string; primaryTiebreaker: string }> = {};
  if (editDraft.maxPlayers != null && editDraft.maxPlayers !== tournament.maxPlayers) body.maxPlayers = Math.floor(editDraft.maxPlayers);
  if (editDraft.format && editDraft.format !== tournament.format) body.format = editDraft.format;
  if (editDraft.packageName && editDraft.packageName !== (tournament.rulesetPackName ?? '')) body.packageName = editDraft.packageName;
  const startsAtIso = editDraft.startsAt ? new Date(editDraft.startsAt).toISOString() : '';
  if (startsAtIso && startsAtIso !== (tournament.startsAt ?? '')) body.startsAt = startsAtIso;
  if (editDraft.primaryTiebreaker && editDraft.primaryTiebreaker !== (tournament.tiebreakers[0] ?? '')) body.primaryTiebreaker = editDraft.primaryTiebreaker;
  if (!Object.keys(body).length) { editError.value = 'Nothing changed.'; return; }
  editBusy.value = true;
  editError.value = '';
  try {
    await api.editTournament(tournament.id, body);
    editSeededFor.value = '';
    await loadActiveTournaments();
    await loadTournament(tournament.id);
  } catch (error) {
    editError.value = errText(error);
  } finally {
    editBusy.value = false;
  }
}

onMounted(() => {
  if (!props.initialData) void loadActiveTournaments();
  void rehydrateAccountSession().then((account) => { accountLevel.value = account?.level ?? null; }).catch(() => { accountLevel.value = null; });
});

onBeforeUnmount(() => {
  if (activeWait.value) void challengeController.cancel();
  else challengeController.dispose();
});
</script>

<template>
  <section class="tournaments-view" aria-labelledby="tournaments-title">
    <header class="view-heading">
      <div>
        <p class="eyebrow">SUPER FUMBBL COMPETITION</p>
        <h1 id="tournaments-title">Tournaments</h1>
        <p>Standings, rosters and your scheduled matches in one place.</p>
      </div>
      <button class="secondary-button" type="button" :disabled="listLoading" @click="loadActiveTournaments">
        {{ listLoading ? 'Refreshing…' : 'Refresh' }}
      </button>
      <!-- Owner: organizers/admins create tournaments in-client (replicates the tournaments.html panel). -->
      <button v-if="canCreateTournament" class="create-tournament-button" type="button" :aria-expanded="createOpen" @click="createOpen ? (createOpen = false) : openCreatePane()">
        {{ createOpen ? 'Close Create' : 'Create Tournament' }}
      </button>
    </header>

    <CoordinationIdentityChip />

    <section v-if="canCreateTournament && createOpen" class="create-tournament-pane" aria-label="Create tournament">
      <h2>Create Tournament</h2>
      <form class="create-tournament-grid" @submit.prevent="submitCreateTournament">
        <label class="ct-field ct-full"><span>Name</span><input v-model="createDraft.name" type="text" maxlength="100" required /></label>
        <label class="ct-field ct-full"><span>Ruleset</span>
          <select v-model="createDraft.packageName" required>
            <option v-if="!createPackages.length" value="">No saved packages</option>
            <option v-for="entry in createPackages" :key="entry.name" :value="entry.name">{{ entry.name }}</option>
          </select>
        </label>
        <label class="ct-field"><span># of Players</span><input v-model.number="createDraft.maxPlayers" type="number" min="2" step="1" required /></label>
        <label class="ct-field"><span>Type</span>
          <select v-model="createDraft.format">
            <option value="swiss">Swiss</option>
            <option value="roundRobin">Round-Robin</option>
            <option value="knockout">Knockout</option>
          </select>
        </label>
        <label class="ct-field"><span>Primary tiebreaker</span>
          <select v-model="createDraft.primaryTiebreaker">
            <option value="buchholz">Buchholz</option>
            <option value="sonnebornBerger">SBR</option>
          </select>
        </label>
        <button class="create-tournament-button ct-submit" type="submit" :disabled="createBusy || !createPackages.length || !createDraft.name.trim()">{{ createBusy ? 'Creating…' : 'Create Draft' }}</button>
      </form>
      <p v-if="createError" class="error-copy" role="alert">{{ createError }}</p>
    </section>

    <div class="tournament-layout">
      <aside class="tournament-picker" aria-label="Tournament discovery">
        <p v-if="listError" class="error-copy" role="alert">{{ listError }}</p>
        <p v-else-if="listLoading && !tournaments.length && !futureTournaments.length" class="status-copy" role="status">Loading tournaments…</p>
        <section aria-labelledby="active-tournaments-title">
          <h2 id="active-tournaments-title">Active</h2>
          <p v-if="!tournaments.length" class="status-copy">No active tournaments.</p>
          <div v-else class="tournament-list">
            <button v-for="tournament in tournaments" :key="tournament.id" class="tournament-card" type="button" :aria-current="selectedTournamentId === tournament.id ? 'true' : undefined" @click="loadTournament(tournament.id)">
              <span class="season">Live · {{ tournament.format }}</span><strong>{{ tournament.name }}</strong><span>Round {{ tournament.currentRound }} of {{ tournament.roundCount }}</span><span>{{ tournament.entrantCount ?? '—' }} teams</span>
            </button>
          </div>
        </section>
        <section aria-labelledby="future-tournaments-title">
          <h2 id="future-tournaments-title">Future</h2>
          <p v-if="!futureTournaments.length" class="status-copy">No future tournaments.</p>
          <div v-else class="tournament-list">
            <button v-for="tournament in futureTournaments" :key="tournament.id" class="tournament-card" type="button" :aria-current="selectedTournamentId === tournament.id ? 'true' : undefined" @click="loadTournament(tournament.id)">
              <span class="season">Applications · {{ tournament.format }}</span><strong>{{ tournament.name }}</strong><span>{{ tournament.rulesetPackName ?? 'Ruleset pending' }}</span><span>{{ tournament.entrantCount ?? '—' }} teams</span>
            </button>
          </div>
        </section>
        <section aria-labelledby="finished-tournaments-title">
          <h2 id="finished-tournaments-title">Finished</h2>
          <form class="finished-search" role="search" @submit.prevent="loadFinished(1)">
            <label class="sr-only" for="finished-search">Search finished tournaments</label>
            <input id="finished-search" v-model="finishedSearch" type="search" placeholder="Search finished" />
            <button class="text-button" type="submit">Search</button>
          </form>
          <p v-if="!finishedTournaments.length" class="status-copy">No finished tournaments.</p>
          <div v-else class="tournament-list">
          <button
            v-for="tournament in finishedTournaments"
            :key="tournament.id"
            class="tournament-card"
            type="button"
            :aria-current="selectedTournamentId === tournament.id ? 'true' : undefined"
            @click="loadTournament(tournament.id)"
          >
            <span class="season">Finished · {{ tournament.format }}</span>
            <strong>{{ tournament.name }}</strong>
            <span>{{ tournament.winnerEntrantId ? 'Winner recorded' : `${tournament.roundCount} rounds` }}</span>
            <span>{{ tournament.entrantCount ?? '—' }} teams</span>
          </button>
          </div>
          <button v-if="!finishedExpanded && finishedTotal > 3" class="secondary-button discovery-button" type="button" @click="loadFinished(1, true)">Show all {{ finishedTotal }}</button>
          <nav v-else-if="finishedExpanded && finishedTotal > 15" class="pagination" aria-label="Finished tournament pages">
            <button class="text-button" type="button" :disabled="finishedPage <= 1" @click="loadFinished(finishedPage - 1)">Previous</button>
            <span>Page {{ finishedPage }}</span>
            <button class="text-button" type="button" :disabled="!finishedHasMore" @click="loadFinished(finishedPage + 1)">Next</button>
          </nav>
        </section>
      </aside>

      <main class="tournament-detail" :aria-busy="detailLoading">
        <p v-if="detailLoading" class="status-copy" role="status">Loading tournament…</p>
        <div v-else-if="detailError" class="empty-panel" role="alert">
          <p>{{ detailError }}</p>
          <button class="secondary-button" type="button" @click="loadTournament(selectedTournamentId)">Retry</button>
        </div>
        <div v-else-if="!detail" class="empty-panel">Select an active tournament to see its standings.</div>

        <template v-else-if="selectedEntrant">
          <button class="back-button" type="button" @click="closeTeam">← Back to tournament</button>
          <article class="team-sheet" :aria-labelledby="`team-${selectedEntrant.teamId}-title`">
            <header class="team-sheet-heading">
              <span v-if="!selectedEntrant.logoUrl" class="team-crest large" aria-hidden="true">{{ initials(entrantName(selectedEntrant)) }}</span>
              <img v-else class="team-logo large" :src="selectedEntrant.logoUrl" alt="" />
              <div>
                <p class="eyebrow">TEAM OVERVIEW</p>
                <h2 :id="`team-${selectedEntrant.teamId}-title`">{{ selectedTeamBuild?.team.name ?? entrantName(selectedEntrant) }}</h2>
                <p>{{ selectedTeamBuild?.team.race ?? selectedEntrant.race ?? 'Race unavailable' }} · coached by {{ entrantCoach(selectedEntrant) }}</p>
              </div>
            </header>

            <p v-if="teamBuildLoading" class="status-copy" role="status">Loading team build…</p>
            <div v-else-if="teamBuildError" class="error-copy" role="alert"><p>{{ teamBuildError }}</p><button class="secondary-button" type="button" @click="showTeam(selectedEntrant.teamId)">Retry</button></div>
            <template v-else-if="selectedTeamBuild">
              <dl class="team-facts">
                <div><dt>Team value</dt><dd>{{ formatTeamValue(selectedTeamBuild.team.teamValue) }}</dd></div>
                <div><dt>Treasury</dt><dd>{{ formatGold(selectedTeamBuild.team.treasury) }}</dd></div>
                <div><dt>Rerolls</dt><dd>{{ selectedTeamBuild.team.rerolls }}</dd></div>
                <div><dt>Fan factor</dt><dd>{{ selectedTeamBuild.team.fanFactor }}</dd></div>
                <div><dt>Apothecary</dt><dd>{{ selectedTeamBuild.team.apothecary ? 'Yes' : 'No' }}</dd></div>
                <div><dt>Assistant coaches</dt><dd>{{ selectedTeamBuild.team.assistantCoaches }}</dd></div>
                <div><dt>Cheerleaders</dt><dd>{{ selectedTeamBuild.team.cheerleaders }}</dd></div>
              </dl>
              <section class="inert-build" aria-labelledby="build-title">
                <div><p class="eyebrow">TOURNAMENT BUILD</p><h3 id="build-title">Read-only roster snapshot</h3></div>
                <p>{{ selectedTeamBuild.capabilities.editRoster.reason }}</p>
                <p class="status-copy">{{ selectedTeamBuild.team.rulesetPackName ?? 'Standard ruleset' }} · {{ selectedTeamBuild.team.leagues.join(', ') || 'No league tags' }}</p>
                <p v-if="selectedTeamBuild.team.specialRules.length" class="status-copy">Special rules: {{ selectedTeamBuild.team.specialRules.join(', ') }}</p>
              </section>
              <section aria-labelledby="roster-title">
                <h3 id="roster-title">Roster</h3>
                <p v-if="!selectedTeamBuild.team.players.length" class="status-copy">No players are present in this build.</p>
                <div v-else class="table-scroll">
                  <table class="roster-table">
                    <caption class="sr-only">{{ selectedTeamBuild.team.name }} player roster</caption>
                    <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Position</th><th scope="col">Stats</th><th scope="col">Skills &amp; traits</th><th scope="col">Injuries</th><th scope="col">SPP</th><th scope="col">Value</th></tr></thead>
                    <tbody>
                      <tr v-for="player in selectedTeamBuild.team.players" :key="player.id" :class="{ 'mng-player': player.mng }">
                        <td>{{ player.number }}</td><th scope="row"><span>{{ player.name }}</span><small v-if="player.mng">MNG</small></th>
                        <td>{{ player.position ?? player.positionId }}</td><td>{{ playerStats(player) }}</td>
                        <td>{{ player.skills.join(', ') || '—' }}</td><td>{{ player.injuries.join(', ') || '—' }}</td>
                        <td class="numeric">{{ player.spp }}</td><td>{{ formatGold(player.currentValue) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </template>
          </article>
        </template>

        <template v-else>
          <header class="detail-heading">
            <div>
              <p class="eyebrow">{{ detail.tournament.format }} · {{ detail.tournament.status }}</p>
              <h2>{{ detail.tournament.name }}</h2>
              <p>Round {{ detail.tournament.currentRound }} of {{ detail.tournament.roundCount }} · {{ detail.entrants.length }} teams · {{ detail.tournament.rulesetPackName ?? 'Standard ruleset' }}</p>
            </div>
          </header>

          <section v-if="isFuture" class="content-panel application-panel" aria-labelledby="application-title">
            <div class="section-heading"><div><p class="eyebrow">ENTER THE TOURNAMENT</p><h3 id="application-title">Team application</h3></div><span>Ruleset: {{ detail.tournament.rulesetPackName ?? 'Not configured' }}</span></div>
            <button v-if="detail.tournament.rulesetPackName" class="secondary-button" type="button" @click="createTournamentTeam">Create team for this tournament</button>
            <div v-if="myApplication" class="application-status" :data-status="myApplication.status">
              <strong>{{ myApplication.status }}</strong><span>Team {{ myApplication.team.teamId }}</span>
              <p v-if="myApplication.feedback">Owner feedback: {{ myApplication.feedback }}</p>
              <p v-if="myApplication.status === 'banned'">This team is permanently banned from this tournament and cannot be resubmitted.</p>
            </div>
            <label v-if="myApplication?.status !== 'approved' && myApplication?.status !== 'banned'" class="form-field">
              <span>{{ myApplication?.status === 'declined' ? 'Choose a team and resubmit' : 'Team from your library' }}</span>
              <select v-model="selectedApplicationTeamId"><option value="" disabled>Select a team</option><option v-for="team in libraryTeams" :key="team.teamId" :value="team.teamId">{{ team.teamName }} · {{ team.race }}</option></select>
            </label>
            <button v-if="myApplication?.status !== 'approved' && myApplication?.status !== 'banned'" class="launch-button" type="button" :disabled="applicationBusy || !selectedApplicationTeamId" @click="submitApplication">{{ applicationBusy ? 'Validating…' : myApplication ? 'Resubmit application' : 'Submit application' }}</button>
            <div v-if="myValidation" class="validation-box" :class="myValidation.valid ? 'valid' : 'invalid'">
              <strong>{{ myValidation.valid ? 'Valid' : 'Invalid' }} now</strong><time :datetime="myValidation.checkedAt">Checked {{ formatDate(myValidation.checkedAt) }}</time>
              <ul v-if="myValidation.errors.length"><li v-for="error in myValidation.errors" :key="error">{{ error }}</li></ul>
              <ul v-if="myValidation.warnings.length"><li v-for="warning in myValidation.warnings" :key="warning">{{ warning }}</li></ul>
            </div>
            <p v-if="applicationMessage" class="status-copy" role="status">{{ applicationMessage }}</p>
          </section>

          <p v-if="nextOpponentError" class="status-copy" role="status">{{ nextOpponentError }}</p>
          <section v-if="nextOpponent?.opponent && likelyOpponent" class="next-matchup" aria-labelledby="next-matchup-title">
            <div>
              <p class="eyebrow">LIKELY NEXT MATCHUP</p>
              <h3 id="next-matchup-title">{{ nextOpponent.provisional ? 'Provisional pairing' : 'Confirmed next opponent' }}</h3>
              <p>{{ nextOpponent.provisional ? 'Projected from the current standings' : 'Scheduled pairing' }}<template v-if="nextOpponent.roundNumber"> · Round {{ nextOpponent.roundNumber }}</template></p>
            </div>
            <button class="team-link matchup-link" type="button" @click="showTeam(likelyOpponent.teamId)">
              <span v-if="!likelyOpponent.logoUrl" class="team-crest" aria-hidden="true">{{ initials(entrantName(likelyOpponent)) }}</span>
              <img v-else class="team-logo" :src="likelyOpponent.logoUrl" alt="" />
              <span><strong>{{ entrantName(likelyOpponent) }}</strong><small>{{ entrantCoach(likelyOpponent) }} · {{ likelyOpponent.race ?? 'Race unavailable' }}</small></span>
              <span aria-hidden="true">→</span>
            </button>
          </section>

          <section class="content-panel" aria-labelledby="scheduled-matches-title">
            <div class="section-heading"><div><p class="eyebrow">YOUR FIXTURES</p><h3 id="scheduled-matches-title">Scheduled matches</h3></div></div>
            <p v-if="!detail.scheduledMatches.length" class="status-copy">You have no scheduled matches in this tournament.</p>
            <ul v-else class="match-list">
              <li v-for="match in detail.scheduledMatches" :key="match.matchId" class="match-row">
                <button v-if="match.opponentTeamId" class="team-link opponent-link" type="button" @click="showTeam(match.opponentTeamId)">
                  <span v-if="!match.opponentLogoUrl" class="team-crest" aria-hidden="true">{{ initials(opponentName(match)) }}</span>
                  <img v-else class="team-logo" :src="match.opponentLogoUrl" alt="" />
                  <span><strong>{{ opponentName(match) }}</strong><small>{{ match.opponentCoach }}</small></span>
                </button>
                <span v-else class="team-link opponent-link"><span><strong>{{ opponentName(match) }}</strong><small>{{ match.status }}</small></span></span>
                <span class="match-time"><small>Round {{ match.round }}</small><time v-if="match.scheduledAt" :datetime="match.scheduledAt">{{ formatDate(match.scheduledAt) }}</time><span v-else>To be arranged</span></span>
                <button
                  v-if="currentMatch?.matchId === match.matchId && activeWait"
                  class="waiting-button"
                  type="button"
                  @click="reopenWaiting"
                >Waiting…</button>
                <button v-else class="launch-button" type="button" :disabled="!match.canLaunch || activeWait" @click="launchMatch(match)">
                  {{ match.canLaunch ? (match.waiting ? 'Join opponent' : 'Launch match') : 'Not ready' }}
                </button>
              </li>
            </ul>
          </section>

          <section class="content-panel standings-panel" aria-labelledby="standings-title">
            <div class="section-heading"><div><p class="eyebrow">LIVE TABLE</p><h3 id="standings-title">Standings</h3></div><span>Click any team for its overview</span></div>
            <div class="table-scroll">
              <table class="standings-table">
                <caption class="sr-only">{{ detail.tournament.name }} standings after round {{ detail.tournament.currentRound }}</caption>
                <thead>
                  <tr><th scope="col">Rank</th><th scope="col">Team</th><th scope="col">Pts</th><th scope="col"><abbr title="Sonneborn–Berger strength of schedule">SB</abbr></th><th scope="col">Buchholz</th><th scope="col"><abbr title="Wins, draws and losses">W/D/L</abbr></th><th scope="col"><abbr title="Touchdown differential">TDD</abbr></th><th scope="col"><abbr title="Casualty differential">Cas diff</abbr></th><th scope="col"><abbr title="Casualties for and against">CF/CA</abbr></th><th scope="col"><abbr title="Touchdowns for and against">TDF/TDA</abbr></th></tr>
                </thead>
                <tbody>
                  <tr v-for="standing in detail.standings" :key="standing.teamId">
                    <th scope="row">{{ standing.rank }}</th>
                    <td>
                      <button v-if="teamFor(standing.teamId)" class="team-link standing-team" type="button" @click="showTeam(standing.teamId)">
                        <span v-if="!teamFor(standing.teamId)?.logoUrl" class="team-crest" aria-hidden="true">{{ initials(teamNameFor(standing.teamId)) }}</span>
                        <img v-else class="team-logo" :src="teamFor(standing.teamId)?.logoUrl ?? ''" alt="" />
                        <span><strong>{{ teamNameFor(standing.teamId) }}</strong><small>{{ teamCoachFor(standing.teamId, standing.coachId) }}</small></span>
                      </button>
                    </td>
                    <td class="numeric strong">{{ standing.points }}</td><td class="numeric">{{ standing.sonnebornBerger }}</td><td class="numeric">{{ standing.buchholz }}</td>
                    <td class="numeric">{{ standing.wins }}/{{ standing.draws }}/{{ standing.losses }}</td><td class="numeric">{{ signed(standing.touchdownDifferential) }}</td><td class="numeric">{{ signed(standing.casualtyDifferential) }}</td>
                    <td class="numeric">{{ standing.casualtiesFor }}/{{ standing.casualtiesAgainst }}</td><td class="numeric">{{ standing.touchdownsFor }}/{{ standing.touchdownsAgainst }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="content-panel rules-panel" aria-labelledby="tiebreakers-title">
            <div class="section-heading"><div><p class="eyebrow">RANKING RULES</p><h3 id="tiebreakers-title">Tiebreakers</h3></div><span>Applied in order</span></div>
            <ol class="tiebreaker-list">
              <li v-for="rule in tiebreakerRules" :key="rule.code"><span class="rule-order">{{ rule.order }}</span><div><strong>{{ rule.label }}</strong><p>{{ rule.description }}</p></div></li>
            </ol>
          </section>

          <section v-if="administration" class="content-panel administration-panel" aria-labelledby="administration-title">
            <div class="section-heading"><div><p class="eyebrow">SERVER-AUTHORIZED</p><h3 id="administration-title">Tournament owner dashboard</h3></div><span>Revision {{ administration.administration.revision }}</span></div>
            <p v-if="adminMessage" class="status-copy" role="status">{{ adminMessage }}</p>

            <!-- Owner: organizer live-edit panel (tournament-api.md) — pre-filled, only changed fields
                 PATCH; format/ruleset lock once rounds exist (server-enforced, mirrored here). -->
            <section class="admin-group" aria-labelledby="edit-tournament-title">
              <h4 id="edit-tournament-title">Edit tournament</h4>
              <form class="create-tournament-grid" @submit.prevent="submitEditTournament">
                <label class="ct-field"><span># of Players</span><input v-model.number="editDraft.maxPlayers" type="number" min="2" step="1" /></label>
                <label class="ct-field"><span>Starts at</span><input v-model="editDraft.startsAt" type="datetime-local" /></label>
                <label class="ct-field"><span>Type</span>
                  <select v-model="editDraft.format" :disabled="roundsExist" :title="roundsExist ? 'Format is locked once rounds exist.' : undefined">
                    <option value="swiss">Swiss</option>
                    <option value="roundRobin">Round-Robin</option>
                    <option value="knockout">Knockout</option>
                  </select>
                </label>
                <label class="ct-field"><span>Ruleset</span>
                  <select v-model="editDraft.packageName" :disabled="roundsExist" :title="roundsExist ? 'The ruleset is locked once rounds exist.' : undefined">
                    <option v-if="!createPackages.length" :value="editDraft.packageName">{{ editDraft.packageName || 'No saved packages' }}</option>
                    <option v-for="entry in createPackages" :key="entry.name" :value="entry.name">{{ entry.name }}</option>
                  </select>
                </label>
                <label class="ct-field"><span>Primary tiebreaker</span>
                  <select v-model="editDraft.primaryTiebreaker">
                    <option value="buchholz">Buchholz</option>
                    <option value="sonnebornBerger">SBR</option>
                  </select>
                </label>
                <button class="create-tournament-button ct-submit" type="submit" :disabled="editBusy">{{ editBusy ? 'Saving…' : 'Save Changes' }}</button>
              </form>
              <p v-if="editError" class="error-copy" role="alert">{{ editError }}</p>
            </section>

            <section class="admin-group" aria-labelledby="applications-review-title">
              <h4 id="applications-review-title">Pending applications</h4>
              <p v-if="!reviewApplications.length" class="status-copy">No applications awaiting review.</p>
              <article v-for="application in reviewApplications" :key="application.application.id" class="admin-row">
                <div><strong>{{ application.application.coachId }}</strong><span>Team {{ application.application.team.teamId }} · {{ application.application.status }}</span></div>
                <div class="validation-box compact" :class="application.validation.valid ? 'valid' : 'invalid'"><strong>{{ application.validation.valid ? 'Valid' : 'Invalid' }} now</strong><span>{{ application.validation.errors.join(' · ') || application.validation.warnings.join(' · ') || 'No validation findings.' }}</span></div>
                <label class="form-field"><span>Decline feedback</span><textarea v-model="applicationFeedback[application.application.id]" rows="2" /></label>
                <div class="row-actions">
                  <button class="secondary-button" type="button" :disabled="adminBusy" @click="runApplicationAction(application, 'pending')">Mark pending</button>
                  <button class="launch-button" type="button" :disabled="adminBusy || !application.validation.valid" @click="runApplicationAction(application, 'approve')">Approve</button>
                  <button class="secondary-button" type="button" :disabled="adminBusy" @click="runApplicationAction(application, 'decline')">Decline</button>
                  <button class="danger-button" type="button" :disabled="adminBusy" @click="runApplicationAction(application, 'ban')">Ban team</button>
                </div>
              </article>
            </section>

            <section class="admin-group" aria-labelledby="entrants-admin-title">
              <h4 id="entrants-admin-title">Entrants</h4>
              <details v-for="entrant in detail.entrants" :key="entrant.entrantId" class="admin-details">
                <summary><strong>{{ entrantName(entrant) }}</strong> · {{ entrantCoach(entrant) }}<span v-if="entrant.droppedAt"> · Dropped</span></summary>
                <div class="admin-form-grid">
                  <label class="form-field"><span>Replacement coach identity</span><input v-model="replacementCoach[entrant.entrantId]" /></label>
                  <label class="form-field"><span>Replacement team ID</span><input v-model="replacementTeam[entrant.entrantId]" /></label>
                  <label class="form-field wide"><span>Required reason</span><input v-model="entrantReason[entrant.entrantId]" /></label>
                </div>
                <div class="row-actions"><button class="secondary-button" type="button" :disabled="adminBusy || !replacementCoach[entrant.entrantId] || !replacementTeam[entrant.entrantId] || !entrantReason[entrant.entrantId]" @click="replaceEntrant(entrant)">Replace entrant</button><button class="danger-button" type="button" :disabled="adminBusy || !!entrant.droppedAt || !entrantReason[entrant.entrantId]" @click="dropEntrant(entrant)">Drop entrant</button></div>
              </details>
            </section>

            <section class="admin-group" aria-labelledby="adjudication-title">
              <h4 id="adjudication-title">Match adjudication</h4>
              <p v-if="!detail.scheduledMatches.length" class="status-copy">No visible scheduled matches.</p>
              <details v-for="match in detail.scheduledMatches" :key="match.matchId" class="admin-details">
                <summary>Round {{ match.round }} · {{ matchSides(match).map(side => side.coach.ffbCoachId).join(' vs ') || match.matchId }} · {{ match.status }}</summary>
                <template v-if="matchSides(match).length === 2 && match.revision !== undefined">
                  <div class="admin-form-grid">
                    <label class="form-field"><span>Winner</span><select v-model="adjudicationState(match).winnerEntrantId"><option v-for="side in matchSides(match)" :key="side.entrantId" :value="side.entrantId">{{ side.coach.ffbCoachId }}</option></select></label>
                    <label class="form-field"><span>Winner score</span><input v-model.number="adjudicationState(match).winnerScore" type="number" min="0" /></label>
                    <label class="form-field"><span>Loser score</span><input v-model.number="adjudicationState(match).loserScore" type="number" min="0" /></label>
                    <label class="form-field"><span>Winner casualties</span><input v-model.number="adjudicationState(match).winnerCasualties" type="number" min="0" /></label>
                    <label class="form-field"><span>Loser casualties</span><input v-model.number="adjudicationState(match).loserCasualties" type="number" min="0" /></label>
                    <label class="form-field wide"><span>Required reason</span><input v-model="adjudicationState(match).reason" /></label>
                  </div>
                  <button class="launch-button" type="button" :disabled="adminBusy || !adjudicationState(match).reason" @click="adjudicateMatch(match)">Record adjudication</button>
                </template>
                <p v-else class="status-copy">This pairing cannot be adjudicated from the current server projection.</p>
              </details>
            </section>

            <section v-if="detail.tournament.status === 'active'" class="admin-group finish-group" aria-labelledby="finish-title">
              <h4 id="finish-title">Finish tournament</h4>
              <p>Rank 1 is selected by default. Finishing requires explicit confirmation and generates award candidates.</p>
              <div class="admin-form-grid"><label class="form-field"><span>Winner</span><select v-model="finishWinnerId"><option v-for="entrant in detail.entrants" :key="entrant.entrantId" :value="entrant.entrantId">{{ entrantName(entrant) }} · {{ entrantCoach(entrant) }}</option></select></label><label class="form-field wide"><span>Reason (optional)</span><input v-model="finishReason" /></label></div>
              <button class="danger-button" type="button" :disabled="adminBusy || !finishWinnerId" @click="finishTournament">Finish tournament</button>
            </section>

            <section v-if="detail.tournament.awards" class="admin-group" aria-labelledby="awards-title">
              <h4 id="awards-title">Awards and overrides</h4>
              <details v-for="award in awardKeys" :key="award" class="admin-details">
                <summary>{{ award }} · candidates: {{ awardCandidateNames(award) }}</summary>
                <fieldset class="recipient-list"><legend>Recipients</legend><label v-for="entrant in detail.entrants" :key="entrant.entrantId"><input v-model="awardRecipients[award]" type="checkbox" :value="entrant.entrantId" /> {{ entrantName(entrant) }}</label></fieldset>
                <label class="form-field"><span>Required override reason</span><input v-model="awardReasons[award]" /></label>
                <button class="secondary-button" type="button" :disabled="adminBusy || !awardReasons[award]" @click="overrideAward(award)">Override recipients</button>
              </details>
            </section>

            <div class="row-actions"><button class="secondary-button" type="button" :disabled="adminBusy" @click="downloadNaf">Download NAF XML</button></div>
          </section>
        </template>
      </main>
    </div>

    <div v-if="waitingDialogVisible && currentMatch" class="dialog-backdrop" @click.self="dismissWaiting">
      <section ref="waitingDialog" class="waiting-dialog" role="alertdialog" aria-modal="true" aria-labelledby="waiting-title" tabindex="-1" @keydown.esc="dismissWaiting">
        <p class="eyebrow">MATCH LAUNCH</p>
        <h2 id="waiting-title">Waiting for Opponent</h2>
        <div class="waiting-opponent">
          <span v-if="!currentMatch.opponentLogoUrl" class="team-crest large" aria-hidden="true">{{ initials(opponentName(currentMatch)) }}</span>
          <img v-else class="team-logo large" :src="currentMatch.opponentLogoUrl" alt="" />
          <div><strong>{{ opponentName(currentMatch) }}</strong><span>{{ currentMatch.opponentCoach }}</span></div>
        </div>
        <p v-if="challenge.phase === 'submitting'" class="waiting-status" role="status">Sending your scheduled challenge…</p>
        <p v-else :class="challenge.phase === 'error' ? 'error-copy' : 'waiting-status'" role="status" aria-live="polite">{{ challenge.message }}</p>
        <p v-if="activeWait" class="polling-note">This screen checks for your opponent every two seconds. You may dismiss it and return while the wait continues.</p>
        <div class="dialog-actions">
          <button v-if="challenge.phase === 'error'" class="launch-button" type="button" @click="retryMatch">Retry</button>
          <button class="secondary-button" type="button" @click="selectAnotherMatch">Select another match</button>
          <button class="text-button" type="button" @click="dismissWaiting">Dismiss</button>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.tournaments-view { width: min(1500px, calc(100% - 40px)); margin: 0 auto; padding: 32px 0 64px; color: var(--ui-text); }
.view-heading, .detail-heading, .section-heading, .team-sheet-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.view-heading { margin-bottom: 24px; }
h1, h2, h3, p { margin: 0; }
h1 { color: var(--ui-heading); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(28px, 4vw, 44px)); letter-spacing: .02em; }
h2 { color: var(--ui-heading); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(22px, 3vw, 32px)); }
h3 { color: var(--ui-heading); font-size: max(var(--ui-min-primary-text-size, 16px), 18px); }
.view-heading > div > p:last-child, .detail-heading p, .team-sheet-heading p { margin-top: 5px; color: var(--ui-muted); }
.eyebrow { color: var(--ui-highlight, #d6ad62); font-size: max(var(--ui-min-text-size, 12px), 11px); font-weight: 700; letter-spacing: .17em; }
.tournament-layout { display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); gap: 22px; align-items: start; }
.tournament-picker, .content-panel, .team-sheet, .next-matchup, .empty-panel { border: 1px solid var(--ui-border); border-radius: 8px; background: color-mix(in srgb, var(--ui-surface) 94%, transparent); box-shadow: 0 12px 34px #0003; }
.tournament-picker { position: sticky; top: 16px; padding: 16px; }
.tournament-picker section + section { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--ui-border); }
.tournament-picker h2 { margin-bottom: 13px; font-size: max(var(--ui-min-primary-text-size, 16px), 16px); text-transform: uppercase; letter-spacing: .08em; }
.tournament-list { display: grid; gap: 8px; }
.tournament-card { display: grid; gap: 3px; width: 100%; padding: 13px; color: var(--ui-muted); text-align: left; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-surface-2); cursor: pointer; }
.tournament-card strong { color: var(--ui-text); font-size: max(var(--ui-min-primary-text-size, 16px), 15px); }
.tournament-card .season { color: var(--ui-highlight, #d6ad62); font-size: max(var(--ui-min-text-size, 12px), 10px); letter-spacing: .11em; text-transform: uppercase; }
.tournament-card[aria-current='true'], .tournament-card:hover { border-color: var(--ui-heading); background: color-mix(in srgb, var(--ui-primary) 18%, var(--ui-surface)); }
.tournament-detail { min-width: 0; display: grid; gap: 18px; }
.detail-heading { padding: 4px 2px 2px; }
.content-panel, .team-sheet { padding: 19px; }
.section-heading { align-items: end; margin-bottom: 14px; }
.section-heading > span { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 11px); }
.next-matchup { display: grid; grid-template-columns: minmax(170px, .6fr) minmax(250px, 1fr); gap: 16px; align-items: center; padding: 16px 19px; border-color: color-mix(in srgb, var(--ui-highlight, #d6ad62) 55%, var(--ui-border)); }
.matchup-link { justify-content: flex-start; padding: 8px 11px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-surface-2); }
.matchup-link > span:last-child { margin-left: auto; }
.team-link { display: inline-flex; align-items: center; gap: 9px; min-width: 0; padding: 0; color: var(--ui-text); text-align: left; border: 0; background: transparent; cursor: pointer; }
.team-link:hover strong, .team-link:focus-visible strong { color: var(--ui-highlight, #d6ad62); text-decoration: underline; }
.team-link > span { display: grid; min-width: 0; }
.team-link strong, .team-link small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.team-link small { color: var(--ui-muted); }
.team-crest, .team-logo { width: 38px; height: 38px; flex: 0 0 auto; border: 2px solid var(--ui-eggshell, #e9e0cb); border-radius: 50%; object-fit: cover; }
.team-crest { display: grid; place-items: center; box-sizing: border-box; color: var(--ui-eggshell, #e9e0cb); background: var(--ui-tier-1, #681717); font-size: max(var(--ui-min-text-size, 12px), 11px); font-weight: 800; }
.team-crest.large, .team-logo.large { width: 64px; height: 64px; font-size: max(var(--ui-min-primary-text-size, 16px), 16px); }
.match-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.match-row { display: grid; grid-template-columns: minmax(190px, 1fr) minmax(150px, .55fr) auto; gap: 14px; align-items: center; padding: 12px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-surface-2); }
.match-time { display: grid; color: var(--ui-text); font-size: max(var(--ui-min-text-size, 12px), 12px); }
.match-time small { color: var(--ui-muted); text-transform: uppercase; }
button { font: inherit; }
.launch-button, .waiting-button, .secondary-button, .text-button, .back-button, .danger-button, .create-tournament-button { padding: 9px 13px; color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 5px; background: var(--ui-surface-2); cursor: pointer; }
/* Owner: the organizer Create pane (replicates the tournaments.html panel). */
.create-tournament-button { color: var(--ui-text-on-primary); background: var(--ui-primary); border-color: var(--ui-heading); }
.create-tournament-button:disabled { opacity: .5; cursor: default; }
.create-tournament-pane { margin-bottom: 24px; padding: 16px; border: 1px solid var(--ui-border); border-radius: 7px; background: var(--ui-surface); }
.create-tournament-pane h2 { margin: 0 0 12px; color: var(--ui-heading); font-size: max(var(--ui-min-primary-text-size, 16px), 15px); letter-spacing: .08em; }
.create-tournament-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; max-width: 560px; }
.ct-field { display: grid; gap: 5px; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 11px); }
.ct-field.ct-full { grid-column: 1 / -1; }
.ct-field input, .ct-field select { padding: 7px 9px; color: var(--ui-text); background: var(--ui-secondary); border: 1px solid var(--ui-border); border-radius: 5px; font: inherit; }
.ct-submit { grid-column: 1 / -1; justify-self: start; }
.launch-button { color: #fff; border-color: #a62020; background: #7d0808; }
.danger-button { color: #fff; border-color: #d64a4a; background: #661313; }
.waiting-button { border-color: var(--ui-highlight, #d6ad62); color: var(--ui-highlight, #d6ad62); }
.text-button, .back-button { border-color: transparent; background: transparent; }
.back-button { justify-self: start; padding-left: 0; color: var(--ui-highlight, #d6ad62); }
button:disabled { opacity: .45; cursor: default; }
.table-scroll { max-width: 100%; overflow-x: auto; border: 1px solid var(--ui-border); border-radius: 6px; }
table { width: 100%; border-collapse: collapse; }
.standings-table { min-width: 930px; }
.roster-table { min-width: 1040px; }
th, td { padding: 10px 11px; border-bottom: 1px solid var(--ui-border); text-align: left; }
thead th { color: var(--ui-highlight, #d6ad62); background: color-mix(in srgb, var(--ui-primary) 34%, var(--ui-surface)); font-size: max(var(--ui-min-text-size, 12px), 11px); letter-spacing: .06em; text-transform: uppercase; }
tbody tr:nth-child(odd) { background: var(--ui-surface); }
tbody tr:nth-child(even) { background: var(--ui-surface-2); }
tbody tr:last-child > * { border-bottom: 0; }
.numeric { text-align: center; font-variant-numeric: tabular-nums; }
.strong { color: var(--ui-heading); font-weight: 800; }
abbr { text-decoration-style: dotted; text-underline-offset: 3px; cursor: help; }
.tiebreaker-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
.tiebreaker-list li { display: flex; gap: 11px; padding: 12px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-surface-2); }
.tiebreaker-list p { margin-top: 3px; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 12px); }
.rule-order { display: grid; place-items: center; width: 28px; height: 28px; flex: 0 0 auto; border-radius: 50%; color: var(--ui-eggshell, #e9e0cb); background: var(--ui-tier-1, #681717); }
.team-sheet { display: grid; gap: 22px; }
.team-sheet-heading { justify-content: flex-start; align-items: center; }
.team-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin: 0; }
.team-facts > div { padding: 11px; border: 1px solid var(--ui-border); border-radius: 5px; background: var(--ui-surface-2); }
.team-facts dt { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 10px); letter-spacing: .08em; text-transform: uppercase; }
.team-facts dd { margin: 4px 0 0; color: var(--ui-heading); font-weight: 800; }
.team-sheet section h3 { margin-bottom: 10px; }
.inert-build { display: grid; gap: 8px; padding: 16px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-surface-2); }
.mng-player { box-shadow: inset 3px 0 #b76330; }
.mng-player th { display: grid; gap: 2px; }
.mng-player th small { color: #e4a06f; font-size: max(var(--ui-min-text-size, 12px), 10px); letter-spacing: .08em; }
.status-copy { color: var(--ui-muted); }
.error-copy { color: #ff9292; }
.finished-search { display: grid; grid-template-columns: 1fr auto; gap: 5px; margin-bottom: 8px; }
.finished-search input, .form-field input, .form-field select, .form-field textarea { min-width: 0; padding: 8px; color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 4px; background: var(--ui-surface-2); font: inherit; }
.discovery-button { width: 100%; margin-top: 9px; }
.pagination { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 12px); }
.application-panel, .administration-panel, .admin-group, .admin-row, .application-status, .validation-box { display: grid; gap: 11px; }
.application-status, .validation-box, .admin-row, .admin-details { padding: 12px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-surface-2); }
.application-status > span, .application-status p, .validation-box span, .validation-box time { color: var(--ui-muted); }
.application-status strong { text-transform: capitalize; }
.validation-box.valid { border-left: 4px solid #55a66b; }
.validation-box.invalid { border-left: 4px solid #cf5555; }
.validation-box.compact { gap: 3px; }
.form-field { display: grid; gap: 5px; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 12px); }
.administration-panel { gap: 22px; border-color: color-mix(in srgb, var(--ui-highlight, #d6ad62) 55%, var(--ui-border)); }
.admin-group { padding-top: 16px; border-top: 1px solid var(--ui-border); }
.admin-group h4 { margin: 0; color: var(--ui-heading); font-size: max(var(--ui-min-primary-text-size, 16px), 15px); }
.admin-row > div:first-child { display: grid; }
.admin-row > div:first-child span { color: var(--ui-muted); }
.row-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.admin-details summary { color: var(--ui-heading); cursor: pointer; }
.admin-details[open] summary { margin-bottom: 12px; }
.admin-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-bottom: 10px; }
.admin-form-grid .wide { grid-column: 1 / -1; }
.finish-group p { color: var(--ui-muted); }
.recipient-list { display: flex; flex-wrap: wrap; gap: 9px 16px; margin: 0 0 10px; padding: 10px; color: var(--ui-muted); border: 1px solid var(--ui-border); }
.empty-panel { display: grid; gap: 12px; place-items: center; min-height: 200px; padding: 24px; color: var(--ui-muted); text-align: center; }
.dialog-backdrop { position: fixed; z-index: 90; inset: 0; display: grid; place-items: center; padding: 24px; background: #000c; }
.waiting-dialog { width: min(520px, 94vw); display: grid; gap: 16px; padding: 28px; color: var(--ui-text); border: 1px solid #7c2929; border-radius: 8px; background: #121212; box-shadow: 0 20px 70px #000b; outline: none; }
.waiting-opponent { display: flex; align-items: center; gap: 13px; padding: 13px; background: var(--ui-surface-2); border: 1px solid var(--ui-border); border-radius: 6px; }
.waiting-opponent div { display: grid; }
.waiting-opponent span { color: var(--ui-muted); }
.waiting-status { color: var(--ui-heading); font-size: max(var(--ui-min-primary-text-size, 16px), 15px); }
.polling-note { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 12px); }
.dialog-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 900px) {
  .tournament-layout { grid-template-columns: 1fr; }
  .tournament-picker { position: static; }
  .tournament-list { grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
  .team-facts { grid-template-columns: repeat(3, minmax(100px, 1fr)); }
}

@media (max-width: 680px) {
  .tournaments-view { width: min(100% - 22px, 1500px); padding-top: 20px; }
  .view-heading, .detail-heading, .section-heading { display: grid; }
  .next-matchup { grid-template-columns: 1fr; }
  .match-row { grid-template-columns: minmax(0, 1fr) auto; }
  .match-time { grid-column: 1 / -1; grid-row: 2; }
  .launch-button, .waiting-button { grid-column: 2; grid-row: 1; }
  .tiebreaker-list { grid-template-columns: 1fr; }
  .team-facts { grid-template-columns: repeat(2, minmax(100px, 1fr)); }
  .waiting-dialog { padding: 20px; }
  .dialog-actions > button { flex: 1 1 100%; }
  .admin-form-grid { grid-template-columns: 1fr; }
  .admin-form-grid .wide { grid-column: auto; }
}
</style>
