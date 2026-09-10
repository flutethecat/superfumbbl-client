import {
  PITCH_ROWS,
  RING_TYPE_COLORS,
  SETUP_LOS_X,
  mirrorTemplate,
  ringTypeForName,
  type RingType,
  type SetupTemplate,
  type SlotPredicate,
} from '@fumbbl40k/ffb-pitch';

export interface PreviewToken {
  /** Authoritative setup coordinate retained for parity checks. */
  x: number;
  y: number;
  /** Display-only card coordinates: LoS at the top, own end zone at the bottom. */
  row: number;
  column: number;
  color: string;
  slotId: string;
}

export interface TemplatePreview {
  tokens: PreviewToken[];
  cols: number;
  rows: number;
  losRow: number;
}

const POSITION_CLASS_RINGS: Partial<Record<string, RingType>> = {
  lineman: 'lineman',
  thrower: 'thrower',
  blocker: 'blocker',
  blitzer: 'blitzer',
  catcher: 'catcher',
  bigguy: 'bigguy',
};

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function ringForPredicate(predicate: SlotPredicate): RingType | null {
  switch (predicate.kind) {
    case 'positionClass':
      for (const name of predicate.names) {
        const ring = POSITION_CLASS_RINGS[normalized(name)] ?? ringTypeForName(name);
        if (ring) return ring;
      }
      return null;
    case 'highestStrength':
    case 'strengthAtLeast':
      return 'bigguy';
    case 'highestMovement':
    case 'lowestStrength':
    case 'lowestArmour':
      return 'catcher';
    case 'highestValue':
      return 'special';
    case 'hasAnySkill': {
      const skills = new Set(predicate.skills.map(normalized));
      if (skills.has('pass') || skills.has('surehands')) return 'thrower';
      if (skills.has('catch') || skills.has('dodge') || skills.has('sidestep') || skills.has('stunty')) return 'catcher';
      if (skills.has('guard') || skills.has('block')) return 'blocker';
      return null;
    }
    case 'preferring':
      for (const preferred of predicate.predicates) {
        const ring = ringForPredicate(preferred);
        if (ring) return ring;
      }
      return null;
    case 'anyAvailable':
      return null;
  }
}

function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** SPEC setup-templates §1 (Madden panel): roster-independent slot projection. */
export function templatePreview(template: SetupTemplate, mirrored = false): TemplatePreview {
  const projected = mirrored ? mirrorTemplate(template) : template;
  return {
    tokens: projected.slots.map((slot) => ({
      x: slot.square[0],
      y: slot.square[1],
      row: SETUP_LOS_X - slot.square[0],
      column: slot.square[1],
      color: cssHex(RING_TYPE_COLORS[ringForPredicate(slot.predicate) ?? 'lineman']),
      slotId: slot.id,
    })),
    cols: PITCH_ROWS,
    rows: SETUP_LOS_X + 1,
    losRow: 0,
  };
}

/** Project known saved coordinates through the same card preview engine as predicate templates. */
export function savedSetupPreview(coordinates: readonly (readonly [number, number])[]): TemplatePreview {
  return templatePreview({
    id: 'saved-setup',
    name: 'Saved setup',
    side: 'defense',
    symmetric: false,
    slots: coordinates.map((square, index) => ({
      id: `saved-${index}`,
      square,
      predicate: { kind: 'anyAvailable' },
      phase: 'value',
    })),
  });
}
