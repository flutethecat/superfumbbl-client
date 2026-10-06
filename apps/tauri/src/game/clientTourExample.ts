/**
 * Owner 2026-10-06: the client walkthrough's EXAMPLE game for the Play blade's Details step, used when no recent game has
 * a stored end-of-game snapshot. Synthesised (no real coach, team or match): a plausible Human vs Orc result with the
 * fields the Details popup reads (results, MVPs, SPP, statistics) and a dice tally for its Dice tab. Deterministic.
 */
import { emptyTally, type DiceTally } from './diceStats';
import type { PostGameSnapshot } from './postGameProjection';

export const EXAMPLE_GAME_ID = 'example';
export const EXAMPLE_KEY = `example|${EXAMPLE_GAME_ID}`;

interface ExamplePlayer { nr: number; name: string; pos: string; skills: string[]; td?: number; cas?: number; comp?: number; mvp?: boolean; spp: number }

const HUMAN_POSITIONS = [
  { positionId: 'ex.human.lineman', positionName: 'Human Lineman', skillArray: [] as string[] },
  { positionId: 'ex.human.blitzer', positionName: 'Human Blitzer', skillArray: ['Block'] },
  { positionId: 'ex.human.thrower', positionName: 'Human Thrower', skillArray: ['Sure Hands', 'Pass'] },
  { positionId: 'ex.human.catcher', positionName: 'Human Catcher', skillArray: ['Catch', 'Dodge'] },
];
const ORC_POSITIONS = [
  { positionId: 'ex.orc.lineman', positionName: 'Orc Lineman', skillArray: [] as string[] },
  { positionId: 'ex.orc.blitzer', positionName: 'Orc Blitzer', skillArray: ['Block'] },
  { positionId: 'ex.orc.blackorc', positionName: 'Orc Black Orc', skillArray: ['Brawler', 'Grab'] },
  { positionId: 'ex.orc.thrower', positionName: 'Orc Thrower', skillArray: ['Sure Hands', 'Pass'] },
];

const HUMANS: ExamplePlayer[] = [
  { nr: 1, name: 'Aldric Vane', pos: 'ex.human.blitzer', skills: ['Block', 'Tackle'], cas: 1, spp: 14 },
  { nr: 2, name: 'Bram Holt', pos: 'ex.human.blitzer', skills: ['Block'], spp: 6 },
  { nr: 3, name: 'Corwin Ash', pos: 'ex.human.thrower', skills: ['Sure Hands', 'Pass', 'Accurate'], comp: 3, spp: 21 },
  { nr: 4, name: 'Dain Swift', pos: 'ex.human.catcher', skills: ['Catch', 'Dodge'], td: 1, spp: 9 },
  { nr: 5, name: 'Edric Fenn', pos: 'ex.human.catcher', skills: ['Catch', 'Dodge', 'Sprint'], td: 1, mvp: true, spp: 17 },
  { nr: 6, name: 'Garrick Moss', pos: 'ex.human.lineman', skills: [], spp: 2 },
  { nr: 7, name: 'Hal Brenner', pos: 'ex.human.lineman', skills: [], spp: 0 },
  { nr: 8, name: 'Ivo Marsh', pos: 'ex.human.lineman', skills: [], spp: 3 },
  { nr: 9, name: 'Jory Plume', pos: 'ex.human.lineman', skills: [], spp: 1 },
  { nr: 10, name: 'Kell Dunmore', pos: 'ex.human.lineman', skills: [], spp: 0 },
  { nr: 11, name: 'Lew Garth', pos: 'ex.human.lineman', skills: [], spp: 4 },
];
const ORCS: ExamplePlayer[] = [
  { nr: 1, name: 'Grimskull', pos: 'ex.orc.blackorc', skills: ['Brawler', 'Grab'], cas: 1, spp: 8 },
  { nr: 2, name: 'Bonecrusha', pos: 'ex.orc.blackorc', skills: ['Brawler', 'Grab', 'Mighty Blow'], spp: 16 },
  { nr: 3, name: 'Snagtooth', pos: 'ex.orc.blitzer', skills: ['Block'], td: 1, mvp: true, spp: 12 },
  { nr: 4, name: 'Urzog', pos: 'ex.orc.blitzer', skills: ['Block'], spp: 5 },
  { nr: 5, name: 'Ratgut', pos: 'ex.orc.thrower', skills: ['Sure Hands', 'Pass'], comp: 1, spp: 7 },
  { nr: 6, name: 'Mugrak', pos: 'ex.orc.lineman', skills: [], spp: 2 },
  { nr: 7, name: 'Skarbag', pos: 'ex.orc.lineman', skills: [], spp: 0 },
  { nr: 8, name: 'Lugbutt', pos: 'ex.orc.lineman', skills: [], cas: 1, spp: 3 },
  { nr: 9, name: 'Nazgob', pos: 'ex.orc.lineman', skills: [], spp: 1 },
  { nr: 10, name: 'Durbag', pos: 'ex.orc.lineman', skills: [], spp: 0 },
  { nr: 11, name: 'Grubnak', pos: 'ex.orc.lineman', skills: [], spp: 0 },
];

