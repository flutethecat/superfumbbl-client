import type { GameJson } from '@fumbbl40k/ffb-protocol';
import { isD6FaceValue, type D6FaceValue } from '@fumbbl40k/ffb-pitch';
import type { D6LogToken } from './d6Log';
import { isBlockDieFaceValue, type BlockDieLogToken } from './blockDieLog';
import type { LogNameToken } from './logNames';
import type { LogTagToken } from './logTags';
import { quickSnapAllowanceText, quickSnapCountText, quickSnapExhaustedText } from './quickSnapController';
import { prayerForRoll } from './prayerCatalog';

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

function d6(value: unknown, kind: D6LogToken['kind'] = 'roll'): string {
  return isD6FaceValue(value) ? `${D6_MARK}${kind === 'target' ? 'T' : 'R'}${value}${D6_END}` : String(value ?? '?');
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
}

function decodeDisplay(marked: string): ReportDisplay {
  const d6: D6LogToken[] = [];
  const blockDice: BlockDieLogToken[] = [];
  const names: LogNameToken[] = [];
  const tags: LogTagToken[] = [];
  let text = '';
  let cursor = 0;
  const marker = /([RT])([1-6])|([1-6])|([HA])([^]*)|([TSWNF])([^]*)/g;
  for (let match = marker.exec(marked); match; match = marker.exec(marked)) {
    text += marked.slice(cursor, match.index);
    if (match[6]) {
      // Owner 08-18: a kind-tagged decoration run -- marks dropped, run recorded by offset.
      const run = match[7] ?? '';
      if (run) tags.push({
        index: text.length,
        length: run.length,
        kind: match[6] === 'T' ? 'title' : match[6] === 'S' ? 'armour' : match[6] === 'N' ? 'stat-down-ni'
          : match[6] === 'F' ? 'fail' : 'hidden',
      });
      text += run;
    } else if (match[4]) {
      // #157-v2: a tagged player name -- the marks are dropped and the run is recorded by offset.
      // Owner 08-19: the run is `playerId SEP name`; the id is stripped with the marks and rides
      // the token (additive field) so the view can make the name clickable (locate cue).
      const run = match[5] ?? '';
      const sep = run.indexOf(NAME_ID_SEP);
      const name = sep >= 0 ? run.slice(sep + 1) : run;
      const playerId = sep > 0 ? run.slice(0, sep) : undefined;
      if (name) names.push({ index: text.length, length: name.length, team: match[4] === 'H' ? 'home' : 'away', ...(playerId ? { playerId } : {}) });
      text += name;
    } else if (match[3]) {
      const value = Number(match[3]);
      const result = face(value);
      blockDice.push({ index: text.length, value: value as BlockDieLogToken['value'], result });
      text += result;
    } else {
      const value = Number(match[2]) as D6FaceValue;
      d6.push({ index: text.length, value, kind: match[1] === 'T' ? 'target' : 'roll' });
      text += match[2];
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

function coachName(game: GameJson | null, teamId: unknown): string {
  if (!game || typeof teamId !== 'string') return 'Coach';
  if (game.teamHome.teamId === teamId) return String(game.teamHome.coach || game.teamHome.teamName || 'Coach');
  if (game.teamAway.teamId === teamId) return String(game.teamAway.coach || game.teamAway.teamName || 'Coach');
  return 'Coach';
}

function rulesVersion(game: GameJson | null): string | undefined {
  return game?.gameOptions.gameOptionArray
    .find((option) => option.gameOptionId === 'rulesVersion')?.gameOptionValue;
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
      annotations.push(name);
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

/** Owner 08-19: the succeeds/fails suffix on roll lines — a SUCCESS ends at the needs
 *  clause ("— succeeds" suppressed; a re-rolled note survives as ", re-rolled"); a FAIL
 *  stays explicit ("— fails" / "— fails, re-rolled"). */
function outcomeSuffix(successful: unknown, reRolled: unknown): string {
  const rerolled = reRolled ? ', re-rolled' : '';
  return successful ? rerolled : ` | ${FAILS}${rerolled}`;
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
    return `${pn(game, report.playerId)} ${verb}:${rollPart}${min}${outcomeSuffix(report.successful, report.reRolled)}`;
  };
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
    const rerolled = report.reRolled === true ? ', re-rolled' : '';
    const outcome = report.successful === false
      ? ` | ${FAILS}${rerolled}`
      : report.successful === true ? rerolled : '';
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

/** Defender of the most recent block report (EC-8: live blockRoll omits it). */
let lastBlockDefenderId: string | undefined;

/** ATTACKER of the most recent block report (owner 08-18). ReportBlockRoll carries
 *  only the defender, so the opening `block` report latches the attacker for the
 *  offered-dice line that follows it in the same frame. */
let lastBlockAttackerId: string | undefined;

/** ReportBlockRoll names the choosing team; the following ReportBlockChoice
 * omits it. Retain that authoritative team for the resolved-choice log line. */
let lastBlockChoosingTeamId: string | undefined;

/** Owner 2026-07-06 (finding B): prime the block defender from a report that DOES
 *  carry it (block / blockChoice) BEFORE the frame's log loop, so the LIVE blockRoll
 *  line — which omits defenderId — resolves the name instead of rendering "vs ?". */
export function setBlockDefenderHint(defenderId: string | undefined): void {
  if (defenderId) lastBlockDefenderId = defenderId;
}

/** Owner 08-18: the attacker for a block dice/result line. Report keys first, then the game model's
 *  CURRENT acting player (upstream's own source for the attacker-less block texts), and only then the
 *  id latched from this sequence's `block` report -- model-current beats a latch that a debug-log
 *  toggle could leave a sequence behind. Returns undefined when none resolve; the caller then keeps
 *  the old defender-only wording rather than guessing. */
function blockAttacker(r: Report, g: GameJson | null): string | undefined {
  for (const candidate of [r.attackerId, r.playerId, g?.actingPlayer?.playerId, lastBlockAttackerId]) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return undefined;
}

// Upstream BlockResultFactory.forRoll (ffb-common/src/main/java/com/fumbbl/ffb/factory/BlockResultFactory.java:26-38):
// 1 SKULL, 2 BOTH_DOWN, 3/4 PUSHBACK, 5 POW_PUSHBACK, 6 POW. Enum literals:
// ffb-common/src/main/java/com/fumbbl/ffb/BlockResult.java:3-5.
const BLOCK_FACES = ['', 'Player Down!', 'Both Down', 'Push Back', 'Push Back', 'Stumble!', 'POW!'];
const face = (roll: unknown) => BLOCK_FACES[Number(roll)] ?? String(roll);
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

/** #10x (owner 08-17, live game 864 sighting): group a turnEnd's knockoutRecoveryArray
 *  into two lines by outcome (recovers / stays out), preserving each group's within-array
 *  order (the order the server rolled them in). Each entry keeps its player NAME next to
 *  its own roll — the thing the owner asked not to lose while splitting the wall of text. */
export function formatRecoveryLines(recoveries: readonly Report[], game: GameJson | null): string[] {
  const back: string[] = [];
  const stay: string[] = [];
  for (const value of recoveries) {
    const entry = `${pn(game, value.playerId)} (${d6(value.roll)})`;
    (value.recovering ? back : stay).push(entry);
  }
  const lines: string[] = [];
  if (back.length) lines.push(`KO recovery | back on their feet: ${back.join(', ')}`);
  if (stay.length) lines.push(`KO recovery | stay out: ${stay.join(', ')}`);
  return lines;
}

/** #10x: the turnEnd part-list, one entry per intended LOG LINE (still D6-marked, not yet
 *  decoded). TD/turn-ends is always its own line; KO recoveries are grouped via
 *  formatRecoveryLines; heat exhaustion keeps its PRE-EXISTING joined-with-'; ' text
 *  (unregressed) as its own trailing line. Shared by the `turnEnd` formatter (single-line,
 *  legacy callers) and formatReportLines (multi-line). */
function turnEndLines(r: Report, g: GameJson | null): string[] {
  // Owner 08-19: "TOUCHDOWN!" / "scores!" ride title tags -> gold in the view, copy unchanged.
  const lines = [r.playerIdTouchdown ? `${titleTag('TOUCHDOWN!')} ${pn(g, r.playerIdTouchdown)} ${titleTag('scores!')}` : 'turn ends'];
  const recoveries = Array.isArray(r.knockoutRecoveryArray) ? (r.knockoutRecoveryArray as Report[]) : [];
  lines.push(...formatRecoveryLines(recoveries, g));
  const heat = Array.isArray(r.heatExhaustionArray) ? r.heatExhaustionArray : [];
  const heatParts: string[] = [];
  if (rulesVersion(g) === 'BB2016') {
    for (const value of heat) {
      const exhaustion = value as Record<string, unknown>;
      heatParts.push(`${pn(g, exhaustion.playerId)} heat exhaustion ${d6(exhaustion.roll)}`);
    }
  } else if (heat.length && r.heatRoll != null) {
    // BB2020/25 heatRoll is the D3 fainting count; entry rolls are zero.
    heatParts.push(`heat exhaustion ${r.heatRoll}`);
  }
  if (heatParts.length) lines.push(heatParts.join('; '));
  return lines;
}

const formatters: Record<string, (report: Report, game: GameJson | null) => string> = {
  dodgeRoll: skillRoll('dodges'),
  goForItRoll: skillRoll('goes for it'),
  catchRoll: skillRoll('catches'),
  passRoll: skillRoll('passes'),
  pickUpRoll: skillRoll('picks up the ball'),
  leapRoll: skillRoll('jumps'),
  interceptionRoll: skillRoll('intercepts'),
  scatterPlayer: (r, g) => {
    const playerId = actingPlayerHasBallAndChain(g);
    const rolls = Array.isArray(r.rolls) ? r.rolls : [];
    const directions = Array.isArray(r.directionArray) ? r.directionArray.map(String) : [];
    const roll = rolls[0];
    const result = `${roll != null ? `${hiddenTag('rolls ')}${d6(roll)}` : 'direction resolved'}`
      + `${directions.length ? ` → ${directions.join(' → ')}` : ''}`;
    return playerId ? `${pn(g, playerId)} | Ball & Chain: ${result}` : `scatter player: ${result}`;
  },
  standUpRoll: (r, g) => {
    const modifier = typeof r.modifier === 'number' && r.modifier > 0 ? ` (Timm-ber +${r.modifier})` : '';
    const min = r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : '';
    const rollPart = r.roll != null ? ` ${hiddenTag('rolls ')}${d6(r.roll)}` : '';
    return `${pn(g, r.playerId)} stands up${modifier}:${rollPart}${min}${outcomeSuffix(r.successful, r.reRolled)}`;
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
    return `${pn(g, r.playerId)} | ${trait}:${rollPart}${min}${outcomeSuffix(r.successful, r.reRolled)}`;
  },
  // These two ReportSkillRoll shapes previously fell through to the generic key/value dump
  // (`successful true`). Give them the same concise success trimming as every action roll;
  // a server-stated failure remains explicit and a successful reroll retains its provenance.
  bloodLustRoll: namedSkillRoll('Blood Lust'),
  hypnoticGazeRoll: namedSkillRoll('Hypnotic Gaze'),
  // Owner 09-05: ReportSteadyFootingRoll fell through to the generic dump (", successful false") — same family.
  steadyFootingRoll: namedSkillRoll('Steady Footing'),
  dauntlessRoll: skillRoll('uses Dauntless'),
  regenerationRoll: skillRoll('regenerates'),
  foulAppearanceRoll: (r, g) => {
    if (r.successful === false) {
      const attacker = pn(g, r.playerId);
      const defender = r.defenderId ? pn(g, r.defenderId) : 'their opponent';
      const roll = r.roll != null ? d6(r.roll) : '?';
      const min = r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : '';
      return `${attacker} is disgusted by ${defender}'s Foul Appearance | ${roll}${min}`;
    }
    return skillRoll('overcomes Foul Appearance')(r, g);
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
    return `${pn(g, r.playerId)} ${verb} ${thrown}: ${hiddenTag('rolls ')}${d6(r.roll)}${min}${outcomeSuffix(r.successful, r.reRolled)}`;
  },

  // Wire reality (EC-8, verified against upstream ReportBlock 2026-07-02):
  // the block report carries ONLY defenderId — the attacker is implicit (the
  // acting player); and the LIVE server's blockRoll omits defenderId (our
  // mirror is ahead of production), so the last block's defender is carried.
  block: (r, g) => {
    lastBlockDefenderId = typeof r.defenderId === 'string' ? r.defenderId : lastBlockDefenderId;
    const attacker = r.attackerId ?? r.playerId ?? g?.actingPlayer?.playerId;
    if (typeof attacker === 'string' && attacker) lastBlockAttackerId = attacker;
    lastBlockChoosingTeamId = undefined;
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
  blockRoll: (r, g) => {
    // ffb-common/src/main/java/com/fumbbl/ffb/report/ReportBlockRoll.java:16-18,57-71 carries these wire values.
    const dice = Array.isArray(r.blockRoll) ? blockDieList(r.blockRoll) : '?';
    if (typeof r.choosingTeamId === 'string' && r.choosingTeamId) lastBlockChoosingTeamId = r.choosingTeamId;
    const defender = r.defenderId ?? lastBlockDefenderId;
    const attacker = blockAttacker(r, g);
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
  blockChoice: (r, g) => {
    // ffb-common/src/main/java/com/fumbbl/ffb/report/ReportBlockChoice.java:16-19,85-105 carries roll + selection.
    const roll = Array.isArray(r.blockRoll) && typeof r.diceIndex === 'number'
      ? r.blockRoll[r.diceIndex]
      : undefined;
    const result = isBlockDieFaceValue(roll)
      ? blockDie(roll)
      : blockResultFaceName(r.blockResult);
    const choosingTeamId = typeof r.choosingTeamId === 'string' && r.choosingTeamId
      ? r.choosingTeamId
      : lastBlockChoosingTeamId;
    return `${coachName(g, choosingTeamId)} chooses ${result}`;
  },
  blockReRoll: (r, g) => {
    // ffb-common/src/main/java/com/fumbbl/ffb/report/mixed/ReportBlockReRoll.java:22-24,59-73 carries replacement dice.
    const dice = Array.isArray(r.blockRoll) ? blockDieList(r.blockRoll) : '?';
    const source = r.reRollSource ? ` (${humanize(String(r.reRollSource))})` : '';
    return `${pn(g, r.playerId)} re-rolls block dice${source}: ${dice}`;
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
  kickoffScatter: (r) => `kick-off scatter: direction ${r.rollScatterDirection ?? '?'} · distance ${r.rollScatterDistance ?? '?'}`,
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
    return `${teamName(g, r.teamId)} | Master Chef: ${hiddenTag('rolls ')}${rolls} | steals ${stolen} re-roll${stolen === 1 ? '' : 's'}`;
  },
  // #139 ② (GAP-WAVE-2): purchase-confirmation reports. The interactive `inducementReveal` cine covers the
  // VISUAL for the buying coach, but it only fires in interactive play — a SPECTATOR / fast-pregame viewer gets
  // nothing without this log line (Yularen: build the all-modes log, record the reveal as by-design). Wire counts
  // + gold (Report{Inducements,Cards,CardsAndInducements}Bought). BB2025 uses cardsAndInducementsBought.
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
    return `Defecting players: ${ids.map((id, i) => `${pn(g, id)} ${d6(rolls[i])} (${defs[i] ? 'leaves' : 'stays'})`).join(', ')}`;
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
    const rerolled = r.reRolled ? ', re-rolled' : '';
    const chomper = String(r.chomper ?? r.attackerId ?? r.playerId ?? '');
    const chompeeId = r.chompee ?? r.defenderId;
    const victim = chompeeId ? ` on ${pn(g, String(chompeeId))}` : '';
    return `${pn(g, chomper)} | Chomp${victim}: ${hiddenTag('rolls ')}${d6(r.roll)}${min}${rerolled} | ${r.successful ? 'CHOMPED' : FAILS}`;
  },
  chompRemoved: (r, g) =>
    r.successful ? `${pn(g, r.playerId)} is no longer chomped` : `${pn(g, r.playerId)} stays chomped`,
  // #138 log batch (ReportSkillRoll-family: playerId/successful/roll/minimumRoll/reRolled):
  animosityRoll: skillRoll('overcomes Animosity'),
  alwaysHungryRoll: skillRoll('resists Always Hungry'),
  saboteurRoll: skillRoll('sabotages'),
  // #138 custom: Chainsaw carries a defenderId target; Getting Even carries a keyword; Dwarfen Wisdom is a
  // team-level re-roll grant.
  chainsawRoll: (r, g) => {
    const min = r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : '';
    const tgt = r.defenderId ? ` vs ${pn(g, r.defenderId)}` : '';
    return `${pn(g, r.playerId)} | Chainsaw${tgt}: ${hiddenTag('rolls ')}${d6(r.roll)}${min} | ${r.successful ? 'hits' : 'kicks back'}`;
  },
  gettingEvenRoll: (r, g) => {
    const kw = r.keyword ? ` (${humanize(String(r.keyword))})` : '';
    const min = r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : '';
    return `${pn(g, r.playerId)} | Getting Even${kw}: ${hiddenTag('rolls ')}${d6(r.roll)}${min}${outcomeSuffix(r.successful, r.reRolled)}`;
  },
  dwarfenWisdomRoll: (r, g) => `${teamName(g, r.teamId)} | Dwarfen Wisdom: ${hiddenTag('rolls ')}${r.roll ?? '?'}`, // D3
  // #141 (GAP-WAVE-2, ball-flight): the punt/swoop DIRECTION rolls (owner: show a direction ARROW — Voss's
  // #122 renderer, fed by state.ballDirection). `direction` = the Direction enum display name ("North"/…).
  puntDirectionRoll: (r, g) => `${pn(g, r.playerId)} punts the ball ${r.direction ?? '?'}${r.directionRoll ? ` (direction ${d6(r.directionRoll)})` : ''}${r.outOfBounds ? ' (out of bounds)' : ''}`,
  puntDistanceRoll: (r) => `the ball is punted ${d6(r.roll)} squares${r.outOfBounds ? ' (out of bounds)' : ''}`,
  swoopDirectionRoll: (r, g) => `${pn(g, r.playerId)} swoops ${r.direction ?? '?'}${r.directionRoll ? ` (direction ${d6(r.directionRoll)})` : ''}${r.outOfBounds ? ' (out of bounds)' : ''}`,
  // ReportPassDeviate carries a D8 direction plus a D6 distance in every upstream producer.
  passDeviate: (r) => `the pass deviates ${r.scatterDirection ?? '?'} (direction ${r.rollScatterDirection ?? '?'}, distance ${d6(r.rollScatterDistance)})`,
  // #142 (GAP-WAVE-2, stalling + modified results — the last family). throwAtStallingPlayer pairs with the
  // wired stallerDetected (#51): the crowd throws at a detected staller (5+ hits). modified* name WHICH skill
  // improved a pass/dodge outcome (owner: "which skill improved the outcome"). twoForOne = the star-pair skill.
  throwAtStallingPlayer: (r, g) => {
    const player = pn(g, r.playerId);
    if (r.successful) return `${player} is hit by a rock!`;
    return Number(r.roll ?? 0) > 0
      ? `${player} is not punished for stalling. (${hiddenTag('rolls ')}${d6(r.roll)})`
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
      return `${shadower} shadows${runner}: ${hiddenTag('rolls ')}${rolls}${min} | ${r.successful ? 'follows him' : 'loses him'}`;
    }
    // The chosen defenderId is the player USING Tentacles; the mover remains the acting player.
    // Phrase the result from the holder's perspective and trim successful hold text.
    const holder = pn(g, r.defenderId);
    const targetId = String((g?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    const target = targetId && targetId !== r.defenderId ? pn(g, targetId) : 'their target';
    return `${holder} tries to hold ${target} with ${r.skill ?? 'Tentacles'}! ${hiddenTag('rolls ')}${rolls}${min}${r.successful ? ` | ${FAILS}` : ''}`;
  },
  animalSavagery: (r, g) => `${pn(g, r.attackerId)} (Animal Savagery) turns on team-mate ${pn(g, r.defenderId)}`,
  projectileVomit: (r, g) => {
    const min = r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : '';
    return `${pn(g, r.playerId)}'s Projectile Vomit${r.defenderId ? ` on ${pn(g, r.defenderId)}` : ''}: ${hiddenTag('rolls ')}${d6(r.roll)}${min} | ${r.successful ? 'hits' : 'misses'}`;
  },
  lookIntoMyEyesRoll: skillRoll('uses Look Into My Eyes'),
  weepingDaggerRoll: skillRoll('uses Weeping Dagger'),
  swarmingPlayersRoll: (r, g) => `${teamName(g, r.teamId)} | Swarming: ${r.swarmingPlayerRoll ?? r.swarmingPlayerAmount ?? '?'} extra player(s) field`,
  nervesOfSteel: (r, g) => `${pn(g, r.playerId)} uses Nerves of Steel${r.ballAction ? ` (${humanize(String(r.ballAction))})` : ''}`,
  // COMPLETENESS SWEEP · tranche 2 — star/special one-off log lines. (catchOfTheDay, allYouCanEat,
  // brilliantCoachingReRoll were initially deferred here but their classes DID exist — built in tranche 4 below.)
  indomitable: (r, g) => `${pn(g, r.playerId)} stays up (Indomitable)`,
  oldPro: (r, g) => r.selfInflicted
    ? `${pn(g, r.playerId)} uses Old Pro: forces the opponent to re-roll ${d6(r.oldRoll)} into ${d6(r.roll)}`
    : `${pn(g, r.playerId)} uses Old Pro: re-rolls ${d6(r.oldRoll)} into ${d6(r.roll)}`,
  pickMeUp: (r, g) => `${pn(g, r.playerId)} | Pick Me Up: ${hiddenTag('rolls ')}${d6(r.roll)}${outcomeSuffix(r.successful, r.reRolled)}`,
  raidingParty: (r, g) => `${pn(g, r.playerId)} uses Raiding Party`,
  thrownKeg: (r, g) =>
    `${pn(g, r.playerId)} throws a keg at ${pn(g, r.targetPlayerId)}: ${hiddenTag('rolls ')}${d6(r.roll)} | ${r.fumble ? 'fumbles' : r.successful ? 'hits' : 'misses'}`,
  mascotUsed: (r, g) => `${teamName(g, r.teamId)} | Mascot: ${hiddenTag('rolls ')}${d6(r.roll)}${r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : ''}${outcomeSuffix(r.successful, r.reRolled)}`,
  teamCaptainRoll: (r, g) => `${teamName(g, r.teamId)} | Team Captain: ${hiddenTag('rolls ')}${d6(r.roll)}${r.minimumRoll != null ? ` (${d6(r.minimumRoll, 'target')}+)` : ''}${outcomeSuffix(r.successful, r.reRolled)}`,
  weatherMageRoll: (r) => `Weather Mage: ${hiddenTag('rolls ')}${d6List(r.weatherRoll)}`,
  weatherMageResult: () => 'Weather Mage alters the weather',
  pumpUpTheCrowdReRoll: (r, g) => `${pn(g, r.playerId)} earns a Pump Up The Crowd re-roll`,
  showStarReRoll: (r, g) => `${pn(g, r.playerId)} earns a Show Star re-roll`,
  briberyAndCorruptionReRoll: (r, g) => `${teamName(g, r.teamId)} | Bribery & Corruption re-roll`,
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
  placedBallDirection: (r, g) => `${pn(g, r.playerId)} places the ball ${r.direction ?? '?'}`,
  bombOutOfBounds: () => 'the bomb sails out of bounds',
  kickTeamMateFumble: () => 'the Kick Team-Mate throw fumbles',
  swoopPlayer: (r, g) => {
    if (Array.isArray(r.rolls)) return `a player swoops across the pitch (direction ${d6List(r.rolls)})`;
    const swoopDistance = gameOption(g, 'swoopDistance');
    const distance = rulesVersion(g) === 'BB2025' && (swoopDistance == null || swoopDistance === '0')
      ? d6(r.distance)
      : String(r.distance ?? '?');
    return `a player swoops ${distance} square${r.distance === 1 ? '' : 's'} ${r.scatterDirection ?? r.direction ?? ''}`.trim();
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
  brilliantCoachingReRoll: (r, g) => `${teamName(g, r.teamId)} loses ${r.rerollBrilliantCoachingOneDrive ?? '?'} Brilliant Coaching re-roll(s)`,
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
  secretWeaponBan: (r, g) => {
    const ids = Array.isArray(r.playerIds) ? (r.playerIds as string[]) : [];
    const bans = Array.isArray(r.banArray) ? (r.banArray as unknown[]) : [];
    const flagged = ids.filter((_, i) => !!bans[i]).map((pid) => pn(g, pid));
    return flagged.length
      ? `Secret Weapon${flagged.length > 1 ? 's' : ''} up for send-off: ${flagged.join(', ')}`
      : 'no Secret Weapon send-off this drive';
  },
  pumpUpTheCrowdReRollLost: (r, g) => `${teamName(g, r.teamId)} loses ${r.rerollPumpUpTheCrowdOneDrive ?? '?'} Pump Up The Crowd re-roll(s)`,
  showStarReRollLost: (r, g) => `${teamName(g, r.teamId)} loses ${r.rerollShowStarOneDrive ?? '?'} Show Star re-roll(s)`,
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
  playerAction: (r, g) => `${pn(g, r.actingPlayerId ?? r.playerId)} ${humanize(String(r.playerAction ?? 'acts'))}`,
  skillUse: (r, g) => String(r.skill ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase() === 'reliable'
      && String(r.skillUse ?? '') === 'fumbledPlayerLandsSafely'
    ? `play: Reliable used (${pn(g, r.playerId)})`
    : /^cancel[A-Z]/.test(String(r.skillUse ?? ''))
      // Owner 09-05: automatic cancels (Juggernaut vs Wrestle/Fend/Stand Firm, Tackle vs Dodge…) read as a cancel.
      ? `${pn(g, r.playerId)}: ${r.skill ?? 'a skill'} cancels ${String(r.skillUse).slice(6).replace(/([a-z])([A-Z])/g, '$1 $2')}!`
      : `${pn(g, r.playerId)} uses ${r.skill ?? 'a skill'}`,
  // Owner #83 (07-18): a GATED reroll source (Loner, Pro) must roll to GRANT the reroll — the `reRoll` report
  // (ReportReRoll) carries that roll + pass/fail (wire fields `roll`/`successful`), which the old formatter dropped,
  // so a failed Loner/Pro vanished from the log (the reported "Loner roll missing"). Surface roll + outcome whenever
  // the wire carries a gating roll (roll>0). Plain team/skill rerolls carry no gate (roll 0, always successful) →
  // byte-unchanged. ⚖: displays sent data only (no target derivation — ReportReRoll carries no minimumRoll).
  reRoll: (r, g) => {
    const src = humanize(String(r.reRollSource ?? 'team re-roll'));
    const roll = r.roll;
    if (typeof roll === 'number' && Number.isInteger(roll) && roll > 0) {
      const outcome = r.successful === false ? 'FAILED | no re-roll' : 'passed';
      return `${pn(g, r.playerId)} re-rolls (${src}) | rolled ${d6(roll)}, ${outcome}`;
    }
    return `${pn(g, r.playerId)} re-rolls (${src})`;
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
      : injuryTypeName.startsWith('foul') && typeof r.attackerId === 'string' && r.attackerId
        ? `${pn(g, r.attackerId)} fouls ${name}`
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
      const attributedArmour = `${name} | ${armourCause} | ${armourPart}`;
      // An armour roll that held never has an injury phase. Preserve that normal
      // report grammar even if a malformed payload happens to carry extra dice.
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
    const body = parts.join('; ');
    const head = ar ? `${name} | ${armourCause} | ${body}` : lead ? `${lead} | ${body}` : body;
    return [head, effect, casualtyLine].filter(Boolean).join('\n');
  },
  // Owner 2026-07-06 (finding C): the apothecary report is NOT a pass/fail d6 — it
  // has no `roll`/`successful`, it RE-ROLLS the casualty (casualtyRoll + the new
  // seriousInjury). The generic skillRoll printed "rolls undefined — fails" for
  // every apothecary use; report the casualty re-roll + resulting injury instead.
  apothecaryRoll: (r, g) => {
    const casualty = Array.isArray(r.casualtyRoll) ? (r.casualtyRoll as number[]) : [];
    const name = pn(g, r.playerId);
    if (!casualty.length) return `${name} is not treated by the apothecary.`;
    const version = rulesVersion(g);
    const d6Index = version === 'BB2016' ? 0 : version === 'BB2020' || version === 'BB2025' ? 1 : -1;
    const dice = casualty.map((roll, index) => index === d6Index ? d6(roll) : String(roll)).join(', ');
    const injury = r.seriousInjury ? seriousInjuryLabel(r.seriousInjury) : playerStateResult(r.playerState);
    return `${name} is treated by the apothecary | casualty roll [${dice}]: ${injury}`;
  },
  // Upstream ffb-server/.../bb2025/shared/StepApothecary.java:528-537 converts KO to STUNNED and emits
  // ReportApothecaryChoice; ffb-common/.../PlayerState.java:13-14 defines the wire states 4 and 5.
  apothecaryChoice: (r, g) => {
    const name = pn(g, r.playerId);
    if ((Number(r.playerState) & 0xff) === 4) {
      return `${name} is treated by the apothecary. They are only stunned.`;
    }
    return `${name}'s apothecary result: ${playerStateResult(r.playerState)}.`;
  },
  // Corner direction is D3, other direction is D6, and the wire carries no corner flag.
  // Keep direction numeric; the two distance dice are always D6.
  throwIn: (r) => {
    const distance = Array.isArray(r.distanceRoll) ? d6Pair(r.distanceRoll) : '';
    return `the crowd throws the ball back in ${r.direction ?? '?'}${r.directionRoll != null ? ` (direction ${r.directionRoll})` : ''}${distance ? `, distance ${distance}` : ''}`;
  },
  scatterBall: (r) => {
    const rolls = Array.isArray(r.rolls) ? (r.rolls as number[]).join(', ') : '';
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
    const roll = version === 'BB2020' || version === 'BB2025' ? d6 : (value: unknown) => String(value ?? '?');
    let winner = typeof r.teamId === 'string' && r.teamId ? teamName(g, r.teamId) : 'both teams';
    if (version === 'BB2016') {
      winner = r.homeGainsReRoll && r.awayGainsReRoll ? 'both teams'
        : r.homeGainsReRoll ? home : r.awayGainsReRoll ? away : 'neither team';
    }
    return `Brilliant Coaching | ${home} ${roll(r.rollHome)}, ${away} ${roll(r.rollAway)} | ${winner} gain a re-roll`;
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
      + (rerolled ? ` (${rerolled} re-rolled)` : '');
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
    const outcome = r.homeTeam == null ? 'tie | re-roll' : `${r.homeTeam ? home : away} scores`;
    const decided = typeof r.teamId === 'string' && r.teamId
      ? ` | ${teamName(g, r.teamId)} wins the shootout` : '';
    return `penalty shootout ${round}: ${home} ${d6(r.rollHome)}, ${away} ${d6(r.rollAway)} | ${outcome} (${r.penaltyScoreHome ?? 0}–${r.penaltyScoreAway ?? 0})${decided}`;
  },
};

function humanize(id: string): string {
  // split camelCase, then collapse underscores / repeated spaces to a single
  // space (B9-12 G3: a reRollSource like "team_reRoll" rendered "team  re roll").
  return id
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_\s]+/g, ' ')
    .toLowerCase()
    .trim();
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

export function formatReportDisplay(report: Report, game: GameJson | null): ReportDisplay {
  const id = String(report.reportId ?? 'unknown');
  const formatter = formatters[id];
  if (formatter) {
    try {
      return decodeDisplay(formatter(report, game));
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
  return decodeDisplay(extras ? `${humanize(id)} | ${extras}` : humanize(id));
}

export function formatReport(report: Report, game: GameJson | null): string {
  return formatReportDisplay(report, game).text;
}

/** #10x (owner 08-17): multi-LINE entry point — most reportIds still render as exactly one
 *  line (delegates to formatReportDisplay), but turnEnd splits into several (TD line, grouped
 *  KO-recovery lines, heat-exhaustion line) instead of one '; '-joined wall of text. Callers
 *  should log() each returned entry as its own line, in order. */
export function formatReportLines(report: Report, game: GameJson | null): ReportDisplay[] {
  if (String(report.reportId ?? '') === 'turnEnd') {
    try {
      return turnEndLines(report, game).map(decodeDisplay);
    } catch {
      // fall through to the single-line generic path
    }
  }
  // Owner 09-05: any formatter may return several lines separated by '\n' (the injury report does — dice line,
  // effect sentence, casualty result); each becomes its own log entry, decoded on its own.
  const formatter = formatters[String(report.reportId ?? 'unknown')];
  if (formatter) {
    try {
      const raw = formatter(report, game);
      if (raw.includes('\n')) return raw.split('\n').filter((line) => line.length > 0).map(decodeDisplay);
    } catch {
      // fall through to the single-line generic path
    }
  }
  return [formatReportDisplay(report, game)];
}
