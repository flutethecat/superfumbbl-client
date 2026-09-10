import { reactive } from 'vue';
import {
  activateAssetPresentationPack,
  activateSkillIconPack,
  canonicalSkillIconKey,
  commitWalkSheets,
  prepareWalkSheets,
  PitchRenderer,
  setFumbblPitchFallbacks,
  supersedeAssetPresentationIntent,
  waitForAssetPresentationRetirement,
  waitForWalkSheetRetirement,
  type PreparedWalkSheets,
  type PlayerSpriteBinding,
  type SkillIconBinding,
  type WalkSheetBindingTransport,
  type WalkSheetSpecTransport,
} from '@fumbbl40k/ffb-pitch';
import { activateSoundEventPack, prepareSoundEventPack, waitForSoundUrlsRetirement } from './sounds';
import { setLocalFumbblLogoBindings, setSelectedLocalFumbblAssetBindings } from './fumbblAssetCache';
import {
  completeV26UserOverrideMigration,
  takeV26UserOverrideMigration,
  type V26UserOverrideMigration,
} from './settings';

export const USER_FILES_INSTALL_ID = '596f757246696c657300000000000001';
export const USER_FILES_DRAFT_ID = USER_FILES_INSTALL_ID;

export type AssetPackSection = 'skill-icons' | 'player-sprites' | 'walk-sheets' | 'sound-events' | 'team-logos' | 'block-dice' | 'pitch-images' | 'combined';
export type AssetAssignmentCapability = 'skillIcons' | 'playerSprites' | 'walkSheets' | 'soundEvents' | 'teamLogos' | 'blockDice';
export type AssetPackAssignments = Record<AssetAssignmentCapability, string>;
export const EMPTY_ASSET_PACK_ASSIGNMENTS: AssetPackAssignments = {
  skillIcons: '', playerSprites: '', walkSheets: '', soundEvents: '', teamLogos: '', blockDice: '',
};

export interface InstalledAssetPack {
  installId: string;
  packId: string;
  version: string;
  name: string;
  source: string;
  redistribution: 'local-unverified' | 'owner-authorized-external-mod' | 'tester-approved-public-review-required' | 'cleared';
  verifiedPublisher: boolean;
  sizeBytes: number;
  capabilities: string[];
  coverage: Record<string, number>;
  skillIcons: Record<string, string>;
  classicImageBindings?: Record<string, string>;
  /** `fumbbl-id-images` only (team logos), served from any installed pack. */
  logoImageBindings?: Record<string, string>;
  blockDiceBindings?: Record<string, string>;
  pitchImageBindings?: Record<string, string>;
  capabilityVersions?: Record<string, number>;
  skillIconBindings?: SkillIconBinding[];
  playerSpriteBindings?: PlayerSpriteBinding[];
  walkSheetBindings?: WalkSheetBindingTransport[];
  soundEventBindings?: SoundEventBinding[];
}

export interface SoundEventBinding { eventId: string; url: string }

export interface BootAssetSettings {
  skillIconStyle: 'bb2' | 'bb3';
  skillIconPackInstallId: string | null;
  assetPackAssignments: AssetPackAssignments;
}

export interface BootAssetRuntimeSettings extends BootAssetSettings {
  soundOverrides: Record<string, string>;
}

export interface BootAssetActivationResult {
  status: 'active' | 'fallback';
  requested: AssetPackAssignments;
  missingCapabilities: AssetAssignmentCapability[];
}

export interface InspectedAssetPack {
  packId: string;
  version: string;
  name: string;
  source: string;
  redistribution: string;
  sizeBytes: number;
  capabilities: string[];
  coverage: Record<string, number>;
  wholePackSha256: string;
}

export type DraftTarget =
  | { kind: 'skillIcon'; skill: string; positionId: string | null; side: 'any' | 'home' | 'away' }
  | { kind: 'playerSprite'; teamId: string; positionId: string; side?: 'any' | 'home' | 'away' }
  | { kind: 'walkSheet'; teamId: string; positionId: string; side?: 'any' | 'home' | 'away' }
  | { kind: 'soundEvent'; eventId: string }
  | { kind: 'teamLogo'; race: string }
  | { kind: 'blockDie'; face: string }
  | { kind: 'pitchImage'; themeId: string; weather: 'blizzard' | 'heat' | 'nice' | 'rain' | 'sunny' };

export interface DraftItem {
  bindingId: string;
  kind: 'skillIcon' | 'playerSprite' | 'walkSheet' | 'soundEvent' | 'teamLogo' | 'blockDie' | 'pitchImage';
  target: DraftTarget;
  walkSheetSpec?: WalkSheetSpecTransport;
  previewUrl: string;
  mime: 'image/png' | 'image/gif' | 'audio/wav';
  sha256: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  channels?: number;
  sampleRate?: number;
}

export interface DraftSummary {
  draftId: string;
  name: string;
  bindings: number;
  sizeBytes: number;
}

export interface DraftDetails extends DraftSummary {
  packId: string;
  version: string;
  items: DraftItem[];
}

export const assetMods = reactive({
  installed: [] as InstalledAssetPack[],
  busy: false,
  error: '',
  notice: '',
  activeInstallId: '',
  activeAssignments: { ...EMPTY_ASSET_PACK_ASSIGNMENTS } as AssetPackAssignments,
  pendingAssignments: null as AssetPackAssignments | null,
  pendingInstallId: '',
  // Covers the native draft install before an assignment intent reaches pendingAssignments.
  // Settings Apply/OK/Cancel must remain locked until the whole Apply now operation settles.
  creatorApplyBusy: false,
  revision: 0,
  /** Installed pitch bindings are registry-backed rather than capability-assigned.
   *  Keep their refresh signal separate so a pack import/removal can redraw the
   *  current turf without rebuilding every player presentation surface. */
  pitchRevision: 0,
  /** Owner 2026-09-05: bumps whenever the team-logo bindings change (install/remove/assign) so crests hot-swap. */
  logoRevision: 0,
  blockDiceRevision: 0,
  /** Installed containers whose URLs back the currently published merged tiers. */
  activeProviderInstallIds: [] as string[],
  /** Owner 09-09: the walk-sheet bindings committed by the last activation (user tier first, then the assigned
   *  pack + its fallbacks) — the DOM portrait resolver (walkerPortrait.ts) reads these; the pitch has its own copy. */
  activeWalkBindings: [] as WalkSheetBindingTransport[],
  leasedInstallIds: [] as string[],
});

function inTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

function publishPitchBindings(installed: readonly InstalledAssetPack[]): void {
  const pitchFallbacks = new Map<string, string>();
  for (const pack of installed) {
    for (const [key, local] of Object.entries(pack.pitchImageBindings ?? {})) {
      if (!pitchFallbacks.has(key)) pitchFallbacks.set(key, local);
    }
  }
  setFumbblPitchFallbacks(pitchFallbacks);
  assetMods.pitchRevision++;
}

export async function refreshAssetPacks(publishBindings = true): Promise<InstalledAssetPack[]> {
  if (!inTauri()) {
    assetMods.installed = [];
    setSelectedLocalFumbblAssetBindings(new Map());
    setFumbblPitchFallbacks(new Map());
    publishTeamLogoBindings();
    publishBlockDiceBindings();
    assetMods.pitchRevision++;
    return [];
  }
  const installed = await invoke<InstalledAssetPack[]>('list_asset_packs');
  assetMods.installed = installed;
  if (publishBindings) {
    publishPitchBindings(installed);
    publishTeamLogoBindings();
    publishBlockDiceBindings();
  }
  // The renderer may already have attempted this turf before the pack registry
  // became available. Explicitly invalidate that attempt and retry the active
  // family against the authoritative weather variant.
  return installed;
}

async function refreshAndReactivateAssetPacks(): Promise<InstalledAssetPack[]> {
  const installed = await refreshAssetPacks(false);
  if (!await activateAssetAssignments(assetMods.activeAssignments)) {
    throw new Error('The installed asset registry changed, but its active presentation could not be refreshed.');
  }
  publishPitchBindings(installed);
  return installed;
}

/** Owner 2026-09-05: team logos AND player iconsets come from EVERY installed pack (`fumbbl-id-images` +
 *  `player-iconsets`) — the pack assigned to the player-sprite slot wins a contested id, then installation
 *  order. Independent of whether the sprite slot is a pack at all. This is the MOD tier of the sprite chain
 *  (user-selected > installed mods > placeholder). Bumps `logoRevision`. */
export function publishTeamLogoBindings(): void {
  const merged = new Map<string, string>();
  // Owner 09-07: the pack assigned to the TEAM LOGOS slot wins every contested id; the sprite-slot pack is next;
  // then installation order (the built-in default keeps the 09-05 mod-tier merge).
  const logoId = assetMods.activeAssignments.teamLogos;
  const spriteId = assetMods.activeAssignments.playerSprites;
  const ordered = [
    ...assetMods.installed.filter(isUserFilesPack),
    ...assetMods.installed.filter((pack) => pack.installId === logoId),
    ...assetMods.installed.filter((pack) => !isUserFilesPack(pack) && pack.installId !== logoId && pack.installId === spriteId),
    ...assetMods.installed.filter((pack) => !isUserFilesPack(pack) && pack.installId !== logoId && pack.installId !== spriteId),
  ];
  for (const pack of ordered) {
    for (const [key, local] of [...Object.entries(pack.logoImageBindings ?? {}), ...Object.entries(pack.classicImageBindings ?? {})]) {
      if (!merged.has(key)) merged.set(key, local);
    }
  }
  setLocalFumbblLogoBindings(merged);
  assetMods.logoRevision++;
}

export function blockFaceSource(face: string): string | null {
  const user = userFilesPack()?.blockDiceBindings?.[face];
  if (user) return user;
  const assigned = assetMods.installed.find((pack) =>
    pack.installId === assetMods.activeAssignments.blockDice && isAssignableAssetPack(pack));
  return assigned?.blockDiceBindings?.[face] ?? null;
}

export function publishBlockDiceBindings(): void {
  PitchRenderer.setBlockFaceSources(Object.fromEntries(
    ['skull', 'bothdown', 'push', 'powpush', 'pow']
      .map((face) => [face, blockFaceSource(face)])
      .filter((entry): entry is [string, string] => !!entry[1]),
  ));
  assetMods.blockDiceRevision++;
}

let activationGeneration = 0;
let assignmentGeneration = 0;
const retiringInstallIds = new Set<string>();
const candidateInstallIdsByIntent = new Map<number, Set<string>>();
const candidateInstallIdRefCounts = new Map<string, number>();
let leasePublication = Promise.resolve();

function assignmentIds(assignments: Partial<AssetPackAssignments>): Set<string> {
  return new Set(Object.values(assignments).filter(Boolean));
}

function currentLeaseIds(): string[] {
  return [...new Set([
    ...assetMods.activeProviderInstallIds,
    ...retiringInstallIds,
    ...candidateInstallIdRefCounts.keys(),
  ])].sort();
}

function refreshClientLeases(): void {
  assetMods.leasedInstallIds = currentLeaseIds();
}

async function publishNativeLeases(): Promise<void> {
  const publication = leasePublication.then(async () => {
    // Derive the snapshot only once this publication owns the queue. Candidate
    // intents can be acquired or settled while an older native command waits.
    const ids = currentLeaseIds();
    assetMods.leasedInstallIds = ids;
    if (inTauri()) await invoke<void>('set_asset_pack_leases', { installIds: ids });
  });
  // A failed native command must not poison later fail-closed reconciliation.
  leasePublication = publication.catch(() => undefined);
  await publication;
}

