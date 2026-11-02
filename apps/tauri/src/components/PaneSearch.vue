<script setup lang="ts">
/**
 * Owner 10-16: the Log / Chat search box (right side of the pane's settings bar). A text input, the "N of M" counter
 * and, once there is at least one match, the Older / Newer step buttons. Enter = older match, Shift+Enter = newer,
 * Escape clears and hands focus back to the pane. The input is a text <input>, so the view's keyboard guard
 * (targetOwnsKeys / inputOwnsKey) keeps every game shortcut off while the coach types.
 */
import { ref } from 'vue';
import { $t } from '../i18n';

defineProps<{ modelValue: string; count: number; counter: string }>();
const emit = defineEmits<{ 'update:modelValue': [string]; older: []; newer: []; escape: [] }>();
const input = ref<HTMLInputElement | null>(null);

/** Escape anywhere in the search box (the input or a step button) clears it and hands focus back to the pane. */
function onRootKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return; // an IME is composing: its keys are not ours
  // Enter / Space on a focused step button activate that button only: never a game shortcut (Astra 10-16)
  if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLButtonElement) { event.stopPropagation(); return; }
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  emit('update:modelValue', '');
  (document.activeElement as HTMLElement | null)?.blur?.();
  emit('escape');
}
function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return; // Enter confirming an IME candidate is not a step
  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) emit('newer'); else emit('older');
  }
}
defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <div class="pane-search" data-testid="pane-search" @keydown="onRootKeydown">
    <input ref="input" class="pane-search-input" type="search" :placeholder="$t('hud.paneSearch.search')" :aria-label="$t('hud.paneSearch.search')"
      autocomplete="off" spellcheck="false" :value="modelValue"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" @keydown="onKeydown" />
    <template v-if="count > 0">
      <button type="button" class="pane-search-step" :aria-label="$t('hud.paneSearch.olderMatch')" :title="$t('hud.paneSearch.olderMatchEnter')" @click="emit('older')">▲</button>
      <span class="pane-search-count" aria-live="polite">{{ counter }}</span>
      <button type="button" class="pane-search-step" :aria-label="$t('hud.paneSearch.newerMatch')" :title="$t('hud.paneSearch.newerMatchShiftEnter')" @click="emit('newer')">▼</button>
    </template>
    <span v-else-if="modelValue.trim()" class="pane-search-count" aria-live="polite">{{ counter }}</span>
  </div>
</template>

<style scoped>
.pane-search {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  min-width: 0;
}
.pane-search-input {
  width: 9em;
  min-width: 5em;
  box-sizing: border-box;
  padding: 2px 6px;
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
}
.pane-search-input:focus { outline: 1px solid var(--ui-accent); outline-offset: 0; }
.pane-search-count { white-space: nowrap; opacity: 0.8; font-variant-numeric: tabular-nums; }
.pane-search-step {
  padding: 0 5px;
  line-height: 1.4;
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font-size: 0.85em;
  cursor: pointer;
}
.pane-search-step:hover, .pane-search-step:focus-visible { border-color: var(--ui-accent); }
</style>

<style>
/* Owner 10-16: search marks in the Log / Chat pane (global: the rows belong to several components). A matching row
   gets a thin outline, the current one a stronger one; the matched run is painted through the CSS highlight registry
   (game/paneSearch.ts), which leaves the row markup untouched in every log and chat style. */
/* the rows sit in the pane's row block (.log-rows, owner 11-02) */
.log > .log-rows > [data-search-hit] { outline: 1px solid rgb(255 214 102 / 0.55); outline-offset: -1px; }
.log > .log-rows > [data-search-current] { outline: 2px solid #ffd666; outline-offset: -2px; }
/* a matched emoji / fallback die number: not paintable text, so the element itself is marked */
.log [data-search-mark] { background-color: rgb(255 214 102 / 0.45); border-radius: 3px; }
.log [data-search-mark='current'] { background-color: #ffb300; }
::highlight(pane-search) { background-color: rgb(255 214 102 / 0.45); color: #fff; }
::highlight(pane-search-current) { background-color: #ffb300; color: #000; }
</style>
