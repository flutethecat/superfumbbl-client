import { DIALOG_IDS, type DialogId } from './railRegistryKeys.generated';
import type { RailDiagnosticSink } from './railDiagnostics';

export const DIALOG_UNKNOWN_POLICY = 'diagnostic-no-send' as const;

export type DialogHandling = 'existing-dialog' | 'existing-state-driver' | 'client-local-only' | 'unhandled';
export type DialogRuntimeHandler = 'apothecary-election';

export interface DialogDescriptor {
  handling: DialogHandling;
  source: string;
  unknownPolicy: typeof DIALOG_UNKNOWN_POLICY;
  runtimeHandler: DialogRuntimeHandler | null;
}

const d = (handling: DialogHandling, source: string, runtimeHandler: DialogRuntimeHandler | null = null): DialogDescriptor => ({
  handling,
  source,
  unknownPolicy: DIALOG_UNKNOWN_POLICY,
  runtimeHandler,
});

export const DIALOG_REGISTRY = {
  information: d('unhandled', 'DialogInformationHandler'),
  yesOrNoQuestion: d('existing-dialog', 'DialogYesOrNoQuestionHandler'),
  gameCoachPassword: d('client-local-only', 'DialogManager / login UI'),
  teamChoice: d('unhandled', 'DialogTeamChoiceHandler'),
  coinChoice: d('existing-dialog', 'DialogCoinChoiceHandler'),
  reRoll: d('existing-dialog', 'DialogReRollHandler'),
  reRollProperties: d('existing-dialog', 'DialogReRollPropertiesHandler'),
  reRollForTargets: d('unhandled', 'DialogReRollForTargetsHandler'),
  reRollBlockForTargets: d('unhandled', 'DialogReRollBlockForTargetsHandler'),
  skillUse: d('existing-dialog', 'DialogSkillUseHandler'),
  progressBar: d('client-local-only', 'DialogManager client UI'),
  teamSetup: d('existing-dialog', 'DialogTeamSetupHandler'),
  useApothecary: d('existing-dialog', 'DialogUseApothecaryHandler', 'apothecary-election'),
  useApothecaries: d('existing-dialog', 'DialogUseApothecariesHandler', 'apothecary-election'),
  useIgors: d('unhandled', 'DialogUseIgorsHandler'),
  useMortuaryAssistants: d('unhandled', 'DialogUseMortuaryAssistantsHandler'),
  receiveChoice: d('existing-dialog', 'DialogReceiveChoiceHandler'),
  followupChoice: d('existing-dialog', 'DialogFollowupChoiceHandler'),
  startGame: d('existing-dialog', 'DialogStartGameHandler'),
  apothecaryChoice: d('existing-dialog', 'DialogApothecaryChoiceHandler'),
  touchback: d('existing-dialog', 'DialogTouchbackHandler'),
  interception: d('existing-dialog', 'DialogInterceptionHandler'),
  setupError: d('existing-dialog', 'DialogSetupErrorHandler'),
  gameStatistics: d('existing-dialog', 'DialogGameStatisticsHandler'),
  winningsReRoll: d('unhandled', 'DialogWinningsReRollHandler'),
  gameChoice: d('client-local-only', 'DialogManager client UI'),
  keyBindings: d('client-local-only', 'DialogManager client UI'),
  blockRoll: d('existing-dialog', 'DialogBlockRollHandler'),
  playerChoice: d('existing-dialog', 'DialogPlayerChoiceHandler'),
  defenderAction: d('existing-dialog', 'DialogDefenderActionHandler'),
  join: d('client-local-only', 'DialogJoinHandler'),
  concedeGame: d('existing-dialog', 'DialogGameConcessionHandler'),
  about: d('client-local-only', 'DialogManager client UI'),
  endTurn: d('client-local-only', 'DialogManager client UI'),
  leaveGame: d('client-local-only', 'DialogManager client UI'),
  bribes: d('existing-dialog', 'DialogBribesHandler'),
  pilingOn: d('unhandled', 'DialogPilingOnHandler'),
  buyInducements: d('existing-dialog', 'DialogBuyInducementsHandler'),
  soundVolume: d('client-local-only', 'DialogManager client UI'),
  journeymen: d('existing-dialog', 'DialogJourneymenHandler'),
  scalingFactor: d('client-local-only', 'DialogManager client UI'),
  chatCommands: d('client-local-only', 'DialogManager client UI'),
  kickSkill: d('existing-dialog', 'DialogKickSkillHandler'), // wired on tip: kickSkill dialog state + clientKickSkill echo (store.ts)
  useIgor: d('unhandled', 'DialogUseIgorHandler'),
  useMortuaryAssistant: d('unhandled', 'DialogUseMortuaryAssistantHandler'),
  kickoffReturn: d('existing-state-driver', 'DialogKickoffReturnHandler / turnMode'),
  swarming: d('existing-state-driver', 'DialogSwarmingPlayersHandler / turnMode'),
  swarmingError: d('existing-state-driver', 'DialogSwarmingErrorParameterHandler / swarming phase'),
  pettyCash: d('existing-dialog', 'DialogPettyCashHandler'),
  wizardSpell: d('existing-state-driver', 'DialogWizardSpellHandler / turnMode'),
  useInducement: d('existing-dialog', 'DialogUseInducementHandler'),
  passBlock: d('existing-state-driver', 'DialogPassBlockHandler / turnMode'),
  buyCards: d('existing-dialog', 'DialogBuyCardsHandler'),
  buyCardsAndInducements: d('existing-dialog', 'DialogBuyCardsAndInducementsHandler'),
  argueTheCall: d('existing-dialog', 'DialogArgueTheCallHandler'),
  selectBlitzTarget: d('existing-dialog', 'DialogSelectBlitzTargetHandler'),
  opponentBlockSelection: d('unhandled', 'DialogOpponentBlockSelectionHandler'),
  pileDriver: d('existing-dialog', 'DialogPileDriverHandler'),
  useChainsaw: d('unhandled', 'DialogUseChainsawHandler'),
  blockRollPartialReRoll: d('existing-dialog', 'DialogBlockRollPartialReRollHandler'),
  invalidSolidDefence: d('client-local-only', 'DialogInvalidSolidDefenceHandler / Solid Defence setup surface'), // OK-box only, no response command: surfaced as state.solidDefenceError, re-setup stays armed (store.ts)
  selectSkill: d('existing-dialog', 'DialogSelectSkillHandler'),
  briberyAndCorruptionReRoll: d('unhandled', 'DialogBriberyAndCorruptionHandler'),
  selectGazeTarget: d('existing-dialog', 'DialogSelectGazeTargetHandler'),
  confirmEndAction: d('existing-dialog', 'DialogConfirmEndActionHandler'),
  changeList: d('client-local-only', 'DialogManager client UI'),
  selectWeather: d('existing-dialog', 'DialogSelectWeatherHandler'), // wired on tip: Weather Mage prompt + clientSelectWeather echo (store.ts)
  informationOkay: d('existing-dialog', 'DialogInformationOkayHandler'),
  storePropertiesLocal: d('client-local-only', 'DialogManager client UI'),
  kickOffResult: d('existing-dialog', 'DialogKickOffResultHandler'),
  bloodlustAction: d('existing-dialog', 'DialogBloodlustActionHandler'),
  penaltyShootout: d('unhandled', 'DialogPenaltyShootoutHandler'),
  replayModeChoice: d('client-local-only', 'DialogManager client UI'),
  credits: d('client-local-only', 'DialogManager client UI'),
  creditsLicense: d('client-local-only', 'DialogManager client UI'),
  buyPrayersAndInducements: d('existing-dialog', 'DialogBuyPrayersAndInducementsHandler'),
  blockRollProperties: d('existing-dialog', 'DialogBlockRollPropertiesHandler'),
  reRollBlockForTargetsProperties: d('existing-dialog', 'DialogReRollBlockForTargetsPropertiesHandler'),
  opponentBlockSelectionProperties: d('unhandled', 'DialogOpponentBlockSelectionPropertiesHandler'),
  pickUpChoice: d('unhandled', 'DialogPickUpChoiceHandler'),
  selectKeyword: d('existing-dialog', 'DialogSelectKeywordHandler'),
  selectPosition: d('unhandled', 'DialogSelectPositionHandler'),
  reRollRegenerationMultiple: d('existing-dialog', 'DialogReRollRegenerationMultipleHandler'),
  puntToCrowd: d('existing-dialog', 'DialogPuntToCrowdHandler'),
} satisfies Record<DialogId, DialogDescriptor>;

