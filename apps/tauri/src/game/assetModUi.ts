import { watch, type WatchStopHandle } from 'vue';
import {
  canonicalSkillIconKey,
  playerSpriteUrl as sharedPlayerSpriteUrl,
  skillIconUrl as sharedSkillIconUrl,
  skillIconLarge as sharedSkillIconLarge,
  type AssetSide,
  type SkillIconContext,
  type SkillIconStyle,
} from '@fumbbl40k/ffb-pitch';
import skillDescriptions from '../assets/skillDescriptions.json';
import builtInAssetTargets from '../assets/assetTargetRaces.json';
import {
  assetMods,
  beginSkillPackIntent,
  commitSkillPackSelection,
  isCurrentSkillPackIntent,
  publishTeamLogoBindings,
} from './assetMods';

export interface SkillPackChoiceTransaction {
  installId: string;
  previousInstallId: string;
  persist: (activeInstallId: string) => void;
  setChoice: (installId: string) => void;
  intent?: number;
}

export interface AssetTargetPositionChoice {
  positionId: string;
  label: string;
}

export interface AssetTargetTeamChoice {
  teamId: string;
  label: string;
  positions: AssetTargetPositionChoice[];
}

export interface AssetTargetCatalog {
  teams: AssetTargetTeamChoice[];
  /** Position-specific skill icons do not require a team, so retain those targets separately. */
  positions: AssetTargetPositionChoice[];
}

export interface SkillTargetChoice {
  /** Canonical, wire-independent key used in the exported mod binding. */
  id: string;
  label: string;
}

export const ASSET_TARGET_CATALOG_STORAGE_KEY = 'fumbbl40k.asset-targets.v1';

export const SKILL_TARGET_CHOICES: readonly SkillTargetChoice[] = (() => {
  const choices = new Map<string, SkillTargetChoice>();
  for (const label of Object.keys(skillDescriptions as Record<string, string>).sort((a, b) => a.localeCompare(b))) {
    const id = canonicalSkillIconKey(label);
    if (id && !choices.has(id)) choices.set(id, { id, label });
  }
  return [...choices.values()];
})();

type LoosePosition = { positionId?: unknown; positionName?: unknown; name?: unknown };
type LoosePlayer = LoosePosition;
type LooseTeam = {
  teamId?: unknown;
  teamName?: unknown;
  name?: unknown;
  playerArray?: LoosePlayer[];
  roster?: { positionArray?: LoosePosition[] };
};
type LooseGame = { teamHome?: LooseTeam; teamAway?: LooseTeam };
type LooseDraft = { items?: Array<{ target?: Record<string, unknown> }> };
type LooseInstalledPack = {
  playerSpriteBindings?: Array<{ teamId?: unknown; positionId?: unknown }>;
  walkSheetBindings?: Array<{ teamId?: unknown; positionId?: unknown }>;
  skillIconBindings?: Array<{ positionId?: unknown }>;
};

function stableTargetId(value: unknown): string {
  const id = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(id) ? id : '';
}

function usefulLabel(value: unknown, fallback: string): string {
  const label = typeof value === 'string' ? value.trim() : '';
  return label || fallback;
}

function fallbackTeamLabel(teamId: string): string { return `Team ${teamId}`; }
function fallbackPositionLabel(positionId: string): string { return `Position ${positionId}`; }
function isFallbackLabel(label: string, id: string, kind: 'team' | 'position'): boolean {
  return label === (kind === 'team' ? fallbackTeamLabel(id) : fallbackPositionLabel(id));
}

