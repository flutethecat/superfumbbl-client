<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { gameStore } from '../game/store';
import { REPLAY_SPEED_LABELS, type ReplaySpeed } from '../game/replay/replayController';
import type { ReviewControlsBinding } from '../game/replay/reviewControlsBinding';
import { settings } from '../game/settings';
import { anchorPanelPosition, dodgePanelObstacle, edgePanelStyle, persistClampedPanelPosition } from '../game/edgePanelLayout';

const props = defineProps<{ review?: ReviewControlsBinding }>();
const replaySpeedOptions = REPLAY_SPEED_LABELS.flatMap((label, index) =>
  index === 1 || index === 6 ? [] : [{ label, value: index as ReplaySpeed }],
);

const status = computed(() => props.review?.status ?? gameStore.replay.status);
const ready = computed(() => status.value.phase === 'ready' && !props.review?.pinned);
const minimum = computed(() => props.review?.minimum ?? 0);
const speed = computed(() => props.review?.speed ?? gameStore.replay.speed);
const playing = computed(() => props.review?.playing ?? gameStore.replay.playing);
const canPlay = computed(() => ready.value && status.value.cursor < status.value.total);
const turnMarkers = computed(() => props.review?.turnMarkers ?? gameStore.replay.status.turnMarkers);
function turnMarkerKey(marker: (typeof turnMarkers.value)[number]): string {
  return `${marker.cursor}:${marker.boundary}:${marker.side}:${marker.turn}:${marker.half}`;
}
const selectedTurnMarker = computed(() => turnMarkers.value
  .filter((marker) => marker.cursor <= status.value.cursor).at(-1) ?? null);
const panelEl = ref<HTMLElement | null>(null);
const defaultPosition = ref<{ x: number; y: number } | null>(null);
const panelStyle = computed(() => ({
  ...(settings.replayControlsPos ? { ...edgePanelStyle(settings.replayControlsPos), transform: 'none' } : defaultPosition.value ? { left: defaultPosition.value.x + 'px', top: defaultPosition.value.y + 'px', bottom: 'auto', transform: 'none' } : {}),
  ...(settings.replayControlsSize ? {
    width: `${settings.replayControlsSize.w}px`,
    minHeight: `${settings.replayControlsSize.h}px`,
  } : {}),
}));

function onTransportKeydown(event: KeyboardEvent): void {
  // Native buttons, slider and selects keep their own keyboard semantics.
  if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code === 'Space') {
    if (playing.value || canPlay.value) { event.preventDefault(); togglePlayback(); }
  } else if (ready.value && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    if (direction < 0 ? status.value.cursor <= minimum.value : status.value.cursor >= status.value.total) return;
    event.preventDefault();
    if (event.shiftKey) {
      if (props.review) void props.review.turn(direction);
      else if (direction < 0) void gameStore.replayTurnBackward();
      else void gameStore.replayTurnForward();
    } else if (direction > 0) void stepForward();
    else if (props.review) void props.review.stepBackward();
    else void gameStore.replayCommandBackward();
  }
}
function panelHost(): HTMLElement | null {
  return panelEl.value?.offsetParent as HTMLElement | null;
}

function panelMetrics() {
  const panel = panelEl.value;
  const host = panelHost();
  if (!panel || !host) return null;
  const panelRect = panel.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  return {
    panel, host,
    panelRect, hostRect,
    position: { x: panelRect.left - hostRect.left, y: panelRect.top - hostRect.top },
    size: { width: panelRect.width, height: panelRect.height },
    viewport: { width: hostRect.width, height: hostRect.height },
  };
}

let drag: { startX: number; startY: number; x: number; y: number; grip: HTMLElement } | null = null;
function startDrag(event: PointerEvent): void {
  const m = panelMetrics();
  if (!m) return;
  drag = { startX: event.clientX, startY: event.clientY, x: m.position.x, y: m.position.y, grip: event.currentTarget as HTMLElement };
  drag.grip.setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', endDrag, { once: true });
  event.preventDefault();
}
function moveDrag(event: PointerEvent): void {
  if (!drag) return;
  const m = panelMetrics();
  if (!m) return;
  settings.replayControlsPos = anchorPanelPosition(
    { x: drag.x + event.clientX - drag.startX, y: drag.y + event.clientY - drag.startY },
    m.size, m.viewport,
  );
}
function endDrag(event?: PointerEvent): void {
  window.removeEventListener('pointermove', moveDrag);
  if (event && drag) drag.grip.releasePointerCapture?.(event.pointerId);
  drag = null;
}

