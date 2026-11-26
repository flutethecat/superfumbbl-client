import { effectiveStat, normalizeSkillName, playerHasSkill, type GameJson, type PlayerJson } from '@fumbbl40k/ffb-protocol';
import { adjacentOpponents, findPlayer } from './jumpTarget';

type Square = readonly [number, number];

export type DodgeRulesVersion = 'BB2020' | 'BB2025';

/** The game's own `rulesVersion` option; BB2020 when it says so, else the current rules (BB2025). */
export function dodgeRulesVersion(game: GameJson | null | undefined): DodgeRulesVersion {
  const options = (game as { gameOptions?: { gameOptionArray?: readonly { gameOptionId?: unknown; gameOptionValue?: unknown }[] } } | null | undefined)
    ?.gameOptions?.gameOptionArray;
  const value = options?.find((option) => option.gameOptionId === 'rulesVersion')?.gameOptionValue;
  return /^BB2020$/i.test(String(value ?? '').trim()) ? 'BB2020' : 'BB2025';
}

/**
 * Skills that carry CancelSkillProperty(ignoreTacklezonesWhenDodging) — they switch a mover's Stunty off for dodges
 * (UtilCards.hasUncanceledSkillWithProperty). BB2020: skill/bb2020/Bombardier :43, Chainsaw :49, Swoop :36. BB2025:
 * none (skill/bb2025/Bombardier, Chainsaw, Swoop register no cancel; skill/mixed/SecretWeapon never did — only the
 * BB2016 Secret Weapon / Swoop cancel it).
 */
const STUNTY_CANCELLERS: Record<DodgeRulesVersion, readonly string[]> = {
  BB2020: ['Bombardier', 'Chainsaw', 'Swoop'],
  BB2025: [],
};

/**
 * Break Tackle's dodge modifier by strength (DodgeModifier useStrength=true, ModifierType.REGULAR).
 * BB2020 (skill/bb2020/BreakTackle): -2 at ST 5+, -1 at ST 4-.
 * BB2025 (skill/bb2025/BreakTackle): -3 at ST 5+, -2 at ST 4, -1 at ST 3-.
 */
export function breakTackleModifier(rules: DodgeRulesVersion, strength: number): number {
  if (rules === 'BB2020') return strength >= 5 ? -2 : -1;
  return strength >= 5 ? -3 : strength === 4 ? -2 : -1;
}

/**
 * True when Break Tackle can still lower the mover's next dodge: the mover has it (base or temporary) and, if the
 * mover is the acting player, the skill is not yet in actingPlayer.usedSkills. Upstream's modifier applies while
 * UtilCards.hasUnusedSkill(actingPlayer, skill) (BreakTackle#appliesToContext); a player who has not activated yet
 * starts the activation with it unused.
 */
export function breakTackleAvailable(game: GameJson | null | undefined, playerId: string | null | undefined): boolean {
  if (!game) return false;
  const id = String(playerId ?? '');
  const found = id ? findPlayer(game, id) : null;
  if (!found || !playerHasSkill(found.player, 'Break Tackle')) return false;
  const acting = game.actingPlayer as { playerId?: string | null; usedSkills?: unknown } | undefined;
  if (String(acting?.playerId ?? '') !== id) return true;
  const used = Array.isArray(acting?.usedSkills) ? acting!.usedSkills as unknown[] : [];
  return !used.some((s) => normalizeSkillName(String(s)) === normalizeSkillName('Break Tackle'));
}

export interface DodgeProjectionOptions {
  /** Include Break Tackle's modifier: what the SERVER prices while the skill is unused. Never shown (shownDodgeTarget). Default: false. */
  breakTackle?: boolean;
  /** A further modifier summed with the others BEFORE the minimum-2 clamp (e.g. a worst-case Diving Tackle +2). */
  extraModifier?: number;
}

/**
 * Client PROJECTION of a dodge's minimum roll for a step the server has NOT priced. Wherever the server sent the
 * square's minimumRollDodge (fieldModel.moveSquareArray), callers show that number through shownDodgeTarget (the
 * server's own number, with only an unused Break Tackle taken back off).
 *
 * Mirrors fumbbl40k-server ffb-common (upstream/Live):
 *  - AgilityMechanic (bb2020 / bb2025) minimumRollDodge = Math.max(2, AG with modifiers + Σ modifier) — no upper
 *    clamp here (the tag drawing clamps to 6+ as before);
 *  - DodgeModifierFactory#numberOfTacklezones: opposing players WITH tackle zones adjacent to the DESTINATION, minus
 *    those with hasNoTacklezoneForDodging (Titchy); collection entries "1..8 Tacklezones" = +N;
 *  - #isAffectedByTackleZones: skipped for an UNCANCELLED ignoreTacklezonesWhenDodging (Stunty; see
 *    STUNTY_CANCELLERS);
 *  - #findModifiers + prehensileTailModifier: opponents with tackle zones adjacent to the SOURCE square that have
 *    makesDodgingHarder (Prehensile Tail). Every entry of modifiers/mixed/DodgeModifierCollection (1..8 tails) has
 *    modifier 1 — the count only selects the entry — so any number of tails is +1 TOTAL. Applies to Stunty too;
 *  - skill modifiers over getSkillsIncludingTemporaryOnes: Two Heads -1 (skill/common/TwoHeads), Titchy -1
 *    (skill/mixed/Titchy), Break Tackle (breakTackleModifier) when options.breakTackle. Diving Tackle is the
 *    opponent's post-roll choice (ModifierType.DIVING_TACKLE, added by StepMoveDodge only when used) — not here.
 *
 * Returns null when the mover or its AG is unknown.
 */
