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
 *
 * Owner 11-04: "Win rate by race", "Matchups" (every opponent race met, no top-5 cap) and "Opponent coaches" each
 * scroll inside a box about six rows tall, their column headers sticky. Each box is a focus stop (Tab, the D-pad): the
 * mouse wheel scrolls the box under it, the arrow / Page / Home / End keys the focused box, and the right stick and
 * LB / RB the box that holds the controller focus while it can still move that way (then the panel body, as before, so
 * the sections below stay reachable).
 *
 * Owner 11-04: the Dice luck table's Action row has a "Details" control: a pop-out (CoachStatsPopout.vue) splitting MY
 * action rolls by roll kind (Dodge, Rush, Jump, Leap, Pick-up ... grouped Movement / Ball handling / Negative traits /
 * Other, most rolls first) over the last 10 / 25 / all games, from each record's optional `actionKinds` (the end
 * screen's own action bucket, split). The end-of-game Dice view is untouched.
 *
 * Owner 11-04: "Extra stats" (by the footer; named apart from the card's own "More stats" link) opens a second pop-out,
 * the home for further stats in sections. First section: win rate against the opponent's Coach Rating, in the CR bands
 * of coachStats.CR_BANDS, from each record's optional `opponentCr` (the game-load rank bar's own lookup).
 *
 * Owner 11-04 ("We can also grow this pane", then "a bit larger"): the panel is min(1600px, 96vw) wide and up to 92vh
 * tall, its body scrolling inside; the type is ~+20% over the first version (1.2rem body, headers to match) and the
 * table rows grow with it (36 px). Tables sit three to a row (Win rate by race | Matchups | Opponent coaches), then
 * Per game beside the Dice luck table; one column under 1000 px. At 1280 x 720 the panel is 1229 x 662: nothing clips.
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { settings } from '../../../game/settings';
import { lmRootClass } from '../../../game/lmTheme';
import { motionReduced } from '../../../game/accessibilityModes';
import { PAD_FOCUS_PRIORITY, padFocusControllerMode, padFocusedControl, vPadFocus } from '../../../game/cardFocus';
import { COACH_LUCK_KEYS, type CoachGameRecord, type CoachLuckKey, type CoachStatKey } from '../../../game/coachGameHistory';
import {
  ACTION_ROLL_GROUPS, actionBreakdown, actionRollFallbackName, crBands, koRecoveries, diceWindows, filterByServer, historySince, matchups, opponentCoaches, perGameStats, raceRecords, recordText, signedLuck,
  type CoachServerFilter, type LuckSummary,
} from '../../../game/coachStats';
import { t, terms } from '../../../i18n';
import CoachStatsPopout from './CoachStatsPopout.vue';
import { forkFeaturesEnabled } from '../../../game/forkAccess';

const props = defineProps<{ games: readonly CoachGameRecord[]; name: string }>();
const emit = defineEmits<{ close: [] }>();

const modern = computed(() => settings.uiStyle === 'modern');
const lmClass = computed(() => lmRootClass(settings.uiStyle));
const reduced = computed(() => motionReduced());
const filter = ref<CoachServerFilter>('all');
const FILTERS: CoachServerFilter[] = ['all', 'fumbbl', 'super'];
const FILTER_LABEL: Record<CoachServerFilter, string> = { all: 'coachStats.filter.all', fumbbl: 'coachStats.filter.fumbbl', super: 'coachStats.filter.super' };
// Owner 11-04: the server filter (and its Super FUMBBL label) shows only with fork features; the card already hands a
// public run its FUMBBL games only.
const showServerFilter = computed(() => forkFeaturesEnabled());
const shown = computed(() => (showServerFilter.value ? filterByServer(props.games, filter.value) : props.games));
const races = computed(() => raceRecords(shown.value));
const vs = computed(() => matchups(shown.value));
const coaches = computed(() => opponentCoaches(shown.value));
const avg = computed(() => perGameStats(shown.value));
/** Owner 11-04: the end screen's own Statistics labels, plus Dodges. */
const STAT_LABEL: Record<CoachStatKey, string> = {
  touchdowns: 'cards.postGame.postgameStats.touchdowns', casualties: 'cards.postGame.postgameStats.casualties',
  blocks: 'cards.postGame.postgameStats.blocks', fouls: 'cards.postGame.postgameStats.fouls',
  dodges: 'coachStats.perGame.dodges', spp: 'cards.postGame.postgameStats.sppEarned',
};
const windows = computed(() => diceWindows(shown.value));

