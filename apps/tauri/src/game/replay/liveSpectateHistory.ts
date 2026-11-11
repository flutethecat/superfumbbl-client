import { NetCommandId, type GameJson } from '@fumbbl40k/ffb-protocol';
import { MAX_REPLAY_COMMANDS, MAX_REPLAY_COMMAND_BYTES, MAX_REPLAY_KEYFRAMES, MAX_REPLAY_SNAPSHOT_BYTES, recordedReplayDelayMs, sameReplayTurnPosition, type ReplayCommand, type ReplayTurnMarker, type ReplayTurnPosition } from './replayController';
import { REPLAY_MODEL_COMMANDS, replayCommandIsTurnEnd } from './replayModel';
import type { ReplayedStandingRerolls } from '../standingRerollProjection';
import { buildReRollDecision } from '../reRollDecisionProjection';
import { freezeSpectatorValue, reduceSpectatorCheckpoint, sameSpectatorIdentity, seedSpectatorCheckpoint, withSpectatorClock, type SpectatorCheckpoint, type SpectatorClock, type SpectatorCursor, type SpectatorEvent, type SpectatorIdentity } from './spectatorCheckpoint';
import { blastinStaleRerollDialog, turnSideIsHome } from '../blastinSecondBeat';
import { t, liveSet, data } from '../../i18n';

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
interface Segment extends SpectatorSegment { events: StoredEvent[]; anchors: Anchor[]; turnMarkers: SpectatorTurnBoundary[]; /** live segmentId this pre-join segment was built for */ backfillFor?: number;
  /** `start` as first recorded: a segment whose `start` has moved has lost its first events to the history budget. */
  origin: number }
/** Owner 10-10: a consumer that folds the match in order (the spectator dice ledger). `event` receives every admitted
 *  match command with the checkpoints around it; `snapshot` every admitted match snapshot; `stale` a feed the history
 *  stopped following. Called at ingress, never from a reader - so what is on screen does not matter to it. */
export interface SpectatorMatchObserver {
  snapshot?(checkpoint: SpectatorCheckpoint): void;
  event(before: SpectatorCheckpoint, after: SpectatorCheckpoint, command: Readonly<Record<string, unknown>>): void;
  stale?(): void;
}
/** A backfill attempt's own fold: the pre-join commands, then the joined live segment's commands from its first. */
interface BackfillObservation { observer: Pick<SpectatorMatchObserver, 'event'>; checkpoint: SpectatorCheckpoint; liveEvents: number; failed: boolean }

