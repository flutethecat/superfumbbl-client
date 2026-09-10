import { Assets, Rectangle, Texture } from 'pixi.js';
import type { GameJson, PlayerJson, TeamJson } from '@fumbbl40k/ffb-protocol';

/**
 * FUMBBL Classic icon sets, mirroring upstream IconCache/PlayerIconFactory:
 * each iconset PNG is a 4-column grid — home standing, home moving, away
 * standing, away moving — with nrOfIcons rows; a player picks a row via
 * positionIconIndex. Relative URLs are normalized against roster.baseIconPath
 * into stable asset keys, with player-level urlIconSet overriding the position's.
 * The host may satisfy those keys from an installed local pack; this module does
 * not grant permission to fetch the referenced remote media.
 */

interface PositionLike {
  positionId: string;
  urlIconSet?: string;
  nrOfIcons?: number;
}

interface RosterLike {
  baseIconPath?: string;
  positionArray?: PositionLike[];
}

/**
 * Legacy URL rewriting hook retained for non-desktop hosts. The desktop app
 * installs a local-only resolver and never rewrites these keys to a CDN proxy.
 */
let rewriteUrl: (url: string) => string = (url) => url;

export function setClassicIconUrlRewriter(fn: (url: string) => string): void {
  rewriteUrl = fn;
}

/**
 * Async texture-source resolver. The desktop host resolves stable upstream URL
 * keys only to installed-pack or previously retained local-cache URLs. Defaults
 * to the sync rewriter for standalone consumers until a host installs its policy.
 */
export interface ClassicIconTextureSource {
  src: string;
  /** Releases host-owned resources such as a Tauri-created blob URL. */
  release?: () => void;
}

type ClassicIconTextureResolution = string | ClassicIconTextureSource;

let resolveTextureSrc: (url: string) => Promise<ClassicIconTextureResolution> = async (url) => rewriteUrl(url);

export function setClassicIconTextureResolver(fn: (url: string) => Promise<ClassicIconTextureResolution>): void {
  resolveTextureSrc = fn;
}

/**
 * Shadow-stripped iconsheet cache (owner 2026-07-02, queue item 2): sheets
 * pre-processed by scripts/sprite-shadow-pass.ps1 (ComfyUI Flux2 Klein edit,
 * guarded) may be served from /shadowless-icons/<id>.png and preferred over the
 * installed-pack original when the manifest lists the id.
 */
let shadowlessIds: Set<string> | null = null;

export async function loadShadowlessManifest(url = '/shadowless-icons/manifest.json'): Promise<void> {
  try {
    const res = await fetch(url);
    if (res.ok) shadowlessIds = new Set(Object.keys(await res.json()));
  } catch {
    shadowlessIds = null; // no manifest — use the ordinary local resolver
  }
}

function shadowlessUrl(url: string): string | undefined {
  const id = /\/i\/(\d+)\.png$/i.exec(url)?.[1];
  return id && shadowlessIds?.has(id) ? `/shadowless-icons/${id}.png` : undefined;
}

/** Absolute iconset URL → base texture (present only once LOADED). */
const iconSets = new Map<string, Texture | null>();
/** Absolute iconset URL → the exact Pixi cache key and its host-side release. */
const iconSetSources = new Map<string, ClassicIconTextureSource>();
/** Active renderer/game leases. An entry with refs > 0 is never retired. */
const iconSetRefs = new Map<string, number>();
/** LRU stamp for released-but-warm sheets. */
const iconSetLastUsed = new Map<string, number>();
const iconSetRetirements = new Map<string, Promise<void>>();
const CLASSIC_ICON_WARM_LIMIT = 12;
let classicIconUseClock = 0;
/** Owner 2026-07-08 (queue 4): in-flight loads, deduped — concurrent ensure calls
 *  await the SAME promise instead of skipping while the first is still loading. */
const iconSetLoads = new Map<string, Promise<void>>();
const iconSetLoadGenerations = new Map<string, number>();
/** Owner 2026-07-08 (queue 4): failures RETRY (bounded), they don't poison. The old
 *  cache reserved the URL with `null` BEFORE loading, so a load that failed or was
 *  ABORTED mid-game-switch (session teardown racing the in-flight fetch) blacklisted
 *  that iconset for the whole app session — the "assets don't load when switching
 *  game→game without a Disconnect" hang. A short cooldown + retry cap keeps the
 *  original goal (no per-refresh retry flood on genuine 404s). */
