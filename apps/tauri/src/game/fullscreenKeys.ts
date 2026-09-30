/** Structural subset of KeyboardEvent the fullscreen-key decision reads (keeps it unit-testable without a DOM). */
export interface FullscreenKeyEvent {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  target?: unknown;
}

const TEXT_ENTRY = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

function isTextEntry(target: unknown): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null | undefined;
  return typeof el?.closest === 'function' && !!el.closest(TEXT_ENTRY);
}

/**
 * S49 (owner 09-30): F11 and Alt+Enter toggle fullscreen. Alt+Enter is ignored while typing (chat, notes, settings
 * fields); F11 has no text meaning so it still works there. A user-rebound confirm key keeps its binding. Held keys
 * and IME composition never re-toggle.
 */
export function fullscreenKeyDecision(e: FullscreenKeyEvent, opts: { confirmKey?: string; capturingKey?: boolean } = {}): 'toggle' | 'ignore' {
  if (opts.capturingKey || e.repeat || e.isComposing) return 'ignore';
  if (opts.confirmKey && e.code === opts.confirmKey) return 'ignore';
  if (e.ctrlKey || e.metaKey || e.shiftKey) return 'ignore';
  if (e.key === 'F11' && !e.altKey) return 'toggle';
  if (e.key === 'Enter' && e.altKey && !isTextEntry(e.target)) return 'toggle';
  return 'ignore';
}
