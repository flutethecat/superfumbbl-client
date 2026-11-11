import { NetCommandId } from '@fumbbl40k/ffb-protocol';
import { PlayerStateBase, PlayerStateFlag } from '@fumbbl40k/ffb-pitch';

export type OnTheBallMode = 'kickoffReturn' | 'passBlock' | 'dumpOffPassBlock';
/** The pass-block reaction modes: upstream TurnMode.isPassBlock() (43a845f6c, TurnMode.java) = PASS_BLOCK or
 *  DUMP_OFF_PASS_BLOCK ("dumpOffPassBlock": the ACTIVE team's On the Ball players react to an opposing Dump-off;
 *  homePlaying does not flip, team rerolls are allowed and Pro is not, the interrupted action resumes afterwards). */
export type PassBlockMode = 'passBlock' | 'dumpOffPassBlock';
export const ON_THE_BALL_TURN_MODES: readonly OnTheBallMode[] = ['kickoffReturn', 'passBlock', 'dumpOffPassBlock'];
/** Every client special-case of `passBlock` reads this, never the literal (source pin: dumpOffPassBlockCoverage.test.ts). */
export function isPassBlockMode(mode: unknown): mode is PassBlockMode {
  return mode === 'passBlock' || mode === 'dumpOffPassBlock';
}
export function isOnTheBallTurnMode(mode: unknown): mode is OnTheBallMode {
  return mode === 'kickoffReturn' || isPassBlockMode(mode);
}
/** The information dialog the mode raises. StepPassBlock (bb2025) sets DialogPassBlockParameter (DialogId.PASS_BLOCK =
 *  "passBlock") in BOTH pass-block modes, so the dialog id is not the turn mode during a dump-off pass block. */
export function onTheBallDialogId(mode: OnTheBallMode): 'kickoffReturn' | 'passBlock' {
  return mode === 'kickoffReturn' ? 'kickoffReturn' : 'passBlock';
}
export type OnTheBallAudience = 'owner-player' | 'opponent-player' | 'spectator' | 'replay' | 'headless';

export interface OnTheBallFrame {
  gameId: string;
  connectionEpoch: number;
  phaseIdentity: number;
  modelRevision: number;
  turnMode: string;
  dialogId: string | null;
  audience: OnTheBallAudience;
  actingPlayerId: string | null;
  actingPlayerAction: 'move' | null;
  actingPlayerCoordinate: [number, number] | null;
  moveSquares: readonly [number, number][];
  actingPlayerLeaping: boolean;
  jumpAvailable: boolean;
  boundingLeapSkill: string | null;
  endMoveAvailable: boolean;
  canEndPhase: boolean;
  eligiblePlayerIds: readonly string[];
}

export interface OnTheBallCandidateState {
  playerId: string;
  mine: boolean;
  active: boolean;
  onPitch: boolean;
  ableToMove: boolean;
  /** Upstream 351cdeed9: during a pass block the MOVING player is the one whose action a Dump-off interrupted; he keeps
   *  his active flag but PassBlockLogicModule.playerInteraction and StepInitSelecting both refuse him. */
  interruptedMover?: boolean;
}

/** Exact received-state half of Java PlayerState.isAbleToMove(). */
export function onTheBallPlayerStateIsAbleToMove(playerState: number): boolean {
  const base = playerState & 0xff;
  return (base === PlayerStateBase.STANDING || base === PlayerStateBase.MOVING || base === PlayerStateBase.PRONE)
    && (playerState & PlayerStateFlag.ROOTED) === 0
    && (playerState & PlayerStateFlag.CHOMPED) === 0;
}

export function selectableOnTheBallIds(players: readonly OnTheBallCandidateState[]): string[] {
  return players
    .filter((player) => player.mine && player.active && player.onPitch && player.ableToMove && !player.interruptedMover)
    .map((player) => player.playerId);
}

export interface OnTheBallOrderedModelEvent {
  gameId: string;
  connectionEpoch: number;
  receiveSequence: number;
  turnMode: string;
  dialogSetId: string | null;
}

/** Ordered GAME_SET_DIALOG_PARAMETER events define occurrences; snapshots do not. */
export class OnTheBallOccurrenceTracker {
  private instance = '';
  private lastReceiveSequence = -1;
  private occurrence = 0;

