<script setup lang="ts">
/** First-launch setup wizard (owner 10-06). Runs once per SETUP_WIZARD_VERSION after the contributions screen and
 *  replaces the old account-setup splash; re-runnable from Settings → General. A gate like the legal notice: no
 *  dismiss, Esc does nothing. Every choice step is prefilled from the current settings and writes ONLY when an option
 *  is selected (immediately, so Back/Next never loses a choice). The step model lives in game/setupWizard.ts. */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { D6_FACE_VALUES, bundledSkillBadgeUrl } from '@fumbbl40k/ffb-pitch';
import D6Face from './D6Face.vue';
import { settings } from '../game/settings';
import { flushFumbblPassword } from '../game/credentials';
import { importFumbblMarkings } from '../game/fumbblMarkingsImport';
import { openExternal } from '../game/openExternal';
import { importAssetPackForApply, packCapabilityLabels, publishAssetAssignments, useWholeAssetPack } from '../game/assetPackActions';
import { abandonAssetAssignmentIntent, assetMods, beginAssetAssignmentIntent, type InstalledAssetPack } from '../game/assetMods';
import {
  PACK_SWITCH_TIMEOUT_MS,
  FONT_SAMPLE,
  applySetupOption,
  prefillSetupOption,
  setupOptionAssignmentToClear,
  visibleSetupSteps,
  type SetupOption,
  type SetupStep,
} from '../game/setupWizard';

const props = defineProps<{
  /** Present only when the host has a Home pane (another branch); absent = that step is skipped entirely. */
  homeLogin?: { open: () => void };
  /** Re-run from Settings: drawn over the live shell with a see-through backdrop instead of as a launch gate. */
  overlay?: boolean;
}>();
const emit = defineEmits<{ finish: [] }>();

// A missing image (e.g. stadium-off.png before it is supplied) must not break the build: glob, then render nothing.
const onboardingImages = import.meta.glob<string>('../assets/onboarding/*.png', { eager: true, query: '?url', import: 'default' });
const imageByKey = new Map(Object.entries(onboardingImages).map(([path, url]) => [path.replace(/^.*\/([^/]+)\.png$/, '$1'), url]));
function imageUrl(key: string): string | undefined { return imageByKey.get(key); }

// Owner 10-06: a fuller spread of the illustrated set (two rows of six), centred in the card.
const SKILL_EXAMPLES = ['Block', 'Guard', 'Dodge', 'Horns', 'Tackle', 'Frenzy', 'Wrestle', 'Leap', 'Catch', 'Claw', 'Dauntless', 'Fend'] as const;
/** The Illustrated card previews the ILLUSTRATED family explicitly — never the active pack or the flat set. */
function illustratedIconUrl(skill: string): string | undefined { return bundledSkillBadgeUrl(skill, 'illustrated'); }
const TWITCH_URL = 'https://twitch.tv/flutethecat';

const steps = computed<SetupStep[]>(() => visibleSetupSteps({ hasHomeLogin: !!props.homeLogin }));
const index = ref(0);
const step = computed(() => steps.value[index.value]!);
const isLast = computed(() => index.value === steps.value.length - 1);

// The selected card is derived ONLY from the live settings: Back after e.g. "Use it now" on a mod pack shows the truth,
// and when an installed pack supplies the slot no built-in card is shown as selected.
function selectedFor(s: SetupStep): string | null {
  return prefillSetupOption(s.id, settings);
}

// Picks are serialised: while a pack activation (or a pack import) is in flight, cards, Next, Skip and Finish are
// disabled so a second pick cannot snapshot stale assignments. Back is never blocked.
const PACK_SWITCH_TIMEOUT_MESSAGE = 'Could not switch packs — try again';
const pickBusy = ref(false);
const packBusy = ref(false); // step 9: an import or "Use it now" in flight
// Any pack operation — ours (a pick, "Use it now") or a pending activation/import anywhere — locks the picks, so an
// overlapping pick can never act on assignments that are about to change.
const picksLocked = computed(() => pickBusy.value || packBusy.value || assetMods.busy || !!assetMods.pendingAssignments);

