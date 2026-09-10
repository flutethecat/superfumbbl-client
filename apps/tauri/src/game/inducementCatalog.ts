import type { InducementType } from './railRegistryKeys.generated';
import {
  BB2025_MERCENARY_SKILLS_BY_CATEGORY,
  type Bb2025MercenarySkillCategory,
} from './bb2025MercenarySkills.generated';

/**
 * BB2025's inducement taxonomy is a checked subset of the generated wire-key
 * union. A rename or removal in InducementType.java therefore fails typecheck;
 * legacy/multi-rules `card` and `igor` remain outside this BB2025 surface.
 */
export const BB2025_INDUCEMENT_TYPES = [
  'extraTeamTraining',
  'wanderingApothecaries',
  'starPlayers',
  'mercenaries',
  'wizard',
  'teamMascot',
  'prayers',
  'partTimeCoach',
  'tempCheerleader',
  'weatherMage',
  'bloodweiserBabes',
  'bribes',
  'mortuaryAssistant',
  'briberyAndCorruption',
  'plagueDoctor',
  'riotousRookies',
  'throwARock',
  'halflingMasterChef',
  'biasedRef',
  'infamousStaff',
  'josefBugman',
  'bugmansXXXXXX',
  'dwarfenWisdom',
] as const satisfies readonly InducementType[];

export type Bb2025InducementType = (typeof BB2025_INDUCEMENT_TYPES)[number];
export type InducementSurface = 'fixed' | 'star-roster' | 'mercenary-roster' | 'staff-roster' | 'derived';

export const BB2025_INDUCEMENT_SURFACES: Record<Bb2025InducementType, InducementSurface> = {
  extraTeamTraining: 'fixed',
  wanderingApothecaries: 'fixed',
  starPlayers: 'star-roster',
  mercenaries: 'mercenary-roster',
  wizard: 'fixed',
  teamMascot: 'fixed',
  prayers: 'fixed',
  partTimeCoach: 'fixed',
  tempCheerleader: 'fixed',
  weatherMage: 'fixed',
  bloodweiserBabes: 'fixed',
  bribes: 'fixed',
  mortuaryAssistant: 'fixed',
  briberyAndCorruption: 'derived',
  plagueDoctor: 'fixed',
  riotousRookies: 'fixed',
  throwARock: 'derived',
  halflingMasterChef: 'fixed',
  biasedRef: 'fixed',
  infamousStaff: 'staff-roster',
  josefBugman: 'fixed',
  bugmansXXXXXX: 'derived',
  dwarfenWisdom: 'derived',
};

export interface InducementSourceMetadata {
  surface: InducementSurface;
  usages: readonly string[];
  effects: readonly string[];
}

/** Hand-copied from common + BB2025 InducementCollection; wire keys remain generator-owned. */
export const BB2025_INDUCEMENT_METADATA: Record<Bb2025InducementType, InducementSourceMetadata> = {
  extraTeamTraining: { surface: 'fixed', usages: ['REROLL'], effects: [] },
  wanderingApothecaries: { surface: 'fixed', usages: ['APOTHECARY'], effects: [] },
  starPlayers: { surface: 'star-roster', usages: ['STAR'], effects: [] },
  mercenaries: { surface: 'mercenary-roster', usages: ['LONER'], effects: [] },
  wizard: { surface: 'fixed', usages: ['SPELL'], effects: ['FIREBALL', 'ZAP'] },
  teamMascot: { surface: 'fixed', usages: ['CONDITIONAL_REROLL', 'REROLL_CHEERING_FANS'], effects: [] },
  prayers: { surface: 'fixed', usages: ['GAME_MODIFICATION'], effects: [] },
  partTimeCoach: { surface: 'fixed', usages: ['ADD_COACH'], effects: [] },
  tempCheerleader: { surface: 'fixed', usages: ['ADD_CHEERLEADER'], effects: [] },
  weatherMage: { surface: 'fixed', usages: ['CHANGE_WEATHER'], effects: [] },
  bloodweiserBabes: { surface: 'fixed', usages: ['KNOCKOUT_RECOVERY'], effects: [] },
  bribes: { surface: 'fixed', usages: ['AVOID_BAN'], effects: [] },
  mortuaryAssistant: { surface: 'fixed', usages: ['REGENERATION'], effects: [] },
  briberyAndCorruption: { surface: 'derived', usages: ['REROLL_ARGUE'], effects: [] },
  plagueDoctor: { surface: 'fixed', usages: ['REGENERATION', 'APOTHECARY_JOURNEYMEN'], effects: [] },
  riotousRookies: { surface: 'fixed', usages: ['ADD_LINEMEN'], effects: [] },
  throwARock: { surface: 'derived', usages: ['THROW_ROCK'], effects: [] },
  halflingMasterChef: { surface: 'fixed', usages: ['STEAL_REROLL'], effects: [] },
  biasedRef: { surface: 'fixed', usages: ['ADD_TO_ARGUE_ROLL', 'SPOT_FOUL'], effects: [] },
  infamousStaff: { surface: 'staff-roster', usages: ['STAFF'], effects: [] },
  josefBugman: { surface: 'fixed', usages: ['BUGMAN'], effects: [] },
  bugmansXXXXXX: { surface: 'derived', usages: ['ADD_TO_KO_RECOVERY'], effects: [] },
  dwarfenWisdom: { surface: 'derived', usages: ['RESETUP_D3_PLAYERS'], effects: [] },
};

