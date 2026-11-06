<script setup lang="ts">
/**
 * Owner 09-25: the END-OF-GAME pane (Result window + MVP / Statistics / Roster tabs + the Dice overlay), lifted
 * out of SpectateView.vue so it renders from a PostGameSnapshot: live (SpectateView builds it from the store as
 * the game settles) or cached (the Play blade's Details popup, game/postGameCache.ts). Every ruling in the
 * markup/CSS is carried over verbatim; live-only motion (the MVP roulette) arrives through `mvpRoll`.
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import D6Face from './D6Face.vue';
import { blockDieFaceArt, markBlockDiePackFaceFailed } from '../game/blockDieFaceArt';
import PlayerDetailSkillList from './PlayerDetailSkillList.vue';
import PostGameRoster from './PostGameRoster.vue';
import RosterBadge from './RosterBadge.vue';
import { formatPlayerValue } from '../game/playerValue';
import { settings } from '../game/settings';
import { lmGameRootClass } from '../game/lmTheme';
import { DICE_EXPECTED_HELP, DICE_EXPECTED_HELP_LABEL } from '../game/diceExpectedHelp';
import { luckChart } from '../game/luckChart';
import { gameStatRows } from '../game/gameStatRows';
import type { SkillIconStyle } from '@fumbbl40k/ffb-pitch';
import {
  PG_CHART_BASE, PG_CHART_H, PG_CHART_TOP, PG_CHART_W, PG_GAUGE_AREA, PG_GAUGE_CURVE, mvpAwardEntries, mvpCardFor, mvpConcededSides, pgDiceCoverage, pgDiceSide, pgGaugeAria, pgGaugeReading, pgGaugeTitle, pgGaugeX, pgHasMarker, pgOddsSentence, pgPlayerDetail, pgTeamBreaks,
  postGamePublic, type PgLikelihoodRow, type PgMvpCard, type PostGameSnapshot, type Side,
} from '../game/postGameProjection';
import { $t, terms } from '../i18n';

export type MvpRoll = { phase: 'awaiting' | 'cycling' | 'landed' | 'none'; display: string };

/** S71: block-die face label size (chart units) and the extra chart height it needs below the axis. */
const PG_BLOCK_FACE = 18;
const PG_BLOCK_FACE_EXTRA = 10;
const props = withDefaults(defineProps<{
  snapshot: PostGameSnapshot;
  /** the Stats/MVP window (finalPostGameVisible in SpectateView); false = the spectate seat's MVP-pending slot */
  showStats?: boolean;
  /** live roulette state; absent (cached) ⇒ landed on the server award / none */
  mvpRoll?: { home: MvpRoll; away: MvpRoll } | null;
  /** #235: roster is a one-team view, defaulted to the viewer's own side */
  defaultRosterSide?: Side;
  /** Owner 10-02: the local coach's side ("(You)" on the roster team switch); null for a spectator / replay */
  localSide?: Side | null;
  /** live renderer portraits; falls back to the snapshot's captured ones */
  portraitFor?: ((playerId: string) => string | null) | null;
  skillMode?: 'icons' | 'markings';
  iconStyle?: SkillIconStyle;
  /** inside a blade popup: no viewport overlay / zoom ladder, the windows stack in normal flow */
  embedded?: boolean;
}>(), { showStats: true, mvpRoll: null, defaultRosterSide: 'home', localSide: null, portraitFor: null, skillMode: 'icons', iconStyle: 'bb3', embedded: false });

const game = computed(() => props.snapshot.game);
const stats = computed(() => props.snapshot.endGameStats);
// Owner 10-03 ("the end-game MVP never arrives in spectator mode"): the game object is updated IN PLACE, so a computed
// keyed on `game` (same reference every time) never re-ran - a panel mounted before the awards arrived (the spectator's
// "selecting MVP" surface) kept its empty MVP list, zero SPP and old stats for good. Read through the SNAPSHOT prop,
// which the view replaces on every model update.
const pg = computed(() => postGamePublic(props.snapshot.game)!);
const pgStatRows = computed(() => gameStatRows(props.snapshot.game, props.snapshot.tallies));
const pgMvpConceded = computed(() => mvpConcededSides(props.snapshot.game, props.snapshot.endGameStats));
const roll = computed<{ home: MvpRoll; away: MvpRoll }>(() => props.mvpRoll ?? {
  home: pg.value.home.mvps.length ? { phase: 'landed', display: pg.value.home.mvps[0]!.name } : { phase: 'none', display: '' },
  away: pg.value.away.mvps.length ? { phase: 'landed', display: pg.value.away.mvps[0]!.name } : { phase: 'none', display: '' },
});
function portrait(playerId: string): string | null {
  if (!playerId) return null;
  return props.portraitFor?.(playerId) ?? props.snapshot.portraits[playerId] ?? null;
}

// the MVP-nominate Continue (SpectateView) lands on Statistics — the phase is a model the parent may drive
const postGamePhase = defineModel<'mvp' | 'stats' | 'roster'>('phase', { default: 'mvp' });
/** Owner 11-05: the tab pane slides toward the tab picked - forward (from the right) for a tab further along, back
 *  (from the left) for an earlier one. */
const PG_TAB_ORDER = ['mvp', 'stats', 'roster'] as const;
const pgTabMotion = ref<'pg-tab-fwd' | 'pg-tab-back'>('pg-tab-fwd');
/** Sol r2: the pane fading out takes no focus or clicks while it overlaps the new one. */
function pgTabLeaving(el: Element): void { el.setAttribute('inert', ''); }
watch(postGamePhase, (next, prev) => {
  pgTabMotion.value = PG_TAB_ORDER.indexOf(next) >= PG_TAB_ORDER.indexOf(prev) ? 'pg-tab-fwd' : 'pg-tab-back';
}, { flush: 'sync' });
// Owner 09-17: the Dice tab opens its own PANE (an overlay with an X): distributions left, the likelihood graphs
// top right, fun facts bottom right. A header selector picks whose distributions fill the left column.
const diceModalOpen = ref(false);
const diceSide = ref<Side>('home');
/** Owner 11-05: a third header tab shows BOTH teams side by side - Likelihood on top, distributions below (home left,
 *  blue; away right, red). Fun facts stay in the one-team view. */
const diceBoth = ref(false);
const selectedRosterTeam = ref<Side>(props.defaultRosterSide);
watch(() => props.snapshot.key, () => {
  postGamePhase.value = 'mvp'; diceModalOpen.value = false; diceSide.value = 'home'; diceBoth.value = false;
  selectedRosterTeam.value = props.defaultRosterSide;
});
watch(() => props.defaultRosterSide, (s) => { selectedRosterTeam.value = s; });
/** Owner 10-10: a broken PACK face image on the Block dice chart falls back to the bundled symbol. */
function onBlockFaceImageError(value: number): void {
  const art = blockDieFaceArt(value);
  if (art?.pack) markBlockDiePackFaceFailed(art.url);
}
watch(() => props.showStats, (on) => { if (!on) diceModalOpen.value = false; }); // owner 09-17: the Dice pane closes with the end screen

/** Owner 09-14: a CONCESSION hands the winner two MVPs and every one shows. Owner 10-12: ONE CARD PER AWARD, not per
 *  player ("display that MVP twice ... no need to dedupe"): a player the server awarded twice gets two identical cards,
 *  side by side in the list. Different players stand in roster-number order. */
type PgMvpAwardCard = PgMvpCard & { key: string };
const pgMvpCardList = computed<Record<Side, PgMvpAwardCard[]>>(() => {
  const out: Record<Side, PgMvpAwardCard[]> = { home: [], away: [] };
  for (const side of ['home', 'away'] as const) {
    const cards = new Map<string, PgMvpCard | null>();
    for (const m of pg.value[side].mvps) if (!cards.has(m.playerId)) cards.set(m.playerId, mvpCardFor(game.value, side, m.playerId, portrait(m.playerId)));
    out[side] = mvpAwardEntries(pg.value[side].mvps)
      .flatMap((award) => { const card = cards.get(award.playerId); return card ? [{ ...card, key: award.key }] : []; })
      .sort((a, b) => a.nr - b.nr); // stable: one player's cards keep their award order, together
  }
  return out;
});
// Owner 10-10 ("I'm seeing players twice on this pane"): the MVP tab lists each awarded player ONCE, as the portrait
// card. PostGameRoster still draws each team's header (and hosts the one "Hide innate skills" box), but with no rows:
// the row's injury / LVL badge and the player's value moved onto the card.
const PG_MVP_NO_ROWS: readonly string[] = [];
/** The card's skill chips follow the roster panes' shared "Hide innate skills" box (settings.rosterHideInnateSkills):
 *  on = the position's own skills are left out (the per-chip `innate` flag, skillDisplay playerRosterSkills). */
function mvpCardSkills(card: PgMvpCard): PgMvpCard['skills'] {
  return settings.rosterHideInnateSkills ? card.skills.filter((skill) => !skill.innate) : card.skills;
}
const pgDice = computed(() => ({
  home: pgDiceSide(props.snapshot.tallies.home, pg.value.home, game.value.teamHome.teamName),
  away: pgDiceSide(props.snapshot.tallies.away, pg.value.away, game.value.teamAway.teamName),
}));
const pgDiceNote = computed(() => pgDiceCoverage(props.snapshot));
const pgDiceSelected = computed(() => (diceSide.value === 'home' ? pgDice.value.home : pgDice.value.away));
/** The columns the pane draws: the selected team, or both (home first). */
const diceCols = computed(() => (diceBoth.value
  ? [{ side: 'home' as Side, data: pgDice.value.home }, { side: 'away' as Side, data: pgDice.value.away }]
  : [{ side: diceSide.value, data: pgDiceSelected.value }]));
const dedFansMod = (mod: number) => (mod > 0 ? '+' + mod : String(mod));

// Owner 10-10: the numbers behind each Likelihood row moved off the row into a popover on an "i" beside the row title.
// It opens on hover and on keyboard focus, a click PINS it (so it survives the pointer leaving); Escape, a click
// anywhere else, a scroll or a resize closes it; one at a time. It reuses the app's teleported, viewport-fixed bubble
// (PlayerDetailSkillList's .skill-tip): the Likelihood block scrolls, so anything positioned inside it would be clipped.
type PgLikelihoodKey = PgLikelihoodRow['key'];
const DICE_TIP_MARGIN = 8;
const DICE_TIP_GAP = 7;
const diceTip = reactive<{ key: PgLikelihoodKey | null; pinned: boolean; left: number; top: number; below: boolean; maxHeight?: number | null }>({
  key: null, pinned: false, left: 0, top: 0, below: true,
});
const diceTipEl = ref<HTMLElement | null>(null);
let diceTipAnchor: HTMLElement | null = null;
const diceTipRow = computed(() => pgDiceSelected.value.likelihoods.find((r) => r.key === diceTip.key) ?? null);
const diceTipId = (key: PgLikelihoodKey) => `pg-dice-tip-${key}`;
function placeDiceTip(): void {
  const el = diceTipEl.value;
  if (!el || !diceTipAnchor) return;
  const icon = diceTipAnchor.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  // the content's own height (a cap set by an earlier placement must not hide that it would now fit)
  const natural = Math.max(box.height, el.scrollHeight || 0);
  const vw = window.innerWidth, vh = window.innerHeight;
  // Astra 10-22: on the Luck row the title area has a second line ("By turn" under the label) - the popover goes under
  // the whole title area there, so it never covers (and swallows clicks on) that button
  const head = diceTipAnchor.parentElement;
  const bottom = head?.dataset.chart === 'true' ? Math.max(icon.bottom, head.getBoundingClientRect().bottom) : icon.bottom;
  // under the icon when it fits, else above it. Astra 10-22 r2: when it fits on neither side it takes the roomier one,
  // capped to that room (its content scrolls), so it is never clamped back over the title area and "By turn"
  const roomBelow = vh - DICE_TIP_MARGIN - (bottom + DICE_TIP_GAP);
  const roomAbove = icon.top - DICE_TIP_GAP - DICE_TIP_MARGIN;
  const fitsBelow = natural <= roomBelow, fitsAbove = natural <= roomAbove;
  const below = fitsBelow || (!fitsAbove && roomBelow >= roomAbove);
  const room = Math.max(0, below ? roomBelow : roomAbove);
  diceTip.maxHeight = fitsBelow || fitsAbove ? null : room;
  const height = Math.min(natural, room);
  diceTip.below = below;
  diceTip.top = below ? bottom + DICE_TIP_GAP : icon.top - DICE_TIP_GAP - height;
  // its left edge starts at the row title (not centred on the icon), so it never spills over the distribution column
  const start = (diceTipAnchor.parentElement ?? diceTipAnchor).getBoundingClientRect().left;
  diceTip.left = Math.max(DICE_TIP_MARGIN, Math.min(start, vw - DICE_TIP_MARGIN - box.width));
}
function openDiceTip(key: PgLikelihoodKey, anchor: HTMLElement, pinned: boolean): void {
  cancelDiceTipLeave(); // Astra r2: a close pending from a hover-opened popover must not take this one down
  const icon = anchor.getBoundingClientRect();
  diceTipAnchor = anchor;
  diceTip.key = key; diceTip.pinned = pinned;
  diceTip.left = icon.left; diceTip.top = icon.bottom + DICE_TIP_GAP; diceTip.below = true; diceTip.maxHeight = null; // provisional; placed once measured
  void nextTick(placeDiceTip);
}
function closeDiceTip(): void { cancelDiceTipLeave(); diceTip.key = null; diceTip.pinned = false; diceTipAnchor = null; diceTipName.value = null; }
/** Owner 10-17: the one name chip whose detail is shown inline ("i:j" = line : part); a click on it again hides it. */
const diceTipName = ref<string | null>(null);
function toggleDiceTipName(key: string): void {
  diceTipName.value = diceTipName.value === key ? null : key;
  diceTip.pinned = true; // the coach is reading the popover: it stays until dismissed
  void nextTick(placeDiceTip); // the detail may change the popover's height
}
function onDiceInfoEnter(key: PgLikelihoodKey, event: Event): void {
  cancelDiceTipLeave();
  if (diceTip.pinned) return; // a pinned popover stays until it is dismissed
  if (diceTip.key === key) return; // back on the same "i" within the grace: nothing to reopen
  openDiceTip(key, event.currentTarget as HTMLElement, false);
}
/** Astra 10-17: a hover-opened popover used to close the instant the pointer left the "i", so its name chips could
 *  never be reached. Leaving the "i" (or the popover) now schedules the close; entering either cancels it. */
