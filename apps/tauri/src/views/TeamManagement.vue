<script setup lang="ts">
// Owner 2026-07-14 (Super FUMBBL Phase 3): Team Management — Create Team (native Roster Builder porting the
// config-web team-builder), Import Team (bring a team in from FUMBBL by id/URL with a website preview, then
// bind it to the coach), and the coach's team list. All backends already live on the Tournament Bot's
// config-web (`/api/fork/*`) — this view just drives them. Black & Red gold-standard theming.
import { ref, reactive, computed, onMounted } from 'vue';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { settings, botConfigBaseUrl, configWebUnreachableMessage, FUMBBL_SITE } from '../game/settings';
import { coachPassword } from '../game/credentials';
import { authorizeForkRequest, shouldRetryAfterUnauthorized } from '../game/configWebAuth';
import { $t, data, terms, useLiveSet } from '../i18n';
/** i18n live-switch registrations owned by this component (released on unmount; src/i18n LIVE-SWITCH POLICY). */
const liveSetHere = useLiveSet();

const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
const coach = computed(() => settings.coach40k.trim());

function errText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return String(e);
}
// Owner ruling 08-17: config-web calls authenticate with a session token, not a password parameter.
// One of THREE surviving copies of this helper pair (the others live in forkChallenge.ts and
// TeamBuilderView.vue) — each attaches auth through the same shared configWebAuth seam; consolidating
// the three into one helper is a follow-up, deliberately not folded into a security fix.
const transport: (input: string, init?: RequestInit) => Promise<Response> =
  (input, init) => (inTauri ? tauriFetch(input, init) : fetch(input, init));
function forkCreds(): { coach: string; password: string } {
  return { coach: settings.coach40k ?? '', password: coachPassword() };
}
async function botGet(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  // Sol r11: ONE config-web base per operation - authorisation, transport and retries all use it (a destination that
  // changes during the awaited login never receives this request or its token).
  const base = botConfigBaseUrl();
  let retried = false;
  for (;;) {
    const auth = await authorizeForkRequest(path, params, forkCreds(), transport, base);
    const query = new URLSearchParams(auth.payload as Record<string, string>).toString();
    let res: Response;
    try { res = await transport(`${base}/api/fork/${path}?${query}`, { headers: auth.headers }); }
    catch (e) { throw new Error(configWebUnreachableMessage(base, errText(e))); }
    if (shouldRetryAfterUnauthorized(res.status, auth.authorized, retried)) { retried = true; continue; }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.error) throw new Error(String(data.error ?? `HTTP ${res.status}`));
    return data;
  }
}
async function botPost(path: string, bodyObj: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Sol r11: ONE config-web base per operation - authorisation, transport and retries all use it (a destination that
  // changes during the awaited login never receives this request or its token).
  const base = botConfigBaseUrl();
  const url = `${base}/api/fork/${path}`;
  let retried = false;
  for (;;) {
    const auth = await authorizeForkRequest(path, bodyObj, forkCreds(), transport, base);
    let res: Response;
    try {
      res = await transport(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth.headers },
        body: JSON.stringify(auth.payload),
      });
    } catch (e) { throw new Error(configWebUnreachableMessage(base, errText(e))); }
    if (shouldRetryAfterUnauthorized(res.status, auth.authorized, retried)) { retried = true; continue; }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || data.error) {
      // Carry the HTTP status + body so callers can branch on it (Veers' spec: 400 illegal / 401 auth / 503 config).
      const err = new Error(String(data.error ?? `HTTP ${res.status}`)) as Error & { status?: number; data?: Record<string, unknown> };
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }
}