const iconSetFailures = new Map<string, { at: number; count: number }>();
const ICONSET_RETRY_COOLDOWN_MS = 8000;
const ICONSET_MAX_RETRIES = 4;
/** Shadow-stripped variant per URL (B2-10: used ONLY for the lying pose). */
const shadowlessSets = new Map<string, Texture | null>();
const shadowlessSources = new Map<string, string>();
/** `${url}#${column}:${row}[:s]` → sliced frame texture. */
const frames = new Map<string, Texture>();

export interface ClassicIconLease {
  release(): void;
}

export interface ClassicIconCacheStats {
  loaded: number;
  active: number;
  warm: number;
  frames: number;
  retiring: number;
  warmLimit: number;
}

export function classicIconCacheStats(): ClassicIconCacheStats {
  let active = 0;
  for (const count of iconSetRefs.values()) if (count > 0) active++;
  return {
    loaded: [...iconSets.values()].filter(Boolean).length,
    active,
    warm: [...iconSets.keys()].filter((url) => !!iconSets.get(url) && (iconSetRefs.get(url) ?? 0) === 0).length,
    frames: frames.size,
    retiring: iconSetRetirements.size,
    warmLimit: CLASSIC_ICON_WARM_LIMIT,
  };
}

/** Test/teardown seam: waits until every retirement already scheduled has
 * completed its Pixi-unload → host-release sequence. */
export async function waitForClassicIconRetirement(): Promise<void> {
  while (iconSetRetirements.size) await Promise.all([...iconSetRetirements.values()]);
}

function normalizedTextureSource(resolved: ClassicIconTextureResolution): ClassicIconTextureSource {
  return typeof resolved === 'string' ? { src: resolved } : resolved;
}

function dropFramesFor(url: string): void {
  for (const [key, frame] of [...frames]) {
    if (!key.startsWith(`${url}#`)) continue;
    frames.delete(key);
    // The frame owns only its view; the Assets-managed source is unloaded below.
    frame.destroy(false);
  }
}

function retireIconSet(url: string): Promise<void> {
  const existing = iconSetRetirements.get(url);
  if (existing) return existing;
  if ((iconSetRefs.get(url) ?? 0) > 0) return Promise.resolve();
  const source = iconSetSources.get(url);
  const shadowless = shadowlessSets.get(url);
  const shadowlessSource = shadowlessSources.get(url);
  iconSets.delete(url);
  shadowlessSets.delete(url);
  shadowlessSources.delete(url);
  iconSetSources.delete(url);
  iconSetLastUsed.delete(url);
  iconSetLoadGenerations.delete(url);
  iconSetFailures.delete(url);
  dropFramesFor(url);
  const retirement = (async () => {
    // Pixi must release its decoded texture/source before a host blob URL is revoked.
    if (shadowless && shadowlessSource) await Assets.unload(shadowlessSource).catch(() => undefined);
    if (source) await Assets.unload(source.src).catch(() => undefined);
    source?.release?.();
  })().finally(() => iconSetRetirements.delete(url));
  iconSetRetirements.set(url, retirement);
  return retirement;
}

function trimClassicIconWarmCache(): void {
  const warm = [...iconSets.keys()]
    .filter((url) => !!iconSets.get(url) && (iconSetRefs.get(url) ?? 0) === 0)
    .sort((left, right) => (iconSetLastUsed.get(left) ?? 0) - (iconSetLastUsed.get(right) ?? 0));
  for (const url of warm.slice(0, Math.max(0, warm.length - CLASSIC_ICON_WARM_LIMIT))) void retireIconSet(url);
}

function retainIconSetUrls(urls: ReadonlySet<string>): ClassicIconLease {
  for (const url of urls) {
    iconSetRefs.set(url, (iconSetRefs.get(url) ?? 0) + 1);
    iconSetLastUsed.set(url, ++classicIconUseClock);
  }
  let held = true;
  return {
    release() {
      if (!held) return;
      held = false;
      for (const url of urls) {
        const remaining = (iconSetRefs.get(url) ?? 1) - 1;
        if (remaining > 0) iconSetRefs.set(url, remaining);
        else {
          iconSetRefs.delete(url);
          iconSetLastUsed.set(url, ++classicIconUseClock);
          if (!iconSets.has(url) && !iconSetLoads.has(url)) iconSetLoadGenerations.delete(url);
        }
      }
      trimClassicIconWarmCache();
    },
  };
}

