<script setup lang="ts">
// The Field Manual — the ☰ → Help guide. Four pages: console, the six action rails,
// the pre-game show, and deep-links into the settings tabs that matter. Content
// mirrors the published Field Manual tutorial (owner, 2026-08-27).
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { settings } from '../game/settings';
import type { SettingsTab } from '../game/settingsDialog';

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'play-tutorial'): void;
  (e: 'open-settings', tab: SettingsTab): void;
}>();

const PAGES = ['Your console', 'The six rails', 'Showtime', 'Settings'] as const;
const page = ref(0);
const prev = () => { if (page.value > 0) page.value -= 1; };
const next = () => { if (page.value < PAGES.length - 1) page.value += 1; };

// Capture-phase so Esc/arrows never fall through to the SpectateView cascade under an in-game overlay.
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); emit('close'); }
  else if (e.key === 'ArrowLeft') { e.stopImmediatePropagation(); prev(); }
  else if (e.key === 'ArrowRight') { e.stopImmediatePropagation(); next(); }
}
onMounted(() => window.addEventListener('keydown', onKey, { capture: true }));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, { capture: true }));

const RAILS = [
  { n: 'I', name: 'Move', tag: 'left-click', how: 'Left-click your standing player — Move is declared on the spot. Click a square to preview the route (dodge/rush rolls print on the path), click it again to commit. Right-click on grass clears the plan.' },
  { n: 'II', name: 'Block', tag: 'click the target', how: 'Before moving, left-click an adjacent standing enemy: the dice preview appears with Confirm Block on the bar. Click the same enemy again to throw it. Right-click the target for Stab, Chainsaw and the other flavours.' },
  { n: 'III', name: 'Blitz', tag: 'once per turn', how: 'Right-click your player → Blitz, click the enemy you’re gunning for, walk into contact, then confirm the block. Stray clicks ask before they burn the blitz. Prefer a two-click declare? Flip Declare Blitz to Modern in Settings.' },
  { n: 'IV', name: 'Foul', tag: 'menu only', how: 'Right-click → Foul, then click the victim — the 🥾 cue shows the armour target. Distant victim? First click plots the walk, second click boots. One foul per team turn.' },
  { n: 'V', name: 'Pass · Bomb · Throw Team-mate', tag: 'two-click throw', how: 'Declare from the menu and the range template arms itself — hover for the throw 🎯 and catch 🧤 numbers. First click nominates, second click throws. Hand-off to an adjacent team-mate is a single click.' },
  { n: 'VI', name: 'Special actions', tag: 'stars & sorcery', how: 'Star rules ride the same menu as plain rows, exactly when they’re legal. Declare with a special-carrying player and a Special Ability card asks before it’s too late. If the server offers it, we surface it — nothing more.' },
];

const SETTINGS_STOPS: Array<{ tab: SettingsTab; name: string; blurb: string }> = [
  { tab: 'general', name: 'Declare Blitz', blurb: 'FUMBBL (default): blitz from the context menu. Modern: select your player, click a distant enemy, click again to commit the previewed route.' },
  { tab: 'mods', name: 'Mods', blurb: 'Import .f40kmod packs for skill icons, sprites and sounds — or build and export your own (PNG images, OGG/WAV/MP3 sounds).' },
  { tab: 'accessibility', name: 'Accessibility', blurb: 'Minimum text size, colourblind remap, click echoes, pitch grid width and colour, brightness, UI font.' },
];
</script>

