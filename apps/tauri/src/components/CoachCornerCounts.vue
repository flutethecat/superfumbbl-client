<script setup lang="ts">
// Owner 10-06: the "N RES / N OUT" tab that hangs off a coach corner panel. It is a CHILD of `.coach-panel`
// (absolutely positioned against the panel's outer edge), so the panel's move / resize / active-turn grow carry it;
// it has no grip of its own. DOM text stays vector-crisp at any panel scale — nothing here is rasterised.
// Right-click closes BOTH tabs (settings.coachCornerCounts = false) with a short notice; left-click does nothing.
import { settings } from '../game/settings';
import { COACH_CORNER_COUNTS_HIDDEN_NOTICE } from '../game/dugoutCounts';

const props = defineProps<{
  side: 'home' | 'away';
  reserves: number;
  out: number;
  /** Short non-blocking notice (SpectateView passes its chat-toast-stack helper). */
  notify?: (text: string) => void;
}>();

function hide(): void {
  settings.coachCornerCounts = false;
  props.notify?.(COACH_CORNER_COUNTS_HIDDEN_NOTICE);
}
</script>

<template>
  <!-- data-panel-overhang: the panel's move/resize clamps include this tab (SpectateView panelOverhang).
       pointerdown.prevent keeps focus where it was (a left-click must not blur the chat input). -->
  <div v-if="settings.coachCornerCounts" class="coach-corner-counts" :data-side="side" data-panel-overhang
    role="status" :aria-label="`${reserves} in reserves, ${out} out of the game`"
    title="Reserves / Out of the game (right-click to hide)"
    @click.stop.prevent @pointerdown.stop.prevent @contextmenu.stop.prevent="hide">
    <span class="ccc-row" data-kind="res"><b class="ccc-n">{{ reserves }}</b><span class="ccc-label">RES</span></span>
    <span class="ccc-row" data-kind="out"><b class="ccc-n">{{ out }}</b><span class="ccc-label">OUT</span></span>
  </div>
</template>

<style scoped>
/* The plate matches the panel's inner resource tiles (.inducement): dark bevelled gradient, 1 px light top edge.
   The panel's own --hud-coach-opacity (inherited from .pitch-host) drives its translucency. */
.coach-corner-counts {
  position: absolute;
  bottom: 8px;
  z-index: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  box-sizing: border-box;
  padding: 3px 7px 3px 6px;
  background: linear-gradient(180deg,
    rgb(41 45 51 / var(--hud-coach-opacity, 0.9)),
    rgb(17 19 23 / var(--hud-coach-opacity, 0.9)));
  border: 2px solid #353b44;
  box-shadow: inset 0 1px 0 #626a75, 0 3px 0 #050607, 0 5px 10px #000a;
  font-family: var(--ui-font, 'Nuffle', system-ui, sans-serif);
  line-height: 1;
  text-transform: uppercase;
  white-space: nowrap;
  pointer-events: auto;
  cursor: default;
  user-select: none;
}
/* Hangs off the panel's outer side, overlapping the panel border by 2 px (home: right, away: mirrored left). */
.coach-corner-counts[data-side='home'] { left: calc(100% - 2px); border-left-width: 1px; border-radius: 0 4px 4px 0; }
.coach-corner-counts[data-side='away'] { right: calc(100% - 2px); border-right-width: 1px; border-radius: 4px 0 0 4px; }
.ccc-row { display: flex; align-items: baseline; justify-content: flex-end; gap: 4px; }
.ccc-n {
  min-width: 1.1em;
  text-align: right;
  font-size: max(calc(var(--ui-min-text-size, 12px) + 1px), 13px);
  font-weight: 900;
  color: #fff;
  text-shadow: 0 1px 1px #000, 0 0 2px #000;
}
.ccc-label {
  font-size: max(calc(var(--ui-min-text-size, 12px) - 1px), 11px);
  font-weight: 800;
  letter-spacing: 0.05em;
  color: #d8d4c8;
  text-shadow: 0 1px 1px #000;
}
.ccc-row[data-kind='out'] .ccc-label { color: #f0b0a8; }

/* Console Chrome: the molded casing language of the panel's inner wells. */
:global(.pitch-host.hud-chrome .coach-corner-counts) {
  border: 2px solid #343b44;
  background: linear-gradient(145deg,
    rgb(48 54 62 / var(--hud-coach-opacity, 0.9)) 0 18%,
    rgb(11 14 18 / var(--hud-coach-opacity, 0.9)) 18% 82%,
    rgb(36 42 49 / var(--hud-coach-opacity, 0.9)) 82%);
  box-shadow: inset 0 2px 3px #000, inset 0 -1px 0 #727b8555, 0 2px 0 #030405, 0 5px 10px #000b;
}
:global(.pitch-host.hud-chrome .coach-corner-counts[data-side='home']) { left: calc(100% - 1px); border-left-width: 1px; border-radius: 0 5px 2px 0; }
:global(.pitch-host.hud-chrome .coach-corner-counts[data-side='away']) { right: calc(100% - 1px); border-right-width: 1px; border-radius: 5px 0 0 2px; }
/* Minimalist: the flatter, tighter HUD. */
:global(.pitch-host.hud-minimalist .coach-corner-counts) { padding: 2px 6px 2px 5px; box-shadow: inset 0 1px 0 #626a75, 0 2px 4px #0009; }
</style>
