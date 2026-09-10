<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import fumbblLogoUrl from '../assets/resources/fumbbl-logo.png';
import { gameStore } from '../game/store';
import { activeServerTarget, applyServerTarget, resolveJoinCreds, settings } from '../game/settings';
import { coachPassword } from '../game/credentials';
import {
  classifyReplayFileContent,
  sharedReplayFileImporter,
} from '../game/replay/replayFileImport';
import { jnlpEntryError, readJnlpFile, routeJnlpRequest } from '../game/jnlpRouting';
import {
  createMyGamesState,
  loadMyGames,
  type CoachGameRow,
  type MyGamesState,
} from '../game/forkChallenge';

const localError = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const fileLoading = ref(false);
const myGames = reactive<MyGamesState>(createMyGamesState());
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
  stopFileBusy();
  sharedReplayFileImporter.invalidate();
});

// Owner ruling 08-18: Game ID typing is gone — coaches can't find a game id on Super FUMBBL
// unassisted. Replaced with a clickable list of the coach's fork games (config-web my-games,
// same source CreateGameModal.vue's "games in progress" panel uses), requesting `scope: 'finished'`
// so this list is the coach's finished-game history rather than the active/rejoin set. The
// `finished` field on a row is how a not-yet-upgraded server is detected: an old server ignores
// `scope` and returns the active set (rows without `finished` at all), so the honest "history
// isn't available yet" note is shown only in that case — once the config-web deploy carrying the
// scope contract lands, real finished rows arrive and the note drops on its own.
function forkCredentials(): { coach: string; password: string } {
  return { coach: settings.coach40k.trim(), password: coachPassword() };
}
function refreshMyGames(force = false): void {
  void loadMyGames(myGames, forkCredentials(), force, undefined, 'finished');
}
function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
function gameTime(game: CoachGameRow): string {
  return formatTimestamp(game.finished || game.scheduled || game.started);
}
// Old server (pre-scope-contract): rows come back without a `finished` key at all. Once the
// server is upgraded every row carries `finished` (string or null), so this flips off on its own.
const historyUnavailable = computed(() => {
  const first = myGames.games[0];
  return first !== undefined && !('finished' in first);
});
function loadGameReplay(game: CoachGameRow): void {
  sharedReplayFileImporter.invalidate();
  // Same store call the old Game ID button used (gameStore.connectReplay), just fed by a click
  // against the fork (the games list's source) instead of a typed id against whatever target was
  // active — ported from CreateGameModal.vue:33-44's rejoin wire.
  applyServerTarget('fork');
  const target = activeServerTarget();
  localError.value = '';
  void gameStore.connectReplay({
    url: target.url,
    compression: target.compression,
    coach: resolveJoinCreds().coach,
    gameId: game.gameId,
  });
}
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

onMounted(() => { refreshMyGames(); });
</script>

<template>
  <section class="replay-launcher">
    <div class="replay-console">
      <header class="replay-heading">
        <div>
          <span class="replay-kicker">Match archive</span>
          <h1>Open a match replay</h1>
          <p>Choose a Super FUMBBL match or open a replay file from this device.</p>
        </div>
        <span class="read-only-chip">Read only</span>
      </header>

      <!-- Presentational port of CreateGameModal.vue:62-84. -->
      <div class="replay-grid">
        <section class="replay-panel gb-mygames" aria-labelledby="my-games-title">
          <div class="panel-head gb-mygames-head">
            <div class="panel-title">
              <span class="panel-index" aria-hidden="true">01</span>
              <div>
                <span class="panel-label">Super FUMBBL</span>
                <h2 id="my-games-title">Your Super FUMBBL games</h2>
              </div>
            </div>
            <button class="file-button refresh" type="button" :disabled="myGames.loading" @click="refreshMyGames(true)">
              <span aria-hidden="true">↻</span> {{ myGames.loading ? 'Loading…' : 'Refresh' }}
            </button>
          </div>
          <div class="games-well" aria-live="polite">
            <p v-if="!settings.coach40k.trim()" class="note">Set your coach name in Settings to see your Super FUMBBL games.</p>
            <p v-else-if="myGames.loading" class="note state-line"><span class="status-light loading" aria-hidden="true"></span>Loading your games…</p>
            <p v-else-if="myGames.error" class="error">Couldn't load your games — {{ myGames.error }}</p>
            <p v-else-if="!myGames.games.length" class="note">No games found on the fork for this coach.</p>
            <ul v-else class="gb-mygames-list">
              <li v-for="game in myGames.games" :key="game.gameId" class="gb-mygames-row">
                <button class="gb-mygames-open" type="button" :disabled="gameStore.replay.loading" @click="loadGameReplay(game)">
                  <span class="gb-mygames-vs">
                    <strong>{{ game.myTeamName }}</strong>
                    <span class="opponent-line">vs {{ game.opponentTeamName }} <em>({{ game.opponentCoach }})</em></span>
                    <time v-if="game.finished || game.scheduled || game.started">{{ gameTime(game) }}</time>
                  </span>
                  <span class="gb-mygames-status" :data-inprogress="game.inProgress" :data-finished="!!game.finished">
                    {{ game.finished ? 'finished' : (game.inProgress ? (game.half ? `H${game.half} T${game.turn}` : 'in progress') : 'scheduled') }}
                  </span>
                  <span class="open-glyph" aria-hidden="true">▶</span>
                </button>
              </li>
            </ul>
          </div>
          <p v-if="historyUnavailable" class="note history-note">Only games still open on the server are listed — finished-game history isn't available from Super FUMBBL yet.</p>
        </section>

        <section class="replay-panel file-panel" aria-labelledby="file-replay-title">
          <div class="panel-head">
            <div class="panel-title">
              <span class="panel-index" aria-hidden="true">02</span>
              <div>
                <span class="panel-label">Local archive</span>
                <h2 id="file-replay-title">Open a replay file</h2>
              </div>
            </div>
          </div>
          <div class="file-well">
            <span class="logo-plate fumbbl-plate"><img :src="fumbblLogoUrl" alt="FUMBBL" /></span>
            <p class="file-copy">Open a FUMBBL replay, JSON replay bundle, or replay JNLP.</p>
            <button class="file-button fumbbl-open" type="button" :disabled="fileLoading || gameStore.replay.loading"
              :aria-busy="fileLoading" @click="openFilePicker">
              <span aria-hidden="true">▣</span>
              <span>{{ fileLoading ? 'Reading…' : 'Open FUMBBL Replay' }}</span>
            </button>
          </div>
        </section>
      </div>
      <input ref="fileInput" type="file" hidden tabindex="-1" aria-hidden="true"
        accept="application/json,application/x-java-jnlp-file,text/xml,.json,.ffbreplay,.jnlp" @change="loadFile" />
      <p v-if="gameStore.replay.error || localError" class="error" role="alert" aria-live="assertive">{{ gameStore.replay.error || localError }}</p>
      <p class="read-only-note"><span aria-hidden="true">◆</span> Replay mode is read-only. No gameplay command can leave the client.</p>
    </div>
  </section>
