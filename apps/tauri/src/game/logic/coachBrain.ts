import type { FieldCoordinateJson, GameJson } from '@fumbbl40k/ffb-protocol';
import {
  RandomLegalCoach, type CoachIntent,
  type CoachObservation as BrainObservation, type MoveSquareFact,
} from './coachContract';
// Owner 09-12: the fly runtime (packages/fly-coach) is fork-only and ABSENT from the public export; the glob
// tolerates the missing package, so the public build carries no fly code and 'fly-chaos' resolves to no brain.
interface FlyDecisionLike { verdict: string; counts: Record<string, number>; wall_ms: number }
type FlyModule = { FlyChaosCoach: new (url: string, seed: number, options: { onDecision?: (d: FlyDecisionLike | null) => void }) => CoachBrain };
const flyModules = import.meta.glob<FlyModule>('../../../../../packages/fly-coach/src/flyChaosCoach.ts');
const FLY_MODULE = '../../../../../packages/fly-coach/src/flyChaosCoach.ts';
import {
  adjacentBlockableEnemyIds, availableActions, normSquare,
  type CoachAction,
} from './availableActions';
import { deriveClientState, type ClientStateContext, type ClientStateId } from './clientStateMachine';
import { settings, type AppSettings } from '../settings';

export type { CoachIntent, MoveSquareFact };
export interface CoachObservation extends BrainObservation {
  readonly state: ClientStateId;
  readonly actions: readonly CoachAction[];
  readonly selectablePlayerIds: readonly string[];
  readonly blockDefenderIds: readonly string[];
}
export interface CoachBrain {
  readonly id: string;
  decide(obs: CoachObservation, signal: AbortSignal): Promise<CoachIntent>;
}

export async function createCoachBrain(config: Pick<AppSettings, 'coachBrain' | 'flyBrainUrl'>,
  seed: number, report: (message: string) => void): Promise<CoachBrain | null> {
  if (config.coachBrain === 'random') return new RandomLegalCoach(String(seed));
  if (config.coachBrain !== 'fly-chaos') return null;
  // Single-file glob: take whatever key Vite/vitest produced (relative in dev, /@fs or absolute elsewhere).
  const load = flyModules[FLY_MODULE] ?? Object.values(flyModules)[0];
  if (!load) { report('Coach brain: the fly runtime is not part of this build'); return null; }
  const { FlyChaosCoach } = await load();
  return new FlyChaosCoach(config.flyBrainUrl, seed, {
    onDecision: (decision) => report(`fly: ${JSON.stringify(decision
      ? { verdict: decision.verdict, counts: decision.counts, wall_ms: decision.wall_ms }
      : { verdict: null, counts: null, fallback: 'pass' })}`),
  });
}

/** Check the connected URL, never the selected preset or an editable URL alone. */
export function coachHostAllowed(url: string, forkServerHost: string, forkHost = ''): boolean {
  const normalize = (host: string) => host.toLowerCase().replace(/\.+$/, '');
  try {
    const target = new URL(url);
    if (!['ws:', 'wss:'].includes(target.protocol) || target.username || target.password) return false;
    const host = normalize(target.hostname);
    if (host === 'fumbbl.com' || host.endsWith('.fumbbl.com')) return false;
    return ['localhost', '127.0.0.1', '[::1]', normalize(forkServerHost.trim()), normalize(forkHost.trim())]
      .filter(Boolean).includes(host);
  } catch { return false; }
}

