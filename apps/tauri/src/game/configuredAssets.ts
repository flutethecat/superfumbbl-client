import walkManifest from '../../../../packages/ffb-pitch/assets/walk/manifest.json';
import type { AssetTargetCatalog, AssetTargetPositionChoice, AssetTargetTeamChoice } from './assetModUi';
import { userFilesPack, type AssetPackAssignments, type InstalledAssetPack } from './assetMods';

export type ConfiguredAssetSource = 'Built-in default' | 'Your file' | string;
export type SpriteSide = 'any' | 'home' | 'away';

export interface ConfiguredSpriteVariant {
  side: SpriteSide;
  url: string | null;
  source: ConfiguredAssetSource;
  overrideKey: string;
  userOverride: boolean;
}

export interface ConfiguredSpriteRow {
  positionId: string;
  label: string;
  variants: ConfiguredSpriteVariant[];
}

export interface ConfiguredSpriteTeam extends AssetTargetTeamChoice {
  raceKey: string;
  rows: ConfiguredSpriteRow[];
}

export interface ConfiguredSoundRow {
  id: string;
  label: string;
  source: ConfiguredAssetSource;
  url: string | null;
  userOverride: boolean;
}

export interface ConfiguredLogoRow {
  race: string;
  source: ConfiguredAssetSource;
  url: string | null;
  userOverride: boolean;
}

export interface ConfiguredBlockDieRow {
  face: string;
  label: string;
  source: ConfiguredAssetSource;
  url: string | null;
  userOverride: boolean;
}

export interface ConfiguredOtherRow {
  kind: 'Walk sheet' | 'Pitch image' | 'Skill icons';
  id: string;
  source: ConfiguredAssetSource;
}

export interface ConfiguredAssetsState {
  baseTeams: ConfiguredSpriteTeam[];
  secretLeagueTeams: ConfiguredSpriteTeam[];
  sounds: ConfiguredSoundRow[];
  logos: ConfiguredLogoRow[];
  blockDice: ConfiguredBlockDieRow[];
  other: ConfiguredOtherRow[];
}

type WalkManifestRow = { race: string; role: string; side: SpriteSide; file: string };
const BUILT_IN_WALK_ROWS = (walkManifest.sheets as WalkManifestRow[]);

/** Canonical base-team membership comes only from packages/ffb-pitch/assets/walk/manifest.json. */
export const BASE_TEAM_RACES = [...new Set(BUILT_IN_WALK_ROWS.map((row) => row.race))].sort();
const BASE_TEAM_SET = new Set(BASE_TEAM_RACES);

export function spriteOverrideKey(teamId: string, positionId: string, side: SpriteSide): string {
  return `${teamId}/${positionId}/${side}`;
}

function selectedPack(installed: readonly InstalledAssetPack[], installId: string): InstalledAssetPack | undefined {
  return installed.find((pack) => pack.installId === installId);
}

function raceKeyForTeam(teamId: string): string {
  return teamId.startsWith('race:') ? teamId.slice(5) : teamId;
}

function canonicalLogoId(value: string): string {
  const trimmed = value.trim();
  const direct = /^([1-9]\d{0,18})$/.exec(trimmed);
  if (direct) return direct[1]!;
  return /(?:^|\/)i\/([1-9]\d{0,18})(?:\.(?:png|gif))?$/i.exec(trimmed)?.[1] ?? '';
}

function mergeTeams(catalog: AssetTargetCatalog): AssetTargetTeamChoice[] {
  const teams = new Map(catalog.teams.map((team) => [team.teamId, {
    ...team, positions: [...team.positions],
  }]));
  for (const race of BASE_TEAM_RACES) {
    const teamId = `race:${race}`;
    const positions = BUILT_IN_WALK_ROWS.filter((row) => row.race === race)
      .map((row) => ({ positionId: `${race}.${row.role}`, label: row.role }))
      .filter((row, index, all) => all.findIndex((candidate) => candidate.positionId === row.positionId) === index);
    const current = teams.get(teamId);
    if (current) {
      const mergedPositions = new Map(current.positions.map((position) => [position.positionId, position]));
      for (const position of positions) if (!mergedPositions.has(position.positionId)) mergedPositions.set(position.positionId, position);
      current.positions = [...mergedPositions.values()];
    } else {
      teams.set(teamId, { teamId, label: race, positions });
    }
  }
  return [...teams.values()];
}

