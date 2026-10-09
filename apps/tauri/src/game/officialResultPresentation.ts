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
  return null;
};
const casualtyKind = (value: unknown): 'badlyHurt' | 'seriouslyHurt' | 'seriousInjury' | 'lastingInjury' | 'dead' | null => {
  const key = normalized(value);
  if (key.includes('dead') || key.includes('rip')) return 'dead';
  if (key.includes('lastinginjury') || /headinjury|smashedknee|brokenarm|dislocated/.test(key)) return 'lastingInjury';
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
  return labelKind !== null && seriousKind !== null && labelKind === seriousKind;
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
  /** Where the server put the player: Reserves (the bench), or left on the pitch Stunned. */
  outcome: 'bench' | 'stunned';
  text: string;
}

/** What an `apothecaryChoice` report claims for a player: Reserves (9) or Stunned (4). */
export interface ApothecaryFixUpClaim { playerId: string; reported: 4 | 9 }
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
    claims.push({ playerId, reported });
  }
  return claims;
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
  if (base === claim.reported) {
    if (claim.reported === 9) return 'agrees';
    const square = data?.playerCoordinate;
    return square && square[0]! >= 0 && square[0]! < 26 && square[1]! >= 0 && square[1]! < 15 ? 'agrees' : 'pending';
  }
  return base >= 4 && base <= 9 ? 'contradicted' : 'pending';
}

export function apothecaryFixUpCue(game: GameJson, claim: ApothecaryFixUpClaim): ApothecaryFixUpCue {
  const player = playerName(game, claim.playerId);
  const outcome = claim.reported === 9 ? 'bench' : 'stunned';
  return {
    playerId: claim.playerId, player, outcome,
    side: game.teamHome.playerArray.some((entry) => entry.playerId === claim.playerId) ? 'home' : 'away',
    text: outcome === 'bench'
      ? `The Apothecary fixes up ${player} and they return to the bench!`
      : `The Apothecary fixes up ${player} and they stay on the pitch, Stunned!`,
  };
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
