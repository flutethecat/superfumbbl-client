<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue';
import type { SkillIconStyle } from '@fumbbl40k/ffb-pitch';
import { reactiveSkillIconLarge, reactiveSkillIconUrl } from '../game/assetModUi';
import { playerSkillCategoryClass } from '../game/skillCategory';
import type { PlayerDetailSkill } from '../game/skillDisplay';

const props = withDefaults(defineProps<{
  skills: readonly PlayerDetailSkill[];
  mode: 'icons' | 'markings';
  iconStyle?: SkillIconStyle;
  positionId?: string | null;
  side?: 'home' | 'away' | null;
  descriptions?: Readonly<Record<string, string>> | null;
  showDescriptions?: boolean;
}>(), {
  iconStyle: 'bb3',
  positionId: null,
  side: null,
  descriptions: null,
  showDescriptions: false,
});

const iconContext = computed(() => ({ positionId: props.positionId, side: props.side }));

function iconUrl(skill: string): string {
  return reactiveSkillIconUrl(skill, props.iconStyle, iconContext.value);
}

// Owner 09-09: the tooltip draws the family's 128 px master 1:1 ("scale from source"); a pack icon or status icon
// (48 px only) falls back to an exact 2x so nothing is resampled at a fraction.
const tipIcon = computed(() => (tip.skill ? reactiveSkillIconLarge(tip.skill.name, iconContext.value) : null));

function initials(skill: string): string {
  const words = skill.split(/[\s-]+/).filter(Boolean);
  return words.length === 1
    ? skill.slice(0, 2).toUpperCase()
    : words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join('');
}

function description(skill: PlayerDetailSkill): string {
  if (!props.showDescriptions || !props.descriptions) return '';
  const normalized = skill.name.toLowerCase().replace(/[^a-z]/g, '');
  return Object.entries(props.descriptions)
    .find(([name]) => name.toLowerCase().replace(/[^a-z]/g, '') === normalized)?.[1] ?? '';
}
function tooltipText(skill: PlayerDetailSkill): string {
  const d = description(skill);
  return d ? `${skill.label} — ${d}` : skill.label;
}

// Owner 09-09: the tooltip is TELEPORTED to <body> and fixed-positioned — inside the scrollable player card the
// old ::after bubble was clipped by the card's overflow (a chip on the card's left edge read "RAWLER"). It carries
// the full skill name, a close-up of the icon and the description, and is clamped inside the viewport.
const TIP_MARGIN = 8;
// Owner 09-09: the bubble is content-sized (a name-only tip is tight), then measured and clamped to the viewport.
const tip = reactive<{ skill: PlayerDetailSkill | null; left: number; top: number; below: boolean }>({
  skill: null, left: 0, top: 0, below: false,
});
const tipEl = ref<HTMLElement | null>(null);
function showTip(skill: PlayerDetailSkill, event: Event): void {
  if (props.mode !== 'icons') return;
  const chip = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const below = chip.top < 200; // no room above → flip under the chip
  tip.skill = skill; tip.below = below;
  tip.top = below ? chip.bottom + 7 : chip.top - 7;
  tip.left = chip.left + chip.width / 2; // provisional (centred); clamped once measured
  void nextTick(() => {
    const el = tipEl.value;
    if (!el || tip.skill !== skill) return;
    const vw = window.innerWidth;
    const width = el.getBoundingClientRect().width;
    tip.left = Math.min(Math.max(TIP_MARGIN + width / 2, chip.left + chip.width / 2), vw - TIP_MARGIN - width / 2);
  });
}
function hideTip(): void { tip.skill = null; }
</script>

