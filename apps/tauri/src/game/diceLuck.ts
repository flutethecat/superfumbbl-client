// Owner 10-09: the Dice pane's "Likelihood" rows measure OUTCOMES against their fair chance, not raw faces.
// "Armour dice should be the expected breaks vs the actual breaks ... an 8 should occur 46% of the time on a 2d6,
// but a 10+ should occur ~16.6% of the time. If a player rolled all 8's on 40 dice rolls but never broke a 10 then
// we'd want to reflect that as being a negative result." Action dice and block dice "the same".
//
// Model: every measured roll is a TRIAL with a score and a known fair distribution of that score. A row's marker is
// "1 in N" is the EXACT one-tailed chance of a total at least this far from expected, found by convolving the
// per-trial distributions; the marker is placed from that same chance, so the two can never disagree.
//
// What the odds are (Astra F1): fair dice on THE ROLLS THAT WERE MADE. Which rolls get made depends on earlier results
// (a failed roll may be rerolled, a broken armour brings an injury roll), so this is a reference for the recorded
// rolls held fixed - not the chance of a whole game going this way. The copy never says "games".
//
// Scores live on a lattice of SIXTHS (an integer `s6` = score x 6) so the convolution stays exact: a break / a passed
// roll is 6, a block roll is -6 / 0 / +6, and a knock-out is 1..3 (see koWeight6).
//
// This file is pure maths + the rules mirrors (no game model, no Vue). diceStats.ts feeds it from the report stream.

/** One row's trials for one tally (a team or a player). JSON-plain: it rides the cached end-of-game snapshot. */
export interface LuckBucket {
  /** Measured trials. */
  n: number;
  /** Sum of the observed scores, in sixths. */
  x6: number;
  /** Rolls that were seen but could not be measured soundly (see the UNMEASURED notes in diceStats.ts). */
  unmeasured: number;
  /** Fair-distribution key (see distKey) -> how many measured trials had that distribution. */
  kinds: Record<string, number>;
  /** Plain counters for the display line ("7 broken of 14, 5.8 expected"). */
  c: Record<string, number>;
}
export type LuckRow = 'armour' | 'injury' | 'action' | 'block';
export interface DiceLuck { armour: LuckBucket; injury: LuckBucket; action: LuckBucket; block: LuckBucket }
export const LUCK_ROWS: readonly LuckRow[] = ['armour', 'injury', 'action', 'block'];

export function emptyBucket(): LuckBucket { return { n: 0, x6: 0, unmeasured: 0, kinds: {}, c: {} }; }
export function emptyLuck(): DiceLuck { return { armour: emptyBucket(), injury: emptyBucket(), action: emptyBucket(), block: emptyBucket() }; }

// ---- distributions ----

/** A fair distribution as a compact key: `<denominator>|<s6>:<count>,...` (zero counts dropped, scores ascending). */
export function distKey(den: number, points: readonly (readonly [number, number])[]): string {
  const merged = new Map<number, number>();
  for (const [s6, count] of points) if (count > 0) merged.set(s6, (merged.get(s6) ?? 0) + count);
  return `${den}|${[...merged.entries()].sort((a, b) => a[0] - b[0]).map(([s6, count]) => `${s6}:${count}`).join(',')}`;
}
/** A pass / fail trial: score 6 with chance num/den, else 0. */
export function binaryKey(num: number, den: number): string { return distKey(den, [[0, den - num], [6, num]]); }

