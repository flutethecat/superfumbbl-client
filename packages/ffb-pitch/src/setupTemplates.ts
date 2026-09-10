import { PITCH_ROWS } from './geometry';
import { normalizePositionName, ringTypeForName } from './positionTypes';
import {
  MAX_ON_PITCH,
  MAX_PER_WIDE_ZONE,
  MIN_ON_LOS,
  SETUP_LOS_X,
  isLeftWideColumn,
  isOnLos,
  isOwnHalf,
  isRightWideColumn,
  validateSetup,
  type SetupValidation,
} from './setup';

export type SetupTemplateSide = 'defense' | 'offense';
export type TemplateSlotPhase = 'los' | 'strength' | 'adjacent' | 'value';
export type PositionClass = 'lineman' | 'thrower' | 'blocker' | 'blitzer' | 'catcher' | 'bigguy';

export type SlotPredicate =
  | { readonly kind: 'anyAvailable' }
  | { readonly kind: 'positionClass'; readonly names: readonly string[] }
  | { readonly kind: 'highestStrength' }
  | { readonly kind: 'highestMovement' }
  | { readonly kind: 'lowestStrength' }
  | { readonly kind: 'strengthAtLeast'; readonly minimum: number }
  | { readonly kind: 'lowestArmour' }
  | { readonly kind: 'highestValue'; readonly excludePositionClasses?: readonly string[] }
  | { readonly kind: 'hasAnySkill'; readonly skills: readonly string[] }
  | { readonly kind: 'preferring'; readonly predicates: readonly SlotPredicate[] };

export interface TemplateSlot {
  id: string;
  square: readonly [number, number];
  predicate: SlotPredicate;
  phase: TemplateSlotPhase;
  anchorId?: string;
}

export interface SetupTemplate {
  id: string;
  name: string;
  side: SetupTemplateSide;
  symmetric: boolean;
  slots: readonly TemplateSlot[];
  notes?: readonly string[];
}

export interface TemplatePlayer {
  playerId: string;
  nr: number;
  positionName: string;
  ringType?: string;
  strength: number;
  movement: number;
  armour: number;
  cost: number;
  skills: readonly string[];
}

export interface TemplateLegalityOptions {
  maxPlayersOnField: number;
  maxPlayersInWideZone: number;
  minPlayersOnLos: number;
}

export interface ResolvedPlacement {
  playerId: string;
  slotId: string;
  coordinate: [number, number];
}

export interface TemplateResolution {
  placements: readonly ResolvedPlacement[];
  unplacedPlayerIds: readonly string[];
  validation: SetupValidation;
}

export interface SetupTemplateGameOption {
  gameOptionId: string;
  gameOptionValue: string;
}

export const slotPredicate = {
  anyAvailable: (): SlotPredicate => ({ kind: 'anyAvailable' }),
  positionClass: (...names: readonly string[]): SlotPredicate => ({ kind: 'positionClass', names }),
  highestStrength: (): SlotPredicate => ({ kind: 'highestStrength' }),
  highestMovement: (): SlotPredicate => ({ kind: 'highestMovement' }),
  lowestStrength: (): SlotPredicate => ({ kind: 'lowestStrength' }),
  strengthAtLeast: (minimum: number): SlotPredicate => ({ kind: 'strengthAtLeast', minimum }),
  lowestArmour: (): SlotPredicate => ({ kind: 'lowestArmour' }),
  highestValue: (): SlotPredicate => ({ kind: 'highestValue' }),
  hasAnySkill: (...skills: readonly string[]): SlotPredicate => ({ kind: 'hasAnySkill', skills }),
  preferring: (...predicates: readonly SlotPredicate[]): SlotPredicate => ({ kind: 'preferring', predicates }),
} as const;

