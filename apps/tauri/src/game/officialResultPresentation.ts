import type { GameJson } from '@fumbbl40k/ffb-protocol';
import type { ApothecaryResultProjection } from './apothecaryDecisionProjection';
import type { InjuryOutcomeProjection } from './injuryOutcomeProjection';
import { casualtyRollLabel } from './casualtyRollProjection';
import { playerName } from './reportFormatter';

const normalized = (value: unknown): string => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const stateBase = (value: unknown): number | null => {
  if (typeof value === 'number') return value & 0xff;
  if (value && typeof value === 'object') {
    const raw = (value as { id?: unknown; base?: unknown }).id ?? (value as { base?: unknown }).base;
    return typeof raw === 'number' ? raw & 0xff : null;
  }
  return null;
};
const labelBase = (label: string): number | null => {
  const key = normalized(label);
  if (key.includes('stunned')) return 4;
  if (key.includes('knockedout')) return 5;
  if (key.includes('badlyhurt')) return 6;
  if (key.includes('dead')) return 8;
  if (key.includes('injury') || key.includes('hurt')) return 7;
  // Owner 11-21: a named lasting injury ("BROKEN SHOULDER (-ST)") is a base-7 casualty too.
  if (casualtyKind(label) === 'lastingInjury') return 7;
  return null;
};
const casualtyKind = (value: unknown): 'badlyHurt' | 'seriouslyHurt' | 'seriousInjury' | 'lastingInjury' | 'dead' | null => {
  const key = normalized(value);
  if (key.includes('dead') || key.includes('rip')) return 'dead';
  // Any lasting injury names its characteristic as a "(-XX)" suffix: BB2025 "Broken Shoulder (-ST)" (c66198ac4, PR #364;
  // older games and replays keep "Dislocated Shoulder (-ST)"), BB2020 "Neck Injury (-AG)", the casualty card's
  // "LASTING INJURY (-ST)" (injuryOutcomeProjection.casualtyTierLabel).
  if (key.includes('lastinginjury') || /headinjury|smashedknee|brokenarm|dislocated/.test(key)
    || /\(\s*-\s*(?:MA|ST|AG|PA|AV)\s*\)/i.test(String(value ?? ''))) return 'lastingInjury';
  if (key.includes('seriouslyhurt') || key.includes('mng')) return 'seriouslyHurt';
  if (key.includes('seriousinjury') || key.endsWith('ni')) return 'seriousInjury';
  if (key.includes('badlyhurt')) return 'badlyHurt';
  return null;
};
const acceptedOutcomeMatches = (label: string, base: number | null, serious: unknown): boolean => {
  const expectedBase = labelBase(label);
  if (base === null || expectedBase === null || base !== expectedBase) return false;
  // The base is decisive for Stun, KO, Badly Hurt, and Dead. Base 7 covers
  // three distinct casualty outcomes, so require the authoritative serious-
  // injury value to agree with the displayed label.
  if (base !== 7) return true;
  const labelKind = casualtyKind(label);
  const seriousKind = casualtyKind(serious);
  if (labelKind === null || seriousKind === null || labelKind !== seriousKind) return false;
  // Owner 11-21: a tile that NAMES its lasting injury ("BROKEN ARM (-PA)") matches only that injury, so two lasting
  // injuries (Broken Shoulder vs Broken Arm) are told apart; the generic "LASTING INJURY (-XX)" tier keeps the kind match.
  if (labelKind === 'lastingInjury' && !normalized(label).includes('lastinginjury')) return normalized(label) === normalized(serious);
  return true;
};

export interface ApothecaryOutcomeCue {
  key: string;
  playerId: string;
  player: string;
  side: 'home' | 'away';
  square: [number, number] | null;
  oldInjury: string;
  newInjury: string;
  oldRoll: number | null;
  newRoll: number | null;
  newInjuryDie: number | null;
  selected: 'old' | 'new';
  outcome: string;
  autoReturn: boolean;
}