const DICE_TIP_LEAVE_GRACE_MS = 350;
let diceTipLeaveTimer: ReturnType<typeof setTimeout> | null = null;
function cancelDiceTipLeave(): void { if (diceTipLeaveTimer) { clearTimeout(diceTipLeaveTimer); diceTipLeaveTimer = null; } }
function scheduleDiceTipLeave(): void {
  cancelDiceTipLeave();
  diceTipLeaveTimer = setTimeout(() => { diceTipLeaveTimer = null; if (diceTip.key !== null && !diceTip.pinned) closeDiceTip(); }, DICE_TIP_LEAVE_GRACE_MS);
}
function onDiceInfoLeave(key: PgLikelihoodKey): void { if (diceTip.key === key && !diceTip.pinned) scheduleDiceTipLeave(); }
function onDiceTipPointerEnter(): void { cancelDiceTipLeave(); }
function onDiceTipPointerLeave(): void { if (!diceTip.pinned) scheduleDiceTipLeave(); }
let diceTipRefocus = false;
function onDiceInfoFocus(key: PgLikelihoodKey, event: Event): void {
  cancelDiceTipLeave(); // Astra r2: focus returning to the "i" within the grace keeps its popover
  if (diceTip.key === key || diceTipRefocus) return; // (Astra chart r3: focus handed back by Escape does not reopen it)
  openDiceTip(key, event.currentTarget as HTMLElement, false); // keyboard focus moving to another row's icon replaces a pinned one
}
function onDiceInfoBlur(key: PgLikelihoodKey, event?: FocusEvent): void {
  if (diceTip.key !== key) return;
  // owner 10-16: focus moving INTO the popover (its name chips) keeps it open, pinned
  const next = event?.relatedTarget as Node | null | undefined;
  if (next && diceTipEl.value?.contains(next)) { diceTip.pinned = true; return; }
  closeDiceTip();
}
/** Owner 10-16 (Astra chart r1 B1): Tab from an "i" goes into its popover (the popover is teleported after the pane, so
 *  the natural Tab order would skip it and close it). Owner 10-22: "By turn" left the popover for the Luck row itself, so
 *  the popover's focusable controls are only the name chips of its lines (Astra 10-17); with none, Tab is the browser's. */
const diceTipFocusables = (): HTMLElement[] => Array.from(diceTipEl.value?.querySelectorAll<HTMLElement>('.pg-dice-tip-name') ?? []);
function onDiceInfoKeydown(key: PgLikelihoodKey, event: KeyboardEvent): void {
  if (event.key !== 'Tab' || event.shiftKey || diceTip.key !== key) return;
  const first = diceTipFocusables()[0];
  if (!first) return;
  event.preventDefault();
  diceTip.pinned = true;
  first.focus();
}
/** Inside the popover (a name chip): Tab moves along the chips; from the last, Tab goes on to the pane's next row control
 *  after the row's own "i" - the Luck row's "By turn" button, else the next row's "i" - closing the popover; from the
 *  first, Shift+Tab goes back to the row's own "i". */
function onDiceTipChipKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const controls = diceTipFocusables();
  const at = controls.indexOf(event.currentTarget as HTMLElement);
  if (at < 0) return;
  if (event.shiftKey ? at > 0 : at < controls.length - 1) return; // the next / previous control is the natural Tab stop
  const icons = Array.from(document.querySelectorAll<HTMLElement>('.pg-dice-gauge-row .pg-dice-info, .pg-dice-gauge-row .pg-luck-chart-btn'));
  const own = diceTipAnchor ? icons.indexOf(diceTipAnchor) : icons.findIndex((el) => el.classList.contains('pg-dice-info') && el.closest(`[data-row="${diceTip.key}"]`));
  if (own < 0) return;
  event.preventDefault();
  if (event.shiftKey) { icons[own]!.focus(); return; }
  closeDiceTip();
  icons[own + 1]?.focus();
}
function onDiceInfoClick(key: PgLikelihoodKey, event: Event): void {
  if (diceTip.key === key && diceTip.pinned) { closeDiceTip(); return; }
  openDiceTip(key, event.currentTarget as HTMLElement, true);
}
function onDiceTipPointerDown(event: Event): void {
  const target = event.target as Node | null;
  if (target && (diceTipAnchor?.contains(target) || diceTipEl.value?.contains(target))) return;
  closeDiceTip();
}
function onDiceTipKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.stopPropagation(); // Escape closes the popover only, not whatever is behind it
  event.preventDefault();
  // Astra chart r2: focus inside the popover (a name chip) goes back to the "i" it belongs to
  const anchor = diceTipAnchor;
  const inside = !!diceTipEl.value && diceTipEl.value.contains(document.activeElement);
  closeDiceTip();
  if (inside && anchor) { diceTipRefocus = true; try { anchor.focus(); } finally { diceTipRefocus = false; } }
}
/** Scrolling the pane or the window closes the popover; Astra 10-22 r3: scrolling the popover's own (capped) content does not. */
function onDiceTipOuterScroll(event: Event): void {
  const target = event.target;
  if (target instanceof Node && diceTipEl.value?.contains(target)) return;
  closeDiceTip();
}
// The document listeners live only while a popover is open.
function listenForDiceTipDismiss(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) {
    document.addEventListener('pointerdown', onDiceTipPointerDown, true);
    document.addEventListener('keydown', onDiceTipKeyDown, true);
    window.addEventListener('scroll', onDiceTipOuterScroll, true);
    window.addEventListener('resize', closeDiceTip);
  } else {
    document.removeEventListener('pointerdown', onDiceTipPointerDown, true);
    document.removeEventListener('keydown', onDiceTipKeyDown, true);
    window.removeEventListener('scroll', onDiceTipOuterScroll, true);
    window.removeEventListener('resize', closeDiceTip);
  }
}
watch(() => diceTip.key !== null, listenForDiceTipDismiss, { flush: 'sync' });
watch([diceModalOpen, diceSide, diceBoth, () => props.showStats], closeDiceTip);

// Owner 10-16: the LUCK CHART - a "By turn" button (owner 10-22: on the Luck row, under its label) opens a subpane inside
// the dice pane plotting each team's net luck per team turn (dashed) and its running average (solid) - game/luckChart.ts.
// Escape or its close button hands focus back to that button; Tab stays inside the subpane while it is open.
const luckChartOpen = ref(false);
const luckPaneEl = ref<HTMLElement | null>(null);
const luckHover = ref<number | null>(null);
const luckChartData = computed(() => {
  const td = (side: 'home' | 'away') => Number((side === 'home' ? game.value.turnDataHome : game.value.turnDataAway)?.turnNr) || 0;
  const half = Number(game.value.half) || 0;
  return luckChart(props.snapshot.tallies.home ? pgTeamBreaks(props.snapshot.tallies.home) : null, props.snapshot.tallies.away ? pgTeamBreaks(props.snapshot.tallies.away) : null,
    half >= 1 ? { half, turnHome: td('home'), turnAway: td('away') } : null,
    { home: pg.value.home.coach || game.value.teamHome.teamName, away: pg.value.away.coach || game.value.teamAway.teamName },
    { home: props.snapshot.tallies.home?.cutShort?.log ?? [], away: props.snapshot.tallies.away?.cutShort?.log ?? [] });
});
const luckHoverSlot = computed(() => (luckHover.value == null ? null : luckChartData.value.slots[luckHover.value] ?? null));
function openLuckChart(): void {
  closeDiceTip();
  luckHover.value = null;
  luckChartOpen.value = true;
  void nextTick(() => luckPaneEl.value?.querySelector<HTMLElement>('.pg-luck-close')?.focus());
}
function closeLuckChart(back = true): void {
  if (!luckChartOpen.value) return;
  luckChartOpen.value = false;
  luckHover.value = null;
  if (!back) return;
  void nextTick(() => {
    // owner 10-22: back to the control that opened it - the Luck row's "By turn" (the "i" if the button is gone)
    const back = document.querySelector<HTMLElement>('.pg-dice-gauge-row[data-row="luck"] .pg-luck-chart-btn')
      ?? document.querySelector<HTMLElement>('.pg-dice-gauge-row[data-row="luck"] .pg-dice-info');
    back?.focus();
  });
}
function onLuckPaneKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); closeLuckChart(); return; }
  if (event.key !== 'Tab' || !luckPaneEl.value) return;
  const stops = Array.from(luckPaneEl.value.querySelectorAll<HTMLElement>('button, [tabindex="0"]'));
  if (stops.length === 0) return;
  const first = stops[0]!, last = stops[stops.length - 1]!;
  const at = document.activeElement;
  if (event.shiftKey && (at === first || !luckPaneEl.value.contains(at))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (at === last || !luckPaneEl.value.contains(at))) { event.preventDefault(); first.focus(); }
}
watch([diceModalOpen, diceSide, diceBoth, () => props.showStats], () => closeLuckChart(false));
onBeforeUnmount(() => { closeDiceTip(); listenForDiceTipDismiss(false); });

// Owner 10-15: the "i" in the header toggles a short note on how the expected figures are worked out. Escape (which
// closes only the note) or a click anywhere else closes it; it also closes with the pane.
const diceHelpOpen = ref(false);
const diceHelpBtn = ref<HTMLElement | null>(null);
const diceHelpPop = ref<HTMLElement | null>(null);
function closeDiceHelp(): void { diceHelpOpen.value = false; }
function onDiceHelpPointerDown(event: Event): void {
  const target = event.target as Node | null;
  if (target && (diceHelpBtn.value?.contains(target) || diceHelpPop.value?.contains(target))) return;
  closeDiceHelp();
}
function onDiceHelpKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  event.preventDefault();
  closeDiceHelp();
}
watch(diceHelpOpen, (on) => {
  if (typeof document === 'undefined') return;
  if (on) {
    document.addEventListener('pointerdown', onDiceHelpPointerDown, true);
    document.addEventListener('keydown', onDiceHelpKeyDown, true);
  } else {
    document.removeEventListener('pointerdown', onDiceHelpPointerDown, true);
    document.removeEventListener('keydown', onDiceHelpKeyDown, true);
  }
}, { flush: 'sync' });
watch([diceModalOpen, () => props.showStats], closeDiceHelp);
onBeforeUnmount(() => { closeDiceHelp(); });

defineExpose({ openDice: () => { diceModalOpen.value = true; } });
</script>

