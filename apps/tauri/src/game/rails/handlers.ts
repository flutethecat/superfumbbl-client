import type {
  DecisionContext,
  PresentationEnvelope,
  RailFrame,
  RailHandler,
  RailId,
} from './contracts';
import { RAIL_MANIFEST } from './manifest';
import {
  MOVE_RAIL_HANDLER,
  type MoveRailFrame,
  type MoveTransaction,
} from './moveRail';

export type ShadowEvent =
  | { kind: 'dialog'; rail: RailId; key: string; resolution: string }
  | { kind: 'action-state'; rail: RailId; key: string; state: string }
  | {
    kind: 'outgoing';
    rail: RailId;
    key: string;
    command: Readonly<Record<string, unknown>>;
    ownerTeamId: string | null;
  };

export interface ShadowRailFrame extends RailFrame<unknown, Record<string, unknown>, Record<string, unknown>> {
  event: Readonly<ShadowEvent>;
}

export interface ShadowRailState {
  event: Readonly<ShadowEvent> | null;
}

export interface ShadowDecision {
  command: Readonly<Record<string, unknown>>;
}

export interface ShadowPresentation {
  kind: ShadowEvent['kind'];
  value: string;
}

export type ShadowRailHandler = RailHandler<
  ShadowRailState,
  ShadowRailFrame,
  ShadowDecision,
  ShadowPresentation,
  Record<string, unknown>
>;

const INITIAL: ShadowRailState = Object.freeze({ event: null });

function createShadowHandler(id: RailId): ShadowRailHandler {
  return {
    id,
    initial: INITIAL,
    reduce(_previous, frame) {
      return { event: frame.event.rail === id ? frame.event : null };
    },
    deriveDecision(state, _frame, context) {
      if (context.audience !== 'player' || !context.maySend || id === 'unknown') return null;
      const event = state.event;
      if (event?.kind !== 'outgoing') return null;
      if (event.ownerTeamId != null && event.ownerTeamId !== context.myTeamId) return null;
      return { command: event.command };
    },
    present(state): readonly PresentationEnvelope<ShadowPresentation>[] {
      const event = state.event;
      if (!event) return [];
      const value = event.kind === 'dialog' ? event.resolution
        : event.kind === 'action-state' ? event.state
          : String(event.command.netCommandId ?? '');
      return [{ key: event.key, rail: id, value: { kind: event.kind, value } }];
    },
    command(decision) {
      return { ...decision.command };
    },
  };
}

// The Move entry is no longer the generic observe-only copier. This adapter keeps the mixed
// registry's small erased surface while the real handler owns server-fact reduction, refusal,
// presentation, and exact wire construction in moveRail.ts.
const MOVE_SHADOW_HANDLER: ShadowRailHandler = {
  id: 'move',
  initial: MOVE_RAIL_HANDLER.initial,
  ownedCommandIds: MOVE_RAIL_HANDLER.ownedCommandIds,
  observedCommandIds: MOVE_RAIL_HANDLER.observedCommandIds,
  reduce(previous, frame) {
    return MOVE_RAIL_HANDLER.reduce(
      previous as MoveTransaction,
      frame as MoveRailFrame,
    );
  },
  deriveDecision(state, frame, context) {
    const decision = MOVE_RAIL_HANDLER.deriveDecision(
      state as MoveTransaction,
      frame as MoveRailFrame,
      context,
    );
    return decision ? { command: MOVE_RAIL_HANDLER.command(decision) } : null;
  },
  present(state) {
    return MOVE_RAIL_HANDLER.present(state as MoveTransaction).map((entry) => ({
      key: entry.key,
      rail: entry.rail,
      value: { kind: 'outgoing', value: entry.value.status },
    }));
  },
  command(decision) {
    return { ...decision.command };
  },
};

export const RAIL_HANDLERS: ReadonlyMap<RailId, ShadowRailHandler> = new Map(
  RAIL_MANIFEST.map((entry) => [
    entry.id,
    entry.id === 'move' ? MOVE_SHADOW_HANDLER : createShadowHandler(entry.id),
  ]),
);

export function findShadowHandler(rail: RailId): ShadowRailHandler | undefined {
  return RAIL_HANDLERS.get(rail);
}

export function shadowHandler(rail: RailId): ShadowRailHandler {
  const handler = findShadowHandler(rail);
  if (!handler) throw new Error(`missing shadow handler for rail ${rail}`);
  return handler;
}

export function runShadowHandler(
  handler: ShadowRailHandler,
  frame: Readonly<ShadowRailFrame>,
  context: Readonly<DecisionContext>,
): { state: ShadowRailState; decision: ShadowDecision | null } {
  const state = handler.reduce(handler.initial, frame);
  return { state, decision: handler.deriveDecision(state, frame, context) };
}