// ---- owner 11-04: the Action roll breakdown pop-out ----
const detailsOpen = ref(false);
const DETAIL_WINDOWS: (number | null)[] = [10, 25, null];
const detailWindow = ref<number | null>(null);
const actionRows = computed(() => actionBreakdown(shown.value, detailWindow.value));
const actionGroups = computed(() => ACTION_ROLL_GROUPS.map((group) => ({ group, rows: actionRows.value.filter((r) => r.group === group) })).filter((g) => g.rows.length));
const GROUP_LABEL = {
  movement: 'coachStats.actionRolls.group.movement', ballHandling: 'coachStats.actionRolls.group.ballHandling',
  negativeTraits: 'coachStats.actionRolls.group.negativeTraits', other: 'coachStats.actionRolls.group.other',
} as const;
/** Our own label keys for the roll kinds the game terms do not name. */
const ROLL_KEY: Record<string, string> = {
  goForItRoll: 'coachStats.roll.rush', leapRoll: 'coachStats.roll.jump', jumpRoll: 'coachStats.roll.jump', standUpRoll: 'coachStats.roll.standUp',
  pickUpRoll: 'coachStats.roll.pickUp', throwTeamMateRoll: 'coachStats.roll.throwTeamMate', wildAnimalRoll: 'coachStats.roll.wildAnimal',
  escapeRoll: 'coachStats.roll.escape', confusionRoll: 'coachStats.roll.confusion',
};
/** The rulebook's skill names (the game-terms translations, terms()) for the rest. */
const ROLL_TERM: Record<string, string> = {
  dodgeRoll: 'Dodge', 'leapRoll:leap': 'Leap', jumpUpRoll: 'Jump Up', catchRoll: 'Catch', passRoll: 'Pass', interceptionRoll: 'Interception',
  rightStuffRoll: 'Right Stuff', safeThrowRoll: 'Safe Pass', foulAppearanceRoll: 'Foul Appearance', reallyStupidRoll: 'Really Stupid',
  bloodLustRoll: 'Bloodlust', boneHeadRoll: 'Bone Head', animalSavageryRoll: 'Animal Savagery', takeRootRoll: 'Take Root',
  unchannelledFuryRoll: 'Unchannelled Fury', alwaysHungryRoll: 'Always Hungry', animosityRoll: 'Animosity', regenerationRoll: 'Regeneration',
  hypnoticGazeRoll: 'Hypnotic Gaze', dauntlessRoll: 'Dauntless', chainsawRoll: 'Chainsaw', breatheFire: 'Breathe Fire',
  projectileVomit: 'Projectile Vomit', steadyFootingRoll: 'Steady Footing',
};
function rollName(kind: string): string {
  if (ROLL_KEY[kind]) return t(ROLL_KEY[kind]!);
  if (ROLL_TERM[kind]) return terms(ROLL_TERM[kind]!);
  return actionRollFallbackName(kind);
}
const actionVerdict = (v: 'lucky' | 'even' | 'unlucky' | null) => (v === 'lucky' ? t('pg.luck.lucky') : v === 'unlucky' ? t('pg.luck.unlucky') : t('coachStats.luck.even'));
function openDetails(): void { detailsOpen.value = true; }

