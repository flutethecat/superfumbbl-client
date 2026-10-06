<script setup lang="ts">
/**
 * Owner 2026-10-06: the CLIENT walkthrough overlay (docs/artifact-orchestration/spec-client-walkthrough.md). Step model:
 * game/clientTour.ts; glue: game/clientTourController.ts; App.vue supplies the host API (blades, Settings, the Play
 * blade's Details popup) and mounts this after the first-launch wizard. Ends on the third-party disclaimer.
 *
 * The layer never blocks the app (pointer-events: none outside the cards), so step 2's blades stay clickable and the
 * Settings dialog stays usable while the card docks beside it. It is teleported to <body> so no stacking context of
 * the shell (the colourblind filter) can put a body-level overlay (the Dice pane, z 210) above it. A SUSPENDED tour
 * (a real game / waiting board owns the window) is inert: nothing it watches dispatches until it resumes.
 * Public-edition code: no pane import.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import ThirdPartyDisclaimer from './ThirdPartyDisclaimer.vue';
import { ui } from '../game/ui';
import {
  BLADE_INFO,
  BLADE_LABEL,
  TOUR_BLADES,
  HUD_UNAVAILABLE_NOTE,
  clientStep,
  dockBeside,
  isHudStep,
  isSettingsStep,
  placeChips,
  planLabels,
  placeNear,
  type BladeId,
  type ClientStep,
  type Rect,
} from '../game/clientTour';
import { createClientTourController, type ClientTourHost } from '../game/clientTourController';
import { arrowBetween } from '../game/tourGeometry';
import { trapDialogFocus } from '../game/settingsDialog';


const props = defineProps<{
  host: ClientTourHost;
  /** App's gate (seen version, wizard done, the site walkthrough first when the pane exists). */
  shouldStart: boolean;
  /** A waiting board / the setup wizard re-run / the protocol console owns the window: hide (it resumes after). */
  suspended?: boolean;
  /** A match is loaded. Only the HUD steps run over one, and only over the DEMO game; anything else suspends the tour. */
  inGame?: boolean;
  /** The loaded match is the bundled demo (gameStore.state.demoMode). */
  demoGame?: boolean;
  /** The Esc Game Menu is open (step 6 waits for it). */
  gameMenuOpen?: boolean;
  settingsOpen?: boolean;
  twitchUrl?: string;
  /** The shell's colorblind CSS filter (App.vue, game/colorblindFilters.ts colorblindCssFilter), undefined = off. */
  colorblindFilter?: string;
}>();

const tour = createClientTourController(props.host);
const state = tour.state;
const step = computed<ClientStep | null>(() => (state.value && state.value.step !== 'done' ? clientStep(state.value.step) : null));
/** Not held back by the window's owner: no suspension, and over a match only on the HUD steps. */
// Astra 10-06 (N3): a live match arriving during a HUD step suspends the tour too - it never drives a real match's UI.
const active = computed(() => !!step.value && !props.suspended && (!props.inGame || (isHudStep(step.value.id) && !!props.demoGame)));
const visible = active;
const cardVisible = computed(() => visible.value && step.value?.id !== 'disclaimer');
/** Owner 10-06: on <body> the layer and the disclaimer are outside the shell's colorblind filter - apply the same one. */
const colorblindStyle = computed(() => (props.colorblindFilter ? { filter: props.colorblindFilter } : undefined));

// The FUMBBL.COM site stays hidden while the tour runs (FumbblHomePane reads this).
watch(active, (on) => { ui.clientTourActive = on; }, { immediate: true });

watch(() => props.shouldStart && !props.suspended && !props.inGame, (go) => { if (go && !tour.running()) void tour.start(); }, { immediate: true });
// Astra 10-06 (F1): only an ACTIVE tour reacts - a tour suspended under a live game never turns its Esc into Settings.
watch(() => props.gameMenuOpen, (open) => { if (open && active.value && state.value?.step === 'esc') void tour.dispatch({ type: 'esc' }); });
watch(() => props.settingsOpen, (open) => { if (!open && active.value) void tour.dispatch({ type: 'settings-closed' }); });

