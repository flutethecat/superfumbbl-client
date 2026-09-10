/**
 * Bundled stadium packs: `packages/ffb-pitch/assets/stadium/<pack-id>/stadium-pack.json` + its model file. The
 * folder is empty until an asset lands (Codex is producing the first, owner 09-05) — the glob is simply empty then.
 */
import { validateStadiumPack, type StadiumPackManifest } from './stadiumModel';

const manifests = import.meta.glob<{ default: unknown }>('../assets/stadium/*/stadium-pack.json', { eager: true });
const modelUrls = import.meta.glob<string>('../assets/stadium/*/*.{glb,gltf}', { query: '?url', import: 'default', eager: true });

export interface BundledStadiumPack { manifest: StadiumPackManifest; modelUrl: string; dir: string }

let cache: BundledStadiumPack[] | null = null;

export function bundledStadiumPacks(): BundledStadiumPack[] {
  if (cache) return cache;
  const packs: BundledStadiumPack[] = [];
  for (const [path, mod] of Object.entries(manifests)) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    try {
      const manifest = validateStadiumPack((mod as { default?: unknown }).default ?? mod);
      const modelUrl = modelUrls[`${dir}/${manifest.model.path.replace(/^\.\//, '')}`];
      if (!modelUrl) { console.warn(`Stadium pack ${manifest.id}: model ${manifest.model.path} not bundled`); continue; }
      packs.push({ manifest, modelUrl, dir });
    } catch (error) {
      console.warn(`Stadium pack at ${path} rejected`, error);
    }
  }
  cache = packs;
  return packs;
}
