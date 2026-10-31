<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { presentationMs } from '@fumbbl40k/ffb-pitch';
import { fumbblAsset } from '../game/jnlpRouting';
import { SEND_OFF_REVEAL_FALLBACK_MS, type SendOffRevealOutcome, type SendOffRevealStep } from '../game/store';
import DisplayCaps from './DisplayCaps.vue';
import D6Face from './D6Face.vue';
import { $t, terms } from '../i18n';

export interface SendOffWaitingView {
  /** The referee occurrence; echoed back with `flip-shown` so the store arms the hold for the right one. */
  occurrenceKey?: string;
  playerName: string;
  coach: string;
  teamName: string;
  portraitUrl: string | null;
  baseIconPath: string | null;
  resolved: boolean;
  steps: SendOffRevealStep[];
  /** Server-derived call; the card flips to its back face once it is set and the typing has drained. */
  outcome?: SendOffRevealOutcome | null;
}

/** Owner 09-05: the referee art (same image as the deciding coach's prompt) so EVERY seat sees the ref. */
/** Owner 09-05: `positionName` renders as a subtext line directly under the player's name. */
const props = defineProps<{ progress: SendOffWaitingView; refereeIconUrl?: string; positionName?: string }>();
/** Owner 10-30 (send-off reveal): the back face is showing (the flip transition ended). Presentation only. */
const emit = defineEmits<{ (event: 'flip-shown', occurrenceKey: string): void }>();

const portraitSrc = computed(() => fumbblAsset(
  props.progress.portraitUrl ?? undefined,
  props.progress.baseIconPath ?? undefined,
));

/** Owner 10-30: lines type in at 25 ms per character (scaled by the presentation speed), one at a time, in order. */
const TYPE_MS_PER_CHAR = 25;
/** The flip is a 640 ms CSS turn; if `transitionend` never arrives the back face is reported shown after this. */
const FLIP_FALLBACK_MS = 700;
const FACES = ['front', 'back'] as const;

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
const reducedMotion = ref(prefersReducedMotion());

/** Characters shown per step key; a key that is absent has not started typing (it is queued). */
const typed = reactive<Record<string, number>>({});
const queue: string[] = [];
const typingKey = ref<string | null>(null);
const flipped = ref(false);
let typeTimer: ReturnType<typeof setTimeout> | null = null;
let flipTimer: ReturnType<typeof setTimeout> | null = null;
let flipReported = false;
/** When this occurrence's outcome arrived (the store's fallback hold counts from the same moment). */
let outcomeSeenAt: number | null = null;
/** Sol r4: the card may only turn once its FRONT face for this occurrence is on screen. True from a mount or an
 *  occurrence change until the next tick has committed the front face (and its style has been flushed). */
let frontPending = true;
let frontToken = 0;
let unmounted = false;
const cardEl = ref<HTMLElement | null>(null);

function cancelTimers(): void {
  if (typeTimer) clearTimeout(typeTimer);
  if (flipTimer) clearTimeout(flipTimer);
  typeTimer = null;
  flipTimer = null;
}

function stepText(key: string): string {
  return props.progress.steps.find((step) => step.key === key)?.text ?? '';
}

/** A fresh occurrence (mount or reconnect): the lines already there render at once. */
function resetOccurrence(): void {
  cancelTimers();
  for (const key of Object.keys(typed)) delete typed[key];
  queue.length = 0;
  typingKey.value = null;
  flipped.value = false;
  flipReported = false;
  outcomeSeenAt = props.progress.outcome ? Date.now() : null;
  for (const step of props.progress.steps) typed[step.key] = Number.POSITIVE_INFINITY;
}

/** Sol r1: the typing must not outlive the store's fallback hold. Once the call has been decided for
 *  SEND_OFF_REVEAL_FALLBACK_MS, whatever is still queued renders at once and the card flips, so the flip report
 *  (which gives the back face its full hold) always arrives before that fallback hold could clear the modal. */
