<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import fumbblLogoUrl from '../assets/resources/fumbbl-logo.png';
import { gameStore } from '../game/store';
import { activeServerTarget, applyServerTarget, settings } from '../game/settings';
import {
  classifyReplayFileContent,
  sharedReplayFileImporter,
} from '../game/replay/replayFileImport';
import { jnlpEntryError, readJnlpFile, routeJnlpRequest } from '../game/jnlpRouting';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { recentTeamCapNote } from '../game/fumbblRecentMatches';
import {
  ReplaySearchTimeout, maskRow, normalizeQuery, resolveReplayId, runReplaySearch, searchGroup, withSearchTimeout,
  type AbortableFetch, type FumbblGroup, type ReplayRow, type ReplaySearchResult,
} from '../game/replaySearch';
import { relativeTime } from '../game/fumbblPlayBlade';
import { CONSOLE_PALETTE, THEME_PRESETS, deriveTheme } from '../game/theme';
import MatchRow from '../components/MatchRow.vue';
import PostGamePanel from '../components/PostGamePanel.vue';
import { loadPostGameSnapshot, postGameSnapshotKeys } from '../game/postGameCache';
import { postGameKey, type PostGameSnapshot } from '../game/postGameProjection';

/**
 * Owner 10-06 (spec-replay-pane-revamp.md): the Replay pane. One search field ("Coach, league or game ID",
 * game/replaySearch.ts), a "Hide scores and outcomes" checkbox, the results as the Play blade's recent-game rows
 * (components/MatchRow.vue) with Details / Replay, then the replay-file import. FUMBBL only - owner 10-06: no fork
 * games or fork-server copy in this pane, in either edition. Nothing connects until the user clicks Replay.
 */

// ---- FUMBBL colour scheme, scoped to this pane (whatever the global theme) ----
// The `fumbbl` preset's two colours through the same deriveTheme the global theme uses, written as --ui-* on the
// pane root; the --pb-* row colours are the Play blade's (PlayView .play-view), whose rows MatchRow draws.
const paneTheme = computed<Record<string, string>>(() => {
  const preset = THEME_PRESETS.fumbbl;
  const forest = CONSOLE_PALETTE['--ui-forest'];
  return {
    ...deriveTheme(preset.primary, preset.secondary),
    '--pb-text': forest,
    '--pb-muted': `color-mix(in srgb, ${forest} 62%, transparent)`,
    '--pb-line': `color-mix(in srgb, ${forest} 28%, transparent)`,
    '--pb-carmine': THEME_PRESETS['brand-red'].primary, // the Play blade's carmine action accent (#790004)
  };
});

// ---- search ----
const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
// window.fetch is wrapped so it is never invoked with a foreign `this`.
const baseFetch: AbortableFetch = inTauri
  ? (input, init) => (tauriFetch as typeof fetch)(input, init)
  : (input, init) => fetch(input, init);
const query = ref('');
const search = reactive({ loading: false, error: '', result: null as ReplaySearchResult | null });
let searchSeq = 0;
let searchAbort: AbortController | null = null;
async function runSearch(): Promise<void> {
  cancelReplayLookup();
  const text = query.value.trim();
  await showSearch((f) => runReplaySearch(text, settings.coach, f));
}
/** A league from the pick list (several leagues matched the name). */
async function pickGroup(group: FumbblGroup): Promise<void> {
  cancelReplayLookup();
  const text = search.result?.query ?? group.name;
  await showSearch((f) => searchGroup(group, f, text));
}
/** Owner 10-06: one search at a time - a newer search aborts the older one's requests, and every search settles
 *  within REPLAY_SEARCH_TIMEOUT_MS ("Search timed out") so the button always comes back. */
