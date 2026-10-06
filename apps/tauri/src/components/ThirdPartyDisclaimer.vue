<script setup lang="ts">
/**
 * Owner 2026-10-06: the third-party client disclaimer - the LAST thing of the first-run flow, shown at the end of the
 * client walkthrough (components/ClientTour.vue; it used to end the FUMBBL.COM site walkthrough). Copy from
 * docs/artifact-orchestration/spec-home-pane-tour.md with the owner's 10-06 changes (split paragraph, Twitch player
 * card, Support FUMBBL button, three acknowledgements). Design language of FirstOpenContributions. Public-edition code:
 * the Support FUMBBL button image (FUMBBL's own, assets/resources/support-fumbbl.png) is owner-cleared to ship (10-06).
 */
import { computed, ref } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import QuickBarButton from './QuickBarButton.vue';
import supportFumbblImage from '../assets/resources/support-fumbbl.png';
import { FUMBBL_DONATE_URL, TWITCH_CHANNEL_URL } from '../game/clientTour';

const props = defineProps<{ twitchUrl?: string }>();
const emit = defineEmits<{ play: []; back: [] }>();

/** All three must be ticked before "Let's play". */
const acks = ref([false, false, false]);
const allAcknowledged = computed(() => acks.value.every(Boolean));
const ACKS = [
  "I acknowledge that Christer and the FUMBBL team cannot help me. I'm using this at my own risk",
  "I acknowledge that using this client means I won't get support from the FUMBBL development team if something bad happens in most cases.",
  "I acknowledge that if I have any bugs, I'll use the in-game bug report feature.",
] as const;

const channelUrl = computed(() => props.twitchUrl || TWITCH_CHANNEL_URL);

/** System browser (Tauri opener), window.open outside Tauri. */
async function openExternal(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}
</script>

<template>
  <div class="tour-disclaimer-shell" role="dialog" aria-modal="true" aria-labelledby="home-tour-disclaimer-title">
    <div class="tour-disclaimer-card">
      <h1 id="home-tour-disclaimer-title">This is a third-party client!</h1>
      <div class="tour-disclaimer-scroll">
        <p>
          I wrote this client for the community. If you want to support me, you should come watch me on my
          <a :href="channelUrl" @click.prevent="openExternal(channelUrl)">Twitch channel</a>, and be part of my community.
        </p>
        <!-- Owner 10-06: a LINK card, no player - Twitch refuses to be embedded in the installed client ("refused to
             connect"). The whole card and its button open the channel in the system browser. -->
        <div class="tour-twitch" data-testid="tour-twitch" role="link" tabindex="0" :aria-label="`Open ${channelUrl} in your browser`"
          @click="openExternal(channelUrl)" @keydown.enter.prevent="openExternal(channelUrl)" @keydown.space.prevent="openExternal(channelUrl)">
          <span class="tour-twitch-glyph" aria-hidden="true">▶</span>
          <span class="tour-twitch-text">
            <span class="tour-twitch-name">twitch.tv/flutethecat</span>
            <span class="tour-twitch-line">Live streams, replays and community</span>
          </span>
          <button type="button" class="tour-twitch-open" @click.stop="openExternal(channelUrl)">Watch on Twitch ▸</button>
        </div>
        <!-- Owner 10-06: the donation line, the Support FUMBBL button on its own line, then a normal paragraph. -->
        <p class="tour-donate-line">If you want to donate money, go do it to the FUMBBL community.</p>
        <a class="tour-support-fumbbl" :href="FUMBBL_DONATE_URL" @click.prevent="openExternal(FUMBBL_DONATE_URL)"><img
          :src="supportFumbblImage" width="190" height="59" alt="Support FUMBBL — make a donation" /></a>
        <p>
          This is a completely noncommercial product and meant to brighten the community. All of the assets created
          (mostly with AI) are free to use to the community for any project related to FUMBBL and are licensed under the
          MFML license.
        </p>
        <p>
          Know that you're using this client at your own risk so if you're losing a match because of a bug then -- while
          I'm really sorry about it! -- Christer and the FUMBBL team cannot help you. Instead, please use the report
          button <span class="config-bar tour-report-sample" aria-hidden="true"><QuickBarButton class="report-btn" tabindex="-1"><span class="report-bug">🐞</span><span class="report-label">REPORT</span></QuickBarButton></span> in
          the match and send me reports when bad things happen. You can also reach me on Discord at flutethecat and I'll
          try to get it resolved as quickly as possible.
        </p>
      </div>
      <div class="tour-disclaimer-acks">
        <label v-for="(text, i) in ACKS" :key="i" class="tour-disclaimer-ack">
          <input v-model="acks[i]" type="checkbox" />
          <span>{{ text }}</span>
        </label>
      </div>
      <div class="tour-disclaimer-footer">
        <button class="tour-disclaimer-back" type="button" @click="emit('back')">◂ Back</button>
        <button class="tour-disclaimer-play" type="button" :disabled="!allAcknowledged" @click="emit('play')">Let's play</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tour-disclaimer-shell {
  position: fixed;
  inset: 0;
  z-index: 12500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, var(--ui-secondary, #000) 88%, transparent);
}
.tour-disclaimer-card {
  display: flex;
  flex-direction: column;
  width: min(760px, 100%);
  max-height: calc(100vh - 48px);
  padding: 22px 26px;
  color: var(--ui-text);
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 8px;
}
.tour-disclaimer-card h1 {
  margin: 0 0 10px;
  color: var(--ui-heading);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.5rem);
  letter-spacing: 0.06em;
}
.tour-disclaimer-scroll { overflow-y: auto; padding-right: 8px; }
.tour-disclaimer-scroll p { margin: 0 0 12px; font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); line-height: 1.6; }
.tour-disclaimer-scroll a { color: var(--ui-accent); }

