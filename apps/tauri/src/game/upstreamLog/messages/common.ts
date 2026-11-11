/**
 * Ports of upstream's rules-independent report renderers (ffb-client-logic client/report/*Message.java, the
 * @RulesCollection(Rules.COMMON) ones), line for line. Rolls that the BB2020 / BB2025 packages override live in
 * their own files.
 */
import {
  actingPlayer, arrayProvided, bool, COMMON_TABLES, dative, directionName, formatRollModifiersByReportString, formatThousands,
  genitive, hasUncanceledSkillWithProperty, ints, isHomeTeamId, nominative, num, playerById, playerName, playerStateValue,
  provided, rollModifierRows, rulesOf, self, sideOfPlayer, skillHasProperty, skillIntValue, skillRow, skillWithProperty,
  agilityWithModifiers, canonicalSkill, strings, tablesOf, verbForm, type Report,
} from '../model';
import type { UpstreamPrinter } from '../printer';
import { neededRollText, type UpstreamRendererSet } from '../registry';
import type { GameJson, PlayerJson } from '@fumbbl40k/ffb-protocol';

/** AgilityMechanic.formatResult (BB2020 / BB2025): " (Roll<modifiers><stat modifier> >= <AG>+)". */
export function agilityResult(agility: number, game: GameJson | null, factory: string, modifiers: unknown, statBased: unknown = null): string {
  let statModifier = '';
  if (statBased && typeof statBased === 'object') {
    const s = statBased as { name?: unknown; value?: unknown };
    statModifier = ` + ${num(s.value)} ${String(s.name ?? 'null')}`;
  }
  return ` (Roll${formatRollModifiersByReportString(rollModifierRows(game, factory, modifiers))}${statModifier} >= ${Math.max(2, agility)}+)`;
}

/** The skill-roll shape most renderers share: a ROLL line, then "<player><outcome>" and the needed roll. */
function teamStyle(game: GameJson | null, player: PlayerJson | null): 'home' | 'away' {
  return sideOfPlayer(game, player) === 'home' ? 'home' : 'away';
}

function coachStyleForPlayer(game: GameJson | null, player: PlayerJson | null): ['home' | 'away', string] {
  return sideOfPlayer(game, player) === 'home'
    ? ['home', String(game?.teamHome?.coach ?? 'null')]
    : ['away', String(game?.teamAway?.coach ?? 'null')];
}

/** PlayerState.getDescription for a wire PlayerState (null when the base has no description). */
export function playerStateDescription(state: unknown): string {
  const base = typeof state === 'number' ? state & 0xff : -1;
  return COMMON_TABLES.playerStateDescriptions[String(base)] ?? 'null';
}

function alwaysHungry(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const thrower = actingPlayer(game);
  out.println(out.getIndent(), 'roll', `Always Hungry Roll [ ${num(r.roll)} ]`);
  out.player(out.getIndent() + 1, false, thrower);
  const status = bool(r.successful) ? ' resists the hunger.' : ` tries to eat ${genitive(thrower)} team-mate.`;
  out.println(out.getIndent() + 1, 'none', status);
}

function animosity(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = actingPlayer(game);
  out.println(out.getIndent(), 'roll', `Animosity Roll [ ${num(r.roll)} ]`);
  out.player(out.getIndent() + 1, false, player);
  const ok = bool(r.successful);
  out.printlnT(out.getIndent() + 1, ok ? ` resists ${genitive(player)} Animosity.` : ` gives in to ${genitive(player)} Animosity.`);
  const needed = neededRollText(r, ok);
  if (needed !== null) out.println(out.getIndent() + 1, 'neededRoll', needed);
}

function apothecaryChoice(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = playerById(game, r.playerId);
  const state = typeof r.playerState === 'number' ? r.playerState : null;
  if (state !== null && (state & 0xff) === 9) {
    out.print(out.getIndent(), 'bold', 'The apothecary patches ');
    out.player(out.getIndent(), true, player);
    out.println(out.getIndent(), 'bold', ` up so ${nominative(player)} is able to play again.`);
    return;
  }
  out.printT(out.getIndent(), 'Coach ');
  const [style, coach] = coachStyleForPlayer(game, player);
  out.print(out.getIndent(), style, coach);
  // upstream compares the report's freshly parsed PlayerState with the field's by reference: they always differ
  // unless both are missing, then the serious injuries (enums) decide
  const oldState = playerStateValue(game, r.playerId);
  const results = [...(game?.gameResult?.teamResultHome?.playerResults ?? []), ...(game?.gameResult?.teamResultAway?.playerResults ?? [])];
  const oldSi = results.find((p) => p.playerId === r.playerId)?.seriousInjury ?? null;
  const newSi = typeof r.seriousInjury === 'string' ? r.seriousInjury : null;
  const differs = state !== null || oldState !== null || newSi !== (typeof oldSi === 'string' ? oldSi : null);
  out.printlnT(out.getIndent(), differs ? ' chooses the new injury result.' : ' keeps the old injury result.');
}

