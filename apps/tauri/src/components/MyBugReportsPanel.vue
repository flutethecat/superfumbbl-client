<script setup lang="ts">
/**
 * Owner 11-04 (spec-bug-report-updates-2026-11-04.md): "My reports" - the reporter's OWN bug reports (this client's
 * receipts, game/bugReportUpdates.ts): the date, the title (the description's first line), a status chip (Received /
 * In progress / Fixed in 1.0.30X / Closed) and the owner's reply as the server sent it. Nothing about other players.
 *
 * Opening the list marks the shown reports seen (the main screen's notice goes away); the ones that were new stay
 * highlighted while it is open. Refresh sends the one status call again (silent on failure: the list keeps what it had).
 *
 * A modal dialog in the coach stats panel's mould (CoachStatsPanel.vue): focus moves into it, Tab is trapped, Escape and
 * the close button close it, the controller drives it through v-pad-focus (B = close). Modern / Retro: under Settings >
 * Interface style Modern the overlay carries `.sf-lm` and the League Manager panel; Retro keeps the parchment card.
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { settings } from '../game/settings';
import { lmRootClass } from '../game/lmTheme';
import { motionReduced } from '../game/accessibilityModes';
import { PAD_FOCUS_PRIORITY, padFocusControllerMode, vPadFocus } from '../game/cardFocus';
import {
  bugReportUpdates, bugStatusChip, markBugReportsSeen, refreshBugReportStatuses, unseenBugReportIds, type StoredBugReceipt,
} from '../game/bugReportUpdates';
import { t } from '../i18n';

const emit = defineEmits<{ close: [] }>();

const modern = computed(() => settings.uiStyle === 'modern');
const lmClass = computed(() => lmRootClass(settings.uiStyle));
const reduced = computed(() => motionReduced());
/** Newest first. */
const reports = computed(() => [...bugReportUpdates.reports].sort((a, b) => b.submittedAt - a.submittedAt));
const fresh = ref<Set<string>>(new Set());
const refreshFailed = ref(false);

function chipText(entry: StoredBugReceipt): string {
  const chip = bugStatusChip(entry.latest);
  return t(chip.key, chip.params);
}
const chipKind = (entry: StoredBugReceipt): string => entry.latest?.status ?? 'received';
const dateText = (ms: number): string => new Date(ms).toLocaleDateString();

/** Marks what is shown seen, keeping the newly updated ones highlighted for as long as the list is open. */
function noteSeen(): void {
  const now = unseenBugReportIds();
  if (now.size) fresh.value = new Set([...fresh.value, ...now]);
  void markBugReportsSeen();
}

async function refresh(): Promise<void> {
  refreshFailed.value = false;
  const ok = await refreshBugReportStatuses();
  refreshFailed.value = !ok && reports.value.length > 0;
  noteSeen();
}

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
onMounted(() => {
  noteSeen();
  void nextTick(() => closeBtn.value?.focus());
});
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
    <div class="mr-overlay" :class="lmClass" :data-motion="reduced ? 'reduced' : 'full'" data-testid="my-reports-overlay" @click.self="close">
      <section ref="root" v-pad-focus="padOptions" class="mr-panel" :class="{ 'lm-panel': modern }" role="dialog" aria-modal="true"
        aria-labelledby="my-reports-title" data-testid="my-reports-panel" @keydown="onKeydown">
        <header class="mr-head" :class="{ 'hm-band': modern }">
          <h2 id="my-reports-title">{{ t('bugUpdates.panel.title') }}</h2>
          <button type="button" class="mr-btn" :class="{ 'sf-btn small': modern }" data-testid="my-reports-refresh"
            :disabled="bugReportUpdates.checking" @click="refresh">{{ bugReportUpdates.checking ? t('bugUpdates.panel.refreshing') : t('bugUpdates.panel.refresh') }}</button>
          <button ref="closeBtn" type="button" class="mr-btn mr-close" :class="{ 'sf-btn small': modern }" data-pad-cancel
            :aria-label="t('bugUpdates.panel.close')" @click="close">&#x2715;</button>
        </header>

        <div ref="body" class="mr-body" data-testid="my-reports-body">
          <p v-if="refreshFailed" class="mr-note" role="status" data-testid="my-reports-refresh-failed">{{ t('bugUpdates.panel.refreshFailed') }}</p>
          <p v-if="!reports.length" class="mr-empty" data-testid="my-reports-empty">{{ t('bugUpdates.panel.empty') }}</p>
          <ul v-else class="mr-list">
            <li v-for="entry in reports" :key="entry.id" class="mr-item" :data-fresh="fresh.has(entry.id)" data-testid="my-report">
              <div class="mr-line">
                <span class="mr-date">{{ dateText(entry.submittedAt) }}</span>
                <span class="mr-title">{{ entry.title || t('bugUpdates.panel.untitled') }}</span>
                <span v-if="fresh.has(entry.id)" class="mr-new">{{ t('bugUpdates.panel.new') }}</span>
                <span class="mr-chip" :class="{ 'sf-chip': modern }" :data-status="chipKind(entry)" data-testid="my-report-status">{{ chipText(entry) }}</span>
              </div>
              <blockquote v-if="entry.latest?.reply" class="mr-reply" data-testid="my-report-reply">
                <span class="mr-k">{{ t('bugUpdates.panel.reply') }}</span>
                <span class="mr-reply-text">{{ entry.latest.reply }}</span>
              </blockquote>
            </li>
          </ul>
        </div>

        <p v-if="padHint" class="mr-pad-hint">{{ t('coachStats.panel.padScrollHint') }}</p>
        <footer class="mr-foot">{{ t('bugUpdates.panel.footer') }}</footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.mr-overlay { position: fixed; inset: 0; z-index: 210; display: flex; align-items: center; justify-content: center; padding: 3vh 16px; background: #05070cc8; }
.mr-overlay[data-motion='full'] .mr-panel { animation: mr-in 160ms ease-out; }
@keyframes mr-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .mr-overlay .mr-panel { animation: none !important; } }
:global(html.sf-reduce-motion) .mr-panel { animation: none !important; }

