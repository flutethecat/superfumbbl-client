import type { RailAudience, RailId } from './rails/contracts';

type RegistryRailDiagnostic = {
  rail: 'dialog' | 'player-action';
  code: 'unknown-key' | 'unhandled-key' | 'intent-mismatch' | 'selection-locked';
  key: string;
  message: string;
};

export type ShadowDivergenceDiagnostic = {
  rail: RailId;
  code: 'shadow-divergence';
  key: string;
  expected: string;
  actual: string;
  message: string;
};

export type RefusalDivergenceDiagnostic = {
  rail: RailId;
  code: 'false-refusal' | 'false-permit';
  key: string;
  expected: 'shadow-send' | 'shadow-refusal';
  actual: 'legacy-emitted' | 'legacy-dropped';
  message: string;
};

export type MoveRailDiagnostic = {
  rail: 'move';
  code: 'unknown-state';
  key: string;
  action: string;
  message: string;
};

export type OwnershipRefusalDiagnostic = {
  rail: 'move';
  code: 'ownership-refusal';
  netCommandId: string;
  audience: RailAudience;
  myTeamId: string | null;
  message: string;
};

export type MissingRailHandlerDiagnostic = {
  rail: RailId;
  code: 'missing-handler';
  netCommandId: string;
  message: string;
};

export type RailDiagnostic =
  | RegistryRailDiagnostic
  | ShadowDivergenceDiagnostic
  | RefusalDivergenceDiagnostic
  | MoveRailDiagnostic
  | OwnershipRefusalDiagnostic
  | MissingRailHandlerDiagnostic;

export type RailDiagnosticSink = (diagnostic: RailDiagnostic) => void;
