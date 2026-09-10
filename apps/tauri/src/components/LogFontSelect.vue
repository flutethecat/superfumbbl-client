<script setup lang="ts">
import { settings } from '../game/settings';
</script>

<template>
  <label class="log-font-select" title="Log and chat font" @pointerdown.stop @click.stop>
    <select v-model="settings.logFont" aria-label="Log and chat font">
      <option value="nuffle">Nuf</option>
      <option value="arial">Arial</option>
      <option value="mono">Mono</option>
    </select>
  </label>
</template>

<style scoped>
.log-font-select {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  padding: 1px 3px;
  border: 1px solid #4a515b;
  border-radius: 3px;
  background: #101216;
  color: #b8c0ca;
  font: 700 max(var(--ui-min-text-size, 12px), 12px)/1 Arial, Helvetica, sans-serif;
  cursor: default;
}
.log-font-select select {
  width: 48px;
  min-width: 0;
  padding: 1px 12px 1px 2px;
  border: 0;
  border-radius: 2px;
  background: #20242a;
  color: #f3f1eb;
  font: 700 max(var(--ui-min-text-size, 12px), 12px)/1.2 Arial, Helvetica, sans-serif;
  cursor: pointer;
}
.log-font-select:focus-within {
  border-color: #f0c24e;
  box-shadow: 0 0 0 1px #f0c24e55;
}
</style>
