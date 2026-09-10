export interface ReplayCommand {
  commandNr: number;
  netCommandId: string;
  [key: string]: unknown;
}

/** Capability boundary used by the one gameplay sender. */
export function replayAllowsGameCommand(replayActive: boolean): boolean {
  return !replayActive;
}

export interface ReplayChunk {
  commands: readonly ReplayCommand[];
  totalNrOfCommands: number;
  lastCommand: boolean;
}

export const MAX_REPLAY_COMMANDS = 100_000;
export const MAX_REPLAY_KEYFRAMES = 512;
export const MAX_REPLAY_COMMAND_BYTES = 64 * 1024 * 1024;
export const MAX_REPLAY_SNAPSHOT_BYTES = 256 * 1024 * 1024;

/** Exact `ClientReplayer._TIMER_SETTINGS`; indices 0-1 retain upstream single-speed presentation. */
export const REPLAY_TIMER_SETTINGS = [800, 400, 200, 100, 50, 25, 10] as const;
export const REAL_TIME_REPLAY_SPEED = 7 as const;
export const REAL_TIME_REPLAY_MAX_GAP_MS = 2_000;
export const REAL_TIME_REPLAY_FALLBACK_MS = REPLAY_TIMER_SETTINGS[1];
export const REPLAY_SPEED_LABELS = ['0.5×', '1×', '2×', '4×', '8×', '16×', '40×', 'Real time'] as const;
export type ReplaySpeedIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type ReplaySpeed = ReplaySpeedIndex | typeof REAL_TIME_REPLAY_SPEED;

export interface ReplayAutoPlayerState {
  playing: boolean;
  speed: ReplaySpeed;
}

export interface ReplayAutoPlayerOptions {
  step(present: boolean): Promise<boolean>;
  onState?(state: Readonly<ReplayAutoPlayerState>): void;
  onError?(error: unknown): void;
  /** Delay from the command immediately before the cursor to the command at the cursor. */
  nextRealTimeDelayMs?(): number;
  now?(): number;
  schedule?(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  cancel?(timer: ReturnType<typeof setTimeout>): void;
}

/** Serial automatic replay driver. It never overlaps commands or owns game state. */
export class ReplayAutoPlayer {
  private playing = false;
  private speed: ReplaySpeed = REAL_TIME_REPLAY_SPEED;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private realTimeDeadlineMs: number | null = null;
  private generation = 0;
  private stepping = false;
  private disposed = false;
  private readonly scheduleTimer: NonNullable<ReplayAutoPlayerOptions['schedule']>;
  private readonly cancelTimer: NonNullable<ReplayAutoPlayerOptions['cancel']>;
  private readonly now: NonNullable<ReplayAutoPlayerOptions['now']>;

  constructor(private readonly options: ReplayAutoPlayerOptions) {
    this.scheduleTimer = options.schedule ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.cancelTimer = options.cancel ?? ((timer) => globalThis.clearTimeout(timer));
    this.now = options.now ?? (() => Date.now());
  }

  state(): Readonly<ReplayAutoPlayerState> { return { playing: this.playing, speed: this.speed }; }

  play(): boolean {
    if (this.disposed || this.playing) return false;
    this.playing = true;
    this.generation += 1;
    this.realTimeDeadlineMs = this.speed === REAL_TIME_REPLAY_SPEED ? this.now() : null;
    this.emit();
    if (!this.stepping) this.arm(this.generation);
    return true;
  }

  pause(): boolean {
    if (!this.playing) return false;
    this.playing = false;
    this.generation += 1;
    this.clearTimer();
    this.realTimeDeadlineMs = null;
    this.emit();
    return true;
  }