function acquireCandidateLeases(intent: number, installIds: Iterable<string>): boolean {
  if (candidateInstallIdsByIntent.has(intent)) return false;
  const owned = new Set([...installIds].filter(Boolean));
  candidateInstallIdsByIntent.set(intent, owned);
  for (const installId of owned) {
    candidateInstallIdRefCounts.set(installId, (candidateInstallIdRefCounts.get(installId) ?? 0) + 1);
  }
  refreshClientLeases();
  return true;
}

function releaseCandidateLeases(intent: number): Set<string> | null {
  const owned = candidateInstallIdsByIntent.get(intent);
  if (!owned) return null;
  candidateInstallIdsByIntent.delete(intent);
  for (const installId of owned) {
    const remaining = (candidateInstallIdRefCounts.get(installId) ?? 1) - 1;
    if (remaining > 0) candidateInstallIdRefCounts.set(installId, remaining);
    else candidateInstallIdRefCounts.delete(installId);
  }
  refreshClientLeases();
  return owned;
}

function restoreCandidateLeases(intent: number, owned: Set<string>): void {
  if (candidateInstallIdsByIntent.has(intent)) return;
  candidateInstallIdsByIntent.set(intent, owned);
  for (const installId of owned) {
    candidateInstallIdRefCounts.set(installId, (candidateInstallIdRefCounts.get(installId) ?? 0) + 1);
  }
  refreshClientLeases();
}

function settleUnusedCandidateLeases(intent: number): void {
  const waits = [waitForAssetPresentationRetirement(), waitForWalkSheetRetirement()];
  void Promise.all(waits).then(async () => {
    const owned = releaseCandidateLeases(intent);
    if (!owned) return;
    try {
      await publishNativeLeases();
    } catch {
      // The last successfully published native snapshot still holds these IDs.
      // Restore local ownership too so Settings cannot offer an unsafe removal.
      restoreCandidateLeases(intent, owned);
    }
  }).catch(() => { /* fail closed: candidate ownership and native lease remain held */ });
}

function packUrls(pack: InstalledAssetPack | undefined): Set<string> {
  return new Set([
    ...Object.values(pack?.skillIcons ?? {}),
    ...Object.values(pack?.classicImageBindings ?? {}),
    ...Object.values(pack?.logoImageBindings ?? {}),
    ...Object.values(pack?.blockDiceBindings ?? {}),
    ...Object.values(pack?.pitchImageBindings ?? {}),
    ...(pack?.skillIconBindings ?? []).map((binding) => binding.url),
    ...(pack?.playerSpriteBindings ?? []).map((binding) => binding.url),
    ...(pack?.walkSheetBindings ?? []).map((binding) => binding.url),
    ...(pack?.soundEventBindings ?? []).map((binding) => binding.url),
  ]);
}

function retireReplacedProviders(previous: ReadonlySet<string>, next: ReadonlySet<string>): void {
  const retired = [...previous].filter((id) => !next.has(id));
  if (!retired.length) { void publishNativeLeases(); return; }
  for (const id of retired) retiringInstallIds.add(id);
  refreshClientLeases();
  const retiredUrls = new Set(retired.flatMap((id) => [
    ...packUrls(assetMods.installed.find((pack) => pack.installId === id)),
  ]));
  const waits = [
    waitForAssetPresentationRetirement(),
    waitForSoundUrlsRetirement(retiredUrls),
    waitForWalkSheetRetirement(),
  ];
  void Promise.all(waits).then(async () => {
    const current = new Set(assetMods.activeProviderInstallIds);
    for (const id of retired) if (!current.has(id)) retiringInstallIds.delete(id);
    await publishNativeLeases();
  }).catch(() => { /* fail closed: native lease remains held */ });
}

/** Capture user intent before an async picker/confirmation flow begins. */
export function beginSkillPackIntent(): number {
  return ++activationGeneration;
}

export function isCurrentSkillPackIntent(intent: number): boolean {
  return intent === activationGeneration;
}

export function beginAssetAssignmentIntent(): number {
  supersedeAssetPresentationIntent();
  return ++assignmentGeneration;
}

export function isCurrentAssetAssignmentIntent(intent: number): boolean {
  return intent === assignmentGeneration;
}

export function assertNever(x: never): never {
  throw new Error(`Unhandled asset assignment capability: ${String(x)}`);
}

export function capabilityName(capability: AssetAssignmentCapability): string {
  switch (capability) {
    case 'skillIcons': return 'skill-icons';
    case 'playerSprites': return 'player-sprites';
    case 'walkSheets': return 'walk-sheets';
    case 'soundEvents': return 'sound-events';
    case 'teamLogos': return 'team-logos';
    case 'blockDice': return 'block-dice';
    default: return assertNever(capability);
  }
}

export function packSupports(pack: InstalledAssetPack, capability: AssetAssignmentCapability): boolean {
  if (!isAssignableAssetPack(pack)) return false;
  if (capability === 'playerSprites') {
    return pack.capabilities.some((name) => ['player-sprites', 'player-iconsets', 'fumbbl-id-images'].includes(name));
  }
  // Owner 09-07: a pack supplies team logos when it declares the capability OR simply carries logo bindings (every
  // existing FUMBBL Original pack does), so the new slot is selectable without re-exporting packs.
  if (capability === 'teamLogos') {
    return pack.capabilities.includes('team-logos') || Object.keys(pack.logoImageBindings ?? {}).length > 0;
  }
  if (capability === 'blockDice') {
    return pack.capabilities.includes('block-dice') || Object.keys(pack.blockDiceBindings ?? {}).length > 0;
  }
  return pack.capabilities.includes(capabilityName(capability));
}

export function isUserFilesPack(pack: InstalledAssetPack | undefined): boolean {
  return pack?.installId === USER_FILES_INSTALL_ID;
}

