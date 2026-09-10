<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { blockDieLogSymbol, isBlockDieFaceValue, type BlockDieLogSymbol } from '../game/blockDieLog';

const props = defineProps<{
  value: number;
  result: string;
}>();

// Owner 09-08: the log draws the 64 px content-trimmed faces (`*-64.png`, Lanczos from the owner masters that sit
// beside them) — the 1254 px masters sampled nearest-neighbour down to ~19 px lost most of the art (decimated).
const symbolUrls: Record<BlockDieLogSymbol, string> = {
  'attacker-down': new URL('../assets/blockdice-log/attacker-down-64.png', import.meta.url).href,
  'both-down': new URL('../assets/blockdice-log/both-down-64.png', import.meta.url).href,
  push: new URL('../assets/blockdice-log/push-64.png', import.meta.url).href,
  'defender-stumbles': new URL('../assets/blockdice-log/defender-stumbles-64.png', import.meta.url).href,
  pow: new URL('../assets/blockdice-log/pow-64.png', import.meta.url).href,
};

const valid = computed(() => isBlockDieFaceValue(props.value));
const symbol = computed(() => isBlockDieFaceValue(props.value) ? blockDieLogSymbol(props.value) : null);
const url = computed(() => symbol.value ? symbolUrls[symbol.value] : '');
const failed = ref(false);
watch(() => props.value, () => { failed.value = false; });
</script>

<template>
  <span v-if="valid" class="block-die-face" :data-symbol="symbol" role="img" :aria-label="result">
    <span class="block-die-result">{{ result }}</span>
    <img v-if="!failed" :src="url" alt="" aria-hidden="true" @error="failed = true" />
    <span v-else class="block-die-fallback" :data-value="value" aria-hidden="true"></span>
  </span>
  <span v-else>{{ result }}</span>
</template>

<style scoped>
.block-die-face {
  display: inline-block;
  position: relative;
  width: var(--block-die-size, 1.8em);
  height: var(--block-die-size, 1.8em);
  overflow: hidden;
  vertical-align: middle;
  flex: none;
}
.block-die-face img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: auto; /* owner 09-08: smooth minification of the 64 px face (pixelated decimated it) */
}
.block-die-result {
  position: absolute;
  inset: 0;
  color: transparent;
  white-space: nowrap;
  user-select: text;
}
.block-die-fallback {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  border: 1px solid currentColor;
  border-radius: 20%;
  font-weight: 800;
  line-height: 1;
}
.block-die-fallback::after {
  content: attr(data-value);
}
</style>
