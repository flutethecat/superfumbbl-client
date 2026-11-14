<script setup lang="ts">
// Owner 11-12: the Settings search box. Matches settings from every tab (game/settingsSearch.ts over the index in
// game/settingsSearchIndex.ts); picking a result emits `select` and App.vue switches the tab and reveals the row.
// Escape is not handled here: Settings' own Escape step (App.vue settingsEscape) calls clear() first, so a second
// Escape closes Settings as before.
import { computed, ref, watch } from 'vue';
import { data, t } from '../../i18n';
import { searchSettings, type SettingsSearchGates, type SettingsSearchResult } from '../../game/settingsSearch';
import type { SettingsSearchEntry } from '../../game/settingsSearchIndex';

const props = defineProps<{ gates: SettingsSearchGates }>();
const emit = defineEmits<{ select: [entry: SettingsSearchEntry] }>();

const input = ref<HTMLInputElement | null>(null);
const query = ref('');
const active = ref(0);
const focused = ref(false);
const listId = 'settings-search-results';

const results = computed<SettingsSearchResult[]>(() => searchSettings(query.value, props.gates));
const hasQuery = computed(() => query.value.trim().length > 0);
const open = computed(() => hasQuery.value && focused.value);
const optionId = (i: number): string => `settings-search-option-${i}`;
const activeId = computed(() => (open.value && active.value < results.value.length ? optionId(active.value) : undefined));
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const shortcut = isMac ? data('⌘F') : data('Ctrl+F');

// A new result list (the query changed, or a setting changed which rows Settings shows) starts on its first result, so
// the highlight never points at an option that is gone.
watch(() => results.value.map((r) => r.entry.id).join('\n'), () => { active.value = 0; });
watch(active, (i) => {
  document.getElementById(optionId(i))?.scrollIntoView?.({ block: 'nearest' });
});

function choose(i: number): void {
  const result = results.value[Math.min(i, results.value.length - 1)];
  if (!result) return;
  query.value = '';
  emit('select', result.entry);
}

function onKeydown(event: KeyboardEvent): void {
  // An IME is composing (Chinese, Japanese, ...): Enter / arrows belong to the composition, not to the list.
  if (event.isComposing || event.keyCode === 229) return;
  const count = results.value.length;
  if (!hasQuery.value) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!count) return;
    active.value = (active.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
  } else if (event.key === 'Home' && count && event.ctrlKey) {
    event.preventDefault(); active.value = 0;
  } else if (event.key === 'End' && count && event.ctrlKey) {
    event.preventDefault(); active.value = count - 1;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    choose(active.value);
  }
}

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget as Node | null;
  if (!next || !(event.currentTarget as HTMLElement).contains(next)) focused.value = false;
}

/** True when there was a query to clear (Settings' Escape step stops there). */
function clear(): boolean {
  if (!query.value) return false;
  query.value = '';
  input.value?.focus();
  return true;
}
function focus(): void {
  input.value?.focus();
  input.value?.select();
}
defineExpose({ clear, focus });

/** The excerpt split around its matched word (for the <mark>). */
function excerptParts(r: SettingsSearchResult): [string, string, string] | null {
  const e = r.excerpt;
  if (!e) return null;
  return [e.text.slice(0, e.hitStart), e.text.slice(e.hitStart, e.hitEnd), e.text.slice(e.hitEnd)];
}
</script>

<template>
  <div class="settings-search" role="search" data-testid="settings-search" @focusin="focused = true" @focusout="onFocusOut">
    <span class="settings-search-glyph" aria-hidden="true">⌕</span>
    <input
      ref="input"
      v-model="query"
      class="settings-search-input"
      type="search"
      role="combobox"
      spellcheck="false"
      autocomplete="off"
      aria-autocomplete="list"
      :aria-expanded="open && results.length > 0"
      :aria-controls="listId"
      :aria-activedescendant="activeId"
      :aria-label="t('settings.search.label')"
      :placeholder="t('settings.search.label')"
      :title="t('settings.search.shortcutHint', { shortcut })"
      data-testid="settings-search-input"
      @focus="focused = true"
      @input="focused = true"
      @keydown="onKeydown"
    />
    <kbd class="settings-search-key" aria-hidden="true">{{ shortcut }}</kbd>
    <div v-if="open" class="settings-search-panel">
      <ul v-if="results.length" :id="listId" class="settings-search-list" role="listbox" :aria-label="t('settings.search.results')">
        <li
          v-for="(r, i) in results"
          :id="optionId(i)"
          :key="r.entry.id"
          class="settings-search-option"
          role="option"
          :aria-selected="i === active"
          :data-active="i === active"
          :data-setting-result="r.entry.id"
          @mousedown.prevent
          @mousemove="active = i"
          @click="choose(i)"
        >
          <span class="settings-search-name">{{ r.label }}</span>
          <span class="settings-search-where">{{ r.tabLabel }}<template v-if="r.groupLabel"> › {{ r.groupLabel }}</template></span>
          <span v-if="excerptParts(r)" class="settings-search-excerpt">{{ excerptParts(r)![0] }}<mark>{{ excerptParts(r)![1] }}</mark>{{ excerptParts(r)![2] }}</span>
        </li>
      </ul>
      <p v-else class="settings-search-empty" role="status" data-testid="settings-search-empty">{{ t('settings.search.noResults') }}</p>
    </div>
  </div>
</template>
