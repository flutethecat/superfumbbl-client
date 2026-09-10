/**
 * Owner-curated position → ring TYPE overrides. Baked from the server-roster catalog
 * `docs/roster-position-rings.csv` (owner-corrected 2026-07-05; `ownerType` overrides
 * `currentRingType`) MERGED with the live-FUMBBL qualified names observed in captures
 * (e.g. `skeletonlineman`, `bonegiantcatcher`, `highelflineman`). Keyed by the
 * NORMALISED position NAME (live FUMBBL positionIds are numeric, so the name is the
 * reliable signal). Consulted first by `positionRingColor` / `isStarPlayer`; anything
 * not listed falls back to the keyword/playerType heuristics.
 *
 * The fork server sends BARE names (`Runner`, `Skeleton`); live FUMBBL sends race-
 * qualified names (`Skeleton Lineman`). Both formats are keyed here, so a position may
 * appear under two keys (`runner` + `darkelfrunner`). Same-named positions that need
 * DIFFERENT rings across races can only be disambiguated on the qualified (live) key —
 * bare `runner` defaults to catcher (Dwarf/Norse), `darkelfrunner` is thrower.
 *
 * To refresh: edit `docs/roster-position-rings.csv` (`ownerType` column), then re-run
 * the merge that regenerates this map (see docs/regressions cases 278–279).
 */
export type RingType = 'star' | 'blitzer' | 'thrower' | 'blocker' | 'catcher' | 'lineman' | 'bigguy' | 'special';