function resolveUrl(base: string | undefined, rel: string | undefined): string | undefined {
  if (!rel) return undefined;
  if (/^https?:/i.test(rel)) return rel;
  if (!base) return rel;
  return base.endsWith('/') || rel.startsWith('/') ? base + rel : `${base}/${rel}`;
}

/**
 * A standalone server's `baseIconPath` points at an unhosted local FUMBBL icon
 * mirror (http://localhost:2224/…). Loading from it 404s for every player and
 * floods the console; routing it to FUMBBL's real CDN instead would burden
 * FUMBBL for purely-local dev games. Only relative/same-origin keys and canonical
 * FUMBBL keys are accepted; any other absolute host is unavailable. Acceptance
 * here is key normalization, not network permission—the host resolver remains
 * local-only and the renderer falls back to its placeholder token.
 */
function usableIconUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (!/^https?:/i.test(url)) return url; // relative / same-origin / already proxied
  return /^https?:\/\/(cdn\.|www\.)?fumbbl\.com\//i.test(url) ? url : undefined;
}

/**
 * The installer contains only this register, never FUMBBL artwork. It maps the
 * legacy named iconset references emitted by rosters onto canonical lookup keys.
 * The host resolves those keys from an explicitly installed local pack or an
 * already-retained local cache entry; it never downloads them at runtime.
 */
let iconsetManifest: Record<string, string> | null = null;

export async function loadIconsetManifest(url = '/fumbbl-assets/register.json'): Promise<void> {
  if (iconsetManifest) return;
  try {
    const res = await fetch(url);
    const payload = res.ok ? await res.json() as { iconsets?: Record<string, string> } : {};
    iconsetManifest = payload.iconsets ?? {};
  } catch {
    iconsetManifest = {}; // no register — numeric server URLs still work
  }
}

const normaliseIconName = (name: string) => name.toLowerCase().replace(/_/g, '');

/**
 * Resolve only an asset positively listed by the already-loaded bundle manifests.
 * Unlike bundledFumbblAsset(), this never emits an optimistic pre-manifest URL.
 * UI surfaces that can show a real fallback should use this strict form and
 * react to loadIconsetManifest() completing before trying again.
 */
