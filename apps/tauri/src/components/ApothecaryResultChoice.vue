<script setup lang="ts">
import { computed, type CSSProperties } from 'vue';
import PitchConfirmationPanel from './PitchConfirmationPanel.vue';

export interface ApothecaryResultChoiceView {
  player: string;
  side: 'home' | 'away';
  oldInjury: string;
  newInjury: string;
  oldRoll: number | null;
  newRoll: number | null;
  mine: boolean;
}

const props = defineProps<{ choice: ApothecaryResultChoiceView; iconUrl: string; positionStyle?: CSSProperties }>();
// Owner: the card matches the PRIMARY apothecary card's sizing — content-hugging, not a fixed 460px —
// so the injury names always sit on one line.
const panelStyle = computed<CSSProperties>(() => ({
  position: 'absolute', zIndex: 48, top: '42%', width: 'fit-content', minWidth: '280px', maxWidth: 'calc(100% - 32px)',
  borderLeft: `4px solid ${props.choice.mine ? '#496fdd' : '#cf4545'}`,
  ...props.positionStyle,
}));
const seatClass = computed(() => props.choice.mine ? 'seat-local' : 'seat-opposition');
defineEmits<{ choose: [pick: 'old' | 'new']; dragStart: [event: PointerEvent] }>();
</script>

<template>
  <PitchConfirmationPanel class="apo-result-choice" :class="[seatClass, { readonly: !choice.mine }]"
    title="Choose Injury Result" label="Apothecary injury result choice" :position-style="panelStyle" draggable
    test-id="apothecary-result-choice" @drag-start="$emit('dragStart', $event)">
    <div class="apo-result-head">
      <span class="apo-result-icon"><img :src="iconUrl" alt="" /></span>
      <span><span class="apo-result-kicker">{{ choice.mine ? 'Your apothecary re-roll' : 'Opposition apothecary re-roll' }}</span><strong>{{ choice.player }}</strong></span>
    </div>
    <div class="apo-results">
      <!-- Owner: the D16 roll values are gone (the injury names carry the choice); names render one-line. -->
      <button type="button" class="apo-result original" :disabled="!choice.mine"
        @pointerdown.stop @click.stop="$emit('choose', 'old')">
        <span class="apo-result-label">Original</span>
        <strong>{{ choice.oldInjury }}</strong>
      </button>
      <button type="button" class="apo-result rerolled" :disabled="!choice.mine"
        @pointerdown.stop @click.stop="$emit('choose', 'new')">
        <span class="apo-result-label">Re-Rolled</span>
        <strong>{{ choice.newInjury }}</strong>
      </button>
    </div>
    <div class="apo-result-help">{{ choice.mine ? 'Choose which authoritative injury result to keep.' : 'Waiting for the injured coach to choose…' }}</div>
  </PitchConfirmationPanel>
</template>

<style scoped>
.apo-result-choice { z-index: 48; top: 42%; width: fit-content; min-width: 280px; max-width: calc(100% - 32px); border-left: 4px solid var(--seat-home-mid, #003eb3); }
.apo-result-choice.seat-opposition { border-left-color: var(--seat-away-mid, #b30000); }
.apo-result-head { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; }
.apo-result-head > span:last-child { display: flex; min-width: 0; flex-direction: column; }
.apo-result-head strong { overflow: hidden; color: var(--ui-text); font-size: max(var(--ui-min-primary-text-size, 16px), 0.94rem); text-overflow: ellipsis; white-space: nowrap; }
.apo-result-icon { display: grid; width: 46px; height: 46px; flex: 0 0 46px; place-items: center; border: 1px solid #6d8c77; border-radius: 5px; background: linear-gradient(145deg, #26352c, #090d0a); }
.apo-result-icon img { width: 40px; height: 40px; object-fit: contain; image-rendering: pixelated; }
.apo-result-kicker { color: var(--seat-home-text, #4a86fe); font-size: max(var(--ui-min-text-size, 12px), 0.61rem); font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; }
.seat-opposition .apo-result-kicker { color: var(--seat-away-text, #fe6666); }
/* Owner reflow: the two result buttons size to their one-line content (the card hugs them), wrapping
   only when the pitch is genuinely too narrow. */
.apo-results { display: flex; flex-wrap: wrap; gap: 10px; width: 100%; margin-top: 8px; }
.apo-result { display: flex; flex: 1 1 auto; min-width: 0; min-height: 62px; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 8px 12px; color: var(--ui-text); border: 2px outset #59636e; border-radius: 5px; background: linear-gradient(180deg, #222931, #0c1015); font: inherit; cursor: pointer; }
.apo-result.original { border-color: #a58a47; }
.apo-result.rerolled { border-color: #5c9d6b; }
.apo-result:not(:disabled):hover { filter: brightness(1.18); }
.apo-result:disabled { opacity: 0.78; cursor: default; }
.apo-result-label { color: #e4c56e; font-size: max(var(--ui-min-text-size, 12px), 0.63rem); font-weight: 950; letter-spacing: 0.13em; text-transform: uppercase; }
.rerolled .apo-result-label { color: #78d58e; }
/* Owner: injury names on ONE line — the anywhere-wrap that shredded "Seriously Hurt" letter-per-line is gone. */
.apo-result strong { white-space: nowrap; color: #f3f5f7; font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem); }
.apo-result-help { width: 100%; margin-top: 7px; color: #aeb8c5; font-size: max(var(--ui-min-text-size, 12px), 0.68rem); font-weight: 800; text-align: center; }
:global(.hud-chrome) .apo-result-choice { border-top-color: #727d89; border-bottom-color: #080a0c; }
:global(.hud-minimalist) .apo-result-choice { border-width: 1px 1px 1px 4px; background: rgba(11, 18, 14, 0.92); }
</style>