  setSpeed(speed: ReplaySpeed): void {
    if (!Number.isInteger(speed) || speed < 0 || speed > REAL_TIME_REPLAY_SPEED) {
      throw new ReplayFailure('invalid-speed', `Replay speed index ${speed} is outside 0..${REAL_TIME_REPLAY_SPEED}.`);
    }
    if (this.speed === speed) return;
    this.speed = speed;
    this.realTimeDeadlineMs = speed === REAL_TIME_REPLAY_SPEED ? this.now() : null;
    if (this.playing && !this.stepping) {
      this.generation += 1;
      this.clearTimer();
      this.arm(this.generation);
    }
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.playing = false;
    this.generation += 1;
    this.clearTimer();
    this.realTimeDeadlineMs = null;
    this.emit();
  }

  private arm(generation: number): void {
    if (!this.playing || this.disposed || this.timer || this.stepping) return;
    const delayMs = this.speed === REAL_TIME_REPLAY_SPEED
      ? this.nextRealTimeDelay()
      : REPLAY_TIMER_SETTINGS[this.speed];
    this.timer = this.scheduleTimer(() => {
      this.timer = null;
      void this.tick(generation);
    }, delayMs);
  }

  private nextRealTimeDelay(): number {
    const recordedDelay = this.options.nextRealTimeDelayMs?.() ?? REAL_TIME_REPLAY_FALLBACK_MS;
    const boundedDelay = Number.isFinite(recordedDelay)
      ? Math.max(0, Math.min(REAL_TIME_REPLAY_MAX_GAP_MS, recordedDelay))
      : REAL_TIME_REPLAY_FALLBACK_MS;
    this.realTimeDeadlineMs = (this.realTimeDeadlineMs ?? this.now()) + boundedDelay;
    return Math.max(0, this.realTimeDeadlineMs - this.now());
  }

  private async tick(generation: number): Promise<void> {
    if (!this.playing || this.disposed || generation !== this.generation || this.stepping) return;
    this.stepping = true;
    try {
      const advanced = await this.options.step(this.speed <= 1 || this.speed === REAL_TIME_REPLAY_SPEED);
      if (generation !== this.generation || this.disposed) return;
      if (!advanced) {
        this.playing = false;
        this.generation += 1;
        this.emit();
      }
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.playing = false;
      this.generation += 1;
      this.emit();
      this.options.onError?.(error);
    } finally {
      this.stepping = false;
      if (this.playing && !this.disposed) this.arm(this.generation);
    }
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.cancelTimer(this.timer);
    this.timer = null;
  }

  private emit(): void { this.options.onState?.(this.state()); }
}

export interface ReplayPresentationWaitOptions {
  flushView(): Promise<void>;
  isCurrent(): boolean;
  isIdle(): boolean;
  now(): number;
  waitFrame(): Promise<void>;
  timeoutMs: number;
  onTimeout?(): void;
}

/** Waits for both store- and renderer-owned presentation work before advancing a replay cursor. */
export async function waitUntilReplayPresentationIdle(
  options: ReplayPresentationWaitOptions,
): Promise<'idle' | 'cancelled' | 'timeout'> {
  await options.flushView();
  const started = options.now();
  while (options.isCurrent()) {
    if (options.isIdle()) return 'idle';
    if (options.now() - started >= options.timeoutMs) {
      options.onTimeout?.();
      return 'timeout';
    }
    await options.waitFrame();
  }
  return 'cancelled';
}

export type ReplayFailureCode =
  | 'duplicate-command'
  | 'out-of-order-command'
  | 'count-mismatch'
  | 'late-chunk'
  | 'unsupported-command'
  | 'memory-budget'
  | 'invalid-speed'
  | 'invalid-cursor'
  | 'not-ready';

export class ReplayFailure extends Error {
  constructor(
    readonly code: ReplayFailureCode,
    message: string,
    readonly command: ReplayCommand | null = null,
  ) {
    super(message);
    this.name = 'ReplayFailure';
  }
}

/** Collects upstream SERVER_REPLAY chunks without treating commandNr as an array index. */
export class ReplayChunkAssembler {
  private readonly commands = new Map<number, ReplayCommand>();
  private expectedTotal: number | null = null;
  private sealed = false;
  private commandBytes = 0;

