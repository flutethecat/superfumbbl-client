import type { AppSettings } from './settings';
import { EDGE_PAN_SPEED, TELESTRATOR_MODES, TURN_CLOCK_WARNINGS, UI_ZOOM } from './settings';

/**
 * Settings reflow lane C (owner 11-03): the rows of the NEW features, as data, for the Settings dialog (lane A) to place
 * in the reflowed tabs. Each row names its settings key, its control, its options and its i18n keys (label + a one-line
 * description, under settings.reflowNew.*). docs/artifact-orchestration/settings-features-rows.md mirrors this list.
 * The behavior behind every key is already live; a row only reads and writes `settings[key]`.
 */

export type FeatureRowControl =
  | { kind: 'toggle' }
  | { kind: 'select'; options: readonly { value: string; labelKey: string }[] }
  | { kind: 'range'; min: number; max: number; step: number; unit: 'px' | '%' };

export interface FeatureRow {
  key: keyof AppSettings;
  /** Mock placement: tab > section. */
  tab: 'controls' | 'ui' | 'audio' | 'accessibility';
  section: string;
  labelKey: string;
  descriptionKey: string;
  control: FeatureRowControl;
  /** Only shown while another setting is on (e.g. the speed under its toggle). */
  dependsOn?: keyof AppSettings;
}

const TELESTRATOR_OPTION_KEYS: Record<(typeof TELESTRATOR_MODES)[number], string> = {
  replays: 'settings.reflowNew.telestrator.optionReplays',
  all: 'settings.reflowNew.telestrator.optionAll',
  off: 'settings.reflowNew.telestrator.optionOff',
};
const TURN_CLOCK_OPTION_KEYS: Record<(typeof TURN_CLOCK_WARNINGS)[number], string> = {
  '2m': 'settings.reflowNew.turnClockWarning.option2m',
  '1m': 'settings.reflowNew.turnClockWarning.option1m',
  '30s': 'settings.reflowNew.turnClockWarning.option30s',
  off: 'settings.reflowNew.turnClockWarning.optionOff',
};

export const SETTINGS_FEATURE_ROWS: readonly FeatureRow[] = [
  { key: 'edgePan', tab: 'controls', section: 'Camera', labelKey: 'settings.reflowNew.edgePan.label', descriptionKey: 'settings.reflowNew.edgePan.description', control: { kind: 'toggle' } },
  { key: 'edgePanSpeed', tab: 'controls', section: 'Camera', labelKey: 'settings.reflowNew.edgePanSpeed.label', descriptionKey: 'settings.reflowNew.edgePanSpeed.description', control: { kind: 'range', min: EDGE_PAN_SPEED.min, max: EDGE_PAN_SPEED.max, step: EDGE_PAN_SPEED.step, unit: 'px' }, dependsOn: 'edgePan' },
  { key: 'telestratorMode', tab: 'ui', section: 'Telestrator', labelKey: 'settings.reflowNew.telestrator.label', descriptionKey: 'settings.reflowNew.telestrator.description', control: { kind: 'select', options: TELESTRATOR_MODES.map((value) => ({ value, labelKey: TELESTRATOR_OPTION_KEYS[value] })) } },
  { key: 'useFantasyCursor', tab: 'ui', section: 'Cursor', labelKey: 'settings.reflowNew.cursor.label', descriptionKey: 'settings.reflowNew.cursor.description', control: { kind: 'toggle' } },
  { key: 'turnClockWarning', tab: 'audio', section: 'Turn clock', labelKey: 'settings.reflowNew.turnClockWarning.label', descriptionKey: 'settings.reflowNew.turnClockWarning.description', control: { kind: 'select', options: TURN_CLOCK_WARNINGS.map((value) => ({ value, labelKey: TURN_CLOCK_OPTION_KEYS[value] })) } },
  { key: 'uiZoom', tab: 'accessibility', section: 'Text and zoom', labelKey: 'settings.reflowNew.uiZoom.label', descriptionKey: 'settings.reflowNew.uiZoom.description', control: { kind: 'range', min: UI_ZOOM.min, max: UI_ZOOM.max, step: UI_ZOOM.step, unit: '%' } },
  { key: 'highContrast', tab: 'accessibility', section: 'Color and contrast', labelKey: 'settings.reflowNew.highContrast.label', descriptionKey: 'settings.reflowNew.highContrast.description', control: { kind: 'toggle' } },
  { key: 'reduceMotion', tab: 'accessibility', section: 'Motion', labelKey: 'settings.reflowNew.reduceMotion.label', descriptionKey: 'settings.reflowNew.reduceMotion.description', control: { kind: 'toggle' } },
  { key: 'reduceFlashing', tab: 'accessibility', section: 'Motion', labelKey: 'settings.reflowNew.reduceFlashing.label', descriptionKey: 'settings.reflowNew.reduceFlashing.description', control: { kind: 'toggle' } },
  { key: 'visualSoundCues', tab: 'accessibility', section: 'Sound cues', labelKey: 'settings.reflowNew.visualSoundCues.label', descriptionKey: 'settings.reflowNew.visualSoundCues.description', control: { kind: 'toggle' } },
  { key: 'largerTargets', tab: 'accessibility', section: 'Input', labelKey: 'settings.reflowNew.largerTargets.label', descriptionKey: 'settings.reflowNew.largerTargets.description', control: { kind: 'toggle' } },
];

/** Extra copy a row may show: the UI zoom row's note when the shell cannot zoom (game/uiZoom.ts uiZoomState.unavailable)
 *  and the Accessibility tab's link row to the turn-clock warning (Audio). */
export const SETTINGS_FEATURE_NOTES = {
  uiZoomUnavailable: 'settings.reflowNew.uiZoom.unavailable',
  turnClockLink: 'settings.reflowNew.turnClockWarning.accessibilityLink',
} as const;