// ---- the coach's team library -----------------------------------------------------------------
interface LibraryTeam { teamId: string; teamName: string; race: string; teamValue?: number; gold?: number; forkLoadable?: boolean }
const library = ref<LibraryTeam[]>([]);
const libStatus = ref('');
const libBusy = ref(false);
async function loadLibrary() {
  if (!coach.value) { liveSetHere(libStatus, 'value', () => $t('teamManagement.text.setYourSuperFumbbl')); return; }
  libBusy.value = true;
  try {
    const d = await botGet('library', { coach: coach.value });
    library.value = (d.teams as LibraryTeam[]) ?? [];
    liveSetHere(libStatus, 'value', () => library.value.length === 0 ? $t('teamManagement.text.noTeamsYetCreate') : '');
  } catch (e) { library.value = []; liveSetHere(libStatus, 'value', () => $t('teamManagement.text.couldnTLoadYour', { p0: errText(e) })); }
  finally { libBusy.value = false; }
}
onMounted(loadLibrary);

// ---- which panel is open ----------------------------------------------------------------------
const panel = ref<null | 'import' | 'create'>(null);

// ---- IMPORT TEAM ------------------------------------------------------------------------------
const importInput = ref('');
interface TeamPreview { teamId: string; name: string; race: string; players: number; teamValue?: number; coach?: string }
const importPreview = ref<TeamPreview | null>(null);
const importStatus = ref('');
const importBusy = ref(false);
function teamIdFrom(raw: string): string | null {
  const m = raw.trim().match(/(\d{3,})/); // a FUMBBL team id, raw or embedded in a URL
  return m?.[1] ?? null;
}
async function previewImport() {
  importPreview.value = null; importStatus.value = '';
  const id = teamIdFrom(importInput.value);
  if (!id) { liveSetHere(importStatus, 'value', () => $t('teamManagement.text.enterAFumbblTeam')); return; }
  importBusy.value = true; liveSetHere(importStatus, 'value', () => $t('teamManagement.text.fetchingTeamFromFumbbl'));
  try {
    const url = `${FUMBBL_SITE}/api/team/get/${id}`;
    const res = inTauri ? await tauriFetch(url) : await fetch(url);
    const t = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || !t || (!t.name && !t.teamName)) throw new Error(`no team found for id ${id}`);
    const players = Array.isArray(t.players) ? t.players.length : Number(t.playerCount ?? 0);
    importPreview.value = {
      teamId: id,
      name: String(t.name ?? t.teamName ?? `Team ${id}`),
      race: String(t.race ?? t.roster ?? '—'),
      players,
      teamValue: Number(t.teamValue ?? t.value ?? 0) || undefined,
      coach: t.coach ? String(t.coach) : undefined,
    };
    importStatus.value = '';
  } catch (e) { liveSetHere(importStatus, 'value', () => $t('teamManagement.text.previewFailedP0', { p0: errText(e) })); }
  finally { importBusy.value = false; }
}
async function confirmImport() {
  const id = importPreview.value?.teamId ?? teamIdFrom(importInput.value);
  if (!id || !coach.value) { liveSetHere(importStatus, 'value', () => $t('teamManagement.text.enterATeamAnd')); return; }
  importBusy.value = true; liveSetHere(importStatus, 'value', () => $t('teamManagement.text.importingTeamOntoThe'));
  try {
    const d = await botPost('library/ingest', { coach: coach.value, team: id });
    const t = d.team as LibraryTeam | undefined;
    liveSetHere(importStatus, 'value', () => $t('teamManagement.text.importedP0', { p0: t?.teamName ?? importPreview.value?.name ?? id })
      + (d.raceWarning ? ` ⚠ ${String(d.raceWarning)}` : '')
      + (d.needsRestart ? ' (playable after the next fork restart)' : ''));
    importInput.value = ''; importPreview.value = null;
    await loadLibrary();
  } catch (e) { liveSetHere(importStatus, 'value', () => $t('teamManagement.text.importFailedP0', { p0: errText(e) })); }
  finally { importBusy.value = false; }
}