function typingOverdue(): boolean {
  return outcomeSeenAt !== null && Date.now() - outcomeSeenAt >= presentationMs(SEND_OFF_REVEAL_FALLBACK_MS);
}

function enqueueNewSteps(): void {
  for (const step of props.progress.steps) {
    if (!(step.key in typed) && !queue.includes(step.key)) queue.push(step.key);
  }
  pump();
}

function pump(): void {
  if (typingKey.value) return;
  const next = queue.shift();
  if (next === undefined) {
    maybeFlip();
    return;
  }
  if (reducedMotion.value || presentationMs(TYPE_MS_PER_CHAR) <= 0 || typingOverdue()) {
    typed[next] = Number.POSITIVE_INFINITY;
    pump();
    return;
  }
  typingKey.value = next;
  typed[next] = 0;
  typeNextChar();
}

function typeNextChar(): void {
  const key = typingKey.value;
  if (!key) return;
  if ((typed[key] ?? 0) >= stepText(key).length || typingOverdue()) {
    typed[key] = Number.POSITIVE_INFINITY;
    typingKey.value = null;
    pump();
    return;
  }
  typeTimer = setTimeout(() => {
    typeTimer = null;
    typed[key] = (typed[key] ?? 0) + 1;
    typeNextChar();
  }, presentationMs(TYPE_MS_PER_CHAR));
}

/** Flip once the server has decided the call AND every line has finished typing. */
function maybeFlip(): void {
  if (frontPending || flipped.value || !props.progress.outcome || typingKey.value || queue.length) return;
  flipped.value = true;
  if (reducedMotion.value) {
    reportShown();
    return;
  }
  flipTimer = setTimeout(() => {
    flipTimer = null;
    reportShown();
  }, FLIP_FALLBACK_MS);
}

function reportShown(): void {
  if (flipTimer) clearTimeout(flipTimer);
  flipTimer = null;
  if (flipReported) return;
  flipReported = true;
  emit('flip-shown', props.progress.occurrenceKey ?? '');
}

function onTransitionEnd(event: TransitionEvent): void {
  if (event.target !== event.currentTarget || !flipped.value) return;
  if (event.propertyName && event.propertyName !== 'transform') return;
  reportShown();
}

resetOccurrence();
/** Commit the front face first, then allow the flip: a new occurrence's card turns like the first one did. Cancelled
 *  by a later occurrence change and by unmount. */
function commitFrontThenFlip(): void {
  frontPending = true;
  const token = ++frontToken;
  void nextTick(() => {
    if (token !== frontToken || unmounted) return;
    void cardEl.value?.offsetWidth; // flush the front face's style so the turn starts from it
    frontPending = false;
    maybeFlip();
  });
}
watch(() => props.progress.occurrenceKey, (key, previous) => {
  if (key === previous) return;
  resetOccurrence();
  commitFrontThenFlip();
});
watch(() => props.progress.steps.map((step) => step.key).join('\n'), enqueueNewSteps);
watch(() => props.progress.outcome, (outcome) => {
  if (!outcome) outcomeSeenAt = null;
  else if (outcomeSeenAt === null) outcomeSeenAt = Date.now();
  maybeFlip();
});
onMounted(() => commitFrontThenFlip());
onBeforeUnmount(() => {
  unmounted = true;
  frontToken += 1;
  cancelTimers();
});

const visibleSteps = computed(() => props.progress.steps
  .filter((step) => step.key in typed)
  .map((step) => ({ ...step, shown: step.text.slice(0, Math.min(typed[step.key] ?? 0, step.text.length)) })));

function mark(tone: SendOffRevealStep['tone']): string {
  return tone === 'failure' ? '✕' : tone === 'pending' ? '…' : '•';
}

