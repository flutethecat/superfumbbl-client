import { NetCommandId } from '@fumbbl40k/ffb-protocol';
import {
  assertDecisionAuthority,
  type DecisionAuthority,
} from './inducementPurchase';
import type { InducementType } from './railRegistryKeys.generated';
import { composedChoiceLabel, directTeamChoices, genericDriveBonusName, hasDriveBonusOrLeader, mascotChoices, proChoices, teamPartBadge } from './teamReRollComposer';

export interface RegenerationReRollOptionsWire {
  reRollProperties?: readonly string[];
  skill?: string | null;
}

interface RegenerationOfferBase {
  commandNr: number;
  teamId: string;
  playerIds: readonly string[];
  authority: DecisionAuthority;
}

export type RegenerationElectionOffer =
  | (RegenerationOfferBase & { kind: 'inducement'; inducementType: InducementType | null })
  | (RegenerationOfferBase & { kind: 'reRoll'; reRollOptions: readonly RegenerationReRollOptionsWire[] });

export type RegenerationElectionChoice =
  | { kind: 'decline' }
  | { kind: 'inducement'; playerId: string }
  /** `label`: set for the current server's named team answers (a drive bonus / Leader / Mascot fallback); else the
   *  source is shown as it is today. */
  | { kind: 'reRoll'; playerId: string; reRollSource: string; label?: string; info?: string; badgeTag?: string; badgeSkill?: 'Leader'; badgeName?: string };

export type RegenerationElectionCommand =
  | {
    netCommandId: typeof NetCommandId.CLIENT_USE_INDUCEMENT;
    inducementType: InducementType | null;
    playerIds: string[];
    card: null;
  }
  | {
    netCommandId: typeof NetCommandId.CLIENT_USE_RE_ROLL_FOR_TARGET;
    reRolledAction: 'Regeneration';
    reRollSource: string | null;
    playerId: string | null;
  };

export function regenerationElectionKey(commandNr: number): string {
  if (!Number.isInteger(commandNr) || commandNr < 0) throw new Error('invalid regeneration command number');
  return `reRollRegenerationMultiple:${commandNr}`;
}

function properties(option: RegenerationReRollOptionsWire): Set<string> {
  return new Set((option.reRollProperties ?? []).map((property) => String(property).toUpperCase()));
}

function teamReRollSource(first: RegenerationReRollOptionsWire | undefined): string {
  const offered = first ? properties(first) : new Set<string>();
  // DialogExtensionMascot.java:22-40 defines this exact precedence; the names
  // serialized by those sources are fixed in ReRollSources.java:9-10,29-30,37-38.
  if (offered.has('BRILLIANT_COACHING')) return 'Brilliant Coaching ReRoll';
  if (offered.has('PUMP_UP_THE_CROWD')) return 'Pump up the Crowd';
  if (offered.has('SHOW_STAR')) return 'Star of the Show';
  if (offered.has('MASCOT')) return 'Team Mascot';
  return 'Team ReRoll';
}

/**
 * Port of DialogReRollRegenerationMultiple.java:76-210. The parameter's
 * playerIds and same-index reRollOptions are the complete offer
 * (DialogReRollRegenerationMultipleParameter.java:71-80).
 */