// ---- CREATE TEAM (Roster Builder) -------------------------------------------------------------
// config-web rosterOptions: MA/ST are numbers; AG/PA/AV are STRINGS that already carry the "+" (e.g. "3+",
// "8+", or "-" for no passing) — so we render them verbatim (appending "+" produced "8++"). + a skills array.
interface Position { positionId: string; name: string; cost: number; max: number; MA?: number; ST?: number; AG?: string; PA?: string; AV?: string; skills?: string[] }
interface Roster { rosterId: string; raceName: string; reRollCost?: number; maxReRolls?: number; apothecaryAllowed?: boolean; positions: Position[] }
const rosters = ref<Roster[]>([]);
const rosterId = ref('');
const teamName = ref('');
const counts = ref<Record<string, number>>({});
// Staff counts as a reactive record so one generic +/- stepper (touch-friendly, mobile) drives them all.
// apothecary is a 0/1 count here (sent as a boolean in the build body).
const staff = reactive({ reRolls: 0, assistantCoaches: 0, cheerleaders: 0, dedicatedFans: 1, apothecary: 0 });
type StaffKey = keyof typeof staff;
const STAFF_BOUNDS: Record<StaffKey, { min: number; max: number; label: string }> = {
  reRolls: { min: 0, max: 8, get label() { return $t('teamManagement.staffBounds.rerolls'); } },
  assistantCoaches: { min: 0, max: 6, get label() { return $t('teamManagement.staffBounds.asstCoaches'); } },
  cheerleaders: { min: 0, max: 12, get label() { return $t('teamManagement.staffBounds.cheerleaders'); } },
  dedicatedFans: { min: 1, max: 7, get label() { return $t('teamManagement.staffBounds.dedicatedFans'); } },
  apothecary: { min: 0, max: 1, get label() { return $t('teamManagement.staffBounds.apothecary'); } },
};
function stepStaff(key: StaffKey, delta: number) {
  const { min, max } = STAFF_BOUNDS[key];
  staff[key] = Math.max(min, Math.min(max, staff[key] + delta));
  schedulePreview();
}
const buildStatus = ref('');
const buildBusy = ref(false);
const previewSummary = ref<{ goldUsed: number; goldBudget?: number; valid: boolean; findings: string[] } | null>(null);
const current = computed(() => rosters.value.find((r) => r.rosterId === rosterId.value) || null);
const playerCount = computed(() => Object.values(counts.value).reduce((a, b) => a + b, 0));
// Owner 2026-07-15: the server preview's `goldUsed` ALREADY includes sideline staff — recomputeGold reads
// roster.summary.sidelineCost (bb-validator dist recomputeGold:813-818; composeFromBody sets sidelineCost =
// staffGold per Veers' 316fcf9, now deployed). So the displayed goldUsed is the FULL players+staff total; the
// server's `valid` likewise covers over-budget (Veers' admission fix). ⚠ Do NOT add a client staffGold on top —
// that double-counts (owner-observed 1055k where the real total was 945k). Just render the server total.
const budgetTotal = computed(() => Number(previewSummary.value?.goldBudget ?? 1000000));
// Owner 2026-07-15 (Veers-routed): order the position picker by cost DESCENDING (most-expensive first).
// Non-mutating copy at render (mirrors config-web 7b94024).
const sortedPositions = computed(() => current.value ? [...current.value.positions].sort((a, b) => b.cost - a.cost) : []);
const canBuild = computed(() => !!previewSummary.value?.valid && !!teamName.value.trim() && !!coach.value && playerCount.value > 0);

