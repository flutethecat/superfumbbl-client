<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import fumbblLogoUrl from '../../assets/resources/fumbbl-logo.png';
import superFumbblLogoUrl from '../../assets/resources/super-fumbbl-logo.png';
import { FUMBBL_SITE, applyServerTarget } from '../../game/settings';
import { botGet } from '../../game/forkChallenge';
import { deriveForkGameRows, routeForkSpectate, type ForkGameRow } from '../../game/forkGames';
import { competitionLabel, groupByCompetition, missingCompetitionIds, type CompetitionNames } from '../../game/spectateCompetition';

interface BrowserMatch {
  id: number;
  half: number;
  turn: number;
  /** Owner 09-07: competition fields off /api/match/current (ids only for tournaments — names resolved below). */
  division?: string | null;
  scheduler?: string | null;
  tournament?: { id?: number | string; group?: number | string } | null;
  teams: { side: string; name: string; coach: string; race: string; score: number }[];
}

// Owner 09-07: group / tournament NAMES, cached for the app's life (module scope survives remounts); the public
// /api/group/get and /api/tournament/get endpoints supply them, best-effort and sequential.
const competitionNameCache: CompetitionNames = { groups: {}, tournaments: {} };
const competitionNames = ref<CompetitionNames>({ groups: { ...competitionNameCache.groups }, tournaments: { ...competitionNameCache.tournaments } });
let competitionLookup: Promise<void> | null = null;
async function resolveCompetitionNames(matches: readonly BrowserMatch[]): Promise<void> {
  if (competitionLookup) return;
  const missing = missingCompetitionIds(matches, competitionNameCache);
  if (!missing.groups.length && !missing.tournaments.length) return;
  competitionLookup = (async () => {
    for (const id of missing.groups) {
      try {
        const res = await fetch(`${FUMBBL_SITE}/api/group/get/${encodeURIComponent(id)}`);
        const body = (await res.json()) as { name?: unknown };
        competitionNameCache.groups[id] = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : `Group ${id}`;
      } catch { /* keep the id fallback; retried on a later refresh */ }
    }
    for (const id of missing.tournaments) {
      try {
        const res = await fetch(`${FUMBBL_SITE}/api/tournament/get/${encodeURIComponent(id)}`);
        const body = (await res.json()) as { name?: unknown };
        competitionNameCache.tournaments[id] = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : `Tournament ${id}`;
      } catch { /* keep the id fallback */ }
    }
    competitionNames.value = { groups: { ...competitionNameCache.groups }, tournaments: { ...competitionNameCache.tournaments } };
  })().finally(() => { competitionLookup = null; });
  await competitionLookup;
}

const emit = defineEmits<{
  spectate: [id: number];
}>();

const browserMatches = ref<BrowserMatch[]>([]);
const browserStatus = ref('');
const browserFilter = ref('');
const browserPolling = ref(false);
const forkGames = ref<ForkGameRow[]>([]);
const forkStatus = ref('');
const forkPolling = ref(false);

// Owner ruling (08-18): the Spectate blade owns ITS OWN section selection, decoupled from the
// global settings.activeServerTarget (which the header/Play blade drive independently) — App.vue
// only mounts this component when there's no live game connection (SpectateView takes over once
// gameStore.game is set), so a fresh mount can always default to 'fumbbl' with no risk of yanking
// an active fork spectate session out from under the user.
const spectateSection = ref<'fumbbl' | 'fork'>('fumbbl');

const BROWSER_POLL_MS = 30000;
const BROWSER_POLL_MAX_MS = 300000;
const FORK_POLL_MS = 15000;
let browserPollTimer: ReturnType<typeof setInterval> | null = null;
let browserPollStopTimer: ReturnType<typeof setTimeout> | null = null;
let forkPollTimer: ReturnType<typeof setInterval> | null = null;

