import { Assets } from 'pixi.js';

/**
 * Owner 09-23: the ART PACK. The public installer no longer carries the 280 MB of bundled art under
 * packages/ffb-pitch/assets; the client downloads it once into its app-data folder and only re-downloads the
 * parts whose content changed. Every bundled art URL keeps its build-time string (`/assets/<name>-<hash>.png`,
 * absolute or root-relative); this module aliases those strings to the on-disk copy so no call site changes:
 *  - Pixi loads (string OR `{ src }` form) resolve through `Assets.resolver` aliases;
 *  - the few non-Pixi consumers (an <img>, a model fetch) call `artUrl()`.
 * Without an installed pack (dev server, fork edition, bundled builds) everything resolves as before.
 */
const packByName = new Map<string, string>();

function basename(url: string): string {
  const q = url.indexOf('?');
  const clean = q >= 0 ? url.slice(0, q) : url;
  return clean.slice(clean.lastIndexOf('/') + 1);
}

/** Register the installed pack: emitted asset basename → on-disk src (an asset-protocol URL). Call BEFORE the
 *  first Pixi load of any bundled art (the resolver caches resolutions). */
export function installArtPack(files: Record<string, string>): void {
  packByName.clear();
  const base = typeof document !== 'undefined' ? (document.baseURI || window.location.href) : 'http://localhost/';
  const entries: { alias: string[]; src: string }[] = [];
  for (const [name, src] of Object.entries(files)) {
    packByName.set(name, src);
    const rootRelative = `/assets/${name}`;
    let absolute = rootRelative;
    try { absolute = new URL(rootRelative, base).href; } catch { /* keep root-relative only */ }
    const alias = absolute === rootRelative ? [rootRelative] : [rootRelative, absolute];
    entries.push({ alias, src });
  }
  if (entries.length) Assets.resolver.add(entries);
}

/** True when an installed pack is active (bundled art is being redirected). */
export function artPackActive(): boolean { return packByName.size > 0; }

/** Map a bundled art URL to its on-disk copy when the pack holds it; otherwise the URL unchanged. */
export function artUrl(url: string): string {
  if (packByName.size === 0) return url;
  return packByName.get(basename(url)) ?? url;
}

/** Test seam. */
export function resetArtPackForTests(): void { packByName.clear(); }
