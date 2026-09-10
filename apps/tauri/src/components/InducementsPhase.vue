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
import { computed } from 'vue';
import PitchConfirmationPanel from './PitchConfirmationPanel.vue';
import type { Blade, InducementPhase, InducementRole, PhaseMoney, PhaseOption, PickMap } from '../game/inducementsPhase';
import { canAdd, fmtGold, skillToken } from '../game/inducementsPhase';

/** A star/merc sprite resolved by the mount. Iconsets use the frame-1 sheet crop;
 *  custom assets are already-normalized standalone 64px player sprites. */
export interface Portrait { url: string | null; glyph: string; source?: 'iconset' | 'custom' }

export interface PickerCard {
  key: string;
  name: string;
  cost: number;
  /** "N of M taken" / "N of M hired" / "1 available" | "Hired". */
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
  /** "TeamName · CoachName" footer strip — always present. */
  team: string;
  status: 'selecting' | 'confirmed' | 'waiting';
  money: PhaseMoney | null;
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
  /** Upstream selector caps (stars/mercenaries/staff) so at-limit cards dim. */
  selectorLimits: { stars: number; mercenaries: number; staff: number };
  /** Disable Confirm between send and server ack. */
  confirmPending: boolean;
  /** Read-only, server-authored predefined allocations. No purchase wire exists in this mode. */
  presetMode?: boolean;
}>(), { viewerMode: 'play', presetMode: false });

const emit = defineEmits<{
  (e: 'blade', blade: Blade): void;
  (e: 'add', key: string): void;
  (e: 'remove', key: string): void;
  (e: 'clear'): void;
  (e: 'confirm'): void;
  (e: 'acknowledge'): void;
}>();

const BLADES: { id: Blade; label: string }[] = [
  { id: 'inducements', label: 'Inducements' },
  { id: 'stars', label: 'Star Players' },
  { id: 'mercenaries', label: 'Mercenaries' },
];

/** Raised caps (README): each word's initial capital renders at 1.2em. */
function words(text: string): { head: string; rest: string; space: boolean }[] {
  return text.split(' ').map((w, i) => ({ head: w.slice(0, 1), rest: w.slice(1), space: i > 0 }));
}

const roleLabel = computed(() => props.presetMode
  ? 'PRESET ROSTERS'
  : (props.phase === 'overdog' ? 'OVERDOG is selecting…' : 'UNDERDOG is selecting…'));
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

function onCard(card: PickerCard): void {
  if (cardLive(card)) emit('add', card.key);
}

const statusText = (s: PanelView['status']) => props.presetMode
  ? '✔ Assigned'
  : (s === 'selecting' ? 'Selecting…' : s === 'confirmed' ? '✔ Confirmed' : '⧗ Waiting…');

/** Underdog-only waiting strip, spec footer #2. */
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
</script>