/** Project both ordinary accepted treatment and BB2025's automatic Badly Hurt return. */
export function apothecaryOutcomePresentation(
  reports: readonly Record<string, unknown>[],
  game: GameJson,
  commandNr: number | null,
  previousCard: ApothecaryResultProjection | null,
  previousInjuries: InjuryOutcomeProjection,
): ApothecaryOutcomeCue | null {
  const accepted = reports.find((report) => String(report.reportId) === 'apothecaryChoice');
  const playerId = String(accepted?.playerId ?? previousCard?.playerId ?? '');
  if (!accepted || !playerId) return null;
  const roll = reports.find((report) => String(report.reportId) === 'apothecaryRoll'
    && String(report.playerId ?? '') === playerId);
  const dice = Array.isArray(roll?.casualtyRoll) ? roll.casualtyRoll.map(Number) : [];
  const reportedNewRoll = Number.isFinite(dice[0]) ? dice[0]! : null;
  const newInjuryDie = Number.isFinite(dice[1]) ? dice[1]! : null;
  const autoReturn = !!roll && stateBase(roll.playerState) === 6 && stateBase(accepted.playerState) === 9;
  if (!autoReturn && !previousCard) return null;
  const original = previousInjuries.players.find((entry) => entry.playerId === playerId);
  const oldRoll = previousCard?.oldRoll ?? original?.roll ?? null;
  const newRoll = previousCard?.newRoll ?? reportedNewRoll;
  const oldInjury = previousCard?.oldInjury ?? original?.injury
    ?? (oldRoll == null ? 'Original injury' : casualtyRollLabel(oldRoll));
  const newInjury = previousCard?.newInjury
    ?? (newRoll == null ? 'Rerolled injury' : casualtyRollLabel(newRoll));
  const side: 'home' | 'away' = game.teamHome.playerArray.some((player) => player.playerId === playerId) ? 'home' : 'away';
  const teamResult = side === 'home' ? game.gameResult.teamResultHome : game.gameResult.teamResultAway;
  const modelSerious = teamResult.playerResults.find((result) => result.playerId === playerId)?.seriousInjury;
  const acceptedBase = stateBase(accepted.playerState);
  const acceptedSerious = accepted.seriousInjury ?? modelSerious ?? null;
  const oldMatch = acceptedOutcomeMatches(oldInjury, acceptedBase, acceptedSerious);
  const newMatch = acceptedOutcomeMatches(newInjury, acceptedBase, acceptedSerious);
  // If both labels describe the same authoritative outcome, or neither can be
  // proven from the received result, the spectator cannot recover the coach's
  // private click. Suppress the result card rather than naming a guessed choice.
  if (!autoReturn && oldMatch === newMatch) return null;
  const selected: 'old' | 'new' = autoReturn ? 'new' : oldMatch ? 'old' : 'new';
  const current = game.fieldModel.playerDataArray.find((player) => player.playerId === playerId)?.playerCoordinate;
  const square = previousCard?.square ?? original?.square
    ?? (current && current[0] >= 0 && current[0] < 26 && current[1] >= 0 && current[1] < 15
      ? [current[0], current[1]] as [number, number] : null);
  const player = previousCard?.player ?? playerName(game, playerId);
  return {
    key: `${String(game.gameId ?? 'unknown')}:${commandNr ?? 'unknown'}:${playerId}:${newRoll ?? 'choice'}`,
    playerId, player, side, square, oldInjury, newInjury, oldRoll, newRoll, newInjuryDie, selected, autoReturn,
    outcome: autoReturn ? `${player} returns to the bench.`
      : `Kept ${selected === 'old' ? 'Original' : 'Rerolled'}: ${selected === 'old' ? oldInjury : newInjury}`,
  };
}

