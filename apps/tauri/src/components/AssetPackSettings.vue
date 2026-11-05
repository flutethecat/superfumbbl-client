<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { open, save } from '@tauri-apps/plugin-dialog';
import { settings } from '../game/settings';
import ConfiguredAssetsBrowser from './ConfiguredAssetsBrowser.vue';
import { SOUND_CATALOG, previewSound } from '../game/sounds';
import {
  assetTargetPositionLabel,
  assetTargetTeamLabel,
  loadAssetTargetCatalog,
  rememberAssetTargetCatalog,
  SKILL_TARGET_CHOICES,
} from '../game/assetModUi';
import {
  applyAssetDraft,
  assertNever,
  assetMods,
  beginAssetAssignmentIntent,
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
import { ASSET_ASSIGNMENT_CAPABILITIES, publishAssetAssignments, useWholeAssetPack } from '../game/assetPackActions';
import { $t, terms, useLiveSet } from '../i18n';
/** i18n live-switch registrations owned by this component (released on unmount; src/i18n LIVE-SWITCH POLICY). */
const liveSetHere = useLiveSet();
import { t } from '../i18n';

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
  { id: 'nice', get label() { return t('settings.assetPackSettings.weatherChoices.nice'); } },
  { id: 'rain', get label() { return t('settings.assetPackSettings.weatherChoices.rain'); } },
  { id: 'sunny', get label() { return t('settings.assetPackSettings.weatherChoices.verySunny'); } },
  { id: 'blizzard', get label() { return t('settings.assetPackSettings.weatherChoices.blizzard'); } },
  { id: 'heat', get label() { return t('settings.assetPackSettings.weatherChoices.swelteringHeat'); } },
] as const;

const capabilities = ASSET_ASSIGNMENT_CAPABILITIES; // owner 10-06: shared with the first-launch setup wizard
const exportSections: Array<{ key: AssetPackSection; label: string }> = [
  { key: 'player-sprites', get label() { return t('settings.assetPackSettings.exportSections.spritesOnly'); } },
  { key: 'walk-sheets', get label() { return t('settings.assetPackSettings.exportSections.walkSheetsOnly'); } },
  { key: 'sound-events', get label() { return t('settings.assetPackSettings.exportSections.soundsOnly'); } },
  { key: 'team-logos', get label() { return t('settings.assetPackSettings.exportSections.teamLogosOnly'); } },
  { key: 'block-dice', get label() { return t('settings.assetPackSettings.exportSections.blockDiceOnly'); } },
  { key: 'skill-icons', get label() { return t('settings.assetPackSettings.exportSections.skillIconsOnly'); } },
  { key: 'pitch-images', get label() { return t('settings.assetPackSettings.exportSections.pitchesOnly'); } },
  { key: 'combined', get label() { return t('settings.assetPackSettings.exportSections.combinedPack'); } },
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
    liveSetHere(editorNotice, 'value', () => t('ui.assetPackSettings.text.draftNameSavedPick', { name: draft.value!.name }));
  });
}

async function removeDraft(): Promise<void> {
  if (!draft.value || !window.confirm(t('ui.assetPackSettings.text.deleteDraftNameInstalled', { name: draft.value.name }))) return;
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
  return publishAssetAssignments(next, intent);
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
      liveSetHere(editorNotice, 'value', () => t('ui.assetPackSettings.text.nameVersionApplied', { name: pack.name, version: pack.version }));
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
    liveSetHere(editorNotice, 'value', () => t('ui.assetPackSettings.text.nameVersionExportedP2', { name: exported.name, version: exported.version, p2: formatPackSize(exported.sizeBytes) }));
  });
}

/** Owner 09-09: the skill-icon slot offers a second BUNDLED family, "Illustrated - Default", beside "Built-in
 *  default". Both are pack-less (assignment ''); the family choice lives in `settings.skillBadgeFamily`. */
