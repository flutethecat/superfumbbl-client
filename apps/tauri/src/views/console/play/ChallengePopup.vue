<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { settings } from '../../../game/settings';
import { coachPassword } from '../../../game/credentials';
import {
  botGet,
  connectMatchedChallenge,
  createChallengeController,
  createChallengeState,
  errText,
  filterLibraryTeams,
  loadTeamLibrary,
  type ChallengeState,
  type LibraryTeam,
} from '../../../game/forkChallenge';
import { teamLogoUrl } from '../../../game/teamLogos';
import CoordinationIdentityChip from '../../../components/CoordinationIdentityChip.vue';

const emit = defineEmits<{ close: []; matched: [] }>();
const opponent = ref('');
const suggestions = ref<string[]>([]);
const library = ref<LibraryTeam[]>([]);
const teamFilter = ref('');
const filteredLibrary = computed(() => filterLibraryTeams(library.value, teamFilter.value));
const selectedTeam = ref<LibraryTeam | null>(null);
const libraryLoading = ref(false);
const libraryStatus = ref('');
const challenge = reactive<ChallengeState>(createChallengeState());
let suggestionTimer: ReturnType<typeof setTimeout> | null = null;
let suggestionRequest = 0;

function forkCredentials(): { coach: string; password: string } {
  return { coach: settings.coach40k.trim(), password: coachPassword() };
}

const controller = createChallengeController(challenge, {
  onMatched(payload) {
    connectMatchedChallenge(payload);
    emit('matched');
  },
});

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length === 1
    ? words[0]!.slice(0, 2).toUpperCase()
    : words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join('');
}

// Owner 08-18: the crest slot shows the race's in-game team logo (teamLogos.ts —
// the fork rosters' own <logo> refs); the initials circle stays as the per-entry
// fallback for unknown races or a failed image load.
const failedCrests = ref(new Set<string>());

function crest(team: LibraryTeam): string | null {
  return failedCrests.value.has(team.teamId) ? null : teamLogoUrl(team);
}

function markCrestFailed(team: LibraryTeam): void {
  failedCrests.value = new Set([...failedCrests.value, team.teamId]);
}

function formatTeamValue(value: number | undefined): string {
  if (value === undefined) return 'TV ?';
  const thousands = value >= 10_000 ? Math.round(value / 1_000) : Math.round(value);
  return `TV ${thousands.toLocaleString()}k`;
}

async function loadLibrary(): Promise<void> {
  const { coach } = forkCredentials();
  selectedTeam.value = null;
  libraryStatus.value = '';
  if (!coach) {
    library.value = [];
    libraryStatus.value = 'Set your Super FUMBBL coach name in Settings → Connection.';
    return;
  }
  libraryLoading.value = true;
  failedCrests.value = new Set();
  try {
    library.value = await loadTeamLibrary(coach);
    if (!library.value.length) libraryStatus.value = 'Your library is empty — import a team to get started.';
  } catch (error) {
    library.value = [];
    libraryStatus.value = `Couldn't load your library (${errText(error)}).`;
  } finally {
    libraryLoading.value = false;
  }
}

function onOpponentInput(): void {
  if (suggestionTimer) clearTimeout(suggestionTimer);
  const query = opponent.value.trim();
  const ticket = ++suggestionRequest;
  if (!query) {
    suggestions.value = [];
    return;
  }
  suggestionTimer = setTimeout(async () => {
    try {
      // Existing coaches lookup from SpectateView.vue:6510-6522.
      const data = await botGet('coaches', { q: query, limit: '8' });
      if (ticket !== suggestionRequest) return;
      const me = forkCredentials().coach.toLowerCase();
      suggestions.value = ((data.coaches as string[]) ?? [])
        .filter((coach) => coach.toLowerCase() !== me)
        .slice(0, 8);
    } catch {
      if (ticket === suggestionRequest) suggestions.value = [];
    }
  }, 200);
}

