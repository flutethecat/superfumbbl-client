<script setup lang="ts">
/**
 * In-game INDUCEMENTS PHASE screen — owner design handoff
 * `HANDOFF-inducements-phase.md` (extends `README.md` for tokens/fonts/bevels/
 * raised caps). Shown between team acceptance and kick-off.
 *
 * PRESENTATIONAL ONLY. Every value arrives as a prop already mirrored off server
 * state by the mount (SpectateView); this component computes no budgets, decides
 * no legality, and predicts no server acceptance. It emits intent — the mount
 * answers the wire through the existing `clientBuyInducements` sender.
 *
 * SEAT VISIBILITY (owner 08-18): BOTH seats mount this screen for the whole phase.
 * The waiting seat gets the same chrome with its controls withheld and a waiting
 * body in the centre pane; it sends nothing while waiting.
 *
 * Theme: colours come from the `--ui-*` engine (src/game/theme.ts) wherever a
 * token carries the handoff's literal hex. Raw hexes remain only for the
 * structural greys/washes the token set does not name (see the hex ledger in the
 * handoff report).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PitchConfirmationPanel from './PitchConfirmationPanel.vue';
import type { Blade, InducementPhase, InducementRole, PhaseMoney, PhaseOption, PickMap } from '../game/inducementsPhase';
import type { BudgetEstimate, CashRowKey, OwnedResources, UnderdogCashRow } from '../game/inducementsPhase';
import { canAdd, fmtGold, skillToken } from '../game/inducementsPhase';
import { padFocusControllerMode, padFocusedControl, vPadFocus, type PadFocusOptions } from '../game/cardFocus';
import { popUndo, reconcileUndoStack, seedUndoStack, undoTarget } from '../game/inducementUndo';
import { $t, terms, capHead, capTail } from '../i18n';
import { t } from '../i18n';

/** A star/merc sprite resolved by the mount. Iconsets use the frame-1 sheet crop;
 *  custom assets are already-normalized standalone 64px player sprites. */
export interface Portrait { url: string | null; glyph: string; source?: 'iconset' | 'custom' | 'walker' }

export interface PickerCard {
  key: string;
  name: string;
  cost: number;
  /** "N of M taken" / "N of M hired" / "Hired"; empty for an unhired star (no line drawn). */
  countLabel: string;
  /** Paired stars (Grak/Crumbleberry, Dribl/Drull) show "—" on the free half. */
  costLabel: string;
  portrait: Portrait;
  stats: { k: string; v: string }[];
  skills: string[];
  special: string | null;
  option: PhaseOption;
}

/** A summary-stack card. `totalLabel` is null when the cost is not knowable. */
export interface SummaryCardView {
  key: string;
  name: string;
  blade: Blade;
  kind: string;
  qty: number;
  /**
   * null for a REVEALED OPPONENT card: the reveal wire (InducementChoice) carries
   * key/label/count and star names only — never costs — and the opponent's option
   * catalogue is priced against THEIR roster, which we are not sent. Showing a
   * guessed total would be a client invention, so the line is simply omitted.
   */
  totalLabel: string | null;
  showBadge: boolean;
  portrait: Portrait;
  skills: string[];
  /** False for display-only cards such as stars already rostered before this phase. */
  removable?: boolean;
}

export interface PanelView {
  role: InducementRole;
  /** Field seat for spectator/replay color stability; independent of overdog/underdog. */
  seat: 'home' | 'away';
  /** The team's name, shown beside its crest at the top of the panel (owner 10-14: the coach name sits under it). */
  teamName: string;
  /** Owner 10-14: the coach's name exactly as the server sent it, on its own muted line under the team name. Absent/empty = no line. */
  coachName?: string;
  /** The crest the coach panels show for this team (pack logo, else the bundled race crest). Null = none resolved. */
  logo: string | null;
  /** What the team OWNS BEFORE inducements (roster values off the team model). Never moves with the selection. */
  owned: OwnedResources | null;
  status: 'selecting' | 'confirmed' | 'waiting';
  money: PhaseMoney | null;
  /** Owner 10-12 gold estimate: the local coach's own expected budget while the other coach holds the dialog,
   *  derived client side (game/inducementsPhase.ts `estimateInducementBudget`). Shown only while `money` is null,
   *  marked "Estimated"; the server's values replace it the moment they arrive. Display only. */
  estimate?: BudgetEstimate | null;
  /** The underdog rows the ruleset's real dialog has (`underdogCashRows`); default petty / scum / treasury. */
  moneyRows?: readonly UnderdogCashRow[];
  /** Blade-ordered (Inducements → Star Players → Mercenaries) by the mount. */
  cards: SummaryCardView[];
  /** ✕ remove + Clear/Confirm are offered only while this coach is editable. */
  editable: boolean;
  /** Underdog panel dims during the overdog phase. */
  dimmed: boolean;
  emptyNote: string;
}

const props = withDefaults(defineProps<{
  phase: InducementPhase;
  overdog: PanelView;
  underdog: PanelView;
  /** Which column is the local coach's — drives which controls are live. */
  mySide: InducementRole | null;
  /** Spectator/replay never reinterpret either team as local, even if stale role state exists. */
  viewerMode?: 'play' | 'spectate' | 'replay';
  /** True while the local coach holds the live dialog (may add/remove/confirm). */
  canAct: boolean;
  /** The local coach's live picks; empty while watching. */
  picks: PickMap;
  /** The local coach's offered rows; empty while watching. */
  options: PhaseOption[];
  /** Hard spend ceiling = server `availableGold` (petty + scum). */
  cap: number;
  blade: Blade;
  cards: Record<Blade, PickerCard[]>;
  /** Owner 09-21: the OPPONENT's offered cards while they choose (read-only), and their derived budget. */
  oppCards?: Record<Blade, PickerCard[]> | null;
  oppCap?: number;
  /** Upstream selector caps (stars/mercenaries/staff) so at-limit cards dim. */
  selectorLimits: { stars: number; mercenaries: number; staff: number };
  /** Disable Confirm between send and server ack. */
  confirmPending: boolean;
  /** Read-only, server-authored predefined allocations. No purchase wire exists in this mode. */
  presetMode?: boolean;
  /** Owner 09-25: the read-only surface's heading / per-panel status — presets say "PRESET ROSTERS / Assigned",
   *  a replay's inducement review says "INDUCEMENTS / Bought". */
  presetLabel?: string;
  presetStatus?: string;
  /** the full-width banner ('Tournament Mode'), the centre heading and the note under it */
  presetBanner?: string;
  presetHeading?: string;
  presetNote?: string;
  /** the acknowledge button's word ('Acknowledge' / 'Close') */
  presetAction?: string;
}>(), { viewerMode: 'play', presetMode: false, presetLabel: 'PRESET ROSTERS', presetStatus: '✔ Assigned',
  presetBanner: 'Tournament Mode', presetHeading: 'Predefined Inducements',
  presetNote: 'These inducements were assigned by the tournament or league. Review both teams before kick-off.', presetAction: 'Acknowledge' });

const emit = defineEmits<{
  (e: 'blade', blade: Blade): void;
  (e: 'add', key: string): void;
  (e: 'remove', key: string): void;
  (e: 'clear'): void;
  (e: 'confirm'): void;
  (e: 'acknowledge'): void;
  /** Owner 09-14: open the two-team roster viewer (coaches size up the opponent before buying inducements). */
  (e: 'rosters'): void;
}>();

const BLADES: { id: Blade; label: string }[] = [
  { id: 'inducements', get label() { return t('cards.inducementsPhase.blades.inducements'); } },
  { id: 'stars', get label() { return t('cards.inducementsPhase.blades.starPlayers'); } },
  { id: 'mercenaries', get label() { return t('cards.inducementsPhase.blades.mercenaries'); } },
];

/** Raised caps (README): each word's initial capital renders at 1.2em. */
function words(text: string): { head: string; rest: string; space: boolean }[] {
  return text.split(' ').map((w, i) => ({ head: w.slice(0, 1), rest: w.slice(1), space: i > 0 }));
}

const roleLabel = computed(() => props.presetMode
  ? props.presetLabel
  : (props.phase === 'overdog' ? t('cards.inducementsPhase.roleLabel.overdogIsSelecting') : t('cards.inducementsPhase.roleLabel.underdogIsSelecting')));
const isDone = computed(() => props.phase === 'done' && !props.presetMode);

