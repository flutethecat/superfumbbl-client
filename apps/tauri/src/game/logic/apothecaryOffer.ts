import {
  NetCommandId,
  buildApothecaryDecline as buildProtocolApothecaryDecline,
} from '@fumbbl40k/ffb-protocol';

export const APOTHECARY_TYPES = ['TEAM', 'WANDERING', 'PLAGUE'] as const;
export type ApothecaryType = typeof APOTHECARY_TYPES[number];
export type ApothecaryOutcome = 'stay' | 'reserves' | 'building';
export type ApothecaryAudience = 'player' | 'spectator' | 'replay';

export const APOTHECARY_TYPE_LABELS: Readonly<Record<ApothecaryType, string>> = Object.freeze({
  TEAM: 'Team Apothecary',
  WANDERING: 'Wandering Apothecary',
  PLAGUE: 'Plague Doctor',
});

export interface ApothecaryInjuryOffer {
  playerId: string;
  playerState: unknown;
  seriousInjury: unknown;
  offeredTypes: readonly ApothecaryType[];
  base: number;
  outcome: ApothecaryOutcome;
  injury: string;
}

export interface ApothecaryOffer {
  kind: 'single' | 'multiple';
  dialogId: 'useApothecary' | 'useApothecaries';
  teamId: string | null;
  injuries: readonly ApothecaryInjuryOffer[];
  offerKey: string;
}

export interface ApothecaryElectionPrompt extends ApothecaryOffer {
  key: string;
  occurrenceKey: string;
  mine: boolean;
}

export type ApothecaryDecision =
  | { kind: 'use'; injuryIndex: number; apothecaryType?: ApothecaryType }
  | { kind: 'none' };

export type ApothecaryCommand =
  | {
      netCommandId: typeof NetCommandId.CLIENT_USE_APOTHECARY;
      playerId: string;
      apothecaryUsed: boolean;
      apothecaryType?: ApothecaryType;
      seriousInjury?: unknown;
      playerState?: unknown;
    }
  | {
      netCommandId: typeof NetCommandId.CLIENT_USE_APOTHECARIES;
      injuryDescriptions: [];
    };

export interface ApothecaryAuthorityContext {
  audience: ApothecaryAudience;
  myTeamId: string | null | undefined;
  myPlayerIds: ReadonlySet<string>;
}

const INJURY_LABELS: Readonly<Record<number, string>> = Object.freeze({
  0x04: 'STUNNED',
  0x05: 'KNOCKED OUT',
  0x06: 'BADLY HURT',
  0x07: 'SERIOUS INJURY',
  0x08: 'DEAD',
});

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function diagnosticValue(value: unknown): string {
  try { return JSON.stringify(value); }
  catch { return String(value); }
}

function fail(loud: (message: string) => void, message: string): null {
  loud(`apothecary election: ${message}`);
  return null;
}

export function isApothecaryType(value: unknown): value is ApothecaryType {
  return typeof value === 'string' && (APOTHECARY_TYPES as readonly string[]).includes(value);
}

export function apothecaryTypeLabel(type: ApothecaryType): string {
  return APOTHECARY_TYPE_LABELS[type];
}

export function apothecaryTypeOptions(types: readonly ApothecaryType[], legacyUntyped = false): readonly {
  type: ApothecaryType | null;
  label: string;
}[] {
  if (legacyUntyped && types.length === 0) return [Object.freeze({ type: null, label: 'Use' })];
  return types.map((type) => Object.freeze({ type, label: apothecaryTypeLabel(type) }));
}

export function apothecaryNoneLabel(offer: Pick<ApothecaryOffer, 'kind' | 'injuries'>): 'Decline' | 'None' {
  return offer.kind === 'single' && (offer.injuries[0]?.offeredTypes.length ?? 0) <= 1 ? 'Decline' : 'None';
}

export function apothecaryPromptVisible(
  playActive: boolean,
  hasMountedSurface: boolean,
): boolean {
  return !playActive || hasMountedSurface;
}

export function playerStateBase(value: unknown): number | null {
  if (typeof value === 'number') return value & 0xff;
  if (value && typeof value === 'object') {
    const state = value as { id?: unknown; base?: unknown };
    const base = state.id ?? state.base;
    if (typeof base === 'number') return base & 0xff;
  }
  return null;
}

function parseTypes(
  value: unknown,
  path: string,
  allowEmpty: boolean,
  loud: (message: string) => void,
): readonly ApothecaryType[] | null {
  if (!Array.isArray(value) || (!allowEmpty && value.length < 1)) {
    return fail(loud, `${path} must be ${allowEmpty ? 'an' : 'a non-empty'} array; got ${diagnosticValue(value)}`);
  }
  const types: ApothecaryType[] = [];
  for (const offered of value) {
    if (!isApothecaryType(offered)) {
      return fail(loud, `${path} contains unknown type ${diagnosticValue(offered)}`);
    }
    if (types.includes(offered)) {
      return fail(loud, `${path} contains duplicate type ${diagnosticValue(offered)}`);
    }
    types.push(offered);
  }
  return Object.freeze(types);
}