/** Race an activation against PACK_SWITCH_TIMEOUT_MS. On timeout the activation is abandoned (superseded + the pending
 *  marker cleared, so Settings > Assets never hangs) and 'timeout' is returned. */
async function withPackTimeout(run: (intent: number) => Promise<boolean>): Promise<boolean | 'timeout'> {
  const intent = beginAssetAssignmentIntent();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), PACK_SWITCH_TIMEOUT_MS); });
  try {
    const result = await Promise.race([run(intent), timedOut]);
    if (result === 'timeout') abandonAssetAssignmentIntent();
    return result;
  } finally {
    clearTimeout(timer);
  }
}
const choiceError = ref('');
const retryPick = ref<{ s: SetupStep; option: SetupOption } | null>(null);
async function choose(s: SetupStep, option: SetupOption): Promise<void> {
  if (picksLocked.value) return;
  choiceError.value = '';
  retryPick.value = null;
  const slot = setupOptionAssignmentToClear(s.id, option.id, settings);
  if (slot) {
    // Mirrors AssetPackSettings.changeAssignment's built-in path: activate FIRST, then write the family.
    pickBusy.value = true;
    try {
      // The requested assignments are snapshotted here, at publish time (the lock rules out a concurrent change).
      const result = await withPackTimeout((intent) => publishAssetAssignments({ ...settings.assetPackAssignments, [slot]: '' }, intent));
      if (result === 'timeout') {
        // The stuck activation is abandoned; family + selection unchanged.
        choiceError.value = PACK_SWITCH_TIMEOUT_MESSAGE;
        retryPick.value = { s, option };
        return;
      }
      if (!result) {
        choiceError.value = assetMods.error || 'The installed pack could not be switched off; change it in Settings → Assets.';
        return; // family + selection unchanged
      }
    } finally {
      pickBusy.value = false;
    }
  }
  applySetupOption(s.id, option.id, settings);
}
function retry(): void {
  const pending = retryPick.value;
  if (pending) void choose(pending.s, pending.option);
}

// Radio-group keyboard model: one tab stop per group, arrows move AND select (WAI-ARIA radio pattern).
const optionRefs = ref<HTMLElement[]>([]);
function tabIndexFor(s: SetupStep, option: SetupOption, i: number): number {
  const current = selectedFor(s);
  if (current) return current === option.id ? 0 : -1;
  return i === 0 ? 0 : -1;
}
function onOptionKeydown(event: KeyboardEvent, s: SetupStep, i: number): void {
  // Tab / Shift+Tab bubble on to the shell's focus trap (which stops them there).
  if (event.key === 'Tab') return;
  // The live game's window keydown handler (SpectateView) must never see these keys (confirm-move on Space/Enter).
  event.stopPropagation();
  const options = s.options ?? [];
  let next = -1;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (i + 1) % options.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (i - 1 + options.length) % options.length;
  else if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); void choose(s, options[i]!); return; }
  if (next < 0) return;
  event.preventDefault();
  void choose(s, options[next]!);
  void nextTick(() => optionRefs.value[next]?.focus());
}

// Step 4: "Import my markings from FUMBBL" — the SAME routine as Settings → Skills. Never automatic.
// The coach field follows settings.coach (as entered by then) until the user types an override.
const markingsCoachOverride = ref<string | null>(null);
const markingsCoach = computed<string>({
  get: () => markingsCoachOverride.value ?? settings.coach,
  set: (value) => { markingsCoachOverride.value = value; },
});
const markingsStatus = ref('');
const markingsBusy = ref(false);
async function importMarkings(): Promise<void> {
  if (markingsBusy.value) return;
  markingsBusy.value = true;
  try {
    markingsStatus.value = await importFumbblMarkings(markingsCoach.value, (status) => { markingsStatus.value = status; });
  } finally {
    markingsBusy.value = false;
  }
}

// Owner 10-06: the Super FUMBBL (fork) account entry is NOT part of the wizard; Settings → General keeps it.

// Both password fields debounce their keychain write (400 ms); leaving the step is faster than that, so flush.
function flushPasswords(): void {
  void flushFumbblPassword();
}

