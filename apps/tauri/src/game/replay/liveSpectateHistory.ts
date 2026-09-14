import { NetCommandId, type GameJson } from '@fumbbl40k/ffb-protocol';
import { MAX_REPLAY_COMMANDS, MAX_REPLAY_COMMAND_BYTES, MAX_REPLAY_KEYFRAMES, MAX_REPLAY_SNAPSHOT_BYTES, recordedReplayDelayMs, sameReplayTurnPosition, type ReplayCommand, type ReplayTurnMarker, type ReplayTurnPosition } from './replayController';
import { REPLAY_MODEL_COMMANDS, replayCommandIsTurnEnd } from './replayModel';
import type { ReplayedStandingRerolls } from '../standingRerollProjection';
import { buildReRollDecision } from '../reRollDecisionProjection';
import { freezeSpectatorValue, reduceSpectatorCheckpoint, sameSpectatorIdentity, seedSpectatorCheckpoint, withSpectatorClock, type SpectatorCheckpoint, type SpectatorClock, type SpectatorCursor, type SpectatorEvent, type SpectatorIdentity } from './spectatorCheckpoint';

export type SpectatorPacketClass = 'snapshot' | 'match' | 'clock' | 'annotation' | 'connection' | 'unsupported';
/** Exhaustive inventory of the protocol's externally delivered server commands. */
export const SPECTATOR_PACKET_CLASSES: Readonly<Record<string, SpectatorPacketClass>> = Object.freeze({
  serverGameState: 'snapshot', serverModelSync: 'match', serverAddPlayer: 'match', serverRemovePlayer: 'match',
  serverZapPlayer: 'match', serverUnzapPlayer: 'match', serverGameTime: 'clock',
  serverUpdateLocalPlayerMarkers: 'annotation', serverAddSketches: 'annotation', serverRemoveSketches: 'annotation',
  serverSketchAddCoordinate: 'annotation', serverSketchSetColor: 'annotation', serverSketchSetLabel: 'annotation',
  serverClearSketches: 'annotation', serverSetPreventSketching: 'annotation', serverAutomaticPlayerMarkings: 'annotation',
  serverVersion: 'connection', serverPasswordChallenge: 'connection', serverJoin: 'connection', serverLeave: 'connection',
  serverTalk: 'connection', serverStatus: 'connection', serverAdminMessage: 'connection', serverPong: 'connection',
  serverTeamList: 'connection', serverTeamSetupList: 'connection', serverGameList: 'connection', serverUserSettings: 'connection',
  serverReplay: 'connection', serverReplayStatus: 'connection', serverReplayControl: 'connection', serverSound: 'annotation',
});
export function classifySpectatorPacket(command: Readonly<Record<string, unknown>>): SpectatorPacketClass {
  return SPECTATOR_PACKET_CLASSES[String(command.netCommandId)] ?? 'unsupported';
}
export interface HistoryLimits {
  commands: number;
  commandBytes: number;
  checkpoints: number;
  snapshotBytes: number;
  activeGraphBytes: number;
}
export const LIVE_HISTORY_LIMITS: Readonly<HistoryLimits> = Object.freeze({
  commands: MAX_REPLAY_COMMANDS, commandBytes: MAX_REPLAY_COMMAND_BYTES,
  checkpoints: MAX_REPLAY_KEYFRAMES, snapshotBytes: MAX_REPLAY_SNAPSHOT_BYTES,
  activeGraphBytes: 16 * 1024 * 1024,
});
export const estimatedSpectatorBytes = (value: unknown): number => JSON.stringify(value).length * 2;
/** Perf 09-14: one serialisation per frozen checkpoint object. Head accounting, the anchor entry, the review budget
 *  and the publication budget all asked for the same number — four ~200 KB stringifies per live event. */
const checkpointByteCache = new WeakMap<SpectatorCheckpoint, number>();
export function spectatorCheckpointBytes(checkpoint: SpectatorCheckpoint): number {
  const cached = checkpointByteCache.get(checkpoint);
  if (cached !== undefined) return cached;
  const bytes = estimatedSpectatorBytes(checkpoint);
  if (Object.isFrozen(checkpoint)) checkpointByteCache.set(checkpoint, bytes);
  return bytes;
}
/** `estimatedSpectatorBytes(event) + signature.length * 2` without serialising the command a second time: the
 *  captured command serialises exactly as its signature, so only the envelope is stringified. */