const ANY = slotPredicate.anyAvailable();
const LINEMAN = slotPredicate.positionClass('lineman');
const HIGH_STRENGTH = slotPredicate.highestStrength();
const HIGH_MOVEMENT = slotPredicate.highestMovement();
const STRENGTH_FOUR = slotPredicate.strengthAtLeast(4);
const LOW_ARMOUR = slotPredicate.lowestArmour();
const HIGH_VALUE = slotPredicate.highestValue();
const HIGH_VALUE_NON_LINEMAN: SlotPredicate = { kind: 'highestValue', excludePositionClasses: ['lineman'] };
const BLOCK_OR_MOBILITY = slotPredicate.hasAnySkill('Block', 'Dodge', 'Sidestep');
const STR_OR_STABLE = slotPredicate.preferring(STRENGTH_FOUR, BLOCK_OR_MOBILITY);
const GUARD = slotPredicate.hasAnySkill('Guard');
const BALL_HANDLER = slotPredicate.preferring(
  slotPredicate.positionClass('thrower'),
  slotPredicate.hasAnySkill('Sure Hands', 'Catch'),
  HIGH_VALUE,
);
const RUNNER = slotPredicate.preferring(
  slotPredicate.positionClass('catcher', 'blitzer', 'thrower'),
  slotPredicate.hasAnySkill('Dodge', 'Sure Hands'),
  HIGH_VALUE,
);
const BLOCKER_OR_LINEMAN = slotPredicate.preferring(
  slotPredicate.positionClass('blocker'),
  LINEMAN,
);
const TTM_PAYLOAD = slotPredicate.preferring(
  slotPredicate.hasAnySkill('Stunty'),
  slotPredicate.positionClass('stunty', 'catcher', 'goblin', 'halfling', 'snotling', 'skink'),
  slotPredicate.lowestStrength(),
);
const ALL_IN_BALL_HANDLER = slotPredicate.preferring(
  slotPredicate.positionClass('thrower'),
  HIGH_VALUE_NON_LINEMAN,
);

/** A predicate score. `null` means the player does not match its filter. */
export function scorePlayerForPredicate(predicate: SlotPredicate, player: TemplatePlayer): number | null {
  switch (predicate.kind) {
    case 'anyAvailable': return 0;
    case 'positionClass': {
      const position = normalizePositionName(player.positionName);
      const ring = normalizePositionName(player.ringType ?? ringTypeForName(player.positionName) ?? '');
      const matches = predicate.names.some((name) => {
        const normal = normalizePositionName(name);
        return normal.length > 0 && (position === normal || position.includes(normal) || ring === normal);
      });
      return matches ? 1 : null;
    }
    case 'highestStrength': return player.strength;
    case 'highestMovement': return player.movement;
    case 'lowestStrength': return -player.strength;
    case 'strengthAtLeast': return player.strength >= predicate.minimum ? 1 : null;
    case 'lowestArmour': return -player.armour;
    case 'highestValue': {
      if (!predicate.excludePositionClasses?.length) return player.cost;
      const position = normalizePositionName(player.positionName);
      const ring = normalizePositionName(player.ringType ?? ringTypeForName(player.positionName) ?? '');
      const excluded = predicate.excludePositionClasses.some((name) => {
        const normal = normalizePositionName(name);
        return normal.length > 0 && (position === normal || position.includes(normal) || ring === normal);
      });
      return excluded ? null : player.cost;
    }
    case 'hasAnySkill': {
      const skills = new Set(player.skills.map(normalizePositionName));
      return predicate.skills.some((skill) => skills.has(normalizePositionName(skill))) ? 1 : null;
    }
    case 'preferring': {
      for (const preferred of predicate.predicates) {
        const score = scorePlayerForPredicate(preferred, player);
        if (score !== null) return score;
      }
      return null;
    }
  }
}

export function defaultLegalityOptions(): TemplateLegalityOptions {
  return {
    maxPlayersOnField: MAX_ON_PITCH,
    maxPlayersInWideZone: MAX_PER_WIDE_ZONE,
    minPlayersOnLos: MIN_ON_LOS,
  };
}