export interface ApothecaryFixUpCue {
  playerId: string;
  player: string;
  side: 'home' | 'away';
  /** Where the server put the player: Reserves (the bench), left on the pitch Stunned, or (Astra r2 P2-4: after the
   *  coach's Original / Rerolled choice) a casualty the treatment did not undo. Owner 10-21: 'failed' = a failed
   *  Regeneration roll (the player stays in the casualty box; the view paints it fail red). */
  outcome: 'bench' | 'stunned' | 'casualty' | 'failed';
  /** Owner 10-18: who fixed them up - the Apothecary, or their own Regeneration. */
  kind: 'apothecary' | 'regeneration';
  text: string;
}

/** What an `apothecaryChoice` report claims for a player: Reserves (9) or Stunned (4). Owner 10-18: a successful
 *  `regenerationRoll` claims Reserves (9) the same way (`kind: 'regeneration'`); the rail and the model check are shared. */
export interface ApothecaryFixUpClaim {
  playerId: string; reported: 4 | 5 | 6 | 7 | 8 | 9; kind: 'apothecary' | 'regeneration';
  /** Astra r2 P2-4: the server's serious-injury result of a casualty outcome (the model's playerResult), else null. */
  serious?: string | null;
  /** Owner 10-21 ("Let's change regen so it pops with a red pill if it fails"): a FAILED regenerationRoll. `reported`
   *  is then the casualty the injury report named (informational); the model check is 'still a casualty'. */
  outcome?: 'failed';
  /** The regenerationRoll's own reRolled flag (a failed roll can be rerolled in the multi-block apothecary step). */
  reRolled?: boolean;
}
export type ApothecaryFixUpVerdict = 'agrees' | 'pending' | 'contradicted';

/** Owner 10-09: the server resolved the apothecary by itself - no `apothecaryChoice` dialog, nothing to choose.
 *  Upstream writes ReportApothecaryChoice ONLY on that branch (StepApothecary.rollApothecary, `!apothecaryChoice`;
 *  the multi-block step is identical), with the state that treatment produced:
 *    - a casualty whose reroll is Badly Hurt              -> RESERVE (9), preceded by an `apothecaryRoll` report
 *    - a Badly Hurt original                              -> RESERVE (9), no roll
 *    - a KO from a crowd push / trapdoor / KTM fumble     -> RESERVE (9), no roll
 *    - any other KO (InjuryType.canApoKoIntoStun)         -> STUNNED (4), the player stays on the pitch
 *  The LAST report per player in the frame is the claim; any other reported state claims nothing. */
export function apothecaryFixUpClaims(
  reports: readonly Record<string, unknown>[],
  game: GameJson,
): ApothecaryFixUpClaim[] {
  const last = new Map<string, number | null>();
  for (const report of reports) {
    if (String(report.reportId) !== 'apothecaryChoice') continue;
    const playerId = String(report.playerId ?? '');
    if (!playerId) continue;
    last.delete(playerId);
    last.set(playerId, stateBase(report.playerState));
  }
  const claims: ApothecaryFixUpClaim[] = [];
  for (const [playerId, reported] of last) {
    if (reported !== 4 && reported !== 9) continue;
    if (![...game.teamHome.playerArray, ...game.teamAway.playerArray].some((player) => player.playerId === playerId)) continue;
    claims.push({ playerId, reported, kind: 'apothecary' });
  }
  return claims;
}

/** Owner 10-18 ("Can we add a pill toast for when a regen is successful?"): a `regenerationRoll` with `successful: true`
 *  claims Reserves for its player. Upstream writes it in the INJURY frame itself (g1951999 #702: injury report +
 *  regenerationRoll + state 9 + the box coordinate in one serverModelSync), so the line is true at once - the store
 *  only holds it behind that player's casualty pill.
 *  Owner 10-21 ("Let's change regen so it pops with a red pill if it fails"): a FAILED roll claims 'still a casualty'
 *  (`outcome: 'failed'`; g1951158 #677: injury + failed regenerationRoll + state 6 + the box coordinate, one frame).
 *  The LAST roll per player in the frame is the claim: a reroll (reRolled:true) speaks for its final result only. */