// Step 9: "Import Mod Pack" — the same native importer Settings → Assets uses, result inline (packBusy is above).
const packStatus = ref('');
const packError = ref('');
const importedPack = ref<InstalledAssetPack | null>(null);
async function importModPack(): Promise<void> {
  if (packBusy.value) return;
  packBusy.value = true;
  packError.value = '';
  packStatus.value = '';
  importedPack.value = null;
  try {
    const result = await importAssetPackForApply();
    importedPack.value = result.pack;
    packStatus.value = result.status;
    packError.value = result.error;
  } finally {
    packBusy.value = false;
  }
}
async function applyImportedPack(): Promise<void> {
  const pack = importedPack.value;
  if (!pack || packBusy.value) return;
  packBusy.value = true;
  try {
    const result = await withPackTimeout((intent) => useWholeAssetPack(pack, intent));
    if (result === true) { packStatus.value = `${pack.name} ${pack.version} applied.`; importedPack.value = null; }
    else packError.value = result === 'timeout' ? PACK_SWITCH_TIMEOUT_MESSAGE : (assetMods.error || 'The pack could not be applied.');
  } finally {
    packBusy.value = false;
  }
}

const cardBody = ref<HTMLElement | null>(null);
watch(index, (_, previous) => {
  if (steps.value[previous]?.kind === 'login') flushPasswords();
  optionRefs.value = [];
  void nextTick(() => { cardBody.value?.scrollTo?.({ top: 0 }); focusInitial(); });
});
// Focus: move into the wizard on mount (the selected card, else Next) and trap Tab inside it (aria-modal). Every key
// stops here so no window-level gameplay handler acts while the wizard is up; App restores focus on Finish.
const shellEl = ref<HTMLElement | null>(null);
function focusables(): HTMLElement[] {
  const root = shellEl.value;
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]'));
}
function focusInitial(): void {
  const root = shellEl.value;
  if (!root) return;
  const target = root.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ?? root.querySelector<HTMLElement>('.setup-next');
  target?.focus();
}
function onShellKeydown(event: KeyboardEvent): void {
  event.stopPropagation();
  if (event.key !== 'Tab') return;
  const list = focusables();
  if (!list.length) { event.preventDefault(); return; }
  const first = list[0]!;
  const last = list[list.length - 1]!;
  const active = document.activeElement;
  const inside = !!active && !!shellEl.value?.contains(active);
  if (event.shiftKey && (active === first || !inside)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (active === last || !inside)) { event.preventDefault(); first.focus(); }
}
onMounted(() => { void nextTick(focusInitial); });

function back(): void { if (index.value > 0) index.value -= 1; }
function next(): void { if (!isLast.value) index.value += 1; }
function finish(): void {
  flushPasswords();
  emit('finish');
}
</script>

