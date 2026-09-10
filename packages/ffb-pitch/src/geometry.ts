import type { FieldCoordinateJson } from '@fumbbl40k/ffb-protocol';

/**
 * Madden-style pseudo-3D projection over the constrained square grid
 * (App18/App19, researched from Genesis John Madden Football): the camera looks
 * down-field from behind the NEAR edge; the field NARROWS toward the far edge,
 * rows COMPRESS with distance, and sprites SCALE by depth. Squares stay the
 * logical unit — each renders as a trapezoid slice.
 *
 * Game coordinates: x 0..25 along the long axis (end zones x=0 and x=25),
 * y 0..14 across (sidelines y=0 and y=14).
 *
 * B8-8/B9-V3 (owner): two ORIENTATIONS, each a NATIVE projection (not a rotation
 * of the other) so the perspective always narrows toward the TOP, mirroring the
 * viewer in both:
 *   - 'ns' (default): DEPTH = x (26 rows), WIDTH = y (15). End zones top/bottom.
 *   - 'ew': DEPTH = y (15 rows), WIDTH = x (26). End zones left/right. The
 *     near sideline (y=0) is wide at the bottom, the far sideline (y=14) narrow
 *     at the top — a gentler far-scale since the depth axis is shorter.
 * The active projection is chosen by setOrientation(); every screen-space helper
 * reads it, so callers keep passing GAME coordinates and get the right frame.
 */

export const PITCH_COLS = 26; // game x, long axis
export const PITCH_ROWS = 15; // game y, across

/**
 * Owner 2026-07-04: human-readable SQUARE NOMENCLATURE for referring to pitch
 * squares in conversation/docs. COLUMNS are letters A–O (the 15-wide across
 * axis = game y); ROWS are numbers 1–26 (the 26-long axis = game x). A1 is the
 * BOTTOM-LEFT square (game x=0, y=0), O26 the TOP-RIGHT (game x=25, y=14) — as
 * rendered in the N-S view (home end zone at the bottom). See docs/pitch-coordinates.md.
 *   label = columnLetter(y) + rowNumber(x)   →   e.g. (x=0,y=0)='A1', (x=25,y=14)='O26'
 */
export function squareLabel(x: number, y: number): string {
  const col = y >= 0 && y < PITCH_ROWS ? String.fromCharCode(65 + y) : '?';
  return `${col}${x + 1}`;
}

/** Parse a square label (e.g. 'A1', 'O26') back to game coordinates [x, y], or
 *  null if malformed / off-pitch. Column letter → y, row number − 1 → x. */
export function parseSquareLabel(label: string): [number, number] | null {
  const m = /^([A-Oa-o])(\d{1,2})$/.exec(label.trim());
  if (!m) return null;
  const y = m[1]!.toUpperCase().charCodeAt(0) - 65;
  const x = Number.parseInt(m[2]!, 10) - 1;
  if (x < 0 || x >= PITCH_COLS || y < 0 || y >= PITCH_ROWS) return null;
  return [x, y];
}

export const TILE_W = 44; // width-tile size at the NEAR edge
export const TILE_H = 38; // depth-tile size at the NEAR edge

/** Far-edge scale relative to near. N-S over 26 rows (owner-tuned Madden); E-W
 *  over 15 rows uses a gentler value so the shorter depth doesn't over-warp. */
export const FAR_SCALE = 0.6;
export const FAR_SCALE_EW = 0.82;
/** Owner 09-09 ("option 3"): with UNIFORM FIGURES on, the N-S ground keeps its perspective but narrows only to
 *  0.8 (E-W already 0.82) so the far rows are not crowded by full-size sprites. */
export const FAR_SCALE_SOFT = 0.8;

export type Orientation = 'ns' | 'ew';

interface Proj {
  rows: number; // depth count (boundaries 0..rows)
  cols: number; // width count
  far: number;
  depthTile: number; // near-edge tile size along the DEPTH axis
  widthTile: number; // near-edge tile size along the WIDTH axis
  boundaryY: number[]; // screen Y of each depth boundary; [0] = bottom (near)
  pixelW: number; // width at the near edge (cols * widthTile)
  pixelH: number; // total depth height (boundaryY[0])
  centerX: number;
  /** game (x,y) → depth row index (integer square) */
  depthOf: (x: number, y: number) => number;
  /** game (x,y) → width col index (integer square) */
  widthOf: (x: number, y: number) => number;
}

