export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'display', label: 'Display' },
  { id: 'mods', label: 'Mods' },
  { id: 'ui', label: 'UI' },
  { id: 'credits', label: 'Credits' },
] as const;

export type SettingsTab = (typeof SETTINGS_SECTIONS)[number]['id'];

/** Accept old deep links and untrusted callers without persisting navigation state. */
export function resolveSettingsTab(value: unknown): SettingsTab {
  switch (value) {
    case 'general':
    case 'account':
    case 'connection':
    case 'gameplay':
    case 'controls':
    case 'spectator':
    case 'advanced': return 'general';
    case 'accessibility': return 'accessibility';
    case 'appearance':
    case 'display': return 'display';
    case 'assets':
    case 'mods': return 'mods';
    case 'audio':
    case 'ui': return 'ui';
    case 'about':
    case 'credits': return 'credits';
    default: return 'general';
  }
}

/** Values changed by other app surfaces or immediate OS/keychain operations do not
 * participate in the Settings preview transaction. */
export const SETTINGS_TRANSACTION_EXCLUDED = new Set([
  'logPos', 'logSize', 'setupBrowserPos', 'setupBrowserSize', 'uiLayout', 'chatPoppedOut', 'chatPopPos', 'chatPopSize',
  'coach', 'password', 'coach40k', 'activeServerTarget',
  'completedFirstRun', 'savedSetupPreviews',
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