/** Stars count against the upstream star cap; mercs/staff against theirs. */
function selectorLimitFor(option: PhaseOption): { taken: number; max: number } | undefined {
  const count = (prefix: string) =>
    Object.entries(props.picks).reduce((n, [k, v]) => (k.startsWith(prefix) ? n + v : n), 0);
  if (option.key.startsWith('star:')) return { taken: count('star:'), max: props.selectorLimits.stars };
  if (option.key.startsWith('merc:')) return { taken: count('merc:'), max: props.selectorLimits.mercenaries };
  if (option.key.startsWith('staff:')) return { taken: count('staff:'), max: props.selectorLimits.staff };
  return undefined;
}

/**
 * A card is live only when the local coach may act AND the add would be accepted
 * by the spec's petty+scum guard. At max / out of funds it dims to .55 and stops
 * responding — the server stays the enforcer either way.
 */
function cardLive(card: PickerCard): boolean {
  if (!props.canAct) return false;
  return canAdd(card.option, props.picks, props.options, props.cap, selectorLimitFor(card.option)).ok;
}

/** Owner ruling 10-07: the add order of this selection session (the pad's B undoes it, latest first). Seeded from the
 *  current selection when the screen mounts / the local coach's session (re)starts; reconciled with every picks update. */
const undoStack = ref<string[]>(seedUndoStack(props.picks));
watch(() => props.canAct, (live, was) => { if (live && !was) undoStack.value = seedUndoStack(props.picks); });
watch(() => ({ ...props.picks }), (picks) => { undoStack.value = reconcileUndoStack(undoStack.value, picks); }, { deep: true });

function onCard(card: PickerCard): void {
  if (!cardLive(card)) return;
  undoStack.value = [...undoStack.value, card.key];
  emit('add', card.key);
}

/**
 * Owner 10-11 side panels. Rank art is chosen by the panel's ROLE (never by its colour); the masters carry their own
 * lettering, so the image is the label. Display copies only (600 x 200 WebP); the 2172 px masters stay out of the client.
 */
const RANK_ART: Record<InducementRole, { src: string; alt: string }> = {
  overdog: { src: new URL('../assets/inducements/overdog.webp', import.meta.url).href, alt: 'Overdog' },
  underdog: { src: new URL('../assets/inducements/underdog.webp', import.meta.url).href, alt: 'Underdog' },
};

/** The five owned-resource tiles, in the owner's order: TRR | Apothecary | Fans / Assistant coaches | Cheerleaders.
 *  Icon plus count only (owner 10-11: "the icon carries this information"); the name rides the tooltip + aria-label. */
type CountKey = 'rerolls' | 'apothecaries' | 'dedicatedFans' | 'assistantCoaches' | 'cheerleaders';
const RESOURCE_TILES: { id: CountKey; label: string; icon: string }[] = [
  { id: 'rerolls', get label() { return t('cards.inducementsPhase.resourceTiles.teamRerolls'); }, icon: new URL('../assets/resources/re_roll.png', import.meta.url).href },
  { id: 'apothecaries', get label() { return t('cards.inducementsPhase.resourceTiles.apothecary'); }, icon: new URL('../assets/resources/apothecary.png', import.meta.url).href },
  { id: 'dedicatedFans', get label() { return t('cards.inducementsPhase.resourceTiles.dedicatedFans'); }, icon: new URL('../assets/resources/dedicated_fans.png', import.meta.url).href },
  { id: 'assistantCoaches', get label() { return t('cards.inducementsPhase.resourceTiles.assistantCoaches'); }, icon: new URL('../assets/resources/assistant_coach.png', import.meta.url).href },
  { id: 'cheerleaders', get label() { return t('cards.inducementsPhase.resourceTiles.cheerleaders'); }, icon: new URL('../assets/resources/cheerleader.png', import.meta.url).href },
];
/** A count the team model does not carry (null) keeps its tile, so the grid never reflows, and reads "not available":
 *  the glyph the money rows use for a value that is not known, never an invented number. The fans tile is named after
 *  the field its count came from (Dedicated fans, or the BB2016 Fan factor). */
function resourceTiles(panel: PanelView): { id: string; name: string; icon: string; count: string; known: boolean }[] {
  const owned = panel.owned;
  if (!owned) return [];
  return RESOURCE_TILES.map((tile) => {
    const value = owned[tile.id];
    const label = tile.id === 'dedicatedFans' ? owned.fansLabel : tile.label;
    return { id: tile.id, name: `${label}: ${value === null ? 'not available' : value}`, icon: tile.icon, count: value === null ? '—' : String(value), known: value !== null };
  });
}

/** A crest that fails to load falls back to the team's initial in the same well (keyed by URL, so a hot-swapped pack
 *  logo gets a fresh attempt). */
const failedLogos = ref<Record<string, true>>({});
function logoFor(panel: PanelView): string | null {
  return panel.logo && !failedLogos.value[panel.logo] ? panel.logo : null;
}
function onLogoError(panel: PanelView): void {
  if (panel.logo) failedLogos.value = { ...failedLogos.value, [panel.logo]: true };
}
const teamInitial = (panel: PanelView): string => (panel.teamName.trim().slice(0, 1) || '?').toUpperCase();

/**
 * Money rows. The shape follows the panel's role exactly as before this redesign: the underdog leg has petty, scum
 * and treasury; the overdog leg is one pool (the server sends pettyCash 0 and no scum allowance there), so it keeps
 * Spent / Remaining. A null `money` is hidden information: the same rows, each reading a dash, unless the mount
 * supplies the local coach's own `estimate` (owner 10-12), which then fills the rows and is marked "Estimated".
 */
const CASH_LABEL: Record<CashRowKey, string> = { petty: 'Petty', scum: 'Scum', treasury: 'Treasury', spent: 'Spent', remaining: 'Remaining' };
/** True while the panel's money rows show the client-side estimate rather than server values. */
const showsEstimate = (panel: PanelView): boolean => panel.money === null && !!panel.estimate;
function cashRows(panel: PanelView): { label: string; value: string; tone: 'gold' | 'green' | 'unknown' }[] {
  const money = panel.money;
  const cell = (key: CashRowKey, gold: number | null) => {
    const label = CASH_LABEL[key];
    const tone = key === 'scum' || key === 'remaining' ? 'green' as const : 'gold' as const;
    return gold === null ? { label, value: '—', tone: 'unknown' as const } : { label, value: fmtGold(gold), tone };
  };
  if (!money && panel.estimate) return panel.estimate.cells.map((c) => cell(c.key, c.gold));
  if (panel.role === 'overdog') {
    return [cell('spent', money ? money.spent : null), cell('remaining', money ? money.remaining : null)];
  }
  const gold: Record<UnderdogCashRow, number | null> = {
    petty: money ? money.pettyLeft : null, scum: money ? money.scumLeft : null, treasury: money ? money.treasuryLeft : null,
  };
  return (panel.moneyRows ?? ['petty', 'scum', 'treasury']).map((key) => cell(key, gold[key]));
}

/**
 * Controller support P2b (owner round 3): LB / RB change panes (blades), the D-pad / stick move the target box over
 * the cards, A adds (a focused summary ✕ removes), Y confirms the pane (the Confirm button), B removes the most
 * recently added pick across every pane (owner ruling 10-07; inert when nothing is left). Preset / replay review:
 * A acknowledges.
 */
function cycleBlade(direction: 1 | -1): void {
  const i = BLADES.findIndex((b) => b.id === props.blade);
  const next = BLADES[(i + direction + BLADES.length) % BLADES.length];
  if (next) emit('blade', next.id);
}
/** The local coach's summary cards that cannot be removed (stars rostered before the phase, ...). */
const fixedKeys = computed(() => {
  const mine = props.mySide === 'underdog' ? props.underdog : props.overdog;
  return new Set(mine.cards.filter((c) => c.removable === false).map((c) => c.key));
});
/** B: remove the most recently added pick (any pane); nothing left → inert (never leaves the screen). */
function undoLastAdd(): void {
  const key = undoTarget(undoStack.value, props.picks, (k) => !fixedKeys.value.has(k));
  if (!key) return;
  undoStack.value = popUndo(undoStack.value, key);
  emit('remove', key);
}
const padFocus = computed<PadFocusOptions | false>(() => {
  if (props.presetMode) return {};
  if (!props.canAct || isDone.value) return false;
  return {
    keys: { LB: () => cycleBlade(-1), RB: () => cycleBlade(1), Y: () => { if (!props.confirmPending) emit('confirm'); } },
    cancel: undoLastAdd,
  };
});

/** The underdog has not been asked yet: the overdog leg is still open. */
const underdogWaiting = computed(() => !props.presetMode && props.phase === 'overdog');

