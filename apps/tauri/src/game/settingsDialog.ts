import { t } from '../i18n';
/** Owner 11-03 settings reflow: 13 tabs in a scrollable rail, in this order (the agreed mock). */
export const SETTINGS_SECTIONS = [
  { id: 'general', get label() { return t('settings.settingsSections.general'); } },
  { id: 'controls', get label() { return t('settings.settingsSections.controls'); } },
  { id: 'pitch', get label() { return t('settings.settingsSections.pitch'); } },
  { id: 'skills', get label() { return t('settings.settingsSections.skills'); } },
  { id: 'ui', get label() { return t('settings.settingsSections.ui'); } },
  { id: 'art', get label() { return t('settings.settingsSections.art'); } },
  { id: 'audio', get label() { return t('settings.settingsSections.audio'); } },
  { id: 'video', get label() { return t('settings.settingsSections.video'); } },
  { id: 'accessibility', get label() { return t('settings.settingsSections.accessibility'); } },
  { id: 'account', get label() { return t('settings.settingsSections.account'); } },
  { id: 'modpacks', get label() { return t('settings.settingsSections.modPacks'); } },
  { id: 'diagnostics', get label() { return t('settings.settingsSections.diagnostics'); } },
  { id: 'credits', get label() { return t('settings.settingsSections.credits'); } },
] as const;

export type SettingsTab = (typeof SETTINGS_SECTIONS)[number]['id'];

/** The one-line caption in each tab's band (owner 11-03 mock). */
export const SETTINGS_TAB_BLURBS: Record<SettingsTab, string> = {
  get general() { return t('settings.tabBlurbs.general'); },
  get controls() { return t('settings.tabBlurbs.controls'); },
  get pitch() { return t('settings.tabBlurbs.pitch'); },
  get skills() { return t('settings.tabBlurbs.skills'); },
  get ui() { return t('settings.tabBlurbs.ui'); },
  get art() { return t('settings.tabBlurbs.art'); },
  get audio() { return t('settings.tabBlurbs.audio'); },
  get video() { return t('settings.tabBlurbs.video'); },
  get accessibility() { return t('settings.tabBlurbs.accessibility'); },
  get account() { return t('settings.tabBlurbs.account'); },
  get modpacks() { return t('settings.tabBlurbs.modpacks'); },
  get diagnostics() { return t('settings.tabBlurbs.diagnostics'); },
  get credits() { return t('settings.tabBlurbs.credits'); },
};

/** Accept old deep links and untrusted callers without persisting navigation state. Owner 11-03 reflow: every id the
 *  7-tab dialog used still lands on the tab that now holds its rows (Display -> Pitch, the old Art id `mods` -> Art). */
export function resolveSettingsTab(value: unknown): SettingsTab {
  switch (value) {
    case 'general':
    case 'connection':
    case 'gameplay':
    case 'spectator': return 'general';
    case 'controls':
    case 'controller':
    case 'keyboard': return 'controls'; // controller support P1 (owner 10-07): keyboard + controller bindings
    case 'appearance':
    case 'display':
    case 'pitch': return 'pitch';
    case 'skills': return 'skills';
    case 'ui': return 'ui';
    case 'art':
    case 'mods': return 'art';
    case 'audio':
    case 'sound': return 'audio';
    case 'video': return 'video';
    case 'accessibility': return 'accessibility';
    case 'account': return 'account';
    case 'assets':
    case 'modpacks': return 'modpacks';
    case 'advanced': // the old General > Advanced group held the diagnostics
    case 'diagnostics': return 'diagnostics';
    case 'about':
    case 'credits': return 'credits';
    default: return 'general';
  }
}

/** Values changed by other app surfaces or immediate OS/keychain operations do not
 * participate in the Settings preview transaction. */
export const SETTINGS_TRANSACTION_EXCLUDED = new Set([
  'logPos', 'logSize', 'playerCardPos', 'playerCardSize', 'setupBrowserPos', 'setupBrowserSize', 'uiLayout', 'chatPoppedOut', 'chatPopPos', 'chatPopSize',
  'coach', 'password', 'coach40k', 'activeServerTarget',
  'completedFirstRun', 'savedSetupPreviews',
  'recentPlayedTeams', // owner 10-11: written when an official game is joined, never by the dialog
  'clientTourSeenVersion', // the client walkthrough sets it outside the dialog; its "run again" button must survive Cancel
  // Owner 10-06: the FUMBBL.COM walkthrough / zoom keys.
  'homeTourSeenVersion', // the walkthrough sets it outside the dialog; its "run again" button must not be undone by Cancel
  'homePaneZoom', // the Home pane's own zoom strip
  'fumbblFloatPos', 'fumbblFloatSize', 'fumbblFloatQueueSize', 'fumbblFloatZoom', // owner 10-08: the floating FUMBBL window is moved / resized outside the dialog
]);

