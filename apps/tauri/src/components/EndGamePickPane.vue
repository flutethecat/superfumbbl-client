<script setup lang="ts">
/**
 * Owner 10-09 ("The assign touchdown panel should share the same language as MVP pane"): the ONE end-game pick pane.
 * The MVP nomination and the Assign Touchdown step both mount this shell, so they cannot drift: the same frame, the
 * same title line, the same ONE roster panel (PostGameRoster - the H-roster pane's content - pinned to one team, no
 * switch, the check mark beside the LVL badge), the same footer (count "N/max" + one confirm button), the same waiting
 * line and the same idle button once the answer is in. They differ only in what the view hands over: the title, the
 * button label, the maximum, the team and the eligible players (Assign Touchdown lists only the offered ones). The
 * view's own banner (final score + MVP chips / touchdowns awarded) rides in the `banner` slot.
 * Presentation only: a pick and the confirm are emitted; the view answers through the store exactly as before.
 */
import type { SkillIconStyle } from '@fumbbl40k/ffb-pitch';
import PostGameRoster from './PostGameRoster.vue';
import type { PostGameSide, RosterPick, RosterRowExtra, Side } from '../game/postGameProjection';

withDefaults(defineProps<{
  /** Which pane this is, for tests and the tour ("mvp" / "assign-touchdown"). */
  kind: string;
  /** The armed pick (server eligible ids + store picked ids); null = nothing to answer right now. */
  pick: RosterPick | null;
  /** Bumped per server round: the round block re-mounts and replays its pop-in. */
  roundKey: number;
  title: string;
  /** How many may be picked (the count reads "picked/max"). */
  max: number;
  confirmLabel: string;
  confirmDisabled: boolean;
  /** No pick armed: the waiting line (null = none) and the footer's one button. */
  waitingText?: string | null;
  idleLabel: string;
  idleDisabled?: boolean;
  /** The one team shown. */
  side: Side;
  /** Only these players (Assign Touchdown lists the offered ones); null = the whole team (MVP nomination). */
  onlyIds?: readonly string[] | null;
  teams: { home: PostGameSide; away: PostGameSide } | null;
  portrait: (playerId: string) => string | null;
  localSide?: Side | null;
  skillMode?: 'icons' | 'markings';
  iconStyle?: SkillIconStyle;
  extras?: Readonly<Record<string, RosterRowExtra>> | null;
}>(), { onlyIds: null, waitingText: null, idleDisabled: true, localSide: null, skillMode: 'markings', iconStyle: 'bb3', extras: null });
const emit = defineEmits<{ (e: 'pick', playerId: string): void; (e: 'confirm'): void; (e: 'idle'): void }>();
</script>