<template>
  <div class="postgame" :data-embedded="embedded">
    <!-- Window 1: RESULT (always shown, on top) -->
    <div class="pg-window pg-window-result">
      <header class="pg-head">
        <span class="pg-title">{{ $t('cards.postGamePanel.endOfGame') }}</span>
        <!-- Owner 2026-07-15: no manual close — the end-game panel persists over the cleared board until a
             NEW game starts. Owner 09-23: Return to Menu lives in the exit bar under the tab card (slot). -->
      </header>
      <section class="pg-result">
        <div class="pg-team pg-bevel" :class="{ winner: pg.winner === pg.home }">
          <img v-if="pg.home.logo" :src="pg.home.logo" alt="" />
          <div class="pg-team-name">{{ pg.home.team }}</div>
          <div class="pg-team-coach">{{ pg.home.coach }}</div>
          <!-- Owner 09-14: winnings + dedicated fans live in a lifted box under the team card; no team name repeated. -->
          <div v-if="stats" class="pg-team-box pg-bevel">
            <span v-if="stats.winningsHome != null" class="pg-endstat-gold">{{ $t('cards.postGamePanel.pgTeamBox.p0GWinnings', { p0: stats.winningsHome.toLocaleString() }) }}</span>
            <span v-if="stats.dedFans" class="pg-endstat-fans">{{ $t('cards.postGamePanel.pgTeamBox.dedicatedFansRolled') }} <D6Face v-if="stats.dedFans.concededTeamId !== game.teamHome.teamId" class="pg-endstat-d6" :value="stats.dedFans.rollHome" :label="$t('cards.postGamePanel.pgTeamBox.rolledRollhome', { rollHome: stats.dedFans.rollHome })" /><span v-else>{{ stats.dedFans.rollHome }}</span> → {{ dedFansMod(stats.dedFans.modHome) }}</span>
            <span v-else class="pg-endstat-fans muted">{{ $t('cards.postGamePanel.pgTeamBox.dedicatedFansUnchanged') }}</span>
          </div>
        </div>
        <!-- Owner 09-15: no verdict line under the score — the winner card's highlight already says it. -->
        <div class="pg-scoreline pg-bevel" :title="pg.draw ? $t('cards.postGamePanel.draw') : $t('cards.postGamePanel.p0Wins', { p0: pg.winner?.team })">
          <div class="pg-score">{{ pg.home.score }}<span>–</span>{{ pg.away.score }}</div>
        </div>
        <div class="pg-team pg-bevel" :class="{ winner: pg.winner === pg.away }">
          <img v-if="pg.away.logo" :src="pg.away.logo" alt="" />
          <div class="pg-team-name">{{ pg.away.team }}</div>
          <div class="pg-team-coach">{{ pg.away.coach }}</div>
          <div v-if="stats" class="pg-team-box pg-bevel">
            <span v-if="stats.winningsAway != null" class="pg-endstat-gold">{{ $t('cards.postGamePanel.pgTeamBox.p0GWinnings', { p0: stats.winningsAway.toLocaleString() }) }}</span>
            <span v-if="stats.dedFans" class="pg-endstat-fans">{{ $t('cards.postGamePanel.pgTeamBox.dedicatedFansRolled') }} <D6Face v-if="stats.dedFans.concededTeamId !== game.teamAway.teamId" class="pg-endstat-d6" :value="stats.dedFans.rollAway" :label="$t('cards.postGamePanel.pgTeamBox.rolledRollaway', { rollAway: stats.dedFans.rollAway })" /><span v-else>{{ stats.dedFans.rollAway }}</span> → {{ dedFansMod(stats.dedFans.modAway) }}</span>
            <span v-else class="pg-endstat-fans muted">{{ $t('cards.postGamePanel.pgTeamBox.dedicatedFansUnchanged') }}</span>
          </div>
        </div>
      </section>
      <!-- #140 (owner concede consequence): the DEFECTORS reveal on the PERSISTENT end-screen. Only when someone
           actually defected. Names WHICH players walked (the concede notice named WHO conceded). -->
      <div v-if="snapshot.defectors && snapshot.defectors.length" class="pg-defectors">
        <b>{{ snapshot.defectors.length }}</b> {{ $t('cards.postGamePanel.playerP0DefectedAfter', { n: snapshot.defectors.length }) }}
        <span class="pg-defector-names">{{ snapshot.defectors.join(', ') }}</span>
      </div>
    </div>

    <!-- Window 2: STATS / MVP (tabbed, below) — only once the server's data has landed + settled. -->
    <div v-if="showStats" class="pg-window pg-window-stats">
      <!-- Owner 09-15 (3rd): no "Statistics & MVP" title — the tab blades sit centred in the header. -->
      <header class="pg-head pg-head-tabs">
        <nav class="pg-tabs">
          <button :data-active="postGamePhase === 'mvp'" @click="postGamePhase = 'mvp'">{{ $t('cards.postGamePanel.mvp') }}</button>
          <button :data-active="postGamePhase === 'stats'" @click="postGamePhase = 'stats'">{{ $t('cards.postGamePanel.statistics') }}</button>
          <button :data-active="postGamePhase === 'roster'" @click="postGamePhase = 'roster'">{{ $t('cards.postGamePanel.roster') }}</button>
          <button :data-active="diceModalOpen" @click="diceModalOpen = true">{{ $t('cards.postGamePanel.dice') }}</button>
        </nav>
      </header>

      <!-- Owner 11-05: switching tabs fades and slides (~12px toward the tab picked) instead of popping; off with reduced
           motion (the OS setting or Settings > Reduce motion). -->
      <Transition :name="pgTabMotion" @before-leave="pgTabLeaving">
      <!-- Phase: MVP (server-decided award, see postGameSide's `mvps`) -->
      <section v-if="postGamePhase === 'mvp'" class="pg-mvp">
        <!-- Owner 10-10: each team column is the roster pane's team header (PostGameRoster pinned to the team, no rows,
             no team switch) over the awarded player's portrait card(s). A player is listed ONCE: the 10-09 roster row is
             gone from this tab and the card carries its injury / LVL badge and the player's value. -->
        <div v-for="side in [pg.home, pg.away]" :key="side.which" class="pg-mvp-team" :data-side="side.which">
          <PostGameRoster class="pg-mvp-roster" :side="side.which" :switcher="false" :teams="pg" :portrait="portrait" :local-side="localSide"
            :skill-mode="skillMode" :icon-style="iconStyle" :only-ids="PG_MVP_NO_ROWS" :innate-toggle="side.which === 'away'">
            <template #status>
              <template v-if="roll[side.which].phase === 'cycling' || side.mvps.length" />
              <p v-else-if="roll[side.which].phase === 'none'" class="pg-mvp-none">{{ pgMvpConceded[side.which] ? $t('cards.postGamePanel.noMvpConceded') : $t('cards.postGamePanel.noMvpAwarded') }}</p>
              <p v-else class="pg-mvp-none pg-mvp-awaiting">{{ $t('cards.postGamePanel.awaitingResult') }}</p>
            </template>
            <template v-if="roll[side.which].phase === 'cycling' || pgMvpCardList[side.which].length" #footer>
            <!-- While the roulette spins the awarded card(s) are laid out but not shown (data-pending): the column already
                 has its final height, so nothing moves when the roulette lands. -->
            <div class="pg-mvp-cards" :data-pending="roll[side.which].phase === 'cycling' ? 'true' : null">
              <!-- #25-v2 (owner 2026-07-14): active reveal. ⚖ the roulette lands on side.mvps (the SERVER award). -->
              <div v-if="roll[side.which].phase === 'cycling'" class="pg-mvp-roulette" aria-live="polite">
                <span class="pg-star">★</span>
                <span class="pg-mvp-name pg-mvp-spin">{{ roll[side.which].display }}</span>
              </div>
              <!-- Owner 09-14: the selected winner's in-game portrait card, lifted onto the end screen; a concession
                   hands the winner two MVPs and BOTH cards show. -->
              <div v-for="card in pgMvpCardList[side.which]" :key="card.key" class="pg-mvp-card pg-bevel" :data-player="card.playerId"
                :aria-hidden="roll[side.which].phase === 'cycling' ? 'true' : undefined">
                <div class="pg-mvp-portrait card-portrait">
                  <img v-if="card.portrait" :src="card.portrait" alt="" />
                  <span v-else class="portrait-missing">{{ $t('cards.postGamePanel.pgMvpCard.noPortrait') }}</span>
                </div>
                <div class="pg-mvp-card-info">
                  <!-- Owner 10-10: the roster row's badge, right of the name: the injury (gold box when suffered this game),
                       else the LVL badge; nothing for an uninjured rookie. -->
                  <div class="pg-mvp-card-head">
                    <div class="pg-mvp-card-name" :data-side="side.which">#{{ card.nr }} {{ card.name }}</div>
                    <RosterBadge class="pg-mvp-card-badge" :injury="card.injury" :injury-new="card.injuryNew" :advancements="card.advancements" />
                  </div>
                  <!-- Owner 10-12: a second award is a second card, so no card carries an "MVP xN" count. -->
                  <div class="pg-mvp-card-pos">{{ terms(card.position) }}</div>
                  <!-- Owner 09-14: SPP on its own line under the position (the one-liner wrapped mid-tag). -->
                  <!-- Owner 10-10: the player's value at the line's right end, in the roster's value style. -->
                  <div class="pg-mvp-card-spp"><span class="card-spp">{{ $t('cards.postGamePanel.pgMvpCard.sppSpp', { spp: card.spp }) }}</span><span v-if="card.sppGain > 0" class="card-spp-gain"> +{{ card.sppGain }}</span><span
                    v-if="formatPlayerValue(card.value)" class="pg-mvp-card-value" :title="$t('cards.postGamePanel.pgMvpCard.playerValue')">{{ formatPlayerValue(card.value) }}</span></div>
                  <PlayerDetailSkillList v-if="mvpCardSkills(card).length" :skills="mvpCardSkills(card)" :mode="skillMode" :icon-style="iconStyle"
                    :position-id="card.positionId" :side="side.which" mark-added />
                  <!-- Owner 11-05: the level line is the card's last line, pinned to its bottom edge, so both teams' cards
                       show it level with each other however long the name wraps. -->
                  <div v-if="card.advancement" class="pg-mvp-advance">{{ card.advancement.text }}</div>
                </div>
              </div>
            </div>
            </template>
          </PostGameRoster>
        </div>
      </section>

      <!-- Phase 3: statistics -->
      <section v-else-if="postGamePhase === 'stats'" class="pg-stats">
        <!-- Owner 09-14: three lifted columns; the side is read from the header bevel (crest + side edge), not a name. -->
        <div class="pg-stats-cols">
          <div class="pg-stat-col pg-bevel" data-side="home">
            <div class="pg-stat-col-head"><img v-if="pg.home.logo" :src="pg.home.logo" :alt="pg.home.team" /><span v-else class="pg-stat-col-side">{{ $t('cards.postGamePanel.home') }}</span></div>
            <div v-for="row in pgStatRows" :key="row.key" class="pg-stat-cell pg-h" :data-lead="row.homeLead">{{ row.home }}</div>
          </div>
          <div class="pg-stat-col pg-bevel" data-side="label">
            <div class="pg-stat-col-head"></div>
            <div v-for="row in pgStatRows" :key="row.key" class="pg-stat-cell pg-stat-label">{{ row.label }}</div>
          </div>
          <div class="pg-stat-col pg-bevel" data-side="away">
            <div class="pg-stat-col-head"><img v-if="pg.away.logo" :src="pg.away.logo" :alt="pg.away.team" /><span v-else class="pg-stat-col-side">{{ $t('cards.postGamePanel.away') }}</span></div>
            <div v-for="row in pgStatRows" :key="row.key" class="pg-stat-cell pg-a" :data-lead="row.awayLead">{{ row.away }}</div>
          </div>
        </div>
      </section>

      <!-- Owner 10-02: the end-game roster lives in PostGameRoster.vue (shared with the in-game Helmet pop-out). -->
      <PostGameRoster v-else v-model:side="selectedRosterTeam" :teams="pg" :portrait="portrait" :local-side="localSide" :skill-mode="skillMode" :icon-style="iconStyle" />
      </Transition>
    </div>

    <!-- Owner 08-19: spectate-seat MVP-PENDING placeholder — sits exactly where the Statistics & MVP window will land. -->
    <div v-else class="pg-window pg-mvp-pending" role="status" aria-live="polite">
      <span class="pg-mvp-pending-dot" aria-hidden="true"></span>
      <span>{{ $t('cards.postGamePanel.playersAreSelectingMvp') }}</span>
    </div>

    <slot name="exit" />

    <!-- Owner 09-17: DICE pane — distributions left, likelihood graphs top right, fun facts bottom right. -->
    <!-- Owner 11-04: the pane takes the selected in-game style wherever the panel shows - in the game view AND in the
         Play / Replay blades' Details popups (their bodies carry the same root class) - so it carries the class itself. -->
    <Teleport to="body">
      <div v-if="diceModalOpen && showStats" class="pg-dice-modal" :class="lmGameRootClass(settings)" role="dialog" aria-modal="true" :aria-label="$t('cards.postGamePanel.pgDiceModal.diceStatistics')" @click.self="diceModalOpen = false">
        <div class="pg-dice-card pg-bevel">
          <header class="pg-dice-head">
            <span class="pg-dice-heading">
              <span class="pg-title pg-title-sub">{{ $t('cards.postGamePanel.pgDiceModal.dice') }}</span>
              <!-- Owner 10-10: a spectated game says what its dice cover - the whole game (replay data imported), or what is missing. -->
              <span v-if="pgDiceNote" class="pg-dice-coverage" :data-coverage="pgDiceNote.kind" role="note">{{ pgDiceNote.text }}</span>
            </span>
            <!-- Owner 09-17 (r3): a coach selector in the header picks whose distributions fill the left column. -->
            <div class="pg-dice-switch" role="tablist" :aria-label="$t('cards.postGamePanel.pgDiceModal.diceDistributionCoach')">
              <button v-for="side in [pgDice.home, pgDice.away]" :key="side.team" type="button" role="tab" :data-side="side === pgDice.home ? 'home' : 'away'" :aria-selected="!diceBoth && diceSide === (side === pgDice.home ? 'home' : 'away')" @click="diceSide = side === pgDice.home ? 'home' : 'away'; diceBoth = false">
                <img v-if="side.logo" :src="side.logo" alt="" /><span>{{ side.team }}</span>
              </button>
              <!-- Owner 11-05: both teams side by side -->
              <button type="button" role="tab" data-side="both" :aria-selected="diceBoth" :aria-label="$t('cards.postGamePanel.pgDiceModal.bothTeamsLabel')" @click="diceBoth = true"><span>{{ $t('cards.postGamePanel.pgDiceModal.bothTeams') }}</span></button>
            </div>
            <span class="pg-dice-actions">
              <!-- Owner 10-15: an "i" in the top-right corner folds out how the expected figures are worked out. -->
              <span class="pg-dice-help">
                <button ref="diceHelpBtn" type="button" class="pg-dice-info pg-dice-help-btn" :aria-label="DICE_EXPECTED_HELP_LABEL" :title="DICE_EXPECTED_HELP_LABEL"
                  :aria-expanded="diceHelpOpen" aria-controls="pg-dice-help-pop" :data-open="diceHelpOpen" @click="diceHelpOpen = !diceHelpOpen"><span aria-hidden="true">i</span></button>
                <div v-if="diceHelpOpen" id="pg-dice-help-pop" ref="diceHelpPop" class="pg-dice-help-pop" role="note">
                  <p v-for="line in DICE_EXPECTED_HELP" :key="line.key" :data-help="line.key">{{ line.text }}</p>
                </div>
              </span>
              <button type="button" class="pg-dice-close" :aria-label="$t('cards.postGamePanel.pgDiceModal.closeDiceStatistics')" @click="diceModalOpen = false">✕</button>
            </span>
          </header>
          <!-- Owner 10-16: the Luck chart subpane (game/luckChart.ts). -->
          <div v-if="luckChartOpen" ref="luckPaneEl" class="pg-luck-pane" role="dialog" aria-modal="true" :aria-label="$t('cards.postGamePanel.pgDiceModal.luckByTurn')" @keydown="onLuckPaneKeydown">
            <header class="pg-luck-head">
              <b class="pg-luck-title">{{ $t('cards.postGamePanel.pgDiceModal.luckByTurn') }}</b>
              <span class="pg-luck-legend">
                <span v-for="line in luckChartData.series" :key="line.side + line.kind" class="pg-luck-key" :data-side="line.side" :data-kind="line.kind">
                  <svg viewBox="0 0 24 8" aria-hidden="true"><line x1="1" y1="4" x2="23" y2="4" /></svg>{{ line.label }}
                </span>
              </span>
              <button type="button" class="pg-luck-close" :aria-label="$t('cards.postGamePanel.pgDiceModal.closeTheLuckChart')" @click="closeLuckChart()">✕</button>
            </header>
            <div class="pg-luck-body">
              <svg class="pg-luck-svg" :viewBox="`0 0 ${luckChartData.width} ${luckChartData.height}`" role="img" :aria-label="$t('cards.postGamePanel.pgDiceModal.netLuckPerTeam')">
                <line class="pg-luck-zero" :x1="luckChartData.plot.left" :x2="luckChartData.plot.right" :y1="luckChartData.plot.zero" :y2="luckChartData.plot.zero" />
                <text v-for="t in luckChartData.yTicks" :key="t.label" class="pg-luck-ytick" :x="luckChartData.plot.left - 5" :y="t.y + 4" text-anchor="end">{{ t.label }}</text>
                <line v-for="x in luckChartData.dividers" :key="x" class="pg-luck-divider" :x1="x" :x2="x" :y1="luckChartData.plot.top" :y2="luckChartData.plot.bottom" />
                <text v-for="slot in luckChartData.slots" :key="`${slot.half}-${slot.slot}`" class="pg-luck-xtick" :x="slot.x" :y="luckChartData.height - 8" text-anchor="middle">{{ slot.label }}</text>
                <polyline v-for="line in luckChartData.series" :key="line.side + line.kind" class="pg-luck-line" :data-side="line.side" :data-kind="line.kind" :points="line.points" fill="none" />
                <rect v-for="(slot, i) in luckChartData.slots" :key="`col-${slot.half}-${slot.slot}`" class="pg-luck-col" :data-hover="luckHover === i" tabindex="0"
                  :x="slot.left" :y="luckChartData.plot.top" :width="slot.width" :height="luckChartData.plot.bottom - luckChartData.plot.top"
                  :aria-label="slot.half === 3 ? $t('cards.postGamePanel.slotOvertime', { turn: slot.label, n: slot.lines.length }) : $t('cards.postGamePanel.slotHalf', { half: slot.half, turn: slot.label, n: slot.lines.length })"
                  @mouseenter="luckHover = i" @mouseleave="luckHover = null" @focus="luckHover = i" @blur="luckHover = null" />
              </svg>
              <p v-if="luckChartData.empty" class="pg-luck-empty">{{ $t('cards.postGamePanel.pgDiceModal.noBreaksYet') }}</p>
              <div v-if="luckHoverSlot" class="pg-luck-tip" role="tooltip">
                <b>{{ luckHoverSlot.half === 3 ? $t('cards.postGamePanel.pgDiceModal.overtime') : $t('cards.postGamePanel.pgDiceModal.halfHalf', { half: luckHoverSlot.half }) }}{{ $t('cards.postGamePanel.pgDiceModal.turnLabel', { label: luckHoverSlot.label }) }}</b>
                <span v-for="(line, i) in luckHoverSlot.lines" :key="i" class="pg-luck-tip-line" :data-side="line.side">{{ line.text }}</span>
                <span v-if="luckHoverSlot.lines.length === 0" class="pg-luck-tip-line">{{ $t('cards.postGamePanel.pgDiceModal.noBreaksThisTurn') }}</span>
              </div>
            </div>
          </div>
          <div class="pg-dice-grid" :data-view="diceBoth ? 'both' : 'side'">
            <section class="pg-dice-left">
              <h3>{{ $t('cards.postGamePanel.pgDiceModal.diceDistribution') }}</h3>
              <!-- Owner 11-05: one grid row per chart and one cell per team shown, so both teams' charts line up. -->
              <div class="pg-dice-cols pg-dice-cols-charts" :data-cols="diceCols.length">
                <template v-for="(chartRow, ri) in diceCols[0]!.data.charts" :key="chartRow.key">
                <!-- Sol r1 (owner 11-05 Both view): Dodges by target is its own grid row, so a team without it leaves an
                     empty cell and the Dodge dice charts stay side by side. -->
                <template v-if="chartRow.key === 'dodge' && diceCols.some((c) => c.data.dodgeTargets)">
                <div v-for="col in diceCols" :key="'dt-' + col.side" class="pg-dice-col pg-dodge-cell" :data-side="col.side" :role="diceBoth ? 'group' : undefined" :aria-label="diceBoth ? col.data.team : undefined">
                  <template v-for="side in [col.data]" :key="col.side">
                  <div v-if="side.dodgeTargets" class="pg-dice-block pg-dodge-block">
                    <!-- Owner 10-01 (S67): dodges BY TARGET, above the Dodge dice faces. Bottom to top: green = passed without a
                         re-roll, blue = passed after a re-roll, red = failed even after a re-roll; the outline is every attempt
                         (its empty part failed with no re-roll); dashed = expected passes. -->
                      <h4>{{ $t('cards.postGamePanel.pgDiceModal.dodgesByTarget') }} <span class="pg-dice-n">{{ $t('cards.postGamePanel.pgDiceModal.passedAttemptsPassedExpected', { passed: side.dodgeTargets.passed, attempts: side.dodgeTargets.attempts }) }} <b>{{ side.dodgeTargets.expected.toFixed(1) }}</b></span></h4>
                      <svg class="pg-dice-chart pg-dodge-targets" :viewBox="`0 0 ${PG_CHART_W} ${PG_CHART_H}`" role="img" :aria-label="$t('cards.postGamePanel.pgDiceModal.dodgesByTargetNumber')">
                        <g v-for="(b, i) in side.dodgeTargets.bars" :key="i">
                          <rect :x="b.x" :y="b.yAttempts" :width="b.w" :height="b.hAttempts" class="pg-dodge-attempts" />
                          <rect :x="b.x" :y="b.yFirst" :width="b.w" :height="b.hFirst" class="pg-dodge-first" />
                          <rect :x="b.x" :y="b.yReroll" :width="b.w" :height="b.hReroll" class="pg-dodge-reroll" />
                          <rect :x="b.x" :y="b.yFail" :width="b.w" :height="b.hFail" class="pg-dodge-fail" />
                          <line v-if="b.attempts > 0" :x1="b.x - 4" :x2="b.x + b.w + 4" :y1="b.ey" :y2="b.ey" class="pg-dice-expected" />
                          <!-- owner 10-01: the expected passes as a number at the left end of its dashed line (the thin-field counts sit on the right) -->
                          <text v-if="b.attempts > 0" :x="b.x - 5" :y="b.eny" class="pg-dodge-exp-n">{{ b.expected.toFixed(1) }}</text>
                          <text :x="b.x + b.w / 2" :y="PG_CHART_BASE + 10" class="pg-dice-label">{{ b.label }}</text>
                          <text :x="b.x + b.w / 2" :y="Math.max(PG_CHART_TOP + 6, b.yAttempts - 3)" class="pg-dice-count">{{ b.attempts ? `${b.passed}/${b.attempts}` : '—' }}</text>
                        </g>
                        <!-- owner 10-01 r2: the value of each colour field, centred in it (beside it when the field is too thin) -->
                        <text v-for="(l, i) in side.dodgeTargets.labels" :key="'s' + i" :x="l.x" :y="l.y"
                          class="pg-dodge-seg-n" :class="[l.inside ? 'pg-dodge-seg-in' : `pg-dodge-seg-out pg-dodge-seg-${l.kind}`]">{{ l.n }}</text>
                      </svg>
                      <p class="pg-dodge-legend"><span class="pg-dodge-entry"><span class="pg-dodge-key pg-dodge-key-first" />{{ $t('cards.postGamePanel.pgDiceModal.passed') }}</span> <span class="pg-dodge-entry"><span class="pg-dodge-key pg-dodge-key-reroll" />{{ $t('cards.postGamePanel.pgDiceModal.afterReroll') }}</span> <span class="pg-dodge-entry"><span class="pg-dodge-key pg-dodge-key-fail" />{{ $t('cards.postGamePanel.pgDiceModal.failedWReroll') }}</span> <span class="pg-dodge-entry"><span class="pg-dodge-key pg-dodge-key-none" />{{ $t('cards.postGamePanel.pgDiceModal.noReroll') }}</span> <span class="pg-dodge-entry"><span class="pg-dodge-key pg-dodge-key-exp" />{{ $t('cards.postGamePanel.pgDiceModal.expected') }}</span></p>
                  </div>
                  </template>
                </div>
                </template>
                <div v-for="col in diceCols" :key="col.side" class="pg-dice-col" :data-side="col.side" :role="diceBoth ? 'group' : undefined" :aria-label="diceBoth ? col.data.team : undefined">
                  <template v-for="side in [col.data]" :key="col.side">
                  <div v-for="row in side.charts.slice(ri, ri + 1)" :key="row.key" class="pg-dice-block">
                    <h4>{{ row.title }} <span class="pg-dice-n"><template v-if="row.block">{{ side.blocks }} {{ $t('postGame.dice.blocks', { count: side.blocks }) }}</template><template v-else>{{ row.chart.total }} {{ row.key === 'armour' || row.key === 'injury' ? $t('postGame.dice.rolls') : $t('postGame.dice.dice') }}</template><template v-if="row.block"> · <b>{{ side.oneNinth }}</b> 1/9 · <b>{{ side.oneThirtySixth }}</b> 1/36</template></span></h4>
                    <svg class="pg-dice-chart" :viewBox="`0 0 ${PG_CHART_W} ${row.block ? PG_CHART_H + PG_BLOCK_FACE_EXTRA : PG_CHART_H}`" role="img" :aria-label="$t('cards.postGamePanel.pgDiceModal.titleDistribution', { title: row.title })">
                      <rect v-for="(b, i) in row.chart.bars" :key="i" :x="b.x" :y="b.y" :width="b.w" :height="b.h" class="pg-dice-bar" :class="{ 'pg-dice-bar-block': row.block }" />
                      <path :d="row.chart.expectedPath" class="pg-dice-expected" />
                      <!-- Owner 10-01 (S71): the Block dice columns are labelled with the client's block-die FACES, not words. -->
                      <!-- Owner 10-10: a pack-bound face wins per face (blockDieFaceArt), contained in the same square
                           box (xMidYMid meet), with the bundled symbol as the fallback of a broken pack image. -->
                      <template v-if="row.block">
                        <image v-for="(b, i) in row.chart.bars" :key="'f' + i" :href="blockDieFaceArt(i + 1)?.url" :x="b.x + b.w / 2 - PG_BLOCK_FACE / 2" :y="PG_CHART_BASE + 3"
                          :width="PG_BLOCK_FACE" :height="PG_BLOCK_FACE" preserveAspectRatio="xMidYMid meet"
                          :data-pack-face="blockDieFaceArt(i + 1)?.pack ? '' : undefined" @error="onBlockFaceImageError(i + 1)" class="pg-dice-face"><title>{{ b.label }}</title></image>
                      </template>
                      <template v-else>
                        <text v-for="(b, i) in row.chart.bars" :key="'l' + i" :x="b.x + b.w / 2" :y="PG_CHART_BASE + 10" class="pg-dice-label">{{ b.label }}</text>
                      </template>
                      <text v-for="(b, i) in row.chart.bars" :key="'c' + i" :x="b.x + b.w / 2" :y="Math.max(PG_CHART_TOP + 8, b.y - 3)" class="pg-dice-count">{{ b.count }}</text>
                    </svg>
                  </div>
                  </template>
                </div>
                </template>
              </div>
            </section>
            <div class="pg-dice-right">
              <section class="pg-dice-right-top">
                <h3>{{ $t('cards.postGamePanel.pgDiceModal.likelihood') }}</h3>
                <div class="pg-dice-cols pg-dice-cols-single" :data-cols="diceCols.length" :style="{ '--pg-like-rows': diceCols[0]!.data.likelihoods.length }">
                  <!-- Sol r3: in Both each column is a named group (the team), so a screen reader knows whose results it reads -->
                  <div v-for="col in diceCols" :key="col.side" class="pg-dice-col pg-dice-col-single" :data-side="col.side" :role="diceBoth ? 'group' : undefined" :aria-label="diceBoth ? col.data.team : undefined">
                    <div v-for="side in [col.data]" :key="col.side" class="pg-dice-block">
                      <!-- Owner 10-09: each row measures RESULTS against their fair chance (armour broken, rolls passed, what the
                           block dice offered); a game cached before that reads "not measured". Owner 10-10: the plain numbers
                           are no longer a line under the gauge - the "i" beside the title opens them in a popover. -->
                      <div v-for="row in side.likelihoods" :key="row.key" class="pg-dice-gauge-row" :data-row="row.key" :data-measured="row.like.measured">
                        <template v-for="g in [pgGaugeReading(row)]" :key="row.key">
                        <span class="pg-dice-gauge-head" :data-chart="row.key === 'luck' && row.like.measured">
                          <span class="pg-dice-gauge-label">{{ row.label }}</span>
                          <button v-if="!diceBoth" type="button" class="pg-dice-info" :aria-label="$t('cards.postGamePanel.pgDiceModal.labelDetails', { label: row.label })"
                            :aria-expanded="diceTip.key === row.key" :aria-describedby="diceTip.key === row.key ? diceTipId(row.key) : undefined"
                            :data-open="diceTip.key === row.key" :data-pinned="diceTip.key === row.key && diceTip.pinned"
                            @pointerenter="onDiceInfoEnter(row.key, $event)" @pointerleave="onDiceInfoLeave(row.key)"
                            @focus="onDiceInfoFocus(row.key, $event)" @blur="onDiceInfoBlur(row.key, $event)" @keydown="onDiceInfoKeydown(row.key, $event)"
                            @click="onDiceInfoClick(row.key, $event)"><span aria-hidden="true">i</span></button>
                          <!-- Owner 10-22: the Luck chart's button sits on the row, under the word "Luck" (it was the last line of the
                               popover). After the "i" in the DOM, so Tab reads the row's title, its details, then "By turn". -->
                          <button v-if="!diceBoth && row.key === 'luck' && row.like.measured" type="button" class="pg-luck-chart-btn" :aria-label="$t('cards.postGamePanel.pgDiceModal.luckByTurn')" @click="openLuckChart">{{ $t('cards.postGamePanel.pgDiceModal.byTurn') }}</button>
                        </span>
                        <!-- Owner 11-05: the percentile rides the marker as a small tag; the "1 in N" sits in a small box in the
                             gauge's top-right corner; each gauge is its own small box; the right-hand column is a word. -->
                        <span class="pg-dice-gauge-box">
                        <svg class="pg-dice-gauge" viewBox="0 0 200 44" role="img" :aria-label="pgGaugeAria(row, g, row.sentence ?? pgOddsSentence(row.like))">
                          <path v-if="diceBoth" :d="PG_GAUGE_AREA" class="pg-dice-area" />
                          <path :d="PG_GAUGE_CURVE" class="pg-dice-curve" />
                          <line x1="100" y1="6" x2="100" y2="40" class="pg-dice-mean" />
                          <line v-if="pgHasMarker(row.like)" :x1="pgGaugeX(row.like.zShown)" y1="4" :x2="pgGaugeX(row.like.zShown)" y2="42" class="pg-dice-marker" />
                          <text v-if="pgHasMarker(row.like) && g.percentile" class="pg-dice-tag" :x="pgGaugeX(row.like.zShown) + (row.like.zShown > 0 ? -3 : 3)" y="38"
                            :text-anchor="row.like.zShown > 0 ? 'end' : 'start'">{{ g.percentile }}</text>
                        </svg>
                        <!-- owner 11-05 (later): the "1 in N" always top right, in a small box -->
                        <span v-if="g.odds" class="pg-dice-odds" aria-hidden="true">{{ g.odds }}</span>
                        </span>
                        <span class="pg-dice-gauge-value" :data-band="g.band ?? undefined" :data-average="g.band === 'average'" :title="pgGaugeTitle(row)"><b>{{ g.word }}</b></span>
                        </template>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
              <section v-if="!diceBoth" class="pg-dice-right-bottom">
                <h3>{{ $t('cards.postGamePanel.pgDiceModal.funFacts') }}</h3>
                <div class="pg-dice-cols pg-dice-cols-single">
                  <div v-for="side in [pgDiceSelected]" :key="side.team" class="pg-dice-col pg-dice-col-single" :data-side="diceSide">
                    <div class="pg-dice-block">
                      <div v-if="side.facts.length === 0" class="pg-dice-empty">{{ $t('cards.postGamePanel.pgDiceModal.noDiceRolledYet') }}</div>
                      <div v-for="fact in side.facts" :key="fact.label" class="pg-dice-fact">
                        <span class="pg-dice-fact-label">{{ fact.label }}</span>
                        <span class="pg-dice-fact-value">{{ fact.value }}</span>
                        <span class="pg-dice-fact-detail">{{ fact.detail }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
      <!-- Owner 10-10: the open row's numbers. A sibling of the pane (not inside its scrolling block), fixed to the viewport. -->
      <div v-if="diceModalOpen && showStats && diceTipRow" :id="diceTipId(diceTipRow.key)" ref="diceTipEl" class="skill-tip pg-dice-tip" :class="lmGameRootClass(settings)" role="tooltip"
        :data-row="diceTipRow.key" :data-below="diceTip.below" :style="{ left: diceTip.left + 'px', top: diceTip.top + 'px', maxHeight: diceTip.maxHeight != null ? diceTip.maxHeight + 'px' : undefined, overflowY: diceTip.maxHeight != null ? 'auto' : undefined }"
        @pointerenter="onDiceTipPointerEnter" @pointerleave="onDiceTipPointerLeave">
        <b class="skill-tip-name">{{ diceTipRow.label }}</b>
        <!-- Owner 10-17: a story line's player names are chips - hover for who it was (#nr position, team), a click (or Enter) pins that detail inline.
             Astra 10-17: the chips are in the popover's keyboard route (Tab from the "i" reaches the first of them). -->
        <span v-for="(stat, i) in diceTipRow.stats" :key="i" class="pg-dice-tip-line"><span v-if="stat.label" class="pg-dice-tip-label">{{ stat.label }}: </span><span v-if="stat.parts" class="pg-dice-tip-value"><template v-for="(part, j) in stat.parts" :key="j"><template v-if="typeof part === 'string'">{{ part }}</template><template v-else><button type="button" class="pg-dice-tip-name" :title="pgPlayerDetail(game, part.playerId)" :aria-expanded="diceTipName === `${i}:${j}`" :data-open="diceTipName === `${i}:${j}`" @click.stop="toggleDiceTipName(`${i}:${j}`)" @keydown="onDiceTipChipKeydown">{{ part.name }}</button><span v-if="diceTipName === `${i}:${j}`" class="pg-dice-tip-name-detail"> ({{ pgPlayerDetail(game, part.playerId) }})</span></template></template></span><span v-else class="pg-dice-tip-value">{{ stat.value }}</span></span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ==== CSS BELOW IS COPIED VERBATIM FROM SpectateView.vue (post-game block) — SpectateView keeps its copy for the
   inducement roster viewer / MVP nominate surfaces that share these classes. Edit the pane here. ==== */
@keyframes coin-caption-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
/* Shared player-card bits the MVP card lifts (SpectateView .card-portrait / .card-spp). */
.card-spp { font-size: max(var(--ui-min-text-size, 12px), 1.2em); font-weight: 600; }
.card-spp-gain { color: var(--ui-success); font-size: max(var(--ui-min-text-size, 12px), 0.85em); font-weight: 600; }
.card-portrait {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at center, #2a3a24 0%, #14161a 85%);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  min-height: 0;
  overflow: hidden;
}
.card-portrait img {
  height: 100%;
  max-height: 9.6em;
  max-width: 100%;
  object-fit: contain;
  object-position: center;
  transform: scale(1.35);
  transform-origin: center center;
  image-rendering: pixelated;
}
.portrait-missing { color: var(--ui-text-dim); font-size: max(var(--ui-min-text-size, 12px), 0.9em); }
/* Owner 09-25: embedded in a blade popup — normal flow, no viewport overlay, no zoom ladder. */
.postgame[data-embedded='true'] { position: static; inset: auto; z-index: auto; background: none; animation: none; padding: 0; --pg-scale: 1 !important; }
.postgame[data-embedded='true'] .pg-window { width: 100%; max-height: none; }
/* B9-12 G7: full post-game panel (Result / MVP / Statistics) */
.postgame {
  position: absolute;
  z-index: 50;
  inset: 0;
  display: flex;
  /* owner 2026-07-05: anchor the end-of-game panel to the TOP of the screen.
     owner 2026-07-06: TWO stacked windows — Result on top, Stats/MVP below. */
  flex-direction: column;
  align-items: center;
  /* Owner 09-09: CENTRED in the viewport (was top-anchored at 44px) and every window scaled up LINEARLY via
     `zoom` (--pg-scale) so text, dice, crests, padding and gaps all grow together; the viewport-relative caps
     divide the scale back out so the zoomed stack still fits the screen. */
  /* Owner 09-14: the scale FOLLOWS the viewport (1.25 at ~1400x1000, ~1.35 at 1920x1080, ~1.8 at 2560x1440) so the
     result + Stats/MVP stack fills a big monitor instead of sitting small in its middle; height is the binding axis
     because two windows stack. */
  --pg-scale: 1.25; /* fallback where length/length division is unsupported (the @supports block below wins) */
  justify-content: center;
  gap: calc(10px * var(--pg-scale));
  padding: 16px 0; /* owner 09-15: 24→16 */
  background: radial-gradient(ellipse at center, #000c 0%, #0009 60%, #0006 100%);
  animation: coin-caption-in var(--p-350) ease-out;
}
@supports (zoom: calc(100vw / 1120px)) {
  /* Owner 09-15: the compact result window shortened the stack (~640px unscaled), so the height basis drops
     800→700 (≈1.54 at 1080p, ≈2.05 at 1440p) and every element grows with it. */
  .postgame { --pg-scale: clamp(0.9, min(calc(100vw / 1120px), calc(100vh / 860px)), 2.2); } /* owner 09-15: 720→860 — the twelve tall roster rows must fit 1080p */
}
.pg-window {
  zoom: var(--pg-scale);
  width: min(680px, calc(92vw / var(--pg-scale)));
  max-height: calc(88vh / var(--pg-scale));
  overflow-y: auto;
  background: linear-gradient(180deg, var(--ui-surface-2) 0%, var(--ui-surface) 100%);
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  box-shadow: 0 12px 40px #000c;
  color: var(--ui-text);
  flex: none;
}
/* owner 2026-07-06: Result window hugs its content; the Stats/MVP window takes the
   remaining height and scrolls internally so both stay on screen. */
/* Owner 09-15: the RESULT window is compact (one row: crest+name | score | crest+name, winnings/fans as a one-line
   strip) so the Stats/MVP window below gets the remaining height and the MVP cards fit without scrolling at the
   default scale; stats still scrolls internally only when the viewport is genuinely too short. */
.pg-window-result { flex: 0 0 auto; }
.pg-window-stats { position: relative; scrollbar-gutter: stable; flex: 0 1 auto; min-height: 0; max-height: calc(88vh / var(--pg-scale)); overflow-x: hidden; } /* Sol r1: the 12px tab slide never adds a horizontal scrollbar */ /* owner 09-15 (2nd): hug the content — the SCALE fills the height, not empty window */
.pg-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 16px; /* owner 09-15: compact (was 12px) */
  border-bottom: 1px solid var(--ui-border);
}
.pg-title {
  font-family: var(--font-display);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.4rem);
  font-weight: 900;
  color: var(--ui-heading);
  letter-spacing: 0.03em;
}
.pg-tabs {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.pg-head-tabs { justify-content: center; } /* owner 09-15 (3rd): title gone, blades centred */
.pg-head-tabs .pg-tabs { margin-left: 0; }
.pg-tabs button {
  background: var(--ui-surface-2);
  border: 1px solid var(--ui-border);
  color: var(--ui-text);
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem);
}
.pg-tabs button[data-active='true'] {
  background: var(--ui-accent);
  border-color: var(--ui-accent);
  color: var(--ui-text-on-primary);
  font-weight: 700;
}
.pg-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--ui-border);
}
.pg-action {
  background: var(--ui-surface-2);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  color: var(--ui-text);
  cursor: pointer;
  padding: 8px 20px;
}
.pg-action:hover { background: var(--ui-hover); }
/* Owner 08-19: spectate-seat endgame — design-language primary (bevelled carmine, End of Game.dc.html action row). */
.pg-action-primary {
  background: var(--ui-primary);
  border: 2px outset var(--ui-active);
  color: var(--ui-text-on-primary);
  font-weight: 700;
  letter-spacing: 0.06em;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
}
.pg-action-primary:hover { background: var(--ui-primary); filter: brightness(1.25); }
/* MVP-pending placeholder — holds the Statistics & MVP window's slot until the server's data lands. */
.pg-mvp-pending {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 18px 16px;
  font-family: var(--font-display);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem);
  letter-spacing: 0.08em;
  color: var(--ui-text-dim);
}
.pg-mvp-pending-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ui-gold);
  animation: pg-mvp-pending-pulse 1.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .pg-mvp-pending-dot { animation: none; }
}
/* Owner 11-05: tab panes fade + slide 12px (out 90 ms, in 160 ms) instead of popping */
.pg-tab-fwd-enter-active, .pg-tab-back-enter-active { transition: opacity 160ms ease-out, transform 160ms ease-out; }
.pg-tab-fwd-leave-active, .pg-tab-back-leave-active { transition: opacity 90ms ease-in, transform 90ms ease-in; position: absolute; left: 0; right: 0; pointer-events: none; }
/* (a cross-fade: the old pane leaves on top, out of the flow, while the new one enters - the queued "out-in" mode left
   the window EMPTY after a few fast clicks, Vue never recovering) */