// ---- owner 11-04: the Extra stats pop-out (win rate vs coach rating, and later sections) ----
const extraOpen = ref(false);
const extraBtn = ref<HTMLButtonElement | null>(null);
const cr = computed(() => crBands(shown.value));
const BAND_LABEL: Record<string, string> = {
  under1400: 'coachStats.cr.band.under1400', 1400: 'coachStats.cr.band.1400', 1500: 'coachStats.cr.band.1500',
  1600: 'coachStats.cr.band.1600', 1700: 'coachStats.cr.band.1700',
};
/** Owner 11-04: KO recoveries (mine and the opponents') over the last 10 / 25 / all games. */
const koWindow = ref<number | null>(null);
const ko = computed(() => koRecoveries(shown.value, koWindow.value));
const koRows = computed(() => [
  { side: 'for', label: 'coachStats.ko.mine', row: ko.value.for },
  { side: 'against', label: 'coachStats.ko.theirs', row: ko.value.against },
].filter((r) => r.row));
function openExtra(): void { extraOpen.value = true; }
function closeExtra(): void {
  extraOpen.value = false;
  void nextTick(() => extraBtn.value?.focus());
}
function closeDetails(): void {
  detailsOpen.value = false;
  void nextTick(() => root.value?.querySelector<HTMLElement>('[data-testid="coach-stats-action-details"]')?.focus());
}
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
/** Owner 11-04: the table box that holds the controller focus (or the DOM focus) while it can still scroll `dir`, else
 *  the body (the browser's own scroll chaining). A pure DOM read - it never refreshes the pad layer, so the router's
 *  scroll step cannot re-enter it. */
function canScroll(el: HTMLElement, dir: 'Up' | 'Down'): boolean {
  return dir === 'Up' ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
}
function scrollTarget(dir: 'Up' | 'Down'): HTMLElement | null {
  const panel = root.value;
  for (const at of [padFocusedControl(), typeof document !== 'undefined' ? document.activeElement : null]) {
    const box = at instanceof HTMLElement ? at.closest<HTMLElement>('.cs-scroll') : null;
    if (box && panel?.contains(box)) return canScroll(box, dir) ? box : body.value;
  }
  return body.value;
}
function page(dir: 1 | -1): void {
  const el = scrollTarget(dir > 0 ? 'Down' : 'Up');
  if (el) el.scrollTop += dir * Math.max(120, Math.round(el.clientHeight * 0.9));
}
/** The keyboard on a focused table box: arrows a row, Page a box, Home / End the ends (the browser's own keyboard
 *  scrolling, made explicit so every platform behaves the same). */