/** In play, the coach's own tray is always the left column regardless of whether
 *  that team is overdog or underdog. Passive surfaces have no local seat and
 *  retain the stable overdog-left ordering used before this presentation rule. */
const orderedPanels = computed<[PanelView, PanelView]>(() => {
  if (props.viewerMode === 'play' && props.mySide === 'underdog') {
    return [props.underdog, props.overdog];
  }
  return [props.overdog, props.underdog];
});

type SeatColor = 'blue' | 'red';
type SeatRelation = 'local' | 'opposition' | 'home' | 'away';

/** Play follows viewer relationship; passive views retain the stable field-seat convention. */
function panelRelation(panel: PanelView): SeatRelation {
  if (props.viewerMode === 'play' && props.mySide) {
    return panel.role === props.mySide ? 'local' : 'opposition';
  }
  return panel.seat;
}

function panelColor(panel: PanelView): SeatColor {
  const relation = panelRelation(panel);
  return relation === 'local' || relation === 'home' ? 'blue' : 'red';
}

/**
 * The waiting box (owner 10-11): it lives in the SELECTIONS area, never in the header or footer, until that coach's
 * selections are available (they confirm), and is then replaced by them.
 *   - the underdog's panel through the overdog leg (testid `underdog-waiting`, as the old footer strip was);
 *   - in play, the opponent's panel for as long as they have not confirmed (their picks are not sent before that).
 */
function waitingBox(panel: PanelView): { testid: string; text: string } | null {
  if (props.presetMode || panel.status === 'confirmed') return null;
  const opposition = panelRelation(panel) === 'opposition';
  if (panel.role === 'underdog' && underdogWaiting.value) {
    return { testid: 'underdog-waiting', text: opposition ? t('cards.inducementsPhase.text.waitingForOpponent') : t('cards.inducementsPhase.text.waitingForOverdog') };
  }
  return opposition ? { testid: `waiting-${panel.role}`, get text() { return t('cards.inducementsPhase.text.waitingForOpponent'); } } : null;
}

/** Status + funds block. A preset / replay review has no purchase, so no funds; a coach who has CONFIRMED has no
 *  budget left to show (the mount sends none once the dialog is answered), so the rows give way to the selections
 *  instead of reading three dashes. While a coach is selecting or waiting the rows always show: values, or the dash. */
const showFunds = (panel: PanelView): boolean => !props.presetMode && (panel.status !== 'confirmed' || panel.money !== null || !!panel.estimate);

/** Owner 10-11: the panel of the coach who is selecting right now (the one that carries the SELECTING chip, local,
 *  opponent or spectated alike) wears a gold ring. Not while waiting, not once confirmed, not at 'done', not in a
 *  preset / replay review. Decoration only: the chip is the signal, so the ring carries no ARIA. */
const isSelecting = (panel: PanelView): boolean => !props.presetMode && props.phase !== 'done' && panel.status === 'selecting';

/** Clear / Confirm: the local coach's panel, only while that coach holds the live dialog (unchanged rule). */
const showActions = (panel: PanelView): boolean => panel.editable && panel.role === props.mySide && props.canAct;

/**
 * Single-column layout (under 1020px, the same query the styles use). There the panes take their content height and
 * the whole phase scrolls, so an action row inside the local panel would scroll away with it. The ONE action row is
 * rendered at the end of the phase instead and sticks to the bottom of the scrolling phase (`.ind-dock`). It is the
 * same row, for the same seat, under the same rule (`showActions`); it is never rendered in both places.
 */
const stacked = ref(false);
let stackedQuery: MediaQueryList | null = null;
const syncStacked = (): void => { stacked.value = !!stackedQuery?.matches; };
onMounted(() => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  stackedQuery = window.matchMedia('(max-width: 1020px)');
  syncStacked();
  stackedQuery.addEventListener('change', syncStacked);
});
onBeforeUnmount(() => { stackedQuery?.removeEventListener('change', syncStacked); stackedQuery = null; });
/** The local selecting coach's panel while the layout is stacked; null otherwise. */
const dockPanel = computed<PanelView | null>(() => (stacked.value ? orderedPanels.value.find(showActions) ?? null : null));

/**
 * Astra 10-11 (P2): moving the row between the panel and the dock replaces the two buttons, and a replaced button
 * drops focus to the document: a coach sitting on Confirm who resizes across 1020px would have had the controller's
 * A land on the first picker card (an ADD) instead. So the held action survives the move, in both directions: if
 * Clear or Confirm holds keyboard focus or the pad's focus when the layout flips, the same action's button is focused
 * once it is back in the document. Nothing held = nothing touched. (Focusing is what the pad layer listens for too.)
 */
const rootEl = ref<HTMLElement | null>(null);
const ACTION_BUTTONS = new Set(['clear-btn', 'confirm-btn']);
let heldAction: string | null = null;
watch(stacked, () => { // sync: read the focus BEFORE the re-render removes the button that holds it
  const root = rootEl.value;
  heldAction = null;
  if (!root || typeof document === 'undefined') return;
  const isAction = (el: Element | null): el is HTMLElement =>
    el instanceof HTMLElement && root.contains(el) && ACTION_BUTTONS.has(el.dataset.testid ?? '');
  // The action must OWN input right now. Either it is the document's active element; or nothing on the page holds
  // keyboard focus, the controller is the active input, and the pad's focus sits on it. Anything else being active
  // (the chat entry, a text field, Rosters, a picker card) is the coach's current target and is left alone: the pad
  // layer remembers its last control long after focus has gone elsewhere (Astra 10-11, P2).
  const active = document.activeElement;
  if (isAction(active)) { heldAction = active.dataset.testid ?? null; return; }
  if (active && active !== document.body) return;
  if (!padFocusControllerMode()) return;
  const pad = padFocusedControl();
  if (isAction(pad)) heldAction = pad.dataset.testid ?? null;
}, { flush: 'sync' });
watch(stacked, () => { // post: the row is in its new place
  const action = heldAction;
  heldAction = null;
  if (!action || typeof document === 'undefined') return;
  const again = rootEl.value?.querySelector<HTMLElement>(`[data-testid="${action}"]`);
  if (!again || (again as HTMLButtonElement).disabled) return; // a pending (disabled) Confirm is never focused
  const active = document.activeElement;
  if (active && active !== document.body) return; // something took focus meanwhile (or it never left): hands off
  again.focus({ preventScroll: true });
}, { flush: 'post' });
/** The text on the non-interactive plate that takes the action row's place once a coach has confirmed. */
const confirmedText = computed(() => (props.presetMode ? props.presetStatus : '✔ CONFIRMED'));
</script>

