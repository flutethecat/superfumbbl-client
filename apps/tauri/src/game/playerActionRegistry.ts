import type { PlayerAction } from './railRegistryKeys.generated';
import type { RailDiagnosticSink } from './railDiagnostics';

export const PLAYER_ACTION_UNKNOWN_POLICY = 'diagnostic-no-send' as const;

export type PlayerActionClientState =
  | 'MOVE' | 'BLITZ' | 'BLOCK' | 'FOUL' | 'HAND_OVER' | 'PASS' | 'PUNT'
  | 'THROW_TEAM_MATE' | 'KICK_TEAM_MATE' | 'SWOOP' | 'GAZE' | 'GAZE_MOVE'
  | 'BOMB' | 'THROW_KEG' | 'MAXIMUM_CARNAGE' | 'PUTRID_REGURGITATION_BLITZ'
  | 'PUTRID_REGURGITATION_BLOCK' | 'KICK_EM_BLITZ' | 'KICK_EM_BLOCK' | 'STAB'
  | 'FURIOUS_OUTBURST';

export interface PlayerActionDescriptor {
  selection: 'selectable' | 'locked';
  clientState: PlayerActionClientState | null;
  source: 'client-declare' | 'server-driven' | 'unhandled';
  unknownPolicy: typeof PLAYER_ACTION_UNKNOWN_POLICY;
}

const a = (
  selection: PlayerActionDescriptor['selection'],
  clientState: PlayerActionClientState | null,
  source: PlayerActionDescriptor['source'],
): PlayerActionDescriptor => ({ selection, clientState, source, unknownPolicy: PLAYER_ACTION_UNKNOWN_POLICY });

export const PLAYER_ACTION_REGISTRY = {
  move: a('selectable', 'MOVE', 'client-declare'),
  block: a('selectable', 'BLOCK', 'client-declare'),
  blitz: a('locked', 'BLOCK', 'server-driven'),
  blitzMove: a('selectable', 'BLITZ', 'client-declare'),
  // Server-internal/unreachable via regular/blitz: bb2025 StepInitSelecting.java:~118; StepSelectBlitzTarget.java:224 enters selectBlitzTarget first.
  blitzSelect: a('locked', null, 'server-driven'),
  handOver: a('selectable', 'HAND_OVER', 'client-declare'),
  handOverMove: a('selectable', 'HAND_OVER', 'client-declare'),
  pass: a('selectable', 'PASS', 'client-declare'),
  passMove: a('selectable', 'PASS', 'client-declare'),
  foul: a('selectable', 'FOUL', 'client-declare'),
  foulMove: a('selectable', 'FOUL', 'client-declare'),
  standUp: a('selectable', 'MOVE', 'client-declare'),
  throwTeamMate: a('locked', 'THROW_TEAM_MATE', 'server-driven'),
  throwTeamMateMove: a('selectable', 'THROW_TEAM_MATE', 'client-declare'),
  // bb2025 SelectLogicModule.java:169 client-declares this; ClientStateFactory default → SELECT_PLAYER.
  removeConfusion: a('selectable', null, 'client-declare'),
  gaze: a('locked', 'GAZE', 'server-driven'),
  // Server-internal/unreachable via regular/blitz: bb2025 StepInitSelecting.java:~118; StepSelectBlitzTarget.java:224 enters selectGazeTarget first.
  gazeSelect: a('locked', null, 'server-driven'),
  gazeMove: a('selectable', 'GAZE_MOVE', 'client-declare'),
  multipleBlock: a('selectable', 'BLOCK', 'client-declare'),
  hailMaryPass: a('locked', 'PASS', 'server-driven'),
  dumpOff: a('locked', 'PASS', 'server-driven'),
  standUpBlitz: a('locked', 'MOVE', 'server-driven'),
  throwBomb: a('selectable', 'BOMB', 'client-declare'),
  hailMaryBomb: a('locked', 'BOMB', 'server-driven'),
  swoop: a('locked', 'SWOOP', 'server-driven'),
  // bb2025 SelectLogicModule.java:165-166 client-declares KICK_TEAM_MATE_MOVE.
  kickTeamMateMove: a('selectable', 'KICK_TEAM_MATE', 'client-declare'),
  kickTeamMate: a('locked', 'KICK_TEAM_MATE', 'server-driven'),
  // Star S7 — force-dispatched by the server off the CLIENT_USE_SKILL election (bb2025
  // StepInitSelecting:369-372 → the Treacherous sequence); no state-local client surface — like raidingParty.
  treacherous: a('locked', null, 'server-driven'),
  wisdomOfTheWhiteDwarf: a('locked', null, 'server-driven'),
  throwKey: a('selectable', 'THROW_KEG', 'client-declare'),
  raidingParty: a('locked', null, 'server-driven'),
  maximumCarnage: a('locked', 'MAXIMUM_CARNAGE', 'server-driven'),
  // Star S4: force-dispatched by the server after the registry-mounted CLIENT_USE_SKILL election
  // (bb2025 StepInitSelecting:377-384/422-425 → StepEndSelecting:425-434/458-463); the sequences run on
  // server dialogs (playerChoice/reroll/informationOkay), no state-local client surface — like raidingParty.
  lookIntoMyEyes: a('locked', null, 'server-driven'),
  balefulHex: a('locked', null, 'server-driven'),
  allYouCanEat: a('selectable', 'BOMB', 'client-declare'),
  putridRegurgitationMove: a('locked', 'PUTRID_REGURGITATION_BLITZ', 'server-driven'),
  putridRegurgitationBlitz: a('selectable', 'PUTRID_REGURGITATION_BLITZ', 'client-declare'),
  putridRegurgitationBlock: a('locked', 'PUTRID_REGURGITATION_BLOCK', 'server-driven'),
  // Star S8: bb2025 SelectLogicModule:212-219 client-declares both Kick 'em variants (sendActingPlayer, false).
  kickEmBlock: a('selectable', 'KICK_EM_BLOCK', 'client-declare'),
  kickEmBlitz: a('selectable', 'KICK_EM_BLITZ', 'client-declare'),
  blackInk: a('locked', null, 'unhandled'),
  catchOfTheDay: a('locked', null, 'server-driven'),
  // Star S8: bb2025 SelectLogicModule:240-244 client-declares it (sendActingPlayer + the paired sendUseSkill);
  // the target beat runs under turnMode thenIStartedBlastin (its OWN state, ClientStateFactory:348), so the
  // transient regular-mode action maps like raidingParty — null state, SELECT_PLAYER fallback.
  thenIStartedBlastin: a('selectable', null, 'client-declare'),
  theFlashingBlade: a('selectable', 'STAB', 'client-declare'),
  viciousVines: a('selectable', 'BLOCK', 'client-declare'),
  // Star S8: bb2025 SelectLogicModule:232-235 client-declares FURIOUS_OUTPBURST (wire "furiousOutburst").
  furiousOutburst: a('selectable', 'FURIOUS_OUTBURST', 'client-declare'),
  secureTheBall: a('selectable', 'MOVE', 'client-declare'),
  breatheFire: a('locked', 'BLOCK', 'server-driven'),
  chainsaw: a('locked', 'BLOCK', 'server-driven'),
  stab: a('locked', 'BLOCK', 'server-driven'),
  projectileVomit: a('locked', 'BLOCK', 'server-driven'),
  autoGazeZoat: a('locked', null, 'server-driven'), // Star S4 — see lookIntoMyEyes note
  forgo: a('locked', null, 'server-driven'),
  incorporeal: a('locked', null, 'unhandled'),
  chomp: a('locked', 'BLOCK', 'server-driven'),
  // availableActions.ts:1557-1567,1690-1695 offers both through declareAction.
  punt: a('selectable', 'PUNT', 'client-declare'),
  puntMove: a('selectable', 'PUNT', 'client-declare'),
} satisfies Record<PlayerAction, PlayerActionDescriptor>;

