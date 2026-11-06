<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { settings } from '../game/settings';
import {
  authenticateAccount, getAccount, getOnboarding, privacyNoticeUrl, rehydrateAccountSession, signInWithDiscordAccount, signOutAccount,
  updateAccount, type AccountIdentity,
} from '../game/accountApi';
import { requestClientOnboarding } from '../game/clientOnboardingPrompt';
import { openExternal } from '../game/openExternal';
import { DesktopSignInCancelled } from '../game/desktopAuth';
import { startTournamentNotificationPolling } from '../game/tournamentNotificationClient';
import { FORK_EDITION } from '../game/edition';
import { $t, useLiveSet } from '../i18n';
/** i18n live-switch registrations owned by this component (released on unmount; src/i18n LIVE-SWITCH POLICY). */
const liveSetHere = useLiveSet();
import { t } from '../i18n';

const account = ref<AccountIdentity | null>(null);
const busy = ref(false);
const status = ref('Authenticate to view your verified identities and account profile.');
const loginPassword = ref('');
const displayName = ref('');
const avatar = ref('');
const extraProfile = ref<Array<{ key: string; value: string }>>([]);
let discordAbort: AbortController | null = null;

function loadEditor(identity: AccountIdentity) {
  displayName.value = identity.profile.displayName ?? '';
  avatar.value = identity.profile.avatar ?? '';
  extraProfile.value = Object.entries(identity.profile)
    .filter(([key, value]) => key !== 'displayName' && key !== 'avatar' && typeof value === 'string')
    .map(([key, value]) => ({ key, value: value! }));
}

async function authenticate() {
  const coach = settings.coach40k.trim();
  if (!coach || !loginPassword.value) { liveSetHere(status, 'value', () => t('ui.accountSettings.text.enterYourSuperFumbbl')); return; }
  busy.value = true;
  try {
    account.value = await authenticateAccount(coach, loginPassword.value);
    loadEditor(account.value);
    loginPassword.value = '';
    liveSetHere(status, 'value', () => t('ui.accountSettings.text.authenticatedSavingChangesRequires'));
    if (FORK_EDITION) startTournamentNotificationPolling(); // fork edition only (compile-time; the poller also refuses)
    void checkOnboarding();
  } catch (error) { status.value = error instanceof Error ? error.message : String(error); }
  finally { busy.value = false; }
}

async function refresh() {
  busy.value = true;
  try { account.value = await getAccount(); loadEditor(account.value); liveSetHere(status, 'value', () => t('ui.accountSettings.text.identityStatusRefreshed')); }
  catch (error) { status.value = error instanceof Error ? error.message : String(error); }
  finally { busy.value = false; }
}

async function openDiscordSso() {
  if (busy.value) return;
  const coach = settings.coach40k.trim();
  if (!coach) { liveSetHere(status, 'value', () => t('ui.accountSettings.text.enterYourSuperFumbbl2')); return; }
  const controller = new AbortController();
  discordAbort = controller;
  busy.value = true;
  try {
    liveSetHere(status, 'value', () => t('ui.accountSettings.text.waitingForDiscordAuthorization', { coach }));
    account.value = await signInWithDiscordAccount({
      coach,
      signal: controller.signal,
      openAuthorization: async (url) => {
        if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) {
          const { openUrl } = await import('@tauri-apps/plugin-opener');
          await openUrl(url);
        } else window.open(url, '_blank', 'noopener');
      },
    });
    settings.coach40k = account.value.ffbCoachId;
    loadEditor(account.value);
    const ffbCoachId = account.value.ffbCoachId;
    liveSetHere(status, 'value', () => t('ui.accountSettings.text.signedInAsFfbcoachid', { ffbCoachId }));
    if (FORK_EDITION) startTournamentNotificationPolling(); // fork edition only (compile-time; the poller also refuses)
    void checkOnboarding();
  } catch (error) {
    status.value = error instanceof DesktopSignInCancelled ? t('ui.accountSettings.text.discordSignInCancelled') : error instanceof Error ? error.message : String(error);
  } finally {
    if (discordAbort === controller) discordAbort = null;
    busy.value = false;
  }
}