const filteredMatches = computed(() => {
  const progress = (match: BrowserMatch) => (match.half ?? 0) * 100 + (match.turn ?? 0);
  const sorted = [...browserMatches.value].sort((a, b) => progress(a) - progress(b));
  const query = browserFilter.value.trim().toLocaleLowerCase();
  if (!query) return sorted;

  return sorted.filter((match) => [
    match.id,
    competitionLabel(match, competitionNames.value), // owner 09-07: the filter also matches the competition
    ...match.teams.flatMap((team) => [team.name, team.coach]),
  ].join(' ').toLocaleLowerCase().includes(query));
});
/** Owner 09-07: the filtered list grouped by competition (tournament groups first, then League, then Competitive). */
const groupedMatches = computed(() => groupByCompetition(filteredMatches.value, competitionNames.value));

function team(match: BrowserMatch, index: number): BrowserMatch['teams'][number] | undefined {
  return match.teams[index];
}

function phase(match: { half: number; turn: number }): string {
  return match.half === 0 ? 'Pre-kick' : `H${match.half} T${match.turn}`;
}

function onFilterEnter(): void {
  const value = browserFilter.value.trim();
  if (/^\d+$/.test(value)) spectate(Number(value));
}

/** Owner ruling (08-18): a Spectate click applies the fumbbl target itself, regardless of the
 *  global settings.activeServerTarget — App.vue's openSpectateGame connects with settings.url as-is,
 *  and this view's own section selector no longer keeps that setting in sync (see spectateSection
 *  above), so the action that actually needs the target must set it. This list is FUMBBL-only. */
function spectate(gameId: number): void {
  applyServerTarget('fumbbl');
  emit('spectate', gameId);
}

function spectateFork(gameId: number): void {
  routeForkSpectate(gameId, applyServerTarget, (id) => emit('spectate', id));
}

function forkErrorStatus(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.toLocaleLowerCase() === 'fork server unreachable'
    ? 'The Super FUMBBL game server is unreachable.'
    : detail;
}

async function refreshFork(): Promise<void> {
  forkStatus.value = 'Loading live games…';
  try {
    forkGames.value = deriveForkGameRows(await botGet('games', {}));
    forkStatus.value = forkGames.value.length ? '' : 'No live games right now.';
  } catch (error) {
    forkGames.value = [];
    forkStatus.value = forkErrorStatus(error);
  }
}

async function pollFork(): Promise<void> {
  try {
    forkGames.value = deriveForkGameRows(await botGet('games', {}));
    forkStatus.value = forkGames.value.length ? '' : 'No live games right now.';
  } catch {
    /* Transient failure: preserve the current rows and retry on the next poll. */
  }
}

function stopForkPoll(): void {
  if (forkPollTimer) { clearInterval(forkPollTimer); forkPollTimer = null; }
  forkPolling.value = false;
}

function startForkPoll(): void {
  stopForkPoll();
  forkPolling.value = true;
  forkPollTimer = setInterval(() => void pollFork(), FORK_POLL_MS);
}

function refreshForkList(): void {
  void refreshFork();
  startForkPoll();
}

async function refreshBrowser(): Promise<void> {
  browserStatus.value = 'Loading live games…';
  try {
    const res = await fetch(`${FUMBBL_SITE}/api/match/current`);
    browserMatches.value = (await res.json()) as BrowserMatch[];
    browserStatus.value = browserMatches.value.length ? '' : 'No live games right now.';
    void resolveCompetitionNames(browserMatches.value);
  } catch (error) {
    browserStatus.value = `Failed to load: ${error instanceof Error ? error.message : error}`;
  }
}

function stopBrowserPoll(): void {
  if (browserPollTimer) { clearInterval(browserPollTimer); browserPollTimer = null; }
  if (browserPollStopTimer) { clearTimeout(browserPollStopTimer); browserPollStopTimer = null; }
  browserPolling.value = false;
}

function startBrowserPoll(): void {
  stopBrowserPoll();
  browserPolling.value = true;
  browserPollTimer = setInterval(() => void pollBrowser(), BROWSER_POLL_MS);
  browserPollStopTimer = setTimeout(() => stopBrowserPoll(), BROWSER_POLL_MAX_MS);
}

