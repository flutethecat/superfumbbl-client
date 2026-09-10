export interface PassSkillUseCardInput {
  label?: string;
  roll?: number;
  result?: string;
  needed?: number;
}

export interface HmpScatterSkillUseCardInput {
  label?: string;
  hmpScatter?: {
    ordinal: number;
    direction: string;
    showNeverUse: boolean;
  };
}

/** The Savage Mauling election is delivered in the same sync as the injury
 * report. Project the server's final PlayerState result; never recompute it
 * from the dice or from a later field-model update. */
export function savageMaulingInjuryResult(
  reports: readonly Record<string, unknown>[],
  playerId: string,
): string | undefined {
  const report = reports.find((candidate) => candidate.reportId === 'injury'
    && String(candidate.attackerId ?? '') === playerId);
  const injury = typeof report?.injury === 'number' ? report.injury & 0xff : -1;
  switch (injury) {
    case 4: return 'Stun';
    case 5: return 'KO';
    case 6: return 'Badly Hurt';
    case 7: return 'Serious Injury';
    case 8: return 'Death';
    default: return undefined;
  }
}

/** Old Pro's skill-use prompt shares a frame with the chainsaw injury report.
 * Preserve the two authoritative armour dice so the coach can judge the
 * single-die reroll; malformed or unrelated reports stay fail-soft. */
export function oldProArmorDice(
  reports: readonly Record<string, unknown>[],
  playerId: string,
  skill: string,
): [number, number] | undefined {
  if (skill.toLowerCase().replace(/[^a-z]/g, '') !== 'oldpro') return undefined;
  const report = reports.find((candidate) => candidate.reportId === 'injury'
    && String(candidate.attackerId ?? '') === playerId);
  const dice = report?.armorRoll;
  if (!Array.isArray(dice) || dice.length !== 2
      || !dice.every((die) => Number.isInteger(die) && die >= 1 && die <= 6)) return undefined;
  return [Number(dice[0]), Number(dice[1])];
}

/** Exact copy projection from server-reported Pass roll fields. Missing or
 *  unexpected fields fall back to the generic skill-use card. */
export function passSkillUseCardCopy(input: PassSkillUseCardInput | null | undefined): {
  title: 'Use Pass?';
  rollLine: string;
  needLine: string;
} | null {
  if (input?.label !== 'Pass') return null;
  if (!Number.isInteger(input.roll) || input.roll! < 1 || input.roll! > 6) return null;
  if (input.result !== 'Inaccurate'
    && input.result !== 'Wildly Inaccurate'
    && input.result !== 'Fumble') return null;
  if (!Number.isInteger(input.needed) || input.needed! < 2 || input.needed! > 6) return null;
  return {
    title: 'Use Pass?',
    rollLine: `Rolled ${input.roll} - ${input.result}`,
    needLine: `Need ${input.needed}+`,
  };
}

/** Blast It! is offered once for each of Hail Mary Pass's three scatter rolls.
 * Keep the prompt self-describing from the server's own dialog flag and report;
 * malformed/non-HMP skill cards deliberately retain the generic presentation. */
export function hmpScatterSkillUseCardCopy(input: HmpScatterSkillUseCardInput | null | undefined): {
  title: string;
  contextLine: string;
} | null {
  if (input?.label !== 'Blast It!') return null;
  const scatter = input.hmpScatter;
  if (!scatter || !Number.isInteger(scatter.ordinal) || scatter.ordinal < 1 || scatter.ordinal > 3) return null;
  if (!scatter.direction.trim()) return null;
  return {
    title: scatter.showNeverUse
      ? 'Use Blast It! to reroll HMP scatters this pass?'
      : 'Reroll this scatter?',
    contextLine: `Scatter ${scatter.ordinal} of 3 · direction rolled ${scatter.direction}`,
  };
}
