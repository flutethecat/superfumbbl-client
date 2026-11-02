<script setup lang="ts">
/**
 * Owner 10-23 (setup wizard, Log style panel): one log moment - a block with its dice and the coach's pick, then a
 * dodge - shown in one of the three Log styles, the way the in-game log draws it.
 *
 * Faithful by construction: the rows (game/setupLogStyleExample.json) are the real report formatter's output, frozen
 * from recorded fork captures (corpus-sidestep-defender, corpus-move) replayed through the spectator checkpoint with
 * the coach / team / player names swapped for fictional ones (and the block capture's home / away tags swapped so
 * the same team is home in both moments). They go through the SAME display helpers as the live
 * log (visibleMatchLogEntries, shownLogLine, composeGraphicalJoins, logRowPlates, upstreamLogRows /
 * upstreamLogSegments, the segment walk) and the SAME row components (LogActionPlate, D6Face, BlockDieFace). The row
 * markup and the CSS below mirror SpectateView's log panel (single-writer, so not shared). Two stand-ins: the player
 * names take the renderer's DEFAULT seat trims (no pitch is mounted here), and the viewer is a spectator (native
 * home / away). Display only: nothing here is clickable.
 */
import { computed } from 'vue';
import { displayDiceSide } from '@fumbbl40k/ffb-pitch';
import breastplateIconUrl from '@fumbbl40k/ffb-pitch/assets/decorations/breastplate.png';
import D6Face from './D6Face.vue';
import BlockDieFace from './BlockDieFace.vue';
import LogActionPlate, { logRowSide } from './LogActionPlate.vue';
import { settings, type AppSettings } from '../game/settings';
import { FONT_DISPLAY_FAMILY } from '../game/fontStacks';
import { visibleMatchLogEntries } from '../game/logVisibility';
import { shownLogLine } from '../game/logShown';
import { composeGraphicalJoins } from '../game/reportFormatter';
import { logRowPlates } from '../game/logActionPlates';
import { logRowSegments, type LogRowSegment } from '../game/logRowSegments';
import { upstreamDirectionWord, upstreamLogRows, upstreamLogSegments, type UpstreamLogSegment } from '../game/upstreamLog';
import type { LogEntry } from '../game/store';
import exampleRows from '../game/setupLogStyleExample.json';
import { $t } from '../i18n';

const props = defineProps<{ logStyle: AppSettings['logStyle'] }>();

const ROWS = exampleRows as unknown as LogEntry[];
/** The renderer's default seat trims (ffb-pitch COLORS.homeTrim / awayTrim): the live log reads them from the pitch. */
const SEAT_TINT = { home: '#4a86fe', away: '#fe6666' } as const;
const LOG_FONTS: Record<string, string> = {
  nuffle: FONT_DISPLAY_FAMILY,
  arial: 'Arial, Helvetica, sans-serif',
  mono: 'Consolas, "Courier New", monospace',
};

