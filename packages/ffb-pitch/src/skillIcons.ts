import { Assets, Rectangle, Texture } from 'pixi.js';
import { rosterRaceKey } from './bundledWalk';
import skillIconAliases from './skillIconAliases.json';

/** Kept in the call signature while persisted settings migrate to installed packs. */
export type SkillIconStyle = 'bb3' | 'bb2';
export type AssetSide = 'any' | 'home' | 'away';

export interface SkillIconContext {
  positionId?: string | null;
  side?: Exclude<AssetSide, 'any'> | null;
}

export interface SkillIconBinding {
  skill: string;
  canonicalSkill: string;
  positionId: string | null;
  side: AssetSide;
  url: string;
}

export interface PlayerSpriteBinding {
  teamId: string;
  positionId: string;
  side?: AssetSide;
  url: string;
}

export interface PlayerSpriteAsset {
  texture: Texture;
  url: string;
}

export interface AssetPresentationSnapshot {
  skillIcons: readonly SkillIconBinding[];
  playerSprites: readonly PlayerSpriteBinding[];
  /** User-selected flat sprites keyed by `${teamId}/${positionId}/${side}`. */
  playerSpriteOverrides?: Readonly<Record<string, string>>;
}

export interface SkillIconPackSnapshot {
  /** V1 compatibility: native-minted URLs keyed by client-owned skill target. */
  assets: Readonly<Record<string, string>>;
  /** V2 contextual targets. */
  bindings?: readonly SkillIconBinding[];
}

type SkillRequest = { skill: string; context?: SkillIconContext };

let packGeneration = 0;
let activeSkillUrls: ReadonlyMap<string, string> = new Map();
let activeSkillTextures: ReadonlyMap<string, Texture> = new Map();
let activePlayerUrls: ReadonlyMap<string, string> = new Map();
let activePlayerTextures: ReadonlyMap<string, Texture> = new Map();
let activePlayerOverrideUrls: ReadonlyMap<string, string> = new Map();
let activePlayerOverrideTextures: ReadonlyMap<string, Texture> = new Map();
const stableSkillTextures = new Map<string, Texture>();
const stableSkillRequests = new Map<string, SkillRequest>();
const stablePlayerTextures = new Map<string, Texture>();
const stableSkillLastUsed = new Map<string, number>();
const stablePlayerLastUsed = new Map<string, number>();
const STABLE_SKILL_HANDLE_LIMIT = 192;
const STABLE_PLAYER_WARM_LIMIT = 64;
let stableHandleClock = 0;
const inFlightUrls = new Map<number, ReadonlySet<string>>();
const retirementUrls = new Set<string>();
const retiringUrls = new Map<string, Promise<void>>();
const mountedUrlRefCounts = new Map<string, number>();
const mountedPlayerTargetRefCounts = new Map<string, number>();
const mountedPlayerTargetUrls = new Map<string, string>();
const retirementWaiters = new Set<() => void>();
let retirementFrameScheduled = false;

export interface AssetPresentationCacheStats {
  stableSkillHandles: number;
  stablePlayerHandles: number;
  mountedPlayerTargets: number;
  warmPlayerHandles: number;
  activeUrls: number;
  retiringUrls: number;
  skillHandleLimit: number;
  playerWarmLimit: number;
}

export function assetPresentationCacheStats(): AssetPresentationCacheStats {
  const warmPlayerHandles = [...stablePlayerTextures.keys()]
    .filter((key) => (mountedPlayerTargetRefCounts.get(key) ?? 0) === 0).length;
  return {
    stableSkillHandles: stableSkillTextures.size,
    stablePlayerHandles: stablePlayerTextures.size,
    mountedPlayerTargets: mountedPlayerTargetRefCounts.size,
    warmPlayerHandles,
    activeUrls: allActiveUrls().size,
    retiringUrls: retirementUrls.size + retiringUrls.size,
    skillHandleLimit: STABLE_SKILL_HANDLE_LIMIT,
    playerWarmLimit: STABLE_PLAYER_WARM_LIMIT,
  };
}

function touchStableSkill(key: string): void {
  stableSkillLastUsed.set(key, ++stableHandleClock);
}

