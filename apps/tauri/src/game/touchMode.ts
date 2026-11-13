// Touch mode (spec-touch-mode-2026-11-12 section 3): which input mode the client runs in. Pure rules here (the media
// queries are injected so the detection is unit-testable); the live state lives in touchModeRuntime.ts.
//
// Rule: a device whose PRIMARY pointer is coarse (a finger) starts in touch mode. When a fine pointer (mouse or
// trackpad) is also present the coach is asked once, and the answer is remembered. A plain desktop or laptop stays in
// mouse mode with no prompt; touch mode is a Settings switch there. A pen counts as a finger (pointer events of type
// 'pen' get the touch tap tolerance and long-press; see packages/ffb-pitch/src/touchInput.ts).

export type TouchModeSetting = 'auto' | 'on' | 'off';
export const TOUCH_MODE_SETTINGS: readonly TouchModeSetting[] = ['auto', 'on', 'off'];
/** The remembered answer to the one-time "Touch controls / Mouse controls" question ('' = never asked). */
export type TouchModeChoice = 'touch' | 'mouse' | '';

/** End Turn / End Setup hold length in ms (spec section 5: about 0.8 s). */
export const TOUCH_HOLD_MS = { min: 400, max: 2000, step: 100, default: 800 } as const;
/** Minimum action-center / touch button size in CSS px (spec section 4: at least 48). */
export const TOUCH_BUTTON_PX = { min: 48, max: 72, step: 4, default: 48 } as const;

export interface PointerProfile {
  /** The primary pointer is coarse: `(pointer: coarse)`. */
  primaryCoarse: boolean;
  /** Some pointer is fine (a mouse / trackpad is also present): `(any-pointer: fine)`. */
  anyFine: boolean;
}

export type MatchMediaLike = (query: string) => { matches: boolean };

/** Reads the pointer profile through `matchMedia` (injected; absent = a plain mouse desktop). */
export function readPointerProfile(matchMedia?: MatchMediaLike | null): PointerProfile {
  if (!matchMedia) return { primaryCoarse: false, anyFine: true };
  const q = (query: string): boolean => { try { return matchMedia(query).matches === true; } catch { return false; } };
  return { primaryCoarse: q('(pointer: coarse)'), anyFine: q('(any-pointer: fine)') };
}

export interface TouchModeResolution {
  /** Touch mode is on now. */
  active: boolean;
  /** The one-time choice dialog is owed (auto, finger primary, a mouse also present, never answered). */
  ask: boolean;
}

/** The detection rule. While the question is still open the client stays in mouse mode (nothing changes under the
 *  coach before they answer). */
export function resolveTouchMode(setting: TouchModeSetting, choice: TouchModeChoice, profile: PointerProfile): TouchModeResolution {
  if (setting === 'on') return { active: true, ask: false };
  if (setting === 'off') return { active: false, ask: false };
  if (!profile.primaryCoarse) return { active: false, ask: false };
  if (!profile.anyFine) return { active: true, ask: false };
  if (choice === 'touch') return { active: true, ask: false };
  if (choice === 'mouse') return { active: false, ask: false };
  return { active: false, ask: true };
}

function snap(value: unknown, range: { min: number; max: number; step: number; default: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return range.default;
  const snapped = Math.round((value - range.min) / range.step) * range.step + range.min;
  return Math.min(range.max, Math.max(range.min, snapped));
}
export function normaliseTouchModeSetting(value: unknown): TouchModeSetting {
  return TOUCH_MODE_SETTINGS.includes(value as TouchModeSetting) ? value as TouchModeSetting : 'auto';
}
export function normaliseTouchModeChoice(value: unknown): TouchModeChoice {
  return value === 'touch' || value === 'mouse' ? value : '';
}
export function clampTouchHoldMs(value: unknown): number { return snap(value, TOUCH_HOLD_MS); }
export function clampTouchButtonPx(value: unknown): number { return snap(value, TOUCH_BUTTON_PX); }

/** Settings rows hidden while touch mode is active (spec section 3): they cannot apply without a mouse / keyboard. */
export const TOUCH_HIDDEN_SETTING_GROUPS = ['edit-bindings', 'right-click-settings', 'edge-pan', 'fumbbl-shortcuts'] as const;
export type TouchHiddenSettingGroup = (typeof TOUCH_HIDDEN_SETTING_GROUPS)[number];
export function settingGroupShown(group: TouchHiddenSettingGroup, touchActive: boolean): boolean {
  return !touchActive || !TOUCH_HIDDEN_SETTING_GROUPS.includes(group);
}
