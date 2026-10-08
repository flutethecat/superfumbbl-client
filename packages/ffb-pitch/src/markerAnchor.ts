/**
 * Owner 10-07 ("FUMBBL sprites are having their tokens rendered slightly high compared to the modern sprites"):
 * the figure-relative markers (DISTRACTED / STUNNED banners, the state-marker row, the activated badge, the gaze /
 * eye-gouge marks) were laid out for the modern walker figures. A FUMBBL-style iconset frame is a square whose
 * figure FILLS it (measured over the roster iconset cache: opaque rows from ~3.6% to 100% of the frame, median),
 * so the old icon mount — the frame top plus a forehead inset (min 9, 18% of the frame) — landed on the face.
 *
 * markerAnchorFor() is the pure per-sprite-set anchor: the chest line for the set and the uniform vertical drop
 * (`dy`, token-local units, + = down) every figure-relative marker on that token takes, so they all move together.
 * Walkers keep their measured-figure mount (walkerChestRatio) and the abstract Checkers / Chess pieces keep their
 * chip-relative placement — both report dy 0 and are never moved by this helper.
 */
export type MarkerSpriteSet = 'walk' | 'fumbblIcon' | 'checkers' | 'chess' | 'other';

/** The body sprite's token-local vertical extent (top edge and drawn height). */
export interface MarkerTileMetrics {
  bodyTop: number;
  bodyHeight: number;
}

export interface MarkerAnchor {
  /** Token-local y of the chest line markers centre on. */
  chestY: number;
  /** Uniform drop applied to every figure-relative marker of the set (0 = unchanged placement). */
  dy: number;
}

/** The pre-10-07 icon mount: just under the head envelope (frame top + forehead inset). */
export function legacyIconChestY(m: MarkerTileMetrics): number {
  return m.bodyTop + Math.min(9, m.bodyHeight * 0.18);
}

/** FUMBBL-style icon: the chest line as a fraction of the frame height, measured from the iconset bounds
 *  (figure from ~0.04 to 1.0 of the frame; upper chest under the shoulder pads at ~0.40). */
export const FUMBBL_ICON_CHEST_FRACTION = 0.4;

export function markerAnchorFor(set: MarkerSpriteSet, m: MarkerTileMetrics): MarkerAnchor {
  const legacy = legacyIconChestY(m);
  if (set !== 'fumbblIcon') return { chestY: legacy, dy: 0 };
  const chestY = m.bodyTop + m.bodyHeight * FUMBBL_ICON_CHEST_FRACTION;
  return { chestY, dy: chestY - legacy };
}
