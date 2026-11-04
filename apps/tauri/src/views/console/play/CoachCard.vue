<script setup lang="ts">
/**
 * Play screen coach card (owner 10-20): coach name (+ the title as a text chip when there is no badge) on line 1,
 * "Record W/D/L · win % · CR · WAR" on line 2. Text from FUMBBL only (game/fumbblCoachProfile.ts); a part FUMBBL did
 * not send is left out, not dashed.
 *
 * The title is drawn on an ORIGINAL rank badge (CoachBadge.vue: public/badges/coach/<slug>.png, no text baked in) with
 * the title text centred on it. Unknown title or a badge that fails to load -> the text-only chip. No FUMBBL images.
 *
 * Owner 11-03 (spec-coach-card-stats-2026-11-03.md): NO TRUNCATION and performance stats.
 * - The name and the record line wrap instead of clipping: the record line breaks only between its parts (each part
 *   is kept whole), so "Record 26/16/27 · 49 % · CR 1593 · −0.5 WAR" reads in full on one or two lines.
 * - A compact stats row under them, from the LOCAL game history (game/coachGameHistory.ts, zero requests): Form (the
 *   last 5 results + the current streak), Luck over the last 10 games with a sparkline (the Dice pane's sign and
 *   wording: lucky / even / unlucky), and the two most-played races. Empty history -> "Stats build up as you play".
 * - Only the games whose recorded coach is the coach shown here (case-insensitive), so another account never mixes in.
 * - "More stats" (or a click on the card) opens the expanded panel (CoachStatsPanel.vue); closing it returns focus here.
 *
 * Stable skeleton (Astra rounds 1-2, 10-20): the same rows exist whether the data is loading, partial, failed or
 * complete - the badge slot (always present, empty while there is no badge), the name line, the record line and the
 * stats row. The card's outline is an inset shadow, not a border, so the badge gets the full 52 px.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import DisplayCaps from '../../../components/DisplayCaps.vue';
import CoachBadge from './CoachBadge.vue';
import CoachStatsPanel from './CoachStatsPanel.vue';
import { settings } from '../../../game/settings';
import { t } from '../../../i18n';
import { coachProfileStatItems, coachProfileStatParts, coachTitleBadgeUrl, coachTitleSlug, type FumbblCoachProfile } from '../../../game/fumbblCoachProfile';
import { coachHistory, ensureCoachHistoryLoaded } from '../../../game/coachGameHistory';
import { PAD_FOCUS_PRIORITY, padFocusControllerMode, vPadFocus } from '../../../game/cardFocus';
import { coachForm, filterByCoach, filterByServer, luckSummary, raceRecords, recordText, signedLuck, sparklinePoints } from '../../../game/coachStats';
import { forkFeaturesEnabled } from '../../../game/forkAccess';

const props = defineProps<{ name: string; profile: FumbblCoachProfile | null }>();

const displayName = computed(() => props.profile?.name || props.name);
const title = computed(() => props.profile?.title);
const slug = computed(() => coachTitleSlug(title.value));
const badgeUrl = computed(() => coachTitleBadgeUrl(title.value, settings.coachBadgeStyle)); // a style switch retries the badge
const badgeFailed = ref(false);
watch(badgeUrl, () => { badgeFailed.value = false; });
const showBadge = computed(() => !!title.value && !!badgeUrl.value && !badgeFailed.value);
const stats = computed(() => coachProfileStatParts(props.profile).join(' · '));
/** The parts, the WAR one carrying its "wins above a .500 coach" description (owner 10-21). */
const statItems = computed(() => coachProfileStatItems(props.profile));
/** The full card for assistive tech (Astra P3). */
const ariaLabel = computed(() => [t('coachCard.ariaFumbblCoach'), displayName.value, title.value, stats.value].filter(Boolean).join(', '));

// ---- performance stats (local history) ----
onMounted(() => { void ensureCoachHistoryLoaded(); });
/** Only the games of the coach shown on this card (a second account on the machine never mixes in). */
// Owner 11-04: fork play is hidden in public runs, so without fork features the stats count FUMBBL games only and
// the panel shows no server filter (CoachStatsPanel). The fork edition or the --fork-server switch shows everything.
const games = computed(() => {
  const own = filterByCoach(coachHistory.games, displayName.value);
  return forkFeaturesEnabled() ? own : filterByServer(own, 'fumbbl');
});
const LUCK_GAMES = 10;
const form = computed(() => coachForm(games.value, 5));
const luck = computed(() => luckSummary(games.value, LUCK_GAMES, 'all'));
const topRaces = computed(() => raceRecords(games.value).slice(0, 2));
const RESULT_LETTER = { W: 'coachStats.result.W', D: 'coachStats.result.D', L: 'coachStats.result.L' } as const;
const RESULT_NAME = { W: 'coachStats.resultName.W', D: 'coachStats.resultName.D', L: 'coachStats.resultName.L' } as const;
const resultLetter = (r: 'W' | 'D' | 'L') => t(RESULT_LETTER[r]);
const resultName = (r: 'W' | 'D' | 'L') => t(RESULT_NAME[r]);
const luckVerdictText = computed(() => (luck.value.verdict === 'lucky' ? t('pg.luck.lucky') : luck.value.verdict === 'unlucky' ? t('pg.luck.unlucky') : t('coachStats.luck.even')));
const sparkline = computed(() => sparklinePoints(luck.value.points, 60, 16));

