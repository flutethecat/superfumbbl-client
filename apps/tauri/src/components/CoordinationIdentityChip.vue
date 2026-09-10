<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { coachPassword } from '../game/credentials';
import {
  clearConfigWebToken,
  configWebCoordinationIdentity,
  ensureConfigWebToken,
  type ConfigWebCoordinationIdentity,
} from '../game/configWebAuth';
import { pairConfigWebSession } from '../game/configWebSso';
import { botConfigBaseUrl, settings } from '../game/settings';

type PublicIdentity = Omit<ConfigWebCoordinationIdentity, 'token'>;
const identity = ref<PublicIdentity | null>(configWebCoordinationIdentity());
const busy = ref(false);
const status = ref('');
let pairingAbort: AbortController | null = null;

function transport(input: string, init?: RequestInit): Promise<Response> {
  return ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
    ? tauriFetch(input, init) as Promise<Response>
    : fetch(input, init);
}

async function openSystemBrowser(url: string): Promise<void> {
  if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else window.open(url, '_blank', 'noopener');
}

async function signInDiscord(): Promise<void> {
  pairingAbort?.abort();
  pairingAbort = new AbortController();
  busy.value = true;
  status.value = 'Complete Discord sign-in in your browser…';
  const result = await pairConfigWebSession({
    baseUrl: botConfigBaseUrl(),
    transport,
    openSystemBrowser,
    signal: pairingAbort.signal,
  });
  busy.value = false;
  if (result.kind === 'ok') {
    identity.value = configWebCoordinationIdentity();
    status.value = `Signed in as ${result.identity.displayName}.`;
  } else if (result.kind === 'cancelled') status.value = '';
  else if (result.kind === 'expired') status.value = 'Discord sign-in expired. Try again.';
  else status.value = `Coordination sign-in is unavailable (${result.detail}). Game joining is unaffected.`;
}

async function signInWithCredentials(): Promise<void> {
  const coach = settings.coach40k.trim();
  const password = coachPassword();
  if (!coach || !password) {
    status.value = 'Set your Super FUMBBL userid/password in Settings → Connection.';
    return;
  }
  busy.value = true;
  try {
    const token = await ensureConfigWebToken({ coach, password }, transport, botConfigBaseUrl());
    identity.value = configWebCoordinationIdentity();
    status.value = token ? `Signed in as ${coach}.` : 'Userid/password sign-in failed. Game joining is unaffected.';
  } catch (error) {
    status.value = `Coordination sign-in is unavailable (${(error as Error)?.message ?? String(error)}). Game joining is unaffected.`;
  } finally { busy.value = false; }
}

function signOut(): void {
  pairingAbort?.abort();
  clearConfigWebToken();
  identity.value = null;
  busy.value = false;
  status.value = 'Signed out of coordination features.';
}

onBeforeUnmount(() => pairingAbort?.abort());
</script>

<template>
  <aside class="coordination" aria-label="Coordination identity">
    <div v-if="identity" class="identity-chip">
      <img v-if="identity.avatarUrl" :src="identity.avatarUrl" alt="" referrerpolicy="no-referrer" />
      <span class="identity-avatar" v-else aria-hidden="true">{{ identity.displayName.slice(0, 1).toUpperCase() }}</span>
      <span><small>Coordination</small><b>{{ identity.displayName }}</b></span>
      <button type="button" :disabled="busy" @click="signOut">Sign out</button>
    </div>
    <div v-else class="identity-actions">
      <button class="discord-button" type="button" :disabled="busy" @click="signInDiscord">
        {{ busy ? 'Waiting…' : 'Sign in with Discord' }}
      </button>
      <button class="credential-button" type="button" :disabled="busy" @click="signInWithCredentials">log in using userid/password</button>
    </div>
    <p v-if="status" class="coordination-status" role="status">{{ status }}</p>
  </aside>
</template>

<style scoped>
.coordination { display: grid; gap: 6px; margin: 0 0 12px; padding: 8px 10px; border: 1px solid rgba(114, 155, 194, .45); border-radius: 6px; background: rgba(8, 15, 22, .78); font-family: Arial, sans-serif; font-size: max(var(--ui-min-text-size, 12px), 12px); }
.identity-chip, .identity-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.identity-chip img, .identity-avatar { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; display: grid; place-items: center; background: #5865f2; color: white; font-weight: 900; }
.identity-chip span:nth-child(2) { display: grid; margin-right: auto; }
.identity-chip small { color: #9eb2c6; }
.identity-chip button, .identity-actions button { min-height: 30px; border: 1px solid #6d7f91; border-radius: 4px; padding: 5px 10px; color: white; background: #263545; cursor: pointer; }
.identity-actions .discord-button { background: #5865f2; border-color: #7c86f7; font-weight: 800; }
.identity-actions .credential-button { color: #d5e5f3; background: transparent; }
button:disabled { opacity: .55; cursor: wait; }
.coordination-status { margin: 0; color: #b9c9d8; line-height: 1.35; }
</style>
