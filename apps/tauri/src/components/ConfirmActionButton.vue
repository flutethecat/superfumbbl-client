<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  label: string;
  shortcutCode?: string;
  disabled?: boolean;
  tone?: 'positive' | 'aggressive';
  placement?: 'bar' | 'inline';
  testId?: string;
}>(), {
  shortcutCode: 'Space',
  disabled: false,
  tone: 'positive',
  placement: 'bar',
  testId: undefined,
});

const emit = defineEmits<{ activate: [] }>();

const shortcutLabel = computed(() => {
  if (props.shortcutCode === 'Space') return 'SPACE';
  return props.shortcutCode.replace(/^Key/, '').replace(/^Digit/, '').toUpperCase();
});
const ariaShortcut = computed(() => props.shortcutCode === 'Space' ? 'Space' : shortcutLabel.value);

function onKeydown(event: KeyboardEvent) {
  // A focused native button also synthesizes a click for Space. Consume that
  // default here so the view-level shortcut and the button cannot both fire.
  if (event.code !== 'Space') return;
  event.preventDefault();
  event.stopPropagation();
  if (!props.disabled) emit('activate');
}
</script>

<template>
  <button type="button" class="confirm-action"
    :class="[`tone-${tone}`, `placement-${placement}`]"
    :disabled="disabled" :aria-keyshortcuts="ariaShortcut"
    :data-testid="testId" @click="$emit('activate')" @keydown="onKeydown">
    <span class="confirm-action-label">{{ label }}</span>
    <kbd class="confirm-action-key" aria-hidden="true">{{ shortcutLabel }}</kbd>
    <span class="confirm-action-shortcut-sr">Keyboard shortcut: {{ shortcutLabel }}</span>
  </button>
</template>

<style scoped>
.confirm-action {
  --confirm-shell: linear-gradient(180deg, #46505a 0, #222930 24%, #0a0d11 100%);
  --confirm-well: linear-gradient(180deg, #38573e 0, #203a27 100%);
  --confirm-border: #6e9d75;
  --confirm-key: #ffd166;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: clamp(6px, 1vw, 10px);
  min-height: 42px;
  max-width: calc(100% - 24px);
  padding: 7px 12px;
  color: var(--ui-text);
  border: 3px solid #15191e;
  border-radius: 9px 4px 9px 4px;
  outline: 1px solid #5f6974;
  outline-offset: -5px;
  background: var(--confirm-shell);
  box-shadow: 0 4px 0 #030405, 0 8px 18px #000c, inset 0 2px 0 #818a95;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem);
  font-weight: 900;
  line-height: 1.15;
  text-align: center;
  cursor: pointer;
  user-select: none;
  -webkit-font-smoothing: antialiased;
}

.confirm-action-label {
  min-width: 0;
  padding: 5px 9px;
  border: 1px solid #0a0c0f;
  border-top-color: var(--confirm-border);
  border-radius: 4px;
  background: var(--confirm-well);
  box-shadow: inset 0 2px 5px #000d, 0 1px 0 #8aa58d44;
  overflow-wrap: anywhere;
}

.confirm-action-key {
  flex: 0 0 auto;
  min-width: 48px;
  padding: 4px 8px 3px;
  color: var(--confirm-key);
  border: 1px solid color-mix(in srgb, var(--confirm-key) 78%, #553b00);
  border-bottom-width: 3px;
  border-radius: 5px;
  background: linear-gradient(180deg, #34312a, #15130e);
  box-shadow: inset 0 1px 0 #fff4a344, 0 2px 0 #050608;
  font: inherit;
  font-family: Helvetica, Arial, sans-serif;
  font-size: max(var(--ui-min-text-size, 12px), 0.75em);
  font-weight: 900;
  letter-spacing: 0.08em;
  line-height: 1.05;
}

.confirm-action.tone-aggressive {
  --confirm-well: linear-gradient(180deg, #6b3838 0, #3d1c20 100%);
  --confirm-border: #c56868;
}

.confirm-action.placement-bar {
  position: absolute;
  z-index: 11;
  bottom: 86px;
  left: 50%;
  min-width: min(280px, calc(100% - 24px));
  transform: translateX(-50%);
}

.confirm-action.placement-bar.tone-aggressive { bottom: 130px; }
.confirm-action.placement-inline { width: auto; min-width: min(190px, 100%); }

.confirm-action:hover:not(:disabled) {
  filter: brightness(1.12);
  box-shadow: 0 4px 0 #030405, 0 8px 22px #000e, inset 0 2px 0 #9ba5b0;
}
.confirm-action:focus-visible {
  outline: 3px solid var(--confirm-key);
  outline-offset: 3px;
}
.confirm-action:active:not(:disabled) { translate: 0 2px; box-shadow: 0 2px 0 #030405, 0 5px 12px #000c; }
.confirm-action:disabled {
  color: var(--ui-muted);
  cursor: default;
  filter: grayscale(0.65);
  opacity: 0.52;
}
.confirm-action:disabled .confirm-action-key { color: var(--ui-muted); border-color: var(--ui-border); }

.confirm-action-shortcut-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

:global(.hud-minimalist) .confirm-action {
  border-width: 1px;
  border-radius: 7px;
  outline: none;
  background: rgba(12, 15, 21, 0.9);
  box-shadow: 0 5px 16px #0009;
}

@media (max-width: 620px) {
  .confirm-action.placement-bar { min-width: calc(100% - 24px); }
}
</style>
