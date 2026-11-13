<script setup lang="ts">
// Touch mode action center (spec-touch-mode-2026-11-12 section 4). A bar fixed at the bottom centre: Confirm and
// Cancel at the left, two rows of actions in the middle (the six fixed places on top, the selected player's other
// rows below with More / sub-menus / Back), End Turn (hold) at the right. It renders the SAME rows as the context
// menu (game/actionCenterModel.ts); every tap is handed back to the view, which runs it through the menu's own
// guards (runMenuItem). Nothing here sends anything.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { buildActionCenterModel, type ActionCenterMode, type ActionRowLike, type FixedActionSlot } from '../game/actionCenterModel';
import { createHoldAction } from '../game/holdButton';
import { $t } from '../i18n';

export interface ActionCenterRow extends ActionRowLike {
  children?: ActionCenterRow[];
  icon?: string;
}

const props = withDefaults(defineProps<{
  /** 'inspect' = only a press-and-hold row (the opponent's turn): no actions, Confirm, Cancel or End Turn. */
  mode: ActionCenterMode | 'inspect';
  rows: ActionCenterRow[];
  /** A bottom row the view puts up in place of the player's rows (press-and-hold marks, a target's choices), with Back. */
  override?: ActionCenterRow[] | null;
  /** The rows are a menu the view raised (not the player's own): the bottom row ends with Back. */
  showBack?: boolean;
  confirmLabel?: string | null;
  canCancel?: boolean;
  endTurnLabel: string;
  endTurnEnabled?: boolean;
  /** The turn / phase the bar belongs to (game, half, turns, turn mode, setup). A hold is tied to the key it started
   *  on: a change cancels it, and the emitted key lets the view check it is still the turn (review finding 8). */
  turnKey?: string;
  holdMs?: number;
  buttonPx?: number;
}>(), { override: null, showBack: false, confirmLabel: null, canCancel: false, endTurnEnabled: true, turnKey: '', holdMs: 800, buttonPx: 48 });

const emit = defineEmits<{
  run: [row: ActionCenterRow];
  confirm: [];
  cancel: [];
  endTurn: [heldOn: string];
  back: [];
  formations: [];
  savedSetups: [];
}>();

const SLOT_LABEL_KEYS: Record<FixedActionSlot, string> = {
  move: 'hud.touch.slot.move', block: 'hud.touch.slot.block', blitz: 'hud.touch.slot.blitz',
  pass: 'hud.touch.slot.pass', handOff: 'hud.touch.slot.handOff', foul: 'hud.touch.slot.foul',
};

const BOTTOM_SLOTS = 6;
const submenu = ref<ActionCenterRow | null>(null);
const showOverflow = ref(false);
// A new set of rows (a new player, a new state) closes any open sub-menu / More page.
watch(() => props.rows, () => { submenu.value = null; showOverflow.value = false; });
watch(() => props.override, () => { submenu.value = null; showOverflow.value = false; });

const model = computed(() => buildActionCenterModel(props.rows, BOTTOM_SLOTS, $t('hud.touch.notAvailable')));

type BottomEntry = { kind: 'row'; row: ActionCenterRow } | { kind: 'more' } | { kind: 'back'; from: 'submenu' | 'overflow' | 'override' };
const bottom = computed<BottomEntry[]>(() => {
  if (submenu.value) return [...(submenu.value.children ?? []).map((row) => ({ kind: 'row' as const, row })), { kind: 'back', from: 'submenu' }];
  if (props.override) return [...props.override.map((row) => ({ kind: 'row' as const, row })), { kind: 'back', from: 'override' }];
  if (showOverflow.value) return [...model.value.overflow.map((row) => ({ kind: 'row' as const, row })), { kind: 'back', from: 'overflow' }];
  const out: BottomEntry[] = model.value.visibleExtra.map((row) => ({ kind: 'row', row }));
  if (model.value.overflow.length) out.push({ kind: 'more' });
  if (props.showBack) out.push({ kind: 'back', from: 'override' });
  return out;
});

const hint = ref('');
let hintTimer: ReturnType<typeof setTimeout> | null = null;
function showHint(text: string): void {
  hint.value = text;
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hint.value = ''; hintTimer = null; }, 2200);
}