/** The turn a checkpoint sits in (null before kick-off / between halves). */
export function spectatorTurnPosition(checkpoint: SpectatorCheckpoint | null): ReplayTurnPosition | null {
  if (!checkpoint) return null;
  const game = checkpoint.model;
  const turn = (turnSideIsHome(game) ? game.turnDataHome : game.turnDataAway)?.turnNr; // S46: the Blastin' second-beat flip is not a turn
  return Number.isInteger(turn) && Number(turn) > 0 && game.half > 0
    ? { side: turnSideIsHome(game) ? 'H' : 'A', turn: Number(turn), half: game.half }
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
export interface PreparedBackfill { segment: Segment; gameId: string; liveIdentity: SpectatorIdentity; bytes: number; snapshotBytes: number; observation?: BackfillObservation;
  /** Owner 10-16: how many of the first live commands the join snapshot already carried (0 = none, the usual case). */
  snapshotAhead?: number }
export type BackfillPrepareResult =
  | { kind: 'ok'; prepared: PreparedBackfill }
  | { kind: 'superseded' }
  | { kind: 'nothing-before-join' }
  /** Owner 10-16 (bug report g1953896): WHY the join could not be placed, for the system log / bug reports. */
  | { kind: 'boundary-unverified'; replayCommands: number; reason: 'trimmed-front' | 'no-candidate' | 'continuity'; detail?: string }
  | { kind: 'needle-short'; liveEvents: number }
  | { kind: 'reducer-failed'; at: number; commandNr: number | undefined; reason: string }
  | { kind: 'over-budget' };
/** `observed`: the attempt's observer was fed the whole game up to the live head (see prepareBackfill). */
export type BackfillCommitResult = { kind: 'ok'; events: number; anchors: number; observed?: boolean } | { kind: 'superseded' } | { kind: 'over-budget'; observed?: boolean };
/** Exact matches the ONE consistent candidate needs before the join is placed (two suffice at the replay's end). */
export const BACKFILL_NEEDLE_LENGTH = 3;
/** How many leading live commands the matcher compares. Bounded so a needle that keeps growing while a download is in
 *  flight never makes a later attempt harder (bug report 2026-10-15, game 1953710). Reaching it never releases a
 *  placement: it can only refuse. */
export const BACKFILL_MATCH_WINDOW = 16;
/** A command's content identity independent of its number: the replay stream is renumbered by the server. */
export function replayContentSignature(command: Readonly<Record<string, unknown>>): string {
  const { commandNr: _nr, ...content } = command;
  return JSON.stringify(content);
}
export type BackfillCommandMatch = 'exact' | 'tolerated' | 'mismatch';
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
/** Structural equality of JSON data: own keys only (no prototype lookups), key order ignored, arrays in order. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) if (!Object.hasOwn(b, key) || !jsonEqual(a[key], b[key])) return false;
  return true;
}
/** Same own key set on both objects, every key compared by `compare` (own keys only). */
function sameKeysEvery(a: Record<string, unknown>, b: Record<string, unknown>, compare: (key: string, x: unknown, y: unknown) => boolean): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) if (!Object.hasOwn(b, key) || !compare(key, a[key], b[key])) return false;
  return true;
}
/** Compare a captured LIVE command with a REPLAY command, commandNr ignored. `exact`: every other field equal.
 *  `tolerated`: the only differences sit INSIDE object values - object-valued modelChangeValues, or another top-level
 *  object field such as serverAddPlayer.player - with the same netCommandId, clocks, sound, report list, model-change
 *  ids and keys in the same order, and every primitive value equal. Anything else: `mismatch`.
 *  Why this breadth (Astra 10-15 round 10): the server keeps model-change value objects by reference and serialises its
 *  replay later. Evidenced: fieldModelSetTargetSelectionState (1953710: committed / playerStateOld); in upstream source
 *  the same object also changes status (StepStandUp .failed()) and usedSkills (StepInitBlocking). A narrower tolerance
 *  can reject the TRUE join's own copy and leave a lookalike as the unique candidate; a broader one can only add
 *  consistent candidates, which makes placement refuse or wait, never place wrong. */
export function compareBackfillCommands(live: Readonly<Record<string, unknown>>, replay: Readonly<Record<string, unknown>>): BackfillCommandMatch {
  let tolerated = false;
  // commandNr is ignored entirely - present, absent or different on either side (the replay is renumbered).
  const { commandNr: _liveNr, ...liveContent } = live;
  const { commandNr: _replayNr, ...replayContent } = replay;
  const equal = sameKeysEvery(liveContent, replayContent, (key, a, b) => {
    if (jsonEqual(a, b)) return true;
    // Astra 10-15 round 11: other commands carry retained objects too (serverAddPlayer.player gains usedSkills later).
    // Any other top-level OBJECT field may differ (tolerated); primitives, arrays and the report list stay exact.
    if (key !== 'modelChangeList') {
      if (key === 'reportList' || !isPlainObject(a) || !isPlainObject(b)) return false;
      tolerated = true;
      return true;
    }
    // The model-change list differs: tolerated only change by change, inside object-valued values.
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    return sameKeysEvery(a, b, (listKey, x, y) => {
      if (listKey !== 'modelChangeArray') return jsonEqual(x, y);
      if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) {
        const left = x[i], right = y[i];
        if (jsonEqual(left, right)) continue;
        if (!isPlainObject(left) || !isPlainObject(right)) return false;
        const ok = sameKeysEvery(left, right, (changeKey, p, q) =>
          changeKey === 'modelChangeValue' ? jsonEqual(p, q) || (isPlainObject(p) && isPlainObject(q)) : jsonEqual(p, q));
        if (!ok) return false;
        tolerated = true;
      }
      return true;
    });
  });
  if (!equal) return 'mismatch';
  return tolerated ? 'tolerated' : 'exact';
}
export interface BackfillPlacementOptions {
  /** Exact matches the unique consistent candidate needs (default 3; capped by the needle length). */
  minExact?: number;
  /** The most needle elements the caller can ever supply (the live match window); default unbounded. */
  maxWindow?: number;
  /** Live commands known to be in the download (it was requested after they arrived): the placed candidate must have
   *  that many of them compared inside the download (Astra 10-15 round 10: a download that predates the live
   *  commands must never place). Default 0. */
  minCovered?: number;
}
/** `index`: the replay index of needle[0], or null. `open`: no decision yet - more live commands could still discriminate
 *  (wait, same download); false with a null index = refuse. */
