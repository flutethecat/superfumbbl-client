import type { GameJson, PlayerJson } from '@fumbbl40k/ffb-protocol';
import { normalizeSkillName } from '@fumbbl40k/ffb-protocol';
import { skillsOf } from './actions';
import { hasTackleZones } from './playerState';
import type { Square } from './movement';

/**
 * Block dice preview (activation_logic.md O2/C1/C2): a straight mirror of
 * ServerUtilBlock.findNrOfBlockDice + ServerUtilPlayer.findBlockStrength +
 * bb2025 RollMechanic.getTotalAttackerStrength (the actor's base + Horns).
 *
 * MODELLED faithfully in assistedStrength() (2026-07-14, Echo's R1 drift-guard first run + Fives' audit):
 *  - Eye-Gouged offensive assists skipped; guardIsCanceled (a Defensive marker cancels Guard, every turn mode
 *    except BLITZ, attacker on the acting team); Ball & Chain same-team marker-team flip (gated on the ACTOR, =
 *    upstream's per-call attacker check on ServerUtilPlayer.findBlockStrength — NOT a wire-stripping premise, see #3 below).
 *  - STRENGTH SOURCE: the ACTOR's strength is read from `actingPlayer.strength` (getStrengthWithModifiers =
 *    base + TEMPORARY ST modifiers), NOT the roster `player.strength` (base + lasting-injury only). CONFIRMED
 *    divergence (Echo: 24 corpus frames — brawler/uphill/bonehead). The defender-side temp-ST residual has no
 *    wire field (roster kept for the swapped call).
 *  - HORNS: +1 ST when the actor blitzes (addStrengthOnBlitz + playerAction BLITZ/BLITZ_MOVE).
 * STILL omitted (M4, bounded by Echo's drift-guard + C2a post-declaration diceDecorationArray truth): Dauntless,
 * Multiple/Multi-Block isValidAssist, ignore-assists. Dice formula + base assist rule are EXACT mirrors.
 */

export interface BlockPreview {
  /** number of block dice (1–3) */
  dice: number;
  /** true = Uphill Block, the opponent chooses the die (O2) */
  opponentChoice: boolean;
  attackerStrength: number;
  defenderStrength: number;
}

interface Placed {
  player: PlayerJson;
  square: Square;
  state: number;
  isHome: boolean;
}

/** Base + temporary skills (shared protocol decoder) — Knuckle Dusters' Mighty Blow and every other prayer
 *  grant must answer the same rules checks the roster skills do. */
function skillIs(player: PlayerJson, norm: string): boolean {
  return [...skillsOf(player)].some((s) => normalizeSkillName(s) === norm);
}
/** Guard = the assistsBlocksInTacklezones property (assists even when marked). */
function hasGuard(player: PlayerJson): boolean {
  return skillIs(player, 'guard');
}
/** Defensive = CancelSkillProperty(assistsBlocksInTacklezones) — cancels Guard's assist-in-a-tacklezone. */
function hasDefensive(player: PlayerJson): boolean {
  return skillIs(player, 'defensive');
}
/** Horns = addStrengthOnBlitz — +1 ST when the acting player BLITZES (bb2025 RollMechanic.getTotalAttacker-
 *  Strength). Canonical property holder; a niche co-holder would be missed (guard-bounded, same caveat as B&C). */
function hasHorns(player: PlayerJson): boolean {
  return skillIs(player, 'horns');
}
/** EYE_GOUGED (0x20000) — an eye-gouged offensive assist provides no assist (upstream skips it). */
function isEyeGouged(state: number): boolean {
  return (state & 0x20000) !== 0;
}

function adjacent(a: Square, b: Square): boolean {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) === 1;
}

