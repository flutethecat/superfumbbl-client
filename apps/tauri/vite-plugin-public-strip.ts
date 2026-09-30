import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Owner 09-29: private developer tooling "always stays out of public branches" — and out of public BUILDS. Public
 * installers are built from the PRIVATE tree with apps/tauri/edition.json flipped to `public`, so the source-level
 * strip the export applies has to happen at compile time too. Active only for edition `public` (the config leaves it
 * out for the fork build; it is also listed in `worker.plugins`). It runs before the Vue plugin (`enforce: 'pre'`),
 * applies the export's own strip function — chosen by the export's own "which files are stripped" predicate — to every
 * source module, and FAILS the build if anything resolves into the private source directory or if a fence marker turns
 * up in a module the strip does not cover.
 *
 * The fence marker, the private directory, the predicate and the strip function live only in
 * scripts/strip-private-regions.mjs, which the public export does not ship. This file is exported: when that script is
 * absent (an exported tree has nothing left to strip) the plugin does nothing, and it names no private identifier itself.
 */
const STRIP_MODULE = fileURLToPath(new URL('../../scripts/strip-private-regions.mjs', import.meta.url));

interface StripModule {
  PRIVATE_DIR: string;
  stripPrivateRegions(text: string, label?: string): { text: string; regions: number };
  isStrippedSource(rel: string): boolean;
  hasFenceMarker(text: string): boolean;
}

export function publicStripPlugin(opts: { edition: string }): Plugin {
  let mod: StripModule | null = null;
  const norm = (id: string) => id.split('?')[0]!.replace(/\\/g, '/');
  const isPrivate = (id: string) => mod !== null && norm(id).toLowerCase().includes(`/${mod.PRIVATE_DIR.toLowerCase()}`);
  const refuse = (file: string): string => `public edition build: "${norm(file)}" is under ${mod?.PRIVATE_DIR} and must not be bundled — something outside a private fence still imports it.`;
  return {
    name: 'public-edition-strip',
    enforce: 'pre',
    apply: () => opts.edition === 'public',
    async buildStart() {
      if (existsSync(STRIP_MODULE)) mod = (await import(/* @vite-ignore */ pathToFileURL(STRIP_MODULE).href)) as StripModule;
    },
    // Any import (script, style, asset, glob) that resolves into the private directory fails the build.
    async resolveId(source, importer, options) {
      if (!mod || !importer || source.startsWith('\0')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved && isPrivate(resolved.id)) this.error(refuse(resolved.id));
      return null;
    },
    transform(code, id) {
      if (!mod) return null;
      if (isPrivate(id)) this.error(refuse(id));
      if (id.startsWith('\0')) return null;
      const file = norm(id); // the query is dropped: `?raw`, `?url`, `?inline` and friends see the same file
      // A query import (other than an SFC block request, which derives from the already stripped file) hands the file's
      // text out as data; if that text carries a fence marker it would bypass the strip, so it fails the build.
      if (id.includes('?') && !/[?&]vue\b/.test(id) && mod.hasFenceMarker(code)) {
        this.error(`public edition build: "${file}" is imported with a query (?${id.split('?')[1]}) and carries a private fence marker; that text would bypass the strip.`);
      }
      // The same predicate the export uses decides what is stripped; a fence in any other module is an error, not a leak.
      if (mod.isStrippedSource(file)) {
        const { text, regions } = mod.stripPrivateRegions(code, file);
        return regions ? { code: text, map: null } : null;
      }
      if (mod.hasFenceMarker(code)) this.error(`public edition build: "${file}" carries a private fence marker but is not a source file the strip covers.`);
      return null;
    },
  };
}