<template>
  <div id="indgrid" class="ind-grid" data-testid="inducements-phase" :data-phase="phase" :data-preset="presetMode">
    <!-- Preset (tournament/league) allocations: full-width banner over the whole phase. -->
    <div v-if="presetMode" class="ind-tournament-banner" data-testid="tournament-banner">
      <template v-for="(w, i) in words('Tournament Mode')" :key="i"><span v-if="w.space" class="nbsp">&nbsp;</span><span class="cap">{{ w.head }}</span>{{ w.rest }}</template>
    </div>
    <!-- ── Centre: picker, or the full-width lock banner once both coaches confirm ── -->
    <section v-if="!isDone" class="ind-picker" data-testid="ind-picker">
      <!-- Header: title left, blinking phase stencil right-justified on the SAME line. -->
      <div class="ind-picker-head">
        <div class="ind-title">
          <template v-for="(w, i) in words(presetMode ? 'Predefined Inducements' : 'Inducements')" :key="i"><span v-if="w.space" class="nbsp">&nbsp;</span><span class="cap">{{ w.head }}</span>{{ w.rest }}</template>
        </div>
        <span class="ind-spacer" />
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
          These inducements were assigned by the tournament or league. Review both teams before kick-off.
        </div>
        <button type="button" class="ind-btn ind-btn-primary" data-testid="acknowledge-btn" @click="emit('acknowledge')">
          ✔ <span class="cap">A</span>cknowledge
        </button>
      </div>

      <div v-else-if="!canAct" class="ind-watch" data-testid="picker-waiting">
        ⧗ {{ phase === 'overdog' ? 'Overdog' : 'Underdog' }} is choosing inducements…
      </div>

      <div v-else class="ind-cardgrid" :data-blade="blade">
        <div v-for="c in cards[blade]" :key="c.key" class="ind-card" :data-blade="blade"
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
              <div class="ind-card-name">{{ c.name }}</div>
              <div class="ind-card-count">{{ c.countLabel }}</div>
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
              <span :style="{ color: skillToken(sk) }">{{ sk }}</span><span v-if="i < c.skills.length - 1" class="ind-sep">, </span>
            </span>
          </div>
          <div v-if="c.special" class="ind-special">★ {{ c.special }}</div>
        </div>
        <div v-if="!cards[blade].length" class="ind-empty">— nothing offered on this blade —</div>
      </div>
    </section>

    <PitchConfirmationPanel v-else class="ind-lock-panel"
      title="Inducements Confirmed" label="Confirmed inducements" test-id="lock-banner"
      :position-style="{ position: 'relative', top: 'auto', left: 'auto', transform: 'none', minWidth: '0', maxWidth: 'none', width: '100%' }">
      <div class="ind-lock-copy">
        <span class="ind-lock-tick" aria-hidden="true">✔</span>
        <span class="ind-lock-text">
          <template v-for="(w, i) in words('Both Coaches Have Confirmed — Inducements Locked')" :key="i"><span v-if="w.space" class="nbsp">&nbsp;</span><span class="cap">{{ w.head }}</span>{{ w.rest }}</template>
        </span>
      </div>
      <div class="ind-lock-note">Waiting for kick-off…</div>
    </PitchConfirmationPanel>

    <!-- ── Mirrored summaries: local seat left in play; stable role order when passive. ── -->
    <section v-for="(panel, panelIndex) in orderedPanels" :key="panel.role" class="ind-summary"
      :class="[panelIndex === 0 ? 'ind-col1' : 'ind-col3', `ind-seat-${panelColor(panel)}`]"
      :data-role="panel.role" :data-seat="panel.seat" :data-seat-color="panelColor(panel)"
      :data-seat-relation="panelRelation(panel)" :data-dimmed="panel.dimmed" :data-testid="`summary-${panel.role}`">
      <div class="ind-sum-head">
        <div class="ind-sum-row">
          <div class="ind-sum-title">
            <template v-for="(w, i) in words('Selected Inducements')" :key="i"><template v-if="i">{{ ' ' }}</template><span class="cap">{{ w.head }}</span>{{ w.rest }}</template>
          </div>
          <span class="ind-rolechip" :data-role="panel.role" :data-inactive="panel.role !== phase && phase !== 'done'">
            {{ presetMode ? (panel.seat === 'home' ? 'HOME' : 'AWAY') : (panel.role === 'overdog' ? 'OVERDOG' : 'UNDERDOG') }}
          </span>
        </div>
        <div class="ind-sum-row ind-sum-row2">
          <span class="ind-status" :data-status="panel.status" :data-testid="`status-${panel.role}`">{{ statusText(panel.status) }}</span>
          <span class="ind-spacer" />
          <div class="ind-cash" :data-testid="`cash-${panel.role}`">
            <!-- Overdog: one treasury pool (usesTreasury leg). Underdog: petty → scum → treasury. -->
            <template v-if="panel.money && panel.role === 'overdog'">
              <div class="ind-cash-line"><span class="ind-cash-k">Spent</span> <span class="ind-cash-gold">{{ fmtGold(panel.money.spent) }}</span></div>
              <div class="ind-cash-line"><span class="ind-cash-k">Remaining</span> <span class="ind-cash-green">{{ fmtGold(panel.money.remaining) }}</span></div>
            </template>
            <template v-else-if="panel.money">
              <div class="ind-cash-line"><span class="ind-cash-k">Petty Cash</span> <span class="ind-cash-gold">{{ fmtGold(panel.money.pettyLeft) }}</span></div>
              <div class="ind-cash-line"><span class="ind-cash-k">Scum Cash</span> <span class="ind-cash-green">{{ fmtGold(panel.money.scumLeft) }}</span></div>
              <div class="ind-cash-line"><span class="ind-cash-k">Treasury</span> <span class="ind-cash-gold">{{ fmtGold(panel.money.treasuryLeft) }}</span></div>
            </template>
            <div v-else class="ind-cash-line ind-cash-unknown">—</div>
          </div>
        </div>
      </div>

      <div v-if="!panel.cards.length" class="ind-sum-empty">{{ panel.emptyNote }}</div>
      <div v-else class="ind-sum-list">
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
              <div class="ind-card-name">{{ c.name }}</div>
              <div class="ind-kind" :data-kind="c.blade">{{ c.kind }}</div>
            </div>
            <button v-if="panel.editable && c.removable !== false" type="button" class="ind-x" :data-testid="`remove-${c.key}`" @click="emit('remove', c.key)">✕</button>
          </div>
          <div v-if="c.skills.length" class="ind-skills">
            <span v-for="(sk, i) in c.skills" :key="sk">
              <span :style="{ color: skillToken(sk) }">{{ sk }}</span><span v-if="i < c.skills.length - 1" class="ind-sep">, </span>
            </span>
          </div>
          <div v-if="c.totalLabel !== null" class="ind-sum-total"><span class="ind-spacer" /><span class="ind-cash-gold">{{ c.totalLabel }}</span></div>
        </div>
      </div>

      <!-- Footers, in spec order: team strip → underdog waiting strip → action row. -->
      <div class="ind-foot ind-foot-team">{{ panel.team }}</div>
      <div v-if="panel.role === 'underdog' && underdogWaiting" class="ind-foot ind-foot-wait" data-testid="underdog-waiting">
        ⧗ <template v-for="(w, i) in words('Waiting for Overdog…')" :key="i"><span v-if="w.space" class="nbsp">&nbsp;</span><span class="cap">{{ w.head }}</span>{{ w.rest }}</template>
      </div>
      <div v-if="panel.editable && panel.role === mySide && canAct" class="ind-foot ind-actions">
        <button type="button" class="ind-btn ind-btn-neutral" data-testid="clear-btn" @click="emit('clear')">
          <span class="cap">C</span>lear
        </button>
        <button type="button" class="ind-btn ind-btn-primary" data-testid="confirm-btn" :disabled="confirmPending" @click="emit('confirm')">
          ✔ <span class="cap">C</span>onfirm
        </button>
      </div>
    </section>
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
  font-family: 'Nuffle', system-ui, sans-serif;
  color: var(--ui-text);
  overflow-x: hidden;
}
/* Below 1020px: single column, source order (picker, then Overdog, then Underdog). */
@media (max-width: 1020px) {
  .ind-grid { grid-template-columns: minmax(0, 760px); grid-template-rows: none; }
  .ind-grid > * { grid-column: 1 !important; grid-row: auto !important; }
}
.ind-picker, .ind-lock-panel { grid-column: 2; grid-row: 1; }
.ind-col1 { grid-column: 1; grid-row: 1; }
.ind-col3 { grid-column: 3; grid-row: 1; }

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
.ind-picker-head, .ind-blades, .ind-sum-head, .ind-foot { flex: 0 0 auto; }

