import { NetCommandId } from '@fumbbl40k/ffb-protocol';
import { INDUCEMENT_TYPES, type InducementType } from './railRegistryKeys.generated';
import {
  assertDecisionAuthority,
  type DecisionAuthority,
} from './inducementPurchase';

/**
 * Runtime intake of docs/inducement-upstream-parity-audit.md:69-77 and
 * docs/inducement-controller.proposed.ts:322-354.
 *
 * DialogUseInducementParameter.toJsonValue() serializes every offered type,
 * card name, and optional playerId (Java lines 81-98). The response mirrors
 * ClientCommandUseInducement.toJsonValue() property-for-property (lines 92-97).
 */

const INDUCEMENT_TYPE_SET: ReadonlySet<string> = new Set(INDUCEMENT_TYPES);

export interface UseInducementOffer {
  commandNr: number;
  teamId: string;
  inducementTypeArray: InducementType[];
  cards: string[];
  playerId: string | null;
  authority: DecisionAuthority;
}

export type UseInducementChoice =
  | { kind: 'inducement'; value: InducementType }
  | { kind: 'card'; value: string }
  | { kind: 'decline' };

export interface UseInducementCommand extends Record<string, unknown> {
  netCommandId: typeof NetCommandId.CLIENT_USE_INDUCEMENT;
  inducementType: InducementType | null;
  playerIds: string[];
  card: string | null;
}

export interface BribesOffer {
  teamId: string;
  playerIds: readonly string[];
  maxNrOfBribes: number;
  authority: DecisionAuthority;
}

export function isInducementType(value: string): value is InducementType {
  return INDUCEMENT_TYPE_SET.has(value);
}

/** A parking-dialog instance is identified by the command that opened it. */
export function useInducementKey(commandNr: number): string {
  if (!Number.isInteger(commandNr) || commandNr < 0) throw new Error('invalid use-inducement command number');
  return `useInducement:${commandNr}`;
}

export function useInducementChoices(offer: UseInducementOffer): UseInducementChoice[] {
  return [
    ...offer.inducementTypeArray.map((value) => ({ kind: 'inducement' as const, value })),
    ...offer.cards.map((value) => ({ kind: 'card' as const, value })),
    { kind: 'decline' as const },
  ];
}

export function buildUseInducementCommand(
  offer: UseInducementOffer,
  choice: UseInducementChoice,
): UseInducementCommand {
  assertDecisionAuthority(offer.authority, offer.teamId);
  if (choice.kind === 'inducement' && !offer.inducementTypeArray.includes(choice.value)) {
    throw new Error('inducement was not offered');
  }
  if (choice.kind === 'card' && !offer.cards.includes(choice.value)) {
    throw new Error('card was not offered');
  }

  return {
    netCommandId: NetCommandId.CLIENT_USE_INDUCEMENT,
    inducementType: choice.kind === 'inducement' ? choice.value : null,
    // Upstream keeps the dialog target only for an inducement election. A card
    // is the other arm of the response union and therefore carries no players.
    playerIds: choice.kind === 'inducement' && offer.playerId ? [offer.playerId] : [],
    card: choice.kind === 'card' ? choice.value : null,
  };
}

/**
 * Build the response to DialogBribesParameter, whose offer is playerIds plus
 * maxNrOfBribes (ffb-common/.../DialogBribesParameter.java:75-80), not a
 * DialogUseInducementParameter type/card union. Upstream answers both arms with
 * the bribes inducement type and distinguishes spend from decline solely by
 * selected player ids (ffb-client-logic/.../DialogBribesHandler.java:69-80;
 * ffb-server/.../bb2025/foul/StepBribes.java:107-113). The exact response fields
 * come from ffb-common/.../ClientCommandUseInducement.java:92-97.
 */
export function buildBribesCommand(
  offer: BribesOffer,
  selectedPlayerIds: readonly string[],
): UseInducementCommand {
  assertDecisionAuthority(offer.authority, offer.teamId);
  if (!Number.isInteger(offer.maxNrOfBribes) || offer.maxNrOfBribes < 0) {
    throw new Error('invalid maximum number of bribes');
  }
  if (selectedPlayerIds.length > offer.maxNrOfBribes) {
    throw new Error('too many bribe targets selected');
  }
  const offeredPlayerIds = new Set(offer.playerIds);
  if (new Set(selectedPlayerIds).size !== selectedPlayerIds.length) {
    throw new Error('duplicate bribe target selected');
  }
  if (selectedPlayerIds.some((playerId) => !offeredPlayerIds.has(playerId))) {
    throw new Error('bribe target was not offered');
  }

  return {
    netCommandId: NetCommandId.CLIENT_USE_INDUCEMENT,
    inducementType: 'bribes',
    playerIds: [...selectedPlayerIds],
    card: null,
  };
}
