<script setup lang="ts">
import type { CSSProperties } from 'vue';
import D6Face from './D6Face.vue';
import PitchConfirmationPanel from './PitchConfirmationPanel.vue';
import { d6RequirementParts } from '../game/d6Log';

export interface ActionTargetModalView {
  seq: number;
  mode: 'foul' | 'handoff' | 'pass';
  targetId: string;
  rollText: string;
}

defineProps<{
  modal: ActionTargetModalView;
  positionStyle?: CSSProperties;
  foulSkullUrl: string;
}>();

defineEmits<{
  confirm: [];
  cancel: [];
  dragStart: [event: PointerEvent];
}>();

const LABELS: Record<ActionTargetModalView['mode'], string> = {
  foul: 'Perform foul?',
  handoff: 'Hand off?',
  pass: 'Throw the pass?',
};
const foulRollNumber = (text: string) => text.replace(/^SKULL\s*/i, '');
</script>

<template>
  <PitchConfirmationPanel class="action-modal" :title="LABELS[modal.mode]" :label="LABELS[modal.mode]"
    :position-style="positionStyle" draggable resizable compact :data-seq="modal.seq"
    :data-target-id="modal.targetId" @drag-start="$emit('dragStart', $event)">
    <div class="yesno-text">
      <span class="action-modal-roll">
        <img v-if="modal.mode === 'foul'" :src="foulSkullUrl" class="action-roll-die" alt="skull" />
        <template v-if="modal.mode === 'foul'">{{ foulRollNumber(modal.rollText) }}</template>
        <template v-else v-for="(part, i) in d6RequirementParts(modal.rollText)" :key="i">
          <D6Face v-if="part.face" class="action-target-d6" :value="part.face" :label="part.label" />
          <template v-else>{{ part.text }}</template>
        </template>
      </span>
    </div>
    <template #actions>
      <button type="button" class="sendoff-btn argue" @click.stop="$emit('confirm')">Confirm</button>
      <button type="button" class="sendoff-btn pass" @click.stop="$emit('cancel')">Cancel</button>
    </template>
  </PitchConfirmationPanel>
</template>

<style scoped>
.yesno-text { font-size: max(var(--ui-min-text-size, 12px), 11px); color: #f3f0e6; text-align: center; white-space: pre-wrap; }
.sendoff-btn {
  padding: 6px 8px;
  min-width: 56px;
  font-size: max(var(--ui-min-text-size, 12px), 11px);
  font-weight: 700;
  color: #f3f0e6;
  background: rgba(50, 64, 86, 0.95);
  border: 1px solid rgba(150, 175, 210, 0.55);
  border-radius: 7px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.sendoff-btn.argue { background: #2f5aa8; border-color: #6f9fe0; }
.action-modal-roll { display: flex; align-items: center; justify-content: center; gap: 4px; margin-top: 4px; font-weight: 800; font-size: max(var(--ui-min-text-size, 12px), 12px); color: var(--ui-heading); }
.action-target-d6 { --d6-size: 1.5em; margin: -0.12em 0.08em; }
.action-roll-die { width: 16px; height: 16px; image-rendering: pixelated; vertical-align: middle; margin-right: 3px; }
</style>