async function loadRosters() {
  if (rosters.value.length) return;
  try {
    const d = await botGet('rosters', {});
    rosters.value = (d.rosters as Roster[]) ?? [];
  } catch (e) { liveSetHere(buildStatus, 'value', () => $t('teamManagement.text.couldnTLoadRosters', { p0: errText(e) })); }
}
function onRaceChange() {
  counts.value = {}; previewSummary.value = null;
  // i18n (Astra r1 #9): a generated team name is DATA (sent to config-web): invariant English.
  if (current.value && !teamName.value.trim()) teamName.value = data(`${current.value.raceName} team`);
}
function bump(positionId: string, delta: number, max: number) {
  const n = Math.max(0, (counts.value[positionId] ?? 0) + delta);
  if (delta > 0 && n > max) return;
  if (delta > 0 && playerCount.value >= 16) return; // BB roster cap
  counts.value = { ...counts.value, [positionId]: n };
  schedulePreview();
}
function builderBody() {
  return {
    rosterId: rosterId.value,
    coach: coach.value,
    teamName: teamName.value.trim(),
    picks: Object.entries(counts.value).filter(([, n]) => n > 0).map(([positionId, count]) => ({ positionId, count })),
    reRolls: staff.reRolls,
    apothecary: staff.apothecary > 0,
    assistantCoaches: staff.assistantCoaches,
    cheerleaders: staff.cheerleaders,
    dedicatedFans: staff.dedicatedFans,
  };
}
let previewTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePreview() { if (previewTimer) clearTimeout(previewTimer); previewTimer = setTimeout(runPreview, 250); }
async function runPreview() {
  if (!current.value || playerCount.value === 0) { previewSummary.value = null; return; }
  try {
    const r = await botPost('team-builder/preview', builderBody());
    const summary = (r.summary as { goldUsed?: number; goldBudget?: number }) ?? {};
    const errs = ((r.errors as { message: string }[]) ?? []).map((f) => `✗ ${f.message}`);
    const warns = ((r.warnings as { message: string }[]) ?? []).map((f) => `⚠ ${f.message}`);
    previewSummary.value = { goldUsed: Number(summary.goldUsed ?? 0), goldBudget: summary.goldBudget, valid: !!r.valid, findings: [...errs, ...warns] };
  } catch (e) { previewSummary.value = { goldUsed: 0, valid: false, findings: [`✗ ${errText(e)}`] }; }
}
async function buildTeam() {
  buildBusy.value = true; liveSetHere(buildStatus, 'value', () => $t('teamManagement.text.building'));
  const name = teamName.value.trim();
  try {
    // Veers' spec (ForTarkin-client-build-team-hot-import-spec.md): POST /build owns the whole server-authoritative
    // pipeline — validate → write team XML → HOT cache-refresh (no restart, live games untouched). Send the fork
    // coach + password for the V2 coach-auth gate. On 200 the team is already in the fork cache and joinable.
    // `password` is the DEPRECATED back-compat credential (owner ruling 08-17): botPost strips it
    // whenever a session token was obtained, and only an older config-web ever receives it.
    const r = await botPost('team-builder/build', { ...builderBody(), coach: coach.value, password: coachPassword() });
    // reload.method === 'refresh' confirms the hot import (no restart); a 'restart' path self-refuses during live play.
    const reload = r.reload as { method?: string; teams?: number } | undefined;
    const hot = reload?.method === 'refresh';
    liveSetHere(buildStatus, 'value', () => $t(hot ? 'teamManagement.liveOnFork' : 'teamManagement.liveOnForkPending', { name, teamId: r.teamId ? ` (${r.teamId})` : '' }));
    counts.value = {}; previewSummary.value = null; teamName.value = '';
    await loadLibrary();
  } catch (e) {
    // Per the spec: 401 = coach-auth (need the fork password), 400 = illegal team (surface findings, keep the
    // builder open for edits), 503 = host not configured. Keep the current picks on any failure.
    const status = (e as { status?: number }).status;
    const data = (e as { data?: { errors?: { message?: string }[] } }).data;
    if (status === 401) {
      liveSetHere(buildStatus, 'value', () => $t('teamManagement.text.buildNeedsYourSuper'));
    } else if (status === 400) {
      const findings = (data?.errors ?? []).map((f) => f?.message).filter(Boolean).join('; ');
      liveSetHere(buildStatus, 'value', () => $t('teamManagement.text.nameIsnTLegal', { name, p1: findings || errText(e) }));
    } else {
      liveSetHere(buildStatus, 'value', () => $t('teamManagement.text.buildFailedP0', { p0: errText(e) }));
    }
  } finally { buildBusy.value = false; }
}
function openCreate() { panel.value = 'create'; buildStatus.value = ''; void loadRosters(); }
function kk(n: number) { return `${Math.round(n / 1000)}k`; }
</script>