const ROW_STEP_PX = 36; // one table row
function onBoxKeydown(event: KeyboardEvent): void {
  const el = event.currentTarget as HTMLElement | null;
  if (!el || event.altKey || event.ctrlKey || event.metaKey) return;
  const pageStep = Math.max(ROW_STEP_PX, el.clientHeight - ROW_STEP_PX);
  const delta: Record<string, number> = { ArrowDown: ROW_STEP_PX, ArrowUp: -ROW_STEP_PX, PageDown: pageStep, PageUp: -pageStep };
  if (event.key in delta) el.scrollTop += delta[event.key]!;
  else if (event.key === 'Home') el.scrollTop = 0;
  else if (event.key === 'End') el.scrollTop = el.scrollHeight;
  else return;
  event.preventDefault();
}
const padOptions = computed(() => ({
  cancel: close, priority: PAD_FOCUS_PRIORITY.confirmation, scroll: scrollTarget,
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
          <div v-if="showServerFilter" class="cs-filter" role="group" :aria-label="t('coachStats.filter.label')">
            <span class="cs-k">{{ t('coachStats.filter.label') }}</span>
            <button v-for="f in FILTERS" :key="f" type="button" class="cs-filter-btn" :class="{ 'sf-btn small': modern }" :aria-pressed="filter === f" :data-filter="f"
              @click="filter = f">{{ t(FILTER_LABEL[f]) }}</button>
          </div>

          <p v-if="!games.length" class="cs-empty" data-testid="coach-stats-empty">{{ t('coachStats.empty') }}</p>
          <p v-else-if="!shown.length" class="cs-empty" data-testid="coach-stats-empty">{{ t('coachStats.noGamesOnServer') }}</p>
          <div v-else class="cs-grid">
            <section class="cs-section" data-section="races" aria-labelledby="cs-races-h">
              <h3 id="cs-races-h">{{ t('coachStats.races.title') }}</h3>
              <div class="cs-scroll" tabindex="0" data-pad-focus role="region" aria-labelledby="cs-races-h" data-scroll="races" @keydown="onBoxKeydown">
              <table class="cs-table" :class="{ 'sf-table': modern }">
                <thead><tr><th scope="col">{{ t('coachStats.races.race') }}</th><th scope="col">{{ t('coachStats.races.games') }}</th><th scope="col">{{ t('coachStats.races.record') }}</th><th scope="col">{{ t('coachStats.races.winPct') }}</th></tr></thead>
                <tbody>
                  <tr v-for="r in races" :key="r.race"><th scope="row">{{ r.race }}</th><td>{{ r.games }}</td><td>{{ recordText(r) }}</td><td>{{ t('coachStats.winPct', { pct: r.winPct }) }}</td></tr>
                </tbody>
              </table>
              </div>
            </section>

            <section class="cs-section" data-section="matchups" aria-labelledby="cs-vs-h">
              <h3 id="cs-vs-h">{{ t('coachStats.matchups.title') }}</h3>
              <div class="cs-scroll" tabindex="0" data-pad-focus role="region" aria-labelledby="cs-vs-h" data-scroll="matchups" @keydown="onBoxKeydown">
              <table class="cs-table" :class="{ 'sf-table': modern }">
                <thead><tr><th scope="col">{{ t('coachStats.matchups.opponent') }}</th><th scope="col">{{ t('coachStats.races.games') }}</th><th scope="col">{{ t('coachStats.races.record') }}</th><th scope="col">{{ t('coachStats.races.winPct') }}</th></tr></thead>
                <tbody>
                  <tr v-for="r in vs" :key="r.race" :data-best="r.best" :data-worst="r.worst">
                    <th scope="row">{{ r.race }}<span v-if="r.best" class="cs-flag" data-flag="best">{{ t('coachStats.matchups.best') }}</span><span v-if="r.worst" class="cs-flag" data-flag="worst">{{ t('coachStats.matchups.worst') }}</span></th>
                    <td>{{ r.games }}</td><td>{{ recordText(r) }}</td><td>{{ t('coachStats.winPct', { pct: r.winPct }) }}</td>
                  </tr>
                </tbody>
              </table>
              </div>
            </section>

            <section v-if="coaches.length" class="cs-section" data-section="coaches" aria-labelledby="cs-coaches-h">
              <h3 id="cs-coaches-h">{{ t('coachStats.coaches.title') }}</h3>
              <div class="cs-scroll" tabindex="0" data-pad-focus role="region" aria-labelledby="cs-coaches-h" data-scroll="coaches" @keydown="onBoxKeydown">
              <table class="cs-table" :class="{ 'sf-table': modern }">
                <thead><tr><th scope="col">{{ t('coachStats.coaches.coach') }}</th><th scope="col">{{ t('coachStats.coaches.cr') }}</th><th scope="col">{{ t('coachStats.races.games') }}</th><th scope="col">{{ t('coachStats.races.record') }}</th><th scope="col">{{ t('coachStats.races.winPct') }}</th></tr></thead>
                <tbody>
                  <tr v-for="c in coaches" :key="c.coach.toLowerCase()"><th scope="row">{{ c.coach }}</th><td data-cell="cr">{{ c.cr != null ? c.cr : t('coachStats.dice.none') }}</td><td>{{ c.games }}</td><td>{{ recordText(c) }}</td><td>{{ t('coachStats.winPct', { pct: c.winPct }) }}</td></tr>
                </tbody>
              </table>
              </div>
            </section>

            <section v-if="avg.length" class="cs-section" data-section="per-game" aria-labelledby="cs-pg-h">
              <h3 id="cs-pg-h">{{ t('coachStats.perGame.title') }}</h3>
              <dl class="cs-kv">
                <template v-for="s in avg" :key="s.key"><dt>{{ t(STAT_LABEL[s.key]) }}</dt><dd :data-stat="s.key">{{ t('coachStats.perGame.forAgainst', { for: one(s.for), against: one(s.against) }) }}</dd></template>
              </dl>
            </section>

            <section class="cs-section cs-wide" data-section="dice" aria-labelledby="cs-dice-h">
              <h3 id="cs-dice-h">{{ t('coachStats.dice.title') }}</h3>
              <table class="cs-table" :class="{ 'sf-table': modern }">
                <thead><tr><th scope="col">{{ t('coachStats.dice.category') }}</th><th v-for="w in windows" :key="String(w.size)" scope="col">{{ windowLabel(w.size) }}</th></tr></thead>
                <tbody>
                  <tr v-for="key in COACH_LUCK_KEYS" :key="key" :data-row="key">
                    <th scope="row">{{ t(ROW_LABEL[key]) }}<button v-if="key === 'action'" type="button" class="cs-details"
                      :class="{ 'sf-btn small': modern }" data-testid="coach-stats-action-details" aria-haspopup="dialog" :aria-expanded="detailsOpen"
                      :aria-label="t('coachStats.actionRolls.detailsAria')" @click="openDetails">{{ t('coachStats.actionRolls.details') }}</button></th>
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
        <footer class="cs-foot">
          <span v-if="games.length" data-testid="coach-stats-footer">{{ t('coachStats.footer', { n: games.length, date: sinceText }) }}</span>
          <button v-if="games.length" ref="extraBtn" type="button" class="cs-extra" :class="{ 'sf-btn small': modern }" data-testid="coach-stats-extra"
            aria-haspopup="dialog" :aria-expanded="extraOpen" @click="openExtra">{{ t('coachStats.extra.open') }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
  <CoachStatsPopout v-if="detailsOpen" :title="t('coachStats.actionRolls.title')" :close-label="t('coachStats.actionRolls.close')"
    testid="coach-stats-action-rolls" @close="closeDetails">
    <div class="cs-filter" role="group" :aria-label="t('coachStats.actionRolls.window')">
      <span class="cs-k">{{ t('coachStats.actionRolls.window') }}</span>
      <button v-for="w in DETAIL_WINDOWS" :key="String(w)" type="button" class="cs-filter-btn" :class="{ 'sf-btn small': modern }"
        :aria-pressed="detailWindow === w" :data-window="w ?? 'all'" @click="detailWindow = w">{{ windowLabel(w) }}</button>
    </div>
    <p v-if="!actionGroups.length" class="cs-empty" data-testid="coach-stats-action-empty">{{ t('coachStats.actionRolls.empty') }}</p>
    <div v-else class="cs-scroll cs-scroll-tall" tabindex="0" data-pad-focus role="region" :aria-label="t('coachStats.actionRolls.title')"
      data-scroll="action-rolls" @keydown="onBoxKeydown">
      <table class="cs-table" :class="{ 'sf-table': modern }">
        <thead><tr><th scope="col">{{ t('coachStats.actionRolls.roll') }}</th><th scope="col">{{ t('coachStats.actionRolls.rolls') }}</th>
          <th scope="col">{{ t('coachStats.actionRolls.passed') }}</th><th scope="col">{{ t('coachStats.actionRolls.luck') }}</th></tr></thead>
        <template v-for="g in actionGroups" :key="g.group">
          <tbody :data-group="g.group">
            <tr class="cs-group-row"><th scope="colgroup" colspan="4">{{ t(GROUP_LABEL[g.group]) }}</th></tr>
            <tr v-for="r in g.rows" :key="r.kind" :data-kind="r.kind" :data-verdict="r.verdict ?? 'none'">
              <th scope="row">{{ rollName(r.kind) }}</th>
              <td>{{ r.n }}<span v-if="r.unmeasured" class="cs-unmeasured"> {{ t('coachStats.actionRolls.unmeasured', { n: r.unmeasured }) }}</span></td>
              <td>{{ t('coachStats.actionRolls.passedValue', { passed: r.passed, expected: one(r.expected) }) }}</td>
              <td><template v-if="r.verdict">{{ t('coachStats.dice.cell', { value: signedLuck(r.zShown), verdict: actionVerdict(r.verdict) }) }}</template>
                <template v-else>{{ t('coachStats.dice.none') }}</template></td>
            </tr>
          </tbody>
        </template>
      </table>
    </div>
  </CoachStatsPopout>
  <CoachStatsPopout v-if="extraOpen" :title="t('coachStats.extra.title')" :close-label="t('coachStats.extra.close')"
    testid="coach-stats-extra-stats" @close="closeExtra">
    <section class="cs-section" data-section="cr" aria-labelledby="cs-cr-h">
      <h3 id="cs-cr-h">{{ t('coachStats.cr.title') }}</h3>
      <div class="cs-scroll" tabindex="0" data-pad-focus role="region" aria-labelledby="cs-cr-h" data-scroll="cr" @keydown="onBoxKeydown">
        <table class="cs-table" :class="{ 'sf-table': modern }">
          <thead><tr><th scope="col">{{ t('coachStats.cr.band') }}</th><th scope="col">{{ t('coachStats.races.games') }}</th><th scope="col">{{ t('coachStats.races.record') }}</th><th scope="col">{{ t('coachStats.races.winPct') }}</th></tr></thead>
          <tbody>
            <tr v-for="b in cr.rows" :key="b.key" :data-band="b.key"><th scope="row">{{ t(BAND_LABEL[b.key] ?? b.key) }}</th><td>{{ b.games }}</td><td>{{ recordText(b) }}</td>
              <td>{{ b.winPct == null ? t('coachStats.cr.noPct') : t('coachStats.winPct', { pct: b.winPct }) }}</td></tr>
          </tbody>
        </table>
      </div>
      <p v-if="cr.unrated" class="cs-note" data-testid="coach-stats-cr-unrated">{{ t('coachStats.cr.unrated', { n: cr.unrated }) }}</p>
    </section>
    <section class="cs-section cs-extra-section" data-section="ko" aria-labelledby="cs-ko-h">
      <h3 id="cs-ko-h">{{ t('coachStats.ko.title') }}</h3>
      <div class="cs-filter" role="group" :aria-label="t('coachStats.actionRolls.window')">
        <span class="cs-k">{{ t('coachStats.actionRolls.window') }}</span>
        <button v-for="w in DETAIL_WINDOWS" :key="String(w)" type="button" class="cs-filter-btn" :class="{ 'sf-btn small': modern }"
          :aria-pressed="koWindow === w" :data-ko-window="w ?? 'all'" @click="koWindow = w">{{ windowLabel(w) }}</button>
      </div>
      <p v-if="!koRows.length" class="cs-empty" data-testid="coach-stats-ko-empty">{{ t('coachStats.ko.empty') }}</p>
      <div v-else class="cs-scroll" tabindex="0" data-pad-focus role="region" aria-labelledby="cs-ko-h" data-scroll="ko" @keydown="onBoxKeydown">
        <table class="cs-table" :class="{ 'sf-table': modern }">
          <thead><tr><th scope="col">{{ t('coachStats.ko.side') }}</th><th scope="col">{{ t('coachStats.actionRolls.rolls') }}</th>
            <th scope="col">{{ t('coachStats.ko.recovered') }}</th><th scope="col">{{ t('coachStats.actionRolls.luck') }}</th></tr></thead>
          <tbody>
            <tr v-for="r in koRows" :key="r.side" :data-ko-side="r.side" :data-verdict="r.row!.verdict ?? 'none'">
              <th scope="row">{{ t(r.label) }}</th>
              <td>{{ r.row!.n }}<span v-if="r.row!.unmeasured" class="cs-unmeasured"> {{ t('coachStats.actionRolls.unmeasured', { n: r.row!.unmeasured }) }}</span></td>
              <td>{{ t('coachStats.actionRolls.passedValue', { passed: r.row!.passed, expected: one(r.row!.expected) }) }}</td>
              <td><template v-if="r.row!.verdict">{{ t('coachStats.dice.cell', { value: signedLuck(r.row!.zShown), verdict: actionVerdict(r.row!.verdict) }) }}</template>
                <template v-else>{{ t('coachStats.dice.none') }}</template></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </CoachStatsPopout>
</template>

<style scoped>
.cs-overlay { position: fixed; inset: 0; z-index: 210; display: flex; align-items: center; justify-content: center; padding: 3vh 16px; background: #05070cc8; }
.cs-overlay[data-motion='full'] .cs-panel { animation: cs-in 160ms ease-out; }
@keyframes cs-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .cs-overlay .cs-panel { animation: none !important; } }
:global(html.sf-reduce-motion) .cs-panel { animation: none !important; }

.cs-panel { box-sizing: border-box; display: flex; flex-direction: column; width: min(1600px, 96vw); max-height: 92vh; overflow: hidden; font-size: 1.2rem; }
.cs-head { display: flex; align-items: center; gap: 12px; flex: none; }
.cs-head h2 { margin: 0; }
.cs-name { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.cs-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px 20px 20px; }
.cs-filter { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 14px; }
.cs-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.cs-wide { grid-column: span 2; }
@media (max-width: 1000px) { .cs-grid { grid-template-columns: minmax(0, 1fr); } .cs-wide { grid-column: auto; } }
.cs-section h3 { margin: 0 0 8px; font-size: 1.3rem; }
.cs-overlay.sf-lm .cs-table { font-size: 1.05rem; }
.cs-overlay.sf-lm .cs-table thead th { font-size: .75rem; }
.cs-overlay.sf-lm .cs-panel > .hm-band h2 { font-size: 1.65rem; }
.cs-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.cs-table th, .cs-table td { padding: 5px 8px; text-align: left; vertical-align: middle; }
/* Owner 11-04: the three list tables scroll inside a box of about six rows, the column headers sticky. The box's height
   is a whole number of fixed-height rows (the header + 6), in both styles. */
.cs-scroll { --cs-row: 36px; max-height: calc(var(--cs-row) * 7); overflow-y: auto; overscroll-behavior: contain; border-radius: 4px; }
.cs-scroll .cs-table tr { height: var(--cs-row); }
.cs-scroll .cs-table thead th { position: sticky; top: 0; z-index: 1; background: var(--ui-old-lace, #F8F5E7); }
.cs-scroll-tall { max-height: calc(var(--cs-row) * 13); }
.cs-group-row th { font-weight: 700; }
/* Owner 11-05: the Action row's "More" control is a size down from the panel's other buttons and never wraps under its label. */
.cs-details { margin-left: 10px; font: inherit; font-size: .85em; cursor: pointer; vertical-align: middle; }
.cs-table tr[data-row='action'] th { white-space: nowrap; }
.cs-overlay.sf-lm .cs-details.sf-btn.small { min-height: 28px; padding: 0 8px; font-size: 10px; }
.cs-unmeasured { opacity: .75; font-size: .9em; white-space: nowrap; }
.cs-scroll:focus-visible { outline: 2px solid var(--ui-focus, #ff3b3b); outline-offset: 2px; }
.cs-flag { margin-left: 8px; padding: 0 7px; border-radius: 999px; font-size: .75em; white-space: nowrap; }
.cs-flag[data-flag='best'] { color: #fff; background: var(--ui-success, #2e7d32); }
.cs-flag[data-flag='worst'] { color: #fff; background: var(--ui-danger, #b71c1c); }
.cs-kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 14px; margin: 0; }
.cs-kv dd { margin: 0; font-variant-numeric: tabular-nums; }
.cs-empty { margin: 0; padding: 14px 0; }
.cs-foot { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 12px 20px; font-size: 1.05rem; }
.cs-extra { margin-left: auto; font: inherit; cursor: pointer; }
.cs-note { margin: 8px 0 0; font-size: .9em; opacity: .8; }
.cs-extra-section { margin-top: 22px; }
.cs-pad-hint { flex: none; margin: 0; padding: 4px 20px 0; font-size: .9rem; opacity: .8; }

/* Retro (the Play blade's parchment card): the overlay without .sf-lm */
.cs-overlay:not(.sf-lm) .cs-panel {
  border: 1px solid var(--ui-forest, #1A401C); border-radius: 8px; color: var(--ui-forest, #1A401C); background: var(--ui-old-lace, #F8F5E7);
  box-shadow: 0 20px 60px #000c;
}
.cs-overlay:not(.sf-lm) .cs-head { padding: 14px 22px; border-bottom: 1px solid color-mix(in srgb, var(--ui-forest, #1A401C) 30%, transparent); }
.cs-overlay:not(.sf-lm) .cs-head h2 { font-family: var(--font-display); font-size: 1.8rem; }
.cs-overlay:not(.sf-lm) .cs-close, .cs-overlay:not(.sf-lm) .cs-filter-btn, .cs-overlay:not(.sf-lm) .cs-details, .cs-overlay:not(.sf-lm) .cs-extra {
  min-height: 38px; padding: 0 14px; border: 1px solid var(--ui-forest, #1A401C); border-radius: 4px; color: var(--ui-forest, #1A401C);
  background: color-mix(in srgb, var(--ui-forest, #1A401C) 8%, transparent); font: inherit; cursor: pointer;
}
.cs-overlay:not(.sf-lm) .cs-details { min-height: 30px; padding: 0 10px; }
.cs-overlay:not(.sf-lm) .cs-filter-btn[aria-pressed='true'] { color: var(--ui-old-lace, #F8F5E7); background: var(--ui-forest, #1A401C); }
.cs-overlay:not(.sf-lm) :is(.cs-close, .cs-filter-btn, .cs-details, .cs-extra):focus-visible { outline: 2px solid var(--ui-focus, #ff3b3b); outline-offset: 2px; }
.cs-overlay:not(.sf-lm) .cs-table th, .cs-overlay:not(.sf-lm) .cs-table td { border-bottom: 1px solid color-mix(in srgb, var(--ui-forest, #1A401C) 18%, transparent); }
.cs-overlay:not(.sf-lm) .cs-table thead th { font-size: .9rem; text-transform: uppercase; letter-spacing: .06em; color: color-mix(in srgb, var(--ui-forest, #1A401C) 72%, transparent); }
.cs-overlay:not(.sf-lm) .cs-foot, .cs-overlay:not(.sf-lm) .cs-empty, .cs-overlay:not(.sf-lm) .cs-k { color: color-mix(in srgb, var(--ui-forest, #1A401C) 72%, transparent); }
.cs-overlay:not(.sf-lm) .cs-foot { border-top: 1px solid color-mix(in srgb, var(--ui-forest, #1A401C) 30%, transparent); }
</style>