export function dialogDescriptor(value: string): DialogDescriptor | null {
  return Object.prototype.hasOwnProperty.call(DIALOG_REGISTRY, value)
    ? DIALOG_REGISTRY[value as DialogId]
    : null;
}

/** Runtime routing is explicit: a descriptor cannot claim a handled dialog with no invocation point. */
export function dialogRuntimeHandler(value: string | null | undefined): DialogRuntimeHandler | null {
  return value ? dialogDescriptor(value)?.runtimeHandler ?? null : null;
}

export function resolveDialogSurface<T>(
  dialogId: string | null | undefined,
  surfaces: Partial<Record<DialogId, () => T>>,
  diagnostic: RailDiagnosticSink,
): T | null {
  if (!dialogId) return null;
  const descriptor = dialogDescriptor(dialogId);
  if (!descriptor) {
    diagnostic({ rail: 'dialog', code: 'unknown-key', key: dialogId, message: `unknown dialog "${dialogId}"` });
    return null;
  }
  const surface = surfaces[dialogId as DialogId];
  if (!surface) {
    if (descriptor.handling === 'unhandled') {
      diagnostic({ rail: 'dialog', code: 'unhandled-key', key: dialogId, message: `unhandled dialog "${dialogId}"` });
    }
    return null;
  }
  return surface();
}

