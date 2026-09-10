<script setup lang="ts">
/**
 * ChatDock — Pop-Out Chat host (owner ruling 2026-08-17; REBUILT 2026-08-18 after the
 * first build, c692e68f, was reverted at e03b2c83 for two live-verify failures: the
 * pop-out button appeared to do nothing, and the main LOG became unselectable).
 *
 * The rebuild makes both failure modes structurally impossible rather than fixing them:
 *
 *  (1) TELEPORT TARGET CAN NEVER BE MISSING. The old build teleported into an app-owned
 *      element (`#chat-popout-body`) that was rendered LATER in the same template than the
 *      <Teleport> itself — a forward reference. On any render where the popped-out state
 *      was already true (it persists!), Vue resolved the target before it existed, failed
 *      to locate it, and dropped the chat content on the floor. Here the target is
 *      `body`: it exists before the app mounts, is never conditional, and is never
 *      rendered by us at all. There is NO app-owned target element to lose.
 *
 *  (2) NOTHING FULL-VIEWPORT EXISTS IN ANY STATE. The old build wrapped the floating
 *      panel in a `position: fixed; inset: 0` overlay. Here the teleported root IS the
 *      panel: one positioned box the size of the panel. No overlay, no `inset: 0`, no
 *      element that spans the viewport, so nothing can sit over the LOG and interfere
 *      with hit-testing or text selection. The only `user-select: none` in this file is
 *      on the drag header; the body is explicitly `user-select: text`.
 *
 * The chat markup itself lives in the default slot and is owned by the caller — ONE copy
 * of the nodes, moved between docked and floating by the Teleport, never duplicated.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { anchorPanelPosition, persistClampedPanelPosition, resizablePanelStyle, type EdgePanelPosition } from '../game/edgePanelLayout';

const props = defineProps<{
  /** true = floating (teleported to body); false = docked in place. */
  popped: boolean;
  /** Docked visibility only. A popped-out panel is ALWAYS shown (it is its own window). */
  visible: boolean;
  pos: EdgePanelPosition | null;
  size: { w: number; h: number } | null;
  /** Mirrors the Log panel's opacity setting so the float matches the docked look. */
  opacity: number;
}>();

const emit = defineEmits<{
  (e: 'update:pos', v: EdgePanelPosition): void;
  (e: 'update:size', v: { w: number; h: number }): void;
  (e: 'dock'): void;
}>();

const DEFAULT_SIZE = { w: 340, h: 260 };
const MIN_W = 240;
const MIN_H = 140;

const panelEl = ref<HTMLElement | null>(null);
const viewportSize = ref({
  width: typeof window === 'undefined' ? 0 : window.innerWidth,
  height: typeof window === 'undefined' ? 0 : window.innerHeight,
});
const resizeOrigin = ref<{ x: number; y: number } | null>(null);

/** Docked = a plain static flex child (zero positioning). Floating = a fixed-position box
 *  with its OWN bounds — never a viewport-sized layer. */
const floatStyle = computed(() => {
  if (!props.popped) return undefined;
  const size = props.size ?? DEFAULT_SIZE;
  const fallbackX = Math.max(0, viewportSize.value.width - size.w - 24);
  const pos = props.pos ?? { x: fallbackX, y: 120 };
  const projected = resizablePanelStyle(
    pos,
    { width: size.w, height: size.h },
    { width: viewportSize.value.width, height: viewportSize.value.height },
    resizeOrigin.value,
  );
  return {
    ...projected,
    width: `${size.w}px`,
    height: `${size.h}px`,
    background: `rgba(20, 22, 26, ${props.opacity})`,
  } as Record<string, string>;
});

// ---- drag (header only; the chat body keeps normal text selection) ----------------
let drag: { startX: number; startY: number; origX: number; origY: number; grip: HTMLElement } | null = null;

function startDrag(event: PointerEvent) {
  // header buttons (dock) stay clickable
  if ((event.target as HTMLElement | null)?.closest('button')) return;
  const el = panelEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  drag = {
    startX: event.clientX,
    startY: event.clientY,
    origX: rect.left,
    origY: rect.top,
    grip: event.currentTarget as HTMLElement,
  };
  drag.grip.setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', onDrag);
  window.addEventListener('pointerup', endDrag, { once: true });
  event.preventDefault();
}

function onDrag(event: PointerEvent) {
  if (!drag) return;
  const size = panelSize();
  emit('update:pos', anchorPanelPosition(
    { x: drag.origX + event.clientX - drag.startX, y: drag.origY + event.clientY - drag.startY },
    size,
    { width: window.innerWidth, height: window.innerHeight },
  ));
}

function endDrag(event?: PointerEvent) {
  window.removeEventListener('pointermove', onDrag);
  if (event && drag) drag.grip.releasePointerCapture?.(event.pointerId);
  drag = null;
}

function startNativeResize(event: PointerEvent) {
  if (!props.popped || (event.target as HTMLElement | null)?.closest('.chat-dock-head')) return;
  const el = panelEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (event.clientX < rect.right - 18 || event.clientY < rect.bottom - 18) return;
  resizeOrigin.value = { x: rect.left, y: rect.top };
  window.addEventListener('pointerup', finishNativeResize, { once: true });
}

function finishNativeResize() {
  const el = panelEl.value;
  const origin = resizeOrigin.value;
  if (!el || !origin) { resizeOrigin.value = null; return; }
  const rect = el.getBoundingClientRect();
  emit('update:pos', anchorPanelPosition(
    origin,
    { width: rect.width, height: rect.height },
    { width: window.innerWidth, height: window.innerHeight },
  ));
  resizeOrigin.value = null;
}