const storedEventBytes = (event: SpectatorEvent, signature: string): number =>
  (JSON.stringify({ ...event, command: 0 }).length - 1 + signature.length) * 2 + signature.length * 2;
interface StoredEvent { event: SpectatorEvent; bytes: number; signature: string; clockAfter?: SpectatorClock }
interface Anchor { checkpoint: SpectatorCheckpoint; bytes: number }
/** A turn boundary inside a segment, recorded at admission/preparation (Astra 09-14: scanning for them afterwards
 *  re-reduced every turn of a 1821-command backfill on the UI thread). */
export type SpectatorTurnBoundary = Omit<ReplayTurnMarker, 'label' | 'segmentId'>;
export interface SpectatorSegment {
  identity: SpectatorIdentity;
  start: number;
  end: number;
  sealed: boolean;
  incomplete: boolean;
  interruption: string | null;
  /** Turn boundaries in cursor order; entries before `start` are stale after front eviction (callers filter). */
  turnMarkers: readonly SpectatorTurnBoundary[];
}
interface Segment extends SpectatorSegment { events: StoredEvent[]; anchors: Anchor[]; turnMarkers: SpectatorTurnBoundary[]; /** live segmentId this pre-join segment was built for */ backfillFor?: number }

/** The turn a checkpoint sits in (null before kick-off / between halves). */
export function spectatorTurnPosition(checkpoint: SpectatorCheckpoint | null): ReplayTurnPosition | null {
  if (!checkpoint) return null;
  const game = checkpoint.model;
  const turn = (game.homePlaying ? game.turnDataHome : game.turnDataAway)?.turnNr;
  return Number.isInteger(turn) && Number(turn) > 0 && game.half > 0
    ? { side: game.homePlaying ? 'H' : 'A', turn: Number(turn), half: game.half }
    : null;
}
/** After a turn-end command: the finished turn (at the cursor AFTER the command) and, when it differs, the started one. */
function recordTurnBoundary(segment: Segment, before: SpectatorCheckpoint, after: SpectatorCheckpoint): void {
  const cursor = after.cursor.sequence;
  const finished = spectatorTurnPosition(before);
  const started = spectatorTurnPosition(after);
  if (finished) segment.turnMarkers.push({ ...finished, cursor, boundary: 'finish' });
  if (started && !sameReplayTurnPosition(finished, started)) segment.turnMarkers.push({ ...started, cursor, boundary: 'start' });
}
/** A reduced pre-join segment awaiting an atomic commit (see prepareBackfill / commitBackfill). */
export interface PreparedBackfill { segment: Segment; gameId: string; liveIdentity: SpectatorIdentity; bytes: number; snapshotBytes: number }
export type BackfillPrepareResult =
  | { kind: 'ok'; prepared: PreparedBackfill }
  | { kind: 'superseded' }
  | { kind: 'nothing-before-join' }
  | { kind: 'boundary-unverified'; replayCommands: number }
  | { kind: 'needle-short'; liveEvents: number }
  | { kind: 'reducer-failed'; at: number; commandNr: number | undefined; reason: string }
  | { kind: 'over-budget' };
export type BackfillCommitResult = { kind: 'ok'; events: number; anchors: number } | { kind: 'superseded' } | { kind: 'over-budget' };
/** How many captured live commands are matched (consecutively) inside the replay stream to place the join boundary. */
export const BACKFILL_NEEDLE_LENGTH = 3;
/** A command's content identity independent of its number: the replay stream is renumbered by the server. */
export function replayContentSignature(command: Readonly<Record<string, unknown>>): string {
  const { commandNr: _nr, ...content } = command;
  return JSON.stringify(content);
}
/** Index in `haystack` where the consecutive `needle` starts. The LAST full match wins when the needle repeats (the
 *  live capture is the most recent occurrence). A partial match is accepted only when NO full match exists, only at the
 *  very end of the stream (the download raced the live tail), and only with at least two matched elements — a single
 *  coincidental element at the tail must never override an earlier full match (Astra 09-14). Null when the needle is
 *  empty or never occurs. */
