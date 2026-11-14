import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { isModifierRescueReport } from './modifierRescue';

/**
 * Owner 11-12 (game 1963248): who intercepted the pass or bomb. A tag over the player the server's `interceptionRoll`
 * report names, kept while any follow-up decision about that pass is open (the thrower's Kaboom! `skillUse`, a reroll
 * offer) and released on a server signal that play moved on. Pure: every input is server-sent (the report, the model);
 * the only clock use is the minimum read floor (INTERCEPTION_TAG_MIN_READ_MS), counted from when the tag is SHOWN.
 *
 * A new tag is PENDING (shownAt null) and bound to ONE pass occurrence (`occurrence`, assigned by the store). It is
 * shown (showInterceptionTag) only when that pass's own flight - the next pass / throwBomb animation thrown from the
 * thrower's square (interceptionTagFlightMatches) - has landed, or on explicit evidence the pass had no flight (the
 * server ended the pass with no flight seen). Unrelated frames in between (a Safe Throw reroll, Cloud Burster) keep it
 * pending. A hard boundary DISCARDS an unshown tag: always on a new pass, and on a turn / actor / drive boundary unless
 * its flight is already on screen (then it shows when that flight lands). A shown tag is released and keeps its floor.
 *
 * Release signals (frame by frame, after the report's frame):
 *  - hard, at once (no dialog check): a new passRoll / throwTeamMateRoll / interceptionRoll report (a new pass), a
 *    turnEnd report, the acting player changing, the turn changing (half, homePlaying, either team's turnNr), the drive
 *    or game ending (turn mode endGame / setup / kickoff / startGame, game finished), a snapshot;
 *  - soft, once no dialog is open: the server ended the pass - the thrower cleared or changed (StepEndBomb, the Dump-Off
 *    teardown), the turn mode leaving dumpOff / dumpOffPassBlock, for a ball the range ruler cleared (StepEndPassing),
 *    for a bomb its coordinate cleared (exploded / out) or the turn mode leaving the bomb / interception modes - or a
 *    catchRoll by another player (the pass went past).
 * A failed roll the server then rescues with a modifier skill (skillUse addAgilityModifier by the interceptor and NO
 * second interceptionRoll: bb2025 StepIntercept.handleModifierChoice) turns the tag into a success.
 */

export type InterceptionTagKind = 'intercepted' | 'deflected' | 'missed';

export interface InterceptionTag {
  playerId: string;
  kind: InterceptionTagKind;
  successful: boolean;
  bomb: boolean;
  /** the report's ignoreAgility (the easy intercept): keeps the server wording after a rescue */
  ignoreAgility: boolean;
  /** wall ms the tag was first SHOWN; null while pending (the viewer has not seen the pass get there yet) */
  shownAt: number | null;
  /** the acting player (the thrower) when the report arrived: a change releases the tag */
  actingPlayerId: string;
  /** half / side / both turn numbers when the report arrived: any change releases the tag */
  turnKey: string;
  /** the model's thrower, turn mode and range ruler when the report arrived (the pass-end signals compare to them) */
  throwerId: string;
  turnMode: string;
  hadRangeRuler: boolean;
  /** a soft signal arrived: the tag goes as soon as no dialog is open */
  resolved: boolean;
  /** wall ms of the release signal; null while live */
  releasedAt: number | null;
  /** bumps for each new report so views can key on it */
  seq: number;
  /** the pass occurrence this tag belongs to (a store-unique id; flight callbacks and caps carry and check it) */
  occurrence: number;
  /** while pending: 'awaiting' its flight, or 'armed' (its flight is presented and has not landed yet) */
  flight: 'awaiting' | 'armed';
}

export interface InterceptionTagFrame {
  /** the model AFTER the frame was applied */
  game: GameJson;
  reports: readonly Record<string, unknown>[];
  now: number;
  /** a snapshot / seek / multi-step jump: no report history, so no tag */
  snapshot?: boolean;
}

/** Project rule: anything a viewer must read stays at least 450 ms. */
export const INTERCEPTION_TAG_MIN_READ_MS = 450;

const BOMB_TURN_MODES = new Set(['bombHome', 'bombAway', 'bombHomeBlitz', 'bombAwayBlitz', 'interception']);
const DUMP_OFF_TURN_MODES = new Set(['dumpOff', 'dumpOffPassBlock']);
const DRIVE_END_TURN_MODES = new Set(['endGame', 'setup', 'kickoff', 'startGame']);
const NEW_PASS_REPORTS = new Set(['passRoll', 'throwTeamMateRoll']);