export interface Dist { points: { s6: number; p: number }[]; mean6: number; var36: number; min6: number }
const DIST_CACHE = new Map<string, Dist>();
export function parseDist(key: string): Dist {
  const hit = DIST_CACHE.get(key);
  if (hit) return hit;
  const bar = key.indexOf('|');
  const den = Number(key.slice(0, bar));
  const points = key.slice(bar + 1).split(',').filter(Boolean).map((part) => {
    const [s6, count] = part.split(':');
    return { s6: Number(s6), p: Number(count) / den };
  });
  const mean6 = points.reduce((a, pt) => a + pt.s6 * pt.p, 0);
  const var36 = points.reduce((a, pt) => a + (pt.s6 - mean6) * (pt.s6 - mean6) * pt.p, 0);
  const min6 = points.length ? Math.min(...points.map((pt) => pt.s6)) : 0;
  const dist = { points, mean6, var36, min6 };
  DIST_CACHE.set(key, dist);
  return dist;
}

export function addTrial(bucket: LuckBucket, key: string, x6: number): void {
  bucket.n += 1;
  bucket.x6 += x6;
  bucket.kinds[key] = (bucket.kinds[key] ?? 0) + 1;
}
export function addCount(bucket: LuckBucket, name: string, value: number): void {
  bucket.c[name] = (bucket.c[name] ?? 0) + value;
}

// ---- the 2D6 ----

/** How many of the 36 fair 2D6 outcomes total at least `threshold`. */
export function twoD6AtLeast(threshold: number): number {
  let n = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b >= threshold) n += 1;
  return n;
}

// ---- armour ----
//
// Upstream (fumbbl40k-server, BB2025):
//   mechanics/mixed/StatsMechanic.java:24-26   broken = reduceArmour(AV, 8) <= roll + armour modifier total
//   mechanics/StatsMechanic.java:30-37         reduceArmour: Claws in the modifier list and AV > 8 -> 8
//   server/DiceInterpreter.java:214-224        AV = defender.getArmourWithModifiers()
// The report lists the modifiers that were in the context when the roll was judged. Several are added ONLY when the
// roll has not already broken armour, so a break with a short list says nothing about what else was available:
//   InjuryTypeBlock.java:85-135   Claws, then Mighty Blow, are tried only after the unmodified roll fails
//   InjuryTypeFoul.java           assists / Foul bonus / Chainsaw always; Dirty Player then A Sneaky Pair only on a fail
//   InjuryTypeStab.java           A Sneaky Pair only on a fail
//   InjuryTypeDropDodge.java, InjuryTypeDropJump.java   Arm Bar only on a fail
//   InjuryTypeFireball.java:35-40, InjuryTypeLightning.java:36-41   the +1 only on a fail
// Each of those is an "armour OR injury" modifier: when armour broke without it, the server applies it to the
// INJURY roll instead (MightyBlow.java:19-33, DirtyPlayer.java:15-23, ASneakyPair.java:16-25, the Arm Bar hand-over in
// InjuryTypeDropDodge, InjuryTypeFireball.java:50-54) - so on a break the injury modifier list states what was still
// in hand. Claws is the one armour-only conditional: it is derived from the attacker's skills (Claws.java:9-17).

/** Modifiers the server moves to the injury roll when armour broke without them, per injury type. */
const EITHER_BY_TYPE: Record<string, readonly string[]> = {
  block: ['Mighty Blow'], foul: ['Dirty Player', 'A Sneaky Pair'], stab: ['A Sneaky Pair'],
  dropDodge: ['Arm Bar'], dropLeap: ['Arm Bar'], fireball: ['Fireball'], lightning: ['Lightning'],
  // a thrown player landing on an opponent: InjuryTypeTTMHitPlayerForSpp.java:33-58 (armour only on a fail, else injury)
  ttmHitPlayer: ['Lethal Flight'],
};
/** "blockForSpp", "foulForSppWithChainsaw" ... -> the family the rules above are written for. */
export function injuryTypeFamily(injuryType: string): string {
  return injuryType.replace(/ForSpp/, '').replace(/WithChainsaw$/, '');
}