function biteSpectator(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = playerById(game, r.playerId);
  if (player) {
    out.player(out.getIndent(), true, player);
    out.println(out.getIndent(), 'bold', ' heads off to the spectator ranks to bite some beautiful maiden.');
  }
}

function block(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  out.setIndent(1);
  const attacker = actingPlayer(game);
  const defender = playerById(game, r.defenderId);
  out.player(out.getIndent(), true, attacker);
  out.print(out.getIndent(), 'bold', game?.actingPlayer?.playerAction === 'blitz' ? ' blitzes ' : ' blocks ');
  out.player(out.getIndent(), true, defender);
  out.println(out.getIndent(), 'bold', ':');
}

function blockRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const roll = ints(r.blockRoll);
  if (!arrayProvided(r.blockRoll)) return;
  out.setIndent(2);
  let status = 'Block Roll';
  if (provided(r.defenderId)) {
    status += ' against ';
    out.print(out.getIndent(), 'roll', status);
    out.player(out.getIndent(), true, playerById(game, r.defenderId));
    status = '';
  }
  const results = tablesOf(game).blockResults;
  for (const face of roll) status += ` [ ${results[String(face)] ?? results['3']} ]`;
  out.println(out.getIndent(), 'roll', status);
}

function bombExplodesAfterCatch(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  out.println(out.getIndent() + 1, 'roll', `Bomb Roll [ ${num(r.roll)} ]`);
  const catcher = playerById(game, r.catcherId);
  out.print(out.getIndent() + 2, teamStyle(game, catcher), playerName(catcher), catcher?.playerId);
  out.printT(out.getIndent() + 2, ' caught the bomb');
  if (bool(r.explodes)) out.printlnT(out.getIndent() + 2, ` but it explodes in ${genitive(catcher)} hands.`);
  else out.printlnT(out.getIndent() + 2, ' and it does not explode');
}

function bribesRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = playerById(game, r.playerId);
  out.println(out.getIndent(), 'roll', `Bribes Roll [ ${num(r.roll)} ]`);
  if (bool(r.successful)) {
    out.print(out.getIndent() + 1, 'none', 'The ref refrains from penalizing ');
    out.player(out.getIndent() + 1, false, player);
    out.println(out.getIndent() + 1, 'none', ` and ${nominative(player)} ${verbForm(player, 'remains', 'remain')} in the game.`);
  } else {
    out.print(out.getIndent() + 1, 'none', 'The ref appears to be unimpressed and ');
    out.player(out.getIndent() + 1, false, player);
    out.println(out.getIndent() + 1, 'none', ' must leave the game.');
  }
}

function cardDeactivated(r: Report, out: UpstreamPrinter): void {
  out.println(out.getIndent(), 'bold', `Card ${String(r.card ?? 'null')} effect ended.`);
}

function catchRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = playerById(game, r.playerId);
  const bomb = bool(r.bomb);
  if (!bool(r.reRolled)) {
    out.player(out.getIndent(), true, player);
    out.println(out.getIndent(), 'bold', bomb ? ' tries to catch the bomb:' : ' tries to catch the ball:');
  }
  out.println(out.getIndent() + 1, 'roll', `Catch Roll [ ${num(r.roll)} ]`);
  out.player(out.getIndent() + 2, false, player);
  const ok = bool(r.successful);
  if (ok) out.printlnT(out.getIndent() + 2, bomb ? ' catches the bomb.' : ' catches the ball.');
  else out.printlnT(out.getIndent() + 2, ' fails the catch.');
  const needed = neededRollText(r, ok);
  if (needed !== null) {
    out.println(out.getIndent() + 2, 'neededRoll', needed + agilityResult(agilityWithModifiers(player), game, 'CATCH_MODIFIER', r.rollModifiers));
  }
}

function chainsawRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = actingPlayer(game);
  out.println(out.getIndent(), 'roll', `Chainsaw Roll [ ${num(r.roll)} ]`);
  out.player(out.getIndent() + 1, false, player);
  out.printT(out.getIndent() + 1, bool(r.successful) ? ` uses ${genitive(player)} Chainsaw` : `'s Chainsaw kicks back to hurt ${dative(player)}`);
  if (provided(r.defenderId)) {
    out.printT(out.getIndent() + 1, ' against ');
    const defender = playerById(game, r.defenderId);
    if (defender) out.player(out.getIndent() + 1, false, defender);
  }
  out.printlnT(out.getIndent() + 1, '.');
}

