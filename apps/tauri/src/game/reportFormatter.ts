import { effectiveArmour, effectiveStat, type GameJson } from '@fumbbl40k/ffb-protocol';
import { isD6FaceValue, playerServerSide, teamServerSide, type D6FaceValue, type ServerSide } from '@fumbbl40k/ffb-pitch';
import type { D6LogToken } from './d6Log';
import { isBlockDieFaceValue, type BlockDieLogToken } from './blockDieLog';
import type { LogNameToken } from './logNames';
import type { LogTagToken } from './logTags';
import { quickSnapAllowanceText, quickSnapCountText, quickSnapExhaustedText } from './quickSnapController';
import { prayerForRoll } from './prayerCatalog';
import { breatheFireOutcome, breatheFirePassed } from './breatheFireOutcome';
import { casualtyTierLabel } from './injuryOutcomeProjection';
import { FIELD_DIRECTION_ABBR, isFieldDirection } from './logDirection';
import { tEnglish } from '../i18n';
import { BB2025_INDUCEMENT_METADATA } from './inducementCatalog';
import { inducementChipLabel } from './logic/coachPanelChips';
import { isGateRerollSource, isHandoffCatch, jumpKindFor, latchLogActionContext, logActionPlate, pendingRerollApplies, type LogActionPlate } from './logActionPlates';

/**
 * First-pass port of the FFB report texts (upstream: ffb-client-logic
 * client/report/). Covers the common families; anything unmapped falls back
 * to a humanized reportId so nothing is silently dropped.
 * Wire fields verified against ffb-common report classes.
 */

type Report = Record<string, unknown>;

/**
 * BB2025 can emit the same injury twice, split by skipInjuryParts. The skip flag
 * is presentation-only; the player and authoritative dice identify the event.
 * Keep this key beside the formatter so logging and tests cannot drift apart.
 */
export function injuryReportDedupeKey(report: Report): string | null {
  if (String(report.reportId) !== 'injury') return null;
  const defender = String(report.defenderId ?? report.playerId ?? '');
  return `${defender}|${JSON.stringify(report.armorRoll)}|${JSON.stringify(report.injuryRoll)}`;
}

const D6_MARK = '\ue000';
const D6_END = '\ue001';
const BLOCK_DIE_MARK = '\ue002';
const BLOCK_DIE_END = '\ue003';
// #157-v2 (owner 08-18): player-NAME tag markers. Same private-use-area idiom as the dice
// marks: the formatter emits them inline, decodeDisplay strips them back out into indexed
// tokens, so `text` stays byte-identical to the untagged output (every existing caller and
// test is unaffected) while the view gets structure instead of having to re-find names.
const NAME_MARK = '\ue006';
const NAME_END = '\ue007';
// Owner 08-19 (clickable log names): the name run carries the PLAYER ID too, in front of the
// visible characters and fenced off by this separator: MARK team playerId SEP name END. The id
// (and every mark) is stripped by decodeDisplay, so `text` stays byte-identical; the token gains
// an additive `playerId` the view uses to drive the locate cue on click.
const NAME_ID_SEP = '\ue00a';
// Owner 08-18: kind-tagged decoration marks (same idiom). Kind char rides first inside the
// pair: 'T' = line TITLE (the leading "Block"/"Uphill Block" literal, embossed by the view),
// 'S' = the armour SHIELD glyph (the view overlays the breastplate icon art over the emoji).
const TAG_MARK = '\ue008';
const TAG_END = '\ue009';

function titleTag(text: string): string { return `${TAG_MARK}T${text}${TAG_END}`; }
/** Owner 10-15: a field direction - the stored text reads "NE (field)" (bug reports, replays); the view shows the
 *  screen arrow + word for the current projection (logDirection.screenDirectionText), from the name in the tag. */
function dirTag(name: unknown): string {
  return isFieldDirection(name) ? `${TAG_MARK}D${name}|${FIELD_DIRECTION_ABBR[name]} (field)${TAG_END}` : String(name ?? '?');
}
function armourTag(glyph: string): string { return `${TAG_MARK}S${glyph}${TAG_END}`; }
function niStatDownTag(text: string): string { return `${TAG_MARK}N${text}${TAG_END}`; }
// Owner 08-19: a HIDDEN word — stays in the text (copy keeps it) but renders zero-visual
// (the view collapses the run), e.g. the word "rolls" before an inline die glyph.
function hiddenTag(text: string): string { return `${TAG_MARK}W${text}${TAG_END}`; }
// Owner 09-09: the word "fails" on a failed roll — the view paints it scarlet.
const FAILS = `${TAG_MARK}Ffails${TAG_END}`;
// Owner 08-19 ("pure dice language"): a bracketed die pair renders as BARE face glyphs —
// the "[", ", " and "]" stay in the text (copy keeps "[3, 3]") but ride hidden tags so only
// the faces show, side by side.
function d6Pair(value: unknown): string { return `${hiddenTag('[')}${d6List(value, hiddenTag(', '))}${hiddenTag(']')}`; }

/** Per-die owner (owner 10-13, home/away dice): `home` / `away` pins THIS die to that server side, `none` pins it
 *  neutral; omitted = the report-level owner (reportDiceOwner) applies. Encoded as one char between kind and face. */
type D6Owner = ServerSide | 'none';
function d6(value: unknown, kind: D6LogToken['kind'] = 'roll', owner?: D6Owner | null): string {
  const mark = owner === 'home' ? 'H' : owner === 'away' ? 'A' : owner === 'none' ? 'N' : '';
  return isD6FaceValue(value) ? `${D6_MARK}${kind === 'target' ? 'T' : 'R'}${mark}${value}${D6_END}` : String(value ?? '?');
}
/** The die's own player's side, or neutral when the player is unknown (never the report-level fallback). */
function playerDieOwner(game: GameJson | null, playerId: unknown): D6Owner {
  return playerServerSide(game, playerId) ?? 'none';
}
function otherSide(side: ServerSide | null): D6Owner {
  return side === 'home' ? 'away' : side === 'away' ? 'home' : 'none';
}
function opposingSide(side: ServerSide | null): ServerSide | null {
  return side === 'home' ? 'away' : side === 'away' ? 'home' : null;
}

function d6List(value: unknown, separator = ', '): string {
  return Array.isArray(value) ? value.map((face) => d6(face)).join(separator) : d6(value);
}

const genericD6Fields: Readonly<Record<string, readonly string[]>> = {
  argueTheCall: ['roll'],
  bloodLustRoll: ['roll', 'minimumRoll'],
  breatheFire: ['roll', 'minimumRoll'],
  bribesRoll: ['roll'],
  dodgySnackRoll: ['roll'],
  hypnoticGazeRoll: ['roll', 'minimumRoll'],
  kickTeamMateRoll: ['rolls'],
  officiousRefRoll: ['roll'],
  spellEffectRoll: ['roll'],
  steadyFootingRoll: ['roll', 'minimumRoll'],
  thenIStartedBlastin: ['roll'],
};

export interface ReportDisplay {
  text: string;
  d6: D6LogToken[];
  blockDice: BlockDieLogToken[];
  /** #157-v2: player names resolved from a playerId, tagged with the TEAM that owns them. */
  names: LogNameToken[];
  /** Owner 08-18: kind-tagged decoration runs (line titles, the armour shield glyph). */
  tags: LogTagToken[];
  /** Owner 10-15: the action plate (icon + acting team) of this line, set by formatReportLines on a report's first
   *  line when it belongs to a plated action. Absent = no plate. Display-only; `text` never changes with it. */
  action?: LogActionPlate;
  /** Owner 10-15 (Graphical log style only): this line as the Graphical style shows it. Absent = the same line as the
   *  Text style; null = the Graphical style leaves the line out (another row already says it). The Text style and the
   *  bug report text log never read it. */
  g?: GraphicalLine | null;
  /** Owner 10-15: a rare (about 1 in 100) easter-egg wording BOTH log styles show instead of `text`, chosen once per
   *  server event (applyLogEasterEgg). `text` keeps the normal wording, so bug-report text logs never carry it. */
  alt?: LogLineTokens;
}

/** A log line's text and its tokens. */
export interface LogLineTokens {
  text: string;
  d6: D6LogToken[];
  blockDice: BlockDieLogToken[];
  names: LogNameToken[];
  tags: LogTagToken[];
}

/** Owner 10-15: a Graphical-style line - same token structure as a Text line, plus its indent level inside the text
 *  column (0 = a sequence head such as "<A> blocks <D>", 1 = a step of it, 2 = a detail of a step). */
export interface GraphicalLine {
  text: string;
  d6: D6LogToken[];
  blockDice: BlockDieLogToken[];
  names: LogNameToken[];
  tags: LogTagToken[];
  /** 0 = a head row; each step under it is one small indent (owner 10-16: the activation's declaration is the head, its
   *  events sit one step in, a block's steps two, their outcome rows three). */
  indent: 0 | 1 | 2 | 3;
  /** Further Graphical rows this line expands into, right after it (each with its own indent; never nested deeper).
   *  E.g. "<P> vomits all over themselves!" then its armour / injury row and casualty row. */
  more?: GraphicalLine[];
  /** Owner 10-16: this row may take a later row onto its own line (a block's dice row takes the coach's choice). */
  join?: 'block';
  /** Owner 10-16: this row joins the previous logged Graphical row when that row offers the same `join`; the sinks
   *  (live log, spectator checkpoint) merge it with joinGraphicalRows and leave this entry out of the Graphical style. */
  joinPrevious?: 'block';
}
/** Owner 10-16: `next` appended to `previous` on one line (" | " between), tokens shifted; the join offer is consumed. */
export function joinGraphicalRows(previous: GraphicalLine, next: GraphicalLine): GraphicalLine {
  const sep = ' | ';
  const shift = previous.text.length + sep.length;
  const moved = <T extends { index: number }>(tokens: readonly T[]): T[] => tokens.map((t) => ({ ...t, index: t.index + shift }));
  const { join: _join, joinPrevious: _prev, more: _more, ...rest } = previous;
  return { ...rest, text: `${previous.text}${sep}${next.text}`, d6: [...previous.d6, ...moved(next.d6)], blockDice: [...previous.blockDice, ...moved(next.blockDice)],
    names: [...previous.names, ...moved(next.names)], tags: [...previous.tags, ...moved(next.tags)], ...(previous.more ? { more: previous.more } : {}) };
}
/** Owner 10-16: the Graphical rows as displayed - an entry whose row joins the previous entry's row (the coach's
 *  block-die choice onto the dice row) is folded into a copy of that entry and dropped. Entries are never mutated
 *  (consumers track rows by identity); the Text style, which never calls this, keeps every entry. */
// Perf (JLeav 1.0.296): a joined row is built once per (row, joining entry) pair, so it is the same object on every
// recompute of the view's rows (the Log keys and memoises rows by identity). Both inputs are immutable.
const joinedRows = new WeakMap<object, WeakMap<object, object>>();
export function composeGraphicalJoins<T extends { g?: GraphicalLine | null; action?: { kind?: string | null } | null }>(entries: readonly T[]): T[] {
  const out: T[] = [];
  for (const entry of entries) {
    if (entry.g?.joinPrevious) {
      // Owner 10-20: a Team Captain row the log moved after the rerolled block dice (teamCaptainLogOrder) stays after
      // them; the coach's choice still joins the dice row behind it
      let at = out.length - 1;
      while (at >= 0 && out[at]!.action?.kind === 'teamCaptain') at--;
      const target = at >= 0 ? out[at] : undefined;
      if (target?.g && target.g.join === entry.g.joinPrevious) {
        let byEntry = joinedRows.get(target);
        if (!byEntry) joinedRows.set(target, byEntry = new WeakMap());
        let joined = byEntry.get(entry) as T | undefined;
        if (!joined) byEntry.set(entry, joined = { ...target, g: joinGraphicalRows(target.g, entry.g) });
        out[at] = joined;
        continue;
      }
    }
    out.push(entry);
  }
  return out;
}

/** `owner` = the report-level dice owner (reportDiceOwner); a die marked H / A / N overrides it for that die alone. */
function decodeDisplay(marked: string, owner: ServerSide | null = null): ReportDisplay {
  const d6: D6LogToken[] = [];
  const blockDice: BlockDieLogToken[] = [];
  const names: LogNameToken[] = [];
  const tags: LogTagToken[] = [];
  let text = '';
  let cursor = 0;
  const marker = /([RT])([HAN]?)([1-6])|([1-6])|([HA])([^]*)|([TSWNFVADKUCX])([^]*)/g;
  for (let match = marker.exec(marked); match; match = marker.exec(marked)) {
    text += marked.slice(cursor, match.index);
    if (match[7]) {
      // Owner 08-18: a kind-tagged decoration run -- marks dropped, run recorded by offset.
      let run = match[8] ?? '';
      // Owner 10-15 (Graphical log): 'V' = the armour word with its break target riding in front ("9|armour"), shown
      // as the armour icon with a tooltip; 'A' = the injury word under the apothecary icon. Graphical lines only.
      let title: string | undefined;
      if (match[7] === 'V') {
        const sep = run.indexOf('|');
        const target = sep > 0 ? run.slice(0, sep) : '';
        run = sep >= 0 ? run.slice(sep + 1) : run;
        title = target ? `Armour roll: needs ${target}+ to break` : 'Armour roll';
      } else if (match[7] === 'A') {
        title = 'Injury roll';
      } else if (match[7] === 'K') {
        title = 'Knocked out';
      } else if (match[7] === 'C') {
        title = 'Casualty result';
      } else if (match[7] === 'U') {
        title = 'Stunned';
      } else if (match[7] === 'X') {
        title = 'Killed';
      } else if (match[7] === 'D') {
        // Owner 10-15: a field direction - "Northeast|NE (field)"; the name rides `title`, the view turns it into the
        // screen arrow for the current projection
        const sep = run.indexOf('|');
        title = sep > 0 ? run.slice(0, sep) : undefined;
        run = sep >= 0 ? run.slice(sep + 1) : run;
      }
      if (run) tags.push({
        index: text.length,
        length: run.length,
        kind: match[7] === 'T' ? 'title' : match[7] === 'S' || match[7] === 'V' ? 'armour' : match[7] === 'N' ? 'stat-down-ni'
          : match[7] === 'F' ? 'fail' : match[7] === 'A' || match[7] === 'C' ? 'apothecary' : match[7] === 'D' ? 'direction'
          : match[7] === 'K' ? 'ko' : match[7] === 'U' ? 'stun' : match[7] === 'X' ? 'dead' : 'hidden',
        ...(title ? { title } : {}),
      });
      text += run;
    } else if (match[5]) {
      // #157-v2: a tagged player name -- the marks are dropped and the run is recorded by offset.
      // Owner 08-19: the run is `playerId SEP name`; the id is stripped with the marks and rides
      // the token (additive field) so the view can make the name clickable (locate cue).
      const run = match[6] ?? '';
      const sep = run.indexOf(NAME_ID_SEP);
      const name = sep >= 0 ? run.slice(sep + 1) : run;
      const playerId = sep > 0 ? run.slice(0, sep) : undefined;
      if (name) names.push({ index: text.length, length: name.length, team: match[5] === 'H' ? 'home' : 'away', ...(playerId ? { playerId } : {}) });
      text += name;
    } else if (match[4]) {
      const value = Number(match[4]);
      const result = face(value);
      blockDice.push({ index: text.length, value: value as BlockDieLogToken['value'], result });
      text += result;
    } else {
      const value = Number(match[3]) as D6FaceValue;
      // Owner 10-13: a die's own H / A / N mark beats the report-level owner; N = explicitly neutral.
      const team = match[2] === 'H' ? 'home' : match[2] === 'A' ? 'away' : match[2] === 'N' ? null : owner;
      d6.push({ index: text.length, value, kind: match[1] === 'T' ? 'target' : 'roll', ...(team ? { team } : {}) });
      text += match[3];
    }
    cursor = match.index + match[0].length;
  }
  return { text: text + marked.slice(cursor), d6, blockDice, names, tags };
}

export function playerName(game: GameJson | null, playerId: unknown): string {
  if (!game || typeof playerId !== 'string') return String(playerId ?? '?');
  const player =
    game.teamHome.playerArray.find((p) => p.playerId === playerId) ??
    game.teamAway.playerArray.find((p) => p.playerId === playerId);
  return player ? player.playerName : playerId;
}

/** #157-v2: which roster carries this playerId, or null when the player is unknown (no game
 *  loaded, an id that is on neither roster, a non-id value). Unknown stays UNTAGGED -- no colour
 *  beats a wrong colour, and the line still reads exactly as before. */
function playerTeam(game: GameJson | null, playerId: unknown): LogNameToken['team'] | null {
  if (!game || typeof playerId !== 'string') return null;
  if (game.teamHome.playerArray.some((p) => p.playerId === playerId)) return 'home';
  if (game.teamAway.playerArray.some((p) => p.playerId === playerId)) return 'away';
  return null;
}

/** #157-v2: the DISPLAY form of playerName() -- same characters, wrapped in the team-tag marks so
 *  decodeDisplay can hand the view an indexed token. Every formatter renders names through this;
 *  the exported plain playerName() is unchanged for the store's non-log callers. */
function pn(game: GameJson | null, playerId: unknown): string {
  const name = playerName(game, playerId);
  const team = playerTeam(game, playerId);
  // playerTeam only resolves for a string id that is on a roster, so the id in the run is real.
  return team ? `${NAME_MARK}${team === 'home' ? 'H' : 'A'}${playerId as string}${NAME_ID_SEP}${name}${NAME_END}` : name;
}

function teamName(game: GameJson | null, teamId: unknown): string {
  if (!game || typeof teamId !== 'string') return String(teamId ?? '?');
  if (game.teamHome.teamId === teamId) return game.teamHome.teamName;
  if (game.teamAway.teamId === teamId) return game.teamAway.teamName;
  return teamId;
}

/** Owner 10-15: a team name tagged with its side (the same name marks as a player name, without a player id), so the
 *  view colours it by seat like the player names. An unknown team stays plain. */
function teamTag(game: GameJson | null, teamId: unknown): string {
  const name = teamName(game, teamId);
  const side = teamServerSide(game, teamId);
  return side ? `${NAME_MARK}${side === 'home' ? 'H' : 'A'}${name}${NAME_END}` : name;
}

function coachName(game: GameJson | null, teamId: unknown): string {
  if (!game || typeof teamId !== 'string') return 'Coach';
  if (game.teamHome.teamId === teamId) return String(game.teamHome.coach || game.teamHome.teamName || 'Coach');
  if (game.teamAway.teamId === teamId) return String(game.teamAway.coach || game.teamAway.teamName || 'Coach');
  return 'Coach';
}

function rulesVersion(game: GameJson | null): string | undefined {
  return game?.gameOptions?.gameOptionArray
    ?.find((option) => option.gameOptionId === 'rulesVersion')?.gameOptionValue;
}

/** Did a ReportTentaclesShadowingRoll {skill:'Tentacles'} HOLD the mover? Upstream bb2020 / bb2025 TentaclesBehaviour:
 *  the HOLDER (defenderId) rolls, `successful` = held. bb2016: the MOVER rolls to escape, `successful` = escaped. No /
 *  unknown rulesVersion option reads as bb2025 (the live default). Shared by the log line and the store's pill. */
export function tentaclesRollHeld(successful: unknown, game: GameJson | null): boolean {
  return rulesVersion(game) === 'BB2016' ? successful === false : successful === true;
}

function playerStateResult(value: unknown): string {
  const base = typeof value === 'number' ? value & 0xff : -1;
  switch (base) {
    case 4: return 'stunned';
    case 6: return 'badly hurt';
    case 7: return 'seriously injured';
    case 8: return 'killed';
    case 9: return 'in reserve';
    default: return `player state ${String(value ?? '?')}`;
  }
}

/** Owner 08-19: the injury-line OUTCOME — the base of the wire's `injury` PlayerState
 *  (ffb-common PlayerState.java: 4=STUNNED 5=KNOCKED_OUT 6=BADLY_HURT 7=SERIOUS_INJURY 8=RIP).
 *  This is the server's FINAL resolved state (Thick Skull / Stunty / thresholds applied
 *  server-side) — displayed verbatim, never derived from the dice. Null when the base is
 *  not an injury outcome (e.g. the player stayed prone) so the line just omits the suffix. */
function injuryOutcome(value: unknown): string | null {
  const base = typeof value === 'number' ? value & 0xff : -1;
  switch (base) {
    case 4: return 'stunned';
    case 5: return "KO'd";
    case 6: return 'badly hurt';
    case 7: return 'seriously injured';
    case 8: return 'killed';
    default: return null;
  }
}

/** The sentence that follows the injury dice. The server-stated PlayerState remains the
 *  authority; casualty detail still rides the casualty tail below. */
function injuryEffectSentence(value: unknown, name: string): string | null {
  const base = typeof value === 'number' ? value & 0xff : -1;
  switch (base) {
    case 4: return `${name} is stunned!`;
    case 5: return `${name} is KO'd!`;
    case 6: case 7: case 8: return `${name} is injured!`;
    default: return null;
  }
}

/** ReportInjury serializes applicable modifier NAMES, not an explicit "consumed" bit. Optional
 *  +1 skills therefore need phase-specific proof before the log may claim they were used. */
const CONDITIONAL_ADDITIVE_INJURY_MODIFIERS = new Map<string, string>([
  ['mighty blow', 'MB'],
  ['dirty player', 'DP'],
  ['arm bar', 'AB'],
]);

function modifierNameList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((m): m is string => typeof m === 'string' && m !== '') : [];
}

function normalizedModifierName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function injuryBaseForUnmodifiedTotal(total: number): number {
  return total <= 7 ? 4 : total <= 9 ? 5 : 6;
}

/** BB2020/25 Stunty and Thick Skull are zero-valued table conversions. Unlike the optional +1
 *  skills, the report can prove their effect directly from the raw dice and final PlayerState. */
function nonAdditiveInjuryModifierWasRelevant(name: string, roll: number[], injury: unknown): boolean {
  const total = roll.reduce((sum, die) => sum + die, 0);
  const finalBase = typeof injury === 'number' ? injury & 0xff : -1;
  switch (normalizedModifierName(name)) {
    case 'thick skull': return total === 8 && finalBase === 4;
    case 'stunty': return (total === 7 && finalBase === 5) || (total === 9 && finalBase >= 6);
    default: return true;
  }
}

