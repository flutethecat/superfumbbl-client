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
import skillNames from '../assets/skillNames.json';
import builtInAssetTargets from '../assets/assetTargetRaces.json';
import {
  assetMods,
  beginSkillPackIntent,
  commitSkillPackSelection,
  isCurrentSkillPackIntent,
  publishTeamLogoBindings,
} from './assetMods';
import { data, t, terms, tEveryLocale } from '../i18n';
import { positionDisplayName, rosterDisplayName } from './rosterNames';

export interface SkillPackChoiceTransaction {
  installId: string;
  previousInstallId: string;
  persist: (activeInstallId: string) => void;
  setChoice: (installId: string) => void;
  intent?: number;
}

export interface AssetTargetPositionChoice {
  positionId: string;
  /** The genuine name, or (generated) the invariant English fallback. */
  label: string;
  /** Provenance (i18n, Astra r3 #17): true = no genuine name was known, the display derives "Position {id}" in the
   *  current language. Absent only on legacy records, which are healed heuristically once. */
  generated?: boolean;
}

export interface AssetTargetTeamChoice {
  teamId: string;
  /** The genuine name, or (generated) the invariant English fallback. */
  label: string;
  /** Provenance (see AssetTargetPositionChoice.generated). */
  generated?: boolean;
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
  for (const label of [...(skillNames as string[])].sort((a, b) => a.localeCompare(b))) {
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

// i18n (Astra r2 #15): the catalogue is DATA persisted to device storage, so a generated fallback is stored as the
// invariant English form and only localised at display (assetTargetTeamLabel / assetTargetPositionLabel).
function fallbackTeamLabel(teamId: string): string { return data(`Team ${teamId}`); }
function fallbackPositionLabel(positionId: string): string { return data(`Position ${positionId}`); }
/** LEGACY records only (no provenance field): a label equal to the fallback in any locale was generated. */
function isLegacyFallbackLabel(label: string, id: string, kind: 'team' | 'position'): boolean {
  if (label === (kind === 'team' ? fallbackTeamLabel(id) : fallbackPositionLabel(id))) return true;
  return kind === 'team'
    ? tEveryLocale('assets.text.teamTeamid', { teamId: id }).includes(label)
    : tEveryLocale('assets.text.positionPositionid', { positionId: id }).includes(label);
}
/** A record's provenance: an explicit `generated` flag is trusted as it stands (a supplied name is never re-inferred);
 *  only a legacy record without the flag is classified by the heuristic. */
function provenance(raw: { label?: unknown; generated?: unknown } | null | undefined, id: string, kind: 'team' | 'position'): { label: string; generated: boolean } {
  const fallback = kind === 'team' ? fallbackTeamLabel(id) : fallbackPositionLabel(id);
  const supplied = typeof raw?.label === 'string' ? raw.label.trim() : '';
  if (typeof raw?.generated === 'boolean') return raw.generated || !supplied ? { label: fallback, generated: true } : { label: supplied, generated: false };
  if (!supplied || isLegacyFallbackLabel(supplied, id, kind)) return { label: fallback, generated: true };
  return { label: supplied, generated: false };
}
/** A freshly observed name: genuine when supplied, else generated. Never inferred from the text. */
function observed(value: unknown, id: string, kind: 'team' | 'position'): { label: string; generated: boolean } {
  const supplied = typeof value === 'string' ? value.trim() : '';
  return supplied ? { label: supplied, generated: false } : { label: kind === 'team' ? fallbackTeamLabel(id) : fallbackPositionLabel(id), generated: true };
}
const isGenerated = (choice: { label: string; generated?: boolean }, id: string, kind: 'team' | 'position'): boolean =>
  choice.generated ?? isLegacyFallbackLabel(choice.label, id, kind);
/** Display label for a catalogue team: a roster target (`race:<id>`) shows its roster name in the current language,
 *  a real team its genuine name, else the localised "Team {id}". */
export function assetTargetTeamLabel(team: Pick<AssetTargetTeamChoice, 'teamId' | 'label' | 'generated'>): string {
  if (team.teamId.startsWith('race:')) return terms(rosterDisplayName(team.teamId));
  return isGenerated(team, team.teamId, 'team') ? t('assets.text.teamTeamid', { teamId: team.teamId }) : team.label;
}
/** Display label for a catalogue position: the genuine name, else the localised "Position {id}". */
export function assetTargetPositionLabel(position: Pick<AssetTargetPositionChoice, 'positionId' | 'label' | 'generated'>): string {
  if (isGenerated(position, position.positionId, 'position')) return t('assets.text.positionPositionid', { positionId: position.positionId });
  // a position known to the term dictionaries shows its proper name in the current language (ids like `goblinbruiser`)
  return terms(positionDisplayName(position.positionId, position.label));
}

function normalizedCatalog(raw: unknown): AssetTargetCatalog {
  const value = raw as Partial<AssetTargetCatalog> | null;
  const positions = new Map<string, AssetTargetPositionChoice>();
  const teams = new Map<string, AssetTargetTeamChoice>();
  // a genuine name replaces a generated one; otherwise the earlier (more recent) record stays
  const mergePosition = (target: Map<string, AssetTargetPositionChoice>, raw: Partial<AssetTargetPositionChoice> | null | undefined) => {
    const id = stableTargetId(raw?.positionId);
    if (!id) return;
    const next = provenance(raw, id, 'position');
    const previous = target.get(id);
    if (!previous || (previous.generated && !next.generated)) target.set(id, { positionId: id, ...next });
  };
  if (Array.isArray(value?.positions)) {
    for (const position of value.positions) mergePosition(positions, position);
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
        mergePosition(teamPositions, position);
        mergePosition(positions, position);
      }
      const next = provenance(team, teamId, 'team');
      const keep = previousTeam && (!previousTeam.generated || next.generated);
      teams.set(teamId, {
        teamId,
        ...(keep ? { label: previousTeam.label, generated: previousTeam.generated ?? false } : next),
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
    const choice: AssetTargetPositionChoice = { positionId: id, ...observed(label, id, 'position') };
    incomingPositions.push(choice);
    team?.positions.push(choice);
  };
  for (const team of [game?.teamHome, game?.teamAway]) {
    const teamId = stableTargetId(team?.teamId);
    if (!teamId) continue;
    const choice: AssetTargetTeamChoice = {
      teamId,
      ...observed(team?.teamName ?? team?.name, teamId, 'team'),
      positions: [],
    };
    const rosterNames = new Map<string, string>();
    for (const position of team?.roster?.positionArray ?? []) {
      const id = stableTargetId(position.positionId);
      const name = position.positionName ?? position.name;
      if (id && typeof name === 'string' && name.trim()) rosterNames.set(id, name.trim());
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
      team = { teamId, ...observed(undefined, teamId, 'team'), positions: [] };
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