const graphical = computed(() => props.logStyle === 'graphical');
const fumbbl = computed(() => props.logStyle === 'fumbbl');
// SpectateView `logEntries`: the same filters and Graphical composition, the viewer's sequencing toggle included.
const entries = computed(() => {
  const shown = visibleMatchLogEntries(ROWS, settings.showServerSequencingEvents, graphical.value, fumbbl.value).map(shownLogLine);
  if (!graphical.value) return shown;
  return composeGraphicalJoins(shown).flatMap((entry) => (entry.g === null ? [] : entry.g?.more?.length
    ? [entry, ...entry.g.more.map((more) => ({ ...entry, g: more }))]
    : [entry]));
});
const upstreamRows = computed(() => (fumbbl.value ? upstreamLogRows(entries.value) : []));
function rowLine(entry: LogEntry) {
  return graphical.value && entry.g ? entry.g : entry.alt ?? entry;
}
function rowIndent(entry: LogEntry): number | undefined {
  return graphical.value && entry.g && entry.g.indent > 0 ? entry.g.indent : undefined;
}
const plates = computed(() => logRowPlates(entries.value.map((entry) => ({ action: entry.action, indent: rowIndent(entry) ?? 0 }))));
/** SpectateView `logSegmentsFor`: the numbers toggles (Settings > Display > Log) over the segment walk. */
function segmentsFor(entry: LogEntry): LogRowSegment[] {
  const segs = logRowSegments(rowLine(entry));
  const dice = settings.logDiceAsNumbers;
  const need = settings.logNeededAsNumbers;
  if (!dice && !need) return segs;
  const isRoll = (x: LogRowSegment | undefined) => !!x?.face && x.kind === 'roll';
  const isSep = (x: LogRowSegment) => !x.face && !x.blockFace && !x.side && x.t !== undefined && (x.tk === 'hidden' || !x.tk) && /^[\s,]*$/.test(x.t);
  const out: LogRowSegment[] = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    if (dice && isRoll(seg)) {
      let sum = seg.face as number;
      let j = i + 1;
      while (j < segs.length) {
        const next = segs[j]!;
        if (isRoll(next)) { sum += next.face as number; j++; continue; }
        if (isSep(next) && isRoll(segs[j + 1])) { j++; continue; }
        break;
      }
      out.push({ t: String(sum), tk: 'dienum' });
      i = j - 1;
      continue;
    }
    if (need && seg.face && seg.kind === 'target') { out.push({ t: String(seg.face), tk: 'dienum' }); continue; }
    out.push(seg);
  }
  return out;
}
function nameStyle(team: 'home' | 'away'): Record<string, string> {
  const color = SEAT_TINT[team];
  return { color, '--log-seat-glow': color };
}
function upstreamText(s: UpstreamLogSegment): string {
  return s.direction ? upstreamDirectionWord(s.direction, !!s.lower, settings.pitchOrientation, false) : s.text;
}
const textStyle = computed(() => ({
  fontSize: `${settings.logFontSize}px`,
  fontFamily: LOG_FONTS[settings.logFont] ?? LOG_FONTS.nuffle!,
  '--log-row-strength': String(Math.min(100, Math.max(0, settings.logTintStrength)) / 100),
}));
</script>

<template>
  <div class="setup-log-panel" role="img" :aria-label="$t('setupWizard.logStyle.example')" :data-log-style="logStyle">
    <pre class="log" :class="{ 'log-graphical': graphical, 'log-fumbbl': fumbbl }" :style="textStyle" aria-hidden="true"><div class="log-rows"><template v-if="fumbbl"><span v-for="(row, i) in upstreamRows" :key="'u' + i" class="log-u" :data-kind="row.entry.kind" :data-indent="row.line.indent || undefined" :data-space="row.line.space"><template v-for="(s, j) in upstreamLogSegments(row.line)" :key="j"><span v-if="s.team" class="log-name" :class="s.styles.map((st) => 'log-u-' + st)" :style="nameStyle(s.team)">{{ upstreamText(s) }}</span><span v-else-if="s.styles.length" :class="s.styles.map((st) => 'log-u-' + st)">{{ upstreamText(s) }}</span><template v-else>{{ upstreamText(s) }}</template></template>
</span></template><template v-else><span v-for="(entry, i) in entries" :key="i" :data-kind="entry.kind" :data-row-side="graphical ? logRowSide(entry.action?.side, null) : undefined"><LogActionPlate v-if="graphical" :plate="plates[i]" /><span class="log-text" :data-indent="rowIndent(entry)"><template v-for="(s, j) in segmentsFor(entry)" :key="j"><span v-if="s.tk === 'dienum'" class="log-dienum">{{ s.t }}</span><D6Face v-else-if="s.face" class="log-d6" :value="s.face" variant="black" :side="displayDiceSide(s.dteam ?? null, null)" /><BlockDieFace v-else-if="s.blockFace && s.result" class="log-block-die" :value="s.blockFace" :result="s.result" /><span v-else-if="s.tk === 'title'" class="log-title">{{ s.t }}</span><span v-else-if="s.tk === 'armour'" class="log-armour" :title="s.title"><span class="log-armour-glyph">{{ s.t }}</span><img :src="breastplateIconUrl" alt="" aria-hidden="true" /></span><span v-else-if="s.tk === 'hidden'" class="log-hidden">{{ s.t }}</span><span v-else-if="s.tk === 'fail'" class="log-fail">{{ s.t }}</span><span v-else-if="s.side" class="log-name" :style="nameStyle(s.side)">{{ s.t }}</span><template v-else>{{ s.t }}</template></template>
</span></span></template></div></pre>
  </div>