export function isAssignableAssetPack(pack: InstalledAssetPack): boolean {
  return !isUserFilesPack(pack);
}

export function userFilesPack(installed: readonly InstalledAssetPack[] = assetMods.installed): InstalledAssetPack | undefined {
  return installed.find(isUserFilesPack);
}

export function normalizeAssetAssignments(
  raw: Partial<AssetPackAssignments> | null | undefined,
  installed = assetMods.installed,
): AssetPackAssignments {
  const next = { ...EMPTY_ASSET_PACK_ASSIGNMENTS };
  for (const capability of Object.keys(next) as AssetAssignmentCapability[]) {
    const installId = raw?.[capability] ?? '';
    next[capability] = installed.some((pack) => isAssignableAssetPack(pack) && pack.installId === installId && packSupports(pack, capability))
      ? installId : '';
  }
  return next;
}

function selectedFor(assignments: AssetPackAssignments, capability: AssetAssignmentCapability): InstalledAssetPack | undefined {
  return assetMods.installed.find((pack) => isAssignableAssetPack(pack)
    && pack.installId === assignments[capability] && packSupports(pack, capability));
}

function packSkillBindings(pack: InstalledAssetPack | undefined): SkillIconBinding[] {
  if (!pack) return [];
  if (pack.skillIconBindings?.length) return [...pack.skillIconBindings];
  return Object.entries(pack.skillIcons ?? {})
    .map(([skill, url]) => ({
      skill, canonicalSkill: canonicalSkillIconKey(skill), positionId: null, side: 'any' as const, url,
    }));
}

/** The MOD tier of one slot. An ASSIGNED pack leads and every other installed mod backs it up in registry order
 * (a skill the pack lacks still resolves). Owner 09-09: a BUILT-IN pick ('' — "Built-in default" / "Illustrated -
 * Default") is the user's choice for that slot, so NO installed pack is folded in — the bundled art serves (packs
 * used to win over the chosen family). The reserved user-files pack is a separate USER tier above both; team
 * logos / iconsets publish from every pack independently (publishTeamLogoBindings). */
function fallbackPacks(primary: InstalledAssetPack | undefined): InstalledAssetPack[] {
  if (!primary) return [];
  return [
    primary,
    ...assetMods.installed.filter((pack) => isAssignableAssetPack(pack) && pack.installId !== primary.installId),
  ];
}

function mergedSkillBindings(primary: InstalledAssetPack | undefined, providers?: Set<string>): SkillIconBinding[] {
  const seen = new Set<string>();
  return fallbackPacks(primary).flatMap((pack) => packSkillBindings(pack).filter((binding) => {
    const key = `${binding.canonicalSkill}/${binding.positionId ?? ''}/${binding.side}`;
    if (seen.has(key)) return false;
    seen.add(key);
    providers?.add(pack.installId);
    return true;
  }));
}