export type DialogIntent = { dialogId: string };
export type DialogCommand = { netCommandId: string; [key: string]: unknown };
export type DialogIntentResult =
  | { kind: 'command'; command: DialogCommand }
  | { kind: 'local-dismiss' }
  | { kind: 'refused'; reason: string };

export function resolveDialogIntent<I extends DialogIntent>(
  currentDialogId: string | null | undefined,
  intent: I,
  builders: Partial<Record<DialogId, (value: I) => DialogIntentResult>>,
  diagnostic: RailDiagnosticSink,
): DialogIntentResult {
  if (!dialogDescriptor(intent.dialogId)) {
    const reason = `unknown dialog "${intent.dialogId}"`;
    diagnostic({ rail: 'dialog', code: 'unknown-key', key: intent.dialogId, message: reason });
    return { kind: 'refused', reason };
  }
  if (!currentDialogId || currentDialogId !== intent.dialogId) {
    const reason = `dialog intent "${intent.dialogId}" does not match "${currentDialogId ?? ''}"`;
    diagnostic({ rail: 'dialog', code: 'intent-mismatch', key: intent.dialogId, message: reason });
    return { kind: 'refused', reason };
  }
  const builder = builders[intent.dialogId as DialogId];
  if (!builder) {
    const reason = `dialog "${intent.dialogId}" has no response adapter`;
    diagnostic({ rail: 'dialog', code: 'unhandled-key', key: intent.dialogId, message: reason });
    return { kind: 'refused', reason };
  }
  return builder(intent);
}

export function dialogRegistryKeys(): readonly string[] {
  return DIALOG_IDS.filter((id) => Object.prototype.hasOwnProperty.call(DIALOG_REGISTRY, id));
}
