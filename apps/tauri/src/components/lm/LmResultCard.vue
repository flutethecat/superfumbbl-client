<script setup lang="ts">
/**
 * Modern result card (owner 11-03, spec-client-restyle-and-team-port lane 3): one game as a wide card in the League
 * Manager's ResultCard language - each side's tone (game/teamTone.ts) as a diagonal tint, crest, team names in the
 * client's display face (owner 11-03), a boxed score
 * - with the caller's buttons in the last column (`actions` slot). Used by the Modern Play and Spectate blades.
 * Crests are the client's own (game/teamLogos.ts teamLogoUrl, as the Retro rows draw them); a team without a crest
 * gets its initials. Styles: styles/lm-blades.css (.lm-card*), under the blade's .sf-lm root.
 */
import { computed, ref } from 'vue';
import { teamLogoUrl } from '../../game/teamLogos';
import { teamTone } from '../../game/teamTone';
import { $t, terms } from '../../i18n';
import { coachTitleBadgeUrl } from '../../game/fumbblCoachProfile';
import { settings } from '../../game/settings';

export interface LmCardSide {
  name: string;
  coach?: string;
  race?: string;
  /** a ready "TV 1,120k" line (the caller's own formatting) */
  tv?: string;
  score?: number | null;
  logoUrl?: string;
  baseIconPath?: string;
  /** Owner 11-04: the coach's FUMBBL status title ("Star") - drawn as its rank badge (our art) beside the coach */
  coachTitle?: string;
  /** Owner 11-04: the coach's FUMBBL Overall CR, as FUMBBL sent it */
  coachCr?: number;
}

const props = defineProps<{
  home: LmCardSide;
  away: LmCardSide | null;
  /** the phase line over the score ("H1 · T2", "In progress") */
  clock?: string;
  /** 'score' (default) shows the numbers; 'hidden' a masked ?-?; 'vs' when no score exists yet */
  scoreMode?: 'score' | 'hidden' | 'vs';
  size?: 'sm';
  /** the away side's text when there is no away team yet */
  awayPlaceholder?: string;
  /** the client walkthrough's anchor on the HOME coach line (game/clientTour.ts 'spectate-coach') */
  coachTour?: string;
}>();

const failed = ref(new Set<string>());
function crest(side: LmCardSide | null, kit: 'home' | 'away'): string | null {
  if (!side || !(side.race || side.logoUrl)) return null;
  const url = teamLogoUrl({ race: side.race, logoUrl: side.logoUrl, baseIconPath: side.baseIconPath, side: kit });
  return url && !failed.value.has(url) ? url : null;
}
function onCrestError(url: string | null): void {
  if (!url || failed.value.has(url)) return;
  const next = new Set(failed.value); next.add(url); failed.value = next;
}
function initials(name: string | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return words.length === 1 ? words[0]!.slice(0, 2).toUpperCase() : words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}
/** The rank badge art for a coach title; a badge whose image failed is dropped (the CR text stays). */
function badge(side: LmCardSide | null): string | null {
  const url = side?.coachTitle ? coachTitleBadgeUrl(side.coachTitle, settings.coachBadgeStyle) : undefined;
  return url && !failed.value.has(url) ? url : null;
}
const homeCrest = computed(() => crest(props.home, 'home'));
const awayCrest = computed(() => crest(props.away, 'away'));
const mode = computed(() => props.scoreMode ?? 'score');
/** Each side's tint comes from teamTone() only (owner 11-03: no invented team colours). */
const toneStyle = computed(() => ({ '--lm-tone-home': teamTone(props.home), '--lm-tone-away': teamTone(props.away) }));
const sides = computed(() => [
  { key: 'home' as const, side: props.home as LmCardSide | null, url: homeCrest.value },
  { key: 'away' as const, side: props.away, url: awayCrest.value },
]);
</script>

<template>
  <article class="lm-card" :data-size="size" :style="toneStyle">
    <div class="lm-card-grid">
      <template v-for="(s, i) in sides" :key="s.key">
        <div v-if="i === 1" class="lm-centre">
          <span v-if="clock" class="lm-clock">{{ clock }}</span>
          <span v-if="mode === 'score'" class="lm-scorebox"><span>{{ home.score ?? 0 }}</span><span class="lm-dash" aria-hidden="true">&ndash;</span><span>{{ away?.score ?? 0 }}</span></span>
          <span v-else-if="mode === 'hidden'" class="lm-scorebox" data-hidden="true"><span>?</span><span class="lm-dash" aria-hidden="true">&ndash;</span><span>?</span></span>
          <span v-else class="lm-scorebox" data-vs="true">{{ $t('lmBlades.vs') }}</span>
        </div>
        <div class="lm-card-team" :class="s.key">
          <img v-if="s.url" class="lm-crest" :src="s.url" alt="" @error="onCrestError(s.url)" />
          <span v-else class="lm-crest lm-initials" aria-hidden="true">{{ initials(s.side?.name || s.side?.coach) }}</span>
          <span class="lm-who">
            <span class="lm-name">{{ s.side?.name || (s.key === 'away' && awayPlaceholder) || '—' }}</span>
            <span v-if="s.side?.coach" class="lm-coach-line">
              <img v-if="badge(s.side)" class="lm-coach-badge" :data-retro="settings.coachBadgeStyle === 'retro'" :src="badge(s.side)!" :alt="s.side.coachTitle" :title="s.side.coachTitle" @error="onCrestError(badge(s.side))" />
              <span class="lm-coach" :data-tour="s.key === 'home' ? coachTour : undefined">{{ s.side.coach }}</span>
              <span v-if="s.side.coachCr !== undefined" class="lm-cr">{{ $t('lmBlades.card.crP0', { p0: s.side.coachCr }) }}</span>
            </span>
            <span v-if="s.side?.race || s.side?.tv" class="lm-meta">{{ [s.side?.race ? terms(s.side.race) : '', s.side?.tv ?? ''].filter(Boolean).join(' · ') }}</span>
          </span>
        </div>
      </template>
      <div class="lm-card-actions"><slot name="actions" /></div>
    </div>
  </article>
</template>