export function findBackfillBoundary(haystack: readonly string[], needle: readonly string[]): number | null {
  if (needle.length === 0) return null;
  let full: number | null = null;
  let partial: number | null = null;
  for (let start = 0; start < haystack.length; start++) {
    let matched = 0;
    while (matched < needle.length && start + matched < haystack.length && haystack[start + matched] === needle[matched]) matched++;
    if (matched === needle.length) full = start;
    else if (matched >= 2 && start + matched === haystack.length) partial = start;
  }
  return full ?? partial;
}
export type IngressResult =
  | { kind: 'connection' | 'annotation' | 'ignored' | 'duplicate' }
  | { kind: 'committed'; checkpoint: SpectatorCheckpoint; event: SpectatorEvent | null }
  | { kind: 'stale'; reason: string };

/** Synchronous ingress owner; publication may select head in the same JS turn without an await.
 * The spectator store records through this owner; historical publication remains separate. */
export class LiveSpectateHistory {
  private segments: Segment[] = [];
  private sequence = 0;
  private nextSegment = 0;
  private currentGeneration = 0;
  private connectionActive = false;
  private headValue: SpectatorCheckpoint | null = null;
  private staleReasonValue: string | null = null;
  private enabled = true;
  private noticeValue: string | null = null;
  private lastNumbered: { number: number; signature: string } | null = null;
  private commandCount = 0;
  private commandBytes = 0;
  private headBytes = 0;
  /** The last `checkpointAt` result: a sequential reader (live follow, review autoplay, turn index) continues from it
   *  instead of re-reducing from the nearest anchor (09-14: 708 ms per live event at ~200 past an anchor). */
  private resolved: SpectatorCheckpoint | null = null;
  /** Matches already given a pre-join segment (survives its eviction: one replay fetch per match). */
  private readonly backfilledGames = new Set<string>();
  readonly limits: Readonly<HistoryLimits>;

