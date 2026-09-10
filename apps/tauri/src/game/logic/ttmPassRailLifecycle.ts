import { watch, type WatchSource } from 'vue';

type Square = [number, number];

export interface TtmPassRailRenderer {
  selectPlayer(playerId: string | null): void;
  setPassTemplateMaxRange(range: 'S' | null): void;
  setActionMode(mode: 'pass'): void;
  setPassRuler(from: Square | null, to: Square | null): void;
  setTilePick(active: boolean, eligible?: Square[] | null, skill?: string, gfi?: Square[] | null, extra?: Square[] | null): void;
  setO66MoveRolls(rolls: null): void;
  setO66PassRolls(rolls: null): void;
}

export interface TtmPassRailSurface {
  actingPlayerId: string;
  throwerSquare: Square;
  landingSquares: Square[];
}

/** Reassert the held-mate targeting surface from current authoritative state. This is intentionally idempotent and
 * can run both on the state edge and after a late Pixi mount/reconnect. TTM shares the regular Pass presentation,
 * but its target set is Quick+Short only and it never projects the deprecated per-square roll cards. */
export function syncTtmPassRailSurface(
  renderer: TtmPassRailRenderer | null,
  surface: TtmPassRailSurface | null,
): boolean {
  if (!renderer || !surface) return false;
  renderer.selectPlayer(surface.actingPlayerId);
  renderer.setPassTemplateMaxRange('S');
  renderer.setActionMode('pass');
  renderer.setPassRuler(surface.throwerSquare, null);
  // The first set owns legality; the second, identical set owns the coloured Pass range chart.
  // Keeping both projections explicit prevents the ordinary move overlay from retaining clicks while
  // silently dropping the ground tint after a same-action authoritative refresh.
  renderer.setTilePick(true, surface.landingSquares, 'order66-move', null, surface.landingSquares);
  renderer.setO66MoveRolls(null);
  renderer.setO66PassRolls(null);
  return true;
}

export interface TtmPassRailBoundaryInputs {
  terminalSeq: WatchSource<number | undefined>;
  resetSeq: WatchSource<number>;
  turnEndSeq: WatchSource<number>;
  activationKey: () => string | null;
  ttmActive: () => boolean;
  hasLocalSurface: () => boolean;
  isPlaying: () => boolean;
  heldMateId: () => string | null;
  cancelledKeys: Set<string>;
  committedKeys: Set<string>;
  clearSurface: () => void;
  restoreHeldMate: (playerId: string) => void;
}

/** Vue-owned lifecycle edges for the local TTM pass selector. Keeping these on explicit store pulses avoids using
 * the shallow game ref as a boundary: every authoritative frame triggerRefs that object, including the frames
 * between a submitted throw and its landing. */
export function useTtmPassRailBoundaries(input: TtmPassRailBoundaryInputs): void {
  watch(input.terminalSeq, (seq) => {
    if (seq == null) return;
    const key = input.activationKey();
    if (key && input.ttmActive()) input.committedKeys.add(key);
    if (input.ttmActive() || input.hasLocalSurface()) input.clearSurface();
  }, { flush: 'sync' });

  watch(input.resetSeq, () => {
    input.cancelledKeys.clear();
    input.committedKeys.clear();
    input.clearSurface();
    if (!input.isPlaying()) return;
    const key = input.activationKey();
    const heldId = input.heldMateId();
    if (key && heldId) input.restoreHeldMate(heldId);
  }, { flush: 'sync', immediate: true });

  watch(input.turnEndSeq, () => {
    if (input.hasLocalSurface()) input.clearSurface();
    input.cancelledKeys.clear();
    input.committedKeys.clear();
  }, { flush: 'sync' });
}
