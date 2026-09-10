<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ReplayTelestrator,
  TELESTRATOR_COLOR_PRESETS,
  TELESTRATOR_THICKNESS_PRESETS,
  type SketchElement,
  type SketchPoint,
  type SketchTool,
  type TelestratorColor,
} from '../game/replay/telestrator';
import {
  anchorPanelPosition,
  clampAnchoredPanelPosition,
  edgePanelStyle,
  resolvePanelPosition,
  type EdgePanelPosition,
} from '../game/edgePanelLayout';

/** Owner 08-17 (telestrator placement fix): points are stored in WORLD pixel space (the
 *  renderer's pre-camera coordinate system — the same space squareAnchor/extPoint project game
 *  squares into), not a flat unrotated 26×15 grid. A fixed 26×15 viewBox assumed the rendered
 *  pitch always exactly fills `.pitch-host` at 1:1 scale with x horizontal/y vertical — wrong at
 *  any pan/zoom, and wrong even at rest in the default NS orientation (game x is the DEPTH axis
 *  there, projected roughly vertical, not horizontal). toWorld/toLocal/cameraScale mirror
 *  PitchRenderer's own localToWorld/worldToLocal/cameraScale so a drawn point tracks the pitch
 *  itself under any camera state; callers who don't pass them (e.g. a bare mount in a test) fall
 *  back to an identity 1:1 mapping.
 */
const props = defineProps<{
  sessionKey: string;
  enabled: boolean;
  toWorld?: (localX: number, localY: number) => SketchPoint;
  toLocal?: (worldX: number, worldY: number) => SketchPoint;
  cameraScale?: () => number;
  toolbarBottom?: number;
  toolbarRight?: number;
  /** Host-relative LEFT edge of the quick bar; when set the launcher docks to its left (owner 09-06). */
  toolbarLeft?: number | null;
  toolbarPosition?: EdgePanelPosition | null;
}>();
const emit = defineEmits<{
  'update:toolbarPosition': [position: EdgePanelPosition | null];
}>();
const model = new ReplayTelestrator();
const revision = ref(0);
const drawing = ref(false);
const moving = ref<{ point: SketchPoint } | null>(null);
const openPopover = ref<'shapes' | 'weight' | 'color' | null>(null);
const root = ref<SVGSVGElement | null>(null);
const shell = ref<HTMLDivElement | null>(null);
const toolbar = ref<HTMLDivElement | null>(null);
const launcherSize = ref({ width: 112, height: 39 });
const viewportRevision = ref(0);
const toolbarDragging = ref(false);
const state = computed(() => { revision.value; return model.state(); });
const colorName = computed(() => TELESTRATOR_COLOR_PRESETS.find((preset) => preset.value === state.value.color)?.name ?? 'Custom');
const visible = computed(() => {
  revision.value;
  const draft = model.draftElement();
  return [...state.value.elements, ...(draft ? [draft] : [])];
});

function refresh(): void { revision.value += 1; }
/** Owner 08-18 (regression fix): wheel/zoom is a map control, never a telestrator feature (the
 *  model has no wheel-driven tool), so it must pass through to the canvas underneath in BOTH
 *  states — open or closed — never swallowed. Closed already falls through for free (pointer-events:
 *  none takes the svg out of hit-testing entirely). Open needs help: the svg is a sibling overlay
 *  of the canvas inside `.pitch-host`, not an ancestor, so a native wheel event's bubble phase from
 *  the svg (today's hit-test target while `active`) never reaches the canvas's own 'wheel' listener
 *  (renderer.ts attachCamera). Manually re-dispatch an equivalent WheelEvent onto the canvas. */
function forwardWheel(event: WheelEvent): void {
  const canvas = root.value?.closest('.pitch-host')?.querySelector('canvas');
  if (canvas) {
    canvas.dispatchEvent(new WheelEvent('wheel', {
      deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ, deltaMode: event.deltaMode,
      clientX: event.clientX, clientY: event.clientY, bubbles: true, cancelable: true,
    }));
  }
  event.preventDefault();
}
/** WORLD point → CANVAS-LOCAL screen point (mirrors PitchRenderer.worldToLocal). */
function toScreen(p: SketchPoint): SketchPoint { return props.toLocal ? props.toLocal(p.x, p.y) : p; }
function scale(): number { return props.cameraScale?.() ?? 1; }

