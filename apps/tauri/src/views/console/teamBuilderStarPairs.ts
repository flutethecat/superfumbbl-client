export interface TeamBuilderStarPosition {
  positionId: string;
  name: string;
  cost: number;
  isStar?: boolean;
  teamWithPositionId?: string | null;
}

export interface TeamBuilderStarChoice<Position extends TeamBuilderStarPosition = TeamBuilderStarPosition> {
  key: string;
  label: string;
  members: Position[];
  cost: number;
  paired: boolean;
}

export interface TeamBuilderStarSlot {
  positionId: string;
  name: string;
  chosenSkills: string[];
}

interface KnownPair {
  label: string;
  names: readonly [string, string];
}

// The deployed config-web roster projection predates teamWithPositionId. Keep this fallback deliberately
// narrow: these are the three BB2025 pair packages present in the fork roster XML. Once the API starts
// forwarding teamWithPositionId, the id-linked path below remains authoritative.
const KNOWN_PAIRS: readonly KnownPair[] = [
  { label: 'Grak & Crumbleberry', names: ['Grak', 'Crumbleberry'] },
  { label: 'Dribl & Drull', names: ['Dribl', 'Drull'] },
  { label: 'Valen & Lucien Swift', names: ['Valen Swift', 'Lucien Swift'] },
];

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

function knownPairForMembers(members: readonly TeamBuilderStarPosition[]): KnownPair | undefined {
  const names = new Set(members.map((member) => normalize(member.name)));
  return KNOWN_PAIRS.find((pair) => pair.names.every((name) => names.has(normalize(name))));
}

function choiceFor<Position extends TeamBuilderStarPosition>(
  members: Position[],
  knownPair?: KnownPair,
): TeamBuilderStarChoice<Position> {
  const ordered = knownPair
    ? knownPair.names.map((name) => members.find((member) => normalize(member.name) === normalize(name))!)
    : [...members].sort((left, right) => left.name.localeCompare(right.name));
  const ids = ordered.map((member) => member.positionId).sort();
  return {
    key: ids.join('|'),
    label: knownPair?.label ?? ordered.map((member) => member.name).join(' & '),
    members: ordered,
    cost: ordered.reduce((sum, member) => sum + member.cost, 0),
    paired: ordered.length > 1,
  };
}

/**
 * Collapse roster Star positions into the choices the Team Builder renders.
 *
 * Explicit upstream teamWithPositionId links win. The known-name fallback only compensates for the currently
 * deployed roster projection omitting that field. A broken explicit link, an incomplete known pair, or a
 * component larger than two is omitted: permitting a singleton would serialize an upstream-invalid hire.
 */