function normalizedCatalog(raw: unknown): AssetTargetCatalog {
  const value = raw as Partial<AssetTargetCatalog> | null;
  const positions = new Map<string, AssetTargetPositionChoice>();
  const teams = new Map<string, AssetTargetTeamChoice>();
  const mergePosition = (target: Map<string, AssetTargetPositionChoice>, positionId: unknown, label?: unknown) => {
    const id = stableTargetId(positionId);
    if (!id) return;
    const nextLabel = usefulLabel(label, fallbackPositionLabel(id));
    const previous = target.get(id);
    if (!previous || (isFallbackLabel(previous.label, id, 'position') && !isFallbackLabel(nextLabel, id, 'position'))) {
      target.set(id, { positionId: id, label: nextLabel });
    }
  };
  if (Array.isArray(value?.positions)) {
    for (const position of value.positions) mergePosition(positions, position?.positionId, position?.label);
  }
  if (Array.isArray(value?.teams)) {
    for (const team of value.teams) {
      const teamId = stableTargetId(team?.teamId);
      if (!teamId) continue;
      const previousTeam = teams.get(teamId);
      const teamPositions = new Map<string, AssetTargetPositionChoice>(
        previousTeam?.positions.map((position) => [position.positionId, position]) ?? [],
      );
      for (const position of Array.isArray(team.positions) ? team.positions : []) {
        mergePosition(teamPositions, position?.positionId, position?.label);
        mergePosition(positions, position?.positionId, position?.label);
      }
      const nextLabel = usefulLabel(team?.label, fallbackTeamLabel(teamId));
      teams.set(teamId, {
        teamId,
        label: previousTeam && (!isFallbackLabel(previousTeam.label, teamId, 'team') || isFallbackLabel(nextLabel, teamId, 'team'))
          ? previousTeam.label : nextLabel,
        positions: [...teamPositions.values()],
      });
    }
  }
  return { teams: [...teams.values()].slice(0, 128), positions: [...positions.values()].slice(0, 1024) };
}

export function loadAssetTargetCatalog(storage: Pick<Storage, 'getItem'> | null = safeLocalStorage()): AssetTargetCatalog {
  if (!storage) return normalizedCatalog(builtInAssetTargets);
  try {
    const local = JSON.parse(storage.getItem(ASSET_TARGET_CATALOG_STORAGE_KEY) ?? 'null') as Partial<AssetTargetCatalog> | null;
    return normalizedCatalog({
      teams: [...(local?.teams ?? []), ...builtInAssetTargets.teams],
      positions: [...(local?.positions ?? []), ...builtInAssetTargets.positions],
    });
  }
  catch { return normalizedCatalog(builtInAssetTargets); }
}

function safeLocalStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
}

/**
 * Keep a bounded, device-local target library. Match/draft/installed metadata is
 * already on the device; this intentionally performs no lookup and never turns
 * a display name into an authoritative binding key.
 */
export function rememberAssetTargetCatalog(input: {
  game?: unknown;
  drafts?: readonly unknown[];
  installed?: readonly unknown[];
}, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocalStorage()): AssetTargetCatalog {
  const game = input.game as LooseGame | null | undefined;
  const drafts = (input.drafts ?? []) as readonly LooseDraft[];
  const installed = (input.installed ?? []) as readonly LooseInstalledPack[];
  const previous = loadAssetTargetCatalog(storage);
  const incomingTeams: AssetTargetTeamChoice[] = [];
  const incomingPositions: AssetTargetPositionChoice[] = [];
  const addLoosePosition = (positionId: unknown, label?: unknown, team?: AssetTargetTeamChoice) => {
    const id = stableTargetId(positionId);
    if (!id) return;
    const choice = { positionId: id, label: usefulLabel(label, fallbackPositionLabel(id)) };
    incomingPositions.push(choice);
    team?.positions.push(choice);
  };
  for (const team of [game?.teamHome, game?.teamAway]) {
    const teamId = stableTargetId(team?.teamId);
    if (!teamId) continue;
    const choice: AssetTargetTeamChoice = {
      teamId,
      label: usefulLabel(team?.teamName ?? team?.name, fallbackTeamLabel(teamId)),
      positions: [],
    };
    const rosterNames = new Map<string, string>();
    for (const position of team?.roster?.positionArray ?? []) {
      const id = stableTargetId(position.positionId);
      if (id) rosterNames.set(id, usefulLabel(position.positionName ?? position.name, fallbackPositionLabel(id)));
      addLoosePosition(position.positionId, position.positionName ?? position.name, choice);
    }
    for (const player of team?.playerArray ?? []) {
      const id = stableTargetId(player.positionId);
      addLoosePosition(id, player.positionName ?? player.name ?? rosterNames.get(id), choice);
    }
    incomingTeams.push(choice);
  }
  const draftSpriteTargets: Array<{ teamId?: unknown; positionId?: unknown }> = [];
  for (const draft of drafts) for (const item of draft.items ?? []) {
    const target = item.target;
    if (target?.kind === 'playerSprite' || target?.kind === 'walkSheet') {
      draftSpriteTargets.push({ teamId: target.teamId, positionId: target.positionId });
    }
    if (target?.kind === 'skillIcon') addLoosePosition(target.positionId);
  }
  for (const pack of installed) {
    for (const binding of pack.playerSpriteBindings ?? []) draftSpriteTargets.push(binding);
    for (const binding of pack.walkSheetBindings ?? []) draftSpriteTargets.push(binding);
    for (const binding of pack.skillIconBindings ?? []) addLoosePosition(binding.positionId);
  }
  for (const target of draftSpriteTargets) {
    const teamId = stableTargetId(target.teamId);
    if (!teamId) continue;
    let team = incomingTeams.find((candidate) => candidate.teamId === teamId);
    if (!team) {
      team = { teamId, label: fallbackTeamLabel(teamId), positions: [] };
      incomingTeams.push(team);
    }
    addLoosePosition(target.positionId, undefined, team);
  }
  // New observations come first (recent), while normalization upgrades fallback
  // labels to names whenever later local match metadata supplies them.
  const catalog = normalizedCatalog({
    teams: [...incomingTeams, ...previous.teams],
    positions: [...incomingPositions, ...previous.positions],
  });
  try { storage?.setItem(ASSET_TARGET_CATALOG_STORAGE_KEY, JSON.stringify(catalog)); }
  catch { /* A full/disabled browser store must not block the asset creator. */ }
  return catalog;
}