/** `covered`: how many leading live commands the placed candidate was compared against (all consistent). */
export interface BackfillPlacement { index: number | null; open: boolean; covered?: number }
/** UNIQUE CONSISTENT CANDIDATE (Astra 10-15). Every replay position i is a candidate: the WHOLE captured needle is
 *  compared against haystack[i...] element by element, stopping only at a mismatch or the haystack's end (never early
 *  after a quota of matches). A candidate is consistent when every compared element is exact or tolerated. The join is
 *  placed only when exactly ONE candidate is consistent AND it has at least `minExact` exact matches, or reaches the
 *  haystack's end with at least two (the live commands past the end are simply not in the download yet). No consistent
 *  candidate: refuse. Otherwise wait only while more live commands could still decide it (window not full, and at most
 *  one consistent candidate already at the haystack's end - candidates at the end stay consistent forever in this
 *  download); else refuse. Never "last wins" / "first wins"; the window limit never releases a placement. */
export function placeBackfillJoin<T>(haystack: readonly T[], needle: readonly T[], compare: (live: T, replay: T) => BackfillCommandMatch,
  options: BackfillPlacementOptions = {}): BackfillPlacement {
  if (needle.length === 0) return { index: null, open: false };
  const minExact = Math.max(1, Math.min(options.minExact ?? BACKFILL_NEEDLE_LENGTH, needle.length));
  const maxWindow = options.maxWindow ?? Number.POSITIVE_INFINITY;
  const minCovered = Math.max(0, options.minCovered ?? 0);
  const consistent: { start: number; exact: number; atEnd: boolean; covered: number }[] = [];
  for (let start = 0; start < haystack.length; start++) {
    let exact = 0;
    let index = 0;
    let ok = true;
    for (; index < needle.length && start + index < haystack.length; index++) {
      const match = compare(needle[index]!, haystack[start + index]!);
      if (match === 'mismatch') { ok = false; break; }
      if (match === 'exact') exact++;
    }
    if (ok) consistent.push({ start, exact, atEnd: index < needle.length || start + index === haystack.length, covered: index });
  }
  if (consistent.length === 0) return { index: null, open: false };
  const canGrow = needle.length < maxWindow;
  if (consistent.length === 1) {
    const only = consistent[0]!;
    // atEnd counts only when the haystack ran out BEFORE the needle did (live commands not yet in the download), or
    // exactly with it; either way more live commands cannot add evidence for this download.
    const qualified = (only.exact >= minExact || (only.atEnd && only.exact >= Math.min(2, minExact)))
      && only.covered >= Math.min(minCovered, needle.length);
    if (qualified) return { index: only.start, open: false, covered: only.covered };
    return { index: null, open: canGrow && !only.atEnd };
  }
  const atEnd = consistent.filter((candidate) => candidate.atEnd).length;
  return { index: null, open: canGrow && atEnd <= 1 };
}
/** Exact-only placement over pre-computed signatures (see placeBackfillJoin); default minExact = the needle length. */
export function findBackfillBoundary(haystack: readonly string[], needle: readonly string[], options: BackfillPlacementOptions = {}): number | null {
  return placeBackfillJoin(haystack, needle, (a, b) => (a === b ? 'exact' : 'mismatch'), { minExact: needle.length, ...options }).index;
}
/** Placement of captured live commands inside replay commands (signature fast path for exact, structural compare
 *  only when the signatures differ). */
