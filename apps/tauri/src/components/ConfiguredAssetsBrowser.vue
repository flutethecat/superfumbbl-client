<script setup lang="ts">
import { computed, ref } from 'vue';
import { settings } from '../game/settings';
import { assetMods, removeUserOverride, writeUserOverride } from '../game/assetMods';
import type { AssetTargetCatalog } from '../game/assetModUi';
import { RACE_LOGOS, teamLogoUrl } from '../game/teamLogos';
import { SOUND_CATALOG } from '../game/sounds';
import {
  buildConfiguredAssets,
  validateOverrideFile,
  type OverrideFileKind,
  type SpriteSide,
} from '../game/configuredAssets';

const props = defineProps<{ targetCatalog: AssetTargetCatalog }>();
const expandedTeams = ref(new Set<string>());
const errors = ref<Record<string, string>>({});
const busyKey = ref('');

const state = computed(() => {
  void assetMods.revision;
  void assetMods.logoRevision;
  void assetMods.blockDiceRevision;
  return buildConfiguredAssets({
    catalog: props.targetCatalog,
    installed: assetMods.installed,
    assignments: settings.assetPackAssignments,
    soundCatalog: SOUND_CATALOG,
    raceLogos: RACE_LOGOS,
  });
});

function toggleTeam(teamId: string): void {
  const next = new Set(expandedTeams.value);
  if (next.has(teamId)) next.delete(teamId); else next.add(teamId);
  expandedTeams.value = next;
}