async function pollBrowser(): Promise<void> {
  try {
    const res = await fetch(`${FUMBBL_SITE}/api/match/current`);
    const incoming = (await res.json()) as BrowserMatch[];
    mergeMatches(incoming);
    void resolveCompetitionNames(browserMatches.value);
    if (browserStatus.value === '' || browserStatus.value === 'No live games right now.')
      browserStatus.value = browserMatches.value.length ? '' : 'No live games right now.';
  } catch {
    /* Transient failure: preserve the current rows and retry on the next poll. */
  }
}

function mergeMatches(incoming: BrowserMatch[]): void {
  const rows = browserMatches.value;
  const byId = new Map(rows.map((match) => [match.id, match]));
  const seen = new Set<number>();
  for (const nextMatch of incoming) {
    seen.add(nextMatch.id);
    const existing = byId.get(nextMatch.id);
    if (existing) {
      existing.half = nextMatch.half;
      existing.turn = nextMatch.turn;
      existing.teams = nextMatch.teams;
      existing.division = nextMatch.division;
      existing.scheduler = nextMatch.scheduler;
      existing.tournament = nextMatch.tournament;
    } else {
      rows.push(nextMatch);
    }
  }
  for (let index = rows.length - 1; index >= 0; index--)
    if (!seen.has(rows[index]!.id)) rows.splice(index, 1);
}

function refresh(): void {
  void refreshBrowser();
  startBrowserPoll();
}

function refreshSelected(): void {
  if (spectateSection.value === 'fork') refreshForkList();
  else refresh();
}

// Owner ruling (08-18, supersedes the console-shell-restructure idiom below): the Spectate blade's
// FUMBBL / Super FUMBBL selector now drives ONLY which section renders in this blade — it no longer
// writes the shared settings.activeServerTarget (that would leak into the Play blade, which reads
// the same setting). The target is applied separately, only when an action needs it (see spectate()).
function selectSpectateServer(target: 'fumbbl' | 'fork'): void {
  spectateSection.value = target;
}

onMounted(refresh);
watch(spectateSection, (target) => {
  if (target === 'fork') refreshForkList();
  else stopForkPoll();
});
onBeforeUnmount(() => {
  stopBrowserPoll();
  stopForkPoll();
});
</script>