function spriteRows(
  team: AssetTargetTeamChoice,
  packs: readonly InstalledAssetPack[],
  userPack: InstalledAssetPack | undefined,
): ConfiguredSpriteRow[] {
  const positionMap = new Map<string, AssetTargetPositionChoice>(team.positions.map((position) => [position.positionId, position]));
  for (const pack of packs) {
    for (const binding of pack.playerSpriteBindings ?? []) {
      if (binding.teamId === team.teamId && !positionMap.has(binding.positionId)) {
        positionMap.set(binding.positionId, { positionId: binding.positionId, label: binding.positionId });
      }
    }
  }
  for (const binding of userPack?.playerSpriteBindings ?? []) {
    if (binding.teamId === team.teamId && !positionMap.has(binding.positionId)) {
      positionMap.set(binding.positionId, { positionId: binding.positionId, label: binding.positionId });
    }
  }
  return [...positionMap.values()].map((position) => {
    const bindings = packs.flatMap((pack) => (pack.playerSpriteBindings ?? [])
      .filter((binding) => binding.teamId === team.teamId && binding.positionId === position.positionId)
      .map((binding) => ({ binding, pack })));
    const userBindings = (userPack?.playerSpriteBindings ?? []).filter((binding) =>
      binding.teamId === team.teamId && binding.positionId === position.positionId);
    const sides = new Set<SpriteSide>(['home', 'away']);
    for (const { binding } of bindings) sides.add(binding.side ?? 'any');
    for (const binding of userBindings) sides.add(binding.side ?? 'any');
    return {
      positionId: position.positionId,
      label: position.label,
      variants: [...sides].map((side) => {
        const overrideKey = spriteOverrideKey(team.teamId, position.positionId, side);
        const provider = bindings.find(({ binding }) => (binding.side ?? 'any') === side);
        const packed = provider?.binding.url ?? null;
        const user = userBindings.find((binding) => (binding.side ?? 'any') === side)?.url ?? null;
        return {
          side,
          overrideKey,
          url: user ?? packed,
          source: user ? 'Your file' : packed && provider ? provider.pack.name : 'Built-in default',
          userOverride: !!user,
        };
      }),
    };
  });
}

export function buildConfiguredAssets(input: {
  catalog: AssetTargetCatalog;
  installed: readonly InstalledAssetPack[];
  assignments: AssetPackAssignments;
  soundCatalog: readonly { id: string; label: string }[];
  raceLogos: Readonly<Record<string, string>>;
}): ConfiguredAssetsState {
  const spritePack = selectedPack(input.installed, input.assignments.playerSprites);
  const soundPack = selectedPack(input.installed, input.assignments.soundEvents);
  const logoPack = selectedPack(input.installed, input.assignments.teamLogos);
  const blockDicePack = selectedPack(input.installed, input.assignments.blockDice);
  const walkPack = selectedPack(input.installed, input.assignments.walkSheets);
  const skillPack = selectedPack(input.installed, input.assignments.skillIcons);
  const userPack = userFilesPack(input.installed);
  const fallbackPacks = (selected: InstalledAssetPack | undefined): InstalledAssetPack[] => [
    ...(selected ? [selected] : []),
    ...input.installed.filter((pack) => pack !== userPack && pack.installId !== selected?.installId),
  ];
  const spritePacks = fallbackPacks(spritePack);
  const soundPacks = fallbackPacks(soundPack);
  const walkPacks = [userPack, ...fallbackPacks(walkPack)].filter((pack): pack is InstalledAssetPack => !!pack);
  const skillPacks = fallbackPacks(skillPack);
  const teams = mergeTeams(input.catalog).map((team) => ({
    ...team,
    raceKey: raceKeyForTeam(team.teamId),
    rows: spriteRows(team, spritePacks, userPack),
  })).sort((left, right) => left.label.localeCompare(right.label));

  const sounds = input.soundCatalog.map(({ id, label }) => {
    const provider = soundPacks.find((pack) => pack.soundEventBindings?.some((binding) => binding.eventId === id));
    const packed = provider?.soundEventBindings?.find((binding) => binding.eventId === id)?.url ?? null;
    const user = userPack?.soundEventBindings?.find((binding) => binding.eventId === id)?.url ?? null;
    return {
      id, label,
      url: user ?? packed,
      source: user ? 'Your file' : packed && provider ? provider.name : 'Built-in default',
      userOverride: !!user,
    };
  });
  const logoOrder = [
    ...input.installed.filter((pack) => pack !== userPack && pack.installId === logoPack?.installId),
    ...input.installed.filter((pack) => pack !== userPack && pack.installId !== logoPack?.installId && pack.installId === input.assignments.playerSprites),
    ...input.installed.filter((pack) => pack !== userPack && pack.installId !== logoPack?.installId && pack.installId !== input.assignments.playerSprites),
  ];
  const logos = Object.keys(input.raceLogos).map((race) => {
    const target = canonicalLogoId(input.raceLogos[race]!);
    const provider = logoOrder.find((pack) => [...Object.keys(pack.logoImageBindings ?? {}), ...Object.keys(pack.classicImageBindings ?? {})]
      .some((key) => canonicalLogoId(key) === target));
    const packed = provider
      ? [...Object.entries(provider.logoImageBindings ?? {}), ...Object.entries(provider.classicImageBindings ?? {})]
        .find(([key]) => canonicalLogoId(key) === target)?.[1] ?? null
      : null;
    const user = userPack?.logoImageBindings?.[race] ?? null;
    return {
      race,
      url: user ?? packed,
      source: user ? 'Your file' : packed && provider ? provider.name : 'Built-in default',
      userOverride: !!user,
    };
  });
  const blockDice = [
    ['skull', 'Skull'],
    ['bothdown', 'Both down'],
    ['push', 'Push'],
    ['powpush', 'Pow / push'],
    ['pow', 'Pow'],
  ].map(([face, label]) => {
    const user = userPack?.blockDiceBindings?.[face!] ?? null;
    const packed = blockDicePack?.blockDiceBindings?.[face!] ?? null;
    return {
      face: face!, label: label!, url: user ?? packed,
      source: user ? 'Your file' : packed && blockDicePack
        ? `${blockDicePack.name} ${blockDicePack.version}` : 'Built-in Super FUMBBL faces',
      userOverride: !!user,
    };
  });

  const other: ConfiguredOtherRow[] = [];
  const walkTargets = new Set<string>();
  for (const pack of walkPacks) for (const binding of pack.walkSheetBindings ?? []) {
    const id = `${binding.teamId}/${binding.positionId}/${binding.side ?? 'any'}`;
    if (!walkTargets.has(id)) other.push({ kind: 'Walk sheet', id, source: pack.name });
    walkTargets.add(id);
  }
  if (!walkTargets.size) {
    for (const row of BUILT_IN_WALK_ROWS) other.push({
      kind: 'Walk sheet', id: `${row.race}/${row.role}/${row.side}`, source: 'Built-in Super FUMBBL walkers',
    });
  }
  for (const pack of input.installed) for (const id of Object.keys(pack.pitchImageBindings ?? {})) {
    other.push({ kind: 'Pitch image', id, source: pack.name });
  }
  if (!other.some((row) => row.kind === 'Pitch image')) other.push({ kind: 'Pitch image', id: 'Current pitch family', source: 'Built-in default' });
  const skillTargets = new Set<string>();
  for (const pack of skillPacks) {
    const ids = pack.skillIconBindings?.map((binding) => binding.canonicalSkill) ?? Object.keys(pack.skillIcons);
    for (const id of ids) {
      if (!skillTargets.has(id)) other.push({ kind: 'Skill icons', id, source: pack.name });
      skillTargets.add(id);
    }
  }
  if (!skillTargets.size) {
    other.push({ kind: 'Skill icons', id: 'Current skill-icon style', source: 'Built-in default' });
  }

  return {
    baseTeams: teams.filter((team) => BASE_TEAM_SET.has(team.raceKey)),
    secretLeagueTeams: teams.filter((team) => !BASE_TEAM_SET.has(team.raceKey)),
    sounds,
    logos,
    blockDice,
    other,
  };
}

