export interface NativeFullscreenHost {
  isFullscreen(): Promise<boolean>;
  setFullscreen(active: boolean): Promise<void>;
}

export interface BrowserFullscreenHost {
  readonly fullscreenElement: Element | null;
  readonly documentElement: Element & { requestFullscreen(): Promise<void> };
  exitFullscreen(): Promise<void>;
}

export interface FullscreenResult {
  active: boolean;
  native: boolean;
}

/**
 * Prefer the desktop window's real fullscreen mode. Browser preview remains usable
 * through the standards-based document fallback, but a packaged Tauri client never
 * enters WebView-only fullscreen when the native window API is available.
 */
export async function toggleFullscreenSurface(
  nativeHost: NativeFullscreenHost | null,
  browserHost: BrowserFullscreenHost,
): Promise<FullscreenResult> {
  if (nativeHost) {
    try {
      const active = await nativeHost.isFullscreen();
      await nativeHost.setFullscreen(!active);
      return { active: !active, native: true };
    } catch {
      // Browser/dev preview, or a native permission/runtime failure: retain the
      // old preview behavior instead of turning the control into a no-op.
    }
  }

  const nextActive = !browserHost.fullscreenElement;
  if (nextActive) await browserHost.documentElement.requestFullscreen();
  else await browserHost.exitFullscreen();
  return { active: nextActive, native: false };
}

export async function readFullscreenSurface(
  nativeHost: NativeFullscreenHost | null,
  browserHost: Pick<BrowserFullscreenHost, 'fullscreenElement'>,
): Promise<FullscreenResult> {
  if (nativeHost) {
    try {
      return { active: await nativeHost.isFullscreen(), native: true };
    } catch {
      // Same fallback contract as toggleFullscreenSurface.
    }
  }
  return { active: !!browserHost.fullscreenElement, native: false };
}