  constructor(readonly sessionId: string, limits: Partial<HistoryLimits> = {}) {
    this.limits = Object.freeze({ ...LIVE_HISTORY_LIMITS, ...limits });
    for (const value of Object.values(this.limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid history budget');
  }
  get head(): SpectatorCheckpoint | null { return this.headValue; }
  get staleReason(): string | null { return this.staleReasonValue; }
  get recording(): boolean { return this.enabled; }
  get notice(): string | null { return this.noticeValue; }
  get generation(): number { return this.currentGeneration; }
  /** Async snapshot enrichment may replace only the exact requested head. A new
   * clock, delta, snapshot, connection, or interruption invalidates the request. */
  repairStandingRerolls(expected: SpectatorCheckpoint, replayed: ReplayedStandingRerolls): SpectatorCheckpoint | null {
    if (!this.connectionActive || this.headValue !== expected || this.staleReasonValue || expected.cursor.connectionGeneration !== this.currentGeneration) return null;
    const next = structuredClone(expected);
    let changed = false;
    for (const side of ['home', 'away'] as const) {
      const turn = (side === 'home' ? next.model.turnDataHome : next.model.turnDataAway) as Record<string, unknown>;
      for (const field of ['rerollPumpUpTheCrowdOneDrive', 'rerollShowStarOneDrive', 'singleUseReRolls'] as const) {
        const value = replayed[side][field];
        if (value === undefined || Object.prototype.hasOwnProperty.call(turn, field)) continue;
        if (!Number.isSafeInteger(value) || value < 0) return null;
        turn[field] = value;
        changed = true;
      }
    }
    if (!changed) return null;
    const projection = next.durableProjection;
    if (projection.pendingDecision?.state === 'offered' && ['reRoll', 'reRollProperties'].includes(projection.pendingDecision.type)) {
      projection.reRollCard = buildReRollDecision(next.model, next.model.dialogParameter!, projection.actionRolls);
    }
    const checkpoint = freezeSpectatorValue(next);
    const bytes = spectatorCheckpointBytes(checkpoint);
    if (bytes > this.limits.activeGraphBytes) return null;
    this.headValue = checkpoint;
    this.headBytes = bytes;
    this.resolved = null;
    const segment = this.segments.at(-1);
    if (this.enabled && segment) {
      const index = segment.anchors.findIndex((anchor) => anchor.checkpoint.cursor.sequence === checkpoint.cursor.sequence);
      const anchor = { checkpoint, bytes };
      if (index >= 0) segment.anchors[index] = anchor;
      else segment.anchors.push(anchor);
      this.enforceLimits();
    }
    return checkpoint;
  }
  /** Owner 09-14: the match BEFORE the spectator joined, from the server's replay stream of the in-progress game.
   *  The replay stream is renumbered 1..N by the server (ServerReplay.orderCommands) while live commandNr comes from a
   *  per-GameState generator that restarts on a cache reload — so the two number spaces never bound each other. The
   *  join boundary is found by CONTENT instead: the first captured live commands (commandNr stripped) are matched as a
   *  consecutive needle inside the replay stream; everything before the match happened before the join. `canBackfill`
   *  (before any download) names the live segment a backfill would sit in front of; `prepareBackfill` reduces the
   *  pre-join commands into a candidate bound to THAT segment identity, yielding to the event loop every few
   *  milliseconds and refusing as soon as the remaining budget is exceeded; `commitBackfill` re-validates the identity
   *  and inserts atomically. One backfill per match; eviction drops backfill first. Receipt times are computed BEFORE
   *  reduction so anchors and durable log rows carry real timestamps. Every refusal is typed for the caller to log. */
  canBackfill(): SpectatorIdentity | null {
    const live = this.backfillTarget();
    return live && live.events.length > 0 ? { ...live.identity } : null;
  }
  async prepareBackfill(seedModel: GameJson, commands: readonly ReplayCommand[], liveIdentity: SpectatorIdentity, sliceMs = 12): Promise<BackfillPrepareResult> {
    const live = this.backfillTarget();
    if (!live || !sameSpectatorIdentity(live.identity, liveIdentity) || live.events.length === 0) return { kind: 'superseded' };
    const gameId = String(this.headValue!.model.gameId);
    // Replayable, reducible commands only; the join boundary is searched in this same filtered space.
    // A one-command needle is too easy to mistake for another command: wait for the full needle (the store retries).
    if (live.events.length < BACKFILL_NEEDLE_LENGTH) return { kind: 'needle-short', liveEvents: live.events.length };
    const replayable = commands.filter((command) => classifySpectatorPacket(command) === 'match' && REPLAY_MODEL_COMMANDS.has(command.netCommandId));
    const needle = live.events.slice(0, BACKFILL_NEEDLE_LENGTH).map((entry) => replayContentSignature(entry.event.command));
    const boundary = findBackfillBoundary(replayable.map(replayContentSignature), needle);
    if (boundary === null) return { kind: 'boundary-unverified', replayCommands: replayable.length };
    if (boundary === 0) return { kind: 'nothing-before-join' };
    const selected = replayable.slice(0, boundary);
    const identity: SpectatorIdentity = { sessionId: this.sessionId, connectionGeneration: this.currentGeneration, segmentId: ++this.nextSegment };
    let checkpoint = seedSpectatorCheckpoint(seedModel, { ...identity, sequence: 0 }, null);
    if (String(checkpoint.model.gameId) !== gameId) return { kind: 'superseded' };
    // Pass 1 (cheap, no clones): the replay's own clock gives the pacing; the whole span is laid back from the first
    // live receipt so every event AND every reduced checkpoint (durable log rows included) carries a plausible past.
    const monotonicAt: number[] = [];
    let previousCommand: ReplayCommand | null = null;
    let monotonic = 0;
    for (const command of selected) {
      monotonic += recordedReplayDelayMs(previousCommand, command);
      previousCommand = command;
      monotonicAt.push(monotonic);
    }
    const liveFirstWall = live.events[0]!.event.receivedWallAt;
    const segment: Segment = { identity, start: 0, end: 0, sealed: true, incomplete: false, interruption: 'Before you joined',
      events: [], anchors: [{ checkpoint, bytes: spectatorCheckpointBytes(checkpoint) }], turnMarkers: [], backfillFor: live.identity.segmentId };
    // Budget is enforced while preparing: the candidate never grows past what commit could accept.
    const used = this.accounting();
    let bytes = 0;
    let snapshotBytes = segment.anchors[0]!.bytes;
    const overBudget = () => used.commands + segment.events.length > this.limits.commands || used.commandBytes + bytes > this.limits.commandBytes
      || used.checkpoints + segment.anchors.length > this.limits.checkpoints || used.snapshotBytes + snapshotBytes > this.limits.snapshotBytes;
    let sequence = 0;
    let sliceStart = performance.now();
    for (let index = 0; index < selected.length; index++) {
      const captured = structuredClone(selected[index]!) as ReplayCommand;
      const signature = JSON.stringify(captured);
      const event = freezeSpectatorValue({ cursor: { ...identity, sequence: sequence + 1 }, command: captured,
        receivedWallAt: Math.max(0, liveFirstWall - (monotonic - monotonicAt[index]!)), receivedMonotonicAt: monotonicAt[index]!, ingressOrder: 0, clock: null });
      const previous = checkpoint;
      try { checkpoint = reduceSpectatorCheckpoint(checkpoint, event); }
      catch (error) { return { kind: 'reducer-failed', at: sequence + 1, commandNr: captured.commandNr, reason: String(error) }; }
      sequence++;
      if (replayCommandIsTurnEnd(captured)) recordTurnBoundary(segment, previous, checkpoint);
      const entryBytes = storedEventBytes(event, signature);
      segment.events.push({ event, bytes: entryBytes, signature });
      bytes += entryBytes;
      segment.end = sequence;
      const anchor = segment.anchors[segment.anchors.length - 1]!;
      if (sequence - anchor.checkpoint.cursor.sequence >= 256 || replayCommandIsTurnEnd(captured)) {
        const anchorBytes = spectatorCheckpointBytes(checkpoint);
        segment.anchors.push({ checkpoint, bytes: anchorBytes });
        snapshotBytes += anchorBytes;
      }
      if (overBudget()) { this.noticeValue = 'Earlier history limit reached'; return { kind: 'over-budget' }; }
      if (performance.now() - sliceStart >= sliceMs) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); sliceStart = performance.now(); }
    }
    return { kind: 'ok', prepared: { segment, gameId, liveIdentity: { ...live.identity }, bytes, snapshotBytes } };
  }
  commitBackfill(prepared: PreparedBackfill): BackfillCommitResult {
    const live = this.backfillTarget();
    if (!live || !sameSpectatorIdentity(live.identity, prepared.liveIdentity) || String(this.headValue!.model.gameId) !== prepared.gameId) return { kind: 'superseded' };
    const { segment } = prepared;
    // Atomic against the budget as it stands NOW (ingress kept recording while we prepared): fits whole or is dropped.
    const now = this.accounting();
    if (now.commands + segment.events.length > this.limits.commands || now.commandBytes + prepared.bytes > this.limits.commandBytes
      || now.checkpoints + segment.anchors.length > this.limits.checkpoints || now.snapshotBytes + prepared.snapshotBytes > this.limits.snapshotBytes) {
      this.noticeValue = 'Earlier history limit reached';
      return { kind: 'over-budget' };
    }
    this.segments.splice(this.segments.length - 1, 0, segment);
    this.commandCount += segment.events.length;
    this.commandBytes += prepared.bytes;
    this.backfilledGames.add(prepared.gameId);
    return { kind: 'ok', events: segment.events.length, anchors: segment.anchors.length };
  }
  /** The live segment a backfill would sit in front of, or null when a backfill is not possible / already done. */
  private backfillTarget(): Segment | null {
    if (!this.enabled || !this.connectionActive || !this.headValue || this.staleReasonValue) return null;
    const live = this.segments.at(-1);
    if (!live || live.identity.connectionGeneration !== this.currentGeneration || live.backfillFor !== undefined) return null;
    if (this.backfilledGames.has(String(this.headValue.model.gameId))) return null;
    if (this.segments.some((segment) => segment.backfillFor === live.identity.segmentId)) return null;
    return live;
  }
  /** Number of committed events in the current live segment (0 right after the join snapshot). */
  get liveSegmentEvents(): number { const live = this.segments.at(-1); return live ? live.events.length : 0; }
  coverage(): SpectatorSegment[] {
    return this.segments.map(({ identity, start, end, sealed, incomplete, interruption, turnMarkers }) => ({ identity: { ...identity }, start, end, sealed, incomplete, interruption, turnMarkers }));
  }
  /** Replaces transport identity without destroying a paused view held by the presentation owner. */
  beginConnection(generation: number): void {
    if (!Number.isSafeInteger(generation) || generation <= this.currentGeneration) throw new Error('Connection generation must increase');
    this.currentGeneration = generation;
    this.connectionActive = true;
    this.lastNumbered = null;
    const last = this.segments.at(-1);
    if (last) { last.sealed = true; last.interruption = 'Connection replaced'; }
    this.staleReasonValue = 'Waiting for a fresh match snapshot';
  }
  disconnect(generation: number): void {
    if (generation !== this.currentGeneration) return;
    this.connectionActive = false;
    const last = this.segments.at(-1);
    if (last) { last.sealed = true; last.interruption = 'Live feed disconnected'; }
    if (!this.headValue?.durableProjection.endGame.finalPresentationReady) this.staleReasonValue = 'Live feed disconnected';
  }
  private stale(reason: string): IngressResult {
    this.staleReasonValue = reason;
    const last = this.segments.at(-1);
    if (last) { last.incomplete = true; last.sealed = true; last.interruption = reason; }
    return { kind: 'stale', reason };
  }
  admit(command: Readonly<Record<string, unknown>>, generation: number, receivedWallAt: number, receivedMonotonicAt: number, ingressOrder = this.sequence + 1): IngressResult {
    if (generation !== this.currentGeneration) return { kind: 'ignored' };
    if (!Number.isFinite(receivedWallAt) || !Number.isFinite(receivedMonotonicAt)) return this.stale('Invalid receipt metadata');
    if (!Number.isSafeInteger(ingressOrder) || ingressOrder < 0) return this.stale('Invalid ingress order');
    const kind = classifySpectatorPacket(command);
    if (kind === 'connection') return { kind };
    // Remote annotations remain live-only/no-op in recorded history in release one.
    if (kind === 'annotation') return { kind };
    if (kind === 'unsupported') return this.stale(`Unsupported spectator mutation: ${String(command.netCommandId)}`);
    if (kind === 'snapshot') {
      try {
        const cursor = { sessionId: this.sessionId, connectionGeneration: generation, segmentId: this.nextSegment + 1, sequence: this.sequence };
        const model = command.game as GameJson;
        if (this.headValue && model.gameId !== this.headValue.model.gameId) return this.stale('Snapshot belongs to another match');
        const clock = typeof model.gameTime === 'number' && typeof model.turnTime === 'number'
          ? { gameTime: model.gameTime, turnTime: model.turnTime, receivedMonotonicAt } : null;
        const checkpoint = seedSpectatorCheckpoint(model, cursor, clock);
        const old = this.segments.at(-1);
        if (old) { old.sealed = true; old.interruption ??= 'New match snapshot'; }
        this.nextSegment++;
        this.headValue = checkpoint;
        this.headBytes = spectatorCheckpointBytes(checkpoint);
        this.staleReasonValue = null;
        this.lastNumbered = null;
        if (this.enabled) {
          this.segments.push({ identity: cursor, start: cursor.sequence, end: cursor.sequence, sealed: false, incomplete: false, interruption: null,
            events: [], anchors: [{ checkpoint, bytes: this.headBytes }], turnMarkers: [] });
          this.enforceLimits();
        }
        return { kind: 'committed', checkpoint, event: null };
      } catch (error) { return this.stale(`Invalid spectator snapshot: ${String(error)}`); }
    }
    if (!this.headValue || this.staleReasonValue) return { kind: 'ignored' };
    if (kind === 'clock') {
      try {
        const checkpoint = reduceSpectatorCheckpoint(this.headValue, {
          cursor: { ...this.headValue.cursor }, command: structuredClone(command) as ReplayCommand, receivedWallAt, receivedMonotonicAt,
        });
        this.headValue = checkpoint;
        this.headBytes = spectatorCheckpointBytes(checkpoint);
        const segment = this.segments.at(-1);
        if (this.enabled && segment && checkpoint.clock) {
          const entry = segment.events.at(-1);
          if (entry && entry.event.cursor.sequence === checkpoint.cursor.sequence) {
            const delta = estimatedSpectatorBytes(checkpoint.clock) - (entry.clockAfter ? estimatedSpectatorBytes(entry.clockAfter) : 0);
            entry.clockAfter = checkpoint.clock;
            entry.bytes += delta;
            this.commandBytes += delta;
          }
          const anchor = segment.anchors.at(-1);
          if (anchor?.checkpoint.cursor.sequence === checkpoint.cursor.sequence) {
            anchor.checkpoint = checkpoint;
            anchor.bytes = this.headBytes;
          }
          this.enforceLimits();
        }
        return { kind: 'committed', checkpoint, event: null };
      } catch (error) { return this.stale(`Invalid spectator clock: ${String(error)}`); }
    }
    let signature: string;
    let captured: ReplayCommand;
    try {
      signature = JSON.stringify(command);
      if (signature.length * 2 > this.limits.commandBytes) return this.stale('Spectator command exceeds capture budget');
      captured = structuredClone(command) as ReplayCommand;
    } catch (error) { return this.stale(`Invalid spectator command: ${String(error)}`); }
    const number = typeof command.commandNr === 'number' && Number.isSafeInteger(command.commandNr) ? command.commandNr : null;
    if (number != null && this.lastNumbered && number <= this.lastNumbered.number) {
      const prior = number === this.lastNumbered.number ? this.lastNumbered.signature
        : this.segments.at(-1)?.events.find((item) => item.event.command.commandNr === number)?.signature;
      return prior === signature ? { kind: 'duplicate' } : this.stale('Contradictory or unverifiable out-of-order spectator command');
    }
    const cursor = { ...this.headValue.cursor, sequence: this.sequence + 1 };
    const event = freezeSpectatorValue({ cursor, command: captured, receivedWallAt, receivedMonotonicAt, ingressOrder, clock: this.headValue.clock });
    try {
      if (kind === 'match' && !REPLAY_MODEL_COMMANDS.has(captured.netCommandId)) return this.stale('Unsupported model command');
      const previous = this.headValue;
      const checkpoint = reduceSpectatorCheckpoint(this.headValue, event);
      this.headValue = checkpoint;
      this.headBytes = spectatorCheckpointBytes(checkpoint);
      this.sequence++;
      if (number != null) this.lastNumbered = { number, signature };
      const segment = this.segments.at(-1);
      if (this.enabled && segment) {
        const bytes = storedEventBytes(event, signature);
        segment.events.push({ event, bytes, signature });
        this.commandCount++;
        this.commandBytes += bytes;
        segment.end = cursor.sequence;
        const anchor = segment.anchors.at(-1)!;
        if (cursor.sequence - anchor.checkpoint.cursor.sequence >= 256 || replayCommandIsTurnEnd(captured)) {
          segment.anchors.push({ checkpoint, bytes: this.headBytes });
        }
        if (replayCommandIsTurnEnd(captured)) recordTurnBoundary(segment, previous, checkpoint);
        this.enforceLimits();
      }
      return { kind: 'committed', checkpoint, event };
    } catch (error) { return this.stale(`Spectator reducer failed: ${String(error)}`); }
  }
  accounting(): { commands: number; commandBytes: number; checkpoints: number; snapshotBytes: number; headBytes: number } {
    return {
      commands: this.commandCount,
      commandBytes: this.commandBytes,
      checkpoints: this.segments.reduce((n, s) => n + s.anchors.length, 0),
      snapshotBytes: this.segments.reduce((n, s) => n + s.anchors.reduce((sum, a) => sum + a.bytes, 0), 0),
      headBytes: this.headBytes,
    };
  }
  private disable(): void {
    this.segments = [];
    this.commandCount = 0;
    this.commandBytes = 0;
    this.enabled = false;
    this.noticeValue = 'History unavailable: minimum checkpoint exceeds the history budget';
  }
  private enforceLimits(): void {
    for (;;) {
      const bytes = this.accounting();
      if (bytes.headBytes > this.limits.activeGraphBytes) { this.disable(); return; }
      if (bytes.commands <= this.limits.commands && bytes.commandBytes <= this.limits.commandBytes
        && bytes.checkpoints <= this.limits.checkpoints && bytes.snapshotBytes <= this.limits.snapshotBytes) return;
      this.noticeValue = 'Earlier history limit reached';
      // A pre-join backfill segment always goes before any captured history, oldest captured segment next.
      const backfillIndex = this.segments.findIndex((segment) => segment.backfillFor !== undefined);
      if (backfillIndex >= 0 && this.segments.length > 1) {
        const [dropped] = this.segments.splice(backfillIndex, 1);
        this.commandCount -= dropped!.events.length;
        this.commandBytes -= dropped!.events.reduce((sum, entry) => sum + entry.bytes, 0);
        continue;
      }
      const first = this.segments[0];
      if (!first) return;
      if (this.segments.length > 1) {
        this.commandCount -= first.events.length;
        this.commandBytes -= first.events.reduce((sum, entry) => sum + entry.bytes, 0);
        this.segments.shift(); continue;
      }
      // Budget pressure during a very long turn creates a new valid window anchor.
      if (first.anchors.length === 1 && this.headValue && first.start < this.headValue.cursor.sequence) {
        const anchor = { checkpoint: this.headValue, bytes: spectatorCheckpointBytes(this.headValue) };
        // Both references exist at the rollover boundary and must fit the snapshot allowance.
        if (bytes.snapshotBytes + anchor.bytes > this.limits.snapshotBytes || this.limits.checkpoints < 2) { this.disable(); return; }
        first.anchors.push(anchor);
      }
      if (first.anchors.length < 2) { this.disable(); return; }
      first.anchors.shift();
      first.start = first.anchors[0]!.checkpoint.cursor.sequence;
      const keep = first.events.findIndex((entry) => entry.event.cursor.sequence > first.start);
      const removeCount = keep < 0 ? first.events.length : keep;
      this.commandCount -= removeCount;
      for (let index = 0; index < removeCount; index++) this.commandBytes -= first.events[index]!.bytes;
      first.events = first.events.slice(removeCount);
    }
  }
  contains(cursor: SpectatorCursor): boolean {
    return this.enabled && this.segments.some((s) => sameSpectatorIdentity(s.identity, cursor) && cursor.sequence >= s.start && cursor.sequence <= s.end);
  }
  checkpointAt(cursor: SpectatorCursor): SpectatorCheckpoint | null {
    if (!this.contains(cursor)) return null;
    // The head IS the reduction of every stored event (plus every ordered clock) up to its own cursor: serve it
    // rather than rebuilding an equal graph from the last anchor. This also stops the live reader re-publishing an
    // equal-but-distinct graph after each presented event (one publish, one token pass per event).
    const head = this.headValue;
    if (head && sameSpectatorIdentity(head.cursor, cursor) && head.cursor.sequence === cursor.sequence) return head;
    const segment = this.segments.find((s) => sameSpectatorIdentity(s.identity, cursor))!;
    let result = segment.anchors[0]!.checkpoint;
    for (const anchor of segment.anchors) if (anchor.checkpoint.cursor.sequence <= cursor.sequence) result = anchor.checkpoint;
    // Stored events are immutable and only evicted from the front, so the previous result is a valid start whenever it
    // is still inside coverage, at or before the cursor, and nearer than the anchor.
    const resolved = this.resolved;
    if (resolved && sameSpectatorIdentity(resolved.cursor, cursor) && resolved.cursor.sequence <= cursor.sequence
      && resolved.cursor.sequence > result.cursor.sequence && resolved.cursor.sequence >= segment.start) result = resolved;
    for (let index = result.cursor.sequence - segment.start; index < cursor.sequence - segment.start; index++) {
      const entry = segment.events[index]!;
      result = reduceSpectatorCheckpoint(result, entry.event);
      if (entry.clockAfter) result = withSpectatorClock(result, entry.clockAfter);
    }
    // The newest stored event's clock sample can still move (a later clock packet); a reused result follows it.
    const last = segment.events[cursor.sequence - segment.start - 1];
    if (last?.clockAfter && result.clock !== last.clockAfter) result = withSpectatorClock(result, last.clockAfter);
    this.resolved = result;
    return result;
  }
  eventAfter(cursor: SpectatorCursor): SpectatorEvent | null {
    if (!this.contains(cursor)) return null;
    const segment = this.segments.find((s) => sameSpectatorIdentity(s.identity, cursor))!;
    return segment.events[cursor.sequence - segment.start]?.event ?? null;
  }
  tail(cursor: SpectatorCursor): { atAvailableTail: boolean; segmentSealed: boolean; matchComplete: boolean } {
    const segment = this.segments.find((s) => sameSpectatorIdentity(s.identity, cursor));
    return { atAvailableTail: segment?.end === cursor.sequence, segmentSealed: segment?.sealed ?? true,
      matchComplete: !!this.headValue && sameSpectatorIdentity(cursor, this.headValue.cursor)
        && cursor.sequence === this.headValue.cursor.sequence && this.headValue.durableProjection.endGame.finalPresentationReady };
  }
}
