// Owner 10-10: "A game I join as a spectator should import the replay data into its dice statistics."
//
// A spectated game's dice tallies are a pure function of the game's match commands in order: the commands from before
// the join (the replay data the pre-join backfill already downloads) followed by the commands received live. This
// ledger is that function's bookkeeping. It is fed by LiveSpectateHistory at INGRESS - the same reduced checkpoints
// the history keeps - so the tallies do not depend on what the spectator is looking at: pausing, scrubbing, speed and
// GO TO LIVE neither skip nor repeat a roll.
//
// The join boundary is the one the history already finds by CONTENT (the server renumbers the replay stream 1..N and
// the live command numbers come from another generator, so the two number spaces cannot be compared). When a backfill
// lands, the tallies are REBUILT in order - the pre-join commands, then every live command of the joined segment -
// into a candidate that replaces the live tallies in one step. Nothing is added twice and nothing at the boundary is
// lost: a block announced before the join and rolled after it, a dodge rerolled across it, or a failed action whose
// turn ends after it, reads exactly as it does for a spectator who watched from kick-off.
//
// PRESENTATION ORDER. Ingress runs ahead of the picture, so two things are kept apart:
//  - the HEAD tallies (`target`): everything received. Only the end-of-game pane reads them - it is reachable only
//    at the final presentation, where the picture has caught up with the head.
//  - the DISPLAYED rows (`displayed`): the counters the Statistics rows read, as they stood at the command on screen.
//    Every command's totals are kept against its history cursor (generation / segment / sequence), so the store
//    publishes the totals of whatever position is displayed - live, paused, or reviewing an earlier turn - with one
//    lookup. The series holds seven small counters per team and shares an entry between commands that changed
//    none of them; a rebuild rebuilds it for the segments it folds.
import type { GameJson } from '@fumbbl40k/ffb-protocol';
import {
  DICE_ROW_KEYS, adoptDiceStats, emptyDiceStats, ingestDiceReports, noteActivation, noteTurnEnd,
  type DiceCoverage, type DiceRowTotals, type DiceStats, type DisplayedDiceRows,
} from './diceStats';
import { clearTurnRescueContext, createTurnPresentationContext, turnEndIsTurnover, turnoverArmStep } from './turnPresentation';
import { turnSideIsHome } from './blastinSecondBeat';
import type { SpectatorCheckpoint, SpectatorCursor } from './replay/spectatorCheckpoint';

type Command = Readonly<Record<string, unknown>>;
type Report = Record<string, unknown>;

/** The command's reports with an echoed twin dropped (the same report twice in a row inside one command). */
function commandReports(command: Command): Report[] {
  const raw = (command.reportList as { reports?: Report[] } | undefined)?.reports ?? [];
  const out: Report[] = [];
  let last: string | null = null;
  for (const report of raw) {
    const signature = JSON.stringify(report);
    if (signature === last) continue;
    last = signature;
    out.push(report);
  }
  return out;
}

/**
 * One match command into `stats`: its dice reports, the activations it announces and - on a turn end - the turn's
 * activation count with the turnover verdict. `ordinal` is the command's place in this game's stream (never the wire
 * commandNr: see the header). `homeWasPlaying` = whose turn it was before the command; `model` = the game after it.
 * The turnover context lives in `stats` and is advanced by the one shared heuristic (turnPresentation.ts).
 */
