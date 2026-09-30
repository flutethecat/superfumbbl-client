// Owner 09-30 (S51): the APP PATCH packer. A public build's dist/ is also published as signed PARTS so the shell
// pulls a new web app without an installer. Every dist file belongs to exactly one group: media groups by origin
// (packages/ffb-pitch/assets -> stadium, weather, badges, ..., recorded by vite-plugin-app-patch.ts in
// dist-patch/origins.json), `media` (intro.mp4, super-fumbbl-assets/*, .glb/.ogg/.wav/.mp3/.mp4), `app` (everything
// else: index.html, js, css, json, fonts, asset-pack.json, app-version.json), `images` (every other image).
// Walk sheets stay on the art pack; dist/ is not changed.
// Output: dist-patch/<group>-<hash8>.zip + dist-patch/app-patch.json; app-patch.lock.json pins group@hash ->
// {url,size,sha256} like the art-pack lock, so an unchanged group keeps its first URL and only changed groups upload.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { partHash, partUrl, readArtPackLock, zipPart } from './part-zip.mjs';
import { assertValidManifest, MAX_PATCH_FILES, validPatchName, validPatchPath } from './app-patch-rules.mjs';

export { MAX_PATCH_FILES, validPatchName, validPatchPath };
const MEDIA_EXT = /\.(glb|ogg|wav|mp3|mp4)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|ico)$/i;

/** `rel` = dist-relative posix path; `originGroup` = the art group recorded for that emitted asset, if any. */
export function appPatchGroup(rel, originGroup) {
  if (originGroup) return originGroup;
  if (rel === 'intro.mp4' || rel.startsWith('super-fumbbl-assets/') || MEDIA_EXT.test(rel)) return 'media';
  // Round 2: images of any other origin (apps/tauri/src/assets, public/) ride `images`, so `app` is code only.
  if (IMAGE_EXT.test(rel)) return 'images';
  return 'app';
}

/** Owner 09-30: parts live on the `parts` release (part-zip.mjs); `version` is kept for the call sites, unused. */
export function appPatchPartUrl(publicRepo, _version, group, hash) {
  return partUrl(publicRepo, group, hash);
}

export function listDist(distDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(distDir, full).replace(/\\/g, '/'));
    }
  };
  walk(distDir);
  return out.sort();
}

export function readOriginGroups(outDir) {
  const file = resolve(outDir, 'origins.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

/** A3: a patch only comes from a public build whose dist passed the console guard, with the art pack split out. */
export function assertPatchable({ edition, consoleHits, assetPack }) {
  if (edition !== 'public') throw new Error(`app patch: edition "${edition}" - only a public build produces a patch`);
  if (consoleHits.length) throw new Error(`app patch: the console guard failed on this dist:\n${consoleHits.join('\n')}`);
  if (!assetPack || assetPack.split !== true) throw new Error('app patch: dist/asset-pack.json is not a split build (FUMBBL_ASSET_PACK=split)');
}

/** Pack dist into parts. Throws on anything the shell would refuse (bad path/name, flat-name collision, walk art). */
export function buildAppPatch({ distDir, outDir, lockFile, version, publicRepo, shellMin, originGroups }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`app patch: version ${version} is not bare X.Y.Z (dev cuts never produce a patch)`);
  if (!/^\d+\.\d+\.\d+$/.test(shellMin)) throw new Error(`app patch: shell.min ${shellMin} is not X.Y.Z`);
  const groups = new Map();
  let count = 0;
  for (const rel of listDist(distDir)) {
    const group = appPatchGroup(rel, originGroups[rel]);
    if (/^walk\//.test(group)) throw new Error(`app patch: ${rel} is walk art (it belongs to the art pack)`);
    const path = `/${rel}`;
    const name = rel.split('/').pop();
    if (!validPatchPath(path)) throw new Error(`app patch: ${path} is not a servable path`);
    if (!validPatchName(name)) throw new Error(`app patch: ${name} is not a valid part file name`);
    if (!groups.has(group)) groups.set(group, []);
    const list = groups.get(group);
    const clash = list.find((f) => f.name === name);
    if (clash) throw new Error(`app patch: ${clash.path} and ${path} share the flat name ${name} in group ${group}`);
    list.push({ path, name, bytes: new Uint8Array(readFileSync(join(distDir, rel))) });
    count++;
  }
  if (count > MAX_PATCH_FILES) throw new Error(`app patch: ${count} files (cap ${MAX_PATCH_FILES})`);
  if (!groups.get('app')?.some((f) => f.path === '/index.html')) throw new Error('app patch: dist has no index.html');
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (f.endsWith('.zip') || f.startsWith('app-patch.json')) rmSync(join(outDir, f), { force: true });
  const lock = readArtPackLock(lockFile);
  const parts = [];
  for (const [group, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const hash = partHash(list.map((f) => ({ name: f.path, bytes: f.bytes }))); // over path + bytes
    const key = `${group}@${hash}`;
    const zip = zipPart(list.map((f) => ({ name: f.name, bytes: f.bytes })));
    const zipSha = createHash('sha256').update(zip).digest('hex');
    writeFileSync(resolve(outDir, `${group.replace('/', '-')}-${hash.slice(0, 8)}.zip`), zip);
    let entry = lock[key];
    if (entry?.sha256 && entry.size) {
      // the published bytes are what the shell verifies against; a differing local zip is only a warning
      if (zipSha !== entry.sha256) console.warn(`[app-patch] ${key}: local zip sha256 ${zipSha.slice(0, 8)} differs from the lock's published ${entry.sha256.slice(0, 8)} - manifest keeps the published bytes`);
    } else {
      entry = { url: entry?.url ?? appPatchPartUrl(publicRepo, version, group, hash), size: zip.byteLength, sha256: zipSha };
      lock[key] = entry;
    }
    parts.push({
      group, hash, size: entry.size, sha256: entry.sha256, url: entry.url,
      files: list.map((f) => ({ path: f.path, name: f.name, size: f.bytes.byteLength })).sort((a, b) => a.path.localeCompare(b.path)),
    });
  }
  const manifest = { version, edition: 'public', shell: { min: shellMin }, parts };
  assertValidManifest(manifest);
  writeFileSync(resolve(outDir, 'app-patch.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(lockFile, JSON.stringify(Object.fromEntries(Object.entries(lock).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n');
  return manifest;
}