export function playerActionDescriptor(value: string): PlayerActionDescriptor | null {
  return Object.prototype.hasOwnProperty.call(PLAYER_ACTION_REGISTRY, value)
    ? PLAYER_ACTION_REGISTRY[value as PlayerAction]
    : null;
}

export function playerActionClientState(value: string): PlayerActionClientState | null {
  return playerActionDescriptor(value)?.clientState ?? null;
}

export type PlayerActionFallbackState = PlayerActionClientState | 'SELECT_PLAYER' | 'UNKNOWN';

/** Mirrors ClientStateFactory's action switch: unknown/unhandled locks; known fall-through returns select.
 *  Blank/absent action = pre-declare base state (every activation) → SELECT_PLAYER, never UNKNOWN (Meero SR, Echo RED 08-10). */
export function playerActionFallbackState(value: string | null | undefined): PlayerActionFallbackState {
  if (!value || value.trim() === '') return 'SELECT_PLAYER';
  const descriptor = playerActionDescriptor(value);
  if (!descriptor || descriptor.source === 'unhandled') return 'UNKNOWN';
  return descriptor.clientState ?? 'SELECT_PLAYER';
}

export function resolvePlayerActionSelection(
  value: string,
  diagnostic: RailDiagnosticSink,
): { selectable: true; action: PlayerAction } | { selectable: false } {
  const descriptor = playerActionDescriptor(value);
  if (!descriptor) {
    diagnostic({ rail: 'player-action', code: 'unknown-key', key: value, message: `unknown player action "${value}"` });
    return { selectable: false };
  }
  if (descriptor.selection === 'locked') {
    diagnostic({ rail: 'player-action', code: 'selection-locked', key: value, message: `player action "${value}" is not selectable` });
    return { selectable: false };
  }
  return { selectable: true, action: value as PlayerAction };
}
