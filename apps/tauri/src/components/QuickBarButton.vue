<script setup lang="ts">
withDefaults(defineProps<{
  active?: boolean;
  stateful?: boolean;
  disclosure?: boolean;
}>(), {
  active: false,
  stateful: false,
  disclosure: false,
});

const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <button type="button"
    :data-active="stateful || disclosure ? String(active) : undefined"
    :aria-pressed="stateful ? active : undefined"
    :aria-expanded="disclosure ? active : undefined"
    @click="emit('click', $event)"><span class="quick-button-content"><slot /></span></button>
</template>

<style scoped>
.quick-button-content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  max-height: 100%;
  line-height: 1;
  white-space: nowrap;
}
button.icon-button .quick-button-content {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 18px);
}
</style>
