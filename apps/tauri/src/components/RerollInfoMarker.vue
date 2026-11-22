<script setup lang="ts">
// Owner 11-21: the small "i" beside a reroll answer that spends a drive bonus reroll (it reads and looks like the Team
// reroll; this names the bonus: "Uses Pump up the Crowd reroll!"). Same idiom as the Settings "i" (SettingInfo.vue):
// hover or keyboard focus shows the tooltip, a click / tap pins it, Escape or a click elsewhere closes it.
// It is NOT a button and sends nothing: a focusable span (tabindex 0) outside the answer button, so a click on it never
// reaches the answer, and the card focus walker (cardFocus.ts PAD_FOCUS_SELECTOR: button, role=button, ...) never
// lists it - controller / hotkey order is unchanged. The tooltip is teleported to <body> and fixed-positioned so no
// card overflow clips it (PlayerDetailSkillList idiom).
// Sol review (P2): the marker sits inside draggable, keyboard-answered cards, so it keeps its input to itself:
//  - a press (pointerdown / mousedown / touchstart) stops here: the card never starts a drag or prevents the marker's
//    focus (SpectateView startReactivePromptDrag), and tap-to-pin still runs on the click;
//  - while its tooltip shows (hover, focus or pinned), a window CAPTURE listener takes Escape wherever focus is: it
//    closes the tooltip and nothing else sees the key (the game handler would decline the reroll: gameMenu); that
//    press stays the marker's until its keyup (auto-repeat included), then the listener is removed (also on window
//    blur and on unmount), so Escape then behaves as before;
//  - with the marker focused, Enter / Space toggle the tooltip and stop there: they never become the card's confirm.
import { computed, onBeforeUnmount, ref, watch } from 'vue';

/** `tag`: a short text badge ("BCR"); `icon`: an image badge (the Leader skill icon); neither = the plain "i".
 *  Owner 11-21: it is drawn as a CORNER BADGE over the top-right of the answer button it belongs to (the caller wraps both
 *  in `.rr-badged`); it stays a sibling of the button, so a press on it never reaches the button. */
const props = defineProps<{ text: string; tag?: string; icon?: string }>();

const el = ref<HTMLElement | null>(null);
const hovered = ref(false);
const focused = ref(false);
const pinned = ref(false);
const pos = ref<{ left: number; top: number; below: boolean }>({ left: 0, top: 0, below: false });
const shown = computed(() => hovered.value || focused.value || pinned.value);

function place(): void {
  const r = el.value?.getBoundingClientRect();
  if (!r) return;
  const below = r.top < 48;
  pos.value = { left: r.left + r.width / 2, top: below ? r.bottom + 6 : r.top - 6, below };
}
function onDocPointerDown(event: PointerEvent): void {
  if (el.value && event.target instanceof Node && el.value.contains(event.target)) return;
  pinned.value = false;
  document.removeEventListener('pointerdown', onDocPointerDown, true);
}
function show(kind: 'hover' | 'focus'): void {
  place();
  if (kind === 'hover') hovered.value = true; else focused.value = true;
}
function toggle(): void {
  place();
  pinned.value = !pinned.value;
  if (pinned.value) document.addEventListener('pointerdown', onDocPointerDown, true);
  else document.removeEventListener('pointerdown', onDocPointerDown, true);
}
function close(): void {
  pinned.value = false; hovered.value = false; focused.value = false;
  document.removeEventListener('pointerdown', onDocPointerDown, true);
}
// Sol review (P2, round 2): the Escape PRESS that closes the tooltip stays the marker's until its keyup - the auto-repeat
// keydowns of that same press would otherwise reach the game handler and decline the reroll. The hold is released on
// that keyup, on window blur (the keyup may never come) and on unmount; in no other state is Escape swallowed.
const holdingEscape = ref(false);
let listening = false;
function syncKeyListeners(): void {
  const want = shown.value || holdingEscape.value;
  if (want === listening) return;
  listening = want;
  if (want) {
    window.addEventListener('keydown', onWindowEscape, true);
    window.addEventListener('keyup', onWindowEscapeUp, true);
    window.addEventListener('blur', releaseEscape);
  } else {
    window.removeEventListener('keydown', onWindowEscape, true);
    window.removeEventListener('keyup', onWindowEscapeUp, true);
    window.removeEventListener('blur', releaseEscape);
  }
}
function onWindowEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (shown.value) {
    holdingEscape.value = true;
    close();
  }
}
function onWindowEscapeUp(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !holdingEscape.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  releaseEscape();
}
function releaseEscape(): void {
  holdingEscape.value = false;
}
watch([shown, holdingEscape], syncKeyListeners, { flush: 'sync' });
function onOwnKey(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) toggle();
}
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true);
  close();
  holdingEscape.value = false;
  window.removeEventListener('keydown', onWindowEscape, true);
  window.removeEventListener('keyup', onWindowEscapeUp, true);
  window.removeEventListener('blur', releaseEscape);
  listening = false;
});
</script>

