import { blockDieFaceUrl } from './blockDieFaceArt';

// Owner 10-02: the roster's retro "LVL n" badge (n = advancements taken, 1..6). The art is exported at 1x / 2x / 3x
// (assets/roster-level/roster-level-lvl-{n}-{1x,2x,3x}.png, see PROVENANCE.json there) like the match-result labels
// (matchResultArt.ts). A glob, not one `new URL` per file: it resolves to an empty map while the art is absent, so the
// build never breaks and the roster falls back to its CSS pixel-text badge.
// Only the density exports (`[roster-level-]lvl-N-{1,2,3}x.png`), never the masters / contact sheet beside them.
const FILES = import.meta.glob('../assets/roster-level/*lvl-*x.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export interface RosterLevelArt { alt: string; src: string; srcset: string }

type Density = 1 | 2 | 3 | 4 | 8;
/** Owner 10-02 ("the same 4x and mip mapping we do with other text"): when the 4x / 8x masters exist the badge draws
 *  from them and the browser scales DOWN with smooth filtering (the DOM's mip step) instead of stretching a 1x-3x
 *  export to a fractional size; otherwise the 1x / 2x / 3x density set as before. */
function artFrom(url: (d: Density) => string | undefined, alt: string): RosterLevelArt | null {
  const x4 = url(4);
  if (x4) { const x8 = url(8); return { alt, src: x4, srcset: x8 ? `${x4} 1x, ${x8} 2x` : '' }; }
  const x1 = url(1);
  if (!x1) return null;
  const srcset = ([1, 2, 3] as const).map((d) => { const u = url(d); return u ? `${u} ${d}x` : null; }).filter(Boolean).join(', ');
  return { alt, src: x1, srcset };
}

/** Highest level with its own art (BB2025 stops at six advancements); beyond it the CSS badge shows the real number. */
export const ROSTER_LEVEL_MAX = 6;

/** Badge art for `level`, or null for a rookie (0) or when the art files are not there (the CSS badge shows instead). */
export function rosterLevelArtFrom(files: Readonly<Record<string, string>>, level: number): RosterLevelArt | null {
  if (!Number.isFinite(level) || level < 1 || level > ROSTER_LEVEL_MAX) return null;
  const n = Math.floor(level);
  const file = (density: Density) => new RegExp(`(?:^|[/-])lvl-${n}-${density}x\\.png$`);
  return artFrom((density) => Object.entries(files).find(([path]) => file(density).test(path))?.[1], `Level ${n}`);
}

export function rosterLevelArt(level: number): RosterLevelArt | null {
  return rosterLevelArtFrom(FILES, level);
}

// Owner 10-02: an injured player's badge slot shows the injury instead (same plate, crimson lettering):
// assets/roster-level/inj-<stem>-{1x,2x,3x}.png.
const INJURY_FILES = import.meta.glob('../assets/roster-level/inj-*x.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export type RosterInjuryBadge = 'bh' | 'sh' | 'mng' | 'ni' | 'rip' | 'ma' | 'st' | 'ag' | 'pa' | 'av' | 'ko';
export const ROSTER_INJURY_TEXT: Record<RosterInjuryBadge, string> = {
  bh: 'BH', sh: 'SH', mng: 'MNG', ni: 'NI', rip: 'RIP', ma: '-MA', st: '-ST', ag: '-AG', pa: '-PA', av: '-AV', ko: 'KO',
};
export const ROSTER_INJURY_TITLE: Record<RosterInjuryBadge, string> = {
  bh: 'Badly Hurt', sh: 'Seriously Hurt (misses the next game)', mng: 'Missing this game', ni: 'Serious Injury (Niggling Injury)',
  rip: 'Dead', ma: 'Lasting Injury (-MA)', st: 'Lasting Injury (-ST)', ag: 'Lasting Injury (-AG)', pa: 'Lasting Injury (-PA)', av: 'Lasting Injury (-AV)',
  ko: 'Knocked Out (in the KO box)',
};

export function rosterInjuryArtFrom(files: Readonly<Record<string, string>>, badge: RosterInjuryBadge): RosterLevelArt | null {
  const file = (density: Density) => new RegExp(`(?:^|/)inj-${badge}-${density}x\\.png$`);
  return artFrom((density) => Object.entries(files).find(([path]) => file(density).test(path))?.[1], ROSTER_INJURY_TEXT[badge]);
}

/** Owner 10-02: a player killed this game shows the RIP text art centred over the block die's skull (the log's
 *  attacker-down face) - the roster composes the two; rosterInjuryArt('rip') is the text. */
export const ROSTER_RIP_SKULL_URL = blockDieFaceUrl(1, 'default'); // a roster RIP marker, not a die: never follows the dice family

export function rosterInjuryArt(badge: RosterInjuryBadge): RosterLevelArt | null {
  return rosterInjuryArtFrom(INJURY_FILES, badge);
}