function coinThrow(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  out.setIndent(0);
  out.println(out.getIndent(), 'bold', 'The referee throws the coin.');
  out.printT(out.getIndent() + 1, 'Coach ');
  const coach = String(r.coach ?? 'null');
  out.print(out.getIndent() + 1, game?.teamHome?.coach === r.coach ? 'home' : 'away', coach);
  out.printlnT(out.getIndent() + 1, ` chooses ${bool(r.coinChoiceHeads) ? 'HEADS.' : 'TAILS.'}`);
  out.printlnT(out.getIndent() + 1, `Coin throw is ${bool(r.coinThrowHeads) ? 'HEADS.' : 'TAILS.'}`);
}

function confusionRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const skill = canonicalSkill(game, r.confusionSkill);
  if (!skill) return;
  const player = actingPlayer(game);
  out.println(out.getIndent(), 'roll', `${skill} Roll [ ${num(r.roll)} ]`);
  out.player(out.getIndent() + 1, false, player);
  const ok = bool(r.successful);
  if (ok) out.printlnT(out.getIndent() + 1, ' is able to act normally.');
  else out.printlnT(out.getIndent() + 1, ` ${skillRow(game, skill)?.confusion ?? 'is confused'}.`);
  let needed = neededRollText(r, ok);
  if (needed !== null) {
    const min = num(r.minimumRoll);
    if (skillHasProperty(game, skill, 'needsToRollForActionButKeepsTacklezone')) {
      needed += min > 2 ? ' (Player does not attack)' : ' (Player does attack)';
    }
    if (skillHasProperty(game, skill, 'needsToRollHighToAvoidConfusion')) {
      needed += min > 2 ? ' (Really Stupid player without assistance)' : ' (Really Stupid player gets help from team-mates)';
    }
    out.println(out.getIndent() + 1, 'neededRoll', `${needed}.`);
  }
}

function dauntlessRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = actingPlayer(game);
  out.println(out.getIndent(), 'roll', `Dauntless Roll [ ${num(r.roll)} ]`);
  out.player(out.getIndent() + 1, false, player);
  out.printT(out.getIndent() + 1, bool(r.successful)
    ? ` uses Dauntless to push ${self(player)} to strength ${num(r.strength)}`
    : ` fails to push ${genitive(player)} strength`);
  if (provided(r.defenderId)) {
    const defender = playerById(game, r.defenderId);
    if (defender) {
      out.printT(out.getIndent() + 1, ' to match ');
      out.player(out.getIndent() + 1, false, defender);
    }
  }
  out.printlnT(out.getIndent() + 1, '.');
}

function defectingPlayers(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const ids = strings(r.playerIds);
  if (!ids.length) return;
  const rolls = ints(r.rolls);
  const defecting = Array.isArray(r.defectingArray) ? r.defectingArray : [];
  ids.forEach((id, i) => {
    out.println(out.getIndent(), 'roll', `Defecting Players Roll [ ${rolls[i] ?? 0} ]`);
    out.player(out.getIndent() + 1, false, playerById(game, id));
    out.println(out.getIndent() + 1, 'none', defecting[i] === true ? ' leaves the team in disgust.' : ' stays with the team.');
  });
}

function doubleHiredStarPlayer(r: Report, out: UpstreamPrinter): void {
  out.println(out.getIndent(), 'bold', `Star Player ${String(r.starPlayerName ?? 'null')} takes money from both teams and plays for neither.`);
}

function dodgeRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = playerById(game, r.playerId);
  out.println(out.getIndent(), 'roll', num(r.roll) > 0 ? `Dodge Roll [ ${num(r.roll)} ]` : 'New Dodge Result');
  if (!bool(r.reRolled)) {
    if (hasUncanceledSkillWithProperty(game, player, 'ignoreTacklezonesWhenDodging')) {
      out.player(out.getIndent() + 1, false, player);
      out.printlnT(out.getIndent() + 1, ' is Stunty and ignores tacklezones.');
    }
    if (rollModifierRows(game, 'DODGE_MODIFIER', r.rollModifiers).some((m) => m.useStrength)) {
      out.player(out.getIndent() + 1, false, player);
      out.printlnT(out.getIndent() + 1, ' uses Break Tackle to break free.');
    }
  }
  out.player(out.getIndent() + 1, false, player);
  const ok = bool(r.successful);
  out.printlnT(out.getIndent() + 1, ok ? ' dodges successfully.' : ' trips while dodging.');
  const needed = neededRollText(r, ok);
  if (needed !== null) {
    out.println(out.getIndent() + 1, 'neededRoll',
      needed + agilityResult(agilityWithModifiers(player), game, 'DODGE_MODIFIER', r.rollModifiers, r.statBasedRollModifier));
  }
}

function escapeRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const thrown = playerById(game, r.playerId);
  out.println(out.getIndent(), 'roll', `Escape Roll [ ${num(r.roll)} ]`);
  out.player(out.getIndent() + 1, false, thrown);
  out.println(out.getIndent() + 1, 'none', bool(r.successful) ? ' manages to wriggle free.' : ` disappears in ${genitive(thrown)} team-mate's stomach.`);
}

function foulAppearanceRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = actingPlayer(game);
  out.println(out.getIndent(), 'roll', `Foul Appearance Roll [ ${num(r.roll)} ]`);
  out.player(out.getIndent() + 1, false, player);
  out.printT(out.getIndent() + 1, bool(r.successful) ? ' resists the Foul Appearance' : ' cannot overcome the Foul Appearance');
  if (provided(r.defenderId)) {
    const defender = playerById(game, r.defenderId);
    if (defender) {
      out.printT(out.getIndent() + 1, ' of ');
      out.player(out.getIndent() + 1, false, defender);
    }
  }
  out.printlnT(out.getIndent() + 1, '.');
}

function foul(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  out.player(out.getIndent(), true, actingPlayer(game));
  out.print(out.getIndent(), 'bold', ' fouls ');
  out.player(out.getIndent(), true, playerById(game, r.defenderId));
  out.printlnT(out.getIndent(), ':');
  out.setIndent(out.getIndent() + 1);
}

function fumbblResultUpload(r: Report, out: UpstreamPrinter): void {
  out.println('spaceAboveBelow', 'bold', `Fumbbl Result Upload ${bool(r.successful) ? 'ok' : 'failed'}`);
  out.printlnT(out.getIndent() + 1, typeof r.uploadStatus === 'string' ? r.uploadStatus : null);
}

function handOver(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  out.player(out.getIndent(), true, actingPlayer(game));
  out.print(out.getIndent(), 'bold', ' hands over the ball to ');
  out.player(out.getIndent(), true, playerById(game, r.catcherId));
  out.println(out.getIndent(), 'bold', ':');
}

function interceptionRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = playerById(game, r.playerId);
  const ignoreAgility = bool(r.ignoreAgility);
  // AgilityMechanic.interceptionWording: BB2020 says "Interference" unless the intercept is the easy (agility-free) one
  const wording = rulesOf(game) === 'BB2020' && !ignoreAgility
    ? { noun: 'Interference', verb: 'deflect', inflection: 'deflects' }
    : { noun: 'Interception', verb: 'intercept', inflection: 'intercepts' };
  const bomb = bool(r.bomb);
  if (!bool(r.reRolled)) {
    out.player(out.getIndent(), true, player);
    out.println(out.getIndent(), 'bold', ` tries to ${wording.verb} the ${bomb ? 'bomb' : 'ball'}:`);
  }
  out.println(out.getIndent() + 1, 'roll', `${wording.noun} Roll [ ${num(r.roll)} ]`);
  out.player(out.getIndent() + 2, false, player);
  const ok = bool(r.successful);
  if (ok) out.printlnT(out.getIndent() + 2, ` ${wording.inflection} the ${bomb ? 'bomb' : 'ball'}.`);
  else out.printlnT(out.getIndent() + 2, ` fails to ${wording.verb} the ${bomb ? 'bomb' : 'ball'}.`);
  let needed = neededRollText(r, ok);
  if (needed !== null) {
    if (!ignoreAgility) needed += agilityResult(agilityWithModifiers(player), game, 'INTERCEPTION_MODIFIER', r.rollModifiers);
    out.println(out.getIndent() + 2, 'neededRoll', needed);
  }
}

function jumpRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = actingPlayer(game);
  out.println(out.getIndent(), 'roll', `Jump Roll [ ${num(r.roll)} ]`);
  out.player(out.getIndent() + 1, false, player);
  const ok = bool(r.successful);
  out.printlnT(out.getIndent() + 1, ok ? ` jumps over ${genitive(player)} opponents.` : ' trips while jumping.');
  const needed = neededRollText(r, ok);
  if (needed !== null) out.println(out.getIndent() + 1, 'neededRoll', needed + agilityResult(agilityWithModifiers(player), game, 'JUMP_MODIFIER', r.rollModifiers));
}

function jumpUpRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = actingPlayer(game);
  out.println(out.getIndent(), 'roll', `Jump Up Roll [ ${num(r.roll)} ]`);
  out.player(out.getIndent() + 1, false, player);
  const ok = bool(r.successful);
  out.printlnT(out.getIndent() + 1, ok ? ` jumps up to block ${genitive(player)} opponent.` : ` doesn't get to ${genitive(player)} feet.`);
  const needed = neededRollText(r, ok);
  if (needed !== null) out.println(out.getIndent() + 1, 'neededRoll', needed + agilityResult(agilityWithModifiers(player), game, 'JUMP_UP_MODIFIER', r.rollModifiers));
}