.pg-tab-fwd-enter-from, .pg-tab-back-leave-to { opacity: 0; transform: translateX(12px); }
.pg-tab-fwd-leave-to, .pg-tab-back-enter-from { opacity: 0; transform: translateX(-12px); }
@media (prefers-reduced-motion: reduce) {
  .pg-tab-fwd-enter-active, .pg-tab-back-enter-active, .pg-tab-fwd-leave-active, .pg-tab-back-leave-active { transition: none; }
}
/* Settings > Reduce motion: styles/accessibilityModes.css (a scoped :global() selector here dropped the pane classes, Sol r1) */
@keyframes pg-mvp-pending-pulse {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 1; }
}
/* The persistent spectate exit pair (Return to Menu / Spectate Another Game). */
.pg-exit {
  display: flex;
  justify-content: center;
  gap: 10px;
  padding: 12px 16px;
}
.pg-close {
  /* owner (B10): pin the close X to the top-right of the panel, not next to the title. */
  margin-left: auto;
  background: transparent;
  border: none;
  color: var(--ui-muted);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem);
  cursor: pointer;
}
/* result phase */
.pg-result {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  padding: 12px 16px; /* owner 09-15: compact (was 28px 20px) */
}
/* #140: the defectors reveal on the end-screen result window (which players walked after a concession). */
.pg-defectors {
  margin: 0 20px 18px;
  padding: 10px 14px;
  border-top: 1px solid #ffffff1a;
  text-align: center;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.92rem);
  color: #ffd0d0;
}
.pg-defector-names { color: #fff; font-weight: 700; }
/* #169: end-of-match result rows (gold winnings + dedicated-fans roll per team) on the end-screen. */
.pg-endstats {
  margin: 0 20px 4px;
  padding: 10px 14px 2px;
  border-top: 1px solid #ffffff1a;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pg-endstat-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem);
  flex-wrap: wrap;
}
.pg-endstat-gold { color: #ffd76a; font-variant-numeric: tabular-nums; font-weight: 700; }
.pg-endstat-fans { color: var(--ui-text); font-variant-numeric: tabular-nums; }
.pg-endstat-d6 { --d6-size: 1.6em; margin: -0.18em 0.08em -0.12em; }
.pg-endstat-fans.muted { color: var(--ui-muted); font-style: italic; }
.pg-team {
  display: grid; /* owner 09-15: crest LEFT, name + coach beside it, the winnings/fans strip under both */
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas: 'logo name' 'logo coach' 'box box';
  column-gap: 10px;
  row-gap: 2px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 10px;
}
.pg-team > img { grid-area: logo; }
.pg-team > .pg-team-name { grid-area: name; text-align: left; align-self: end; }
.pg-team > .pg-team-coach { grid-area: coach; align-self: start; }
.pg-team > .pg-team-box { grid-area: box; }
.pg-team.winner {
  background: color-mix(in srgb, var(--ui-accent) 10%, transparent);
  outline: 1px solid color-mix(in srgb, var(--ui-accent) 33%, transparent);
}
.pg-team img { width: 52px; height: 52px; object-fit: contain; image-rendering: pixelated; } /* owner 09-15: 68→52 */
.pg-team-name { font-weight: 800; text-align: center; }
/* #235 (owner-fg 07-29): keep long single-line team names inside every post-game panel column. */
.pg-team { min-width: 0; }
.pg-mvp-head span {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Owner ruling 08-17: EndGame result-window team name WRAPS instead of truncating
   (was sharing the #235 ellipsis rule above with MVP/roster headers). Scoped to
   .pg-team-name only — MVP head + roster toggle (PostGameRoster.vue) keep single-line ellipsis. */
.pg-team-name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  max-width: 180px;
  overflow: hidden;
  white-space: normal;
  overflow-wrap: break-word;
  word-break: break-word;
}
.pg-mvp-head span { min-width: 0; }
.pg-team-coach { font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: var(--ui-muted); }
.pg-scoreline { text-align: center; }
.pg-score {
  font-family: var(--font-display);
  font-size: max(var(--ui-min-primary-text-size, 16px), 3rem);
  font-weight: 900;
  color: var(--ui-text);
  line-height: 1;
}
.pg-score span { color: var(--ui-text-dim); margin: 0 8px; }
.pg-verdict { margin-top: 8px; color: var(--ui-accent); font-weight: 700; }
/* MVP phase */
.pg-mvp {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 8px 16px 10px; /* owner 09-15: compact */
}
.pg-mvp-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 800;
  margin-bottom: 8px;
  /* Owner 09-09: the team name/crest row is a shaded BAR (surface band with a soft top highlight) instead of a
     bare underlined line, so each MVP column reads as headed. */
  padding: 6px 10px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--ui-surface-2) 70%, #fff 8%) 0%, var(--ui-surface-2) 55%, color-mix(in srgb, var(--ui-surface-2) 80%, #000 20%) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 1px 2px rgba(0, 0, 0, 0.45);
}
.pg-mvp-head img { width: 30px; height: 30px; object-fit: contain; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.6)); }
/* Owner 10-09: the roster component heads the MVP panel; the grid above already pads it, and each team column may narrow. */
/* Owner 10-10: the column is a full-height stack (the grid stretches both teams to the taller one), so the one
   "Hide innate skills" box sits in the pane's bottom-right corner whichever column is the taller. */
