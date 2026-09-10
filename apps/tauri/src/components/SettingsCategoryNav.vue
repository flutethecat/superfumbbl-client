<script setup lang="ts">
import { nextTick } from 'vue';
import { SETTINGS_SECTIONS, nextSettingsSection, type SettingsTab } from '../game/settingsDialog';

const props = defineProps<{ modelValue: SettingsTab; compact?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [tab: SettingsTab]; contentFocus: [] }>();

function choose(tab: SettingsTab) {
  emit('update:modelValue', tab);
}

function onKeydown(event: KeyboardEvent) {
  const next = nextSettingsSection(props.modelValue, event.key);
  if (!next) return;
  event.preventDefault();
  choose(next);
  void nextTick(() => document.getElementById(`settings-tab-${next}`)?.focus());
}
</script>

<template>
  <label v-if="compact" class="settings-category-select">
    <span>Category</span>
    <select :value="modelValue" aria-label="Settings category"
      @change="choose(($event.target as HTMLSelectElement).value as SettingsTab); emit('contentFocus')">
      <option v-for="section in SETTINGS_SECTIONS" :key="section.id" :value="section.id">{{ section.label }}</option>
    </select>
  </label>
  <aside v-else class="settings-sidebar">
    <h3 id="settings-dialog-title">Settings</h3>
    <nav class="settings-nav" role="tablist" aria-label="Settings categories" aria-orientation="vertical" @keydown="onKeydown">
      <button v-for="section in SETTINGS_SECTIONS" :id="`settings-tab-${section.id}`" :key="section.id"
        type="button" role="tab" :aria-selected="modelValue === section.id"
        :aria-controls="`settings-panel-${section.id}`" :tabindex="modelValue === section.id ? 0 : -1"
        :data-active="modelValue === section.id" @click="choose(section.id)">{{ section.label }}</button>
    </nav>
  </aside>
</template>