<template>
  <div class="fm-backdrop" role="dialog" aria-modal="true" aria-label="Field Manual help guide" @click.self="emit('close')">
    <div class="fm-panel">
      <header class="fm-head">
        <div>
          <p class="fm-kick">Super FUMBBL · Coach's Guide</p>
          <h1>The Field Manual</h1>
        </div>
        <button class="fm-x" type="button" aria-label="Close the Field Manual" @click="emit('close')">✕</button>
      </header>

      <nav class="fm-tabs" aria-label="Manual pages">
        <button v-for="(label, i) in PAGES" :key="label" type="button" :data-active="page === i" @click="page = i">
          {{ label }}
        </button>
      </nav>

      <div class="fm-body">
        <!-- Page 1: the console -->
        <section v-if="page === 0">
          <p class="fm-lede">Everything rides the pitch — one camera, one board, every panel floats over it. Drag them where you like.</p>
          <ul class="fm-list">
            <li><b>Quick bar</b> (bottom corner): settings ⚙, tackle zones, sprite style, skill display, 🏟️ stadium visibility, 🎬 Auto Director, and the 🐞 bug report. Display and camera only — no game actions live there.</li>
            <li><b>Auto Director</b> tracks the ball and the acting player. Toggle it off for a calm camera: pan with <kbd>WASD</kbd> or drag, scroll to zoom.</li>
            <li><b>Log window</b> (bottom right): the play-by-play with the real dice. Tabs flip to Chat and both Rosters.</li>
            <li><b>Click any player</b> — yours or theirs — for their card: stats, skills, SPP.</li>
            <li><b>Follow the action:</b> the gold halo marks the player being activated; the ring under each player is white until they act, then grey. Skill icons ride over heads (or as text markers at the feet) — tune them in Settings → Display → Skill display config.</li>
            <li><b>End Turn lives on the scoreboard</b>, never in a menu. Press it with players still fresh and it asks first. <kbd>Esc</kbd> always walks the same ladder: prompt → preview → menu → activation → selection.</li>
          </ul>
          <button class="fm-cta" type="button" @click="emit('play-tutorial')">▶ Play the guided tour</button>
          <p class="fm-aside">Loads the demo match and walks the HUD with a gold arrow — no connection needed.</p>
        </section>

        <!-- Page 2: the rails -->
        <section v-else-if="page === 1">
          <p class="fm-lede">Every action rides one of six rails. Two gestures carry everything:
            <b>left-click acts, right-click asks.</b> The action menu shows only what's legal right now —
            nothing is greyed out, it's present or absent.</p>
          <div class="fm-rails">
            <article v-for="r in RAILS" :key="r.name" class="fm-rail">
              <div class="fm-rail-head">
                <span class="fm-rail-no">{{ r.n }}</span>
                <h2>{{ r.name }}</h2>
                <span class="fm-tag">{{ r.tag }}</span>
              </div>
              <p>{{ r.how }}</p>
            </article>
          </div>
        </section>

        <!-- Page 3: showtime -->
        <section v-else-if="page === 2">
          <p class="fm-lede">Nuffle demands theatre. Fan factor, weather, the coin toss and inducements each get
            their beat before the boot hits the ball — and the big moments land as centre-pitch banners
            (yes, the Halfling Master Chef announces his thefts in gold).</p>
          <ul class="fm-list">
            <li><b>Watch anything, live:</b> pick <b>FUMBBL</b> or <b>Super FUMBBL</b> in the header, open <b>Spectate</b>, and double-click a match — or type a game id. Live spectating wants your FUMBBL login (Settings → General).</li>
            <li><b>Splashes are skippable</b> — click through them, or make them wait for your click in Settings → General.</li>
            <li><b>Replays:</b> the Replay blade (or ☰ → Load Replay File) plays any saved match through the same presentation.</li>
          </ul>
        </section>

        <!-- Page 4: settings deep links -->
        <section v-else>
          <p class="fm-lede">Six settings pages; changes preview live, <em>Cancel</em> rolls back, <em>OK</em> keeps.
            Three stops worth the visit:</p>
          <div class="fm-stops">
            <article v-for="s in SETTINGS_STOPS" :key="s.tab" class="fm-stop">
              <div>
                <h2>{{ s.name }}</h2>
                <p>{{ s.blurb }}</p>
              </div>
              <button type="button" @click="emit('open-settings', s.tab)">Open ▸</button>
            </article>
          </div>
        </section>
      </div>

      <footer class="fm-foot">
        <label class="fm-dontshow">
          <input v-model="settings.hideTutorialSplash" type="checkbox" />
          <span>Don't show this on launch</span>
        </label>
        <div class="fm-pager">
          <button type="button" :disabled="page === 0" @click="prev">◂ Back</button>
          <span class="fm-page-ind">{{ page + 1 }} / {{ PAGES.length }}</span>
          <button v-if="page < PAGES.length - 1" type="button" class="fm-next" @click="next">Next ▸</button>
          <button v-else type="button" class="fm-next" @click="emit('close')">Play your game! ▸</button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.fm-backdrop {
  position: fixed; inset: 0; z-index: 4000; display: flex; align-items: center; justify-content: center;
  background: rgba(6, 4, 4, 0.78); backdrop-filter: blur(2px); padding: 2vh 12px;
}
.fm-panel {
  width: min(760px, 96vw); max-height: 94vh; display: flex; flex-direction: column;
  background: #151011; border: 1px solid #3a2626; border-top: 3px solid #790004; border-radius: 8px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.7); color: #e9e1d2;
}
.fm-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 1rem 1.3rem 0.4rem; }
.fm-kick {
  margin: 0; font-family: 'Nuffle', system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.18em;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: #d9b356;
}
.fm-head h1 {
  margin: 0.1rem 0 0; font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.55rem); color: #e9e1d2; line-height: 1.05;
}
.fm-x {
  background: none; border: 1px solid #3a2626; border-radius: 5px; color: #b3a993;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); padding: 0.2rem 0.55rem; cursor: pointer;
}
.fm-x:hover { color: #e9e1d2; border-color: #9e1b1b; }
.fm-tabs { display: flex; gap: 0.35rem; padding: 0.55rem 1.3rem 0; border-bottom: 1px solid #3a2626; flex-wrap: wrap; }
.fm-tabs button {
  background: none; border: none; border-bottom: 3px solid transparent; cursor: pointer;
  font-family: 'Nuffle', system-ui, sans-serif; letter-spacing: 0.06em; text-transform: uppercase;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); color: #b3a993; padding: 0.35rem 0.6rem 0.5rem;
}
.fm-tabs button[data-active='true'] { color: #e9e1d2; border-bottom-color: #9e1b1b; }
.fm-tabs button:hover { color: #e9e1d2; }
.fm-body { overflow-y: auto; padding: 1rem 1.3rem 0.4rem; }
.fm-lede { margin: 0 0 0.8rem; color: #cdc4b1; font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); line-height: 1.55; }
.fm-lede b, .fm-list b { color: #d9b356; }
.fm-list { margin: 0.2rem 0 0.8rem; padding-left: 1.15rem; }
.fm-list li { margin: 0.42rem 0; font-size: max(var(--ui-min-primary-text-size, 16px), 0.92rem); line-height: 1.5; }
kbd {
  font-family: ui-monospace, Consolas, monospace; font-size: max(var(--ui-min-text-size, 12px), 0.85em); background: #1f1717;
  border: 1px solid #3a2626; border-bottom-width: 2px; border-radius: 4px; padding: 0.05em 0.35em;
}
.fm-cta {
  margin-top: 0.4rem; background: #2f6b3e; border: 1px solid #4a8a58; color: #eafbea; border-radius: 6px;
  font-family: 'Nuffle', system-ui, sans-serif; letter-spacing: 0.05em;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); padding: 0.55rem 1.2rem; cursor: pointer;
}
.fm-cta:hover { background: #3a8350; }
.fm-aside { margin: 0.35rem 0 0.6rem; color: #b3a993; font-size: max(var(--ui-min-text-size, 12px), 0.82rem); }
.fm-rails { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 0.8rem; }
.fm-rail { background: #1b1414; border: 1px solid #3a2626; border-left: 4px solid #790004; border-radius: 6px; padding: 0.6rem 0.9rem; }
.fm-rail-head { display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; }
.fm-rail-no { font-family: 'Nuffle', system-ui, sans-serif; color: #9e1b1b; font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem); }
.fm-rail-head h2 {
  margin: 0; font-family: 'Nuffle', system-ui, sans-serif; letter-spacing: 0.04em;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.98rem); color: #e9e1d2;
}
.fm-tag {
  font-family: 'Nuffle', system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.12em;
  font-size: max(var(--ui-min-text-size, 12px), 0.66rem); color: #d9b356;
  border: 1px solid rgba(217, 179, 86, 0.45); border-radius: 3px; padding: 0.08rem 0.45rem;
}
.fm-rail p { margin: 0.4rem 0 0.1rem; color: #cdc4b1; font-size: max(var(--ui-min-primary-text-size, 16px), 0.88rem); line-height: 1.5; }
.fm-stops { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 0.8rem; }
.fm-stop {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  background: #1b1414; border: 1px solid #3a2626; border-radius: 6px; padding: 0.65rem 0.9rem;
}
.fm-stop h2 { margin: 0 0 0.2rem; font-family: 'Nuffle', system-ui, sans-serif; font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); color: #d9b356; }
.fm-stop p { margin: 0; color: #cdc4b1; font-size: max(var(--ui-min-primary-text-size, 16px), 0.86rem); line-height: 1.45; }
.fm-stop > button {
  flex: 0 0 auto; background: #790004; border: 1px solid #9e1b1b; color: #ffe9e9; border-radius: 5px;
  font-family: 'Nuffle', system-ui, sans-serif; letter-spacing: 0.05em;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); padding: 0.45rem 0.9rem; cursor: pointer;
}
.fm-stop > button:hover { background: #9e1b1b; }
.fm-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
  border-top: 1px solid #3a2626; padding: 0.7rem 1.3rem 0.9rem;
}
.fm-dontshow { display: flex; align-items: center; gap: 0.45rem; color: #b3a993; font-size: max(var(--ui-min-text-size, 12px), 0.82rem); cursor: pointer; }
.fm-pager { display: flex; align-items: center; gap: 0.6rem; }
.fm-pager button {
  background: #1f1717; border: 1px solid #3a2626; color: #e9e1d2; border-radius: 5px; cursor: pointer;
  font-family: 'Nuffle', system-ui, sans-serif; letter-spacing: 0.05em;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); padding: 0.45rem 0.9rem;
}
.fm-pager button:disabled { opacity: 0.4; cursor: default; }
.fm-pager button.fm-next { background: #790004; border-color: #9e1b1b; color: #ffe9e9; }
.fm-pager button.fm-next:hover { background: #9e1b1b; }
.fm-page-ind { font-family: 'Nuffle', system-ui, sans-serif; color: #b3a993; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); }
</style>