/** Normalise a position name for lookup: lower-case, strip everything but a–z0–9. */
export function normalizePositionName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export const POSITION_TYPE_BY_NAME: Record<string, RingType> = {
  akhornethesquirrel: 'star',
  ashigaru: 'lineman',
  assassin: 'blocker',
  augur: 'star',
  barikfarblast: 'star',
  beerboar: 'special',
  berserker: 'blitzer',
  bilerotvomitflesh: 'star',
  blitzra: 'blitzer',
  bloater: 'blocker',
  // owner 09-07: Khorne (fork roster_khorne.xml) — Bloodseeker = blocker, Bloodspawn = big guy, Khorngor = blitzer,
  // Bloodborn Marauder = lineman
  bloodbornmarauder: 'lineman',
  bloodseeker: 'blocker',
  bloodspawn: 'bigguy',
  bombardier: 'thrower',
  bonegiant: 'bigguy',
  bonegiantcatcher: 'catcher',
  bullcentaur: 'blitzer',
  bullcentaurblitzer: 'blitzer',
  captainkarinavonriesz: 'star',
  chaosbeastman: 'lineman',
  chaosdwarfblocker: 'blocker',
  // Owner 2026-08-05: Skaven Clanrats ring as LINEMAN (grey) — bare + race-qualified keys; CSV sync owed.
  clanrat: 'lineman',
  clanratlineman: 'lineman',
  skavenclanrat: 'lineman',
  chaoswarrior: 'blocker',
  cindypiewhistle: 'star',
  countluthorvondrakenborg: 'star',
  crumbleberry: 'star',
  darkelfrenegade: 'lineman',
  darkelfrunner: 'thrower',
  dragonprince: 'catcher',
  dwarfblockerlineman: 'lineman',
  dwarfrunner: 'catcher',
  // Owner 2026-08-19: Amazon Eagle Warriors ring as LINEMAN (grey) — bare + race-qualified keys; CSV sync owed.
  eaglewarrior: 'lineman',
  amazoneaglewarrior: 'lineman',
  eaglewarriorlinewoman: 'lineman',
  eldrilsidewinder: 'star',
  fanatic: 'blocker',
  flamesmith: 'special',
  fleshgolem: 'blocker',
  ghoul: 'catcher',
  glorielsummerbloom: 'star',
  goblin: 'lineman',
  goblinrenegade: 'lineman',
  grak: 'star',
  grashnakblackhoof: 'star',
  gretchenwchter: 'star',
  griffoberwald: 'star',
  grombrindal: 'star',
  gufflepusmaw: 'star',
  halfling: 'lineman',
  helmutwulf: 'star',
  highelflineman: 'lineman',
  hobgoblin: 'lineman',
  hobgoblinlineman: 'lineman',
  htharktheunstoppable: 'star',
  ivantheanimaldeathshroud: 'star',
  ivareriksson: 'star',
  jeremiahkool: 'star',
  jordellfreshbreeze: 'star',
  josefbugman: 'star',
  karlavonkill: 'star',
  kirothkrakeneye: 'star',
  linewoman: 'lineman',
  looney: 'blitzer',
  lordborakthedespoiler: 'star',
  lucienswift: 'star',
  marauder: 'lineman',
  khorngor: 'blitzer',
  matriarch: 'blocker',
  mightyzug: 'star',
  minotaur: 'bigguy',
  morgnthorg: 'star',
  ninja: 'catcher',
  norseberserker: 'blitzer',
  norseraider: 'lineman',
  norsevalkyrie: 'catcher', // owner 2026-07-06: BB2025 Norse Valkyrie is a catcher (live race-qualified name)
  // owner 2026-07-06: Imperial Nobility — Retainers = lineman, Bodyguards = blocker,
  // Thrower = thrower. Bare (fork) + race-qualified (live FUMBBL) keys.
  retainer: 'lineman',
  imperialretainer: 'lineman',
  imperialnobilityretainer: 'lineman',
  bodyguard: 'blocker',
  imperialbodyguard: 'blocker',
  imperialnobilitybodyguard: 'blocker',
  imperialthrower: 'thrower',
  imperialnobilitythrower: 'thrower',
  // owner 2026-07-06: Orc Big Un Blockers are BLOCKERS, not big guys (the 'bigun'
  // keyword otherwise flags them orange). Curated map wins over the heuristic.
  bigun: 'blocker',
  bigunblocker: 'blocker',
  orcbigun: 'blocker',
  orcbigunblocker: 'blocker',
  nurglewarrior: 'blocker',
  pestigor: 'blitzer',
  phoenixwarrior: 'thrower',
  // Owner 2026-08-05: Amazon Piranha Warriors ring as BLITZER (red) — bare + race-qualified keys; CSV sync owed.
  piranhawarrior: 'blitzer',
  amazonpiranhawarrior: 'blitzer',
  pogoer: 'catcher',
  puggybaconbreath: 'star',
  purifier: 'special',
  // Owner 2026-08-05: Amazon Python Warriors ring as THROWER (white) — bare + race-qualified keys; CSV sync owed.
  pythonwarrior: 'thrower',
  amazonpythonwarrior: 'thrower',
  renegadedarkelf: 'catcher',
  renegadegoblin: 'lineman',
  renegadeorc: 'lineman',
  renegadeskaven: 'lineman',
  rotspawn: 'bigguy',
  rotter: 'lineman',
  rotterlineman: 'lineman',
  roxannadarknail: 'star',
  runner: 'catcher',
  // Owner W38 2026-08-14: Ogre Runt Punter is a THROWER (name lacks a "thrower"
  // keyword, so the substring heuristic misses it and falls back to lineman/runt
  // default). Bare + race-qualified keys, matching the imperialthrower pattern.
  runtpunter: 'thrower',
  ogreruntpunter: 'thrower',
  samurai: 'blocker',
  saurus: 'blocker',
  sister: 'lineman',
  sistersuperior: 'blitzer',
  skavenrenegade: 'lineman',
  skeleton: 'lineman',
  skeletonlineman: 'lineman',
  skink: 'catcher',
  skrorgsnowpelt: 'star',
  skrullhalfheight: 'star',
  sneakystabba: 'catcher',
  snotling: 'lineman',
  thorssonstoutmead: 'star',
  thrall: 'lineman',
  throra: 'thrower',
  throwra: 'thrower',
  tombguardian: 'blocker',
  trollslayer: 'blocker',
  ulfwerener: 'blocker',
  underworldgoblin: 'lineman',
  valenswift: 'star',
  valkyrie: 'catcher', // owner 2026-07-06: Norse Valkyrie is a catcher (was thrower)
  vampire: 'blocker',
  warriormonk: 'blitzer',
  werewolf: 'blitzer',
  whitelion: 'blitzer',
  wight: 'blitzer',
  wilhelmchaney: 'star',
  witchelf: 'catcher',
  withergraspdoubledrool: 'star',
  yhetee: 'bigguy',
  zolcaththezoat: 'star',
  zombie: 'lineman',
  zzhargmadeye: 'star',
};

/** The ring colour for each type (star → gold, used only if a star ever needs a
 *  ring; stars normally render the gold star silhouette instead). Blocker green is
 *  brightened for legibility over the grass (owner 2026-07-04). */
export const RING_TYPE_COLORS: Record<RingType, number> = {
  blitzer: 0xd03030, // red
  thrower: 0xf0f0ea, // white
  blocker: 0x22e05a, // bright green — reads against the grass (was deep 0x0a5c2a)
  catcher: 0xe0c832, // yellow
  lineman: 0x9a9aa2, // grey
  bigguy: 0xe08a2a, // orange
  special: 0x8a4ab0, // purple
  star: 0xf5c518, // gold
};

/** Look up an owner-curated ring type by position name (null if not listed). */
export function ringTypeForName(name: string | undefined): RingType | null {
  if (!name) return null;
  return POSITION_TYPE_BY_NAME[normalizePositionName(name)] ?? null;
}