function pruneStableSkillHandles(): void {
  if (stableSkillTextures.size <= STABLE_SKILL_HANDLE_LIMIT) return;
  const oldest = [...stableSkillTextures.keys()]
    .sort((left, right) => (stableSkillLastUsed.get(left) ?? 0) - (stableSkillLastUsed.get(right) ?? 0));
  for (const key of oldest.slice(0, stableSkillTextures.size - STABLE_SKILL_HANDLE_LIMIT)) {
    // Do not destroy: a mounted Sprite may still own this handle. Dropping only
    // the lookup lets Pixi retire it naturally with that Sprite generation.
    stableSkillTextures.delete(key);
    stableSkillRequests.delete(key);
    stableSkillLastUsed.delete(key);
  }
}

function touchStablePlayer(key: string): void {
  stablePlayerLastUsed.set(key, ++stableHandleClock);
}

function pruneStablePlayerHandles(): void {
  const warm = [...stablePlayerTextures.keys()]
    .filter((key) => (mountedPlayerTargetRefCounts.get(key) ?? 0) === 0)
    .sort((left, right) => (stablePlayerLastUsed.get(left) ?? 0) - (stablePlayerLastUsed.get(right) ?? 0));
  for (const key of warm.slice(0, Math.max(0, warm.length - STABLE_PLAYER_WARM_LIMIT))) {
    stablePlayerTextures.delete(key);
    stablePlayerLastUsed.delete(key);
  }
}

/** Invalidate a loading candidate without altering the currently active snapshot. */
export function supersedeAssetPresentationIntent(): void {
  packGeneration++;
}

function allActiveUrls(): Set<string> {
  return new Set([...activeSkillUrls.values(), ...activePlayerUrls.values(), ...activePlayerOverrideUrls.values()]);
}

function retirementIsIdle(): boolean {
  return !retirementFrameScheduled && !retirementUrls.size && !retiringUrls.size;
}

function resolveRetirementWaitersIfIdle(): void {
  if (!retirementIsIdle()) return;
  for (const resolve of retirementWaiters) resolve();
  retirementWaiters.clear();
}

function scheduleRetirementFrame(): void {
  if (retirementFrameScheduled || typeof requestAnimationFrame !== 'function' || !retirementUrls.size) return;
  retirementFrameScheduled = true;
  // DOM/Pixi commit on the first frame. The second retires URLs that no active or
  // in-flight immutable snapshot owns, so moving tokens and effects keep leases.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    retirementFrameScheduled = false;
    const active = allActiveUrls();
    const loading = new Set([...inFlightUrls.values()].flatMap((set) => [...set]));
    for (const url of [...retirementUrls]) {
      if (active.has(url)) {
        retirementUrls.delete(url);
        continue;
      }
      if (loading.has(url) || retiringUrls.has(url)) continue;
      if ((mountedUrlRefCounts.get(url) ?? 0) > 0) continue;
      retirementUrls.delete(url);
      const retiring = Assets.unload(url)
        .catch(() => { /* best effort; active handles already released this URL */ })
        .finally(() => {
          retiringUrls.delete(url);
          resolveRetirementWaitersIfIdle();
        });
      retiringUrls.set(url, retiring);
    }
    resolveRetirementWaitersIfIdle();
  }));
}

function addMountedUrlRefs(url: string, count: number): void {
  if (count <= 0) return;
  mountedUrlRefCounts.set(url, (mountedUrlRefCounts.get(url) ?? 0) + count);
}

function removeMountedUrlRefs(url: string, count: number): void {
  const remaining = (mountedUrlRefCounts.get(url) ?? count) - count;
  if (remaining > 0) mountedUrlRefCounts.set(url, remaining);
  else mountedUrlRefCounts.delete(url);
}

function updateMountedPlayerTargetUrl(key: string, url: string): void {
  const count = mountedPlayerTargetRefCounts.get(key) ?? 0;
  if (!count) return;
  const previous = mountedPlayerTargetUrls.get(key);
  if (previous === url) return;
  if (previous) removeMountedUrlRefs(previous, count);
  mountedPlayerTargetUrls.set(key, url);
  addMountedUrlRefs(url, count);
}

/** Keep the URL currently backing a mounted player target alive. Hot swaps
 * transfer every mounted ref to the new source; removal retains the old source
 * until the last preserved token is actually destroyed. */