/** Keep at least a grabbable sliver of the header on screen in both axes. */
function panelSize() {
  const rect = panelEl.value?.getBoundingClientRect();
  const fallback = props.size ?? DEFAULT_SIZE;
  return { width: rect?.width || fallback.w, height: rect?.height || fallback.h };
}

/** One-shot clamp of the PERSISTED rect onto the CURRENT viewport, so a panel saved on a
 *  bigger monitor can never restore off-screen (which would read as "the button did nothing"). */
function clampToViewport() {
  viewportSize.value = { width: window.innerWidth, height: window.innerHeight };
  if (!props.popped) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const size = props.size ?? DEFAULT_SIZE;
  const w = Math.min(size.w, Math.max(MIN_W, vw - 16));
  const h = Math.min(size.h, Math.max(MIN_H, vh - 16));
  if (w !== size.w || h !== size.h) emit('update:size', { w, h });
  const pos = props.pos;
  if (!pos) return;
  persistClampedPanelPosition(
    pos,
    { width: w, height: h },
    { width: vw, height: vh },
    (next) => emit('update:pos', next),
  );
}

// ---- size persistence (CSS `resize: both` on the float) ---------------------------
let sizeObserver: ResizeObserver | null = null;
let sawInitialResize = false;

function observeSize() {
  const el = panelEl.value;
  if (!el || sizeObserver || typeof ResizeObserver === 'undefined') return;
  sawInitialResize = false;
  sizeObserver = new ResizeObserver(() => {
    if (!sawInitialResize) {
      sawInitialResize = true; // the observer's own first callback is the mount size
      return;
    }
    const cur = panelEl.value;
    if (!cur || drag) return;
    const w = Math.min(Math.round(cur.offsetWidth), Math.round(window.innerWidth * 0.9));
    const h = Math.min(Math.round(cur.offsetHeight), Math.round(window.innerHeight * 0.9));
    if (w >= MIN_W && h >= MIN_H) emit('update:size', { w, h });
  });
  sizeObserver.observe(el);
}

function unobserveSize() {
  sizeObserver?.disconnect();
  sizeObserver = null;
}

watch(
  () => props.popped,
  async (popped) => {
    if (!popped) {
      unobserveSize();
      return;
    }
    await nextTick();
    clampToViewport();
    observeSize();
  },
);

onMounted(() => {
  window.addEventListener('resize', clampToViewport);
  if (props.popped) {
    clampToViewport();
    observeSize();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', clampToViewport);
  window.removeEventListener('pointermove', onDrag);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointerup', finishNativeResize);
  drag = null;
  resizeOrigin.value = null;
  unobserveSize();
});

defineExpose({ panelEl });
</script>

<template>
  <!-- to="body": an element guaranteed to exist before the app mounts. `disabled` flips
       docked (renders in place) vs floating (moves to body) — same nodes either way. -->
  <Teleport to="body" :disabled="!popped">
    <div
      ref="panelEl"
      class="chat-dock"
      :class="{ 'chat-dock--float': popped }"
      :style="floatStyle"
      @pointerdown.capture="startNativeResize"
      v-show="popped || visible"
    >
      <div v-if="popped" class="chat-dock-head" @pointerdown="startDrag">
        <span class="chat-dock-grip" title="Drag to move" aria-hidden="true">⠿</span>
        <span class="chat-dock-title"><span class="chat-dock-emoji">💬</span> CHAT</span>
        <button type="button" class="chat-dock-btn" title="Dock back to the panel" @click="emit('dock')">⤓</button>
      </div>
      <div class="chat-dock-body"><slot /></div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Docked: a plain flex child. No position, no z-index, no bounds of its own. */
.chat-dock {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
/* Floating: ONE positioned box, sized to itself. Deliberately NOT wrapped in any
   full-viewport layer — see the header comment (revert cause #2). */
.chat-dock--float {
  position: fixed;
  z-index: 115;
  flex: none;
  box-sizing: border-box;
  border: 1px solid var(--ui-border, #3a3f47);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 18px #000a;
  backdrop-filter: blur(2px);
  resize: both;
  min-width: 240px;
  min-height: 140px;
  max-width: 90vw;
  max-height: 90vh;
}
.chat-dock-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  cursor: move;
  /* the ONLY user-select:none in this component — drag must not select the title */
  user-select: none;
  border-bottom: 1px solid var(--ui-border, #3a3f47);
  background: rgba(0, 0, 0, 0.25);
}
.chat-dock-grip { padding: 0 4px; color: #6a7280; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); letter-spacing: -2px; }
.chat-dock-grip:hover { color: #aab2c0; }
.chat-dock-title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-text-size, 12px), 0.62rem);
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--ui-text, #e8ecf2);
}
.chat-dock-emoji { font-size: max(var(--ui-min-text-size, 12px), 0.72rem); line-height: 1; flex: none; }
.chat-dock-btn {
  flex: 0 0 28px;
  background: transparent;
  color: var(--ui-muted, #98a0ac);
  border: none;
  cursor: pointer;
}
.chat-dock-btn:hover { color: var(--ui-text, #e8ecf2); }
/* Explicit: chat text stays selectable in BOTH states (revert cause #2 was a
   selection regression — this makes selectability a stated property, not a default). */
.chat-dock-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  user-select: text;
}
</style>
