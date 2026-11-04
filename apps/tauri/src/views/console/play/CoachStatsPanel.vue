<script setup lang="ts">
/**
 * Owner 11-03 (spec-coach-card-stats-2026-11-03.md): the coach card's EXPANDED stats panel - win rate by race,
 * matchups, TDs and casualties per game, dice luck by category over 10 / 25 / all games with armour breaks vs expected,
 * a FUMBBL / Super FUMBBL / all filter and a footer. Everything from the LOCAL game history (game/coachGameHistory.ts)
 * through game/coachStats.ts: no request, server-derived numbers only.
 *
 * A modal dialog: focus moves to it on open and is trapped in it (Tab / Shift+Tab), Escape and the close button close
 * it, the controller drives it through v-pad-focus (B = close). Modern / Retro: under Settings > Interface style Modern
 * the overlay carries `.sf-lm` (teleported dialogs opt in on their own root) and wears the League Manager panel
 * (lm-panel, hm-band, sf-btn, sf-table; lm-blades.css); Retro keeps the Play blade's parchment card (scoped below).
 * Static numbers, no counting animation; the entrance fade is off under reduced motion.
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { settings } from '../../../game/settings';
import { lmRootClass } from '../../../game/lmTheme';
import { motionReduced } from '../../../game/accessibilityModes';
import { PAD_FOCUS_PRIORITY, padFocusControllerMode, vPadFocus } from '../../../game/cardFocus';
import { COACH_LUCK_KEYS, type CoachGameRecord, type CoachLuckKey } from '../../../game/coachGameHistory';
import {
  diceWindows, filterByServer, historySince, matchups, perGame, raceRecords, recordText, signedLuck,
  type CoachServerFilter, type LuckSummary,
} from '../../../game/coachStats';
import { t } from '../../../i18n';

const props = defineProps<{ games: readonly CoachGameRecord[]; name: string }>();
const emit = defineEmits<{ close: [] }>();

const modern = computed(() => settings.uiStyle === 'modern');
const lmClass = computed(() => lmRootClass(settings.uiStyle));
const reduced = computed(() => motionReduced());
const filter = ref<CoachServerFilter>('all');
const FILTERS: CoachServerFilter[] = ['all', 'fumbbl', 'super'];
const FILTER_LABEL: Record<CoachServerFilter, string> = { all: 'coachStats.filter.all', fumbbl: 'coachStats.filter.fumbbl', super: 'coachStats.filter.super' };
const shown = computed(() => filterByServer(props.games, filter.value));
const races = computed(() => raceRecords(shown.value));
const vs = computed(() => matchups(shown.value));
const avg = computed(() => perGame(shown.value));
const windows = computed(() => diceWindows(shown.value));
const since = computed(() => historySince(props.games));
const sinceText = computed(() => (since.value == null ? '' : new Date(since.value).toLocaleDateString()));
const one = (v: number) => v.toFixed(1);
const ROW_LABEL: Record<CoachLuckKey, string> = { all: 'coachStats.dice.all', block: 'coachStats.dice.block', armour: 'coachStats.dice.armour', action: 'coachStats.dice.action' };
const verdictText = (s: LuckSummary) => (s.verdict === 'lucky' ? t('pg.luck.lucky') : s.verdict === 'unlucky' ? t('pg.luck.unlucky') : t('coachStats.luck.even'));
const windowLabel = (size: number | null) => (size == null ? t('coachStats.dice.allGames') : t('coachStats.dice.lastN', { n: size }));

const root = ref<HTMLElement | null>(null);
const closeBtn = ref<HTMLButtonElement | null>(null);
function close(): void { emit('close'); }
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
  if (event.key !== 'Tab' || !root.value) return;
  const stops = Array.from(root.value.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'));
  if (!stops.length) return;
  const first = stops[0]!, last = stops[stops.length - 1]!;
  const at = document.activeElement as HTMLElement | null;
  if (event.shiftKey && (at === first || !root.value.contains(at))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (at === last || !root.value.contains(at))) { event.preventDefault(); first.focus(); }
}
onMounted(() => { void nextTick(() => closeBtn.value?.focus()); });
/** Controller (Sol r3): the body scrolls with the right stick (cardFocus `scroll`) and a page at a time with LB / RB, so
 *  every section is reachable however many races the history holds; the D-pad keeps moving between the controls. */
const body = ref<HTMLElement | null>(null);
function page(dir: 1 | -1): void {
  const el = body.value;
  if (el) el.scrollTop += dir * Math.max(120, Math.round(el.clientHeight * 0.9));
}
const padOptions = computed(() => ({
  cancel: close, priority: PAD_FOCUS_PRIORITY.confirmation, scroll: () => body.value,
  keys: { LB: () => page(-1), RB: () => page(1) },
}));
const padHint = computed(() => padFocusControllerMode());
</script>

