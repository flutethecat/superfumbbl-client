/** Wire literal for the team special rule that swaps touchdown/casualty SPP values
 * (ffb-common model/SpecialRule.java: `BRAWLIN_BRUTES("Brawlin' Brutes")`; carried to
 * the client verbatim in `TeamJson.specialRules: string[]`, ffb-common json/IJsonOption.java
 * `SPECIAL_RULES = new JsonStringArrayOption("specialRules")`). */
export const BRAWLIN_BRUTES_RULE = 'BRAWLIN_BRUTES';

/** The casualty-owned component of a PlayerResult's earned SPP. */
export function casualtySppEarnedThisGame(r: Record<string, unknown>, teamSpecialRules?: string[]): number {
  const n = (k: string) => Number(r[k] ?? 0);
  const casualtySpp = (teamSpecialRules ?? []).includes(BRAWLIN_BRUTES_RULE) ? 3 : 2;
  return n('casualties') * casualtySpp + n('casualtiesWithAdditionalSpp');
}

/**
 * Derive game-earned SPP from serialized PlayerResult achievement fields, mirroring
 * upstream's PlayerResult.totalEarnedSpps() (ffb-common model/PlayerResult.java) against
 * the fork's BB2025 SppMechanic point values (ffb-common mechanics/bb2025/SppMechanic.java):
 * mvp=4, interception=2, completion=1, deflection=1, landing=1, plus the *WithAdditionalSpp
 * bonus counters at 1 each. Touchdown/casualty are ruleset-conditional: default 3/2, but a
 * team with the BRAWLIN_BRUTES special rule swaps to 2/3 (SppMechanic.touchdownSpp/
 * casualtySpp, gated by the generic `team.getSpecialRules().contains(SpecialRule.
 * BRAWLIN_BRUTES)` check — never a hardcoded roster/race name).
 *
 * @param teamSpecialRules the team's server-sent `specialRules` array (TeamJson.specialRules).
 */
export function sppEarnedThisGame(r: Record<string, unknown>, teamSpecialRules?: string[]): number {
  const n = (k: string) => Number(r[k] ?? 0);
  const brawlinBrutes = (teamSpecialRules ?? []).includes(BRAWLIN_BRUTES_RULE);
  const touchdownSpp = brawlinBrutes ? 2 : 3;
  return n('playerAwards') * 4 + n('touchdowns') * touchdownSpp + casualtySppEarnedThisGame(r, teamSpecialRules) + n('interceptions') * 2
    + n('completions') + n('deflections') + n('landings')
    + n('completionsWithAdditionalSpp') + n('catchesWithAdditionalSpp');
}