  add(chunk: ReplayChunk): readonly ReplayCommand[] | null {
    if (this.sealed) throw new ReplayFailure('late-chunk', 'Replay data arrived after the terminal chunk.');
    if (!Number.isInteger(chunk.totalNrOfCommands) || chunk.totalNrOfCommands < 0) {
      throw new ReplayFailure('count-mismatch', 'Replay total must be a non-negative integer.');
    }
    if (chunk.totalNrOfCommands > MAX_REPLAY_COMMANDS) {
      throw new ReplayFailure('memory-budget', `Replay exceeds the ${MAX_REPLAY_COMMANDS}-command limit.`);
    }
    if (this.expectedTotal !== null && this.expectedTotal !== chunk.totalNrOfCommands) {
      throw new ReplayFailure('count-mismatch', 'Replay chunks disagree on the total command count.');
    }
    this.expectedTotal = chunk.totalNrOfCommands;

    for (const command of chunk.commands) {
      if (!Number.isInteger(command.commandNr)) {
        throw new ReplayFailure('out-of-order-command', 'A replay command has no integer commandNr.', command);
      }
      if (this.commands.has(command.commandNr)) {
        throw new ReplayFailure('duplicate-command', `Replay command ${command.commandNr} was received twice.`, command);
      }
      this.commandBytes += JSON.stringify(command).length * 2;
      if (this.commandBytes > MAX_REPLAY_COMMAND_BYTES) {
        throw new ReplayFailure('memory-budget', 'Replay command stream exceeds the 64 MB retained-data limit.', command);
      }
      this.commands.set(command.commandNr, structuredClone(command));
    }

    if (!chunk.lastCommand) return null;
    this.sealed = true;
    if (this.commands.size !== this.expectedTotal) {
      throw new ReplayFailure(
        'count-mismatch',
        `Replay declared ${this.expectedTotal} commands but supplied ${this.commands.size}.`,
      );
    }
    return [...this.commands.values()].sort((left, right) => left.commandNr - right.commandNr);
  }
}

export interface ReplayAdapter<State> {
  initialState(): State;
  cloneState(state: Readonly<State>): State;
  /** Deterministic model fold. This function must not present or read wall-clock/random state. */
  apply(state: State, command: Readonly<ReplayCommand>): void;
  supports(command: Readonly<ReplayCommand>): boolean;
  isTurnEnd(command: Readonly<ReplayCommand>): boolean;
  /** Reads the recorded turn identity from a folded model for direct navigation labels. */
  turnPosition?(state: Readonly<State>): ReplayTurnPosition | null;
  /** Presents one forward command through the existing spectator pipeline. */
  present(
    command: Readonly<ReplayCommand>,
    expectedState: Readonly<State>,
    inputEnded: boolean,
  ): Promise<void>;
  /** Runs deterministic receive-side projection while suppressing timed presentation at upstream fast speeds. */
  projectCollapsed?(
    command: Readonly<ReplayCommand>,
    expectedState: Readonly<State>,
    inputEnded: boolean,
  ): void;
  /** Rebuilds receive-side projection for a silently folded seek cursor. */
  projectSeek?(
    commands: readonly Readonly<ReplayCommand>[],
    expectedState: Readonly<State>,
    inputEnded: boolean,
  ): void;
  /** Cancels every transient from a prior navigation epoch. */
  resetPresentation(epoch: number): void;
  /** Replaces the visible model once after prepare/seek. */
  renderOnce(state: Readonly<State>, cursor: number): void;
  /** Conservative retained-size estimate used to cap turn snapshots. */
  estimateStateBytes?(state: Readonly<State>): number;
}

export interface ReplayKeyframe<State> {
  cursor: number;
  commandNr: number | null;
  kind: 'initial' | 'turn';
  state: State;
}

export interface ReplayTurnPosition {
  side: 'H' | 'A';
  turn: number;
  half: number;
}

export interface ReplayTurnMarker extends ReplayTurnPosition {
  cursor: number;
  boundary: 'start' | 'finish';
  label: string;
}

type UnlabelledReplayTurnMarker = Omit<ReplayTurnMarker, 'label'>;

export function sameReplayTurnPosition(
  left: ReplayTurnPosition | null,
  right: ReplayTurnPosition | null,
): boolean {
  return !!left && !!right && left.side === right.side && left.turn === right.turn && left.half === right.half;
}

/** Adds half only when the same side/turn number occurs in more than one retained half. */
export function labelReplayTurnMarkers(markers: readonly UnlabelledReplayTurnMarker[]): ReplayTurnMarker[] {
  const halves = new Map<string, Set<number>>();
  for (const marker of markers) {
    const key = `${marker.side}:${marker.turn}`;
    const values = halves.get(key) ?? new Set<number>();
    values.add(marker.half);
    halves.set(key, values);
  }
  return markers.map((marker) => {
    const ambiguousHalf = (halves.get(`${marker.side}:${marker.turn}`)?.size ?? 0) > 1;
    const half = marker.half === 0 ? 'Pre-game' : marker.half >= 3 ? 'Overtime' : `Half ${marker.half}`;
    return {
      ...marker,
      label: `(${marker.side}) Turn ${marker.turn} — ${marker.boundary === 'start' ? 'Start' : 'Finish'}${ambiguousHalf ? ` · ${half}` : ''}`,
    };
  });
}

/** Fully validated/indexed replay state whose ownership can move into a live controller. */
export interface PreparedReplay<State> {
  readonly commands: readonly ReplayCommand[];
  readonly keyframes: readonly ReplayKeyframe<State>[];
  readonly turns: readonly number[];
  readonly turnMarkers: readonly ReplayTurnMarker[];
  readonly current: State;
}

export interface ReplayStatus {
  phase: 'empty' | 'indexing' | 'ready' | 'presenting' | 'seeking' | 'failed';
  cursor: number;
  total: number;
  commandNr: number | null;
  epoch: number;
  turnBoundaries: readonly number[];
  turnMarkers: readonly ReplayTurnMarker[];
  failure: ReplayFailure | null;
}

/**
 * Returns the authoritative elapsed server time between adjacent replay commands.
 * `gameTime` is carried by replayable model-sync commands and is never inferred from
 * formatted log output. Missing or regressing clocks fail soft to upstream's 1× tick.
 */
export function recordedReplayDelayMs(
  previous: Readonly<ReplayCommand> | null,
  next: Readonly<ReplayCommand> | null,
): number {
  if (!next) return 0;
  if (!previous) return 0;
  const previousTime = previous.gameTime;
  const nextTime = next.gameTime;
  if (typeof previousTime !== 'number' || typeof nextTime !== 'number'
    || !Number.isFinite(previousTime) || !Number.isFinite(nextTime)
    || previousTime < 0 || nextTime < previousTime) {
    return REAL_TIME_REPLAY_FALLBACK_MS;
  }
  return Math.min(nextTime - previousTime, REAL_TIME_REPLAY_MAX_GAP_MS);
}

export class ReplayController<State> {
  private commands: readonly ReplayCommand[] = [];
  private current: State | null = null;
  private keyframes: readonly ReplayKeyframe<State>[] = [];
  private turns: readonly number[] = [0];
  private turnMarkers: readonly ReplayTurnMarker[] = [];
  private disposed = false;
  private cancelPresentation: (() => void) | null = null;
  private statusValue: ReplayStatus = {
    phase: 'empty', cursor: 0, total: 0, commandNr: null, epoch: 0, turnBoundaries: [0], turnMarkers: [], failure: null,
  };
  /** Owner 08-17 ("Replayer crashes when ran at 40x"): wall-clock stamp of the last collapsed-forward
   *  renderOnce push. At 40x (REPLAY_TIMER_SETTINGS[6] = 10ms) commandForwardWithoutPresentation fires up
   *  to ~100x/sec; renderOnce drives a full scene teardown+rebuild on the Pixi side (the same per-model-
   *  sync allocation class packages/ffb-pitch/src/renderer.ts's refresh() was fixed for live walks under
   *  W20 — "838MB heap after ~20min" at a MUCH lower call rate than 40x replay hits). Every OTHER rung of
   *  the ladder (25ms/50ms/100ms/…) already sits at or above one frame, so throttling only engages at the
   *  fastest step — exactly the one the owner reported crashing. The model/status still advance on every
   *  command; only the expensive redraw is capped, and the terminal command always renders regardless.
   *  See commandForwardWithoutPresentation() below for the gate. */
  private lastCollapsedRenderAt = Number.NEGATIVE_INFINITY;
  private static readonly COLLAPSED_RENDER_MIN_GAP_MS = 16;