<template>
  <div id="indgrid" ref="rootEl" v-pad-focus="padFocus" data-no-window-x class="ind-grid" data-testid="inducements-phase" :data-phase="phase" :data-preset="presetMode">
    <!-- Preset (tournament/league) allocations: full-width banner over the whole phase. -->
    <div v-if="presetMode" class="ind-tournament-banner" data-testid="tournament-banner">
      <template v-for="(w, i) in words(presetBanner)" :key="i"><span v-if="w.space" class="nbsp">&nbsp;</span><span class="cap">{{ w.head }}</span>{{ w.rest }}</template>
    </div>
    <!-- ── Centre: picker, or the full-width lock banner once both coaches confirm ── -->
    <section v-if="!isDone" class="ind-picker" data-testid="ind-picker">
      <!-- Header: title left, blinking phase stencil right-justified on the SAME line. -->
      <div class="ind-picker-head">
        <div class="ind-title">
          <template v-for="(w, i) in words(presetMode ? presetHeading : 'Inducements')" :key="i"><span v-if="w.space" class="nbsp">&nbsp;</span><span class="cap">{{ w.head }}</span>{{ w.rest }}</template>
        </div>
        <span class="ind-spacer" />
        <button type="button" class="ind-btn ind-btn-neutral ind-rosters-btn" data-testid="rosters-btn" :title="$t('cards.inducementsPhase.indPicker.viewBothTeamRosters')"
          @click="emit('rosters')">📋 <span class="cap">{{ capHead('cards.inducementsPhase.indPicker.capRosters') }}</span>{{ capTail('cards.inducementsPhase.indPicker.capRosters') }}</button>
        <div class="ind-stencil" :data-role="phase" data-testid="phase-stencil">{{ roleLabel }}</div>
      </div>

      <!-- 3 equal blades spanning the full pane width. -->
      <div v-if="!presetMode" class="ind-blades">
        <button v-for="b in BLADES" :key="b.id" type="button" class="ind-blade"
          :data-active="blade === b.id" :data-testid="`blade-${b.id}`" @click="emit('blade', b.id)">
          <template v-for="(w, i) in words(b.label)" :key="i"><!--
            keep an explicit nbsp inside "Star Players" (display-font kerning, per spec)
          --><span v-if="w.space" class="nbsp">&nbsp;</span><span class="cap">{{ w.head }}</span>{{ w.rest }}</template>
        </button>
      </div>

      <!-- Watching seat: the phase is visible, the controls are not. -->
      <div v-if="presetMode" class="ind-preset" data-testid="preset-inducements">
        <div class="ind-preset-copy">
          {{ presetNote }}
        </div>
        <button type="button" class="ind-btn ind-btn-primary" data-testid="acknowledge-btn" @click="emit('acknowledge')">
          ✔ <span class="cap">{{ presetAction.slice(0, 1) }}</span>{{ presetAction.slice(1) }}
        </button>
      </div>

      <div v-else-if="!canAct && !oppCards" class="ind-watch" data-testid="picker-waiting">
        ⧗ {{ phase === 'overdog' ? $t('cards.inducementsPhase.indPicker.overdog') : $t('cards.inducementsPhase.indPicker.underdog') }} {{ $t('cards.inducementsPhase.indPicker.isChoosingInducements') }}
      </div>

      <!-- Owner 09-21: the watching seat sees what the opponent can choose from (their prices, their budget). -->
      <div v-else-if="!canAct" class="ind-watch ind-watch-inline" data-testid="picker-waiting">
        ⧗ {{ phase === 'overdog' ? $t('cards.inducementsPhase.indPicker.overdog') : $t('cards.inducementsPhase.indPicker.underdog') }} {{ $t('cards.inducementsPhase.indPicker.isChoosingInducementsBudget') }} <span class="ind-cash-gold">{{ fmtGold(oppCap ?? 0) }}</span>
      </div>
      <div v-if="!presetMode && (canAct || oppCards)" class="ind-cardgrid" :data-blade="blade" :data-readonly="!canAct">
        <div v-for="(c, ci) in (canAct ? cards : oppCards!)[blade]" :key="c.key" class="ind-card" :data-blade="blade"
          :data-pad-focus="canAct ? '' : undefined" :data-pad-value="c.key" :data-pad-primary="canAct && ci === 0 ? '' : undefined"
          :data-live="cardLive(c)" :data-testid="`card-${c.key}`" @click="onCard(c)">
          <div class="ind-card-top">
            <div v-if="blade === 'inducements'" class="ind-icon">
              <img v-if="c.portrait.url" :src="c.portrait.url" :alt="c.name">
              <template v-else>{{ c.portrait.glyph }}</template>
            </div>
            <div v-else class="ind-portrait" :data-source="c.portrait.source"
              :style="c.portrait.url ? { backgroundImage: `url(${c.portrait.url})` } : undefined">
              <span v-if="!c.portrait.url">{{ c.portrait.glyph }}</span>
            </div>
            <div class="ind-card-id">
              <div class="ind-card-name">{{ terms(c.name) }}</div>
              <div v-if="c.countLabel" class="ind-card-count">{{ c.countLabel }}</div>
            </div>
            <span class="ind-card-cost">{{ c.costLabel }}</span>
          </div>
          <div v-if="c.stats.length" class="ind-stats">
            <div v-for="s in c.stats" :key="s.k" class="ind-stat">
              <div class="ind-stat-v">{{ s.v }}</div>
              <div class="ind-stat-k">{{ s.k }}</div>
            </div>
          </div>
          <div v-if="c.skills.length" class="ind-skills">
            <span v-for="(sk, i) in c.skills" :key="sk">
              <span :style="{ color: skillToken(sk) }">{{ terms(sk) }}</span><span v-if="i < c.skills.length - 1" class="ind-sep">, </span>
            </span>
          </div>
          <div v-if="c.special" class="ind-special">★ {{ c.special }}</div>
        </div>
        <div v-if="!(canAct ? cards : oppCards!)[blade].length" class="ind-empty">{{ $t('cards.inducementsPhase.indPicker.nothingOfferedOnThis') }}</div>
      </div>
    </section>

    <PitchConfirmationPanel v-else class="ind-lock-panel"
      :title="$t('cards.inducementsPhase.indLockPanel.inducementsConfirmed')" :label="$t('cards.inducementsPhase.indLockPanel.confirmedInducements')" test-id="lock-banner"
      :position-style="{ position: 'relative', top: 'auto', left: 'auto', transform: 'none', minWidth: '0', maxWidth: 'none', width: '100%' }">
      <div class="ind-lock-copy">
        <span class="ind-lock-tick" aria-hidden="true">✔</span>
        <span class="ind-lock-text">
          <template v-for="(w, i) in words('Both Coaches Have Confirmed — Inducements Locked')" :key="i"><span v-if="w.space" class="nbsp">&nbsp;</span><span class="cap">{{ w.head }}</span>{{ w.rest }}</template>
        </span>
      </div>
      <div class="ind-lock-note">{{ $t('cards.inducementsPhase.indLockPanel.waitingForKickOff') }}</div>
    </PitchConfirmationPanel>

    <!-- ── Mirrored side panels: local seat left in play; stable role order when passive. Owner 10-11 redesign:
         rank art above, crest + name + owned resources, status + funds, selections, pinned action row. ── -->
    <template v-for="(panel, panelIndex) in orderedPanels" :key="panel.role">
      <!-- Rank art by ROLE. No role exists in a preset / replay review, so none is drawn there. -->
      <div v-if="!presetMode" class="ind-rank" :class="panelIndex === 0 ? 'ind-col1' : 'ind-col3'"
        :data-role="panel.role" :data-testid="`rank-${panel.role}`">
        <img :src="RANK_ART[panel.role].src" :alt="RANK_ART[panel.role].alt">
      </div>
      <section class="ind-summary"
        :class="[panelIndex === 0 ? 'ind-col1' : 'ind-col3', `ind-seat-${panelColor(panel)}`]"
        :data-role="panel.role" :data-seat="panel.seat" :data-seat-color="panelColor(panel)"
        :data-seat-relation="panelRelation(panel)" :data-dimmed="panel.dimmed" :data-selecting="isSelecting(panel)"
        :data-testid="`summary-${panel.role}`">
        <!-- Everything above the action row scrolls as one when the pane is short; the selections list scrolls on its
             own when there is room. The action row below is never part of either scroll. -->
        <div class="ind-sum-scroll">
          <div class="ind-sum-head">
            <div class="ind-team">
              <img v-if="logoFor(panel)" class="ind-team-logo" :src="logoFor(panel)!" alt="" @error="onLogoError(panel)">
              <span v-else class="ind-team-logo ind-team-logo-fallback" aria-hidden="true">{{ teamInitial(panel) }}</span>
              <div class="ind-team-text">
                <div class="ind-team-name" :data-testid="`team-${panel.role}`">
                  <template v-for="(w, i) in words(panel.teamName)" :key="i"><template v-if="i">{{ ' ' }}</template><span class="cap">{{ w.head }}</span>{{ w.rest }}</template>
                </div>
                <div v-if="panel.coachName" class="ind-team-coach" :data-testid="`coach-${panel.role}`">{{ panel.coachName }}</div>
              </div>
            </div>
            <!-- Owner 10-11: the tiles are headed "Staff". The heading names the group; each tile keeps its own name. -->
            <div v-if="panel.owned" class="ind-staff">
              <div :id="`ind-staff-heading-${panel.role}`" class="ind-staff-heading" :data-testid="`staff-heading-${panel.role}`">
                <template v-for="(w, i) in words('Staff')" :key="i"><span v-if="w.space" class="nbsp">&nbsp;</span><span class="cap">{{ w.head }}</span>{{ w.rest }}</template>
              </div>
              <div class="ind-res-grid" role="group" :aria-labelledby="`ind-staff-heading-${panel.role}`" :data-testid="`resources-${panel.role}`">
                <span v-for="tile in resourceTiles(panel)" :key="tile.id" class="ind-res" role="img"
                  :title="tile.name" :aria-label="tile.name" :data-testid="`res-${panel.role}-${tile.id}`">
                  <img :src="tile.icon" alt="">
                  <b class="ind-res-qty" :data-known="tile.known" aria-hidden="true">{{ tile.count }}</b>
                </span>
              </div>
            </div>
          </div>

          <div v-if="showFunds(panel)" class="ind-funds">
            <span v-if="panel.status === 'selecting'" class="ind-status" data-status="selecting" :data-testid="`status-${panel.role}`"><span class="cap">{{ capHead('cards.inducementsPhase.capSelecting') }}</span>{{ capTail('cards.inducementsPhase.capSelecting') }}</span>
            <!-- Underdog leg: petty, then scum, then treasury. Overdog leg: one pool (see cashRows). Hidden = dashes. -->
            <div class="ind-cash" :data-testid="`cash-${panel.role}`" :data-estimated="showsEstimate(panel)">
              <div v-for="row in cashRows(panel)" :key="row.label" class="ind-cash-line">
                <span class="ind-cash-k"><span class="cap">{{ row.label.slice(0, 1) }}</span>{{ row.label.slice(1) }}</span>
                <span :class="`ind-cash-${row.tone}`">{{ row.value }}</span>
              </div>
              <!-- Owner 10-12 / 10-21: worked out client side (my own while the other coach chooses, theirs always); the server's figures replace it. -->
              <div v-if="showsEstimate(panel)" class="ind-cash-est" :data-testid="`cash-estimated-${panel.role}`"
                :title="$t('cards.inducementsPhase.workedOutFromThe')">
                <span class="cap">{{ capHead('cards.inducementsPhase.capEstimated') }}</span>{{ capTail('cards.inducementsPhase.capEstimated') }}
              </div>
            </div>
          </div>

          <div class="ind-sum-picks">
            <div v-if="waitingBox(panel)" class="ind-sum-note ind-sum-wait" :data-testid="waitingBox(panel)!.testid">
              <span><template v-for="(w, i) in words(waitingBox(panel)!.text)" :key="i"><template v-if="i">{{ ' ' }}</template><span class="cap">{{ w.head }}</span>{{ w.rest }}</template></span>
            </div>
            <div v-else-if="!panel.cards.length" class="ind-sum-note ind-sum-empty"><span>{{ panel.emptyNote }}</span></div>
            <div v-if="panel.cards.length" class="ind-sum-list">
              <div v-for="c in panel.cards" :key="c.key" class="ind-sum-card" :data-kind="c.blade" :data-testid="`sumcard-${panel.role}-${c.key}`">
                <!-- Numeric badge overlaps the top-right corner; inducements + mercs only, never stars. -->
                <div v-if="c.showBadge" class="ind-badge" :data-testid="`badge-${panel.role}-${c.key}`">{{ c.qty }}</div>
                <div class="ind-sum-top">
                  <div v-if="c.blade === 'inducements'" class="ind-icon">
                    <img v-if="c.portrait.url" :src="c.portrait.url" :alt="c.name">
                    <template v-else>{{ c.portrait.glyph }}</template>
                  </div>
                  <div v-else class="ind-portrait" :data-source="c.portrait.source"
                    :style="c.portrait.url ? { backgroundImage: `url(${c.portrait.url})` } : undefined">
                    <span v-if="!c.portrait.url">{{ c.portrait.glyph }}</span>
                  </div>
                  <div class="ind-card-id">
                    <div class="ind-card-name">{{ terms(c.name) }}</div>
                    <div class="ind-kind" :data-kind="c.blade">{{ c.kind }}</div>
                  </div>
                  <button v-if="panel.editable && c.removable !== false" type="button" class="ind-x" :data-testid="`remove-${c.key}`" @click="emit('remove', c.key)">✕</button>
                </div>
                <div v-if="c.skills.length" class="ind-skills">
                  <span v-for="(sk, i) in c.skills" :key="sk">
                    <span :style="{ color: skillToken(sk) }">{{ terms(sk) }}</span><span v-if="i < c.skills.length - 1" class="ind-sep">, </span>
                  </span>
                </div>
                <div v-if="c.totalLabel !== null" class="ind-sum-total"><span class="ind-spacer" /><span class="ind-cash-gold">{{ c.totalLabel }}</span></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Pinned to the bottom of the pane: Clear / Confirm for the local selecting coach; one button-shaped,
             non-interactive plate for a coach who has confirmed. Nothing else lives down here (no coach name). -->
        <div v-if="showActions(panel) && !stacked" class="ind-foot ind-actions">
          <button type="button" class="ind-btn ind-btn-neutral" data-testid="clear-btn" @click="emit('clear')">
            <span class="cap">{{ capHead('cards.inducementsPhase.capClear') }}</span>{{ capTail('cards.inducementsPhase.capClear') }}
          </button>
          <button type="button" class="ind-btn ind-btn-primary" data-testid="confirm-btn" :disabled="confirmPending" @click="emit('confirm')">
            ✔ <span class="cap">{{ capHead('cards.inducementsPhase.capConfirm') }}</span>{{ capTail('cards.inducementsPhase.capConfirm') }}
          </button>
        </div>
        <div v-else-if="panel.status === 'confirmed'" class="ind-foot ind-actions">
          <span class="ind-btn ind-confirmed" role="status" data-status="confirmed" :data-testid="`status-${panel.role}`">{{ confirmedText }}</span>
        </div>
      </section>
    </template>

    <!-- Single-column layout only: the local coach's Clear / Confirm, docked to the bottom of the scrolling phase. -->
    <div v-if="dockPanel" class="ind-foot ind-actions ind-dock" :class="`ind-seat-${panelColor(dockPanel)}`" data-testid="actions-dock">
      <button type="button" class="ind-btn ind-btn-neutral" data-testid="clear-btn" @click="emit('clear')">
        <span class="cap">{{ capHead('cards.inducementsPhase.indDock.capClear') }}</span>{{ capTail('cards.inducementsPhase.indDock.capClear') }}
      </button>
      <button type="button" class="ind-btn ind-btn-primary" data-testid="confirm-btn" :disabled="confirmPending" @click="emit('confirm')">
        ✔ <span class="cap">{{ capHead('cards.inducementsPhase.indDock.capConfirm') }}</span>{{ capTail('cards.inducementsPhase.indDock.capConfirm') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Layout — 3 columns, picker centred, on the page gradient. */
.ind-grid {
  display: grid;
  grid-template-columns: minmax(240px, 300px) minmax(420px, 760px) minmax(240px, 300px);
  grid-template-rows: minmax(0, 1fr);
  gap: 14px;
  justify-content: center;
  align-items: start;
  min-height: 100%;
  box-sizing: border-box;
  padding: 26px 20px;
  /* HEX LEDGER: #0f1f10 is the handoff's literal page ground — a one-off gradient
     stop no --ui-* token names (--ui-forest #1A401C is the pitch surface, too
     light here). Kept literal for fidelity; --ui-surface carries the tail. */
  background: linear-gradient(160deg, #0f1f10 0%, var(--ui-surface) 45%, var(--ui-surface) 100%);
  font-family: var(--font-display);
  color: var(--ui-text);
  overflow-x: hidden;
}
/* Below 1020px: single column, source order (picker, then Overdog, then Underdog). */
@media (max-width: 1020px) {
  .ind-grid { grid-template-columns: minmax(0, 760px); grid-template-rows: none; }
  .ind-grid > * { grid-column: 1 !important; grid-row: auto !important; }
}
/* Owner 10-09: the panes always take the pointer. A host that lets the gaps between them through (the Modern view sets
   `pointer-events: none` on this container so the Log/Chat dock is pressable there) must not switch the panes off. */
.ind-grid > * { pointer-events: auto; }
.ind-picker, .ind-lock-panel { grid-column: 2; grid-row: 1; }
.ind-col1 { grid-column: 1; grid-row: 1; }
.ind-col3 { grid-column: 3; grid-row: 1; }

/* Owner 10-11: the Overdog / Underdog art rides its own 84px row above the side panels, 8px clear of them, so the
   picker and both panels start level under it. A preset / replay review has no roles and keeps the rows below. */
.ind-grid[data-preset='false'] { grid-template-rows: 84px minmax(0, 1fr); row-gap: 8px; }
.ind-grid[data-preset='false'] .ind-picker,
.ind-grid[data-preset='false'] .ind-lock-panel,
.ind-grid[data-preset='false'] .ind-summary { grid-row: 2; }
.ind-rank { grid-row: 1; height: 84px; min-width: 0; box-sizing: border-box; }
/* Contained, never cropped, stretched or mirrored: the two masters share one canvas, so they read at one size. */
.ind-rank img { display: block; width: 100%; height: 100%; object-fit: contain; }
/* Decoration only: a press on the art falls through to the phase's catcher like any other gap between the panes. */
.ind-grid > .ind-rank { pointer-events: none; }
@media (max-width: 1020px) {
  .ind-grid[data-preset='false'] { grid-template-rows: none; row-gap: 14px; }
  .ind-rank { margin-bottom: -6px; }
  /* The stacked panes take their content height and the phase scrolls them. The mount gives the phase a fixed height
     and centres its rows: as a grid, that squeezes the auto rows until the panes overlap, and a centred overflow puts
     the top of the stack out of reach. So the stack is plain block flow here: same 760px column, same 14px between
     panes. Block flow is also what lets the action dock below stick across the WHOLE scroll (a grid item can only
     stick inside its own row). (#indgrid: the mount's own rule is three classes strong.) */
  #indgrid.ind-grid { display: block; align-content: start; padding-inline: max(20px, calc((100% - 760px) / 2)); padding-bottom: 0; }
  /* The phase's bottom padding moves onto the last pane: a sticky box is held clear of the scroller's padding, which
     would leave a strip of moving content showing under the dock. */
  #indgrid.ind-grid > :last-child:not(.ind-dock) { margin-bottom: 26px; }
  #indgrid.ind-grid > * + * { margin-top: 14px; }
  #indgrid.ind-grid > .ind-rank { margin-bottom: 0; }
  #indgrid.ind-grid > .ind-rank + .ind-summary { margin-top: 8px; }
  /* The local coach's Clear / Confirm: always on screen, at the bottom edge of the scrolling phase. It is the last
     thing in the flow, so at the end of the scroll it rests under the last pane and covers nothing; anywhere else it
     floats over content that can still be scrolled clear of it. Opaque, with an edge and an upward shadow. */
  #indgrid.ind-grid > .ind-dock {
    position: sticky; bottom: 0; z-index: 5;
    font-family: var(--ui-font, var(--font-display));
    border: 1px solid var(--ind-seat-border); border-top: 2px solid var(--ind-seat-accent); border-radius: 4px;
    background: linear-gradient(180deg, color-mix(in srgb, var(--ind-seat-head) 34%, #0b0e13), #07090c);
    box-shadow: 0 -10px 18px rgba(0, 0, 0, .7), 0 0 0 1px #000;
  }
}

/* Preset (tournament) games: a full-width TOURNAMENT MODE banner rides row 1;
   the three phase panes drop to row 2. */
.ind-grid[data-preset='true'] { grid-template-rows: auto minmax(0, 1fr); }
.ind-grid[data-preset='true'] .ind-picker,
.ind-grid[data-preset='true'] .ind-lock-panel,
.ind-grid[data-preset='true'] .ind-col1,
.ind-grid[data-preset='true'] .ind-col3 { grid-row: 2; }
.ind-tournament-banner {
  grid-column: 1 / -1; grid-row: 1;
  display: flex; align-items: center; justify-content: center;
  padding: 11px 18px; box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--ui-gold) 65%, #000);
  border-radius: 6px; background: linear-gradient(90deg, #151109, #241a08 50%, #151109);
  box-shadow: 0 4px 14px rgba(0, 0, 0, .55);
  font-size: max(var(--ui-min-primary-text-size, 16px), 15px);
  letter-spacing: .3em; text-transform: uppercase;
  color: var(--ui-gold-bright); text-shadow: 0 0 10px var(--ui-gold);
}

.ind-spacer { flex: 1; }
.cap { font-size: max(var(--ui-min-text-size, 12px), 1.2em); }
.nbsp { white-space: pre; }

.ind-picker, .ind-summary {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  max-height: 100%;
  min-height: 0;
  box-sizing: border-box;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface-2);
  box-shadow: 0 10px 30px rgba(0, 0, 0, .7);
  overflow: hidden;
}
.ind-summary[data-dimmed='true'] { opacity: .55; filter: grayscale(.3); }
.ind-picker-head, .ind-blades, .ind-sum-head, .ind-funds, .ind-foot { flex: 0 0 auto; }

/* Seat color language. In play these variables mean local/opposition; passive views map them
   to home/away. Reuse the established coach-panel palette for immediate recognition. */
.ind-summary.ind-seat-blue, .ind-dock.ind-seat-blue {
  --ind-seat-accent: var(--seat-home-text, #4a86fe);
  --ind-seat-border: var(--seat-home-mid, #003eb3);
  --ind-seat-head: var(--seat-home-deep, #080c64);
}
.ind-summary.ind-seat-red, .ind-dock.ind-seat-red {
  --ind-seat-accent: var(--seat-away-text, #fe6666);
  --ind-seat-border: var(--seat-away-mid, #b30000);
  --ind-seat-head: var(--seat-away-deep, #7f0000);
}
/* Owner 10-11: the client's seat colours, kept DEEP top to bottom (never washing out to a pale blue / pink), the
   user's interface font, one accent edge on the outer side (mirrored, as the coach corners are). */
.ind-summary.ind-seat-blue,
.ind-summary.ind-seat-red {
  font-family: var(--ui-font, var(--font-display));
  border-color: var(--ind-seat-border);
  border-radius: 4px;
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--ind-seat-head) 64%, #07090c),
    color-mix(in srgb, var(--ind-seat-head) 38%, #07090c));
  box-shadow: 0 10px 30px rgba(0, 0, 0, .7), inset 0 0 0 2px rgba(0, 0, 0, .35),
    inset 0 1px 0 color-mix(in srgb, var(--ind-seat-accent) 30%, transparent);
}
/* Owner 10-11: a gold ring round the panel of the coach who is selecting. It is drawn OUTSIDE the panel's own border
   (box-shadow, so it follows the radius, takes no space and is not clipped by the panel's overflow), which leaves the
   whole seat-coloured border, the accent edge included, visible inside it. The gold is the SELECTING chip's border
   gold (one variable for both). One short transition as it moves between the panels; nothing loops. */
.ind-summary { --ind-selecting-gold: color-mix(in srgb, var(--ui-gold) 75%, #000); transition: box-shadow .25s ease; }
.ind-summary.ind-seat-blue[data-selecting='true'],
.ind-summary.ind-seat-red[data-selecting='true'] {
  box-shadow: 0 0 0 2px var(--ind-selecting-gold), 0 0 12px 1px color-mix(in srgb, var(--ui-gold) 40%, transparent),
    0 10px 30px rgba(0, 0, 0, .7), inset 0 0 0 2px rgba(0, 0, 0, .35),
    inset 0 1px 0 color-mix(in srgb, var(--ind-seat-accent) 30%, transparent);
}
@media (prefers-reduced-motion: reduce) { .ind-summary { transition: none; } }
.ind-summary.ind-col1 { border-left: 3px solid var(--ind-seat-accent); }
.ind-summary.ind-col3 { border-right: 3px solid var(--ind-seat-accent); }

/* Picker header + blinking stencil. */
.ind-picker-head {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 18px; background: #151515; border-bottom: 1px solid #2a2a2a;
}
.ind-title { font-size: max(var(--ui-min-primary-text-size, 16px), 16px); letter-spacing: .16em; color: var(--ui-heading); }
.ind-stencil {
  font-size: max(var(--ui-min-primary-text-size, 16px), 15px); letter-spacing: .22em; white-space: nowrap;
  animation: ind-roleblink 1.1s step-end infinite;
}
.ind-stencil[data-role='overdog'] { color: var(--ui-heading); text-shadow: 0 0 10px var(--ui-heading); }
.ind-stencil[data-role='underdog'] { color: var(--ui-gold); text-shadow: 0 0 10px var(--ui-gold); }
@keyframes ind-roleblink { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { .ind-stencil { animation: none; } }

/* Blade row — 3 equal columns, 3px primary underline. */
.ind-blades {
  display: grid; grid-template-columns: 1fr 1fr 1fr;
  background: #151515; border-bottom: 3px solid var(--ui-primary);
}
.ind-blade {
  appearance: none; border: 0; background: transparent;
  padding: 10px 6px; text-align: center; cursor: pointer;
  font-family: inherit; font-size: max(var(--ui-min-primary-text-size, 16px), 13px); letter-spacing: .12em; color: var(--ui-muted);
}
.ind-blade:hover { color: #fff; }
.ind-blade[data-active='true'] {
  color: var(--ui-text-on-primary); background: var(--ui-primary);
  box-shadow: inset 0 3px 0 var(--ui-heading);
}

/* Picker card grids. */
.ind-cardgrid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(215px, 1fr)); gap: 10px; padding: 14px 16px;
  flex: 1; min-height: 0; overflow-y: auto; align-content: start;
}
.ind-cardgrid[data-blade='stars'], .ind-cardgrid[data-blade='mercenaries'] { grid-template-columns: repeat(auto-fill, minmax(235px, 1fr)); }
.ind-card {
  display: flex; flex-direction: column; gap: 7px;
  padding: 10px; border: 1px solid #333; border-radius: 5px; background: #1e1e1e;
  cursor: pointer;
}
.ind-card[data-live='false'] { opacity: .55; cursor: default; pointer-events: none; }
.ind-card[data-live='true']:hover { border-color: var(--ui-primary); background: #250a0b; }
.ind-card-top { display: flex; align-items: center; gap: 9px; }
.ind-card-id { min-width: 0; flex: 1; }
.ind-card-name { font-size: max(var(--ui-min-text-size, 12px), 12px); color: var(--ui-eggshell); letter-spacing: .03em; line-height: 1.3; }
.ind-card-count { font-size: max(var(--ui-min-text-size, 12px), 10px); color: var(--ui-muted); }
.ind-card-cost { font-size: max(var(--ui-min-text-size, 12px), 12px); color: var(--ui-gold-bright); white-space: nowrap; }

/* Glyph placeholder tile (owner: swap to upstream inducement icons when located). */
.ind-icon {
  width: 40px; height: 40px; border-radius: 4px; flex: 0 0 auto; /* owner 09-06: 34 -> 40, icon box 26 -> 32 */
  background: #242424; border: 2px outset #4a4a4a;
  display: flex; align-items: center; justify-content: center; font-size: max(var(--ui-min-primary-text-size, 16px), 15px);
}
.ind-icon img { max-width: 32px; max-height: 32px; image-rendering: auto; } /* owner 09-06: box-filtered, not decimated */
/* 4-column sprite sheet, frame-1 crop (README sprite rule). Enlarge that frame
   25% and crop evenly into the existing tile so the player reads as a close-up
   rather than a pitch-scale token; -5.25px = half the 42px frame's zoom excess. */
.ind-portrait {
  width: 42px; height: 42px; flex: 0 0 auto; border-radius: 4px;
  background-color: #242424; border: 1px solid #333;
  background-size: 500% auto; background-position: -5.25px -5.25px; background-repeat: no-repeat;
  image-rendering: pixelated;
  display: flex; align-items: center; justify-content: center; font-size: max(var(--ui-min-primary-text-size, 16px), 15px); color: var(--ui-gold-bright);
}
/* Uploaded player sprites are normalized to one 64px frame, not a four-frame
   iconset sheet. Give them the same close-up treatment without sheet cropping. */
.ind-portrait[data-source='custom'] { background-size: 125% auto; background-position: center bottom; }
/* Owner 10-26: a walk sheet's idle frame arrives already cropped to the figure (square, feet on the floor, 2x), so it
   fills the tile whole: no sheet crop, no extra zoom. */
.ind-portrait[data-source='walker'] { background-size: contain; background-position: center bottom; }
.ind-stats { display: flex; gap: 5px; }
.ind-stat { flex: 1; background: #242424; border: 1px solid #333; border-radius: 3px; padding: 3px 0; text-align: center; }
.ind-stat-v { font-size: max(var(--ui-min-text-size, 12px), 11px); color: #fff; }
.ind-stat-k { font-size: max(var(--ui-min-text-size, 12px), 8px); letter-spacing: .08em; color: var(--ui-skill-strength); }
.ind-skills { font-size: max(var(--ui-min-text-size, 12px), 10px); line-height: 1.5; }
.ind-sep { color: #555; }
.ind-special { font-size: max(var(--ui-min-text-size, 12px), 10px); letter-spacing: .04em; color: var(--ui-gold-bright); }
.ind-empty, .ind-watch { padding: 20px; font-size: max(var(--ui-min-text-size, 12px), 12px); color: #777; text-align: center; }
.ind-watch { color: var(--ui-gold); letter-spacing: .1em; padding: 34px 20px; }
.ind-watch { flex: 1; }
.ind-preset {
  display: flex; flex: 1; min-height: 210px; box-sizing: border-box;
  flex-direction: column; align-items: center; justify-content: center; gap: 22px;
  padding: 34px 28px; text-align: center;
}
.ind-preset-copy {
  max-width: 520px; color: var(--ui-eggshell);
  font-size: max(var(--ui-min-primary-text-size, 16px), 14px); line-height: 1.6; letter-spacing: .04em;
}

/* Done — the same command-panel chrome used by current pitch decisions. */
.ind-lock-panel { align-self: start; }
.ind-lock-panel :deep(.pitch-confirm-body) {
  flex-direction: column;
  gap: 5px;
}
.ind-lock-copy { display: flex; align-items: center; justify-content: center; gap: 10px; }
.ind-lock-tick {
  color: var(--ui-success);
  font-size: max(var(--ui-min-primary-text-size, 16px), 18px);
  text-shadow: 0 0 9px color-mix(in srgb, var(--ui-success) 65%, transparent);
}
.ind-lock-text {
  color: var(--ui-eggshell);
  font-size: max(var(--ui-min-primary-text-size, 16px), 13px);
  letter-spacing: .1em;
}
.ind-lock-note {
  color: var(--ui-muted);
  font-size: max(var(--ui-min-text-size, 12px), 11px);
  letter-spacing: .12em;
  text-transform: uppercase;
}

/* Side panels (owner 10-11). Everything above the pinned action row is one scroll region; inside it the selections
   area takes what is left and its list scrolls on its own, down to a floor below which the region scrolls instead. */
.ind-sum-scroll { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.ind-sum-head {
  display: flex; flex-direction: column; gap: 12px;
  padding: 11px 12px 12px;
  background: linear-gradient(135deg,
    color-mix(in srgb, var(--ind-seat-head) 14%, #05070a),
    color-mix(in srgb, var(--ind-seat-head) 30%, #0e1116));
  border-bottom: 2px solid color-mix(in srgb, var(--ind-seat-accent) 55%, #14171c);
  box-shadow: 0 2px 0 rgba(0, 0, 0, .6), inset 0 1px 0 rgba(255, 255, 255, .12);
}
.ind-team { display: flex; align-items: center; gap: 10px; min-height: 56px; }
.ind-team-logo {
  width: 54px; height: 56px; flex: 0 0 auto; box-sizing: border-box; object-fit: contain;
  background: #030508; border: 1px solid #454b54; border-radius: 2px;
  box-shadow: 0 0 0 2px #000, inset 0 0 6px #000;
  image-rendering: pixelated; /* as the coach-corner crest (.race-logo) */
}
.ind-team-logo-fallback {
  display: flex; align-items: center; justify-content: center;
  color: var(--ind-seat-accent); font-size: max(var(--ui-min-primary-text-size, 16px), 1.6rem);
}
/* Long names wrap between words, then anywhere; they are never clipped or shrunk. */
.ind-team-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
/* Owner 10-14: the coach, one muted line under the team name; smaller than it, never bold. */
.ind-team-coach {
  min-width: 0; overflow-wrap: anywhere; font-weight: 400; line-height: 1.2; letter-spacing: .03em;
  font-size: max(var(--ui-min-text-size, 13px), 0.8125rem);
  color: color-mix(in srgb, var(--ind-seat-accent) 10%, #9aa3ad);
}
.ind-team-name {
  flex: 1; min-width: 0; overflow-wrap: anywhere;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.0625rem); line-height: 1.2; letter-spacing: .05em;
  color: color-mix(in srgb, var(--ind-seat-accent) 22%, #fff); text-shadow: 0 2px 0 #000;
}

/* Owned resources. MIRRORS the coach-corner slot exactly (SpectateView `.inducement` / `.inducement-quantity`): same
   gradient, edge, radius, inset, the 64px icon box that fills the tile, and the same quantity pill. Mirrored rather
   than reused because those classes carry HUD-style variants (.hud-minimalist / .hud-chrome) and live in the view.
   Three per row, 8px gaps; the grid is capped at three 64px tiles so the tiles keep the corner slot's size at any
   panel width, and the panel never has to grow to fit them. */
.ind-staff { width: 100%; max-width: 208px; margin: 0 auto; box-sizing: border-box; }
/* The group's heading: on the grid's left edge (the block is centred and capped, so not the panel's), no rule under it. */
.ind-staff-heading {
  margin: 0 0 8px; text-align: left;
  font-size: max(var(--ui-min-text-size, 12px), 0.8125rem); line-height: 1.1; letter-spacing: .12em;
  color: var(--ui-muted);
}
.ind-res-grid {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;
  width: 100%; box-sizing: border-box;
}
.ind-res {
  position: relative; display: grid; place-items: center;
  width: 100%; height: auto; min-width: 0; aspect-ratio: 1; box-sizing: border-box;
  background: linear-gradient(180deg, #292d33, #111317);
  border: 1px solid #454b54; border-radius: 2px; padding: 1px;
  box-shadow: inset 0 1px 0 #626a75, 0 1px 2px #000;
}
.ind-res img { width: 64px; height: 64px; max-width: 100%; max-height: 100%; object-fit: contain; image-rendering: auto; }
/* A count the model does not carry: the same pill, muted, holding the dash. */
.ind-res-qty[data-known='false'] { background: #2a2e35; border-color: #5a616c; color: var(--ui-muted); }
.ind-res-qty {
  position: absolute; z-index: 2; pointer-events: none;
  top: -6px; right: -5px; min-width: 16px; padding: 1px 3px;
  border: 1px solid #ff6a60; border-radius: 7px; background: #b30e14; color: #fff;
  font-size: max(var(--ui-min-text-size, 12px), 0.54rem); line-height: 1.05; text-align: center;
  text-shadow: 0 1px 1px #000; box-shadow: 0 1px 3px #000d;
}

/* Status + funds. Handoff reference sizes: labels 16px, values 20px (rem, floored by the user's text sizes). */
.ind-funds { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 12px 12px 2px; }
.ind-status {
  padding: 6px 12px; border-radius: 2px; white-space: nowrap;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); letter-spacing: .12em;
  color: var(--ui-gold-bright);
  background: linear-gradient(100deg, color-mix(in srgb, var(--ui-gold) 36%, #14110a), color-mix(in srgb, var(--ui-gold) 12%, #14110a));
  border: 1px solid var(--ind-selecting-gold); border-left: 3px solid var(--ui-gold-bright);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .14), 0 2px 3px rgba(0, 0, 0, .4); text-shadow: 0 1px 0 #000;
}
.ind-cash { display: flex; flex-direction: column; align-self: stretch; }
.ind-cash-line {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  padding: 7px 0; border-bottom: 1px solid rgba(255, 255, 255, .08);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); letter-spacing: .06em;
  color: var(--ui-text); white-space: nowrap; text-shadow: 0 1px 2px #000;
}
.ind-cash-line > :last-child { font-size: max(var(--ui-min-primary-text-size, 16px), 1.25rem); font-variant-numeric: tabular-nums; }
.ind-cash-gold { color: var(--ui-gold-bright); }
.ind-cash-green { color: var(--ui-success); }
.ind-cash-unknown { color: var(--ui-muted); }
.ind-cash-est { margin-top: 3px; text-align: right; font-size: max(var(--ui-min-text-size, 12px), .85rem); letter-spacing: .04em; color: var(--ui-muted); }

/* Selections. The enlarged inset box carries "Nothing selected yet." and the waiting text (reference 17px). */
.ind-sum-picks { display: flex; flex-direction: column; flex: 1 1 0; min-height: 132px; }
.ind-sum-note {
  display: flex; align-items: center; justify-content: center; flex: 0 0 auto;
  min-height: 98px; box-sizing: border-box; margin: 10px 12px 4px; padding: 18px 10px;
  background: linear-gradient(135deg, rgba(4, 6, 10, .74), rgba(10, 13, 18, .6));
  border: 1px solid rgba(255, 255, 255, .14); border-top-color: rgba(255, 255, 255, .24); border-radius: 2px;
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, .55);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.0625rem); line-height: 1.4; letter-spacing: .05em;
  color: var(--ui-text); text-align: center; text-shadow: 0 2px 0 #000;
}
.ind-sum-list {
  display: grid; grid-template-columns: 1fr; gap: 10px; padding: 12px;
  flex: 1; min-height: 0; overflow-y: auto; align-content: start;
}
/* A SHORT pane (720p / 900p windows, or a zoomed one) cannot hold the header, the funds and a useful list at once:
   there the list stops scrolling on its own and the whole region above the action row scrolls as one, so the list is
   never a one-card slot and there is never a scrollbar inside a scrollbar. Keyed off the pane's own height (the phase
   is zoomed on large windows, so the viewport height says little). An engine without container queries keeps the
   two-level behaviour above. */
.ind-summary { container: indpanel / size; }
/* Slim seat-tinted scrollbars: a default bar is a white slab on these dark panes. */
.ind-sum-scroll, .ind-sum-list {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--ind-seat-accent, #8a9099) 55%, #14171c) transparent;
}
@container indpanel (max-height: 720px) {
  .ind-sum-picks { flex: 0 0 auto; min-height: 0; }
  .ind-sum-picks .ind-sum-list { flex: 0 0 auto; overflow-y: visible; }
}
.ind-sum-card {
  position: relative; display: flex; flex-direction: column; gap: 7px;
  padding: 10px; border: 1px solid #333; border-radius: 5px; background: #1e1e1e;
}
.ind-badge {
  position: absolute; top: -7px; right: -6px; min-width: 22px; height: 22px; box-sizing: border-box;
  padding: 0 5px; background: var(--ui-primary); border: 2px outset #a83236; border-radius: 11px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, .6);
  display: flex; align-items: center; justify-content: center;
  font-size: max(var(--ui-min-text-size, 12px), 11px); color: #fff; letter-spacing: .04em;
}
.ind-sum-top { display: flex; align-items: center; gap: 9px; }
.ind-kind { font-size: max(var(--ui-min-text-size, 12px), 10px); letter-spacing: .08em; }
.ind-kind[data-kind='inducements'] { color: var(--ui-skill-strength); }
.ind-kind[data-kind='stars'] { color: var(--ui-gold-bright); }
.ind-kind[data-kind='mercenaries'] { color: var(--ui-skill-general); }
.ind-x {
  width: 20px; height: 19px; flex: 0 0 auto; padding: 0;
  border: 1px solid #444; border-radius: 3px; background: transparent;
  color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 10px); font-family: inherit; cursor: pointer;
}
.ind-x:hover { color: var(--ui-skill-strength); border-color: var(--ui-primary); }
.ind-sum-total { display: flex; align-items: center; gap: 8px; font-size: max(var(--ui-min-text-size, 12px), 11px); }

/* The pinned action row: the only footer. Clear / Confirm, or the confirmed plate. */
.ind-foot {
  display: flex; justify-content: center; align-items: center;
  padding: 10px 12px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--ind-seat-head) 24%, #0b0e13), #07090c);
  border-top: 1px solid var(--ind-seat-border); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .1);
}
.ind-actions { gap: 10px; }
.ind-btn {
  padding: 9px 22px; border-radius: 4px; box-shadow: 0 2px 6px rgba(0, 0, 0, .5);
  font-family: inherit; font-size: max(var(--ui-min-text-size, 12px), 12px); letter-spacing: .1em; cursor: pointer;
}
.ind-btn:hover:not(:disabled) { filter: brightness(1.25); }
.ind-btn:disabled { opacity: .5; cursor: default; }
.ind-btn-neutral { background: #242424; border: 2px outset #4a4a4a; color: #cfd4cf; }
.ind-rosters-btn { margin-right: 12px; padding: 6px 14px; white-space: nowrap; }
.ind-btn-primary { padding: 9px 26px; background: var(--ui-primary); border: 2px outset #a83236; color: var(--ui-text-on-primary); }
/* A coach who has confirmed: ONE button-shaped plate where Clear / Confirm were. It is a status, not a control. */
.ind-btn.ind-confirmed {
  flex: 1; text-align: center; cursor: default; user-select: none;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); letter-spacing: .14em;
  color: var(--ui-success); background: color-mix(in srgb, var(--ui-success) 16%, #0a0d0b);
  border: 2px solid color-mix(in srgb, var(--ui-success) 55%, #000);
}
.ind-btn.ind-confirmed:hover:not(:disabled) { filter: none; }

@media (max-width: 1020px) {
  .ind-picker, .ind-summary { height: auto; max-height: none; }
  .ind-cardgrid, .ind-sum-list { overflow-y: visible; }
  .ind-summary { container-type: normal; } /* stacked panes take their content height */
  .ind-sum-scroll { overflow-y: visible; }
  .ind-sum-picks { flex: 0 0 auto; min-height: 0; }
}
.ind-watch-inline { padding: 6px 0 10px; flex: 0 0 auto; } /* owner 09-23: the note sits on the grid; .ind-watch's flex:1 left a gap above it */
.ind-cardgrid[data-readonly="true"] .ind-card { cursor: default; }
</style>
