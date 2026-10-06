<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { blockDieLogSymbol, isBlockDieFaceValue } from '../game/blockDieLog';
import { blockDieSymbolUrl } from '../game/blockDieFaceArt';
import { settings } from '../game/settings';

const props = defineProps<{
  value: number;
  result: string;
}>();

// Owner 09-08: the log draws the 64 px content-trimmed faces (`*-64.png`, Lanczos from the owner masters that sit
// beside them) — the 1254 px masters sampled nearest-neighbour down to ~19 px lost most of the art (decimated).
// Owner 10-06: the set follows the bundled block-dice family (Settings > Asset packs > Block dice).
const valid = computed(() => isBlockDieFaceValue(props.value));
const symbol = computed(() => isBlockDieFaceValue(props.value) ? blockDieLogSymbol(props.value) : null);
const url = computed(() => symbol.value ? blockDieSymbolUrl(symbol.value, settings.blockDiceFamily) : '');
const failed = ref(false);
watch(() => [props.value, settings.blockDiceFamily], () => { failed.value = false; });
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