export function tallyDiceCommand(stats: DiceStats, ordinal: number, homeWasPlaying: boolean, model: GameJson, command: Command): void {
  const reports = commandReports(command);
  ingestDiceReports(stats, stats.gameId, ordinal, reports, model);
  const changes = (command.modelChangeList as { modelChangeArray?: { modelChangeId?: unknown; modelChangeValue?: unknown }[] } | undefined)?.modelChangeArray ?? [];
  for (const change of changes) {
    if (change.modelChangeId === 'actingPlayerSetPlayerId' && typeof change.modelChangeValue === 'string') noteActivation(stats, model, change.modelChangeValue);
  }
  const playing = new Set((homeWasPlaying ? model.teamHome : model.teamAway).playerArray.map((player) => player.playerId));
  const { context } = turnoverArmStep(stats.turnover ?? createTurnPresentationContext(), playing, reports, model.turnMode);
  const turnEnd = reports.find((report) => String(report.reportId) === 'turnEnd');
  if (turnEnd) {
    const turnover = turnEndIsTurnover(context, turnEnd, model.turnMode);
    noteTurnEnd(stats, model, homeWasPlaying ? 'home' : 'away', turnover);
    if (turnEnd.playerIdTouchdown || turnover) { context.turnoverArmed = false; context.turnoverAfterInjury = false; }
    clearTurnRescueContext(context);
  }
  stats.turnover = context;
}

/** Had any tallied dice been rolled before this snapshot? Only the first drive's set-up is certainly before them. */
function rollsBeforeSnapshot(model: GameJson): boolean {
  const turns = Number(model.turnDataHome?.turnNr ?? 0) + Number(model.turnDataAway?.turnNr ?? 0);
  if (Number(model.half ?? 0) < 1 && turns === 0) return false;
  return !(Number(model.half ?? 0) === 1 && turns === 0 && String(model.turnMode ?? '') === 'setup');
}
const gameOver = (model: GameJson | null | undefined) => !!(model as { finished?: unknown } | null | undefined)?.finished;

// ---- the displayed-position series ----

/** The row counters of every team, frozen: one entry of the series. */
type RowEntry = Readonly<Record<string, DiceRowTotals>>;
const NO_ROWS: RowEntry = Object.freeze({});
function rowEntry(stats: DiceStats, previous: RowEntry): RowEntry {
  let same = true;
  const next: Record<string, DiceRowTotals> = {};
  for (const [teamId, tally] of Object.entries(stats.teams)) {
    const before = previous[teamId];
    const row = {} as Record<typeof DICE_ROW_KEYS[number], number>;
    for (const key of DICE_ROW_KEYS) { row[key] = tally[key] ?? 0; if (!before || before[key] !== row[key]) same = false; }
    next[teamId] = Object.freeze(row);
  }
  return same && Object.keys(previous).length === Object.keys(next).length ? previous : Object.freeze(next);
}
/** Positions held at most (the history's own command limit is 100 000). */
export const ROW_SERIES_LIMIT = 120_000;
const segmentKey = (cursor: Pick<SpectatorCursor, 'connectionGeneration' | 'segmentId'>) => `${cursor.connectionGeneration}:${cursor.segmentId}`;
/** Totals after each command of a segment: `entries[i]` = at sequence `start + i` (`entries[0]` = before its first).
 *  `rank` orders the segments by POSITION in the match (a pre-join segment ranks before the live one it leads into,
 *  although it was built later). */
