import {
  ReplayAutoPlayer,
  REAL_TIME_REPLAY_FALLBACK_MS,
  labelReplayTurnMarkers,
  type ReplaySpeed,
  type ReplayTurnMarker,
} from './replayController';
import { LiveSpectateHistory, type SpectatorSegment } from './liveSpectateHistory';
import { LiveSpectateReview, type SpectatorPresentationAdapter } from './liveSpectateReview';
import { sameSpectatorIdentity, type SpectatorCursor, type SpectatorCheckpoint } from './spectatorCheckpoint';
import type { ReviewControlsBinding } from './reviewControlsBinding';

function positionLabel(checkpoint: SpectatorCheckpoint | null): string {
  if (!checkpoint) return 'Unknown starting position';
  const g = checkpoint.model;
  const side = g.homePlaying ? 'Home' : 'Away';
  const turn = (g.homePlaying ? g.turnDataHome : g.turnDataAway)?.turnNr;
  const half = g.half === 0 ? 'Pre-game' : g.half >= 3 ? 'Overtime' : 'Half ' + g.half;
  const phase = g.turnMode === 'setup' ? ' · Setup' : '';
  return half + ' · ' + side + ' Turn ' + (turn ?? '?') + phase;
}

/** Uses the existing replay speed scheduler while retaining the live-review source
 * at the recorded tail. Only GO TO LIVE switches the presentation source. */
