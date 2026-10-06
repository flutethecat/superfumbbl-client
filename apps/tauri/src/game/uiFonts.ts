import type { AppSettings } from './settings';

/** B2-16/UI11 + B3-8: the user-selectable UI typeface stacks (`settings.uiFont`). App.vue applies the chosen one as
 *  `--ui-font`; the first-launch setup wizard's Font step renders its samples with the same stacks (owner 10-06). */
export const UI_FONTS: Readonly<Record<AppSettings['uiFont'], string>> = {
  nuffle: "'Nuffle', system-ui, sans-serif",
  system: 'system-ui, sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
};
