<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { settings } from '../game/settings';
import { authenticateAccount, getAccount, rehydrateAccountSession, signInWithDiscordAccount, signOutAccount, updateAccount, type AccountIdentity } from '../game/accountApi';
import { DesktopSignInCancelled } from '../game/desktopAuth';
import { startTournamentNotificationPolling } from '../game/tournamentNotificationClient';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const account = ref<AccountIdentity | null>(null);
const busy = ref(false);
const status = ref('Authenticate to view your verified identities and account profile.');
const loginPassword = ref('');
const displayName = ref('');
const avatar = ref('');
const timezone = ref('');
const availability = ref<Record<string, { start: string; end: string }>>(Object.fromEntries(DAYS.map(day => [day, { start: '', end: '' }])));
const extraProfile = ref<Array<{ key: string; value: string }>>([]);
let discordAbort: AbortController | null = null;

function loadEditor(identity: AccountIdentity) {
  displayName.value = identity.profile.displayName ?? '';
  avatar.value = identity.profile.avatar ?? '';
  timezone.value = identity.scheduling?.timezone ?? '';
  availability.value = Object.fromEntries(DAYS.map(day => {
    const row = identity.scheduling?.availability?.find(item => item.day === day);
    return [day, { start: row?.start ?? '', end: row?.end ?? '' }];
  }));
  extraProfile.value = Object.entries(identity.profile)
    .filter(([key, value]) => key !== 'displayName' && key !== 'avatar' && typeof value === 'string')
    .map(([key, value]) => ({ key, value: value! }));
}

async function authenticate() {
  const coach = settings.coach40k.trim();
  if (!coach || !loginPassword.value) { status.value = 'Enter your Super FUMBBL coach and password.'; return; }
  busy.value = true;
  try {
    account.value = await authenticateAccount(coach, loginPassword.value);
    loadEditor(account.value);
    loginPassword.value = '';
    status.value = 'Authenticated. Saving changes requires your password again.';
    startTournamentNotificationPolling();
  } catch (error) { status.value = error instanceof Error ? error.message : String(error); }
  finally { busy.value = false; }
}

async function refresh() {
  busy.value = true;
  try { account.value = await getAccount(); loadEditor(account.value); status.value = 'Identity status refreshed.'; }
  catch (error) { status.value = error instanceof Error ? error.message : String(error); }
  finally { busy.value = false; }
}

async function openDiscordSso() {
  if (busy.value) return;
  const coach = settings.coach40k.trim();
  if (!coach) { status.value = 'Enter your Super FUMBBL coach before signing in with Discord.'; return; }
  const controller = new AbortController();
  discordAbort = controller;
  busy.value = true;
  try {
    status.value = `Waiting for Discord authorization for ${coach}…`;
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
    status.value = `Signed in as ${account.value.ffbCoachId}.`;
    startTournamentNotificationPolling();
  } catch (error) {
    status.value = error instanceof DesktopSignInCancelled ? 'Discord sign-in cancelled.' : error instanceof Error ? error.message : String(error);
  } finally {
    if (discordAbort === controller) discordAbort = null;
    busy.value = false;
  }
}

function cancelDiscordSso() { discordAbort?.abort(); }

async function signOut() {
  busy.value = true;
  try { await signOutAccount(); account.value = null; status.value = 'Signed out.'; }
  catch (error) { status.value = error instanceof Error ? error.message : String(error); }
  finally { busy.value = false; }
}

async function saveProfile() {
  if (!account.value) return;
  busy.value = true;
  try {
    const profile: Record<string, string> = { displayName: displayName.value, avatar: avatar.value };
    for (const row of extraProfile.value) if (row.key.trim()) profile[row.key.trim()] = row.value;
    const rows = DAYS.flatMap(day => {
      const row = availability.value[day]!;
      return row.start && row.end ? [{ day, start: row.start, end: row.end }] : [];
    });
    account.value = await updateAccount({ profile, scheduling: { timezone: timezone.value, availability: rows } });
    loadEditor(account.value);
    status.value = 'Account profile saved.';
  } catch (error) { status.value = error instanceof Error ? error.message : String(error); }
  finally { busy.value = false; }
}