interface SegmentSeries { start: number; entries: RowEntry[]; rank: number }
class RowSeries {
  readonly segments = new Map<string, SegmentSeries>();
  last: RowEntry = NO_ROWS;
  /** The position on screen: its entry is never dropped by the bound. */
  protect: SpectatorCursor | null = null;
  private nextRank = 0;
  /** `limit` = positions held at most. A trim goes a little under it, so that it is not repeated on every insertion. */
  constructor(readonly limit: number = ROW_SERIES_LIMIT) {}
  /** A position with no command of its own (a snapshot): the totals as they stand. */
  mark(cursor: SpectatorCursor, stats: DiceStats): void {
    this.last = rowEntry(stats, this.last);
    this.segments.set(segmentKey(cursor), { start: cursor.sequence, entries: [this.last], rank: ++this.nextRank });
    this.bound();
  }
  /** The totals after the command that moved `before` to `after`. */
  record(before: SpectatorCursor, after: SpectatorCursor, stats: DiceStats): void {
    const key = segmentKey(after);
    let series = this.segments.get(key);
    if (!series) { series = { start: before.sequence, entries: [this.last], rank: ++this.nextRank }; this.segments.set(key, series); }
    this.last = rowEntry(stats, this.last);
    const index = after.sequence - series.start;
    while (series.entries.length < index) series.entries.push(series.entries[series.entries.length - 1] ?? NO_ROWS); // never: sequences are dense
    series.entries[index] = this.last;
    this.bound();
  }
  /** Take a rebuild's segments (in ITS order: the pre-join segment, then the joined live one). A segment already held
   *  keeps its place; a new one is placed just before the first held segment that follows it in the rebuild. */
  merge(rebuilt: RowSeries): void {
    const incoming = [...rebuilt.segments].sort((a, b) => a[1].rank - b[1].rank);
    for (let index = incoming.length - 1; index >= 0; index--) {
      const [key, series] = incoming[index]!;
      const held = this.segments.get(key);
      const after = incoming[index + 1];
      const rank = held ? held.rank : after ? this.segments.get(after[0])!.rank - 1 / (incoming.length + 1) : ++this.nextRank;
      this.segments.set(key, { start: series.start, entries: series.entries, rank });
    }
    this.last = rebuilt.last;
    this.bound();
  }
  /**
   * Hold at most `limit` positions - called on EVERY insertion (a command, a snapshot, a merged rebuild). The oldest
   * positions of the match go first (segments by rank, each from its front), and the entry of the position on screen
   * (`protect`) is never dropped: a segment is trimmed only up to it.
   */
  bound(): void {
    let size = this.size;
    if (size <= this.limit) return;
    const target = Math.max(1, this.limit - Math.max(1, Math.floor(this.limit / 12)));
    const protectedKey = this.protect ? segmentKey(this.protect) : null;
    for (const [key, series] of [...this.segments].sort((a, b) => a[1].rank - b[1].rank)) {
      if (size <= target) break;
      let droppable = series.entries.length;
      if (key === protectedKey) droppable = Math.max(0, Math.min(droppable, this.protect!.sequence - series.start));
      const drop = Math.min(droppable, size - target);
      if (drop <= 0) continue;
      if (drop === series.entries.length) this.segments.delete(key);
      else { series.entries.splice(0, drop); series.start += drop; }
      size -= drop;
    }
  }
  at(cursor: SpectatorCursor): RowEntry | null {
    const series = this.segments.get(segmentKey(cursor));
    const index = series ? cursor.sequence - series.start : -1;
    return index >= 0 ? series!.entries[index] ?? null : null;
  }
  /** Positions held. */
  get size(): number { let n = 0; for (const series of this.segments.values()) n += series.entries.length; return n; }
}

/** A rebuild in progress: the pre-join commands and then the joined segment's live commands, in order. */
export class DiceImport {
  readonly stats: DiceStats;
  readonly series: RowSeries;
  ordinal = 0;
  constructor(gameId: string | null, rowLimit: number = ROW_SERIES_LIMIT) { this.stats = emptyDiceStats(gameId); this.series = new RowSeries(rowLimit); }
  event(before: SpectatorCheckpoint, after: SpectatorCheckpoint, command: Command): void {
    tallyDiceCommand(this.stats, ++this.ordinal, turnSideIsHome(before.model), after.model, command);
    this.series.record(before.cursor, after.cursor, this.stats);
  }
}

let ledgerSerial = 0;
export class SpectatorDiceLedger {
  private readonly owner = `spectate:${++ledgerSerial}`;
  private ordinal = 0;
  private started = false;
  private series: RowSeries;
  /** The wire number of the last live command (for the reconnect gap check - one connection's numbers are comparable). */
  private lastCommandNr: number | null = null;
  private lastModel: GameJson | null = null;
  /** Set by a later snapshot of the same match: the first command after it says whether anything was missed. Until
   *  then the gap is ASSUMED (`provisional`: this snapshot raised it and a contiguous command may withdraw it). */
  private resumeAfter: { commandNr: number | null; provisional: boolean } | null = null;
  /** The position on screen (publishDisplayed), re-published when a rebuild changes its totals. */
  private displayedCursor: SpectatorCursor | null = null;
  /** The feed is being counted from DISPLAYED frames (the history stopped following it): the picture is at the head. */
  private displayedIsHead = false;

