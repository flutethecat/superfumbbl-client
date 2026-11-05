<script setup lang="ts">
// Owner 09-17: the game BOARD loads while a join is still waiting for the other coach. Until now the wait sat on
// the console shell (SpectateView, which owns the "Waiting for…" modal, only mounts once a game state exists —
// and the server sends none until both coaches are in). This standalone view mounts the pitch renderer over an
// EMPTY game as a backdrop and shows the same waiting modal on a lighter scrim. It owns no game logic: the store's
// waitingForMatch drives it, and the App swaps to SpectateView the moment the real game state arrives.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { PitchRenderer } from '@fumbbl40k/ffb-pitch';
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { initPitchRendererMount } from '../game/pitchRendererMount';
import { FUMBBL_SITE, settings } from '../game/settings';
import { gameStore } from '../game/store';
import { fumbblLobbyGames } from '../game/jnlpRouting';
import WaitingVsBanner from '../components/WaitingVsBanner.vue';
import WaitingMatchCardBody from '../components/WaitingMatchCardBody.vue';
import HeadToHeadLine from '../components/HeadToHeadLine.vue';
import { PAD_FOCUS_PRIORITY, vPadFocus } from '../game/cardFocus';
import {
  clearFumbblTeamCache, coachStatsLine, projectWaitingBanner, withCoachStats, type CoachStatsLine, resolveBannerTeams, waitingBanner, type FumbblTeamInfo,
} from '../game/waitingVsBanner';
import { fetchFumbblCoachProfile, type CoachProfileFetch } from '../game/fumbblCoachProfile';
import { deriveRejoinModal, rejoinFlow, storeRejoinSnapshot } from '../game/rejoinFlow';

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
    void mounted.setBackdrop(settings.backdrop, settings.backdropColor); // owner 10-12: before init, so init loads the chosen one
    if (!await initPitchRendererMount(mounted, host.value, () => active && renderer === mounted)) return;
    mounted.setPitchOrientation(settings.pitchOrientation);
    mounted.setUserPitchFlip(settings.pitchFlipped); // owner 10-12: the backdrop matches the coach's flipped view
    mounted.setTurf(settings.turf);
    mounted.stadiumEnabled = settings.showStadium;
    paint();
  } catch (error) {
    console.warn('[waiting-board] renderer failed to start', error);
  }
});
watch(() => gameStore.state.waitingForMatch, paint, { deep: true });
watch(() => [settings.backdrop, settings.backdropColor] as const, ([kind, color]) => { void renderer?.setBackdrop(kind, color); }); // owner 10-12

// ---- Owner 10-06: TEAM VS TEAM banner on every waiting board; FUMBBL lookups (team API, lobby list) only for an
// official FUMBBL join — a fork/standalone server has no FUMBBL API, so its banner shows the join's names only ----
const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
const fetchedMine = ref<FumbblTeamInfo | null>(null);
const fetchedOpponent = ref<FumbblTeamInfo | null>(null);
let bannerLoad = 0;
let unmounted = false;
const banner = computed(() => {
  const wait = gameStore.state.waitingForMatch;
  if (!wait) return null;
  const model = projectWaitingBanner(wait, fumbblLobbyGames.value, { mine: fetchedMine.value, opponent: fetchedOpponent.value });
  return withCoachStats(model, wait.official, coachStats.value);
});
// Owner 10-23: each coach's FUMBBL CR + Overall record under the name - the rank bar's own loader and session cache
// (fetchFumbblCoachProfile, one lookup per coach name), official joins only, no polling, silent on failure.
const coachStats = ref(new Map<string, CoachStatsLine | null>());
const requestedCoaches = new Set<string>();
function loadCoachStats(): void {
  const wait = gameStore.state.waitingForMatch;
  if (!wait?.official) return;
  const fetcher = (inTauri ? (tauriFetch as typeof fetch) : fetch) as CoachProfileFetch;
  const names = [wait.coach, wait.opponentCoach, banner.value?.opponent.coach].map((n) => n?.trim()).filter((n): n is string => !!n);
  for (const name of new Set(names)) {
    const key = name.toLowerCase();
    if (requestedCoaches.has(key)) continue;
    requestedCoaches.add(key);
    void fetchFumbblCoachProfile(name, fetcher).then((profile) => {
      const stats = coachStatsLine(profile) ?? null;
      if (!stats && import.meta.env.DEV) console.debug('[waiting-board] no FUMBBL coach stats for', name);
      if (unmounted) return;
      const next = new Map(coachStats.value); next.set(key, stats); coachStats.value = next;
    }).catch(() => { /* silent */ });
  }
}
watch([() => gameStore.state.waitingForMatch, () => banner.value?.opponent.coach], loadCoachStats, { deep: true, immediate: true });
// Owner 10-09: "I don't know what the box in red is but it shouldn't be visible here" - while the app-level
// join-progress window is up ("Waiting for Opponent" with its steps and Stop waiting), this board's own waiting card
// sat half-hidden behind it. One box at a time: the join window when it is open (it shows the banner too), else ours.
const joinWindowOpen = computed(() => deriveRejoinModal(rejoinFlow.launch, storeRejoinSnapshot()).kind !== 'closed');
watch(banner, (model) => { waitingBanner.value = model; }, { immediate: true });
/** Fills race/TV as the team records arrive. Runs on a waiting-state change or a lobby-list refresh - never on a timer;
 *  each team id is fetched once per wait (loadFumbblTeam caches). Never touches the waiting card. */
