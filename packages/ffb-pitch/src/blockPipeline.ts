import { presentationMs } from './presentationTiming';

/**
 * BLOCK-RESOLUTION PIPELINE — generic sequential stage driver.
 *
 * The block→push→armour→injury→turnover read is a strict P1 chain (see
 * docs/event-priority.md Phase D). This is the framework-agnostic runner that owns
 * "what plays next" for that chain. It has NO store/renderer/Vue imports so it is
 * unit-testable in isolation.
 *
 * TWO-SIGNAL STAGE CONTRACT (docs/injury-pacing-review.md §6a — owner-reviewed):
 * each stage exposes two independent moments —
 *   • READ   — the moment the stage's MEANING has landed (dice settled + choice
 *              glowed, arrow shown, indicator displayed). This OPENS THE NEXT
 *              STAGE'S GATE — it is the event-priority "Gate" column. `minMs` floors
 *              it. A stage reads either on a timer (`readMs`) or when it calls the
 *              injected `signalRead()` (dynamic — e.g. a move tween end).
 *   • TEARDOWN — when the stage's pixels finish (`holdMs` after read). Scheduled by
 *              the driver; it MAY TRAIL into and overlap later stages and NEVER
 *              gates the next stage. This preserves the deliberate overlap the
 *              current pacing is built on (push lands ~1400ms INTO the dice cine;
 *              the injury starts ~900ms BEFORE the dice fade).
 *
 * A driver where "done" meant "fully torn down" would strictly serialize the chain
 * and visibly slow it — this contract keeps the reads gated while the pixels linger.
 */

export type PipelineTier = 'P0' | 'P1' | 'P2' | 'P3';

type TimerHandle = unknown;

/** One stage of a pipeline run. */
export interface StageSpec {
  name: string;
  tier: PipelineTier;
  /** When present and it returns false, the stage is SKIPPED (no timers, no start).
   *  Evaluated at the moment the stage would begin. Absent ⇒ always runs. */
  canStart?: () => boolean;
  /** Kick off the stage's visuals. Called once when the stage begins. */
  start?: () => void;
  /** Floor: the stage may not READ before `minMs` after start (default 0). */
  minMs?: number;
  /** If set, the stage auto-signals READ at `readMs` after start. If omitted, the
   *  stage MUST call the injected `signalRead()` to advance. `minMs` still floors. */
  readMs?: number;
  /** Teardown lifetime: `holdMs` after READ the pixels finish and `teardown()` runs
   *  (default 0 ⇒ teardown at the read moment). Teardown never gates the next stage. */
  holdMs?: number;
  /** Optional cleanup fired at teardown (`holdMs` after read). */
  teardown?: () => void;
  /** Optional: receives the injected `signalRead` so a dynamic stage (no `readMs`)
   *  can advance the pipeline when its own async work (a tween) completes. */
  onStart?: (signalRead: () => void) => void;
}

export interface PipelineHooks {
  /** The SINGLE holdPlayback point (docs/injury-pacing-review.md §6a rule 3). Called
   *  with the read-window ms when a P1 stage begins, so the spectator drain is held
   *  for exactly one owner instead of per-stage. No-op-able (play mode passes none). */
  hold?: (ms: number) => void;
  /** Injectable clock + scheduler for deterministic tests. Default: real timers. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (h: TimerHandle) => void;
  /** Fired whenever the pipeline transitions from busy → idle (all reads done AND
   *  all teardowns elapsed). F1 endGame settle consumes `idle()` (§6a rule 2). */
  onIdle?: () => void;
}

interface ActiveStage {
  spec: StageSpec;
  startedAt: number;
  /** true once this stage has signalled read (timer or external). */
  read: boolean;
  /** timers owned by this stage, cleared on reset. */
  timers: TimerHandle[];
}

interface Run {
  stages: StageSpec[];
  index: number;
}

/**
 * A pipeline instance owns a QUEUE of runs (frenzy → a second run queues behind the
 * first, replacing the old blockCineQueue). Within a run, stages advance strictly:
 * stage N+1 may not begin until stage N has READ and its `minMs` elapsed.
 */
