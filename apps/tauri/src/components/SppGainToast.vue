<script setup lang="ts">
import { onBeforeUnmount, reactive, watch } from 'vue';
import type { SppGainOccurrence } from '../game/sppGainPresentation';
import { createTokenToastFollower, type TokenScreenPosition } from '../game/tokenToastFollower';

const props = defineProps<{
  occurrence: SppGainOccurrence;
  playerScreenPos: (playerId: string) => TokenScreenPosition | null | undefined;
}>();

const position = reactive({ x: 0, y: 0, ready: false });
const follower = createTokenToastFollower({
  playerScreenPos: (playerId) => props.playerScreenPos(playerId),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
  setTimer: (callback, durationMs) => window.setTimeout(callback, durationMs),
  clearTimer: (timer) => window.clearTimeout(timer),
  onPosition: (next) => {
    position.x = next.x;
    position.y = next.y - 52; // owner 09-05: the anchor is now the HEAD TOP — banner body + pointer sit above it
    position.ready = true;
  },
  onClear: () => { position.ready = false; },
});

watch(() => props.occurrence.seq, () => follower.show(props.occurrence.playerId, 3200), { immediate: true });
onBeforeUnmount(follower.clear);
</script>

<template>
  <div v-if="position.ready" class="spp-splash" :data-player-id="occurrence.playerId"
    :style="{ left: position.x + 'px', top: position.y + 'px' }"
    :aria-label="`Earned ${occurrence.delta} SPP`">
    <span class="spp-burst" aria-hidden="true">✦</span>
    <span class="spp-copy"><b>SPP</b><strong>+{{ occurrence.delta }} SPP</strong></span>
    <span class="spp-burst" aria-hidden="true">✦</span>
  </div>
</template>

<style scoped>
.spp-splash {
  position: absolute;
  z-index: 41;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 5px;
  width: max-content;
  max-width: min(190px, calc(100vw - 16px));
  padding: 5px 7px 6px;
  border: 3px solid #f8e36a;
  outline: 2px solid #532e82;
  outline-offset: -5px;
  border-radius: 3px;
  background: repeating-linear-gradient(0deg, #24134d 0 3px, #321c68 3px 6px);
  box-shadow: 0 4px 0 #080510, 0 8px 18px #000b, 0 0 12px #f8e36a88;
  color: #fff7a8;
  font-family: 'Nuffle', system-ui, sans-serif;
  text-align: center;
  image-rendering: pixelated;
  pointer-events: none;
  white-space: nowrap;
  animation: spp-pop 320ms steps(4, end), spp-pulse 720ms steps(2, end) 340ms 2;
}
.spp-splash::after {
  content: '';
  position: absolute;
  top: calc(100% + 3px);
  left: 50%;
  width: 0;
  height: 0;
  transform: translateX(-50%);
  border: 8px solid transparent;
  border-top: 12px solid #f8e36a;
  filter: drop-shadow(0 2px 0 #12072a) drop-shadow(0 0 4px #7ee8ffaa);
}
.spp-copy { display: flex; flex-direction: column; line-height: 1; text-shadow: 2px 2px 0 #12072a; }
.spp-copy b { font-size: max(var(--ui-min-text-size, 12px), 0.62rem); letter-spacing: 0.16em; color: #7ee8ff; }
.spp-copy strong { margin-top: 3px; font-size: max(var(--ui-min-primary-text-size, 16px), 0.94rem); letter-spacing: 0.06em; }
.spp-burst { color: #fff; font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem); text-shadow: 0 0 7px #7ee8ff; }
@keyframes spp-pop {
  from { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.6); }
  to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
}
@keyframes spp-pulse { 50% { filter: brightness(1.35); } }
</style>