const panelOpen = ref(false);
const moreBtn = ref<HTMLButtonElement | null>(null);
function openPanel(): void { panelOpen.value = true; }
function closePanel(): void {
  panelOpen.value = false;
  void nextTick(() => moreBtn.value?.focus());
}
/** Controller (Sol r1 P6): "More stats" sits in a pad scope (the lowest, informational rank), so the D-pad reaches it
 *  and A opens the panel; while the panel is up its own scope owns the pad. The scope exists ONLY while the controller
 *  is the active input: any mounted scope keeps the pad overlay refreshing every frame (PadOverlay's rAF loop), and a
 *  scope that lived as long as the Play card made that loop permanent for every mouse / keyboard user (a synchronous
 *  frame stub turned it into unbounded recursion in the mounted-App tests). */
const padActive = computed(() => padFocusControllerMode());
const padScope = computed(() => ({ priority: PAD_FOCUS_PRIORITY.info, disabled: panelOpen.value }));
/** A click anywhere on the card opens the panel (the button is the keyboard / controller way in). */
function onCardClick(event: MouseEvent): void {
  if ((event.target as Element | null)?.closest?.('button, a')) return;
  openPanel();
}
</script>

<template>
  <section v-if="name" class="coach-card" :aria-label="ariaLabel" @click="onCardClick">
    <div class="coach-head">
      <span class="coach-badge-slot">
        <CoachBadge v-if="showBadge" :title="title!" :size="52" @error="badgeFailed = true" />
      </span>
      <div class="coach-lines">
        <div class="coach-line">
          <strong class="coach-name">{{ displayName }}</strong>
          <span v-if="title && !showBadge" class="coach-title-chip" :class="slug ? `tier-${slug}` : ''"><DisplayCaps :text="title" /></span>
        </div>
        <div class="coach-stats"><template v-for="(item, i) in statItems" :key="i"><span class="coach-stat"
          :title="item.title" :aria-label="item.title ? `${item.text}, ${item.title}` : undefined">{{ item.text }}</span><template
          v-if="i < statItems.length - 1"> · </template></template></div>
      </div>
    </div>
    <div class="coach-perf" data-testid="coach-perf">
      <template v-if="coachHistory.loaded && !games.length">
        <span class="perf-empty" data-testid="coach-perf-empty">{{ t('coachStats.empty') }}</span>
      </template>
      <template v-else-if="games.length">
        <span class="perf-item" data-perf="form" role="group"
          :aria-label="t('coachStats.formAria', { n: form.results.length, list: form.results.map(resultName).join(', ') })">
          <span class="perf-k">{{ t('coachStats.form') }}</span>
          <span class="perf-chips" aria-hidden="true"><span v-for="(r, i) in form.results" :key="i" class="perf-chip" :data-result="r">{{ resultLetter(r) }}</span></span>
          <b v-if="form.streak" class="perf-streak" :aria-label="t('coachStats.streakAria', { n: form.streak.count, result: resultName(form.streak.result) })">{{ t('coachStats.streak', { result: resultLetter(form.streak.result), n: form.streak.count }) }}</b>
        </span>
        <span v-if="luck.mean != null" class="perf-item" data-perf="luck" role="group"
          :aria-label="t('coachStats.luckAria', { n: luck.games, value: signedLuck(luck.mean), verdict: luckVerdictText })">
          <span class="perf-k" aria-hidden="true">{{ t('coachStats.luckLastN', { n: LUCK_GAMES }) }}</span>
          <b class="perf-luck" :data-verdict="luck.verdict" aria-hidden="true">{{ signedLuck(luck.mean) }} {{ luckVerdictText }}</b>
          <svg class="perf-spark" viewBox="0 0 60 16" width="60" height="16" role="img" :aria-label="t('coachStats.sparkline')">
            <line x1="0" y1="8" x2="60" y2="8" class="perf-spark-zero" />
            <polyline :points="sparkline" fill="none" class="perf-spark-line" />
          </svg>
        </span>
        <span v-if="topRaces.length" class="perf-item" data-perf="races">
          <span class="perf-k">{{ t('coachStats.topRaces') }}</span>
          <span v-for="r in topRaces" :key="r.race" class="perf-race">{{ t('coachStats.raceLine', { race: r.race, record: recordText(r), pct: r.winPct }) }}</span>
        </span>
      </template>
      <span v-if="padActive" v-pad-focus="padScope" class="perf-more-scope" data-testid="coach-more-scope"><button ref="moreBtn" type="button" class="perf-more" data-testid="coach-more-stats"
        aria-haspopup="dialog" :aria-expanded="panelOpen" @click="openPanel">{{ t('coachStats.moreStats') }}</button></span>
      <button v-else ref="moreBtn" type="button" class="perf-more" data-testid="coach-more-stats" aria-haspopup="dialog" :aria-expanded="panelOpen" @click="openPanel">{{ t('coachStats.moreStats') }}</button>
    </div>
    <CoachStatsPanel v-if="panelOpen" :games="games" :name="displayName" @close="closePanel" />
  </section>
