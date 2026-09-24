import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync } from 'fflate';
import type { Plugin } from 'vite';

/**
 * Owner 09-23: ART PACK split. Every asset Vite emits from packages/ffb-pitch/assets (≈280 MB of sprite sheets,
 * badges, decorations, weather, stadium) is grouped into PARTS (walk/<race>, status, decorations, …). With
 * FUMBBL_ASSET_PACK=split the parts leave the bundle (the installer shrinks to the code), each part is zipped to
 * dist-pack/<group>-<hash8>.zip, and dist/asset-pack.json tells the client what to fetch. A part's hash covers
 * its file names + bytes, and emitted names are content-hashed, so an unchanged part keeps its URL across
 * releases (art-pack.lock.json remembers where each part hash was first published) — the client only downloads
 * parts that changed. Without the env the manifest says split=false and nothing moves.
 */
export interface ArtPackFile { name: string; size: number }
export interface ArtPackPart { group: string; hash: string; size: number; sha256: string; url: string; files: ArtPackFile[] }
export interface ArtPackManifest { split: boolean; version: string; parts: ArtPackPart[] }

const ART_ROOT = /packages\/ffb-pitch\/assets\/(.+)$/;

export function artPackGroup(originalFileName: string): string | null {
  const m = ART_ROOT.exec(originalFileName.replace(/\\/g, '/'));
  if (!m) return null;
  const rel = m[1]!;
  const segs = rel.split('/');
  if (segs.length < 2) return null; // a loose file at the root (none today) — keep bundled
  return segs[0] === 'walk' && segs.length >= 3 ? `walk/${segs[1]}` : segs[0]!;
}

export function partHash(files: { name: string; bytes: Uint8Array }[]): string {
  const h = createHash('sha256');
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    h.update(f.name); h.update('\0'); h.update(createHash('sha256').update(f.bytes).digest()); h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

export function artPackPartUrl(publicRepo: string, version: string, group: string, hash: string): string {
  return `https://github.com/${publicRepo}/releases/download/v${version}/${group.replace('/', '-')}-${hash.slice(0, 8)}.zip`;
}

/** Groups below this many bytes stay in the installer: the placeholder sprites the verify gate demands, cursors,
 *  d6 faces, small badge sets — the pitch's baseline before (or without) the pack. */
export const MIN_PART_BYTES = 1_000_000;

export function artPackPlugin(opts: { split: boolean; version: string; publicRepo: string; lockFile: string; outDir: string; minPartBytes?: number }): Plugin {
  return {
    name: 'super-fumbbl-art-pack',
    apply: 'build',
    generateBundle(_options, bundle) {
      const groups = new Map<string, { name: string; bytes: Uint8Array }[]>();
      const owned = new Map<string, string>(); // bundle key → group
      for (const [key, out] of Object.entries(bundle)) {
        if (out.type !== 'asset') continue;
        const origin = (out as { originalFileNames?: string[] }).originalFileNames?.[0] ?? '';
        const group = artPackGroup(origin);
        if (!group) continue;
        const bytes = typeof out.source === 'string' ? new TextEncoder().encode(out.source) : out.source;
        (groups.get(group) ?? groups.set(group, []).get(group)!).push({ name: out.fileName.replace(/^assets\//, ''), bytes });
        owned.set(key, group);
      }
      const lock: Record<string, string> = existsSync(opts.lockFile) ? JSON.parse(readFileSync(opts.lockFile, 'utf8')) : {};
      const parts: ArtPackPart[] = [];
      if (opts.split) mkdirSync(opts.outDir, { recursive: true });
      const minBytes = opts.minPartBytes ?? MIN_PART_BYTES;
      for (const [group, files] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        const bytes = files.reduce((n, f) => n + f.bytes.byteLength, 0);
        if (bytes < minBytes) { for (const [key, g] of owned) if (g === group) owned.delete(key); continue; } // stays bundled
        const hash = partHash(files);
        const url = lock[`${group}@${hash}`] ?? artPackPartUrl(opts.publicRepo, opts.version, group, hash);
        lock[`${group}@${hash}`] = url;
        let size = 0, sha256 = '';
        if (opts.split) {
          const zip = zipSync(Object.fromEntries(files.map((f) => [f.name, f.bytes])), { level: 0 }); // PNGs are already compressed
          size = zip.byteLength; sha256 = createHash('sha256').update(zip).digest('hex');
          writeFileSync(resolve(opts.outDir, `${group.replace('/', '-')}-${hash.slice(0, 8)}.zip`), zip);
        }
        parts.push({ group, hash, size, sha256, url, files: files.map((f) => ({ name: f.name, size: f.bytes.byteLength })).sort((a, b) => a.name.localeCompare(b.name)) });
      }
      if (opts.split) {
        for (const key of owned.keys()) delete bundle[key];
        writeFileSync(opts.lockFile, JSON.stringify(lock, null, 2) + '\n');
      }
      const manifest: ArtPackManifest = { split: opts.split, version: opts.version, parts: opts.split ? parts : [] };
      this.emitFile({ type: 'asset', fileName: 'asset-pack.json', source: JSON.stringify(manifest) });
      if (opts.split) {
        const total = parts.reduce((n, p) => n + p.size, 0);
        console.log(`[art-pack] split: ${parts.length} parts, ${(total / 1048576).toFixed(1)} MB → ${opts.outDir}; ${owned.size} files left the bundle`);
      }
    },
  };
}
