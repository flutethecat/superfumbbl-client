<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { botConfigBaseUrl, resolveJoinCreds, settings } from '../../game/settings';

interface CoachRecord {
  coach: string;
  packageName?: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  tdFor: number;
  tdAgainst: number;
  tdDiff: number;
  casFor: number;
  casAgainst: number;
  casDiff: number;
  winnings: number;
}

const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
const records = ref<CoachRecord[]>([]);
const loading = ref(false);
const error = ref('');

const showPackage = computed(() => records.value.some((row) => !!row.packageName));
const signedInCoach = computed(() => {
  const configuredCoach = settings.activeServerTarget === 'fork'
    ? settings.coach40k.trim()
    : settings.coach.trim();
  return configuredCoach ? resolveJoinCreds().coach.trim().toLocaleLowerCase() : '';
});

function errText(fetchError: unknown): string {
  if (fetchError instanceof Error && fetchError.message) return fetchError.message;
  if (typeof fetchError === 'string' && fetchError) return fetchError;
  return String(fetchError);
}

function isSignedInCoach(coach: string): boolean {
  return !!signedInCoach.value && coach.trim().toLocaleLowerCase() === signedInCoach.value;
}

function formatGold(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value / 1000).toLocaleString()}k`;
}

async function loadRecords(): Promise<void> {
  loading.value = true;
  error.value = '';
  const url = `${botConfigBaseUrl()}/api/fork/records`;
  try {
    let response: Response;
    try {
      response = inTauri ? await tauriFetch(url) : await fetch(url);
    } catch (fetchError) {
      throw new Error(`config-web unreachable at ${botConfigBaseUrl()} — ${errText(fetchError)}`);
    }
    const data = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!Array.isArray(data)) throw new Error('Invalid records response.');
    records.value = data as CoachRecord[];
  } catch (loadError) {
    error.value = errText(loadError);
  } finally {
    loading.value = false;
  }
}

onMounted(() => { void loadRecords(); });
</script>

<template>
  <main class="statistics-view" aria-labelledby="statistics-title">
    <header class="statistics-header">
      <div>
        <h1 id="statistics-title"><span>S</span>tatistics</h1>
        <p>Finished match records from the Super FUMBBL fork.</p>
      </div>
      <button type="button" :disabled="loading" @click="loadRecords">
        {{ loading ? 'Loading…' : 'Refresh' }}
      </button>
    </header>

    <section class="standings-panel" aria-live="polite">
      <p v-if="loading && records.length === 0" class="state-message">Loading statistics…</p>
      <div v-else-if="error" class="state-message error-message" role="alert">
        <p>{{ error }}</p>
        <button type="button" @click="loadRecords">Refresh</button>
      </div>
      <p v-else-if="records.length === 0" class="state-message">No finished games recorded on the fork yet.</p>
      <div v-else class="table-scroll">
        <table>
          <thead>
            <tr>
              <th class="text-column" scope="col">Coach</th>
              <th v-if="showPackage" class="text-column" scope="col">Package</th>
              <th scope="col">P</th>
              <th scope="col">W</th>
              <th scope="col">D</th>
              <th scope="col">L</th>
              <th scope="col">TD for</th>
              <th scope="col">TD against</th>
              <th scope="col">TD diff</th>
              <th scope="col">Cas for</th>
              <th scope="col">Cas against</th>
              <th scope="col">Cas diff</th>
              <th scope="col">Winnings</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in records" :key="index" :class="{ 'signed-in-coach': isSignedInCoach(row.coach) }">
              <th class="text-column" scope="row">{{ row.coach }}</th>
              <td v-if="showPackage" class="text-column">{{ row.packageName || '—' }}</td>
              <td>{{ row.played }}</td>
              <td>{{ row.won }}</td>
              <td>{{ row.drawn }}</td>
              <td>{{ row.lost }}</td>
              <td>{{ row.tdFor }}</td>
              <td>{{ row.tdAgainst }}</td>
              <td>{{ row.tdDiff }}</td>
              <td>{{ row.casFor }}</td>
              <td>{{ row.casAgainst }}</td>
              <td>{{ row.casDiff }}</td>
              <td>{{ formatGold(row.winnings) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</template>

<style scoped>
.statistics-view {
  box-sizing: border-box;
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
  padding: 18px 20px;
  color: var(--ui-text);
  background: var(--ui-surface);
}

.statistics-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 14px;
}

h1 {
  margin: 0;
  color: var(--ui-heading);
  font-size: max(var(--ui-min-primary-text-size, 16px), 15px);
  font-weight: 500;
  letter-spacing: .18em;
}

h1 span { font-size: max(var(--ui-min-primary-text-size, 16px), 1.2em); }
.statistics-header p { margin: 5px 0 0; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 12px); }

button {
  min-width: 92px;
  padding: 8px 14px;
  border: 2px outset var(--ui-primary);
  border-radius: 4px;
  color: var(--ui-text-on-primary);
  background: var(--ui-primary);
  font: inherit;
  cursor: pointer;
}

button:hover:not(:disabled) { background: var(--ui-hover); }
button:disabled { cursor: wait; opacity: .6; }

.standings-panel {
  min-height: 190px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface-2);
  box-shadow: 0 4px 14px rgba(0, 0, 0, .55);
}

.state-message {
  box-sizing: border-box;
  min-height: 190px;
  margin: 0;
  padding: 40px 24px;
  color: var(--ui-muted);
  text-align: center;
}

.error-message p { margin: 0 0 14px; color: var(--ui-text); }
.table-scroll { overflow-x: auto; }

table {
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

th,
td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--ui-border);
  text-align: right;
}

thead th {
  color: var(--ui-heading);
  background: var(--ui-surface);
  font-size: max(var(--ui-min-text-size, 12px), 11px);
  letter-spacing: .06em;
  text-transform: uppercase;
}

.text-column { text-align: left; }
tbody th { color: var(--ui-text); font-weight: 600; }
tbody td { color: var(--ui-text); }
tbody tr:last-child th,
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover { background: var(--ui-surface); }

.signed-in-coach {
  background: color-mix(in srgb, var(--ui-gold) 18%, transparent);
  box-shadow: inset 3px 0 0 var(--ui-gold);
}

.signed-in-coach th { color: var(--ui-heading); }

@media (max-width: 640px) {
  .statistics-view { padding: 12px; }
  .statistics-header { align-items: flex-start; }
  th,
  td { padding: 9px 10px; }
}
</style>
