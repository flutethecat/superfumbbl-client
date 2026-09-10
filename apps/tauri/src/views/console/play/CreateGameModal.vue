<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import superFumbblLogoUrl from '../../../assets/resources/super-fumbbl-logo.png';
import { activeServerTarget, applyServerTarget, resolveJoinCreds, settings } from '../../../game/settings';
import { startRejoin } from '../../../game/rejoinFlow';
import { coachPassword } from '../../../game/credentials';
import {
  createMyGamesState,
  loadMyGames,
  type CoachGameRow,
  type MyGamesState,
} from '../../../game/forkChallenge';
import ChallengePopup from './ChallengePopup.vue';

const emit = defineEmits<{ close: [] }>();
const challengeOpen = ref(false);
const myGames = reactive<MyGamesState>(createMyGamesState());

function forkCredentials(): { coach: string; password: string } {
  return { coach: settings.coach40k.trim(), password: coachPassword() };
}

function refreshMyGames(force = false): void {
  void loadMyGames(myGames, forkCredentials(), force);
}

function gameTime(game: CoachGameRow): string {
  const value = game.scheduled || game.started;
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function rejoinMyGame(game: CoachGameRow): void {
  applyServerTarget('fork');
  const target = activeServerTarget();
  // Existing rejoin wire (gameStore.rejoinById, from SpectateView.vue:6371-6380) now wrapped by
  // startRejoin, which tracks the attempt for the app-shell RejoinProgressModal — owner 08-18:
  // this click previously failed silently (the join overlays only mount once a game arrives).
  startRejoin({
    url: target.url,
    compression: target.compression,
    ...resolveJoinCreds(),
    gameId: game.gameId,
    opponent: game.opponentCoach,
  });
  emit('close');
}

onMounted(() => { refreshMyGames(); });
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="create-card" role="dialog" aria-modal="true" aria-labelledby="create-game-title">
      <button class="close-button" type="button" aria-label="Close Create Game" @click="emit('close')">×</button>
      <p class="eyebrow">SUPER FUMBBL</p>
      <img class="brand-logo" :src="superFumbblLogoUrl" alt="" />
      <h1 id="create-game-title">Create Game</h1>
      <p>Challenge another coach with a team from your fork library, or rejoin a server-listed game.</p>

      <button class="primary" type="button" @click="challengeOpen = true">CREATE A CHALLENGE</button>
      <span class="or">or</span>

      <!-- Presentational port of SpectateView.vue:7764-7789. -->
      <section class="gb-mygames" aria-labelledby="my-games-title">
        <div class="gb-mygames-head">
          <h2 id="my-games-title">Your games in progress</h2>
          <button class="file-button refresh" type="button" :disabled="myGames.loading" @click="refreshMyGames(true)">
            {{ myGames.loading ? 'Loading…' : 'Refresh' }}
          </button>
        </div>
        <p v-if="myGames.loading" class="note">Loading your games…</p>
        <p v-else-if="myGames.error" class="error">Couldn't load your games — {{ myGames.error }}</p>
        <p v-else-if="!myGames.games.length" class="note">No games in progress.</p>
        <ul v-else class="gb-mygames-list">
          <li v-for="game in myGames.games" :key="game.gameId" class="gb-mygames-row">
            <span class="gb-mygames-vs">
              <strong>{{ game.myTeamName }}</strong> vs {{ game.opponentTeamName }} <em>({{ game.opponentCoach }})</em>
              <time v-if="game.scheduled || game.started">{{ gameTime(game) }}</time>
            </span>
            <span class="gb-mygames-status" :data-inprogress="game.inProgress">
              {{ game.inProgress ? (game.half ? `H${game.half} T${game.turn}` : 'in progress') : 'scheduled' }}
            </span>
            <button class="primary rejoin" type="button" @click="rejoinMyGame(game)">Rejoin</button>
          </li>
        </ul>
      </section>
      <p class="note">Games and teams shown here come directly from config-web.</p>
    </section>

    <ChallengePopup v-if="challengeOpen" @close="challengeOpen = false" @matched="emit('close')" />
  </div>
</template>

<style scoped>
/* Visual source of record: ReplayLauncherView.vue:101-115. */
.modal-backdrop { position: fixed; z-index: 80; inset: 0; display: grid; place-items: center; padding: 30px; color: #eee; background: #000b; }
.create-card { position: relative; width: min(620px, 92vw); max-height: min(760px, 88vh); display: grid; gap: 13px; padding: 28px; overflow-y: auto; border: 1px solid #7c2929; border-radius: 8px; background: #121212ee; box-shadow: 0 18px 60px #000a; }
.eyebrow { margin: 0; color: #d6ad62; font-size: max(var(--ui-min-text-size, 12px), 11px); letter-spacing: .18em; }
h1, h2, p { margin: 0; }
button { padding: 10px 14px; color: #eee; text-align: center; border: 1px solid #666; background: #292929; cursor: pointer; }
.primary { color: #fff; border-color: #a62020; background: #7d0808; }
.primary:disabled { opacity: .45; cursor: default; }
.file-button { display: block; background: #292929; }
.file-button:disabled { opacity: .45; cursor: wait; }
.or { color: #777; text-align: center; font-size: max(var(--ui-min-text-size, 12px), 11px); text-transform: uppercase; }
.error { color: #ff8d8d; }
.note { color: #999; font-size: max(var(--ui-min-text-size, 12px), 11px); }
.close-button { position: absolute; top: 10px; right: 10px; padding: 4px 8px; border: 0; background: transparent; font-size: max(var(--ui-min-primary-text-size, 16px), 20px); }
.brand-logo { width: 124px; height: 52px; object-fit: contain; justify-self: center; }
.gb-mygames { display: grid; gap: 10px; padding-top: 13px; border-top: 1px solid #3c3c3c; }
.gb-mygames-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.gb-mygames-head h2 { color: #ccc; font-size: max(var(--ui-min-primary-text-size, 16px), 13px); font-weight: 500; }
.refresh { padding: 5px 9px; font-size: max(var(--ui-min-text-size, 12px), 11px); }
.gb-mygames-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.gb-mygames-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; padding: 10px; border: 1px solid #555; background: #080808; }
.gb-mygames-vs { min-width: 0; color: #ccc; font-size: max(var(--ui-min-text-size, 12px), 12px); }
.gb-mygames-vs strong { color: #fff; }
.gb-mygames-vs em { color: #999; }
.gb-mygames-vs time { display: block; margin-top: 3px; color: #777; font-size: max(var(--ui-min-text-size, 12px), 10px); }
.gb-mygames-status { color: #d6ad62; font-size: max(var(--ui-min-text-size, 12px), 10px); text-transform: uppercase; }
.gb-mygames-status[data-inprogress="true"] { color: #9bcf83; }
.rejoin { padding: 7px 10px; }
@media (max-width: 620px) {
  .modal-backdrop { padding: 12px; }
  .create-card { padding: 22px 18px; }
  .gb-mygames-row { grid-template-columns: 1fr auto; }
  .gb-mygames-vs { grid-column: 1 / -1; }
}
</style>