  constructor(
    private readonly adapter: ReplayAdapter<State>,
    private readonly onStatus: (status: Readonly<ReplayStatus>) => void = () => undefined,
  ) {}

  status(): Readonly<ReplayStatus> { return this.statusValue; }
  state(): Readonly<State> | null { return this.current; }
  snapshots(): readonly ReplayKeyframe<State>[] { return this.keyframes; }

  /** Delay for the command currently under the forward cursor. */
  nextRealTimeDelayMs(): number {
    const cursor = this.statusValue.cursor;
    return recordedReplayDelayMs(
      cursor > 0 ? this.commands[cursor - 1] ?? null : null,
      this.commands[cursor] ?? null,
    );
  }

  /** Transfers a detached preflight index without retaining a second snapshot graph. */
  releasePrepared(): PreparedReplay<State> {
    this.requireReady();
    const prepared = {
      commands: this.commands,
      keyframes: this.keyframes,
      turns: this.turns,
      turnMarkers: this.turnMarkers,
      current: this.current!,
    };
    this.commands = [];
    this.keyframes = [];
    this.turns = [0];
    this.turnMarkers = [];
    this.current = null;
    this.disposed = true;
    return prepared;
  }

  /** Activates an index produced by releasePrepared() under this controller's presentation adapter. */
  adoptPrepared(prepared: PreparedReplay<State>): void {
    if (this.disposed) throw new ReplayFailure('not-ready', 'Replay controller is disposed.');
    if (this.statusValue.phase !== 'empty' || this.current) {
      throw new ReplayFailure('not-ready', 'Replay controller already owns a replay.');
    }
    this.commands = prepared.commands;
    this.keyframes = prepared.keyframes;
    this.turns = prepared.turns;
    this.turnMarkers = prepared.turnMarkers;
    this.current = prepared.current;
    const epoch = this.statusValue.epoch + 1;
    this.adapter.resetPresentation(epoch);
    this.adapter.renderOnce(this.current, 0);
    this.replaceStatus({
      phase: 'ready', cursor: 0, total: this.commands.length, commandNr: null,
      epoch, turnBoundaries: this.turns, turnMarkers: this.turnMarkers, failure: null,
    });
  }

