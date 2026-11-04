import { $t } from '../i18n';
import type { StepDirection } from './logic/fumbblControls';

/**
 * FUMBBL keyboard shortcuts (owner 11-03, spec-fumbbl-controls-2026-11-03.md §5): one toggle (`fumbblShortcuts`, off by
 * default, usable in either control layer). Defaults are the FUMBBL client's exact keys (ffb-client client.ini):
 * Q/W/E/A/D/Y/X/C step one square (server move squares only), S selects / opens the menu for the hovered player,
 * < / Shift+< cycle players, Ctrl+M Move, Ctrl+B Block, Ctrl+Z Blitz, Ctrl+F Foul, Ctrl+P Pass, Ctrl+J Jump, Ctrl+E End.
 * Turning the toggle on disables WASD camera pan (mouse drag and edge scroll still pan).
 *
 * A binding is a KeyboardEvent.code with optional modifier prefixes in a fixed order: `Ctrl+`, `Alt+`, `Shift+`
 * (e.g. `Ctrl+KeyM`, `Shift+IntlBackslash`). Every key is rebindable (Settings > Controls > FUMBBL keyboard shortcuts);
 * the clash guard is shared with the bindings table (settings.ts controlBindingConflict / fumbblKeyConflict).
 * Pure module: no settings import (settings.ts imports it).
 */
export const FUMBBL_KEY_ACTIONS = [
  { id: 'stepNW', key: 'KeyQ', get label() { return $t('settings.fumbblKeys.stepNorthWest'); } },
  { id: 'stepN', key: 'KeyW', get label() { return $t('settings.fumbblKeys.stepNorth'); } },
  { id: 'stepNE', key: 'KeyE', get label() { return $t('settings.fumbblKeys.stepNorthEast'); } },
  { id: 'stepW', key: 'KeyA', get label() { return $t('settings.fumbblKeys.stepWest'); } },
  { id: 'stepE', key: 'KeyD', get label() { return $t('settings.fumbblKeys.stepEast'); } },
  { id: 'stepSW', key: 'KeyY', get label() { return $t('settings.fumbblKeys.stepSouthWest'); } },
  { id: 'stepS', key: 'KeyX', get label() { return $t('settings.fumbblKeys.stepSouth'); } },
  { id: 'stepSE', key: 'KeyC', get label() { return $t('settings.fumbblKeys.stepSouthEast'); } },
  { id: 'select', key: 'KeyS', get label() { return $t('settings.fumbblKeys.selectHoveredPlayer'); } },
  { id: 'cyclePrev', key: 'IntlBackslash', get label() { return $t('settings.fumbblKeys.previousPlayer'); } },
  { id: 'cycleNext', key: 'Shift+IntlBackslash', get label() { return $t('settings.fumbblKeys.nextPlayer'); } },
  { id: 'move', key: 'Ctrl+KeyM', get label() { return $t('settings.fumbblKeys.move'); } },
  { id: 'block', key: 'Ctrl+KeyB', get label() { return $t('settings.fumbblKeys.block'); } },
  { id: 'blitz', key: 'Ctrl+KeyZ', get label() { return $t('settings.fumbblKeys.blitz'); } },
  { id: 'foul', key: 'Ctrl+KeyF', get label() { return $t('settings.fumbblKeys.foul'); } },
  { id: 'pass', key: 'Ctrl+KeyP', get label() { return $t('settings.fumbblKeys.pass'); } },
  { id: 'jump', key: 'Ctrl+KeyJ', get label() { return $t('settings.fumbblKeys.jump'); } },
  { id: 'end', key: 'Ctrl+KeyE', get label() { return $t('settings.fumbblKeys.endAction'); } },
] as const;

export type FumbblKeyActionId = (typeof FUMBBL_KEY_ACTIONS)[number]['id'];
export type FumbblKeyBindings = Record<FumbblKeyActionId, string>;

export const FUMBBL_STEP_DIRECTION: Readonly<Partial<Record<FumbblKeyActionId, StepDirection>>> = {
  stepNW: 'nw', stepN: 'n', stepNE: 'ne', stepW: 'w', stepE: 'e', stepSW: 'sw', stepS: 's', stepSE: 'se',
};

/** The FFB menu row each Ctrl shortcut picks (fumbblControls.ts ffbClientAction names). */
export const FUMBBL_KEY_MENU_ROW: Readonly<Partial<Record<FumbblKeyActionId, string>>> = {
  move: 'MOVE', block: 'BLOCK', blitz: 'BLITZ', foul: 'FOUL', pass: 'PASS', jump: 'JUMP', end: 'END_MOVE',
};

export function defaultFumbblKeyBindings(): FumbblKeyBindings {
  return Object.fromEntries(FUMBBL_KEY_ACTIONS.map((a) => [a.id, a.key])) as FumbblKeyBindings;
}

const CHORD = /^(Ctrl\+)?(Alt\+)?(Shift\+)?([A-Za-z][A-Za-z0-9]{0,31})$/;
const MODIFIER_CODES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']);
export function isFumbblChord(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = CHORD.exec(value);
  return !!m && !MODIFIER_CODES.has(m[4]!);
}

/** Load-time read: every valid stored chord is kept (empty = unbound), missing / junk cells take the FFB default. */
export function normalizeFumbblKeyBindings(raw: unknown): FumbblKeyBindings {
  const out = defaultFumbblKeyBindings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const a of FUMBBL_KEY_ACTIONS) {
    const v = (raw as Record<string, unknown>)[a.id];
    if (v === '' || isFumbblChord(v)) out[a.id] = v as string;
  }
  return out;
}

/** The chord a key press makes (null for a bare modifier press). Meta counts as Ctrl (macOS Command). */
export function chordOf(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string | null {
  if (!event.code || MODIFIER_CODES.has(event.code)) return null;
  return `${event.ctrlKey || event.metaKey ? 'Ctrl+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''}${event.code}`;
}

/** The FUMBBL shortcut a key press triggers (null when the toggle is off or nothing is bound to it). */
export function fumbblKeyActionForEvent(
  s: { fumbblShortcuts: boolean; fumbblKeyBindings: FumbblKeyBindings },
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): FumbblKeyActionId | null {
  if (!s.fumbblShortcuts) return null;
  const chord = chordOf(event);
  if (!chord) return null;
  for (const a of FUMBBL_KEY_ACTIONS) if (s.fumbblKeyBindings?.[a.id] === chord) return a.id;
  return null;
}

/** The FUMBBL shortcut already holding `chord` (other than `id`), or null. */
export function fumbblKeyHolder(bindings: FumbblKeyBindings, chord: string, id?: FumbblKeyActionId): FumbblKeyActionId | null {
  if (!chord) return null;
  for (const a of FUMBBL_KEY_ACTIONS) if (a.id !== id && bindings[a.id] === chord) return a.id;
  return null;
}

export function fumbblKeyAction(id: FumbblKeyActionId): (typeof FUMBBL_KEY_ACTIONS)[number] {
  return FUMBBL_KEY_ACTIONS.find((a) => a.id === id)!;
}

/** A chord as the table shows it: `Ctrl+M`, `Shift+<`, `Q`. */
export function chordLabel(chord: string, codeLabel: (code: string) => string): string {
  if (!chord) return '—';
  const m = CHORD.exec(chord);
  if (!m) return chord;
  const code = m[4]!;
  const name = code === 'IntlBackslash' ? '<' : codeLabel(code);
  return `${m[1] ? 'Ctrl+' : ''}${m[2] ? 'Alt+' : ''}${m[3] ? 'Shift+' : ''}${name}`;
}
