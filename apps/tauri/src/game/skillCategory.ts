export type PlayerSkillCategory = 'general' | 'agility' | 'strength' | 'passing' | 'mutation' | 'trait';

/**
 * The Team Builder's established skill key. Keep this table shared so in-game
 * text never drifts from the roster-building surface's category colours.
 */
// Owner 09-09: the FULL BB2025 category lists (validator dataset bb2025/skills.json), matched case- and
// punctuation-insensitively ("On the Ball", "Dump-off", "Side Step" all resolve). Devious shares the Passing colour
// (the picker's categoryClass does the same), so it lands in the passing bucket. Everything else is a trait.
const TEAM_BUILDER_SKILL_GROUPS: Readonly<Record<Exclude<PlayerSkillCategory, 'trait'>, readonly string[]>> = {
  general: ['Block', 'Dauntless', 'Fend', 'Frenzy', 'Kick', 'Pro', 'Steady Footing', 'Strip Ball', 'Sure Hands', 'Tackle', 'Taunt', 'Wrestle'],
  agility: ['Catch', 'Defensive', 'Diving Catch', 'Diving Tackle', 'Dodge', 'Hit And Run', 'Jump Up', 'Leap', 'Safe Pair Of Hands', 'Sidestep', 'Sprint', 'Sure Feet'],
  strength: ['Arm Bar', 'Brawler', 'Break Tackle', 'Bullseye', 'Grab', 'Guard', 'Juggernaut', 'Mighty Blow', 'Multiple Block', 'Stand Firm', 'Strong Arm', 'Thick Skull'],
  passing: [
    'Accurate', 'Cannoneer', 'Cloud Burster', 'Dump-Off', 'Give and Go', 'Hail Mary Pass', 'Leader', 'Nerves of Steel', 'On The Ball', 'Pass', 'Punt', 'Safe Pass',
    // Devious (BB2025) — same colour family as Passing
    'Dirty Player', 'Eye Gouge', 'Fumblerooski', 'Lethal Flight', 'Lone Fouler', 'Pile Driver', 'Put the Boot In', 'Quick Foul', 'Saboteur', 'Shadowing', 'Sneaky Git', 'Violent Innovator',
  ],
  mutation: ['Big Hand', 'Claws', 'Disturbing Presence', 'Extra Arms', 'Foul Appearance', 'Horns', 'Iron Hard Skin', 'Monstrous Mouth', 'Prehensile Tail', 'Tentacles', 'Two Heads', 'Very Long Legs'],
};

function skillKey(skill: string): string {
  return skill.replace(/\s*\(.*\)\s*$/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const CATEGORY_BY_KEY: ReadonlyMap<string, Exclude<PlayerSkillCategory, 'trait'>> = new Map(
  (Object.entries(TEAM_BUILDER_SKILL_GROUPS) as Array<[Exclude<PlayerSkillCategory, 'trait'>, readonly string[]]>)
    .flatMap(([category, names]) => names.map((name) => [skillKey(name), category] as const)),
);

/** Unknown and special-rule skills are traits, matching Team Builder. */
export function playerSkillCategory(skill: string): PlayerSkillCategory {
  return CATEGORY_BY_KEY.get(skillKey(skill)) ?? 'trait';
}

export function playerSkillCategoryClass(skill: string): `skill-${PlayerSkillCategory}` {
  return `skill-${playerSkillCategory(skill)}`;
}