function mergedSpriteBindings(primary: InstalledAssetPack | undefined, providers?: Set<string>): PlayerSpriteBinding[] {
  const seen = new Set<string>();
  return fallbackPacks(primary).flatMap((pack) => (pack.playerSpriteBindings ?? []).filter((binding) => {
    const key = `${binding.teamId}/${binding.positionId}/${binding.side ?? 'any'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    providers?.add(pack.installId);
    return true;
  }));
}

function mergedSoundBindings(
  primary: InstalledAssetPack | undefined,
  user: InstalledAssetPack | undefined,
  providers?: Set<string>,
): SoundEventBinding[] {
  const seen = new Set<string>();
  return [user, ...fallbackPacks(primary)].flatMap((pack) => (pack?.soundEventBindings ?? []).filter((binding) => {
    if (seen.has(binding.eventId)) return false;
    seen.add(binding.eventId);
    if (pack) providers?.add(pack.installId);
    return true;
  }));
}

function mergedWalkBindings(
  primary: InstalledAssetPack | undefined,
  user: InstalledAssetPack | undefined,
  providers?: Set<string>,
): WalkSheetBindingTransport[] {
  const seen = new Set<string>();
  return [user, ...fallbackPacks(primary)].flatMap((pack) => (pack?.walkSheetBindings ?? []).filter((binding) => {
    const key = `${binding.teamId}/${binding.positionId}/${binding.side ?? 'any'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (pack) providers?.add(pack.installId);
    return true;
  }));
}

/** One latest-intent transaction for all six independently assigned capabilities. */
export async function activateAssetAssignments(
  requested: Partial<AssetPackAssignments>,
  intent = beginAssetAssignmentIntent(),
): Promise<boolean> {
  if (!isCurrentAssetAssignmentIntent(intent)) return false;
  const assignments = normalizeAssetAssignments(requested);
  const previousProviders = new Set(assetMods.activeProviderInstallIds);
  assetMods.pendingAssignments = assignments;
  const skillPack = selectedFor(assignments, 'skillIcons');
  const spritePack = selectedFor(assignments, 'playerSprites');
  const walkPack = selectedFor(assignments, 'walkSheets');
  const soundPack = selectedFor(assignments, 'soundEvents');
  const userPack = userFilesPack();
  const providerIds = assignmentIds(assignments);
  const skillBindings = mergedSkillBindings(skillPack, providerIds);
  const spriteBindings = mergedSpriteBindings(spritePack, providerIds);
  const soundBindings = mergedSoundBindings(soundPack, userPack, providerIds);
  const walkBindings = mergedWalkBindings(walkPack, userPack, providerIds);
  if (userPack?.playerSpriteBindings?.length) providerIds.add(userPack.installId);
  if (Object.keys(userPack?.blockDiceBindings ?? {}).length) providerIds.add(userPack!.installId);
  // Team-logo bindings are published from every installed pack in precedence
  // order, independent of assignment, so their backing containers are active too.
  for (const pack of assetMods.installed) {
    if (Object.keys(pack.logoImageBindings ?? {}).length
      || Object.keys(pack.classicImageBindings ?? {}).length
      || Object.keys(pack.pitchImageBindings ?? {}).length) {
      providerIds.add(pack.installId);
    }
  }
  let preparedWalkSheets: PreparedWalkSheets | null = null;
  try {
    // Candidate and current containers are leased before any native URL decode.
    if (!acquireCandidateLeases(intent, providerIds)) return false;
    await publishNativeLeases();
    if (!isCurrentAssetAssignmentIntent(intent)) { settleUnusedCandidateLeases(intent); return false; }
    const soundCandidate = prepareSoundEventPack(soundBindings);
    preparedWalkSheets = await prepareWalkSheets(walkBindings, intent);
    if (!isCurrentAssetAssignmentIntent(intent)) {
      preparedWalkSheets.dispose();
      preparedWalkSheets = null;
      settleUnusedCandidateLeases(intent);
      return false;
    }
    const activated = await activateAssetPresentationPack({
      skillIcons: skillBindings,
      playerSprites: spriteBindings,
      ...(userPack?.playerSpriteBindings?.length ? {
        playerSpriteOverrides: Object.fromEntries(userPack.playerSpriteBindings.map((binding) => [
          `${binding.teamId}/${binding.positionId}/${binding.side ?? 'any'}`,
          binding.url,
        ])),
      } : {}),
    });
    if (!activated || !isCurrentAssetAssignmentIntent(intent)) {
      settleUnusedCandidateLeases(intent);
      return false;
    }
    // Sound publication is synchronous and cannot fail after native validation.
    // Existing HTMLAudioElements retain their old src and finish naturally.
    activateSoundEventPack(soundCandidate);
    // Legacy URL-addressed sprite packs are compatibility input only. They are
    // active exclusively because this pack is the user's player-sprite choice;
    // retired provider/precedence metadata is neither returned nor consulted.
    setSelectedLocalFumbblAssetBindings(new Map(Object.entries(spritePack?.classicImageBindings ?? {})));
    if (preparedWalkSheets) {
      commitWalkSheets(preparedWalkSheets);
      preparedWalkSheets = null;
    }
    assetMods.activeAssignments = assignments;
    assetMods.activeWalkBindings = walkBindings;
    assetMods.activeProviderInstallIds = [...providerIds].sort();
    assetMods.activeInstallId = assignments.skillIcons;
    publishTeamLogoBindings(); // the sprite-slot pack now wins contested logo ids
    publishBlockDiceBindings();
    assetMods.revision++;
    assetMods.error = '';
    releaseCandidateLeases(intent);
    retireReplacedProviders(previousProviders, providerIds);
    return true;
  } catch {
    settleUnusedCandidateLeases(intent);
    if (isCurrentAssetAssignmentIntent(intent)) {
      assetMods.error = 'The selected asset packs could not be decoded. The previous complete set is still active.';
    }
    return false;
  } finally {
    preparedWalkSheets?.dispose();
    if (isCurrentAssetAssignmentIntent(intent)) assetMods.pendingAssignments = null;
  }
}

function sameAssignments(a: AssetPackAssignments, b: AssetPackAssignments): boolean {
  return a.skillIcons === b.skillIcons
    && a.playerSprites === b.playerSprites
    && a.walkSheets === b.walkSheets
    && a.soundEvents === b.soundEvents
    && a.teamLogos === b.teamLogos
    && a.blockDice === b.blockDice;
}

/**
 * Activate the durable startup selection without turning a transient decoder failure into a
 * persisted opt-out. Unknown/uninstalled identities are intentionally normalized away; identities
 * that are still installed remain the user's durable request even when this session must use the
 * built-in fallback. A later launch therefore retries the exact complete capability set.
 *
 * `refreshAssetPacks()` must complete before this helper runs, so "missing" means absent from the
 * authoritative native registry rather than temporarily unreadable app data.
 */
export async function activateBootAssetAssignments(
  durable: BootAssetSettings,
): Promise<BootAssetActivationResult> {
  const persisted: AssetPackAssignments = {
    skillIcons: String(durable.assetPackAssignments?.skillIcons ?? ''),
    playerSprites: String(durable.assetPackAssignments?.playerSprites ?? ''),
    walkSheets: String(durable.assetPackAssignments?.walkSheets ?? ''),
    soundEvents: String(durable.assetPackAssignments?.soundEvents ?? ''),
    teamLogos: String(durable.assetPackAssignments?.teamLogos ?? ''), // owner 09-07
    blockDice: String(durable.assetPackAssignments?.blockDice ?? ''),
  };
  const normalized = normalizeAssetAssignments(persisted);
  const capabilities = Object.keys(normalized) as AssetAssignmentCapability[];
  const missingCapabilities = capabilities.filter(
    (capability) => !!persisted[capability] && persisted[capability] !== normalized[capability],
  );

  // Correct only identities the refreshed native registry proves are absent/unsupported. Keep the
  // legacy null sentinel until its style migration actually activates, so a failed first attempt is
  // retried on the next boot instead of being stamped as an explicit built-in selection.
  if (missingCapabilities.length && !sameAssignments(persisted, normalized)) {
    durable.assetPackAssignments = { ...normalized };
    if (missingCapabilities.includes('skillIcons') && durable.skillIconPackInstallId !== null) {
      durable.skillIconPackInstallId = normalized.skillIcons;
    }
  }

  const requested = { ...normalized };
  if (durable.skillIconPackInstallId === null && !requested.skillIcons) {
    requested.skillIcons = resolveSkillPackSelection(null, durable.skillIconStyle, assetMods.installed);
  }

  if (await activateAssetAssignments(requested)) {
    durable.assetPackAssignments = { ...assetMods.activeAssignments };
    durable.skillIconPackInstallId = assetMods.activeAssignments.skillIcons;
    return { status: 'active', requested, missingCapabilities };
  }

  // Fresh-process runtime state is empty, but explicitly publish the empty complete snapshot so a
  // partially decoded candidate can never leak. This mutates only the runtime registry: the valid
  // durable request above remains selected and will be retried next launch.
  const fallbackActivated = await activateAssetAssignments({});
  assetMods.error = fallbackActivated
    ? 'The saved asset packs could not be activated at startup. Built-in presentation is active for this session; the saved selection will be retried next launch.'
    : 'The saved asset packs and the built-in fallback could not be activated. The saved selection was retained for the next launch.';
  return { status: 'fallback', requested, missingCapabilities };
}

export async function commitAssetAssignments(
  requested: Partial<AssetPackAssignments>,
  persist: (assignments: AssetPackAssignments) => void,
  intent = beginAssetAssignmentIntent(),
): Promise<boolean> {
  const activated = await activateAssetAssignments(requested, intent);
  if (!activated || !isCurrentAssetAssignmentIntent(intent)) return false;
  persist({ ...assetMods.activeAssignments });
  return true;
}

/** Fully decode the selected pack before the pitch/DOM resolver swaps to it. */
export async function activateSelectedSkillPack(installId: string, intent = beginSkillPackIntent()): Promise<boolean> {
  if (!isCurrentSkillPackIntent(intent)) return false;
  assetMods.pendingInstallId = installId;
  const selected = assetMods.installed.find((pack) => isAssignableAssetPack(pack)
    && pack.installId === installId && pack.capabilities.includes('skill-icons'));
  try {
    const activated = await activateSkillIconPack(selected ? { assets: selected.skillIcons } : null);
    if (!isCurrentSkillPackIntent(intent)) return false;
    if (!activated) return false;
    assetMods.activeInstallId = selected?.installId ?? '';
    assetMods.revision++;
    assetMods.error = '';
    // A missing/unknown identity intentionally resolves to initials. That is a
    // successful fail-closed activation, not a half-applied pack selection.
    return true;
  } catch {
    if (isCurrentSkillPackIntent(intent)) {
      assetMods.error = 'The selected skill-icon pack could not be decoded. The previous icon set is still active.';
    }
    return false;
  } finally {
    if (isCurrentSkillPackIntent(intent)) assetMods.pendingInstallId = '';
  }
}

/** Persist only after the latest candidate becomes the shared active snapshot. */
export async function commitSkillPackSelection(
  installId: string,
  persist: (activeInstallId: string) => void,
  intent = beginSkillPackIntent(),
): Promise<boolean> {
  const activated = await activateSelectedSkillPack(installId, intent);
  if (!activated || !isCurrentSkillPackIntent(intent)) return false;
  persist(assetMods.activeInstallId);
  return true;
}

/** Native picker → bounded native validation/install. The chosen source path is never persisted. */
export async function importAssetPack(): Promise<InstalledAssetPack | null> {
  if (!inTauri() || assetMods.busy) {
    if (!inTauri()) assetMods.error = 'Asset packs can be imported from the desktop app.';
    return null;
  }
  assetMods.busy = true;
  assetMods.error = '';
  assetMods.notice = '';
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Super FUMBBL asset mod', extensions: ['f40kmod'] }],
    });
    if (!selected) return null;
    const preview = await invoke<InspectedAssetPack>('inspect_asset_pack', { path: selected });
    const coverage = preview.capabilities
      .map((capability) => `${capability}: ${preview.coverage[capability] ?? 0}`)
      .join('\n');
    const confirmed = window.confirm(
      `Import unverified local asset pack?\n\n${preview.name} ${preview.version}\n${formatPackSize(preview.sizeBytes)}\nSource: ${preview.source}\n${coverage}\n\nOnly presentation media will be installed.`,
    );
    if (!confirmed) return null;
    const installed = await invoke<InstalledAssetPack>('install_asset_pack', {
      path: selected,
      expectedWholePackSha256: preview.wholePackSha256,
    });
    await refreshAndReactivateAssetPacks();
    assetMods.notice = `${installed.name} ${installed.version} installed.`;
    return installed;
  } catch (error) {
    assetMods.error = error instanceof Error ? error.message : String(error);
    return null;
  } finally {
    assetMods.busy = false;
  }
}