<template>
  <Teleport to="body">
    <div class="cs-overlay" :class="lmClass" :data-motion="reduced ? 'reduced' : 'full'" data-testid="coach-stats-overlay" @click.self="close">
      <section ref="root" v-pad-focus="padOptions" class="cs-panel" :class="{ 'lm-panel': modern }" role="dialog" aria-modal="true"
        aria-labelledby="coach-stats-title" data-testid="coach-stats-panel" @keydown="onKeydown">
        <header class="cs-head" :class="{ 'hm-band': modern }">
          <h2 id="coach-stats-title">{{ t('coachStats.panel.title') }}</h2>
          <span class="cs-name">{{ name }}</span>
          <button ref="closeBtn" type="button" class="cs-close" :class="{ 'sf-btn small': modern }" data-pad-cancel :aria-label="t('coachStats.panel.close')" @click="close">&#x2715;</button>
        </header>

        <div ref="body" class="cs-body" data-testid="coach-stats-body">
          <div class="cs-filter" role="group" :aria-label="t('coachStats.filter.label')">
            <span class="cs-k">{{ t('coachStats.filter.label') }}</span>
            <button v-for="f in FILTERS" :key="f" type="button" class="cs-filter-btn" :class="{ 'sf-btn small': modern }" :aria-pressed="filter === f" :data-filter="f"
              @click="filter = f">{{ t(FILTER_LABEL[f]) }}</button>
          </div>

          <p v-if="!games.length" class="cs-empty" data-testid="coach-stats-empty">{{ t('coachStats.empty') }}</p>
          <p v-else-if="!shown.length" class="cs-empty" data-testid="coach-stats-empty">{{ t('coachStats.noGamesOnServer') }}</p>
          <div v-else class="cs-grid">
            <section class="cs-section" data-section="races" aria-labelledby="cs-races-h">
              <h3 id="cs-races-h">{{ t('coachStats.races.title') }}</h3>
              <table class="cs-table" :class="{ 'sf-table': modern }">
                <thead><tr><th scope="col">{{ t('coachStats.races.race') }}</th><th scope="col">{{ t('coachStats.races.games') }}</th><th scope="col">{{ t('coachStats.races.record') }}</th><th scope="col">{{ t('coachStats.races.winPct') }}</th></tr></thead>
                <tbody>
                  <tr v-for="r in races" :key="r.race"><th scope="row">{{ r.race }}</th><td>{{ r.games }}</td><td>{{ recordText(r) }}</td><td>{{ t('coachStats.winPct', { pct: r.winPct }) }}</td></tr>
                </tbody>
              </table>
            </section>

            <section class="cs-section" data-section="matchups" aria-labelledby="cs-vs-h">
              <h3 id="cs-vs-h">{{ t('coachStats.matchups.title') }}</h3>
              <table class="cs-table" :class="{ 'sf-table': modern }">
                <thead><tr><th scope="col">{{ t('coachStats.matchups.opponent') }}</th><th scope="col">{{ t('coachStats.races.games') }}</th><th scope="col">{{ t('coachStats.races.record') }}</th><th scope="col">{{ t('coachStats.races.winPct') }}</th></tr></thead>
                <tbody>
                  <tr v-for="r in vs" :key="r.race" :data-best="r.best" :data-worst="r.worst">
                    <th scope="row">{{ r.race }}<span v-if="r.best" class="cs-flag" data-flag="best">{{ t('coachStats.matchups.best') }}</span><span v-if="r.worst" class="cs-flag" data-flag="worst">{{ t('coachStats.matchups.worst') }}</span></th>
                    <td>{{ r.games }}</td><td>{{ recordText(r) }}</td><td>{{ t('coachStats.winPct', { pct: r.winPct }) }}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section v-if="avg" class="cs-section" data-section="per-game" aria-labelledby="cs-pg-h">
              <h3 id="cs-pg-h">{{ t('coachStats.perGame.title') }}</h3>
              <dl class="cs-kv">
                <dt>{{ t('coachStats.perGame.tds') }}</dt><dd data-stat="tds">{{ t('coachStats.perGame.forAgainst', { for: one(avg.tdFor), against: one(avg.tdAgainst) }) }}</dd>
                <dt>{{ t('coachStats.perGame.cas') }}</dt><dd data-stat="cas">{{ t('coachStats.perGame.forAgainst', { for: one(avg.casFor), against: one(avg.casAgainst) }) }}</dd>
              </dl>
            </section>

            <section class="cs-section cs-wide" data-section="dice" aria-labelledby="cs-dice-h">
              <h3 id="cs-dice-h">{{ t('coachStats.dice.title') }}</h3>
              <table class="cs-table" :class="{ 'sf-table': modern }">
                <thead><tr><th scope="col">{{ t('coachStats.dice.category') }}</th><th v-for="w in windows" :key="String(w.size)" scope="col">{{ windowLabel(w.size) }}</th></tr></thead>
                <tbody>
                  <tr v-for="key in COACH_LUCK_KEYS" :key="key" :data-row="key">
                    <th scope="row">{{ t(ROW_LABEL[key]) }}</th>
                    <td v-for="w in windows" :key="String(w.size)" :data-verdict="w.rows[key].verdict ?? 'none'">
                      <template v-if="w.rows[key].mean != null">{{ t('coachStats.dice.cell', { value: signedLuck(w.rows[key].mean!), verdict: verdictText(w.rows[key]) }) }}</template>
                      <template v-else>{{ t('coachStats.dice.none') }}</template>
                    </td>
                  </tr>
                  <tr data-row="armourBreaks">
                    <th scope="row">{{ t('coachStats.dice.armourBreaks') }}</th>
                    <td v-for="w in windows" :key="String(w.size)">
                      <template v-if="w.armour">{{ t('coachStats.dice.breaksValue', { actual: w.armour.actual, rolls: w.armour.rolls, expected: one(w.armour.expected) }) }}</template>
                      <template v-else>{{ t('coachStats.dice.none') }}</template>
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
        </div>

        <p v-if="padHint" class="cs-pad-hint" data-testid="coach-stats-pad-hint">{{ t('coachStats.panel.padScrollHint') }}</p>
        <footer v-if="games.length" class="cs-foot" data-testid="coach-stats-footer">{{ t('coachStats.footer', { n: games.length, date: sinceText }) }}</footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.cs-overlay { position: fixed; inset: 0; z-index: 210; display: flex; align-items: center; justify-content: center; padding: 3vh 16px; background: #05070cc8; }
.cs-overlay[data-motion='full'] .cs-panel { animation: cs-in 160ms ease-out; }
@keyframes cs-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .cs-overlay .cs-panel { animation: none !important; } }
:global(html.sf-reduce-motion) .cs-panel { animation: none !important; }