function tapRow(row: ActionCenterRow): void {
  if (row.children?.length) { submenu.value = row; return; }
  if (row.disabled) { showHint(row.hint || $t('hud.touch.notAvailable')); return; }
  submenu.value = null;
  showOverflow.value = false;
  emit('run', row);
}
function tapBottom(entry: BottomEntry): void {
  if (entry.kind === 'row') { tapRow(entry.row); return; }
  if (entry.kind === 'more') { showOverflow.value = true; return; }
  if (entry.from === 'submenu') submenu.value = null;
  else if (entry.from === 'overflow') showOverflow.value = false;
  else emit('back');
}
function tapFixed(cell: { row: ActionCenterRow | null; enabled: boolean; reason: string | null }): void {
  if (!cell.enabled || !cell.row) { showHint(cell.reason ?? $t('hud.touch.notAvailable')); return; }
  tapRow(cell.row);
}

// End Turn / End Setup: hold for holdMs with a filling ring; an early release cancels and says how to use it.
const holding = ref(false);
/** The turn and mode the current hold started on (review finding 8). */
let heldOn: { turnKey: string; mode: string } | null = null;
const endHold = createHoldAction(() => props.holdMs, () => {
  holding.value = false;
  const started = heldOn;
  heldOn = null;
  // Revalidate before emitting: still enabled, same mode, same turn.
  if (!started || !props.endTurnEnabled || props.mode !== started.mode || props.turnKey !== started.turnKey) return;
  emit('endTurn', started.turnKey);
});
function endDown(event: PointerEvent): void {
  if (!props.endTurnEnabled) return;
  try { (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId); } catch { /* a pointer the browser no longer tracks */ }
  heldOn = { turnKey: props.turnKey, mode: props.mode };
  endHold.press();
  holding.value = true;
}
function endUp(): void {
  // Always clean up the hold first, enabled or not.
  const r = endHold.release();
  holding.value = false;
  heldOn = null;
  if (!props.endTurnEnabled || r === 'hint') showHint(props.mode === 'setup' ? $t('hud.touch.holdToEndSetup') : $t('hud.touch.holdToEndTurn'));
}
// A disable, a mode change or a turn change cancels a hold in progress.
watch(() => [props.endTurnEnabled, props.mode, props.turnKey] as const, () => { endHold.cancel(); holding.value = false; heldOn = null; });
function endCancel(): void { endHold.cancel(); holding.value = false; heldOn = null; }
onBeforeUnmount(() => { endHold.cancel(); if (hintTimer) clearTimeout(hintTimer); });

const sizeStyle = computed(() => ({ '--ac-btn': `${Math.max(48, props.buttonPx)}px`, '--ac-hold-ms': `${props.holdMs}ms` }));
</script>

