<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { GameListEntry } from '@fumbbl40k/ffb-protocol';
import superFumbblLogoUrl from '../../assets/resources/super-fumbbl-logo.png';
import { FUMBBL_SITE, activeServerTarget, applyServerTarget, settings } from '../../game/settings';
import {
  clearFumbblLobby,
  fumbblJoinByName,
  fumbblJoinLoaded,
  fumbblListGames,
  fumbblLobby,
  fumbblLobbyError,
  fumbblLobbyGameName,
  fumbblLobbyGames,
  fumbblLobbyListRequested,
  fumbblLobbyState,
  fumbblLobbyWaitTarget,
  readJnlpFile,
  routeJnlpRequest,
  stageFumbblPasswordLobby,
} from '../../game/jnlpRouting';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { teamLogoUrl } from '../../game/teamLogos';
import { fetchRecentFumbblMatches, type FumbblRecentMatch } from '../../game/fumbblRecentMatches';
import { parseActiveGames, phaseLabel, relativeTime, resultLetter, toBrowserMatch, type FumbblActiveGame, type FumbblActiveTeam } from '../../game/fumbblPlayBlade';
import { gameStore } from '../../game/store';
import { sharedReplayFileImporter } from '../../game/replay/replayFileImport';
import PostGamePanel from '../../components/PostGamePanel.vue';
import { loadPostGameSnapshot, postGameSnapshotKeys } from '../../game/postGameCache';
import { postGameKey, type PostGameSnapshot } from '../../game/postGameProjection';
import CreateGameModal from './play/CreateGameModal.vue';
import { FORK_EDITION } from '../../game/edition';

/**
 * Owner 09-25 (HANDOFF-fumbbl-play-blade.md): the FUMBBL Play blade. Header "Play" + Open JNLP; left card
 * "My Active Games" (a loaded JNLP first, then every game the coach is in per /api/match/current, each with
 * Resume); right card "My Recent Games" (public API) with in-client Replay. Super FUMBBL (fork edition) keeps
 * its own button, as before. Crests are ours (teamLogoUrl) — never FUMBBL's CDN.
 */
interface TeamPreview {
  name: string;
  teamId?: string;
  coach?: string;
  race?: string;
  teamValue?: number;
  logoUrl?: string;
  baseIconPath?: string;
}

const fileInput = ref<HTMLInputElement | null>(null);
const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
const coach = computed(() => settings.coach.trim());
/** Resume/lobby joins run the password challenge — they need the stored password; the lists do not. */
const canResume = computed(() => !!coach.value && !!settings.password);
const fetchedTeam = ref<TeamPreview | null>(null);
const fetchedOpponentTeam = ref<TeamPreview | null>(null);
const loadError = ref('');
const failedLogos = ref(new Set<'own' | 'opponent'>());
const createGameOpen = ref(false);
const checkmark = String.fromCodePoint(10003);
const playGlyph = String.fromCodePoint(9654);
let previewLoad = 0;