export class LiveSpectateTransport {
  readonly review: LiveSpectateReview;
  private readonly autoPlayer: ReplayAutoPlayer;
  constructor(readonly history: LiveSpectateHistory, adapter: SpectatorPresentationAdapter) {
    this.review = new LiveSpectateReview(history, adapter);
    this.autoPlayer = new ReplayAutoPlayer({
      step: (present) => this.review.stepForward(present),
      nextRealTimeDelayMs: () => this.nextDelay(),
      onState: () => adapter.onChange?.(),
      onError: () => this.review.pausePlayback(),
    });
  }
  get playback() { return this.autoPlayer.state(); }
  controls(): ReviewControlsBinding {
    const visible = this.review.visible;
    const window = this.window;
    const cursor = visible?.cursor.sequence ?? 0;
    const event = visible ? this.history.eventAfter({ ...visible.cursor, sequence: cursor - 1 }) : null;
    const segments = this.history.coverage();
    const head = this.history.head;
    const inLiveSegment = !!visible && !!head && sameSpectatorIdentity(visible.cursor, head.cursor);
    const behind = inLiveSegment ? head!.cursor.sequence - cursor : null;
    const first = window ? this.history.checkpointAt({ ...window.identity, sequence: window.start }) : null;
    // Owner 09-14: the pre-join history's turns are listed the same way as the live ones — every segment, in order,
    // each marker naming its segment so a pick can cross into it.
    const turnMarkers = window ? this.allTurnMarkers() : [];
    return {
      coverageLabel: first ? 'History available from: ' + positionLabel(first) : 'Earlier history limit reached',
      positionLabel: positionLabel(visible),
      turnMarkers,
      liveDistanceLabel: this.history.staleReason ? 'Live feed unavailable — ' + this.history.staleReason
        : !inLiveSegment ? 'Earlier segment — live position beyond a gap'
        : behind === 0 ? 'At live edge — GO TO LIVE to follow' : behind + ' events behind',
      selectedSegment: visible?.cursor.segmentId ?? null,
      segments: segments.map((segment) => ({ id: segment.identity.segmentId,
        label: positionLabel(this.history.checkpointAt({ ...segment.identity, sequence: segment.start }))
          + (segment.interruption ? ' · ' + segment.interruption : ' · Current connection') })),
      selectSegment: (id) => this.selectSegment(id),
      status: { phase: ['paused', 'playing'].includes(this.review.phase) ? 'ready' : this.review.phase,
        cursor, total: this.review.scrubMaximum?.sequence ?? window?.end ?? cursor,
        commandNr: event?.command.commandNr ?? null, failure: this.review.failure ? { message: this.review.failure } : null },
      minimum: window?.start ?? cursor, ...this.playback, pinned: this.review.pinned,
      notice: this.review.pinned ? 'This position is retained outside recent history.' : this.history.notice ?? null,
      canGoLive: !!this.history.head && !this.history.staleReason && this.review.phase !== 'returning',
      play: () => this.play(), pause: () => this.pause(), stepForward: () => this.stepForward(), stepBackward: () => this.stepBackward(),
      turn: (direction) => this.turn(direction), seek: (sequence) => this.seek(sequence), setSpeed: (speed) => this.setSpeed(speed),
      seekTurn: (marker) => this.seekTurn(marker),
      canTurn: (direction) => this.canTurn(direction),
      beginScrub: () => this.beginScrub(), endScrub: () => this.endScrub(), goToLive: () => this.goToLive(),
    };
  }
  get window() {
    const cursor = this.review.visible?.cursor;
    return cursor ? this.history.coverage().find((segment) => sameSpectatorIdentity(segment.identity, cursor)) ?? null : null;
  }
  received(): void { this.review.received(); }
  /** `force` enters review even when the history stopped recording (stale feed hand-off); the position is pinned then. */
  async pauseLive(force = false): Promise<void> { this.autoPlayer.pause(); await this.review.pause(force); }
  play(): boolean {
    if (this.review.source !== 'live-review' || this.review.phase !== 'paused' || this.review.pinned) return false;
    const cursor = this.review.visible?.cursor;
    return !!cursor && !!this.history.eventAfter(cursor) && this.autoPlayer.play();
  }
  pause(): void { this.autoPlayer.pause(); this.review.pausePlayback(); }
  setSpeed(speed: ReplaySpeed): void { this.autoPlayer.setSpeed(speed); }
  async seek(sequence: number): Promise<boolean> {
    this.autoPlayer.pause();
    const cursor = this.review.visible?.cursor;
    if (!cursor || !Number.isSafeInteger(sequence)) return false;
    return this.review.seek({ ...cursor, sequence });
  }
  async selectSegment(id: number): Promise<boolean> {
    this.pause();
    this.endScrub();
    const segment = this.history.coverage().find((item) => item.identity.segmentId === id);
    return segment ? this.review.seek({ ...segment.identity, sequence: segment.start }) : false;
  }
  async stepBackward(): Promise<boolean> {
    const cursor = this.review.visible?.cursor;
    return cursor ? this.seek(cursor.sequence - 1) : false;
  }
  async stepForward(): Promise<boolean> {
    this.pause();
    return this.review.stepForward();
  }
  async turn(direction: -1 | 1): Promise<boolean> {
    const cursor = this.review.visible?.cursor;
    const window = this.window;
    if (!cursor || !window || this.review.pinned) return false;
    const boundaries = [...new Set(this.availableTurnMarkers(window).map((marker) => marker.cursor))];
    const target = direction < 0 ? boundaries.filter((n) => n < cursor.sequence).at(-1)
      : boundaries.find((n) => n > cursor.sequence) ?? (cursor.sequence < window.end ? window.end : undefined);
    if (target !== undefined && target !== cursor.sequence) return this.seek(target);
    // Owner 09-14: past this segment's turns, the step continues into the neighbouring segment (the pre-join history
    // behind the live one, or the live one ahead of it) — the same walk the TURNS list shows.
    const neighbour = this.neighbourSegment(window, direction);
    if (!neighbour) return false;
    const markers = this.availableTurnMarkers(neighbour).map((marker) => marker.cursor);
    const landing = direction < 0 ? (markers.at(-1) ?? neighbour.end) : (markers[0] ?? neighbour.start);
    this.pause();
    this.endScrub();
    return this.review.seek({ ...neighbour.identity, sequence: landing });
  }
  /** Whether Previous/Next turn has somewhere to go — inside this segment or in the neighbouring one (Astra 09-14: the
   *  toolbar greyed the buttons at the segment edge, so the crossing could never be pressed). */
  canTurn(direction: -1 | 1): boolean {
    const cursor = this.review.visible?.cursor;
    const window = this.window;
    if (!cursor || !window || this.review.pinned) return false;
    if (direction < 0 ? cursor.sequence > window.start : cursor.sequence < window.end) return true;
    return !!this.neighbourSegment(window, direction);
  }
  private neighbourSegment(window: SpectatorSegment, direction: -1 | 1): SpectatorSegment | null {
    const segments = this.history.coverage();
    const index = segments.findIndex((segment) => sameSpectatorIdentity(segment.identity, window.identity));
    return index < 0 ? null : segments[index + direction] ?? null;
  }
  /** A TURNS pick: within the visible segment a plain seek; in another segment a cross-segment seek. */
  async seekTurn(marker: ReplayTurnMarker): Promise<boolean> {
    const cursor = this.review.visible?.cursor;
    if (!cursor) return false;
    if (marker.segmentId === undefined || marker.segmentId === cursor.segmentId) return this.seek(marker.cursor);
    this.pause();
    this.endScrub();
    const segment = this.history.coverage().find((item) => item.identity.segmentId === marker.segmentId);
    return segment ? this.review.seek({ ...segment.identity, sequence: marker.cursor }) : false;
  }
  private allTurnMarkers(): ReplayTurnMarker[] {
    const unlabelled: Omit<ReplayTurnMarker, 'label'>[] = [];
    for (const segment of this.history.coverage()) {
      for (const marker of this.scanTurnMarkers(segment)) unlabelled.push({ ...marker, segmentId: segment.identity.segmentId });
    }
    return labelReplayTurnMarkers(unlabelled);
  }
  beginScrub(): SpectatorCursor | null {
    if (this.review.scrubMaximum) return this.review.scrubMaximum;
    this.pause(); return this.review.beginScrub();
  }
  endScrub(): void { this.review.endScrub(); }
  async goToLive(): Promise<boolean> { this.autoPlayer.pause(); return this.review.goToLive(); }
  dispose(): void { this.autoPlayer.dispose(); this.review.dispose(); }
  private availableTurnMarkers(window: NonNullable<LiveSpectateTransport['window']>): ReplayTurnMarker[] {
    return labelReplayTurnMarkers(this.scanTurnMarkers(window));
  }
  /** The boundaries the history recorded at admission/preparation, inside the segment's current coverage. */
  private scanTurnMarkers(window: NonNullable<LiveSpectateTransport['window']>): Omit<ReplayTurnMarker, 'label'>[] {
    return window.turnMarkers.filter((marker) => marker.cursor >= window.start && marker.cursor <= window.end);
  }
  private nextDelay(): number {
    const cursor = this.review.visible?.cursor;
    if (!cursor) return REAL_TIME_REPLAY_FALLBACK_MS;
    const next = this.history.eventAfter(cursor);
    const previous = this.history.eventAfter({ ...cursor, sequence: cursor.sequence - 1 });
    return next && previous ? Math.max(0, next.receivedMonotonicAt - previous.receivedMonotonicAt) : REAL_TIME_REPLAY_FALLBACK_MS;
  }
}