export function retainPlayerSpriteAsset(teamId: string, positionId: string, side?: Exclude<AssetSide, 'any'>, race?: string): () => void {
  const key = resolvePlayerTargetKey(teamId, positionId, side, race);
  const url = activePlayerOverrideUrls.get(key) ?? activePlayerUrls.get(key);
  if (!url) return () => undefined;
  const count = (mountedPlayerTargetRefCounts.get(key) ?? 0) + 1;
  mountedPlayerTargetRefCounts.set(key, count);
  if (count === 1) mountedPlayerTargetUrls.set(key, url);
  addMountedUrlRefs(mountedPlayerTargetUrls.get(key) ?? url, 1);
  touchStablePlayer(key);
  let retained = true;
  return () => {
    if (!retained) return;
    retained = false;
    const heldUrl = mountedPlayerTargetUrls.get(key);
    const remaining = (mountedPlayerTargetRefCounts.get(key) ?? 1) - 1;
    if (heldUrl) removeMountedUrlRefs(heldUrl, 1);
    if (remaining > 0) mountedPlayerTargetRefCounts.set(key, remaining);
    else {
      mountedPlayerTargetRefCounts.delete(key);
      mountedPlayerTargetUrls.delete(key);
    }
    pruneStablePlayerHandles();
    scheduleRetirementFrame();
    resolveRetirementWaitersIfIdle();
  };
}

/** Resolve after mounted Pixi/DOM users have crossed the two-frame hand-off and
 * every cache retirement started by that hand-off has settled. Native pack
 * leases must remain held until this promise completes. */
export async function waitForAssetPresentationRetirement(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    await Promise.all([...retiringUrls.values()]);
    return;
  }
  scheduleRetirementFrame();
  if (retirementIsIdle()) return;
  await new Promise<void>((resolve) => retirementWaiters.add(resolve));
}