/** The value of a stated armour modifier; null = one this client cannot value soundly (the roll goes unmeasured).
 *  factory/bb2025/ArmorModifiers.java:23-47 (assists, Foul, Fireball, Lightning); skill/bb2025/Chainsaw.java:16 (+3),
 *  DirtyPlayer.java:9 (+1), LethalFlight.java:9 (+1), MightyBlow.java:9 (the skill's value), special/ASneakyPair.java:8
 *  (+1); skill/mixed/ArmBar.java:11 (+1), Claws.java:9 (0, sets AV 8), IronHardSkin.java:12 (0).
 *  Deliberately NOT valued: Ram, Slayer, Crushing Blow, Dwarven Scourge - once-per-game choices made after seeing
 *  the roll, so a roll that lists one is not a fair-dice outcome. */
export function armourModifierValue(name: string, mightyBlow: number): number | null {
  const assist = /^(\d) (Offensive|Defensive) Assists?$/.exec(name);
  if (assist) return assist[2] === 'Offensive' ? Number(assist[1]) : -Number(assist[1]);
  switch (name) {
    case 'Foul': case 'Fireball': case 'Lightning': case 'Dirty Player': case 'Lethal Flight': case 'A Sneaky Pair': case 'Arm Bar': return 1;
    case 'Chainsaw': return 3;
    case 'Mighty Blow': return mightyBlow;
    case 'Claws': case 'Iron Hard Skin': return 0;
    default: return null;
  }
}

export interface ArmourRollInput {
  /** The defender's armour value with temporary modifiers, from the game model at that frame. */
  av: number;
  /** The two armour dice added up. */
  total: number;
  /** The server's stated result. */
  broken: boolean;
  injuryType: string;
  armourModifiers: readonly string[];
  injuryModifiers: readonly string[];
  /** An injury roll is in the same report (it is whenever armour broke). */
  hasInjuryRoll: boolean;
  /** The attacker's Mighty Blow value (1 unless the skill carries another). */
  mightyBlow: number;
  attackerHasClaws: boolean;
  /** The attacker or the defender carries Chainsaw. */
  chainsawInvolved: boolean;
  defenderHasIronHardSkin: boolean;
  /** Attacker and defender are on the same team (or there is no attacker). */
  sameTeam: boolean;
  /** Game option `clawDoesNotStack` (factory/GameOptionFactory.java:84-86, default true). */
  clawDoesNotStack: boolean;
  /** Game option `mbStacksAgainstChainsaw` (factory/GameOptionFactory.java:394-397, default false). */
  mbStacksAgainstChainsaw?: boolean;
}

/**
 * The lowest 2D6 total that would have broken this armour, with everything the attacker had in hand - or null when
 * it cannot be worked out soundly (UNMEASURED). The stated result is always cross-checked against the server's own
 * test on the stated modifiers first: a disagreement means this client's armour value or a modifier value is wrong
 * for that roll, and the roll is not used.
 */
