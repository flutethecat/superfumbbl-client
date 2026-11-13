<script setup lang="ts">
/** Owner 10-15: a small modal notice card for a seated coach (the match-start beta notice, the declaration watcher's
 *  "Unexpected player switch"). Focus-trapped like the report modal; Enter / Space press the focused button (the
 *  primary by default), Tab cycles the buttons, the controller drives it through v-pad-focus. Escape runs
 *  `escapeIndex` when given, otherwise it is swallowed (a mandatory acknowledgement never falls through to the game's
 *  Escape cascade). Sends nothing itself: the host acts on `choose`. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { vPadFocus } from '../game/cardFocus';

const props = defineProps<{
  title: string;
  text: string;
  buttons: { label: string; primary?: boolean; cancel?: boolean }[];
  /** Escape = this button; null / absent = Escape does nothing. */
  escapeIndex?: number | null;
  testId?: string;
}>();
const emit = defineEmits<{ choose: [index: number] }>();
const buttonEls = ref<HTMLButtonElement[]>([]);
let chosen = false;

function choose(index: number): void {
  if (chosen) return; // a keydown and the native click must not double-fire
  chosen = true;
  emit('choose', index);
}
const primaryIndex = computed(() => Math.max(0, props.buttons.findIndex((b) => b.primary)));
const cancelIndex = computed(() => props.buttons.findIndex((b) => b.cancel));
function focusedIndex(): number {
  const active = document.activeElement;
  const at = buttonEls.value.findIndex((el) => el === active);
  return at >= 0 ? at : primaryIndex.value;
}

// Window capture: the card owns the keyboard while it is up (the game's Space / Enter / Escape handlers never see it).
function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (props.escapeIndex != null) choose(props.escapeIndex);
    return;
  }
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    event.stopPropagation();
    choose(focusedIndex());
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    event.stopPropagation();
    const count = buttonEls.value.length;
    if (count === 0) return;
    const next = (focusedIndex() + (event.shiftKey ? count - 1 : 1)) % count;
    buttonEls.value[next]?.focus();
    return;
  }
  event.stopPropagation(); // Astra r12: no other key reaches the game's shortcuts while the notice is up
}
function onWindowKeyup(event: KeyboardEvent): void { event.stopPropagation(); }
onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown, true);
  window.addEventListener('keyup', onWindowKeyup, true);
  void nextTick(() => buttonEls.value[primaryIndex.value]?.focus());
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown, true);
  window.removeEventListener('keyup', onWindowKeyup, true);
});
const padOptions = computed(() => ({
  exclusive: true, // Astra r12: the modal owns the pad outright (above mandatory server cards, every input swallowed)
  mandatory: cancelIndex.value < 0,
  cancel: cancelIndex.value >= 0 ? () => choose(cancelIndex.value) : null,
  close: 'dismiss' as const, // both uses are client notices (beta notice, "Not now" on the switch-watcher report prompt)
}));
</script>

<template>
  <div class="mn-backdrop" :data-testid="testId">
    <section v-pad-focus="padOptions" class="mn-card" role="dialog" aria-modal="true" :aria-label="title">
      <header class="mn-head">{{ title }}</header>
      <p class="mn-text">{{ text }}</p>
      <footer class="mn-actions">
        <button
          v-for="(button, index) in buttons"
          :key="button.label"
          ref="buttonEls"
          type="button"
          :class="button.primary ? 'mn-primary' : 'mn-secondary'"
          :data-pad-primary="button.primary ? '' : undefined"
          :data-pad-cancel="button.cancel ? '' : undefined"
          @click="choose(index)"
        >{{ button.label }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.mn-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000; /* above every in-game card; below the launch splash (13000) */
  display: grid;
  place-items: center;
  background: #0008;
}
.mn-card {
  width: min(420px, calc(100% - 32px));
  background: var(--ui-surface, #101411);
  border: 2px solid var(--ui-primary, #a10005);
  border-radius: 10px;
  box-shadow: 0 18px 70px #000e, inset 0 0 0 1px #ffffff12;
  color: var(--ui-text, #f2f2ec);
  font-family: Arial, Helvetica, sans-serif;
  overflow: hidden;
}
.mn-head {
  padding: 12px 16px;
  background: var(--ui-surface-2, #171c18);
  border-bottom: 1px solid var(--ui-border, #4a514a);
  color: var(--ui-heading, #ff3b3b);
  font-family: var(--font-display);
  font-size: max(var(--ui-min-primary-text-size, 16px), 20px);
}
.mn-text { margin: 0; padding: 14px 16px; font-size: max(var(--ui-min-text-size, 12px), 14px); line-height: 1.4; }
.mn-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px;
  background: var(--ui-surface-2, #171c18);
}
.mn-actions button { padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: max(var(--ui-min-text-size, 12px), 13px); }
.mn-primary { background: var(--ui-primary, #a10005); color: #fff; border: 1px solid var(--ui-primary, #a10005); }
.mn-secondary { background: transparent; color: var(--ui-text, #f2f2ec); border: 1px solid var(--ui-border, #4a514a); }
.mn-actions button:focus-visible { outline: 2px solid var(--ui-heading, #ff3b3b); outline-offset: 2px; }
</style>
