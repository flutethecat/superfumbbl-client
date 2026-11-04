<script setup lang="ts">
// Owner 11-03 settings reflow (lane B, spec-settings-reflow-2026-11-03.md §1): the "i" on every Settings row. It sits
// in a fixed-width column just left of the control (App.vue `.row` grid), so every "i" in a section lines up.
//  - Text-only rows: a floating tooltip above the "i" (below when there is no room), opening up and to the left so it
//    never covers the control. Hover or keyboard focus shows it, a click pins it, Escape closes it.
//  - Rows with preview images: the "i" (dashed ring) toggles an inline panel under the row with the text and images
//    (owner: "for sections with a screenshot, keep the row").
// Escape reaches us through App.vue's Settings Escape step (settingInfoState.ts): focus returns to the "i".
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, useId, watch } from 'vue';
import { $t } from '../../i18n';
import { claimSettingInfo, releaseSettingInfo, type OpenSettingInfo } from './settingInfoState';

export interface SettingPreview {
  /** File in public/settings-previews/ (flat, unique basename). */
  src: string;
  /** i18n key of the short caption under the image (the variant it shows). */
  captionKey: string;
}

const props = defineProps<{
  /** One or two plain sentences: what the row does. */
  text: string;
  /** The default, shown as "Default: …" (omit when it does not help). */
  def?: string;
  /** Preview images: the row gets the inline panel instead of the tooltip. */
  previews?: readonly SettingPreview[];
}>();

const uid = useId();
const tipId = `sinfo-tip-${uid}`;
const panelId = `sinfo-pop-${uid}`;
const hasPreview = computed(() => !!props.previews?.length);

const btn = ref<HTMLButtonElement | null>(null);
const tip = ref<HTMLElement | null>(null);
const rowLabel = ref('');

const hovered = ref(false);
const focusVisible = ref(false);
const pinned = ref(false);
/** Escape hides a hovered / focused tooltip until the pointer leaves or focus moves (WCAG 1.4.13). */
const dismissed = ref(false);
const panelOpen = ref(false);
const below = ref(false);

const tipShown = computed(() => !hasPreview.value && !dismissed.value && (hovered.value || focusVisible.value || pinned.value));
const showing = computed(() => tipShown.value || panelOpen.value);

const handle: OpenSettingInfo = {
  close(restoreFocus: boolean) {
    pinned.value = false;
    panelOpen.value = false;
    clearHoverTimer();
    // Sol final r2 P2: a pointer that already left (its close was still pending when another "i" took the slot) is
    // gone: finish that cleanup now, or this "i" would stay hovered + dismissed and hide on the next visit.
    if (!pointerInside) hovered.value = false;
    // Sol final r1 P1: dismissed BEFORE focus returns to the "i" - restoring focus must not reopen the help it just
    // closed (the tracker is already cleared, so a second Escape would reach Settings and cancel it). Dismissal is only
    // needed while something would show it again (focus coming back, the pointer still on it, focus still on it); it
    // clears once the pointer leaves or focus moves on.
    dismissed.value = restoreFocus || pointerInside || document.activeElement === btn.value;
    if (restoreFocus) btn.value?.focus();
  },
};

/** The row's own label names the button ("About: Flat pitch"); read from the rendered row so every row stays one tag. */
function readRowLabel(): void {
  const row = btn.value?.closest('.row');
  const label = row?.querySelector('.row-main > span:first-child, .row-label');
  const text = (label?.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text !== rowLabel.value) rowLabel.value = text;
}
onMounted(readRowLabel);
onUpdated(readRowLabel);

const ariaLabel = computed(() => (rowLabel.value
  ? $t('settings.info.aboutRow', { label: rowLabel.value })
  : $t('settings.info.aboutThisSetting')));

/** Sol final r1 P2: hover covers the "i" AND its tooltip (pointer events on, a hover bridge over the gap, CSS), and the
 *  close waits HOVER_CLOSE_MS so the pointer can travel from one to the other. */
