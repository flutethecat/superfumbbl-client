export type StadiumStandSide = 'home' | 'away' | 'nearEnd' | 'farEnd';

/** The shipped stand images are four-cell atlases, not single repeatable tiles. */
export const STADIUM_STAND_ATLAS_COLUMNS = 4;

/**
 * Keep the atlas progression continuous along a stand tier. Side stands run
 * down the pitch (x); end stands run across it (y). This makes the fourth
 * atlas cell form a real aligned aisle instead of stamping atlas cell zero
 * into every stadium square.
 */
export function stadiumStandTileColumn(
  stand: StadiumStandSide,
  x: number,
  y: number,
): number {
  const alongTier = stand === 'nearEnd' || stand === 'farEnd' ? y : x;
  return ((alongTier % STADIUM_STAND_ATLAS_COLUMNS) + STADIUM_STAND_ATLAS_COLUMNS)
    % STADIUM_STAND_ATLAS_COLUMNS;
}

export type StadiumStandTileTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  translateX: number;
  translateY: number;
};

type StadiumCellCorners = readonly [
  { x: number; y: number }, // x, y
  { x: number; y: number }, // x, y + 1
  { x: number; y: number }, // x + 1, y + 1
  { x: number; y: number }, // x + 1, y
];

/**
 * Map exactly one atlas cell into one projected stadium cell. The source art
 * faces toward positive Y (north-south seating), so each stand selects an
 * origin, tier axis and inward-facing axis before projection. This rotates the
 * side stands by opposing quarter turns and flips the near end without making
 * assumptions about the active pitch orientation or field flip.
 */
export function stadiumStandTileTransform(input: {
  stand: StadiumStandSide;
  textureWidth: number;
  textureHeight: number;
  tileColumn: number;
  corners: StadiumCellCorners;
}): StadiumStandTileTransform {
  const atlasTileWidth = input.textureWidth / STADIUM_STAND_ATLAS_COLUMNS;
  const [xy, xy1, x1y1, x1y] = input.corners;
  const [origin, along, inward] = input.stand === 'home'
    ? [xy, x1y, xy1]
    : input.stand === 'away'
      ? [xy1, x1y1, xy]
      : input.stand === 'nearEnd'
        ? [xy, xy1, x1y]
        : [x1y, x1y1, xy];
  const a = (along.x - origin.x) / atlasTileWidth;
  const b = (along.y - origin.y) / atlasTileWidth;
  const c = (inward.x - origin.x) / input.textureHeight;
  const d = (inward.y - origin.y) / input.textureHeight;
  const atlasOffset = input.tileColumn * atlasTileWidth;
  return {
    a,
    b,
    c,
    d,
    translateX: origin.x - atlasOffset * a,
    translateY: origin.y - atlasOffset * b,
  };
}

/**
 * Owner 09-14: the riser (step face) under an elevated stand cell belongs on the edge that FACES THE PITCH — the edge
 * shared with the ring in front (the transform's `inward` axis), not "the two corners with the largest screen Y". The
 * old rule was right only when the tier stepped along screen depth; when a band steps across the screen (end stands in
 * N-S, side stands in E-W) it painted a black bar along the bottom of every seat cell. A step face is only visible when
 * the shared edge runs across the screen (|dx| >= |dy|); a sideways step shows purely as the jagged tier silhouette.
 */
export function stadiumRiserEdge(
  stand: StadiumStandSide,
  corners: StadiumCellCorners,
): { edge: [{ x: number; y: number }, { x: number; y: number }]; visible: boolean } {
  const [xy, xy1, x1y1, x1y] = corners;
  const edge: [{ x: number; y: number }, { x: number; y: number }] = stand === 'home'
    ? [xy1, x1y1] // ring = -5 - y: the ring in front is y + 1
    : stand === 'away'
      ? [xy, x1y] // ring = y - 19: the ring in front is y - 1
      : stand === 'nearEnd'
        ? [x1y, x1y1] // ring = -2 - x: the ring in front is x + 1
        : [xy, xy1]; // ring = x - 27: the ring in front is x - 1
  const dx = Math.abs(edge[1].x - edge[0].x);
  const dy = Math.abs(edge[1].y - edge[0].y);
  return { edge, visible: dx >= dy };
}