export function cachedBundledFumbblAsset(rel: string | undefined): string | undefined {
  if (!rel || !iconsetManifest) return undefined;
  const id = /(?:^|\/)i\/(\d+)(?:\.[a-z0-9]+)?(?:[?#].*)?$/i.exec(rel)?.[1];
  if (id) return `https://cdn.fumbbl.com/i/${id}${/\.gif(?:[?#]|$)/i.test(rel) ? '.gif' : '.png'}`;
  const name = /(?:^|\/)iconsets\/([A-Za-z0-9_-]+)(?:\.[a-z0-9]+)?(?:[?#].*)?$/i.exec(rel)?.[1];
  if (!name) return undefined;
  return iconsetManifest[normaliseIconName(name)];
}

export function bundledFumbblAsset(rel: string | undefined): string | undefined {
  if (!rel) return undefined;
  const id = /(?:^|\/)i\/(\d+)(?:\.[a-z0-9]+)?(?:[?#].*)?$/i.exec(rel)?.[1];
  if (id) return `https://cdn.fumbbl.com/i/${id}${/\.gif(?:[?#]|$)/i.test(rel) ? '.gif' : '.png'}`;
  const name = /(?:^|\/)iconsets\/([A-Za-z0-9_-]+)(?:\.[a-z0-9]+)?(?:[?#].*)?$/i.exec(rel)?.[1];
  if (name) {
    return iconsetManifest?.[normaliseIconName(name)];
  }
  return undefined;
}

/**
 * B7-1: resolve the knockdown-frame key for a player — the CDN icon id, the
 * position row (positionIconIndex), and which color column's frames to use.
 * Home players display the away/col-2 art (colorway flip), so home → 'opp'.
 */
export function knockdownFrameInfo(
  player: PlayerJson,
  team: TeamJson,
  isHome: boolean,
  oneSpritePerPosition = false,
): { iconId: string; row: number; side: 'own' | 'opp' } | null {
  const url = iconSetUrl(player, team);
  const id = url ? /\/i\/(\d+)\.png/i.exec(url)?.[1] : undefined;
  if (!id) return null;
  return { iconId: id, row: classicIconRow(player, Number.POSITIVE_INFINITY, oneSpritePerPosition), side: isHome ? 'opp' : 'own' };
}

/** Resolve only the local presentation row. `oneSpritePerPosition` deliberately
 * ignores the server-assigned variant while preserving its position-specific sheet. */
export function classicIconRow(player: PlayerJson, rows: number, oneSpritePerPosition = false): number {
  const upstreamRow = Math.max(0, (player.positionIconIndex as number | undefined) ?? 0);
  if (oneSpritePerPosition) return 0;
  return Number.isFinite(rows) ? Math.min(upstreamRow, Math.max(0, rows - 1)) : upstreamRow;
}

function iconSetUrl(player: PlayerJson, team: TeamJson): string | undefined {
  const roster = team.roster as RosterLike;
  const rel =
    (player.urlIconSet as string | undefined) ??
    roster.positionArray?.find((p) => p.positionId === player.positionId)?.urlIconSet;
  // Named legacy references use the static register; numeric/new references use
  // the authoritative URL from the live game. Both paths enter the host cache.
  return (
    bundledFumbblAsset(rel) ??
    usableIconUrl(resolveUrl((team as { baseIconPath?: string }).baseIconPath ?? roster.baseIconPath, rel))
  );
}

function loadIconSet(url: string): Promise<void> {
  if (iconSets.get(url)) return Promise.resolve(); // already loaded
  const inflight = iconSetLoads.get(url);
  if (inflight) return inflight; // dedupe concurrent ensure calls onto one load
  const failure = iconSetFailures.get(url);
  if (failure && (failure.count >= ICONSET_MAX_RETRIES || Date.now() - failure.at < ICONSET_RETRY_COOLDOWN_MS)) {
    return Promise.resolve(); // cooling down / given up — renderer keeps its token fallback
  }
  const generation = iconSetLoadGenerations.get(url) ?? 0;
  let load!: Promise<void>;
  load = (async () => {
    try {
      await iconSetRetirements.get(url);
      // B2-10 (owner): standing/moving art keeps its baked shadow — always the
      // Installed-pack original; a local shadow-stripped sheet loads alongside and is used
      // only for the lying pose (classicIconFor down=true).
      const source = normalizedTextureSource(await resolveTextureSrc(url));
      try {
        const texture = await Assets.load<Texture>({ src: source.src, parser: 'loadTextures' });
        if (!(texture instanceof Texture) || !texture.source) throw new Error('Classic iconset texture could not be decoded');
        // A game change may deliberately supersede an old in-flight fetch. Its
        // unique blob belongs to that attempt and must never overwrite the new one.
        if (generation !== (iconSetLoadGenerations.get(url) ?? 0)) {
          await Assets.unload(source.src).catch(() => undefined);
          source.release?.();
          return;
        }
        texture.source.scaleMode = 'nearest';
        iconSetSources.set(url, source);
        iconSets.set(url, texture);
        iconSetLastUsed.set(url, ++classicIconUseClock);
      } catch (error) {
        await Assets.unload(source.src).catch(() => undefined);
        source.release?.();
        throw error;
      }
      iconSetFailures.delete(url);
      const stripped = shadowlessUrl(url);
      if (stripped && !shadowlessSets.has(url)) {
        shadowlessSets.set(url, null);
        try {
          const shadowless = await Assets.load<Texture>({ src: stripped, parser: 'loadTextures' });
          shadowless.source.scaleMode = 'nearest';
          shadowlessSets.set(url, shadowless);
          shadowlessSources.set(url, stripped);
        } catch {
          /* fall back to the original for the lying pose */
        }
      }
    } catch (error) {
      const count = (iconSetFailures.get(url)?.count ?? 0) + 1;
      iconSetFailures.set(url, { at: Date.now(), count });
      console.warn(`ffb-pitch: classic iconset failed to load (attempt ${count}/${ICONSET_MAX_RETRIES}): ${url}`, error);
    } finally {
      if (iconSetLoads.get(url) === load) iconSetLoads.delete(url);
      trimClassicIconWarmCache();
    }
  })();
  iconSetLoads.set(url, load);
  return load;
}

/** Loads every iconset both teams can need; resolves when all settled. */
export async function ensureClassicIcons(game: GameJson): Promise<void> {
  const lease = await acquireClassicIcons(game);
  lease.release();
}

/** Acquire every Classic sheet needed by one mounted game. The returned lease
 * must be released after that renderer's tokens are destroyed or replaced. */
export async function acquireClassicIcons(
  game: GameJson,
  signal?: AbortSignal,
  /** Owner 09-05: the sprite chain only needs icons for positions the tiers ABOVE the mod tier do not cover. */
  needed?: (team: TeamJson, positionId: string) => boolean,
): Promise<ClassicIconLease> {
  await loadIconsetManifest(); // resolve legacy names before we build this game's exact URL set
  if (signal?.aborted) return { release() {} };
  const urls = new Set<string>();
  for (const team of [game.teamHome, game.teamAway]) {
    const roster = team.roster as RosterLike;
    for (const position of roster.positionArray ?? []) {
      if (needed && !needed(team, position.positionId)) continue;
      const url = bundledFumbblAsset(position.urlIconSet) ?? usableIconUrl(resolveUrl(roster.baseIconPath, position.urlIconSet));
      if (url) urls.add(url);
    }
    for (const player of team.playerArray) {
      if (needed && !needed(team, player.positionId)) continue;
      const url = iconSetUrl(player, team);
      if (url) urls.add(url);
    }
  }
  const lease = retainIconSetUrls(urls);
  const abort = () => lease.release();
  signal?.addEventListener('abort', abort, { once: true });
  await Promise.all([...urls].map((url) => loadIconSet(url)));
  signal?.removeEventListener('abort', abort);
  if (signal?.aborted) lease.release();
  return lease;
}

/**
 * Owner 2026-07-06: on a GAME CHANGE, drop the per-game LOAD-STATE caches so the
 * next game loads fresh — this is the game→game switch fix (case 332). It clears:
 *   - `iconSetLoads` — a stale IN-FLIGHT load promise from an ABORTED previous-game
 *     load (session torn down mid-fetch) that a new `ensureClassicIcons` would
 *     otherwise await forever (the "assets don't switch quickly game→game" hang);
 *   - `iconSetFailures` — the failure BACKOFF, so the new game retries immediately
 *     instead of waiting out case 302's cooldown;
 *   - `frames` — sliced-frame lookups (rebuilt on demand from leased/warm bases;
 *     lookup removal does not destroy a frame still mounted by the prior render).
 *
 * Base textures are retained by mounted renderer leases, then kept in a bounded warm
 * LRU. Eviction uses `Assets.unload`; textures are never destroyed behind Pixi's cache.
 * A Tauri blob URL is released only after that unload settles.
 *
 * Clearing a stale in-flight lookup can create a second unique blob in packaged builds,
 * so each attempt is generation-owned: a late superseded result unloads and releases
 * its own source instead of publishing over the new game.
 */
export function resetIconCaches(): void {
  for (const url of iconSetLoads.keys()) {
    iconSetLoadGenerations.set(url, (iconSetLoadGenerations.get(url) ?? 0) + 1);
  }
  iconSetLoads.clear();
  iconSetFailures.clear();
  frames.clear();
}

/**
 * Sliced classic icon for a player, or undefined while loading/unavailable.
 * Column layout per upstream: home standing, home moving, away standing,
 * away moving.
 */
export function classicIconFor(
  player: PlayerJson,
  team: TeamJson,
  isHome: boolean,
  moving: boolean,
  down = false,
  oneSpritePerPosition = false,
): Texture | undefined {
  const url = iconSetUrl(player, team);
  if (!url) return undefined;
  // B2-10: lying players use the shadow-stripped art (their baked foot shadow
  // would rotate with the body); standing/moving keep the original
  const base = (down ? shadowlessSets.get(url) : undefined) ?? iconSets.get(url);
  if (!base) return undefined;

  const size = Math.floor(base.width / 4);
  if (size <= 0) return undefined;
  const rows = Math.max(1, Math.floor(base.height / size));
  const row = classicIconRow(player, rows, oneSpritePerPosition);
  const column = (isHome ? 0 : 2) + (moving ? 1 : 0);

  const key = `${url}#${column}:${row}${down && shadowlessSets.get(url) ? ':s' : ''}`;
  let frame = frames.get(key);
  if (!frame) {
    frame = new Texture({ source: base.source, frame: new Rectangle(column * size, row * size, size, size) });
    frames.set(key, frame);
  }
  return frame;
}
