import { createApp } from 'vue';
import { configurePixiAssetOrigin } from '@fumbbl40k/ffb-pitch';
import AssetPackBuilderApp from './AssetPackBuilderApp.vue';

async function bootAssetPackBuilder(): Promise<void> {
  configurePixiAssetOrigin();
  try {
    const nuffle = new FontFace('Nuffle', 'url(/fonts/Nuffle.otf)');
    await nuffle.load();
    (document.fonts as unknown as { add(face: FontFace): void }).add(nuffle);
  } catch (error) {
    console.warn('Nuffle font failed to load — asset builder is using system fonts', error);
  }
  createApp(AssetPackBuilderApp).mount('#app');
}

void bootAssetPackBuilder();