<template>
  <section class="tm">
    <header class="tm-head">
      <h2>{{ $t('teamManagement.teamManagement') }}</h2>
      <p class="tm-sub">{{ $t('teamManagement.coach') }} <b>{{ coach || $t('teamManagement.notSet') }}</b>{{ $t('teamManagement.buildATeamOr') }}</p>
    </header>

    <div class="tm-cards">
      <button class="tm-card" :class="{ on: panel === 'create' }" @click="openCreate">
        <span class="tm-card-title">{{ $t('teamManagement.tmCard.createTeam') }}</span>
        <span class="tm-card-sub">{{ $t('teamManagement.tmCard.buildALegalBb2025') }}</span>
      </button>
      <button class="tm-card" :class="{ on: panel === 'import' }" @click="panel = 'import'">
        <span class="tm-card-title">{{ $t('teamManagement.tmCard.importTeam') }}</span>
        <span class="tm-card-sub">{{ $t('teamManagement.tmCard.bringInATeam') }}</span>
      </button>
    </div>

    <!-- IMPORT TEAM ------------------------------------------------------------------------->
    <div v-if="panel === 'import'" class="tm-panel">
      <h3>{{ $t('teamManagement.tmPanel.importATeamFrom') }}</h3>
      <div class="tm-row">
        <input v-model="importInput" type="text" class="tm-input" :placeholder="$t('teamManagement.tmPanel.fumbblTeamIdOr')"
          @keydown.enter.prevent="previewImport" />
        <button class="tm-btn" :disabled="importBusy" @click="previewImport">{{ $t('teamManagement.tmPanel.preview') }}</button>
      </div>
      <div v-if="importPreview" class="tm-preview">
        <div class="tm-preview-title">{{ importPreview.name }}</div>
        <dl class="tm-preview-grid">
          <div><dt>{{ $t('teamManagement.tmPanel.race') }}</dt><dd>{{ terms(importPreview.race) }}</dd></div>
          <div><dt>{{ $t('teamManagement.tmPanel.players') }}</dt><dd>{{ importPreview.players || '—' }}</dd></div>
          <div v-if="importPreview.teamValue"><dt>{{ $t('teamManagement.tmPanel.teamValue') }}</dt><dd>{{ kk(importPreview.teamValue) }}</dd></div>
          <div v-if="importPreview.coach"><dt>{{ $t('teamManagement.tmPanel.coach') }}</dt><dd>{{ importPreview.coach }}</dd></div>
        </dl>
        <button class="tm-btn tm-btn-go" :disabled="importBusy || !coach" @click="confirmImport">{{ $t('teamManagement.tmPanel.confirmBindToP0', { p0: coach || 'coach' }) }}</button>
      </div>
      <p v-if="importStatus" class="tm-status">{{ importStatus }}</p>
    </div>

    <!-- CREATE TEAM (Roster Builder) ------------------------------------------------------->
    <div v-else-if="panel === 'create'" class="tm-panel">
      <h3>{{ $t('teamManagement.tmPanel.rosterBuilder') }}</h3>
      <p class="tm-sub">{{ $t('teamManagement.tmPanel.composeALegalBb2025') }}</p>
      <div class="tm-row">
        <label class="tm-field">{{ $t('teamManagement.tmPanel.race') }}
          <select v-model="rosterId" class="tm-input" @change="onRaceChange">
            <option value="">{{ $t('teamManagement.tmPanel.chooseARace') }}</option>
            <option v-for="r in rosters" :key="r.rosterId" :value="r.rosterId">{{ terms(r.raceName) }}</option>
          </select>
        </label>
        <label class="tm-field">{{ $t('teamManagement.tmPanel.teamName') }}
          <input v-model="teamName" type="text" class="tm-input" :placeholder="$t('teamManagement.tmPanel.teamName2')" @input="schedulePreview" />
        </label>
      </div>
      <div v-if="current" class="tm-positions">
        <table>
          <thead><tr><th>{{ $t('teamManagement.tmPanel.position') }}</th><th class="r">{{ $t('teamManagement.tmPanel.cost') }}</th><th class="c">{{ $t('teamManagement.tmPanel.max') }}</th><th>{{ $t('teamManagement.tmPanel.stats') }}</th><th>{{ $t('teamManagement.tmPanel.skills') }}</th><th class="c">{{ $t('teamManagement.tmPanel.count') }}</th></tr></thead>
          <tbody>
            <tr v-for="p in sortedPositions" :key="p.positionId">
              <td>{{ p.name }}</td>
              <td class="r">{{ kk(p.cost) }}</td>
              <td class="c">{{ p.max }}</td>
              <td class="stats">
                <div class="stat-chips">
                  <span class="stat-chip"><b>{{ p.MA ?? '—' }}</b><em>{{ $t('teamManagement.tmPanel.ma') }}</em></span>
                  <span class="stat-chip"><b>{{ p.ST ?? '—' }}</b><em>ST</em></span>
                  <span class="stat-chip"><b>{{ p.AG || '—' }}</b><em>{{ $t('teamManagement.tmPanel.ag') }}</em></span>
                  <span class="stat-chip"><b>{{ p.PA || '—' }}</b><em>{{ $t('teamManagement.tmPanel.pa') }}</em></span>
                  <span class="stat-chip"><b>{{ p.AV || '—' }}</b><em>{{ $t('teamManagement.tmPanel.av') }}</em></span>
                </div>
              </td>
              <td class="skills">{{ p.skills && p.skills.length ? p.skills.join(', ') : '—' }}</td>
              <td class="c">
                <div class="tm-count">
                  <button class="tm-mini" @click="bump(p.positionId, -1, p.max)">−</button>
                  <b>{{ counts[p.positionId] || 0 }}</b>
                  <button class="tm-mini" @click="bump(p.positionId, 1, p.max)">+</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="tm-staff">
          <div class="tm-staff-row">
            <div v-for="key in (['reRolls','apothecary'] as const)" :key="key" class="tm-staff-item">
              <span class="tm-staff-label">{{ STAFF_BOUNDS[key].label }}</span>
              <div class="tm-count">
                <button type="button" class="tm-mini" :disabled="staff[key] <= STAFF_BOUNDS[key].min" @click="stepStaff(key, -1)">−</button>
                <b>{{ staff[key] }}</b>
                <button type="button" class="tm-mini" :disabled="staff[key] >= STAFF_BOUNDS[key].max" @click="stepStaff(key, 1)">+</button>
              </div>
            </div>
            <div class="tm-staff-metrics">
              <span class="tm-metric">{{ $t('teamManagement.tmPanel.players') }} <b>{{ playerCount }}</b>/16</span>
              <span class="tm-metric">{{ $t('teamManagement.tmPanel.budget') }} <b :class="{ over: !!previewSummary && previewSummary.goldUsed > budgetTotal }">{{ previewSummary ? kk(previewSummary.goldUsed) : '0k' }}</b> / {{ kk(budgetTotal) }}</span>
            </div>
          </div>
          <div class="tm-staff-row">
            <div v-for="key in (['assistantCoaches','cheerleaders','dedicatedFans'] as const)" :key="key" class="tm-staff-item">
              <span class="tm-staff-label">{{ STAFF_BOUNDS[key].label }}</span>
              <div class="tm-count">
                <button type="button" class="tm-mini" :disabled="staff[key] <= STAFF_BOUNDS[key].min" @click="stepStaff(key, -1)">−</button>
                <b>{{ staff[key] }}</b>
                <button type="button" class="tm-mini" :disabled="staff[key] >= STAFF_BOUNDS[key].max" @click="stepStaff(key, 1)">+</button>
              </div>
            </div>
          </div>
        </div>
        <div v-if="previewSummary" class="tm-findings">
          <div v-if="previewSummary.findings.length === 0 && previewSummary.valid" class="tm-finding ok">{{ $t('teamManagement.tmPanel.legalTeam') }}</div>
          <div v-for="(f, i) in previewSummary.findings" :key="i" class="tm-finding" :class="{ err: f.startsWith('✗') }">{{ f }}</div>
        </div>
        <button class="tm-btn tm-btn-go" :disabled="!canBuild || buildBusy" @click="buildTeam">{{ $t('teamManagement.tmPanel.buildTeam') }}</button>
        <p v-if="buildStatus" class="tm-status">{{ buildStatus }}</p>
      </div>
    </div>

    <!-- YOUR TEAMS ------------------------------------------------------------------------->
    <div class="tm-panel tm-teams">
      <div class="tm-teams-head">
        <h3>{{ $t('teamManagement.tmPanel.yourTeams') }}</h3>
        <button class="tm-btn tm-btn-ghost" :disabled="libBusy" @click="loadLibrary">{{ $t('teamManagement.tmPanel.refresh') }}</button>
      </div>
      <ul v-if="library.length" class="tm-team-list">
        <li v-for="t in library" :key="t.teamId">
          <span class="tm-team-name">{{ t.teamName }}</span>
          <span class="tm-team-meta">{{ terms(t.race) }}<template v-if="t.teamValue"> · {{ kk(t.teamValue) }}</template></span>
          <span v-if="t.forkLoadable === false" class="tm-team-warn" :title="$t('teamManagement.tmPanel.playableAfterTheNext')">{{ $t('teamManagement.tmPanel.pendingRestart') }}</span>
        </li>
      </ul>
      <p v-if="libStatus" class="tm-status">{{ libStatus }}</p>
    </div>
  </section>
