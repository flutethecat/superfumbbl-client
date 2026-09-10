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