<template>
  <main class="spectate-browser" :class="{ 'theme-fumbbl': spectateSection === 'fumbbl' }" aria-label="Spectate browser">
    <header class="browser-toolbar">
      <!-- Owner ruling (08-18): FUMBBL / Super FUMBBL selector, restyled to reuse the header's own
           branded plate buttons (.server-plate / .server-plate-fumbbl / .server-plate-super — App.vue
           global <style>, not scoped, so the classes apply unchanged here). Drives spectateSection
           only — see the script comment above. -->
      <div class="server-toggle" role="group" aria-label="Spectate server">
        <button type="button" class="server-plate server-plate-fumbbl" :data-active="spectateSection === 'fumbbl'"
          :aria-pressed="spectateSection === 'fumbbl'" title="FUMBBL" @click="selectSpectateServer('fumbbl')">
          <img :src="fumbblLogoUrl" alt="FUMBBL" />
        </button>
        <button type="button" class="server-plate server-plate-super" :data-active="spectateSection === 'fork'"
          :aria-pressed="spectateSection === 'fork'" title="Super FUMBBL" @click="selectSpectateServer('fork')">
          <img :src="superFumbblLogoUrl" alt="Super FUMBBL" />
        </button>
      </div>
      <input
        v-if="spectateSection === 'fumbbl'"
        v-model="browserFilter"
        class="browser-filter"
        type="search"
        aria-label="Filter live games or enter a game id"
        placeholder="Filter, or type a game id + Enter to open"
        @keyup.enter="onFilterEnter"
      />
      <span class="toolbar-spacer" />
      <span class="live-indicator"
        :class="{ polling: spectateSection === 'fork' ? forkPolling : browserPolling }">● Live</span>
      <button class="refresh-button" type="button"
        aria-label="Refresh live games" title="Refresh live games" @click="refreshSelected">↻</button>
    </header>

    <template v-if="spectateSection === 'fork'">
      <h2 class="group-heading super-heading">▶ Super FUMBBL</h2>
      <section class="game-list super-list" aria-label="Super FUMBBL live games" aria-live="polite">
        <div v-if="forkStatus" class="list-status">{{ forkStatus }}</div>
        <div v-else class="rows">
          <article v-for="match in forkGames" :key="match.gameId" class="game-row">
            <span class="game-id">{{ match.gameId }}</span>
            <div class="team-cell">
              <strong>{{ match.homeTeam || '—' }}</strong>
              <small>({{ match.homeCoach || '—' }})</small>
            </div>
            <span class="score">vs</span>
            <div class="team-cell">
              <strong>{{ match.awayTeam || '—' }}</strong>
              <small>({{ match.awayCoach || '—' }})</small>
            </div>
            <span class="phase-chip">{{ phase(match) }}</span>
            <button class="spectate-button" type="button" @click="spectateFork(match.gameId)">Spectate</button>
          </article>
        </div>
      </section>
    </template>

    <template v-else>
      <h2 class="group-heading testbed-heading">▶ FUMBBL</h2>
      <section class="game-list testbed-list" aria-label="FUMBBL live games" aria-live="polite">
        <div v-if="browserStatus" class="list-status">{{ browserStatus }}</div>
        <div v-else-if="filteredMatches.length === 0" class="list-status">No live games match the filter.</div>
        <div v-else class="rows">
          <template v-for="group in groupedMatches" :key="group.key">
          <h3 class="competition-heading" :title="group.label">{{ group.label }} <span class="competition-count">{{ group.matches.length }}</span></h3>
          <article v-for="match in group.matches" :key="match.id" class="game-row">
            <span class="game-id">{{ match.id }}</span>
            <div class="team-cell">
              <strong>{{ team(match, 0)?.name || '—' }}</strong>
              <small>({{ team(match, 0)?.coach || '—' }}, {{ team(match, 0)?.race || '—' }})</small>
            </div>
            <span class="score">{{ team(match, 0)?.score ?? 0 }}–{{ team(match, 1)?.score ?? 0 }}</span>
            <div class="team-cell">
              <strong>{{ team(match, 1)?.name || '—' }}</strong>
              <small>({{ team(match, 1)?.coach || '—' }}, {{ team(match, 1)?.race || '—' }})</small>
            </div>
            <span class="phase-chip">{{ phase(match) }}</span>
            <button class="spectate-button" type="button" @click="spectate(match.id)">Spectate</button>
          </article>
          </template>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.spectate-browser {
  box-sizing: border-box;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  /* Owner ruling (08-18, viewport reflow): was a hard 1440px cap, same idiom as TeamBuilder's
     08-17 reflow — relaxed to a generous ceiling so the blade keeps growing with the window. */
  max-width: 1800px;
  min-height: 0;
  margin: 0 auto;
  padding: clamp(18px, 1.4vw, 28px) clamp(20px, 1.6vw, 32px);
  color: var(--ui-text);
  background: var(--ui-surface);
}

/* Owner ruling (08-18, addition to ruling 2/3): when the FUMBBL section is showing, the blade's OWN
   surface (background/panels/list rows) themes to the FUMBBL brand — the cream/parchment the header's
   FUMBBL plate already uses. Reuses the EXISTING fixed brand tokens (theme-independent CONSOLE_PALETTE
   entries in apps/tauri/src/game/theme.ts: --ui-eggshell / --ui-old-lace / --ui-forest — the same colors
   the header .server-plate-fumbbl plate is built from) rather than minting new --fumbbl-* hexes, since
   that token set already exists. Scoped (this file is `<style scoped>`) to THIS blade's own elements only
   — the app shell/header and the Super FUMBBL section are untouched (Super FUMBBL keeps the dark theme).
   Instant swap, no transition, per the ruling. */