/** Assisted strength of `attacker` vs `defender` per C2 (symmetric by swapping). A faithful mirror of upstream
 *  ServerUtilPlayer.findBlockStrength + the actor's getTotalAttackerStrength base: actor strength-source
 *  (actingPlayer.strength) + Horns (+1 on blitz) + the assist rule with Eye-Gouged skip, guardIsCanceled, and the
 *  same-team Ball & Chain marker-flip (actor-gated). Still omitted (M4 / drift-guard + C2a bounded): Dauntless,
 *  multi-block isValidAssist, ignore-assists. See the file header for the full divergence ledger + citations. */
function assistedStrength(game: GameJson, all: Placed[], attacker: Placed, defender: Placed): number {
  const sameTeam = attacker.isHome === defender.isHome;
  // The ACTOR (== game.actingPlayer) is the blocking player at nominate/blitz. Several server-side strength inputs
  // are only knowable for the actor (its current ST + the Horns blitz bonus + being the Ball & Chain in a same-team
  // block), so gate them on isActor. A defender-side residual (temp ST on the target) has no wire field.
  const actingId = String((game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  const isActor = !!actingId && attacker.player.playerId === actingId;
  // #3 B&C FLIP (2026-07-14, Echo drift-guard seq85 + Fives): a SAME-TEAM block IMPLIES the B&C opponent-flip —
  // only a flipSameTeamOpponentToOtherTeam player (Ball & Chain) can legally target its OWN team, and that player
  // is the ACTOR. We derive the flip from that same-team IMPLICATION, not a skill-string gate.
  // ⚠ #58 §7.2 / ML-12 CORRECTION (2026-07-22): the earlier note here claimed "the wire strips the 'ballandchain'
  // skill string so the old skill gate never fired (preview{1}≠server{2})" — that is FALSE. Echo's corpus carries
  // "Ball and Chain" VERBATIM on the wire (gbot-186.jsonl skillArray, NOT stripped) and both normalizers
  // (blocks.ts:39 skillIs / availableActions.ts) match it. The fix is correct — but on the implication +
  // ServerUtilPlayer grounds below, NEVER a wire-stripping premise (a false reason had propagated into a stage-2).
  // Mirrors ServerUtilPlayer.findBlockStrength `flipOpponentIfSameTeam && sameTeam` where the check is
  // on the CALL's attacker: upstream flips only in the B&C's own strength call (=the actor's), NOT the target's —
  // so `sameTeam && isActor`, not `sameTeam` alone (which would wrongly flip the swapped defender-strength call).
  const flip = sameTeam && isActor;
  const markerIsHome = flip ? !defender.isHome : defender.isHome;
  // #2 preconditions (per upstream): allowsCancellingGuard(turnMode) == (turnMode !== BLITZ), and the attacker
  // is on the ACTING team (homePlaying). A per-candidate Defensive marker then cancels that assist's Guard.
  const cancelGuardMode = String(game.turnMode ?? '') !== 'blitz';
  const attackerActing = attacker.isHome === !!game.homePlaying;
  // #1 STRENGTH SOURCE (2026-07-14, Echo drift-guard + Fives): the server computes block strength from the ACTOR's
  // CURRENT strength (getStrengthWithModifiers = base + TEMPORARY ST modifiers), carried on `actingPlayer.strength`;
  // the roster `player.strength` is base + lasting-injury only. Use actingPlayer.strength for the acting attacker
  // (24 corpus frames diverged: brawler ST4→6, uphill-attacker ST4→1, bonehead-fail ST5→1 — exactly the dramatic
  // cases the preview lied about). The swapped call (defender-as-attacker) keeps roster (target temp-ST has no wire).
  const actorST = (game.actingPlayer as { strength?: number } | undefined)?.strength;
  let strength = (isActor && typeof actorST === 'number') ? actorST : attacker.player.strength;
  // BB2025 Cheering Fans grants the acting team one offensive assist on its first block.
  // The server mirrors the still-live value on TurnData and consumes it after that roll.
  if (attacker.isHome === !!game.homePlaying) {
    const turnData = attacker.isHome ? game.turnDataHome : game.turnDataAway;
    strength += Math.max(0, Number((turnData as { cheeringFansBlockAssist?: number } | undefined)?.cheeringFansBlockAssist ?? 0));
  }
  // #11 HORNS (2026-07-14, owner): +1 ST when the ACTOR blitzes — cited vs bb2025 RollMechanic.getTotalAttacker-
  // Strength: `addStrengthOnBlitz` skill property + actingPlayer.playerAction ∈ {BLITZ, BLITZ_MOVE}, added BEFORE
  // the assist loop. Client playerAction for a blitz is `blitz`/`blitzMove` → match on the `blitz` substring.
  const playerAction = String((game.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? '').toLowerCase();
  if (isActor && playerAction.includes('blitz') && hasHorns(attacker.player)) strength++;
  for (const candidate of all) {
    if (candidate.player.playerId === attacker.player.playerId) continue;
    if (candidate.isHome !== attacker.isHome) continue; // offensive assist = attacker's team
    if (!adjacent(candidate.square, defender.square)) continue;
    if (!hasTackleZones(candidate.state)) continue;
    if (isEyeGouged(candidate.state)) continue; // #1: an eye-gouged assist provides no assist
    // marker-team players adjacent to this candidate, with tackle zones
    const adjMarkers = all.filter(
      (m) => m.isHome === markerIsHome && adjacent(m.square, candidate.square) && hasTackleZones(m.state),
    );
    // markers that would negate the assist = all such EXCEPT the blocked defender (upstream: != defender)
    const markers = adjMarkers.filter((m) => m.player.playerId !== defender.player.playerId).length;
    // #2: a Defensive marker (INCLUDING the defender, per upstream) cancels this assist's Guard.
    const guardIsCanceled = cancelGuardMode && attackerActing && adjMarkers.some((m) => hasDefensive(m.player));
    if (markers === 0 || (hasGuard(candidate.player) && !guardIsCanceled)) strength++;
  }
  return strength;
}

/**
 * Dice for attacker blocking defender. `attackerSquareOverride` supports
 * Blitz previews (assists computed from the planned position). Returns null
 * when either player is missing/off pitch.
 */
export function blockDicePreview(
  game: GameJson,
  attackerId: string,
  defenderId: string,
  attackerSquareOverride?: Square,
): BlockPreview | null {
  const homeIds = new Set(game.teamHome.playerArray.map((p) => p.playerId));
  const byId = new Map<string, PlayerJson>();
  for (const p of [...game.teamHome.playerArray, ...game.teamAway.playerArray]) byId.set(p.playerId, p);

  const all: Placed[] = [];
  for (const data of game.fieldModel.playerDataArray) {
    const coordinate = data.playerCoordinate;
    if (!coordinate) continue;
    const player = byId.get(data.playerId);
    if (!player) continue;
    const square: Square =
      data.playerId === attackerId && attackerSquareOverride ? attackerSquareOverride : [coordinate[0], coordinate[1]];
    all.push({ player, square, state: data.playerState, isHome: homeIds.has(data.playerId) });
  }
  const attacker = all.find((p) => p.player.playerId === attackerId);
  const defender = all.find((p) => p.player.playerId === defenderId);
  if (!attacker || !defender) return null;

  const attackerStrength = assistedStrength(game, all, attacker, defender);
  const defenderStrength = assistedStrength(game, all, defender, attacker);

  // ServerUtilBlock.findNrOfBlockDice: strict inequalities (C1)
  let dice = 1;
  let opponentChoice = false;
  if (attackerStrength > defenderStrength) dice = 2;
  if (attackerStrength > 2 * defenderStrength) dice = 3;
  if (attackerStrength < defenderStrength) {
    dice = 2;
    opponentChoice = true;
  }
  if (attackerStrength * 2 < defenderStrength) {
    dice = 3;
    opponentChoice = true;
  }
  return { dice, opponentChoice, attackerStrength, defenderStrength };
}