</template>

<style scoped>
.replay-launcher {
  box-sizing: border-box;
  min-height: calc(100vh - 95px);
  display: flex;
  flex: 1;
  justify-content: center;
  width: 100%;
  padding: clamp(18px, 2vw, 34px);
  color: var(--ui-text);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--ui-surface-2) 42%, transparent), transparent 180px),
    var(--ui-surface);
}
.replay-console {
  box-sizing: border-box;
  width: min(1180px, 100%);
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
.replay-kicker,
.panel-label {
  display: block;
  color: var(--ui-heading);
  font-size: max(var(--ui-min-text-size, 12px), 10px);
  font-weight: 700;
  letter-spacing: .18em;
  text-transform: uppercase;
}
h1, h2, p { margin: 0; }
h1 { margin-top: 3px; color: var(--ui-text); font-size: max(var(--ui-min-primary-text-size, 16px), clamp(24px, 2.3vw, 36px)); letter-spacing: .035em; }
.replay-heading p { margin-top: 5px; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 12px); line-height: 1.45; }
.read-only-chip {
  flex: 0 0 auto;
  padding: 6px 10px 5px;
  color: var(--ui-text-on-primary);
  border: 2px outset color-mix(in srgb, var(--ui-text) 28%, var(--ui-primary));
  border-radius: 4px;
  background: var(--ui-primary);
  box-shadow: 0 2px 6px color-mix(in srgb, var(--ui-secondary) 70%, transparent);
  font-size: max(var(--ui-min-text-size, 12px), 10px);
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
}
.replay-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, .8fr); gap: clamp(14px, 1.4vw, 22px); align-items: stretch; }
.replay-panel {
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 3px solid color-mix(in srgb, var(--ui-border) 72%, var(--ui-surface));
  border-radius: 8px;
  background: linear-gradient(160deg, var(--ui-surface-2), var(--ui-surface));
  box-shadow:
    inset 1px 1px 0 color-mix(in srgb, var(--ui-text) 22%, transparent),
    inset -2px -2px 0 color-mix(in srgb, var(--ui-secondary) 72%, transparent),
    0 8px 24px color-mix(in srgb, var(--ui-secondary) 72%, transparent);
  overflow: hidden;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-surface-2) 88%, var(--ui-primary));
}
.panel-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.panel-index {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  color: var(--ui-gold-bright);
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  background: var(--ui-surface);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-text) 8%, transparent);
  font-size: max(var(--ui-min-text-size, 12px), 11px);
  font-variant-numeric: tabular-nums;
}
.panel-title h2 { margin-top: 2px; color: var(--ui-text); font-size: max(var(--ui-min-primary-text-size, 16px), 14px); font-weight: 600; letter-spacing: .04em; }
button { font: inherit; }
.file-button {
  color: var(--ui-text);
  border: 2px outset color-mix(in srgb, var(--ui-text) 24%, var(--ui-surface-2));
  border-radius: 5px;
  background: linear-gradient(180deg, var(--ui-surface-2), var(--ui-surface));
  box-shadow: 0 2px 5px color-mix(in srgb, var(--ui-secondary) 68%, transparent);
  cursor: pointer;
}
.file-button:hover:not(:disabled) { border-color: var(--ui-accent); filter: brightness(1.14); }
.file-button:active:not(:disabled) { border-style: inset; transform: translateY(1px); }
.file-button:disabled { opacity: .45; cursor: wait; }
.file-button:focus-visible,
.gb-mygames-open:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--ui-focus-halo);
}
.error { color: var(--ui-danger); font-size: max(var(--ui-min-text-size, 12px), 12px); line-height: 1.45; }
.note { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 11px); line-height: 1.45; }
.refresh { flex: 0 0 auto; padding: 6px 10px; font-size: max(var(--ui-min-text-size, 12px), 10px); letter-spacing: .04em; }
.games-well {
  flex: 1;
  min-height: 250px;
  margin: 12px;
  padding: 7px;
  border: 2px inset color-mix(in srgb, var(--ui-border) 70%, var(--ui-surface));
  border-radius: 5px;
  background: color-mix(in srgb, var(--ui-surface) 88%, var(--ui-secondary));
}
.games-well > .note,
.games-well > .error { padding: 18px 12px; text-align: center; }
.state-line { display: flex; align-items: center; justify-content: center; gap: 7px; }
.status-light { width: 7px; height: 7px; border-radius: 50%; background: var(--ui-success); box-shadow: 0 0 7px var(--ui-success); }
.status-light.loading { animation: replay-pulse 1.2s ease-in-out infinite; }
.gb-mygames-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; max-height: min(48vh, 430px); overflow-y: auto; }
.gb-mygames-row { display: grid; }
.gb-mygames-open {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 18px;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  color: var(--ui-text);
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  background: var(--ui-surface-2);
  cursor: pointer;
}
.gb-mygames-row:nth-child(even) .gb-mygames-open { background: color-mix(in srgb, var(--ui-surface-2) 76%, var(--ui-surface)); }
.gb-mygames-open:hover:not(:disabled) { border-color: var(--ui-accent); background: var(--ui-hover); }
.gb-mygames-open:disabled { opacity: .45; cursor: default; }
.gb-mygames-vs { min-width: 0; text-align: left; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 12px); }
.gb-mygames-vs strong { display: block; overflow: hidden; color: var(--ui-text); font-size: max(var(--ui-min-primary-text-size, 16px), 13px); text-overflow: ellipsis; white-space: nowrap; }
.opponent-line { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gb-mygames-vs em { color: var(--ui-text-dim); }
.gb-mygames-vs time { display: block; margin-top: 4px; color: var(--ui-text-dim); font-size: max(var(--ui-min-text-size, 12px), 9px); }
.gb-mygames-status { color: var(--ui-gold); font-size: max(var(--ui-min-text-size, 12px), 9px); letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }
.gb-mygames-status[data-inprogress="true"] { color: var(--ui-success); }
.gb-mygames-status[data-finished="true"] { color: var(--ui-muted); }
.open-glyph { color: var(--ui-accent); font-size: max(var(--ui-min-text-size, 12px), 11px); }
.history-note { padding: 0 14px 13px; }
.file-well { display: flex; flex: 1; flex-direction: column; align-items: stretch; justify-content: center; gap: 15px; padding: clamp(22px, 3vw, 42px); text-align: center; }
.file-copy { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 11px); line-height: 1.5; }
.fumbbl-open { display: flex; align-items: center; justify-content: center; gap: 9px; padding: 10px 14px; color: var(--ui-text-on-primary); border-color: var(--ui-primary); background: var(--ui-primary); font-size: max(var(--ui-min-text-size, 12px), 12px); font-weight: 700; letter-spacing: .045em; }
.fumbbl-open:hover:not(:disabled) { border-color: var(--ui-accent); background: var(--ui-active); }
.logo-plate { display: grid; place-items: center; min-width: 0; padding: 13px; border: 2px outset color-mix(in srgb, var(--ui-forest) 45%, var(--ui-old-lace)); border-radius: 6px; }
.logo-plate img { display: block; max-width: 100%; max-height: 54px; object-fit: contain; }
.fumbbl-plate { background: var(--ui-eggshell); }
.read-only-note { align-self: center; display: flex; align-items: center; gap: 7px; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 10px); letter-spacing: .04em; text-align: center; }
.read-only-note span { color: var(--ui-success); }
@keyframes replay-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
@media (max-width: 820px) {
  .replay-grid { grid-template-columns: 1fr; }
  .games-well { min-height: 180px; }
  .gb-mygames-list { max-height: 300px; }
}
@media (max-width: 520px) {
  .replay-launcher { padding: 12px; }
  .replay-heading { align-items: flex-start; }
  .replay-heading p { display: none; }
  .read-only-chip { margin-top: 5px; }
  .panel-head { align-items: flex-start; }
  .gb-mygames-open { grid-template-columns: minmax(0, 1fr) auto; }
  .open-glyph { display: none; }
}
</style>
