import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { artPackGroup } from './vite-plugin-art-pack';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|ico)$/i;

/**
 * Owner 09-30 (S51): the APP PATCH build hook. Every build emits app-version.json (the shell reads the embedded
 * dist's version from it; a patched page serves the patch's copy). With FUMBBL_APP_PATCH=1 it also records each
 * emitted asset's ORIGIN group (packages/ffb-pitch/assets -> stadium, weather, ...; other images -> images) in
 * dist-patch/origins.json - the origin is gone once the file is in dist - for scripts/build-app-patch.mjs, which
 * packs dist after the guards.
 */
export function appPatchPlugin(opts: { enabled: boolean; appVersion: string; outDir: string }): Plugin {
  return {
    name: 'super-fumbbl-app-patch',
    apply: 'build',
    buildStart() {
      if (opts.enabled) { rmSync(opts.outDir, { recursive: true, force: true }); mkdirSync(opts.outDir, { recursive: true }); }
    },
    generateBundle(_options, bundle) {
      this.emitFile({ type: 'asset', fileName: 'app-version.json', source: JSON.stringify({ version: opts.appVersion }) });
      if (!opts.enabled) return;
      const origins: Record<string, string> = {};
      for (const out of Object.values(bundle)) {
        if (out.type !== 'asset') continue;
        const origin = (out as { originalFileNames?: string[] }).originalFileNames?.[0] ?? '';
        // Round 2: ffb-pitch art by its art group; any other image origin (apps/tauri/src/assets, …) -> `images`.
        const group = artPackGroup(origin) ?? (origin && IMAGE_EXT.test(out.fileName) ? 'images' : null);
        if (group) origins[out.fileName] = group;
      }
      writeFileSync(resolve(opts.outDir, 'origins.json'), JSON.stringify(origins, null, 2) + '\n');
    },
  };
}