function buildProj(cfg: {
  rows: number;
  cols: number;
  far: number;
  depthTile: number;
  widthTile: number;
  depthOf: (x: number, y: number) => number;
  widthOf: (x: number, y: number) => number;
}): Proj {
  const scaleAt = (b: number) => 1 - (b / cfg.rows) * (1 - cfg.far);
  const heights: number[] = [];
  for (let d = 0; d < cfg.rows; d++) heights.push(cfg.depthTile * scaleAt(d + 0.5));
  const total = heights.reduce((a, h) => a + h, 0);
  const ys = [total];
  for (let d = 0; d < cfg.rows; d++) ys.push(ys[d]! - heights[d]!);
  const pixelW = cfg.cols * cfg.widthTile;
  return {
    rows: cfg.rows,
    cols: cfg.cols,
    far: cfg.far,
    depthTile: cfg.depthTile,
    widthTile: cfg.widthTile,
    boundaryY: ys,
    pixelW,
    pixelH: ys[0]!,
    centerX: pixelW / 2,
    depthOf: cfg.depthOf,
    widthOf: cfg.widthOf,
  };
}

// Owner 09-08: E-W keeps the SAME near-edge tile as N-S — 44 across the screen, 38 along the depth —
// so a square reads as the same foreshortened square in both orientations (width/depth 1.16). The
// earlier B9-19 swap (widthTile=TILE_H, depthTile=TILE_W) squeezed the field's long axis to avoid a
// wide 2:1 canvas, but it made every E-W square a PORTRAIT rectangle (38 wide x 44 tall, 0.86); the
// pitch really is 26:15, so the canvas is wide by nature and the camera fit absorbs it.
const NS = buildProj({
  rows: PITCH_COLS,
  cols: PITCH_ROWS,
  far: FAR_SCALE,
  depthTile: TILE_H,
  widthTile: TILE_W,
  depthOf: (x) => x,
  widthOf: (_x, y) => y,
});
const EW = buildProj({
  rows: PITCH_ROWS,
  cols: PITCH_COLS,
  far: FAR_SCALE_EW,
  depthTile: TILE_H,
  widthTile: TILE_W,
  depthOf: (_x, y) => y,
  widthOf: (x) => x,
});
// Owner 2026-07-04f: FLAT (non-isometric) variants — far=1 removes the
// perspective taper so every row is the same width (a clean top-down grid).
const NS_SOFT = buildProj({
  rows: PITCH_COLS, cols: PITCH_ROWS, far: FAR_SCALE_SOFT, depthTile: TILE_H, widthTile: TILE_W,
  depthOf: (x) => x, widthOf: (_x, y) => y,
});
const NS_FLAT = buildProj({
  rows: PITCH_COLS, cols: PITCH_ROWS, far: 1, depthTile: TILE_H, widthTile: TILE_W,
  depthOf: (x) => x, widthOf: (_x, y) => y,
});
const EW_FLAT = buildProj({
  rows: PITCH_ROWS, cols: PITCH_COLS, far: 1, depthTile: TILE_H, widthTile: TILE_W,
  depthOf: (_x, y) => y, widthOf: (x) => x,
});

let orientation: Orientation = 'ns';
let flat = false;
/** Owner 09-09 ("option 3"): figures, dice, badges and markers render at ONE scale on every square — the
 *  trapezoid ground still carries the depth. Off = the Madden depth scaling (0.6 far). */
let uniformFigures = false;
let P: Proj = NS;
function pickProj(): Proj {
  if (orientation === 'ns') return flat ? NS_FLAT : uniformFigures ? NS_SOFT : NS;
  return flat ? EW_FLAT : EW;
}
export function setUniformFigures(on: boolean): void {
  uniformFigures = on;
  P = pickProj();
}
export function isUniformFigures(): boolean {
  return uniformFigures;
}
export function setOrientation(o: Orientation): void {
  orientation = o;
  P = pickProj();
}
export function getOrientation(): Orientation {
  return orientation;
}
/** Owner 2026-07-04f: toggle the FLAT (non-isometric) projection. */
export function setFlat(f: boolean): void {
  flat = f;
  P = pickProj();
}
export function isFlat(): boolean {
  return flat;
}

/** Owner 2026-07-06: SPECTATOR drive-north side-swap. When set, the whole field
 *  is mirrored 180° (both axes) at render time so the OFFENSIVE/driving team
 *  attacks the far (north) end zone regardless of which team is home. It's a pure
 *  render transform — game coordinates are unchanged; every screen mapper below
 *  flips its depth/width indices. NEVER enabled in play mode (the store gates it).
 *  180° (both axes) keeps the play's handedness — a left-side sweep stays left. */