export interface FixedDefinition {
  type: Bb2025InducementType;
  label: string;
  costKey: string;
  maxKey: string;
  defaultCost: number;
  defaultMax: number;
  totalMaxKey?: string;
  existingField?: 'assistantCoaches' | 'cheerleaders';
  availability?: 'apothecary' | 'wizard' | 'undead' | 'nurgle' | 'lowCost';
  reducedRule?: 'BRIBERY_AND_CORRUPTION' | 'MASTER_CHEF';
  reducedCostKey?: string;
  reducedMaxKey?: string;
  reducedCost?: number;
  reducedMax?: number;
}

/**
 * Citation paths below are relative to fumbbl40k-server upstream/master under
 * ffb-common/src/main/java/com/fumbbl/ffb/{option,factory}/.
 */
export const BB2025_FIXED_INDUCEMENTS: readonly FixedDefinition[] = [
  // GameOptionId.java:58; GameOptionFactory.java:168 (cost), :170 (max).
  { type: 'extraTeamTraining', label: 'Extra Training', costKey: 'inducementExtraTrainingCost', maxKey: 'inducementExtraTrainingMax', defaultCost: 100000, defaultMax: 4 },
  // GameOptionId.java:53; GameOptionFactory.java:110 (cost), :113 (max).
  { type: 'wanderingApothecaries', label: 'Wandering Apo.', costKey: 'inducementAposCost', maxKey: 'inducementAposMax', defaultCost: 100000, defaultMax: 2, availability: 'apothecary' },
  // GameOptionId.java:70; GameOptionFactory.java:182 (cost), :184 (max).
  { type: 'wizard', label: 'Wizard', costKey: 'inducementWizardsCost', maxKey: 'inducementWizardsMax', defaultCost: 150000, defaultMax: 1, availability: 'wizard' },
  // GameOptionId.java:63; GameOptionFactory.java:172 (cost), :175 (max).
  { type: 'teamMascot', label: 'Team Mascot', costKey: 'inducementMascotCost', maxKey: 'inducementMascotMax', defaultCost: 25000, defaultMax: 1 },
  // GameOptionId.java:66; GameOptionFactory.java:272 (cost), :275 (max, default zero).
  { type: 'prayers', label: 'Prayers', costKey: 'inducementPrayersCost', maxKey: 'inducementPrayersMax', defaultCost: 50000, defaultMax: 0 },
  // GameOptionId.java:74; GameOptionFactory.java:313 (cost), :316 (max), :319 (total max).
  { type: 'partTimeCoach', label: 'Part-time Assistant Coaches', costKey: 'inducementPartTimeCoachCost', maxKey: 'inducementPartTimeCoachMax', defaultCost: 20000, defaultMax: 3, totalMaxKey: 'inducementPartTimeCoachTotalMax', existingField: 'assistantCoaches' },
  // GameOptionId.java:73; GameOptionFactory.java:304 (cost), :307 (max), :310 (total max).
  { type: 'tempCheerleader', label: 'Temp Agency Cheerleaders', costKey: 'inducementTempCheerleaderCost', maxKey: 'inducementTempCheerleaderMax', defaultCost: 20000, defaultMax: 4, totalMaxKey: 'inducementTempCheerleaderTotalMax', existingField: 'cheerleaders' },
  // GameOptionId.java:75; GameOptionFactory.java:335 (cost), :333 (max).
  { type: 'weatherMage', label: 'Weather Mage', costKey: 'inducementWeatherMageCost', maxKey: 'inducementWeatherMageMax', defaultCost: 30000, defaultMax: 1 },
  // GameOptionId.java:62; GameOptionFactory.java:153 (cost), :156 (max).
  { type: 'bloodweiserBabes', label: "Blitzer's Best Kegs", costKey: 'inducementKegsCost', maxKey: 'inducementKegsMax', defaultCost: 50000, defaultMax: 2 },
  // GameOptionId.java:54-55; GameOptionFactory.java:116 (cost), :118 (reduced cost), :121 (max), :123 (reduced max).
  { type: 'bribes', label: 'Bribes', costKey: 'inducementBribesCost', maxKey: 'inducementBribesMax', defaultCost: 100000, defaultMax: 3, reducedRule: 'BRIBERY_AND_CORRUPTION', reducedCostKey: 'inducementBribesReducedCost', reducedMaxKey: 'inducementBribesReducedMax', reducedCost: 50000, reducedMax: 6 },
  // GameOptionId.java:60; GameOptionFactory.java:142 (cost), :145 (max).
  { type: 'mortuaryAssistant', label: 'Mortuary Assistant', costKey: 'inducementMortuaryAssistantsCost', maxKey: 'inducementMortuaryAssistantsMax', defaultCost: 100000, defaultMax: 1, availability: 'undead' },
  // GameOptionId.java:61; GameOptionFactory.java:148 (cost), :151 (max).
  { type: 'plagueDoctor', label: 'Plague Doctor', costKey: 'inducementPlagueDoctorsCost', maxKey: 'inducementPlagueDoctorsMax', defaultCost: 100000, defaultMax: 1, availability: 'nurgle' },
  // GameOptionId.java:68; GameOptionFactory.java:269 (cost), :267 (max).
  { type: 'riotousRookies', label: 'Riotous Rookies', costKey: 'inducementRiotousRookiesCost', maxKey: 'inducementRiotousRookiesMax', defaultCost: 100000, defaultMax: 1, availability: 'lowCost' },
  // GameOptionId.java:56-57; GameOptionFactory.java:126 (cost), :129 (reduced cost), :132 (max), :135 (reduced max).
  { type: 'halflingMasterChef', label: 'Halfling Master Chef', costKey: 'inducementChefsCost', maxKey: 'inducementChefsMax', defaultCost: 300000, defaultMax: 1, reducedRule: 'MASTER_CHEF', reducedCostKey: 'inducementChefsReducedCost', reducedMaxKey: 'inducementChefsReducedMax', reducedCost: 100000, reducedMax: 1 },
  // GameOptionId.java:71-72; GameOptionFactory.java:324 (cost), :330 (reduced cost), :322 (max), :327 (reduced max).
  { type: 'biasedRef', label: 'Biased Referee', costKey: 'inducementBiasedRefCost', maxKey: 'inducementBiasedRefMax', defaultCost: 120000, defaultMax: 1, reducedRule: 'BRIBERY_AND_CORRUPTION', reducedCostKey: 'inducementBiasedRefReducedCost', reducedMaxKey: 'inducementBiasedRefReducedMax', reducedCost: 80000, reducedMax: 1 },
  // GameOptionId.java:79; GameOptionFactory.java:192 (cost), :195 (max).
  { type: 'josefBugman', label: 'Infamous Staff - Josef Bugman', costKey: 'inducementJosefBugmanCost', maxKey: 'inducementJosefBugmanMax', defaultCost: 100000, defaultMax: 1 },
];