const STATES = new Set<ClientStateId>(['SELECT_PLAYER', 'MOVE', 'BLITZ', 'BLOCK', 'FOUL', 'PASS', 'HAND_OVER']);
// Blitz and special declares enter target/skill states outside the M0 driver.
const DECLARES = new Set(['move', 'block', 'foulMove', 'passMove', 'handOverMove']);
const WALK_STATES = new Set<ClientStateId>(['MOVE', 'FOUL', 'PASS', 'HAND_OVER']);
const same = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1];
const onPitch = (c: FieldCoordinateJson) => Number.isInteger(c[0]) && Number.isInteger(c[1])
  && c[0] >= 0 && c[0] < 26 && c[1] >= 0 && c[1] < 15;

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export interface CoachFrame {
  game: GameJson;
  context: ClientStateContext;
  /** Includes edition, connected host, headless seat, transport and playback gates. */
  enabled: boolean;
  sessionKey: object;
  revision: number;
  turnClockMs: number;
  moveOffered?: (playerId: string, square: FieldCoordinateJson) => boolean;
}

export function coachTurnKey(g: Readonly<GameJson>): string {
  // Choice ownership may flip homePlaying inside a turn (uphill block, for example).
  return [g.gameId, g.half, g.turnDataHome?.turnNr, g.turnDataAway?.turnNr].join(':');
}

export function coachTurnClockMs(g: GameJson, elapsedMs: number): number {
  const options = (g.options as GameJson['gameOptions'] | undefined) ?? g.gameOptions;
  const seconds = Number(options?.gameOptionArray?.find((o) => o.gameOptionId === 'turntime')?.gameOptionValue);
  return Math.max(0, (Number.isFinite(seconds) && seconds > 0 ? seconds : 240) * 1000 - elapsedMs);
}

function availableActionsFor(obs: CoachObservation, playerId: string): readonly CoachAction[] {
  const ctx = (obs as CoachObservation & { context?: ClientStateContext }).context;
  return ctx ? availableActions(obs.game as GameJson, ctx, playerId) : [];
}

export function observeCoach(frame: CoachFrame, intentsThisTurn = 0): CoachObservation | null {
  const { game: g, context } = frame;
  const state = deriveClientState(g, context);
  // Pregame owns the kickoff blitz mini-turn even though it derives regular action states.
  if (!frame.enabled || g.turnMode !== 'regular' || !STATES.has(state) || g.dialogParameter) return null;
  const selectedPlayerId = g.actingPlayer?.playerId || null;
  const actions = selectedPlayerId ? availableActions(g, context, selectedPlayerId) : [];
  const team = context.myIsHome === false ? g.teamAway : g.teamHome;
  const selectablePlayerIds = state === 'SELECT_PLAYER' ? (team?.playerArray ?? [])
    .filter((p) => availableActions(g, context, p.playerId).some(
      (a) => a.enabled && a.kind === 'declare' && a.action === 'move' && !a.blockKind,
    )).map((p) => p.playerId) : [];
  const legalSquares: MoveSquareFact[] = [];
  for (const raw of g.fieldModel.moveSquareArray ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const coordinate = normSquare((raw as { coordinate?: unknown }).coordinate);
    if (coordinate && onPitch(coordinate)) legalSquares.push({ ...raw, coordinate });
  }
  const blockEnabled = actions.some((a) => a.enabled && a.kind === 'declare' && a.action === 'block' && !a.blockKind);
  const blockDefenderIds = selectedPlayerId && blockEnabled
    ? adjacentBlockableEnemyIds(g, selectedPlayerId) : [];
  const legalIntents: CoachIntent[] = selectablePlayerIds.map((playerId) => ({ kind: 'select', playerId }));
  // Live drive 09-12 (game 950): `select` always declares MOVE, after which Block is no longer offered, so the fly
  // never blocked. Offer a Block declaration AT selection for every player who has an adjacent blockable enemy.
  if (state === 'SELECT_PLAYER') {
    for (const p of team?.playerArray ?? []) {
      const canBlock = availableActions(g, context, p.playerId).some(
        (a) => a.enabled && a.kind === 'declare' && a.action === 'block' && !a.blockKind,
      );
      if (canBlock && adjacentBlockableEnemyIds(g, p.playerId).length) legalIntents.push({ kind: 'declare', action: 'block', playerId: p.playerId });
    }
  }
  if (selectedPlayerId) {
    for (const a of actions) {
      if (a.enabled && a.kind === 'declare' && DECLARES.has(a.action) && !a.blockKind) {
        legalIntents.push({ kind: 'declare', action: a.action });
      }
    }
    const origin = g.fieldModel.playerDataArray.find((p) => p.playerId === selectedPlayerId)?.playerCoordinate;
    if (WALK_STATES.has(state) && origin) {
      for (const { coordinate } of legalSquares) {
        if (Math.max(Math.abs(origin[0] - coordinate[0]), Math.abs(origin[1] - coordinate[1])) === 1
            && (!frame.moveOffered || frame.moveOffered(selectedPlayerId, coordinate))) {
          legalIntents.push({ kind: 'move', path: [coordinate] });
        }
      }
    }
    legalIntents.push(...blockDefenderIds.map((defenderId): CoachIntent => ({ kind: 'block', defenderId })));
    if (actions.some((a) => a.enabled && a.kind === 'endMove')) legalIntents.push({ kind: 'endMove' });
  }
  legalIntents.push({ kind: 'endTurn' });
  // A detached, deeply frozen snapshot prevents a brain from mutating the store or its capabilities.
  return freeze(JSON.parse(JSON.stringify({
    game: g, context, mySide: context.myIsHome === false ? 'away' : 'home', state, selectedPlayerId, actions, legalSquares, turnClockMs: frame.turnClockMs,
    intentsThisTurn, legalIntents, selectablePlayerIds, blockDefenderIds,
  })) as CoachObservation);
}