/** Validate and describe a chosen pack without installing or mutating it. Used by the standalone builder. */
export async function inspectAssetPackFile(path: string): Promise<InspectedAssetPack> {
  requireDesktop();
  return invoke<InspectedAssetPack>('inspect_asset_pack', { path });
}

export function formatPackSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

export function isAssetPackLeased(installId: string): boolean {
  return assetMods.leasedInstallIds.includes(installId);
}

/** Native performs the final mutex-protected lease check; the local check gives
 * the Settings UI an immediate, non-destructive explanation. */
export async function removeInstalledAssetPack(installId: string): Promise<boolean> {
  requireDesktop();
  if (installId === USER_FILES_INSTALL_ID) {
    assetMods.error = 'Your files is managed from Configured assets.';
    return false;
  }
  if (assignmentIds(assetMods.activeAssignments).has(installId)) {
    assetMods.error = 'This pack is active or still finishing a previous display. Choose another pack and try again.';
    return false;
  }
  const target = assetMods.installed.find((pack) => pack.installId === installId);
  const activeFallback = assetMods.activeProviderInstallIds.includes(installId);
  if (isAssetPackLeased(installId) && !activeFallback) {
    assetMods.error = 'This pack is active or still finishing a previous display. Choose another pack and try again.';
    return false;
  }
  const previousInstalled = assetMods.installed;
  let nativeRemoved = false;
  try {
    if (target && activeFallback) {
      // Remove the MOD-tier provider from the registry used to build the next
      // snapshot, then wait until every consumer has retired its minted URLs.
      assetMods.installed = previousInstalled.filter((pack) => pack.installId !== installId);
      if (!await activateAssetAssignments(assetMods.activeAssignments)) {
        throw new Error('The active presentation could not be prepared without this pack.');
      }
      await Promise.all([
        waitForAssetPresentationRetirement(),
        waitForSoundUrlsRetirement(packUrls(target)),
        waitForWalkSheetRetirement(),
      ]);
      retiringInstallIds.delete(installId);
      await publishNativeLeases();
    }
    await invoke<void>('remove_asset_pack', { installId });
    nativeRemoved = true;
    await refreshAssetPacks();
    assetMods.error = '';
    return true;
  } catch (error) {
    if (!nativeRemoved && target && !assetMods.installed.some((pack) => pack.installId === installId)) {
      assetMods.installed = previousInstalled;
      await activateAssetAssignments(assetMods.activeAssignments).catch(() => false);
    }
    const message = error instanceof Error ? error.message : String(error);
    assetMods.error = message === 'Asset pack is active or still retiring'
      ? 'This pack is active or still finishing a previous display. Choose another pack and try again.'
      : message;
    return false;
  }
}

