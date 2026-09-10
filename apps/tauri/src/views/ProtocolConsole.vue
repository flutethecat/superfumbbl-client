<script setup lang="ts">
import { reactive, ref } from 'vue';
import { GameSession, type SessionState } from '@fumbbl40k/ffb-protocol';

const form = reactive({
  url: 'ws://localhost:22223/command',
  coach: '',
  password: '',
  gameId: 0,
});

const state = ref<SessionState>('idle');
const log = ref<string[]>([]);
let session: GameSession | null = null;

function append(line: string) {
  log.value.push(`${new Date().toLocaleTimeString()}  ${line}`);
  if (log.value.length > 500) log.value.shift();
}

async function connect() {
  disconnect();
  session = new GameSession({ url: form.url });
  session.on('state', (s) => {
    state.value = s;
    append(`state → ${s}`);
  });
  session.on('version', (cmd) => append(`server ${cmd.serverVersion}, expects client ${cmd.clientVersion}`));
  session.on('command', (cmd) => append(`⇐ ${cmd.netCommandId}${cmd.commandNr != null ? ` #${cmd.commandNr}` : ''}`));
  session.on('talk', (cmd) => append(`💬 ${cmd.coach ?? '?'}: ${(cmd.talks ?? []).join(' ')}`));
  session.on('error', (error) => append(`⚠ ${String(error)}`));
  try {
    await session.join({
      coach: form.coach,
      password: form.password,
      gameId: Number(form.gameId),
      mode: 'spectator',
    });
  } catch (error) {
    append(`⚠ ${String(error)}`);
  }
}

function disconnect() {
  session?.close();
  session = null;
}
</script>

<template>
  <section class="console">
    <form class="connect-form" @submit.prevent="connect">
      <input v-model="form.url" placeholder="ws://host:port/command" size="34" />
      <input v-model="form.coach" placeholder="Coach" />
      <input v-model="form.password" type="password" placeholder="Password" />
      <input v-model.number="form.gameId" type="number" placeholder="Game id" />
      <button type="submit">Spectate</button>
      <button type="button" :disabled="state === 'idle' || state === 'closed'" @click="disconnect">
        Disconnect
      </button>
      <span class="state" :data-state="state">{{ state }}</span>
    </form>
    <pre class="log"><span v-for="(line, i) in log" :key="i">{{ line }}
</span></pre>
  </section>
</template>

<style scoped>
.console {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.connect-form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid #2e3440;
}
.connect-form input {
  background: #1d2129;
  color: inherit;
  border: 1px solid #2e3440;
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
}
.connect-form button {
  background: #3a5f3f;
  color: inherit;
  border: none;
  border-radius: 4px;
  padding: 0.45rem 0.9rem;
  cursor: pointer;
}
.connect-form button:disabled {
  opacity: 0.4;
  cursor: default;
}
.state {
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem);
  color: #8a8f98;
}
.state[data-state='joined'] {
  color: #7dc383;
}
.log {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 0.75rem 1.25rem;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem);
  line-height: 1.5;
}
</style>