function cancelDiscordSso() { discordAbort?.abort(); }

/** Owner 11-06: after a sign-in or a restored session, config-web's welcome step opens in the client when the coach
 *  has not accepted the current privacy notice (ClientOnboardingDialog.vue). A failed read stays silent: config-web's
 *  gate still answers the next write, and that opens the step too. */
async function checkOnboarding() {
  try {
    const view = await getOnboarding();
    if (view.needed) requestClientOnboarding({ reason: 'signIn', coach: account.value?.ffbCoachId, onComplete: () => liveSetHere(status, 'value', () => t('onboarding.done.settings')) });
  } catch { /* silent: see above */ }
}

/** "Review privacy notice": the welcome step (re-acceptance) only while one is needed, else the notice page itself in
 *  the system browser. */
async function reviewPrivacy() {
  if (busy.value) return;
  busy.value = true;
  try {
    const view = await getOnboarding();
    if (view.needed) { requestClientOnboarding({ reason: 'review', coach: account.value?.ffbCoachId, onComplete: () => liveSetHere(status, 'value', () => t('onboarding.done.settings')) }); return; }
    await openExternal(privacyNoticeUrl());
  } catch (error) {
    status.value = error instanceof Error ? error.message : String(error);
    try { await openExternal(privacyNoticeUrl()); } catch { /* no config-web: the status line says why */ }
  } finally { busy.value = false; }
}

async function signOut() {
  busy.value = true;
  try { await signOutAccount(); account.value = null; liveSetHere(status, 'value', () => t('ui.accountSettings.text.signedOut')); }
  catch (error) { status.value = error instanceof Error ? error.message : String(error); }
  finally { busy.value = false; }
}

async function saveProfile() {
  if (!account.value) return;
  busy.value = true;
  try {
    const profile: Record<string, string> = { displayName: displayName.value, avatar: avatar.value };
    for (const row of extraProfile.value) if (row.key.trim()) profile[row.key.trim()] = row.value;
    // Owner 11-03 settings reflow: Calendar / Scheduling is gone from the client; the patch carries no schedule, so
    // whatever the account already has stays untouched (League Manager owns it).
    account.value = await updateAccount({ profile });
    loadEditor(account.value);
    liveSetHere(status, 'value', () => t('ui.accountSettings.text.accountProfileSaved'));
  } catch (error) { status.value = error instanceof Error ? error.message : String(error); }
  finally { busy.value = false; }
}

onMounted(async () => {
  try {
    const restored = await rehydrateAccountSession();
    if (restored) {
      account.value = restored; loadEditor(restored); liveSetHere(status, 'value', () => t('ui.accountSettings.text.authenticatedSessionRestored'));
      void checkOnboarding();
    }
    else if (settings.coach40k.trim()) liveSetHere(status, 'value', () => t('ui.accountSettings.text.authenticateAsP0To', { p0: settings.coach40k.trim() }));
  } catch { liveSetHere(status, 'value', () => t('ui.accountSettings.text.yourSessionExpiredAuthenticate')); }
});
onBeforeUnmount(() => discordAbort?.abort());
</script>

