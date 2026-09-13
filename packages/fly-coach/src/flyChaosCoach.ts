import type { FieldCoordinateJson } from '@fumbbl40k/ffb-protocol';
import type { CoachBrain, CoachIntent, CoachObservation } from './index';
import { DEFAULT_FLY_BRAIN_URL, SidecarClient, type FlyDecision, type FlyRequest, type SidecarOptions } from './sidecarClient';

export interface FlyChaosOptions extends SidecarOptions {
  onDecision?: (decision: FlyDecision | null) => void;
}
const distance = (a: readonly number[], b: readonly number[]) => (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2;
const onPitch = (c: FieldCoordinateJson | null | undefined): c is FieldCoordinateJson => !!c
  && Number.isInteger(c[0]) && Number.isInteger(c[1]) && c[0] >= 0 && c[0] < 26 && c[1] >= 0 && c[1] < 15;
function best<T>(items: readonly T[], score: (item: T) => number): T | undefined {
  return items.reduce<T | undefined>((chosen, item) => chosen === undefined || score(item) < score(chosen) ? item : chosen, undefined);
}

export class FlyChaosCoach implements CoachBrain {
  readonly id = 'fly-chaos';
  private readonly client: SidecarClient;
  private readonly seed: number;
  private gameKey: string | null = null;
  private turnKey: string | null = null;
  private grooms = 0;
  private lastGroomIndex = -1;
  private positions = new Map<string, { at: FieldCoordinateJson; direction: FieldCoordinateJson | null }>();

  constructor(url = DEFAULT_FLY_BRAIN_URL, seed: number | string = 1, private readonly options: FlyChaosOptions = {}) {
    this.client = new SidecarClient(url, options);
    this.seed = typeof seed === 'number' ? seed >>> 0 : [...seed].reduce(
      (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261,
    );
  }

  async decide(obs: CoachObservation, signal: AbortSignal): Promise<CoachIntent> {
    // Pass is the M0 policy sentinel, never a command or a fabricated capability.
    const pass = (): CoachIntent => obs.legalIntents.find((i) => i.kind === 'pass') ?? { kind: 'pass' };
    if (signal.aborted) return pass();
    const endTurn = obs.legalIntents.find((i) => i.kind === 'endTurn');
    if (obs.intentsThisTurn >= 40) return endTurn ?? pass();
    let decision: FlyDecision | null = null;
    try {
      const body = this.encode(obs);
      if (this.gameKey !== body.gameKey) {
        await this.client.reset({ gameKey: body.gameKey, seed: this.seed }, signal);
        this.gameKey = body.gameKey;
        this.turnKey = null;
      }
      if (this.turnKey !== body.turnKey) {
        await this.client.reset({ gameKey: body.gameKey, seed: body.seed, turnKey: body.turnKey }, signal);
        this.turnKey = body.turnKey;
        this.grooms = 0;
        this.lastGroomIndex = -1;
        this.positions.clear();
      }
      decision = await this.client.decide(body, signal);
      if (signal.aborted) throw new Error('Decision aborted');
      if (obs.intentsThisTurn !== this.lastGroomIndex) {
        this.grooms = decision.verdict === 'groom' ? this.grooms + 1 : 0;
        this.lastGroomIndex = obs.intentsThisTurn;
      }
      return this.decode(obs, body, decision) ?? pass();
    } catch {
      // An interrupted step may have advanced the remote membrane state. Reset before retrying.
      this.turnKey = null;
      decision = null;
      return pass();
    } finally {
      this.options.onDecision?.(decision);
    }
  }

  private encode(obs: CoachObservation): FlyRequest {
    const g = obs.game, fm = g.fieldModel;
    const mySide = obs.mySide ?? (g.homePlaying ? 'home' : 'away');
    const mine = new Set((mySide === 'home' ? g.teamHome : g.teamAway)?.playerArray.map((p) => p.playerId));
    const theirs = new Set((mySide === 'home' ? g.teamAway : g.teamHome)?.playerArray.map((p) => p.playerId));
    const ball = fm.ballInPlay && onPitch(fm.ballCoordinate) ? fm.ballCoordinate : null;
    const players: FlyRequest['players'] = fm.playerDataArray.flatMap((p) => {
      const c = p.playerCoordinate;
      if (!onPitch(c) || (!mine.has(p.playerId) && !theirs.has(p.playerId))) return [];
      return [{ id: p.playerId, x: c[0], y: c[1], mine: mine.has(p.playerId),
        standing: (p.playerState & 0xff) === 1, selected: p.playerId === obs.selectedPlayerId,
        carrier: !!ball && !fm.ballMoving && distance(c, ball) === 0, active: !!(p.playerState & 0x100) }];
    });
    const turn = mySide === 'home' ? g.turnDataHome : g.turnDataAway;
    const score = (g.gameResult?.teamResultHome?.score ?? 0) - (g.gameResult?.teamResultAway?.score ?? 0);
    const turnIndex = Math.max(0, (g.half - 1) * 16) + (g.turnDataHome?.turnNr ?? 0) + (g.turnDataAway?.turnNr ?? 0);
    return {
      gameKey: String(g.gameId), turnKey: [g.gameId, g.half, g.turnDataHome?.turnNr, g.turnDataAway?.turnNr].join(':'),
      seed: (this.seed + turnIndex) >>> 0, mySide, state: obs.state, selectedPlayerId: obs.selectedPlayerId,
      players, ball: players.some((p) => p.carrier) ? null : ball,
      legalSquares: obs.legalSquares.map((s) => s.coordinate), scoreDiff: mySide === 'home' ? score : -score,
      rerolls: turn?.reRolls ?? 0, turnNr: turn?.turnNr ?? 0, half: g.half,
      onPitch: { mine: players.filter((p) => p.mine).length, theirs: players.filter((p) => !p.mine).length }, ms: 150,
    };
  }

  private decode(obs: CoachObservation, body: FlyRequest, decision: FlyDecision): CoachIntent | undefined {
    const menu = obs.legalIntents;
    const endTurn = menu.find((i) => i.kind === 'endTurn');
    const end = () => menu.find((i) => i.kind === 'endMove') ?? endTurn;
    const declare = (action: string) => menu.find((i) => i.kind === 'declare' && i.action === action && !i.blockKind);
    const at = (id: string) => obs.game.fieldModel.playerDataArray.find((p) => p.playerId === id)?.playerCoordinate;
    const nearFocus = (id: string) => {
      const c = at(id);
      return decision.focus ? onPitch(c) ? distance(c, decision.focus) : Infinity : 0;
    };
    if (obs.state === 'SELECT_PLAYER') {
      // Escape = violence: prefer declaring a Block at selection for the player nearest the fly's focus.
      const blockers = menu.filter((i): i is Extract<CoachIntent, { kind: 'declare' }> & { playerId: string } => i.kind === 'declare' && i.action === 'block' && !!i.playerId);
      if (decision.verdict === 'escape' && blockers.length) return best(blockers, (i) => nearFocus(i.playerId));
      return best(menu.filter((i) => i.kind === 'select'), (i) => nearFocus(i.playerId)) ?? endTurn;
    }
    // A declared Block with a target on offer is always thrown: cancelling it with endMove wastes the activation
    // (live game 951: 7 Block declarations, 0 blocks thrown before this rule).
    const blocks = menu.filter((i) => i.kind === 'block');
    if (obs.state === 'BLOCK' && blocks.length) return best(blocks, (i) => nearFocus(i.defenderId));
    if (decision.verdict === 'none') return menu.find((i) => i.kind === 'pass');
    if (decision.verdict === 'groom') return this.grooms >= 3 ? endTurn ?? end() : end();
    if (decision.verdict === 'escape') {
      return best(menu.filter((i) => i.kind === 'block'), (i) => nearFocus(i.defenderId))
        ?? declare('block') ?? declare('move') ?? end();
    }
    const moves = menu.filter((i) => i.kind === 'move');
    if (!moves.length) return declare('move') ?? end();
    const actor = body.players.find((p) => p.selected);
    const origin: FieldCoordinateJson | null = actor ? [actor.x, actor.y] : null;
    const ball = obs.game.fieldModel.ballCoordinate;
    // store.ts ballCarrierInScoringEndzone: home attacks x=25, away attacks x=0.
    const target = actor?.carrier ? [body.mySide === 'home' ? 25 : 0, actor.y]
      : obs.game.fieldModel.ballInPlay && onPitch(ball) ? ball : null;
    const destination = (i: Extract<CoachIntent, { kind: 'move' }>) => i.path[i.path.length - 1];
    const forwardScore = (i: Extract<CoachIntent, { kind: 'move' }>) => {
      const c = destination(i);
      return c && target ? distance(c, target) : 0;
    };
    const forward = () => best(moves, forwardScore);
    let direction: FieldCoordinateJson | null = origin && target ? [target[0]! - origin[0], target[1]! - origin[1]] : null;
    if (actor && origin) {
      const previous = this.positions.get(actor.id);
      if (previous) direction = distance(previous.at, origin) > 0
        ? [origin[0] - previous.at[0], origin[1] - previous.at[1]] : previous.direction ?? direction;
      this.positions.set(actor.id, { at: origin, direction });
    }
    if (decision.verdict === 'backward') {
      const opponents = body.players.filter((p) => !p.mine);
      return opponents.length ? best(moves, (i) => {
        const c = destination(i);
        return c ? -Math.min(...opponents.map((p) => distance(c, [p.x, p.y]))) : Infinity;
      }) : forward();
    }
    if ((decision.verdict === 'left' || decision.verdict === 'right') && origin && direction) {
      const preferred = moves.filter((i) => {
        const c = destination(i);
        if (!c) return false;
        const cross = direction[0] * (c[1] - origin[1]) - direction[1] * (c[0] - origin[0]);
        return decision.verdict === 'left' ? cross < 0 : cross > 0;
      });
      return best(preferred, forwardScore) ?? forward();
    }
    return forward();
  }
}
