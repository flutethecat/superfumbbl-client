<script setup lang="ts">
/**
 * Owner 11-04: a pop-out OVER the Coach Stats panel - the frame of the Action roll "Details" and the "Extra stats"
 * pop-outs (the general home for further stats: sections go in the slot). Same rules as the panel itself:
 * - a modal dialog: focus moves in on open and is trapped (Tab / Shift+Tab); Escape, the close button, a backdrop click
 *   or the controller's B close it, and the opener gets its focus back (the host does that on `close`);
 * - a pad scope one rank above the panel, so the controller drives the pop-out while it is up; the right stick and
 *   LB / RB scroll the focused table box (`.cs-scroll`) while it can still move that way, then the pop-out's body;
 * - Modern / Retro: the overlay is a `.cs-overlay` (lm-blades.css maps the Modern tokens onto it), so the host's table
 *   styles (slot content carries the host's scope) apply unchanged; the frame below copies the panel's two looks.
 * Static content, the entrance fade off under reduced motion; zero requests.
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { settings } from '../../../game/settings';
import { lmRootClass } from '../../../game/lmTheme';
import { motionReduced } from '../../../game/accessibilityModes';
import { PAD_FOCUS_PRIORITY, padFocusedControl, vPadFocus } from '../../../game/cardFocus';

const props = defineProps<{ title: string; closeLabel: string; testid: string }>();
const emit = defineEmits<{ close: [] }>();

const modern = computed(() => settings.uiStyle === 'modern');
const lmClass = computed(() => lmRootClass(settings.uiStyle));
const reduced = computed(() => motionReduced());
const root = ref<HTMLElement | null>(null);
const body = ref<HTMLElement | null>(null);
const closeBtn = ref<HTMLButtonElement | null>(null);
const titleId = computed(() => `${props.testid}-title`);

function close(): void { emit('close'); }
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
  if (event.key !== 'Tab' || !root.value) return;
  const stops = Array.from(root.value.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'));
  if (!stops.length) return;
  const first = stops[0]!, last = stops[stops.length - 1]!;
  const at = document.activeElement as HTMLElement | null;
  if (event.shiftKey && (at === first || !root.value.contains(at))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (at === last || !root.value.contains(at))) { event.preventDefault(); first.focus(); }
}
onMounted(() => { void nextTick(() => closeBtn.value?.focus()); });

/** The table box holding the controller (or DOM) focus while it can still scroll `dir`, else the body. A plain DOM
 *  read: it never refreshes the pad layer, so a scroll step cannot re-enter the router. */
function scrollTarget(dir: 'Up' | 'Down'): HTMLElement | null {
  for (const at of [padFocusedControl(), typeof document !== 'undefined' ? document.activeElement : null]) {
    const box = at instanceof HTMLElement ? at.closest<HTMLElement>('.cs-scroll') : null;
    if (box && root.value?.contains(box)) {
      const can = dir === 'Up' ? box.scrollTop > 0 : box.scrollTop + box.clientHeight < box.scrollHeight - 1;
      return can ? box : body.value;
    }
  }
  return body.value;
}
function page(dir: 1 | -1): void {
  const el = scrollTarget(dir > 0 ? 'Down' : 'Up');
  if (el) el.scrollTop += dir * Math.max(120, Math.round(el.clientHeight * 0.9));
}
const padOptions = computed(() => ({
  cancel: close, priority: PAD_FOCUS_PRIORITY.confirmation + 5, scroll: scrollTarget,
  keys: { LB: () => page(-1), RB: () => page(1) },
}));
</script>

<template>
  <Teleport to="body">
    <div class="cs-overlay csp-overlay" :class="lmClass" :data-motion="reduced ? 'reduced' : 'full'" @click.self="close">
      <section ref="root" v-pad-focus="padOptions" class="csp-panel" :class="{ 'lm-panel': modern }" role="dialog" aria-modal="true"
        :aria-labelledby="titleId" :data-testid="testid" @keydown="onKeydown">
        <header class="csp-head" :class="{ 'hm-band': modern }">
          <h2 :id="titleId">{{ title }}</h2>
          <button ref="closeBtn" type="button" class="csp-close" :class="{ 'sf-btn small': modern }" data-pad-cancel :aria-label="closeLabel" @click="close">&#x2715;</button>
        </header>
        <div ref="body" class="csp-body" :data-testid="`${testid}-body`"><slot /></div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
/* Owner 11-04: the panel's larger scale (CoachStatsPanel: type +20%, 1.2rem), a little narrower than the panel under it;
   at 1280 x 720 it is 1178 x 634 with its body scrolling inside. */
.csp-overlay { position: fixed; inset: 0; z-index: 215; display: flex; align-items: center; justify-content: center; padding: 3vh 16px; background: #05070c99; }
.csp-overlay[data-motion='full'] .csp-panel { animation: csp-in 160ms ease-out; }
@keyframes csp-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .csp-overlay .csp-panel { animation: none !important; } }
:global(html.sf-reduce-motion) .csp-panel { animation: none !important; }
.csp-panel { box-sizing: border-box; display: flex; flex-direction: column; width: min(1100px, 92vw); max-height: 88vh; overflow: hidden; font-size: 1.2rem; }
.csp-head { display: flex; align-items: center; gap: 12px; flex: none; }
.csp-head h2 { flex: 1 1 auto; min-width: 0; margin: 0; overflow-wrap: anywhere; }
.csp-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px 18px 18px; }
.csp-overlay.sf-lm .csp-panel > .hm-band { margin: 0; padding: 12px 18px 10px; }
.csp-overlay.sf-lm .csp-panel > .hm-band h2 { font-size: 1.65rem; }
.csp-overlay:not(.sf-lm) .csp-panel {
  border: 1px solid var(--ui-forest, #1A401C); border-radius: 8px; color: var(--ui-forest, #1A401C); background: var(--ui-old-lace, #F8F5E7);
  box-shadow: 0 20px 60px #000c;
}
.csp-overlay:not(.sf-lm) .csp-head { padding: 14px 20px; border-bottom: 1px solid color-mix(in srgb, var(--ui-forest, #1A401C) 30%, transparent); }
.csp-overlay:not(.sf-lm) .csp-head h2 { font-family: var(--font-display); font-size: 1.8rem; }
.csp-overlay:not(.sf-lm) .csp-close {
  min-height: 38px; padding: 0 14px; border: 1px solid var(--ui-forest, #1A401C); border-radius: 4px; color: var(--ui-forest, #1A401C);
  background: color-mix(in srgb, var(--ui-forest, #1A401C) 8%, transparent); font: inherit; cursor: pointer;
}
.csp-overlay:not(.sf-lm) .csp-close:focus-visible { outline: 2px solid var(--ui-focus, #ff3b3b); outline-offset: 2px; }
</style>