export class BlockPipeline {
  private hooks: Required<Pick<PipelineHooks, 'now' | 'setTimer' | 'clearTimer'>> &
    Pick<PipelineHooks, 'hold' | 'onIdle'>;
  private runQueue: Run[] = [];
  private active: ActiveStage | null = null;
  private currentRun: Run | null = null;
  /** teardown timers still pending — they keep the pipeline non-idle so endGame
   *  settle waits for the pixels, but they do NOT gate the next stage. */
  private pendingTeardowns = new Set<TimerHandle>();
  /** block-resolution callbacks still pending — reset drops the in-flight run. */
  private pendingResolved = new Set<TimerHandle>();
  /** Phase 2: the block-cine end wall-clock (synced by the store) + how far before
   *  the dice fade a block-resolution beat lands. Drives resolveDelay(). */
  private cineUntil = 0;

  constructor(hooks: PipelineHooks = {}) {
    this.hooks = {
      now: hooks.now ?? (() => Date.now()),
      setTimer: hooks.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: hooks.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
      hold: hooks.hold,
      onIdle: hooks.onIdle,
    };
  }

  /** Enqueue a run. Starts immediately when the pipeline is idle, otherwise queues
   *  behind the in-flight run (frenzy's second block). */
  run(stages: StageSpec[]): void {
    this.runQueue.push({ stages: stages.slice(), index: 0 });
    if (!this.currentRun) this.advance();
  }

  /** True when nothing is playing and nothing is queued and no teardown is pending. */
  idle(): boolean {
    return !this.currentRun && this.runQueue.length === 0 && this.pendingTeardowns.size === 0;
  }

  /** The name of the stage currently reading (for diagnostics/tests). */
  activeStageName(): string | null {
    return this.active?.spec.name ?? null;
  }

  /** Signal that the CURRENT stage has read (for `readMs`-less dynamic stages). A
   *  stale or mismatched signal is ignored. Optionally assert the stage name. */
  signalRead(stageName?: string): void {
    if (!this.active) return;
    if (stageName && this.active.spec.name !== stageName) return;
    this.onRead(this.active);
  }

  /** Hard reset — clears all runs, the active stage, and pending teardowns. Called on
   *  game change so a stale run can't gate the next game's frames. */
  reset(): void {
    if (this.active) {
      for (const t of this.active.timers) this.hooks.clearTimer(t);
    }
    for (const t of this.pendingTeardowns) this.hooks.clearTimer(t);
    this.pendingTeardowns.clear();
    for (const t of this.pendingResolved) this.hooks.clearTimer(t);
    this.pendingResolved.clear();
    this.active = null;
    this.currentRun = null;
    this.runQueue.length = 0;
    this.cineUntil = 0;
  }

  // ---- block-resolution pacing (Phase 2) ---------------------------------------
  // FUMBBL sends RESOLUTION-COMPLETE frames, so a block's push / follow / injury /
  // knockdown all arrive with the dice roll. Each beat holds until ~resolveLeadMs
  // before the dice fade so the roll reads FIRST. The driver owns that anchor,
  // schedules the beats, and is the SINGLE holdPlayback caller for the block chain.

  /** Sync the block-cine end wall-clock — called whenever the store (re)starts a
   *  cine (and 0 on game change via reset()). */
  setBlockCineUntil(t: number): void {
    this.cineUntil = t;
  }

  /** ms from now until a block-resolution beat should fire (0 = fire now). Identical
   *  to the former free `blockResolveDelay()`: cineUntil − now − resolveLeadMs. Used by
   *  the push arrow / follow indicator, which intentionally land WHILE the dice show. */
  resolveDelay(): number {
    const remaining = this.cineUntil - this.hooks.now();
    return remaining > 0 ? Math.max(0, remaining - PIPELINE_TIMINGS.push.resolveAnchorMs) : 0;
  }

  /** ms until the block cine's dice FINISH displaying (0 = already faded). The INJURY
   *  result waits for THIS (not `resolveDelay`) so it never overlaps the roll — owner
   *  2026-07-06: "injuries were playing before the block cine finishes". */
  cineRemaining(): number {
    return Math.max(0, this.cineUntil - this.hooks.now());
  }

  /** Schedule a block-resolution beat at resolveDelay() + extraMs (fires SYNCHRONOUSLY
   *  when ≤0, matching the old inline setTimeout/else). When `holdMs` is given, hold
   *  the spectator drain for delay + holdMs (the single holdPlayback point). */
  scheduleResolved(fn: () => void, extraMs = 0, holdMs?: number): void {
    const delay = this.resolveDelay() + extraMs;
    if (holdMs !== undefined && this.hooks.hold) this.hooks.hold(delay + holdMs);
    if (delay > 0) {
      let handle: TimerHandle;
      handle = this.hooks.setTimer(() => {
        this.pendingResolved.delete(handle);
        fn();
      }, delay);
      this.pendingResolved.add(handle);
    } else fn();
  }

