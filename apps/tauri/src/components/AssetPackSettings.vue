<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { open, save } from '@tauri-apps/plugin-dialog';
import { settings } from '../game/settings';
import ConfiguredAssetsBrowser from './ConfiguredAssetsBrowser.vue';
import { SOUND_CATALOG, previewSound } from '../game/sounds';
import {
  loadAssetTargetCatalog,
  rememberAssetTargetCatalog,
  SKILL_TARGET_CHOICES,
} from '../game/assetModUi';
import {
  applyAssetDraft,
  assertNever,
  assetMods,
  beginAssetAssignmentIntent,
  commitAssetAssignments,
  createAssetDraft,
  deleteAssetDraft,
  exportAssetDraft,
  formatPackSize,
  importAssetPack,
  inspectAssetDraft,
  inspectAssetPackFile,
  isAssignableAssetPack,
  isAssetPackLeased,
  listAssetDrafts,
  packSupports,
  putDraftImage,
  putDraftSound,
  putDraftWalkSheet,
  removeDraftBinding,
  removeInstalledAssetPack,
  updateAssetDraft,
  USER_FILES_DRAFT_ID,
  type AssetAssignmentCapability,
  type AssetPackAssignments,
  type AssetPackSection,
  type DraftDetails,
  type DraftItem,
  type DraftSummary,
  type InstalledAssetPack,
  type InspectedAssetPack,
} from '../game/assetMods';

const props = defineProps<{ builderMode?: boolean; liveGame?: unknown }>();

const drafts = ref<DraftSummary[]>([]);
const draft = ref<DraftDetails | null>(null);
const draftName = ref('My asset pack');
const editorBusy = ref(false);
const editorError = ref('');
const editorNotice = ref('');
const validatedPack = ref<InspectedAssetPack | null>(null);
const ADVANCED_TARGET = '__advanced_stable_id__';
const targetCatalog = ref(loadAssetTargetCatalog());
const initialTeam = targetCatalog.value.teams[0];
const skill = ref(SKILL_TARGET_CHOICES.find((choice) => choice.label === 'Block')?.id ?? 'block');
const skillPositionId = ref('');
const skillSide = ref<'any' | 'home' | 'away'>('any');
const spriteTeamId = ref(initialTeam?.teamId ?? '');
const spritePositionId = ref(initialTeam?.positions[0]?.positionId ?? '');
const advancedSkill = ref(false);
const advancedSkillPosition = ref(false);
const advancedSpriteTeam = ref(false);
const advancedSpritePosition = ref(false);
const scaling = ref<'linear' | 'nearest'>('nearest');
const soundEventId = ref(SOUND_CATALOG[0]!.id);
const pitchThemeId = ref('fumbbl-default');
const pitchWeathers = ref<Array<'blizzard' | 'heat' | 'nice' | 'rain' | 'sunny'>>(['nice']);
const weatherChoices = [
  { id: 'nice', label: 'Nice' },
  { id: 'rain', label: 'Rain' },
  { id: 'sunny', label: 'Very sunny' },
  { id: 'blizzard', label: 'Blizzard' },
  { id: 'heat', label: 'Sweltering heat' },
] as const;

const capabilities: Array<{ key: AssetAssignmentCapability; label: string }> = [
  { key: 'skillIcons', label: 'Skill icons' },
  { key: 'playerSprites', label: 'Player sprites' },
  { key: 'walkSheets', label: 'Walk sheets' },
  { key: 'soundEvents', label: 'Sound events' },
  { key: 'teamLogos', label: 'Team logos' }, // owner 09-07
  { key: 'blockDice', label: 'Block dice' },
];
const exportSections: Array<{ key: AssetPackSection; label: string }> = [
  { key: 'player-sprites', label: 'Sprites only' },
  { key: 'walk-sheets', label: 'Walk sheets only' },
  { key: 'sound-events', label: 'Sounds only' },
  { key: 'team-logos', label: 'Team logos only' },
  { key: 'block-dice', label: 'Block dice only' },
  { key: 'skill-icons', label: 'Skill icons only' },
  { key: 'pitch-images', label: 'Pitches only' },
  { key: 'combined', label: 'Combined pack' },
];

const knownTeams = computed(() => targetCatalog.value.teams);
const knownPositions = computed(() => knownTeams.value.find((team) => team.teamId === spriteTeamId.value)?.positions ?? []);
const knownSkillPositions = computed(() => targetCatalog.value.positions);
const spriteTeamChoice = computed(() => !advancedSpriteTeam.value && knownTeams.value.some((team) => team.teamId === spriteTeamId.value)
  ? spriteTeamId.value : ADVANCED_TARGET);