function kickoffResult(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  out.setIndent(0);
  const roll = ints(r.kickoffRoll);
  out.println(out.getIndent(), 'roll', arrayProvided(r.kickoffRoll) ? `Kick-off Event Roll [ ${roll[0]} ][ ${roll[1] ?? 0} ]` : 'Chosen kick-off event');
  const name = String(r.kickoffResult ?? 'null');
  const description = tablesOf(game).kickoffResults[name];
  // an unknown result parses to null upstream: getKickoffResult().getName() throws here
  if (description === undefined) throw new Error('unknown kick-off result');
  out.printlnT(out.getIndent() + 1, `Kick-off event is ${name}`);
  out.println(out.getIndent() + 1, 'explanation', description);
  out.setIndent(1);
}

function kickoffScatter(r: Report, out: UpstreamPrinter): void {
  out.setIndent(0);
  const distance = num(r.rollScatterDistance);
  out.println(out.getIndent(), 'roll', `Kick-off Scatter Roll [ ${num(r.rollScatterDirection)} ][ ${distance} ]`);
  out.printlnT(out.getIndent() + 1,
    `The kick will land ${distance}${distance === 1 ? ' square ' : ' squares '}${directionName(r.scatterDirection).toLowerCase()} of where it was aimed.`);
  out.setIndent(1);
}

function leader(r: Report, out: UpstreamPrinter): void {
  out.setIndent(0);
  if (r.leaderState === 'available') {
    out.teamName(false, r.teamId);
    out.printT(out.getIndent() + 1, ' gain a Leader re-roll.');
  } else {
    out.printT(out.getIndent() + 1, 'Leader re-roll removed from ');
    out.teamName(false, r.teamId);
  }
  out.printlnT(out.getIndent() + 1, '.');
}

function masterChefRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const roll = ints(r.masterChefRoll);
  out.println(out.getIndent(), 'roll', `Master Chef Roll [ ${roll[0]} ][ ${roll[1]} ][ ${roll[2]} ]`);
  out.teamName(false, r.teamId);
  const stolen = num(r.reRollsStolen);
  let status = ' steal ';
  if (stolen === 0) status += ' no re-rolls from ';
  else if (stolen === 1) status += `${stolen} re-roll from `;
  else status += `${stolen} re-rolls from `;
  out.printT(out.getIndent() + 1, status);
  out.teamName(false, isHomeTeamId(game, r.teamId) ? game?.teamAway?.teamId : game?.teamHome?.teamId);
  out.printlnT(out.getIndent() + 1, '.');
}

function passBlock(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  if (!bool(r.passBlockAvailable)) {
    out.println(out.getIndent(), isHomeTeamId(game, r.teamId) ? 'home' : 'away', 'No pass blockers in range to intercept.');
  }
}

function passDeviate(r: Report, out: UpstreamPrinter): void {
  out.setIndent(0);
  const ttm = bool(r.throwTeamMate);
  const distance = num(r.rollScatterDistance);
  out.println(out.getIndent(), 'roll', `${ttm ? 'Throw Team Mate' : 'Pass'} Deviates [ ${num(r.rollScatterDirection)} ][ ${distance} ]`);
  out.printlnT(out.getIndent() + 1,
    `The ${ttm ? 'player' : 'ball'} will land ${distance}${distance === 1 ? ' square ' : ' squares '}${directionName(r.scatterDirection).toLowerCase()} from the thrower.`);
  out.setIndent(1);
}

function pettyCash(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  if (!out.state.pettyCashReportReceived) {
    out.state.pettyCashReportReceived = true;
    out.println(out.getIndent(), 'bold', 'Transfer Petty Cash');
  }
  out.printT(out.getIndent() + 1, 'Team ');
  const home = isHomeTeamId(game, r.teamId);
  const team = home ? game?.teamHome : game?.teamAway;
  out.print(out.getIndent() + 1, home ? 'home' : 'away', String(team?.teamName ?? 'null'));
  const gold = num(r.gold);
  out.printlnT(out.getIndent() + 1, ` transfers ${gold > 0 ? `${formatThousands(gold)} gold` : 'nothing'} from the Treasury into Petty Cash.`);
  const treasury = num(team?.treasury);
  if (gold > treasury) out.printlnT(out.getIndent() + 1, `They received an extra ${formatThousands(gold - treasury)} gold for being the underdog.`);
}

function pilingOn(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = playerById(game, r.playerId);
  if (!player) return;
  const skill = skillWithProperty(game, player, 'canPileOnOpponent');
  if (!skill) return;
  const indent = out.getIndent() + 1;
  out.player(indent, false, player);
  out.printlnT(indent, !bool(r.used) ? ` does not use ${skill}.` : ` uses ${skill} to re-roll ${bool(r.reRollInjury) ? 'Injury' : 'Armor'}.`);
}

function playCard(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const onPlayer = provided(r.playerId);
  out.print(out.getIndent(), 'bold', `Card ${String(r.card ?? 'null')}${onPlayer ? ' is played on ' : ' is played.'}`);
  if (onPlayer) {
    out.player(out.getIndent(), true, playerById(game, r.playerId));
    out.println(out.getIndent(), 'bold', '.');
  } else {
    out.blankLine();
  }
}