const norm = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function turnKeyOf(game: GameJson): string {
  return `${Number(game.half ?? 0)}:${game.homePlaying ? 'h' : 'a'}:${Number(game.turnDataHome?.turnNr ?? 0)}:${Number(game.turnDataAway?.turnNr ?? 0)}`;
}

function actingIdOf(game: GameJson): string {
  return String(game.actingPlayer?.playerId ?? '');
}

const throwerOf = (game: GameJson) => String((game as { throwerId?: unknown }).throwerId ?? '');
const hasRangeRuler = (game: GameJson) => !!(game.fieldModel as { rangeRuler?: unknown } | undefined)?.rangeRuler;

/** The server's own wording (AgilityMechanic.interceptionWording): BB2020 calls a non-easy interception an
 *  Interference that DEFLECTS the ball; every other ruleset intercepts. A failed roll misses. */
export function interceptionTagKind(report: Record<string, unknown>, game: GameJson | null): InterceptionTagKind {
  if (report.successful !== true) return 'missed';
  const rules = game?.gameOptions?.gameOptionArray?.find((o) => o.gameOptionId === 'rulesVersion')?.gameOptionValue;
  return rules === 'BB2020' && report.ignoreAgility !== true ? 'deflected' : 'intercepted';
}

function release(tag: InterceptionTag, now: number): InterceptionTag {
  return tag.releasedAt === null ? { ...tag, releasedAt: now } : tag;
}

/** A hard boundary: a shown tag is released (it keeps its floor); an unshown one is DISCARDED - always on a new pass,
 *  otherwise unless its own flight is already on screen (it then shows when that flight lands). */
function hardBoundary(tag: InterceptionTag, now: number, newPass: boolean): InterceptionTag | null {
  if (tag.shownAt === null && (newPass || tag.flight !== 'armed')) return null;
  return release(tag, now);
}

/** Review round 3: BB2016 sequences INTERCEPT before PASS (generator/bb2016/Pass.java: DISPATCH_PASSING -> INTERCEPT, whose
 *  failure label is PASS -> StepPass, which then reports the passRoll of that same pass and throws its flight). A
 *  passRoll is that same pass when the rules are BB2016, the tagged interception FAILED, the tag still waits for its
 *  flight, and the roll is the tagged thrower's in the same activation. A successful BB2016 interception is only
 *  followed by a passRoll when Safe Throw cancelled it (StepSafeThrow -> PASS): that one is discarded as before. */
function sameBb2016Pass(tag: InterceptionTag, report: Record<string, unknown>, game: GameJson): boolean {
  const rules = game.gameOptions?.gameOptionArray?.find((o) => o.gameOptionId === 'rulesVersion')?.gameOptionValue;
  const thrower = tag.throwerId || tag.actingPlayerId;
  return rules === 'BB2016' && !tag.successful && tag.shownAt === null && tag.flight === 'awaiting' && tag.releasedAt === null
    && !!thrower && String(report.playerId ?? '') === thrower && actingIdOf(game) === tag.actingPlayerId;
}

/** Terminal shutdown (the server ended the match): an unshown tag is discarded, a shown one released (it keeps its floor). */
export function retireInterceptionTag(tag: InterceptionTag | null, now: number): InterceptionTag | null {
  if (!tag || tag.shownAt === null) return null;
  return release(tag, now);
}

/** This frame's wire animation is the tagged pass's own flight: a pass / bomb throw (`kind` from throwPresentationKind)
 *  thrown from the thrower's square (a throw-in or a later throw starts elsewhere). */
export function interceptionTagFlightMatches(tag: InterceptionTag, game: GameJson, kind: string | undefined, animation: unknown): boolean {
  if (kind !== 'pass' && kind !== 'throwBomb') return false;
  if (!tag.throwerId) return true;
  const start = (animation as { startCoordinate?: unknown } | null)?.startCoordinate;
  const at = squareOf(game, tag.throwerId);
  return Array.isArray(start) && !!at && start[0] === at[0] && start[1] === at[1];
}

/** Its flight is now presented: the tag waits for that flight to land. */
export function armInterceptionTagFlight(tag: InterceptionTag): InterceptionTag {
  return tag.flight === 'armed' ? tag : { ...tag, flight: 'armed' };
}

/** The viewer has seen the pass get to the interceptor: start the read clock (no-op once shown). */
export function showInterceptionTag(tag: InterceptionTag, now: number): InterceptionTag {
  return tag.shownAt === null ? { ...tag, shownAt: now } : tag;
}

/** When a released, shown tag leaves the screen (its release, held to the read floor counted from the show); null while
 *  it is live or still pending. */
export function interceptionTagHiddenAt(tag: InterceptionTag | null, minReadMs = INTERCEPTION_TAG_MIN_READ_MS): number | null {
  if (!tag || tag.releasedAt === null || tag.shownAt === null) return null;
  return Math.max(tag.releasedAt, tag.shownAt + minReadMs);
}

