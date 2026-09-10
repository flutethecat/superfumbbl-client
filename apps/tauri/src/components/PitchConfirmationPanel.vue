<script setup lang="ts">
import type { CSSProperties } from 'vue';

withDefaults(defineProps<{
  title?: string;
  label: string;
  positionStyle?: CSSProperties;
  draggable?: boolean;
  resizable?: boolean;
  compact?: boolean;
  testId?: string;
}>(), {
  title: '',
  positionStyle: undefined,
  draggable: false,
  resizable: false,
  compact: false,
  testId: undefined,
});

defineEmits<{ dragStart: [event: PointerEvent] }>();
</script>

<template>
  <section class="pitch-confirm-panel" :class="{ draggable, resizable, compact }"
    :style="positionStyle" :aria-label="label" :data-testid="testId"
    :title="draggable ? 'Drag to move' : undefined"
    @pointerdown="draggable && $emit('dragStart', $event)">
    <div v-if="title" class="pitch-confirm-title">{{ title }}</div>
    <div class="pitch-confirm-body"><slot /></div>
    <div v-if="$slots.actions" class="pitch-confirm-actions"><slot name="actions" /></div>
  </section>
</template>

<style scoped>
.pitch-confirm-panel {
  position: absolute;
  z-index: 47;
  top: clamp(132px, 18vh, 220px);
  left: 50%;
  transform: translateX(-50%);
  min-width: min(460px, calc(100% - 32px));
  max-width: min(620px, calc(100% - 32px));
  box-sizing: border-box;
  padding: 8px 12px 10px;
  color: var(--ui-text);
  background: rgba(12, 15, 21, 0.94);
  border: 1px solid color-mix(in srgb, var(--ui-accent) 65%, #657080);
  border-radius: 7px;
  box-shadow: 0 7px 20px #000b;
  font-family: 'Nuffle', system-ui, sans-serif;
  text-align: center;
}
.pitch-confirm-panel.compact { min-width: min(360px, calc(100% - 32px)); }
.pitch-confirm-panel.draggable { cursor: move; user-select: none; }
.pitch-confirm-panel.resizable { resize: both; overflow: auto; min-height: 78px; }
.pitch-confirm-title {
  color: var(--ui-heading);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.3rem);
  font-weight: 900;
  letter-spacing: 0.08em;
  line-height: 1.1;
  text-transform: uppercase;
  text-shadow: 0 2px 4px #000;
}
.pitch-confirm-body {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 6px;
  color: var(--ui-text);
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem);
  font-weight: 800;
  white-space: pre-wrap;
}
.pitch-confirm-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 7px;
}
.pitch-confirm-actions :deep(button) {
  min-width: 76px;
  padding: 6px 10px;
  border-radius: 5px;
  font: inherit;
  font-size: max(var(--ui-min-text-size, 12px), 0.78rem);
  font-weight: 800;
  cursor: pointer;
}
.pitch-confirm-actions :deep(button:disabled) { opacity: 0.42; cursor: default; }

/* Console Chrome: layered metal casing and inset command well. */
:global(.hud-chrome) .pitch-confirm-panel {
  padding: 10px 16px 12px;
  border: 3px solid #15191e;
  outline: 2px solid #4c555f;
  outline-offset: -6px;
  border-radius: 9px 4px 9px 4px;
  background:
    linear-gradient(135deg, #ffffff14 0 7%, transparent 7% 92%, #0009 92%),
    linear-gradient(180deg, #555d67 0, #252b32 18%, #090c10 100%);
  box-shadow: 0 5px 0 #030405, 0 10px 24px #000d, inset 0 2px 0 #818a95, inset 0 -4px 0 #11151a;
}
:global(.hud-chrome) .pitch-confirm-body,
:global(.hud-chrome) .pitch-confirm-actions {
  padding: 5px 7px;
  border: 1px solid #0a0c0f;
  border-top-color: #3f4852;
  background: linear-gradient(180deg, #11161c, #06080b);
  box-shadow: inset 0 2px 5px #000d, 0 1px 0 #68717d55;
}
:global(.hud-chrome) .pitch-confirm-actions :deep(button) {
  border-width: 2px;
  box-shadow: inset 0 1px 0 #ffffff55, inset 0 -2px 0 #0008, 0 2px 0 #050608;
}

/* Minimalist: a lighter single-plane card with no console casing. */
:global(.hud-minimalist) .pitch-confirm-panel {
  border-color: color-mix(in srgb, var(--ui-accent) 65%, transparent);
  background: rgba(12, 15, 21, 0.88);
  box-shadow: 0 5px 16px #0009;
}

@media (max-width: 620px) {
  .pitch-confirm-panel { min-width: calc(100% - 24px); }
  .pitch-confirm-body { flex-wrap: wrap; white-space: normal; }
}
</style>