const ILLUSTRATED_BUILTIN = 'builtin:illustrated';
/** Owner 10-06: the block-dice slot likewise offers "Rick dice (built-in)" (Kristofer Bengtsson's faces) beside "Built-in
 *  default"; pack-less (assignment ''), the family lives in `settings.blockDiceFamily`. An installed pack still wins
 *  over the family, so picking one leaves the family alone. */
const KRISB_BUILTIN = 'builtin:krisb';
/** Owner 11-04: and "FUMBBL dice (built-in)" (WhatBall's FUMBBL block dice), the same way. */
const FUMBBL_BUILTIN = 'builtin:fumbbl';
function assignmentSelectValue(capability: AssetAssignmentCapability): string {
  const id = settings.assetPackAssignments[capability];
  if (capability === 'blockDice' && id === '' && settings.blockDiceFamily === 'krisb') return KRISB_BUILTIN;
  if (capability === 'blockDice' && id === '' && settings.blockDiceFamily === 'fumbbl') return FUMBBL_BUILTIN;
  return capability === 'skillIcons' && id === '' && settings.skillBadgeFamily === 'illustrated' ? ILLUSTRATED_BUILTIN : id;
}
async function changeAssignment(capability: AssetAssignmentCapability, event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value;
  const builtin = value === ILLUSTRATED_BUILTIN || value === KRISB_BUILTIN || value === FUMBBL_BUILTIN;
  const next = { ...settings.assetPackAssignments, [capability]: builtin ? '' : value };
  if (!await publishAssignments(next)) { editorError.value = assetMods.error; return; }
  if (capability === 'skillIcons') settings.skillBadgeFamily = builtin ? 'illustrated' : 'default';
  if (capability === 'blockDice') {
    if (value === KRISB_BUILTIN) settings.blockDiceFamily = 'krisb';
    else if (value === FUMBBL_BUILTIN) settings.blockDiceFamily = 'fumbbl';
    else if (value === '') settings.blockDiceFamily = 'default';
  }
}

async function useAll(pack: InstalledAssetPack): Promise<void> {
  if (!isAssignableAssetPack(pack)) return;
  if (!await useWholeAssetPack(pack)) editorError.value = assetMods.error;
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
  if (value === 'cleared') return t('ui.assetPackSettings.text.redistributionCleared');
  if (value === 'owner-authorized-external-mod') return t('ui.assetPackSettings.text.ownerAuthorizedExternalMod');
  if (value === 'tester-approved-public-review-required') return t('ui.assetPackSettings.text.testerApprovedPublicReview');
  return t('ui.assetPackSettings.text.localUseOnly');
}