/** On screen now: shown, and not past its release + read floor. */
export function interceptionTagVisible(tag: InterceptionTag | null, now: number, minReadMs = INTERCEPTION_TAG_MIN_READ_MS): boolean {
  if (!tag || tag.shownAt === null) return false;
  const hiddenAt = interceptionTagHiddenAt(tag, minReadMs);
  return hiddenAt === null || now < hiddenAt;
}

/** Done for good: shown, released and past its read floor (a pending tag is never expired). */
export function interceptionTagExpired(tag: InterceptionTag | null, now: number, minReadMs = INTERCEPTION_TAG_MIN_READ_MS): boolean {
  const hiddenAt = interceptionTagHiddenAt(tag, minReadMs);
  return hiddenAt !== null && now >= hiddenAt;
}

export function reduceInterceptionTag(
  previous: InterceptionTag | null,
  frame: InterceptionTagFrame,
  minReadMs = INTERCEPTION_TAG_MIN_READ_MS,
): InterceptionTag | null {
  if (frame.snapshot) return null;
  const { game, reports, now } = frame;
  let tag = previous && !interceptionTagExpired(previous, now, minReadMs) ? previous : null;
  let createdThisFrame = false;
  for (const report of reports) {
    const id = String(report.reportId ?? '');
    if (id === 'interceptionRoll' && typeof report.playerId === 'string' && report.playerId) {
      tag = {
        playerId: report.playerId,
        kind: interceptionTagKind(report, game),
        successful: report.successful === true,
        bomb: report.bomb === true,
        ignoreAgility: report.ignoreAgility === true,
        shownAt: null,
        actingPlayerId: actingIdOf(game),
        turnKey: turnKeyOf(game),
        throwerId: throwerOf(game),
        turnMode: String(game.turnMode ?? ''),
        hadRangeRuler: hasRangeRuler(game),
        resolved: false,
        releasedAt: null,
        seq: (previous?.seq ?? 0) + 1,
        occurrence: 0,
        flight: 'awaiting',
      };
      createdThisFrame = true;
      continue;
    }
    if (!tag) continue;
    // BB2016 rolls the interception BEFORE the pass: a failed one is followed by the SAME pass's roll (and its rerolls)
    if (id === 'passRoll' && sameBb2016Pass(tag, report, game)) continue;
    // a new pass discards a tag the viewer never saw (whatever its flight did), even an already released one
    if (NEW_PASS_REPORTS.has(id) && tag.shownAt === null) { tag = null; continue; }
    if (tag.releasedAt !== null) continue;
    if (NEW_PASS_REPORTS.has(id) || id === 'turnEnd') { tag = hardBoundary(tag, now, NEW_PASS_REPORTS.has(id)); if (!tag) continue; }
    else if (id === 'catchRoll' && String(report.playerId ?? '') !== tag.playerId) tag = { ...tag, resolved: true };
    else if (!tag.successful && report.playerId === tag.playerId && isModifierRescueReport(report)
      && String(report.skillUse) === 'addAgilityModifier') {
      // the server re-evaluated the same die with the picked modifier: the interception succeeded (no new roll report)
      tag = { ...tag, successful: true, kind: interceptionTagKind({ successful: true, ignoreAgility: tag.ignoreAgility }, game) };
    }
  }
  if (!tag || tag.releasedAt !== null) return tag;
  if (!createdThisFrame) {
    const mode = String(game.turnMode ?? '');
    // fail open: the thrower's activation, the turn, the drive or the game ended, whatever dialog is still standing
    if (actingIdOf(game) !== tag.actingPlayerId || turnKeyOf(game) !== tag.turnKey
      || DRIVE_END_TURN_MODES.has(mode) || (game as { finished?: unknown }).finished) return hardBoundary(tag, now, false);
    const passEnded = (!!tag.throwerId && throwerOf(game) !== tag.throwerId)
      || (DUMP_OFF_TURN_MODES.has(tag.turnMode) && !DUMP_OFF_TURN_MODES.has(mode))
      || (tag.bomb
        ? !game.fieldModel?.bombCoordinate || !BOMB_TURN_MODES.has(mode)
        : tag.hadRangeRuler && !hasRangeRuler(game));
    if (passEnded && !tag.resolved) tag = { ...tag, resolved: true };
  }
  if (tag.resolved && !game.dialogParameter) return release(tag, now);
  return tag;
}

// ---- Kaboom! (the thrower's skillUse dialog while a caught bomb is still live) ----

