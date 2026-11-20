/**
 * Perf (profile 2026-11-20): keep recently released canvas-text textures alive for reuse.
 *
 * Pixi v8 shares one GPU texture per distinct Text (text + style + resolution, `text.styleKey`) and reference-counts
 * it. When the last Text with a key is destroyed, the texture goes back to the pool; the next Text with the same key
 * re-rasterises it on a canvas and re-uploads it (`texImage2D` + mipmaps). The pitch rebuilds its overlays (planner
 * tags, target numbers, badges, popups) constantly, so the same labels cycled through that path all the time: in a
 * profile, 3.9 s of 6.4 s of sampled script time was text re-uploads.
 *
 * This keeps zero-reference textures in an LRU bounded by pixel count. A Text that comes back gets its texture from
 * the cache at no cost; the least recently released textures are freed once the budget is exceeded.
 */

interface ActiveTexture {
  texture: { source: { pixelWidth: number; pixelHeight: number } };
  usageCount: number;
}

/** The parts of Pixi's AbstractTextSystem (renderer.canvasText) this relies on. */
export interface RetainableTextSystem {
  _activeTextures: Record<string, ActiveTexture | null> | null;
  decreaseReferenceCount(textKey: string): void;
  getManagedTexture(text: { styleKey: string }): unknown;
}

export interface TextTextureRetentionStats {
  /** Texture requests served from an existing texture (live or retained). */
  hits: number;
  /** Texture requests that rasterised and uploaded a new texture. */
  misses: number;
  /** Of the hits, those served from the retained (zero-reference) cache. */
  revived: number;
  retained: number;
  retainedPixels: number;
}

const INSTALLED = Symbol('ffbTextTextureRetention');

/** Default budget: 8 M texels (~32 MB of RGBA), well below what the live labels themselves use. */
export const TEXT_TEXTURE_RETENTION_BUDGET_PX = 8 * 1024 * 1024;

export interface TextTextureRetention {
  stats(): TextTextureRetentionStats;
  /** Free every retained (unused) texture, so labels are rasterised fresh the next time they appear. Textures in use
   *  are untouched. */
  flush(): void;
}

export function installTextTextureRetention(
  system: RetainableTextSystem | undefined | null,
  budgetPx = TEXT_TEXTURE_RETENTION_BUDGET_PX,
): TextTextureRetention | null {
  if (!system || typeof system.decreaseReferenceCount !== 'function' || typeof system.getManagedTexture !== 'function') return null;
  const tagged = system as RetainableTextSystem & { [INSTALLED]?: TextTextureRetention };
  if (tagged[INSTALLED]) return tagged[INSTALLED];

  const release = system.decreaseReferenceCount.bind(system);
  const acquire = system.getManagedTexture.bind(system);
  /** key -> texel count, in release order (oldest first). */
  const retained = new Map<string, number>();
  let retainedPixels = 0;
  const stats = { hits: 0, misses: 0, revived: 0 };

  const entry = (key: string): ActiveTexture | null => system._activeTextures?.[key] ?? null;
  const forget = (key: string) => {
    const px = retained.get(key);
    if (px === undefined) return;
    retained.delete(key);
    retainedPixels -= px;
  };
  const evict = (budget = budgetPx) => {
    for (const key of [...retained.keys()]) {
      if (retainedPixels <= budget) break;
      forget(key);
      const e = entry(key);
      // Still unused: hand it back to Pixi's own release path (usageCount 1 -> 0 frees it).
      if (e && e.usageCount === 0) { e.usageCount = 1; release(key); }
    }
  };

  system.decreaseReferenceCount = (key: string) => {
    const e = entry(key);
    if (!e || e.usageCount !== 1) { release(key); return; }
    // Last reference: keep the texture instead of returning it to the pool.
    e.usageCount = 0;
    forget(key);
    const source = e.texture.source;
    const px = Math.max(1, (source.pixelWidth || 0) * (source.pixelHeight || 0));
    retained.set(key, px);
    retainedPixels += px;
    evict();
  };

  system.getManagedTexture = (text: { styleKey: string }) => {
    const key = text.styleKey;
    if (entry(key)) {
      stats.hits++;
      if (retained.has(key)) { stats.revived++; forget(key); }
    } else {
      stats.misses++;
    }
    return acquire(text);
  };

  const retention: TextTextureRetention = {
    stats: () => ({ ...stats, retained: retained.size, retainedPixels }),
    flush: () => evict(-1),
  };
  tagged[INSTALLED] = retention;
  return retention;
}
