<script setup lang="ts">
// Owner 08-18: the rejoin progress/failure modal — renders at the app-shell level (App.vue) so it
// stays visible no matter which blade is showing (the silent-failure class: SpectateView-hosted
// overlays never mount when the join fails before a game arrives). State = pure mapping in
// rejoinFlow.ts over the store's reactive join signals; success (game arrived) maps to 'closed'
// and the game view takes over. Visual idiom: the W30 save-prompt family (App.vue global styles).
import { computed } from 'vue';
import { deriveRejoinModal, dismissRejoin, rejoinFlow, storeRejoinSnapshot } from '../../../game/rejoinFlow';

const modal = computed(() => deriveRejoinModal(rejoinFlow.launch, storeRejoinSnapshot()));

const STATUS_GLYPH = { pending: '○', active: '◌', done: '●', failed: '×' } as const;
</script>

<template>
  <div v-if="modal.kind !== 'closed'" class="modal-backdrop save-prompt-backdrop rejoin-progress-backdrop"
    role="alertdialog" aria-modal="true" aria-labelledby="rejoin-progress-title">
    <div class="save-prompt rejoin-progress">
      <h3 id="rejoin-progress-title">
        {{ modal.kind === 'failed' ? 'Rejoin failed' : modal.kind === 'waiting' ? 'Rejoined — waiting' : 'Rejoining your game' }}
      </h3>
      <ul class="rejoin-steps">
        <li v-for="step in modal.steps" :key="step.key" :data-status="step.status">
          <span class="glyph" aria-hidden="true">{{ STATUS_GLYPH[step.status] }}</span>
          <span>{{ step.label }}</span>
        </li>
      </ul>
      <p v-if="modal.kind === 'waiting'" class="hint">{{ modal.message }}</p>
      <template v-else-if="modal.kind === 'failed'">
        <p class="hint rejoin-fail-message">{{ modal.message }}</p>
        <p v-if="modal.detail" class="hint rejoin-fail-detail">{{ modal.detail }}</p>
      </template>
      <div class="save-prompt-actions">
        <button v-if="modal.kind === 'failed'" class="primary" @click="dismissRejoin()">Close</button>
        <button v-else @click="dismissRejoin({ cancel: true })">
          {{ modal.kind === 'waiting' ? 'Stop waiting' : 'Cancel' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rejoin-progress { min-width: 320px; }
.rejoin-steps { display: grid; gap: 6px; margin: 10px 0 4px; padding: 0; list-style: none; text-align: left; }
.rejoin-steps li { display: flex; gap: 8px; align-items: baseline; color: #888; font-size: max(var(--ui-min-text-size, 12px), 12px); }
.rejoin-steps li[data-status="active"] { color: #ddd; }
.rejoin-steps li[data-status="done"] { color: #9bcf83; }
.rejoin-steps li[data-status="failed"] { color: #ff8d8d; }
.rejoin-steps .glyph { width: 1em; text-align: center; }
.rejoin-steps li[data-status="active"] .glyph { animation: rejoin-pulse 1s ease-in-out infinite; }
.rejoin-fail-message { color: #ff8d8d; }
.rejoin-fail-detail { opacity: .8; }
@keyframes rejoin-pulse { 50% { opacity: .3; } }
</style>