const spritePositionChoice = computed(() => !advancedSpritePosition.value && knownPositions.value.some((position) => position.positionId === spritePositionId.value)
  ? spritePositionId.value : ADVANCED_TARGET);
const skillChoice = computed(() => !advancedSkill.value && SKILL_TARGET_CHOICES.some((choice) => choice.id === skill.value)
  ? skill.value : ADVANCED_TARGET);
const skillPositionChoice = computed(() => {
  if (!skillPositionId.value && !advancedSkillPosition.value) return '';
  return !advancedSkillPosition.value && knownSkillPositions.value.some((position) => position.positionId === skillPositionId.value)
    ? skillPositionId.value : ADVANCED_TARGET;
});
const selectedPackIds = computed(() => new Set(Object.values(settings.assetPackAssignments).filter(Boolean)));
const activePackIds = computed(() => new Set(Object.values(assetMods.activeAssignments).filter(Boolean)));
const installedPacks = computed(() => assetMods.installed.filter(isAssignableAssetPack));

function rememberKnownTargets(): void {
  targetCatalog.value = rememberAssetTargetCatalog({
    game: props.liveGame,
    drafts: draft.value ? [draft.value] : [],
    installed: assetMods.installed,
  });
  if (!spriteTeamId.value && targetCatalog.value.teams[0]) {
    spriteTeamId.value = targetCatalog.value.teams[0].teamId;
    spritePositionId.value = targetCatalog.value.teams[0].positions[0]?.positionId ?? '';
  }
}

function chooseSpriteTeam(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  advancedSpriteTeam.value = value === ADVANCED_TARGET;
  if (advancedSpriteTeam.value) return;
  spriteTeamId.value = value;
  spritePositionId.value = knownTeams.value.find((team) => team.teamId === value)?.positions[0]?.positionId ?? '';
  advancedSpritePosition.value = false;
}

function chooseSpritePosition(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  advancedSpritePosition.value = value === ADVANCED_TARGET;
  if (!advancedSpritePosition.value) spritePositionId.value = value;
}

function chooseSkill(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  advancedSkill.value = value === ADVANCED_TARGET;
  if (!advancedSkill.value) skill.value = value;
}

function chooseSkillPosition(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  advancedSkillPosition.value = value === ADVANCED_TARGET;
  if (!advancedSkillPosition.value) skillPositionId.value = value;
}

async function reloadDrafts(selectId?: string): Promise<void> {
  drafts.value = (await listAssetDrafts()).filter((entry) => entry.draftId !== USER_FILES_DRAFT_ID);
  const id = selectId ?? draft.value?.draftId ?? drafts.value[0]?.draftId;
  draft.value = id ? await inspectAssetDraft(id) : null;
  if (draft.value) draftName.value = draft.value.name;
  rememberKnownTargets();
}

async function run(action: () => Promise<void>): Promise<void> {
  if (editorBusy.value) return;
  editorBusy.value = true;
  editorError.value = '';
  editorNotice.value = '';
  try { await action(); }
  catch (error) { editorError.value = error instanceof Error ? error.message : String(error); }
  finally { editorBusy.value = false; }
}

async function newDraft(): Promise<void> {
  await run(async () => {
    draft.value = await createAssetDraft(draftName.value.trim() || 'My asset pack');
    await reloadDrafts(draft.value.draftId);
  });
}

async function selectDraft(event: Event): Promise<void> {
  const id = (event.target as HTMLSelectElement).value;
  if (!id) { draft.value = null; return; }
  await run(async () => {
    draft.value = await inspectAssetDraft(id);
    draftName.value = draft.value.name;
    rememberKnownTargets();
  });
}

/** Owner 09-10: "Save draft" — every upload is already persisted to the draft folder as it lands; this commits the
 *  pack name and tells the author the work is safe to leave and resume from the draft picker (it replaced Rename). */
async function saveDraft(): Promise<void> {
  if (!draft.value) return;
  await run(async () => {
    draft.value = await updateAssetDraft(draft.value!.draftId, draftName.value.trim() || draft.value!.name);
    await reloadDrafts(draft.value!.draftId);
    editorNotice.value = `Draft “${draft.value!.name}” saved — pick it up any time from the draft list.`;
  });
}

async function removeDraft(): Promise<void> {
  if (!draft.value || !window.confirm(`Delete draft “${draft.value.name}”? Installed/exported packs are not removed.`)) return;
  await run(async () => { await deleteAssetDraft(draft.value!.draftId); draft.value = null; await reloadDrafts(); });
}

async function choosePath(extensions: string[], name: string): Promise<string | null> {
  const chosen = await open({ multiple: false, directory: false, filters: [{ name, extensions }] });
  return typeof chosen === 'string' ? chosen : null;
}

