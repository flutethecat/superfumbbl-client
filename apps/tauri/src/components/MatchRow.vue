<script setup lang="ts">
import { computed } from 'vue';
import { matchResultArt, type MatchResult } from '../game/matchResultArt';
import { teamLogoUrl } from '../game/teamLogos';

/**
 * Owner 10-06 (spec-replay-pane-revamp.md): the finished-game row the Play blade's "My Recent Games" draws, extracted
 * so the Replay pane's search results render the same three bevelled boxes - MY / left team | result + score |
 * opponent / right team + the caller's action column (the `actions` slot). Markup and sizes are the S77-S85 recent
 * row unchanged; the Play blade's own active / lobby rows keep their inline markup and the shared CSS in PlayView.
 * Colours come from the --pb-* / --ui-* variables the host pane defines (FUMBBL scheme).
 */
export interface MatchRowTeam {
  name: string;
  coach: string;
  race?: string;
  tv?: number;
}

const props = defineProps<{
  left: MatchRowTeam;
  /** null = the teams are unknown (a bare FFB replay id) */
  right: MatchRowTeam | null;
  /** null = no score to show (hidden or unknown): the centre reads "vs" */
  score: { left: number; right: number } | null;
  /** the result label art, from the LEFT side; null = none (hidden, or no score) */
  result: MatchResult | null;
}>();

function crest(team: MatchRowTeam | null, side: 'home' | 'away'): string | null {
  return team?.race ? teamLogoUrl({ race: team.race, side }) : null;
}
const leftCrest = computed(() => crest(props.left, 'home'));
const rightCrest = computed(() => crest(props.right, 'away'));
const art = computed(() => (props.result ? matchResultArt(props.result) : null));
function initials(name: string | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '—';
  return words.length === 1 ? words[0]!.slice(0, 2).toUpperCase() : words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join('');
}
function formatTeamValue(value: number | undefined): string | undefined {
  if (!value) return undefined;
  const thousands = value >= 10_000 ? Math.round(value / 1_000) : Math.round(value);
  return `TV ${thousands.toLocaleString()}k`;
}
</script>

<template>
  <article class="game-row">
    <div class="row-team home">
      <img v-if="leftCrest" class="row-logo" :src="leftCrest" alt="" />
      <span v-else class="row-logo logo-fallback" aria-hidden="true">{{ initials(left.name) }}</span>
      <span class="row-text">
        <strong class="row-name">{{ left.name }}</strong>
        <small v-if="left.coach" class="row-meta row-coach">{{ left.coach }}</small>
        <small v-if="left.race" class="row-meta row-race">{{ left.race }}</small>
        <small v-if="formatTeamValue(left.tv)" class="row-meta">{{ formatTeamValue(left.tv) }}</small>
      </span>
    </div>
    <div class="row-centre">
      <!-- Owner 09-25: the result above the score. Owner 10-01 (S77): the result is the WIN / LOSS / DRAW label art
           (alt text names it), from the LEFT (my) side of the match. -->
      <template v-if="score">
        <img v-if="art" class="row-result-art" :data-result="result" :src="art.src" :srcset="art.srcset"
          :width="art.width" :height="art.height" :alt="art.alt" />
        <span class="row-score"><span class="row-score-n">{{ score.left }}</span><span class="row-score-dash">&ndash;</span><span class="row-score-n">{{ score.right }}</span></span>
      </template>
      <span v-else class="row-score row-score-vs">vs</span>
    </div>
    <div class="row-right">
      <div v-if="right" class="row-team away">
        <img v-if="rightCrest" class="row-logo" :src="rightCrest" alt="" />
        <span v-else class="row-logo logo-fallback" aria-hidden="true">{{ initials(right.name) }}</span>
        <span class="row-text">
          <strong class="row-name">{{ right.name }}</strong>
          <small v-if="right.coach" class="row-meta row-coach">{{ right.coach }}</small>
          <small v-if="right.race" class="row-meta row-race">{{ right.race }}</small>
          <small v-if="formatTeamValue(right.tv)" class="row-meta">{{ formatTeamValue(right.tv) }}</small>
        </span>
      </div>
      <div v-else class="row-team away row-team-empty">
        <span class="row-logo logo-fallback" aria-hidden="true">?</span>
        <span class="row-text"><strong class="row-name row-waiting">Teams unknown</strong></span>
      </div>
      <slot name="actions" />
    </div>
  </article>
