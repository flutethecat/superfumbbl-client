<script setup lang="ts">
/**
 * Owner 10-02: the END-GAME ROSTER (one team at a time, a two-name team switch above it: number, portrait, name,
 * position, added skills in their category colour, SPP gained this game). Lifted out of PostGamePanel.vue so the
 * post-game Roster tab and the in-game Helmet pop-out (RosterPopout.vue) render the SAME markup. The parent owns
 * the selected team (`v-model:side`) and hands in the projected sides (postGamePublic) and the portrait lookup.
 */
import { playerSkillCategoryClass } from '../game/skillCategory';
import type { PostGameSide, Side } from '../game/postGameProjection';

defineProps<{
  teams: { home: PostGameSide; away: PostGameSide };
  portrait: (playerId: string) => string | null;
}>();
const side = defineModel<Side>('side', { default: 'home' });
</script>

<template>
  <!-- #25-v2 (owner 2026-07-14): per-player roster/SPP summary — name · position · SPP-gained this game -->
  <section class="pg-roster">
    <!-- #235 (owner-fg 07-29): both team names remain visible as the one-roster-at-a-time selector. -->
    <div class="pg-roster-team-toggle" role="group" aria-label="Select roster team">
      <button v-for="w in (['home', 'away'] as const)" :key="w" type="button" :data-active="side === w" @click="side = w">
        <img v-if="teams[w].logo" :src="teams[w].logo!" alt="" />
        <span>{{ teams[w].team }}</span>
      </button>
    </div>
    <div class="pg-roster-team">
      <ul v-if="teams[side].roster.length" class="pg-roster-list">
        <li v-for="pl in teams[side].roster" :key="pl.playerId || pl.name">
          <!-- Owner 09-15: the player's portrait (the same renderer portrait the MVP card lifts), far left. -->
          <span class="pg-roster-nr">#{{ pl.nr }}</span>
          <span class="pg-roster-portrait-slot"><img v-if="portrait(pl.playerId)" class="pg-roster-portrait" :src="portrait(pl.playerId)!" alt="" /></span>
          <span class="pg-roster-name">{{ pl.name }}</span>
          <span class="pg-roster-pos">{{ pl.position }}</span>
          <!-- Owner 09-15: added skills in their category colour, no "+" prefix, a step under the name size. -->
          <span v-if="pl.addedSkillList.length" class="pg-roster-skills" :title="`Added skills: ${pl.addedSkills}`">
            <span v-for="skill in pl.addedSkillList" :key="skill.name" class="pg-roster-skill" :class="playerSkillCategoryClass(skill.name)">{{ skill.label }}</span>
          </span>
          <span class="pg-roster-spp" :data-zero="pl.spp === 0">{{ pl.spp }} SPP</span>
        </li>
      </ul>
      <p v-else class="pg-mvp-none">No player records</p>
    </div>
  </section>
</template>

<style scoped>
/* Moved verbatim from PostGamePanel.vue (owner 10-02) — edit the end-game roster here. */
/* #25-v2: per-player roster/SPP summary */
.pg-roster { padding: 8px 16px 6px; } /* owner 09-15: compact — twelve rows without the window scrolling */
/* #235 (owner-fg 07-29): two-name selector above the single visible roster. */
.pg-roster-team-toggle { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-bottom: 8px; }
.pg-roster-team-toggle button {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 0 6px;
  border: 0;
  border-bottom: 1px solid var(--ui-border);
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
/* Owner 09-14: the selected team block reads as a lighter panel, not just an underline. */
.pg-roster-team-toggle button { padding: 6px 10px; border-radius: 8px; }
.pg-roster-team-toggle button[data-active='true'] { border-bottom-color: var(--ui-accent); color: var(--ui-text); background: color-mix(in srgb, var(--ui-surface-2) 72%, var(--ui-text) 14%); }
.pg-roster-team-toggle img { width: 26px; height: 26px; flex: 0 0 auto; object-fit: contain; }
/* #235 (owner-fg 07-29): long single-line team names stay inside the column (ellipsis). */
.pg-roster-team-toggle span {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
/* Owner 09-15: the end-game roster showed ~9 oversized rows — smaller rows, and the list is sized to show TWELVE
   (a full BB roster page) before it scrolls: 12 × (line 1.25 × 0.86em + 3px) ≈ 12.9em + 36px. */
.pg-roster-list { list-style: none; margin: 6px 0 0; padding: 0; max-height: calc(24.8em + 50px); overflow-y: auto; } /* exactly 12 rows of 2.4em-slot portraits (46px/row at 1080p) */
.pg-roster-list li { display: flex; align-items: center; gap: 8px; padding: 1.5px 0; border-top: 1px solid var(--ui-border); font-size: 0.86em; line-height: 1.25; }
/* Owner 09-15 (2nd): portraits +30% — the sprite frame carries transparent padding, so the image is drawn 1.95em
   tall and overflows its 1.5em slot a hair above and below; the ROW height (and the twelve-row list) is unchanged. */
.pg-roster-portrait-slot { flex: 0 0 auto; width: 2.5em; height: 2.4em; display: inline-flex; align-items: center; justify-content: center; overflow: visible; } /* owner 09-15 (3rd): bigger still — the row grows with it */
.pg-roster-portrait { height: 2.6em; width: auto; max-width: none; object-fit: contain; image-rendering: pixelated; }
.pg-roster-nr { color: var(--ui-text-dim); font-variant-numeric: tabular-nums; min-width: 2em; text-align: right; } /* owner 09-15: player number, far left of the portrait */
.pg-roster-name { font-weight: 700; }
.pg-roster-pos { font-size: 0.92em; color: var(--ui-muted); }
/* Owner 09-14: added-skills pill (advancements + in-game grants beyond the position's base). */
.pg-roster-skills { display: inline-flex; gap: 6px; font-size: 0.9em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 44%; }
.pg-roster-skill { font-weight: 700; }
.pg-roster-skill.skill-general { color: var(--ui-skill-general); }
.pg-roster-skill.skill-agility { color: var(--ui-skill-agility); }
.pg-roster-skill.skill-strength { color: var(--ui-skill-strength); }
.pg-roster-skill.skill-passing { color: var(--ui-skill-passing); }
.pg-roster-skill.skill-mutation { color: var(--ui-skill-mutation); }
.pg-roster-skill.skill-trait { color: var(--ui-skill-trait); }
.pg-roster-skill.skill-extraordinary { color: var(--ui-skill-extraordinary, var(--ui-skill-trait)); }
.pg-roster-spp { margin-left: auto; color: var(--ui-accent); font-variant-numeric: tabular-nums; font-weight: 700; }
.pg-roster-spp[data-zero='true'] { color: var(--ui-text-dim); font-weight: 400; }
.pg-mvp-none { color: var(--ui-text-dim); font-style: italic; }
</style>