function parseInjury(
  value: unknown,
  path: string,
  fallbackBase: number,
  allowEmptyTypes: boolean,
  projectSingleTypes: boolean,
  loud: (message: string) => void,
): ApothecaryInjuryOffer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail(loud, `${path} must be an injury object; got ${diagnosticValue(value)}`);
  }
  const raw = value as Record<string, unknown>;
  const playerId = typeof raw.playerId === 'string' ? raw.playerId : '';
  if (!playerId) return fail(loud, `${path}.playerId is missing`);
  if (!hasOwn(raw, 'playerState')) return fail(loud, `${path}.playerState is missing`);
  if (!hasOwn(raw, 'seriousInjury')) return fail(loud, `${path}.seriousInjury is missing`);
  const parsedTypes = parseTypes(raw.apothecaryTypes, `${path}.apothecaryTypes`, allowEmptyTypes, loud);
  if (!parsedTypes) return null;
  // Upstream's single dialog exposes only the first two buttons; the multi dialog renders every received type.
  const offeredTypes = projectSingleTypes ? Object.freeze(parsedTypes.slice(0, 2)) : parsedTypes;
  const base = playerStateBase(raw.playerState) ?? (fallbackBase & 0xff);
  const seriousInjury = typeof raw.seriousInjury === 'string'
    ? raw.seriousInjury
    : raw.seriousInjury && typeof raw.seriousInjury === 'object'
      ? String((raw.seriousInjury as { description?: unknown }).description ?? '')
      : '';
  return Object.freeze({
    playerId,
    playerState: raw.playerState,
    seriousInjury: raw.seriousInjury,
    offeredTypes,
    base,
    outcome: base === 0x05 ? 'stay' : base === 0x06 ? 'reserves' : 'building',
    injury: seriousInjury || INJURY_LABELS[base] || 'INJURED',
  });
}

function offerIdentity(kind: ApothecaryOffer['kind'], teamId: string | null, injuries: readonly ApothecaryInjuryOffer[]): string {
  return JSON.stringify({
    kind,
    teamId,
    injuries: injuries.map((injury) => ({
      playerId: injury.playerId,
      playerState: injury.playerState,
      seriousInjury: injury.seriousInjury,
      apothecaryTypes: injury.offeredTypes,
    })),
  });
}

/** Parse the server dialog as-is. It validates vocabulary and never predicts availability. */
export function parseApothecaryOffer(
  dialog: Record<string, unknown>,
  fallbackBase: number | Readonly<Record<string, number>> = 0,
  loud: (message: string) => void = console.error,
): ApothecaryOffer | null {
  if (dialog.dialogId === 'useApothecary') {
    const playerId = typeof dialog.playerId === 'string' ? dialog.playerId : '';
    const base = typeof fallbackBase === 'number' ? fallbackBase : (fallbackBase[playerId] ?? 0);
    const injury = parseInjury(dialog, 'useApothecary', base, true, true, loud);
    if (!injury) return null;
    const injuries = Object.freeze([injury]);
    return Object.freeze({
      kind: 'single', dialogId: 'useApothecary', teamId: null, injuries,
      offerKey: offerIdentity('single', null, injuries),
    });
  }

  if (dialog.dialogId === 'useApothecaries') {
    const teamId = typeof dialog.teamId === 'string' ? dialog.teamId : '';
    if (!teamId) return fail(loud, 'useApothecaries.teamId is missing');
    if (!Array.isArray(dialog.injuryDescriptions) || dialog.injuryDescriptions.length === 0) {
      return fail(loud, `useApothecaries.injuryDescriptions must be non-empty; got ${diagnosticValue(dialog.injuryDescriptions)}`);
    }
    const injuries: ApothecaryInjuryOffer[] = [];
    for (let index = 0; index < dialog.injuryDescriptions.length; index += 1) {
      const raw = dialog.injuryDescriptions[index] as Record<string, unknown> | null;
      const playerId = typeof raw?.playerId === 'string' ? raw.playerId : '';
      const base = typeof fallbackBase === 'number' ? fallbackBase : (fallbackBase[playerId] ?? 0);
      const injury = parseInjury(raw, `useApothecaries.injuryDescriptions[${index}]`, base, false, false, loud);
      if (!injury) return null;
      injuries.push(injury);
    }
    const frozen = Object.freeze(injuries);
    return Object.freeze({
      kind: 'multiple', dialogId: 'useApothecaries', teamId, injuries: frozen,
      offerKey: offerIdentity('multiple', teamId, frozen),
    });
  }

  return null;
}

