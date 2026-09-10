<script setup lang="ts">
/** First-open contributions screen (owner 08-27): shown once, after the legal notice is
 *  acknowledged. Order is deliberate and owner-ruled: Christer and the FUMBBL contributors
 *  FIRST, then the Super FUMBBL contributors. Names mirror ATTRIBUTION.md (itself a mirror
 *  of fumbbl.com/p/attribution — re-mirror there first when names change). */
const emit = defineEmits<{ continue: [] }>();

const FUMBBL_DEVELOPERS: ReadonlyArray<{ name: string; role: string }> = [
  { name: 'Christer Kaivo-oja', role: 'FUMBBL site owner and website developer; assistant FFB developer — the upstream this client stands on' },
  { name: 'Mr-Klipp', role: 'Co-developer in the early days of FUMBBL; core site code' },
  { name: 'SkiJunkie', role: 'JavaBBowl developer — the original FUMBBL client' },
  { name: 'Kalimar', role: 'Primary FFB developer, 2013–2017' },
  { name: 'Candlejack', role: 'Primary FFB developer from 2019; Dice Stats module' },
  { name: 'HimalayaP1C7', role: 'Gamefinder 2.0 and Blackbox 2.0 front-ends' },
];

const FUMBBL_ASSET_GROUPS: ReadonlyArray<{ group: string; names: string }> = [
  { group: 'Roster logos', names: 'Mr_Foulscumm · Qaz · Frylen · Garion · ryanfitz' },
  { group: 'Portraits', names: 'Knut_Rockie · ryanfitz · Garion · Marcepan' },
  { group: 'Icons', names: 'Pat · Nick Kelsh · WhatBall · Cowhead · harvestmouse · Balle2000 · MisterFurious · Marcepan · Tussock' },
  { group: 'Sounds', names: 'PurpleChest · bigbullies · Mischa Kissin Tip' },
  { group: 'Pitches & banners', names: 'Garion · Kam · WhatBall · Angelux · ZioCrock · ArrestedDevelopment' },
];

const SUPER_FUMBBL: ReadonlyArray<{ name: string; role: string }> = [
  { name: 'Flutethecat', role: 'Super FUMBBL project lead — client, fork server, and tournament services' },
  { name: 'The Super FUMBBL contributors', role: 'Everyone credited in the project LICENSE and commit history' },
];
</script>

<template>
  <div class="contrib-shell" role="dialog" aria-modal="true" aria-labelledby="first-open-contrib-title">
    <div class="contrib-card">
      <h1 id="first-open-contrib-title">Contributions</h1>
      <p class="contrib-lede">
        Super FUMBBL exists because of the people below. FUMBBL and FFB came first — so do they.
      </p>
      <div class="contrib-scroll">
        <section aria-label="FUMBBL and FFB contributors">
          <h2>FUMBBL &amp; FFB</h2>
          <ul>
            <li v-for="person in FUMBBL_DEVELOPERS" :key="person.name">
              <strong>{{ person.name }}</strong><span>{{ person.role }}</span>
            </li>
          </ul>
          <h3>Community assets</h3>
          <ul>
            <li v-for="entry in FUMBBL_ASSET_GROUPS" :key="entry.group">
              <strong>{{ entry.group }}</strong><span>{{ entry.names }}</span>
            </li>
          </ul>
          <p class="contrib-note">Full asset attribution: fumbbl.com/p/attribution (mirrored in ATTRIBUTION.md).</p>
        </section>
        <section aria-label="Super FUMBBL contributors">
          <h2>Super FUMBBL</h2>
          <ul>
            <li v-for="person in SUPER_FUMBBL" :key="person.name">
              <strong>{{ person.name }}</strong><span>{{ person.role }}</span>
            </li>
          </ul>
        </section>
      </div>
      <div class="contrib-footer">
        <button class="contrib-continue" type="button" @click="emit('continue')">Continue ▸</button>
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
