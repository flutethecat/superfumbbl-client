<script setup lang="ts">
import { computed, type CSSProperties } from 'vue';

export interface SendOffResultView {
  kind: 'argue' | 'bribe';
  sentOff: boolean;
  coachBanned: boolean;
  playerName: string;
  side: 'home' | 'away';
  logoUrl: string | null;
  coach: string;
  rerolled?: boolean;
}

const props = defineProps<{
  result: SendOffResultView;
  coinIconUrl: string;
  /** Owner 09-05: the referee art on the outcome card too (was prompt-only, so spectators never saw it). */
  refereeIconUrl?: string;
}>();

const resultText = computed(() => {
  const r = props.result;
  if (r.kind === 'argue') {
    if (r.sentOff) return r.coachBanned
      ? `${r.playerName} is sent off — and the coach is banned!`
      : `${r.playerName} is sent off!`;
    return 'Argue succeeds! The player stays on the pitch.';
  }
  return r.sentOff
    ? `The bribe fails — ${r.playerName} is sent off!`
    : 'Bribe succeeds! The player stays on the pitch.';
});

const surfaceStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 47,
  top: '38%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'none',
};
</script>

<template>
  <section class="sendoff-result-panel" :class="[{ success: !result.sentOff, banned: result.coachBanned }, `side-${result.side}`]"
    :style="surfaceStyle" data-testid="sendoff-result" aria-live="polite" aria-label="Referee decision result">
    <header class="sendoff-result-header">
      <img v-if="refereeIconUrl" :src="refereeIconUrl" class="sendoff-result-ref" alt="" aria-hidden="true" />
      <span class="sendoff-result-kicker">{{ result.rerolled ? 'Bribery & Corruption reroll' : result.kind === 'bribe' ? 'Bribe result' : 'Argue the Call' }}</span>
      <span class="sendoff-result-side">{{ result.side }}</span>
    </header>
    <div class="sendoff-result-body">
      <div class="sendoff-team">
        <span class="sendoff-logo-frame">
          <img v-if="result.logoUrl" class="sendoff-logo" :src="result.logoUrl" alt="" />
        </span>
        <span class="sendoff-coach">{{ result.coach }}</span>
      </div>
      <div class="sendoff-semantic-mark" :data-kind="result.kind">
        <span v-if="result.kind === 'bribe'" class="sendoff-coin-mark">
          <img :src="coinIconUrl" class="sendoff-result-coin" alt="" />
          <span class="sendoff-verdict">{{ result.sentOff ? '✕' : '✓' }}</span>
        </span>
        <span v-else class="sendoff-verdict">{{ result.coachBanned ? '⚖✕' : result.sentOff ? '✕' : '✓' }}</span>
        <span v-if="result.rerolled" class="sendoff-reroll-mark" aria-label="Bribery and Corruption reroll">↻</span>
      </div>
      <div class="sendoff-result-copy">
        <strong class="sendoff-result-title">{{ result.sentOff ? 'Sent Off' : 'Call Overturned' }}</strong>
        <span class="sendoff-result-text">{{ resultText }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sendoff-result-ref { width: 34px; height: 34px; flex: 0 0 auto; object-fit: contain; image-rendering: pixelated; margin-right: 8px; }
.sendoff-result-ref + .sendoff-result-kicker { margin-right: auto; }
.sendoff-result-panel {
  width: min(520px, calc(100% - 36px));
  box-sizing: border-box;
  overflow: hidden;
  color: #f5f7fa;
  border: 1px solid #9b3737;
  border-radius: 8px;
  background: linear-gradient(135deg, #3d1014f2, #13080a 60%, #090b0e);
  box-shadow: 0 12px 38px #000d, inset 0 1px 0 #ffffff18;
  font-family: 'Nuffle', system-ui, sans-serif;
  animation: sendoff-result-in var(--p-260) ease-out;
}
.sendoff-result-panel.success {
  border-color: #3d9360;
  background: linear-gradient(135deg, #123b28f2, #081710 60%, #090b0e);
}
.sendoff-result-panel.side-home { border-left: 4px solid #496fdd; }
.sendoff-result-panel.side-away { border-left: 4px solid #cf4545; }
.sendoff-result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 11px;
  border-bottom: 1px solid #ffffff1c;
  background: #05070a99;
}
.sendoff-result-kicker { font-size: max(var(--ui-min-text-size, 12px), 0.67rem); font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; }
.sendoff-result-side { color: #aeb8c5; font-size: max(var(--ui-min-text-size, 12px), 0.58rem); font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; }
.sendoff-result-body {
  display: grid;
  grid-template-columns: 92px 90px minmax(0, 1fr);
  align-items: center;
  min-height: 116px;
  padding: 12px 16px;
}
.sendoff-team { display: flex; min-width: 0; flex-direction: column; align-items: center; gap: 4px; }
.sendoff-logo-frame {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border: 1px solid #ffffff22;
  border-radius: 5px;
  background: #02030566;
}
.sendoff-logo { width: 52px; height: 52px; object-fit: contain; image-rendering: pixelated; filter: drop-shadow(0 3px 7px #000d); }
.sendoff-coach { overflow: hidden; max-width: 88px; color: #d6dde6; font-size: max(var(--ui-min-text-size, 12px), 0.68rem); text-overflow: ellipsis; white-space: nowrap; }
.sendoff-semantic-mark { position: relative; display: grid; min-height: 72px; place-items: center; color: #ef6a6a; }
.success .sendoff-semantic-mark { color: #67d88d; }
.sendoff-verdict { font-size: max(var(--ui-min-primary-text-size, 16px), 3.4rem); font-weight: 950; line-height: 1; text-shadow: 0 3px 12px #000c; }
.banned .sendoff-verdict { font-size: max(var(--ui-min-primary-text-size, 16px), 2.35rem); }
.sendoff-coin-mark { position: relative; display: grid; place-items: center; }
.sendoff-result-coin { width: 64px; height: 64px; object-fit: contain; image-rendering: pixelated; }
.sendoff-coin-mark .sendoff-verdict { position: absolute; font-size: max(var(--ui-min-primary-text-size, 16px), 3.8rem); }
.sendoff-reroll-mark {
  position: absolute;
  right: 2px;
  bottom: 0;
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  color: #f1cb68;
  border: 1px solid #bb9138;
  border-radius: 50%;
  background: #171006;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
}
.sendoff-result-copy { display: flex; min-width: 0; flex-direction: column; gap: 5px; text-align: left; }
.sendoff-result-title { color: #ff8585; font-size: max(var(--ui-min-primary-text-size, 16px), 1.3rem); font-weight: 950; letter-spacing: 0.05em; text-transform: uppercase; }
.success .sendoff-result-title { color: #83e4a4; }
.sendoff-result-text { color: #f4f6f8; font-size: max(var(--ui-min-primary-text-size, 16px), 0.83rem); font-weight: 800; line-height: 1.3; }

:global(.hud-chrome) .sendoff-result-panel {
  border-width: 3px;
  outline: 2px solid #606a75;
  outline-offset: -7px;
  border-radius: 9px 4px 9px 4px;
  box-shadow: 0 5px 0 #030405, 0 13px 30px #000e, inset 0 2px 0 #ffffff24;
}
:global(.hud-minimalist) .sendoff-result-panel {
  border-width: 1px;
  background: rgba(29, 10, 13, 0.92);
  box-shadow: 0 7px 22px #000b;
}
:global(.hud-minimalist) .sendoff-result-panel.success { background: rgba(8, 31, 20, 0.92); }

@keyframes sendoff-result-in {
  from { opacity: 0; transform: translate(-50%, -44%) scale(0.94); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

@media (max-width: 560px) {
  .sendoff-result-body { grid-template-columns: 68px 66px minmax(0, 1fr); padding: 10px; }
  .sendoff-logo-frame { width: 48px; height: 48px; }
  .sendoff-logo { width: 43px; height: 43px; }
  .sendoff-verdict { font-size: max(var(--ui-min-primary-text-size, 16px), 2.8rem); }
}
</style>