function normalizedIconKey(value: string): string {
  const characteristic = /^([+-])(AG|MA|MV|AV|ST|PA)$/i.exec(value.trim());
  if (characteristic) {
    return `stat${characteristic[1] === '+' ? 'up' : 'down'}${characteristic[2]!.toLowerCase()}`;
  }
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function packKey(skillName: string): string {
  const normalized = normalizedIconKey(skillName);
  return skillIconAliases[normalized as keyof typeof skillIconAliases] ?? normalized;
}

export function canonicalSkillIconKey(skillName: string): string {
  return packKey(skillName);
}

function skillTargetKey(skill: string, positionId: string | null, side: AssetSide): string {
  return `${packKey(skill)}\u0000${positionId ?? ''}\u0000${side}`;
}

function playerTargetKey(teamId: string, positionId: string, side: AssetSide = 'any'): string {
  return `${teamId}\u0000${positionId}\u0000${side}`;
}

const bundledSkillIconUrls = new Map<string, string>([
  ['statuppa', new URL('../assets/status/stat-up/pa.png', import.meta.url).href],
  ['statupst', new URL('../assets/status/stat-up/st.png', import.meta.url).href],
  ['statupag', new URL('../assets/status/stat-up/ag.png', import.meta.url).href],
  ['statupav', new URL('../assets/status/stat-up/av.png', import.meta.url).href],
  ['statupma', new URL('../assets/status/stat-up/mv.png', import.meta.url).href],
  ['statupmv', new URL('../assets/status/stat-up/mv.png', import.meta.url).href],
  ['statdownpa', new URL('../assets/status/stat-down/pa.png', import.meta.url).href],
  ['statdownst', new URL('../assets/status/stat-down/st.png', import.meta.url).href],
  ['statdownag', new URL('../assets/status/stat-down/ag.png', import.meta.url).href],
  ['statdownma', new URL('../assets/status/stat-down/mv.png', import.meta.url).href],
  ['statdownav', new URL('../assets/status/stat-down/av.png', import.meta.url).href], // owner 09-07: AV-down art (Dodgy Snack)
  ['statdownmv', new URL('../assets/status/stat-down/mv.png', import.meta.url).href],
  ['ni', new URL('../assets/status/stat-down/ni.png', import.meta.url).href],
]);
// Owner 09-08: the bundled Super FUMBBL skill badges (174 owner-original 48 px PNGs, `assets/skill-badges/<canonical
// key>.png`, see the folder README). They sit BETWEEN an installed pack target and the generated-initials SVG, so a
// fresh install shows real badges without any pack. The status icons above keep their keys (never overridden here).
const bundledSkillArtUrls = import.meta.glob<string>('../assets/skill-badges/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
// Owner 09-09: a second bundled family, the ILLUSTRATED set (`assets/skill-badges-illustrated/<canonical key>.png`,
// Codex Astra art, see that folder's README), offered in Assets & Mods as "Illustrated - Default". Same keys, same
// tier: installed pack target > the SELECTED bundled family > generated initials. Status icons are never swapped.
const bundledIllustratedSkillArtUrls = import.meta.glob<string>('../assets/skill-badges-illustrated/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
// Owner 09-09: each family also ships its 128 px master render (`<family>/128/<key>.png`, straight from the owner's
// project, never a resample of the 48 px badge) for LARGE surfaces — the skill tooltip draws it 1:1 instead of
// blowing the 48 px badge up. Same keys; the pitch and the skill rows keep using the 48 px badges.
const bundledSkillArtLargeUrls = import.meta.glob<string>('../assets/skill-badges/128/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
const bundledIllustratedSkillArtLargeUrls = import.meta.glob<string>('../assets/skill-badges-illustrated/128/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
export type BundledSkillBadgeFamily = 'default' | 'illustrated';
const keyOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.png$/, '');
const BUNDLED_SKILL_BADGE_FAMILIES: Readonly<Record<BundledSkillBadgeFamily, ReadonlyMap<string, string>>> = {
  default: new Map(Object.entries(bundledSkillArtUrls).map(([path, url]) => [keyOf(path), url])),
  illustrated: new Map(Object.entries(bundledIllustratedSkillArtUrls).map(([path, url]) => [keyOf(path), url])),
};
export const BUNDLED_SKILL_BADGE_LARGE_PX = 128;
const BUNDLED_SKILL_BADGE_LARGE_FAMILIES: Readonly<Record<BundledSkillBadgeFamily, ReadonlyMap<string, string>>> = {
  default: new Map(Object.entries(bundledSkillArtLargeUrls).map(([path, url]) => [keyOf(path), url])),
  illustrated: new Map(Object.entries(bundledIllustratedSkillArtLargeUrls).map(([path, url]) => [keyOf(path), url])),
};
// Owner 09-10: the illustrated family is the install default (settings v32) — start there so the FIRST icon load
// fetches the right family instead of loading the flat set, showing initials badges, then reloading on the switch.
let bundledSkillBadgeFamily: BundledSkillBadgeFamily = 'illustrated';
const statusIconKeys = new Set(bundledSkillIconUrls.keys());
function applyBundledFamilyUrls(): void {
  for (const key of [...bundledSkillIconUrls.keys()]) if (!statusIconKeys.has(key)) bundledSkillIconUrls.delete(key);
  for (const [key, url] of BUNDLED_SKILL_BADGE_FAMILIES[bundledSkillBadgeFamily]) {
    if (!bundledSkillIconUrls.has(key)) bundledSkillIconUrls.set(key, url);
  }
}
applyBundledFamilyUrls();
/** Canonical keys of the bundled skill badges of a family (status icons excluded) — test/inspection seam. */
export function bundledSkillBadgeKeys(family: BundledSkillBadgeFamily = 'default', size: 48 | 128 = 48): string[] {
  const families = size === 128 ? BUNDLED_SKILL_BADGE_LARGE_FAMILIES : BUNDLED_SKILL_BADGE_FAMILIES;
  return [...families[family].keys()].sort();
}
export function activeBundledSkillBadgeFamily(): BundledSkillBadgeFamily {
  return bundledSkillBadgeFamily;
}
const bundledSkillIconTextures = new Map<string, Texture>();
/** Owner 09-09: switch the bundled badge family. Before the icons are loaded this only records the choice (the
 *  loader reads it); afterwards it reloads the family's textures, drops the stable handles that pointed at the old
 *  family so the next `skillIcon()` call mints fresh ones, and resolves when the swap is complete. Idempotent. */
export async function setBundledSkillBadgeFamily(family: BundledSkillBadgeFamily): Promise<boolean> {
  if (family === bundledSkillBadgeFamily) return false;
  bundledSkillBadgeFamily = family;
  applyBundledFamilyUrls();
  if (bundledSkillIconTextures.size === 0) return true; // not loaded yet: loadSkillIcons() will use the new family
  const loaded = new Map<string, Texture>();
  await Promise.all([...BUNDLED_SKILL_BADGE_FAMILIES[family]].map(async ([key, url]) => {
    if (statusIconKeys.has(key)) return;
    const texture = await Assets.load<Texture>(url);
    texture.source.scaleMode = 'nearest';
    loaded.set(key, texture);
  }));
  if (family !== bundledSkillBadgeFamily) return false; // superseded by a later switch
  for (const key of [...bundledSkillIconTextures.keys()]) if (!statusIconKeys.has(key)) bundledSkillIconTextures.delete(key);
  for (const [key, texture] of loaded) bundledSkillIconTextures.set(key, texture);
  for (const [requestKey, request] of [...stableSkillRequests]) {
    if (resolveSkillTarget(activeSkillUrls, request.skill, request.context)) continue; // pack-served: untouched
    stableSkillTextures.delete(requestKey); stableSkillRequests.delete(requestKey); stableSkillLastUsed.delete(requestKey);
  }
  return true;
}

/** Owner 09-08: opaque content boxes ([x, y, w, h], alpha > 16) of the bundled 1254 px status icons whose art
 *  carries transparent padding — MA-up fills only 72% of its box while the 48 px skill badges fill theirs, so a
 *  badge row sized from the texture box drew the stat icons visibly smaller. The loader frames each texture on the
 *  SQUARE around its content (no stretch), so every icon in the row fills the same badge. Pinned by test. */
export const STATUS_ICON_CONTENT: Readonly<Record<string, readonly [number, number, number, number]>> = {
  statupag: [52, 35, 1150, 1151],
  statupav: [101, 73, 1055, 1050],
  statupma: [175, 163, 905, 891],
  statupmv: [175, 163, 905, 891],
  statuppa: [49, 51, 1156, 1149],
  statupst: [53, 43, 1148, 1117],
  statdownav: [121, 108, 1012, 1007],
};
const STATUS_ICON_PX = 1254;

/** The square frame around a status icon's content inside its texture, or null when the icon has no content box
 *  (or the texture is not the bundled 1254 px master — test doubles, a pack's own art). */
export function statusIconContentFrame(key: string, width: number, height: number): Rectangle | null {
  const box = STATUS_ICON_CONTENT[key];
  if (!box || width !== STATUS_ICON_PX || height !== STATUS_ICON_PX) return null;
  const [x, y, w, h] = box;
  const side = Math.min(Math.max(w, h), width, height);
  const fx = Math.min(Math.max(0, x + w / 2 - side / 2), width - side);
  const fy = Math.min(Math.max(0, y + h / 2 - side / 2), height - side);
  return new Rectangle(fx, fy, side, side);
}

function statusIconContentTexture(key: string, texture: Texture): Texture {
  const frame = statusIconContentFrame(key, texture.source.width, texture.source.height);
  return frame ? new Texture({ source: texture.source, frame }) : texture;
}

/** A stable handle re-pointed at a new texture keeps that texture's FRAME (a content-framed status icon, a pack's
 *  full-box art) — Pixi's source setter alone leaves the old frame on the new source. */
function retargetHandle(handle: Texture, next: Texture): void {
  handle.frame.copyFrom(next.frame);
  handle.source = next.source;
  handle.update();
}

function bundledSkillIconUrl(skillName: string): string | undefined {
  return bundledSkillIconUrls.get(packKey(skillName));
}

function playerTargetCandidates(teamId: string, positionId: string, side?: Exclude<AssetSide, 'any'>, race?: string): string[] {
  const raceTarget = race ? `race:${race.toLowerCase().replace(/[^a-z0-9]/g, '')}` : '';
  // Owner 09-07: a ruleset-tagged roster ("BB2025 Lizardmen") also tries the plain race's pack bindings, after the
  // exact ones — same fallback the bundled art takes (rosterRaceKey).
  const plainRace = race ? rosterRaceKey(race) : '';
  const plainTarget = plainRace && `race:${plainRace}` !== raceTarget ? `race:${plainRace}` : '';
  return [
    side ? playerTargetKey(teamId, positionId, side) : '',
    playerTargetKey(teamId, positionId, 'any'),
    side && raceTarget ? playerTargetKey(raceTarget, positionId, side) : '',
    raceTarget ? playerTargetKey(raceTarget, positionId, 'any') : '',
    side && plainTarget ? playerTargetKey(plainTarget, positionId, side) : '',
    plainTarget ? playerTargetKey(plainTarget, positionId, 'any') : '',
  ].filter(Boolean);
}

function resolvePlayerTargetKey(teamId: string, positionId: string, side?: Exclude<AssetSide, 'any'>, race?: string): string {
  const candidates = playerTargetCandidates(teamId, positionId, side, race);
  // Tier precedence is deliberate: even a broad user `any`/race choice wins
  // over a more-specific installed-pack row.
  return candidates.find((key) => activePlayerOverrideUrls.has(key))
    ?? candidates.find((key) => activePlayerUrls.has(key))
    ?? playerTargetKey(teamId, positionId, 'any');
}

function skillRequestKey(skill: string, context?: SkillIconContext): string {
  return `${packKey(skill)}\u0000${context?.positionId ?? ''}\u0000${context?.side ?? ''}`;
}

function resolveSkillTarget(
  urls: ReadonlyMap<string, string>,
  skill: string,
  context?: SkillIconContext,
): string | undefined {
  const positionId = context?.positionId || null;
  const side = context?.side || null;
  const candidates: string[] = [];
  if (positionId && side) candidates.push(skillTargetKey(skill, positionId, side));
  if (positionId) candidates.push(skillTargetKey(skill, positionId, 'any'));
  if (side) candidates.push(skillTargetKey(skill, null, side));
  candidates.push(skillTargetKey(skill, null, 'any'));
  for (const key of candidates) if (urls.has(key)) return key;
  return undefined;
}

async function loadInstalledTexture(url: string): Promise<Texture> {
  // Native asset URLs deliberately end in an opaque integrity token rather than a
  // filename. Pixi selects its default image loader by URL extension, so a bare
  // Assets.load(url) resolves null without ever fetching these validated PNGs.
  const texture = await Assets.load<Texture>({ src: url, parser: 'loadTextures' });
  if (!(texture instanceof Texture) || !texture.source) {
    throw new Error('Installed presentation texture could not be decoded');
  }
  return texture;
}

function skillBindings(snapshot: SkillIconPackSnapshot | null): SkillIconBinding[] {
  if (!snapshot) return [];
  return [
    ...Object.entries(snapshot.assets).map(([skill, url]) => ({
      skill, canonicalSkill: packKey(skill), positionId: null, side: 'any' as const, url,
    })),
    ...(snapshot.bindings ?? []),
  ];
}

/** Decode all pitch capabilities, then publish one immutable snapshot. */
export async function activateAssetPresentationPack(snapshot: AssetPresentationSnapshot | null): Promise<boolean> {
  const generation = ++packGeneration;
  const previousUrls = allActiveUrls();
  const skillUrls = new Map<string, string>();
  const skillTextures = new Map<string, Texture>();
  const playerUrls = new Map<string, string>();
  const playerTextures = new Map<string, Texture>();
  const playerOverrideUrls = new Map<string, string>();
  const playerOverrideTextures = new Map<string, Texture>();
  const candidateUrls = new Set([
    ...(snapshot?.skillIcons.map((binding) => binding.url) ?? []),
    ...(snapshot?.playerSprites.map((binding) => binding.url) ?? []),
    ...Object.values(snapshot?.playerSpriteOverrides ?? {}),
  ]);
  inFlightUrls.set(generation, candidateUrls);

  const cleanupCandidate = async () => {
    inFlightUrls.delete(generation);
    const active = allActiveUrls();
    for (const url of candidateUrls) if (!active.has(url)) retirementUrls.add(url);
    scheduleRetirementFrame();
  };

  try {
    await Promise.all((snapshot?.skillIcons ?? []).map(async (binding) => {
      const canonicalSkill = packKey(binding.canonicalSkill);
      const key = skillTargetKey(canonicalSkill, binding.positionId || null, binding.side);
      if (!canonicalSkill || canonicalSkill !== binding.canonicalSkill || skillUrls.has(key)) {
        throw new Error('Invalid or duplicate skill-icon target in installed pack');
      }
      await retiringUrls.get(binding.url);
      const texture = await loadInstalledTexture(binding.url);
      skillUrls.set(key, binding.url);
      skillTextures.set(key, texture);
    }));
    await Promise.all((snapshot?.playerSprites ?? []).map(async (binding) => {
      const key = playerTargetKey(binding.teamId, binding.positionId, binding.side ?? 'any');
      if (!binding.teamId || !binding.positionId || playerUrls.has(key)) throw new Error('Duplicate player-sprite target in installed pack');
      await retiringUrls.get(binding.url);
      const texture = await loadInstalledTexture(binding.url);
      playerUrls.set(key, binding.url);
      playerTextures.set(key, texture);
    }));
    // Owner 09-05 sprite chain: a user-selected per-position file replaces the
    // same installed-pack target. The walk-sheet renderer remains independent.
    await Promise.all(Object.entries(snapshot?.playerSpriteOverrides ?? {}).map(async ([target, url]) => {
      const match = /^([^/]+)\/([^/]+)\/(any|home|away)$/.exec(target);
      if (!match || !url) throw new Error('Invalid player-sprite override target');
      const key = playerTargetKey(match[1]!, match[2]!, match[3] as AssetSide);
      await retiringUrls.get(url);
      const texture = await loadInstalledTexture(url);
      playerOverrideUrls.set(key, url);
      playerOverrideTextures.set(key, texture);
    }));
    await Promise.all([...stableSkillRequests.entries()].map(async ([requestKey, request]) => {
      const target = resolveSkillTarget(skillUrls, request.skill, request.context);
      if (target) return;
      const bundled = bundledSkillIconTextures.get(packKey(request.skill));
      const fallback = bundled ?? await Assets.load<Texture>(generatedSkillIconUrl(request.skill));
      skillTextures.set(`fallback:${requestKey}`, fallback);
    }));
  } catch (error) {
    await cleanupCandidate();
    throw error;
  }

  if (generation !== packGeneration) {
    await cleanupCandidate();
    return false;
  }
  inFlightUrls.delete(generation);

  for (const [requestKey, handle] of stableSkillTextures) {
    const request = stableSkillRequests.get(requestKey)!;
    const target = resolveSkillTarget(skillUrls, request.skill, request.context);
    const next = target ? skillTextures.get(target) : skillTextures.get(`fallback:${requestKey}`);
    if (next) retargetHandle(handle, next);
  }
  for (const [key, handle] of stablePlayerTextures) {
    // Removed targets deliberately keep their old source until the revision-driven
    // board refresh destroys that token and rebuilds through the untouched built-in
    // branch. Mounted-token URL refs extend that hand-off for a preserved movement
    // token until the renderer actually destroys it.
    const next = playerOverrideTextures.get(key) ?? playerTextures.get(key);
    if (next) {
      updateMountedPlayerTargetUrl(key, playerOverrideUrls.get(key) ?? playerUrls.get(key)!);
      handle.source = next.source;
    }
  }

  activeSkillUrls = skillUrls;
  activeSkillTextures = skillTextures;
  activePlayerUrls = playerUrls;
  activePlayerTextures = playerTextures;
  activePlayerOverrideUrls = playerOverrideUrls;
  activePlayerOverrideTextures = playerOverrideTextures;
  for (const url of candidateUrls) retirementUrls.delete(url);
  for (const url of previousUrls) if (!candidateUrls.has(url)) retirementUrls.add(url);
  scheduleRetirementFrame();
  return true;
}

/** V1 compatibility activation; clears player-sprite assignment. */
export function activateSkillIconPack(snapshot: SkillIconPackSnapshot | null): Promise<boolean> {
  return activateAssetPresentationPack(snapshot ? { skillIcons: skillBindings(snapshot), playerSprites: [] } : null);
}

export async function loadSkillIcons(): Promise<void> {
  // Installed assets are prepared before mount or by the hot-swap transaction.
  // These client-owned status icons are the built-in fallback and never affect
  // an installed pack's higher-precedence target.
  await Promise.all([...bundledSkillIconUrls.entries()].map(async ([key, url]) => {
    const texture = await Assets.load<Texture>(url);
    texture.source.scaleMode = 'nearest';
    bundledSkillIconTextures.set(key, statusIconContentTexture(key, texture));
  }));
}

/** Callers without player identity deliberately see only global targets. */
export function skillIcon(
  skillName: string,
  _style: SkillIconStyle = 'bb3',
  context?: SkillIconContext,
): Texture | undefined {
  const target = resolveSkillTarget(activeSkillUrls, skillName, context);
  const bundled = bundledSkillIconTextures.get(packKey(skillName));
  if (!target && !bundled) return undefined;
  const requestKey = skillRequestKey(skillName, context);
  const stable = stableSkillTextures.get(requestKey);
  if (stable) {
    touchStableSkill(requestKey);
    return stable;
  }
  const source = target
    ? activeSkillTextures.get(target)
    : bundled;
  if (!source) return undefined;
  const handle = new Texture({ source: source.source, frame: source.frame.clone(), dynamic: true });
  stableSkillTextures.set(requestKey, handle);
  stableSkillRequests.set(requestKey, { skill: skillName, context });
  touchStableSkill(requestKey);
  pruneStableSkillHandles();
  return handle;
}

/** User-selected target first, then installed-pack exact team/race targets. */
export function playerSpriteUrl(teamId: string, positionId: string, side?: Exclude<AssetSide, 'any'>, race?: string): string | undefined {
  const key = resolvePlayerTargetKey(teamId, positionId, side, race);
  return activePlayerOverrideUrls.get(key) ?? activePlayerUrls.get(key);
}

/** Exact team target first, then an explicit race-position pack row. */
export function playerSpriteAsset(teamId: string, positionId: string, side?: Exclude<AssetSide, 'any'>, race?: string): PlayerSpriteAsset | undefined {
  const key = resolvePlayerTargetKey(teamId, positionId, side, race);
  const url = playerSpriteUrl(teamId, positionId, side, race);
  if (!url) return undefined;
  const stable = stablePlayerTextures.get(key);
  if (stable) {
    touchStablePlayer(key);
    return { texture: stable, url };
  }
  const source = activePlayerOverrideTextures.get(key) ?? activePlayerTextures.get(key);
  if (!source) return undefined;
  const handle = new Texture({ source: source.source, dynamic: true });
  stablePlayerTextures.set(key, handle);
  touchStablePlayer(key);
  pruneStablePlayerHandles();
  return { texture: handle, url };
}

/** Existing callers retain exact-team behavior unless they supply race context. */
export function playerSprite(teamId: string, positionId: string, side?: Exclude<AssetSide, 'any'>, race?: string): Texture | undefined {
  return playerSpriteAsset(teamId, positionId, side, race)?.texture;
}

export interface SkillBadgePresentation {
  label: string;
  fill: number;
  stroke: number;
}

const CHARACTERISTIC_BADGES: Record<string, string> = {
  AG: 'Ag',
  MA: 'Mv',
  MV: 'Mv',
  AV: 'Av',
  ST: 'St',
  PA: 'Pa',
};

/** Generated/fallback badge styling for characteristic changes and ordinary skills. */
export function skillBadgePresentation(skillName: string): SkillBadgePresentation {
  const characteristic = /^([+-])(AG|MA|MV|AV|ST|PA)$/i.exec(skillName.trim());
  if (characteristic) {
    const increase = characteristic[1] === '+';
    return {
      label: CHARACTERISTIC_BADGES[characteristic[2]!.toUpperCase()]!,
      fill: increase ? 0x176b3a : 0x842a2a,
      stroke: increase ? 0x62d690 : 0xff6b6b,
    };
  }

  const words = skillName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const label = !words.length
    ? '?'
    : words.length === 1
      ? words[0]!.slice(0, 2).toUpperCase()
      : words.slice(0, 3).map((word) => word[0]!.toUpperCase()).join('');
  return { label, fill: 0x171a1f, stroke: 0xd7b640 };
}

const generatedUrls = new Map<string, string>();

export function generatedSkillIconUrl(skillName: string): string {
  const presentation = skillBadgePresentation(skillName);
  const { label } = presentation;
  const cacheKey = `${label}:${presentation.fill}:${presentation.stroke}`;
  const cached = generatedUrls.get(cacheKey);
  if (cached) return cached;
  const fontSize = label.length >= 3 ? 18 : 22;
  const fill = `#${presentation.fill.toString(16).padStart(6, '0')}`;
  const stroke = `#${presentation.stroke.toString(16).padStart(6, '0')}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect x="2" y="2" width="44" height="44" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="3"/><text x="24" y="25" dominant-baseline="middle" text-anchor="middle" fill="#fff4bf" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="800">${label}</text></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  generatedUrls.set(cacheKey, url);
  return url;
}

export function skillIconUrl(
  skillName: string,
  _style: SkillIconStyle = 'bb3',
  context?: SkillIconContext,
): string {
  const target = resolveSkillTarget(activeSkillUrls, skillName, context);
  return (target ? activeSkillUrls.get(target) : undefined)
    ?? bundledSkillIconUrl(skillName)
    ?? generatedSkillIconUrl(skillName);
}

/**
 * Owner 09-09: the icon for a LARGE surface (skill tooltip). Same precedence as skillIconUrl, except the bundled tier
 * serves the selected family's 128 px master when it has one (`size: 128`, draw 1:1). A pack target, a status icon
 * or the generated fallback comes back as the 48 px icon (`size: 48`, draw at an integer multiple).
 */
export function skillIconLarge(
  skillName: string,
  context?: SkillIconContext,
): { url: string; size: 48 | 128 } {
  const target = resolveSkillTarget(activeSkillUrls, skillName, context);
  const packUrl = target ? activeSkillUrls.get(target) : undefined;
  if (packUrl) return { url: packUrl, size: 48 };
  const key = packKey(skillName);
  const large = statusIconKeys.has(key) ? undefined : BUNDLED_SKILL_BADGE_LARGE_FAMILIES[bundledSkillBadgeFamily].get(key);
  if (large) return { url: large, size: BUNDLED_SKILL_BADGE_LARGE_PX };
  return { url: bundledSkillIconUrl(skillName) ?? generatedSkillIconUrl(skillName), size: 48 };
}
