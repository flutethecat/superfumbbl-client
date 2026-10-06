<script setup lang="ts">
/**
 * Owner 10-02: the Helmet quick-bar pop-out — the END-GAME ROSTER (PostGameRoster.vue, the same component the
 * post-game Roster tab mounts) in a floating window during live play, spectate and replay. The frame copies the
 * popped-out ChatDock: teleported to `body`, ONE fixed box sized to itself (never a viewport-wide layer, so the
 * pitch keeps its input around it), dragged by the header, CSS-resizable. Closed = not rendered at all.
 * Owner 10-02 (v2): the content GROWS with the window (game/rosterPopoutScale.ts). Taller = more rows at the base size
 * until ELEVEN rows are in view; past that every size (header, team switch, rows, portraits, badges, text) scales up
 * evenly so exactly eleven rows fill the list, and players 12+ scroll. Wider allows the scale-up too. The scale is
 * written to --roster-scale on the frame; the scalable PostGameRoster multiplies it into every size.
 * Width / height are written imperatively, never through the reactive style: Vue re-applies every key of a style
 * object on each patch, which would snap a user-resized window back to its default size.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PostGameRoster from './PostGameRoster.vue';
import { clampPanelPosition } from '../game/edgePanelLayout';
import { defaultRosterPosition } from '../game/rosterPopoutLayout';
import { ROSTER_POPOUT_ROWS, rosterPopoutHeightFor, rosterPopoutScale } from '../game/rosterPopoutScale';
import type { PostGameSide, Side } from '../game/postGameProjection';
import type { SkillIconStyle } from '@fumbbl40k/ffb-pitch';

const props = withDefaults(defineProps<{
  teams: { home: PostGameSide; away: PostGameSide } | null;
  portrait: (playerId: string) => string | null;
  helmetIcon: string;
  /** Mirrors the Log panel's opacity setting, like the popped-out chat. */
  opacity?: number;
  /** The local coach's side ("(You)" on the team switch); null for a spectator / replay. */
  localSide?: Side | null;
  /** Owner 10-02: Settings skill display - icons replace the added-skill names. */
  skillMode?: 'icons' | 'markings';
  iconStyle?: SkillIconStyle;
  /** Astra review: Settings is open - the pop-out steps aside (kept open, same spot) so it never covers the modal. */
  suppressed?: boolean;
}>(), { opacity: 0.92, localSide: null, skillMode: 'markings', iconStyle: 'bb3', suppressed: false });
const emit = defineEmits<{ (e: 'close'): void }>();
const side = defineModel<Side>('side', { default: 'home' });

const DEFAULT_W = 520;
/** Owner 10-02: skill icons sit in a four-wide grid - the window opens wider so every row fits four at scale 1. */
const ICONS_W = 620;
const defaultWidth = () => (props.skillMode === 'icons' ? ICONS_W : DEFAULT_W);
const panelEl = ref<HTMLElement | null>(null);
const headEl = ref<HTMLElement | null>(null);
const bodyEl = ref<HTMLElement | null>(null);
// Session-only position (null = the default spot, lower left of the pitch area); the window is a glance surface, not a layout panel.
const pos = ref<{ x: number; y: number } | null>(null);
// Owner 10-06: the default spot (viewport px), recomputed on resize / re-measure while `pos` is null.
const defaultPos = ref<{ x: number; y: number }>({ x: 88, y: 80 });
function updateDefaultPos() {
  if (pos.value || typeof window === 'undefined') return;
  const host = document.querySelector<HTMLElement>('.pitch-host');
  const r = host?.getBoundingClientRect();
  const left = r?.left ?? 0, top = r?.top ?? 0;
  const hostWidth = r && r.width > 0 ? r.width : window.innerWidth;
  const hostHeight = r && r.height > 0 ? r.height : window.innerHeight;
  const panel = panelEl.value;
  const panelWidth = panel && panel.offsetWidth > 0 ? panel.offsetWidth : defaultWidth();
  const panelHeight = panel && panel.offsetHeight > 0 ? panel.offsetHeight : 400;
  const d = defaultRosterPosition({ hostWidth, hostHeight, panelWidth, panelHeight });
  const next = clampPanelPosition({ x: left + d.x, y: top + d.y }, { width: panelWidth, height: panelHeight }, { width: window.innerWidth, height: window.innerHeight });
  if (Math.abs(next.x - defaultPos.value.x) < 0.5 && Math.abs(next.y - defaultPos.value.y) < 0.5) return;
  defaultPos.value = next;
}

