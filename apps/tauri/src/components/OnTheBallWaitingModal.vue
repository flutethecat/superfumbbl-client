<script setup lang="ts">
import type { CSSProperties } from 'vue';

// Owner 09-06: the notice docks directly under the top-centre panel at that panel's width (positionStyle from
// SpectateView) and is movable — the card takes pointer events only when draggable; the backdrop never does.
withDefaults(defineProps<{ message: string; positionStyle?: CSSProperties; draggable?: boolean }>(), {
  positionStyle: undefined,
  draggable: false,
});
defineEmits<{ dragStart: [event: PointerEvent] }>();
</script>

<template>
  <div class="on-the-ball-waiting-backdrop" data-testid="on-the-ball-waiting-backdrop">
    <section class="on-the-ball-waiting" :class="{ anchored: !!positionStyle, draggable }" :style="positionStyle"
      role="status" aria-live="polite"
      aria-labelledby="on-the-ball-waiting-title" aria-describedby="on-the-ball-waiting-message"
      data-testid="on-the-ball-waiting" :title="draggable ? 'Drag to move' : undefined"
      @pointerdown="draggable && $emit('dragStart', $event)">
      <h2 id="on-the-ball-waiting-title">On the Ball</h2>
      <p id="on-the-ball-waiting-message">{{ message }}</p>
    </section>
  </div>
</template>

<style scoped>
.on-the-ball-waiting-backdrop {
  position: absolute;
  z-index: 47;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  background: transparent;
}
.on-the-ball-waiting {
  box-sizing: border-box;
  max-width: min(420px, calc(100% - 32px));
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: #f3f0e6;
  background: rgba(14, 18, 26, 0.96);
  border: 1px solid rgba(150, 175, 210, 0.5);
  border-radius: 10px;
  box-shadow: 0 8px 28px #000c;
  pointer-events: none;
  text-align: center;
}
/* Owner 09-06: docked under the top-centre panel (left/top/width from SpectateView) instead of screen-centred. */
.on-the-ball-waiting.anchored { position: absolute; max-width: none; }
.on-the-ball-waiting.draggable { pointer-events: auto; cursor: move; user-select: none; }
.on-the-ball-waiting h2 {
  margin: 0;
  color: #f15b64;
  font-size: max(var(--ui-min-primary-text-size, 16px), 18px);
  line-height: 1.2;
  text-transform: uppercase;
}
.on-the-ball-waiting p {
  margin: 0;
  font-size: max(var(--ui-min-primary-text-size, 16px), 15px);
  line-height: 1.35;
  overflow-wrap: anywhere;
}
</style>
