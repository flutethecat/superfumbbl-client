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
import { computed, nextTick } from 'vue';
import type { SkillIconStyle } from '@fumbbl40k/ffb-pitch';
import { playerSkillCategoryClass } from '../game/skillCategory';
import { reactiveSkillIconUrl } from '../game/assetModUi';
import { rosterTeamSubtext, type PostGamePlayer, type PostGameSide, type RosterPick, type RosterRowExtra, type Side } from '../game/postGameProjection';
import { formatPlayerValue } from '../game/playerValue';
import { settings } from '../game/settings';
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
  /**
   * Owner 10-09 (end-game MVP panels = this roster): false pins the panel to `side` - ONE team header, no way to
   * switch. The Helmet pop-out and the post-game Roster tab leave it on.
   */
  switcher?: boolean;
  /**
   * Selectable rows (MVP nomination / Assign Touchdown). The eligible ids are the SERVER's offer and the selected ids
   * the store's pick, both handed in untouched; a click on an eligible row only emits `pick` - the parent answers.
   */
  pick?: RosterPick | null;
  /** Show only these players (the awarded MVPs, the players offered a touchdown); null = the whole roster. */
  onlyIds?: readonly string[] | null;
  /** Per-player additions the roster projection does not carry: lifetime SPP, MVP awards. */
  extras?: Readonly<Record<string, RosterRowExtra>> | null;
  /** Fill the parent's height and scroll the LIST (a footer under it stays in view); the scale stays 1. */
  fill?: boolean;
  /**
   * Two team panels side by side (half the width each): every row breaks at the same place - badge, portrait, name,
   * position on the first line; skills, value, SPP on the second - so the columns line up and nothing scrolls sideways.
   */
  twoLine?: boolean;
  /**
   * Owner 10-10: the "Hide innate skills" box in the pane's bottom-right corner. On by default; a host that mounts two
   * rosters side by side (the post-game MVP tab) shows it on one of them. The FILTER follows the setting either way.
   */
  innateToggle?: boolean;
}>(), { localSide: null, scalable: false, skillMode: 'markings', iconStyle: 'bb3', switcher: true, pick: null, onlyIds: null, extras: null, fill: false, twoLine: false, innateToggle: true });
const emit = defineEmits<{ (e: 'pick', playerId: string): void }>();
function skillIcon(skill: string, positionId: string | null | undefined): string | null {
  return reactiveSkillIconUrl(skill, props.iconStyle, { positionId: positionId ?? null, side: side.value }) || null;
}
const side = defineModel<Side>('side', { default: 'home' });
const headSides = computed<readonly Side[]>(() => (props.switcher ? ['home', 'away'] : [side.value]));
const rows = computed(() => {
  const all = props.teams[side.value].roster;
  if (!props.onlyIds) return all;
  const only = new Set(props.onlyIds);
  return all.filter((pl) => only.has(pl.playerId));
});
/**
 * Owner 10-10 ("Hide innate skills", default on): the row drops the position's OWN skills and keeps everything else.
 * Innate = the roster projection's `innate` flag (skillDisplay playerRosterSkills: the position lists it with the same
 * keyword / value and nothing granted or learned carries it), so an advancement, a same-name grant (Hatred (Orc) beside
 * an innate Hatred (Troll)) and anything granted this game stay. No classification lives here; a row without the flag
 * (a hand-built list) falls back to `added`.
 */
type RosterSkill = { name: string; label: string; added: boolean; innate?: boolean };
function rowSkills(pl: PostGamePlayer): RosterSkill[] {
  const all: RosterSkill[] = pl.skillList ?? pl.addedSkillList.map((s) => ({ ...s, added: true }));
  return settings.rosterHideInnateSkills ? all.filter((skill) => !(skill.innate ?? !skill.added)) : all;
}
/** Space / Enter stay with the box (the view's hotkeys would otherwise take them). */
function onInnateKeydown(event: KeyboardEvent) {
  if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
}
const isEligible = (playerId: string) => !!props.pick && props.pick.eligibleIds.includes(playerId);
const isPicked = (playerId: string) => !!props.pick && props.pick.selectedIds.includes(playerId);
/** The ONE selection path: a mouse click anywhere on the row, and the row's own box (mouse or keyboard). */
function onRow(playerId: string) {
  if (props.pick && isEligible(playerId)) emit('pick', playerId);
}
/**
 * The box is the keyboard control (Tab to it; Space toggles natively, Enter here, arrows walk a radio group). Its click
 * never reaches the row (no double toggle). The parent owns the state: once it has answered, the box is put back on
 * the truth, so a pick the store refused does not leave a stray tick.
 */