async function showSearch(run: (f: (input: string) => Promise<Response>) => Promise<ReplaySearchResult>): Promise<void> {
  searchAbort?.abort();
  const controller = new AbortController();
  searchAbort = controller;
  const seq = ++searchSeq;
  search.loading = true; search.error = '';
  try {
    const result = await withSearchTimeout(run, baseFetch, undefined, controller);
    if (seq !== searchSeq) return;
    search.result = result;
  } catch (error) {
    if (seq !== searchSeq) return;
    search.result = null;
    search.error = error instanceof ReplaySearchTimeout ? error.message : `Couldn't search — ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    if (seq === searchSeq) { search.loading = false; searchAbort = null; }
  }
}
const rows = computed<ReplayRow[]>(() => search.result?.rows ?? []);
const hideScores = computed(() => settings.replaySearchHideScores);
const resultsTitle = computed(() => {
  const r = search.result;
  if (!r) return 'Results';
  switch (r.kind) {
    case 'own': return 'Your recent games';
    case 'coach': return `Recent games for ${r.coach ?? r.query}`;
    case 'match': return `Match ${r.query}`;
    case 'replay': return `Game ${r.query}`;
    case 'league': return `League: ${r.group?.name ?? r.query}`;
    default: return 'Results';
  }
});
const needsOwnCoach = computed(() => search.result?.kind === 'own' && !search.result.coach);
const pickGroups = computed<FumbblGroup[]>(() => (search.result?.kind === 'league-pick' ? search.result.groups ?? [] : []));
/** pick-list names shown more than once (compared like the name match: case- and whitespace-insensitive) carry the
 *  group id as secondary text */
function pickKey(group: FumbblGroup): string { return normalizeQuery(group.name).toLowerCase(); }
const duplicatePickNames = computed(() => {
  const counts = new Map<string, number>();
  for (const g of pickGroups.value) counts.set(pickKey(g), (counts.get(pickKey(g)) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name));
});
/** a bare number read as a match or a league: one-line links to the other readings (explicit prefixes) */
const altReadings = computed<{ label: string; query: string }[]>(() => {
  const r = search.result;
  if (!r?.bareId) return [];
  const id = r.bareId;
  const alts = [{ label: `replay ${id}`, query: `replay:${id}` }];
  if (r.kind === 'match') alts.push({ label: `league ${id}`, query: `league:${id}` });
  return alts;
});
function searchFor(text: string): void {
  query.value = text;
  void runSearch();
}
const emptyMessage = computed(() => {
  const r = search.result;
  if (!r || rows.value.length || r.kind === 'league-pick') return '';
  if (r.kind === 'none') return `No coach or league found for ${r.query}`;
  if (r.kind === 'league') return `No played games in the recent tournaments of ${r.group?.name ?? r.query}`;
  return `No games found for ${r.query || r.coach}`;
});

function rowWhen(row: ReplayRow): { rel: string; abs: string } {
  if (!row.when) return { rel: '', abs: '' };
  const date = new Date(row.when.replace(' ', 'T'));
  return { rel: relativeTime(row.when), abs: Number.isNaN(date.valueOf()) ? row.when : date.toLocaleString() };
}
const replayLookupError = ref('');
/** the row whose replay id is being looked up (only that row's Replay is busy) */
const lookupRowKey = ref<string | null>(null);
let lookupAbort: AbortController | null = null;
let replayClickSeq = 0;
let unmounted = false;
/** a newer Replay click, a new search or leaving the pane cancels a pending lookup */
function cancelReplayLookup(): void {
  replayClickSeq += 1;
  lookupAbort?.abort();
  lookupAbort = null;
  lookupRowKey.value = null;
}
async function replayRow(row: ReplayRow): Promise<void> {
  replayLookupError.value = '';
  // Astra P1 (10-06): every click takes a token; a lookup that resolves after a newer click, after the pane is left,
  // or after the session changed (another replay / a game opened meanwhile) is dropped - it never connects.
  cancelReplayLookup();
  const token = replayClickSeq;
  let gameId = row.replayId;
  if (!gameId && row.replayLookup) {
    // League rows whose schedule carried no replay id look it up (/api/match/get) on this click only - with the
    // search's 15 s timeout + abort (Astra 10-06), busy on this row alone.
    const before = sessionSnapshot();
    const controller = new AbortController();
    lookupAbort = controller;
    lookupRowKey.value = row.key;
    let timedOut = false;
    try {
      gameId = await withSearchTimeout((f) => resolveReplayId(row, f), baseFetch, undefined, controller);
    } catch (error) {
      timedOut = error instanceof ReplaySearchTimeout;
      gameId = 0;
    } finally {
      if (token === replayClickSeq) { lookupRowKey.value = null; lookupAbort = null; }
    }
    if (unmounted || token !== replayClickSeq || !sessionIsCurrent(before)) return;
    if (timedOut) { replayLookupError.value = `Looking up the replay for match ${row.matchId} timed out.`; return; }
  }
  if (!gameId) { if (row.replayLookup) replayLookupError.value = `FUMBBL has no replay for match ${row.matchId}.`; return; }
  sharedReplayFileImporter.invalidate();
  applyServerTarget('fumbbl');
  const target = activeServerTarget();
  localError.value = '';
  detailsRow.value = null;
  void gameStore.connectReplay({ url: target.url, compression: target.compression, coach: settings.coach.trim(), gameId });
}

// ---- Details (PlayView's post-game cache popup). Hide-scores hides the button: the end-of-game pane is the result. ----
const detailsKeys = ref<Set<string>>(new Set());
const detailsRow = ref<ReplayRow | null>(null);
const detailsSnapshot = ref<PostGameSnapshot | null>(null);
const detailsLoading = ref(false);
function detailsKeyFor(row: ReplayRow): string { return postGameKey('fumbbl', row.replayId); }
function hasDetails(row: ReplayRow): boolean { return !!row.replayId && detailsKeys.value.has(detailsKeyFor(row)); }
async function refreshDetailsKeys(): Promise<void> { detailsKeys.value = await postGameSnapshotKeys(); }
async function openDetails(row: ReplayRow): Promise<void> {
  detailsRow.value = row; detailsSnapshot.value = null; detailsLoading.value = true;
  try { detailsSnapshot.value = await loadPostGameSnapshot(detailsKeyFor(row)); } finally { detailsLoading.value = false; }
}
function closeDetails(): void { detailsRow.value = null; detailsSnapshot.value = null; }
function onDetailsKey(event: KeyboardEvent): void { if (event.key === 'Escape') closeDetails(); }
function detailsSide(row: ReplayRow, snapshot: PostGameSnapshot): 'home' | 'away' {
  return snapshot.game.teamHome.teamId === String(row.left.teamId ?? '') ? 'home' : 'away';
}

// ---- replay file import (unchanged) ----
const localError = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const fileLoading = ref(false);
const stopFileBusy = sharedReplayFileImporter.subscribeBusy((busy) => { fileLoading.value = busy; });
interface LauncherSessionSnapshot {
  game: typeof gameStore.game.value;
  sessionKey: string;
  loading: boolean;
  source: typeof gameStore.replay.source;
  sessionState: typeof gameStore.state.sessionState;
  replayActive: boolean;
}
function sessionSnapshot(): LauncherSessionSnapshot {
  return {
    game: gameStore.game.value,
    sessionKey: gameStore.replay.sessionKey,
    loading: gameStore.replay.loading,
    source: gameStore.replay.source,
    sessionState: gameStore.state.sessionState,
    replayActive: gameStore.replay.active,
  };
}
function sessionIsCurrent(snapshot: LauncherSessionSnapshot): boolean {
  const current = sessionSnapshot();
  return current.game === snapshot.game
    && current.sessionKey === snapshot.sessionKey
    && current.loading === snapshot.loading
    && current.source === snapshot.source
    && current.sessionState === snapshot.sessionState
    && current.replayActive === snapshot.replayActive;
}
onBeforeUnmount(() => {
  unmounted = true;
  cancelReplayLookup();
  searchSeq += 1;
  searchAbort?.abort();
  stopFileBusy();
  sharedReplayFileImporter.invalidate();
});
function openFilePicker(): void {
  localError.value = '';
  fileInput.value?.click();
}
async function commitOpenedFile(text: string, byteLength: number): Promise<void> {
  if (classifyReplayFileContent(text) === 'json') {
    gameStore.loadReplayFile(text, byteLength);
    return;
  }
  const request = await readJnlpFile({ text: async () => text });
  const result = routeJnlpRequest(request, { sourceName: 'Opened replay file' });
  if (result === 'host-rejected') throw new Error(jnlpEntryError.value);
  if (result === 'invalid') throw new Error(jnlpEntryError.value || 'JNLP could not be used.');
}
async function loadFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const ticket = sharedReplayFileImporter.begin(sessionSnapshot());
  localError.value = '';
  const result = await sharedReplayFileImporter.load({
    ticket,
    file,
    isCurrent: sessionIsCurrent,
    commit: commitOpenedFile,
  });
  if (result.status === 'session-changed') localError.value = 'The replay session changed while the file was loading. Choose the file again.';
  else if (result.status === 'failed') localError.value = result.error.message;
}

onMounted(() => { void runSearch(); void refreshDetailsKeys(); }); // empty query = the user's own recent games
</script>

<template>
  <section class="replay-launcher" :style="paneTheme" data-scheme="fumbbl">
    <div class="replay-console">
      <header class="replay-heading">
        <div>
          <span class="replay-kicker">Match archive</span>
          <h1>Replays</h1>
          <p>Search a FUMBBL coach, league or game ID, or open a replay file from this device.</p>
        </div>
        <span class="read-only-chip">Read only</span>
      </header>

      <section class="replay-panel search-panel" aria-labelledby="replay-search-title" data-testid="replay-search">
        <h2 id="replay-search-title" class="visually-hidden">Search replays</h2>
        <form class="search-row" role="search" @submit.prevent="runSearch">
          <input
            v-model="query"
            class="search-input"
            type="search"
            autocomplete="off"
            spellcheck="false"
            placeholder="Coach, league or game ID"
            aria-label="Coach, league or game ID"
          />
          <!-- enabled while a search runs: a new search supersedes (aborts) the running one -->
          <button class="bevel search-button" type="submit" :aria-busy="search.loading">{{ search.loading ? 'Searching…' : 'Search' }}</button>
          <label class="hide-scores">
            <input v-model="settings.replaySearchHideScores" type="checkbox" />
            <span>Hide scores and outcomes</span>
          </label>
        </form>
        <div class="search-progress" :class="{ active: search.loading }" aria-hidden="true"><div class="search-progress-bar"></div></div>
        <div class="search-state" aria-live="polite">
          <p v-if="search.loading" class="note state-line"><span class="status-light loading" aria-hidden="true"></span>Searching…</p>
          <p v-else-if="search.error" class="error">{{ search.error }}</p>
          <p v-else-if="needsOwnCoach" class="note">Set your FUMBBL coach name in Settings to see your recent games, or search for a coach or game ID.</p>
          <p v-else-if="emptyMessage" class="note">{{ emptyMessage }}</p>
          <p v-if="!search.loading && search.result?.notice" class="note search-notice" role="status">{{ search.result.notice }}</p>
          <p v-if="!search.loading && search.result?.teamCap" class="note team-cap-note">{{ recentTeamCapNote(search.result.teamCap) }}</p>
          <p v-if="!search.loading && altReadings.length" class="note alt-readings">
            Looking for
            <template v-for="(alt, i) in altReadings" :key="alt.query"><template v-if="i"> or </template><button class="link" type="button" @click="searchFor(alt.query)">{{ alt.label }}</button></template>
            instead?
          </p>
        </div>
      </section>

      <section v-if="pickGroups.length" class="replay-panel results-panel" aria-labelledby="replay-pick-title" data-testid="replay-league-pick">
        <h2 id="replay-pick-title" class="results-title">Leagues matching “{{ search.result?.query }}” <span class="count">{{ pickGroups.length }}</span></h2>
        <ul class="league-pick">
          <li v-for="group in pickGroups" :key="group.id">
            <button class="plain league-pick-button" type="button" :disabled="search.loading" :title="`League ${group.id}`" @click="pickGroup(group)">
              {{ group.name }}<small v-if="duplicatePickNames.has(group.name.toLowerCase())" class="pick-id"> #{{ group.id }}</small>
            </button>
          </li>
        </ul>
      </section>

      <section v-if="rows.length" class="replay-panel results-panel" aria-labelledby="replay-results-title" data-testid="replay-results">
        <h2 id="replay-results-title" class="results-title">{{ resultsTitle }} <span class="count">{{ rows.length }}</span></h2>
        <div class="results-list" :class="{ 'results-stale': search.loading }">
          <MatchRow
            v-for="row in rows"
            :key="row.key"
            class="search-row-item"
            :data-kind="search.result?.kind"
            :left="row.left"
            :right="row.right"
            :score="maskRow(row, hideScores).score"
            :result="maskRow(row, hideScores).result"
          >
            <template #actions>
              <div class="row-actions">
                <button v-if="hasDetails(row) && !hideScores" class="bevel resume-button details-button" type="button"
                  :title="`End-of-game details for game ${row.replayId}`" @click="openDetails(row)">Details</button>
                <button class="bevel resume-button row-replay-button" type="button" :disabled="gameStore.replay.loading || lookupRowKey === row.key || (!row.replayId && !row.replayLookup)"
                  :title="row.replayId ? `Replay game ${row.replayId}` : row.replayLookup ? `Replay match ${row.matchId}` : 'FUMBBL has no replay for this match'" @click="replayRow(row)">Replay</button>
                <span v-if="row.when" class="row-when" :title="rowWhen(row).abs">{{ rowWhen(row).rel }}</span>
                <span v-if="row.division" class="row-division">{{ row.division }}</span>
              </div>
            </template>
          </MatchRow>
        </div>
      </section>

      <section class="replay-panel file-panel" aria-labelledby="file-replay-title">
        <div class="file-well">
          <span class="logo-plate fumbbl-plate"><img :src="fumbblLogoUrl" alt="FUMBBL" /></span>
          <div class="file-text">
            <h2 id="file-replay-title">Open a replay file</h2>
            <p class="file-copy">Open a FUMBBL replay, JSON replay bundle, or replay JNLP.</p>
          </div>
          <button class="file-button fumbbl-open" type="button" :disabled="fileLoading || gameStore.replay.loading"
            :aria-busy="fileLoading" @click="openFilePicker">
            <span aria-hidden="true">▣</span>
            <span>{{ fileLoading ? 'Reading…' : 'Open FUMBBL Replay' }}</span>
          </button>
        </div>
      </section>
      <input ref="fileInput" type="file" hidden tabindex="-1" aria-hidden="true"
        accept="application/json,application/x-java-jnlp-file,text/xml,.json,.ffbreplay,.jnlp" @change="loadFile" />
      <p v-if="gameStore.replay.error || localError || replayLookupError" class="error" role="alert" aria-live="assertive">{{ gameStore.replay.error || localError || replayLookupError }}</p>
      <p class="read-only-note"><span aria-hidden="true">◆</span> Replay mode is read-only. No gameplay command can leave the client.</p>
    </div>

    <!-- Details popup (PlayView's): the cached end-of-game pane. Never reachable while scores are hidden. -->
    <div v-if="detailsRow && !hideScores" class="details-modal" role="dialog" aria-modal="true" :aria-label="`Details: ${detailsRow.left.name} vs ${detailsRow.right?.name ?? ''}`" tabindex="-1" @click.self="closeDetails" @keydown="onDetailsKey">
      <div class="details-card">
        <header class="details-head">
          <span class="details-title">{{ detailsRow.left.name }} <span class="vs">vs</span> {{ detailsRow.right?.name ?? '' }}</span>
          <small class="details-when">{{ rowWhen(detailsRow).rel }}<template v-if="detailsRow.matchId"> &middot; match {{ detailsRow.matchId }}</template></small>
          <button class="details-close" type="button" aria-label="Close details" @click="closeDetails">&#x2715;</button>
        </header>
        <div class="details-body">
          <p v-if="detailsLoading" class="note">Loading&hellip;</p>
          <PostGamePanel v-else-if="detailsSnapshot" :snapshot="detailsSnapshot" embedded :default-roster-side="detailsSide(detailsRow, detailsSnapshot)" :local-side="detailsSnapshot.seat === 'play' ? detailsSide(detailsRow, detailsSnapshot) : null" :skill-mode="settings.skillDisplay === 'markings' ? 'markings' : 'icons'" />
          <div v-else class="details-missing">
            <p class="note">No details stored for this game.</p>
            <small>Details are kept for games finished in this client during the last 7 days. Replay it to watch it again.</small>
          </div>
        </div>
        <footer class="details-foot">
          <button class="bevel replay-button" type="button" :disabled="gameStore.replay.loading" @click="replayRow(detailsRow)">Replay</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Owner 10-06: the FUMBBL scheme - the --ui-* / --pb-* tokens are set on the root by paneTheme (script). Card and
   row language follows the Play blade (PlayView): old-lace cards on eggshell, forest text, carmine bevel actions. */
.replay-launcher {
  box-sizing: border-box;
  min-height: calc(100vh - 95px);
  display: flex;
  flex: 1;
  justify-content: center;
  width: 100%;
  padding: clamp(18px, 2vw, 34px);
  color: var(--pb-text);
  background: var(--ui-eggshell);
}
.replay-console {
  box-sizing: border-box;
  width: min(2200px, 94vw);
  display: flex;
  flex-direction: column;
  gap: clamp(14px, 1.4vw, 22px);
}
.replay-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 2px 2px 14px;
  border-bottom: 3px solid var(--ui-primary);
}
.replay-kicker {
  display: block;
  color: var(--pb-carmine);
  font-size: max(var(--ui-min-text-size, 12px), 10px);
  font-weight: 700;
  letter-spacing: .18em;
  text-transform: uppercase;
}
h1, h2, p { margin: 0; }
h1 { margin-top: 3px; color: var(--pb-text); font-family: 'Nuffle', system-ui, sans-serif; font-size: 40px; font-weight: 800; letter-spacing: .04em; line-height: 1; text-transform: uppercase; }
.replay-heading p { margin-top: 5px; color: var(--pb-muted); font-size: max(var(--ui-min-text-size, 12px), 13px); line-height: 1.45; }
.read-only-chip {
  flex: 0 0 auto;
  padding: 6px 10px 5px;
  color: var(--ui-text-on-primary);
  border-radius: 4px;
  background: var(--ui-primary);
  font-size: max(var(--ui-min-text-size, 12px), 10px);
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
}
.replay-panel { box-sizing: border-box; min-width: 0; border: 1px solid var(--pb-text); border-radius: 6px; background: var(--ui-old-lace); box-shadow: 0 4px 14px color-mix(in srgb, var(--pb-text) 18%, transparent); }
.search-panel { display: grid; gap: 10px; padding: 16px 20px; }
.search-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.search-input {
  flex: 1 1 320px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--pb-text);
  border-radius: 2px;
  color: var(--pb-text);
  background: var(--ui-old-lace);
  font-size: max(var(--ui-min-primary-text-size, 16px), 18px);
}
.search-input:focus { outline: 2px solid var(--pb-carmine); outline-offset: 1px; }
.hide-scores { display: inline-flex; align-items: center; gap: 8px; color: var(--pb-text); font-size: max(var(--ui-min-text-size, 12px), 15px); white-space: nowrap; cursor: pointer; }
.hide-scores input { width: 18px; height: 18px; accent-color: var(--ui-primary); }
.search-state:empty { display: none; }
.link { padding: 0; color: var(--pb-carmine); border: 0; background: none; font: inherit; text-decoration: underline; cursor: pointer; }
.pick-id { color: var(--pb-muted); font-size: 12px; letter-spacing: 0; }
.league-pick { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.plain { padding: 8px 14px; color: var(--pb-text); border: 1px solid color-mix(in srgb, var(--pb-text) 30%, transparent); border-radius: 6px; background: var(--ui-old-lace);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .9), inset 0 -3px 0 rgba(26, 64, 28, .12), 0 2px 5px rgba(26, 64, 28, .2);
  font-family: 'Nuffle', system-ui, sans-serif; font-size: 15px; font-weight: 800; letter-spacing: .06em; cursor: pointer; }
.plain:hover:not(:disabled) { border-color: var(--pb-carmine); color: var(--pb-carmine); }
.plain:disabled { opacity: .45; cursor: default; }
.results-panel { display: flex; flex-direction: column; gap: 10px; padding: 18px 22px; }
.results-title { display: flex; align-items: center; gap: 10px; color: var(--pb-carmine); font-family: 'Nuffle', system-ui, sans-serif; font-size: 24px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.count { padding: 2px 10px; border-radius: 999px; color: var(--pb-text); background: color-mix(in srgb, var(--pb-text) 14%, transparent); font-size: 14px; }
.results-list { display: grid; align-content: start; gap: 10px; max-height: min(64vh, 1200px); overflow-y: auto; scrollbar-gutter: stable both-edges; }
.bevel {
  padding: 12px 26px;
  border: 2px outset color-mix(in srgb, var(--pb-carmine) 70%, white);
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
.search-button { font-size: 20px; padding: 11px 22px; }
.resume-button { font-size: 22px; padding: 10px 22px; white-space: nowrap; }
.row-division { color: var(--pb-muted); font-size: 14px; letter-spacing: .06em; text-align: center; text-transform: uppercase; white-space: nowrap; }
button { font: inherit; }
.file-button {
  color: var(--ui-text);
  border: 2px outset color-mix(in srgb, var(--ui-text) 24%, var(--ui-surface-2));
  border-radius: 5px;
  background: linear-gradient(180deg, var(--ui-surface-2), var(--ui-surface));
  cursor: pointer;
}
.file-button:hover:not(:disabled) { border-color: var(--ui-accent); filter: brightness(1.14); }
.file-button:active:not(:disabled) { border-style: inset; transform: translateY(1px); }
.file-button:disabled { opacity: .45; cursor: wait; }
.file-button:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; box-shadow: 0 0 0 4px var(--ui-focus-halo); }
.error { color: var(--ui-danger); font-size: max(var(--ui-min-text-size, 12px), 13px); line-height: 1.45; }
.note { color: var(--pb-muted); font-size: max(var(--ui-min-text-size, 12px), 14px); line-height: 1.45; }
.state-line { display: flex; align-items: center; gap: 7px; }
.status-light { width: 7px; height: 7px; border-radius: 50%; background: var(--ui-success); box-shadow: 0 0 7px var(--ui-success); }
.status-light.loading { animation: replay-pulse 1.2s ease-in-out infinite; }
/* Owner 10-06: an unmistakable "refreshing" bar under the search field while a search runs; results dim until the new set lands. */
.search-progress { height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--pb-carmine, #790004) 18%, transparent); overflow: hidden; opacity: 0; transition: opacity .15s; }
.search-progress.active { opacity: 1; }
.search-progress-bar { width: 38%; height: 100%; border-radius: 2px; background: var(--pb-carmine, #790004); transform: translateX(-120%); }
.search-progress.active .search-progress-bar { animation: replay-search-sweep 1.1s ease-in-out infinite; }
@keyframes replay-search-sweep { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }
.results-list.results-stale { opacity: .45; filter: saturate(.6); transition: opacity .2s; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .search-progress.active .search-progress-bar { animation: none; width: 100%; transform: none; opacity: .7; } }
.file-well { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; padding: 14px 20px; }
.file-text { flex: 1 1 260px; display: grid; gap: 4px; }
.file-text h2 { color: var(--pb-text); font-size: max(var(--ui-min-primary-text-size, 16px), 16px); font-weight: 600; letter-spacing: .04em; }
.file-copy { color: var(--pb-muted); font-size: max(var(--ui-min-text-size, 12px), 12px); line-height: 1.5; }
.fumbbl-open { display: flex; align-items: center; justify-content: center; gap: 9px; padding: 10px 14px; color: var(--ui-text-on-primary); border-color: var(--ui-primary); background: var(--ui-primary); font-size: max(var(--ui-min-text-size, 12px), 12px); font-weight: 700; letter-spacing: .045em; }
.fumbbl-open:hover:not(:disabled) { border-color: var(--ui-accent); background: var(--ui-active); }
.logo-plate { display: grid; place-items: center; min-width: 0; padding: 10px; border: 2px outset color-mix(in srgb, var(--ui-forest) 45%, var(--ui-old-lace)); border-radius: 6px; }
.logo-plate img { display: block; max-width: 160px; max-height: 44px; object-fit: contain; }
.fumbbl-plate { background: var(--ui-eggshell); }
.read-only-note { align-self: center; display: flex; align-items: center; gap: 7px; color: var(--pb-muted); font-size: max(var(--ui-min-text-size, 12px), 10px); letter-spacing: .04em; text-align: center; }
.read-only-note span { color: var(--ui-success); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
/* Details popup (PlayView's) */
.details-modal { position: fixed; inset: 0; z-index: 200; display: flex; align-items: center; justify-content: center; padding: 3vh 3vw; background: #05070cc8; backdrop-filter: blur(2px); }
.details-card { display: flex; flex-direction: column; width: min(1100px, 94vw); max-height: 92vh; border: 1px solid var(--pb-text); border-radius: 8px; background: var(--ui-old-lace); color: var(--pb-text); box-shadow: 0 20px 60px #000c; overflow: hidden; }
.details-head { display: flex; align-items: center; gap: 14px; padding: 12px 18px; border-bottom: 1px solid var(--pb-line); }
.details-title { color: var(--pb-text); font-size: 22px; font-weight: 500; min-width: 0; overflow-wrap: break-word; }
.details-title .vs { color: var(--pb-muted); }
.details-when { color: var(--pb-muted); font-size: 14px; white-space: nowrap; }
.details-close { margin-left: auto; width: 34px; height: 34px; border: 1px solid var(--pb-text); border-radius: 6px; color: var(--pb-text); background: var(--ui-eggshell); font-size: 16px; cursor: pointer; }
.details-close:hover { border-color: var(--pb-carmine); color: #fff; background: var(--pb-carmine); }
.details-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px 18px; }
.details-missing { display: grid; gap: 6px; justify-items: center; padding: 40px 0; color: var(--pb-muted); text-align: center; }
.details-foot { display: flex; justify-content: flex-end; gap: 12px; padding: 12px 18px; border-top: 1px solid var(--pb-line); }
@keyframes replay-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
@media (max-width: 1500px) {
  .resume-button { font-size: 20px; padding: 10px 12px; }
}
@media (max-width: 640px) {
  .replay-launcher { padding: 12px; }
  h1 { font-size: 32px; }
  .replay-heading { align-items: flex-start; }
  .replay-heading p { display: none; }
  .bevel { font-size: 18px; padding: 10px 18px; }
}
</style>