async function addSkillIconFor(skillId = skill.value): Promise<void> {
  await run(async () => {
    if (!draft.value || !skillId.trim()) return;
    const path = await choosePath(['png', 'gif'], 'PNG or GIF image');
    if (!path) return;
    draft.value = await putDraftImage(draft.value!.draftId, path, {
      kind: 'skillIcon', skill: skillId.trim(), positionId: skillPositionId.value.trim() || null, side: skillSide.value,
    }, scaling.value);
    await reloadDrafts(draft.value.draftId);
  });
}

async function addSkillIcon(): Promise<void> { return addSkillIconFor(skill.value); }

async function addPlayerSpriteFor(side: 'any' | 'home' | 'away', positionId = spritePositionId.value): Promise<void> {
  await run(async () => {
    if (!draft.value || !spriteTeamId.value.trim() || !positionId.trim()) return;
    const path = await choosePath(['png', 'gif'], 'PNG or GIF image');
    if (!path) return;
    draft.value = await putDraftImage(draft.value!.draftId, path, {
      kind: 'playerSprite', teamId: spriteTeamId.value.trim(), positionId: positionId.trim(), side,
    }, scaling.value);
    await reloadDrafts(draft.value.draftId);
  });
}

async function addPlayerSprite(): Promise<void> { return addPlayerSpriteFor('any'); }

async function addWalkSheetFor(side: 'any' | 'home' | 'away', positionId = spritePositionId.value): Promise<void> {
  await run(async () => {
    if (!draft.value || !spriteTeamId.value.trim() || !positionId.trim()) return;
    const path = await choosePath(['png'], 'Walk sheet PNG');
    if (!path) return;
    draft.value = await putDraftWalkSheet(draft.value!.draftId, path, {
      kind: 'walkSheet', teamId: spriteTeamId.value.trim(), positionId: positionId.trim(), side,
    });
    await reloadDrafts(draft.value.draftId);
  });
}

async function addSound(): Promise<void> {
  await run(async () => {
    if (!draft.value) return;
    const path = await choosePath(['ogg', 'wav', 'mp3'], 'Audio');
    if (!path) return;
    draft.value = await putDraftSound(draft.value!.draftId, path, soundEventId.value);
    await reloadDrafts(draft.value.draftId);
  });
}

async function addSoundFor(eventId: string): Promise<void> {
  soundEventId.value = eventId;
  return addSound();
}

async function addPitch(): Promise<void> {
  await run(async () => {
    if (!draft.value || !pitchWeathers.value.length) return;
    const path = await choosePath(['png', 'gif'], 'Pitch PNG or GIF');
    if (!path) return;
    for (const weather of pitchWeathers.value) {
      draft.value = await putDraftImage(draft.value!.draftId, path, {
        kind: 'pitchImage', themeId: pitchThemeId.value, weather,
      }, 'linear');
    }
    await reloadDrafts(draft.value.draftId);
  });
}

async function removeItem(item: DraftItem): Promise<void> {
  if (!draft.value) return;
  await run(async () => { draft.value = await removeDraftBinding(draft.value!.draftId, item.bindingId); await reloadDrafts(draft.value!.draftId); });
}

function nextAssignmentsForPack(pack: InstalledAssetPack, section: AssetPackSection): AssetPackAssignments {
  const next = { ...settings.assetPackAssignments };
  if (!isAssignableAssetPack(pack)) return next;
  if ((section === 'skill-icons' || section === 'combined') && packSupports(pack, 'skillIcons')) next.skillIcons = pack.installId;
  if ((section === 'player-sprites' || section === 'combined') && packSupports(pack, 'playerSprites')) next.playerSprites = pack.installId;
  if ((section === 'walk-sheets' || section === 'combined') && packSupports(pack, 'walkSheets')) next.walkSheets = pack.installId;
  if ((section === 'sound-events' || section === 'combined') && packSupports(pack, 'soundEvents')) next.soundEvents = pack.installId;
  if ((section === 'team-logos' || section === 'combined') && packSupports(pack, 'teamLogos')) next.teamLogos = pack.installId;
  if ((section === 'block-dice' || section === 'combined') && packSupports(pack, 'blockDice')) next.blockDice = pack.installId;
  return next;
}

async function publishAssignments(next: AssetPackAssignments, intent = beginAssetAssignmentIntent()): Promise<boolean> {
  return commitAssetAssignments(next, (active) => {
    settings.assetPackAssignments = active;
    settings.skillIconPackInstallId = active.skillIcons;
  }, intent);
}

