import { settings } from './settings';

/**
 * Owner 2026-07-10: DEVELOPER mode detection. Unlocks the Settings → Developer section + the live
 * Developer log panel. Desktop: the real `-dev` (or `--dev`) CLI argument via the Tauri `launch_args`
 * command. Dev/browser: a `?dev` URL query or
 * `VITE_DEV_PANEL=true` (the skipSplash convention). Sets `settings.devMode` (persisted) so a later
 * normal launch keeps it available until the owner toggles it off.
 */
export async function detectDevMode(): Promise<void> {
  if (
    import.meta.env.VITE_DEV_PANEL === 'true' ||
    (typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev'))
  ) {
    settings.devMode = true;
    return;
  }
  try {
    if (!('__TAURI_INTERNALS__' in window)) return; // plain browser dev — no CLI args
    const { invoke } = await import('@tauri-apps/api/core');
    const args = await invoke<string[]>('launch_args');
    if (args.some((a) => a === '-dev' || a === '--dev')) settings.devMode = true;
  } catch {
    /* no backend / command available — leave devMode as the stored value */
  }
}