</template>

<style scoped>
.coach-card {
  box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; flex: 1 1 0; min-width: 234px; max-width: 520px; min-height: 52px; margin-right: auto;
  padding: 0 13px 8px 0; border-radius: 6px; cursor: pointer;
  color: var(--ui-forest, #1A401C); background: var(--ui-old-lace, #F8F5E7);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-forest, #1A401C) 30%, transparent), 0 2px 6px rgba(26, 64, 28, .14);
}
.coach-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.coach-badge-slot { position: relative; display: block; flex: 0 0 52px; width: 52px; height: 52px; }
.coach-lines { display: flex; flex-direction: column; justify-content: center; gap: 3px; flex: 1 1 0; min-width: 0; padding: 4px 0; }
.coach-line { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; min-width: 0; }
.coach-name { min-width: 0; font-size: 20px; font-weight: 700; line-height: 21px; overflow-wrap: anywhere; }
/* the record line wraps between its parts, never inside one (owner 11-03: no truncation) */
.coach-stats { min-width: 0; min-height: 18px; color: color-mix(in srgb, var(--ui-forest, #1A401C) 72%, transparent); font-size: 16px;
  line-height: 18px; white-space: normal; }
.coach-stat { white-space: nowrap; }

.coach-title-chip {
  flex: none; padding: 1px 10px; border-radius: 999px; color: #fff; background: var(--ui-forest, #1A401C);
  font-family: var(--font-display); font-size: 14px; font-weight: 800; letter-spacing: .06em; line-height: 18px;
  text-shadow: 1px 1px 0 #000; --display-caps-rest-shadow: 1px 1px 0 #000; white-space: nowrap;
}
.coach-title-chip.tier-rookie, .coach-title-chip.tier-experienced { color: var(--ui-forest, #1A401C); text-shadow: none; --display-caps-rest-shadow: none;
  background: color-mix(in srgb, var(--ui-forest, #1A401C) 14%, transparent); }
.coach-title-chip.tier-emerging-star, .coach-title-chip.tier-star { background: #790004; }
.coach-title-chip.tier-super-star, .coach-title-chip.tier-mega-star, .coach-title-chip.tier-legend { color: #101010; text-shadow: none;
  --display-caps-rest-shadow: none; background: #efc957; box-shadow: inset 0 0 0 1px #a8862a; }

/* ---- the stats row (owner 11-03): wraps, never clips; static numbers (no count-up, nothing animates) */
.coach-perf { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; min-height: 22px; padding-left: 10px; font-size: 14px; line-height: 18px; }
.perf-item { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-width: 0; }
.perf-k { color: color-mix(in srgb, var(--ui-forest, #1A401C) 72%, transparent); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
.perf-empty { color: color-mix(in srgb, var(--ui-forest, #1A401C) 72%, transparent); }
.perf-chips { display: inline-flex; gap: 2px; }
.perf-chip { display: inline-block; min-width: 16px; padding: 0 2px; border-radius: 3px; color: #fff; font-size: 12px; font-weight: 700; line-height: 16px; text-align: center; }
.perf-chip[data-result='W'] { background: var(--ui-success, #2e7d32); }
.perf-chip[data-result='D'] { color: var(--ui-forest, #1A401C); background: color-mix(in srgb, var(--ui-forest, #1A401C) 20%, transparent); }
.perf-chip[data-result='L'] { background: var(--ui-danger, #b71c1c); }
.perf-streak, .perf-luck { font-variant-numeric: tabular-nums; white-space: nowrap; }
.perf-race { white-space: nowrap; }
.perf-spark { display: block; flex: none; overflow: visible; }
.perf-spark-zero { stroke: color-mix(in srgb, var(--ui-forest, #1A401C) 30%, transparent); stroke-width: 1; stroke-dasharray: 2 2; }
.perf-spark-line { stroke: currentColor; stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
.perf-more-scope { display: contents; }
.perf-more { margin-left: auto; padding: 0; border: 0; background: none; color: inherit; font: inherit; font-size: 13px; text-decoration: underline; cursor: pointer; white-space: nowrap; }
.perf-more:focus-visible { outline: 2px solid var(--ui-focus, #ff3b3b); outline-offset: 2px; }
</style>
