<script setup lang="ts">
// Owner 2026-07-10: the Developer log panel. A live, filterable view of the client `log()` fires
// (incl. the block/action drop-watchdog notices the owner wanted to watch) and the server-side/
// client-side wire traffic (outbound commands + inbound reports/dialogs/turnMode). Dev-mode only.
import { computed, nextTick, ref, watch } from 'vue';
import { gameStore } from '../game/store';
import { settings } from '../game/settings';

const show = { log: ref(true), out: ref(true), in: ref(true) };
const paused = ref(false);
const listEl = ref<HTMLElement | null>(null);
const expanded = ref<number | null>(null);
const copied = ref(false);

const entries = computed(() =>
  gameStore.state.devLog.filter((e) => (show as Record<string, { value: boolean }>)[e.cat]?.value ?? true),
);

// Auto-scroll to the newest entry unless the owner paused (to read back).
watch(() => gameStore.state.devLog.length, async () => {
  if (paused.value) return;
  await nextTick();
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
});

function clearLog() { gameStore.state.devLog.splice(0); expanded.value = null; }
async function copyAll() {
  const text = entries.value.map((e) => `${e.t} ${e.label}${e.detail ? '  ' + e.detail : ''}`).join('\n');
  try { await navigator.clipboard.writeText(text); copied.value = true; setTimeout(() => (copied.value = false), 1400); } catch { /* clipboard unavailable */ }
}
</script>

<template>
  <div class="dev-panel">
    <div class="dev-head">
      <span class="dev-title">🛠 Developer</span>
      <span class="dev-count">{{ entries.length }}/{{ gameStore.state.devLog.length }}</span>
      <label class="f"><input type="checkbox" v-model="show.log.value" /> log</label>
      <label class="f"><input type="checkbox" v-model="show.out.value" /> →out</label>
      <label class="f"><input type="checkbox" v-model="show.in.value" /> ←in</label>
      <label class="f"><input type="checkbox" v-model="settings.devWireCapture" /> wire</label>
      <span class="spacer"></span>
      <button class="db" :class="{ on: paused }" @click="paused = !paused" :title="paused ? 'Resume auto-scroll' : 'Pause auto-scroll'">{{ paused ? '▶' : '⏸' }}</button>
      <button class="db" @click="copyAll">{{ copied ? '✓' : 'Copy' }}</button>
      <button class="db" @click="clearLog">Clear</button>
      <button class="db close" @click="settings.devPanelOpen = false" title="Close">×</button>
    </div>
    <div ref="listEl" class="dev-list">
      <div v-for="(e, i) in entries" :key="i" class="dev-row" :class="e.cat"
           @click="expanded = expanded === i ? null : i">
        <span class="ts">{{ e.t }}</span>
        <span class="lbl">{{ e.label }}</span>
        <pre v-if="expanded === i && e.detail" class="detail">{{ e.detail }}</pre>
      </div>
      <div v-if="entries.length === 0" class="empty">No events yet — actions, wire traffic, and log fires appear here.</div>
    </div>
  </div>
</template>

<style scoped>
.dev-panel {
  position: fixed; right: 12px; bottom: 12px; z-index: 9000;
  width: 460px; height: 320px; min-width: 300px; min-height: 140px;
  max-width: 92vw; max-height: 80vh; resize: both; overflow: hidden;
  display: flex; flex-direction: column;
  background: rgba(16, 18, 22, 0.96); color: #d8dee9;
  border: 1px solid #3a4250; border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: max(var(--ui-min-text-size, 12px), 11px);
  line-height: 1.45;
}
.dev-head {
  display: flex; align-items: center; gap: 8px; padding: 5px 8px;
  background: #1d222b; border-bottom: 1px solid #3a4250; flex: none; user-select: none;
}
.dev-title { font-weight: 700; color: #8fd0ff; }
.dev-count { color: #7a8494; font-size: max(var(--ui-min-text-size, 12px), 10px); }
.dev-head .f { display: inline-flex; align-items: center; gap: 3px; color: #aeb7c4; cursor: pointer; }
.dev-head .f input { margin: 0; }
.spacer { flex: 1; }
.db { background: #2a313c; color: #d8dee9; border: 1px solid #3a4250; border-radius: 4px;
  padding: 2px 7px; cursor: pointer; font: inherit; }
.db:hover { background: #343c48; }
.db.on { background: #47607a; }
.db.close { font-size: max(var(--ui-min-primary-text-size, 16px), 14px); line-height: 1; padding: 1px 7px; }
.dev-list { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 3px 0; }
.dev-row { padding: 1px 8px; white-space: pre-wrap; word-break: break-word; cursor: pointer; border-left: 2px solid transparent; }
.dev-row:hover { background: rgba(255, 255, 255, 0.04); }
.dev-row .ts { color: #5c6675; margin-right: 6px; }
.dev-row.log { border-left-color: #6aa9ff; }
.dev-row.log .lbl { color: #cfe3ff; }
.dev-row.out { border-left-color: #ffcf6a; }
.dev-row.out .lbl { color: #ffe6ac; }
.dev-row.in { border-left-color: #6ee39a; }
.dev-row.in .lbl { color: #bff3d1; }
.detail { margin: 3px 0 4px 24px; padding: 5px 7px; background: #0d0f13; border: 1px solid #2a313c;
  border-radius: 4px; color: #9aa4b2; white-space: pre-wrap; word-break: break-all; max-height: 160px; overflow: auto; }
.empty { color: #6b7280; padding: 12px; text-align: center; }
</style>
