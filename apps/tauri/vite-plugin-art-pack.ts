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

/** Owner 09-24: only the walk sprite sheets travel in the pack; stadium, weather, decorations, badges, dice stay bundled. */
export const PACK_GROUPS = /^walk\//;

/** Owner 09-25 (live, first public 1.0.21 install: "part walk/amazon: sha256 mismatch"): the part zips carried the
 *  BUILD TIME in their entries, so re-zipping identical art gave a different sha256 with the same name and size —
 *  the publisher's size check called the hosted zip "already on the release" while the installer's manifest
 *  expected the new bytes. Parts are now zipped deterministically (fixed mtime, name-sorted entries, stored) and
 *  the lock pins the published size + sha256 so every later build (local or hosted) describes the hosted bytes. */
export const ART_PACK_ZIP_MTIME = new Date(Date.UTC(2020, 0, 1));
export function zipPart(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  return zipSync(Object.fromEntries(sorted.map((f) => [f.name, f.bytes])), { level: 0, mtime: ART_PACK_ZIP_MTIME }); // PNGs are already compressed
}
export interface ArtPackLockEntry { url: string; size?: number; sha256?: string }
/** The lock: `group@hash` → where the part is published (+ the published bytes' size/sha256 once known). Older locks
 *  stored the bare URL string. */
export function readArtPackLock(file: string): Record<string, ArtPackLockEntry> {
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string | ArtPackLockEntry>;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? { url: v } : v]));
}

export function artPackPlugin(opts: { split: boolean; version: string; publicRepo: string; lockFile: string; outDir: string; minPartBytes?: number; packGroups?: RegExp }): Plugin {
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
        if (!group || !(opts.packGroups ?? PACK_GROUPS).test(group)) continue;
        const bytes = typeof out.source === 'string' ? new TextEncoder().encode(out.source) : out.source;
        (groups.get(group) ?? groups.set(group, []).get(group)!).push({ name: out.fileName.replace(/^assets\//, ''), bytes });
        owned.set(key, group);
      }
      const lock = readArtPackLock(opts.lockFile);
      const parts: ArtPackPart[] = [];
      if (opts.split) mkdirSync(opts.outDir, { recursive: true });
      const minBytes = opts.minPartBytes ?? MIN_PART_BYTES;
      for (const [group, files] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        const bytes = files.reduce((n, f) => n + f.bytes.byteLength, 0);
        if (bytes < minBytes) { for (const [key, g] of owned) if (g === group) owned.delete(key); continue; } // stays bundled
        const hash = partHash(files);
        const key = `${group}@${hash}`;
        const entry = lock[key] ?? { url: artPackPartUrl(opts.publicRepo, opts.version, group, hash) };
        const url = entry.url;
        let size = 0, sha256 = '';
        if (opts.split) {
          const zip = zipPart(files);
          const zipSha = createHash('sha256').update(zip).digest('hex');
          writeFileSync(resolve(opts.outDir, `${group.replace('/', '-')}-${hash.slice(0, 8)}.zip`), zip);
          if (entry.sha256 && entry.size) {
            // the published bytes are the truth the client verifies against; a differing local zip is only a warning
            // (the publisher re-checks the hosted sha256 and re-uploads when the lock is what changed)
            size = entry.size; sha256 = entry.sha256;
            if (zipSha !== entry.sha256) console.warn(`[art-pack] ${key}: local zip sha256 ${zipSha.slice(0, 8)} differs from the lock's published ${entry.sha256.slice(0, 8)} — manifest keeps the published bytes`);
          } else {
            size = zip.byteLength; sha256 = zipSha;
            lock[key] = { url, size, sha256 };
          }
        }
        if (!lock[key]) lock[key] = entry;
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