// Owner 08-17: reproject every frame while enabled so shapes track the camera (pan/zoom) even
// when the coach isn't actively drawing — the same RAF-follows-camera pattern used elsewhere
// (KO/fall toasts, punt cone) for DOM overlays that sit outside the Pixi world container.
let cameraRaf = 0;
function cameraLoop(): void {
  refresh();
  cameraRaf = requestAnimationFrame(cameraLoop);
}
watch(() => props.enabled, (enabled) => {
  cancelAnimationFrame(cameraRaf);
  if (enabled) cameraRaf = requestAnimationFrame(cameraLoop);
}, { immediate: true });
onBeforeUnmount(() => cancelAnimationFrame(cameraRaf));
function closePopovers(): void { openPopover.value = null; }
function togglePopover(popover: 'shapes' | 'weight' | 'color'): void {
  openPopover.value = openPopover.value === popover ? null : popover;
}
function chooseThickness(thickness: number): void {
  model.setThickness(thickness);
  closePopovers();
  refresh();
}
function chooseColor(color: TelestratorColor): void {
  model.setColor(color);
  closePopovers();
  refresh();
}
function marker(color: TelestratorColor): string { return `url(#replay-arrow-head-${color.slice(1)})`; }
function point(event: PointerEvent): SketchPoint {
  // Owner 08-17: canvas-local pixel (matches PitchRenderer.localToWorld's expectation — the SVG
  // shares the canvas's exact box, `position:absolute;inset:0` on `.pitch-host`), then through
  // the live camera transform into WORLD space. NOT a proportional 0..26/0..15 stretch.
  const rect = root.value!.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  return props.toWorld ? props.toWorld(localX, localY) : { x: localX, y: localY };
}
function choose(tool: SketchTool): void {
  closePopovers();
  model.selectTool(tool);
  refresh();
}
function toggleExpanded(): void {
  model.setExpanded(!state.value.expanded);
  closePopovers();
  refresh();
}

const toolbarStyle = computed<Record<string, string>>(() => {
  viewportRevision.value;
  if (!props.toolbarPosition) {
    // Default dock = immediately LEFT of the quick bar on the same bottom row. The expanded row still
    // rises above the launcher (translateY) so it clears the bar as it grows rightward.
    if (props.toolbarLeft != null) return {
      bottom: `${props.toolbarBottom ?? 8}px`,
      left: `${Math.max(8, props.toolbarLeft - launcherSize.value.width - 4)}px`,
      right: 'auto',
    };
    return {
      bottom: `${props.toolbarBottom ?? 8}px`,
      right: `${props.toolbarRight ?? 12}px`,
    };
  }
  const viewport = toolbarViewport();
  const clamped = clampToolbarAnchor(props.toolbarPosition, viewport);
  return edgePanelStyle(clamped);
});

function toolbarViewport(): { width: number; height: number } {
  const rect = shell.value?.getBoundingClientRect();
  return {
    width: Math.max(1, shell.value?.clientWidth || rect?.width || window.innerWidth),
    height: Math.max(1, shell.value?.clientHeight || rect?.height || window.innerHeight),
  };
}

function captureLauncherSize(): void {
  if (state.value.expanded) return;
  const rect = toolbar.value?.getBoundingClientRect();
  if (!rect?.width || !rect.height) return;
  launcherSize.value = { width: rect.width, height: rect.height };
}

const LONG_PRESS_MS = 340;
const LONG_PRESS_SLOP_PX = 7;
// The tools deliberately open above the launcher. Keep one toolbar-height of headroom
// so a launcher dragged to the top edge can never strand its expanded controls off-screen.
const TOOLBAR_POPUP_CLEARANCE_PX = 52;
let toolbarPressTimer = 0;
let suppressToolbarClick = false;
let suppressToolbarClickTimer = 0;
let armedToolbarPress: {
  pointerId: number;
  startX: number;
  startY: number;
  button: HTMLButtonElement;
} | null = null;
let toolbarDrag: {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  button: HTMLButtonElement;
} | null = null;