export function regenerationElectionChoices(
  offer: RegenerationElectionOffer,
  driveBonus?: () => string,
): RegenerationElectionChoice[] {
  if (offer.kind === 'inducement') {
    return [
      ...offer.playerIds.map((playerId) => ({ kind: 'inducement' as const, playerId })),
      { kind: 'decline' as const },
    ];
  }

  const choices: RegenerationElectionChoice[] = [];
  const sharedTeamSource = teamReRollSource(offer.reRollOptions[0]);
  const mascot = sharedTeamSource === 'Team Mascot';
  offer.playerIds.forEach((playerId, index) => {
    const option = offer.reRollOptions[index];
    if (!option) return;
    const offered = properties(option);
    // ReRollOptions.java:29,40-41: only actual properties or a skill make a row selectable.
    const canActuallyReRoll = ['TRR', 'MASCOT', 'PRO'].some((property) => offered.has(property))
      || Boolean(option.skill);
    if (!canActuallyReRoll) return;
    const rowProperties = [...offered];
    if (hasDriveBonusOrLeader(rowProperties)) {
      // Current server (c66198ac4 DialogReRollRegenerationMultiple:122-123 + handler :47, selectTeamReRoll per target):
      // this row's own team options (Mascot, drive bonus, Leader; no plain team reroll beside them), Pro with its
      // fallbacks, then the skill. Every answer of the fallback question is its own choice.
      const name = driveBonus ?? genericDriveBonusName;
      // Owner 11-21: a drive bonus answer reads as the Team reroll; its "i" text names the bonus (driveBonusInfo).
      const push = (c: ReturnType<typeof proChoices>[number]) => {
        choices.push({ kind: 'reRoll', playerId, reRollSource: c.source, label: composedChoiceLabel(c, name), ...teamPartBadge(c, name) });
      };
      [...mascotChoices(rowProperties), ...directTeamChoices(rowProperties)].forEach(push);
      if (offered.has('PRO')) proChoices(rowProperties).forEach(push);
      if (option.skill) choices.push({ kind: 'reRoll', playerId, reRollSource: option.skill });
      return;
    }
    if (mascot) {
      choices.push({ kind: 'reRoll', playerId, reRollSource: 'Team Mascot' });
      if (offered.has('TRR')) choices.push({ kind: 'reRoll', playerId, reRollSource: 'Mascot TRR' });
      // Owner 11-25: the plain Team reroll beside the Mascot choices (upstream DialogReRollRegenerationMultiple:122-127,
      // teamReRollSources(options, true): Mascot, then TRR).
      if (offered.has('TRR')) choices.push({ kind: 'reRoll', playerId, reRollSource: 'Team ReRoll' });
    } else if (offered.has('TRR')) {
      choices.push({ kind: 'reRoll', playerId, reRollSource: sharedTeamSource });
    }
    if (offered.has('PRO')) choices.push({ kind: 'reRoll', playerId, reRollSource: 'Pro' });
    // The three SINGLE_DIE skills registered upstream use a ReRollSource with
    // the same name serialized in ReRollOptions.skill (ThinkingMansTroll.java:22,28;
    // HalflingLuck.java:22,28; ConsummateProfessional.java:21,27).
    if (option.skill) choices.push({ kind: 'reRoll', playerId, reRollSource: option.skill });
  });
  choices.push({ kind: 'decline' });
  return choices;
}

/**
 * Inducement arm: handler lines 47-48 calls sendUseInducement(type,target),
 * serialized as inducementType/playerIds/card by ClientCommandUseInducement.java:92-97.
 * Re-roll arm: handler lines 43-45 sends action Regeneration, elected source,
 * and target; ClientCommandUseReRoll.java:44-48 plus
 * ClientCommandUseReRollForTarget.java:33-36 define the exact frame, and
 * ReRolledActions.java:77 defines the exact action name. A No
 * Re-Roll close leaves target/source null (AbstractDialogForTargets.java:28-37).
 */
export function buildRegenerationElectionCommand(
  offer: RegenerationElectionOffer,
  choice: RegenerationElectionChoice,
): RegenerationElectionCommand {
  assertDecisionAuthority(offer.authority, offer.teamId);
  const offered = regenerationElectionChoices(offer);
  const valid = offered.some((candidate) => candidate.kind === choice.kind
    && (candidate.kind === 'decline' || (
      candidate.playerId === (choice as { playerId: string }).playerId
      && (candidate.kind !== 'reRoll'
        || candidate.reRollSource === (choice as { reRollSource: string }).reRollSource)
    )));
  if (!valid) throw new Error('regeneration choice was not offered');

  if (offer.kind === 'inducement') {
    if (choice.kind !== 'decline' && choice.kind !== 'inducement') {
      throw new Error('regeneration choice does not match the offer');
    }
    return {
      netCommandId: NetCommandId.CLIENT_USE_INDUCEMENT,
      inducementType: offer.inducementType,
      playerIds: choice.kind === 'inducement' ? [choice.playerId] : [],
      card: null,
    };
  }
  if (choice.kind !== 'decline' && choice.kind !== 'reRoll') {
    throw new Error('regeneration choice does not match the offer');
  }
  return {
    netCommandId: NetCommandId.CLIENT_USE_RE_ROLL_FOR_TARGET,
    reRolledAction: 'Regeneration',
    reRollSource: choice.kind === 'reRoll' ? choice.reRollSource : null,
    playerId: choice.kind === 'reRoll' ? choice.playerId : null,
  };
}
