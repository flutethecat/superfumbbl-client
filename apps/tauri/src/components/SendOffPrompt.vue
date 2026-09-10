<script setup lang="ts">
import { computed, type CSSProperties } from 'vue';
import PitchConfirmationPanel from './PitchConfirmationPanel.vue';

const props = defineProps<{
  playerName: string;
  canArgue: boolean;
  canBribe: boolean;
  refereeIconUrl: string;
  /** Owner 09-05: the player's position, as a subtext line under the name. */
  positionName?: string;
  coinIconUrl: string;
  positionStyle?: CSSProperties;
}>();

const panelStyle = computed<CSSProperties>(() => ({
  position: 'absolute',
  zIndex: 48,
  top: '42%',
  width: 'min(390px, calc(100% - 32px))',
  ...props.positionStyle,
}));

defineEmits<{
  argue: [];
  bribe: [];
  pass: [];
  dragStart: [event: PointerEvent];
}>();
</script>

<template>
  <PitchConfirmationPanel class="sendoff-prompt" title="Spotted by the Ref!"
    label="Referee send-off decision" :position-style="panelStyle" draggable
    test-id="sendoff-prompt" @drag-start="$emit('dragStart', $event)">
    <div class="sendoff-summary">
      <span class="sendoff-ref-frame" aria-hidden="true">
        <img :src="refereeIconUrl" class="sendoff-ref" alt="" />
      </span>
      <span class="sendoff-copy">
        <span class="sendoff-kicker">Referee decision</span>
        <strong class="sendoff-player">{{ playerName }}</strong>
        <span v-if="positionName" class="sendoff-position">{{ positionName }}</span>
        <span class="sendoff-instruction">Choose how to answer the call.</span>
      </span>
    </div>
    <template #actions>
      <button v-if="canArgue" type="button" class="sendoff-btn sendoff-action argue"
        @pointerdown.stop @click.stop="$emit('argue')">
        <span aria-hidden="true">⚖</span> Argue the call
      </button>
      <button v-if="canBribe" type="button" class="sendoff-btn sendoff-action bribe"
        @pointerdown.stop @click.stop="$emit('bribe')">
        <img :src="coinIconUrl" class="sendoff-coin" alt="" /> Bribe
      </button>
      <button type="button" class="sendoff-btn sendoff-action pass"
        @pointerdown.stop @click.stop="$emit('pass')">Pass</button>
    </template>
  </PitchConfirmationPanel>
</template>

<style scoped>
.sendoff-prompt {
  z-index: 48;
  top: 42%;
  width: min(390px, calc(100% - 32px));
  min-width: 0;
  padding: 11px 14px 13px;
}
.sendoff-summary {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
}
.sendoff-ref-frame {
  display: grid;
  width: 56px;
  height: 56px;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-heading) 58%, #53606e);
  border-radius: 6px;
  background: linear-gradient(145deg, #202832, #090d12);
  box-shadow: inset 0 1px 0 #ffffff22, 0 2px 7px #0009;
}
.sendoff-ref {
  width: 50px;
  height: 50px;
  object-fit: contain;
  image-rendering: pixelated;
}
.sendoff-copy { display: flex; min-width: 0; flex-direction: column; gap: 1px; }
.sendoff-kicker {
  color: var(--ui-heading);
  font-size: max(var(--ui-min-text-size, 12px), 0.62rem);
  font-weight: 900;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}
.sendoff-position { color: #a9b3bf; font-size: max(var(--ui-min-text-size, 12px), 0.66rem); line-height: 1.15; letter-spacing: 0.05em; text-transform: uppercase; }
.sendoff-player {
  overflow: hidden;
  color: var(--ui-text);
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.98rem);
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sendoff-instruction { color: color-mix(in srgb, var(--ui-text) 68%, transparent); font-size: max(var(--ui-min-text-size, 12px), 0.7rem); }
.sendoff-action {
  min-width: 94px;
  min-height: 32px;
  color: #f5f7fa;
  border: 1px solid #657180;
  background: linear-gradient(180deg, #424c58, #242b33);
}
.sendoff-action.argue { border-color: #688fc5; background: linear-gradient(180deg, #376bac, #244573); }
.sendoff-action.bribe { color: #17130a; border-color: #d5b865; background: linear-gradient(180deg, #e7c96d, #a57e27); }
.sendoff-action.pass { color: #c8d0da; }
.sendoff-coin { width: 17px; height: 17px; object-fit: contain; image-rendering: pixelated; }

:global(.hud-chrome) .sendoff-prompt {
  border-top-color: #727d89;
  border-bottom-color: #080a0c;
}
:global(.hud-chrome) .sendoff-prompt :deep(.pitch-confirm-title) {
  padding-bottom: 2px;
  border-bottom: 1px solid #76818c55;
}
:global(.hud-minimalist) .sendoff-prompt {
  padding: 12px 14px 13px;
  border-width: 1px;
  border-radius: 8px;
  background: rgba(13, 17, 23, 0.9);
}
:global(.hud-minimalist) .sendoff-ref-frame {
  border-color: color-mix(in srgb, var(--ui-accent) 42%, transparent);
  background: rgba(255, 255, 255, 0.035);
  box-shadow: none;
}
:global(.hud-minimalist) .sendoff-action {
  box-shadow: none;
}

@media (max-width: 520px) {
  .sendoff-prompt { width: calc(100% - 24px); }
  .sendoff-summary { grid-template-columns: 48px minmax(0, 1fr); gap: 9px; }
  .sendoff-ref-frame { width: 46px; height: 46px; }
  .sendoff-ref { width: 42px; height: 42px; }
  .sendoff-action { min-width: 76px; }
}
</style>