export function placeBackfillJoinCommands(replay: readonly Readonly<Record<string, unknown>>[], live: readonly Readonly<Record<string, unknown>>[],
  options: BackfillPlacementOptions = {}): BackfillPlacement {
  type Entry = { command: Readonly<Record<string, unknown>>; signature: string };
  const entry = (command: Readonly<Record<string, unknown>>): Entry => ({ command, signature: replayContentSignature(command) });
  return placeBackfillJoin<Entry>(replay.map(entry), live.map(entry), (a, b) => {
    if (a.signature === b.signature) return 'exact';
    // Differing signatures may still be structurally EXACT (key order): always decide structurally (Astra 10-15 round 8:
    // a clock-based shortcut here rejected a reordered true join and left a wrong candidate unique). A different
    // command id can never be exact or tolerated.
    if (a.command.netCommandId !== b.command.netCommandId) return 'mismatch';
    return compareBackfillCommands(a.command, b.command);
  }, options);
}
/** Fields the server's join snapshot is KNOWN to report differently from the client's reduction of the replay up to the
 *  same position. Evidence: five real FUMBBL downloads (in-progress games 1953744, 1953745, 1953748, 1953749 and the
 *  finished 1953710, 2026-10-15), each comparing the download's own serverGameState with seed + every replay command:
 *  - turnData.blitzingPlayerId: snapshot carries the id, the reduction null (1953744, 1953745, 1953710).
 *  - turnData.leaderState: snapshot 'available', reduction 'none' (1953744, 1953710).
 *  - turnData.inducementSet: same inducements in another order (1953749).
 *  - turnData.rerollPumpUpTheCrowdOneDrive / rerollShowStarOneDrive / singleUseReRolls: upstream snapshots may omit them
 *    and the store repairs the join head in place (repairStandingRerolls), so the anchor may carry inferred values.
 *  - actingPlayer.strength / dodging / leaping / hasJumped: absent from every snapshot, present in the reduction.
 *  - actingPlayer.skillsGrantedBy: the server fills it (ActingPlayer.addGrantedSkill, e.g. Wisdom of the White Dwarf)
 *    without emitting a model change, so a replay reduction never reconstructs it (Astra 10-15 round 11, upstream source).
 *  null and an absent field are treated alike (dialogParameter, targetSelectionState: null vs absent in the evidence).
 *  Everything compared is listed in backfillContinuityProjection; anything else (markers, rosters, clocks, results
 *  other than the score) is not part of the check. */
export const BACKFILL_CONTINUITY_IGNORED: Readonly<{ turnData: ReadonlySet<string>; actingPlayer: ReadonlySet<string> }> = Object.freeze({
  turnData: new Set(['blitzingPlayerId', 'leaderState', 'inducementSet', 'rerollPumpUpTheCrowdOneDrive', 'rerollShowStarOneDrive', 'singleUseReRolls']),
  actingPlayer: new Set(['strength', 'dodging', 'leaping', 'hasJumped', 'skillsGrantedBy']),
});
/** Own-key copy without the ignored keys and without null/undefined values (null and absent compare alike). */
function continuityRecord(value: unknown, ignored: ReadonlySet<string> = new Set()): unknown {
  if (!isPlainObject(value)) return value ?? null;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (ignored.has(key)) continue;
    const field = value[key];
    if (field === null || field === undefined) continue;
    out[key] = field;
  }
  return out;
}
/** The game state the continuity check compares: player positions and states, ball and bomb, both turn data blocks,
 *  the acting player, half / homePlaying / turn mode, the scores and the open dialog. */
