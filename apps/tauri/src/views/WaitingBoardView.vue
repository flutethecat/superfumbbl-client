<script setup lang="ts">
// Owner 09-17: the game BOARD loads while a join is still waiting for the other coach. Until now the wait sat on
// the console shell (SpectateView, which owns the "Waiting for…" modal, only mounts once a game state exists —
// and the server sends none until both coaches are in). This standalone view mounts the pitch renderer over an
// EMPTY game as a backdrop and shows the same waiting modal on a lighter scrim. It owns no game logic: the store's
// waitingForMatch drives it, and the App swaps to SpectateView the moment the real game state arrives.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { PitchRenderer } from '@fumbbl40k/ffb-pitch';
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { initPitchRendererMount } from '../game/pitchRendererMount';
import { settings } from '../game/settings';
import { gameStore } from '../game/store';

const host = ref<HTMLElement | null>(null);
let renderer: PitchRenderer | null = null;
let active = false;

/** A bare board: both rosters empty, no ball, turn 0 — enough for the pitch, stadium, dugouts and end zones. */
function emptyGame(): GameJson {
  const wait = gameStore.state.waitingForMatch;
  const team = (teamId: string, teamName: string, coach: string) => ({
    teamId, teamName, coach, race: '', playerArray: [], roster: { positionArray: [] },
  });
  const turnData = { turnNr: 0, reRolls: 0, apothecaries: 0, blitzUsed: false, foulUsed: false, handOverUsed: false, passUsed: false };
  const teamResult = { score: 0, playerResults: [] };
  return {
    gameId: 0, half: 1, turnMode: 'startGame', homePlaying: true, finished: null, actingPlayer: null,
    teamHome: team('waiting-home', wait?.teamName?.trim() || 'Your team', wait?.coach ?? ''),
    teamAway: team('waiting-away', wait?.opponentCoach ? `${wait.opponentCoach}'s team` : 'Opponent', wait?.opponentCoach ?? ''),
    turnDataHome: { ...turnData }, turnDataAway: { ...turnData },
    gameResult: { teamResultHome: { ...teamResult }, teamResultAway: { ...teamResult } },
    fieldModel: { playerDataArray: [], bloodspotArray: [], ballInPlay: false, ballMoving: false, ballCoordinate: null, weather: 'nice' },
    dialogParameter: null,
  } as unknown as GameJson;
}

function paint(): void {
  if (!renderer) return;
  // A backdrop only — a field the renderer does not expect must never take the waiting modal down with it.
  try { renderer.setGame(emptyGame()); } catch (error) { console.warn('[waiting-board] empty board failed to draw', error); }
}

onMounted(async () => {
  if (!host.value) return;
  active = true;
  const mounted = new PitchRenderer();
  renderer = mounted;
  try {
    if (!await initPitchRendererMount(mounted, host.value, () => active && renderer === mounted)) return;
    mounted.setPitchOrientation(settings.pitchOrientation);
    mounted.setTurf(settings.turf);
    mounted.stadiumEnabled = settings.showStadium;
    paint();
  } catch (error) {
    console.warn('[waiting-board] renderer failed to start', error);
  }
});
watch(() => gameStore.state.waitingForMatch, paint, { deep: true });
onBeforeUnmount(() => {
  active = false;
  const r = renderer;
  renderer = null;
  try { r?.destroy(); } catch { /* already torn down */ }
});
</script>

<template>
  <div class="waiting-board">
    <div ref="host" class="waiting-board-pitch" aria-hidden="true"></div>
    <div v-if="gameStore.state.waitingForMatch" class="waiting-board-overlay" role="alertdialog" aria-modal="true">
      <div class="waiting-board-card">
        <h2 v-if="gameStore.state.waitingForMatch.opponentCoach">Waiting for {{ gameStore.state.waitingForMatch.opponentCoach }}</h2>
        <h2 v-else>Waiting for the other coach</h2>
        <p class="waiting-board-status">
          <span class="waiting-board-spinner" aria-hidden="true"></span>
          <span v-if="gameStore.state.waitingForMatch.opponentCoach">Waiting for <strong>{{ gameStore.state.waitingForMatch.opponentCoach }}</strong> to join<span v-if="gameStore.state.waitingForMatch.gameName"> “{{ gameStore.state.waitingForMatch.gameName }}”</span>… Are they afraid? 👀</span>
          <span v-else-if="gameStore.state.waitingForMatch.gameName">You're in “{{ gameStore.state.waitingForMatch.gameName }}” — the game starts as soon as the other coach joins the <em>same</em> game name.</span>
          <span v-else>Waiting for the game to start — you'll drop in when your match is ready.</span>
        </p>
        <p v-if="gameStore.state.waitingForMatch.teamName" class="hint">Playing as {{ gameStore.state.waitingForMatch.coach }} with {{ gameStore.state.waitingForMatch.teamName }}.</p>
        <div class="waiting-board-actions">
          <button type="button" @click="gameStore.disconnect()">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.waiting-board { position: fixed; inset: 0; z-index: 40; background: #05070c; }
.waiting-board-pitch { position: absolute; inset: 0; }
.waiting-board-pitch :deep(canvas) { display: block; width: 100%; height: 100%; }
/* Lighter than the in-game connection scrim: the board stays readable behind the card. */
.waiting-board-overlay {
  position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center;
  padding: 4vh 4vw; background: radial-gradient(ellipse at center, #0b122099 0%, #05070cc4 80%);
}
.waiting-board-card {
  max-width: 380px; background: var(--ui-surface-2); border: 1px solid #6a2b2b; border-radius: 12px;
  padding: 22px 26px; box-shadow: 0 16px 44px #000c; color: var(--ui-text); text-align: center;
}
.waiting-board-card h2 { margin: 0 0 0.6rem; font-family: 'Nuffle', system-ui, sans-serif; color: #e8918c; font-size: max(var(--ui-min-primary-text-size, 16px), 1.3rem); }
.waiting-board-card p { margin: 0.5rem 0 0; font-size: max(var(--ui-min-primary-text-size, 16px), 0.92rem); line-height: 1.5; }
.waiting-board-status { display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
.waiting-board-actions { display: flex; gap: 10px; justify-content: center; margin-top: 1.1rem; }
.waiting-board-actions button { border-radius: 6px; padding: 0.5rem 1.2rem; cursor: pointer; font-weight: 600; background: var(--ui-surface); color: var(--ui-text); border: 1px solid var(--ui-border); }
.waiting-board-spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #e8918c55; border-top-color: #e8918c; animation: waiting-board-spin 0.8s linear infinite; flex: none; }
@keyframes waiting-board-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .waiting-board-spinner { animation: none; } }
</style>