  // ---- internals ---------------------------------------------------------------

  /** Begin the next stage in the current run, skipping ahead over stages whose
   *  canStart() is false; when the run is exhausted, move to the next queued run. */
  private advance(): void {
    // Finish the current run if it's exhausted.
    while (true) {
      if (!this.currentRun) {
        const next = this.runQueue.shift();
        if (!next) {
          this.maybeIdle();
          return;
        }
        this.currentRun = next;
      }
      const run = this.currentRun;
      if (run.index >= run.stages.length) {
        this.currentRun = null;
        continue; // pull the next queued run
      }
      const spec = run.stages[run.index++];
      if (!spec) { this.currentRun = null; continue; }
      if (spec.canStart && !spec.canStart()) continue; // SKIP — no timers, no start
      this.begin(spec);
      return;
    }
  }

  private begin(spec: StageSpec): void {
    const startedAt = this.hooks.now();
    const stage: ActiveStage = { spec, startedAt, read: false, timers: [] };
    this.active = stage;

    // Single hold point: hold the drain for this stage's read window (P1 only —
    // P2/P3 stages inform but do not hold).
    if (this.hooks.hold && spec.tier === 'P1') {
      this.hooks.hold(Math.max(spec.minMs ?? 0, spec.readMs ?? 0));
    }

    spec.start?.();
    spec.onStart?.(() => this.signalRead(spec.name));

    // Timer-driven read.
    if (spec.readMs !== undefined) {
      const t = this.hooks.setTimer(() => this.onRead(stage), spec.readMs);
      stage.timers.push(t);
    } else if (spec.minMs) {
      // A dynamic stage with a floor: if it never signals, the floor alone does NOT
      // advance it (it waits for signalRead). No timer here — signalRead drives it.
    }
  }

  /** The stage has produced its read signal (timer or external). Enforce the `minMs`
   *  floor, then open the next stage's gate and schedule this stage's teardown. */
  private onRead(stage: ActiveStage): void {
    if (this.active !== stage || stage.read) return; // stale / double signal
    const elapsed = this.hooks.now() - stage.startedAt;
    const floor = stage.spec.minMs ?? 0;
    if (elapsed < floor) {
      // Read arrived before the floor — defer to the floor.
      const t = this.hooks.setTimer(() => this.onRead(stage), floor - elapsed);
      stage.timers.push(t);
      return;
    }
    stage.read = true;

    // Schedule teardown independently (never gates the next stage).
    const holdMs = stage.spec.holdMs ?? 0;
    const fireTeardown = () => {
      stage.spec.teardown?.();
      // pendingTeardowns entry is removed by the caller (below).
    };
    if (holdMs > 0) {
      let handle: TimerHandle;
      handle = this.hooks.setTimer(() => {
        this.pendingTeardowns.delete(handle);
        fireTeardown();
        this.maybeIdle();
      }, holdMs);
      this.pendingTeardowns.add(handle);
    } else {
      fireTeardown();
    }

    // Open the next gate.
    this.active = null;
    this.advance();
  }

  private maybeIdle(): void {
    if (this.idle()) this.hooks.onIdle?.();
  }
}

/**
 * BEAT — the atomic unit of animation pacing (owner 2026-07-09). A "beat" is the
 * read-pause a viewer needs to register ONE discrete event (a toast, a splash, a die
 * result) before the next thing moves. Every read-window is a multiple of it; every
 * inter-cine "breath" is a HALF-beat. Defined ONCE here so the store AND the renderer
 * import the same value — that is what lets a store-driven signal (e.g. "the reroll
 * splash reads a beat before the re-tumble") be enforced in the renderer's own
 * animation timeline without a store-side timer. New pacing SHOULD be expressed in
 * beats; the older bespoke *_BEAT_MS constants migrate onto this opportunistically.
 */
export const BEAT_MS = 1000;
/** A "breath" between chained beats (crosshair pop, cine gap) — half a read-beat. */
export const HALF_BEAT_MS = 500;

