<script setup lang="ts">
import { computed, type CSSProperties } from 'vue';
import type { SkillIconStyle } from '@fumbbl40k/ffb-pitch';
import type { ApothecaryType } from '../game/logic/apothecaryOffer';
import type { PlayerDetailSkill } from '../game/skillDisplay';
import PitchConfirmationPanel from './PitchConfirmationPanel.vue';
import PlayerDetailSkillList from './PlayerDetailSkillList.vue';

export interface ApothecaryPromptInjury {
  index: number;
  playerId: string;
  player: string;
  side: 'home' | 'away';
  injury: string;
  base: number;
  options: readonly { type: ApothecaryType | null; label: string }[];
}

export interface ApothecaryPromptView {
  key: string;
  kind: 'single' | 'multiple';
  player: string;
  side: 'home' | 'away';
  base: number;
  mine: boolean;
  noneLabel: 'Decline' | 'None';
  /** The deciding coach (owner 09-05: named in the non-chooser's wait line). */
  coach?: string;
  injuries: readonly ApothecaryPromptInjury[];
}

const props = defineProps<{
  prompt: ApothecaryPromptView;
  iconUrl: string;
  portrait?: string | null;
  skills?: readonly PlayerDetailSkill[];
  skillMode?: 'icons' | 'markings';
  skillIconStyle?: SkillIconStyle;
  positionId?: string | null;
  playerSide?: 'home' | 'away' | null;
  positionStyle?: CSSProperties;
}>();

const title = computed(() => props.prompt.kind === 'single' ? 'Use Apothecary?' : 'Choose an Injury to Treat');
const seatClass = computed(() => props.prompt.mine ? 'seat-local' : 'seat-opposition');
const subjectName = computed(() => props.prompt.kind === 'single'
  ? props.prompt.player
  : props.prompt.injuries[0]?.player ?? 'Injured player');
const panelStyle = computed<CSSProperties>(() => ({
  position: 'absolute', zIndex: 48, top: '42%', width: 'min(440px, calc(100% - 32px))',
  borderLeft: `4px solid ${props.prompt.mine ? '#496fdd' : '#cf4545'}`,
  ...props.positionStyle,
}));

defineEmits<{
  resolve: [injuryIndex: number | null, apothecaryType?: ApothecaryType | null];
  dragStart: [event: PointerEvent];
}>();
</script>

<template>
  <PitchConfirmationPanel class="apothecary-prompt" :class="[seatClass, { readonly: !prompt.mine }]"
    :title="title" label="Apothecary decision" :position-style="panelStyle" draggable
    test-id="apothecary-prompt" @drag-start="$emit('dragStart', $event)">
    <span class="apo-icon-frame" aria-hidden="true"><img :src="iconUrl" alt="" /></span>
    <div class="apo-layout">
      <aside class="apo-player-card">
        <img v-if="portrait" class="apo-portrait" :src="portrait" :alt="`${subjectName} portrait`" />
        <span v-else class="apo-portrait apo-portrait-fallback" aria-hidden="true">👤</span>
        <strong class="apo-player-name">{{ subjectName }}</strong>
        <PlayerDetailSkillList v-if="skills?.length" class="apo-skills" :skills="skills"
          :mode="skillMode ?? 'markings'" :icon-style="skillIconStyle ?? 'bb3'"
          :position-id="positionId" :side="playerSide ?? prompt.side" />
      </aside>
      <div class="apo-treatment">
        <span v-if="prompt.mine" class="apo-kicker">Choose treatment</span>
        <div class="apo-injuries">
          <article v-for="injury in prompt.injuries" :key="injury.playerId" class="apo-injury" :class="{ ko: injury.base === 5 }">
            <div class="apo-injury-copy">
              <span v-if="prompt.kind === 'multiple'" class="apo-player">{{ injury.player }}</span>
              <span class="apo-status">{{ injury.injury }}</span>
              <!-- Owner 09-05: the wait line lives INSIDE the result box, names the coach and the player, and wraps. -->
              <span v-if="!prompt.mine" class="apo-wait" aria-live="polite">Waiting for {{ prompt.coach || 'the coach' }}’s decision on {{ injury.player }}…</span>
            </div>
            <div v-if="prompt.mine" class="apo-option-row">
              <button v-for="option in injury.options" :key="option.type ?? 'legacy-use'" type="button"
                class="apo-use" @pointerdown.stop @click.stop="$emit('resolve', injury.index, option.type)">
                {{ option.label }}
              </button>
            </div>
          </article>
        </div>
      </div>
    </div>
    <template v-if="prompt.mine" #actions>
      <button type="button" class="apo-decline" @pointerdown.stop @click.stop="$emit('resolve', null)">
        {{ prompt.noneLabel }}
      </button>
    </template>
  </PitchConfirmationPanel>
</template>

