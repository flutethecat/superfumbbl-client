<script setup lang="ts">
import D6Face from './D6Face.vue';
import PitchConfirmationPanel from './PitchConfirmationPanel.vue';
import type { BlockAttackPreview } from '../game/logic/availableActions';

defineProps<{ preview: BlockAttackPreview; targetName: string }>();
defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <PitchConfirmationPanel class="block-attack-confirm" :title="preview.title"
    :label="`${preview.title} against ${targetName}`" test-id="block-attack-confirm" compact>
    <div class="attack-target">{{ targetName }}</div>
    <div class="attack-roll" :aria-label="`${preview.title} ${preview.detail}`">
      <span class="attack-emoji" aria-hidden="true">{{ preview.emoji }}</span>
      <template v-if="preview.activationTarget != null">
        <D6Face :value="preview.activationTarget" :label="`${preview.title} needs ${preview.activationTarget}`" />+
      </template>
      <span v-if="preview.armourTarget != null" class="armour-roll">🛡️
        <D6Face :value="preview.armourTarget" :label="`Armour needs ${preview.armourTarget}`" />+
      </span>
    </div>
    <div class="attack-detail">{{ preview.detail }}</div>
    <template #actions>
      <button type="button" class="confirm" @click.stop="$emit('confirm')">Confirm</button>
      <button type="button" @click.stop="$emit('cancel')">Cancel</button>
    </template>
  </PitchConfirmationPanel>
</template>

<style scoped>
.block-attack-confirm { min-width: min(390px, calc(100vw - 24px)); }
.attack-target { color: var(--ui-heading); font-weight: 800; text-align: center; overflow-wrap: anywhere; }
.attack-roll { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 7px; margin: 8px 0 5px; font-size: max(var(--ui-min-primary-text-size, 16px), 15px); font-weight: 900; }
.attack-emoji { font-size: max(var(--ui-min-primary-text-size, 16px), 22px); line-height: 1; }
.armour-roll { display: inline-flex; align-items: center; gap: 3px; }
.attack-detail { text-align: center; color: #ddd5c7; font-size: max(var(--ui-min-text-size, 12px), 12px); }
button { min-width: 72px; padding: 7px 10px; }
button.confirm { background: #8d1616; border-color: #e65b4d; color: white; }
</style>