/**
 * PIPELINE_TIMINGS — the SINGLE source of truth for every Phase-D pacing constant
 * (docs/injury-pacing-review.md §3/§6a). Phase 1 seeds the store's existing constants
 * from here so there is one table; the numbers are the CURRENT values (byte-identical).
 * `readMs`/`minMs` = the read window (opens the next gate); `holdMs`/`lifeMs` = the
 * teardown/pixels window (never gates).
 */
export const PIPELINE_TIMINGS = {
  /** D1 block dice: tumble→settle, then the dice hold on screen. Owner 2026-07-08:
   *  trimmed ~15% (2300→1950) so the block driver reads a touch snappier (550+1150+250;
   *  the renderer's on-pitch cine that shared these numbers was ripped 09-06 — holdMs still
   *  sizes the spectator blockPartial read). Reroll beat unchanged. */
  blockDice: {
    get tumbleMs() { return presentationMs(550); },
    get holdMs() { return presentationMs(1950); },
    get minReadMs() { return presentationMs(950); },
  },
  /** D2 chosen-die reveal (merged into the live cine, no re-tumble). */
  choiceReveal: {
    get holdMs() { return presentationMs(1350); },
    get fadeMs() { return presentationMs(300); },
    get minReadMs() { return presentationMs(700); },
  },
  /** D3 push arrow + move: lands ~900ms before the dice fade (blockResolveDelay). */
  push: { get resolveAnchorMs() { return presentationMs(900); } },
  /** D4 follow/stay indicator: +500 after the push, holds the drain. Owner 09-09: the knockdown chain read long
   *  in Replay/Spectate — hold 2600→1560 (−40%, owner), its read floor 1400→1000, injury hold 1500→1200 (the
   *  knockdown fall and armour linger below trimmed with it). */
  followStay: {
    get afterPushMs() { return presentationMs(500); },
    get holdMs() { return presentationMs(1560); },
    get minReadMs() { return presentationMs(1000); },
    get injuryHoldMs() { return presentationMs(1200); },
  },
  /** D5a knockdown-fall (rides the injury cinematic). Owner 2026-07-09: both tightened to 800
   *  (block floor 1100→800 snappier; non-block 350→800 unified) so the armour break plays sooner
   *  after a knockdown. */
  knockdown: {
    get afterBlockMinMs() { return presentationMs(650); }, // owner 09-09: 800→650
    get plainMs() { return presentationMs(650); },
  },
  /** D5b ARMOUR 2d6 HARD GATE (§4-2 / Phase 3a): the armour dice read + settle in
   *  their OWN beat BEFORE the injury result — no overlap. `readMs` floors the gate
   *  (armour dice settled); `holdMs` is how long they linger past the read. */
  armour: {
    get readMs() { return presentationMs(900); },
    get holdMs() { return presentationMs(450); }, // owner 09-09: 600→450 linger past the read
    /** Owner 09-06: the injury result (KO / Stunned / casualty toast) may not surface until the armour dice + the
     *  'ARMOR BREAKS!' stencil are TORN DOWN — the full action-die life (renderer ACTION_DIE_IN 180 + HOLD 1150 +
     *  OUT 300), not just the read beat; they overlapped by ~700 ms in spectator mode. */
    get tearDownMs() { return presentationMs(180 + 1150 + 300); },
  },
  /** Crowd-surf / rock-throw alternate entries (pre-delay before the injury). */
  crowdSurf: { get ms() { return presentationMs(2600); } },
  /** Owner-tunable throw-a-rock pacing: flight to contact, then the impact hold
   *  before the injury presentation. Renderer and store both derive from here. */
  rockThrow: {
    get flightMs() { return presentationMs(1300); },
    get impactBeatMs() { return presentationMs(450); },
  },
  /** D6 injury result lifetime (one at a time), BY SEVERITY (§3 / Phase 3b): a stun
   *  reads for a shorter, lighter beat; a KO holds mid; a casualty holds full. `lifeMs`
   *  is the casualty/default (kept for back-compat). */
  injury: {
    get lifeMs() { return presentationMs(2700); },
    get stunMs() { return presentationMs(1200); },
    get koMs() { return presentationMs(1800); },
    get casualtyMs() { return presentationMs(2700); },
  },
  /** D8 turnover splash settle. */
  turnover: { get settleMs() { return presentationMs(2500); } },
} as const;