/** Invalid suggestions become End Move only when that capability exists; otherwise consume a no-op. */
export function translateCoachIntent(obs: CoachObservation, suggestion: unknown): CoachIntent | null {
  const fallback = (): CoachIntent | null => obs.legalIntents.some((i) => i.kind === 'endMove')
    && obs.actions.some((a) => a.kind === 'endMove' && a.enabled) ? { kind: 'endMove' } : null;
  if (!suggestion || typeof suggestion !== 'object') return fallback();
  const intent = suggestion as Record<string, unknown>;
  const offered = obs.legalIntents.find((i) => {
    if (i.kind !== intent.kind) return false;
    switch (i.kind) {
      case 'select': return i.playerId === intent.playerId && obs.state === 'SELECT_PLAYER'
        && obs.selectablePlayerIds.includes(i.playerId);
      case 'declare': return i.action === intent.action && i.blockKind === intent.blockKind && i.playerId === intent.playerId
        && (i.playerId
          ? obs.state === 'SELECT_PLAYER' && availableActionsFor(obs, i.playerId).some((a) => a.enabled && a.kind === 'declare' && a.action === i.action && !a.blockKind)
          : obs.actions.some((a) => a.enabled && a.kind === 'declare'
            && a.action === i.action && a.blockKind === i.blockKind));
      case 'block': return i.defenderId === intent.defenderId && obs.blockDefenderIds.includes(i.defenderId)
        && obs.actions.some((a) => a.enabled && a.action === 'block' && a.kind === 'declare' && !a.blockKind)
        && !!obs.selectedPlayerId
        && adjacentBlockableEnemyIds(obs.game as GameJson, obs.selectedPlayerId).includes(i.defenderId);
      case 'move': return Array.isArray(intent.path) && intent.path.length === i.path.length
        && i.path.every((square, n) => Array.isArray(intent.path) && Array.isArray(intent.path[n])
          && intent.path[n].length === 2 && same(square, intent.path[n])
          && obs.legalSquares.some((fact) => same(square, fact.coordinate)));
      case 'endMove': return obs.actions.some((a) => a.enabled && a.kind === 'endMove');
      case 'endTurn': return true;
      case 'pass': return false;
    }
  });
  // Return the trusted menu entry, never payload fields supplied by a brain.
  return offered ?? fallback();
}

