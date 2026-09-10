import { reactive } from 'vue';

/**
 * Owner 2026-07-04: SailThe7Seas — the "-arrrr" launch gate over gated assets.
 *
 * Launching the application with the `-arrrr` argument (desktop CLI; dev/browser
 * mirrors follow the skipSplash convention: a `?arrrr` URL query or
 * `VITE_ARRRR=true`) triggers SailThe7Seas() at application launch, which sets
 * EVERY asset registered to it to ENABLED.
 *
 * Installed skill-icon packs are intentionally not part of this gate. Their
 * exact installed identity is resolved by the shared asset-mod snapshot; only
 * the deprecated skill-description tooltips remain OFF unless sailing.
 */
export const sevenSeas = reactive({
  /** true once SailThe7Seas() has run this session (the -arrrr launch path). */
  sailing: false,
  /** Deprecated skill-description tooltips — OFF in the base build (case 250). */
  SKILL_DESC_TOOLTIPS_ENABLED: false,
});

/** Hoist the colours: every asset under the gate flips to ENABLED. */
export function SailThe7Seas(): void {
  sevenSeas.sailing = true;
  sevenSeas.SKILL_DESC_TOOLTIPS_ENABLED = true;
}

/**
 * Detect the launch argument at application launch and trigger SailThe7Seas.
 * Desktop: the real `-arrrr` CLI argument via the Tauri `launch_args` command.
 * Dev/browser: `?arrrr` URL query or `VITE_ARRRR=true` (skipSplash convention).
 */
export async function detectSailThe7Seas(): Promise<void> {
  if (
    import.meta.env.VITE_ARRRR === 'true' ||
    (typeof location !== 'undefined' && new URLSearchParams(location.search).has('arrrr'))
  ) {
    SailThe7Seas();
    return;
  }
  try {
    if (!('__TAURI_INTERNALS__' in window)) return; // plain browser dev — no CLI args
    const { invoke } = await import('@tauri-apps/api/core');
    const args = await invoke<string[]>('launch_args');
    if (args.some((a) => a === '-arrrr' || a === '--arrrr')) SailThe7Seas();
  } catch {
    /* no backend / command available — stay ashore */
  }
}
