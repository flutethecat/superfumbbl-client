export type RailId =
  | 'kickoff' | 'setup' | 'turn-control' | 'move' | 'block' | 'blitz' | 'foul' | 'pass-family'
  | 'special-action' | 'square-picker' | 'skill-use' | 'reactive-dialog'
  | 'inducement' | 'reroll' | 'reaction' | 'end-game' | 'unknown';

/** Runtime counterpart to RailId; the Record annotation keeps the two exhaustive in both directions. */
export const RAIL_IDS: Readonly<Record<RailId, true>> = Object.freeze({
  kickoff: true,
  setup: true,
  'turn-control': true,
  move: true,
  block: true,
  blitz: true,
  foul: true,
  'pass-family': true,
  'special-action': true,
  'square-picker': true,
  'skill-use': true,
  'reactive-dialog': true,
  inducement: true,
  reroll: true,
  reaction: true,
  'end-game': true,
  unknown: true,
});

export type RailAudience = 'player' | 'spectator' | 'replay';

export interface RailFrame<TGame, TReport, TDialog> {
  commandNr: number;
  game: Readonly<TGame>;
  reports: readonly Readonly<TReport>[];
  dialog: Readonly<TDialog> | null;
}

export interface PresentationEnvelope<TPresentation> {
  key: string;
  rail: RailId;
  value: Readonly<TPresentation>;
}

export interface DecisionContext {
  audience: RailAudience;
  myTeamId: string | null;
  maySend: boolean;
}

export interface RailHandler<TState, TFrame, TDecision, TPresentation, TCommand> {
  readonly id: RailId;
  readonly initial: TState;
  /** Wire commands this handler builds and therefore owns during cutover projection. */
  readonly ownedCommandIds?: ReadonlySet<string>;
  /** Wire commands classified in shadow telemetry but never built during cutover projection. */
  readonly observedCommandIds?: ReadonlySet<string>;

  reduce(previous: Readonly<TState>, frame: Readonly<TFrame>): TState;
  deriveDecision(
    state: Readonly<TState>,
    frame: Readonly<TFrame>,
    context: DecisionContext,
  ): TDecision | null;
  present(state: Readonly<TState>): readonly PresentationEnvelope<TPresentation>[];
  command(decision: Readonly<TDecision>): TCommand;
}

export interface RailManifestEntry {
  id: RailId;
  upstreamOwners: readonly string[];
  modelOwner: 'server';
  presentationFor: readonly RailAudience[];
  commandFor: readonly RailAudience[];
  unknownPolicy: 'diagnostic-no-send';
  fixtureFamilies: readonly string[];
}