export function backfillContinuityProjection(model: Readonly<GameJson>): Record<string, unknown> {
  const game = model as unknown as Record<string, unknown>;
  const field = isPlainObject(game.fieldModel) ? game.fieldModel : {};
  const players = Array.isArray(field.playerDataArray) ? field.playerDataArray : [];
  const result = isPlainObject(game.gameResult) ? game.gameResult : {};
  const score = (side: unknown) => (isPlainObject(side) ? side.score ?? null : null);
  return {
    half: game.half ?? null, homePlaying: game.homePlaying ?? null, turnMode: game.turnMode ?? null,
    players: players.map((player) => (isPlainObject(player)
      ? { playerId: player.playerId ?? null, playerCoordinate: player.playerCoordinate ?? null, playerState: player.playerState ?? null } : player))
      .sort((a, b) => String((a as { playerId?: unknown })?.playerId).localeCompare(String((b as { playerId?: unknown })?.playerId))),
    ball: { ballCoordinate: field.ballCoordinate ?? null, ballInPlay: field.ballInPlay ?? null, ballMoving: field.ballMoving ?? null,
      bombCoordinate: field.bombCoordinate ?? null, bombMoving: field.bombMoving ?? null },
    turnDataHome: continuityRecord(game.turnDataHome, BACKFILL_CONTINUITY_IGNORED.turnData),
    turnDataAway: continuityRecord(game.turnDataAway, BACKFILL_CONTINUITY_IGNORED.turnData),
    actingPlayer: (() => {
      // usedSkills is a server-side HashSet (ActingPlayer.toJsonValue): membership counts, order does not (Astra round 10).
      const record = continuityRecord(game.actingPlayer, BACKFILL_CONTINUITY_IGNORED.actingPlayer);
      if (isPlainObject(record) && Array.isArray(record.usedSkills)) record.usedSkills = [...record.usedSkills].map((skill) => JSON.stringify(skill)).sort();
      return record;
    })(),
    score: [score(result.teamResultHome), score(result.teamResultAway)],
    dialogParameter: game.dialogParameter ?? null,
  };
}
/** Top-level continuity fields that differ between the replay reduced to a candidate join and the join snapshot (owner
 *  10-15 option C: an independent check before any placement is committed; fails closed). Empty = continuous. */