let resizing: { startX: number; startY: number; w: number; h: number } | null = null;
function startResize(event: PointerEvent): void {
  const m = panelMetrics();
  if (!m) return;
  settings.replayControlsPos = anchorPanelPosition(m.position, m.size, m.viewport);
  resizing = { startX: event.clientX, startY: event.clientY, w: m.size.width, h: m.size.height };
  window.addEventListener('pointermove', moveResize);
  window.addEventListener('pointerup', endResize, { once: true });
  event.preventDefault();
  event.stopPropagation();
}
function moveResize(event: PointerEvent): void {
  if (!resizing) return;
  const m = panelMetrics();
  if (!m) return;
  const maxWidth = Math.max(240, m.viewport.width - 16);
  const maxHeight = Math.max(48, m.viewport.height - 16);
  const minWidth = Math.min(420, maxWidth);
  const minHeight = Math.min(64, maxHeight);
  settings.replayControlsSize = {
    w: Math.round(Math.min(Math.max(minWidth, resizing.w + event.clientX - resizing.startX), maxWidth)),
    h: Math.round(Math.min(Math.max(minHeight, resizing.h + event.clientY - resizing.startY), maxHeight)),
  };
}
function endResize(): void {
  window.removeEventListener('pointermove', moveResize);
  resizing = null;
  clampPanel();
}
function clampPanel(): void {
  const m = panelMetrics();
  if (!m) return;
  if (!settings.replayControlsPos) {
    const telestrator = m.host.querySelector('.telestrator-tools') as HTMLElement | null;
    const telestratorRect = telestrator?.getBoundingClientRect();
    let position = telestratorRect ? {
      x: telestratorRect.left - m.hostRect.left - m.size.width - 4,
      y: telestratorRect.bottom - m.hostRect.top - m.size.height,
    } : { x: (m.viewport.width - m.size.width) / 2, y: m.viewport.height - m.size.height - 18 };
    position = {
      x: Math.max(8, Math.min(position.x, m.viewport.width - m.size.width - 8)),
      y: Math.max(8, Math.min(position.y, m.viewport.height - m.size.height - 8)),
    };
    const selectors = '.config-bar, .quick-match-controls, .log-panel';
    const obstacles = Array.from(m.host.querySelectorAll<HTMLElement>(selectors)).map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left - m.hostRect.left, y: rect.top - m.hostRect.top, width: rect.width, height: rect.height };
    }).sort((a, b) => b.y - a.y);
    for (const obstacle of obstacles) {
      const overlaps = position.x < obstacle.x + obstacle.width + 10 && position.x + m.size.width > obstacle.x - 10
        && position.y < obstacle.y + obstacle.height + 10 && position.y + m.size.height > obstacle.y - 10;
      if (!overlaps) continue;
      if (obstacle.y >= m.size.height + 10) position.y = obstacle.y - m.size.height - 10;
      else position = dodgePanelObstacle(position, m.size, obstacle, m.viewport, 10);
    }
    if (defaultPosition.value?.x !== position.x || defaultPosition.value?.y !== position.y) defaultPosition.value = position;
    return;
  }
  persistClampedPanelPosition(settings.replayControlsPos, m.size, m.viewport, (next) => {
    settings.replayControlsPos = next;
  });
}

let disposed = false;
let layoutObserver: ResizeObserver | null = null;
let layoutFrame: number | null = null;
function scheduleLayout() {
  if (layoutFrame !== null) return;
  layoutFrame = requestAnimationFrame(() => { layoutFrame = null; clampPanel(); });
}
onMounted(async () => {
  window.addEventListener('resize', scheduleLayout);
  await nextTick();
  if (disposed) return;
  clampPanel();
  if (typeof ResizeObserver !== 'undefined' && panelEl.value) {
    layoutObserver = new ResizeObserver(scheduleLayout);
    layoutObserver.observe(panelEl.value);
    const host = panelHost();
    if (host) {
      layoutObserver.observe(host);
      host.querySelectorAll('.quick-match-controls, .config-bar').forEach(element => layoutObserver!.observe(element));
      const telestrator = host.querySelector('.telestrator-tools');
      if (telestrator) layoutObserver.observe(telestrator);
    }
  }
});
onBeforeUnmount(() => {
  props.review?.endScrub();
  window.removeEventListener('resize', scheduleLayout);
  layoutObserver?.disconnect();
  if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
  window.removeEventListener('pointermove', moveDrag);
  window.removeEventListener('pointermove', moveResize);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointerup', endResize);
  drag = null;
  resizing = null;
});
function stepForward(): void {
  void (props.review ? props.review.stepForward() : gameStore.replayCommandForward()).catch(() => undefined); // replay status renders the failure
}
function togglePlayback(): void {
  if (props.review) { if (playing.value) props.review.pause(); else props.review.play(); return; }
  if (playing.value) gameStore.replayPause();
  else gameStore.replayPlay();
}
function changeSpeed(event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value) as ReplaySpeed;
  if (props.review) props.review.setSpeed(value); else gameStore.replaySetSpeed(value);
}
function seek(sequence: number): void {
  if (props.review) void props.review.seek(sequence); else gameStore.replaySeek(sequence);
}
function selectTurn(event: Event): void {
  const key = (event.target as HTMLSelectElement).value;
  const marker = turnMarkers.value.find((candidate) => turnMarkerKey(candidate) === key);
  if (marker) seek(marker.cursor);
}
function openRecentHistory(): void {
  const segment = props.review?.segments.at(-1);
  if (segment) void props.review!.selectSegment(segment.id);
}
</script>

