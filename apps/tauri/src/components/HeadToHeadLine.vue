<script setup lang="ts">
/**
 * Owner 11-04 ("Every intro. Waiting Lobby and game open."): the local coach's record against the opponent coach, on
 * the waiting lobby (WaitingBoardView + the join window, RejoinProgressModal) and the game-open rank bar
 * (GameLoadRankPanel). "You vs Rick: 2/0/1 · 67%" (W/D/L, FUMBBL win %: a draw is half a win), or "First meeting".
 *
 * From the LOCAL game history only (game/coachGameHistory.ts through coachStats.headToHead): zero requests. Counts the
 * games the coach card counts - the local coach's own, and without fork features the FUMBBL server's only - and never
 * the current game. Only on a COACH seat (`seated`): a spectator or a replay sees nothing, the history is the user's
 * own. The opponent name is the one the host got from the server. Never waits on anything: the history load starts
 * here if no one started it, and until it lands (or when storage failed) the line is simply absent.
 */
import { computed, onMounted } from 'vue';
import { coachHistory, ensureCoachHistoryLoaded } from '../game/coachGameHistory';
import { headToHead, recordText } from '../game/coachStats';
import { forkFeaturesEnabled } from '../game/forkAccess';
import { t } from '../i18n';

const props = defineProps<{ seated: boolean; me?: string | null; opponent?: string | null; gameId?: string | number | null }>();

onMounted(() => { if (props.seated) void ensureCoachHistoryLoaded(); });

const record = computed(() => {
  if (!props.seated || !coachHistory.loaded || !coachHistory.persisting) return null;
  return headToHead(coachHistory.games, { me: props.me, opponent: props.opponent, allServers: forkFeaturesEnabled(), excludeGameId: props.gameId });
});
const text = computed(() => {
  const r = record.value;
  if (!r) return '';
  return r.games ? t('headToHead.record', { coach: props.opponent!.trim(), record: recordText(r), pct: r.winPct }) : t('headToHead.firstMeeting');
});
</script>

<template>
  <p v-if="text" class="h2h-line" data-testid="head-to-head" :data-first="record!.games === 0">{{ text }}</p>
</template>

<style scoped>
/* A pill in the match-up bar's own idiom (WaitingVsBanner.vue: the dark bar, the red edge), readable on the waiting
   scrim and over the pitch alike. Static text: nothing animates. */
.h2h-line {
  box-sizing: border-box; max-width: min(640px, calc(100% - 32px)); margin: 0; padding: 4px 14px; border-radius: 999px;
  color: var(--ui-text, #f0f0f0); background: rgba(12, 15, 21, 0.92); border: 1px solid #e03030aa; box-shadow: 0 4px 14px #0009;
  font-size: max(14px, 0.95rem); font-weight: 600; line-height: 1.3; text-align: center; font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere; pointer-events: none;
}
</style>
