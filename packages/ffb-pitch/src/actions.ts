import type { GameJson, PlayerJson } from '@fumbbl40k/ffb-protocol';
import { effectiveArmour, normalizeSkillName, playerSkillNames } from '@fumbbl40k/ffb-protocol';
import { hasTackleZones, isDown } from './playerState';
import type { Square } from './movement';
import { PASS_MODIFIERS, passRange } from './passing';

/**
 * Owner 2026-07-04c: FOUL / HAND-OFF / PASS roll previews + AURA-skill helpers,
 * client-side mirrors of the rules in `docs/passing-fouling-auras.md`. The
 * SERVER stays authoritative for every resolution — these only render the
 * expected targets when the wire doesn't present them.
 *
 * Stat semantics (BB2020+ wire): `agility`/`passing` are TARGET numbers
 * ("3" = 3+); `armour` is the 2d6 armour value ("9" = broken on 10+ in BB2020
 * terms — FFB serializes the TARGET, a roll STRICTLY GREATER breaks in the
 * older editions; we render "n+" as armour+1-assists, see foulTarget).
 */

interface Placed {
  player: PlayerJson;
  square: Square;
  state: number;
  isHome: boolean;
}

function placedPlayers(game: GameJson): Placed[] {
  const out: Placed[] = [];
  const homeIds = new Set(game.teamHome.playerArray.map((p) => p.playerId));
  const byId = new Map<string, PlayerJson>();
  for (const p of game.teamHome.playerArray) byId.set(p.playerId, p);
  for (const p of game.teamAway.playerArray) byId.set(p.playerId, p);
  for (const d of game.fieldModel.playerDataArray) {
    const c = d.playerCoordinate;
    if (!c || c[0] < 0 || c[0] > 25 || c[1] < 0 || c[1] > 14) continue;
    const player = byId.get(d.playerId);
    if (!player) continue;
    out.push({ player, square: [c[0], c[1]], state: d.playerState, isHome: homeIds.has(d.playerId) });
  }
  return out;
}

function adjacent(a: Square, b: Square): boolean {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) === 1;
}

/** ALL of a player's skills — the wire `skillArray` (baseline + learned) UNIONED with every temporary grant
 *  (`temporarySkillsMap`: prayers, Intensive Training, cards, Wisdom), through the shared protocol decoder.
 *  Upstream rules checks read `Player.getSkillsIncludingTemporaryOnes()` (Player.java:328-330). */
export function skillsOf(player: PlayerJson): Set<string> {
  return new Set(playerSkillNames(player));
}

function findPlayer(game: GameJson, playerId: string): PlayerJson | undefined {
  return (
    game.teamHome.playerArray.find((p) => p.playerId === playerId) ??
    game.teamAway.playerArray.find((p) => p.playerId === playerId)
  );
}

function isHomePlayer(game: GameJson, playerId: string): boolean {
  return game.teamHome.playerArray.some((p) => p.playerId === playerId);
}

/** Standing opponents of `side` whose tackle zone marks `square` (adjacent). */
export function markersOn(game: GameJson, square: Square, sideIsHome: boolean): number {
  let n = 0;
  for (const p of placedPlayers(game)) {
    if (p.isHome === sideIsHome) continue;
    if (!hasTackleZones(p.state)) continue;
    if (adjacent(p.square, square)) n++;
  }
  return n;
}

/** Aura radius (squares, Chebyshev) — owner: DP and Pick-Me-Up extend 3. */
export const AURA_RADIUS = 3;
/** The aura-emitting skills we render/compute (docs/passing-fouling-auras.md). The strings MUST match
 *  the server's skill NAME verbatim (player.skillArray) — #152 (owner 07-23): Pick-Me-Up auras were
 *  invisible because the constant read 'Pick-Me-Up' but the server names the skill 'Pick-me-up'
 *  (PickMeUp.java:12 super("Pick-me-up")), so `skillsOf(p).has('Pick-Me-Up')` never matched → zero
 *  emitters. Disturbing Presence matches verbatim (DisturbingPresence.java:22). Exact-string coupling. */
export const AURA_SKILLS = ['Disturbing Presence', 'Pick-me-up'] as const;

/** Number of OPPOSING Disturbing Presence auras covering `square` (they stack:
 *  -1 to pass/catch/intercept per layer). Prone/stunned emitters still count
 *  per the rulebook wording (no standing requirement in the skill text). */
