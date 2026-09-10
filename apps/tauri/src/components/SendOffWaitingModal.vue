<script setup lang="ts">
import { computed } from 'vue';
import { fumbblAsset } from '../game/jnlpRouting';

export interface SendOffWaitingView {
  playerName: string;
  coach: string;
  teamName: string;
  portraitUrl: string | null;
  baseIconPath: string | null;
  status: string;
  resolved: boolean;
  steps: { key: string; text: string; tone: 'pending' | 'success' | 'failure' | 'neutral' }[];
}

/** Owner 09-05: the referee art (same image as the deciding coach's prompt) so EVERY seat sees the ref. */
/** Owner 09-05: `positionName` renders as a subtext line directly under the player's name. */
const props = defineProps<{ progress: SendOffWaitingView; refereeIconUrl?: string; positionName?: string }>();
const portraitSrc = computed(() => fumbblAsset(
  props.progress.portraitUrl ?? undefined,
  props.progress.baseIconPath ?? undefined,
));
</script>

<template>
  <div class="sendoff-waiting-backdrop" :class="{ resolved: progress.resolved }"
    data-testid="sendoff-waiting-backdrop">
    <section class="sendoff-waiting" :class="{ resolved: progress.resolved }"
      :role="progress.resolved ? 'status' : 'dialog'"
      :aria-modal="progress.resolved ? undefined : 'true'"
      aria-live="polite" aria-atomic="true"
      aria-labelledby="sendoff-waiting-title" aria-describedby="sendoff-waiting-status"
      data-testid="sendoff-waiting">
      <header class="sendoff-waiting-head">
        <div class="sendoff-waiting-player">
          <span class="sendoff-waiting-portrait-frame">
            <img v-if="portraitSrc" class="sendoff-waiting-portrait" :src="portraitSrc" alt="" aria-hidden="true" />
          </span>
          <span class="sendoff-waiting-player-name">{{ progress.playerName }}</span>
          <span v-if="positionName" class="sendoff-waiting-position">{{ positionName }}</span>
        </div>
        <div class="sendoff-waiting-heading" :class="{ 'with-ref': !!refereeIconUrl }">
          <span v-if="refereeIconUrl" class="sendoff-waiting-ref-frame" aria-hidden="true">
            <img :src="refereeIconUrl" class="sendoff-waiting-ref" alt="" />
          </span>
          <span class="sendoff-waiting-kicker">Referee</span>
          <h2 id="sendoff-waiting-title">Send-off Review</h2>
          <span class="sendoff-waiting-team">{{ progress.coach || progress.teamName }}</span>
        </div>
      </header>
      <ol class="sendoff-waiting-steps" aria-label="Send-off progress">
        <li v-for="step in progress.steps" :key="step.key" :data-tone="step.tone">
          <span class="sendoff-waiting-mark" aria-hidden="true">{{ step.tone === 'success' ? '✓' : step.tone === 'failure' ? '✕' : step.tone === 'pending' ? '…' : '•' }}</span>
          <span>{{ step.text }}</span>
        </li>
      </ol>
      <p id="sendoff-waiting-status" class="sendoff-waiting-status">{{ progress.status }}</p>
    </section>
  </div>
</template>

<style scoped>
.sendoff-waiting-ref-frame { display: grid; flex: 0 0 auto; width: 56px; height: 56px; place-items: center; overflow: hidden; border: 1px solid #53606e; border-radius: 6px; background: linear-gradient(145deg, #202832, #090d12); }
.sendoff-waiting-ref { width: 50px; height: 50px; object-fit: contain; image-rendering: pixelated; }
.sendoff-waiting-heading.with-ref { display: grid; grid-template-columns: 56px minmax(0, 1fr); column-gap: 10px; align-items: center; }
.sendoff-waiting-heading.with-ref .sendoff-waiting-ref-frame { grid-row: 1 / span 3; }
.sendoff-waiting-backdrop {
  position: absolute;
  z-index: 48;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: auto;
  background: rgba(0, 0, 0, 0.22);
}
.sendoff-waiting-backdrop.resolved {
  pointer-events: none;
  background: transparent;
}
.sendoff-waiting {
  box-sizing: border-box;
  width: min(560px, calc(100% - 32px));
  max-height: calc(100% - 32px);
  overflow: auto;
  color: #f3f0e6;
  border: 2px solid #a64141;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(53, 15, 19, 0.98), rgba(12, 15, 21, 0.98) 62%);
  box-shadow: 0 10px 34px #000d, inset 0 1px 0 #ffffff1a;
  font-family: 'Nuffle', system-ui, sans-serif;
}
.sendoff-waiting.resolved { border-color: #69747e; }
.sendoff-waiting-head {
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-bottom: 1px solid #ffffff20;
  background: #05070a88;
}
.sendoff-waiting-player { display: flex; min-width: 0; flex-direction: column; align-items: center; gap: 5px; }
.sendoff-waiting-portrait-frame {
  display: grid;
  width: 72px;
  height: 72px;
  place-items: center;
  border: 1px solid #ffffff28;
  border-radius: 6px;
  background: #02030588;
}
.sendoff-waiting-portrait { width: 68px; height: 68px; object-fit: contain; image-rendering: pixelated; }
.sendoff-waiting-position { max-width: 100%; overflow-wrap: anywhere; color: #b9a3a3; font-size: max(var(--ui-min-text-size, 12px), 10px); line-height: 1.15; text-align: center; letter-spacing: 0.04em; text-transform: uppercase; }
.sendoff-waiting-player-name {
  max-width: 100%;
  overflow-wrap: anywhere;
  color: #f4dddd;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  line-height: 1.2;
  text-align: center;
}
.sendoff-waiting-heading { min-width: 0; }
.sendoff-waiting-kicker, .sendoff-waiting-team {
  display: block;
  overflow: hidden;
  color: #c5ccd5;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  letter-spacing: 0.1em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}
.sendoff-waiting h2 {
  margin: 3px 0 5px;
  color: #f15b64;
  font-size: max(var(--ui-min-primary-text-size, 16px), 22px);
  line-height: 1.1;
  text-transform: uppercase;
}
.sendoff-waiting-steps { margin: 0; padding: 14px 20px 8px; list-style: none; }
.sendoff-waiting-steps li {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 7px;
  padding: 5px 0;
  font-family: Arial, Helvetica, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 14px);
  line-height: 1.35;
}
.sendoff-waiting-steps li[data-tone='success'] { color: #86e1a5; }
.sendoff-waiting-steps li[data-tone='failure'] { color: #ff8a8a; }
.sendoff-waiting-steps li[data-tone='pending'] { color: #f2d27a; }
.sendoff-waiting-mark { font-weight: 900; text-align: center; }
.sendoff-waiting-status {
  margin: 0;
  padding: 8px 18px 14px;
  color: #eef1f5;
  font-family: Arial, Helvetica, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 14px);
  line-height: 1.35;
  text-align: right;
}
@media (max-width: 480px) {
  .sendoff-waiting-head { grid-template-columns: 76px minmax(0, 1fr); padding: 10px 12px; }
  .sendoff-waiting-portrait-frame { width: 58px; height: 58px; }
  .sendoff-waiting-portrait { width: 54px; height: 54px; }
  .sendoff-waiting h2 { font-size: max(var(--ui-min-primary-text-size, 16px), 18px); }
  .sendoff-waiting-steps { padding-inline: 12px; }
}
</style>
