// Owner 11-03 settings reflow (lane B): the preview images behind the dashed-ring "i" on Settings rows, and the font
// stacks the live example text uses. Images live in public/settings-previews/ with FLAT, globally unique basenames
// (the app patch flattens image names across public/ folders): every file is `settings-preview-<row>-<variant>.webp`.
// They are screenshots of our own client and our own art only (asset-provenance law): no FUMBBL or third-party art.
// Captured on the Codex-original "default-weather" turf (never the installer-only Acasas pitches) and away from the
// coin toss (its skull coin is an upstream FUMBBL image). No preview for Movement animation, Skill display, Action
// decorations or Chat style: the demo game has no still frame that shows those variants apart. D6 style comes from the
// first-launch setup's Dice color step (the real D6Face rows, home and away for the team dice).
import { FONT_DISPLAY_FAMILY } from '../../game/fontStacks';
import type { SettingPreview } from './SettingInfo.vue';

type PreviewSpec = SettingPreview;

const spec = (row: string, variant: string, captionKey: string): PreviewSpec => ({ src: `settings-preview-${row}-${variant}.webp`, captionKey });

/** Row id -> its preview images (in the order the panel shows them). */
export const SETTING_PREVIEW_SPECS = {
  pitchOrientation: [spec('pitch', 'ns', 'settings.info.preview.northSouth'), spec('pitch', 'ew', 'settings.info.preview.eastWest')],
  flatRender: [spec('flat', 'iso', 'settings.info.preview.isometric'), spec('flat', 'flat', 'settings.info.preview.flat')],
  hudStyle: [spec('hud', 'minimalist', 'settings.info.preview.minimalist'), spec('hud', 'chrome', 'settings.info.preview.chrome')],
  logStyle: [spec('log', 'text', 'settings.info.preview.text'), spec('log', 'graphical', 'settings.info.preview.graphical'), spec('log', 'fumbbl', 'settings.info.preview.fumbbl')],
  logDice: [spec('logdice', 'icons', 'settings.info.preview.diceIcons'), spec('logdice', 'numbers', 'settings.info.preview.numbers')],
  logTint: [spec('logtint', 'light', 'settings.info.preview.lightTint'), spec('logtint', 'strong', 'settings.info.preview.strongTint')],
  chatToasts: [spec('toast', 'on', 'settings.info.preview.chatToast')],
  chatToastPos: [spec('toastpos', 'left', 'settings.info.preview.left'), spec('toastpos', 'top', 'settings.info.preview.top')],
  opacity: [spec('opacity', 'low', 'settings.info.preview.opacityLow'), spec('opacity', 'full', 'settings.info.preview.opacityFull')],
  uiStyle: [spec('style', 'modern', 'settings.info.preview.modern'), spec('style', 'retro', 'settings.info.preview.retro')],
  uiColorScheme: [spec('scheme', 'dark', 'settings.info.preview.dark'), spec('scheme', 'light', 'settings.info.preview.light')],
  colorPreset: [spec('preset', 'blackred', 'settings.info.preview.blackRed'), spec('preset', 'fumbbl', 'settings.info.preview.fumbblBlue'), spec('preset', 'custom', 'settings.info.preview.custom')],
  fantasyCursor: [spec('cursor', 'gauntlet', 'settings.info.preview.gauntlet')],
  spriteSet: [spec('sprites', 'superfumbbl', 'settings.info.preview.superFumbbl'), spec('sprites', 'checkers', 'settings.info.preview.checkers'), spec('sprites', 'chess', 'settings.info.preview.chess')],
  turf: [spec('turf', 'grass', 'settings.info.preview.grass'), spec('turf', 'other', 'settings.info.preview.otherTurf')],
  d6Style: [spec('d6', 'black', 'setupWizard.setupSteps.blackDefault'), spec('d6', 'white', 'setupWizard.setupSteps.white'), spec('d6', 'team', 'setupWizard.setupSteps.homeAway')],
} as const satisfies Record<string, readonly PreviewSpec[]>;

export type PreviewRow = keyof typeof SETTING_PREVIEW_SPECS;

/** What SettingInfo takes: each image with its caption key (translated at render). */
export const SETTING_PREVIEWS: Readonly<Record<PreviewRow, readonly SettingPreview[]>> = SETTING_PREVIEW_SPECS;

/** The log's font stacks (the same as the live log and the setup wizard's log preview). */
export const LOG_FONT_STACKS: Readonly<Record<string, string>> = {
  nuffle: FONT_DISPLAY_FAMILY,
  arial: 'Arial, Helvetica, sans-serif',
  mono: 'Consolas, "Courier New", monospace',
};