function pickSuggestion(name: string): void {
  opponent.value = name;
  suggestions.value = [];
}

async function sendChallenge(): Promise<void> {
  if (!selectedTeam.value || !opponent.value.trim()) return;
  const creds = forkCredentials();
  if (!creds.coach) {
    challenge.phase = 'error';
    challenge.message = 'Set your Super FUMBBL coach name in Settings → Connection.';
    challenge.error = challenge.message;
    return;
  }
  await controller.submit({
    ...creds,
    teamId: selectedTeam.value.teamId,
    opponent: opponent.value,
  });
}

async function closePopup(): Promise<void> {
  if (challenge.phase === 'submitting') return;
  if (challenge.phase === 'waiting') await controller.cancel();
  emit('close');
}

onMounted(() => { void loadLibrary(); });
onBeforeUnmount(() => {
  suggestionRequest += 1;
  if (suggestionTimer) clearTimeout(suggestionTimer);
  if (challenge.phase === 'waiting') void controller.cancel();
  else controller.dispose();
});
</script>

<template>
  <div class="challenge-backdrop" @click.self="closePopup">
    <section class="challenge-card" role="dialog" aria-modal="true" aria-labelledby="challenge-title">
      <button class="close-button" type="button" aria-label="Close challenge" :disabled="challenge.phase === 'submitting'" @click="closePopup">×</button>
      <!-- Owner 08-18: header copy removed; while waiting, the status IS the headline. -->
      <h1 v-if="challenge.phase === 'waiting'" id="challenge-title" class="waiting-title" role="status">{{ challenge.message }}</h1>
      <h1 v-else id="challenge-title" class="sr-only">Challenge a coach</h1>

      <template v-if="challenge.phase !== 'waiting'">
        <CoordinationIdentityChip />
        <label>
          Enter coach name
          <input v-model="opponent" type="text" autocomplete="off" placeholder="opponent coach name" @input="onOpponentInput" />
        </label>
        <div v-if="suggestions.length" class="suggestions" aria-label="Coach suggestions">
          <button v-for="name in suggestions" :key="name" type="button" @click="pickSuggestion(name)">{{ name }}</button>
        </div>

        <div class="library-heading">
          <span>Your team</span>
          <button class="file-button compact" type="button" :disabled="libraryLoading" @click="loadLibrary">
            {{ libraryLoading ? 'Loading…' : 'Refresh' }}
          </button>
        </div>
        <label class="team-filter">
          Filter teams
          <input v-model="teamFilter" type="search" autocomplete="off" placeholder="team name or race" />
        </label>
        <p v-if="libraryStatus" class="note">{{ libraryStatus }}</p>
        <p v-else-if="library.length && !filteredLibrary.length" class="note" role="status">
          No teams match “{{ teamFilter.trim() }}”.
        </p>
        <!-- Import-card markup/CSS ported from TeamBuilderView.vue:837-855,1441-1450. -->
        <div v-else class="library-grid">
          <button
            v-for="team in filteredLibrary"
            :key="team.teamId"
            class="library-team"
            :class="{ selected: selectedTeam?.teamId === team.teamId }"
            type="button"
            :aria-pressed="selectedTeam?.teamId === team.teamId"
            @click="selectedTeam = team"
          >
            <span class="library-crest">
              <img v-if="crest(team)" :src="crest(team)!" :alt="initials(team.teamName)" @error="markCrestFailed(team)" />
              <template v-else>{{ initials(team.teamName) }}</template>
            </span>
            <span>
              <strong>{{ team.teamName }}</strong>
              <small>{{ team.race }} · {{ formatTeamValue(team.teamValue) }}</small>
            </span>
          </button>
        </div>

        <p v-if="challenge.message" :class="challenge.phase === 'error' ? 'error' : 'note'" role="status">{{ challenge.message }}</p>
        <button
          class="primary"
          type="button"
          :disabled="challenge.phase === 'submitting' || !selectedTeam || !opponent.trim()"
          @click="sendChallenge"
        >
          {{ challenge.phase === 'submitting' ? 'Sending…' : 'Send challenge' }}
        </button>
      </template>

      <template v-else>
        <span class="or">Checking every 2 seconds</span>
        <button class="file-button" type="button" @click="controller.cancel">Cancel challenge</button>
      </template>
    </section>
  </div>