<template>
  <fieldset class="settings-group account-card">
    <legend>{{ $t('settings.account.superFumbblAccount') }}</legend>
    <template v-if="!account">
      <label>{{ $t('settings.account.accountCard.account.superFumbblCoach') }} <input v-model="settings.coach40k" autocomplete="username" /></label>
      <button type="button" :disabled="busy" @click="openDiscordSso">{{ busy ? $t('settings.account.accountCard.account.waitingForDiscord') : $t('settings.account.accountCard.account.signInWithDiscord') }}</button>
      <button v-if="busy" type="button" @click="cancelDiscordSso">{{ $t('settings.account.accountCard.account.cancelSignIn') }}</button>
      <p class="hint">{{ $t('settings.account.accountCard.account.discordOpensInYour') }}</p>
      <label>{{ $t('settings.account.accountCard.account.password') }} <input v-model="loginPassword" type="password" autocomplete="current-password" @keyup.enter="authenticate" /></label>
      <button type="button" :disabled="busy" @click="authenticate">{{ $t('settings.account.accountCard.account.logInUsingUserid') }}</button>
    </template>
    <template v-else>
      <div class="identity-grid">
        <span>{{ $t('settings.account.accountCard.account.verifiedCoach') }}</span><b>✓ {{ account.ffbCoachId }}</b>
        <span>{{ $t('settings.account.accountCard.account.discord') }}</span><b v-if="account.identities.discordUserId">✓ {{ account.identities.discordUsername || account.identities.discordUserId }}</b><em v-else>{{ $t('settings.account.accountCard.account.notLinked') }}</em>
        <span>{{ $t('settings.account.accountCard.account.email') }}</span><b>{{ account.identities.email || '—' }}</b>
        <span>{{ $t('settings.account.accountCard.account.naf') }}</span><b>{{ account.identities.nafName || '—' }}{{ account.identities.nafId ? ` · ${account.identities.nafId}` : '' }}</b>
      </div>
      <div class="actions account-actions">
        <button type="button" :disabled="busy" @click="openDiscordSso">{{ account.identities.discordUserId ? $t('settings.account.accountCard.account.reAuthenticateDiscord') : $t('settings.account.accountCard.account.linkDiscordInBrowser') }}</button>
        <button type="button" :disabled="busy" @click="refresh">{{ $t('settings.account.accountCard.account.refreshIdentity') }}</button>
        <button type="button" :disabled="busy" @click="signOut">{{ $t('settings.account.accountCard.account.signOut') }}</button>
        <button type="button" :disabled="busy" data-testid="account-review-privacy" @click="reviewPrivacy">{{ $t('onboarding.settings.reviewPrivacy') }}</button>
      </div>
      <p class="hint">{{ $t('settings.account.accountCard.account.coachAndExternalIdentities') }}</p>

      <fieldset class="settings-group">
        <legend>{{ $t('settings.account.accountCard.publicProfile.publicProfile') }}</legend>
        <label>{{ $t('settings.account.accountCard.publicProfile.displayName') }} <input v-model="displayName" maxlength="500" /></label>
        <label>{{ $t('settings.account.accountCard.publicProfile.avatarUrl') }} <input v-model="avatar" maxlength="500" /></label>
        <div v-for="(row, index) in extraProfile" :key="index" class="profile-row">
          <input v-model="row.key" :placeholder="$t('settings.account.accountCard.publicProfile.fieldName')" maxlength="100" />
          <input v-model="row.value" :placeholder="$t('settings.account.accountCard.publicProfile.value')" maxlength="500" />
          <button type="button" :title="$t('settings.account.accountCard.publicProfile.removeField')" @click="extraProfile.splice(index, 1)">✕</button>
        </div>
        <button type="button" @click="extraProfile.push({ key: '', value: '' })">{{ $t('settings.account.accountCard.publicProfile.addProfileField') }}</button>
      </fieldset>

      <button class="primary" type="button" :disabled="busy" @click="saveProfile">{{ $t('settings.account.accountCard.account.saveAccountProfile') }}</button>
    </template>
    <p class="hint" aria-live="polite">{{ status }}</p>
  </fieldset>
</template>

<style scoped>
.account-card { max-width: 760px; }
.identity-grid { display: grid; grid-template-columns: 150px 1fr; gap: .45rem 1rem; margin-bottom: 1rem; }
.identity-grid b:first-of-type { color: var(--ui-success); }
.identity-grid em { color: var(--ui-text-muted); }
.account-actions { justify-content: flex-start; flex-wrap: wrap; }
.profile-row { display: grid; grid-template-columns: 1fr 2fr auto; gap: .5rem; align-items: center; margin: .4rem 0; }
</style>