export function regenerationFixUpClaims(
  reports: readonly Record<string, unknown>[],
  game: GameJson,
): ApothecaryFixUpClaim[] {
  const last = new Map<string, ApothecaryFixUpClaim>();
  const casualty = new Map<string, number>();
  for (const report of reports) {
    if (String(report.reportId) === 'injury') {
      const injury = Number(report.injury);
      if (injury >= 5 && injury <= 8) casualty.set(String(report.defenderId ?? ''), injury);
      continue;
    }
    if (String(report.reportId) !== 'regenerationRoll' || typeof report.successful !== 'boolean') continue;
    const playerId = String(report.playerId ?? '');
    if (!playerId) continue;
    if (![...game.teamHome.playerArray, ...game.teamAway.playerArray].some((player) => player.playerId === playerId)) continue;
    last.delete(playerId);
    last.set(playerId, report.successful
      ? { playerId, reported: 9, kind: 'regeneration' }
      : { playerId, reported: (casualty.get(playerId) ?? 6) as ApothecaryFixUpClaim['reported'], kind: 'regeneration', outcome: 'failed', reRolled: report.reRolled === true });
  }
  return [...last.values()];
}

/** The report alone is NOT the player's destination, and it is not always in the same frame as it either:
 *   - a multi-block attacker with two injuries can get a Reserves report for one while the other leaves them Dead;
 *   - StepApothecaryMultiple writes every report first, then applies and syncs each injury separately, and the first
 *     sync carries the whole report list - so a treated player's report can arrive a frame or two BEFORE their own
 *     state change, which then arrives with no report.
 *  So the claim is checked against the model: `agrees` (Reserves; or Stunned on the pitch) -> the line is true now;
 *  `contradicted` (the model put the player in a different final state: Stunned / KO / casualty / Dead / Reserves)
 *  -> never; `pending` (not moved yet) -> ask again after the next frame. */
export function apothecaryFixUpVerdict(game: GameJson, claim: ApothecaryFixUpClaim): ApothecaryFixUpVerdict {
  const data = game.fieldModel.playerDataArray.find((entry) => entry.playerId === claim.playerId);
  const base = stateBase(data?.playerState);
  if (base === null) return 'contradicted';
  // Owner 10-21: a failed Regeneration is true while the model holds him as a casualty (5..8: upstream leaves the
  // state + casualty-box square untouched on a failure); Reserves (a reroll / apothecary undid it) contradicts it;
  // anything else (still Prone on his square, the injury not applied yet) waits.
  if (claim.outcome === 'failed') return base >= 5 && base <= 8 ? 'agrees' : base === 9 || base === 4 ? 'contradicted' : 'pending';
  if (base === claim.reported) {
    if (claim.reported !== 4) return 'agrees';
    const square = data?.playerCoordinate;
    return square && square[0]! >= 0 && square[0]! < 26 && square[1]! >= 0 && square[1]! < 15 ? 'agrees' : 'pending';
  }
  return base >= 4 && base <= 9 ? 'contradicted' : 'pending';
}

const CASUALTY_RESULT: Record<number, string> = { 5: 'Knocked Out', 6: 'Badly Hurt', 7: 'Seriously Injured', 8: 'Dead' };
export function apothecaryFixUpCue(game: GameJson, claim: ApothecaryFixUpClaim): ApothecaryFixUpCue {
  const player = playerName(game, claim.playerId);
  const outcome = claim.outcome === 'failed' ? 'failed' : claim.reported === 9 ? 'bench' : claim.reported === 4 ? 'stunned' : 'casualty';
  // Astra r2 P2-4: a casualty outcome names the server's own result; it never says which alternative was kept.
  const result = claim.serious && claim.serious.trim() ? claim.serious.trim() : CASUALTY_RESULT[claim.reported] ?? '';
  return {
    playerId: claim.playerId, player, outcome, kind: claim.kind,
    side: game.teamHome.playerArray.some((entry) => entry.playerId === claim.playerId) ? 'home' : 'away',
    text: claim.kind === 'regeneration'
      ? outcome === 'failed' ? `${player} does not regenerate from their injury.` : `${player} regenerates and returns to the reserves!`
      : outcome === 'bench'
        ? `The Apothecary fixes up ${player} and they return to the bench!`
        : outcome === 'stunned'
          ? `The Apothecary fixes up ${player} and they stay on the pitch, Stunned!`
          : claim.reported >= 7
            ? `The Apothecary could not save ${player}: ${result}`
            : `The Apothecary patches up ${player}: ${result}`,
  };
}