async function applySection(section: AssetPackSection): Promise<void> {
  if (!draft.value || editorBusy.value) return;
  // Capture this click before native export/install work. A later dropdown/apply
  // action supersedes it even if this native operation happens to finish last.
  const intent = beginAssetAssignmentIntent();
  assetMods.creatorApplyBusy = true;
  try {
    await run(async () => {
      const pack = await applyAssetDraft(draft.value!.draftId, section);
      if (!await publishAssignments(nextAssignmentsForPack(pack, section), intent)) throw new Error(assetMods.error || 'A newer pack choice won. The pack was installed but not activated.');
      editorNotice.value = `${pack.name} ${pack.version} applied.`;
    });
  } finally {
    assetMods.creatorApplyBusy = false;
  }
}

async function exportSection(section: AssetPackSection): Promise<void> {
  await run(async () => {
    if (!draft.value) return;
    const destination = await save({
      defaultPath: `${draft.value.name.replace(/[^a-z0-9_-]+/gi, '-')}-${section}.f40kmod`,
      filters: [{ name: 'Super FUMBBL asset mod', extensions: ['f40kmod'] }],
    });
    if (!destination) return;
    const exported = await exportAssetDraft(draft.value!.draftId, section, destination);
    editorNotice.value = `${exported.name} ${exported.version} exported (${formatPackSize(exported.sizeBytes)}).`;
  });
}

/** Owner 09-09: the skill-icon slot offers a second BUNDLED family, "Illustrated - Default", beside "Built-in
 *  default". Both are pack-less (assignment ''); the family choice lives in `settings.skillBadgeFamily`. */
const ILLUSTRATED_BUILTIN = 'builtin:illustrated';
function assignmentSelectValue(capability: AssetAssignmentCapability): string {
  const id = settings.assetPackAssignments[capability];
  return capability === 'skillIcons' && id === '' && settings.skillBadgeFamily === 'illustrated' ? ILLUSTRATED_BUILTIN : id;
}
async function changeAssignment(capability: AssetAssignmentCapability, event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value;
  const builtin = value === ILLUSTRATED_BUILTIN;
  const next = { ...settings.assetPackAssignments, [capability]: builtin ? '' : value };
  if (!await publishAssignments(next)) { editorError.value = assetMods.error; return; }
  if (capability === 'skillIcons') settings.skillBadgeFamily = builtin ? 'illustrated' : 'default';
}

async function useAll(pack: InstalledAssetPack): Promise<void> {
  if (!isAssignableAssetPack(pack)) return;
  const next = { ...settings.assetPackAssignments };
  for (const capability of capabilities) if (packSupports(pack, capability.key)) next[capability.key] = pack.installId;
  if (!await publishAssignments(next)) editorError.value = assetMods.error;
}

function isRollbackVersion(pack: InstalledAssetPack): boolean {
  return assetMods.installed.some((candidate) => candidate.packId === pack.packId
    && candidate.installId !== pack.installId
    && candidate.version.localeCompare(pack.version, 'en', { numeric: true }) > 0);
}

function capabilityCoverage(pack: InstalledAssetPack, capability: string): number {
  if (pack.coverage?.[capability] != null) return pack.coverage[capability]!;
  if (capability === 'skill-icons') return pack.skillIconBindings?.length ?? Object.keys(pack.skillIcons).length;
  if (capability === 'player-sprites') return pack.playerSpriteBindings?.length ?? 0;
  if (capability === 'walk-sheets') return pack.walkSheetBindings?.length ?? 0;
  return pack.soundEventBindings?.length ?? 0;
}

function redistributionLabel(value: InstalledAssetPack['redistribution']): string {
  if (value === 'cleared') return 'Redistribution cleared';
  if (value === 'owner-authorized-external-mod') return 'Owner-authorized external mod';
  if (value === 'tester-approved-public-review-required') return 'Tester-approved; public review required';
  return 'Local use only';
}

async function removePack(pack: InstalledAssetPack): Promise<void> {
  if (!window.confirm(`Remove ${pack.name} ${pack.version} from this device? Exported files and drafts are not removed.`)) return;
  await run(async () => {
    if (await removeInstalledAssetPack(pack.installId)) editorNotice.value = `${pack.name} ${pack.version} removed.`;
    else throw new Error(assetMods.error || 'The pack could not be removed.');
  });
}

// Owner 09-09: a finished import asks "apply this pack now?" — since a built-in pick beats every installed pack
// (3ddb2ed3), an imported pack does nothing until it is assigned. Apply = the same as "Use all" (every capability
// the pack supplies); Not now keeps the old hint and the dropdowns.
const importedPack = ref<InstalledAssetPack | null>(null);
const importedPackCapabilities = computed(() => importedPack.value
  ? capabilities.filter((c) => packSupports(importedPack.value!, c.key)).map((c) => c.label) : []);
