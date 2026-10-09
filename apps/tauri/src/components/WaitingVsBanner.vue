<script setup lang="ts">
// Owner 10-06: TEAM VS TEAM splash across the top of the waiting board — crest, team name, coach and TV for each
// side. Presentation only: the model comes from game/waitingVsBanner.ts (names at once, race/TV as data arrives).
import { ref, watch } from 'vue';
import { teamLogoUrl } from '../game/teamLogos';
import { formatBannerTv, type BannerSide, type WaitingBannerModel } from '../game/waitingVsBanner';

/** `inline` (owner 10-09): sits in the flow directly above the waiting box instead of across the top of the board. */
const props = defineProps<{ model: WaitingBannerModel; inline?: boolean }>();

/** A crest that failed to load falls back to the initials (like the Play blade). */
const failed = ref(new Set<string>());
watch(() => [props.model.mine.race, props.model.opponent.race], () => { failed.value = new Set(); });

function crest(side: BannerSide, kit: 'home' | 'away'): string | null {
  if (!side.race) return null;
  const url = teamLogoUrl({ race: side.race, side: kit });
  return url && !failed.value.has(url) ? url : null;
}
function crestFailed(url: string | null): void {
  if (!url) return;
  const next = new Set(failed.value); next.add(url); failed.value = next;
}
function initials(name: string): string {
  const words = name.replace(/['’]/g, '').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  const [first = '?', second] = words;
  return (second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)).toUpperCase();
}
</script>

<template>
  <section class="vs-banner" :class="{ inline }" data-testid="waiting-vs-banner" aria-label="Match-up">
    <div v-for="slot in (['mine', 'opponent'] as const)" :key="slot" class="vs-side" :class="slot" :data-testid="`vs-${slot}`">
      <span class="vs-crest">
        <img v-if="crest(model[slot], slot === 'mine' ? 'home' : 'away')" :src="crest(model[slot], slot === 'mine' ? 'home' : 'away')!"
          :alt="`${model[slot].teamName} logo`" @error="crestFailed(crest(model[slot], slot === 'mine' ? 'home' : 'away'))" />
        <span v-else class="vs-initials" aria-hidden="true">{{ model[slot].unknown ? '?' : initials(model[slot].teamName) }}</span>
      </span>
      <span class="vs-text">
        <strong class="vs-team" data-testid="vs-team">{{ model[slot].teamName }}</strong>
        <span v-if="model[slot].coach" class="vs-coach" data-testid="vs-coach">{{ model[slot].coach }}</span>
        <span class="vs-meta">
          <span v-if="model[slot].race" data-testid="vs-race">{{ model[slot].race }}</span>
          <span v-if="formatBannerTv(model[slot].tv)" class="vs-tv" data-testid="vs-tv">{{ formatBannerTv(model[slot].tv) }}</span>
        </span>
      </span>
    </div>
    <span class="vs-mark" aria-label="versus">VS</span>
  </section>
</template>

<style scoped>
.vs-banner {
  position: absolute; top: 18px; left: 50%; transform: translateX(-50%); z-index: 3;
  width: min(880px, calc(100% - 32px)); box-sizing: border-box;
  display: grid; grid-template-columns: 1fr auto 1fr; grid-template-areas: 'mine mark opponent'; align-items: center; gap: 14px;
  padding: 10px 16px; border-radius: 10px;
  background: linear-gradient(90deg, #300f0fe8 0%, rgba(12, 15, 21, 0.95) 32%, rgba(12, 15, 21, 0.95) 68%, #300f0fe8 100%);
  border: 2px solid #e03030cc; box-shadow: 0 10px 28px #000c, inset 0 0 0 1px #00000080;
  color: var(--ui-text, #f0f0f0); pointer-events: none;
}
.vs-banner.inline { position: relative; top: auto; left: auto; transform: none; flex: none; }
.vs-side { display: flex; align-items: center; gap: 12px; min-width: 0; }
.vs-side.mine { grid-area: mine; }
.vs-side.opponent { grid-area: opponent; flex-direction: row-reverse; text-align: right; }
.vs-crest {
  flex: none; width: 64px; height: 64px; display: grid; place-items: center;
  border-radius: 50%; background: radial-gradient(circle at 50% 40%, #2a1012, #0b0d12 75%); border: 1px solid #e0303080;
}
.vs-crest img { width: 56px; height: 56px; object-fit: contain; filter: drop-shadow(0 2px 3px #000); }
.vs-initials { font-family: 'Nuffle', system-ui, sans-serif; font-size: 1.3rem; color: #e8918c; }
.vs-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
.vs-team {
  font-family: 'Nuffle', system-ui, sans-serif; font-size: max(var(--ui-min-primary-text-size, 16px), 1.25rem);
  letter-spacing: 0.04em; text-transform: uppercase; color: #fff; text-shadow: 0 2px 4px #000;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.vs-coach { font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); color: #e8918c; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vs-meta { display: flex; gap: 8px; font-size: max(var(--ui-min-secondary-text-size, 13px), 0.82rem); color: var(--ui-text-muted, #b8bcc6); }
.vs-side.opponent .vs-meta { justify-content: flex-end; }
.vs-tv { font-weight: 700; color: #f2d4a0; }
.vs-mark {
  grid-area: mark; display: grid; place-items: center; width: 66px; height: 66px; border-radius: 50%;
  font-family: 'SNES', 'Nuffle', system-ui, sans-serif; font-size: 2rem; font-style: italic; font-weight: 900; color: #fff;
  background: linear-gradient(135deg, #b81818, #5a0a0a); border: 2px solid #ff6a6acc;
  box-shadow: 0 0 18px #e0303099, 0 4px 10px #000c; text-shadow: 2px 2px 0 #000;
}
@media (max-width: 640px) {
  .vs-banner { gap: 8px; padding: 8px 10px; }
  .vs-crest { width: 40px; height: 40px; }
  .vs-crest img { width: 34px; height: 34px; }
  .vs-mark { width: 44px; height: 44px; font-size: 1.3rem; }
  .vs-side { gap: 8px; }
  .vs-meta { flex-direction: column; gap: 0; }
}
</style>