export interface InducementPosition {
  positionId: string;
  positionName: string;
  playerType: string;
  quantity: number;
  cost: number;
  teamWithPositionId?: string | null;
  replacesPosition?: string | null;
  keywords?: string[];
  skillArray?: string[];
  skillCategoriesNormal?: string[];
}

export interface InducementTeam {
  playerArray: { positionId: string; playerType?: string; recoveringInjury?: unknown }[];
  roster: {
    apothecary: boolean;
    maxBigGuys: number;
    positionArray: InducementPosition[];
    keywords?: string[];
  };
  specialRules?: string[];
  assistantCoaches: number;
  cheerleaders: number;
}

export type OptionValues = Readonly<Record<string, string | number | boolean | undefined>>;

export interface FixedOffer {
  type: Bb2025InducementType;
  label: string;
  cost: number;
  max: number;
  available: boolean;
}

export interface InducementOption {
  key: string;
  label: string;
  cost: number;
  max: number;
  available: boolean;
  star?: boolean;
}

export interface InducementSelectorLimits {
  stars: number;
  mercenaries: number;
  staff: number;
}

export const normalize = (value: string): string => value.toUpperCase().replace(/[^A-Z]/g, '');

export const integerOption = (options: OptionValues, key: string, fallback: number): number => {
  const value = Number(options[key]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
};

export const booleanOption = (options: OptionValues, key: string, fallback: boolean): boolean => {
  const value = options[key];
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

export function buildFixedOffers(
  team: InducementTeam,
  options: OptionValues,
  changedOptionKeys: ReadonlySet<string> = new Set(),
): FixedOffer[] {
  const rules = new Set([...(team.specialRules ?? []), ...(team.roster.keywords ?? [])].map(normalize));

  return BB2025_FIXED_INDUCEMENTS.map((definition) => {
    const reduced = Boolean(definition.reducedRule && rules.has(normalize(definition.reducedRule)));
    const cost = integerOption(
      options,
      reduced && definition.reducedCostKey ? definition.reducedCostKey : definition.costKey,
      reduced ? definition.reducedCost ?? definition.defaultCost : definition.defaultCost,
    );
    let max = integerOption(
      options,
      reduced && definition.reducedMaxKey ? definition.reducedMaxKey : definition.maxKey,
      reduced ? definition.reducedMax ?? definition.defaultMax : definition.defaultMax,
    );
    if (definition.totalMaxKey && definition.existingField) {
      const totalDefault = definition.existingField === 'assistantCoaches' ? 9 : 16;
      max = Math.min(
        max,
        Math.max(0, integerOption(options, definition.totalMaxKey, totalDefault) - team[definition.existingField]),
      );
    }
    const allowed = definition.availability === undefined
      || (definition.availability === 'apothecary' && team.roster.apothecary)
      || (definition.availability === 'wizard'
        && (changedOptionKeys.has(definition.maxKey) || booleanOption(options, 'wizardAvailable', true)))
      || (definition.availability === 'undead' && rules.has(normalize('MASTERS_OF_UNDEATH')))
      || (definition.availability === 'nurgle' && rules.has(normalize('FAVOURED_OF_NURGLE')))
      || (definition.availability === 'lowCost' && rules.has(normalize('LOW_COST_LINEMEN')));

    return { type: definition.type, label: definition.label, cost, max, available: allowed && max > 0 };
  });
}

export function buildInducementSelectorLimits(options: OptionValues): InducementSelectorLimits {
  // AbstractBuyInducementsDialog.java:167-192 reads these three upstream caps.
  return {
    stars: integerOption(options, 'inducementStarsMax', 2),
    mercenaries: integerOption(options, 'inducementMercenariesMax', Number.MAX_SAFE_INTEGER),
    staff: integerOption(options, 'inducementStaffMax', 2),
  };
}

/** Expand an upstream teamWithPositionId pair into one atomic star choice. */
export function starPositionIdsForChoice(team: InducementTeam, positionId: string): string[] {
  const positions = team.roster.positionArray;
  const position = positions.find((candidate) => candidate.positionId === positionId);
  const ids = new Set([positionId]);
  if (position?.teamWithPositionId) ids.add(position.teamWithPositionId);
  for (const candidate of positions) {
    if (candidate.teamWithPositionId === positionId) ids.add(candidate.positionId);
  }
  return [...ids].sort();
}

function buildRosterOffers(team: InducementTeam, options: OptionValues): InducementOption[] {
  const offers: InducementOption[] = [];
  const positions = new Map(team.roster.positionArray.map((position) => [position.positionId, position]));
  const limits = buildInducementSelectorLimits(options);
  const availablePlayers = team.playerArray.filter((player) => player.recoveringInjury == null);
  const freeSlots = Math.max(0, 16 - availablePlayers.length);
  const existingByPosition = new Map<string, number>();
  for (const player of availablePlayers) {
    existingByPosition.set(player.positionId, (existingByPosition.get(player.positionId) ?? 0) + 1);
  }

  // StarPlayerTableModel.java:98-128 buys teamWithPositionId pairs atomically.
  // One canonical row represents the pair and is expanded again when drafting.
  const seenStarChoices = new Set<string>();
  for (const position of team.roster.positionArray) {
    if (normalize(position.playerType) !== 'STAR') continue;
    const ids = starPositionIdsForChoice(team, position.positionId);
    const choiceId = ids.join('|');
    if (seenStarChoices.has(choiceId)) continue;
    seenStarChoices.add(choiceId);
    const pair = ids.map((id) => positions.get(id));
    const validPair = pair.every((candidate) => candidate && normalize(candidate.playerType) === 'STAR')
      && pair.every((candidate) => !candidate?.teamWithPositionId || ids.includes(candidate.teamWithPositionId));
    const starPositions = pair.filter((candidate): candidate is InducementPosition => candidate !== undefined);
    offers.push({
      key: `star:${ids[0]}`,
      label: starPositions.map((candidate) => candidate.positionName).join(' & ') || position.positionName,
      cost: starPositions.reduce((sum, candidate) => sum + candidate.cost, 0),
      max: 1,
      available: validPair && limits.stars > 0 && freeSlots >= ids.length,
      star: true,
    });
  }

  const existingBigGuys = availablePlayers
    .filter((player) => normalize(player.playerType ?? '') === 'BIGGUY').length;
  const mercExtra = integerOption(options, 'inducementMercenariesExtraCost', 30000);
  for (const position of team.roster.positionArray) {
    const playerType = normalize(position.playerType);
    // MercenaryTableModel.java:143-166 excludes these types and subtracts both
    // the position and replacesPosition counts from the position quantity.
    if (['STAR', 'INFAMOUSSTAFF', 'IRREGULAR'].includes(playerType)) continue;
    const replacedCount = position.replacesPosition
      ? (existingByPosition.get(position.replacesPosition) ?? 0)
      : 0;
    const max = Math.max(
      0,
      position.quantity - (existingByPosition.get(position.positionId) ?? 0) - replacedCount,
    );
    const bigGuyAvailable = playerType !== 'BIGGUY' || existingBigGuys < team.roster.maxBigGuys;
    offers.push({
      key: `merc:${position.positionId}`,
      label: position.positionName,
      cost: position.cost + mercExtra,
      max,
      available: max > 0 && limits.mercenaries > 0 && freeSlots > 0 && bigGuyAvailable,
    });
  }

  // InfamousStaffTableModel.java:105-121 offers every INFAMOUS_STAFF position;
  // its global cap is enforced by the selector and purchase seam.
  for (const position of team.roster.positionArray) {
    if (normalize(position.playerType) !== 'INFAMOUSSTAFF') continue;
    offers.push({
      key: `staff:${position.positionId}`,
      label: position.positionName,
      cost: position.cost,
      max: 1,
      available: limits.staff > 0,
    });
  }

  return offers;
}

/**
 * The complete picker projection: generated fixed rows plus roster selectors.
 *
 * AbstractBuyInducementsDialog.java:159-162 (createPanel) never builds a
 * DropDownPanel — i.e. never shows the row — when `availability(team,
 * options) <= 0`; that's the same eligibility gate InducementType.java's
 * per-type overrides encode (mortuaryAssistant/plagueDoctor/riotousRookies:
 * SpecialRule gate; wanderingApothecaries/wizard: roster/game-option gate).
 * `FixedOffer.available` already carries that exact `allowed && max > 0`
 * verdict (buildFixedOffers above), so ineligible rows are dropped here
 * rather than rendered disabled — mirroring upstream's client-side filter,
 * not a client invention. Affordability (cost vs. remaining gold) is a
 * separate, still-visible-but-disabled concern handled in the view.
 */
export function buildInducementOptions(
  team: InducementTeam,
  options: OptionValues,
  changedOptionKeys: ReadonlySet<string> = new Set(),
): InducementOption[] {
  return [
    ...buildFixedOffers(team, options, changedOptionKeys)
      .filter((offer) => offer.available)
      .map((offer) => ({
        key: offer.type,
        label: offer.label,
        cost: offer.cost,
        max: offer.max,
        available: offer.available,
      })),
    ...buildRosterOffers(team, options),
  ];
}

/** MercenaryTable.java:30-39 filters eligible skills by normal category and existing skills. */
export function buildEligibleMercenarySkills(
  team: InducementTeam,
): Readonly<Record<string, readonly string[]>> {
  const eligibleByPosition: Record<string, readonly string[]> = {};
  for (const position of team.roster.positionArray) {
    const existing = new Set(position.skillArray ?? []);
    const eligible = new Set<string>();
    for (const rawCategory of position.skillCategoriesNormal ?? []) {
      const category = normalize(rawCategory) as Bb2025MercenarySkillCategory;
      const skills = BB2025_MERCENARY_SKILLS_BY_CATEGORY[category] as readonly string[] | undefined;
      for (const skill of skills ?? []) {
        if (!existing.has(skill)) eligible.add(skill);
      }
    }
    eligibleByPosition[position.positionId] = [...eligible];
  }
  return eligibleByPosition;
}