function pushbackWith(sideStep: string) {
  return (r: Report, out: UpstreamPrinter, game: GameJson | null): void => {
    const indent = out.getIndent() + 1;
    const defender = playerById(game, r.defenderId);
    if (r.pushbackMode === 'sideStep') {
      out.player(indent, false, defender);
      out.printlnT(indent, ` uses ${sideStep} to avoid being pushed.`);
    }
    if (r.pushbackMode === 'grab') {
      const acting = actingPlayer(game);
      out.player(indent, false, acting);
      out.printlnT(indent, ` uses Grab to place ${genitive(acting)} opponent.`);
    }
  };
}

function receiveChoice(r: Report, out: UpstreamPrinter): void {
  out.printT(out.getIndent() + 1, 'Team ');
  out.teamName(false, r.teamId);
  out.printlnT(out.getIndent() + 1, ` is ${bool(r.receiveChoice) ? 'receiving.' : 'kicking.'}`);
}

function regenerationRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  if (num(r.roll) <= 0) return;
  out.println(out.getIndent(), 'roll', `Regeneration Roll [ ${num(r.roll)} ]`);
  out.player(out.getIndent() + 1, false, playerById(game, r.playerId));
  out.printlnT(out.getIndent() + 1, bool(r.successful) ? ' regenerates.' : ' does not regenerate.');
}

function reRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = playerById(game, r.playerId);
  const source = String(r.reRollSource ?? 'null');
  if (source === 'Loner') {
    out.println(out.getIndent() + 1, 'roll', `Loner Roll [ ${num(r.roll)} ]`);
    out.player(out.getIndent() + 2, false, player);
    out.printlnT(out.getIndent() + 2, bool(r.successful) ? ' may use a Team Re-Roll.' : ' wastes a Team Re-Roll.');
  } else if (source === 'Pro') {
    out.println(out.getIndent() + 1, 'roll', `Pro Roll [ ${num(r.roll)} ]`);
    out.player(out.getIndent() + 2, false, player);
    out.printlnT(out.getIndent() + 2, bool(r.successful)
      ? `'s Pro skill allows ${dative(player)} to re-roll the action.`
      : `'s Pro skill does not help ${dative(player)}.`);
  } else {
    out.printlnT(out.getIndent() + 1, `Re-Roll using ${(tablesOf(game).reRollSources[source] ?? source).toUpperCase()}`);
  }
}

function rightStuffRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  out.println(out.getIndent(), 'roll', `Landing Roll [ ${num(r.roll)} ]`);
  const thrown = playerById(game, r.playerId);
  out.player(out.getIndent() + 1, false, thrown);
  const ok = bool(r.successful);
  out.printlnT(out.getIndent() + 1, ok ? ` lands on ${genitive(thrown)} feet.` : ' crashes to the ground.');
  const needed = neededRollText(r, ok);
  if (needed !== null) out.println(out.getIndent() + 1, 'neededRoll', needed + agilityResult(agilityWithModifiers(thrown), game, 'RIGHT_STUFF_MODIFIER', r.rollModifiers));
}

function riotousRookies(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const roll = ints(r.riotousRoll);
  out.println(0, 'roll', `Riotous Rookies Roll [ ${roll[0]} ][ ${roll[1]} ] + 1`);
  const home = isHomeTeamId(game, r.teamId);
  out.print(1, home ? 'home' : 'away', String((home ? game?.teamHome : game?.teamAway)?.teamName ?? 'null'));
  out.println(1, 'none', ` hires ${num(r.riotousAmount)} Riotous Rookies for this game`);
}

function safeThrowRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = actingPlayer(game);
  out.println(out.getIndent() + 1, 'roll', `Safe Throw Roll [ ${num(r.roll)} ]`);
  out.player(out.getIndent() + 2, false, player);
  const ok = bool(r.successful);
  out.printlnT(out.getIndent() + 2, ok ? ' throws safely over any interceptors.' : "'s Safe Throw fails to stop the interception.");
  const needed = neededRollText(r, ok);
  if (needed !== null) out.println(out.getIndent() + 2, 'neededRoll', needed + agilityResult(agilityWithModifiers(player), game, 'NONE', []));
}