<template>
  <div class="action-center" :style="sizeStyle" data-testid="action-center" :data-mode="mode" role="toolbar" :aria-label="$t('hud.touch.actionCenter')"
    @contextmenu.prevent>
    <div v-if="hint" class="ac-hint" role="status" data-testid="action-center-hint">{{ hint }}</div>
    <div v-if="mode !== 'inspect'" class="ac-left">
      <button v-if="confirmLabel" type="button" class="ac-btn ac-confirm" data-testid="action-center-confirm" @click="emit('confirm')">{{ confirmLabel }}</button>
      <button v-if="canCancel" type="button" class="ac-btn ac-cancel" data-testid="action-center-cancel" @click="emit('cancel')">{{ $t('hud.touch.cancel') }}</button>
    </div>
    <div class="ac-rows">
      <div v-if="mode === 'respond' && !override" class="ac-respond-hint" data-testid="action-center-respond-hint">{{ $t('hud.touch.respondHint') }}</div>
      <div v-if="mode === 'play'" class="ac-row ac-fixed" data-testid="action-center-fixed">
        <button v-for="cell in model.fixed" :key="cell.slot" type="button" class="ac-btn ac-slot" :data-slot="cell.slot"
          :aria-disabled="!cell.enabled" :class="{ greyed: !cell.enabled }" @click="tapFixed(cell)">{{ $t(SLOT_LABEL_KEYS[cell.slot]) }}</button>
      </div>
      <div class="ac-row ac-bottom" data-testid="action-center-bottom">
        <template v-if="mode === 'setup'">
          <button type="button" class="ac-btn" data-testid="action-center-formations" @click="emit('formations')">{{ $t('hud.touch.formations') }}</button>
          <button type="button" class="ac-btn" data-testid="action-center-saved-setups" @click="emit('savedSetups')">{{ $t('hud.touch.savedSetups') }}</button>
        </template>
        <template v-for="(entry, i) in (mode === 'play' || override ? bottom : [])" :key="i">
          <button v-if="entry.kind === 'row'" type="button" class="ac-btn ac-extra" :class="{ greyed: entry.row.disabled, 'has-children': !!entry.row.children?.length }"
            :aria-disabled="!!entry.row.disabled" @click="tapBottom(entry)"><img v-if="entry.row.icon" :src="entry.row.icon" alt="" class="ac-icon" />{{ entry.row.label }}</button>
          <button v-else-if="entry.kind === 'more'" type="button" class="ac-btn ac-more" data-testid="action-center-more" @click="tapBottom(entry)">{{ $t('hud.touch.more') }}</button>
          <button v-else type="button" class="ac-btn ac-back" data-testid="action-center-back" @click="tapBottom(entry)">{{ $t('hud.touch.back') }}</button>
        </template>
      </div>
    </div>
    <div v-if="mode !== 'inspect' && mode !== 'respond'" class="ac-right">
      <button type="button" class="ac-btn ac-end" data-testid="action-center-end-turn" :class="{ holding, disabled: !endTurnEnabled }"
        :aria-disabled="!endTurnEnabled" @pointerdown="endDown" @pointerup="endUp" @pointercancel="endCancel" @pointerleave="endCancel"
        @keydown.enter.prevent @keydown.space.prevent>
        <svg class="ac-ring" viewBox="0 0 36 36" aria-hidden="true"><circle class="ac-ring-track" cx="18" cy="18" r="16" /><circle class="ac-ring-fill" cx="18" cy="18" r="16" pathLength="100" /></svg>
        <span>{{ endTurnLabel }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.action-center {
  position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); z-index: 40;
  display: flex; align-items: stretch; gap: 8px; padding: 8px;
  max-width: calc(100% - 16px);
  background: var(--sf-panel-bg, rgba(16, 20, 28, 0.92)); color: var(--sf-text, #f2f2f2);
  border: 1px solid var(--sf-panel-border, rgba(255, 255, 255, 0.18)); border-radius: 12px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
}
.ac-left, .ac-right { display: flex; flex-direction: column; gap: 8px; justify-content: center; }
.ac-rows { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.ac-row { display: flex; gap: 6px; flex-wrap: wrap; }
.ac-btn {
  min-width: var(--ac-btn); min-height: var(--ac-btn); padding: 0 12px;
  font: inherit; font-size: 15px; font-weight: 600; line-height: 1.1;
  color: inherit; background: var(--sf-btn-bg, rgba(255, 255, 255, 0.1));
  border: 1px solid var(--sf-btn-border, rgba(255, 255, 255, 0.22)); border-radius: 8px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.ac-btn:active { filter: brightness(1.25); }
.ac-btn.greyed { opacity: 0.4; }
.ac-btn.has-children::after { content: '›'; margin-left: 4px; }
.ac-confirm { background: var(--sf-accent, #2f8f4e); border-color: transparent; color: #fff; min-width: calc(var(--ac-btn) * 2); }
.ac-cancel { background: rgba(160, 50, 50, 0.85); border-color: transparent; color: #fff; }
.ac-icon { width: 20px; height: 20px; }
.ac-respond-hint { align-self: center; font-size: 15px; padding: 0 8px; max-width: 360px; }
.ac-end { position: relative; min-width: calc(var(--ac-btn) * 1.8); min-height: calc(var(--ac-btn) * 1.6); background: rgba(200, 140, 30, 0.9); color: #111; border-color: transparent; flex-direction: column; }
.ac-end.disabled { opacity: 0.45; }
.ac-ring { position: absolute; inset: 4px; width: calc(100% - 8px); height: calc(100% - 8px); pointer-events: none; }
.ac-ring circle { fill: none; stroke-width: 3; }
.ac-ring-track { stroke: rgba(0, 0, 0, 0.18); }
.ac-ring-fill { stroke: #fff; stroke-dasharray: 100; stroke-dashoffset: 100; transform: rotate(-90deg); transform-origin: 50% 50%; }
.ac-end.holding .ac-ring-fill { animation: ac-ring-fill var(--ac-hold-ms) linear forwards; }
.ac-end span { position: relative; }
@keyframes ac-ring-fill { to { stroke-dashoffset: 0; } }
.ac-hint {
  position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translateX(-50%);
  padding: 8px 14px; border-radius: 8px; background: rgba(0, 0, 0, 0.85); color: #fff; font-size: 14px; white-space: nowrap;
  pointer-events: none;
}
</style>