/**
 * Preserve an exact installed identity across app updates. A null value is the
 * one-shot legacy BB2/BB3 migration; empty is an explicit initials selection.
 */
export function resolveSkillPackSelection(
  current: string | null,
  legacyStyle: 'bb2' | 'bb3',
  installed: readonly InstalledAssetPack[],
): string {
  const skillPacks = installed.filter((pack) => isAssignableAssetPack(pack) && pack.capabilities.includes('skill-icons'));
  if (current === null) {
    const legacyPackId = `local.fumbbl40k.skill-icons.${legacyStyle}`;
    return skillPacks
      .filter((pack) => pack.packId === legacyPackId)
      .sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }) || a.installId.localeCompare(b.installId))[0]
      ?.installId ?? '';
  }
  if (!current) return '';
  return skillPacks.some((pack) => pack.installId === current) ? current : '';
}

function requireDesktop(): void {
  if (!inTauri()) throw new Error('Asset creation is available in the desktop app.');
}

export async function listAssetDrafts(): Promise<DraftSummary[]> {
  requireDesktop();
  return invoke<DraftSummary[]>('asset_draft_list');
}

export async function createAssetDraft(name: string): Promise<DraftDetails> {
  requireDesktop();
  return invoke<DraftDetails>('asset_draft_create', { name });
}

export async function updateAssetDraft(draftId: string, name: string): Promise<DraftDetails> {
  requireDesktop();
  return invoke<DraftDetails>('asset_draft_update', { draftId, name });
}

export async function inspectAssetDraft(draftId: string): Promise<DraftDetails> {
  requireDesktop();
  return invoke<DraftDetails>('asset_draft_inspect', { draftId });
}

export async function deleteAssetDraft(draftId: string): Promise<void> {
  requireDesktop();
  await invoke<void>('asset_draft_delete', { draftId });
}

export async function putDraftImage(
  draftId: string,
  sourcePath: string,
  target: Extract<DraftTarget, { kind: 'skillIcon' | 'playerSprite' | 'blockDie' | 'pitchImage' }>,
  scaling: 'linear' | 'nearest',
): Promise<DraftDetails> {
  requireDesktop();
  return invoke<DraftDetails>('asset_draft_put_image', { draftId, sourcePath, target, scaling });
}

export async function putDraftWalkSheet(
  draftId: string,
  sourcePath: string,
  target: Extract<DraftTarget, { kind: 'walkSheet' }>,
  spec?: WalkSheetSpecTransport,
): Promise<DraftDetails> {
  requireDesktop();
  return invoke<DraftDetails>('asset_draft_put_walk_sheet', { draftId, sourcePath, target, spec });
}

export async function putDraftSound(draftId: string, sourcePath: string, eventId: string): Promise<DraftDetails> {
  requireDesktop();
  return invoke<DraftDetails>('asset_draft_put_sound', { draftId, sourcePath, eventId });
}

export async function removeDraftBinding(draftId: string, bindingId: string): Promise<DraftDetails> {
  requireDesktop();
  return invoke<DraftDetails>('asset_draft_remove_binding', { draftId, bindingId });
}

export async function exportAssetDraft(
  draftId: string,
  section: AssetPackSection,
  destinationPath: string,
): Promise<InspectedAssetPack> {
  requireDesktop();
  return invoke<InspectedAssetPack>('asset_draft_export', { draftId, section, destinationPath });
}

export async function applyAssetDraft(
  draftId: string,
  section: AssetPackSection,
  reactivate = true,
): Promise<InstalledAssetPack> {
  requireDesktop();
  const installed = await invoke<InstalledAssetPack>('asset_draft_apply', { draftId, section });
  if (reactivate) await refreshAndReactivateAssetPacks();
  else await refreshAssetPacks(); // sound-only migration activates the extended assignment immediately below
  return installed;
}

/** All-or-nothing migration; callers clear legacy data only after success. */
export async function migrateLegacySoundOverrides(overrides: Record<string, string>): Promise<DraftDetails | null> {
  if (!Object.keys(overrides).length) return null;
  requireDesktop();
  return invoke<DraftDetails | null>('asset_draft_migrate_sound_overrides', { overrides });
}

export type UserOverrideKind = 'sprite' | 'sound' | 'logo' | 'blockDie';
interface UserOverrideWriteResult { bindingId: string; pack: InstalledAssetPack }

async function refreshActivatedUserFiles(): Promise<void> {
  await refreshAssetPacks();
  if (!await activateAssetAssignments(assetMods.activeAssignments)) {
    throw new Error('Your file was saved, but the active presentation could not be refreshed.');
  }
}

