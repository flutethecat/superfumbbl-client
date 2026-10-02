<script setup lang="ts">
/**
 * Owner 10-02: the Helmet quick-bar pop-out — the END-GAME ROSTER (PostGameRoster.vue, the same component the
 * post-game Roster tab mounts) in a floating window during live play, spectate and replay. The frame copies the
 * popped-out ChatDock: teleported to `body`, ONE fixed box sized to itself (never a viewport-wide layer, so the
 * pitch keeps its input around it), dragged by the header, CSS-resizable. Closed = not rendered at all.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import PostGameRoster from './PostGameRoster.vue';
import { clampPanelPosition } from '../game/edgePanelLayout';
import type { PostGameSide, Side } from '../game/postGameProjection';

const props = withDefaults(defineProps<{
  teams: { home: PostGameSide; away: PostGameSide } | null;
  portrait: (playerId: string) => string | null;
  helmetIcon: string;
  /** Mirrors the Log panel's opacity setting, like the popped-out chat. */
  opacity?: number;
}>(), { opacity: 0.92 });
const emit = defineEmits<{ (e: 'close'): void }>();
const side = defineModel<Side>('side', { default: 'home' });

const DEFAULT_W = 520;
const panelEl = ref<HTMLElement | null>(null);
// Session-only position (null = the default spot, upper right); the window is a glance surface, not a layout panel.
const pos = ref<{ x: number; y: number } | null>(null);

const frameStyle = computed(() => {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const p = pos.value ?? { x: Math.max(0, vw - DEFAULT_W - 24), y: 80 };
  return {
    left: `${p.x}px`,
    top: `${p.y}px`,
    width: `${DEFAULT_W}px`,
    background: `rgba(20, 22, 26, ${props.opacity})`,
  } as Record<string, string>;
});

let drag: { startX: number; startY: number; origX: number; origY: number; grip: HTMLElement } | null = null;
function startDrag(event: PointerEvent) {
  if ((event.target as HTMLElement | null)?.closest('button')) return; // the close button stays clickable
  const el = panelEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  drag = { startX: event.clientX, startY: event.clientY, origX: rect.left, origY: rect.top, grip: event.currentTarget as HTMLElement };
  drag.grip.setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', onDrag);
  window.addEventListener('pointerup', endDrag, { once: true });
  event.preventDefault();
}
function onDrag(event: PointerEvent) {
  if (!drag) return;
  const rect = panelEl.value?.getBoundingClientRect();
  pos.value = clampPanelPosition(
    { x: drag.origX + event.clientX - drag.startX, y: drag.origY + event.clientY - drag.startY },
    { width: rect?.width ?? DEFAULT_W, height: rect?.height ?? 200 },
    { width: window.innerWidth, height: window.innerHeight },
  );
}
function endDrag(event?: PointerEvent) {
  window.removeEventListener('pointermove', onDrag);
  if (event && drag) drag.grip.releasePointerCapture?.(event.pointerId);
  drag = null;
}
function clampToViewport() {
  const p = pos.value;
  const rect = panelEl.value?.getBoundingClientRect();
  if (!p || !rect) return;
  pos.value = clampPanelPosition(p, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight });
}
onMounted(() => window.addEventListener('resize', clampToViewport));
onBeforeUnmount(() => {
  window.removeEventListener('resize', clampToViewport);
  window.removeEventListener('pointermove', onDrag);
  window.removeEventListener('pointerup', endDrag);
  drag = null;
});
</script>

<template>
  <Teleport to="body">
    <div ref="panelEl" class="roster-popout" role="dialog" aria-label="Roster" data-testid="roster-popout" :style="frameStyle">
      <div class="roster-popout-head" @pointerdown="startDrag">
        <span class="roster-popout-grip" title="Drag to move" aria-hidden="true">⠿</span>
        <span class="roster-popout-title"><img class="roster-popout-icon" :src="helmetIcon" alt="" /> ROSTER</span>
        <button type="button" class="roster-popout-btn" title="Close (Esc)" aria-label="Close roster" @click="emit('close')">✕</button>
      </div>
      <div class="roster-popout-body">
        <PostGameRoster v-if="teams" v-model:side="side" :teams="teams" :portrait="portrait" />
        <p v-else class="roster-popout-empty">No game loaded</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Frame = the popped-out ChatDock (.chat-dock--float): one positioned box, no full-viewport layer. */
.roster-popout {
  position: fixed;
  z-index: 115;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  border: 1px solid var(--ui-border, #3a3f47);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 18px #000a;
  backdrop-filter: blur(2px);
  resize: both;
  min-width: 320px;
  min-height: 160px;
  max-width: 90vw;
  max-height: 90vh;
  color: var(--ui-text, #e8ecf2);
}
.roster-popout-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  cursor: move;
  user-select: none;
  border-bottom: 1px solid var(--ui-border, #3a3f47);
  background: rgba(0, 0, 0, 0.25);
}
.roster-popout-grip { padding: 0 4px; color: #6a7280; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); letter-spacing: -2px; }
.roster-popout-grip:hover { color: #aab2c0; }
.roster-popout-title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-text-size, 12px), 0.62rem);
  font-weight: 800;
  letter-spacing: 0.06em;
}
.roster-popout-icon { width: 1.3em; height: 1.3em; object-fit: contain; flex: none; }
.roster-popout-btn {
  flex: 0 0 28px;
  background: transparent;
  color: var(--ui-muted, #98a0ac);
  border: none;
  cursor: pointer;
}
.roster-popout-btn:hover { color: var(--ui-text, #e8ecf2); }
.roster-popout-body { flex: 1; min-height: 0; overflow-y: auto; user-select: text; }
.roster-popout-empty { margin: 12px 16px; color: var(--ui-text-dim); font-style: italic; }
</style>