.spectate-browser.theme-fumbbl {
  color: var(--ui-forest);
  background: var(--ui-eggshell);
}
.theme-fumbbl .browser-filter {
  border-color: var(--ui-forest);
  color: var(--ui-forest);
  background: var(--ui-old-lace);
}
.theme-fumbbl .browser-filter::placeholder { color: color-mix(in srgb, var(--ui-forest) 55%, transparent); }
.theme-fumbbl .refresh-button {
  border-color: var(--ui-forest);
  color: var(--ui-forest);
  background: var(--ui-old-lace);
}
.theme-fumbbl .testbed-heading { color: var(--ui-forest); }
.theme-fumbbl .game-list {
  border-color: var(--ui-forest);
  background: var(--ui-eggshell);
  box-shadow: 0 4px 14px rgba(0, 0, 0, .18);
}
.theme-fumbbl .game-row {
  border-bottom-color: color-mix(in srgb, var(--ui-forest) 30%, transparent);
  background: var(--ui-eggshell);
}
.theme-fumbbl .game-row:nth-child(even) { background: var(--ui-old-lace); }
.theme-fumbbl .game-id { color: color-mix(in srgb, var(--ui-forest) 65%, transparent); }
.theme-fumbbl .team-cell strong { color: var(--ui-forest); }
.theme-fumbbl .team-cell small { color: color-mix(in srgb, var(--ui-forest) 65%, transparent); }
.theme-fumbbl .phase-chip { color: var(--ui-forest); }
.theme-fumbbl .list-status { color: color-mix(in srgb, var(--ui-forest) 65%, transparent); }

.browser-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.server-toggle {
  display: flex;
  flex: 0 0 auto;
  gap: 0.45rem;
}

/* Owner ruling (08-18): the FUMBBL / Super FUMBBL selector reuses the header's own .server-plate
   button design verbatim (App.vue global <style>) rather than a bespoke pill — see the template
   comment. No plate CSS is duplicated here.

   Owner ruling (08-18, viewport reflow): the plates themselves scale up in THIS blade only —
   these size/img rules win over the App.vue global .server-plate defaults on specificity
   (two classes vs one) without touching the header's own fixed-size plates. */
.server-toggle .server-plate {
  width: clamp(132px, 7vw, 190px);
  height: clamp(52px, 2.8vw, 76px);
}
.server-toggle .server-plate-fumbbl img { max-width: clamp(108px, 5.8vw, 155px); max-height: clamp(24px, 1.3vw, 35px); }
.server-toggle .server-plate-super img { max-width: clamp(112px, 6vw, 160px); max-height: clamp(42px, 2.3vw, 60px); }

.browser-filter {
  flex: 1;
  max-width: clamp(380px, 28vw, 560px);
  min-width: 250px;
  box-sizing: border-box;
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  padding: clamp(7px, 0.55vw, 11px) clamp(12px, 0.9vw, 18px);
  color: var(--ui-text);
  background: var(--ui-surface-2);
  font: inherit;
  font-size: max(var(--ui-min-primary-text-size, 16px), clamp(13px, 1vw, 17px));
}

.browser-filter::placeholder { color: var(--ui-muted); }
.browser-filter:focus-visible,
.refresh-button:focus-visible,
.spectate-button:focus-visible {
  outline: 2px solid var(--ui-focus-halo);
  box-shadow: 0 0 0 4px var(--ui-focus);
}

.toolbar-spacer { flex: 1; }
.live-indicator {
  color: var(--ui-success);
  font-size: max(var(--ui-min-text-size, 12px), clamp(12px, 0.85vw, 15px));
  letter-spacing: .1em;
}
.live-indicator.polling { animation: live-pulse 2s ease-in-out infinite; }

.refresh-button {
  display: grid;
  place-items: center;
  width: clamp(32px, 2.2vw, 42px);
  height: clamp(30px, 2.1vw, 40px);
  padding: 0;
  border: 2px outset color-mix(in srgb, var(--ui-text) 24%, var(--ui-surface-2));
  border-radius: 4px;
  color: var(--ui-text);
  background: var(--ui-surface-2);
  font: inherit;
  font-size: max(var(--ui-min-primary-text-size, 16px), clamp(17px, 1.2vw, 22px));
  cursor: pointer;
}

.refresh-button:hover,
.spectate-button:hover { filter: brightness(1.25); }

