// Skill-picker category blades (owner 08-18): the Add Skill pane surfaces every category as a blade
// (the shell ribbon idiom) in two labeled notebook-tab rows — PRIMARY-access categories, then
// SECONDARY-access — from the same catalog data as the skill grid (W33: no hardcoded categories).
// Extracted pure so the partition/order rules are unit-testable outside the SFC.

export interface LegalSkill { skill: string; category: string; elite?: boolean; }
export interface LegalSkillSet { primary: LegalSkill[]; secondary: LegalSkill[]; }

// W33 (owner spec 2): rank catalog categories in owner order; unknown categories append, never drop.
export function categoryRank(category: string): number {
  const k = (category || '').toLowerCase();
  if (k.startsWith('str')) return 0;
  if (k.startsWith('gen')) return 1;
  if (k.startsWith('agi')) return 2;
  if (k.startsWith('pass')) return 3;
  if (k.startsWith('dev')) return 4;
  if (k.startsWith('mut')) return 5;
  return 6;
}

export function groupByCategory(skills: LegalSkill[]): { category: string; skills: LegalSkill[] }[] {
  const byCat = new Map<string, LegalSkill[]>();
  for (const s of skills) {
    const cat = s.category || 'Trait';
    const bucket = byCat.get(cat) ?? byCat.set(cat, []).get(cat)!;
    bucket.push(s);
  }
  return [...byCat.entries()]
    .sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([category, list]) => ({ category, skills: list.slice().sort((x, y) => x.skill.localeCompare(y.skill)) }));
}

export interface BladeCategory { category: string; count: number; }
// label === null → custom mode's single unlabeled row (no primary/secondary access there).
export interface BladeSection { label: 'Primary' | 'Secondary' | null; categories: BladeCategory[]; }

// Notebook-tab partition: PRIMARY tab + its access categories, then SECONDARY tab + its. A category
// that (defensively) appears in both tiers blades under Primary only; the grid still merges both tiers.
export function buildBladeSections(set: LegalSkillSet | null, custom: boolean): BladeSection[] {
  if (!set) return [];
  const toBlades = (skills: LegalSkill[]): BladeCategory[] =>
    groupByCategory(skills).map((g) => ({ category: g.category, count: g.skills.length }));
  if (custom) {
    const all = toBlades([...set.primary, ...set.secondary]);
    return all.length ? [{ label: null, categories: all }] : [];
  }
  const primary = toBlades(set.primary);
  const primaryNames = new Set(primary.map((b) => b.category));
  const secondary = toBlades(set.secondary).filter((b) => !primaryNames.has(b.category));
  const sections: BladeSection[] = [];
  if (primary.length) sections.push({ label: 'Primary', categories: primary });
  if (secondary.length) sections.push({ label: 'Secondary', categories: secondary });
  return sections;
}

// Blades replace the old category menu: the pane lands on the first blade (primary-first) directly.
export function firstBladeCategory(sections: BladeSection[]): string | null {
  return sections[0]?.categories[0]?.category ?? null;
}
