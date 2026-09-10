import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Owner 2026-07-07: expose the app version (from package.json) to the UI as __APP_VERSION__,
// so the header tag stays in sync with the release bump automatically.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };

// Owner 2026-07-10 (dev-version nomenclature): a DEV cut of X.Y.Z carries the next LETTER
// (0.2.8a/b/c/d…, monotonic, never reused); the PUBLISHED release built from the tag is BARE X.Y.Z.
// The letter is a BUILD-TIME env (FUMBBL_DEV_LETTER) — NOT a semver field — because Cargo/tauri.conf
// semver won't accept a letter, so package.json/Cargo/tauri.conf all STAY bare. A letter appearing on a
// deployed artifact therefore means a dev build leaked to deploy (the owner's tripwire; the gate refuses
// it). The letter + the short git SHA ride in __APP_VERSION__ (→ wire-log appVersion + window title) and
// __GIT_SHA__ so every build self-identifies its exact source. Veers builds the release with no
// FUMBBL_DEV_LETTER → bare version. See memory dev-version-nomenclature.md.
const devLetter = (process.env.FUMBBL_DEV_LETTER ?? '').trim();
const appVersion = pkg.version + devLetter; // e.g. "0.2.8d" (dev) or "0.2.8" (published)
const assetPackBuilder = process.env.F40KMOD_BUILDER_UI === '1';
// Owner 09-10 (public repo): the EDITION — 'fork' (private tree, default) or 'public' (the export rewrites
// apps/tauri/edition.json). Public = Official FUMBBL only on the play path; the fork blades, targets, accounts,
// Discord SSO and tournament polling are compiled out. Bug reports stay (config-web accepts a public-edition report).
const edition = String(JSON.parse(readFileSync(new URL('./edition.json', import.meta.url), 'utf8')).edition ?? 'fork');
let gitSha = 'nogit';
try { gitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim(); } catch { /* not a git checkout */ }

// Tauri expects a fixed dev port (see src-tauri/tauri.conf.json devUrl).
export default defineConfig({
  plugins: [
    vue(),
    ...(assetPackBuilder ? [{
      name: 'f40kmod-builder-entry',
      transformIndexHtml(html: string) {
        return html.replace('<title>Super FUMBBL</title>', '<title>Super FUMBBL Asset Pack Builder</title>');
      },
    }] : []),
  ],
  resolve: {
    alias: assetPackBuilder ? [{
      find: '/src/main.ts',
      replacement: fileURLToPath(new URL('./src/assetPackBuilderMain.ts', import.meta.url)),
    }] : [],
  },
  clearScreen: false,
  // Keep shipped placeholder art as auditable files. Inlining would hide the
  // bytes inside JavaScript and make the installer-content gate ambiguous.
  build: { assetsInlineLimit: 0 },
  define: {
    __FORK_EDITION__: JSON.stringify(edition !== 'public'),
    __APP_VERSION__: JSON.stringify(appVersion),
    __GIT_SHA__: JSON.stringify(gitSha),
    __ASSET_PACK_BUILDER__: JSON.stringify(assetPackBuilder),
  },
  server: {
    port: 1420,
    strictPort: true,
    // The app intentionally consumes the workspace ffb-pitch package's source
    // assets. Vitest runs with apps/tauri as its root, so admit that monorepo
    // boundary only in tests; the desktop dev server keeps its existing scope.
    ...(process.env.VITEST ? { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } } : {}),
    // This proxy is retained for FUMBBL's non-media API traffic in development.
    // Asset CDN requests are deliberately unsupported.
    proxy: {
      '/fumbbl-site': {
        target: 'https://fumbbl.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/fumbbl-site/, ''),
      },
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
});