  note(event: OnTheBallOrderedModelEvent): number {
    const instance = `${event.gameId}:${event.connectionEpoch}`;
    if (instance !== this.instance) {
      this.instance = instance;
      this.lastReceiveSequence = -1;
      this.occurrence = 0;
    }
    if (!Number.isInteger(event.receiveSequence) || event.receiveSequence <= this.lastReceiveSequence) {
      return this.occurrence;
    }
    this.lastReceiveSequence = event.receiveSequence;
    if (isOnTheBallTurnMode(event.turnMode) && event.dialogSetId === onTheBallDialogId(event.turnMode)) {
      this.occurrence += 1;
    }
    return this.occurrence;
  }
}

export type OnTheBallCommand =
  | { netCommandId: typeof NetCommandId.CLIENT_ACTING_PLAYER; playerId: string; playerAction: 'move'; leaping: false }
  | { netCommandId: typeof NetCommandId.CLIENT_ACTING_PLAYER; playerId: string; playerAction: 'move'; leaping: boolean }
  | { netCommandId: typeof NetCommandId.CLIENT_ACTING_PLAYER; playerId: null; playerAction: null; leaping: false }
  | { netCommandId: typeof NetCommandId.CLIENT_MOVE; actingPlayerId: string; coordinateFrom: [number, number]; coordinatesTo: [[number, number]] }
  | { netCommandId: typeof NetCommandId.CLIENT_USE_SKILL; skill: string; skillUsed: true; playerId: string }
  | { netCommandId: typeof NetCommandId.CLIENT_END_TURN; turnMode: OnTheBallMode; playersAtCoordinates: Record<string, never> };

export type OnTheBallSend = (command: OnTheBallCommand) => boolean;

export type OnTheBallProjection =
  | { kind: 'inactive' }
  | { kind: 'blocked'; mode: OnTheBallMode; dialogId: string }
  | { kind: 'waiting'; mode: OnTheBallMode }
  | { kind: 'select'; mode: OnTheBallMode; eligiblePlayerIds: readonly string[]; canDecline: true; round: number }
  | { kind: 'awaiting-acting-player'; mode: OnTheBallMode; playerId: string }
  | { kind: 'awaiting-end-mover'; mode: OnTheBallMode; playerId: string }
  | { kind: 'awaiting-action-echo'; mode: OnTheBallMode; playerId: string; action: 'jump' | 'boundingLeap' }
  | { kind: 'moving'; mode: OnTheBallMode; playerId: string; actions: readonly OnTheBallAction[] }
  | { kind: 'ending'; mode: OnTheBallMode };

export type OnTheBallAction = 'move' | 'endMove' | 'endPhase' | 'jump' | 'boundingLeap';

export interface OnTheBallAuthorityInput {
  view: 'player' | 'spectator' | 'replay' | 'headless';
  playActive: boolean;
  myTeamId: string | null;
  teamHomeId: string;
  teamAwayId: string;
  homePlaying: boolean;
}

export interface OnTheBallWaitingInput {
  audience: OnTheBallAudience;
  turnMode: string;
  homePlaying: boolean;
  teamHome: { coach?: string | null; teamName?: string | null };
  teamAway: { coach?: string | null; teamName?: string | null };
}

export interface OnTheBallWaitingProjection {
  mode: OnTheBallMode;
  coach: string;
  teamName: string;
  message: string;
}

/** Passive opponent-seat copy derived only from the server-owned reaction side. */
export function projectOnTheBallWaiting(input: OnTheBallWaitingInput): OnTheBallWaitingProjection | null {
  const mode = isOnTheBallTurnMode(input.turnMode) ? input.turnMode : null;
  if (!mode || input.audience !== 'opponent-player') return null;
  const team = input.homePlaying ? input.teamHome : input.teamAway;
  const coach = String(team.coach ?? '').trim();
  const teamName = String(team.teamName ?? '').trim();
  const subject = coach || teamName || 'Your opponent';
  const teamSuffix = coach && teamName ? ` (${teamName})` : '';
  // The dump-off thrower's coach: his pass is already chosen (StepInitPassing ran before StepPassBlock) and waits
  // for the reacting coach's On the Ball moves; it resumes when the server leaves dumpOffPassBlock.
  if (mode === 'dumpOffPassBlock') {
    return { mode, coach, teamName, message: `Waiting for ${subject}'s On The Ball reaction to the dump-off…` };
  }
  return { mode, coach, teamName, message: `Waiting for ${subject}${teamSuffix} to act…` };
}