export function settingsTransactionSnapshot(value: Record<string, unknown>): string {
  const snapshot: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (!SETTINGS_TRANSACTION_EXCLUDED.has(key)) snapshot[key] = value[key];
  }
  return JSON.stringify(snapshot);
}

export async function acceptSettingsPreview(
  flush: () => Promise<void>,
  capture: () => string,
): Promise<string> {
  await flush();
  return capture();
}

export async function cancelSettingsPreview(
  snapshot: string,
  restore: (snapshot: string) => Promise<boolean>,
): Promise<boolean> {
  return restore(snapshot);
}

export function nextSettingsSection(current: SettingsTab, key: string): SettingsTab | null {
  const index = SETTINGS_SECTIONS.findIndex((section) => section.id === current);
  if (key === 'Home') return SETTINGS_SECTIONS[0].id;
  if (key === 'End') return SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1]!.id;
  if (key === 'ArrowDown') return SETTINGS_SECTIONS[(index + 1) % SETTINGS_SECTIONS.length]!.id;
  if (key === 'ArrowUp') return SETTINGS_SECTIONS[(index - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length]!.id;
  return null;
}

const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Visibility-aware focus helpers shared by the desktop tabs, narrow select and nested dialogs. */
export function isVisibleFocusTarget(element: HTMLElement | null): element is HTMLElement {
  if (!element || !element.isConnected || element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
  if (typeof getComputedStyle !== 'function') return true;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

export function visibleFocusTargets(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisibleFocusTarget);
}

export function focusInitialSettingsControl(root: HTMLElement): boolean {
  const candidates = [
    root.querySelector<HTMLElement>('.settings-category-select select'),
    root.querySelector<HTMLElement>('.settings-nav [aria-selected="true"]'),
  ];
  const target = candidates.find(isVisibleFocusTarget);
  target?.focus();
  return !!target;
}

export function focusFirstInDialog(root: HTMLElement, preferredSelector?: string): boolean {
  const preferred = preferredSelector ? root.querySelector<HTMLElement>(preferredSelector) : null;
  const target = isVisibleFocusTarget(preferred) ? preferred : visibleFocusTargets(root)[0];
  target?.focus();
  return !!target;
}

/** Tab / Shift+Tab stay inside `root`. `extraRoots` (owner 10-06: the client walkthrough's card docked beside
 *  Settings) join the cycle after `root`: focus moves explicitly between the groups, so a group outside the dialog in
 *  the DOM is still reachable by keyboard and the cycle still never leaves them. */
export function trapDialogFocus(event: KeyboardEvent, root: HTMLElement | null, extraRoots: (HTMLElement | null)[] = []): void {
  if (event.key !== 'Tab' || !root) return;
  const extras = extraRoots.filter((r): r is HTMLElement => !!r);
  if (extras.length) {
    const cycle = [root, ...extras].flatMap((r) => visibleFocusTargets(r));
    if (!cycle.length) return;
    const at = cycle.indexOf(document.activeElement as HTMLElement);
    const next = at < 0 ? 0 : (at + (event.shiftKey ? -1 : 1) + cycle.length) % cycle.length;
    event.preventDefault();
    cycle[next]!.focus();
    return;
  }
  const focusable = visibleFocusTargets(root);
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export function restoreDialogFocus(candidate: HTMLElement | null, fallback: HTMLElement | null): boolean {
  const target = isVisibleFocusTarget(candidate) ? candidate : (isVisibleFocusTarget(fallback) ? fallback : null);
  target?.focus();
  return !!target;
}

export function settingsTransactionIsBusy(state: {
  discarding: boolean; applying: boolean; creatorApplying: boolean; assignmentPending: boolean;
}): boolean {
  return state.discarding || state.applying || state.creatorApplying || state.assignmentPending;
}

/** Settings, or the setup wizard re-run over the live shell (owner 10-06), owns the keyboard: gameplay keys stand down. */
export function appShellModalOwnsKeyboard(settingsOpen: boolean, setupWizardOpen = false): boolean {
  return settingsOpen || setupWizardOpen;
}

export type SettingsEscapeAction = 'cancel-key-capture' | 'close-registration' | 'close-credentials' | 'cancel-settings' | null;
export function settingsEscapeAction(state: {
  settingsOpen: boolean; credentialsOpen: boolean; registrationOpen: boolean; capturingKey: boolean;
}): SettingsEscapeAction {
  if (!state.settingsOpen && !state.credentialsOpen && !state.registrationOpen) return null;
  if (state.registrationOpen) return 'close-registration';
  if (state.credentialsOpen) return 'close-credentials';
  if (state.capturingKey) return 'cancel-key-capture';
  return 'cancel-settings';
}

export function runConfirmedImmediateOperation(confirm: () => boolean, operation: () => void): boolean {
  if (!confirm()) return false;
  operation();
  return true;
}