function secretWeaponBan(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const ids = strings(r.playerIds);
  if (!ids.length) return;
  const rolls = ints(r.rolls);
  const bans = Array.isArray(r.banArray) ? r.banArray : [];
  for (const side of ['home', 'away'] as const) {
    ids.forEach((id, i) => {
      const player = playerById(game, id);
      if (!player || sideOfPlayer(game, player) !== side) return;
      if (bans[i] === true) {
        out.printT(out.getIndent(), 'The ref bans ');
        out.player(out.getIndent(), false, player);
        out.printlnT(out.getIndent(), ' for using a Secret Weapon.');
      } else {
        out.printT(out.getIndent(), 'The ref overlooks ');
        out.player(out.getIndent(), false, player);
        out.printlnT(out.getIndent(), ' using a Secret Weapon.');
      }
      const weapon = skillWithProperty(game, player, 'getsSentOffAtEndOfDrive');
      // upstream: player.getSkillIntValue(null) throws here, ending the report
      if (!weapon) throw new Error('no secret weapon skill');
      const value = skillIntValue(game, player, weapon);
      if ((rolls[i] ?? 0) > 0) out.println(out.getIndent() + 1, 'neededRoll', `Penalty roll was ${rolls[i]}, banned on a ${value}+`);
    });
  }
}

function spellEffectRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const effect = String(r.specialEffect ?? '');
  const roll = num(r.roll);
  let status = '';
  if (effect === 'lightning') status += `Lightning Spell Effect Roll [ ${roll} ]`;
  if (effect === 'zap') status += `Zap! Spell Effect Roll [ ${roll} ]`;
  if (effect === 'fireball') status += `Fireball Spell Effect Roll [ ${roll} ]`;
  if (effect === 'bomb') status += `Bomb Effect Roll [ ${roll > 0 ? roll : 'automatic success'} ]`;
  out.println(out.getIndent(), 'roll', status);
  out.player(out.getIndent() + 1, false, playerById(game, r.playerId));
  const wizard = effect !== 'bomb';
  if (bool(r.successful)) out.printlnT(out.getIndent() + 1, wizard ? ' is hit by the spell.' : ' is hit by the explosion.');
  else out.printlnT(out.getIndent() + 1, wizard ? ' escapes the spell effect.' : ' escapes the explosion.');
}

function skillUse(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  // S36 Sol r1 #2: a modifier-choice skill (BB2025 Consummate Professional) can be missing from the generated tables,
  // built from the fork server; for the two NEW skillUse values only (a server without them never reaches this), the
  // report's own skill name is printed as sent.
  const skill = canonicalSkill(game, r.skill)
    ?? (typeof r.skillUse === 'string' && Object.prototype.hasOwnProperty.call(STAGED_SKILL_USES, r.skillUse) && typeof r.skill === 'string' && r.skill ? r.skill : null);
  if (!skill) return;
  const player = playerById(game, r.playerId);
  const indent = out.getIndent();
  let status = '';
  const description = skillUseDescription(r.skillUse, player);
  if (!bool(r.used)) {
    if (player) {
      out.player(indent, false, player);
      status += ` does not use ${skill}`;
    } else {
      status += `${skill} is not used`;
    }
  } else if (player) {
    out.player(indent, false, player);
    status += ` uses ${skill}`;
  } else {
    status += `${skill} used`;
  }
  if (description !== null) status += ` ${description}`;
  out.printlnT(indent, `${status}.`);
}

/** S36 (staged): SkillUse values upstream master e7f9858a1 added (SkillUse.java:41-42) that the generated tables, built
 *  from the fork server, do not carry yet. Verbatim upstream descriptions; the generated table wins once it has them. */
const STAGED_SKILL_USES: Readonly<Record<string, string>> = {
  addDodgeModifier: 'to improve the dodge roll',
  addAgilityModifier: 'to improve the agility roll',
};

/** SkillUse.getDescription(player): %g becomes the player's genitive. */
export function skillUseDescription(skillUse: unknown, player: PlayerJson | null): string | null {
  const template = typeof skillUse === 'string' ? COMMON_TABLES.skillUses[skillUse] ?? (Object.prototype.hasOwnProperty.call(STAGED_SKILL_USES, skillUse) ? STAGED_SKILL_USES[skillUse] : undefined) : undefined;
  if (template === undefined) return null;
  return player ? template.replaceAll('%g', genitive(player)) : template;
}

function standUpRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = actingPlayer(game);
  out.println(out.getIndent(), 'roll', `Stand Up Roll [ ${num(r.roll)} ]`);
  out.player(out.getIndent() + 1, false, player);
  const ok = bool(r.successful);
  out.printlnT(out.getIndent() + 1, ok ? ' stands up.' : ` doesn't get to ${genitive(player)} feet.`);
  if (!bool(r.reRolled)) {
    // ReportStandUpRoll.getMinimumRoll: max(2, 4 - modifier)
    const min = Math.max(2, 4 - num(r.modifier));
    out.println(out.getIndent() + 1, 'neededRoll', ok ? `Succeeded on a roll of ${min}+.` : `Roll a ${min}+ to succeed.`);
  }
}

function startHalf(r: Report, out: UpstreamPrinter): void {
  const half = num(r.half);
  out.println('spaceAboveBelow', 'turn', `Starting ${half > 2 ? 'Overtime' : half > 1 ? '2nd half' : '1st half'}`);
}