async function removePack(pack: InstalledAssetPack): Promise<void> {
  if (!window.confirm(t('ui.assetPackSettings.text.removeNameVersionFrom', { name: pack.name, version: pack.version }))) return;
  await run(async () => {
    if (await removeInstalledAssetPack(pack.installId)) liveSetHere(editorNotice, 'value', () => t('ui.assetPackSettings.text.nameVersionRemoved', { name: pack.name, version: pack.version }));
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
    liveSetHere(editorNotice, 'value', () => importedPack.value ? '' : t('ui.assetPackSettings.text.nameInstalledChooseCapabilities', { name: pack.name }));
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
  if (!editorError.value) liveSetHere(editorNotice, 'value', () => t('ui.assetPackSettings.text.nameVersionApplied', { name: pack.name, version: pack.version }));
}
function dismissImportedPack(): void {
  const pack = importedPack.value;
  importedPack.value = null;
  if (pack) liveSetHere(editorNotice, 'value', () => t('ui.assetPackSettings.text.nameInstalledChooseCapabilities', { name: pack.name }));
}

async function validateExistingPack(): Promise<void> {
  await run(async () => {
    const path = await choosePath(['f40kmod'], 'F40KMod asset pack');
    if (!path) return;
    validatedPack.value = await inspectAssetPackFile(path);
    const { name, version } = validatedPack.value;
    liveSetHere(editorNotice, 'value', () => t('ui.assetPackSettings.text.nameVersionIsA', { name, version }));
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
    <legend>{{ $t('settings.assetPacks.assetPacks.assetPacks') }}</legend>
    <p class="hint">{{ $t('settings.assetPacks.assetPacks.eachCategoryCanUse') }}</p>
    <p class="hint asset-pack-immediate">{{ $t('settings.assetPacks.assetPacks.activePackChoicesFollow') }}</p>
    <label v-for="capability in capabilities" :key="capability.key" class="row">
      <span>{{ capability.label }}</span>
      <select :value="assignmentSelectValue(capability.key)" :disabled="!!assetMods.pendingAssignments"
        @change="changeAssignment(capability.key, $event)">
        <option value="">{{ capability.key === 'skillIcons' ? $t('settings.assetPacks.assetPacks.flatBadgesBuiltIn') : $t('settings.assetPacks.assetPacks.builtInDefault') }}</option>
        <option v-if="capability.key === 'skillIcons'" :value="ILLUSTRATED_BUILTIN">{{ $t('settings.assetPacks.assetPacks.illustratedBuiltInDefault') }}</option>
        <option v-if="capability.key === 'blockDice'" :value="KRISB_BUILTIN">{{ $t('settings.assetPacks.assetPacks.rickDiceBuiltIn') }}</option>
        <option v-if="capability.key === 'blockDice'" :value="FUMBBL_BUILTIN">{{ $t('settings.assetPacks.assetPacks.fumbblDiceBuiltIn') }}</option>
        <option v-for="pack in installedPacks.filter((candidate) => packSupports(candidate, capability.key))"
          :key="pack.installId" :value="pack.installId">{{ pack.name }} {{ pack.version }}</option>
      </select>
    </label>
    <div class="actions"><button type="button" :disabled="assetMods.busy || editorBusy" @click="importPack">{{ $t('settings.assetPacks.assetPacks.importF40kmod') }}</button></div>
    <div v-for="pack in installedPacks" :key="pack.installId" class="pack-card">
      <span><strong>{{ pack.name }}</strong> {{ pack.version }} · {{ formatPackSize(pack.sizeBytes) }}</span>
      <span>{{ pack.verifiedPublisher ? $t('settings.assetPacks.packCard.assetPacks.verifiedPublisher') : $t('settings.assetPacks.packCard.assetPacks.unverifiedLocalPack') }} · {{ pack.source }}</span>
      <span>{{ redistributionLabel(pack.redistribution) }}</span>
      <span>{{ pack.capabilities.map((capability) => `${capability}: ${capabilityCoverage(pack, capability)}`).join(' · ') }}</span>
      <button type="button" :disabled="!!assetMods.pendingAssignments" @click="useAll(pack)">
        {{ isRollbackVersion(pack) ? $t('settings.assetPacks.packCard.assetPacks.rollbackToThisVersion') : $t('settings.assetPacks.packCard.assetPacks.useAllIncluded') }}
      </button>
      <button type="button" :disabled="selectedPackIds.has(pack.installId) || editorBusy"
        :title="selectedPackIds.has(pack.installId) ? $t('settings.assetPacks.packCard.assetPacks.chooseAnotherPackBefore') : $t('settings.assetPacks.packCard.assetPacks.removeThisInstalledPack')"
        @click="removePack(pack)">{{ $t('settings.assetPacks.packCard.assetPacks.remove') }}</button>
      <small v-if="activePackIds.has(pack.installId)">{{ $t('settings.assetPacks.packCard.assetPacks.inUse') }}</small>
      <small v-else-if="selectedPackIds.has(pack.installId)">{{ $t('settings.assetPacks.packCard.assetPacks.selectedNotActiveThis') }}</small>
      <small v-else-if="isAssetPackLeased(pack.installId)">{{ $t('settings.assetPacks.packCard.assetPacks.finishingPreviousDisplay') }}</small>
    </div>
  </fieldset>

  <fieldset v-else class="settings-group asset-validator">
    <legend>{{ $t('settings.assetPacks.validateAnExisting.validateAnExistingPack') }}</legend>
    <p class="hint">{{ $t('settings.assetPacks.validateAnExisting.inspectAF40kmodWithout') }}</p>
    <div class="actions"><button type="button" :disabled="editorBusy" @click="validateExistingPack">{{ $t('settings.assetPacks.validateAnExisting.validateF40kmod') }}</button></div>
    <div v-if="validatedPack" class="pack-card validated-pack" role="status">
      <strong>{{ validatedPack.name }} {{ validatedPack.version }}</strong>
      <span>{{ validatedPack.packId }}</span>
      <span>{{ $t('settings.assetPacks.packCard.validateAnExisting.p0Sha256Wholepacksha256', { p0: formatPackSize(validatedPack.sizeBytes), wholePackSha256: validatedPack.wholePackSha256 }) }}</span>
      <span>{{ validatedCoverage(validatedPack) }}</span>
    </div>
  </fieldset>

  <ConfiguredAssetsBrowser v-if="!props.builderMode" :target-catalog="targetCatalog" />

  <fieldset class="settings-group asset-creator">
    <legend>{{ $t('settings.assetPacks.assetPackCreator.assetPackCreator') }}</legend>
    <p class="hint">{{ $t('settings.assetPacks.assetPackCreator.buildOnePortablePack') }}</p>
    <div class="draft-toolbar">
      <select :value="draft?.draftId ?? ''" @change="selectDraft">
        <option value="">{{ $t('settings.assetPacks.assetPackCreator.chooseADraft') }}</option>
        <option v-for="entry in drafts" :key="entry.draftId" :value="entry.draftId">{{ entry.name }} ({{ entry.bindings }})</option>
      </select>
      <input v-model="draftName" maxlength="120" :placeholder="$t('settings.assetPacks.assetPackCreator.packName')" />
      <button type="button" :disabled="editorBusy" @click="newDraft">{{ $t('settings.assetPacks.assetPackCreator.new') }}</button>
      <button type="button" class="save-draft" :disabled="!draft || editorBusy" @click="saveDraft">{{ $t('settings.assetPacks.assetPackCreator.saveDraft') }}</button>
      <button type="button" :disabled="!draft || editorBusy" @click="removeDraft">{{ $t('settings.assetPacks.assetPackCreator.deleteDraft') }}</button>
    </div>

    <template v-if="draft">
      <label class="row"><span>{{ $t('settings.assetPacks.assetPackCreator.imageScaling') }}</span><select v-model="scaling"><option value="nearest">{{ $t('settings.assetPacks.assetPackCreator.pixelArtNearest') }}</option><option value="linear">{{ $t('settings.assetPacks.assetPackCreator.smoothLinear') }}</option></select></label>
      <p class="hint">{{ $t('settings.assetPacks.assetPackCreator.pngFilesCanBe') }}</p>
      <details open>
        <summary>{{ $t('settings.assetPacks.assetPackCreator.playerSprites') }}</summary>
        <p class="hint">{{ $t('settings.assetPacks.assetPackCreator.chooseATeamAnd') }}</p>
        <div class="target-grid">
          <label>{{ $t('settings.assetPacks.assetPackCreator.team') }} <select data-testid="sprite-team-select" :value="spriteTeamChoice" @change="chooseSpriteTeam">
            <option v-for="team in knownTeams" :key="team.teamId" :value="team.teamId">{{ assetTargetTeamLabel(team) }}</option>
            <option :value="ADVANCED_TARGET">{{ $t('settings.assetPacks.assetPackCreator.advancedEnterAStable') }}</option>
          </select></label>
          <label v-if="spriteTeamChoice === ADVANCED_TARGET" class="advanced-target">{{ $t('settings.assetPacks.assetPackCreator.stableTeamId') }} <input data-testid="sprite-team-id" v-model="spriteTeamId" spellcheck="false" /></label>
          <label>{{ $t('settings.assetPacks.assetPackCreator.position') }} <select data-testid="sprite-position-select" :value="spritePositionChoice" @change="chooseSpritePosition">
            <option v-for="position in knownPositions" :key="position.positionId" :value="position.positionId">{{ assetTargetPositionLabel(position) }}</option>
            <option :value="ADVANCED_TARGET">{{ $t('settings.assetPacks.assetPackCreator.advancedEnterAStable2') }}</option>
          </select></label>
          <label v-if="spritePositionChoice === ADVANCED_TARGET" class="advanced-target">{{ $t('settings.assetPacks.assetPackCreator.stablePositionId') }} <input data-testid="sprite-position-id" v-model="spritePositionId" spellcheck="false" /></label>
          <button type="button" :disabled="editorBusy" @click="addPlayerSprite">{{ $t('settings.assetPacks.assetPackCreator.choosePngOrGif') }}</button>
        </div>
        <div class="asset-row-table" :aria-label="$t('settings.assetPacks.assetPackCreator.playerSpriteUploadRows')">
          <div class="asset-row asset-row-head"><strong>{{ $t('settings.assetPacks.assetRow.assetPackCreator.position') }}</strong><strong>{{ $t('settings.assetPacks.assetRow.assetPackCreator.home') }}</strong><strong>{{ $t('settings.assetPacks.assetRow.assetPackCreator.away') }}</strong></div>
          <div v-for="position in knownPositions" :key="position.positionId" class="asset-row">
            <span>{{ assetTargetPositionLabel(position) }}</span>
            <button type="button" :disabled="editorBusy" @click="addPlayerSpriteFor('home', position.positionId)">{{ $t('settings.assetPacks.assetRow.assetPackCreator.upload') }}</button>
            <button type="button" :disabled="editorBusy" @click="addPlayerSpriteFor('away', position.positionId)">{{ $t('settings.assetPacks.assetRow.assetPackCreator.upload') }}</button>
          </div>
        </div>
      </details>
      <details open>
        <summary>{{ $t('settings.assetPacks.assetPackCreator.walkSheetsOptional') }}</summary>
        <div class="target-grid">
          <span>{{ $t('settings.assetPacks.assetPackCreator.useThePlayerSprite') }}</span>
          <button type="button" :disabled="editorBusy" @click="addWalkSheetFor('any')">{{ $t('settings.assetPacks.assetPackCreator.chooseWalkSheetPng') }}</button>
        </div>
        <div class="asset-row-table" :aria-label="$t('settings.assetPacks.assetPackCreator.walkSheetUploadRows')">
          <div class="asset-row asset-row-head"><strong>{{ $t('settings.assetPacks.assetRow.assetPackCreator.position') }}</strong><strong>{{ $t('settings.assetPacks.assetRow.assetPackCreator.home') }}</strong><strong>{{ $t('settings.assetPacks.assetRow.assetPackCreator.away') }}</strong></div>
          <div v-for="position in knownPositions" :key="position.positionId" class="asset-row">
            <span>{{ assetTargetPositionLabel(position) }}</span>
            <button type="button" :disabled="editorBusy" @click="addWalkSheetFor('home', position.positionId)">{{ $t('settings.assetPacks.assetRow.assetPackCreator.upload') }}</button>
            <button type="button" :disabled="editorBusy" @click="addWalkSheetFor('away', position.positionId)">{{ $t('settings.assetPacks.assetRow.assetPackCreator.upload') }}</button>
          </div>
        </div>
      </details>
      <details open>
        <summary>{{ $t('settings.assetPacks.assetPackCreator.skillIcons') }}</summary>
        <div class="target-grid">
          <label>{{ $t('settings.assetPacks.assetPackCreator.skill') }} <select data-testid="skill-select" :value="skillChoice" @change="chooseSkill">
            <option v-for="choice in SKILL_TARGET_CHOICES" :key="choice.id" :value="choice.id">{{ choice.label }}</option>
            <option :value="ADVANCED_TARGET">{{ $t('settings.assetPacks.assetPackCreator.advancedEnterACanonical') }}</option>
          </select></label>
          <label v-if="skillChoice === ADVANCED_TARGET" class="advanced-target">{{ $t('settings.assetPacks.assetPackCreator.canonicalSkillId') }} <input data-testid="skill-id" v-model="skill" spellcheck="false" /></label>
          <!-- Owner 09-10: the per-position skill-icon target is cut from the builder — icons bind to the skill (any position). -->
          <label>{{ $t('settings.assetPacks.assetPackCreator.side') }} <select v-model="skillSide"><option value="any">{{ $t('settings.assetPacks.assetPackCreator.any') }}</option><option value="home">{{ $t('settings.assetPacks.assetPackCreator.home') }}</option><option value="away">{{ $t('settings.assetPacks.assetPackCreator.away') }}</option></select></label>
          <button type="button" :disabled="editorBusy" @click="addSkillIcon">{{ $t('settings.assetPacks.assetPackCreator.choosePngOrGif') }}</button>
        </div>
        <div class="asset-row-table skill-row-table" :aria-label="$t('settings.assetPacks.assetPackCreator.skillIconUploadRows')">
          <div class="asset-row asset-row-head"><strong>{{ $t('settings.assetPacks.assetRow.assetPackCreator.skill') }}</strong><strong>{{ $t('settings.assetPacks.assetRow.assetPackCreator.target') }}</strong><strong>{{ $t('settings.assetPacks.assetRow.assetPackCreator.icon') }}</strong></div>
          <div v-for="choice in SKILL_TARGET_CHOICES" :key="choice.id" class="asset-row">
            <span>{{ choice.label }}</span>
            <small>{{ skillSide }}</small>
            <button type="button" :disabled="editorBusy" @click="addSkillIconFor(choice.id)">{{ $t('settings.assetPacks.assetRow.assetPackCreator.upload') }}</button>
          </div>
        </div>
      </details>
      <details open>
        <summary>{{ $t('settings.assetPacks.assetPackCreator.sounds') }}</summary>
        <div class="target-grid">
          <label>{{ $t('settings.assetPacks.assetPackCreator.event') }} <select v-model="soundEventId"><option v-for="sound in SOUND_CATALOG" :key="sound.id" :value="sound.id">{{ sound.label }}</option></select></label>
          <button type="button" :disabled="editorBusy" @click="addSound">{{ $t('settings.assetPacks.assetPackCreator.chooseOggWavOr') }}</button>
          <button v-if="!props.builderMode" type="button" @click="previewSound(soundEventId)">{{ $t('settings.assetPacks.assetPackCreator.previewActiveSound') }}</button>
        </div>
        <div class="asset-row-table sound-row-table" :aria-label="$t('settings.assetPacks.assetPackCreator.soundEventUploadRows')">
          <div class="asset-row asset-row-head"><strong>{{ $t('settings.assetPacks.assetRow.assetPackCreator.event') }}</strong><strong>{{ $t('settings.assetPacks.assetRow.assetPackCreator.preview') }}</strong><strong>{{ $t('settings.assetPacks.assetRow.assetPackCreator.file') }}</strong></div>
          <div v-for="sound in SOUND_CATALOG" :key="sound.id" class="asset-row">
            <span>{{ sound.label }}</span>
            <button v-if="!props.builderMode" type="button" @click="previewSound(sound.id)">{{ $t('settings.assetPacks.assetRow.assetPackCreator.play') }}</button>
            <span v-else class="builder-preview-note">{{ $t('settings.assetPacks.assetRow.assetPackCreator.previewAfterUpload') }}</span>
            <button type="button" :disabled="editorBusy" @click="addSoundFor(sound.id)">{{ $t('settings.assetPacks.assetRow.assetPackCreator.upload') }}</button>
          </div>
        </div>
      </details>
      <details open>
        <summary>{{ $t('settings.assetPacks.assetPackCreator.pitches') }}</summary>
        <p class="hint">{{ $t('settings.assetPacks.assetPackCreator.onePitchCanCover') }}</p>
        <div class="target-grid">
          <label>{{ $t('settings.assetPacks.assetPackCreator.pitchFamily') }} <select v-model="pitchThemeId">
            <option value="fumbbl-default">{{ $t('settings.assetPacks.assetPackCreator.default') }}</option>
            <option value="fumbbl-basic">{{ $t('settings.assetPacks.assetPackCreator.basic') }}</option>
            <option value="fumbbl-blackbox">{{ $t('settings.assetPacks.assetPackCreator.blackbox') }}</option>
            <option value="fumbbl-fumbblcup">{{ $t('settings.assetPacks.assetPackCreator.cup') }}</option>
            <option value="fumbbl-chaos">{{ $t('settings.assetPacks.assetPackCreator.chaos') }}</option>
            <option value="fumbbl-darkelf">{{ $t('settings.assetPacks.assetPackCreator.darkElf') }}</option>
            <option value="fumbbl-goblin">{{ $t('settings.assetPacks.assetPackCreator.goblin') }}</option>
            <option value="fumbbl-khorne">{{ $t('settings.assetPacks.assetPackCreator.khorne') }}</option>
            <option value="fumbbl-necromantic">{{ $t('settings.assetPacks.assetPackCreator.necromantic') }}</option>
            <option value="fumbbl-norse">{{ $t('settings.assetPacks.assetPackCreator.norse') }}</option>
            <option value="fumbbl-nurgle">{{ $t('settings.assetPacks.assetPackCreator.nurgle') }}</option>
            <option value="fumbbl-skaven">{{ $t('settings.assetPacks.assetPackCreator.skaven') }}</option>
            <option value="fumbbl-slaanesh">{{ $t('settings.assetPacks.assetPackCreator.slaanesh') }}</option>
            <option value="fumbbl-tzeentch">{{ $t('settings.assetPacks.assetPackCreator.tzeentch') }}</option>
            <option value="fumbbl-vampire">{{ $t('settings.assetPacks.assetPackCreator.vampire') }}</option>
          </select></label>
          <fieldset class="weather-checks">
            <legend>{{ $t('settings.assetPacks.weather.weather') }}</legend>
            <label v-for="weather in weatherChoices" :key="weather.id">
              <input v-model="pitchWeathers" type="checkbox" :value="weather.id" /> {{ terms(weather.label) }}
            </label>
          </fieldset>
          <button type="button" :disabled="editorBusy || !pitchWeathers.length" @click="addPitch">{{ $t('settings.assetPacks.assetPackCreator.choosePitchPngOr') }}</button>
        </div>
      </details>

      <div class="draft-items">
        <article v-for="item in draft.items" :key="item.bindingId">
          <img v-if="item.mime.startsWith('image/')" :src="item.previewUrl" alt="" />
          <audio v-else :src="item.previewUrl" controls preload="metadata" />
          <span><strong>{{ item.kind }}</strong><br />{{ targetLabel(item) }}<br /><small>{{ formatPackSize(item.sizeBytes) }}</small></span>
          <button type="button" @click="removeItem(item)">{{ $t('settings.assetPacks.assetPackCreator.remove') }}</button>
        </article>
      </div>

      <div v-for="section in exportSections" :key="section.key" class="publish-row">
        <span>{{ section.label }}</span>
        <button v-if="!props.builderMode" type="button" :disabled="editorBusy" @click="applySection(section.key)">{{ $t('settings.assetPacks.publishRow.assetPackCreator.applyNow') }}</button>
        <button type="button" :disabled="editorBusy" @click="exportSection(section.key)">{{ $t('settings.assetPacks.publishRow.assetPackCreator.exportF40kmod') }}</button>
      </div>
    </template>
    <p v-if="editorBusy" class="hint" role="status">{{ $t('settings.assetPacks.assetPackCreator.working') }}</p>
    <div v-if="importedPack" class="import-apply-prompt" role="status" aria-live="polite">
      <span>{{ $t('settings.assetPacks.importApplyPrompt.assetPackCreator.nameVersionInstalledApply', { name: importedPack.name, version: importedPack.version, p2: importedPackCapabilities.join(', ') }) }}</span>
      <button type="button" class="import-apply-yes" :disabled="editorBusy" @click="applyImportedPack">{{ $t('settings.assetPacks.importApplyPrompt.assetPackCreator.apply') }}</button>
      <button type="button" class="import-apply-no" :disabled="editorBusy" @click="dismissImportedPack">{{ $t('settings.assetPacks.importApplyPrompt.assetPackCreator.notNow') }}</button>
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