<template>
  <div ref="panelEl" class="replay-controls" :style="panelStyle" :data-playing="playing" :data-state="status.phase" role="toolbar" tabindex="0" aria-label="Replayer controls" aria-keyshortcuts="Space ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight" @keydown.stop="onTransportKeydown" @pointerdown.stop @contextmenu.stop.prevent>
    <button type="button" class="replay-grip" title="Drag replay controls" aria-label="Drag replay controls" @pointerdown="startDrag">⠿</button>
    <div class="replay-control-group transport-controls">
      <button class="transport-icon" :disabled="!ready || status.cursor <= minimum" title="Previous turn" aria-label="Previous turn" @click="props.review ? props.review.turn(-1) : gameStore.replayTurnBackward()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 5-7 7 7 7m9-14-7 7 7 7" /></svg>
      </button>
      <button class="transport-icon" :disabled="!ready || status.cursor <= minimum" title="Previous step" aria-label="Previous step" @click="props.review ? props.review.stepBackward() : gameStore.replayCommandBackward()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
      </button>
      <button class="transport-icon transport-primary" :disabled="!playing && !canPlay" :aria-pressed="playing"
        :title="playing ? 'Pause' : 'Play'" :aria-label="playing ? 'Pause' : 'Play'" @click="togglePlayback">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="playing" class="transport-fill" d="M6 5h4v14H6zm8 0h4v14h-4z" /><path v-else class="transport-fill" d="m8 4 12 8-12 8z" /></svg>
      </button>
      <button class="transport-icon" :disabled="!ready || status.cursor >= status.total" title="Next step" aria-label="Next step" @click="stepForward">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>
      <button class="transport-icon" :disabled="!ready || status.cursor >= status.total" title="Next turn" aria-label="Next turn" @click="props.review ? props.review.turn(1) : gameStore.replayTurnForward()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 5 7 7-7 7m9-14 7 7-7 7" /></svg>
      </button>
    </div>
    <!-- Owner 09-09: the Turns jump list stands alone at control height; the tick COUNTER sits under the progress
         bar (same width), the pair vertically centred against the single-height controls beside it. -->
    <div class="replay-position-stack">
      <label class="replay-turn-select">
        <span class="sr-only">Jump to recorded turn boundary</span>
        <select :disabled="!ready || turnMarkers.length === 0" :value="selectedTurnMarker ? turnMarkerKey(selectedTurnMarker) : ''"
          aria-label="Jump to recorded turn boundary" @change="selectTurn">
          <option value="" disabled>Turns</option>
          <option v-for="marker in turnMarkers" :key="turnMarkerKey(marker)" :value="turnMarkerKey(marker)">{{ marker.label }}</option>
        </select>
      </label>
    </div>
    <div class="replay-scrubber-stack">
      <label class="replay-scrubber">
        <span class="sr-only">Replay position</span>
        <input :disabled="!ready" type="range" :min="minimum" :max="status.total" :value="status.cursor"
          aria-label="Replay position" @pointerdown="props.review?.beginScrub()" @pointerup="props.review?.endScrub()" @pointercancel="props.review?.endScrub()"
          @keydown="props.review?.beginScrub()" @keyup="props.review?.endScrub()" @blur="props.review?.endScrub()" @change="props.review?.endScrub()"
          @input="seek(Number(($event.target as HTMLInputElement).value))" />
      </label>
      <span class="replay-position" aria-label="Current replay position" :title="status.commandNr != null ? 'Command #' + status.commandNr : undefined">
        <strong>{{ status.cursor }}</strong><i>/</i>{{ status.total }}
      </span>
    </div>
    <span class="control-separator" aria-hidden="true"></span>
    <label class="replay-speed">
      <span class="sr-only">Speed</span>
      <select :value="speed" aria-label="Replay speed" aria-describedby="replay-speed-help"
        title="Real time follows the recorded server clock; coaching pauses longer than 2 seconds are shortened."
        @change="changeSpeed">
        <option v-for="option in replaySpeedOptions" :key="option.label" :value="option.value">{{ option.label }}</option>
      </select>
      <span id="replay-speed-help" class="sr-only">Real time follows the recorded server clock with long coaching pauses shortened.</span>
    </label>
    <div v-if="props.review && (props.review.segments.length > 1 || props.review.pinned)" class="review-coverage">
      <label>
        <span>History segment</span>
        <select aria-label="History segment" :value="props.review.selectedSegment"
          @change="props.review.selectSegment(Number(($event.target as HTMLSelectElement).value))">
          <option v-if="!props.review.segments.some((segment) => segment.id === props.review!.selectedSegment)" :value="props.review.selectedSegment" disabled>Pinned position outside recent history</option>
          <option v-for="segment in props.review.segments" :key="segment.id" :value="segment.id">{{ segment.label }}</option>
        </select>
      </label>
      <button v-if="props.review.pinned && props.review.segments.length" type="button" class="open-recent-history"
        aria-label="Open recent history" @click="openRecentHistory">Open recent history</button>
    </div>
    <span v-if="props.review?.notice" class="review-notice" role="status">{{ props.review.notice }}</span>
    <span v-if="status.failure" class="replay-failure" role="alert"><b aria-hidden="true">!</b>{{ status.failure.message }}</span>
    <span class="replay-resizer" title="Resize replay controls" aria-label="Resize replay controls" role="button" @pointerdown="startResize">⤡</span>
  </div>
