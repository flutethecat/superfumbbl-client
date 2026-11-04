<script setup lang="ts">
// The Field Manual — the ☰ → Help guide. Four pages: console, the six action rails,
// the pre-game show, and deep-links into the settings tabs that matter. Content
// mirrors the published Field Manual tutorial (owner, 2026-08-27).
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { settings } from '../game/settings';
import type { SettingsTab } from '../game/settingsDialog';
import { $t } from '../i18n';
import { RichT } from '../i18n/RichT';
import { t } from '../i18n';

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'play-tutorial'): void;
  (e: 'open-settings', tab: SettingsTab): void;
}>();

const PAGES = ['Your console', 'The six rails', 'Showtime', 'Settings'] as const; // invariant ids (v-for keys)
/** i18n: the tab label of page `i` in the active language. */
function pageLabel(i: number): string {
  return i === 0 ? t('fieldManual.pages.console') : i === 1 ? t('fieldManual.pages.rails') : i === 2 ? t('fieldManual.pages.showtime') : t('fieldManual.pages.settings');
}
const page = ref(0);
const prev = () => { if (page.value > 0) page.value -= 1; };
const next = () => { if (page.value < PAGES.length - 1) page.value += 1; };

// Capture-phase so Esc/arrows never fall through to the SpectateView cascade under an in-game overlay.
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); emit('close'); }
  else if (e.key === 'ArrowLeft') { e.stopImmediatePropagation(); prev(); }
  else if (e.key === 'ArrowRight') { e.stopImmediatePropagation(); next(); }
}
onMounted(() => window.addEventListener('keydown', onKey, { capture: true }));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, { capture: true }));

const RAILS = [
  { n: 'I', get name() { return t('fieldManual.rails.move'); }, get tag() { return t('fieldManual.rails.leftClick'); }, get how() { return t('fieldManual.rails.leftClickYourStanding'); } },
  { n: 'II', get name() { return t('fieldManual.rails.block'); }, get tag() { return t('fieldManual.rails.clickTheTarget'); }, get how() { return t('fieldManual.rails.beforeMovingLeftClick'); } },
  { n: 'III', get name() { return t('fieldManual.rails.blitz'); }, get tag() { return t('fieldManual.rails.oncePerTurn'); }, get how() { return t('fieldManual.rails.rightClickYourPlayer'); } },
  { n: 'IV', get name() { return t('fieldManual.rails.foul'); }, get tag() { return t('fieldManual.rails.menuOnly'); }, get how() { return t('fieldManual.rails.rightClickFoulThen'); } },
  { n: 'V', get name() { return t('fieldManual.rails.passBombThrowTeam'); }, get tag() { return t('fieldManual.rails.twoClickThrow'); }, get how() { return t('fieldManual.rails.declareFromTheMenu'); } },
  { n: 'VI', get name() { return t('fieldManual.rails.specialActions'); }, get tag() { return t('fieldManual.rails.starsSorcery'); }, get how() { return t('fieldManual.rails.starRulesRideThe'); } },
];

const SETTINGS_STOPS: Array<{ tab: SettingsTab; name: string; blurb: string }> = [
  // Owner 11-03 settings reflow: Declare Blitz lives in Controls, the pack manager in Mod Packs.
  { tab: 'controls', get name() { return t('fieldManual.settingsStops.declareBlitz'); }, get blurb() { return t('fieldManual.settingsStops.fumbblDefaultBlitzFrom'); } },
  { tab: 'modpacks', get name() { return t('fieldManual.settingsStops.modPacks'); }, get blurb() { return t('fieldManual.settingsStops.importF40kmodPacksFor'); } },
  { tab: 'accessibility', get name() { return t('fieldManual.settingsStops.accessibility2'); }, get blurb() { return t('fieldManual.settingsStops.textSizeFontColourblind'); } },
];
</script>