export function legalityOptionsFromGameOptions(
  gameOptionArray: readonly SetupTemplateGameOption[],
): TemplateLegalityOptions {
  const defaults = defaultLegalityOptions();
  const read = (id: keyof TemplateLegalityOptions): number => {
    const raw = gameOptionArray.find((option) => option.gameOptionId === id)?.gameOptionValue;
    if (raw === undefined || raw.trim() === '') return defaults[id];
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : defaults[id];
  };
  return {
    maxPlayersOnField: read('maxPlayersOnField'),
    maxPlayersInWideZone: read('maxPlayersInWideZone'),
    minPlayersOnLos: read('minPlayersOnLos'),
  };
}

function isCentralLos([x, y]: readonly [number, number]): boolean {
  return isOnLos(x) && !isLeftWideColumn(y) && !isRightWideColumn(y);
}

/** Mirrors SetupMechanic(bb2025):83-112 using the live GameOptions supplied by the caller. */
export function isPlacementLegal(
  coords: readonly (readonly [number, number])[],
  availableCount: number,
  opts: TemplateLegalityOptions = defaultLegalityOptions(),
): boolean {
  const required = Math.min(Math.max(0, availableCount), opts.maxPlayersOnField);
  const onLos = coords.filter(isCentralLos).length;
  const leftWide = coords.filter(([x, y]) => isOwnHalf(x) && isLeftWideColumn(y)).length;
  const rightWide = coords.filter(([x, y]) => isOwnHalf(x) && isRightWideColumn(y)).length;
  const unique = new Set(coords.map(([x, y]) => `${x},${y}`));
  // SetupMechanic:106 waives the minimum for a short roster; :112 puts every available player on the LoS.
  const requiredOnLos = availableCount < opts.minPlayersOnLos ? required : opts.minPlayersOnLos;
  return coords.length === required
    && coords.every(([x, y]) => isOwnHalf(x) && y >= 0 && y < PITCH_ROWS)
    && unique.size === coords.length
    && leftWide <= opts.maxPlayersInWideZone
    && rightWide <= opts.maxPlayersInWideZone
    && onLos >= requiredOnLos;
}

function compareIdentity(a: TemplatePlayer, b: TemplatePlayer): number {
  return a.nr - b.nr || a.playerId.localeCompare(b.playerId);
}

function compareValue(a: TemplatePlayer, b: TemplatePlayer): number {
  return b.cost - a.cost || a.armour - b.armour || compareIdentity(a, b);
}

function matchingPredicate(predicate: SlotPredicate, players: readonly TemplatePlayer[]): SlotPredicate | null {
  if (predicate.kind !== 'preferring') {
    return players.some((player) => scorePlayerForPredicate(predicate, player) !== null) ? predicate : null;
  }
  for (const preferred of predicate.predicates) {
    const match = matchingPredicate(preferred, players);
    if (match) return match;
  }
  return null;
}

function choosePlayer(predicate: SlotPredicate, players: readonly TemplatePlayer[]): TemplatePlayer {
  const matched = matchingPredicate(predicate, players);
  if (!matched) return [...players].sort(compareValue)[0]!;
  return [...players]
    .filter((player) => scorePlayerForPredicate(matched, player) !== null)
    .sort((a, b) => {
      if (matched.kind === 'highestValue') return compareValue(a, b);
      const aScore = scorePlayerForPredicate(matched, a) ?? 0;
      const bScore = scorePlayerForPredicate(matched, b) ?? 0;
      return bScore - aScore || (matched.kind === 'highestMovement' ? compareValue(a, b) : compareIdentity(a, b));
    })[0]!;
}