function clampToolbarAnchor(
  position: EdgePanelPosition,
  viewport = toolbarViewport(),
): EdgePanelPosition {
  const clamped = clampAnchoredPanelPosition(position, launcherSize.value, viewport);
  const resolved = resolvePanelPosition(clamped, launcherSize.value, viewport);
  const maxY = Math.max(0, viewport.height - launcherSize.value.height);
  const safeY = Math.max(Math.min(TOOLBAR_POPUP_CLEARANCE_PX, maxY), resolved.y);
  if (safeY === resolved.y) return clamped;
  return anchorPanelPosition({ x: resolved.x, y: safeY }, launcherSize.value, viewport);
}

function clearToolbarPressTimer(): void {
  window.clearTimeout(toolbarPressTimer);
  toolbarPressTimer = 0;
}

function cancelToolbarInteraction(): void {
  clearToolbarPressTimer();
  const active = toolbarDrag;
  toolbarDrag = null;
  toolbarDragging.value = false;
  armedToolbarPress = null;
  if (active) {
    try { active.button.releasePointerCapture?.(active.pointerId); } catch { /* already released */ }
  }
}

function armToolbarDrag(event: PointerEvent): void {
  if (event.button !== 0 || state.value.expanded) return;
  clearToolbarPressTimer();
  captureLauncherSize();
  const button = event.currentTarget as HTMLButtonElement;
  armedToolbarPress = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    button,
  };
  toolbarPressTimer = window.setTimeout(() => {
    const armed = armedToolbarPress;
    if (!armed) return;
    const viewport = toolbarViewport();
    const shellRect = shell.value?.getBoundingClientRect();
    const current = props.toolbarPosition
      ? resolvePanelPosition(props.toolbarPosition, launcherSize.value, viewport)
      : (() => {
          const rect = toolbar.value?.getBoundingClientRect();
          return {
            x: (rect?.left ?? armed.startX) - (shellRect?.left ?? 0),
            y: (rect?.top ?? armed.startY) - (shellRect?.top ?? 0),
          };
        })();
    toolbarDrag = {
      pointerId: armed.pointerId,
      startX: armed.startX,
      startY: armed.startY,
      originX: current.x,
      originY: current.y,
      button: armed.button,
    };
    toolbarDragging.value = true;
    armedToolbarPress = null;
    suppressToolbarClick = true;
    try { armed.button.setPointerCapture?.(armed.pointerId); } catch { /* pointer may already be captured */ }
  }, LONG_PRESS_MS);
}

