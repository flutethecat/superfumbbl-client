<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { d6FaceUrl, d6FaceVisualScale, isD6FaceValue, type D6FaceVariant } from '@fumbbl40k/ffb-pitch';
import { settings } from '../game/settings';

const props = withDefaults(defineProps<{
  value: number;
  label?: string;
  showValue?: boolean;
  variant?: D6FaceVariant;
}>(), {
  label: '',
  showValue: false,
});

const valid = computed(() => isD6FaceValue(props.value));
const effectiveVariant = computed(() => props.variant ?? settings.d6FaceVariant);
const url = computed(() => valid.value
  ? d6FaceUrl(props.value as 1 | 2 | 3 | 4 | 5 | 6, effectiveVariant.value)
  : '');
const imageStyle = computed(() => {
  const scale = d6FaceVisualScale(effectiveVariant.value);
  const offset = (1 - scale) * 50;
  return { width: `${scale * 100}%`, height: `${scale * 100}%`, left: `${offset}%`, top: `${offset}%` };
});
const alt = computed(() => props.label || `D6 showing ${props.value}`);
const failed = ref(false);
watch(() => [props.value, effectiveVariant.value], () => { failed.value = false; });
</script>

<template>
  <span v-if="valid" class="d6-face" role="img" :aria-label="alt">
    <span class="d6-face-value" :class="{ visible: showValue && !failed }">{{ value }}</span>
    <img v-if="!failed" :src="url" :style="imageStyle" alt="" aria-hidden="true" @error="failed = true" />
    <span v-else class="d6-face-fallback" :data-value="value" aria-hidden="true"></span>
  </span>
  <span v-else>{{ value }}</span>
</template>

<style scoped>
.d6-face {
  display: inline-block;
  position: relative;
  width: var(--d6-size, 1.8em);
  height: var(--d6-size, 1.8em);
  overflow: hidden;
  vertical-align: middle;
  flex: none;
}
.d6-face img {
  position: absolute;
  object-fit: contain;
  image-rendering: auto; /* owner 09-09: the faces are 512/1254 px masters — nearest-neighbour decimated them at log size */
}
.d6-face-value {
  position: absolute;
  inset: 0;
  color: transparent;
  user-select: text;
}
.d6-face-value.visible {
  inset: 19%;
  z-index: 1;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 50%;
  background: rgba(5, 7, 10, 0.88);
  color: #fff;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 0.72em;
  font-weight: 900;
  line-height: 1;
  text-shadow: 0 1px 1px #000;
  user-select: text;
}
.d6-face-fallback {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  border: 1px solid currentColor;
  border-radius: 20%;
  font-weight: 800;
  line-height: 1;
}
.d6-face-fallback::after {
  content: attr(data-value);
}
</style>