function echoed(before: CoachObservation, intent: CoachIntent, after: GameJson): boolean {
  if (coachTurnKey(before.game) !== coachTurnKey(after) || after.turnMode !== 'regular' || after.finished) return true;
  const actor = after.actingPlayer;
  const newDialog = !!after.dialogParameter && JSON.stringify(after.dialogParameter) !== JSON.stringify(before.game.dialogParameter);
  const playerChanged = (id: string | null) => !!id
    && before.game.fieldModel.playerDataArray.find((p) => p.playerId === id)?.playerState
      !== after.fieldModel.playerDataArray.find((p) => p.playerId === id)?.playerState;
  switch (intent.kind) {
    case 'select': return (actor?.playerId === intent.playerId && actor.playerAction === 'move')
      || (!actor?.playerId && playerChanged(intent.playerId));
    case 'declare': {
      const who = intent.playerId ?? before.selectedPlayerId;
      return (actor?.playerId === who && actor.playerAction === intent.action)
        || (!actor?.playerId && playerChanged(who));
    }
    case 'endMove': return actor?.playerId !== before.selectedPlayerId;
    case 'move': {
      const coordinate = after.fieldModel.playerDataArray.find((p) => p.playerId === before.selectedPlayerId)?.playerCoordinate;
      return actor?.playerId !== before.selectedPlayerId || (!!coordinate && same(coordinate, intent.path[intent.path.length - 1]!))
        || Number(actor?.currentMove ?? 0) > Number(before.game.actingPlayer?.currentMove ?? 0)
        || newDialog;
    }
    case 'block': return newDialog || actor?.playerId !== before.selectedPlayerId
      || after.fieldModel.playerDataArray.find((p) => p.playerId === intent.defenderId)?.playerState
        !== before.game.fieldModel.playerDataArray.find((p) => p.playerId === intent.defenderId)?.playerState;
    case 'endTurn': return before.game.homePlaying !== after.homePlaying;
    case 'pass': return true;
  }
}

export interface CoachDriverPorts {
  read(): CoachFrame | null;
  send(intent: CoachIntent, observation: CoachObservation): boolean | void;
  report(message: string): void;
  brain?: CoachBrain;
}

