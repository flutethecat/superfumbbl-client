<script setup lang="ts">
// Touch mode quick menu (spec-touch-mode-2026-11-12 section 7): a small corner button that pops out the client
// functions the quick bar and the keyboard carry with a mouse (tackle zones, roster, game menu, flip pitch, enlarge
// log), plus the other quick-bar buttons so nothing goes missing while the quick bar is hidden in touch mode.
// Every item runs the quick bar's / shortcut's own handler (the view passes them in).
import { computed, ref } from 'vue';
import { $t } from '../i18n';

export interface TouchQuickItem { id: string; label: string; active?: boolean }

const props = withDefaults(defineProps<{ items: TouchQuickItem[]; buttonPx?: number }>(), { buttonPx: 48 });
const emit = defineEmits<{ pick: [id: string] }>();
const open = ref(false);
function pick(id: string): void { open.value = false; emit('pick', id); }
const sizeStyle = computed(() => ({ '--tq-btn': `${Math.max(48, props.buttonPx)}px` }));
</script>

<template>
  <div class="touch-quick" :style="sizeStyle" data-testid="touch-quick-menu" @contextmenu.prevent>
    <button type="button" class="tq-toggle" data-testid="touch-quick-toggle" :aria-expanded="open" :aria-label="$t('hud.touch.quickMenu')"
      @click="open = !open">☰</button>
    <div v-if="open" class="tq-panel" role="menu" data-testid="touch-quick-panel">
      <button v-for="item in items" :key="item.id" type="button" class="tq-item" role="menuitem" :data-quick-item="item.id"
        :data-active="item.active === undefined ? undefined : String(item.active)" @click="pick(item.id)">{{ item.label }}</button>
    </div>
  </div>
</template>

<style scoped>
.touch-quick { position: absolute; top: 8px; right: 8px; z-index: 60; /* above the pre-match phase panels (47) */ display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.tq-toggle, .tq-item {
  min-width: var(--tq-btn); min-height: var(--tq-btn); padding: 0 14px;
  font: inherit; font-size: 15px; font-weight: 600; color: var(--sf-text, #f2f2f2);
  background: var(--sf-panel-bg, rgba(16, 20, 28, 0.92)); border: 1px solid var(--sf-panel-border, rgba(255, 255, 255, 0.22));
  border-radius: 10px; cursor: pointer; touch-action: manipulation;
}
.tq-toggle { font-size: 22px; padding: 0; }
.tq-panel { display: flex; flex-direction: column; gap: 6px; padding: 6px; border-radius: 12px; background: rgba(0, 0, 0, 0.35); }
.tq-item { text-align: left; }
.tq-item[data-active='true'] { border-color: var(--sf-accent, #2f8f4e); box-shadow: inset 0 0 0 2px var(--sf-accent, #2f8f4e); }
</style>