export function armourBreakThreshold(i: ArmourRollInput): number | null {
  // With `mbStacksAgainstChainsaw` a block's Chainsaw +3 is tried only after the unmodified roll fails
  // (InjuryTypeBlock.java:72-89, :128-133) and is not handed to the injury roll: a break states nothing, a miss states
  // it. Leaving out only the breaks would bias the row, so EVERY such roll is unmeasured, whatever its result.
  if (i.mbStacksAgainstChainsaw && i.chainsawInvolved && injuryTypeFamily(i.injuryType) === 'block') return null;
  let listed = 0;
  for (const name of i.armourModifiers) {
    const value = armourModifierValue(name, i.mightyBlow);
    if (value == null) return null;
    listed += value;
  }
  const clawsListed = i.armourModifiers.includes('Claws');
  const judgedAgainst = clawsListed && i.av > 8 ? 8 : i.av;
  if ((i.total + listed >= judgedAgainst) !== i.broken) return null; // the cross-check
  // Not broken: every conditional modifier was tried and is listed, so the stated list is the whole story.
  if (!i.broken) return judgedAgainst - listed;
  // Broken: what else was in hand?
  if (!i.hasInjuryRoll) return null; // nowhere to read the left-over armour-or-injury modifiers from
  const family = injuryTypeFamily(i.injuryType);
  // a block on a team-mate runs in a mode this client cannot see (InjuryTypeBlock.Mode): modifiers may be off
  if (family === 'block' && i.sameTeam && (i.attackerHasClaws || i.chainsawInvolved || i.injuryModifiers.includes('Mighty Blow'))) return null;
  // a Chainsaw in play that the server did not state (it always states it unless Iron Hard Skin ignores it)
  if (family === 'block' && i.chainsawInvolved && !i.armourModifiers.includes('Chainsaw') && !i.defenderHasIronHardSkin) return null;
  let others = listed;
  // Iron Hard Skin (Astra N2): the defender ignores armour modifiers from skills, so nothing is handed to the armour
  // roll - the modifier still lands on the injury roll, which is all its presence there says. Every handoff has the
  // exception upstream: ArmorModifierFactory.findArmorModifiers:46-48 (block, foul, stab), specialEffectArmourModifiers
  // :65-67 (spells), InjuryTypeDropDodge.java:80, InjuryTypeDropJump.java:74, InjuryTypeTTMHitPlayerForSpp.java:45-46.
  for (const name of i.defenderHasIronHardSkin ? [] : EITHER_BY_TYPE[family] ?? []) {
    if (i.armourModifiers.includes(name) || !i.injuryModifiers.includes(name)) continue;
    const value = armourModifierValue(name, i.mightyBlow);
    if (value == null) return null;
    others += value;
  }
  const claws = clawsListed
    || (family === 'block' && i.attackerHasClaws && !i.chainsawInvolved && !i.defenderHasIronHardSkin && !i.sameTeam);
  // InjuryTypeBlock.java:106-127: Claws alone first; then, stacking, Claws + the rest; not stacking, the rest alone
  const threshold = claws && i.av > 8 ? (i.clawDoesNotStack ? Math.min(8, i.av - others) : 8 - others) : i.av - others;
  return i.total >= threshold ? threshold : null;
}

// ---- injury ----
//
// Owner 10-09: "Thick Skull and Stunty can just be treated as modifiers to the dice roll. If the player has stunty
// and a 8 is rolled, we can just treat 8's as neutral. Stunty just moves the bad result one step down on the casualty
// table."
// Owner 10-09 (second ruling): "Thick Skull is only one step harder for KO rolls but if we treat a "removal" as equal
// value between KO and casualty then we're good. When calculating the "luckiness" of an injury roll, we'd need to
// account for the difference between a KO and a casualty. For that, we could weight KO rolls as .5 of a casualty
// (unless the user has blitzer's best kegs or Joseph Bugman)"
//
// So an injury trial scores THREE levels - stunned 0, knocked out w, casualty 1 - against the real BB2025 table for
// that victim (server/mechanic/bb2025/RollMechanic.java:104-147, total = dice + injury modifier total):
//   standard            2-7 stunned   8-9 knocked out   10+ casualty
//   Thick Skull         2-8 stunned   9   knocked out   10+ casualty     (:130-133, only the KO boundary moves)
//   Stunty              2-6 stunned   7-8 knocked out   9+  casualty     (:122-129, :134-135 - a 9 is Badly Hurt)
//   Stunty + Thick Skull 2-7 stunned  8   knocked out   9+  casualty     (:123-126)
// Stunty is read from the stated injury modifiers, exactly as the server does (:117-118); Thick Skull from the
// victim's skills (:120) - its modifier is only stated when it converted the roll.

export type InjuryLevel = 0 | 1 | 2; // stunned, knocked out, casualty

export function injuryLevelFor(total: number, stunty: boolean, thickSkull: boolean): InjuryLevel {
  if (total === 7 && stunty) return thickSkull ? 0 : 1;
  if (total === 8 && thickSkull && !stunty) return 0;
  if (total === 9 && stunty) return 2;
  if (total > 9) return 2;
  if (total > 7) return 1;
  return 0;
}