// ---- layout ----
const card = ref<HTMLElement | null>(null);
const layout = reactive({
  card: { x: 0, y: 0 },
  mini: null as null | { x: number; y: number },
  targets: [] as Rect[],
  /** The label of each target (same order), null = none. */
  labels: [] as (string | null)[],
});
const warned = new Set<string>();
let stepEnteredAt = Date.now();
watch(() => state.value?.step, () => { stepEnteredAt = Date.now(); });

function rectOf(el: Element | null): Rect | null {
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return b.width > 0 && b.height > 0 ? { x: b.left, y: b.top, width: b.width, height: b.height } : null;
}
/** An anchor is a `data-tour` name or a CSS selector (starting with `.`, `#` or `[`). */
function anchorRect(name: string): Rect | null {
  const selector = /^[.#[]/.test(name) ? name : `[data-tour="${name}"]`;
  try {
    return rectOf(document.querySelector(selector));
  } catch {
    return null;
  }
}
function union(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const r = Math.max(...rects.map((q) => q.x + q.width));
  const b = Math.max(...rects.map((q) => q.y + q.height));
  return { x, y, width: r - x, height: b - y };
}

/** Step 2: the mini-card of the clicked blade sits under that blade (a blade absent in this build: inside the card). */
const focusBlade = computed<BladeId | null>(() => (state.value?.step === 'nav' ? state.value.focusBlade : null));
const focusAnchor = computed(() => (focusBlade.value ? anchorRect(`blade-${focusBlade.value}`) : null));

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
function sideStep(viewport: { width: number; height: number }, size: { width: number; height: number }, y: number, targets: Rect[]): { x: number; y: number } {
  const xs = [Math.max(16, (viewport.width - size.width) / 2), 16, Math.max(16, viewport.width - size.width - 16)];
  let best = { x: xs[0]!, y };
  let bestCover = Infinity;
  for (const x of xs) {
    const cover = targets.reduce((n, t) => n + overlapArea({ x, y, width: size.width, height: size.height }, t), 0);
    if (cover < bestCover) { best = { x, y }; bestCover = cover; }
    if (cover === 0) break;
  }
  return best;
}

function relayout(): void {
  const s = step.value;
  if (!s || !cardVisible.value) return;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  // The Details popup the tour opened covers the button the arrow pointed at: no arrow while it is up.
  const names = s.id === 'play-details' && tour.details.value ? [] : s.anchors;
  const found: Rect[] = [];
  const labels: (string | null)[] = [];
  for (const [i, name] of names.entries()) {
    const r = anchorRect(name);
    if (r) {
      found.push(r);
      labels.push(s.labels?.[i] ?? null);
    } else if (s.optional?.includes(name)) {
      // often absent (e.g. no inducements bought): skipped quietly
    } else if (Date.now() - stepEnteredAt > 2000 && !warned.has(`${s.id}:${name}`)) {
      warned.add(`${s.id}:${name}`);
      console.warn(`[client-tour] ${s.id}: no element for data-tour="${name}" (showing the card without that arrow)`);
    }
  }
  layout.targets = found;
  layout.labels = labels;
  const box = card.value?.getBoundingClientRect();
  const size = { width: box?.width || 560, height: box?.height || 220 };
  let pos: { x: number; y: number };
  if (s.placement === 'dock-settings') {
    const pane = rectOf(document.querySelector('.settings-pane'));
    pos = pane ? dockBeside(viewport, pane, size) : { x: viewport.width - size.width - 16, y: 16 };
  } else if (s.placement === 'centre' || s.placement === 'top') {
    // Centred (or at the top), slid sideways when that would cover what the arrows point at (UAT 10-06: the roster
    // pop-out's names sat under the card).
    pos = sideStep(viewport, size, s.placement === 'top' ? 24 : Math.max(16, (viewport.height - size.height) / 2), found);
  } else if (s.placement === 'below-blades') {
    pos = placeNear(viewport, union(found), size);
  } else {
    pos = placeNear(viewport, found[0] ?? null, size);
  }
  layout.card = pos;
  const fa = focusAnchor.value;
  layout.mini = fa ? { x: Math.max(16, Math.min(viewport.width - 336, fa.x + fa.width / 2 - 160)), y: fa.y + fa.height + 14 } : null;
}

const arrows = computed(() => {
  const box = card.value?.getBoundingClientRect();
  const c = { x: layout.card.x, y: layout.card.y, width: box?.width || 560, height: box?.height || 220 };
  return layout.targets.map((t) => {
    const ring = { x: t.x - 4, y: t.y - 4, width: t.width + 8, height: t.height + 8 };
    const a = arrowBetween(c, ring);
    const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
    const head = [
      [a.x2, a.y2],
      [a.x2 - 14 * Math.cos(ang - 0.45), a.y2 - 14 * Math.sin(ang - 0.45)],
      [a.x2 - 14 * Math.cos(ang + 0.45), a.y2 - 14 * Math.sin(ang + 0.45)],
    ].map((p) => p.join(',')).join(' ');
    // A callout (single-arrow label, or a long note) sits above the target, or below it near the window's top edge.
    const index = layout.targets.indexOf(t);
    const above = ring.y > 60;
    return {
      ring, line: a, head,
      label: labelPlan.value.callouts[index] ?? null,
      labelAt: { x: ring.x + ring.width / 2, y: above ? ring.y - 8 : ring.y + ring.height + 8, above },
      chip: labelPlan.value.chips[index] ?? null,
      chipAt: chipSpots.value[index] ?? null,
    };
  });
});
/** UAT 10-06: with several arrows the short labels become numbered chips at the targets + a legend on the card. */
const labelPlan = computed(() => planLabels(layout.labels));
const chipSpots = computed(() => placeChips(layout.targets.map((t) => ({ x: t.x - 4, y: t.y - 4, width: t.width + 8, height: t.height + 8 }))));

let interval = 0;
function onBladeClick(event: MouseEvent): void {
  if (!active.value || state.value?.step !== 'nav') return;
  const el = event.target instanceof Element ? event.target.closest('[data-tour^="blade-"]') : null;
  const id = el?.getAttribute('data-tour')?.slice('blade-'.length) as BladeId | undefined;
  if (id && (TOUR_BLADES as readonly string[]).includes(id)) void tour.dispatch({ type: 'blade', blade: id, via: 'blade' });
}
onMounted(() => {
  interval = window.setInterval(relayout, 250);
  window.addEventListener('resize', relayout);
  document.addEventListener('click', onBladeClick, true);
});
onBeforeUnmount(() => {
  window.clearInterval(interval);
  window.removeEventListener('resize', relayout);
  document.removeEventListener('click', onBladeClick, true);
  tour.stop();
  ui.clientTourActive = false;
});
watch([step, () => tour.details.value, focusBlade], () => requestAnimationFrame(relayout));

const read = computed(() => new Set(state.value?.read ?? []));
function chip(blade: BladeId): void { void tour.dispatch({ type: 'blade', blade, via: 'chip' }); }
/** A blade that has no button in this build shows its text inside the card. */
const inCardInfo = computed(() => (focusBlade.value && !focusAnchor.value ? BLADE_INFO[focusBlade.value] : null));
/** Docked beside Settings: the Settings focus trap includes this card (App.vue trapSettingsFocus). */
const docked = computed(() => !!step.value && isSettingsStep(step.value.id));
/** Astra F2: the card is on <body>, outside the Settings dialog's keydown handler - Tab inside it runs the same shared
 *  trap, so Tab / Shift+Tab cycle dialog <-> Back / Skip / Next from either side. */
function onCardKeydown(event: KeyboardEvent): void {
  if (!docked.value || event.key !== 'Tab') return;
  trapDialogFocus(event, document.querySelector<HTMLElement>('.settings-pane'), [card.value]);
}

defineExpose({ tour });
</script>

<template>
  <Teleport to="body">
  <div v-if="cardVisible" class="client-tour-layer" data-testid="client-tour" :style="colorblindStyle">
    <svg class="client-tour-arrows" aria-hidden="true">
      <g v-for="(a, i) in arrows" :key="i">
        <rect class="ring" :x="a.ring.x" :y="a.ring.y" :width="a.ring.width" :height="a.ring.height" rx="6" />
        <template v-if="a.line.visible">
          <line class="arrow" :x1="a.line.x1" :y1="a.line.y1" :x2="a.line.x2" :y2="a.line.y2" />
          <polygon class="head" :points="a.head" />
        </template>
      </g>
    </svg>
    <template v-for="(a, i) in arrows" :key="`label-${i}`">
      <span v-if="a.chip && a.chipAt" class="client-tour-chip-n" :style="{ left: a.chipAt.x + 'px', top: a.chipAt.y + 'px' }"
        :aria-label="labelPlan.legend[a.chip - 1]?.label">{{ a.chip }}</span>
      <span v-if="a.label" class="client-tour-label" :data-above="a.labelAt.above" :data-long="a.label.length > 24"
        :style="{ left: a.labelAt.x + 'px', top: a.labelAt.y + 'px' }">{{ a.label }}</span>
    </template>
    <section ref="card" class="client-tour-card" role="region" :data-docked="docked" @keydown="onCardKeydown" :aria-label="`Walkthrough: ${step!.title}`" :data-step="step!.id"
      :style="{ left: layout.card.x + 'px', top: layout.card.y + 'px' }">
      <h2 class="client-tour-title">{{ step!.title }}</h2>
      <div class="client-tour-body">
        <p v-for="(line, i) in step!.body" :key="i">{{ line }}</p>
        <ol v-if="labelPlan.legend.length" class="client-tour-legend" aria-label="Arrow labels">
          <li v-for="item in labelPlan.legend" :key="item.n"><span class="client-tour-chip-n inline">{{ item.n }}</span>{{ item.label }}</li>
        </ol>
        <div v-if="step!.id === 'nav'" class="client-tour-chips" role="group" aria-label="Panes">
          <button v-for="b in TOUR_BLADES" :key="b" type="button" class="client-tour-chip" :data-blade="b" :data-read="read.has(b)" @click="chip(b)">
            <span v-if="read.has(b)" class="tick" aria-hidden="true">✓</span>{{ BLADE_LABEL[b] }}
          </button>
        </div>
        <p v-if="inCardInfo" class="client-tour-info">{{ inCardInfo }}</p>
        <p v-if="step!.id === 'esc' && state?.hudSkipped" class="client-tour-info" data-testid="hud-unavailable">{{ HUD_UNAVAILABLE_NOTE }}</p>
        <div v-if="step!.id === 'esc'" class="client-tour-esc">
          <kbd>Esc</kbd>
          <button type="button" class="secondary" @click="tour.dispatch({ type: 'esc' })">Open Settings</button>
        </div>
      </div>
      <div class="client-tour-actions">
        <button v-if="step!.id !== 'nav'" type="button" class="back" @click="tour.dispatch({ type: 'back' })">◂ Back</button>
        <button type="button" class="skip" @click="tour.dispatch({ type: 'skip' })">Skip walkthrough</button>
        <button v-if="!step!.waits" type="button" class="primary" @click="tour.dispatch({ type: 'next' })">Next</button>
      </div>
    </section>
    <section v-if="layout.mini && focusBlade" class="client-tour-mini" role="note" :data-blade="focusBlade"
      :style="{ left: layout.mini.x + 'px', top: layout.mini.y + 'px' }">
      <strong>{{ BLADE_LABEL[focusBlade] }}</strong>
      <p>{{ BLADE_INFO[focusBlade] }}</p>
    </section>
  </div>
  </Teleport>
  <Teleport to="body">
    <ThirdPartyDisclaimer v-if="visible && tour.disclaimerOpen.value" :twitch-url="twitchUrl" :style="colorblindStyle"
      @play="tour.dispatch({ type: 'acknowledged' })" @back="tour.dispatch({ type: 'back' })" />
  </Teleport>
</template>

<style scoped>
/* Above the Details popup (z 200) and its Dice pane (z 210), so the card stays readable over them; the layer itself
   lets every click through, so the blades and the Settings dialog stay usable. */
.client-tour-layer { position: fixed; inset: 0; z-index: 220; pointer-events: none; font-family: var(--ui-font, 'Nuffle', system-ui, sans-serif); }
.client-tour-arrows { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.ring { fill: none; stroke: #f0383f; stroke-width: 3; filter: drop-shadow(0 0 6px rgba(240, 56, 63, 0.75)); }
.arrow { stroke: #f0383f; stroke-width: 4; stroke-linecap: round; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8)); }
.head { fill: #f0383f; }
/* Same look and size as the site walkthrough's cards (home_tour_runtime.js). */
.client-tour-card {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: min(640px, max(480px, 46vw), calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  padding: 24px 26px 20px;
  color: #f3eee2;
  font-size: 17px;
  line-height: 1.55;
  background: #151818;
  border: 1px solid #762025;
  border-top: 3px solid #f0383f;
  border-radius: 8px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.65);
  pointer-events: auto;
}
.client-tour-title { flex: none; margin: 0 0 12px; color: #ff3b3b; font-size: 22px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.client-tour-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.client-tour-body p { margin: 0 0 10px; }
.client-tour-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 8px; }
.client-tour-chip { padding: 5px 12px; color: #f3eee2; font: inherit; font-size: 15px; background: #202323; border: 1px solid #3a3f44; border-radius: 999px; cursor: pointer; }
.client-tour-chip[data-read='true'] { border-color: #f0383f; }
.client-tour-chip .tick { margin-right: 6px; color: #7ddc8a; }
.client-tour-info { padding: 8px 12px; background: #202323; border-left: 3px solid #f0383f; border-radius: 4px; }
.client-tour-esc { display: flex; align-items: center; gap: 12px; }
.client-tour-esc kbd { padding: 4px 10px; font: inherit; font-size: 15px; font-weight: 700; color: #151818; background: #f3eee2; border-radius: 5px; box-shadow: 0 3px 0 #8a857a; }
.client-tour-actions { flex: none; display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; align-items: center; margin-top: 14px; }
.client-tour-card button { font: inherit; font-size: 15px; letter-spacing: 0.05em; border-radius: 6px; cursor: pointer; padding: 8px 18px; }
.client-tour-card button.primary { color: #fff; background: linear-gradient(180deg, #bd3038, #9b2027 48%, #4b1015); border: 1px solid #ec5d63; }
.client-tour-card button.secondary { color: #f3eee2; background: #202323; border: 1px solid #762025; }
.client-tour-card button.back { color: #f3eee2; background: none; border: 1px solid #3a3f44; }
.client-tour-card button.skip { margin-right: auto; color: #aaa59b; background: none; border: none; padding: 8px 4px; text-decoration: underline; }
.client-tour-mini {
  position: absolute;
  box-sizing: border-box;
  width: 320px;
  padding: 12px 14px;
  color: #f3eee2;
  font-size: 15px;
  line-height: 1.45;
  background: #1c2020;
  border: 1px solid #f0383f;
  border-radius: 8px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.6);
  pointer-events: auto;
}
.client-tour-mini strong { display: block; margin-bottom: 4px; color: #ff3b3b; letter-spacing: 0.06em; }
.client-tour-mini p { margin: 0; }
/* Multi-arrow steps: a numbered chip at each target (its legend is on the card). */
.client-tour-chip-n {
  position: absolute;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  transform: translate(-50%, -50%);
  color: #fff;
  font: 700 12px/1 system-ui, 'Segoe UI', Arial, sans-serif;
  background: #9b2027;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.7);
}
.client-tour-chip-n.inline { position: static; transform: none; margin-right: 6px; flex: none; }
.client-tour-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 4px 0 8px; padding: 0; list-style: none; font-size: 15px; }
.client-tour-legend li { display: inline-flex; align-items: center; }
/* HUD step labels: a pill above (or below) each arrow target. */
.client-tour-label {
  position: absolute;
  transform: translate(-50%, -100%);
  max-width: 300px;
  padding: 3px 10px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
  white-space: nowrap;
  background: #9b2027;
  border: 1px solid #ec5d63;
  border-radius: 999px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
}
.client-tour-label[data-above='false'] { transform: translate(-50%, 0); }
.client-tour-label[data-long='true'] { width: 280px; white-space: normal; font-weight: 400; line-height: 1.35; text-align: left; border-radius: 8px; }
</style>
