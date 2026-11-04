import { createApp, watch } from 'vue';
import { configurePixiAssetOrigin } from '@fumbbl40k/ffb-pitch';
import App from './App.vue';
// Owner 11-03: the Modern style's tokens and controls; every rule is scoped under .sf-lm (opt-in per blade).
import './styles/lm-theme.css';
// Owner 11-03 (lane 3): the Modern Play / Spectate / Replay blades and top bar, also scoped under .sf-lm.
import './styles/lm-blades.css';
import { initCredentials } from './game/credentials';
import { installFocusClickGuard } from './game/focusClickGuard';
import { installFontStackVariables } from './game/fontStacks';
import { setLocale } from './i18n';
import { installPitchLabels } from './game/pitchLabels';
import { installAccessibilityModes } from './game/accessibilityModes';
import { installVisualSoundCues } from './game/visualSoundCues';
import './styles/accessibilityModes.css';
import { initSettingsFile, settings } from './game/settings';
import {
  assetMods,
  initializeAssetPresentationAtBoot,
} from './game/assetMods';

/**
 * Nuffle display font (owner 2026-07-02, B2-16/UI11): loaded BEFORE mount so
 * both the DOM UI and Pixi canvas text (TOUCHDOWN, HUD-adjacent labels) pick
 * it up on first render. The Settings pane opts back out to Arial/Helvetica.
 */
async function boot() {
  // Script support (owner 10-23): publish the font stacks (--font-display etc.) before anything renders.
  installFontStackVariables();
  // Bundled Pixi textures resolve against the page origin on every platform (macOS/Linux run
  // at tauri://localhost, where Pixi's default root derivation breaks). Must precede any load.
  configurePixiAssetOrigin();
  // Owner 09-10: the SailThe7Seas "-arrrr" gate and the rules-text skill descriptions it unlocked are REMOVED.
  // Adopt the settings FILE (owner 08-19: durable store off WebView2 localStorage) BEFORE
  // credentials, so a recovery-file password is captured for the keychain migration below.
  await initSettingsFile();
  // Resolve and decode the complete durable capability set before Vue/Pixi mounts. The legacy
  // sound migration runs only after the installed skill/sprite identities (including a null
  // BB2/BB3 style sentinel) have resolved, so its final settings write cannot clear them.
  try {
    const result = await initializeAssetPresentationAtBoot(settings);
    if (result.soundMigration === 'retained') {
      console.warn('Custom sound migration was retained for a later retry');
    }
  } catch (error) {
    // A transient native registry read is not proof that an installed identity disappeared. Keep
    // the durable request and embedded sound overrides for a later launch.
    assetMods.error = 'Installed asset packs could not be read at startup. The saved selection was retained for the next launch.';
    console.warn('Asset-pack startup activation was deferred', error);
  }
  // Pull the fork password out of the OS credential store (migrating any legacy clear-text copy)
  // BEFORE mount, so the sync resolveJoinCreds seam can never resolve an empty password.
  await initCredentials();
  try {
    const nuffle = new FontFace('Nuffle', 'url(/fonts/Nuffle.otf)');
    await nuffle.load();
    // FontFaceSet.add is missing from this TS DOM lib version
    (document.fonts as unknown as { add(face: FontFace): void }).add(nuffle);
  } catch (error) {
    console.warn('Nuffle font failed to load — falling back to system fonts', error);
  }
  // Owner 10-11 ("Graduate C"): Graduate (Eduardo Tunni, SIL OFL 1.1; licence beside it as OFL-Graduate.txt) letters
  // the Game Menu, the end zones and the dugout labels after each word's Nuffle lead letter. It is REGISTERED and its
  // load STARTED here, never awaited: a slow or stalled font request must not hold the app back (no new waits).
  // Until it arrives the lettering shows in the fallback of its font stack (Nuffle): the menu swaps to Graduate by
  // itself (display: swap), and the pitch renderer redraws its lettering once when the face reports loaded.
  try {
    const graduate = new FontFace('Graduate', 'url(/fonts/Graduate-Regular.ttf)', { display: 'swap' });
    (document.fonts as unknown as { add(face: FontFace): void }).add(graduate);
    void graduate.load().catch((error: unknown) => {
      console.warn('Graduate font failed to load, menu and pitch lettering fall back to Nuffle', error);
    });
  } catch (error) {
    console.warn('Graduate font could not be registered, menu and pitch lettering fall back to Nuffle', error);
  }
  // Owner 2026-07-11: SNES Italic — the exact "Super FUMBBL" wordmark face (629Fonts, free,
  // https://famfonts.com/super-nintendo/). Bundled so the brand lockup can render live/at any size.
  try {
    const add = (document.fonts as unknown as { add(face: FontFace): void }).add;
    const snes = new FontFace('SNES', 'url(/fonts/SNES-Italic.ttf)', { style: 'italic' });
    await snes.load();
    add.call(document.fonts, snes);
  } catch (error) {
    console.warn('SNES font failed to load — brand text falls back to Nuffle', error);
  }
  // Owner 10-05: the click that brings an unfocused window back is not an order - it is dropped; the next one counts.
  installFocusClickGuard();
  // Owner 10-23: the client language follows settings.language live (no restart).
  watch(() => settings.language, (locale) => setLocale(locale), { immediate: true });
  // The canvas's drawn words follow the language too. Never allowed to block boot (an English pitch is the fallback).
  try { installPitchLabels(); } catch (error) { console.warn('Pitch labels stay English: the label provider could not be installed', error); }
  // Settings reflow (11-03): Accessibility modes (<html> classes), UI zoom and visual sound cues follow the settings live.
  try { installAccessibilityModes(); } catch (error) { console.warn('Accessibility modes could not be installed', error); }
  try { installVisualSoundCues(); } catch (error) { console.warn('Visual sound cues could not be installed', error); }
  // Components import $t from src/i18n themselves (i18nPlugin also exists for templates that do not).
  createApp(App).mount('#app');
}

void boot();
