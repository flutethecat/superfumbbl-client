import type { ClassicIconTextureSource } from '@fumbbl40k/ffb-pitch';

const DB_NAME = 'super-fumbbl-upstream-assets';
const STORE_NAME = 'assets';
const MAX_ASSET_BYTES = 4 * 1024 * 1024;

export interface StoredFumbblAsset {
  url: string;
  mime: 'image/png' | 'image/gif';
  bytes: ArrayBuffer;
  fetchedAt: number;
}

export interface FumbblAssetStore {
  get(url: string): Promise<StoredFumbblAsset | undefined>;
  put(asset: StoredFumbblAsset): Promise<void>;
}

export type FumbblAssetFetcher = (url: string) => Promise<{ bytes: ArrayBuffer; mime?: string }>;

let selectedLocalBindings: ReadonlyMap<string, string> = new Map();
/** Owner 2026-09-05: team-logo images (`fumbbl-id-images`) from EVERY installed pack, independent of the
 *  player-sprite selection. Consulted after the selected pack's bindings. */
let localLogoBindings: ReadonlyMap<string, string> = new Map();

/**
 * Publish URL-addressed images from the pack explicitly selected for player
 * presentation. Keys are normalized here; no manifest provider or precedence
 * declaration participates in the decision.
 */
export function setSelectedLocalFumbblAssetBindings(bindings: ReadonlyMap<string, string>): void {
  const accepted = new Map<string, string>();
  for (const [raw, local] of bindings) {
    const assetId = canonicalFumbblAssetId(raw);
    if (assetId && local) accepted.set(assetId, local);
  }
  selectedLocalBindings = accepted;
}

export function setLocalFumbblLogoBindings(bindings: ReadonlyMap<string, string>): void {
  const accepted = new Map<string, string>();
  for (const [raw, local] of bindings) {
    const assetId = canonicalFumbblAssetId(raw);
    if (assetId && local) accepted.set(assetId, local);
  }
  localLogoBindings = accepted;
}

/** Resolve a wire image reference only when a local pack owns it: the user-selected sprite pack first, then
 *  any installed pack's team-logo images. Never a network lookup. */
export function selectedLocalFumbblAssetUrl(rel?: string, base?: string): string | null {
  if (!rel) return null;
  let raw = rel;
  try {
    raw = new URL(rel, base || 'https://cdn.fumbbl.com/').toString();
  } catch {
    return null;
  }
  const assetId = canonicalFumbblAssetId(raw);
  return assetId ? selectedLocalBindings.get(assetId) ?? localLogoBindings.get(assetId) ?? null : null;
}

/** Stable local identity for a FUMBBL image. New packs bind this numeric id
 *  directly, so their manifests contain no remote endpoint. URL input remains
 *  accepted solely as compatibility for old packs and server wire models. */
export function canonicalFumbblAssetId(raw: string): string | undefined {
  const direct = /^([1-9]\d{0,18})$/.exec(raw.trim());
  if (direct) return direct[1];
  const canonical = canonicalFumbblAssetUrl(raw);
  if (!canonical) return undefined;
  return /^https:\/\/cdn\.fumbbl\.com\/i\/(\d+)/.exec(canonical)?.[1];
}

export function canonicalFumbblAssetUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return undefined;
    if (!['cdn.fumbbl.com', 'fumbbl.com', 'www.fumbbl.com'].includes(url.hostname.toLowerCase())) return undefined;
    const match = /^\/i\/(\d+)(?:\.(png|gif))?$/i.exec(url.pathname);
    if (!match) return undefined;
    const extension = match[2]?.toLowerCase() === 'gif' ? '.gif' : '.png';
    return `https://cdn.fumbbl.com/i/${match[1]}${extension}`;
  } catch {
    return undefined;
  }
}

function detectedMime(bytes: ArrayBuffer, advertised?: string): 'image/png' | 'image/gif' {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES) throw new Error('FUMBBL asset has an invalid size');
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
  const png = head.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => head[index] === value);
  const gif = head.length >= 6 && String.fromCharCode(...head.slice(0, 6)) === 'GIF89a'
    || head.length >= 6 && String.fromCharCode(...head.slice(0, 6)) === 'GIF87a';
  if (png && (!advertised || advertised.includes('png') || advertised === 'application/octet-stream')) return 'image/png';
  if (gif && (!advertised || advertised.includes('gif') || advertised === 'application/octet-stream')) return 'image/gif';
  throw new Error('FUMBBL asset is not a supported image');
}

function objectUrl(asset: StoredFumbblAsset): ClassicIconTextureSource {
  const src = URL.createObjectURL(new Blob([asset.bytes], { type: asset.mime }));
  return { src, release: () => URL.revokeObjectURL(src) };
}

export class FumbblAssetCache {
  private readonly inflight = new Map<string, Promise<ClassicIconTextureSource>>();

  constructor(
    private readonly store: FumbblAssetStore,
    private readonly fetcher: FumbblAssetFetcher,
  ) {}

  resolve(rawUrl: string): Promise<ClassicIconTextureSource> {
    const url = canonicalFumbblAssetUrl(rawUrl);
    if (!url) return Promise.reject(new Error('Untrusted FUMBBL asset URL'));
    const existing = this.inflight.get(url);
    if (existing) return existing;
    const pending = this.resolveOnce(url).finally(() => this.inflight.delete(url));
    this.inflight.set(url, pending);
    return pending;
  }

  private async resolveOnce(url: string): Promise<ClassicIconTextureSource> {
    // Owner 09-05: the MOD tier — a local pack that owns the id serves it before any network lookup: the user-selected
    // sprite pack first, then EVERY installed pack (a star's FUMBBL icon with Super FUMBBL selected, for instance).
    const assetId = canonicalFumbblAssetId(url) ?? '';
    const selectedLocal = selectedLocalBindings.get(assetId) ?? localLogoBindings.get(assetId);
    if (selectedLocal) return { src: selectedLocal };
    const cached = await this.store.get(url).catch(() => undefined);
    if (cached) {
      try {
        detectedMime(cached.bytes, cached.mime);
        return objectUrl(cached);
      } catch {
        // A corrupt entry is treated as a miss and repaired from upstream.
      }
    }
    try {
      const fetched = await this.fetcher(url);
      const asset: StoredFumbblAsset = {
        url,
        mime: detectedMime(fetched.bytes, fetched.mime?.toLowerCase()),
        bytes: fetched.bytes,
        fetchedAt: Date.now(),
      };
      await this.store.put(asset).catch(() => undefined);
      return objectUrl(asset);
    } catch (error) {
      throw error;
    }
  }
}

class IndexedDbFumbblAssetStore implements FumbblAssetStore {
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'url' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async get(url: string): Promise<StoredFumbblAsset | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME);
      const request = transaction.objectStore(STORE_NAME).get(url);
      request.onsuccess = () => resolve(request.result as StoredFumbblAsset | undefined);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  async put(asset: StoredFumbblAsset): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(asset);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    });
  }
}

async function fetchUpstreamAsset(url: string): Promise<{ bytes: ArrayBuffer; mime?: string }> {
  void url;
  throw new Error('Runtime FUMBBL CDN asset requests are disabled');
}

let runtimeCache: FumbblAssetCache | undefined;

export function resolveRuntimeFumbblAsset(url: string): Promise<ClassicIconTextureSource> {
  runtimeCache ??= new FumbblAssetCache(new IndexedDbFumbblAssetStore(), fetchUpstreamAsset);
  return runtimeCache.resolve(url);
}
