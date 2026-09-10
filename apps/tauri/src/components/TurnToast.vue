<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { fumbblAsset } from '../game/jnlpRouting';

export interface TurnToastPresentation {
  turn: number;
  side: 'home' | 'away';
  context: 'normal' | 'afterTurnover';
  coach: string;
  logoUrl: string | null;
  baseIconPath: string | null;
  seq: number;
}

const props = defineProps<{ toast: TurnToastPresentation }>();

const logoFailed = ref(false);
watch(
  () => [props.toast.seq, props.toast.logoUrl, props.toast.baseIconPath],
  () => { logoFailed.value = false; },
);

const followsTurnover = computed(() => props.toast.context === 'afterTurnover');
const label = computed(() => followsTurnover.value
  ? `${props.toast.coach}'s Turn ${props.toast.turn}`
  : `Turn ${props.toast.turn}`);
const logoSrc = computed(() => {
  if (logoFailed.value) return null;
  return fumbblAsset(props.toast.logoUrl ?? undefined, props.toast.baseIconPath ?? undefined);
});
</script>

<template>
  <div class="turn-toast" :data-side="toast.side" :data-context="toast.context"
    role="status" aria-live="polite" aria-atomic="true"
    :title="label" :aria-label="label">
    <img v-if="followsTurnover && logoSrc" class="turn-toast-logo" :src="logoSrc" alt="" aria-hidden="true"
      @error="logoFailed = true" />
    <span class="turn-toast-label">
      <template v-if="followsTurnover">
        <span class="turn-toast-coach">{{ toast.coach }}</span>
        <span class="turn-toast-suffix">'s Turn {{ toast.turn }}</span>
      </template>
      <span v-else class="turn-toast-plain">Turn {{ toast.turn }}</span>
    </span>
  </div>
</template>

<style scoped>
.turn-toast {
  justify-self: end;
  align-self: stretch;
  margin-inline-end: var(--turn-toast-inset, clamp(16px, 9vw, 120px));
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  width: fit-content;
  height: 100%;
  min-width: 0;
  max-width: min(760px, calc(100% - var(--turn-toast-side-room, clamp(32px, 18vw, 240px))));
  padding: 8px 20px;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 11px;
  background: linear-gradient(120deg, #7a0c0cf2, #300f0fe8);
  border: 2px solid #e03030cc;
  box-shadow: 0 6px 26px #000b, 0 0 22px #e0303044;
  pointer-events: none;
  white-space: nowrap;
  animation: turn-toast-life var(--p-3000) ease-in-out forwards;
}
.turn-toast[data-side='home'] {
  background: linear-gradient(120deg, #0c1e7af2, #0a1030e8);
  border-color: #3a5be0cc;
  box-shadow: 0 6px 26px #000b, 0 0 22px #3a5be044;
}
.turn-toast-logo {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 2px 5px #000d);
}
.turn-toast-label {
  display: flex;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), clamp(1.15rem, 2.2vw, 1.9rem));
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  line-height: 1;
  color: #ffd7d7;
}
.turn-toast-coach {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.turn-toast-suffix { flex: none; }
.turn-toast-plain { flex: none; }
.turn-toast[data-side='home'] .turn-toast-label { color: #d7e0ff; }
@keyframes turn-toast-life {
  0% { opacity: 0; transform: translateX(40px); }
  10% { opacity: 1; transform: translateX(0); }
  85% { opacity: 1; transform: translateX(0); }
  100% { opacity: 0; transform: translateX(12px); }
}
@media (prefers-reduced-motion: reduce) {
  .turn-toast { animation: none; }
}
@media (max-width: 320px) {
  .turn-toast {
    --turn-toast-inset: 8px;
    --turn-toast-side-room: 16px;
    gap: 6px;
    padding-inline: 8px;
  }
  .turn-toast-logo {
    width: 28px;
    height: 28px;
    flex-basis: 28px;
  }
  .turn-toast-label { letter-spacing: 0.08em; }
}
</style>
