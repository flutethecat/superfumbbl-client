<script setup lang="ts">
import { onBeforeUnmount, reactive, watch } from 'vue';
import {
  createTokenToastFollower,
  WATCH_OUT_TOAST_COPY,
  type TokenScreenPosition,
} from '../game/tokenToastFollower';

const props = defineProps<{
  occurrence: { playerId: string; seq: number } | null;
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
    position.y = next.y - 52;
    position.ready = true;
  },
  onClear: () => { position.ready = false; },
});

watch(
  () => props.occurrence?.seq,
  () => {
    if (!props.occurrence) { follower.clear(); return; }
    follower.show(props.occurrence.playerId, 3000);
  },
);
onBeforeUnmount(follower.clear);
</script>

<template>
  <div v-if="occurrence && position.ready" class="watch-out-toast"
    :style="{ left: position.x + 'px', top: position.y + 'px' }">
    {{ WATCH_OUT_TOAST_COPY }}
  </div>
</template>

<style scoped>
.watch-out-toast {
  position: absolute;
  z-index: 40;
  transform: translateX(-50%);
  max-width: min(19rem, calc(100% - 16px));
  padding: 5px 12px;
  border: 1px solid color-mix(in srgb, var(--ui-accent, #f5c542) 70%, transparent);
  border-radius: 11px;
  background: color-mix(in srgb, #17130a 92%, var(--ui-accent, #f5c542) 8%);
  box-shadow: 0 4px 14px #000b, 0 0 10px color-mix(in srgb, var(--ui-accent, #f5c542) 22%, transparent);
  color: var(--ui-heading, #ffd97a);
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.86rem);
  font-weight: 800;
  line-height: 1.15;
  text-align: center;
  white-space: nowrap;
  pointer-events: none;
  animation: watch-out-in 280ms ease-out;
}

@keyframes watch-out-in {
  from { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.96); }
  to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
}
</style>