/** One decision or echo wait at a time. Timers wake checks, never authorize duplicate sends. */
export function createCoachDriver(ports: CoachDriverPorts) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deciding: { controller: AbortController; frame: CoachFrame } | null = null;
  type Pending = {
    observation: CoachObservation; intent: CoachIntent; revision: number; sentAt: number; warned: boolean;
    block?: Extract<CoachIntent, { kind: 'block' }>;
  };
  let pending: Pending | null = null;
  let turnKey = '';
  let brainKey = '';
  let sessionKey: object | null = null;
  let count = 0;
  let stopped = false;
  let brain: CoachBrain | null = ports.brain ?? null;
  let fallback = new RandomLegalCoach();
  const configurationKey = (frame: CoachFrame) => JSON.stringify([
    frame.game.gameId, ...(ports.brain ? [] : [settings.coachBrain, settings.flyBrainUrl]),
  ]);

  function schedule() {
    if (!stopped && !timer) timer = setTimeout(() => { timer = undefined; wake(); }, 25);
  }

  async function step(frame: CoachFrame, obs: CoachObservation) {
    const activeBrain = brain;
    if (!activeBrain) return;
    const activeKey = brainKey;
    const controller = new AbortController();
    deciding = { controller, frame };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    try {
      const cancelled = new Promise<CoachIntent>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve({ kind: 'pass' }), { once: true });
        timeout = setTimeout(() => { expired = true; controller.abort(); }, 2000);
      });
      const suggestion = count >= 40 ? { kind: 'endTurn' } : await Promise.race([
        Promise.resolve().then(() => activeBrain.decide(obs, controller.signal)).catch(() => ({ kind: 'pass' })), cancelled,
      ]);
      const decision = expired && activeBrain.id !== 'fly-chaos'
        ? await fallback.decide(obs, new AbortController().signal) : suggestion;
      const live = ports.read();
      if (stopped || !live || live.sessionKey !== frame.sessionKey || live.revision !== frame.revision
          || configurationKey(live) !== activeKey
          || coachTurnKey(live.game) !== coachTurnKey(obs.game) || (controller.signal.aborted && !expired)) return;
      const fresh = observeCoach(live, count);
      if (!fresh) return;
      count += 1;
      const intent = translateCoachIntent(fresh, decision);
      if (intent) {
        // Plain Block is declare -> echo -> target. The legacy composite sender has a blind timeout fallback.
        const commandIntent: CoachIntent = intent.kind === 'block' ? { kind: 'declare', action: 'block' } : intent;
        pending = { observation: fresh, intent: commandIntent, revision: frame.revision, sentAt: Date.now(), warned: false,
          block: intent.kind === 'block' ? intent : undefined };
        if (ports.send(commandIntent, fresh) === false) {
          ports.report('Coach brain paused: sender declined the capability. No command was retried.');
          pending.warned = true;
        }
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      deciding = null;
      schedule();
    }
  }

  function wake() {
    if (stopped) return;
    const frame = ports.read();
    if (deciding) {
      if (!frame || !frame.enabled || frame.sessionKey !== deciding.frame.sessionKey
          || frame.revision !== deciding.frame.revision || configurationKey(frame) !== brainKey) deciding.controller.abort();
      return;
    }
    if (!frame) return;
    const nextTurn = coachTurnKey(frame.game);
    if (sessionKey !== frame.sessionKey) {
      sessionKey = frame.sessionKey;
      pending = null;
      brainKey = '';
    }
    if (nextTurn !== turnKey) { turnKey = nextTurn; count = 0; pending = null; }
    const nextBrain = configurationKey(frame);
    if (nextBrain !== brainKey) {
      brainKey = nextBrain;
      brain = ports.brain ?? null;
      if (!ports.brain) {
        const key = nextBrain;
        void createCoachBrain(settings, frame.game.gameId, ports.report).then((created) => {
          if (brainKey === key && !stopped) { brain = created; schedule(); }
        });
      }
      fallback = new RandomLegalCoach(`${frame.game.gameId}:fallback`);
    }
    if (pending) {
      if (frame.revision !== pending.revision && echoed(pending.observation, pending.intent, frame.game)) {
        const accepted = pending;
        const ready = observeCoach(frame, count);
        if (accepted.block && !ready) return; // Let existing dialog handlers finish the declaration.
        pending = null;
        if (accepted.block && ready?.state === 'BLOCK'
            && ready.selectedPlayerId === accepted.observation.selectedPlayerId
            && ready.selectedPlayerId
            && adjacentBlockableEnemyIds(frame.game, ready.selectedPlayerId).includes(accepted.block.defenderId)) {
          // Retain the offered Block row across its own echo; availableActions omits the current declaration.
          pending = { observation: ready, intent: accepted.block, revision: frame.revision, sentAt: Date.now(), warned: false };
          if (ports.send(accepted.block, accepted.observation) === false) {
            pending.warned = true;
            ports.report('Coach brain paused: block sender declined the capability. No command was retried.');
          }
          schedule();
          return;
        }
      } else {
        if (!pending.warned && Date.now() - pending.sentAt >= 4000) {
          pending.warned = true;
          ports.report('Coach brain paused: command echo timed out. No command was resent.');
        }
        if (frame.enabled && !pending.warned) schedule();
        return;
      }
    }
    const obs = observeCoach(frame, count);
    if (obs) void step({ ...frame }, obs).catch((error: unknown) => ports.report(`Coach brain failed: ${String(error)}`));
  }

  return {
    wake,
    dispose() { stopped = true; if (timer) clearTimeout(timer); deciding?.controller.abort(); },
  };
}