/** Backward-compatible single-dialog adapter; now preserves every ordered offered type. */
export function useApothecaryPrompt(
  dialog: Record<string, unknown>,
  fallbackBase = 0,
  loud: (message: string) => void = console.error,
): ApothecaryInjuryOffer | null {
  return parseApothecaryOffer(dialog, fallbackBase, loud)?.injuries[0] ?? null;
}

export function ownsApothecaryOffer(
  offer: ApothecaryOffer,
  authority: ApothecaryAuthorityContext,
): boolean {
  if (authority.audience !== 'player') return false;
  if (offer.kind === 'multiple') return !!authority.myTeamId && offer.teamId === authority.myTeamId;
  return authority.myPlayerIds.has(offer.injuries[0]!.playerId);
}

function buildDecisionCommand(offer: ApothecaryOffer, decision: ApothecaryDecision): ApothecaryCommand | null {
  if (decision.kind === 'none') {
    return buildProtocolApothecaryDecline(offer.kind === 'multiple'
      ? { dialogId: offer.dialogId }
      : { dialogId: offer.dialogId, playerId: offer.injuries[0]!.playerId });
  }

  const injury = offer.injuries[decision.injuryIndex];
  if (!injury) return null;
  const untypedLegacySingle = offer.kind === 'single' && injury.offeredTypes.length === 0 && decision.apothecaryType == null;
  if (!untypedLegacySingle && (!decision.apothecaryType || !injury.offeredTypes.includes(decision.apothecaryType))) return null;
  if (offer.kind === 'single') {
    return {
      netCommandId: NetCommandId.CLIENT_USE_APOTHECARY,
      playerId: injury.playerId,
      apothecaryUsed: true,
      ...(decision.apothecaryType ? { apothecaryType: decision.apothecaryType } : {}),
    };
  }
  return {
    netCommandId: NetCommandId.CLIENT_USE_APOTHECARY,
    playerId: injury.playerId,
    apothecaryUsed: true,
    apothecaryType: decision.apothecaryType!,
    seriousInjury: injury.seriousInjury,
    playerState: injury.playerState,
  };
}

/** Safe automatic response for non-UI drivers. Invalid server payloads fail closed. */
export function buildHeadlessApothecaryDecline(
  dialog: Record<string, unknown>,
  loud: (message: string) => void = console.error,
): ApothecaryCommand | null {
  const offer = parseApothecaryOffer(dialog, 0, loud);
  return offer ? buildProtocolApothecaryDecline(dialog, loud) : null;
}

/** Owns one live election and rejects duplicate, stale, replaced, or unauthorized answers. */
export class ApothecaryElectionController {
  private active: ApothecaryElectionPrompt | null = null;
  private answeredKey: string | null = null;

  arm(
    dialog: Record<string, unknown>,
    occurrenceKey: string,
    authority: ApothecaryAuthorityContext,
    fallbackBase: number | Readonly<Record<string, number>> = 0,
    loud: (message: string) => void = console.error,
  ): ApothecaryElectionPrompt | null {
    const offer = parseApothecaryOffer(dialog, fallbackBase, loud);
    if (!offer || !occurrenceKey) {
      this.active = null;
      return null;
    }
    const key = `${occurrenceKey}|${offer.offerKey}`;
    if (this.answeredKey === key) return null;
    this.active = Object.freeze({
      ...offer,
      key,
      occurrenceKey,
      mine: ownsApothecaryOffer(offer, authority),
    });
    return this.active;
  }

  answer(
    promptKey: string,
    decision: ApothecaryDecision,
    liveDialog: Record<string, unknown> | null | undefined,
    liveOccurrenceKey: string | null | undefined,
    authority: ApothecaryAuthorityContext,
    loud: (message: string) => void = console.error,
  ): ApothecaryCommand | null {
    const active = this.active;
    if (!active || active.key !== promptKey || this.answeredKey === active.key) return null;
    if (!active.mine || !ownsApothecaryOffer(active, authority)) return null;
    if (!liveDialog || liveOccurrenceKey !== active.occurrenceKey) return null;
    const live = parseApothecaryOffer(liveDialog, 0, loud);
    if (!live || live.offerKey !== active.offerKey) return null;
    const command = buildDecisionCommand(active, decision);
    if (!command) return null;
    return command;
  }

  /** Commit the one-shot latch only after the caller confirms transport accepted the command. */
  commitAnswered(promptKey: string): boolean {
    if (!this.active || this.active.key !== promptKey || this.answeredKey === promptKey) return false;
    this.answeredKey = promptKey;
    return true;
  }

  clear(): void {
    this.active = null;
    this.answeredKey = null;
  }

  current(): ApothecaryElectionPrompt | null {
    return this.active;
  }
}
