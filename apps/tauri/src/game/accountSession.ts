let browserSession = '';

function inTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export async function saveAccountSession(token: string): Promise<void> {
  if (!inTauri()) {
    browserSession = token;
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('save_account_session', { token });
}

export async function loadAccountSession(): Promise<string> {
  if (!inTauri()) return browserSession;
  const { invoke } = await import('@tauri-apps/api/core');
  return ((await invoke('load_account_session')) as string | null) ?? '';
}

export async function clearAccountSession(): Promise<void> {
  browserSession = '';
  if (!inTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('clear_account_session');
}
