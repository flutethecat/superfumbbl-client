import manifest from '../assets/walk/manifest.json';
import type { BundledWalkEntry } from './walkers';

const bundledAssetUrls = import.meta.glob<string>('../assets/walk/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Owner 09-07: upstream rosters may be NAMED with a ruleset tag ("BB2025 Lizardmen", "BB2025 Elven Union") —
 *  strip a leading/trailing ruleset token so the team still lands on the bundled default art for that race. */
export function rosterRaceKey(race: string | null | undefined): string {
  const key = normalize(String(race ?? ''));
  // Owner 09-09: the fork's live Slann roster is the team-specific "Slann 2025" (bare year, no BB prefix) — it keyed
  // to 'slann2025', found no bundled sheets and fell back to upstream art. A bare edition year is a ruleset tag too.
  return key.replace(/^(?:bb\d{4}|bb\d|crp|lrb\d|ffb|20\d{2})+/, '').replace(/(?:bb\d{4}|bb\d|crp|lrb\d|20\d{2})+$/, '') || key;
}

const ROLE_ALIASES: Record<string, Record<string, string>> = {
  human: {
    humanlineman: 'lineman',
    humanthrower: 'thrower',
    humancatcher: 'catcher',
    humanblitzer: 'blitzer',
    halflinghopeful: 'halflinghopeful',
    ogre: 'ogre',
    lineman: 'lineman',
    thrower: 'thrower',
    catcher: 'catcher',
    blitzer: 'blitzer',
  },
  necromantichorror: {
    zombielineman: 'zombie',
    ghoulrunner: 'ghoulrunner',
    wraith: 'wraith',
    werewolf: 'werewolf',
    fleshgolem: 'fleshgolem',
  },
  slann: {
    slannlineman: 'lineman', slannthrower: 'thrower', slanncatcher: 'catcher', slannblitzer: 'blitzer',
    lineman: 'lineman', thrower: 'thrower', catcher: 'catcher', blitzer: 'blitzer', kroxigor: 'kroxigor',
  },
  orc: {
    orclineman: 'lineman',
    orcthrower: 'thrower',
    orcblitzer: 'blitzer',
    bigunblocker: 'blackorcblocker',
    goblinlineman: 'goblin',
    troll: 'troll',
    lineman: 'lineman',
    thrower: 'thrower',
    blitzer: 'blitzer',
    goblin: 'goblin',
    blackorcblocker: 'blackorcblocker',
  },
};

/** Roles the bundle actually ships, per race, straight from the manifest (the art role keys are the
 *  normalised BB2025 position names, e.g. 'Jaguar Warrior Blocker' -> 'jaguarwarriorblocker'). */
const BUNDLED_ROLES = new Map<string, Set<string>>();
for (const sheet of manifest.sheets) {
  let roles = BUNDLED_ROLES.get(sheet.race);
  if (!roles) { roles = new Set(); BUNDLED_ROLES.set(sheet.race, roles); }
  roles.add(sheet.role);
}

/** Owner 09-09: the 66 BB2025 star players ship under the pseudo-race 'stars' (role = the star's name, normalised).
 *  A star is the same figure whoever hires him, so he resolves by position NAME after the hiring roster's own roles. */
export const STAR_RACE = 'stars';

export function isBundledStarRole(positionName: string | undefined): boolean {
  return !!positionName && (BUNDLED_ROLES.get(STAR_RACE)?.has(normalize(positionName)) ?? false);
}

export function resolveBundledWalkRole(
  race: string,
  positionName: string | undefined,
): { race: string; role: string } | undefined {
  if (!positionName) return undefined;
  // exact roster name first; else the ruleset-tag-stripped race (owner 09-07: "BB2025 Lizardmen" -> lizardmen)
  const raceKey = BUNDLED_ROLES.has(normalize(race)) ? normalize(race) : rosterRaceKey(race);
  const name = normalize(positionName);
  const roles = BUNDLED_ROLES.get(raceKey);
  if (roles) {
    const alias = ROLE_ALIASES[raceKey]?.[name];
    const role = alias && roles.has(alias) ? alias : roles.has(name) ? name : undefined;
    if (role) return { race: raceKey, role };
  }
  // star players: the hiring roster does not carry the sheet, the 'stars' pseudo-race does
  if (raceKey !== STAR_RACE && isBundledStarRole(positionName)) return { race: STAR_RACE, role: name };
  return undefined;
}

const entries: BundledWalkEntry[] = manifest.sheets.map((sheet) => {
  const url = bundledAssetUrls[`../assets/walk/${sheet.file}`];
  if (!url) throw new Error(`Bundled walk-sheet URL missing for ${sheet.file}`);
  const extra = sheet as { visualScale?: number; displayFile?: string; frame?: number };
  // Owner 09-05: the DISPLAY sheet (37 px frames, alpha-aware Lanczos from the 64 px art) is drawn 1:1 at the
  // default zoom instead of GPU-minifying the full sheet (which lost the detail).
  return {
    race: sheet.race,
    role: sheet.role,
    side: sheet.side as BundledWalkEntry['side'],
    url,
    footY: sheet.footY,
    columns: sheet.columns,
    fps: sheet.fps,
    rows: sheet.rows,
    visualScale: extra.visualScale, // 09-05: blitzer mass parity — was dropped here, so it never reached the renderer
    frame: extra.frame, // 09-05: 96-unit frames for the big-guy tier (undefined = 64)
  };
});

/** The bundled entries for the given team races (any case/spacing) — what a game needs, not the whole manifest.
 *  Owner 09-09: `starNames` = the star-player position names on those rosters; only THOSE star sheets load
 *  (never the whole 66-star set), each star once even when both teams could hire him. */
export function bundledWalkEntriesForRaces(races: Iterable<string>, starNames: Iterable<string> = []): BundledWalkEntry[] {
  const wanted = new Set([...races].map((race) => rosterRaceKey(race)).concat([...races].map((race) => normalize(race))));
  wanted.delete(STAR_RACE);
  const stars = new Set([...starNames].map((name) => normalize(name)));
  return entries.filter((entry) => entry.race === STAR_RACE ? stars.has(entry.role) : wanted.has(entry.race));
}

export function bundledWalkManifest(): BundledWalkEntry[] {
  return entries;
}