const frameStyle = computed(() => {
  const p = pos.value ?? defaultPos.value;
  return {
    left: `${p.x}px`,
    top: `${p.y}px`,
    background: `rgba(20, 22, 26, ${props.opacity})`,
  } as Record<string, string>;
});

// ---- Owner 10-02: grow-with-the-window scaling ----
let scale = 1;
let sized = false; // the frame has its explicit starting height (until then it is content-sized and never scales)
// Astra (roster default spot): the sizes THIS component set; any other observed size is the user dragging the resize grip.
let selfSize: { w: number; h: number } | null = null;
function rememberSelfSize() {
  const panel = panelEl.value;
  if (panel && panel.offsetHeight > 0) selfSize = { w: panel.offsetWidth, h: panel.offsetHeight };
}
/** A user resize from the default spot pins the panel where it is, so the grip follows the cursor instead of the top sliding. */
function pinIfUserResized() {
  const panel = panelEl.value;
  if (pos.value || !sized || !selfSize || !panel || panel.offsetHeight === 0) return;
  if (Math.abs(panel.offsetWidth - selfSize.w) <= 1 && Math.abs(panel.offsetHeight - selfSize.h) <= 1) return;
  const rect = panel.getBoundingClientRect();
  pos.value = { x: rect.left, y: rect.top };
}
let observer: ResizeObserver | null = null;
function parts() {
  const panel = panelEl.value, head = headEl.value, body = bodyEl.value;
  const list = body?.querySelector<HTMLElement>('.pg-roster-list') ?? null;
  const row = list?.querySelector<HTMLElement>('li') ?? null;
  if (!panel || !head || !body || !list || !row || row.offsetHeight <= 0) return null;
  return { panel, head, body, list, row };
}
/** Header, body-minus-list and one row, divided back to scale 1. */
function metricsAt(el: NonNullable<ReturnType<typeof parts>>, s: number) {
  // Owner 10-02: skills now wrap, so a row can be taller than the rest - the 11-row unit is the SHORTEST (unwrapped) row.
  const rowPx = Math.min(...Array.from(el.list.querySelectorAll<HTMLElement>('li')).map((li) => li.offsetHeight).filter((h) => h > 0), el.row.offsetHeight);
  return { headH: el.head.offsetHeight / s, chromeH: (el.body.offsetHeight - el.list.offsetHeight) / s, rowH: rowPx / s };
}
function applyScale() {
  const el = parts();
  if (!el || !sized) return;
  // Measure uncapped: with the eleven-row cap on, the free space under the list would read as chrome and pin the scale.
  el.panel.style.removeProperty('--roster-list-max');
  // A few passes: 1px borders do not scale, so the per-row measure drifts a hair between scales.
  for (let pass = 0; pass < 3; pass++) {
    const next = rosterPopoutScale({ frameHeight: el.panel.clientHeight, frameWidth: el.panel.clientWidth, baseWidth: defaultWidth() - 2, ...metricsAt(el, scale) });
    if (Math.abs(next - scale) < 0.01) break;
    scale = next;
    el.panel.style.setProperty('--roster-scale', String(next));
  }
  // Astra review: a narrow, tall window caps the scale by WIDTH; the list still stops at eleven rows (players 12+ scroll).
  el.panel.style.setProperty('--roster-list-max', `${Math.ceil(ROSTER_POPOUT_ROWS * metricsAt(el, scale).rowH * scale) + 1}px`);
}
/** First layout: start ELEVEN rows tall (fewer when neither team has that many), within the viewport. */
function sizeFrame() {
  if (sized) return;
  const el = parts();
  if (!el) return;
  const rows = Math.max(1, Math.min(ROSTER_POPOUT_ROWS, Math.max(props.teams?.home.roster.length ?? 0, props.teams?.away.roster.length ?? 0)));
  const borders = el.panel.offsetHeight - el.panel.clientHeight;
  const want = rosterPopoutHeightFor(metricsAt(el, 1), rows) + borders;
  el.panel.style.height = `${Math.ceil(Math.min(want, window.innerHeight * 0.9))}px`;
  sized = true;
  rememberSelfSize();
  applyScale();
  updateDefaultPos();
}
watch(() => props.teams, () => { void nextTick(() => { sizeFrame(); applyScale(); }); });
watch(side, () => { void nextTick(applyScale); });
// Astra re-review: icons <-> names changes row heights without resizing the frame - re-measure.
// ...and keep it on screen: the default spot was computed from the other mode's width.
watch(() => props.skillMode, () => { void nextTick(() => { applyScale(); clampToViewport(); }); });

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
    { width: rect?.width ?? defaultWidth(), height: rect?.height ?? 200 },
    { width: window.innerWidth, height: window.innerHeight },
  );
}
function endDrag(event?: PointerEvent) {
  window.removeEventListener('pointermove', onDrag);
  if (event && drag) drag.grip.releasePointerCapture?.(event.pointerId);
  drag = null;
}
function clampToViewport() {
  if (!pos.value) { updateDefaultPos(); return; } // default spot: track the window, never pin it
  const rect = panelEl.value?.getBoundingClientRect();
  if (!rect) return;
  const p = pos.value;
  const next = clampPanelPosition(p, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight });
  if (next.x === p.x && next.y === p.y) return;
  pos.value = next;
}
onMounted(() => {
  window.addEventListener('resize', clampToViewport);
  const panel = panelEl.value;
  if (panel) {
    panel.style.width = `${defaultWidth()}px`;
    panel.style.setProperty('--roster-scale', '1');
    rememberSelfSize();
  }
  updateDefaultPos();
  void nextTick(sizeFrame);
  if (panel && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => { applyScale(); pinIfUserResized(); clampToViewport(); });
    observer.observe(panel);
  }
});
onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  window.removeEventListener('resize', clampToViewport);
  window.removeEventListener('pointermove', onDrag);
  window.removeEventListener('pointerup', endDrag);
  drag = null;
});
</script>

