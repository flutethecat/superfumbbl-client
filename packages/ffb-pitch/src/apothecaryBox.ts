/** Owner ruling (2026-08-17, annotated screenshot): a labeled station detached from each
 *  team's sideline furniture (score/hourglass/reroll track) marks where the
 *  team apothecary "initiates from". Three states, keyed off SERVER data only:
 *  - team never rostered an apothecary → box does not render at all.
 *  - rostered but used this game → box renders, empty (label + frame).
 *  - available right now → the token renders inside the box.
 *
 *  `initial` = TeamJson.apothecaries (roster count, set once at game load,
 *  never mutated by a model change — the game-START snapshot).
 *  `current` = TurnDataJson.apothecaries (live count; TURN_DATA_SET_APOTHECARIES
 *  decrements it on use). Comparing the two distinguishes "never had" from
 *  "used" without any client-side use-tracking.
 *
 *  Team (not wandering) apothecaries only — wanderingApothecaries is a
 *  separate TurnDataJson field for a different (non-team-box) marker. */
export type ApothecaryBoxState = 'absent' | 'empty' | 'token';

/** Physical layout contract: one cell socket, one empty cell before the tracker, compact
 *  below-socket label, and a token footprint that stays inside its projected tile. */
export const APOTHECARY_STATION_LAYOUT = Object.freeze({
  trackerGapRows: 1,
  stationRowOffset: 2,
  columnIndex: 0,
  /** Caption centre from the square's far edge (0) toward its near edge (1). */
  labelDepthRatio: 0.82,
  /** Caption footprint relative to the projected square at that depth. */
  labelWidthRatio: 0.8,
  labelHeightRatio: 0.16,
  tokenSizeTiles: 0.72,
});

export interface ProjectedApothecaryQuad {
  points: readonly (readonly [number, number])[];
  yBottom: number;
  yTop: number;
}

/** Orient the sideline figure toward the pitch. The bundled artwork faces left, which is
 * correct on the rendered east sideline. A spectator field flip swaps the rendered
 * sidelines, so orientation follows the projected side rather than the home/away label. */
export function apothecaryTokenScale(isHome: boolean, magnitude: number, fieldFlipped = false): { x: number; y: number } {
  const size = Math.abs(magnitude);
  const renderedOnWest = isHome !== fieldFlipped;
  return { x: renderedOnWest ? -size : size, y: size };
}

/** Fit the caption to the station's projected ground plane. Using the quad edges—not a
 * screen-space pixel offset—keeps it centred and perspective-compressed in every pitch
 * orientation, field flip, zoom, and flat/isometric presentation. */
export function projectedApothecaryLabelPlacement(
  quad: ProjectedApothecaryQuad,
  naturalWidth: number,
  naturalHeight: number,
): { x: number; y: number; scaleX: number; scaleY: number } {
  const [nearLeft, nearRight, farRight, farLeft] = quad.points;
  if (!nearLeft || !nearRight || !farRight || !farLeft) return { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  const depth = APOTHECARY_STATION_LAYOUT.labelDepthRatio;
  const farCentreX = (farLeft[0] + farRight[0]) / 2;
  const nearCentreX = (nearLeft[0] + nearRight[0]) / 2;
  const farWidth = Math.abs(farRight[0] - farLeft[0]);
  const nearWidth = Math.abs(nearRight[0] - nearLeft[0]);
  const widthAtDepth = farWidth + (nearWidth - farWidth) * depth;
  const projectedHeight = Math.abs(quad.yBottom - quad.yTop);
  return {
    x: farCentreX + (nearCentreX - farCentreX) * depth,
    y: quad.yTop + (quad.yBottom - quad.yTop) * depth,
    scaleX: (widthAtDepth * APOTHECARY_STATION_LAYOUT.labelWidthRatio) / Math.max(1, naturalWidth),
    scaleY: (projectedHeight * APOTHECARY_STATION_LAYOUT.labelHeightRatio) / Math.max(1, naturalHeight),
  };
}
export function apoBoxState(initial: number | undefined, current: number | undefined): ApothecaryBoxState {
  const start = initial ?? 0;
  if (start <= 0) return 'absent'; // never rostered one
  return (current ?? 0) > 0 ? 'token' : 'empty';
}