</template>

<style scoped>
/* Themed via the --ui-* engine (owner 2026-07-14) — surface/border/accent from the active theme; status
   colours (danger/success + amber warnings) stay semantic. */
.tm { max-width: 860px; margin: 0 auto; padding: 24px 28px 40px; color: var(--ui-text); overflow-y: auto; max-height: 100%; }
.tm-head h2 { margin: 0 0 2px; }
.tm-sub { color: var(--ui-muted); font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); margin: 0 0 4px; }
.tm-cards { display: flex; gap: 14px; margin: 16px 0 20px; }
.tm-card { flex: 1; display: flex; flex-direction: column; gap: 4px; text-align: left; padding: 16px 18px; border-radius: 9px; border: 1px solid var(--ui-border); background: linear-gradient(160deg, var(--ui-surface-2), var(--ui-surface)); color: var(--ui-text); cursor: pointer; }
.tm-card:hover { border-color: var(--ui-primary); }
.tm-card.on { border-color: var(--ui-primary); box-shadow: inset 0 0 0 1px var(--ui-primary); }
.tm-card-title { font-weight: 700; font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); }
.tm-card-sub { font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: var(--ui-muted); }
.tm-panel { background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 10px; padding: 16px 18px; margin-bottom: 16px; }
.tm-panel h3 { margin: 0 0 8px; font-size: max(var(--ui-min-primary-text-size, 16px), 0.98rem); }
.tm-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
.tm-field { display: flex; flex-direction: column; gap: 3px; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: var(--ui-muted); flex: 1; min-width: 140px; }
.tm-field-inline { display: inline-flex; align-items: center; gap: 5px; font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); color: var(--ui-text); }
.tm-input { background: var(--ui-surface-2); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 6px; padding: 0.45rem 0.55rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); }
.tm-input:focus { outline: none; border-color: var(--ui-primary); }
.tm-num { width: 58px; }
.tm-btn { background: var(--ui-primary); color: var(--ui-text-on-primary); border: 1px solid var(--ui-primary); border-radius: 6px; padding: 0.45rem 0.9rem; font-weight: 700; cursor: pointer; white-space: nowrap; }
.tm-btn:hover:not(:disabled) { filter: brightness(1.15); }
.tm-btn:disabled { opacity: 0.5; cursor: default; }
.tm-btn-go { margin-top: 12px; width: 100%; }
.tm-btn-ghost { background: transparent; color: var(--ui-text); border-color: var(--ui-border); }
.tm-preview { margin-top: 12px; padding: 12px 14px; border: 1px solid var(--ui-border); border-radius: 8px; background: var(--ui-surface-2); }
.tm-preview-title { font-weight: 700; font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); margin-bottom: 6px; }
.tm-preview-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px 16px; margin: 0; }
.tm-preview-grid dt { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 0.72rem); text-transform: uppercase; letter-spacing: 0.03em; }
.tm-preview-grid dd { margin: 0; font-weight: 600; }
.tm-positions table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); }
.tm-positions th, .tm-positions td { padding: 5px 8px; border-bottom: 1px solid var(--ui-border); text-align: left; }
.tm-positions th.r, .tm-positions td.r { text-align: right; }
.tm-positions th.c, .tm-positions td.c { text-align: center; }
.tm-positions td.stats { white-space: nowrap; }
.stat-chips { display: inline-flex; gap: 4px; }
.stat-chip { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; min-width: 30px; padding: 3px 4px; border-radius: 5px; border: 1px solid var(--ui-border); background: linear-gradient(160deg, var(--ui-surface-2), var(--ui-surface)); line-height: 1.05; }
.stat-chip b { font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); color: #fff; font-variant-numeric: tabular-nums; }
/* owner 2026-07-14: the MA/ST/AG/PA/AV labels were --ui-primary (dark carmine) → too dark on the dark chip.
   Brighten to the bright brand red (--ui-heading) + bold so they read clearly. */
