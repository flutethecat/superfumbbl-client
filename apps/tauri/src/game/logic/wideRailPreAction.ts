/**
 * Source-pinned property map for BB2025 specials offered after an ordinary
 * PlayerAction has been accepted. Runtime ownership stays in the existing
 * declare/model/view/store flow; this module only records exact action-family
 * membership and wire vocabulary.
 */
import type { PlayerAction } from '../railRegistryKeys.generated';

export type WideRailPreActionRuleId =
  | 'treacherous'
  | 'wisdomOfTheWhiteDwarf'
  | 'raidingParty'
  | 'lookIntoMyEyes'
  | 'balefulHex'
  | 'catchOfTheDay'
  | 'blackInk'
  | 'excuseMeAreYouAZoat'
  | 'incorporeal'
  | 'illCarryYou'
  | 'frenziedRush'
  | 'slashingNails';

export type WideRailPreActionRail =
  | 'move' | 'block' | 'multiBlock' | 'blitz' | 'foul' | 'pass' | 'handOver' | 'punt'
  | 'bomb' | 'throwKeg' | 'throwTeamMate' | 'kickTeamMate' | 'gaze';

export interface WideRailPreActionRule {
  readonly ruleId: WideRailPreActionRuleId;
  readonly label: string;
  readonly skill: string | null;
  readonly rails: readonly WideRailPreActionRail[];
  readonly excludedPlayerActions?: readonly PlayerAction[];
  readonly onlyPlayerActions?: readonly PlayerAction[];
  readonly mode: 'use-skill' | 'wisdom' | 'toggle';
  /** The rule is offered only after a legal Blitz target click. It must not suppress the fresh-player Move shortcut. */
  readonly blitzTargetStageOnly?: boolean;
  /** The skill augments the chosen Blitz target rather than replacing target selection with its own server sequence. */
  readonly commitsHeldBlitzTarget?: boolean;
}

const BROAD_RAILS: readonly WideRailPreActionRail[] = [
  'move', 'block', 'multiBlock', 'blitz', 'foul', 'pass', 'handOver', 'punt', 'bomb', 'throwKeg',
  'throwTeamMate', 'kickTeamMate', 'gaze',
];

/** Exact wire PlayerAction constants carried by each parent rail. */
export const WIDE_RAIL_PARENT_ACTIONS: Readonly<Record<WideRailPreActionRail, readonly PlayerAction[]>> = {
  move: ['move', 'standUp', 'secureTheBall'],
  block: ['block', 'viciousVines', 'kickEmBlock', 'theFlashingBlade'],
  multiBlock: ['multipleBlock'],
  // PutridRegurgitationBlitzLogicModule overrides the inherited action set; it is not a generic-special rail.
  blitz: ['blitzMove', 'kickEmBlitz'],
  foul: ['foul', 'foulMove'],
  pass: ['pass', 'passMove', 'hailMaryPass'],
  handOver: ['handOver', 'handOverMove'],
  punt: ['punt', 'puntMove'],
  bomb: ['throwBomb', 'hailMaryBomb', 'allYouCanEat'],
  throwKeg: ['throwKey'],
  throwTeamMate: ['throwTeamMate', 'throwTeamMateMove'],
  kickTeamMate: ['kickTeamMate', 'kickTeamMateMove'],
  gaze: ['gaze', 'gazeSelect', 'gazeMove'],
};

/**
 * Source: upstream/master 54cb4256 LogicModule.isSpecialAbilityAvailable
 * plus the BB2025 action-module actionContext sets. Exceptions stay explicit:
 * Treacherous fresh declares use the owner-required explicit post-ack election;
 * Incorporeal and I'll Carry You require source-specific state captured later.
 */