/* Seat color language. In play these variables mean local/opposition; passive views map them
   to home/away. Reuse the established coach-panel palette for immediate recognition. */
.ind-summary.ind-seat-blue {
  --ind-seat-accent: var(--seat-home-text, #4a86fe);
  --ind-seat-border: var(--seat-home-mid, #003eb3);
  --ind-seat-head: var(--seat-home-deep, #080c64);
  --ind-seat-foot: color-mix(in srgb, var(--seat-home-deep, #080c64) 74%, #05070b);
}
.ind-summary.ind-seat-red {
  --ind-seat-accent: var(--seat-away-text, #fe6666);
  --ind-seat-border: var(--seat-away-mid, #b30000);
  --ind-seat-head: var(--seat-away-deep, #7f0000);
  --ind-seat-foot: color-mix(in srgb, var(--seat-away-deep, #7f0000) 74%, #05070b);
}
.ind-summary.ind-seat-blue,
.ind-summary.ind-seat-red {
  border-color: var(--ind-seat-border);
  box-shadow: 0 10px 30px rgba(0, 0, 0, .7), 0 0 0 1px color-mix(in srgb, var(--ind-seat-accent) 22%, transparent);
}

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
.ind-stats { display: flex; gap: 5px; }
.ind-stat { flex: 1; background: #242424; border: 1px solid #333; border-radius: 3px; padding: 3px 0; text-align: center; }
.ind-stat-v { font-size: max(var(--ui-min-text-size, 12px), 11px); color: #fff; }
.ind-stat-k { font-size: max(var(--ui-min-text-size, 12px), 8px); letter-spacing: .08em; color: var(--ui-skill-strength); }
.ind-skills { font-size: max(var(--ui-min-text-size, 12px), 10px); line-height: 1.5; }
.ind-sep { color: #555; }
.ind-special { font-size: max(var(--ui-min-text-size, 12px), 10px); letter-spacing: .04em; color: var(--ui-gold-bright); }
.ind-empty, .ind-watch, .ind-sum-empty { padding: 20px; font-size: max(var(--ui-min-text-size, 12px), 12px); color: #777; text-align: center; }
.ind-watch { color: var(--ui-gold); letter-spacing: .1em; padding: 34px 20px; }
.ind-watch, .ind-sum-empty { flex: 1; }
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

/* Summary panes. */
.ind-sum-head {
  display: flex; flex-direction: column; gap: 8px;
  padding: 11px 18px;
  background: linear-gradient(135deg, var(--ind-seat-head), #151515 78%);
  border-bottom: 2px solid var(--ind-seat-accent);
}
.ind-sum-row { display: flex; align-items: center; gap: 12px; }
.ind-sum-row2 { align-items: flex-start; }
/* Break "Selected Inducements" between words at the narrow (240–300px) summary
   column instead of overflowing into the role chip. The shared words() helper is
   rendered here with a real breakable space ({{ ' ' }}, preserved through Vue's
   whitespace condense) rather than the &nbsp; the other headings use — nbsp never
   wraps. min-width:0 lets the flex item shrink so the space becomes a break point. */
.ind-sum-title { font-size: max(var(--ui-min-primary-text-size, 16px), 13px); letter-spacing: .14em; color: var(--ind-seat-accent); flex: 1; min-width: 0; }
.ind-rolechip {
  font-size: max(var(--ui-min-text-size, 12px), 10px); letter-spacing: .12em; padding: 2px 8px; border-radius: 3px;
  border: 1px solid currentColor; white-space: nowrap;
}
.ind-summary .ind-rolechip { color: var(--ind-seat-accent); }
.ind-rolechip[data-inactive='true'] { opacity: .7; }
.ind-status {
  font-size: max(var(--ui-min-text-size, 12px), 11px); letter-spacing: .1em; border-radius: 3px; padding: 3px 10px; white-space: nowrap;
  border-left: 3px solid var(--ind-seat-accent);
}
.ind-status[data-status='selecting'] { color: var(--ui-gold); background: #241a08; }
.ind-status[data-status='confirmed'] { color: var(--ui-success); background: #0f2411; }
.ind-status[data-status='waiting'] { color: var(--ui-muted); background: #1e1e1e; }
.ind-cash { display: flex; flex-direction: column; gap: 3px; align-items: flex-end; }
.ind-cash-line { font-size: max(var(--ui-min-text-size, 12px), 12px); letter-spacing: .08em; color: #cfd4cf; white-space: nowrap; }
.ind-cash-k { color: var(--ui-muted); }
.ind-cash-gold { color: var(--ui-gold-bright); }
.ind-cash-green { color: var(--ui-success); }
.ind-cash-unknown { color: #666; }

.ind-sum-list {
  display: grid; grid-template-columns: 1fr; gap: 10px; padding: 14px 16px;
  flex: 1; min-height: 0; overflow-y: auto; align-content: start;
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

.ind-foot {
  display: flex; justify-content: center; align-items: center;
  padding: 9px 16px; background: linear-gradient(90deg, var(--ind-seat-foot), #151515); border-top: 1px solid var(--ind-seat-border);
  font-size: max(var(--ui-min-text-size, 12px), 11px); color: #c7cbd2; letter-spacing: .08em; text-align: center;
}
.ind-foot-wait { color: var(--ui-gold); letter-spacing: .1em; padding: 10px 16px; }
.ind-actions { gap: 10px; padding: 12px 16px; }
.ind-btn {
  padding: 9px 22px; border-radius: 4px; box-shadow: 0 2px 6px rgba(0, 0, 0, .5);
  font-family: inherit; font-size: max(var(--ui-min-text-size, 12px), 12px); letter-spacing: .1em; cursor: pointer;
}
.ind-btn:hover:not(:disabled) { filter: brightness(1.25); }
.ind-btn:disabled { opacity: .5; cursor: default; }
.ind-btn-neutral { background: #242424; border: 2px outset #4a4a4a; color: #cfd4cf; }
.ind-btn-primary { padding: 9px 26px; background: var(--ui-primary); border: 2px outset #a83236; color: var(--ui-text-on-primary); }

@media (max-width: 1020px) {
  .ind-picker, .ind-summary { height: auto; max-height: none; }
  .ind-cardgrid, .ind-sum-list { overflow-y: visible; }
}
</style>
