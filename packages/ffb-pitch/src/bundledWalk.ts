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
  const name = normalize(positionName);
  // exact roster name first; else the ruleset-tag-stripped race (owner 09-07: "BB2025 Lizardmen" -> lizardmen) —
  // the first of these that ships at all decides, exactly as before 11-17
  const primary = BUNDLED_ROLES.has(normalize(race)) ? normalize(race) : rosterRaceKey(race);
  const primaryRole = roleIn(primary, name);
  if (primaryRole) return { race: primary, role: primaryRole };
  // Owner 11-17: a league copy of a roster carries a trailing tag ("Malal (WOBBL)") — fall back to the plain roster.
  const tagged = splitTrailingParen(race);
  if (tagged) {
    for (const key of new Set([normalize(tagged.head), rosterRaceKey(tagged.head)])) {
      const role = key !== primary ? roleIn(key, name) : undefined;
      if (role) return { race: key, role };
    }
  }
  // Owner 11-17: a player converted from another roster is named "Position (Roster)" ("Rat Ogre (Clan Moulder)",
  // "Werebear (Were)", "Rat Ogre (Clan Moulder (WOBBL))") — draw that roster's sheet for the position.
  const borrowed = splitTrailingParen(positionName);
  if (borrowed) {
    const target = resolveBundledWalkRole(borrowed.inner, borrowed.head);
    if (target) return target;
  }
  // star players: the hiring roster does not carry the sheet, the 'stars' pseudo-race does
  if (primary !== STAR_RACE && isBundledStarRole(positionName)) return { race: STAR_RACE, role: name };
  return undefined;
}

function roleIn(raceKey: string, name: string): string | undefined {
  const roles = BUNDLED_ROLES.get(raceKey);
  if (!roles) return undefined;
  const alias = ROLE_ALIASES[raceKey]?.[name];
  return alias && roles.has(alias) ? alias : roles.has(name) ? name : undefined;
}

/** Splits off the LAST balanced parenthetical when the text ends with it:
 *  "Rat Ogre (Clan Moulder (WOBBL))" -> { head: 'Rat Ogre', inner: 'Clan Moulder (WOBBL)' };
 *  "Werecat (Were) (Kurgan)" -> { head: 'Werecat (Were)', inner: 'Kurgan' }; anything else -> undefined. */
function splitTrailingParen(value: string): { head: string; inner: string } | undefined {
  const text = value.trimEnd();
  if (!text.endsWith(')')) return undefined;
  let depth = 0;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === ')') depth += 1;
    else if (char === '(' && --depth === 0) {
      const head = text.slice(0, index).trim();
      const inner = text.slice(index + 1, -1).trim();
      return head && inner ? { head, inner } : undefined;
    }
  }
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
 *  (never the whole 66-star set), each star once even when both teams could hire him.
 *  Owner 11-17: callers pass EVERY position name; star names still select star sheets, and each name also loads
 *  exactly the sheet resolveBundledWalkRole picks for it on either roster (a league-tagged roster's plain art, a
 *  borrowed "Position (Roster)" player's sheet) so every token that resolves has its texture. */
export function bundledWalkEntriesForRaces(races: Iterable<string>, positionNames: Iterable<string> = []): BundledWalkEntry[] {
  const raceList = [...races];
  const names = [...positionNames];
  const wanted = new Set(raceList.map((race) => rosterRaceKey(race)).concat(raceList.map((race) => normalize(race))));
  wanted.delete(STAR_RACE);
  const stars = new Set(names.map((name) => normalize(name)));
  const targets = new Set<string>();
  for (const race of raceList) {
    for (const name of names) {
      const target = resolveBundledWalkRole(race, name);
      if (target) targets.add(`${target.race}|${target.role}`);
    }
  }
  return entries.filter((entry) => targets.has(`${entry.race}|${entry.role}`)
    || (entry.race === STAR_RACE ? stars.has(entry.role) : wanted.has(entry.race)));
}

export function bundledWalkManifest(): BundledWalkEntry[] {
  return entries;
}
