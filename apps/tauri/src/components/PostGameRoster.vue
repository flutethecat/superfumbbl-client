<script setup lang="ts">
/**
 * Owner 10-02: the END-GAME ROSTER (one team at a time, a two-name team switch above it: number, portrait, name,
 * position, added skills in their category colour, SPP gained this game). Lifted out of PostGamePanel.vue so the
 * post-game Roster tab and the in-game Helmet pop-out (RosterPopout.vue) render the SAME markup. The parent owns
 * the selected team (`v-model:side`) and hands in the projected sides (postGamePublic) and the portrait lookup.
 * Owner 10-02 (v2): a "LVL n" badge leads each row (n = advancements; rookies keep an empty slot), the player's value
 * sits left of the SPP, positions drop the race prefix, and the team switch carries "<Race> · (You)/<Coach>".
 * `scalable` (the pop-out only): the list flexes to the window height and every size multiplies by --roster-scale,
 * which RosterPopout drives; the post-game tab pins the scale to 1 and keeps its own look.
 */
import type { SkillIconStyle } from '@fumbbl40k/ffb-pitch';
import { playerSkillCategoryClass } from '../game/skillCategory';
import { reactiveSkillIconUrl } from '../game/assetModUi';
import { rosterTeamSubtext, type PostGameSide, type Side } from '../game/postGameProjection';
import { formatPlayerValue } from '../game/playerValue';
import { ROSTER_INJURY_TEXT, ROSTER_INJURY_TITLE, ROSTER_RIP_SKULL_URL, rosterInjuryArt, rosterLevelArt } from '../game/rosterLevelArt';

const props = withDefaults(defineProps<{
  teams: { home: PostGameSide; away: PostGameSide };
  portrait: (playerId: string) => string | null;
  /** The local coach's side ("(You)"); null for a spectator / replay. */
  localSide?: Side | null;
  /** RosterPopout: fill the window and scale with --roster-scale. */
  scalable?: boolean;
  /** Owner 10-02: Settings > skill display - 'icons' swaps the added-skill names for their icons. */
  skillMode?: 'icons' | 'markings';
  iconStyle?: SkillIconStyle;
}>(), { localSide: null, scalable: false, skillMode: 'markings', iconStyle: 'bb3' });
function skillIcon(skill: string, positionId: string | null | undefined): string | null {
  return reactiveSkillIconUrl(skill, props.iconStyle, { positionId: positionId ?? null, side: side.value }) || null;
}
const side = defineModel<Side>('side', { default: 'home' });
</script>