</template>

<style scoped>
.review-coverage { flex-basis: 100%; display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 12px; font-size: 11px; }
.review-coverage label { display: flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; }
.review-coverage select { min-width: 0; max-width: 100%; }
.open-recent-history { font: inherit; }
.review-notice {
  flex-basis: 100%;
  text-align: center;
  color: var(--ui-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.replay-controls {
  position: absolute;
  z-index: 31;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  width: 682px;
  max-width: calc(100% - 24px);
  max-height: calc(100% - 24px);

  gap: 4px;
  padding: 7px 10px 7px 18px;
  color: var(--ui-text);
  border: 3px solid color-mix(in srgb, var(--ui-border) 72%, var(--ui-surface));
  border-radius: 8px;
  background: linear-gradient(180deg, var(--ui-surface-2), var(--ui-surface) 78%);
  box-shadow:
    inset 1px 1px 0 color-mix(in srgb, var(--ui-text) 24%, transparent),
    inset -2px -2px 0 color-mix(in srgb, var(--ui-secondary) 76%, transparent),
    0 4px 12px color-mix(in srgb, var(--ui-secondary) 74%, transparent);
}
.replay-grip {
  position: absolute;
  z-index: 2;
  top: 4px;
  bottom: 4px;
  left: 3px;
  width: 12px !important;
  min-width: 12px !important;
  height: auto !important;
  padding: 0 !important;
  color: var(--ui-muted) !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  cursor: move !important;
  touch-action: none;
}
.replay-resizer {
  position: absolute;
  z-index: 3;
  right: 1px;
  bottom: 0;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  color: var(--ui-muted);
  cursor: nwse-resize;
  touch-action: none;
  user-select: none;
}
.control-separator { width: 1px; height: 26px; margin: 0 3px; background: var(--ui-border); box-shadow: 1px 0 0 color-mix(in srgb, var(--ui-text) 10%, transparent); }
.replay-control-group { display: flex; align-items: center; gap: 3px; }
.replay-controls button,
.replay-speed select,
.replay-turn-select select {
  box-sizing: border-box;
  height: 30px;
  color: var(--ui-text);
  border: 2px outset color-mix(in srgb, var(--ui-text) 24%, var(--ui-surface-2));
  border-radius: 4px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--ui-surface-2) 88%, var(--ui-text)), var(--ui-surface-2));
  box-shadow: inset 1px 1px 0 color-mix(in srgb, var(--ui-text) 15%, transparent);
  font: inherit;
  font-size: max(var(--ui-min-text-size, 12px), 9px);
  white-space: nowrap;
}
.replay-controls .transport-icon { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; width: 32px; padding: 5px; }
.replay-controls .transport-icon.transport-primary { min-width: 36px; width: 36px; }
.transport-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.transport-icon .transport-fill { fill: currentColor; stroke: none; }
.replay-controls button { min-width: 48px; padding: 0 8px; cursor: pointer; }
.replay-controls button:hover:not(:disabled),
.replay-speed select:hover:not(:disabled) { filter: brightness(1.2); }
.replay-controls button:active:not(:disabled) { border-style: inset; transform: translateY(1px); }
.replay-controls button:disabled,
.replay-speed select:disabled,
.replay-scrubber input:disabled { opacity: .4; cursor: default; }
.replay-controls button:focus-visible,
.replay-speed select:focus-visible,
.replay-scrubber input:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--ui-focus-halo);
}
.replay-controls .transport-primary {
  min-width: 54px;
  color: var(--ui-text-on-primary);
  border-color: var(--ui-primary);
  background: linear-gradient(180deg, color-mix(in srgb, var(--ui-primary) 76%, var(--ui-text)), var(--ui-primary));
  font-weight: 700;
}
.replay-controls .transport-primary[aria-pressed="true"] { color: var(--ui-text-on-accent); border-color: var(--ui-accent); background: var(--ui-accent); }
.replay-position {
  display: block;
  box-sizing: border-box;
  width: 100%;
  padding: 3px 7px;
  color: var(--ui-muted);
  border: 2px inset color-mix(in srgb, var(--ui-border) 74%, var(--ui-surface));
  border-radius: 4px;
  background: color-mix(in srgb, var(--ui-surface) 88%, var(--ui-secondary));
  font-size: max(var(--ui-min-text-size, 12px), 10px);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-align: center;
}
.replay-position-stack { display: flex; flex: 0 0 max(112px, 8.5em); width: max(112px, 8.5em); flex-direction: column; justify-content: center; align-items: stretch; }
.replay-position-stack .replay-turn-select select { height: 30px; } /* owner 09-09: one control height */
.replay-scrubber-stack .replay-position { height: 20px; display: flex; align-items: center; justify-content: center; padding: 0 7px; }
.replay-scrubber-stack { display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 3px; }
.replay-turn-select { display: block; width: 100%; }
.replay-turn-select select { width: 100%; padding: 0 4px; color-scheme: dark; font-size: max(var(--ui-min-text-size, 12px), 10px); }
.replay-turn-select select option { color: #f8f2df; background: #171a20; }
.replay-position strong { color: var(--ui-text); font-size: max(var(--ui-min-text-size, 12px), 12px); }
.replay-position i { margin: 0 4px; color: var(--ui-text-dim); font-style: normal; }
.replay-position small { display: block; margin-top: 3px; color: var(--ui-text-dim); font-size: max(var(--ui-min-text-size, 12px), 7px); letter-spacing: .04em; }
.replay-scrubber { display: flex; align-items: center; }
.replay-scrubber-stack .replay-scrubber, .replay-scrubber-stack .replay-position { width: min(18vw, 190px); box-sizing: border-box; }
.replay-scrubber input {
  width: 100%;
  height: 18px;
  margin: 0 4px;
  accent-color: var(--ui-accent);
  cursor: pointer;
}
.replay-speed {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text);
  font-size: max(var(--ui-min-text-size, 12px), 10px);
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.replay-speed select {
  min-width: 94px;
  padding: 0 9px;
  color: var(--ui-text);
  background-color: var(--ui-surface-2);
  color-scheme: dark;
  cursor: pointer;
  font-size: max(var(--ui-min-text-size, 12px), 11px);
  font-weight: 700;
  letter-spacing: .03em;
}
.replay-speed select option {
  color: #f8f2df;
  background: #171a20;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  font-weight: 700;
}
.replay-failure {
  display: flex;
  flex: 1 1 100%;
  align-items: center;
  justify-content: center;
  gap: 6px;
  max-width: 100%;
  padding: 5px 8px;
  color: var(--ui-danger);
  border-top: 1px solid color-mix(in srgb, var(--ui-danger) 46%, transparent);
  font-size: max(var(--ui-min-text-size, 12px), 9px);
  line-height: 1.3;
}
.replay-failure b { display: grid; place-items: center; width: 15px; height: 15px; color: var(--ui-text-on-primary); border-radius: 50%; background: var(--ui-danger); font-size: max(var(--ui-min-text-size, 12px), 9px); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 900px) {
  .control-separator { display: none; }
  .replay-controls { bottom: 12px; }
  .replay-scrubber { order: 20; flex: 1 1 100%; justify-content: center; }
  .replay-scrubber input { width: min(72vw, 420px); }
}
</style>
