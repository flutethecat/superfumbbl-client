import { normalizeSkillName, playerSkillNames } from '@fumbbl40k/ffb-protocol';
import { BB2025_SPECIAL_VOCABULARY } from './logic/bb2025StarSpecials.generated';

/** Owner 10-03: "create a star badge. We'll place it in the top right of star player portraits. When the star player
 *  rule is used, place a red x over it on the badge in the player portrait."
 *
 *  A STAR is a player the server types `Star` (or whose roster position is). Its "star player rule" is the special
 *  skill it carries from the BB2025 special vocabulary (generated from the upstream skill tree). "Used" is the
 *  server's own mark - the player's `usedSkills` (playerMarkSkillUsed / playerMarkSkillUnused): nothing is tracked or
 *  guessed here, so a rule the server resets (per half / per turn) clears the X again, and a passive rule that the
 *  server never marks simply never shows it. */
export interface StarBadge {
  /** the star's special rule(s), roster spelling, in skill order */
  rules: string[];
  /** the rules the server currently marks used */
  usedRules: string[];
  /** true once ANY of the star's special rules is marked used */
  used: boolean;
}

type StarPlayerLike = {
  playerType?: unknown;
  positionId?: unknown;
  usedSkills?: unknown;
  skillArray?: unknown;
};
type StarTeamLike = { roster?: { positionArray?: { positionId?: unknown; playerType?: unknown }[] } | null } | null | undefined;

const SPECIAL_NAMES = new Set(BB2025_SPECIAL_VOCABULARY.map((entry) => normalizeSkillName(entry.name)));
const isStarType = (value: unknown): boolean => String(value ?? '').trim().toLowerCase() === 'star';

export function starBadgeFor(player: StarPlayerLike | null | undefined, team?: StarTeamLike): StarBadge | null {
  if (!player) return null;
  const position = team?.roster?.positionArray?.find((entry) => String(entry.positionId ?? '') === String(player.positionId ?? ''));
  if (!isStarType(player.playerType) && !isStarType(position?.playerType)) return null;
  const rules = playerSkillNames(player as Parameters<typeof playerSkillNames>[0]).filter((name) => SPECIAL_NAMES.has(normalizeSkillName(name)));
  const used = new Set((Array.isArray(player.usedSkills) ? player.usedSkills : []).map((name) => normalizeSkillName(String(name))));
  const usedRules = rules.filter((name) => used.has(normalizeSkillName(name)));
  return { rules, usedRules, used: usedRules.length > 0 };
}
