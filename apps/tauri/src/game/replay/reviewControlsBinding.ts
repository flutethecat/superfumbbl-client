import type { ReplaySpeed, ReplayTurnMarker } from './replayController';

/** Presentation-only binding for the shared toolbar; contains no game-send capability. */
export interface ReviewControlsBinding {
  status: { phase: string; cursor: number; total: number; commandNr: number | null; failure: { message: string } | null };
  minimum: number;
  coverageLabel: string;
  positionLabel: string;
  turnMarkers: readonly ReplayTurnMarker[];
  liveDistanceLabel: string;
  selectedSegment: number | null;
  /** `joinBoundary` (owner 09-16): the pre-join backfill — its "Before you joined" note belongs on the LAST turn it
   *  holds (the turn the spectator arrived in), not on the segment's start line. */
  segments: { id: number; label: string; joinBoundary?: boolean }[];
  selectSegment(id: number): Promise<unknown>;
  playing: boolean;
  speed: ReplaySpeed;
  pinned: boolean;
  notice: string | null;
  canGoLive: boolean;
  play(): unknown;
  pause(): unknown;
  stepForward(): Promise<unknown>;
  stepBackward(): Promise<unknown>;
  turn(direction: -1 | 1): Promise<unknown>;
  seek(sequence: number): Promise<unknown>;
  /** Owner 09-14: a TURNS pick may live in another history segment (the pre-join backfill); seeks across it. */
  seekTurn?(marker: ReplayTurnMarker): Promise<unknown>;
  /** Owner 09-14: Previous/Next turn stay enabled at a segment edge when a neighbouring segment can be crossed into. */
  canTurn?(direction: -1 | 1): boolean;
  setSpeed(speed: ReplaySpeed): void;
  beginScrub(): unknown;
  endScrub(): void;
  goToLive(): Promise<unknown>;
}
