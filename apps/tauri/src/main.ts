import { createApp } from 'vue';
import App from './App.vue';
import { detectSailThe7Seas } from './game/sailThe7Seas';
import { initCredentials } from './game/credentials';
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
  // Owner 2026-07-04: SailThe7Seas — a "-arrrr" launch (dev mirrors: ?arrrr /
  // VITE_ARRRR=true) enables every gated asset BEFORE the app mounts.
  await detectSailThe7Seas();
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
  createApp(App).mount('#app');
}

void boot();
