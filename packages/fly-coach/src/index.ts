import type { FieldCoordinateJson, GameJson } from '@fumbbl40k/ffb-protocol';

export type BlockKind = 'stab' | 'chainsaw' | 'vomit' | 'breatheFire' | 'chomp';
export interface CoachAction {
  action: string;
  label: string;
  kind: 'declare' | 'endMove';
  enabled: boolean;
  blockKind?: BlockKind;
}
export interface MoveSquareFact {
  coordinate: FieldCoordinateJson;
  [key: string]: unknown;
}
export type CoachIntent =
  | { kind: 'select'; playerId: string }
  /** `playerId` set = select THIS player with that action (a Block must be declared at selection, not after a Move). */
  | { kind: 'declare'; action: string; blockKind?: BlockKind; playerId?: string }
  | { kind: 'move'; path: FieldCoordinateJson[] }
  | { kind: 'block'; defenderId: string }
  | { kind: 'endMove' }
  | { kind: 'endTurn' }
  | { kind: 'pass' };

/** The app supplies server-derived capabilities; this package knows no client rules. */
export interface CoachObservation {
  readonly game: Readonly<GameJson>;
  readonly mySide?: 'home' | 'away';
  readonly state: string;
  readonly selectedPlayerId: string | null;
  readonly actions: readonly CoachAction[];
  readonly legalSquares: readonly MoveSquareFact[];
  readonly turnClockMs: number;
  readonly intentsThisTurn: number;
  readonly legalIntents: readonly CoachIntent[];
}
export interface CoachBrain {
  readonly id: string;
  decide(obs: CoachObservation, signal: AbortSignal): Promise<CoachIntent>;
}

export { RandomLegalCoach } from './randomLegalCoach';
export { FlyChaosCoach, type FlyChaosOptions } from './flyChaosCoach';
export { SidecarClient, DEFAULT_FLY_BRAIN_URL, type FlyDecision, type FlyVerdict, type FlyRequest, type SidecarOptions } from './sidecarClient';