function team(id: string, name: string, coach: string, race: string, positions: typeof HUMAN_POSITIONS, players: ExamplePlayer[]) {
  return {
    teamId: id,
    teamName: name,
    coach,
    race,
    teamValue: 1_000_000,
    roster: { positionArray: positions },
    playerArray: players.map((p) => ({ playerId: `${id}-${p.nr}`, playerNr: p.nr, playerName: p.name, positionId: p.pos, skillArray: p.skills })),
  };
}

function results(id: string, players: ExamplePlayer[]) {
  const score = players.reduce((n, p) => n + (p.td ?? 0), 0);
  return {
    score,
    playerResults: players.map((p) => ({
      playerId: `${id}-${p.nr}`,
      playerAwards: p.mvp ? 1 : 0,
      touchdowns: p.td ?? 0,
      casualties: p.cas ?? 0,
      completions: p.comp ?? 0,
      interceptions: 0,
      blocks: p.pos.includes('blitzer') || p.pos.includes('blackorc') ? 4 : 1,
      fouls: 0,
      rushing: p.td ? 18 : 3,
      passing: p.comp ? p.comp * 8 : 0,
      currentSpps: p.spp,
    })),
  };
}

/** A plausible dice tally built from fixed sequences (so the charts and fun facts have something to say). */
function tally(seed: number): DiceTally {
  const t = emptyTally();
  const d6 = [3, 6, 2, 5, 1, 4, 6, 3, 2, 5, 4, 4, 1, 6, 5, 2, 3, 6, 4, 2, 5, 1, 3, 6, 4, 5, 2, 6, 3, 4, 1, 5, 6, 2, 4, 3];
  const block = [6, 3, 4, 2, 5, 3, 1, 6, 4, 3, 5, 6, 2, 4, 3, 6];
  const rot = <T,>(xs: T[], k: number) => xs.slice(k % xs.length).concat(xs.slice(0, k % xs.length));
  for (const f of rot(d6, seed)) { t.d6[f]! += 1; t.d6Seq.push(f); }
  for (const f of rot(block, seed)) { t.block[f]! += 1; t.blockSeq.push(f); }
  t.armour = rot([7, 9, 6, 10, 8, 5, 11, 8], seed);
  t.injury = rot([6, 9, 8], seed);
  for (const f of rot([2, 5, 4, 3, 6, 1, 5, 4], seed)) t.armourFaces[f]! += 1;
  for (const f of rot([3, 4, 5], seed)) t.injuryFaces[f]! += 1;
  for (const f of rot([4, 2, 6, 5, 1, 3], seed)) t.dodgeFaces[f]! += 1;
  t.blocks = block.length;
  t.failedBlocks = seed % 2 ? 2 : 1;
  t.dodges = 6;
  t.failedDodges = 1;
  t.pickups = 3;
  t.failedPickups = seed % 2;
  t.rushes = 5;
  t.failedRushes = 1;
  return t;
}

export function exampleSnapshot(now: number = Date.now()): PostGameSnapshot {
  const home = team('EXH', 'Riverside Reavers', 'ExampleCoach', 'Human', HUMAN_POSITIONS, HUMANS);
  const away = team('EXA', 'Ironjaw Krumpaz', 'AnotherCoach', 'Orc', ORC_POSITIONS, ORCS);
  return {
    version: 1,
    key: EXAMPLE_KEY,
    server: 'example',
    gameId: EXAMPLE_GAME_ID,
    seat: 'play',
    savedAt: now,
    game: { gameId: 0, teamHome: home, teamAway: away, gameResult: { teamResultHome: results('EXH', HUMANS), teamResultAway: results('EXA', ORCS) } } as never,
    tallies: { home: tally(0), away: tally(5) },
    endGameStats: null,
    defectors: null,
    portraits: {},
  };
}