/** Owner 09-24: the baked-crowd stand tiles are square cells of this many texture pixels, packed side by side into
 *  one atlas per colour and facing (column 0 = empty seats, the rest = crowd variants). */
export const STADIUM_STAND_TILE = 128;

export type StadiumStandFacing = 'front' | 'back' | 'sideL' | 'sideR';

/** Which baked-crowd tile a stand cell needs, from where the PITCH lies on screen relative to the cell: below it =
 *  the far stand (the crowd faces the camera, 'front'); above it = the near stand (backs to the camera, 'back'); to
 *  the right / left = a side stand (the crowd in profile, facing the pitch). Pure screen geometry, so it is right in
 *  both orientations, under the field flip, and for the wrapped corner blocks (the dominant axis wins). */
export function stadiumStandFacing(cell: { x: number; y: number }, pitch: { x: number; y: number }): StadiumStandFacing {
  const dx = pitch.x - cell.x;
  const dy = pitch.y - cell.y;
  if (Math.abs(dy) >= Math.abs(dx)) return dy > 0 ? 'front' : 'back';
  return dx > 0 ? 'sideR' : 'sideL';
}

/** Deterministic crowd variant for a cell: 0 (empty) when the cell's noise sits above the fan density, else one of the
 *  crowd columns. Same noise seeds as the old sprite sprinkle so a roster's fan factor fills the stands the same way. */
export function stadiumStandVariant(
  x: number,
  y: number,
  density: number,
  columns: number,
  noise: (a: number, b: number) => number,
): number {
  if (columns <= 1) return 0;
  const n = noise(x * 13 + y * 7 + 3, x * 5 - y * 11 + 1);
  if (n >= density) return 0;
  return 1 + (Math.floor((n / Math.max(density, 1e-6)) * (columns - 1)) % (columns - 1));
}

/** Map one atlas cell into a projected stadium square keeping the art SCREEN-UPRIGHT: the cell's more horizontal grid
 *  axis carries the tile's width (pointing screen-right), the other its height (pointing screen-up). Unlike
 *  stadiumStandTileTransform this never rotates the art, so baked spectators stay on their feet on every stand; the
 *  facing (front / back / side) is chosen per cell instead. `mirror` flips the tile left-right (a side stand whose
 *  crowd must face the other way). */
export function stadiumStandTileUpright(input: {
  corners: StadiumCellCorners;
  textureHeight: number;
  tileSize: number;
  column: number;
  mirror: boolean;
}): StadiumStandTileTransform {
  const [xy, xy1, x1y1, x1y] = input.corners;
  const ax = { x: x1y.x - xy.x, y: x1y.y - xy.y };
  const ay = { x: xy1.x - xy.x, y: xy1.y - xy.y };
  const axHorizontal = Math.abs(ax.x) >= Math.abs(ax.y);
  let right = axHorizontal ? ax : ay;
  let up = axHorizontal ? ay : ax;
  if (right.x < 0) right = { x: -right.x, y: -right.y };
  if (up.y > 0) up = { x: -up.x, y: -up.y };
  const down = { x: -up.x, y: -up.y };
  const cx = (xy.x + xy1.x + x1y1.x + x1y.x) / 4;
  const cy = (xy.y + xy1.y + x1y1.y + x1y.y) / 4;
  const u = input.mirror ? { x: -right.x, y: -right.y } : right;
  // texture origin (u = column start, v = 0) lands on the quad's top-left corner, or top-right when mirrored
  const ox = cx - u.x / 2 - down.x / 2;
  const oy = cy - u.y / 2 - down.y / 2;
  const a = u.x / input.tileSize;
  const b = u.y / input.tileSize;
  const c = down.x / input.textureHeight;
  const d = down.y / input.textureHeight;
  const offset = input.column * input.tileSize;
  return { a, b, c, d, translateX: ox - offset * a, translateY: oy - offset * b };
}
