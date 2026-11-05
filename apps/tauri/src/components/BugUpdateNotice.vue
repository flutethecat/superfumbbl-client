<script setup lang="ts">
/**
 * Owner 11-04 (spec-bug-report-updates-2026-11-04.md, pick A): the "BUG UPDATE" notice, directly above the main
 * screen's Report button (App.vue: the Modern top bar and the Retro blade ribbon each stack it over their own Report
 * button). It shows while one of the reporter's own reports has a server update they have not seen
 * (game/bugReportUpdates.ts bugUpdatePending); a click opens "My reports" (MyBugReportsPanel.vue), which marks them seen.
 *
 * Controller: like the coach card's "More stats" (CoachCard.vue), the notice sits in a pad scope only while the
 * controller is the active input, one rank above the informational notices so the D-pad / A reach it while it shows;
 * the open list's own scope owns the pad.
 */
import { computed, ref } from 'vue';
import { PAD_FOCUS_PRIORITY, padFocusControllerMode, vPadFocus } from '../game/cardFocus';
import { bugUpdatePending } from '../game/bugReportUpdates';
import MyBugReportsPanel from './MyBugReportsPanel.vue';
import { t } from '../i18n';

const props = defineProps<{ modern: boolean }>();

const open = ref(false);
const padActive = computed(() => padFocusControllerMode());
const padScope = computed(() => ({ priority: PAD_FOCUS_PRIORITY.info + 1, disabled: open.value }));
function openList(): void { open.value = true; }
function closeList(): void { open.value = false; }
</script>

<template>
  <template v-if="bugUpdatePending">
    <span v-if="padActive" v-pad-focus="padScope" class="bug-update-scope" data-testid="bug-update-scope"><button type="button"
      class="bug-update-notice" :class="{ 'sf-btn small': props.modern }" data-testid="bug-update-notice" data-pad-primary aria-haspopup="dialog"
      :aria-expanded="open" :title="t('bugUpdates.notice.title')" @click="openList">{{ t('bugUpdates.notice.label') }}</button></span>
    <button v-else type="button" class="bug-update-notice" :class="{ 'sf-btn small': props.modern }" data-testid="bug-update-notice" aria-haspopup="dialog"
      :aria-expanded="open" :title="t('bugUpdates.notice.title')" @click="openList">{{ t('bugUpdates.notice.label') }}</button>
  </template>
  <MyBugReportsPanel v-if="open" @close="closeList" />
</template>

<style scoped>
.bug-update-scope { display: contents; }
.bug-update-notice {
  box-sizing: border-box; display: block; width: 100%; margin: 0; padding: 2px 8px;
  font: inherit; font-size: 11px; line-height: 1.3; font-weight: 700; letter-spacing: .08em; white-space: nowrap; text-transform: uppercase;
  cursor: pointer;
}
/* Retro (the blade ribbon): an accent tag in the ribbon's colours */
.bug-update-notice:not(.sf-btn) {
  border: 1px solid var(--ui-accent); border-radius: 4px; color: var(--ui-surface-2, #111); background: var(--ui-accent);
}
.bug-update-notice:not(.sf-btn):hover { filter: brightness(1.1); }
.bug-update-notice:focus-visible { outline: 2px solid var(--ui-focus, #ff3b3b); outline-offset: 2px; }
/* Modern: the League Manager small button, tinted gold like the BETA chip */
.bug-update-notice.sf-btn { min-height: 0; color: var(--sf-gold, #e0b04a); border-color: var(--sf-gold, #e0b04a); }
@media (prefers-reduced-motion: no-preference) {
  .bug-update-notice { animation: bug-update-in 200ms ease-out; }
}
:global(html.sf-reduce-motion) .bug-update-notice { animation: none !important; }
@keyframes bug-update-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
</style>