/** The value of a stated injury modifier; null = not valued (the roll goes unmeasured).
 *  factory/bb2025/InjuryModifiers.java:85-86 (Fireball, Lightning +1); skill/mixed/Stunty.java:9 and
 *  skill/common/ThickSkull.java:10 (0 - they change the table, above); MightyBlow.java:19 (the skill's value);
 *  DirtyPlayer.java:15, LethalFlight.java:18, special/ASneakyPair.java:16, mixed/ArmBar.java:17 (+1).
 *  Not valued: Ram, Slayer, Toxin Connoisseur, Dwarven Scourge (once-per-game choices made after the roll). */
export function injuryModifierValue(name: string, mightyBlow: number): number | null {
  switch (name) {
    case 'Stunty': case 'Thick Skull': return 0;
    case 'Mighty Blow': return mightyBlow;
    case 'Dirty Player': case 'Lethal Flight': case 'A Sneaky Pair': case 'Arm Bar': case 'Fireball': case 'Lightning': return 1;
    default: return null;
  }
}

export interface InjuryRollInput {
  dice: readonly [number, number];
  modifiers: readonly string[];
  /** The victim has Thick Skull. */
  thickSkull: boolean;
  mightyBlow: number;
  /** The server's stated result: the PlayerState base (4 stunned, 5 knocked out, 6 / 7 / 8 casualty). */
  statedState: number;
}
export interface InjuryTrial { level: InjuryLevel; /** of the 36 fair outcomes: [stunned, knocked out, casualty] */ counts: [number, number, number] }

/** The injury roll as a three-level trial, or null when it cannot be measured (an unvalued modifier, or the stated
 *  result disagrees with this table for that roll). */
export function injuryTrial(i: InjuryRollInput): InjuryTrial | null {
  let shift = 0;
  for (const name of i.modifiers) {
    const value = injuryModifierValue(name, i.mightyBlow);
    if (value == null) return null;
    shift += value;
  }
  const stunty = i.modifiers.includes('Stunty');
  const stated: InjuryLevel | null = i.statedState === 4 ? 0 : i.statedState === 5 ? 1 : i.statedState >= 6 && i.statedState <= 8 ? 2 : null;
  const level = injuryLevelFor(i.dice[0] + i.dice[1] + shift, stunty, i.thickSkull);
  if (stated == null || stated !== level) return null; // the cross-check
  const counts: [number, number, number] = [0, 0, 0];
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) counts[injuryLevelFor(a + b + shift, stunty, i.thickSkull)] += 1;
  return { level, counts };
}

/**
 * What a knock-out is worth next to a casualty, in sixths: the chance the player FAILS the KO recovery roll for the
 * victim's team (orchestrator's reading of the owner's ".5 of a casualty (unless the user has blitzer's best kegs or
 * Joseph Bugman)"). server/DiceInterpreter.java:123-125: recovers when roll > 1 and roll + modifier > 3;
 * step/bb2025/StepEndTurn.java:752-756: modifier = the team's Bloodweiser Kegs + Bugman's XXXXXX.
 * No kegs 3/6, one 2/6, two or more 1/6 (a 1 always fails).
 */
export function koWeight6(recoveryModifier: number): number {
  const need = Math.max(2, 4 - Math.max(0, Math.floor(recoveryModifier) || 0));
  return need - 1;
}

/** The injury trial's distribution key. `victimOwn` inverts the score (x' = 1 - x): an injury to your own player. */
export function injuryKey(counts: readonly [number, number, number], ko6: number, victimOwn: boolean): string {
  return victimOwn ? distKey(36, [[6, counts[0]], [6 - ko6, counts[1]], [0, counts[2]]]) : distKey(36, [[0, counts[0]], [ko6, counts[1]], [6, counts[2]]]);
}
export function injuryScore6(level: InjuryLevel, ko6: number, victimOwn: boolean): number {
  const s6 = level === 2 ? 6 : level === 1 ? ko6 : 0;
  return victimOwn ? 6 - s6 : s6;
}