// ---- My Active Games (live FUMBBL games the coach is in) ----
const activeGames = ref<FumbblActiveGame[]>([]);
const activeError = ref('');
const activeLoading = ref(false);
const ACTIVE_POLL_MS = 45_000;
let activePoll: ReturnType<typeof setInterval> | null = null;
async function refreshActive(): Promise<void> {
  if (!coach.value) { activeGames.value = []; return; }
  activeLoading.value = true;
  try {
    const res = await fetch(`${FUMBBL_SITE}/api/match/current`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    activeGames.value = parseActiveGames(await res.json(), coach.value);
    activeError.value = '';
  } catch (error) {
    activeError.value = `Could not load your live games: ${error instanceof Error ? error.message : String(error)}`;
  } finally { activeLoading.value = false; }
}
/** The lobby's own list may hold a waiting (not yet started) game that /api/match/current does not show. */
const listedGames = computed(() => fumbblLobbyListRequested.value
  ? fumbblLobbyGames.value.filter((e) => !activeGames.value.some((g) => g.id === Number(e.gameId)))
  : []);
const activeCount = computed(() => activeGames.value.length + listedGames.value.length + (fumbblLobby.value && !fumbblLobby.value.password ? 1 : 0));

// Resume: open the password lobby, then spend the join on that game once the socket is ready.
const pendingResume = ref<FumbblActiveGame | null>(null);
function resumeGame(game: FumbblActiveGame): void {
  if (!canResume.value) return;
  applyServerTarget('fumbbl');
  pendingResume.value = game;
  stageFumbblPasswordLobby(coach.value, settings.password);
}
watch(fumbblLobbyState, (state) => {
  const game = pendingResume.value;
  if (!game) return;
  if (state === 'ready' && fumbblLobby.value?.password) {
    pendingResume.value = null;
    fumbblJoinLoaded(game.id, toBrowserMatch(game));
  } else if (state === 'idle' || state === 'closed') pendingResume.value = null;
});
function openLobby(): void {
  if (!canResume.value) return;
  applyServerTarget('fumbbl');
  stageFumbblPasswordLobby(coach.value, settings.password);
}

// ---- My Recent Games ----
const recent = ref<FumbblRecentMatch[]>([]);
const recentError = ref('');
const recentLoading = ref(false);
async function refreshRecent(): Promise<void> {
  if (!coach.value) { recent.value = []; return; }
  recentLoading.value = true;
  try {
    const { matches } = await fetchRecentFumbblMatches(coach.value, inTauri ? (tauriFetch as (u: string) => Promise<Response>) : fetch);
    recent.value = matches;
    recentError.value = '';
  } catch (error) {
    recentError.value = `Could not load your recent games: ${error instanceof Error ? error.message : String(error)}`;
  } finally { recentLoading.value = false; }
}
function replayMatch(row: FumbblRecentMatch): void {
  sharedReplayFileImporter.invalidate();
  applyServerTarget('fumbbl');
  const target = activeServerTarget();
  detailsRow.value = null;
  void gameStore.connectReplay({ url: target.url, compression: target.compression, coach: coach.value, gameId: row.replayId });
}
// Owner 09-25: DETAILS — the end-of-game pane as the coach saw it, from the 7-day cache (game/postGameCache.ts),
// in a large centred popup with the Dice pane reachable; Replay stays inside as the fallback / companion.
const detailsKeys = ref<Set<string>>(new Set());
const detailsRow = ref<FumbblRecentMatch | null>(null);
const detailsSnapshot = ref<PostGameSnapshot | null>(null);
const detailsLoading = ref(false);
const detailsPanel = ref<InstanceType<typeof PostGamePanel> | null>(null);
function detailsKeyFor(row: FumbblRecentMatch): string { return postGameKey('fumbbl', row.replayId); }
function hasDetails(row: FumbblRecentMatch): boolean { return detailsKeys.value.has(detailsKeyFor(row)); }
async function refreshDetailsKeys(): Promise<void> { detailsKeys.value = await postGameSnapshotKeys(); }
async function openDetails(row: FumbblRecentMatch): Promise<void> {
  detailsRow.value = row; detailsSnapshot.value = null; detailsLoading.value = true;
  try { detailsSnapshot.value = await loadPostGameSnapshot(detailsKeyFor(row)); } finally { detailsLoading.value = false; }
}
function closeDetails(): void { detailsRow.value = null; detailsSnapshot.value = null; }
function onDetailsKey(event: KeyboardEvent): void { if (event.key === 'Escape') closeDetails(); }

onMounted(() => {
  void refreshActive(); void refreshRecent(); void refreshDetailsKeys();
  activePoll = setInterval(() => void refreshActive(), ACTIVE_POLL_MS);
});
onUnmounted(() => { if (activePoll) clearInterval(activePoll); activePoll = null; });
watch(coach, () => { void refreshActive(); void refreshRecent(); });

// ---- Loaded JNLP card ----
const ownTeam = computed<TeamPreview | null>(() => {
  const lobby = fumbblLobby.value;
  if (!lobby) return null;
  return {
    name: fetchedTeam.value?.name || lobby.teamName || lobby.teamId,
    coach: fetchedTeam.value?.coach || lobby.coach || undefined,
    race: fetchedTeam.value?.race,
    teamValue: fetchedTeam.value?.teamValue,
    logoUrl: fetchedTeam.value?.logoUrl,
    baseIconPath: fetchedTeam.value?.baseIconPath,
  };
});

function ownSide(entry: GameListEntry): 'home' | 'away' | null {
  const teamId = fumbblLobby.value?.teamId;
  if (teamId && String(entry.teamHomeId ?? '') === teamId) return 'home';
  if (teamId && String(entry.teamAwayId ?? '') === teamId) return 'away';
  if (teamId) return null;
  const lobbyCoach = fumbblLobby.value?.coach.toLowerCase();
  if (lobbyCoach && entry.teamHomeCoach?.toLowerCase() === lobbyCoach) return 'home';
  if (lobbyCoach && entry.teamAwayCoach?.toLowerCase() === lobbyCoach) return 'away';
  return null;
}
function ownTeamName(entry: GameListEntry): string {
  return (ownSide(entry) === 'away' ? entry.teamAwayName : entry.teamHomeName) || '';
}
function opponentFor(entry: GameListEntry): TeamPreview {
  const own = ownSide(entry);
  return own === 'away'
    ? { name: entry.teamHomeName || 'Opponent', teamId: entry.teamHomeId || undefined, coach: entry.teamHomeCoach || undefined }
    : { name: entry.teamAwayName || 'Opponent', teamId: entry.teamAwayId || undefined, coach: entry.teamAwayCoach || undefined };
}

const selectedEntry = computed(() => {
  const gameId = fumbblLobby.value?.gameId;
  return gameId ? fumbblLobbyGames.value.find((entry) => Number(entry.gameId) === gameId) : undefined;
});
const opponentTeam = computed<TeamPreview | null>(() => {
  if (!selectedEntry.value) return null;
  const listed = opponentFor(selectedEntry.value);
  const fetched = fetchedOpponentTeam.value;
  if (!fetched) return listed;
  return { ...listed, ...fetched, name: fetched.name || listed.name, teamId: fetched.teamId || listed.teamId, coach: fetched.coach || listed.coach };
});
const lobbyReady = computed(() => fumbblLobbyState.value === 'ready');
const lobbyStatus = computed(() => {
  switch (fumbblLobbyState.value) {
    case 'connecting': return 'Opening connection to FUMBBL…';
    case 'versioning': return 'Checking FUMBBL client compatibility…';
    case 'authenticating': return 'Authenticating the JNLP with FUMBBL…';
    case 'joining': return `Request sent — waiting for ${fumbblLobbyWaitTarget.value || 'opponent'}…`;
    // SERVER_JOIN acknowledges our lobby entry and consumes the one-time token. It does not mean an opponent
    // exists: only the following SERVER_GAME_STATE proves the match is ready, and that handoff closes this blade.
    case 'joined': return `Joined lobby — waiting for ${fumbblLobbyWaitTarget.value || 'opponent'}…`;
    default: return '';
  }
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function optionalNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
function normalizeTeam(raw: Record<string, unknown>): TeamPreview {
  const roster = asRecord(raw.roster);
  const coachRecord = asRecord(raw.coach);
  const rosterName = optionalString(roster?.name) || optionalString(roster?.rosterName);
  return {
    name: optionalString(raw.name) || optionalString(raw.teamName) || '',
    coach: optionalString(raw.coach) || optionalString(coachRecord?.name),
    race: optionalString(raw.race) || rosterName,
    teamValue: optionalNumber(raw.teamValue) ?? optionalNumber(raw.value) ?? optionalNumber(raw.tv),
    logoUrl: optionalString(raw.logoUrl) || optionalString(roster?.logoUrl),
    baseIconPath: optionalString(raw.baseIconPath) || optionalString(roster?.baseIconPath),
  };
}

async function loadPreviewData(): Promise<void> {
  const lobby = fumbblLobby.value;
  const load = ++previewLoad;
  fetchedTeam.value = null;
  fetchedOpponentTeam.value = null;
  failedLogos.value = new Set();
  if (!lobby) return;
  const fetchTeam = (teamId: string | undefined): Promise<TeamPreview | null> => teamId
    ? fetch(`${FUMBBL_SITE}/api/team/get/${encodeURIComponent(teamId)}`)
      .then(async (response) => response.ok ? normalizeTeam(await response.json() as Record<string, unknown>) : null)
      .catch(() => null)
    : Promise.resolve(null);
  const listedOpponent = selectedEntry.value ? opponentFor(selectedEntry.value) : null;
  const [nextTeam, nextOpponent] = await Promise.all([fetchTeam(lobby.teamId), fetchTeam(listedOpponent?.teamId)]);
  if (load !== previewLoad) return;
  fetchedTeam.value = nextTeam;
  fetchedOpponentTeam.value = nextOpponent;
}
watch([fumbblLobby, selectedEntry], () => { void loadPreviewData(); }, { immediate: true });

async function openJnlpFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  loadError.value = '';
  if (!file) return;
  try {
    const request = await readJnlpFile(file);
    const result = routeJnlpRequest(request, { deferFumbblPlayer: true, sourceName: file.name });
    if (result === 'invalid') loadError.value = 'This file does not contain a playable FUMBBL request.';
  } catch (error) {
    loadError.value = `Could not read the JNLP file: ${error instanceof Error ? error.message : String(error)}`;
  }
}
function launchNamed(): void { fumbblJoinByName(); }
function launchListed(entry: GameListEntry): void {
  const opponent = opponentFor(entry);
  fumbblJoinLoaded(Number(entry.gameId), {
    id: Number(entry.gameId), half: 0, turn: 0,
    teams: [
      { side: ownSide(entry) ?? 'home', name: ownTeam.value?.name ?? '', coach: ownTeam.value?.coach ?? '', race: ownTeam.value?.race ?? '', score: 0, teamId: fumbblLobby.value?.teamId },
      { side: ownSide(entry) === 'away' ? 'home' : 'away', name: opponent.name, coach: opponent.coach ?? '', race: '', score: 0, teamId: opponent.teamId },
    ],
  });
}

// Owner 08-18: an explicit logoUrl resolves as before; a race-only team gets its in-game race crest (teamLogos.ts)
// before falling back to initials.
function logo(team: TeamPreview | null, side: 'own' | 'opponent'): string | null {
  if (!team || failedLogos.value.has(side)) return null;
  return teamLogoUrl(team);
}
function markLogoFailed(side: 'own' | 'opponent'): void {
  const next = new Set(failedLogos.value);
  next.add(side);
  failedLogos.value = next;
}
function crest(team: FumbblActiveTeam): string | null { return teamLogoUrl({ race: team.race, side: team.side }); }
function recentCrest(row: FumbblRecentMatch, who: 'my' | 'opponent'): string | null {
  const race = who === 'my' ? row.myRace : row.opponentRace;
  return race ? teamLogoUrl({ race, side: who === 'my' ? 'home' : 'away' }) : null;
}
function initials(name: string | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '—';
  return words.length === 1 ? words[0]!.slice(0, 2).toUpperCase() : words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join('');
}
function formatTeamValue(value: number | undefined): string | undefined {
  if (!value) return undefined;
  const thousands = value >= 10_000 ? Math.round(value / 1_000) : Math.round(value);
  return `TV ${thousands.toLocaleString()}k`;
}
function myRecent(row: FumbblRecentMatch): 'W' | 'L' | 'D' { return resultLetter(row.myScore, row.opponentScore); }
</script>

<template>
  <main class="play-view" aria-label="FUMBBL Play">
    <header class="play-head">
      <h1 id="play-title">Play</h1>
      <div class="head-actions">
        <!-- Owner 09-25: Super FUMBBL games keep their own button (fork edition), as before. -->
        <button v-if="FORK_EDITION" class="bevel super-button" type="button" @click="createGameOpen = true">
          <img :src="superFumbblLogoUrl" alt="" />
          <span>Play on Super FUMBBL</span>
          <span class="test-environment-splash">TEST ENVIRONMENT</span>
        </button>
        <button class="bevel" type="button" @click="fileInput?.click()">Open JNLP</button>
      </div>
    </header>
    <p v-if="loadError" class="load-error" role="alert">{{ loadError }}</p>

    <div class="play-body">
      <section class="card list-card active-card" aria-labelledby="active-title">
        <h2 id="active-title">My Active Games <span class="count">{{ activeCount }}</span></h2>
        <p v-if="!coach" class="empty">Set your FUMBBL coach name in Settings to see your games here.</p>

        <template v-if="fumbblLobby">
          <article v-if="!fumbblLobby.password" class="loaded-card">
            <p class="loaded-line">
              {{ checkmark }} {{ fumbblLobby.sourceName || 'JNLP loaded' }}
              <template v-if="fumbblLobby.gameId"> &middot; game {{ fumbblLobby.gameId }}</template>
            </p>
            <div class="match-grid">
              <div class="team-side" data-team-side="own">
                <span class="team-coach">{{ ownTeam?.coach || 'Coach unavailable' }}</span>
                <span class="team-logo-frame">
                  <img v-if="logo(ownTeam, 'own')" class="race-logo" :src="logo(ownTeam, 'own')!" :alt="`${ownTeam?.name || 'Team'} logo`" @error="markLogoFailed('own')" />
                  <span v-else class="logo-fallback" aria-hidden="true">{{ initials(ownTeam?.name) }}</span>
                </span>
                <strong class="team-name">{{ ownTeam?.name || '—' }}</strong>
                <small v-if="ownTeam?.race" class="team-race">{{ ownTeam.race }}</small>
                <small v-if="formatTeamValue(ownTeam?.teamValue)" class="team-tv">{{ formatTeamValue(ownTeam?.teamValue) }}</small>
              </div>
              <span class="versus">VS</span>
              <div class="team-side" data-team-side="opponent">
                <span class="team-coach">{{ opponentTeam?.coach || 'Coach unavailable' }}</span>
                <span class="team-logo-frame">
                  <img v-if="logo(opponentTeam, 'opponent')" class="race-logo" :src="logo(opponentTeam, 'opponent')!" :alt="`${opponentTeam?.name || 'Opponent'} logo`" @error="markLogoFailed('opponent')" />
                  <span v-else class="logo-fallback" aria-hidden="true">{{ initials(opponentTeam?.name) }}</span>
                </span>
                <strong class="team-name">{{ opponentTeam?.name || 'Opponent unavailable' }}</strong>
                <small v-if="opponentTeam?.race" class="team-race">{{ opponentTeam.race }}</small>
                <small v-if="formatTeamValue(opponentTeam?.teamValue)" class="team-tv">{{ formatTeamValue(opponentTeam?.teamValue) }}</small>
              </div>
              <button v-if="fumbblLobby.gameId" class="bevel play-button" type="button" :disabled="!lobbyReady" @click="fumbblJoinLoaded(fumbblLobby.gameId)">
                {{ playGlyph }} Play
              </button>
              <span v-else class="play-slot" aria-hidden="true"></span>
            </div>
            <form class="lobby-controls" @submit.prevent="launchNamed">
              <label for="fumbbl-game-name">Game name</label>
              <div class="join-row">
                <input id="fumbbl-game-name" v-model="fumbblLobbyGameName" type="text" autocomplete="off" placeholder="Both coaches enter the same name" />
                <button class="bevel small" type="submit" :disabled="!lobbyReady || !fumbblLobbyGameName.trim()">{{ playGlyph }} Join</button>
              </div>
              <div class="lobby-actions">
                <button class="plain" type="button" :disabled="!lobbyReady" @click="fumbblListGames">List Games</button>
                <button class="plain" type="button" @click="clearFumbblLobby">Cancel</button>
                <small v-if="lobbyStatus" role="status" aria-live="polite">{{ lobbyStatus }}</small>
              </div>
            </form>
          </article>
          <article v-else class="lobby-card">
            <p class="loaded-line">{{ checkmark }} FUMBBL lobby as {{ fumbblLobby.coach }}</p>
            <div class="lobby-actions">
              <button class="plain" type="button" :disabled="!lobbyReady" @click="fumbblListGames">List Games</button>
              <button class="plain" type="button" @click="clearFumbblLobby">Cancel</button>
              <small v-if="lobbyStatus" role="status" aria-live="polite">{{ lobbyStatus }}</small>
              <small v-else-if="fumbblLobbyListRequested && !fumbblLobbyGames.length" class="lobby-note">No waiting games in the lobby.</small>
            </div>
          </article>
          <p v-if="fumbblLobbyError" class="load-error" role="alert">{{ fumbblLobbyError }}</p>
          <div v-if="fumbblLobbyListRequested" class="game-list" aria-live="polite">
            <p v-if="!fumbblLobby.password && !fumbblLobbyGames.length" class="empty">You do not have any open games to join.</p>
            <button
              v-for="entry in (fumbblLobby.password ? listedGames : fumbblLobbyGames)"
              :key="entry.gameId"
              class="game-entry"
              type="button"
              :disabled="!lobbyReady || ownSide(entry) === null"
              @click="launchListed(entry)"
            >
              <span class="game-entry-team">
                <small v-if="fumbblLobby.password" class="game-entry-coach">{{ ownTeamName(entry) }} vs</small>
                <small class="game-entry-coach">{{ opponentFor(entry).coach || 'Coach unavailable' }}</small>
                <span class="game-entry-identity">
                  <span class="game-entry-logo-fallback" aria-hidden="true">{{ initials(opponentFor(entry).name) }}</span>
                  <strong>{{ opponentFor(entry).name }}</strong>
                </span>
              </span>
              <span class="game-entry-action">Game {{ entry.gameId }} &middot; Join</span>
            </button>
          </div>
        </template>

        <article v-for="game in activeGames" :key="game.id" class="game-row" :data-mine="game.mine">
          <div class="row-team home">
            <img v-if="crest(game.home)" class="row-logo" :src="crest(game.home)!" alt="" />
            <span v-else class="row-logo logo-fallback" aria-hidden="true">{{ initials(game.home.name) }}</span>
            <span class="row-text">
              <strong class="row-name">{{ game.home.name }}</strong>
              <small class="row-meta">{{ game.home.coach }}</small>
              <small v-if="formatTeamValue(game.home.tv)" class="row-meta">{{ formatTeamValue(game.home.tv) }}</small>
            </span>
          </div>
          <div class="row-centre">
            <span class="row-score">{{ game.home.score }} &ndash; {{ game.away.score }}</span>
            <span class="row-phase">{{ phaseLabel(game) }}</span>
          </div>
          <div class="row-team away">
            <img v-if="crest(game.away)" class="row-logo" :src="crest(game.away)!" alt="" />
            <span v-else class="row-logo logo-fallback" aria-hidden="true">{{ initials(game.away.name) }}</span>
            <span class="row-text">
              <strong class="row-name">{{ game.away.name }}</strong>
              <small class="row-meta">{{ game.away.coach }}</small>
              <small v-if="formatTeamValue(game.away.tv)" class="row-meta">{{ formatTeamValue(game.away.tv) }}</small>
            </span>
          </div>
          <button
            class="bevel resume-button"
            type="button"
            :disabled="!canResume || (pendingResume?.id === game.id)"
            :title="canResume ? `Reconnect to game ${game.id}` : 'Save your FUMBBL password in Settings to resume from here'"
            @click="resumeGame(game)"
          >{{ pendingResume?.id === game.id ? 'Connecting…' : 'Resume' }}</button>
        </article>

        <p v-if="activeError" class="load-error" role="alert">{{ activeError }}</p>
        <p v-if="coach && !activeCount && !activeLoading" class="empty">No active games</p>
        <div v-if="coach" class="card-foot">
          <button class="link" type="button" :disabled="activeLoading" @click="refreshActive">{{ activeLoading ? 'Refreshing…' : 'Refresh' }}</button>
          <button v-if="canResume && !fumbblLobby" class="link" type="button" data-testid="my-fumbbl-games" @click="openLobby">Check the FUMBBL lobby for waiting games</button>
          <small v-else-if="!settings.password" class="lobby-note">Save your FUMBBL password in Settings to resume games from here.</small>
        </div>
      </section>

      <!-- Owner 09-25: My Recent Games mirrors the Active Games card — same rows (crest · name · coach · TV | score |
           opponent | action), stacked under it. Races/TV come from the FUMBBL match API (fumbblRecentMatches). -->
      <section class="card list-card recent-card" aria-labelledby="recent-title">
        <h2 id="recent-title">My Recent Games <span class="count">{{ recent.length }}</span></h2>
        <p v-if="!coach" class="empty">Set your FUMBBL coach name in Settings.</p>
        <p v-else-if="recentError" class="load-error" role="alert">{{ recentError }}</p>
        <p v-else-if="recentLoading && !recent.length" class="empty">Loading&hellip;</p>
        <p v-else-if="!recent.length" class="empty">No recent games</p>
        <div v-else class="recent-list">
          <article v-for="row in recent" :key="row.matchId" class="game-row recent-row" :data-cached="hasDetails(row)">
            <div class="row-team home">
              <img v-if="recentCrest(row, 'my')" class="row-logo" :src="recentCrest(row, 'my')!" alt="" />
              <span v-else class="row-logo logo-fallback" aria-hidden="true">{{ initials(row.myTeam) }}</span>
              <span class="row-text">
                <strong class="row-name">{{ row.myTeam }}</strong>
                <small class="row-meta">{{ coach }}</small>
                <small v-if="formatTeamValue(row.myTv)" class="row-meta">{{ formatTeamValue(row.myTv) }}</small>
              </span>
            </div>
            <div class="row-centre">
              <span class="row-score">{{ row.myScore }} &ndash; {{ row.opponentScore }}</span>
              <span class="row-phase"><b class="row-result" :data-result="myRecent(row)">{{ myRecent(row) }}</b> &middot; {{ relativeTime(row.when) }}</span>
            </div>
            <div class="row-team away">
              <img v-if="recentCrest(row, 'opponent')" class="row-logo" :src="recentCrest(row, 'opponent')!" alt="" />
              <span v-else class="row-logo logo-fallback" aria-hidden="true">{{ initials(row.opponentTeam) }}</span>
              <span class="row-text">
                <strong class="row-name">{{ row.opponentTeam }}</strong>
                <small class="row-meta">{{ row.opponentCoach }}</small>
                <small v-if="formatTeamValue(row.opponentTv)" class="row-meta">{{ formatTeamValue(row.opponentTv) }}</small>
              </span>
            </div>
            <button class="bevel resume-button details-button" type="button" :data-cached="hasDetails(row)" :title="hasDetails(row) ? `End-of-game details for match ${row.matchId}` : `No stored details for match ${row.matchId} — replay it from here`" @click="openDetails(row)">Details</button>
          </article>
        </div>
      </section>
    </div>

    <!-- Owner 09-25: DETAILS popup — the cached end-of-game pane (Result / MVP / Statistics / Roster + Dice). -->
    <div v-if="detailsRow" class="details-modal" role="dialog" aria-modal="true" :aria-label="`Details: ${detailsRow.myTeam} vs ${detailsRow.opponentTeam}`" tabindex="-1" @click.self="closeDetails" @keydown="onDetailsKey">
      <div class="details-card">
        <header class="details-head">
          <span class="details-title">{{ detailsRow.myTeam }} <span class="vs">vs</span> {{ detailsRow.opponentTeam }}</span>
          <small class="details-when">{{ relativeTime(detailsRow.when) }} &middot; match {{ detailsRow.matchId }}</small>
          <button class="details-close" type="button" aria-label="Close details" @click="closeDetails">&#x2715;</button>
        </header>
        <div class="details-body">
          <p v-if="detailsLoading" class="empty">Loading&hellip;</p>
          <PostGamePanel v-else-if="detailsSnapshot" ref="detailsPanel" :snapshot="detailsSnapshot" embedded :default-roster-side="detailsSnapshot.game.teamHome.teamId === String(detailsRow.myTeamId) ? 'home' : 'away'" :skill-mode="settings.skillDisplay === 'markings' ? 'markings' : 'icons'" />
          <div v-else class="details-missing">
            <p class="empty">No details stored for this game.</p>
            <small>Details are kept for games finished in this client during the last 7 days. Replay it to watch it again.</small>
          </div>
        </div>
        <footer class="details-foot">
          <button v-if="detailsSnapshot" class="plain" type="button" @click="detailsPanel?.openDice()">Dice</button>
          <button class="bevel replay-button" type="button" :disabled="gameStore.replay.loading" @click="replayMatch(detailsRow)">Replay</button>
        </footer>
      </div>
    </div>
    <input ref="fileInput" class="file-input" type="file" accept=".jnlp,text/xml,application/xml" @change="openJnlpFile" />
    <CreateGameModal v-if="FORK_EDITION && createGameOpen" @close="createGameOpen = false" />
  </main>
</template>

<style scoped>
/* Owner 09-25: HANDOFF-fumbbl-play-blade.md layout, in the FUMBBL colour styling the Spectate blade's FUMBBL side
   uses (theme.ts --ui-eggshell / --ui-old-lace / --ui-forest; carmine #790004 stays the action accent). Cards stack:
   My Active Games, then My Recent Games in the same card/row design. Crests are the 128 px masters at 1:1. */
.play-view { --pb-text: var(--ui-forest, #1A401C); --pb-muted: color-mix(in srgb, var(--ui-forest, #1A401C) 62%, transparent); --pb-line: color-mix(in srgb, var(--ui-forest, #1A401C) 28%, transparent); --pb-carmine: #790004;
  box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; flex: 1; width: 100%; max-width: 1440px; min-height: calc(100vh - 95px); margin: 0 auto; padding: 18px 20px; color: var(--pb-text); background: var(--ui-eggshell, #E7DDC7); }
h1, h2, p { margin: 0; }
.play-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
h1 { color: var(--pb-text); font-family: 'Nuffle', system-ui, sans-serif; font-size: 40px; font-weight: 800; letter-spacing: .04em; line-height: 1; text-transform: uppercase; text-shadow: 2px 2px 0 rgba(26, 64, 28, .22); }
.head-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.bevel {
  padding: 12px 26px;
  border: 2px outset #a83236;
  border-radius: 4px;
  color: #fff;
  background: var(--pb-carmine);
  box-shadow: 0 2px 6px rgba(0, 0, 0, .35);
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: .04em;
  line-height: 1;
  text-transform: uppercase;
  text-shadow: 2px 2px 0 #000;
  cursor: pointer;
}
.bevel:hover:not(:disabled) { filter: brightness(1.25); }
.bevel:disabled { opacity: .45; cursor: default; filter: none; }
.bevel:focus-visible { outline: 2px solid var(--pb-carmine); outline-offset: 2px; }
.bevel.small { font-size: 18px; padding: 9px 16px; }
.super-button { display: inline-flex; align-items: center; gap: 10px; padding-block: 8px; background: #101010; border-color: #444; }
.super-button img { height: 30px; }
.test-environment-splash {
  box-sizing: border-box;
  padding: 3px 6px 2px;
  border: 2px solid #efc957;
  color: #fff5b0;
  background: linear-gradient(#ffffff14 0 48%, transparent 48% 100%), #8f111b;
  box-shadow: 0 2px 0 #2e0205, inset 0 0 0 1px #3b0307;
  font-size: 10px;
  letter-spacing: .08em;
  text-shadow: 1px 1px 0 #3b0307;
  white-space: nowrap;
}
.plain { padding: 8px 14px; color: var(--pb-text); border: 1px solid var(--pb-text); background: var(--ui-old-lace, #F8F5E7); cursor: pointer; }
.plain:disabled { opacity: .45; cursor: default; }
.link { padding: 0; color: var(--pb-carmine); border: 0; background: none; font: inherit; text-decoration: underline; cursor: pointer; }
.link:disabled { opacity: .5; cursor: default; }

.play-body { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: start; }
.card { box-sizing: border-box; min-width: 0; border: 1px solid var(--pb-text); border-radius: 6px; background: var(--ui-old-lace, #F8F5E7); box-shadow: 0 4px 14px rgba(26, 64, 28, .18); }
.list-card { display: flex; flex-direction: column; gap: 10px; padding: 18px 22px; }
h2 { display: flex; align-items: center; gap: 10px; color: var(--pb-carmine); font-family: 'Nuffle', system-ui, sans-serif; font-size: 24px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; text-shadow: 2px 2px 0 rgba(26, 64, 28, .18); }
.count { padding: 2px 10px; border-radius: 999px; color: var(--pb-text); background: color-mix(in srgb, var(--ui-forest, #1A401C) 14%, transparent); font-size: 14px; text-shadow: none; }
.empty { padding: 18px 0; color: var(--pb-muted); font-size: 18px; text-align: center; }
.load-error { color: #8f111b; font-size: 14px; }
.card-foot { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; font-size: 14px; }
.lobby-note { color: var(--pb-muted); }

/* Loaded-JNLP card */
.loaded-card, .lobby-card { display: grid; gap: 12px; padding: 14px 18px; border: 1px solid var(--pb-carmine); border-radius: 4px; background: var(--ui-eggshell, #E7DDC7); }
.loaded-line { color: #2f8f46; font-size: 14px; }
.match-grid { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; align-items: center; gap: 16px; }
.team-side { display: grid; grid-template-columns: 128px auto auto auto minmax(0, 1fr); column-gap: 12px; row-gap: 2px; align-items: center; min-width: 0; }
.team-logo-frame { grid-column: 1; grid-row: 1 / span 2; display: grid; place-items: center; width: 128px; height: 128px; }
.team-name { grid-column: 2 / -1; grid-row: 1; min-width: 0; color: var(--pb-text); font-size: max(var(--ui-min-primary-text-size, 16px), 24px); font-weight: 500; line-height: 1.15; overflow-wrap: anywhere; }
.team-coach { grid-column: 2; grid-row: 2; }
.team-race { grid-column: 3; grid-row: 2; }
.team-tv { grid-column: 4; grid-row: 2; }
.team-coach, .team-race, .team-tv { color: var(--pb-muted); font-size: 18px; line-height: 1.2; white-space: nowrap; }
.team-race::before, .team-tv::before { content: '\00b7\00a0'; }
[data-team-side="opponent"] { grid-template-columns: minmax(0, 1fr) auto auto auto 128px; text-align: right; }
[data-team-side="opponent"] .team-logo-frame { grid-column: 5; }
[data-team-side="opponent"] .team-name { grid-column: 1 / 5; }
[data-team-side="opponent"] .team-coach { grid-column: 2; }
[data-team-side="opponent"] .team-race { grid-column: 3; }
[data-team-side="opponent"] .team-tv { grid-column: 4; }
.race-logo, .logo-fallback { box-sizing: border-box; width: 128px; height: 128px; }
.race-logo { object-fit: contain; image-rendering: pixelated; }
.logo-fallback { display: grid; place-items: center; border: 1px solid var(--pb-line); border-radius: 4px; color: var(--pb-text); background: var(--ui-old-lace, #F8F5E7); font-size: 28px; letter-spacing: .06em; }
.versus { color: var(--pb-carmine); font-family: 'SNES', 'Nuffle', sans-serif; font-size: 27px; font-style: italic; text-shadow: 2px 2px 0 rgba(26, 64, 28, .18); }
.play-slot { width: 0; }
.lobby-controls { display: grid; gap: 7px; }
.lobby-controls label { color: var(--pb-carmine); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
.join-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.join-row input {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--pb-text);
  border-radius: 2px;
  color: var(--pb-text);
  background: var(--ui-old-lace, #F8F5E7);
  font-family: Helvetica, Arial, sans-serif;
  font-size: 14px;
  text-transform: uppercase;
}
.join-row input:focus { outline: 2px solid var(--pb-carmine); outline-offset: 1px; }
.lobby-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lobby-actions small { margin-left: auto; color: var(--pb-muted); }
.game-list { display: grid; gap: 7px; }
.game-entry { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; color: var(--pb-text); text-align: left; border: 1px solid var(--pb-line); border-radius: 4px; background: var(--ui-eggshell, #E7DDC7); cursor: pointer; }
.game-entry:disabled { opacity: .45; cursor: default; }
.game-entry:hover:not(:disabled) { border-color: var(--pb-carmine); background: var(--ui-old-lace, #F8F5E7); }
.game-entry-team { display: grid; gap: 4px; min-width: 0; }
.game-entry-coach { color: var(--pb-carmine); font-size: 12px; }
.game-entry-identity { display: flex; align-items: center; gap: 7px; min-width: 0; }
.game-entry-identity strong { overflow-wrap: anywhere; }
.game-entry-logo-fallback { display: grid; flex: 0 0 28px; place-items: center; width: 28px; height: 28px; border: 1px solid var(--pb-line); border-radius: 3px; background: var(--ui-old-lace, #F8F5E7); font-size: 12px; }
.game-entry-action { color: var(--pb-muted); white-space: nowrap; }

/* Game rows (active + recent share the design) */
.game-row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto; align-items: center; gap: 16px; padding: 14px 18px; border: 1px solid var(--pb-line); border-radius: 4px; background: var(--ui-eggshell, #E7DDC7); }
.row-team { display: flex; align-items: center; gap: 14px; min-width: 0; }
.row-team.away { flex-direction: row-reverse; text-align: right; }
.row-logo { flex: 0 0 128px; width: 128px; height: 128px; object-fit: contain; image-rendering: pixelated; }
.row-text { display: grid; gap: 2px; min-width: 0; }
.row-name { color: var(--pb-text); font-size: 24px; font-weight: 500; line-height: 1.15; overflow-wrap: break-word; }
.row-meta { color: var(--pb-muted); font-size: 18px; line-height: 1.2; }
.row-centre { display: grid; justify-items: center; gap: 4px; }
.row-score { color: var(--pb-carmine); font-family: 'Nuffle', system-ui, sans-serif; font-size: 27px; font-weight: 800; line-height: 1; text-shadow: 2px 2px 0 rgba(26, 64, 28, .18); white-space: nowrap; }
.row-phase { color: var(--pb-text); font-size: 14px; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; }
.row-result { font-weight: 800; }
.row-result[data-result="W"] { color: #2f8f46; }
.row-result[data-result="L"] { color: #8f111b; }
.row-result[data-result="D"] { color: #b5741a; }
.resume-button, .play-button { font-size: 22px; padding: 10px 22px; white-space: nowrap; }
.play-button { font-size: 24px; }

/* Recent games: same card; the list scrolls once it outgrows the viewport share */
.recent-list { display: grid; gap: 10px; max-height: 70vh; overflow-y: auto; padding-right: 4px; }
.details-button[data-cached='false'] { background: color-mix(in srgb, var(--ui-forest, #1A401C) 55%, #3a3a3a); border-color: color-mix(in srgb, var(--ui-forest, #1A401C) 40%, #777); }

/* Owner 09-25: Details popup — large, centred; the pane inside keeps its own look (PostGamePanel embedded). */
.details-modal { position: fixed; inset: 0; z-index: 200; display: flex; align-items: center; justify-content: center; padding: 3vh 3vw; background: #05070cc8; backdrop-filter: blur(2px); }
.details-card { display: flex; flex-direction: column; width: min(1100px, 94vw); max-height: 92vh; border: 1px solid var(--pb-text); border-radius: 8px; background: var(--ui-old-lace, #F8F5E7); color: var(--pb-text); box-shadow: 0 20px 60px #000c; overflow: hidden; }
.details-head { display: flex; align-items: center; gap: 14px; padding: 12px 18px; border-bottom: 1px solid var(--pb-line); }
.details-title { color: var(--pb-text); font-size: 22px; font-weight: 500; min-width: 0; overflow-wrap: break-word; }
.details-title .vs { color: var(--pb-muted); }
.details-when { color: var(--pb-muted); font-size: 14px; white-space: nowrap; }
.details-close { margin-left: auto; width: 34px; height: 34px; border: 1px solid var(--pb-text); border-radius: 6px; color: var(--pb-text); background: var(--ui-eggshell, #E7DDC7); font-size: 16px; cursor: pointer; }
.details-close:hover { border-color: var(--pb-carmine); color: #fff; background: var(--pb-carmine); }
.details-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px 18px; }
.details-missing { display: grid; gap: 6px; justify-items: center; padding: 40px 0; color: var(--pb-muted); text-align: center; }
.details-foot { display: flex; justify-content: flex-end; gap: 12px; padding: 12px 18px; border-top: 1px solid var(--pb-line); }

.file-input { display: none; }

@media (max-width: 640px) {
  .play-view { padding: 12px; }
  h1 { font-size: 32px; }
  .bevel { font-size: 18px; padding: 10px 18px; }
  .match-grid, .game-row { grid-template-columns: 1fr; }
  .row-logo, .race-logo, .logo-fallback, .team-logo-frame { width: 64px; height: 64px; flex-basis: 64px; }
  .team-side { grid-template-columns: 64px auto auto auto minmax(0, 1fr); }
  [data-team-side="opponent"] { grid-template-columns: minmax(0, 1fr) auto auto auto 64px; }
  .team-side, [data-team-side="opponent"] { text-align: left; }
  .row-team.away { flex-direction: row; text-align: left; }
  .versus { justify-self: center; }
}
</style>
