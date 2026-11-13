// Touch mode action center (spec-touch-mode-2026-11-12 section 4): the pure row model. The bar is one more renderer
// of the SAME rows the context menu shows (availableActions -> assembleActingPlayerRows -> o66ActionMenuItems); it
// never decides legality itself.

/** The top row's fixed places, left to right. */
export const FIXED_ACTION_SLOTS = ['move', 'block', 'blitz', 'pass', 'handOff', 'foul'] as const;
export type FixedActionSlot = (typeof FIXED_ACTION_SLOTS)[number];

/** CoachAction.action wire ids that fill each fixed place (the plain row only: flavours stay in the bottom row). */
const SLOT_ACTIONS: Record<FixedActionSlot, readonly string[]> = {
  move: ['move'],
  block: ['block'],
  blitz: ['blitzMove', 'blitz'],
  pass: ['passMove', 'pass'],
  handOff: ['handOverMove', 'handOver'],
  foul: ['foulMove', 'foul'],
};

export interface ActionRowLike {
  label: string;
  /** CoachAction.action of a menu row (undefined for rows built in the view, e.g. Throw Pass, Bounding Leap). */
  actionId?: string;
  blockKind?: string;
  usingChainsaw?: boolean;
  disabled?: boolean;
  hint?: string;
  children?: ActionRowLike[];
  endActivation?: boolean;
}

export interface FixedActionCell<R> {
  slot: FixedActionSlot;
  row: R | null;
  /** Greyed (no row, or a disabled row): tapping shows `reason`. */
  enabled: boolean;
  reason: string | null;
}

export interface ActionCenterModel<R> {
  fixed: FixedActionCell<R>[];
  /** Every other row in menu order. */
  extra: R[];
  /** The bottom row as drawn: the first rows that fit, then More when the rest overflow. */
  visibleExtra: R[];
  overflow: R[];
}

function fillsSlot(row: ActionRowLike, slot: FixedActionSlot): boolean {
  return !!row.actionId && SLOT_ACTIONS[slot].includes(row.actionId) && !row.blockKind && row.usingChainsaw !== true && !row.children;
}

/**
 * Splits menu rows into the six fixed places and the bottom row. `bottomSlots` = how many bottom-row buttons fit
 * (More takes one of them when the rest overflow). `unavailableReason` is shown for a fixed place that has no row.
 */
export function buildActionCenterModel<R extends ActionRowLike>(rows: readonly R[], bottomSlots: number, unavailableReason: string): ActionCenterModel<R> {
  const used = new Set<R>();
  const fixed = FIXED_ACTION_SLOTS.map((slot): FixedActionCell<R> => {
    const row = rows.find((r) => !used.has(r) && fillsSlot(r, slot)) ?? null;
    if (row) used.add(row);
    const enabled = !!row && !row.disabled;
    return { slot, row, enabled, reason: enabled ? null : (row?.hint || unavailableReason) };
  });
  const extra = rows.filter((r) => !used.has(r));
  const slots = Math.max(1, Math.floor(bottomSlots));
  if (extra.length <= slots) return { fixed, extra, visibleExtra: extra, overflow: [] };
  const shown = Math.max(0, slots - 1);
  return { fixed, extra, visibleExtra: extra.slice(0, shown), overflow: extra.slice(shown) };
}

/** What the action center shows (spec section 4 visibility). Spectating / replays keep their own controls. */
/** 'respond' (round-2 finding 1): the opponent's turn with a choice of mine pending - Confirm / Cancel only. */
export type ActionCenterMode = 'hidden' | 'play' | 'setup' | 'respond';

export interface ActionCenterContext {
  touch: boolean;
  isPlaying: boolean;
  myTurn: boolean;
  setup: boolean;
  gameOver: boolean;
  /** A local stage exists or the server is waiting for a pitch pick of mine. */
  pending?: boolean;
}

export function actionCenterMode(c: ActionCenterContext): ActionCenterMode {
  if (!c.touch || !c.isPlaying || c.gameOver) return 'hidden';
  if (!c.myTurn) return c.pending ? 'respond' : 'hidden';
  return c.setup ? 'setup' : 'play';
}

/** Round-3 finding 3: the held End control in touch mode names the phase it ends and which end it runs. The
 *  action center's Confirm is the only control that commits a preview; a phase end is never labelled "Confirm". */
export interface TouchEndControl { labelKey: string; action: 'endTurn' | 'highKick' | 'swarming' }
export function touchEndControl(c: { clientState: string; turnMode: string; setup: boolean }): TouchEndControl {
  if (c.clientState === 'HIGH_KICK') return { labelKey: 'hud.touch.endHighKick', action: 'highKick' };
  if (c.clientState === 'QUICK_SNAP') return { labelKey: 'hud.touch.endQuickSnap', action: 'endTurn' };
  if (c.turnMode === 'swarming') return { labelKey: 'hud.touch.endSwarming', action: 'swarming' };
  if (c.setup) return { labelKey: 'hud.touch.endSetup', action: 'endTurn' };
  return { labelKey: 'hud.endTurnButtonText.endTurn', action: 'endTurn' };
}
