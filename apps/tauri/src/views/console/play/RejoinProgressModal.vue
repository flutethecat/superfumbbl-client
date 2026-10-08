<script setup lang="ts">
// Owner 08-18: the rejoin progress/failure modal — renders at the app-shell level (App.vue) so it
// stays visible no matter which blade is showing (the silent-failure class: SpectateView-hosted
// overlays never mount when the join fails before a game arrives). State = pure mapping in
// rejoinFlow.ts over the store's reactive join signals; success (game arrived) maps to 'closed'
// and the game view takes over. Visual idiom: the W30 save-prompt family (App.vue global styles).
import { computed } from 'vue';
import { deriveRejoinModal, dismissRejoin, rejoinFlow, retryOfficialJoin, storeRejoinSnapshot } from '../../../game/rejoinFlow';
import { formatTeamValue } from '../../../game/teamChoice';
import { ui } from '../../../game/ui';

const modal = computed(() => deriveRejoinModal(rejoinFlow.launch, storeRejoinSnapshot()));

// Bug report JLeav 10-08 (1.0.136): "The esc menu pops up behind the waiting for opponent to connect pop up. Making
// the esc menu inaccessible then". This modal is z 200; the Esc game menu and Settings are z 100. While either is
// open the modal steps below them and goes inert, so a focused "Stop waiting" cannot be fired through the menu.
const underAppMenu = computed(() => ui.gameMenuOpen || ui.settingsOpen);

const STATUS_GLYPH = { pending: '○', active: '◌', done: '●', failed: '×' } as const;

/** P1 10-06: the coach's pick from the server's team list (only shown when more than one team could be meant). */
function chooseTeam(teamId: string): void {
  rejoinFlow.launch?.teamChoice?.choose(teamId);
}
</script>

<template>
  <div v-if="modal.kind !== 'closed'" class="modal-backdrop save-prompt-backdrop rejoin-progress-backdrop"
    :class="{ 'under-app-menu': underAppMenu }" :inert="underAppMenu || undefined"
    role="alertdialog" aria-modal="true" aria-labelledby="rejoin-progress-title">
    <div class="save-prompt rejoin-progress">
      <h3 id="rejoin-progress-title">{{ modal.title }}</h3>
      <ul class="rejoin-steps">
        <li v-for="step in modal.steps" :key="step.key" :data-status="step.status">
          <span class="glyph" aria-hidden="true">{{ STATUS_GLYPH[step.status] }}</span>
          <span>{{ step.label }}</span>
        </li>
      </ul>
      <p v-if="modal.kind === 'waiting' && modal.message" class="hint">{{ modal.message }}</p>
      <template v-else-if="modal.kind === 'choose-team'">
        <p class="hint">FUMBBL wants to know which team you are playing this game with.</p>
        <div class="rejoin-team-list" role="list">
          <button v-for="team in modal.teams" :key="team.teamId" type="button" class="rejoin-team-card" role="listitem"
            @click="chooseTeam(team.teamId)">
            <span class="rejoin-team-name">{{ team.label }}</span>
            <span class="rejoin-team-meta">
              <span v-if="team.race">{{ team.race }}</span>
              <span v-if="team.teamValue != null" class="rejoin-team-tv">TV {{ formatTeamValue(team.teamValue) }}</span>
            </span>
          </button>
        </div>
      </template>
      <template v-else-if="modal.kind === 'failed'">
        <p class="hint rejoin-fail-message">{{ modal.message }}</p>
        <p v-if="modal.detail" class="hint rejoin-fail-detail">{{ modal.detail }}</p>
      </template>
      <p v-for="note in modal.notes" :key="note" class="hint rejoin-note">{{ note }}</p>
      <div class="save-prompt-actions">
        <button v-if="modal.kind === 'failed' && modal.canRetry" class="primary" @click="retryOfficialJoin()">Try again</button>
        <button v-if="modal.kind === 'failed'" :class="{ primary: !modal.canRetry }" @click="dismissRejoin()">Close</button>
        <button v-else @click="dismissRejoin({ cancel: true })">
          {{ modal.kind === 'waiting' ? 'Stop waiting' : 'Cancel' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rejoin-progress { min-width: 320px; }
/* JLeav 10-08: below App.vue .modal-backdrop (z 100) so the Esc game menu and Settings stay reachable. */
.rejoin-progress-backdrop.under-app-menu { z-index: 90; }
.rejoin-steps { display: grid; gap: 6px; margin: 10px 0 4px; padding: 0; list-style: none; text-align: left; }
.rejoin-steps li { display: flex; gap: 8px; align-items: baseline; color: #888; font-size: max(var(--ui-min-text-size, 12px), 12px); }
.rejoin-steps li[data-status="active"] { color: #ddd; }
.rejoin-steps li[data-status="done"] { color: #9bcf83; }
.rejoin-steps li[data-status="failed"] { color: #ff8d8d; }
.rejoin-steps .glyph { width: 1em; text-align: center; }
.rejoin-steps li[data-status="active"] .glyph { animation: rejoin-pulse 1s ease-in-out infinite; }
.rejoin-fail-message { color: #ff8d8d; }
.rejoin-team-list { display: grid; gap: 6px; margin: 8px 0 4px; max-height: 50vh; overflow-y: auto; }
.rejoin-team-card {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%;
  padding: 8px 10px; text-align: left; cursor: pointer;
  background: rgba(255, 255, 255, .04); border: 1px solid rgba(255, 255, 255, .14); border-radius: 6px; color: #ddd;
}
.rejoin-team-card:hover, .rejoin-team-card:focus-visible { border-color: #9bcf83; background: rgba(155, 207, 131, .08); }
.rejoin-team-name { font-weight: 600; }
.rejoin-team-meta { display: flex; gap: 10px; color: #aaa; font-size: max(var(--ui-min-text-size, 12px), 12px); }
.rejoin-fail-detail { opacity: .8; }
@keyframes rejoin-pulse { 50% { opacity: .3; } }
</style>
