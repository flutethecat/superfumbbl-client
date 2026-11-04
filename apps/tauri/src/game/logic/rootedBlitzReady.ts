// Owner 11-03 (Take Root on a Blitz): pure decisions for a ROOTED Blitz actor in the Modern view.
//
// A failed Take Root is rolled on the Blitz target selection (bb2025 ActivationSequenceBuilder:94), before any step.
// bb2025 StepTakeRoot.cancelPlayerAction sets the rooted bit (PlayerState 0x400; with Chomped 0x40000 the pair is
// upstream PlayerState.isPinned), goingForIt and the Blitz used; the server publishes NO move square and StepMove refuses
// a pinned player. The Blitz stays open: ServerUtilBlock:34-49 decorates the adjacent blockable players and
// BlockLogicExtension.playerInteraction:188-196 lets the block through with no move left when the player cannot move.
//
//  - Beside the declared target: the view READIES the block (the ordinary Blitz confirm stage on that target) so ONE
//    click sends it through the existing path. Nothing is sent on the coach's behalf. A right-click disarms it and
//    sends nothing; the activation stays as it was.
//  - Not beside it: no planner, no reach. The coach ends with the acting-player right-click (End Activation). The
//    server then raises its own confirmEndAction (bb2025 StepInitSelecting:150-161), which is shown, never answered.
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import type { ClientStateId } from './clientStateMachine';
import { adjacentStandingEnemyIds, playerPinned } from './availableActions';
import { actingHasBlocked, blitzTargetOutcome } from './order66Interaction';

function actingId(game: GameJson): string {
  return String((game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
}

/** The rooted blitzer's declared target while its block is READY to be made from where it stands: our BLITZ state, the
 *  acting blitzer pinned and not yet blocked, the server's SELECTED target an adjacent standing opponent. Else null. */
export function rootedBlitzReadyTargetId(game: GameJson | null | undefined, clientState: ClientStateId | '' | null | undefined): string | null {
  if (!game || clientState !== 'BLITZ') return null;
  const acting = actingId(game);
  if (!acting || !playerPinned(game, acting) || actingHasBlocked(game)) return null;
  const outcome = blitzTargetOutcome(game);
  if (outcome.kind !== 'selected') return null;
  return adjacentStandingEnemyIds(game, acting).includes(outcome.targetId) ? outcome.targetId : null;
}

/** One readiness per activation and target: game, half, side, turn, blitzer, target. */
export function rootedBlitzReadyKey(game: GameJson, targetId: string): string {
  const turnData = game.homePlaying ? game.turnDataHome : game.turnDataAway;
  return [game.gameId ?? '', game.half ?? '', game.homePlaying ? 'home' : 'away',
    (turnData as { turnNr?: unknown } | undefined)?.turnNr ?? '', actingId(game), targetId].join(':');
}

export interface RootedBlitzArmInput {
  game: GameJson | null | undefined;
  clientState: ClientStateId | '' | null | undefined;
  /** Our seat is playing, it is our turn, the acting blitzer is ours. */
  controlsActing: boolean;
  /** A store plan is running (it owns the act). */
  planActive: boolean;
  /** A Blitz / Block confirm stage is already up (the coach's own, or this readiness). */
  stageArmed: boolean;
  /** Keys this view already readied, or the coach disarmed with a right-click: never re-armed. */
  handledKeys: ReadonlySet<string>;
}

/** Arm the readied block now? Returns the target and its key, or null. Arming is local: it sends nothing. */
export function rootedBlitzReadyArm(input: RootedBlitzArmInput): { targetId: string; key: string } | null {
  if (!input.game || !input.controlsActing || input.planActive || input.stageArmed) return null;
  const targetId = rootedBlitzReadyTargetId(input.game, input.clientState);
  if (!targetId) return null;
  const key = rootedBlitzReadyKey(input.game, targetId);
  return input.handledKeys.has(key) ? null : { targetId, key };
}

/** The confirm stage on screen IS this activation's readied block (so a right-click disarms it). */
export function rootedBlitzReadyStageLive(
  game: GameJson | null | undefined,
  clientState: ClientStateId | '' | null | undefined,
  stage: { kind: 'block' | 'blitz'; target: string; stage: 1 | 2 } | null | undefined,
  armedKey: string | null,
): boolean {
  if (!game || !stage || stage.kind !== 'blitz' || stage.stage !== 2 || !armedKey) return false;
  const targetId = rootedBlitzReadyTargetId(game, clientState);
  return !!targetId && targetId === stage.target && rootedBlitzReadyKey(game, targetId) === armedKey;
}

/** Ending this Blitz is confirmed by the SERVER: upstream bb2025 StepInitSelecting:150-161 raises confirmEndAction for
 *  an acting-null when the blitz is unused (no block), no square was moved (currentMove 0) and the target selection is
 *  committed - always so for a pinned blitzer that has not blocked. The client then raises no card of its own (one
 *  confirmation, the server's, shown and never answered for the coach). */
export function rootedBlitzEndServerConfirmed(game: GameJson | null | undefined): boolean {
  if (!game) return false;
  const acting = actingId(game);
  const ap = game.actingPlayer as { playerAction?: string | null; currentMove?: number } | undefined;
  if (!acting || !playerPinned(game, acting) || actingHasBlocked(game)) return false;
  if (!/blitz/i.test(String(ap?.playerAction ?? '')) || Number(ap?.currentMove ?? 0) !== 0) return false;
  const tss = (game.fieldModel as { targetSelectionState?: { targetSelectionStatusIsCommitted?: unknown } | null } | undefined)?.targetSelectionState;
  return !!tss && tss.targetSelectionStatusIsCommitted === true;
}

/** Sol r1 (P2): what becomes of the readiness stage this view armed (`armed`) on each reconciliation.
 *  - 'keep': it is still this activation's readied block.
 *  - 'retire': the stage on screen is still the armed one, but the live readiness no longer carries that key (the
 *    actor, target, activation, seat or snapshot changed - a reconnect can replace one BLITZ activation with another):
 *    the view clears the stage it owns before anything is armed again.
 *  - 'drop': the stage on screen is not the armed one any more (the coach cleared or replaced it): the view forgets the
 *    ownership and leaves the stage alone. */
export function rootedBlitzReadyReconcile(
  game: GameJson | null | undefined,
  clientState: ClientStateId | '' | null | undefined,
  armed: { key: string; targetId: string },
  stage: { kind: 'block' | 'blitz'; target: string; stage: 1 | 2 } | null | undefined,
  seatLive: boolean,
): 'keep' | 'retire' | 'drop' {
  if (!stage || stage.kind !== 'blitz' || stage.stage !== 2 || stage.target !== armed.targetId) return 'drop';
  if (!seatLive || !game) return 'retire';
  return rootedBlitzReadyStageLive(game, clientState, stage, armed.key) ? 'keep' : 'retire';
}