.mr-panel { box-sizing: border-box; display: flex; flex-direction: column; width: min(760px, 100%); max-height: 92vh; overflow: hidden; }
.mr-head { display: flex; align-items: center; gap: 12px; flex: none; }
.mr-head h2 { flex: 1 1 auto; min-width: 0; margin: 0; }
.mr-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 16px 16px; }
.mr-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.mr-item { padding: 10px 12px; border-radius: 4px; }
.mr-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.mr-date { flex: none; font-variant-numeric: tabular-nums; opacity: .8; }
.mr-title { flex: 1 1 200px; min-width: 0; overflow-wrap: anywhere; font-weight: 600; }
.mr-new { flex: none; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.mr-chip { flex: none; padding: 1px 8px; border-radius: 999px; font-size: 12px; white-space: nowrap; }
.mr-reply { margin: 8px 0 0; padding: 6px 10px; border-left: 3px solid currentColor; }
.mr-k { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; opacity: .75; }
.mr-reply-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.mr-empty, .mr-note { margin: 0; padding: 8px 0; }
.mr-foot { flex: none; padding: 10px 16px; font-size: 13px; }
.mr-pad-hint { flex: none; margin: 0; padding: 4px 16px 0; font-size: 12px; opacity: .8; }

/* Retro (the Play blade's parchment card): the overlay without .sf-lm */
.mr-overlay:not(.sf-lm) .mr-panel {
  border: 1px solid var(--ui-forest, #1A401C); border-radius: 8px; color: var(--ui-forest, #1A401C); background: var(--ui-old-lace, #F8F5E7);
  box-shadow: 0 20px 60px #000c;
}
.mr-overlay:not(.sf-lm) .mr-head { padding: 12px 18px; border-bottom: 1px solid color-mix(in srgb, var(--ui-forest, #1A401C) 30%, transparent); }
.mr-overlay:not(.sf-lm) .mr-head h2 { font-family: var(--font-display); font-size: 24px; }
.mr-overlay:not(.sf-lm) .mr-btn {
  min-height: 32px; padding: 0 12px; border: 1px solid var(--ui-forest, #1A401C); border-radius: 4px; color: var(--ui-forest, #1A401C);
  background: color-mix(in srgb, var(--ui-forest, #1A401C) 8%, transparent); font: inherit; cursor: pointer;
}
.mr-overlay:not(.sf-lm) .mr-btn:disabled { opacity: .6; cursor: default; }
.mr-overlay:not(.sf-lm) .mr-btn:focus-visible { outline: 2px solid var(--ui-focus, #ff3b3b); outline-offset: 2px; }
.mr-overlay:not(.sf-lm) .mr-item { border: 1px solid color-mix(in srgb, var(--ui-forest, #1A401C) 22%, transparent); }
.mr-overlay:not(.sf-lm) .mr-item[data-fresh='true'] { background: color-mix(in srgb, var(--ui-forest, #1A401C) 8%, transparent); }
.mr-overlay:not(.sf-lm) .mr-chip { border: 1px solid var(--ui-forest, #1A401C); }
.mr-overlay:not(.sf-lm) .mr-chip[data-status='resolved'] { color: #fff; background: var(--ui-success, #2e7d32); border-color: transparent; }
.mr-overlay:not(.sf-lm) .mr-chip[data-status='inProgress'] { color: var(--ui-old-lace, #F8F5E7); background: var(--ui-forest, #1A401C); }
.mr-overlay:not(.sf-lm) :is(.mr-foot, .mr-empty, .mr-note, .mr-date) { color: color-mix(in srgb, var(--ui-forest, #1A401C) 72%, transparent); }
.mr-overlay:not(.sf-lm) .mr-foot { border-top: 1px solid color-mix(in srgb, var(--ui-forest, #1A401C) 30%, transparent); }

/* Modern: the League Manager panel's lines */
.mr-overlay.sf-lm .mr-item { border: 2px solid var(--sf-panel-line); background: var(--ui-surface-2); }
.mr-overlay.sf-lm .mr-item[data-fresh='true'] { border-color: var(--sf-gold); }
.mr-overlay.sf-lm .mr-new { color: var(--sf-gold); }
.mr-overlay.sf-lm .mr-chip[data-status='resolved'] { color: var(--sf-led); border-color: var(--sf-led); }
.mr-overlay.sf-lm .mr-foot { border-top: 2px solid var(--sf-panel-line); opacity: .8; }
</style>