  /** Cancels an in-flight presentation and permanently retires this session controller. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPresentation?.();
    this.cancelPresentation = null;
    this.adapter.resetPresentation(this.statusValue.epoch + 1);
  }

  /** Silently folds the entire stream to index turn keyframes, then returns to command zero. */
  prepare(commands: readonly ReplayCommand[]): void {
    if (this.disposed) throw new ReplayFailure('not-ready', 'Replay controller is disposed.');
    this.update({ phase: 'indexing', total: commands.length, failure: null });
    try {
      this.validate(commands);
      this.commands = commands.map((command) => structuredClone(command));
      let working = this.adapter.initialState();
      let snapshotBytes = 0;
      const snapshot = (state: Readonly<State>): State => {
        const clone = this.adapter.cloneState(state);
        snapshotBytes += Math.max(0, this.adapter.estimateStateBytes?.(clone) ?? 0);
        if (snapshotBytes > MAX_REPLAY_SNAPSHOT_BYTES) {
          throw new ReplayFailure('memory-budget', 'Replay turn snapshots exceed the 256 MB retained-data limit.');
        }
        return clone;
      };
      const keyframes: ReplayKeyframe<State>[] = [
        { cursor: 0, commandNr: null, kind: 'initial', state: snapshot(working) },
      ];
      const turns = [0];
      const turnMarkers: UnlabelledReplayTurnMarker[] = [];
      this.commands.forEach((command, index) => {
        const beforeTurn = this.adapter.turnPosition?.(working) ?? null;
        this.adapter.apply(working, command);
        const cursor = index + 1;
        if (this.adapter.isTurnEnd(command)) {
          if (keyframes.length >= MAX_REPLAY_KEYFRAMES) {
            throw new ReplayFailure('memory-budget', `Replay exceeds the ${MAX_REPLAY_KEYFRAMES}-keyframe limit.`, command);
          }
          turns.push(cursor);
          if (beforeTurn) turnMarkers.push({ ...beforeTurn, cursor, boundary: 'finish' });
          const afterTurn = this.adapter.turnPosition?.(working) ?? null;
          if (afterTurn && !sameReplayTurnPosition(beforeTurn, afterTurn)) {
            turnMarkers.push({ ...afterTurn, cursor, boundary: 'start' });
          }
          keyframes.push({
            cursor,
            commandNr: command.commandNr,
            kind: 'turn',
            state: snapshot(working),
          });
        }
      });
      this.keyframes = keyframes;
      this.turns = [...new Set(turns)].sort((left, right) => left - right);
      this.turnMarkers = labelReplayTurnMarkers(turnMarkers);
      this.current = this.adapter.cloneState(keyframes[0]!.state);
      const epoch = this.statusValue.epoch + 1;
      this.adapter.resetPresentation(epoch);
      this.adapter.renderOnce(this.current, 0);
      this.replaceStatus({
        phase: 'ready', cursor: 0, total: this.commands.length, commandNr: null,
        epoch, turnBoundaries: this.turns, turnMarkers: this.turnMarkers, failure: null,
      });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async commandForward(): Promise<boolean> {
    this.requireReady();
    if (this.statusValue.cursor >= this.commands.length) return false;
    const command = this.commands[this.statusValue.cursor]!;
    try {
      const next = this.adapter.cloneState(this.current!);
      this.adapter.apply(next, command);
      this.update({ phase: 'presenting' });
      const inputEnded = this.statusValue.cursor + 1 === this.commands.length;
      const presented = this.adapter.present(command, next, inputEnded).then(() => true);
      const cancelled = new Promise<false>((resolve) => {
        this.cancelPresentation = () => resolve(false);
      });
      const completed = await Promise.race([presented, cancelled]);
      this.cancelPresentation = null;
      if (!completed || this.disposed) return false;
      this.current = next;
      this.commitCursor(this.statusValue.cursor + 1);
      return true;
    } catch (error) {
      this.cancelPresentation = null;
      if (this.disposed) return false;
      this.fail(error);
      throw error;
    }
  }

  /** Mirrors upstream fast replay: apply one command and refresh without timed presentation. */
  commandForwardWithoutPresentation(): boolean {
    this.requireReady();
    if (this.statusValue.cursor >= this.commands.length) return false;
    const command = this.commands[this.statusValue.cursor]!;
    try {
      const next = this.adapter.cloneState(this.current!);
      this.adapter.apply(next, command);
      const inputEnded = this.statusValue.cursor + 1 === this.commands.length;
      this.adapter.projectCollapsed?.(command, next, inputEnded);
      this.current = next;
      this.commitCursor(this.statusValue.cursor + 1);
      // Cap the visual push, never the fold: skip only when a very recent collapsed step already
      // rendered AND this isn't the last command in the stream (that one always renders).
      const now = Date.now();
      if (inputEnded || now - this.lastCollapsedRenderAt >= ReplayController.COLLAPSED_RENDER_MIN_GAP_MS) {
        this.lastCollapsedRenderAt = now;
        this.adapter.renderOnce(next, this.statusValue.cursor);
      }
      return true;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  commandBackward(): boolean {
    this.requireReady();
    if (this.statusValue.cursor === 0) return false;
    this.seek(this.statusValue.cursor - 1);
    return true;
  }

  turnForward(): boolean {
    this.requireReady();
    const target = this.turns.find((cursor) => cursor > this.statusValue.cursor) ?? this.commands.length;
    if (target === this.statusValue.cursor) return false;
    this.seek(target);
    return true;
  }

  turnBackward(): boolean {
    this.requireReady();
    const prior = this.turns.filter((cursor) => cursor < this.statusValue.cursor);
    const target = prior[prior.length - 1] ?? 0;
    if (target === this.statusValue.cursor) return false;
    this.seek(target);
    return true;
  }

  seek(target: number): void {
    this.requireReady();
    this.assertCursor(target);
    const epoch = this.statusValue.epoch + 1;
    this.adapter.resetPresentation(epoch);
    this.update({ phase: 'seeking', epoch });
    try {
      const keyframe = this.nearestKeyframe(target);
      const working = this.adapter.cloneState(keyframe.state);
      for (let index = keyframe.cursor; index < target; index += 1) {
        this.adapter.apply(working, this.commands[index]!);
      }
      this.adapter.projectSeek?.(
        this.commands.slice(0, target),
        working,
        target === this.commands.length,
      );
      this.current = working;
      this.commitCursor(target);
      this.adapter.renderOnce(working, target);
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  private validate(commands: readonly ReplayCommand[]): void {
    let prior = Number.NEGATIVE_INFINITY;
    for (const command of commands) {
      if (!Number.isInteger(command.commandNr) || command.commandNr <= prior) {
        throw new ReplayFailure('out-of-order-command', 'Replay command numbers must be strictly increasing.', command);
      }
      if (!this.adapter.supports(command)) {
        throw new ReplayFailure('unsupported-command', `Unsupported replay command ${command.netCommandId}.`, command);
      }
      prior = command.commandNr;
    }
  }

  private nearestKeyframe(target: number): ReplayKeyframe<State> {
    let selected = this.keyframes[0]!;
    for (const keyframe of this.keyframes) {
      if (keyframe.cursor > target) break;
      selected = keyframe;
    }
    return selected;
  }

  private commitCursor(cursor: number): void {
    this.replaceStatus({
      ...this.statusValue,
      phase: 'ready',
      cursor,
      commandNr: cursor === 0 ? null : this.commands[cursor - 1]!.commandNr,
    });
  }

  private assertCursor(cursor: number): void {
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > this.commands.length) {
      throw new ReplayFailure('invalid-cursor', `Replay cursor ${cursor} is outside 0..${this.commands.length}.`);
    }
  }

  private requireReady(): void {
    if (this.disposed) throw new ReplayFailure('not-ready', 'Replay controller is disposed.');
    if (this.statusValue.phase !== 'ready' || !this.current) {
      throw new ReplayFailure('not-ready', `Replay is ${this.statusValue.phase}, not ready.`);
    }
  }

  private fail(error: unknown): void {
    const failure = error instanceof ReplayFailure
      ? error
      : new ReplayFailure('unsupported-command', error instanceof Error ? error.message : String(error));
    this.update({ phase: 'failed', failure });
  }

  private update(patch: Partial<ReplayStatus>): void {
    this.replaceStatus({ ...this.statusValue, ...patch });
  }

  private replaceStatus(status: ReplayStatus): void {
    this.statusValue = status;
    this.onStatus(status);
  }
}