async function loadBannerData(): Promise<void> {
  const load = ++bannerLoad;
  const wait = gameStore.state.waitingForMatch;
  if (!wait?.official) { fetchedMine.value = null; fetchedOpponent.value = null; return; }
  const fetcher = (inTauri ? (tauriFetch as typeof fetch) : fetch) as (input: string) => Promise<Response>;
  const result = await resolveBannerTeams({ ...wait }, fumbblLobbyGames.value, FUMBBL_SITE, fetcher,
    () => !unmounted && load === bannerLoad && gameStore.state.waitingForMatch === wait);
  if (!result) return;
  fetchedMine.value = result.mine;
  fetchedOpponent.value = result.opponent;
}
watch([() => gameStore.state.waitingForMatch, fumbblLobbyGames], () => { void loadBannerData(); }, { deep: true, immediate: true });
// the wait ended: a later match must fetch its teams afresh (the view also unmounts - see onBeforeUnmount)
watch(() => gameStore.state.waitingForMatch, (wait) => { if (!wait) clearFumbblTeamCache(); });
onBeforeUnmount(() => {
  active = false;
  unmounted = true;
  bannerLoad += 1; // an in-flight banner lookup must not start its follow-up request after Cancel
  waitingBanner.value = null;
  clearFumbblTeamCache();
  const r = renderer;
  renderer = null;
  try { r?.destroy(); } catch { /* already torn down */ }
});
</script>

<template>
  <div class="waiting-board">
    <div ref="host" class="waiting-board-pitch" aria-hidden="true"></div>
    <div v-if="gameStore.state.waitingForMatch && !joinWindowOpen" class="waiting-board-overlay" role="alertdialog" aria-modal="true">
      <!-- Owner 10-09: the match-up sits directly above the waiting box, on top of the scrim (never shaded by it). -->
      <WaitingVsBanner v-if="banner" :model="banner" inline />
      <!-- Owner 11-04: the local coach's record against this opponent (a waiting board is always a coach seat). -->
      <HeadToHeadLine v-if="banner" seated :me="banner.mine.coach" :opponent="banner.opponent.coach" :game-id="gameStore.state.waitingForMatch?.gameId" />
      <div v-pad-focus="{ priority: PAD_FOCUS_PRIORITY.card }" class="waiting-board-card">
        <!-- Owner 10-21: the room name is hidden until "Show room name" (bottom-right of the card) is pressed. -->
        <WaitingMatchCardBody :wait="gameStore.state.waitingForMatch" @cancel="gameStore.disconnect()" />
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
  position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; gap: 16px; align-items: center; justify-content: center;
  padding: 4vh 4vw; background: radial-gradient(ellipse at center, #0b122099 0%, #05070cc4 80%);
}
.waiting-board-card {
  max-width: 380px; background: var(--ui-surface-2); border: 1px solid #6a2b2b; border-radius: 12px;
  padding: 22px 26px; box-shadow: 0 16px 44px #000c; color: var(--ui-text); text-align: center;
}
/* The card's body (title, status line, Cancel + the room-name toggle) is WaitingMatchCardBody - shared with SpectateView. */
</style>