// ---- action dice ----

/** A D6 against a stated minimum. server/DiceInterpreter.java:99-101: a 6 always passes, a 1 always fails, so the
 *  fair chance is (7 - target) / 6 with the target held to 2..6 (a stated 7+ still passes on a 6: 1/6).
 *  null = the stated result disagrees with that rule for this roll (UNMEASURED). */
export function actionTrial(minimumRoll: number, face: number, successful: boolean): { key: string; x6: number; p: number } | null {
  const target = Math.min(6, Math.max(2, Math.round(minimumRoll)));
  if ((face >= target) !== successful) return null;
  return { key: binaryKey(7 - target, 6), x6: successful ? 6 : 0, p: (7 - target) / 6 };
}

// ---- block dice ----

/** Astra N1: the DEFENDER's Block and Wrestle count only while the defender has tackle zones - pass them already
 *  gated (see defenderHasTacklezones in diceStats.ts). Block: step/mixed/block/StepBothDown.java:73; Wrestle:
 *  WrestleBehaviour.java:105. The attacker's Block (:78), Wrestle (:126), Tackle and the defender's Dodge
 *  (step/bb2025/block/StepBlockChoice.java:175-188) carry no such condition upstream. */
export interface BlockMatchup {
  attackerBlock: boolean; attackerWrestle: boolean; attackerTackle: boolean; defenderBlock: boolean; defenderDodge: boolean;
  /** The attacker has Juggernaut AND this block is part of a Blitz (skillbehaviour/bb2025/JuggernautBehaviour.java:45-55):
   *  the coach may turn Both Down into a push - so a push is AVAILABLE, and Both Down is never worse than neutral. */
  attackerJuggernautBlitz?: boolean;
  /** Owner 10-09: the defender has Wrestle. On Both Down the attacker is asked first, then the DEFENDER may answer
   *  with Wrestle (skillbehaviour/bb2025/WrestleBehaviour.java:51-58, :102-121): both go prone, no armour roll, no
   *  turnover. So where Both Down would have been a knock-down (attacker Block, defender no Block) it is only NEUTRAL -
   *  the knock-down is the defender's to refuse. Where it is bad for the attacker (no Block, no Wrestle) it stays bad:
   *  using Wrestle is the defender's choice, and the attacker can count only on the defender not using it.
   *  Juggernaut on a Blitz cancels the defender's Wrestle (:107), so the knock-down stands there. */
  defenderWrestle?: boolean;
}
/**
 * What each block-die face (index 1..6: attacker down, both down, push, push, stumble, pow) is worth to the ATTACKING
 * team in this match-up: +1 the defender goes down, 0 nothing falls, -1 the attacker goes down.
 */
export function blockFaceScores(m: BlockMatchup): number[] {
  const wrestledOff = !!m.defenderWrestle && !m.attackerJuggernautBlitz;
  const plain = m.attackerBlock ? (m.defenderBlock || wrestledOff ? 0 : 1) : m.attackerWrestle ? 0 : -1;
  const bothDown = m.attackerJuggernautBlitz ? Math.max(0, plain) : plain;
  const stumble = m.defenderDodge && !m.attackerTackle ? 0 : 1;
  return [0, -1, bothDown, 0, 0, stumble, 1];
}
/** The roll's score: what the dice made AVAILABLE - the best face when the attacker picks, the worst when the defender does. */
export function blockRollScore(faces: readonly number[], attackerChooses: boolean, scores: readonly number[]): number {
  const values = faces.map((f) => scores[f] ?? 0);
  return attackerChooses ? Math.max(...values) : Math.min(...values);
}
/** The fair distribution of that score for `dice` dice (exact: counts out of 6^dice). */
export function blockRollKey(dice: number, attackerChooses: boolean, scores: readonly number[]): string {
  let good = 0, bad = 0;
  for (let f = 1; f <= 6; f++) { if ((scores[f] ?? 0) > 0) good += 1; else if ((scores[f] ?? 0) < 0) bad += 1; }
  const all = 6 ** dice;
  if (attackerChooses) {
    const noGood = (6 - good) ** dice; const allBad = bad ** dice;
    return distKey(all, [[-6, allBad], [0, noGood - allBad], [6, all - noGood]]);
  }
  const noBad = (6 - bad) ** dice; const allGood = good ** dice;
  return distKey(all, [[-6, all - noBad], [0, noBad - allGood], [6, allGood]]);
}

