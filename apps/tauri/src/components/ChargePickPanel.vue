<script setup lang="ts">
import PitchConfirmationPanel from './PitchConfirmationPanel.vue';

defineProps<{
  max: number;
  selected: number;
  confirmDisabled: boolean;
  declinable: boolean;
  title?: string;
  label?: string;
  roll?: number;
}>();

const emit = defineEmits<{
  (event: 'confirm'): void;
  (event: 'decline'): void;
}>();
</script>

<template>
  <PitchConfirmationPanel :title="title ?? 'Charge!'" :label="label ?? 'Charge player selection'" test-id="charge-pick-panel">
    <span v-if="roll != null" class="charge-roll">Rolled {{ roll }}</span>
    <span class="charge-copy">Select up to {{ max }} Players - {{ selected }}/{{ max }}</span>
    <template #actions>
      <button type="button" class="charge-confirm" :disabled="confirmDisabled" @click="emit('confirm')">Confirm</button>
      <button v-if="declinable" type="button" class="charge-decline" @click="emit('decline')">Decline</button>
    </template>
  </PitchConfirmationPanel>
</template>

<style scoped>
.charge-copy {
  color: var(--ui-text);
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem);
  font-weight: 800;
  white-space: nowrap;
}
.charge-roll {
  color: var(--ui-accent, #efbd4a);
  font-size: max(var(--ui-min-text-size, 12px), 0.78rem);
  font-weight: 900;
  white-space: nowrap;
}
.charge-confirm {
  color: #eff5ff;
  background: linear-gradient(180deg, #3c5677, #1b2b40);
  border: 1px solid #7795ba;
}
.charge-confirm:disabled { opacity: 0.42; cursor: default; }
.charge-decline {
  color: #fff;
  background: linear-gradient(180deg, #c43c43, #76161d);
  border: 1px solid #ef7479;
}

@media (max-width: 620px) {
  .charge-copy { white-space: normal; }
}
</style>