onMounted(async () => {
  try {
    const restored = await rehydrateAccountSession();
    if (restored) { account.value = restored; loadEditor(restored); status.value = 'Authenticated session restored.'; }
    else if (settings.coach40k.trim()) status.value = `Authenticate as ${settings.coach40k.trim()} to load your account.`;
  } catch { status.value = 'Your session expired. Authenticate again.'; }
});
onBeforeUnmount(() => discordAbort?.abort());
</script>

<template>
  <fieldset class="settings-group account-card">
    <legend>Account</legend>
    <template v-if="!account">
      <label>Super FUMBBL coach <input v-model="settings.coach40k" autocomplete="username" /></label>
      <button type="button" :disabled="busy" @click="openDiscordSso">{{ busy ? 'Waiting for Discord…' : 'Sign in with Discord' }}</button>
      <button v-if="busy" type="button" @click="cancelDiscordSso">Cancel sign-in</button>
      <p class="hint">Discord opens in your system browser and returns a one-time session to this client.</p>
      <label>Password <input v-model="loginPassword" type="password" autocomplete="current-password" @keyup.enter="authenticate" /></label>
      <button type="button" :disabled="busy" @click="authenticate">Log in using userid/password</button>
    </template>
    <template v-else>
      <div class="identity-grid">
        <span>Verified coach</span><b>✓ {{ account.ffbCoachId }}</b>
        <span>Discord</span><b v-if="account.identities.discordUserId">✓ {{ account.identities.discordUsername || account.identities.discordUserId }}</b><em v-else>Not linked</em>
        <span>Email</span><b>{{ account.identities.email || '—' }}</b>
        <span>NAF</span><b>{{ account.identities.nafName || '—' }}{{ account.identities.nafId ? ` · ${account.identities.nafId}` : '' }}</b>
      </div>
      <div class="actions account-actions">
        <button type="button" :disabled="busy" @click="openDiscordSso">{{ account.identities.discordUserId ? 'Re-authenticate Discord' : 'Link Discord in browser' }}</button>
        <button type="button" :disabled="busy" @click="refresh">Refresh identity</button>
        <button type="button" :disabled="busy" @click="signOut">Sign out</button>
      </div>
      <p class="hint">Coach and external identities are verified and read-only here. Discord sign-in uses the system browser, asks for one coach name, and keeps Discord credentials and tokens out of client settings.</p>

      <fieldset class="settings-group">
        <legend>Public profile</legend>
        <label>Display name <input v-model="displayName" maxlength="500" /></label>
        <label>Avatar URL <input v-model="avatar" maxlength="500" /></label>
        <div v-for="(row, index) in extraProfile" :key="index" class="profile-row">
          <input v-model="row.key" placeholder="Field name" maxlength="100" />
          <input v-model="row.value" placeholder="Value" maxlength="500" />
          <button type="button" title="Remove field" @click="extraProfile.splice(index, 1)">✕</button>
        </div>
        <button type="button" @click="extraProfile.push({ key: '', value: '' })">Add profile field</button>
      </fieldset>

      <fieldset class="settings-group">
        <legend>Scheduling</legend>
        <label>Time zone <input v-model="timezone" placeholder="America/Los_Angeles" maxlength="64" /></label>
        <div v-for="day in DAYS" :key="day" class="availability-row">
          <b>{{ day.toUpperCase() }}</b><input v-model="availability[day]!.start" type="time" /><span>to</span><input v-model="availability[day]!.end" type="time" />
        </div>
      </fieldset>

      <button class="primary" type="button" :disabled="busy" @click="saveProfile">Save account profile</button>
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
.profile-row, .availability-row { display: grid; grid-template-columns: 1fr 2fr auto; gap: .5rem; align-items: center; margin: .4rem 0; }
.availability-row { grid-template-columns: 52px 1fr auto 1fr; }
</style>
