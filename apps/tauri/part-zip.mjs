// Owner 09-30 (S51): the deterministic part zip + part hash + lock reader, shared by the art pack
// (vite-plugin-art-pack.ts re-exports these) and the app patch (app-patch-build.mjs, run by plain node).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { zipSync } from 'fflate';

/** A part's hash covers its file names + bytes (order-independent). */
export function partHash(files) {
  const h = createHash('sha256');
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    h.update(f.name); h.update('\0'); h.update(createHash('sha256').update(f.bytes).digest()); h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

/** Owner 09-25 (live, first public 1.0.21 install: "part walk/amazon: sha256 mismatch"): the part zips carried the
 *  BUILD TIME in their entries, so re-zipping identical art gave a different sha256 with the same name and size —
 *  the publisher's size check called the hosted zip "already on the release" while the installer's manifest
 *  expected the new bytes. Parts are now zipped deterministically (fixed mtime, name-sorted entries, stored) and
 *  the lock pins the published size + sha256 so every later build (local or hosted) describes the hosted bytes. */
/** Owner 09-30: EVERY part (art pack + app patch) lives on ONE release, `parts` (a pre-release, never Latest), so the
 *  version releases carry only installers + manifests; a part keeps its URL for as long as its bytes are unchanged. */
export const PARTS_RELEASE = 'parts';
export function partUrl(publicRepo, group, hash) {
  return `https://github.com/${publicRepo}/releases/download/${PARTS_RELEASE}/${group.replace('/', '-')}-${hash.slice(0, 8)}.zip`;
}
export const ART_PACK_ZIP_MTIME = new Date(Date.UTC(2020, 0, 1));
export function zipPart(files) {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  return zipSync(Object.fromEntries(sorted.map((f) => [f.name, f.bytes])), { level: 0, mtime: ART_PACK_ZIP_MTIME }); // PNGs are already compressed
}

/** The lock: `group@hash` → where the part is published (+ the published bytes' size/sha256 once known). Older locks
 *  stored the bare URL string. */
export function readArtPackLock(file) {
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? { url: v } : v]));
}
