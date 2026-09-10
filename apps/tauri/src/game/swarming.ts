import {
  PlayerStateBase,
  isLeftWideColumn,
  isOnLos,
  isOwnHalf,
  isRightWideColumn,
} from '@fumbbl40k/ffb-pitch';

export type SwarmingCoordinate = readonly [number, number];

export interface SwarmingRosterPlayer {
  playerId: string;
  positionId?: string | number;
}

export interface SwarmingRosterPosition {
  positionId?: string | number;
  positionName?: string;
  keywords?: readonly string[];
}

export interface SwarmingTeam {
  playerArray?: readonly SwarmingRosterPlayer[];
  roster?: { positionArray?: readonly SwarmingRosterPosition[] };
}

export interface SwarmingPlayerData {
  playerId: string;
  playerState: number;
  playerCoordinate?: SwarmingCoordinate | null;
}

export interface SwarmingDialogConstraint {
  amount: number | null;
  restrictPlacement: boolean;
}

export interface SwarmingDialogProjection extends SwarmingDialogConstraint {
  /** True only when a reconnect joined an already-rejected placement and the roll was no longer on the wire. */
  recoveredWithoutOffer: boolean;
  setupErrors: string[];
  countError: { allowed: number; actual: number } | null;
}

/**
 * StepSwarming keeps the SWARMING turn open after either rejection. The over-count branch raises
 * `swarmingError`; SetupMechanic raises the ordinary `setupError` used by normal setup. Neither dialog expects
 * a client answer. Preserve the offer's constraint across those dialogs, and fail soft on a fresh reconnect
 * where SetupError cannot repeat the rolled amount (StepSwarming serializes it only in server step state).
 */
export function projectSwarmingDialog(
  dialog: Record<string, unknown> | null | undefined,
  prior: SwarmingDialogConstraint | null,
): SwarmingDialogProjection | null {
  const dialogId = String(dialog?.dialogId ?? '');
  if (dialogId === 'swarming') {
    const amount = Number(dialog?.swarmingPlayerAmount);
    if (!Number.isInteger(amount) || amount < 0) return null;
    return {
      amount,
      restrictPlacement: dialog?.restrictPlacement !== false,
      recoveredWithoutOffer: false,
      setupErrors: [],
      countError: null,
    };
  }
  if (dialogId === 'swarmingError') {
    const allowed = Number(dialog?.swarmingPlayerAllowed);
    const actual = Number(dialog?.swarmingPlayerActual);
    if (!Number.isInteger(allowed) || allowed < 0) return null;
    return {
      amount: allowed,
      restrictPlacement: prior?.restrictPlacement ?? false,
      recoveredWithoutOffer: prior === null,
      setupErrors: [],
      countError: Number.isInteger(actual) && actual >= 0 ? { allowed, actual } : null,
    };
  }
  if (dialogId === 'setupError') {
    const setupErrors = Array.isArray(dialog?.setupErrors)
      ? dialog.setupErrors.filter((message): message is string => typeof message === 'string' && message.trim().length > 0)
      : [];
    return {
      amount: prior?.amount ?? null,
      // BB2025 StepSwarming sends false. On a fresh join the restriction is absent, so use the least restrictive
      // client geometry and leave final admission to SetupMechanic instead of wedging the correction surface.
      restrictPlacement: prior?.restrictPlacement ?? false,
      recoveredWithoutOffer: prior === null,
      setupErrors,
      countError: null,
    };
  }
  return null;
}

/** availableActions.ts:1373-1385: keywords belong to the roster position, not the field player. */
export function swarmingPositionKeywords(
  team: SwarmingTeam,
  player: SwarmingRosterPlayer,
): readonly string[] {
  return team.roster?.positionArray?.find(
    (position) => String(position.positionId) === String(player.positionId),
  )?.keywords ?? [];
}

function hasLinemanKeyword(team: SwarmingTeam, player: SwarmingRosterPlayer): boolean {
  return swarmingPositionKeywords(team, player)
    .some((keyword) => keyword.toLowerCase() === 'lineman');
}

/** ffb-server/.../bb2025/kickoff/StepSwarming.java:139-146: only LINEMAN roster-position reserves arm. */
export function isSwarmingReserveEligible(
  team: SwarmingTeam,
  player: SwarmingRosterPlayer,
  data: SwarmingPlayerData | undefined,
): boolean {
  const base = (data?.playerState ?? PlayerStateBase.UNKNOWN) & 0xff;
  if (base === PlayerStateBase.PRONE) return false;
  return base === PlayerStateBase.RESERVE && hasLinemanKeyword(team, player);
}

/** FieldCoordinate.java:145-164: box coordinates use the seven home/away dugout x sentinels. */
function isBoxCoordinate([x]: SwarmingCoordinate): boolean {
  return (x >= -7 && x <= -1) || (x >= 30 && x <= 36);
}

function sameCoordinate(a: SwarmingCoordinate | null | undefined, b: SwarmingCoordinate): boolean {
  return !!a && a[0] === b[0] && a[1] === b[1];
}

/**
 * ffb-client-logic/.../bb2025/SwarmingLogicModule.java:28-30 allows empty HALF_HOME or box squares.
 * Its mixed variant at :28-34 additionally excludes LOS_HOME and both wide zones.
 */
export function isSwarmingSquareLegal(
  coordinate: SwarmingCoordinate,
  occupied: readonly (SwarmingCoordinate | null | undefined)[],
  restrictPlacement: boolean,
): boolean {
  const [x, y] = coordinate;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (occupied.some((other) => sameCoordinate(other, coordinate))) return false;
  if (isBoxCoordinate(coordinate)) return true;
  if (!isOwnHalf(x) || y < 0 || y > 14) return false;
  if (!restrictPlacement) return true;
  return !(isOnLos(x) && !isLeftWideColumn(y) && !isRightWideColumn(y))
    && !isLeftWideColumn(y)
    && !isRightWideColumn(y);
}

export function swarmingLegalPitchSquares(
  occupied: readonly (SwarmingCoordinate | null | undefined)[],
  restrictPlacement: boolean,
): [number, number][] {
  const squares: [number, number][] = [];
  for (let x = 0; x <= 12; x += 1) {
    for (let y = 0; y <= 14; y += 1) {
      if (isSwarmingSquareLegal([x, y], occupied, restrictPlacement)) squares.push([x, y]);
    }
  }
  return squares;
}

/** ffb-server/.../bb2025/kickoff/StepSwarming.java:104-118 rejects only when placements exceed the roll. */
export function isSwarmingPlacementCountLegal(placed: number, amount: number): boolean {
  return Number.isInteger(placed) && Number.isInteger(amount) && placed >= 0 && amount >= 0 && placed <= amount;
}