// ---- the row ----

/** Standard normal CDF (Abramowitz-Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2; // erf argument
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return 0.5 * (1 + (z < 0 ? -erf : erf));
}

/** Inverse of the standard normal CDF (Acklam's rational approximation, relative error < 1.2e-9). */
export function normalInv(p: number): number {
  if (!(p > 0)) return -Infinity;
  if (!(p < 1)) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - low) return -normalInv(1 - p);
  const q = p - 0.5; const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Above this many trials THAT CAN GO EITHER WAY the exact convolution gives way to the normal tail (it is accurate
 *  there, and cheap). Certain trials (a 2+ armour, a result with one possible score) carry no spread: they never
 *  count towards the switch and never enter the convolution (Astra F8). */
export const LUCK_EXACT_MAX_TRIALS = 2000;

function gcd(a: number, b: number): number { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }

export interface LuckTail {
  n: number; mean6: number; var36: number;
  /** +1 the total is above its fair mean, -1 below, 0 exactly on it (or nothing could have gone another way). */
  direction: -1 | 0 | 1;
  /** The inclusive one-tailed chance in that direction, UNCLIPPED; 1 when direction is 0. */
  tail: number;
  exact: boolean;
}
/**
 * The one-tailed chance of a total at least as far from expected as `x6`, in the observed direction: P(X >= x) when
 * the total is above its fair mean, P(X <= x) when below - the observed total INCLUDED, and NOT clipped (Astra F2):
 * with few trials an everyday result's inclusive tail passes one half (one passed 2+ roll: 5/6). A row whose tail is
 * one half or more is simply "about average" (see likelihoodOf) - no "1 in N" is claimed for it.
 */
export function luckTail(kinds: Record<string, number>, x6: number): LuckTail {
  const entries = Object.entries(kinds).filter(([, count]) => count > 0).map(([key, count]) => ({ dist: parseDist(key), count }));
  let n = 0, mean6 = 0, var36 = 0;
  for (const e of entries) { n += e.count; mean6 += e.count * e.dist.mean6; var36 += e.count * e.dist.var36; }
  const dev = x6 - mean6;
  if (n === 0 || Math.abs(dev) < 1e-9 || var36 < 1e-12) return { n, mean6, var36, direction: 0, tail: 1, exact: true };
  const direction = dev > 0 ? 1 : -1;
  // only the trials that could have gone another way spread the total; the certain ones just move it
  const open = entries.filter((e) => e.dist.var36 > 1e-12);
  let openTrials = 0, fixed6 = 0;
  for (const e of entries) { if (e.dist.var36 > 1e-12) openTrials += e.count; else fixed6 += e.count * e.dist.mean6; }
  if (openTrials > LUCK_EXACT_MAX_TRIALS) return { n, mean6, var36, direction, tail: 1 - normalCdf(Math.abs(dev) / Math.sqrt(var36)), exact: false };
  // one shared lattice: every score minus its distribution's lowest, in units of their common divisor
  let step = 0, offset = fixed6;
  for (const e of open) { offset += e.count * e.dist.min6; for (const pt of e.dist.points) step = gcd(step, pt.s6 - e.dist.min6); }
  let dp = new Float64Array([1]);
  for (const e of open) {
    const pts = e.dist.points.map((pt) => ({ at: Math.round((pt.s6 - e.dist.min6) / step), p: pt.p }));
    const span = Math.max(...pts.map((pt) => pt.at));
    for (let k = 0; k < e.count; k++) {
      const next = new Float64Array(dp.length + span);
      for (let i = 0; i < dp.length; i++) { const v = dp[i]!; if (v !== 0) for (const pt of pts) next[i + pt.at]! += v * pt.p; }
      dp = next;
    }
  }
  const at = Math.round((x6 - offset) / step);
  let tail = 0;
  if (dev > 0) { for (let i = Math.max(0, at); i < dp.length; i++) tail += dp[i]!; }
  else { for (let i = Math.min(dp.length - 1, at); i >= 0; i--) tail += dp[i]!; }
  return { n, mean6, var36, direction, tail: Math.min(1, tail), exact: true };
}

