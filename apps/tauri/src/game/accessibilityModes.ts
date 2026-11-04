import { watch, watchEffect } from 'vue';
import { settings, type SettingsReflowFeatures } from './settings';
import { applyUiZoom } from './uiZoom';

/**
 * Settings reflow (owner 11-03): Settings > Accessibility modes. Each mode is one class on <html>; the rules live in
 * src/styles/accessibilityModes.css (imported once by main.ts). The JS-timed presentation reads motionReduced() /
 * flashingReduced() below (the dice tumble, the MVP roulette, the card nudge). UI zoom applies through game/uiZoom.ts.
 * Presentation only: no mode changes what is sent, when a server dialog is answered or any server-paced timing.
 */

export const ACCESSIBILITY_MODE_CLASSES = {
  highContrast: 'sf-high-contrast',
  reduceMotion: 'sf-reduce-motion',
  reduceFlashing: 'sf-reduce-flashing',
  largerTargets: 'sf-larger-targets',
} as const satisfies Partial<Record<keyof SettingsReflowFeatures, string>>;

type ModeFlags = Pick<SettingsReflowFeatures, keyof typeof ACCESSIBILITY_MODE_CLASSES>;

/** The <html> classes for these settings. */
export function accessibilityModeClasses(flags: ModeFlags): string[] {
  return (Object.keys(ACCESSIBILITY_MODE_CLASSES) as (keyof typeof ACCESSIBILITY_MODE_CLASSES)[])
    .filter((key) => flags[key] === true)
    .map((key) => ACCESSIBILITY_MODE_CLASSES[key]);
}

export function applyAccessibilityModeClasses(root: { classList: DOMTokenList }, flags: ModeFlags): void {
  const on = new Set(accessibilityModeClasses(flags));
  for (const cls of Object.values(ACCESSIBILITY_MODE_CLASSES)) root.classList.toggle(cls, on.has(cls));
}

/** The OS asks for reduced motion (prefers-reduced-motion). */
export function osPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Decorative motion is off: Settings > Accessibility "Reduce motion", or the OS preference (honoured as before). */
export function motionReduced(flags: Pick<SettingsReflowFeatures, 'reduceMotion'> = settings, os = osPrefersReducedMotion()): boolean {
  return flags.reduceMotion === true || os;
}

/** Strobing / rapid flashing is off ("Reduce flashing"). */
export function flashingReduced(flags: Pick<SettingsReflowFeatures, 'reduceFlashing'> = settings): boolean {
  return flags.reduceFlashing === true;
}

/** main.ts: keep the <html> classes and the webview zoom in step with the settings for the whole session. */
export function installAccessibilityModes(): () => void {
  const stopClasses = watchEffect(() => {
    if (typeof document === 'undefined') return;
    applyAccessibilityModeClasses(document.documentElement, settings);
  });
  const stopZoom = watch(() => settings.uiZoom, (percent) => { void applyUiZoom(percent); }, { immediate: true });
  return () => { stopClasses(); stopZoom(); };
}