</template>

<style scoped>
/* Visual source of record: ReplayLauncherView.vue:101-115. */
.challenge-backdrop { position: fixed; z-index: 82; inset: 0; display: grid; place-items: center; padding: 30px; color: #eee; background: #000c; }
.challenge-card { position: relative; width: min(620px, 92vw); max-height: min(760px, 88vh); display: grid; gap: 13px; padding: 28px; overflow-y: auto; border: 1px solid #7c2929; border-radius: 8px; background: #121212ee; box-shadow: 0 18px 60px #000a; }
.eyebrow { margin: 0; color: #d6ad62; font-size: max(var(--ui-min-text-size, 12px), 11px); letter-spacing: .18em; }
h1, p { margin: 0; }
label { display: grid; gap: 5px; color: #ccc; font-size: max(var(--ui-min-text-size, 12px), 12px); }
input { padding: 10px; color: #fff; border: 1px solid #555; background: #080808; }
button { padding: 10px 14px; color: #eee; text-align: center; border: 1px solid #666; background: #292929; cursor: pointer; }
.primary { color: #fff; border-color: #a62020; background: #7d0808; }
.primary:disabled { opacity: .45; cursor: default; }
.file-button { display: block; background: #292929; }
.file-button:disabled { opacity: .45; cursor: wait; }
.or { color: #777; text-align: center; font-size: max(var(--ui-min-text-size, 12px), 11px); text-transform: uppercase; }
.error { color: #ff8d8d; }
.note { color: #999; font-size: max(var(--ui-min-text-size, 12px), 11px); }
.close-button { position: absolute; top: 10px; right: 10px; padding: 4px 8px; border: 0; background: transparent; font-size: max(var(--ui-min-primary-text-size, 16px), 20px); }
.close-button:disabled { opacity: .35; cursor: default; }
.suggestions { display: grid; margin-top: -9px; border: 1px solid #555; background: #080808; }
.suggestions button { padding: 7px 10px; text-align: left; border: 0; border-bottom: 1px solid #333; background: transparent; }
.suggestions button:hover { background: #292929; }
.library-heading { display: flex; align-items: center; justify-content: space-between; color: #ccc; font-size: max(var(--ui-min-text-size, 12px), 12px); }
.team-filter { margin-top: -7px; }
.team-filter input { width: 100%; }
.compact { padding: 5px 9px; font-size: max(var(--ui-min-text-size, 12px), 11px); }
.library-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.library-team { display: flex; align-items: center; gap: 10px; padding: 10px 12px; color: var(--ui-text); text-align: left; background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 6px; cursor: pointer; }
.library-team:hover,
.library-team.selected { border-color: var(--ui-heading); background: color-mix(in srgb, var(--ui-primary) 18%, var(--ui-surface)); }
.library-crest { display: grid; place-items: center; width: 40px; height: 40px; flex: 0 0 auto; overflow: hidden; color: var(--ui-eggshell); background: var(--ui-tier-1); border: 2px solid var(--ui-eggshell); border-radius: 50%; }
.library-crest img { width: 100%; height: 100%; object-fit: contain; }
.library-team > span:last-child { min-width: 0; }
.library-team strong,
.library-team small { display: block; }
.library-team strong { color: var(--ui-eggshell); font-weight: 500; }
.library-team small { margin-top: 2px; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 11px); }
.waiting-title { padding: 20px 0 6px; text-align: center; font-size: max(var(--ui-min-primary-text-size, 16px), 1.9rem); line-height: 1.2; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
