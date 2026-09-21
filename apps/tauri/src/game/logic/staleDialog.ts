export const SETUP_NOTICE_LIVE_MODES: ReadonlySet<string> = new Set([
  'setup',
  'solidDefence',
  'perfectDefence',
  'swarming',
]);

export function staleDialogOutlivedPhase(dialogId: string, turnMode: unknown): boolean {
  if ((dialogId === 'setupError' || dialogId === 'swarmingError')
      && !SETUP_NOTICE_LIVE_MODES.has(String(turnMode ?? ''))) return true;
  if (dialogId === 'selectBlitzTarget') {
    return typeof turnMode === 'string' && turnMode.length > 0 && turnMode !== 'selectBlitzTarget';
  }
  return false; // not proven stale; does NOT assert liveness
}