/* Twitch link card (Twitch purple): the whole card and its button open the channel in the system browser. */
.tour-twitch {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 0 0 14px;
  padding: 14px 16px;
  color: #fff;
  background: linear-gradient(135deg, #9146ff, #5c16c5);
  border: 1px solid #a970ff;
  border-radius: 8px;
  box-shadow: 0 0 0 1px #00000066, 0 8px 24px #9146ff44;
  cursor: pointer;
}
.tour-twitch:hover { filter: brightness(1.08); }
.tour-twitch:focus-visible { outline: 3px solid #f3d36a; outline-offset: 2px; }
.tour-twitch-glyph { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 44px; height: 44px; font-size: 20px; color: #9146ff; background: #fff; border-radius: 50%; }
.tour-twitch-text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.tour-twitch-name { font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem); font-weight: 700; letter-spacing: 0.03em; }
.tour-twitch-line { color: #e9dcff; font-size: max(var(--ui-min-text-size, 12px), 0.9rem); }
.tour-twitch-open {
  flex: none;
  padding: 7px 16px;
  color: #5c16c5;
  font-size: max(var(--ui-min-text-size, 12px), 0.95rem);
  font-weight: 700;
  letter-spacing: 0.04em;
  background: #fff;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.tour-twitch-open:hover { background: #f1e8ff; }

.tour-donate-line { margin-bottom: 6px !important; }
.tour-support-fumbbl { display: block; width: max-content; margin: 6px auto 14px; line-height: 0; } /* centred on its own line */
.tour-support-fumbbl img { display: block; width: 190px; height: 59px; }

.tour-disclaimer-acks { display: flex; flex-direction: column; gap: 8px; padding: 10px 0 0; border-top: 1px solid color-mix(in srgb, var(--ui-border) 40%, transparent); }
.tour-disclaimer-ack {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  cursor: pointer;
}
.tour-disclaimer-ack input { flex: none; margin-top: 0.25em; }
.tour-disclaimer-footer { display: flex; justify-content: space-between; gap: 12px; padding-top: 14px; }
.tour-disclaimer-back {
  padding: 9px 18px;
  color: var(--ui-text);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  background: var(--ui-surface-2, var(--ui-surface));
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  cursor: pointer;
}
.tour-disclaimer-back:hover { border-color: var(--ui-accent); }
.tour-disclaimer-play {
  padding: 9px 22px;
  color: var(--ui-text-on-primary);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  letter-spacing: 0.05em;
  background: var(--ui-primary);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  cursor: pointer;
}
.tour-disclaimer-play:hover:not(:disabled) { background: var(--ui-active); }
.tour-disclaimer-play:disabled { opacity: 0.45; cursor: not-allowed; }

/* The match HUD's REPORT button (SpectateView .config-bar button + .report-btn + .report-bug, whose styles are scoped
   to SpectateView), as a decorative inline sample: no handler, not focusable, hidden from assistive tech; sized to sit
   in the line of text (vertically centred, never breaking the line around it, no inherited text decoration). */
.tour-report-sample { display: inline-flex; vertical-align: middle; margin: -4px 2px 0; pointer-events: none; white-space: nowrap; text-decoration: none; }
.tour-report-sample :deep(button.report-btn) {
  flex: none;
  width: auto;
  height: 28px;
  padding: 0 10px;
  color: var(--ui-heading);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.036em;
  line-height: 1;
  text-decoration: none;
  background: linear-gradient(180deg, #2d3137, #111317);
  border: 1.2px solid var(--ui-accent);
  border-radius: 2.4px;
}
.tour-report-sample .report-bug {
  display: inline-block;
  transform: scale(1.5);
  transform-origin: center;
  margin: 0 4px 0 2px;
  filter: saturate(1.7) brightness(1.12) drop-shadow(0 0 1.8px #ff2a2a);
}
</style>
