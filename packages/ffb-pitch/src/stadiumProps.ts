import { PITCH_ROWS } from './geometry';

export interface BroadcastCameraPlacement {
  x: number;
  y: number;
  flip: boolean;
}

/** Additional clearance beyond the original apron-square camera anchors. */
export const BROADCAST_CAMERA_RETREAT_TILES = 0.5;

/** Keep both broadcast cameras half a tile farther from their touchline while
 * preserving the inward-facing sprite flip across field orientation changes. */
export function broadcastCameraPlacements(fieldFlipped: boolean): readonly BroadcastCameraPlacement[] {
  return [
    { x: 13, y: PITCH_ROWS + BROADCAST_CAMERA_RETREAT_TILES, flip: true !== fieldFlipped },
    { x: 11, y: -1 - BROADCAST_CAMERA_RETREAT_TILES, flip: false !== fieldFlipped },
  ];
}