async function retireUserFilesBeforeMutation(): Promise<void> {
  const current = userFilesPack();
  if (!current) return;
  const previousInstalled = assetMods.installed;
  const retiring = packUrls(current);
  assetMods.installed = previousInstalled.filter((pack) => !isUserFilesPack(pack));
  try {
    if (!await activateAssetAssignments(assetMods.activeAssignments)) {
      throw new Error('The current user files could not be retired safely.');
    }
    await Promise.all([
      waitForAssetPresentationRetirement(),
      waitForSoundUrlsRetirement(retiring),
      waitForWalkSheetRetirement(),
    ]);
  } catch (error) {
    assetMods.installed = previousInstalled;
    await activateAssetAssignments(assetMods.activeAssignments).catch(() => false);
    throw error;
  }
}

export async function writeUserOverride(
  kind: UserOverrideKind,
  targetKey: string,
  bytes: Uint8Array,
  sourceName: string,
): Promise<InstalledAssetPack> {
  requireDesktop();
  const extension = /\.([^.\\/?]+)$/.exec(sourceName)?.[1]?.toLowerCase() ?? '';
  await retireUserFilesBeforeMutation();
  let result: UserOverrideWriteResult;
  try {
    result = await invoke<UserOverrideWriteResult>('write_user_override', {
      bytes: Array.from(bytes), kind, targetKey, extension,
    });
  } catch (error) {
    await refreshActivatedUserFiles().catch(() => undefined);
    throw error;
  }
  await refreshActivatedUserFiles();
  return result.pack;
}

export async function removeUserOverride(kind: UserOverrideKind, targetKey: string): Promise<void> {
  requireDesktop();
  await retireUserFilesBeforeMutation();
  try {
    await invoke<InstalledAssetPack | null>('remove_user_override', { kind, targetKey });
  } catch (error) {
    await refreshActivatedUserFiles().catch(() => undefined);
    throw error;
  }
  await refreshActivatedUserFiles();
}

function bytesFromDataUrl(value: string): { bytes: number[]; extension: string } {
  if (value.length > 24 * 1024 * 1024) throw new Error('Migrated media is too large');
  const [header, encoded] = value.split(',', 2);
  const extension = header === 'data:image/png;base64' ? 'png'
    : header === 'data:audio/ogg;base64' ? 'ogg'
      : ['data:audio/wav;base64', 'data:audio/x-wav;base64'].includes(header ?? '') ? 'wav'
        : ['data:audio/mpeg;base64', 'data:audio/mp3;base64'].includes(header ?? '') ? 'mp3' : '';
  if (!extension || !encoded) throw new Error('Unsupported migrated media');
  if (Math.floor(encoded.length * 3 / 4) > 16 * 1024 * 1024) throw new Error('Migrated media is too large');
  const binary = atob(encoded);
  return { bytes: Array.from(binary, (char) => char.charCodeAt(0)), extension };
}

export async function migrateV26UserOverrides(migration: V26UserOverrideMigration): Promise<void> {
  const entries: readonly (readonly [UserOverrideKind, string, string])[] = [
    ...Object.entries(migration.sprites).map(([key, value]) => ['sprite', key, value] as const),
    ...Object.entries(migration.sounds).map(([key, value]) => ['sound', key, value] as const),
    ...Object.entries(migration.logos).map(([key, value]) => ['logo', key, value] as const),
  ];
  for (const [kind, targetKey, value] of entries) {
    try {
      const media = bytesFromDataUrl(value);
      await invoke<UserOverrideWriteResult>('write_user_override', { ...media, kind, targetKey });
    } catch {
      // v26 data URLs are intentionally best-effort and have already been
      // removed from settings; one bad entry must not block the remaining files.
    }
  }
}

/** Retry-safe migration transaction. Embedded audio is retired only after the
 * native draft is installed and the complete capability snapshot publishes. */
export async function migrateAndActivateLegacySounds(
  overrides: Record<string, string>,
  currentAssignments: Partial<AssetPackAssignments>,
  persist: (assignments: AssetPackAssignments) => void,
): Promise<boolean> {
  if (!Object.keys(overrides).length) return true;
  const intent = beginAssetAssignmentIntent();
  const migrated = await migrateLegacySoundOverrides(overrides);
  if (!migrated || !isCurrentAssetAssignmentIntent(intent)) return false;
  const installed = await applyAssetDraft(migrated.draftId, 'sound-events', false);
  if (!isCurrentAssetAssignmentIntent(intent)) return false;
  const next = normalizeAssetAssignments(currentAssignments);
  next.soundEvents = installed.installId;
  return commitAssetAssignments(next, persist, intent);
}

/**
 * Production boot order for installed presentation assets. The native registry and the complete
 * durable capability selection are resolved first, including the one-shot legacy BB2/BB3 style
 * sentinel. Only then may a sound-only migration extend that resolved selection. This prevents
 * the migration's final settings write from replacing an unresolved skill/sprite selection with
 * empty identities.
 */
export async function initializeAssetPresentationAtBoot(
  durable: BootAssetRuntimeSettings,
): Promise<{ activation: BootAssetActivationResult; soundMigration: 'none' | 'active' | 'retained' }> {
  const v26 = takeV26UserOverrideMigration();
  if (v26) {
    await migrateV26UserOverrides(v26);
    await completeV26UserOverrideMigration();
  }
  await refreshAssetPacks();
  const activation = await activateBootAssetAssignments(durable);
  if (!Object.keys(durable.soundOverrides).length) return { activation, soundMigration: 'none' };

  try {
    const migrated = await migrateAndActivateLegacySounds(
      { ...durable.soundOverrides },
      // `requested` is the registry-resolved complete durable intent even when this session's
      // first decode fell back. In particular it carries a resolved legacy null-style skill pack;
      // using the still-null/empty compatibility fields here would recreate the startup wipe.
      activation.requested,
      (assignments) => {
        durable.assetPackAssignments = assignments;
        durable.skillIconPackInstallId = assignments.skillIcons;
        durable.soundOverrides = {};
      },
    );
    return { activation, soundMigration: migrated ? 'active' : 'retained' };
  } catch {
    return { activation, soundMigration: 'retained' };
  }
}