.group-heading {
  margin: 0;
  font-size: max(var(--ui-min-primary-text-size, 16px), clamp(13px, 0.95vw, 16px));
  font-weight: 500;
  letter-spacing: .16em;
}
.super-heading { color: var(--ui-skill-strength); }
.testbed-heading { color: var(--ui-gold); }
/* Owner 09-07: competition sub-headings inside the FUMBBL list (tournament group · tournament, or division · scheduler). */
.competition-heading {
  margin: 10px 0 2px;
  padding: 4px 10px;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-text-size, 12px), 0.95rem);
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #1b4a2a; /* owner 09-07: dark green (no gold), on a firmer beige plate */
  border-left: 3px solid #1b4a2a;
  background: rgba(0, 0, 0, 0.14);
}
.competition-count { margin-left: 8px; font-size: 0.8em; opacity: 0.7; }

.game-list {
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface);
  box-shadow: 0 4px 14px rgba(0, 0, 0, .55);
}
/* Owner 08-19: fill the viewport instead of a fixed 560px cap — the blade is already a flex column
   (flex:1 + min-height:0 up the chain from .shell's 100vh), so the list grows to the spare height
   and its own overflow:auto only scrolls once rows exceed the filled space. */
.super-list,
.testbed-list { flex: 1 1 auto; }

.rows { min-width: 760px; }
.game-row {
  display: grid;
  grid-template-columns:
    clamp(56px, 4vw, 84px)
    minmax(0, 1.2fr)
    clamp(40px, 3vw, 60px)
    minmax(0, 1.2fr)
    clamp(64px, 4.5vw, 92px)
    clamp(96px, 6.5vw, 132px);
  gap: clamp(12px, 0.9vw, 18px);
  align-items: center;
  padding: clamp(11px, 0.8vw, 16px) clamp(14px, 1vw, 20px);
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-surface);
}
.game-row:nth-child(even) { background: var(--ui-surface-2); }
.game-row:last-child { border-bottom: 0; }

.game-id { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), clamp(12px, 0.85vw, 15px)); }
.team-cell { min-width: 0; line-height: 1.35; }
.team-cell strong {
  display: block;
  overflow: hidden;
  color: var(--ui-eggshell);
  font-size: max(var(--ui-min-primary-text-size, 16px), clamp(13px, 1.1vw, 20px));
  font-weight: 500;
  letter-spacing: .03em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.team-cell small {
  display: block;
  overflow: hidden;
  color: var(--ui-muted);
  font-size: max(var(--ui-min-text-size, 12px), clamp(11px, 0.8vw, 15px));
  text-overflow: ellipsis;
  white-space: nowrap;
}
.score {
  color: var(--ui-skill-strength);
  font-size: max(var(--ui-min-primary-text-size, 16px), clamp(14px, 1.1vw, 20px));
  text-align: center;
  white-space: nowrap;
}
.phase-chip {
  color: var(--ui-eggshell);
  font-size: max(var(--ui-min-text-size, 12px), clamp(12px, 0.9vw, 16px));
  letter-spacing: .08em;
  white-space: nowrap;
}
.spectate-button {
  box-sizing: border-box;
  width: clamp(96px, 6.5vw, 132px);
  padding: clamp(6px, 0.5vw, 10px) clamp(10px, 0.8vw, 16px);
  border: 2px outset color-mix(in srgb, var(--ui-forest) 64%, var(--ui-text));
  border-radius: 4px;
  color: var(--ui-text);
  background: var(--ui-forest);
  box-shadow: 0 2px 6px rgba(0, 0, 0, .5);
  font: inherit;
  font-size: max(var(--ui-min-text-size, 12px), clamp(12px, 0.85vw, 15px));
  letter-spacing: .08em;
  cursor: pointer;
}

.list-status {
  padding: 20px;
  color: var(--ui-muted);
  font-size: max(var(--ui-min-primary-text-size, 16px), clamp(13px, 0.95vw, 16px));
  text-align: center;
}

@keyframes live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .35; }
}

@media (max-width: 640px) {
  .spectate-browser { padding: 12px; }
  .browser-filter { order: 2; max-width: none; width: 100%; }
  .toolbar-spacer { display: none; }
  .live-indicator { margin-left: auto; }
}
</style>
