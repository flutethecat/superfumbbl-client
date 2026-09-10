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

export function trapDialogFocus(event: KeyboardEvent, root: HTMLElement | null): void {
  if (event.key !== 'Tab' || !root) return;
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

export function appShellModalOwnsKeyboard(settingsOpen: boolean): boolean {
  return settingsOpen;
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
