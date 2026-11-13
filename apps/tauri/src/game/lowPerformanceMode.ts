import type { AppSettings } from './settings';

/**
 * Owner 11-12: Low performance mode. One switch for a weak machine (e.g. a Chromebook running the Linux build with no
 * GPU, where the CPU draws everything) that sets the existing video options together.
 *
 * Pure logic, no Vue: it reads and writes a settings object handed to it.
 *  - enable: remember the coach's current values of the preset keys, write the low values, set the flag. Enabling
 *    while already on keeps the first snapshot (the coach's real choices), never the low values.
 *  - disable: put back each remembered value ONLY where the setting still holds the preset's low value, so a change the
 *    coach made while the mode was on wins. Then forget the snapshot and clear the flag.
 *  - While on, the coach may change any single setting; that does not switch the mode off.
 * Never auto-enabled; no detection here.
 */

/** The renderScale choices Settings offers (0 = Auto). Shared with the settings load-merge. */
export const RENDER_SCALE_CHOICES: readonly number[] = [0, 0.5, 0.75, 1, 1.5, 2, 3, 4];
/** The numeric FPS caps Settings offers ('display' is the only other value). Shared with the settings load-merge. */
export const FPS_CAP_CHOICES: readonly number[] = [30, 60, 120];

export const LOW_PERFORMANCE_PRESET = {
  // 50%: measured 11-12 with the GPU off (CPU rendering, 1920x1080): defaults 8.8 fps, this preset at 75% 20 fps,
  // at 50% 29 fps (the 30 cap). 50% alone with the effects left on reached 18 fps.
  renderScale: 0.5,
  fpsCap: 30,
  flatRender: true,
  showStadium: false,
  castShadows: false,
  walkAnimation: false,
  bloodSplatters: false,
  blockDice3d: false,
  reduceMotion: true,
} as const satisfies Partial<AppSettings>;

export type LowPerformanceKey = keyof typeof LOW_PERFORMANCE_PRESET;
export const LOW_PERFORMANCE_KEYS = Object.keys(LOW_PERFORMANCE_PRESET) as LowPerformanceKey[];
export type LowPerformanceRestore = Partial<Pick<AppSettings, LowPerformanceKey>>;

type LowPerformanceSettings = Pick<AppSettings, LowPerformanceKey | 'lowPerformanceMode' | 'lowPerformanceRestore'>;

const isBool = (value: unknown): value is boolean => typeof value === 'boolean';

/** Per-key validators: the same rules the settings load-merge applies to the live values. */
const VALID: Record<LowPerformanceKey, (value: unknown) => boolean> = {
  renderScale: (value) => typeof value === 'number' && Number.isFinite(value) && RENDER_SCALE_CHOICES.includes(value),
  fpsCap: (value) => value === 'display' || (typeof value === 'number' && Number.isFinite(value) && FPS_CAP_CHOICES.includes(value)),
  flatRender: isBool,
  showStadium: isBool,
  castShadows: isBool,
  walkAnimation: isBool,
  bloodSplatters: isBool,
  blockDice3d: isBool,
  reduceMotion: isBool,
};

/** Load-merge validation of the stored snapshot: only known keys with valid values survive; anything else = null. */
export function normalizeLowPerformanceRestore(value: unknown): LowPerformanceRestore | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of LOW_PERFORMANCE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key) && VALID[key](raw[key])) out[key] = raw[key];
  }
  return Object.keys(out).length ? out as LowPerformanceRestore : null;
}

export function enableLowPerformanceMode(settings: LowPerformanceSettings): void {
  // Already on: a no-op. The first snapshot holds the coach's real choices, and later manual changes stay.
  if (settings.lowPerformanceMode) return;
  const snapshot: Record<string, unknown> = {};
  for (const key of LOW_PERFORMANCE_KEYS) snapshot[key] = settings[key];
  // Through the same validation as a stored snapshot: a bad live value (a corrupt file loaded this session) is not
  // remembered, so turning the mode off can never write it back.
  settings.lowPerformanceRestore = normalizeLowPerformanceRestore(snapshot);
  Object.assign(settings, LOW_PERFORMANCE_PRESET);
  settings.lowPerformanceMode = true;
}

export function disableLowPerformanceMode(settings: LowPerformanceSettings): void {
  const snapshot = settings.lowPerformanceRestore;
  if (snapshot) {
    const target = settings as Record<LowPerformanceKey, unknown>;
    for (const key of LOW_PERFORMANCE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(snapshot, key)) continue;
      if (target[key] === LOW_PERFORMANCE_PRESET[key]) target[key] = snapshot[key];
    }
  }
  settings.lowPerformanceRestore = null;
  settings.lowPerformanceMode = false;
}

export function setLowPerformanceMode(settings: LowPerformanceSettings, on: boolean): void {
  if (on) enableLowPerformanceMode(settings);
  else disableLowPerformanceMode(settings);
}