/** An optional +1 injury modifier is provably consumed only when it is the sole reported injury
 *  modifier and the final server state crossed a standard injury-table boundary. ReportInjury has
 *  no selection bit, so ambiguous combinations deliberately stay unnamed. */
function additiveInjuryModifierWasConsumed(names: string[], roll: number[], injury: unknown): boolean {
  const soleName = names[0];
  if (names.length !== 1 || !soleName || !CONDITIONAL_ADDITIVE_INJURY_MODIFIERS.has(normalizedModifierName(soleName))) return false;
  const total = roll.reduce((sum, die) => sum + die, 0);
  const finalBase = typeof injury === 'number' ? injury & 0xff : -1;
  return injuryBaseForUnmodifiedTotal(total) !== finalBase
    && ((total === 7 && finalBase === 5) || (total === 9 && finalBase >= 6));
}

function armourModifierSuffix(value: unknown, broken: boolean): string {
  const names = modifierNameList(value);
  const annotations: string[] = [];
  const consumed: string[] = [];
  for (const name of names) {
    const abbreviation = CONDITIONAL_ADDITIVE_INJURY_MODIFIERS.get(normalizedModifierName(name));
    // The upstream injury pipeline only appends MB/DP/Arm Bar to armorModifiers after the
    // unmodified/current-modifier armour total failed. A broken result therefore proves use.
    if (abbreviation) {
      if (broken) consumed.push(abbreviation);
    } else {
      // Owner 10-19: the chainsaw's armour modifier is +3 (upstream skill/bb2025/Chainsaw.java) - say so: "+3 Chainsaw"
      annotations.push(normalizedModifierName(name) === 'chainsaw' ? `+3 ${name}` : name);
    }
  }
  return `${annotations.length ? ` (${annotations.join(', ')})` : ''}${consumed.length ? ` + (${consumed.join(', ')})` : ''}`;
}

function injuryModifierSuffix(value: unknown, roll: number[], injury: unknown): string {
  const names = modifierNameList(value);
  const hasConditionalAdditive = names.some((name) =>
    CONDITIONAL_ADDITIVE_INJURY_MODIFIERS.has(normalizedModifierName(name)));
  const annotations = names.filter((name) =>
    !CONDITIONAL_ADDITIVE_INJURY_MODIFIERS.has(normalizedModifierName(name))
    // A special table conversion alongside a conditional +1 cannot be attributed from
    // ReportInjury's name-only arrays; naming either would invent the server's choice.
    && !(hasConditionalAdditive && ['thick skull', 'stunty'].includes(normalizedModifierName(name)))
    && nonAdditiveInjuryModifierWasRelevant(name, roll, injury));
  const soleName = names[0];
  const consumed = soleName && additiveInjuryModifierWasConsumed(names, roll, injury)
    ? [CONDITIONAL_ADDITIVE_INJURY_MODIFIERS.get(normalizedModifierName(soleName)) as string]
    : [];
  return `${annotations.length ? ` (${annotations.join(', ')})` : ''}${consumed.length ? ` + (${consumed.join(', ')})` : ''}`;
}

function gameOption(game: GameJson | null, id: string): string | undefined {
  return game?.gameOptions.gameOptionArray.find((option) => option.gameOptionId === id)?.gameOptionValue;
}

/** Owner 08-19: the succeeds/fails suffix on roll lines: a SUCCESS ends at the needs clause ("succeeds" suppressed),
 *  a FAIL stays explicit (" | fails"). Owner 10-15: a rerolled roll no longer ends ", rerolled"; the line LEADS with
 *  the reroll marker instead (withRerollLead, applied to every formatted line whose report says reRolled). */
function outcomeSuffix(successful: unknown): string {
  return successful ? '' : ` | ${FAILS}`;
}

/** Owner 10-15 ("move 'rerolled' to the front of the line when it's a reroll"): the marker every rerolled roll line
 *  opens with, for every roll type whose report carries the wire's reRolled flag. */
export const REROLL_LEAD = 'Rerolled | ';
function withRerollLead(report: Report, marked: string, context?: Pick<ReportLogContext, 'lastRerollSource' | 'lastRerollPlayerId' | 'lastRerollTeamId'> | null, game: GameJson | null = null): string {
  return isRerolledLine(report, context, game) ? `${REROLL_LEAD}${marked}` : marked;
}
/** Owner 10-15 (Astra pass 4): a line is a reroll's replacement roll when the report says reRolled, when it is a
 *  blockReRoll (replacement block dice: Pro / Brawler single die, a Multiple Block target), or when it is a blockRoll
 *  that a pending reroll grant leads to: a full block reroll arrives as a fresh, unflagged blockRoll after the grant
 *  (team reroll / Mascot / Pro: reRoll or mascotUsed -> block -> blockRoll). The grant is the same context latch the
 *  Graphical log's reroll source icon uses (logActionPlates.latchLogActionContext); it is read here BEFORE the
 *  blockRoll consumes it. */
function isRerolledLine(report: Report, context?: Pick<ReportLogContext, 'lastRerollSource' | 'lastRerollPlayerId' | 'lastRerollTeamId'> | null, game: GameJson | null = null): boolean {
  if (report.reRolled === true) return true;
  if (String(report.reportId ?? '') === 'blockReRoll') return true;
  return pendingRerollApplies(report, context, game);
}

/** ReportSkillRoll family: playerId, successful, roll, minimumRoll, reRolled.
 *  Owner 08-19: the threshold clause is "(3+)" — the word "needs" is gone from the text;
 *  the target d6 glyph substitutes visually ("(⚂+)") with the digit as its selectable text,
 *  same machinery as rolled dice. Applies to every builder that emits the clause. */
function skillRoll(verb: string) {
  return (report: Report, game: GameJson | null): string => {
    const min = report.minimumRoll != null ? ` (${d6(report.minimumRoll, 'target')}+)` : '';
    // Owner 2026-07-06: guard the roll so a roll-less report can never render
    // "rolls undefined" (finding C — the apothecary report has no single roll).
    const rollPart = report.roll != null ? ` ${hiddenTag('rolls ')}${d6(report.roll)}` : '';
    return `${pn(game, report.playerId)} ${verb}:${rollPart}${min}${outcomeSuffix(report.successful)}`;
  };
}

/** The Hatred keyword a Getting Even roll is about, as the server names it; "their foe" without one. */
export function hatredTrait(r: Report): string {
  const keyword = typeof r.keyword === 'string' && r.keyword.trim() ? r.keyword.trim() : '';
  return keyword ? pluralKeyword(titleCase(humanize(keyword))) : 'their foe';
}
/** Owner 10-21: the hated keyword reads as a people ("the hate toward Humans"), not a label. Upstream Keyword names
 *  (ffb-common Keyword.java): regular plurals take an s; -man -> -men (Lizardman, Beastman, Treeman, Snakeman,
 *  Lineman, Bugman); Dwarf / Elf / Werewolf -> -ves; Skaven and Spawn are their own plural; Undead reads
 *  "the Undead"; "all" reads "everyone"; Unknown stays "their foe". Multi-word names pluralise their last word (Big Guy -> Big Guys). */
const KEYWORD_PLURAL_SAME = new Set(['Skaven', 'Spawn']);
export function pluralKeyword(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || /^unknown$/i.test(trimmed)) return 'their foe';
  if (/^undead$/i.test(trimmed)) return 'the Undead';
  if (/^all$/i.test(trimmed)) return 'everyone'; // Astra P3: "learns to hate everyone", not "All"
  if (KEYWORD_PLURAL_SAME.has(trimmed)) return trimmed;
  const words = trimmed.split(/\s+/);
  const last = words[words.length - 1] ?? trimmed;
  let plural: string;
  if (/man$/i.test(last) && !/^human$/i.test(last)) plural = last.replace(/man$/i, (m) => (m === 'MAN' ? 'MEN' : 'men'));
  else if (/^(dwarf|elf|werewolf)$/i.test(last)) plural = last.replace(/f$/i, (m) => (m === 'F' ? 'VES' : 'ves'));
  else if (/(s|x|z|ch|sh)$/i.test(last)) plural = `${last}es`;
  else plural = `${last}s`;
  words[words.length - 1] = plural;
  return words.join(' ');
}

/** The team's captain (the player whose server skill list holds Team Captain), name-tagged; else "<team>'s captain". */
function teamCaptainName(game: GameJson | null, teamId: unknown): string {
  const team = game && typeof teamId === 'string'
    ? (game.teamHome.teamId === teamId ? game.teamHome : game.teamAway.teamId === teamId ? game.teamAway : null) : null;
  const captain = team?.playerArray.find((p) => (p.skillArray ?? []).some((s) => String(s).replace(/[^a-z]/gi, '').toLowerCase() === 'teamcaptain'));
  return captain ? pn(game, captain.playerId) : `${teamTag(game, teamId)}'s captain`;
}

/** The player standing on a field square (the game model's own coordinates), or null. */
function playerOnSquare(game: GameJson | null, square: unknown): string | null {
  if (!game || !Array.isArray(square) || square.length < 2) return null;
  const hit = game.fieldModel.playerDataArray.find((p) => Array.isArray(p.playerCoordinate)
    && p.playerCoordinate[0] === square[0] && p.playerCoordinate[1] === square[1]);
  return hit ? hit.playerId : null;
}

/** Owner 10-16: "<Player> regenerates and returns to the reserves." / "<Player> fails to regenerate." then the dice (both
 *  styles; the Graphical row keeps the place the sequence gives it, e.g. under the casualty). Null for a partial report. */
/** Owner 10-19 (screenshot: "spell effect roll | <Player>, roll [2], successful false" for a bomb): the special-effect roll
 *  reads by its effect - "<Player> is hit by the bomb's explosion" / "<Player> dodges the bomb's explosion" (Roll) (Needed);
 *  a fireball and a lightning bolt alike, a zap "is zapped" / "resists the zap". `successful` = the effect TOOK
 *  (DiceInterpreter.isSpecialEffectSuccesful: fireball / bomb 4+, lightning 2+, zap a 6 or >= ST). Roll 0 = no roll was
 *  made (a prone player is hit outright), so no dice follow. */
/** Astra 10-19: a Zap's target is the victim's ST clamped to 2..6 (DiceInterpreter: a 6, or >= getStrengthWithModifiers), read
 *  from the player BEFORE the transformation (a zapped frog keeps `originalPlayer`, replayModel.ts). */
function zapTarget(g: GameJson | null, playerId: unknown): number | null {
  const id = String(playerId ?? '');
  const player = g && id ? [...g.teamHome.playerArray, ...g.teamAway.playerArray].find((p) => p.playerId === id) : undefined;
  if (!player) return null;
  const base = ((player as { originalPlayer?: unknown }).originalPlayer ?? player) as Parameters<typeof effectiveStat>[0];
  const st = effectiveStat(base, 'ST');
  return Number.isFinite(st) && st > 0 ? Math.max(2, Math.min(6, st)) : null;
}
function specialEffectRow(r: Report, g: GameJson | null): { head: string; dice: string | null } | null {
  const effect = String(r.specialEffect ?? '').toLowerCase();
  if (!effect || typeof r.successful !== 'boolean') return null;
  const name = pn(g, r.playerId);
  const hit = r.successful === true;
  const thing = effect === 'bomb' ? "the bomb's explosion" : effect === 'fireball' ? 'the fireball' : effect === 'lightning' ? 'the lightning bolt' : effect === 'zap' ? 'the zap' : `the ${effect}`;
  const head = effect === 'zap' ? (hit ? `${name} is zapped!` : `${name} resists ${thing}.`) : (hit ? `${name} is hit by ${thing}` : `${name} dodges ${thing}`);
  const roll = Number(r.roll);
  if (!Number.isFinite(roll) || roll <= 0) return { head, dice: null };
  const target = effect === 'lightning' ? 2 : effect === 'zap' ? zapTarget(g, r.playerId) : 4;
  return { head, dice: rollWithTarget({ roll, minimumRoll: target } as unknown as Report) };
}
function regenerationRow(r: Report, g: GameJson | null): { head: string; dice: string } | null {
  if (r.successful === true) return { head: `${pn(g, r.playerId)} regenerates and returns to the reserves.`, dice: rollWithTarget(r) };
  if (r.successful === false) return { head: `${pn(g, r.playerId)} ${FAILS} to regenerate.`, dice: rollWithTarget(r) };
  return null;
}
/** Owner 10-21: the log line for a Badly Hurt result the apothecary fixed up (the player returns to the reserves). */
function apothecaryBenchSentence(name: string): string {
  return `${name} is fixed up by the apothecary and returns to the bench.`;
}
/** A player whose field coordinate is a dugout box (upstream FieldCoordinate.isBoxCoordinate: x outside 0..25), or who
 *  has no coordinate in the model. */
function playerInDugout(game: GameJson | null, playerId: unknown): boolean {
  const data = game?.fieldModel?.playerDataArray?.find((p) => p.playerId === playerId);
  const c = data?.playerCoordinate;
  if (!Array.isArray(c) || typeof c[0] !== 'number') return true;
  return c[0] < 0 || c[0] > 25;
}
/** Owner 10-16: the Argue the Call line, split for the Graphical style: the coach's sentence (head), the outcome
 *  sentences (child rows), the dice with their target. */
function argueTheCallRows(r: Report, g: GameJson | null): { head: string; children: string[]; dice: string } {
  const side = playerTeam(g, r.playerId);
  const team = teamName(g, side === 'home' ? g?.teamHome.teamId : side === 'away' ? g?.teamAway.teamId : undefined);
  const player = pn(g, r.playerId);
  const biased = Number(r.biasedRefs ?? 0) || 0;
  const target = Math.max(1, (r.friendsWithRef === true ? 5 : 6) - biased);
  const dice = rollWithTarget({ ...r, minimumRoll: target });
  if (r.successful === true) {
    // Astra 10-16: upstream (ArgueTheCallMessage) adds the stays / reserves clause only for a player ON THE PITCH; a
    // player already in a dugout box (KO'd before the drive ended) is simply not sent off.
    const outcome = playerInDugout(g, r.playerId) ? `The referee refrains from sending ${player} off.`
      : r.staysOnPitch === false ? `${player} is sent to the reserves instead.` : `${player} stays on the pitch.`;
    return { head: `${team}'s coach argues the referee's call and succeeds. The call is overturned.`, children: [outcome], dice };
  }
  if (r.coachBanned === true) {
    return { head: `${team}'s coach argues the referee's call and is thrown out!`, children: [`${player} is sent off.`, `${team}'s coach is ejected from the game!`], dice };
  }
  return { head: `${team}'s coach argues the referee's call and ${FAILS}.`, children: [`${player} is sent off.`], dice };
}
/** Owner 10-16: the reroll source as the object of "<Player> uses ..." (upstream ReRollSources names: "Team ReRoll",
 *  "Brilliant Coaching ReRoll", "Leader", "Pro", "Loner", "Pro TRR", ...). */
function rerollSourcePhrase(source: unknown): string {
  const raw = typeof source === 'string' && source.trim() ? source.trim() : 'Team ReRoll';
  const key = raw.replace(/[^a-z]/gi, '').toLowerCase();
  if (key === 'teamreroll' || key === 'protrr' || key === 'promascottrr') return 'a team reroll';
  if (key === 'brilliantcoachingreroll') return 'a Brilliant Coaching team reroll';
  if (key === 'leader') return 'the Leader reroll';
  return titleCase(humanize(raw)).replace(/\bRe ?Roll\b/gi, 'reroll');
}
/** The roll die and its "(n+)" target, the dice part every reworded skill line ends with. */
function rollWithTarget(r: Report): string {
  const roll = r.roll != null ? `${hiddenTag('rolls ')}${d6(r.roll)}` : '?';
  return `${roll}${r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : ''}`;
}

function actingPlayerHasBallAndChain(game: GameJson | null): string | null {
  const playerId = String(game?.actingPlayer?.playerId ?? '');
  if (!game || !playerId) return null;
  const player = [...game.teamHome.playerArray, ...game.teamAway.playerArray]
    .find((candidate) => candidate.playerId === playerId);
  const skills = (player as { skillArray?: unknown[] } | undefined)?.skillArray ?? [];
  return skills.some((skill) => String(skill).replace(/[^a-z0-9]/gi, '').toLowerCase() === 'ballandchain')
    ? playerId
    : null;
}

/** Named ReportSkillRoll variant used when the skill itself is the concise log title.
 * Keep malformed/partial reports neutral: only a literal wire false claims failure. */
function namedSkillRoll(label: string) {
  return (report: Report, game: GameJson | null): string => {
    const min = report.minimumRoll != null ? ` (${d6(report.minimumRoll, 'target')}+)` : '';
    const rollPart = report.roll != null ? ` ${hiddenTag('rolls ')}${d6(report.roll)}` : '';
    const outcome = report.successful === false ? ` | ${FAILS}` : '';
    const detail = `${rollPart}${min}${outcome}`;
    return `${pn(game, report.playerId)} | ${label}${detail ? `:${detail}` : ''}`;
  };
}

/** #139 ② (GAP-WAVE-2): shared "bought" line for the three purchase-confirmation reports (counts + gold). */
function boughtLine(r: Report, game: GameJson | null): string {
  const parts: string[] = [];
  const add = (n: unknown, singular: string, plural = `${singular}s`) => {
    const c = Number(n ?? 0);
    if (c > 0) parts.push(`${c} ${c === 1 ? singular : plural}`);
  };
  add(r.nrOfCards, 'card');
  add(r.nrOfInducements, 'inducement');
  add(r.nrOfStars, 'star player');
  add(r.nrOfMercenaries, 'mercenary', 'mercenaries');
  const gold = Number(r.gold ?? 0);
  const goldPart = gold > 0 ? ` for ${gold.toLocaleString()} gold` : '';
  return `${teamName(game, r.teamId)} buys ${parts.length ? parts.join(', ') : 'nothing'}${goldPart}`;
}

/** Server `inducement` report (ReportInducement {teamId, inducementType, value}): a team used an inducement. Count
 *  types (Extra Team Training, Wandering Apothecaries) carry the count in `value`; the regeneration inducements
 *  (Igor, Mortuary Assistant, Plague Doctor) reroll the failed Regeneration roll. English text via tEnglish. */
function inducementUsedLine(r: Report, game: GameJson | null): string {
  const type = String(r.inducementType ?? '');
  const team = teamName(game, r.teamId);
  const count = Number(r.value);
  const n = Number.isFinite(count) && count > 0 ? count : 1;
  const meta = (BB2025_INDUCEMENT_METADATA as Record<string, { usages: readonly string[] } | undefined>)[type];
  const regeneration = meta ? meta.usages.includes('REGENERATION') : false;
  if (type === 'extraTeamTraining') return tEnglish('log.inducement.addRerolls', { team, n });
  if (type === 'wanderingApothecaries') return tEnglish('log.inducement.addApothecaries', { team, n });
  const inducement = inducementChipLabel(type);
  if (regeneration || type === 'igor') return tEnglish('log.inducement.regeneration', { team, inducement });
  return tEnglish('log.inducement.use', { team, inducement });
}

/** Cursor-owned context. Explicit contexts never read the legacy presentation lane. */
export interface ReportLogContext {
  lastBlockDefenderId: string | null;
  lastBlockAttackerId: string | null;
  lastBlockChoosingTeamId: string | null;
  /** Owner 10-15 (Graphical log): the receiver named by the last `handOver` report, until the catch roll it leads to
   *  (that catch is the Hand-off's; any later catch, such as a bounce, is a plain Catch). Optional so a checkpoint
   *  written before it existed still validates. */
  lastHandOverCatcherId?: string | null;
  /** Owner 10-15 (Graphical log): the reroll source that last provided a reroll, until the rerolled roll line it leads
   *  to (that line shows the source icon). Optional for the same reason. */
  lastRerollSource?: string | null;
  /** The player / team the pending grant named (Graphical log / reroll lead). Optional for the same reason. */
  lastRerollPlayerId?: string | null;
  lastRerollTeamId?: string | null;
  /** Owner 10-16: the side whose turn the frame's `turnEnd` closes (the side playing BEFORE the frame flipped it) and
   *  whether the store's turnover verdict applies to it, so the line can name the coach ("<Coach>'s turn ends" /
   *  "<Coach> turns over!"). Set per frame by the store; absent (older checkpoints, tests) = the plain "turn ends". */
  turnEndSide?: ServerSide | null;
  turnEndTurnover?: boolean;
  /** Owner 10-16: the open ACTIVATION the log is inside - set by a narrated `playerAction` (its line is the head at
   *  indent 0), every later line indents one step under it until a turn end, the next declaration, or the server
   *  clearing the acting player (activationCancelReport). `lines` counts the lines logged under it: an activation
   *  that ends with none gets "<Player> cancels their <Action> action.". Optional: older checkpoints lack it. */
  activation?: { playerId: string; action: string; lines: number; acted: boolean } | null;
  /** Owner 10-15 (Graphical block flow): the open block sequence - attacker, defender, and the chosen result once the
   *  blockChoice names it ('pow' | 'stumble' | 'push' | 'bothDown' | 'skull'). Null = no open sequence. Optional for
   *  the same reason. */
  flowAttackerId?: string | null;
  flowDefenderId?: string | null;
  flowResult?: string | null;
  /** Players pushed during the open block sequence (comma-joined ids): a chain-pushed player's crowd injury,
   *  casualty and apothecary rows are steps of the block too. */
  flowPushed?: string | null;
}
export function createReportLogContext(): ReportLogContext {
  return { lastBlockDefenderId: null, lastBlockAttackerId: null, lastBlockChoosingTeamId: null, lastHandOverCatcherId: null, lastRerollSource: null, lastRerollPlayerId: null, lastRerollTeamId: null, flowAttackerId: null, flowDefenderId: null, flowResult: null, flowPushed: null };
}
/** Owner 10-15: advance the Graphical-log latches (hand-off receiver, reroll source, block sequence) from a report the
 *  live log may not display (`handOver` / `block` / `pushback` carry no dice, so the live display gate skips formatting
 *  them). Idempotent with formatReportLines, which latches them too. */
