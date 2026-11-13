<script setup lang="ts">
/**
 * Owner 11-06: the in-client welcome step. config-web (the League Manager) gates every state-changing call, the
 * desktop client's challenge / register / matchstatus included, behind its privacy notice (HTTP 428 "Complete your
 * profile first."). The website shows a blocking welcome modal; a coach who only uses the desktop client meets it here
 * instead: GET /api/me/onboarding fills the form, POST /api/me/onboarding saves it (game/accountApi.ts).
 *
 * Mirrors the website's rules: the privacy box and the league-contact box are never pre-ticked, Accept stays disabled
 * until the privacy box is ticked, a re-acceptance (`reaccept`) shows only the privacy step, server errors show verbatim.
 * Sol r1 P2: it acts only for the coach config-web gated. Before the GET and again before the POST the held session's
 * account (GET /api/account) must be that coach (coachNameKey, case-insensitive); otherwise nothing is read or sent and
 * the dialog names both coaches with a way to Settings > Account.
 * Sol r2 P2: the session is captured ONCE per step (an opaque handle, configWebAuth.ts); the account check, the GET and
 * the POST all carry exactly that session, and if the held session changed (a login / token exchange finished meanwhile)
 * the POST is not sent: the identity check runs again from scratch and the step is shown again.
 * Unlike the website it never traps the coach: Esc, the close button and "Not now" close it WITHOUT accepting (a coach
 * may just want to play official FUMBBL games). Nothing is retried after an accept; the requester shows a line and the
 * coach sends again (game/clientOnboardingPrompt.ts).
 *
 * The full notice is config-web's public /app/privacy page, opened in the system browser (game/openExternal.ts), never
 * inside the client. Modern = the League Manager panel (.sf-lm, sf-btn); Retro = the parchment card. Keyboard: Tab stays
 * inside, Enter runs the current step, Esc closes. Controller: v-pad-focus (B = close). Reduced motion: no entry animation.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { settings } from '../game/settings';
import { coachPassword } from '../game/credentials';
import { lmRootClass } from '../game/lmTheme';
import { motionReduced } from '../game/accessibilityModes';
import { PAD_FOCUS_PRIORITY, vPadFocus } from '../game/cardFocus';
import { openExternal } from '../game/openExternal';
import {
  accountSessionIs,
  captureAccountSession,
  completeOnboarding,
  ensureOnboardingSession,
  getAccount,
  getOnboarding,
  privacyNoticeUrl,
  type ConfigWebSessionHandle,
  type OnboardingSubmission,
  type OnboardingView,
} from '../game/accountApi';
import { ConfigWebHttpError } from '../game/configWebErrors';
import { clientOnboarding, finishClientOnboarding } from '../game/clientOnboardingPrompt';
import { COUNTRIES, countryByCode, countryLabel } from '../game/onboardingCountries';
import { coachNameKey } from '../game/fumbblCoachProfile';
import { localeRef } from '../i18n/state';
import { t } from '../i18n';

type Step = 'details' | 'privacy';

const emit = defineEmits<{ openAccountSettings: [] }>();

/** config-web's limit (contactSchema PREFERRED_NAME_MAX). */
const PREFERRED_NAME_MAX = 40;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s.]+$/;

const modern = computed(() => settings.uiStyle === 'modern');
const lmClass = computed(() => lmRootClass(settings.uiStyle));
const reduced = computed(() => motionReduced());

const phase = ref<'loading' | 'form' | 'loadError' | 'notNeeded' | 'wrongCoach'>('loading');
/** The coach config-web gated ('' = the session's own coach) and the coach the held session belongs to. */
const gatedCoach = computed(() => clientOnboarding.coach.trim());
const signedInAs = ref('');
/** The session this step was checked and read with (Sol r2 P2): every request of the step carries exactly this one. */
let stepSession: ConfigWebSessionHandle | null = null;
const view = ref<OnboardingView | null>(null);
const step = ref<Step>('details');
const busy = ref(false);
const error = ref('');
const nameError = ref('');
const emailError = ref('');
const countryError = ref('');
const form = ref({ preferredName: '', email: '', country: '', phone: '', leagueContact: false, privacyAccepted: false });
let initialPhone = '';

