import type { GameJson } from '@fumbbl40k/ffb-protocol';

export type KickChoice = 'normal' | 'kick';
export type KickElectionSurface = 'modern' | 'classic';

export interface KickElectionDialog {
  gameId: string | number;
  generation: number;
  instanceKey: string;
  playerId: string;
  ballCoordinate: [number, number];
  ballCoordinateWithKick: [number, number];
}

export interface KickCandidateProjection {
  choice: KickChoice;
  raw: [number, number];
  anchor: [number, number];
  onPitch: boolean;
  stackIndex: 0 | 1;
  primaryHitArea: 'tile' | 'icon' | 'boundary';
  label: 'Normal' | 'Kick';
}

export interface KickElectionProjection {
  key: string;
  playerId: string;
  candidates: readonly [KickCandidateProjection, KickCandidateProjection];
}

interface KickElectionDeps {
  game: () => GameJson | null;
  playActive: () => boolean;
  myPlayIds: (game: GameJson) => ReadonlySet<string>;
  catchingUp: () => boolean;
  send: (command: { netCommandId: 'clientUseSkill'; skill: 'Kick'; skillUsed: boolean; playerId: string }) => void;
}

function onPitch([x, y]: readonly [number, number]): boolean {
  return x >= 0 && x <= 25 && y >= 0 && y <= 14;
}

function anchor([x, y]: readonly [number, number]): [number, number] {
  return [Math.min(25, Math.max(0, x)), Math.min(14, Math.max(0, y))];
}