export function disturbingPresenceLayers(game: GameJson, square: Square, sideIsHome: boolean): number {
  let layers = 0;
  for (const p of placedPlayers(game)) {
    if (p.isHome === sideIsHome) continue;
    if (!skillsOf(p.player).has('Disturbing Presence')) continue;
    if (Math.max(Math.abs(p.square[0] - square[0]), Math.abs(p.square[1] - square[1])) <= AURA_RADIUS) layers++;
  }
  return layers;
}

/** Every on-pitch player with an aura skill (for the renderer's aura shading). */
export function auraEmitters(game: GameJson): { playerId: string; square: Square; skill: string; isHome: boolean }[] {
  const out: { playerId: string; square: Square; skill: string; isHome: boolean }[] = [];
  for (const p of placedPlayers(game)) {
    const skills = skillsOf(p.player);
    for (const skill of AURA_SKILLS) {
      if (skills.has(skill)) out.push({ playerId: p.player.playerId, square: p.square, skill, isHome: p.isHome });
    }
  }
  return out;
}

/** FOUL armour target ("SKULL n+"): 2d6 vs the victim's armour, +1 per
 *  offensive assist, -1 per defensive assist (block-assist adjacency rules:
 *  a standing teammate marking the victim assists unless himself marked by
 *  another opponent; mirrored from the block preview conventions). */
export function foulTarget(game: GameJson, foulerId: string, defenderId: string, fromSquare?: Square): number | null {
  const placed = placedPlayers(game);
  const fouler = placed.find((p) => p.player.playerId === foulerId);
  const victim = placed.find((p) => p.player.playerId === defenderId);
  if (!fouler || !victim) return null;
  const foulerSquare = fromSquare ?? fouler.square;
  const assists = (marked: Placed, helpersHome: boolean, ignoreId: string) => {
    let n = 0;
    for (const h of placed) {
      if (h.isHome !== helpersHome) continue;
      if (h.player.playerId === ignoreId) continue;
      if (!hasTackleZones(h.state)) continue;
      if (!adjacent(h.square, marked.square)) continue;
      // an assister engaged by ANOTHER standing opponent can't help
      const engaged = placed.some(
        (e) =>
          e.isHome !== helpersHome &&
          e.player.playerId !== marked.player.playerId &&
          hasTackleZones(e.state) &&
          adjacent(e.square, h.square),
      );
      if (!engaged) n++;
    }
    return n;
  };
  const offensive = assists(victim, fouler.isHome, foulerId);
  const defensive = assists({ ...fouler, square: foulerSquare }, !fouler.isHome, defenderId);
  const armour = effectiveArmour(victim.player);
  // render the 2d6 roll that BREAKS armour: base target+1 (strictly-greater), shifted by net assists
  const target = armour + 1 - offensive + defensive;
  return Math.max(2, Math.min(12, target));
}

/** CATCH target at the receiver: AG, -1 per opponent marking the receiver,
 *  -1 per opposing Disturbing Presence layer on the receiver's square. */
export function catchTarget(game: GameJson, catcherId: string): number | null {
  const placed = placedPlayers(game);
  const catcher = placed.find((p) => p.player.playerId === catcherId);
  if (!catcher) return null;
  const ag = Number(catcher.player.agility ?? 4);
  const catcherSkills = new Set(playerSkillNames(catcher.player).map(normalizeSkillName));
  const mods =
    (catcherSkills.has(normalizeSkillName('Nerves of Steel')) ? 0 : markersOn(game, catcher.square, catcher.isHome)) +
    disturbingPresenceLayers(game, catcher.square, catcher.isHome);
  return Math.max(2, Math.min(6, ag + mods));
}

/** PASS target: PA, + the range-band modifier (Q0/S-1/L-2/B-3), -1 per
 *  opponent marking the thrower, -1 per DP layer on the thrower. Null when
 *  the target square is out of range or the thrower has no PA. */