<template>
  <div class="fm-backdrop" role="dialog" aria-modal="true" :aria-label="$t('fieldManual.fieldManualHelpGuide')" @click.self="emit('close')">
    <div class="fm-panel">
      <header class="fm-head">
        <div>
          <p class="fm-kick">{{ $t('fieldManual.fmPanel.superFumbblCoachS') }}</p>
          <h1>{{ $t('fieldManual.fmPanel.theFieldManual') }}</h1>
        </div>
        <button class="fm-x" type="button" :aria-label="$t('fieldManual.fmPanel.closeTheFieldManual')" @click="emit('close')">✕</button>
      </header>

      <nav class="fm-tabs" :aria-label="$t('fieldManual.fmPanel.manualPages')">
        <button v-for="(label, i) in PAGES" :key="label" type="button" :data-active="page === i" @click="page = i">
          {{ pageLabel(i) }}
        </button>
      </nav>

      <div class="fm-body">
        <!-- Page 1: the console -->
        <section v-if="page === 0">
          <p class="fm-lede">{{ $t('fieldManual.fmPanel.everythingRidesThePitch') }}</p>
          <ul class="fm-list">
            <li><b>{{ $t('fieldManual.fmPanel.quickBar') }}</b>{{ $t('fieldManual.fmPanel.bottomCornerSettingsTackle') }}</li>
            <li><b>{{ $t('fieldManual.fmPanel.autoDirector') }}</b>{{ $t('fieldManual.fmPanel.tracksTheBallAnd') }} <kbd>WASD</kbd>{{ $t('fieldManual.fmPanel.orTheArrowKeys') }}</li>
            <li><b>{{ $t('fieldManual.fmPanel.logWindow') }}</b>{{ $t('fieldManual.fmPanel.bottomRightThePlay') }}</li>
            <li><b>{{ $t('fieldManual.fmPanel.clickAnyPlayer') }}</b>{{ $t('fieldManual.fmPanel.yoursOrTheirsFor') }}</li>
            <li><b>{{ $t('fieldManual.fmPanel.followTheAction') }}</b>{{ $t('fieldManual.fmPanel.theGoldHaloMarks') }}</li>
            <li><b>{{ $t('fieldManual.fmPanel.endTurnLivesOn') }}</b>{{ $t('fieldManual.fmPanel.neverInAMenu') }} <kbd>Esc</kbd>{{ $t('fieldManual.fmPanel.alwaysWalksTheSame') }}</li>
          </ul>
          <button class="fm-cta" type="button" @click="emit('play-tutorial')">{{ $t('fieldManual.fmPanel.playTheGuidedTour') }}</button>
          <p class="fm-aside">{{ $t('fieldManual.fmPanel.loadsTheDemoMatch') }}</p>
        </section>

        <!-- Page 2: the rails -->
        <section v-else-if="page === 1">
          <p class="fm-lede">{{ $t('fieldManual.fmPanel.everyActionRidesOne') }}
            <b>{{ $t('fieldManual.fmPanel.leftClickActsRight') }}</b>{{ $t('fieldManual.fmPanel.theActionMenuShows') }}</p>
          <div class="fm-rails">
            <article v-for="r in RAILS" :key="r.name" class="fm-rail">
              <div class="fm-rail-head">
                <span class="fm-rail-no">{{ r.n }}</span>
                <h2>{{ r.name }}</h2>
                <span class="fm-tag">{{ r.tag }}</span>
              </div>
              <p>{{ r.how }}</p>
            </article>
          </div>
        </section>

        <!-- Page 3: showtime -->
        <section v-else-if="page === 2">
          <p class="fm-lede">{{ $t('fieldManual.fmPanel.nuffleDemandsTheatreFan') }}</p>
          <ul class="fm-list">
            <li><RichT k="fieldManual.rich.watchLive" /></li>
            <li><RichT k="fieldManual.rich.splashes" /></li>
            <li><RichT k="fieldManual.rich.replays" /></li>
          </ul>
        </section>

        <!-- Page 4: settings deep links -->
        <section v-else>
          <p class="fm-lede"><RichT k="fieldManual.rich.settingsLede" /></p>
          <div class="fm-stops">
            <article v-for="s in SETTINGS_STOPS" :key="s.tab" class="fm-stop">
              <div>
                <h2>{{ s.name }}</h2>
                <p>{{ s.blurb }}</p>
              </div>
              <button type="button" @click="emit('open-settings', s.tab)">{{ $t('fieldManual.fmPanel.open') }}</button>
            </article>
          </div>
        </section>
      </div>

      <footer class="fm-foot">
        <label class="fm-dontshow">
          <input v-model="settings.hideTutorialSplash" type="checkbox" />
          <span>{{ $t('fieldManual.fmPanel.donTShowThis') }}</span>
        </label>
        <div class="fm-pager">
          <button type="button" :disabled="page === 0" @click="prev">{{ $t('fieldManual.fmPanel.back') }}</button>
          <span class="fm-page-ind">{{ page + 1 }} / {{ PAGES.length }}</span>
          <button v-if="page < PAGES.length - 1" type="button" class="fm-next" @click="next">{{ $t('fieldManual.fmPanel.next') }}</button>
          <button v-else type="button" class="fm-next" @click="emit('close')">{{ $t('fieldManual.fmPanel.playYourGame') }}</button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.fm-backdrop {
  position: fixed; inset: 0; z-index: 4000; display: flex; align-items: center; justify-content: center;
  background: rgba(6, 4, 4, 0.78); backdrop-filter: blur(2px); padding: 2vh 12px;
}
.fm-panel {
  width: min(760px, 96vw); max-height: 94vh; display: flex; flex-direction: column;
  background: #151011; border: 1px solid #3a2626; border-top: 3px solid #790004; border-radius: 8px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.7); color: #e9e1d2;
}
.fm-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 1rem 1.3rem 0.4rem; }
.fm-kick {
  margin: 0; font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.18em;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: #d9b356;
}
.fm-head h1 {
  margin: 0.1rem 0 0; font-family: var(--font-display);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.55rem); color: #e9e1d2; line-height: 1.05;
}
.fm-x {
  background: none; border: 1px solid #3a2626; border-radius: 5px; color: #b3a993;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); padding: 0.2rem 0.55rem; cursor: pointer;
}
.fm-x:hover { color: #e9e1d2; border-color: #9e1b1b; }
.fm-tabs { display: flex; gap: 0.35rem; padding: 0.55rem 1.3rem 0; border-bottom: 1px solid #3a2626; flex-wrap: wrap; }
.fm-tabs button {
  background: none; border: none; border-bottom: 3px solid transparent; cursor: pointer;
  font-family: var(--font-display); letter-spacing: 0.06em; text-transform: uppercase;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); color: #b3a993; padding: 0.35rem 0.6rem 0.5rem;
}
.fm-tabs button[data-active='true'] { color: #e9e1d2; border-bottom-color: #9e1b1b; }
.fm-tabs button:hover { color: #e9e1d2; }
.fm-body { overflow-y: auto; padding: 1rem 1.3rem 0.4rem; }
.fm-lede { margin: 0 0 0.8rem; color: #cdc4b1; font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); line-height: 1.55; }
.fm-lede b, .fm-list b { color: #d9b356; }
.fm-list { margin: 0.2rem 0 0.8rem; padding-left: 1.15rem; }
.fm-list li { margin: 0.42rem 0; font-size: max(var(--ui-min-primary-text-size, 16px), 0.92rem); line-height: 1.5; }
kbd {
  font-family: ui-monospace, Consolas, monospace; font-size: max(var(--ui-min-text-size, 12px), 0.85em); background: #1f1717;
  border: 1px solid #3a2626; border-bottom-width: 2px; border-radius: 4px; padding: 0.05em 0.35em;
}
.fm-cta {
  margin-top: 0.4rem; background: #2f6b3e; border: 1px solid #4a8a58; color: #eafbea; border-radius: 6px;
  font-family: var(--font-display); letter-spacing: 0.05em;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); padding: 0.55rem 1.2rem; cursor: pointer;
}
.fm-cta:hover { background: #3a8350; }
.fm-aside { margin: 0.35rem 0 0.6rem; color: #b3a993; font-size: max(var(--ui-min-text-size, 12px), 0.82rem); }
.fm-rails { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 0.8rem; }
.fm-rail { background: #1b1414; border: 1px solid #3a2626; border-left: 4px solid #790004; border-radius: 6px; padding: 0.6rem 0.9rem; }
.fm-rail-head { display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; }
.fm-rail-no { font-family: var(--font-display); color: #9e1b1b; font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem); }
.fm-rail-head h2 {
  margin: 0; font-family: var(--font-display); letter-spacing: 0.04em;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.98rem); color: #e9e1d2;
}
.fm-tag {
  font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.12em;
  font-size: max(var(--ui-min-text-size, 12px), 0.66rem); color: #d9b356;
  border: 1px solid rgba(217, 179, 86, 0.45); border-radius: 3px; padding: 0.08rem 0.45rem;
}
.fm-rail p { margin: 0.4rem 0 0.1rem; color: #cdc4b1; font-size: max(var(--ui-min-primary-text-size, 16px), 0.88rem); line-height: 1.5; }
.fm-stops { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 0.8rem; }
.fm-stop {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  background: #1b1414; border: 1px solid #3a2626; border-radius: 6px; padding: 0.65rem 0.9rem;
}
.fm-stop h2 { margin: 0 0 0.2rem; font-family: var(--font-display); font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); color: #d9b356; }
.fm-stop p { margin: 0; color: #cdc4b1; font-size: max(var(--ui-min-primary-text-size, 16px), 0.86rem); line-height: 1.45; }
.fm-stop > button {
  flex: 0 0 auto; background: #790004; border: 1px solid #9e1b1b; color: #ffe9e9; border-radius: 5px;
  font-family: var(--font-display); letter-spacing: 0.05em;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); padding: 0.45rem 0.9rem; cursor: pointer;
}
.fm-stop > button:hover { background: #9e1b1b; }
.fm-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
  border-top: 1px solid #3a2626; padding: 0.7rem 1.3rem 0.9rem;
}
.fm-dontshow { display: flex; align-items: center; gap: 0.45rem; color: #b3a993; font-size: max(var(--ui-min-text-size, 12px), 0.82rem); cursor: pointer; }
.fm-pager { display: flex; align-items: center; gap: 0.6rem; }
.fm-pager button {
  background: #1f1717; border: 1px solid #3a2626; color: #e9e1d2; border-radius: 5px; cursor: pointer;
  font-family: var(--font-display); letter-spacing: 0.05em;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); padding: 0.45rem 0.9rem;
}
.fm-pager button:disabled { opacity: 0.4; cursor: default; }
.fm-pager button.fm-next { background: #790004; border-color: #9e1b1b; color: #ffe9e9; }
.fm-pager button.fm-next:hover { background: #9e1b1b; }
.fm-page-ind { font-family: var(--font-display); color: #b3a993; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); }
</style>