<template>
  <Teleport to="body">
    <div v-show="!suppressed" ref="panelEl" class="roster-popout" role="dialog" aria-label="Roster" data-testid="roster-popout" :style="frameStyle">
      <div ref="headEl" class="roster-popout-head" @pointerdown="startDrag">
        <span class="roster-popout-grip" title="Drag to move" aria-hidden="true">⠿</span>
        <span class="roster-popout-title"><img class="roster-popout-icon" :src="helmetIcon" alt="" /> ROSTER</span>
        <button type="button" class="roster-popout-btn" title="Close (Esc)" aria-label="Close roster" @click="emit('close')">✕</button>
      </div>
      <div ref="bodyEl" class="roster-popout-body">
        <PostGameRoster v-if="teams" v-model:side="side" :teams="teams" :portrait="portrait" :local-side="localSide" scalable
          :skill-mode="skillMode" :icon-style="iconStyle" />
        <p v-else class="roster-popout-empty">No game loaded</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Frame = the popped-out ChatDock (.chat-dock--float): one positioned box, no full-viewport layer. */
.roster-popout {
  position: fixed;
  /* Astra review: above the end-game Dice overlay (.pg-dice-modal 210) - H opens it on every in-game screen. Settings
     (z 100) would sit under it, so the pop-out is hidden (suppressed) while Settings is open. */
  z-index: 215;
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
  padding: calc(2px * var(--roster-scale, 1)) calc(4px * var(--roster-scale, 1));
  cursor: move;
  user-select: none;
  border-bottom: 1px solid var(--ui-border, #3a3f47);
  background: rgba(0, 0, 0, 0.25);
}
.roster-popout-grip { padding: 0 calc(4px * var(--roster-scale, 1)); color: #6a7280; font-size: calc(max(var(--ui-min-primary-text-size, 16px), 0.8rem) * var(--roster-scale, 1)); letter-spacing: -2px; }
.roster-popout-grip:hover { color: #aab2c0; }
.roster-popout-title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: calc(max(var(--ui-min-text-size, 12px), 0.62rem) * var(--roster-scale, 1));
  font-weight: 800;
  letter-spacing: 0.06em;
}
.roster-popout-icon { width: 1.3em; height: 1.3em; object-fit: contain; flex: none; }
.roster-popout-btn {
  flex: 0 0 calc(28px * var(--roster-scale, 1));
  font-size: calc(1em * var(--roster-scale, 1));
  background: transparent;
  color: var(--ui-muted, #98a0ac);
  border: none;
  cursor: pointer;
}
.roster-popout-btn:hover { color: var(--ui-text, #e8ecf2); }
/* Owner 10-02: the body never scrolls itself; the roster's LIST does (the team switch stays put above it). */
.roster-popout-body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; user-select: text; }
.roster-popout-empty { margin: 12px 16px; color: var(--ui-text-dim); font-style: italic; }
</style>
