/** Open an external URL in the system browser (Tauri opener plugin; window.open on the web or when the plugin fails).
 *  External links don't navigate/embed inside the packaged webview. Shared by App.vue and the first-launch setup
 *  wizard (owner 10-06). */
export async function openExternal(url: string): Promise<void> {
  const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  if (inTauri) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch {
      /* fall through to window.open */
    }
  }
  window.open(url, '_blank', 'noopener');
}