<template>
  <div ref="shellEl" class="setup-shell" :class="{ 'setup-shell--overlay': overlay }" role="dialog" aria-modal="true"
    aria-labelledby="first-launch-setup-title" data-testid="first-launch-setup" @keydown="onShellKeydown">
    <div class="setup-card">
      <header class="setup-head">
        <p class="setup-progress" aria-live="polite">Step {{ index + 1 }} of {{ steps.length }}</p>
        <ol class="setup-rail" aria-hidden="true">
          <li v-for="(s, i) in steps" :key="s.id" :data-state="i < index ? 'done' : i === index ? 'current' : 'todo'"></li>
        </ol>
        <h1 id="first-launch-setup-title">{{ step.title }}</h1>
        <p class="setup-lede">{{ step.lede }}</p>
      </header>

      <div ref="cardBody" class="setup-body">
        <!-- Choice steps: large selectable cards with radio semantics. -->
        <template v-if="step.kind === 'choice'">
          <div class="setup-options" :class="{ 'setup-options--rows': step.id === 'blockDice' || step.id === 'diceColour' }" role="radiogroup"
            :aria-labelledby="'first-launch-setup-title'">
            <div v-for="(option, i) in step.options" :key="option.id"
              :ref="(el) => { if (el) optionRefs[i] = el as HTMLElement; }"
              class="setup-option" :class="{ 'setup-option--row': step.id === 'blockDice' || step.id === 'diceColour' }"
              role="radio" :aria-checked="selectedFor(step) === option.id" :aria-disabled="picksLocked" :tabindex="tabIndexFor(step, option, i)"
              :data-option="option.id" @click="choose(step, option)" @keydown="onOptionKeydown($event, step, i)">
              <span class="setup-radio" aria-hidden="true"></span>
              <div class="setup-option-main">
                <div v-if="step.id === 'skills' && option.id === 'icons'" class="setup-images setup-skill-icons">
                  <figure v-for="skill in SKILL_EXAMPLES" :key="skill">
                    <img v-if="illustratedIconUrl(skill)" :src="illustratedIconUrl(skill)" :alt="skill" />
                    <figcaption>{{ skill }}</figcaption>
                  </figure>
                </div>
                <div v-else-if="option.fontStack" class="setup-font-sample" :style="{ fontFamily: option.fontStack }">
                  <span class="setup-font-title">{{ FONT_SAMPLE.title }}</span>
                  <span>{{ FONT_SAMPLE.sentence }}</span>
                  <span class="setup-font-digits">{{ FONT_SAMPLE.digits }}</span>
                </div>
                <div v-else-if="option.d6Variant" class="setup-images setup-d6">
                  <D6Face v-for="value in D6_FACE_VALUES" :key="value" :value="value" :variant="option.d6Variant" />
                </div>
                <div v-else-if="option.images.length" class="setup-images" :class="{ 'setup-dice': step.id === 'blockDice' }">
                  <template v-for="key in option.images" :key="key">
                    <img v-if="imageUrl(key)" :src="imageUrl(key)" alt="" />
                  </template>
                </div>
                <strong class="setup-option-title">{{ option.title }}</strong>
                <span v-if="option.description" class="setup-option-desc">{{ option.description }}</span>
              </div>
            </div>
          </div>
          <p v-if="choiceError" class="setup-error" role="alert">
            {{ choiceError }}
            <button v-if="retryPick" type="button" class="setup-secondary setup-retry" @click="retry">Try again</button>
          </p>
          <div v-if="step.id === 'skills' && selectedFor(step) === 'markings'" class="setup-markings-import">
            <label class="setup-field">Coach
              <input v-model="markingsCoach" type="text" spellcheck="false" placeholder="FUMBBL coach" />
            </label>
            <button type="button" class="setup-secondary" :disabled="markingsBusy" @click="importMarkings">Import my markings from FUMBBL</button>
            <p v-if="markingsStatus" class="setup-hint" aria-live="polite">{{ markingsStatus }}</p>
          </div>
        </template>

        <!-- Step 7: FUMBBL login (bound exactly as Settings → General / the old setup splash). -->
        <template v-else-if="step.kind === 'login'">
          <section class="setup-panel">
            <label class="setup-field">Coach name
              <input v-model="settings.coach" type="text" autocomplete="username" placeholder="your FUMBBL coach name" />
            </label>
            <label class="setup-field">Password
              <input v-model="settings.password" type="password" autocomplete="current-password" placeholder="FUMBBL password" />
            </label>
            <p class="setup-hint">Stored locally on this machine only — never sent anywhere but the server you connect to.</p>
          </section>
        </template>

        <!-- Step 8: only when the host provides a Home pane. -->
        <template v-else-if="step.kind === 'homeLogin'">
          <div class="setup-actions-row">
            <button type="button" class="setup-secondary" @click="homeLogin?.open()">Open the Home pane</button>
          </div>
        </template>

        <!-- Step 9: mod packs. -->
        <template v-else-if="step.kind === 'modPacks'">
          <div class="setup-actions-row">
            <button type="button" class="setup-secondary" :disabled="packBusy || assetMods.busy" @click="importModPack">Import Mod Pack</button>
            <button v-if="importedPack" type="button" class="setup-secondary" :disabled="packBusy" @click="applyImportedPack">
              Use it now ({{ packCapabilityLabels(importedPack).join(', ') }})
            </button>
          </div>
          <p v-if="packStatus" class="setup-hint" aria-live="polite">{{ packStatus }}</p>
          <p v-if="packError" class="setup-error" role="alert">{{ packError }}</p>
        </template>

        <!-- Step 10: fine tuning. -->
        <template v-else-if="step.kind === 'fineTuning'">
          <section class="setup-panel setup-fine">
            <label class="setup-field">Colourblind mode
              <select v-model="settings.colorblindMode">
                <option value="off">Off</option>
                <option value="deuteranopia">Deuteranopia (red-green, most common)</option>
                <option value="protanopia">Protanopia (red-green)</option>
                <option value="tritanopia">Tritanopia (blue-yellow)</option>
              </select>
            </label>
            <label class="setup-field">UI text size
              <span class="setup-range">
                <input v-model.number="settings.uiTextSize" type="range" min="12" max="20" step="1" />
                <span>{{ settings.uiTextSize }}px</span>
              </span>
            </label>
            <p class="setup-text-preview" :style="{ fontSize: `${settings.uiTextSize}px` }">Sub-headers and annotations will read at this size.</p>
            <label class="setup-check">
              <input v-model="settings.discordPresence" type="checkbox" />
              <span>Discord Rich Presence (show my game as my Discord activity; off = private)</span>
            </label>
          </section>
        </template>
      </div>

      <footer class="setup-footer">
        <button type="button" class="setup-back" :disabled="index === 0" @click="back">◂ Back</button>
        <!-- owner 2026-07-14: build credit + Twitch link (moved off the menu bar onto the old setup splash; since 10-06
             it lives on the wizard's last step). -->
        <span v-if="isLast" class="setup-build-credit">
          Client built by FluteTheCat
          <a class="setup-twitch-link" :href="TWITCH_URL" title="twitch.tv/flutethecat" @click.prevent="openExternal(TWITCH_URL)">twitch.tv/flutethecat</a>
        </span>
        <span class="setup-footer-spacer"></span>
        <button v-if="step.kind === 'login' || step.kind === 'modPacks' || step.kind === 'homeLogin'" type="button"
          class="setup-skip" :disabled="picksLocked" @click="isLast ? finish() : next()">{{ step.kind === 'login' ? 'Skip for now' : 'Skip' }}</button>
        <button v-if="!isLast" type="button" class="setup-next" :disabled="picksLocked" @click="next">Next ▸</button>
        <button v-else type="button" class="setup-next setup-finish" :disabled="picksLocked" @click="finish">Finish</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.setup-shell {
  position: fixed;
  inset: 0;
  z-index: 12500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--ui-secondary, #000);
}
.setup-shell--overlay { z-index: 9000; background: color-mix(in srgb, var(--ui-secondary, #000) 55%, transparent); }
.setup-card {
  display: flex;
  flex-direction: column;
  width: min(1180px, 100%);
  max-height: calc(100vh - 32px);
  padding: 20px 24px;
  color: var(--ui-text);
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 8px;
}
.setup-head h1 {
  margin: 4px 0 4px;
  color: var(--ui-heading);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.5rem);
  letter-spacing: 0.06em;
}
.setup-progress { margin: 0; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 0.85rem); letter-spacing: 0.05em; text-transform: uppercase; }
.setup-rail { display: flex; gap: 4px; margin: 6px 0 10px; padding: 0; list-style: none; }
.setup-rail li { flex: 1; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--ui-border) 60%, transparent); }
.setup-rail li[data-state='done'] { background: color-mix(in srgb, var(--ui-primary) 55%, transparent); }
.setup-rail li[data-state='current'] { background: var(--ui-primary); }
.setup-lede { margin: 0 0 12px; color: var(--ui-muted); font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); }
.setup-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 6px; }
.setup-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.setup-options--rows { grid-template-columns: 1fr; }
.setup-option {
  position: relative;
  display: flex;
  gap: 12px;
  padding: 14px;
  background: color-mix(in srgb, var(--ui-surface) 80%, var(--ui-secondary, #000));
  border: 2px solid var(--ui-border);
  border-radius: 8px;
  cursor: pointer;
}
.setup-option:hover { border-color: color-mix(in srgb, var(--ui-primary) 60%, var(--ui-border)); }
.setup-option:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 2px; }
.setup-option[aria-checked='true'] { border-color: var(--ui-primary); background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-surface)); }
.setup-option--row { align-items: center; }
.setup-radio {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  border: 2px solid var(--ui-border);
  border-radius: 50%;
}
.setup-option--row .setup-radio { margin-top: 0; }
.setup-option[aria-checked='true'] .setup-radio { border-color: var(--ui-primary); background: radial-gradient(circle, var(--ui-primary) 0 45%, transparent 50%); }
.setup-option-main { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 6px; }
.setup-option-title { font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem); }
.setup-option-desc { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 0.9rem); line-height: 1.4; }
.setup-images { display: flex; justify-content: center; gap: 8px; }
.setup-images img { display: block; max-width: 100%; max-height: min(40vh, 420px); object-fit: contain; border-radius: 4px; }
.setup-dice { justify-content: flex-start; }
.setup-dice img { width: 72px; height: 72px; image-rendering: auto; }
.setup-font-sample {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  color: var(--ui-text);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  line-height: 1.35;
  background: var(--ui-secondary, #000);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
}
.setup-font-title { color: var(--ui-heading); font-size: max(var(--ui-min-primary-text-size, 16px), 1.5rem); letter-spacing: 0.04em; }
.setup-font-digits { letter-spacing: 0.08em; }
.setup-d6 { justify-content: flex-start; --d6-size: 56px; }
.setup-skill-icons { flex-wrap: wrap; justify-content: center; align-content: center; gap: 8px 10px; max-width: 460px; margin: 6px auto 4px; }
.setup-skill-icons figure { display: flex; flex-direction: column; align-items: center; margin: 0; gap: 3px; width: 66px; }
.setup-skill-icons img { width: 52px; height: 52px; }
.setup-skill-icons figcaption { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 0.72rem); white-space: nowrap; }
.setup-markings-import { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; margin-top: 12px; }
.setup-markings-import .setup-hint { flex-basis: 100%; }
.setup-panel { display: flex; flex-direction: column; gap: 10px; max-width: 560px; margin-bottom: 16px; }
.setup-panel h2 { margin: 6px 0 0; color: var(--ui-eggshell, var(--ui-text)); font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem); letter-spacing: 0.05em; }
.setup-field { display: flex; flex-direction: column; gap: 4px; font-size: max(var(--ui-min-text-size, 12px), 0.9rem); }
.setup-field input[type='text'], .setup-field input[type='password'], .setup-field select {
  padding: 7px 9px;
  color: var(--ui-text);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  background: var(--ui-secondary, #000);
  border: 1px solid var(--ui-border);
  border-radius: 5px;
}
.setup-range { display: flex; align-items: center; gap: 10px; }
.setup-range input { flex: 1; }
.setup-text-preview { margin: 0; color: var(--ui-muted); }
.setup-check { display: flex; align-items: center; gap: 8px; }
.setup-super-login { display: flex; flex-direction: column; gap: 10px; }
.setup-actions-row { display: flex; flex-wrap: wrap; gap: 10px; }
.setup-hint { margin: 0; color: var(--ui-text-dim, var(--ui-muted)); font-size: max(var(--ui-min-text-size, 12px), 0.85rem); }
.setup-error { margin: 8px 0 0; color: var(--ui-danger, #e06c6c); font-size: max(var(--ui-min-text-size, 12px), 0.85rem); }
.setup-footer { display: flex; align-items: center; gap: 10px; padding-top: 14px; }
.setup-footer-spacer { flex: 1; }
.setup-build-credit { display: inline-flex; align-items: center; gap: 6px; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 0.75rem); }
.setup-twitch-link { color: #9146ff; }
.setup-twitch-link:hover { color: #b48cff; }
.setup-option[aria-disabled='true'] { cursor: progress; opacity: 0.7; }
.setup-next:disabled { cursor: progress; opacity: 0.6; }
.setup-back, .setup-skip, .setup-secondary {
  padding: 8px 16px;
  color: var(--ui-text);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  background: transparent;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  cursor: pointer;
}
.setup-retry { margin-left: 8px; padding: 4px 10px; }
.setup-back:disabled, .setup-skip:disabled, .setup-secondary:disabled { cursor: default; opacity: 0.45; }
.setup-next {
  padding: 9px 22px;
  color: var(--ui-text-on-primary);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  letter-spacing: 0.05em;
  background: var(--ui-primary);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  cursor: pointer;
}
.setup-next:hover { background: var(--ui-active); }
</style>