/** Review 11-12 (P2): the Kaboom! blast area and holder line ride the same presented flight as the tag - never while
 *  the tagged pass is still pending (its flight not landed) or a bomb throw is still in the air. */
export function kaboomDecorationReady(tag: InterceptionTag | null, throwAnimKind: unknown): boolean {
  return !(tag && tag.shownAt === null) && throwAnimKind !== 'throwBomb';
}

/** The blast squares the pitch shades now: the presented skill card is Kaboom! (`presentedSkill`, the asked coach's card
 *  or the other seats' pill) and kaboomDecorationReady; [] otherwise. */
export function kaboomBlastShown(presentedSkill: unknown, game: GameJson | null, tag: InterceptionTag | null, throwAnimKind: unknown): [number, number][] {
  return isKaboomSkill(presentedSkill) && kaboomDecorationReady(tag, throwAnimKind) ? kaboomBlastSquares(game, tag) : [];
}

/** A Kaboom! skill name as the server sends it ('Kaboom!'). */
export function isKaboomSkill(skill: unknown): boolean {
  return norm(skill) === 'kaboom';
}

/** The server's Kaboom! skillUse dialog stands in the model (every seat and spectator receives gameSetDialogParameter). */
export function kaboomDialogOpen(game: GameJson | null): boolean {
  const dp = game?.dialogParameter as { dialogId?: unknown; skill?: unknown } | null | undefined;
  return dp?.dialogId === 'skillUse' && isKaboomSkill(dp.skill);
}

function squareOf(game: GameJson, playerId: string): [number, number] | null {
  const c = game.fieldModel?.playerDataArray?.find((d) => d.playerId === playerId)?.playerCoordinate;
  return Array.isArray(c) && Number.isInteger(c[0]) && Number.isInteger(c[1]) ? [c[0], c[1]] : null;
}

const onPitch = (x: number, y: number) => x >= 0 && x < 26 && y >= 0 && y < 15;

/** The roster name the server sent for a player ('' when unknown). */
export function interceptionPlayerName(game: GameJson | null, playerId: string): string {
  if (!game) return '';
  const player = [...(game.teamHome?.playerArray ?? []), ...(game.teamAway?.playerArray ?? [])].find((p) => p.playerId === playerId);
  return String(player?.playerName ?? '').trim();
}

/** The interceptor's square from the model (where the tag hangs); null when the player is off the pitch. */
export function interceptionTagSquare(game: GameJson | null, tag: InterceptionTag | null): [number, number] | null {
  if (!game || !tag) return null;
  const square = squareOf(game, tag.playerId);
  return square && onPitch(square[0], square[1]) ? square : null;
}

/** The bomb's square: the server's bomb coordinate, else the square of the player whose interception the server
 *  reported as successful. Null when neither is known. */
export function kaboomBombSquare(game: GameJson | null, tag: InterceptionTag | null): [number, number] | null {
  if (!game) return null;
  const bomb = game.fieldModel?.bombCoordinate;
  if (Array.isArray(bomb) && Number.isInteger(bomb[0]) && Number.isInteger(bomb[1])) return [bomb[0], bomb[1]];
  if (tag?.successful && tag.bomb) return squareOf(game, tag.playerId);
  return null;
}

/** The squares a Kaboom! answer would hit, shown while the dialog is open: the bomb's square and the eight around it,
 *  clipped to the pitch. Empty when the dialog is closed or no bomb square is known. */
export function kaboomBlastSquares(game: GameJson | null, tag: InterceptionTag | null): [number, number][] {
  if (!game || !kaboomDialogOpen(game)) return [];
  const centre = kaboomBombSquare(game, tag);
  if (!centre || !onPitch(centre[0], centre[1])) return [];
  const squares: [number, number][] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = centre[0] + dx;
      const y = centre[1] + dy;
      if (onPitch(x, y)) squares.push([x, y]);
    }
  }
  return squares;
}

/** Who holds the bomb for the Kaboom! prompt: the player standing on the bomb's square (intercepted = the server
 *  reported that player's successful interception, or rescued it). Null when the dialog is closed or nobody is known
 *  to hold it. */
export function kaboomBombHolder(game: GameJson | null, tag: InterceptionTag | null): { playerId: string; intercepted: boolean } | null {
  if (!game || !kaboomDialogOpen(game)) return null;
  const square = kaboomBombSquare(game, tag);
  if (!square) return null;
  const holder = game.fieldModel?.playerDataArray?.find((d) => {
    const c = d.playerCoordinate;
    return Array.isArray(c) && c[0] === square[0] && c[1] === square[1];
  });
  if (!holder) return null;
  return { playerId: holder.playerId, intercepted: !!tag && tag.successful && tag.bomb && tag.playerId === holder.playerId };
}