/** Astra r2 P2-4: the outcome of a treatment the coach settled with the Original / Rerolled choice (the
 *  `apothecaryChoice` DIALOG - the server writes no apothecaryChoice report on that branch). Read from the model only:
 *  the player's final state + the server's serious-injury result. null while he is not in a final state yet. The
 *  coach's private pick is never named (identical alternatives cannot be told apart, and the line does not try). */
export function apothecaryChoiceOutcomeClaim(game: GameJson, playerId: string): ApothecaryFixUpClaim | null {
  const data = game.fieldModel.playerDataArray.find((entry) => entry.playerId === playerId);
  const base = stateBase(data?.playerState);
  if (base === null || base < 4 || base > 9) return null;
  const side = game.teamHome.playerArray.some((entry) => entry.playerId === playerId) ? 'home'
    : game.teamAway.playerArray.some((entry) => entry.playerId === playerId) ? 'away' : null;
  if (!side) return null;
  const results = side === 'home' ? game.gameResult.teamResultHome.playerResults : game.gameResult.teamResultAway.playerResults;
  const serious = results.find((entry) => entry.playerId === playerId)?.seriousInjury;
  return { playerId, reported: base as ApothecaryFixUpClaim['reported'], kind: 'apothecary', serious: typeof serious === 'string' ? serious : null };
}

/** The lines that are true in this very frame (`game` = the model AFTER it). When in doubt, none. */
export function apothecaryFixUpPresentation(
  reports: readonly Record<string, unknown>[],
  game: GameJson,
): ApothecaryFixUpCue[] {
  return apothecaryFixUpClaims(reports, game)
    .filter((claim) => apothecaryFixUpVerdict(game, claim) === 'agrees')
    .map((claim) => apothecaryFixUpCue(game, claim));
}

export interface SendOffOutcomeCue {
  kind: 'argue' | 'bribe';
  success: boolean;
  sentOff: boolean;
  coachBanned: boolean;
  rerolled: boolean;
  roll: number;
  playerName: string;
  side: 'home' | 'away';
  logoUrl: string | null;
  coach: string;
}

/** Undefined means no send-off report; null retires an unsettled first roll while B&C offers its reroll. */
export function sendOffOutcomePresentation(
  reports: readonly Record<string, unknown>[], game: GameJson,
): SendOffOutcomeCue | null | undefined {
  const result = [...reports].reverse().find((report) => ['argueTheCall', 'bribesRoll'].includes(String(report.reportId)));
  if (!result) return undefined;
  const rerolled = reports.some((report) => normalized(report.reportId) === 'briberyandcorruptionreroll'
    && normalized(report.briberyAncCorruptionAction ?? report.action) === 'used');
  if (normalized(game.dialogParameter?.dialogId) === 'briberyandcorruptionreroll' && !rerolled) return null;
  const playerId = String(result.playerId ?? '');
  const side: 'home' | 'away' = game.teamHome.playerArray.some((player) => player.playerId === playerId) ? 'home' : 'away';
  const team = side === 'home' ? game.teamHome : game.teamAway;
  const kind: 'argue' | 'bribe' = String(result.reportId) === 'bribesRoll' ? 'bribe' : 'argue';
  return {
    kind, success: result.successful === true, sentOff: result.successful !== true,
    coachBanned: kind === 'argue' && result.coachBanned === true,
    rerolled: kind === 'argue' && rerolled, roll: Number(result.roll ?? 0),
    playerName: playerName(game, playerId), side,
    logoUrl: (team.roster as { logoUrl?: string } | undefined)?.logoUrl ?? null,
    coach: String(team.coach ?? ''),
  };
}