export function backfillContinuityDifferences(reduced: Readonly<GameJson>, joinSnapshot: Readonly<GameJson>): string[] {
  const left = backfillContinuityProjection(reduced);
  const right = backfillContinuityProjection(joinSnapshot);
  return Object.keys(left).filter((key) => !jsonEqual(left[key], right[key]));
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
  /** Owner 10-10: folds the live match in order (see SpectatorMatchObserver). A throwing observer never harms the history. */
  observer: SpectatorMatchObserver | null = null;
  private notify(call: (observer: SpectatorMatchObserver) => void): void {
    if (!this.observer) return;
    try { call(this.observer); } catch (error) { console.warn(`[spectate] match observer failed: ${String(error)}`); }
  }

  constructor(readonly sessionId: string, limits: Partial<HistoryLimits> = {}) {
    this.limits = Object.freeze({ ...LIVE_HISTORY_LIMITS, ...limits });
    for (const value of Object.values(this.limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid history budget');
  }
  get head(): SpectatorCheckpoint | null { return this.headValue; }
  get staleReason(): string | null { return this.staleReasonValue; }
  get recording(): boolean { return this.enabled; }
  get notice(): string | null { return this.noticeValue; }
  get generation(): number { return this.currentGeneration; }
  /** Is this history's connection open? (False after disconnect, until the next beginConnection.) */
  get connected(): boolean { return this.connectionActive; }
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
    if (projection.pendingDecision?.state === 'offered' && ['reRoll', 'reRollProperties', 'reRollModifierChoice'].includes(projection.pendingDecision.type) && !blastinStaleRerollDialog(next.model)) {
      projection.reRollCard = buildReRollDecision(next.model, next.model.dialogParameter!, projection.actionRolls, false, undefined, projection.movementOccurrence);
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
  async prepareBackfill(seedModel: GameJson, commands: readonly ReplayCommand[], liveIdentity: SpectatorIdentity, sliceMs = 12,
    observer?: Pick<SpectatorMatchObserver, 'event'>,
    /** `liveAtRequest`: live commands of this segment already received when the download was REQUESTED - the download
     *  holds them, so the placed candidate must cover them (Astra 10-15 round 10). */
    freshness: { liveAtRequest?: number } = {}): Promise<BackfillPrepareResult> {
    const live = this.backfillTarget();
    if (!live || !sameSpectatorIdentity(live.identity, liveIdentity) || live.events.length === 0) return { kind: 'superseded' };
    const gameId = String(this.headValue!.model.gameId);
    // Replayable, reducible commands only; the join boundary is searched in this same filtered space.
    const replayable = commands.filter((command) => classifySpectatorPacket(command) === 'match' && REPLAY_MODEL_COMMANDS.has(command.netCommandId));
    // The needle must start at the join: a live segment whose front was trimmed under budget pressure no longer does.
    if (live.start !== live.origin) return { kind: 'boundary-unverified', replayCommands: replayable.length, reason: 'trimmed-front' };
    // A one-command needle is too easy to mistake for another command: wait for the full needle (the store retries).
    if (live.events.length < BACKFILL_NEEDLE_LENGTH) return { kind: 'needle-short', liveEvents: live.events.length };
    // Bug report 2026-10-15 (game 1953710) + Astra 10-15: the join is placed only at the UNIQUE replay position consistent
    // with the whole captured live window (see placeBackfillJoin); a replay copy may differ from the live command only in
    // the allow-listed by-reference fields. Ambiguity or exhaustion refuses; undecided waits.
    const window = live.events.slice(0, BACKFILL_MATCH_WINDOW).map((entry) => entry.event.command);
    const placement = placeBackfillJoinCommands(replayable, window, { minExact: BACKFILL_NEEDLE_LENGTH, maxWindow: BACKFILL_MATCH_WINDOW, minCovered: freshness.liveAtRequest ?? 0 });
    const boundary = placement.index;
    // Undecided while more live commands could still decide it, from this same download: reported as needle-short so the
    // store re-runs it on the next live event without a fresh fetch.
    if (boundary === null && placement.open) return { kind: 'needle-short', liveEvents: live.events.length };
    if (boundary === null) return { kind: 'boundary-unverified', replayCommands: replayable.length, reason: 'no-candidate' };
    if (boundary === 0) return { kind: 'nothing-before-join' };
    const selected = replayable.slice(0, boundary);
    // Owner 10-15 (option C): the join snapshot the reduced replay must arrive at, captured before any yield.
    const joinSnapshot = live.anchors[0]!.checkpoint.model;
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
    const segment: Segment = { identity, start: 0, end: 0, sealed: true, incomplete: false, interruption: data('Before you joined'),
      events: [], anchors: [{ checkpoint, bytes: spectatorCheckpointBytes(checkpoint) }], turnMarkers: [], backfillFor: live.identity.segmentId, origin: 0 };
    let observing = !!observer;
    const observe = (before: SpectatorCheckpoint, after: SpectatorCheckpoint, command: Readonly<Record<string, unknown>>) => {
      if (!observing) return;
      try { observer!.event(before, after, command); } catch (error) { observing = false; console.warn(`[spectate] backfill observer failed: ${String(error)}`); }
    };
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
      observe(previous, checkpoint, captured);
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
      if (overBudget()) { liveSet(this, 'noticeValue', () => t('replay.text.earlierHistoryLimitReached'), this); return { kind: 'over-budget' }; }
      if (performance.now() - sliceStart >= sliceMs) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); sliceStart = performance.now(); }
    }
    // Owner 10-15 (option C): independent state continuity. The replay reduced up to the single surviving candidate must
    // arrive at the join snapshot (backfillContinuityProjection, fails closed). Reuses this reduction: no second pass.
    let discontinuous = backfillContinuityDifferences(checkpoint.model, joinSnapshot);
    // Owner 10-16 (bug report g1953896, a join at the kick-off): the server builds the join snapshot from its live model,
    // which can already carry the effects of the first live commands it sends right after it (the same commands the
    // needle matched at replay[boundary...]). The pre-join segment is still replay[0..boundary): only the CHECK walks on,
    // through at most the live commands the placement compared, and accepts the first state equal to the snapshot. A
    // snapshot that matches nowhere in that window still refuses (fails closed).
    let snapshotAhead = 0;
    if (discontinuous.length > 0) {
      const atJoin = discontinuous;
      let probe = checkpoint;
      for (let k = 1; k <= Math.min(placement.covered ?? 0, replayable.length - boundary); k++) {
        const command = replayable[boundary + k - 1]!;
        try { probe = reduceSpectatorCheckpoint(probe, freezeSpectatorValue({ cursor: { ...identity, sequence: sequence + k }, command: structuredClone(command) as ReplayCommand, receivedWallAt: 0, receivedMonotonicAt: 0, ingressOrder: 0, clock: null })); }
        catch { break; }
        discontinuous = backfillContinuityDifferences(probe.model, joinSnapshot);
        if (discontinuous.length === 0) {
          // Astra 10-16 (P1): equality k steps past the candidate does not prove the candidate (a download that lost a
          // command can meet the snapshot by coincidence). A snapshot that truly ran ahead already CONTAINS the first k
          // live commands: applying them to it changes nothing. Anything else refuses.
          let again = live.anchors[0]!.checkpoint;
          let noop = true;
          for (let i = 0; i < k; i++) {
            const entry = live.events[i];
            if (!entry) { noop = false; break; }
            try { again = reduceSpectatorCheckpoint(again, entry.event); } catch { noop = false; break; }
            // EACH step must leave the snapshot's state as it is (a net no-op over k steps is not enough: Astra's lost-B case)
            if (backfillContinuityDifferences(again.model, joinSnapshot).length > 0) { noop = false; break; }
          }
          if (noop) { snapshotAhead = k; break; }
          discontinuous = atJoin;
          break;
        }
      }
      if (discontinuous.length > 0) {
        console.warn(`[spectate] backfill continuity refused the join at replay ${boundary}: ${atJoin.join(', ')}`);
        return { kind: 'boundary-unverified', replayCommands: replayable.length, reason: 'continuity', detail: atJoin.join(', ') };
      }
      console.warn(`[spectate] backfill: the join snapshot was ${snapshotAhead} frame(s) ahead of the first live command (${atJoin.join(', ')})`);
    }
    // Owner 10-10: the observer's fold continues through the joined live segment, re-reduced from its join snapshot
    // (the history keeps the events, not a model per event), in the same time slices. Whatever arrives between here
    // and the commit is fed at the commit, so the fold ends exactly at the live head.
    let observation: BackfillObservation | undefined;
    if (observer) {
      observation = { observer, checkpoint: live.anchors[0]!.checkpoint, liveEvents: 0, failed: !observing || live.start !== live.origin };
      while (!observation.failed && observation.liveEvents < live.events.length) {
        if (this.backfillTarget() !== live || live.start !== live.origin) { observation.failed = true; break; }
        this.advanceObservation(observation, live);
        if (performance.now() - sliceStart >= sliceMs) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); sliceStart = performance.now(); }
      }
    }
    return { kind: 'ok', prepared: { segment, gameId, liveIdentity: { ...live.identity }, bytes, snapshotBytes, snapshotAhead, ...(observation ? { observation } : {}) } };
  }
  /** Feed the observation the next live event of `live` (re-reduced from the observation's own checkpoint). */
  private advanceObservation(observation: BackfillObservation, live: Segment): void {
    const entry = live.events[observation.liveEvents];
    if (!entry) { observation.failed = true; return; }
    try {
      const next = reduceSpectatorCheckpoint(observation.checkpoint, entry.event);
      observation.observer.event(observation.checkpoint, next, entry.event.command);
      observation.checkpoint = next;
      observation.liveEvents++;
    } catch (error) { observation.failed = true; console.warn(`[spectate] backfill observer failed: ${String(error)}`); }
  }
  commitBackfill(prepared: PreparedBackfill): BackfillCommitResult {
    const live = this.backfillTarget();
    if (!live || !sameSpectatorIdentity(live.identity, prepared.liveIdentity) || String(this.headValue!.model.gameId) !== prepared.gameId) return { kind: 'superseded' };
    // Astra 10-15: the live front may have been trimmed while preparing yielded - the placement no longer joins up.
    if (live.start !== live.origin) return { kind: 'superseded' };
    const { segment } = prepared;
    // Owner 10-10: bring the observer's fold to the live head first. It does not depend on the history budget below -
    // a backfill too large to keep for scrubbing has still been folded whole.
    const observation = prepared.observation;
    if (observation) {
      if (live.start !== live.origin) observation.failed = true;
      while (!observation.failed && observation.liveEvents < live.events.length) this.advanceObservation(observation, live);
    }
    const observed = observation ? { observed: !observation.failed } : {};
    // Atomic against the budget as it stands NOW (ingress kept recording while we prepared): fits whole or is dropped.
    const now = this.accounting();
    if (now.commands + segment.events.length > this.limits.commands || now.commandBytes + prepared.bytes > this.limits.commandBytes
      || now.checkpoints + segment.anchors.length > this.limits.checkpoints || now.snapshotBytes + prepared.snapshotBytes > this.limits.snapshotBytes) {
      liveSet(this, 'noticeValue', () => t('replay.text.earlierHistoryLimitReached'), this);
      return { kind: 'over-budget', ...observed };
    }
    this.segments.splice(this.segments.length - 1, 0, segment);
    this.commandCount += segment.events.length;
    this.commandBytes += prepared.bytes;
    this.backfilledGames.add(prepared.gameId);
    return { kind: 'ok', events: segment.events.length, anchors: segment.anchors.length, ...observed };
  }
  /** The live segment a backfill would sit in front of, or null when a backfill is not possible / already done. */
  private backfillTarget(): Segment | null {
    if (!this.enabled || !this.headValue || this.staleReasonValue) return null;
    // Owner 10-10: the server closes the socket once the game is over. A backfill bound to that FINAL segment is
    // still valid - nothing can be added to the segment any more - so the expected close does not refuse it (the
    // segment / generation / game checks below and in commitBackfill still do). Any other disconnect refuses.
    if (!this.connectionActive && !this.headValue.durableProjection.endGame.finalPresentationReady) return null;
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
    if (last) { last.sealed = true; last.interruption = data('Connection replaced'); }
    liveSet(this, 'staleReasonValue', () => t('replay.text.waitingForAFresh'), this);
  }
  disconnect(generation: number): void {
    if (generation !== this.currentGeneration) return;
    this.connectionActive = false;
    const last = this.segments.at(-1);
    if (last) { last.sealed = true; last.interruption = data('Live feed disconnected'); }
    if (!this.headValue?.durableProjection.endGame.finalPresentationReady) liveSet(this, 'staleReasonValue', () => t('replay.text.liveFeedDisconnected'), this);
  }
  private stale(reason: string): IngressResult {
    this.staleReasonValue = reason;
    const last = this.segments.at(-1);
    if (last) { last.incomplete = true; last.sealed = true; last.interruption = reason; }
    this.notify((observer) => observer.stale?.());
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
            events: [], anchors: [{ checkpoint, bytes: this.headBytes }], turnMarkers: [], origin: cursor.sequence });
          this.enforceLimits();
        }
        this.notify((observer) => observer.snapshot?.(checkpoint));
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
      this.notify((observer) => observer.event(previous, checkpoint, captured));
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
    liveSet(this, 'noticeValue', () => t('replay.text.historyUnavailableMinimumCheckpoint'), this);
  }
  private enforceLimits(): void {
    for (;;) {
      const bytes = this.accounting();
      if (bytes.headBytes > this.limits.activeGraphBytes) { this.disable(); return; }
      if (bytes.commands <= this.limits.commands && bytes.commandBytes <= this.limits.commandBytes
        && bytes.checkpoints <= this.limits.checkpoints && bytes.snapshotBytes <= this.limits.snapshotBytes) return;
      liveSet(this, 'noticeValue', () => t('replay.text.earlierHistoryLimitReached'), this);
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