function same(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function electionKey(dialog: KickElectionDialog): string {
  return `kickSkill:${String(dialog.gameId)}:${dialog.generation}:${dialog.instanceKey}`;
}

/** One game-scoped controller shared by Modern, Classic, and the headless fallback. */
export class KickElectionController {
  private live: KickElectionDialog | null = null;
  private readonly answered = new Set<string>();
  private readonly surfaces = new Set<KickElectionSurface>();

  constructor(private readonly deps: KickElectionDeps) {}

  registerSurface(surface: KickElectionSurface): () => void {
    this.surfaces.add(surface);
    return () => this.surfaces.delete(surface);
  }

  hasInteractiveSurface(): boolean {
    return this.surfaces.size > 0;
  }

  currentKey(): string | null {
    return this.project()?.key ?? null;
  }

  sync(dialog: KickElectionDialog | null): KickElectionProjection | null {
    this.live = dialog;
    return this.project();
  }

  projection(surface: KickElectionSurface): KickElectionProjection | null {
    if (!this.surfaces.has(surface)) return null;
    return this.project();
  }

  choose(key: string, choice: KickChoice, surface: KickElectionSurface): boolean {
    if (!this.surfaces.has(surface)) return false;
    return this.answer(key, choice);
  }

  /** Headless/private-fork driving declines once, after the caller's deferred exact-instance check. */
  declineHeadless(key: string): boolean {
    if (this.hasInteractiveSurface()) return false;
    return this.answer(key, 'normal');
  }

  clearGame(gameId: string | number | null): void {
    this.live = null;
    if (gameId == null) { this.answered.clear(); return; }
    const prefix = `kickSkill:${String(gameId)}:`;
    for (const key of this.answered) if (key.startsWith(prefix)) this.answered.delete(key);
  }

  private project(): KickElectionProjection | null {
    const dialog = this.live;
    const game = this.deps.game();
    if (!dialog || !game || this.deps.catchingUp() || !this.deps.playActive()) return null;
    if (String((game as { gameId?: string | number }).gameId ?? '') !== String(dialog.gameId)) return null;
    // Ownership is derived here. Callers cannot promote a seat with a boolean.
    if (!this.deps.myPlayIds(game).has(dialog.playerId)) return null;
    const key = electionKey(dialog);
    if (this.answered.has(key)) return null;
    const normal = dialog.ballCoordinate;
    const reduced = dialog.ballCoordinateWithKick;
    const normalAnchor = anchor(normal);
    const reducedAnchor = anchor(reduced);
    const sharedRaw = same(normal, reduced);
    const sharedAnchor = same(normalAnchor, reducedAnchor);
    return {
      key,
      playerId: dialog.playerId,
      candidates: [
        {
          choice: 'normal', raw: [normal[0], normal[1]], anchor: normalAnchor, onPitch: onPitch(normal),
          stackIndex: 0, primaryHitArea: onPitch(normal) ? 'tile' : 'boundary', label: 'Normal',
        },
        {
          choice: 'kick', raw: [reduced[0], reduced[1]], anchor: reducedAnchor, onPitch: onPitch(reduced),
          stackIndex: sharedAnchor ? 1 : 0,
          primaryHitArea: sharedRaw && onPitch(reduced) ? 'icon' : onPitch(reduced) ? 'tile' : 'boundary',
          label: 'Kick',
        },
      ],
    };
  }

  private answer(key: string, choice: KickChoice): boolean {
    const election = this.project();
    if (!election || election.key !== key || this.answered.has(key)) return false;
    this.answered.add(key);
    this.live = null;
    this.deps.send({
      netCommandId: 'clientUseSkill',
      skill: 'Kick',
      skillUsed: choice === 'kick',
      playerId: election.playerId,
    });
    return true;
  }
}

export interface KickScatterPreview {
  direction: string;
  directionRoll: number;
  distanceRoll: number;
  unreducedEndpoint: [number, number];
  kickArc: null;
}

function integralCoordinate(raw: unknown, field: string): [number, number] {
  if (!Array.isArray(raw) || raw.length !== 2 || !Number.isInteger(raw[0]) || !Number.isInteger(raw[1])) {
    throw new Error(`${field} must be an integral coordinate`);
  }
  return [raw[0] as number, raw[1] as number];
}

/** StepKickoffScatterRollAskAfter report seam: dice/endpoint preview with deliberately no animation arm. */
export function projectKickScatterPreview(report: Record<string, unknown>): KickScatterPreview {
  const direction = typeof report.scatterDirection === 'string' ? report.scatterDirection.trim() : '';
  const directions = new Set(['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest']);
  const directionRoll = Number(report.rollScatterDirection);
  const distanceRoll = Number(report.rollScatterDistance);
  if (!directions.has(direction)) throw new Error('kickoffScatter direction must be server eight-way vocabulary');
  if (!Number.isInteger(directionRoll) || directionRoll < 1 || directionRoll > 8) throw new Error('kickoffScatter direction roll must be D8');
  if (!Number.isInteger(distanceRoll) || distanceRoll < 1 || distanceRoll > 6) throw new Error('kickoffScatter distance roll must be D6');
  return {
    direction,
    directionRoll,
    distanceRoll,
    unreducedEndpoint: integralCoordinate(report.ballCoordinateEnd, 'kickoffScatter.ballCoordinateEnd'),
    kickArc: null,
  };
}

export type KickPlaybackContext = 'live' | 'pacedReplay' | 'catchingUp' | 'reconnectSnapshot' | 'replaySeek';
export interface AuthoritativeKickBeat {
  kind: 'authoritativeKick';
  gameId: string | number;
  commandNr: number;
  animation: Readonly<{
    startCoordinate: readonly [number, number];
    endCoordinate: readonly [number, number];
  }>;
}

export type KickoffCineHoldTransition = 'unchanged' | 'aimArmed' | 'descendSettled';

/** Pure state transition for the view-local W8 kickoff-cine hold guard. */
export function kickoffCineHoldGuard(
  settled: boolean,
  transition: KickoffCineHoldTransition,
): { settled: boolean; mayHold: boolean } {
  const nextSettled = transition === 'aimArmed' ? false : transition === 'descendSettled' ? true : settled;
  return { settled: nextSettled, mayHold: !nextSettled };
}

/** Final StepKickoffAnimation seam. Coordinates and command identity are immutable receive-time authority. */
export function projectAuthoritativeKick(
  gameId: string | number,
  cmd: Record<string, unknown>,
  context: KickPlaybackContext,
): Readonly<AuthoritativeKickBeat> | null {
  const animation = cmd.animation as { animationType?: unknown; startCoordinate?: unknown; endCoordinate?: unknown } | null | undefined;
  if (String(animation?.animationType ?? '').toLowerCase() !== 'kick') return null;
  if (context !== 'live' && context !== 'pacedReplay') return null;
  const commandNr = Number(cmd.commandNr);
  if (!Number.isInteger(commandNr)) throw new Error('KICK animation requires its frame commandNr');
  const start = integralCoordinate(animation?.startCoordinate, 'KICK startCoordinate');
  const end = integralCoordinate(animation?.endCoordinate, 'KICK endCoordinate');
  return Object.freeze({
    kind: 'authoritativeKick',
    gameId,
    commandNr,
    animation: Object.freeze({
      startCoordinate: Object.freeze([start[0], start[1]]) as unknown as readonly [number, number],
      endCoordinate: Object.freeze([end[0], end[1]]) as unknown as readonly [number, number],
    }),
  });
}
