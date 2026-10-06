<script setup lang="ts">
import { computed, type CSSProperties } from 'vue';

// Owner 09-06: the notice docks directly under the top-centre panel at that panel's width (positionStyle from
// SpectateView) and is movable — the card takes pointer events only when draggable; the backdrop never does.
// S25 (09-29): `title`/`noticeId`/`zIndex` are optional so the Hail Mary Pass notice reuses the card; defaults keep On the Ball.
const props = withDefaults(defineProps<{
  message: string; positionStyle?: CSSProperties; draggable?: boolean; title?: string; noticeId?: string; zIndex?: number;
}>(), {
  positionStyle: undefined,
  draggable: false,
  title: 'On the Ball',
  noticeId: 'on-the-ball-waiting',
  zIndex: undefined,
});
defineEmits<{ dragStart: [event: PointerEvent] }>();
/** Owner 10-02: "wrap after 'selecting'" - a "<who> is selecting / repositioning players for ..." line breaks after
 *  the verb and the card shrinks to its two lines (centred under the panel) instead of spanning the panel's width. */
const lines = computed<string[] | null>(() => {
  // Owner 10-06: the push notice breaks after the coach name ("Waiting for Jayward" / "to choose a push direction")
  // and the plate fits those two lines instead of wrapping a long single line.
  const m = /^(.+? is (?:selecting|repositioning)) (players .+)$/.exec(props.message)
    ?? /^(Waiting for .+?) (to choose a push direction)$/.exec(props.message);
  return m ? [m[1]!, m[2]!] : null;
});
</script>

<template>
  <div class="on-the-ball-waiting-backdrop" :data-testid="`${noticeId}-backdrop`" :style="zIndex ? { zIndex } : undefined">
    <!-- Owner 10-02: a two-line notice keeps the panel-wide frame (position + drag anchor) but the card fits its text. -->
    <div v-if="lines && positionStyle" class="on-the-ball-waiting-fit-frame" :style="positionStyle">
      <section class="on-the-ball-waiting fit" :class="{ draggable }"
        role="status" aria-live="polite"
        :aria-labelledby="`${noticeId}-title`" :aria-describedby="`${noticeId}-message`"
        :data-testid="noticeId" :title="draggable ? 'Drag to move' : undefined"
        @pointerdown="draggable && $emit('dragStart', $event)">
        <h2 :id="`${noticeId}-title`">{{ title }}</h2>
        <p :id="`${noticeId}-message`" :aria-label="message"><span v-for="(line, i) in lines" :key="i" class="otb-line">{{ line }}</span></p>
      </section>
    </div>
    <section v-else class="on-the-ball-waiting" :class="{ anchored: !!positionStyle, draggable }" :style="positionStyle"
      role="status" aria-live="polite"
      :aria-labelledby="`${noticeId}-title`" :aria-describedby="`${noticeId}-message`"
      :data-testid="noticeId" :title="draggable ? 'Drag to move' : undefined"
      @pointerdown="draggable && $emit('dragStart', $event)">
      <h2 :id="`${noticeId}-title`">{{ title }}</h2>
      <p :id="`${noticeId}-message`">{{ message }}</p>
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
/* Owner 10-02: the frame carries the docked position (panel-wide, no box); the card inside fits its two lines, centred. */
.on-the-ball-waiting-fit-frame { position: absolute; display: flex; justify-content: center; pointer-events: none; }
.on-the-ball-waiting.fit { width: max-content; max-width: 100%; padding: 10px 18px; }
.on-the-ball-waiting.fit .otb-line { display: block; white-space: nowrap; }
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
