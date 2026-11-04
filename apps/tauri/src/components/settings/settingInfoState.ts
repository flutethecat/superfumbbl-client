// Owner 11-03 settings reflow (lane B): the one Settings "i" that is showing (a tooltip or an inline preview panel).
// Settings owns Escape in a window capture listener (App.vue escSettings), so the "i" cannot see the key itself: the
// Settings Escape step asks this module first, and an open "i" closes (focus back on it) instead of Settings.

export interface OpenSettingInfo {
  /** Hides the tooltip or panel; `restoreFocus` puts focus back on the "i". */
  close(restoreFocus: boolean): void;
}

let current: OpenSettingInfo | null = null;

/** The "i" now showing; any other one closes (one tooltip or panel at a time). */
export function claimSettingInfo(info: OpenSettingInfo): void {
  if (current && current !== info) current.close(false);
  current = info;
}

export function releaseSettingInfo(info: OpenSettingInfo): void {
  if (current === info) current = null;
}

/** Escape step: closes the showing "i" and returns focus to it. False when none is showing. */
export function closeOpenSettingInfo(): boolean {
  const info = current;
  if (!info) return false;
  current = null;
  info.close(true);
  return true;
}

/** Sol final r4: a nested modal (Reset UI confirmation, credentials, key capture...) opened over Settings: close the
 *  showing "i" without moving focus (the modal owns focus now). False when none is showing. */
export function dismissOpenSettingInfo(): boolean {
  const info = current;
  if (!info) return false;
  current = null;
  info.close(false);
  return true;
}