export function buildTeamBuilderStarChoices<Position extends TeamBuilderStarPosition>(
  positions: readonly Position[],
): TeamBuilderStarChoice<Position>[] {
  const stars = positions.filter((position) => position.isStar === true);
  const byId = new Map(stars.map((position) => [position.positionId, position]));
  const byName = new Map(stars.map((position) => [normalize(position.name), position]));
  const consumed = new Set<string>();
  const invalid = new Set<string>();
  const choices: TeamBuilderStarChoice<Position>[] = [];

  // First resolve the authoritative id graph. One-way links are accepted because older projections can be
  // asymmetric, but every declared destination must exist and every connected component must be exactly two.
  for (const star of stars) {
    const partnerId = star.teamWithPositionId?.trim();
    if (!partnerId || consumed.has(star.positionId) || invalid.has(star.positionId)) continue;
    const partner = byId.get(partnerId);
    if (!partner) {
      invalid.add(star.positionId);
      continue;
    }
    const linked = stars.filter((candidate) => (
      candidate.positionId === star.positionId
      || candidate.positionId === partner.positionId
      || candidate.teamWithPositionId === star.positionId
      || candidate.teamWithPositionId === partner.positionId
    ));
    const memberIds = new Set(linked.map((candidate) => candidate.positionId));
    const valid = linked.length === 2 && linked.every((candidate) => (
      !candidate.teamWithPositionId || memberIds.has(candidate.teamWithPositionId)
    ));
    if (!valid) {
      for (const candidate of linked) invalid.add(candidate.positionId);
      continue;
    }
    const known = knownPairForMembers(linked);
    choices.push(choiceFor(linked, known));
    for (const candidate of linked) consumed.add(candidate.positionId);
  }

  // Fail the whole canonical package closed if either member carried a broken explicit relationship.
  for (const pair of KNOWN_PAIRS) {
    const present = pair.names
      .map((name) => byName.get(normalize(name)))
      .filter((position): position is Position => position !== undefined);
    if (present.some((position) => invalid.has(position.positionId))) {
      for (const position of present) invalid.add(position.positionId);
    }
  }

  // Compatibility path for the current /api/fork/rosters response, which omits teamWithPositionId.
  for (const pair of KNOWN_PAIRS) {
    const members = pair.names.map((name) => byName.get(normalize(name)));
    const present = members.filter((position): position is Position => position !== undefined);
    if (present.length === 0) continue;
    if (present.length === 2 && present.every((position) => consumed.has(position.positionId))) continue;
    if (present.length !== 2 || present.some((position) => consumed.has(position.positionId) || invalid.has(position.positionId))) {
      for (const position of present) invalid.add(position.positionId);
      continue;
    }
    choices.push(choiceFor(present, pair));
    for (const position of present) consumed.add(position.positionId);
  }

  for (const star of stars) {
    if (consumed.has(star.positionId) || invalid.has(star.positionId)) continue;
    choices.push(choiceFor([star]));
  }
  return choices;
}

export function starChoiceMissingMembers<Position extends TeamBuilderStarPosition>(
  choice: TeamBuilderStarChoice<Position>,
  positionCount: (positionId: string) => number,
): Position[] {
  return choice.members.filter((member) => positionCount(member.positionId) === 0);
}

export function starChoiceIsComplete<Position extends TeamBuilderStarPosition>(
  choice: TeamBuilderStarChoice<Position>,
  positionCount: (positionId: string) => number,
): boolean {
  return choice.members.every((member) => positionCount(member.positionId) > 0);
}

/** Add every missing member in one immutable slot mutation, or change nothing when capacity is insufficient. */
export function addStarChoiceToSlots<
  Position extends TeamBuilderStarPosition,
  Slot extends TeamBuilderStarSlot,
>(
  slots: readonly (Slot | null)[],
  choice: TeamBuilderStarChoice<Position>,
  createSlot: (member: Position, index: number) => Slot,
): Array<Slot | null> {
  const counts = new Map<string, number>();
  for (const slot of slots) {
    if (slot) counts.set(slot.positionId, (counts.get(slot.positionId) ?? 0) + 1);
  }
  const missing = starChoiceMissingMembers(choice, (positionId) => counts.get(positionId) ?? 0);
  if (missing.length === 0) return slots as Array<Slot | null>;
  const open = slots.flatMap((slot, index) => slot === null ? [index] : []);
  if (open.length < missing.length) return slots as Array<Slot | null>;
  const next = [...slots];
  missing.forEach((member, memberIndex) => {
    const slotIndex = open[memberIndex]!;
    next[slotIndex] = createSlot(member, slotIndex);
  });
  return next;
}

/** Remove one complete package (or every present member of an incomplete legacy package) atomically. */
export function removeStarChoiceFromSlots<Slot extends TeamBuilderStarSlot>(
  slots: readonly (Slot | null)[],
  choice: TeamBuilderStarChoice,
): Array<Slot | null> {
  const next = [...slots];
  let changed = false;
  for (const member of choice.members) {
    for (let index = next.length - 1; index >= 0; index -= 1) {
      if (next[index]?.positionId !== member.positionId) continue;
      next[index] = null;
      changed = true;
      break;
    }
  }
  return changed ? next : slots as Array<Slot | null>;
}