let fieldFlip = false;
export function setFieldFlip(f: boolean): void {
  fieldFlip = f;
}
export function isFieldFlip(): boolean {
  return fieldFlip;
}
/** Flip a SQUARE near-index (depth d in 0..rows-1, width w in 0..cols-1). */
function flipSquareIndex(d: number, w: number): [number, number] {
  return fieldFlip ? [P.rows - 1 - d, P.cols - 1 - w] : [d, w];
}
/** Flip a BOUNDARY corner (depth d in 0..rows, width w in 0..cols). */
function flipBoundary(d: number, w: number): [number, number] {
  return fieldFlip ? [P.rows - d, P.cols - w] : [d, w];
}

/** N-S canonical size constants (kept for any legacy references / camera math). */
export const PITCH_PIXEL_W = NS.pixelW;
export const PITCH_PIXEL_H = NS.pixelH;

/** Oriented world bounding-box size (near-edge width × total depth height). */
export function worldWidth(): number {
  return P.pixelW;
}
export function worldHeight(): number {
  return P.pixelH;
}

/** Perspective scale at a DEPTH boundary d (0 = near, P.rows = far). */
function boundaryScaleD(d: number): number {
  return 1 - (d / P.rows) * (1 - P.far);
}

/** Extrapolated screen Y of a depth boundary d (beyond [0,rows] for the arena).
 *  Owner 2026-07-04b (E-W review): handles FRACTIONAL depths too — in E-W the
 *  depth axis is y, so centre points like extPoint(x, 7.5) land between integer
 *  boundaries (they returned undefined and blew up the stadium props/dugouts). */
function depthBoundaryY(d: number): number {
  const di = Math.floor(d);
  if (di !== d) {
    // fractional: linear within the tile between the surrounding boundaries
    return depthBoundaryY(di) + (depthBoundaryY(di + 1) - depthBoundaryY(di)) * (d - di);
  }
  if (d >= 0 && d <= P.rows) return P.boundaryY[d]!;
  if (d < 0) {
    let y = P.boundaryY[0]!;
    for (let i = 0; i > d; i--) y += P.depthTile * boundaryScaleD(i - 0.5);
    return y;
  }
  let y = P.boundaryY[P.rows]!;
  for (let i = P.rows; i < d; i++) y -= P.depthTile * boundaryScaleD(i + 0.5);
  return y;
}

/** Screen X of width col w at depth boundary d (extrapolates freely). */
function edgeXD(d: number, w: number): number {
  const scale = boundaryScaleD(d);
  return P.centerX - (P.cols * P.widthTile * scale) / 2 + w * P.widthTile * scale;
}

/** Native screen point of any (possibly off-pitch) game coordinate corner. */
export function extPoint(gx: number, gy: number): { x: number; y: number } {
  const [d, w] = flipBoundary(P.depthOf(gx, gy), P.widthOf(gx, gy));
  return { x: edgeXD(d, w), y: depthBoundaryY(d) };
}

export interface Quad {
  /** corners: near-left, near-right, far-right, far-left (screen space) */
  points: [number, number][];
  /** near/far DEPTH boundary screen Y of this square (yBottom > yTop) */
  yBottom: number;
  yTop: number;
}

export type SquareEdge = 'xMin' | 'xMax' | 'yMin' | 'yMax';
export type ProjectedSegment = [[number, number], [number, number]];

/** Screen-space trapezoid of a game square in the active orientation.
 *  Owner 2026-07-04b (E-W review): depth boundaries go through depthBoundaryY
 *  (not a raw array index) so OFF-PITCH squares extrapolate in BOTH orientations
 *  — in E-W the depth axis is y, so sideline decor at y=-1/15+ (camera, dugouts,
 *  light stands) was reading boundaryY[undefined] and vanishing. */
export function squareQuad(x: number, y: number): Quad {
  const [d, w] = flipSquareIndex(P.depthOf(x, y), P.widthOf(x, y));
  const yBottom = depthBoundaryY(d);
  const yTop = depthBoundaryY(d + 1);
  return {
    points: [
      [edgeXD(d, w), yBottom],
      [edgeXD(d, w + 1), yBottom],
      [edgeXD(d + 1, w + 1), yTop],
      [edgeXD(d + 1, w), yTop],
    ],
    yBottom,
    yTop,
  };
}

/** A logical edge of a square, sourced from the same projected quad as tiles and overlays. */
export function squareEdge(x: number, y: number, edge: SquareEdge): ProjectedSegment {
  const points = squareQuad(x, y).points;
  const xEdge = edge === 'xMin' || edge === 'xMax';
  const minEdge = edge === 'xMin' || edge === 'yMin';
  const axisIsDepth = xEdge ? orientation === 'ns' : orientation === 'ew';
  const projectedMin = minEdge !== fieldFlip;

  if (axisIsDepth) return projectedMin ? [points[0]!, points[1]!] : [points[3]!, points[2]!];
  return projectedMin ? [points[0]!, points[3]!] : [points[1]!, points[2]!];
}