function orderedSlots(template: SetupTemplate): TemplateSlot[] {
  const phases: readonly TemplateSlotPhase[] = ['los', 'strength', 'adjacent', 'value'];
  const ordered: TemplateSlot[] = [];
  for (const phase of phases) {
    const pending = template.slots.filter((slot) => slot.phase === phase);
    if (phase !== 'adjacent') {
      ordered.push(...pending);
      continue;
    }
    const resolvedIds = new Set(ordered.map((slot) => slot.id));
    while (pending.length > 0) {
      const index = pending.findIndex((slot) => !slot.anchorId || resolvedIds.has(slot.anchorId));
      const [next] = pending.splice(index < 0 ? 0 : index, 1);
      ordered.push(next!);
      resolvedIds.add(next!.id);
    }
  }
  return ordered;
}

function validationForOptions(
  coords: readonly [number, number][],
  available: number,
  opts: TemplateLegalityOptions,
): SetupValidation {
  const base = validateSetup(coords, available);
  const required = Math.min(available, opts.maxPlayersOnField);
  const requiredOnLos = available < opts.minPlayersOnLos ? required : opts.minPlayersOnLos;
  const losOk = base.onLos >= requiredOnLos;
  const leftOk = base.leftWide <= opts.maxPlayersInWideZone;
  const rightOk = base.rightWide <= opts.maxPlayersInWideZone;
  const countOk = base.placed === required;
  return {
    ...base,
    available,
    required,
    losOk,
    leftOk,
    rightOk,
    countOk,
    valid: losOk && leftOk && rightOk && countOk,
  };
}

export function resolveTemplate(
  template: SetupTemplate,
  players: readonly TemplatePlayer[],
  opts: TemplateLegalityOptions = defaultLegalityOptions(),
): TemplateResolution {
  const remaining = [...players].sort(compareIdentity);
  const placements: ResolvedPlacement[] = [];
  const target = Math.min(remaining.length, opts.maxPlayersOnField);

  for (const slot of orderedSlots(template)) {
    if (placements.length >= target || remaining.length === 0) break;
    const [x, y] = slot.square;
    if (!isOwnHalf(x) || y < 0 || y >= PITCH_ROWS) continue;
    if (placements.some((placement) => placement.coordinate[0] === x && placement.coordinate[1] === y)) continue;
    const sameZoneCount = placements.filter((placement) => {
      const py = placement.coordinate[1];
      return (isLeftWideColumn(y) && isLeftWideColumn(py))
        || (isRightWideColumn(y) && isRightWideColumn(py));
    }).length;
    if ((isLeftWideColumn(y) || isRightWideColumn(y)) && sameZoneCount >= opts.maxPlayersInWideZone) continue;

    const player = choosePlayer(slot.predicate, remaining);
    remaining.splice(remaining.findIndex((candidate) => candidate.playerId === player.playerId), 1);
    placements.push({ playerId: player.playerId, slotId: slot.id, coordinate: [x, y] });
  }

  const placedIds = new Set(placements.map((placement) => placement.playerId));
  const unplacedPlayerIds = [...players]
    .filter((player) => !placedIds.has(player.playerId))
    .sort(compareIdentity)
    .map((player) => player.playerId);
  const coords = placements.map((placement) => placement.coordinate);
  return {
    placements,
    unplacedPlayerIds,
    validation: validationForOptions(coords, players.length, opts),
  };
}

export function mirrorTemplate(template: SetupTemplate): SetupTemplate {
  return {
    ...template,
    slots: template.slots.map((slot) => ({
      ...slot,
      square: [slot.square[0], PITCH_ROWS - 1 - slot.square[1]],
    })),
  };
}

const slot = (
  id: string,
  x: number,
  y: number,
  predicate: SlotPredicate,
  phase: TemplateSlotPhase,
  anchorId?: string,
): TemplateSlot => ({ id, square: [x, y], predicate, phase, ...(anchorId ? { anchorId } : {}) });

