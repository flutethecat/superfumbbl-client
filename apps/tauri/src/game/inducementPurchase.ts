import type { InducementType } from './railRegistryKeys.generated';
import {
  buildFixedOffers,
  integerOption,
  normalize,
  starPositionIdsForChoice,
  type Bb2025InducementType,
  type InducementPosition,
  type InducementTeam,
  type OptionValues,
} from './inducementCatalog';

export interface MercenaryPick {
  positionId: string;
  skill?: string;
}

export interface InducementDraft {
  fixed: Partial<Record<Bb2025InducementType, number>>;
  starPositionIds: string[];
  staffPositionIds: string[];
  mercenaries: MercenaryPick[];
}

export interface InducementWireValue {
  inducementType: InducementType;
  value: number;
  uses: number;
}

/**
 * InducementSet.toJsonValue(): InducementSet.java:385-413. The optional nested
 * star ids mirror its ArrayTool.isProvided gate at lines 407-410.
 */
export interface InducementSetWire {
  inducementArray: InducementWireValue[];
  cardsAvailable: string[];
  cardsActive: string[];
  cardsDeactivated: string[];
  starPlayerPositionIds?: string[];
  prayers: string[];
}

/** ClientCommandBuyInducements.toJsonValue(): ClientCommandBuyInducements.java:104-120. */
export interface BuyInducementsCommand extends Record<string, unknown> {
  netCommandId: 'clientBuyInducements';
  teamId: string;
  inducementSet: InducementSetWire;
  starPlayerPositionIds: string[];
  availableGold: number;
  mercenaryPositionIds: string[];
  mercenarySkills: string[];
  staffPositionIds: string[];
}

export type DecisionAuthority =
  | { role: 'player'; myTeamId: string; decisionTeamId: string }
  | { role: 'spectator' | 'replay' };

export function assertDecisionAuthority(authority: DecisionAuthority, wireTeamId: string): void {
  if (authority.role !== 'player') throw new Error(`${authority.role} cannot send an inducement decision`);
  if (authority.myTeamId !== authority.decisionTeamId || authority.decisionTeamId !== wireTeamId) {
    throw new Error('inducement decision is not owned by this player');
  }
}

export interface PurchaseContext {
  teamId: string;
  availableGold: number;
  team: InducementTeam;
  options: OptionValues;
  changedOptionKeys?: ReadonlySet<string>;
  authority: DecisionAuthority;
  /** Upstream SkillFactory-derived eligible normal skills, keyed by positionId. */
  eligibleMercenarySkills: Readonly<Record<string, readonly string[]>>;
}

export interface InducementPick {
  key: string;
  count: number;
}

/** Convert picker keys to the exact roster arrays expected by ClientCommandBuyInducements. */
export function inducementDraftFromPicks(
  picks: readonly InducementPick[],
  team: InducementTeam,
): InducementDraft {
  const draft: InducementDraft = {
    fixed: {},
    starPositionIds: [],
    staffPositionIds: [],
    mercenaries: [],
  };
  for (const pick of picks) {
    if (pick.count <= 0) continue;
    if (pick.key.startsWith('star:')) {
      const ids = starPositionIdsForChoice(team, pick.key.slice(5));
      for (let count = 0; count < pick.count; count += 1) draft.starPositionIds.push(...ids);
    } else if (pick.key.startsWith('merc:')) {
      // Optional skill selection is deferred; Java serializes no skill as "".
      for (let count = 0; count < pick.count; count += 1) {
        draft.mercenaries.push({ positionId: pick.key.slice(5), skill: undefined });
      }
    } else if (pick.key.startsWith('staff:')) {
      for (let count = 0; count < pick.count; count += 1) draft.staffPositionIds.push(pick.key.slice(6));
    } else {
      draft.fixed[pick.key as Bb2025InducementType] = pick.count;
    }
  }
  return draft;
}