export const WIDE_RAIL_PRE_ACTION_RULES: readonly WideRailPreActionRule[] = [
  {
    ruleId: 'treacherous', label: 'Treacherous', skill: 'Treacherous',
    rails: BROAD_RAILS, mode: 'use-skill',
  },
  { ruleId: 'wisdomOfTheWhiteDwarf', label: 'Wisdom of the White Dwarf', skill: null, rails: BROAD_RAILS, mode: 'wisdom' },
  { ruleId: 'raidingParty', label: 'Raiding Party', skill: 'Raiding Party', rails: BROAD_RAILS, mode: 'use-skill' },
  { ruleId: 'lookIntoMyEyes', label: 'Look Into My Eyes', skill: 'Look Into My Eyes', rails: BROAD_RAILS.filter((rail) => rail !== 'pass' && rail !== 'handOver' && rail !== 'punt'), mode: 'use-skill' },
  { ruleId: 'balefulHex', label: 'Baleful Hex', skill: 'Baleful Hex', rails: BROAD_RAILS, mode: 'use-skill' },
  { ruleId: 'catchOfTheDay', label: 'Catch of the Day', skill: 'Catch of the Day', rails: BROAD_RAILS, mode: 'use-skill' },
  { ruleId: 'blackInk', label: 'Black Ink', skill: 'Black Ink', rails: BROAD_RAILS, mode: 'use-skill' },
  { ruleId: 'excuseMeAreYouAZoat', label: 'Excuse Me, Are You a Zoat?', skill: '"Excuse Me, Are You a Zoat?"', rails: BROAD_RAILS, mode: 'use-skill' },
  {
    ruleId: 'incorporeal', label: 'Incorporeal', skill: 'Incorporeal',
    rails: ['move', 'blitz', 'foul', 'pass', 'handOver', 'punt', 'throwTeamMate', 'kickTeamMate', 'gaze'],
    mode: 'toggle',
  },
  {
    ruleId: 'illCarryYou', label: "I'll Carry You", skill: "I'll Carry You",
    rails: ['move', 'block', 'blitz', 'foul', 'pass', 'handOver', 'punt', 'bomb'],
    mode: 'use-skill',
  },
  { ruleId: 'frenziedRush', label: 'Frenzied Rush', skill: 'Frenzied Rush', rails: ['blitz'], onlyPlayerActions: ['blitzMove'], mode: 'use-skill', blitzTargetStageOnly: true, commitsHeldBlitzTarget: true },
  { ruleId: 'slashingNails', label: 'Slashing Nails', skill: 'Slashing Nails', rails: ['blitz'], onlyPlayerActions: ['blitzMove'], mode: 'use-skill', blitzTargetStageOnly: true, commitsHeldBlitzTarget: true },
] as const;

export const wideRailPreActionRule = (ruleId: WideRailPreActionRuleId): WideRailPreActionRule => {
  const rule = WIDE_RAIL_PRE_ACTION_RULES.find((candidate) => candidate.ruleId === ruleId);
  if (!rule) throw new Error(`Unknown wide-rail pre-action rule: ${ruleId}`);
  return rule;
};

/** Some fresh menu choices delegate to a canonical parent action before the server echoes ActingPlayer. */
export function wideRailAcknowledgedPlayerAction(requestedPlayerAction: string): string {
  if (requestedPlayerAction === 'allYouCanEat') return 'throwBomb';
  // StepInitSelecting immediately dispatches a fresh GAZE_MOVE declaration into GAZE_SELECT before the client
  // receives a stable action context. Correlate the wide-rail election to that authoritative target-selection
  // action; otherwise the exact-action guard rejects its own Gaze declaration and hides every special row.
  if (requestedPlayerAction === 'gazeMove') return 'gazeSelect';
  return requestedPlayerAction;
}

export function wideRailPreActionAllows(ruleId: WideRailPreActionRuleId, rail: WideRailPreActionRail): boolean {
  return wideRailPreActionRule(ruleId).rails.includes(rail);
}

export function wideRailPreActionMode(
  ruleId: WideRailPreActionRuleId,
  rail: WideRailPreActionRail,
): 'staged' | null {
  const rule = wideRailPreActionRule(ruleId);
  return rule.rails.includes(rail) ? 'staged' : null;
}

export function wideRailPreActionModeForPlayerAction(
  ruleId: WideRailPreActionRuleId,
  playerAction: string,
): 'staged' | null {
  const rule = wideRailPreActionRule(ruleId);
  if (rule.onlyPlayerActions && !rule.onlyPlayerActions.includes(playerAction as PlayerAction)) return null;
  if (rule.excludedPlayerActions?.includes(playerAction as PlayerAction)) return null;
  for (const [rail, actions] of Object.entries(WIDE_RAIL_PARENT_ACTIONS) as [WideRailPreActionRail, readonly PlayerAction[]][]) {
    if (actions.includes(playerAction as PlayerAction)) return wideRailPreActionMode(ruleId, rail);
  }
  return null;
}