function moveToolbar(event: PointerEvent): void {
  if (toolbarDrag?.pointerId === event.pointerId) {
    const viewport = toolbarViewport();
    const x = toolbarDrag.originX + event.clientX - toolbarDrag.startX;
    const y = toolbarDrag.originY + event.clientY - toolbarDrag.startY;
    emit('update:toolbarPosition', clampToolbarAnchor(
      anchorPanelPosition({ x, y }, launcherSize.value, viewport),
      viewport,
    ));
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const armed = armedToolbarPress;
  if (!armed || armed.pointerId !== event.pointerId) return;
  if (Math.hypot(event.clientX - armed.startX, event.clientY - armed.startY) > LONG_PRESS_SLOP_PX) {
    clearToolbarPressTimer();
    armedToolbarPress = null;
  }
}

function finishToolbarPress(event: PointerEvent): void {
  clearToolbarPressTimer();
  if (toolbarDrag?.pointerId === event.pointerId) {
    const completedDrag = toolbarDrag;
    toolbarDrag = null;
    toolbarDragging.value = false;
    event.preventDefault();
    event.stopPropagation();
    try { completedDrag.button.releasePointerCapture?.(event.pointerId); } catch { /* already released */ }
    window.clearTimeout(suppressToolbarClickTimer);
    suppressToolbarClickTimer = window.setTimeout(() => { suppressToolbarClick = false; }, 0);
  }
  if (armedToolbarPress?.pointerId === event.pointerId) armedToolbarPress = null;
}

function toggleExpandedFromLauncher(event: MouseEvent): void {
  if (suppressToolbarClick) {
    suppressToolbarClick = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  toggleExpanded();
}

function onViewportResize(): void {
  viewportRevision.value += 1;
  if (!props.toolbarPosition) return;
  const next = clampToolbarAnchor(props.toolbarPosition);
  if (next !== props.toolbarPosition) emit('update:toolbarPosition', next);
}
function chooseShape(kind: 'arrow' | 'circle'): void {
  const selected = state.value.elements.find((element) => element.id === state.value.selectedId);
  if (selected && selected.kind !== 'stroke') {
    model.replaceSelectedShape(kind);
    model.selectTool('none');
  } else model.selectTool(kind);
  closePopovers();
  refresh();
}
function path(element: Extract<SketchElement, { kind: 'stroke' }>): string {
  return element.points.map((p, index) => { const s = toScreen(p); return `${index ? 'L' : 'M'} ${s.x} ${s.y}`; }).join(' ');
}
function pointerDown(event: PointerEvent): void {
  if (!props.enabled) return;
  const at = point(event);
  if (state.value.tool !== 'none' && state.value.tool !== 'select') drawing.value = model.begin(at);
  else if (state.value.tool === 'select') model.select(null);
  else {
    // Owner 08-17 (ruling 3): still swallow the click — the layer is pointer-events:auto
    // whenever telestrator is OPEN (state.expanded), so an idle 'none' tool must not fall
    // through to the map's own drag-pan underneath while the toolbar is up. Closed, the svg
    // is pointer-events:none and this handler never fires at all.
    event.preventDefault();
    return;
  }
  root.value?.setPointerCapture(event.pointerId);
  event.preventDefault();
  refresh();
}
function pointerMove(event: PointerEvent): void {
  if (drawing.value) model.update(point(event));
  else if (moving.value) {
    const next = point(event);
    model.moveSelected(next.x - moving.value.point.x, next.y - moving.value.point.y);
    moving.value.point = next;
  } else return;
  refresh();
}
function pointerUp(event: PointerEvent): void {
  if (drawing.value) {
    // Owner 08-17 ("on every click"): a committed arrow/circle used to fall back to `finishInteraction`
    // (tool → 'none'), forcing a re-arm through the Shapes flyout before the next shape. The
    // tool now stays selected — like pencil already did — so every subsequent click on the pitch
    // starts another shape with no re-arming step.
    model.commit();
  } else if (moving.value) model.finishInteraction();
  drawing.value = false;
  moving.value = null;
  try { root.value?.releasePointerCapture(event.pointerId); } catch { /* pointer already released */ }
  refresh();
}
function selectElement(event: PointerEvent, id: string): void {
  if (state.value.tool !== 'none' && state.value.tool !== 'select') return;
  event.stopPropagation();
  model.select(id);
  moving.value = { point: point(event) };
  root.value?.setPointerCapture(event.pointerId);
  refresh();
}
function keyboard(event: KeyboardEvent): void {
  if (!props.enabled) return;
  if (event.key === 'Escape' && openPopover.value) {
    closePopovers();
    event.preventDefault();
    return;
  }
  if (!(event.ctrlKey || event.metaKey)) return;
  const target = event.target as HTMLElement | null;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return;
  const key = event.key.toLowerCase();
  if (key === '1') choose('pencil');
  else if (key === '2') { model.setExpanded(true); togglePopover('shapes'); refresh(); }
  else if (key === '3') { model.clear(); refresh(); }
  else if (key === '4' || key === 'z') { model.undo(); refresh(); }
  else if (key === 'escape') { choose('none'); }
  else return;
  event.preventDefault();
}

watch(() => props.sessionKey, () => { cancelToolbarInteraction(); model.resetForSession(); closePopovers(); refresh(); });
watch(() => props.enabled, (enabled) => { if (!enabled) cancelToolbarInteraction(); });
watch(() => state.value.expanded, (expanded) => {
  if (!expanded) void nextTick(captureLauncherSize);
});
onMounted(() => {
  window.addEventListener('keydown', keyboard);
  window.addEventListener('resize', onViewportResize);
  void nextTick(captureLauncherSize);
});
onBeforeUnmount(() => {
  cancelToolbarInteraction();
  window.clearTimeout(suppressToolbarClickTimer);
  window.removeEventListener('keydown', keyboard);
  window.removeEventListener('resize', onViewportResize);
});
</script>

<template>
  <div v-if="enabled" ref="shell" class="telestrator-shell">
      <div ref="toolbar" class="telestrator-tools" role="toolbar" aria-label="Telestrator"
        :data-expanded="state.expanded"
        :data-dragging="toolbarDragging"
        :style="toolbarStyle">
        <button v-if="!state.expanded" class="telestrator-collapsed-trigger"
          title="Open telestrator — long-press to move" aria-label="Open telestrator"
          @pointerdown="armToolbarDrag" @pointermove="moveToolbar"
          @pointerup="finishToolbarPress" @pointercancel="finishToolbarPress"
          @lostpointercapture="finishToolbarPress"
          @contextmenu.prevent @click="toggleExpandedFromLauncher">✎</button>
        <template v-else>
          <div v-if="state.limitNotice" class="telestrator-limit-notice" role="status" aria-live="polite">{{ state.limitNotice }}</div>
          <button :aria-pressed="state.tool === 'pencil'" title="Pencil (Ctrl+1)" @click="choose('pencil')">✎</button>
          <div class="shape-group">
            <button :aria-expanded="openPopover === 'shapes'" :aria-pressed="state.tool === 'arrow' || state.tool === 'circle'"
              title="Shapes (Ctrl+2)" @click="togglePopover('shapes')">Shapes</button>
            <div v-if="openPopover === 'shapes'" class="shape-flyout" role="group" aria-label="Shape options">
              <button title="Arrow" @click="chooseShape('arrow')">➜ Arrow</button>
              <button title="Circle" @click="chooseShape('circle')">◯ Circle</button>
            </div>
          </div>
          <div class="picker-group">
            <button class="weight-trigger" title="Stroke weight" :aria-label="`Stroke weight: ${state.thickness}`"
              :aria-expanded="openPopover === 'weight'" @click="togglePopover('weight')">
              <svg viewBox="0 0 40 20" preserveAspectRatio="none" aria-hidden="true">
                <line x1="5" y1="10" x2="35" y2="10" :stroke-width="Math.max(state.thickness, 0.2)" />
              </svg>
            </button>
            <div v-if="openPopover === 'weight'" class="toolbar-popover weight-picker" role="group" aria-label="Stroke weight options">
              <button v-for="weight in TELESTRATOR_THICKNESS_PRESETS" :key="weight"
                :aria-label="`Stroke weight ${weight}`" :aria-pressed="state.thickness === weight"
                @click="chooseThickness(weight)">
                <svg viewBox="0 0 40 20" preserveAspectRatio="none" aria-hidden="true">
                  <line x1="5" y1="10" x2="35" y2="10" :stroke-width="weight" />
                </svg>
              </button>
            </div>
          </div>
          <div class="picker-group">
            <button class="color-trigger" title="Stroke color" :aria-label="`Stroke color: ${colorName}`"
              :aria-expanded="openPopover === 'color'" @click="togglePopover('color')">
              <span class="color-dot" :style="{ backgroundColor: state.color }" aria-hidden="true"></span>
            </button>
            <div v-if="openPopover === 'color'" class="toolbar-popover color-picker" role="group" aria-label="Stroke color options">
              <button v-for="preset in TELESTRATOR_COLOR_PRESETS" :key="preset.name"
                :aria-label="preset.name" :aria-pressed="state.color === preset.value"
                @click="chooseColor(preset.value)">
                <span class="color-dot" :style="{ backgroundColor: preset.value }" aria-hidden="true"></span>
              </button>
            </div>
          </div>
          <button title="Undo (Ctrl+Z / Ctrl+4)" @click="model.undo(); refresh()">Undo</button>
          <button title="Clear (Ctrl+3)" @click="model.clear(); refresh()">Clear</button>
          <button title="Close telestrator" aria-label="Close telestrator" @click="toggleExpanded">✕</button>
        </template>
      </div>
    <!-- Owner 08-17 (ruling 3): the layer swallows the drag-pan gesture whenever telestrator is
         OPEN (toolbar expanded, not collapsed) — the draw gesture owns the pointer the whole time
         the panel is up, not only mid-shape.
         Owner 08-18 (regression fix): `active` gated on `enabled` alone over-reached — that's true
         for the whole spectate/replay session (see SpectateView's `:enabled` binding), so the layer
         swallowed pitch click/drag even with the telestrator CLOSED. Gate on `state.expanded`
         instead — the toolbar's own open/collapsed flag (1bfbb642) — so closed reverts to zero
         pointer capture and normal pitch interaction; sketches stay visible either way (this
         template only guards the input layer, not the drawn elements below).
         Owner 08-17 (placement fix): no viewBox/preserveAspectRatio — the SVG's user units are now
         plain CSS pixels of `.pitch-host` (1:1 with the canvas it overlays), matching the
         canvas-local space toWorld/toLocal convert through. A 26×15 viewBox is what stretched
         every shape off its drawn spot. -->
    <svg ref="root" class="telestrator-layer" :class="{ active: state.expanded }"
      @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp"
      @wheel="forwardWheel">
      <defs>
        <marker v-for="preset in TELESTRATOR_COLOR_PRESETS" :id="`replay-arrow-head-${preset.value.slice(1)}`"
          :key="preset.value" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
          <path d="M0,0 L4,2 L0,4 z" :style="{ fill: preset.value }" />
        </marker>
      </defs>
      <!-- Owner 08-17 (weight-picker addition): stroke WEIGHT is fixed screen pt (2/4/6/8),
           independent of zoom — vector-effect keeps it non-scaling in case an SVG-level transform
           is ever reintroduced upstream of this layer; today the layer has no viewBox/transform of
           its own (positions are pre-projected to screen pixels below), so it's already
           screen-fixed by construction. Shape GEOMETRY (points/radii) stays anchored to the pitch
           via toScreen/scale, so it still tracks pan/zoom correctly. -->
      <template v-for="element in visible" :key="element.id">
        <path v-if="element.kind === 'stroke'" :d="path(element)" :stroke="element.color" :stroke-width="element.thickness"
          vector-effect="non-scaling-stroke" :class="{ selected: state.selectedId === element.id }" @pointerdown="selectElement($event, element.id)" />
        <line v-else-if="element.kind === 'arrow'"
          :x1="toScreen(element.from).x" :y1="toScreen(element.from).y" :x2="toScreen(element.to).x" :y2="toScreen(element.to).y"
          :stroke="element.color" :stroke-width="element.thickness" vector-effect="non-scaling-stroke" :marker-end="marker(element.color)"
          :class="{ selected: state.selectedId === element.id }" @pointerdown="selectElement($event, element.id)" />
        <ellipse v-else :cx="toScreen(element.center).x" :cy="toScreen(element.center).y"
          :rx="element.radiusX * scale()" :ry="element.radiusY * scale()"
          :stroke="element.color" :stroke-width="element.thickness" vector-effect="non-scaling-stroke"
          :class="{ selected: state.selectedId === element.id }"
          @pointerdown="selectElement($event, element.id)" />
      </template>
    </svg>
  </div>
</template>

<style scoped>
.telestrator-shell { position: absolute; inset: 0; z-index: 28; pointer-events: none; }
.telestrator-tools {
  position: absolute;
  bottom: 8px;
  right: 12px;
  z-index: 101;
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 5px;
  border: 3px solid color-mix(in srgb, var(--ui-border) 72%, var(--ui-surface));
  border-radius: 7px;
  background: linear-gradient(180deg, var(--ui-surface-2), var(--ui-surface));
  box-shadow:
    inset 1px 1px 0 color-mix(in srgb, var(--ui-text) 24%, transparent),
    inset -2px -2px 0 color-mix(in srgb, var(--ui-secondary) 76%, transparent),
    0 4px 10px color-mix(in srgb, var(--ui-secondary) 74%, transparent);
  pointer-events: auto;
  transition: transform 120ms ease;
}
/* The collapsed launcher owns the lower-right anchor. Opening it grows the
   working row upward, keeping every tool clear of the quick bar. */
.telestrator-tools[data-expanded='true'] { transform: translateY(calc(-100% - 7px)); }
.telestrator-limit-notice {
  position: absolute;
  right: 0;
  bottom: calc(100% + 7px);
  width: max-content;
  max-width: min(320px, calc(100vw - 24px));
  padding: 6px 8px;
  color: var(--ui-text);
  border: 2px solid var(--ui-warning, var(--ui-accent));
  border-radius: 5px;
  background: var(--ui-surface);
  box-shadow: 0 4px 10px color-mix(in srgb, var(--ui-secondary) 74%, transparent);
  font-size: max(var(--ui-min-text-size, 12px), 10px);
}
.telestrator-tools button {
  min-width: 29px;
  height: 29px;
  padding: 0 7px;
  color: var(--ui-text);
  border: 2px outset color-mix(in srgb, var(--ui-text) 24%, var(--ui-surface-2));
  border-radius: 4px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--ui-surface-2) 88%, var(--ui-text)), var(--ui-surface-2));
  box-shadow: inset 1px 1px 0 color-mix(in srgb, var(--ui-text) 15%, transparent);
  font: inherit;
  font-size: max(var(--ui-min-text-size, 12px), 9px);
  cursor: pointer;
}
.telestrator-tools button:hover { filter: brightness(1.2); }
.telestrator-tools button:active { border-style: inset; transform: translateY(1px); }
.telestrator-tools button:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--ui-focus-halo);
}
.telestrator-tools .telestrator-collapsed-trigger { box-sizing: border-box; flex: 0 0 auto; width: auto; min-width: max-content; padding: 0 9px; white-space: nowrap; touch-action: none; cursor: grab; }
.telestrator-tools[data-dragging='true'] .telestrator-collapsed-trigger {
  cursor: grabbing;
  filter: brightness(1.24);
  box-shadow: inset 1px 1px 0 color-mix(in srgb, var(--ui-text) 20%, transparent), 0 0 9px var(--ui-focus-halo);
}
.telestrator-tools button[aria-pressed="true"] { color: var(--ui-text-on-accent); border-color: var(--ui-accent); background: var(--ui-accent); }
.shape-group, .picker-group { position: relative; }
.toolbar-popover, .shape-flyout {
  position: absolute;
  top: auto;
  bottom: calc(100% + 7px);
  padding: 5px;
  gap: 3px;
  border: 2px solid var(--ui-border);
  border-radius: 5px;
  background: var(--ui-surface);
  box-shadow: 0 5px 12px color-mix(in srgb, var(--ui-secondary) 76%, transparent);
}
.shape-flyout { right: 0; display: grid; min-width: 92px; }
.weight-picker { left: 50%; display: flex; transform: translateX(-50%); }
.weight-picker button { width: 52px; height: 32px; padding: 2px; }
.weight-picker svg { display: block; width: 100%; height: 100%; overflow: visible; }
.weight-picker line { stroke: var(--ui-text); stroke-linecap: round; }
.weight-trigger { display: grid; place-items: center; }
.weight-trigger svg { display: block; width: 18px; height: 9px; overflow: visible; }
.weight-trigger line { stroke: var(--ui-text); stroke-linecap: round; }
.color-picker { left: 50%; display: flex; transform: translateX(-50%); }
.color-picker button { display: grid; place-items: center; }
.color-dot { display: block; width: 13px; height: 13px; border: 2px solid var(--ui-text); border-radius: 50%; box-shadow: 0 0 0 1px var(--ui-surface); }
.color-trigger { display: grid; place-items: center; }
.telestrator-layer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; touch-action: none; }
.telestrator-layer.active { pointer-events: auto; }
.telestrator-layer path, .telestrator-layer line, .telestrator-layer ellipse { fill: none; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
/* Owner 08-18 (regression fix): stroke-level hit-testing (needed so a click precisely on a drawn
   line can select it) must stay OFF the base rule above — it's an explicit per-element override
   that would otherwise out-hit-test the parent's `pointer-events: none` when closed, letting a
   pixel-precise click on a visible sketch still swallow input. Scope it to `.active` (open) only. */
.telestrator-layer.active path, .telestrator-layer.active line, .telestrator-layer.active ellipse { pointer-events: stroke; }
.telestrator-layer marker path { stroke: none; }
.telestrator-layer .selected { filter: drop-shadow(0 0 2px var(--ui-info)) drop-shadow(0 0 2px var(--ui-secondary)); }
</style>
