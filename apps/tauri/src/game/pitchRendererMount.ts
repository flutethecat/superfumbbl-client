import type { PitchRenderer } from '@fumbbl40k/ffb-pitch';

/** Shared Modern/Classic async-mount boundary. Vue can unmount while Pixi or an asset pack is still resolving;
 * only the renderer that still owns the view may install callbacks/watchers after init. Network/session lifetime is
 * intentionally outside this helper. */
export async function initPitchRendererMount(
  renderer: PitchRenderer,
  host: HTMLElement,
  isCurrent: () => boolean,
): Promise<boolean> {
  await renderer.init(host);
  if (isCurrent()) return true;
  renderer.destroy();
  return false;
}