<template>
  <div class="mvp-nominate-overlay" :data-kind="kind">
    <div class="mvp-nominate-card">
      <slot name="banner" />
      <!-- Owner 09-27: the waiting line sits in the card's flow, under the banner and above the rosters. -->
      <div v-if="!pick && waitingText" class="mvp-waiting" role="status" aria-live="polite"><span class="mvp-waiting-dots"><i>.</i><i>.</i><i>.</i></span> {{ waitingText }}</div>
      <!-- #63 re-present mirror: :key bumps per round -> this block re-mounts + replays the pop-in so a 2nd (or Nth)
           round visibly re-pops (fresh boxes ride the store's re-arm). -->
      <div v-if="pick" :key="'round-' + roundKey" class="mvp-nominate-round">
        <div class="mvp-nominate-head">
          <span class="mvp-nominate-title">{{ title }}</span>
        </div>
        <!-- The one fixed roster panel: rows the server offered are the click targets, the mark only shows the state. -->
        <PostGameRoster v-if="teams" class="mvp-nominate-roster" :data-side="side"
          :side="side" :switcher="false" fill :teams="teams" :portrait="portrait" :local-side="localSide"
          :skill-mode="skillMode" :icon-style="iconStyle" :only-ids="onlyIds" :extras="extras" :pick="pick"
          @pick="(playerId: string) => emit('pick', playerId)" />
        <div class="mvp-nominate-foot">
          <!-- Owner 09-25: the picked/needed counter sits beside the confirm button at twice its old size. -->
          <span class="mvp-nominate-count" aria-live="polite" :data-complete="pick.selectedIds.length >= max">{{ pick.selectedIds.length }}/{{ max }}</span>
          <button class="mvp-nominate-confirm" :disabled="confirmDisabled" @click="emit('confirm')">{{ confirmLabel }}</button>
        </div>
      </div>
      <div v-else class="mvp-nominate-foot">
        <button class="mvp-nominate-confirm" :disabled="idleDisabled" @click="emit('idle')">{{ idleLabel }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Moved from SpectateView.vue (owner 10-09) - edit the end-game pick pane here. */
/* Owner 2026-07-15: MVP NOMINATION roster-summary modal (mirrors .postgame / .pg-roster; theme-token driven). */
.mvp-nominate-overlay {
  position: absolute; z-index: 55; inset: 0;
  display: flex; align-items: center; justify-content: center; padding: 24px;
  background: radial-gradient(ellipse at center, #000c 0%, #0009 60%, #0006 100%);
  animation: mvp-overlay-in var(--p-350) ease-out;
}
@keyframes mvp-overlay-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.mvp-nominate-card {
  /* #45 (owner tester): the MVP / end-of-game screen fills ~the viewport (was a 460px modal). */
  width: min(920px, 96vw); height: min(94vh, 940px);
  display: flex; flex-direction: column; overflow: hidden;
  background: linear-gradient(180deg, var(--ui-surface-2) 0%, var(--ui-surface) 100%);
  border: 1px solid var(--ui-border); border-radius: 12px;
  box-shadow: 0 12px 40px #000c; color: var(--ui-text);
}
/* #63 re-present mirror: per-round pop-in so a re-emitted round visibly re-pops (fresh-window motion). */
/* Owner 08-17 (Riotous Rookies overflow): a roster can exceed 16 (mid-game adds) and the card is a fixed-height flex
   column with overflow:hidden - flex:1/min-height:0 lets the round claim only the space left under the banner, so the
   roster LIST is what scrolls and the confirm button in the foot stays pinned and reachable. */
.mvp-nominate-round {
  animation: mvp-round-pop 0.34s cubic-bezier(0.2, 0.9, 0.3, 1.3);
  display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0;
}
@keyframes mvp-round-pop {
  0% { opacity: 0; transform: scale(0.94) translateY(6px); }
  60% { opacity: 1; }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}
@media (prefers-reduced-motion: reduce) { .mvp-nominate-round, .mvp-nominate-overlay { animation: none; } }
.mvp-nominate-head {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px; border-bottom: 1px solid var(--ui-border);
}
.mvp-nominate-title { font-weight: 700; color: var(--ui-heading); }
.mvp-nominate-count { font-family: 'Nuffle', sans-serif; font-weight: 900; font-size: max(var(--ui-min-primary-text-size, 16px), 2rem); line-height: 1; color: var(--ui-accent); font-variant-numeric: tabular-nums; letter-spacing: 0.04em; text-shadow: 2px 2px 0 #000; } /* owner 09-25: 2x, in the footer beside the button */
.mvp-nominate-count[data-complete='true'] { color: var(--ui-success); }
/* The panel is the roster component in `fill`: ITS list scrolls, the foot stays pinned. */
.mvp-nominate-roster { font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); min-width: 0; }
.mvp-nominate-foot { padding: 12px 18px; border-top: 1px solid var(--ui-border); display: flex; align-items: center; justify-content: flex-end; gap: 18px; flex: 0 0 auto; }
.mvp-nominate-confirm {
  padding: 8px 18px; border: none; border-radius: 8px; font-weight: 700; cursor: pointer;
  background: var(--ui-accent); color: var(--ui-text-on-accent);
}
.mvp-nominate-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
.mvp-nominate-confirm:focus-visible { outline: 2px solid var(--ui-text); outline-offset: 2px; }
.mvp-waiting { flex: 0 0 auto; align-self: center; margin: 0 16px 10px; background: var(--ui-surface-2); border: 1px solid var(--ui-border); border-radius: 8px; padding: 8px 16px; font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem); color: var(--ui-text-dim); text-align: center; } /* owner 09-27: in flow, between the banner and the rosters */
.mvp-waiting-dots i { animation: mvp-wait-dot 1.2s infinite; opacity: 0; }
.mvp-waiting-dots i:nth-child(2) { animation-delay: 0.2s; }
.mvp-waiting-dots i:nth-child(3) { animation-delay: 0.4s; }
@keyframes mvp-wait-dot { 0%, 60%, 100% { opacity: 0; } 30% { opacity: 1; } }
</style>