function throwIn(r: Report, out: UpstreamPrinter): void {
  const distance = ints(r.distanceRoll);
  if (!Array.isArray(r.distanceRoll) || distance.length <= 1 || r.direction == null) return;
  const direction = directionName(r.direction);
  out.println(out.getIndent(), 'roll', `Throw In Direction Roll [ ${num(r.directionRoll)} ] ${direction}`);
  out.println(out.getIndent(), 'roll', `Throw In Distance Roll [ ${distance[0]} ][ ${distance[1]} ]`);
  out.printlnT(out.getIndent() + 1, 'The fans throw the ball back onto the pitch.');
  out.printlnT(out.getIndent() + 1, `It lands ${distance[0]! + distance[1]!} squares ${direction}`);
}

function timeoutEnforced(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const text = `Coach ${String(r.coach ?? 'null')} forces a Timeout.`;
  out.println('spaceAbove', game?.teamHome?.coach === r.coach ? 'homeBold' : 'awayBold', text);
  out.println('spaceBelow', 'none', 'The turn will end after the Acting Player has finished moving.');
}

function weather(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const roll = ints(r.weatherRoll);
  out.println(out.getIndent(), 'roll', `Weather Roll [ ${roll[0]} ][ ${roll[1]} ] `);
  const name = String(r.weather ?? 'null');
  const description = tablesOf(game).weather[name];
  // an unknown weather parses to null upstream: getWeather().getName() throws here
  if (description === undefined) throw new Error('unknown weather');
  out.printlnT(out.getIndent() + 1, `Weather is ${name}`);
  out.println(out.getIndent() + 1, 'explanation', description);
}

function weepingDaggerRoll(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  const player = playerById(game, r.playerId);
  out.println(out.getIndent(), 'roll', `Weeping Dagger Roll [ ${num(r.roll)} ]`);
  out.player(out.getIndent() + 1, false, player);
  out.printlnT(out.getIndent() + 1, bool(r.successful) ? ` poisons ${genitive(player)} opponent.` : ` fails to poison ${genitive(player)} opponent.`);
}

function wizardUse(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  out.print(out.getIndent(), 'bold', 'The team wizard of ');
  const home = isHomeTeamId(game, r.teamId);
  out.print(out.getIndent(), home ? 'homeBold' : 'awayBold', String((home ? game?.teamHome : game?.teamAway)?.teamName ?? 'null'));
  const spell = r.wizardSpell;
  out.println(out.getIndent(), 'bold', spell === 'lightning' ? ' casts a Lightning spell.' : spell === 'zap' ? ' casts a Zap! spell.' : ' casts a Fireball spell.');
}

function playerAction(r: Report, out: UpstreamPrinter, game: GameJson | null): void {
  out.setIndent(0);
  const player = playerById(game, r.actingPlayerId);
  const description = typeof r.playerAction === 'string' ? COMMON_TABLES.playerActions[r.playerAction] : undefined;
  if (player && description) {
    out.player(out.getIndent(), true, player);
    out.println(out.getIndent(), 'bold', ` ${description}.`);
  }
  out.setIndent(out.getIndent() + 1);
}

function bombOutOfBounds(_r: Report, out: UpstreamPrinter): void {
  out.println(out.getIndent(), 'bold', 'Bomb scattered out of bounds.');
}

export const COMMON_MESSAGES: Record<string, UpstreamRendererSet> = {
  alwaysHungryRoll: alwaysHungry,
  animosityRoll: animosity,
  apothecaryChoice,
  biteSpectator,
  block,
  blockRoll,
  bombExplodesAfterCatch,
  bombOutOfBounds,
  bribesRoll,
  cardDeactivated,
  catchRoll,
  chainsawRoll,
  coinThrow,
  confusionRoll,
  dauntlessRoll,
  defectingPlayers,
  dodgeRoll,
  doubleHiredStarPlayer,
  escapeRoll,
  foulAppearanceRoll,
  foul,
  fumbblResultUpload,
  gameOptions: () => undefined,
  handOver,
  interceptionRoll,
  leapRoll: jumpRoll,
  jumpUpRoll,
  kickoffResult,
  kickoffScatter,
  leader,
  masterChefRoll,
  passBlock,
  passDeviate,
  pettyCash,
  pilingOn,
  playCard,
  playerAction,
  pushback: { BB2020: pushbackWith('Side Step'), BB2025: pushbackWith('Sidestep') },
  receiveChoice,
  regenerationRoll,
  reRoll,
  rightStuffRoll,
  riotousRookies,
  safeThrowRoll,
  secretWeaponBan,
  skillUse,
  spellEffectRoll,
  standUpRoll,
  startHalf,
  throwIn,
  timeoutEnforced,
  weather,
  weepingDaggerRoll,
  wizardUse,
};