export const SETUP_TEMPLATES: readonly SetupTemplate[] = [
  {
    id: 'corners', name: 'Corners', side: 'defense', symmetric: true,
    slots: [
      slot('los-left', 12, 6, LINEMAN, 'los'), slot('los-centre', 12, 7, LINEMAN, 'los'),
      slot('los-right', 12, 8, LINEMAN, 'los'),
      slot('big-guy', 10, 7, HIGH_STRENGTH, 'strength'),
      slot('left-corner', 10, 5, STRENGTH_FOUR, 'strength'),
      slot('right-corner', 10, 9, STRENGTH_FOUR, 'strength'),
      slot('right-corner-mate', 10, 11, STR_OR_STABLE, 'strength'),
      slot('left-guard', 10, 3, GUARD, 'adjacent', 'left-corner'),
      slot('left-support', 9, 4, ANY, 'value'), slot('valuable', 9, 7, HIGH_VALUE, 'value'),
      slot('right-support', 9, 10, ANY, 'value'),
    ],
  },
  {
    id: 'the-boat', name: 'The Boat', side: 'defense', symmetric: true,
    notes: [
      'Owner moved the wings inboard from y=2/y=12 on 2026-08-12; exact landing squares pending owner eyeball-confirm on the next cut.',
    ],
    slots: [
      slot('los-left', 12, 6, LINEMAN, 'los'), slot('los-centre', 12, 7, LINEMAN, 'los'),
      slot('los-right', 12, 8, LINEMAN, 'los'),
      slot('left-wing', 10, 4, LINEMAN, 'strength'), slot('big-guy', 10, 7, HIGH_STRENGTH, 'strength'),
      slot('right-wing', 10, 10, LINEMAN, 'strength'),
      slot('cluster-left', 9, 5, HIGH_STRENGTH, 'value'), slot('cluster-inner-left', 9, 6, ANY, 'value'),
      slot('valuable', 9, 7, HIGH_VALUE, 'value'), slot('cluster-inner-right', 9, 8, ANY, 'value'),
      slot('cluster-right', 9, 9, HIGH_STRENGTH, 'value'),
    ],
  },
  {
    id: 'offset-boat', name: 'Offset Boat', side: 'defense', symmetric: false,
    slots: [
      slot('los-left', 12, 8, LINEMAN, 'los'), slot('los-centre', 12, 9, LINEMAN, 'los'),
      slot('los-right', 12, 10, LINEMAN, 'los'),
      slot('left-wing', 11, 3, LINEMAN, 'strength'), slot('big-guy', 10, 5, HIGH_STRENGTH, 'strength'),
      slot('right-wing', 10, 9, LINEMAN, 'strength'),
      slot('cluster-left', 9, 3, HIGH_STRENGTH, 'value'), slot('cluster-inner-left', 9, 4, ANY, 'value'),
      slot('valuable', 9, 5, HIGH_VALUE, 'value'), slot('cluster-inner-right', 9, 6, ANY, 'value'),
      slot('cluster-right', 9, 7, HIGH_STRENGTH, 'value'),
    ],
  },
  {
    id: 'offset-chevrons', name: 'Offset Chevrons', side: 'defense', symmetric: false,
    slots: [
      slot('los-left', 12, 7, LINEMAN, 'los'), slot('los-centre', 12, 8, LINEMAN, 'los'),
      slot('los-right', 12, 9, LINEMAN, 'los'),
      slot('anchor-left-centre', 10, 5, HIGH_STRENGTH, 'strength'),
      slot('anchor-far-left', 10, 2, STR_OR_STABLE, 'strength'),
      slot('anchor-centre', 10, 9, ANY, 'strength'), slot('anchor-far-right', 10, 12, STR_OR_STABLE, 'strength'),
      slot('backer-far-left', 9, 3, HIGH_VALUE, 'value'), slot('backer-left-centre', 9, 6, HIGH_VALUE, 'value'),
      slot('backer-centre', 9, 10, HIGH_VALUE, 'value'), slot('backer-far-right', 9, 13, HIGH_VALUE, 'value'),
    ],
  },
  {
    id: 'chevrons', name: 'Chevrons', side: 'defense', symmetric: true,
    slots: [
      slot('los-left', 12, 6, LINEMAN, 'los'), slot('los-centre', 12, 7, LINEMAN, 'los'),
      slot('los-right', 12, 8, LINEMAN, 'los'),
      slot('anchor-left-centre', 10, 5, HIGH_STRENGTH, 'strength'),
      slot('anchor-far-left', 10, 2, STR_OR_STABLE, 'strength'),
      slot('anchor-right-centre', 10, 9, ANY, 'strength'), slot('anchor-far-right', 10, 12, STR_OR_STABLE, 'strength'),
      slot('backer-far-left', 9, 1, HIGH_VALUE, 'value'), slot('backer-left-centre', 9, 4, HIGH_VALUE, 'value'),
      slot('backer-right-centre', 9, 10, HIGH_VALUE, 'value'), slot('backer-far-right', 9, 13, HIGH_VALUE, 'value'),
    ],
  },
  {
    id: 'max-pressure', name: 'Max Pressure', side: 'defense', symmetric: true,
    notes: [
      'Moved row+1 left outer from y=2 to y=4 and left inner to y=5; the drafted flank stack exceeded two in the left wide zone.',
      'Moved row+1 right outer from y=12 to y=10 and right inner to y=9; the drafted flank stack exceeded two in the right wide zone.',
    ],
    slots: [
      slot('los-left', 12, 6, LINEMAN, 'los'), slot('los-big-guy', 12, 7, HIGH_STRENGTH, 'los'),
      slot('los-right', 12, 8, LINEMAN, 'los'),
      slot('front-left-outer', 11, 4, STR_OR_STABLE, 'strength'), slot('front-left-inner', 11, 5, ANY, 'strength'),
      slot('front-right-inner', 11, 9, ANY, 'strength'), slot('front-right-outer', 11, 10, STR_OR_STABLE, 'strength'),
      slot('rear-left-outer', 10, 1, HIGH_VALUE, 'value'), slot('rear-left-inner', 10, 3, HIGH_VALUE, 'value'),
      slot('rear-right-inner', 10, 11, HIGH_VALUE, 'value'), slot('rear-right-outer', 10, 13, HIGH_VALUE, 'value'),
    ],
  },
  {
    id: 'ottd-frenzy', name: 'OTTD Defense — Frenzy', side: 'defense', symmetric: false,
    slots: [
      slot('los-left', 12, 6, LINEMAN, 'los'), slot('los-middle', 12, 8, LINEMAN, 'los'),
      slot('los-big-guy', 12, 9, HIGH_STRENGTH, 'los'),
      slot('right-diagonal-inner', 11, 10, ANY, 'strength'), slot('mid-left-wide', 10, 3, STR_OR_STABLE, 'strength'),
      slot('mid-left-centre', 10, 5, ANY, 'strength'), slot('mid-centre', 10, 8, ANY, 'strength'),
      slot('mid-right-centre', 10, 10, STR_OR_STABLE, 'strength'),
      slot('right-diagonal-valuable', 11, 12, HIGH_VALUE, 'value'),
      slot('deep-left', 8, 5, HIGH_VALUE, 'value'), slot('deep-centre', 8, 7, HIGH_VALUE, 'value'),
    ],
  },
  {
    id: 'ottd-no-frenzy', name: 'OTTD Defense — No Frenzy', side: 'defense', symmetric: false,
    slots: [
      slot('los-left', 12, 6, LINEMAN, 'los'), slot('los-middle', 12, 8, LINEMAN, 'los'),
      slot('los-big-guy', 12, 9, HIGH_STRENGTH, 'los'),
      slot('second-left-wide', 11, 3, STR_OR_STABLE, 'strength'), slot('second-left-edge', 11, 4, ANY, 'strength'),
      slot('second-left', 11, 5, ANY, 'strength'), slot('second-centre', 11, 7, ANY, 'strength'),
      slot('second-right', 11, 9, ANY, 'strength'), slot('second-right-edge', 11, 11, STR_OR_STABLE, 'strength'),
      slot('second-right-wide', 11, 13, ANY, 'strength'), slot('second-valuable', 11, 6, HIGH_VALUE, 'value'),
    ],
  },
  {
    id: 'ttm-defense', name: 'TTM Defense', side: 'defense', symmetric: true,
    slots: [
      slot('los-left', 12, 4, LINEMAN, 'los'), slot('los-centre', 12, 7, LINEMAN, 'los'),
      slot('los-right', 12, 10, LINEMAN, 'los'),
      slot('deep-big-guy', 4, 1, HIGH_STRENGTH, 'strength'),
      slot('middle-left', 7, 4, HIGH_VALUE, 'strength'), slot('middle-centre', 7, 7, ANY, 'strength'),
      slot('middle-right', 7, 10, ANY, 'strength'),
      slot('deep-left-centre', 4, 4, ANY, 'value'), slot('deep-centre', 4, 7, LOW_ARMOUR, 'value'),
      slot('deep-right-centre', 4, 10, ANY, 'value'), slot('deep-right', 4, 13, HIGH_VALUE, 'value'),
    ],
  },
  {
    id: 'anti-blitz', name: 'Anti-Blitz', side: 'offense', symmetric: false,
    slots: [
      slot('los-big-guy', 12, 8, HIGH_STRENGTH, 'los'), slot('los-left-centre', 12, 5, ANY, 'los'),
      slot('los-valuable', 12, 9, HIGH_VALUE, 'los'), slot('los-inner-left', 12, 6, ANY, 'los'),
      slot('los-wide-left', 12, 2, STR_OR_STABLE, 'los'), slot('los-wide-right', 12, 12, STR_OR_STABLE, 'los'),
      slot('second-left-wide', 11, 1, ANY, 'strength'), slot('second-left', 11, 4, ANY, 'strength'),
      slot('second-centre', 11, 7, ANY, 'strength'), slot('second-right', 11, 10, ANY, 'strength'),
      slot('second-right-wide', 11, 13, ANY, 'strength'),
    ],
  },
  {
    id: 'one-back', name: 'One Back', side: 'offense', symmetric: false,
    slots: [
      slot('los-big-guy', 12, 5, HIGH_STRENGTH, 'los'), slot('los-centre', 12, 7, ANY, 'los'),
      slot('los-right-centre', 12, 9, ANY, 'los'), slot('los-wide-left', 12, 2, ANY, 'los'),
      slot('los-left-inner', 12, 4, ANY, 'los'), slot('los-left-centre', 12, 6, ANY, 'los'),
      slot('los-right-inner', 12, 10, ANY, 'los'), slot('los-wide-right', 12, 12, ANY, 'los'),
      slot('left-edge-support', 11, 3, STR_OR_STABLE, 'strength'),
      slot('deep-ball-handler', 5, 7, BALL_HANDLER, 'value'),
      slot('right-wing-valuable', 11, 11, HIGH_VALUE, 'value'),
    ],
  },
  {
    id: 'two-back', name: 'Two Back', side: 'offense', symmetric: false,
    slots: [
      slot('los-big-guy', 12, 6, HIGH_STRENGTH, 'los'), slot('los-left-centre', 12, 4, ANY, 'los'),
      slot('los-centre', 12, 7, ANY, 'los'), slot('los-left-wide', 12, 3, ANY, 'los'),
      slot('los-inner-left', 12, 5, ANY, 'los'), slot('los-inner-right', 12, 9, ANY, 'los'),
      slot('los-right-wide', 12, 12, ANY, 'los'),
      slot('left-wing-support', 11, 2, STR_OR_STABLE, 'strength'),
      slot('right-wing-support', 11, 10, STR_OR_STABLE, 'strength'),
      slot('mid-back', 8, 7, RUNNER, 'value'), slot('deep-ball-handler', 5, 7, BALL_HANDLER, 'value'),
    ],
  },
  {
    id: 'ttm-offense', name: 'TTM', side: 'offense', symmetric: false,
    notes: [
      'The drafted groups totalled 12 players; retained both row+1 wide supports and reduced the deep landing group from three to two for an 11-player setup.',
    ],
    slots: [
      slot('los-left-outer', 12, 4, BLOCKER_OR_LINEMAN, 'los'),
      slot('los-left-inner', 12, 6, BLOCKER_OR_LINEMAN, 'los'),
      slot('los-right-inner', 12, 8, BLOCKER_OR_LINEMAN, 'los'),
      slot('los-right-outer', 12, 10, BLOCKER_OR_LINEMAN, 'los'),
      slot('ttm-grantor', 11, 7, HIGH_STRENGTH, 'strength'),
      slot('ttm-payload', 11, 8, TTM_PAYLOAD, 'adjacent', 'ttm-grantor'),
      slot('left-wide-support', 11, 0, STR_OR_STABLE, 'value'),
      slot('right-wide-support', 11, 14, STR_OR_STABLE, 'value'),
      slot('relay', 7, 7, RUNNER, 'value'),
      slot('deep-left-support', 2, 0, HIGH_VALUE, 'value'),
      slot('deep-right-support', 2, 14, HIGH_VALUE, 'value'),
    ],
  },
  {
    id: 'all-in', name: 'All-In', side: 'offense', symmetric: true,
    notes: [
      'Pulled the third left-wing LoS square inward from y=3 to y=4 to respect the two-player left wide-zone cap.',
      'Pulled the third right-wing LoS square inward from y=11 to y=10 to respect the two-player right wide-zone cap.',
    ],
    slots: [
      slot('los-big-guy', 12, 6, HIGH_STRENGTH, 'los'),
      slot('left-wing-inner', 12, 4, HIGH_MOVEMENT, 'los'),
      slot('right-wing-inner', 12, 10, HIGH_MOVEMENT, 'los'),
      slot('mid-thrower', 6, 7, ALL_IN_BALL_HANDLER, 'los'),
      slot('left-wing-outer', 12, 0, HIGH_MOVEMENT, 'los'),
      slot('right-wing-outer', 12, 14, HIGH_MOVEMENT, 'los'),
      slot('left-wing-middle', 12, 2, HIGH_MOVEMENT, 'los'),
      slot('right-wing-middle', 12, 12, HIGH_MOVEMENT, 'los'),
      slot('los-centre-left', 12, 5, ANY, 'los'),
      slot('los-centre-right', 12, 8, ANY, 'los'),
      slot('los-centre-remnant', 12, 9, ANY, 'los'),
    ],
  },
  {
    id: 'three-back', name: '3 Back', side: 'offense', symmetric: false,
    notes: [
      'Used three rather than four row+1 supports so the five-player LoS and all three mid-row backs fit the 11-player limit.',
    ],
    slots: [
      slot('los-big-guy', 12, 7, HIGH_STRENGTH, 'los'),
      slot('los-left-outer', 12, 4, BLOCKER_OR_LINEMAN, 'los'),
      slot('los-left-inner', 12, 5, BLOCKER_OR_LINEMAN, 'los'),
      slot('los-right-inner', 12, 9, BLOCKER_OR_LINEMAN, 'los'),
      slot('los-right-outer', 12, 10, BLOCKER_OR_LINEMAN, 'los'),
      slot('support-runner', 11, 3, RUNNER, 'strength'),
      slot('support-centre', 11, 7, STR_OR_STABLE, 'strength'),
      slot('support-valuable', 11, 11, HIGH_VALUE, 'strength'),
      slot('back-left', 6, 4, RUNNER, 'value'),
      slot('back-centre', 6, 7, BALL_HANDLER, 'value'),
      slot('back-right', 6, 10, HIGH_VALUE, 'value'),
    ],
  },
] as const;

export function setupTemplatesForSide(side: SetupTemplateSide): readonly SetupTemplate[] {
  return SETUP_TEMPLATES.filter((template) => template.side === side);
}