const outcome = computed(() => props.progress.outcome ?? null);
const overturned = computed(() => outcome.value?.result === 'overturned');
const resultLine = computed(() => overturned.value
  ? $t('dialogs.sendOffWaitingModal.back.staysOnPitch', { playerName: props.progress.playerName })
  : $t('dialogs.sendOffWaitingModal.back.isSentOff', { playerName: props.progress.playerName }));
/** What decided it - only when a roll did (a declined decision has no roll to name). */
const decidedLine = computed(() => {
  const o = outcome.value;
  if (!o || o.roll == null) return '';
  if (o.decidedBy === 'argue') {
    return o.result === 'overturned'
      ? $t('dialogs.sendOffWaitingModal.back.argueSucceeded')
      : $t('dialogs.sendOffWaitingModal.back.argueFailed');
  }
  return o.result === 'overturned'
    ? $t('dialogs.sendOffWaitingModal.back.bribeAccepted')
    : $t('dialogs.sendOffWaitingModal.back.bribeRefused');
});
const dieLabel = computed(() => {
  const o = outcome.value;
  if (!o) return '';
  if (o.decidedBy === 'argue') {
    return o.minimumRoll != null
      ? $t('dialogs.sendOffWaitingModal.back.dieArgue', { minimumRoll: o.minimumRoll })
      : $t('dialogs.sendOffWaitingModal.back.dieArgueNoTarget');
  }
  return o.minimumRoll != null
    ? $t('dialogs.sendOffWaitingModal.back.dieBribe', { minimumRoll: o.minimumRoll })
    : $t('dialogs.sendOffWaitingModal.back.dieBribeNoTarget');
});
</script>

