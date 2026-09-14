import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { injuryTypeName } from './casualtyRollProjection';

export const OBSERVED_MOVEMENT_PHASES = ['observed', 'failed', 'injury'] as const;
export type ObservedMovementPhase = (typeof OBSERVED_MOVEMENT_PHASES)[number];

/**
 * Receive-side movement evidence. The destination is copied only from an admitted
 * fieldModelSetPlayerCoordinate command; it is never inferred from a client send,
 * a move-square offer, or the later injury report.
 */
export interface ObservedMovementOccurrence {
  playerId: string;
  from: [number, number];
  to: [number, number];
  phase: ObservedMovementPhase;
  observedAt: number;
  failedAt: number | null;
  injuryAt: number | null;
}

type ModelChange = { modelChangeId?: unknown; modelChangeKey?: unknown; modelChangeValue?: unknown };

const onPitch = (value: unknown): value is readonly [number, number] => Array.isArray(value) && value.length >= 2
  && Number.isInteger(value[0]) && value[0] >= 0 && value[0] < 26
  && Number.isInteger(value[1]) && value[1] >= 0 && value[1] < 15;

const adjacent = (from: readonly [number, number], to: readonly [number, number]): boolean =>
  Math.max(Math.abs(from[0] - to[0]), Math.abs(from[1] - to[1])) === 1;

const actorId = (game: GameJson): string => String((game.actingPlayer as { playerId?: unknown } | null)?.playerId ?? '');
const actorAction = (game: GameJson): string => String((game.actingPlayer as { playerAction?: unknown } | null)?.playerAction ?? '');

function observedStep(
  previousGame: GameJson,
  nextGame: GameJson,
  changes: readonly ModelChange[],
  sourceSequence: number,
): ObservedMovementOccurrence | null {
  const actors = new Set([actorId(previousGame), actorId(nextGame)].filter(Boolean));
  if (!actors.size || (!actorAction(previousGame) && !actorAction(nextGame))) return null;
  const coordinates = new Map<string, readonly number[] | null>(previousGame.fieldModel.playerDataArray
    .map((player) => [player.playerId, player.playerCoordinate]));
  let observed: ObservedMovementOccurrence | null = null;
  for (const change of changes) {
    if (change.modelChangeId !== 'fieldModelSetPlayerCoordinate') continue;
    const playerId = String(change.modelChangeKey ?? '');
    const from = coordinates.get(playerId);
    const to = change.modelChangeValue;
    // Update the received coordinate ledger even when this change is an off-pitch
    // relocation. Only an adjacent on-pitch actor step is movement evidence.
    coordinates.set(playerId, Array.isArray(to) ? to as number[] : null);
    if (!playerId || !actors.has(playerId) || !onPitch(from) || !onPitch(to) || !adjacent(from, to)) continue;
    observed = {
      playerId,
      from: [from[0], from[1]],
      to: [to[0], to[1]],
      phase: 'observed',
      observedAt: sourceSequence,
      failedAt: null,
      injuryAt: null,
    };
  }
  return observed;
}

const movementRoll = (report: Readonly<Record<string, unknown>>): boolean =>
  ['dodgeRoll', 'goForItRoll', 'pickUpRoll'].includes(String(report.reportId ?? ''));

const failedMovementInjury = (report: Readonly<Record<string, unknown>>): boolean => {
  if (report.reportId !== 'injury') return false;
  const type = injuryTypeName(report.injuryType).toLowerCase();
  return type === 'dropdodge' || type === 'dropgfi';
};

/**
 * Reduce one admitted server event. A resolved injury remains for exactly its
 * checkpoint so transient replay presentation can use the same durable evidence;
 * the next event expires it. Failed rerolls stay pending until a successful
 * reroll, the matching fall, a new observed step, or an activation boundary.
 */
export function reduceObservedMovementOccurrence(
  previous: ObservedMovementOccurrence | null,
  previousGame: GameJson,
  nextGame: GameJson,
  changes: readonly ModelChange[],
  reports: readonly Readonly<Record<string, unknown>>[],
  sourceSequence: number,
): ObservedMovementOccurrence | null {
  let occurrence = previous?.phase === 'injury' ? null : previous ? structuredClone(previous) : null;
  const step = observedStep(previousGame, nextGame, changes, sourceSequence);
  if (step) occurrence = step;

  for (const report of reports) {
    if (!occurrence) continue;
    const playerId = String(report.playerId ?? report.defenderId ?? '');
    if (playerId !== occurrence.playerId) continue;
    if (movementRoll(report)) {
      if (report.successful === false) {
        occurrence = { ...occurrence, phase: 'failed', failedAt: occurrence.failedAt ?? sourceSequence, injuryAt: null };
      } else if (report.successful === true && occurrence.phase === 'failed') {
        occurrence = null;
      }
      continue;
    }
    if (failedMovementInjury(report)) {
      occurrence = {
        ...occurrence,
        phase: 'injury',
        failedAt: occurrence.failedAt ?? sourceSequence,
        injuryAt: sourceSequence,
      };
    }
  }

  if (!occurrence || occurrence.phase === 'injury') return occurrence;
  const turnEnded = reports.some((report) => report.reportId === 'turnEnd');
  const afterActor = actorId(nextGame);
  const activationEnded = afterActor !== occurrence.playerId || !actorAction(nextGame);
  return turnEnded || activationEnded ? null : occurrence;
}

export function observedFailedMovementDestination(
  occurrence: ObservedMovementOccurrence | null | undefined,
  playerId: string,
): [number, number] | null {
  return occurrence && occurrence.playerId === playerId && (occurrence.phase === 'failed' || occurrence.phase === 'injury')
    ? [occurrence.to[0], occurrence.to[1]] : null;
}