async function importPack(): Promise<void> {
  await run(async () => {
    const pack = await importAssetPack();
    if (!pack) return;
    importedPack.value = isAssignableAssetPack(pack) && importedPackCapabilitiesOf(pack).length ? pack : null;
    editorNotice.value = importedPack.value ? '' : `${pack.name} installed. Choose capabilities below to use it.`;
  });
}
function importedPackCapabilitiesOf(pack: InstalledAssetPack): string[] {
  return capabilities.filter((c) => packSupports(pack, c.key)).map((c) => c.label);
}
async function applyImportedPack(): Promise<void> {
  const pack = importedPack.value;
  if (!pack) return;
  importedPack.value = null;
  await useAll(pack);
  if (!editorError.value) editorNotice.value = `${pack.name} ${pack.version} applied.`;
}
function dismissImportedPack(): void {
  const pack = importedPack.value;
  importedPack.value = null;
  if (pack) editorNotice.value = `${pack.name} installed. Choose capabilities below to use it.`;
}

async function validateExistingPack(): Promise<void> {
  await run(async () => {
    const path = await choosePath(['f40kmod'], 'F40KMod asset pack');
    if (!path) return;
    validatedPack.value = await inspectAssetPackFile(path);
    editorNotice.value = `${validatedPack.value.name} ${validatedPack.value.version} is a valid .f40kmod pack.`;
  });
}

function targetLabel(item: DraftItem): string {
  switch (item.target.kind) {
    case 'skillIcon':
      return `${item.target.skill}${item.target.positionId ? ` · position ${item.target.positionId}` : ''} · ${item.target.side}`;
    case 'playerSprite':
    case 'walkSheet':
      return `team ${item.target.teamId} · position ${item.target.positionId} · ${item.target.side ?? 'any'}`;
    case 'pitchImage':
      return `${item.target.themeId} · ${item.target.weather}`;
    case 'soundEvent': {
      const { eventId } = item.target;
      return SOUND_CATALOG.find((sound) => sound.id === eventId)?.label ?? eventId;
    }
    case 'teamLogo': return `race ${item.target.race}`;
    case 'blockDie': return item.target.face;
    default:
      return assertNever(item.target);
  }
}

function validatedCoverage(pack: InspectedAssetPack): string {
  return pack.capabilities.map((capability) => `${capability}: ${pack.coverage[capability] ?? 0}`).join(' · ');
}

watch(() => props.liveGame, rememberKnownTargets, { immediate: true });
watch(() => assetMods.installed, rememberKnownTargets, { deep: true });
onMounted(() => { void run(() => reloadDrafts()); });
</script>

