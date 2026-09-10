import { rosterRaceKey } from '@fumbbl40k/ffb-pitch';
/**
 * Race-default team crests for lists whose entries carry only a library row (race
 * name, no wire roster) — the challenge "Your team" grid and the Play-blade
 * versus preview. In-game the crest is server-derived: the fork roster XML's
 * <logo> element rides the wire as roster.logoUrl and SpectateView's teamLogo()
 * renders it (SpectateView.vue:7247-7253). This map is that SAME mapping, read
 * verbatim from fumbbl40k-server/ffb-server/rosters/*.xml (one <logo> per race,
 * e.g. roster_human.xml <logo>i/486295</logo>) — not an invented pairing.
 * The client intentionally does not request missing crests from FUMBBL.
 * Unknown race or no local data ⇒ null ⇒ the caller keeps its initials
 * circle (graceful, per-entry).
 */

import { selectedLocalFumbblAssetUrl } from './fumbblAssetCache';
import { crestDataUrl, type CrestSide } from './teamCrests';
import { userFilesPack } from './assetMods';

/** Keys are roster names normalised the way SpectateView.vue:7251 does (lowercase, letters only). */
export const RACE_LOGOS: Readonly<Record<string, string>> = {
  amazon: 'i/486190',
  blackorc: 'i/641574',
  bretonnian: 'i/769337',
  chaoschosen: 'i/486247',
  chaosdwarf: 'i/486253',
  chaosrenegade: 'i/603755',
  clanmoulder: 'i/676940',
  darkelf: 'i/486259',
  dwarf: 'i/486265',
  elvenunion: 'i/486271',
  gnome: 'i/733575',
  goblin: 'i/486277',
  halfling: 'i/486283',
  highelf: 'i/486289',
  human: 'i/486295',
  imperialnobility: 'i/673311',
  khorne: 'i/681361',
  lizardmen: 'i/486307',
  necromantichorror: 'i/486313',
  nippon: 'i/677143',
  norse: 'i/486319',
  nurgle: 'i/486325',
  ogre: 'i/486331',
  oldworldalliance: 'i/637106',
  orc: 'i/486337',
  shamblingundead: 'i/486349',
  skaven: 'i/486343',
  slann: 'i/486367',
  snotling: 'i/643386',
  tombkings: 'i/486301',
  underworlddenizens: 'i/603379',
  vampire: 'i/486355',
  woodelf: 'i/486361',
};

export interface TeamLogoSource {
  race?: string;
  logoUrl?: string;
  baseIconPath?: string;
  /** Kit side for the bundled crest colours (owner 2026-09-04); lists without a side get home. */
  side?: CrestSide;
}

/** The fork roster's own <logo> ref for a race, or null when no roster carries one. */
export function raceDefaultLogo(race: string | undefined): string | null {
  const key = rosterRaceKey(race).replace(/[^a-z]/g, ''); // owner 09-07: ruleset-tagged roster names fall back to the race
  return (key && RACE_LOGOS[key]) || null;
}

/**
 * Resolve a list entry's crest: an explicit logoUrl wins (the wire/API told us),
 * else the race's default roster logo — both only when a selected local pack
 * supplies them (no network lookup). Otherwise the bundled Super FUMBBL crest
 * for the race (owner 2026-09-04, `teamCrests.ts`); null ⇒ show the initials circle.
 */
export function teamLogoUrl(entry: TeamLogoSource): string | null {
  const race = entry.race?.toLowerCase().replace(/[^a-z]/g, '');
  const override = race ? userFilesPack()?.logoImageBindings?.[race] : null;
  if (override) return override;
  const rel = entry.logoUrl || raceDefaultLogo(entry.race);
  const local = rel ? selectedLocalFumbblAssetUrl(rel, entry.baseIconPath) : null;
  return local ?? crestDataUrl(entry.race, entry.side ?? 'home');
}
