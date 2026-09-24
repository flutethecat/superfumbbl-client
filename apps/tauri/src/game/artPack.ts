import { reactive } from 'vue';
import { installArtPack } from '@fumbbl40k/ffb-pitch';

/**
 * Owner 09-23: ART PACK sync. A split build (public installer) ships no bundled art; `asset-pack.json` lists the
 * PARTS (walk/<race>, status, decorations, …) with their content hashes and release-asset URLs. On startup the
 * client compares that with what is installed under app-data and downloads only the parts that changed, then
 * aliases every bundled art URL to its on-disk copy (ffb-pitch installArtPack). The pitch views mount once the
 * pack is ready; the menus stay usable throughout. A bundled build (dev server, fork edition) is ready at once.
 */
export interface ArtPackPart { group: string; hash: string; size: number; sha256: string; url: string; files: { name: string; size: number }[] }
export interface ArtPackManifest { split: boolean; version: string; parts: ArtPackPart[] }

export const artPack = reactive({
  ready: false,
  split: false,
  /** parts done / total for this sync (only parts that need downloading count) */
  done: 0,
  total: 0,
  /** bytes of the parts still to fetch when the sync started */
  pendingBytes: 0,
  downloadedBytes: 0,
  current: '' as string,
  error: '' as string,
});

/** Which parts must be fetched: hash differs from the installed record (or nothing installed). */
export function partsToInstall(manifest: ArtPackManifest, installed: Record<string, string>): ArtPackPart[] {
  return manifest.parts.filter((p) => installed[p.group] !== p.hash);
}

/** basename → on-disk file path for every file of every part (the alias table's input). */
export function packFilePaths(manifest: ArtPackManifest, root: string): Record<string, string> {
  const sep = root.includes('\\') ? '\\' : '/';
  const out: Record<string, string> = {};
  for (const part of manifest.parts) {
    const dir = root + sep + part.group.replace('/', sep);
    for (const f of part.files) out[f.name] = dir + sep + f.name;
  }
  return out;
}

export interface ArtPackHost {
  fetchManifest(): Promise<ArtPackManifest | null>;
  installed(): Promise<Record<string, string>>;
  installPart(part: ArtPackPart): Promise<void>;
  packDir(): Promise<string>;
  toSrc(path: string): string;
}

/** The sync itself, host-agnostic (tests drive it with a fake host). Resolves when the pack is ready or failed. */
export async function syncArtPack(host: ArtPackHost): Promise<void> {
  artPack.error = '';
  const manifest = await host.fetchManifest();
  if (!manifest || !manifest.split) { artPack.split = false; artPack.ready = true; return; }
  artPack.split = true;
  try {
    const installed = await host.installed();
    const todo = partsToInstall(manifest, installed);
    artPack.total = todo.length; artPack.done = 0;
    artPack.pendingBytes = todo.reduce((n, p) => n + p.size, 0); artPack.downloadedBytes = 0;
    for (const part of todo) {
      artPack.current = part.group;
      await host.installPart(part);
      artPack.done += 1; artPack.downloadedBytes += part.size;
    }
    artPack.current = '';
    const root = await host.packDir();
    const files = packFilePaths(manifest, root);
    const srcs: Record<string, string> = {};
    for (const [name, path] of Object.entries(files)) srcs[name] = host.toSrc(path);
    installArtPack(srcs);
    artPack.ready = true;
  } catch (e) {
    artPack.error = e instanceof Error ? e.message : String(e);
  }
}

/** The Tauri host: manifest from the bundle, parts through the Rust installer, files via the asset protocol. */
export async function tauriArtPackHost(): Promise<ArtPackHost> {
  const { invoke, convertFileSrc } = await import('@tauri-apps/api/core');
  return {
    async fetchManifest() {
      try {
        const res = await fetch(new URL('/asset-pack.json', document.baseURI).href, { cache: 'no-store' });
        return res.ok ? ((await res.json()) as ArtPackManifest) : null;
      } catch { return null; }
    },
    async installed() {
      const state = await invoke<{ parts?: Record<string, string> }>('art_pack_installed');
      return state?.parts ?? {};
    },
    async installPart(part) {
      await invoke('art_pack_install_part', { url: part.url, group: part.group, hash: part.hash, size: part.size, sha256: part.sha256 });
    },
    packDir: () => invoke<string>('art_pack_dir'),
    toSrc: (path) => convertFileSrc(path),
  };
}

export function formatMb(bytes: number): string { return `${(bytes / 1048576).toFixed(0)} MB`; }

/** A WEB host (vite preview / hosted web build / the rig): the pack is already served as static files under
 *  `<baseUrl>/<group>/<name>`; nothing is downloaded, every part counts as installed. */
export function webArtPackHost(baseUrl: string): ArtPackHost {
  const base = baseUrl.replace(/\/$/, '');
  return {
    async fetchManifest() {
      try {
        const res = await fetch(new URL('/asset-pack.json', document.baseURI).href, { cache: 'no-store' });
        return res.ok ? ((await res.json()) as ArtPackManifest) : null;
      } catch { return null; }
    },
    async installed() {
      const manifest = await this.fetchManifest();
      return Object.fromEntries((manifest?.parts ?? []).map((p) => [p.group, p.hash]));
    },
    async installPart() { /* static hosting: nothing to fetch */ },
    packDir: async () => base,
    toSrc: (path) => path,
  };
}