<style scoped>
.apothecary-prompt {
  z-index: 48;
  top: 42%;
  width: min(440px, calc(100% - 32px));
  min-width: 0;
  border-left: 4px solid var(--seat-home-mid, #003eb3);
}
.apothecary-prompt.seat-opposition { border-left-color: var(--seat-away-mid, #b30000); }
.apo-icon-frame { position: absolute; z-index: 2; top: 8px; right: 11px; display: grid; width: 42px; height: 42px; place-items: center; border: 1px solid #6d8c77; border-radius: 6px; background: linear-gradient(145deg, #26352c, #090d0a); box-shadow: inset 0 1px 0 #ffffff22, 0 2px 7px #0009; }
.apo-icon-frame img { width: 36px; height: 36px; object-fit: contain; image-rendering: pixelated; }
.apo-layout { display: grid; grid-template-columns: 142px minmax(0, 1fr); align-items: stretch; gap: 12px; width: 100%; min-width: 0; text-align: left; }
.apo-player-card { display: flex; min-width: 0; flex-direction: column; align-items: center; gap: 6px; padding: 8px; border: 1px solid #39434f; border-radius: 5px; background: linear-gradient(180deg, #171d25, #080b0f); box-shadow: inset 0 1px 5px #000c; }
.apo-portrait { width: 104px; height: 104px; flex: 0 0 104px; object-fit: contain; image-rendering: pixelated; filter: drop-shadow(0 4px 3px #000b); }
.apo-portrait-fallback { display: grid; place-items: center; color: #7e8b99; font-size: max(var(--ui-min-primary-text-size, 16px), 2.2rem); }
.apo-player-name { max-width: 100%; color: var(--ui-text); font-size: max(var(--ui-min-primary-text-size, 16px), 0.83rem); line-height: 1.14; overflow-wrap: anywhere; text-align: center; white-space: normal; }
.apo-skills { width: 100%; max-width: 100%; justify-content: center; margin-top: 0; padding-top: 6px; }
.apo-skills :deep(.skill-chip) { font-size: max(var(--ui-min-text-size, 12px), 0.62rem); }
.apo-treatment { display: flex; min-width: 0; flex-direction: column; justify-content: center; }
.apo-kicker { color: var(--seat-home-text, #4a86fe); font-size: max(var(--ui-min-text-size, 12px), 0.61rem); font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; }
.seat-opposition .apo-kicker { color: var(--seat-away-text, #fe6666); }
.apo-injuries { display: flex; width: 100%; flex-direction: column; gap: 7px; margin-top: 5px; }
/* owner 09-06: the treatment options STACK vertically under the injury copy, each the full width of the card —
   side by side they read cramped and unrelated */
.apo-injury { display: flex; flex-direction: column; align-items: stretch; gap: 8px; min-width: 0; padding: 7px 9px; border: 1px solid #4b555f; border-radius: 4px; background: linear-gradient(180deg, #171c22, #090c10); }
.apo-injury-copy { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; gap: 2px; }
.apo-player { overflow: hidden; max-width: 180px; color: var(--ui-text); font-size: max(var(--ui-min-text-size, 12px), 0.76rem); font-weight: 900; text-overflow: ellipsis; white-space: nowrap; }
.apo-status { color: #f17878; font-size: max(var(--ui-min-text-size, 12px), 0.7rem); font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; }
.apo-injury.ko .apo-status { color: #ffb24a; }
.apo-option-row { display: flex; flex-direction: column; align-items: stretch; width: 100%; gap: 6px; }
.apo-option-row .apo-use { width: 100%; text-align: center; }
.apo-use, .apo-decline { min-height: 30px; padding: 5px 9px; color: #effff1; border: 1px solid #6aa276; border-radius: 4px; background: linear-gradient(180deg, #467951, #294b31); font: inherit; font-size: max(var(--ui-min-text-size, 12px), 0.68rem); font-weight: 900; cursor: pointer; }
.apo-use:hover { filter: brightness(1.16); }
.apo-decline { color: #d4dae2; border-color: #657180; background: linear-gradient(180deg, #424c58, #242b33); }
.apo-wait { display: block; min-width: 0; max-width: 100%; margin-top: 4px; overflow-wrap: anywhere; white-space: normal; color: #9ea9b6; font-size: max(var(--ui-min-text-size, 12px), 0.55rem); font-weight: 800; letter-spacing: 0.05em; text-align: left; text-transform: uppercase; }
.readonly .apo-injury { opacity: 0.9; }
:deep(.pitch-confirm-title) { padding-right: 46px; padding-left: 0; text-align: left; }
:global(.hud-chrome) .apothecary-prompt { border-top-color: #727d89; border-bottom-color: #080a0c; }
:global(.hud-minimalist) .apothecary-prompt { border-width: 1px 1px 1px 4px; background: rgba(11, 18, 14, 0.92); box-shadow: 0 7px 22px #000b; }
@media (max-width: 620px) { .apo-layout { grid-template-columns: 110px minmax(0, 1fr); gap: 8px; } .apo-portrait { width: 82px; height: 82px; flex-basis: 82px; } .apo-injury { align-items: stretch; flex-direction: column; } .apo-option-row { justify-content: flex-start; } }
</style>
