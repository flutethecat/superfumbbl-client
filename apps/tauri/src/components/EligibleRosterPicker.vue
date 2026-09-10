<script setup lang="ts">
// Owner audit 08-17 (P1 — Iron Man/Knuckle Dusters cannot reach every offered reserve):
// a shared off-pitch-safe answer surface for the generic playerPick rail
// (armPlayerPick / resolvePlayerPick / confirmPlayerPick in game/store.ts). The pitch/dugout
// crosshair interaction can miss an eligible candidate that has no synthetic pre-setup square
// (packages/ffb-pitch/src/preSetupFormation.ts caps the synthetic formation at eleven
// fieldable players, Stars first) — Classic has no dugout click surface at all. This list
// answers the SAME wire: every row's id comes straight from the server's exact eligibleIds
// (game/rosterPicker.ts resolveRosterPickCandidates), never re-derived or substituted.
import type { RosterPickCandidate } from '../game/rosterPicker';

const props = defineProps<{
  prompt: string;
  candidates: RosterPickCandidate[];
  picked: string[];
  min: number;
  max: number;
  declinable: boolean;
  /** 'classic' = grey-Swing modal skin (ClassicView); 'modern' = dark inline panel (SpectateView). */
  theme?: 'classic' | 'modern';
}>();

const emit = defineEmits<{
  pick: [id: string];
  confirm: [];
  decline: [];
}>();
</script>

<template>
  <div class="erp-root" :data-theme="props.theme ?? 'modern'">
    <div class="erp-title">{{ props.prompt }}</div>
    <ul class="erp-list">
      <li v-for="c in props.candidates" :key="c.id">
        <button type="button" class="erp-cand" :data-sel="props.picked.includes(c.id)"
          @click="emit('pick', c.id)">
          <b class="erp-nr">{{ c.nr == null ? '—' : c.nr }}</b>
          <span class="erp-name">{{ c.name }}</span>
          <span class="erp-pos">{{ c.pos }}</span>
          <span class="erp-check">{{ props.picked.includes(c.id) ? '✓' : '' }}</span>
        </button>
      </li>
      <li v-if="!props.candidates.length" class="erp-empty">No eligible players offered.</li>
    </ul>
    <div class="erp-foot">
      <span class="erp-count">{{ props.picked.length }}/{{ props.max }}</span>
      <div class="erp-actions">
        <button v-if="props.declinable" type="button" class="erp-btn erp-decline" @click="emit('decline')">Decline</button>
        <button type="button" class="erp-btn erp-confirm"
          :disabled="props.picked.length < props.min || props.picked.length === 0"
          @click="emit('confirm')">Confirm</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.erp-root {
  width: min(440px, 92vw); max-height: 60vh; display: flex; flex-direction: column; gap: 0.5rem;
  font-family: Arial, Helvetica, sans-serif;
}
.erp-title { font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); font-weight: 800; text-align: center; }
.erp-list {
  list-style: none; margin: 0; padding: 0.4rem; overflow-y: auto;
  display: flex; flex-direction: column; gap: 0.25rem; border-radius: 5px;
}
.erp-cand {
  width: 100%; display: grid; grid-template-columns: 2rem 1fr auto 1.2rem;
  align-items: center; gap: 0.5rem; padding: 0.35rem 0.5rem; text-align: left;
  border-radius: 4px; cursor: pointer; font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem);
}
.erp-nr { text-align: center; }
.erp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.erp-pos { font-size: max(var(--ui-min-text-size, 12px), 0.72rem); }
.erp-check { font-weight: 800; text-align: center; color: #7fe07f; }
.erp-empty { padding: 0.6rem; text-align: center; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); opacity: 0.7; }
.erp-foot { display: flex; align-items: center; justify-content: space-between; }
.erp-count { font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); }
.erp-actions { display: flex; gap: 0.5rem; }
.erp-btn { padding: 0.35rem 0.9rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); border-radius: 3px; cursor: pointer; }
.erp-btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* Classic grey-Swing skin (mirrors ClassicView's cv-mvp*). */
.erp-root[data-theme="classic"] { color: #e6e2d8; }
.erp-root[data-theme="classic"] .erp-title { color: #cdb36a; }
.erp-root[data-theme="classic"] .erp-list { border: 1px solid #4a4436; background: #1e1e22; }
.erp-root[data-theme="classic"] .erp-cand { background: #2c2c31; color: #e6e2d8; border: 1px solid #45454c; }
.erp-root[data-theme="classic"] .erp-cand:hover { background: #34343a; }
.erp-root[data-theme="classic"] .erp-cand[data-sel="true"] { background: #4a3f1c; border-color: #cdb36a; box-shadow: 0 0 0 1px #cdb36a inset; }
.erp-root[data-theme="classic"] .erp-nr { color: #cfc6ab; }
.erp-root[data-theme="classic"] .erp-name { color: #f0ece0; }
.erp-root[data-theme="classic"] .erp-pos { color: #a99f7e; }
.erp-root[data-theme="classic"] .erp-count { color: #cfc6ab; }
.erp-root[data-theme="classic"] .erp-btn { background: #3d3d3d; color: #e6e2d8; border: 1px solid #5a5a5a; }
.erp-root[data-theme="classic"] .erp-btn:hover { background: #474747; }
.erp-root[data-theme="classic"] .erp-confirm { background: #6a5a2a; border-color: #cdb36a; color: #fff; }

/* Modern dark inline skin. */
.erp-root[data-theme="modern"] { color: #e8e8ec; }
.erp-root[data-theme="modern"] .erp-title { color: #e0c674; }
.erp-root[data-theme="modern"] .erp-list { border: 1px solid #3a3a42; background: rgba(12, 14, 20, 0.55); }
.erp-root[data-theme="modern"] .erp-cand { background: rgba(40, 42, 52, 0.9); color: #e8e8ec; border: 1px solid #46464e; }
.erp-root[data-theme="modern"] .erp-cand:hover { background: rgba(56, 58, 70, 0.9); }
.erp-root[data-theme="modern"] .erp-cand[data-sel="true"] { background: rgba(90, 74, 24, 0.9); border-color: #e0c674; box-shadow: 0 0 0 1px #e0c674 inset; }
.erp-root[data-theme="modern"] .erp-pos { color: #b8b3a0; }
.erp-root[data-theme="modern"] .erp-btn { background: rgba(60, 62, 72, 0.9); color: #e8e8ec; border: 1px solid #5a5a64; }
.erp-root[data-theme="modern"] .erp-btn:hover { background: rgba(76, 78, 90, 0.9); }
.erp-root[data-theme="modern"] .erp-confirm { background: #6a5a2a; border-color: #e0c674; color: #fff; }
.erp-root[data-theme="modern"] .erp-decline { background: #7a2f2f; border-color: #c96a6a; }
</style>