</template>

<style scoped>
/* The PlayView recent-row rules (S77-S85), carried with the markup. PlayView keeps its own copy for the active and
   lobby rows that stay inline; keep the two in step. */
.game-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(214px, .3fr) minmax(0, 1fr); align-items: stretch; gap: 12px; padding: 12px 14px; border: 1px solid var(--pb-line); border-radius: 4px; background: var(--ui-eggshell, #E7DDC7); }
.row-team, .row-centre { box-sizing: border-box; padding: 10px 14px; border: 1px solid color-mix(in srgb, var(--pb-text) 30%, transparent); border-radius: 6px;
  background: var(--ui-old-lace, #F8F5E7);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .9), inset 0 -3px 0 rgba(26, 64, 28, .12), 0 3px 7px rgba(26, 64, 28, .24); }
.row-team { display: flex; align-items: center; gap: 14px; min-width: 0; }
.row-right { display: flex; align-items: stretch; gap: 12px; min-width: 0; }
.row-right > .row-team { flex: 1 1 0; }
.row-team.away { flex-direction: row-reverse; text-align: right; }
.row-logo { flex: 0 0 128px; width: 128px; height: 128px; object-fit: contain; image-rendering: pixelated; }
.logo-fallback { box-sizing: border-box; display: grid; place-items: center; border: 1px solid var(--pb-line); border-radius: 4px; color: var(--pb-text); background: var(--ui-old-lace, #F8F5E7); font-size: 28px; letter-spacing: .06em; }
.row-text { display: grid; gap: 6px; min-width: 0; }
.row-name { color: var(--pb-text); font-size: 24px; font-weight: 500; line-height: 1.15; overflow-wrap: break-word; }
.row-meta { color: var(--pb-muted); font-size: 18px; line-height: 1.2; }
.row-coach { color: var(--pb-text); }
.row-centre { display: grid; justify-items: center; align-content: center; gap: 6px; min-width: 0; }
.row-score { color: var(--pb-carmine); font-family: 'Nuffle', system-ui, sans-serif; font-size: 42px; font-weight: 800; line-height: 1; text-shadow: 2px 2px 0 rgba(26, 64, 28, .18); white-space: nowrap;
  display: grid; grid-template-columns: 1fr auto 1fr; column-gap: .35em; align-items: baseline; justify-self: stretch; }
.row-score-n:first-child { text-align: right; }
.row-score-n:last-child { text-align: left; }
.row-score.row-score-vs { display: block; justify-self: center; }
.row-waiting { color: var(--pb-muted); font-style: italic; }
.row-result-art { display: block; flex: none; max-width: 100%; height: auto; image-rendering: auto; }
/* the caller's action column (slot content): Details / Replay stacked, the time under them (S74 / S78 / S80 / S81) */
:slotted(.row-actions) { display: grid; gap: 8px; align-content: space-between; align-self: stretch; justify-items: stretch; }
:slotted(.row-when) { color: var(--pb-text); font-size: 20px; font-weight: 700; line-height: 1; letter-spacing: .08em; text-align: center; text-transform: uppercase; white-space: nowrap; }

@media (max-width: 1500px) {
  .row-logo, .game-row .logo-fallback { flex-basis: 88px; width: 88px; height: 88px; }
  .row-name { font-size: 20px; }
}
@media (max-width: 1100px) {
  .game-row { grid-template-columns: minmax(0, 1fr) minmax(150px, .3fr) minmax(0, 1fr); }
  .row-right { flex-direction: column; }
  .row-logo, .game-row .logo-fallback { flex-basis: 64px; width: 64px; height: 64px; }
}
@media (max-width: 640px) {
  .game-row { grid-template-columns: 1fr; }
  .row-right { flex-direction: column; }
  .row-logo, .logo-fallback { width: 64px; height: 64px; flex-basis: 64px; }
  .row-team.away { flex-direction: row; text-align: left; }
}
</style>
