<script setup lang="ts">
import { computed, type CSSProperties } from 'vue';
import PitchConfirmationPanel from './PitchConfirmationPanel.vue';

export interface ApothecaryAutoReturnView {
  player: string;
  side: 'home' | 'away';
  oldInjury: string;
  newInjury: string;
  oldRoll: number | null;
  newRoll: number | null;
  newInjuryDie: number | null;
  selected: 'old' | 'new';
  outcome: string;
  mine: boolean;
  audience: 'player' | 'spectator' | 'replay';
}

const props = defineProps<{
  result: ApothecaryAutoReturnView;
  iconUrl: string;
  portrait?: string | null;
  positionStyle?: CSSProperties;
}>();
const seatClass = computed(() => {
  if (props.result.audience === 'player') return props.result.mine ? 'seat-local' : 'seat-opposition';
  return `seat-${props.result.side}`;
});
const panelStyle = computed<CSSProperties>(() => ({
  position: 'absolute', zIndex: 49, top: '42%', width: 'min(480px, calc(100% - 32px))',
  ...props.positionStyle,
}));

defineEmits<{ dragStart: [event: PointerEvent] }>();
</script>

<template>
  <PitchConfirmationPanel class="apo-auto-return" :class="seatClass"
    title="Apothecary Treatment" label="Apothecary treatment result" :position-style="panelStyle"
    draggable test-id="apothecary-auto-return" @drag-start="$emit('dragStart', $event)">
    <div class="apo-auto-head">
      <span class="apo-auto-portrait"><img :src="portrait || iconUrl" alt="" /></span>
      <span><span class="apo-auto-kicker">Treatment resolved</span><strong>{{ result.player }}</strong></span>
      <span class="apo-auto-icon"><img :src="iconUrl" alt="" /></span>
    </div>
    <div class="apo-auto-results">
      <div class="apo-auto-result original" :class="{ selected: result.selected === 'old' }">
        <span>Original</span><strong>{{ result.oldInjury }}</strong>
        <small v-if="result.oldRoll != null">D16 · {{ result.oldRoll }}</small>
      </div>
      <div class="apo-auto-result rerolled" :class="{ selected: result.selected === 'new' }">
        <span>Re-Rolled</span><strong>{{ result.newInjury }}</strong>
        <small v-if="result.newRoll != null">D16 · {{ result.newRoll }}</small>
        <small v-if="result.newInjuryDie != null">Injury D6 · {{ result.newInjuryDie }}</small>
      </div>
    </div>
    <div class="apo-auto-outcome">{{ result.outcome }}</div>
  </PitchConfirmationPanel>
</template>

<style scoped>
.apo-auto-return { z-index: 49; top: 42%; width: min(480px, calc(100% - 32px)); min-width: 0; border-left: 4px solid var(--seat-home-mid, #003eb3); }
.apo-auto-return.seat-opposition, .apo-auto-return.seat-away { border-left-color: var(--seat-away-mid, #b30000); }
.apo-auto-head { position: relative; display: flex; align-items: center; gap: 10px; width: 100%; padding-right: 34px; text-align: left; }
.apo-auto-head > span:last-child { display: flex; min-width: 0; flex-direction: column; }
.apo-auto-head strong { color: var(--ui-text); font-size: max(var(--ui-min-primary-text-size, 16px), 0.94rem); overflow-wrap: anywhere; }
.apo-auto-portrait { display: grid; width: 58px; height: 58px; flex: 0 0 58px; place-items: center; overflow: hidden; border: 1px solid #6d8c77; border-radius: 5px; background: linear-gradient(145deg, #26352c, #090d0a); }
.apo-auto-portrait img { width: 54px; height: 54px; object-fit: contain; image-rendering: pixelated; }
.apo-auto-icon { position: absolute; top: 0; right: 0; display: grid; width: 28px; height: 28px; place-items: center; border: 1px solid #6d8c77; border-radius: 4px; background: #101813; }
.apo-auto-icon img { width: 24px; height: 24px; object-fit: contain; image-rendering: pixelated; }
.apo-auto-kicker { color: var(--seat-home-text, #4a86fe); font-size: max(var(--ui-min-text-size, 12px), 0.61rem); font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; }
.seat-opposition .apo-auto-kicker, .seat-away .apo-auto-kicker { color: var(--seat-away-text, #fe6666); }
.apo-auto-results { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; width: 100%; margin-top: 8px; }
.apo-auto-result { display: flex; min-width: 0; min-height: 80px; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 8px 10px; border: 2px outset #59636e; border-radius: 5px; background: linear-gradient(180deg, #222931, #0c1015); text-align: center; }
.apo-auto-result.original { border-color: #a58a47; }
.apo-auto-result.rerolled { border-color: #5c9d6b; }
.apo-auto-result.selected { box-shadow: 0 0 0 2px #f3d36c, 0 0 14px #f3d36c88; filter: brightness(1.13); }
.apo-auto-result span { color: #e4c56e; font-size: max(var(--ui-min-text-size, 12px), 0.63rem); font-weight: 950; letter-spacing: 0.13em; text-transform: uppercase; }
.apo-auto-result.rerolled span { color: #78d58e; }
.apo-auto-result strong { overflow-wrap: anywhere; color: #f3f5f7; font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem); }
.apo-auto-result small { color: #aeb8c5; font-size: max(var(--ui-min-text-size, 12px), 0.63rem); font-weight: 900; letter-spacing: 0.06em; }
.apo-auto-outcome { width: 100%; margin-top: 9px; padding: 8px 10px; color: #fff1b5; border: 1px solid #a58a47; border-radius: 4px; background: linear-gradient(180deg, #382f18, #171307); font-size: max(var(--ui-min-text-size, 12px), 0.76rem); font-weight: 900; text-align: center; }
:global(.hud-chrome) .apo-auto-return { border-top-color: #727d89; border-bottom-color: #080a0c; }
:global(.hud-minimalist) .apo-auto-return { border-width: 1px 1px 1px 4px; background: rgba(11, 18, 14, 0.92); box-shadow: 0 7px 22px #000b; }
@media (max-width: 480px) { .apo-auto-results { grid-template-columns: 1fr; } }
</style>