export function passTargetRoll(game: GameJson, throwerId: string, fromSquare: Square, targetSquare: Square): { roll: number; band: string } | null {
  const thrower = findPlayer(game, throwerId);
  if (!thrower) return null;
  const pa = Number((thrower as { passing?: number }).passing ?? 0);
  if (!pa || pa <= 0) return null; // no passing ability
  const band = passRange(targetSquare[0] - fromSquare[0], targetSquare[1] - fromSquare[1]);
  if (!band || band === 'T') return null;
  const sideIsHome = isHomePlayer(game, throwerId);
  const skills = new Set(playerSkillNames(thrower).map(normalizeSkillName));
  const has = (skill: string) => skills.has(normalizeSkillName(skill));
  const verySunny = String(game.fieldModel?.weather ?? '').toLowerCase().replace(/[^a-z]/g, '').includes('verysunny') ? 1 : 0;
  const passingSkill = ((band === 'Q' || band === 'S') && has('Accurate'))
    || ((band === 'L' || band === 'B') && has('Cannoneer')) ? -1 : 0;
  const mods =
    -PASS_MODIFIERS[band] +
    (has('Nerves of Steel') ? 0 : markersOn(game, fromSquare, sideIsHome)) +
    disturbingPresenceLayers(game, fromSquare, sideIsHome) +
    verySunny + passingSkill;
  return { roll: Math.max(2, Math.min(6, pa + mods)), band };
}

export interface BombCell {
  square: Square;
  /** 'catch' = a player there may CATCH the bomb (has hands + PA); 'explode' =
   *  a direct/blast hit; 'empty' = no player (blast fizzles, still shown). */
  kind: 'catch' | 'explode' | 'empty';
  /** the roll shown — catch target for 'catch', the 4+ blast for 'explode'. */
  roll: number | null;
  /** true for the centre (target) square. */
  centre: boolean;
}

/** Owner 2026-07-04d: the 3×3 bomb blast preview centred on `centre`. The CENTRE
 *  square: a player WITH hands + PA may catch it (their catch target); a player
 *  with No Hands / No Ball or no PA suffers the explosion (4+); empty = it lands
 *  and explodes. Each PERIMETER square with a player shows the flat 4+ blast
 *  knockdown. Mirrors the passing/DP modifiers for the centre catch. */
export function bombCells(game: GameJson, centre: Square): BombCell[] {
  const BLAST = 4; // owner: players in the blast are knocked down on a 4+
  const placed = placedPlayers(game);
  const at = (sq: Square) => placed.find((p) => p.square[0] === sq[0] && p.square[1] === sq[1]);
  // owner: a player with No Hands / No Ball, or no PA stat, can't catch → explodes
  const noCatch = (pl: Placed) => {
    const s = skillsOf(pl.player);
    return s.has('No Hands') || s.has('No Ball') || !Number(pl.player.passing ?? 0);
  };
  const cells: BombCell[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const sq: Square = [centre[0] + dx, centre[1] + dy];
      if (sq[0] < 0 || sq[0] > 25 || sq[1] < 0 || sq[1] > 14) continue;
      const centreCell = dx === 0 && dy === 0;
      const occ = at(sq);
      if (centreCell) {
        if (!occ) { cells.push({ square: sq, kind: 'explode', roll: BLAST, centre: true }); continue; }
        // a player with No Hands / No Ball or no PA can't catch → explosion
        if (noCatch(occ)) cells.push({ square: sq, kind: 'explode', roll: BLAST, centre: true });
        else cells.push({ square: sq, kind: 'catch', roll: catchTarget(game, occ.player.playerId) ?? BLAST, centre: true });
      } else {
        cells.push({ square: sq, kind: occ ? 'explode' : 'empty', roll: occ ? BLAST : null, centre: false });
      }
    }
  }
  return cells;
}

/** #189 (owner RULED (i), 07-28): interception-eligibility skill grantor SETS — a source-faithful port of
 *  the server's UtilPassing.findInterceptors (bb2025). Grep-verified single-grantor at upstream/master (JL-2);
 *  kept as SETS not lone strings so a future 2nd bb2025 grantor is a one-line add, not a silent gap. The client
 *  carries skill NAMES (no server property system); the name↔property map is 1:1 for the bb2025 skill set. */
const PASSES_NOT_INTERCEPTED_GRANTORS = new Set(['Cloud Burster']); // grants passesAreNotIntercepted
const PASSES_INTERCEPT_CANCELLERS = new Set(['Very Long Legs']);    // CancelSkillProperty(passesAreNotIntercepted)
const PREVENT_CATCH_GRANTORS = new Set(['No Ball']);               // grants preventCatch (cannot catch/intercept)
const RULER_WIDTH = 1.74; // UtilPassing.RULER_WIDTH — the pass ruler is 1.74 squares wide