interface WireGameOptions {
  gameOptions?: {
    gameOptionArray?: { gameOptionId?: unknown; gameOptionValue?: unknown }[];
  };
}

/** Adapt the sparse upstream game-option wire without manufacturing unsent overrides. */
export function purchaseOptionsFromWire(game: WireGameOptions): {
  options: OptionValues;
  changedOptionKeys: ReadonlySet<string>;
} {
  const options: Record<string, string | number | boolean | undefined> = {};
  const changedOptionKeys = new Set<string>();
  for (const option of game.gameOptions?.gameOptionArray ?? []) {
    const key = String(option.gameOptionId ?? '');
    if (!key) continue;
    const raw = option.gameOptionValue;
    const text = String(raw ?? '');
    const numeric = Number(raw);
    options[key] = text === 'true' ? true : text === 'false' ? false : Number.isFinite(numeric) ? numeric : text;
    changedOptionKeys.add(key);
  }
  return { options, changedOptionKeys };
}

/**
 * Adapt Roster.toJsonValue() and RosterPosition.toJsonValue() wire fields.
 * Roster.java:318-337; RosterPosition.java:615-675.
 */
export function inducementTeamFromWire(rawTeam: unknown): InducementTeam {
  const team = (rawTeam ?? {}) as Record<string, unknown>;
  const roster = (team.roster ?? {}) as Record<string, unknown>;
  const rawPositions = Array.isArray(roster.positionArray)
    ? roster.positionArray as Record<string, unknown>[]
    : [];
  const rawPlayers = Array.isArray(team.playerArray)
    ? team.playerArray as Record<string, unknown>[]
    : [];
  const finiteNonNegative = (value: unknown, fallback: number): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
  };
  const optionalString = (value: unknown): string | null => value == null || value === '' ? null : String(value);

  return {
    playerArray: rawPlayers.map((player) => ({
      positionId: String(player.positionId ?? ''),
      playerType: player.playerType == null ? undefined : String(player.playerType),
      recoveringInjury: player.recoveringInjury,
    })),
    roster: {
      apothecary: Boolean(roster.apothecary),
      maxBigGuys: finiteNonNegative(roster.maxBigGuys, Number.MAX_SAFE_INTEGER),
      keywords: Array.isArray(roster.keywords) ? roster.keywords.map(String) : [],
      positionArray: rawPositions.map((position) => ({
        positionId: String(position.positionId ?? ''),
        positionName: String(position.positionName ?? ''),
        playerType: String(position.playerType ?? ''),
        quantity: finiteNonNegative(position.quantity, 0),
        cost: finiteNonNegative(position.cost, 0),
        teamWithPositionId: optionalString(position.teamWithPositionId),
        replacesPosition: optionalString(position.replacesPosition),
        keywords: Array.isArray(position.keywords) ? position.keywords.map(String) : [],
        skillArray: Array.isArray(position.skillArray) ? position.skillArray.map(String) : [],
        skillCategoriesNormal: Array.isArray(position.skillCategoriesNormal)
          ? position.skillCategoriesNormal.map(String)
          : [],
      })),
    },
    specialRules: Array.isArray(team.specialRules) ? team.specialRules.map(String) : [],
    assistantCoaches: finiteNonNegative(team.assistantCoaches, 0),
    cheerleaders: finiteNonNegative(team.cheerleaders, 0),
  };
}

export function purchaseContextFromWire(input: {
  game: WireGameOptions;
  team: unknown;
  teamId: string;
  availableGold: number;
  authority: DecisionAuthority;
  eligibleMercenarySkills?: Readonly<Record<string, readonly string[]>>;
}): PurchaseContext {
  const { options, changedOptionKeys } = purchaseOptionsFromWire(input.game);
  return {
    teamId: input.teamId,
    availableGold: input.availableGold,
    team: inducementTeamFromWire(input.team),
    options,
    changedOptionKeys,
    authority: input.authority,
    eligibleMercenarySkills: input.eligibleMercenarySkills ?? {},
  };
}

