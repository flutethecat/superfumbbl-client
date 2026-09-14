import type { GameJson } from '@fumbbl40k/ffb-protocol';

export const PASS_RE_ROLL_RESULTS = ['Accurate', 'Inaccurate', 'Wildly Inaccurate', 'Fumble'] as const;
export type PassReRollResult = (typeof PASS_RE_ROLL_RESULTS)[number];
export const PASS_ROLL_REPORT_IDS = ['passRoll', 'throwTeamMateRoll'] as const;

export interface ServerPassRollTruth {
  reportId: (typeof PASS_ROLL_REPORT_IDS)[number];
  roll: number;
  minimumRoll?: number;
  result?: PassReRollResult;
  bomb: boolean;
}

export function classifyPassTestResult(input: {
  roll: number;
  passTest: number;
  negativeModifiers?: number;
  passResult?: unknown;
}): PassReRollResult | undefined {
  const serverResult = String(input.passResult ?? '').toUpperCase();
  if (serverResult === 'ACCURATE') return 'Accurate';
  if (serverResult === 'INACCURATE') return 'Inaccurate';
  if (serverResult === 'WILDLY_INACCURATE') return 'Wildly Inaccurate';
  if (serverResult === 'FUMBLE' || serverResult === 'SAVED_FUMBLE') return 'Fumble';
  if (!Number.isInteger(input.roll) || !Number.isFinite(input.passTest)) return undefined;
  if (input.roll === 1) return 'Fumble';
  if (input.roll === 6) return 'Accurate';
  const modifiers = Number.isFinite(input.negativeModifiers) ? input.negativeModifiers ?? 0 : 0;
  const modifiedRoll = input.roll - modifiers;
  if (modifiedRoll >= input.passTest) return 'Accurate';
  return modifiedRoll <= 1 ? 'Fumble' : 'Inaccurate';
}

export function serverPassRollTruth(report: Record<string, unknown>): ServerPassRollTruth | undefined {
  const reportId = String(report.reportId);
  const roll = Number(report.roll);
  if ((reportId !== 'passRoll' && reportId !== 'throwTeamMateRoll') || !Number.isInteger(roll) || roll < 1 || roll > 6) {
    return undefined;
  }
  const minimum = Number(report.minimumRoll);
  const result = report.passResult == null ? undefined : classifyPassTestResult({ roll, passTest: minimum, passResult: report.passResult });
  return {
    reportId,
    roll,
    ...(Number.isFinite(minimum) && minimum > 0 ? { minimumRoll: minimum } : {}),
    ...(result === undefined ? {} : { result }),
    bomb: reportId === 'passRoll' && report.bomb === true,
  };
}

export interface ActionRollEntry { playerId: string; roll: number | null; needed: number | null; pass: ServerPassRollTruth | null }
export interface ActionRollProjection { players: ActionRollEntry[] }
export const createActionRollProjection = (): ActionRollProjection => ({ players: [] });
export const actionRollFor = (projection: ActionRollProjection, playerId: string): ActionRollEntry | undefined => projection.players.find((p) => p.playerId === playerId);

/** Previous action facts used by pending reroll/pass cards; never read a future receive tracker. */
export function reduceActionRollProjection(previous: ActionRollProjection, reports: readonly Record<string, unknown>[], game: GameJson): ActionRollProjection {
  const roster = new Set([...game.teamHome.playerArray, ...game.teamAway.playerArray].map((p) => p.playerId));
  const players = new Map(previous.players.filter((p) => roster.has(p.playerId)).map((p) => [p.playerId, { ...p }]));
  for (const report of reports) {
    const id = String(report.reportId);
    const punt = id === 'puntDistanceRoll' || id === 'puntDirectionRoll';
    const playerId = typeof report.playerId === 'string' ? report.playerId : punt ? String(game.actingPlayer?.playerId ?? '') : '';
    if (!playerId || !roster.has(playerId)) continue;
    const entry = players.get(playerId) ?? { playerId, roll: null, needed: null, pass: null };
    const puntRoll = Number(id === 'puntDirectionRoll' ? report.directionRoll : report.roll);
    if (punt && Number.isInteger(puntRoll) && puntRoll >= 1 && puntRoll <= 6) {
      entry.roll = puntRoll; entry.needed = null; players.set(playerId, entry);
    }
    const roll = report.roll;
    if (typeof report.playerId !== 'string' || typeof roll !== 'number' || !Number.isInteger(roll) || roll < 1 || roll > 6) continue;
    entry.roll = roll;
    if (id === 'passRoll' || id === 'throwTeamMateRoll') entry.pass = serverPassRollTruth(report) ?? entry.pass;
    else entry.pass = null;
    const needed = Number(report.minimumRoll);
    if (Number.isFinite(needed) && needed >= 2 && needed <= 6) entry.needed = needed;
    else if (report.reRolled !== true) entry.needed = null;
    players.set(playerId, entry);
  }
  return { players: [...players.values()] };
}
