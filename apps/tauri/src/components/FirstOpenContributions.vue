<script setup lang="ts">
import { $t } from '../i18n';
import { t } from '../i18n';
/** First-open contributions screen (owner 08-27): shown once, after the legal notice is
 *  acknowledged. Order is deliberate and owner-ruled: Christer and the FUMBBL contributors
 *  FIRST, then the Super FUMBBL contributors. Names mirror ATTRIBUTION.md (itself a mirror
 *  of fumbbl.com/p/attribution — re-mirror there first when names change). */
const emit = defineEmits<{ continue: [] }>();

const FUMBBL_DEVELOPERS: ReadonlyArray<{ name: string; role: string }> = [
  { name: 'Christer Kaivo-oja', get role() { return t('contributions.fumbblDevelopers.fumbblSiteOwnerAnd'); } },
  { name: 'Mr-Klipp', get role() { return t('contributions.fumbblDevelopers.coDeveloperInThe'); } },
  { name: 'SkiJunkie', get role() { return t('contributions.fumbblDevelopers.javabbowlDeveloperTheOriginal'); } },
  { name: 'Kalimar', get role() { return t('contributions.fumbblDevelopers.primaryFfbDeveloper2013'); } },
  { name: 'Candlejack', get role() { return t('contributions.fumbblDevelopers.primaryFfbDeveloperFrom'); } },
  { name: 'HimalayaP1C7', get role() { return t('contributions.fumbblDevelopers.gamefinder20And'); } },
];

const FUMBBL_ASSET_GROUPS: ReadonlyArray<{ group: string; names: string }> = [
  { get group() { return t('contributions.group.rosterLogos'); }, names: 'Mr_Foulscumm · Qaz · Frylen · Garion · ryanfitz' },
  { get group() { return t('contributions.group.portraits'); }, names: 'Knut_Rockie · ryanfitz · Garion · Marcepan' },
  { get group() { return t('contributions.group.icons'); }, names: 'Pat · Nick Kelsh · WhatBall · Cowhead · harvestmouse · Balle2000 · MisterFurious · Marcepan · Tussock' },
  { get group() { return t('contributions.group.sounds'); }, names: 'PurpleChest · bigbullies · Mischa Kissin Tip' },
  { get group() { return t('contributions.group.pitchesBanners'); }, names: 'Garion · Kam · WhatBall · Angelux · ZioCrock · ArrestedDevelopment' },
];

const SUPER_FUMBBL: ReadonlyArray<{ name: string; role: string }> = [
  { name: 'Flutethecat', get role() { return t('contributions.superFumbbl.superFumbblProjectLead'); } },
  { name: 'Kristofer Bengtsson (KrisB)', get role() { return t('contributions.superFumbbl.blockDiceFaceArt'); } },
  { name: 'WhatBall', get role() { return t('contributions.superFumbbl.fumbblBlockDice'); } }, // owner 11-04
  { name: 'Eduardo Tunni', get role() { return t('contributions.superFumbbl.graduateTypefaceMenuAnd'); } },
  { get name() { return t('contributions.group.superFumbblContributors'); }, get role() { return t('contributions.superFumbbl.everyoneCreditedInThe'); } },
];
</script>

<template>
  <div class="contrib-shell" role="dialog" aria-modal="true" aria-labelledby="first-open-contrib-title">
    <div class="contrib-card">
      <h1 id="first-open-contrib-title">{{ $t('contributions.contribCard.contributions') }}</h1>
      <p class="contrib-lede">
        {{ $t('contributions.contribCard.superFumbblExistsBecause') }}
      </p>
      <div class="contrib-scroll">
        <section :aria-label="$t('contributions.contribCard.fumbblAndFfbContributors')">
          <h2>{{ $t('contributions.contribCard.fumbblFfb') }}</h2>
          <ul>
            <li v-for="person in FUMBBL_DEVELOPERS" :key="person.name">
              <strong>{{ person.name }}</strong><span>{{ person.role }}</span>
            </li>
          </ul>
          <h3>{{ $t('contributions.contribCard.communityAssets') }}</h3>
          <ul>
            <li v-for="entry in FUMBBL_ASSET_GROUPS" :key="entry.group">
              <strong>{{ entry.group }}</strong><span>{{ entry.names }}</span>
            </li>
          </ul>
          <p class="contrib-note">{{ $t('contributions.contribCard.fullAssetAttributionFumbbl') }}</p>
        </section>
        <section :aria-label="$t('contributions.contribCard.superFumbblContributors')">
          <h2>{{ $t('contributions.contribCard.superFumbbl') }}</h2>
          <ul>
            <li v-for="person in SUPER_FUMBBL" :key="person.name">
              <strong>{{ person.name }}</strong><span>{{ person.role }}</span>
            </li>
          </ul>
        </section>
        <!-- Owner 10-23: translation credits. -->
        <section :aria-label="$t('contributions.translations.aria')" data-testid="contrib-translations">
          <h2>{{ $t('contributions.translations.title') }}</h2>
          <ul>
            <li><strong>GHY</strong><span>{{ $t('contributions.translations.zhHansContributor') }}</span></li>
            <li><strong>BSData</strong><span>{{ $t('contributions.translations.bsdata') }}</span></li>
          </ul>
        </section>
      </div>
      <div class="contrib-footer">
        <button class="contrib-continue" type="button" @click="emit('continue')">{{ $t('contributions.contribCard.continue') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.contrib-shell {
  position: fixed;
  inset: 0;
  z-index: 12500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--ui-secondary, #000);
}
.contrib-card {
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  max-height: calc(100vh - 48px);
  padding: 22px 26px;
  color: var(--ui-text);
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 8px;
}
.contrib-card h1 {
  margin: 0 0 4px;
  color: var(--ui-heading);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.5rem);
  letter-spacing: 0.06em;
}
.contrib-lede { margin: 0 0 12px; color: var(--ui-muted); font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); }
.contrib-scroll { overflow-y: auto; padding-right: 8px; }
.contrib-card h2 {
  margin: 14px 0 6px;
  color: var(--ui-eggshell, var(--ui-text));
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem);
  letter-spacing: 0.05em;
}
.contrib-card h3 { margin: 10px 0 4px; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 0.85rem); letter-spacing: 0.05em; text-transform: uppercase; }
.contrib-card ul { margin: 0; padding: 0; list-style: none; }
.contrib-card li { display: flex; flex-direction: column; padding: 5px 0; border-bottom: 1px solid color-mix(in srgb, var(--ui-border) 40%, transparent); }
.contrib-card li strong { font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); }
.contrib-card li span { color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 0.85rem); }
.contrib-note { margin: 8px 0 0; color: var(--ui-text-dim); font-size: max(var(--ui-min-text-size, 12px), 0.8rem); }
.contrib-footer { display: flex; justify-content: flex-end; padding-top: 14px; }
.contrib-continue {
  padding: 9px 22px;
  color: var(--ui-text-on-primary);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  letter-spacing: 0.05em;
  background: var(--ui-primary);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  cursor: pointer;
}
.contrib-continue:hover { background: var(--ui-active); }
</style>