function positionMap(team: InducementTeam): Map<string, InducementPosition> {
  return new Map(team.roster.positionArray.map((position) => [position.positionId, position]));
}

export function buildBuyInducementsCommand(
  context: PurchaseContext,
  draft: InducementDraft,
): BuyInducementsCommand {
  assertDecisionAuthority(context.authority, context.teamId);
  const offers = new Map(
    buildFixedOffers(context.team, context.options, context.changedOptionKeys).map((offer) => [offer.type, offer]),
  );
  const positions = positionMap(context.team);
  const fixedRows: InducementWireValue[] = [];
  let spent = 0;

  for (const [type, rawCount] of Object.entries(draft.fixed)) {
    const count = Number(rawCount);
    const offer = offers.get(type as Bb2025InducementType);
    if (!offer || !Number.isInteger(count) || count < 0 || (count > 0 && (!offer.available || count > offer.max))) {
      throw new Error(`invalid inducement selection: ${type}`);
    }
    if (count > 0) {
      fixedRows.push({ inducementType: offer.type, value: count, uses: 0 });
      spent += count * offer.cost;
    }
  }

  const starsMax = integerOption(context.options, 'inducementStarsMax', 2);
  const staffMax = integerOption(context.options, 'inducementStaffMax', 2);
  const mercenaryMax = integerOption(context.options, 'inducementMercenariesMax', Number.MAX_SAFE_INTEGER);
  if (new Set(draft.starPositionIds).size !== draft.starPositionIds.length) {
    throw new Error('invalid star selection');
  }
  if (new Set(draft.staffPositionIds).size !== draft.staffPositionIds.length
    || draft.staffPositionIds.length > staffMax) {
    throw new Error('invalid staff selection');
  }
  if (draft.mercenaries.length > mercenaryMax) throw new Error('too many mercenaries');

  const starChoiceKeys = new Set<string>();
  for (const id of draft.starPositionIds) {
    const position = positions.get(id);
    if (!position || normalize(position.playerType) !== 'STAR') throw new Error(`invalid star ${id}`);
    if (position.teamWithPositionId && !draft.starPositionIds.includes(position.teamWithPositionId)) {
      throw new Error(`paired star ${id} requires ${position.teamWithPositionId}`);
    }
    starChoiceKeys.add(position.teamWithPositionId
      ? [id, position.teamWithPositionId].sort().join('|')
      : id);
    spent += position.cost;
  }
  if (starChoiceKeys.size > starsMax) throw new Error('too many star choices');

  // Cross-team duplicate stars/staff are deliberately left to StepBuyInducements.
  for (const id of draft.staffPositionIds) {
    const position = positions.get(id);
    if (!position || normalize(position.playerType) !== 'INFAMOUSSTAFF') {
      throw new Error(`invalid staff ${id}`);
    }
    spent += position.cost;
  }

  const josef = (draft.fixed.josefBugman ?? 0) > 0;
  const bugmanStar = draft.starPositionIds.some((id) => positions.get(id)?.keywords
    ?.some((key) => normalize(key) === 'BUGMAN'));
  if (josef && bugmanStar) throw new Error('Josef Bugman and a BUGMAN star are mutually exclusive');

  const availablePlayers = context.team.playerArray.filter((player) => player.recoveringInjury == null);
  const existingByPosition = new Map<string, number>();
  for (const player of availablePlayers) {
    existingByPosition.set(player.positionId, (existingByPosition.get(player.positionId) ?? 0) + 1);
  }
  const selectedByPosition = new Map<string, number>();
  const mercExtra = integerOption(context.options, 'inducementMercenariesExtraCost', 30000);
  const skillCost = integerOption(context.options, 'inducementMercenariesSkillCost', 50000);
  for (const mercenary of draft.mercenaries) {
    const position = positions.get(mercenary.positionId);
    const playerType = normalize(position?.playerType ?? '');
    if (!position || ['STAR', 'INFAMOUSSTAFF', 'IRREGULAR'].includes(playerType)) {
      throw new Error(`invalid mercenary ${mercenary.positionId}`);
    }
    const selected = (selectedByPosition.get(position.positionId) ?? 0) + 1;
    selectedByPosition.set(position.positionId, selected);
    const replacedCount = position.replacesPosition
      ? (existingByPosition.get(position.replacesPosition) ?? 0)
      : 0;
    if (selected + (existingByPosition.get(position.positionId) ?? 0) + replacedCount > position.quantity) {
      throw new Error(`mercenary quantity exceeded: ${position.positionId}`);
    }
    if (mercenary.skill) {
      const eligible = context.eligibleMercenarySkills[position.positionId] ?? [];
      if (!eligible.includes(mercenary.skill) || position.skillArray?.includes(mercenary.skill)) {
        throw new Error(`invalid mercenary skill: ${mercenary.skill}`);
      }
    }
    spent += position.cost + mercExtra + (mercenary.skill ? skillCost : 0);
  }

  // Upstream getFreeSlotsInRoster counts available players, stars, and mercenaries.
  // Infamous Staff is deliberately governed only by inducementStaffMax.
  const rosterAdditions = draft.starPositionIds.length + draft.mercenaries.length;
  if (availablePlayers.length + rosterAdditions > 16) throw new Error('roster has no free slots');
  const existingBigGuys = availablePlayers
    .filter((player) => normalize(player.playerType ?? '') === 'BIGGUY').length;
  const mercBigGuys = draft.mercenaries
    .filter((pick) => normalize(positions.get(pick.positionId)?.playerType ?? '') === 'BIGGUY').length;
  if (mercBigGuys > 0 && existingBigGuys + mercBigGuys > context.team.roster.maxBigGuys) {
    throw new Error('maximum big guys exceeded');
  }
  if (spent > context.availableGold) throw new Error('inducement budget exceeded');

  /**
   * Model-serializer parity only: InducementSet.java:407-410 emits nested star
   * ids when populated. Its add() method (lines 223-244) does not copy them,
   * and BB2025 StepBuyInducements.java:171-176 assigns stars from the outer
   * command field. Keep both copies: the nested one is intentionally inert in
   * BB2025 game logic.
   */
  const inducementSet: InducementSetWire = {
    inducementArray: [
      ...fixedRows,
      ...(draft.starPositionIds.length
        ? [{ inducementType: 'starPlayers' as const, value: draft.starPositionIds.length, uses: 0 }]
        : []),
      ...(draft.mercenaries.length
        ? [{ inducementType: 'mercenaries' as const, value: draft.mercenaries.length, uses: 0 }]
        : []),
      ...(draft.staffPositionIds.length
        ? [{ inducementType: 'infamousStaff' as const, value: draft.staffPositionIds.length, uses: 0 }]
        : []),
    ],
    cardsAvailable: [],
    cardsActive: [],
    cardsDeactivated: [],
    ...(draft.starPositionIds.length > 0
      ? { starPlayerPositionIds: [...draft.starPositionIds] }
      : {}),
    prayers: [],
  };

  // Property order follows ClientCommandBuyInducements.toJsonValue() at lines 104-120.
  return {
    netCommandId: 'clientBuyInducements',
    teamId: context.teamId,
    inducementSet,
    starPlayerPositionIds: [...draft.starPositionIds],
    availableGold: context.availableGold - spent,
    mercenaryPositionIds: draft.mercenaries.map((pick) => pick.positionId),
    // ClientCommandBuyInducements.java:113-118 uses "" for a null skill.
    mercenarySkills: draft.mercenaries.map((pick) => pick.skill ?? ''),
    staffPositionIds: [...draft.staffPositionIds],
  };
}