export function dodgeTargetForPlayer(
  game: GameJson | null | undefined,
  playerId: string | null | undefined,
  from: Square,
  to: Square,
  options: DodgeProjectionOptions = {},
): number | null {
  if (!game) return null;
  const id = String(playerId ?? '');
  const found = id ? findPlayer(game, id) : null;
  if (!found) return null;
  const { player, home } = found;
  if ((player as { agility?: unknown }).agility == null) return null;
  const agility = effectiveStat(player, 'AG');
  if (!Number.isFinite(agility) || agility <= 0) return null;
  const rules = dodgeRulesVersion(game);
  return Math.max(2, agility + dodgeModifierSum(game, player, home, from, to, rules, options) + (options.extraModifier ?? 0));
}

/**
 * The dodge number SHOWN for a square the server priced. Owner 11-23: Break Tackle is spent once per activation, so
 * a predicted dodge never counts it; modifiers that apply to every dodge (Two Heads, Titchy, ...) still do.
 * Upstream prices every square with Break Tackle while it is unused (UtilServerPlayerMove#addMoveSquare ->
 * BreakTackle#appliesToContext), so the server's number has it taken off again here.
 *
 * When the mirror agrees with the server (its Break Tackle number equals the server's), the mirror's number without
 * Break Tackle is shown. When they differ (a modifier the mirror does not know), the Break Tackle modifier is
 * taken back off the server's number; a server number at the minimum of 2 hides how far below 2 it went, so there
 * the mirror's number without Break Tackle is shown. An adjusted number is capped at 6+; a number that needs no
 * adjusting (no Break Tackle, already used, or it changes nothing here) is returned exactly as sent.
 */
export function shownDodgeTarget(
  game: GameJson | null | undefined,
  playerId: string | null | undefined,
  from: Square,
  to: Square,
  serverTarget: number,
): number {
  if (!(serverTarget > 0) || !breakTackleAvailable(game, playerId)) return serverTarget;
  const without = dodgeTargetForPlayer(game, playerId, from, to);
  const withBt = dodgeTargetForPlayer(game, playerId, from, to, { breakTackle: true });
  if (without === null || withBt === null) return serverTarget;
  const found = findPlayer(game!, String(playerId));
  const modifier = found ? breakTackleModifier(dodgeRulesVersion(game), effectiveStat(found.player, 'ST')) : 0;
  const adjusted = withBt === serverTarget ? without : serverTarget > 2 ? serverTarget - modifier : without;
  // Nothing to take back (Break Tackle changes nothing here): the server's number exactly as sent.
  if (adjusted <= serverTarget) return serverTarget;
  // Sol r1 / r2: a number that had Break Tackle taken back off is capped at 6+ like every projected tag.
  return Math.min(6, adjusted);
}

/**
 * Owner 11-23 ("a small tag underneath the first dodge die tag that says BT +<N>"): how much Break Tackle would add
 * to this dodge's roll, as a positive number, or 0 when it has nothing to offer here: the mover lacks it, it is
 * already used this activation, or the dodge shows the same number with and without it (both capped to 2+..6+).
 */
export function breakTackleBonus(
  game: GameJson | null | undefined,
  playerId: string | null | undefined,
  from: Square,
  to: Square,
): number {
  if (!breakTackleAvailable(game, playerId)) return 0;
  const without = dodgeTargetForPlayer(game, playerId, from, to);
  const withBt = dodgeTargetForPlayer(game, playerId, from, to, { breakTackle: true });
  if (without === null || withBt === null || Math.min(6, without) <= Math.min(6, withBt)) return 0;
  const found = findPlayer(game!, String(playerId));
  return found ? -breakTackleModifier(dodgeRulesVersion(game), effectiveStat(found.player, 'ST')) : 0;
}

function dodgeModifierSum(
  game: GameJson,
  player: PlayerJson,
  home: boolean,
  from: Square,
  to: Square,
  rules: DodgeRulesVersion,
  options: DodgeProjectionOptions,
): number {
  const has = (skill: string) => playerHasSkill(player, skill);
  const opponentIds = new Set((home ? game.teamAway : game.teamHome).playerArray.map((p) => String(p.playerId)));
  let sum = 0;
  const stuntyActive = has('Stunty') && !STUNTY_CANCELLERS[rules].some(has);
  if (!stuntyActive) {
    const marks = adjacentOpponents(game, opponentIds, to).filter((p) => !playerHasSkill(p, 'Titchy')).length;
    sum += Math.min(8, marks);
  }
  if (adjacentOpponents(game, opponentIds, from).some((p) => playerHasSkill(p, 'Prehensile Tail'))) sum += 1;
  if (has('Two Heads')) sum -= 1;
  if (has('Titchy')) sum -= 1;
  if (options.breakTackle && has('Break Tackle')) sum += breakTackleModifier(rules, effectiveStat(player, 'ST'));
  return sum;
}
