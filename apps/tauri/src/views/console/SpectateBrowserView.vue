<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FORK_EDITION } from '../../game/edition';
import fumbblLogoUrl from '../../assets/resources/fumbbl-logo.png';
import superFumbblLogoUrl from '../../assets/resources/super-fumbbl-logo.png';
import { FUMBBL_SITE, applyServerTarget } from '../../game/settings';
import { botGet } from '../../game/forkChallenge';
import { deriveForkGameRows, routeForkSpectate, type ForkGameRow } from '../../game/forkGames';
import { competitionLabel, groupByCompetition, missingCompetitionIds, type CompetitionNames } from '../../game/spectateCompetition';
import { teamLogoUrl } from '../../game/teamLogos';

interface BrowserMatch {
  id: number;
  half: number;
  turn: number;
  /** Owner 09-07: competition fields off /api/match/current (ids only for tournaments — names resolved below). */
  division?: string | null;
  scheduler?: string | null;
  tournament?: { id?: number | string; group?: number | string } | null;
  /** `tv` rides /api/match/current as a string of gold pieces (e.g. "1490000"). */
  teams: { side: string; name: string; coach: string; race: string; score: number; tv?: string | number }[];
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
    ...match.teams.flatMap((team) => [team.name, team.coach, team.race]), // owner 09-15: + race
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

// Owner 10-01: rows mirror the Play blade's game rows - crest / name / coach / race / TV | phase over score | away.
// Crests are ours (teamLogoUrl, bundled/local) - never FUMBBL's CDN; no race => null => the initials box.
function crest(race: string | undefined, side: 'home' | 'away'): string | null {
  return race ? teamLogoUrl({ race, side }) : null;
}
function initials(name: string | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '—';
  return words.length === 1 ? words[0]!.slice(0, 2).toUpperCase() : words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join('');
}
/** Same formatting as PlayView's formatTeamValue; the FUMBBL API sends tv as a numeric string. */
function formatTeamValue(raw: string | number | undefined): string | undefined {
  const value = Number(raw);
  if (!value || !Number.isFinite(value)) return undefined;
  const thousands = value >= 10_000 ? Math.round(value / 1_000) : Math.round(value);
  return `TV ${thousands.toLocaleString()}k`;
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
        <button v-if="FORK_EDITION" type="button" class="server-plate server-plate-super" :data-active="spectateSection === 'fork'"
          :aria-pressed="spectateSection === 'fork'" title="Super FUMBBL" @click="selectSpectateServer('fork')">
          <img :src="superFumbblLogoUrl" alt="Super FUMBBL" />
        </button>
      </div>
      <input
        v-if="spectateSection === 'fumbbl'"
        v-model="browserFilter"
        class="browser-filter"
        type="search"
        aria-label="Filter live games by team, coach, race or competition, or enter a game id"
        placeholder="Filter by team, coach, race or competition — or a game id + Enter"
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
          <!-- Owner 10-01: the fork's /games feed carries no race, TV or score - crests fall back to initials,
               the race/TV lines are omitted and the centre keeps its truthful "vs". -->
          <article v-for="match in forkGames" :key="match.gameId" class="game-row">
            <div class="row-team home">
              <span class="row-logo logo-fallback" aria-hidden="true">{{ initials(match.homeTeam) }}</span>
              <span class="row-text">
                <strong class="row-name">{{ match.homeTeam || '—' }}</strong>
                <small class="row-meta row-coach">{{ match.homeCoach || '—' }}</small>
              </span>
            </div>
            <div class="row-centre">
              <span class="row-phase">{{ phase(match) }}</span>
              <span class="row-score row-score-vs">vs</span>
            </div>
            <div class="row-right">
              <div class="row-team away">
                <span class="row-logo logo-fallback" aria-hidden="true">{{ initials(match.awayTeam) }}</span>
                <span class="row-text">
                  <strong class="row-name">{{ match.awayTeam || '—' }}</strong>
                  <small class="row-meta row-coach">{{ match.awayCoach || '—' }}</small>
                </span>
              </div>
              <button class="bevel spectate-button" type="button" @click="spectateFork(match.gameId)">Spectate</button>
            </div>
          </article>
        </div>
      </section>
    </template>

    <template v-else>
      <!-- Owner 09-15: the "▶ FUMBBL" heading under the FUMBBL plate is gone — the plate already names the source. -->
      <section class="game-list testbed-list" aria-label="FUMBBL live games" aria-live="polite">
        <div v-if="browserStatus" class="list-status">{{ browserStatus }}</div>
        <div v-else-if="filteredMatches.length === 0" class="list-status">No live games match the filter.</div>
        <div v-else class="rows">
          <template v-for="group in groupedMatches" :key="group.key">
          <h3 class="competition-heading" :title="group.label">{{ group.label }} <span class="competition-count">{{ group.matches.length }}</span></h3>
          <article v-for="match in group.matches" :key="match.id" class="game-row">
            <div class="row-team home">
              <img v-if="crest(team(match, 0)?.race, 'home')" class="row-logo" :src="crest(team(match, 0)?.race, 'home')!" alt="" />
              <span v-else class="row-logo logo-fallback" aria-hidden="true">{{ initials(team(match, 0)?.name) }}</span>
              <span class="row-text">
                <strong class="row-name">{{ team(match, 0)?.name || '—' }}</strong>
                <small class="row-meta row-coach">{{ team(match, 0)?.coach || '—' }}</small>
                <small v-if="team(match, 0)?.race" class="row-meta row-race">{{ team(match, 0)?.race }}</small>
                <small v-if="formatTeamValue(team(match, 0)?.tv)" class="row-meta row-tv">{{ formatTeamValue(team(match, 0)?.tv) }}</small>
              </span>
            </div>
            <div class="row-centre">
              <span class="row-phase">{{ phase(match) }}</span>
              <span class="row-score"><span class="row-score-n">{{ team(match, 0)?.score ?? 0 }}</span><span class="row-score-dash">&ndash;</span><span class="row-score-n">{{ team(match, 1)?.score ?? 0 }}</span></span>
            </div>
            <div class="row-right">
              <div class="row-team away">
                <img v-if="crest(team(match, 1)?.race, 'away')" class="row-logo" :src="crest(team(match, 1)?.race, 'away')!" alt="" />
                <span v-else class="row-logo logo-fallback" aria-hidden="true">{{ initials(team(match, 1)?.name) }}</span>
                <span class="row-text">
                  <strong class="row-name">{{ team(match, 1)?.name || '—' }}</strong>
                  <small class="row-meta row-coach">{{ team(match, 1)?.coach || '—' }}</small>
                  <small v-if="team(match, 1)?.race" class="row-meta row-race">{{ team(match, 1)?.race }}</small>
                  <small v-if="formatTeamValue(team(match, 1)?.tv)" class="row-meta row-tv">{{ formatTeamValue(team(match, 1)?.tv) }}</small>
                </span>
              </div>
              <button class="bevel spectate-button" type="button" @click="spectate(match.id)">Spectate</button>
            </div>
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
  max-width: clamp(520px, 42vw, 820px); /* owner 09-15: wide enough for the full placeholder */
  min-width: 320px;
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

.refresh-button:hover { filter: brightness(1.25); }

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
  scrollbar-gutter: stable both-edges; /* the scroll bar must not push the rows (and the score) off the centre line */
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

.rows { display: grid; align-content: start; gap: 10px; padding: 10px; }
/* Owner 10-01: game rows speak the Play blade's language (PlayView.vue .game-row / .row-* / .bevel, duplicated here -
   no shared extraction). THREE bevelled panels lifted off an eggshell row: home | phase over score | away; the right
   column holds the away panel AND the Spectate button (.row-right) so the outer columns are equal and the centre
   panel sits on the row's centre line. The Play palette applies to the rows in both lists. */
.game-row {
  --pb-text: var(--ui-forest, #1A401C);
  --pb-muted: color-mix(in srgb, var(--ui-forest, #1A401C) 62%, transparent);
  --pb-line: color-mix(in srgb, var(--ui-forest, #1A401C) 28%, transparent);
  --pb-carmine: #790004;
  /* S84: equal team panels, the centre the smallest; the Spectate column is mirrored by left padding so the
     centre panel stays on the page's centre line. */
  --row-actions-w: 170px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(170px, .26fr) minmax(0, 1fr) var(--row-actions-w);
  align-items: stretch;
  gap: 12px;
  padding: 12px 14px 12px calc(14px + var(--row-actions-w) + 12px);
  border: 1px solid var(--pb-line);
  border-radius: 4px;
  color: var(--pb-text);
  background: var(--ui-eggshell, #E7DDC7);
}
.row-team, .row-centre {
  box-sizing: border-box;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--pb-text) 30%, transparent);
  border-radius: 6px;
  background: var(--ui-old-lace, #F8F5E7);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .9), inset 0 -3px 0 rgba(26, 64, 28, .12), 0 3px 7px rgba(26, 64, 28, .24);
}
.row-team { display: flex; align-items: center; gap: 14px; min-width: 0; }
.row-right { display: contents; } /* the away panel and the Spectate button are grid items of the row itself */
.row-right > .bevel { align-self: center; }
.row-team.away { flex-direction: row-reverse; text-align: right; }
.row-logo { box-sizing: border-box; flex: 0 0 128px; width: 128px; height: 128px; object-fit: contain; image-rendering: pixelated; }
.logo-fallback { display: grid; place-items: center; border: 1px solid var(--pb-line); border-radius: 4px; color: var(--pb-text); background: var(--ui-old-lace, #F8F5E7); font-size: 28px; letter-spacing: .06em; }
.row-text { display: grid; gap: 6px; min-width: 0; } /* name / coach / race / TV, evenly spaced */
.row-name { color: var(--pb-text); font-size: 24px; font-weight: 500; line-height: 1.15; overflow-wrap: break-word; }
.row-meta { color: var(--pb-muted); font-size: 18px; line-height: 1.2; overflow-wrap: break-word; }
.row-coach { color: var(--pb-text); } /* coach names in the darker green */
.row-centre { display: grid; justify-items: center; align-content: center; gap: 6px; min-width: 0; }
.row-phase { color: var(--pb-text); font-size: 18px; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; }
.row-score {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  column-gap: .35em;
  align-items: baseline;
  justify-self: stretch;
  color: var(--pb-carmine);
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: 42px;
  font-weight: 800;
  line-height: 1;
  text-shadow: 2px 2px 0 rgba(26, 64, 28, .18);
  white-space: nowrap;
}
.row-score-n:first-child { text-align: right; }
.row-score-n:last-child { text-align: left; }
/* Fork rows: no score on the wire - the truthful "vs", centred in the score's style. */
.row-score.row-score-vs { display: block; justify-self: center; }

/* The Play blade's Black/Red action button (PlayView .bevel + .resume-button sizing). */
.bevel {
  padding: 12px 26px;
  border: 2px outset #a83236;
  border-radius: 4px;
  color: #fff;
  background: var(--pb-carmine, #790004);
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
.spectate-button { font-size: 22px; padding: 10px 22px; white-space: nowrap; }

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

/* Windows under ~1500px: the away panel shares its column with the Spectate button, so shrink the crest, the centre
   panel and the team name rather than wrap names letter by letter. */
@media (max-width: 1500px) {
  .game-row { --row-actions-w: 150px; }
  .spectate-button { font-size: 20px; padding: 10px 12px; }
  .row-logo { flex-basis: 88px; width: 88px; height: 88px; }
  .row-name { font-size: 20px; }
  .row-score { font-size: 34px; }
}

@media (max-width: 640px) {
  .spectate-browser { padding: 12px; }
  .browser-filter { order: 2; max-width: none; width: 100%; }
  .toolbar-spacer { display: none; }
  .live-indicator { margin-left: auto; }
  .bevel { font-size: 18px; padding: 10px 18px; }
  .game-row { grid-template-columns: 1fr; padding: 12px 14px; }
  .row-right > .bevel { align-self: stretch; }
  .row-logo { width: 64px; height: 64px; flex-basis: 64px; }
  .logo-fallback { font-size: 18px; }
  .row-team.away { flex-direction: row; text-align: left; }
}
</style>
