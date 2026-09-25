import { reactive } from 'vue';
import { installArtPack, type ArtPackFileRef } from '@fumbbl40k/ffb-pitch';

/**
 * Owner 09-23/24: ART PACK sync. A split build (public installer) ships no walk sprite sheets; `asset-pack.json`
 * lists the PARTS (walk/<race>) with their content hashes and release-asset URLs. On startup the client
 * registers the pack with the renderer's loader FIRST (so any early sheet load waits instead of failing), then
 * compares the manifest with app-data/art-pack/installed.json and downloads only the parts that changed. Pack
 * bytes reach Pixi over Tauri IPC (no asset protocol). The pitch views mount once the pack is ready; the menus
 * stay usable throughout. A bundled build (dev server, fork edition) is ready at once.
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

/** basename → {group, name} for every file of every part (the loader's index). */
export function packFileRefs(manifest: ArtPackManifest): Record<string, ArtPackFileRef> {
  const out: Record<string, ArtPackFileRef> = {};
  for (const part of manifest.parts) for (const f of part.files) out[f.name] = { group: part.group, name: f.name };
  return out;
}

export interface ArtPackHost {
  fetchManifest(): Promise<ArtPackManifest | null>;
  installed(): Promise<Record<string, string>>;
  installPart(part: ArtPackPart): Promise<void>;
  read(ref: ArtPackFileRef): Promise<Uint8Array>;
}

/** The sync itself, host-agnostic (tests drive it with a fake host). Resolves when the pack is ready or failed. */
export async function syncArtPack(host: ArtPackHost): Promise<void> {
  artPack.error = '';
  const manifest = await host.fetchManifest();
  if (!manifest || !manifest.split) { artPack.split = false; artPack.ready = true; return; }
  artPack.split = true;
  let markReady!: () => void;
  const ready = new Promise<void>((resolve) => { markReady = resolve; });
  // Register before downloading: a sheet load that starts early waits on `ready` instead of 404-ing.
  installArtPack({ files: packFileRefs(manifest), ready, read: (ref) => host.read(ref) });
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
    markReady();
    artPack.ready = true;
  } catch (e) {
    artPack.error = e instanceof Error ? e.message : String(e);
  }
}

/** The Tauri host: manifest from the bundle, parts through the Rust installer, bytes over IPC. */
export async function tauriArtPackHost(): Promise<ArtPackHost> {
  const { invoke } = await import('@tauri-apps/api/core');
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
    async read(ref) {
      const bytes = await invoke<ArrayBuffer | Uint8Array>('art_pack_read', { group: ref.group, name: ref.name });
      return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    },
  };
}

export function formatMb(bytes: number): string { return `${(bytes / 1048576).toFixed(0)} MB`; }

/** A WEB host (vite preview / the rig): the pack is served as static files under `<baseUrl>/<group>/<name>`;
 *  nothing is downloaded, every part counts as installed, bytes come from a plain fetch. */
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
    async read(ref) {
      const res = await fetch(`${base}/${ref.group}/${ref.name}`);
      if (!res.ok) throw new Error(`art pack: HTTP ${res.status} for ${ref.group}/${ref.name}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
