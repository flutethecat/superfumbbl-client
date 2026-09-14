/** The two pitch sides. One `as const` list so validators never carry their own copy (09-13, see LOG_TAG_KINDS). */
export const TEAM_SIDES = ['home', 'away'] as const;
export type TeamSide = (typeof TEAM_SIDES)[number];