.pg-mvp .pg-mvp-roster { padding: 0; min-width: 0; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
.pg-mvp .pg-mvp-roster :deep(.pg-roster-innate) { margin-top: auto; padding-top: 6px; }
.pg-mvp-team { min-width: 0; }
.pg-star { color: var(--ui-accent); }
.pg-mvp-name { font-weight: 700; }
.pg-mvp-none { color: var(--ui-text-dim); font-style: italic; }
/* Owner 09-14: MVP rows select; the selected winner's portrait card sits under the list. */
/* Owner 09-14 UAT: the portrait is a FIXED box (never stretched by a long name / advancement line) and its sprite is
   fitted inside it (the in-game card's 1.35 zoom crop is not applied here) so the MVP tab never overflows or scrolls. */
.pg-mvp-card { display: flex; gap: 12px; margin-top: 6px; padding: 8px; align-items: stretch; } /* owner 11-05: the info column runs the portrait's full height so the level line can sit at the bottom */
.pg-mvp-card .card-portrait { flex: 0 0 auto; width: 6.8em; height: 8em; min-height: 0; } /* (0,2,0) beats the later .card-portrait { flex: 1 } */
.pg-mvp-card .card-portrait img { height: 100%; max-height: 100%; width: auto; transform: none; } /* (0,2,1) beats the later .card-portrait img rule */
.pg-mvp-card-name { line-height: 1.15; }
/* Owner 10-10: the awarded cards of one team. While the roulette spins they hold their place unseen and the roulette
   line lies over them; with no award known yet the box still reserves one card's height. */
.pg-mvp-cards { position: relative; min-width: 0; }
.pg-mvp-cards[data-pending='true'] { min-height: calc(8em + 24px); }
.pg-mvp-cards[data-pending='true'] .pg-mvp-card { visibility: hidden; }
.pg-mvp-cards[data-pending='true'] .pg-mvp-roulette { position: absolute; top: 6px; left: 0; right: 0; }
/* name (wraps, never pushes the card wider) + the roster badge at the line's right end */
.pg-mvp-card-head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.pg-mvp-card-head .pg-mvp-card-name { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.pg-mvp-card-badge { margin: 1px 1px 0 0; } /* clear of the card edge, so the gold "this game" outline is not clipped */
.pg-mvp-card-spp { display: flex; align-items: baseline; flex-wrap: wrap; column-gap: 0.3em; }
/* the roster's value cell (PostGameRoster .pg-roster-value): text colour, tabular, 600 */
.pg-mvp-card-value { margin-left: auto; padding-left: 0.6em; color: var(--ui-text); font-variant-numeric: tabular-nums; font-weight: 600; }
.pg-mvp-card-info { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1; }
.pg-mvp-card-name { font-weight: 800; font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem); }
.pg-mvp-card-name[data-side='home'] { color: #6d9bff; }
.pg-mvp-card-name[data-side='away'] { color: #ff7a7e; }
.pg-mvp-card-pos { color: var(--ui-muted); }
.pg-mvp-card-spp { line-height: 1.1; }
/* Owner 11-05: pinned to the card's bottom edge (the info column stretches to the portrait's height). */
.pg-mvp-advance { margin-top: auto; padding-top: 6px; color: var(--ui-accent); font-weight: 800; }
/* #25-v2 roster CSS moved to PostGameRoster.vue (owner 10-02). */

/* #25-v2: MVP roulette reveal (presentation only — lands on the server award) */
.pg-mvp-roulette { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; }
.pg-mvp-spin {
  font-weight: 700;
  color: var(--ui-accent);
  animation: pg-mvp-flicker var(--p-90) steps(1) infinite;
}
@keyframes pg-mvp-flicker { 0% { opacity: 0.55; } 100% { opacity: 1; } }
.pg-mvp-awaiting { color: var(--ui-text); margin: 6px 0 0; min-height: calc(8em + 18px); } /* owner 10-10: holds a card's height, so the column does not grow when the award lands */
.pg-mvp-awaiting::after {
  content: '';
  animation: pg-mvp-dots var(--p-1200) steps(4, end) infinite;
}
@keyframes pg-mvp-dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }
@media (prefers-reduced-motion: reduce) {
  .pg-mvp-spin, .pg-mvp-awaiting::after { animation: none; }
}
/* stats phase */
/* owner 2026-07-05: larger post-game statistics text */
.pg-stats { padding: 8px 16px 10px; } /* owner 09-15: compact — the table must fit without scrolling */
/* Owner 09-14: raised bevel shared by the end-screen blocks — a lifted panel is easier to read than a flat row. */
.pg-bevel {
  background: linear-gradient(180deg, color-mix(in srgb, var(--ui-surface-2) 88%, var(--ui-text) 8%) 0%, var(--ui-surface) 100%);
  border: 1px solid color-mix(in srgb, var(--ui-border) 70%, var(--ui-text) 12%);
  border-top-color: color-mix(in srgb, var(--ui-text) 28%, var(--ui-border));
  border-left-color: color-mix(in srgb, var(--ui-text) 18%, var(--ui-border));
  border-bottom-color: #000c;
  border-right-color: #000a;
  border-radius: 10px;
  box-shadow: 0 3px 0 #000b, 0 8px 18px #0008, inset 0 1px 0 #ffffff1f;
}
.pg-scoreline.pg-bevel { padding: 10px 18px; } /* owner 09-15: compact */
.pg-team-box { margin-top: 6px; padding: 4px 10px; display: flex; flex-direction: row; flex-wrap: wrap; justify-content: center; align-items: baseline; gap: 2px 12px; font-size: max(var(--ui-min-primary-text-size, 16px), 0.86rem); text-align: center; } /* owner 09-15: one-line strip */
.pg-stats-cols { display: grid; grid-template-columns: 1fr 1.35fr 1fr; gap: 12px; align-items: stretch; }
.pg-stat-col { display: flex; flex-direction: column; padding: 0 0 6px; overflow: hidden; }
.pg-stat-col-head { min-height: 34px; display: flex; align-items: center; justify-content: center; padding: 3px; border-bottom: 1px solid #000a; box-shadow: 0 1px 0 #ffffff14; }
.pg-stat-col[data-side='home'] .pg-stat-col-head { border-top: 3px solid #3d7cff; }
.pg-stat-col[data-side='away'] .pg-stat-col-head { border-top: 3px solid #f2363c; }
.pg-stat-col[data-side='label'] .pg-stat-col-head { border-top: 3px solid color-mix(in srgb, var(--ui-text) 25%, transparent); }
.pg-stat-col-head img { width: 34px; height: 34px; object-fit: contain; image-rendering: pixelated; }
.pg-stat-col-side { font-weight: 800; color: var(--ui-muted); letter-spacing: .06em; }
.pg-stat-cell { box-sizing: border-box; height: 1.9rem; padding: 0 12px; border-top: 1px solid var(--ui-border); font-size: 0.98rem; line-height: calc(1.9rem - 1px); white-space: nowrap; overflow: hidden; font-variant-numeric: tabular-nums; } /* owner 09-17: one fixed row height so the three columns stay in step (the label font is smaller and the rows drifted) */
.pg-stat-cell.pg-h { text-align: center; } /* owner 09-17: numbers centred under the crests */
.pg-stat-cell.pg-a { text-align: center; }
/* Owner 09-17: the DICE tab */
.pg-dice-modal { position: fixed; inset: 0; z-index: 210; display: flex; align-items: center; justify-content: center; padding: 3vh 3vw; background: #05070cc8; backdrop-filter: blur(2px); }
/* Owner 09-19: the pane fills ~94% x 91% of the viewport and its type scales with it — every size inside is in em off the card's viewport-driven font-size. */
.pg-dice-card { position: relative; width: 94vw; height: 91vh; font-size: clamp(14px, 0.95vw, 24px); display: flex; flex-direction: column; background: var(--ui-surface-2); border: 1px solid var(--ui-border); border-radius: 10px; box-shadow: 0 20px 60px #000c; color: var(--ui-text); overflow: hidden; }
.pg-dice-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid var(--ui-border); }
.pg-dice-close { border: 1px solid var(--ui-border); background: var(--ui-surface); color: var(--ui-text); border-radius: 6px; width: 1.8em; height: 1.8em; font-size: 1em; cursor: pointer; }
.pg-dice-head .pg-title { font-size: 1.5em; } /* the header scales with the card too */
/* Owner 10-10: the coverage note shares the title's side of the header; the coach tabs stay centred whatever it says. */
.pg-dice-head:has(.pg-dice-coverage) { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); column-gap: 12px; }
.pg-dice-head:has(.pg-dice-coverage) .pg-dice-actions { justify-self: end; }
.pg-dice-actions { display: flex; align-items: center; gap: 8px; }
.pg-dice-help { position: relative; display: inline-flex; }
.pg-dice-help-btn { width: 1.8em; height: 1.8em; cursor: pointer; }
.pg-dice-help-pop { position: absolute; top: calc(100% + 8px); right: 0; z-index: 5; width: min(24em, 70vw); padding: 0.6em 0.8em; background: var(--ui-surface-2); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 8px; box-shadow: 0 8px 24px #000a; font-size: 0.9em; line-height: 1.35; }
.pg-dice-help-pop p { margin: 0 0 0.4em; }
.pg-dice-help-pop p:last-child { margin-bottom: 0; }
.pg-dice-heading { display: flex; align-items: center; gap: 12px; min-width: 0; }
.pg-dice-coverage { font-size: 0.85em; line-height: 1.2; color: var(--ui-muted); min-width: 0; }
.pg-dice-coverage:not([data-coverage='whole']) { color: var(--ui-text); padding: 2px 8px; border: 1px solid var(--ui-border); border-left: 3px solid #d9a441; border-radius: 4px; background: var(--ui-surface); }
.pg-dice-close:hover { background: var(--ui-accent); color: var(--ui-text-on-primary); border-color: var(--ui-accent); }
.pg-dice-switch { display: flex; gap: 4px; padding: 3px; border: 1px solid var(--ui-border); border-radius: 8px; background: var(--ui-surface); }
.pg-dice-switch button { display: flex; align-items: center; gap: 0.4em; padding: 0.2em 0.8em 0.2em 0.4em; border: 0; border-radius: 6px; background: transparent; color: var(--ui-muted); font-family: var(--font-display); font-weight: 800; font-size: 1em; letter-spacing: 0.03em; cursor: pointer; border-bottom: 3px solid transparent; }
.pg-dice-switch button img { width: 1.5em; height: 1.5em; object-fit: contain; }
.pg-dice-switch button:hover { color: var(--ui-text); }
.pg-dice-switch button[aria-selected='true'] { background: var(--ui-surface-2); color: var(--ui-heading); }
.pg-dice-switch button[aria-selected='true'][data-side='home'] { border-bottom-color: #3d7cff; }
.pg-dice-switch button[aria-selected='true'][data-side='away'] { border-bottom-color: #f2363c; }
/* Owner 09-17 (r4): a single scrollable stack of charts on the left (chart width as before), likelihood + fun facts in the middle. */
.pg-dice-grid { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: clamp(420px, 34vw, 800px) minmax(0, 1fr); /* owner 11-05: a wider distributions column - bigger charts, better spacing */ gap: 0.75em 1.5em; padding: 0.75em 1em 0.9em; }
.pg-dice-left { min-height: 0; overflow: auto; padding-right: 6px; }
.pg-dice-cols.pg-dice-cols-charts { grid-template-columns: 1fr; gap: 0 1.5em; }
/* Owner 11-05: the Both view - Likelihood on top, the distributions below, home left (blue) and away right (red). */

.pg-dice-grid[data-view='both'] { grid-template-columns: minmax(0, 1fr); grid-template-rows: max-content max-content; overflow-y: auto; } /* Sol r4: one scrolling stack, so the distributions are always reachable below Likelihood on a small window */
.pg-dice-grid[data-view='both'] > .pg-dice-left, .pg-dice-grid[data-view='both'] > .pg-dice-right, .pg-dice-grid[data-view='both'] .pg-dice-right-top { overflow: visible; min-height: auto; }
.pg-dice-grid[data-view='both'] > .pg-dice-right { order: -1; display: block; }
.pg-dice-grid[data-view='both'] .pg-dice-col[data-side='home'] { background: color-mix(in srgb, #3d7cff 9%, transparent); }
.pg-dice-grid[data-view='both'] .pg-dice-col[data-side='away'] { background: color-mix(in srgb, #f2363c 9%, transparent); }
.pg-dice-grid[data-view='both'] .pg-dice-gauge { height: clamp(36px, 4.6vh, 80px); }
.pg-dice-grid[data-view='both'] .pg-dice-gauge-label { font-size: 1.05em; white-space: normal; overflow-wrap: anywhere; }
.pg-dice-grid[data-view='both'] .pg-dice-col-single .pg-dice-gauge-value b { font-size: clamp(0.85em, 1.1vw, 1.15em); } /* small windows: the half-width columns need smaller words */
.pg-dice-grid[data-view='both'] .pg-dice-odds { font-size: 0.66em; }
.pg-dice-grid[data-view='both'] .pg-dice-chart { height: clamp(110px, 17vh, 240px); }
.pg-dice-area { fill: #3d7cff; opacity: 0.22; stroke: none; }
.pg-dice-col[data-side='away'] .pg-dice-area { fill: #f2363c; }
/* Owner 11-05: small text on the gauge - the "1 in N" in the top corner, the percentile tag on the marker */
.pg-dice-tag { fill: var(--ui-text); font-weight: 700; font-variant-numeric: tabular-nums; paint-order: stroke; stroke: var(--ui-surface-2); stroke-width: 2px; stroke-linejoin: round; }
.pg-dice-odds, .pg-dice-tag { font-family: var(--font-body, 'Helvetica Neue', Arial, sans-serif); letter-spacing: 0; text-transform: none; }
/* owner 11-05 (later): each gauge in a small box, the "1 in N" in a small box at its top right, the rows zebra-striped */
.pg-dice-gauge-box { position: relative; display: block; min-width: 0; padding: 2px 6px; border: 1px solid color-mix(in srgb, var(--ui-border) 80%, transparent); border-radius: 6px; background: color-mix(in srgb, var(--ui-surface) 65%, transparent); }
.pg-dice-gauge-box .pg-dice-gauge { display: block; width: 100%; }
.pg-dice-odds { position: absolute; top: 3px; right: 4px; padding: 1px 6px; border: 1px solid var(--ui-border); border-radius: 4px; background: var(--ui-surface-2); color: var(--ui-text); font-size: 0.72em; font-weight: 700; line-height: 1.25; white-space: nowrap; font-variant-numeric: tabular-nums; }
.pg-dice-gauge-row:nth-child(even) { background: color-mix(in srgb, var(--ui-text) 5%, transparent); } /* plain face: the display lettering does not read this small */
.pg-dice-grid[data-view='both'] .pg-dice-cols-single[data-cols='2'] { grid-template-rows: repeat(var(--pg-like-rows, 7), auto); } /* Sol r2: both teams' rows share one row track each (subgrid), so a wrapped word on one side never shifts the other side's gauges */
.pg-dice-grid[data-view='both'] .pg-dice-cols-single[data-cols='2'] > .pg-dice-col,
.pg-dice-grid[data-view='both'] .pg-dice-cols-single[data-cols='2'] > .pg-dice-col > .pg-dice-block { display: grid; grid-row: 1 / -1; grid-template-rows: subgrid; }
.pg-dice-grid[data-view='both'] .pg-dice-col-single .pg-dice-gauge-row { grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.6fr) minmax(0, 1.3fr); }
.pg-dice-tag { font-size: 8px; }
.pg-dice-cols-charts .pg-dice-col { display: flex; flex-direction: column; }
/* Owner 10-09: five rows, each with its numbers under the gauge - the block may take most of the column, then scrolls; the fun facts keep the rest. */
.pg-dice-right { min-height: 0; display: grid; grid-template-rows: fit-content(72%) minmax(0, 1fr); gap: 12px; }
.pg-dice-right-top { min-height: 0; overflow: auto; }
/* Owner 10-01 (S70): the Fun facts header stays put; only the facts under it scroll. */
.pg-dice-right-bottom { min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.pg-dice-right-bottom > h3 { flex: 0 0 auto; }
.pg-dice-right-bottom > .pg-dice-cols { flex: 1 1 0; min-height: 0; overflow: auto; }
/* the side-colour rule under the header is part of the locked row: it rides the scroller's top edge, not the block */
.pg-dice-right-bottom > .pg-dice-cols { border-top: 3px solid #3d7cff; }
.pg-dice-right-bottom > .pg-dice-cols:has([data-side='away']) { border-top-color: #f2363c; }
.pg-dice-right-bottom .pg-dice-col-single .pg-dice-block { border-top: 0; }
/* Owner 09-17 (r5): likelihood + fun facts follow the selector (one coach), so everything can come up a size. */
.pg-dice-cols.pg-dice-cols-single { grid-template-columns: 1fr; }
.pg-dice-cols.pg-dice-cols-single[data-cols='2'], .pg-dice-cols.pg-dice-cols-charts[data-cols='2'] { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 1.5em; }
.pg-dice-col-single .pg-dice-block { border-top: 3px solid #3d7cff; padding: 0.6em 1em 0.5em; }
.pg-dice-col-single[data-side='away'] .pg-dice-block { border-top-color: #f2363c; }
.pg-dice-col-single .pg-dice-gauge-row { grid-template-columns: 1fr 2fr 1fr; gap: 1em; padding: 0.2em 0.6em; } /* symmetric: the curve sits dead centre of the panel */
.pg-dice-col-single .pg-dice-gauge-value { text-align: right; max-width: none; white-space: normal; overflow-wrap: break-word; line-height: 1.15; } /* owner 11-05: the words may take two lines */
.pg-dice-col-single .pg-dice-gauge-label { font-size: 1.3em; }
.pg-dice-col-single .pg-dice-gauge { height: clamp(42px, 5.6vh, 94px); } /* owner 10-09: shorter. Owner 10-10: the numbers line under it is gone, so the rows sit tighter still */
.pg-dice-col-single .pg-dice-curve { stroke-width: 1.6; }
.pg-dice-col-single .pg-dice-marker { stroke-width: 3.5; }
.pg-dice-col-single .pg-dice-gauge-value b { font-size: 1.15em; } /* owner 11-05: a word now, not odds */
.pg-dice-gauge-value[data-band='luckerDog'] b, .pg-dice-gauge-value[data-band='comedyMegaDicing'] b { color: var(--ui-accent); }
.pg-dice-col-single .pg-dice-gauge-value[data-average='true'] b { font-size: 1.15em; } /* "about average" is words, not odds: quieter */
.pg-dice-col-single .pg-dice-fact { padding: 0.35em 0.75em; gap: 0.1em 1em; }
.pg-dice-col-single .pg-dice-fact-label { font-size: 1.3em; }
.pg-dice-col-single .pg-dice-fact-value { font-size: 1.5em; }
.pg-dice-col-single .pg-dice-fact-detail { font-size: 1.05em; }
.pg-dice-grid h3 { margin: 0 0 0.35em; font-family: var(--font-display); font-weight: 900; font-size: 1.2em; color: var(--ui-heading); letter-spacing: 0.03em; }
.pg-dice-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
.pg-dice-fact { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 4px 0; border-top: 1px solid color-mix(in srgb, var(--ui-border) 55%, transparent); }
.pg-dice-fact:first-child { border-top: 0; }
.pg-dice-fact-label { font-size: 0.85rem; }
.pg-dice-fact-value { font-size: 0.95rem; font-weight: 800; color: var(--ui-accent); text-align: right; font-variant-numeric: tabular-nums; }
.pg-dice-fact-detail { grid-column: 1 / -1; font-size: 0.75rem; color: var(--ui-muted); white-space: pre-line; }
.pg-dice-empty { font-size: 0.85rem; color: var(--ui-muted); padding: 4px 0; }
.pg-dice-col { display: flex; flex-direction: column; padding: 0 0 6px; }
.pg-dice-col[data-side='home'] .pg-stat-col-head { border-top: 3px solid #3d7cff; }
.pg-dice-col[data-side='away'] .pg-stat-col-head { border-top: 3px solid #f2363c; }
/* Owner 10-01 (S72): the dividers between charts were too dark to see (--ui-border); they are the muted label grey
   now, and Dodge dice gets its own divider under the Dodges-by-target chart it shares a block with. */
.pg-dice-block { padding: 6px 12px 4px; border-top: 1px solid color-mix(in srgb, var(--ui-muted) 70%, transparent); }
.pg-dice-block .pg-dodge-legend + h4 { margin: 0 -12px 0.25em; padding: 6px 12px 0; border-top: 1px solid color-mix(in srgb, var(--ui-muted) 70%, transparent); }
.pg-dice-block h4 { margin: 0 0 0.25em; font-family: var(--font-display); font-weight: 700; font-size: 1.05em; color: var(--ui-heading); letter-spacing: 0.03em; display: flex; justify-content: space-between; align-items: baseline; }
.pg-dice-n { font-family: inherit; font-weight: 400; font-size: 0.85em; color: var(--ui-muted); letter-spacing: 0; }
.pg-dice-n b { color: var(--ui-accent); font-weight: 800; }
.pg-dice-chart { width: 100%; height: auto; display: block; }
/* owner 11-05 ("I really like the content boxes, let's add those to everything"): every distribution chart and every fun
   fact sits in the same small box as the Likelihood gauges */
.pg-dice-chart { box-sizing: border-box; padding: 3px 4px; border: 1px solid color-mix(in srgb, var(--ui-border) 80%, transparent); border-radius: 6px; background: color-mix(in srgb, var(--ui-surface) 65%, transparent); }
.pg-dice-fact, .pg-dice-fact:first-child { margin: 0 0 0.4em; border: 1px solid color-mix(in srgb, var(--ui-border) 80%, transparent); border-radius: 6px; background: color-mix(in srgb, var(--ui-surface) 65%, transparent); }
.pg-dice-bar { fill: #3d7cff; opacity: 0.85; }
.pg-dice-col[data-side='away'] .pg-dice-bar { fill: #f2363c; }
.pg-dice-bar-block { opacity: 0.75; }
.pg-dice-expected { fill: none; stroke: var(--ui-text); stroke-width: 1.4; stroke-dasharray: 3 3; opacity: 0.9; }
.pg-dice-face { image-rendering: auto; } /* smooth minification of the 64 px face, as in the log */
.pg-dice-label { fill: var(--ui-muted); font-size: 9px; text-anchor: middle; font-family: var(--font-display); }
.pg-dice-count { fill: var(--ui-text); font-size: 9px; text-anchor: middle; font-weight: 700; font-variant-numeric: tabular-nums; }
/* Owner 10-01 (S67): dodges by target - the three fills mean the same on both sides (not the team colours). */
.pg-dodge-attempts { fill: none; stroke: var(--ui-muted); stroke-width: 1; }
.pg-dodge-targets { overflow: visible; } /* the first column's expected number may sit in the left gutter */
.pg-dodge-exp-n { fill: var(--ui-text); font-size: 6px; font-weight: 700; text-anchor: end; font-variant-numeric: tabular-nums; }
.pg-dodge-first { fill: #2fae5a; }
.pg-dodge-reroll { fill: #3d7cff; }
.pg-dodge-fail { fill: #e5484d; }
.pg-dodge-seg-n { font-size: 7px; font-weight: 700; font-variant-numeric: tabular-nums; pointer-events: none; }
.pg-dodge-seg-in { fill: #fff; text-anchor: middle; paint-order: stroke; stroke: rgba(0, 0, 0, 0.45); stroke-width: 0.8px; }
.pg-dodge-seg-out { text-anchor: start; }
.pg-dodge-seg-first { fill: #2fae5a; } .pg-dodge-seg-reroll { fill: #6f9bff; } .pg-dodge-seg-fail { fill: #e5484d; }
.pg-dodge-legend { margin: 2px 0 8px; font-size: max(var(--ui-min-text-size, 12px), 10px); color: var(--ui-muted); display: flex; flex-wrap: wrap; gap: 2px 10px; align-items: center; }
.pg-dodge-entry { white-space: nowrap; } /* a swatch never wraps away from its word */
.pg-dodge-key { display: inline-block; width: 10px; height: 8px; margin-right: 4px; vertical-align: middle; box-sizing: border-box; }
.pg-dodge-key-first { background: #2fae5a; }
.pg-dodge-key-reroll { background: #3d7cff; }
.pg-dodge-key-fail { background: #e5484d; }
.pg-dodge-key-none { border: 1px solid var(--ui-muted); }
.pg-dodge-key-exp { height: 0; border-top: 2px dashed var(--ui-text); }
.pg-dice-gauge-row { display: grid; grid-template-columns: auto minmax(60px, 1fr) auto; gap: 10px; align-items: center; padding: 2px 0; } /* owner 09-17 reflow: labels never truncate, the value is one line */
.pg-dice-gauge-row > * { min-width: 0; } /* the SVG's 300 px intrinsic width must not size the track */
.pg-dice-gauge-label { font-size: 0.85rem; white-space: nowrap; }
.pg-dice-gauge { width: 100%; min-width: 0; height: 30px; display: block; }
.pg-dice-curve { fill: none; stroke: var(--ui-muted); stroke-width: 1.2; }
.pg-dice-mean { stroke: var(--ui-muted); stroke-width: 1; stroke-dasharray: 2 2; }
.pg-dice-marker { stroke: var(--ui-accent); stroke-width: 2.5; stroke-linecap: round; }
.pg-dice-gauge-value { line-height: 1.2; font-variant-numeric: tabular-nums; font-size: 0.85rem; color: var(--ui-muted); max-width: 11em; }
.pg-dice-gauge-value b { white-space: normal; } /* owner 11-05: the band words may wrap (was nowrap for the odds) */
.pg-dice-gauge-value b { font-size: 0.95rem; color: var(--ui-text); }
/* Owner 10-10: the plain numbers behind the row left the row; an "i" beside the title opens them (hover, focus or click).
   The button is a quiet ring in the pane's own tokens; the popover is the app's teleported bubble (.skill-tip), left-aligned. */
.pg-dice-gauge-head { display: inline-flex; align-items: center; gap: 0.45em; min-width: 0; }
.pg-dice-info { flex: none; box-sizing: border-box; width: 1.5em; height: 1.5em; min-width: 18px; min-height: 18px; padding: 0; display: inline-grid; place-items: center; border-radius: 50%; border: 1px solid var(--ui-border); background: var(--ui-surface); color: var(--ui-muted); font: inherit; font-size: max(var(--ui-min-text-size, 12px), 0.8em); font-weight: 700; font-style: italic; font-family: Georgia, 'Times New Roman', serif; line-height: 1; cursor: help; }
.pg-dice-info:hover, .pg-dice-info:focus-visible, .pg-dice-info[data-open='true'] { border-color: var(--ui-accent); color: var(--ui-text); outline: none; }
.pg-dice-info[data-pinned='true'] { background: color-mix(in srgb, var(--ui-accent) 25%, var(--ui-surface)); }
.skill-tip.pg-dice-tip { z-index: 220; transform: none; align-items: flex-start; text-align: left; gap: 0.2rem; max-width: min(26rem, calc(100vw - 16px)); pointer-events: auto; font-variant-numeric: tabular-nums; }
.pg-dice-tip-line { overflow-wrap: anywhere; }
.pg-dice-tip-name { all: unset; cursor: pointer; text-decoration: underline dotted; text-underline-offset: 2px; }
.pg-dice-tip-name:hover, .pg-dice-tip-name[data-open="true"] { color: #ffd166; text-decoration-style: solid; }
.pg-dice-tip-name:focus-visible { outline: 2px solid #ffd166; outline-offset: 2px; border-radius: 2px; } /* Astra r2: all: unset dropped the global focus ring */
.pg-dice-tip-name-detail { opacity: 0.8; }
.pg-dice-tip-label { color: var(--ui-muted); }
/* Owner 10-16: the Luck chart button and subpane. Home blue, away red (the seat tints of the pane). */
.pg-luck-chart-btn { margin-top: 0.3rem; padding: 0.15rem 0.6rem; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-surface-2); color: var(--ui-text); font: inherit; cursor: pointer; }
.pg-luck-chart-btn:hover, .pg-luck-chart-btn:focus-visible { border-color: var(--ui-accent, #6d9bff); outline: none; }
/* Owner 10-22: on the Luck row the button sits under the label, left-aligned with it and small; only that row's head grows. */
.pg-dice-gauge-head[data-chart='true'] { display: inline-grid; grid-template-columns: auto auto; justify-content: start; align-items: center; column-gap: 0.45em; row-gap: 0.2em; }
.pg-dice-gauge-head[data-chart='true'] .pg-luck-chart-btn { grid-column: 1 / -1; justify-self: start; margin-top: 0; padding: 0.05rem 0.5rem; font-size: max(var(--ui-min-text-size, 12px), 0.8em); line-height: 1.3; }
.pg-luck-pane { position: absolute; inset: 8px; z-index: 5; display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; background: var(--ui-surface-2); border: 1px solid var(--ui-border); border-radius: 10px; box-shadow: 0 12px 40px #000c; }
.pg-luck-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.pg-luck-title { font-size: 1.1em; }
.pg-luck-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; flex: 1; font-size: 0.85em; color: var(--ui-muted); }
.pg-luck-key { display: inline-flex; align-items: center; gap: 5px; }
.pg-luck-key svg { width: 24px; height: 8px; }
.pg-luck-key line, .pg-luck-line { stroke-width: 2; }
.pg-luck-key[data-side='home'] line, .pg-luck-line[data-side='home'] { stroke: #3d7cff; }
.pg-luck-key[data-side='away'] line, .pg-luck-line[data-side='away'] { stroke: #f2363c; }
.pg-luck-key[data-kind='turn'] line, .pg-luck-line[data-kind='turn'] { stroke-dasharray: 5 4; stroke-width: 1.5; }
.pg-luck-close { margin-left: auto; border: 1px solid var(--ui-border); border-radius: 6px; background: transparent; color: var(--ui-text); font: inherit; cursor: pointer; padding: 0.1rem 0.5rem; }
.pg-luck-body { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.pg-luck-svg { width: 100%; max-height: 100%; }
.pg-luck-zero { stroke: var(--ui-muted); stroke-width: 1; }
.pg-luck-divider { stroke: var(--ui-border); stroke-width: 1; stroke-dasharray: 2 3; }
.pg-luck-ytick, .pg-luck-xtick { fill: var(--ui-muted); font-size: 11px; }
.pg-luck-col { fill: transparent; outline: none; }
.pg-luck-col[data-hover='true'] { fill: #ffffff10; }
.pg-luck-empty { position: absolute; margin: 0; color: var(--ui-muted); }
.pg-luck-tip { position: absolute; top: 4px; right: 4px; display: flex; flex-direction: column; gap: 2px; max-width: min(26rem, 90%); padding: 6px 9px; background: var(--ui-surface-1, #0b0f18); border: 1px solid var(--ui-border); border-radius: 6px; font-size: 0.85em; pointer-events: none; }
.pg-luck-tip-line[data-side='home'] { color: #6d9bff; }
.pg-luck-tip-line[data-side='away'] { color: #ff7a7e; }
.pg-dice-gauge-row + .pg-dice-gauge-row { border-top: 1px solid color-mix(in srgb, var(--ui-border) 55%, transparent); }
.pg-dice-gauge-row[data-measured='false'] .pg-dice-curve, .pg-dice-gauge-row[data-measured='false'] .pg-dice-mean { opacity: 0.4; }
.pg-stat-cell.pg-stat-label { text-align: center; color: var(--ui-muted); font-size: 0.9rem; }
.pg-stat-cell[data-lead='true'] { color: var(--ui-accent); font-weight: 800; }
.pg-stats table { width: 100%; table-layout: fixed; border-collapse: collapse; }
.pg-stats th { padding: 8px 10px; font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); color: var(--ui-text); }
/* #235 (owner-fg 07-29): clamp team headers within fixed statistic columns. */
.pg-stats th.pg-h,
.pg-stats th.pg-a { width: 25%; max-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pg-stats th.pg-h { text-align: left; }
.pg-stats th.pg-a { text-align: right; }
/* #235 (owner-fg 07-29): body labels were already centered; center their empty header as well. */
.pg-stats th.pg-stat-label { text-align: center; }
.pg-stats td { padding: 8px 10px; border-top: 1px solid var(--ui-border); font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem); }
.pg-stats td.pg-h { text-align: left; width: 25%; font-variant-numeric: tabular-nums; }
.pg-stats td.pg-a { text-align: right; width: 25%; font-variant-numeric: tabular-nums; }
.pg-stats td.pg-stat-label { text-align: center; color: var(--ui-muted); font-size: max(var(--ui-min-primary-text-size, 16px), 1.02rem); }
.pg-stats td[data-lead='true'] { color: var(--ui-accent); font-weight: 800; }
</style>
