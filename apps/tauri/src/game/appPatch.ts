import { updateAvailable } from './updateCheck';

/**
 * Owner 09-30 (S51): the APP PATCH channel, client side. The public packaged edition asks the shell
 * (`app_patch_check`) for a signed app-patch.json on the Latest release; the shell verifies it. An offer is shown
 * in the existing update prompt; "Update now" only downloads/stages the missing parts (progress in bytes); "Restart"
 * activates, prunes and reloads the page (the shell serves the new app from sfapp://; no process relaunch). Round 2:
 * "Later" leaves nothing active — a running page keeps its own generation; staged parts are reused (installed.json)
 * by a later Restart or the next launch's check. A manifest that
 * needs a newer shell hands over to the installer updater. Host-agnostic like artPack.ts (tests use a fake host).
 */
export interface AppPatchStatus { shellVersion: string; embeddedVersion: string; activeVersion: string | null; lastError: string | null }
export interface AppPatchOfferPart { group: string; size: number }
export interface AppPatchCheck {
  upToDate: boolean; needsShell: boolean; version?: string; shellMin?: string; manifestSha?: string; notes?: string;
  parts: AppPatchOfferPart[]; toFetch: string[];
}
export interface AppPatchOffer { version: string; manifestSha: string; notes?: string; parts: AppPatchOfferPart[]; toFetch: string[] }
export type AppPatchDecision =
  | { kind: 'none' }
  | { kind: 'shell'; version: string; shellMin: string }
  | { kind: 'offer'; offer: AppPatchOffer };

export function decideAppPatch(check: AppPatchCheck): AppPatchDecision {
  if (check.needsShell) return { kind: 'shell', version: check.version ?? '', shellMin: check.shellMin ?? '' };
  if (check.upToDate || !check.version || !check.manifestSha) return { kind: 'none' };
  return { kind: 'offer', offer: { version: check.version, manifestSha: check.manifestSha, notes: check.notes, parts: check.parts, toFetch: check.toFetch } };
}

/** The parts still to download (the shell already named them in `toFetch`). */
export function partsToInstall(offer: AppPatchOffer): AppPatchOfferPart[] {
  const want = new Set(offer.toFetch);
  return offer.parts.filter((p) => want.has(p.group));
}

/** D2: the installer updater compares latest.json with the SHELL version, never with the (possibly patched) page. */
export function shellUpdateAvailable(shellVersion: string, latestVersion: string): boolean {
  return updateAvailable(shellVersion, latestVersion);
}

/** About panel / console: `app X (shell Y)`. */
export function versionLine(appVersion: string, status: AppPatchStatus | null): string {
  return status ? `app ${appVersion} (shell ${status.shellVersion})` : appVersion;
}

export interface AppPatchHost {
  status(): Promise<AppPatchStatus>;
  check(): Promise<AppPatchCheck>;
  installPart(manifestSha: string, group: string): Promise<void>;
  activate(manifestSha: string): Promise<void>;
  prune(): Promise<void>;
  rollback(): Promise<void>;
  /** The page reload that brings the activated patch up (never a process relaunch). */
  reload(): void;
}

export interface AppPatchProgress { downloaded: number; total: number }

/** Download/stage the missing parts one by one (bytes/total after each). Nothing is activated here. */
export async function installAppPatch(host: Pick<AppPatchHost, 'installPart'>, offer: AppPatchOffer, onProgress: (p: AppPatchProgress) => void): Promise<void> {
  const todo = partsToInstall(offer);
  const progress = { downloaded: 0, total: todo.reduce((n, p) => n + p.size, 0) };
  onProgress({ ...progress });
  for (const part of todo) {
    await host.installPart(offer.manifestSha, part.group);
    progress.downloaded += part.size;
    onProgress({ ...progress });
  }
}

/** "Restart" after staging: activate, prune (best-effort), then reload the page; the shell keeps running. */
export async function restartIntoPatch(host: Pick<AppPatchHost, 'activate' | 'prune' | 'reload'>, offer: AppPatchOffer): Promise<void> {
  await host.activate(offer.manifestSha);
  await host.prune().catch(() => { /* leftovers are pruned after the next activation */ });
  host.reload();
}
/** "Use the built-in version": drop the active patch and reload. */
export async function useBuiltInVersion(host: Pick<AppPatchHost, 'rollback' | 'reload'>): Promise<void> {
  await host.rollback();
  host.reload();
}

export async function tauriAppPatchHost(): Promise<AppPatchHost> {
  const { invoke } = await import('@tauri-apps/api/core');
  return {
    status: () => invoke<AppPatchStatus>('app_patch_status'),
    check: () => invoke<AppPatchCheck>('app_patch_check'),
    async installPart(manifestSha, group) { await invoke('app_patch_install_part', { manifestSha, group }); },
    async activate(manifestSha) { await invoke('app_patch_activate', { manifestSha }); },
    async prune() { await invoke('app_patch_prune'); },
    async rollback() { await invoke('app_patch_rollback'); },
    reload: () => window.location.reload(),
  };
}