/** A re-acceptance shows the privacy step alone, unless the stored profile lacks a field the server needs. */
const privacyOnly = computed(() => Boolean(view.value?.reaccept && view.value.prefill.preferredName.trim() && countryByCode(view.value.prefill.country)));
const steps = computed<Step[]>(() => (privacyOnly.value ? ['privacy'] : ['details', 'privacy']));
const stepNumber = computed(() => steps.value.indexOf(step.value) + 1);
const reaccept = computed(() => view.value?.reaccept === true);
const countries = computed(() => {
  const locale = localeRef.value;
  return COUNTRIES.map((c) => ({ code: c.code, label: countryLabel(c, locale) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
});
const phonePrefix = computed(() => {
  if (form.value.phone.trim().startsWith('+')) return '';
  const c = countryByCode(form.value.country);
  return c ? `+${c.dial}` : '';
});
const emailFromDiscord = computed(() => view.value?.prefill.emailSource === 'discord' && Boolean(view.value.prefill.email)
  && form.value.email.trim().toLowerCase() === (view.value.prefill.email ?? '').toLowerCase());
const canAccept = computed(() => phase.value === 'form' && step.value === 'privacy' && form.value.privacyAccepted && !busy.value);

const root = ref<HTMLElement | null>(null);
const nameInput = ref<HTMLInputElement | null>(null);
const noticeButton = ref<HTMLButtonElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);

function errorText(e: unknown): string {
  if (e instanceof ConfigWebHttpError) {
    if (e.status === 401) return t('onboarding.error.signIn');
    if (e.status === 429) {
      return e.retryAfterSeconds !== null
        ? t('onboarding.error.rateLimitedSeconds', { seconds: e.retryAfterSeconds })
        : t('onboarding.error.rateLimited');
    }
  }
  return e instanceof Error && e.message ? e.message : String(e);
}

async function focusStep(): Promise<void> {
  await nextTick();
  const target = phase.value !== 'form' ? closeButton.value : step.value === 'details' ? nameInput.value : noticeButton.value;
  (target ?? root.value)?.focus({ preventScroll: true });
}

function fill(next: OnboardingView): void {
  view.value = next;
  const firstPhone = next.prefill.phones?.[0]?.number ?? '';
  initialPhone = firstPhone;
  form.value = {
    preferredName: next.prefill.preferredName ?? '',
    email: next.prefill.email ?? '',
    country: countryByCode(next.prefill.country)?.code ?? '',
    phone: firstPhone,
    // Never pre-ticked (owner rule, mirrors the website): the coach opts in here or keeps what is stored.
    leagueContact: false,
    privacyAccepted: false,
  };
}

/** Sol r1 P2: is the held session the gated coach? (GET /api/account; no gated coach = the session's own.) */
async function sessionIsGatedCoach(session: ConfigWebSessionHandle): Promise<boolean> {
  const want = gatedCoach.value;
  if (!want) return true;
  const identity = await getAccount(undefined, session);
  signedInAs.value = identity.ffbCoachId;
  return coachNameKey(identity.ffbCoachId) === coachNameKey(want);
}

async function load(attempt = 0): Promise<void> {
  phase.value = 'loading';
  error.value = '';
  busy.value = false;
  stepSession = null;
  try {
    const signedIn = await ensureOnboardingSession({ coach: gatedCoach.value || settings.coach40k.trim(), password: coachPassword() });
    const session = signedIn ? captureAccountSession() : null;
    if (!session) { error.value = t('onboarding.error.signIn'); phase.value = 'loadError'; return; }
    if (!(await sessionIsGatedCoach(session))) { phase.value = 'wrongCoach'; return; }
    // Replaced while the check was in flight: start over with the session held now (bounded; a churning store = sign in).
    if (!accountSessionIs(session)) {
      if (attempt < 2) return load(attempt + 1);
      error.value = t('onboarding.error.signIn'); phase.value = 'loadError'; return;
    }
    const next = await getOnboarding(undefined, session);
    stepSession = session;
    fill(next);
    if (!next.needed) { phase.value = 'notNeeded'; return; }
    step.value = steps.value[0]!;
    phase.value = 'form';
  } catch (e) {
    error.value = errorText(e);
    phase.value = 'loadError';
  } finally {
    void focusStep();
  }
}

function validateDetails(): boolean {
  const name = form.value.preferredName.trim();
  nameError.value = !name ? t('onboarding.error.nameRequired') : '';
  const email = form.value.email.trim();
  emailError.value = email && !EMAIL_PATTERN.test(email) ? t('onboarding.error.emailInvalid') : '';
  countryError.value = countryByCode(form.value.country) ? '' : t('onboarding.error.countryRequired');
  return !nameError.value && !emailError.value && !countryError.value;
}

function next(): void {
  if (!validateDetails()) return;
  error.value = '';
  step.value = 'privacy';
  void focusStep();
}

function back(): void {
  if (busy.value || !steps.value.includes('details')) return;
  error.value = '';
  step.value = 'details';
  void focusStep();
}

/** The POST body. A re-acceptance resends the stored name / email / country (the server needs them) and leaves the
 *  phone and the league-contact choice out (absent = keep what is stored). The league-contact box is sent only when
 *  ticked: unticked = keep what is stored (a first onboarding stores "not granted"). */
function submission(v: OnboardingView): OnboardingSubmission {
  const body: OnboardingSubmission = {
    preferredName: form.value.preferredName.trim(),
    email: form.value.email.trim() || null,
    privacyAccepted: true,
    privacyVersion: v.privacyVersion,
  };
  if (form.value.country) body.country = form.value.country;
  if (!privacyOnly.value) {
    const phone = form.value.phone.trim();
    if (phone !== initialPhone.trim()) body.phones = phone ? [{ number: phone }] : [];
    if (form.value.leagueContact) body.leagueContact = true;
  }
  return body;
}

async function accept(): Promise<void> {
  const v = view.value;
  if (!v || !canAccept.value) return;
  busy.value = true;
  error.value = '';
  try {
    const session = stepSession;
    // The session may have changed since the GET: never POST for a coach other than the gated one, never on another
    // session than the one this step was checked and read with (Sol r2 P2).
    if (!session || !accountSessionIs(session)) { await restartForChangedSession(); return; }
    if (!(await sessionIsGatedCoach(session))) { phase.value = 'wrongCoach'; return; }
    if (!accountSessionIs(session)) { await restartForChangedSession(); return; } // replaced during the check
    const saved = await completeOnboarding(submission(v), undefined, session);
    view.value = saved;
    if (saved.needed) { error.value = t('onboarding.error.stillNeeded'); return; }
    finishClientOnboarding(true);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

/** The held session changed under the step: nothing is sent; check the identity again from scratch and show the step. */
async function restartForChangedSession(): Promise<void> {
  await load();
  if (phase.value === 'form') error.value = t('onboarding.error.sessionChanged');
}

function submitStep(): void {
  if (phase.value !== 'form' || busy.value) return;
  if (step.value === 'details') next();
  else void accept();
}

function openNotice(): void {
  try { void openExternal(privacyNoticeUrl()); } catch (e) { error.value = errorText(e); }
}

function close(): void {
  if (busy.value) return;
  finishClientOnboarding(false);
}

/** Wrong coach: close (not accepted) and open Settings > Account, where the coach signs in as the gated one. */
function openAccountSettings(): void {
  if (busy.value) return;
  finishClientOnboarding(false);
  emit('openAccountSettings');
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
  if (event.key === 'Enter') {
    const target = event.target as HTMLElement | null;
    // A focused button / link keeps its own Enter (Back, Read the notice, Not now); anywhere else Enter runs the step.
    if (target && (target.tagName === 'BUTTON' || target.tagName === 'A' || target.tagName === 'TEXTAREA')) return;
    event.preventDefault();
    event.stopPropagation();
    submitStep();
    return;
  }
  if (event.key !== 'Tab' || !root.value) return;
  const stops = Array.from(root.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'));
  if (!stops.length) return;
  const first = stops[0]!, last = stops[stops.length - 1]!;
  const at = document.activeElement as HTMLElement | null;
  if (event.shiftKey && (at === first || !root.value.contains(at))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (at === last || !root.value.contains(at))) { event.preventDefault(); first.focus(); }
}

const padOptions = computed(() => ({ cancel: close, priority: PAD_FOCUS_PRIORITY.confirmation, close: 'dismiss' as const }));

/** Focus goes back to whatever opened the step (Send challenge, the settings button) when it closes. */
let opener: HTMLElement | null = null;
onMounted(() => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  void load();
});
onBeforeUnmount(() => { if (opener?.isConnected) opener.focus({ preventScroll: true }); });
// Asked again while open (another surface met the gate): read the view afresh.
watch(() => clientOnboarding.generation, () => { if (!busy.value) void load(); });
</script>

<template>
  <Teleport to="body">
    <div class="co-overlay" :class="lmClass" :data-motion="reduced ? 'reduced' : 'full'" data-testid="client-onboarding-overlay">
      <section ref="root" v-pad-focus="padOptions" class="co-panel" :class="{ 'lm-panel': modern }" role="dialog" aria-modal="true"
        aria-labelledby="co-title" aria-describedby="co-intro" tabindex="-1" data-testid="client-onboarding" @keydown="onKeydown">
        <header class="co-head" :class="{ 'hm-band': modern }">
          <h2 id="co-title">{{ reaccept ? t('onboarding.title.reaccept') : t('onboarding.title.welcome') }}</h2>
          <button ref="closeButton" type="button" class="co-btn co-close" :class="{ 'sf-btn small': modern }" data-pad-cancel
            :aria-label="t('onboarding.action.closeLabel')" :title="t('onboarding.action.closeLabel')" :disabled="busy"
            data-testid="client-onboarding-close" @click="close">×</button>
        </header>

        <div class="co-body">
          <p id="co-intro" class="co-intro">{{ reaccept ? t('onboarding.intro.reaccept') : t('onboarding.intro.welcome') }}</p>

          <p v-if="phase === 'loading'" class="co-note" role="status">{{ t('onboarding.loading') }}</p>

          <template v-else-if="phase === 'loadError'">
            <p class="co-error" role="alert" data-testid="client-onboarding-error">{{ error }}</p>
            <div class="co-actions">
              <button type="button" class="co-btn" :class="{ 'sf-btn': modern }" @click="load()">{{ t('onboarding.action.retry') }}</button>
              <button type="button" class="co-btn" :class="{ 'sf-btn': modern }" @click="close">{{ t('onboarding.action.close') }}</button>
            </div>
          </template>

          <template v-else-if="phase === 'wrongCoach'">
            <p class="co-error" role="alert" data-testid="client-onboarding-wrong-coach">{{ t('onboarding.error.wrongCoach', { signedIn: signedInAs, coach: gatedCoach }) }}</p>
            <div class="co-actions">
              <button type="button" class="co-btn co-primary" :class="{ 'sf-btn primary': modern }" data-testid="client-onboarding-open-account" @click="openAccountSettings">{{ t('onboarding.action.openAccount') }}</button>
              <button type="button" class="co-btn" :class="{ 'sf-btn': modern }" @click="close">{{ t('onboarding.action.close') }}</button>
            </div>
          </template>

          <template v-else-if="phase === 'notNeeded'">
            <p class="co-note" role="status" data-testid="client-onboarding-not-needed">{{ t('onboarding.notNeeded') }}</p>
            <div class="co-actions">
              <button type="button" class="co-btn" :class="{ 'sf-btn': modern }" data-testid="client-onboarding-notice" @click="openNotice">{{ t('onboarding.privacy.read') }}</button>
              <button type="button" class="co-btn" :class="{ 'sf-btn': modern }" @click="close">{{ t('onboarding.action.close') }}</button>
            </div>
          </template>

          <form v-else class="co-form" :class="{ 'sf-form': modern }" novalidate :aria-busy="busy ? 'true' : undefined" @submit.prevent="submitStep">
            <p v-if="steps.length > 1" class="co-step" data-testid="client-onboarding-step">{{ t('onboarding.step', { n: stepNumber, total: steps.length }) }}</p>

            <fieldset v-if="step === 'details'" class="co-fieldset" :disabled="busy" data-testid="client-onboarding-details">
              <legend class="co-legend">{{ t('onboarding.details.heading') }}</legend>
              <label class="co-field" :class="{ 'sf-field': modern }">
                <span class="co-label">{{ t('onboarding.details.preferredName') }}</span>
                <input ref="nameInput" v-model="form.preferredName" type="text" autocomplete="nickname" :maxlength="PREFERRED_NAME_MAX" required
                  :aria-invalid="nameError ? 'true' : undefined" aria-describedby="co-name-help" data-testid="client-onboarding-name" />
                <small id="co-name-help" class="co-help" :class="{ 'co-error': nameError }">{{ nameError || t('onboarding.details.preferredNameHelp') }}</small>
              </label>
              <label class="co-field" :class="{ 'sf-field': modern }">
                <span class="co-label">{{ t('onboarding.details.email') }}</span>
                <input v-model="form.email" type="email" autocomplete="email" maxlength="200"
                  :aria-invalid="emailError ? 'true' : undefined" aria-describedby="co-email-help" data-testid="client-onboarding-email" />
                <small id="co-email-help" class="co-help" :class="{ 'co-error': emailError }">{{
                  emailError || (emailFromDiscord ? t('onboarding.details.emailFromDiscord') : t('onboarding.details.emailHelp')) }}</small>
              </label>
              <label class="co-field" :class="{ 'sf-field': modern }">
                <span class="co-label">{{ t('onboarding.details.country') }}</span>
                <select v-model="form.country" required :aria-invalid="countryError ? 'true' : undefined" aria-describedby="co-country-help" data-testid="client-onboarding-country">
                  <option value="" disabled>{{ t('onboarding.details.countryChoose') }}</option>
                  <option v-for="c in countries" :key="c.code" :value="c.code">{{ c.label }}</option>
                </select>
                <small id="co-country-help" class="co-help" :class="{ 'co-error': countryError }">{{ countryError || t('onboarding.details.countryHelp') }}</small>
              </label>
              <label class="co-field" :class="{ 'sf-field': modern }">
                <span class="co-label">{{ t('onboarding.details.phone') }}</span>
                <span class="co-phone">
                  <span v-if="phonePrefix" class="co-prefix" aria-hidden="true">{{ phonePrefix }}</span>
                  <input v-model="form.phone" type="tel" autocomplete="tel-national" maxlength="40" aria-describedby="co-phone-help" data-testid="client-onboarding-phone" />
                </span>
                <small id="co-phone-help" class="co-help">{{ t('onboarding.details.phoneHelp') }}</small>
              </label>
              <label class="co-check" :class="{ 'sf-check': modern }">
                <input v-model="form.leagueContact" type="checkbox" aria-describedby="co-contact-help" data-testid="client-onboarding-league-contact" />
                <span>{{ view?.leagueContactText }} <span class="co-muted">{{ t('onboarding.details.optional') }}</span></span>
              </label>
              <small id="co-contact-help" class="co-help co-check-help">{{ t('onboarding.details.leagueContactHint') }}</small>
            </fieldset>

            <fieldset v-else class="co-fieldset" :disabled="busy" data-testid="client-onboarding-privacy">
              <legend class="co-legend">{{ t('onboarding.privacy.heading') }}</legend>
              <p class="co-summary">{{ t('onboarding.privacy.summary') }}</p>
              <div>
                <button ref="noticeButton" type="button" class="co-btn" :class="{ 'sf-btn': modern }" data-testid="client-onboarding-notice" @click="openNotice">{{ t('onboarding.privacy.read') }}</button>
                <small class="co-help">{{ t('onboarding.privacy.opensInBrowser') }}</small>
              </div>
              <label class="co-check" :class="{ 'sf-check': modern }">
                <input v-model="form.privacyAccepted" type="checkbox" required aria-describedby="co-privacy-help" data-testid="client-onboarding-privacy-accept" />
                <span>{{ t('onboarding.privacy.accept') }}</span>
              </label>
              <small id="co-privacy-help" class="co-help co-check-help">{{ t('onboarding.privacy.required') }}</small>
            </fieldset>

            <p v-if="error" class="co-error" role="alert" data-testid="client-onboarding-error">{{ error }}</p>

            <div class="co-actions">
              <button v-if="step === 'details'" type="submit" class="co-btn co-primary" :class="{ 'sf-btn primary': modern }" :disabled="busy"
                data-testid="client-onboarding-next">{{ t('onboarding.action.next') }}</button>
              <template v-else>
                <button type="submit" class="co-btn co-primary" :class="{ 'sf-btn primary': modern }" :disabled="!canAccept"
                  data-testid="client-onboarding-accept">{{ busy ? t('onboarding.action.saving') : t('onboarding.action.accept') }}</button>
                <button v-if="steps.includes('details')" type="button" class="co-btn" :class="{ 'sf-btn': modern }" :disabled="busy"
                  data-testid="client-onboarding-back" @click="back">{{ t('onboarding.action.back') }}</button>
              </template>
              <button type="button" class="co-btn" :class="{ 'sf-btn': modern }" :disabled="busy" data-testid="client-onboarding-not-now" @click="close">{{ t('onboarding.action.notNow') }}</button>
            </div>
          </form>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.co-overlay { position: fixed; inset: 0; z-index: 215; display: flex; align-items: center; justify-content: center; padding: 3vh 16px; background: #05070cc8; }
.co-overlay[data-motion='full'] .co-panel { animation: co-in 160ms ease-out; }
@keyframes co-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .co-overlay .co-panel { animation: none !important; } }
:global(html.sf-reduce-motion) .co-panel { animation: none !important; }

.co-panel { box-sizing: border-box; display: flex; flex-direction: column; width: min(600px, 100%); max-height: 92vh; overflow: hidden; }
.co-panel:focus { outline: none; }
.co-head { display: flex; align-items: center; gap: 12px; flex: none; }
.co-head h2 { flex: 1 1 auto; min-width: 0; margin: 0; }
.co-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 18px 18px; display: grid; gap: 12px; align-content: start; }
.co-intro, .co-note, .co-summary, .co-step { margin: 0; }
.co-step { font-size: max(var(--ui-min-text-size, 12px), 12px); letter-spacing: .06em; text-transform: uppercase; opacity: .8; }
.co-form, .co-fieldset { display: grid; gap: 12px; }
.co-fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
.co-legend { padding: 0; margin-bottom: 4px; font-weight: 700; }
.co-field { display: grid; gap: 4px; min-width: 0; }
.co-label { font-weight: 600; }
.co-field input, .co-field select { box-sizing: border-box; width: 100%; min-height: 34px; padding: 6px 8px; font: inherit; }
.co-phone { display: flex; align-items: center; gap: 6px; }
.co-phone input { flex: 1 1 auto; min-width: 0; }
.co-prefix { flex: none; font-variant-numeric: tabular-nums; opacity: .85; }
.co-help { font-size: max(var(--ui-min-text-size, 12px), 12px); opacity: .85; }
.co-check { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
.co-check input { flex: none; width: 18px; height: 18px; margin: 2px 0 0; }
.co-check-help { margin-top: -8px; padding-left: 26px; }
.co-muted { opacity: .7; font-size: max(var(--ui-min-text-size, 12px), 12px); }
.co-error { margin: 0; color: var(--ui-danger, #c62828); }
.co-help.co-error { opacity: 1; }
.co-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.co-btn { cursor: pointer; font: inherit; }
.co-btn:disabled { opacity: .55; cursor: default; }
.co-btn:focus-visible, .co-field :is(input, select):focus-visible, .co-check input:focus-visible { outline: 2px solid var(--ui-focus, #ff3b3b); outline-offset: 2px; }
.co-close { flex: none; padding: 2px 10px; font-size: max(var(--ui-min-primary-text-size, 16px), 20px); line-height: 1; }

/* Retro (the Play blade's parchment card): the overlay without .sf-lm */
.co-overlay:not(.sf-lm) .co-panel {
  border: 1px solid var(--ui-forest, #1A401C); border-radius: 8px; color: var(--ui-forest, #1A401C); background: var(--ui-old-lace, #F8F5E7);
  box-shadow: 0 18px 60px #000a;
}
.co-overlay:not(.sf-lm) .co-head { padding: 12px 18px; border-bottom: 1px solid color-mix(in srgb, var(--ui-forest, #1A401C) 30%, transparent); }
.co-overlay:not(.sf-lm) .co-head h2 { font-family: var(--font-display); font-size: max(var(--ui-min-primary-text-size, 16px), 24px); }
.co-overlay:not(.sf-lm) .co-btn {
  padding: 6px 14px; border: 1px solid var(--ui-forest, #1A401C); border-radius: 4px; color: var(--ui-forest, #1A401C); background: transparent;
}
.co-overlay:not(.sf-lm) .co-btn.co-primary { color: var(--ui-old-lace, #F8F5E7); background: var(--ui-forest, #1A401C); }
.co-overlay:not(.sf-lm) .co-close { border: 0; padding: 2px 8px; }
.co-overlay:not(.sf-lm) .co-field :is(input, select) {
  border: 1px solid color-mix(in srgb, var(--ui-forest, #1A401C) 55%, transparent); border-radius: 4px; color: var(--ui-forest, #1A401C); background: #fff;
}
.co-overlay:not(.sf-lm) .co-check input { accent-color: var(--ui-forest, #1A401C); }

/* Modern (League Manager): the panel, band, sf-btn and sf-field come from styles/lm-theme.css */
.co-overlay.sf-lm .co-head { margin: 0; }
.co-overlay.sf-lm .co-close { min-height: 0; }
</style>
