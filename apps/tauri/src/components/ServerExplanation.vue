<script setup lang="ts">
/**
 * Owner 10-26: the server-explanation OVERRIDE. When the server sent explanation lines for this prompt
 * (game/serverExplanation.ts), they render verbatim in place of the card's own explanatory copy (the default slot);
 * when it sent none, the slot renders exactly as before. Never both. No root element of its own, so the fallback is
 * byte-for-byte the card's existing markup. The lines are English wire data (`data()`-marked by the projection).
 *
 * The `line` slot lets the card render each line in its own (scoped) styling; without it a plain element is used.
 */
withDefaults(defineProps<{
  lines: readonly string[];
  /** Class for each server line when the card gives no `line` slot. */
  lineClass?: string;
}>(), { lineClass: '' });
defineOptions({ inheritAttrs: false });
</script>

<template>
  <template v-if="lines.length">
    <template v-for="(line, i) in lines" :key="i">
      <slot name="line" :line="line" :index="i">
        <div :class="lineClass || undefined" data-server-explanation>{{ line }}</div>
      </slot>
    </template>
  </template>
  <slot v-else />
</template>