function onBox(event: Event, playerId: string) {
  const box = event.currentTarget as HTMLInputElement | null;
  onRow(playerId);
  void nextTick(() => { if (box) box.checked = isPicked(playerId); });
}
/** Keys the box uses stay with it (the view's hotkeys would otherwise take Enter for chat and the arrows for the camera). */
function onBoxKeydown(event: KeyboardEvent, playerId: string) {
  if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onBox(event, playerId); return; }
  if (event.key === ' ' || event.key.startsWith('Arrow')) event.stopPropagation();
}
</script>

<template>
  <!-- #25-v2 (owner 2026-07-14): per-player roster/SPP summary — name · position · SPP-gained this game -->
  <section class="pg-roster" :class="{ 'pg-roster--scalable': scalable, 'pg-roster--fill': fill, 'pg-roster--two-line': twoLine }">
    <!-- #235 (owner-fg 07-29): both team names remain visible as the one-roster-at-a-time selector. -->
    <!-- Owner 10-09: with the switcher off (the end-game MVP panels) the SAME header shows the one team, as a plain
         block: nothing to click, no second team. -->
    <div class="pg-roster-team-toggle" :class="{ 'pg-roster-team-toggle--fixed': !switcher }" :role="switcher ? 'group' : undefined"
      :aria-label="switcher ? 'Select roster team' : undefined">
      <component :is="switcher ? 'button' : 'div'" v-for="w in headSides" :key="w" class="pg-roster-team-tab" :type="switcher ? 'button' : undefined"
        :data-active="side === w" @click="switcher && (side = w)">
        <img v-if="teams[w].logo" :src="teams[w].logo!" alt="" />
        <span class="pg-roster-team-label">
          <span class="pg-roster-team-name">{{ teams[w].team }}</span>
          <span v-if="rosterTeamSubtext(teams[w], localSide)" class="pg-roster-team-sub">{{ rosterTeamSubtext(teams[w], localSide) }}</span>
        </span>
        <!-- Owner 10-02: players still available / on the roster ("11/13"), bottom-right, live through the game. -->
        <span v-if="teams[w].rosterSize" class="pg-roster-team-count" data-testid="roster-eligible-count"
          :title="`${teams[w].eligible ?? teams[w].rosterSize} of ${teams[w].rosterSize} players available`">{{ teams[w].eligible ?? teams[w].rosterSize }}/{{ teams[w].rosterSize }}</span>
      </component>
    </div>
    <slot name="status" />
    <div class="pg-roster-team">
      <ul v-if="rows.length" class="pg-roster-list" :role="pick?.input === 'radio' ? 'radiogroup' : undefined" :aria-label="pick?.label">
        <li v-for="pl in rows" :key="pl.playerId || pl.name" :data-eligible="pick ? isEligible(pl.playerId) : null"
          :data-checked="pick ? isPicked(pl.playerId) : null" :data-mvp="extras?.[pl.playerId]?.awards ? 'true' : null"
          :title="pick ? `#${pl.nr} ${pl.name}, ${pl.position}` : undefined" @click="onRow(pl.playerId)">
          <!-- Owner 10-02: no player number (room for the name and skills); the level / injury badge leads the row. -->
          <!-- Owner 10-02: retro level badge (fixed slot so rookies' rows stay aligned). -->
          <span class="pg-roster-lvl" :data-level="pl.advancements" :data-injury="pl.injury || null" :data-pick="pick ? 'true' : null">
            <!-- Owner 10-02: an injury suffered this game (or MNG) replaces the LVL badge, same plate in crimson. -->
            <!-- Owner 10-02: RIP = the RIP text art centred over the block-die skull. -->
            <!-- Owner 10-09: an injury suffered THIS game wears the added-skill gold box (data-new); MNG carried in and KO do not. -->
            <span v-if="pl.injury === 'rip' && ROSTER_RIP_SKULL_URL" class="pg-roster-rip" :data-new="pl.injuryNew ? 'true' : null" :title="ROSTER_INJURY_TITLE.rip">
              <img class="pg-roster-rip-skull" :src="ROSTER_RIP_SKULL_URL" alt="" />
              <img v-if="rosterInjuryArt('rip')" class="pg-roster-rip-text" :src="rosterInjuryArt('rip')!.src" :srcset="rosterInjuryArt('rip')!.srcset" alt="RIP" />
              <span v-else class="pg-roster-rip-text pg-roster-lvl-text pg-roster-inj-text">RIP</span>
            </span>
            <template v-else-if="pl.injury">
              <img v-if="rosterInjuryArt(pl.injury)" class="pg-roster-inj-img" :data-new="pl.injuryNew ? 'true' : null" :src="rosterInjuryArt(pl.injury)!.src"
                :srcset="rosterInjuryArt(pl.injury)!.srcset" :alt="ROSTER_INJURY_TEXT[pl.injury]" :title="ROSTER_INJURY_TITLE[pl.injury]" />
              <span v-else class="pg-roster-lvl-text pg-roster-inj-text" :data-new="pl.injuryNew ? 'true' : null" :title="ROSTER_INJURY_TITLE[pl.injury]">{{ ROSTER_INJURY_TEXT[pl.injury] }}</span>
            </template>
            <template v-else-if="pl.advancements > 0">
              <img v-if="rosterLevelArt(pl.advancements)" class="pg-roster-lvl-img" :src="rosterLevelArt(pl.advancements)!.src"
                :srcset="rosterLevelArt(pl.advancements)!.srcset" :alt="`LVL ${pl.advancements}`" :title="`Level ${pl.advancements}`" />
              <span v-else class="pg-roster-lvl-text" :title="`Level ${pl.advancements}`">LVL {{ pl.advancements }}</span>
            </template>
            <!-- Owner 10-09 ("add a checkmark next to the LVL badges"): a selectable row's check mark sits in the badge
                 column, right of the LVL / injury badge (same spot on a rookie's empty slot). It is the real, labelled,
                 focusable control - a checkbox, or a radio on a pick-one pane, drawn as the SAME mark; disabled and
                 dimmed when the server did not offer the player. The whole row is the mouse target; both go through onRow. -->
            <input v-if="pick" :type="pick.input" class="pg-roster-check" :name="pick.input === 'radio' ? (pick.label ?? 'roster-pick') : undefined"
              :aria-label="`#${pl.nr} ${pl.name}, ${pl.position}`" :checked="isPicked(pl.playerId)" :disabled="!isEligible(pl.playerId)"
              @click.stop="onBox($event, pl.playerId)" @keydown="onBoxKeydown($event, pl.playerId)" />
          </span>
          <!-- Owner 09-15: the player's portrait (the same renderer portrait the MVP card lifts). -->
          <span class="pg-roster-portrait-slot"><img v-if="portrait(pl.playerId)" class="pg-roster-portrait" :src="portrait(pl.playerId)!" alt="" /></span>
          <span class="pg-roster-name">{{ pl.name }}</span>
          <span v-if="extras?.[pl.playerId]?.teamTag" class="pg-roster-team-tag">{{ extras[pl.playerId]!.teamTag }}</span>
          <span v-if="extras?.[pl.playerId]?.awards" class="pg-roster-mvp" data-testid="roster-mvp-mark"><i aria-hidden="true">★</i> MVP<template v-if="extras[pl.playerId]!.awards! > 1"> ×{{ extras[pl.playerId]!.awards }}</template></span>
          <span class="pg-roster-pos">{{ pl.position }}</span>
          <!-- Owner 09-15: added skills in their category colour, no "+" prefix, a step under the name size. -->
          <!-- Owner 10-02: every skill, sorted like the player portrait - base first, added last (added icons ringed gold). -->
          <!-- Owner 10-10: "Hide innate skills" (default on) leaves only the gained ones; a player with none has no
               skill cell, exactly like a skill-less player before (the value column keeps the row's right edge). -->
          <span v-if="rowSkills(pl).length" class="pg-roster-skills" :data-mode="skillMode">
            <!-- Astra review: two Hatred keywords share a name - the key carries the label and the index. -->
            <template v-for="(skill, i) in rowSkills(pl)" :key="`${skill.name}:${skill.label}:${i}`">
              <!-- Owner 10-02: with skill icons enabled, the icon replaces the name (name on hover). -->
              <img v-if="skillMode === 'icons' && skillIcon(skill.name, pl.positionId)" class="pg-roster-skill-icon" :data-added="skill.added" tabindex="0"
                :src="skillIcon(skill.name, pl.positionId)!" :alt="skill.label" :title="skill.label" />
              <span v-else class="pg-roster-skill" :class="playerSkillCategoryClass(skill.name)" :data-added="skill.added">{{ skill.label }}</span>
            </template>
          </span>
          <!-- Owner 10-02: the player's value (position cost + advancements), left of the SPP. -->
          <span class="pg-roster-value" title="Player value">{{ formatPlayerValue(pl.value) }}</span>
          <!-- Owner 10-09 (pick panes, final): "10 SPP (+7)" - the SPP the player CAME INTO the game with, then what was
               earned this game in brackets, shown only when something was earned. The old nomination list's format
               (its markup, bracket, spacing and the green gain), never a summed figure. -->
          <span v-if="extras?.[pl.playerId]?.sppBank != null" class="pg-roster-spp pg-roster-spp--bank" :data-zero="extras[pl.playerId]!.sppBank === 0 && pl.spp === 0"
            :title="`${extras[pl.playerId]!.sppBank} SPP before this game, ${pl.spp} earned this game`">{{ extras[pl.playerId]!.sppBank }} SPP<span v-if="pl.spp > 0" class="pg-roster-spp-gain"> (+{{ pl.spp }})</span></span>
          <span v-else class="pg-roster-spp" :data-zero="pl.spp === 0">{{ pl.spp }} SPP</span>
        </li>
      </ul>
      <p v-else-if="!onlyIds" class="pg-mvp-none">No player records</p>
    </div>
    <slot name="footer" />
    <!-- Owner 10-10: one box for every roster pane (settings.rosterHideInnateSkills), bottom-right, inside the pane's own
         padding (clear of the pop-out's resize grip; the pick panes' confirm button sits in the footer under it). -->
    <label v-if="innateToggle" class="pg-roster-innate" data-testid="roster-hide-innate" title="List only the skills a player has gained; position skills are left out">
      <input v-model="settings.rosterHideInnateSkills" type="checkbox" @keydown="onInnateKeydown" />
      <span>Hide innate skills</span>
    </label>
  </section>
</template>

<style scoped>
/* Moved verbatim from PostGamePanel.vue (owner 10-02) — edit the end-game roster here. */
/* Owner 10-02: every px size multiplies by --roster-scale. Pinned to 1 here (the post-game tab looks exactly as it did);
   the pop-out's scalable mode inherits RosterPopout's value instead. */
.pg-roster { --roster-scale: 1; user-select: none; -webkit-user-select: none; } /* owner 10-10: roster text and art are not selectable (a drag across rows highlighted them) */
.pg-roster img { -webkit-user-drag: none; }
.pg-roster--scalable { --roster-scale: inherit; font-size: calc(1em * var(--roster-scale, 1)); display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; box-sizing: border-box; }
.pg-roster--scalable .pg-roster-team { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
/* Pop-out: the list fills the window and scrolls past what fits (RosterPopout keeps 11 rows in view once it scales). */
.pg-roster--scalable .pg-roster-list { flex: 1 1 auto; min-height: 0; max-height: var(--roster-list-max, none); }
/* #25-v2: per-player roster/SPP summary */
.pg-roster { padding: calc(8px * var(--roster-scale)) calc(16px * var(--roster-scale)) calc(6px * var(--roster-scale)); } /* owner 09-15: compact — twelve rows without the window scrolling */
/* #235 (owner-fg 07-29): two-name selector above the single visible roster. */
.pg-roster-team-toggle { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: calc(16px * var(--roster-scale)); margin-bottom: calc(8px * var(--roster-scale)); }
.pg-roster-team-toggle .pg-roster-team-tab {
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
.pg-roster-team-toggle .pg-roster-team-tab { padding: calc(6px * var(--roster-scale)) calc(10px * var(--roster-scale)); border-radius: calc(8px * var(--roster-scale)); }
.pg-roster-team-toggle .pg-roster-team-tab[data-active='true'] { border-bottom-color: var(--ui-accent); color: var(--ui-text); background: color-mix(in srgb, var(--ui-surface-2) 72%, var(--ui-text) 14%); }
.pg-roster-team-toggle img { width: calc(26px * var(--roster-scale)); height: calc(26px * var(--roster-scale)); flex: 0 0 auto; object-fit: contain; }
/* #235 (owner-fg 07-29): long single-line team names stay inside the column (ellipsis). */
.pg-roster-team-label { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; max-width: 100%; }
/* Owner 10-02: the available / roster count sits in the button's bottom-right corner. */
.pg-roster-team-count { position: absolute; right: calc(8px * var(--roster-scale)); bottom: calc(5px * var(--roster-scale)); font-size: 0.8em; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ui-muted); }
.pg-roster-team-toggle .pg-roster-team-tab[data-active='true'] .pg-roster-team-count { color: var(--ui-text); }
.pg-roster-team-toggle .pg-roster-team-tab { padding-right: 3.6em; } /* room for the count (em already carries the pop-out scale) */
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
.pg-roster-lvl { flex: 0 0 auto; width: 3.6em; margin-left: 2px; display: inline-flex; align-items: center; justify-content: flex-start; } /* owner 10-10: 2px clear of the list's clip edge, so an injury badge's border / gold "this game" outline is not cut on the left */
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
/* Owner 10-09: Skill Markings mode - an ADDED skill's name wears the same gold outline (text keeps its category colour). */
.pg-roster-skill[data-added='true'] { padding: 0 0.3em; border-radius: 3px; box-shadow: 0 0 0 1px #e6b422; } /* a shadow, not a border: the row keeps its height */
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
/* Owner 10-10: the "Hide innate skills" box - the team count's small muted text, in the pane's bottom-right corner
   (margin-left: auto works in the plain block pane and in the fill / pop-out flex columns alike). It never shrinks (the
   LIST gives way) and scales with the pop-out through its em sizes. */
.pg-roster-innate { flex: 0 0 auto; width: fit-content; margin-left: auto; display: flex; align-items: center; gap: 0.45em; margin-top: calc(6px * var(--roster-scale)); font-size: max(var(--ui-min-text-size, 12px), 0.8em); font-weight: 700; line-height: 1.2; color: var(--ui-muted); cursor: pointer; user-select: none; white-space: nowrap; }
.pg-roster-innate:hover { color: var(--ui-text); }
.pg-roster-innate input { flex: none; width: 1.1em; height: 1.1em; margin: 0; accent-color: var(--ui-accent); cursor: pointer; }
.pg-roster-innate input:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
/* Owner 10-09: an injury suffered this game = the added skill's gold box (#e6b422, the icon ring's treatment) around
   the injury badge. A shadow plus padding inside the fixed badge slot, so the row keeps its height and alignment. */
.pg-roster-inj-img[data-new='true'], .pg-roster-rip[data-new='true'] { box-sizing: border-box; padding: 0.12em 0.2em; border-radius: 3px; box-shadow: 0 0 0 1px #e6b422, inset 0 0 0 1px rgb(0 0 0 / 55%); }
.pg-roster-lvl-text.pg-roster-inj-text[data-new='true'] { box-shadow: 0 0 0 1px #e6b422, 0 0.14em 0 #5a0000, inset 0 -0.16em 0 #3a2a5c; }
/* Owner 10-09: the end-game MVP panels are this roster with the team fixed. One header block across the panel. */
.pg-roster-team-toggle--fixed { grid-template-columns: minmax(0, 1fr); }
.pg-roster-team-toggle--fixed .pg-roster-team-tab { cursor: default; }
/* `fill`: the list takes what is left of the parent's height and scrolls; whatever sits in the footer slot stays put. */
.pg-roster--fill { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; box-sizing: border-box; }
.pg-roster--fill .pg-roster-team { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.pg-roster--fill .pg-roster-list { flex: 1 1 auto; min-height: 0; max-height: none; }
/* `twoLine`: a forced break after the position (an empty full-width flex item), the rest of the row ordered after it. */
.pg-roster--two-line .pg-roster-list { overflow-x: hidden; }
.pg-roster--two-line .pg-roster-list li { flex-wrap: wrap; row-gap: 2px; }
.pg-roster--two-line .pg-roster-list li::after { content: ''; flex: 0 0 100%; height: 0; order: 1; }
.pg-roster--two-line .pg-roster-skills, .pg-roster--two-line .pg-roster-value, .pg-roster--two-line .pg-roster-spp { order: 2; }
.pg-roster--two-line .pg-roster-pos { flex: 1 1 auto; }
/* Selectable rows (nomination): the offered players are click targets, the rest are dimmed and inert. */
.pg-roster-list li[data-eligible] { padding-left: calc(8px * var(--roster-scale)); padding-right: calc(8px * var(--roster-scale)); }
.pg-roster-list li[data-eligible='true'] { cursor: pointer; }
.pg-roster-list li[data-eligible='true']:hover { background: var(--ui-hover); }
.pg-roster-list li[data-eligible='false'] { opacity: 0.45; }
.pg-roster-list li[data-checked='true'] { background: var(--ui-hover); box-shadow: inset 3px 0 0 var(--ui-accent); }
/* The check mark lives in the badge column: the slot grows by the mark's width and the mark sits at its right edge, so
   it lines up down the list whether the row has a LVL badge, an injury badge or nothing. */
.pg-roster-lvl[data-pick='true'] { width: 5.5em; gap: 0.3em; }
/* One drawn mark for the checkbox and the radio: an empty box when offered, a tick on the accent when picked. */
.pg-roster-check {
  appearance: none; -webkit-appearance: none; flex: none; box-sizing: border-box; width: 1.45em; height: 1.45em; margin: 0 0 0 auto;
  border: 2px solid color-mix(in srgb, var(--ui-text) 70%, transparent); border-radius: 4px; background: rgb(0 0 0 / 35%) center / 86% no-repeat; cursor: pointer;
}
.pg-roster-check:checked {
  border-color: var(--ui-accent); background-color: var(--ui-accent);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3 8.5l3.2 3.2L13 4.6' fill='none' stroke='%23000' stroke-width='4.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M3 8.5l3.2 3.2L13 4.6' fill='none' stroke='%23fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
}
.pg-roster-check:disabled { cursor: default; opacity: 0.4; border-style: dashed; }
/* Keyboard focus: a ring on the box and a lit row (theme tokens only, so both HUD styles carry it). */
.pg-roster-check:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.pg-roster-list li:has(.pg-roster-check:focus-visible) { background: var(--ui-hover); outline: 1px solid var(--ui-accent); outline-offset: -1px; }
/* The awarded MVP: an accent bar and a starred tag after the name. */
.pg-roster-list li[data-mvp='true'] { padding-left: calc(8px * var(--roster-scale)); padding-right: calc(8px * var(--roster-scale)); background: color-mix(in srgb, var(--ui-accent) 14%, transparent); box-shadow: inset 3px 0 0 var(--ui-accent); }
.pg-roster-mvp { flex: 0 0 auto; white-space: nowrap; color: var(--ui-accent); font-weight: 800; }
.pg-roster-mvp i { font-style: normal; }
/* The old nomination list's look (.mvp-nominate-spp / -gain): the bank in the text colour, the gain green and a step smaller. */
.pg-roster-spp--bank { min-width: 7em; white-space: nowrap; color: var(--ui-text); }
.pg-roster-team-tag { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 0.4em; border: 1px solid var(--ui-border); border-radius: 3px; font-size: 0.8em; color: var(--ui-muted); }
.pg-roster-spp-gain { color: var(--ui-success); font-size: max(var(--ui-min-text-size, 12px), 0.85em); }
</style>