export function noteReportLogContext(report: Report, context: ReportLogContext, game: GameJson | null = null): void {
  latchLogActionContext(report, context);
  safeLatchBlockFlow(report, game, context);
}
const legacyReportLogContext = createReportLogContext();

/** Owner 2026-07-06 (finding B): prime the block defender from a report that DOES
 *  carry it (block / blockChoice) BEFORE the frame's log loop, so the LIVE blockRoll
 *  line — which omits defenderId — resolves the name instead of rendering "vs ?". */
export function setBlockDefenderHint(defenderId: string | undefined, context = legacyReportLogContext): void {
  if (defenderId) context.lastBlockDefenderId = defenderId;
}

/** Owner 08-18: the attacker for a block dice/result line. Report keys first, then the game model's
 *  CURRENT acting player (upstream's own source for the attacker-less block texts), and only then the
 *  id latched from this sequence's `block` report -- model-current beats a latch that a debug-log
 *  toggle could leave a sequence behind. Returns undefined when none resolve; the caller then keeps
 *  the old defender-only wording rather than guessing. */
function blockAttacker(r: Report, g: GameJson | null, context: ReportLogContext): string | undefined {
  for (const candidate of [r.attackerId, r.playerId, g?.actingPlayer?.playerId, context.lastBlockAttackerId]) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return undefined;
}

// Upstream BlockResultFactory.forRoll (ffb-common/src/main/java/com/fumbbl/ffb/factory/BlockResultFactory.java:26-38):
// 1 SKULL, 2 BOTH_DOWN, 3/4 PUSHBACK, 5 POW_PUSHBACK, 6 POW. Enum literals:
// ffb-common/src/main/java/com/fumbbl/ffb/BlockResult.java:3-5.
const BLOCK_FACES = ['', 'Player Down!', 'Both Down', 'Push Back', 'Push Back', 'Stumble!', 'POW!'];
const face = (roll: unknown) => BLOCK_FACES[Number(roll)] ?? String(roll);
/** Owner 09-28 (Spec S8 follow-up): the same numeric-die-value -> face-name table the log lines already use
 *  (identical to `PitchRenderer.blockFaceLabel`), exported so a pure `game/logic/` module can name a re-rolled
 *  block die's result without importing the (Pixi-backed) renderer. */
export const blockDieFaceName = (roll: unknown): string => face(roll);
const blockDie = (roll: unknown) => isBlockDieFaceValue(roll)
  ? `${BLOCK_DIE_MARK}${roll}${BLOCK_DIE_END}`
  : face(roll);
const blockDieList = (roll: unknown) => Array.isArray(roll) ? roll.map(blockDie).join(', ') : blockDie(roll);

/** #16 (owner 07-22): map the wire BlockResult enum (ffb-common BlockResult.java —
 *  SKULL / BOTH_DOWN / PUSHBACK / POW_PUSHBACK / POW) to the canonical BB2025 die-face names so the
 *  on-pitch cine label AND the log read IDENTICALLY (the split: the cine showed the raw wire value
 *  "POW" / "POW PUSHBACK" while the log used the old face table "Defender Down"). POW_PUSHBACK = the
 *  Stumble face (die 5, formerly "Defender Stumbles"); POW = die 6 (formerly "Defender Down"). An
 *  unknown value passes through unchanged. */
export function blockResultFaceName(v: unknown): string {
  const s = String(v ?? '').toUpperCase().replace(/[\s/]+/g, '_');
  switch (s) {
    case 'SKULL': return 'Player Down!';
    case 'BOTH_DOWN': return 'Both Down';
    case 'PUSHBACK': case 'PUSH_BACK': return 'Push Back';
    case 'POW_PUSHBACK': case 'POW_PUSH': return 'Stumble!';
    case 'POW': return 'POW!';
    default: return String(v ?? '');
  }
}

/** KO recovery, one log line per player in the order the server rolled them (owner 10-13, replacing the 08-17 grouped
 *  lines): "<Player> recovers from their KO <roll> (N+)" / "<Player> stays out for the drive <roll> (N+)". The needed
 *  number comes from the server's own KnockoutRecovery entry (ffb-common KnockoutRecovery.java:66-73): the keg count
 *  (bloodweiserBabes) and Bugman's modifier (bugmansXXXXXXModifier, absent = 0, the int option's default) fed to
 *  DiceInterpreter.isRecoveringFromKnockout (ffb-server DiceInterpreter.java:123: roll > 1 && roll + mod > 3), so the
 *  target is max(2, 4 - mod), "N+". */
export function formatRecoveryLines(recoveries: readonly Report[], game: GameJson | null): string[] {
  return recoveries.map((value) => {
    const modifier = (Number(value.bloodweiserBabes ?? value.bloodweiserKegs) || 0) + (Number(value.bugmansXXXXXXModifier) || 0);
    const needed = Math.max(2, 4 - modifier);
    const roll = d6(value.roll, 'roll', playerDieOwner(game, value.playerId));
    return `${pn(game, value.playerId)} ${value.recovering ? 'recovers from their KO' : 'stays out for the drive'} ${roll} (${needed}+)`;
  });
}

/** #10x: the turnEnd part-list, one entry per intended LOG LINE (still D6-marked, not yet
 *  decoded). TD/turn-ends is always its own line; KO recoveries are grouped via
 *  formatRecoveryLines; heat exhaustion keeps its PRE-EXISTING joined-with-'; ' text
 *  (unregressed) as its own trailing line. Shared by the `turnEnd` formatter (single-line,
 *  legacy callers) and formatReportLines (multi-line). */
/** Owner 10-16: the coach of a side, tagged with that side (tinted like a player name in the view). */
function coachTagOfSide(game: GameJson | null, side: ServerSide): string {
  const team = side === 'home' ? game?.teamHome : game?.teamAway;
  const name = String(team?.coach || team?.teamName || '').trim();
  return name ? `${NAME_MARK}${side === 'home' ? 'H' : 'A'}${name}${NAME_END}` : '';
}

function turnEndLines(r: Report, g: GameJson | null, context: ReportLogContext | null = null): string[] {
  // Owner 08-19: "TOUCHDOWN!" / "scores!" ride title tags -> gold in the view, copy unchanged.
  // Owner 10-16: a plain turn end names whose turn it was, and says so when it was a turnover.
  const coach = context?.turnEndSide ? coachTagOfSide(g, context.turnEndSide) : '';
  const plainEnd = coach ? (context?.turnEndTurnover ? `${coach} turns over!` : `${coach}'s turn ends`) : 'turn ends';
  const lines = [r.playerIdTouchdown ? `${titleTag('TOUCHDOWN!')} ${pn(g, r.playerIdTouchdown)} ${titleTag('scores!')}` : plainEnd];
  const recoveries = Array.isArray(r.knockoutRecoveryArray) ? (r.knockoutRecoveryArray as Report[]) : [];
  lines.push(...formatRecoveryLines(recoveries, g));
  const heat = Array.isArray(r.heatExhaustionArray) ? r.heatExhaustionArray : [];
  const heatParts: string[] = [];
  if (rulesVersion(g) === 'BB2016') {
    for (const value of heat) {
      const exhaustion = value as Record<string, unknown>;
      heatParts.push(`${pn(g, exhaustion.playerId)} heat exhaustion ${d6(exhaustion.roll, 'roll', playerDieOwner(g, exhaustion.playerId))}`);
    }
  } else if (heat.length && r.heatRoll != null) {
    // BB2020/25 heatRoll is the D3 fainting count; entry rolls are zero. Owner 10-16: read as the rule says it.
    heatParts.push(`Sweltering Heat affects ${r.heatRoll} player${Number(r.heatRoll) === 1 ? '' : 's'} on each team.`);
  }
  if (heatParts.length) lines.push(heatParts.join('; '));
  return lines;
}

/** BB2025 stalling rock: the server hits when the D6 >= the ACTING team's turn number (StallingExtension.java). */
function stallingRockTarget(g: GameJson | null | undefined): number | null {
  const td = g?.homePlaying ? g?.turnDataHome : g?.turnDataAway;
  const nr = Number(td?.turnNr);
  return Number.isInteger(nr) && nr >= 1 && nr <= 6 ? nr : null;
}