async function pickedBytes(kind: OverrideFileKind): Promise<{ path: string; bytes: Uint8Array } | null> {
  const sound = kind === 'sound';
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = sound ? '.ogg,.wav,.mp3,audio/ogg,audio/wav,audio/mpeg' : '.png,image/png';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
  if (!file) return null;
  return { path: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

async function chooseOverride(kind: OverrideFileKind, key: string): Promise<void> {
  if (busyKey.value) return;
  busyKey.value = `${kind}:${key}`;
  errors.value = { ...errors.value, [busyKey.value]: '' };
  try {
    const picked = await pickedBytes(kind);
    if (!picked) return;
    const validation = validateOverrideFile(kind, picked.path, picked.bytes);
    if (!validation.ok) {
      errors.value = { ...errors.value, [busyKey.value]: validation.message };
      return;
    }
    await writeUserOverride(kind, key, picked.bytes, picked.path);
  } catch (error) {
    errors.value = { ...errors.value, [`${kind}:${key}`]: error instanceof Error ? error.message : String(error) };
  } finally {
    busyKey.value = '';
  }
}

async function clearOverride(kind: OverrideFileKind, key: string): Promise<void> {
  try {
    await removeUserOverride(kind, key);
    errors.value = { ...errors.value, [`${kind}:${key}`]: '' };
  } catch (error) {
    errors.value = { ...errors.value, [`${kind}:${key}`]: error instanceof Error ? error.message : String(error) };
  }
}

function spriteError(key: string): string { return errors.value[`sprite:${key}`] ?? ''; }
function sideLabel(side: SpriteSide): string { return side === 'any' ? 'Any side' : side[0]!.toUpperCase() + side.slice(1); }

</script>

<template>
  <fieldset class="settings-group configured-assets" data-testid="configured-assets">
    <legend>Configured assets</legend>
    <p class="hint">See the active source for each presentation asset. Choosing or clearing a file changes app files immediately and is not undone by Cancel; pack selections still follow Apply/Cancel.</p>

    <details open>
      <summary>Sprites</summary>
      <h4>Base Teams</h4>
      <details v-for="team in state.baseTeams" :key="team.teamId" class="configured-team" :open="expandedTeams.has(team.teamId)">
        <summary @click.prevent="toggleTeam(team.teamId)">{{ team.label }}</summary>
        <div v-if="expandedTeams.has(team.teamId)" class="configured-list">
          <div v-for="row in team.rows" :key="row.positionId" class="configured-row sprite-row" :data-position="row.positionId">
            <strong>{{ row.label }}</strong>
            <div class="sprite-variants">
              <div v-for="variant in row.variants" :key="variant.overrideKey" class="sprite-variant" :data-override-key="variant.overrideKey">
                <span>{{ sideLabel(variant.side) }}</span>
                <img v-if="variant.url" :src="variant.url" :alt="`${row.label} ${variant.side} sprite`" />
                <span v-else class="missing-preview">Built-in</span>
                <small>{{ variant.source }}</small>
                <button type="button" :disabled="!!busyKey" @click="chooseOverride('sprite', variant.overrideKey)">Choose file...</button>
                <button v-if="variant.userOverride" type="button" @click="clearOverride('sprite', variant.overrideKey)">Clear</button>
                <span v-if="spriteError(variant.overrideKey)" class="configured-error" role="alert">{{ spriteError(variant.overrideKey) }}</span>
              </div>
            </div>
          </div>
        </div>
      </details>
      <details class="secret-league" data-testid="secret-league">
        <summary>Secret League</summary>
        <details v-for="team in state.secretLeagueTeams" :key="team.teamId" class="configured-team" :open="expandedTeams.has(team.teamId)">
          <summary @click.prevent="toggleTeam(team.teamId)">{{ team.label }}</summary>
          <div v-if="expandedTeams.has(team.teamId)" class="configured-list">
            <div v-for="row in team.rows" :key="row.positionId" class="configured-row sprite-row">
              <strong>{{ row.label }}</strong>
              <div class="sprite-variants">
                <div v-for="variant in row.variants" :key="variant.overrideKey" class="sprite-variant" :data-override-key="variant.overrideKey">
                  <span>{{ sideLabel(variant.side) }}</span><img v-if="variant.url" :src="variant.url" alt="" />
                  <small>{{ variant.source }}</small>
                  <button type="button" :disabled="!!busyKey" @click="chooseOverride('sprite', variant.overrideKey)">Choose file...</button>
                  <button v-if="variant.userOverride" type="button" @click="clearOverride('sprite', variant.overrideKey)">Clear</button>
                  <span v-if="spriteError(variant.overrideKey)" class="configured-error" role="alert">{{ spriteError(variant.overrideKey) }}</span>
                </div>
              </div>
            </div>
          </div>
        </details>
      </details>
    </details>

    <details>
      <summary>Block dice</summary>
      <div class="configured-list">
        <div v-for="row in state.blockDice" :key="row.face" class="configured-row block-die-row">
          <span>{{ row.label }}</span><img v-if="row.url" :src="row.url" alt="" />
          <small>{{ row.source }}</small>
          <button type="button" :disabled="!!busyKey" @click="chooseOverride('blockDie', row.face)">Choose file...</button>
          <button v-if="row.userOverride" type="button" @click="clearOverride('blockDie', row.face)">Clear</button>
          <span v-if="errors[`blockDie:${row.face}`]" class="configured-error" role="alert">{{ errors[`blockDie:${row.face}`] }}</span>
        </div>
      </div>
    </details>

    <details>
      <summary>Sounds</summary>
      <div class="configured-list">
        <div v-for="row in state.sounds" :key="row.id" class="configured-row">
          <span>{{ row.label }}</span><small>{{ row.source }}</small>
          <button type="button" :disabled="!!busyKey" @click="chooseOverride('sound', row.id)">Choose file...</button>
          <button v-if="row.userOverride" type="button" @click="clearOverride('sound', row.id)">Clear</button>
          <span v-if="errors[`sound:${row.id}`]" class="configured-error" role="alert">{{ errors[`sound:${row.id}`] }}</span>
        </div>
      </div>
    </details>

    <details>
      <summary>Team Logos</summary>
      <div class="configured-list">
        <div v-for="row in state.logos" :key="row.race" class="configured-row logo-row">
          <span>{{ row.race }}</span><img v-if="teamLogoUrl({ race: row.race })" :src="teamLogoUrl({ race: row.race })!" alt="" />
          <small>{{ row.source }}</small>
          <button type="button" :disabled="!!busyKey" @click="chooseOverride('logo', row.race)">Choose file...</button>
          <button v-if="row.userOverride" type="button" @click="clearOverride('logo', row.race)">Clear</button>
          <span v-if="errors[`logo:${row.race}`]" class="configured-error" role="alert">{{ errors[`logo:${row.race}`] }}</span>
        </div>
      </div>
    </details>

    <details>
      <summary>Other</summary>
      <div class="configured-list">
        <div v-for="(row, index) in state.other" :key="`${row.kind}:${row.id}:${index}`" class="configured-row other-row">
          <span>{{ row.kind }}</span><code>{{ row.id }}</code><small>{{ row.source }}</small>
        </div>
      </div>
    </details>
  </fieldset>
</template>

<style scoped>
.configured-assets{display:grid;gap:.55rem}.configured-assets>details>summary,.configured-team>summary{cursor:pointer;font-weight:700}.configured-assets h4{margin:.55rem 0}.configured-team{margin:.35rem 0;padding-left:.5rem}.configured-list{display:grid;border:1px solid var(--ui-border);border-radius:5px;margin:.4rem 0;max-height:420px;overflow:auto}.configured-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:7px;border-bottom:1px solid var(--ui-border)}.configured-row:last-child{border-bottom:0}.configured-row>span:first-child,.configured-row>strong{min-width:160px;flex:1}.configured-row small{color:var(--ui-muted,#aaa)}.sprite-row{align-items:flex-start}.sprite-variants{display:flex;gap:8px;flex-wrap:wrap;flex:3}.sprite-variant{display:grid;grid-template-columns:64px auto;gap:4px 7px;align-items:center;padding:5px;border:1px solid var(--ui-border);border-radius:5px}.sprite-variant img{grid-row:1/span 3;width:58px;height:58px;object-fit:contain;image-rendering:pixelated}.missing-preview{grid-row:1/span 3;width:58px;height:58px;display:grid;place-items:center;border:1px dashed var(--ui-border);font-size:.7rem}.logo-row img{width:42px;height:42px;object-fit:contain}.configured-error{flex-basis:100%;color:#ff7070;font-size:.8rem}.other-row code{overflow-wrap:anywhere}
</style>
