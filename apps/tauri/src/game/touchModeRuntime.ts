// Touch mode live state (spec-touch-mode-2026-11-12 section 3). One reactive answer, `touchModeActive`, read by the
// match view (action center, declare gating, quick menu), the renderer (pinch snap) and the settings window.
// The document root carries `data-touch="on"` and `--touch-target` so CSS can size every tap target from one place.
import { computed, reactive, watch } from 'vue';
import { settings } from './settings';
import { setWindowXTouchMode, resyncWindowX } from './cardFocus';
import { setInputControlLayerTouchOverride } from './controlLayerSwitch';
import { readPointerProfile, resolveTouchMode, type MatchMediaLike, type PointerProfile, type TouchModeChoice } from './touchMode';

function liveMatchMedia(): MatchMediaLike | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : null;
}

export const touchPointerProfile = reactive<PointerProfile>(readPointerProfile(liveMatchMedia()));

/** Re-read the profile (a mouse plugged in / unplugged). */
export function refreshTouchPointerProfile(matchMedia: MatchMediaLike | null = liveMatchMedia()): void {
  const next = readPointerProfile(matchMedia);
  touchPointerProfile.primaryCoarse = next.primaryCoarse;
  touchPointerProfile.anyFine = next.anyFine;
}

export const touchModeResolution = computed(() => resolveTouchMode(settings.touchMode, settings.touchModeChoice, touchPointerProfile));
export const touchModeActive = computed(() => touchModeResolution.value.active);
/** The one-time Touch / Mouse question is owed. */
export const touchModeChoiceOwed = computed(() => touchModeResolution.value.ask);

/** The coach answered the one-time question; remembered in settings. */
export function answerTouchModeChoice(choice: Exclude<TouchModeChoice, ''>): void {
  settings.touchModeChoice = choice;
}

let started = false;
/** Wire the media-query listeners and the document-root markers once (App.vue onMounted). */
export function startTouchModeRuntime(): () => void {
  if (started || typeof window === 'undefined') return () => undefined;
  started = true;
  const mm = liveMatchMedia();
  const queries = mm ? ['(pointer: coarse)', '(any-pointer: fine)'].map((q) => { try { return mm(q) as MediaQueryList; } catch { return null; } }) : [];
  const onChange = () => refreshTouchPointerProfile();
  for (const q of queries) q?.addEventListener?.('change', onChange);
  setWindowXTouchMode(() => touchModeActive.value); // the window X's touch-only answers follow the mode
  setInputControlLayerTouchOverride(() => touchModeActive.value); // finding 6: touch input never takes the FUMBBL branches
  const stopWindowX = watch(touchModeActive, () => resyncWindowX());
  const stopRoot = watch([touchModeActive, () => settings.touchButtonSize], ([active, size]) => {
    const root = document.documentElement;
    if (active) root.dataset.touch = 'on'; else delete root.dataset.touch;
    root.style.setProperty('--touch-target', `${size}px`);
  }, { immediate: true });
  return () => {
    for (const q of queries) q?.removeEventListener?.('change', onChange);
    stopRoot();
    stopWindowX();
    setWindowXTouchMode(null);
    setInputControlLayerTouchOverride(null);
    started = false;
  };
}