/** Settings dropdown/import/discard all share this decode → swap → persist rail. */
export async function transactSkillPackChoice(input: SkillPackChoiceTransaction): Promise<boolean> {
  const intent = input.intent ?? beginSkillPackIntent();
  const activated = await commitSkillPackSelection(input.installId, input.persist, intent);
  if (!isCurrentSkillPackIntent(intent)) return false;
  input.setChoice(activated ? assetMods.activeInstallId : input.previousInstallId);
  return activated;
}

export function toggleSkillDisplay(settings: {
  skillDisplay: 'icons' | 'markings';
}): void {
  settings.skillDisplay = settings.skillDisplay === 'icons' ? 'markings' : 'icons';
}

/** Vue-tracked DOM resolver; the underlying shared snapshot remains framework-free. */
export function reactiveSkillIconUrl(skill: string, style: SkillIconStyle = 'bb3', context?: SkillIconContext): string {
  void assetMods.revision;
  return sharedSkillIconUrl(skill, style, context);
}

/** Vue-tracked large-surface icon (128 px master when the bundled family has one) — see skillIconLarge. */
export function reactiveSkillIconLarge(skill: string, context?: SkillIconContext): { url: string; size: 48 | 128 } {
  void assetMods.revision;
  return sharedSkillIconLarge(skill, context);
}

/** Vue-tracked DOM player-sprite resolver backed by the active local pack. */
export function reactivePlayerSpriteUrl(
  teamId: string,
  positionId: string,
  side?: Exclude<AssetSide, 'any'>,
  race?: string,
): string | null {
  void assetMods.revision;
  return sharedPlayerSpriteUrl(teamId, positionId, side, race) ?? null;
}

/** Mounted Pixi surfaces rebuild once after each successful atomic activation. */
export function watchAssetModRendererRefresh(refresh: () => void): WatchStopHandle {
  return watch(() => assetMods.revision, refresh);
}

export interface AssetSurfaceRenderer {
  refreshSkillIconAssets(): void;
  playerPortrait(playerId: string): string | null;
}

/** Shared Modern/Classic revision action: rebuild pitch + dugout tokens, clear
 * any host portrait caches, then re-extract every currently mounted card. */
export function refreshAssetRendererSurfaces(
  renderer: AssetSurfaceRenderer | null,
  portraitPlayerIds: readonly string[],
  portraitCaches: readonly Map<unknown, unknown>[] = [],
): Map<string, string | null> {
  for (const cache of portraitCaches) cache.clear();
  if (!renderer) return new Map(portraitPlayerIds.map((id) => [id, null]));
  renderer.refreshSkillIconAssets();
  return new Map(portraitPlayerIds.map((id) => [id, renderer.playerPortrait(id)]));
}

export async function restoreSettingsSnapshotTransaction<T extends {
  assetPackAssignments?: unknown;
  skillIconPackInstallId?: unknown;
}>(input: {
  snapshotText: string;
  restoreAssets: (requested: unknown) => Promise<{
    skillIcons: string;
    playerSprites: string;
    walkSheets: string;
    soundEvents: string;
  } | null>;
  apply: (snapshot: T) => void;
}): Promise<boolean> {
  const snapshot = JSON.parse(input.snapshotText) as T;
  const active = await input.restoreAssets(snapshot.assetPackAssignments ?? {});
  if (!active) return false;
  snapshot.assetPackAssignments = { ...active };
  snapshot.skillIconPackInstallId = active.skillIcons;
  input.apply(snapshot);
  publishTeamLogoBindings();
  return true;
}
