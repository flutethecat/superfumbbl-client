/**
 * The desktop client owns right-click interaction. Preventing the browser default does not stop propagation,
 * so pitch/player handlers still receive the event while Chromium's Back/Refresh/Save/Print menu never opens.
 */
export function suppressNativeContextMenu(event: Event): void {
  event.preventDefault();
}

export function installNativeContextMenuSuppression(target: Document = document): () => void {
  target.addEventListener('contextmenu', suppressNativeContextMenu, true);
  return () => target.removeEventListener('contextmenu', suppressNativeContextMenu, true);
}