export type OverrideFileKind = 'sprite' | 'logo' | 'sound' | 'blockDie';
export interface ValidatedOverride { ok: true; mime: string }
export interface InvalidOverride { ok: false; message: string }

export function validateOverrideFile(kind: OverrideFileKind, path: string, bytes: Uint8Array): ValidatedOverride | InvalidOverride {
  const extension = /\.([^.\\/?]+)(?:[?#].*)?$/.exec(path)?.[1]?.toLowerCase() ?? '';
  const png = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    .every((value, index) => bytes[index] === value);
  if (kind !== 'sound') {
    if (kind === 'blockDie' && extension === 'png' && png) {
      const width = bytes.length >= 24 ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16) : 0;
      const height = bytes.length >= 24 ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20) : 0;
      return width >= 32 && height >= 32
        ? { ok: true, mime: 'image/png' }
        : { ok: false, message: 'Choose a valid PNG file at least 32×32 pixels.' };
    }
    return extension === 'png' && png
      ? { ok: true, mime: 'image/png' }
      : { ok: false, message: 'Choose a valid PNG file (the extension and PNG signature must both match).' };
  }
  const ogg = bytes.length >= 4 && String.fromCharCode(...bytes.slice(0, 4)) === 'OggS';
  const wav = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WAVE';
  const mp3 = bytes.length >= 3 && (String.fromCharCode(...bytes.slice(0, 3)) === 'ID3'
    || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0));
  if (extension === 'ogg' && ogg) return { ok: true, mime: 'audio/ogg' };
  if (extension === 'wav' && wav) return { ok: true, mime: 'audio/wav' };
  if (extension === 'mp3' && mp3) return { ok: true, mime: 'audio/mpeg' };
  return { ok: false, message: 'Choose a valid OGG, WAV, or MP3 file (the extension and file signature must match).' };
}

