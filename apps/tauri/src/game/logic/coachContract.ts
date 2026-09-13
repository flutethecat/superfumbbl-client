/** Coach contract (owner 09-12): lives in the app so the PUBLIC build has no dependency on packages/fly-coach.
 *  The fork-only fly runtime (packages/fly-coach) imports these types from here. The app supplies server-derived
 *  capabilities; a brain knows no client rules and may only return an element of `legalIntents` (or `pass`). */
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


export class RandomLegalCoach implements CoachBrain {
  readonly id = 'random';
  private readonly seed: number;

  constructor(seed: number | string = 1, private readonly maxIntents = 40) {
    this.seed = typeof seed === 'number' ? seed >>> 0 : [...seed].reduce(
      (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261,
    );
  }

  async decide(obs: CoachObservation, signal: AbortSignal): Promise<CoachIntent> {
    if (signal.aborted) return { kind: 'pass' };
    const end = obs.legalIntents.find((intent) => intent.kind === 'endTurn');
    const choices = obs.legalIntents.filter((intent) => intent.kind !== 'endTurn');
    if (end && (obs.intentsThisTurn >= this.maxIntents || choices.length === 0)) return end;
    if (choices.length === 0) return { kind: 'pass' };
    // Index draws by accepted intent count so a cancelled/stale decision cannot consume randomness.
    const turn = [obs.game.half, obs.game.turnDataHome?.turnNr, obs.game.turnDataAway?.turnNr].join(':');
    const turnSeed = [...turn].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), this.seed);
    let value = (turnSeed + Math.imul(obs.intentsThisTurn + 1, 0x6d2b79f5)) >>> 0;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const random = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    return choices[Math.floor(random * choices.length)]!;
  }
}