/**
 * Same as squareQuad — kept as a distinct name because tile texture matrices are
 * built from these (already-oriented, trapezoidal) quad dims.
 */
export function squareCanonical(x: number, y: number): Quad {
  return squareQuad(x, y);
}

/** Center anchor of a square — where tokens/text sit (upright), screen space. */
export function squareAnchor(x: number, y: number): { x: number; y: number } {
  const q = squareQuad(x, y);
  return {
    x: (q.points[0]![0] + q.points[1]![0] + q.points[2]![0] + q.points[3]![0]) / 4,
    y: (q.yBottom + q.yTop) / 2,
  };
}

/**
 * Owner 09-10: rotation (radians) for ground text that must read the SAME way as in North-South — the text's top
 * toward the far end zone (game +x). N-S is unchanged (0, upright even under the field flip); in East-West the +x
 * axis lies along the screen, so the text turns ±90° with the pitch (left/right per flip). Used by the dugout
 * RESERVES / KO / CAS bands.
 */
export function pitchTextRotation(x: number, y: number): number {
  if (getOrientation() !== 'ew') return 0;
  const step = x + 1 < PITCH_COLS ? 1 : -1;
  const a = squareAnchor(x, y);
  const b = squareAnchor(x + step, y);
  const dx = (b.x - a.x) * step;
  const dy = (b.y - a.y) * step;
  return Math.atan2(dx, -dy); // local "up" (0,-1) lands on the +x screen direction
}

/**
 * Depth scale for a game square (1.0 near → far-scale far). Callers pass the
 * long-axis x plus (in E-W) the across y; N-S ignores y (depth = x).
 */
export function depthScale(x: number, y = 0): number {
  if (uniformFigures) return 1; // owner 09-09: one sprite scale everywhere; the ground keeps its perspective
  const [d] = flipSquareIndex(P.depthOf(x, y), P.widthOf(x, y));
  return boundaryScaleD(d + 0.5);
}

/**
 * Draw-order key for zIndex — the square's near-depth boundary screen Y. Nearer
 * squares (larger Y) sort on top, in either orientation.
 */
export function depthZKey(x: number, y = 0): number {
  const [d] = flipSquareIndex(P.depthOf(x, y), P.widthOf(x, y));
  return (depthBoundaryY(d) + depthBoundaryY(d + 1)) / 2;
}

/** World pixels → game square coordinates (may be off pitch). */
export function worldToSquare(worldX: number, worldY: number): FieldCoordinateJson {
  // find the depth row whose band contains worldY
  let d = -1;
  for (let row = 0; row < P.rows; row++) {
    if (worldY <= P.boundaryY[row]! && worldY > P.boundaryY[row + 1]!) {
      d = row;
      break;
    }
  }
  if (d < 0) d = worldY > P.boundaryY[0]! ? -1 : P.rows;
  const scale = boundaryScaleD(Math.min(Math.max(d, 0), P.rows - 1) + 0.5);
  // #17/#40 (owner/Yularen 07-16): invert the WIDTH axis with the orientation's own width tile (P.widthTile),
  // matching edgeXD's forward projection. N-S widthTile === TILE_W (unchanged); E-W widthTile === TILE_H (38),
  // so the old hardcoded TILE_W (44) over-scaled the E-W inverse and mapped wing-column clicks up to 2 columns
  // off centre (the true root of #40 — a nudge red herring; the nudge magnitude never changed the mis-hit).
  const widthTile = P.widthTile;
  let w = Math.floor((worldX - (P.centerX - (P.cols * widthTile * scale) / 2)) / (widthTile * scale));
  // Undo the spectator side-swap: the screen was mirrored 180°, so the depth/width
  // indices read back must be un-flipped before mapping to game coordinates.
  if (fieldFlip) { d = P.rows - 1 - d; w = P.cols - 1 - w; }
  // map (depth d, width w) back to game (x,y) per orientation
  return orientation === 'ns' ? [d, w] : [w, d];
}

export function isOnPitch(coordinate: FieldCoordinateJson | null | undefined): coordinate is FieldCoordinateJson {
  if (!coordinate) return false;
  const [x, y] = coordinate;
  return x >= 0 && x < PITCH_COLS && y >= 0 && y < PITCH_ROWS;
}

/**
 * Distance-to-end-zone label for a long-axis row (Match5): distance in squares
 * to the end zone on that row's own half.
 */
export function distanceToEndZone(x: number): number {
  return x < PITCH_COLS / 2 ? x : PITCH_COLS - 1 - x;
}