  /** `target` = the head tallies the end-of-game pane reads; `displayed` = the rows of the position on screen. The
   *  ledger owns both for as long as the spectated game lasts. */
  constructor(private readonly target: DiceStats, private readonly displayed: DisplayedDiceRows | null = null, private readonly rowLimit: number = ROW_SERIES_LIMIT) {
    this.series = new RowSeries(rowLimit);
  }

  get coverage(): DiceCoverage | null { return this.owns() ? this.target.coverage ?? null : null; }
  /** Still the feeder of `target`? (Another seat / mode may have claimed the tallies since - claimDiceStats.) */
  private owns(): boolean { return this.started && this.target.owner === this.owner; }

  /** A match snapshot was admitted: the first of this ledger starts the tallies afresh, a later one resumes them. */
  snapshot(checkpoint: SpectatorCheckpoint): void {
    const gameId = String(checkpoint.model.gameId);
    if (!this.owns() || this.target.gameId !== gameId) {
      this.started = true;
      this.ordinal = 0;
      this.lastCommandNr = null;
      this.resumeAfter = null;
      this.series = new RowSeries(this.rowLimit);
      this.displayedCursor = null;
      this.displayedIsHead = false;
      adoptDiceStats(this.target, { ...emptyDiceStats(gameId), owner: this.owner,
        coverage: { before: rollsBeforeSnapshot(checkpoint.model) ? 'missing' : 'none', gap: false } });
      if (this.displayed) { this.displayed.gameId = gameId; this.displayed.teams = {}; this.displayed.held = false; }
    } else {
      // The feed came back. Whether commands were missed shows only on the next command's number - and there may
      // never be one (a reconnect to a finished game): the gap is assumed NOW and withdrawn by a contiguous command.
      // Nothing can have been missed when the game had already ended before the feed dropped.
      const certain = gameOver(this.lastModel) && gameOver(checkpoint.model);
      const already = this.target.coverage?.gap === true;
      if (!certain && !already) this.markGap();
      this.resumeAfter = certain ? null : { commandNr: this.lastCommandNr, provisional: !already };
      this.displayedIsHead = false;
    }
    this.lastModel = checkpoint.model;
    this.series.mark(checkpoint.cursor, this.target);
  }

  /** A live match command was admitted. */
  event(before: SpectatorCheckpoint, after: SpectatorCheckpoint, command: Command): void {
    if (!this.owns()) return;
    const commandNr = typeof command.commandNr === 'number' && Number.isSafeInteger(command.commandNr) ? command.commandNr : null;
    if (this.resumeAfter) {
      const { commandNr: prior, provisional } = this.resumeAfter;
      this.resumeAfter = null;
      const contiguous = prior != null && commandNr != null && commandNr === prior + 1;
      if (contiguous && provisional) this.clearGap();
    }
    if (commandNr != null) this.lastCommandNr = commandNr;
    this.lastModel = after.model;
    tallyDiceCommand(this.target, ++this.ordinal, turnSideIsHome(before.model), after.model, command);
    this.series.record(before.cursor, after.cursor, this.target);
  }

