<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { GameListEntry } from '@fumbbl40k/ffb-protocol';
import fumbblLogoUrl from '../../assets/resources/fumbbl-logo.png';
import superFumbblLogoUrl from '../../assets/resources/super-fumbbl-logo.png';
import { FUMBBL_SITE } from '../../game/settings';
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
} from '../../game/jnlpRouting';
import { teamLogoUrl } from '../../game/teamLogos';
import CreateGameModal from './play/CreateGameModal.vue';

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
const fetchedTeam = ref<TeamPreview | null>(null);
const fetchedOpponentTeam = ref<TeamPreview | null>(null);
const loadError = ref('');
const failedLogos = ref(new Set<'own' | 'opponent'>());
const createGameOpen = ref(false);
const checkmark = String.fromCodePoint(10003);
const playGlyph = String.fromCodePoint(9654);
let previewLoad = 0;

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
  const coach = fumbblLobby.value?.coach.toLowerCase();
  if (coach && entry.teamHomeCoach?.toLowerCase() === coach) return 'home';
  if (coach && entry.teamAwayCoach?.toLowerCase() === coach) return 'away';
  return null;
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
  return {
    ...listed,
    ...fetched,
    name: fetched.name || listed.name,
    teamId: fetched.teamId || listed.teamId,
    coach: fetched.coach || listed.coach,
  };
});
const lobbyReady = computed(() => fumbblLobbyState.value === 'ready');
const lobbyStatus = computed(() => {
  switch (fumbblLobbyState.value) {
    case 'connecting': return 'Opening connection to FUMBBL\u2026';
    case 'versioning': return 'Checking FUMBBL client compatibility\u2026';
    case 'authenticating': return 'Authenticating the JNLP with FUMBBL\u2026';
    case 'joining': return `Request sent \u2014 waiting for ${fumbblLobbyWaitTarget.value || 'opponent'}\u2026`;
    // SERVER_JOIN acknowledges our lobby entry and consumes the one-time token. It does not mean an opponent
    // exists: only the following SERVER_GAME_STATE proves the match is ready, and that handoff closes this blade.
    case 'joined': return `Joined lobby \u2014 waiting for ${fumbblLobbyWaitTarget.value || 'opponent'}\u2026`;
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
  const [nextTeam, nextOpponent] = await Promise.all([
    fetchTeam(lobby.teamId),
    fetchTeam(listedOpponent?.teamId),
  ]);
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

function launchNamed(): void {
  fumbblJoinByName();
}

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

// Owner 08-18: an explicit logoUrl resolves as before; a race-only team now gets
// its in-game race crest (teamLogos.ts) before falling back to initials.
function logo(team: TeamPreview | null, side: 'own' | 'opponent'): string | null {
  if (!team || failedLogos.value.has(side)) return null;
  return teamLogoUrl(team);
}

function markLogoFailed(side: 'own' | 'opponent'): void {
  const next = new Set(failedLogos.value);
  next.add(side);
  failedLogos.value = next;
}

function initials(name: string | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '\u2014';
  return words.length === 1
    ? words[0]!.slice(0, 2).toUpperCase()
    : words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join('');
}

function formatTeamValue(value: number | undefined): string | undefined {
  if (!value) return undefined;
  const thousands = value >= 10_000 ? Math.round(value / 1_000) : Math.round(value);
  return `TV ${thousands.toLocaleString()}k`;
}

</script>

<template>
  <main class="play-view" aria-label="FUMBBL Play">
    <section class="play-card" aria-labelledby="play-title">
      <!-- Owner ruling (08-18, annotated screenshot): the "PLAY BLADE" eyebrow, the subtitle, and the
           bottom ".jnlp route" note are removed — the heading + two entry cards carry the blade on
           their own. -->
      <template v-if="!fumbblLobby">
        <h1 id="play-title">Choose where to play</h1>
        <div class="entry-grid">
          <button class="entry-card" type="button" @click="fileInput?.click()">
            <strong>PLAY ON FUMBBL</strong>
            <span class="logo-plate fumbbl-plate"><img :src="fumbblLogoUrl" alt="FUMBBL" /></span>
          </button>
          <button class="entry-card" type="button" @click="createGameOpen = true">
            <strong>PLAY ON SUPER FUMBBL</strong>
            <span class="logo-plate super-plate">
              <img :src="superFumbblLogoUrl" alt="Super FUMBBL" />
              <span class="test-environment-splash">TEST ENVIRONMENT</span>
            </span>
          </button>
        </div>
      </template>

      <template v-else>
        <h1 id="play-title">Ready to play</h1>
        <p class="loaded-line">
          {{ checkmark }} {{ fumbblLobby.sourceName || 'JNLP loaded' }}
          <template v-if="fumbblLobby.gameId"> &middot; game {{ fumbblLobby.gameId }}</template>
        </p>

        <div class="versus-preview">
          <div class="team-side" data-team-side="own">
            <span class="team-coach">{{ ownTeam?.coach || 'Coach unavailable' }}</span>
            <span class="team-logo-frame">
              <img
                v-if="logo(ownTeam, 'own')"
                class="race-logo"
                :src="logo(ownTeam, 'own')!"
                :alt="`${ownTeam?.name || 'Team'} logo`"
                @error="markLogoFailed('own')"
              />
              <span v-else class="logo-fallback" aria-hidden="true">{{ initials(ownTeam?.name) }}</span>
            </span>
            <strong class="team-name">{{ ownTeam?.name || '\u2014' }}</strong>
            <small v-if="ownTeam?.race" class="team-race">{{ ownTeam.race }}</small>
            <small v-if="formatTeamValue(ownTeam?.teamValue)" class="team-tv">{{ formatTeamValue(ownTeam?.teamValue) }}</small>
          </div>

          <span class="versus">VS</span>

          <div class="team-side" data-team-side="opponent">
            <span class="team-coach">{{ opponentTeam?.coach || 'Coach unavailable' }}</span>
            <span class="team-logo-frame">
              <img
                v-if="logo(opponentTeam, 'opponent')"
                class="race-logo"
                :src="logo(opponentTeam, 'opponent')!"
                :alt="`${opponentTeam?.name || 'Opponent'} logo`"
                @error="markLogoFailed('opponent')"
              />
              <span v-else class="logo-fallback" aria-hidden="true">{{ initials(opponentTeam?.name) }}</span>
            </span>
            <strong class="team-name">{{ opponentTeam?.name || 'Opponent unavailable' }}</strong>
            <small v-if="opponentTeam?.race" class="team-race">{{ opponentTeam.race }}</small>
            <small v-if="formatTeamValue(opponentTeam?.teamValue)" class="team-tv">{{ formatTeamValue(opponentTeam?.teamValue) }}</small>
          </div>
        </div>

        <form class="lobby-controls" @submit.prevent="launchNamed">
          <label for="fumbbl-game-name">Game name</label>
          <div class="join-row">
            <input id="fumbbl-game-name" v-model="fumbblLobbyGameName" type="text" autocomplete="off" placeholder="Both coaches enter the same name" />
            <button class="primary" type="submit" :disabled="!lobbyReady || !fumbblLobbyGameName.trim()">{{ playGlyph }} Join</button>
          </div>
          <div class="lobby-actions">
            <button type="button" :disabled="!lobbyReady" @click="fumbblListGames">List Games</button>
            <button type="button" @click="clearFumbblLobby">Cancel</button>
            <small v-if="lobbyStatus" role="status" aria-live="polite">{{ lobbyStatus }}</small>
          </div>
        </form>

        <button
          v-if="fumbblLobby.gameId"
          class="primary launch-button"
          type="button"
          :disabled="!lobbyReady"
          @click="fumbblJoinLoaded(fumbblLobby.gameId)"
        >
          {{ playGlyph }} Join game {{ fumbblLobby.gameId }}
        </button>

        <div v-if="fumbblLobbyListRequested" class="game-list" aria-live="polite">
          <p v-if="!fumbblLobbyGames.length">You do not have any open games to join.</p>
          <button
            v-for="entry in fumbblLobbyGames"
            :key="entry.gameId"
            class="game-entry"
            type="button"
            :disabled="!lobbyReady || ownSide(entry) === null"
            @click="launchListed(entry)"
          >
            <span class="game-entry-team">
              <small class="game-entry-coach">{{ opponentFor(entry).coach || 'Coach unavailable' }}</small>
              <span class="game-entry-identity">
                <span class="game-entry-logo-fallback" aria-hidden="true">{{ initials(opponentFor(entry).name) }}</span>
                <strong>{{ opponentFor(entry).name }}</strong>
              </span>
            </span>
            <span>Game {{ entry.gameId }} &middot; Join</span>
          </button>
        </div>
        <p v-if="fumbblLobbyError" class="load-error" role="alert">{{ fumbblLobbyError }}</p>
      </template>

      <p v-if="loadError" class="load-error" role="alert">{{ loadError }}</p>
      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept=".jnlp,text/xml,application/xml"
        @change="openJnlpFile"
      />
    </section>
    <CreateGameModal v-if="createGameOpen" @close="createGameOpen = false" />
  </main>
</template>

<style scoped>
/* Visual source of record: ReplayLauncherView.vue:101-115. */
.play-view { box-sizing: border-box; min-height: calc(100vh - 95px); display: grid; flex: 1; place-items: center; width: 100%; padding: 30px; color: #eee; background: radial-gradient(circle at 50% 20%, #2d1010, #090909 58%); }
.play-card { box-sizing: border-box; width: min(520px, 92vw); display: grid; gap: 13px; padding: 28px; border: 1px solid #7c2929; border-radius: 8px; background: #121212ee; box-shadow: 0 18px 60px #000a; }
h1, p { margin: 0; }
button { padding: 10px 14px; color: #eee; text-align: center; border: 1px solid #666; background: #292929; cursor: pointer; }
.primary { color: #fff; border-color: #a62020; background: #7d0808; }
.primary:disabled { opacity: .45; cursor: default; }
.entry-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; }
.entry-card { display: grid; grid-template-rows: auto 92px; gap: 10px; min-width: 0; padding: 13px; border-color: #666; background: #292929; }
.entry-card:hover { border-color: #a62020; background: #351313; }
.entry-card:focus-visible { outline: 2px solid #d6ad62; outline-offset: 2px; }
.entry-card strong { color: #d6ad62; font-size: max(var(--ui-min-text-size, 12px), 11px); letter-spacing: .08em; }
.logo-plate { display: grid; place-items: center; min-width: 0; padding: 9px; border: 1px solid #555; }
.logo-plate img { display: block; max-width: 100%; max-height: 68px; object-fit: contain; }
.fumbbl-plate { background: #eee8d7; }
.super-plate {
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 6px;
  padding-bottom: 6px;
  background: #080808;
}
.super-plate img { max-height: 48px; }
.test-environment-splash {
  box-sizing: border-box;
  width: min(100%, 174px);
  padding: 3px 5px 2px;
  border: 2px solid #efc957;
  color: #fff5b0;
  background:
    linear-gradient(#ffffff14 0 48%, transparent 48% 100%),
    #8f111b;
  box-shadow:
    0 2px 0 #2e0205,
    inset 0 0 0 1px #3b0307;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-text-size, 12px), clamp(8px, 1.5vw, 10px));
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: .08em;
  text-align: center;
  text-shadow: 1px 1px 0 #3b0307;
  white-space: nowrap;
}
.launch-button { font-size: max(var(--ui-min-primary-text-size, 16px), 15px); letter-spacing: .14em; }
.lobby-controls { display: grid; gap: 7px; }
.lobby-controls label { color: #d6ad62; font-size: max(var(--ui-min-text-size, 12px), 12px); letter-spacing: .08em; text-transform: uppercase; }
.join-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.join-row input {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #666;
  border-radius: 2px;
  color: #eee;
  background: #080808;
  font-family: Helvetica, Arial, sans-serif;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  text-transform: uppercase;
}
.join-row input:focus { outline: 2px solid #a62020; outline-offset: 1px; }
.lobby-actions { display: flex; align-items: center; gap: 8px; }
.lobby-actions small { margin-left: auto; color: #999; }
.game-list { display: grid; gap: 7px; padding-top: 3px; border-top: 1px solid #3d3d3d; }
.game-list > p { padding: 10px; color: #bbb; text-align: center; background: #090909; }
.game-entry { display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: left; }
.game-entry:hover:not(:disabled) { border-color: #a62020; background: #351313; }
.game-entry-team { display: grid; gap: 4px; min-width: 0; }
.game-entry-coach { color: #d6ad62; font-size: max(var(--ui-min-text-size, 12px), 12px); }
.game-entry-identity { display: flex; align-items: center; gap: 7px; min-width: 0; }
.game-entry-identity strong { overflow-wrap: anywhere; }
.game-entry-logo-fallback {
  display: grid;
  flex: 0 0 28px;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid #555;
  border-radius: 3px;
  background: #171717;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
}
.game-entry small { color: #aaa; }
.load-error,
.loaded-line { text-align: center; }
.load-error { color: #ff8d8d; font-size: max(var(--ui-min-text-size, 12px), 12px); }
.loaded-line { color: #9bcf83; font-size: max(var(--ui-min-text-size, 12px), 11px); letter-spacing: .1em; }

.versus-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid #555;
  border-radius: 4px;
  background: #080808;
}

.team-side {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
  text-align: center;
}

.team-coach {
  max-width: 100%;
  color: #d6ad62;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.team-logo-frame {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border: 1px solid #3f3f3f;
  border-radius: 4px;
  background: #050505;
}

.race-logo,
.logo-fallback {
  box-sizing: border-box;
  width: 44px;
  height: 44px;
}

.race-logo { object-fit: contain; image-rendering: pixelated; }
.logo-fallback {
  display: grid;
  place-items: center;
  border: 1px solid #555;
  border-radius: 4px;
  color: #eee;
  background: #292929;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  letter-spacing: .06em;
}

.team-name {
  max-width: 100%;
  color: #eee;
  font-size: max(var(--ui-min-primary-text-size, 16px), 13px);
  font-weight: 500;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.team-race,
.team-tv { color: #999; font-size: max(var(--ui-min-text-size, 12px), 12px); line-height: 1.25; }
.team-tv { color: #bdbdbd; }
.versus {
  flex: 0 0 auto;
  color: #d6ad62;
  font-family: 'SNES', 'Nuffle', sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 22px);
  font-style: italic;
  text-shadow: 2px 2px 0 #121212;
}

.file-input { display: none; }

@media (max-width: 640px) {
  .play-view { padding: 12px; }
  .play-card { padding: 22px 18px; }
  .entry-grid { grid-template-columns: 1fr; }
  .versus-preview { padding-inline: 8px; }
  .game-entry { align-items: flex-start; }
}
</style>