<template>
  <!-- #25-v2 (owner 2026-07-14): per-player roster/SPP summary — name · position · SPP-gained this game -->
  <section class="pg-roster" :class="{ 'pg-roster--scalable': scalable }">
    <!-- #235 (owner-fg 07-29): both team names remain visible as the one-roster-at-a-time selector. -->
    <div class="pg-roster-team-toggle" role="group" aria-label="Select roster team">
      <button v-for="w in (['home', 'away'] as const)" :key="w" type="button" :data-active="side === w" @click="side = w">
        <img v-if="teams[w].logo" :src="teams[w].logo!" alt="" />
        <span class="pg-roster-team-label">
          <span class="pg-roster-team-name">{{ teams[w].team }}</span>
          <span v-if="rosterTeamSubtext(teams[w], localSide)" class="pg-roster-team-sub">{{ rosterTeamSubtext(teams[w], localSide) }}</span>
        </span>
        <!-- Owner 10-02: players still available / on the roster ("11/13"), bottom-right, live through the game. -->
        <span v-if="teams[w].rosterSize" class="pg-roster-team-count" data-testid="roster-eligible-count"
          :title="`${teams[w].eligible ?? teams[w].rosterSize} of ${teams[w].rosterSize} players available`">{{ teams[w].eligible ?? teams[w].rosterSize }}/{{ teams[w].rosterSize }}</span>
      </button>
    </div>
    <div class="pg-roster-team">
      <ul v-if="teams[side].roster.length" class="pg-roster-list">
        <li v-for="pl in teams[side].roster" :key="pl.playerId || pl.name">
          <!-- Owner 10-02: no player number (room for the name and skills); the level / injury badge leads the row. -->
          <!-- Owner 10-02: retro level badge (fixed slot so rookies' rows stay aligned). -->
          <span class="pg-roster-lvl" :data-level="pl.advancements" :data-injury="pl.injury || null">
            <!-- Owner 10-02: an injury suffered this game (or MNG) replaces the LVL badge, same plate in crimson. -->
            <!-- Owner 10-02: RIP = the RIP text art centred over the block-die skull. -->
            <span v-if="pl.injury === 'rip' && ROSTER_RIP_SKULL_URL" class="pg-roster-rip" :title="ROSTER_INJURY_TITLE.rip">
              <img class="pg-roster-rip-skull" :src="ROSTER_RIP_SKULL_URL" alt="" />
              <img v-if="rosterInjuryArt('rip')" class="pg-roster-rip-text" :src="rosterInjuryArt('rip')!.src" :srcset="rosterInjuryArt('rip')!.srcset" alt="RIP" />
              <span v-else class="pg-roster-rip-text pg-roster-lvl-text pg-roster-inj-text">RIP</span>
            </span>
            <template v-else-if="pl.injury">
              <img v-if="rosterInjuryArt(pl.injury)" class="pg-roster-inj-img" :src="rosterInjuryArt(pl.injury)!.src"
                :srcset="rosterInjuryArt(pl.injury)!.srcset" :alt="ROSTER_INJURY_TEXT[pl.injury]" :title="ROSTER_INJURY_TITLE[pl.injury]" />
              <span v-else class="pg-roster-lvl-text pg-roster-inj-text" :title="ROSTER_INJURY_TITLE[pl.injury]">{{ ROSTER_INJURY_TEXT[pl.injury] }}</span>
            </template>
            <template v-else-if="pl.advancements > 0">
              <img v-if="rosterLevelArt(pl.advancements)" class="pg-roster-lvl-img" :src="rosterLevelArt(pl.advancements)!.src"
                :srcset="rosterLevelArt(pl.advancements)!.srcset" :alt="`LVL ${pl.advancements}`" :title="`Level ${pl.advancements}`" />
              <span v-else class="pg-roster-lvl-text" :title="`Level ${pl.advancements}`">LVL {{ pl.advancements }}</span>
            </template>
          </span>
          <!-- Owner 09-15: the player's portrait (the same renderer portrait the MVP card lifts). -->
          <span class="pg-roster-portrait-slot"><img v-if="portrait(pl.playerId)" class="pg-roster-portrait" :src="portrait(pl.playerId)!" alt="" /></span>
          <span class="pg-roster-name">{{ pl.name }}</span>
          <span class="pg-roster-pos">{{ pl.position }}</span>
          <!-- Owner 09-15: added skills in their category colour, no "+" prefix, a step under the name size. -->
          <!-- Owner 10-02: every skill, sorted like the player portrait - base first, added last (added icons ringed gold). -->
          <span v-if="(pl.skillList ?? pl.addedSkillList).length" class="pg-roster-skills" :data-mode="skillMode">
            <template v-for="skill in (pl.skillList ?? pl.addedSkillList.map((s) => ({ ...s, added: true })))" :key="skill.name">
              <!-- Owner 10-02: with skill icons enabled, the icon replaces the name (name on hover). -->
              <img v-if="skillMode === 'icons' && skillIcon(skill.name, pl.positionId)" class="pg-roster-skill-icon" :data-added="skill.added" tabindex="0"
                :src="skillIcon(skill.name, pl.positionId)!" :alt="skill.label" :title="skill.label" />
              <span v-else class="pg-roster-skill" :class="playerSkillCategoryClass(skill.name)" :data-added="skill.added">{{ skill.label }}</span>
            </template>
          </span>
          <!-- Owner 10-02: the player's value (position cost + advancements), left of the SPP. -->
          <span class="pg-roster-value" title="Player value">{{ formatPlayerValue(pl.value) }}</span>
          <span class="pg-roster-spp" :data-zero="pl.spp === 0">{{ pl.spp }} SPP</span>
        </li>
      </ul>
      <p v-else class="pg-mvp-none">No player records</p>
    </div>
  </section>
</template>

<style scoped>
/* Moved verbatim from PostGamePanel.vue (owner 10-02) — edit the end-game roster here. */
/* Owner 10-02: every px size multiplies by --roster-scale. Pinned to 1 here (the post-game tab looks exactly as it did);
   the pop-out's scalable mode inherits RosterPopout's value instead. */
.pg-roster { --roster-scale: 1; }
.pg-roster--scalable { --roster-scale: inherit; font-size: calc(1em * var(--roster-scale, 1)); display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; box-sizing: border-box; }
.pg-roster--scalable .pg-roster-team { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
/* Pop-out: the list fills the window and scrolls past what fits (RosterPopout keeps 11 rows in view once it scales). */
.pg-roster--scalable .pg-roster-list { flex: 1 1 auto; min-height: 0; max-height: var(--roster-list-max, none); }
/* #25-v2: per-player roster/SPP summary */
.pg-roster { padding: calc(8px * var(--roster-scale)) calc(16px * var(--roster-scale)) calc(6px * var(--roster-scale)); } /* owner 09-15: compact — twelve rows without the window scrolling */
/* #235 (owner-fg 07-29): two-name selector above the single visible roster. */
.pg-roster-team-toggle { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: calc(16px * var(--roster-scale)); margin-bottom: calc(8px * var(--roster-scale)); }
.pg-roster-team-toggle button {
  position: relative;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: calc(8px * var(--roster-scale));
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
.pg-roster-team-toggle button { padding: calc(6px * var(--roster-scale)) calc(10px * var(--roster-scale)); border-radius: calc(8px * var(--roster-scale)); }
.pg-roster-team-toggle button[data-active='true'] { border-bottom-color: var(--ui-accent); color: var(--ui-text); background: color-mix(in srgb, var(--ui-surface-2) 72%, var(--ui-text) 14%); }
.pg-roster-team-toggle img { width: calc(26px * var(--roster-scale)); height: calc(26px * var(--roster-scale)); flex: 0 0 auto; object-fit: contain; }
/* #235 (owner-fg 07-29): long single-line team names stay inside the column (ellipsis). */
.pg-roster-team-label { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; max-width: 100%; }
/* Owner 10-02: the available / roster count sits in the button's bottom-right corner. */
.pg-roster-team-count { position: absolute; right: calc(8px * var(--roster-scale)); bottom: calc(5px * var(--roster-scale)); font-size: 0.8em; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ui-muted); }
.pg-roster-team-toggle button[data-active='true'] .pg-roster-team-count { color: var(--ui-text); }
.pg-roster-team-toggle button { padding-right: 3.6em; } /* room for the count (em already carries the pop-out scale) */
.pg-roster-team-name,
.pg-roster-team-sub {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
/* Owner 10-02: race + "(You)" / the coach, a muted line under the team name. */
.pg-roster-team-sub { font-size: 0.72em; font-weight: 700; line-height: 1.2; color: color-mix(in srgb, var(--ui-text) 45%, var(--ui-muted)); }
/* Owner 09-15: the end-game roster showed ~9 oversized rows — smaller rows, and the list is sized to show TWELVE
   (a full BB roster page) before it scrolls: 12 × (line 1.25 × 0.86em + 3px) ≈ 12.9em + 36px. */
.pg-roster-list { list-style: none; margin: calc(6px * var(--roster-scale)) 0 0; padding: 0; max-height: calc(24.8em + 50px); overflow-y: auto; } /* exactly 12 rows of 2.4em-slot portraits (46px/row at 1080p) */
.pg-roster-list li { display: flex; align-items: center; gap: calc(8px * var(--roster-scale)); padding: calc(1.5px * var(--roster-scale)) 0; border-top: 1px solid var(--ui-border); font-size: 0.86em; line-height: 1.25; }
/* Owner 10-02: the LVL badge slot — fixed width (rookies leave it empty), badge about the name's height. */
.pg-roster-lvl { flex: 0 0 auto; width: 3.6em; display: inline-flex; align-items: center; justify-content: flex-start; }
/* The art is 46 x 14 at 1x (3.29:1): 1em tall = about the name's cap-to-descender height, 3.29em wide. */
.pg-roster-lvl-img { height: 1em; width: auto; max-width: 3.6em; object-fit: contain; image-rendering: auto; } /* smooth down from the 4x / 8x masters */
/* Owner 10-02: injuries / KO are plate-less retro TEXT (not a badge, so they never read as LVL), drawn larger:
   the 9-px-tall art at 1.5em (a 3-letter label is 19:9, so ~3.2em wide - inside the 3.6em slot). */
.pg-roster-inj-img { height: 1.5em; width: auto; max-width: 3.6em; object-fit: contain; image-rendering: auto; } /* smooth down from the 4x / 8x masters */
/* Owner 10-02: RIP over the skull - the skull (64 px block-die face, scaled down smoothly) fills a 2em square behind,
   the RIP text art is centred on it at the injury-text height. */
.pg-roster-rip { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 3.4em; height: 2.4em; }
.pg-roster-rip-skull { position: absolute; inset: 0; margin: auto; height: 2.7em; width: 2.7em; object-fit: contain; image-rendering: auto; }
.pg-roster-rip-text { position: relative; height: 1.1em; width: auto; image-rendering: auto; }
/* Fallback until the badge art lands: chunky gold-on-dark pixel text. */
/* Owner 10-02: injury badge fallback - the same plate, crimson lettering. */
.pg-roster-lvl-text.pg-roster-inj-text { color: #ff5a5a; border-color: #ff5a5a; box-shadow: 0 0.14em 0 #5a0000, inset 0 -0.16em 0 #3a2a5c; text-shadow: 0.12em 0.12em 0 #5a0000; }
.pg-roster-lvl-text {
  display: inline-block;
  padding: 0.16em 0.34em 0.12em;
  font-family: ui-monospace, 'Consolas', 'Courier New', monospace;
  font-size: 0.74em;
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0.06em;
  white-space: nowrap;
  color: #ffd84a;
  background: #1d1533;
  border: 0.14em solid #ffd84a;
  box-shadow: 0 0.14em 0 #6b4300, inset 0 -0.16em 0 #3a2a5c;
  text-shadow: 0.12em 0.12em 0 #7a3d00;
  image-rendering: pixelated;
  -webkit-font-smoothing: none;
  font-smooth: never;
}
/* Owner 09-15 (2nd): portraits +30% — the sprite frame carries transparent padding, so the image is drawn 1.95em
   tall and overflows its 1.5em slot a hair above and below; the ROW height (and the twelve-row list) is unchanged. */
.pg-roster-portrait-slot { flex: 0 0 auto; width: 2.5em; height: 2.4em; display: inline-flex; align-items: center; justify-content: center; overflow: visible; } /* owner 09-15 (3rd): bigger still — the row grows with it */
.pg-roster-portrait { height: 2.6em; width: auto; max-width: none; object-fit: contain; image-rendering: pixelated; }
.pg-roster-name { font-weight: 700; flex: 0 0 auto; white-space: nowrap; } /* names never truncate; the position gives way first */
/* Owner 10-02: the position read blurry - a thin, dim weight of the display font on the translucent window. Same
   weight as the name, a solid lighter grey (no blend), so the glyph edges stay crisp. */
.pg-roster-pos { font-size: 0.92em; font-weight: 700; color: color-mix(in srgb, var(--ui-text) 58%, var(--ui-muted)); flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Owner 09-14: added-skills pill (advancements + in-game grants beyond the position's base). */
/* Owner 10-02: the skills fill the space up to the value column and WRAP there (whole skills, never mid-word); an
   overflowing row grows taller instead of clipping. */
.pg-roster-skills { flex: 1 1 0; min-width: 0; display: inline-flex; flex-wrap: wrap; column-gap: calc(6px * var(--roster-scale)); row-gap: 0.1em; font-size: 0.9em; line-height: 1.2; padding: 0.15em calc(6px * var(--roster-scale)) 0.15em 0; }
.pg-roster-skill { font-weight: 700; white-space: nowrap; }
/* Owner 10-02: skill icons in the roster row - about the portrait's height, so a full row of them reads; they wrap
   at the value column like the names. */
.pg-roster-skill-icon { width: 2em; height: 2em; object-fit: contain; border: 1px solid var(--ui-border); border-radius: 3px; background: var(--ui-surface); align-self: center; }
/* The portrait's added-skill ring (PlayerDetailSkillList S87): gold outline on an ADDED skill's icon. */
/* Owner 10-02: icons sit in a fixed FOUR-wide grid right before the value column - every row wraps at exactly four and
   the icons line up as a column whatever the name length. */
/* Four columns whenever there is room; a cramped window lets the grid narrow (fewer per line) rather than overflow. */
.pg-roster-skills[data-mode='icons'] { flex: 0 0.001 auto; box-sizing: content-box; width: calc(8em + 12px * var(--roster-scale)); min-width: 2em; display: grid; grid-template-columns: repeat(auto-fill, 2em); column-gap: calc(4px * var(--roster-scale)); row-gap: calc(4px * var(--roster-scale)); margin-left: auto; padding-right: calc(8px * var(--roster-scale)); }
/* A skill with no icon keeps its name, across the whole grid line instead of spilling over the next cells. */
.pg-roster-skills[data-mode='icons'] .pg-roster-skill { grid-column: 1 / -1; white-space: normal; }
.pg-roster-skill-icon:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
.pg-roster-skills[data-mode='icons'] + .pg-roster-value { margin-left: 0; }
.pg-roster-skill-icon[data-added='true'] { border-color: #e6b422; box-shadow: 0 0 0 1px #e6b422, inset 0 0 0 1px rgb(0 0 0 / 55%); }
.pg-roster-skill.skill-general { color: var(--ui-skill-general); }
.pg-roster-skill.skill-agility { color: var(--ui-skill-agility); }
.pg-roster-skill.skill-strength { color: var(--ui-skill-strength); }
.pg-roster-skill.skill-passing { color: var(--ui-skill-passing); }
.pg-roster-skill.skill-mutation { color: var(--ui-skill-mutation); }
.pg-roster-skill.skill-trait { color: var(--ui-skill-trait); }
.pg-roster-skill.skill-extraordinary { color: var(--ui-skill-extraordinary, var(--ui-skill-trait)); }
/* Owner 10-02: value then SPP, both right-aligned columns at the row's end. */
.pg-roster-value { margin-left: auto; flex: 0 0 auto; min-width: 3.4em; text-align: right; color: var(--ui-text); font-variant-numeric: tabular-nums; font-weight: 600; }
.pg-roster-spp { flex: 0 0 auto; min-width: 4.4em; text-align: right; color: var(--ui-accent); font-variant-numeric: tabular-nums; font-weight: 700; }
.pg-roster-spp[data-zero='true'] { color: var(--ui-text-dim); font-weight: 400; }
.pg-mvp-none { color: var(--ui-text-dim); font-style: italic; }
</style>