  /**
   * The history has stopped following the feed (it waits for a fresh snapshot) but this frame is still being
   * DISPLAYED: count it from the displayed model, as the client did before the ledger. Only a frame the history never
   * admitted comes here (the store checks its receipt), so nothing counted at ingress is counted again. The raw counts
   * are sound; rows that depend on the model stay as measured as the displayed model lets them be.
   */
  displayedFrame(homeWasPlaying: boolean, model: GameJson, command: Command): void {
    if (!this.owns() || String(model.gameId) !== this.target.gameId) return;
    tallyDiceCommand(this.target, ++this.ordinal, homeWasPlaying, model, command);
    this.lastModel = model;
    this.lastCommandNr = null; // the next snapshot cannot prove continuity from a command the history never saw
    this.displayedIsHead = true; // every admitted frame was displayed before this one: the picture is at the head
    this.publish(rowEntry(this.target, this.series.last));
  }

  /** A match command the history refused was NOT displayed either: its rolls are missing. */
  dropped(): void { if (this.owns()) { this.markGap(); if (this.resumeAfter) this.resumeAfter.provisional = false; } }

  private markGap(): void {
    const coverage = this.target.coverage;
    if (coverage && !coverage.gap) this.target.coverage = { ...coverage, gap: true };
  }
  private clearGap(): void {
    const coverage = this.target.coverage;
    if (coverage?.gap) this.target.coverage = { ...coverage, gap: false };
  }

  /**
   * The position now on screen: publish its row totals. A position with no entry (never folded, or dropped by the
   * bound) HOLDS the rows: the last known ones stay, flagged `held`, and do not advance - head totals are never shown
   * in their place. Returns whether the position had its own entry.
   */
  publishDisplayed(cursor: SpectatorCursor): boolean {
    if (!this.owns()) return false;
    this.displayedCursor = { ...cursor };
    this.series.protect = this.displayedCursor;
    if (this.displayedIsHead) return true; // counted from displayed frames: already published at the head
    const entry = this.series.at(cursor);
    if (entry) this.publish(entry);
    else if (this.displayed && this.displayed.gameId === this.target.gameId) this.displayed.held = true;
    return !!entry;
  }
  private publish(entry: RowEntry): void {
    if (!this.displayed) return;
    if (this.displayed.gameId !== this.target.gameId) this.displayed.gameId = this.target.gameId;
    this.displayed.teams = entry as Record<string, DiceRowTotals>;
    this.displayed.held = false;
  }
  /** The row totals at a position (null = not held). For tests and the cost report. */
  rowsAt(cursor: SpectatorCursor): Readonly<Record<string, DiceRowTotals>> | null { return this.series.at(cursor); }
  get seriesSize(): number { return this.series.size; }

  /** Start a rebuild for a backfill attempt (see the header). */
  beginImport(): DiceImport { return new DiceImport(this.target.gameId, this.rowLimit); }

  /** Still feeding the tallies? False once another seat, mode or game has claimed them. */
  get owning(): boolean { return this.owns(); }

  /** The rebuild reached the live head: it IS the game so far. Everything before the joined segment is inside it.
   *  Returns false (nothing changed) when this ledger no longer feeds the tallies. */
  adopt(rebuilt: DiceImport): boolean {
    if (!this.owns() || rebuilt.stats.gameId !== this.target.gameId) return false;
    adoptDiceStats(this.target, { ...rebuilt.stats, owner: this.owner, coverage: { before: 'imported', gap: false },
      revision: (this.target.revision ?? 0) + 1 });
    this.ordinal = rebuilt.ordinal;
    this.resumeAfter = null;
    // the rebuilt segments' totals now count from the game's first command; older connections' segments keep theirs
    this.series.merge(rebuilt.series);
    this.displayedIsHead = false;
    if (this.displayedCursor) this.publishDisplayed(this.displayedCursor);
    return true;
  }

  /** The replay data shows the joined segment starts at the game's first command: nothing was rolled before it.
   *  Returns whether the coverage changed. */
  nothingBeforeJoin(): boolean {
    const coverage = this.target.coverage;
    if (!this.owns() || coverage?.before !== 'missing' || coverage.gap) return false;
    this.target.coverage = { before: 'none', gap: false };
    this.target.revision = (this.target.revision ?? 0) + 1;
    return true;
  }
}
