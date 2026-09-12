import { Assets } from 'pixi.js';

/**
 * Pin Pixi's asset resolver to the page origin.
 *
 * Pixi's URL helper only treats `http(s)://` as a URL when it derives the root for a
 * root-relative path such as `/assets/walk-x.png`. On Windows the packaged app runs at
 * `http://tauri.localhost/`, so the default works. On macOS and Linux the origin is
 * `tauri://localhost/`, and the derived root collapses to `tauri://`, so every bundled
 * texture resolves to `tauri://assets/...` (a bogus host) and silently 404s: no walk sheets,
 * no skill badges, no stadium art. Handing the resolver the real root (and base) makes
 * resolution identical on every platform and in the Vite dev server.
 *
 * Call once per entry point, before the first `Assets.load`.
 */
export function configurePixiAssetOrigin(): void {
  if (typeof document === 'undefined') return;
  const base = document.baseURI || window.location.href;
  let root: string;
  try {
    root = new URL('/', base).href;
  } catch {
    return;
  }
  Assets.resolver.basePath = root;
  Assets.resolver.rootPath = root;
}
