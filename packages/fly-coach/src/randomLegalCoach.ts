import type { CoachBrain, CoachIntent, CoachObservation } from './index';

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