/** True if `player` has any skill in `grantors` (skill-name membership). */
function grantsAny(player: PlayerJson, grantors: Set<string>): boolean {
  const skills = skillsOf(player);
  for (const s of grantors) if (skills.has(s)) return true;
  return false;
}

export interface InterceptorPreview {
  playerId: string;
  square: Square;
  /** the AG target to interfere, after markers + DP (owner spec). */
  roll: number;
}

/** Opponents eligible to intercept the pass thrower→target, with their interference roll (AG, −1 per
 *  opponent marking the interceptor, −1 per DP layer on their square). #189 (owner RULED (i)): a
 *  source-faithful port of UtilPassing.findInterceptors (bb2025), three fixes over the old fixed-band
 *  heuristic — (1) Cloud Burster (passesAreNotIntercepted) is skipped PER-INTERCEPTOR and cancellable by
 *  Very Long Legs, not a blanket disable; (2) a No Ball (preventCatch) interceptor is excluded; (3) exact
 *  canIntercept 1.74-ruler geometry, not distToSegment>1.5. Client-only .roll/.square preview extras kept
 *  (the server computes no roll here — its headless best-pick uses this same eligibility). */
export function interceptors(game: GameJson, throwerId: string, fromSquare: Square, targetSquare: Square): InterceptorPreview[] {
  const thrower = findPlayer(game, throwerId);
  if (!thrower) return [];
  // #189 divergence 1: Cloud Burster is NOT a blanket disable — evaluate its skip per-interceptor below.
  const throwerBlocksIntercept = grantsAny(thrower, PASSES_NOT_INTERCEPTED_GRANTORS);
  const sideIsHome = isHomePlayer(game, throwerId);
  const out: InterceptorPreview[] = [];
  // #189 divergence 3: exact UtilPassing.canIntercept geometry, all deltas relative to the thrower square.
  const [tx, ty] = fromSquare;
  const rX = targetSquare[0] - tx, rY = targetSquare[1] - ty;
  const c = rX * rX + rY * rY; // squared pass length; c>a && c>b keep the interceptor BETWEEN thrower & target
  for (const p of placedPlayers(game)) {
    if (p.isHome === sideIsHome) continue; // opponents only
    if (!hasTackleZones(p.state) || isDown(p.state)) continue;
    if (p.square[0] === targetSquare[0] && p.square[1] === targetSquare[1]) continue;
    // #189 divergence 1: a Cloud Burster pass is interceptable ONLY by a player who cancels
    // passesAreNotIntercepted (Very Long Legs).
    if (throwerBlocksIntercept && !grantsAny(p.player, PASSES_INTERCEPT_CANCELLERS)) continue;
    // #189 divergence 2: a preventCatch interceptor (No Ball) can never intercept.
    if (grantsAny(p.player, PREVENT_CATCH_GRANTORS)) continue;
    // #189 divergence 3: the 1.74-wide pass ruler (c>a && c>b bounds it to the segment; the ruler term is the
    // perpendicular reach). c>a/c>b short-circuit before the divide, so a zero-length pass (c===0) is safe.
    const iX = p.square[0] - tx, iY = p.square[1] - ty;
    const a = (rX - iX) * (rX - iX) + (rY - iY) * (rY - iY);
    const b = iX * iX + iY * iY;
    const d1 = Math.abs(rY * (iX + 0.5) - rX * (iY + 0.5));
    const d2 = Math.abs(rY * (iX + 0.5) - rX * (iY - 0.5));
    const d3 = Math.abs(rY * (iX - 0.5) - rX * (iY + 0.5));
    const d4 = Math.abs(rY * (iX - 0.5) - rX * (iY - 0.5));
    if (!(c > a && c > b && RULER_WIDTH > (2 * Math.min(d1, d2, d3, d4)) / Math.sqrt(c))) continue;
    const ag = Number(p.player.agility ?? 4);
    const mods =
      markersOn(game, p.square, p.isHome) + disturbingPresenceLayers(game, p.square, p.isHome);
    out.push({ playerId: p.player.playerId, square: p.square, roll: Math.max(2, Math.min(6, ag + mods)) });
  }
  return out;
}