const HOVER_CLOSE_MS = 150;
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
function clearHoverTimer(): void { if (hoverTimer !== null) { clearTimeout(hoverTimer); hoverTimer = null; } }
/** Where the pointer really is (the hover state itself lags it by HOVER_CLOSE_MS). */
let pointerInside = false;
function onPointerEnter(): void { pointerInside = true; clearHoverTimer(); if (!hasPreview.value) hovered.value = true; }
function onPointerLeave(): void {
  pointerInside = false;
  clearHoverTimer();
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    hovered.value = false;
    if (!focusVisible.value) dismissed.value = false;
  }, HOVER_CLOSE_MS);
}
function onFocus(): void {
  readRowLabel();
  if (hasPreview.value) return;
  let visible = true;
  try { visible = btn.value?.matches(':focus-visible') ?? true; } catch { /* older engines: any focus shows it */ }
  focusVisible.value = visible;
}
function onBlur(): void { focusVisible.value = false; if (!hovered.value) dismissed.value = false; }
function onClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  dismissed.value = false;
  if (hasPreview.value) panelOpen.value = !panelOpen.value;
  else pinned.value = !pinned.value;
}

/** A pinned tooltip closes on a click anywhere else. */
function onDocPointerDown(event: PointerEvent): void {
  const target = event.target as Node | null;
  if (target && btn.value?.parentElement?.contains(target)) return;
  pinned.value = false;
}

/** Above the "i" unless the scroll pane (or the window) has no room there; then below. */
async function place(): Promise<void> {
  await nextTick();
  const b = btn.value; const t = tip.value;
  if (!b || !t) return;
  const pane = b.closest('.settings-content') ?? b.closest('.settings-pane');
  const top = pane ? pane.getBoundingClientRect().top : 0;
  below.value = b.getBoundingClientRect().top - Math.max(top, 0) < t.offsetHeight + 16;
}

watch(showing, (now) => { if (now) claimSettingInfo(handle); else releaseSettingInfo(handle); });
watch(tipShown, (now) => { if (now) void place(); });
watch(pinned, (now) => {
  if (now) document.addEventListener('pointerdown', onDocPointerDown, true);
  else document.removeEventListener('pointerdown', onDocPointerDown, true);
});
onBeforeUnmount(() => {
  clearHoverTimer();
  document.removeEventListener('pointerdown', onDocPointerDown, true);
  releaseSettingInfo(handle);
});
</script>

<template>
  <span class="sinfo" :class="{ 'has-prev': hasPreview }" @pointerenter="onPointerEnter" @pointerleave="onPointerLeave">
    <button ref="btn" type="button" class="sinfo-btn" data-setting-info
      :data-mode="hasPreview ? 'panel' : 'tooltip'"
      :aria-label="ariaLabel"
      :aria-describedby="hasPreview ? undefined : tipId"
      :aria-expanded="hasPreview ? panelOpen : pinned"
      :aria-controls="hasPreview ? panelId : undefined"
      @focus="onFocus" @blur="onBlur" @click="onClick">i</button>
    <span v-if="!hasPreview" :id="tipId" ref="tip" role="tooltip" class="sinfo-tip"
      :class="{ below }" :data-shown="tipShown" data-setting-info-text>
      {{ text }}<span v-if="def" class="sinfo-def">{{ $t('settings.info.defaultIs', { value: def }) }}</span>
    </span>
  </span>
  <div v-if="hasPreview && panelOpen" :id="panelId" class="sinfo-pop" role="note" data-setting-info-panel>
    <p class="sinfo-pop-text" data-setting-info-text>
      {{ text }}<span v-if="def" class="sinfo-def">{{ $t('settings.info.defaultIs', { value: def }) }}</span>
    </p>
    <div class="sinfo-figs">
      <figure v-for="p in previews" :key="p.src" class="sinfo-fig">
        <img :src="`/settings-previews/${p.src}`" :alt="$t(p.captionKey)" loading="lazy" decoding="async" />
        <figcaption>{{ $t(p.captionKey) }}</figcaption>
      </figure>
    </div>
  </div>
</template>
