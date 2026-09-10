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
  segments: { id: number; label: string }[];
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
  setSpeed(speed: ReplaySpeed): void;
  beginScrub(): unknown;
  endScrub(): void;
  goToLive(): Promise<unknown>;
}