/** The odds never read rarer than this. */
export const LUCK_ODDS_CAP = 1_000_000;

/** One "Likelihood" row. `measured` false = the tally carries no trial data (cached before owner 10-09). */
export interface Likelihood {
  measured: boolean;
  /** Measured trials. */
  n: number;
  unmeasured: number;
  /** Observed and fair-expected score totals (in whole scores, not sixths). */
  score: number;
  expected: number;
  /** Standard score of the total (kept for reference and tests; the pane does not place anything from it). */
  z: number;
  /** Inclusive one-tailed chance of a total at least this far from expected, unclipped (see luckTail). */
  tail: number;
  /** The tail is one half or more (or the total sits on its mean): nothing unusual, no "1 in N". */
  average: boolean;
  /** Where the marker sits on the curve: the standard-normal point whose tail IS `tail`, signed by direction
   *  (0 when average). The "1 in N" and the marker come from the one number, so they cannot disagree. */
  zShown: number;
}
export const NOT_MEASURED: Likelihood = { measured: false, n: 0, unmeasured: 0, score: 0, expected: 0, z: 0, tail: 1, average: true, zShown: 0 };

/** A row over one or more buckets (the "All dice" row sums the four: deviations and variances add). */
export function likelihoodOf(buckets: readonly (LuckBucket | undefined)[]): Likelihood {
  if (buckets.some((b) => !b)) return NOT_MEASURED;
  const kinds: Record<string, number> = {};
  let x6 = 0, unmeasured = 0;
  for (const b of buckets as LuckBucket[]) {
    x6 += b.x6; unmeasured += b.unmeasured;
    for (const [key, count] of Object.entries(b.kinds)) kinds[key] = (kinds[key] ?? 0) + count;
  }
  const t = luckTail(kinds, x6);
  const z = t.var36 > 1e-12 ? (x6 - t.mean6) / Math.sqrt(t.var36) : 0;
  const average = t.direction === 0 || t.tail >= 0.5;
  const zShown = average ? 0 : t.direction * -normalInv(Math.max(t.tail, 1 / LUCK_ODDS_CAP));
  return { measured: true, n: t.n, unmeasured, score: x6 / 6, expected: t.mean6 / 6, z, tail: t.tail, average, zShown };
}

/** The row's "1 in N": how often fair dice do at least this well (or this badly) ON THE ROLLS THAT WERE MADE.
 *  null = about average (no rarity to state). Capped at 1 in 1,000,000. */
export function oneInOdds(like: Likelihood): { n: number; capped: boolean } | null {
  if (!like.measured || like.n === 0 || like.average) return null;
  if (like.tail <= 1 / LUCK_ODDS_CAP) return { n: LUCK_ODDS_CAP, capped: true };
  return { n: Math.max(2, Math.round(1 / like.tail)), capped: false };
}