.cs-panel { box-sizing: border-box; display: flex; flex-direction: column; width: min(980px, 100%); max-height: 92vh; overflow: hidden; }
.cs-head { display: flex; align-items: center; gap: 12px; flex: none; }
.cs-head h2 { margin: 0; }
.cs-name { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.cs-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 16px 16px; }
.cs-filter { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
.cs-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.cs-wide { grid-column: 1 / -1; }
.cs-section h3 { margin: 0 0 6px; font-size: 16px; }
.cs-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.cs-table th, .cs-table td { padding: 4px 6px; text-align: left; vertical-align: middle; }
.cs-flag { margin-left: 8px; padding: 0 6px; border-radius: 999px; font-size: 12px; white-space: nowrap; }
.cs-flag[data-flag='best'] { color: #fff; background: var(--ui-success, #2e7d32); }
.cs-flag[data-flag='worst'] { color: #fff; background: var(--ui-danger, #b71c1c); }
.cs-kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 14px; margin: 0; }
.cs-kv dd { margin: 0; font-variant-numeric: tabular-nums; }
.cs-empty { margin: 0; padding: 14px 0; }
.cs-foot { flex: none; padding: 10px 16px; font-size: 14px; }
.cs-pad-hint { flex: none; margin: 0; padding: 4px 16px 0; font-size: 12px; opacity: .8; }

/* Retro (the Play blade's parchment card): the overlay without .sf-lm */
.cs-overlay:not(.sf-lm) .cs-panel {
  border: 1px solid var(--ui-forest, #1A401C); border-radius: 8px; color: var(--ui-forest, #1A401C); background: var(--ui-old-lace, #F8F5E7);
  box-shadow: 0 20px 60px #000c;
}
.cs-overlay:not(.sf-lm) .cs-head { padding: 12px 18px; border-bottom: 1px solid color-mix(in srgb, var(--ui-forest, #1A401C) 30%, transparent); }
.cs-overlay:not(.sf-lm) .cs-head h2 { font-family: var(--font-display); font-size: 24px; }
.cs-overlay:not(.sf-lm) .cs-close, .cs-overlay:not(.sf-lm) .cs-filter-btn {
  min-height: 32px; padding: 0 12px; border: 1px solid var(--ui-forest, #1A401C); border-radius: 4px; color: var(--ui-forest, #1A401C);
  background: color-mix(in srgb, var(--ui-forest, #1A401C) 8%, transparent); font: inherit; cursor: pointer;
}
.cs-overlay:not(.sf-lm) .cs-filter-btn[aria-pressed='true'] { color: var(--ui-old-lace, #F8F5E7); background: var(--ui-forest, #1A401C); }
.cs-overlay:not(.sf-lm) :is(.cs-close, .cs-filter-btn):focus-visible { outline: 2px solid var(--ui-focus, #ff3b3b); outline-offset: 2px; }
.cs-overlay:not(.sf-lm) .cs-table th, .cs-overlay:not(.sf-lm) .cs-table td { border-bottom: 1px solid color-mix(in srgb, var(--ui-forest, #1A401C) 18%, transparent); }
.cs-overlay:not(.sf-lm) .cs-table thead th { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: color-mix(in srgb, var(--ui-forest, #1A401C) 72%, transparent); }
.cs-overlay:not(.sf-lm) .cs-foot, .cs-overlay:not(.sf-lm) .cs-empty, .cs-overlay:not(.sf-lm) .cs-k { color: color-mix(in srgb, var(--ui-forest, #1A401C) 72%, transparent); }
.cs-overlay:not(.sf-lm) .cs-foot { border-top: 1px solid color-mix(in srgb, var(--ui-forest, #1A401C) 30%, transparent); }
</style>