export function deriveOnTheBallAudience(input: OnTheBallAuthorityInput): OnTheBallAudience {
  if (input.view === 'spectator') return 'spectator';
  if (input.view === 'replay') return 'replay';
  const known = input.myTeamId === input.teamHomeId || input.myTeamId === input.teamAwayId;
  const owns = known && input.homePlaying === (input.myTeamId === input.teamHomeId);
  if (input.view === 'headless') return input.playActive && owns ? 'headless' : 'opponent-player';
  return input.playActive && owns ? 'owner-player' : 'opponent-player';
}

const modeFrom = (frame: OnTheBallFrame): OnTheBallMode | null =>
  isOnTheBallTurnMode(frame.turnMode) ? frame.turnMode : null;

const exactKeys = (command: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean => {
  const actual = Object.keys(command).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const emptyRecord = (value: unknown): boolean =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0;

const sameSquare = (a: unknown, b: readonly [number, number] | null): boolean =>
  Array.isArray(a) && a.length === 2 && !!b && Number(a[0]) === b[0] && Number(a[1]) === b[1];

/**
 * Exact declarations which answer the live, fieldless On-the-Ball information dialog.
 * This is deliberately narrower than a generic dialog bypass: it proves the live mode,
 * reacting seat, current actor/candidate, server-offered square, and byte-shape first.
 */
export function isOwnedOnTheBallDialogCommand(
  frame: OnTheBallFrame,
  command: Readonly<Record<string, unknown>>,
): boolean {
  const mode = modeFrom(frame);
  if (!mode || frame.dialogId !== onTheBallDialogId(mode)) return false;
  const owner = frame.audience === 'owner-player';
  const ownerOrHeadless = owner || frame.audience === 'headless';
  const id = String(command.netCommandId ?? '');

  if (id === NetCommandId.CLIENT_END_TURN) {
    return ownerOrHeadless
      && exactKeys(command, ['netCommandId', 'turnMode', 'playersAtCoordinates'])
      && command.turnMode === mode
      && emptyRecord(command.playersAtCoordinates);
  }
  if (!owner) return false;

  if (!frame.actingPlayerId) {
    return id === NetCommandId.CLIENT_ACTING_PLAYER
      && exactKeys(command, ['netCommandId', 'playerId', 'playerAction', 'leaping'])
      && typeof command.playerId === 'string'
      && frame.eligiblePlayerIds.includes(command.playerId)
      && command.playerAction === 'move'
      && command.leaping === false;
  }

  if (id === NetCommandId.CLIENT_MOVE) {
    const destinations = command.coordinatesTo;
    if (!exactKeys(command, ['netCommandId', 'actingPlayerId', 'coordinateFrom', 'coordinatesTo'])
      || command.actingPlayerId !== frame.actingPlayerId
      || !sameSquare(command.coordinateFrom, frame.actingPlayerCoordinate)
      || !Array.isArray(destinations)
      || destinations.length !== 1) return false;
    return frame.moveSquares.some((square) => sameSquare(destinations[0], square));
  }

  if (id === NetCommandId.CLIENT_ACTING_PLAYER
    && exactKeys(command, ['netCommandId', 'playerId', 'playerAction', 'leaping'])) {
    if (command.playerId === null) {
      return command.playerAction === null && command.leaping === false && frame.endMoveAvailable;
    }
    return isPassBlockMode(mode)
      && frame.jumpAvailable
      && command.playerId === frame.actingPlayerId
      && command.playerAction === 'move'
      && command.leaping === !frame.actingPlayerLeaping;
  }

  return id === NetCommandId.CLIENT_USE_SKILL
    && exactKeys(command, ['netCommandId', 'skill', 'skillUsed', 'playerId'])
    && isPassBlockMode(mode)
    && frame.jumpAvailable
    && !frame.actingPlayerLeaping
    && !!frame.boundingLeapSkill
    && command.skill === frame.boundingLeapSkill
    && command.skillUsed === true
    && command.playerId === frame.actingPlayerId;
}

export function upstreamOnTheBallActions(frame: OnTheBallFrame, mode: OnTheBallMode): readonly OnTheBallAction[] {
  if (!frame.actingPlayerId) return ['move', 'endPhase'];
  const actions: OnTheBallAction[] = [];
  if (frame.endMoveAvailable) actions.push('endMove');
  if (frame.canEndPhase) actions.push('endPhase');
  if (isPassBlockMode(mode) && frame.jumpAvailable) {
    actions.push('jump');
    if (!frame.actingPlayerLeaping && frame.boundingLeapSkill) actions.push('boundingLeap');
  }
  return actions;
}

/** Latches fail open (owner P0 10-16): a mover declaration, an End or an End-mover the server never answers (a mismatched or dropped command)
 *  must not hold the surface forever. After this grace the reaction re-surfaces from the received state; nothing is
 *  re-sent (the client never auto-answers). The store's watchdog re-syncs once the grace has run out. */
export const ON_THE_BALL_ECHO_GRACE_MS = 3000;

/**
 * Shared On the Ball transaction. See docs/on-the-ball-kickoff-pass-upstream-deep-dive.md.
 */
export class OnTheBallController {
  private instance: string | null = null;
  private mode: OnTheBallMode | null = null;
  private round = 0;
  private priorActingPlayerId: string | null = null;
  private awaitingPlayerId: string | null = null;
  private awaitingPlayerAtRevision = -1;
  private endMoverSentFor: string | null = null;
  private pendingAction: { playerId: string; action: 'jump' | 'boundingLeap'; afterRevision: number } | null = null;
  private ending = false;
  private endingAt = 0;
  private endMoverSentAt = 0;
  private awaitingPlayerSentAt = 0;

  constructor(private readonly send: OnTheBallSend, private readonly now: () => number = () => Date.now()) {}

  sync(frame: OnTheBallFrame): OnTheBallProjection {
    const mode = modeFrom(frame);
    const instance = `${frame.gameId}:${frame.connectionEpoch}:${frame.phaseIdentity}`;
    if (instance !== this.instance || mode !== this.mode) {
      this.instance = instance;
      this.mode = mode;
      this.round = 0;
      this.priorActingPlayerId = null;
      this.awaitingPlayerId = null;
      this.awaitingPlayerAtRevision = -1;
      this.endMoverSentFor = null;
      this.pendingAction = null;
      this.ending = false;
    }
    if (!mode) return { kind: 'inactive' };
    // fail open: an unanswered End / End-mover releases after the grace (the server's state decides from there)
    if (this.ending && this.now() - this.endingAt >= ON_THE_BALL_ECHO_GRACE_MS) this.ending = false;
    if (this.endMoverSentFor && this.now() - this.endMoverSentAt >= ON_THE_BALL_ECHO_GRACE_MS) this.endMoverSentFor = null;
    if (this.awaitingPlayerId && this.now() - this.awaitingPlayerSentAt >= ON_THE_BALL_ECHO_GRACE_MS) {
      this.awaitingPlayerId = null;
      this.awaitingPlayerAtRevision = -1;
    }
    if (frame.dialogId !== null && frame.dialogId !== onTheBallDialogId(mode)) {
      return { kind: 'blocked', mode, dialogId: frame.dialogId };
    }
    if (frame.audience === 'opponent-player' || frame.audience === 'spectator' || frame.audience === 'replay') {
      return { kind: 'waiting', mode };
    }
    if (this.ending) return { kind: 'ending', mode };
    if (frame.audience === 'headless') {
      return { kind: 'select', mode, eligiblePlayerIds: [], canDecline: true, round: this.round };
    }
    if (this.pendingAction) {
      if (frame.modelRevision > this.pendingAction.afterRevision) this.pendingAction = null;
      else return { kind: 'awaiting-action-echo', mode, playerId: this.pendingAction.playerId, action: this.pendingAction.action };
    }
    if (frame.actingPlayerId) {
      if (this.priorActingPlayerId !== frame.actingPlayerId) this.endMoverSentFor = null;
      this.priorActingPlayerId = frame.actingPlayerId;
      this.awaitingPlayerId = null;
      this.awaitingPlayerAtRevision = -1;
      if (this.endMoverSentFor === frame.actingPlayerId) {
        return { kind: 'awaiting-end-mover', mode, playerId: frame.actingPlayerId };
      }
      return { kind: 'moving', mode, playerId: frame.actingPlayerId, actions: upstreamOnTheBallActions(frame, mode) };
    }
    if (this.priorActingPlayerId !== null) {
      this.round += 1;
      this.priorActingPlayerId = null;
      this.awaitingPlayerId = null;
    }
    if (this.awaitingPlayerId) {
      if (frame.modelRevision > this.awaitingPlayerAtRevision) {
        this.awaitingPlayerId = null;
        this.awaitingPlayerAtRevision = -1;
      } else {
        return { kind: 'awaiting-acting-player', mode, playerId: this.awaitingPlayerId };
      }
    }
    return { kind: 'select', mode, eligiblePlayerIds: [...frame.eligiblePlayerIds], canDecline: true, round: this.round };
  }

  choose(frame: OnTheBallFrame, playerId: string): OnTheBallCommand | null {
    const projection = this.sync(frame);
    if (projection.kind !== 'select' || frame.audience !== 'owner-player') return null;
    if (!projection.eligiblePlayerIds.includes(playerId)) return null;
    const command = { netCommandId: NetCommandId.CLIENT_ACTING_PLAYER, playerId, playerAction: 'move', leaping: false } as const;
    if (!this.send(command)) return null;
    this.awaitingPlayerId = playerId;
    this.awaitingPlayerAtRevision = frame.modelRevision;
    this.awaitingPlayerSentAt = this.now();
    return command;
  }

  /**
   * One server-offered On-the-Ball step on the normal move wire. Both positive entries are source-closed:
   * PassBlockLogicModule.java:43-48 and KickoffReturnLogicModule.java:39-44 accept only a live MoveSquare and call
   * MoveLogicModule.movePlayer; MoveLogicModule.java:241-245,278-285 sends that single coordinate as CLIENT_MOVE.
   */
  step(frame: OnTheBallFrame, toSquare: [number, number]): OnTheBallCommand | null {
    const projection = this.sync(frame);
    if (projection.kind !== 'moving' || frame.audience !== 'owner-player'
      || frame.actingPlayerAction !== 'move' || !frame.actingPlayerCoordinate) return null;
    if (!frame.moveSquares.some((square) => square[0] === toSquare[0] && square[1] === toSquare[1])) return null;
    const command: OnTheBallCommand = {
      netCommandId: NetCommandId.CLIENT_MOVE,
      actingPlayerId: projection.playerId,
      coordinateFrom: frame.actingPlayerCoordinate,
      coordinatesTo: [[toSquare[0], toSquare[1]]],
    };
    return this.send(command) ? command : null;
  }

  endPhase(frame: OnTheBallFrame): OnTheBallCommand | null {
    const projection = this.sync(frame);
    if ((projection.kind !== 'select' && projection.kind !== 'moving')
      || (frame.audience !== 'owner-player' && frame.audience !== 'headless')) return null;
    if (projection.kind === 'moving' && !frame.canEndPhase) return null;
    const command = { netCommandId: NetCommandId.CLIENT_END_TURN, turnMode: projection.mode, playersAtCoordinates: {} } as const;
    if (!this.send(command)) return null;
    this.ending = true;
    this.endingAt = this.now();
    return command;
  }

  endMover(frame: OnTheBallFrame): OnTheBallCommand | null {
    const projection = this.sync(frame);
    if (projection.kind !== 'moving' || frame.audience !== 'owner-player' || !frame.endMoveAvailable) return null;
    if (this.endMoverSentFor === projection.playerId) return null;
    const command = { netCommandId: NetCommandId.CLIENT_ACTING_PLAYER, playerId: null, playerAction: null, leaping: false } as const;
    if (!this.send(command)) return null;
    this.endMoverSentFor = projection.playerId;
    this.endMoverSentAt = this.now();
    return command;
  }

  toggleJump(frame: OnTheBallFrame): OnTheBallCommand | null {
    const projection = this.sync(frame);
    if (projection.kind !== 'moving' || !isPassBlockMode(projection.mode)
      || frame.audience !== 'owner-player' || !frame.jumpAvailable
      || frame.actingPlayerAction !== 'move') return null;
    const command = {
      netCommandId: NetCommandId.CLIENT_ACTING_PLAYER,
      playerId: projection.playerId,
      playerAction: 'move',
      leaping: !frame.actingPlayerLeaping,
    } as const;
    if (!this.send(command)) return null;
    this.pendingAction = { playerId: projection.playerId, action: 'jump', afterRevision: frame.modelRevision };
    return command;
  }

  useBoundingLeap(frame: OnTheBallFrame): OnTheBallCommand | null {
    const projection = this.sync(frame);
    if (projection.kind !== 'moving' || !isPassBlockMode(projection.mode)
      || frame.audience !== 'owner-player' || !frame.jumpAvailable
      || frame.actingPlayerLeaping || !frame.boundingLeapSkill) return null;
    const command = {
      netCommandId: NetCommandId.CLIENT_USE_SKILL,
      skill: frame.boundingLeapSkill,
      skillUsed: true,
      playerId: projection.playerId,
    } as const;
    if (!this.send(command)) return null;
    this.pendingAction = { playerId: projection.playerId, action: 'boundingLeap', afterRevision: frame.modelRevision };
    return command;
  }
}