<template>
  <div class="card-skills" role="list" aria-label="Player skills">
    <span v-for="skill in skills" :key="`${skill.name}:${skill.label}`"
      class="skill-chip" :class="mode === 'markings' ? playerSkillCategoryClass(skill.name) : undefined"
      :data-display="mode" :aria-label="skill.label" role="listitem"
      :data-tooltip="mode === 'icons' ? tooltipText(skill) : undefined"
      :title="mode === 'icons' ? undefined : skill.label"
      :tabindex="mode === 'icons' ? 0 : undefined"
      @pointerenter="showTip(skill, $event)" @focus="showTip(skill, $event)"
      @pointerleave="hideTip" @blur="hideTip">
      <template v-if="mode === 'icons'">
        <img v-if="iconUrl(skill.name)" :src="iconUrl(skill.name)" :alt="skill.label" />
        <span v-else class="skill-initials">{{ initials(skill.name) }}</span>
      </template>
      <span v-else class="skill-text">{{ skill.label }}</span>
    </span>
  </div>
  <Teleport to="body">
    <div v-if="tip.skill" ref="tipEl" class="skill-tip" role="tooltip" :data-below="tip.below"
      :style="{ left: tip.left + 'px', top: tip.top + 'px' }">
      <span class="skill-tip-icon">
        <img v-if="tipIcon" :src="tipIcon.url" :class="{ 'skill-tip-icon-2x': tipIcon.size === 48 }" alt="" />
        <span v-else class="skill-initials">{{ initials(tip.skill.name) }}</span>
      </span>
      <span class="skill-tip-body">
        <b class="skill-tip-name">{{ tip.skill.label }}</b>
        <span v-if="description(tip.skill)" class="skill-tip-desc">{{ description(tip.skill) }}</span>
      </span>
    </div>
  </Teleport>
</template>

<style scoped>
.card-skills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
  margin-top: 0.45rem;
  padding-top: 0.45rem;
  border-top: 1px solid var(--ui-border);
}
.skill-chip {
  position: relative;
  box-sizing: border-box;
  width: 2.4em; /* owner 09-09: chips read small on the tightened card */
  height: 2.4em;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  cursor: help;
}
.skill-chip:hover, .skill-chip:focus-visible { border-color: var(--ui-accent); outline: none; }
.skill-chip img { width: 2.05em; height: 2.05em; image-rendering: pixelated; }
.skill-initials { font-size: max(var(--ui-min-text-size, 12px), 0.87em); font-weight: bold; color: var(--ui-text); }
.skill-chip[data-display='markings'] {
  width: auto;
  height: auto;
  min-height: 2em;
  max-width: 100%;
  padding: 0.2em 0.5em;
  justify-content: flex-start;
  background: var(--ui-surface-2);
}
.skill-text { min-width: 0; overflow-wrap: anywhere; line-height: 1.25; }
.skill-general { color: var(--ui-skill-general); }
.skill-agility { color: var(--ui-skill-agility); }
.skill-strength { color: var(--ui-skill-strength); }
.skill-passing { color: var(--ui-skill-passing); }
.skill-mutation { color: var(--ui-skill-mutation); }
.skill-trait { color: var(--ui-skill-trait); }
</style>
<style>
/* Owner 09-09: teleported (unscoped) skill tooltip — fixed to the viewport so no card overflow can clip it. */
.skill-tip {
  position: fixed;
  z-index: 200;
  display: flex;
  flex-direction: column; /* owner 09-09: icon on top, the skill name directly under it, then the text */
  gap: 0.45rem;
  align-items: center;
  text-align: center;
  box-sizing: border-box;
  width: max-content;
  max-width: min(13.5rem, 70vw); /* owner 09-09: only a bit wider than the 136 px icon box; the text wraps under it */
  padding: 0.5rem 0.7rem;
  transform: translate(-50%, -100%); /* centred on the chip; the measured clamp keeps it on screen */
  color: var(--ui-text);
  background: var(--ui-surface);
  border: 1px solid var(--ui-accent);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgb(0 0 0 / 60%);
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem);
  line-height: 1.3;
  pointer-events: none;
}
.skill-tip[data-below='true'] { transform: translate(-50%, 0); }
.skill-tip-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 136px; /* owner 09-09: the 128 px master drawn 1:1; a 48 px pack/status icon at an exact 2x (96 px) */
  height: 136px;
  background: var(--ui-surface-2);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
}
.skill-tip-icon img { width: 128px; height: 128px; }
.skill-tip-icon img.skill-tip-icon-2x { width: 96px; height: 96px; image-rendering: pixelated; }
.skill-tip-icon .skill-initials { font-size: 1.3em; font-weight: bold; }
.skill-tip-body { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; min-width: 0; }
.skill-tip-name { font-size: 1.15em; color: var(--ui-heading); }
.skill-tip-desc { overflow-wrap: anywhere; color: var(--ui-text); }
</style>