<template>
  <fieldset v-if="!props.builderMode" class="settings-group asset-pack-settings">
    <legend>Asset packs</legend>
    <p class="hint">Each category can use a different pack. Changes apply immediately to Modern and Classic; no restart or network request is needed.</p>
    <p class="hint asset-pack-immediate">Active pack choices follow Settings Apply/Cancel. Importing, removing, exporting, editing a draft, or choosing/clearing a configured file changes app files immediately and is not undone by Cancel.</p>
    <label v-for="capability in capabilities" :key="capability.key" class="row">
      <span>{{ capability.label }}</span>
      <select :value="assignmentSelectValue(capability.key)" :disabled="!!assetMods.pendingAssignments"
        @change="changeAssignment(capability.key, $event)">
        <option value="">{{ capability.key === 'skillIcons' ? 'Flat badges (built-in)' : 'Built-in default' }}</option>
        <option v-if="capability.key === 'skillIcons'" :value="ILLUSTRATED_BUILTIN">Illustrated (built-in default)</option>
        <option v-for="pack in installedPacks.filter((candidate) => packSupports(candidate, capability.key))"
          :key="pack.installId" :value="pack.installId">{{ pack.name }} {{ pack.version }}</option>
      </select>
    </label>
    <div class="actions"><button type="button" :disabled="assetMods.busy || editorBusy" @click="importPack">Import .f40kmod…</button></div>
    <div v-for="pack in installedPacks" :key="pack.installId" class="pack-card">
      <span><strong>{{ pack.name }}</strong> {{ pack.version }} · {{ formatPackSize(pack.sizeBytes) }}</span>
      <span>{{ pack.verifiedPublisher ? 'Verified publisher' : 'Unverified local pack' }} · {{ pack.source }}</span>
      <span>{{ redistributionLabel(pack.redistribution) }}</span>
      <span>{{ pack.capabilities.map((capability) => `${capability}: ${capabilityCoverage(pack, capability)}`).join(' · ') }}</span>
      <button type="button" :disabled="!!assetMods.pendingAssignments" @click="useAll(pack)">
        {{ isRollbackVersion(pack) ? 'Rollback to this version' : 'Use all included' }}
      </button>
      <button type="button" :disabled="selectedPackIds.has(pack.installId) || editorBusy"
        :title="selectedPackIds.has(pack.installId) ? 'Choose another pack before removing it.' : 'Remove this installed pack'"
        @click="removePack(pack)">Remove</button>
      <small v-if="activePackIds.has(pack.installId)">In use</small>
      <small v-else-if="selectedPackIds.has(pack.installId)">Selected — not active this session</small>
      <small v-else-if="isAssetPackLeased(pack.installId)">Finishing previous display…</small>
    </div>
  </fieldset>

  <fieldset v-else class="settings-group asset-validator">
    <legend>Validate an existing pack</legend>
    <p class="hint">Inspect a .f40kmod without installing or changing it. Validation checks its framing, manifest, capability contract, file bounds, and hashes.</p>
    <div class="actions"><button type="button" :disabled="editorBusy" @click="validateExistingPack">Validate .f40kmod…</button></div>
    <div v-if="validatedPack" class="pack-card validated-pack" role="status">
      <strong>{{ validatedPack.name }} {{ validatedPack.version }}</strong>
      <span>{{ validatedPack.packId }}</span>
      <span>{{ formatPackSize(validatedPack.sizeBytes) }} · SHA-256 {{ validatedPack.wholePackSha256 }}</span>
      <span>{{ validatedCoverage(validatedPack) }}</span>
    </div>
  </fieldset>

  <ConfiguredAssetsBrowser v-if="!props.builderMode" :target-catalog="targetCatalog" />

  <fieldset class="settings-group asset-creator">
    <legend>Asset pack creator</legend>
    <p class="hint">Build one portable pack containing any mix of sprites, skill icons, pitches, and sounds. Branding is never added automatically; a pack contains only the rows you choose.</p>
    <div class="draft-toolbar">
      <select :value="draft?.draftId ?? ''" @change="selectDraft">
        <option value="">Choose a draft</option>
        <option v-for="entry in drafts" :key="entry.draftId" :value="entry.draftId">{{ entry.name }} ({{ entry.bindings }})</option>
      </select>
      <input v-model="draftName" maxlength="120" placeholder="Pack name" />
      <button type="button" :disabled="editorBusy" @click="newDraft">New</button>
      <button type="button" class="save-draft" :disabled="!draft || editorBusy" @click="saveDraft">Save draft</button>
      <button type="button" :disabled="!draft || editorBusy" @click="removeDraft">Delete draft</button>
    </div>

    <template v-if="draft">
      <label class="row"><span>Image scaling</span><select v-model="scaling"><option value="nearest">Pixel art / nearest</option><option value="linear">Smooth / linear</option></select></label>
      <p class="hint">PNG files can be fitted to the required canvas. GIF files retain their original bytes and must already be 48×48 for skill icons, 64×64 for player sprites, or 782×452 for pitches.</p>
      <details open>
        <summary>Player sprites</summary>
        <p class="hint">Choose a team and roster position by name. The saved mod uses their exact stable IDs, so names are never sent as targets.</p>
        <div class="target-grid">
          <label>Team <select data-testid="sprite-team-select" :value="spriteTeamChoice" @change="chooseSpriteTeam">
            <option v-for="team in knownTeams" :key="team.teamId" :value="team.teamId">{{ team.label }}</option>
            <option :value="ADVANCED_TARGET">Advanced: enter a stable team ID</option>
          </select></label>
          <label v-if="spriteTeamChoice === ADVANCED_TARGET" class="advanced-target">Stable team ID <input data-testid="sprite-team-id" v-model="spriteTeamId" spellcheck="false" /></label>
          <label>Position <select data-testid="sprite-position-select" :value="spritePositionChoice" @change="chooseSpritePosition">
            <option v-for="position in knownPositions" :key="position.positionId" :value="position.positionId">{{ position.label }}</option>
            <option :value="ADVANCED_TARGET">Advanced: enter a stable position ID</option>
          </select></label>
          <label v-if="spritePositionChoice === ADVANCED_TARGET" class="advanced-target">Stable position ID <input data-testid="sprite-position-id" v-model="spritePositionId" spellcheck="false" /></label>
          <button type="button" :disabled="editorBusy" @click="addPlayerSprite">Choose PNG or GIF…</button>
        </div>
        <div class="asset-row-table" aria-label="Player sprite upload rows">
          <div class="asset-row asset-row-head"><strong>Position</strong><strong>Home</strong><strong>Away</strong></div>
          <div v-for="position in knownPositions" :key="position.positionId" class="asset-row">
            <span>{{ position.label }}</span>
            <button type="button" :disabled="editorBusy" @click="addPlayerSpriteFor('home', position.positionId)">Upload…</button>
            <button type="button" :disabled="editorBusy" @click="addPlayerSpriteFor('away', position.positionId)">Upload…</button>
          </div>
        </div>
      </details>
      <details open>
        <summary>Walk sheets (optional)</summary>
        <div class="target-grid">
          <span>Use the player-sprite team and position target above.</span>
          <button type="button" :disabled="editorBusy" @click="addWalkSheetFor('any')">Choose walk sheet PNG…</button>
        </div>
        <div class="asset-row-table" aria-label="Walk sheet upload rows">
          <div class="asset-row asset-row-head"><strong>Position</strong><strong>Home</strong><strong>Away</strong></div>
          <div v-for="position in knownPositions" :key="position.positionId" class="asset-row">
            <span>{{ position.label }}</span>
            <button type="button" :disabled="editorBusy" @click="addWalkSheetFor('home', position.positionId)">Upload…</button>
            <button type="button" :disabled="editorBusy" @click="addWalkSheetFor('away', position.positionId)">Upload…</button>
          </div>
        </div>
      </details>
      <details open>
        <summary>Skill icons</summary>
        <div class="target-grid">
          <label>Skill <select data-testid="skill-select" :value="skillChoice" @change="chooseSkill">
            <option v-for="choice in SKILL_TARGET_CHOICES" :key="choice.id" :value="choice.id">{{ choice.label }}</option>
            <option :value="ADVANCED_TARGET">Advanced: enter a canonical skill ID</option>
          </select></label>
          <label v-if="skillChoice === ADVANCED_TARGET" class="advanced-target">Canonical skill ID <input data-testid="skill-id" v-model="skill" spellcheck="false" /></label>
          <!-- Owner 09-10: the per-position skill-icon target is cut from the builder — icons bind to the skill (any position). -->
          <label>Side <select v-model="skillSide"><option value="any">Any</option><option value="home">Home</option><option value="away">Away</option></select></label>
          <button type="button" :disabled="editorBusy" @click="addSkillIcon">Choose PNG or GIF…</button>
        </div>
        <div class="asset-row-table skill-row-table" aria-label="Skill icon upload rows">
          <div class="asset-row asset-row-head"><strong>Skill</strong><strong>Target</strong><strong>Icon</strong></div>
          <div v-for="choice in SKILL_TARGET_CHOICES" :key="choice.id" class="asset-row">
            <span>{{ choice.label }}</span>
            <small>{{ skillSide }}</small>
            <button type="button" :disabled="editorBusy" @click="addSkillIconFor(choice.id)">Upload…</button>
          </div>
        </div>
      </details>
      <details open>
        <summary>Sounds</summary>
        <div class="target-grid">
          <label>Event <select v-model="soundEventId"><option v-for="sound in SOUND_CATALOG" :key="sound.id" :value="sound.id">{{ sound.label }}</option></select></label>
          <button type="button" :disabled="editorBusy" @click="addSound">Choose OGG, WAV, or MP3…</button>
          <button v-if="!props.builderMode" type="button" @click="previewSound(soundEventId)">Preview active sound</button>
        </div>
        <div class="asset-row-table sound-row-table" aria-label="Sound event upload rows">
          <div class="asset-row asset-row-head"><strong>Event</strong><strong>Preview</strong><strong>File</strong></div>
          <div v-for="sound in SOUND_CATALOG" :key="sound.id" class="asset-row">
            <span>{{ sound.label }}</span>
            <button v-if="!props.builderMode" type="button" @click="previewSound(sound.id)">Play</button>
            <span v-else class="builder-preview-note">Preview after upload</span>
            <button type="button" :disabled="editorBusy" @click="addSoundFor(sound.id)">Upload…</button>
          </div>
        </div>
      </details>
      <details open>
        <summary>Pitches</summary>
        <p class="hint">One pitch can cover any combination of weather states. It is normalized to the renderer's 782×452 pitch canvas.</p>
        <div class="target-grid">
          <label>Pitch family <select v-model="pitchThemeId">
            <option value="fumbbl-default">Default</option>
            <option value="fumbbl-basic">Basic</option>
            <option value="fumbbl-blackbox">Blackbox</option>
            <option value="fumbbl-fumbblcup">Cup</option>
            <option value="fumbbl-chaos">Chaos</option>
            <option value="fumbbl-darkelf">Dark Elf</option>
            <option value="fumbbl-goblin">Goblin</option>
            <option value="fumbbl-khorne">Khorne</option>
            <option value="fumbbl-necromantic">Necromantic</option>
            <option value="fumbbl-norse">Norse</option>
            <option value="fumbbl-nurgle">Nurgle</option>
            <option value="fumbbl-skaven">Skaven</option>
            <option value="fumbbl-slaanesh">Slaanesh</option>
            <option value="fumbbl-tzeentch">Tzeentch</option>
            <option value="fumbbl-vampire">Vampire</option>
          </select></label>
          <fieldset class="weather-checks">
            <legend>Weather</legend>
            <label v-for="weather in weatherChoices" :key="weather.id">
              <input v-model="pitchWeathers" type="checkbox" :value="weather.id" /> {{ weather.label }}
            </label>
          </fieldset>
          <button type="button" :disabled="editorBusy || !pitchWeathers.length" @click="addPitch">Choose pitch PNG or GIF…</button>
        </div>
      </details>

      <div class="draft-items">
        <article v-for="item in draft.items" :key="item.bindingId">
          <img v-if="item.mime.startsWith('image/')" :src="item.previewUrl" alt="" />
          <audio v-else :src="item.previewUrl" controls preload="metadata" />
          <span><strong>{{ item.kind }}</strong><br />{{ targetLabel(item) }}<br /><small>{{ formatPackSize(item.sizeBytes) }}</small></span>
          <button type="button" @click="removeItem(item)">Remove</button>
        </article>
      </div>

      <div v-for="section in exportSections" :key="section.key" class="publish-row">
        <span>{{ section.label }}</span>
        <button v-if="!props.builderMode" type="button" :disabled="editorBusy" @click="applySection(section.key)">Apply now</button>
        <button type="button" :disabled="editorBusy" @click="exportSection(section.key)">Export .f40kmod…</button>
      </div>
    </template>
    <p v-if="editorBusy" class="hint" role="status">Working…</p>
    <div v-if="importedPack" class="import-apply-prompt" role="status" aria-live="polite">
      <span>{{ importedPack.name }} {{ importedPack.version }} installed. Apply it now for {{ importedPackCapabilities.join(', ') }}?</span>
      <button type="button" class="import-apply-yes" :disabled="editorBusy" @click="applyImportedPack">Apply</button>
      <button type="button" class="import-apply-no" :disabled="editorBusy" @click="dismissImportedPack">Not now</button>
    </div>
    <p v-if="editorNotice" class="hint asset-pack-ok" role="status">{{ editorNotice }}</p>
    <p v-if="editorError || assetMods.error" class="hint asset-pack-error" role="alert">{{ editorError || assetMods.error }}</p>
  </fieldset>
