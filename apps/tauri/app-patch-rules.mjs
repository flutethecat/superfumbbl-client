// Owner 09-30 (S51 round 2): the shell's app-patch rules (app_patch.rs validate_manifest / valid_path,
// art_pack.rs valid_group / safe_entry_name), shared by the builder and the publisher so nothing the shell would
// refuse gets built or signed. Keep in step with app_patch.rs.
const SEGMENT = /^[A-Za-z0-9._-]{1,120}$/;
const NAME = /^[A-Za-z0-9._-]{1,200}$/;
const GROUP_SEG = /^[a-z0-9_-]+$/;
const VERSION = /^\d{1,9}\.\d{1,9}\.\d{1,9}$/;
export const MAX_PATCH_FILES = 4000;
export const MAX_PART_BYTES = 512 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const isSize = (n) => Number.isSafeInteger(n) && n >= 0;

export function validPatchPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return false;
  const segs = path.slice(1).split('/');
  return segs.length >= 1 && segs.length <= 4 && segs.every((s) => SEGMENT.test(s) && !s.startsWith('.'));
}
export function validPatchName(name) {
  return typeof name === 'string' && NAME.test(name) && !name.startsWith('.') && name.includes('.');
}
export function validPatchGroup(group) {
  if (typeof group !== 'string') return false;
  const segs = group.split('/');
  return segs.length >= 1 && segs.length <= 2 && segs.every((s) => GROUP_SEG.test(s));
}
export function validBareVersion(v) {
  return typeof v === 'string' && VERSION.test(v);
}

/** Every reason the shell would refuse this manifest (empty = acceptable). */
export function manifestProblems(m) {
  const out = [];
  if (m?.edition !== 'public') out.push(`edition "${m?.edition}" is not public`);
  if (!validBareVersion(m?.version)) out.push(`version "${m?.version}" is not bare X.Y.Z`);
  if (!validBareVersion(m?.shell?.min)) out.push(`shell.min "${m?.shell?.min}" is not X.Y.Z`);
  if (m?.notes !== undefined && typeof m.notes !== 'string') out.push('notes must be a string or absent');
  try {
    const bytes = Buffer.byteLength(JSON.stringify(m));
    if (bytes > MAX_MANIFEST_BYTES) out.push(`manifest is ${bytes} bytes (shell cap ${MAX_MANIFEST_BYTES})`);
  } catch { out.push('manifest is not serializable'); }
  if (!Array.isArray(m?.parts) || !m.parts.length) { out.push('no parts'); return out; }
  const groups = new Set(), paths = new Set();
  let files = 0;
  for (const p of m.parts) {
    const g = p?.group;
    if (!validPatchGroup(g) || groups.has(g)) out.push(`group ${JSON.stringify(g)} invalid or duplicate`);
    groups.add(g);
    // Round 3: serde parity - strings stay strings, no coercion.
    if (typeof p?.hash !== 'string' || !/^[0-9a-f]{8,64}$/.test(p.hash)) out.push(`${g}: hash is not 8-64 lowercase hex`);
    if (typeof p?.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256)) out.push(`${g}: sha256 is not 64 lowercase hex`);
    if (!isSize(p?.size) || p.size < 1 || p.size > MAX_PART_BYTES) out.push(`${g}: size ${p?.size} out of 1..512 MB`);
    if (typeof p?.url !== 'string' || !p.url.startsWith('https://github.com/')) out.push(`${g}: url is not a GitHub release asset`);
    const names = new Set();
    if (!Array.isArray(p?.files)) { out.push(`${g}: files is not an array`); continue; }
    for (const f of p.files) {
      files++;
      if (!validPatchPath(f?.path) || paths.has(f.path)) out.push(`${g}: path ${JSON.stringify(f?.path)} invalid or duplicate`);
      paths.add(f?.path);
      if (!validPatchName(f?.name) || names.has(f.name) || f.path?.split('/').pop() !== f.name) out.push(`${g}: name ${JSON.stringify(f?.name)} invalid, duplicate or not the path's basename`);
      names.add(f?.name);
      if (!isSize(f?.size)) out.push(`${g}: ${f?.path} has no size`);
    }
  }
  if (files === 0 || files > MAX_PATCH_FILES) out.push(`${files} files (1..${MAX_PATCH_FILES})`);
  if (!paths.has('/index.html')) out.push('no /index.html');
  return out;
}

export function assertValidManifest(m) {
  const problems = manifestProblems(m);
  if (problems.length) throw new Error(`app patch manifest refused:\n  ${problems.join('\n  ')}`);
}