<template>
  <div class="sendoff-waiting-backdrop" :class="{ resolved: progress.resolved }"
    data-testid="sendoff-waiting-backdrop">
    <section class="sendoff-waiting"
      :class="{ resolved: progress.resolved, flipped, 'reduced-motion': reducedMotion }"
      :role="progress.resolved ? 'status' : 'dialog'"
      :aria-modal="progress.resolved ? undefined : 'true'"
      aria-labelledby="sendoff-waiting-title"
      data-testid="sendoff-waiting">
      <!-- Sol r5: one card element per occurrence - each mounts at 0 degrees with no turn in flight, then flips. -->
      <div ref="cardEl" :key="progress.occurrenceKey ?? ''" class="sendoff-waiting-card" data-testid="sendoff-waiting-card"
        @transitionend="onTransitionEnd">
        <div v-for="face in FACES" :key="face" class="sendoff-waiting-face"
          :class="[face, { overturned: face === 'back' && overturned }]"
          :aria-hidden="(face === 'back') !== flipped ? 'true' : undefined"
          :data-testid="`sendoff-waiting-${face}`">
          <header class="sendoff-waiting-head">
            <div class="sendoff-waiting-player">
              <span class="sendoff-waiting-portrait-frame">
                <img v-if="portraitSrc" class="sendoff-waiting-portrait" :src="portraitSrc" alt="" aria-hidden="true" />
              </span>
              <span class="sendoff-waiting-player-name">{{ progress.playerName }}</span>
              <span v-if="positionName" class="sendoff-waiting-position">{{ terms(positionName) }}</span>
            </div>
            <div class="sendoff-waiting-heading">
              <h2 :id="face === 'front' ? 'sendoff-waiting-title' : 'sendoff-waiting-result-title'">
                <template v-if="face === 'front'"><DisplayCaps :text="$t('dialogs.sendOffWaitingModal.sendOffReview')" /></template>
                <template v-else-if="overturned"><DisplayCaps :text="$t('dialogs.sendOffWaitingModal.back.callOverturned')" /></template>
                <template v-else><DisplayCaps :text="$t('dialogs.sendOffWaitingModal.back.sentOff')" /></template>
              </h2>
              <span class="sendoff-waiting-team">{{ progress.coach || progress.teamName }}</span>
            </div>
            <div class="sendoff-waiting-refcol">
              <span class="sendoff-waiting-spotted"><DisplayCaps :text="$t('dialogs.sendOffWaitingModal.spotted')" /></span>
              <span v-if="refereeIconUrl" class="sendoff-waiting-ref-frame" aria-hidden="true">
                <img :src="refereeIconUrl" class="sendoff-waiting-ref" alt="" />
              </span>
            </div>
          </header>
          <ol v-if="face === 'front'" class="sendoff-waiting-steps" aria-live="polite"
            :aria-label="$t('dialogs.sendOffWaitingModal.sendOffProgress')">
            <li v-for="step in visibleSteps" :key="step.key" :data-tone="step.tone" :data-kind="step.kind">
              <span class="sendoff-waiting-mark" aria-hidden="true">{{ mark(step.tone) }}</span>
              <span class="sendoff-waiting-sr">{{ step.text }}</span>
              <span class="sendoff-waiting-line" :class="{ typing: step.key === typingKey }" aria-hidden="true">{{ step.shown }}</span>
            </li>
          </ol>
          <div v-else class="sendoff-waiting-back-body">
            <p class="sendoff-waiting-result" aria-live="polite" data-testid="sendoff-waiting-result">
              <template v-if="flipped && outcome">
                <strong>{{ resultLine }}</strong>
                <span v-if="decidedLine" class="sendoff-waiting-decided">{{ decidedLine }}</span>
              </template>
            </p>
            <div v-if="outcome && outcome.roll != null" class="sendoff-waiting-die" data-testid="sendoff-waiting-die">
              <span class="sendoff-waiting-die-face"><D6Face :value="outcome.roll" /></span>
              <span class="sendoff-waiting-die-label">{{ dieLabel }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
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
/* Owner 10-30 (approved mock v6): the card turns on its Y axis; both faces share one grid cell. */
.sendoff-waiting {
  box-sizing: border-box;
  width: min(560px, calc(100% - 32px));
  color: #f3f0e6;
  font-family: var(--ui-font, var(--font-display));
  perspective: 1400px;
}
.sendoff-waiting-card {
  display: grid;
  transform-style: preserve-3d;
  transition: transform 640ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.sendoff-waiting.flipped .sendoff-waiting-card { transform: rotateY(180deg); }
.sendoff-waiting-face {
  grid-area: 1 / 1;
  box-sizing: border-box;
  min-width: 0;
  border: 2px solid #69747e;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(28, 33, 41, 0.98), rgba(12, 15, 21, 0.98) 62%);
  box-shadow: 0 10px 34px #000d, inset 0 1px 0 #ffffff1a;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}
.sendoff-waiting-face.back { transform: rotateY(180deg); }
.sendoff-waiting-face.back.overturned {
  border-color: #4fbf6a;
  background: linear-gradient(135deg, rgba(12, 48, 24, 0.98), rgba(8, 16, 14, 0.98) 62%);
  box-shadow: 0 10px 34px #000d, 0 0 28px #4fbf6a55, inset 0 1px 0 #ffffff1a;
}
/* Reduced motion: a cross-fade instead of the turn. */
.sendoff-waiting.reduced-motion .sendoff-waiting-card { transition: none; transform: none; }
.sendoff-waiting.reduced-motion .sendoff-waiting-face { transition: opacity 240ms ease; }
.sendoff-waiting.reduced-motion .sendoff-waiting-face.back { transform: none; opacity: 0; }
.sendoff-waiting.reduced-motion.flipped .sendoff-waiting-face.front { opacity: 0; }
.sendoff-waiting.reduced-motion.flipped .sendoff-waiting-face.back { opacity: 1; }
.sendoff-waiting-head {
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr) 96px;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-bottom: 1px solid #ffffff20;
  background: #05070a88;
  border-radius: 8px 8px 0 0;
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
.sendoff-waiting-heading {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  text-align: center;
}
.sendoff-waiting-team {
  display: block;
  max-width: 100%;
  overflow: hidden;
  color: #c5ccd5;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  letter-spacing: 0.1em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}
.sendoff-waiting h2 {
  margin: 0;
  color: #c5ccd5;
  font-size: max(var(--ui-min-primary-text-size, 16px), 20px);
  line-height: 1.1;
  text-transform: uppercase;
}
.sendoff-waiting-face.back.overturned h2 { color: #7be48f; }
.sendoff-waiting-refcol { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.sendoff-waiting-spotted {
  padding: 4px 7px;
  color: #ff2436;
  border: 1px solid #ff2436;
  border-radius: 4px;
  background: #05070acc;
  font-size: max(var(--ui-min-text-size, 12px), 11px);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  text-shadow: 0 0 8px #ff243666;
  white-space: nowrap;
}
.sendoff-waiting-ref-frame { display: grid; width: 56px; height: 56px; place-items: center; overflow: hidden; border: 1px solid #53606e; border-radius: 6px; background: linear-gradient(145deg, #202832, #090d12); }
.sendoff-waiting-ref { width: 50px; height: 50px; object-fit: contain; image-rendering: pixelated; }
.sendoff-waiting-steps { min-height: 96px; margin: 0; padding: 14px 20px 8px; list-style: none; }
.sendoff-waiting-steps li {
  position: relative;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 7px;
  padding: 5px 0;
  color: #f3f0e6;
  font-family: Arial, Helvetica, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 14px);
  line-height: 1.35;
}
.sendoff-waiting-mark { color: #c5ccd5; font-weight: 900; text-align: center; }
.sendoff-waiting-steps li[data-tone='pending'] { color: #c5ccd5; }
.sendoff-waiting-steps li[data-tone='failure'],
.sendoff-waiting-steps li[data-tone='failure'] .sendoff-waiting-mark { color: #ff7a7e; }
.sendoff-waiting-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.sendoff-waiting-line.typing::after { content: '▌'; margin-left: 1px; animation: sendoff-waiting-caret 700ms steps(1) infinite; }
@keyframes sendoff-waiting-caret { 50% { opacity: 0; } }
.sendoff-waiting-back-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px;
  padding: 0 20px 16px;
}
.sendoff-waiting-result {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 18px 0 6px;
  color: #f3f0e6;
  font-family: Arial, Helvetica, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 15px);
  line-height: 1.5;
}
.sendoff-waiting-face.back.overturned .sendoff-waiting-result strong { color: #7be48f; }
.sendoff-waiting-die { display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 12px; }
.sendoff-waiting-die-face { display: grid; place-items: center; border-radius: 12px; --d6-size: 72px; filter: drop-shadow(0 6px 10px #000a); }
.sendoff-waiting-face.back.overturned .sendoff-waiting-die-face {
  background: radial-gradient(circle, #4fbf6a55, transparent 70%);
  filter: drop-shadow(0 0 10px #4fbf6acc) sepia(0.35) hue-rotate(70deg) saturate(1.3);
}
.sendoff-waiting-die-label {
  color: #c5ccd5;
  font-size: max(var(--ui-min-text-size, 12px), 10px);
  letter-spacing: 0.1em;
  text-align: center;
  text-transform: uppercase;
}
@media (prefers-reduced-motion: reduce) {
  .sendoff-waiting-card { transition: none; }
  .sendoff-waiting-line.typing::after { animation: none; }
}
@media (max-width: 480px) {
  .sendoff-waiting-head { grid-template-columns: 76px minmax(0, 1fr) 72px; gap: 8px; padding: 10px 12px; }
  .sendoff-waiting-portrait-frame { width: 58px; height: 58px; }
  .sendoff-waiting-portrait { width: 54px; height: 54px; }
  .sendoff-waiting h2 { font-size: max(var(--ui-min-primary-text-size, 16px), 16px); }
  .sendoff-waiting-steps { padding-inline: 12px; }
  .sendoff-waiting-back-body { padding-inline: 12px; }
}
</style>