</template>

<style scoped>
.import-apply-prompt{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;padding:.5rem .65rem;border:1px solid var(--ui-accent);border-radius:8px;background:color-mix(in srgb,var(--ui-accent) 12%,var(--ui-surface-2))}
.import-apply-prompt span{flex:1 1 220px}
.asset-pack-settings{display:grid;gap:.55rem}.asset-pack-settings .row{align-items:center}.asset-pack-settings select{min-width:min(320px,55vw)}
.draft-toolbar,.target-grid,.publish-row,.pack-card{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}.draft-toolbar input{min-width:180px}.target-grid label{display:flex;gap:5px;align-items:center}.pack-card,.publish-row{padding:7px;border:1px solid var(--ui-border);border-radius:5px}.pack-card span:first-child,.publish-row span{flex:1}.draft-items{display:grid;gap:7px;margin:10px 0}.draft-items article{display:grid;grid-template-columns:56px 1fr auto;gap:8px;align-items:center;padding:6px;border:1px solid var(--ui-border);border-radius:5px}.draft-items img{width:52px;height:52px;object-fit:contain;image-rendering:pixelated}.draft-items audio{width:180px;max-width:100%}.asset-pack-ok{color:#62c47b}.asset-pack-error{color:#ff7070}
.advanced-target{padding:4px 6px;border:1px dashed var(--ui-border);border-radius:4px}
.asset-row-table{display:grid;max-height:260px;overflow:auto;border:1px solid var(--ui-border);border-radius:5px;margin:8px 0}.asset-row{display:grid;grid-template-columns:minmax(170px,1fr) minmax(90px,auto) minmax(90px,auto);gap:8px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--ui-border)}.asset-row:last-child{border-bottom:0}.asset-row-head{position:sticky;top:0;z-index:1;background:var(--ui-panel,#171717)}.asset-row button{justify-self:stretch}.weather-checks{display:flex;gap:8px;flex-wrap:wrap;border:1px solid var(--ui-border);border-radius:5px}.weather-checks label{white-space:nowrap}
.asset-validator{display:grid;gap:.6rem}.validated-pack{display:grid;overflow-wrap:anywhere}.builder-preview-note{font-size:.78rem;color:var(--ui-muted,#a8a8a8)}
</style>