const formatters: Record<string, (report: Report, game: GameJson | null, context: ReportLogContext) => string> = {
  dodgeRoll: skillRoll('dodges'),
  goForItRoll: skillRoll('goes for it'),
  catchRoll: skillRoll('catches'),
  passRoll: skillRoll('passes'),
  pickUpRoll: skillRoll('picks up the ball'),
  // owner 10-16: the jump is named for the skill the mover jumps with
  leapRoll: (r, g) => { const k = jumpKindFor(g, r.playerId); return skillRoll(k === 'leap' ? 'leaps' : k === 'pogo' ? 'jumps (Pogo)' : 'jumps')(r, g); },
  interceptionRoll: skillRoll('intercepts'),
  scatterPlayer: (r, g) => {
    const playerId = actingPlayerHasBallAndChain(g);
    const rolls = Array.isArray(r.rolls) ? r.rolls : [];
    const directions = Array.isArray(r.directionArray) ? r.directionArray : [];
    const roll = rolls[0];
    const result = `${roll != null ? `${hiddenTag('rolls ')}${d6(roll)}` : 'direction resolved'}`
      // owner 10-15: no arrow glyphs in the stored text (bug reports); the view draws each direction's arrow
      + `${directions.length ? ` then ${directions.map(dirTag).join(' then ')}` : ''}`;
    return playerId ? `${pn(g, playerId)} | Ball & Chain: ${result}` : `scatter player: ${result}`;
  },
  standUpRoll: (r, g) => {
    const modifier = typeof r.modifier === 'number' && r.modifier > 0 ? ` (Timm-ber +${r.modifier})` : '';
    const min = r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : '';
    const rollPart = r.roll != null ? ` ${hiddenTag('rolls ')}${d6(r.roll)}` : '';
    return `${pn(g, r.playerId)} stands up${modifier}:${rollPart}${min}${outcomeSuffix(r.successful)}`;
  },
  jumpUpRoll: skillRoll('jumps up'),
  blitzRoll: (r, g) => `${teamName(g, r.teamId)} | Blitz: ${hiddenTag('rolls ')}${r.roll ?? '?'} on D3; may activate ${r.nrOfPlayers ?? r.amount ?? '?'} open player(s)`,
  solidDefenceRoll: (r, g) => `${teamName(g, r.teamId)} | Solid Defence: ${hiddenTag('rolls ')}${d6(r.roll)}; may reposition ${r.nrOfPlayers ?? '?'} player(s)`,
  kickoffTimeout: (r) => {
    const from = Number(r.turnNr);
    const modifier = Number(r.turnModifier);
    return Number.isFinite(from) && Number.isFinite(modifier)
      ? `Time-out in turn ${from} of the kicking team | turn counter moved ${Math.abs(modifier)} step ${modifier < 0 ? 'backward' : 'forward'}`
      : 'Time-out | the turn marker is adjusted';
  },
  // BB2025 Quick Snap trio — wire keys verified against ffb-common ReportQuickSnapRoll /
  // ReportKickoffSequenceActivationsCount (nrOfPlayers = used, nrOfPlayersAllowed = limit, number = open
  // players remaining) / ReportKickoffSequenceActivationsExhausted (limitReached). Copy mirrors the upstream
  // QuickSnapRollMessage / KickoffSequenceActivations*Message renderers.
  quickSnapRoll: (r, g) =>
    quickSnapAllowanceText(teamName(g, r.teamId), Number(r.roll ?? 0), Number(r.nrOfPlayers ?? 0)),
  kickoffSequenceActivationsCount: (r) =>
    quickSnapCountText(Number(r.number ?? 0), Number(r.nrOfPlayers ?? 0), Number(r.nrOfPlayersAllowed ?? 0)),
  kickoffSequenceActivationsExhausted: (r) => quickSnapExhaustedText(r.limitReached === true),
  // #132 (owner gap-triage ③): NAME the specific negatrait (report.confusionSkill = the skill's display
  // name — Really Stupid / Bone Head / Take Root / Wild Animal / Animal Savagery / Unchannelled Fury) instead
  // of the generic "overcomes confusion", and surface a FAIL explicitly (#83 template — a failed gated-roll
  // must not vanish). One ReportConfusionRoll covers all 6 negatraits (wire CONFUSION_SKILL name-enum).
  confusionRoll: (r, g) => {
    const trait = r.confusionSkill ? String(r.confusionSkill) : 'a negative trait';
    const min = r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : '';
    const rollPart = r.roll != null ? ` ${hiddenTag('rolls ')}${d6(r.roll)}` : '';
    return `${pn(g, r.playerId)} | ${trait}:${rollPart}${min}${outcomeSuffix(r.successful)}`;
  },
  // These two ReportSkillRoll shapes previously fell through to the generic key/value dump
  // (`successful true`). Give them the same concise success trimming as every action roll;
  // a server-stated failure remains explicit and a successful reroll retains its provenance.
  // Owner 10-15 (both styles): sentence first, then the dice; only a literal wire true / false claims an outcome, a
  // partial report keeps the neutral named form.
  bloodLustRoll: (r, g) => {
    const dice = rollWithTarget(r);
    if (r.successful === true) return `${pn(g, r.playerId)} resists their bloodlust: ${dice}`;
    if (r.successful === false) return `${pn(g, r.playerId)} gives in to their bloodlust and must feed! | ${dice}`;
    return namedSkillRoll('Blood Lust')(r, g);
  },
  hypnoticGazeRoll: (r, g) => {
    const dice = rollWithTarget(r);
    const target = r.defenderId ? pn(g, r.defenderId) : 'their target';
    if (r.successful === true) return `${pn(g, r.playerId)} hypnotizes ${target}: ${dice}`;
    if (r.successful === false) return `${pn(g, r.playerId)} tries to hypnotize ${target} but fails! | ${dice}`;
    return namedSkillRoll('Hypnotic Gaze')(r, g);
  },
  // Owner 09-05: ReportSteadyFootingRoll fell through to the generic dump (", successful false") — same family.
  // Owner 10-15 (both styles): ReportSteadyFootingRoll (bb2025) is a ReportSkillRoll; a partial report stays neutral.
  steadyFootingRoll: (r, g) => {
    if (r.successful === true) return `${pn(g, r.playerId)} keeps their footing! | ${rollWithTarget(r)}`;
    if (r.successful === false) return `${pn(g, r.playerId)} doesn't manage to keep their steady footing! | ${rollWithTarget(r)}`;
    return namedSkillRoll('Steady Footing')(r, g);
  },
  dauntlessRoll: skillRoll('uses Dauntless'),
  // Owner 10-16 (both styles): "<Player> regenerates and returns to the reserves." / "<Player> fails to regenerate."
  regenerationRoll: (r, g) => { const row = regenerationRow(r, g); return row ? `${row.head} | ${row.dice}` : skillRoll('regenerates')(r, g); },
  // Owner 10-19: a bomb's / spell's effect roll names the effect, never "spell effect roll".
  spellEffectRoll: (r, g) => { const row = specialEffectRow(r, g); return row ? (row.dice ? `${row.head} | ${row.dice}` : row.head) : `${pn(g, r.playerId)} | ${humanize(String(r.specialEffect ?? 'spell effect'))} roll`; },
  // Owner 10-15 (both styles). Upstream StepFoulAppearance: the ACTING player (playerId) rolls against the Foul
  // Appearance player (the defender: the report's defenderId when sent, else the game's current defender).
  foulAppearanceRoll: (r, g) => {
    const actor = pn(g, r.playerId);
    const faId = r.defenderId ?? (g as { defenderId?: unknown } | null)?.defenderId;
    const fa = typeof faId === 'string' && faId ? pn(g, faId) : 'their opponent';
    const dice = rollWithTarget(r);
    return r.successful === false
      ? `${actor} is too disgusted by ${fa} to act! | ${dice}`
      : `${actor} resists how gross ${fa} looks! | ${dice}`;
  },
  escapeRoll: skillRoll('escapes'),
  rightStuffRoll: skillRoll('lands'),
  safeThrowRoll: skillRoll('uses Safe Throw'),
  // B9-12 G10: throwTeamMateRoll extends the skill-roll shape (thrower + roll) but
  // also carries the thrown player — was falling through to the raw generic line.
  throwTeamMateRoll: (r, g) => {
    const min = r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : '';
    const thrown = r.thrownPlayerId ? pn(g, r.thrownPlayerId) : 'a team-mate';
    const verb = r.isKick ? 'kicks' : 'throws';
    return `${pn(g, r.playerId)} ${verb} ${thrown}: ${hiddenTag('rolls ')}${d6(r.roll)}${min}${outcomeSuffix(r.successful)}`;
  },

  // Wire reality (EC-8, verified against upstream ReportBlock 2026-07-02):
  // the block report carries ONLY defenderId — the attacker is implicit (the
  // acting player); and the LIVE server's blockRoll omits defenderId (our
  // mirror is ahead of production), so the last block's defender is carried.
  block: (r, g, context) => {
    context.lastBlockDefenderId = typeof r.defenderId === 'string' ? r.defenderId : context.lastBlockDefenderId;
    const attacker = r.attackerId ?? r.playerId ?? g?.actingPlayer?.playerId;
    if (typeof attacker === 'string' && attacker) context.lastBlockAttackerId = attacker;
    context.lastBlockChoosingTeamId = null;
    return `${pn(g, attacker)} blocks ${pn(g, r.defenderId)}`;
  },
  // Owner 08-18: the offered block-dice line named only the DEFENDER ("block dice vs X"), so the log
  // never said WHO was blocking -- reshaped to `Block <Attacker> vs <Defender>: <...>`. Neither
  // ReportBlockRoll carries no attacker on the wire (it is implicit, the
  // acting player), so the attacker is resolved from the model the formatter already holds:
  // the report's own attacker keys if the fork ever serializes them, else the id latched from
  // the `block` report that opens the sequence, else game.actingPlayer (upstream's own client
  // does exactly this for the attacker-less block texts -- same precedent as the `referee` line).
  // With no attacker resolvable AT ALL the OLD wording is kept for that shape (never guess).
  blockRoll: (r, g, context) => {
    // ffb-common/src/main/java/com/fumbbl/ffb/report/ReportBlockRoll.java:16-18,57-71 carries these wire values.
    const dice = Array.isArray(r.blockRoll) ? blockDieList(r.blockRoll) : '?';
    if (typeof r.choosingTeamId === 'string' && r.choosingTeamId) context.lastBlockChoosingTeamId = r.choosingTeamId;
    const defender = r.defenderId ?? context.lastBlockDefenderId;
    const attacker = blockAttacker(r, g, context);
    // Owner 08-18: attacker left / defender right (already the shape); when the DEFENDER's coach
    // picks the die (choosingTeamId ≠ attacker's team = the block is uphill), title it "Uphill Block"
    // — the title then carries the chooser, so the "(… chooses)" tail drops on uphill lines.
    const attackerTeamId = attacker ? playerTeam(g, attacker) === 'home' ? (g?.teamHome as { teamId?: string } | undefined)?.teamId : (g?.teamAway as { teamId?: string } | undefined)?.teamId : undefined;
    const uphill = !!attacker && !!r.choosingTeamId && !!attackerTeamId && r.choosingTeamId !== attackerTeamId;
    // Owner 08-19: the "(… chooses)" tail is gone EVERYWHERE (was uphill-only) — the Uphill
    // title already says who picks, and ordinary blocks don't need the restatement.
    const chooses = '';
    // Owner 08-18: the leading title literal rides a TAG mark so the view can emboss it.
    return attacker
      ? `${titleTag(uphill ? 'Uphill Block' : 'Block')} ${pn(g, attacker)} vs ${pn(g, defender)}: ${dice}${chooses}`
      : `block dice vs ${pn(g, defender)}: ${dice}${chooses}`;
  },
  blockChoice: (r, g, context) => {
    // ffb-common/src/main/java/com/fumbbl/ffb/report/ReportBlockChoice.java:16-19,85-105 carries roll + selection.
    const roll = Array.isArray(r.blockRoll) && typeof r.diceIndex === 'number'
      ? r.blockRoll[r.diceIndex]
      : undefined;
    const result = isBlockDieFaceValue(roll)
      ? blockDie(roll)
      : blockResultFaceName(r.blockResult);
    const choosingTeamId = typeof r.choosingTeamId === 'string' && r.choosingTeamId
      ? r.choosingTeamId
      : context.lastBlockChoosingTeamId;
    return `${coachName(g, choosingTeamId)} chooses ${result}`;
  },
  blockReRoll: (r, g) => {
    // ffb-common/src/main/java/com/fumbbl/ffb/report/mixed/ReportBlockReRoll.java:22-24,59-73 carries replacement dice.
    const dice = Array.isArray(r.blockRoll) ? blockDieList(r.blockRoll) : '?';
    const source = r.reRollSource ? ` (${humanize(String(r.reRollSource))})` : '';
    return `${pn(g, r.playerId)} rerolls block dice${source}: ${dice}`;
  },
  pushback: (r, g) => `${pn(g, r.defenderId)} is pushed back`,

  coinThrow: (r) =>
    `coin toss: ${r.coinThrowHeads ? 'heads' : 'tails'} | ${r.coach} called ${r.coinChoiceHeads ? 'heads' : 'tails'} and ${(r.coinThrowHeads === r.coinChoiceHeads) ? 'wins' : 'loses'}`,
  receiveChoice: (r, g) => `${teamName(g, r.teamId)} chooses to ${r.receiveChoice ? 'receive' : 'kick'}`,
  kickoffResult: (r) => {
    // Owner 08-19: "kick-off event: high kick (3, 2)" — the word "event" joins the prefix,
    // "rolled" and the "+" form are gone; the pair shows as die-face glyphs, copy keeps the
    // numerals ("(3, 2)").
    const roll = Array.isArray(r.kickoffRoll) ? ` (${d6List(r.kickoffRoll, ', ')})` : '';
    return `kick-off event: ${humanize(String(r.kickoffResult ?? ''))}${roll}`;
  },
  // Direction is D8. Distance is D6 normally but D3 after pre-roll Kick, and the
  // report has no die-base discriminator, so both stay numeric.
  // Owner 10-15 (both styles): the direction as the viewer sees it (rendered from the field direction); the D8 roll
  // stays compact after it. Without the server's direction name, the old roll-only line.
  kickoffScatter: (r) => isFieldDirection(r.scatterDirection)
    ? `Kick-off scatters ${dirTag(r.scatterDirection)}${r.rollScatterDirection != null ? ` (${r.rollScatterDirection})` : ''}, ${r.rollScatterDistance ?? '?'} square${r.rollScatterDistance === 1 ? '' : 's'}`
    : `kick-off scatter: direction ${r.rollScatterDirection ?? '?'} · distance ${r.rollScatterDistance ?? '?'}`,
  // owner 2026-07-03 r6: surface the 2d6 weather roll alongside the result
  weather: (r) => {
    const roll = Array.isArray(r.weatherRoll) ? ` (rolled ${d6List(r.weatherRoll, ' + ')})` : '';
    return `weather: ${humanize(String(r.weather ?? 'changes'))}${roll}`;
  },

  // B7-7: Prayers to Nuffle family (16 BB2025 prayers; effects apply via
  // model changes, the trapdoor icon renders on the pitch — see renderer)
  // #139 (owner P1, GAP-WAVE-2): Master Chef (Halfling inducement) rolls a d6 per chef at the start of each
  // half; each 4+ steals one of the OPPONENT's re-rolls. Wire ReportMasterChefRoll{teamId, masterChefRoll:int[],
  // reRollsStolen}. Was unwired (generic fallback) — name the team, the dice, and the steal count.
  masterChefRoll: (r, g) => {
    const rolls = Array.isArray(r.masterChefRoll) ? d6List(r.masterChefRoll) : '?';
    const stolen = Number(r.reRollsStolen ?? 0);
    return `${teamName(g, r.teamId)} | Master Chef: ${hiddenTag('rolls ')}${rolls} | steals ${stolen} reroll${stolen === 1 ? '' : 's'}`;
  },
  // #139 ② (GAP-WAVE-2): purchase-confirmation reports. The interactive `inducementReveal` cine covers the
  // VISUAL for the buying coach, but it only fires in interactive play — a SPECTATOR / fast-pregame viewer gets
  // nothing without this log line (Yularen: build the all-modes log, record the reveal as by-design). Wire counts
  // + gold (Report{Inducements,Cards,CardsAndInducements}Bought). BB2025 uses cardsAndInducementsBought.
  inducement: (r, g) => inducementUsedLine(r, g),
  cardsAndInducementsBought: (r, g) => boughtLine(r, g),
  inducementsBought: (r, g) => boughtLine(r, g),
  cardsBought: (r, g) => boughtLine(r, g),
  // #139 ③ (GAP-WAVE-2): Riotous Rookies — an outmatched team gains extra rookie players (wire
  // ReportRiotousRookies{riotousRoll:int[], riotousAmount, teamId}); `riotousAmount` = how many gained.
  riotousRookies: (r, g) => {
    const rolls = Array.isArray(r.riotousRoll) ? (r.riotousRoll as number[]).join(', ') : '?'; // 2D3
    const amount = Number(r.riotousAmount ?? 0);
    return `${teamName(g, r.teamId)} | Riotous Rookies: ${hiddenTag('rolls ')}${rolls} | gains ${amount} rookie${amount === 1 ? '' : 's'}`;
  },
  // Bretonnian Pastries lane (10-23, pending upstream; server lane FINAL wire, scratch game 1061):
  // ReportBretonnianPastriesRoll{teamId, playerId, roll, successful} (successful = roll >= 2). Once per game on a player
  // about to be Knocked-out: on a success the player goes to the Reserves, on a natural 1 they stay Knocked-out; the
  // Pastries are used up either way. The outcome is the server's `successful`; without it the line states only the roll.
  bretonnianPastriesRoll: (r, g) => {
    const success = typeof r.successful === 'boolean' ? r.successful : null;
    const outcome = success === null ? '' : success ? ' - back to Reserves' : ' - food coma, still Knocked-out (Pastries lost)';
    return `${teamTag(g, r.teamId)} uses Bretonnian Pastries on ${pn(g, r.playerId)}: ${hiddenTag('rolled ')}${d6(r.roll, 'roll', playerDieOwner(g, r.playerId))}${outcome}`;
  },
  // #135 (GAP-WAVE-2): a Wizard inducement casts a spell — name WHICH (wire ReportWizardUse{teamId,
  // wizardSpell:SpecialEffect} = lightning/fireball/zap/bomb). The ZAP strike anim + (Voss) frog sprite render
  // off the model; this is the log line naming the cast. Was unwired (generic fallback).
  wizardUse: (r, g) => `${teamName(g, r.teamId)}'s Wizard casts ${humanize(String(r.wizardSpell ?? 'a spell'))}`,
  // #140 (GAP-WAVE-2, endgame). ⭐ defectingPlayers (owner concede item): after a concession each player rolls;
  // `defectingArray[i]==true` ⇒ that player LEAVES. Name the defectors. Wire ReportDefectingPlayers{playerIds,
  // rolls, defectingArray:bool[]}. (Store-feed `state.defectors` also surfaces this to the end screen.)
  defectingPlayers: (r, g) => {
    const ids = Array.isArray(r.playerIds) ? (r.playerIds as string[]) : [];
    const rolls = Array.isArray(r.rolls) ? r.rolls : [];
    const defs = Array.isArray(r.defectingArray) ? (r.defectingArray as unknown[]) : [];
    if (!ids.length) return 'No players defect after the concession';
    return `Defecting players: ${ids.map((id, i) => `${pn(g, id)} ${d6(rolls[i], 'roll', playerDieOwner(g, id))} (${defs[i] ? 'leaves' : 'stays'})`).join(', ')}`;
  },
  // #140: post-game winnings (both teams' gold). ReportWinnings{winningsHome, winningsAway};
  // ReportWinningsRoll adds the D6 per team.
  winnings: (r, g) =>
    `Winnings | ${g?.teamHome.teamName ?? 'Home'}: ${Number(r.winningsHome ?? 0).toLocaleString()} gold · ${g?.teamAway.teamName ?? 'Away'}: ${Number(r.winningsAway ?? 0).toLocaleString()} gold`,
  winningsRoll: (r, g) =>
    `Winnings roll | ${g?.teamHome.teamName ?? 'Home'}: ${d6(r.winningsRollHome)} → ${Number(r.winningsHome ?? 0).toLocaleString()} · ${g?.teamAway.teamName ?? 'Away'}: ${d6(r.winningsRollAway)} → ${Number(r.winningsAway ?? 0).toLocaleString()} gold`,
  // #140: a Necromancer raises a slain player (or Nurgle's Rot turns them into a Rotter). ReportRaiseDead
  // {playerId, positionName, nurglesRot}.
  raiseDead: (r, g) =>
    `${pn(g, r.playerId)} rises as a ${humanize(String(r.positionName ?? 'new player'))}${r.nurglesRot ? " (Nurgle's Rot)" : ''}`,
  // #140: a hungry Vampire with no valid target bites a spectator. ReportBiteSpectator{playerId}.
  biteSpectator: (r, g) => `${pn(g, r.playerId)} bites a spectator`,
  // #138 (GAP-WAVE-2, complete the negatrait/skill-roll family). ⭐ CHOMP (owner's Q — was unwired):
  // #7 (owner triage 08-11, Meero [SOURCE]): Chomp is a block-ALTERNATIVE — a DIRECT d6 vs minimumRoll (fixed 3,
  // StepChomp:101-103), NOT block dice. Surface the roll + needs + outcome like the Chainsaw line (its sibling
  // alternative). ReportChompRoll{chomper, chompee, roll, minimumRoll(=3), successful, reRolled} (StepChomp:104) —
  // read those; fall back to attacker/defender ids if the fork serializes those keys. (The overhead 👄 renders off
  // PlayerState 0x40000 via the renderer — this is the log half.)
  chompRoll: (r, g) => {
    const min = r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : '';
    const chomper = String(r.chomper ?? r.attackerId ?? r.playerId ?? '');
    const chompeeId = r.chompee ?? r.defenderId;
    const victim = chompeeId ? ` on ${pn(g, String(chompeeId))}` : '';
    return `${pn(g, chomper)} | Chomp${victim}: ${hiddenTag('rolls ')}${d6(r.roll)}${min} | ${r.successful ? 'CHOMPED' : FAILS}`;
  },
  chompRemoved: (r, g) =>
    r.successful ? `${pn(g, r.playerId)} is no longer chomped` : `${pn(g, r.playerId)} stays chomped`,
  // #138 log batch (ReportSkillRoll-family: playerId/successful/roll/minimumRoll/reRolled):
  // Owner 10-15 (both styles). ReportAnimosityRoll names only the thrower (upstream AnimosityBehaviour: the catcher
  // lives in the step state); the intended receiver is the player on the game's pass target square, else unnamed.
  animosityRoll: (r, g) => {
    const receiverId = playerOnSquare(g, (g as { passCoordinate?: unknown } | null)?.passCoordinate);
    const target = receiverId ? pn(g, receiverId) : 'their team-mate';
    const dice = rollWithTarget(r);
    return r.successful === false
      ? `${pn(g, r.playerId)} cannot overcome their animosity toward ${target} | ${dice}`
      : `${pn(g, r.playerId)} overcomes their animosity against ${target}: ${dice}`;
  },
  alwaysHungryRoll: skillRoll('resists Always Hungry'),
  saboteurRoll: skillRoll('sabotages'),
  // #138 custom: Chainsaw carries a defenderId target; Getting Even carries a keyword; Dwarfen Wisdom is a
  // team-level re-roll grant.
  // Owner 10-15 (both styles). Upstream bb2025 StepBlockChainsaw: roll >= minimumRoll hits the defender (an injury
  // with injuryType chainsaw for them follows); a failed roll is rerolled or kicks back (an injury for the chainsaw
  // player, who is both attacker and defender). ReportChainsawRoll often sends defenderId null: the game's defender.
  chainsawRoll: (r, g) => {
    const targetId = r.defenderId ?? (g as { defenderId?: unknown } | null)?.defenderId;
    const target = typeof targetId === 'string' && targetId ? pn(g, targetId) : 'their target';
    const dice = rollWithTarget(r);
    // Owner 10-15 (correction): the failed roll IS the kickback (bb2025 minimumRollChainsaw 2, so a 1), drawn when the
    // roll arrives; a reroll of it is logged like every rerolled roll (the reroll line, then "Rerolled | ...").
    return r.successful === false
      ? `${pn(g, r.playerId)}'s chainsaw kicks back and they hit themselves! | ${dice}`
      : `${pn(g, r.playerId)} attacks ${target} with their chainsaw! | ${dice}`;
  },
  // Owner 10-15 (both styles). ReportGettingEvenRoll (bb2025) carries the Hatred keyword the roll would grant as
  // `keyword` (Keyword.getName()); without one the trait reads "their foe".
  gettingEvenRoll: (r, g) => {
    const dice = rollWithTarget(r);
    return r.successful === false
      ? `${pn(g, r.playerId)} doesn't let the hate toward ${hatredTrait(r)} settle in their heart. | ${dice}`
      : `${pn(g, r.playerId)} learns to hate ${hatredTrait(r)}: ${dice}`;
  },
  dwarfenWisdomRoll: (r, g) => `${teamName(g, r.teamId)} | Dwarfen Wisdom: ${hiddenTag('rolls ')}${r.roll ?? '?'}`, // D3
  // #141 (GAP-WAVE-2, ball-flight): the punt/swoop DIRECTION rolls (owner: show a direction ARROW — Voss's
  // #122 renderer, fed by state.ballDirection). `direction` = the Direction enum display name ("North"/…).
  puntDirectionRoll: (r, g) => `${pn(g, r.playerId)} punts the ball ${dirTag(r.direction)}${r.directionRoll ? ` (direction ${d6(r.directionRoll)})` : ''}${r.outOfBounds ? ' (out of bounds)' : ''}`,
  puntDistanceRoll: (r) => `the ball is punted ${d6(r.roll)} squares${r.outOfBounds ? ' (out of bounds)' : ''}`,
  swoopDirectionRoll: (r, g) => `${pn(g, r.playerId)} swoops ${dirTag(r.direction)}${r.directionRoll ? ` (direction ${d6(r.directionRoll)})` : ''}${r.outOfBounds ? ' (out of bounds)' : ''}`,
  // ReportPassDeviate carries a D8 direction plus a D6 distance in every upstream producer.
  passDeviate: (r) => isFieldDirection(r.scatterDirection)
    ? `The pass deviates ${dirTag(r.scatterDirection)}${r.rollScatterDirection != null ? ` (${r.rollScatterDirection})` : ''}, ${d6(r.rollScatterDistance)} squares`
    : `the pass deviates ${r.scatterDirection ?? '?'} (direction ${r.rollScatterDirection ?? '?'}, distance ${d6(r.rollScatterDistance)})`,
  // #142 (GAP-WAVE-2, stalling + modified results — the last family). throwAtStallingPlayer pairs with the
  // wired stallerDetected (#51): the crowd throws at a detected staller (5+ hits). modified* name WHICH skill
  // improved a pass/dodge outcome (owner: "which skill improved the outcome"). twoForOne = the star-pair skill.
  throwAtStallingPlayer: (r, g) => {
    const player = pn(g, r.playerId);
    // Owner 10-23 ("surface the dice roll that was needed"): BB2025 StallingExtension.java:13-15 hits on
    // roll >= the acting team's turn number (turns 7-8 send roll 0 and never hit), so the target is the turn.
    const target = stallingRockTarget(g);
    const needed = target ? `, needed ${target}+` : '';
    if (r.successful) return `${player} is hit by a rock! (${hiddenTag('rolls ')}${d6(r.roll)}${needed})`;
    return Number(r.roll ?? 0) > 0
      ? `${player} is not punished for stalling. (${hiddenTag('rolls ')}${d6(r.roll)}${needed})`
      : `${player} stalled but the crowd cannot be bothered.`;
  },
  modifiedPassResult: (r) => `${r.skill ?? 'a skill'} modifies the pass → ${r.passResult ?? '?'}`,
  modifiedDodgeResultSuccessful: (r) => `${r.skill ?? 'a skill'} makes the dodge succeed`,
  twoForOne: (r, g) => `Two For One: ${pn(g, r.playerId)} + ${pn(g, r.partnerId)}`,
  // COMPLETENESS SWEEP · tranche 1 — residual skill/negatrait rolls (the #83 formatter-enrich template,
  // log-line class, golden-invisible). Closes the last unpresented live rolls. (balefulHex was initially
  // deferred here but its class DID exist — built in tranche 4 below.)
  tentaclesShadowingRoll: (r, g) => {
    // ⚖ [SOURCE] ReportTentaclesShadowingRoll carries ONE playerId (`defenderId` = game.getDefenderId()) whose ROLE
    //  differs by skill; roll = `roll` (the skillRoll idiom — `tentacleRoll` was the wrong field, hence "rolls ?"),
    //  needs = `minimumRoll`. Read the roll robustly across both keys.
    const rollRaw = (r.tentacleRoll ?? r.roll) as unknown;
    const rolls = Array.isArray(rollRaw) ? d6List(rollRaw) : d6(rollRaw);
    const min = r.minimumRoll != null
      ? ` (${rulesVersion(g) === 'BB2020' || rulesVersion(g) === 'BB2025' ? d6(r.minimumRoll, 'target') : String(r.minimumRoll)}+)`
      : '';
    if (/shadow/i.test(String(r.skill ?? ''))) {
      // bb2025 ShadowingBehaviour: the pchoice'd SHADOWER (game.getDefenderId(), `addShadower(defenderId)`) rolls
      // 4+ to FOLLOW the moving player — defenderId is the SHADOWER, NOT the escaper (owner-reported inversion).
      // The runner (moved-away player) isn't on the report; name the acting player when it's a distinct player.
      const shadower = pn(g, r.defenderId);
      const runnerId = String((g?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
      const runner = runnerId && runnerId !== r.defenderId ? ` ${pn(g, runnerId)}` : '';
      // Owner 10-15 (both styles): "<Player> fails to shadow <Target>: [dice] (n+)"; a success reads "<Player> shadows
      // <Target>: [dice] (n+)" - the old "| follows him" / "| loses him" tails are gone.
      return `${shadower} ${r.successful ? 'shadows' : `${FAILS} to shadow`}${runner}: ${hiddenTag('rolls ')}${rolls}${min}`;
    }
    // The chosen defenderId is the player USING Tentacles; the mover remains the acting player.
    // Phrase the result from the holder's perspective and trim successful hold text.
    const holder = pn(g, r.defenderId);
    const targetId = String((g?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    const target = targetId && targetId !== r.defenderId ? pn(g, targetId) : 'their target';
    // Owner 10-15 (both styles), the same pattern as a failed shadow. Upstream bb2020/bb2025 TentaclesBehaviour: the
    // HOLDER (defenderId) rolls and `successful` means they hold the mover; bb2016 has the mover roll to escape, so
    // there `successful` means the hold failed.
    const held = tentaclesRollHeld(r.successful, g);
    return held
      ? `${holder} holds ${target} with ${r.skill ?? 'Tentacles'}: ${hiddenTag('rolls ')}${rolls}${min}`
      : `${holder} ${FAILS} to hold ${target} with ${r.skill ?? 'Tentacles'}: ${hiddenTag('rolls ')}${rolls}${min}`;
  },
  animalSavagery: (r, g) => `${pn(g, r.attackerId)} (Animal Savagery) turns on team-mate ${pn(g, r.defenderId)}`,
  // Owner 10-15 (both styles). Upstream bb2025 StepProjectileVomit: roll >= minimumRoll (2) hits the defender (an
  // armour roll for them follows); a failed roll is either rerolled (a new report) or the vomit lands on the vomiter
  // (an injury report for the vomiter follows, which reads "<P> vomits all over themselves!").
  projectileVomit: (r, g) => {
    const min = r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : '';
    const target = r.defenderId ? pn(g, r.defenderId) : 'their target';
    const dice = `${hiddenTag('rolls ')}${d6(r.roll)}${min}`;
    return r.successful
      ? `${pn(g, r.playerId)} vomits all over ${target}: ${dice}`
      : `${pn(g, r.playerId)} tried to vomit on ${target} but missed! | ${dice}`;
  },
  // Owner 10-15 (both styles): the server's ReportHandOver names the receiver; the giver is the acting player.
  handOver: (r, g) => {
    const giver = g?.actingPlayer?.playerId;
    const receiver = r.catcherId ? pn(g, r.catcherId) : 'a team-mate';
    return giver ? `${pn(g, giver)} hands off to ${receiver}` : `hand-off to ${receiver}`;
  },
  // Owner 10-10: ReportBreatheFire had no line of its own (generic dump, "successful false" on a 4). Its `successful`
  // is true only for the knock-down; the outcome is the server's `status` (see breatheFireOutcome).
  breatheFire: (r, g) => {
    const min = r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : '';
    // Owner 10-15 (both styles): sentence first, then the dice. The server's BreatheFireResult (`status`) decides, never
    // the roll bands: FAILURE = the breather sets themself on fire (placed prone, turnover); NO_EFFECT = the fire misses;
    // PRONE / KNOCK_DOWN = the target is placed prone / knocked down (the report distinguishes them, so the result
    // stays after the dice). Without a known status, a failed roll (breatheFirePassed) is the backfire.
    const breather = pn(g, r.playerId);
    const target = r.defenderId ? pn(g, r.defenderId) : 'their target';
    const dice = `${hiddenTag('rolls ')}${d6(r.roll)}`;
    const outcome = breatheFireOutcome(r) ?? (breatheFirePassed(r) === false ? 'failure' : null);
    if (outcome === 'failure') return `${breather} sets themself on fire! | ${dice}`;
    if (outcome === 'noEffect') return `${breather} failed to blow fire on ${target}: ${dice}${min}`;
    const result = outcome === 'prone' ? ' | placed prone' : outcome === 'knockDown' ? ' | knocked down' : '';
    return `${breather} blows fire on ${target}: ${dice}${min}${result}`;
  },
  lookIntoMyEyesRoll: skillRoll('uses Look Into My Eyes'),
  weepingDaggerRoll: skillRoll('uses Weeping Dagger'),
  swarmingPlayersRoll: (r, g) => `${teamName(g, r.teamId)} | Swarming: ${r.swarmingPlayerRoll ?? r.swarmingPlayerAmount ?? '?'} extra player(s) field`,
  nervesOfSteel: (r, g) => `${pn(g, r.playerId)} uses Nerves of Steel${r.ballAction ? ` (${humanize(String(r.ballAction))})` : ''}`,
  // COMPLETENESS SWEEP · tranche 2 — star/special one-off log lines. (catchOfTheDay, allYouCanEat,
  // brilliantCoachingReRoll were initially deferred here but their classes DID exist — built in tranche 4 below.)
  indomitable: (r, g) => `${pn(g, r.playerId)} stays up (Indomitable)`,
  // Owner 10-13: self-inflicted Old Pro rerolls the OPPONENT's die, so those dice wear the opponent's colour.
  oldPro: (r, g) => r.selfInflicted
    ? `${pn(g, r.playerId)} uses Old Pro: forces the opponent to reroll ${d6(r.oldRoll, 'roll', otherSide(playerServerSide(g, r.playerId)))} into ${d6(r.roll, 'roll', otherSide(playerServerSide(g, r.playerId)))}`
    : `${pn(g, r.playerId)} uses Old Pro: rerolls ${d6(r.oldRoll)} into ${d6(r.roll)}`,
  pickMeUp: (r, g) => `${pn(g, r.playerId)} | Pick Me Up: ${hiddenTag('rolls ')}${d6(r.roll)}${outcomeSuffix(r.successful)}`,
  // Kildash fix ("Dodgey snack stats not showing"): the roll only decides WHO is affected. Upstream ReportDodgySnackRoll carries
  // just {roll, playerId}; StepApplyKickoffResult.dodgySnackEffect sends a 1 to the reserves and applies -1 MA / -1 AV from a 2 up,
  // and the Java DodgySnackRollMessage words it the same way. The rule exists in BB2025 only (no BB2020 report).
  dodgySnackRoll: (r, g) => {
    const roll = Number(r.roll);
    const outcome = r.roll == null || !Number.isFinite(roll) ? '' : roll <= 1 ? ' | sent to the Reserves for this drive' : ' | -1 MA and -1 AV for this drive';
    return `${pn(g, r.playerId)} | Dodgy Snack: ${hiddenTag('rolls ')}${d6(r.roll)}${outcome}`;
  },
  raidingParty: (r, g) => `${pn(g, r.playerId)} uses Raiding Party`,
  thrownKeg: (r, g) =>
    `${pn(g, r.playerId)} throws a keg at ${pn(g, r.targetPlayerId)}: ${hiddenTag('rolls ')}${d6(r.roll)} | ${r.fumble ? 'fumbles' : r.successful ? 'hits' : 'misses'}`,
  // Owner 10-15 (both styles): "<team>'s mascot rallies the team! | [die] (n+)" / "<team>'s mascot tries to rally the
  // team but fails! | [die] (n+)", the team name coloured by its side like a player name.
  mascotUsed: (r, g) => {
    const dice = `${hiddenTag('rolls ')}${d6(r.roll)}${r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : ''}`;
    const team = teamTag(g, r.teamId);
    return r.successful === true
      ? `${team}'s mascot rallies the team! | ${dice}`
      : `${team}'s mascot tries to rally the team but fails! | ${dice}`;
  },
  // Owner 10-15 (both styles). ReportTeamCaptainRoll (bb2025) names only the team; the captain is the team's player
  // with the Team Captain skill in the server's roster data, else "<team>'s captain".
  teamCaptainRoll: (r, g) => r.successful === false
    ? `${teamCaptainName(g, r.teamId)} fails to be inspiring and the reroll is lost | ${rollWithTarget(r)}`
    : `${teamCaptainName(g, r.teamId)} leads the way and keeps their reroll! | ${rollWithTarget(r)}`,
  weatherMageRoll: (r) => `Weather Mage: ${hiddenTag('rolls ')}${d6List(r.weatherRoll)}`,
  weatherMageResult: () => 'Weather Mage alters the weather',
  pumpUpTheCrowdReRoll: (r, g) => `${pn(g, r.playerId)} earns a Pump Up The Crowd reroll`,
  showStarReRoll: (r, g) => `${pn(g, r.playerId)} earns a Show Star reroll`,
  // Owner 10-16: ReportBriberyAndCorruptionReRoll {teamId, briberyAncCorruptionAction: USED | ADDED | WASTED} (upstream's
  // misspelt key). USED is the reroll of a failed Argue the Call; the other two are upstream's own notices.
  briberyAndCorruptionReRoll: (r, g) => {
    const action = String((r as { briberyAncCorruptionAction?: unknown }).briberyAncCorruptionAction ?? (r as { briberyAndCorruptionAction?: unknown }).briberyAndCorruptionAction ?? 'USED').toUpperCase();
    const team = teamName(g, r.teamId);
    if (action === 'ADDED') return `${team} may reroll a natural 1 on an Argue the Call roll once this game (Bribery & Corruption).`;
    if (action === 'WASTED') return `${team} have no use for their Bribery & Corruption: the coach was banned for more than one argue.`;
    return `${team} use their Bribery & Corruption reroll to reroll the failed call.`;
  },
  biasedRef: (r) => `Biased Ref: ${hiddenTag('rolls ')}${d6(r.roll)} | ${r.foulSpotted ? 'foul spotted' : 'foul not spotted'}`,
  // Prayer handlers use playerEvent for their authoritative per-player effect copy (for example
  // Bad Habits: " gains Loner (2+)"). Keep the server wording and add the structured player name.
  // Owner 09-07: most upstream messages lead with their own space (" gains Stab"); "did not stall after all" does
  // not, so the name ran into the verb. Insert one unless the message already opens with space or punctuation.
  playerEvent: (r, g) => {
    const msg = String(r.message ?? '');
    return `${pn(g, r.playerId)}${msg && !/^[\s,.!?;:')]/.test(msg) ? ' ' : ''}${msg}`;
  },
  // COMPLETENESS SWEEP · tranche 3 — ball-flight residual + misc log lines.
  placedBallDirection: (r, g) => `${pn(g, r.playerId)} places the ball ${dirTag(r.direction)}`,
  bombOutOfBounds: () => 'the bomb sails out of bounds',
  kickTeamMateFumble: () => 'the Kick Team-Mate throw fumbles',
  swoopPlayer: (r, g) => {
    if (Array.isArray(r.rolls)) {
      const dirs = Array.isArray(r.directionArray) ? r.directionArray.filter(isFieldDirection) : [];
      return dirs.length
        ? `a player swoops across the pitch ${dirs.map(dirTag).join(' then ')} (direction ${d6List(r.rolls)})`
        : `a player swoops across the pitch (direction ${d6List(r.rolls)})`;
    }
    const swoopDistance = gameOption(g, 'swoopDistance');
    const distance = rulesVersion(g) === 'BB2025' && (swoopDistance == null || swoopDistance === '0')
      ? d6(r.distance)
      : String(r.distance ?? '?');
    const dir = r.scatterDirection ?? r.direction;
    return `a player swoops ${distance} square${r.distance === 1 ? '' : 's'} ${dir != null ? dirTag(dir) : ''}`.trim();
  },
  // #236: ReportId.java:54 wires `fumblerooskie`; ReportFumblerooskie.java:18-19,38-50 carries playerId + used.
  // Wording mirrors bb2025/UseFumblerooskieMessage.java:15-23, including the used:false reset/expiry report.
  fumblerooskie: (r, g) => r.used
    ? `${pn(g, r.playerId)} will drop the ball using Fumblerooski once he moves from the current square.`
    : `${pn(g, r.playerId)} did not vacate the square and thus keeps the ball.`,
  trapDoor: (r, g) => `${pn(g, r.playerId)} hits a trap door: ${hiddenTag('rolls ')}${d6(r.roll)} | ${r.escaped ? 'escapes' : 'falls in'}`,
  skillUseOtherPlayer: (r, g) => `${pn(g, r.playerId)} uses ${r.skill ?? 'a skill'}${r.playerIdOtherPlayer ? ` on ${pn(g, r.playerIdOtherPlayer)}` : ''}`,
  skillWasted: (r, g) => `${pn(g, r.playerId)}'s ${r.skill ?? 'skill'} is wasted`,
  throwAtPlayer: (r, g) => `thrown at ${pn(g, r.playerId)}: ${hiddenTag('rolls ')}${d6(r.roll)} | ${r.successful ? 'hits' : 'misses'}`,
  // COMPLETENESS SWEEP · tranche 4 — the 4 classes deferred in T1/T2 as "not locatable" turned out to EXIST
  // (report/mixed/, named with Roll/ReRollsLost suffixes; `mixed` = all rulesets, so BB2025-emittable = real
  // gaps, not bb2016-by-design). Keys [SOURCE]-verified per the field-vs-wire-key lesson (QR-214).
  balefulHex: (r, g) => {
    const min = r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : '';
    return `${pn(g, r.playerId)}'s Baleful Hex${r.targetPlayerId ? ` on ${pn(g, r.targetPlayerId)}` : ''}: ${hiddenTag('rolls ')}${d6(r.roll)}${min} | ${r.successful ? 'hexes' : FAILS}`;
  },
  catchOfTheDay: skillRoll('uses Catch of the Day'),
  allYouCanEat: skillRoll('uses All You Can Eat'),
  brilliantCoachingReRoll: (r, g) => `${teamName(g, r.teamId)} loses ${r.rerollBrilliantCoachingOneDrive ?? '?'} Brilliant Coaching reroll(s)`,
  // COMPLETENESS SWEEP · doubleHired pair (Yularen returned it after Thrawn's literal-vs-constant scan
  // correction). RE-VERIFIED bb2025: `bb2025/start/StepBuyInducements` EMITS both reports ⇒ REAL gaps, not
  // by-design (my #139 by-design ruling under-verified). ReportDoubleHiredStarPlayer{starPlayerName} +
  // ReportDoubleHiredStaff{staffName via NAME="name" — read r.name, NOT the field}. Both coaches hired the same.
  doubleHiredStarPlayer: (r) => `${r.starPlayerName ?? 'a star player'} was hired by both coaches`,
  doubleHiredStaff: (r) => `${r.name ?? 'a staff member'} was hired by both coaches`,
  // COMPLETENESS SWEEP · Thrawn closing-audit emit-search (my lane). Emit-verified bb2025-reachable → BUILD:
  // cloudBurster (ReportCloudBurster/mixed, CloudBursterBehaviour){throwerId,interceptorId} + bombExplodesAfterCatch
  // (bb2020/special/StepInitBomb — bombs exist in BB2025){catcherId,explodes,roll}. Keys [SOURCE]-verified.
  cloudBurster: (r, g) => `${pn(g, r.interceptorId)} (Cloud Burster) deflects ${pn(g, r.throwerId)}'s bomb`,
  bombExplodesAfterCatch: (r, g) => `the bomb ${pn(g, r.catcherId)} caught ${r.explodes ? 'EXPLODES' : 'is safe'}: ${hiddenTag('rolls ')}${d6(r.roll)}`,
  // COMPLETENESS SWEEP · Yularen closing-audit BUILD batch (emission-verified bb2025 per my emit-check).
  // ⚠ fanFactorRoll EXCLUDED: emitted ONLY by bb2016/end/StepFanFactor (NOT bb2025) → by-design, flagged Yularen.
  // Row-22 (owner 08-17, live game 866, Kreek Rustgouger sighting): `banArray` here is
  // ServerJava StepEndTurn.reportSecretWeaponsUsed()'s INITIAL secret-weapon roll (often an
  // unconditional auto-flag — Kreek's roll was [0] because "Secret Weapon" has no threshold, so
  // banArray was true for him every time regardless of outcome). It is NOT the final send-off:
  // Argue the Call (report `argueTheCall`), a bribe (`bribesRoll`), or "I'll be back!"
  // (`skillUse`/skillUse:"ignoreSentOff", see StepEndTurn L969-976) can still save the player —
  // Kreek's "I'll be back!" did exactly that on the wire. The old copy asserted "banned:" as
  // fact, so the log flatly (and wrongly) declared him sent off one line before the very report
  // that says he wasn't — read in isolation that looks like Secret Weapon silently failed to
  // send him off. Wording now describes the flag, not a verdict; the resolution reports (already
  // rendered via the generic argueTheCall/bribesRoll/skillUse formatters) carry the outcome.
  // Owner 10-16: ReportArgueTheCallRoll {playerId, successful, coachBanned, roll, staysOnPitch, friendsWithRef, biasedRefs}.
  // Target 6+ (5+ with Friends with the Ref), less one per Biased Referee (upstream ArgueTheCallMessage).
  argueTheCall: (r, g) => {
    const a = argueTheCallRows(r, g);
    return `${a.head} ${a.children.join(' ')} | ${a.dice}`;
  },
  secretWeaponBan: (r, g) => {
    const ids = Array.isArray(r.playerIds) ? (r.playerIds as string[]) : [];
    const bans = Array.isArray(r.banArray) ? (r.banArray as unknown[]) : [];
    const flagged = ids.filter((_, i) => !!bans[i]).map((pid) => pn(g, pid));
    return flagged.length
      ? `Secret Weapon${flagged.length > 1 ? 's' : ''} up for send-off: ${flagged.join(', ')}`
      : 'no Secret Weapon send-off this drive';
  },
  pumpUpTheCrowdReRollLost: (r, g) => `${teamName(g, r.teamId)} loses ${r.rerollPumpUpTheCrowdOneDrive ?? '?'} Pump Up The Crowd reroll(s)`,
  showStarReRollLost: (r, g) => `${teamName(g, r.teamId)} loses ${r.rerollShowStarOneDrive ?? '?'} Show Star reroll(s)`,
  prayersAndInducementsBought: (r, g) => boughtLine(r, g),
  prayerRoll: (r) => {
    const prayer = prayerForRoll(r.roll);
    return `${r.teamName ?? 'a team'} prays to Nuffle: ${hiddenTag('rolls ')}${r.roll ?? '?'}`
      + (prayer ? ` — ${prayer.name}` : '');
  },
  prayerAmount: (r) => `${r.teamName ?? 'a team'} receives ${r.prayerAmount ?? ''} prayer(s) to Nuffle`,
  prayerEnd: (r) => `prayer to Nuffle ends${r.prayer ? ` (${humanize(String(r.prayer))})` : ''}`,
  prayerWasted: (r) => `prayer to Nuffle wasted${r.prayer ? ` (${humanize(String(r.prayer))})` : ''}`,

  // #10x (owner 08-17, live game 864 sighting): a single turnEnd report can fold a
  // touchdown + a whole KO-recovery roll batch (+ heat exhaustion) into one report —
  // upstream ReportTurnEnd carries them all as sub-arrays on ONE wire message. The old
  // formatter joined every part with '; ' into ONE log line, which reads as a wall of
  // text once several players recover/stay-out on the same turn. turnEndLines() below
  // is the single source of truth for the parts; this formatter keeps the OLD joined
  // single-line text (still used by formatReport/formatReportDisplay callers), while
  // formatReportLines() (the new multi-line entry point) renders each part as its own
  // log line — TD always its own line, KO recoveries grouped+split by outcome, heat
  // exhaustion kept joined exactly as before (unregressed) but on its own line.
  turnEnd: (r, g) => turnEndLines(r, g).join('; '),
  // Owner 10-16: the declaration line reads as upstream's ("<Player> starts a Move Action."); shown in the match log.
  // Astra 10-16: exactly upstream's description, and nothing for the values upstream keeps silent.
  playerAction: (r, g) => { const d = playerActionDescription(r.playerAction); return d ? `${pn(g, r.actingPlayerId ?? r.playerId)} ${d}.` : ''; },
  // Owner 10-16: an activation the server cleared before it logged anything (store: activationCancelReport)
  playerActionCancelled: (r, g) => `${pn(g, r.actingPlayerId ?? r.playerId)} cancels their ${playerActionLabel(r.playerAction)} action.`,
  skillUse: (r, g) => String(r.skill ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase() === 'reliable'
      && String(r.skillUse ?? '') === 'fumbledPlayerLandsSafely'
    ? `play: Reliable used (${pn(g, r.playerId)})`
    : /^cancel[A-Z]/.test(String(r.skillUse ?? ''))
      // Owner 09-05: automatic cancels (Juggernaut vs Wrestle/Fend/Stand Firm, Tackle vs Dodge…) read as a cancel.
      ? `${pn(g, r.playerId)}: ${r.skill ?? 'a skill'} cancels ${String(r.skillUse).slice(6).replace(/([a-z])([A-Z])/g, '$1 $2')}!`
      // Astra 10-15: the server reports a declined skill too (used: false) - it is not "used"
      : r.used === false ? `${pn(g, r.playerId)} does not use ${r.skill ?? 'a skill'}` : `${pn(g, r.playerId)} uses ${r.skill ?? 'a skill'}`,
  // Owner #83 (07-18): a GATED reroll source (Loner, Pro) must roll to GRANT the reroll — the `reRoll` report
  // (ReportReRoll) carries that roll + pass/fail (wire fields `roll`/`successful`), which the old formatter dropped,
  // so a failed Loner/Pro vanished from the log (the reported "Loner roll missing"). Surface roll + outcome whenever
  // the wire carries a gating roll (roll>0). Plain team/skill rerolls carry no gate (roll 0, always successful) →
  // byte-unchanged. ⚖: displays sent data only (no target derivation — ReportReRoll carries no minimumRoll).
  // Owner 10-16: "<Player> uses <reroll source> to reroll" ("uses a team reroll to reroll", "uses Pro to reroll",
  // "uses the Leader reroll to reroll"); a gated source adds its roll and outcome.
  reRoll: (r, g) => {
    const src = rerollSourcePhrase(r.reRollSource);
    const roll = r.roll;
    // Owner 10-15 (Astra pass 8): only a gate source's roll grants or denies (Pro, Loner, team reroll); another
    // source's roll is the replacement's own (Blind Rage: successful false roll 3, then the rerolled Dauntless), so it
    // never reads "FAILED | no reroll".
    if (typeof roll === 'number' && Number.isInteger(roll) && roll > 0 && isGateRerollSource(typeof r.reRollSource === 'string' ? r.reRollSource : null)) {
      const outcome = r.successful === false ? 'FAILED | no reroll' : 'passed';
      return `${pn(g, r.playerId)} uses ${src} to reroll | rolled ${d6(roll)}, ${outcome}`;
    }
    return `${pn(g, r.playerId)} uses ${src} to reroll`;
  },
  cardEffectRoll: (r) => `${humanize(String((r.card as { name?: unknown } | null)?.name ?? r.card ?? 'card'))}: ${hiddenTag('rolls ')}${d6(r.roll)}${r.cardEffect ? ` | ${humanize(String(r.cardEffect))}` : ''}`,
  foul: (r, g) => `${pn(g, r.playerId ?? r.attackerId)} fouls ${pn(g, r.defenderId)}`,
  // Row26 (owner sighting 08-17, game 866, 22:16:33): ReportReferee (NoDiceReport, ffb-common
  // report/mixed/ReportReferee.java:19-42) followed a foul+injury pair with no client line at all —
  // the reportId had no formatter entry (silently fell through) AND was excluded from the default
  // (non-debug) log gate (d6Log.ts DICE_REPORT_IDS, reportCarriesDisplayedDice). The wire never names
  // the fouler; upstream's own client renders it from `game.getActingPlayer()` at report-render time
  // (ffb-client-logic/.../mixed/RefereeMessage.java:17-26) — the acting player set by the preceding
  // foulMove modelChange is untouched by the empty-modelChangeArray foul/injury/referee syncs, so it's
  // still the fouler when this report streams. Mirror that: no playerId on the report itself, read
  // g.actingPlayer.
  referee: (r, g) => {
    const fouler = pn(g, g?.actingPlayer?.playerId);
    if (!r.foulingPlayerBanned) return `the referee doesn't spot the foul`;
    return r.underScrutiny
      ? `${fouler} is sent off | Under Scrutiny!`
      : `${fouler} is sent off | the referee spots the foul`;
  },
  injury: (r, g) => {
    // Owner 2026-07-05: surface the ARMOUR (and injury) dice in the log — the roll
    // lives inside the injury report as armorRoll/injuryRoll (there is no standalone
    // armour report). Owner 08-24: use dice-first copy and surface an optional additive
    // skill modifier only where the authoritative result proves that it was consumed.
    // ⚖ SERVER-DERIVED: every part is a stated field of ReportInjury (ffb-common
    // report/mixed/ReportInjury.java toJsonValue) — armorRoll/armorBroken/armorModifiers,
    // injuryRoll/injuryModifiers, casualtyRoll, seriousInjury, and `injury` (the FINAL
    // PlayerState the server resolved, thresholds + Thick Skull/Stunty already applied
    // server-side). Modifier NUMERIC values and a generic "consumed" bit are NOT on the
    // wire (the arrays carry applicable skill NAMES). The phase-specific helpers above
    // only abbreviate a conditional +1 skill where upstream sequencing or a crossed
    // injury-table boundary proves use; ambiguous/merely available names stay absent.
    const name = pn(g, r.defenderId ?? r.playerId);
    const ar = Array.isArray(r.armorRoll) ? (r.armorRoll as number[]) : null;
    const ir = Array.isArray(r.injuryRoll) ? (r.injuryRoll as number[]) : null;
    const broke = !!r.armorBroken;
    // Owner 08-24: ordinary block-family reports use the requested dice-first form. Distinct
    // causal leads remain, keyed on the report's server-stated injuryType wire name —
    //   foul      → "<Fouler> fouls <Target>" (fouler = the report's attackerId; every foul
    //               type's name starts with "foul" — "foul"/"foulForSpp"/"foulWithChainsaw"/
    //               "foulForSppWithChainsaw", exactly upstream's isFoul() set, ffb-common
    //               injury/Foul.java + subclasses)
    //   knockdown → no lead (block-family names start with "block"; the injury sentence names
    //               the target once after the injury dice)
    //   failed move → "<Target> falls down!" for the server's dropDodge/dropGfi injury types.
    //   other       → today's bare player-name prefix.
    const injuryTypeName = typeof r.injuryType === 'string' ? r.injuryType : '';
    const normalizedInjuryType = injuryTypeName.toLowerCase();
    const isCrowdPush = normalizedInjuryType === 'crowdpush' || normalizedInjuryType === 'crowdpushforspp';
    const isFailedMove = normalizedInjuryType === 'dropdodge' || normalizedInjuryType === 'dropgfi';
    const isBlockFamily = normalizedInjuryType.startsWith('block');
    const isFoulInjury = injuryTypeName.startsWith('foul');
    // Owner 10-13: a foul reads "<Fouler> fouls <Target> | armour .. | Injury: ..". The fouler is the report's
    // attackerId (ReportInjury sends it for every foul type); if it is ever absent, fall back to the acting
    // player exactly as the `referee` formatter does (a foul is always made by the acting player).
    const foulerId = isFoulInjury
      ? (typeof r.attackerId === 'string' && r.attackerId ? r.attackerId : g?.actingPlayer?.playerId)
      : undefined;
    // Owner 10-15 (both styles): a Stab names the stabber (attackerId) and the stabbed player: "<A> stabs <D>!" when
    // the armour broke, "<A> fails to stab <D>." when it held, then the armour (and injury) roll like a foul line.
    const stabberId = normalizedInjuryType === 'stab' && typeof r.attackerId === 'string' && r.attackerId ? r.attackerId : undefined;
    // Owner 10-15: the vomit landing on the vomiter (upstream passes the vomiter as both attacker and defender)
    const selfVomitId = normalizedInjuryType === 'projectilevomit' && isSelfVomit(r, g) ? String(r.defenderId ?? r.playerId) : undefined;
    const attributedId = foulerId ?? stabberId ?? selfVomitId;
    const attacker = typeof r.attackerId === 'string' && r.attackerId ? pn(g, r.attackerId) : '';
    const genericCause = humanize(injuryTypeName || 'injury');
    const armourCause = isBlockFamily
      ? `Block${attacker ? ` by ${attacker}` : ''}`
      : injuryTypeName.startsWith('foul')
        ? `Foul${attacker ? ` by ${attacker}` : ''}`
        : isFailedMove
          ? (normalizedInjuryType === 'dropgfi' ? 'Failed Rush' : 'Failed Dodge')
          : isCrowdPush
            ? 'Crowd push'
            : `${genericCause.charAt(0).toUpperCase()}${genericCause.slice(1)}`;
    const lead: string = isCrowdPush
      ? `${name} is pushed into the crowd`
      : foulerId
        ? `${pn(g, foulerId)} fouls ${name}`
        : stabberId
          ? (broke ? `${pn(g, stabberId)} stabs ${name}!` : `${pn(g, stabberId)} ${FAILS} to stab ${name}.`)
        : selfVomitId
          ? `${name} vomits all over themselves!`
        : isBlockFamily
          ? ''
          : isFailedMove
            ? `${name} falls down!`
            : name;
    // Owner 08-19 (updates the 08-18 emoji form): the S-tag run is now the WORD "armour" —
    // the view hides it under the breastplate icon (icon then dice, no visible word), while
    // copied text reads "armour [2, 6] broken!". The 🛡 emoji leaves the text entirely.
    // Owner 08-19 (quiet-success grammar): "held" is SUPPRESSED — a held line ends at the
    // dice (icon + dice, nothing after); "broken" remains explicit.
    const parts: string[] = [];
    if (ar) {
      const armourMods = armourModifierSuffix(r.armorModifiers, broke);
      const armourPart = `${armourTag('armour')} ${d6Pair(ar)}${armourMods}${broke ? ' broken!' : ''}`;
      parts.push(armourPart);
      const attributedArmour = attributedId ? `${lead} | ${armourPart}` : `${name} | ${armourCause} | ${armourPart}`;
      // An armour roll that held never has an injury phase. Preserve that normal
      // report grammar even if a malformed payload happens to carry extra dice.
      // Owner 10-15: a chainsaw HIT whose armour holds says so (both styles; owner spelling "armor")
      const sawId = typeof r.attackerId === 'string' && r.attackerId ? r.attackerId : g?.actingPlayer?.playerId;
      if (!broke && (normalizedInjuryType === 'chainsaw' || normalizedInjuryType === 'chainsawforspp') && sawId && sawId !== (r.defenderId ?? r.playerId)) {
        return `${attributedArmour}\n${pn(g, sawId)}'s chainsaw ${FAILS} to cut through ${name}'s armor!`;
      }
      if (!broke || !ir) return attributedArmour;
    }
    // Crowd pushes bypass armour by rule, so their authoritative report has no
    // armorRoll. Do not replace its real injury dice/outcome with a generic line.
    if (!ir) return isCrowdPush ? lead : `${name} is injured`;
    const injuryMods = injuryModifierSuffix(r.injuryModifiers, ir, r.injury);
    const cr = Array.isArray(r.casualtyRoll) && (r.casualtyRoll as number[]).length ? (r.casualtyRoll as number[]) : null;
    // Dice lead; the player + server-stated effect follow as a sentence. An unmapped base
    // remains fail-soft while casualty detail continues to use the authoritative tail.
    const effect = injuryEffectSentence(r.injury, name) ?? (cr ? `${name} is injured!` : `${name} is injured.`);
    // Casualty result: the wire's seriousInjury name (lasting injury), else the injury PlayerState description.
    // Owner 09-05: the casualty die is not surfaced; and the report renders as THREE log lines —
    //   1. <name> | <cause> | armour [..] broken!; Injury: [..]
    //   2. <name> is injured! / is stunned! / is KO'd!
    //   3. <name> is badly hurt / is seriously injured: <lasting injury> / is killed   (casualties only)
    const outcome = injuryOutcome(r.injury);
    // Owner 09-06: the casualty line reads "<Player> is <Casualty Result>!" — the wire's result name in title case
    // with its tag intact ("Seriously Hurt (MNG)", "Smashed Knee", "Serious Injury (NI)"), never the
    // "seriously injured: seriously hurt ( m n g)" spell-out.
    const casualtyLine = cr
      ? `${name} is ${r.seriousInjury ? casualtyResultLabel(r.seriousInjury) : titleCase(outcome ?? 'a casualty')}!`
      : '';
    parts.push(`Injury: ${d6Pair(ir)}${injuryMods}`);
    const body = parts.join(attributedId ? ' | ' : '; ');
    const head = ar && !attributedId ? `${name} | ${armourCause} | ${body}` : lead ? `${lead} | ${body}` : body;
    return [head, effect, casualtyLine].filter(Boolean).join('\n');
  },
  // Owner 2026-07-06 (finding C): the apothecary report is NOT a pass/fail d6 — it
  // has no `roll`/`successful`, it RE-ROLLS the casualty (casualtyRoll + the new
  // seriousInjury). The generic skillRoll printed "rolls undefined — fails" for
  // every apothecary use; report the casualty re-roll + resulting injury instead.
  apothecaryRoll: (r, g) => {
    const casualty = Array.isArray(r.casualtyRoll) ? (r.casualtyRoll as number[]) : [];
    const name = pn(g, r.playerId);
    // An empty casualty roll is always a decline (upstream StepApothecary DO_NOT_USE_APOTHECARY). Astra r1 P2: never read
    // the model here - BB2020 runs Regeneration in the same step after the decline, and its success sets RESERVE too.
    // The bench sentence (owner 10-21) comes only from apothecaryChoice with playerState 9.
    if (!casualty.length) return `${name} is not treated by the apothecary.`;
    const version = rulesVersion(g);
    // BB2020/25 use the injury line's casualtyResultLabel ("Seriously Hurt (MNG)"); BB2016 keeps its label.
    const bandVersion = version === 'BB2020' || version === 'BB2025';
    const injury = r.seriousInjury
      ? (bandVersion ? casualtyResultLabel(r.seriousInjury) : seriousInjuryLabel(r.seriousInjury))
      : (bandVersion ? titleCase(playerStateResult(r.playerState)) : playerStateResult(r.playerState));
    if (bandVersion || version === 'BB2025') {
      // Owner 10-14: the D16 alone; the second die (a D6) only picks a lasting injury (modified D16
      // 13-14), never MNG, NI or death. Decide from the server-sent injury names: the final one, or
      // seriousInjuryOld when the BB2025 stat floor resolved a D6-selected injury down to MNG.
      const usedD6 = [r.seriousInjury, r.seriousInjuryOld].some((si) =>
        typeof si === 'string' && si !== '' && casualtyTierLabel(si, 6)?.tier === 'LASTING_INJURY');
      const lasting = usedD6 && casualty.length > 1 ? `, lasting injury ${d6(casualty[1])}` : '';
      // Casualty modifiers: names as sent (their values are not on the wire), never recomputed.
      const mods = modifierNameList(r.casualtyModifiers);
      const modText = mods.length ? ` (${mods.join(', ')})` : '';
      return `${name} is treated by the apothecary | casualty roll ${String(casualty[0])}${modText}${lasting}: ${injury}`;
    }
    const d6Index = version === 'BB2016' ? 0 : -1;
    const dice = casualty.map((roll, index) => index === d6Index ? d6(roll) : String(roll)).join(', ');
    return `${name} is treated by the apothecary | casualty roll [${dice}]: ${injury}`;
  },
  // Upstream ffb-server/.../bb2025/shared/StepApothecary.java:528-537 converts KO to STUNNED and emits
  // ReportApothecaryChoice; ffb-common/.../PlayerState.java:13-14 defines the wire states 4 and 5.
  apothecaryChoice: (r, g) => {
    const name = pn(g, r.playerId);
    if ((Number(r.playerState) & 0xff) === 4) {
      return `${name} is treated by the apothecary. They are only stunned.`;
    }
    // Owner 10-21: USE on a Badly Hurt result (no casualty reroll, StepApothecary.java:528-537) sends the player to RESERVE.
    if ((Number(r.playerState) & 0xff) === 9) return apothecaryBenchSentence(name);
    return `${name}'s apothecary result: ${playerStateResult(r.playerState)}.`;
  },
  // Corner direction is D3, other direction is D6, and the wire carries no corner flag.
  // Keep direction numeric; the two distance dice are always D6.
  throwIn: (r) => {
    const distance = Array.isArray(r.distanceRoll) ? d6Pair(r.distanceRoll) : '';
    if (isFieldDirection(r.direction)) {
      const squares = Array.isArray(r.distanceRoll) ? (r.distanceRoll as number[]).reduce((sum, die) => sum + (Number(die) || 0), 0) : null;
      return `The crowd throws the ball back in ${dirTag(r.direction)}${r.directionRoll != null ? ` (${r.directionRoll})` : ''}`
        + `${squares != null ? `, ${squares} squares (${distance})` : ''}`;
    }
    return `the crowd throws the ball back in ${r.direction ?? '?'}${r.directionRoll != null ? ` (direction ${r.directionRoll})` : ''}${distance ? `, distance ${distance}` : ''}`;
  },
  scatterBall: (r) => {
    const rollList = Array.isArray(r.rolls) ? (r.rolls as number[]) : [];
    const dirs = Array.isArray(r.directionArray) ? r.directionArray.filter(isFieldDirection) : [];
    if (dirs.length) {
      return `The ball scatters ${dirs.map((dir, i) => `${dirTag(dir)}${rollList[i] != null ? ` (${rollList[i]})` : ''}`).join(', ')}`;
    }
    const rolls = rollList.join(', ');
    return `ball scatters${rolls ? ` (${rolls})` : ''}`;
  },
  startHalf: (r) => `--- half ${r.half ?? ''} begins ---`,
  // owner 2026-07-03 r6: the fanFactor report fires once PER TEAM — name the team
  // and show the dedicated fans + d3 roll + total instead of a bare "rolled".
  fanFactor: (r, g) => {
    const who = teamName(g, r.teamId);
    const prefix = who !== '?' ? `${who} ` : '';
    const fans = r.dedicatedFans;
    const roll = r.dedicatedFansRoll;
    const total = r.dedicatedFansResult ?? (fans != null && roll != null ? Number(fans) + Number(roll) : undefined);
    if (fans == null && roll == null) return `${prefix}fan factor rolled`;
    const bits: string[] = [];
    if (fans != null) bits.push(`${fans} dedicated fans`);
    if (roll != null) bits.push(`roll ${roll}`);
    return `${prefix}fan factor: ${bits.join(' + ')}${total != null ? ` = ${total}` : ''}`;
  },
  extraReRoll: (r, g) => {
    const home = g?.teamHome.teamName ?? 'Home';
    const away = g?.teamAway.teamName ?? 'Away';
    const version = rulesVersion(g);
    // Owner 10-13: each team's die wears that team's colour (the report's teamId is the WINNER, not the roller).
    const roll = version === 'BB2020' || version === 'BB2025'
      ? (value: unknown, side: ServerSide) => d6(value, 'roll', side)
      : (value: unknown) => String(value ?? '?');
    let winner = typeof r.teamId === 'string' && r.teamId ? teamName(g, r.teamId) : 'both teams';
    if (version === 'BB2016') {
      winner = r.homeGainsReRoll && r.awayGainsReRoll ? 'both teams'
        : r.homeGainsReRoll ? home : r.awayGainsReRoll ? away : 'neither team';
    }
    return `Brilliant Coaching | ${home} ${roll(r.rollHome, 'home')}, ${away} ${roll(r.rollAway, 'away')} | ${winner} gain a reroll`;
  },
  cheeringFans: (r, g) => {
    const home = g?.teamHome.teamName ?? 'Home';
    const away = g?.teamAway.teamName ?? 'Away';
    const winners = Array.isArray(r.teamIdsAdditionalAssist)
      ? r.teamIdsAdditionalAssist.map((id) => teamName(g, id)).join(' and ')
      : '';
    const rerolled = Array.isArray(r.teamIdsReRolledCheeringFangs)
      ? r.teamIdsReRolledCheeringFangs.map((id) => teamName(g, id)).join(' and ')
      : '';
    return `Cheering Fans | ${home} ${d6(r.rollHome)}, ${away} ${d6(r.rollAway)}`
      + (winners ? ` | ${winners} gain an offensive assist` : ' | no team gains an assist')
      + (rerolled ? ` (${rerolled} rerolled)` : '');
  },
  kickoffDodgySnack: (r, g) => {
    const home = g?.teamHome.teamName ?? 'Home';
    const away = g?.teamAway.teamName ?? 'Away';
    const affected = Array.isArray(r.playerIds) && r.playerIds.length
      ? ` | ${r.playerIds.map((id) => pn(g, id)).join(', ')} had a dodgy snack`
      : '';
    return `Dodgy Snack | ${home} ${d6(r.rollHome)}, ${away} ${d6(r.rollAway)}${affected}`;
  },
  kickoffPitchInvasion: (r, g) => {
    const home = g?.teamHome.teamName ?? 'Home';
    const away = g?.teamAway.teamName ?? 'Away';
    const homeRolls = Array.isArray(r.rollsHome) ? d6List(r.rollsHome) : d6(r.rollHome);
    const awayRolls = Array.isArray(r.rollsAway) ? d6List(r.rollsAway) : d6(r.rollAway);
    const affected = Array.isArray(r.playersAffectedHome) || Array.isArray(r.playersAffectedAway)
      ? [...(Array.isArray(r.playersAffectedHome) ? r.playersAffectedHome : []), ...(Array.isArray(r.playersAffectedAway) ? r.playersAffectedAway : [])].filter(Boolean).length
      : Number(r.amount ?? 0);
    return `Pitch Invasion | ${home} ${homeRolls}, ${away} ${awayRolls} | ${affected} player${affected === 1 ? '' : 's'} stunned`;
  },
  kickoffThrowARock: (r, g) => `Throw a Rock | ${g?.teamHome.teamName ?? 'Home'} ${d6(r.rollHome)}, ${g?.teamAway.teamName ?? 'Away'} ${d6(r.rollAway)}`,
  kickoffRiot: (r) => r.roll ? `Riot | rolled ${d6(r.roll)}` : 'Riot | no roll required',
  spectators: (r, g) => {
    const home = Array.isArray(r.spectatorRollHome) ? d6List(r.spectatorRollHome, ' + ') : '?';
    const away = Array.isArray(r.spectatorRollAway) ? d6List(r.spectatorRollAway, ' + ') : '?';
    return `Spectators | ${g?.teamHome.teamName ?? 'Home'} ${home}, ${g?.teamAway.teamName ?? 'Away'} ${away}`;
  },
  fanFactorRoll: (r, g) => {
    const home = Array.isArray(r.fanFactorRollHome) ? d6List(r.fanFactorRollHome, ' + ') : 'conceded';
    const away = Array.isArray(r.fanFactorRollAway) ? d6List(r.fanFactorRollAway, ' + ') : 'conceded';
    return `Fan factor | ${g?.teamHome.teamName ?? 'Home'} ${home}, ${g?.teamAway.teamName ?? 'Away'} ${away}`;
  },
  // #169 [SOURCE] ReportDedicatedFans (mixed/end/StepDedicatedFans — the BB2025 POST-MATCH dedicated-fans roll, NOT
  // the pregame `fanFactor` report). Both-teams fields: rollHome/dedicatedFansModifierHome + rollAway/
  // dedicatedFansModifierAway (the empty DRAW form carries no roll). The old `r.dedicatedFans` read was mis-keyed
  // (that field lives on the pregame fanFactor report) → always hit the fallback.
  dedicatedFans: (r, g) => {
    const rh = r.rollHome, ra = r.rollAway;
    if (rh == null && ra == null) return 'Dedicated fans unchanged (draw)';
    const concededTeamId = r.conceded ? String(r.teamId ?? '') : '';
    const line = (team: string, teamId: string | undefined, roll: unknown, mod: unknown) => {
      const m = Number(mod ?? 0);
      const die = teamId && teamId !== concededTeamId ? d6(roll) : String(roll ?? '?');
      return `${team}: rolled ${die} → ${m >= 0 ? '+' : ''}${m}`;
    };
    return `Dedicated fans | ${line(g?.teamHome.teamName ?? 'Home', g?.teamHome.teamId, rh, r.dedicatedFansModifierHome)} · ${line(g?.teamAway.teamName ?? 'Away', g?.teamAway.teamId, ra, r.dedicatedFansModifierAway)}`;
  },

  // ReportPenaltyShootout (BB2025 extra-time roll-off; wire verified vs ffb-common
  // report/mixed/ReportPenaltyShootout). Per-round: rollHome/rollAway d6s, homeTeam =
  // did HOME win this round (null = tie → re-roll, no slot consumed), rollCount = round
  // label, penaltyScoreHome/Away = running tally, teamId = winner once decided. transform()
  // mirrors per-recipient so home* is the reading client's own team. Log stays lowercase
  // (log convention); the prominent "Penalty Shootout" copy lives in the summary dialog.
  penaltyShootout: (r, g) => {
    const home = g?.teamHome.teamName ?? 'home team';
    const away = g?.teamAway.teamName ?? 'away team';
    const round = r.rollCount ? `round ${r.rollCount}` : 'shootout';
    const outcome = r.homeTeam == null ? 'tie | reroll' : `${r.homeTeam ? home : away} scores`;
    const decided = typeof r.teamId === 'string' && r.teamId
      ? ` | ${teamName(g, r.teamId)} wins the shootout` : '';
    return `penalty shootout ${round}: ${home} ${d6(r.rollHome)}, ${away} ${d6(r.rollAway)} | ${outcome} (${r.penaltyScoreHome ?? 0}–${r.penaltyScoreAway ?? 0})${decided}`;
  },
};

/** Owner 10-15 (icon audit): every report type the log has a line for - the formatter table, plus the types the
 *  generic line renders with their dice - so a test can keep each one in the action icon table. */
export const LOG_REPORT_TYPES: readonly string[] = [...Object.keys(formatters), ...Object.keys(genericD6Fields)];

/** Owner 10-16 (Astra): upstream's narration of a declaration, exactly (ffb-common PlayerAction.java descriptions;
 *  PlayerActionMessage prints "<Player> <description>." only when the description exists). null = upstream is silent
 *  only for the server's internal states (removeConfusion). Owner 10-16: the SELECT stages upstream keeps silent (blitz /
 *  gaze / pass / foul / hand over / throw team-mate ...) are narrated like their move stage, since this client declares
 *  through them and the server reports the first stage only. */
const PLAYER_ACTION_DESCRIPTIONS: Readonly<Record<string, string | null>> = {
  move: 'starts a Move Action', block: 'starts a Block Action', blitz: 'starts a Blitz Action', blitzMove: 'starts a Blitz Action', blitzSelect: 'starts a Blitz Action',
  handOver: 'starts a Hand Over Action', handOverMove: 'starts a Hand Over Action', pass: 'starts a Pass Action', passMove: 'starts a Pass Action', foul: 'starts a Foul Action',
  foulMove: 'starts a Foul Action', standUp: 'stands up', throwTeamMate: 'starts a Throw Team-mate action', throwTeamMateMove: 'starts a Throw Team-mate action',
  removeConfusion: null, gaze: 'starts a Gaze action', gazeSelect: 'starts a Gaze action', gazeMove: 'starts a Gaze action', multipleBlock: 'starts a Multi-Block Action',
  hailMaryPass: 'starts a Hail Mary Pass action', dumpOff: 'starts a Dump-Off action', standUpBlitz: 'stands up with Blitz', throwBomb: 'starts a Bomb Action', hailMaryBomb: 'starts a Hail Mary Bomb action',
  swoop: 'starts a Swoop action', kickTeamMateMove: 'starts a Kick Team-mate action', kickTeamMate: 'starts a Kick Team-mate action', treacherous: 'starts a Treacherous action', wisdomOfTheWhiteDwarf: 'starts a Wisdom of the White Dwarf action',
  throwKey: 'readies a beer keg', raidingParty: 'starts a Raiding Party action', maximumCarnage: 'starts a Maximum Carnage action', lookIntoMyEyes: 'tries to steal the ball', balefulHex: 'starts a Baleful Hex action',
  allYouCanEat: 'starts an All You Can Eat action', putridRegurgitationMove: 'starts a Projectile Vomit action',
  putridRegurgitationBlitz: 'performs an additional Projectile Vomit attack', putridRegurgitationBlock: 'performs an additional Projectile Vomit attack',
  kickEmBlock: 'targets a downed opponent', kickEmBlitz: 'targets a downed opponent', blackInk: 'uses Black Ink', catchOfTheDay: 'uses Catch of the Day',
  thenIStartedBlastin: "starts blastin'", theFlashingBlade: 'flashes the blade', viciousVines: 'uses Vicious Vines', furiousOutburst: 'has a furious outburst',
  secureTheBall: 'secures the ball', breatheFire: 'starts a Breathe Fire action', chainsaw: 'starts a Chainsaw action', stab: 'starts a Stab action',
  projectileVomit: 'starts a Projectile Vomit action', autoGazeZoat: 'uses Hypnotic Gaze', forgo: 'forgoes the activation', incorporeal: 'becomes incorporeal',
  chomp: 'starts a Chomp action', punt: 'starts a Punt action', puntMove: 'starts a Punt action',
};
/** The narration of a declaration, or null when upstream shows nothing for it (an unknown value is silent too). */
export function playerActionDescription(action: unknown): string | null {
  return PLAYER_ACTION_DESCRIPTIONS[String(action ?? '')] ?? null;
}
/** Owner 10-16: the synthetic report the store logs when the server clears an acting player whose activation logged
 *  nothing: "<Player> cancels their Move action." Null when the open activation already has lines (it ended, not
 *  cancelled) or none is open. Always closes the activation. */
export function activationCancelReport(context: ReportLogContext): Report | null {
  const open = context.activation;
  context.activation = null;
  // Astra 10-16: an activation that logged a visible row OR committed activity in the model (a walk logs nothing) ended
  if (!open || open.lines > 0 || open.acted) return null;
  return { reportId: 'playerActionCancelled', actingPlayerId: open.playerId, playerAction: open.action };
}
/** The open activation as it stood BEFORE a report was formatted: the one that report's rows belong to (a declaration
 *  replaces it, so its own row never counts for the activation it opens). Null when none is open. */
export type OpenActivation = NonNullable<ReportLogContext['activation']>;
export function openActivationBefore(context: ReportLogContext, report: Report): OpenActivation | null {
  return String(report.reportId ?? '') === 'playerAction' ? null : context.activation ?? null;
}
/** The caller DISPLAYED `count` rows belonging to `activation` (the formatter cannot know a caller's visibility gate,
 *  live and replay gate differently, and a row surfaced late - behind a fireball - must still count for ITS activation,
 *  not whichever is open by then: Astra 10-16). */
export function noteActivationLogged(activation: OpenActivation | null, count: number): void {
  if (activation && count > 0) activation.lines += count;
}
const ACTIVITY_CHANGE_IDS = new Set(['actingPlayerSetHasMoved', 'actingPlayerSetHasBlocked', 'actingPlayerSetHasFouled', 'actingPlayerSetHasPassed',
  'actingPlayerSetHasFed', 'actingPlayerSetHasJumped', 'actingPlayerSetStandingUp', 'actingPlayerSetGoingForIt', 'actingPlayerSetDodging', 'actingPlayerSetLeaping']);
/** A frame's model changes show the open activation DID something: a flag the server raises only for an action taken
 *  (hasMoved / hasBlocked / ...), a positive current move, or the acting player changing square. A walk that rolls
 *  nothing logs nothing, so this is what separates "ended" from "cancelled" (Astra 10-16, recorded g1918823). */
export function noteActivationActivity(context: ReportLogContext, changes: readonly { modelChangeId?: string; modelChangeKey?: unknown; modelChangeValue?: unknown }[]): void {
  const open = context.activation;
  if (!open || open.acted) return;
  for (const ch of changes) {
    const id = String(ch.modelChangeId ?? '');
    if ((ACTIVITY_CHANGE_IDS.has(id) && ch.modelChangeValue === true)
      || (id === 'actingPlayerSetCurrentMove' && Number(ch.modelChangeValue) > 0)
      || (id === 'fieldModelSetPlayerCoordinate' && String(ch.modelChangeKey ?? '') === open.playerId)) { open.acted = true; return; }
  }
}

/** Owner 10-16: the wire playerAction as the action's name ("Move", "Blitz", "Hand-off", "Throw Team-Mate"). */
function playerActionLabel(action: unknown): string {
  switch (String(action ?? '')) {
    case 'move': case 'moveLeap': return 'Move';
    case 'blitz': case 'blitzMove': return 'Blitz';
    case 'block': return 'Block';
    case 'multipleBlock': return 'Multiple Block';
    case 'pass': case 'passMove': return 'Pass';
    case 'handOver': case 'handOverMove': return 'Hand-off';
    case 'foul': case 'foulMove': return 'Foul';
    case 'throwTeamMate': case 'throwTeamMateMove': return 'Throw Team-Mate';
    case 'kickTeamMate': case 'kickTeamMateMove': return 'Kick Team-Mate';
    case 'standUp': return 'Stand Up';
    case 'standUpBlitz': return 'Stand Up and Blitz';
    case 'gaze': case 'gazeMove': return 'Hypnotic Gaze';
    case 'throwBomb': return 'Throw Bomb';
    case 'throwKeg': return 'Throw Keg';
    case 'swoop': return 'Swoop';
    case 'maximumCarnage': return 'Maximum Carnage';
    case 'raidingParty': return 'Raiding Party';
    case 'lookIntoMyEyes': return 'Look Into My Eyes';
    case 'balefulHex': return 'Baleful Hex';
    case 'theFlashingBlade': return 'The Flashing Blade';
    case 'breatheFire': return 'Breathe Fire';
    case 'putridRegurgitation': case 'projectileVomit': return 'Projectile Vomit';
    case '': return 'new';
    default: return titleCase(humanize(String(action)));
  }
}

function humanize(id: string): string {
  // split camelCase, then collapse underscores / repeated spaces to a single
  // space (B9-12 G3: a reRollSource like "team_reRoll" rendered "team  re roll").
  return id
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_\s]+/g, ' ')
    .toLowerCase()
    .trim()
    // Owner 10-15 ("team re roll" -> "team reroll"): a server enum such as "Team ReRoll" / "teamReRoll" humanizes to
    // the house spelling, never "re roll".
    .replace(/\bre roll/g, 'reroll');
}

function titleCase(text: string): string {
  return text.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** Owner 09-06: the casualty result for the log line — words title-cased, any "(TAG)" kept verbatim (MNG / -MA),
 *  NI keeps its stat-down tag. "SeriouslyHurt (MNG)" -> "Seriously Hurt (MNG)"; "SmashedKnee" -> "Smashed Knee". */
function casualtyResultLabel(value: unknown): string {
  const raw = String(value);
  if (/\(\s*N\s*I\s*\)/i.test(raw)) {
    const label = titleCase(humanize(raw.replace(/\(\s*N\s*I\s*\)/i, '')).trim() || 'serious injury');
    return `${label} (${niStatDownTag('NI')})`;
  }
  const m = raw.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const words = titleCase(humanize(m ? m[1]! : raw));
  return m ? `${words} (${m[2]!.replace(/\s+/g, '').toUpperCase()})` : words;
}

/** Keep the server's NI acronym intact and give the view a structured replacement point.
 * Generic camel-case humanizing otherwise turns "(NI)" into the visibly broken "( n i)". */
function seriousInjuryLabel(value: unknown): string {
  const raw = String(value);
  if (!/\(\s*N\s*I\s*\)/i.test(raw)) return humanize(raw);
  const label = humanize(raw.replace(/\(\s*N\s*I\s*\)/i, '')).trim() || 'serious injury';
  return `${label} (${niStatDownTag('NI')})`;
}

/**
 * Owner 10-13 (home/away dice): the SERVER side of the team that owns a report's d6 dice, or null when the dice have
 * no single owner (weather, kick-off table, winnings, two-team rolls). The same attribution as the dice statistics
 * (diceStats.ts): an injury's armour / injury dice belong to the attacker's team; a block roll to the chooser; any
 * other roll to the rolling player's team, else the report's team.
 */
// Reports whose UNMARKED dice stay neutral (kick-off table, weather, fans, winnings). turnEnd (KO recovery, heat) and
// defectingPlayers mark each die with its own player's side and extraReRoll each team's die with that team; a marked
// die always wins over this report-level default (decodeDisplay).
const UNOWNED_DICE_REPORTS = new Set(['turnEnd', 'weather', 'kickoffResult', 'winningsRoll', 'kickoffDodgySnack', 'penaltyShootout',
  'winnings', 'dedicatedFans', 'cheeringFans', 'spectators', 'kickoffPitchInvasion', 'defectingPlayers', 'extraReRoll']);
export function reportDiceOwner(report: Report, game: GameJson | null): ServerSide | null {
  const id = String(report.reportId ?? '');
  if (UNOWNED_DICE_REPORTS.has(id)) return null;
  if (id === 'blockRoll' || id === 'blockReRoll') return teamServerSide(game, report.choosingTeamId);
  // Owner 10-15: an injury with no attacker (a failed rush / dodge / jump, any fall of the player's own) shows its armour
  // and injury dice in the colour of the team OPPOSING the injured player, never neutral white. Display only: the dice
  // statistics still count these rolls for nobody (diceStats.ts).
  if (id === 'injury') return playerServerSide(game, report.attackerId) ?? opposingSide(playerServerSide(game, report.defenderId));
  // Shadowing / Tentacles (upstream dice stats): BB2020 / BB2025 the roll is `defenderId`'s (the shadower / holder,
  // mixed ReportTentaclesShadowingRoll TEAM_FOR_PLAYER); BB2016 it is the OPPOSING player's escape roll (bb2016
  // ReportTentaclesShadowingRoll OPPONENT_TEAM_FOR_PLAYER of defenderId).
  if (id === 'tentaclesShadowingRoll') {
    const defender = playerServerSide(game, report.defenderId);
    return rulesVersion(game) === 'BB2016' ? opposingSide(defender) : defender;
  }
  // A caught bomb's explosion die belongs to the catcher's OPPONENT (ReportBombExplodesAfterCatch
  // OPPONENT_TEAM_FOR_PLAYER of catcherId: the thrower's side).
  if (id === 'bombExplodesAfterCatch') return opposingSide(playerServerSide(game, report.catcherId));
  // Ball & Chain's die is the acting Fanatic's.
  if (id === 'scatterPlayer') {
    const ballAndChain = actingPlayerHasBallAndChain(game);
    if (ballAndChain) return playerServerSide(game, ballAndChain);
  }
  // Astra 10-16: a declaration row is the acting player's whatever its action (no icon needed for the tint)
  if (id === 'playerAction' || id === 'playerActionCancelled') return playerServerSide(game, report.actingPlayerId) ?? playerServerSide(game, report.playerId);
  return playerServerSide(game, report.playerId) ?? teamServerSide(game, report.teamId);
}
export function formatReportDisplay(report: Report, game: GameJson | null, context = legacyReportLogContext): ReportDisplay {
  const owner = reportDiceOwner(report, game);
  const id = String(report.reportId ?? 'unknown');
  const formatter = formatters[id];
  if (formatter) {
    try {
      return decodeDisplay(withRerollLead(report, formatter(report, game, context), context, game), owner);
    } catch {
      // fall through to the generic line
    }
  }
  // Generic fallback (owner 2026-07-03 r6): surface the "who" (player/team) and
  // any roll-like values so an unmapped report still reads clearly in the log.
  const extras = ['playerId', 'teamId', 'roll', 'rolls', 'dedicatedFans', 'dedicatedFansRoll', 'minimumRoll', 'successful']
    .filter((key) => report[key] !== undefined && report[key] !== null)
    .map((key) => {
      if (key === 'playerId') return pn(game, report[key]);
      if (key === 'teamId') return teamName(game, report[key]);
      if (genericD6Fields[id]?.includes(key)) {
        const kind: D6LogToken['kind'] = key === 'minimumRoll' ? 'target' : 'roll';
        const value = report[key];
        const rendered = Array.isArray(value)
          ? `[${value.map((face) => d6(face, kind)).join(',')}]`
          : d6(value, kind);
        return `${humanize(key)} ${rendered}`;
      }
      return `${humanize(key)} ${JSON.stringify(report[key]).replace(/"/g, '')}`;
    })
    .join(', ');
  return decodeDisplay(withRerollLead(report, extras ? `${humanize(id)} | ${extras}` : humanize(id), context, game), owner);
}

export function formatReport(report: Report, game: GameJson | null, context = legacyReportLogContext): string {
  return formatReportDisplay(report, game, context).text;
}

/** #10x (owner 08-17): multi-LINE entry point — most reportIds still render as exactly one
 *  line (delegates to formatReportDisplay), but turnEnd splits into several (TD line, grouped
 *  KO-recovery lines, heat-exhaustion line) instead of one '; '-joined wall of text. Callers
 *  should log() each returned entry as its own line, in order. */
export function formatReportLines(report: Report, game: GameJson | null, context = legacyReportLogContext): ReportDisplay[] {
  const reportId = String(report.reportId ?? '');
  // Astra 10-16: a declaration upstream does not narrate produces no line at all
  if (reportId === 'playerAction' && !playerActionDescription(report.playerAction)) { noteReportLogContext(report, context, game); return []; } // the latches still advance
  const lines = formatReportLinesPlain(report, game, context);
  // read before logActionPlate consumes the hand-off latch: is this the receiver's catch of a hand-off?
  const handoffCatch = isHandoffCatch(report, context);
  // Owner 10-15: after the formatter ran, so a `block` report has already latched its attacker into the context.
  // Every line of the report belongs to the same action (an injury's dice line, its effect sentence and its casualty
  // line are all the block's / foul's / failed move's), so each wears the plate.
  const action = logActionPlate(report, game, context, reportDiceOwner(report, game));
  // turnEnd has no single owner, but its lines do: the touchdown line is the scorer's team, each KO recovery line its
  // player's team (turnEndLines order: TD / "turn ends", recoveries, heat). A row tint per line, never per report.
  if (String(report.reportId ?? '') === 'turnEnd' && lines.length) {
    context.activation = null; // owner 10-16: a turn end closes the open activation (this branch returns early)
    const recoveries = Array.isArray(report.knockoutRecoveryArray) ? (report.knockoutRecoveryArray as Report[]) : [];
    const sides = [playerServerSide(game, report.playerIdTouchdown) ?? context?.turnEndSide ?? null, ...recoveries.map((r) => playerServerSide(game, r.playerId))];
    safeLatchBlockFlow(report, game, context); // a turn end closes any open block sequence
    return lines.map((line, index) => {
      const side = sides[index] ?? null;
      // owner 10-15: each KO recovery row (index 1..n) wears the KO lettering as its action icon
      const isRecovery = index >= 1 && index <= recoveries.length;
      if (isRecovery) return { ...line, action: { kind: 'ko' as const, side } };
      // the first row: the touchdown (the scorer's team) or "turn ends"; any row after the recoveries: heat exhaustion
      if (index === 0) return { ...line, action: { kind: report.playerIdTouchdown ? 'touchdown' as const : 'turnEnd' as const, side } };
      return { ...line, action: { kind: 'heat' as const, side } };
    });
  }
  const decorated = action ? lines.map((line) => ({ ...line, action })) : lines;
  // Owner 10-15 (Graphical only): the Graphical version of each line, from the same report and the block sequence the
  // context holds; then advance the sequence. A failure here never touches the Text line.
  let graphical: (GraphicalLine | null | undefined)[] = [];
  try {
    // owner 10-16: the declaration is the head (0); its cancel line always sits one step under it (Astra: the
    // activation is already closed when the cancel report is formatted, so the step is explicit here)
    graphical = reportId === 'playerAction' ? decorated.map((line) => graphicalFromLine(line, 0))
      : reportId === 'playerActionCancelled' ? decorated.map((line) => graphicalFromLine(line, 1))
      : graphicalLines(report, game, context, decorated, handoffCatch);
  } catch {
    graphical = [];
  }
  // A block sequence's step rows wear the BLOCKER's tint (the server names the opposing player as the "attacker" of a
  // self knockdown's injury, so the report's own owner would flip the colour mid-sequence).
  // Astra 10-15: only a report that actually pairs with the sequence (an injury must pass injuryPairsWithFlow) - an
  // unpaired injury's casualty row is indented under ITS injury, not the block, and keeps its own tint.
  const pairsWithFlow = String(report.reportId ?? '') !== 'injury' || injuryPairsWithFlow(report, context);
  // owner 10-16: the uphill choice row keeps the CHOOSER's seat tint (the defender's coach picked the die)
  const uphillChoice = reportId === 'blockChoice' && isUphillChoice(report, game, context.flowAttackerId ?? null);
  const flowSide = context.flowAttackerId && pairsWithFlow && !uphillChoice && BLOCK_FLOW_REPORTS.has(String(report.reportId ?? '')) ? playerServerSide(game, context.flowAttackerId) : null;
  const chooserSide = uphillChoice ? teamServerSide(game, report.choosingTeamId) : null;
  safeLatchBlockFlow(report, game, context);
  // Owner 10-16: the activation structure. A narrated declaration opens an activation and is its head (indent 0); the
  // cancel line and every other line logged while it is open sit one step under it (a block's steps two, their outcome
  // rows three); a turn end closes it and stays a head row.
  const opensActivation = reportId === 'playerAction';
  if (reportId === 'turnEnd') context.activation = null;
  const inside = !opensActivation && !!context.activation;
  const rows = decorated.map((line, index) => {
    // Astra 10-16: a row with no Graphical variant shows its Text form in the Graphical style, so inside an activation
    // it gets one built here and steps in like the rest (an explicit null stays hidden)
    const g0 = graphical[index] === undefined && inside ? graphicalFromLine(line, 0) : graphical[index];
    if (g0 === undefined) return line;
    const g = inside && g0 ? indentUnderActivation(g0) : g0;
    const stepAction = chooserSide ? { ...(line.action ?? { kind: null }), side: chooserSide }
      : flowSide && g && g.indent > 0 ? { ...(line.action ?? { kind: null }), side: flowSide } : line.action;
    return stepAction ? { ...line, action: stepAction, g } : { ...line, g };
  });
  if (opensActivation) context.activation = { playerId: String(report.actingPlayerId ?? report.playerId ?? ''), action: String(report.playerAction ?? ''), lines: 0, acted: false };
  if (reportId === 'playerActionCancelled') context.activation = null;
  return rows;
}

/** Owner 10-16: a block choice made by the DEFENDER's coach (an uphill block): the report's dice count is negative, or
 *  its choosing team is not the blocker's team. */
function isUphillChoice(report: Report, game: GameJson | null, attackerId: string | null): boolean {
  if (Number(report.nrOfDice) < 0) return true;
  const chooser = teamServerSide(game, report.choosingTeamId);
  const blocker = attackerId ? playerServerSide(game, attackerId) : null;
  return !!chooser && !!blocker && chooser !== blocker;
}

/** One small indent step under the open activation's head (capped at the deepest level the view styles). */
function indentUnderActivation(g: GraphicalLine): GraphicalLine {
  const bump = (line: GraphicalLine): GraphicalLine => ({ ...line, indent: Math.min(3, line.indent + 1) as 0 | 1 | 2 | 3, ...(line.more ? { more: line.more.map(bump) } : {}) });
  return bump(g);
}

// ---- Easter eggs (owner 10-15) ------------------------------------------------------------------------------------
//
// About 1 in 100 of these rolls read a joke wording instead, in both log styles. The pick is deterministic per server
// event - a stable hash of the event identity (game id, server command number, report index) - so the same roll shows
// the same words on every re-render, for both coaches, spectators and replays. The plain `text` (bug-report logs)
// always keeps the normal wording.

/** FNV-1a 32-bit of the event key, a stable spread for the 1-in-100 pick. */
export function logEventHash(eventKey: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < eventKey.length; i++) {
    hash ^= eventKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
/** Does this event get its easter egg? About 1 in 100 event keys do. */
export function logEasterEggHit(eventKey: string): boolean {
  return logEventHash(eventKey) % 100 === 0;
}
/** The event identity the egg pick hashes. Owner asked for game id + command number / report index, but downloaded
 *  replays renumber commands (liveSpectateHistory), so the stable identity is the game id plus the server's report
 *  itself (its fields in key order): the same in live play for both coaches, in spectate and in replay. Two reports
 *  identical in every field share their pick, which keeps it deterministic. `commandNr` / `reportIndex` are kept in
 *  the signature for the callers but are not part of the key. */
export function logEventKey(game: GameJson | null, report: Record<string, unknown>, _commandNr?: unknown, _reportIndex?: number): string {
  return `${String((game as { gameId?: unknown } | null)?.gameId ?? '?')}:${stableReportKey(report)}`;
}
function stableReportKey(report: Record<string, unknown>): string {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, sorted((value as Record<string, unknown>)[k])]))
    : value;
  return JSON.stringify(sorted(report));
}

const EASTER_EGGS: Record<string, (r: Report, g: GameJson | null) => string | null> = {
  steadyFootingRoll: (r, g) => (r.successful === false ? `${pn(g, r.playerId)} doesn't argue the fall! | ${rollWithTarget(r)}` : null),
  teamCaptainRoll: (r, g) => (r.successful === false ? `${teamCaptainName(g, r.teamId)} fails to argue the reroll! | ${rollWithTarget(r)}` : null),
  gettingEvenRoll: (r, g) => (r.successful === false
    ? `${pn(g, r.playerId)} does not learn to be racist toward ${hatredTrait(r)} | ${rollWithTarget(r)}`
    : r.successful === true ? `${pn(g, r.playerId)} learns to be racist toward ${hatredTrait(r)}: ${rollWithTarget(r)}` : null),
};

/** Give a report's first line its easter-egg wording when this event is one of the ~1 in 100 (both styles: `alt`, and
 *  the Graphical row too). Lines are returned unchanged otherwise. */
export function applyLogEasterEgg(report: Report, game: GameJson | null, lines: ReportDisplay[], eventKey: string): ReportDisplay[] {
  const egg = EASTER_EGGS[String(report.reportId ?? '')];
  if (!egg || !lines.length || !logEasterEggHit(eventKey)) return lines;
  let marked: string | null;
  try {
    marked = egg(report, game);
  } catch {
    marked = null;
  }
  if (!marked) return lines;
  const display = decodeDisplay(marked, reportDiceOwner(report, game));
  const alt: LogLineTokens = { text: display.text, d6: display.d6, blockDice: display.blockDice, names: display.names, tags: display.tags };
  const first = lines[0]!;
  const g: GraphicalLine | null = first.g === null ? null : { ...alt, indent: first.g?.indent ?? 0 };
  return [{ ...first, alt, g }, ...lines.slice(1)];
}

// ---- Graphical log style: block flow (owner 10-15) -------------------------------------------------------------
//
// The Graphical style reads a block as a sequence:
//   <A> blocks <D>: [dice]                          (indent 0; the reroll source icon carries a reroll)
//       <coach> chooses [die]                       (indent 1 - kept as its own child row)
//       <D> is pushed back!                         (indent 1; left out on POW, the knockdown row says it)
//       <D> is knocked down! | [armour] [AV] (9+) | [apothecary] [Inj] stunned   (indent 1)
//           <D> is Seriously Hurt (MNG)!            (indent 2, casualties only)
// derived only from the reports the server sent, in the order it sent them. A report that cannot be attributed to the
// open sequence (a different player, a new action) closes it and renders flat, never guessed into the group.

/** The die face (1-6) or BlockResult name -> flow result. */
function blockFlowResult(r: Report): string | null {
  const roll = Array.isArray(r.blockRoll) && typeof r.diceIndex === 'number' ? r.blockRoll[r.diceIndex] : undefined;
  const byFace: Record<number, string> = { 1: 'skull', 2: 'bothDown', 3: 'push', 4: 'push', 5: 'stumble', 6: 'pow' };
  if (typeof roll === 'number' && byFace[roll]) return byFace[roll]!;
  switch (String(r.blockResult ?? '').toUpperCase().replace(/[\s/]+/g, '_')) {
    case 'SKULL': return 'skull';
    case 'BOTH_DOWN': return 'bothDown';
    case 'PUSHBACK': case 'PUSH_BACK': return 'push';
    case 'POW_PUSHBACK': case 'POW_PUSH': return 'stumble';
    case 'POW': return 'pow';
    default: return null;
  }
}

function flowPushedIds(context: ReportLogContext): string[] {
  return typeof context.flowPushed === 'string' && context.flowPushed ? context.flowPushed.split(',') : [];
}
/** Is this player part of the open block sequence (attacker, defender, or a player pushed during it)? */
function inBlockFlow(context: ReportLogContext, playerId: unknown): boolean {
  if (typeof playerId !== 'string' || !playerId || !context.flowAttackerId) return false;
  return playerId === context.flowAttackerId || playerId === context.flowDefenderId || flowPushedIds(context).includes(playerId);
}

/** Astra 10-15: does this injury belong to the open block? A block injury needs its own attacker to match the
 *  block's pair (the defender falling to the blocker, or the blocker falling to the defender on a self knockdown /
 *  both down) - a missing or different attacker renders flat. A crowd push belongs when the victim was pushed in
 *  this sequence (its attacker, when sent, must be one of the pair). Any other injury type is not a block step. */
function injuryPairsWithFlow(report: Report, context: ReportLogContext): boolean {
  const attacker = context.flowAttackerId ?? null;
  const defender = context.flowDefenderId ?? null;
  if (!attacker) return false;
  const type = String(report.injuryType ?? '').toLowerCase();
  const victim = String(report.defenderId ?? report.playerId ?? '');
  const injuryAttacker = typeof report.attackerId === 'string' && report.attackerId ? report.attackerId : null;
  if (type.startsWith('block')) {
    return !!injuryAttacker && ((victim === defender && injuryAttacker === attacker) || (victim === attacker && injuryAttacker === defender));
  }
  if (type.startsWith('crowdpush')) {
    return inBlockFlow(context, victim) && (!injuryAttacker || injuryAttacker === attacker || injuryAttacker === defender);
  }
  return false;
}

/** Reports that belong to an open block sequence (anything else closes it). */
const BLOCK_FLOW_REPORTS = new Set(['block', 'blockRoll', 'blockChoice', 'blockReRoll', 'pushback', 'injury', 'apothecaryRoll',
  'apothecaryChoice', 'regenerationRoll', 'skillUse', 'skillUseOtherPlayer', 'reRoll', 'mascotUsed', 'foulAppearanceRoll', 'steadyFootingRoll',
  'dauntlessRoll', 'chompRoll', 'chompRemoved', 'blockDecision', 'standUpRoll']);

function closeBlockFlow(context: ReportLogContext): void {
  context.flowPushed = null;
  context.flowAttackerId = null;
  context.flowDefenderId = null;
  context.flowResult = null;
}

/** latchBlockFlow behind a guard: a malformed report (a blockResult that cannot become a string...) closes the
 *  sequence instead of throwing out of the formatter, whose Text line then falls back exactly as before. */
function safeLatchBlockFlow(report: Report, game: GameJson | null, context: ReportLogContext): void {
  try {
    latchBlockFlow(report, game, context);
  } catch {
    closeBlockFlow(context);
  }
}

/** Advance the open block sequence (idempotent). */
function latchBlockFlow(report: Report, game: GameJson | null, context: ReportLogContext): void {
  const id = String(report.reportId ?? '');
  if (id === 'block') {
    const attacker = blockAttacker(report, game, context) ?? null;
    context.flowAttackerId = attacker;
    context.flowDefenderId = typeof report.defenderId === 'string' ? report.defenderId : null;
    context.flowResult = null;
    context.flowPushed = null;
  } else if (id === 'blockRoll') {
    const attacker = blockAttacker(report, game, context) ?? null;
    const defender = typeof report.defenderId === 'string' && report.defenderId ? report.defenderId : context.lastBlockDefenderId;
    // a block roll for a different pair is a new sequence (multiple block, a second blitz block)
    if (attacker !== context.flowAttackerId || defender !== context.flowDefenderId) { context.flowResult = null; context.flowPushed = null; }
    context.flowAttackerId = attacker;
    context.flowDefenderId = defender ?? null;
  } else if (id === 'injury') {
    // an injury that cannot be paired with the open sequence ends it: the treatment rows after it follow that injury
    if (context.flowAttackerId && !injuryPairsWithFlow(report, context)) closeBlockFlow(context);
  } else if (id === 'pushback') {
    const pushed = typeof report.defenderId === 'string' ? report.defenderId : '';
    if (context.flowAttackerId && pushed && !flowPushedIds(context).includes(pushed)) {
      context.flowPushed = [...flowPushedIds(context), pushed].join(',');
    }
  } else if (id === 'blockChoice') {
    // a choice that names a different defender cannot be paired with the open sequence: it closes it
    if (typeof report.defenderId === 'string' && report.defenderId && report.defenderId !== context.flowDefenderId) closeBlockFlow(context);
    else if (context.flowAttackerId) context.flowResult = blockFlowResult(report);
  } else if (!BLOCK_FLOW_REPORTS.has(id)) {
    closeBlockFlow(context);
  }
}

function graphicalOf(marked: string, indent: 0 | 1 | 2, owner: ServerSide | null): GraphicalLine {
  const display = decodeDisplay(marked, owner);
  return { text: display.text, d6: display.d6, blockDice: display.blockDice, names: display.names, tags: display.tags, indent };
}

/** A Text line as-is at an indent (the same tokens), or with the reroll lead removed when the row's reroll source
 *  icon already says it. */
function graphicalFromLine(line: ReportDisplay, indent: 0 | 1 | 2 | 3): GraphicalLine {
  let { text, d6, blockDice, names, tags } = line;
  if (line.action?.source && text.startsWith(REROLL_LEAD)) {
    const cut = REROLL_LEAD.length;
    const shift = <T extends { index: number }>(tokens: readonly T[]): T[] => tokens.filter((t) => t.index >= cut).map((t) => ({ ...t, index: t.index - cut }));
    text = text.slice(cut);
    d6 = shift(d6); blockDice = shift(blockDice); names = shift(names); tags = shift(tags);
  }
  return { text, d6, blockDice, names, tags, indent };
}

/** The defender's armour value, the 2D6 total that breaks it: AV N breaks on N+ in BB2020/25 (the server's
 *  DiceInterpreter: AV = defender.getArmourWithModifiers(); Claws in the modifier list lowers AV above 8 to 8). */
function armourBreakTarget(game: GameJson | null, playerId: unknown, modifiers: unknown): number | null {
  if (!game || typeof playerId !== 'string') return null;
  const player = [...game.teamHome.playerArray, ...game.teamAway.playerArray].find((p) => p.playerId === playerId);
  if (!player) return null;
  let av: number;
  try {
    av = Number(effectiveArmour(player as never));
  } catch {
    av = Number(player.armour);
  }
  if (!Number.isFinite(av) || av <= 0) return null;
  if (modifierNameList(modifiers).some((m) => normalizedModifierName(m) === 'claws') && av > 8) av = 8;
  return av;
}

/** The Graphical injury rows: the head ("<who> <what> | armour (n+) | injury"), and a casualty row when present.
 *  `head` is the lead phrase (already name-tagged); `headIndent` its level, the casualty one level deeper. */
function graphicalInjury(r: Report, game: GameJson | null, head: string, headIndent: 0 | 1, owner: ServerSide | null): [GraphicalLine, GraphicalLine | null] {
  const name = pn(game, r.defenderId ?? r.playerId);
  const ar = Array.isArray(r.armorRoll) ? (r.armorRoll as number[]) : null;
  const ir = Array.isArray(r.injuryRoll) ? (r.injuryRoll as number[]) : null;
  const broke = !!r.armorBroken;
  const parts = head ? [head] : [];
  if (ar) {
    const target = armourBreakTarget(game, r.defenderId ?? r.playerId, r.armorModifiers);
    parts.push(`${TAG_MARK}V${target ?? ''}|armour${TAG_END} ${d6Pair(ar)}${target ? ` (${target}+)` : ''}${armourModifierSuffix(r.armorModifiers, broke)}`);
  }
  // owner 10-15: whenever the armour broke (or there was no armour roll and the server stated an injury - a crowd push,
  // a guaranteed injury such as Saboteur's that carries no dice at all) the outcome is ALWAYS its own line one level
  // deeper - the casualty result ("<P> is Badly Hurt!"), else the server-stated stun / KO ("<P> is stunned!")
  const outcome = injuryOutcome(r.injury) ?? (typeof r.injury === 'number' && (r.injury & 0xff) === 9 ? 'placed in the reserves' : null);
  if ((ir || outcome) && (broke || !ar)) {
    const cr = Array.isArray(r.casualtyRoll) && (r.casualtyRoll as number[]).length ? (r.casualtyRoll as number[]) : null;
    // the injury roll (when there is one) carries no outcome word
    if (ir) parts.push(`${TAG_MARK}Ainjury${TAG_END} ${d6Pair(ir)}${injuryModifierSuffix(r.injuryModifiers, ir, r.injury)}`);
    const base = typeof r.injury === 'number' ? r.injury & 0xff : -1;
    // owner 10-15: the outcome row leads with its icon - the KO lettering for a KO, the apothecary icon for a
    // casualty, and a 'stun' slot (renders nothing until the stun art arrives) for a stun
    // owner 10-16: a kill leads with the skull instead of the apothecary icon
    const lead = base === 8 ? `${TAG_MARK}Xkilled${TAG_END} `
      : cr || base >= 6 && base <= 8 ? `${TAG_MARK}Ccasualty${TAG_END} `
      : base === 5 ? `${TAG_MARK}KKO${TAG_END} `
        : base === 4 && STUN_OUTCOME_ICON ? `${TAG_MARK}Ustunned${TAG_END} ` : '';
    const outcomeText = base === 9 && !cr
      ? `${name} is placed in the reserves!` // a crowd push the injury roll leaves unhurt (PlayerState RESERVE)
      : cr
      ? `${name} is ${r.seriousInjury ? casualtyResultLabel(r.seriousInjury) : titleCase(outcome ?? 'a casualty')}!`
      : injuryEffectSentence(r.injury, name) === `${name} is injured!` && outcome
        ? `${name} is ${titleCase(outcome)}!`
        : injuryEffectSentence(r.injury, name) ?? (outcome ? `${name} is ${outcome}!` : '');
    const outcomeLine = outcomeText ? `${lead}${outcomeText}` : '';
    return [graphicalOf(twoLineHead(head, parts), headIndent, owner), outcomeLine ? graphicalOf(outcomeLine, (headIndent + 1) as 1 | 2, owner) : null];
  }
  return [graphicalOf(twoLineHead(head, parts), headIndent, owner), null];
}

/** Owner 10-16: the armour / injury dice of a Graphical head row sit on a SECOND LINE of the same row, under the
 *  sentence ("<P> fouls <T>" / "AV | INJ"), instead of wrapping mid-dice; a row with no sentence keeps one line. */
function twoLineHead(head: string, parts: string[]): string {
  const dice = head ? parts.slice(1) : parts;
  if (!head || !dice.length) return parts.join(' | ');
  return `${head}
${dice.join(' | ')}`;
}

/** Owner 10-15: the stun outcome icon (the owner's three gold stars, apps/tauri/src/assets/status/stunned.png): the
 *  "<P> is stunned!" row leads with it (SpectateView `s.tk === 'stun'`). False would drop the icon again. */
export const STUN_OUTCOME_ICON = true;

/** The Graphical rows of an injury report's Text lines ([dice line, effect sentence, casualty?]): the dice row first,
 *  then the outcome row (stun / KO / casualty, owner 10-15) in the effect sentence's slot; the casualty slot is left
 *  out (the outcome row already says it). Armour that held has one Text line and no outcome row. */
function injuryRows(lines: readonly ReportDisplay[], main: GraphicalLine, outcome: GraphicalLine | null): (GraphicalLine | null)[] {
  // a report whose Text form is a single line (no injury dice, e.g. a guaranteed injury) still gets its outcome row
  if (outcome && lines.length < 2) return [{ ...main, more: [...(main.more ?? []), outcome] }];
  return lines.map((_line, index) => (index === 0 ? main : index === 1 ? outcome : null));
}

/** The Graphical version of each of a report's lines (undefined = the Text line unchanged, null = left out). */
/** Upstream bb2025 StepProjectileVomit: the vomit landing on the vomiter is an injury whose defender is the vomiter
 *  (passed as both attacker and defender; older steps pass no attacker while the vomiter is the acting player). */
function isSelfVomit(r: Report, game: GameJson | null): boolean {
  const victim = String(r.defenderId ?? r.playerId ?? '');
  if (!victim) return false;
  if (typeof r.attackerId === 'string' && r.attackerId) return r.attackerId === victim;
  return game?.actingPlayer?.playerId === victim;
}

function graphicalLines(report: Report, game: GameJson | null, context: ReportLogContext, lines: readonly ReportDisplay[], handoffCatch = false): (GraphicalLine | null | undefined)[] {
  const id = String(report.reportId ?? '');
  const owner = reportDiceOwner(report, game);
  const attacker = context.flowAttackerId ?? null;
  const defender = context.flowDefenderId ?? null;
  const result = context.flowResult ?? null;
  const open = !!attacker && BLOCK_FLOW_REPORTS.has(id);
  // the reroll lead stays only when no reroll source icon carries it
  const keptLead = () => (lines[0]?.text.startsWith(REROLL_LEAD) && !lines[0]?.action?.source ? REROLL_LEAD : '');
  const leadOnly = () => lines.map((line) => (line.action?.source && line.text.startsWith(REROLL_LEAD) ? graphicalFromLine(line, 0) : undefined));
  switch (id) {
    case 'blockRoll': {
      const a = blockAttacker(report, game, context);
      const d = report.defenderId ?? context.lastBlockDefenderId;
      if (!a || !d || !Array.isArray(report.blockRoll)) return leadOnly();
      const attackerTeamId = playerTeam(game, a) === 'home' ? game?.teamHome.teamId : game?.teamAway.teamId;
      const uphill = !!report.choosingTeamId && !!attackerTeamId && report.choosingTeamId !== attackerTeamId;
      // "Block" is the row's icon and "Rerolled" its reroll source icon: the line names who blocks whom.
      // owner 10-16: the coach's choice joins this row (join: 'block')
      return [{ ...graphicalOf(`${keptLead()}${pn(game, a)} blocks ${pn(game, d)}${uphill ? ' (uphill)' : ''}: ${blockDieList(report.blockRoll)}`, 0, owner), join: 'block' }];
    }
    case 'blockChoice': {
      if (!(open && (typeof report.defenderId !== 'string' || !report.defenderId || report.defenderId === defender))) return leadOnly();
      // owner 10-16: an uphill choice (the defender's coach picks) says so at the end of its row; its tint is the
      // chooser's seat (formatReportLines exempts it from the blocker's flow tint)
      const uphill = isUphillChoice(report, game, attacker);
      // owner 10-16 (evening): the choice joins the block's dice row ("<A> blocks <D>: [dice] | <Coach> chooses <Result>")
      return lines.map((line) => { const g = graphicalFromLine(line, 1); return { ...(uphill ? { ...g, text: `${g.text} (Uphill)` } : g), joinPrevious: 'block' as const }; });
    }
    case 'argueTheCall': {
      // owner 10-16: the coach's sentence with the dice under it; each outcome sentence one step in
      const a = argueTheCallRows(report, game);
      return [{ ...graphicalOf(twoLineHead(a.head, [a.head, a.dice]), 0, owner), more: a.children.map((child) => graphicalOf(child, 1, owner)) }];
    }
    case 'steadyFootingRoll':
      // a failed Steady Footing resumes the deferred fall of the block: a step of it for the sequence's players
      return open && (report.playerId === attacker || report.playerId === defender) ? lines.map((line) => graphicalFromLine(line, 1)) : leadOnly();
    case 'blockReRoll': {
      if (!open) return leadOnly();
      const who = pn(game, report.playerId);
      const dice = Array.isArray(report.blockRoll) ? blockDieList(report.blockRoll) : '?';
      // the source is the reroll source icon; with none, keep the named source
      const src = lines[0]?.action?.source ? '' : report.reRollSource ? ` (${humanize(String(report.reRollSource))})` : '';
      return [{ ...graphicalOf(`${keptLead()}${who} rerolls block dice${src}: ${dice}`, 1, owner), join: 'block' }]; // the choice joins the rerolled dice
    }
    case 'pushback': {
      // Every push is shown: a step in an open sequence (a chain push of a third player included), else a flat row.
      // Astra 10-15: it is NOT left out on POW - a successful Steady Footing keeps the player up, and then no knockdown
      // row would follow to say what happened (a POW therefore reads "pushed back!" then "knocked down!").
      void result;
      return [graphicalOf(`${pn(game, report.defenderId)} is pushed back!`, open ? 1 : 0, owner)];
    }
    case 'injury': {
      const type = String(report.injuryType ?? '').toLowerCase();
      const victim = String(report.defenderId ?? report.playerId ?? '');
      const name = pn(game, victim);
      const blockFamily = type.startsWith('block');
      const inFlow = open && injuryPairsWithFlow(report, context);
      let head: string;
      if (type.startsWith('crowdpush')) head = `${name} is pushed into the crowd!`;
      else if (blockFamily) head = inFlow && result === 'skull' && victim === attacker ? `${name} knocks themselves down!` : `${name} is knocked down!`;
      else if (type.startsWith('foul')) {
        const foulerId = typeof report.attackerId === 'string' && report.attackerId ? report.attackerId : game?.actingPlayer?.playerId;
        head = `${pn(game, foulerId)} fouls ${name}`;
      } else if (type === 'dropdodge' || type === 'dropgfi') head = `${name} falls down!`;
      else if (type === 'chainsaw' || type === 'chainsawforspp') {
        // owner 10-15: the chainsaw roll row above says who hit whom, or that it kicked back; this row is its armour /
        // injury step for the player hit (the target, or the chainsaw player on a kickback), its outcome one level deeper
        const [roll, outcome] = graphicalInjury(report, game, '', 1, owner);
        // the one exception to "no outcome row when the armour holds": a chainsaw HIT whose armour holds reads
        // "<P>'s chainsaw fails to cut through <T>'s armor!" (owner spelling "armor")
        const held = Array.isArray(report.armorRoll) && !report.armorBroken && !isSelfVomit(report, game);
        const attackerId = typeof report.attackerId === 'string' && report.attackerId ? report.attackerId : game?.actingPlayer?.playerId;
        const heldRow = held && attackerId ? graphicalOf(`${pn(game, attackerId)}'s chainsaw ${FAILS} to cut through ${name}'s armor!`, 2, owner) : null;
        return injuryRows(lines, roll, outcome ?? heldRow);
      } else if (type === 'projectilevomit') {
        // the vomit roll row above says who vomited on whom; this row is its armour / injury step
        const [roll, casualty] = graphicalInjury(report, game, '', 1, owner);
        if (isSelfVomit(report, game)) {
          // "<P> vomits all over themselves!", then (indented) the armour / injury roll and the casualty
          const selfHead = graphicalOf(`${name} vomits all over themselves!`, 0, owner);
          const casualtyDeeper = casualty ? { ...casualty, indent: 2 as const } : null;
          selfHead.more = [roll, ...(casualtyDeeper ? [casualtyDeeper] : [])];
          return lines.map((_line, index) => (index === 0 ? selfHead : null));
        }
        return injuryRows(lines, roll, casualty);
      } else if (type === 'stab' && typeof report.attackerId === 'string' && report.attackerId) {
        head = report.armorBroken ? `${pn(game, report.attackerId)} stabs ${name}!` : `${pn(game, report.attackerId)} ${FAILS} to stab ${name}.`;
      } else if ((type === 'bitten' || type === 'quickbite') && typeof report.attackerId === 'string' && report.attackerId) {
        // owner 10-16: a Bloodlust bite reads "<Vampire> feeds on <Thrall>", its injury dice under it, the result under that
        head = `${pn(game, report.attackerId)} feeds on ${name}`;
      } else {
        // any other injury (Chainsaw, Fireball, Lightning, Bomb...): "<P> | <Cause>" then the shared armour / injury form
        const cause = titleCase(humanize(String(report.injuryType ?? 'injury')));
        head = `${name} | ${cause}`;
      }
      const [main, casualty] = graphicalInjury(report, game, head, inFlow ? 1 : 0, owner);
      // Text lines: [head, effect sentence, casualty?] - the effect word now rides the head, so its row is left out
      return injuryRows(lines, main, casualty);
    }
    case 'handOver':
      return [graphicalFromLine(lines[0]!, 0)];
    case 'catchRoll':
      // the receiver's catch after a hand-off is a step of it (Catch icon, indented under the hand-off row)
      return handoffCatch ? lines.map((line) => graphicalFromLine(line, 1)) : leadOnly();
    case 'apothecaryRoll': case 'apothecaryChoice': case 'regenerationRoll':
      return open && inBlockFlow(context, report.playerId) ? lines.map((line) => graphicalFromLine(line, 2)) : leadOnly();
    case 'skillUse': case 'skillUseOtherPlayer':
      return lines.map((line) => graphicalFromLine(line,
        open && (report.playerId === attacker || report.playerId === defender || report.playerIdOtherPlayer === attacker || report.playerIdOtherPlayer === defender) ? 1 : 0));
    default:
      return leadOnly();
  }
}

function formatReportLinesPlain(report: Report, game: GameJson | null, context: ReportLogContext): ReportDisplay[] {
  if (String(report.reportId ?? '') === 'turnEnd') {
    try {
      return turnEndLines(report, game, context).map((line) => decodeDisplay(line));
    } catch {
      // fall through to the single-line generic path
    }
  }
  // Owner 09-05: any formatter may return several lines separated by '\n' (the injury report does — dice line,
  // effect sentence, casualty result); each becomes its own log entry, decoded on its own.
  const formatter = formatters[String(report.reportId ?? 'unknown')];
  if (formatter) {
    try {
      const raw = formatter(report, game, context);
      if (raw.includes('\n')) {
        const owner = reportDiceOwner(report, game);
        return raw.split('\n').filter((line) => line.length > 0).map((line, index) => decodeDisplay(index === 0 ? withRerollLead(report, line, context, game) : line, owner));
      }
    } catch {
      // fall through to the single-line generic path
    }
  }
  return [formatReportDisplay(report, game, context)];
}