<template>
  <span ref="el" class="rr-info" :class="{ 'rr-info-tag': !!props.tag && !props.icon, 'rr-info-icon': !!props.icon }" tabindex="0" role="note"
    :aria-label="props.text" data-testid="reroll-info-marker"
    @pointerenter="show('hover')" @pointerleave="hovered = false" @focus="show('focus')" @blur="focused = false"
    @pointerdown.stop @mousedown.stop @touchstart.stop.passive
    @click.stop.prevent="toggle()" @keydown="onOwnKey">
    <img v-if="props.icon" :src="props.icon" alt="" aria-hidden="true" draggable="false" />
    <span v-else aria-hidden="true">{{ props.tag || 'i' }}</span>
    <Teleport to="body">
      <span v-if="shown" class="rr-info-tip" role="tooltip" data-testid="reroll-info-tip" :data-below="pos.below"
        :style="{ left: `${pos.left}px`, top: `${pos.top}px` }">{{ props.text }}</span>
    </Teleport>
  </span>
</template>

<style scoped>
.rr-info {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 14px; height: 14px; margin-left: 2px; align-self: center;
  border-radius: 50%; border: 1px solid currentColor; opacity: 0.85;
  font: italic 700 10px/1 Georgia, 'Times New Roman', serif; cursor: help; user-select: none;
}
.rr-info:hover, .rr-info:focus-visible { opacity: 1; }
/* Owner 11-21: the corner badge (inside `.rr-badged`, SpectateView): over the top-right corner of its button, out of
   the row's layout. The tag respects the minimum text size like the team reroll count chip. */
:global(.rr-badged > .rr-info) {
  position: absolute; top: -6px; right: -6px; z-index: 3; margin: 0;
  background: #0b0b0be6; color: #f4f1e8; border-color: #ffffff59; opacity: 1;
}
.rr-info-tag {
  width: auto; min-width: 14px; height: auto; padding: 1px 3px; border-radius: 4px;
  font: 800 max(var(--ui-min-text-size, 9px), 0.56rem)/1.15 system-ui, sans-serif; font-style: normal; letter-spacing: 0.02em;
}
.rr-info-icon { width: 18px; height: 18px; padding: 0; border-radius: 4px; overflow: hidden; }
.rr-info-icon img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
.rr-info:focus-visible { outline: 2px solid var(--accent, #e8c547); outline-offset: 1px; }
</style>

<style>
/* Teleported to <body>: unscoped. */
.rr-info-tip {
  position: fixed; z-index: 10000; transform: translate(-50%, -100%); pointer-events: none;
  max-width: 260px; padding: 4px 8px; border-radius: 4px;
  background: #111c; color: #fff; font: 600 12px/1.3 system-ui, sans-serif; white-space: normal; text-align: center;
  box-shadow: 0 2px 8px #0008;
}
.rr-info-tip[data-below='true'] { transform: translate(-50%, 0); }
</style>