</template>

<style scoped>
/* SpectateView .log-panel's frame and gradient (the log panel is always dark, whatever the UI theme). */
.setup-log-panel {
  box-sizing: border-box;
  overflow: hidden;
  border: 3px solid #353b44;
  border-radius: 5px;
  background: linear-gradient(180deg, rgb(28 31 36 / var(--log-panel-opacity, 0.92)), rgb(7 9 11 / var(--log-panel-opacity, 0.92)));
  box-shadow: inset 0 1px 0 #68717d, inset 0 0 0 2px #121519;
  color: var(--ui-text);
  text-align: left;
}
/* ---- MIRROR START: SpectateView.vue's log rules, verbatim (test/setupLogStylePreviewPins.test.ts pins every rule
   between these markers to an identical rule there; edit SpectateView first, then copy) ---- */
.log {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 0.4rem 0.6rem;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}
.log-name {
  font-size: max(var(--ui-min-text-size, 12px), 0.9em);
  font-weight: 700;
  text-shadow: 0 1px 1px #000, 0 0 3px #000, 0 0 6px color-mix(in srgb, var(--log-seat-glow, transparent) 82%, transparent);
}
.log-title {
  display: inline-block;
  transform: translateY(-1px);
  font-weight: 800;
  letter-spacing: 0.03em;
  color: var(--ui-gold);
  text-shadow: 0 -1px 0 rgba(255, 255, 255, 0.25), 0 1px 1px rgba(0, 0, 0, 0.65);
}
.log-armour {
  display: inline-block;
  position: relative;
  width: 1.25em;
  height: 1.15em;
  overflow: visible;
  vertical-align: text-bottom;
}
.log-armour img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.9)) drop-shadow(0 0 2px rgba(255, 255, 255, 0.5)) drop-shadow(0 1px 1px rgba(0, 0, 0, 0.9));
}
.log-armour-glyph {
  position: absolute;
  inset: 0;
  color: transparent;
  overflow: hidden;
  white-space: nowrap;
  user-select: text;
}
.log-fail { color: #ff2400; font-weight: 700; }
.log-dienum { font-weight: 700; font-variant-numeric: tabular-nums; }
.log-hidden {
  display: inline-block;
  width: 0;
  height: 1em;
  overflow: hidden;
  color: transparent;
  white-space: nowrap;
  user-select: text;
  vertical-align: text-bottom;
}
.log-d6 { --d6-size: 1.45em; margin: -0.15em 0.1em; vertical-align: middle; }
.log-block-die { --block-die-size: 1.4em; margin: -0.15em 0.08em; vertical-align: middle; }
.log.log-fumbbl > .log-rows > .log-u { display: block; white-space: pre-wrap; }
.log.log-fumbbl > .log-rows > .log-u[data-indent='1'] { padding-left: 12px; }
.log.log-fumbbl > .log-rows > .log-u[data-indent='2'] { padding-left: 24px; }
.log.log-fumbbl > .log-rows > .log-u[data-indent='3'] { padding-left: 36px; }
.log.log-fumbbl > .log-rows > .log-u[data-indent='4'] { padding-left: 48px; }
.log.log-fumbbl > .log-rows > .log-u[data-indent='5'] { padding-left: 60px; }
.log.log-fumbbl > .log-rows > .log-u[data-indent='6'] { padding-left: 72px; }
.log.log-fumbbl > .log-rows > .log-u[data-space='above'] { margin-top: 4px; }
.log.log-fumbbl > .log-rows > .log-u[data-space='below'] { margin-bottom: 4px; }
.log.log-fumbbl > .log-rows > .log-u[data-space='aboveBelow'] { margin: 4px 0; }
.log.log-fumbbl .log-u-bold, .log.log-fumbbl .log-u-roll, .log.log-fumbbl .log-u-turn { font-weight: 700; }
.log.log-fumbbl .log-u-explanation { font-style: italic; }
.log.log-graphical {
  --log-row-home: rgb(40 110 235 / calc(0.55 * var(--log-row-strength, 1)));
  --log-row-home-alt: rgb(40 110 235 / calc(0.40 * var(--log-row-strength, 1)));
  --log-row-away: rgb(225 35 40 / calc(0.52 * var(--log-row-strength, 1)));
  --log-row-away-alt: rgb(225 35 40 / calc(0.37 * var(--log-row-strength, 1)));
  --log-row-neutral: transparent;
  --log-row-neutral-alt: rgb(255 255 255 / 0.05);
  --log-icon-size: clamp(20px, calc(1.45em * 1.7), 42px);
  --log-source-size: calc(var(--log-icon-size) * 0.8);
  --log-action-col: calc(var(--log-icon-size) + 0.5em);
  padding-left: 0;
  padding-right: 0;
}
.log.log-graphical { --log-indent: 0; }
.log.log-graphical > .log-rows > span[data-kind] {
  display: grid;
  grid-template-columns: var(--log-action-col) auto minmax(0, 1fr);
  align-items: center;
  padding: 0.16em 0.6rem 0.16em 0;
  border-bottom: 1px solid rgb(255 255 255 / 0.12);
  text-shadow: 0 1px 1px rgb(0 0 0 / 0.9), 0 0 2px rgb(0 0 0 / 0.75);
}
.log.log-graphical .log-text { display: block; grid-column: 3; min-width: 0; }
.log.log-graphical .log-d6 { --d6-size: var(--log-icon-size); margin: 0.04em 0.1em; vertical-align: middle; }
.log.log-graphical .log-block-die { --block-die-size: var(--log-icon-size); margin: 0.04em 0.08em; vertical-align: middle; }
.log.log-graphical .log-d6, .log.log-graphical .log-block-die { filter: drop-shadow(0 0 1.5px rgb(255 255 255 / 0.9)) drop-shadow(0 0 3px rgb(255 255 255 / 0.45)); }
.log.log-graphical .log-armour { width: var(--log-icon-size); height: var(--log-icon-size); margin: 0.04em 0.06em; vertical-align: middle; }
.log.log-graphical .log-hidden, .log.log-graphical .log-armour-glyph, .log.log-graphical .log-stat-down-copy, .log.log-graphical :deep(.block-die-result), .log.log-graphical :deep(.d6-face-value:not(.visible)) { text-shadow: none; }
.log.log-graphical > .log-rows > span[data-row-side='home'] { background: var(--log-row-home); }
.log.log-graphical > .log-rows > span[data-row-side='home']:nth-child(even) { background: var(--log-row-home-alt); }
.log.log-graphical > .log-rows > span[data-row-side='away'] { background: var(--log-row-away); }
.log.log-graphical > .log-rows > span[data-row-side='away']:nth-child(even) { background: var(--log-row-away-alt); }
.log.log-graphical > .log-rows > span[data-row-side='neutral'] { background: var(--log-row-neutral); }
.log.log-graphical > .log-rows > span[data-row-side='neutral']:nth-child(even) { background: var(--log-row-neutral-alt); }
.log.log-graphical > .log-rows > span[data-row-side='away'] .log-fail { color: #ff8f7a; }
.log-rows { display: block; }
/* ---- MIRROR END ---- */
</style>