.stat-chip em { font-size: max(var(--ui-min-text-size, 12px), 0.55rem); font-style: normal; font-weight: 700; letter-spacing: 0.04em; color: var(--ui-heading, #ff5a5a); text-transform: uppercase; margin-top: 1px; }
.tm-positions td.skills { color: var(--ui-text); font-size: max(var(--ui-min-text-size, 12px), 0.76rem); max-width: 240px; }
.tm-count { display: inline-flex; align-items: center; gap: 10px; }
.tm-count b { min-width: 16px; text-align: center; font-variant-numeric: tabular-nums; }
/* touch-friendly +/- steppers (mobile-compliant tap targets). */
.tm-mini { width: 34px; height: 34px; border-radius: 6px; border: 1px solid var(--ui-border); background: var(--ui-surface-2); color: var(--ui-text); cursor: pointer; font-weight: 700; font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem); line-height: 1; touch-action: manipulation; display: inline-flex; align-items: center; justify-content: center; }
.tm-mini:hover:not(:disabled) { background: var(--ui-primary); color: var(--ui-text-on-primary); }
.tm-mini:disabled { opacity: 0.4; cursor: default; }
/* staff steppers — two rows (row 1: Re-rolls + Apothecary, then metrics right-justified; row 2: the rest).
   Each item is "Label [− N +]" inline; rows wrap on narrow / mobile. */
.tm-staff { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--ui-border); }
.tm-staff-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; }
.tm-staff-item { display: flex; align-items: center; gap: 8px; }
.tm-staff-label { font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: var(--ui-muted); white-space: nowrap; }
.tm-staff-metrics { margin-left: auto; display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
.tm-builder-foot { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--ui-border); }
.tm-metric { font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); color: var(--ui-muted); }
.tm-metric b { color: var(--ui-text); }
.tm-metric b.over { color: var(--ui-danger); }
.tm-findings { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.tm-finding { font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); padding: 4px 8px; border-radius: 5px; background: #1a1410; border: 1px solid #4a3a1a; color: #e0c060; }
.tm-finding.ok { background: color-mix(in srgb, var(--ui-success) 16%, transparent); border-color: var(--ui-success); color: var(--ui-success); }
.tm-finding.err { background: color-mix(in srgb, var(--ui-danger) 16%, transparent); border-color: var(--ui-danger); color: var(--ui-danger); }
.tm-teams-head { display: flex; align-items: center; justify-content: space-between; }
.tm-team-list { list-style: none; margin: 8px 0 0; padding: 0; }
.tm-team-list li { display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-bottom: 1px solid var(--ui-border); }
.tm-team-name { font-weight: 600; }
.tm-team-meta { color: var(--ui-muted); font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); }
.tm-team-warn { margin-left: auto; font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: #e0a020; border: 1px solid #6a4a10; border-radius: 4px; padding: 1px 6px; }
.tm-status { margin: 10px 0 0; font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); color: var(--ui-text); }
</style>
