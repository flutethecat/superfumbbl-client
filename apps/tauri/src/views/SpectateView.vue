<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, watchEffect } from 'vue';
import { FORK_EDITION } from '../game/edition';
import {
  cachedBundledFumbblAsset,
  PitchRenderer,
  KICK_FLYIN_MS,
  KICKOFF_CINE_MS,
  PlayerStateBase,
  baseState,
  loadIconsetManifest,
  loadBlockDice3d,
  loadShadowlessManifest,
  presentationMs,
  rendersOnPitch,
  setClassicIconTextureResolver,
  setClassicIconUrlRewriter,
  setWalkAnimation,
  setWalkCastShadows,
  setWalkFaceCamera,
  setWalkFps,
  setupTemplatesForSide,
  squareLabel,
  TILE_H,
  type ActionMode,
  type ClassicIconTextureSource,
  type ContextTarget,
  type SetupTemplate,
  type BlockDiceRow,
  bundledStadiumPacks,
} from '@fumbbl40k/ffb-pitch';
import type { PlayerJson, GameJson } from '@fumbbl40k/ffb-protocol';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { effectiveArmour, effectiveMovement, playerSkillNames } from '@fumbbl40k/ffb-protocol';
import { gameStore, reRollPromptScreenPosition, bindBallAnimating } from '../game/store';
import { prayerForWireValue } from '../game/prayerCatalog';
import { playSound } from '../game/sounds';
import { initPitchRendererMount } from '../game/pitchRendererMount';
import type { PromptRect, PromptCardBox } from '../game/store';
import D6Face from '../components/D6Face.vue';
import ActionTargetConfirmModal from '../components/ActionTargetConfirmModal.vue';
import BlockAttackConfirmModal from '../components/BlockAttackConfirmModal.vue';
import BlockDieFace from '../components/BlockDieFace.vue';
import BlockChooserCopy from '../components/BlockChooserCopy.vue';
import EligibleRosterPicker from '../components/EligibleRosterPicker.vue';
import ChatDock from '../components/ChatDock.vue';
import ChatToast from '../components/ChatToast.vue';
import QuickBarButton from '../components/QuickBarButton.vue';
import OnTheBallWaitingModal from '../components/OnTheBallWaitingModal.vue';
import SendOffWaitingModal from '../components/SendOffWaitingModal.vue';
import InducementsPhase, { type PanelView, type PickerCard, type Portrait, type SummaryCardView } from '../components/InducementsPhase.vue';
import {
  UnderdogInducementRevealHold,
  shouldHoldUnderdogInducementReveal,
} from '../game/inducementRevealHold';
import ChargePickPanel from '../components/ChargePickPanel.vue';
import PitchConfirmationPanel from '../components/PitchConfirmationPanel.vue';
import ConfirmActionButton from '../components/ConfirmActionButton.vue';
import PlayerDetailSkillList from '../components/PlayerDetailSkillList.vue';
import ApothecaryPrompt from '../components/ApothecaryPrompt.vue';
import ApothecaryResultChoice from '../components/ApothecaryResultChoice.vue';
import ApothecaryAutoReturn from '../components/ApothecaryAutoReturn.vue';
import SendOffPrompt from '../components/SendOffPrompt.vue';
import SendOffResult from '../components/SendOffResult.vue';
import { mergeRosteredStarCards, rosteredStarCards } from '../game/inducementRosterStars';
import PrayerPresentation from '../components/PrayerPresentation.vue';
import IntensiveTrainingChoice from '../components/IntensiveTrainingChoice.vue';
import WatchOutToast from '../components/WatchOutToast.vue';
import SppGainToast from '../components/SppGainToast.vue';
import TurnToast from '../components/TurnToast.vue';
import { visibleMatchLogEntries } from '../game/logVisibility';
import {
  bladeOf, phaseMoney, phaseOf, roleFromWire, summaryCards,
  type Blade, type InducementPhase, type InducementRole,
} from '../game/inducementsPhase';
import { activeInducementSprite } from '../game/inducementPortrait';
import { resolveRuntimeFumbblAsset } from '../game/fumbblAssetCache';
import { crestDataUrl, type CrestSide } from '../game/teamCrests';
import { revealedInducementCards } from '../game/inducementRevealCards';
import { shouldShowOpponentSetupNotice } from '../game/opponentSetupNotice';
import { assetMods, beginAssetAssignmentIntent, commitAssetAssignments, packSupports } from '../game/assetMods';
import { hasOffPitchCandidate, resolveRosterPickCandidates } from '../game/rosterPicker';
import { d6LogParts, d6RequirementParts } from '../game/d6Log';
import { blockDieLogParts, type BlockDieFaceValue, type BlockDieLogToken } from '../game/blockDieLog';
import { logNameParts, logNameSeatKey, type LogNameTeam, type LogNameToken } from '../game/logNames';
import { chatLineParts } from '../game/chatLine';
import { chatToastRole, type ChatAuthorSide } from '../game/chatAuthor';
import { useChatToastQuietClear } from '../game/chatToastQuietClear';
import { newlyAppendedChatOccurrences, scheduleAuthoredChatToastExpiry } from '../game/chatToastLifetime';
import { logTagParts, type LogTagKind, type LogTagToken } from '../game/logTags';
import { logTimestamp } from '../game/logTime';
// Owner 08-18: the armour log lines render the same breastplate icon art the on-pitch armour
// die toast uses (renderer.ts showArmorRoll), inline at text size, over the 🛡 text node.
import breastplateIconUrl from '@fumbbl40k/ffb-pitch/assets/decorations/breastplate.png';
import niStatDownIconUrl from '@fumbbl40k/ffb-pitch/assets/status/stat-down/ni.png';
import { kickoffCineHoldGuard } from '../game/kickElection';
import { watchKickoffArcDecisionDwell } from '../game/kickoffArcDwell';
import { quickSnapExhaustedText } from '../game/quickSnapController';
import { currentBlockChoosingTeamId, currentMultiBlockChoosingTeamId, isCurrentBlockChoiceDialog, isCurrentMultiBlockChoiceDialog, projectBlockChooser, type BlockChooserSide } from '../game/blockChooser';
import { savedSetupPreview, templatePreview } from '../game/setupTemplatePreview';
import { hmpScatterSkillUseCardCopy, passSkillUseCardCopy } from '../game/skillUseCardPresentation';
import { swoopChoiceCopy } from '../game/logic/swoopPresentation';
import { tastyMorselAvailable, TASTY_MORSEL_AVAILABLE_COPY } from '../game/bloodlustPresentation';
import { setGameWithConfirmedMovement, watchConfirmedMovementPresentation } from '../game/confirmedMovementPresentation';
import { watchBoardPresentationReconciliation, watchMovementPresentationReconciliation, watchMovementPresentationRecovery } from '../game/movementPresentationReconciliation';
import { furySecondBlockTargeting as projectFurySecondBlockTargeting } from '../game/furyOfTheBloodGod';
// Claim modern live decisions during setup, before any async mount work or incoming frame can auto-answer.
gameStore.setInteractiveReRolls(true);
// ORDER 66 (A.2/A.3): flag-gated interaction — action menu (③) + move-square overlay/step (①②) + block target.
import { onPlayerClick as o66PlayerClick, actionSurfaceLock, canFreeSelectPass, escCascadeDecision, passTargetInTemplate, selectedActingRightClick, ttmTargetInTemplate, passAtRestArmRequired, passActionIdentity, projectSubmittedPassPresentation, ttmActivationKey, ttmCancellationDecision, type EndActivationConfirmKind, type SubmittedPassBridge } from '../game/logic/order66Interaction';
import { isBlitzMovementState, requiresBlitzEndConfirmation, onSquareClick as o66SquareClick, reactingMovePlanClick, swoopCoordinateSquares } from '../game/logic/order66Interaction';
import { syncTtmPassRailSurface, useTtmPassRailBoundaries } from '../game/logic/ttmPassRailLifecycle';
import { passRangeSquares, ttmRangeSquares, throwRollSurface, adjacentStandingEnemyIds, normSquare, highKickNomineeIds, serverMoveSquares, movesRandomly, BLOCK_KIND_LABEL, blockAlternativeOffers, blockAlternativeArmourTarget, blockAttackPreview, chompAvailable, pickupTargetAtBall, foulArmourTargetAt, passDestinationRollPreview, canBeBlocked, jumpVerbForPlayer, boundingLeapOffer, kegTargetIds, availableActions, hasWideRailActivationRule, furiousOutburstCoordinatePrompt, type CoachAction, type BlockKind, type WideRailActivationOption } from '../game/logic/availableActions';
import { wideRailPreActionRule, type WideRailPreActionRuleId } from '../game/logic/wideRailPreAction';
import { wideRailAvailabilityNotice } from '../game/logic/wideRailAvailabilityNotice';
import { leftClickBlitzContactRoute } from '../game/logic/leftClickBlitzPlanner';
import { nominateBlitzTarget } from '../game/logic/blitzTargetNomination';
import { allowsFumblerooskieAction } from '../game/logic/availableActions';
import { deriveClientState, type ClientStateContext } from '../game/logic/clientStateMachine';
import { decidingCoachSide, reactiveSkillDecisionText } from '../game/logic/coachDecisionStatus';
import { gazeTargetClick, isGazeMovementState } from '../game/logic/gazeMovementState';
import { installGazeVictimPresentation } from '../game/gazeVictimPresentation';
import { buildInducementChips } from '../game/logic/coachPanelChips';
import { sppEarnedThisGame } from '../game/logic/sppEarned';
import { stableCoachPanelWidth } from '../game/logic/hudGeometry';
import { spectatorExitActionsVisible, spectatorMvpPending, type EndGameExit } from '../game/spectatorEndGame';
import { shouldShowRejoinBrowser } from '../game/rejoinFlow';
// Fives lane 08-19: project only the fresh auto-Move shell back through the menu's server-derived offer set.
function quickClickBlitzAction(game: GameJson, ctx: ClientStateContext, actingId: string, targetId: string): CoachAction | null {
  const acting = game.actingPlayer as { playerId?: string | null; playerAction?: string | null; currentMove?: number } | undefined;
  if (deriveClientState(game, ctx) !== 'MOVE' || acting?.playerId !== actingId
      || acting.playerAction !== 'move' || Number(acting.currentMove ?? 0) !== 0
      || adjacentStandingEnemyIds(game, actingId).includes(targetId) || !canBeBlocked(game, targetId)) return null;
  const freshProjection = { ...game, actingPlayer: { ...game.actingPlayer, playerAction: null } } as GameJson;
  return availableActions(freshProjection, ctx, actingId)
    .find((action) => action.kind === 'declare' && action.action === 'blitzMove' && action.enabled) ?? null;
}
// A.3: the block flavor chosen at declare, applied as clientBlock flags when the target is clicked.
const o66PendingBlockKind = ref<BlockKind | null>(null);
// Distinguish an explicit plain Block from no block-flavor choice so menu picks can bypass the chooser.
const o66ExplicitBlockChoice = ref<{ kind: BlockKind | null } | null>(null);
// Owner o66 automove CONFIRM: first click on a move square previews the route (crosshair + path trail); a
// second click on the SAME square confirms + sends. Cleared on confirm / re-plan / a fresh reach.
const o66PendingMove = ref<{ dest: [number, number]; route: [number, number][] } | null>(null);
// Fives lane 08-19: target waits for the server's SELECT_BLITZ_TARGET echo; no speculative target wire.
const o66PendingBlitzTarget = ref<string | null>(null);
// A confirmed left-click target owns its previewed route while the server acknowledges Blitz, target selection,
// and any wide-rail pre-action choice. Once the model enters BLITZ, the stored route starts automatically.
const o66PendingLeftClickBlitzPlan = ref<{
  playerId: string; targetId: string; route: [number, number][];
} | null>(null);
// #34 (owner: blitz right-click specials): the special block-kind chosen for the in-progress blitz (Stab/Chainsaw/
// Projectile Vomit/Breathe Fire/Chomp), picked from the right-click menu on the blitz target. null = a plain block.
// Threaded into the blitz plan (startPlan blockKind) so the walk-then-block resolves with that special. Cleared
// whenever the blitz target/aggro is cleared (byte-identical to the pre-#34 blitz when null).
const o66PendingBlitzBlockKind = ref<BlockKind | null>(null);
const chainsawBlitzConfirm = ref(false);
const chainsawBlitzTarget = computed(() => {
  const g = gameStore.game.value; const choice = gameStore.state.blitzBlockChoice;
  return g && choice ? blockAlternativeArmourTarget(g, choice.targetId, 'chainsaw') : null;
});
// owner tweak 08-04 (#207 modal): a per-block-type emoji prefix on each chooser entry (label-only, display).
const BLOCK_KIND_EMOJI: Record<BlockKind, string> = { stab: '🔪', chainsaw: '🪚', vomit: '🤮', breatheFire: '🔥', chomp: '👄' };
const furySecondBlockTargeting = computed(() => {
  const g = gameStore.game.value;
  return g && gameStore.isPlaying.value ? projectFurySecondBlockTargeting(g) : null;
});
function chooseBlitzBlockAlternative(kind: BlockKind | null) {
  if (kind === 'chainsaw') { chainsawBlitzConfirm.value = true; return; }
  // SR-241: commitBlitzBlock sends the already-declared Blitz's clientBlock with this kind's existing USING_* flag.
  gameStore.commitBlitzBlock(kind);
}
function confirmChainsawBlitz() {
  chainsawBlitzConfirm.value = false;
  // Confirmation is still display-only UI; the store emits USING_CHAINSAW on clientBlock, never a new declare.
  gameStore.commitBlitzBlock('chainsaw');
}
watch(() => gameStore.state.blitzBlockChoice, (choice) => {
  if (!choice) { chainsawBlitzConfirm.value = false; o66ExplicitBlockChoice.value = null; return; }
  // Owner 09-06: a Chainsaw carrier's blitz DEFAULTS to the chainsaw — open on the confirmation; Back reaches the plain-block chooser.
  chainsawBlitzConfirm.value = choice.offers.some((offer) => offer.kind === 'chainsaw');
});
/** Commit an explicitly menu-selected standalone block flavor through the existing chooser path without rendering that chooser. */
function o66SendStandaloneBlock(attackerId: string, defenderId: string, kind: BlockKind | null) {
  const explicit = o66ExplicitBlockChoice.value;
  o66ExplicitBlockChoice.value = null; // consumed at the send (a 0-offer direct send clears it too — harmless)
  gameStore.sendStandaloneBlockOrChoose(attackerId, defenderId, kind);
  if (explicit && gameStore.state.blitzBlockChoice) chooseBlitzBlockAlternative(explicit.kind);
}
// Block and Blitz terminals share a 2-click confirm: first target click previews, second click/Confirm sends.
const o66PendingBlock = ref<string | null>(null);
// PASS/BOMB/Fireball share one nominate-then-confirm square arm; hand-off retains its player-id arm.
const o66PendingPass = ref<[number, number] | null>(null);
// After the passer confirms locally, keep one visual-only bridge until the server echoes game.passCoordinate.
// The echoed coordinate then becomes the cue's sole source for every client (passer, opponent, spectator).
const o66SubmittedPassDestination = ref<SubmittedPassBridge | null>(null);
const o66PendingThrowKind = ref<'pass' | 'bomb' | 'fireball' | 'throwTeamMate' | null>(null);
// Owner 08-12: the pass range template renders in EXACTLY three cases (positive allow-list) — ① free-select, ②
// the "Show pass template" menu item (#250, sets this flag), ③ a pass target armed. Everything else suppresses it.
const passTemplateForced = ref(false); // case ②; cleared when the activation ends
// U9c: Punt aim is its own two-click arm. It cannot share o66PendingPass: that ref also drives pass/catch roll
// previews, while a Punt has no accuracy threshold and only previews its presentation-only scatter spread.
const o66PendingPunt = ref<[number, number] | null>(null);
const o66PendingHandOff = ref<string | null>(null);
// Owner o66aa: FOUL joins click-to-act — click a DOWN enemy in MOVE → declare foulMove; the reach planner plots
// the walk + the armor-break cue shows over the victim; walk adjacent, then a click on the victim boots.
const o66PendingFoul = ref<string | null>(null);
// HYPNOTIC GAZE reuses the target-confirm rail before locking its one activation target.
const o66PendingGaze = ref<string | null>(null);
// A residual opponent click during a movement activation is read-only. This latch makes the next actor/empty
// click a dismiss-only gesture, so the renderer returns to the actor without changing or sending the plan.
const o66InspectedOpponent = ref<string | null>(null);
// Owner o66am: THROW TEAM-MATE (pass-rail) two-step — once a Right Stuff team-mate is PICKED UP (thrownPlayerId
// sent), this holds its id and the landing targets (pass range) arm; a click on a target square lands the throw.
const o66ThrownMate = ref<string | null>(null);
// A cancelled TTM activation stays retired across delayed/reconnect copies of that same server state. The key
// includes game/half/side-turn/actor/action, so a later genuine TTM activation is independently eligible.
const ttmCancelledActivationKeys = new Set<string>();
// A submitted TTM destination retires the whole local rail immediately. The server can retain the same acting
// action through throw/scatter/landing, so this activation-scoped latch prevents the walk/target watcher from
// resurrecting tile picks before the terminal landing report arrives.
const ttmCommittedActivationKeys = new Set<string>();
// Fives lane 08-19: aggressive-action staging covers adjacent BLOCK and the owner's two-click quick Blitz.
// Blitz uses stage 1 only; confirm hands the target to o66PendingBlitzTarget for the post-declare server echo.
const o66AggroStage = ref<{ kind: 'block' | 'blitz'; target: string; stage: 1 | 2 } | null>(null);
const selectedAggroBlockKind = computed<BlockKind | null>(() => {
  const stage = o66AggroStage.value;
  if (!stage) return null;
  return stage.kind === 'blitz' ? o66PendingBlitzBlockKind.value : o66PendingBlockKind.value;
});
const blockAttackConfirm = computed(() => {
  const g = gameStore.game.value;
  const stage = o66AggroStage.value;
  const kind = selectedAggroBlockKind.value;
  if (!g || !stage || stage.stage !== 2 || !kind) return null;
  const rosterPlayer = [...g.teamHome.playerArray, ...g.teamAway.playerArray].find((player) => player.playerId === stage.target);
  return {
    preview: blockAttackPreview(g, stage.target, kind),
    targetName: rosterPlayer?.playerName ?? stage.target,
  };
});
// Owner g478 #1 HIGH KICK, AMENDED (owner ruling, live — nominate-before-confirm): the staged nominee — a
// LOCAL selection only, nothing sent — + the landing square captured at nominate time. Single-slot: picking
// a different eligible player just replaces the staged one (nothing to vacate, since nothing was ever sent).
// The staging slot now lives in the store's shared High Kick projection, so Classic stages/confirms through
// exactly the same seams and the two views cannot drift apart on eligibility or on the wire.
const o66HighKickPending = computed(() => {
  const phase = gameStore.state.highKickPhase;
  return phase?.pendingId && phase.landing ? { playerId: phase.pendingId, landing: phase.landing } : null;
});
function o66BlockFlags(k: BlockKind | null) {
  return k ? { usingStab: k === 'stab', usingChainsaw: k === 'chainsaw', usingVomit: k === 'vomit', usingBreatheFire: k === 'breatheFire', usingChomp: k === 'chomp' } : undefined;
}
// g478 #1 HIGH KICK, AMENDED (owner ruling, live): nominate one eligible player onto the ball's landing square
// (server kickAim / ball square — never client-derived) — but STAGE it locally only. The token must not move
// pre-confirm (server-derived law: it moves only on the server's echoed coordinate), so this sends nothing;
// it just arms the shared persistent selection arrow (see syncShadedPick). Re-clicking the staged nominee
// un-stages it; picking a different eligible player replaces the staged one. confirmHighKick() below is the
// only sender — CLIENT_SETUP_PLAYER goes out at Confirm, not at nominate-click.
function o66NominateHighKick(playerId: string) {
  if (!gameStore.highKickNominate(playerId) && !gameStore.state.highKickPhase?.landing) {
    showToast('waiting for the ball to land', 200, 200, 2000);
  }
}
/** Confirm the High Kick mini-turn (owner ruling, live): flush a staged nominee — CLIENT_SETUP_PLAYER, the
 *  server echo is what actually moves the token — THEN end the phase (CLIENT_END_TURN), mirroring how a
 *  plain decline (no nominee staged) already worked. Reused by the hk-confirm-bar Confirm button. */
function confirmHighKick() {
  if (!gameStore.highKickConfirm()) gameStore.playerEndTurn(); // pre-projection frame: keep the plain decline
}
import { parseJnlp } from '../game/jnlpCompat';
import {
  clearFumbblLobby,
  fumbblAsset,
  fumbblJoinByName,
  fumbblLobby,
  fumbblLobbyGameName,
  readJnlpFile,
  routeJnlpRequest,
  stageFumbblPlayerLobby,
  type BrowserMatch,
} from '../game/jnlpRouting';
import { generateAllMarkings, type AutoMarkingConfig } from '../game/markings';
import { computeIconSkills, computeConfigMarkings, anyMarkerConfigured, markerGlyph, jumpUpMenuPresentation, playerDetailSkills } from '../game/skillDisplay';
import apothecaryIconUrl from '../assets/resources/apothecary.png';
import helmetIconUrl from '../assets/resources/football-helmet.png';
import refereeIconUrl from '../assets/resources/biased_ref.png';
import superFumbblLogoUrl from '../assets/resources/super-fumbbl-logo.png';
import { activeServerTarget, applyServerTarget, botConfigBaseUrl, forkServerUrl, forkJnlpUrl, FUMBBL_SITE, resolveJoinCreds, serializeSettingsForFile, settings, turfCatalog, type AppSettings } from '../game/settings';
import { coachPassword } from '../game/credentials';
import {
  BUG_REPORT_DESCRIPTION_MAX,
  buildBugReportPayload,
  formatAppLog,
  gameServiceFromTarget,
  gameServiceLabel,
  resolveReportGameId,
  sendBugReport,
  wireLogBasename,
  type BugReportLogRead,
} from '../game/bugReport';
// botGet/botPost: the token-auth seam (owner ruling 2026-08-17) lives once in forkChallenge.ts —
// consolidated here rather than re-converting a 4th local copy; signatures are a drop-in match.
import { botGet, botPost } from '../game/forkChallenge';
import { mintFumbblToken, fetchTeamName, fumbblApiConfigured, FumbblCredentialsMissing } from '../game/fumbblAuth';
import { sevenSeas } from '../game/sailThe7Seas';
import { reactiveSkillIconUrl, refreshAssetRendererSurfaces, toggleSkillDisplay, watchAssetModRendererRefresh } from '../game/assetModUi';
import { playerOwnedSkillIconUrl } from '../game/playerOwnedSkillIcon';
import { ui } from '../game/ui';
import { anchorPanelPosition, beginScaledPanelResize, bindPointerCompletion, captureScaledPanelLayout, dodgePanelObstacle, hasEdgeAnchor, persistClampedPanelPosition, resizablePanelStyle, resolvePanelPosition, scaledPanelStyle, type EdgePanelPosition } from '../game/edgePanelLayout';
import { appShellModalOwnsKeyboard } from '../game/settingsDialog';
import ReplayControls from '../components/ReplayControls.vue';
import ReplayTelestrator from '../components/ReplayTelestrator.vue';
import skillDescriptions from '../assets/skillDescriptions.json';
// Owner 2026-07-06: supporter names for the crowd "I ♥ name" signs. The CSV is the
// single source of truth — add names to apps/tauri/src/assets/givethanks.csv and
// they are incorporated on the next build (Vite ?raw import, header row skipped).
import givethanksRaw from '../assets/givethanks.csv?raw';
const GIVE_THANKS: string[] = givethanksRaw
  .split(/\r?\n/).slice(1).map((s) => s.trim()).filter(Boolean);
/** Owner 2026-07-06: crowd QUIPS keyed by the FFB skill name the fans react to. */
const CROWD_QUIPS: Record<string, string> = { fend: 'Get fended, nerd!', 'stand firm': 'Like a rock!' };

// Upstream artwork is neither bundled nor fetched. A FUMBBL URL is only a stable
// lookup key for an installed local pack (or an existing pre-policy cache hit).
const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
async function resolveIconTextureSrc(url: string): Promise<string | ClassicIconTextureSource> {
  if (!/^https?:\/\//i.test(url)) return url; // relative / same-origin / local bundle
  if (!/^https?:\/\/(cdn\.|www\.)?fumbbl\.com\//i.test(url)) return url; // non-FUMBBL host
  return resolveRuntimeFumbblAsset(url);
}
setClassicIconTextureResolver(resolveIconTextureSrc);
setClassicIconUrlRewriter((url) => url);
// shadow-stripped iconsheets (queue item 2) are preferred when pre-processed
void loadShadowlessManifest();
// Installed local asset-pack art. The strict card
// resolver emits no speculative path before both manifests load; this ref makes
// inducement projections rerun once positive cache membership is knowable.
const inducementAssetManifestReady = ref(false);
void loadIconsetManifest().then(() => { inducementAssetManifestReady.value = true; });

// Connection/hotkey/marking settings live in the shared settings store,
// edited via the hamburger menu (App.vue) and persisted to localStorage.

// owner 2026-07-03 r6f: this view backs BOTH Spectate and Play. Play mode swaps the
// connect bar's Game-id/Spectate for a Game-name/Play (the future in-client joiner).
const props = withDefaults(defineProps<{ mode?: 'spectate' | 'play' | 'replay' }>(), { mode: 'spectate' });
// Owner 08-19: the endgame card's old #234 Play Game / Spectate Game pair (select-mode → the legacy
// in-game browser overlay popping over the end screen) is DEPRECATED. Endgame exits now ride
// 'end-game-exit' — App.vue tears the game down (confirm-free; the game is over) and lands on a BLADE.
const emit = defineEmits<{
  (e: 'end-game-exit', exit: EndGameExit): void;
  (e: 'open-menu'): void;
}>();
const isPlayMode = computed(() => props.mode === 'play');
const rejoinBrowserVisible = computed(() => shouldShowRejoinBrowser(
  ui.browserOpen,
  !!gameStore.game.value || gameStore.state.sessionState === 'joined',
));
function onEndGameExit(exit: EndGameExit) { emit('end-game-exit', exit); }
// Disconnect + session state moved to the header (App.vue) with Option A's connect-
// bar removal; see showDisconnect/sessionLabel there.

const gameId = ref(0);
const gameName = ref('');
// owner 2026-07-07: fork play-join now carries the coach's TEAM id (standalone loads teams/<id>.xml).
const playTeamId = ref('');
// #211 (owner, P1 recovery lane): the manual REJOIN-BY-ID field — a coach re-enters a wedged/de-cached game
// by its gameId alone (no name, no team). Distinct from the spectate `gameId` box: this joins AS THE COACH via
// gameStore.rejoinById (server matches the seat by coach NAME, keys on gameId>0 → DB recovery). String-typed so
// an empty box is distinguishable from game 0.
const rejoinGameId = ref('');
// FUMBBL live-play lobby (owner 2026-07-09): opening a FUMBBL player JNLP stashes its one-time
// -auth token + team here and opens the Browser AS A LOBBY — enter a game name to create/join a
// match (both coaches use the same name), or Join a live game from the list — instead of a blind
// team-only join. The token is spent on the chosen join (one-time); Cancel/disconnect clears it.
// Shared with the console Play blade so both surfaces spend the same one-time token through
// the same prepared-socket named-join implementation.
// JNLP-free FUMBBL login (owner 2026-07-09): mint a one-time token via FUMBBL's API instead
// of opening ffblive.jnlp. `fumbblNoJnlpTeamId` = the team the owner wants to play; `busy`
// guards the async mint; `error` surfaces a mint/credentials failure inline.
const fumbblNoJnlpTeamId = ref('');
const fumbblLoginBusy = ref(false);
const fumbblLoginError = ref<string | null>(null);
const chatInput = ref('');
const chatInputEl = ref<HTMLInputElement | null>(null);
const pitchHost = ref<HTMLDivElement | null>(null);
// defaults per owner 2026-07-02: Grass 1 turf, FUMBBL Classic sprites
// (HD-2D "New" set parked — see upgrades_parkinglot.md). The turf theme now
// lives in the shared settings store (owner 2026-07-03: moved off the quick
// config-bar into Settings → Client); `turfCatalog` mirrors renderer.turfOptions().
const spriteSet = ref<AppSettings['spriteSet']>(settings.spriteSet);
/** Floating WoW-style panel (owner 2026-07-02): Log | Chat | Roster tabs. */
const panelTab = ref<'log' | 'chat' | 'roster'>('log');
const rosterSide = ref<'home' | 'away'>('home');
const panelCollapsed = ref(false);
let renderer: PitchRenderer | null = null;
const FULLSCREEN_SOUTH_PAN_MIN = 120;
const FULLSCREEN_SOUTH_PAN_MAX = 220;
function syncFullscreenSouthPanRange() {
  const height = pitchHost.value?.clientHeight || window.innerHeight;
  const extension = document.fullscreenElement
    ? Math.min(FULLSCREEN_SOUTH_PAN_MAX, Math.max(FULLSCREEN_SOUTH_PAN_MIN, Math.round(height * 0.18)))
    : 0;
  renderer?.setSouthernPanExtension(extension);
}
let unregisterConfirmedMovementPresentation: (() => void) | null = null;
let unregisterKickElection: (() => void) | null = null;
let unregisterApothecaryElection: (() => void) | null = null;
let kickElectionRaf = 0;
const kickElectionIconFailed = ref(false);
const kickElectionTargets = ref<Array<{
  key: string;
  choice: 'normal' | 'kick';
  raw: [number, number];
  x: number;
  y: number;
  onPitch: boolean;
  iconOnly: boolean;
  stackIndex: 0 | 1;
  label: string;
}>>([]);

function stopKickElectionTracking(): void {
  cancelAnimationFrame(kickElectionRaf);
  kickElectionRaf = 0;
  kickElectionTargets.value = [];
}

function trackKickElection(): void {
  stopKickElectionTracking();
  const step = () => {
    kickElectionRaf = 0;
    const election = gameStore.kickElectionProjection('modern');
    const host = pitchHost.value;
    if (!election || !renderer || !host) { stopKickElectionTracking(); return; }
    kickElectionTargets.value = election.candidates.map((candidate) => {
      const pos = renderer!.squareToCanvas(candidate.anchor) ?? { x: host.clientWidth / 2, y: host.clientHeight / 2 };
      const iconOnly = candidate.primaryHitArea === 'icon';
      const stackDirection = pos.y > host.clientHeight / 2 ? -1 : 1;
      const stackOffset = candidate.stackIndex * (candidate.onPitch ? 0 : 30 * stackDirection);
      const marginX = candidate.onPitch ? 20 : 42;
      return {
        key: election.key,
        choice: candidate.choice,
        raw: candidate.raw,
        x: Math.min(Math.max(pos.x + (iconOnly ? 11 : 0), marginX), Math.max(host.clientWidth - marginX, marginX)),
        y: Math.min(Math.max(pos.y + stackOffset - (iconOnly ? 11 : 0), 20), Math.max(host.clientHeight - 20, 20)),
        onPitch: candidate.onPitch,
        iconOnly,
        stackIndex: candidate.stackIndex,
        label: candidate.label,
      };
    });
    kickElectionRaf = requestAnimationFrame(step);
  };
  step();
}

function chooseKickElection(target: (typeof kickElectionTargets.value)[number]): void {
  gameStore.resolveKickElection(target.key, target.choice, 'modern');
}

const chatEntries = computed(() => gameStore.state.log.filter((e) => e.kind === 'talk'));
// Owner 08-19: coach-name/message split for the chat pane — pure helper in game/chatLine.ts.
function chatParts(entry: { text: string }): { name: string; rest: string } {
  return chatLineParts(entry.text);
}
// Owner 2026-07-08: chat lives ONLY in the Chat tab now — occlude 'talk' lines from
// the Log pane so it stays a pure event log.
const logEntries = computed(() => visibleMatchLogEntries(gameStore.state.log, settings.showServerSequencingEvents));
// #157-v2 (owner 08-18): tint player names in the log by TEAM, relativised to the reader's SEAT.
// The tags come from the formatter (LogEntry.names), not from re-matching roster names against
// finished text -- a player called "Push" or a name carried by both rosters can no longer colour
// copy or the wrong side. Colours are the renderer's RESOLVED seat colours (the same source the
// pitch bodies use), read live so theming propagates and the view holds no hex of its own.
const seatTint = ref<{ home: string; away: string } | null>(null);
function refreshSeatTint() {
  if (!renderer) { seatTint.value = null; return; }
  const c = renderer.seatColors();
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  seatTint.value = { home: hex(c.home.trim), away: hex(c.away.trim) };
}
/**
 * SEAT MAPPING (the whole point of tagging the TEAM rather than a colour):
 *   playing seat  -> MY players take the friendly seat colour, the opponent's the enemy one,
 *                    whichever of home/away I actually am. Consistent all game, both seats.
 *   spectate/replay -> native home/away, untouched.
 * The pitch already renders the local coach's team in the home body colour (play mode keeps the
 * active/home seat at the bottom), so reusing home=friendly / away=enemy keeps the log in the
 * SAME hue family the pitch and coach panels use -- one palette, no drift.
 */
function logNameColor(team: LogNameTeam): string | undefined {
  const tint = seatTint.value;
  if (!tint) return undefined;
  return tint[logNameSeatKey(team, gameStore.mySeat.value)];
}
/** Cache segmented log entries; entries are immutable once pushed, so a WeakMap keyed on them is safe. */
type LogSegment = { t?: string; side?: LogNameTeam; pid?: string; tk?: LogTagKind; face?: 1 | 2 | 3 | 4 | 5 | 6; kind?: 'roll' | 'target'; blockFace?: BlockDieFaceValue; result?: string };
const logSegCache = new WeakMap<object, LogSegment[]>();
function logSegments(entry: { text: string; d6?: { index: number; value: 1 | 2 | 3 | 4 | 5 | 6; kind: 'roll' | 'target' }[]; blockDice?: BlockDieLogToken[]; names?: LogNameToken[]; tags?: LogTagToken[] }) {
  const hit = logSegCache.get(entry);
  if (hit) return hit;
  const segs: LogSegment[] = [];
  const faceParts = entry.blockDice?.length ? blockDieLogParts(entry) : d6LogParts(entry);
  // Dice parts, name tokens and decoration tags index the SAME text, so walk an absolute
  // cursor: a rendered die glyph consumes its own source length (one digit for a d6, the
  // result word for a block die). Owner 08-18: each text run splits by TAG first (titles /
  // the armour glyph), then the untagged pieces split by name -- tags and names never
  // overlap (a title is copy, a shield is a glyph), so nesting order is free.
  let at = 0;
  for (const part of faceParts) {
    if ('blockFace' in part && part.blockFace) { segs.push({ blockFace: part.blockFace, result: part.result }); at += part.result.length; continue; }
    if ('face' in part && part.face) { segs.push({ face: part.face, kind: part.kind }); at += 1; continue; }
    const text = part.text ?? '';
    for (const piece of logTagParts(text, at, entry.tags)) {
      if (piece.kind) { if (piece.text) segs.push({ t: piece.text, tk: piece.kind }); continue; }
      for (const named of logNameParts(piece.text, piece.start, entry.names)) {
        // Owner 08-19: `pid` makes the name CLICKABLE (locate cue) — additive, untagged names stay inert.
        if (named.text) segs.push(named.team ? { t: named.text, side: named.team, ...(named.playerId ? { pid: named.playerId } : {}) } : { t: named.text });
      }
    }
    at += text.length;
  }
  logSegCache.set(entry, segs);
  return segs;
}

// Owner 2026-07-08: the top-of-UI LIVE badge flashes brighter for ~1.4s each time a NEW
// spectator joins (store bumps `livePulse`), over its steady on-air pulse.
const liveFlashing = ref(false);
const liveSpectatorsExpanded = ref(false);
let liveFlashTimer = 0;
watch(() => gameStore.state.livePulse, (n, old) => {
  if (n <= (old ?? 0)) return;
  liveFlashing.value = true;
  clearTimeout(liveFlashTimer);
  liveFlashTimer = window.setTimeout(() => (liveFlashing.value = false), 1400);
});
watch(() => gameStore.state.spectatorCount, (count) => {
  if (count <= 0) liveSpectatorsExpanded.value = false;
});

const hudAccessibilityStyle = computed<Record<string, string>>(() => ({
  '--hud-coach-opacity': String(settings.hudCoachOpacity),
  '--hud-scoreboard-opacity': String(settings.hudScoreboardOpacity),
  '--hud-quickbar-opacity': String(settings.hudQuickBarOpacity),
  '--hud-toast-opacity': String(settings.hudToastOpacity),
}));

// --- B2-8/9/15 (UI7/UI8): log window customization + scroll behavior ---
const LOG_FONTS: Record<string, string> = {
  nuffle: "'Nuffle', system-ui, sans-serif",
  arial: 'Arial, Helvetica, sans-serif',
  mono: 'Consolas, "Courier New", monospace',
};
const panelSettingsOpen = ref(false);
const panelEl = ref<HTMLElement | null>(null);
/**
 * B9-17: the log panel is visually bottom-anchored (CSS `bottom: 56px`), but a
 * bottom-anchored element grows upward when resized from its SE edge. On mount
 * we capture the panel's current top/left into this LOCAL anchor (not persisted)
 * so the explicit resize grip grows it down/right. A user drag still overrides
 * it via settings.logPos.
 */
const panelAnchor = ref<{ x: number; y: number } | null>(null);
const panelViewport = ref({ width: window.innerWidth, height: window.innerHeight });
const logResizeOrigin = ref<{ x: number; y: number } | null>(null);
/** Owner default (2026-07-03): width = the quick-action bar, ~150px tall.
 *  Measured on mount; a persisted user resize (settings.logSize) overrides. */
const defaultPanelSize = ref<{ w: number; h: number } | null>(null);
const logEl = ref<HTMLElement | null>(null);
const chatEl = ref<HTMLElement | null>(null);
const logAtBottom = ref(true);
const chatAtBottom = ref(true);
const logNewEvents = ref(false);
const chatNewEvents = ref(false);
// Owner 2026-07-08: unread chat count → a badge on the CHAT tab (shown when toasts
// are disabled, so a missed line is still surfaced). Reset when the tab is opened.
const chatUnread = ref(0);

/** On replay load, keep the default Log clear of the transport. A coach's persisted Log position wins. */
function dodgeDefaultLogFromReplayControls(): void {
  if (props.mode !== 'replay' || settings.logPos || panelCollapsed.value) return;
  const panel = panelEl.value;
  const host = pitchHost.value;
  const controls = host?.querySelector('.replay-controls') as HTMLElement | null;
  if (!panel || !host || !controls) return;
  const hostRect = host.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const controlsRect = controls.getBoundingClientRect();
  panelAnchor.value = dodgePanelObstacle(
    { x: panelRect.left - hostRect.left, y: panelRect.top - hostRect.top },
    { width: panelRect.width, height: panelRect.height },
    {
      x: controlsRect.left - hostRect.left,
      y: controlsRect.top - hostRect.top,
      width: controlsRect.width,
      height: controlsRect.height,
    },
    { width: hostRect.width, height: hostRect.height },
    10,
  );
}
function logNameStyle(team: LogNameTeam): Record<string, string> | undefined {
  const color = logNameColor(team);
  return color ? { color, '--log-seat-glow': color } : undefined;
}

const panelStyle = computed(() => {
  const style: Record<string, string> = { '--log-panel-opacity': String(settings.logOpacity) };
  // Owner: minimizing (▾) DOCKS the bar just to the RIGHT of the quick-action
  // buttons instead of leaving the floating strip wherever the window was.
  // Owner 2026-07-03: the config-bar moved under the top-left panel, so read its
  // live position rather than assuming a bottom-left anchor.
  if (panelCollapsed.value) {
    void topPanelBox.value; // recompute when the config-bar repositions
    const bar = document.querySelector('.config-bar') as HTMLElement | null;
    const host = pitchHost.value;
    if (bar && host) {
      const br = bar.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      // Owner 2026-07-08: swapped → the Quick bar is bottom-right, so dock the
      // minimized Log to its LEFT (anchored by `right`) instead of its right.
      if (settings.bottomBarsSwapped) {
        return {
          ...style,
          right: `${Math.round(hr.right - br.left + 8)}px`,
          top: `${Math.round(br.top - hr.top)}px`,
          left: 'auto',
          bottom: 'auto',
          width: 'auto',
          height: 'auto',
        };
      }
      return {
        ...style,
        left: `${Math.round(br.right - hr.left + 8)}px`,
        top: `${Math.round(br.top - hr.top)}px`,
        right: 'auto',
        bottom: 'auto',
        width: 'auto',
        height: 'auto',
      };
    }
    return { ...style, left: '14px', top: '14px', right: 'auto', bottom: 'auto', width: 'auto', height: 'auto' };
  }
  // top-anchor the panel (dragged position wins, else the mount-captured anchor)
  // so the explicit SE grip grows the panel down/right instead of upward.
  const pos = settings.logPos ?? panelAnchor.value;
  if (pos) {
    const size = settings.logSize ?? defaultPanelSize.value ?? { w: 360, h: 150 };
    Object.assign(style, resizablePanelStyle(
      pos, { width: size.w, height: size.h }, panelViewport.value, logResizeOrigin.value,
    ));
  }
  const size = settings.logSize ?? defaultPanelSize.value;
  if (size && !panelCollapsed.value) {
    style.width = `${size.w}px`;
    style.height = `${size.h}px`;
  }
  return style;
});
// Owner 2026-07-08: toggling the bottom-bar swap moves the Log's DEFAULT corner
// (data-swapped CSS). The mount-captured `panelAnchor` holds an inline left/top
// that would override the CSS, so re-capture it: drop the anchor to fall back to
// the CSS default, let it lay out, then re-anchor. A user-dragged panel
// (settings.logPos) keeps its position.
watch(() => settings.bottomBarsSwapped, async () => {
  if (settings.logPos) return;
  panelAnchor.value = null;
  await nextTick();
  if (panelEl.value && !panelCollapsed.value) {
    panelAnchor.value = { x: panelEl.value.offsetLeft, y: panelEl.value.offsetTop };
  }
});
const logTextStyle = computed(() => ({
  fontSize: `${settings.logFontSize}px`,
  fontFamily: LOG_FONTS[settings.logFont] ?? LOG_FONTS.nuffle!,
}));

// Owner 2026-07-03: the quick config-bar sits UNDER the top-left coach panel and
// matches its WIDTH. Measured from `.coach-panel.home` on mount + on layout
// changes; the bar wraps its buttons to fit (flex-wrap). Null (no game yet) →
// the CSS fallback position applies.
const topPanelBox = ref<{ left: number; bottom: number; width: number } | null>(null);
// Owner 2026-07-05: the CENTER panel (scoreboard) left edge, host-relative — anchors
// the floating turn-timer's default position (re-measured whenever the UI reflows).
const centerPanelBox = ref<{ left: number; top: number; center: number; bottom: number } | null>(null);
// Keep the spectator/replay-only Sketch launcher immediately left of the recording
// indicator (or the brand plate when nobody is watching). Both axes are measured from
// the live quick bar so swapped/customized/resized layouts stay aligned.
const telestratorBottom = ref(72);
const telestratorRight = ref(12);
// Owner 09-06: quick-bar LEFT/RIGHT edges (host coords) — the Sketch launcher docks left of the bar and the
// player card docks above it, right edges aligned.
const quickBarLeft = ref<number | null>(null);
const quickBarRight = ref<number | null>(null);
// Bottom (host coords) of the whole top-left stack (coach panel + config-bar) —
// anchors the incoming-chat toast just below it.
const leftStackBottom = ref<number | null>(null);
function measureTopPanel() {
  const el = document.querySelector('.coach-panel.home') as HTMLElement | null;
  const host = pitchHost.value;
  if (!host) {
    topPanelBox.value = null;
    leftStackBottom.value = null;
    telestratorBottom.value = 72;
    telestratorRight.value = 12;
    quickBarLeft.value = null; quickBarRight.value = null;
    return;
  }
  const hr = host.getBoundingClientRect();
  const quickBar = document.querySelector('.config-bar') as HTMLElement | null;
  telestratorBottom.value = quickBar
    ? Math.max(8, Math.round(hr.bottom - quickBar.getBoundingClientRect().top + 8))
    : 72;
  if (quickBar) {
    const qr = quickBar.getBoundingClientRect();
    quickBarLeft.value = Math.round(qr.left - hr.left);
    quickBarRight.value = Math.round(hr.right - qr.right);
  } else { quickBarLeft.value = null; quickBarRight.value = null; }
  const sketchNeighbour = document.querySelector('.quick-live, .quick-super-logo') as HTMLElement | null;
  telestratorRight.value = sketchNeighbour
    ? Math.max(8, Math.round(hr.right - sketchNeighbour.getBoundingClientRect().left + 8))
    : 12;
  if (!el) {
    topPanelBox.value = null;
    leftStackBottom.value = null;
    return;
  }
  const r = el.getBoundingClientRect();
  // Measure the live transformed panel. For the stock corner, normalize the transient
  // active-seat emphasis back to the responsive CSS base scale; for an owner-positioned
  // panel, retain its actual persisted scale. This keeps the quick bar stable while also
  // respecting <=1000px and custom UI scales (the old fixed .864 missed both).
  const renderedWidth = r.width;
  const customScale = settings.uiLayout['coach-home']?.scale;
  const computed = getComputedStyle(el);
  const matrix = computed.transform.match(/^matrix\(([^)]+)\)$/)?.[1]
    ?.split(',').map((part) => Number.parseFloat(part.trim()));
  const renderedScale = matrix && matrix.length >= 2
    ? Math.hypot(matrix[0] ?? 1, matrix[1] ?? 0)
    : Number.parseFloat(computed.transform.match(/^scale\(([^)]+)\)$/)?.[1] ?? '1');
  const responsiveBaseScale = Number.parseFloat(computed.getPropertyValue('--coach-panel-base-scale'));
  const baseWidth = stableCoachPanelWidth(
    renderedWidth, renderedScale, responsiveBaseScale, customScale != null,
  );
  topPanelBox.value = { left: r.left - hr.left, bottom: r.bottom - hr.top, width: baseWidth };
  // chat toast sits just below the coach panel (the config-bar moved to the
  // bottom-left, owner 2026-07-03 r4, so it no longer extends this stack)
  leftStackBottom.value = r.bottom - hr.top;
  // Owner 2026-07-05: measure the CENTER panel (scoreboard) left edge for the timer.
  const sb = document.querySelector('.hud-center.scoreboard') as HTMLElement | null;
  if (sb) {
    const sr = sb.getBoundingClientRect();
    centerPanelBox.value = {
      left: sr.left - hr.left,
      top: sr.top - hr.top,
      center: (sr.left + sr.right) / 2 - hr.left,
      bottom: sr.bottom - hr.top,
    };
  } else {
    centerPanelBox.value = null;
  }
}
// Owner 2026-07-03 r4: the quick config-bar sits at the BOTTOM-LEFT of the screen
// again, but keeps the coach-panel-matched WIDTH (measured on mount + resize).
const configBarStyle = computed(() => {
  const custom = uiPanelStyle('config-bar');
  if (custom) return custom; // owner 2026-07-04e: a customized position wins
  const box = topPanelBox.value;
  // Owner 2026-07-08: when the bottom bars are swapped, the Quick bar sits at the
  // bottom-RIGHT (the Log takes the bottom-left, reading-order lead).
  const swapped = settings.bottomBarsSwapped;
  return {
    ...(swapped ? { right: '14px', left: 'auto' } : { left: '14px', right: 'auto' }),
    bottom: '12px',
    top: 'auto',
    // owner 2026-07-03 r6f: a MIN width (not a hard width) so the bar keeps the
    // coach-panel width but grows to hold every button on one line (flex-nowrap).
    ...(box ? { minWidth: `${Math.round(box.width)}px` } : {}),
  };
});

// --- Owner 2026-07-04e: UI-customize mode (grip/resizer on the corner panels) ---
/** Style override for a customizable panel — absolute position + scale from
 *  settings.uiLayout, or null (keep the CSS default) until the user moves it. */
function uiPanelStyle(id: string): Record<string, string> | null {
  const L = settings.uiLayout[id];
  if (!L) return null;
  const scale = L.scale * (coachPanelIsPlaying(id) ? COACH_ACTIVE_SCALE_MULTIPLIER : 1);
  return scaledPanelStyle(L, scale, !!panelScaleResizeActive[id]);
}
/** Bind on each customizable panel (merges with any panel-specific style). */
function customPanelStyle(id: string): Record<string, string> {
  return uiPanelStyle(id) ?? {};
}
const panelScaleResizeActive = reactive<Record<string, boolean>>({});
const COACH_ACTIVE_SCALE_MULTIPLIER = 1.09;
function coachPanelIsPlaying(id: string): boolean {
  if (id === 'coach-home') return gameStore.state.playingIsHome;
  if (id === 'coach-away') return !gameStore.state.playingIsHome;
  return false;
}
function ensurePanelEntry(id: string, el: HTMLElement) {
  if (settings.uiLayout[id]) return settings.uiLayout[id]!;
  const host = pitchHost.value;
  if (!host) return null;
  const entry = captureScaledPanelLayout(el, host);
  // Persist the resting scale. A coach panel captured during its active grow
  // should still shrink when the turn passes and grow again on its next turn.
  if (coachPanelIsPlaying(id)) entry.scale /= COACH_ACTIVE_SCALE_MULTIPLIER;
  settings.uiLayout[id] = entry;
  return entry;
}
function uiPanelOf(target: EventTarget | null): HTMLElement | null {
  return (target as HTMLElement | null)?.closest('.ui-panel') as HTMLElement | null;
}
function startPanelMove(id: string, ev: PointerEvent) {
  if (!settings.uiCustomize) return;
  ev.preventDefault(); ev.stopPropagation();
  const panel = uiPanelOf(ev.target);
  const host = pitchHost.value;
  if (!panel || !host) return;
  const entry = ensurePanelEntry(id, panel);
  if (!entry) return;
  const hr = host.getBoundingClientRect();
  const rect = panel.getBoundingClientRect();
  const startX = ev.clientX, startY = ev.clientY;
  const current = resolvePanelPosition(entry, { width: rect.width, height: rect.height }, { width: hr.width, height: hr.height });
  const ox = current.x, oy = current.y;
  const move = (e: PointerEvent) => {
    settings.uiLayout[id] = {
      ...entry,
      ...anchorPanelPosition(
        { x: ox + (e.clientX - startX), y: oy + (e.clientY - startY) },
        { width: rect.width, height: rect.height },
        { width: hr.width, height: hr.height },
      ),
    };
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
function startPanelResize(id: string, ev: PointerEvent) {
  if (!settings.uiCustomize) return;
  ev.preventDefault(); ev.stopPropagation();
  const panel = uiPanelOf(ev.target);
  const host = pitchHost.value;
  if (!panel || !host) return;
  const entry = ensurePanelEntry(id, panel);
  if (!entry) return;
  beginScaledPanelResize({
    event: ev,
    panel,
    host,
    entry,
    // Owner 09-06: coach corner panels floor at 0.5 — the 64 px inducement icons never draw under 32 px (two per row
    // at the minimum); every panel is boundary-locked inside the pitch host by the controller.
    minScale: id === 'coach-home' || id === 'coach-away' ? 0.5 : undefined,
    write: (next) => { settings.uiLayout[id] = next; },
    setActive: (active) => {
      if (active) panelScaleResizeActive[id] = true;
      else delete panelScaleResizeActive[id];
    },
  });
}
function resetPanel(id: string) { delete settings.uiLayout[id]; }

// Owner 2026-07-06: when the WINDOW shrinks, a persisted/dragged UI element (the
// floating log-chat window via settings.logPos, or a customize-moved corner panel /
// scoreboard / quick config-bar via settings.uiLayout) can end up off-screen. Re-clamp
// every such element to the viewport on resize so it always stays fully visible (or,
// if it is larger than the viewport, pinned to the top-left so it stays grabbable).
const UI_PANEL_SELECTORS: Record<string, string> = {
  'coach-home': '.coach-panel.home',
  'coach-away': '.coach-panel.away',
  scoreboard: '.hud-center.scoreboard',
  'config-bar': '.config-bar',
};
function clampUiToViewport() {
  const hostRect = pitchHost.value?.getBoundingClientRect();
  setupBrowserViewport.value = {
    width: hostRect?.width ?? window.innerWidth,
    height: hostRect?.height ?? window.innerHeight,
  };
  const setupBrowser = setupTemplatePanelEl.value;
  if (settings.setupBrowserPos && setupBrowser) {
    const rect = setupBrowser.getBoundingClientRect();
    persistClampedPanelPosition(
      settings.setupBrowserPos,
      { width: rect.width, height: rect.height },
      setupBrowserViewport.value,
      (next) => { settings.setupBrowserPos = next; },
    );
  }
  // floating log-chat window (only when the user has DRAGGED it — settings.logPos;
  // the un-dragged panel is reanchored to the bottom-right by reanchorPanel).
  const panel = panelEl.value;
  if (settings.logPos && panel) {
    const parent = panel.offsetParent as HTMLElement | null;
    const viewport = { width: parent?.clientWidth ?? window.innerWidth, height: parent?.clientHeight ?? window.innerHeight };
    const size = { width: panel.getBoundingClientRect().width, height: panel.getBoundingClientRect().height };
    persistClampedPanelPosition(settings.logPos, size, viewport, (next) => { settings.logPos = next; });
  }
  // customize-mode corner panels / scoreboard / config-bar (settings.uiLayout).
  for (const id of Object.keys(settings.uiLayout)) {
    const L = settings.uiLayout[id];
    if (!L) continue;
    const el = UI_PANEL_SELECTORS[id] ? (document.querySelector(UI_PANEL_SELECTORS[id]!) as HTMLElement | null) : null;
    if (!el) continue;
    const host = pitchHost.value;
    const hr = host?.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const viewport = { width: hr?.width ?? window.innerWidth, height: hr?.height ?? window.innerHeight };
    persistClampedPanelPosition(L, { width: rect.width, height: rect.height }, viewport, (next) => {
      settings.uiLayout[id] = next;
    });
  }
}

function onLogScroll(which: 'log' | 'chat', event: Event) {
  const el = event.target as HTMLElement;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
  if (which === 'log') {
    logAtBottom.value = atBottom;
    if (atBottom) logNewEvents.value = false;
  } else {
    chatAtBottom.value = atBottom;
    if (atBottom) chatNewEvents.value = false;
  }
  // owner 2026-07-03 r6: after interacting (scrolling up), arm a 10s idle timer —
  // when it lapses (and the mouse isn't hovering the log) snap back to the newest
  // event; if already at the bottom, nothing to do.
  if (atBottom) clearTimeout(logIdleTimer);
  else armLogIdle();
}
let logIdleTimer = 0;
const logHovered = ref(false);
const LOG_IDLE_MS = 10000;
function armLogIdle() {
  clearTimeout(logIdleTimer);
  logIdleTimer = window.setTimeout(() => {
    if (logHovered.value) {
      armLogIdle(); // still hovering — wait, then re-check
      return;
    }
    if (panelTab.value === 'chat') {
      chatAtBottom.value = true;
      chatNewEvents.value = false;
      jumpToBottom('chat');
    } else {
      logAtBottom.value = true;
      logNewEvents.value = false;
      jumpToBottom('log');
    }
  }, LOG_IDLE_MS);
}
function onLogHover(hovering: boolean) {
  logHovered.value = hovering;
  // start a fresh 10s countdown once the mouse leaves (if scrolled up)
  if (!hovering && !(panelTab.value === 'chat' ? chatAtBottom.value : logAtBottom.value)) armLogIdle();
}

function jumpToBottom(which: 'log' | 'chat') {
  const el = which === 'log' ? logEl.value : chatEl.value;
  if (el) el.scrollTop = el.scrollHeight;
  if (which === 'log') logNewEvents.value = false;
  else chatNewEvents.value = false;
}

// UI8: stick to bottom unless the user scrolled up — then freeze the view
// and surface a "new events" pill that jumps back down
watch(
  () => logEntries.value.length,
  async () => {
    await nextTick();
    if (!logEl.value) return;
    if (logAtBottom.value) logEl.value.scrollTop = logEl.value.scrollHeight;
    else logNewEvents.value = true;
  },
);
watch(
  () => chatEntries.value.length,
  async () => {
    await nextTick();
    if (!chatEl.value) return;
    if (chatAtBottom.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
    else chatNewEvents.value = true;
  },
);
// Owner 09-08: the log/chat <pre> is v-if'd per tab, so jumping to the tab (or un-collapsing onto it) mounts a
// fresh element at scrollTop 0 — the reader landed on the OLDEST lines. A freshly shown tab always opens at the
// bottom (newest event), which also re-arms the stick-to-bottom follow.
watch(
  () => [panelTab.value, panelCollapsed.value] as const,
  async ([tab, collapsed]) => {
    if (collapsed || (tab !== 'log' && tab !== 'chat')) return;
    await nextTick();
    if (tab === 'log') logAtBottom.value = true; else chatAtBottom.value = true;
    jumpToBottom(tab);
  },
);

// Owner (2026-07-03): an incoming CHAT line from another coach pops a toast in
// the top-left (under the home coach panel) when the chat tab isn't focused, so
// a playing/spectating user doesn't miss it. Clicking a toast opens chat.
// Owner 2026-07-07: STACK up to 3 — a new line fills in at the bottom and pushes
// the older toasts up; a 4th drops the oldest off the top.
let chatToastId = 0;
const CHAT_TOAST_MAX = 3;
const chatToasts = reactive<{ id: number; sender: string; text: string; side: ChatAuthorSide; timer: number }[]>([]);
function removeChatToast(id: number) {
  const i = chatToasts.findIndex((t) => t.id === id);
  if (i >= 0) {
    clearTimeout(chatToasts[i]!.timer);
    chatToasts.splice(i, 1);
  }
}
function clearChatToasts() {
  for (const toast of chatToasts) window.clearTimeout(toast.timer);
  chatToasts.splice(0);
}
const chatPaneOpen = computed(() => settings.chatPoppedOut || (panelTab.value === 'chat' && !panelCollapsed.value));
useChatToastQuietClear({
  open: () => chatPaneOpen.value,
  // The store caps logs at 400 entries, so length can remain unchanged while a
  // newly appended talk entry replaces the oldest. Object identity preserves
  // that occurrence signal at the cap.
  chatRevision: () => chatEntries.value.at(-1) ?? null,
  clearToasts: clearChatToasts,
});
// Position chat toasts from settings; cinematic zoom owns focus (the spotlight veil was ripped 09-06).

// Owner 2026-07-08: the bottom-left chat toast now DODGES the Log panel (which moved to the
// bottom-left in case 424). When the Log is visible in the bottom-left region, the toast rides
// just above its top edge instead of overlapping it; otherwise it keeps the normal bottom anchor.
const logToastClearance = ref(0);
function updateLogToastClearance() {
  const panel = panelEl.value;
  const host = pitchHost.value;
  if (!panel || !host || panelCollapsed.value) { logToastClearance.value = 0; return; }
  const pr = panel.getBoundingClientRect();
  const hr = host.getBoundingClientRect();
  // only dodge when the Log panel actually sits in the bottom-left (where a bottomLeft toast lands)
  const logIsBottomLeft = pr.left - hr.left < hr.width * 0.45 && pr.bottom - hr.top > hr.height * 0.5;
  logToastClearance.value = logIsBottomLeft ? Math.round(hr.bottom - pr.top + 10) : 0;
}
watch(() => chatToasts.length, () => { if (chatToasts.length) updateLogToastClearance(); });

const chatToastStyle = computed(() => {
  const base: Record<string, string> = { top: 'auto', bottom: 'auto', left: 'auto', right: 'auto', transform: 'none' };
  switch (settings.chatToastPos) {
    case 'right': return { ...base, top: '86px', right: '12px' };
    case 'bottomLeft': return { ...base, bottom: `${logToastClearance.value || 58}px`, left: '12px' };
    case 'top': return { ...base, top: '8px', left: '50%', transform: 'translateX(-50%)' };
    case 'center': return { ...base, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    case 'left': // owner 08-19: center-left — top-left collided with the corner panel
    default: return { ...base, top: '50%', left: '12px', transform: 'translateY(-50%)' };
  }
});
watch(
  () => chatEntries.value,
  (entries, previous = []) => {
    const incoming = newlyAppendedChatOccurrences(entries, previous);
    for (const entry of incoming) {
    // talk lines are logged as "<coach>: <message>"
    const sep = entry.text.indexOf(': ');
    const sender = sep > 0 ? entry.text.slice(0, sep) : '';
    const body = sep > 0 ? entry.text.slice(sep + 2) : entry.text;
    // don't nag when the chat window is already focused, or it's the user's own line.
    // Owner ruling 2026-08-17: a POPPED-OUT chat panel is always on screen, so it counts as
    // focused too — no toast when the panel itself is showing the line.
    if ((panelTab.value === 'chat' && !panelCollapsed.value) || settings.chatPoppedOut) continue;
    const localCoach = (settings.activeServerTarget === 'fork' ? settings.coach40k : settings.coach)
      .trim().toLowerCase();
    if (localCoach && sender.trim().toLowerCase() === localCoach) continue;
    // owner ruling 2026-08-17: chat disabled — suppress DISPLAY only (badge + toast); the
    // line is already stored in chatEntries, so history is intact if chat is re-enabled.
    if (settings.chatDisabled) continue;
    // owner 2026-07-08: count the unread line(s) for the CHAT-tab badge (surfaced when
    // toasts are off) — the reset watcher below clears it when the tab is opened. Use the
    // length delta so a batch of lines arriving in one tick all count.
    chatUnread.value += 1;
    // owner 2026-07-08: toasts can be disabled — then the badge is the only surfacing.
    if (!settings.chatToastsEnabled) continue;
    const id = ++chatToastId;
    const timer = scheduleAuthoredChatToastExpiry(id, removeChatToast);
    chatToasts.push({ id, sender, text: body, side: entry.side ?? 'unknown', timer });
    playSound('chatToast');
    // owner 2026-07-07: cap at 3 on screen — the oldest drops off (pushed up and out)
    while (chatToasts.length > CHAT_TOAST_MAX) {
      const dropped = chatToasts.shift();
      if (dropped) clearTimeout(dropped.timer);
    }
    }
  },
);
onBeforeUnmount(clearChatToasts);
// Owner 08-17 (row2): waiting-for-opponent's-interceptor-choice toast — pure computed off
// gameStore.interceptWait (server-derived), no timer; text is empty and the toast hides the
// instant the store predicate clears (window ends / game changes / reconnect).
const interceptWaitText = computed(() => {
  const w = gameStore.interceptWait.value;
  if (!w) return '';
  // Owner 09-05: a short toast line — the pass result and destination already read on the pitch (dice pill,
  // destination marker), so the wait line names only what we are waiting for.
  void w;
  return 'Waiting for interceptor choice';
});
// owner 2026-07-07: the store's defenderAction notice rides the chat-toast stack (reuses its
// positioning + stacking). A short 6s toast, no sender. Owed a live pass (demo can't fire it).
watch(
  () => gameStore.state.defenderNotice?.seq,
  (seq) => {
    if (!seq) return;
    const text = gameStore.state.defenderNotice?.text ?? '';
    if (!text) return;
    const id = ++chatToastId;
    const timer = window.setTimeout(() => removeChatToast(id), 6000);
    chatToasts.push({ id, sender: '', text, side: 'unknown', timer });
    while (chatToasts.length > CHAT_TOAST_MAX) {
      const dropped = chatToasts.shift();
      if (dropped) clearTimeout(dropped.timer);
    }
  },
);
// owner 2026-07-10: server-side messages (informationOkay e.g. a Weather Mage change; "concede request
// not granted") used to ride the chat-toast stack — the owner wants them as a prominent CENTER-LEFT modal
// instead of buried in chat. Now rendered as the `.server-notice` card (see template); this watcher just
// auto-clears it after a readable window so an informational message doesn't linger (a Dismiss button also
// clears it, and a new message replaces the old via its seq).
let infoNoticeTimer = 0;
watch(
  () => gameStore.state.infoNotice?.seq,
  (seq) => {
    if (!seq) return;
    if (infoNoticeTimer) window.clearTimeout(infoNoticeTimer);
    infoNoticeTimer = window.setTimeout(() => { gameStore.state.infoNotice = null; infoNoticeTimer = 0; }, 8000);
  },
);
// owner 2026-07-10 (g315): the store's action-drop notice — a block/action the client sent that
// the server never answered. Rides the chat-toast stack so a silent drop becomes visible feedback.
watch(
  () => gameStore.state.actionNotice?.seq,
  (seq) => {
    if (!seq) return;
    const text = gameStore.state.actionNotice?.text ?? '';
    if (!text) return;
    const id = ++chatToastId;
    const timer = window.setTimeout(() => removeChatToast(id), 6000);
    chatToasts.push({ id, sender: '', text, side: 'unknown', timer });
    while (chatToasts.length > CHAT_TOAST_MAX) {
      const dropped = chatToasts.shift();
      if (dropped) clearTimeout(dropped.timer);
    }
  },
);
function openChatFromToast() {
  panelTab.value = 'chat';
  panelCollapsed.value = false;
}
// owner 2026-07-08: opening (or un-collapsing onto) the Chat tab clears the unread badge.
watch(
  () => [panelTab.value, panelCollapsed.value, settings.chatPoppedOut] as const,
  ([tab, collapsed, poppedOut]) => {
    if ((tab === 'chat' && !collapsed) || poppedOut) chatUnread.value = 0;
  },
);
// owner ruling 2026-08-17: disabling chat while the Chat tab is active falls back to Log
// rather than leaving the panel on a now-hidden tab (never a blank panel).
watch(
  () => settings.chatDisabled,
  (disabled) => {
    if (disabled && panelTab.value === 'chat') panelTab.value = 'log';
    // disabled WINS: a popped-out panel docks, so "chat off" leaves nothing on screen.
    if (disabled) settings.chatPoppedOut = false;
  },
);

// Owner ruling 2026-08-17 (rebuilt 08-18): Pop-Out Chat. All the floating-window mechanics
// (drag / clamp / resize persistence / teleport) live in components/ChatDock.vue; this pair
// is just the state flip. Popping out leaves panelTab where it is — the docked window is free
// to show LOG or ROSTER while chat floats.
function popOutChat() {
  if (settings.chatDisabled) return;
  settings.chatPoppedOut = true;
}
// Owner 08-19: while popped out the CHAT tab is gone from the row — a panel left on the
// now-absent tab falls back to LOG (never a blank panel; same rule as chatDisabled above).
// `immediate` covers a persisted chatPoppedOut=true at mount.
watch(() => settings.chatPoppedOut, (popped) => {
  if (popped && panelTab.value === 'chat') panelTab.value = 'log';
}, { immediate: true });
function dockChat() {
  settings.chatPoppedOut = false;
  panelTab.value = 'chat';
  panelCollapsed.value = false;
}

// UI7 / B9-12: drag the floating log window by its tab bar. Uses pointer capture
// + viewport coords so the drag can't be interrupted and works in every state
// (incl. right after a resize). Position persists in settings.logPos.
let panelDrag: { startX: number; startY: number; origX: number; origY: number; grip: HTMLElement } | null = null;
function startPanelDrag(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('button')) return; // tab buttons stay clickable
  const el = panelEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  // parent offset so logPos (left/top, relative to the offset parent) is correct
  const host = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
  panelDrag = {
    startX: event.clientX,
    startY: event.clientY,
    origX: rect.left - (host?.left ?? 0),
    origY: rect.top - (host?.top ?? 0),
    grip: event.currentTarget as HTMLElement,
  };
  panelDrag.grip.setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', onPanelDrag);
  window.addEventListener('pointerup', endPanelDrag, { once: true });
  event.preventDefault();
}
function onPanelDrag(event: PointerEvent) {
  if (!panelDrag) return;
  const el = panelEl.value;
  const parent = el?.offsetParent as HTMLElement | null;
  const viewport = { width: parent?.clientWidth ?? window.innerWidth, height: parent?.clientHeight ?? window.innerHeight };
  const rect = el?.getBoundingClientRect();
  settings.logPos = anchorPanelPosition(
    { x: panelDrag.origX + event.clientX - panelDrag.startX, y: panelDrag.origY + event.clientY - panelDrag.startY },
    { width: rect?.width ?? 0, height: rect?.height ?? 0 },
    viewport,
  );
}
function endPanelDrag(event?: PointerEvent) {
  window.removeEventListener('pointermove', onPanelDrag);
  if (event && panelDrag) panelDrag.grip.releasePointerCapture?.(event.pointerId);
  panelDrag = null;
}

let logResize: {
  startX: number;
  startY: number;
  width: number;
  height: number;
  pointerId: number;
  grip: HTMLElement;
} | null = null;
let cancelLogResizeCompletion: (() => void) | null = null;

function startLogResize(event: PointerEvent) {
  if (panelCollapsed.value) return;
  const el = panelEl.value;
  if (!el) return;
  cancelLogResize(false);
  const rect = el.getBoundingClientRect();
  const parentRect = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
  logResizeOrigin.value = { x: rect.left - (parentRect?.left ?? 0), y: rect.top - (parentRect?.top ?? 0) };
  const grip = event.currentTarget as HTMLElement;
  logResize = {
    startX: event.clientX,
    startY: event.clientY,
    width: rect.width,
    height: rect.height,
    pointerId: event.pointerId,
    grip,
  };
  grip.setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', moveLogResize);
  cancelLogResizeCompletion = bindPointerCompletion(window, grip, finishLogResize);
  event.preventDefault();
  event.stopPropagation();
}

function moveLogResize(event: PointerEvent) {
  const active = logResize;
  const el = panelEl.value;
  if (!active || !el || event.pointerId !== active.pointerId) return;
  const parent = el.offsetParent as HTMLElement | null;
  const maxWidth = Math.max(240, (parent?.clientWidth ?? window.innerWidth) * 0.8);
  const maxHeight = Math.max(88, (parent?.clientHeight ?? window.innerHeight) * 0.8);
  settings.logSize = {
    w: Math.min(maxWidth, Math.max(240, active.width + event.clientX - active.startX)),
    h: Math.min(maxHeight, Math.max(88, active.height + event.clientY - active.startY)),
  };
}

function finishLogResize() {
  window.removeEventListener('pointermove', moveLogResize);
  cancelLogResizeCompletion?.();
  cancelLogResizeCompletion = null;
  const active = logResize;
  logResize = null;
  if (active) {
    try { active.grip.releasePointerCapture?.(active.pointerId); } catch { /* already released */ }
  }
  const el = panelEl.value;
  const origin = logResizeOrigin.value;
  if (!el || !origin) { logResizeOrigin.value = null; return; }
  const parent = el.offsetParent as HTMLElement | null;
  const rect = el.getBoundingClientRect();
  settings.logPos = anchorPanelPosition(
    origin,
    { width: rect.width, height: rect.height },
    { width: parent?.clientWidth ?? window.innerWidth, height: parent?.clientHeight ?? window.innerHeight },
  );
  logResizeOrigin.value = null;
}

function cancelLogResize(clearOrigin = true) {
  window.removeEventListener('pointermove', moveLogResize);
  cancelLogResizeCompletion?.();
  cancelLogResizeCompletion = null;
  const active = logResize;
  logResize = null;
  if (active) {
    try { active.grip.releasePointerCapture?.(active.pointerId); } catch { /* already released */ }
  }
  if (clearOrigin) logResizeOrigin.value = null;
}

/** Acquired (non-baseline) skills, shown right of the name in the roster. */
function acquiredSkills(player: PlayerJson, team: { roster: unknown }): string {
  const positions = (team.roster as { positionArray?: { positionId: string; skillArray?: string[] }[] })
    .positionArray ?? [];
  const baseline = new Set(positions.find((p) => p.positionId === player.positionId)?.skillArray ?? []);
  return playerSkillNames(player).filter((s) => !baseline.has(s)).join(', '); // base + temporary grants
}

// owner 2026-07-02 (UI-5): HD-2D removed from the picker (set stays parked);
// FUMBBL's checker-disc mode replaces it
const SPRITE_SET_LABELS: Record<string, string> = {
  classic: 'Super FUMBBL', checkers: 'FUMBBL Checkers', walk: 'Super FUMBBL',
};
/** Owner 2026-09-04: FUMBBL modes are offered only when an installed pack supplies FUMBBL iconsets. */
const availableSpriteSets = computed<AppSettings['spriteSet'][]>(() => {
  const fumbbl = assetMods.installed.some((pack) => pack.capabilities.some((name) => name === 'player-iconsets' || name === 'fumbbl-id-images'));
  return fumbbl ? ['walk', 'checkers'] : ['walk']; // owner 09-05: no separate Classic mode — mods ride the chain
});

/** Match11: all display states, including a real Off state, live on the quick bar. */
const TZ_MODES = ['opposition', 'friendly', 'both', 'off'] as const;
const TZ_LABELS: Record<string, string> = { opposition: 'Opposition', friendly: 'Friendly', both: 'Both', off: 'Off' };
const tackleZonesActive = computed(() => settings.tackleZoneMode !== 'off');

function cycleTackleZones() {
  const next = TZ_MODES[(TZ_MODES.indexOf(settings.tackleZoneMode) + 1) % TZ_MODES.length]!;
  settings.tackleZoneMode = next;
}

// In-game control owns presentation only. Pack selection lives in Settings → UI.
const SKILL_MODES = ['icons', 'markings'] as const;
type SkillMode = (typeof SKILL_MODES)[number];
const SKILL_MODE_SHORT: Record<SkillMode, string> = { icons: '🖼', markings: 'ABC' };
const SKILL_MODE_LABELS: Record<SkillMode, string> = {
  icons: 'Skill icons',
  markings: 'Skill markings',
};
const skillMode = computed<SkillMode>(() => settings.skillDisplay === 'markings' ? 'markings' : 'icons');
// Retained only for the renderer's compatibility signature; pack choice is the shared snapshot.
const effectiveIconStyle = computed<'bb3'>(() => 'bb3');
function skillIconUrl(
  skill: string,
  style: 'bb2' | 'bb3' = 'bb3',
  context?: { positionId?: string | null; side?: 'home' | 'away' | null },
): string {
  return reactiveSkillIconUrl(skill, style, context);
}
const kickElectionIconUrl = computed(() => skillIconUrl('Kick', effectiveIconStyle.value));
function cycleSkillDisplay() {
  toggleSkillDisplay(settings);
}

function setTelestratorPosition(position: EdgePanelPosition | null): void {
  if (!position) {
    delete settings.uiLayout.telestrator;
    return;
  }
  settings.uiLayout.telestrator = { ...position, scale: 1 };
}

/**
 * BB3-style config buttons (owner 2026-07-02): the menubar pickers' functionality
 * moves here — settings, tackle zones, sprite set, log-panel toggle, camera reset.
 * The tileset/turf picker moved to Settings → Client (owner 2026-07-03).
 */
// Owner 09-05: the quick bar cycles the SAME choices as Settings > Appearance — 'walk' (Super FUMBBL), every installed
// sprite pack ('pack:<installId>'), then Checkers — and clears/assigns the pack slot exactly like the dropdown. It
// used to flip only the mode string, so with a pack assigned it could never reach Super FUMBBL.
const spriteChoices = computed<string[]>(() => {
  const packs = assetMods.installed
    .filter((pack) => packSupports(pack, 'playerSprites') || packSupports(pack, 'walkSheets'))
    .map((pack) => `pack:${pack.installId}`);
  return ['walk', ...packs, ...availableSpriteSets.value.filter((set) => set !== 'walk')];
});
const currentSpriteChoice = computed(() => {
  const a = settings.assetPackAssignments;
  const packId = a.playerSprites || a.walkSheets;
  return packId ? `pack:${packId}` : spriteSet.value;
});
const spriteChoiceLabel = computed(() => {
  const c = currentSpriteChoice.value;
  if (c.startsWith('pack:')) { const pack = assetMods.installed.find((p) => p.installId === c.slice(5)); return pack ? `${pack.name} ${pack.version}` : c; }
  return SPRITE_SET_LABELS[c] ?? c;
});
async function applySpriteChoice(value: string): Promise<void> {
  const persist = (active: typeof settings.assetPackAssignments) => {
    settings.assetPackAssignments = active;
    settings.skillIconPackInstallId = active.skillIcons;
  };
  if (value.startsWith('pack:')) {
    const pack = assetMods.installed.find((candidate) => candidate.installId === value.slice(5));
    if (!pack) return;
    spriteSet.value = 'walk';
    await commitAssetAssignments({
      ...settings.assetPackAssignments,
      playerSprites: packSupports(pack, 'playerSprites') ? pack.installId : '',
      walkSheets: packSupports(pack, 'walkSheets') ? pack.installId : '',
    }, persist, beginAssetAssignmentIntent());
    return;
  }
  spriteSet.value = value as AppSettings['spriteSet'];
  if (settings.assetPackAssignments.playerSprites || settings.assetPackAssignments.walkSheets) {
    await commitAssetAssignments({ ...settings.assetPackAssignments, playerSprites: '', walkSheets: '' }, persist, beginAssetAssignmentIntent());
  }
}
function cycleSprites() {
  const choices = spriteChoices.value;
  const index = choices.indexOf(currentSpriteChoice.value);
  void applySpriteChoice(choices[(index + 1) % choices.length] ?? 'walk');
}

function openSettingsPane() {
  ui.settingsTab = 'general';
  ui.settingsOpen = true;
}

// Owner feature request 2026-08-18: Report now opens a MODAL — the tester writes a short description
// and the client attaches the diagnostics itself (wire log, in-app log, game id, coach names, build id)
// and POSTs the lot to config-web. The old behaviour (copy a template, open Discord, hope the tester
// finds and attaches their own wire log) survives only as the fallback link inside the modal.
//
// Zero game-wire impact: the send is HTTP to config-web, never the game websocket.
// Credentials: `passwordMd5` only — see bugReport.ts. The clear text never leaves this process.
declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

const reportOpen = ref(false);
const reportText = ref('');
const reportBusy = ref(false);
const reportError = ref('');
const REPORT_MAX = BUG_REPORT_DESCRIPTION_MAX;

/** The game the report is about — null is a legitimate answer (Report is reachable with no game).
 *  Owner 08-18: falls back to the wire-log file's id — a FUMBBL-official spectate can lose the live
 *  model id while the wire log still knows the game. */
const reportGameId = computed<number | string | null>(() =>
  resolveReportGameId(gameStore.game.value?.gameId ?? null, gameStore.state.wireLogFile));
/** Which SERVICE that id belongs to — derived from the active server target, never guessed. */
const reportGameService = computed(() => gameServiceFromTarget(settings.activeServerTarget));
/** Absolute path of the current per-game wire log; empty when verbose logging is off. */
const reportWireLogPath = computed(() => gameStore.state.wireLogFile);

/** The auto-attached summary the modal shows, so the tester can SEE what rides along before sending. */
const reportAttachments = computed(() => {
  const items = [
    `Game: ${reportGameId.value != null
      ? `${gameServiceLabel(reportGameService.value)} ${reportGameId.value}`
      : 'none (no game open)'}`,
    `Build: ${APP_VERSION}`,
    `Coach: ${settings.coach40k || settings.coach || '(not set)'}`,
  ];
  items.push(reportWireLogPath.value
    ? `Wire log: ${wireLogBasename(reportWireLogPath.value)}`
    : 'Wire log: none (verbose wire logging is off in Settings)');
  const logLines = gameStore.state.log.length;
  items.push(`Client log: ${logLines ? `${Math.min(logLines, 200)} recent lines` : 'empty'}`);
  return items;
});

function openReport() {
  reportError.value = '';
  reportOpen.value = true;
}

/** Non-blocking feedback, on the existing chat-toast stack (owner's established idiom for
 *  "tell me, don't stop me"). */
function pushReportToast(text: string, ms = 6000) {
  const id = ++chatToastId;
  const timer = window.setTimeout(() => removeChatToast(id), ms);
  chatToasts.push({ id, sender: '', text, side: 'unknown', timer });
  while (chatToasts.length > CHAT_TOAST_MAX) {
    const dropped = chatToasts.shift();
    if (dropped) clearTimeout(dropped.timer);
  }
}

/** Read the current wire log back through the confined Tauri command. Any failure degrades to "no
 *  wire log attached" — a missing attachment must never block the tester's actual words. */
async function readWireLogForReport(): Promise<BugReportLogRead | null> {
  const fileName = wireLogBasename(reportWireLogPath.value);
  if (!fileName) return null;
  try {
    const core = await import('@tauri-apps/api/core');
    return (await core.invoke('read_bug_report_log', { fileName })) as BugReportLogRead;
  } catch {
    return null; // not in Tauri, or the file vanished — send the report without it
  }
}

async function submitReport() {
  const description = reportText.value.trim();
  if (!description || reportBusy.value) return;
  reportBusy.value = true;
  reportError.value = '';
  try {
    const wireLog = await readWireLogForReport();
    const g = gameStore.game.value as (GameJson & {
      half?: number; turnDataHome?: { turnNr?: number }; turnDataAway?: { turnNr?: number };
    }) | null;
    // Fork account = the config-web credential (mirrors forkChallenge's forkCreds). When the tester
    // has no fork coach set we fall back to whatever the active target resolves, so an anonymous
    // spectator can still file something rather than being silently blocked.
    const creds = !FORK_EDITION
      ? { coach: settings.coach.trim() || 'anonymous', password: '' } // owner 09-10: public edition files under the FUMBBL coach
      : settings.coach40k.trim()
        ? { coach: settings.coach40k, password: coachPassword() }
        : resolveJoinCreds();
    const payload = buildBugReportPayload({
      description,
      publicEdition: !FORK_EDITION,
      gameId: reportGameId.value,
      gameService: reportGameService.value,
      clientVersion: APP_VERSION,
      creds,
      wireLog,
      appLog: formatAppLog(gameStore.state.log, gameStore.state.devLog),
      // Owner 08-19: triage sees settings instantly. Secret-free by the serializer's construction.
      settingsJson: serializeSettingsForFile(settings),
      context: {
        coach40k: settings.coach40k || null,
        fumbblCoach: settings.coach || null,
        homeCoach: (g?.teamHome as { coach?: string } | undefined)?.coach ?? null,
        awayCoach: (g?.teamAway as { coach?: string } | undefined)?.coach ?? null,
        wireLogFile: wireLogBasename(reportWireLogPath.value) || null,
        serverTarget: settings.activeServerTarget,
        sessionState: gameStore.state.sessionState,
        half: g?.half ?? null,
        homeTurn: g?.turnDataHome?.turnNr ?? null,
        awayTurn: g?.turnDataAway?.turnNr ?? null,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      },
    });
    await sendBugReport(payload, tauriFetch, botConfigBaseUrl());
    reportOpen.value = false;
    reportText.value = '';
    pushReportToast('🐞 Report sent — thanks! The wire log went with it.');
  } catch (error) {
    // The report is NOT lost: the modal stays open with the tester's text intact, and the Discord
    // fallback is right there. Losing someone's carefully-written report is worse than the bug.
    reportError.value = error instanceof Error ? error.message : String(error);
  } finally {
    reportBusy.value = false;
  }
}

/**
 * O4 action hotbar (BB3-style, bottom of the pitch): declares the behavior
 * mode for the selected player. Number keys 1–6 mirror the buttons.
 */
// Owner 2026-07-07: the hotbar icons now use the SAME emojis as the on-pitch action
// token (renderer.actionEmoji, from docs/action-icons.csv): move 🏃 / blitz ⚡ /
// foul 🦶 / pass 🏈 / hand-over ✋. Auto isn't a game action (no token equivalent), so
// it keeps a distinct 🤖 "let the app pick" glyph.
const ACTION_BUTTONS: { mode: ActionMode; label: string; icon: string }[] = [
  { mode: 'move', label: 'Move', icon: '🏃' },
  { mode: 'blitz', label: 'Blitz', icon: '⚡' },
  { mode: 'foul', label: 'Foul', icon: '🦶' },
  { mode: 'pass', label: 'Pass', icon: '🏈' },
  { mode: 'handoff', label: 'Handoff', icon: '✋' },
  { mode: 'auto', label: 'Auto', icon: '🤖' },
];
const actionMode = ref<ActionMode>('auto');

function setAction(mode: ActionMode) {
  actionMode.value = mode;
  renderer?.setPassTemplateMaxRange(null);
  renderer?.setActionMode(mode);
}

/**
 * Q8 (owner 2026-07-02): once a per-turn declaration budget is spent, the
 * action disappears from the UI entirely — no disabled placeholders.
 */
function budgetAvailable(mode: ActionMode, isHome: boolean): boolean {
  const game = gameStore.game.value;
  if (!game) return true;
  const turnData = (isHome ? game.turnDataHome : game.turnDataAway) as Record<string, unknown>;
  switch (mode) {
    case 'blitz': return !turnData.blitzUsed;
    case 'foul': return !turnData.foulUsed;
    case 'pass': return !turnData.passUsed;
    case 'handoff': return !turnData.handOverUsed;
    default: return true;
  }
}

function selectedIsHome(): boolean {
  const game = gameStore.game.value;
  const id = renderer?.getSelectedPlayerId();
  return !!game && !!id && game.teamHome.playerArray.some((p) => p.playerId === id);
}

/** Owner 2026-07-06: which team a player belongs to (for team-attached crowd quips
 *  — a home-side fan heckles when the AWAY team suffers, and vice-versa). */
function playerSide(playerId: string): 'home' | 'away' {
  const g = gameStore.game.value;
  return g?.teamHome.playerArray.some((p) => p.playerId === playerId) ? 'home' : 'away';
}
const otherSide = (s: 'home' | 'away'): 'home' | 'away' => (s === 'home' ? 'away' : 'home');

/** Q8 (revised, owner 2026-07-02): spent actions stay visible — shaded + "USED". */
const hotbarActions = computed(() => {
  void hasSelection.value; // re-evaluate per selection
  const isHome = selectedIsHome();
  return ACTION_BUTTONS.map((a) => ({ ...a, used: !budgetAvailable(a.mode, isHome) }));
});

watch(() => settings.turf, (theme) => renderer?.setTurf(theme));
watch(() => assetMods.pitchRevision, () => {
  if (!renderer) return;
  renderer.refreshPitchAssets();
  // Owner 09-04: pack-bound pitch families come and go with installs — keep the Settings picker honest.
  turfCatalog.options = renderer.turfOptions();
  if (!turfCatalog.options.includes(settings.turf)) settings.turf = turfCatalog.options[0] ?? 'grass1';
});
watch(() => settings.spriteSet, (set) => { spriteSet.value = set; });
watch(spriteSet, (set) => { settings.spriteSet = set; renderer?.setSpriteSet(set); });
// Owner 09-05: the sprite chain needs to know whether a PACK is the user's selection (then the bundled Super FUMBBL
// walkers drop to the placeholder tier) - mirrored from the slot assignments.
const spritePackSelected = computed(() => !!(settings.assetPackAssignments.playerSprites || settings.assetPackAssignments.walkSheets));
watch(spritePackSelected, (on) => { if (renderer) { renderer.selectedSpritePack = on; renderer.refresh(); } });
// Walk-sheet settings bridge (spec walk-sheet-integration v6 C.5 + owner 09-04 face-camera): module-level
// setters in ffb-pitch; runs immediately so persisted values apply before the first token build.
watchEffect(() => {
  setWalkAnimation(settings.walkAnimation);
  setWalkFps(settings.walkFps);
  setWalkFaceCamera(settings.walkFaceCamera);
  setWalkCastShadows(settings.castShadows); // owner 09-06: cast-shadow prototype
});
watch(() => settings.oneSpritePerPosition, (enabled) => renderer?.setOneSpritePerPosition(enabled));
// Owner 09-06: Settings > Appearance > Action decorations — repaint the active marker on change.
watch(() => settings.actionDecorations, (style) => { if (renderer) { renderer.actionDecorationStyle = style; renderer.refresh(); } });
// Accessibility grid options (owner 2026-07-03 r3): parse the hex colour and push
// show/width/colour to the renderer whenever any changes.
function gridColorInt(): number {
  const hex = settings.gridLineColor.replace('#', '');
  const n = Number.parseInt(hex, 16);
  return Number.isNaN(n) ? 0xe8e4d8 : n;
}
watch(
  () => [settings.gridLines, settings.gridLineWidth, settings.gridLineColor, settings.gridLineOpacity] as const,
  () => renderer?.setGridOptions({ show: settings.gridLines, widthMul: settings.gridLineWidth, color: gridColorInt(), alphaMul: settings.gridLineOpacity }),
);
// Owner 2026-07-04f: pitch marking colour (accessibility; default red)
function markColorInt(): number {
  const n = Number.parseInt(settings.markColor.replace('#', ''), 16);
  return Number.isNaN(n) ? 0xe03030 : n;
}
watch(() => settings.markColor, () => renderer?.setMarkColor(markColorInt()));
const SKILL_MARKING_FONTS: Record<typeof settings.skillMarkingFont, string> = {
  arial: 'Arial, Helvetica, sans-serif',
  helvetica: 'Helvetica, Arial, sans-serif',
  system: 'system-ui, "Segoe UI", sans-serif',
  nuffle: 'Nuffle, Arial, sans-serif',
};
function skillMarkingColorInt(): number {
  const n = Number.parseInt(settings.skillMarkingColor.replace('#', ''), 16);
  return Number.isNaN(n) ? 0xf5c542 : n;
}
function applySkillMarkingStyle(): void {
  renderer?.setSkillMarkingStyle({
    fontFamily: SKILL_MARKING_FONTS[settings.skillMarkingFont],
    fontSize: settings.skillMarkingSize,
    color: skillMarkingColorInt(),
  });
}
watch(
  () => [settings.skillMarkingColor, settings.skillMarkingFont, settings.skillMarkingSize] as const,
  applySkillMarkingStyle,
);
// Accessibility field markers (owner 2026-07-03 r4): row markers, sweet spot, logos.
watch(
  () => [settings.showRowMarkers, settings.showSweetSpot, settings.showFieldLogos] as const,
  () => renderer?.setFieldMarkers({ rowMarkers: settings.showRowMarkers, sweetSpot: settings.showSweetSpot, fieldLogos: settings.showFieldLogos }),
);
// Owner 2026-07-08: end-zone label — team name (FUMBBL) or "TOUCHDOWN".
watch(() => settings.endZoneLabel, (m) => renderer?.setEndZoneLabel(m));
watch(() => settings.endZoneTint, (on) => renderer?.setEndZoneTint(on)); // owner 09-05
watch(() => settings.cameraPanSpeed, (v) => renderer?.setPanSpeed(v)); // owner 09-05: Settings > Controls
// Positional-ring density + colour override ('auto' → per-position palette).
function ringColorOverrideInt(): number | null {
  if (settings.positionRingColor === 'auto') return null;
  const n = Number.parseInt(settings.positionRingColor.replace('#', ''), 16);
  return Number.isNaN(n) ? null : n;
}
watch(
  () => [settings.positionRingDensity, settings.positionRingColor] as const,
  () => renderer?.setPositionRingOptions({ density: settings.positionRingDensity, color: ringColorOverrideInt() }),
);
// On-die roll-cause tag placement (owner 2026-07-04).
watch(
  () => settings.dieTagPosition,
  (pos) => renderer?.setDieTagPosition(pos),
);
watch(
  () => settings.d6FaceVariant,
  (variant) => renderer?.setD6FaceVariant(variant),
);
watch(
  () => settings.tackleZoneMode,
  (mode) => renderer?.setTackleZoneMode(mode),
);
watch(
  () => settings.showDefaultSkills,
  (show) => {
    if (renderer) {
      renderer.showDefaultSkills = show;
      applyMarkings(); // the icon default (always/added) derives from this
    }
  },
);
watch(
  () => settings.showPositionRings,
  (show) => {
    if (renderer) {
      renderer.showPositionRings = show;
      renderer.refresh();
    }
  },
);
// Show block-dice previews only for the active Block/Blitz actor, narrowing to the declared Blitz target.
function updateBlockPreview() {
  if (!renderer) return;
  renderer.setModelBlockDecorations(settings.showBlockDice);
  renderer.setMaximumCarnageTargeting(gameStore.state.maximumCarnageTargeting);
  renderer.setFurySecondBlockTargeting(!!furySecondBlockTargeting.value);
  // row1-blockpreview-fix (owner 08-17): o66AggroStage is the LOCAL stage for an order66 aggressive action
  // (nominate/confirm; see the watch(o66AggroStage,...) below, ~:3991) and is the single source
  // for that preview. This watcher also fires on ordinary server-state churn (activePlayerId/playerAction/
  // defenderId), including the declareAction ack that follows a stage-2 arm — which used to re-fire here
  // and stomp the just-armed preview back to null (show-then-vanish). While a Block is locally staged,
  // defer to that watcher entirely. Fives lane 08-19: staged Blitz deliberately has only its bullseye cue;
  // after confirm clears the stage, the server-derived Blitz preview below owns the declared activation.
  if (o66AggroStage.value) return;
  const g = gameStore.game.value;
  const activeId = gameStore.state.activePlayerId;
  if (!settings.showBlockDice || !activeId || !g) { renderer.showBlockTargets(null); return; }
  const action = String((g.actingPlayer as { playerAction?: string } | undefined)?.playerAction ?? '');
  const blockCapable = action === 'block' || action === 'blitz' || action === 'blitzMove';
  if (!blockCapable) { renderer.showBlockTargets(null); return; }
  const target = String((g as { defenderId?: unknown }).defenderId ?? '');
  const isBlitz = action === 'blitz' || action === 'blitzMove';
  renderer.showBlockTargets(activeId, isBlitz && target ? target : null);
}
watch(
  () => [
    settings.showBlockDice,
    gameStore.state.activePlayerId,
    (gameStore.game.value?.actingPlayer as { playerAction?: string } | undefined)?.playerAction,
    (gameStore.game.value as { defenderId?: unknown } | undefined)?.defenderId,
    gameStore.state.maximumCarnageTargeting,
    furySecondBlockTargeting.value?.playerId ?? null,
    furySecondBlockTargeting.value?.targetIds.join(',') ?? '',
  ] as const,
  updateBlockPreview,
);
// Owner 2026-07-06: per-aura shading modes (Disturbing Presence / Pick-Me-Up)
watch(
  () => [settings.auraDisturbingPresence, settings.auraPickMeUp] as const,
  ([dp, pmu]) => {
    if (renderer) {
      renderer.auraDPMode = dp;
      renderer.auraPMUMode = pmu;
      renderer.refresh();
    }
  },
);
// Owner 2026-07-06: friendly/opposition perspective for aura colouring. In PLAY
// mode the LOCAL coach's side is always "friendly" (blue); spectating keeps
// home=friendly. Re-derives whenever the local play side resolves.
watch(
  () => gameStore.myTeamIsHome.value,
  (mine) => {
    if (!renderer) return;
    renderer.friendlyIsHome = mine ?? true;
    renderer.refresh();
  },
);
// Owner 2026-07-04f: FLAT (non-isometric) render toggle
watch(() => settings.flatRender, (flat) => renderer?.setFlatMode(flat));
// Owner 09-10: uniform figures is per orientation — the effective flag follows the pitch orientation.
const uniformFiguresEffective = computed(() => (settings.pitchOrientation === 'ew' ? settings.uniformFiguresEw : settings.uniformFigures));
watch(uniformFiguresEffective, (on) => renderer?.setUniformFigures(on)); // owner 09-09: option 3
watch(() => settings.showStadium, (on) => renderer?.setStadiumEnabled(on)); // owner 08-19: Settings > UI stadium toggle
watch(() => settings.turnTrack, (on) => renderer?.setTurnTrackEnabled(on)); // owner 2026-07-07
watch(() => settings.modernHudStyle, (style) => renderer?.setOnPitchPresentationStyle(style));
watch(() => settings.useFantasyCursor, (enabled) => renderer?.setFantasyCursorEnabled(enabled));
// Owner 2026-07-04d: serverZapPlayer — render the (non-interactive) zap strike.
watch(
  () => gameStore.state.zapAnim?.seq,
  () => { const z = gameStore.state.zapAnim; if (z && renderer) renderer.playZap(z.square); },
);
// Owner 2026-07-04d: serverAddPlayer — a smoke puff at the reserves bench.
watch(
  () => gameStore.state.addPlayerPuff?.seq,
  () => { const p = gameStore.state.addPlayerPuff; if (p && renderer) renderer.puffAtSquare(p.square); },
);
// In Order 66 play, render the store's sequenced injury puff when the injury cine is suppressed.
watch(
  () => gameStore.state.injuryPuff?.seq,
  () => { const p = gameStore.state.injuryPuff; if (p && renderer) renderer.puffAtSquare(p.square); },
);
// Owner 2026-07-06: Dodgy Snack debuff → 🤮 token markers on the affected players.
watch(
  () => gameStore.state.dodgySnackPlayers,
  (ids) => renderer?.setDodgySnackPlayers(ids ?? []),
  { deep: true },
);
// Owner 2026-07-08: Hypnotic Gaze victims → 👁 token marker (instead of the generic '?' confused).
const gazeVictimPresentation = installGazeVictimPresentation(
  () => gameStore.state.gazeVictims,
  () => renderer,
);
watch(
  () => gameStore.state.gazeIntent,
  (intent) => renderer?.setGazeTarget(intent?.phase === 'active' ? intent.victimId : null),
  { deep: true },
);
// Owner 2026-07-04d: bomb blast — the 3×3 explosion (injuries cascade separately).
watch(
  () => gameStore.state.bombBlast?.seq,
  () => { const b = gameStore.state.bombBlast; if (b && renderer) renderer.playExplosion(b.square, b.sound); }, // #92 Inc-2: pass the arc sound (Tarkin f58b576c) → renderer fires onCue at the burst beat (apply-time emit now suppressed)
);
watch(
  () => gameStore.state.fireballAnim?.seq,
  () => { const f = gameStore.state.fireballAnim; if (f && renderer) renderer.playFireball(f.square, f.sound); },
);

// B8-1: centered block-dice cinematic — zoom to the block square and show the
// rolled dice large (spectator). Fires ahead of any knockdown for the block.
// Owner 2026-07-06: the block/blitz TARGET crosshair — the FIRST beat of a block,
// popped on the target token a beat before the dice (store paces the delay).
watch(
  () => gameStore.state.blockTargetCue?.seq,
  () => {
    const cue = gameStore.state.blockTargetCue;
    if (cue && renderer && !settings.spectatorClean) renderer.showBlockTargetCrosshair(cue.square);
  },
);
// Owner 2026-07-09: the FOUL target boot — popped a beat before the armour roll (the store paces
// the delay), the foul analogue of the block/blitz target crosshair.
watch(
  () => gameStore.state.foulTargetCue?.seq,
  () => {
    const cue = gameStore.state.foulTargetCue;
    if (cue && renderer && !settings.spectatorClean) renderer.showFoulTargetCue(cue.square);
  },
);

// Block rerolls: team=all dice; Brawler=Both Down; Pro/Consummate=one die; Savage Blow=selected dice.
function blockFaceUrl(v: number): string {
  void assetMods.blockDiceRevision;
  return PitchRenderer.blockFaceUrl(v);
}
function blockFaceLabel(v: number): string { return PitchRenderer.blockFaceLabel(v); }
const bpDieMode = ref<null | 'pro' | 'consummate' | 'multiBlockDice' | 'singleBlockDie'>(null);
const bpSelectedDice = ref(new Set<number>());
// Owner 09-05: dice TUMBLE — when new block dice land (the roll, and every re-roll) the faces cycle at random
// for BLOCK_TUMBLE_MS before the real result is revealed; the dice are inert while tumbling.
// owner 09-06: tumble length is the settings slider (default 250 ms); it is a lead-in, not a reveal — the 450 ms rule applies to the settled dice
const BLOCK_TUMBLE_STEP_MS = 70;
const bpTumble = ref<{ key: string; faces: number[] } | null>(null);
let bpTumbleTimer: ReturnType<typeof setInterval> | null = null;
let bpTumbleEnd: ReturnType<typeof setTimeout> | null = null;
function clearBlockTumbleTimers() {
  if (bpTumbleTimer) clearInterval(bpTumbleTimer);
  if (bpTumbleEnd) clearTimeout(bpTumbleEnd);
  bpTumbleTimer = null; bpTumbleEnd = null;
}
function stopBlockTumble() {
  clearBlockTumbleTimers();
  bpTumble.value = null;
}
function randomBlockFaces(n: number, avoid?: readonly number[]): number[] {
  return Array.from({ length: n }, (_v, i) => {
    let f = 1 + Math.floor(Math.random() * 6);
    if (avoid && avoid[i] === f) f = (f % 6) + 1; // always visibly changes between steps
    return f;
  });
}
const bpDiceHost = ref<HTMLElement | null>(null);
const bpDice3dLive = ref(false);
const bpReducedMotion = ref(false);
let bpDice3d: BlockDiceRow | null = null;
let bpDice3dLoading: Promise<BlockDiceRow | null> | null = null;
let bpDice3dFailed = false;
let bpDice3dGeneration = 0;
let bpDice3dPresentedKey: string | null = null;
let bpDice3dLifecycle = 0;
let bpReplaySeekFallback = false;
let bpMotionQuery: MediaQueryList | null = null;
let bpMotionListener: (() => void) | null = null;

function blockDiceWebGlAvailable(): boolean {
  return typeof window !== 'undefined'
    && (typeof window.WebGLRenderingContext !== 'undefined' || typeof window.WebGL2RenderingContext !== 'undefined');
}
function blockDice3dEligible(): boolean {
  return settings.order66 && settings.blockDice3d && !settings.spectatorClean && !gameStore.playbackCatchingUp.value
    && !bpReducedMotion.value && !bpReplaySeekFallback && !bpDice3dFailed && blockDiceWebGlAvailable();
}
function disposeBlockDice3d(resetFailure = false) {
  bpDice3dLifecycle++;
  bpDice3dGeneration++;
  bpDice3d?.dispose();
  bpDice3d = null;
  bpDice3dLive.value = false;
  if (resetFailure) {
    bpDice3dFailed = false;
    bpDice3dPresentedKey = null;
    bpReplaySeekFallback = false;
  }
}
function failBlockDice3d(_error: unknown) {
  const wasLive = bpDice3dLive.value;
  bpDice3dFailed = true;
  disposeBlockDice3d();
  // During initial load the unchanged PNG timer remains the timing owner. A
  // lost live context has no running PNG timer, so reveal its final face now.
  if (wasLive) stopBlockTumble();
}
async function loadBlockDice3dRow(): Promise<BlockDiceRow | null> {
  const host = bpDiceHost.value;
  if (!host || !blockDice3dEligible()) return null;
  const generation = ++bpDice3dGeneration;
  try {
    const module = await loadBlockDice3d();
    if (generation !== bpDice3dGeneration || !blockDice3dEligible() || bpDiceHost.value !== host) return null;
    const row = await module.createBlockDiceRow(host, {
      onFailure: failBlockDice3d,
      onSettled: () => { if (bpDice3dLive.value) stopBlockTumble(); },
      // Owner 09-08: the cubes sit exactly on the `.bp-die` buttons (60 px boxes, 7 px gap) — never their own spacing.
      slots: () => {
        const hostRect = host.getBoundingClientRect();
        const buttons = Array.from(host.querySelectorAll<HTMLElement>('.bp-die')).map((b) => b.getBoundingClientRect());
        return module.blockDiceSlotsFromRects(hostRect, buttons);
      },
    });
    if (generation !== bpDice3dGeneration || !blockDice3dEligible() || bpDiceHost.value !== host) {
      row.dispose();
      return null;
    }
    bpDice3d = row;
    await row.updateFaceTextures(PitchRenderer.blockFaceUrls());
    if (generation !== bpDice3dGeneration || bpDice3d !== row) return null;
    return row;
  } catch (error) {
    if (generation === bpDice3dGeneration) failBlockDice3d(error);
    return null;
  }
}
function ensureBlockDice3d(): Promise<BlockDiceRow | null> {
  if (bpDice3d) return Promise.resolve(bpDice3d);
  if (bpDice3dLoading) return bpDice3dLoading;
  const pending = loadBlockDice3dRow();
  bpDice3dLoading = pending;
  void pending.finally(() => { if (bpDice3dLoading === pending) bpDice3dLoading = null; });
  return pending;
}
async function presentBlockDice3d(key: string, results: readonly number[], durationMs: number) {
  if (bpDice3dPresentedKey === key) return;
  const row = await ensureBlockDice3d();
  const bp = gameStore.state.blockPartial;
  if (!row || bpDice3d !== row || !bp || bp.tumbleKey !== key || !blockDice3dEligible() || bpDice3dPresentedKey === key) return;
  bpDice3dPresentedKey = key;
  bpDice3dLive.value = true;
  if (bpTumble.value?.key === key) {
    clearBlockTumbleTimers();
    row.play(results, durationMs);
  } else {
    // A first GLB load may outlive the short PNG tumble. Switch only to the
    // already-settled authoritative result; never replay a stale animation.
    row.settle(results);
  }
}
watch(() => gameStore.state.blockPartial?.tumbleKey, (key) => {
  stopBlockTumble();
  if (key && !gameStore.playbackCatchingUp.value) bpReplaySeekFallback = false;
  const bp = gameStore.state.blockPartial;
  if (!key || !bp || bp.dice.length === 0 || gameStore.playbackCatchingUp.value || settings.spectatorClean || bpReducedMotion.value) return;
  bpTumble.value = { key, faces: randomBlockFaces(bp.dice.length) };
  bpTumbleTimer = setInterval(() => {
    if (bpTumble.value) bpTumble.value = { key, faces: randomBlockFaces(bp.dice.length, bpTumble.value.faces) };
  }, BLOCK_TUMBLE_STEP_MS);
  const durationMs = presentationMs(settings.blockTumbleMs ?? 250);
  bpTumbleEnd = setTimeout(stopBlockTumble, durationMs);
  void presentBlockDice3d(key, [...bp.dice], durationMs);
});
watch(() => gameStore.state.blockPartial, (bp) => {
  if (!bp) {
    stopBlockTumble();
    disposeBlockDice3d(true);
    return;
  }
  const lifecycle = bpDice3dLifecycle;
  void nextTick(async () => {
    if (lifecycle !== bpDice3dLifecycle) return;
    if (bpTumble.value?.key === bp.tumbleKey) {
      await presentBlockDice3d(bp.tumbleKey, [...bp.dice], presentationMs(settings.blockTumbleMs ?? 250));
      return;
    }
    const row = await ensureBlockDice3d();
    if (row && bpDice3d === row && lifecycle === bpDice3dLifecycle && gameStore.state.blockPartial === bp) {
      bpDice3dLive.value = true;
      row.settle(bp.dice);
    }
  });
}, { flush: 'post' });
watch(() => assetMods.blockDiceRevision, () => {
  if (bpDice3d) void bpDice3d.updateFaceTextures(PitchRenderer.blockFaceUrls()).catch(failBlockDice3d);
});
watch(
  () => [settings.order66, settings.blockDice3d, settings.spectatorClean, gameStore.playbackCatchingUp.value, bpReducedMotion.value] as const,
  () => {
    if (!blockDice3dEligible()) {
      stopBlockTumble();
      disposeBlockDice3d();
    } else if (gameStore.state.blockPartial) {
      void nextTick(async () => {
        const row = await ensureBlockDice3d();
        const bp = gameStore.state.blockPartial;
        if (row && bpDice3d === row && bp) { bpDice3dLive.value = true; row.settle(bp.dice); }
      });
    }
  },
);
watch(() => gameStore.replay.snapRenderEpoch, () => {
  if (!gameStore.isReplay.value) return;
  bpReplaySeekFallback = true;
  stopBlockTumble();
  disposeBlockDice3d();
});
watch(() => gameStore.game.value?.gameId, () => {
  stopBlockTumble();
  disposeBlockDice3d(true);
});
onMounted(() => {
  bpMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  bpMotionListener = () => { bpReducedMotion.value = bpMotionQuery?.matches ?? false; };
  bpMotionListener();
  bpMotionQuery.addEventListener('change', bpMotionListener);
});
onBeforeUnmount(() => {
  stopBlockTumble();
  disposeBlockDice3d();
  if (bpMotionListener) bpMotionQuery?.removeEventListener('change', bpMotionListener);
  bpMotionListener = null;
  bpMotionQuery = null;
});
const bpDiceShown = computed(() => {
  const bp = gameStore.state.blockPartial;
  if (!bp) return [] as number[];
  return bpTumble.value && bpTumble.value.key === bp.tumbleKey ? bpTumble.value.faces : bp.dice;
});
const bpTumbling = computed(() => !!gameStore.state.blockPartial && !!bpTumble.value && bpTumble.value.key === gameStore.state.blockPartial.tumbleKey);
const blockChooserSeat = computed<BlockChooserSide | null>(() => gameStore.blockPresentationSeat.value);
const blockChooserSpectator = computed(() => !gameStore.isPlaying.value);
const liveBlockChoiceDialog = computed(() => isCurrentBlockChoiceDialog(gameStore.game.value));
const liveMultiBlockChoiceDialog = computed(() => isCurrentMultiBlockChoiceDialog(gameStore.game.value));
const liveBlockChoosingTeamId = computed(() => currentBlockChoosingTeamId(gameStore.game.value));
const liveBlockChooser = computed(() => projectBlockChooser(
  gameStore.game.value, liveBlockChoosingTeamId.value, blockChooserSeat.value, blockChooserSpectator.value));
const blockDialogMine = computed(() => liveBlockChoiceDialog.value && liveBlockChooser.value.mine);
// Owner 09-05 (static block surface): the chooser caption used to be v-if'd on the LIVE dialog, so the moment the
// server closed it (choice made) the caption unmounted, the panel shrank and re-laid out, then the golden choice
// box appeared on a visibly different panel. Latch the chooser while a block surface is up so the panel keeps
// its exact size and position through the reveal; the latch clears when the surface itself goes.
const latchedBlockChoosingTeamId = ref<unknown>(null);
watch(liveBlockChoosingTeamId, (id) => { if (id != null && id !== '') latchedBlockChoosingTeamId.value = id; }, { immediate: true });
watch(() => gameStore.state.blockPartial, (bp) => { if (!bp) latchedBlockChoosingTeamId.value = null; });
const blockChooserCaptionTeamId = computed(() => liveBlockChoiceDialog.value ? liveBlockChoosingTeamId.value : latchedBlockChoosingTeamId.value);
const liveMultiBlockChoosingTeamId = computed(() => currentMultiBlockChoosingTeamId(gameStore.game.value));
const liveMultiBlockChooser = computed(() => projectBlockChooser(
  gameStore.game.value, liveMultiBlockChoosingTeamId.value, blockChooserSeat.value, blockChooserSpectator.value));
const multiBlockDialogMine = computed(() => liveMultiBlockChoiceDialog.value && liveMultiBlockChooser.value.mine);
const blockPartialOptions = computed(() => {
  const bp = gameStore.state.blockPartial;
  if (!bp) return [] as { kind: 'brawler' | 'pro' | 'consummate' | 'singleBlockDie' | 'hatred' | 'multiBlockDice'; label: string; skill: string }[];
  const out: { kind: 'brawler' | 'pro' | 'consummate' | 'singleBlockDie' | 'hatred' | 'multiBlockDice'; label: string; skill: string }[] = [];
  if (bp.brawler) out.push({ kind: 'brawler', label: 'Brawler', skill: 'Brawler' });
  if (bp.pro) out.push({ kind: 'pro', label: 'Pro', skill: 'Pro' });
  if (bp.consummate) out.push({ kind: 'consummate', label: bp.consummateLabel ?? 'Consummate', skill: bp.consummateLabel ?? 'Consummate Professional' });
  if (bp.singleBlockDieLabel) out.push({ kind: 'singleBlockDie', label: bp.singleBlockDieLabel, skill: bp.singleBlockDie ?? bp.singleBlockDieLabel });
  if (bp.multiBlockDiceLabel) out.push({ kind: 'multiBlockDice', label: bp.multiBlockDiceLabel, skill: bp.multiBlockDice ?? bp.multiBlockDiceLabel });
  // Hatred: single named source (Single Skull → Hatred), fires immediately like Brawler — the server
  // picks the die (it's ALWAYS the Skull), so no die-select arm is needed.
  if (bp.singleSkullLabel) out.push({ kind: 'hatred', label: bp.singleSkullLabel, skill: bp.singleSkull ?? bp.singleSkullLabel });
  return out;
});
watch(() => gameStore.state.blockPartial, (bp) => {
  if (!bp) {
    bpDieMode.value = null;
    bpSelectedDice.value = new Set();
  }
});
watch(() => gameStore.state.blockPartial?.seq, () => {
  bpDieMode.value = null;
  bpSelectedDice.value = new Set();
});
// Only the exact live chooser can own uphill phase one; read-only nonchoosers are gated separately.
const bpPhase1ReRollOnly = computed(() =>
  blockDialogMine.value && !!gameStore.state.blockPartial && settings.order66
    && gameStore.state.blockPartial.nrOfDice < 0 && !gameStore.state.blockPartial.pickable);
// Show uphill reroll/decline UI only for negative dice count with an offered reroll source.
const bpUphillDecision = computed(() => {
  const bp = gameStore.state.blockPartial;
  return blockDialogMine.value && !!bp && settings.order66 && !bp.pickable && bp.nrOfDice < 0
    && (bp.teamRR || bp.mascot || bp.mascotTrr || bp.pro || bp.brawler || bp.consummate || !!bp.singleBlockDieLabel || !!bp.multiBlockDiceLabel || !!bp.singleSkullLabel);
});
function useBlockPartialOption(kind: 'brawler' | 'pro' | 'consummate' | 'singleBlockDie' | 'hatred' | 'multiBlockDice') {
  if (!blockDialogMine.value) return;
  const bp = gameStore.state.blockPartial;
  if (!bp) return;
  if (kind === 'brawler') { gameStore.resolveBlockPartial('brawler'); return; }
  if (kind === 'hatred') { gameStore.resolveBlockPartial('hatred'); return; }
  if (kind === 'multiBlockDice') {
    if (bpDieMode.value !== 'multiBlockDice') bpSelectedDice.value = new Set();
    bpDieMode.value = 'multiBlockDice';
    return;
  }
  // Pro / Consummate / single-block-die re-roll ONE die. Only one die → submit immediately.
  if (bp.dice.length <= 1) { gameStore.resolveBlockPartial(kind, 0); return; }
  bpSelectedDice.value = new Set();
  bpDieMode.value = kind; // else arm die-selection: the dice become clickable
}
function clickBlockPartialDie(i: number) {
  if (bpTumbling.value) return; // owner 09-05: inert while the dice tumble
  if (!gameStore.state.blockPartial || !blockDialogMine.value) return;
  if (bpDieMode.value === 'multiBlockDice') {
    const selected = new Set(bpSelectedDice.value);
    if (selected.has(i)) selected.delete(i); else selected.add(i);
    bpSelectedDice.value = selected;
    return;
  }
  if (bpDieMode.value) { gameStore.resolveBlockPartial(bpDieMode.value, i); return; } // reroll THAT die — always OK
  // no reroll armed → this is a COMMIT. In o66 phase-1 (uphill, attacker still deciding a re-roll) the attacker
  // must NOT commit the die — the pick is the defender's. Ignore the click; the Decline button proceeds instead.
  if (bpPhase1ReRollOnly.value) return;
  gameStore.resolveBlockPartial('accept', i); // no reroll armed → accept that die
}
function commitMultiBlockDice() {
  if (!blockDialogMine.value || bpDieMode.value !== 'multiBlockDice' || bpSelectedDice.value.size < 1) return;
  gameStore.resolveBlockPartial('multiBlockDice', [...bpSelectedDice.value].sort((a, b) => a - b));
}

// Resolve synchronous multi-block per target; rerolls re-present before the coach makes the plain die choice.
const mbrDieMode = ref<{ targetId: string; kind: 'pro' | 'consummate' } | null>(null);
watch(() => gameStore.state.multiBlockResolution?.seq, () => { mbrDieMode.value = null; }); // a fresh dialog clears the arm
function multiBlockPickDie(targetId: string, dieIndex: number, pickable: boolean) {
  if (!gameStore.state.multiBlockResolution || !multiBlockDialogMine.value) return;
  const dm = mbrDieMode.value;
  if (dm && dm.targetId === targetId) { // armed Pro/Consummate → re-roll THIS die (sel=-1; the fresh dialog drives the pick)
    gameStore.sendMultiBlockChoiceForTarget(targetId, -1, dm.kind === 'pro' ? 'Pro' : 'Consummate Professional', dieIndex);
    mbrDieMode.value = null;
    return;
  }
  if (!pickable) return; // non-pickable = the defender's choice → read-only
  gameStore.sendMultiBlockChoiceForTarget(targetId, dieIndex); // plain pick resolves this target
}
// A per-target re-roll button. team/mascot/brawler fire immediately; Pro/Consummate arm a die-select (unless 1 die).
function multiBlockReroll(targetId: string, kind: 'team' | 'mascot' | 'brawler' | 'pro' | 'consummate', diceLen: number) {
  if (!gameStore.state.multiBlockResolution || !multiBlockDialogMine.value) return;
  switch (kind) {
    case 'team': gameStore.sendMultiBlockChoiceForTarget(targetId, -1, 'Team ReRoll', 0); break;
    case 'mascot': gameStore.sendMultiBlockChoiceForTarget(targetId, -1, 'Team Mascot', 0); break;
    case 'brawler': gameStore.sendMultiBlockBrawler(targetId); break;
    case 'pro': case 'consummate':
      if (diceLen <= 1) gameStore.sendMultiBlockChoiceForTarget(targetId, -1, kind === 'pro' ? 'Pro' : 'Consummate Professional', 0);
      else mbrDieMode.value = { targetId, kind };
      break;
  }
}
// Savage Blow rerolls the whole multi-block pool, so send its source with dieIndex -1.
function multiBlockRerollAllDice(targetId: string, source: string | null, nrOfDice: number) {
  if (!gameStore.state.multiBlockResolution || !multiBlockDialogMine.value || !source || nrOfDice <= 0) return;
  // ⚠ SR-233 (Meero): SAVAGE_BLOW is a NAMED reroll source, so the server rerolls ONLY the die indexes the command
  //   carries (`getAnyDiceIndexes()` = the wire `reRolledDice`) — NOT the unnamed Team-ReRoll else-branch that
  //   rerolls all nrOfDice with no index set. Omitting the 5th arg ⇒ empty index set ⇒ ZERO dice rerolled (a no-op).
  //   Enumerate EVERY die index [0..nrOfDice-1] to reroll the WHOLE pool. (wire key `reRolledDice`, server :437.)
  const allDice = Array.from({ length: nrOfDice }, (_, i) => i);
  gameStore.sendMultiBlockChoiceForTarget(targetId, -1, source, 0, allDice);
}
/** #58: enrich each resolution roll with the target's display name for the surface labels. */
const multiBlockRows = computed(() => {
  const mb = gameStore.state.multiBlockResolution;
  const g = gameStore.game.value;
  if (!mb || !g) return [];
  const all = [...(g.teamHome.playerArray as { playerId: string; name?: string }[]),
    ...(g.teamAway.playerArray as { playerId: string; name?: string }[])];
  return mb.rolls.map((r) => ({ ...r, name: all.find((p) => p.playerId === r.targetId)?.name ?? '' }));
});

// B9-14: push arrows — draw a BB-style arrow for each pushback this frame
watch(
  () => gameStore.state.pushArrows,
  (arrows) => {
    if (!arrows || !renderer || settings.spectatorClean) return;
    for (const a of arrows) renderer.playPushArrow(a.from, a.to);
  },
);

// Ball catch attempt (catchRoll) — pulse a ring at the catcher.
watch(
  () => gameStore.state.ballCatch?.seq,
  () => {
    const c = gameStore.state.ballCatch;
    if (c && renderer && !settings.spectatorClean) renderer.playCatchAttempt(c.playerId);
  },
);

// Owner 2026-07-15 (live test): PASS/CATCH rolls now use the SAME die-tag d6 as every other roll (GFI, dodge,
// pickup, block) instead of a bespoke over-head "Pass 4 / 4+ ✓" pill that read huge + off-theme. showActionDie
// tags the die "Pass"/"Catch" and folds a fail into the standard "FAILED (N+)" stencil. Declare-time requirements
// stay on the hovered/nominated destination rather than repeating as cards across every pass-range square.
watch(
  () => gameStore.state.rollModal?.seq,
  () => {
    const m = gameStore.state.rollModal;
    if (m && renderer && !settings.spectatorClean) {
      // Owner 09-09: the cause is the renderer's lowercase KEY ('pass' / 'catch') — the capitalised words never
      // matched the die-tag branches, so the pass and catch badges were silently skipped (the tag fell to '?').
      renderer.showActionDie(m.square, m.roll, m.kind, !m.ok, m.needed);
    }
  },
);

// Jump/Leap (owner 2026-07-06): flag the leaper's next move so the renderer arcs
// the sprite over the jumped square(s). This watcher is a default ('pre') flush,
// so markLeap lands before the flush:'post' setGame watch builds the move tween.
watch(
  () => gameStore.state.leap?.seq,
  () => {
    const l = gameStore.state.leap;
    if (l && renderer) renderer.markLeap(l.playerId, l.sound); // #92 Inc-2: arc sound onto the leap launch beat (leapFail below keeps its apply-time boing — no arc onCue)
  },
);

// Owner 2026-07-07: a FAILED leap (server destination == origin) — the renderer hops the
// sprite straight up and back down in place. Default ('pre') flush so the cue lands before
// the flush:'post' setGame token pass (same rail as markLeap).
watch(
  () => gameStore.state.leapFail?.seq,
  () => {
    const l = gameStore.state.leapFail;
    if (l && renderer) renderer.markLeapInPlace(l.playerId);
  },
);

// Owner 2026-07-07 (TTM): a thrown player scatters — the renderer hops the sprite along the
// explicit path. Default ('pre') flush so the cue lands before the flush:'post' setGame move.
watch(
  () => gameStore.state.scatterAnim?.seq,
  () => {
    const s = gameStore.state.scatterAnim;
    if (s && renderer) {
      renderer.markScatter(s.playerId, s.path);
      if (s.refreshAfterArm) renderer.refresh();
    }
  },
);

// Owner 2026-07-14: UNIFIED projectile throw — the store surfaces one `throwAnim` cue (pass = ball,
// throwTeamMate = thrown player, throwBomb/rock/keg = a created sprite) from the wire animation; the
// renderer's single `playThrow` dispatches by kind (arc the ball/player token, or a created projectile).
watch(
  () => gameStore.state.passBallHold?.seq ?? 0,
  () => renderer?.setPassBallHold(gameStore.state.passBallHold?.square ?? null),
  { flush: 'sync' },
);
watch(
  () => gameStore.state.throwAnim?.seq,
  () => {
    const t = gameStore.state.throwAnim;
    if (t && renderer) renderer.playThrow(t.kind, t.from, t.to, t.thrownId, t.sound); // #92 Inc-2: arc sound at the throw release beat
  },
);

// Owner 2026-07-08: while an armour/injury cine is up, FREEZE a loose ball (carrier just
// knocked down) at its pre-bounce square — the bounce plays only after the cine resolves.
// Render-side hold, so it works in both spectate + play mode.
watch(
  () => !!gameStore.state.injurySplash,
  (active) => renderer?.setHoldBallDuringInjury(active),
);

// Owner 2026-07-08: VAMPIRE FEED — a 🧛 pops over the bitten Thrall just before the "bitten"
// injury plays (armed by pumpInjuries), so the feed reads before the injury roll.
watch(
  () => gameStore.state.vampireBite?.seq,
  () => {
    const v = gameStore.state.vampireBite;
    if (v && renderer && !settings.spectatorClean) renderer.armVampireBite(v.playerId, v.square);
  },
);

// Owner 2026-07-08 (case 419): TRICKSTER — the wire's built-in `trickster` animation relocates the
// Trickster player before a block; the renderer slides its token from→to (a low step, no arc).
watch(
  () => gameStore.state.trickster?.seq,
  () => {
    const t = gameStore.state.trickster;
    if (t && renderer) renderer.markTrickster(t.playerId, t.from, t.to);
  },
);

// Unified square-pick renders eligible coordinates and routes clicks through resolveSquarePick; Trickster is the first consumer.
watch(
  [() => gameStore.state.squarePick?.seq, () => gameStore.state.wizardTargetPreview?.seq, () => gameStore.state.wizardTargetConfirm?.seq],
  () => {
    const sp = gameStore.state.squarePick;
    if (!renderer) return;
    const zapSelected = !!gameStore.state.wizardTargetConfirm && sp?.kind === 'wizard' && sp.skill === 'Zap';
    renderer.setTargetSelectPick(zapSelected ? null : sp?.squares ?? null, zapSelected ? undefined : sp?.skill);
    const preview = gameStore.state.wizardTargetPreview;
    renderer.setO66PassRolls(preview
      ? new Map(preview.playerSquares.map((square) => [`${square[0]},${square[1]}`, 4]))
      : null);
    if ((!sp || sp.kind !== 'wizard' || sp.skill !== 'Fireball') && o66PendingThrowKind.value === 'fireball') {
      o66PendingPass.value = null;
      o66PendingThrowKind.value = null;
    }
  },
);
// Upstream DialogKickSkillHandler.java:25-58 compares the two server-sent landing squares without moving the
// ball. The renderer shades both inertly and marks only ballCoordinateWithKick with "K".
watch(
  () => gameStore.state.kickSkill?.seq,
  (seq) => {
    const kick = gameStore.state.kickSkill;
    renderer?.setKickSkillCandidates(kick?.ballCoordinate ?? null, kick?.ballCoordinateWithKick ?? null);
    kickElectionIconFailed.value = false;
    if (seq == null) stopKickElectionTracking();
    else trackKickElection();
  },
);
// Owner o66aj: INTERACTIVE KICK PLACEMENT — arm the receiving-half aim squares as clickable crosshairs; the
// click routes to resolveKickPlacement in onTilePick. Cleared (setTilePick(false)) when the pick resolves.
watch(
  () => gameStore.state.kickPlacement?.seq,
  () => {
    if (!renderer) return;
    // Owner o66an: single BALL-CROSSHAIR hover (setKickPick) instead of the full-grid crosshairs — the ball
    // crosshair snaps to the eligible square under the pointer; a click there fires onKickPick.
    const squares = gameStore.state.kickPlacement?.squares;
    renderer.setKickPick(squares ?? null);
    if (!squares?.length) return;
    let colTotal = 0;
    let rowTotal = 0;
    for (const [col, row] of squares) {
      colTotal += col;
      rowTotal += row;
    }
    // Focus the receiving-half target centroid.
    renderer.nudgeToSquare([
      Math.round(colTotal / squares.length),
      Math.round(rowTotal / squares.length),
    ]);
  },
);
// Owner 2026-07-08 (case 422): SIDESTEP shares the badge language — when the pushed player's push choice
// is a Sidestep, tag its pushback crosshairs with the SideStep icon (Sidestep keeps its pushback wiring).
watch(
  () => gameStore.state.pushChoice?.skill,
  (skill) => renderer?.setPushSkill(skill),
);
// Owner 09-06: the push fan surfaces only while the direction pick is THIS coach's current action (the store arms
// pushChoice after any pending Stand Firm / Side Step reaction resolves) — never straight off the block result.
watch(
  () => !!gameStore.state.pushChoice,
  (armed) => renderer?.setPushOptionsArmed(armed),
  { immediate: true },
);

// While a mate is held, render it at the thrower and retain its pre-pickup square for the pickup tween.
watch(
  () => gameStore.state.ttmHeld?.seq ?? 0,
  () => {
    const h = gameStore.state.ttmHeld;
    if (!renderer) return;
    if (h) renderer.markTtmHeld(h.thrownId, h.throwerId, h.fromSquare);
    else renderer.clearTtmHeld();
  },
);
// Paint every server passCoordinate as a non-interactive destination. For Swoop this is synchronized before
// DialogSkillUse, so the choice card can mount immediately without waiting for an impossible flight.
watch(
  () => gameStore.state.passDestination?.seq ?? 0,
  () => renderer?.setPassDestinationMarker(
    gameStore.state.passDestination?.square ?? null,
    gameStore.state.passDestination?.kind ?? 'ball',
  ),
  { flush: 'sync' },
);

// Follow/stay move ordering (owner 2026-07-07, queue #1): a batched follow/stay frame
// carries the follow-up MOVE and the dialog together. The store defers the attacker's
// move so the "X follows up" indicator reads first, then releases it. Default ('pre')
// flush so a 'defer' cue lands before the flush:'post' setGame builds that move's tween.
watch(
  () => gameStore.state.deferMove?.seq,
  () => {
    const d = gameStore.state.deferMove;
    if (!d || !renderer) return;
    if (d.action === 'defer') renderer.deferMove(d.playerId);
    else renderer.releaseMove(d.playerId);
  },
);

// Spectator drive-north flip (owner 2026-07-06): mirror the field 180° so the
// driving team attacks north. The store only bumps seq on a real change (drive
// boundary / play-mode toggle) and keeps flip=false in play mode. Default ('pre')
// flush so the redraw lands before any same-tick setGame.
watch(
  () => gameStore.state.fieldFlip.seq,
  () => {
    if (renderer) renderer.setFieldFlipMode(gameStore.state.fieldFlip.flip);
  },
);

// Feed frozen per-step snapshots to the renderer; seq advances each tween and null restores model rendering.
watch(
  () => gameStore.state.presentationStep?.seq,
  () => {
    if (renderer) renderer.setPresentationStep(gameStore.state.presentationStep);
  },
);
// Accepted local move commands get a bounded first-stride anticipation. It starts promptly while the wire is in
// flight, but the confirmed presentationStep above remains the only path that can complete a square.
watch(
  () => gameStore.state.movementIntent?.seq,
  () => {
    if (renderer) renderer.setMovementIntent(gameStore.state.movementIntent);
  },
);
// A failed Dodge/Rush/Pickup and its reroll result are server-coordinate fences. Run this after the ordinary
// presentation + intent feeds so a stale walk cursor cannot remain the final owner of the rendered token.
watchMovementPresentationReconciliation(
  () => gameStore.state.movementPresentationFence,
  () => renderer,
  () => gameStore.state.confirmedMovementDrainActive,
);
watchMovementPresentationRecovery(
  () => gameStore.state.movementPresentationRecovery,
  () => renderer,
  () => gameStore.state.confirmedMovementDrainActive,
  (message, error) => gameStore.reportMovementPresentationRecoveryDiagnostic(message, error),
);
watchBoardPresentationReconciliation(
  () => gameStore.state.boardPresentationFence,
  () => renderer,
  () => gameStore.state.confirmedMovementDrainActive,
);
// Confirmed movement presentation is a Modern rendering capability, not an interactive-click mode. It remains
// active for spectators and the live tail of replay, but the store drops it during snap-only historical catch-up.
watchConfirmedMovementPresentation(
  () => gameStore.state.confirmedMovementDrainActive,
  () => renderer,
);

// Clear move-trail numbers only on the received turnEnd signal.
watch(
  () => gameStore.state.moveTrailClearSeq,
  () => {
    if (!renderer) return;
    renderer.clearMoveTrail();
    renderer.clearUnactivatedCues(); // owner 09-08: the turn is over — idle-player arrows go with it
  },
);

// Render kick descent from the store's frozen landing snapshot; renderer completion clears the matching gate.
watch(
  () => gameStore.state.kickDescend?.seq,
  () => { if (renderer) renderer.setKickDescend(gameStore.state.kickDescend); },
);
watch(
  () => gameStore.state.kickClearSeq,
  () => renderer?.clearKickAnimation(),
);

// Render the store's sequenced Officious Ref/Pitch Invasion victim cues as one-shots.
watch(
  () => gameStore.state.kickoffVictimSplash?.seq,
  () => { if (renderer) renderer.setKickoffVictimSplash(gameStore.state.kickoffVictimSplash); },
);

// #141 (owner): ball-direction arrow (punt/swoop) — the #124/#131 twin. Tarkin's store surfaces
// state.ballDirection = {playerId, direction, seq} (9246514e); Voss's renderer setBallDirection (ba730390) resolves
// the player square + compass→arrow internally (BD-1) and draws a one-shot arrow. This view-watch is the seam piece;
// pass null on clear (a game-reset nulls the snapshot → seq→undefined → setBallDirection(null) clears the arrow).
watch(
  () => gameStore.state.ballDirection?.seq,
  () => { if (renderer) renderer.setBallDirection(gameStore.state.ballDirection ?? null); },
);

// #139 (owner): Master Chef PREGAME splash — a team-level flourish (no player victim) when the chef steals ≥1
// re-roll (state.masterChefSplash, Tarkin d31d0f8d; fires at each half-start when stolen>0). It's a CENTER BANNER,
// not a token/renderer sink, so it's a DOM splash here (like the turnstart splash) with a view-timed auto-hide —
// the store sets it on the steal and only clears on a game change. Seq-triggered visibility (twin idea of #131).
const masterChefSplashVisible = ref(false);
let masterChefSplashTimer = 0;
watch(() => gameStore.state.masterChefSplash?.seq, () => {
  if (!gameStore.state.masterChefSplash) return;
  masterChefSplashVisible.value = true;
  clearTimeout(masterChefSplashTimer);
  masterChefSplashTimer = window.setTimeout(() => (masterChefSplashVisible.value = false), presentationMs(4200));
});
onBeforeUnmount(() => clearTimeout(masterChefSplashTimer));

// owner ruling 08-17: Riotous Rookies hire splash — mirrors #139 Master Chef exactly (same timing hookup,
// same view-timed auto-hide, same seq-triggered pattern). state.riotousRookiesSplash; the log line lands
// standalone via reportFormatter (riotousRookies).
const riotousRookiesSplashVisible = ref(false);
let riotousRookiesSplashTimer = 0;
watch(() => gameStore.state.riotousRookiesSplash?.seq, () => {
  if (!gameStore.state.riotousRookiesSplash) return;
  riotousRookiesSplashVisible.value = true;
  clearTimeout(riotousRookiesSplashTimer);
  riotousRookiesSplashTimer = window.setTimeout(() => (riotousRookiesSplashVisible.value = false), presentationMs(4200));
});
onBeforeUnmount(() => clearTimeout(riotousRookiesSplashTimer));

// #136 (owner, GAP-WAVE-2): opponent-left connection toast. Tarkin's store surfaces state.opponentLeft = {coach,
// seq} (deba6a7c) when a player leaves the game. A view-timed toast (the store clears the snapshot only on a game
// change, so the view bounds the notice); a fresh leave re-fires the seq. Connection-awareness during live play —
// slightly longer than a splash. Same seq-triggered idea as the masterChef splash / #131 view-watch.
const opponentLeftVisible = ref(false);
let opponentLeftTimer = 0;
watch(() => gameStore.state.opponentLeft?.seq, () => {
  if (!gameStore.state.opponentLeft) return;
  opponentLeftVisible.value = true;
  clearTimeout(opponentLeftTimer);
  opponentLeftTimer = window.setTimeout(() => (opponentLeftVisible.value = false), 6500);
});
onBeforeUnmount(() => clearTimeout(opponentLeftTimer));

// Feed keg rings and click gating from one upstream-equivalent legal-target set; the server still validates.
watch(
  () => {
    const g = gameStore.game.value;
    if (!g || !settings.order66 || !gameStore.isPlaying.value) return '';
    if (deriveClientState(g, o66Ctx()) !== 'THROW_KEG') return '';
    const thrower = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    return thrower ? kegTargetIds(g, thrower).join(',') : '';
  },
  (ids) => { if (renderer) renderer.setKegTargets(ids ? ids.split(',') : null); },
  { immediate: true },
);
// Drive the keg range box independently from legal target IDs so an empty target set still shows range.
watch(
  () => {
    const g = gameStore.game.value;
    if (!g || !settings.order66 || !gameStore.isPlaying.value) return '';
    if (deriveClientState(g, o66Ctx()) !== 'THROW_KEG') return '';
    const thrower = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    const sq = thrower ? playerSquareById(thrower) : null;
    return sq ? `${sq[0]},${sq[1]}` : '';
  },
  (key) => {
    if (!renderer) return;
    const p = key ? key.split(',').map(Number) : null;
    renderer.setKegRange(p ? [p[0]!, p[1]!] : null);
  },
  { immediate: true },
);

// Render the store's sequenced negatrait result over the player; the view bounds its lifetime.
const negatraitCue = ref<{ x: number; y: number; text: string; successful: boolean } | null>(null);
let negatraitCueRaf = 0;
let negatraitCueTimer = 0;
watch(() => gameStore.state.negatraitCue?.seq, () => {
  const cue = gameStore.state.negatraitCue;
  cancelAnimationFrame(negatraitCueRaf);
  clearTimeout(negatraitCueTimer);
  if (!cue) { negatraitCue.value = null; return; }
  // Owner 09-06: a PASSED negatrait roll no longer raises the pill (it read "Really Stupid" over every move of a
  // Really Stupid / Bone Head player) — the die toast already carries the roll; only failures keep their phrase.
  if (cue.successful) { negatraitCue.value = null; return; }
  const label = cue.trait || 'Negatrait';
  // FIX 11 placeholders: keep all swappable failure copy in this one switch until owner copy lands.
  // Success-case copy is untouched for
  // every trait. Blood Lust addendum (08-17): the pill now ALSO rides this same surface — store.ts
  // arms it straight off a FAILED ReportBloodLustRoll, independent of the unified bloodlust card's
  // reroll/decision/bite stages (state.bloodlust, untouched) — so it fires with no reroll on offer
  // and on the opponent/spectator seats that never see the card. negatraitCue itself carries no
  // seat-gating (it's driven by the same server-model-sync report every connected client receives),
  // so both seats see it exactly like the other negatrait pills.
  const namedPlayer = (() => {
    if (cue.successful) return null;
    const g = gameStore.game.value;
    const p = g ? [...g.teamHome.playerArray, ...g.teamAway.playerArray].find((pl) => pl.playerId === cue.playerId) : null;
    return p ? (p.posName || p.name) : null;
  })();
  const text = (() => {
    if (cue.successful) return label;
    if (!namedPlayer) return `${label}!`;
    switch (label) {
      case 'Really Stupid': return `${namedPlayer} is Really Stupid!`;
      case 'Bone Head':
      case 'Bone-Head': return `${namedPlayer} is Boneheaded`;
      case 'Animal Savagery':
        return cue.hasTarget === false
          ? `${namedPlayer} wants to lash out but nobody is there!`
          : `${namedPlayer} lashes out!`;
      case 'Unchannelled Fury': return `${namedPlayer} has nowhere to channel their fury!`;
      case 'Blood Lust': return `${namedPlayer} thirsts for blood!`;
      case 'Pro': return `${namedPlayer} tries to use pro but fails!`;
      case 'Take Root': return `${namedPlayer} takes root!`;
      case 'Wild Animal': return `${namedPlayer} won't listen!`;
      default: return `${label}!`;
    }
  })();
  const step = () => {
    const g = gameStore.game.value;
    const sq = g && renderer ? playerSquareById(cue.playerId) : null;
    const p = sq ? renderer!.squareToCanvas(sq) : null;
    if (p) negatraitCue.value = { x: p.x, y: p.y - 56, text, successful: cue.successful };
    negatraitCueRaf = requestAnimationFrame(step);
  };
  step();
  // A FAIL dwells longer (must read); a PASS is brief + subtle.
  negatraitCueTimer = window.setTimeout(() => {
    negatraitCue.value = null;
    cancelAnimationFrame(negatraitCueRaf);
  }, presentationMs(cue.successful ? 1400 : 2600));
});
onBeforeUnmount(() => { cancelAnimationFrame(negatraitCueRaf); clearTimeout(negatraitCueTimer); });

// On-pitch action d6 (owner 2026-07-03 r3) — pop a die with the rolled value
// next to each acting player's square. Shown regardless of spectator-clean (it's
// a roll RESULT, not a planner preview).
watch(
  () => gameStore.state.actionDice?.seq,
  () => {
    const a = gameStore.state.actionDice;
    if (!a || !renderer) return;
    // Owner 2026-07-06 (event pacing): if the roll is OFF camera in auto-director mode,
    // nudge the camera to it FIRST, then show the die once the pan has arrived — so an
    // off-screen dodge/GFI isn't rendered where the viewer can't see it.
    const delay = a.rolls[0] ? renderer.ensureOnCamera(a.rolls[0].square) : 0;
    // #24 (tester, owner; Voss-scoped): a PICKUP roll reveals a BEAT after the mover settles
    // on the ball square (arrive→[beat]→reveal) instead of popping the instant the token lands.
    // ONLY pickups get the beat — dodge/GFI/block/catch keep their timing. ⚖ delays WHEN a
    // resolved report shows, never what's known; the beat scales with the movement-speed setting.
    const pickupBeat = a.rolls.some((r) => r.cause === 'pickup') ? presentationMs(settings.moveSpeedMs) : 0;
    const show = () => { for (const roll of a.rolls) renderer?.showActionDie(roll.square, roll.value, roll.cause, roll.failed, roll.needed, roll.rerollSkill, roll.rerollTeam, roll.opponentRerollPending); };
    const wait = delay + pickupBeat;
    if (wait > 0) window.setTimeout(show, wait); else show();
  },
);

// Render one paced stalling warning per commandNr-deduplicated ReportStallerDetected.
const stallerSplash = ref<{ player: string; seq: number } | null>(null);
let stallerSplashTimer = 0;
watch(
  () => gameStore.state.stallerDetected?.seq,
  () => {
    const s = gameStore.state.stallerDetected;
    if (!s) return;
    stallerSplash.value = { player: s.player, seq: s.seq };
    if (stallerSplashTimer) clearTimeout(stallerSplashTimer);
    stallerSplashTimer = window.setTimeout(() => { stallerSplash.value = null; }, presentationMs(3200));
  },
);

// Owner 2026-07-05: ARMOUR dice (2d6 + breastplate) next to each fallen player.
// Lifted from the injury report by the store (there is no standalone armour report).
watch(
  () => gameStore.state.armorDice?.seq,
  () => {
    const a = gameStore.state.armorDice;
    if (a && renderer) for (const ar of a.rolls) renderer.showArmorRoll(ar.square, ar.rolls, ar.broken);
  },
);

let kickoffArcSettled = false;

// kickAim normally arms before the authoritative kick-off result. If that later
// result opens a coach mini-phase, extend the already-running apex hold on the
// synchronous false -> true edge, before the next renderer refresh can release it.
watchKickoffArcDecisionDwell({
  needsDecisionDwell: () => gameStore.state.kickoffArcNeedsDecisionDwell,
  arcActive: () => !!gameStore.state.kickAim,
  catchingUp: () => gameStore.playbackCatchingUp.value,
  mayHold: () => kickoffCineHoldGuard(kickoffArcSettled, 'unchanged').mayHold,
  hold: (ms) => renderer?.holdBallKickIn(ms),
  dwellMs: presentationMs(KICKOFF_CINE_MS),
});

// kickoffScatter is a public server reveal, not a flight: publish its target/dice to every seat and tag the
// matching model transition so setGame cannot mistake command 62 for a generic throw-in/touchback ball-in.
watch(
  () => gameStore.state.kickScatterPreview?.seq,
  () => {
    const scatter = gameStore.state.kickScatterPreview;
    renderer?.setServerKickoffScatter(scatter ? {
      commandNr: scatter.commandNr,
      endpoint: scatter.unreducedEndpoint,
      seq: scatter.seq,
    } : null);
  },
  { flush: 'sync' },
);

// Sync-flush kickAim so the renderer arms the apex before kickDescend refreshes.
watch(
  () => gameStore.state.kickAim?.seq,
  () => {
    const k = gameStore.state.kickAim;
    if (k) {
      kickoffArcSettled = kickoffCineHoldGuard(kickoffArcSettled, 'aimArmed').settled;
      if (!renderer) return;
      renderer.setPendingKickAim(k.square);
      // Owner 2026-07-08 (event-priority B0): the TARGET-BALL crosshair renders the
      // moment the aim is known — BEFORE the kick-off event splash (this watcher is
      // sync-flush) — and persists (pulsing) through the splash + flight until the
      // ball lands (cleared at landing / game change).
      renderer.showKickTargetPersistent(k.square, false);
      // Owner 2026-07-06 (pacing 2): the kick is aimed — start HOLDING the ball at its
      // apex now (before the landing frame renders), so it holds in the air while the
      // interactive kick-off event mini-phase and only descends after. Fully resolved
      // events add no artificial apex pause.
      if (!gameStore.playbackCatchingUp.value) {
        const decisionDwell = gameStore.state.kickoffArcNeedsDecisionDwell ? presentationMs(KICKOFF_CINE_MS) : 0;
        renderer.holdBallKickIn(presentationMs(KICK_FLYIN_MS) + decisionDwell);
      }
    }
  },
  { flush: 'sync' },
);

watch(
  () => gameStore.state.kickDescend,
  (descend, previous) => {
    if (!descend && previous) kickoffArcSettled = kickoffCineHoldGuard(kickoffArcSettled, 'descendSettled').settled;
  },
  { flush: 'sync' },
);

// Owner: skill-use choice cinematic — zoom to the action's square and capture
// the player's rendered portrait as the 20%-opacity silhouette behind the
// tooltip. Plays for players AND spectators (the store sets skillChoice inside
// the paced applyFrame, so spectate playback/timestamps are respected).
const skillSilhouette = ref<string | null>(null);
const selectSkillPortrait = ref<string | null>(null);
const prayerRecipientPortrait = ref<string | null>(null);
const intensiveTrainingSelect = computed(() => String(gameStore.state.selectSkill?.mode ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'intensivetraining');
watch(
  () => gameStore.state.skillChoice?.seq,
  () => {
    const choice = gameStore.state.skillChoice;
    if (!choice || !renderer) {
      skillSilhouette.value = null;
      return;
    }
    skillSilhouette.value = renderer.playerPortrait(choice.playerId);
    const data = gameStore.game.value?.fieldModel.playerDataArray.find((d) => d.playerId === choice.playerId);
    const at = data?.playerCoordinate;
    if (at && at[0] >= 0 && at[0] <= 25 && at[1] >= 0 && at[1] <= 14) {
      const holdMs = presentationMs(choice.mine ? 8000 : 4200);
      // Owner 2026-07-05: gentler skill-use zoom — half the zoom-in of the default
      // 1.7× (→ 1.35×), less jarring than the full cinematic push.
      renderer.cinematicZoom([at[0], at[1]], holdMs, { zoom: 1.35 });
      // The skill-use SPOTLIGHT is disabled (too distracting); the skill's icon
      // fades in over the player instead — driven by the `skillUsed` report watcher.
    }
  },
);

// Anchor skill-use icon/toast to the live player token, not the report's possibly stale square.
let skillToastRaf = 0;
watch(
  () => gameStore.state.skillUsed?.seq,
  () => {
    const su = gameStore.state.skillUsed;
    if (!su || !renderer) return;
    // Owner o66af + 08-19: a DECLINED skill (Stand Firm) shows only the "<name> does not use <skill>" toast —
    // no icon fade, no crowd cheer (nothing was used). It rides the SAME fading pill as the used-toast
    // (owner 08-19 overruled the 07-13 persistent click-to-acknowledge surface: it read as a modal).
    if (su.declined) {
      const pd = su.anchored ? renderer.feetToCanvas(su.square, true) : renderer.playerFeetScreenPos(su.playerId, su.square);
      showToast(`${su.name} does not use ${su.skill}`, pd?.x ?? 0, pd?.y ?? 44, 3000, true);
      cancelAnimationFrame(skillToastRaf);
      if (!su.anchored) followSkillToast(su.playerId, su.square);
      return;
    }
    // Fade the icon over the player's CURRENT square (live model), not the report's —
    // UNLESS the store anchored it (#1/#5: a defender's block-reaction skill pins to the
    // block square, since the live token has been pushed / side-stepped off to the side).
    const live = su.anchored ? undefined : gameStore.game.value?.fieldModel.playerDataArray.find((d) => d.playerId === su.playerId)?.playerCoordinate;
    const iconSq = live && live[0] >= 0 && live[0] < 26 && live[1] >= 0 && live[1] < 15 ? ([live[0], live[1]] as [number, number]) : su.square;
    renderer.playSkillIconFade(iconSq, su.skill);
    // Owner 2026-07-06: the crowd heckles certain skills (Fend / Stand Firm) — the
    // SKILL USER's own fans cheer, so the quip fires from their side's stand.
    const quip = CROWD_QUIPS[su.skill.toLowerCase().trim()];
    if (quip) renderer.crowdQuip(quip, playerSide(su.playerId));
    // #1/#5: anchored (a defender's block-reaction skill) pins to the BLOCK square and
    // does NOT chase the live token; everything else RAF-follows the token as before.
    // Owner 09-05: the pill sits BELOW the token (the skill icon stays on the player, both are kept).
    const p0 = su.anchored ? renderer.feetToCanvas(su.square, true) : renderer.playerFeetScreenPos(su.playerId, su.square);
    showToast(su.toast ?? `${su.name} used ${su.skill}`, p0?.x ?? 0, p0?.y ?? 44, 3000, true);
    cancelAnimationFrame(skillToastRaf);
    if (!su.anchored) followSkillToast(su.playerId, su.square);
    // Owner 09-09: the same report's pill on the OTHER player (Tentacles: the held mover) — static at their feet.
    if (su.also) {
      const p1 = renderer.playerFeetScreenPos(su.also.playerId, su.also.square);
      showToast(su.also.toast, p1?.x ?? 0, p1?.y ?? 44, 3000, true);
    }
  },
);

/** RAF-follow the live token with the skill used/declined pill (non-anchored case; shared by both branches above). */
function followSkillToast(playerId: string, square: [number, number]) {
  const follow = () => {
    if (!toast.visible || !renderer) return;
    const p = renderer.playerFeetScreenPos(playerId, square);
    if (p) { toast.x = p.x; toast.y = p.y; }
    skillToastRaf = requestAnimationFrame(follow);
  };
  follow();
}

// The shared consumer owns the bounded Watch Out! toast lifetime. This view supplies the live
// renderer coordinate, which now resolves both on-pitch and Modern dugout token generations.
function modernWatchOutPlayerScreenPos(playerId: string) {
  return renderer?.playerScreenPos(playerId);
}
/** Owner 09-05: the SPP banner rides the top of the player's HEAD (walker figures are taller than the classic icon). */
function modernPlayerHeadScreenPos(playerId: string) {
  return renderer?.playerHeadScreenPos(playerId);
}

// A (owner 2026-07-06): the "Use «skill»?" DECISION dialog (state.skillChoice, e.g.
// a DEFENDER's Stand Firm / Sidestep) was pinned top-right (CSS 71%/24%). Bind it to
// the deciding player's token so "coach is deciding…" reads OVER the block, not off to
// the side. RAF-follows like the reroll menu; falls back to the CSS spot until ready.
const skillChoicePos = reactive({ x: 0, y: 0, ready: false });
let skillChoiceRaf = 0;
// Owner UAT 08-12 (class-wide — Yularen ruling, generalizes the Saboteur skillChoice fix): a movable reactive
// card RAF-FOLLOWS its token/anchor. When a prompt fires mid-animation (Saboteur at knockdown, the token still
// falling) the card shifts BETWEEN pointerdown and pointerup, so the native `click` (needs both on the same
// element) is lost → it took two clicks. `reactivePromptHeld` names the card whose pointer is currently down;
// startReactivePromptDrag sets it (before its answer-selector early-return, so a press on a BUTTON freezes too),
// and each movable card's RAF-follow skips its position write while its key is held — the press resolves on a
// stationary target, following resumes on release. The trait is structural to the whole family, so every
// RAF-followed prompt guards on this (a dropped decision-click is always a bug, even when rare).
const reactivePromptHeld = ref<ReactivePromptDragKey | null>(null);
watch(
  () => gameStore.state.skillChoice?.seq,
  () => {
    cancelAnimationFrame(skillChoiceRaf);
    skillChoicePos.ready = false;
    const sc = gameStore.state.skillChoice;
    if (!sc || !renderer) return;
    const follow = () => {
      if (!gameStore.state.skillChoice || !renderer) { skillChoicePos.ready = false; return; }
      const p = renderer.playerScreenPos(sc.playerId);
      if (p && reactivePromptHeld.value !== 'skillChoice') { skillChoicePos.x = p.x; skillChoicePos.y = p.y - 54; skillChoicePos.ready = true; }
      skillChoiceRaf = requestAnimationFrame(follow);
    };
    follow();
  },
);
// Owner 09-08: the passive "<coach> is deciding…" pill (Shadowing / opponent skill decisions) parks at the deciding
// player's token like the other reactive pills; without an on-screen anchor it keeps the top-centre fallback.
const opponentPendingPos = reactive({ x: 0, y: 0, ready: false });
let opponentPendingRaf = 0;
watch(
  () => [gameStore.state.opponentChoicePending, gameStore.state.opponentChoicePendingPlayerId] as const,
  () => {
    cancelAnimationFrame(opponentPendingRaf);
    opponentPendingPos.ready = false;
    const playerId = gameStore.state.opponentChoicePendingPlayerId;
    if (!gameStore.state.opponentChoicePending || !playerId || !renderer) return;
    const follow = () => {
      if (!gameStore.state.opponentChoicePending || gameStore.state.opponentChoicePendingPlayerId !== playerId || !renderer) { opponentPendingPos.ready = false; return; }
      const p = renderer.playerScreenPos(playerId);
      if (p) { opponentPendingPos.x = p.x; opponentPendingPos.y = p.y - 54; opponentPendingPos.ready = true; } else opponentPendingPos.ready = false;
      opponentPendingRaf = requestAnimationFrame(follow);
    };
    follow();
  },
);
// Owner 2026-07-08: bind the VAMPIRE BLOODLUST card to the vampire's token the same way as the
// sidestep/stand-firm skill toast — RAF-follows `playerScreenPos`, sits just above the token.
const bloodlustPos = reactive({ x: 0, y: 0, ready: false });
let bloodlustRaf = 0;
watch(
  () => gameStore.state.bloodlust?.seq,
  () => {
    cancelAnimationFrame(bloodlustRaf);
    bloodlustPos.ready = false;
    const b = gameStore.state.bloodlust;
    if (!b || !renderer) return;
    const follow = () => {
      if (!gameStore.state.bloodlust || !renderer) { bloodlustPos.ready = false; return; }
      const p = renderer.playerScreenPos(gameStore.state.bloodlust.playerId);
      if (p && reactivePromptHeld.value !== 'bloodlust') { bloodlustPos.x = p.x; bloodlustPos.y = p.y - 54; bloodlustPos.ready = true; }
      bloodlustRaf = requestAnimationFrame(follow);
    };
    follow();
  },
);

// Pulse at paced injury time; anchor KO toast to the live token with the injury square as fallback.
const STUNNED_BASE = 0x04; // PlayerStateBase.STUNNED
const KO_BASE = 0x05; // PlayerStateBase.KNOCKED_OUT
const DEAD_BASE = 0x08; // PlayerStateBase.DEAD — the crowd's skull-dice cheer
const injuryIsKo = computed(() => gameStore.state.injurySplash?.injuryBase === KO_BASE);
const injuryIsRockImpact = computed(() => gameStore.state.injurySplash?.rockImpactOnly === true);
// Owner 2026-07-08 (pipeline Phase 3b): a STUN may show as a lightweight token TAG
// instead of the full banner (Settings → Display · Stun display). KO/casualty unchanged.
const injuryIsStunTag = computed(
  () => !injuryIsRockImpact.value
    && gameStore.state.injurySplash?.injuryBase === STUNNED_BASE
    && settings.stunDisplay === 'tag',
);
// Owner 2026-07-07: a CASUALTY (Badly Hurt / Seriously Hurt / Dead — anything worse than a KO)
// now reads as a TOKEN-BOUND toast at the injured square (like the KO toast + fend/sidestep/stand
// firm skill toasts), NOT the full-width banner.
const injuryIsCasualty = computed(() => {
  return gameStore.state.injurySplash?.isCasualty === true;
});
// Owner 2026-07-08: the casualty toast NAMES the injury. The server sends the edition-correct
// result string (e.g. "Seriously Hurt (MNG)", "Serious Injury (NI)", "Smashed Knee (-MA)",
// "Dead (RIP)"); map it (by keyword, tolerant of the "(-ST)" stat suffix) to the injury phrasing.
// A plain Badly Hurt (state casualty, no result string) falls back to "is Badly Hurt!".
function injuryPhrase(splash: { player: string; seriousInjury?: string | null; injuryBase: number }): string {
  const who = splash.player || 'The player';
  const s = (splash.seriousInjury ?? '').toLowerCase();
  if (s.includes('rip') || s.includes('dead') || s.includes('killed')) return `${who} is KILLED!`;
  if (s.includes('knee')) return `${who} has smashed their knee!`;
  if (s.includes('arm')) return `${who} has broken their arm!`;
  if (s.includes('hip')) return `Call Lifeline! ${who} has dislocated their hip!`;
  if (s.includes('shoulder')) return `${who} has broken their shoulder!`;
  if (s.includes('head') || s.includes('eye') || s.includes('concussion') || s.includes('skull') || s.includes('neck'))
    return `${who} receives a Head Injury!`;
  if (s.includes('niggling') || s.includes('(ni)')) return `${who} receives a Niggling Injury!`;
  if (s.includes('seriously hurt') || s.includes('mng')) return `${who} is Seriously Hurt!`;
  if (splash.injuryBase === DEAD_BASE) return `${who} is KILLED!`; // DEAD state, no result string
  return `${who} is Badly Hurt!`; // no lasting-injury string → the coarse casualty
}
const casualtyPhrase = computed(() =>
  gameStore.state.injurySplash ? injuryPhrase(gameStore.state.injurySplash) : '',
);
// Owner 2026-07-07: injury display — every injury also gets a token-bound toast at the injured
// square (KO / casualty / stun), and a CASUALTY additionally KEEPS its full-width splash banner
// (owner: the casualty splash returns + the red toast over the square). KO/stun are toast-only;
// a tag-mode stun uses the lightweight stun tag.
const koToastPos = reactive({ x: 0, y: 0, ready: false });
let koToastRaf = 0;
watch(
  () => gameStore.state.injurySplash,
  (ev) => {
    cancelAnimationFrame(koToastRaf);
    koToastPos.ready = false;
    if (!ev || !renderer) return;
    if (ev.square) renderer.playInjuryPulse(ev.square); // queue 5: pulse at the injury square
    // Owner 2026-07-06: the crowd reacts — the OPPOSING team's fans cheer the victim's
    // misfortune. A DEATH gets the FUMBBL skull dice; a landed FOUL gets "GET STOMPED"
    // (e.g. an Away player fouled → a Home-side fan shouts it).
    const cheeringSide = otherSide(playerSide(ev.playerId));
    if (ev.injuryBase === DEAD_BASE) renderer.crowdSkullQuip(cheeringSide);
    if (ev.foul) renderer.crowdQuip('GET STOMPED', cheeringSide);
    // Owner 2026-07-08: anchor the injury toast to the injury SQUARE (same as the injury pulse /
    // die markers), not the token — a KO'd/removed player's token drifts off, so pin where it
    // happened. RAF still re-reads each frame so it tracks board pan/zoom. Falls back to the token
    // only when the injury square is unknown.
    const follow = () => {
      if (!gameStore.state.injurySplash || !renderer) { koToastPos.ready = false; return; }
      const p = (ev.square ? renderer.screenPosOf(ev.square) : null) ?? renderer.playerScreenPos(ev.playerId, ev.square);
      if (p) { koToastPos.x = p.x; koToastPos.y = p.y; koToastPos.ready = true; }
      koToastRaf = requestAnimationFrame(follow);
    };
    follow();
  },
);

// Owner 2026-07-08: FALLS OVER toast — a failed Dodge/GFI knocks the player over; a brief
// "Falls over!" toast rides the fall square (RAF-follows pan/zoom), auto-clears.
const FALL_TOAST_MS = 1600;
const fallOverPos = reactive({ x: 0, y: 0, ready: false });
const fallOverVisible = ref(false);
let fallOverRaf = 0;
let fallOverHideTimer = 0;
watch(
  () => gameStore.state.fallOver?.seq,
  () => {
    const ev = gameStore.state.fallOver;
    cancelAnimationFrame(fallOverRaf);
    clearTimeout(fallOverHideTimer);
    fallOverPos.ready = false;
    if (!ev || !renderer || settings.spectatorClean) { fallOverVisible.value = false; return; }
    fallOverVisible.value = true;
    fallOverHideTimer = window.setTimeout(() => { fallOverVisible.value = false; }, presentationMs(FALL_TOAST_MS));
    const follow = () => {
      if (!fallOverVisible.value || !renderer) { fallOverPos.ready = false; return; }
      // Owner 09-05: the toast hangs under the token's BOTTOM EDGE (feet) for classic and Super FUMBBL sprites alike —
      // the fallen player is whoever occupies the fall square; feetToCanvas keys off the square's ground point.
      const p = renderer.feetToCanvas(ev.square, false, 14);
      if (p) { fallOverPos.x = p.x; fallOverPos.y = p.y; fallOverPos.ready = true; }
      fallOverRaf = requestAnimationFrame(follow);
    };
    follow();
  },
);

// Owner 2026-07-08 (rev 3): the reroll prompt is a compact MENU anchored to the
// failed player's TOKEN (was the big centered cinematic card). The failed d6 is
// re-shown on the pitch WITH the FAILED stencil (play mode included — the coach
// sees the fail stamped, then picks a reroll source from the menu). RAF-follows
// the token like the KO toast; zoom kept, spotlight stays deprecated.
const rerollMenuPos = reactive({ x: 0, y: 0, ready: false });
let rerollMenuRaf = 0;
// Owner W23: the reroll SPLASH (rerollSplash, the blue/red toast below) should anchor above the
// reroll PROMPT CARD (rerollMenuPos, "Use a re-roll?") that triggered it — the splash fires ON
// answering, i.e. just after the card unmounts, so track the card's last-seen position + a short
// recency window rather than requiring it to still be mounted. No card in the window (opponent's
// reroll, auto-reroll, headless) ⇒ style helper below returns undefined ⇒ CSS default (top:76px) fallback.
const rerollCardLastSeen = reactive({ x: 0, y: 0, at: 0 });
const REROLL_SPLASH_ANCHOR_WINDOW_MS = 2500;
// Owner W25: an inducement-use message (Weather Mage etc. — carries its own `.text`, unlike the
// plain team/skill reroll toast) is a match-level announcement, not a routine in-turn reroll cue —
// it screen-centers on the .turnover-splash vertical band (top:40%, the fleet's established
// full-screen-splash precedent) rather than anchoring near the reroll-prompt card. Horizontal
// centering (left:50% + translateX(-50%)) is already the .reroll-toast CSS default, so only `top`
// needs the override — the drop-in keyframe animates `transform`, not `top`.
// Owner 08-19 (action-reroll splash restored): seats with NO originating card on screen (opponent/
// spectator action rerolls — the reroll menu only surfaces for the deciding coach) anchor over the
// acting player's TOKEN instead, the same surface the reroll menu itself rides. RAF-follow like
// rerollMenuPos so zoom/pan during the splash's 2s life doesn't strand it.
const rerollSplashTokenPos = reactive({ x: 0, y: 0, ready: false });
let rerollSplashTokenRaf = 0;
watch(
  () => gameStore.state.rerollSplash?.seq,
  (seq) => {
    cancelAnimationFrame(rerollSplashTokenRaf);
    rerollSplashTokenPos.ready = false;
    const splash = gameStore.state.rerollSplash;
    if (!splash || seq == null || splash.text || !splash.playerId) return;
    const pid = splash.playerId;
    const follow = () => {
      if (gameStore.state.rerollSplash?.seq !== seq) { rerollSplashTokenPos.ready = false; return; }
      const p = renderer?.playerScreenPos(pid);
      const host = pitchHost.value;
      if (p && host && renderer) {
        rerollSplashTokenPos.x = Math.min(Math.max(p.x, 90), Math.max(host.clientWidth - 90, 90));
        // Owner 09-06: the splash sat ON the action-die toast (die at 0.7 tile above the anchor, 28 px tall) —
        // lift past the die's top edge in screen px, then the computed's −46 clears the toast's own height.
        const dieTop = (TILE_H * 0.7 + 16) * renderer.cameraScale();
        rerollSplashTokenPos.y = Math.max(p.y - dieTop, 60);
        rerollSplashTokenPos.ready = true;
      }
      rerollSplashTokenRaf = requestAnimationFrame(follow);
    };
    follow();
  },
);
const rerollSplashAnchorStyle = computed(() => {
  const splash = gameStore.state.rerollSplash;
  if (!splash) return undefined;
  if (splash.text) return { top: '40%' };
  const fresh = rerollMenuPos.ready || (Date.now() - rerollCardLastSeen.at) < REROLL_SPLASH_ANCHOR_WINDOW_MS;
  if (fresh) {
    const x = rerollMenuPos.ready ? rerollMenuPos.x : rerollCardLastSeen.x;
    const y = rerollMenuPos.ready ? rerollMenuPos.y : rerollCardLastSeen.y;
    return { left: `${x}px`, top: `${Math.max(0, y - 46)}px` };
  }
  // No card on this screen → the acting player's token; CSS default (top:76px band) only if neither resolves.
  if (rerollSplashTokenPos.ready) return { left: `${rerollSplashTokenPos.x}px`, top: `${Math.max(0, rerollSplashTokenPos.y - 46)}px` };
  return undefined;
});
// Owner 08-18 (B&C screenshot: the DIRECTION re-roll card sat on top of the destination squares + the
// direction arrow). The reroll card is anchored to the ACTING player's token, which for a Ball & Chain
// direction re-roll is exactly where the decision is drawn: the Fanatic's square, the scatter destination
// (setBncScatterDest + its crosshair/die) and the arrow between them. Name that as an avoid-region so
// reRollPromptScreenPosition can flip the card clear of it. Null for every other prompt = unchanged
// behaviour; the machinery is generic, so another anchored prompt can opt in the same way.
const BNC_AVOID_RING: [number, number][] = [
  [0, 0], [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];
function screenSquarePad(square: [number, number]): number {
  if (!renderer) return 24;
  const a = renderer.screenPosOf(square);
  const b = renderer.screenPosOf([Math.min(25, square[0] + 1), square[1]]);
  return a && b ? Math.max(12, Math.hypot(b.x - a.x, b.y - a.y) / 2) : 24;
}

/** Renderer-coordinate keep-out box for a live player token; uses the shared bounds-dodge geometry. */
function playerTokenAvoidRect(playerId: string): PromptRect | null {
  if (!renderer) return null;
  const square = playerSquareById(playerId);
  const pos = renderer.playerScreenPos(playerId, square);
  if (!pos || !square) return null;
  const pad = screenSquarePad(square);
  return { left: pos.x - pad, right: pos.x + pad, top: pos.y - pad, bottom: pos.y + pad };
}
function bncDirectionAvoidRect(): PromptRect | null {
  if (gameStore.state.reRollPrompt?.reRolledAction !== 'Direction') return null;
  const s = gameStore.state.bncScatter;
  if (!s || !renderer) return null;
  const pts: { x: number; y: number }[] = [];
  const push = (sq: [number, number]) => {
    if (sq[0] < 0 || sq[0] > 25 || sq[1] < 0 || sq[1] > 14) return;
    const p = renderer!.screenPosOf(sq);
    if (p) pts.push(p);
  };
  push(s.dest); // scatter destination (crosshair + tagged d6)
  // Acting square + its adjacent ring — the fan the arrow is drawn over. PRESENTATION geometry only (a
  // screen-space keep-out box); it derives no legal squares, which stay the shared controller's business.
  // The union's bounding box also covers the from→dest arrow corridor, which has no screen-space accessor.
  for (const [ox, oy] of BNC_AVOID_RING) push([s.from[0] + ox, s.from[1] + oy]);
  if (pts.length === 0) return null;
  // Half-square pad, derived from the live tile pitch (zoom-independent); fall back if we only got one point.
  const pad = screenSquarePad(s.from);
  return {
    left: Math.min(...pts.map((p) => p.x)) - pad,
    right: Math.max(...pts.map((p) => p.x)) + pad,
    top: Math.min(...pts.map((p) => p.y)) - pad,
    bottom: Math.max(...pts.map((p) => p.y)) + pad,
  };
}
/** Measure the live reroll card as an offset from the anchor we placed it at last frame, so the dodge math
 *  needs no knowledge of the family's CSS (translateX(-50%) in icons mode, none in markings mode) or of the
 *  per-mode +16/+18 template nudge. Needs one settled frame — until then the dodge simply doesn't apply. */
function rerollCardBox(host: HTMLElement | null): PromptCardBox | null {
  if (!host || !rerollMenuPos.ready) return null;
  const el = host.querySelector('.reroll-bar, .reroll-menu') as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  const hr = host.getBoundingClientRect();
  return {
    width: r.width, height: r.height,
    dx: (r.left - hr.left) - rerollMenuPos.x,
    dy: (r.top - hr.top) - rerollMenuPos.y,
  };
}
watch(
  () => gameStore.state.reRollPrompt?.seq,
  () => {
    cancelAnimationFrame(rerollMenuRaf);
    rerollMenuPos.ready = false;
    const p = gameStore.state.reRollPrompt;
    if (!p) {
      return;
    }
    const data = gameStore.game.value?.fieldModel.playerDataArray.find((d) => d.playerId === p.playerId);
    const at = data?.playerCoordinate;
    const sq: [number, number] | null =
      at && at[0] >= 0 && at[0] <= 25 && at[1] >= 0 && at[1] <= 14 ? [at[0], at[1]] : null;
    if (sq && renderer) {
      renderer.cinematicZoom(sq, 9000);
      if (p.roll) renderer.showActionDie(sq, p.roll, undefined, !p.thresholdless, p.needed);
    }
    const follow = () => {
      if (!gameStore.state.reRollPrompt) { rerollMenuPos.ready = false; return; }
      const pos = renderer?.playerScreenPos(p.playerId, sq);
      const host = pitchHost.value;
      if (reactivePromptHeld.value !== 'reroll') {
        const placed = reRollPromptScreenPosition(pos, {
          width: host?.clientWidth ?? window.innerWidth,
          height: host?.clientHeight ?? window.innerHeight,
        }, { avoid: bncDirectionAvoidRect(), card: rerollCardBox(host) });
        rerollMenuPos.x = placed.x;
        rerollMenuPos.y = placed.y;
        rerollMenuPos.ready = true;
        rerollCardLastSeen.x = placed.x;
        rerollCardLastSeen.y = placed.y;
        rerollCardLastSeen.at = Date.now();
      }
      rerollMenuRaf = requestAnimationFrame(follow);
    };
    follow();
  },
);

// #237 (owner-fg 07-29): reactive prompt cards keep a per-instance manual position once dragged.
type ReactivePromptDragKey =
  | 'skillChoice' | 'bloodlust' | 'reroll' | 'playerPick' | 'pickMeUp' | 'sendOff' | 'wideRailActivation'
  | 'apothecaryChoice' | 'apothecaryD16' | 'apothecaryAutoReturn' | 'selectSkill' | 'endTurnWarn' | 'endActConfirm'
  | 'blitzMove' | 'keywordChoice' | 'cardChoice' | 'cardBuy' | 'coinChoice' | 'receiveChoice'
  | 'yesNo' | 'blockAlternative' | 'followup' | 'blockPartial' | 'multiBlock'
  | 'injuryInteraction' | 'shadowing' | 'puntConfirm' | 'tentacles' | 'onTheBallWaiting';
type ReactivePromptDragPos = { x: number; y: number };
const reactivePromptDragPos = reactive<Record<ReactivePromptDragKey, ReactivePromptDragPos | null>>({
  skillChoice: null,
  bloodlust: null,
  reroll: null,
  playerPick: null,
  pickMeUp: null,
  sendOff: null,
  wideRailActivation: null,
  apothecaryChoice: null,
  apothecaryD16: null,
  apothecaryAutoReturn: null,
  selectSkill: null,
  endTurnWarn: null,
  endActConfirm: null,
  blitzMove: null,
  keywordChoice: null,
  cardChoice: null,
  cardBuy: null,
  coinChoice: null,
  receiveChoice: null,
  yesNo: null,
  blockAlternative: null,
  followup: null,
  shadowing: null,
  tentacles: null,
  puntConfirm: null,
  blockPartial: null,
  multiBlock: null,
  injuryInteraction: null,
  onTheBallWaiting: null,
});
const reactivePromptStyle = (key: ReactivePromptDragKey, anchored?: { x: number; y: number; leftEdge?: boolean }) => {
  const pos = reactivePromptDragPos[key];
  if (pos) return { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto', bottom: 'auto', transform: 'none' };
  // leftEdge (owner 09-05): `x` is the card's LEFT edge, not its centre — drop the component's translateX(-50%).
  return anchored ? { left: `${anchored.x}px`, top: `${anchored.y}px`, ...(anchored.leftEdge ? { transform: 'none' } : {}) } : undefined;
};
// Owner 09-06: the On the Ball waiting notice docks under the top-centre panel at that panel's width; a drag wins.
const onTheBallWaitingStyle = computed(() => {
  const box = centerPanelBox.value;
  const base = reactivePromptStyle('onTheBallWaiting', box ? { x: box.left, y: box.bottom + 8, leftEdge: true } : undefined);
  if (!base) return undefined;
  return box ? { ...base, width: `${Math.round((box.center - box.left) * 2)}px` } : base;
});
const REACTIVE_PROMPT_ANSWER_SELECTOR = 'button, .reroll-menu-item, .reroll-menu-decline, .bl-opt, .pick-confirm, .pick-decline, .sc-yes, .sc-no, .sendoff-btn, input, a, label, [role=button]';
function startReactivePromptDrag(key: ReactivePromptDragKey, event: PointerEvent) {
  // Class-wide freeze-while-pressed (see reactivePromptHeld): mark this card held on ANY pointerdown — set BEFORE
  // the answer-selector early-return so a press on a button (a decision click) freezes its RAF-follow too, not
  // just a body drag. Released on the next pointerup/cancel anywhere.
  reactivePromptHeld.value = key;
  const releaseHold = () => {
    if (reactivePromptHeld.value === key) reactivePromptHeld.value = null;
    window.removeEventListener('pointerup', releaseHold);
    window.removeEventListener('pointercancel', releaseHold);
  };
  window.addEventListener('pointerup', releaseHold);
  window.addEventListener('pointercancel', releaseHold);
  if ((event.target as HTMLElement).closest(REACTIVE_PROMPT_ANSWER_SELECTOR)) return;
  const el = event.currentTarget as HTMLElement;
  const host = pitchHost.value;
  if (!host) return;
  event.preventDefault();
  const rect = el.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const dx = event.clientX - rect.left;
  const dy = event.clientY - rect.top;
  const move = (ev: PointerEvent) => {
    reactivePromptDragPos[key] = {
      x: Math.max(0, Math.min(ev.clientX - hostRect.left - dx, hostRect.width - rect.width)),
      y: Math.max(0, Math.min(ev.clientY - hostRect.top - dy, hostRect.height - rect.height)),
    };
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
watch(() => gameStore.state.skillChoice?.seq, () => { reactivePromptDragPos.skillChoice = null; });
const swoopCardCopy = computed(() => swoopChoiceCopy(gameStore.game.value, gameStore.state.skillChoice?.skill));
// Owner W36: Juggernaut copy override — display only, generic "Use <skill>?" template unchanged for all other skills.
const isJuggernautCard = computed(() => gameStore.state.skillChoice?.skill === 'Juggernaut');
const passSkillCardCopy = computed(() => passSkillUseCardCopy(gameStore.state.skillChoice));
const hmpScatterSkillCardCopy = computed(() => hmpScatterSkillUseCardCopy(gameStore.state.skillChoice));
const bloodlustTastyMorselAvailable = computed(() => {
  const g = gameStore.game.value;
  const prompt = gameStore.state.bloodlust;
  return !!prompt && tastyMorselAvailable(g, prompt.playerId);
});
watch(() => gameStore.state.bloodlust?.seq, () => { reactivePromptDragPos.bloodlust = null; });
watch(() => gameStore.state.reRollPrompt?.seq, () => { reactivePromptDragPos.reroll = null; });
watch(() => gameStore.state.playerPick?.key, () => {
  reactivePromptDragPos.playerPick = null;
  reactivePromptDragPos.pickMeUp = null;
});
const pickMeUpPrompt = computed(() => gameStore.state.playerPick?.key.startsWith('pchoice:pickMeUp') ?? false);
// FIX 16: the title/card pair follows the live scoreboard bottom; manual drag still wins per body.
const pickMeUpTitleAnchor = computed(() => centerPanelBox.value
  ? { x: centerPanelBox.value.center, y: centerPanelBox.value.bottom + 10 }
  : undefined);
const pickMeUpCardAnchor = computed(() => centerPanelBox.value
  ? { x: centerPanelBox.value.center, y: centerPanelBox.value.bottom + 50 }
  : undefined);
watch(() => gameStore.state.sendOff, (prompt) => { if (!prompt) reactivePromptDragPos.sendOff = null; });
watch(() => gameStore.state.apothecaryChoice?.seq, () => { reactivePromptDragPos.apothecaryChoice = null; });
watch(() => gameStore.state.apothecaryD16?.seq, () => { reactivePromptDragPos.apothecaryD16 = null; });
watch(() => gameStore.state.apothecaryAutoReturn?.seq, () => { reactivePromptDragPos.apothecaryAutoReturn = null; });
watch(() => gameStore.state.selectSkill?.seq, () => { reactivePromptDragPos.selectSkill = null; });
watch(() => gameStore.state.keywordChoice?.seq, () => { reactivePromptDragPos.keywordChoice = null; });
watch(() => gameStore.state.cardChoice?.seq, () => { reactivePromptDragPos.cardChoice = null; });
watch(() => gameStore.state.cardBuy?.seq, () => { reactivePromptDragPos.cardBuy = null; });
watch(() => gameStore.state.coinChoicePrompt?.seq, () => { reactivePromptDragPos.coinChoice = null; });
watch(() => gameStore.state.receiveChoicePrompt?.seq, () => { reactivePromptDragPos.receiveChoice = null; });
watch(() => gameStore.state.yesNo?.seq, () => { reactivePromptDragPos.yesNo = null; });
watch(() => gameStore.state.blitzBlockChoice, (choice) => { if (!choice) reactivePromptDragPos.blockAlternative = null; });
watch(() => gameStore.state.followupChoice?.seq, () => { reactivePromptDragPos.followup = null; });
watch(() => gameStore.state.blockPartial?.seq, () => { reactivePromptDragPos.blockPartial = null; });
// Owner 09-05: a turnover (any failed action) settles every walker to idle + default facing — the acting token
// otherwise held its last stride/facing until the server ended the activation.
watch(() => gameStore.state.turnover?.seq, (seq) => { if (seq && renderer && !gameStore.playbackCatchingUp.value) { renderer.settleWalkersAfterTurnover(); renderer.releaseDiceAtTurnover(); }; });
// Owner 09-05: the applied block result stamped on the affected token(s) with the plain block symbols (no die art).
const BLOCK_STAMP_URLS: Record<string, string> = {
  'attacker-down': new URL('../assets/blockdice-log/attacker-down.png', import.meta.url).href,
  'both-down': new URL('../assets/blockdice-log/both-down.png', import.meta.url).href,
  push: new URL('../assets/blockdice-log/push.png', import.meta.url).href,
  'defender-stumbles': new URL('../assets/blockdice-log/defender-stumbles.png', import.meta.url).href,
  pow: new URL('../assets/blockdice-log/pow.png', import.meta.url).href,
};
watch(() => gameStore.state.blockResultStamp?.seq, () => {
  const stamp = gameStore.state.blockResultStamp;
  if (!stamp || !renderer || settings.spectatorClean) return;
  const url = BLOCK_STAMP_URLS[stamp.symbol];
  if (url) renderer.playBlockResultStamp(stamp.playerIds, url);
});
// Owner 09-05: gold pulse ring on a token placed during setup by another seat (spectator / opposing coach).
watch(() => gameStore.state.setupPlacementPulse?.seq, () => {
  const pulse = gameStore.state.setupPlacementPulse;
  if (pulse) renderer?.pulsePlacementRing(pulse.playerId);
});
watch(() => gameStore.state.multiBlockResolution?.seq, () => { reactivePromptDragPos.multiBlock = null; });
watch(() => gameStore.state.injuryInteraction?.seq, () => { reactivePromptDragPos.injuryInteraction = null; });

/* Show the prompted player's team-reroll count; display only. */
// #205: the separate "team re-rolls available" chip is retired by the unification (the count now rides the
// die icon on each TRR-consuming option), so `rerollPromptHasTeamReRoll` is no longer needed.
const rerollPromptTeamReRolls = computed<number | null>(() => {
  const g = gameStore.game.value;
  const p = gameStore.state.reRollPrompt;
  if (!g || !p) return null;
  const td = playerSide(p.playerId) === 'home' ? g.turnDataHome : g.turnDataAway;
  return td.reRolls ?? 0;
});
const rerollLonerCopy = computed(() => {
  const value = gameStore.state.reRollPrompt?.lonerValue;
  return value
    ? `The player is a loner and you must roll a ${value} first before you can reroll.`
    : 'The player is a loner and the reroll is not guaranteed to help.';
});

// Pass alone gets its server-reported throw classification beside the rolled die. Exact-match the raw
// reRolledAction (including its fully-qualified form) so Catch, Direction, Bomb and TTM prompts stay unchanged.
const passRerollContext = computed(() => {
  const p = gameStore.state.reRollPrompt;
  return p && /(?:^|\.)Pass$/i.test(p.reRolledAction.trim()) && p.roll != null && p.result
    ? { roll: p.roll, result: p.result }
    : null;
});

/* Show the acting blocker's team-reroll count only for TRR-consuming sources; fail closed when ownership is unresolved. */
const blockPartialTeamReRolls = computed<number | null>(() => {
  const g = gameStore.game.value;
  const pid = gameStore.state.activePlayerId;
  if (!g || !pid || !gameStore.state.blockPartial) return null;
  const td = playerSide(pid) === 'home' ? g.turnDataHome : g.turnDataAway;
  return td.reRolls ?? 0;
});
/* #205: the same acting-team count on the MULTI-BLOCK rail (per-target rows share the ONE team-reroll
 * pool ⇒ every row's team-RR die carries the same available count). Same activePlayerId anchor /
 * viewer-independent / fail-soft-null discipline; gated on the multiBlockResolution surface being live. */
const multiBlockTeamReRolls = computed<number | null>(() => {
  const g = gameStore.game.value;
  const pid = gameStore.state.activePlayerId;
  if (!g || !pid || !gameStore.state.multiBlockResolution) return null;
  const td = playerSide(pid) === 'home' ? g.turnDataHome : g.turnDataAway;
  return td.reRolls ?? 0;
});

// Owner 2026-07-08 (pipeline Phase 3c): the KO/injury INTERACTION GATE surface is
// token-anchored (RAF-followed) exactly like the reroll prompt above — read-only for
// non-owners (data-spectator), the owner's pick GLOWS gold (data-chosen).
const injuryGatePos = reactive({ x: 0, y: 0, ready: false });
let injuryGateRaf = 0;
watch(
  () => gameStore.state.injuryInteraction?.seq,
  () => {
    cancelAnimationFrame(injuryGateRaf);
    injuryGatePos.ready = false;
    const p = gameStore.state.injuryInteraction;
    if (!p || !renderer) return;
    const sq = p.square && p.square[0] >= 0 && p.square[0] <= 25 && p.square[1] >= 0 && p.square[1] <= 14 ? p.square : null;
    const follow = () => {
      if (!gameStore.state.injuryInteraction || !renderer) { injuryGatePos.ready = false; return; }
      const pos = renderer.playerScreenPos(p.playerId, sq);
      if (pos && reactivePromptHeld.value !== 'injuryInteraction') { injuryGatePos.x = pos.x; injuryGatePos.y = pos.y; injuryGatePos.ready = true; }
      injuryGateRaf = requestAnimationFrame(follow);
    };
    follow();
  },
);

// Apothecary cinematics (owner 2026-07-03 r6f): the USE offer zooms/spotlights the
// injured player; the re-roll CHOICE zooms too. Owner 08-18: the d16 disc/spinner is
// SUPPRESSED entirely (⚖ #62 had already made it numberless — the server never sends
// a face for this dialog); the card leads with the two result titles immediately.
// Owner 2026-07-08: the "Use apothecary?" toast was pinned off to the side (the old
// sidestep/fend/stand-firm bug). Bind it to the INJURED player's square — same anchor
// as the KO/casualty toast (square first, token fallback), RAF-follows pan/zoom.
const apoChoicePos = reactive({ x: 0, y: 0, ready: false, leftEdge: false });
const apoChoicePortrait = ref<string | null>(null);
const apoResultPortrait = computed(() => {
  const playerId = gameStore.state.apothecaryAutoReturn?.playerId;
  return playerId && renderer ? renderer.playerPortrait(playerId) : null;
});
const apoChoiceSkills = ref<ReturnType<typeof playerDetailSkills>>([]);
const apoChoicePositionId = ref<string | null>(null);
const apoChoiceSide = ref<'home' | 'away' | null>(null);
function refreshApothecarySubject(): void {
  const injury = gameStore.state.apothecaryChoice?.injuries[0];
  const entry = playerSideById(injury?.playerId);
  apoChoicePortrait.value = injury?.playerId && renderer ? renderer.playerPortrait(injury.playerId) : null;
  apoChoiceSkills.value = entry ? playerDetailSkills(entry.player) : [];
  apoChoicePositionId.value = entry?.player.positionId ?? null;
  apoChoiceSide.value = entry?.side ?? injury?.side ?? null;
}
let apoChoiceRaf = 0;
watch(
  () => gameStore.state.apothecaryChoice?.seq,
  () => {
    refreshApothecarySubject();
    cancelAnimationFrame(apoChoiceRaf);
    apoChoicePos.ready = false;
    const c = gameStore.state.apothecaryChoice;
    if (!c || !renderer) return;
    if (c.square) {
      renderer.cinematicZoom(c.square, 9000);
    }
    // Owner 09-05: the card pops BELOW the DECIDING coach's panel (home/away HUD panel), in the pitch host's
    // frame (the same frame the renderer's screen points use); falls back to the injured square when that
    // panel is not on screen.
    const decidingSide: 'home' | 'away' = c.teamId != null && c.teamId === gameStore.game.value?.teamAway.teamId ? 'away' : 'home';
    const belowCoachPanel = (): { x: number; y: number } | null => {
      const host = pitchHost.value;
      const panel = host?.closest('.spectate')?.querySelector<HTMLElement>(`.coach-panel.${decidingSide}`);
      if (!host || !panel) return null;
      const r = panel.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      // Owner 09-05 (round 2): the card's LEFT edge rides the panel's left edge (it popped off screen when centred
      // under the away panel); clamped so the 440 px card stays inside the pitch host.
      const cardW = Math.min(440, h.width - 32);
      const left = Math.max(8, Math.min(r.left - h.left, h.width - cardW - 8));
      return { x: left, y: r.bottom - h.top + 12 };
    };
    const follow = () => {
      if (!gameStore.state.apothecaryChoice || !renderer) { apoChoicePos.ready = false; return; }
      const under = belowCoachPanel();
      const p = under ?? (c.square ? renderer.screenPosOf(c.square) : null) ?? renderer.playerScreenPos(c.playerId, c.square ?? undefined);
      if (p && reactivePromptHeld.value !== 'apothecaryChoice') { apoChoicePos.x = p.x; apoChoicePos.y = under ? p.y : p.y - 54; apoChoicePos.leftEdge = !!under; apoChoicePos.ready = true; }
      apoChoiceRaf = requestAnimationFrame(follow);
    };
    follow();
  },
);
watch(
  () => gameStore.state.apothecaryD16?.seq,
  () => {
    const c = gameStore.state.apothecaryD16;
    if (!c) return;
    if (renderer && c.square) renderer.cinematicZoom(c.square, 11000);
  },
);
// the doctor run/bounce/escort animation, triggered once the outcome is settled
watch(
  () => gameStore.state.apothecaryAnim?.seq,
  () => {
    const a = gameStore.state.apothecaryAnim;
    if (!a || !renderer || !a.square) return;
    // #75 (owner batch §N): pass the store's `medic` flag → a DECLINED apo plays a NON-medic escort (no doctor),
    //   so a decline no longer reads as "apothecary used" (Tarkin store 1c331b6c / Voss renderer c57ec306).
    // #154 (owner): pass the injured `playerId` (Tarkin `0c78d386` added it to apothecaryAnim) so Voss's escort
    //   (`db31719f`) holds the REAL injured token under the doctor bounce instead of a generic disc.
    renderer.playApothecary(a.square, a.outcome, a.side === 'home', a.medic, a.playerId);
  },
);
// #79 (owner batch §N): the AUTO-applied block-push Grab rides NO skillUse report (only a `pushback` report
//   `pushbackMode:"grab"` — TK-421 game-650), so the skillUsed path above misses it. Tarkin surfaces it store-side
//   as `state.grabUse` (grabber = the acting blocker, `fde15f20`). Fade the Grab skill icon over the grabber's
//   head — same render as skillUsed. ⚖ renders only the server-reported grab.
watch(
  () => gameStore.state.grabUse?.seq,
  () => {
    const gu = gameStore.state.grabUse;
    if (!gu || !renderer) return;
    const sq = playerSquareById(gu.playerId);
    if (sq) renderer.playSkillIconFade(sq, 'Grab');
  },
);

// Owner 2026-07-03: crowd surf — a player pushed out of bounds. Fans rush from the
// nearest stand, bounce on them, then run back. Fired by the store BEFORE the
// injury animation (pumpInjuries sequences the casualty/KO after CROWD_SURF_MS).
watch(
  () => gameStore.state.crowdSurf?.seq,
  () => {
    const c = gameStore.state.crowdSurf;
    if (c && renderer) renderer.playCrowdSurf(c.square);
  },
);

// Owner 2026-07-04: THROW A ROCK — a rock arcs in from the crowd and strikes the
// hit player's square. Its seq-keyed impact callback releases the store's bounded
// gate; the shared impact beat then plays before the injury presentation.
watch(
  () => gameStore.state.rockThrow?.seq,
  () => {
    const rk = gameStore.state.rockThrow;
    if (rk && renderer) renderer.playRockThrow(rk.square, () => gameStore.notifyRockImpact(rk.seq), rk.miss);
  },
);

// Owner 2026-07-04: INTERACTIVE team setup — drive the zone shading + click-to-place.
const selectedSetupPlayerId = ref<string | null>(null);
const setupPhase = computed(() => gameStore.state.setupPhase);
const opponentSetupNotice = computed(() => shouldShowOpponentSetupNotice({
  mode: props.mode,
  isPlaying: gameStore.isPlaying.value,
  turnMode: gameStore.game.value?.turnMode,
  myTurn: gameStore.myTurn.value,
}));
// An inert player (Solid Defence non-selected) is not a usable reserve — keep it out of the count/list.
const setupReserves = computed(() => (setupPhase.value?.players ?? []).filter((p) => !p.coord && p.inert !== true));
// BB2025 Solid Defence re-setup: same surface, but only the server-selected players are movable.
const solidDefenceSetup = computed(() => gameStore.game.value?.turnMode === 'solidDefence');
const solidDefenceMovableCount = computed(() =>
  (setupPhase.value?.players ?? []).filter((p) => !p.inert).length);
const solidDefenceError = computed(() => gameStore.state.solidDefenceError);
// SPEC setup-templates §1 (Madden panel), §3-3o (the 15 templates), MIRROR OPTION §3c.
const setupTemplateSide = computed(() => gameStore.setupTemplateSide);
const setupTemplateMirrored = reactive<Record<string, boolean>>({});
const lastAppliedSetupTemplateId = ref<string | null>(null);
const setupPanelSection = ref<'templates' | 'saved'>('templates');
const savedSetupsRequested = ref(false);
const savedSetupsCollapsed = ref(false);
const savedSetupName = ref('');
const lastLoadedSavedSetupName = ref<string | null>(null);
const setupTemplatePanelEl = ref<HTMLElement | null>(null);
const setupBrowserViewport = ref({ width: window.innerWidth, height: window.innerHeight });
const setupBrowserResizeOrigin = ref<{ x: number; y: number } | null>(null);
const setupBrowserDefaultSize = computed(() => ({
  w: Math.round(Math.max(286, Math.min(380, setupBrowserViewport.value.width * 0.72))),
  h: Math.round(Math.max(220, Math.min(270, setupBrowserViewport.value.height - 24))),
}));
const setupBrowserStyle = computed<Record<string, string>>(() => {
  const size = settings.setupBrowserSize ?? setupBrowserDefaultSize.value;
  const viewport = setupBrowserViewport.value;
  const collapsed = setupPanelSection.value === 'saved' && savedSetupsCollapsed.value;
  const renderedHeight = collapsed ? 36 : size.h;
  const style: Record<string, string> = { width: `${size.w}px`, height: `${renderedHeight}px` };
  if (settings.setupBrowserPos) {
    Object.assign(style, resizablePanelStyle(settings.setupBrowserPos, {
      width: size.w, height: renderedHeight,
    }, viewport, setupBrowserResizeOrigin.value));
  } else {
    style.left = `${Math.max(12, Math.min(330, viewport.width - size.w - 12))}px`;
    style.top = `${Math.max(12, Math.min(112, viewport.height - size.h - 12))}px`;
    style.right = 'auto';
    style.bottom = 'auto';
  }
  return style;
});

let setupBrowserDrag: {
  startX: number; startY: number; origX: number; origY: number; grip: HTMLElement;
} | null = null;
function startSetupBrowserDrag(event: PointerEvent) {
  if ((event.target as HTMLElement | null)?.closest('button, input')) return;
  const element = setupTemplatePanelEl.value;
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const parentRect = (element.offsetParent as HTMLElement | null)?.getBoundingClientRect();
  setupBrowserDrag = {
    startX: event.clientX,
    startY: event.clientY,
    origX: rect.left - (parentRect?.left ?? 0),
    origY: rect.top - (parentRect?.top ?? 0),
    grip: event.currentTarget as HTMLElement,
  };
  setupBrowserDrag.grip.setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', moveSetupBrowser);
  window.addEventListener('pointerup', endSetupBrowserDrag, { once: true });
  event.preventDefault();
}
function moveSetupBrowser(event: PointerEvent) {
  const drag = setupBrowserDrag;
  const element = setupTemplatePanelEl.value;
  if (!drag || !element) return;
  const parent = element.offsetParent as HTMLElement | null;
  const rect = element.getBoundingClientRect();
  settings.setupBrowserPos = anchorPanelPosition(
    { x: drag.origX + event.clientX - drag.startX, y: drag.origY + event.clientY - drag.startY },
    { width: rect.width, height: rect.height },
    { width: parent?.clientWidth ?? window.innerWidth, height: parent?.clientHeight ?? window.innerHeight },
  );
}
function endSetupBrowserDrag(event?: PointerEvent) {
  window.removeEventListener('pointermove', moveSetupBrowser);
  if (event && setupBrowserDrag) setupBrowserDrag.grip.releasePointerCapture?.(event.pointerId);
  setupBrowserDrag = null;
}
function startSetupBrowserResize(event: PointerEvent) {
  if (setupPanelSection.value === 'saved' && savedSetupsCollapsed.value) return;
  const element = setupTemplatePanelEl.value;
  if (!element) return;
  const rect = element.getBoundingClientRect();
  if (event.clientX < rect.right - 20 || event.clientY < rect.bottom - 20) return;
  const parentRect = (element.offsetParent as HTMLElement | null)?.getBoundingClientRect();
  setupBrowserResizeOrigin.value = {
    x: rect.left - (parentRect?.left ?? 0),
    y: rect.top - (parentRect?.top ?? 0),
  };
  window.addEventListener('pointerup', finishSetupBrowserResize, { once: true });
}
function finishSetupBrowserResize() {
  const element = setupTemplatePanelEl.value;
  const origin = setupBrowserResizeOrigin.value;
  if (!element || !origin) { setupBrowserResizeOrigin.value = null; return; }
  const parent = element.offsetParent as HTMLElement | null;
  const rect = element.getBoundingClientRect();
  const viewport = {
    width: parent?.clientWidth ?? window.innerWidth,
    height: parent?.clientHeight ?? window.innerHeight,
  };
  const size = {
    w: Math.round(Math.min(rect.width, viewport.width * 0.8)),
    h: Math.round(Math.min(rect.height, viewport.height * 0.8)),
  };
  settings.setupBrowserSize = size;
  settings.setupBrowserPos = anchorPanelPosition(origin, { width: size.w, height: size.h }, viewport);
  setupBrowserResizeOrigin.value = null;
}
const setupTemplateCards = computed(() => setupTemplateSide.value
  ? setupTemplatesForSide(setupTemplateSide.value).map((template) => ({
      template,
      preview: templatePreview(template, !!setupTemplateMirrored[template.id]),
    }))
  : []);
function applySetupTemplateCard(template: SetupTemplate) {
  gameStore.applySetupTemplate(template.id, !!setupTemplateMirrored[template.id]);
  lastAppliedSetupTemplateId.value = template.id;
}
const savedSetupCards = computed(() => gameStore.state.savedSetupNames.map((name) => {
  const cached = gameStore.savedSetupPreview(name);
  return { name, preview: cached ? savedSetupPreview(cached.playerCoordinates) : null };
}));
function showSavedSetups() {
  setupPanelSection.value = 'saved';
  // ClientStateSetup.java:27,31: request only when the Load/Save surface opens.
  if (!savedSetupsRequested.value && gameStore.requestSavedSetups()) savedSetupsRequested.value = true;
}
function saveNamedSetup() {
  if (gameStore.saveCurrentSetup(savedSetupName.value)) savedSetupName.value = '';
}
function loadNamedSetup(name: string) {
  // UtilServerSetup.loadTeamSetup:38-45: server placement only; manual setup and Done stay live.
  if (gameStore.loadSavedSetup(name)) lastLoadedSavedSetupName.value = name;
}
function deleteNamedSetup(name: string) {
  if (window.confirm(`Delete saved setup "${name}"? This cannot be undone.`)) gameStore.deleteSavedSetup(name);
}
// Owner 2026-07-15 (click-to-place): the currently click-selected setup player + whether it's on the pitch,
// so the card can echo what's selected and the right next-tap instruction (place vs move/return).
const selectedSetupPlayer = computed(() =>
  selectedSetupPlayerId.value
    ? (setupPhase.value?.players.find((p) => p.playerId === selectedSetupPlayerId.value) ?? null)
    : null,
);
const selectedSetupPlaced = computed(() => !!selectedSetupPlayer.value?.coord);
watch(
  () => setupPhase.value?.seq,
  () => {
    const sp = setupPhase.value;
    if (!sp) {
      lastAppliedSetupTemplateId.value = null;
      lastLoadedSavedSetupName.value = null;
      setupPanelSection.value = 'templates';
      savedSetupsRequested.value = false;
      savedSetupName.value = '';
    }
    if (!renderer) return;
    if (!sp) {
      renderer.setSetup(false, null);
      renderer.setSetupSelectedPlayer(null);
      renderer.onSetupClick = null;
      renderer.onDugoutSetupDragStart = null;
      selectedSetupPlayerId.value = null;
      return;
    }
    const v = sp.validation;
    renderer.setSetup(true, { losOk: v.losOk, leftOk: v.leftOk, rightOk: v.rightOk });
    renderer.setSetupSelectedPlayer(selectedSetupPlayerId.value);
    renderer.onDugoutSetupDragStart = startSetupPlayerDrag; // cond-b/#3: drag a reserve or a placed player
    renderer.onSetupClick = (coord, playerId) => {
      if (playerId) { handleSetupPlayerTap(playerId); return; }
      // Owner 2026-07-15 (click-to-place): a tap OFF the pitch (the dugout / reserve box — worldToSquare returns
      // a coord outside the pitch bounds) is the "pitch → dugout" gesture: it returns the currently-SELECTED
      // placed player to reserves. This is how you pull a player back (incl. an over-filled formation).
      const pid = selectedSetupPlayerId.value;
      const onPitch = coord[0] >= 0 && coord[0] <= 25 && coord[1] >= 0 && coord[1] <= 14;
      if (!onPitch) {
        if (pid && setupPhase.value?.players.find((p) => p.playerId === pid)?.coord) {
          gameStore.setupRemove(pid);
          selectedSetupPlayerId.value = null;
        }
        return;
      }
      // tapped an empty pitch square → place the selected player (own half only) — the "dugout → pitch" gesture
      if (pid && coord[0] >= 0 && coord[0] <= 12 && coord[1] >= 0 && coord[1] <= 14) {
        gameStore.setupPlace(pid, coord);
        selectedSetupPlayerId.value = null;
      }
    };
    // keep the selection valid as the roster refreshes
    if (selectedSetupPlayerId.value
        && !sp.players.some((p) => p.playerId === selectedSetupPlayerId.value && !p.inert)) {
      selectedSetupPlayerId.value = null;
    }
  },
);
// Owner 2026-07-14 (setup overhaul #1): the reserve CHIPS + their selectSetupPlayer/startSetupDrag handlers are
// GONE — reserves are dragged straight from the dugout now. The floating drag ghost (setupDrag) is reused by
// startPlayerDrag below (dugout reserve OR placed player), and — since this window — by Swarming's dugout drag too.
// DragMode: press/move/release/threshold/tap-vs-drag mechanics stay ONE implementation; MODE supplies the
// phase-specific eligibility, legal-square test, and place/remove/tap wiring (setup vs swarming send different
// wire — swarmingPlace/swarmingRemove per the store, never setupPlace/setupRemove).
interface DragMode {
  eligible(playerId: string): boolean; // may start/complete a drag (not inert / not swarming-eligible)
  placedCoord(playerId: string): [number, number] | null;
  legalSquare(coord: [number, number]): boolean;
  label(playerId: string): string;
  place(playerId: string, coord: [number, number]): void;
  remove(playerId: string): void;
  /** Owner 09-09: who stands on `coord` (a placed, non-inert player) — a drop onto them SWAPS instead of placing. */
  occupantAt?(coord: [number, number]): string | null;
  swap?(draggedId: string, occupantId: string): void;
  onTap(playerId: string): void; // near-stationary release, or a dugout-token click routed in by the caller
  clearSelection(): void; // after a successful drag place/remove
}
const setupDrag = ref<{ playerId: string; label: string; x: number; y: number; sx: number; sy: number; mode: DragMode } | null>(null);
watch(
  () => setupDrag.value?.playerId ?? selectedSetupPlayerId.value,
  (playerId) => renderer?.setSetupSelectedPlayer(playerId ?? null),
  { flush: 'sync' },
);
const setupDragMode: DragMode = {
  eligible: (playerId) => {
    const p = setupPhase.value?.players.find((pl) => pl.playerId === playerId);
    return !!p && !p.inert;
  },
  placedCoord: (playerId) => setupPhase.value?.players.find((p) => p.playerId === playerId)?.coord ?? null,
  legalSquare: (coord) => coord[0] >= 0 && coord[0] <= 12 && coord[1] >= 0 && coord[1] <= 14, // own half only (server validates)
  label: (playerId) => {
    const p = setupPhase.value?.players.find((pl) => pl.playerId === playerId);
    return p ? p.posName || p.name : '';
  },
  place: (playerId, coord) => gameStore.setupPlace(playerId, coord),
  remove: (playerId) => gameStore.setupRemove(playerId),
  occupantAt: (coord) => setupPhase.value?.players.find((p) => !p.inert && p.coord && p.coord[0] === coord[0] && p.coord[1] === coord[1])?.playerId ?? null,
  swap: (draggedId, occupantId) => gameStore.setupSwap(draggedId, occupantId),
  onTap: (playerId) => handleSetupPlayerTap(playerId),
  clearSelection: () => { selectedSetupPlayerId.value = null; },
};
// Owner 2026-07-14 (setup overhaul cond-b/c + #3): begin a drag-to-pitch — a DUGOUT reserve (place) OR a PLACED
// on-pitch player (move); both fire the renderer's onDugoutSetupDragStart on a canvas pointerdown, both drop via
// mode.place. INERT/ineligible: mode.eligible() gates both starting AND completing a drag.
function startPlayerDrag(mode: DragMode, playerId: string, clientX: number, clientY: number) {
  if (!mode.eligible(playerId)) return;
  setupDrag.value = { playerId, label: mode.label(playerId), x: clientX, y: clientY, sx: clientX, sy: clientY, mode };
  window.addEventListener('pointermove', onSetupDragMove);
  window.addEventListener('pointerup', onSetupDragEnd);
}
function startSetupPlayerDrag(playerId: string, clientX: number, clientY: number) {
  startPlayerDrag(setupDragMode, playerId, clientX, clientY);
}
// Owner 2026-07-14 (setup overhaul #5/#3): a TAP on a PLACED player selects it; a 2nd tap on another placed
// player swaps. Shared by onSetupClick and a stationary setup-drag release (on-pitch pointerdowns are intercepted
// for the drag, so their taps route here). A reserve tap is a no-op (its action is the drag).
function handleSetupPlayerTap(playerId: string) {
  const players = setupPhase.value?.players ?? [];
  const tapped = players.find((p) => p.playerId === playerId);
  if (!tapped || tapped.inert) return; // not fieldable → inert
  const sel = selectedSetupPlayerId.value;
  const selPlaced = !!sel && !!players.find((p) => p.playerId === sel)?.coord;
  // Two PLACED players → SWAP their squares. Owner 09-09: a PLACED selection then a RESERVE tap swaps too — the
  // placed player steps off to the box and the reserve takes its square (setupSwap handles the reserve side).
  if (sel && sel !== playerId && selPlaced) {
    gameStore.setupSwap(sel, playerId);
    selectedSetupPlayerId.value = null;
    return;
  }
  // Owner 2026-07-15 (click-to-place): otherwise SELECT the tapped player — a PLACED one to move/swap/return, a
  // RESERVE one to place onto the pitch with a following empty-square tap (was a no-op; reserves were drag-only).
  // Returning a placed player to reserves is the tap-empty-dugout / drag-off-pitch / ↩ Reserve path — never a
  // reserve-token tap, so tapping a reserve can't accidentally yank an already-selected placed player off.
  selectedSetupPlayerId.value = playerId;
}
function onSetupDragMove(e: PointerEvent) {
  if (setupDrag.value) { setupDrag.value.x = e.clientX; setupDrag.value.y = e.clientY; }
}
function onSetupDragEnd(e: PointerEvent) {
  window.removeEventListener('pointermove', onSetupDragMove);
  window.removeEventListener('pointerup', onSetupDragEnd);
  const d = setupDrag.value; setupDrag.value = null;
  if (!d || !renderer) return;
  const mode = d.mode;
  if (!mode.eligible(d.playerId)) return;
  // Threshold: a near-stationary release is a TAP, not a drag-drop. On-pitch pointerdowns are intercepted for
  // the drag, so route their taps to select/swap here (a reserve tap is a no-op — its action is the drag).
  if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) { mode.onTap(d.playerId); return; }
  const sq = renderer.clientToSquare(e.clientX, e.clientY);
  if (sq && mode.legalSquare(sq)) {
    // Owner 09-09: dropped onto an OCCUPIED square → the two players swap (a placed mover trades squares; a
    // reserve takes the square and the occupant steps back to the box) — the same result as the two-click swap.
    const occupant = mode.occupantAt?.(sq) ?? null;
    if (occupant && occupant !== d.playerId && mode.swap) mode.swap(d.playerId, occupant);
    else mode.place(d.playerId, sq);
    mode.clearSelection();
    return;
  }
  // Owner 2026-07-15: a drag RELEASED off the pitch (clientToSquare === null → the dugout / sideline) returns a
  // PLACED player to reserves — "drag back to the dugout" (fixes: an over-filled formation couldn't be pulled back).
  if (!sq && mode.placedCoord(d.playerId)) { mode.remove(d.playerId); mode.clearSelection(); }
}
function returnSelectedToReserve() {
  if (selectedSetupPlayerId.value) {
    gameStore.setupRemove(selectedSetupPlayerId.value);
    selectedSetupPlayerId.value = null;
  }
}

// Owner 2026-07-04: REFEREE SEND-OFF cinematic. The prompt spotlights the spotted
// player (stand-firm style); the result rolls a d6 in from the bottom, then reveals
// a green ✓ / red ✗ with the outcome text (+ coins for a bribe).
watch(
  () => gameStore.state.sendOff?.seq,
  () => {
    const so = gameStore.state.sendOff;
    if (!so || !renderer) return;
    if (so.square) {
      renderer.cinematicZoom(so.square, 12000);
    }
  },
);
// Owner ⑩ (08-12): the argue-the-call cine is OUTCOME-ONLY — the bottom-screen die-tumble phase is killed
// (Tarkin beat sign-off: immediate reveal, full-screen splash hold unchanged). The outcome+splash shows the
// instant the result arrives; this timer only holds it, then dismisses and returns the camera.
let sendOffTimers: ReturnType<typeof setTimeout>[] = [];
watch(
  () => gameStore.state.sendOffResult?.seq,
  () => {
    for (const t of sendOffTimers) clearTimeout(t);
    sendOffTimers = [];
    if (!gameStore.state.sendOffResult) return;
    // hold the outcome splash (~4200), then clear + return the camera (turnover splash, if any,
    // rides the server's turnEnd per the send-off rules)
    sendOffTimers.push(setTimeout(() => {
      gameStore.dismissSendOffResult();
      renderer?.resetCamera();
    }, presentationMs(4200)));
  },
);
// Owner ⑩ (08-12): the parameterized rollCine view render was removed — `gameStore.state.rollCine` is never set
// (0 showRollCine callers; regen/swarming/B&C moved off it), so the block was dead. Tarkin follows with the store-side
// rollCine machinery removal on this tip (co-land). The live send-off render is the separate sendOffResult block above.

// Owner: Touchback and Solid Defence show arrows only on the current selection(s).
function isArrowNarrowedPick(key: string | undefined): boolean {
  return key === 'touchback'
    || key?.startsWith('pchoice:furiousOutburst:') === true
    || key?.startsWith('pchoice:charge:') === true
    || key?.startsWith('pchoice:solidDefence:') === true
    || key?.startsWith('pchoice:dwarfenWisdom:') === true
    || key?.startsWith('pchoice:knuckleDusters:') === true
    || key?.startsWith('pchoice:ironMan:') === true
    || key?.startsWith('pchoice:blessedStatueOfNuffle:') === true;
}
// Owner 2026-07-04 (interaction catalog 0.1): the generic player-pick — arm/clear
// the renderer crosshairs whenever the store's pick changes.
watch(
  () => gameStore.state.playerPick?.seq,
  () => {
    // Owner 2026-07-15: the MVP NOMINATION is collected via a roster-summary MODAL with checkboxes (below), NOT
    // the on-pitch over-head pick arrows — so suppress the arrows for the mvp pick only; every OTHER pick
    // (charge/feed/tentacles/…) keeps them. setPlayerPick(null) clears both the crosshair AND the #20 arrows.
    const pick = gameStore.state.playerPick;
    // Diving Catch pauses pass resolution on an addressed playerChoice while the server deliberately keeps the
    // passer/action pinned, so deriveClientState remains PASS and the activation-end cleanup cannot run yet.
    // Retire only the passer's presentation arms when that post-throw pick arrives; the generic pick below then
    // owns the board. This is view-only: no plan queue, derived state, or wire behaviour changes.
    const g = gameStore.game.value;
    if (pick?.key.startsWith('pchoice:') && g && settings.order66 && gameStore.isPlaying.value
      && deriveClientState(g, o66Ctx()) === 'PASS') {
      o66PendingPass.value = null;
      o66PendingMove.value = null;
      setAction('auto');
      renderer?.setO66Path([]);
      renderer?.setTilePick(false);
      renderer?.setO66MoveRolls(null);
      renderer?.setO66PassRolls(null);
    }
    const pickIds = pick && !pick.key.startsWith('pchoice:mvp') ? (pick.eligibleIds ?? null) : null;
    renderer?.setPlayerPick(pickIds);
    renderer?.setPlayerPickArrows(pick && isArrowNarrowedPick(pick.key) ? pick.picked : null);
  },
);

// Owner ruling (Charge/High Kick, live): my on-pitch players EXCLUDED from a shaded pick's server-sent
// eligible set — the complement is presentation-only (feeds renderer.setPlayerPickIneligible for the
// activation-dim idiom); the eligible SET itself always stays exactly what the server offered.
function myOnPitchIneligibleIds(g: GameJson, eligibleIds: string[]): string[] {
  const mine = new Set((gameStore.myTeamIsHome.value ? g.teamHome : g.teamAway).playerArray.map((p) => p.playerId));
  const eligible = new Set(eligibleIds);
  return g.fieldModel.playerDataArray
    .filter((d) => mine.has(d.playerId) && !eligible.has(d.playerId) && d.playerCoordinate && rendersOnPitch(d.playerState))
    .map((d) => d.playerId);
}
// Owner ruling (Charge/High Kick shading unification, live): "remove the arrows and use active/inactive
// visual language" for eligibility, "set an arrow over their head" ONLY on the user's selection, persisting
// while selected. Charge (pchoice:charge:…) and High Kick (turnMode highKick, its own local staged nominee —
// see o66NominateHighKick/o66HighKickPending) ride the SAME renderer surface here rather than duplicating
// per-event branches; a Solid Defence/feed/blitz/… generic pick stays byte-identical (pickShaded off).
function syncShadedPick() {
  if (!renderer) return;
  const g = gameStore.game.value;
  const pick = gameStore.state.playerPick;
  let eligibleIds: string[] | null = null;
  let selectedId: string | null = null;
  const zapSelectedId = gameStore.state.wizardTargetConfirm?.playerId ?? null;
  let dimIneligible = true;
  if (pick && pick.key.startsWith('pchoice:charge:')) {
    eligibleIds = pick.eligibleIds;
    // Charge can select more than one player. setPlayerPickArrows carries the complete ordered selection;
    // the single-slot shaded marker remains reserved for High Kick below.
    selectedId = null;
  } else if (pick?.key.startsWith('pchoice:furiousOutburst:') && pick.picked.length > 0) {
    // Furious Outburst stages the server's confirm-mode playerChoice locally. Once one victim is nominated,
    // replace the candidate crosshairs with one persistent selection arrow; right-click below removes that
    // local nomination and restores the same authoritative candidate set without answering the server.
    eligibleIds = pick.eligibleIds;
    selectedId = pick.picked[0] ?? null;
    dimIneligible = false;
  } else if (g && settings.order66 && gameStore.isPlaying.value && deriveClientState(g, o66Ctx()) === 'HIGH_KICK') {
    eligibleIds = highKickNomineeIds(g);
    selectedId = o66HighKickPending.value?.playerId ?? null;
  }
  renderer.setPlayerPickShaded(eligibleIds !== null);
  renderer.setPlayerPickIneligible(dimIneligible && eligibleIds && g ? myOnPitchIneligibleIds(g, eligibleIds) : null);
  renderer.setPlayerPickSelected(eligibleIds !== null ? selectedId : zapSelectedId);
}
watch(
  () => [
    gameStore.state.playerPick?.seq,
    gameStore.state.playerPick?.picked.join('|'),
    gameStore.state.wizardTargetConfirm?.seq ?? 0,
    o66HighKickPending.value?.playerId ?? '',
    gameStore.game.value?.turnMode ?? '',
    gameStore.game.value?.gameId ?? '',
  ] as const,
  syncShadedPick,
);

// Confirm-mode selections read as chosen: a gold aura pulses on each newly
// toggled-ON player (touchback / playerChoice nominations).
watch(
  () => gameStore.state.playerPick?.picked.join('|'),
  (now, before) => {
    const pick = gameStore.state.playerPick;
    if (!pick || !renderer) return;
    if (isArrowNarrowedPick(pick.key)) renderer.setPlayerPickArrows(pick.picked); // selection changes retarget arrows
    const prev = new Set((before ?? '').split('|').filter(Boolean));
    for (const pid of pick.picked) {
      if (prev.has(pid)) continue;
      const d = gameStore.game.value?.fieldModel.playerDataArray.find((p) => p.playerId === pid);
      if (d?.playerCoordinate && d.playerCoordinate[0] >= 0) renderer.flashGoldAura([d.playerCoordinate[0], d.playerCoordinate[1]]);
    }
  },
);

// Owner 2026-07-04 (interaction catalog 28, PRIORITY): the follow-up chip card is
// a DOM overlay anchored NEAR the block square but OFFSET so the square (and the
// gold aura) stay visible. Tracked per-frame while visible so camera glides/zooms
// don't detach it; clamped with the context menu's bottom-safe convention.
const followupPos = ref<{ x: number; y: number } | null>(null);
let followupRaf = 0;
function trackFollowupChip() {
  cancelAnimationFrame(followupRaf);
  const step = () => {
    const choice = gameStore.state.followupChoice;
    const passive = gameStore.state.followupIndicator;
    const host = pitchHost.value;
    if ((!choice && !passive) || !renderer || !host) { followupPos.value = null; return; }
    const BOTTOM_SAFE = 72;
    if (!choice && passive) {
      // Owner 2026-07-06: the PASSIVE "stays / follows up" toast mounts to the HEAD of
      // the player performing the action, so it's clear WHO is acting. Centred over the
      // head (template applies translate(-50%,-100%)), tracked per-frame at any zoom.
      const p = renderer.headToCanvas(passive.square, false, 22); // owner 08-18: bottom edge tight to the head
      if (p && reactivePromptHeld.value !== 'followup') {
        followupPos.value = {
          x: Math.min(Math.max(p.x, 60), Math.max(host.clientWidth - 60, 60)),
          y: Math.min(Math.max(p.y, 40), host.clientHeight - BOTTOM_SAFE),
        };
      }
    } else {
      // Interactive Follow up / Stay chip: keep it OFFSET beside the square so the
      // square + gold aura stay visible while the coach decides.
      const p = renderer.squareToCanvas((choice ?? passive)!.square);
      if (p && reactivePromptHeld.value !== 'followup') {
        followupPos.value = {
          x: Math.min(Math.max(p.x + 44, 8), Math.max(host.clientWidth - 176, 8)),
          y: Math.min(Math.max(p.y - 112, 8), host.clientHeight - BOTTOM_SAFE - 84),
        };
      }
    }
    followupRaf = requestAnimationFrame(step);
  };
  step();
}
watch(
  () => [gameStore.state.followupChoice?.seq, gameStore.state.followupIndicator?.seq],
  () => trackFollowupChip(),
);

// Triage #4 (owner 08-11): SHADOWING joins the reactive-election rail — a Confirm/Decline pill anchored AT THE
// SHADOWER (the follow-up/sidestep idiom), NOT the generic bottom "Select a player — Shadowing" bar. SAME wire
// (the playerPick answer); the bottom bar retires for this class. The mode rides the playerPick key
// (`pchoice:shadowing:…`) so this is a pure presentation re-home — no store touch.
const shadowingPick = computed(() => {
  const p = gameStore.state.playerPick;
  return p && p.key.split(':')[1] === 'shadowing' && p.eligibleIds.length > 0 ? p : null;
});
const shadowingPos = ref<{ x: number; y: number } | null>(null);
let shadowingRaf = 0;
function trackShadowingPill() {
  cancelAnimationFrame(shadowingRaf);
  const step = () => {
    const p = shadowingPick.value;
    const host = pitchHost.value;
    if (!p || !renderer || !host) { shadowingPos.value = null; return; }
    const sq = playerSquareById(p.eligibleIds[0]!);
    const c = sq ? renderer.squareToCanvas(sq) : null;
    if (c && reactivePromptHeld.value !== 'shadowing') shadowingPos.value = {
      // OFFSET beside the shadower so the token + its crosshair stay visible while the coach decides (followup math).
      x: Math.min(Math.max(c.x + 44, 8), Math.max(host.clientWidth - 176, 8)),
      y: Math.min(Math.max(c.y - 112, 8), host.clientHeight - 72 - 84),
    };
    shadowingRaf = requestAnimationFrame(step);
  };
  if (shadowingPick.value) step(); else shadowingPos.value = null;
}
watch(() => shadowingPick.value?.seq, () => { reactivePromptDragPos.shadowing = null; trackShadowingPill(); });
onBeforeUnmount(() => cancelAnimationFrame(shadowingRaf));
/** Answer the SHADOWING pill on the same playerPick wire: Shadow = pick the eligible shadower + commit; Decline = skip. */
function answerShadowing(shadow: boolean) {
  const p = gameStore.state.playerPick;
  if (!p) return;
  if (!shadow) { gameStore.resolvePlayerPick(null); return; }
  const id = p.eligibleIds[0];
  if (!id) return;
  if (!p.picked.includes(id)) gameStore.resolvePlayerPick(id); // toggle into the confirm-mode selection
  gameStore.confirmPlayerPick();
}
// TENTACLES (owner ruling 08-12): drops its "Select a Player" picker → rides the reactive rail exactly like
// shadowing. Auto-select which offered tentacler to answer with — HIGHER STR, tie → player number ASCENDING
// (the pinned tie-break) — then surface a token-anchored "Use Tentacles?" card OVER that player. Wire UNCHANGED:
// the same playerChoice answer; every offered id is server-legal, so the auto-pick is presentation-only.
const tentaclesPick = computed(() => {
  const p = gameStore.state.playerPick;
  return p && p.key.split(':')[1] === 'tentacles' && p.eligibleIds.length > 0 ? p : null;
});
const tentaclerId = computed(() => {
  const p = tentaclesPick.value;
  const g = gameStore.game.value;
  if (!p || !g) return null;
  const players = [...g.teamHome.playerArray, ...g.teamAway.playerArray];
  const cand = p.eligibleIds.map((id) => players.find((pl) => pl.playerId === id)).filter((pl): pl is PlayerJson => !!pl);
  if (!cand.length) return p.eligibleIds[0] ?? null;
  cand.sort((a, b) => (Number(b.strength) - Number(a.strength)) || (Number(a.playerNr) - Number(b.playerNr)));
  return cand[0]!.playerId;
});
const tentaclesPos = ref<{ x: number; y: number } | null>(null);
let tentaclesRaf = 0;
function trackTentaclesPill() {
  cancelAnimationFrame(tentaclesRaf);
  const step = () => {
    const p = tentaclesPick.value;
    const id = tentaclerId.value;
    const host = pitchHost.value;
    if (!p || !id || !renderer || !host) { tentaclesPos.value = null; return; }
    const sq = playerSquareById(id);
    const c = sq ? renderer.squareToCanvas(sq) : null;
    if (c && reactivePromptHeld.value !== 'tentacles') tentaclesPos.value = {
      x: Math.min(Math.max(c.x + 44, 8), Math.max(host.clientWidth - 176, 8)),
      y: Math.min(Math.max(c.y - 112, 8), host.clientHeight - 72 - 84),
    };
    tentaclesRaf = requestAnimationFrame(step);
  };
  if (tentaclesPick.value) step(); else tentaclesPos.value = null;
}
watch(() => tentaclesPick.value?.seq, () => { reactivePromptDragPos.tentacles = null; trackTentaclesPill(); });
onBeforeUnmount(() => cancelAnimationFrame(tentaclesRaf));
/** Answer TENTACLES on the same playerPick wire: Use = pick the auto-selected tentacler + commit; Decline = skip
 *  (only when the server allows it — W9 lesson: a mandatory choice offers no bare decline). */
function answerTentacles(use: boolean) {
  const p = gameStore.state.playerPick;
  if (!p) return;
  if (!use) { if (p.declinable) gameStore.resolvePlayerPick(null); return; }
  const id = tentaclerId.value;
  if (!id) return;
  if (!p.picked.includes(id)) gameStore.resolvePlayerPick(id);
  gameStore.confirmPlayerPick();
}

// Anchor the authoritative partial-reroll controls to the ACTUAL block-dice square instead of a fixed screen %, so it never
// drifts away from the dice on an off-centre block. Tracked per-frame while visible
// (camera zoom/glide safe); null → the CSS fallback position (centred).
const blockRerollPos = ref<{ x: number; y: number } | null>(null);
let blockRerollRaf = 0;
function trackBlockReroll() {
  cancelAnimationFrame(blockRerollRaf);
  const step = () => {
    const active = !!gameStore.state.blockPartial;
    // Anchor Order-66 block dice to the server defender's square.
    const g = gameStore.game.value;
    let sq: [number, number] | null = null; // owner 09-06: legacy block-cine square ripped; the server defender anchors
    if (!sq && g) {
      const defId = String((g as { defenderId?: string | null }).defenderId ?? '');
      const dc = defId
        ? (g.fieldModel?.playerDataArray as { playerId: string; playerCoordinate?: unknown }[] | undefined)
            ?.find((d) => d.playerId === defId)?.playerCoordinate
        : undefined;
      if (dc) sq = normSquare(dc);
    }
    const host = pitchHost.value;
    if (!active || !sq || !renderer || !host) { blockRerollPos.value = null; return; }
    const p = renderer.squareToCanvas(sq);
    if (p && reactivePromptHeld.value !== 'blockPartial') {
      blockRerollPos.value = {
        x: Math.min(Math.max(p.x, 90), Math.max(host.clientWidth - 90, 90)),
        y: Math.min(Math.max(p.y + 66, 40), Math.max(host.clientHeight - 96, 40)),
      };
      // W44 (owner): the partial-reroll dice card also anchors the reroll splash — same
      // last-seen recorder as the reroll-prompt menu (rerollMenuPos), so a block-triggered
      // splash lands above THIS dialog instead of falling back to the scoreboard band.
      rerollCardLastSeen.x = blockRerollPos.value.x;
      rerollCardLastSeen.y = blockRerollPos.value.y;
      rerollCardLastSeen.at = Date.now();
    }
    blockRerollRaf = requestAnimationFrame(step);
  };
  step();
}
watch(
  () => gameStore.state.blockPartial?.seq,
  () => trackBlockReroll(),
);

watch(
  () => gameStore.state.selectSkill?.seq,
  () => {
    const selection = gameStore.state.selectSkill;
    selectSkillPortrait.value = selection && renderer ? renderer.playerPortrait(selection.playerId) : null;
  },
  { flush: 'post' },
);

watch(
  () => gameStore.state.prayerAnnounce?.seq,
  () => {
    const playerId = gameStore.state.prayerAnnounce?.playerId;
    prayerRecipientPortrait.value = playerId && renderer ? renderer.playerPortrait(playerId) : null;
  },
  { flush: 'post' },
);
// Triage #10 (owner 08-11): while the OPPONENT is deciding a block-dice pick (you're watching the preview), surface
// small text just below the dice. Gated on state.opponentReviewingDice — the #18a/C-18a derived signal that's TRUE
// only for the opponent's pick (decider-team ≠ mine, Side-Step-safe) and self-clears on every exit path, so this
// never shows on your OWN picks and clears when the pick resolves. Anchored at the block-dice square (same square-
// finder as the reroll cluster), offset a little further below so it sits under the dice glyphs.
const oppDecidingPos = ref<{ x: number; y: number } | null>(null);
let oppDecidingRaf = 0;
function trackOppDeciding() {
  cancelAnimationFrame(oppDecidingRaf);
  const step = () => {
    const g = gameStore.game.value;
    const host = pitchHost.value;
    if (!gameStore.state.opponentReviewingDice || !renderer || !host || !g) { oppDecidingPos.value = null; return; }
    let sq: [number, number] | null = null; // owner 09-06: legacy block-cine square ripped; the server defender anchors
    if (!sq) {
      const defId = String((g as { defenderId?: string | null }).defenderId ?? '');
      const dc = defId
        ? (g.fieldModel?.playerDataArray as { playerId: string; playerCoordinate?: unknown }[] | undefined)
            ?.find((d) => d.playerId === defId)?.playerCoordinate
        : undefined;
      if (dc) sq = normSquare(dc);
    }
    const p = sq ? renderer.squareToCanvas(sq) : null;
    if (p) oppDecidingPos.value = {
      x: Math.min(Math.max(p.x, 90), Math.max(host.clientWidth - 90, 90)),
      y: Math.min(Math.max(p.y + 92, 40), Math.max(host.clientHeight - 40, 40)),
    };
    oppDecidingRaf = requestAnimationFrame(step);
  };
  step();
}
watch(() => gameStore.state.opponentReviewingDice, () => trackOppDeciding());
onBeforeUnmount(() => cancelAnimationFrame(oppDecidingRaf));
// Owner 2026-07-06 (CRITICAL for live play): the inducement selector's local pick
// state (key → count). Reset whenever a new inducement dialog surfaces.
const inducePicks = ref<Record<string, number>>({});
watch(() => gameStore.state.inducementBuy?.seq, () => { inducePicks.value = {}; });
const induceSpent = computed(() =>
  (gameStore.state.inducementBuy?.options ?? []).reduce((sum, o) => sum + (inducePicks.value[o.key] ?? 0) * o.cost, 0),
);
const fmtGold = (n: number) => `${Math.round(n / 1000)}k`;
function confirmInducements() {
  const picks = Object.entries(inducePicks.value).map(([key, count]) => ({ key, count }));
  gameStore.resolveInducements(picks);
}

/* ────────────────────────────────────────────────────────────────────────────
 * INDUCEMENTS PHASE (owner design handoff `HANDOFF-inducements-phase.md`).
 *
 * SEAT VISIBILITY FIX (owner 08-18). The old surface hung entirely off
 * `state.inducementBuy`, which store.ts only ever populates for the dialog's
 * ADDRESSEE (`const addressedToMe = !dialogParam?.teamId || dialogParam.teamId
 * === myTeamId;` — store.ts, `buyInducements`/`buyPrayersAndInducements` case;
 * the non-addressee branch `if (!addressedToMe) { … return; }` returned before
 * any picker was built). The waiting coach therefore saw only a two-line
 * "UNDERDOG" placard while the overdog picked. The phase pane instead mounts off
 * PHASE state — `inducementBuy || inducementReveal`, both of which the waiting
 * seat already receives — so both coaches watch the whole phase. The waiting seat
 * still holds no dialog and sends nothing: zero wire changes.
 * ──────────────────────────────────────────────────────────────────────────── */
const induceBlade = ref<Blade>('inducements');
const induceConfirmPending = ref(false);
type InducementRevealSnapshot = {
  overdog: PanelView;
  underdog: PanelView;
  myRole: InducementRole;
};
const induceRevealHoldSnapshot = ref<InducementRevealSnapshot | null>(null);
const induceRevealHold = new UnderdogInducementRevealHold<InducementRevealSnapshot>(
  (snapshot) => { induceRevealHoldSnapshot.value = snapshot; },
);
watch(() => gameStore.state.inducementBuy?.seq, () => { induceBlade.value = 'inducements'; induceConfirmPending.value = false; });

/** In play the local coach's team; in spectate the left/home team. */
const induceMyTeam = computed(() => {
  const g = gameStore.game.value;
  if (!g) return null;
  if (!gameStore.isPlaying.value) return g.teamHome;
  return gameStore.myTeamIsHome.value ? g.teamHome : g.teamAway;
});
const induceOppTeam = computed(() => {
  const g = gameStore.game.value;
  if (!g) return null;
  if (!gameStore.isPlaying.value) return g.teamAway;
  return gameStore.myTeamIsHome.value ? g.teamAway : g.teamHome;
});

function gameOptionIsTrue(optionId: string): boolean {
  const value = gameStore.game.value?.gameOptions?.gameOptionArray
    ?.find((option) => option.gameOptionId === optionId)?.gameOptionValue;
  return String(value ?? '').toLowerCase() === 'true';
}

/**
 * Predefined inducements skip StepBuyInducements entirely upstream. The model's
 * two inducement sets are therefore the authority and acknowledgement is local
 * presentation only: it must never manufacture a purchase/confirm command.
 */
/** Mirror of the server's own predefined gate (bb2025 StepBuyInducements.init /
 *  hasPredefinedInducements): the OPTION is one trigger, but tournament (Path A)
 *  games never set it — there the TEAM models arrive carrying their inducementSet,
 *  and that presence alone routes the server down the predefined path. */
function teamHasPresetInducements(team: unknown): boolean {
  const set = (team as { inducementSet?: { inducementArray?: unknown[]; starPlayerPositionIds?: unknown[] } } | null | undefined)?.inducementSet;
  return !!set && ((set.inducementArray?.length ?? 0) > 0 || (set.starPlayerPositionIds?.length ?? 0) > 0);
}
const presetInducementsKey = computed(() => {
  const g = gameStore.game.value;
  if (!g) return null;
  if (!gameOptionIsTrue('usePredefinedInducements')
    && !teamHasPresetInducements(g.teamHome) && !teamHasPresetInducements(g.teamAway)) return null;
  // Allocation counts can decrease as inducements are consumed. Acknowledgement
  // belongs to the match, not to each later mutation of that authoritative set.
  return String(g.gameId);
});
const PRESET_ACK_SESSION_KEY = 'superfumbbl.presetInducements.acknowledgedGame';
const presetInducementsAcknowledged = ref<string | null>(
  typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(PRESET_ACK_SESSION_KEY),
);
const presetInducementsOpen = computed(() => !!presetInducementsKey.value
  && presetInducementsAcknowledged.value !== presetInducementsKey.value);
function acknowledgePresetInducements(): void {
  presetInducementsAcknowledged.value = presetInducementsKey.value;
  if (presetInducementsKey.value && typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(PRESET_ACK_SESSION_KEY, presetInducementsKey.value);
  }
}

/** Mount whenever the purchase phase is live for either seat, or presets await local review. */
const inducePhaseOpen = computed(() => presetInducementsOpen.value
  || !!(gameStore.state.inducementBuy || gameStore.state.inducementReveal)
  || !!induceRevealHoldSnapshot.value);
/** True only while I hold the live dialog — the only state in which I may send. */
const induceCanAct = computed(() => !!gameStore.state.inducementBuy);

/** My role, mirrored from the wire (dialog `usesTreasury`) — never inferred from TV. */
const induceLiveMyRole = computed<InducementRole | null>(() => {
  const b = gameStore.state.inducementBuy;
  if (b) return roleFromWire(b.usesTreasury);
  return gameStore.state.inducementReveal?.myRole ?? null;
});
const induceMyRoleLatch = ref<InducementRole | null>(null);
watch(
  () => [gameStore.state.inducementBuy, gameStore.state.inducementReveal, induceLiveMyRole.value] as const,
  ([buy, reveal, role]) => {
    if (role) induceMyRoleLatch.value = role;
    else if (!buy && !reveal) induceMyRoleLatch.value = null;
  },
  { immediate: true },
);
const induceMyRole = computed<InducementRole | null>(() => induceLiveMyRole.value ?? induceMyRoleLatch.value);
const induceOppRole = computed<InducementRole>(() => (induceMyRole.value === 'overdog' ? 'underdog' : 'overdog'));

const inducePhase = computed<InducementPhase>(() => phaseOf({
  myRole: gameStore.state.inducementBuy ? induceMyRole.value : null,
  iAmWaiting: !!gameStore.state.inducementReveal?.mineWaiting,
  mineConfirmed: !!gameStore.state.inducementReveal?.mine,
  oppConfirmed: !!gameStore.state.inducementReveal?.opp?.ready,
}));

/** My money readouts. Null while I hold no dialog — the server sends budgets only to the addressee. */
const induceMyMoney = computed(() => {
  const b = gameStore.state.inducementBuy;
  const role = induceMyRole.value;
  if (!b || !role) return null;
  return phaseMoney({
    role,
    availableGold: b.availableGold,
    pettyCash: b.pettyCash,
    // Dialog `treasury` is ALREADY min(50k, treasury) — the scum pool (StepBuyInducements.java:318/338).
    scumPool: b.treasury,
    teamTreasury: induceMyTeam.value?.treasury ?? 0,
    spent: induceSpent.value,
  });
});

const induceOptions = computed(() => gameStore.state.inducementBuy?.options ?? []);
const induceLimits = computed(() => gameStore.state.inducementBuy?.selectorLimits ?? { stars: 0, mercenaries: 0, staff: 0 });

/** Glyph placeholders per the owner's note (swap when upstream inducement icons are located). */
const INDUCE_GLYPH: Record<string, string> = {
  bribes: '⚖', halflingMasterChef: '🍲', wanderingApothecaries: '✚', biasedRef: '⚑',
  prayers: '☨', teamMascot: '☂', partTimeCoach: '📣', tempCheerleader: '★',
  weatherMage: '☁', wizard: '⚡', bloodweiserBabes: '🍺', josefBugman: '🍻',
  bugmansXXXXXX: '🍻', mortuaryAssistant: '⚰', plagueDoctor: '☣', riotousRookies: '🎲',
  throwARock: '🪨', briberyAndCorruption: '⚖', dwarfenWisdom: '📖', infamousStaff: '🎖',
  extraTeamTraining: '🏋', starPlayers: '★', mercenaries: '⚔',
};
const induceGlyph = (key: string): string => INDUCE_GLYPH[key] ?? '◆';

type InducementCardTeam = GameJson['teamHome'];

/** Roster position behind a `star:`/`merc:` option key, for sprite + stats + skills.
 *  Prefer the card owner's roster so same-race opponents cannot steal each
 *  other's exact team+position custom sprite identity. */
function inducePosition(key: string, team: InducementCardTeam | null = induceMyTeam.value) {
  const posId = key.replace(/^(star|merc|staff):/, '');
  const g = gameStore.game.value;
  if (!g) return null;
  const teams = team
    ? [team, ...(team === g.teamHome ? [g.teamAway] : [g.teamHome])]
    : [g.teamHome, g.teamAway];
  for (const candidate of teams) {
    const pos = (candidate.roster as { positionArray?: {
      positionId: string; positionName?: string; movement?: number; strength?: number;
      agility?: number; passing?: number; armour?: number; skillArray?: string[];
      urlPortrait?: string; urlIconSet?: string; nrOfIcons?: number;
    }[] }).positionArray?.find((p) => p.positionId === posId);
    if (pos) return pos;
  }
  return null;
}
function induceStats(pos: ReturnType<typeof inducePosition>) {
  if (!pos) return [];
  return [
    { k: 'MA', v: String(pos.movement ?? '–') },
    { k: 'ST', v: String(pos.strength ?? '–') },
    { k: 'AG', v: pos.agility != null ? `${pos.agility}+` : '–' },
    { k: 'PA', v: pos.passing ? `${pos.passing}+` : '–' },
    { k: 'AV', v: pos.armour != null ? `${pos.armour}+` : '–' },
  ];
}
function inducePortrait(key: string, team: InducementCardTeam | null = induceMyTeam.value): Portrait {
  const blade = bladeOf(key);
  // Prefer the in-repo resource-slot icon where one exists; the owner's glyph
  // placeholder covers the rest until the upstream icon set is located.
  if (blade === 'inducements') return { url: induceIcon(key), glyph: induceGlyph(key) };
  const pos = inducePosition(key, team);
  const glyph = blade === 'stars' ? '★' : '⚔';
  // Both readiness rails are reactive: bundled-cache discovery upgrades a glyph,
  // while assetMods.revision hot-swaps exact team+position custom sprites.
  void inducementAssetManifestReady.value;
  void assetMods.revision;
  const teamId = String((team as { teamId?: unknown } | null)?.teamId ?? '');
  return activeInducementSprite(
    teamId,
    pos,
    glyph,
    cachedBundledFumbblAsset,
  );
}

/** Picker cards per blade, projected from the server-sent option list. */
const induceCards = computed<Record<Blade, PickerCard[]>>(() => {
  const out: Record<Blade, PickerCard[]> = { inducements: [], stars: [], mercenaries: [] };
  for (const option of induceOptions.value) {
    const blade = bladeOf(option.key);
    const taken = inducePicks.value[option.key] ?? 0;
    const pos = blade === 'inducements' ? null : inducePosition(option.key, induceMyTeam.value);
    out[blade].push({
      key: option.key,
      name: option.label,
      cost: option.cost,
      // Paired stars (Grak/Crumbleberry, Dribl/Drull) are one atomic 0-cost half upstream.
      costLabel: option.available ? (option.cost > 0 ? fmtGold(option.cost) : '—') : '—',
      countLabel: blade === 'stars'
        ? (taken > 0 ? 'Hired' : '1 available')
        : `${taken} of ${option.max} ${blade === 'mercenaries' ? 'hired' : 'taken'}`,
      portrait: inducePortrait(option.key, induceMyTeam.value),
      stats: induceStats(pos),
      skills: pos?.skillArray ?? [],
      special: null, // upstream sends no star special-rule text on the roster position
      option,
    });
  }
  return out;
});

/** My live summary stack — blade-ordered, priced from my own option list. */
const induceMyCards = computed<SummaryCardView[]>(() => {
  const selected = summaryCards(inducePicks.value, induceOptions.value).map((c) => ({
    key: c.key, name: c.name, blade: c.blade, kind: c.kind, qty: c.qty,
    totalLabel: fmtGold(c.total), showBadge: c.showBadge,
    portrait: inducePortrait(c.key, induceMyTeam.value),
    skills: c.blade === 'inducements' ? [] : (inducePosition(c.key, induceMyTeam.value)?.skillArray ?? []),
  }));
  return mergeRosteredStarCards<SummaryCardView>(
    selected,
    rosteredStarCards(induceMyTeam.value, (key) => inducePortrait(key, induceMyTeam.value)),
  );
});

/**
 * A CONFIRMED coach's stack, rebuilt from the reveal wire (InducementChoice).
 * Costs are absent there, so `totalLabel` stays null (see SummaryCardView).
 */
function induceRevealCards(
  choice: { items: { key: string; label: string; count: number }[]; stars: { positionId: string; name: string; playerId?: string }[] } | null,
  team: InducementCardTeam | null,
): SummaryCardView[] {
  const revealed = revealedInducementCards(choice, induceLabel, (key) => {
    const blade = bladeOf(key);
    return {
      portrait: inducePortrait(key, team),
      skills: blade === 'inducements' ? [] : (inducePosition(key, team)?.skillArray ?? []),
    };
  });
  return mergeRosteredStarCards(
    revealed,
    rosteredStarCards(team, (key) => inducePortrait(key, team)),
  );
}

function induceTeamForRole(role: InducementRole): InducementCardTeam | null {
  const g = gameStore.game.value;
  if (!g) return null;
  if (gameStore.isPlaying.value && induceMyRole.value) {
    return role === induceMyRole.value ? induceMyTeam.value : induceOppTeam.value;
  }
  // Spectator/replay have no local seat. The current dialog identifies which field team owns
  // this role; when that wire context is absent, retain stable home-left / away-right mapping.
  const dialog = g.dialogParameter as { teamId?: unknown; usesTreasury?: unknown } | undefined;
  const activeTeam = [g.teamHome, g.teamAway].find((team) => String(team.teamId) === String(dialog?.teamId ?? ''));
  if (activeTeam && typeof dialog?.usesTreasury === 'boolean') {
    const activeRole = roleFromWire(dialog.usesTreasury);
    if (role === activeRole) return activeTeam;
    return activeTeam === g.teamHome ? g.teamAway : g.teamHome;
  }
  return role === 'overdog' ? g.teamHome : g.teamAway;
}

function inducePanel(role: InducementRole): PanelView {
  const mine = gameStore.isPlaying.value && role === induceMyRole.value;
  const reveal = gameStore.state.inducementReveal;
  const team = induceTeamForRole(role);
  const g = gameStore.game.value;
  const seat = g && team && String(team.teamId) === String(g.teamHome.teamId) ? 'home' : 'away';
  const teamLabel = team ? `${team.teamName} · ${team.coach || '—'}` : '—';
  const confirmed = mine ? !!reveal?.mine : !!reveal?.opp?.ready;
  const active = inducePhase.value === role && !confirmed;
  return {
    role, seat,
    team: teamLabel,
    status: confirmed ? 'confirmed' : active ? 'selecting' : 'waiting',
    money: mine ? induceMyMoney.value : null,
    cards: mine
      ? (induceCanAct.value ? induceMyCards.value : induceRevealCards(reveal?.mine ?? null, induceMyTeam.value))
      : induceRevealCards(reveal?.opp ?? null, induceOppTeam.value),
    editable: mine && induceCanAct.value,
    // Spec: the UNDERDOG panel dims through the overdog phase.
    dimmed: role === 'underdog' && inducePhase.value === 'overdog',
    emptyNote: active ? 'Nothing selected yet.' : confirmed ? 'No inducements.' : 'Waiting…',
  };
}
const induceOverdogPanel = computed(() => inducePanel('overdog'));
const induceUnderdogPanel = computed(() => inducePanel('underdog'));
let induceRevealHoldGameId: string | null = null;

// The final opponent reveal may be followed immediately by the server leaving the
// inducement dialog. Capture it synchronously, then let the store/server advance.
watch(
  () => [
    gameStore.game.value?.gameId,
    gameStore.isPlaying.value,
    induceMyRole.value,
    presetInducementsOpen.value,
    !!gameStore.state.inducementReveal?.mine,
    gameStore.state.inducementReveal?.opp?.ready,
    gameStore.state.inducementReveal?.seq,
  ] as const,
  ([gameId, isPlaying, myRole, presetMode, mineConfirmed, opponentConfirmed]) => {
    const gameKey = gameId == null ? null : String(gameId);
    if (gameKey !== induceRevealHoldGameId) {
      induceRevealHoldGameId = gameKey;
      induceRevealHold.reset();
    }
    if (!gameKey || !myRole || !shouldHoldUnderdogInducementReveal({
      isPlaying,
      myRole,
      presetMode,
      bothConfirmed: mineConfirmed && !!opponentConfirmed,
    })) return;
    induceRevealHold.present(gameKey, {
      overdog: induceOverdogPanel.value,
      underdog: induceUnderdogPanel.value,
      myRole,
    });
  },
  { flush: 'sync', immediate: true },
);
onBeforeUnmount(() => induceRevealHold.dispose());

/** Both seats retain the same review through the coin sequence. The server-owned
 * setup transition is their single shared teardown signal. */
watch(
  () => gameStore.game.value?.turnMode,
  (turnMode) => {
    const gameId = gameStore.game.value?.gameId;
    if (turnMode === 'setup' && gameId != null) induceRevealHold.dismiss(String(gameId));
  },
);

function presetChoiceFor(seat: 'home' | 'away') {
  const g = gameStore.game.value;
  if (!g) return null;
  const turnData = seat === 'home' ? g.turnDataHome : g.turnDataAway;
  const items = ((turnData?.inducementSet?.inducementArray ?? []) as {
    inducementType?: unknown; value?: unknown;
  }[]).flatMap((entry) => {
    const key = String(entry.inducementType ?? '');
    const count = Number(entry.value ?? 0);
    return key && Number.isFinite(count) && count > 0
      ? [{ key, label: induceLabel(key), count }]
      : [];
  });
  return { items, stars: [] };
}

function presetPanel(seat: 'home' | 'away', role: InducementRole): PanelView {
  const g = gameStore.game.value;
  const team = g ? (seat === 'home' ? g.teamHome : g.teamAway) : null;
  return {
    role,
    seat,
    team: team ? `${team.teamName} · ${team.coach || '—'}` : '—',
    status: 'confirmed',
    money: null,
    cards: induceRevealCards(presetChoiceFor(seat), team),
    editable: false,
    dimmed: false,
    emptyNote: 'No predefined inducements.',
  };
}
const presetHomePanel = computed(() => presetPanel('home', 'overdog'));
const presetAwayPanel = computed(() => presetPanel('away', 'underdog'));
const induceDisplayPhase = computed<InducementPhase>(() => (
  presetInducementsOpen.value || induceRevealHoldSnapshot.value ? 'done' : inducePhase.value
));
const induceDisplayOverdogPanel = computed(() => (
  presetInducementsOpen.value
    ? presetHomePanel.value
    : induceRevealHoldSnapshot.value?.overdog ?? induceOverdogPanel.value
));
const induceDisplayUnderdogPanel = computed(() => (
  presetInducementsOpen.value
    ? presetAwayPanel.value
    : induceRevealHoldSnapshot.value?.underdog ?? induceUnderdogPanel.value
));
const presetMySide = computed<InducementRole | null>(() => {
  if (props.mode !== 'play') return null;
  return gameStore.myTeamIsHome.value ? 'overdog' : 'underdog';
});

/** Card click — add one to MY selection. The petty+scum guard already vetted it in the component. */
function inducePhaseAdd(key: string): void {
  const option = induceOptions.value.find((o) => o.key === key);
  if (!option) return;
  inducePicks.value = { ...inducePicks.value, [key]: (inducePicks.value[key] ?? 0) + 1 };
}
function inducePhaseRemove(key: string): void {
  const next = { ...inducePicks.value };
  const cur = next[key] ?? 0;
  if (cur <= 1) delete next[key]; else next[key] = cur - 1;
  inducePicks.value = next;
}
function inducePhaseClear(): void { inducePicks.value = {}; }
/** Confirm advances the phase (server round-trip); disabled until the send is away. */
function inducePhaseConfirm(): void {
  if (induceConfirmPending.value) return;
  induceConfirmPending.value = true;
  confirmInducements();
}
// case 478: pretty-print a card-deck type (e.g. 'magicItem' → 'Magic Item') for the buy-cards picker.
function cardTypeLabel(cardType: string): string {
  return cardType
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
// Passive follow indicator: the same gold confirmation ring marks the chosen square.
watch(
  () => gameStore.state.followupIndicator?.seq,
  () => {
    const ind = gameStore.state.followupIndicator;
    if (ind && renderer) renderer.flashGoldAura(ind.square);
  },
);
// My chosen follow: a small gold flash at the arrival square (after the MOVE).
watch(
  () => gameStore.state.followupFlash?.seq,
  () => {
    const f = gameStore.state.followupFlash;
    if (f && renderer) renderer.flashGoldAura(f.square);
  },
);
// Owner 2026-07-04 (interaction catalog 16 + 45, ON THE BALL): the picked
// kick-off-return / pass-block mover goes straight into the movement planner —
// the coach queues the short move on the normal confirm bar; End Turn (which
// sends the CURRENT turnMode) closes the mini-phase.
watch(
  () => gameStore.state.onTheBallMover?.seq,
  () => {
    const m = gameStore.state.onTheBallMover;
    if (m && renderer) renderer.selectPlayer(m.playerId);
  },
);

// Owner 2026-07-04c: FOUL / HAND-OFF / PASS — the hover roll tip (skull/hand +
// "n+") beside the cursor and the "Perform foul?/Hand off?/Throw the pass?"
// confirm modal for the armed target.
const actionTip = reactive({ visible: false, mode: 'foul' as 'foul' | 'handoff' | 'pass', text: '', x: 0, y: 0 });
const actionModal = ref<{ seq: number; mode: 'foul' | 'handoff' | 'pass'; targetId: string; rollText: string } | null>(null);
// Owner 2026-07-04d: the confirm modal is DRAGGABLE — a persisted per-session
// position (null = the centred default). Reset when a new modal opens.
const actionModalPos = ref<{ x: number; y: number } | null>(null);
watch(() => actionModal.value, (m) => { if (!m) actionModalPos.value = null; });
const actionModalStyle = computed(() =>
  actionModalPos.value
    ? { left: `${actionModalPos.value.x}px`, top: `${actionModalPos.value.y}px`, transform: 'none' }
    : {},
);
function startActionModalDrag(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('button')) return; // buttons stay clickable
  const el = event.currentTarget as HTMLElement;
  const host = pitchHost.value;
  if (!host) return;
  event.preventDefault();
  const rect = el.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const dx = event.clientX - rect.left;
  const dy = event.clientY - rect.top;
  const move = (ev: PointerEvent) => {
    actionModalPos.value = {
      x: Math.max(0, Math.min(ev.clientX - hostRect.left - dx, hostRect.width - rect.width)),
      y: Math.max(0, Math.min(ev.clientY - hostRect.top - dy, hostRect.height - rect.height)),
    };
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// Owner 2026-07-04e: unknown-call diagnostic panel helpers.
const unknownPickingTile = ref(false);
const unknownCopyStatus = ref('');
// Owner 2026-07-04f: the panel is MOVABLE (drag the header) + RESIZABLE (CSS).
const unknownCallPos = ref<{ x: number; y: number } | null>(null);
const unknownCallStyle = computed(() =>
  unknownCallPos.value
    ? { left: `${unknownCallPos.value.x}px`, top: `${unknownCallPos.value.y}px`, transform: 'none' }
    : {},
);
function startUnknownDrag(ev: PointerEvent) {
  const el = (ev.currentTarget as HTMLElement).closest('.unknown-call') as HTMLElement | null;
  const host = pitchHost.value;
  if (!el || !host) return;
  ev.preventDefault();
  const rect = el.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const dx = ev.clientX - rect.left, dy = ev.clientY - rect.top;
  const move = (e: PointerEvent) => {
    unknownCallPos.value = {
      x: Math.max(0, Math.min(e.clientX - hostRect.left - dx, hostRect.width - rect.width)),
      y: Math.max(0, Math.min(e.clientY - hostRect.top - dy, hostRect.height - 40)),
    };
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
async function copyUnknownDetails() {
  try {
    await navigator.clipboard.writeText(gameStore.unknownCallDetails());
    unknownCopyStatus.value = 'Copied ✓';
  } catch {
    unknownCopyStatus.value = 'Copy failed';
  }
  setTimeout(() => (unknownCopyStatus.value = ''), 2000);
}
function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportUnknownLog() {
  downloadText(`fumbbl40k-unknown-${gameStore.state.unknownCall?.id ?? 'call'}-${Date.now()}.log`, gameStore.exportUnknownCallLog());
}
function screenshotUnknown() {
  // capture the render canvas as a PNG download (the pitch state at this moment)
  const canvas = pitchHost.value?.querySelector('canvas') as HTMLCanvasElement | null;
  if (!canvas) { unknownCopyStatus.value = 'No canvas'; return; }
  try {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fumbbl40k-unknown-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    unknownCopyStatus.value = 'Screenshot saved ✓';
  } catch {
    unknownCopyStatus.value = 'Screenshot failed (canvas taint)';
  }
  setTimeout(() => (unknownCopyStatus.value = ''), 2500);
}
function armUnknownTilePick() {
  const u = gameStore.state.unknownCall;
  if (!u || !renderer) return;
  unknownPickingTile.value = true;
  renderer.setTilePick(true, u.eligible);
}
watch(() => gameStore.state.unknownCall, (u) => { if (!u) unknownCallPos.value = null; });

/** Answer the follow-up chip: gold aura on the CHOSEN square, then the wire. */
function answerFollowup(follow: boolean) {
  const fc = gameStore.state.followupChoice;
  if (!fc) return;
  renderer?.flashGoldAura(follow ? fc.square : fc.from);
  gameStore.resolveFollowup(follow);
}

// Show planner/path previews only to the acting coach in play/demo mode; pure spectate and spectator-clean hide them.
const plannerAllowed = computed(
  // C6 (owner 2026-07-09): a server shutdown ends the match — no selection/planning after it.
  // ORDER 66 (A.2): the client planner (BFS paths + reach shading) is the REPLACE surface — server
  // moveSquareArray drives movement instead — so it is OFF whenever settings.order66 is on (⚖ law).
  () => !settings.spectatorClean && !gameStore.state.gameShutdown && !settings.order66
    && (gameStore.state.demoMode || (gameStore.isPlaying.value && gameStore.myTurn.value)),
);
watch(plannerAllowed, (allowed) => {
  if (renderer) {
    renderer.plannerEnabled = allowed;
    renderer.clearSelection();
  }
});
// ORDER 66 (P1): the renderer hands clicks to the o66 router (bypassing the legacy cinematic-freeze +
// block-preview interceptors) ONLY in o66 PLAY mode. Spectate/ClassicView never flip it (byte-valid passes).
const o66RendererActive = computed(() => settings.order66 && gameStore.isPlaying.value);
watch(o66RendererActive, (on) => { if (renderer) renderer.order66 = on; });

// Jump availability uses an explicit upstream-checked whitelist; reaction/kickoff states remain omitted and the whitelist is drift-prone.
/** Putrid walk availability depends on the raw action: only putridRegurgitationBlitz may walk; derived state is insufficient. */
function putridWalkArmed(): boolean {
  const ap = gameStore.game.value?.actingPlayer as { playerAction?: string | null } | undefined;
  return String(ap?.playerAction ?? '') === 'putridRegurgitationBlitz';
}
/** Raw `punt` means moveSquareArray contains Punt targets, not walk/jump reach (`PuntLogicModule.java:56-69`). */
function isPuntTargeting(g: { actingPlayer?: unknown }): boolean {
  return String((g.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? '') === 'punt';
}
/**
 * U9b presentation-only Punt spread, following Meero's authoritative end-to-end ruling. StepPuntDirection uses
 * the punter-to-aim base direction to roll one of the left-diagonal, straight, or right-diagonal rays; its
 * coordinateFrom.move(direction, 1) position is only an intermediate indicator. StepPuntDistance:109 then
 * overwrites the ball position with coordinateFrom.move(direction, distance), where distance is the d6 result.
 * Thus the possible landing set is distances 1..6 from the punter on all three rays, stopping at the final
 * in-pitch square as findLastSquareOnPitch does (StepPuntDirection + StepPuntDistance:109; Meero ruling).
 */
function puntScatterPreview(from: [number, number], aim: [number, number]): [number, number][] {
  const dx = aim[0] - from[0], dy = aim[1] - from[1];
  if (Math.abs(dx) + Math.abs(dy) !== 1) return [];
  const directions: [number, number][] = [
    [dx + dy, dy - dx],
    [dx, dy],
    [dx - dy, dy + dx],
  ];
  const squares: [number, number][] = [];
  const seen = new Set<string>();
  for (const [sx, sy] of directions) {
    for (let distance = 1; distance <= 6; distance++) {
      const x = from[0] + sx * distance, y = from[1] + sy * distance;
      if (x < 0 || x > 25 || y < 0 || y > 14) break;
      const key = `${x},${y}`;
      if (!seen.has(key)) {
        seen.add(key);
        squares.push([x, y]);
      }
    }
  }
  return squares;
}

// ── Punt UX v2 (owner 08-12) ─────────────────────────────────────────────────────────────────────────
// The scatter cone appears the instant Punt is declared, aimed at a seat-aware default (toward the OPPOSITION
// endzone — home defends x=0, away x=25). The at-punter direction picker selects an offered orthogonal aim;
// a DRAGGABLE confirm card at the renderer's live cone centre is the only sender.
function puntActingFrom(g: GameJson): { actingId: string; from: [number, number] } | null {
  const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (!actingId) return null;
  const from = normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
    .find((d) => d.playerId === actingId)?.playerCoordinate);
  return from ? { actingId, from } : null;
}
/** Seat-aware default: the offered direction most toward the opposition endzone, straightest as tiebreak. */
function defaultPuntAim(g: GameJson, from: [number, number]): [number, number] | null {
  const targets = serverMoveSquares(g);
  if (!targets.length) return null;
  const oppEndzoneX = gameStore.myTeamIsHome.value ? 25 : 0;
  return targets.slice().sort((a, b) => {
    const dxA = Math.abs(a[0] - oppEndzoneX), dxB = Math.abs(b[0] - oppEndzoneX);
    if (dxA !== dxB) return dxA - dxB;
    return Math.abs(a[1] - from[1]) - Math.abs(b[1] - from[1]);
  })[0] ?? null;
}
// Owner ① (08-12): the cone + confirm must surface the MOMENT Punt is declared from the menu, not only after a
// manual direction click. Watch the DERIVED default aim (not just the targeting boolean): if `playerAction==='punt'`
// flips true a tick before the server's moveSquareArray is populated, the old one-shot edge watch armed against an
// empty target set (defaultPuntAim → null) and never retried, leaving the cone un-armed until a click set it. This
// re-fires as the targets arrive and arms as soon as a default exists (immediate covers a rejoin into targeting).
watch(() => {
  const g = gameStore.game.value;
  if (!g || !settings.order66 || !gameStore.isPlaying.value) return null;
  if (deriveClientState(g, o66Ctx()) !== 'PUNT' || !isPuntTargeting(g)) return null;
  const af = puntActingFrom(g);
  return af ? defaultPuntAim(g, af.from) : null;
}, (def) => {
  if (def && !o66PendingPunt.value) o66PendingPunt.value = def;
}, { immediate: true });
// The confirm card follows the renderer's camera-live cone centre; goes NULL (card hidden) the instant teardown runs.
const puntConeAnchor = ref<{ x: number; y: number } | null>(null);
type PuntScreenDirection = 'up' | 'down' | 'left' | 'right';
type PuntDirectionChoice = { direction: PuntScreenDirection; arrow: string; square: [number, number] };
const puntDirectionArrow: Record<PuntScreenDirection, string> = { up: '▲', down: '▼', left: '◀', right: '▶' };
// Owner ② (08-13): the at-punter direction picker maps the server's offered aims into live screen space.
const puntReaimAnchor = ref<{ x: number; y: number } | null>(null);
const puntDirectionChoices = ref<PuntDirectionChoice[]>([]);
function selectPuntDirection(square: [number, number]) {
  o66PendingPunt.value = square;
}
let puntConeRaf = 0;
watch(() => {
  const g = gameStore.game.value;
  return !!o66PendingPunt.value && !!g && isPuntTargeting(g);
}, (on) => {
  cancelAnimationFrame(puntConeRaf);
  if (!on) { puntConeAnchor.value = null; puntReaimAnchor.value = null; puntDirectionChoices.value = []; return; }
  const step = () => {
    if (reactivePromptHeld.value !== 'puntConfirm') puntConeAnchor.value = renderer?.puntConeCenter() ?? null;
    const g = gameStore.game.value;
    const af = g ? puntActingFrom(g) : null;
    const anchor = af && renderer ? (renderer.playerScreenPos(af.actingId) ?? renderer.screenPosOf(af.from)) : null;
    puntReaimAnchor.value = anchor;
    const choices: PuntDirectionChoice[] = [];
    const claimed = new Set<PuntScreenDirection>();
    if (g && af && renderer && anchor) {
      for (const square of serverMoveSquares(g)) {
        const dx = square[0] - af.from[0], dy = square[1] - af.from[1];
        if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
        const target = renderer.screenPosOf(square);
        if (!target) continue;
        const screenDx = target.x - anchor.x, screenDy = target.y - anchor.y;
        if (screenDx === 0 && screenDy === 0) continue;
        const direction: PuntScreenDirection = Math.abs(screenDx) > Math.abs(screenDy)
          ? (screenDx < 0 ? 'left' : 'right')
          : (screenDy < 0 ? 'up' : 'down');
        if (claimed.has(direction)) continue;
        claimed.add(direction);
        choices.push({ direction, arrow: puntDirectionArrow[direction], square });
      }
    }
    puntDirectionChoices.value = choices;
    puntConeRaf = requestAnimationFrame(step);
  };
  step();
});
onBeforeUnmount(() => cancelAnimationFrame(puntConeRaf));
// The cone-centre card is the only sender — commit the current aim as the punt field-coordinate.
function confirmPuntV2() {
  const g = gameStore.game.value;
  if (!g || !isPuntTargeting(g) || !o66PendingPunt.value) return;
  const af = puntActingFrom(g); if (!af) return;
  gameStore.sendFieldCoordinate(af.actingId, o66PendingPunt.value);
  o66PendingPunt.value = null;
}
function isHailMaryPassAction(g: { actingPlayer?: unknown }): boolean {
  return String((g.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? '') === 'hailMaryPass';
}
// Owner 08-12: the pass range template's positive allow-list — free-select · menu-forced · pass target armed.
// All other PASS states (incl. plain declared-pass targeting) suppress it; the crosshair/tooltip tokens carry that.
// P1 (owner live g870, 08-18): AT REST is the fourth arm. The 08-12 suppression is scoped to a pass that is
// WALKING; a passer whose whole budget is spent (empty walk reach) cannot walk at all, so he is in exactly the
// targeting stage that ruling arms — see passAtRestArmRequired. `walkReachCount` is the caller's already-computed
// reach size; the default (-1) means "not at rest / caller didn't measure" and keeps the old behaviour verbatim.
function passTemplateAllowed(walkReachCount = -1): boolean {
  if (gameStore.state.freeSelectPass || !!o66PendingPass.value || passTemplateForced.value) return true;
  const g = gameStore.game.value;
  return walkReachCount >= 0 && !!g && passAtRestArmRequired(g, o66Ctx(), walkReachCount);
}
function isThrowMateState(state: string): state is 'THROW_TEAM_MATE' | 'KICK_TEAM_MATE' {
  return state === 'THROW_TEAM_MATE' || state === 'KICK_TEAM_MATE';
}
// Include PUTRID_REGURGITATION_BLITZ in Jump availability because upstream offers Jump in that state.
const JUMP_MOVE_STATES: ReadonlySet<string> = new Set(['MOVE', 'BLITZ', 'FOUL', 'PASS', 'HAND_OVER', 'PUNT', 'THROW_TEAM_MATE', 'KICK_TEAM_MATE', 'GAZE_MOVE', 'PUTRID_REGURGITATION_BLITZ', 'KICK_EM_BLITZ', 'PASS_BLOCK']);
// On-the-Ball movement states reuse the normal client planner, with their fixed allowance supplied by the renderer.
// PASS_BLOCK joins the existing single-hop jump branch because its upstream logic module offers JUMP; kickoff return
// deliberately does not (KickoffReturnLogicModule offers only MOVE/END_MOVE).
const ON_THE_BALL_MOVE_STATES: ReadonlySet<string> = new Set(['PASS_BLOCK', 'KICKOFF_RETURN']);

// #236: the election is identified by the server's ReportFumblerooskie and remains live only while the echoed
// ballMoving model flag + same acting player agree. `setFumblerooskiePending` itself is NOT live-synced
// (`ActingPlayer.java:441-447`); `setBallMoving` is (`FieldModel.java:564-570`, ModelChangeId.java:69). This computed
// therefore cannot outlive StepResetFumblerooskie's ballMoving(false) auto-cancel (:89-117), whether or not that
// path also emits the standing-player used:false report.
const fumblerooskieActive = computed(() => {
  const g = gameStore.game.value;
  const election = gameStore.state.fumblerooskie;
  const acting = g?.actingPlayer as { playerId?: string | null; playerAction?: string | null } | undefined;
  return !!g && !!election && !!g.fieldModel.ballMoving
    && String(acting?.playerId ?? '') === election.playerId
    && allowsFumblerooskieAction(acting?.playerAction);
});

// ORDER 66 (A.2): the server's move squares for the acting player, ONLY while the ported machine derives MOVE
// for the local coach (deriveClientState with myIsHome). Empty otherwise — this is the render filter (paints
// only for the acting side, never spectators/defenders — Yularen's task-5 rider, satisfied structurally).
const o66MoveSquares = computed<[number, number][]>(() => {
  const g = gameStore.game.value;
  if (!g || !settings.order66 || !gameStore.isPlaying.value) return [];
  const st = deriveClientState(g, o66Ctx());
  // Swoop is a server-owned coordinate election, including reconnect snapshots that arrive directly in SWOOP.
  // Keep its legal-set derivation in the shared interaction layer used by both layouts.
  const swoopSquares = swoopCoordinateSquares(g, o66Ctx());
  if (swoopSquares !== null) return swoopSquares;
  const ttmKey = ttmActivationKey(g);
  if (isThrowMateState(st) && ttmKey
    && (ttmCancelledActivationKeys.has(ttmKey) || ttmCommittedActivationKeys.has(ttmKey))) return [];
  if (isGazeMovementState(st) && !gameStore.hasLiveGazeIntent()) return [];
  // Move-family reach is a client preview; the server validates each submitted path and terminal action.
  const putridWalk = st === 'PUTRID_REGURGITATION_BLITZ' && putridWalkArmed();
  // #236: StepInitMoving.java:270-278 handles the election without changing PlayerAction or entering a picker;
  // MoveLogicModule.java:241-285 continues through sendPlayerMove on that SAME activation. Keep the existing walk
  // rail armed even for a moving-action state omitted by the general view whitelist; never fall back to SELECT/MOVE.
  const fumblerooskieWalk = fumblerooskieActive.value;
  // #299 game_800 capture — BOMB omitted here made the :2923 watcher branch unreachable; upstream auto-arms the bomb range ruler (BombLogicModule/ClientStateFactory).
  // W39: bb2025 GazeLogicModule extends MoveLogicModule (ordinary move interaction); BloodLustBehaviour.java:
  // 123-130 republishes the move stack and continues on failed non-dialog actions.
  if (!fumblerooskieWalk) {
    if (!putridWalk && !ON_THE_BALL_MOVE_STATES.has(st) && st !== 'MOVE' && st !== 'PASS' && st !== 'PUNT' && st !== 'BOMB' && st !== 'FOUL' && !isBlitzMovementState(st) && st !== 'HAND_OVER' && !isGazeMovementState(st) && !isThrowMateState(st) && st !== 'SELECT_BLITZ_TARGET' && st !== 'HIT_AND_RUN' && st !== 'SWOOP' && st !== 'FURIOUS_OUTBURST') return []; // Star S8: shared Blitz reach + outburst server squares
  }
  const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (!actingId || !renderer) return [];
  // Raw `punt` repurposes moveSquareArray as the four server-selected orthogonal targets; `puntMove` keeps the
  // normal client walk reach. Mirrors PuntLogicModule.java:56-69 and StepInitPunt.java:140-163.
  if (st === 'PUNT' && isPuntTargeting(g)) {
    return serverMoveSquares(g);
  }
  // TTM/KTM shows walk/mate-pick reach before pickup and landing range after pickup, even with no movement left.
  if (isThrowMateState(st) && o66ThrownMate.value) {
    const fromTtm = normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
      .find((d) => d.playerId === actingId)?.playerCoordinate);
    return fromTtm ? ttmRangeSquares(g, fromTtm) : [];
  }
  // BALL & CHAIN (movesRandomly): the aim squares are the SERVER's ≤4 orthogonal facings (fieldModel.
  // moveSquareArray) — NOT the client MA reach that o66Reach computes (which would offer a walk the Fanatic
  // can't take). Arm them verbatim; the click is a single AIM step and the server scatters (onTilePick below).
  if (st === 'MOVE' && movesRandomly(g, actingId)) return serverMoveSquares(g);
  // #116 HIT_AND_RUN (Meero HR-1b): the fork's StepHitAndRun accepts ONLY an ADJACENT move-away square
  //   (findAdjacentCoordinates → fieldModel.moveSquareArray), NOT the client MA reach. Arm the SERVER's squares
  //   verbatim (like Ball & Chain) so a non-adjacent tile is never offered — a far click can't reach a coordinate
  //   the server would reject (soft-wedge). Click routing sends ONE field-coordinate per step (onTilePick below).
  if (st === 'HIT_AND_RUN') return serverMoveSquares(g);
  // Star S8: FURIOUS_OUTBURST teleport squares are the SERVER's eligible set (empty adjacent-to-target, then
  // within-3 on the return beat) — never the client MA reach (the teleport is not a walk).
  if (st === 'FURIOUS_OUTBURST') return serverMoveSquares(g);
  // #113: while the acting player is LEAPING (jump toggle ON), the server FLIPS moveSquareArray to the valid 2-away
  //   JUMP squares (TK stage-5 g716 confirmed: toggleJump→leaping=true→moveSquareArray=2-away jump set→jump resolves).
  //   The client o66Reach is the MA WALK reach and does NOT include jump tiles, so render the SERVER's set (⚖ law).
  //   Toggling OFF returns to the o66Reach walk. Click routing steps a jump square directly (onTilePick below).
  if (JUMP_MOVE_STATES.has(st) && (g.actingPlayer as { leaping?: boolean } | undefined)?.leaping) return serverMoveSquares(g);
  // Owner 08-18: a plotted plan re-anchors the reach at the LAST WAYPOINT on the budget its steps left
  //   (o66Reach's plannedRoute) — the range/rush tint follows the plan instead of freezing on the origin ring.
  const reach = renderer.o66Reach(actingId, o66PendingMove.value?.route ?? []);
  // W17's live one-ring remains the fail-closed fallback if the client preview cannot be computed.
  return reach?.squares ?? (ON_THE_BALL_MOVE_STATES.has(st) ? serverMoveSquares(g) : []);
});
const furiousOutburstInstruction = computed(() => {
  const g = gameStore.game.value;
  if (!g || !gameStore.isPlaying.value || !gameStore.myTurn.value) return null;
  return furiousOutburstCoordinatePrompt(g);
});
// While leaping, mark the server-provided jump squares; click routing remains unchanged.
const jumpCrosshairSquares = computed<[number, number][]>(() => {
  const g = gameStore.game.value;
  if (!g || !settings.order66 || !gameStore.isPlaying.value) return [];
  // Parity with o66MoveSquares (:2784, Kallus item-404 note): gate on the SAME `JUMP_MOVE_STATES && leaping`
  //   condition that makes the reach return the server jump set, so the crosshair squares are provably IDENTICAL to
  //   the reach shading — no divergence even in a transient non-jump-state frame carrying a stale leaping flag.
  const leaping = !!(g.actingPlayer as { leaping?: boolean } | undefined)?.leaping;
  return leaping && !isPuntTargeting(g) && JUMP_MOVE_STATES.has(deriveClientState(g, o66Ctx())) ? serverMoveSquares(g) : [];
});
watch(jumpCrosshairSquares, (squares) => { renderer?.setJumpCrosshairs(squares); });
// Arm the tile-pick overlay (②) with those squares → the renderer draws them + routes clicks to onTilePick,
// which steps the acting player (below). Re-arms each step as the server sends a fresh moveSquareArray.
// P1: observe the server actor-null edge; an at-rest HMP has no o66MoveSquares transition to trigger teardown.
watch([o66MoveSquares, () => gameStore.state.freeSelectPass, o66PendingPunt, o66PendingPass, passTemplateForced,
  () => String((gameStore.game.value?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? ''),
  () => gameStore.state.reRollPrompt?.seq, () => gameStore.state.skillChoice?.seq,
], ([squares]) => {
  if (!renderer || !settings.order66) return;
  // Drop a stale automove preview when the reach no longer offers its destination (e.g. after the confirmed
  // move landed, or the turn/activation changed) — a preview only survives while its target is still reachable.
  const pm = o66PendingMove.value;
  if (pm && !squares.some((s) => s[0] === pm.dest[0] && s[1] === pm.dest[1])) {
    o66PendingMove.value = null; renderer.setO66Path([]);
  }
  const currentGame = gameStore.game.value;
  const hailMaryPass = !!currentGame && isHailMaryPassAction(currentGame);
  const currentActing = currentGame?.actingPlayer as { hasPassed?: boolean } | undefined;
  // The server may keep PASS derived while resolving a submitted throw (Blast It, scatter/catch, rerolls).
  // Once hasPassed is authoritative, the target rail is finished; never invite a second target click.
  if (currentActing?.hasPassed === true) {
    o66PendingPass.value = null;
    renderer.setPassRuler(null, null);
    renderer.setTilePick(false);
    renderer.setO66MoveRolls(null);
    renderer.setO66PassRolls(null);
    return;
  }
  const pendingPunt = o66PendingPunt.value;
  const puntStillOffered = !!currentGame && deriveClientState(currentGame, o66Ctx()) === 'PUNT'
    && isPuntTargeting(currentGame) && !!pendingPunt
    && squares.some((s) => s[0] === pendingPunt[0] && s[1] === pendingPunt[1]);
  if (pendingPunt && !puntStillOffered) o66PendingPunt.value = null;
  // AYCE (owner UAT 08-12): a STATIONARY bomber has empty walk reach, so its range template falls into the
  // empty-reach else-branch below and is shown only by the state-ENTER arm — a SECOND bomb (same BOMB state, no
  // state change) then never re-arms the guide (guard-clear-scope class). Re-arm per update while in BOMB with no
  // target nominated: state-derived, so every bomb instance keeps the targeting template up.
  const bombSt = currentGame ? deriveClientState(currentGame, o66Ctx()) : '';
  if (bombSt === 'BOMB' && !hailMaryPass && !o66PendingPass.value) {
    const bomberId = String((currentGame!.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    if (bomberId && gameStore.iControl(bomberId)) { o66ArmPassTemplate(bomberId); return; }
  }
  // P1 (owner live g870, 08-18) — the PASS twin of the AYCE re-arm above. A declared passMove walker who spends
  // his whole budget (MA + both rushes) has an EMPTY reach, so without this the else-branch below fires
  // setTilePick(false) and the throw surface is GONE while the server is still offering the pass. Arming the
  // at-rest template keeps the ball-holder able to finish his declared action instead of only bailing out.
  if (currentGame && passAtRestArmRequired(currentGame, o66Ctx(), squares.length)) {
    const passerId = String((currentGame.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    if (passerId && gameStore.iControl(passerId)) { o66ArmPassTemplate(passerId); return; }
  }
  if (squares.length > 0 || hailMaryPass) {
    // Owner o66m+ (#9/#10/#11): the reach tiles get their GO-FOR-IT (rush) die from the CLIENT reach (steps
    // beyond normal MA); the DODGE cost is path-dependent, so it shows on the previewed auto-path (setO66Path),
    // not per tile. BLITZ (server squares) has no client reach → no rush ring.
    const g = currentGame;
    const st = g ? deriveClientState(g, o66Ctx()) : '';
    const actingId = String((g?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    // #181 PU-5/PU-5a: rush rides the walk, so it takes the SAME raw-action guard — see putridWalkArmed.
    const rush = (st === 'MOVE' || st === 'PASS' || (st === 'PUNT' && !!g && !isPuntTargeting(g)) || st === 'FOUL' || isBlitzMovementState(st) || st === 'HAND_OVER' || st === 'GAZE_MOVE' || st === 'GAZE' || isThrowMateState(st) || st === 'SELECT_BLITZ_TARGET' || (st === 'PUTRID_REGURGITATION_BLITZ' && putridWalkArmed())) && actingId ? (renderer.o66Reach(actingId, o66PendingMove.value?.route ?? [])?.rush ?? []) : []; // #91: reach+rush in selectBlitzTarget for the convert-to-move gesture
    // PASS: throw targets are the bb2025 RANGE TEMPLATE from the passer's CURRENT square (owner: limit targets to
    // the pass range, not the whole pitch). Armed as `extra` — clickable + faintly ringed, but NOT walk-dots.
    // TTM/KTM (owner o66am): once a team-mate is PICKED UP (o66ThrownMate set), the LANDING targets are the same pass
    // range from the thrower's square; before that the thrower is still walking to a team-mate (no landing targets).
    let extra: [number, number][] | null = null;
    // Per-square pass-roll cards are presentation-only. PASS, BOMB, and TTM/KTM deliberately return no field-wide
    // map; the shared pass rail, range/click surface, hover readout, and chosen-destination preview remain.
    let passRolls: ReturnType<typeof throwRollSurface> = null;
    // TTM/KTM (owner o66am): the landing template is only live once a team-mate is PICKED UP (o66ThrownMate set).
    const ttmLanding = isThrowMateState(st) && !!o66ThrownMate.value;
    if ((st === 'BOMB' || st === 'PASS' || ttmLanding) && actingId && g) {
      const from = normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
        .find((d) => d.playerId === actingId)?.playerCoordinate);
      if (from) {
        // Owner 08-12: while a declared Pass is WALKING (passMove), suppress the range-TINT template; it arms at
        // the targeting stage (playerAction 'pass'). BOMB has no separate move phase, unaffected. A held TTM/KTM
        // explicitly feeds the same Quick+Short squares into `extra`: `squares` remains the exact click gate while
        // `extra` owns the coloured Pass chart. The pass-roll map stays null, so this never restores yellow cards.
        if (ttmLanding) extra = ttmRangeSquares(g, from);
        else if (hailMaryPass || st === 'BOMB' || (st === 'PASS' && passTemplateAllowed(squares.length))) extra = passRangeSquares(g, from);
        // Keep card suppression at the host projection seam: tilePickExtra continues to own click legality while
        // the selected destination continues through passDestinationRollPreview below.
        passRolls = throwRollSurface(g, from, actingId,
          ttmLanding ? 'TTM_LANDING' : (st as 'PASS' | 'BOMB'), gameStore.state.freeSelectPass);
      }
    }
    // U9b single-producer proof: this PUNT/raw-punt branch and the B&C branch below (MOVE/movesRandomly) are
    // mutually exclusive derived states for the one acting player. Reuse setBncAim for the three-ray preview;
    // the server-offered aim crosshairs stay on tilePick and remain the only squares that can commit an aim.
    const puntAim = st === 'PUNT' && g && isPuntTargeting(g) ? o66PendingPunt.value : null;
    const puntFrom = puntAim && actingId && g
      ? normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
        .find((d) => d.playerId === actingId)?.playerCoordinate)
      : null;
    if (puntFrom && puntAim) renderer.setBncAim(puntFrom, puntScatterPreview(puntFrom, puntAim), 'punt'); // v2: explicit kind (no inference)
    // BALL & CHAIN (movesRandomly): the aim squares render as directional PUSH ARROWS (setBncAim), NOT walk
    // tiles — the click is a FACING, not a destination (onBncAim sends the aim CLIENT_MOVE; the server scatters).
    if (st === 'MOVE' && actingId && g && movesRandomly(g, actingId)) {
      // Owner E5 (08-12, Voss+Meero [SOURCE]): the coach declares the B&C base direction ONCE; a Direction reroll
      // (ReRolledActions.DIRECTION — StepMoveBallAndChain:174-190) re-rolls the SCATTER only and NEVER re-arms the aim
      // fan, and moveSquareArray then carries the RESOLVED dest, so re-arming from it paints a wrong fan over the
      // reroll dialog (owner clicked stale West→North arrows during the reroll). Fungus' Whirling Dervish is the
      // same post-destination election on a skillUse card. While either decision is offered, DON'T re-arm the
      // cardinal fan; the renderer retains only the authoritative from→destination arrow/crosshair.
      const whirlingDervishChoice = String(gameStore.state.skillChoice?.skill ?? '')
        .replace(/[^a-z0-9]/gi, '').toLowerCase() === 'whirlingdervish';
      if (gameStore.state.reRollPrompt?.reRolledAction === 'Direction' || whirlingDervishChoice) {
        renderer.setBncAim(null, []);
        renderer.setTilePick(false);
        renderer.setO66MoveRolls(null);
        renderer.setO66PassRolls(null);
        return;
      }
      const from = normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
        .find((d) => d.playerId === actingId)?.playerCoordinate);
      renderer.setBncAim(from, squares);
      renderer.setTilePick(false);
      renderer.setO66MoveRolls(null);
      renderer.setO66PassRolls(null);
      return;
    }
    // Swoop is a server-owned CARDINAL election, not a walk. The former order66-move tile mode intentionally
    // draws no dots/crosshairs when there are no roll chips, leaving all four legal choices invisible (g920).
    // Reuse the Ball & Chain cardinal arrows so the exact offered coordinates are visible and clickable; the
    // onBncAim handler below still sends one CLIENT_SWOOP and never predicts or auto-selects a direction.
    if (st === 'SWOOP' && actingId && g) {
      const from = normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
        .find((d) => d.playerId === actingId)?.playerCoordinate);
      renderer.setBncAim(from, squares);
      renderer.setTilePick(false);
      renderer.setO66MoveRolls(null);
      renderer.setO66PassRolls(null);
      return;
    }
    if (!puntFrom || !puntAim) renderer.setBncAim(null, []); // neither Punt preview nor B&C → clear stale arrows
    // #116 HIT_AND_RUN parity: upstream ClientStateHitAndRun chooses CURSOR_HIT_AND_RUN only when
    // HitAndRunLogicModule.isValidField finds the coordinate in fieldModel.moveSquareArray. Preserve that exact
    // server-owned predicate here, but opt these squares into the renderer's target crosshair + hover cursor;
    // every other move state keeps the intentionally unmarked `order66-move` automove surface byte-identical.
    // HMP keeps unrestricted click routing but now retains the ordinary coloured range chart as a visual guide;
    // squares beyond the chart remain legal because the click set is still null (whole pitch).
    if (st === 'HIT_AND_RUN' || st === 'FURIOUS_OUTBURST') {
      renderer.setTilePick(true, squares, 'order66-hit-and-run', rush, extra);
    } else {
      renderer.setTilePick(true, hailMaryPass ? null : squares, 'order66-move', hailMaryPass ? null : rush, extra);
    }
    renderer.setO66MoveRolls(null);
    renderer.setO66PassRolls(passRolls);
  } else {
    renderer.setBncAim(null, []);
    // A server-owned squarePick (including PLACE_BALL / Safe Pair of Hands) owns this same overlay. Do not let
    // the empty Order-66 walk surface erase the crosshairs armed by the squarePick watcher above.
    if (!gameStore.state.squarePick) renderer.setTilePick(false);
    renderer.setO66MoveRolls(null);
    if (!gameStore.state.wizardTargetPreview) renderer.setO66PassRolls(null);
  }
});
// Owner 09-06: the Ball & Chain 'click a DIRECTION to aim' notice is gone (it read as a chat toast); the cardinal
// arrows + the scatter die at the destination remain the whole cue.
// B&C phase 2 (owner): on a scatter result, pop the die-tagged d6 at the destination (showActionDie) + mark the
// destination square with a crosshair. This is the reroll-decision display — the reroll prompt rides phase 3.
// The die + crosshair clear naturally when the next aim arms (setBncAim(from) nulls the scatter dest).
watch(() => gameStore.state.bncScatter?.seq, () => {
  const s = gameStore.state.bncScatter;
  if (!renderer) return;
  // g868 (owner 08-18): a scatter that ends in a BLOCK never arms another aim, so the "cleared by the next aim"
  // path never runs. The store now retires state.bncScatter when the activation does — mirror that to the renderer.
  if (!s) { renderer.setBncScatterDest(null); return; }
  renderer.showActionDie(s.dest, s.roll, 'Ball & Chain');
  renderer.setBncScatterDest(s.dest, s.from);
});
// ORDER 66 (g478 #1): while the ported machine derives HIGH_KICK for the local (receiving) coach, the eligible
// nominees (verbatim isPlayerSelectable — active + my side) carry player-pick crosshairs; a click routes to
// onPlayerClick → highKickNominate. Empty otherwise (also outside HIGH_KICK, clearing the crosshairs + swap).
const o66HighKickNominees = computed<string[]>(() => {
  const g = gameStore.game.value;
  if (!g || !settings.order66 || !gameStore.isPlaying.value) return [];
  if (deriveClientState(g, o66Ctx()) !== 'HIGH_KICK') return [];
  return highKickNomineeIds(g);
});
watch(o66HighKickNominees, (ids, previousIds) => {
  if (!renderer || !settings.order66) return;
  // Generic playerChoice picks (including Diving Catch) own this renderer channel while armed.
  // Only clear when this watcher previously armed High Kick, so routine non-HIGH_KICK frames
  // cannot clobber a generic pick regardless of watcher ordering within the reactive flush.
  if (!gameStore.state.playerPick) {
    if (ids.length > 0) renderer.setPlayerPick(ids);
    else if (previousIds.length > 0) renderer.setPlayerPick(null);
  }
  // Leaving HIGH_KICK drops the staged slot: the store's projection self-nulls, so nothing is cleared here.
});
// High Kick and Quick Snap need an explicit CLIENT_END_TURN close; Solid Defence uses setup Done.
const o66MiniPhase = computed<{ prompt: string; quickSnap: boolean } | null>(() => {
  const g = gameStore.game.value;
  if (!g || !settings.order66 || !gameStore.isPlaying.value) return null;
  switch (deriveClientState(g, o66Ctx())) {
    case 'HIGH_KICK': return { prompt: 'High Kick — click a player to move under the ball, then Confirm.', quickSnap: false };
    case 'QUICK_SNAP': return { prompt: 'Quick Snap — click a player, then a highlighted square; Confirm when done.', quickSnap: true };
    default: return null;
  }
});
const quickSnapAllowance = computed(() => {
  const allowance = gameStore.state.quickSnapPhase;
  return o66MiniPhase.value?.quickSnap && typeof allowance?.allowed === 'number'
    ? {
        moved: allowance.moved, allowed: allowance.allowed,
        available: allowance.available, remaining: allowance.remaining, exhausted: allowance.exhausted,
      }
    : null;
});
// Suppress the turn-start splash during drive setup and kickoff mini-phases, including kickoff-event blitz.
const KICKOFF_DRIVE_TURN_MODES = new Set(['setup', 'solidDefence', 'kickoff', 'kickoffReturn', 'highKick', 'quickSnap', 'swarming', 'passBlock', 'blitz']);
const inKickoffDrivePhase = computed(() => KICKOFF_DRIVE_TURN_MODES.has(gameStore.game.value?.turnMode ?? ''));
// Quick Snap selects an owned player, highlights upstream-legal adjacent empty squares, and moves via CLIENT_SETUP_PLAYER.
const selectedQuickSnap = ref<string | null>(null);
const quickSnapTargets = ref<{ x: number; y: number; coord: [number, number] }[]>([]);
let quickSnapRaf = 0;
/** Shared controller projection — the very squares the store's send gate would accept (Classic uses the same call). */
function quickSnapValidTargets(): [number, number][] {
  return selectedQuickSnap.value ? gameStore.quickSnapTargets(selectedQuickSnap.value) : [];
}
watch([() => gameStore.state.quickSnapPhase?.seq, selectedQuickSnap], () => {
  cancelAnimationFrame(quickSnapRaf);
  // drop a stale selection (phase gone, or the player left the eligible set)
  if (selectedQuickSnap.value
      && !gameStore.state.quickSnapPhase?.players.some((p) => p.playerId === selectedQuickSnap.value)) {
    selectedQuickSnap.value = null;
  }
  const active = () => !!gameStore.state.quickSnapPhase && !!selectedQuickSnap.value && !!renderer;
  // Renderer owns Quick Snap arrows; invisible DOM markers remain click targets and track camera movement.
  if (!active()) {
    quickSnapTargets.value = [];
    renderer?.setQuickSnapArrows(null, [], 0);
    return;
  }
  const qs = gameStore.state.quickSnapPhase!;
  const selFrom = qs.players.find((p) => p.playerId === selectedQuickSnap.value)?.coord ?? null;
  // #216 QS-5 (Voss renderer `29cca783`): the QS destination crosshairs render in the UI PRIMARY colour, not the
  //   seat body — feed `settings.uiPrimary` ('#RRGGBB') as a 0xRRGGBB number. Clear sites (:3058/:3065) still pass 0.
  renderer!.setQuickSnapArrows(selFrom, quickSnapValidTargets(), parseInt(settings.uiPrimary.slice(1), 16));
  const step = () => {
    if (!active()) { quickSnapTargets.value = []; renderer?.setQuickSnapArrows(null, [], 0); return; }
    quickSnapTargets.value = quickSnapValidTargets()
      .map((c) => { const pos = renderer!.squareToCanvas(c); return pos ? { x: pos.x, y: pos.y, coord: c } : null; })
      .filter((t): t is { x: number; y: number; coord: [number, number] } => t !== null);
    quickSnapRaf = requestAnimationFrame(step);
  };
  step();
});
function pickQuickSnapTarget(coord: [number, number]) {
  if (!selectedQuickSnap.value) return;
  gameStore.sendQuickSnapMove(selectedQuickSnap.value, coord); // ⚖ view-gated move; server echoes + rebuilds quickSnapPhase
  selectedQuickSnap.value = null; // re-select the player to move it again
}

// BB2025 Swarming is setup-shaped upstream, but its dedicated surface has only rolled-count and square legality.
// Owner (this window): give Swarming the SAME drag-from-reserves UX as normal setup — drag an eligible dugout
// token onto a legal square, drag off-pitch/back to the box to remove, tap-select + tap-place kept too. Routed
// through swarmingPlace/swarmingRemove (never setupPlace/setupRemove) via the shared DragMode drag engine above.
const swarmingPhase = computed(() => gameStore.state.swarmingPhase);
const swarmingPlayers = computed(() => (swarmingPhase.value?.players ?? []).filter((player) => player.eligible));
const swarmingReserves = computed(() => swarmingPlayers.value.filter((player) => !player.coord));
const selectedSwarming = ref<string | null>(null);
watch(() => swarmingPhase.value?.seq, () => {
  const sp = swarmingPhase.value;
  if (!sp) {
    selectedSwarming.value = null;
    if (renderer?.onSetupClick === handleSwarmingSetupClick) {
      renderer.setSetup(false, null);
      renderer.onSetupClick = null;
    }
    if (renderer?.onDugoutSetupDragStart === startSwarmingPlayerDrag) renderer.onDugoutSetupDragStart = null;
    return;
  }
  if (selectedSwarming.value
      && !sp.players.some((player) => player.playerId === selectedSwarming.value && player.eligible && !player.coord)) {
    selectedSwarming.value = null;
  }
  if (!renderer) return;
  renderer.setSetup(true, null);
  renderer.onSetupClick = handleSwarmingSetupClick;
  renderer.onDugoutSetupDragStart = startSwarmingPlayerDrag;
});
// Owner (this window): dugout-token halo highlight during Swarming, independent of the setup watch above (which
// keys off selectedSetupPlayerId, always null here) — declared AFTER selectedSwarming to avoid a TDZ read from
// the earlier watch's getter (that watch is invoked immediately on setup).
watch(
  () => setupDrag.value?.playerId ?? selectedSwarming.value,
  (playerId) => { if (swarmingPhase.value) renderer?.setSetupSelectedPlayer(playerId ?? null); },
  { flush: 'sync' },
);
const swarmingDragMode: DragMode = {
  eligible: (playerId) => swarmingPlayers.value.some((player) => player.playerId === playerId),
  placedCoord: (playerId) => swarmingPhase.value?.players.find((player) => player.playerId === playerId)?.coord ?? null,
  legalSquare: (coord) => !!swarmingPhase.value?.legalSquares.some((sq) => sq[0] === coord[0] && sq[1] === coord[1]),
  label: (playerId) => {
    const p = swarmingPhase.value?.players.find((player) => player.playerId === playerId);
    return p ? p.name || p.posName : '';
  },
  place: (playerId, coord) => gameStore.swarmingPlace(playerId, coord),
  remove: (playerId) => gameStore.swarmingRemove(playerId),
  onTap: (playerId) => selectSwarmingPlayer(playerId),
  clearSelection: () => { selectedSwarming.value = null; },
};
function startSwarmingPlayerDrag(playerId: string, clientX: number, clientY: number) {
  startPlayerDrag(swarmingDragMode, playerId, clientX, clientY);
}
function selectSwarmingPlayer(playerId: string) {
  const player = swarmingPlayers.value.find((candidate) => candidate.playerId === playerId);
  if (!player) return;
  if (player.coord) {
    gameStore.swarmingRemove(playerId);
    selectedSwarming.value = null;
    return;
  }
  selectedSwarming.value = selectedSwarming.value === playerId ? null : playerId;
}
// Click (not drag) on a dugout token: any eligible player (placed → remove, reserve → select), same shape as
// setup's handleSetupPlayerTap. A click on an empty pitch square places the currently-selected reserve.
function handleSwarmingSetupClick(coord: [number, number], playerId: string | null) {
  const sp = swarmingPhase.value;
  if (!sp) return;
  if (playerId) {
    if (sp.players.some((player) => player.playerId === playerId && player.eligible)) {
      selectSwarmingPlayer(playerId);
    }
    return;
  }
  const onPitch = coord[0] >= 0 && coord[0] <= 25 && coord[1] >= 0 && coord[1] <= 14;
  if (!onPitch) {
    selectedSwarming.value = null;
    return;
  }
  const selected = selectedSwarming.value;
  if (!selected) return;
  if (!sp.legalSquares.some((square) => square[0] === coord[0] && square[1] === coord[1])) return;
  gameStore.swarmingPlace(selected, coord);
  selectedSwarming.value = null; // the field updates only when the server echoes CLIENT_SETUP_PLAYER
}
// In unconsumed SELECT_BLITZ_TARGET, a floor click may confirm conversion to Move; dismiss sends nothing.
const blitzMoveModalTile = ref<[number, number] | null>(null);
watch(blitzMoveModalTile, () => { reactivePromptDragPos.blitzMove = null; });
function blitzUsedActingSide(g: { homePlaying?: boolean; turnDataHome?: { blitzUsed?: boolean } | null; turnDataAway?: { blitzUsed?: boolean } | null }): boolean {
  return !!(g.homePlaying ? g.turnDataHome?.blitzUsed : g.turnDataAway?.blitzUsed);
}
function acceptBlitzMoveConvert() {
  const tile = blitzMoveModalTile.value; blitzMoveModalTile.value = null;
  if (tile) gameStore.convertBlitzToMove(tile); // ⚖ Tarkin's hook: un-consume (self-target-cancel) → re-declare move → step
}
function dismissBlitzMoveModal() { blitzMoveModalTile.value = null; } // NO wire — blitz stays server-held-pending; coach re-picks the target
// Feed the renderer the authoritative pickup target only while a Move preview approaches a settled ball.
watch([o66PendingMove, () => {
  const fm = gameStore.game.value?.fieldModel as { ballInPlay?: boolean; ballMoving?: boolean; ballCoordinate?: unknown } | undefined;
  return fm ? `${!!fm.ballInPlay}:${!!fm.ballMoving}:${JSON.stringify(fm.ballCoordinate ?? null)}` : '';
}], () => {
  if (!renderer) return;
  const g = gameStore.game.value;
  const fm = g?.fieldModel as { ballInPlay?: boolean; ballMoving?: boolean; ballCoordinate?: unknown } | undefined;
  const actingId = String((g?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  const ballSq = g && fm?.ballInPlay && !fm.ballMoving ? normSquare(fm.ballCoordinate) : null;
  if (g && o66PendingMove.value && ballSq && actingId) renderer.setPickupTarget(ballSq, pickupTargetAtBall(g, actingId) ?? 0);
  else renderer.setPickupTarget(null, 0);
});
// #73 (owner batch §N): push the AUTHORITATIVE foul-armour target to the renderer while a FOUL is pending
//   (o66PendingFoul = the declared down victim). SAME seam as #77: the renderer prefers this over its local
//   foulTarget for the "SKULL n+" chip + hover tip (Voss 80f80885 / Tarkin foulArmourTargetAt 31b298fd+230da1c9).
//   Cleared when no pending foul. ⚖ authoritative target (cited AV + assists/modifiers), never a local guess.
watch([o66PendingFoul, () => gameStore.game.value?.fieldModel], () => {
  if (!renderer) return;
  const g = gameStore.game.value;
  const victimId = o66PendingFoul.value;
  const foulerId = String((g?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  const victimSq = victimId ? playerSquareById(victimId) : null;
  if (g && victimId && foulerId && victimSq) renderer.setFoulTarget(victimSq, foulArmourTargetAt(g, foulerId, victimId) ?? 0);
  else renderer.setFoulTarget(null, 0);
});
// Owner 09-06: PRAYERS TO NUFFLE in effect — a stacked orange tag under each coach corner panel (home bottom-left,
// away bottom-right), one row per active prayer, read straight off turnData.inducementSet.prayers (the server adds
// a prayer at the roll and removes it when its effect ends, so the tag needs no clock of its own).
function activePrayers(side: 'home' | 'away'): { name: string; label: string; icon: string; effect: string }[] {
  const g = gameStore.game.value;
  const td = (side === 'home' ? g?.turnDataHome : g?.turnDataAway) as { inducementSet?: { prayers?: unknown[] } } | undefined;
  const raw = Array.isArray(td?.inducementSet?.prayers) ? td!.inducementSet!.prayers! : [];
  const out: { name: string; label: string; icon: string; effect: string }[] = [];
  for (const v of raw) {
    const e = prayerForWireValue(v);
    // Owner 09-08: the tag shows the short label when the catalog gives one ("Moles"), the full name otherwise.
    if (e && !out.some((o) => o.name === e.name)) out.push({ name: e.name, label: e.tag ?? e.name, icon: e.icon, effect: e.effect });
  }
  return out;
}
const homePrayers = computed(() => activePrayers('home'));
const awayPrayers = computed(() => activePrayers('away'));
// Owner 09-07: the persistent blitz badges (⚡ blitzer / 🎯 target) draw in the RENDERER on the chest row, fed from
// the store's per-turn blitzTokens — under the effects layer so the block-result stamp lands over them.
function pushBlitzTokens() {
  const t = gameStore.state.blitzTokens;
  renderer?.setBlitzTokens(t ? { blitzerId: t.blitzerId, targetId: t.targetId } : null);
}
watch(() => gameStore.state.blitzTokens?.seq, pushBlitzTokens);
// Blitz and Gaze share the acting-token target-declaration prompt.
const o66TargetDeclarePos = ref<{ x: number; y: number } | null>(null);
let targetDeclareRaf = 0;
const targetDeclarePrompt = computed(() => {
  const g = gameStore.game.value;
  if (!g || !settings.order66 || !gameStore.isPlaying.value) return null;
  if (deriveClientState(g, o66Ctx()) === 'SELECT_BLITZ_TARGET') return 'Choose a blitz target';
  return gameStore.hasGazeTargetDeclaration() ? 'Choose a gaze target' : null;
});
function trackTargetDeclaration() {
  cancelAnimationFrame(targetDeclareRaf);
  const step = () => {
    const g = gameStore.game.value;
    const host = pitchHost.value;
    if (!targetDeclarePrompt.value || !g || !renderer || !host) { o66TargetDeclarePos.value = null; return; }
    const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    const sq = normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
      .find((d) => d.playerId === actingId)?.playerCoordinate);
    const p = sq ? renderer.squareToCanvas(sq) : null;
    if (p) o66TargetDeclarePos.value = {
      x: Math.min(Math.max(p.x, 90), Math.max(host.clientWidth - 90, 90)),
      y: Math.max(p.y - 48, 8),
    };
    targetDeclareRaf = requestAnimationFrame(step);
  };
  step();
}
watch(targetDeclarePrompt, (prompt) => {
  if (prompt) {
    trackTargetDeclaration();
  } else { cancelAnimationFrame(targetDeclareRaf); o66TargetDeclarePos.value = null; }
});
// Owner o66aa: the 2-click target CUE for pass / hand-off / foul — 🏈 over a pass/hand-off target, the armour-
// break roll over a foul victim. RAF-follows the camera; shown while a pending target awaits its confirm click.
const o66TargetCue = ref<{ x: number; y: number; label: string; throwRoll?: number } | null>(null);
let targetCueRaf = 0;
const o66ConfirmedPassDestination = computed(() => {
  const g = gameStore.game.value;
  const throwerAction = String(g?.throwerAction ?? '');
  return throwerAction === 'pass' || throwerAction === 'hailMaryPass' ? normSquare(g?.passCoordinate) : null;
});
watch(o66ConfirmedPassDestination, (destination) => {
  if (destination) {
    o66SubmittedPassDestination.value = null;
    gameStore.clearAcceptedPassSubmission();
  }
}, { flush: 'sync' });
const o66SubmittedPassProjection = computed(() => {
  // plannerPlan is intentionally private/imperative; this revision makes watchdog flushes and same-model
  // replacements invalidate the bridge even when no game-model property changed in the same tick.
  void gameStore.state.plannerRevision;
  const g = gameStore.game.value;
  const acting = g?.actingPlayer as { playerId?: string | null; playerAction?: string | null } | undefined;
  return projectSubmittedPassPresentation(o66SubmittedPassDestination.value, {
    playerId: String(acting?.playerId ?? ''),
    playerAction: String(acting?.playerAction ?? ''),
    clientState: g ? deriveClientState(g, o66Ctx()) : '',
    activePlan: gameStore.activePlanIdentity(),
    acceptedSubmission: gameStore.state.acceptedPassSubmission,
  });
});
const o66SubmittedPassSquare = computed(() => o66SubmittedPassProjection.value?.square ?? null);
watch(o66SubmittedPassSquare, (square) => {
  if (!square && o66SubmittedPassDestination.value) {
    if (o66SubmittedPassDestination.value.planSeq !== null) gameStore.clearAcceptedPassSubmission();
    o66SubmittedPassDestination.value = null;
  }
}, { flush: 'sync' });
const o66PassDestination = computed(() => o66ConfirmedPassDestination.value
  ?? o66SubmittedPassSquare.value
  ?? (o66PendingThrowKind.value === 'pass' || o66PendingThrowKind.value === 'throwTeamMate'
    ? o66PendingPass.value : null));

function sendDirectPassWithBridge(square: [number, number]): void {
  const g = gameStore.game.value;
  const acting = g?.actingPlayer as { playerId?: string | null; playerAction?: string | null } | undefined;
  const playerId = String(acting?.playerId ?? '');
  const playerAction = String(acting?.playerAction ?? '');
  const origin = playerId ? playerSquareById(playerId) : null;
  const accepted = gameStore.sendPassTarget(square);
  o66SubmittedPassDestination.value = accepted && playerId && origin && passActionIdentity(playerAction)
    ? { square, origin, playerId, playerAction, planSeq: null }
    : null;
}

function bridgeActivePassPlan(square: [number, number], from: [number, number]): void {
  const plan = gameStore.activePlanIdentity();
  const acting = gameStore.game.value?.actingPlayer as { playerId?: string | null; playerAction?: string | null } | undefined;
  const accepted = gameStore.state.acceptedPassSubmission;
  if (plan?.actKind === 'pass' && passActionIdentity(plan.playerAction)) {
    o66SubmittedPassDestination.value = { square, origin: from, playerId: plan.playerId, playerAction: plan.playerAction, planSeq: plan.seq };
  } else if (accepted && accepted.square[0] === square[0] && accepted.square[1] === square[1]
      && accepted.playerId === String(acting?.playerId ?? '') && passActionIdentity(acting?.playerAction)) {
    // A zero-waypoint/already-declared plan may send and retire synchronously inside startPlan.
    o66SubmittedPassDestination.value = {
      square, origin: from, playerId: accepted.playerId, playerAction: String(acting?.playerAction ?? ''), planSeq: accepted.seq,
    };
  } else {
    o66SubmittedPassDestination.value = null;
  }
}

// A nominated or committed Pass/Bomb/TTM landing drives the authoritative Pass requirement and the
// optional over-target Catch requirement. The committed bridge matters for empty-square passes: nomination clears
// immediately after send, but the Pass N+ cue remains until the server echo owns the destination. Catch stays null
// unless a standing player actually occupies that square. TTM places its Pass requirement on the landing square so
// the held-mate icon and thrower remain unobscured. No renderer-local formula or model-ahead token read.
watch([
  o66PassDestination,
  o66PendingPass,
  o66PendingThrowKind,
  o66PendingMove,
  o66SubmittedPassProjection,
  () => gameStore.game.value?.fieldModel,
], () => {
  if (!renderer) return;
  const g = gameStore.game.value;
  const pendingTo = o66PendingThrowKind.value === 'fireball' ? null : o66PendingPass.value;
  const to = o66PassDestination.value ?? pendingTo;
  const throwerId = String((g?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  const from = o66SubmittedPassProjection.value
    ? o66SubmittedPassProjection.value.origin
    : o66PendingMove.value?.dest ?? (throwerId ? playerSquareById(throwerId) : null);
  const st = g ? deriveClientState(g, o66Ctx()) : '';
  const mode = isThrowMateState(st) ? 'TTM_LANDING'
    : o66PendingThrowKind.value === 'bomb' ? 'BOMB'
      : g && isHailMaryPassAction(g) ? 'HAIL_MARY_PASS' : 'PASS';
  const preview = g && to && throwerId && from
    ? passDestinationRollPreview(g, from, to, throwerId, mode)
    : null;
  // The destination control below owns the throw requirement so it cannot be occluded by a separate ball marker.
  renderer.setThrowRoll(null, 0);
  renderer.setCatchRoll(preview?.catchRoll != null ? preview.targetSquare : null, preview?.catchRoll ?? 0);
  renderer.setPassRevealDP(!!preview);
});
/** o66PathSquares[0] is always the route origin; renderer chips and numbering depend on it. */
function setO66PathFromOrigin(from: [number, number] | null, route: [number, number][], moverId: string) {
  if (!renderer) return;
  if (!from || !route.length) { renderer.setO66Path([], moverId); return; }
  renderer.setO66Path([from, ...route], moverId);
}
function previewLeftClickBlitzRoute(actingId: string, targetId: string): [number, number][] | null {
  const target = playerSquareById(targetId);
  if (!target || !renderer) return null;
  return leftClickBlitzContactRoute({
    target,
    waypointRoute: o66PendingMove.value?.route ?? [],
    directContact: () => renderer?.o66PathToContact(actingId, target) ?? null,
    extendWaypoint: (route, destination) => renderer?.o66ExtendPath(actingId, route, destination) ?? null,
  })?.route ?? null;
}
function playerSquareById(pid: string): [number, number] | null {
  const g = gameStore.game.value;
  return g ? normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
    .find((d) => d.playerId === pid)?.playerCoordinate) : null;
}
function armourTarget(pid: string): string {
  const g = gameStore.game.value;
  const p = g ? [...g.teamHome.playerArray, ...g.teamAway.playerArray].find((pl) => pl.playerId === pid) : null;
  const av = Number((p as { armour?: number } | null)?.armour);
  return Number.isFinite(av) && av > 0 ? `🥾 ${av}+` : '🥾';
}
// Fives lane 08-19: restore the retirement-era stage-1 Blitz bullseye; Block keeps its declared fist cue.
function aggroCueLabel(): string | null {
  const ag = o66AggroStage.value;
  if (!ag) return null;
  const special = selectedAggroBlockKind.value;
  if (special && ag.stage === 2) return `${BLOCK_KIND_EMOJI[special]} ${BLOCK_KIND_LABEL[special]}`;
  const g = gameStore.game.value;
  if (ag.stage === 2 && g && deriveClientState(g, o66Ctx()) === 'BLITZ') return '✊';
  if (ag.kind === 'blitz') return '🎯 Declare Blitz?';
  return ag.stage === 2 ? '✊' : null; // block: fist only once declared
}
watch([o66PassDestination, o66PendingPass, o66PendingThrowKind, o66PendingPunt, o66PendingHandOff, o66PendingFoul, o66PendingGaze, o66AggroStage], () => {
  cancelAnimationFrame(targetCueRaf);
  const step = () => {
    const host = pitchHost.value;
    let sq: [number, number] | null = null;
    let label = o66PendingThrowKind.value === 'fireball' ? '🔥'
      : o66PendingThrowKind.value === 'bomb' ? '💣' : '🏈';
    const agLabel = aggroCueLabel();
    if (o66PendingPunt.value) { sq = o66PendingPunt.value; label = 'Punt scatter preview'; }
    else if (o66PassDestination.value) sq = o66PassDestination.value;
    else if (o66PendingPass.value) sq = o66PendingPass.value;
    else if (o66PendingHandOff.value) sq = playerSquareById(o66PendingHandOff.value);
    else if (o66PendingFoul.value) { sq = playerSquareById(o66PendingFoul.value); label = armourTarget(o66PendingFoul.value); }
    else if (o66PendingGaze.value) { sq = playerSquareById(o66PendingGaze.value); label = '👁'; }
    else if (agLabel && o66AggroStage.value) { sq = playerSquareById(o66AggroStage.value.target); label = agLabel; }
    if (!sq || !renderer || !host) { o66TargetCue.value = null; return; }
    const p = renderer.squareToCanvas(sq);
    const g = gameStore.game.value;
    const clientState = g ? deriveClientState(g, o66Ctx()) : '';
    const throwDestination = !!o66PassDestination.value
      || (!!o66PendingPass.value && o66PendingThrowKind.value !== 'fireball');
    const throwerId = String((g?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    const from = throwerId ? (o66PendingMove.value?.dest ?? playerSquareById(throwerId)) : null;
    const mode = isThrowMateState(clientState) ? 'TTM_LANDING'
      : o66PendingThrowKind.value === 'bomb' ? 'BOMB'
        : g && isHailMaryPassAction(g) ? 'HAIL_MARY_PASS' : 'PASS';
    const preview = g && throwDestination && from && throwerId
      ? passDestinationRollPreview(g, from, sq, throwerId, mode)
      : null;
    // Pass/Bomb/TTM uses one in-square destination control: projectile icon + full Pass requirement.
    if (p) o66TargetCue.value = {
      x: p.x,
      y: throwDestination ? p.y : o66AggroStage.value ? Math.max(p.y - 88, 8) : p.y - 40,
      label,
      throwRoll: preview?.throwRoll,
    };
    targetCueRaf = requestAnimationFrame(step);
  };
  if (o66PassDestination.value || o66PendingPass.value || o66PendingPunt.value || o66PendingHandOff.value || o66PendingFoul.value || o66PendingGaze.value || aggroCueLabel()) step();
  else o66TargetCue.value = null;
});
// Owner ⑩ (08-12) — PASS/BOMB TARGETING TOOLTIP (Fives half of the owner's targeting-surface design; Voss draws
// the crosshair/arrow/in-path visual). While free-select PASS or BOMB is armed, Voss's renderer.onSquareHover feeds
// the hovered square and this surfaces the ROLL REQUIRED there. Throw uses the same PassMechanic for PASS/BOMB
// (bb2025 StepPass.java:173-181,219-228). Catch uses CATCH_ACCURATE_PASS or CATCH_ACCURATE_BOMB according to mode;
// StepResolvePass.java:49-71 is the bomb-mode authority, and bombCatchTargetAt carries the full cited modifier port.
// Field-wide PASS cards are suppressed; this tooltip keeps the same values available at the one square the coach is
// considering, including 2+. HMP keeps its dedicated any-square ruler/nomination surface.
const passBombHoverSq = ref<[number, number] | null>(null);
const passBombHoverTip = ref<{ x: number; y: number; throwRoll: number; catchRoll: number | null } | null>(null);
let passHoverTipRaf = 0;
/*
 * Upstream draws no ruler under HMP (PassLogicModule.java:78-103,138-145;
 * ClientStatePass.java:135-152,211-214); owner W28 override, informational only.
 */
const hailMaryPassRulerCommitted = ref(false);
function hailMaryPassRulerMode(): string {
  const g = gameStore.game.value;
  if (!g || !settings.order66 || !gameStore.isPlaying.value || !isHailMaryPassAction(g)) return '';
  const st = deriveClientState(g, o66Ctx());
  if (st !== 'PASS' && st !== 'BOMB') return '';
  const throwerId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  return throwerId && gameStore.iControl(throwerId) ? throwerId : '';
}
function hailMaryPassRulerFrom(): [number, number] | null {
  const throwerId = hailMaryPassRulerMode();
  if (!throwerId || hailMaryPassRulerCommitted.value) return null;
  return o66PendingMove.value?.dest ?? playerSquareById(throwerId);
}
const hailMaryPassHintVisible = computed(
  () => !!hailMaryPassRulerMode() && !hailMaryPassRulerCommitted.value,
);
watch(hailMaryPassRulerMode, (mode, previous) => {
  if (mode !== previous) hailMaryPassRulerCommitted.value = false;
});
watch(() => {
  const from = hailMaryPassRulerFrom();
  return from ? `${from[0]},${from[1]}` : null;
}, (key) => {
  const coordinate = key?.split(',').map(Number);
  const from: [number, number] | null = coordinate ? [coordinate[0]!, coordinate[1]!] : null;
  passBombHoverSq.value = null;
  renderer?.setPassRuler(from, null);
});
function syncHeldMatePassSurface(): boolean {
  if (!o66ThrownMate.value || !renderer || !gameStore.isPlaying.value) return false;
  const g = gameStore.game.value;
  const actingId = String(g?.actingPlayer?.playerId ?? '');
  const state = g ? deriveClientState(g, o66Ctx()) : '';
  const from = actingId ? playerSquareById(actingId) : null;
  if (!g || !actingId || !from || !gameStore.iControl(actingId) || !isThrowMateState(state)) return false;
  actionMode.value = 'pass';
  return syncTtmPassRailSurface(renderer, {
    actingPlayerId: actingId,
    throwerSquare: from,
    landingSquares: ttmRangeSquares(g, from),
  });
}
watch([
  o66ThrownMate,
  () => String(gameStore.game.value?.actingPlayer?.playerId ?? ''),
  () => {
    const g = gameStore.game.value;
    return g ? deriveClientState(g, o66Ctx()) : '';
  },
], () => { syncHeldMatePassSurface(); }, { flush: 'post' });
function clearHailMaryPassRulerAfterCommit(): void {
  const g = gameStore.game.value;
  if (!g || !isHailMaryPassAction(g)) return;
  hailMaryPassRulerCommitted.value = true;
  passBombHoverSq.value = null;
  renderer?.setPassRuler(null, null);
}
watch(() => {
  const g = gameStore.game.value;
  if (!g || !settings.order66 || !gameStore.isPlaying.value) return '';
  const st = deriveClientState(g, o66Ctx());
  return (st === 'PASS' || st === 'BOMB') && !isHailMaryPassAction(g) ? st : '';
}, (mode) => {
  cancelAnimationFrame(passHoverTipRaf);
  if (!mode) { passBombHoverSq.value = null; passBombHoverTip.value = null; return; }
  const step = () => {
    const g = gameStore.game.value;
    const host = pitchHost.value;
    const hoverSq = passBombHoverSq.value;
    if (g && renderer && host && hoverSq) {
      const throwerId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
      const from = o66PendingMove.value?.dest ?? (throwerId ? playerSquareById(throwerId) : null);
      const preview = from && throwerId
        ? passDestinationRollPreview(g, from, hoverSq, throwerId, mode)
        : null;
      if (!preview) { passBombHoverTip.value = null; }
      else {
        const p = renderer.squareToCanvas(hoverSq);
        if (p) passBombHoverTip.value = {
          x: p.x, y: Math.max(p.y - 52, 8),
          throwRoll: preview.throwRoll,
          catchRoll: preview.catchRoll,
        };
      }
    } else passBombHoverTip.value = null;
    passHoverTipRaf = requestAnimationFrame(step);
  };
  step();
});
onBeforeUnmount(() => cancelAnimationFrame(passHoverTipRaf));
const jumpLeaping = computed(() => !!(gameStore.game.value?.actingPlayer as { leaping?: boolean } | undefined)?.leaping);
// S6: Bounding Leap offer — state whitelist + !leaping + the #431 availability helper, all inside boundingLeapOffer.
const boundingLeapSkillNow = computed(() => {
  const g = gameStore.game.value;
  if (!g || !settings.order66 || !gameStore.isPlaying.value) return null;
  return boundingLeapOffer(g, o66Ctx());
});
// The Jump badge is an enabled-state indicator/off-switch; the right-click menu is the offer.
const jumpVerb = computed(() => {
  const g = gameStore.game.value;
  const actingId = String((g?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (!g || !actingId) return 'Jump';
  return jumpVerbForPlayer(g, actingId);
});
/** ON-state wording for the badge, kept as an explicit map rather than verb+"ing" guessing. */
const JUMP_GERUND: Readonly<Record<string, string>> = { Jump: 'Jumping', Leap: 'Leaping', Pogo: 'Pogoing' };
const jumpGerund = computed(() => JUMP_GERUND[jumpVerb.value] ?? 'Jumping');
const jumpBadgeOn = computed(() => {
  const g = gameStore.game.value;
  if (!g || !settings.order66 || !gameStore.isPlaying.value) return false;
  if (!JUMP_MOVE_STATES.has(deriveClientState(g, o66Ctx()))) return false;
  const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  return !!actingId && jumpLeaping.value;
});
const jumpTogglePos = ref<{ x: number; y: number } | null>(null);
let jumpToggleRaf = 0;
function trackJumpToggle() {
  cancelAnimationFrame(jumpToggleRaf);
  const step = () => {
    const g = gameStore.game.value;
    const host = pitchHost.value;
    if (!jumpBadgeOn.value || !g || !renderer || !host) { jumpTogglePos.value = null; return; }
    const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    const sq = normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
      .find((d) => d.playerId === actingId)?.playerCoordinate);
    const p = sq ? renderer.squareToCanvas(sq) : null;
    if (p) jumpTogglePos.value = {
      x: Math.min(Math.max(p.x, 90), Math.max(host.clientWidth - 90, 90)),
      y: Math.max(p.y - 72, 8),
    };
    jumpToggleRaf = requestAnimationFrame(step);
  };
  step();
}
watch(jumpBadgeOn, (on) => { if (on) trackJumpToggle(); else { cancelAnimationFrame(jumpToggleRaf); jumpTogglePos.value = null; } });

// #236: existing armed-action badge idiom, driven only by the report-correlated model truth above. Upstream has
// no square picker/new state: the mover keeps walking (`StepInitMoving.java:270-278`), and FieldModel leaves the
// ball in the vacated square while ballMoving is true (`FieldModel.java:883-892`). The RAF follows that live mover;
// the model-derived false edge removes it immediately on auto-cancel/activation end.
const fumblerooskiePos = ref<{ x: number; y: number } | null>(null);
let fumblerooskieRaf = 0;
function trackFumblerooskie() {
  cancelAnimationFrame(fumblerooskieRaf);
  const step = () => {
    const g = gameStore.game.value;
    const host = pitchHost.value;
    if (!fumblerooskieActive.value || !g || !renderer || !host) { fumblerooskiePos.value = null; return; }
    const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    const sq = normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
      .find((d) => d.playerId === actingId)?.playerCoordinate);
    const p = sq ? renderer.squareToCanvas(sq) : null;
    if (p) fumblerooskiePos.value = {
      x: Math.min(Math.max(p.x, 90), Math.max(host.clientWidth - 90, 90)),
      y: Math.max(p.y - (jumpBadgeOn.value ? 104 : 72), 8),
    };
    fumblerooskieRaf = requestAnimationFrame(step);
  };
  step();
}
watch(fumblerooskieActive, (on) => {
  if (on) trackFumblerooskie();
  else { cancelAnimationFrame(fumblerooskieRaf); fumblerooskiePos.value = null; }
});
onBeforeUnmount(() => {
  cancelAnimationFrame(jumpToggleRaf);
  cancelAnimationFrame(fumblerooskieRaf);
});

// Render selectable/selected synchronous multi-block rings; the store owns selection and auto-commit.
const multiBlockMarkers = ref<{ x: number; y: number; selected: boolean }[]>([]);
let multiBlockRaf = 0;
watch(() => {
  const g = gameStore.game.value;
  return !!g && settings.order66 && gameStore.isPlaying.value && deriveClientState(g, o66Ctx()) === 'SYNCHRONOUS_MULTI_BLOCK';
}, (active) => {
  cancelAnimationFrame(multiBlockRaf);
  if (!active) { multiBlockMarkers.value = []; return; }
  const step = () => {
    const g = gameStore.game.value;
    if (!g || !renderer) { multiBlockMarkers.value = []; return; }
    const selSquares = (gameStore.state.multiBlockSel?.targets ?? [])
      .map((t) => playerSquareById(t.playerId)).filter((s): s is [number, number] => !!s);
    const isSel = (sq: [number, number]) => selSquares.some((s) => s[0] === sq[0] && s[1] === sq[1]);
    const out: { x: number; y: number; selected: boolean }[] = [];
    for (const dd of (g.fieldModel.diceDecorationArray ?? []) as { coordinate?: [number, number] }[]) {
      const sq = normSquare(dd.coordinate);
      if (!sq) continue;
      const p = renderer!.squareToCanvas(sq);
      if (p) out.push({ x: p.x, y: p.y, selected: isSel(sq) });
    }
    multiBlockMarkers.value = out;
    multiBlockRaf = requestAnimationFrame(step);
  };
  step();
});
onBeforeUnmount(() => cancelAnimationFrame(multiBlockRaf));

// Owner 09-07: Eye Gouge is a renderer chest marker now (addEyeGougeMarker, like the gaze eye); the DOM overlay is retired.
// Clear any pending 2-click target when the activation ends (SELECT_PLAYER) so a cue never lingers into the next.
watch(() => { const g = gameStore.game.value; return g && settings.order66 && gameStore.isPlaying.value ? deriveClientState(g, o66Ctx()) : ''; },
  (st) => {
    if (st === 'SELECT_PLAYER' || st === '') { o66PendingPass.value = null; o66SubmittedPassDestination.value = null; o66PendingPunt.value = null; o66PendingHandOff.value = null; o66PendingFoul.value = null; o66PendingGaze.value = null; o66ThrownMate.value = null; o66PendingBlitzTarget.value = null; o66PendingLeftClickBlitzPlan.value = null; o66AggroStage.value = null; o66PendingBlockKind.value = null; o66PendingBlitzBlockKind.value = null; o66ExplicitBlockChoice.value = null; passTemplateForced.value = false; /* T-9 (#338): no menu-flavor mark survives the activation; #250: the forced pass template clears too */ endActConfirm.value = null; /* #12/#231: dismiss a stale end-activation confirm when the activation ends */ }
    // Auto-arm the range template for owned PASS/BOMB states; Bomb uses the same template and its own sender.
    else if (st === 'PASS' || st === 'BOMB') {
      const actingId = String((gameStore.game.value?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
      if (actingId && gameStore.iControl(actingId)) o66ArmPassTemplate(actingId);
    }
  });
// At a plain Block/Blitz nominate stage, surface the block-dice preview over the target. A selected special attack
// uses BlockAttackConfirmModal instead; both retire from the same aggro stage.
watch(o66AggroStage, (st) => {
  if (!renderer) return;
  const actingId = String((gameStore.game.value?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  // #3/#4 (owner batch #3, 2026-07-14): the o66 block-dice preview surfaces ONLY at the CONFIRM
  // step (stage 2 = "Confirm Block"), not at nominate (stage 1). This single stage-gated path also
  // fixes the first-block miss — the old nominate-time previewBlock no-opped when the renderer had
  // no selectedPlayerId. Computed dice values are unchanged (Echo's R1 drift-guard stays green).
  if (st && st.stage === 2 && actingId && !selectedAggroBlockKind.value) renderer.showBlockTargets(actingId, st.target);
  else renderer.showBlockTargets(null);
});
// B4-2: movement style applies live
watch(
  () => settings.moveStyle,
  (style) => {
    if (renderer) renderer.moveStyle = style;
  },
);
// Owner 2026-07-15: movement SPEED (ms/tile) applies live
watch(
  () => settings.moveSpeedMs,
  (ms) => { renderer?.setMoveStepMs(ms); },
);
watch(
  () => [gameStore.isPlaying.value, gameStore.replay.active] as const,
  ([playing, replayActive]) => renderer?.setPresentationMode(replayActive ? 'replay' : playing ? 'live' : 'spectator'),
  { immediate: true },
);

const presentationCssVars = computed<Record<string, string>>(() => {
  void gameStore.isPlaying.value;
  void gameStore.replay.active;
  const ms = (base: number) => `${presentationMs(base)}ms`;
  return {
    '--p-90': ms(90), '--p-150': ms(150), '--p-200': ms(200), '--p-240': ms(240),
    '--p-260': ms(260), '--p-280': ms(280), '--p-300': ms(300), '--p-350': ms(350),
    '--p-400': ms(400), '--p-450': ms(450), '--p-500': ms(500), '--p-550': ms(550),
    '--p-900': ms(900), '--p-950': ms(950), '--p-1000': ms(1000), '--p-1200': ms(1200),
    '--p-1600': ms(1600), '--p-1800': ms(1800), '--p-2000': ms(2000), '--p-2400': ms(2400), '--p-2500': ms(2500),
    '--p-3000': ms(3000), '--p-3200': ms(3200), '--p-3800': ms(3800),
    '--p-5600': ms(5600), '--p-6200': ms(6200), '--p-6400': ms(6400),
  };
});
// Owner 2026-07-04: path-trail colour applies live
watch(() => settings.trailColor, (c) => { if (renderer) renderer.trailColorMode = c; });
watch(() => settings.trailMarks, (m) => { if (renderer) renderer.trailMarkStyle = m; });

// B8-8: pitch orientation applies live
watch(
  () => settings.pitchOrientation,
  (o) => renderer?.setPitchOrientation(o),
);

// B9-2: shared live-play-adopted active-player signal. The
// track/nudge is part of Auto Director (owner 2026-07-03) — it keeps the acting
// player in view (at any zoom) while the cinematics zoom to the action.
watch(
  () => gameStore.state.activePlayerId,
  (id, previousId) => {
    if (!renderer) return;
    renderer.setActivePlayer(id);
    // game_818: renderer selection is a separate, click-owned presentation mirror. Retire the
    // just-ended actor's selection when the server-derived active id clears; otherwise its gold
    // selection halo survives until another player click even though actingPlayer.playerId is null.
    // Matching previousId preserves unrelated inspect selections and every in-progress activation.
    if (!id && previousId && renderer.getSelectedPlayerId() === previousId) renderer.clearSelection();
    // Owner 2026-07-13 (feature 1): show the configured tackle zones while MY player is selected/active in o66
    // play — on SELECT, decoupled from arming the move overlay. renderer.activePlayerId tracks the acting player
    // on BOTH turns, so the my-side gate (isPlaying + myTurn) lives here where the viewer's side is known.
    renderer.o66OppTzActive = settings.order66 && gameStore.isPlaying.value && gameStore.myTurn.value && !!id;
    if (id && settings.autoDirector && !gameStore.playbackCatchingUp.value) renderer.focusActivePlayer();
  },
);

// spec-220 F-2/M-4: the renderer reaches the apex after KICK_FLYIN_MS; keep its
// Math.max-additive dwell through the bounded kickoff cine beat. Both durations come
// from the renderer's shared kick-chain source of truth.
watch(
  () => gameStore.state.kickoffCine,
  (cine) => {
    // W8: FIFO cine now surfaces after landing, falsifying the old "cine overlaps apex" premise; never re-arm a settled arc.
    const guard = kickoffCineHoldGuard(kickoffArcSettled, 'unchanged');
    if (cine && gameStore.state.kickoffArcNeedsDecisionDwell && guard.mayHold && renderer && !gameStore.playbackCatchingUp.value) {
      renderer.holdBallKickIn(presentationMs(KICKOFF_CINE_MS));
    }
  },
);

// Owner 2026-07-04: players who've acted this turn → grey rings (white = still to act).
watch(
  () => gameStore.state.actedPlayers,
  (ids) => renderer?.setActedPlayers(ids ?? []),
  { deep: true },
);
// Owner 09-06: a join/rejoin snapshot tick re-derived the store, but the renderer outlives the socket and its
// setters early-return on equal values — push the derived state again and rebuild the tokens/overlays now.
watch(() => gameStore.state.snapshotEpoch, async () => {
  await nextTick();
  if (!renderer) return;
  renderer.setActivePlayer(gameStore.state.activePlayerId);
  renderer.setActedPlayers(gameStore.state.actedPlayers ?? []);
  renderer.refresh();
});
// Owner 2026-07-14 (#10 part 2): the store's "recovering" latch → the renderer keeps the stun X on those players.
watch(
  () => gameStore.state.recoveringPlayers,
  (ids) => renderer?.setRecoveringPlayers(ids ?? []),
  { deep: true },
);

// Owner 2026-07-03: Auto Director master toggle → the renderer (gates cinematicZoom).
watch(() => settings.autoDirector, (on) => renderer?.setAutoDirectorEnabled(on));
// Historical replay catch-up applies snapshots much faster than their original
// presentation cadence. Keep camera authority entirely passive until the paced
// replay/live tail resumes; the renderer restarts from its current camera without a snap.
watch(
  () => gameStore.playbackCatchingUp.value,
  (catchingUp) => renderer?.setAutoDirectorSuspended(catchingUp),
  { immediate: true },
);
watch(() => settings.showPlayerNumbers, (on) => { if (renderer) { renderer.showPlayerNumbers = on; renderer.refresh(); } });

// F-2: video options apply live
watch(
  () => [settings.renderScale, settings.fpsCap],
  () => renderer?.setVideoOptions({ renderScale: settings.renderScale, fpsCap: settings.fpsCap }),
);

// Owner: brightness/gamma slider applies live
watch(
  () => settings.brightness,
  (value) => renderer?.setBrightness(value),
);

// Owner 2026-07-06: opt into the deprecated active-player gold echo (default off).
watch(
  () => settings.activePlayerEcho,
  (on) => renderer?.setActivePlayerEcho(on),
);

// UI-6 + owner 2026-07-03 r6f: recompute skill icons + markings when the per-skill
// config, the FUMBBL JSON, or the game changes.
function applyMarkings() {
  if (!renderer) return;
  // B2-17: icons XOR markings — the renderer shows exactly one system
  renderer.showSkillIcons = settings.skillDisplay === 'icons';
  renderer.setSkillIconStyle(effectiveIconStyle.value); // compatibility signature; snapshot owns the pack
  void renderer.setBundledSkillBadgeFamily(settings.skillBadgeFamily); // owner 09-09: "Illustrated - Default" (no-op when unchanged)
  renderer.actionDecorationStyle = settings.actionDecorations; // owner 09-06: artwork | emoji
  // owner 2026-07-03 r6f: per-group render position (over head / at feet)
  renderer.iconPosition = settings.iconPosition;
  renderer.markerPosition = settings.markerPosition;
  const game = gameStore.game.value;
  if (!game) {
    renderer.setPlayerIconSkills(null);
    renderer.setPlayerMarkings(new Map());
    return;
  }
  // Icons: the per-skill config (MY TEAM / OPPOSITION behaviour + baseline) decides
  // which badges show — always applied so switching to icons mode is correct.
  renderer.setPlayerIconSkills(computeIconSkills(game));
  // Markings: the per-skill MARKER config if the user opted a skill in, else the
  // FUMBBL auto-marking JSON (backward compatible), else none.
  if (settings.skillDisplay !== 'markings') {
    renderer.setPlayerMarkings(new Map());
    return;
  }
  if (anyMarkerConfigured()) {
    renderer.setPlayerMarkings(computeConfigMarkings(game));
    return;
  }
  const raw = settings.markingsConfig.trim();
  if (!raw) {
    renderer.setPlayerMarkings(new Map());
    return;
  }
  try {
    const config = JSON.parse(raw) as AutoMarkingConfig;
    renderer.setPlayerMarkings(generateAllMarkings(game, config));
  } catch (err) {
    // Don't silently blank all markings — surface WHY (a malformed JSON or a bad
    // record) so a config problem is diagnosable instead of "markings just stopped".
    console.warn('[markings] failed to generate from markingsConfig — markings off:', err);
    renderer.setPlayerMarkings(new Map());
  }
}
watch(
  () => [settings.markingsConfig, settings.skillDisplay, effectiveIconStyle.value, settings.iconPosition, settings.markerPosition, settings.skillBadgeFamily],
  () => applyMarkings(),
);
watch(() => settings.skillConfig, () => applyMarkings(), { deep: true });
watch(gameStore.game, () => applyMarkings());
watchAssetModRendererRefresh(() => {
  const choice = gameStore.state.skillChoice;
  const ids = [popup.visible ? popup.playerId : null, choice?.playerId ?? null].filter((id): id is string => !!id);
  const portraits = refreshAssetRendererSurfaces(renderer, ids);
  if (popup.visible && popup.playerId) portrait.value = portraits.get(popup.playerId) ?? null;
  if (choice) skillSilhouette.value = portraits.get(choice.playerId) ?? null;
});

// B7-5: sweet-spot team logos on the pitch, refreshed when the game changes — and (owner 09-05) whenever the
// installed packs' team-logo bindings change, so a pack install/remove/reassignment hot-swaps them in place.
function pushSweetSpotLogos(g: typeof gameStore.game.value): void {
  if (!renderer) return;
  // Owner 2026-09-04: the bundled per-race crest stands in when the server sends no logo.
  const logo = (team: { race?: string; roster: { logoUrl?: string } } | undefined, side: CrestSide) =>
    fumbblAsset(team?.roster?.logoUrl) ?? crestDataUrl(team?.race, side);
  void renderer.setSweetSpotLogos(logo(g?.teamHome, 'home'), logo(g?.teamAway, 'away'));
}
watch(
  gameStore.game,
  (g) => {
    pushSweetSpotLogos(g);
    refreshSeatTint(); // #157: seat colours resolve per game/theme — re-read them here (same hook, renderer ready)
  },
  { immediate: true },
);
watch(() => assetMods.logoRevision, () => pushSweetSpotLogos(gameStore.game.value));

/**
 * Player card (owner 2026-07-02): docked bottom-right — portrait of the
 * player as rendered on the pitch, stat column on the left, skill icons
 * across the bottom with bloodbowlbase.ru description tooltips.
 */
const popup = reactive({
  visible: false,
  playerId: '',
});
const portrait = ref<string | null>(null);
const playerCardEl = ref<HTMLElement | null>(null);

// Owner: the player card is MOVABLE (drag its name bar OR the top-left grip) and
// RESIZABLE via a TOP-RIGHT handle (owner 2026-07-03 — CSS `resize:both` only
// gives a bottom-right handle, so the resize is hand-rolled). A dragged position
// overrides the docked TOP-right default; a resize overrides the CSS size.
const cardPos = ref<{ x: number; y: number } | null>(null);
const cardSize = ref<{ w: number; h: number } | null>(null);
const cardDodgePos = ref<{ x: number; y: number } | null>(null);
const cardDockPos = ref<{ x: number; y: number } | null>(null);
let playerCardDodgeRaf = 0;
const cardStyle = computed(() => {
  const style: Record<string, string> = {};
  const placed = cardPos.value ?? cardDodgePos.value;
  if (placed) {
    style.left = `${placed.x}px`;
    style.top = `${placed.y}px`;
    style.right = 'auto';
    style.bottom = 'auto';
    style.transform = 'none'; // drop the default vertical-centre translate
  } else {
    // Owner 09-06: default dock = bottom-left, sitting on the quick bar with right edges aligned.
    style.top = 'auto';
    style.transform = 'none';
    style.bottom = `${telestratorBottom.value}px`;
    style.right = `${Math.max(14, quickBarRight.value ?? 14)}px`;
  }
  if (cardSize.value) {
    style.width = `${cardSize.value.w}px`;
    style.height = `${cardSize.value.h}px`;
  }
  return style;
});

// FIX 18: keep the docked portrait clear of the live acting token via the existing bounds-dodge seam.
watch(() => [popup.visible, popup.playerId] as const, async () => {
  cancelAnimationFrame(playerCardDodgeRaf);
  cardDodgePos.value = null;
  cardDockPos.value = null;
  if (!popup.visible) return;
  await nextTick();
  const host = pitchHost.value;
  const card = playerCardEl.value;
  if (!host || !card) return;
  const hr = host.getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  cardDockPos.value = { x: cr.left - hr.left, y: cr.top - hr.top };
  const follow = () => {
    if (!popup.visible || !playerCardEl.value || !pitchHost.value) return;
    // A deliberate user drag is authoritative; dodge only the default right-side dock.
    if (cardPos.value) {
      cardDodgePos.value = null;
      playerCardDodgeRaf = requestAnimationFrame(follow);
      return;
    }
    const g = gameStore.game.value;
    const actingId = String((g?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    const avoid = actingId ? playerTokenAvoidRect(actingId) : null;
    const box = playerCardEl.value.getBoundingClientRect();
    const base = cardDockPos.value;
    if (base) {
      const placed = reRollPromptScreenPosition(base, {
        width: pitchHost.value.clientWidth,
        height: pitchHost.value.clientHeight,
      }, { avoid, card: { width: box.width, height: box.height, dx: 0, dy: 0 } });
      cardDodgePos.value = placed.x === base.x && placed.y === base.y ? null : placed;
    }
    playerCardDodgeRaf = requestAnimationFrame(follow);
  };
  follow();
});
onBeforeUnmount(() => cancelAnimationFrame(playerCardDodgeRaf));
function startCardDrag(event: PointerEvent) {
  const card = (event.currentTarget as HTMLElement).closest('.player-card') as HTMLElement | null;
  const host = pitchHost.value;
  if (!card || !host) return;
  event.preventDefault();
  const rect = card.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const dx = event.clientX - rect.left;
  const dy = event.clientY - rect.top;
  const move = (ev: PointerEvent) => {
    cardPos.value = {
      x: Math.max(0, Math.min(ev.clientX - hostRect.left - dx, hostRect.width - 120)),
      y: Math.max(0, Math.min(ev.clientY - hostRect.top - dy, hostRect.height - 60)),
    };
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
/** Owner 2026-07-03: TOP-RIGHT resize handle. Anchors the card's BOTTOM-LEFT
 *  corner (a north-east drag), so dragging right widens and dragging up grows it
 *  taller — the top edge follows the cursor. Converts the CSS-docked default to
 *  an explicit left/top anchor so the math is stable wherever the card sits. */
function startCardResize(event: PointerEvent) {
  const card = (event.currentTarget as HTMLElement).closest('.player-card') as HTMLElement | null;
  const host = pitchHost.value;
  if (!card || !host) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = card.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const left = rect.left - hostRect.left; // fixed left edge
  const bottom = rect.bottom - hostRect.top; // fixed bottom edge
  const startX = event.clientX;
  const startY = event.clientY;
  const startW = rect.width;
  const startH = rect.height;
  const MIN_W = 154;
  const MIN_H = 84;
  const move = (ev: PointerEvent) => {
    const w = Math.max(MIN_W, Math.min(startW + (ev.clientX - startX), host.clientWidth - left - 4));
    const h = Math.max(MIN_H, Math.min(startH - (ev.clientY - startY), bottom - 4));
    cardSize.value = { w, h };
    cardPos.value = { x: left, y: bottom - h };
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
const SKILL_DESCRIPTIONS = skillDescriptions as Record<string, string>;

// Owner 2026-07-04: the skill-DESCRIPTION half of the hover tooltip is
// DEPRECATED — the hover still names the skill (icons are cryptic without it),
// but the rules text stays hidden. The lookup code + skillDescriptions.json are
// kept in the base code. Now under SailThe7Seas control: a "-arrrr" launch sets
// SKILL_DESC_TOOLTIPS_ENABLED = true at application launch.
const SKILL_DESC_TOOLTIPS_ENABLED = computed(() => sevenSeas.SKILL_DESC_TOOLTIPS_ENABLED);

function skillDescription(skill: string): string {
  // wire names vary in spacing/case ("Sure Hands" vs "SureHands")
  const normalized = skill.toLowerCase().replace(/[^a-z]/g, '');
  for (const [name, text] of Object.entries(SKILL_DESCRIPTIONS)) {
    if (name.toLowerCase().replace(/[^a-z]/g, '') === normalized) return text;
  }
  return 'No description available.';
}

// Resolve a player + their team side by id (shared by the popup card and the selected-player portrait).
function playerSideById(playerId: string | null | undefined): { player: PlayerJson; side: 'home' | 'away' } | null {
  const game = gameStore.game.value;
  if (!game || !playerId) return null;
  const home = game.teamHome.playerArray.find((p) => p.playerId === playerId);
  if (home) return { player: home, side: 'home' };
  const away = game.teamAway.playerArray.find((p) => p.playerId === playerId);
  return away ? { player: away, side: 'away' } : null;
}
// Race-prefixed position name (dedupes when the position already bakes in the race).
/** Owner 09-05: the send-off surfaces (prompt + waiting modal) show the player's position under the name. */
const sendOffPositionName = computed(() => { const e = playerSideById(gameStore.state.sendOff?.playerId); return e ? positionNameFor(e) : ''; });
const sendOffWaitingPositionName = computed(() => { const e = playerSideById(gameStore.state.sendOffWaiting?.playerId); return e ? positionNameFor(e) : ''; });
function positionNameFor(entry: { player: PlayerJson; side: 'home' | 'away' }): string {
  const game = gameStore.game.value;
  if (!game) return '';
  const team = entry.side === 'home' ? game.teamHome : game.teamAway;
  const roster = team.roster as { positionArray?: { positionId: string; positionName?: string }[] };
  const rawPosition =
    roster.positionArray?.find((p) => p.positionId === entry.player.positionId)?.positionName ??
    entry.player.positionId.split('.').pop() ??
    '';
  // Owner 09-09: the POSITIONAL only — no race prefix ("Tomb Kings Tomb Guardian" -> "Tomb Guardian"), matching
  // the MVP roster; stripped even when the roster's own positionName carries it.
  const race = (team as { race?: string }).race?.trim();
  const startsWithRace = !!race && rawPosition.toLowerCase().startsWith(race.toLowerCase() + ' ');
  return startsWithRace ? rawPosition.slice(race!.length + 1).trim() || rawPosition : rawPosition;
}
const popupPlayer = computed<{ player: PlayerJson; side: 'home' | 'away' } | null>(() => playerSideById(popup.playerId));

const popupInfo = computed(() => {
  const entry = popupPlayer.value;
  const game = gameStore.game.value;
  if (!entry || !game) return null;
  const { player, side } = entry;
  const team = side === 'home' ? game.teamHome : game.teamAway;
  // owner 2026-07-03 r5 / 07-08: race-prefixed position, deduped — now via the shared positionNameFor helper.
  const positionName = positionNameFor(entry);
  const results =
    side === 'home' ? game.gameResult.teamResultHome.playerResults : game.gameResult.teamResultAway.playerResults;
  const playerResult = results.find((r) => r.playerId === player.playerId);
  const spp = (playerResult?.currentSpps as number | undefined) ?? 0;
  // Owner 08-17: base/roster SPP alone hid in-match earnings (a casualty-scoring
  // Rotspawn still read "SPP 0"); show the match-earned delta as a green "+N" chip.
  const sppEarned = playerResult
    ? sppEarnedThisGame(playerResult as unknown as Record<string, unknown>, (team as { specialRules?: string[] }).specialRules)
    : 0;
  // Stat reductions (owner 2026-07-02): the wire stats already carry the
  // reduced values (the server applies lasting injuries before serializing),
  // so a stat named in lastingInjuries renders RED at its current value.
  const reduced = (tag: string) => player.lastingInjuries.some((i) => i.includes(`(-${tag})`));
  // Owner 2026-07-04: an IMPROVED characteristic (advancement) shows GREEN — the
  // reverse of the red reduction. Compare the current stat to the position's base;
  // AG/PA improve when the target DROPS, MA/ST/AV when the value RISES.
  const pos = (team.roster as { positionArray?: Array<{ positionId: string; movement?: number; strength?: number; agility?: number; passing?: number; armour?: number }> })
    .positionArray?.find((p) => p.positionId === player.positionId);
  const effMa = effectiveMovement(player);
  const effAv = effectiveArmour(player);
  const better = (cur: number | undefined, base: number | undefined, lowerBetter: boolean): boolean => {
    if (cur == null || base == null || !Number.isFinite(base) || !Number.isFinite(cur)) return false;
    return lowerBetter ? cur < base : cur > base;
  };
  // Owner 2026-07-08: is the player ACTIVELY on the field right now? (drives injury-text
  // clearing — an apothecary-reversed casualty leaves a stale string on an on-pitch player.)
  const pdata = game.fieldModel.playerDataArray.find((d) => d.playerId === player.playerId);
  const onPitchNow = pdata ? rendersOnPitch(pdata.playerState) : false;
  return {
    name: player.playerName,
    nr: player.playerNr,
    positionName,
    teamName: team.teamName,
    side,
    // BB2025 statline: AG/PA/AV are roll targets ("3+"); PA can be absent.
    // EFFECTIVE stats (Player.get*WithModifiers, Player.java:225-243): the base roster stat plus the temporary
    // modifiers a prayer/card granted — Iron Man's +1 AV and Greasy Cleats' -1 MA must READ on the card, and a
    // temporary change colours the same way an advancement/injury does. Base roster stats stay untouched.
    stats: [
      { label: 'MA', value: String(effMa), reduced: reduced('MA') || effMa < player.movement, increased: better(effMa, pos?.movement, false) },
      { label: 'ST', value: String(player.strength), reduced: reduced('ST'), increased: better(player.strength, pos?.strength, false) },
      { label: 'AG', value: `${player.agility}+`, reduced: reduced('AG'), increased: better(player.agility, pos?.agility, true) },
      { label: 'PA', value: player.passing ? `${player.passing}+` : '–', reduced: reduced('PA'), increased: better(player.passing, pos?.passing, true) },
      { label: 'AV', value: `${effAv}+`, reduced: reduced('AV') || effAv < player.armour, increased: better(effAv, pos?.armour, false) },
    ],
    // Preserve the raw key for icons/rules text while the shared Modern/Classic
    // projection labels valued temporary Hatred as e.g. `Hatred (Orc)`.
    skills: playerDetailSkills(player),
    spp,
    sppEarned,
    // Owner 2026-07-08: current location/injury status (KO'd / Badly Hurt / Seriously Hurt /
    // Dead / Sent off / Reserves) — shown on the card so a DUGOUT player's injury reads.
    status: playerState(player),
    // non-stat injuries only (NI/MNG); stat reductions show as red stats.
    // Owner 2026-07-08: an ON-PITCH player can't currently be Badly/Seriously Hurt or Dead —
    // if such a casualty string lingers while they're actively playing, the injury was
    // cleared/reversed (apothecary), so it's STALE and hidden. Permanent injuries (Niggling
    // "(NI)", stat losses) still show. `rendersOnPitch` = the same active-on-field test the
    // status label uses.
    injuries: [
      ...player.lastingInjuries.filter(
        (i) => !/\(-(MA|ST|AG|PA|AV)\)/.test(i) && !(onPitchNow && /\(mng\)|\(rip\)|badly hurt|seriously hurt|\bdead\b|killed/i.test(i)),
      ),
      ...(player.recoveringInjury && !onPitchNow ? [`Recovering: ${player.recoveringInjury}`] : []),
    ],
  };
});

function showPopup(playerId: string) {
  popup.playerId = playerId;
  popup.visible = true;
  portrait.value = renderer?.playerPortrait(playerId) ?? null;
}

// Owner ruling 08-17: the ROSTER tab's Home/Away buttons carry the actual team names — truncate
// long names so the two buttons stay unambiguous side-by-side; full name is the button's title.
function rosterTabLabel(teamName: string | undefined | null): string {
  const name = (teamName ?? '').trim();
  if (!name) return 'Team';
  return name.length > 14 ? `${name.slice(0, 13)}…` : name;
}

// Owner ruling 08-17 (+08-18): clicking a roster row surfaces the card (same showPopup(playerId)
// path a pitch-token click uses) AND drops the bouncing yellow arrow over the token wherever it
// rendered — on-pitch OR the KO/CAS/reserves dugout box (the renderer resolves the anchor).
function onRosterRowClick(playerId: string) {
  showPopup(playerId);
  renderer?.showRosterAttentionCue(playerId);
}

// Owner 08-19: clicking a PLAYER NAME in the log locates the player — the SAME cue call the
// roster rows use (pulse + bouncing arrow, pitch OR dugout anchor). Arrow ONLY per the owner's
// words: no player card from log clicks. Names without a resolved id never get here (inert).
function onLogNameClick(playerId?: string) {
  if (playerId) renderer?.showRosterAttentionCue(playerId);
}
// Owner 09-08: DOUBLE-clicking a log player name moves the camera onto that player (pitch square or dugout box);
// the single-click cue still fires underneath, so the arrow marks the token the camera lands on.
function onLogNameDblClick(playerId?: string) {
  if (playerId) renderer?.focusOnPlayer(playerId);
}

// The arrow is a transient cue tied to the open card: it clears whenever the card closes or
// another selection takes over the popup, same lifecycle the card itself already follows.
watch(() => popup.visible, (visible) => { if (!visible) renderer?.clearRosterAttentionCue(); });

/**
 * O8 confirm gate: a queued path never executes on its own — the user
 * confirms via this button or its Enter hotkey. Execution is demo-only until
 * M4 wires real client commands.
 */
const queuedSteps = ref(0);

function confirmMove() {
  // Owner 2026-07-04c: an armed foul/handoff/pass — the confirm button commits
  // the WHOLE action (path + wire), per "the confirm button should behave as
  // expected here and confirm any action that is currently planned".
  if (renderer?.hasArmedAction()) {
    renderer.confirmArmedAction();
    return;
  }
  if (!renderer || queuedSteps.value === 0) return;
  const playerId = renderer.getSelectedPlayerId();
  const path = renderer.getPlannedPath();
  const label = plannedAction.value ?? undefined;
  if (!playerId || path.length === 0) return;
  renderer.clearSelection();
  // Live is authoritative; the synthetic branch is developer/demo tooling only.
  if (gameStore.isPlaying.value) gameStore.playerMove(playerId, path as [number, number][]);
  else gameStore.demoMovePlayer(playerId, path, label);
}

const hasSelection = ref(false);

/**
 * Right-click context menus (owner 2026-07-02): opposition players offer
 * actions against them (Special submenu on hover); own players offer
 * activation declarations; downed players offer Jump Over.
 */
interface MenuItem {
  label: string;
  kind?: 'action' | 'toggle';
  disabled?: boolean;
  endActivation?: boolean;
  hint?: string;
  action?: () => void;
  children?: MenuItem[];
  /** #6 (owner ruling 08-17): resolved skill-icon URL rendered inline next to the label (Jump Up on Move only).
   *  Generic slot — populated only where availableActions supplies CoachAction.icon. */
  icon?: string;
}
const ctxMenu = reactive({ visible: false, x: 0, y: 0, items: [] as MenuItem[], playerId: '' });
/** Action chosen from a menu, carried into the planner + Confirm button label. */
const plannedAction = ref<string | null>(null);

const SPECIAL_ACTION_SKILLS = [
  'hypnoticgaze', 'projectilevomit', 'stab', 'chainsaw', 'bombardier', 'breathefire',
  'throwteammate', 'kickteammate', 'multipleblock', 'lookintomyeyes',
];

function specialsOf(playerId: string): string[] {
  const game = gameStore.game.value;
  if (!game) return [];
  const player = [...game.teamHome.playerArray, ...game.teamAway.playerArray].find((p) => p.playerId === playerId);
  return (player?.skillArray ?? []).filter((s) =>
    SPECIAL_ACTION_SKILLS.includes(s.toLowerCase().replace(/[^a-z]/g, '')),
  );
}

/** Read star named rules from skillArray for informational display; Throw Keg is wired and single-block-die reroll remains parked. */
function isStar(playerId: string): boolean {
  const game = gameStore.game.value;
  if (!game) return false;
  const p = [...game.teamHome.playerArray, ...game.teamAway.playerArray]
    .find((pl) => pl.playerId === playerId) as { playerType?: string } | undefined;
  return p?.playerType === 'Star';
}
function starRulesOf(playerId: string): string[] {
  const game = gameStore.game.value;
  if (!game || !isStar(playerId)) return [];
  const player = [...game.teamHome.playerArray, ...game.teamAway.playerArray].find((p) => p.playerId === playerId);
  return player?.skillArray ?? [];
}

function adjacentToPathEnd(square: [number, number]): boolean {
  const end = renderer?.getPathEnd();
  if (!end) return false;
  return Math.max(Math.abs(end[0] - square[0]), Math.abs(end[1] - square[1])) === 1;
}

// ---- ORDER 66 (A.2): flag-gated action menu (surface ③) ----------------------------------------------
/** The client-state context: mode + login + the local coach's TRUE side (myTeamIsHome, resolved by coach
 *  match — the owner's perspective correction). Feeds deriveClientState/availableActions via the router. */
function o66Ctx(): ClientStateContext {
  return {
    mode: 'player', loggedIn: true, myIsHome: gameStore.myTeamIsHome.value ?? true,
    friendlyPlayerSwitch: settings.friendlyPlayerSwitch,
  };
}
// Action locking is enforced at sendCommand; the view only renders lock status.
const actionLock = computed(() => {
  const g = gameStore.game.value;
  if (!g || !settings.order66 || !gameStore.isPlaying.value) return null;
  const lock = actionSurfaceLock(g, o66Ctx());
  return lock.locked ? lock : null;
});

// Owner 08-20: one client-owned activation-menu election, evaluated only AFTER the received model carries the
// exact acting player + PlayerAction. This replaces the four post-activation first-match cards above and the
// target-click Blitz auto-offer below. It enumerates every eligible property-map row in upstream order. Choosing
// one sends only its skill command; the coach resumes the already-declared action after the server sequence.
const wideRailActivationPrompt = ref<{
  key: string;
  seq: number;
  playerId: string;
  playerAction: string;
  targetId?: string;
  options: WideRailActivationOption[];
} | null>(null);
let wideRailAnsweredKey = '';
let wideRailLastGameId = '';
type WideRailOwnedContext = {
  gameId: string; half: number | undefined; turn: number | undefined; playerId: string; playerAction: string;
};
let wideRailOwnedContext: WideRailOwnedContext | null = null;
function sameWideRailContext(a: WideRailOwnedContext, b: WideRailOwnedContext): boolean {
  return a.gameId === b.gameId && a.half === b.half && a.turn === b.turn
    && a.playerId === b.playerId && a.playerAction === b.playerAction;
}
watch(
  [gameStore.game, gameStore.isPlaying, gameStore.myTurn, o66PendingBlitzTarget],
  ([g]) => {
    if (!g || !gameStore.isPlaying.value || !gameStore.myTurn.value) {
      wideRailActivationPrompt.value = null;
      return;
    }
    // Stand Up wide-rail elections are staged before the terminal standUp wire, so their locally owned
    // correlation can exist while the authoritative ActingPlayer is still empty.
    const election = gameStore.wideRailActivationElection(o66PendingBlitzTarget.value ?? undefined);
    const playerId = election?.playerId ?? String(g.actingPlayer?.playerId ?? '');
    const playerAction = election?.playerAction ?? String(g.actingPlayer?.playerAction ?? '');
    const gameId = String((g as { gameId?: string | number }).gameId ?? '');
    if (gameId !== wideRailLastGameId) {
      wideRailLastGameId = gameId;
      wideRailAnsweredKey = '';
      wideRailOwnedContext = null;
    }
    if (!playerId || !playerAction || !gameStore.iControl(playerId)) {
      wideRailActivationPrompt.value = null;
      wideRailOwnedContext = null;
      return;
    }
    const turn = g.homePlaying ? g.turnDataHome?.turnNr : g.turnDataAway?.turnNr;
    const context = { gameId, half: g.half, turn, playerId, playerAction };
    if (wideRailOwnedContext && !sameWideRailContext(wideRailOwnedContext, context)) wideRailOwnedContext = null;
    if (!election) {
      wideRailActivationPrompt.value = null;
      return;
    }
    const key = `${gameId}:${g.half}:${turn}:${election.seq}:${election.targetId ?? ''}`;
    wideRailOwnedContext = context;
    if (key === wideRailAnsweredKey) {
      wideRailActivationPrompt.value = null;
      return;
    }
    wideRailActivationPrompt.value = { key, ...election };
  },
  { deep: true, flush: 'sync', immediate: true },
);
function acceptWideRailActivationRule(ruleId: WideRailPreActionRuleId) {
  const prompt = wideRailActivationPrompt.value;
  if (!prompt || !prompt.options.some((option) => option.ruleId === ruleId)) return;
  const accepted = gameStore.useWideRailActivationRule(ruleId, prompt.playerId, prompt.playerAction, prompt.seq);
  if (!accepted) return;
  wideRailAnsweredKey = prompt.key;
  wideRailActivationPrompt.value = null;
  if (prompt.targetId) {
    o66PendingBlitzTarget.value = null;
    if (wideRailPreActionRule(ruleId).commitsHeldBlitzTarget) gameStore.sendTargetSelected(prompt.targetId);
  }
}
function declineWideRailActivationRules() {
  const prompt = wideRailActivationPrompt.value;
  if (!prompt) return;
  wideRailAnsweredKey = prompt.key;
  wideRailActivationPrompt.value = null;
  gameStore.dismissWideRailActivationRules(prompt.playerId, prompt.playerAction, prompt.seq);
  if (prompt.targetId) {
    o66PendingBlitzTarget.value = null;
    gameStore.sendTargetSelected(prompt.targetId);
  }
}

/** Escape/right-click backs out of the held target without consuming the skill or the Blitz election. */
function cancelWideRailBlitzTarget() {
  const prompt = wideRailActivationPrompt.value;
  if (!prompt?.targetId) return false;
  wideRailActivationPrompt.value = null;
  o66PendingBlitzTarget.value = null;
  return true;
}

// The declared-state action rows remain available for reconnect parity, where no local declaration correlation
// exists. During a locally owned election (including after Continue), suppress those legacy direct senders so a
// stale/open context menu cannot race or undo the single unified decision.
const WIDE_RAIL_LEGACY_ACTIONS = new Set([
  'raidingParty', 'catchOfTheDay', 'frenziedRush', 'slashingNails', 'blackInk', 'wisdom',
  'starUseSkill', 'incorporeal', 'illCarryYou',
]);
function currentWideRailContext(): WideRailOwnedContext | null {
  const g = gameStore.game.value;
  if (!g) return null;
  const playerId = String(g.actingPlayer?.playerId ?? '');
  const playerAction = String(g.actingPlayer?.playerAction ?? '');
  if (!playerId || !playerAction) return null;
  const gameId = String((g as { gameId?: string | number }).gameId ?? '');
  const turn = g.homePlaying ? g.turnDataHome?.turnNr : g.turnDataAway?.turnNr;
  return { gameId, half: g.half, turn, playerId, playerAction };
}
function localWideRailElectionOwnsAction(action: CoachAction): boolean {
  if (!WIDE_RAIL_LEGACY_ACTIONS.has(action.action)) return false;
  const context = currentWideRailContext();
  return !!wideRailActivationPrompt.value
    || (!!context && !!wideRailOwnedContext && sameWideRailContext(context, wideRailOwnedContext));
}
function withoutOwnedWideRailLegacyRows(actions: readonly CoachAction[]): CoachAction[] {
  return actions.filter((action) => !localWideRailElectionOwnsAction(action));
}

// The Modern left-click Blitz shortcut carries its confirmed target across the declaration echo. If the exact
// received activation has a real wide-rail election, that choice owns the target until Use/Continue; a carrier
// with no currently offered option falls through instead of wedging on its skill list alone.
watch([gameStore.game, o66PendingBlitzTarget], ([g, defenderId]) => {
  if (!g || !defenderId || wideRailActivationPrompt.value
      || deriveClientState(g, o66Ctx()) !== 'SELECT_BLITZ_TARGET') return;
  const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (!actingId || (hasWideRailActivationRule(g, actingId) && gameStore.wideRailActivationElection(defenderId))) return;
  o66PendingBlitzTarget.value = null;
  gameStore.sendTargetSelected(defenderId);
}, { deep: true, flush: 'sync' });

// The confirming click owns the route before any wire leaves. Target selection and special elections remain
// server-paced; once the received state is the declared Blitz movement rail, start the stored route with no
// third target click.
watch([gameStore.game, o66PendingLeftClickBlitzPlan], ([g, plan]) => {
  if (!g || !plan || deriveClientState(g, o66Ctx()) !== 'BLITZ') return;
  const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (actingId !== plan.playerId || !gameStore.iControl(actingId)) return;
  if (gameStore.startPlan({ playerId: plan.playerId, actKind: 'blitz', route: plan.route, targetPlayerId: plan.targetId })) {
    o66PendingLeftClickBlitzPlan.value = null;
    o66PendingMove.value = null;
    renderer?.setO66Path([]);
  }
}, { deep: true, flush: 'post' });

// Focus an owned off-turn prompt when it arms; never focus spectator/opponent prompts.
const offTurnPromptActive = computed(() =>
  !!actionLock.value && actionLock.value.permitted.includes('answerOwnDialog'));
/** Use type+target only as a prompt-change detector; repeated identical dialogs are not distinct instances. */
const promptIdentity = computed(() => {
  const dp = gameStore.game.value?.dialogParameter as { dialogId?: unknown; playerId?: unknown } | null | undefined;
  return dp ? `${String(dp.dialogId ?? '')}:${String(dp.playerId ?? '')}` : '';
});
/** Reactive-prompt cards in PRIORITY order — scanned one family at a time. A single grouped `querySelector('.a, .b')`
 *  would return the first match in TREE order, not the first family, so the priority the name implies would be a
 *  fiction the next maintainer trusts (Kallus N-1: doc-vs-code). */
const PROMPT_SELECTORS = ['.skill-choice', '.reroll-menu', '.injury-gate', '.block-partial', '.yesno-card'];
function livePromptCard(): HTMLElement | null {
  for (const sel of PROMPT_SELECTORS) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) return el;
  }
  return null;
}
const PROMPT_FRONT_CLASS = 'prompt-front';
function clearPromptFront() {
  for (const el of Array.from(document.querySelectorAll(`.${PROMPT_FRONT_CLASS}`))) {
    el.classList.remove(PROMPT_FRONT_CLASS);
  }
}
// Keyed on [active, identity] so a prompt SWAP re-fires even when the boolean never dips false (N-2).
watch([offTurnPromptActive, promptIdentity], ([on]) => {
  if (!on) { clearPromptFront(); return; }
  void nextTick(() => {
    if (!offTurnPromptActive.value) return;         // armed and gone within the tick
    const card = livePromptCard();
    if (!card) return;                              // ⇐ the ownership gate; see the INVARIANT above
    clearPromptFront();
    card.classList.add(PROMPT_FRONT_CLASS);         // bring-to-front half
    const active = document.activeElement as HTMLElement | null;
    const typing = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    if (typing) return;                             // guard: never yank focus out of the chat box
    const btn = card.querySelector('button:not([disabled])') as HTMLElement | null;
    // keyboard-focus half. A prompt with no button (a pick-list) falls back to the card, which needs a tabindex
    // first — focus() on a plain div is a SILENT no-op, so without this the fallback would look wired and do nothing.
    if (!btn && card.tabIndex < 0 && !card.hasAttribute('tabindex')) card.tabIndex = -1;
    (btn ?? card).focus({ preventScroll: true });
  });
});
onBeforeUnmount(clearPromptFront);
// #230: `actionLockCopy` (the visual pill's text) is removed with the pill; the functional `actionLock`
// gate (above) stays — "Opponent's Turn" now reads off the End Turn button.
/** Execute a chosen menu action against the store senders (declare / end-move). */
function runO66Action(a: CoachAction, playerId: string) {
  if (localWideRailElectionOwnsAction(a)) { ctxMenu.visible = false; return; }
  // #236: Fumblerooski is not a PlayerAction declare: upstream MoveLogicModule.java:133-136 routes the pick to
  // sendUseFumblerooskie(), so intercept it before the generic CLIENT_ACTING_PLAYER declare path.
  if (a.action === 'fumblerooskie') {
    gameStore.useFumblerooskie();
  } else if (a.action === 'raidingParty') {
    gameStore.useRaidingParty();
  } else if (a.action === 'catchOfTheDay') {
    gameStore.useCatchOfTheDay();
  } else if (a.action === 'frenziedRush') {
    gameStore.useFrenziedRush();
  } else if (a.action === 'slashingNails') {
    gameStore.useSlashingNails();
  } else if (a.action === 'blackInk') {
    gameStore.useBlackInk();
  } else if (a.action === 'wisdom') {
    gameStore.useWisdom();
  } else if (a.action === 'starUseSkill' && a.ruleId) {
    // Canonical declared-state/reconnect row. Fresh wide-rail carriers reach the same skill only through the
    // locally correlated declaration election; no selected-player payload may synthesize declaration + skill.
    gameStore.useStarSkill(a.ruleId, true);
  } else if (a.action === 'incorporeal') {
    // S9: the store derives true/false from the latest received enhancement source.
    gameStore.toggleIncorporeal();
  } else if (a.action === 'toggleHailMaryPass') {
    gameStore.toggleHailMaryPass();
  } else if (a.action === 'jump') {
    gameStore.chooseJump(playerId);
  } else if (a.kind === 'declare') {
    // A.3: a Block declare remembers its flavor (plain block → null) so the clientBlock at target-click carries
    // the right flag; cleared on any non-block declare.
    o66PendingBlockKind.value = a.action === 'block' ? (a.blockKind ?? null) : null;
    // T-9 (#338): this declare is a RIGHT-CLICK-MENU pick, so a Block here is an EXPLICIT flavor choice (incl. plain
    // Block as {kind:null}) → mark it so the commit skips the chooser. Any non-block declare clears the marker.
    o66ExplicitBlockChoice.value = a.action === 'block' ? { kind: a.blockKind ?? null } : null;
    if (a.action === 'gazeMove') gameStore.declareGazeIntent(playerId);
    else gameStore.declareAction(playerId, a.action);
  } else if (a.kind === 'endMove') {
    endActivationFromMenu();
  }
  // #57 (owner-confirmed deprecation): the 'endTurn' menu branch was DEAD — availableActions never
  // emits kind:'endTurn' and End Turn shouldn't be a context-menu item. Removed here; Tarkin drops the
  // vestigial 'endTurn' from CoachActionKind (availableActions) in the paired commit-window.
  ctxMenu.visible = false;
}

function o66ActionMenuItems(actions: CoachAction[], playerId: string, _refresh: () => void): MenuItem[] {
  return actions.map((a) => {
    const { label: presentedLabel, useIcon } = jumpUpMenuPresentation(a.icon, a.label, settings.skillDisplay);
    const icon = useIcon ? (skillIconUrl(a.icon!, effectiveIconStyle.value) ?? undefined) : undefined;
    return {
      label: presentedLabel,
      kind: 'action',
      disabled: !a.enabled,
      endActivation: a.kind === 'endMove',
      icon,
      action: a.kind === 'endMove' ? endActivationFromMenu : () => runO66Action(a, playerId),
    };
  });
}
/** Clear every UN-declared ORDER 66 planner arm (route/target previews + aggro stage) — pure client state, NO
 *  wire. Shared by the #48 Esc cascade (step 1) and right-click-empty (both are client-side cancels of a preview). */
function clearTtmTargetingSurface() {
  o66ThrownMate.value = null;
  o66PendingPass.value = null;
  o66PendingThrowKind.value = null;
  passBombHoverSq.value = null;
  // The shared pass chart temporarily puts the renderer in legacy Pass mode with the thrower selected. TTM then
  // hands authority to the thrown player (notably StepSwoop's cardinal choice). Leaving either owner alive lets
  // the next player click arm the unrelated legacy "Throw the pass?" card over the Swoop surface. Retire the
  // renderer-owned action/card together with the Order-66 targeting refs before the authoritative hand-off.
  actionModal.value = null;
  actionTip.visible = false;
  renderer?.cancelArmedAction();
  renderer?.clearSelection();
  setAction('auto');
  renderer?.setPassRuler(null, null);
  renderer?.setPassTemplateMaxRange(null);
  renderer?.setTilePick(false);
  renderer?.setO66PassRolls(null);
}
function clearO66Arms() {
  if (o66PendingMove.value) { o66PendingMove.value = null; renderer?.setO66Path([]); }
  o66PendingPass.value = null; o66PendingThrowKind.value = null; o66PendingPunt.value = null; o66PendingHandOff.value = null; o66PendingFoul.value = null;
  if (o66PendingGaze.value) gameStore.clearGazeVictim();
  o66PendingGaze.value = null; clearTtmTargetingSurface(); o66PendingBlitzTarget.value = null; o66PendingLeftClickBlitzPlan.value = null;
  o66PendingBlock.value = null; o66AggroStage.value = null; o66PendingBlitzBlockKind.value = null;
  o66InspectedOpponent.value = null;
  o66ExplicitBlockChoice.value = null; // T-9 (#338): drop a stale menu-flavor mark when a preview is cancelled
}

// R3: every context-menu activation end owns the same planner cleanup and guarded wire path.
function endActivationFromMenu() {
  clearO66Arms();
  gameStore.cancelPlan();
  ctxMenu.visible = false;
  requestEndActivation();
}

const pendingFriendlyLeftClickMenu = ref<{ playerId: string; x: number; y: number } | null>(null);
function showFriendlyLeftClickMenu(playerId: string, x: number, y: number): boolean {
  const g = gameStore.game.value;
  if (!g || !gameStore.iControl(playerId)) return false;
  const actions = availableActions(g, o66Ctx(), playerId);
  const items = o66ActionMenuItems(withoutOwnedWideRailLegacyRows(actions), playerId, () => {});
  if (items.length === 0) items.push({ label: 'No actions available', disabled: true });
  placeCtxMenu(items, x, y, playerId);
  showPopup(playerId);
  return true;
}
watch(() => String((gameStore.game.value?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? ''), (actingId) => {
  const pending = pendingFriendlyLeftClickMenu.value;
  if (!pending || actingId) return;
  pendingFriendlyLeftClickMenu.value = null;
  showFriendlyLeftClickMenu(pending.playerId, pending.x, pending.y);
}, { flush: 'post' });

/** Server-owned held-mate identity. This restores an unfinished TTM selector after a reconnect without guessing
 * legality, and stays null once the throw begins because the PICKED_UP state is removed authoritatively. */
function serverHeldThrowMateId(): string | null {
  const g = gameStore.game.value;
  if (!g || !isThrowMateState(deriveClientState(g, o66Ctx()))) return null;
  const thrownId = String((g as { defenderId?: unknown }).defenderId ?? '');
  if (!thrownId) return null;
  const data = (g.fieldModel.playerDataArray as { playerId: string; playerState?: number }[])
    .find((entry) => entry.playerId === thrownId);
  return ((data?.playerState ?? 0) & 0xff) === 0x10 ? thrownId : null;
}

watch([
  () => ttmActivationKey(gameStore.game.value),
  () => serverHeldThrowMateId(),
], ([activationKey, heldId]) => {
  if (!activationKey) {
    ttmCancelledActivationKeys.clear();
    ttmCommittedActivationKeys.clear();
    if (o66ThrownMate.value || o66PendingThrowKind.value === 'throwTeamMate') clearTtmTargetingSurface();
    return;
  }
  for (const key of [...ttmCancelledActivationKeys]) if (key !== activationKey) ttmCancelledActivationKeys.delete(key);
  for (const key of [...ttmCommittedActivationKeys]) if (key !== activationKey) ttmCommittedActivationKeys.delete(key);
  if (heldId && !ttmCancelledActivationKeys.has(activationKey) && !ttmCommittedActivationKeys.has(activationKey)) {
    o66ThrownMate.value = heldId;
    o66PendingThrowKind.value = 'throwTeamMate';
  }
}, { flush: 'sync', immediate: true });

// Report terminal, explicit reconnect/reset, and received TurnEnd are the only broad TTM rail boundaries. Ordinary
// authoritative frames must leave the committed latch intact while the projectile/landing chain is still running.
useTtmPassRailBoundaries({
  terminalSeq: () => gameStore.state.ttmRailTerminal?.seq,
  resetSeq: () => gameStore.state.ttmRailResetSeq,
  turnEndSeq: () => gameStore.state.moveTrailClearSeq,
  activationKey: () => ttmActivationKey(gameStore.game.value),
  ttmActive: () => {
    const g = gameStore.game.value;
    return !!g && isThrowMateState(deriveClientState(g, o66Ctx()));
  },
  hasLocalSurface: () => !!(o66ThrownMate.value || o66PendingThrowKind.value === 'throwTeamMate'
    || gameStore.state.ttmHeld || gameStore.state.throwAnim?.kind === 'throwTeamMate'),
  isPlaying: () => gameStore.isPlaying.value,
  heldMateId: serverHeldThrowMateId,
  cancelledKeys: ttmCancelledActivationKeys,
  committedKeys: ttmCommittedActivationKeys,
  clearSurface: clearTtmTargetingSurface,
  restoreHeldMate(playerId) {
    o66ThrownMate.value = playerId;
    o66PendingThrowKind.value = 'throwTeamMate';
  },
});
/** Position + show the ctx-menu host at (x,y), clamped inside the pitch host (same placement math the openO66Menu
 *  / #111 / blitz-special menus use). Extracted so #128 Case B and openO66Menu share one placement. */
function placeCtxMenu(items: MenuItem[], x: number, y: number, playerId = '') {
  const host = pitchHost.value!;
  const menuH = items.length * 18 + 8;
  const BOTTOM_SAFE = 72;
  ctxMenu.x = Math.min(Math.max(x, 4), Math.max(host.clientWidth - 130, 4));
  const maxDownY = host.clientHeight - menuH - BOTTOM_SAFE;
  ctxMenu.y = y <= maxDownY ? Math.max(y, 4) : Math.max(4, y - menuH);
  ctxMenu.items = items;
  ctxMenu.playerId = playerId;
  ctxMenu.visible = true;
}

/** Surface the wide-rail declaration warning once for this explicit fresh-menu-open gesture. */
function showWideRailAvailabilityNotice(
  g: GameJson,
  playerId: string,
  actions: readonly CoachAction[],
  x: number,
  y: number,
) {
  const text = wideRailAvailabilityNotice(g, playerId, {
    isPlaying: gameStore.isPlaying.value,
    myTurn: gameStore.myTurn.value,
    controlsPlayer: gameStore.iControl(playerId),
    freshActionMenu: deriveClientState(g, o66Ctx()) === 'SELECT_PLAYER',
    hasDeclarableAction: actions.some((action) => action.kind === 'declare' && action.enabled),
  });
  if (text) showToast(text, x, y, 3600);
}
// #6 owner ruling 08-17 (revised same day; refined 08-17b): Jump Up shows inline on the Move row, as the skill
// ICON (availableActions.ts CoachAction.icon) in icon-capable skillDisplay modes — the earlier top-right
// ctx-passives glyph badge is removed (MENU_PASSIVE_SKILLS had exactly one entry, 'Jump Up', so nothing else
// used that slot). In TEXT mode (settings.skillDisplay === 'markings', no icon glyphs to reuse) it falls back
// to the "Jump Up Move" text prefix instead (see openO66Menu below).
/** Owner o66r: FUMBBL-client behaviour — for a passer AT REST that has declared Pass, "Show pass template"
 *  surfaces the throwing-RANGE template (amber rings) + the walk reach, so a click on a range square throws.
 *  Arms the same overlay the PASS watch does, but on demand from the context menu. */
function o66ArmPassTemplate(actingId: string) {
  const g = gameStore.game.value;
  if (!renderer || !g) return;
  renderer.selectPlayer(actingId);
  const hailMaryPass = isHailMaryPassAction(g);
  const st = deriveClientState(g, o66Ctx());
  renderer.setPassTemplateMaxRange(null);
  // Arming a pass/bomb template must also set the matching action mode so the renderer draws it.
  setAction(st === 'BOMB' ? 'bomb' : 'pass');
  const reach = renderer.o66Reach(actingId);
  const from = normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
    .find((d) => d.playerId === actingId)?.playerCoordinate);
  // Owner 08-12: no range template while a declared Pass is walking (passMove); it arms at targeting.
  // g870: `reach` is the measured walk budget — an empty one is the AT-REST arm (passTemplateAllowed's 4th term).
  const extra = from && (hailMaryPass || st === 'BOMB' || passTemplateAllowed(reach?.squares.length ?? 0)) ? passRangeSquares(g, from) : null;
  renderer.setTilePick(true, hailMaryPass ? null : (reach?.squares ?? []), 'order66-move', hailMaryPass ? null : (reach?.rush ?? []), extra);
  renderer.setO66MoveRolls(null);
  const passRolls = !hailMaryPass && from && (st === 'PASS' || st === 'BOMB')
    ? throwRollSurface(g, from, actingId, st, gameStore.state.freeSelectPass)
    : null;
  // Also clears any stale ordinary-pass cards on menu re-arm/reconnect without touching range eligibility.
  renderer.setO66PassRolls(passRolls);
}
/** R3/R4: assemble the acting-player rows (availableActions rows for MOVE/blitz-confirm, router endMove, blitz flavors,
 *  Show pass template, Throw Pass, Bounding Leap) as pure data — no UI placed, no callback run. Shared by openO66Menu
 *  and the openContextMenu disposition (spec-pass-rail-rightclick-menu v3). */
function assembleActingPlayerRows(target: ContextTarget, x: number, y: number): MenuItem[] {
  const g = gameStore.game.value;
  if (!g) return [];
  const actingNow = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  const stateNow = deriveClientState(g, o66Ctx());
  const ix = target.playerId === actingNow && (stateNow === 'MOVE' || requiresBlitzEndConfirmation(stateNow))
    ? { kind: 'openActionMenu' as const, playerId: target.playerId, actions: availableActions(g, o66Ctx(), target.playerId) }
    : o66PlayerClick(g, o66Ctx(), target.playerId, (pid) => gameStore.iControl(pid));
  const items: MenuItem[] = [];
  if (ix.kind === 'openActionMenu') {
    items.push(...o66ActionMenuItems(
      withoutOwnedWideRailLegacyRows(ix.actions),
      ix.playerId,
      () => openO66Menu(target, x, y),
    ));
  } else if (ix.kind === 'endMove') {
    items.push({ label: 'End Activation', endActivation: true, action: endActivationFromMenu });
  }
  {
    const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    // Declared Blitz: flavor pick (Stab/Chainsaw/…) only arms the flagged CLIENT_BLOCK terminal; never a redeclare.
    if (target.playerId === actingId && deriveClientState(g, o66Ctx()) === 'BLITZ') {
      const kinds: BlockKind[] = blockAlternativeOffers(g, actingId).map((offer) => offer.kind);
      if (chompAvailable(g, actingId)) kinds.push('chomp');
      for (const kind of [...new Set(kinds)].reverse()) {
        items.unshift({
          label: `${o66PendingBlitzBlockKind.value === kind ? '✓ ' : ''}${BLOCK_KIND_LABEL[kind]}`,
          action: () => {
            o66PendingBlitzBlockKind.value = kind;
            o66ExplicitBlockChoice.value = { kind };
            ctxMenu.visible = false;
          },
        });
      }
    }
    if (deriveClientState(g, o66Ctx()) === 'PASS' && !isHailMaryPassAction(g) && target.playerId === actingId) {
      // Owner o66r: FUMBBL-client behaviour — a declared passer gets "Show pass template" (throw from rest).
      items.unshift({ label: 'Show pass template', action: () => { passTemplateForced.value = true; o66ArmPassTemplate(actingId); ctxMenu.visible = false; } }); // #250 case ②
    }
    // #252 (owner-fg 07-29): "Throw Pass" arms free-select on the declared passer (Tarkin R-1 a3fca567).
    if (canFreeSelectPass(g, o66Ctx()) && target.playerId === actingId) {
      items.unshift({ label: 'Throw Pass', action: () => { gameStore.armFreeSelectPass(); ctxMenu.visible = false; } });
    }
    // S6: Bounding Leap on every upstream Jump-legal movement state; exact CLIENT_USE_SKILL.
    if (target.playerId === actingId && boundingLeapSkillNow.value) {
      items.unshift({
        label: 'Bounding Leap',
        action: () => { gameStore.useBoundingLeap(); ctxMenu.visible = false; },
      });
    }
    // R3: router, mapped, and fallback sources normalize to one marked cancellation row.
    if (target.playerId === actingId && !items.some((item) => item.endActivation)) {
      items.push({ label: 'End Activation', endActivation: true, action: endActivationFromMenu });
    }
  }
  return items;
}

/** Build + show the action menu from availableActions via the router. */
function openO66Menu(target: ContextTarget, x: number, y: number) {
  const g = gameStore.game.value;
  if (!g) return;
  // Owner o66s #11: a player that has ALREADY ACTIVATED this turn surfaces NO context menu — ignore the click
  // (it can't act again). The acting player itself is exempt (it's mid-activation, not "done").
  const actingNow = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (target.playerId && target.playerId !== actingNow && gameStore.iControl(target.playerId)
      && gameStore.state.actedPlayers.includes(target.playerId)) {
    ctxMenu.visible = false;
    return;
  }
  // An already-declared Block/Blitz owns the opposition target's context menu. Choosing an attack flavor is
  // presentation-only: the next left click nominates/previews and the following click emits the existing
  // clientBlock flags. This deliberately does not send or consume the action from the context-menu click.
  {
    const attackState = deriveClientState(g, o66Ctx());
    const targetIsAdjacentEnemy = !!target.playerId && !!actingNow && !gameStore.iControl(target.playerId)
      && adjacentStandingEnemyIds(g, actingNow).includes(target.playerId);
    if ((attackState === 'BLOCK' || attackState === 'BLITZ') && targetIsAdjacentEnemy) {
      const kinds: BlockKind[] = blockAlternativeOffers(g, actingNow).map((offer) => offer.kind);
      if (chompAvailable(g, actingNow)) kinds.push('chomp');
      const currentKind = attackState === 'BLITZ' ? o66PendingBlitzBlockKind.value : o66PendingBlockKind.value;
      const pick = (kind: BlockKind | null) => {
        if (attackState === 'BLITZ') o66PendingBlitzBlockKind.value = kind;
        else o66PendingBlockKind.value = kind;
        o66ExplicitBlockChoice.value = { kind };
        o66AggroStage.value = null;
        ctxMenu.visible = false;
      };
      const attacks: MenuItem[] = [
        { label: (currentKind === null ? '✓ ' : '') + 'Block', action: () => pick(null) },
        ...[...new Set(kinds)].map((kind): MenuItem => ({
          label: (currentKind === kind ? '✓ ' : '') + BLOCK_KIND_LABEL[kind],
          action: () => pick(kind),
        })),
      ];
      placeCtxMenu(attacks, x, y, target.playerId);
      return;
    }
  }
  const items = assembleActingPlayerRows(target, x, y);
  // R1: the disabled placeholder is presentation-only and never participates in disposition.
  if (items.length === 0) items.push({ label: 'No actions available', disabled: true });
  placeCtxMenu(items, x, y, target.playerId);
  showWideRailAvailabilityNotice(g, target.playerId, availableActions(g, o66Ctx(), target.playerId), x, y);
}

function openContextMenu(target: ContextTarget, x: number, y: number) {
  const selectedToken = !!target.playerId && renderer?.getSelectedPlayerId() === target.playerId;
  const contextGame = gameStore.game.value;
  const actingId = String((contextGame?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  const controlledActingTarget = !!actingId && target.playerId === actingId && gameStore.iControl(actingId);
  const rows = controlledActingTarget ? assembleActingPlayerRows(target, x, y) : [];
  const disposition = selectedActingRightClick(rows, contextGame ? deriveClientState(contextGame, o66Ctx()) : '');
  // Drift backstop: Pixi normally consumes an open plotted route before hit-testing and calls
  // onWaypointPlanCancel. If the view owns a route before its overlay reaches Pixi, the same right-click still
  // cancels the plan and cannot become a player/pitch context-menu gesture.
  // R4.2: menu-bound acting-player clicks retain the pre-09-01 plotted-route cancellation.
  if ((o66PendingMove.value?.route.length ?? 0) > 0
      && (controlledActingTarget ? disposition === 'menu' : !selectedToken)) {
    clearO66Arms();
    ctxMenu.visible = false;
    return;
  }
  const boardPick = gameStore.state.playerPick;
  const boardPickUndo = boardPick?.key.startsWith('pchoice:dwarfenWisdom:')
    || boardPick?.key.startsWith('pchoice:knuckleDusters:')
    || boardPick?.key.startsWith('pchoice:ironMan:')
    || boardPick?.key.startsWith('pchoice:blessedStatueOfNuffle:')
    || boardPick?.key.startsWith('pchoice:furiousOutburst:');
  if (boardPickUndo && boardPick!.picked.length > 0) {
    gameStore.undoLastPlayerPick();
    ctxMenu.visible = false;
    return;
  }
  // StepInitBlocking accepts CLIENT_ACTING_PLAYER{null} while waiting for Fury's
  // optional second target. Consume right-click here so it cannot also open a menu.
  if (furySecondBlockTargeting.value) {
    gameStore.endActivation();
    ctxMenu.visible = false;
    return;
  }
  // FIX 15: a dialog owns the gesture; never let right-click reach the end-activation fall-through.
  if (gameStore.interactiveDecisionSurfaceOpen()) return;
  // #310 / #48 / Meero SR-235: the blitz-special election card and the end-turn warning are each the single
  // armed prompt while up, so right-click declines through the same path as "Go back" and consumes the gesture
  // before any context-menu or deeper right-click semantics. Card ordering: blitzSpecial checked FIRST (SR-235
  // newest-armed-wins — it can only ever be armed alongside a target click mid-SELECT_BLITZ_TARGET).
  if (wideRailActivationPrompt.value) {
    if (!cancelWideRailBlitzTarget()) declineWideRailActivationRules();
    return;
  }
  if (endTurnWarnCount.value !== null) { cancelEndTurnWarn(); return; }
  // Owner 08-19: right-click cancels a pending setup placement.
  if (setupPhase.value && selectedSetupPlayerId.value !== null) {
    selectedSetupPlayerId.value = null;
    ctxMenu.visible = false;
    return;
  }
  if (!renderer) return;
  const r = renderer;
  const items: MenuItem[] = [];
  const selectedId = r.getSelectedPlayerId();

  // #134 (owner): in SPECTATE / non-play mode, a right-click closes the open player portrait AND de-selects the
  // player in ONE gesture — no menu (the legacy action menu is useless to a spectator). ⚠ SCOPE GUARD (load-bearing):
  // gated on !isPlaying so it can NEVER shadow the o66 PLAY right-click meanings — the #111 flavor-menu (on a target)
  // and the #48 secondary-cancel (on empty) both live below and are isPlaying-gated. Mirrors the Esc-cascade deselect.
  if (!gameStore.isPlaying.value) {
    r.clearSelection();
    popup.visible = false;
    return;
  }

  // Owner 2026-07-09 (C1 — ownership/turn gate): in PLAY mode, the non-acting coach must not be
  // offered activation/planning (they could select an opponent's player or act off-turn → the client
  // sent illegal commands). When it's not my turn, show a read-only status menu like a spectator. The
  // store's iControlPlayer backstop refuses any command regardless; this keeps the UI honest.
  if (gameStore.isPlaying.value && !gameStore.myTurn.value) {
    if (!target.playerId) {
      ctxMenu.visible = false;
      return;
    }
    ctxMenu.x = Math.min(Math.max(x, 4), Math.max((pitchHost.value?.clientWidth ?? 300) - 130, 4));
    ctxMenu.y = Math.max(y, 4);
    ctxMenu.items = [{ label: "Opponent's turn — spectating", disabled: true }];
    ctxMenu.visible = true;
    return;
  }

  // While Blitz flavor selection is held, right-click offers plain Block plus server-offered alternatives; selection resumes commit.
  if (settings.order66 && gameStore.isPlaying.value) {
    if (selectedToken && gameStore.iControl(target.playerId)) {
      if (controlledActingTarget) {
        // R4.4: dispatch the cached pure rows; only cancellation performs cleanup or sends.
        if (disposition === 'cancel') {
          endActivationFromMenu();
          return;
        }
        placeCtxMenu(rows, x, y, target.playerId);
        if (contextGame) {
          showWideRailAvailabilityNotice(
            contextGame, target.playerId, availableActions(contextGame, o66Ctx(), target.playerId), x, y,
          );
        }
        return;
      }
      // R5: a selected owned non-actor falls through to the existing context-menu routing.
    }
    // Owner o66ap #1: a RIGHT-CLICK on EMPTY space is CONTEXTUAL — if a plan is in progress (waypoints / any
    // pending 2-click target), CLEAR it and keep the player selected (so they can re-plan). If NOTHING is planned,
    // DESELECT the player. A right-click ON a player still opens the action menu; left-click re-plans (onTilePick).
    if (!target.playerId) {
      const gRc = gameStore.game.value;
      const ttmKey = ttmActivationKey(gRc);
      const actingId = String((gRc?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
      const ttmCancel = ttmCancellationDecision({
        isPlaying: gameStore.isPlaying.value,
        myTurn: gameStore.myTurn.value,
        controlsActingPlayer: !!actingId && gameStore.iControl(actingId),
        activationKey: ttmKey,
        cancelledKeys: ttmCancelledActivationKeys,
        hasLocalTarget: !!o66ThrownMate.value || !!o66PendingPass.value,
      });
      if (ttmCancel === 'cancel-and-end' && ttmKey) {
        ttmCancelledActivationKeys.add(ttmKey);
        clearTtmTargetingSurface(); // retire ruler/destination immediately even if the ownership rail refuses
        gameStore.endActivation(); // exact clientActingPlayer(null); one attempt per stable activation key
        return;
      }
      if (ttmCancel === 'already-cancelled') return;
      const hasPlan = !!o66PendingMove.value || !!o66PendingPass.value || !!o66PendingPunt.value || !!o66PendingHandOff.value
        || !!o66PendingFoul.value || !!o66ThrownMate.value
        || !!o66PendingBlock.value || !!o66AggroStage.value;
      if (hasPlan) {
        const cancelDeclaredFoul = !!o66PendingFoul.value
          && !!gRc
          && deriveClientState(gRc, o66Ctx()) === 'FOUL';
        clearO66Arms();
        if (cancelDeclaredFoul) gameStore.endActivation();
      } else {
        // #231 (owner-fg 07-29): a right-click DURING A BLITZ activation must CONFIRM before ending — a stray
        //   right-click on empty was silently firing endActivation and burning the once-per-turn blitz. Gate ONLY
        //   the blitz case behind the shared "End your blitz?" confirm (confirmEndActivation mirrors the direct branch below);
        //   every other activation keeps the direct deselect/end.
        const rcState = gRc ? deriveClientState(gRc, o66Ctx()) : '';
        if (requiresBlitzEndConfirmation(rcState) || rcState === 'PUNT' || gameStore.state.gazeIntent) {
          requestEndActivation();
          return;
        }
        // Owner 2026-07-13: no plan pending → DESELECT. In o66 a left-click auto-declared Move (activating the
        // player server-side), so the renderer-local clearSelection alone is a no-op — the real deselect is the
        // implicit end-activation (store.ts endActivation, which backs the "End Move" menu). Safe no-op when
        // nothing is active. This is what arms right-click-empty to actually clear the on-select state.
        r.clearSelection();
        gameStore.endActivation();
      }
      return;
    }
    openO66Menu(target, x, y);
    return;
  }

  if (target.isOpposition) {
    if (!selectedId) {
      items.push({ label: 'Select one of your players first', disabled: true });
    } else {
      const attackerIsHome = selectedIsHome();
      const reachable = r.canApproach(target.square);
      // Q6: Block raises the contextual dice preview (no dedicated button)
      if (!target.isDown && adjacentToPathEnd(target.square)) {
        items.push({
          label: 'Block',
          action: () => {
            r.previewBlock(target.playerId, x, y);
            plannedAction.value = 'Block';
          },
        });
      }
      // Q8 (revised): out-of-range hides; spent budgets show shaded "— used"
      if (!target.isDown && reachable) {
        const used = !budgetAvailable('blitz', attackerIsHome);
        items.push({
          label: used ? 'Blitz here — used' : 'Blitz here',
          disabled: used,
          action: () => {
            r.setActionMode('blitz');
            r.planApproach(target.square);
            plannedAction.value = 'Blitz';
          },
        });
      }
      if (target.isDown && reachable) {
        const used = !budgetAvailable('foul', attackerIsHome);
        items.push({
          label: used ? 'Foul — used' : 'Foul',
          disabled: used,
          action: () => {
            r.setActionMode('foul');
            r.planApproach(target.square);
            plannedAction.value = 'Foul';
          },
        });
      }
      if (target.isDown && r.canJumpOver(target.square)) {
        items.push({ label: 'Jump over', action: () => void r.planJumpOver(target.square) });
      }
      const specials = specialsOf(selectedId);
      items.push({
        label: 'Special',
        children: specials.length
          ? specials.map((skill) => ({
              label: skill,
              action: () => {
                r.planApproach(target.square);
                plannedAction.value = skill;
              },
            }))
          : [{ label: 'None available', disabled: true }],
      });
      if (items.length === 0) items.push({ label: 'No actions available', disabled: true });
    }
  } else if (target.activationSpent) {
    // Q8: nothing actionable renders for a spent player
    items.push({ label: 'Already activated', disabled: true });
  } else {
    const distracted = target.isConfused || target.isHypnotized;
    const suffix = distracted ? ' (distracted)' : '';
    const declare = (mode: ActionMode, label: string) => () => {
      r.selectPlayer(target.playerId);
      r.setActionMode(mode);
      plannedAction.value = label === 'Move' ? null : label;
    };
    // owner 2026-07-03 r3: the Move item is just "Activate"; the others drop the
    // "Declare " prefix (Blitz/Foul/Pass/Handoff).
    items.push({ label: 'Activate', action: declare('move', 'Move') });
    for (const [mode, label] of [['blitz', 'Blitz'], ['foul', 'Foul'], ['pass', 'Pass'], ['handoff', 'Handoff']] as [ActionMode, string][]) {
      // Q8 (revised): spent declarations stay visible, shaded "— used"
      const used = !budgetAvailable(mode, target.isHomeTeam);
      items.push({
        label: used ? `${label} — used` : `${label}${suffix}`,
        disabled: used,
        action: declare(mode, label),
      });
    }
    if (target.isDown && selectedId && selectedId !== target.playerId && r.canJumpOver(target.square)) {
      items.push({ label: 'Jump over', action: () => void r.planJumpOver(target.square) });
    }
    const specials = specialsOf(target.playerId);
    items.push({
      label: 'Special',
      children: specials.length
        ? specials.map((skill) => ({
            label: skill,
            action: () => {
              r.selectPlayer(target.playerId);
              plannedAction.value = skill;
            },
          }))
        : [{ label: 'None available', disabled: true }],
    });
  }

  // Owner 2026-07-06: STAR PLAYER special rules on the coach's OWN star. FFB keeps a
  // star's named special rules in its skillArray and they're passive/server-enforced
  // (the actionable ones — Throw Keg, gaze… — already appear under "Special"), so we
  // surface them INFORMATIONALLY here: a read-only submenu, each rule tooltipped with
  // its rules text. Only for your own star (not the opposition's).
  if (!target.isOpposition) {
    const starRules = starRulesOf(target.playerId);
    if (starRules.length) {
      items.push({
        label: '★ Star Rules',
        children: starRules.map((rule) => ({
          label: rule,
          disabled: true, // informational — server-enforced, no client action
          hint: skillDescription(rule),
        })),
      });
    }
  }

  // Owner 2026-07-04f: "Mark…" — a light-column marker on any square. The
  // submenu carries Mark Square / Row / Column (also Shift / Ctrl+Shift /
  // Alt+Shift + left-click shortcuts). Clear appears once anything is marked.
  const sq = target.square;
  const markChildren: MenuItem[] = [
    { label: 'Mark Square  (Shift+Click)', action: () => r.toggleMarkSquare(sq) },
    { label: 'Mark Row  (Ctrl+Shift+Click)', action: () => r.markRow(sq) },
    { label: 'Mark Column  (Alt+Shift+Click)', action: () => r.markColumn(sq) },
  ];
  if (r.hasMarks()) markChildren.push({ label: 'Clear all marks', action: () => r.clearMarks() });
  items.push({ label: 'Mark…', children: markChildren });

  const host = pitchHost.value!;
  // Owner (2026-07-03): the declare-action menu was tangling with the bottom
  // control strip (quick config-bar + hotbar + log). Reserve a bottom-safe band
  // and FLIP the menu upward from the click when it would otherwise land in it,
  // so the Blitz/Foul/Pass/Handoff row is never hidden behind those bars.
  const menuH = items.length * 18 + 8; // ~row height + padding (menu is ~50% now)
  const BOTTOM_SAFE = 72; // clearance for the hotbar / config-bar strip
  ctxMenu.x = Math.min(Math.max(x, 4), Math.max(host.clientWidth - 130, 4));
  const maxDownY = host.clientHeight - menuH - BOTTOM_SAFE;
  ctxMenu.y = y <= maxDownY ? Math.max(y, 4) : Math.max(4, y - menuH);
  ctxMenu.items = items;
  ctxMenu.visible = true;
}

function runMenuItem(item: MenuItem) {
  if (item.disabled || !item.action) return;
  item.action();
  ctxMenu.visible = false;
}

function onGlobalPointerDown(event: PointerEvent) {
  if (ctxMenu.visible && !(event.target as HTMLElement).closest?.('.context-menu')) ctxMenu.visible = false;
}

/** Q4 Option B: rejected actions show a transient tooltip at the click point. */
const toast = reactive({ visible: false, text: '', x: 0, y: 0, below: false });
let toastTimer = 0;

function showToast(message: string, x: number, y: number, durationMs = 1800, below = false) {
  toast.text = message;
  toast.x = x;
  toast.y = y;
  toast.below = below; // owner 09-05: the skill-use pill sits BELOW the token
  toast.visible = true;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.visible = false), durationMs);
}

// Owner 2026-07-04: smooth WASD camera glide — the held keys form a pan direction
// that the renderer eases into a velocity (glide-stop on release), instead of a
// per-keypress tile jump.
const heldPanKeys = new Set<string>();
function updatePanDir() {
  let x = 0;
  let y = 0;
  if (heldPanKeys.has('KeyW')) y += 1;
  if (heldPanKeys.has('KeyS')) y -= 1;
  if (heldPanKeys.has('KeyA')) x += 1;
  if (heldPanKeys.has('KeyD')) x -= 1;
  renderer?.setPanDirection(x, y);
}
function onKeyup(event: KeyboardEvent) {
  if (/^Key[WASD]$/.test(event.code)) { heldPanKeys.delete(event.code); updatePanDir(); }
}
function clearPan() { heldPanKeys.clear(); renderer?.setPanDirection(0, 0); }

/** Shared rail 5 nominate/confirm arm; changing the square or action re-nominates. TTM uses the same selector,
 * destination cue, confirm gesture, and teardown as a regular throw while retaining its exact upstream sender. */
function nominateOrConfirmThrow(square: [number, number], kind: 'pass' | 'bomb' | 'fireball' | 'throwTeamMate'): void {
  if (o66PendingThrowKind.value === kind && o66PendingPass.value
    && o66PendingPass.value[0] === square[0] && o66PendingPass.value[1] === square[1]) {
    if (kind === 'throwTeamMate') {
      const g = gameStore.game.value;
      const st = g ? deriveClientState(g, o66Ctx()) : '';
      const actingId = String((g?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
      if (!g || !actingId || !isThrowMateState(st) || !o66ThrownMate.value
        || !ttmTargetInTemplate(g, actingId, square)) return;
      if (!gameStore.o66ThrowMateLand(actingId, square, st === 'KICK_TEAM_MATE')) return;
      const activationKey = ttmActivationKey(g);
      if (activationKey) ttmCommittedActivationKeys.add(activationKey);
      clearTtmTargetingSurface();
      return;
    } else if (kind === 'bomb') gameStore.sendBombTarget(square);
    else if (kind === 'fireball') gameStore.resolveSquarePick(square);
    else sendDirectPassWithBridge(square);
    o66PendingPass.value = null;
    o66PendingThrowKind.value = null;
    clearHailMaryPassRulerAfterCommit();
  } else {
    o66PendingPass.value = square;
    o66PendingThrowKind.value = kind;
  }
  o66PendingHandOff.value = null;
}

/** U9c: first server-offered Punt target click nominates; the same click again commits the field coordinate. */
function nominateOrConfirmPunt(g: Parameters<typeof o66SquareClick>[0], actingId: string, square: [number, number]): void {
  const ix = o66SquareClick(g, o66Ctx(), square);
  if (ix.kind !== 'fieldCoordinate') return;
  const pending = o66PendingPunt.value;
  if (pending && pending[0] === ix.square[0] && pending[1] === ix.square[1]) {
    gameStore.sendFieldCoordinate(actingId, ix.square);
    o66PendingPunt.value = null;
  } else {
    o66PendingPunt.value = ix.square;
  }
}

function confirmPendingGazeDeclaration(): boolean {
  const victimId = o66PendingGaze.value;
  if (!victimId || !gameStore.confirmGazeDeclaration(victimId)) return false;
  o66PendingGaze.value = null;
  return true;
}

function confirmDeclaredGaze(): boolean {
  const intent = gameStore.state.gazeIntent;
  const victimId = intent?.phase === 'active' ? intent.victimId : null;
  if (!victimId || !gameStore.confirmGazeTarget(victimId)) return false;
  o66PendingMove.value = null;
  renderer?.setO66Path([]);
  renderer?.setTilePick(false);
  renderer?.clearSelection();
  return true;
}

/** Owner o66ad: affirm the visible ORDER 66 prompt or commit whatever planner preview is armed (used by
 *  Space-to-confirm). Mirrors the 2nd-click CONFIRM in onTilePick: a previewed move/blitz route sends the whole path
 *  in one command; a previewed PASS target throws. Returns true if it consumed a pending action. */
function o66ConfirmPending(): boolean {
  const g = gameStore.game.value;
  if (!settings.order66 || !gameStore.isPlaying.value || !g) return false;
  // Space answers the newest visible prompt before any planner arm; passive opponent/spectator cards are ignored.
  // The unified election always has at least one special plus Continue. Space consumes the gesture without
  // guessing between them; the coach must choose an explicit row with the mouse.
  if (wideRailActivationPrompt.value) return true;
  if (endActConfirm.value) { confirmEndActivation(); return true; }
  if (endTurnWarnCount.value !== null) { confirmEndTurnAnyway(); return true; }
  if (gameStore.state.followupChoice) { answerFollowup(true); return true; }
  if (gameStore.state.skillChoice?.mine) { gameStore.resolveSkillUse(true); return true; }
  // Meero SR-235 M-2/M-4: one option is binary, so Space invokes that row's exact click action. With 2+ options
  // there is no server default: consume Space without a wire so it never half-works as a hidden planner confirm
  // under the open decision menu; the coach must pick an option with the mouse.
  if (gameStore.state.reRollPrompt?.mine) {
    if (gameStore.state.reRollPrompt.options.length === 1) {
      gameStore.resolveReRoll(gameStore.state.reRollPrompt.options[0]!.source);
      return true;
    }
    if (gameStore.state.reRollPrompt.options.length >= 2) return true;
  }
  const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (!actingId) return false;
  // #48 (Space parity, EX-1 blitz-flavor): a held #111 blitz-flavor commits the PLAIN block (the fast default —
  // mirrors the left-click on the target; a flavored block is the right-click pick). Never a pass/hand-off confirm.
  if (gameStore.state.blitzBlockChoice) { gameStore.commitBlitzBlock(null); return true; }
  const st = deriveClientState(g, o66Ctx());
  if (st === 'PUNT' && isPuntTargeting(g) && o66PendingPunt.value) {
    const ix = o66SquareClick(g, o66Ctx(), o66PendingPunt.value);
    if (ix.kind === 'fieldCoordinate') gameStore.sendFieldCoordinate(actingId, ix.square);
    o66PendingPunt.value = null;
    return true;
  }
  if ((st === 'GAZE_MOVE' || st === 'GAZE') && o66PendingGaze.value) {
    confirmPendingGazeDeclaration();
    return true;
  }
  if ((st === 'GAZE_MOVE' || st === 'GAZE') && gameStore.state.gazeIntent?.phase === 'active') {
    confirmDeclaredGaze();
    return true;
  }
  // The Modern target was already confirmed; declaration/target acknowledgement now owns the route.
  // Consume repeat Confirm presses without degrading the stored Blitz into a plain Move send.
  if (o66PendingLeftClickBlitzPlan.value) return true;
  const pend = o66PendingMove.value;
  if (pend) {
    // The store's confirmed per-square presentation drain owns the acting token. Do not pre-arm the legacy
    // whole-route fallback here: it predicts motion before acknowledgement and can reclaim the token when the
    // final confirmed step retires. Passive clients still retain renderer-owned incremental fallback motion.
    if (st === 'BLITZ') gameStore.o66BlitzMove(actingId, pend.route); else gameStore.o66Move(actingId, pend.route);
    o66PendingMove.value = null; renderer?.setO66Path([]);
    return true;
  }
  // Revalidate nominated Pass/Bomb/TTM/KTM targets at confirm time; clear stale out-of-template arms without sending.
  if (st === 'PASS' && o66PendingPass.value) {
    if (passTargetInTemplate(g, actingId, o66PendingPass.value)) {
      sendDirectPassWithBridge(o66PendingPass.value);
      clearHailMaryPassRulerAfterCommit();
    }
    o66PendingPass.value = null; return true;
  }
  // Bomb confirmation uses sendBombTarget and the shared template recheck, including Hail Mary carve-outs.
  if (st === 'BOMB' && o66PendingPass.value) {
    if (passTargetInTemplate(g, actingId, o66PendingPass.value)) {
      gameStore.sendBombTarget(o66PendingPass.value);
      clearHailMaryPassRulerAfterCommit();
    }
    o66PendingPass.value = null; return true;
  }
  // #248 (owner-fg 07-29, Yularen ruling (b)): the TTM landing rides the SAME #219 confirm rail — Space / confirm-bar
  // confirms a pending landing exactly as the 2nd click does (:5104-5106), ONE rail with no idiom fork. A TTM SCATTERS
  // so there is no accuracy roll to reveal; the 🏈 nominate cue is the reveal (no per-square chips — ⚖ render what the
  // server sends). o66ThrowMateLand answer path BYTE-UNTOUCHED.
  if (isThrowMateState(st) && o66ThrownMate.value && o66PendingPass.value) {
    // stale landing (out of the thrower's range after a walk) ⇒ drop the nomination but KEEP o66ThrownMate so the
    //   still-held team-mate can be re-nominated to a legal square (never abandon the pickup on a stale confirm).
    if (ttmTargetInTemplate(g, actingId, o66PendingPass.value)) {
      nominateOrConfirmThrow(o66PendingPass.value, 'throwTeamMate');
    } else {
      o66PendingPass.value = null;
      o66PendingThrowKind.value = null;
    }
    return true;
  }
  // #48 (Space/confirm-bar parity, EX-1 foul): confirm a nominated FOUL — mirrors the 2nd-click EXECUTE in
  // onPlayerClick (recompute the contact reach, then startPlan foul). Doomed reach → don't confirm (the click
  // path teaches WHY); pass/hand-off are single-click, never reached here.
  if (o66PendingFoul.value) {
    const victimId = o66PendingFoul.value;
    const vsq = normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
      .find((d) => d.playerId === victimId)?.playerCoordinate);
    // #217 (owner-fg 07-29): declared waypoints are the DEFAULT — if the coach plotted a walk (o66PendingMove) whose
    // last square is ADJACENT to the victim, boot FROM that route (no auto-reach re-gate). Only when NO legal plotted
    // path exists do we auto-route to contact, keeping the #36 backstop (doomed reach ⇒ don't waste the once-per-turn
    // foul). Mirrors the onPlayerClick EXECUTE site + the #241 waypoint-honoring class.
    const planned = o66PendingMove.value?.route ?? null;
    const lastSq = planned && planned.length > 0 ? planned[planned.length - 1] : null;
    const adjToVictim = !!(lastSq && vsq && Math.max(Math.abs(lastSq[0] - vsq[0]), Math.abs(lastSq[1] - vsq[1])) === 1);
    if (adjToVictim) {
      gameStore.startPlan({ playerId: actingId, actKind: 'foul', route: planned!, targetPlayerId: victimId });
    } else {
      const reach = vsq ? renderer?.o66ContactReach(actingId, vsq) : null;
      if (reach && reach.status !== 'PATH') return false; // #36 backstop — only when no legal plotted path exists
      gameStore.startPlan({ playerId: actingId, actKind: 'foul', route: reach?.path ?? [], targetPlayerId: victimId });
    }
    o66PendingFoul.value = null; o66PendingMove.value = null; renderer?.setO66Path([]);
    return true;
  }
  return false;
}

function showQuickClickBlitzUnavailable(targetId: string, reason: 'modern' | 'used' | 'unavailable' | 'unreachable' = 'unavailable') {
  const sq = playerSquareById(targetId);
  const p = sq ? renderer?.squareToCanvas(sq) : null;
  const text = reason === 'used' ? 'Blitz has already been used this turn'
    : reason === 'unreachable' ? 'Can’t reach a square next to that target'
      : 'Declare Blitz from the Context Menu';
  showToast(text, p?.x ?? 200, (p?.y ?? 200) - 20, 2600);
}
/** Fives lane 08-19: confirm the current aggressive stage. Blitz revalidates the menu offer before declaring. */
/** Owner 09-06: a block/blitz TARGET click must not leave the defender selected — return the renderer selection to
 *  the attacker (or clear it) so the target shows no reach after the block resolves and later clicks don't act on it. */
function swallowBlockTargetSelection(targetId: string): void {
  const g = gameStore.game.value;
  if (!renderer || !g || renderer.getSelectedPlayerId() !== targetId) return;
  const atk = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (atk && atk !== targetId) renderer.selectPlayer(atk);
  else renderer.clearSelection();
}
function dismissO66OpponentInspection(g: GameJson): boolean {
  if (!renderer || !o66InspectedOpponent.value) return false;
  const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (actingId) renderer.selectPlayer(actingId);
  else renderer.clearSelection();
  o66InspectedOpponent.value = null;
  return true;
}
function confirmAggroStage(): boolean {
  const g = gameStore.game.value;
  if (!settings.order66 || !gameStore.isPlaying.value || !g) return false;
  const st = o66AggroStage.value;
  if (!st) return false;
  const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (st.kind === 'blitz') {
    // Once Blitz is authoritative and the target is adjacent, this is the second-click terminal. The menu-selected
    // flavor rides the existing CLIENT_BLOCK flags; no second Blitz declare or target-selection command is sent.
    if (deriveClientState(g, o66Ctx()) === 'BLITZ' && actingId
        && adjacentStandingEnemyIds(g, actingId).includes(st.target)) {
      gameStore.sendBlock(actingId, st.target, o66BlockFlags(o66PendingBlitzBlockKind.value));
      o66AggroStage.value = null;
      o66PendingBlitzBlockKind.value = null;
      o66ExplicitBlockChoice.value = null;
      return true;
    }
    if (settings.declareBlitzBehavior !== 'modern') {
      o66AggroStage.value = null;
      showQuickClickBlitzUnavailable(st.target, 'modern');
      return true;
    }
    if (blitzUsedActingSide(g)) {
      o66AggroStage.value = null;
      o66PendingMove.value = null;
      renderer?.setO66Path([]);
      showQuickClickBlitzUnavailable(st.target, 'used');
      return true;
    }
    const blitzAction = quickClickBlitzAction(g, o66Ctx(), actingId, st.target);
    if (!blitzAction) { showQuickClickBlitzUnavailable(st.target); return true; }
    const route = previewLeftClickBlitzRoute(actingId, st.target);
    if (!route) { showQuickClickBlitzUnavailable(st.target, 'unreachable'); return true; }
    o66AggroStage.value = null;
    o66PendingBlitzTarget.value = st.target;
    o66PendingLeftClickBlitzPlan.value = { playerId: actingId, targetId: st.target, route };
    runO66Action(blitzAction, actingId);
    return true;
  }
  if (!actingId) return false;
  // BLOCK: #18b — the declare fired at the first enemy click (declare-at-preview), so this confirm is a pure
  // COMMIT via the standalone-block chooser seam (RR-2), NOT playerBlock (which would re-declare). Block never sits at stage 1 now (it
  // goes straight to stage 2 with the declare), so the stage-1 arm is a harmless legacy no-op.
  if (st.stage === 1) { o66AggroStage.value = { kind: 'block', target: st.target, stage: 2 }; return true; }
  o66SendStandaloneBlock(actingId, st.target, o66PendingBlockKind.value);
  o66AggroStage.value = null;
  return true;
}
/** Bottom confirm-bar label for the armed Blitz/Block stage (null = no bar). */
const aggroConfirmLabel = computed(() => {
  const st = o66AggroStage.value;
  if (!st) return null;
  const special = selectedAggroBlockKind.value;
  if (special && st.stage === 2) return `Confirm ${BLOCK_KIND_LABEL[special]}`;
  const g = gameStore.game.value;
  if (st.stage === 2 && g && deriveClientState(g, o66Ctx()) === 'BLITZ') return 'Confirm Block';
  if (st.kind === 'blitz') return 'Confirm Blitz';
  return st.stage === 1 ? 'Declare Block' : 'Confirm Block';
});
const canConfirmPendingGaze = computed(() => {
  const victimId = o66PendingGaze.value;
  return !!victimId && gameStore.canConfirmGazeDeclaration(victimId);
});
const canConfirmDeclaredGaze = computed(() => {
  const intent = gameStore.state.gazeIntent;
  return intent?.phase === 'active' && !!intent.victimId && gameStore.canConfirmGazeTarget(intent.victimId);
});
/** #48 (owner, confirm-bar parity): the bottom confirm-bar label for a nominated o66 PUNT, MOVE route or FOUL.
 *  Click/Space both confirm via o66ConfirmPending. Pass/hand-off stay single-click (EX-1) → no bar. */
const o66PendingConfirmLabel = computed(() => {
  if (!settings.order66 || !gameStore.isPlaying.value || !gameStore.myTurn.value) return null;
  if (o66AggroStage.value || o66PendingLeftClickBlitzPlan.value) return null;
  if (o66PendingPunt.value) return 'Confirm Punt';
  if (o66PendingFoul.value) return 'Confirm Foul';
  if (canConfirmPendingGaze.value) return 'Confirm Gaze Target';
  if (canConfirmDeclaredGaze.value) return 'Confirm Gaze';
  if (o66PendingMove.value) {
    const g = gameStore.game.value;
    return g && deriveClientState(g, o66Ctx()) === 'BLITZ' ? 'Confirm Blitz' : 'Confirm Move';
  }
  return null;
});

/** Esc clears an undeclared preview locally or cancels a declared action with its state-specific wire; otherwise it closes the popup, ends the activation, then opens Game Menu. */
function escO66Cascade() {
  const g = gameStore.game.value;
  const st = g ? deriveClientState(g, o66Ctx()) : null;
  const actingId = String((g?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (wideRailActivationPrompt.value) {
    if (!cancelWideRailBlitzTarget()) declineWideRailActivationRules();
    return;
  }
  const decision = escCascadeDecision({
    blitzBlockChoiceHeld: !!gameStore.state.blitzBlockChoice,
    blitzSpecialPromptVisible: false,
    wisdomPromptVisible: false,
    endActivationConfirmVisible: !!endActConfirm.value,
    endTurnWarnVisible: endTurnWarnCount.value !== null,
    followupChoiceVisible: !!gameStore.state.followupChoice,
    ownSkillChoiceVisible: !!gameStore.state.skillChoice?.mine,
    ownRerollPromptVisible: !!gameStore.state.reRollPrompt?.mine,
    pendingMove: !!o66PendingMove.value,
    pendingPass: !!o66PendingPass.value,
    pendingPunt: !!o66PendingPunt.value,
    pendingHandOff: !!o66PendingHandOff.value,
    pendingFoul: !!o66PendingFoul.value,
    pendingGaze: !!gameStore.state.gazeIntent,
    thrownMatePending: !!o66ThrownMate.value,
    pendingBlock: !!o66PendingBlock.value,
    aggroStage: o66PendingBlitzTarget.value ? 2 : (o66AggroStage.value?.stage ?? null),
    contextMenuVisible: ctxMenu.visible,
    gameMenuOpen: ui.gameMenuOpen,
    settingsOpen: ui.settingsOpen,
    popupVisible: popup.visible,
    myTurn: gameStore.myTurn.value,
    actingPlayerId: actingId || null,
    clientState: st,
    hasSelection: hasSelection.value,
  });

  switch (decision.kind) {
    case 'hold-keep':
      // #111 blitz-flavor hold: no clean server-abort mid-block-commit (§4b — clearing the hold without committing
      // would strand the paused blitzer). Esc only dismisses the flavor menu if open; the hold is resolved by the
      // left/right-click (plain/flavored) contract, never Esc. (Esc-abort-of-a-#111-hold flagged to Meero.)
      if (decision.closeContextMenu) ctxMenu.visible = false;
      return; // keep the hold; never fall through to end-activation (that would wedge the paused block)
    case 'dismiss-prompt':
      if (decision.prompt === 'endActivation') cancelEndActivation();
      else if (decision.prompt === 'endTurn') cancelEndTurnWarn();
      else if (decision.prompt === 'followup') answerFollowup(false);
      else if (decision.prompt === 'skillChoice') gameStore.resolveSkillUse(false);
      else gameStore.resolveReRoll(null);
      return;
    case 'undeclare':
      clearO66Arms();
      gameStore.endActivation();
      return;
    case 'abort-preview':
      clearO66Arms();
      return;
    case 'close-menu':
      if (decision.target === 'context') ctxMenu.visible = false;
      else if (decision.target === 'game-settings') { ui.gameMenuOpen = false; ui.settingsOpen = false; }
      else popup.visible = false;
      return;
    case 'ask-end-activation':
      askEndActivation(decision.confirmKind);
      return;
    case 'clear-selection':
      renderer?.clearSelection();
      return;
    case 'game-menu':
      ui.gameMenuOpen = true;
      return;
  }
}

function onKeydown(event: KeyboardEvent) {
  // App-shell modals own the keyboard while open. In particular, Settings Esc must
  // run its transactional rollback path rather than this gameplay handler closing it.
  if (appShellModalOwnsKeyboard(ui.settingsOpen)) return;
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === 'Escape') {
    // #48 Esc cascade (owner-ruled): in o66 PLAY, escO66Cascade owns the whole cascade (abort-arm → close-menu →
    // END-ACTIVATION #12 → Game Menu). Flag-OFF / spectating keep the legacy menus-first cascade byte-identical.
    if (settings.order66 && gameStore.isPlaying.value) {
      escO66Cascade();
    } else if (ctxMenu.visible) {
      ctxMenu.visible = false;
    } else if (ui.gameMenuOpen) {
      ui.gameMenuOpen = false;
    } else if (hasSelection.value || popup.visible) {
      renderer?.clearSelection();
      popup.visible = false;
    } else {
      ui.gameMenuOpen = true;
    }
  } else if (event.code === settings.confirmKey) {
    // Owner o66ad: Space CONFIRMS the ORDER 66 planner (a previewed move/blitz path, or a pass target) first;
    // otherwise it falls through to the legacy queued-path confirm. preventDefault only when we actually consume it
    // (Space would otherwise scroll / re-click a focused button).
    if (confirmAggroStage() || o66ConfirmPending()) { event.preventDefault(); }
    else if (queuedSteps.value > 0) { event.preventDefault(); confirmMove(); }
  } else if (/^Key[WASD]$/.test(event.code)) {
    // WASD camera navigation (owner 2026-07-03 r3; smooth glide 2026-07-04): W/A pan
    // toward the top/left (content shifts down/right), S/D the opposite. Held keys
    // drive a smooth velocity glide (setPanDirection) rather than a per-key tile jump.
    heldPanKeys.add(event.code);
    updatePanDir();
  } else if (event.key === 'Enter' && !settings.chatDisabled) {
    // Enter initiates a chat message (owner 2026-07-03 r3): open + focus chat.
    event.preventDefault();
    panelTab.value = 'chat';
    panelCollapsed.value = false;
    void nextTick(() => chatInputEl.value?.focus());
  } else if (hasSelection.value && /^Digit[1-6]$/.test(event.code)) {
    const button = hotbarActions.value[Number(event.code.slice(5)) - 1];
    if (button && !button.used) setAction(button.mode);
  }
}

// Owner 2026-07-06 (finding A): the log-panel ResizeObserver + window resize handler
// are created inside the async onMounted BELOW, after `await nextTick()`. A lifecycle
// hook registered past that await warns ("onBeforeUnmount … no active component
// instance") AND never actually registers — leaking the observer + listener on
// unmount. Hold them here and tear them down in the synchronous onBeforeUnmount.
let panelResizeObserver: ResizeObserver | null = null;
let panelReanchorHandler: (() => void) | null = null;
let panelMeasureHandler: (() => void) | null = null;
let rendererMountActive = false;
// Owner 2026-07-08: the "I ♥ name" signs are now assigned at GAME START and held on
// the sign-holders' placards through the game (see the game watcher →
// renderer.setPregameSigns) — replacing the old periodic single-sign timer.
onMounted(async () => {
  rendererMountActive = true;
  // Exact confirmed movement is a Modern renderer capability. Register before any async mount work so incoming
  // frames cannot open a gate without a seq-aware presentationStep consumer; Classic intentionally never registers.
  unregisterConfirmedMovementPresentation = gameStore.registerConfirmedMovementPresentationConsumer();
  // Classic teardown clears this shared presentation gate. Re-arm it synchronously on every Modern mount so a
  // Classic -> Modern mode switch cannot leave live, spectator, or replay reroll surfaces headless.
  gameStore.setInteractiveReRolls(true);
  unregisterKickElection = gameStore.registerKickElectionSurface('modern');
  unregisterApothecaryElection = gameStore.registerApothecaryElectionSurface('modern');
  // Owner 2026-07-03: the DEFAULT log window is compact — width matched to the
  // quick-action button bar, ~150px tall (his screenshot). A user resize still
  // wins (settings.logSize persists over this).
  if (!settings.logSize) {
    const barW = (document.querySelector('.config-bar') as HTMLElement | null)?.offsetWidth;
    defaultPanelSize.value = { w: Math.max(300, barW ?? 360), h: 150 };
    await nextTick(); // let the new size render before the anchor capture below
    if (!rendererMountActive) return;
  }
  // B2-9 (UI7): persist user-resized log panel dimensions. The first
  // observation fires during mount (pre-style layout can be huge) — skip it,
  // and clamp to the CSS bounds so a transient layout can never persist.
  if (panelEl.value) {
    // B9-17: capture the initial (CSS bottom-anchored) position as a top anchor
    // BEFORE any resize can happen, so the SE resize handle behaves normally.
    if (!settings.logPos) {
      panelAnchor.value = { x: panelEl.value.offsetLeft, y: panelEl.value.offsetTop };
    }
    let sawInitial = false;
    panelResizeObserver = new ResizeObserver(() => {
      const el = panelEl.value;
      if (!el || panelCollapsed.value || panelDrag) return;
      if (!sawInitial) {
        sawInitial = true;
        return;
      }
      const w = Math.min(Math.round(el.offsetWidth), Math.round(window.innerWidth * 0.8));
      const h = Math.min(Math.round(el.offsetHeight), Math.round(window.innerHeight * 0.8));
      // only persist a MEANINGFUL user resize (>2px) so a sub-pixel/rounding echo
      // of our own width/height write can never feed back and grow the window.
      const dw = Math.abs((settings.logSize?.w ?? 0) - w);
      const dh = Math.abs((settings.logSize?.h ?? 0) - h);
      if (w >= 240 && h >= 88 && (dw > 2 || dh > 2)) {
        settings.logSize = { w, h };
      }
    });
    panelResizeObserver.observe(panelEl.value);

    // Edge metadata makes dragged panels follow CSS left/right + top/bottom directly. Resize only
    // migrates a legacy v11 absolute entry once; it never rewrites a current anchor on expansion.
    const reanchorPanel = () => {
      const el = panelEl.value;
      if (!el) return;
      const parent = el.offsetParent as HTMLElement | null;
      const pw = parent ? parent.clientWidth : window.innerWidth;
      const ph = parent ? parent.clientHeight : window.innerHeight;
      panelViewport.value = { width: pw, height: ph };
      if (panelCollapsed.value) return; // collapsed → docked to the config-bar, nothing to track
      if (settings.logPos) {
        if (!hasEdgeAnchor(settings.logPos)) settings.logPos = anchorPanelPosition(
          settings.logPos,
          { width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height },
          { width: pw, height: ph },
        );
        return;
      }
      panelAnchor.value = {
        x: Math.max(0, pw - el.offsetWidth - 14),
        y: Math.max(0, ph - 56 - el.offsetHeight),
      };
    };
    panelReanchorHandler = reanchorPanel;
    window.addEventListener('resize', reanchorPanel);
    reanchorPanel();
    await nextTick();
    if (!rendererMountActive) return;
    dodgeDefaultLogFromReplayControls();
  }

  const mountedRenderer = new PitchRenderer();
  renderer = mountedRenderer;
  mountedRenderer.setD6FaceVariant(settings.d6FaceVariant);
  mountedRenderer.setPresentationMode(gameStore.replay.active ? 'replay' : gameStore.isPlaying.value ? 'live' : 'spectator');
  mountedRenderer.setConfirmedMovementPresentation(gameStore.state.confirmedMovementDrainActive);
  if (!await initPitchRendererMount(
    mountedRenderer,
    pitchHost.value!,
    () => rendererMountActive && renderer === mountedRenderer,
  )) return;
  refreshApothecarySubject();
  // The confirmation dialog and its armed renderer chips consume the same BB2025 Pass projection as hover and
  // committed destination cues (including Nerves of Steel), never ffb-pitch's standalone fallback formula.
  renderer.setPassRollResolver((throwerId, from, to) => {
    const g = gameStore.game.value;
    return g ? passDestinationRollPreview(g, from, to, throwerId, 'PASS')?.throwRoll ?? null : null;
  });
  gameStore.setReplayPresentationIdleProbe(() => renderer?.isReplayPresentationIdle() ?? true);
  refreshSeatTint(); // #157: the game watch may have run its `immediate` pass before the renderer existed
  // A snapshot can derive TRICKSTER before Pixi mounts; upstream enters that state during game-state handling.
  // `ffb-client-logic/src/main/java/com/fumbbl/ffb/client/handler/ClientCommandHandlerGameState.java:136-154`
  // Replay the pending surface once the renderer exists too.
  const pendingPlayerPick = gameStore.state.playerPick;
  renderer.setPlayerPick(pendingPlayerPick && !pendingPlayerPick.key.startsWith('pchoice:mvp')
    ? pendingPlayerPick.eligibleIds : null);
  renderer.setPlayerPickArrows(pendingPlayerPick && isArrowNarrowedPick(pendingPlayerPick.key)
    ? pendingPlayerPick.picked : null);
  syncShadedPick();
  const pendingSquarePick = gameStore.state.squarePick;
  const zapSelected = !!gameStore.state.wizardTargetConfirm
    && pendingSquarePick?.kind === 'wizard' && pendingSquarePick.skill === 'Zap';
  renderer.setTargetSelectPick(zapSelected ? null : pendingSquarePick?.squares ?? null,
    zapSelected ? undefined : pendingSquarePick?.skill);
  const wizardPreview = gameStore.state.wizardTargetPreview;
  renderer.setO66PassRolls(wizardPreview
    ? new Map(wizardPreview.playerSquares.map((square) => [`${square[0]},${square[1]}`, 4]))
    : null);
  const pendingKickSkill = gameStore.state.kickSkill;
  renderer.setKickSkillCandidates(pendingKickSkill?.ballCoordinate ?? null, pendingKickSkill?.ballCoordinateWithKick ?? null);
  trackKickElection();

  // Route renderer animation completion to the store so presentation gates release at visual end.
  renderer.onAnimDone = gameStore.onAnimDone;
  // A view can mount while an interception decision is already live; seed the preflight hold that the watcher
  // could not deliver before Pixi existed.
  renderer.setPassBallHold(gameStore.state.passBallHold?.square ?? null);
  renderer.setPassDestinationMarker(
    gameStore.state.passDestination?.square ?? null,
    gameStore.state.passDestination?.kind ?? 'ball',
  );
  // #92 (Increment 1): bind the renderer's sound-cue sink → the store relay (name→playSound). The single call
  //   also flips `soundCueActive` so the footfall relocation activates atomically (no drop-before / double-after);
  //   before this bind footfall stays at model-apply (inert, zero regression). Store f665e20a / renderer 527f793c.
  renderer.onCue = gameStore.bindSoundCue();
  // item4 (owner 08-18): let the turnover-splash settle gate see a still-bouncing ball. Presentation-only
  // probe; the store's 7000ms cap remains the fail-open bound. Live AND spectate — this view serves both.
  bindBallAnimating(() => renderer?.ballAnimating() ?? false);
  turfCatalog.options = renderer.turfOptions();
  // if a persisted turf is no longer available, fall back to the first option
  if (!turfCatalog.options.includes(settings.turf)) settings.turf = turfCatalog.options[0] ?? 'grass1';
  renderer.setTurf(settings.turf);
  renderer.selectedSpritePack = spritePackSelected.value;
  renderer.setSpriteSet(spriteSet.value);
  renderer.setOneSpritePerPosition(settings.oneSpritePerPosition);
  // Owner 2026-07-08: block-preview squares sat a bit high over the head — brought ~40% closer
  // to the head (0.9 → 0.76 × TILE_H; head ≈ 0.55·TILE_H, so the above-head gap ~13px → ~8px).
  // They may now clip the top of the skill badges, but the squares draw in pathLayer (above
  // tokenLayer, where badges live) so they render ON TOP — intended.
  renderer.blockDotsHeadFactor = 0.76;
  renderer.setTackleZoneMode(settings.tackleZoneMode);
  renderer.showDefaultSkills = settings.showDefaultSkills;
  renderer.showPositionRings = settings.showPositionRings;
  // owner 2026-07-08: block-dice preview toggle — arm for the active player if on
  updateBlockPreview(); // owner 2026-07-07: action/target-gated block-dice preview
  renderer.showPlayerNumbers = settings.showPlayerNumbers;
  renderer.setVideoOptions({ renderScale: settings.renderScale, fpsCap: settings.fpsCap });
  renderer.setBrightness(settings.brightness);
  renderer.setFantasyCursorEnabled(settings.useFantasyCursor);
  renderer.setGridOptions({ show: settings.gridLines, widthMul: settings.gridLineWidth, color: gridColorInt(), alphaMul: settings.gridLineOpacity });
  renderer.setFieldMarkers({ rowMarkers: settings.showRowMarkers, sweetSpot: settings.showSweetSpot, fieldLogos: settings.showFieldLogos });
  renderer.setEndZoneLabel(settings.endZoneLabel); // owner 2026-07-08: team name | TOUCHDOWN
  renderer.setEndZoneTint(settings.endZoneTint); // owner 09-05: red/blue end-zone shading toggle
  renderer.setPanSpeed(settings.cameraPanSpeed); // owner 09-05: WASD pan speed
  renderer.setPositionRingOptions({ density: settings.positionRingDensity, color: ringColorOverrideInt() });
  renderer.setDieTagPosition(settings.dieTagPosition); // owner 2026-07-04: on-die cause tag
  renderer.setActivePlayerEcho(settings.activePlayerEcho); // owner 2026-07-06: deprecated echo opt-in
  renderer.moveStyle = settings.moveStyle;
  renderer.setMoveStepMs(settings.moveSpeedMs); // owner 2026-07-15: initial movement speed
  renderer.trailColorMode = settings.trailColor; // owner 2026-07-04
  renderer.trailMarkStyle = settings.trailMarks; // owner 2026-07-08: echo | numbers
  renderer.plannerEnabled = plannerAllowed.value;
  renderer.order66 = o66RendererActive.value; // ORDER 66 (P1): o66 owns clicks in PLAY only (never spectate)
  renderer.setAutoDirectorEnabled(settings.autoDirector); // owner 2026-07-03: Auto Director
  renderer.setAutoDirectorSuspended(gameStore.playbackCatchingUp.value);
  renderer.setPitchOrientation(settings.pitchOrientation); // B8-8
  renderer.setFlatMode(settings.flatRender); // owner 2026-07-04f: flat (non-iso) mode
  renderer.setUniformFigures(uniformFiguresEffective.value); // owner 09-09: one figure scale + softer far edge (per orientation 09-10)
  renderer.stadiumEnabled = settings.showStadium; // owner 08-19: applied pre-first-draw, no redraw needed
  // Owner 09-05: a bundled stadium GLB pack (assets/stadium/<id>/), rendered once to a plan and laid on the pitch quad.
  renderer.setStadiumPack(bundledStadiumPacks()[0] ?? null);
  // Seat/orientation P1 (g868): the drive-north flip is store state but the watch below is seq-driven and
  // renderer-guarded, so a bump that lands before this mount is dropped. Seed it here, same as orientation/flat.
  renderer.setFieldFlipMode(gameStore.state.fieldFlip.flip);
  renderer.turnTrackEnabled = settings.turnTrack; // owner 2026-07-07: on-pitch tracks toggle
  renderer.setOnPitchPresentationStyle(settings.modernHudStyle);
  renderer.setMarkColor(markColorInt()); // owner 2026-07-04f: pitch marking colour
  applySkillMarkingStyle();
  if (swarmingPhase.value) {
    renderer.setSetup(true, null);
    renderer.onSetupClick = handleSwarmingSetupClick;
    renderer.onDugoutSetupDragStart = startSwarmingPlayerDrag;
  }
  renderer.onPlayerClick = (playerId, clickX = 0, clickY = 0) => {
    renderer?.clearUnactivatedCues(); // owner 09-08: any player click ends the End-Turn idle-player cue
    if (wideRailActivationPrompt.value) return;
    if (gameStore.state.failedActionHold && gameStore.isPlaying.value) return; // owner 09-06: hold clicks while a failed roll drains
    if (o66PendingLeftClickBlitzPlan.value
        && !(settings.friendlyPlayerSwitch && gameStore.iControl(playerId))) return;
    if (gameStore.state.yesNo?.key.startsWith('maximumCarnage:')) return;
    const furyTargeting = furySecondBlockTargeting.value;
    if (furyTargeting) {
      if (furyTargeting.targetIds.includes(playerId)) {
        gameStore.sendBlock(furyTargeting.playerId, playerId);
      }
      swallowBlockTargetSelection(playerId); // owner 09-06: the target click is the block driver's, not a selection
      return;
    }
    // #85 Quick Snap: a click on one of MY on-pitch players SELECTS it for repositioning (re-click to deselect);
    // the valid ≤1/empty target squares then render as clickable markers. Handled before the normal o66 click
    // dispatch since quickSnap is its own kickoff mini-turn (no block/blitz/stats interaction).
    if (gameStore.game.value?.turnMode === 'quickSnap'
        && gameStore.state.quickSnapPhase?.players.some((p) => p.playerId === playerId)) {
      selectedQuickSnap.value = selectedQuickSnap.value === playerId ? null : playerId;
      return;
    }
    if (gameStore.game.value?.turnMode === 'swarming'
        && gameStore.state.swarmingPhase?.players.some((player) => player.playerId === playerId && player.eligible)) {
      selectSwarmingPlayer(playerId);
      return;
    }
    // Clicking a held Blitz target commits plain Block; right-click remains the flavor path.
    if (gameStore.requestKickEmBlitzBlock(playerId)) return;
    if (gameStore.state.blitzBlockChoice && playerId === gameStore.state.blitzBlockChoice.targetId) {
      gameStore.commitBlitzBlock(null);
      return;
    }
    // In THROW_KEG, accept only standing opponents within Chebyshev distance 3 before sending; the server revalidates.
    if (settings.order66 && gameStore.isPlaying.value) {
      const gk = gameStore.game.value;
      const kegActing = String((gk?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
      if (gk && kegActing && playerId !== kegActing && deriveClientState(gk, o66Ctx()) === 'THROW_KEG') {
        // Tarkin `2095e3dd` extracted the inline port into `kegTargetIds` so this click-gate and Voss's KG-6 ring
        // sink consume ONE rule and cannot drift (Meero SR-160). Behaviour-identical to the inline version it
        // replaces: `!iControl(p)` reduced to the opposition term here anyway, since this branch already sits
        // behind `deriveClientState === 'THROW_KEG'` (⇒ my turn), and iControlPlayer is `myPlayIds.has(p) && isMyTurn`.
        if (kegTargetIds(gk, kegActing).includes(playerId)) {
          gameStore.sendThrowKegTarget(playerId);
          return;
        }
      }
    }
    // ORDER 66 (A.3): in the BLOCK state, a left-click on an adjacent enemy IS the block target → sendBlock
    // (with the flavor flags remembered at declare). Every other player click falls through to the stats popup.
    if (settings.order66 && gameStore.isPlaying.value) {
      const g = gameStore.game.value;
      if (g) {
        const inspectedOpponent = o66InspectedOpponent.value;
        const inspectedActingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
        if (inspectedOpponent && playerId === inspectedActingId) {
          dismissO66OpponentInspection(g);
          return;
        }
        // Any non-dismiss player click leaves the previous inspection. A later residual opponent route can arm
        // the same or a different inspection again; target routes remain authoritative and do not leave a latch.
        if (inspectedOpponent) o66InspectedOpponent.value = null;
        // Fives lane 08-19: same-target click confirms; any different player cancels before normal routing.
        const stagedQuickBlitz = o66AggroStage.value?.kind === 'blitz' ? o66AggroStage.value : null;
        if (stagedQuickBlitz) {
          if (stagedQuickBlitz.target === playerId) { confirmAggroStage(); return; }
          o66AggroStage.value = null;
        }
        // #299 / Meero SR-240 Option B: BOMB player targets bypass the PC-1 router, which only returns a target
        // for PASS. Mirror the free-select PASS/template gate and THROW_KEG's view-side player interception:
        // derive the acting player's state, resolve the clicked token's square, and nominate on the shared
        // two-click bomb rail. The existing confirm path remains the only caller of sendBombTarget.
        const bombActing = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
        if (bombActing && deriveClientState(g, o66Ctx()) === 'BOMB') {
          const square = normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
            .find((d) => d.playerId === playerId)?.playerCoordinate);
          if (square && passTargetInTemplate(g, bombActing, square)) nominateOrConfirmThrow(square, 'bomb');
          return;
        }
        // A self left-click during any Blitz phase is inert. End Activation remains available from the context menu,
        // but only its explicit Blitz confirmation may authorize the terminal wire.
        const clickState = deriveClientState(g, o66Ctx());
        const clickActingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
        if (playerId === clickActingId && requiresBlitzEndConfirmation(clickState)) return;
        const ix = o66PlayerClick(g, o66Ctx(), playerId, (pid) => gameStore.iControl(pid));
        if (ix.kind === 'switchFriendlyActivation') {
          if (requiresBlitzEndConfirmation(clickState)) { requestEndActivation(); return; }
          // Stop future planner edges; an already-sent edge remains represented by movementIntent, so the store
          // waits for its server result before deciding refund vs end.
          clearO66Arms();
          gameStore.cancelPlan();
          if (settings.leftClickOpensContextMenu) {
            pendingFriendlyLeftClickMenu.value = { playerId: ix.playerId, x: clickX, y: clickY };
            gameStore.endActivation();
          } else {
            pendingFriendlyLeftClickMenu.value = null;
            gameStore.switchFriendlyActivation(ix.playerId, ix.disposition);
          }
          return;
        }
        if (ix.kind === 'swoopCoordinate') {
          const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
          if (actingId) gameStore.sendSwoop(actingId, ix.square);
          return;
        }
        if (ix.kind === 'fieldCoordinate') {
          const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
          if (actingId && deriveClientState(g, o66Ctx()) === 'PUNT' && isPuntTargeting(g)) {
            nominateOrConfirmPunt(g, actingId, ix.square);
          } else if (actingId) gameStore.sendFieldCoordinate(actingId, ix.square);
          return;
        }
        // ORDER 66 (A.4): in SELECT_BLITZ_TARGET a click on an enemy nominates the target. Wide-rail specials
        // hold it locally until Use/Continue; backing out sends neither the skill nor the target.
        if (ix.kind === 'targetSelected') {
          nominateBlitzTarget(
            ix.defenderId,
            (defenderId) => gameStore.wideRailActivationElection(defenderId),
            (defenderId) => { o66PendingBlitzTarget.value = defenderId; },
            (defenderId) => gameStore.sendTargetSelected(defenderId),
          );
          return;
        }
        // Star S8: Kick 'em chainsaw commit + Blastin' target — router-gated, dedicated store senders.
        if (ix.kind === 'kickEmBlock') { gameStore.sendKickEmBlock(ix.defenderId); return; }
        if (ix.kind === 'blastinTarget') { gameStore.sendBlastinTarget(ix.targetId); return; }
        // In SYNCHRONOUS_MULTI_BLOCK, clicking a legal opponent toggles target selection; the store owns commit.
        if (ix.kind === 'multiBlockToggle') {
          gameStore.toggleMultiBlockTarget(ix.defenderId);
          return;
        }
        // Owner 09-09: a self-click with a block-family target still pending re-surfaces the pill (no wire).
        if (ix.kind === 'targetPending') { gameStore.noticeTargetPending(ix.playerAction); return; }
        // Route router endMove intents through endActivation so bespoke states use their exact cancel wire.
        if (ix.kind === 'endMove') {
          if (gameStore.isPlanWalking(playerId)) return;
          requestEndActivation();
          return;
        }
        // BLOCK (A.3) and the BLITZ block-commit (A.4) both return `block` — send it with any remembered flavor
        // (a plain blitz carries no flavor → o66PendingBlockKind is null → all flags false).
        if (ix.kind === 'block') {
          // Owner 09-06: the renderer SELECTED the clicked defender before routing here (plannerEnabled is off in
          // o66). The block driver owns that click — hand the selection back to the attacker so nothing persists on
          // the target once the block resolves (its reach/inspect read, and later square clicks acting on it).
          swallowBlockTargetSelection(ix.defenderId);
          const atk = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
          if (atk) {
            const liveAttackState = deriveClientState(g, o66Ctx());
            if (liveAttackState === 'BLOCK' || liveAttackState === 'BLITZ') {
              const stageKind = liveAttackState === 'BLITZ' ? 'blitz' : 'block';
              const staged = o66AggroStage.value;
              if (!staged || staged.kind !== stageKind || staged.target !== ix.defenderId || staged.stage !== 2) {
                o66AggroStage.value = { kind: stageKind, target: ix.defenderId, stage: 2 };
                return;
              }
              confirmAggroStage();
              return;
            }
            // Owner o66ah: in BLITZ, the 3rd click on the nominated target EXECUTES — if the blitzer isn't adjacent
            // yet, auto-walk to contact (dodges included) THEN block in one wire; if already adjacent (or walked
            // manually via the planner), just block. A plain BLOCK state has no walk (always adjacent) → sendBlock.
            const st = deriveClientState(g, o66Ctx());
            const dsq = normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[]).find((d) => d.playerId === ix.defenderId)?.playerCoordinate);
            const path = st === 'BLITZ' && dsq ? (renderer?.o66PathToContact(atk, dsq) ?? []) : [];
            // A declared Blitz walks via CLIENT_BLITZ_MOVE, then pauses for flavor choice before the terminal block.
            if (st === 'BLITZ') {
              // Owner ruling: the end-activation dialog owns interaction until it resolves; a target click behind it
              // must not start (or resume) the movement plan.
              if (endActConfirm.value) return;
              if (!gameStore.isPlanActive()) {
                const blockKind = o66PendingBlitzBlockKind.value;
                if (gameStore.startPlan({ playerId: atk, actKind: 'blitz', route: path, targetPlayerId: ix.defenderId, blockKind: blockKind ?? null })) {
                  // The plan now owns the copied flavor. Consume both view-side marks so neither can reach a later
                  // plain blitz; the activation-end and clearO66Arms guards remain the cancellation backstops.
                  o66PendingBlitzBlockKind.value = null;
                  o66ExplicitBlockChoice.value = null;
                }
              }
            }
            // Preserve ix.blockKind; the server selects special block behavior from CLIENT_BLOCK flags.
            else if (st === 'BLOCK') o66SendStandaloneBlock(atk, ix.defenderId, ix.blockKind ?? o66PendingBlockKind.value);
            else gameStore.sendBlock(atk, ix.defenderId, o66BlockFlags(ix.blockKind ?? o66PendingBlockKind.value));
          }
          o66PendingBlockKind.value = null; o66AggroStage.value = null;
          return;
        }
        // A.5 (o66j #8): FOUL / HAND-OFF / PASS target clicks (the acting player already declared the moving
        // variant + optionally walked; these send the trailing command, state = ack).
        if (ix.kind === 'foulTarget') { gameStore.sendFoulTarget(ix.defenderId); return; }
        // Hand-off to an already adjacent receiver commits on one click; there is no durable two-click arm.
        if (ix.kind === 'handOverTarget') {
          gameStore.sendHandOverTarget(ix.catcherId); o66PendingHandOff.value = null;
          return;
        }
        if (ix.kind === 'passTarget') {
          // Receiver-click Pass uses the same two-click nominate/confirm rail as square targeting.
          nominateOrConfirmThrow(ix.square, 'pass');
          return;
        }
        // Gaze first confirms one range-free declaration; only that locked victim can later send.
        {
          const gazeActing = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
          const gst = deriveClientState(g, o66Ctx());
          if ((gst === 'GAZE_MOVE' || gst === 'GAZE') && gazeActing && gameStore.iControl(gazeActing)) {
            if (endActConfirm.value) return;
            const gazeClick = gazeTargetClick(gameStore.state.gazeIntent, o66PendingGaze.value, playerId);
            if (gazeClick === 'confirmDeclared') {
              confirmDeclaredGaze();
              return;
            }
            if (gazeClick === 'confirmCandidate' && gameStore.hasGazeTargetDeclaration()) {
              confirmPendingGazeDeclaration();
              return;
            }
            if (gazeClick === 'nominate' && gameStore.hasGazeTargetDeclaration() && gameStore.nominateGazeTarget(playerId)) {
              o66PendingGaze.value = playerId;
              return;
            }
          }
        }
        // Owner o66am: THROW/KICK TEAM-MATE (pass-rail) — after declaring, click an OWN Right Stuff team-mate to PICK
        // THEM UP: walk to contact (dodge-aware) if not adjacent, then CLIENT_THROW_TEAM_MATE{thrownPlayerId}. The
        // landing targets (pass range) then arm; a click on a target square lands the throw (onTilePick above).
        {
          const ttmActing = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
          const tst = deriveClientState(g, o66Ctx());
          if (isThrowMateState(tst) && ttmActing && !o66ThrownMate.value && playerId !== ttmActing && gameStore.iControl(playerId)) {
            if (endActConfirm.value) return;
            const mate = (g.teamHome.playerArray as { playerId: string; skillArray?: string[] }[]).find((p) => p.playerId === playerId)
              ?? (g.teamAway.playerArray as { playerId: string; skillArray?: string[] }[]).find((p) => p.playerId === playerId);
            const rightStuff = (mate?.skillArray ?? []).some((s) => s.toLowerCase().replace(/[^a-z]/g, '') === 'rightstuff');
            if (rightStuff) {
              const msq = normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
                .find((d) => d.playerId === playerId)?.playerCoordinate);
              const path = msq ? (renderer?.o66PathToContact(ttmActing, msq) ?? []) : [];
              // ORDER 66 (#6.4): walk-to-contact→pickup via the planner queue (no blind timer; pickup fires from
              // the arrival square). Already declared throwTeamMateMove (menu) → the queue skips the re-declare.
              // The LANDING stays a separate user click (o66ThrowMateLand); o66ThrownMate arms it as before.
              gameStore.startPlan({ playerId: ttmActing, actKind: tst === 'KICK_TEAM_MATE' ? 'kickTeamMate' : 'throwTeamMate', route: path, targetPlayerId: playerId });
              o66ThrownMate.value = playerId;
              o66PendingThrowKind.value = 'throwTeamMate';
              return;
            }
          }
        }
        // FOUL (triage #3, owner 08-11 — fouls ride the blitz rail): after declaring Foul from the menu (state FOUL),
        // a click on a DOWN enemy boots it. An ADJACENT victim boots on one click via the router's foulTarget above
        // (the coach walked the plan to contact). A DISTANT victim uses a 2-click like Gaze: 1st NOMINATES (gate on
        // reachability so we never arm a doomed plan; plot the walk-to-contact + 🥾 AV+ cue), 2nd on the SAME victim
        // EXECUTES from the PLANNED path (o66PendingMove waypoints honored; auto-route only as the no-plan fallback).
        // foulMove is already declared, so a walk plan skips the re-declare; an already-adjacent boot goes straight
        // through sendFoulTarget (avoiding the foul/foulMove variant re-declare).
        {
          const foulActing = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
          const fpd = (g.fieldModel.playerDataArray as { playerId: string; playerState?: number; playerCoordinate?: unknown }[]).find((d) => d.playerId === playerId);
          const fbase = (fpd?.playerState ?? 0) & 0xff;
          if (deriveClientState(g, o66Ctx()) === 'FOUL' && foulActing && !gameStore.iControl(playerId) && (fbase === 3 || fbase === 4)) {
            if (endActConfirm.value) return;
            const vsq = normSquare(fpd?.playerCoordinate);
            const reach = vsq ? renderer?.o66ContactReach(foulActing, vsq) : null;
            if (o66PendingFoul.value === playerId) {
              // 2nd click: EXECUTE. Honor a plotted adjacent route; else auto-route to contact.
              const planned = o66PendingMove.value?.route ?? null;
              const lastSq = planned && planned.length > 0 ? planned[planned.length - 1] : null;
              const adjToVictim = !!(lastSq && vsq && Math.max(Math.abs(lastSq[0] - vsq[0]), Math.abs(lastSq[1] - vsq[1])) === 1);
              const foulRoute = adjToVictim ? planned! : (reach?.path ?? []);
              if (foulRoute.length > 0) gameStore.startPlan({ playerId: foulActing, actKind: 'foul', route: foulRoute, targetPlayerId: playerId });
              else gameStore.sendFoulTarget(playerId);
              o66PendingFoul.value = null; o66PendingMove.value = null; renderer?.setO66Path([]);
              return;
            }
            // 1st click: NOMINATE — never arm a doomed plan (o66ContactReach); teach WHY, plot the walk + 🥾 cue.
            if (reach && reach.status !== 'PATH') {
              const p = vsq ? renderer?.squareToCanvas(vsq) : null;
              showToast(reach.status === 'SURROUNDED' ? "Can't foul — the victim is surrounded" : "Can't foul — too far to reach this turn",
                p?.x ?? 200, (p?.y ?? 200) - 20, 2200);
              o66PendingFoul.value = null;
              return;
            }
            o66PendingFoul.value = playerId;
            setO66PathFromOrigin(playerSquareById(foulActing), reach?.path ?? [], foulActing);
            return;
          }
        }
        // Owner o66ah CLICK-TO-ACT: while acting in MOVE, ADJACENT-enemy Block retains its staging, DISTANT-standing
        // Blitz stages then declares on confirm, and DOWN-enemy Foul stays menu-only.
        {
          const actActingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
          if (actActingId && !gameStore.iControl(playerId) && deriveClientState(g, o66Ctx()) === 'MOVE') {
            const pd = (g.fieldModel.playerDataArray as { playerId: string; playerState?: number; playerCoordinate?: unknown }[]).find((d) => d.playerId === playerId);
            const base = (pd?.playerState ?? 0) & 0xff;
            const enemySq = normSquare(pd?.playerCoordinate);
            if (base === 3 || base === 4) { // DOWN (prone/stunned) enemy → FOUL is MENU-ONLY now (triage #3, owner
              // 08-11: fouls ride the blitz rail — declare from the context menu, then boot in FOUL state). The old
              // MOVE-state click-to-declare-foul retires (same shape as the auto-blitz retirement); teach the coach.
              const p = enemySq ? renderer?.squareToCanvas(enemySq) : null;
              showToast('Declare Foul from the player menu before choosing a victim', p?.x ?? 200, (p?.y ?? 200) - 20, 2600);
              o66PendingFoul.value = null;
              return;
            }
            o66PendingFoul.value = null;
            // reroute-P3 (Yularen ruling (a), owner): a player on a COMMITTED plain Move (currentMove>0 +
            // playerAction 'move') can't block/blitz — a re-declare is server-IGNORED (#23). Replace the SILENT
            // refusal with teachable feedback; correctness stays on Tarkin's store gate (store.ts:7262).
            {
              const ap = g.actingPlayer as { currentMove?: number; playerAction?: string } | undefined;
              if (Number(ap?.currentMove ?? 0) > 0 && String(ap?.playerAction ?? '') === 'move') {
                const p = enemySq ? renderer?.squareToCanvas(enemySq) : null;
                showToast("Can't block after moving — a Blitz must be declared before moving", p?.x ?? 200, (p?.y ?? 200) - 20, 2600);
                return;
              }
            }
            const adjacent = adjacentStandingEnemyIds(g, actActingId).includes(playerId);
            if (!adjacent && endActConfirm.value) return;
            // #93 (owner): a BLITZ (distant enemy) can only target a player that canBeBlocked (STANDING||MOVING) —
            // a downed enemy is not a valid blitz target (upstream isBlockable→canBeBlocked). Block is already safe
            // (adjacent = STANDING-only). Without this, click-to-act would initiate a blitz against a prone enemy
            // and would have pre-armed a target past the router gate. Teachable toast, no declare.
            if (!adjacent && !canBeBlocked(g, playerId)) {
              const p = enemySq ? renderer?.squareToCanvas(enemySq) : null;
              showToast('Can’t blitz a downed player — a blitz can only target a standing enemy', p?.x ?? 200, (p?.y ?? 200) - 20, 2600);
              return;
            }
            if (!adjacent) {
              // FUMBBL keeps the context-menu-first declaration. Modern restores the left-click planner:
              // click 1 nominates + previews a waypoint-aware route; click 2/Confirm commits it.
              if (settings.declareBlitzBehavior !== 'modern') {
                o66AggroStage.value = null;
                showQuickClickBlitzUnavailable(playerId, 'modern');
                return;
              }
              if (blitzUsedActingSide(g)) {
                o66AggroStage.value = null;
                showQuickClickBlitzUnavailable(playerId, 'used');
                return;
              }
              const blitzAction = quickClickBlitzAction(g, o66Ctx(), actActingId, playerId);
              if (!blitzAction) {
                o66AggroStage.value = null;
                showQuickClickBlitzUnavailable(playerId);
                return;
              }
              const route = previewLeftClickBlitzRoute(actActingId, playerId);
              if (!route) {
                o66AggroStage.value = null;
                showQuickClickBlitzUnavailable(playerId, 'unreachable');
                return;
              }
              const from = playerSquareById(actActingId);
              const destination = route.at(-1) ?? from;
              if (destination) o66PendingMove.value = { dest: destination, route };
              setO66PathFromOrigin(from, route, actActingId);
              o66PendingBlock.value = null;
              o66AggroStage.value = { kind: 'blitz', target: playerId, stage: 1 };
              return;
            }
            const st = o66AggroStage.value;
            // #18b (owner OPTION i; Meero SR-4 re-review, RR-2/RR-3/RR-4/RR-5 + MC-1/3): DECLARE-AT-PREVIEW.
            const inBlock = !!st && st.kind === 'block';
            if (!inBlock) {
              // First plain-block target click declares Block so server dice decorations broadcast; second click confirms.
              if (Number((g.actingPlayer as { currentMove?: number } | undefined)?.currentMove ?? 0) === 0) {
                o66PendingBlockKind.value = null; // plain block — special kinds arrive via the context-menu declare
                gameStore.declareAction(actActingId, 'block');
              }
              o66AggroStage.value = { kind: 'block', target: playerId, stage: 2 };
              return;
            }
            if (st!.target !== playerId) {
              // RE-TARGET among the already-broadcast adjacent defenders → purely LOCAL highlight, NO re-declare
              // (MB-1 resolved by construction: the dice for every adjacent target are already on the wire).
              o66AggroStage.value = { kind: 'block', target: playerId, stage: 2 };
              return;
            }
            // SECOND click on the SAME target → COMMIT via the standalone-block chooser seam (RR-2: the declare
            // already fired at first-click; state-IS-the-ack; this is commit-only, NOT playerBlock which would re-declare).
            o66SendStandaloneBlock(actActingId, playerId, o66PendingBlockKind.value);
            o66AggroStage.value = null;
            return;
          }
          o66PendingBlock.value = null; o66AggroStage.value = null; // any other click cancels a pending preview/stage
        }
        if (ix.kind === 'inspect') {
          o66InspectedOpponent.value = ix.playerId;
          showPopup(ix.playerId);
          return;
        }
        // High Kick uses the player-pick route; otherwise left-click auto-declares Move for a fresh/switchable standing player, while other actions use the menu.
        if (ix.kind === 'openActionMenu') {
          // SR-244: an acting-player self-click in a declared state is an explicit menu request. Render it for a
          // standing actor too; the standing-player auto-Move shortcut below is only for a fresh/switch declare.
          const acting = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
          if (settings.leftClickOpensContextMenu && ix.playerId !== acting) {
            showFriendlyLeftClickMenu(ix.playerId, clickX, clickY);
            return;
          }
          if (ix.playerId === acting && deriveClientState(g, o66Ctx()) !== 'SELECT_PLAYER') {
            const refresh = () => {
              const next = o66PlayerClick(g, o66Ctx(), ix.playerId, (pid) => gameStore.iControl(pid));
              if (next.kind === 'openActionMenu') {
                ctxMenu.items = o66ActionMenuItems(withoutOwnedWideRailLegacyRows(next.actions), ix.playerId, refresh);
              }
            };
            const items = o66ActionMenuItems(withoutOwnedWideRailLegacyRows(ix.actions), ix.playerId, refresh);
            placeCtxMenu(items, clickX, clickY, ix.playerId);
            // Owner ruling 08-17: the stat card is additive display only during the coach's own turn — it must
            // not touch routing, so it's shown AFTER the menu is placed (menu z-index 30 > card z-index 10 wins
            // any overlap unchanged, same precedence as the off-turn card vs. other overlays).
            showPopup(ix.playerId);
            return;
          }
          // Clicking an owned prone player opens the legal action menu without sending; the selected action folds stand-up.
          const cpd = (g.fieldModel.playerDataArray as { playerId: string; playerState?: number }[]).find((d) => d.playerId === ix.playerId);
          const cbase = (cpd?.playerState ?? 0) & 0xff;
          if (cbase === 3 || cbase === 4) {
            const refresh = () => {
              const next = o66PlayerClick(g, o66Ctx(), ix.playerId, (pid) => gameStore.iControl(pid));
              if (next.kind === 'openActionMenu') {
                ctxMenu.items = o66ActionMenuItems(withoutOwnedWideRailLegacyRows(next.actions), ix.playerId, refresh);
              }
            };
            const items = o66ActionMenuItems(withoutOwnedWideRailLegacyRows(ix.actions), ix.playerId, refresh);
            if (items.length === 0) items.push({ label: 'No actions available', disabled: true });
            placeCtxMenu(items, clickX, clickY, ix.playerId);
            showPopup(ix.playerId);
            return;
          }
          // Owner 08-20: activation-menu property carriers must choose an explicit parent action before the
          // after-ACK skill election. Suppress only the standing left-click auto-Move shortcut; render the same
          // server-derived legal declare list the right-click menu already uses. Ordinary players are unchanged.
          if (hasWideRailActivationRule(g, ix.playerId)) {
            const items = o66ActionMenuItems(withoutOwnedWideRailLegacyRows(ix.actions), ix.playerId, () => {});
            if (items.length === 0) items.push({ label: 'No actions available', disabled: true });
            placeCtxMenu(items, clickX, clickY, ix.playerId);
            showWideRailAvailabilityNotice(g, ix.playerId, ix.actions, clickX, clickY);
            showPopup(ix.playerId);
            return;
          }
          // Owner 2026-07-14 (#5): a single LEFT-click on an own STANDING player declares Move directly (the
          // two-click move confirm still gates the actual step). Players with no Move (off-pitch) fall to the popup.
          if (ix.actions.some((a) => a.kind === 'declare' && a.action === 'move')) {
            if (endActConfirm.value) return;
            gameStore.declareAction(ix.playerId, 'move');
            showPopup(ix.playerId);
            return;
          }
        }
      }
    }
    showPopup(playerId);
  };
  // Owner 2026-07-03: the coach clicks a candidate push square (gold arrow) to
  // choose the push direction — sends the real clientPushback.
  renderer.onPushChoice = (coord) => gameStore.resolvePushback(coord);
  // Owner 2026-07-04 (interaction catalog 0.1): an armed player-pick — a tap on an
  // eligible player's crosshair answers it (Decline lives on the pick bar).
  // g478 #1: during HIGH_KICK the same crosshair mechanism arms the eligible nominees, so a tap here is a High
  // Kick nomination (single-slot swap), NOT a legacy reactive playerChoice — branch before resolvePlayerPick.
  renderer.onPlayerPick = (playerId) => {
    const g = gameStore.game.value;
    if (settings.order66 && gameStore.isPlaying.value && g && deriveClientState(g, o66Ctx()) === 'HIGH_KICK') {
      o66NominateHighKick(playerId);
      return;
    }
    gameStore.resolvePlayerPick(playerId);
  };
  // Owner 2026-07-14 (#5): the double-click stand gesture is RETIRED in o66 — a single left-click already
  // declares Move (incl. stand-up-into-move for a prone player), so the first click of any double-click has
  // already declared Move. o66 double-clicks are a no-op here; legacy (non-o66) hosts keep their double-click
  // behaviour (empty-square reset camera) handled by the renderer when this hook takes no action.
  renderer.onPlayerDoubleClick = () => {
    /* o66: intentionally inert — single-click declares Move (#5). */
  };
  // Owner 2026-07-04c: foul/handoff/pass — hover roll tip + confirm modal + wire.
  renderer.onActionHover = (tip) => {
    if (!tip) { actionTip.visible = false; return; }
    actionTip.visible = true;
    actionTip.mode = tip.mode;
    actionTip.text = tip.text;
    actionTip.x = tip.canvasX + 16;
    actionTip.y = tip.canvasY + 20;
  };
  renderer.onActionTarget = (req) => {
    actionModal.value = req ? { seq: req.seq, mode: req.mode, targetId: req.targetId, rollText: req.rollText } : null;
    // Owner 2026-07-04f: FOULS surface the confirm AWAY from the foul spot (the
    // opposite host corner from the target) so it never obscures the action;
    // pass/hand-off keep the near-target anchor. Both are movable + resizable.
    if (req && renderer) {
      const p = renderer.squareToCanvas(req.targetSquare as [number, number]);
      const host = pitchHost.value;
      if (p && host) {
        if (req.mode === 'foul') {
          actionModalPos.value = {
            x: p.x < host.clientWidth / 2 ? host.clientWidth - 190 : 20,
            y: p.y < host.clientHeight / 2 ? host.clientHeight - 150 : 20,
          };
        } else {
          actionModalPos.value = {
            x: Math.max(4, Math.min(p.x - 60, host.clientWidth - 130)),
            y: Math.max(4, Math.min(p.y - 96, host.clientHeight - 96)),
          };
        }
      }
    } else {
      actionModalPos.value = null;
    }
    actionTip.visible = false; // the anchored modal replaces the cursor tip once armed
  };
  renderer.onActionConfirm = ({ mode, actorId, targetId, targetSquare, path }) => {
    actionModal.value = null;
    actionTip.visible = false;
    const p = path as [number, number][];
    // LEGACY ONLY (order66=off): this action-modal hotbar is hidden in Order 66 (template v-if !settings.order66),
    // so o66 play NEVER reaches here — the o66 foul/pass teleport fix lives in onPlayerClick/onTilePick via
    // startPlan (the planner queue). Keep the legacy imperative macros for the order66=off planner path.
    if (mode === 'foul') gameStore.playerFoul(actorId, targetId, p);
    else if (mode === 'handoff') gameStore.playerHandOff(actorId, targetId, p);
    else gameStore.playerPass(actorId, targetSquare as [number, number], p);
  };
  renderer.auraDPMode = settings.auraDisturbingPresence;
  renderer.auraPMUMode = settings.auraPickMeUp;
  renderer.friendlyIsHome = gameStore.myTeamIsHome.value ?? true; // play: local coach = friendly (blue)
  // Owner 2026-07-04e: coordinate tile pick — a clicked crosshair square answers it. Case 421: a
  // TRICKSTER pick takes precedence (relocate the tricked player); else the unknown-call coordinate.
  renderer.onTilePick = (coord) => {
    if (wideRailActivationPrompt.value) return;
    if (gameStore.state.failedActionHold && gameStore.isPlaying.value) return; // owner 09-06: hold clicks while a failed roll drains
    if (o66PendingLeftClickBlitzPlan.value) return;
    if (settings.order66 && gameStore.isPlaying.value && o66InspectedOpponent.value) {
      const inspectingGame = gameStore.game.value;
      if (inspectingGame) dismissO66OpponentInspection(inspectingGame);
      return;
    }
    // Fives lane 08-19: a square click is an explicit cancel of an undeclared quick-Blitz stage.
    if (o66AggroStage.value?.kind === 'blitz') o66AggroStage.value = null;
    const c = coord as [number, number];
    // Legacy server-armed picks (Trickster / unknown-call coordinate) take precedence — dialog-driven.
    if (gameStore.state.squarePick) {
      if (gameStore.state.squarePick.kind === 'wizard' && gameStore.state.squarePick.skill === 'Fireball') {
        nominateOrConfirmThrow(c, 'fireball');
      } else {
        renderer?.setTilePick(false);
        gameStore.resolveSquarePick(c);
      }
      return;
    }
    if (unknownPickingTile.value) { renderer?.setTilePick(false); unknownPickingTile.value = false; gameStore.resolveUnknownCoordinate(c); return; }
    // ORDER 66 (A.2): otherwise a move-square click steps the acting player (the o66MoveSquares watch keeps the
    // overlay armed; do NOT disarm here — the next moveSquareArray sync re-arms with the new squares).
    if (settings.order66 && gameStore.isPlaying.value) {
      const g = gameStore.game.value;
      if (g) {
        const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
        const st = deriveClientState(g, o66Ctx());
        // #91: a floor-tile click during a DECLARED-but-UNCONFIRMED blitz (SELECT_BLITZ_TARGET ∧ blitzUsed===false)
        //   surfaces the convert-to-move modal instead of moving (owner "click a floor tile to walk"). Gate on a
        //   walkable reach tile so this is a genuine move gesture; enemy clicks route to onPlayerClick (target
        //   select) untouched. The gate is the BM-1/BM-2 fail-safe intersection — never on a consumed blitz.
        if (st === 'SELECT_BLITZ_TARGET' && actingId && !blitzUsedActingSide(g)
            && (renderer?.o66Reach(actingId)?.squares ?? []).some((s) => s[0] === c[0] && s[1] === c[1])) {
          blitzMoveModalTile.value = c;
          return;
        }
        // Hit & Run accepts one server-offered adjacent square per click and finishes by clicking the acting player.
        if (st === 'HIT_AND_RUN' && actingId) {
          if (serverMoveSquares(g).some((s) => s[0] === c[0] && s[1] === c[1])) gameStore.o66Move(actingId, [c]);
          return;
        }
        // SWOOP glide (P1 fix, game 864 sighting): once `skillUse` is answered `true`, StepSwoop offers the
        // 4 candidate squares as ordinary moveSquares (UtilServerPlayerSwoop.java:16-33) and waits for
        // clientSwoop{targetCoordinate} — a click on one of THOSE squares sends it (never client-predicted).
        if (st === 'SWOOP' && actingId) {
          const ix = o66SquareClick(g, o66Ctx(), c);
          if (ix.kind === 'swoopCoordinate') gameStore.sendSwoop(actingId, ix.square);
          return;
        }
        // Star S8: FURIOUS_OUTBURST teleport pick — a server-offered square sends CLIENT_FIELD_COORDINATE
        // (StepFirst-/SecondMoveFuriousOutburst eligibleSquares; the HIT_AND_RUN/SWOOP server-square shape).
        if (st === 'FURIOUS_OUTBURST' && actingId) {
          if (serverMoveSquares(g).some((s) => s[0] === c[0] && s[1] === c[1])) gameStore.sendFieldCoordinate(actingId, c);
          return;
        }
        // After the in-action Punt escalation, the server replaces the walking squares with four punt targets.
        // Route through the pure interaction split so raw `punt` sends CLIENT_FIELD_COORDINATE while `puntMove`
        // continues into the ordinary walk planner below (PuntLogicModule.java:56-69).
        if (st === 'PUNT' && actingId && isPuntTargeting(g)) {
          nominateOrConfirmPunt(g, actingId, c);
          return;
        }
        // First click previews a move-family route; the second commits it. Pass targets outside reach are throws.
        const handleMoveFamilyClick = () => {
          if (isGazeMovementState(st) && !gameStore.hasLiveGazeIntent()) return;
          const fumblerooskieBlitzWalk = fumblerooskieActive.value
            && String((g.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? '') === 'kickEmBlitz';
          // Ball & Chain tile clicks send one aim step; the server owns random scatter and final placement.
          if (st === 'MOVE' && movesRandomly(g, actingId)) {
            gameStore.stepMove(actingId, c);
            return;
          }
          // #113: while LEAPING (jump toggle ON), a click on a server JUMP square is a SINGLE step — the server
          //   resolves the 2-away jump (leaping already set; TK g716 confirmed). A jump is ONE hop, so NOT the
          //   o66Reach auto-path/preview below (that's for MA walks + would route through intermediate squares).
          //   Gate on serverMoveSquares (the flipped jump set) → a non-jump tile is a no-op. Mirrors Ball & Chain.
          if (JUMP_MOVE_STATES.has(st) && (g.actingPlayer as { leaping?: boolean } | undefined)?.leaping) {
            if (serverMoveSquares(g).some((s) => s[0] === c[0] && s[1] === c[1])) gameStore.stepMove(actingId, c);
            return;
          }
          // TTM/KTM LANDING (owner o66am): once the team-mate is PICKED UP, a click on a pass-range square LANDS the
          // throw (2-click confirm reusing the 🏈 cue) — takes precedence over the walk reach (no more walking).
          if (isThrowMateState(st) && o66ThrownMate.value) {
            if (!ttmTargetInTemplate(g, actingId, c)) return;
            nominateOrConfirmThrow(c, 'throwTeamMate');
            return;
          }
          // Free-select PASS treats any in-template tile as a two-click throw target and ignores non-template tiles.
          if (st === 'PASS' && gameStore.state.freeSelectPass) {
            if (passTargetInTemplate(g, actingId, c)) nominateOrConfirmThrow(c, 'pass');
            return;
          }
          // BOMB is stationary: every legal tile click nominates a bomb target before movement routing.
          if (st === 'BOMB') {
            if (passTargetInTemplate(g, actingId, c)) nominateOrConfirmThrow(c, 'bomb');
            return;
          }
          // Owner ruling: while the end-activation dialog is open, pitch clicks cannot create, extend, or commit a
          // movement route. Non-planner tile interactions above remain available and the dialog owns resolution.
          if (endActConfirm.value) return;
          // Same waypoint-anchored reach the overlay paints (owner 08-18) — the click gate can never admit a square
          //   the tint says is out of budget, and the plotted squares stay clickable (confirm / truncate).
          const inReach = (renderer?.o66Reach(actingId, o66PendingMove.value?.route ?? [])?.squares ?? []).some((s) => s[0] === c[0] && s[1] === c[1]);
          if (inReach) {
            const fromPd = (g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
              .find((d) => d.playerId === actingId)?.playerCoordinate;
            const from = normSquare(fromPd);
            const pend = o66PendingMove.value;
            // Owner o66s #10 (FUMBBL planner): a 2nd left-click on the SAME planned destination CONFIRMS; a
            // left-click on a DIFFERENT square EXTENDS the path — route from the LAST PLANNED square to the new
            // one and append (waypoint routing). Right-click clears (handled in the renderer contextmenu).
            const reactingClick = ON_THE_BALL_MOVE_STATES.has(st) ? reactingMovePlanClick(pend?.dest ?? null, c) : null;
            const confirmsPlannedMove = reactingClick === 'confirm'
              || (reactingClick === null && pend !== null && pend.dest[0] === c[0] && pend.dest[1] === c[1]);
            if (confirmsPlannedMove && pend) { // confirm — send the whole path
              if (isBlitzMovementState(st) || fumblerooskieBlitzWalk) gameStore.o66BlitzMove(actingId, pend.route); else gameStore.o66Move(actingId, pend.route);
              o66PendingMove.value = null; renderer?.setO66Path([]);
              return;
            }
            if (pend) {
              // EXTEND from the LAST PLANNED square to the new click (owner o66ad waypoint routing): stitch a
              // segment from pend.dest → c and append, keeping rush/dodge accounting global. Clicking a square
              // already on the plan TRUNCATES back to it. If the detour can't fit the remaining budget, keep the
              // current plan (no-op) rather than snapping to a fresh direct route.
              const combined = renderer?.o66ExtendPath(actingId, pend.route, c) ?? null;
              if (!combined || combined.length === 0) { return; }
              o66PendingMove.value = { dest: c, route: combined };
              setO66PathFromOrigin(from, combined, actingId);
              return;
            }
            const route = renderer?.o66AutoPath(actingId, c) ?? null;
            if (!route || route.length === 0) { // fallback: single step
              if (isBlitzMovementState(st) || fumblerooskieBlitzWalk) gameStore.sendBlitzMove(actingId, c); else gameStore.stepMove(actingId, c);
              return;
            }
            o66PendingMove.value = { dest: c, route }; // preview
            setO66PathFromOrigin(from, route, actingId);
            return;
          }
          // Pass template targeting uses two-click nominate/confirm; changing the square re-nominates.
          if (st === 'PASS') {
            // ORDER 66 (#6.4): if a walk route is planned (waypoints on the pitch), commit the WHOLE thing as ONE
            // sequenced plan — declare→walk→throw, ball flies from the ARRIVAL square (no teleport). The planned
            // path already went through its own waypoint confirm, so it commits directly (not two-click).
            const pend = o66PendingMove.value;
            if (pend && pend.route.length > 0) {
              if (gameStore.startPlan({ playerId: actingId, actKind: 'pass', route: pend.route, targetCoordinate: c })) {
                bridgeActivePassPlan(c, pend.dest);
              }
              o66PendingMove.value = null; renderer?.setO66Path([]);
              o66PendingPass.value = null;
              return;
            }
            // #219/#252 two-click confirm for the STANDING throw — via the shared nominate/confirm helper.
            nominateOrConfirmThrow(c, 'pass');
            return;
          }
          // BOMB (Bombardier — #222/#252, MF-2): the two-click bomb rail (shared helper kind 'bomb' → sendBombTarget,
          //   the bare CLIENT_PASS the server resolves as a bomb, never the #233-gated sendPassTarget) now lives in
          //   the STATIONARY-THROW PRE-EMPT above the inReach walk-planner (#299/SR-253) so an in-reach empty square
          //   can't shadow the bomb into a move step. Nothing to route here — BOMB already returned at that branch.
          return;
        };
        if ((ON_THE_BALL_MOVE_STATES.has(st) || st === 'MOVE' || st === 'PASS' || st === 'PUNT' || st === 'BOMB' || st === 'FOUL' || isBlitzMovementState(st) || st === 'HAND_OVER' || st === 'GAZE_MOVE' || st === 'GAZE' || isThrowMateState(st) || (st === 'PUTRID_REGURGITATION_BLITZ' && putridWalkArmed())) && actingId) {
          handleMoveFamilyClick();
          return;
        }
        if (fumblerooskieActive.value && actingId) {
          handleMoveFamilyClick();
          return;
        }
      }
      return;
    }
    renderer?.setTilePick(false);
  };
  // Owner 2026-07-13: BALL & CHAIN aim — a tap on an orthogonal arrow tip is a single AIM step (facing). Send
  // one stepMove (CLIENT_MOVE from→aim); the server rolls the throw-in template and scatters (phase 2 surfaces
  // the d6 + destination). No preview / optimistic placement — the token renders from the server's scatter sync.
  renderer.onBncAim = (coord) => {
    const g = gameStore.game.value;
    if (!g || !settings.order66 || !gameStore.isPlaying.value) return;
    const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    if (!actingId) return;
    const st = deriveClientState(g, o66Ctx());
    if (st === 'MOVE' && movesRandomly(g, actingId)) gameStore.stepMove(actingId, coord as [number, number]);
    else if (st === 'PUNT' && isPuntTargeting(g)) nominateOrConfirmPunt(g, actingId, coord as [number, number]);
    else if (st === 'SWOOP') gameStore.sendSwoop(actingId, coord as [number, number]);
  };
  // Owner ⑩ (08-12): feed the pass/bomb targeting tooltip — fires on pointermove over any on-pitch square while
  // pass/bomb free-select is armed (null off-pitch / on mode-exit). The watch above derives the throw/catch roll.
  renderer.onSquareHover = (coord) => {
    passBombHoverSq.value = coord as [number, number] | null;
    const g = gameStore.game.value;
    const state = g ? deriveClientState(g, o66Ctx()) : '';
    const actingId = String((g?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    const from = hailMaryPassRulerFrom()
      ?? (isThrowMateState(state) && o66ThrownMate.value && actingId ? playerSquareById(actingId) : null);
    const hovered = coord as [number, number] | null;
    const rulerTarget = hovered && g && isThrowMateState(state) && o66ThrownMate.value && actingId
      ? (ttmTargetInTemplate(g, actingId, hovered) ? hovered : null)
      : hovered;
    if (from) renderer?.setPassRuler(from, rulerTarget);
  };
  renderer.setPassRuler(hailMaryPassRulerFrom(), null);
  // Owner 2026-07-04d: bomb/Throw-Keg — clicking the 3×3 blast centre confirms.
  renderer.onBombTarget = (centre) => {
    const attackerId = renderer?.getSelectedPlayerId();
    if (!attackerId) return;
    renderer?.setActionMode('auto');
    renderer?.setBombTarget(null);
    // CT-1409 review batch: a bomber never moves (no throwBombMove) — drop the stale getPlannedPath() read.
    if (gameStore.isPlaying.value) gameStore.playerThrowBomb(attackerId, centre as [number, number]);
    else { gameStore.state.bombBlast = { square: centre as [number, number], seq: (gameStore.state.bombBlast?.seq ?? 0) + 1 }; }
  };
  // path-planning clicks shouldn't leave a stale stats card behind
  renderer.onSelectionChange = (playerId) => {
    // Owner 09-08: an empty-square click while an opposition token is inspected during MY activation hands the
    // selection back to the actor (the renderer only deselects; the opponent's turn keeps the plain deselect).
    if (!playerId && o66InspectedOpponent.value && gameStore.game.value && dismissO66OpponentInspection(gameStore.game.value)) {
      hasSelection.value = !!renderer?.getSelectedPlayerId();
      plannedAction.value = null;
      if (!hasSelection.value) popup.visible = false;
      return;
    }
    hasSelection.value = !!playerId;
    plannedAction.value = null;
    if (!playerId) popup.visible = false;
  };
  renderer.onWaypointPlanCancel = () => {
    clearO66Arms();
    ctxMenu.visible = false;
  };
  renderer.onContextMenu = openContextMenu;
  renderer.onActionRejected = showToast;
  // Owner o66an: a click on the hovered ball-crosshair kick square sends the kick-off.
  renderer.onKickPick = (coord) => gameStore.resolveKickPlacement(coord as [number, number]);
  renderer.onBlockConfirm = (attackerId, defenderId, preview) => {
    // M4.2: in play mode send the REAL block (server rolls + resolves); demo otherwise.
    if (gameStore.isPlaying.value) {
      // Owner 2026-07-09 (C2/C7): a BLITZ moves to contact BEFORE blocking — send the approach path
      // via playerBlitz. A plain block is already adjacent (empty path) → playerBlock. The old code
      // always sent a plain block, so a block requiring movement was rejected server-side (target not
      // adjacent) and never resolved.
      const path = (renderer?.getPlannedPath() ?? []) as [number, number][];
      if (actionMode.value === 'blitz' || path.length > 0) gameStore.playerBlitz(attackerId, defenderId, path);
      else gameStore.playerBlock(attackerId, defenderId);
    } else gameStore.demoBlock(attackerId, defenderId, preview.dice, preview.opponentChoice);
    renderer?.clearSelection();
  };
  renderer.onPathChange = (path) => {
    queuedSteps.value = path.length;
  };
  renderer.onActionModeChange = (mode) => {
    actionMode.value = mode;
  };
  // Mount-after-scatter/reconnect: seed the report-only mask/marker before the first model token render.
  const kickoffScatter = gameStore.state.kickScatterPreview;
  renderer.setServerKickoffScatter(kickoffScatter ? {
    commandNr: kickoffScatter.commandNr, endpoint: kickoffScatter.unreducedEndpoint, seq: kickoffScatter.seq,
  } : null);
  // A mode switch/reconnect/replay mount can begin with an already-successful, still-CONFUSED
  // victim. Seed the report-authoritative set before the first model token is constructed.
  gazeVictimPresentation.publish();
  setGameWithConfirmedMovement(renderer, gameStore.state.confirmedMovementDrainActive, gameStore.game.value);
  // The held-mate watcher can run before Pixi exists on reconnect/mode mount. Reassert the complete shared Pass
  // surface after the authoritative model is installed so the Quick+Short chart is never reduced to a lone ruler.
  syncHeldMatePassSurface();
  // The store may already hold this turn's occurrence when Modern mounts (reconnect, replay/spectate entry,
  // or Classic→Modern). The seq watcher ran before renderer creation, so seed after the initial token render.
  pushBlitzTokens();
  if (gameStore.state.kickDescend) renderer.setKickDescend(gameStore.state.kickDescend);
  // A spectator/reconnect can mount after the store already began a confirmed tile; the seq watch will not replay
  // an unchanged value, so seed the same presentation cursor immediately after the initial model token exists.
  renderer.setPresentationStep(gameStore.state.presentationStep);
  if (gameStore.state.confirmedMovementDrainActive && gameStore.state.movementPresentationFence) {
    renderer.reconcileMovementPresentation(gameStore.state.movementPresentationFence);
  }
  if (gameStore.state.confirmedMovementDrainActive && gameStore.state.boardPresentationFence) {
    renderer.reconcileBoardPresentation(gameStore.state.boardPresentationFence);
  }
  // Owner 2026-07-03: pin the quick config-bar under the top-left coach panel
  // and match its width. Re-measure on window resize and whenever the panel's
  // content changes (turn/inducement chips can alter its width).
  await nextTick();
  if (!rendererMountActive || renderer !== mountedRenderer) return;
  measureTopPanel();
  // Owner 2026-07-06 (finding A): registered here (past `await nextTick()`) so its
  // cleanup can't live inline — torn down in the synchronous onBeforeUnmount below.
  // Owner 2026-07-06: on resize, re-clamp persisted/dragged UI (log window + customize
  // panels) into the viewport so they stay visible, THEN re-measure the config-bar.
  panelMeasureHandler = () => { clampUiToViewport(); measureTopPanel(); };
  window.addEventListener('resize', panelMeasureHandler);
  clampUiToViewport(); // fix any position already off-screen from a prior window size
  watch(
    // Owner 2026-07-05: also re-measure (so the timer re-anchors to the center panel)
    // when the UI reflows — panel moves/resizes (uiLayout), customize mode, the
    // scoreboard appearing, or an orientation change.
    () => [
      homePanel.value,
      awayPanel.value,
      settings.pitchOrientation,
      settings.uiCustomize,
      JSON.stringify(settings.uiLayout),
      settings.bottomBarsSwapped,
      gameStore.state.spectatorCount,
      liveSpectatorsExpanded.value,
      !!hud.value,
    ] as const,
    // Owner 2026-07-06: also re-clamp into the viewport when the panels (re)appear or
    // move — a panel persisted off-screen from a prior window size is pulled back in
    // once it renders. (clamp is a no-op unless something is actually off-screen.)
    () => nextTick(() => { clampUiToViewport(); measureTopPanel(); }),
    { flush: 'post' },
  );
  // Owner 2026-07-04: hand-placement setup is on in the live UI (auto for bots).
  gameStore.setInteractiveSetup(true);
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('keyup', onKeyup);
  window.addEventListener('blur', clearPan); // stop the glide if focus leaves the window
  window.addEventListener('pointerdown', onGlobalPointerDown);
  document.addEventListener('fullscreenchange', syncFullscreenSouthPanRange);
  window.addEventListener('resize', syncFullscreenSouthPanRange);
  syncFullscreenSouthPanRange();
  // dev aid: reachable from the browser console / preview tooling
  if (import.meta.env.DEV) {
    (window as unknown as { __renderer?: PitchRenderer }).__renderer = renderer;
    (window as unknown as { __store?: typeof gameStore }).__store = gameStore;
  }
});

onBeforeUnmount(() => {
  rendererMountActive = false;
  unregisterConfirmedMovementPresentation?.();
  unregisterConfirmedMovementPresentation = null;
  gameStore.setReplayPresentationIdleProbe(null);
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('keyup', onKeyup);
  window.removeEventListener('blur', clearPan);
  window.removeEventListener('pointerdown', onGlobalPointerDown);
  document.removeEventListener('fullscreenchange', syncFullscreenSouthPanRange);
  window.removeEventListener('resize', syncFullscreenSouthPanRange);
  cancelLogResize();
  window.removeEventListener('pointermove', moveSetupBrowser);
  window.removeEventListener('pointerup', endSetupBrowserDrag);
  window.removeEventListener('pointerup', finishSetupBrowserResize);
  cancelAnimationFrame(followupRaf); // followup chip position tracker
  cancelAnimationFrame(blockRerollRaf); // partial-reroll cluster position tracker
  if (renderer) {
    renderer.setSetup(false, null);
    renderer.onSetupClick = null;
    renderer.onDugoutSetupDragStart = null;
  }
  stopKickElectionTracking();
  unregisterKickElection?.();
  unregisterKickElection = null;
  unregisterApothecaryElection?.();
  unregisterApothecaryElection = null;
  // Owner 2026-07-06 (finding A): tear down the log-panel observer + resize handler
  // that the async onMounted couldn't register cleanup for.
  panelResizeObserver?.disconnect();
  panelResizeObserver = null;
  if (panelReanchorHandler) { window.removeEventListener('resize', panelReanchorHandler); panelReanchorHandler = null; }
  if (panelMeasureHandler) { window.removeEventListener('resize', panelMeasureHandler); panelMeasureHandler = null; }
  renderer?.destroy();
  renderer = null;
});

let lastRenderedGameId: number | null = null;
let lastReplaySnapRenderEpoch = 0;
watch(
  gameStore.game,
  (game) => {
    if (gameStore.replay.snapRenderEpoch !== lastReplaySnapRenderEpoch) {
      lastReplaySnapRenderEpoch = gameStore.replay.snapRenderEpoch;
      renderer?.snapReplayFrame();
    }
    if (renderer) setGameWithConfirmedMovement(renderer, gameStore.state.confirmedMovementDrainActive, game);
    // B9-12 G11: a NEW game (fresh join) must re-fit the camera — otherwise it
    // keeps the previous game's pan/zoom. Defer a frame so the layout is ready.
    const gid = (game as { gameId?: number } | null)?.gameId ?? null;
    if (renderer && gid != null && gid !== lastRenderedGameId) {
      requestAnimationFrame(() => renderer?.resetCamera());
      // Owner 2026-07-08: at GAME START, the sign-holders proclaim their love — assign
      // 4 random supporter names to the placards (rendered through pre-game + the game).
      if (GIVE_THANKS.length) {
        const pool = [...GIVE_THANKS].sort(() => Math.random() - 0.5).slice(0, 4);
        renderer.setPregameSigns(pool);
      }
    }
    lastRenderedGameId = gid;
  },
  { flush: 'post' },
);

function connect() {
  ui.browserOpen = false; // Option A: starting a spectate join closes the browser
  gameStore.connect({
    url: settings.url,
    compression: settings.compression,
    ...resolveJoinCreds(),
    gameId: Number(gameId.value),
  });
}

// Manual ID rejoin reuses session credentials and reports a silent miss through the bounded join timeout.
function rejoinByGameId() {
  const id = Number(rejoinGameId.value.trim());
  if (!Number.isInteger(id) || id <= 0) return;
  ui.browserOpen = false; // Option A: starting a rejoin closes the browser, same as connect()/joinPlay()
  void gameStore.rejoinById({
    url: settings.url,
    compression: settings.compression,
    ...resolveJoinCreds(),
    gameId: id,
  });
}

// #210 (owner-endorsed): YOUR GAMES IN PROGRESS — server-derived one-click rejoin rows above the #211
// id-input. The row shape is Veers's config-web contract (POST /api/fork/my-games, DS-1). `inProgress`
// is the distinct-label discriminator (false = scheduled); `started` is null on scheduled rows, so display
// time keys on scheduled-or-started, never `started` alone.
type CoachGameRow = {
  gameId: number;
  status: 'scheduled' | 'starting' | 'active' | 'paused';
  inProgress: boolean;
  started: string | null;
  scheduled: string | null;
  half: number;
  turn: number;
  seat: 'home' | 'away';
  myTeamId: string;
  myTeamName: string;
  opponentCoach: string;
  opponentTeamName: string;
};
const myGames = ref<CoachGameRow[]>([]);
const myGamesLoading = ref(false);
const myGamesError = ref<string | null>(null);
let myGamesLoadedFor = ''; // coach the current list was fetched for — avoids a refetch each modal open

// The data source lives behind THIS one function (Yularen's build note): a future fumbbl.com-backed row
// source can slot in here without touching the panel. Session credential (resolveJoinCreds — TP-1
// session-derived, never a form); an empty coach yields an empty list, not an error.
async function loadMyGames(force = false) {
  const { coach, password } = resolveJoinCreds();
  if (!coach) { myGames.value = []; myGamesError.value = null; myGamesLoadedFor = ''; return; }
  if (!force && myGamesLoadedFor === coach && myGames.value.length) return;
  myGamesLoading.value = true;
  myGamesError.value = null;
  try {
    const d = await botPost('my-games', { coach, password });
    myGames.value = Array.isArray(d.games) ? (d.games as CoachGameRow[]) : [];
    myGamesLoadedFor = coach;
  } catch (e) {
    myGamesError.value = errText(e);
    myGames.value = [];
    myGamesLoadedFor = ''; // a failed load must retry on the next open, not sit cached-empty
  } finally {
    myGamesLoading.value = false;
  }
}

/** One-click REJOIN of an in-progress row — id-join as the coach, identical wire to rejoinByGameId (the
 *  gameId is the only handle; the server matches the seat by coach name). */
function rejoinMyGame(row: CoachGameRow) {
  ui.browserOpen = false;
  void gameStore.rejoinById({
    url: settings.url,
    compression: settings.compression,
    ...resolveJoinCreds(),
    gameId: row.gameId,
  });
}

// Fetch the coach's games when the lobby opens in fork Play mode (and refetch if the coach changed).
watch(
  () => ui.browserOpen && isPlayMode.value && settings.activeServerTarget === 'fork',
  (show) => { if (show) void loadMyGames(); },
  { immediate: true },
);

/** Play mode (owner 2026-07-03 r6f): join/create a game BY NAME on the active
 *  server. Scaffolding for the in-client game joiner that won't rely on the FUMBBL
 *  website — team selection arrives with that joiner, so teamId is empty for now. */
function joinPlay() {
  // owner ruling 2026-08-17: official fumbbl.com replay+live permitted.
  const name = gameName.value.trim();
  if (!name) return;
  ui.browserOpen = false; // Option A: starting a play join closes the browser
  void launchViaBot(resolveJoinCreds(), name, playTeamId.value.trim());
}

/** Request a bot-built fork JNLP for seamless launch; fall back to the equivalent direct join if unavailable. */
async function launchViaBot(creds: { coach: string; password: string }, gameNameStr: string, teamId: string) {
  const log = (text: string) =>
    gameStore.state.log.push({ time: logTimestamp(), kind: 'system', text });
  const directJoin = () => {
    applyServerTarget('fork');
    void gameStore.connectAsPlayer({
      url: forkServerUrl(), compression: activeServerTarget().compression,
      coach: creds.coach, password: creds.password, gameName: gameNameStr, teamId,
    });
  };
  // connectAsPlayer() clears the log on join, so defer the launch note to the next tick so it
  // survives (and lands alongside the connection lines).
  const noteAfterJoin = (text: string) => setTimeout(() => log(text), 0);
  const url = forkJnlpUrl({ coach: creds.coach, teamId, gameName: gameNameStr, password: creds.password });
  try {
    // tauriFetch (desktop) bypasses CORS; window.fetch is the dev-browser path (needs the Bot to
    // send Access-Control-Allow-Origin, or a dev proxy).
    const res = inTauri ? await tauriFetch(url) : await fetch(url);
    if (!res.ok) throw new Error(`bot HTTP ${res.status}`);
    const req = parseJnlp(await res.text());
    if (req.fork && req.mode === 'player' && req.teamId && (req.gameName || req.gameId)) {
      applyServerTarget('fork');
      void gameStore.connectAsPlayer({
        url: forkServerUrl(), compression: activeServerTarget().compression,
        coach: req.coach ?? creds.coach, password: req.password ?? creds.password,
        gameName: req.gameName ?? undefined, teamId: req.teamId, gameId: req.gameId ?? undefined,
      });
      noteAfterJoin(`launch: joined ${req.gameName ? `“${req.gameName}”` : `game ${req.gameId}`} via bot JNLP as ${req.coach ?? creds.coach}`);
      return;
    }
    throw new Error('bot returned an unrecognized JNLP');
  } catch (e) {
    directJoin();
    noteAfterJoin(`launch: bot JNLP unavailable (${errText(e)}) — joined directly`);
  }
}

// --- Owner 2026-07-08: CREATE GAME — team library + matchmaking (docs/fork-team-browser-spec.md) ---
// A coach picks a team from their fork LIBRARY + names an opponent; the Bot pairs reciprocal
// challenges and hands back a JNLP, which we open in-process (same as the Play button).
interface LibraryTeam {
  teamId: string; teamName: string; race: string;
  teamValue?: number; gold?: number; forkLoadable?: boolean;
}
const createGameOpen = ref(false);
const cgOpponent = ref('');
const cgSuggestions = ref<string[]>([]);
const cgLibrary = ref<LibraryTeam[]>([]);
const cgSelectedTeam = ref<LibraryTeam | null>(null);
const cgChooseOpen = ref(false);
const cgIngestInput = ref('');
const cgStatus = ref('');
const cgBusy = ref(false);      // a library/ingest/challenge request is in flight
const cgWaiting = ref(false);   // in the waiting period, polling for a match
let cgPollTimer: ReturnType<typeof setInterval> | null = null;
let cgSuggestTimer: ReturnType<typeof setTimeout> | null = null;

/** Readable text for a thrown value. A Tauri HTTP-scope rejection / a raw network error
 *  is NOT an Error (no `.message`), so `errText(e)` used to read "undefined" —
 *  this always yields something legible. */
function errText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  try { const s = JSON.stringify(e); if (s && s !== '{}' && s !== 'null') return s; } catch { /* noop */ }
  return String(e);
}

function openCreateGame() {
  // owner ruling 2026-08-17: no official-host refusal gate; the visible creator remains fork-only.
  createGameOpen.value = true;
  cgStatus.value = ''; cgSelectedTeam.value = null; cgOpponent.value = '';
  cgSuggestions.value = []; cgWaiting.value = false; cgChooseOpen.value = false;
  void loadLibrary();
}
async function loadLibrary() {
  const coach = resolveJoinCreds().coach;
  if (!coach) { cgStatus.value = 'Set your Super FUMBBL coach name first (Settings → Connection).'; return; }
  try {
    const d = await botGet('library', { coach });
    cgLibrary.value = (d.teams as LibraryTeam[]) ?? [];
    if (cgLibrary.value.length === 0) cgStatus.value = 'Your library is empty — import a team to get started.';
  } catch (e) {
    cgLibrary.value = [];
    cgStatus.value = `Couldn't load your library (${errText(e)}). Is the Tournament Bot reachable?`;
  }
}
function onOpponentInput() {
  if (cgSuggestTimer) clearTimeout(cgSuggestTimer);
  const q = cgOpponent.value.trim();
  if (!q) { cgSuggestions.value = []; return; }
  cgSuggestTimer = setTimeout(async () => {
    try {
      const d = await botGet('coaches', { q, limit: '8' });
      const me = resolveJoinCreds().coach.toLowerCase();
      cgSuggestions.value = ((d.coaches as string[]) ?? []).filter((c) => c.toLowerCase() !== me).slice(0, 8);
    } catch { cgSuggestions.value = []; }
  }, 200);
}
function pickSuggestion(name: string) { cgOpponent.value = name; cgSuggestions.value = []; }
async function ingestTeam() {
  const team = cgIngestInput.value.trim();
  if (!team) return;
  const coach = resolveJoinCreds().coach;
  cgBusy.value = true; cgStatus.value = 'Importing team from FUMBBL…';
  try {
    const d = await botPost('library/ingest', { coach, team });
    cgIngestInput.value = '';
    await loadLibrary();
    const t = d.team as LibraryTeam | undefined;
    cgStatus.value = `✓ Imported “${t?.teamName ?? team}”.`
      + (d.raceWarning ? ` ⚠ ${String(d.raceWarning)}` : '')
      + (d.needsRestart ? ' (playable after the next fork restart)' : '');
  } catch (e) {
    cgStatus.value = `Import failed (${errText(e)}).`;
  } finally { cgBusy.value = false; }
}
function selectTeam(t: LibraryTeam) { cgSelectedTeam.value = t; cgChooseOpen.value = false; }
async function startChallenge() {
  const team = cgSelectedTeam.value;
  const opponent = cgOpponent.value.trim();
  if (!team) { cgStatus.value = 'Choose a team first.'; return; }
  if (!opponent) { cgStatus.value = 'Enter an opponent name.'; return; }
  const creds = resolveJoinCreds();
  cgBusy.value = true; cgStatus.value = '';
  try {
    const d = await botGet('challenge', { coach: creds.coach, teamId: team.teamId, opponent, password: creds.password });
    cgBusy.value = false;
    if (d.status === 'matched') { onMatched(d); return; }
    cgWaiting.value = true;
    cgStatus.value = `Waiting for ${opponent} to accept the challenge…`;
    startMatchPoll();
  } catch (e) {
    cgBusy.value = false;
    cgStatus.value = `Couldn't start the challenge (${errText(e)}).`;
  }
}
function startMatchPoll() {
  stopMatchPoll();
  const coach = resolveJoinCreds().coach;
  cgPollTimer = setInterval(async () => {
    try { const d = await botGet('matchstatus', { coach }); if (d.status === 'matched') onMatched(d); }
    catch { /* transient — keep polling */ }
  }, 2000);
}
function stopMatchPoll() { if (cgPollTimer) { clearInterval(cgPollTimer); cgPollTimer = null; } }
function onMatched(d: Record<string, unknown>) {
  stopMatchPoll(); cgWaiting.value = false;
  const opponent = String(d.opponent ?? '');
  const jnlp = d.jnlp as string | undefined;
  if (jnlp) {
    const req = parseJnlp(jnlp);
    if (req.fork && req.mode === 'player' && req.teamId && (req.gameName || req.gameId)) {
      cgStatus.value = `Matched with ${opponent} — launching ${req.gameName ? `“${req.gameName}”` : `game ${req.gameId}`}…`;
      createGameOpen.value = false; ui.browserOpen = false;
      applyServerTarget('fork');
      // Server-SCHEDULED match: buildForkJnlp embeds the scheduled -gameId → join that specific game.
      void gameStore.connectAsPlayer({
        url: forkServerUrl(), compression: activeServerTarget().compression,
        coach: req.coach ?? resolveJoinCreds().coach, password: req.password ?? resolveJoinCreds().password,
        gameName: req.gameName ?? undefined, teamId: req.teamId, gameId: req.gameId ?? undefined,
      });
      return;
    }
  }
  cgStatus.value = `Matched with ${opponent}, but the server returned no valid JNLP.`;
}
async function cancelChallenge() {
  stopMatchPoll(); cgWaiting.value = false;
  const coach = resolveJoinCreds().coach;
  try { await botGet('cancel', { coach }); } catch { /* best effort */ }
  cgStatus.value = 'Challenge cancelled.';
}
onBeforeUnmount(() => { stopMatchPoll(); if (cgSuggestTimer) clearTimeout(cgSuggestTimer); });

// --- B3-9: FUMBBL game browser + ffblive.jnlp intake ---
const browserMatches = ref<BrowserMatch[]>([]);
const browserStatus = ref('');
const jnlpInput = ref<HTMLInputElement | null>(null);
// Owner 2026-07-06: filter the live-game list by ANY rendered string (id, team names,
// coaches, races, score, half/turn) — e.g. typing "hype261" narrows to that game.
const browserFilter = ref('');
// Owner 2026-07-14: the standalone Spectate "Game id" box is folded into the FILTER bar. In spectate mode,
// pressing Enter on a purely-numeric filter spectates that game id directly (for a game not in the list);
// otherwise the filter just narrows the browser list, and users double-click a row to spectate.
function onFilterEnter() {
  if (isPlayMode.value) return;
  const t = browserFilter.value.trim();
  if (/^\d+$/.test(t)) { gameId.value = Number(t); connect(); }
}
const filteredMatches = computed(() => {
  // Owner 2026-07-08: NEWEST → OLDEST by game progress — pre-game (half 0) at the top,
  // a further-along game (e.g. H2 T8) at the bottom. Key = half*100 + turn, ascending.
  const progress = (m: BrowserMatch) => (m.half ?? 0) * 100 + (m.turn ?? 0);
  const sorted = [...browserMatches.value].sort((a, b) => progress(a) - progress(b));
  const q = browserFilter.value.trim().toLowerCase();
  if (!q) return sorted;
  return sorted.filter((m) => {
    const extra = m as unknown as { division?: string; scheduler?: string };
    const hay = [
      m.id, extra.division, extra.scheduler, `h${m.half}`, `t${m.turn}`,
      ...m.teams.flatMap((t) => [t.name, t.coach, t.race, t.side, t.score]),
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
});

// Owner 2026-07-03: while the browser is open, poll the selected server every 30s
// and MERGE updates into the shown rows in place (scores/half/turn update on
// screen, new games appear, ended ones drop) — no full-list rebuild. Auto-stops
// after 5 minutes so an idle browser doesn't poll forever.
const BROWSER_POLL_MS = 30000;
const BROWSER_POLL_MAX_MS = 300000; // 5 minutes
let browserPollTimer: ReturnType<typeof setInterval> | null = null;
let browserPollStopTimer: ReturnType<typeof setTimeout> | null = null;
const browserPolling = ref(false);

// owner 2026-07-03 r6f Option A: the browser open state lives in the shared ui
// store so the header "Browse" button (App.vue) can toggle it. Refresh the live
// list whenever it opens, and start the 30s in-place poll.
watch(() => ui.browserOpen, (open) => {
  if (open) {
    void refreshBrowser();
    startBrowserPoll();
  } else {
    stopBrowserPoll();
  }
});
// owner 2026-07-09: the FUMBBL/Super FUMBBL server toggle now lives in the header (App.vue). When the
// active server changes while the browser is open, reload the list + restart the poll for it.
watch(() => settings.activeServerTarget, () => {
  if (ui.browserOpen) {
    void refreshBrowser();
    startBrowserPoll();
  }
});
onBeforeUnmount(() => stopBrowserPoll());

/** Load the browser's live-game list for the ACTIVE server (owner 2026-07-03 r6f).
 *  Official FUMBBL publishes a match list; the local Super FUMBBL fork has no website
 *  match API, so it points the user at Game id / Load demo instead. */
async function refreshBrowser() {
  if (settings.activeServerTarget !== 'fumbbl') {
    browserMatches.value = [];
    browserStatus.value =
      'The local Super FUMBBL server has no live-game list — enter a Game id and Spectate, or Load demo.';
    return;
  }
  browserStatus.value = 'Loading live games…';
  try {
    const res = await fetch(`${FUMBBL_SITE}/api/match/current`);
    browserMatches.value = (await res.json()) as BrowserMatch[];
    browserStatus.value = browserMatches.value.length ? '' : 'No live games right now.';
  } catch (error) {
    browserStatus.value = `Failed to load: ${error instanceof Error ? error.message : error}`;
  }
}

function stopBrowserPoll() {
  if (browserPollTimer) { clearInterval(browserPollTimer); browserPollTimer = null; }
  if (browserPollStopTimer) { clearTimeout(browserPollStopTimer); browserPollStopTimer = null; }
  browserPolling.value = false;
}

/** Start (or restart) the 30s in-place poll + the 5-minute auto-stop. */
function startBrowserPoll() {
  stopBrowserPoll();
  browserPolling.value = true;
  browserPollTimer = setInterval(() => void pollBrowser(), BROWSER_POLL_MS);
  browserPollStopTimer = setTimeout(() => stopBrowserPoll(), BROWSER_POLL_MAX_MS);
}

/** Silent poll: fetch the current list and MERGE it into the shown rows in place
 *  (update scores/half/turn, add new games, drop ended ones) — no loading state,
 *  no list rebuild, so the data updates on screen without a flicker. */
async function pollBrowser() {
  if (!ui.browserOpen || settings.activeServerTarget !== 'fumbbl') return;
  try {
    const res = await fetch(`${FUMBBL_SITE}/api/match/current`);
    const incoming = (await res.json()) as BrowserMatch[];
    mergeMatches(incoming);
    if (browserStatus.value === '' || browserStatus.value === 'No live games right now.')
      browserStatus.value = browserMatches.value.length ? '' : 'No live games right now.';
  } catch {
    /* transient failure — keep the current rows and try again next tick */
  }
}

/** Update the displayed rows IN PLACE from a fresh list (keyed by match id) so Vue
 *  patches only the changed cells instead of re-rendering the whole table. */
function mergeMatches(incoming: BrowserMatch[]) {
  const rows = browserMatches.value;
  const byId = new Map(rows.map((m) => [m.id, m]));
  const seen = new Set<number>();
  for (const nm of incoming) {
    seen.add(nm.id);
    const existing = byId.get(nm.id);
    if (existing) {
      existing.half = nm.half; // in-place field updates (reactive)
      existing.turn = nm.turn;
      existing.teams = nm.teams;
    } else {
      rows.push(nm); // a newly-live game
    }
  }
  for (let i = rows.length - 1; i >= 0; i--) if (!seen.has(rows[i]!.id)) rows.splice(i, 1); // ended games
}

// owner 2026-07-09: the server toggle moved to the header (App.vue applyServerTarget) — the browser
// reacts via the activeServerTarget watch above; no in-panel switcher.
// owner 2026-07-08 (UI restructure): the fork server IP editor moved to Settings → Connection.

function spectateMatch(id: number) {
  gameId.value = id;
  connect(); // closes the browser (Option A)
}

/** JNLP-free FUMBBL login (owner 2026-07-09): mint a fresh one-time token via FUMBBL's API and
 *  open the SAME lobby a JNLP would — no ffblive.jnlp download. Uses the FUMBBL account coach from
 *  Settings → Connection + the entered team id; best-effort resolves the team name for the label.
 *  The credential seam lives in fumbblAuth.mintFumbblToken (throws until the owner sets client id/secret). */
async function fumbblLoginNoJnlp() {
  const teamId = fumbblNoJnlpTeamId.value.trim();
  const coach = settings.coach.trim();
  fumbblLoginError.value = null;
  if (!teamId) { fumbblLoginError.value = 'Enter your FUMBBL team id.'; return; }
  if (!coach) { fumbblLoginError.value = 'Set your FUMBBL coach name in Settings → Connection.'; return; }
  fumbblLoginBusy.value = true;
  try {
    const auth = await mintFumbblToken(); // the seam — throws FumbblCredentialsMissing until creds are set
    const teamName = (await fetchTeamName(teamId)) ?? `Team ${teamId}`;
    applyServerTarget('fumbbl');
    ui.settingsOpen = false;
    // Populate the lobby with exactly the shape a parsed JNLP produces. This legacy
    // in-game surface retains named join only; server-listed player joins live on the
    // Play blade and never use the public spectator match feed.
    stageFumbblPlayerLobby({ coach, teamId, teamName }, auth);
    fumbblNoJnlpTeamId.value = '';
    ui.browserOpen = true;
    void refreshBrowser();
    gameStore.state.log.push({
      time: logTimestamp(), kind: 'system',
      text: `FUMBBL login ready as ${coach} (${teamName}) — no JNLP. Enter a game name to create/join a match.`,
    });
  } catch (e) {
    fumbblLoginError.value = e instanceof FumbblCredentialsMissing
      ? e.message
      : `FUMBBL login failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    fumbblLoginBusy.value = false;
  }
}

/** Intercepted FUMBBL join file (see docs/fumbbl-interfacing.md): replay and
 *  spectate requests connect immediately; player joins carry a one-time auth
 *  token whose join-command wiring lands with M4. */
async function openJnlpFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  // owner ruling 2026-08-17: official fumbbl.com replay+live permitted.
  const request = await readJnlpFile(file);
  routeJnlpRequest(request, { sourceName: file.name });
}

// --- Guided tour (owner 2026-07-03 r6f) ---------------------------------------
// "Play Tutorial" (App.vue splash → ui.tutorialTick) loads the demo, then a gold
// arrow + a 3s toast walk the user through the quick bar, End Turn, the coach
// panels, and the Log/Chat/Roster tabs, before opening a player card in-game.
interface TourStep { sel: string; text: string; place: 'above' | 'below' | 'left' | 'right'; }
const TOUR_STEPS: TourStep[] = [
  { sel: '.config-bar', text: 'Quick bar — settings, tackle zones, sprite style, skill display, stadium, Auto Director, and report a bug.', place: 'above' },
  { sel: '.director-btn', text: '🎬 Auto Director — auto-zoom + track the action (the camera follows the ball & the acting player). Toggle it off for a calm, static camera you pan yourself.', place: 'above' },
  { sel: '.end-turn', text: 'End Turn — ends the active turn. (In the demo it advances play.)', place: 'below' },
  { sel: '.coach-panel.home', text: "Coach panels — each side's team, coach, score, inducements and turn number. The ACTIVE coach's panel grows.", place: 'below' },
  { sel: '.tabs button[title="Log"]', text: 'Log — the play-by-play: dice rolls, blocks, injuries and events.', place: 'above' },
  { sel: '.tabs button[title="Chat"]', text: 'Chat — talk with the coaches and other spectators.', place: 'above' },
  { sel: '.tabs button.roster-tab', text: "Roster — both teams' full rosters and player stats.", place: 'above' },
];
const TOUR_MS = 3000;
const tourActive = ref(false);
const tourText = ref('');
const tourArrow = reactive({ x: -999, y: -999, rot: 0 });
const tourToast = reactive({ x: 0, y: 0, anchor: 'bottom' as 'top' | 'bottom' | 'left' | 'right' });
let tourTimer: ReturnType<typeof setTimeout> | null = null;

const tourArrowStyle = computed(() => ({
  left: `${tourArrow.x}px`, top: `${tourArrow.y}px`,
  transform: `translate(-50%, -50%) rotate(${tourArrow.rot}deg)`,
}));
const TOAST_XFORM = { top: 'translate(-50%, 0)', bottom: 'translate(-50%, -100%)', left: 'translate(-100%, -50%)', right: 'translate(0, -50%)' };
const tourToastStyle = computed(() => ({
  left: `${tourToast.x}px`, top: `${tourToast.y}px`, transform: TOAST_XFORM[tourToast.anchor],
}));

function positionTour(el: HTMLElement, place: TourStep['place']) {
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const gap = 12; // arrow tip distance from the element
  const reach = 48; // toast distance beyond the arrow
  if (place === 'above') { tourArrow.x = cx; tourArrow.y = r.top - gap; tourArrow.rot = 0; tourToast.x = cx; tourToast.y = r.top - gap - reach; tourToast.anchor = 'bottom'; }
  else if (place === 'below') { tourArrow.x = cx; tourArrow.y = r.bottom + gap; tourArrow.rot = 180; tourToast.x = cx; tourToast.y = r.bottom + gap + reach; tourToast.anchor = 'top'; }
  else if (place === 'left') { tourArrow.x = r.left - gap; tourArrow.y = cy; tourArrow.rot = 270; tourToast.x = r.left - gap - reach; tourToast.y = cy; tourToast.anchor = 'right'; }
  else { tourArrow.x = r.right + gap; tourArrow.y = cy; tourArrow.rot = 90; tourToast.x = r.right + gap + reach; tourToast.y = cy; tourToast.anchor = 'left'; }
}

function showTourStep(i: number, attempt = 0) {
  if (!tourActive.value) return;
  if (i >= TOUR_STEPS.length) return finishTour();
  const step = TOUR_STEPS[i]!;
  const el = document.querySelector(step.sel) as HTMLElement | null;
  if (!el) {
    // the element may still be rendering — retry briefly before skipping it
    if (tourTimer) clearTimeout(tourTimer);
    if (attempt < 6) { tourTimer = setTimeout(() => showTourStep(i, attempt + 1), 200); return; }
    return showTourStep(i + 1);
  }
  positionTour(el, step.place);
  tourText.value = step.text;
  if (tourTimer) clearTimeout(tourTimer);
  tourTimer = setTimeout(() => showTourStep(i + 1), TOUR_MS);
}

function startTour() {
  if (!gameStore.game.value) gameStore.loadDemo();
  tourActive.value = true;
  // let the demo + HUD lay out before we point at the elements
  if (tourTimer) clearTimeout(tourTimer);
  void nextTick(() => { tourTimer = setTimeout(() => showTourStep(0), 1400); });
}

function finishTour() {
  // demonstrate in-game: open a player card, then a closing note centred up top
  const g = gameStore.game.value;
  const first = g?.fieldModel.playerDataArray.find((d) => d.playerCoordinate && d.playerCoordinate[0] >= 0);
  if (first && renderer?.onPlayerClick) renderer.onPlayerClick(first.playerId, 200, 200);
  tourArrow.x = -999; tourArrow.y = -999; // arrow off-screen for the finale
  tourToast.x = window.innerWidth / 2; tourToast.y = Math.round(window.innerHeight * 0.16); tourToast.anchor = 'top';
  tourText.value = "That's the tour! This is a player card — click any player to open theirs. Drag panels to taste and explore the demo. Enjoy!";
  if (tourTimer) clearTimeout(tourTimer);
  tourTimer = setTimeout(endTour, 5500);
}

function endTour() {
  tourActive.value = false;
  if (tourTimer) { clearTimeout(tourTimer); tourTimer = null; }
}

watch(() => ui.tutorialTick, (v) => { if (v > 0) startTour(); });

/** Owner 2026-07-04f: the roster LOCATION/STATUS label — Reserves / KO'd / the
 *  casualty type (Badly Hurt / Seriously Hurt / Dead) / Sent off / On pitch. */
function playerState(player: PlayerJson): string {
  const data = gameStore.game.value?.fieldModel.playerDataArray.find((d) => d.playerId === player.playerId);
  if (!data) return '—';
  if (rendersOnPitch(data.playerState)) return 'On pitch';
  switch (baseState(data.playerState)) {
    case PlayerStateBase.KNOCKED_OUT: return "KO'd";
    case PlayerStateBase.BADLY_HURT: return 'Badly Hurt';
    case PlayerStateBase.SERIOUS_INJURY: return 'Seriously Hurt';
    case PlayerStateBase.RIP: return 'Dead';
    case PlayerStateBase.BANNED: return 'Sent off';
    case PlayerStateBase.RESERVE:
    case PlayerStateBase.MISSING:
    default: return 'Reserves';
  }
}

/** Owner 2026-07-04f: the roster POSITION NAME (Position Rings sheet key), never
 *  a numeric position ID. Resolves from playerName's position or the roster. */
function positionLabel(player: PlayerJson, team: { roster?: unknown }): string {
  const pos = (player as { positionName?: string }).positionName;
  if (pos) return pos;
  const roster = team.roster as { positionArray?: { positionId: string; positionName?: string }[] } | undefined;
  const match = roster?.positionArray?.find((q) => q.positionId === player.positionId);
  if (match?.positionName) return match.positionName;
  // last resort: the id tail, but only if it's a NAME (not a bare numeric id)
  const tail = player.positionId.split('.').pop() ?? '';
  return /^\d+$/.test(tail) ? '—' : tail;
}

/**
 * BB2-style in-game HUD (owner 2026-07-02): corner coach panels with race
 * logo, team name, climbing turn counter and FUMBBL inducement icons;
 * center cluster with half/score/weather, End Turn, and the turn timer.
 * Replaces the old scorebar strip (UI4/UI5/UI6 carried over here).
 */
/**
 * Resolve a team's HUD/crest logo. Our own (standalone) server sends no
 * `logoUrl`, so fall back to the bundled per-race Super FUMBBL crest in the
 * side's kit colours (owner 2026-09-04, `game/teamCrests.ts`); an authored
 * neutral crest keeps the logo slot filled for unknown races so the B9-20
 * "Current Player" badge sits under it instead of shifting up.
 */
const GENERIC_TEAM_LOGO =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#4a5568"/><stop offset="1" stop-color="#232a36"/></linearGradient></defs>' +
      '<path d="M30 3 L54 11 V31 C54 44 44 53 30 58 C16 53 6 44 6 31 V11 Z" fill="url(#g)" stroke="var(--ui-accent)" stroke-width="2"/>' +
      '<path d="M30 17 l3.7 8.2 8.9 0.8 -6.7 5.9 2 8.8 -7.9 -4.7 -7.9 4.7 2 -8.8 -6.7 -5.9 8.9 -0.8 Z" fill="var(--ui-accent)" opacity="0.92"/>' +
      '</svg>',
  );

/** Owner 09-05: every match-level splash (turnover, turn start, injury, reroll, send-off) shows the SAME logo as
 *  the HUD panels — pack logo via the wire URL, else the bundled crest — instead of a bare FUMBBL lookup that
 *  rendered nothing when the pack owned the id under another spelling or the server sent none. */
function splashTeamLogo(side: 'home' | 'away', wireLogo?: string | null): string {
  const g = gameStore.game.value;
  const team = side === 'home' ? g?.teamHome : g?.teamAway;
  return fumbblAsset(wireLogo ?? undefined) ?? teamLogo(team, side);
}

function teamLogo(team: unknown, side: CrestSide): string {
  void assetMods.logoRevision; // owner 09-05: pack logos hot-swap — re-render when the bindings change
  const t = team as { race?: string; roster?: { logoUrl?: string; baseIconPath?: string } } | undefined;
  const viaServer = fumbblAsset(t?.roster?.logoUrl, t?.roster?.baseIconPath);
  if (viaServer) return viaServer;
  return crestDataUrl(t?.race, side) ?? GENERIC_TEAM_LOGO;
}

function resourceIcon(name: string): string {
  return new URL(`../assets/resources/${name}.png`, import.meta.url).href;
}

// B9-13: the FUMBBL block-die skull, used as the coin's HEADS face.
const coinSkullUrl = new URL('../assets/coin_skull.png', import.meta.url).href;
// Owner 2026-07-04e: the FUMBBL block-die SKULL face — shown in the foul roll
// tip/modal instead of the word "SKULL" (same art as on a killed player).
const blockSkullUrl = new URL('../assets/block_skull.png', import.meta.url).href;
/** Strip a leading "SKULL " from a foul roll text → just the "n+". */
function foulRollNumber(text: string): string { return text.replace(/^SKULL\s*/i, ''); }


/**
 * Mirror of upstream InducementType.getSlotIconProperty() (BB2025
 * InducementCollection): every type that upstream shows in a generic resource
 * slot maps to a bundled resource icon. Owner-supplied dedicated art may also
 * extend this map for client surfaces even when upstream has no generic slot.
 * Types absent here
 * (partTimeCoach, tempCheerleader, riotousRookies, throwARock, infamousStaff,
 * josefBugman) have NO slot icon upstream — they add
 * players/effects instead of occupying a slot, so no chip renders.
 */
const INDUCEMENT_ICONS: Record<string, string> = {
  bribes: 'bribe',
  prayers: 'prayer',
  wizard: 'wizard',
  masterChef: 'master_chef',
  halflingMasterChef: 'master_chef',
  bloodweiserKegs: 'bloodweiser_keg',
  bloodweiserBabes: 'bloodweiser_keg',
  bugmansXXXXXX: 'bloodweiser_keg',
  biasedRef: 'biased_ref',
  igor: 'igor',
  igors: 'igor',
  mortuaryAssistant: 'mortuary_assistant',
  plagueDoctor: 'plague_doctor',
  wanderingApothecaries: 'wandering_apothecary',
  weatherMage: 'weather_mage',
  dwarfenWisdom: 'dwarfen_wisdom',
  teamMascot: 'team_mascot', // owner 2026-07-09: dedicated wacky-inflatable-man mascot icon (bg-removed)
  briberyAndCorruption: 're_roll_argue',
};

// Owner 2026-07-08: inducement key → resource-slot icon URL (null = no slot icon,
// e.g. part-time coaches / cheerleaders — the view shows a text chip instead).
function induceIcon(key: string): string | null {
  const name = INDUCEMENT_ICONS[key];
  return name ? resourceIcon(name) : null;
}
/** Prettify an inducement key for a label / fallback chip. */
function induceLabel(key: string): string {
  // Owner 2026-07-13 (humanizer review): split only lowercase→Uppercase (not every cap) so a friendly name isn't
  // double-spaced; camelCase inducement keys ('teamMascot' → 'Team Mascot') are unchanged.
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/\s+/g, ' ').trim();
}
// Owner 2026-07-08: LIVE opponent reveal — when the opponent's inducementSet /
// star players land, fill in the right panel. Play mode only (needs a "my" side).
watch(
  () => {
    const g = gameStore.game.value;
    const r = gameStore.state.inducementReveal;
    const mineHome = gameStore.myTeamIsHome.value;
    // Owner 2026-07-09: keep watching even after opp.ready — a 2nd star (or a later
    // inducement) can land in a SUBSEQUENT frame; the sig only changes on a real change,
    // so this re-fires just enough to surface the full set (was gated off at r.opp.ready →
    // froze the reveal on the first snapshot, showing only 1 of 2 stars).
    if (!g || !r?.opp || mineHome == null) return null;
    const oppTd = (mineHome ? g.turnDataAway : g.turnDataHome) as { inducementSet?: { inducementArray?: { inducementType: string; value: number }[] } } | undefined;
    const oppTeam = mineHome ? g.teamAway : g.teamHome;
    const set = oppTd?.inducementSet?.inducementArray ?? [];
    const stars = (oppTeam.playerArray ?? []).filter((p) => (p as { playerType?: string }).playerType === 'Star');
    if (!set.length && !stars.length) return null;
    return JSON.stringify(set) + '|' + stars.map((s) => s.playerId).join(',');
  },
  (sig) => {
    if (!sig) return;
    const g = gameStore.game.value!;
    const mineHome = gameStore.myTeamIsHome.value!;
    const oppTd = (mineHome ? g.turnDataAway : g.turnDataHome) as { inducementSet?: { inducementArray?: { inducementType: string; value: number }[] } } | undefined;
    const oppTeam = mineHome ? g.teamAway : g.teamHome;
    const items = (oppTd?.inducementSet?.inducementArray ?? []).map((e) => ({ key: e.inducementType, label: induceLabel(e.inducementType), count: e.value }));
    const roster = (oppTeam.roster as { positionArray?: { positionId: string; positionName?: string }[] }).positionArray ?? [];
    const stars = (oppTeam.playerArray ?? [])
      .filter((p) => (p as { playerType?: string }).playerType === 'Star')
      .map((p) => ({ positionId: p.positionId, name: p.playerName || (roster.find((q) => q.positionId === p.positionId)?.positionName ?? 'Star Player'), playerId: p.playerId }));
    gameStore.revealOpponentInducements({ items, stars });
  },
);

const hud = computed(() => {
  const game = gameStore.game.value;
  if (!game) return null;
  const weather = String(game.fieldModel.weather ?? '');
  const weatherIcon = weatherEmoji(weather);
  const g = game as unknown as { timeoutPossible?: boolean; timeoutEnforced?: boolean; turnTime?: number };
  return {
    half: game.half,
    scoreHome: game.gameResult.teamResultHome.score,
    scoreAway: game.gameResult.teamResultAway.score,
    weather,
    weatherIcon,
    homePlaying: !!game.homePlaying,
    timeoutPossible: !!g.timeoutPossible,
    timeoutEnforced: !!g.timeoutEnforced,
    turnTime: Number(g.turnTime ?? 0),
  };
});

/* After Call time-out, show a local acknowledgement until timeoutEnforced or the window closes. */
const timeoutCalled = ref(false);
function onCallTimeout() {
  timeoutCalled.value = true;
  gameStore.callTimeout();
}
watch(
  () => [hud.value?.timeoutPossible, hud.value?.timeoutEnforced] as const,
  ([possible, enforced]) => {
    // window closed (turn moved on / opponent acted) or the server confirmed the
    // enforcement → drop the local ack so the next window starts clean.
    if (!possible || enforced) timeoutCalled.value = false;
  },
);

/**
 * B9-6: weather → icon. Shared by the HUD chip and the weather cinematic.
 * BB2020 table: 2 Sweltering Heat, 3 Very Sunny, 4–10 Perfect Conditions
 * (Nice), 11 Pouring Rain, 12 Blizzard.
 */
function weatherEmoji(weather: string): string {
  const w = weather.toLowerCase();
  if (w.includes('blizzard')) return '❄️';
  if (w.includes('rain') || w.includes('pour')) return '🌧️';
  if (w.includes('swelter') || w.includes('heat')) return '🥵';
  if (w.includes('sunny')) return '☀️';
  return '🌤️'; // Nice / Perfect Conditions
}

// For Old Pro and Crushing Blow, display the authoritative armour dice in the skill-use card.
const skillChoiceArmorDice = computed<number[] | null>(() => {
  const sc = gameStore.state.skillChoice;
  if (sc?.armorDice) return [...sc.armorDice];
  const ad = gameStore.state.armorDice;
  if (!sc || !ad) return null;
  if (sc.skill.toLowerCase().replace(/[^a-z]/g, '') !== 'crushingblow') return null;
  const sq = playerSquareById(sc.playerId);
  const match = (sq ? ad.rolls.find((r) => r.square[0] === sq[0] && r.square[1] === sq[1]) : undefined) ?? ad.rolls[0];
  return match ? [...match.rolls] : null;
});

/** Owner 2026-07-04f: the weather's EFFECTS, for the HUD hover tooltip
 *  (bloodbowlbase.ru / BB2025). Returned as "Name — effect". */
function weatherEffect(weather: string): string {
  const w = weather.toLowerCase();
  if (w.includes('blizzard'))
    return 'Blizzard — only Quick and Short passes may be attempted; −1 to any Rush (Go-For-It fails on a 1–2).';
  if (w.includes('rain') || w.includes('pour'))
    return 'Pouring Rain — −1 to any Agility test to Catch, Pick Up, or attempt an Interception.';
  if (w.includes('swelter') || w.includes('heat'))
    return 'Sweltering Heat — at the end of the drive, D3 random players from each team faint and go to the Reserves box.';
  if (w.includes('sunny'))
    return 'Very Sunny — a glorious day: −1 to any Passing Ability test.';
  return 'Nice Weather (Perfect Conditions) — nothing but the sound of leather on flesh; no effect.';
}

/** B8-2/B8-3: which of the 9 die-face cells carry a pip for a value 1..6. */
function pipPattern(n: number): boolean[] {
  const map: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  const on = new Set(map[n] ?? []);
  return Array.from({ length: 9 }, (_, i) => on.has(i));
}

function panelFor(side: 'home' | 'away') {
  const game = gameStore.game.value;
  if (!game) return null;
  const team = side === 'home' ? game.teamHome : game.teamAway;
  const turnData = side === 'home' ? game.turnDataHome : game.turnDataAway;
  const chips = buildInducementChips(turnData);
  return {
    coach: team.coach,
    teamName: team.teamName,
    logo: teamLogo(team, side),
    turnNr: turnData.turnNr ?? 0,
    // Owner 08-18 (rocking corner panels): the SETTLED playing side, not the raw wire flag. `game.homePlaying`
    // oscillates false→true→false inside the server's `betweenTurns` turn-flip transit (g870 HS nr63/64/65), and
    // `.coach-panel` carries a 0.35s transform transition — so every consumer of the raw flag ANIMATED the
    // boundary three times. gameStore.state.playingIsHome holds the answer across the transit (see store.ts).
    playing: side === 'home' ? gameStore.state.playingIsHome : !gameStore.state.playingIsHome,
    chips,
  };
}

const homePanel = computed(() => panelFor('home'));
const awayPanel = computed(() => panelFor('away'));
const coachDecisionSide = computed(() => decidingCoachSide(gameStore.game.value));
const passiveSkillDecisionText = computed(() => {
  const choice = gameStore.state.skillChoice;
  return choice
    ? reactiveSkillDecisionText(gameStore.game.value, choice.playerId, choice.label)
    : '';
});
const endTurnButtonText = computed(() => {
  if (!gameStore.myTurn.value) return "Opponent's Turn";
  const game = gameStore.game.value;
  if (!game || !gameStore.isPlaying.value) return 'End Turn';
  const clientState = deriveClientState(game, o66Ctx());
  return clientState === 'SETUP' || clientState === 'SOLID_DEFENCE' ? 'Confirm Setup' : 'End Turn';
});

// Turn clock (owner 2026-07-02): COUNTDOWN from 4 minutes, or the league's `turntime` game option when the match
// carries one. #39 ①: the remaining time = turnLimit − the RAW server turnTime (state.gameClock, no local tick).
const turnLimitMs = computed(() => {
  const game = gameStore.game.value;
  const options =
    ((game as unknown as { options?: { gameOptionArray?: { gameOptionId?: string; gameOptionValue?: unknown }[] } })
      ?.options?.gameOptionArray) ?? [];
  const seconds = Number(options.find((o) => o.gameOptionId === 'turntime')?.gameOptionValue);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 240) * 1000;
});

// B9-12 G8/G9: the game is over — freeze the clock + indicators.
const gameOver = computed(() => gameStore.state.endGame.phase !== 'idle');
const finalPresentationReady = computed(() => gameStore.state.endGame.finalPresentationReady);
const END_GAME_PHASE_LABELS = {
  idle: '', initializing: 'End Game · Initializing', assignTouchdowns: 'End Game · Assign Touchdowns',
  penaltyShootout: 'End Game · Penalty Shootout', mvp: 'End Game · MVP', winnings: 'End Game · Winnings',
  dedicatedFans: 'End Game · Dedicated Fans', playerLoss: 'End Game · Player Loss',
  statistics: 'End Game · Statistics', complete: 'Final',
} as const;
const endGamePhaseLabel = computed(() => END_GAME_PHASE_LABELS[gameStore.state.endGame.phase]);
// B9-12 G9: clear the stale active-player highlight the moment the game ends,
// even if the endGame frame carried no reports (so the store clear didn't run).
watch(gameOver, (over) => {
  if (over) gameStore.state.activePlayerId = null;
});
watch(finalPresentationReady, (ready) => renderer?.setBoardCleared(ready));

// B9-12 G7: full post-game panel — Result / MVP / Statistics phases.
type PostGameMvp = { name: string; position: string; awards: number; playerId: string }; // #44: playerId → renderer.playerPortrait (no new fetch)
type PostGamePlayer = { name: string; position: string; spp: number }; // #25-v2 per-player roster/SPP row
interface PostGameSide {
  which: 'home' | 'away';
  team: string;
  coach: string;
  logo: string | null;
  score: number;
  mvps: PostGameMvp[];
  // #25-v2: the roulette cycle pool (all team player names) — presentation only.
  players: string[];
  // #25-v2: per-player roster/SPP summary (name·position·SPP-gained this game), SPP-desc.
  roster: PostGamePlayer[];
  totals: Record<string, number>;
}
// wire PlayerResult fields (server PlayerResult.java) summed per team
const POSTGAME_STATS: { key: string; label: string }[] = [
  { key: 'touchdowns', label: 'Touchdowns' },
  { key: 'casualties', label: 'Casualties' },
  { key: 'completions', label: 'Completions' },
  { key: 'passing', label: 'Passing yards' },
  { key: 'rushing', label: 'Rushing yards' },
  { key: 'interceptions', label: 'Interceptions' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'fouls', label: 'Fouls' },
  { key: 'spp', label: 'SPP earned' },
];
function postGameSide(side: 'home' | 'away'): PostGameSide | null {
  const game = gameStore.game.value;
  if (!game) return null;
  const team = side === 'home' ? game.teamHome : game.teamAway;
  const tr = side === 'home' ? game.gameResult.teamResultHome : game.gameResult.teamResultAway;
  const roster = team.roster as {
    positionArray?: { positionId: string; positionName?: string }[];
    logoUrl?: string;
    baseIconPath?: string;
  };
  const num = (r: Record<string, unknown>, k: string) => Number(r[k] ?? 0);
  // Derive game-earned SPP from serialized achievement fields, not lifetime currentSpps.
  const sppEarned = (r: Record<string, unknown>) =>
    num(r, 'playerAwards') * 4 + num(r, 'touchdowns') * 3 + num(r, 'casualties') * 2 +
    num(r, 'interceptions') * 2 + num(r, 'completions') + num(r, 'deflections') +
    num(r, 'completionsWithAdditionalSpp') + num(r, 'casualtiesWithAdditionalSpp') + num(r, 'catchesWithAdditionalSpp');
  const results = tr.playerResults as unknown as Record<string, unknown>[];
  const totals: Record<string, number> = {};
  for (const { key } of POSTGAME_STATS) {
    if (key === 'spp') totals.spp = results.reduce((a, r) => a + sppEarned(r), 0);
    else totals[key] = results.reduce((a, r) => a + num(r, key), 0);
  }
  const mvps: PostGameMvp[] = results
    .filter((r) => num(r, 'playerAwards') > 0)
    .map((r) => {
      const p = team.playerArray.find((pl) => pl.playerId === r.playerId);
      const position =
        roster.positionArray?.find((x) => x.positionId === p?.positionId)?.positionName ??
        p?.positionId?.split('.').pop() ??
        '';
      return { name: p?.playerName ?? '(unknown)', position, awards: num(r, 'playerAwards'), playerId: String(r.playerId ?? '') };
    });
  // #25-v2: per-player roster — name · position · SPP-gained (same server-authoritative sppEarned as the
  // team total), sorted SPP-desc so the game's standouts head the list.
  const posName = (pid: string | undefined) =>
    roster.positionArray?.find((x) => x.positionId === pid)?.positionName ?? pid?.split('.').pop() ?? '';
  const rosterRows: PostGamePlayer[] = results
    .map((r) => {
      const p = team.playerArray.find((pl) => pl.playerId === r.playerId);
      return { name: p?.playerName ?? '(unknown)', position: posName(p?.positionId as string | undefined), spp: sppEarned(r) };
    })
    .sort((a, b) => b.spp - a.spp);
  return {
    which: side,
    team: team.teamName,
    coach: team.coach,
    logo: teamLogo(team, side),
    score: tr.score,
    mvps,
    players: team.playerArray.map((pl) => pl.playerName).filter((n): n is string => !!n),
    roster: rosterRows,
    totals,
  };
}
const endGamePublic = computed(() => {
  if (!gameOver.value) return null;
  const home = postGameSide('home');
  const away = postGameSide('away');
  if (!home || !away) return null;
  const draw = home.score === away.score;
  const winner = draw ? null : home.score > away.score ? home : away;
  return { home, away, winner, draw };
});
const postGame = computed(() => finalPresentationReady.value ? endGamePublic.value : null);
// Owner 08-19 (spectate-seat endgame): pure gates in game/spectatorEndGame.ts — MVP-pending
// placeholder ("Players are selecting MVP") while the server hasn't sent the Statistics & MVP
// data, plus the PERSISTENT Return to Menu / Spectate Another Game pair. Model-keyed, no timers.
const spectatorEndGateInput = computed(() => ({
  seat: props.mode,
  phase: gameStore.state.endGame.phase,
  finalPresentationReady: finalPresentationReady.value,
  endGameSettled: !!gameStore.state.endGameSettled,
}));
const spectatorMvpPendingActive = computed(() =>
  spectatorMvpPending(spectatorEndGateInput.value) && !!endGamePublic.value);
const spectatorExitVisible = computed(() => spectatorExitActionsVisible(spectatorEndGateInput.value));
// Result is always separate; MVP reflects server awards, and iConceded is true only for the conceding local coach.
const iConceded = computed(() => {
  const cn = gameStore.state.concedeNotice;
  return !!cn && gameStore.isPlaying.value && cn.side === (gameStore.myTeamIsHome.value ? 'home' : 'away');
});
// Owner 2026-07-15: MVP NOMINATION as a roster-summary MODAL (mirrors pg-roster) with checkboxes, replacing the
// on-pitch over-head pick arrows for this pick. The server offers the eligible pool (state.playerPick, key
// pchoice:mvp) and picks the MVP randomly from the coach's nomination — ⚖ presentation-only; this only changes
// how the nomination is collected (checkbox toggles reuse resolvePlayerPick; Confirm reuses confirmPlayerPick).
const mvpPick = computed(() => {
  const pick = gameStore.state.playerPick;
  return pick && pick.key.startsWith('pchoice:mvp') ? pick : null;
});
const chargePick = computed(() => {
  const pick = gameStore.state.playerPick;
  return pick && pick.key.startsWith('pchoice:charge:') ? pick : null;
});
const dwarfenWisdomPick = computed(() => {
  const pick = gameStore.state.playerPick;
  return pick && pick.key.startsWith('pchoice:dwarfenWisdom:') ? pick : null;
});
const prayerBoardPick = computed(() => {
  const pick = gameStore.state.playerPick;
  return pick && (pick.key.startsWith('pchoice:knuckleDusters:')
    || pick.key.startsWith('pchoice:ironMan:')
    || pick.key.startsWith('pchoice:blessedStatueOfNuffle:')) ? pick : null;
});
const prayerBoardTitle = computed(() => {
  const key = prayerBoardPick.value?.key ?? '';
  if (key.startsWith('pchoice:knuckleDusters:')) return 'Knuckle Dusters';
  if (key.startsWith('pchoice:ironMan:')) return 'Iron Man';
  return 'Blessing of Nuffle';
});
// Owner audit 08-17 (P1 — Iron Man/Knuckle Dusters cannot reach every offered reserve): the
// armed pitch/dugout crosshair (renderer.ts onPlayerPick, now dugout-aware) reaches most
// off-pitch candidates, but the synthetic pre-setup formation's eleven-slot cap + Star-first
// sort (packages/ffb-pitch/src/preSetupFormation.ts) plus dense-dugout packing means a
// candidate can still be visually hard to hit. Offer the same guaranteed-reachable roster
// list used by Classic as a fallback disclosure beside the ordinary pick bar — same wire
// (resolvePlayerPick/confirmPlayerPick), never a second source of truth for eligibility.
const rosterPickFallback = computed(() => {
  const pp = gameStore.state.playerPick;
  if (!pp || mvpPick.value || dwarfenWisdomPick.value || prayerBoardPick.value) return null;
  if (!hasOffPitchCandidate(gameStore.game.value, pp.eligibleIds)) return null;
  return {
    prompt: pp.prompt, min: pp.minPicks, max: pp.maxPicks, picked: pp.picked, declinable: pp.declinable,
    candidates: resolveRosterPickCandidates(gameStore.game.value, pp.eligibleIds),
  };
});
const rosterPickFallbackOpen = ref(false);
watch(() => gameStore.state.playerPick?.key, () => { rosterPickFallbackOpen.value = false; });
// Build roster rows from live results with position, acquired skills, lifetime SPP, earned delta, and eligibility.
type MvpRosterRow = { id: string; nr: number; name: string; position: string; skills: string; sppTotal: number; sppEarned: number; eligible: boolean };
function mvpRosterFor(side: 'home' | 'away'): MvpRosterRow[] {
  const g = gameStore.game.value; const pick = mvpPick.value;
  if (!g) return [];
  const team = side === 'home' ? g.teamHome : g.teamAway;
  const tr = side === 'home' ? g.gameResult.teamResultHome : g.gameResult.teamResultAway;
  const roster = team.roster as { positionArray?: { positionId: string; positionName?: string }[] };
  const race = (team as { race?: string }).race?.trim();
  const results = tr.playerResults as unknown as Record<string, unknown>[];
  const eligible = new Set(pick?.eligibleIds ?? []);
  return team.playerArray.map((p) => {
    const raw = roster.positionArray?.find((q) => q.positionId === p.positionId)?.positionName ?? p.positionId.split('.').pop() ?? '';
    // Owner 09-09: the POSITIONAL only — no race prefix ("Shambling Undead Ghoul" -> "Ghoul"), stripped even when the
    // roster's own positionName carries it (was prefixing the race when it didn't).
    const startsWithRace = !!race && raw.toLowerCase().startsWith(race.toLowerCase() + ' ');
    const position = startsWithRace ? raw.slice(race!.length + 1).trim() || raw : raw;
    const r = results.find((x) => String(x.playerId) === p.playerId);
    return {
      id: p.playerId, nr: p.playerNr, name: p.playerName, position,
      skills: acquiredSkills(p, team),
      sppTotal: Number(r?.currentSpps ?? 0),
      sppEarned: r ? sppEarnedThisGame(r, (team as { specialRules?: string[] }).specialRules) : 0,
      eligible: eligible.has(p.playerId),
    };
  });
}
const mvpRoster = computed(() => mvpRosterFor(gameStore.myTeamIsHome.value ? 'home' : 'away'));
const postGamePhase = ref<'mvp' | 'stats' | 'roster'>('mvp');
// #235 (owner-fg 07-29): roster is a one-team view, defaulted to the viewer's own side.
const selectedRosterTeam = ref<'home' | 'away'>(gameStore.myTeamIsHome.value ? 'home' : 'away');
const postGameDismissed = ref(false);
watch(gameOver, (over) => {
  postGameDismissed.value = false;
  if (over) {
    postGamePhase.value = 'mvp';
    selectedRosterTeam.value = gameStore.myTeamIsHome.value ? 'home' : 'away';
  }
});

// MVP roulette is presentation-only and always lands on the server-awarded winner; reduced motion lands immediately.
type MvpRoll = { phase: 'awaiting' | 'cycling' | 'landed' | 'none'; display: string };
const mvpRoll = ref<{ home: MvpRoll; away: MvpRoll }>({
  home: { phase: 'awaiting', display: '' },
  away: { phase: 'awaiting', display: '' },
});
// #44 (owner tester): the winning player's PORTRAIT at roulette end, mirroring the in-game portrait.
// Captured from renderer.playerPortrait (the on-pitch sprite rendered to a LOCAL data URL — reuses the
// existing surfaced asset, NO new fetch/CDN, C-44) when a side's server award first appears; null if the
// MVP is off-pitch (KO/cas → no sprite) → the chip just shows the name. Shown only at phase 'landed'.
const mvpPortrait = ref<{ home: string | null; away: string | null }>({ home: null, away: null });
let mvpRollTimers: ReturnType<typeof setInterval>[] = [];
function clearMvpRollTimers() {
  mvpRollTimers.forEach((t) => { clearInterval(t); clearTimeout(t); });
  mvpRollTimers = [];
}
function startMvpRoll(side: 'home' | 'away', pool: string[], winner: string) {
  const reduced = typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // §3a fail-open: can't/shouldn't animate → land on the server winner at once.
  if (reduced || pool.length < 2) { mvpRoll.value[side] = { phase: 'landed', display: winner }; return; }
  mvpRoll.value[side] = { phase: 'cycling', display: pool[0]! };
  let i = 0;
  const spin = setInterval(() => {
    i = (i + 1) % pool.length;
    if (mvpRoll.value[side].phase === 'cycling') mvpRoll.value[side] = { phase: 'cycling', display: pool[i]! };
  }, presentationMs(90));
  mvpRollTimers.push(spin);
  const stop = setTimeout(() => {
    clearInterval(spin);
    mvpRoll.value[side] = { phase: 'landed', display: winner }; // ⚖ always the server award
  }, presentationMs(1600));
  mvpRollTimers.push(stop as unknown as ReturnType<typeof setInterval>);
}
// Drive the reveal off gameOver + the post-game award. Guard makes it idempotent across
// the many endgame syncs: a side only starts spinning once, when its winner first appears.
watch([() => gameStore.state.endGame.phase, endGamePublic], () => {
  const pg = endGamePublic.value;
  const phase = gameStore.state.endGame.phase;
  if ((phase !== 'mvp' && !finalPresentationReady.value) || !pg) {
    clearMvpRollTimers();
    mvpRoll.value = { home: { phase: 'awaiting', display: '' }, away: { phase: 'awaiting', display: '' } };
    mvpPortrait.value = { home: null, away: null };
    return;
  }
  const settled = !!gameStore.state.endGameSettled;
  (['home', 'away'] as const).forEach((side) => {
    const s = pg[side];
    const cur = mvpRoll.value[side];
    if (s.mvps.length) {
      // Winner present — spin once (don't restart once cycling/landed on it).
      if (cur.phase !== 'cycling' && cur.phase !== 'landed') {
        // #44: capture the winner's local sprite portrait now (playerId known); shown at 'landed'.
        mvpPortrait.value[side] = (s.mvps[0]!.playerId ? renderer?.playerPortrait(s.mvps[0]!.playerId) : null) ?? null;
        startMvpRoll(side, s.players, s.mvps[0]!.name);
      }
    } else if (settled) {
      if (cur.phase !== 'none') mvpRoll.value[side] = { phase: 'none', display: '' };
    } else if (cur.phase !== 'awaiting') {
      mvpRoll.value[side] = { phase: 'awaiting', display: '' };
    }
  });
}, { immediate: true });
onBeforeUnmount(clearMvpRollTimers);

// Player postgame uses one nomination-to-reveal surface; spectators retain the legacy results panel.
const mvpDismissed = ref(false);
watch(gameOver, (over) => { if (!over) mvpDismissed.value = false; });
const mvpMySide = computed<'home' | 'away'>(() => (gameStore.myTeamIsHome.value ? 'home' : 'away'));
const mvpScreenActive = computed(() => gameStore.isPlaying.value
  && gameStore.state.endGame.phase === 'mvp'
  && !mvpDismissed.value);
// Owner 08-19: the one endgame surface — the settled FINAL panel (all seats, existing gates), or the
// spectate seat's earlier MVP-pending presentation (result card + placeholder + exit pair).
const finalPostGameVisible = computed(() => !!postGame.value && !postGameDismissed.value
  && !gameStore.state.playerPick && !mvpScreenActive.value && !!gameStore.state.endGameSettled);
const pgSurface = computed(() => finalPostGameVisible.value ? postGame.value
  : spectatorMvpPendingActive.value ? endGamePublic.value : null);
// Owner 09-06: while ANY end-game surface is up (result window / MVP nominate), the log panel and the chat toasts
// ride ABOVE it (z 57) and stay interactive in every mode — they sat under the full-screen overlay before.
const endGameFront = computed(() => !!pgSurface.value || mvpScreenActive.value);
const mvpResult = computed(() => {
  const pg = endGamePublic.value; if (!pg) return null;
  return { homeTeam: pg.home.team, homeScore: pg.home.score, awayTeam: pg.away.team, awayScore: pg.away.score };
});
// primary-glow flash-in when a side's MVP first LANDS (the opponent's reveal, and my own).
const mvpFlashSide = ref<'home' | 'away' | null>(null);
watch(() => [mvpRoll.value.home.phase, mvpRoll.value.away.phase] as const, (now, prev) => {
  (['home', 'away'] as const).forEach((s, i) => {
    if (now[i] === 'landed' && (!prev || prev[i] !== 'landed')) {
      mvpFlashSide.value = s;
      window.setTimeout(() => { if (mvpFlashSide.value === s) mvpFlashSide.value = null; }, presentationMs(1000));
    }
  });
});
const mvpChips = computed(() => {
  const pg = endGamePublic.value;
  const order: ('home' | 'away')[] = mvpMySide.value === 'home' ? ['home', 'away'] : ['away', 'home'];
  return order.map((side) => {
    const r = mvpRoll.value[side];
    const display = r.phase === 'awaiting' ? 'Pending...' : r.phase === 'none' ? 'No MVP' : (r.display || 'Pending...');
    // Render each authoritative MVP award separately, including duplicate awards to the same player.
    const winners = (pg ? pg[side].mvps : []).map((m) => ({ id: m.playerId, name: m.name, awards: m.awards }));
    return { side, mine: side === mvpMySide.value, team: pg ? pg[side].team : '', phase: r.phase, display, flash: mvpFlashSide.value === side, portrait: mvpPortrait.value[side], winners };
  });
});
const mvpBothResolved = computed(() => (['home', 'away'] as const).every((s) => { const p = mvpRoll.value[s].phase; return p === 'landed' || p === 'none'; }));
// "Waiting for opponent" — I'm not nominating (their turn / already nominated) and the reveal isn't done.
const mvpWaiting = computed(() => mvpScreenActive.value && !mvpPick.value && !mvpBothResolved.value);
// Remount the MVP nomination surface on playerPick.seq so each server nomination round visibly re-arms.
const mvpRoundKey = ref(0);
let lastMvpPickSeq = -1;
watch(() => mvpPick.value?.seq, (seq) => {
  if (typeof seq === 'number' && seq !== lastMvpPickSeq) { lastMvpPickSeq = seq; mvpRoundKey.value++; }
});

// Render raw SERVER_GAME_TIME snapshots; without a running flag, local extrapolation lies during pauses.
const turnClock = computed(() => {
  if (gameOver.value) return null; // B9-12 G8: stop ticking once the game ends
  // #39 GC-1: turnTime is RAW-SNAPPED from the SERVER_GAME_TIME truth (state.gameClock) — never forward-smoothed.
  // The value re-snaps each ~1000ms tick (per-second stopwatch); pre-first-tick (gameClock null) falls back to the
  // model turnTime raw. No local extrapolation → it can never creep-then-snap when the server stops the turn timer.
  const turnTime = gameStore.state.gameClock?.turnTime ?? (hud.value?.turnTime ?? 0);
  const remaining = Math.max(0, Math.floor((turnLimitMs.value - turnTime) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
});

// End-turn warning counts owned on-pitch players lacking the server acted flag, not locally derived eligibility.
const endTurnWarnCount = ref<number | null>(null);
watch(endTurnWarnCount, () => { reactivePromptDragPos.endTurnWarn = null; });
const endTurnUnavailableDuringReaction = computed(() =>
  gameStore.isPlaying.value && !gameStore.canPlayerEndTurn(gameStore.game.value?.turnMode),
);
/** Owner 09-08: the idle own players behind the End-Turn guard, as ids (the cue arrows + count both read this). */
function unactivatedOwnIds(): string[] {
  const g = gameStore.game.value;
  if (!g) return [];
  const acted = gameStore.state.actedPlayers;
  const active = gameStore.state.activePlayerId;
  // Exclude recovering STUNNED-to-PRONE players from idle count; ordinary prone players still count.
  const recovering = gameStore.state.recoveringPlayers;
  const ids: string[] = [];
  for (const d of (g.fieldModel?.playerDataArray ?? []) as { playerId?: string; playerCoordinate?: [number, number]; playerState?: unknown }[]) {
    const id = d.playerId;
    if (typeof id !== 'string' || id === active || acted.includes(id)) continue;
    if (!gameStore.iControl(id)) continue;
    if (recovering.includes(id)) continue; // #118: displayed-stunned recovering player (base PRONE, stun X held)
    const c = d.playerCoordinate;
    if (!c || c[0] < 0 || c[0] > 25 || c[1] < 0 || c[1] > 14) continue; // on-pitch only
    // #98 (owner): a STUNNED player can't act this turn → it's NOT "unactivated". Exclude base==STUNNED (a server
    //   playerState FLAG-READ, not an eligibility computation — C-8). PRONE still counts (it can Stand Up); KO/CAS/
    //   dead are already off-pitch (filtered above).
    const psRaw = d.playerState;
    const psNum = typeof psRaw === 'number' ? psRaw
      : ((psRaw as { id?: number; base?: number } | null)?.id ?? (psRaw as { base?: number } | null)?.base);
    if (typeof psNum === 'number' && (psNum & 0xff) === STUNNED_BASE) continue;
    ids.push(id);
  }
  return ids;
}
function unactivatedOwnCount(): number { return unactivatedOwnIds().length; }
/** Owner 09-08: "Go back" keeps the idle-player arrows for this long (or until the coach clicks a player). */
const UNACTIVATED_CUE_GRACE_MS = 2000;
function endTurn() {
  // Owner 2026-07-04 (interaction catalog 15): in play mode End Turn sends the
  // real clientEndTurn for the CURRENT turnMode (also closes kick-off mini-phases).
  if (!gameStore.isPlaying.value) { gameStore.demoEndTurn(); return; }
  // #8: idle players → raise the confirm modal; only its "End turn" proceeds.
  const idle = unactivatedOwnIds();
  if (idle.length > 0) {
    endTurnWarnCount.value = idle.length;
    renderer?.showUnactivatedCues(idle); // owner 09-08: ▼ + gold pulse on every idle player while the guard is up
    return;
  }
  gameStore.playerEndTurn();
}
function confirmEndTurnAnyway() {
  endTurnWarnCount.value = null;
  renderer?.clearUnactivatedCues(); // owner 09-08: End turn → tear the arrows down at once
  gameStore.playerEndTurn();
}
function cancelEndTurnWarn() {
  endTurnWarnCount.value = null;
  renderer?.armUnactivatedCuesExpiry(UNACTIVATED_CUE_GRACE_MS); // owner 09-08: Go back → 2 s grace, or until a player click
}
// #12/#231: one reusable guard owns Escape-driven activation ends plus the existing Blitz triggers. Confirm uses
// the unchanged clear-selection + endActivation effects; decline only dismisses the modal and sends no wire.
type EndActivationConfirm = { kind: EndActivationConfirmKind; text: string; confirmLabel: string };
const END_ACTIVATION_CONFIRM_COPY: Record<EndActivationConfirmKind, Omit<EndActivationConfirm, 'kind'>> = {
  blitz: { text: 'Are you sure you want to end your blitz?', confirmLabel: 'End blitz' },
  // Owner punt-① (08-12): the parallel PUNT commission specializes the copy, mirroring the blitz idiom.
  punt: { text: 'End your punt?', confirmLabel: 'End punt' },
  generic: { text: 'End activation?', confirmLabel: 'End activation' },
};
const endActConfirm = ref<EndActivationConfirm | null>(null);
watch(endActConfirm, () => { reactivePromptDragPos.endActConfirm = null; });
function askEndActivation(kind: EndActivationConfirmKind) {
  endActConfirm.value = { kind, ...END_ACTIVATION_CONFIRM_COPY[kind] };
}
function requestEndActivation() {
  const g = gameStore.game.value;
  const st = g ? deriveClientState(g, o66Ctx()) : '';
  if (requiresBlitzEndConfirmation(st)) askEndActivation('blitz');
  else if (st === 'PUNT') askEndActivation('punt');
  else if (gameStore.state.gazeIntent) askEndActivation('generic');
  else gameStore.endActivation();
}
function confirmEndActivation() {
  const kind = endActConfirm.value?.kind;
  endActConfirm.value = null;
  clearO66Arms();
  renderer?.clearSelection();
  gameStore.endActivation({ blitzConfirmed: kind === 'blitz' });
}
function cancelEndActivation() {
  // Owner punt-① (08-12): Declining "End your punt?" de-escalates the punt targeting back to the walk state
  // (Tarkin's returnPuntToMove `030f1d3f` — playerAction 'punt'→'puntMove'; activation intact, re-aim stays
  // live), not a bare dismiss. Other kinds (blitz/generic) only dismiss, no wire — unchanged.
  const kind = endActConfirm.value?.kind;
  endActConfirm.value = null;
  if (kind === 'punt') gameStore.returnPuntToMove();
}

// owner 2026-07-03 r6: the turn timer is a FLOATING, movable element. Default
// position is offset to the LEFT of the (centred) scoreboard; a drag persists
// in a local ref for the session.
const timerPos = ref<{ x: number; y: number } | null>(null);
const timerStyle = computed<Record<string, string>>(() => {
  if (timerPos.value) return { left: `${timerPos.value.x}px`, top: `${timerPos.value.y}px`, transform: 'none' };
  // Owner 2026-07-05: DEFAULT — sit just LEFT of the center (scoreboard) panel's left
  // edge, re-anchored whenever the UI reflows (measureTopPanel). translateX(-100%)
  // right-aligns the timer to that point so its width is irrelevant.
  // Owner 2026-07-07: FLAT mode pins the whole HUD to the very top as a thin line,
  // so the timer hugs the top edge (top:2) too, just left of the scoreboard.
  const cb = centerPanelBox.value;
  const topPx = settings.flatRender ? 2 : Math.max(8, cb ? Math.round(cb.top) : 8);
  if (cb) return { left: `${Math.round(cb.left - 10)}px`, top: `${topPx}px`, transform: 'translateX(-100%)' };
  return { left: 'calc(50% - 237px)', top: `${topPx}px`, transform: 'none' }; // pre-measure fallback
});
function startTimerDrag(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('button')) return; // Call time-out stays clickable
  const el = event.currentTarget as HTMLElement;
  const host = pitchHost.value;
  if (!host) return;
  event.preventDefault();
  const rect = el.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const dx = event.clientX - rect.left;
  const dy = event.clientY - rect.top;
  const move = (ev: PointerEvent) => {
    timerPos.value = {
      x: Math.max(0, Math.min(ev.clientX - hostRect.left - dx, hostRect.width - rect.width)),
      y: Math.max(0, Math.min(ev.clientY - hostRect.top - dy, hostRect.height - rect.height)),
    };
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function sendChat() {
  const text = chatInput.value.trim();
  if (text) {
    // Owner 2026-07-08: a leading '/' routes to the DEV CONSOLE (e.g. /stuck to pass a
    // stuck turn) instead of being sent as chat.
    if (text.startsWith('/')) gameStore.devCommand(text);
    else gameStore.sendTalk(text);
    chatInput.value = '';
  } else {
    // owner 2026-07-08: Enter on an empty field unfocuses the chat input.
    chatInputEl.value?.blur();
  }
}
</script>

<template>
  <div class="spectate" :style="presentationCssVars">
    <!-- owner 2026-07-03 r6f Option A: the green connect bar is REMOVED. The header
         "Browse" button (App.vue) opens the game browser below as the primary
         game-entry; the server toggle + game-id / game-name entry now live inside
         the browser, and session state + Disconnect moved to the header. -->

    <!-- Owner 2026-07-09: a join failure (finished/unavailable game, timeout, or refused join) is now
         a CENTERED modal like the Reconnect/Disconnect screen — click anywhere to dismiss. -->
    <div v-if="gameStore.state.joinError" class="conn-closed-overlay" role="alertdialog" aria-modal="true"
      title="Click to dismiss" @click="gameStore.state.joinError = null">
      <div class="conn-closed-card">
        <h2>Couldn't join</h2>
        <p>{{ gameStore.state.joinError }}</p>
        <p class="hint">Click anywhere to dismiss.</p>
      </div>
    </div>

    <!-- Owner 2026-07-07: the connection dropped mid-game (not a user Disconnect) — a
         visible "Connection closed" prompt with a reconnect-to-last-game action. In play
         mode the client auto-reconnects (shows "Reconnecting…"); the manual button is the
         fallback (spectators, or once auto-retries are exhausted). -->
    <div v-if="gameStore.state.connectionClosed" class="conn-closed-overlay" role="alertdialog" aria-modal="true">
      <div class="conn-closed-card">
        <h2>Connection closed</h2>
        <p v-if="gameStore.state.connectionClosed.reconnecting" class="conn-closed-status">
          <span class="conn-spinner" aria-hidden="true"></span>
          Reconnecting to {{ gameStore.state.connectionClosed.label }}…
        </p>
        <p v-else>
          Lost connection to {{ gameStore.state.connectionClosed.label }}<span v-if="gameStore.state.connectionClosed.code"> (code {{ gameStore.state.connectionClosed.code }})</span>.
        </p>
        <div class="conn-closed-actions">
          <button v-if="!gameStore.state.connectionClosed.reconnecting" type="button" class="primary" @click="gameStore.reconnect()">Reconnect</button>
          <button type="button" @click="gameStore.disconnect()">{{ gameStore.state.connectionClosed.reconnecting ? 'Cancel' : 'Disconnect' }}</button>
        </div>
      </div>
    </div>

    <!-- Owner 2026-07-09: FUMBBL matchmaking — connected + waiting for the other coach to join the
         same game name before the game starts. Auto-dismisses when the gameState arrives. -->
    <div v-if="gameStore.state.waitingForMatch" class="conn-closed-overlay" role="alertdialog" aria-modal="true">
      <div class="conn-closed-card">
        <h2 v-if="gameStore.state.waitingForMatch.opponentCoach">Waiting for {{ gameStore.state.waitingForMatch.opponentCoach }}</h2>
        <h2 v-else>Waiting for the other coach</h2>
        <p class="conn-closed-status">
          <span class="conn-spinner" aria-hidden="true"></span>
          <span v-if="gameStore.state.waitingForMatch.opponentCoach">Waiting for <strong>{{ gameStore.state.waitingForMatch.opponentCoach }}</strong> to join<span v-if="gameStore.state.waitingForMatch.gameName"> “{{ gameStore.state.waitingForMatch.gameName }}”</span>… Are they afraid? 👀</span>
          <span v-else-if="gameStore.state.waitingForMatch.gameName">You're in “{{ gameStore.state.waitingForMatch.gameName }}” — the game starts as soon as the other coach joins the <em>same</em> game name.</span>
          <span v-else>Waiting for the game to start — you'll drop in when your match is ready.</span>
        </p>
        <p class="hint" v-if="gameStore.state.waitingForMatch.teamName">Playing as {{ gameStore.state.waitingForMatch.coach }} with {{ gameStore.state.waitingForMatch.teamName }}.</p>
        <div class="conn-closed-actions">
          <button type="button" @click="gameStore.disconnect()">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Owner 2026-07-07: a spectated CONCEDE — name who conceded, shown over the
         end-game screen. Dismiss reveals the post-game panel underneath. -->
    <div v-if="gameStore.state.concedeNotice" class="concede-overlay" role="alertdialog" aria-modal="true">
      <div class="concede-card">
        <!-- #25-v2 (owner ask #1): the CONCEDING coach gets the "no MVP" explanation; spectators + the opponent see the generic notice. -->
        <template v-if="iConceded">
          <h2>You conceded</h2>
          <p>No MVP is awarded — conceding forfeits the MVP, winnings, and SPP.</p>
        </template>
        <template v-else>
          <h2>Game conceded</h2>
          <p><b>{{ gameStore.state.concedeNotice.coach || gameStore.state.concedeNotice.teamName || 'A coach' }}</b> conceded the match.</p>
          <p v-if="gameStore.state.concedeNotice.coach && gameStore.state.concedeNotice.teamName" class="concede-team">{{ gameStore.state.concedeNotice.teamName }}</p>
        </template>
        <button type="button" @click="gameStore.state.concedeNotice = null">View result</button>
      </div>
    </div>

    <!-- C6 (owner 2026-07-09): the server SHUT THIS MATCH DOWN (invalid state / crash). A
         terminal overlay showing the server's reason; the board is cleared + play is gated
         off underneath. The only action is to leave — no reconnect (the game is gone). -->
    <div v-if="gameStore.state.gameShutdown" class="shutdown-overlay" role="alertdialog" aria-modal="true">
      <div class="shutdown-card">
        <h2>Match ended</h2>
        <p>{{ gameStore.state.gameShutdown.reason }}</p>
        <p class="shutdown-sub">The server closed this match<span v-if="gameStore.state.gameShutdown.code"> (code {{ gameStore.state.gameShutdown.code }})</span>. It can't be resumed.</p>
        <button type="button" @click="gameStore.disconnect()">Leave</button>
      </div>
    </div>

    <!-- B3-9: FUMBBL game browser — the PRIMARY game-entry (owner 2026-07-03 r6f
         Option A). Opened from the header "Browse" button as a centered modal;
         holds the FUMBBL / Super FUMBBL server toggle, the game-id (Spectate) /
         game-name (Play) entry, Load demo, and the live match list. -->
    <div v-if="rejoinBrowserVisible" class="modal-backdrop browse-backdrop" @click.self="ui.browserOpen = false">
      <div class="game-browser">
        <div class="gb-toolbar">
          <!-- owner 2026-07-09: the FUMBBL / Super FUMBBL server toggle moved UP to the header (server
               is chosen first, before Play/Spectate). This toolbar shows the active server as a label. -->
          <span class="gb-server-label" :data-server="settings.activeServerTarget">{{ settings.activeServerTarget === 'fumbbl' ? 'FUMBBL' : 'Super FUMBBL' }}</span>
          <!-- owner 2026-07-08 (UI restructure): the fork server IP + Bot URL moved to
               Settings → Connection (out of the browser bar). -->
          <input v-model="browserFilter" type="search" class="gb-filter"
            :placeholder="isPlayMode ? 'Filter (coach / team / id…)' : 'Filter, or type a game id + Enter to spectate'"
            :title="isPlayMode ? 'Filter the list by any text — e.g. a coach or team name, or a game id'
              : 'Filter the list by any text; or type an exact game id and press Enter to spectate it directly'"
            @keyup.enter="onFilterEnter" />
          <span v-if="browserPolling && settings.activeServerTarget === 'fumbbl'" class="gb-live"
            title="Auto-updating every 30s (stops after 5 min)">● live</span>
          <button type="button" class="gb-refresh" title="Refresh the list" @click="refreshBrowser()">↻</button>
          <button type="button" class="gb-close" title="Close (back to the pitch)" @click="ui.browserOpen = false">✕</button>
        </div>

        <!-- Lobby entry follows Play/Spectate and branch selection; FUMBBL live play remains JNLP-only. -->
        <!-- FUMBBL live-play LOBBY (owner 2026-07-09): shown after opening a FUMBBL player JNLP.
             Enter a game name to create/join a match by name, or Join a live game from the list. -->
        <div v-if="fumbblLobby" class="gb-entry gb-fumbbl-lobby">
          <p class="hint">FUMBBL — playing as <strong>{{ fumbblLobby.coach }}</strong> with <strong>{{ fumbblLobby.teamName }}</strong>. Enter a game name (both coaches use the <em>same</em> name — the 2nd to join starts the game).</p>
          <form class="gb-entry-row" @submit.prevent="fumbblJoinByName()">
            <input v-model="fumbblLobbyGameName" type="text" placeholder="Game name" size="16" autofocus />
            <button type="submit" :disabled="!fumbblLobbyGameName.trim()">Create / Join by name</button>
            <button type="button" class="gb-close" title="Cancel this FUMBBL join" @click="clearFumbblLobby()">Cancel</button>
          </form>
        </div>
        <div class="gb-entry">
          <!-- owner 2026-07-14: the standalone Spectate "Game id" box is gone — it's folded into the filter
               bar above (type an id + Enter to spectate; or double-click a row). Play-mode entries stay. -->
          <template v-if="isPlayMode && settings.activeServerTarget === 'fork'">
            <!-- #210 (owner-endorsed, "your games in progress panel is great"): the coach's in-progress games,
                 server-derived, with one-click REJOIN by id. Sits ABOVE the manual rejoin-by-id input and the
                 create/browse-a-new-game controls, per Yularen's pinned shape. -->
            <div class="gb-mygames">
              <div class="gb-mygames-head">
                <span class="gb-mygames-title">Your games in progress</span>
                <button type="button" class="gb-refresh" title="Refresh your games" :disabled="myGamesLoading"
                  @click="loadMyGames(true)">↻</button>
              </div>
              <p v-if="myGamesLoading" class="hint">Loading your games…</p>
              <p v-else-if="myGamesError" class="hint gb-mygames-err">Couldn't load your games — {{ myGamesError }}</p>
              <p v-else-if="!myGames.length" class="hint">No games in progress — create or join one below, or rejoin by id.</p>
              <ul v-else class="gb-mygames-list">
                <li v-for="g in myGames" :key="g.gameId" class="gb-mygames-row">
                  <span class="gb-mygames-vs">
                    <strong>{{ g.myTeamName }}</strong> vs {{ g.opponentTeamName }} <em>({{ g.opponentCoach }})</em>
                  </span>
                  <!-- inProgress = the distinct-label discriminator (false ⇒ scheduled). Time keys on scheduled-or-
                       started, never `started` alone (null on scheduled rows). -->
                  <span class="gb-mygames-status" :data-inprogress="g.inProgress">
                    {{ g.inProgress ? (g.half ? `H${g.half} T${g.turn}` : 'in progress') : 'scheduled' }}
                  </span>
                  <button type="button" class="gb-rejoin-btn" title="Rejoin this game" @click="rejoinMyGame(g)">Rejoin</button>
                </li>
              </ul>
            </div>
            <!-- #211: manual REJOIN BY GAME ID — the fallback beneath the rows for a game not in the list. -->
            <form class="gb-entry-row gb-entry-quick gb-rejoin" @submit.prevent="rejoinByGameId()"
              title="Rejoin one of your in-progress games by its game id — for a game that dropped from the list above (e.g. after a disconnect)">
              <input v-model="rejoinGameId" type="text" inputmode="numeric" placeholder="Rejoin game id" size="10"
                title="The numeric game id of your in-progress game" />
              <button type="submit" :disabled="!rejoinGameId.trim()">Rejoin</button>
            </form>
            <div class="gb-entry-row">
              <button type="button" class="gb-creategame" title="Pick a team from your library + challenge an opponent by name"
                @click="openCreateGame">Create Game ✦</button>
              <button type="button" class="gb-import" title="Import a team from FUMBBL into your fork library (opens Create Game, where the team-import field lives)"
                @click="openCreateGame">Import Team ↓</button>
            </div>
            <form class="gb-entry-row gb-entry-quick" @submit.prevent="joinPlay()"
              title="Quick join/create by name — both coaches use the SAME name; the 2nd join starts the game">
              <input v-model="gameName" type="text" placeholder="Game name" size="12" />
              <input v-model="playTeamId" type="text" placeholder="Team id" size="9"
                title="Your fork team id (the number in the FUMBBL team URL, e.g. 1272390)" />
              <button type="submit">Play</button>
            </form>
          </template>
          <template v-else-if="isPlayMode">
            <!-- FUMBBL play branch (spectate mode shows nothing here — the filter bar + list handle it). -->
            <!-- JNLP-free FUMBBL login (owner 2026-07-09): mint a one-time token via FUMBBL's API
                 instead of downloading ffblive.jnlp. The API credential is a SINGLE application
                 token baked in at build time (see game/fumbblAuth.ts) — occluded from settings; the
                 form only shows when the build carries it, otherwise the JNLP path is the fallback. -->
            <form v-if="fumbblApiConfigured()" class="gb-entry-row gb-entry-quick" @submit.prevent="fumbblLoginNoJnlp()"
              title="Log in to FUMBBL and mint a play token directly — no .jnlp file needed">
              <input v-model="fumbblNoJnlpTeamId" type="text" placeholder="Team id" size="10"
                title="Your FUMBBL team id (the number in the team URL, e.g. 1276734)" />
              <button type="submit" :disabled="fumbblLoginBusy || !fumbblNoJnlpTeamId.trim()">
                {{ fumbblLoginBusy ? 'Logging in…' : 'Log in (no JNLP)' }}
              </button>
            </form>
            <p v-if="fumbblLoginError" class="hint gb-fumbbl-err">{{ fumbblLoginError }}</p>
            <div class="gb-entry-row">
              <button type="button" class="gb-creategame" disabled
                title="FUMBBL-live play runs through FUMBBL's own client — use Log in or Open .jnlp">Create Game ✦</button>
              <button type="button" @click="jnlpInput?.click()"
                title="Open a FUMBBL .jnlp — the classic path if you don't use API login">Open .jnlp…</button>
            </div>
          </template>
          <!-- Testbed shortcuts (dev): demos + captured-block replay. -->
          <details class="gb-testbed">
            <summary>Testbed ▸</summary>
            <div class="gb-entry-row">
              <button type="button" class="gb-demo" @click="gameStore.loadDemo(); ui.browserOpen = false">Load demo</button>
              <button type="button" class="gb-demo" title="Replay a real captured block through the live pipeline (no server)"
                @click="gameStore.demoReplayBlock(); ui.browserOpen = false">Replay block</button>
              <button type="button" class="gb-demo" title="Throw Team-Mate through the full sequence on a fresh demo game"
                @click="gameStore.loadDemo().then(() => gameStore.demoThrowTeamMate()); ui.browserOpen = false">Throw team-mate</button>
              <button type="button" class="gb-demo" title="Changing-weather gust — the ball scatters along random directions"
                @click="gameStore.loadDemo().then(() => gameStore.demoWeatherScatter()); ui.browserOpen = false">Weather gust</button>
            </div>
          </details>
          <input ref="jnlpInput" type="file" accept=".jnlp,text/xml" style="display: none" @change="openJnlpFile" />
        </div>

        <p v-if="browserStatus" class="hint">{{ browserStatus }}</p>
        <p v-else-if="filteredMatches.length === 0" class="hint">No games match “{{ browserFilter }}”.</p>
        <table v-else>
          <tbody>
            <tr v-for="m in filteredMatches" :key="m.id" class="gb-row" title="Double-click to spectate"
              @dblclick="spectateMatch(m.id)">
              <td class="gb-id">{{ m.id }}</td>
              <td>{{ m.teams[0]?.name }} <em>({{ m.teams[0]?.coach }}, {{ m.teams[0]?.race }})</em></td>
              <td class="gb-score">{{ m.teams[0]?.score }}–{{ m.teams[1]?.score }}</td>
              <td>{{ m.teams[1]?.name }} <em>({{ m.teams[1]?.coach }}, {{ m.teams[1]?.race }})</em></td>
              <td class="gb-half">{{ m.half === 0 ? 'pre-kick' : `H${m.half} T${m.turn}` }}</td>
              <td>
                <button @click="spectateMatch(m.id)">Spectate</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Owner 2026-07-08: CREATE GAME — pick a team from the library + challenge an opponent by name.
         The Bot pairs reciprocal challenges and returns a JNLP we open in-process. -->
    <!-- Owner 2026-08-18: the Report modal. Reuses the Create Game modal's shell/classes; the tester
         writes what happened and the client attaches the diagnostics itself. The attachment list is
         shown, not implied, so nobody sends a log they didn't know they were sending. Backdrop click
         does NOT close it — losing a half-written report to a stray click is exactly the failure this
         feature exists to remove. -->
    <div v-if="reportOpen" class="modal-backdrop cg-backdrop">
      <div class="cg-menu br-menu">
        <div class="cg-head">
          <h2>🐞 Report an Issue</h2>
          <button class="cg-close" :disabled="reportBusy" @click="reportOpen = false">✕</button>
        </div>

        <label class="cg-field">What happened?
          <textarea v-model="reportText" class="br-text" rows="7" :maxlength="REPORT_MAX"
            placeholder="What did you do, what did you expect, and what happened instead?"></textarea>
        </label>
        <p class="hint br-count">{{ reportText.length }} / {{ REPORT_MAX }}</p>

        <div class="br-attach">
          <span class="cg-field-label">Sent with your report</span>
          <ul>
            <li v-for="line in reportAttachments" :key="line">{{ line }}</li>
          </ul>
        </div>

        <p v-if="reportError" class="br-error">{{ reportError }}</p>

        <div class="cg-actions">
          <button type="button" class="cg-cancel" :disabled="reportBusy" @click="reportOpen = false">Cancel</button>
          <button type="button" class="cg-create" :disabled="reportBusy || !reportText.trim()"
            @click="submitReport">{{ reportBusy ? 'Sending…' : 'Send Report' }}</button>
        </div>
      </div>
    </div>

    <div v-if="createGameOpen" class="modal-backdrop cg-backdrop" @click.self="createGameOpen = false">
      <div class="cg-menu">
        <div class="cg-head">
          <h2>Create Game</h2>
          <button class="cg-close" @click="createGameOpen = false">✕</button>
        </div>

        <template v-if="!cgWaiting">
          <label class="cg-field">Opponent
            <input v-model="cgOpponent" @input="onOpponentInput" type="text" autocomplete="off"
              placeholder="opponent coach name" />
          </label>
          <ul v-if="cgSuggestions.length" class="cg-suggest">
            <li v-for="s in cgSuggestions" :key="s" @click="pickSuggestion(s)">{{ s }}</li>
          </ul>

          <span class="cg-field-label">Your team</span>
          <button type="button" class="cg-teambtn" @click="cgChooseOpen = !cgChooseOpen">
            <template v-if="cgSelectedTeam">{{ cgSelectedTeam.teamName }} — {{ cgSelectedTeam.race }} · TV
              {{ cgSelectedTeam.teamValue ?? '?' }} · {{ (cgSelectedTeam.gold ?? 0).toLocaleString() }}g</template>
            <template v-else>Choose team ▾</template>
          </button>

          <div v-if="cgChooseOpen" class="cg-library">
            <div class="cg-library-head"><span>Your library</span>
              <button type="button" class="cg-refresh" title="Reload" @click="loadLibrary">↻</button>
            </div>
            <ul v-if="cgLibrary.length" class="cg-teamlist">
              <li v-for="t in cgLibrary" :key="t.teamId" class="cg-teamcard"
                :class="{ selected: cgSelectedTeam?.teamId === t.teamId }" @click="selectTeam(t)">
                <span class="cg-teamname">{{ t.teamName }}<span v-if="t.forkLoadable === false"
                  class="cg-warn" title="No matching fork roster — may not load"> ⚠</span></span>
                <span class="cg-teammeta">{{ t.race }} · TV {{ t.teamValue ?? '?' }} · {{ (t.gold ?? 0).toLocaleString() }}g</span>
              </li>
            </ul>
            <p v-else class="hint">No teams in your library yet.</p>
            <div class="cg-ingest">
              <input v-model="cgIngestInput" type="text" placeholder="FUMBBL team id or URL"
                @keydown.enter.prevent="ingestTeam" />
              <button type="button" :disabled="cgBusy" @click="ingestTeam">Import Team</button>
            </div>
          </div>

          <p v-if="cgStatus" class="hint cg-status">{{ cgStatus }}</p>
          <div class="cg-actions">
            <button type="button" class="cg-cancel" @click="createGameOpen = false">Cancel</button>
            <button type="button" class="cg-create" :disabled="cgBusy || !cgSelectedTeam || !cgOpponent.trim()"
              @click="startChallenge">{{ cgBusy ? 'Working…' : 'Create Game' }}</button>
          </div>
        </template>

        <template v-else>
          <div class="cg-waiting">
            <div class="cg-spinner">⏳</div>
            <p>{{ cgStatus }}</p>
            <button type="button" class="cg-cancel" @click="cancelChallenge">Cancel challenge</button>
          </div>
        </template>
      </div>
    </div>

    <div class="main">
      <div ref="pitchHost" class="pitch-host"
        :class="settings.modernHudStyle === 'minimalist' ? 'hud-minimalist' : 'hud-chrome'"
        :style="hudAccessibilityStyle">
        <ReplayTelestrator
          :enabled="props.mode === 'spectate' || props.mode === 'replay'"
          :toolbar-bottom="telestratorBottom"
          :toolbar-right="telestratorRight"
          :toolbar-left="quickBarLeft"
          :toolbar-position="settings.uiLayout.telestrator ?? null"
          @update:toolbar-position="setTelestratorPosition"
          :session-key="props.mode === 'replay' ? gameStore.replay.sessionKey : `spectate:${gameStore.game.value?.gameId ?? ''}`"
          :to-world="(x: number, y: number) => renderer?.localToWorld(x, y) ?? { x, y }"
          :to-local="(x: number, y: number) => renderer?.worldToLocal(x, y) ?? { x, y }"
          :camera-scale="() => renderer?.cameraScale() ?? 1"
        />
        <ReplayControls v-if="props.mode === 'replay'" />
        <!-- BB2-style HUD (owner 2026-07-02): coach corners + center cluster -->
        <div v-if="homePanel && !inducePhaseOpen" class="coach-panel home ui-panel" :class="{ 'ui-customizing': settings.uiCustomize, 'ui-resizing': panelScaleResizeActive['coach-home'] }"
          :data-playing="homePanel.playing" :style="customPanelStyle('coach-home')">
          <template v-if="settings.uiCustomize">
            <span class="ui-grip" title="Drag to move" @pointerdown="startPanelMove('coach-home', $event)">⠿</span>
            <span class="ui-resizer" title="Drag to resize" @pointerdown="startPanelResize('coach-home', $event)"></span>
            <button class="ui-reset" title="Reset to default" @click="resetPanel('coach-home')">↺</button>
          </template>
          <div class="logo-col">
            <img v-if="homePanel.logo" class="race-logo" :src="homePanel.logo" alt="" />
          </div>
          <div class="coach-lines">
            <div class="coach-name">{{ homePanel.coach }}</div>
            <div class="team-title">{{ homePanel.teamName }}</div>
            <div class="inducements" aria-label="Team resources and inducements">
              <span v-for="chip in homePanel.chips" :key="chip.label" class="inducement" :data-pool="chip.pool" :title="chip.label">
                <img :src="resourceIcon(chip.icon)" alt="" />
                <b class="inducement-quantity">{{ chip.count }}</b>
              </span>
            </div>
          </div>
          <div class="active-indicator" role="status" :data-active="homePanel.playing"
            :aria-hidden="!homePanel.playing"
            :title="homePanel.playing ? 'This coach is activating a player' : 'This coach is waiting'">
            <span class="active-label">Current Player</span>
          </div>
          <div v-if="homePrayers.length" class="prayer-tag" role="list" aria-label="Prayers to Nuffle in effect">
            <div v-for="pr in homePrayers" :key="pr.name" class="prayer-tag-row" role="listitem" :title="pr.effect">
              <span class="prayer-tag-icon">{{ pr.icon }}</span><span class="prayer-tag-name">{{ pr.label }}</span>
            </div>
          </div>
          <div v-if="coachDecisionSide === 'home'" class="coach-decision-status" role="status" aria-live="polite">is deciding...</div>
          <!-- owner 2026-07-04e: the per-coach turn number moved to the central
               scoreboard's bottom row (was a corner badge here) -->
        </div>
        <div v-if="awayPanel && !inducePhaseOpen" class="coach-panel away ui-panel" :class="{ 'ui-customizing': settings.uiCustomize, 'ui-resizing': panelScaleResizeActive['coach-away'] }"
          :data-playing="awayPanel.playing" :style="customPanelStyle('coach-away')">
          <template v-if="settings.uiCustomize">
            <span class="ui-grip" title="Drag to move" @pointerdown="startPanelMove('coach-away', $event)">⠿</span>
            <span class="ui-resizer" title="Drag to resize" @pointerdown="startPanelResize('coach-away', $event)"></span>
            <button class="ui-reset" title="Reset to default" @click="resetPanel('coach-away')">↺</button>
          </template>
          <div class="logo-col">
            <img v-if="awayPanel.logo" class="race-logo" :src="awayPanel.logo" alt="" />
          </div>
          <div class="coach-lines">
            <div class="coach-name">{{ awayPanel.coach }}</div>
            <div class="team-title">{{ awayPanel.teamName }}</div>
            <div class="inducements" aria-label="Team resources and inducements">
              <span v-for="chip in awayPanel.chips" :key="chip.label" class="inducement" :data-pool="chip.pool" :title="chip.label">
                <img :src="resourceIcon(chip.icon)" alt="" />
                <b class="inducement-quantity">{{ chip.count }}</b>
              </span>
            </div>
          </div>
          <div class="active-indicator" role="status" :data-active="awayPanel.playing"
            :aria-hidden="!awayPanel.playing"
            :title="awayPanel.playing ? 'This coach is activating a player' : 'This coach is waiting'">
            <span class="active-label">Current Player</span>
          </div>
          <div v-if="awayPrayers.length" class="prayer-tag" role="list" aria-label="Prayers to Nuffle in effect">
            <div v-for="pr in awayPrayers" :key="pr.name" class="prayer-tag-row" role="listitem" :title="pr.effect">
              <span class="prayer-tag-icon">{{ pr.icon }}</span><span class="prayer-tag-name">{{ pr.label }}</span>
            </div>
          </div>
          <div v-if="coachDecisionSide === 'away'" class="coach-decision-status" role="status" aria-live="polite">is deciding...</div>
        </div>

        <!-- Owner 2026-07-04e: the central scoreboard is a single 2-row × 3-col
             unit — top: 1st Half | Score | Weather; bottom: HomeTurn badge |
             local turn state | AwayTurn badge. The middle control exists only
             for a seated coach; spectators and replays leave that cell empty. -->
        <div v-if="hud" class="hud-center scoreboard ui-panel" :class="{ 'ui-customizing': settings.uiCustomize, 'ui-resizing': panelScaleResizeActive.scoreboard, 'flat-hud': settings.flatRender }"
          :style="customPanelStyle('scoreboard')">
          <template v-if="settings.uiCustomize">
            <span class="ui-grip" title="Drag to move" @pointerdown="startPanelMove('scoreboard', $event)">⠿</span>
            <span class="ui-resizer" title="Drag to resize" @pointerdown="startPanelResize('scoreboard', $event)"></span>
            <button class="ui-reset" title="Reset to default" @click="resetPanel('scoreboard')">↺</button>
          </template>
          <span class="sb-cell sb-half">{{ gameOver ? endGamePhaseLabel : hud.half === 1 ? '1st Half' : hud.half === 2 ? '2nd Half' : hud.half === 0 ? 'Pre-Game' : hud.half >= 3 ? 'Overtime' : `Half ${hud.half}` }}</span>
          <span class="sb-cell sb-score"><b class="score-home">{{ hud.scoreHome }}</b> – <b class="score-away">{{ hud.scoreAway }}</b></span>
          <span class="sb-cell sb-weather" :title="weatherEffect(hud.weather)">
            <small>WEATHER</small><span aria-hidden="true">{{ hud.weatherIcon }}</span>
          </span>
          <span class="sb-cell sb-turn home" :data-active="homePanel?.playing ?? false"
            :title="`${homePanel?.coach ?? 'Home'} — turn ${homePanel?.turnNr ?? 0}`">Turn {{ homePanel?.turnNr ?? 0 }}</span>
          <button v-if="gameStore.isPlaying.value" class="sb-cell end-turn"
            :disabled="!gameStore.myTurn.value || endTurnUnavailableDuringReaction"
            :data-opponent="!gameStore.myTurn.value"
            :data-setup="endTurnButtonText === 'Confirm Setup'"
            :title="!gameStore.myTurn.value ? 'Waiting for opponent' : endTurnUnavailableDuringReaction ? 'End Turn unavailable during a reaction' : 'End the current turn (or kick-off mini-phase)'"
            @click="endTurn()">{{ endTurnButtonText }}</button>
          <span class="sb-cell sb-turn away" :data-active="awayPanel?.playing ?? false"
            :title="`${awayPanel?.coach ?? 'Away'} — turn ${awayPanel?.turnNr ?? 0}`">Turn {{ awayPanel?.turnNr ?? 0 }}</span>
        </div>
        <!-- #18a (owner tester): passive "opponent reviewing dice" indicator near the scorebar. Bound
             directly to state.opponentReviewingDice — DERIVED each frame in-store (keyed on the block
             dialog's choosingTeamId with the Side-Step decider-team suppression, Meero C-18a), so it
             self-clears on every exit path (pick / reroll / timeout / turnover / disconnect). Existence
             only — never the dice values/count/result. -->
        <div v-if="gameStore.state.opponentReviewingDice" class="opp-reviewing-dice">
          <span class="ord-dot"></span>Opponent reviewing dice…
        </div>
        <div v-if="hud" class="turn-timer" :class="{ 'flat-hud': settings.flatRender }" :data-timeout="hud.timeoutEnforced" :style="timerStyle"
          title="Drag to move" @pointerdown="startTimerDrag">
          <template v-if="gameOver">🏁 {{ endGamePhaseLabel }}</template>
          <template v-else-if="hud.timeoutEnforced">TIME OUT</template>
          <template v-else>⏳ {{ turnClock }}</template>
          <button v-if="hud.timeoutPossible && !gameOver && !hud.timeoutEnforced && !timeoutCalled" class="call-timeout"
            :disabled="!gameStore.isPlaying.value || gameStore.myTurn.value"
            :title="gameStore.isPlaying.value && !gameStore.myTurn.value
              ? 'Force a timeout on your opponent — their clock ran out'
              : 'Only the waiting coach can call a timeout'"
            @click="onCallTimeout">
            Call time-out
          </button>
          <!-- #14b T-3 (Fives): caller-side honesty copy. Display-only — replaces the
               button after the click until the server confirms via timeoutEnforced (then
               the box shows TIME OUT). Only the waiting coach reaches this (button is
               disabled for the active side + spectators, A-4). -->
          <span v-else-if="timeoutCalled && !gameOver && !hud.timeoutEnforced" class="call-timeout-note">
            Time-out called — opponent's turn ends on their next action
          </span>
        </div>
        <!-- BB3-style config buttons (owner 2026-07-02); positioned under the
             top-left coach panel + matched to its width (owner 2026-07-03) -->
        <nav class="config-bar ui-panel"
          :class="{ 'ui-customizing': settings.uiCustomize, 'ui-resizing': panelScaleResizeActive['config-bar'], 'bar-right': settings.bottomBarsSwapped, 'bar-left': !settings.bottomBarsSwapped }"
          :style="configBarStyle">
          <template v-if="settings.uiCustomize">
            <span class="ui-grip" title="Drag to move" @pointerdown="startPanelMove('config-bar', $event)">⠿</span>
            <span class="ui-resizer" title="Drag to resize" @pointerdown="startPanelResize('config-bar', $event)"></span>
            <button class="ui-reset" title="Reset to default" @click="resetPanel('config-bar')">↺</button>
          </template>
          <QuickBarButton disclosure :active="ui.settingsOpen" class="icon-button" title="Settings"
            @click="openSettingsPane()">⚙</QuickBarButton>
          <QuickBarButton stateful :active="tackleZonesActive" class="icon-button" :title="`Tackle zones: ${TZ_LABELS[settings.tackleZoneMode]}`"
            @click="cycleTackleZones()">🛡</QuickBarButton>
          <QuickBarButton stateful :active="spriteSet !== 'classic'" :data-sprite-set="spriteSet" class="icon-button"
            :title="`Sprites: ${spriteChoiceLabel}`"
            @click="cycleSprites()">👤</QuickBarButton>
          <QuickBarButton stateful :active="skillMode === 'markings'" class="skill-mode-btn"
            :data-skill-mode="skillMode" :aria-label="`Skill display: ${SKILL_MODE_LABELS[skillMode]}`"
            :title="`Skill display: ${SKILL_MODE_LABELS[skillMode]} (toggle Icons/Markings)`"
            @click="cycleSkillDisplay()">{{ SKILL_MODE_SHORT[skillMode] }}</QuickBarButton>
          <!-- collapse-log button removed (owner 2026-07-03): the log panel has
               its own ▾ collapse button on its title bar. -->
          <QuickBarButton stateful class="icon-button" :active="settings.showStadium"
            :title="settings.showStadium ? 'Hide stadium' : 'Show stadium'"
            @click="settings.showStadium = !settings.showStadium">🏟️</QuickBarButton>
          <!-- Owner 2026-07-03: Auto Director — one toggle for the automatic camera
               work (zoom + track + nudge to the action). Off = a calm static cam. -->
          <QuickBarButton stateful class="director-btn icon-button" :active="settings.autoDirector"
            :title="`Auto Director — auto zoom + track the action: ${settings.autoDirector ? 'ON (click to calm the camera)' : 'OFF'}`"
            @click="settings.autoDirector = !settings.autoDirector">🎬</QuickBarButton>
          <QuickBarButton class="report-btn" title="Report an issue — sends your description with the wire log"
            @click="openReport()"><span class="report-bug">🐞</span><span class="report-label">REPORT</span></QuickBarButton>
          <div class="quick-brand-menu">
            <button v-if="!gameStore.state.demoMode && gameStore.state.spectatorCount > 0"
              class="quick-live" :class="{ expanded: liveSpectatorsExpanded }"
              :data-flash="liveFlashing"
              :aria-expanded="liveSpectatorsExpanded"
              :aria-label="`${gameStore.state.spectatorCount} spectator${gameStore.state.spectatorCount === 1 ? '' : 's'} watching live`"
              :title="`${gameStore.state.spectatorCount} spectator${gameStore.state.spectatorCount === 1 ? '' : 's'} watching live`"
              @click="liveSpectatorsExpanded = !liveSpectatorsExpanded">
              <!-- Owner 09-09: expanded, the spectating coaches list ABOVE the "N watching live" line (upstream
                   spectatorNames on serverJoin / serverLeave). -->
              <span v-if="liveSpectatorsExpanded && gameStore.state.spectatorNames.length" class="quick-live-names">
                <span v-for="name in gameStore.state.spectatorNames" :key="name">{{ name }}</span>
              </span>
              <span class="quick-live-row">
                <span class="quick-live-dot" aria-hidden="true">●</span><b>{{ gameStore.state.spectatorCount }}</b>
                <span v-if="liveSpectatorsExpanded" class="quick-live-detail">watching live</span>
              </span>
            </button>
            <img class="quick-super-logo" :src="superFumbblLogoUrl" alt="Super FUMBBL" />
            <button class="quick-menu" type="button" title="Menu" aria-label="Menu" @click="emit('open-menu')">☰</button>
          </div>
        </nav>

        <!-- incoming-chat toast (owner 2026-07-03): under the home coach panel
             when the chat tab isn't focused; click to open chat. -->
        <!-- Owner 2026-07-07: chat toasts STACK (oldest→newest, newest at the bottom);
             a new line fills in at the bottom and pushes older ones up, capped at 3. -->
        <div v-if="chatToasts.length" class="chat-toast-stack" :class="{ 'endgame-front': endGameFront }" :style="chatToastStyle">
          <ChatToast v-for="t in chatToasts" :key="t.id" :sender="t.sender" :text="t.text"
            :role="chatToastRole(t.side, gameStore.mySeat.value, gameStore.isPlaying.value)"
            :text-size="settings.chatToastTextSize" @open="openChatFromToast" />
        </div>

        <!-- Owner 08-17 (row2): interceptor-wait toast — dead air during the opponent's interceptor
             choice, both passer + spectators. Server-derived (gameStore.interceptWait); clears itself
             the instant the predicate does. Reuses .chat-toast look, top-center, not part of the chat stack. -->
        <div v-if="interceptWaitText" class="chat-toast-stack" style="top: 8px; left: 50%; transform: translateX(-50%);">
          <div class="chat-toast">
            <span class="chat-toast-text">{{ interceptWaitText }}</span>
          </div>
        </div>

        <!-- floating MMO-style panel (owner 2026-07-02): Log | Chat | Roster.
             B2-8/9 (UI7): draggable by the tab bar, resizable, opacity/font
             settings via the gear; UI8: scroll freeze + new-event pill. -->
        <div ref="panelEl" class="log-panel" :data-collapsed="panelCollapsed" :class="{ 'endgame-front': endGameFront }"
          :data-swapped="settings.bottomBarsSwapped" :data-induce-open="inducePhaseOpen" :style="panelStyle"
          @mouseenter="onLogHover(true)" @mouseleave="onLogHover(false)">
          <span v-if="!panelCollapsed" class="log-resizer" role="button" aria-label="Resize Log window"
            title="Resize Log window" @pointerdown="startLogResize">⤡</span>
          <!-- Owner 2026-07-03 r6f: stencil tabs — each tab is the stencil word in
               the ALPHA-RELEASE style (white-outlined, opposition-red), Log/Chat
               keeping their 📋/💬 emoji; Roster is the word only. -->
          <nav class="tabs" @pointerdown="startPanelDrag">
            <span class="drag-grip" title="Drag to move the window" aria-hidden="true">⠿</span>
            <button class="stencil-tab" title="Log" :data-active="panelTab === 'log'"
              @click="panelTab = 'log'; panelCollapsed = false"><span class="tab-emoji">📋</span><span class="tab-stencil">LOG</span></button>
            <!-- Owner 08-19 (2nd): ROSTER before CHAT in the tab row. -->
            <button class="stencil-tab roster-tab" title="Roster" :data-active="panelTab === 'roster'" :disabled="!gameStore.game.value"
              @click="panelTab = 'roster'; panelCollapsed = false"><img class="tab-icon" :src="helmetIconUrl"
                alt="Roster" title="American football icons created by justicon — Flaticon (flaticon.com/free-icons/american-football)" /><span class="tab-stencil">ROSTER</span></button>
            <!-- Owner 08-19: while chat is POPPED OUT the tab leaves the row entirely (the old
                 click-to-redock tab is retired) — the popout's own dock (⤓) button is the sole
                 way back. -->
            <button v-if="!settings.chatDisabled && !settings.chatPoppedOut" class="stencil-tab" title="Chat"
              :data-active="panelTab === 'chat'"
              :class="{ 'has-badge': chatUnread > 0 && !settings.chatToastsEnabled }"
              @click="panelTab = 'chat'; panelCollapsed = false"><span class="tab-emoji">💬</span><span class="tab-stencil">CHAT</span><span
                v-if="chatUnread > 0 && !settings.chatToastsEnabled" class="chat-badge">{{ chatUnread > 99 ? '99+' : chatUnread }}</span></button>
            <!-- Pop-Out Chat control. Own class (not .collapse) so it keeps a fixed, never-
                 shrinking slot in the tab bar — the old build reused .collapse and the bar
                 could squeeze it. data-testid is the owner's live-verify handle. -->
            <button v-if="panelTab === 'chat' && !settings.chatDisabled && !settings.chatPoppedOut"
              class="popout-btn" data-testid="chat-popout" title="Pop chat out into a floating window"
              @click="popOutChat">⧉</button>
            <button class="collapse" title="Window settings"
              @click="panelSettingsOpen = !panelSettingsOpen">⚙</button>
            <button class="collapse" :title="panelCollapsed ? 'Expand' : 'Minimize (docks to the buttons)'"
              @click="panelCollapsed = !panelCollapsed">{{ panelCollapsed ? '▴' : '▾' }}</button>
          </nav>

          <div v-if="panelSettingsOpen && !panelCollapsed" class="panel-settings">
            <label>Opacity
              <input v-model.number="settings.logOpacity" type="range" min="0.15" max="1" step="0.05" />
            </label>
            <label>Text size
              <input v-model.number="settings.logFontSize" type="range" min="9" max="22" step="0.5" />
            </label>
            <label>Font
              <select v-model="settings.logFont">
                <option value="nuffle">Nuffle</option>
                <option value="arial">Arial</option>
                <option value="mono">Monospace</option>
              </select>
            </label>
          </div>

          <template v-if="!panelCollapsed">
            <div v-if="panelTab === 'log'" class="log-holder">
              <!-- #157: player names tinted by seat (colours = renderer.seatColors(), the pitch-token source).
                   An untinted segment renders exactly as before; ambiguous same-name-both-teams stays untinted. -->
              <pre ref="logEl" class="log" :style="logTextStyle" @scroll="onLogScroll('log', $event)"><span v-for="(entry, i) in logEntries" :key="i" :data-kind="entry.kind"><span class="log-time">{{ entry.time }}  </span><template v-for="(s, j) in logSegments(entry)" :key="j"><D6Face v-if="s.face" class="log-d6" :value="s.face" variant="black" :label="`${s.kind === 'target' ? 'Needed' : 'Rolled'} ${s.face}`" /><BlockDieFace v-else-if="s.blockFace && s.result" class="log-block-die" :value="s.blockFace" :result="s.result" /><span v-else-if="s.tk === 'title'" class="log-title">{{ s.t }}</span><span v-else-if="s.tk === 'armour'" class="log-armour" role="img" aria-label="armour"><span class="log-armour-glyph">{{ s.t }}</span><img :src="breastplateIconUrl" alt="" aria-hidden="true" /></span><span v-else-if="s.tk === 'stat-down-ni'" class="log-stat-down" role="img" aria-label="Niggling injury"><span class="log-stat-down-copy">{{ s.t }}</span><img :src="niStatDownIconUrl" alt="" aria-hidden="true" /></span><span v-else-if="s.tk === 'hidden'" class="log-hidden">{{ s.t }}</span><span v-else-if="s.tk === 'fail'" class="log-fail">{{ s.t }}</span><span v-else-if="s.side && logNameColor(s.side)" class="log-name" :class="{ 'log-name-link': !!s.pid }" :style="logNameStyle(s.side)" @click="onLogNameClick(s.pid)" @dblclick="onLogNameDblClick(s.pid)">{{ s.t }}</span><template v-else>{{ s.t }}</template></template>
</span></pre>
              <button v-if="logNewEvents" class="new-events" @click="jumpToBottom('log')">
                New events ↓
              </button>
            </div>

            <template v-else-if="panelTab === 'roster' && gameStore.game.value">
              <nav class="subtabs">
                <button :data-active="rosterSide === 'home'" :title="gameStore.game.value.teamHome.teamName" @click="rosterSide = 'home'">{{ rosterTabLabel(gameStore.game.value.teamHome.teamName) }}</button>
                <button :data-active="rosterSide === 'away'" :title="gameStore.game.value.teamAway.teamName" @click="rosterSide = 'away'">{{ rosterTabLabel(gameStore.game.value.teamAway.teamName) }}</button>
              </nav>
              <div class="roster">
                <ul>
                  <li v-for="p in (rosterSide === 'home' ? gameStore.game.value.teamHome : gameStore.game.value.teamAway).playerArray"
                    :key="p.playerId" class="roster-row" @click="onRosterRowClick(p.playerId)">
                    <span class="nr">{{ p.playerNr }}</span>
                    <span class="pname">{{ p.playerName }}</span>
                    <span class="acquired">{{ acquiredSkills(p, rosterSide === 'home' ? gameStore.game.value.teamHome : gameStore.game.value.teamAway) }}</span>
                    <span class="pos">{{ positionLabel(p, rosterSide === 'home' ? gameStore.game.value.teamHome : gameStore.game.value.teamAway) }}</span>
                    <span class="loc" :data-status="playerState(p)">{{ playerState(p) }}</span>
                  </li>
                </ul>
              </div>
            </template>
          </template>

          <!-- Pop-Out Chat (owner ruling 2026-08-17; rebuilt 08-18 after the c692e68f revert).
               ONE copy of the chat nodes, hosted by ChatDock. Deliberately placed OUTSIDE the
               `v-if="!panelCollapsed"` block above so minimizing the docked window (or switching
               tabs) can never unmount a POPPED-OUT chat. Docked visibility is v-show only.
               ChatDock teleports to `body`, so there is no app-owned teleport target to be
               missing and no viewport-sized overlay anywhere — the two revert causes. -->
          <ChatDock v-if="!settings.chatDisabled"
            :popped="settings.chatPoppedOut"
            :visible="panelTab === 'chat' && !panelCollapsed"
            :pos="settings.chatPopPos" :size="settings.chatPopSize" :opacity="settings.logOpacity"
            @update:pos="settings.chatPopPos = $event" @update:size="settings.chatPopSize = $event"
            @dock="dockChat">
            <div class="log-holder">
              <!-- Owner 08-19: chat — muted HH:MM stamp, coach NAME seat-coloured (logNameColor),
                   spectator LINES pale green, names in Nuffle over sans-serif message text. -->
              <pre ref="chatEl" class="log chat-log" :style="logTextStyle" @scroll="onLogScroll('chat', $event)"><span v-for="(entry, i) in chatEntries" :key="i" data-kind="talk" :data-side="entry.side ?? 'unknown'" :style="entry.side === 'spectator' ? { color: '#9fd49f' } : undefined"><span class="log-time">{{ entry.time }}  </span><template v-if="chatParts(entry).name && (entry.side === 'home' || entry.side === 'away') && logNameColor(entry.side)"><span class="log-name" :style="logNameStyle(entry.side)">{{ chatParts(entry).name }}</span>{{ ': ' + chatParts(entry).rest }}</template><template v-else-if="chatParts(entry).name"><span class="log-name">{{ chatParts(entry).name }}</span>{{ ': ' + chatParts(entry).rest }}</template><template v-else>{{ entry.text }}</template>
</span></pre>
              <button v-if="chatNewEvents" class="new-events" @click="jumpToBottom('chat')">
                New messages ↓
              </button>
            </div>
            <form class="chat" @submit.prevent="sendChat">
              <input ref="chatInputEl" v-model="chatInput" placeholder="Chat… (Enter) · /help for dev commands" :disabled="gameStore.state.sessionState !== 'joined'" />
            </form>
          </ChatDock>
        </div>
        <ConfirmActionButton v-if="queuedSteps > 0 && !settings.spectatorClean" class="confirm-move"
          :disabled="!gameStore.state.demoMode && !gameStore.isPlaying.value"
          :label="`Confirm ${plannedAction ?? 'move'} · ${queuedSteps} ${queuedSteps === 1 ? 'square' : 'squares'}`"
          :shortcut-code="settings.confirmKey"
          :title="gameStore.isPlaying.value ? 'Send the move to the server' : gameStore.state.demoMode ? 'Execute the queued move' : 'Execution arrives with play mode (M4)'"
          @activate="confirmMove()" />
        <!-- Owner 2026-07-13 (#7): the bottom Confirm-Blitz / Confirm-Block bar — mirrors the move-confirm bar
             (same Space binding shown), shown while the Blitz/Block stage is armed. Clickable too. -->
        <ConfirmActionButton v-if="aggroConfirmLabel && !settings.spectatorClean && gameStore.isPlaying.value"
          class="confirm-move confirm-aggro" tone="aggressive" :label="aggroConfirmLabel"
          :shortcut-code="settings.confirmKey" @activate="confirmAggroStage()" />
        <!-- #48 (owner, confirm-bar parity): the same bar for a nominated o66 MOVE route / FOUL (mirrors the
             blitz/block bar; Space also confirms via o66ConfirmPending). Pass/hand-off stay single-click (EX-1). -->
        <ConfirmActionButton v-if="o66PendingConfirmLabel && !settings.spectatorClean && gameStore.isPlaying.value"
          class="confirm-move confirm-aggro" tone="aggressive" :label="o66PendingConfirmLabel"
          :shortcut-code="settings.confirmKey" @activate="o66ConfirmPending()" />

        <!-- Server-derived single/multiple Apothecary election. -->
        <ApothecaryPrompt v-if="gameStore.state.apothecaryChoice" :key="gameStore.state.apothecaryChoice.seq"
          :prompt="gameStore.state.apothecaryChoice" :icon-url="apothecaryIconUrl"
          :portrait="apoChoicePortrait" :skills="apoChoiceSkills"
          :skill-mode="skillMode" :skill-icon-style="effectiveIconStyle"
          :position-id="apoChoicePositionId" :player-side="apoChoiceSide"
          :position-style="reactivePromptStyle('apothecaryChoice', apoChoicePos.ready ? { x: apoChoicePos.x, y: apoChoicePos.y, leftEdge: apoChoicePos.leftEdge } : undefined)"
          @drag-start="startReactivePromptDrag('apothecaryChoice', $event)"
          @resolve="(injuryIndex, apothecaryType) => gameStore.resolveApothecary(gameStore.state.apothecaryChoice!.key, injuryIndex, apothecaryType)" />

        <!-- Apothecary re-roll CHOICE (owner 2026-07-03 r6f; redesign owner 08-18): the d16
             disc is SUPPRESSED — the card is the red-cross identity plus the two result
             TITLES (Original vs Re-Rolled), console token/bevel/raised-caps treatment. -->
        <ApothecaryResultChoice v-if="gameStore.state.apothecaryD16" :key="'d16-' + gameStore.state.apothecaryD16.seq"
          :choice="gameStore.state.apothecaryD16" :icon-url="apothecaryIconUrl"
          :position-style="reactivePromptStyle('apothecaryD16')"
          @drag-start="startReactivePromptDrag('apothecaryD16', $event)"
          @choose="gameStore.resolveApothecaryChoice($event)" />

        <!-- Upstream auto-keeps a re-rolled Badly Hurt result and moves the player to
             Reserves without opening a choice dialog. This is local information only. -->
        <ApothecaryAutoReturn v-if="gameStore.state.apothecaryAutoReturn"
          :key="'apo-auto-' + gameStore.state.apothecaryAutoReturn.seq"
          :result="gameStore.state.apothecaryAutoReturn" :icon-url="apothecaryIconUrl"
          :portrait="apoResultPortrait"
          :position-style="reactivePromptStyle('apothecaryAutoReturn')"
          @drag-start="startReactivePromptDrag('apothecaryAutoReturn', $event)" />

        <!-- B6-5: coin-flip cinematic — coin spins up and is caught.
             Lift (translateY arc) and flip (rotateX) are separate nested
             elements so their transforms compose. -->
        <div v-if="gameStore.state.coinToss" class="coin-toss" :class="{ 'cine-hold': settings.clickDismissCinematics }">
          <!-- B9-13: the coach's CALLED side shown before the flip resolves -->
          <div class="coin-call">
            {{ gameStore.state.coinToss.coach }} calls
            <span class="coin-call-side">
              <img v-if="gameStore.state.coinToss.called === 'heads'" :src="coinSkullUrl" class="coin-call-skull" alt="" />
              {{ gameStore.state.coinToss.called.toUpperCase() }}
            </span>
          </div>
          <div class="coin-lift">
            <div class="coin" :data-result="gameStore.state.coinToss.result">
              <div class="coin-face heads"><img :src="coinSkullUrl" class="coin-skull" alt="heads" /></div>
              <div class="coin-face tails">T</div>
            </div>
          </div>
          <div class="coin-caption">
            {{ gameStore.state.coinToss.result.toUpperCase() }} —
            {{ gameStore.state.coinToss.coach }} {{ gameStore.state.coinToss.won ? 'wins the toss' : 'loses the toss' }}
          </div>
        </div>

        <!-- BB2025 extra-time PENALTY SHOOTOUT summary. The server auto-rolled the whole best-of-5
             roll-off (client makes ZERO inputs) — this is display-only: the per-round breakdown + a
             single Confirm that dismisses (mutual — server waits for both coaches). home* is THIS
             coach's team (per-recipient mirror). Copy = "Penalty Shootout" (owner 2026-07-13). -->
        <div v-if="gameStore.state.penaltyShootout" class="penalty-shootout">
          <div class="ps-title">Penalty Shootout</div>
          <div class="ps-score">
            <span class="ps-team" :class="{ 'ps-win': gameStore.state.penaltyShootout.homeWins }">{{ gameStore.state.penaltyShootout.homeName }}</span>
            <span class="ps-tally">{{ gameStore.state.penaltyShootout.scoreHome }}&nbsp;–&nbsp;{{ gameStore.state.penaltyShootout.scoreAway }}</span>
            <span class="ps-team" :class="{ 'ps-win': !gameStore.state.penaltyShootout.homeWins }">{{ gameStore.state.penaltyShootout.awayName }}</span>
          </div>
          <ol class="ps-rounds">
            <li v-for="(r, i) in gameStore.state.penaltyShootout.rounds" :key="i" class="ps-round">
              <span class="ps-round-label">{{ r.label }}</span>
              <D6Face class="ps-roll" :class="{ 'ps-roll-win': r.homeWon }" :value="r.home" :label="`${gameStore.state.penaltyShootout.homeName} rolled ${r.home}`" />
              <span class="ps-vs">vs</span>
              <D6Face class="ps-roll" :class="{ 'ps-roll-win': !r.homeWon }" :value="r.away" :label="`${gameStore.state.penaltyShootout.awayName} rolled ${r.away}`" />
              <span class="ps-round-win">{{ r.homeWon ? gameStore.state.penaltyShootout.homeName : gameStore.state.penaltyShootout.awayName }}</span>
            </li>
          </ol>
          <div class="ps-result">
            {{ gameStore.state.penaltyShootout.homeWins ? gameStore.state.penaltyShootout.homeName : gameStore.state.penaltyShootout.awayName }} wins the shootout
          </div>
          <button class="ps-confirm" @click="gameStore.confirmPenaltyShootout()">{{ gameStore.isPlaying.value ? 'Proceed to MVPs and upload' : 'Close' }}</button>
        </div>

        <!-- Owner 2026-07-08: full-screen shader while inducements are chosen/revealed. -->
        <div v-if="inducePhaseOpen" class="induce-shader" />

        <!-- Owner 08-18: the inducements PHASE screen (design handoff) replaces the
             old split picker/reveal panels. Mounted off phase state so BOTH seats
             see it for the whole phase; only the active coach gets controls. -->
        <InducementsPhase v-if="inducePhaseOpen" class="induce-phase"
          :phase="induceDisplayPhase"
          :overdog="induceDisplayOverdogPanel"
          :underdog="induceDisplayUnderdogPanel"
          :my-side="presetInducementsOpen ? presetMySide : (induceRevealHoldSnapshot?.myRole ?? (props.mode === 'play' ? induceMyRole : null))"
          :viewer-mode="props.mode" :can-act="presetInducementsOpen || induceRevealHoldSnapshot ? false : induceCanAct"
          :picks="inducePicks" :options="induceOptions" :cap="gameStore.state.inducementBuy?.availableGold ?? 0"
          :blade="induceBlade" :cards="induceCards" :selector-limits="induceLimits"
          :confirm-pending="induceConfirmPending" :preset-mode="presetInducementsOpen"
          @blade="induceBlade = $event" @add="inducePhaseAdd" @remove="inducePhaseRemove"
          @clear="inducePhaseClear" @confirm="inducePhaseConfirm" @acknowledge="acknowledgePresetInducements" />


        <!-- B9-12 G7: full post-game panel. Owner 2026-07-06: SPLIT into two stacked
             windows — the RESULT on top (always shown), Stats/MVP in a separate
             tabbed window below. -->
        <!-- Owner 2026-07-08 (queue 1): endGame is EVENT-PACED — the panel waits for
             gameStore.state.endGameSettled (all pending rolls/animations rendered).
             The demo reaches endGame outside applyFrame, so it stays instant. -->
        <!-- Defer postgame results while playerPick is armed so MVP nomination remains usable. -->
        <!-- Owner 2026-07-15: for the PLAYING coach the unified MVP screen owns the MVP phase; this legacy
             postgame panel defers to it (!mvpScreenActive) and shows once the coach hits Continue. Spectators
             (mvpScreenActive false) see it as before, with its own mvpRoll reveal. -->
        <!-- Owner 08-19: pgSurface also raises this surface EARLY for the spectate seat (MVP-pending) —
             result card up top, "Players are selecting MVP" where Statistics & MVP will land, and the
             persistent Return to Menu / Spectate Another Game pair below. -->
        <div v-if="pgSurface" class="postgame">
          <!-- Window 1: RESULT (always shown, on top) -->
          <div class="pg-window pg-window-result">
            <header class="pg-head">
              <span class="pg-title">End of Game</span>
              <!-- Owner 2026-07-15: no manual close — the end-game panel persists over the cleared board until a
                   NEW game starts (gameOver→false resets postGameDismissed + postGame becomes null). -->
            </header>
            <section class="pg-result">
              <div class="pg-team" :class="{ winner: pgSurface.winner === pgSurface.home }">
                <img v-if="pgSurface.home.logo" :src="pgSurface.home.logo" alt="" />
                <div class="pg-team-name">{{ pgSurface.home.team }}</div>
                <div class="pg-team-coach">{{ pgSurface.home.coach }}</div>
              </div>
              <div class="pg-scoreline">
                <div class="pg-score">{{ pgSurface.home.score }}<span>–</span>{{ pgSurface.away.score }}</div>
                <div class="pg-verdict">
                  {{ pgSurface.draw ? 'Draw' : `${pgSurface.winner?.team} wins!` }}
                </div>
              </div>
              <div class="pg-team" :class="{ winner: pgSurface.winner === pgSurface.away }">
                <img v-if="pgSurface.away.logo" :src="pgSurface.away.logo" alt="" />
                <div class="pg-team-name">{{ pgSurface.away.team }}</div>
                <div class="pg-team-coach">{{ pgSurface.away.coach }}</div>
              </div>
            </section>
            <!-- #169 (owner, last v0.3.9 payload): end-of-match RESULT rows on the persistent end-screen — gold
                 winnings + the BB2025 dedicated-fans roll per team. state.endGameStats MERGES winnings + dedFans
                 across separate end reports (Tarkin 131c82a9) and persists here until game-change (like
                 state.defectors). dedFans is NULL on a DRAW (empty dedicated-fans report) → a "fans unchanged" note. -->
            <section v-if="gameStore.state.endGameStats" class="pg-endstats">
              <div class="pg-endstat-row">
                <span class="pg-endstat-team">{{ pgSurface.home.team }}</span>
                <span v-if="gameStore.state.endGameStats.winningsHome != null" class="pg-endstat-gold">{{ gameStore.state.endGameStats.winningsHome.toLocaleString() }}g winnings</span>
                <span v-if="gameStore.state.endGameStats.dedFans" class="pg-endstat-fans">Dedicated fans: rolled <D6Face v-if="gameStore.state.endGameStats.dedFans.concededTeamId !== gameStore.game.value?.teamHome.teamId" class="pg-endstat-d6" :value="gameStore.state.endGameStats.dedFans.rollHome" :label="`Rolled ${gameStore.state.endGameStats.dedFans.rollHome}`" /><span v-else>{{ gameStore.state.endGameStats.dedFans.rollHome }}</span> → {{ gameStore.state.endGameStats.dedFans.modHome > 0 ? '+' + gameStore.state.endGameStats.dedFans.modHome : gameStore.state.endGameStats.dedFans.modHome }}</span>
                <span v-else class="pg-endstat-fans muted">Dedicated fans unchanged</span>
              </div>
              <div class="pg-endstat-row">
                <span class="pg-endstat-team">{{ pgSurface.away.team }}</span>
                <span v-if="gameStore.state.endGameStats.winningsAway != null" class="pg-endstat-gold">{{ gameStore.state.endGameStats.winningsAway.toLocaleString() }}g winnings</span>
                <span v-if="gameStore.state.endGameStats.dedFans" class="pg-endstat-fans">Dedicated fans: rolled <D6Face v-if="gameStore.state.endGameStats.dedFans.concededTeamId !== gameStore.game.value?.teamAway.teamId" class="pg-endstat-d6" :value="gameStore.state.endGameStats.dedFans.rollAway" :label="`Rolled ${gameStore.state.endGameStats.dedFans.rollAway}`" /><span v-else>{{ gameStore.state.endGameStats.dedFans.rollAway }}</span> → {{ gameStore.state.endGameStats.dedFans.modAway > 0 ? '+' + gameStore.state.endGameStats.dedFans.modAway : gameStore.state.endGameStats.dedFans.modAway }}</span>
                <span v-else class="pg-endstat-fans muted">Dedicated fans unchanged</span>
              </div>
            </section>
            <!-- #140 (owner concede consequence): the DEFECTORS reveal on the PERSISTENT end-screen (Meero SR-67 DF-1
                 relocate — ReportDefectingPlayers fires at game-END, after the concede notice can be dismissed, so the
                 end-screen is the correct surface; state.defectors survives here until game-change). Only when someone
                 actually defected. Names WHICH players walked (the concede notice named WHO conceded). -->
            <div v-if="gameStore.state.defectors && gameStore.state.defectors.names.length" class="pg-defectors">
              <b>{{ gameStore.state.defectors.names.length }}</b> player{{ gameStore.state.defectors.names.length === 1 ? '' : 's' }} defected after the concession:
              <span class="pg-defector-names">{{ gameStore.state.defectors.names.join(', ') }}</span>
            </div>
            <!-- Owner 08-19: #234's Play Game / Spectate Game pair DEPRECATED (it re-opened the legacy
                 in-game browser overlay OVER the end screen). Non-spectate seats get the confirm-free
                 Return to Menu here; the spectate seat's pair lives in the persistent exit bar below. -->
            <div v-if="mode !== 'spectate'" class="pg-actions">
              <button type="button" class="pg-action" @click="onEndGameExit('menu')">Return to Menu</button>
            </div>
          </div>

          <!-- Window 2: STATS / MVP (tabbed, below) — only once the server's data has landed + settled. -->
          <div v-if="finalPostGameVisible" class="pg-window pg-window-stats">
            <header class="pg-head">
              <span class="pg-title pg-title-sub">Statistics &amp; MVP</span>
              <nav class="pg-tabs">
                <button :data-active="postGamePhase === 'mvp'" @click="postGamePhase = 'mvp'">MVP</button>
                <button :data-active="postGamePhase === 'stats'" @click="postGamePhase = 'stats'">Statistics</button>
                <button :data-active="postGamePhase === 'roster'" @click="postGamePhase = 'roster'">Roster</button>
              </nav>
            </header>

            <!-- Phase: MVP (server-decided award, see postGameSide's `mvps`) -->
            <section v-if="postGamePhase === 'mvp'" class="pg-mvp">
              <div v-for="side in [pgSurface.home, pgSurface.away]" :key="side.team" class="pg-mvp-team">
                <div class="pg-mvp-head">
                  <img v-if="side.logo" :src="side.logo" alt="" />
                  <span>{{ side.team }}</span>
                </div>
                <!-- #25-v2 (owner 2026-07-14): active reveal. ⚖ the roulette lands on
                     side.mvps (the SERVER award), never a local pick; §3a fail-open. -->
                <div v-if="mvpRoll[side.which].phase === 'cycling'" class="pg-mvp-roulette" aria-live="polite">
                  <span class="pg-star">★</span>
                  <span class="pg-mvp-name pg-mvp-spin">{{ mvpRoll[side.which].display }}</span>
                </div>
                <ul v-else-if="side.mvps.length">
                  <li v-for="m in side.mvps" :key="m.playerId">
                    <span class="pg-star">★</span>
                    <span class="pg-mvp-name">{{ m.name }}</span>
                    <span class="pg-mvp-pos">{{ m.position }}</span>
                    <span v-if="m.awards > 1" class="pg-mvp-x">×{{ m.awards }}</span>
                  </li>
                </ul>
                <p v-else-if="mvpRoll[side.which].phase === 'none'" class="pg-mvp-none">No MVP awarded</p>
                <p v-else class="pg-mvp-none pg-mvp-awaiting">Awaiting result</p>
              </div>
            </section>

            <!-- Phase 3: statistics -->
            <section v-else-if="postGamePhase === 'stats'" class="pg-stats">
              <table>
                <thead>
                  <!-- #235 (owner-fg 07-29): keep the empty header aligned with the centered stat-label column. -->
                  <tr><th class="pg-h">{{ pgSurface.home.team }}</th><th class="pg-stat-label"></th><th class="pg-a">{{ pgSurface.away.team }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="s in POSTGAME_STATS" :key="s.key">
                    <td class="pg-h" :data-lead="(pgSurface.home.totals[s.key] ?? 0) > (pgSurface.away.totals[s.key] ?? 0)">
                      {{ pgSurface.home.totals[s.key] ?? 0 }}
                    </td>
                    <td class="pg-stat-label">{{ s.label }}</td>
                    <td class="pg-a" :data-lead="(pgSurface.away.totals[s.key] ?? 0) > (pgSurface.home.totals[s.key] ?? 0)">
                      {{ pgSurface.away.totals[s.key] ?? 0 }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            <!-- #25-v2 (owner 2026-07-14): per-player roster/SPP summary — name · position · SPP-gained this game -->
            <section v-else class="pg-roster">
              <!-- #235 (owner-fg 07-29): both team names remain visible as the one-roster-at-a-time selector. -->
              <div class="pg-roster-team-toggle" role="group" aria-label="Select roster team">
                <button
                  v-for="w in (['home', 'away'] as const)"
                  :key="w"
                  type="button"
                  :data-active="selectedRosterTeam === w"
                  @click="selectedRosterTeam = w"
                >
                  <img v-if="pgSurface[w].logo" :src="pgSurface[w].logo" alt="" />
                  <span>{{ pgSurface[w].team }}</span>
                </button>
              </div>
              <div class="pg-roster-team">
                <ul v-if="pgSurface[selectedRosterTeam].roster.length" class="pg-roster-list">
                  <li v-for="pl in pgSurface[selectedRosterTeam].roster" :key="pl.name">
                    <span class="pg-roster-name">{{ pl.name }}</span>
                    <span class="pg-roster-pos">{{ pl.position }}</span>
                    <span class="pg-roster-spp" :data-zero="pl.spp === 0">{{ pl.spp }} SPP</span>
                  </li>
                </ul>
                <p v-else class="pg-mvp-none">No player records</p>
              </div>
            </section>
          </div>

          <!-- Owner 08-19: spectate-seat MVP-PENDING placeholder — sits exactly where the
               Statistics & MVP window will land; swaps for it when the server's data arrives
               (finalPresentationReady + settle beat — model-keyed, no timers). -->
          <div v-else class="pg-window pg-mvp-pending" role="status" aria-live="polite">
            <span class="pg-mvp-pending-dot" aria-hidden="true"></span>
            <span>Players are selecting MVP</span>
          </div>

          <!-- Owner 08-19: the spectate seat's exit pair — appears with the MVP stage and
               REMAINS once the final panel lands. Routes via the blade shell (never the
               deprecated legacy browser overlay). -->
          <div v-if="spectatorExitVisible" class="pg-window pg-exit">
            <button type="button" class="pg-action" @click="onEndGameExit('menu')">Return to Menu</button>
            <button type="button" class="pg-action pg-action-primary" @click="onEndGameExit('browser')">Spectate Another Game</button>
          </div>
        </div>

        <!-- Owner 2026-07-06: DODGY SNACK — each coach's d6 thrown from a side
             (home north / away south); the lower-rolling team's
             random player is affected. Plays AFTER the kick-off event splash. -->
        <div v-if="gameStore.state.weatherCine" class="weather-cine" :class="{ 'cine-hold': settings.clickDismissCinematics }">
          <div class="wc-title">Weather Roll</div>
          <div class="wc-dice">
            <D6Face class="wc-die from-north" :value="gameStore.state.weatherCine.roll[0] ?? 0" :label="`Weather die ${gameStore.state.weatherCine.roll[0] ?? 0}`" />
            <D6Face class="wc-die from-south" :value="gameStore.state.weatherCine.roll[1] ?? 0" :label="`Weather die ${gameStore.state.weatherCine.roll[1] ?? 0}`" />
          </div>
          <div class="wc-caption">
            <span class="wc-icon">{{ weatherEmoji(gameStore.state.weatherCine.weather) }}</span>
            <span class="wc-weather">{{ gameStore.state.weatherCine.weather }}</span>
          </div>
        </div>

        <div v-if="gameStore.state.dodgySnackCine" class="dice-cine" :class="{ 'cine-hold': settings.clickDismissCinematics }">
          <div class="dice-title">Dodgy Snack</div>
          <div class="wc-dice">
            <D6Face class="wc-die from-north" :value="gameStore.state.dodgySnackCine.rollHome" :label="`Home Dodgy Snack roll ${gameStore.state.dodgySnackCine.rollHome}`" />
            <D6Face class="wc-die from-south" :value="gameStore.state.dodgySnackCine.rollAway" :label="`Away Dodgy Snack roll ${gameStore.state.dodgySnackCine.rollAway}`" />
          </div>
          <div class="wc-caption"><span class="dice-icon">🤢</span><span class="dice-label">Dodgy Snack</span></div>
        </div>

        <div v-if="gameStore.state.dodgySnackAnnouncement" class="masterchef-splash">
          <span class="masterchef-icon">🤢</span>
          <span class="masterchef-head">
            Dodgy Snack affects {{ gameStore.state.dodgySnackAnnouncement.players.join(', ') }}
          </span>
        </div>

        <!-- Owner 2026-07-06: a player whose Dodgy Snack effect roll was a 1 is sent
             to reserves and can't play this drive. -->
        <div v-if="gameStore.state.dodgySnackSplash" class="dodgy-snack-splash">
          <span class="dss-emoji">🤮</span>
          <span class="dss-text"><b>{{ gameStore.state.dodgySnackSplash.player }}</b> ate some of BB_Nut's cooking and can't play this drive.</span>
        </div>

        <!-- Kick-off EVENT splash — FUMBBL's kick-off_<event>.png banner + the
             2d6 result. Weather Change carries no banner and is followed by the
             weather dice cinematic (see the store's detectPregameCinematics). -->
        <div v-if="gameStore.state.kickoffCine" class="kickoff-cine" :class="{ 'cine-hold': settings.clickDismissCinematics }">
          <!-- Dice sit ABOVE the splash (between the turn timer and the banner),
               rendered over the top of it. -->
          <div class="ko-dice">
            <D6Face class="ko-die" :value="gameStore.state.kickoffCine.roll[0] ?? 0" :label="`Kick-off die ${gameStore.state.kickoffCine.roll[0] ?? 0}`" />
            <D6Face class="ko-die" :value="gameStore.state.kickoffCine.roll[1] ?? 0" :label="`Kick-off die ${gameStore.state.kickoffCine.roll[1] ?? 0}`" />
          </div>
          <img v-if="gameStore.state.kickoffCine.img" :src="gameStore.state.kickoffCine.img" class="ko-splash" alt="" />
          <!-- Event name only when there is NO FUMBBL banner (it would otherwise
               duplicate the banner text). Rendered large for Weather Change. -->
          <div v-else class="ko-name-big">{{ gameStore.state.kickoffCine.result }}</div>
        </div>

        <!-- Owner 2026-07-08: click-to-SKIP the pregame splashes (coin/weather/fans/kickoff)
             — a transparent catcher forces the next cine on click. Always available (no longer
             gated behind the clickDismiss setting); a "Click to Skip" hint sits at the bottom. -->
        <div v-if="gameStore.cineShowing.value" class="cine-dismiss"
          @click="gameStore.dismissCine()">
          <span class="cine-dismiss-hint">Click to Skip</span>
        </div>

        <!-- Owner: skill-use choice — <skillICON><D6 pips><N+> when a roll is
             needed, else icon + skill name; Nuffle-font YES/NO for the acting
             coach; a 20%-opacity player silhouette behind. Spectators see the
             same tooltip (no buttons) until the coach resolves it. -->
        <!-- #237 (owner-fg 07-29): body drag; answer controls are excluded in the shared pointer guard. -->
        <div v-if="gameStore.state.skillChoice?.mine" class="skill-choice"
          :style="reactivePromptStyle('skillChoice', skillChoicePos.ready ? { x: skillChoicePos.x, y: skillChoicePos.y } : undefined)"
          title="Drag to move" @pointerdown="startReactivePromptDrag('skillChoice', $event)">
          <img v-if="skillSilhouette" class="sc-silhouette" :src="skillSilhouette" alt="" />
          <div class="sc-title">{{ hmpScatterSkillCardCopy?.title ?? passSkillCardCopy?.title ?? (swoopCardCopy?.title ?? (isJuggernautCard ? 'Use juggernaut to push the player?' : `Use ${gameStore.state.skillChoice.label}?`)) }}</div>
          <div v-if="gameStore.state.skillChoice.injuryResult" class="sc-subtext">Current injury: {{ gameStore.state.skillChoice.injuryResult }}</div>
          <div v-if="swoopCardCopy" class="sc-subtext">{{ swoopCardCopy.body }}</div>
          <!-- #225(b) (owner-fg 07-29): Crushing Blow — show the ACTUAL rolled armour dice (🛡 + the [d6,d6]) ABOVE
               the CB body so the coach reads the roll vs AV before deciding the +1. Guarded ⇒ absent for any other
               skill / when no armour roll is live (generic body renders as before). -->
          <div v-if="skillChoiceArmorDice" class="sc-cb-armour">
            <span class="sc-cb-emoji" aria-hidden="true">🛡️</span>
            <D6Face v-for="(d, di) in skillChoiceArmorDice" :key="di" class="sc-die sc-cb-die" :value="d" :label="`Armour die ${d}`" />
          </div>
          <div v-if="passSkillCardCopy" class="sc-pass-result">
            <div>{{ passSkillCardCopy.rollLine }}</div>
            <div>{{ passSkillCardCopy.needLine }}</div>
          </div>
          <div v-else-if="hmpScatterSkillCardCopy" class="sc-subtext">{{ hmpScatterSkillCardCopy.contextLine }}</div>
          <div v-else class="sc-body">
            <img v-if="playerOwnedSkillIconUrl(gameStore.state.skillChoice.skill, effectiveIconStyle, playerSideById(gameStore.state.skillChoice.playerId))" class="sc-icon"
              :src="playerOwnedSkillIconUrl(gameStore.state.skillChoice.skill, effectiveIconStyle, playerSideById(gameStore.state.skillChoice.playerId))" :alt="gameStore.state.skillChoice.skill" />
            <!-- Owner 2026-07-08: no art for this skill (e.g. Taunt) → fill the icon slot with the
                 same glyph placeholder the pitch markings use (markerGlyph → 'T'), not a blank. -->
            <span v-else class="sc-glyph" aria-hidden="true">{{ markerGlyph(gameStore.state.skillChoice.skill) }}</span>
            <template v-if="gameStore.state.skillChoice.minimumRoll > 0">
              <D6Face class="sc-die" :value="gameStore.state.skillChoice.minimumRoll" :label="`Needed ${gameStore.state.skillChoice.minimumRoll}`" />
              <span class="sc-needed">+</span>
            </template>
            <span v-else class="sc-name">{{ gameStore.state.skillChoice.label }}</span>
          </div>
          <div class="sc-actions">
            <!-- Owner 08-18 (Swoop copy): "Swoop" / "Scatter Normally" (was Glide / Land now); wire answers byte-identical. -->
            <button class="sc-yes" @click="gameStore.resolveSkillUse(true)">{{ swoopCardCopy?.accept ?? 'Yes' }}</button>
            <button class="sc-no" @click="gameStore.resolveSkillUse(false)">{{ swoopCardCopy?.decline ?? 'No' }}</button>
          </div>
        </div>
        <div v-else-if="gameStore.state.skillChoice && skillChoicePos.ready"
          class="followup-chip passive head-mounted reactive-decision-pill"
          :style="reactivePromptStyle('skillChoice', { x: skillChoicePos.x, y: skillChoicePos.y + 54 })"
          role="status" aria-live="polite">
          <div class="fu-title">{{ passiveSkillDecisionText }}</div>
        </div>

        <PitchConfirmationPanel v-if="wideRailActivationPrompt" title="Special Ability"
          label="Activation special confirmation">
          <div>Use a special before continuing {{ wideRailActivationPrompt.playerAction }}?</div>
          <template #actions>
            <div class="rr-options">
              <button v-for="option in wideRailActivationPrompt.options" :key="option.ruleId" class="rr-use"
                @click="acceptWideRailActivationRule(option.ruleId)">{{ option.label }}</button>
              <button class="rr-decline" @click="declineWideRailActivationRules()">Continue without a special</button>
            </div>
          </template>
        </PitchConfirmationPanel>

        <PitchConfirmationPanel v-if="furiousOutburstInstruction" title="Furious Outburst"
          label="Furious Outburst square selection" compact>
          {{ furiousOutburstInstruction }}
        </PitchConfirmationPanel>

        <!-- B8-3: fan-factor cinematic — a d3 per side, then the difference
             splash "<coach> has +N fan factor over <coach>". -->
        <div v-if="gameStore.state.fanFactorCine" class="fan-cine" :class="{ 'cine-hold': settings.clickDismissCinematics }">
          <div class="fan-rolls">
            <div class="fan-side home" :data-leader="gameStore.state.fanFactorCine.leader === 'home'">
              <div class="fan-coach">{{ gameStore.state.fanFactorCine.homeCoach }}</div>
              <div class="wc-die d3">
                <span v-for="(on, i) in pipPattern(gameStore.state.fanFactorCine.home.roll)" :key="i"
                  class="pip" :data-on="on"></span>
              </div>
              <div class="fan-math">{{ gameStore.state.fanFactorCine.home.fans }} fans + {{ gameStore.state.fanFactorCine.home.roll }}
                = <b>{{ gameStore.state.fanFactorCine.home.total }}</b></div>
            </div>
            <div class="fan-side away" :data-leader="gameStore.state.fanFactorCine.leader === 'away'">
              <div class="fan-coach">{{ gameStore.state.fanFactorCine.awayCoach }}</div>
              <div class="wc-die d3">
                <span v-for="(on, i) in pipPattern(gameStore.state.fanFactorCine.away.roll)" :key="i"
                  class="pip" :data-on="on"></span>
              </div>
              <div class="fan-math">{{ gameStore.state.fanFactorCine.away.fans }} fans + {{ gameStore.state.fanFactorCine.away.roll }}
                = <b>{{ gameStore.state.fanFactorCine.away.total }}</b></div>
            </div>
          </div>
          <div class="fan-splash">
            <template v-if="gameStore.state.fanFactorCine.leader === 'tie'">
              Fan factor is even ({{ gameStore.state.fanFactorCine.home.total }} each)
            </template>
            <template v-else>
              {{ gameStore.state.fanFactorCine.leader === 'home' ? gameStore.state.fanFactorCine.homeCoach : gameStore.state.fanFactorCine.awayCoach }}
              has <b>+{{ gameStore.state.fanFactorCine.diff }}</b> fan factor over
              {{ gameStore.state.fanFactorCine.leader === 'home' ? gameStore.state.fanFactorCine.awayCoach : gameStore.state.fanFactorCine.homeCoach }}
            </template>
          </div>
        </div>

        <!-- Owner 2026-07-04: INTERACTIVE team-setup panel — reserve box, the live
             legality conditions (green/red), and Done / Concede. (Auto-fill deprecated
             08-13 per owner — templates + Saved Setups are the fill path; the
             setupAutoFill store machinery is retained for template apply's reuse.) -->
        <PitchConfirmationPanel v-if="opponentSetupNotice" class="opponent-setup-notice"
          title="Opponent is setting up" label="Opponent is setting up" compact
          :position-style="{ top: '18%', right: 'max(18px, env(safe-area-inset-right))', left: 'auto', transform: 'none', width: 'min(280px, calc(100% - 36px))', minWidth: '0', maxWidth: 'none' }">
          Waiting for their formation…
        </PitchConfirmationPanel>

        <!-- Owner 2026-07-14 (setup overhaul #1): the big left SETUP WINDOW is deprecated — the reserve CHIPS
             are gone (reserves are now dragged straight from the dugout "reserves box" on the right, cond-b),
             and this is now a COMPACT rules+actions card pinned to the RIGHT, over the dugout. -->
        <!-- SPEC setup-templates §1 (Madden panel), §3-3o (the 15 templates), MIRROR OPTION §3c. -->
        <section v-if="setupPhase && setupTemplateSide" ref="setupTemplatePanelEl"
          class="setup-template-panel" aria-label="Setup formations" :style="setupBrowserStyle"
          @pointerdown="startSetupBrowserResize">
          <div class="setup-template-title setup-template-windowbar" @pointerdown="startSetupBrowserDrag">
            <span class="setup-template-grip" aria-hidden="true">⠿</span>
            <div class="setup-template-tabs">
              <button class="setup-template-tab" :class="{ active: setupPanelSection === 'templates' }"
                @click="setupPanelSection = 'templates'">TEMPLATES</button>
              <button class="setup-template-tab" :class="{ active: setupPanelSection === 'saved' }"
                @click="showSavedSetups">SAVED SETUPS</button>
            </div>
            <button v-if="setupPanelSection === 'saved'" class="setup-collapse-button" type="button"
              :aria-expanded="!savedSetupsCollapsed" @pointerdown.stop
              @click.stop="savedSetupsCollapsed = !savedSetupsCollapsed">
              {{ savedSetupsCollapsed ? 'Expand' : 'Collapse' }}
            </button>
          </div>
          <div v-if="setupPanelSection === 'templates'" class="setup-template-list">
            <div v-for="card in setupTemplateCards" :key="card.template.id" class="setup-template-card"
              :class="{ active: lastAppliedSetupTemplateId === card.template.id }" role="button" tabindex="0"
              :aria-pressed="lastAppliedSetupTemplateId === card.template.id"
              @click="applySetupTemplateCard(card.template)"
              @keydown.enter.prevent="applySetupTemplateCard(card.template)"
              @keydown.space.prevent="applySetupTemplateCard(card.template)">
              <div class="setup-template-preview" aria-hidden="true"
                :style="{ gridTemplateColumns: `repeat(${card.preview.cols}, 1fr)`, gridTemplateRows: `repeat(${card.preview.rows}, 1fr)` }">
                <span class="setup-template-preview-los"
                  :style="{ gridColumn: '1 / -1', gridRow: String(card.preview.losRow + 1) }"></span>
                <span v-for="token in card.preview.tokens" :key="token.slotId" class="setup-template-token"
                  :style="{ gridColumn: String(token.column + 1), gridRow: String(token.row + 1), backgroundColor: token.color }"></span>
              </div>
              <div class="setup-template-name">{{ card.template.name }}</div>
              <label v-if="!card.template.symmetric" class="setup-template-mirror" @click.stop @keydown.stop>
                <input v-model="setupTemplateMirrored[card.template.id]" type="checkbox" @click.stop /> Mirror
              </label>
            </div>
          </div>
          <div v-else-if="!savedSetupsCollapsed" class="setup-template-list">
            <form class="saved-setup-save" @submit.prevent="saveNamedSetup">
              <!-- IDbTableTeamSetups.LENGTH_NAME=40; UtilServerSetup.saveTeamSetup:82-83 replaces equal names. -->
              <input v-model="savedSetupName" class="saved-setup-input" maxlength="40"
                aria-label="Saved setup name" placeholder="Setup name" />
              <button class="setup-btn" type="submit"
                :disabled="!savedSetupName.trim() || !gameStore.state.savedSetupListReceived || gameStore.state.savedSetupSave?.status === 'saving'">
                {{ gameStore.state.savedSetupSave?.status === 'saving' ? 'Saving…' : 'Save' }}
              </button>
              <div class="saved-setup-help">Saving an existing name replaces it.</div>
              <div v-if="gameStore.state.savedSetupSave" class="saved-setup-status"
                :class="gameStore.state.savedSetupSave.status" :role="gameStore.state.savedSetupSave.status === 'failed' ? 'alert' : 'status'">
                <template v-if="gameStore.state.savedSetupSave.status === 'saving'">
                  Saving “{{ gameStore.state.savedSetupSave.name }}” to the server…
                </template>
                <template v-else-if="gameStore.state.savedSetupSave.status === 'saved'">
                  Saved “{{ gameStore.state.savedSetupSave.name }}”.
                </template>
                <template v-else>
                  The server did not confirm “{{ gameStore.state.savedSetupSave.name }}”. Try saving again.
                </template>
              </div>
            </form>
            <div v-if="!gameStore.state.savedSetupListReceived" class="setup-empty">Loading saved setups...</div>
            <div v-else-if="savedSetupCards.length === 0" class="setup-empty">No saved setups for this team.</div>
            <div v-for="card in savedSetupCards" :key="card.name" class="setup-template-card saved-setup-card"
              :class="{ active: lastLoadedSavedSetupName === card.name }">
              <div v-if="card.preview" class="setup-template-preview" aria-hidden="true"
                :style="{ gridTemplateColumns: `repeat(${card.preview.cols}, 1fr)`, gridTemplateRows: `repeat(${card.preview.rows}, 1fr)` }">
                <span class="setup-template-preview-los"
                  :style="{ gridColumn: '1 / -1', gridRow: String(card.preview.losRow + 1) }"></span>
                <span v-for="token in card.preview.tokens" :key="token.slotId" class="setup-template-token"
                  :style="{ gridColumn: String(token.column + 1), gridRow: String(token.row + 1), backgroundColor: token.color }"></span>
              </div>
              <!-- SERVER_TEAM_SETUP_LIST exposes names only (IJsonOption.java:386), never squares.
                   Private-fork capture / a possible upstream extension is FLAGGED FOR MEERO stage-2. -->
              <div v-else class="setup-template-preview saved-setup-placeholder">Preview unavailable</div>
              <div class="setup-template-name">{{ card.name }}</div>
              <div class="saved-setup-actions">
                <button class="setup-btn" type="button" @click="loadNamedSetup(card.name)">Load</button>
                <button class="setup-btn saved-setup-delete" type="button" @click="deleteNamedSetup(card.name)">Delete</button>
              </div>
            </div>
          </div>
        </section>

        <div v-if="setupPhase" class="setup-panel setup-card">
          <div class="setup-title">{{ solidDefenceSetup ? 'SOLID DEFENCE — RE-SET UP' : 'SET UP YOUR TEAM' }}</div>
          <!-- StepApplyKickoffResult.handleSolidDefense: only the players the server selected may be moved;
               everything else on the pitch is deactivated and inert. -->
          <div v-if="solidDefenceSetup" class="setup-selected" data-solid-defence>
            Only your <b>{{ solidDefenceMovableCount }}</b> selected player<span v-if="solidDefenceMovableCount !== 1">s</span>
            may be moved — the rest of the team is locked in place.
          </div>
          <div v-if="solidDefenceError" class="setup-selected" data-solid-defence-error role="alert">
            The referee rejected that setup: you moved <b>{{ solidDefenceError.amount }}</b> player<span v-if="solidDefenceError.amount !== 1">s</span>
            rather than the allowed <b>{{ solidDefenceError.limit }}</b>. Correct it and press Done again.
            <button class="setup-btn" type="button" @click="gameStore.dismissSolidDefenceError()">Dismiss</button>
          </div>
          <div v-if="setupPhase.setupErrors.length" class="setup-selected" data-setup-error role="alert">
            <b>SETUP REJECTED</b> — correct the formation and press Done again.
            <ul>
              <li v-for="message in setupPhase.setupErrors" :key="message">{{ message }}</li>
            </ul>
          </div>
          <ul class="setup-conditions">
            <li :class="{ ok: setupPhase.validation.losOk }">
              <span class="setup-mark">{{ setupPhase.validation.losOk ? '✓' : '✗' }}</span>
              At least 3 on the line ({{ setupPhase.validation.onLos }}/3)
            </li>
            <li :class="{ ok: setupPhase.validation.leftOk }">
              <span class="setup-mark">{{ setupPhase.validation.leftOk ? '✓' : '✗' }}</span>
              ≤2 in the left wide zone ({{ setupPhase.validation.leftWide }})
            </li>
            <li :class="{ ok: setupPhase.validation.rightOk }">
              <span class="setup-mark">{{ setupPhase.validation.rightOk ? '✓' : '✗' }}</span>
              ≤2 in the right wide zone ({{ setupPhase.validation.rightWide }})
            </li>
            <li :class="{ ok: setupPhase.validation.countOk }">
              <span class="setup-mark">{{ setupPhase.validation.countOk ? '✓' : '✗' }}</span>
              Placed {{ setupPhase.validation.placed }}/{{ setupPhase.validation.required }}
            </li>
          </ul>
          <div class="setup-reserve-label">RESERVES: {{ setupReserves.length }} left — click OR drag a reserve onto the pitch; click a placed player then the dugout to send it back; click two placed players (or a placed player then a reserve) to swap</div>
          <div v-if="selectedSetupPlayer" class="setup-selected">
            Selected: <b>{{ selectedSetupPlayer.posName || selectedSetupPlayer.name }}</b> —
            {{ selectedSetupPlaced ? 'click a square to move, or click the dugout to return to reserves' : 'click a square on your half to place' }}
          </div>
          <div class="setup-actions">
            <button class="setup-btn" @click="returnSelectedToReserve" :disabled="!selectedSetupPlayerId">↩ Reserve</button>
            <button class="setup-btn done" :disabled="!setupPhase.validation.valid" @click="gameStore.setupSubmit()">Done</button>
            <button v-if="setupPhase.validation.canConcede" class="setup-btn concede" @click="gameStore.setupConcede()">Concede</button>
          </div>
        </div>

        <!-- ClientStateSwarming.java:10-27: dedicated setup-shaped placement without formation controls. Owner
             (this window): reserves now drag straight from the dugout, same idiom as normal setup — the per-player
             chip list is gone, replaced by the reserve-count readout used by the setup panel above. -->
        <div v-if="swarmingPhase" class="setup-panel setup-card" aria-label="Swarming placement">
          <div class="setup-title">SWARMING</div>
          <div v-if="swarmingPhase.error" class="setup-selected">
            Too many Swarming players: {{ swarmingPhase.error.actual }} placed, {{ swarmingPhase.error.allowed }} allowed.
          </div>
          <div v-if="swarmingPhase.setupErrors.length" class="setup-selected" role="alert">
            <b>Setup rejected — correct these rules:</b>
            <ul class="setup-conditions">
              <li v-for="message in swarmingPhase.setupErrors" :key="message">
                <span class="setup-mark">✗</span>{{ message }}
              </li>
            </ul>
          </div>
          <div v-else-if="swarmingPhase.recoveredWithoutOffer" class="setup-selected">
            Swarming placement recovered after reconnect. The server will re-check the setup when you choose Done.
          </div>
          <ul class="setup-conditions">
            <li :class="{ ok: swarmingPhase.countLegal }">
              <span class="setup-mark">{{ swarmingPhase.countLegal ? '✓' : '✗' }}</span>
              Placed {{ swarmingPhase.placedCount }}<template v-if="swarmingPhase.amount !== null">/{{ swarmingPhase.amount }}</template>
            </li>
          </ul>
          <div class="setup-reserve-label">RESERVES: {{ swarmingReserves.length }} left — click OR drag a reserve onto the pitch; click a placed player to send it back</div>
          <div v-if="selectedSwarming" class="setup-selected">
            Selected: <b>{{ swarmingPlayers.find((player) => player.playerId === selectedSwarming)?.name }}</b>. Choose a square to place the player
          </div>
          <div class="setup-actions">
            <button class="setup-btn done" :disabled="!swarmingPhase.countLegal" @click="gameStore.swarmingConfirm()">Done</button>
          </div>
        </div>

        <!-- Owner o66ak: drag-to-setup ghost — follows the pointer while dragging a reserve onto the pitch. -->
        <div v-if="setupDrag" class="setup-drag-ghost" :style="{ left: setupDrag.x + 'px', top: setupDrag.y + 'px' }">
          {{ setupDrag.label }}
        </div>

        <!-- Modern-only referee decision surface. ClassicView retains its direct-port dialog. -->
        <SendOffPrompt v-if="gameStore.state.sendOff"
          :player-name="gameStore.state.sendOff.playerName"
          :can-argue="gameStore.state.sendOff.canArgue"
          :can-bribe="gameStore.state.sendOff.canBribe"
          :referee-icon-url="refereeIconUrl" :coin-icon-url="coinSkullUrl" :position-name="sendOffPositionName"
          :position-style="reactivePromptStyle('sendOff')"
          @drag-start="startReactivePromptDrag('sendOff', $event)"
          @argue="gameStore.sendOffArgue()" @bribe="gameStore.sendOffBribe()" @pass="gameStore.sendOffPass()" />

        <!-- Read-only authoritative outcome; Modern uses the same referee presentation family as the prompt. -->
        <SendOffResult v-if="gameStore.state.sendOffResult && !gameStore.state.sendOffWaiting" :result="{
          ...gameStore.state.sendOffResult,
          logoUrl: splashTeamLogo(gameStore.state.sendOffResult.side, gameStore.state.sendOffResult.logoUrl),
        }" :coin-icon-url="coinSkullUrl" :referee-icon-url="refereeIconUrl" />

        <!-- Owner ⑩ (08-12): the PARAMETERIZED rollCine render was removed as dead (state.rollCine never set;
             regeneration/swarming/B&C moved off it). Store-side machinery removal follows (Tarkin, co-land). -->

        <!-- Owner 2026-07-04e: UNKNOWN-CALL diagnostic panel — a server dialog we
             don't recognize. Notice + screenshot/copy/log + describe + (if it
             wants a coordinate) a pitch tile picker. -->
        <div v-if="gameStore.state.unknownCall" class="unknown-call" :style="unknownCallStyle">
          <div class="uc-head" title="Drag to move" @pointerdown="startUnknownDrag($event)">⚠ Unrecognized server call ⠿</div>
          <div class="uc-body">
            <p>We received the dialog <b>"{{ gameStore.state.unknownCall.id }}"</b> but have no wired
              invocation point for it. Please help us wire it:</p>
            <div class="uc-args">
              <span class="uc-args-label">Arguments present:</span>
              <code>{{ gameStore.state.unknownCall.payloadKeys.join(', ') || '(none)' }}</code>
            </div>
            <div v-if="gameStore.state.unknownCall.catalogArgs" class="uc-args">
              <span class="uc-args-label">Catalog expects:</span>
              <code>{{ gameStore.state.unknownCall.catalogArgs }}</code>
            </div>
            <div class="uc-actions">
              <button class="uc-btn" @click="screenshotUnknown()">📸 Screenshot</button>
              <button class="uc-btn" @click="copyUnknownDetails()">📋 Copy details</button>
              <button class="uc-btn" @click="exportUnknownLog()">📄 Export log</button>
            </div>
            <span v-if="unknownCopyStatus" class="uc-status">{{ unknownCopyStatus }}</span>
            <label class="uc-describe">
              <span>What happened when this occurred?</span>
              <textarea rows="2" :value="gameStore.state.unknownCall.description"
                @input="gameStore.setUnknownCallDescription(($event.target as HTMLTextAreaElement).value)"
                placeholder="Describe the action you took…"></textarea>
            </label>
            <!-- coordinate response -->
            <div v-if="gameStore.state.unknownCall.expectsCoordinate" class="uc-coord">
              <template v-if="unknownPickingTile">
                <span class="uc-coord-prompt">
                  {{ gameStore.state.unknownCall.eligible
                    ? 'Select one of the highlighted squares.'
                    : 'Click any tile on the pitch to return its coordinate.' }}
                </span>
              </template>
              <button v-else class="uc-btn coord" @click="armUnknownTilePick()">
                🎯 This call wants a coordinate — pick a tile
              </button>
            </div>
            <div class="uc-foot">
              <button class="uc-btn dismiss" @click="gameStore.dismissUnknownCall()">Dismiss</button>
            </div>
          </div>
        </div>

        <!-- Owner 2026-07-04d: persistent ADMIN BROADCAST (serverAdminMessage),
             top-right; the player must Acknowledge to clear. -->
        <div v-if="gameStore.state.adminMessage" class="admin-message center-left-notice">
          <div class="admin-message-head">⚠ Admin broadcast</div>
          <div class="admin-message-body">{{ gameStore.state.adminMessage }}</div>
          <button class="admin-message-ack" @click="gameStore.dismissAdminMessage()">Acknowledge</button>
        </div>

        <!-- Owner 2026-07-10: server-side messages (concede-not-granted, weather change, …) as a center-left
             modal instead of a chat toast. Sits just below the admin broadcast if both are up. -->
        <div v-if="gameStore.state.infoNotice" class="admin-message center-left-notice server-notice">
          <div class="admin-message-head">Server message</div>
          <div class="admin-message-body">{{ gameStore.state.infoNotice.text }}</div>
          <button class="admin-message-ack" @click="gameStore.state.infoNotice = null">Dismiss</button>
        </div>

        <!-- Generic selectSkill dialog. Skill icons (or plaintext when using markers). -->
        <div v-if="gameStore.state.selectSkill" class="yesno-card select-skill-card"
          :style="reactivePromptStyle('selectSkill')" title="Drag to move"
          @pointerdown="startReactivePromptDrag('selectSkill', $event)">
          <IntensiveTrainingChoice v-if="intensiveTrainingSelect"
            :player-name="gameStore.state.selectSkill.playerName" :portrait="selectSkillPortrait"
            :skills="gameStore.state.selectSkill.skills" interactive @choose="gameStore.resolveSelectSkill($event)" />
          <template v-else>
          <div class="yesno-text">Pick a skill for {{ gameStore.state.selectSkill.playerName }}</div>
          <div class="skill-select-list">
            <button v-for="sk in gameStore.state.selectSkill.skills" :key="sk"
              class="skill-select-opt" @click="gameStore.resolveSelectSkill(sk)">
              <img v-if="settings.skillDisplay === 'icons' && playerOwnedSkillIconUrl(sk, effectiveIconStyle, playerSideById(gameStore.state.selectSkill.playerId))"
                :src="playerOwnedSkillIconUrl(sk, effectiveIconStyle, playerSideById(gameStore.state.selectSkill.playerId))" class="skill-select-icon" :alt="sk" />
              <span>{{ sk }}</span>
            </button>
            <span v-if="gameStore.state.selectSkill.skills.length === 0" class="setup-empty">— no skills offered —</span>
          </div>
          </template>
        </div>

        <!-- Weather Mage: every button is an exact name/modifier pair offered by DialogSelectWeather. -->
        <div v-if="gameStore.state.selectWeather" class="yesno-card select-skill-card">
          <div class="yesno-text">Choose the weather</div>
          <div class="skill-select-list">
            <button v-for="option in gameStore.state.selectWeather.options" :key="option.name"
              class="skill-select-opt" @click="gameStore.resolveSelectWeather(option.name)">
              <span>{{ option.label }}</span>
              <span>{{ option.modifierLabel }}</span>
            </button>
          </div>
        </div>

        <!-- Upstream DialogUseInducement: every server-offered inducement/card plus decline. -->
        <div v-if="gameStore.state.inducementUse && !gameStore.state.wizardTargetConfirm" class="yesno-card select-skill-card">
          <div class="yesno-text">{{ gameStore.state.inducementUse.prompt }}</div>
          <div class="skill-select-list">
            <button v-for="option in gameStore.state.inducementUse.options"
              :key="`${option.kind}:${option.value}`" class="skill-select-opt"
              @click="gameStore.resolveUseInducement(option.kind, option.value)">
              <span>{{ option.kind === 'card' ? 'Card: ' : '' }}{{ option.label }}</span>
            </button>
            <button class="rr-decline" @click="gameStore.resolveUseInducement('decline')">{{ gameStore.state.inducementUse.declineLabel }}</button>
          </div>
        </div>

        <!-- #8 (owner tester): voluntary End-Turn guard — a client-side confirm when own players
             are still unactivated (server acted-flag count, Meero C-8). NOT a server dialog. -->
        <PitchConfirmationPanel v-if="endTurnWarnCount !== null" title="End Turn?" label="End turn confirmation"
          :position-style="reactivePromptStyle('endTurnWarn')" draggable
          @drag-start="startReactivePromptDrag('endTurnWarn', $event)">
          {{ endTurnWarnCount }} of your players {{ endTurnWarnCount === 1 ? 'has' : 'have' }} not activated yet.
          <template #actions>
            <button class="rr-use" @click="confirmEndTurnAnyway()">End turn</button>
            <button class="rr-decline" @click="cancelEndTurnWarn()">Go back</button>
          </template>
        </PitchConfirmationPanel>

        <!-- #12/#231: the single shared confirmation surface for every guarded end-activation trigger. -->
        <PitchConfirmationPanel v-if="endActConfirm" title="End Activation?" label="End activation confirmation"
          :position-style="reactivePromptStyle('endActConfirm')" draggable
          @drag-start="startReactivePromptDrag('endActConfirm', $event)">
          {{ endActConfirm.text }}
          <template #actions>
            <button class="rr-use" @click="confirmEndActivation()">{{ endActConfirm.confirmLabel }}</button>
            <button class="rr-decline" @click="cancelEndActivation()">Go back</button>
          </template>
        </PitchConfirmationPanel>

        <!-- #91 (owner): declared-but-unconfirmed blitz + a floor-tile click → "convert to a plain Move?". Accept
             un-consumes the blitz (server-safe) and moves; right-click (or Keep Blitz) dismisses with NO wire,
             leaving the blitz declaration pending. -->
        <PitchConfirmationPanel v-if="blitzMoveModalTile" title="Keep Blitz?" label="Blitz conversion confirmation"
          :position-style="reactivePromptStyle('blitzMove')" draggable
          @drag-start="startReactivePromptDrag('blitzMove', $event)" @contextmenu.prevent="dismissBlitzMoveModal()">
          You've declared a Blitz. Convert to a plain Move instead?
          <template #actions>
            <button class="rr-use" @click="acceptBlitzMoveConvert()">Convert to Move</button>
            <button class="rr-decline" @click="dismissBlitzMoveModal()">Keep Blitz</button>
          </template>
        </PitchConfirmationPanel>

        <!-- Owner 2026-07-06 (note 4/5): BB2025 selectKeyword — the injured player's
             coach picks a keyword to hate (Getting Even / Hatred). N options, one pick. -->
        <div v-if="gameStore.state.keywordChoice" class="yesno-card select-skill-card"
          :style="reactivePromptStyle('keywordChoice')" title="Drag to move"
          @pointerdown="startReactivePromptDrag('keywordChoice', $event)">
          <div class="yesno-text">{{ gameStore.state.keywordChoice.playerName }} — choose a keyword to hate</div>
          <div class="skill-select-list">
            <button v-for="kw in gameStore.state.keywordChoice.keywords" :key="kw"
              class="skill-select-opt" @click="gameStore.resolveKeyword([kw])">
              <span>{{ kw }}</span>
            </button>
            <span v-if="gameStore.state.keywordChoice.keywords.length === 0" class="setup-empty">— no keywords offered —</span>
          </div>
        </div>

        <!-- Owner 2026-07-04d: minimal BUY-CARD menu — pick a card or Done. -->
        <div v-if="gameStore.state.cardChoice" class="yesno-card card-buy-menu"
          :style="reactivePromptStyle('cardChoice')" title="Drag to move"
          @pointerdown="startReactivePromptDrag('cardChoice', $event)">
          <div class="yesno-text">Buy a card? <span class="card-gold">{{ gameStore.state.cardChoice.availableGold }}gp</span></div>
          <div class="card-buy-list">
            <button v-for="opt in gameStore.state.cardChoice.options" :key="opt.selection"
              class="card-buy-opt" @click="gameStore.resolveCardChoice(opt.selection)">
              <span class="card-buy-name">{{ opt.name }}</span>
              <span class="card-buy-desc">{{ opt.description }}</span>
            </button>
          </div>
          <button class="sendoff-btn pass card-buy-done" @click="gameStore.resolveCardChoice(null)">Done</button>
        </div>

        <!-- case 478: BUY CARDS WITH GOLD — spend inducement gold on random cards drawn from
             per-type decks. Click a deck to buy one (server draws + re-shows to loop), or Done. -->
        <div v-if="gameStore.state.cardBuy" class="yesno-card card-buy-menu"
          :style="reactivePromptStyle('cardBuy')" title="Drag to move"
          @pointerdown="startReactivePromptDrag('cardBuy', $event)">
          <div class="yesno-text">Buy cards
            <span class="card-gold">{{ fmtGold(gameStore.state.cardBuy.availableGold) }}gp</span>
            <span class="card-buy-budget">· up to {{ gameStore.state.cardBuy.availableCards }} more</span>
          </div>
          <div class="card-buy-list">
            <button v-for="d in gameStore.state.cardBuy.decks" :key="d.cardType"
              class="card-buy-opt"
              :disabled="d.nrOfCards <= 0 || gameStore.state.cardBuy.availableCards <= 0"
              @click="gameStore.resolveBuyCard(d.cardType)">
              <span class="card-buy-name">{{ cardTypeLabel(d.cardType) }}</span>
              <span class="card-buy-desc">{{ d.nrOfCards }} in deck</span>
            </button>
          </div>
          <button class="sendoff-btn pass card-buy-done" @click="gameStore.resolveBuyCard(null)">Done</button>
        </div>


        <!-- Owner 2026-07-04d: interactive COIN CALL — Heads/Tails buttons, each
             with the coin side beside it (heads = FUMBBL skull, tails = T). -->
        <div v-if="gameStore.state.coinChoicePrompt" class="yesno-card coin-choice-card"
          :style="reactivePromptStyle('coinChoice')" title="Drag to move"
          @pointerdown="startReactivePromptDrag('coinChoice', $event)">
          <div class="yesno-text">Call the coin toss</div>
          <div class="coin-choice-actions">
            <button class="sendoff-btn argue" @click="gameStore.resolveCoinChoice(true)">
              Heads <span class="coin-side heads"><img :src="coinSkullUrl" alt="" /></span>
            </button>
            <button class="sendoff-btn pass" @click="gameStore.resolveCoinChoice(false)">
              Tails <span class="coin-side tails">T</span>
            </button>
          </div>
        </div>

        <!-- Owner 2026-07-09: PREGAME WAITING modal — the non-acting coach sees who's on the clock
             (e.g. the opponent calling the coin / choosing kick-receive). -->
        <div v-if="gameStore.state.pregameWait && !gameStore.state.coinChoicePrompt && !gameStore.state.receiveChoicePrompt"
          :key="gameStore.state.pregameWait.seq" class="yesno-card coin-wait-card">
          <div class="coin-wait-spinner" />
          <div class="yesno-text">{{ gameStore.state.pregameWait.text }}</div>
          <div class="coin-wait-sub">Waiting…</div>
        </div>

        <!-- Gate Kick/Receive behind the queued coin-result cine so result always precedes the choice. -->
        <div v-if="gameStore.state.receiveChoicePrompt && !gameStore.cineShowing.value" class="yesno-card coin-choice-card"
          :style="reactivePromptStyle('receiveChoice')" title="Drag to move"
          @pointerdown="startReactivePromptDrag('receiveChoice', $event)">
          <div class="toss-winner-splash">🪙 {{ gameStore.state.receiveChoicePrompt.winner }} won the toss!</div>
          <div class="yesno-text">Kick or receive?</div>
          <div class="coin-choice-actions">
            <button class="sendoff-btn argue" @click="gameStore.resolveReceiveChoice(true)">Receive</button>
            <button class="sendoff-btn pass" @click="gameStore.resolveReceiveChoice(false)">Kick</button>
          </div>
        </div>

        <!-- Owner 2026-07-04 (interaction catalog 0.2): generic YES/NO prompt —
             renders any accompanying server text verbatim. -->
        <PitchConfirmationPanel v-if="gameStore.state.yesNo" :key="'yn-' + gameStore.state.yesNo.seq"
          title="Confirm" label="Confirmation" :position-style="reactivePromptStyle('yesNo')" draggable
          @drag-start="startReactivePromptDrag('yesNo', $event)">
          {{ gameStore.state.yesNo.text }}
          <template #actions>
            <button class="sendoff-btn argue" @click="gameStore.resolveYesNo(true)">{{ gameStore.state.yesNo.yesLabel }}</button>
            <button class="sendoff-btn pass" @click="gameStore.resolveYesNo(false)">{{ gameStore.state.yesNo.noLabel }}</button>
          </template>
        </PitchConfirmationPanel>

        <!-- Bloodlust reroll/decision card. The feed beat uses the pitch player-pick rail. -->
        <!-- #237 (owner-fg 07-29): manual drag position takes precedence over the RAF token anchor. -->
        <div v-if="gameStore.state.bloodlust && gameStore.state.bloodlust.stage !== 'bite'" :key="'bl-' + gameStore.state.bloodlust.seq"
          class="skill-choice reroll-bar bloodlust-card"
          :style="reactivePromptStyle('bloodlust', bloodlustPos.ready ? { x: bloodlustPos.x, y: bloodlustPos.y } : undefined)"
          title="Drag to move" @pointerdown="startReactivePromptDrag('bloodlust', $event)">
          <!-- Owner W37 mock: the RE-ROLL beat restructures to 3 lines — headline states the failure plainly
               (vampire name rides here since the mock drops it from line 1), the rolled d6 sits alone on its
               own line, then "Reroll?" + the source buttons + the X decline (replacing the old "Keep" text
               button, matching the ✕-decline idiom used by the generic reroll card's rr-decline-chip).
               Decision/bite beats keep the original title + button-row layout untouched. -->
          <div v-if="gameStore.state.bloodlust.stage === 'reroll'" class="sc-title bl-title">
            <span class="bl-marker" aria-hidden="true">🩸</span> {{ gameStore.state.bloodlust.vampire }} failed bloodlust
          </div>
          <div v-else class="sc-title"><span class="bl-marker" aria-hidden="true">🩸</span> Bloodlust — {{ gameStore.state.bloodlust.vampire }}</div>
          <div class="bl-opts">
            <template v-if="gameStore.state.bloodlust.stage === 'reroll'">
              <div v-if="gameStore.state.bloodlust.roll != null" class="rr-prompt-line">
                <D6Face class="sc-die rr-ctx-die" :value="gameStore.state.bloodlust.roll"
                  :label="`Rolled ${gameStore.state.bloodlust.roll}`" />
              </div>
              <div v-if="bloodlustTastyMorselAvailable" class="rr-prompt-line bl-special-available">
                {{ TASTY_MORSEL_AVAILABLE_COPY }}
              </div>
              <div class="rr-prompt-line rr-question bl-reroll-row">
                <span>Reroll?</span>
                <button v-for="opt in gameStore.state.bloodlust.rerollOptions" :key="opt.source" class="bl-opt"
                  :title="'Re-roll: ' + opt.label" @click="gameStore.resolveBloodlustReroll(opt.source)">
                  <img v-if="opt.kind === 'team'" :src="resourceIcon('re_roll')" alt="Team re-roll" />
                  <img v-else-if="settings.skillDisplay === 'icons' && skillIconUrl(opt.kind === 'pro' ? 'Pro' : opt.source, effectiveIconStyle)"
                    :src="skillIconUrl(opt.kind === 'pro' ? 'Pro' : opt.source, effectiveIconStyle)!" :alt="opt.label" />
                  <span>{{ opt.label.replaceAll('Re-roll', 'Reroll').replaceAll('re-roll', 'Reroll') }}</span>
                </button>
                <button class="bl-opt bl-decline rr-decline-chip" title="Keep the roll"
                  @click="gameStore.resolveBloodlustReroll(null)">✕</button>
              </div>
            </template>
            <template v-else-if="gameStore.state.bloodlust.stage === 'decision'">
              <button class="bl-opt" @click="gameStore.resolveBloodlustDecision(true)">
                {{ gameStore.state.bloodlust.changeToMove ? 'Change to move' : 'Move first' }}
              </button>
              <button class="bl-opt bl-feed" @click="gameStore.resolveBloodlustDecision(false)">
                Feed &amp; perform {{ gameStore.state.bloodlust.action }}
              </button>
            </template>
          </div>
        </div>

        <!-- Pick-Me-Up reuses the generic playerChoice arm and adds only distinct title/copy. -->
        <!-- #237 (owner-fg 07-29): the Pick-Me-Up prompt variant has its own movable body. -->
        <div v-if="gameStore.state.playerPick && gameStore.state.playerPick.key.startsWith('pchoice:pickMeUp')"
          class="pickmeup-splash" :style="{ ...reactivePromptStyle('pickMeUp', pickMeUpTitleAnchor), bottom: 'auto' }"
          title="Drag to move" @pointerdown="startReactivePromptDrag('pickMeUp', $event)">Choose players to pick up</div>

        <!-- Owner 2026-07-15: the MVP NOMINATION uses its own roster-summary modal (below), not the bottom
             pick-bar — hide the bar for the mvp pick so the two don't stack. -->
        <!-- Owner 2026-07-04 (interaction catalog 0.1): generic player-pick bar —
             the prompt + red Decline beside the movement confirm bar's slot. -->
        <!-- #237 (owner-fg 07-29): body drag leaves buttons, labels, and inputs on their original click path. -->
        <!-- Triage #4 (owner 08-11): the SHADOWING class retires this bottom bar for a position-anchored pill below. -->
        <ChargePickPanel v-if="chargePick" :max="chargePick.maxPicks" :selected="chargePick.picked.length"
          :confirm-disabled="chargePick.picked.length < chargePick.minPicks || chargePick.picked.length === 0"
          :declinable="chargePick.declinable" @confirm="gameStore.confirmPlayerPick()"
          @decline="gameStore.resolvePlayerPick(null)" />

        <ChargePickPanel v-else-if="dwarfenWisdomPick" title="Dwarfen Wisdom"
          label="Dwarfen Wisdom player selection" :roll="dwarfenWisdomPick.roll"
          :max="dwarfenWisdomPick.maxPicks" :selected="dwarfenWisdomPick.picked.length"
          :confirm-disabled="dwarfenWisdomPick.picked.length < dwarfenWisdomPick.minPicks"
          :declinable="dwarfenWisdomPick.declinable" @confirm="gameStore.confirmPlayerPick()"
          @decline="gameStore.resolvePlayerPick(null)" />

        <ChargePickPanel v-else-if="prayerBoardPick" :title="prayerBoardTitle"
          :label="`${prayerBoardTitle} player selection`"
          :max="prayerBoardPick.maxPicks" :selected="prayerBoardPick.picked.length"
          :confirm-disabled="prayerBoardPick.picked.length < prayerBoardPick.minPicks"
          :declinable="prayerBoardPick.declinable" @confirm="gameStore.confirmPlayerPick()"
          @decline="gameStore.resolvePlayerPick(null)" />

        <PitchConfirmationPanel v-if="gameStore.state.playerPick && !mvpPick && !chargePick && !dwarfenWisdomPick && !prayerBoardPick && !shadowingPick && !tentaclesPick && !pickMeUpPrompt"
          title="Select Players" label="Player selection confirmation" :position-style="reactivePromptStyle('playerPick')"
          draggable @drag-start="startReactivePromptDrag('playerPick', $event)">
          <span>{{ gameStore.state.playerPick.prompt }}</span>
          <span v-if="gameStore.state.playerPick.confirm && gameStore.state.playerPick.maxPicks > 1" class="pick-count">
            {{ gameStore.state.playerPick.picked.length }}/{{ gameStore.state.playerPick.maxPicks }}
          </span>
          <template #actions>
            <button v-if="gameStore.state.playerPick.confirm" class="pick-confirm"
              :disabled="gameStore.state.playerPick.picked.length < gameStore.state.playerPick.minPicks || gameStore.state.playerPick.picked.length === 0"
              @click="gameStore.confirmPlayerPick()">Confirm</button>
            <button v-if="gameStore.state.playerPick.declinable" class="pick-decline"
              @click="gameStore.resolvePlayerPick(null)">Decline</button>
            <button v-if="rosterPickFallback" class="pick-decline" type="button"
              @click="rosterPickFallbackOpen = !rosterPickFallbackOpen">{{ rosterPickFallbackOpen ? 'Hide list' : 'Pick from roster' }}</button>
          </template>
        </PitchConfirmationPanel>

        <!-- Pick-Me-Up remains token/scoreboard anchored; it is a contextual election, not a global confirm. -->
        <div v-if="gameStore.state.playerPick && !mvpPick && !chargePick && !dwarfenWisdomPick && !prayerBoardPick && !shadowingPick && !tentaclesPick && pickMeUpPrompt"
          class="player-pick-bar" :style="{ ...reactivePromptStyle('playerPick', pickMeUpCardAnchor), bottom: 'auto' }"
          title="Drag to move" @pointerdown="startReactivePromptDrag('playerPick', $event)">
          <span class="pick-prompt">{{ gameStore.state.playerPick.prompt }}</span>
          <button v-if="gameStore.state.playerPick.confirm" class="pick-confirm"
            :disabled="gameStore.state.playerPick.picked.length < gameStore.state.playerPick.minPicks || gameStore.state.playerPick.picked.length === 0"
            @click="gameStore.confirmPlayerPick()">Confirm</button>
          <button v-if="gameStore.state.playerPick.declinable" class="pick-decline" @click="gameStore.resolvePlayerPick(null)">Decline</button>
        </div>

        <div v-if="rosterPickFallback && rosterPickFallbackOpen" class="roster-pick-fallback-panel">
          <EligibleRosterPicker theme="modern" :prompt="rosterPickFallback.prompt" :candidates="rosterPickFallback.candidates"
            :picked="rosterPickFallback.picked" :min="rosterPickFallback.min" :max="rosterPickFallback.max"
            :declinable="rosterPickFallback.declinable" @pick="gameStore.resolvePlayerPick($event)"
            @confirm="gameStore.confirmPlayerPick(); rosterPickFallbackOpen = false"
            @decline="gameStore.resolvePlayerPick(null); rosterPickFallbackOpen = false" />
        </div>

        <!-- Triage #4 (owner 08-11): SHADOWING pill — a position-anchored Confirm/Decline at the shadower (the
             reactive-election / follow-up idiom), replacing the bottom bar for this class. Same playerPick wire. -->
        <div v-if="shadowingPick && shadowingPos" class="followup-chip"
          :style="reactivePromptStyle('shadowing', { x: shadowingPos.x, y: shadowingPos.y })"
          title="Drag to move" @pointerdown="startReactivePromptDrag('shadowing', $event)">
          <div class="fu-title">Shadow the runner?</div>
          <div class="fu-actions">
            <button class="fu-btn follow" @click="answerShadowing(true)">Shadow</button>
            <button v-if="shadowingPick.declinable" class="fu-btn stay" @click="answerShadowing(false)">Decline</button>
          </div>
        </div>

        <!-- TENTACLES (owner 08-12): picker retired → token-anchored reactive card over the auto-selected tentacler
             (higher STR, tie → number). Same playerPick wire; Decline only when the server allows it (minSelects). -->
        <div v-if="tentaclesPick && tentaclesPos" class="followup-chip"
          :style="reactivePromptStyle('tentacles', { x: tentaclesPos.x, y: tentaclesPos.y })"
          title="Drag to move" @pointerdown="startReactivePromptDrag('tentacles', $event)">
          <div class="fu-title">Use Tentacles?</div>
          <div class="fu-actions">
            <button class="fu-btn follow" @click="answerTentacles(true)">Use</button>
            <button v-if="tentaclesPick.declinable" class="fu-btn stay" @click="answerTentacles(false)">Decline</button>
          </div>
        </div>

        <!-- Triage #10 (owner 08-11): "Your opponent is deciding…" just below the block dice while it's THEIR pick
             (state.opponentReviewingDice — never on your own picks; clears when the pick resolves). -->
        <div v-if="gameStore.state.opponentReviewingDice && oppDecidingPos" class="opp-deciding-note"
          :style="{ left: oppDecidingPos.x + 'px', top: oppDecidingPos.y + 'px' }">Your opponent is deciding…</div>

        <!-- Owner 09-08: parked at the deciding player's token (same pill as the passive skill decision); the
             top-centre cue remains only when the player has no on-screen token. -->
        <div v-if="gameStore.state.opponentChoicePending && opponentPendingPos.ready"
          class="followup-chip passive head-mounted reactive-decision-pill"
          :style="{ left: opponentPendingPos.x + 'px', top: (opponentPendingPos.y + 54) + 'px' }"
          role="status" aria-live="polite">
          <div class="fu-title">{{ gameStore.state.opponentChoicePending }}</div>
        </div>
        <div v-else-if="gameStore.state.opponentChoicePending" class="negatrait-cue fail opponent-reactive-pill"
          role="status" aria-live="polite">{{ gameStore.state.opponentChoicePending }}</div>

        <OnTheBallWaitingModal v-if="gameStore.state.onTheBallWaiting"
          :message="gameStore.state.onTheBallWaiting.message"
          :position-style="onTheBallWaitingStyle" draggable
          @drag-start="startReactivePromptDrag('onTheBallWaiting', $event)" />
        <SendOffWaitingModal v-if="gameStore.state.sendOffWaiting"
          :progress="gameStore.state.sendOffWaiting" :referee-icon-url="refereeIconUrl" :position-name="sendOffWaitingPositionName" />

        <!-- MVP nomination uses roster rows as click targets; checkboxes are display-only. -->
        <!-- Owner 2026-07-15: unified staged MVP screen. Result banner · both-teams MVP chips (mvpRoll:
             Pending…→roulette→reveal, opponent flashes in) · MY roster with checkbox nomination (only on my
             turn; the button is inert while it's the opponent's turn) · Continue once both sides resolve. -->
        <div v-if="mvpScreenActive" class="mvp-nominate-overlay">
          <div class="mvp-nominate-card">
            <div v-if="mvpResult" class="mvp-screen-result">
              <span class="mvp-screen-final">Final</span>
              <span class="mvp-screen-team">{{ mvpResult.homeTeam }}</span>
              <b>{{ mvpResult.homeScore }}</b><span class="mvp-screen-dot">·</span><b>{{ mvpResult.awayScore }}</b>
              <span class="mvp-screen-team">{{ mvpResult.awayTeam }}</span>
            </div>
            <div class="mvp-screen-chips">
              <div v-for="c in mvpChips" :key="c.side" class="mvp-screen-chip" :class="{ 'mvp-flash': c.flash, mine: c.mine }">
                <div class="mvp-screen-chip-team">{{ c.team }}<span v-if="c.mine" class="mvp-screen-you"> (you)</span></div>
                <!-- #44: winner portrait at roulette end — the in-game sprite portrait, revealed on 'landed'. -->
                <img v-if="c.phase === 'landed' && c.portrait" class="mvp-screen-portrait" :src="c.portrait" alt="" />
                <div class="mvp-screen-chip-mvp"><span class="mvp-screen-mvp-lbl">MVP:</span>
                  <!-- #105: cycling/awaiting/none show the roulette/status text; landed shows the FIRST winner
                       reactively off side.mvps (NOT the frozen roulette display, so a reorder can't desync it). -->
                  <span class="mvp-screen-mvp-name" :data-phase="c.phase"><i v-if="c.phase === 'landed'" class="mvp-screen-star" aria-hidden="true"></i>{{ c.phase === 'landed' ? (c.winners[0]?.name ?? c.display) : c.display }}</span>
                  <!-- #105 per-award badge: the head winner earned >1 MVP (same-player double) → unmistakable ×N. -->
                  <span v-if="c.phase === 'landed' && (c.winners[0]?.awards ?? 0) > 1" class="mvp-screen-mvp-x">×{{ c.winners[0]?.awards }}</span>
                </div>
                <!-- #105 additional DISTINCT MVP winners on this side (two different players), keyed by playerId.
                     #168 (owner concede double-MVP; screenshot Umug + Yashnarz on the winning card): render each extra
                     winner as its OWN full row matching the HEAD row's style — reuses `.mvp-screen-chip-mvp` markup
                     ("MVP:" label + starred accent name + ×N badge) instead of a bare small name line. -->
                <div v-if="c.phase === 'landed'" v-for="w in c.winners.slice(1)" :key="w.id" class="mvp-screen-chip-mvp mvp-screen-extra">
                  <span class="mvp-screen-mvp-lbl">MVP:</span>
                  <span class="mvp-screen-mvp-name" data-phase="landed"><i class="mvp-screen-star" aria-hidden="true"></i>{{ w.name }}</span>
                  <span v-if="w.awards > 1" class="mvp-screen-mvp-x">×{{ w.awards }}</span>
                </div>
              </div>
            </div>
            <!-- #63 re-present mirror: :key bumps per MVP round → this block re-mounts + replays the pop-in so a
                 2nd (or Nth) nominate round visibly re-pops (fresh checkboxes ride Tarkin's store re-arm). -->
            <div v-if="mvpPick" :key="'mvp-round-' + mvpRoundKey" class="mvp-nominate-round">
              <div class="mvp-nominate-head">
                <span class="mvp-nominate-title">{{ mvpPick.prompt }}</span>
                <span class="mvp-nominate-count">{{ mvpPick.picked.length }}/{{ mvpPick.maxPicks }}</span>
              </div>
              <ul class="mvp-nominate-list">
                <li v-for="row in mvpRoster" :key="row.id" class="mvp-nominate-row"
                  :data-eligible="row.eligible" :data-checked="mvpPick.picked.includes(row.id)"
                  @click="row.eligible && gameStore.resolvePlayerPick(row.id)">
                  <input type="checkbox" class="mvp-nominate-check" tabindex="-1"
                    :checked="mvpPick.picked.includes(row.id)" :disabled="!row.eligible" />
                  <span class="mvp-nominate-nr">#{{ row.nr }}</span>
                  <span class="mvp-nominate-name">{{ row.name }}</span>
                  <span class="mvp-nominate-pos">{{ row.position }}</span>
                  <span v-if="row.skills" class="mvp-nominate-skills">{{ row.skills }}</span>
                  <span class="mvp-nominate-spp" :data-zero="row.sppTotal === 0 && row.sppEarned === 0">
                    {{ row.sppTotal }} SPP<span v-if="row.sppEarned > 0" class="mvp-nominate-spp-gain"> (+{{ row.sppEarned }})</span>
                  </span>
                </li>
              </ul>
              <div class="mvp-nominate-foot">
                <button class="mvp-nominate-confirm"
                  :disabled="mvpPick.picked.length < mvpPick.minPicks || mvpPick.picked.length === 0"
                  @click="gameStore.confirmPlayerPick()">Nominate MVP's</button>
              </div>
            </div>
            <div v-else class="mvp-nominate-foot">
              <button v-if="mvpBothResolved" class="mvp-nominate-confirm" @click="mvpDismissed = true; postGamePhase = 'stats'">Continue</button>
              <button v-else class="mvp-nominate-confirm" disabled>Nominate MVP's</button>
            </div>
          </div>
          <div v-if="mvpWaiting" class="mvp-waiting"><span class="mvp-waiting-dots"><i>.</i><i>.</i><i>.</i></span> Waiting for opponent</div>
        </div>

        <!-- g478 #1 (owner live g487) + Yularen audit rule: kickoff MINI-PHASE confirm bar (High Kick / Quick
             Snap). The coach interacts (optional), then Confirm ends the mini-phase via clientEndTurn{turnMode}.
             Without this the game hung — the fix for the "high kick broke the game" report, generalised so a
             Quick Snap kickoff can't repeat it. Solid Defence is excluded (its setup-panel has its own Done). -->
        <PitchConfirmationPanel v-if="o66MiniPhase" :title="quickSnapAllowance ? 'Quick Snap!' : 'High Kick!'"
          :label="quickSnapAllowance ? 'Quick Snap confirmation' : 'High Kick confirmation'"
          :test-id="quickSnapAllowance ? 'quick-snap-confirmation' : 'high-kick-confirmation'">
          <span>{{ quickSnapAllowance ? 'Click a player, then a highlighted square.' : 'Click a player to move under the ball.' }}</span>
          <div v-if="quickSnapAllowance" class="quicksnap-confirm-stack">
            <span class="pick-count">
              Moved {{ quickSnapAllowance.moved }} / {{ quickSnapAllowance.allowed }}<!--
              -->{{ quickSnapAllowance.available !== null ? ` · ${quickSnapAllowance.available} open` : '' }}
            </span>
            <span v-if="quickSnapAllowance.exhausted" class="pick-count">{{ quickSnapExhaustedText(quickSnapAllowance.exhausted.limitReached) }}</span>
          </div>
          <template #actions>
            <button v-if="quickSnapAllowance" class="pick-confirm" @click="gameStore.playerEndTurn()">Confirm</button>
            <button v-else class="pick-confirm" @click.stop="confirmHighKick()">Confirm</button>
          </template>
        </PitchConfirmationPanel>

        <PitchConfirmationPanel v-if="furySecondBlockTargeting" title="Fury of the Blood God"
          label="Fury of the Blood God second block target" test-id="fury-second-block-targeting" compact>
          Select another player to block or right click to cancel.
        </PitchConfirmationPanel>

        <PitchConfirmationPanel v-if="gameStore.state.onTheBallMover" title="On the Ball"
          label="On the Ball movement confirmation" test-id="on-the-ball-confirmation" compact>
          Finish the reaction movement when ready.
          <template #actions><button class="pick-confirm" @click="gameStore.endActivation()">End Move</button></template>
        </PitchConfirmationPanel>

        <!-- #85 Quick Snap: after a player is selected, its valid ≤1/empty target squares carry INVISIBLE click
             hit-targets (RAF-followed) — #161 moved the visual to the renderer's push-arrows (setQuickSnapArrows).
             Click one → sendQuickSnapMove (clientSetupPlayer); Confirm ends the phase. -->
        <button v-for="(t, i) in quickSnapTargets" :key="'qs-' + i" class="quicksnap-target"
          :style="{ left: t.x + 'px', top: t.y + 'px' }" @click="pickQuickSnapTarget(t.coord)"></button>

        <!-- Non-owning seats: public-safe pending cue (Fives ruling 08-12 — same class as the block-dice
             "opponent is deciding" note; reveals only that a decision is pending, kept per no-private-overlay). -->
        <div v-if="gameStore.state.kickSkill && kickElectionTargets.length === 0"
          :key="'kick-wait-' + gameStore.state.kickSkill.seq" class="yesno-card">
          <div class="yesno-text">Kicking coach deciding whether to use Kick…</div>
        </div>
        <!-- DialogKickSkillHandler.java:25-58: choose the server-sent semantic square; never echo a coordinate. -->
        <button v-for="target in kickElectionTargets" :key="`${target.key}:${target.choice}`"
          class="kick-election-target"
          :class="{ reduced: target.choice === 'kick', boundary: !target.onPitch, icon: target.iconOnly, stacked: target.stackIndex > 0 }"
          :style="{ left: target.x + 'px', top: target.y + 'px' }"
          :aria-label="`${target.label} landing at ${target.raw[0]}, ${target.raw[1]}`"
          :title="`${target.label} landing [${target.raw[0]},${target.raw[1]}]`"
          @click.stop="chooseKickElection(target)">
          <template v-if="target.choice === 'kick'">
            <img v-if="kickElectionIconUrl && !kickElectionIconFailed" :src="kickElectionIconUrl" alt="Kick"
              @error="kickElectionIconFailed = true" />
            <span v-else class="kick-election-k">K</span>
            <span v-if="!target.onPitch" class="kick-election-label">Kick</span>
          </template>
          <span v-else-if="!target.onPitch" class="kick-election-label">Normal</span>
        </button>

        <!-- #94: persistent blitz-used badges — owner 09-07: drawn by the renderer on the chest row (setBlitzTokens). -->

        <!-- #114 Eye-Gouge: persistent custom icon over any player carrying the EYE_GOUGED state bit (until the
             victim's next activation clears it). Pure model function; pointer-events:none (visual only). -->

        <!-- #132 negatrait cue: a transient over-token toast naming the trait + outcome (FAIL prominent, PASS
             subtle) — the trait-naming layer over the generic feet-die. pointer-events:none (visual only). -->
        <div v-if="negatraitCue" class="negatrait-cue" :class="{ fail: !negatraitCue.successful }"
          :style="{ left: negatraitCue.x + 'px', top: negatraitCue.y + 'px' }">{{ negatraitCue.text }}</div>

        <!-- #58 SYNCHRONOUS_MULTI_BLOCK: a ring on every selectable (dice-decorated) block target + a bright SELECTED
             ring on the 1-2 chosen. pointer-events:none so the click passes to the token (onPlayerClick → toggle). -->
        <div v-for="(m, i) in multiBlockMarkers" :key="'mb-' + i" class="mb-target" :class="{ selected: m.selected }"
          :style="{ left: m.x + 'px', top: m.y + 'px' }"></div>

        <!-- Blitz and Gaze share the target-declaration prompt anchored over the acting player. -->
        <div v-if="o66TargetDeclarePos && targetDeclarePrompt" class="blitz-target-prompt"
          :style="{ left: o66TargetDeclarePos.x + 'px', top: o66TargetDeclarePos.y + 'px' }">{{ targetDeclarePrompt }}</div>

        <!-- #207/SR-241: NEW pre-roll surface. The planner has already held the chosen target, but no block command
             has fired. Only the four property-derived offers carried by the store are rendered; a plain player never
             mounts this modal. The normal Blitz declare already happened; the choice changes only clientBlock's
             existing USING_* flavor flag. -->
        <BlockAttackConfirmModal v-if="blockAttackConfirm" :preview="blockAttackConfirm.preview"
          :target-name="blockAttackConfirm.targetName" @confirm="confirmAggroStage()"
          @cancel="o66AggroStage = null" />
        <div v-if="gameStore.state.blitzBlockChoice && !chainsawBlitzConfirm" class="block-alt-modal"
          :style="reactivePromptStyle('blockAlternative')" title="Drag to move"
          @pointerdown="startReactivePromptDrag('blockAlternative', $event)">
          <div class="block-alt-title">Choose the {{ gameStore.state.blitzBlockChoice.origin === 'blitz' ? 'blitz' : 'block' }} attack</div>
          <div class="block-alt-actions">
            <button @click="chooseBlitzBlockAlternative(null)">🛡️ Block</button>
            <button v-for="offer in gameStore.state.blitzBlockChoice.offers" :key="offer.kind"
              @click="chooseBlitzBlockAlternative(offer.kind as BlockKind)">
              {{ BLOCK_KIND_EMOJI[offer.kind as BlockKind] }} {{ offer.label }}
              <small v-if="blockAlternativeArmourTarget(gameStore.game.value!, gameStore.state.blitzBlockChoice.targetId, offer.kind as BlockKind) != null">
                Armour {{ blockAlternativeArmourTarget(gameStore.game.value!, gameStore.state.blitzBlockChoice.targetId, offer.kind as BlockKind) }}+
              </small>
            </button>
          </div>
        </div>
        <PitchConfirmationPanel v-if="gameStore.state.blitzBlockChoice && chainsawBlitzConfirm"
          title="Chainsaw Attack?" label="Chainsaw attack confirmation"
          :position-style="reactivePromptStyle('blockAlternative')" draggable
          @drag-start="startReactivePromptDrag('blockAlternative', $event)">
          <!-- Display only: +3 comes from upstream skill/bb2025/Chainsaw.java:47; kick-back on 1 is server-owned. -->
          Armour {{ chainsawBlitzTarget ?? '—' }}+ · kick-back on 1
          <template #actions>
            <button @click="chainsawBlitzConfirm = false">Back</button>
            <button class="danger" @click="confirmChainsawBlitz()">Use Chainsaw</button>
          </template>
        </PitchConfirmationPanel>

        <!-- Owner o66aj/o66an: interactive kick placement — a top-centre MODAL tells the kicking coach to aim
             (the ball crosshair then follows the pointer over eligible squares). -->
        <div v-if="gameStore.state.kickPlacement" class="kick-aim-modal">
          <span class="kick-aim-modal-title">KICK-OFF</span>
          <span class="kick-aim-modal-text">Choose a square to kick to</span>
        </div>

        <!-- Owner o66aa: 2-click target cue — 🏈 over a pass/hand-off target, 🥾 AV+ over a foul victim. -->
        <!-- Block, Foul, and Gaze cues confirm the same pending target as the bottom bar / Space. -->
        <div v-if="o66TargetCue && !o66PendingPunt" class="o66-target-cue" :class="{ clickable: !!o66AggroStage || !!o66PendingFoul || canConfirmPendingGaze, 'pass-destination': o66TargetCue.throwRoll != null }"
          :style="{ left: o66TargetCue.x + 'px', top: o66TargetCue.y + 'px' }"
          @click="o66AggroStage ? confirmAggroStage() : ((o66PendingFoul || canConfirmPendingGaze) && o66ConfirmPending())">
          <span class="o66-target-icon">{{ o66TargetCue.label }}</span>
          <span v-if="o66TargetCue.throwRoll != null" class="o66-target-pass-roll">Pass
            <D6Face class="o66-target-d6" :value="o66TargetCue.throwRoll" :label="`Pass needs ${o66TargetCue.throwRoll}`" />+
          </span>
        </div>

        <PitchConfirmationPanel v-if="gameStore.state.wizardTargetConfirm" title="Cast Zap?"
          label="Zap target confirmation" compact>
          {{ gameStore.state.wizardTargetConfirm.playerName }} — Zap requires
          <D6Face :value="gameStore.state.wizardTargetConfirm.requiredRoll"
            :label="`Zap needs ${gameStore.state.wizardTargetConfirm.requiredRoll}`" />+
          <template #actions>
            <button class="rr-use" @click="gameStore.confirmWizardTarget()">Confirm</button>
            <button class="rr-decline" @click="gameStore.cancelWizardTarget()">Cancel</button>
          </template>
        </PitchConfirmationPanel>
        <!-- Owner ⑩ / W29: pass/bomb targeting tooltip — throw N+ and catch M+ for a standing target-square catcher
             square during free-select. Voss draws the crosshair/arrow; this is the roll surface. Pointer-transparent. -->
        <div v-if="passBombHoverTip" class="pass-hover-tip"
          :style="{ left: passBombHoverTip.x + 'px', top: passBombHoverTip.y + 'px' }">
          <span class="pht-throw">🎯 <D6Face class="pass-hover-d6" :value="passBombHoverTip.throwRoll" :label="`Pass needs ${passBombHoverTip.throwRoll}`" />+</span>
          <span v-if="passBombHoverTip.catchRoll != null" class="pht-catch">🧤 <D6Face class="pass-hover-d6" :value="passBombHoverTip.catchRoll" :label="`Catch needs ${passBombHoverTip.catchRoll}`" />+</span>
        </div>
        <div v-if="hailMaryPassHintVisible" class="hmp-hint">Hail Mary Pass Activated -- Choose any square to target</div>
        <!-- Punt UX v2 (owner 08-12): draggable confirm card at the renderer's live cone centre (#237 idiom —
             re-anchors on re-aim unless the user has dragged it; hidden the instant puntConeCenter() goes null). -->
        <PitchConfirmationPanel v-if="puntConeAnchor && o66PendingPunt" title="🏈 Punt"
          label="Punt confirmation" :position-style="reactivePromptStyle('puntConfirm')" draggable
          @drag-start="startReactivePromptDrag('puntConfirm', $event)">
          Aim with the direction controls, then confirm.
          <template #actions>
            <ConfirmActionButton class="pc-confirm" placement="inline" label="Confirm Punt"
              :shortcut-code="settings.confirmKey" @activate="confirmPuntV2()" />
          </template>
        </PitchConfirmationPanel>
        <!-- Owner ② (08-13): at-punter direction picker; each screen-space arrow directly selects a server-offered aim. -->
        <div v-if="puntReaimAnchor && o66PendingPunt && puntDirectionChoices.length" class="punt-reaim-pad"
          :style="{ left: puntReaimAnchor.x + 'px', top: puntReaimAnchor.y + 'px' }">
          <button v-for="choice in puntDirectionChoices" :key="choice.direction" type="button"
            class="prp-nudge" :class="'prp-' + choice.direction" :title="`Aim ${choice.direction}`"
            @click="selectPuntDirection(choice.square)">{{ choice.arrow }}</button>
        </div>
        <!-- The Jump badge is a server-state ON indicator and off-switch; the context menu remains the offer. -->
        <div v-if="jumpTogglePos" class="jump-toggle on"
          :style="{ left: jumpTogglePos.x + 'px', top: jumpTogglePos.y + 'px' }"
          :title="`${jumpGerund} — click to turn off`"
          @click="gameStore.toggleJump()">🦘 {{ jumpGerund }}</div>

        <!-- #236: server-confirmed Fumblerooski election badge. StepInitMoving.java:270-278 emits ballMoving=true +
             ReportFumblerooskie(used=true) without entering a picker; StepResetFumblerooskie.java:89-117 emits the
             false edge and, when the standing mover keeps the ball, used=false + pickup. The computed above
             intersects those echoes with the same actor, so this cannot survive cancellation or activation end. -->
        <div v-if="fumblerooskiePos" class="jump-toggle on fumblerooskie-badge"
          :style="{ left: fumblerooskiePos.x + 'px', top: fumblerooskiePos.y + 'px' }"
          title="Fumblerooski is active; keep moving to leave the ball behind">🏈 Fumblerooski active</div>

        <!-- Owner 2026-07-04 (interaction catalog 28, PRIORITY): follow-up chip card
             at the block square (offset so the square stays visible); the passive
             shared passive variant carries no buttons. -->
        <div v-if="gameStore.state.followupChoice && followupPos" class="followup-chip"
          :style="reactivePromptStyle('followup', { x: followupPos.x, y: followupPos.y })"
          title="Drag to move" @pointerdown="startReactivePromptDrag('followup', $event)">
          <div class="fu-title">Follow up?</div>
          <div class="fu-actions">
            <button class="fu-btn follow" @click="answerFollowup(true)">Follow up</button>
            <button class="fu-btn stay" @click="answerFollowup(false)">Stay</button>
          </div>
        </div>
        <!-- Owner 2026-07-06: the passive toast mounts to the player's HEAD — centred
             over it and sitting just above (translate -50%,-100%) so it's clear who
             is staying / following. -->
        <div v-else-if="gameStore.state.followupIndicator && followupPos" class="followup-chip passive head-mounted"
          :style="{ left: followupPos.x + 'px', top: followupPos.y + 'px' }">
          <div class="fu-title">
            {{ gameStore.state.followupIndicator.playerName }}
            {{ gameStore.state.followupIndicator.followed ? 'follows up' : 'stays' }}
          </div>
        </div>

        <!-- B4-1/B6-1: BB3-style injury banner, tinted + logo'd by the
             injured player's team (end-color convention: home blue, away red).
             Owner 2026-07-08 (queue 3): a KNOCKOUT skips the banner — it shows the
             compact token-anchored toast below instead. Phase 3b: a STUN also skips the
             banner when Settings → Display · Stun display = 'tag'. -->
        <div v-if="gameStore.state.injurySplash && injuryIsCasualty && settings.casualtySplash" class="injury-splash"
          :class="{ 'inj-under-splash': !!gameStore.state.turnover || !!gameStore.state.turnStart }"
          :data-side="gameStore.state.injurySplash.side">
          <div class="injury-team">
            <img class="injury-logo" :src="splashTeamLogo(gameStore.state.injurySplash.side, gameStore.state.injurySplash.logoUrl)" alt="" />
            <span class="injury-teamname">{{ gameStore.state.injurySplash.teamName }}</span>
          </div>
          <div class="injury-text">
            <!-- #64 (owner): the SPLIT taxonomy from the store (8a7b6a59) — the injury-roll result as a small header
                 + the CASUALTY-ROLL 5-step severity (+ the Lasting-Injury D6 stat) as the big line, replacing the
                 old conflated base-state `type` label (which flattened Seriously Hurt/Serious Injury/Lasting Injury
                 all to "SERIOUS INJURY"). Falls back to `type` if a casualty label is somehow absent. -->
            <span v-if="gameStore.state.injurySplash.injuryRoll" class="injury-roll">{{ gameStore.state.injurySplash.injuryRoll }}</span>
            <span class="injury-type">{{ gameStore.state.injurySplash.casualty?.label ?? gameStore.state.injurySplash.type
              }}<span v-if="gameStore.state.injurySplash.casualty?.stat" class="injury-stat"> ({{ gameStore.state.injurySplash.casualty.stat }})</span></span>
            <span class="injury-player">{{ gameStore.state.injurySplash.player }}</span>
          </div>
        </div>

        <WatchOutToast :occurrence="gameStore.state.watchOutToast"
          :player-screen-pos="modernWatchOutPlayerScreenPos" />
        <SppGainToast v-for="occurrence in gameStore.state.sppToasts" :key="occurrence.seq"
          :occurrence="occurrence" :player-screen-pos="modernPlayerHeadScreenPos" />

        <!-- Owner 2026-07-08 (queue 3): KNOCKOUT toast — bound to the injured
             player's TOKEN (RAF-follow via renderer.playerScreenPos), so it reads
             right at the square where the KO occurred. -->
        <div v-if="gameStore.state.injurySplash && !injuryIsStunTag && koToastPos.ready" class="ko-toast"
          :class="{ 'is-casualty': injuryIsCasualty }"
          :data-side="gameStore.state.injurySplash.side"
          :style="{ left: koToastPos.x + 'px', top: (koToastPos.y - 58) + 'px' }">
          <!-- Owner 2026-07-08: a CASUALTY names the specific injury (server-resolved result);
               KO keeps the compact K.O. + name. -->
          <template v-if="injuryIsRockImpact">
            <span class="ko-toast-phrase">{{ gameStore.state.injurySplash.player }} is hit by a rock!</span>
          </template>
          <template v-else-if="injuryIsCasualty">
            <span class="ko-toast-phrase">{{ casualtyPhrase }}</span>
          </template>
          <template v-else>
            <span class="ko-toast-type">{{ injuryIsKo ? 'K.O.' : gameStore.state.injurySplash.type }}</span>
            <span class="ko-toast-player">{{ gameStore.state.injurySplash.player }}</span>
          </template>
        </div>

        <!-- Owner 2026-07-08 (pipeline Phase 3b): STUN token TAG — the lightweight
             alternative to the banner (Settings → Display · Stun display = 'tag').
             Token-anchored like the KO toast; reads and clears fast (1200ms). -->
        <div v-if="gameStore.state.injurySplash && injuryIsStunTag && koToastPos.ready" class="stun-tag"
          :data-side="gameStore.state.injurySplash.side"
          :style="{ left: koToastPos.x + 'px', top: (koToastPos.y - 50) + 'px' }">
          <span class="stun-tag-type">STUNNED</span>
          <span class="stun-tag-player">{{ gameStore.state.injurySplash.player }}</span>
        </div>

        <!-- Owner 2026-07-08: FALLS OVER toast — a failed Dodge / Rush knocks the player
             over. One token-anchored toast for both causes (no emoji), reads + clears fast. -->
        <div v-if="fallOverVisible && gameStore.state.fallOver && fallOverPos.ready" class="fall-toast"
          :style="{ left: fallOverPos.x + 'px', top: fallOverPos.y + 'px' }">
          <span class="fall-toast-type">Falls over!</span>
        </div>

        <!-- Turn-boundary occupancy stack. The banner row is always reserved while the notifier is live,
             so the simultaneous turnover/turn-start + incoming-coach toast cannot cover each other. -->
        <div v-if="gameStore.state.turnover || gameStore.state.turnStart || gameStore.state.turnToast"
          class="turn-boundary-stack">
          <div class="turn-boundary-banner-slot">
            <!-- Owner 2026-07-03: turnover splash — the team that lost its turn to a
                 failed action. Raised after the other animations settle; the incoming
                 coach notifier occupies the deterministic row immediately below. -->
            <div v-if="gameStore.state.turnover" :key="gameStore.state.turnover.seq"
              class="turnover-splash" :data-side="gameStore.state.turnover.side"
              @pointerdown.stop @pointerup.stop @click.stop>
              <img class="turnover-logo" :src="splashTeamLogo(gameStore.state.turnover.side, gameStore.state.turnover.logo)" alt="" />
              <div class="turnover-text">
                <span class="turnover-coach">{{ gameStore.state.turnover.coach || gameStore.state.turnover.teamName }}</span>
                <span class="turnover-head">HAS TURNED OVER</span>
              </div>
            </div>

            <!-- Owner 2026-07-05: voluntary turn-start splash, on the same exclusive banner row. -->
            <div v-else-if="gameStore.state.turnStart && !inKickoffDrivePhase"
              :key="'ts-' + gameStore.state.turnStart.seq"
              class="turnstart-splash" :data-side="gameStore.state.turnStart.side"
              @pointerdown.stop @pointerup.stop @click.stop>
              <img class="turnover-logo" :src="splashTeamLogo(gameStore.state.turnStart.side, gameStore.state.turnStart.logo)" alt="" />
              <div class="turnover-text">
                <span class="turnstart-head">{{ (gameStore.state.turnStart.coach || gameStore.state.turnStart.teamName) }}'s turn</span>
              </div>
            </div>
          </div>

          <!-- The shared notifier renders Modern play/spectate/replay and Classic from the same store cue. -->
          <TurnToast v-if="gameStore.state.turnToast" :key="'tt-' + gameStore.state.turnToast.seq"
            :toast="gameStore.state.turnToast" />
        </div>

        <!-- #51 + #43 (owner tester, P2): STALLER splash — "<Player> could be stalling!" on the server's
             ReportStallerDetected (transient one-shot off state.stallerDetected.seq; #43 pacing = the CSS
             splash→hold→settle lifecycle). Keyed on seq so a re-detection next turn re-animates. -->
        <div v-if="stallerSplash" :key="'stall-' + stallerSplash.seq" class="staller-splash">
          <span class="staller-icon">⏱</span>
          <span class="staller-text"><b>{{ stallerSplash.player }}</b> could be stalling!</span>
        </div>

        <!-- #230 (owner FINAL): the floating action-lock PILL is removed — "Opponent's Turn" now reads off the
             relabelled End Turn button instead. The FUNCTIONAL #173 gate (`actionLock`) is untouched; only this
             visual affordance + its `actionLockCopy` copy computed are gone. -->

        <!-- #139 (owner): Master Chef pregame splash — a center banner naming the re-roll steal (team-level flourish,
             no token anchor). View-timed (masterChefSplashVisible, 4.2s); the log line lands standalone via reportFormatter. -->
        <div v-if="masterChefSplashVisible && gameStore.state.masterChefSplash" :key="'mc-' + gameStore.state.masterChefSplash.seq"
          class="masterchef-splash">
          <span class="masterchef-icon">🍲</span>
          <span class="masterchef-head">{{ gameStore.state.masterChefSplash.team }}'s Master Chef steals
            {{ gameStore.state.masterChefSplash.stolen }} re-roll{{ gameStore.state.masterChefSplash.stolen === 1 ? '' : 's' }}!</span>
        </div>

        <!-- owner ruling 08-17: Riotous Rookies splash — mirrors the Master Chef splash above (same component/style,
             same timing hookup). View-timed (riotousRookiesSplashVisible, 4.2s); the log line lands standalone via
             reportFormatter. DISPLAY-ONLY — the hired players land via serverAddPlayer, not this splash. -->
        <div v-if="riotousRookiesSplashVisible && gameStore.state.riotousRookiesSplash" :key="'rr-' + gameStore.state.riotousRookiesSplash.seq"
          class="masterchef-splash">
          <span class="masterchef-icon">🤡</span>
          <span class="masterchef-head">{{ gameStore.state.riotousRookiesSplash.coach }} hires
            {{ gameStore.state.riotousRookiesSplash.amount }} riotous rookie{{ gameStore.state.riotousRookiesSplash.amount === 1 ? '' : 's' }}!</span>
        </div>

        <!-- Prayer lifetime belongs to the store FIFO: one banner at a time, then any interactive prayer dialog. -->
        <PrayerPresentation :announcement="gameStore.state.prayerAnnounce" :wait="null" :portrait="prayerRecipientPortrait" />

        <!-- #136 (owner): opponent-left connection toast — a player left the game (view-timed, ~6.5s). -->
        <div v-if="opponentLeftVisible && gameStore.state.opponentLeft" :key="'ol-' + gameStore.state.opponentLeft.seq"
          class="opponent-left-toast">
          <span class="opponent-left-icon">⚠</span>
          <span class="opponent-left-text"><b>{{ gameStore.state.opponentLeft.coach }}</b> has left the game — waiting to reconnect…</span>
        </div>

        <!-- g314/g315 (owner, de-escalated to icon-scale — this was firing as a full P1-style
             splash for a routine in-turn event; a reroll isn't match-level like a turnover/turn
             boundary, event-priority.md's P2 "informational toast" tier fits). Compact toast,
             same idiom as .turn-toast (side-tinted, same corner). -->
        <div v-if="gameStore.state.rerollSplash" :key="'rr-' + gameStore.state.rerollSplash.seq"
          class="reroll-toast" :data-side="gameStore.state.rerollSplash.side" :style="rerollSplashAnchorStyle">
          <img v-if="gameStore.state.rerollSplash.isTeam" class="reroll-toast-icon" :src="resourceIcon('re_roll')" alt="" />
          <img v-else class="reroll-toast-icon" :src="splashTeamLogo(gameStore.state.rerollSplash.side, gameStore.state.rerollSplash.logo)" alt="" />
          <span class="reroll-toast-text">{{ gameStore.state.rerollSplash.text ?? `${gameStore.state.rerollSplash.coach} uses ${gameStore.state.rerollSplash.source}!` }}</span>
        </div>

        <!-- U5 (owner UX ruling 08-11): while a Fumblerooski election is live (ball dropped, drops on the next
             move) surface a top banner below the scoreboard so the coach knows the ball is about to fall. Driven
             off fumblerooskieActive (the existing election signal), so it clears the instant the ball settles. -->
        <div v-if="fumblerooskieActive" class="fumblerooskie-banner">Ball will drop on the next move.</div>

        <ul v-if="ctxMenu.visible" class="context-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
          <li v-for="(item, i) in ctxMenu.items" :key="i" :data-disabled="item.disabled ?? false"
            :data-parent="!!item.children" :title="item.hint" @click="runMenuItem(item)">
            <img v-if="item.icon" class="ctx-item-icon" :src="item.icon" alt="" />{{ item.label }}<span v-if="item.children" class="submenu-arrow">▸</span>
            <ul v-if="item.children" class="submenu">
              <li v-for="(child, j) in item.children" :key="j" :data-disabled="child.disabled ?? false"
                :title="child.hint" @click.stop="runMenuItem(child)">{{ child.label }}</li>
            </ul>
          </li>
        </ul>

        <!-- Owner 2026-07-05: BB2025 block PARTIAL re-roll — options to the LEFT of the
             team-reroll logo; dice become clickable to accept, or (in Pro/Consummate
             mode) to choose which die to re-roll. -->
        <div v-if="gameStore.state.blockPartial" class="block-partial"
          :style="reactivePromptStyle('blockPartial', blockRerollPos ?? undefined)"
          title="Drag to move" @pointerdown="startReactivePromptDrag('blockPartial', $event)">
          <BlockChooserCopy v-if="blockChooserCaptionTeamId != null" :game="gameStore.game.value"
            :choosing-team-id="blockChooserCaptionTeamId" :local-seat="blockChooserSeat"
            :spectator="blockChooserSpectator" />
          <!-- #38 (owner tester): uphill-block label ABOVE the dice on any uphill (nrOfDice<0).
               The other string ("Waiting for reroll decision") is spec'd to Tarkin — it needs an
               `opponentRerollPending` store signal (the defender's phase-1 wait isn't derivable from the
               current fields). -->
          <div v-if="gameStore.state.blockPartial.nrOfDice < 0" class="bp-uphill">
            <div class="bp-uphill-title">UPHILL BLOCK</div>
          </div>
          <div ref="bpDiceHost" class="bp-dice">
            <button v-for="(d, i) in bpDiceShown" :key="i"
              class="bp-die" :class="{ 'bp-die-art': settings.order66, 'bp-die-tumbling': bpTumbling, 'bp-die-3d': bpDice3dLive, 'bp-die-selected': !bpTumbling && bpSelectedDice.has(i), 'bp-die-choice': !bpTumbling && gameStore.state.blockPartial.choiceIndex === i }" :data-armed="!!bpDieMode"
              :aria-pressed="bpDieMode === 'multiBlockDice' ? bpSelectedDice.has(i) : undefined"
              :data-readonly="!blockDialogMine || (bpPhase1ReRollOnly && !bpDieMode)"
              :disabled="bpTumbling || !blockDialogMine || (bpPhase1ReRollOnly && !bpDieMode)"
              :title="bpDieMode === 'multiBlockDice' ? (bpSelectedDice.has(i) ? 'Remove this die' : 'Select this die') : (bpDieMode ? 'Re-roll this die' : (bpUphillDecision ? blockFaceLabel(d) + ' — awaiting the chooser' : (settings.order66 ? blockFaceLabel(d) : 'Keep this die')))"
              @click="clickBlockPartialDie(i)">
              <img v-if="settings.order66" :src="blockFaceUrl(d)" :alt="blockFaceLabel(d)" />
              <template v-else>{{ blockFaceLabel(d) }}</template>
            </button>
          </div>
          <!-- #38 (owner tester): "Waiting for reroll decision" BELOW the dice while the opponent's re-roll
               decision is pending on an uphill block. Consumes Tarkin's `opponentRerollPending` (fef6e22c). -->
          <div v-if="gameStore.state.blockPartial.opponentRerollPending" class="bp-uphill-wait">Waiting for reroll decision</div>
          <!-- Owner 09-07: watcher-side cue — the chooser still holds a TEAM re-roll (same art as the live button,
               display-only), so a spectator/opponent reads a pause as a re-roll debate. -->
          <div v-if="!blockDialogMine && gameStore.state.blockPartial.chooserTeamRerollAvailable" class="bp-actions bp-actions--watch"
            title="The choosing coach may still use a team re-roll">
            <span class="bp-team bp-team--watch">
              <img :src="resourceIcon('re_roll')" alt="Team re-roll available" />
              <span v-if="blockPartialTeamReRolls !== null" class="rr-trr-num bp-trr-num">{{ blockPartialTeamReRolls }}</span>
            </span>
          </div>
          <div v-if="blockDialogMine" class="bp-actions">
            <!-- partial-reroll options (skill icon when icons enabled, else text) -->
            <button v-for="opt in blockPartialOptions" :key="opt.kind" class="bp-opt"
              :data-active="bpDieMode === opt.kind" :title="opt.label" @click="useBlockPartialOption(opt.kind)">
              <img v-if="settings.skillDisplay === 'icons' && skillIconUrl(opt.skill, effectiveIconStyle)"
                :src="skillIconUrl(opt.skill, effectiveIconStyle)!" :alt="opt.label" />
              <span v-else>{{ opt.label }}</span>
            </button>
            <!-- team re-roll LOGO (inducement art), to the RIGHT of the options. Owner 2026-07-12: a MASCOT
                 SUPERSEDES the plain team button (upstream DialogReRollProperties) — suppress it when present. -->
            <button v-if="gameStore.state.blockPartial.teamRR && !gameStore.state.blockPartial.mascot"
              class="bp-team" title="Team re-roll" @click="gameStore.resolveBlockPartial('team')">
              <img :src="resourceIcon('re_roll')" alt="Team re-roll" />
              <!-- #205: acting coach's team-reroll count, immediately beside the die icon (owner idiom).
                   Display-only chip; the resolve('team') answer path is untouched. -->
              <span v-if="blockPartialTeamReRolls !== null" class="rr-trr-num bp-trr-num"
                :title="`Team re-rolls available: ${blockPartialTeamReRolls}`">{{ blockPartialTeamReRolls }}</span>
            </button>
            <!-- Owner 2026-07-12: distinct Team Mascot re-roll (own art) + the Mascot-then-TRR variant. -->
            <button v-if="gameStore.state.blockPartial.mascot" class="bp-team bp-mascot"
              title="Team Mascot (no re-roll if it fails)" @click="gameStore.resolveBlockPartial('mascot')">
              <img :src="resourceIcon('team_mascot')" alt="Team Mascot" />
              <span class="bp-sub">No TRR</span>
            </button>
            <button v-if="gameStore.state.blockPartial.mascotTrr" class="bp-opt"
              title="Team Mascot, then Team Re-roll if it fails" @click="gameStore.resolveBlockPartial('mascotTrr')">
              <span>Mascot + RR</span>
            </button>
            <!-- Owner 2026-07-12 (bug, upstream-client-verified): o66 uphill phase-1 — the attacker declines the
                 re-roll; upstream's "No Re-Roll" sends sendUseReRoll(BLOCK, null), then the SERVER flips the pick
                 to the defender (DialogBlockRollProperties buttonNoReRoll → the null-source branch). -->
            <button v-if="bpUphillDecision" class="bp-opt bp-decline"
              title="Decline re-roll — the chooser then picks the block die" @click="gameStore.resolveBlockPartial('declineReroll')">
              <span>Decline re-roll</span>
            </button>
          </div>
          <div v-if="blockDialogMine && bpDieMode === 'multiBlockDice'" class="bp-hint bp-multi-select">
            <span>Select one or more dice.</span>
            <button class="bp-opt" :disabled="bpSelectedDice.size < 1" @click="commitMultiBlockDice">Re-roll selected</button>
          </div>
          <div v-else-if="blockDialogMine && bpDieMode" class="bp-hint">Click a die to re-roll it ({{ bpDieMode }})</div>
          <div v-else-if="blockDialogMine && bpUphillDecision" class="bp-hint">Uphill block — use a re-roll or decline; the chooser picks the die.</div>
        </div>

        <PrayerPresentation :announcement="null" :wait="gameStore.state.prayerChoiceWait" />

        <!-- #58 SYNCHRONOUS multi-block resolution: one dice row per target (state.multiBlockResolution.rolls, Tarkin
             cbd0f598). A click on a die for a coach-pickable target sends the plain choice → resolves that target
             (answers the reRollBlockForTargets dialog TK g748 wedged on). Reuses the .bp-die block-face art. The
             re-roll affordances (team/pro/brawler/consummate) are a fast-follow — invocation being pinned w/ Tarkin. -->
        <div v-if="gameStore.state.multiBlockResolution" class="multi-block-resolution"
          :style="reactivePromptStyle('multiBlock')" title="Drag to move"
          @pointerdown="startReactivePromptDrag('multiBlock', $event)">
          <div class="mbr-title">MULTIPLE BLOCK</div>
          <BlockChooserCopy v-if="liveMultiBlockChoiceDialog" :game="gameStore.game.value"
            :choosing-team-id="liveMultiBlockChoosingTeamId" :local-seat="blockChooserSeat"
            :spectator="blockChooserSpectator" />
          <div v-for="row in multiBlockRows" :key="row.targetId" class="mbr-row">
            <span class="mbr-name">{{ row.name }}</span>
            <div class="mbr-dice">
              <button v-for="(d, i) in row.dice" :key="i" class="bp-die"
                :class="{ 'bp-die-art': settings.order66, 'mbr-picked': row.selectedIndex === i }"
                :data-armed="mbrDieMode?.targetId === row.targetId"
                :data-readonly="!multiBlockDialogMine || row.isOwnChoice !== true || (!row.pickable && mbrDieMode?.targetId !== row.targetId)"
                :disabled="!multiBlockDialogMine || (mbrDieMode?.targetId !== row.targetId && (row.isOwnChoice !== true || !row.pickable))"
                :title="mbrDieMode?.targetId === row.targetId ? 'Re-roll this die' : (row.isOwnChoice === true && row.pickable ? blockFaceLabel(d) : blockFaceLabel(d) + ' — not selectable in this phase')"
                @click="multiBlockPickDie(row.targetId, i, row.isOwnChoice === true && row.pickable)">
                <img v-if="settings.order66" :src="blockFaceUrl(d)" :alt="blockFaceLabel(d)" />
                <template v-else>{{ blockFaceLabel(d) }}</template>
              </button>
            </div>
            <!-- per-target re-roll affordances (Tarkin recipe 114fd8c7): Pro/Consummate arm a die-select; team/mascot/
                 Brawler fire at once. Icons when enabled, else text — same as the single-block blockPartial options. -->
            <div v-if="multiBlockDialogMine" class="mbr-actions">
              <button v-if="row.brawler" class="bp-opt" title="Brawler" @click="multiBlockReroll(row.targetId, 'brawler', row.dice.length)">
                <img v-if="settings.skillDisplay === 'icons' && skillIconUrl('Brawler', effectiveIconStyle)" :src="skillIconUrl('Brawler', effectiveIconStyle)!" alt="Brawler" />
                <span v-else>Brawler</span>
              </button>
              <!-- Hatred (Single Skull → Hatred, upstream Hatred.java): fires immediately like Brawler above —
                   answered CLIENT_USE_HATRED via sendMultiBlockHatred, not the generic reRollSource path. -->
              <button v-if="row.singleSkullLabel" class="bp-opt" :title="row.singleSkullLabel" @click="gameStore.sendMultiBlockHatred(row.targetId)">
                <img v-if="settings.skillDisplay === 'icons' && skillIconUrl(row.singleSkull ?? row.singleSkullLabel, effectiveIconStyle)" :src="skillIconUrl(row.singleSkull ?? row.singleSkullLabel, effectiveIconStyle)!" :alt="row.singleSkullLabel" />
                <span v-else>{{ row.singleSkullLabel }}</span>
              </button>
              <button v-if="row.pro" class="bp-opt" :data-active="mbrDieMode?.targetId === row.targetId && mbrDieMode?.kind === 'pro'"
                title="Pro" @click="multiBlockReroll(row.targetId, 'pro', row.dice.length)">
                <img v-if="settings.skillDisplay === 'icons' && skillIconUrl('Pro', effectiveIconStyle)" :src="skillIconUrl('Pro', effectiveIconStyle)!" alt="Pro" />
                <span v-else>Pro</span>
              </button>
              <button v-if="row.consummate" class="bp-opt" :data-active="mbrDieMode?.targetId === row.targetId && mbrDieMode?.kind === 'consummate'"
                :title="row.consummateLabel ?? 'Consummate Professional'" @click="multiBlockReroll(row.targetId, 'consummate', row.dice.length)">
                <img v-if="settings.skillDisplay === 'icons' && skillIconUrl('Consummate Professional', effectiveIconStyle)" :src="skillIconUrl('Consummate Professional', effectiveIconStyle)!" :alt="row.consummateLabel ?? 'Consummate'" />
                <span v-else>Consummate</span>
              </button>
              <!-- Savage Blow (star program): reroll-ALL-dice election — rerolls the WHOLE block-dice pool at once,
                   NOT a single-die pick (canReRollAnyNumberOfBlockDice). Distinct affordance = the source icon + an
                   "ALL" badge + "re-roll ALL dice" tooltip. Gated on the server-recognized source (row.multiBlockDiceLabel,
                   Tarkin 8dde2dec); reuses the send via multiBlockRerollAllDice (source verbatim, zero new wire). -->
              <button v-if="row.multiBlockDiceLabel" class="bp-opt bp-savage"
                :title="`${row.multiBlockDiceLabel} — re-roll ALL dice`"
                @click="multiBlockRerollAllDice(row.targetId, row.multiBlockDice, row.dice.length)">
                <img v-if="settings.skillDisplay === 'icons' && skillIconUrl(row.multiBlockDice ?? row.multiBlockDiceLabel, effectiveIconStyle)"
                  :src="skillIconUrl(row.multiBlockDice ?? row.multiBlockDiceLabel, effectiveIconStyle)!" :alt="row.multiBlockDiceLabel" />
                <img v-else :src="resourceIcon('re_roll')" alt="re-roll" />
                <span class="bp-sub">ALL</span>
              </button>
              <button v-if="row.teamRR && !row.mascot" class="bp-team" title="Team re-roll" @click="multiBlockReroll(row.targetId, 'team', row.dice.length)">
                <img :src="resourceIcon('re_roll')" alt="Team re-roll" />
                <!-- #205: acting coach's team-reroll count beside the die icon (owner idiom). Display-only;
                     the multiBlockReroll('team') answer path is untouched. -->
                <span v-if="multiBlockTeamReRolls !== null" class="rr-trr-num bp-trr-num"
                  :title="`Team re-rolls available: ${multiBlockTeamReRolls}`">{{ multiBlockTeamReRolls }}</span>
              </button>
              <button v-if="row.mascot" class="bp-team bp-mascot" title="Team Mascot (no re-roll if it fails)" @click="multiBlockReroll(row.targetId, 'mascot', row.dice.length)">
                <img :src="resourceIcon('team_mascot')" alt="Team Mascot" />
                <span class="bp-sub">No TRR</span>
              </button>
            </div>
          </div>
          <div v-if="multiBlockDialogMine && mbrDieMode" class="bp-hint">Click a die to re-roll it ({{ mbrDieMode.kind }})</div>
        </div>

        <!-- Owner o66d: the legacy action hotbar is redundant in Order 66 (the context menu drives declares) —
             hide it so it doesn't clutter o66 play. Flag OFF → unchanged. -->
        <nav v-if="hasSelection && !settings.spectatorClean && !settings.order66" class="hotbar">
          <button v-for="(action, i) in hotbarActions" :key="action.mode"
            :data-active="actionMode === action.mode" :data-used="action.used" :disabled="action.used"
            :title="action.used ? `${action.label} — used this turn` : `${action.label} (${i + 1})`"
            @click="setAction(action.mode)">
            <span class="hotbar-emoji">{{ action.icon }}</span>
            <span class="hotbar-nr">{{ i + 1 }}</span>
            <span class="hotbar-label">{{ action.label }}</span>
            <span v-if="action.used" class="hotbar-used">USED</span>
          </button>
        </nav>

        <div v-if="toast.visible" class="action-toast" :class="{ below: toast.below }" :style="{ left: toast.x + 'px', top: toast.y + 'px' }">
          {{ toast.text }}
        </div>

        <!-- Owner 2026-07-04c: foul/handoff/pass hover roll tip (beside the cursor) -->
        <div v-if="actionTip.visible" class="action-roll-tip" :data-mode="actionTip.mode"
          :style="{ left: actionTip.x + 'px', top: actionTip.y + 'px' }">
          <template v-if="actionTip.mode === 'foul'">
            <img :src="blockSkullUrl" class="action-roll-die" alt="skull" />{{ foulRollNumber(actionTip.text) }}
          </template>
          <template v-else v-for="(part, i) in d6RequirementParts(actionTip.text)" :key="i">
            <D6Face v-if="part.face" class="action-target-d6" :value="part.face" :label="part.label" />
            <template v-else>{{ part.text }}</template>
          </template>
        </div>

        <!-- Owner 2026-07-04c/d: armed-action confirm modal ("Perform foul?" …) —
             compact (33% smaller) + DRAGGABLE by its body (owner 2026-07-04d). -->
        <ActionTargetConfirmModal v-if="actionModal" :key="actionModal.seq" :modal="actionModal"
          :position-style="actionModalStyle" :foul-skull-url="blockSkullUrl"
          @drag-start="startActionModalDrag" @confirm="renderer?.confirmArmedAction()"
          @cancel="renderer?.cancelArmedAction()" />

        <!-- Guided tour (owner 2026-07-03 r6f): a gold arrow points at each UI
             element while a toast explains it for 3s. Overlay is click-through
             (pointer-events:none) except the toast's Skip button. -->
        <template v-if="tourActive">
          <svg class="tour-arrow" :style="tourArrowStyle" viewBox="0 0 40 40" aria-hidden="true">
            <path d="M20 3 L20 27" />
            <path d="M9 20 L20 34 L31 20" />
          </svg>
          <div class="tour-toast" :style="tourToastStyle">
            <span>{{ tourText }}</span>
            <button class="tour-skip" @click="endTour">Skip ✕</button>
          </div>
        </template>

        <!-- Failed-action reroll shows only the server-offered team/skill sources; no source means turnover. -->
        <!-- Re-roll decisions keep one stable graphical surface. Skill-marking display changes the pitch only;
             it must not replace this handler with the retired text-list variant. -->
        <!-- Owner 2026-07-08 (rev 7): also surfaces READ-ONLY in SPECTATOR mode (mine
             false → buttons inert, no decline); the coach's pick GLOWS activation-gold
             (data-chosen) before the rest of the events render. -->
        <template v-if="gameStore.state.reRollPrompt">
          <!-- #237 (owner-fg 07-29): both reroll presentations share the same manual override. -->
          <div class="block-partial reroll-bar"
            :data-spectator="!gameStore.state.reRollPrompt.mine"
            :style="reactivePromptStyle('reroll', { x: rerollMenuPos.x, y: rerollMenuPos.y + 18 })"
            title="Drag to move" @pointerdown="startReactivePromptDrag('reroll', $event)">
            <!-- #205 (owner): the title-text line ("Re-roll Pick Up?" …) is DISCARDED — the on-pitch failed
                 die already carries "what happened"; this surface is just the unified idiom: the re-roll die
                 icon + the count numeral beside it + the decline ✕. Same compact idiom as the block die-pick
                 chooser, so block re-rolls and failed-action re-rolls read identically. -->
            <!-- When a failed-action roll is present, show action label, die face, and target; compact rerolls remain unchanged. -->
            <div v-if="gameStore.state.reRollPrompt.mine" class="rr-context">
              <div class="rr-prompt-line rr-ctx-label">
                {{ gameStore.state.reRollPrompt.title }}
              </div>
              <div v-if="gameStore.state.reRollPrompt.result && !passRerollContext" class="rr-prompt-line">
                <span>Result:</span>
                <span>{{ gameStore.state.reRollPrompt.result }}</span>
              </div>
              <div v-if="gameStore.state.reRollPrompt.roll != null" class="rr-prompt-line">
                <span>You rolled:</span>
                <D6Face class="sc-die rr-ctx-die" :value="gameStore.state.reRollPrompt.roll" :label="`Rolled ${gameStore.state.reRollPrompt.roll}`" />
                <span v-if="passRerollContext">{{ passRerollContext.result }}</span>
              </div>
              <div v-if="gameStore.state.reRollPrompt.needed != null" class="rr-prompt-line">
                <span>Needed:</span>
                <span class="sc-needed"><D6Face :value="gameStore.state.reRollPrompt.needed" :label="`Needed ${gameStore.state.reRollPrompt.needed}`" />+</span>
              </div>
              <div v-if="gameStore.state.reRollPrompt.fumble && !passRerollContext" class="rr-prompt-line">Current roll is a FUMBLE.</div>
              <div v-for="(message, i) in gameStore.state.reRollPrompt.messages" :key="i" class="rr-prompt-line">{{ message }}</div>
              <div v-if="gameStore.state.reRollPrompt.loner" class="rr-prompt-line rr-loner-line">{{ rerollLonerCopy }}</div>
              <div class="rr-prompt-line rr-question">{{ gameStore.state.reRollPrompt.question }}</div>
            </div>
            <div v-else class="rr-context rr-context-spectator">
              <span class="rr-ctx-label">{{ gameStore.state.reRollPrompt.label }}</span>
              <span v-if="gameStore.state.reRollPrompt.result && !passRerollContext">Result: {{ gameStore.state.reRollPrompt.result }}</span>
              <D6Face v-if="gameStore.state.reRollPrompt.roll != null" class="sc-die rr-ctx-die"
                :value="gameStore.state.reRollPrompt.roll" :label="`Rolled ${gameStore.state.reRollPrompt.roll}`" />
              <span v-if="passRerollContext">{{ passRerollContext.result }}</span>
              <span v-if="gameStore.state.reRollPrompt.needed != null" class="sc-needed">needs <D6Face :value="gameStore.state.reRollPrompt.needed" :label="`Needed ${gameStore.state.reRollPrompt.needed}`" />+</span>
              <span v-if="gameStore.state.reRollPrompt.fumble && !passRerollContext">Current roll is a FUMBLE.</span>
              <span v-for="(message, i) in gameStore.state.reRollPrompt.messages" :key="i">{{ message }}</span>
              <span v-if="gameStore.state.reRollPrompt.loner" class="rr-loner-line">{{ rerollLonerCopy }}</span>
            </div>
            <div class="bp-actions">
              <template v-for="opt in gameStore.state.reRollPrompt.options" :key="opt.source">
                <button v-if="opt.source === 'Team ReRoll'" class="bp-team" :title="opt.label"
                  :data-chosen="gameStore.state.reRollPrompt.chosen === opt.source"
                  @click="gameStore.resolveReRoll(opt.source)">
                  <img :src="resourceIcon('re_roll')" :alt="opt.label" />
                  <!-- #205: the count numeral rides the die icon (owner idiom), identical to the block chooser. -->
                  <span v-if="rerollPromptTeamReRolls !== null" class="rr-trr-num bp-trr-num"
                    :title="`Team re-rolls available: ${rerollPromptTeamReRolls}`">{{ rerollPromptTeamReRolls }}</span>
                </button>
                <button v-else class="bp-opt" :title="opt.response === 'primal-savagery' || opt.role === 'modifier' ? `Use ${opt.label}` : `Re-roll with ${opt.label}`"
                  :data-chosen="gameStore.state.reRollPrompt.chosen === opt.source"
                  @click="gameStore.resolveReRoll(opt.source)">
                  <img v-if="skillIconUrl(opt.source, effectiveIconStyle)"
                    :src="skillIconUrl(opt.source, effectiveIconStyle)!" :alt="opt.label" />
                  <span v-else>{{ opt.label }}</span>
                  <!-- #205 (Meero audit row): Mascot TRR also consumes the team re-roll pool ⇒ it carries the
                       same count, inline (it's the mascot art, not the plain re-roll die). Plain 'Team Mascot'
                       (no TRR) is excluded (#188 FR-1). -->
                  <span v-if="opt.source === 'Mascot TRR' && rerollPromptTeamReRolls !== null" class="rr-trr-inline"
                    :title="`Team re-rolls available: ${rerollPromptTeamReRolls}`">
                    <img :src="resourceIcon('re_roll')" alt="Team re-rolls" />{{ rerollPromptTeamReRolls }}
                  </span>
                </button>
              </template>
              <button v-if="gameStore.state.reRollPrompt.mine" class="bp-opt rr-decline-chip" title="No re-roll"
                @click="gameStore.resolveReRoll(null)">✕</button>
            </div>
          </div>
        </template>

        <!-- Owner 2026-07-08 (pipeline Phase 3c): KO/INJURY INTERACTION GATE — a KO or
             injury result that needs a coach decision (regeneration / keyword / …).
             Reuses the reroll-menu surface language: token-anchored, READ-ONLY for
             non-owners (data-spectator → buttons inert), the owner's pick GLOWS
             activation-gold (data-chosen, §A0). Holds the pipeline until answered. -->
        <ul v-if="gameStore.state.injuryInteraction && injuryGatePos.ready"
          class="context-menu reroll-menu injury-gate"
          :data-spectator="!gameStore.state.injuryInteraction.mine"
          :data-side="gameStore.state.injuryInteraction.side"
          :style="reactivePromptStyle('injuryInteraction', { x: injuryGatePos.x, y: injuryGatePos.y + 16 })"
          title="Drag to move" @pointerdown="startReactivePromptDrag('injuryInteraction', $event)">
          <li class="reroll-menu-title">{{ gameStore.state.injuryInteraction.label }}</li>
          <li v-for="opt in gameStore.state.injuryInteraction.options" :key="opt.key"
            class="reroll-menu-item" :title="opt.desc"
            :data-chosen="gameStore.state.injuryInteraction.chosen === opt.key"
            @click="gameStore.resolveInjuryInteraction(opt.key)">
            <span class="reroll-menu-glyph">✚</span>
            {{ opt.label }}
          </li>
        </ul>
        <!-- Owner 2026-07-03: movable (top-left grip or the name bar) + resizable
             via a TOP-RIGHT handle -->
        <div v-if="popup.visible && popupInfo" ref="playerCardEl" class="player-card" :style="cardStyle">
          <span class="card-grip" title="Drag to move" aria-hidden="true"
            @pointerdown="startCardDrag">⠿</span>
          <span class="card-resize" title="Drag to resize" aria-hidden="true"
            @pointerdown="startCardResize"></span>
          <button class="close" @click="popup.visible = false">×</button>
          <div class="card-name" :data-side="popupInfo.side" title="Drag to move"
            @pointerdown="startCardDrag">#{{ popupInfo.nr }} {{ popupInfo.name }}</div>
          <div class="card-position">{{ popupInfo.positionName }} · <span class="card-spp">SPP {{ popupInfo.spp }}</span><span v-if="popupInfo.sppEarned > 0" class="card-spp-gain"> +{{ popupInfo.sppEarned }}</span></div>
          <div v-if="popupInfo.status && popupInfo.status !== 'On pitch'" class="card-status"
            :data-status="popupInfo.status">{{ popupInfo.status }}</div>
          <div v-if="popupInfo.injuries.length" class="card-injuries">
            ⚕ {{ popupInfo.injuries.join(' · ') }}
          </div>
          <div class="card-body">
            <div class="card-stats">
              <div v-for="stat in popupInfo.stats" :key="stat.label" class="card-stat">
                <em>{{ stat.label }}</em><span :data-reduced="stat.reduced" :data-increased="stat.increased">{{ stat.value }}</span>
              </div>
            </div>
            <div class="card-portrait">
              <img v-if="portrait" :src="portrait" alt="" />
              <span v-else class="portrait-missing">no portrait</span>
            </div>
          </div>
          <PlayerDetailSkillList v-if="popupInfo.skills.length" :skills="popupInfo.skills" :mode="skillMode" :icon-style="effectiveIconStyle"
            :position-id="popupPlayer?.player.positionId" :side="popupInfo.side"
            :descriptions="SKILL_DESCRIPTIONS" :show-descriptions="SKILL_DESC_TOOLTIPS_ENABLED" />
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.spectate {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
/* owner 2026-07-03 r6f Option A: the .menubar/.connect green connect bar was
   removed. Its controls now live in the header (App.vue: Browse, session state,
   Disconnect) and in the game browser modal below (server toggle + game entry). */
.pickers {
  margin-left: auto;
  display: flex;
  gap: 0.75rem;
  align-items: center;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem);
  color: var(--ui-text);
}
.pickers label { display: flex; gap: 0.35rem; align-items: center; }
/* Owner 2026-07-09: join failures now reuse the centered .conn-closed-overlay modal (click to
   dismiss) — the old floating .join-error banner styles were retired with that change. */
/* BB2-style HUD (owner 2026-07-02) */
.coach-panel {
  /* UAT 08-23: trim the shared mirrored allocation by 10% without changing
     its three-resource row contract. */
  --coach-panel-width: 295px; /* owner 09-05: +25 for the wider crest well (text column unchanged) */
  --coach-crest-size: 90px; /* owner 09-05: crests read compressed at 65 — wider well, crest fills it */
  --coach-resource-gap: 4px;
  position: absolute;
  z-index: 12;
  top: 10px;
  display: flex;
  gap: 7px;
  align-items: stretch;
  /* A fixed inline allocation keeps the mirrored corners symmetric. Height is intentionally
     content-driven: wrapped names and each additional three-resource row extend downward,
     carrying the Current Player drawer with them instead of colliding sideways with the HUD. */
  width: var(--coach-panel-width);
  box-sizing: border-box;
  overflow: visible;
  /* owner 2026-07-02: black backing at 15% around the whole panel */
  /* owner 2026-07-02 (UI-1): raised from 15% */
  background:
    linear-gradient(180deg,
      rgb(35 39 45 / var(--hud-coach-opacity, 0.9)),
      rgb(10 12 15 / var(--hud-coach-opacity, 0.9)));
  padding: 7px 9px;
  border: 2px solid #353b44;
  border-radius: 5px;
  box-shadow:
    0 4px 0 #050607,
    0 7px 18px #000b,
    inset 0 1px 0 #626b77,
    inset 0 0 0 3px #14171b;
}
/* owner 2026-07-03: corner coach panels reduced 30% (scaled toward their screen
   corner so they stay docked; the config-bar measures the base 0.7 size). Owner
   2026-07-03: the ACTIVE coach's panel GROWS on their turn (data-playing) and
   eases back to the base size when their turn ends. Anchored to the screen corner
   (transform-origin) so it grows inward, not off-screen. */
.coach-panel { transition: transform 0.35s cubic-bezier(0.34, 1.28, 0.64, 1); }
/* UAT 08-23: the waiting coach recedes a further 15%; 09-02 raises both resting
   and active corner allocations by 10% while preserving their relative emphasis. */
.coach-panel.home { --coach-panel-base-scale: 0.80784; left: 8px; transform: scale(0.80784); transform-origin: top left; border-left-color: var(--seat-home-mid); }
.coach-panel.away { --coach-panel-base-scale: 0.80784; right: 8px; flex-direction: row-reverse; text-align: right; transform: scale(0.80784); transform-origin: top right; border-right-color: var(--seat-away-mid); }
.coach-panel.home[data-playing='true'] { transform: scale(1.03488); }
.coach-panel.away[data-playing='true'] { transform: scale(1.03488); }
.hud-center.scoreboard {
  transform: translateX(-50%) scale(0.96);
  transform-origin: top center;
}
@media (max-width: 1000px) {
  .coach-panel.home { --coach-panel-base-scale: 0.646272; transform: scale(0.646272); }
  .coach-panel.away { --coach-panel-base-scale: 0.646272; transform: scale(0.646272); }
  .coach-panel.home[data-playing='true'] { transform: scale(0.82368); }
  .coach-panel.away[data-playing='true'] { transform: scale(0.82368); }
  .hud-center.scoreboard {
    transform: translateX(-50%) scale(0.8256);
    transform-origin: top center;
  }
}
.race-logo {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: none;
  object-fit: contain;
  object-position: center;
  image-rendering: pixelated;
  filter: drop-shadow(0 2px 4px #000c);
}
.logo-col {
  display: grid;
  place-items: center;
  width: var(--coach-crest-size);
  min-height: var(--coach-crest-size);
  height: auto;
  align-self: stretch;
  flex: 0 0 var(--coach-crest-size);
  min-width: 0;
  overflow: hidden;
  background: #000;
}
/* Current-player drawer: it lives outside the coach panel's hardware rather than
   consuming the logo well. Turn ownership retracts one drawer and slides the
   mirrored coach's drawer down from the panel edge. */
.active-indicator {
  position: absolute;
  bottom: 0;
  z-index: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  /* Default geometry is exactly 25% below the previous drawer. The accessibility
     slider may grow it beyond that footprint so enlarged text remains whole. */
  inline-size: max(clamp(90px, 39%, 111px), calc(var(--ui-min-text-size, 12px) * 8 + 12px));
  block-size: max(20.25px, calc(var(--ui-min-text-size, 12px) + 5.25px));
  overflow: clip;
  background: color-mix(in srgb, var(--active-badge-color, var(--ui-accent)) 78%, #101319);
  border: 0;
  border-radius: 0 0 3.75px 3.75px;
  box-sizing: border-box;
  padding: 3px 6px 2.25px;
  box-shadow: 0 5px 9px #0009;
  transform: translateY(12%) scaleY(0.16);
  transform-origin: top center;
  opacity: 0;
  pointer-events: none;
  transition:
    transform var(--p-360) cubic-bezier(0.2, 0.9, 0.25, 1.18),
    opacity var(--p-180) ease;
}
.active-indicator[data-active='true'] {
  transform: translateY(calc(100% - 2px)) scaleY(1);
  opacity: 1;
}
.coach-panel.home .active-indicator { right: 12px; }
.coach-panel.away .active-indicator { left: 12px; }
/* Owner 09-06: PRAYERS TO NUFFLE tag — the orange prayer-banner language as a drawer under the panel's OTHER
   bottom corner (home left / away right), one row per prayer, stacking DOWNWARD. Sits behind the panel body (z 0)
   like the Current Player drawer. */
.prayer-tag {
  position: absolute;
  bottom: 0;
  z-index: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transform: translateY(calc(100% - 2px));
  pointer-events: auto;
}
.coach-panel.home .prayer-tag { left: 12px; align-items: flex-start; }
.coach-panel.away .prayer-tag { right: 12px; align-items: flex-end; }
.prayer-tag-row {
  display: flex;
  align-items: center;
  gap: 5px;
  box-sizing: border-box;
  min-width: max(clamp(90px, 39%, 111px), calc(var(--ui-min-text-size, 12px) * 8 + 12px));
  padding: 3px 8px 2.5px;
  background: linear-gradient(100deg, #6a4e0cf2, #3a2c06f2);
  border: 1px solid #e0b040aa;
  border-top: 0;
  border-radius: 0 0 3.75px 3.75px;
  box-shadow: 0 5px 9px #0009;
  color: #ffe8b0;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-text-size, 12px), clamp(0.42rem, 0.75vw, 0.51rem));
  font-weight: 900;
  letter-spacing: 0.02em;
  line-height: 1;
  text-transform: uppercase;
  text-shadow: 0 1px 1px #000;
  white-space: nowrap;
}
.prayer-tag-row + .prayer-tag-row { border-top: 1px solid #e0b04055; border-radius: 3.75px; }
.prayer-tag-icon { font-family: "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif; font-size: 1.05em; line-height: 1; filter: drop-shadow(0 1px 2px #000c); }
.coach-decision-status {
  position: absolute;
  z-index: 3;
  top: calc(100% + 5px);
  min-width: 105px;
  box-sizing: border-box;
  padding: 4px 9px;
  border: 1px solid color-mix(in srgb, var(--active-badge-color, var(--ui-accent)) 72%, #fff 12%);
  border-radius: 4px;
  background: rgba(11, 14, 19, 0.94);
  box-shadow: 0 3px 10px #000a;
  color: #f2ede0;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-text-size, 12px), 10px);
  font-weight: 800;
  letter-spacing: 0.025em;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
  pointer-events: none;
}
.coach-panel[data-playing='true'] .coach-decision-status {
  top: calc(100% + max(20.25px, calc(var(--ui-min-text-size, 12px) + 5.25px)) + 5px);
}
.coach-panel.home .coach-decision-status { right: 12px; }
.coach-panel.away .coach-decision-status { left: 12px; }
.active-label {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-text-size, 12px), clamp(0.42rem, 0.75vw, 0.51rem));
  font-weight: 900;
  letter-spacing: 0.01875em;
  line-height: 1;
  text-align: center;
  text-transform: uppercase;
  text-shadow: 0 1px 1px #000;
  white-space: nowrap;
  color: #fff;
  transform: scaleX(0.8);
  transform-origin: center;
}
.coach-panel.home { --active-badge-color: var(--seat-home-bright); --active-badge-text: #eef5ff; }
.coach-panel.away { --active-badge-color: var(--seat-away-bright); --active-badge-text: #fff2f3; }
.coach-lines { display: flex; flex: 1; min-width: 0; max-width: 100%; flex-direction: column; gap: 3px; }
.coach-panel.away .coach-lines { align-items: flex-end; }
.coach-name {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  font-size: max(var(--ui-min-text-size, 12px), 0.7rem);
  font-weight: 800;
  letter-spacing: 0.04em;
  color: #d8d4c8;
  background: linear-gradient(90deg, #000c, #0006);
  padding: 1px 8px;
  border-radius: 2px;
  overflow-wrap: anywhere;
  white-space: normal;
}
.coach-panel.away .coach-name { background: linear-gradient(270deg, #000c, #0006); }
.team-title {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.88rem);
  font-weight: bold;
  color: var(--ui-accent);
  background: linear-gradient(90deg, #000d, #0007);
  padding: 2px 10px;
  border-radius: 2px;
  letter-spacing: 0.03em;
  line-height: 1.08;
  overflow-wrap: anywhere;
  white-space: normal;
  text-shadow: 0 1px 2px #000;
}
.coach-panel.away .team-title { background: linear-gradient(270deg, #000d, #0007); }
/* Owner 2026-07-15: team NAMES carry the semantic HOME=blue / AWAY=red identity (matching .sb-score /
   .sb-turn / log talk), NOT the theme accent — the theme apply had made both read as the primary (red). */
.coach-panel.home .team-title { color: var(--seat-home-text); }
.coach-panel.away .team-title { color: var(--seat-away-text); }
/* owner 2026-07-03 r5: turn indicator in the panel corner (top-right home /
   top-left away), WHITE; GOLD when this coach is the active player */
/* owner 2026-07-04e: per-coach turn moved to the central scoreboard (was .turn-count) */
.inducements {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--coach-resource-gap);
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  margin-top: 1px;
  flex-wrap: wrap;
  align-items: center;
  min-height: 58px;
  padding: 3px 4px;
  border: 1px solid #343942;
  background: #08090bc7;
  box-shadow: inset 0 2px 5px #000c, inset 0 0 0 1px #171a1f;
}
.coach-panel.away .inducements { justify-content: end; }
.inducement {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: auto;
  min-width: 0;
  aspect-ratio: 1;
  box-sizing: border-box;
  background: linear-gradient(180deg, #292d33, #111317);
  border: 1px solid #454b54;
  border-radius: 2px;
  padding: 1px;
  box-shadow: inset 0 1px 0 #626a75, 0 1px 2px #000;
}
.inducement[data-pool='drive'] {
  border-color: #9d762d;
}
.inducement[data-pool='single-use'] {
  border-style: dashed;
  border-color: #4e8790;
}
/* owner 09-06: a FIXED 64 px box — the 256 px masters land at an exact 4:1 (box-filtered, auto); the four 38 px icons
   stretch 1.68x until they are regenerated at 64 px. */
.inducement img { width: 64px; height: 64px; max-width: 100%; max-height: 100%; object-fit: contain; image-rendering: auto; }
.inducement-quantity {
  position: absolute;
  z-index: 20;
  pointer-events: none;
  top: -6px;
  right: -5px;
  min-width: 16px;
  padding: 1px 3px;
  border: 1px solid #ff6a60;
  border-radius: 7px;
  background: #b30e14;
  color: #fff;
  font-size: max(var(--ui-min-text-size, 12px), 0.54rem);
  line-height: 1.05;
  text-align: center;
  text-shadow: 0 1px 1px #000;
  box-shadow: 0 1px 3px #000d;
}

/* Owner 2026-07-04e: the central scoreboard is one unit — a 2-row × 3-col grid
   (top: half | score | weather; bottom: home turn | End Turn | away turn). */
.hud-center {
  position: absolute;
  z-index: 12;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
}
.scoreboard {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  grid-template-rows: auto auto;
  align-items: center;
  justify-items: center;
  gap: 3px 10px;
  background: linear-gradient(180deg,
    rgb(35 39 45 / var(--hud-scoreboard-opacity, 0.9)),
    rgb(8 10 12 / var(--hud-scoreboard-opacity, 0.9)));
  border: 2px solid #373d46;
  border-radius: 5px;
  padding: 6px 15px 7px;
  box-shadow: 0 4px 0 #050607, 0 7px 18px #000b, inset 0 1px 0 #68717d, inset 0 0 0 3px #13161a;
}
.sb-cell { display: flex; align-items: center; justify-content: center; }
.scoreboard:not(.flat-hud) .sb-half { grid-column: 1; grid-row: 1; }
.scoreboard:not(.flat-hud) .sb-score { grid-column: 2; grid-row: 1; }
.scoreboard:not(.flat-hud) .sb-weather { grid-column: 3; grid-row: 1; }
.scoreboard:not(.flat-hud) .sb-turn.home { grid-column: 1; grid-row: 2; }
.scoreboard:not(.flat-hud) .end-turn { grid-column: 2; grid-row: 2; }
.scoreboard:not(.flat-hud) .sb-turn.away { grid-column: 3; grid-row: 2; }
/* B2-18 (owner): center panel + weather +30%; half indicator bold/heavier */
.sb-half { font-size: max(var(--ui-min-primary-text-size, 16px), 1.02rem); font-weight: 800; color: #d8d4c8; letter-spacing: 0.04em; }
/* owner 2026-07-03 r6: HOME score BLUE (left), AWAY score RED (right) */
.sb-score { font-size: max(var(--ui-min-primary-text-size, 16px), 1.5rem); font-weight: bold; color: #fff; gap: 6px; }
.sb-score .score-home { color: var(--seat-home-text); }
.sb-score .score-away { color: var(--seat-away-text); }
.sb-weather { flex-direction: column; gap: 0; font-size: max(var(--ui-min-primary-text-size, 16px), 1.25rem); line-height: 1; }
.sb-weather small { color: #8c929b; font-size: max(var(--ui-min-text-size, 12px), 0.46rem); letter-spacing: 0.12em; line-height: 1.1; }
/* Owner 2026-07-04e: per-coach turn badges — full colour for the ACTIVE coach,
   shaded out for the other. */
.sb-turn {
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem);
  font-weight: 800;
  letter-spacing: 0.03em;
  padding: 2px 9px;
  border-radius: 10px;
  border: 1px solid transparent;
}
.sb-turn.home { background: var(--seat-home-deep); color: var(--seat-home-text); border-color: var(--seat-home-mid); }
.sb-turn.away { background: var(--seat-away-deep); color: var(--seat-away-text); border-color: var(--seat-away-mid); }
/* Owner 08-18: LIVE on-air badge — anchored to the HOME coach panel's right edge (child at
   left:100%), so panel expansion pushes it and retraction pulls it back. Grown ~1.45× on the
   same ruling. Steady red pulse; brighter one-shot flash when a new spectator joins. */
.live-badge {
  position: absolute;
  top: 0;
  left: 100%;
  margin-left: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  pointer-events: none;
}
.live-dot {
  font-size: max(var(--ui-min-text-size, 12px), 0.78rem);
  font-weight: 900;
  letter-spacing: 0.09em;
  color: #fff;
  border: 1px solid #ff6060;
  border-radius: 3px;
  padding: 1.5px 6px;
  animation: live-pulse 1.6s ease-in-out infinite;
}
.live-count {
  font-size: max(var(--ui-min-text-size, 12px), 0.66rem);
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #ff6b6b;
  animation: live-text-pulse 1.6s ease-in-out infinite;
}
@keyframes live-pulse {
  0%, 100% { background: #a81f24; box-shadow: 0 0 4px #ff2a2a55; }
  50% { background: #e23a40; box-shadow: 0 0 13px #ff3a3add; }
}
@keyframes live-text-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
.live-badge[data-flash='true'] .live-dot { animation: live-flash 0.4s ease-in-out 3; }
.live-badge[data-flash='true'] .live-count { animation: live-flash 0.4s ease-in-out 3; }
@keyframes live-flash {
  0%, 100% { transform: scale(1); background: #c0272d; box-shadow: 0 0 6px #ff2a2a99; filter: brightness(1); }
  50% { transform: scale(1.2); background: #ff4a50; box-shadow: 0 0 20px #ff5a5a; filter: brightness(1.5); }
}
/* owner 08-18: the turn cells snapped between the two states while the pitch tokens cross-faded —
   ease them on the same 260ms budget as ACTIVATION_FADE_MS so the whole boundary reads as one move. */
.sb-turn { transition: opacity 0.26s ease, filter 0.26s ease, box-shadow 0.26s ease; }
.sb-turn[data-active='false'] { opacity: 0.4; filter: grayscale(0.5); }
.sb-turn[data-active='true'] { opacity: 1; box-shadow: 0 0 8px #0006; }
/* Owner 2026-07-07: FLAT-mode HUD — the isometric scoreboard obscured the top of
   the flat (top-down) pitch. In flat mode ONLY, collapse the 2-row block into a
   THIN single line pinned to the very top: half | score | weather in the centre,
   turn badges flanking, End Turn on the RIGHT, timer just to the LEFT (timerStyle).
   Background dropped (text-shadowed) so nothing but the thin text/badges sits over
   the pitch edge. Non-flat mode is untouched. */
.hud-center.flat-hud { top: 2px; }
.scoreboard.flat-hud {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0 8px;
  padding: 1px 8px;
  background: transparent;
  border: none;
}
.scoreboard.flat-hud .sb-turn.home { order: 1; }
.scoreboard.flat-hud .sb-half { order: 2; }
.scoreboard.flat-hud .sb-score { order: 3; }
.scoreboard.flat-hud .sb-weather { order: 4; }
.scoreboard.flat-hud .sb-turn.away { order: 5; }
.scoreboard.flat-hud .end-turn { order: 6; }
/* thin + readable over the pitch (no panel background behind them) */
.scoreboard.flat-hud .sb-half,
.scoreboard.flat-hud .sb-score,
.scoreboard.flat-hud .sb-weather {
  text-shadow: 0 1px 3px #000e, 0 0 6px #000c;
}
.scoreboard.flat-hud .sb-half { font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); }
.scoreboard.flat-hud .sb-score { font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem); }
.scoreboard.flat-hud .sb-weather { font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); }
.scoreboard.flat-hud .sb-turn { font-size: max(var(--ui-min-text-size, 12px), 0.66rem); padding: 1px 6px; }
.scoreboard.flat-hud .end-turn { margin-left: 4px; }
.turn-timer.flat-hud { top: 2px; }
/* owner 2026-07-03 r6: floating, movable timer (default left of the scoreboard).
   Owner r6b: FIXED size — the box never resizes with the clock text / timeout
   state (tabular-nums + a fixed width/height, centred). */
.turn-timer {
  position: absolute;
  z-index: 13;
  top: 10px;
  cursor: move;
  user-select: none;
  box-sizing: border-box;
  /* Owner 2026-08-25: enlarge the complete timer allocation by exactly 1.3x. */
  width: 93.6px;
  height: 27.3px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3.9px;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.066rem);
  color: var(--ui-text);
  background: #000b;
  border: 1px solid var(--ui-border);
  padding: 0 5.2px;
  border-radius: 3.9px;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  white-space: nowrap;
}
/* timeout only recolours — no size change */
.turn-timer[data-timeout='true'] {
  color: #ff3030;
  font-weight: bold;
}
/* the Call time-out button (rare play state) can widen the box past the fixed
   width, so it drops to auto width only then */
.turn-timer:has(.call-timeout),
.turn-timer:has(.call-timeout-note) { width: auto; }
.call-timeout {
  background: #3a1d1d;
  color: #f0b0b0;
  border: 1px solid #8a3a3a;
  border-radius: 3px;
  padding: 0.15rem 0.6rem;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  cursor: pointer;
}
.call-timeout:disabled { opacity: 0.7; cursor: default; }
/* #14b T-3: caller-side honesty copy — display-only, same rare-state widening as the
   button (via the :has() rule above). */
.call-timeout-note {
  color: #f0b0b0;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  white-space: nowrap;
}
.main {
  display: flex;
  flex: 1;
  min-height: 0;
}
/* B6-5: coin-flip cinematic — 3D coin tossed up and caught */
.coin-toss {
  position: absolute;
  z-index: 45;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  background: radial-gradient(ellipse at center, #0008 0%, #0000 60%);
  pointer-events: none;
  /* B7-4: hold the result ~3s longer before fading */
  animation: coin-fade var(--p-6200) ease-out forwards;
}
.coin-lift {
  /* outer element owns the toss arc (translateY) */
  animation: coin-toss-move var(--p-2400) cubic-bezier(0.3, -0.5, 0.4, 1) forwards;
}
.coin {
  width: 96px;
  height: 96px;
  position: relative;
  transform-style: preserve-3d;
  /* inner element owns the flip (rotateX), settling on the result */
  animation: coin-flip-heads var(--p-2400) ease-out forwards;
}
.coin[data-result='tails'] { animation-name: coin-flip-tails; }
.coin-face {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: max(var(--ui-min-primary-text-size, 16px), 3.2rem);
  font-weight: 900;
  color: #4a3a10;
  backface-visibility: hidden;
  background: radial-gradient(circle at 38% 34%, var(--ui-accent) 0%, #e8b84a 55%, #b8892a 100%);
  border: 4px solid #a6791f;
  box-shadow: 0 8px 22px #000a;
}
.coin-face.tails { transform: rotateX(180deg); }
/* B9-13: FUMBBL skull engraved on the gold HEADS face — invert (skull→dark) +
   multiply so the die-face black background drops out onto the coin gold. */
.coin-skull {
  width: 62px;
  height: 62px;
  image-rendering: pixelated;
  filter: invert(1);
  mix-blend-mode: multiply;
  opacity: 0.9;
}
/* B9-13: the coach's called side, shown from the start above the coin */
.coin-call {
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem);
  font-weight: 800;
  letter-spacing: 0.02em;
  color: var(--ui-heading);
  text-shadow: 0 2px 6px #000d;
  display: flex;
  align-items: center;
  gap: 8px;
  animation: coin-caption-in var(--p-300) ease-out forwards;
}
.coin-call-side {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-heading);
}
.coin-call-skull {
  width: 22px;
  height: 22px;
  image-rendering: pixelated;
  background: var(--ui-surface);
  border-radius: 4px;
  padding: 1px;
}
.coin-caption {
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.4rem);
  font-weight: 800;
  color: var(--ui-heading);
  text-shadow: 0 2px 6px #000d;
  opacity: 0;
  /* #96 (owner): the caption SPELLS OUT the result ("HEADS — coach wins"), so it must reveal only AFTER the coin
     visibly LANDS — the .coin flip runs 2.4s, so a 2.1s reveal leaked the result 0.3s before the coin settled.
     Delay to 2.5s (a beat past the landing) so the flip keeps its suspense. */
  animation: coin-caption-in var(--p-400) ease-out var(--p-2500) forwards;
}
@keyframes coin-toss-move {
  0% { transform: translateY(60px) scale(0.7); }
  45% { transform: translateY(-150px) scale(1.05); }
  100% { transform: translateY(0) scale(1); }
}
@keyframes coin-flip-heads {
  0% { transform: rotateX(0deg); }
  100% { transform: rotateX(1800deg); } /* 5 full turns → heads up */
}
@keyframes coin-flip-tails {
  0% { transform: rotateX(0deg); }
  100% { transform: rotateX(1980deg); } /* 5.5 turns → tails up */
}
@keyframes coin-caption-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes coin-fade {
  0%, 90% { opacity: 1; }
  100% { opacity: 0; }
}
/* Click-to-dismiss: hold the splash at full opacity (no auto fade-out) until the
   catcher is clicked. Overrides each overlay's coin-fade. */
/* BB2025 extra-time PENALTY SHOOTOUT summary panel — a persistent centered card (NOT auto-fading,
   pointer-events on for the Confirm). Matches the cinematic gold-on-dark idiom. */
.penalty-shootout {
  position: absolute;
  z-index: 46;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: radial-gradient(ellipse at center, #000b 0%, #0007 70%);
  pointer-events: auto;
}
.ps-title {
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.7rem);
  font-weight: 900;
  letter-spacing: 0.03em;
  color: var(--ui-heading);
  text-shadow: 0 2px 8px #000d;
}
.ps-score {
  display: flex;
  align-items: baseline;
  gap: 16px;
  font-weight: 800;
  color: var(--ui-heading);
  text-shadow: 0 2px 6px #000d;
}
.ps-team { font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem); opacity: 0.72; }
.ps-team.ps-win { opacity: 1; color: var(--ui-heading); }
.ps-tally { font-size: max(var(--ui-min-primary-text-size, 16px), 1.8rem); color: #fff; }
.ps-rounds {
  list-style: none;
  margin: 0;
  padding: 10px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #1a1c22cc;
  border: 1px solid #a6791f66;
  border-radius: 8px;
}
.ps-round {
  display: grid;
  grid-template-columns: 44px 26px 22px 26px 1fr;
  align-items: center;
  gap: 10px;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem);
  color: #e6ddc4;
}
.ps-round-label { color: #b9ad86; font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); text-transform: uppercase; letter-spacing: 0.04em; }
.ps-roll { --d6-size: 2rem; justify-self: center; }
.ps-roll-win { filter: drop-shadow(0 0 5px #7fe07f); }
.ps-vs { text-align: center; color: #8a8264; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); }
.ps-round-win { color: var(--ui-heading); }
.ps-result {
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem);
  font-weight: 800;
  color: var(--ui-heading);
  text-shadow: 0 2px 6px #000d;
}
.ps-confirm {
  margin-top: 4px;
  padding: 8px 26px;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  font-weight: 800;
  color: #2a2205;
  background: radial-gradient(circle at 38% 30%, var(--ui-accent) 0%, #e8b84a 60%, #c8992e 100%);
  border: 2px solid #a6791f;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 6px 18px #000a;
}
.ps-confirm:hover { filter: brightness(1.08); }
.ps-confirm:active { transform: scale(0.97); }
.cine-hold { animation: cine-hold-in var(--p-450) ease-out forwards !important; }
@keyframes cine-hold-in { from { opacity: 0; } to { opacity: 1; } }
.cine-dismiss {
  position: absolute;
  inset: 0;
  z-index: 47;
  cursor: pointer;
}
.cine-dismiss-hint {
  position: absolute;
  bottom: 7%;
  left: 50%;
  transform: translateX(-50%);
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem);
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--ui-heading);
  text-shadow: 0 2px 6px #000e;
  pointer-events: none;
  animation: cine-hint-pulse 1.4s ease-in-out infinite;
}
@keyframes cine-hint-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

/* Owner (revised 2026-07-03): skill-use choice tooltip — COMPACT, OFFSET from
   the action point (the camera centres the action; the card sits up-right of
   it, the spotlight marks the square), 5% player silhouette behind. */
.skill-choice {
  position: absolute;
  z-index: 48;
  left: 71%;
  top: 24%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 9px 16px 8px;
  background: #14181fd8;
  border: 1px solid var(--ui-accent);
  border-radius: 8px;
  box-shadow: 0 8px 22px #000c;
  overflow: hidden;
  animation: coin-caption-in var(--p-300) ease-out forwards;
}
.sc-silhouette {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: brightness(0); /* a true silhouette of the player */
  opacity: 0.05; /* owner: 5% */
  pointer-events: none;
}
.sc-title {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  color: var(--ui-heading);
  text-shadow: 0 2px 5px #000d;
}
/* Owner Swoop ② (08-12): reason subtext under the Swoop use-decision title. */
.sc-subtext { margin-top: 2px; color: var(--ui-muted); font-size: max(var(--ui-min-text-size, 12px), 0.62rem); line-height: 1.25; }
.sc-pass-result {
  display: grid;
  gap: 3px;
  color: var(--ui-heading);
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-text-size, 12px), 0.7rem);
  line-height: 1.3;
  text-align: center;
  text-shadow: 0 2px 5px #000d;
}
.sc-body { display: flex; align-items: center; gap: 9px; }
/* #225(b): Crushing Blow armour-roll context above the CB body — 🛡 + the actual rolled [d6,d6] pip dice. */
.sc-cb-armour { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 6px; }
.sc-cb-emoji { font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem); }
.sc-die.sc-cb-die { --d6-size: 24px; }
.sc-icon { width: 26px; height: 26px; image-rendering: pixelated; filter: drop-shadow(0 2px 5px #000b); }
/* Glyph placeholder for a skill with no icon art (e.g. Taunt → 'T') — matches the
   pitch-markings glyph badge, sized to sit where the icon would. */
.sc-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 5px;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-weight: 900;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  color: var(--ui-heading);
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  text-shadow: 0 2px 6px #000d;
}
.sc-name {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem);
  color: var(--ui-heading);
  text-shadow: 0 2px 6px #000d;
}
.sc-die {
  --d6-size: 30px;
  filter: drop-shadow(0 4px 5px #000a);
}
.sc-needed {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem);
  font-weight: 800;
  color: var(--ui-heading);
  text-shadow: 0 2px 6px #000d;
}
.sc-actions { display: flex; gap: 8px; }
.sc-actions button {
  font-family: 'Nuffle', system-ui, sans-serif; /* owner: Nuffle yes/no */
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem);
  padding: 2px 14px;
  border-radius: 5px;
  cursor: pointer;
  border: 1px solid var(--ui-border);
  color: var(--ui-text);
}
.sc-yes { background: #2c5232; }
.sc-yes:hover { background: #3a6a42; }
.sc-no { background: #55282a; }
.sc-no:hover { background: #703437; }
.sc-wait { font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: var(--ui-muted); font-style: italic; }

/* B9-8: inducement wait cinematic — catalog table, chosen highlighted + a review wait */
/* Owner 2026-07-08: live-play inducement REVEAL — my choices (left) + the
   opponent's (right). Chips = icon + ×qty; stars = on-pitch sprite + name. */
/* full-screen dim while inducements are chosen/revealed (like the old cine). */
.induce-shader {
  position: absolute; inset: 0; z-index: 44; pointer-events: none;
  background: radial-gradient(ellipse at center, #0004 0%, #0003 55%, #0005 100%);
}
/* The phase screen is a pitch-host child, like .yesno-card/.coin-wait-card. Keep
   it out of document flow, centred over the canvas at the same modal z-layer,
   and contain any small-window scrolling inside the overlay instead of the page. */
.pitch-host > .induce-phase.ind-grid {
  position: absolute;
  /* Owner UAT: the pane occupies the middle two-thirds of the pitch host. The
     shader remains full-host; only this scroll container is shortened. */
  inset: 16.6667% 0;
  z-index: 47;
  width: 100%;
  height: auto;
  min-height: 0;
  align-content: center;
  overflow: auto;
  overscroll-behavior: contain;
  background: transparent;
}
/* the two reveal panels — grounded CENTER-LEFT / CENTER-RIGHT, mirrored. */
.induce-reveal {
  position: absolute; z-index: 46; top: 50%; transform: translateY(-50%);
  width: 214px; display: flex; flex-direction: column; gap: 8px;
  padding: 12px 14px; background: rgba(14, 18, 26, 0.96);
  border: 1px solid var(--ui-border); border-radius: 10px; box-shadow: 0 8px 28px #000c; color: #e8ecf2;
  animation: induce-appear var(--p-350) ease; /* fade in as the prompt gives way to icons */
}
@keyframes induce-appear { from { opacity: 0; } to { opacity: 1; } }
.induce-reveal.induce-left { left: 22px; }
.induce-reveal.induce-right { right: 22px; }
/* the buy prompt shares the center-left slot with the reveal */
.induce-panel.induce-left { left: 22px; top: 50%; transform: translateY(-50%); }
.induce-reveal-head {
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.86rem); font-weight: 700; color: var(--ui-heading); letter-spacing: 0.02em; text-align: center;
  border-bottom: 1px solid var(--ui-border); padding-bottom: 5px;
}
.induce-underdog {
  font-family: 'Nuffle', sans-serif; font-size: max(var(--ui-min-primary-text-size, 16px), 1.5rem); font-weight: 800; text-align: center;
  color: var(--ui-accent); letter-spacing: 0.08em; text-shadow: 0 2px 8px #000c; padding: 12px 0;
  animation: induce-blink 1.6s infinite;
}
.induce-choosing { font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); color: #cfe0ff; text-align: center; padding: 8px 0; }
.induce-choosing .dots i, .induce-waiting .dots i { animation: induce-blink 1.2s infinite; font-style: normal; }
.induce-choosing .dots i:nth-child(2) { animation-delay: 0.2s; }
.induce-choosing .dots i:nth-child(3) { animation-delay: 0.4s; }
@keyframes induce-blink { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
.induce-reveal-grid { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.induce-chip { position: relative; display: flex; align-items: center; justify-content: center; }
.induce-chip img { width: 42px; height: 42px; image-rendering: pixelated; }
.induce-chip-text {
  font-size: max(var(--ui-min-text-size, 12px), 0.62rem); color: #d8d4c8; max-width: 60px; text-align: center; line-height: 1.05;
  padding: 5px; border: 1px solid var(--ui-border); border-radius: 6px; min-height: 32px;
  display: flex; align-items: center;
}
.induce-qty {
  position: absolute; top: -6px; right: -8px;
  background: var(--ui-accent); color: var(--ui-text-on-accent); font-size: max(var(--ui-min-text-size, 12px), 0.66rem); border-radius: 999px; padding: 0 5px;
}
/* star INFO card (sprite + name + stats + skills) inside a reveal panel */
.induce-starinfo {
  border: 1px solid color-mix(in srgb, var(--ui-accent) 53%, transparent); border-radius: 8px; background: rgba(0, 0, 0, 0.28);
  padding: 6px 8px; display: flex; flex-direction: column; gap: 4px;
}
.isi-head { display: flex; align-items: center; gap: 8px; }
.isi-sprite {
  width: 46px; height: 46px; image-rendering: pixelated; flex: 0 0 auto;
  outline: 2px solid var(--ui-accent); border-radius: 8px; background: color-mix(in srgb, var(--ui-surface) 80%, transparent);
}
.isi-star { font-size: max(var(--ui-min-primary-text-size, 16px), 2.2rem); color: var(--ui-accent); line-height: 1; width: 46px; text-align: center; }
.isi-name { font-family: 'Nuffle', sans-serif; font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); color: var(--ui-heading); }
.isi-stats { display: flex; gap: 3px; }
.isi-stat {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  background: #f2ede0; color: #1c1c1c; border-radius: 3px; font-size: max(var(--ui-min-text-size, 12px), 0.64rem); padding: 1px 0;
}
.isi-stat b { font-size: max(var(--ui-min-text-size, 12px), 0.52rem); color: #555; }
.isi-skills { display: flex; flex-wrap: wrap; gap: 1px 7px; font-size: max(var(--ui-min-text-size, 12px), 0.64rem); color: #8fb0e0; }
.induce-none { font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: var(--ui-muted); text-align: center; }
/* Owner 2026-07-08: "Inducements bought!" confirmation — a green check + glow when a
   coach LOCKS their inducements (shown on the locked reveal panel). */
.induce-bought {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 2px 0 6px;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem);
  font-weight: bold;
  color: #7ee59a;
  animation: induce-bought-in 0.4s ease-out both, induce-bought-glow 1.6s ease-in-out 0.4s infinite alternate;
}
.induce-bought .ib-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.15em;
  height: 1.15em;
  border-radius: 50%;
  background: #2f7d4a;
  color: #eafff0;
  font-size: max(var(--ui-min-text-size, 12px), 0.9em);
}
@keyframes induce-bought-in { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
@keyframes induce-bought-glow {
  from { text-shadow: 0 0 2px #4fe07a44; filter: drop-shadow(0 0 1px #4fe07a66); }
  to { text-shadow: 0 0 10px #4fe07acc; filter: drop-shadow(0 0 6px #4fe07a); }
}
/* the prompt fades out → the chosen icons fade in */
.induce-fade-enter-active, .induce-fade-leave-active { transition: opacity 0.35s ease; }
.induce-fade-enter-from, .induce-fade-leave-to { opacity: 0; }
/* star hover card — sits just right of the buy selector (left:14px + width 380 + gap) */
.induce-starcard {
  position: absolute; z-index: 48; left: 406px; top: 92px; width: 190px;
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px; background: rgba(14, 18, 26, 0.97);
  border: 1px solid color-mix(in srgb, var(--ui-accent) 67%, transparent); border-radius: 10px; box-shadow: 0 8px 28px #000c; color: #e8ecf2;
  pointer-events: none;
}
.isc-name { font-family: 'Nuffle', sans-serif; font-size: max(var(--ui-min-primary-text-size, 16px), 15px); color: var(--ui-heading); text-align: center; }
.isc-portrait {
  height: 74px; display: flex; align-items: center; justify-content: center;
  background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 6px;
}
.isc-portrait img { max-height: 100%; image-rendering: pixelated; }
.isc-star { font-size: max(var(--ui-min-primary-text-size, 16px), 2.6rem); color: var(--ui-accent); }
.isc-stats { display: flex; gap: 3px; }
.isc-stat {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  background: #f2ede0; color: #1c1c1c; border-radius: 3px; font-size: max(var(--ui-min-text-size, 12px), 0.66rem); padding: 2px 0;
}
.isc-stat b { font-size: max(var(--ui-min-text-size, 12px), 0.55rem); color: #555; }
.isc-skills { display: flex; flex-wrap: wrap; gap: 2px 8px; font-size: max(var(--ui-min-text-size, 12px), 0.68rem); color: #8fb0e0; }
.isc-noskill { color: var(--ui-text-dim); }
@keyframes induce-blink { 0%, 100% { opacity: 0.2; } 50% { opacity: 1; } }

/* B9-12 G7: full post-game panel (Result / MVP / Statistics) */
.postgame {
  position: absolute;
  z-index: 50;
  inset: 0;
  display: flex;
  /* owner 2026-07-05: anchor the end-of-game panel to the TOP of the screen.
     owner 2026-07-06: TWO stacked windows — Result on top, Stats/MVP below. */
  flex-direction: column;
  align-items: center;
  /* Owner 09-09: CENTRED in the viewport (was top-anchored at 44px) and every window scaled up LINEARLY via
     `zoom` (--pg-scale) so text, dice, crests, padding and gaps all grow together; the viewport-relative caps
     divide the scale back out so the zoomed stack still fits the screen. */
  --pg-scale: 1.25;
  justify-content: center;
  gap: calc(12px * var(--pg-scale));
  padding: 24px 0;
  background: radial-gradient(ellipse at center, #000c 0%, #0009 60%, #0006 100%);
  animation: coin-caption-in var(--p-350) ease-out;
}
.pg-window {
  zoom: var(--pg-scale);
  width: min(680px, calc(92vw / var(--pg-scale)));
  max-height: calc(88vh / var(--pg-scale));
  overflow-y: auto;
  background: linear-gradient(180deg, var(--ui-surface-2) 0%, var(--ui-surface) 100%);
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  box-shadow: 0 12px 40px #000c;
  color: var(--ui-text);
  flex: none;
}
/* owner 2026-07-06: Result window hugs its content; the Stats/MVP window takes the
   remaining height and scrolls internally so both stay on screen. */
.pg-window-result { flex: 0 0 auto; }
.pg-window-stats { flex: 0 1 auto; min-height: 0; max-height: calc(56vh / var(--pg-scale)); }
.pg-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ui-border);
}
.pg-title {
  font-family: 'Nuffle', sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.4rem);
  font-weight: 900;
  color: var(--ui-heading);
  letter-spacing: 0.03em;
}
/* owner 2026-07-06: the second (Stats/MVP) window's header title is a touch smaller. */
.pg-title-sub { font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem); color: var(--ui-heading); }
.pg-tabs {
  display: flex;
  gap: 4px;
  margin-left: auto;
}
.pg-tabs button {
  background: var(--ui-surface-2);
  border: 1px solid var(--ui-border);
  color: var(--ui-text);
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem);
}
.pg-tabs button[data-active='true'] {
  background: var(--ui-accent);
  border-color: var(--ui-accent);
  color: var(--ui-text-on-primary);
  font-weight: 700;
}
.pg-actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--ui-border);
}
.pg-action {
  background: var(--ui-surface-2);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  color: var(--ui-text);
  cursor: pointer;
  padding: 8px 20px;
}
.pg-action:hover { background: var(--ui-hover); }
/* Owner 08-19: spectate-seat endgame — design-language primary (bevelled carmine, End of Game.dc.html action row). */
.pg-action-primary {
  background: var(--ui-primary);
  border: 2px outset var(--ui-active);
  color: var(--ui-text-on-primary);
  font-weight: 700;
  letter-spacing: 0.06em;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
}
.pg-action-primary:hover { background: var(--ui-primary); filter: brightness(1.25); }
/* MVP-pending placeholder — holds the Statistics & MVP window's slot until the server's data lands. */
.pg-mvp-pending {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 18px 16px;
  font-family: 'Nuffle', sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem);
  letter-spacing: 0.08em;
  color: var(--ui-text-dim);
}
.pg-mvp-pending-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ui-gold);
  animation: pg-mvp-pending-pulse 1.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .pg-mvp-pending-dot { animation: none; }
}
@keyframes pg-mvp-pending-pulse {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 1; }
}
/* The persistent spectate exit pair (Return to Menu / Spectate Another Game). */
.pg-exit {
  display: flex;
  justify-content: center;
  gap: 10px;
  padding: 12px 16px;
}
.pg-close {
  /* owner (B10): pin the close X to the top-right of the panel, not next to the title. */
  margin-left: auto;
  background: transparent;
  border: none;
  color: var(--ui-muted);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem);
  cursor: pointer;
}
/* result phase */
.pg-result {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  padding: 28px 20px;
}
/* #140: the defectors reveal on the end-screen result window (which players walked after a concession). */
.pg-defectors {
  margin: 0 20px 18px;
  padding: 10px 14px;
  border-top: 1px solid #ffffff1a;
  text-align: center;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.92rem);
  color: #ffd0d0;
}
.pg-defector-names { color: #fff; font-weight: 700; }
/* #169: end-of-match result rows (gold winnings + dedicated-fans roll per team) on the end-screen. */
.pg-endstats {
  margin: 0 20px 4px;
  padding: 10px 14px 2px;
  border-top: 1px solid #ffffff1a;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pg-endstat-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem);
  flex-wrap: wrap;
}
.pg-endstat-team { flex: 0 0 auto; min-width: 120px; font-weight: 700; color: var(--ui-heading); }
.pg-endstat-gold { color: #ffd76a; font-variant-numeric: tabular-nums; font-weight: 700; }
.pg-endstat-fans { color: var(--ui-text); font-variant-numeric: tabular-nums; }
.pg-endstat-d6 { --d6-size: 1.6em; margin: -0.18em 0.08em -0.12em; }
.pg-endstat-fans.muted { color: var(--ui-muted); font-style: italic; }
.pg-team {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px;
  border-radius: 10px;
}
.pg-team.winner {
  background: color-mix(in srgb, var(--ui-accent) 10%, transparent);
  outline: 1px solid color-mix(in srgb, var(--ui-accent) 33%, transparent);
}
.pg-team img { width: 68px; height: 68px; object-fit: contain; image-rendering: pixelated; }
.pg-team-name { font-weight: 800; text-align: center; }
/* #235 (owner-fg 07-29): keep long single-line team names inside every post-game panel column. */
.pg-team { min-width: 0; }
.pg-mvp-head span,
.pg-roster-team-toggle span {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Owner ruling 08-17: EndGame result-window team name WRAPS instead of truncating
   (was sharing the #235 ellipsis rule above with MVP/roster headers). Scoped to
   .pg-team-name only — MVP head + roster toggle keep single-line ellipsis. */
.pg-team-name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  max-width: 180px;
  overflow: hidden;
  white-space: normal;
  overflow-wrap: break-word;
  word-break: break-word;
}
.pg-mvp-head span { min-width: 0; }
.pg-team-coach { font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: var(--ui-muted); }
.pg-scoreline { text-align: center; }
.pg-score {
  font-family: 'Nuffle', sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 3rem);
  font-weight: 900;
  color: var(--ui-text);
  line-height: 1;
}
.pg-score span { color: var(--ui-text-dim); margin: 0 8px; }
.pg-verdict { margin-top: 8px; color: var(--ui-accent); font-weight: 700; }
/* MVP phase */
.pg-mvp {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 22px 20px;
}
.pg-mvp-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 800;
  margin-bottom: 8px;
  /* Owner 09-09: the team name/crest row is a shaded BAR (surface band with a soft top highlight) instead of a
     bare underlined line, so each MVP column reads as headed. */
  padding: 6px 10px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--ui-surface-2) 70%, #fff 8%) 0%, var(--ui-surface-2) 55%, color-mix(in srgb, var(--ui-surface-2) 80%, #000 20%) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 1px 2px rgba(0, 0, 0, 0.45);
}
.pg-mvp-head img { width: 30px; height: 30px; object-fit: contain; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.6)); }
.pg-mvp ul { list-style: none; margin: 0; padding: 0; }
.pg-mvp li { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; }
.pg-star { color: var(--ui-accent); }
.pg-mvp-name { font-weight: 700; }
.pg-mvp-pos { font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: var(--ui-muted); }
.pg-mvp-x { margin-left: auto; color: var(--ui-accent); }
.pg-mvp-none { color: var(--ui-text-dim); font-style: italic; }
/* #25-v2: per-player roster/SPP summary */
.pg-roster { padding: 22px 20px; }
/* #235 (owner-fg 07-29): two-name selector above the single visible roster. */
.pg-roster-team-toggle { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-bottom: 8px; }
.pg-roster-team-toggle button {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 0 6px;
  border: 0;
  border-bottom: 1px solid var(--ui-border);
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
.pg-roster-team-toggle button[data-active='true'] { border-bottom-color: var(--ui-accent); color: var(--ui-text); }
.pg-roster-team-toggle img { width: 26px; height: 26px; flex: 0 0 auto; object-fit: contain; }
.pg-roster-team-toggle span { min-width: 0; }
.pg-roster-list { list-style: none; margin: 8px 0 0; padding: 0; max-height: 320px; overflow-y: auto; }
.pg-roster-list li { display: flex; align-items: baseline; gap: 8px; padding: 4px 0; border-top: 1px solid var(--ui-border); }
.pg-roster-name { font-weight: 700; }
.pg-roster-pos { font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: var(--ui-muted); }
.pg-roster-spp { margin-left: auto; color: var(--ui-accent); font-variant-numeric: tabular-nums; font-weight: 700; }
.pg-roster-spp[data-zero='true'] { color: var(--ui-text-dim); font-weight: 400; }

/* Owner 2026-07-15: MVP NOMINATION roster-summary modal (mirrors .postgame / .pg-roster; theme-token driven). */
.mvp-nominate-overlay {
  position: absolute; z-index: 55; inset: 0;
  display: flex; align-items: center; justify-content: center; padding: 24px;
  background: radial-gradient(ellipse at center, #000c 0%, #0009 60%, #0006 100%);
  animation: coin-caption-in var(--p-350) ease-out;
}
.mvp-nominate-card {
  /* #45 (owner tester): the MVP / end-of-game screen fills ~the viewport (was a 460px modal). */
  width: min(920px, 96vw); height: min(94vh, 940px);
  display: flex; flex-direction: column; overflow: hidden;
  background: linear-gradient(180deg, var(--ui-surface-2) 0%, var(--ui-surface) 100%);
  border: 1px solid var(--ui-border); border-radius: 12px;
  box-shadow: 0 12px 40px #000c; color: var(--ui-text);
}
/* #63 re-present mirror: per-round pop-in so a re-emitted nominate visibly re-pops (fresh-window motion). */
/* Owner 08-17 (Riotous Rookies overflow): a roster can now exceed 16 (mid-game adds), and .mvp-nominate-card
   is a fixed-height flex column with overflow:hidden — without its own flex sizing, .mvp-nominate-round grew
   to fit ALL rows and got clipped by the card, carrying the confirm button off-screen with no way to reach it.
   flex:1/min-height:0 lets the round claim only the space left after the result banner + team chips, so its
   OWN list (below) is what scrolls, not the card. */
.mvp-nominate-round {
  animation: mvp-round-pop 0.34s cubic-bezier(0.2, 0.9, 0.3, 1.3);
  display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0;
}
@keyframes mvp-round-pop {
  0% { opacity: 0; transform: scale(0.94) translateY(6px); }
  60% { opacity: 1; }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}
@media (prefers-reduced-motion: reduce) { .mvp-nominate-round { animation: none; } }
.mvp-nominate-head {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px; border-bottom: 1px solid var(--ui-border);
}
.mvp-nominate-logo { width: 24px; height: 24px; object-fit: contain; }
.mvp-nominate-title { font-weight: 700; color: var(--ui-heading); }
.mvp-nominate-count { margin-left: auto; font-weight: 700; color: var(--ui-accent); font-variant-numeric: tabular-nums; }
/* Roster scrolls INSIDE its own box (wide-content-scrolls-in-place discipline) — flex:1/min-height:0 lets it
   shrink to the round's available space, max-height is a relative-unit backstop for small windows; the
   confirm button in .mvp-nominate-foot (below, flex:0 0 auto) stays pinned and always reachable. */
.mvp-nominate-list { list-style: none; margin: 0; padding: 2px 0; overflow-y: auto; flex: 1 1 auto; min-height: 0; max-height: 50vh; }
.mvp-nominate-row {
  /* #46 (owner tester): strict aligned columns — check | # | name | position | skills | SPP —
     so every row's name/position/SPP line up (was a flex row that drifted with content width). */
  display: grid;
  grid-template-columns: 16px 2.6em minmax(7em, 1.4fr) minmax(6em, 1fr) minmax(0, 1.5fr) auto;
  align-items: center; gap: 12px;
  padding: 7px 18px; cursor: pointer; border-top: 1px solid var(--ui-border);
}
.mvp-nominate-row:first-child { border-top: none; }
.mvp-nominate-row[data-eligible='true']:hover { background: var(--ui-hover); }
.mvp-nominate-row[data-eligible='false'] { cursor: default; opacity: 0.45; }
.mvp-nominate-row[data-checked='true'] { background: var(--ui-hover); box-shadow: inset 3px 0 0 var(--ui-accent); }
.mvp-nominate-check { pointer-events: none; width: 16px; height: 16px; flex: none; accent-color: var(--ui-accent); }
.mvp-nominate-nr { color: var(--ui-text-dim); min-width: 2.2em; font-variant-numeric: tabular-nums; }
.mvp-nominate-name { font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mvp-nominate-pos { font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: var(--ui-muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mvp-nominate-skills { font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: var(--ui-accent); font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mvp-nominate-spp { justify-self: end; color: var(--ui-text); font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mvp-nominate-spp[data-zero='true'] { color: var(--ui-text-dim); font-weight: 400; }
.mvp-nominate-spp-gain { color: var(--ui-success); font-size: max(var(--ui-min-text-size, 12px), 0.85em); }
.mvp-nominate-foot { padding: 12px 18px; border-top: 1px solid var(--ui-border); display: flex; justify-content: flex-end; flex: 0 0 auto; }
.mvp-nominate-confirm {
  padding: 8px 18px; border: none; border-radius: 8px; font-weight: 700; cursor: pointer;
  background: var(--ui-accent); color: var(--ui-text-on-accent);
}
.mvp-nominate-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
/* Owner 2026-07-15: unified staged MVP screen — result banner + both-teams chips + waiting/reveal. */
.mvp-screen-result { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--ui-border); font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); color: var(--ui-text-dim); }
.mvp-screen-result b { color: var(--ui-text); font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); font-variant-numeric: tabular-nums; }
.mvp-screen-team { color: var(--ui-text); }
.mvp-screen-final { color: var(--ui-muted); }
.mvp-screen-dot { color: var(--ui-text-dim); }
.mvp-screen-chips { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 12px 16px; }
.mvp-screen-chip { border: 1px solid var(--ui-border); border-radius: 10px; padding: 9px 12px; background: var(--ui-surface-2); }
.mvp-screen-chip.mine { border-color: var(--ui-accent); }
.mvp-screen-chip-team { font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: var(--ui-muted); margin-bottom: 2px; }
/* #44: winner portrait (the in-game sprite rendered to a data URL — no fetch) revealed at roulette landing. */
.mvp-screen-portrait {
  display: block; width: 100%; max-width: 128px; aspect-ratio: 1; margin: 6px auto 6px;
  border-radius: 8px; object-fit: cover; object-position: top center;
  border: 1px solid var(--ui-accent); background: var(--ui-surface);
  image-rendering: pixelated; /* sprite portraits are pixel art */
  animation: mvp-portrait-in var(--p-400) ease-out;
}
@keyframes mvp-portrait-in { 0% { opacity: 0; transform: scale(0.82); } 100% { opacity: 1; transform: scale(1); } }
.mvp-screen-you { color: var(--ui-text-dim); }
.mvp-screen-chip-mvp { display: flex; align-items: center; gap: 6px; font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); font-weight: 700; }
.mvp-screen-mvp-lbl { color: var(--ui-text-dim); font-weight: 400; }
.mvp-screen-mvp-name { color: var(--ui-text-dim); }
.mvp-screen-mvp-name[data-phase='landed'] { color: var(--ui-accent); }
/* #63 reveal-×N: award-count badge + additional-winner rows (a 2-MVP concede/win). */
/* #105 (Yularen ruling): the same-player double-MVP was easy to miss as a tiny ×2 — make the per-award count
   an unmistakable bordered accent pill (token-only, theme-safe: no on-accent text color assumed). */
.mvp-screen-mvp-x { color: var(--ui-accent); font-weight: 800; font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); border: 1px solid var(--ui-accent); border-radius: 8px; padding: 0 5px; margin-left: 5px; letter-spacing: 0.3px; }
/* #168: an extra MVP winner row now reuses .mvp-screen-chip-mvp (head-row style); only spacing differs here. */
.mvp-screen-extra { margin-top: 3px; }
.mvp-screen-star::before { content: '\2605'; color: var(--ui-accent); margin-right: 4px; }
@keyframes mvpChipFlash { 0% { box-shadow: 0 0 0 0 var(--ui-accent); } 30% { box-shadow: 0 0 16px 1px var(--ui-accent); } 100% { box-shadow: 0 0 0 0 transparent; } }
.mvp-screen-chip.mvp-flash { animation: mvpChipFlash var(--p-1000) ease-out; }
.mvp-waiting { position: absolute; top: 14px; right: 14px; z-index: 2; background: var(--ui-surface-2); border: 1px solid var(--ui-border); border-radius: 8px; padding: 8px 12px; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); color: var(--ui-text-dim); }
.mvp-waiting-dots i { animation: mvp-wait-dot 1.2s infinite; opacity: 0; }
.mvp-waiting-dots i:nth-child(2) { animation-delay: 0.2s; }
.mvp-waiting-dots i:nth-child(3) { animation-delay: 0.4s; }
@keyframes mvp-wait-dot { 0%, 60%, 100% { opacity: 0; } 30% { opacity: 1; } }
/* #25-v2: MVP roulette reveal (presentation only — lands on the server award) */
.pg-mvp-roulette { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; }
.pg-mvp-spin {
  font-weight: 700;
  color: var(--ui-accent);
  animation: pg-mvp-flicker var(--p-90) steps(1) infinite;
}
@keyframes pg-mvp-flicker { 0% { opacity: 0.55; } 100% { opacity: 1; } }
.pg-mvp-awaiting { color: var(--ui-text); }
.pg-mvp-awaiting::after {
  content: '';
  animation: pg-mvp-dots var(--p-1200) steps(4, end) infinite;
}
@keyframes pg-mvp-dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }
@media (prefers-reduced-motion: reduce) {
  .pg-mvp-spin, .pg-mvp-awaiting::after { animation: none; }
}
/* stats phase */
/* owner 2026-07-05: larger post-game statistics text */
.pg-stats { padding: 16px 20px 22px; }
.pg-stats table { width: 100%; table-layout: fixed; border-collapse: collapse; }
.pg-stats th { padding: 8px 10px; font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); color: var(--ui-text); }
/* #235 (owner-fg 07-29): clamp team headers within fixed statistic columns. */
.pg-stats th.pg-h,
.pg-stats th.pg-a { width: 25%; max-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pg-stats th.pg-h { text-align: left; }
.pg-stats th.pg-a { text-align: right; }
/* #235 (owner-fg 07-29): body labels were already centered; center their empty header as well. */
.pg-stats th.pg-stat-label { text-align: center; }
.pg-stats td { padding: 8px 10px; border-top: 1px solid var(--ui-border); font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem); }
.pg-stats td.pg-h { text-align: left; width: 25%; font-variant-numeric: tabular-nums; }
.pg-stats td.pg-a { text-align: right; width: 25%; font-variant-numeric: tabular-nums; }
.pg-stats td.pg-stat-label { text-align: center; color: var(--ui-muted); font-size: max(var(--ui-min-primary-text-size, 16px), 1.02rem); }
.pg-stats td[data-lead='true'] { color: var(--ui-accent); font-weight: 800; }

/* Shared d6/d3 pip die used by live-authoritative game presentations. */
.wc-die {
  --d6-size: 84px;
  width: 84px;
  height: 84px;
  filter: drop-shadow(0 10px 13px #000a);
}
.wc-die.d3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 4px;
  padding: 12px;
  border-radius: 16px;
  background: linear-gradient(150deg, #f4efe4 0%, #d9cfb8 100%);
  border: 3px solid #b8ac90;
  box-shadow: 0 10px 26px #000a, inset 0 2px 6px #fff8;
}
.wc-die.d3 { width: 68px; height: 68px; padding: 10px; }
.wc-die.d3 .pip { border-radius: 50%; background: transparent; align-self: center; justify-self: center; width: 82%; height: 82%; }
.wc-die.d3 .pip[data-on='true'] { background: radial-gradient(circle at 38% 34%, #4a4a52 0%, #14141a 80%); box-shadow: inset 0 1px 2px #0008; }

/* Shared live dice cine — two dice fly in from the ends and converge. */
.dice-cine,
.weather-cine {
  position: absolute;
  z-index: 45;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 26px;
  background: radial-gradient(ellipse at center, #0008 0%, #0000 62%);
  pointer-events: none;
}
.dice-cine { animation: coin-fade var(--p-3800) ease-out forwards; }
.weather-cine { animation: coin-fade var(--p-5600) ease-out forwards; }
.wc-dice { display: flex; gap: 30px; }
.wc-die.from-north { animation: wc-drop-north var(--p-1000) cubic-bezier(0.25, 0.6, 0.3, 1) forwards; }
.wc-die.from-south { animation: wc-drop-south var(--p-1000) cubic-bezier(0.25, 0.6, 0.3, 1) forwards; }
@keyframes wc-drop-north {
  0% { transform: translateY(-60vh) rotate(-220deg) scale(0.6); opacity: 0; }
  70% { opacity: 1; }
  100% { transform: translateY(0) rotate(0) scale(1); opacity: 1; }
}
@keyframes wc-drop-south {
  0% { transform: translateY(60vh) rotate(220deg) scale(0.6); opacity: 0; }
  70% { opacity: 1; }
  100% { transform: translateY(0) rotate(0) scale(1); opacity: 1; }
}
.wc-caption {
  display: flex;
  align-items: center;
  gap: 16px;
  opacity: 0;
  animation: coin-caption-in var(--p-400) ease-out var(--p-1000) forwards;
}
.dice-title,
.wc-title {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem);
  font-weight: 800;
  letter-spacing: 0.18em;
  color: var(--ui-heading);
  text-shadow: 0 2px 6px #000d;
  opacity: 0;
  animation: coin-caption-in var(--p-400) ease-out var(--p-150) forwards;
}
.dice-icon,
.wc-icon { font-size: max(var(--ui-min-primary-text-size, 16px), 2.2rem); line-height: 1; filter: drop-shadow(0 2px 5px #000b); }
.dice-label,
.wc-weather { font-size: max(var(--ui-min-primary-text-size, 16px), 1.7rem); font-weight: 800; color: var(--ui-heading); text-shadow: 0 2px 6px #000d; }
/* Owner 2026-07-06: Dodgy Snack "can't play this drive" splash (centred card, z 47). */
.dodgy-snack-splash {
  position: absolute;
  z-index: 47;
  left: 50%;
  top: 40%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: 460px;
  padding: 14px 20px;
  border-radius: 10px;
  background: rgba(14, 18, 26, 0.94);
  border: 1px solid #6a7a3a;
  box-shadow: 0 6px 24px #000a;
  pointer-events: none;
  animation: coin-caption-in var(--p-350) ease-out forwards;
}
.dodgy-snack-splash .dss-emoji { font-size: max(var(--ui-min-primary-text-size, 16px), 34px); line-height: 1; }
.dodgy-snack-splash .dss-text {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  color: #eef0e6;
  line-height: 1.3;
}
.dodgy-snack-splash .dss-text b { color: #b7e05a; }
/* Kick-off EVENT splash — FUMBBL's kick-off_<event>.png banner + the 2d6 roll */
.kickoff-cine {
  position: absolute;
  z-index: 46;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: radial-gradient(ellipse at center, #000a 0%, #0000 66%);
  pointer-events: none;
  /* Owner 09-05: the fade must match the card's dwell (KICKOFF_CINE_MS = 1800) — at 900 the container faded to
     nothing halfway through the hold, which read as the splash being torn down early. */
  animation: coin-fade var(--p-1800) ease-out forwards;
}
.ko-splash {
  width: min(64%, 600px);
  height: auto;
  filter: drop-shadow(0 12px 30px #000c);
  transform: scale(0.8);
  opacity: 0;
  animation: ko-splash-in var(--p-550) cubic-bezier(0.2, 0.9, 0.3, 1.2) var(--p-150) forwards;
}
@keyframes ko-splash-in {
  0% { transform: scale(0.8) translateY(18px); opacity: 0; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
}
/* Weather Change (no FUMBBL banner) — the event name rendered large. */
.ko-name-big {
  font-size: max(var(--ui-min-primary-text-size, 16px), 3.4rem);
  font-weight: 900;
  letter-spacing: 0.01em;
  color: var(--ui-heading);
  text-shadow: 0 3px 14px #000f, 0 0 26px #e8b84a55;
  transform: scale(0.85);
  opacity: 0;
  animation: ko-splash-in var(--p-550) cubic-bezier(0.2, 0.9, 0.3, 1.2) var(--p-150) forwards;
}
/* Dice float in the upper band — centred between the turn timer and the splash
   banner, drawn over the top of it. */
.ko-dice {
  position: absolute;
  top: 22%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 16px;
  opacity: 0;
  animation: coin-caption-in var(--p-400) ease-out var(--p-300) forwards;
}
.ko-die {
  --d6-size: 58px;
  width: 58px;
  height: 58px;
  filter: drop-shadow(0 8px 10px #000a);
}
/* B8-3: fan-factor cinematic — a d3 per side + the difference splash */
.fan-cine {
  position: absolute;
  z-index: 45;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 26px;
  background: radial-gradient(ellipse at center, #0008 0%, #0000 62%);
  pointer-events: none;
  animation: coin-fade var(--p-6400) ease-out forwards;
}
.fan-rolls { display: flex; gap: 60px; }
.fan-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 20px;
  border-radius: 12px;
  border: 2px solid #ffffff20;
}
.fan-side.home { animation: wc-drop-south var(--p-900) cubic-bezier(0.25, 0.6, 0.3, 1) forwards; }
.fan-side.away { animation: wc-drop-north var(--p-900) cubic-bezier(0.25, 0.6, 0.3, 1) forwards; }
.fan-side[data-leader='true'] { background: color-mix(in srgb, var(--ui-accent) 13%, transparent); border-color: color-mix(in srgb, var(--ui-accent) 67%, transparent); box-shadow: 0 0 20px color-mix(in srgb, var(--ui-accent) 27%, transparent); }
.fan-coach { font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem); font-weight: 800; color: var(--ui-heading); text-shadow: 0 2px 5px #000d; }
.fan-math { font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); color: #e8e2d0; text-shadow: 0 1px 4px #000d; }
.fan-math b { color: var(--ui-heading); font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem); }
.fan-splash {
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.5rem);
  font-weight: 800;
  color: var(--ui-heading);
  text-shadow: 0 2px 6px #000d;
  opacity: 0;
  animation: coin-caption-in var(--p-400) ease-out var(--p-950) forwards;
}
.fan-splash b { color: #ffd24a; font-size: max(var(--ui-min-primary-text-size, 16px), 1.8rem); }

.opponent-setup-notice {
  z-index: 42;
  pointer-events: none;
}
.opponent-setup-notice :deep(.pitch-confirm-title) {
  overflow-wrap: anywhere;
  text-wrap: balance;
  white-space: normal;
}
.opponent-setup-notice :deep(.pitch-confirm-body) {
  color: var(--ui-muted);
  font-size: max(var(--ui-min-text-size, 12px), 11px);
  letter-spacing: .08em;
  text-transform: uppercase;
}

/* Owner 2026-07-04: interactive team-setup panel (left edge). */
.setup-panel {
  position: absolute;
  z-index: 42;
  top: 50%;
  left: 12px;
  /* #81 (owner tester): enlarge the "SET UP YOUR TEAM" card + ALL its elements by 30% (sizing only, stage-2
     skip). A uniform scale grows font + padding + radius + borders together (the #13 +30% effect applied to a
     multi-element panel in one place). Origin left-center pins the left edge at 12px and keeps it vertically
     centered (scale about center + translateY(-50%) leaves the card centered). */
  transform: translateY(-50%) scale(1.3);
  transform-origin: left center;
  width: 224px;
}
/* Owner 2026-07-14 (setup overhaul #1): the deprecated big-window panel is now a COMPACT rules+actions card on
   the RIGHT, over the dugout "reserves box" (reserves are dragged from the dugout, not chips). */
.setup-card {
  /* Owner batch #3 #1 (2026-07-14): flip to the LEFT — pinned RIGHT it blocked the reserves view. */
  left: 12px;
  right: auto;
  width: 210px;
  padding: 10px 12px;
  background: rgba(14, 18, 26, 0.92);
  border: 1px solid rgba(120, 150, 190, 0.5);
  border-radius: 8px;
  color: #dfe6ff;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
}
.setup-title {
  font-weight: 800;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
  color: var(--ui-heading);
}
.setup-conditions { list-style: none; margin: 0 0 8px; padding: 0; }
.setup-conditions li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  color: #ff8a8a;
}
.setup-conditions li.ok { color: #7ee59a; }
.setup-mark { font-weight: 900; width: 12px; text-align: center; }
.setup-reserve-label { margin: 6px 0 4px; font-size: max(var(--ui-min-text-size, 12px), 10.5px); opacity: 0.75; }
/* Owner 2026-07-15 (click-to-place): the live selection echo — which player is picked + the next-tap hint. */
.setup-selected {
  margin: 2px 0 6px;
  padding: 4px 7px;
  font-size: max(var(--ui-min-text-size, 12px), 10.5px);
  line-height: 1.35;
  border-radius: 5px;
  background: color-mix(in srgb, var(--ui-accent, #f5c542) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--ui-accent, #f5c542) 45%, transparent);
}
.setup-selected b { color: var(--ui-accent, #f5c542); }
.setup-selected[data-setup-error] ul { margin: 5px 0 0; padding-left: 18px; }
.setup-selected[data-setup-error] li { margin-top: 3px; }
.setup-reserves { display: flex; flex-wrap: wrap; gap: 4px; max-height: 168px; overflow-y: auto; }
.setup-reserve-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  font-size: max(var(--ui-min-text-size, 12px), 11px);
  color: #dfe6ff;
  background: rgba(40, 52, 70, 0.9);
  border: 1px solid rgba(120, 150, 190, 0.4);
  border-radius: 5px;
  cursor: pointer;
}
.setup-reserve-chip.sel { background: #2a6cff; border-color: #9fc0ff; }
.setup-nr {
  font-weight: 800;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 3px;
  padding: 0 3px;
  font-size: max(var(--ui-min-text-size, 12px), 10px);
}
.setup-empty { opacity: 0.6; font-style: italic; }
.setup-actions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
.setup-btn {
  flex: 1 1 auto;
  padding: 5px 8px;
  font-size: max(var(--ui-min-text-size, 12px), 11px);
  font-weight: 700;
  color: #dfe6ff;
  background: rgba(50, 64, 86, 0.95);
  border: 1px solid rgba(120, 150, 190, 0.5);
  border-radius: 5px;
  cursor: pointer;
}
.setup-btn:disabled { opacity: 0.4; cursor: default; }
.setup-btn.done { background: #1f8a3a; border-color: #4fd076; }
.setup-btn.done:disabled { background: rgba(50, 64, 86, 0.95); }
.setup-btn.concede { background: #8a2020; border-color: #d05050; flex-basis: 100%; }

/* Compact floating formation browser. The default height exposes one two-card row;
   remaining formations scroll inside. Drag the title rail; resize from the SE corner. */
.setup-template-panel {
  position: absolute;
  z-index: 42;
  display: flex;
  flex-direction: column;
  min-width: 286px;
  min-height: 220px;
  max-width: 80%;
  max-height: 80%;
  box-sizing: border-box;
  padding: 9px;
  color: #dfe6ff;
  background: rgba(14, 18, 26, 0.92);
  border: 1px solid rgba(120, 150, 190, 0.5);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  resize: both;
}
.setup-template-panel::after {
  content: '';
  position: absolute;
  z-index: 5;
  right: 4px;
  bottom: 4px;
  width: 14px;
  height: 14px;
  pointer-events: none;
  background: repeating-linear-gradient(135deg, transparent 0 3px, #89919b 3px 5px);
  opacity: 0.8;
}
@media (max-width: 799px) {
  .setup-panel.setup-card {
    width: calc(30vw - 26px);
    max-height: calc(100% - 136px);
    overflow-y: auto;
    transform: translateY(-50%);
  }
}
.setup-template-title {
  flex: none;
  margin: 0 2px 7px;
  color: var(--ui-heading);
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  font-weight: 800;
  letter-spacing: 0.06em;
}
.setup-template-windowbar {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: move;
  user-select: none;
}
.setup-template-grip {
  flex: none;
  color: rgba(223, 230, 255, 0.6);
  font-size: max(var(--ui-min-primary-text-size, 16px), 15px);
  line-height: 1;
  user-select: none;
}
.setup-template-tabs { display: flex; flex: 1 1 auto; min-width: 0; gap: 4px; }
.setup-template-tab {
  flex: 1 1 0;
  min-width: 0;
  padding: 3px 5px;
  color: rgba(223, 230, 255, 0.65);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  font: inherit;
  letter-spacing: inherit;
  cursor: pointer;
}
.setup-template-tab.active {
  color: var(--ui-heading);
  background: rgba(42, 108, 255, 0.24);
  border-color: rgba(159, 192, 255, 0.55);
}
.setup-collapse-button {
  flex: none;
  padding: 3px 6px;
  color: rgba(223, 230, 255, 0.82);
  background: rgba(22, 29, 40, 0.82);
  border: 1px solid rgba(120, 150, 190, 0.5);
  border-radius: 4px;
  font: inherit;
  letter-spacing: normal;
  cursor: pointer;
}
.setup-collapse-button:hover,
.setup-collapse-button:focus-visible { border-color: rgba(159, 192, 255, 0.9); }
.setup-template-list {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: max-content;
  align-content: start;
  gap: 7px;
  min-height: 0;
  padding-right: 3px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.setup-template-card {
  min-width: 0;
  padding: 6px;
  color: #dfe6ff;
  background: rgba(40, 52, 70, 0.9);
  border: 1px solid rgba(120, 150, 190, 0.4);
  border-radius: 6px;
  cursor: pointer;
  outline: none;
}
.setup-template-card:hover,
.setup-template-card:focus-visible { border-color: rgba(159, 192, 255, 0.85); }
.setup-template-card.active {
  background: rgba(42, 108, 255, 0.32);
  border-color: #9fc0ff;
  box-shadow: inset 0 0 0 1px rgba(159, 192, 255, 0.22);
}
.saved-setup-card { cursor: default; }
.setup-template-list > .saved-setup-save,
.setup-template-list > .setup-empty { grid-column: 1 / -1; }
.saved-setup-save {
  flex: none;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 5px;
  padding-bottom: 7px;
  border-bottom: 1px solid rgba(120, 150, 190, 0.25);
}
.saved-setup-input {
  min-width: 0;
  padding: 5px 6px;
  color: #dfe6ff;
  background: rgba(22, 29, 40, 0.95);
  border: 1px solid rgba(120, 150, 190, 0.5);
  border-radius: 5px;
  font-size: max(var(--ui-min-text-size, 12px), 11px);
}
.saved-setup-help {
  grid-column: 1 / -1;
  color: rgba(223, 230, 255, 0.62);
  font-size: max(var(--ui-min-text-size, 12px), 9px);
  line-height: 1.25;
}
.saved-setup-status {
  grid-column: 1 / -1;
  color: #efca68;
  font-size: max(var(--ui-min-text-size, 12px), 10px);
  line-height: 1.25;
}
.saved-setup-status.saved { color: #67d88a; }
.saved-setup-status.failed { color: #ff7777; }
.setup-template-preview.saved-setup-placeholder {
  display: grid;
  place-items: center;
  color: rgba(223, 230, 255, 0.48);
  background: rgba(58, 64, 72, 0.72);
  border-color: rgba(160, 170, 185, 0.32);
  font-size: max(var(--ui-min-text-size, 12px), 9px);
  font-style: italic;
}
.saved-setup-actions { display: flex; gap: 5px; margin-top: 6px; }
.saved-setup-actions .setup-btn { min-width: 0; padding-inline: 5px; }
.saved-setup-delete { color: #ffd7d7; border-color: rgba(208, 80, 80, 0.65); }
.setup-template-preview {
  display: grid;
  width: 100%;
  aspect-ratio: 15 / 13;
  overflow: hidden;
  background:
    linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    #274f34;
  background-size: calc(100% / 15) calc(100% / 13);
  border: 1px solid rgba(175, 205, 180, 0.35);
  border-radius: 3px;
  box-sizing: border-box;
}
.setup-template-preview-los {
  z-index: 0;
  align-self: stretch;
  background: rgba(235, 220, 150, 0.16);
  border-top: 1px solid rgba(255, 229, 145, 0.8);
}
.setup-template-token {
  z-index: 1;
  place-self: center;
  width: 68%;
  aspect-ratio: 1;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.78);
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
}
.setup-template-name {
  min-height: 2.4em;
  margin-top: 5px;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: max(var(--ui-min-text-size, 12px), 11px);
  font-weight: 800;
  line-height: 1.2;
  text-align: center;
  white-space: normal;
}
.setup-template-mirror {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 4px;
  color: rgba(223, 230, 255, 0.78);
  font-size: max(var(--ui-min-text-size, 12px), 10px);
  cursor: pointer;
}
.setup-template-mirror input { margin: 0; }

/* Owner 2026-07-04: shared decision buttons + send-off result cinematic. */
.sendoff-btn {
  padding: 9px 12px;
  font-size: max(var(--ui-min-primary-text-size, 16px), 14px);
  font-weight: 700;
  color: #f3f0e6;
  background: rgba(50, 64, 86, 0.95);
  border: 1px solid rgba(150, 175, 210, 0.55);
  border-radius: 7px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.sendoff-btn.argue { background: #2f5aa8; border-color: #6f9fe0; }
.sendoff-btn.bribe { background: var(--ui-accent); border-color: #e0be6f; }
.sendoff-btn.pass { background: rgba(50, 64, 86, 0.95); }
/* Owner 2026-07-04 (interaction catalog 0.2): generic yes/no card. */
.yesno-card {
  position: absolute;
  z-index: 47;
  top: 40%;
  left: 50%;
  transform: translate(-50%, -50%);
  max-width: 420px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  background: rgba(14, 18, 26, 0.94);
  border: 1px solid rgba(150, 175, 210, 0.4);
  border-radius: 10px;
  box-shadow: 0 8px 28px #000c;
}
.yesno-text { font-size: max(var(--ui-min-primary-text-size, 16px), 15px); color: #f3f0e6; text-align: center; white-space: pre-wrap; }
/* #86 (owner tester): enlarge the end-turn confirm modal +30% (sizing only, stage-2 skip). Scoped to the
   .end-turn-warn modifier (higher specificity than the shared .yesno-card) so the other yes/no modals
   (keyword / skill / coin-wait) are untouched; scale keeps the centered transform's origin → stays centered. */
.yesno-card.end-turn-warn { transform: translate(-50%, -50%) scale(1.3); }
/* Owner 2026-07-04e: UI-customize mode — grip/resizer/reset on the corner panels */
.ui-panel.ui-customizing { outline: 1px dashed color-mix(in srgb, var(--ui-accent) 53%, transparent); outline-offset: 2px; }
.ui-panel.ui-resizing { transition: none !important; }
.ui-grip, .ui-resizer, .ui-reset {
  position: absolute;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 24, 32, 0.95);
  border: 1px solid var(--ui-accent);
  color: var(--ui-heading);
  cursor: pointer;
}
/* Owner 09-06: the handles were 16-18 px nubs — now 28 px targets with a solid accent border, still on the corners:
   grip top-left, reset top-right, resizer bottom-right. */
.ui-grip, .ui-resizer, .ui-reset { width: 28px; height: 28px; border-width: 2px; border-radius: 7px; box-shadow: 0 2px 8px #000c; }
.ui-grip { top: -12px; left: -12px; font-size: max(var(--ui-min-text-size, 12px), 16px); cursor: grab; }
.ui-grip:active { cursor: grabbing; }
.ui-resizer { bottom: -12px; right: -12px; cursor: nwse-resize; }
.ui-resizer::after { content: '⤡'; font-size: max(var(--ui-min-text-size, 12px), 17px); }
.ui-reset { top: -12px; right: -12px; font-size: max(var(--ui-min-text-size, 12px), 17px); padding: 0; }
.ui-grip:hover, .ui-resizer:hover, .ui-reset:hover { background: color-mix(in srgb, var(--ui-accent) 35%, rgba(20, 24, 32, 0.95)); }
/* Owner 2026-07-04e: unknown-call diagnostic panel (centred) */
.unknown-call {
  position: absolute;
  z-index: 61;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 360px;
  max-height: 80vh;
  /* Owner 2026-07-04f: movable (header) + RESIZABLE (style requirement) */
  resize: both;
  overflow: auto;
  min-width: 260px;
  min-height: 160px;
  background: rgba(20, 16, 26, 0.97);
  border: 1px solid #b06a2e;
  border-radius: 10px;
  box-shadow: 0 10px 34px #000d;
}
.uc-head { padding: 9px 14px; font-size: max(var(--ui-min-primary-text-size, 16px), 13px); font-weight: 800; color: var(--ui-heading); background: #3a2410; border-radius: 10px 10px 0 0; cursor: move; display: flex; justify-content: space-between; }
.uc-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 9px; }
.uc-body p { margin: 0; font-size: max(var(--ui-min-text-size, 12px), 12.5px); color: #e8e2d6; line-height: 1.4; }
.uc-args { font-size: max(var(--ui-min-text-size, 12px), 11.5px); color: #c8c2b6; }
.uc-args-label { font-weight: 700; color: var(--ui-heading); margin-right: 4px; }
.uc-args code { color: #9fd0ff; word-break: break-word; }
.uc-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.uc-btn {
  padding: 5px 10px; font-size: max(var(--ui-min-text-size, 12px), 11.5px); font-weight: 700; color: #f3ede0;
  background: rgba(50, 64, 86, 0.95); border: 1px solid rgba(150, 175, 210, 0.5);
  border-radius: 6px; cursor: pointer;
}
.uc-btn:hover { background: rgba(66, 84, 112, 0.95); }
.uc-btn.coord { background: var(--ui-accent); border-color: var(--ui-accent); }
.uc-btn.dismiss { background: #a02020; border-color: #e05050; }
.uc-status { font-size: max(var(--ui-min-text-size, 12px), 11px); color: #7ee59a; }
.uc-describe { display: flex; flex-direction: column; gap: 3px; font-size: max(var(--ui-min-text-size, 12px), 11.5px); color: #c8c2b6; }
.uc-describe textarea {
  width: 100%; box-sizing: border-box; resize: vertical; font-size: max(var(--ui-min-text-size, 12px), 12px);
  background: #10141a; color: #e8e2d6; border: 1px solid var(--ui-border); border-radius: 5px; padding: 5px;
}
.uc-coord-prompt { font-size: max(var(--ui-min-text-size, 12px), 12px); font-weight: 700; color: var(--ui-heading); }
.uc-foot { display: flex; justify-content: flex-end; }
/* Owner 2026-07-04d: persistent admin broadcast toast (top-right) */
.admin-message {
  position: absolute;
  z-index: 60;
  top: 64px;
  right: 12px;
  max-width: 260px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  background: rgba(30, 16, 16, 0.96);
  border: 1px solid #e0a030;
  border-radius: 8px;
  box-shadow: 0 6px 22px #000b;
}
.admin-message-head { font-size: max(var(--ui-min-text-size, 12px), 12px); font-weight: 800; color: var(--ui-heading); letter-spacing: 0.03em; }
.admin-message-body { font-size: max(var(--ui-min-primary-text-size, 16px), 13px); color: #f3ede0; white-space: pre-wrap; }
.admin-message-ack {
  align-self: flex-end;
  padding: 5px 12px;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  font-weight: 700;
  color: #fff;
  background: #a86a20;
  border: 1px solid #e0a030;
  border-radius: 6px;
  cursor: pointer;
}
.admin-message-ack:hover { background: #c17e28; }
/* Owner 2026-07-10: server messages + admin broadcasts live at CENTER-LEFT (was top-right). */
.center-left-notice {
  top: 50%;
  left: 12px;
  right: auto;
  transform: translateY(-50%);
}
/* server messages (info) sit just below the admin broadcast when both are up, and read blue not gold. */
.server-notice { top: 58%; border-color: #4f7fb0; background: rgba(16, 22, 30, 0.96); }
.server-notice .admin-message-head { color: #9fd0ff; }
.server-notice .admin-message-ack { background: #3a6187; border-color: #4f7fb0; }
.server-notice .admin-message-ack:hover { background: #4a76a2; }
/* Owner 2026-07-04f: Intensive Training skill-select card */
.select-skill-card { top: 38%; max-width: 340px; }
.skill-select-list { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.skill-select-opt {
  display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer;
  background: rgba(50, 64, 86, 0.9); border: 1px solid var(--ui-accent); border-radius: 7px;
  font-size: max(var(--ui-min-text-size, 12px), 12.5px); font-weight: 700; color: var(--ui-heading);
}
.skill-select-opt:hover { background: rgba(74, 90, 116, 0.95); border-color: var(--ui-accent); }
.skill-select-icon { width: 22px; height: 22px; image-rendering: pixelated; }
/* Owner 2026-07-04d: minimal buy-card menu */
.card-buy-menu { top: 38%; max-width: 340px; }
.card-gold { color: var(--ui-heading); font-weight: 800; }

/* Owner 2026-07-06: inducement selector panel */
.induce-panel {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  z-index: 48; width: 380px; max-height: 78vh; display: flex; flex-direction: column; gap: 8px;
  padding: 12px 14px; background: rgba(14, 18, 26, 0.97); border: 1px solid color-mix(in srgb, var(--ui-accent) 67%, transparent);
  border-radius: 10px; box-shadow: 0 8px 28px #000c, 0 0 14px color-mix(in srgb, var(--ui-accent) 20%, transparent); color: #e8ecf2;
}
.induce-head { font-family: 'Nuffle', sans-serif; font-size: max(var(--ui-min-primary-text-size, 16px), 17px); color: var(--ui-heading); text-align: center; }
/* g300 IND #B: pane text +4px across the picker (totals/name/cost/count/empty) — owner: "we can
   go 4 point larger comfortably". Container is a scroll pane (.induce-list overflow-y: auto), so
   longer rosters/lists just scroll rather than clip. */
.induce-totals { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px 10px; font-size: max(var(--ui-min-primary-text-size, 16px), 15.5px); padding: 6px 8px; background: rgba(0,0,0,0.3); border-radius: 6px; }
.induce-totals b { color: var(--ui-heading); }
.induce-totals span[data-low='true'] b { color: #ff6a6a; }
.induce-list { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; padding-right: 2px; }
.induce-row {
  display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px;
  padding: 5px 8px; border-radius: 6px; background: rgba(50, 64, 86, 0.5); border: 1px solid transparent;
  transition: opacity 0.18s ease, filter 0.18s ease; /* smooth dynamic affordability shading */
}
.induce-row[data-picked='true'] { background: rgba(90, 74, 32, 0.6); border-color: color-mix(in srgb, var(--ui-accent) 67%, transparent); }
/* Owner 2026-07-06: OCCLUDE (grey out) options the team can't buy — visible but dimmed. */
.induce-row[data-unavailable='true'] { opacity: 0.4; filter: grayscale(0.7); }
/* Recompute inducement affordability as gold changes; purchased options remain active. */
.induce-row[data-unaffordable='true']:not([data-picked='true']) { opacity: 0.4; filter: grayscale(1); }
.induce-row[data-star='true'] .induce-name { color: var(--ui-heading); }
.induce-star { color: var(--ui-heading); margin-right: 4px; }
.induce-name { font-size: max(var(--ui-min-primary-text-size, 16px), 16.5px); font-weight: 600; }
.induce-cost { font-size: max(var(--ui-min-primary-text-size, 16px), 16px); color: var(--ui-heading); font-weight: 700; min-width: 40px; text-align: right; }
.induce-stepper { display: flex; align-items: center; gap: 6px; }
.induce-btn {
  width: 22px; height: 22px; border-radius: 5px; border: 1px solid #5a6478; background: var(--ui-surface);
  color: var(--ui-text); font-weight: 800; font-size: max(var(--ui-min-primary-text-size, 16px), 14px); line-height: 1; cursor: pointer;
}
.induce-btn:disabled { opacity: 0.35; cursor: default; }
.induce-btn:not(:disabled):hover { border-color: var(--ui-accent); }
.induce-count { min-width: 34px; text-align: center; font-weight: 800; font-size: max(var(--ui-min-primary-text-size, 16px), 16.5px); }
.induce-count small { color: #9aa2b0; font-weight: 600; }
.induce-empty { font-size: max(var(--ui-min-primary-text-size, 16px), 16px); color: #9aa2b0; text-align: center; padding: 10px; }
.induce-actions { display: flex; gap: 8px; }
.induce-confirm {
  flex: 1; padding: 8px; border-radius: 7px; font-weight: 800; font-size: max(var(--ui-min-primary-text-size, 16px), 13px); cursor: pointer; border: 1px solid;
}
.induce-confirm { background: #2f7d3a; border-color: #4bd06a; color: #fff; }
.induce-confirm:disabled { opacity: 0.4; cursor: default; }
.card-buy-list { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.card-buy-opt {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  padding: 8px 10px; text-align: left; cursor: pointer;
  background: rgba(50, 64, 86, 0.9); border: 1px solid var(--ui-accent); border-radius: 7px;
}
.card-buy-opt:hover { background: rgba(74, 90, 116, 0.95); border-color: var(--ui-accent); }
.card-buy-name { font-size: max(var(--ui-min-primary-text-size, 16px), 13px); font-weight: 800; color: var(--ui-heading); }
.card-buy-desc { font-size: max(var(--ui-min-text-size, 12px), 11px); color: #d8d2c4; }
.card-buy-done { align-self: center; }
/* Owner 2026-07-04d: coin call / kick-receive choice */
.coin-choice-card { top: 40%; }
/* Owner 2026-07-10: "<winner> won the toss!" splash over the kick/receive card. */
.toss-winner-splash {
  font-size: max(var(--ui-min-primary-text-size, 16px), 20px);
  font-weight: 800;
  letter-spacing: 0.4px;
  text-align: center;
  color: var(--ui-heading);
  text-shadow: 0 2px 8px #000a, 0 0 18px color-mix(in srgb, var(--ui-accent) 25%, transparent);
}
/* Owner 2026-08-25: waiting and interactive kick/receive cards share one stable rail. */
.coin-wait-card { top: 40%; }
.coin-wait-card .yesno-text { font-weight: 700; }
.coin-wait-sub { font-size: max(var(--ui-min-text-size, 12px), 12px); color: #9fb0c8; letter-spacing: 0.06em; text-transform: uppercase; }
.coin-wait-spinner {
  width: 26px; height: 26px; border-radius: 50%;
  border: 3px solid rgba(255, 209, 102, 0.25); border-top-color: var(--ui-accent);
  animation: coin-wait-spin 0.8s linear infinite;
}
@keyframes coin-wait-spin { to { transform: rotate(360deg); } }
.coin-choice-actions { display: flex; flex-direction: row; gap: 12px; }
.coin-choice-actions .sendoff-btn { min-width: 96px; }
.coin-side { display: inline-flex; align-items: center; justify-content: center; margin-left: 6px; }
.coin-side img { width: 20px; height: 20px; image-rendering: pixelated; }
.coin-side.tails {
  width: 20px; height: 20px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #f0d878, #b8892a);
  color: #3a2a08; font-weight: 900; font-size: max(var(--ui-min-primary-text-size, 16px), 13px); box-shadow: inset 0 0 3px #0006;
}
.yesno-actions { display: flex; flex-direction: row; gap: 10px; }
.yesno-actions .sendoff-btn { min-width: 84px; }

/* Owner 2026-07-04 (interaction catalog 0.1): generic player-pick bar — the
   prompt + a RED, clearly visible Decline in the confirm-bar slot. */
/* owner o66w: blitz-target prompt anchored over the blitzing player (position set inline via RAF-follow). */
/* owner o66aa: 2-click target cue (🏈 pass/hand-off, 🥾 AV+ foul) — anchored over the target square. */
.o66-target-cue {
  position: absolute;
  z-index: 13;
  transform: translate(-50%, -100%);
  /* #13 (tester, owner): the over-head action-confirm cue (Block/Foul/Blitz emoji button) was too
     small — bump ~+30% (font 0.95→1.24rem + proportional padding/radius). The emoji scales with font-size. */
  padding: 3px 10px;
  border-radius: 8px;
  background: rgba(20, 22, 26, 0.9);
  border: 1px solid var(--ui-accent);
  color: var(--ui-heading);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.24rem);
  font-weight: 700;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.6);
}
.o66-target-cue.pass-destination {
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  z-index: 24;
}
.o66-target-pass-roll { display: inline-flex; align-items: center; gap: 2px; font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem); }
.o66-target-d6 { width: 22px; height: 22px; }
/* Owner ⑩ (08-12): pass/bomb targeting tooltip — the throw/catch roll at the hovered square. Mirrors the
   target-cue look (over-head, pointer-transparent); catch line reads in the accent tint. */
.pass-hover-tip {
  position: absolute;
  z-index: 13;
  transform: translate(-50%, -100%);
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 3px 10px;
  border-radius: 8px;
  background: rgba(20, 22, 26, 0.9);
  border: 1px solid var(--ui-accent);
  color: var(--ui-heading);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem);
  font-weight: 700;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.6);
}
.pass-hover-tip .pht-catch { color: var(--ui-accent); }
.pass-hover-d6 { width: 20px; height: 20px; vertical-align: middle; }
/* W28b: Hail Mary Pass targeting hint — the setup-selection hint idiom, mounted with the pitch targeting chrome. */
.hmp-hint {
  position: absolute;
  z-index: 13;
  left: 50%;
  bottom: 146px;
  transform: translateX(-50%);
  padding: 4px 7px;
  font-size: max(var(--ui-min-text-size, 12px), 10.5px);
  line-height: 1.35;
  color: var(--ui-heading);
  border-radius: 5px;
  background: color-mix(in srgb, var(--ui-accent) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--ui-accent) 45%, transparent);
  white-space: nowrap;
  pointer-events: none;
}
/* #113: mid-move Jump toggle badge — clickable over-head affordance on the acting player. Mirrors the target-cue
   look; the .on state (server-echoed leaping) reads as the accent-lit "engaged" style. Token-only, theme-safe. */
.jump-toggle {
  position: absolute; z-index: 13; transform: translate(-50%, -100%);
  padding: 2px 9px; border-radius: 10px; white-space: nowrap;
  background: rgba(20, 22, 26, 0.9); border: 1px solid var(--ui-border); color: var(--ui-text);
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem); font-weight: 700; cursor: pointer; pointer-events: auto;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.6);
}
.jump-toggle:hover { border-color: #fff0a0; background: rgba(40, 42, 46, 0.95); }
.jump-toggle.on { border-color: var(--ui-accent); color: var(--ui-accent); background: rgba(40, 42, 46, 0.95); }
/* #236: passive variant of the existing armed-action badge; its lifetime is the server-derived election above
   (StepInitMoving.java:270-278 / StepResetFumblerooskie.java:89-117), so it never owns input or cancellation. */
.fumblerooskie-badge { cursor: default; pointer-events: none; }
.blitz-target-prompt {
  position: absolute;
  z-index: 13;
  transform: translate(-50%, -100%);
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(20, 22, 26, 0.92);
  border: 1px solid var(--ui-accent);
  color: var(--ui-heading);
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem);
  font-weight: 700;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.6);
}
.block-alt-modal {
  position: absolute; z-index: 30; left: 50%; top: 50%; transform: translate(-50%, -50%);
  min-width: 290px; padding: 14px; border-radius: 9px;
  background: rgba(20, 22, 26, 0.97); border: 1px solid var(--ui-accent); color: var(--ui-text);
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.72); pointer-events: auto;
}
.block-alt-title { color: var(--ui-heading); font-weight: 800; margin-bottom: 10px; text-align: center; }
.block-alt-preview { text-align: center; color: var(--ui-accent); margin: 2px 0 12px; }
.block-alt-actions { display: flex; gap: 7px; flex-wrap: wrap; justify-content: center; }
.block-alt-actions button {
  border: 1px solid var(--ui-border); border-radius: 6px; padding: 7px 11px;
  background: var(--ui-surface); color: var(--ui-text); cursor: pointer;
}
.block-alt-actions button:hover { border-color: var(--ui-accent); }
.block-alt-actions button.danger { border-color: #d56a5f; }
.block-alt-actions small { display: block; margin-top: 2px; color: var(--ui-text-dim); }
/* #157: a seat-tinted player name in the log. Colour is inline (resolved from renderer.seatColors() per game/theme
   — one source of truth with the pitch tokens); this rule only carries the weight so the name reads as a name. */
.log-name {
  font-size: max(var(--ui-min-text-size, 12px), 0.9em);
  font-weight: 700;
  text-shadow: 0 1px 1px #000, 0 0 3px #000, 0 0 6px color-mix(in srgb, var(--log-seat-glow, transparent) 82%, transparent);
}
/* Owner 08-19: a name that carries its playerId is a LOCATE control — click drops the pulse +
   arrow cue on the player's token (same call as a roster-row click). Seat colour stays inline. */
.log-name-link { cursor: pointer; }
.log-name-link:hover { text-decoration: underline; }
/* Owner 08-18: the timestamp column stops dominating the line — smaller + muted.
   Copy still carries it (it's the same text node, just styled down). */
.log-time { font-size: max(var(--ui-min-text-size, 12px), 0.82em); opacity: 0.55; color: var(--ui-muted); }
/* Owner 08-18: the leading "Block"/"Uphill Block" title reads at a glance — a subtle
   EMBOSS (light catch above, drop below) + weight bump + 1px lift, in the log's own
   pixel-font aesthetic. Colour stays the heading token; shadows are neutral light/dark. */
.log-title {
  display: inline-block;
  transform: translateY(-1px);
  font-weight: 800;
  letter-spacing: 0.03em;
  /* Owner 08-19: GOLD — the heading red read too close to the away-team name colour. */
  color: var(--ui-gold);
  text-shadow: 0 -1px 0 rgba(255, 255, 255, 0.25), 0 1px 1px rgba(0, 0, 0, 0.65);
}
/* Owner 08-18 (+08-19): the breastplate icon art (the armour die-toast asset) renders at
   text size; underneath sits a transparent, selectable text node — now the WORD "armour"
   (08-19: the 🛡 emoji left the text entirely; the icon alone carries the meaning, copy
   yields "armour"). Same substitution class as the inline dice glyphs; the fixed-width
   glyph layer clips the invisible word, selection still picks it up whole. */
.log-armour {
  display: inline-block;
  position: relative;
  width: 1.25em;
  height: 1.15em;
  overflow: visible;
  vertical-align: text-bottom;
}
.log-armour img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.9)) drop-shadow(0 0 2px rgba(255, 255, 255, 0.5)) drop-shadow(0 1px 1px rgba(0, 0, 0, 0.9));
}
.log-armour-glyph {
  position: absolute;
  inset: 0;
  color: transparent;
  overflow: hidden;
  white-space: nowrap;
  user-select: text;
}
/* Owner 09-09: the word "fails" on a failed roll line reads SCARLET so a failure pops off the line. */
.log-fail { color: #ff2400; font-weight: 700; }
/* Owner 08-19: a HIDDEN word — zero-visual (zero-width box, clipped transparent text) but the
   text node stays in the DOM so selection/copy carries it (e.g. "rolls" before a die glyph).
   Same substitution family as .log-armour, just no icon overlay. */
.log-hidden {
  display: inline-block;
  width: 0;
  height: 1em;
  overflow: hidden;
  color: transparent;
  white-space: nowrap;
  user-select: text;
  vertical-align: text-bottom;
}
/* Owner 09-09: dice in the log are larger (d6 2.1em, block die 2em) and no longer pulled into the neighbouring
   lines by negative margins — a line that carries dice gets a taller line box instead, so icons never collide. */
.log-d6 { --d6-size: 2.1em; margin: -0.1em 0.1em; }
.log-block-die { --block-die-size: 2em; margin: -0.1em 0.08em; }
.log span:has(.log-d6, .log-block-die) { line-height: 2.3; }
/* #161: the eligible-square VISUAL is now Voss's renderer push-arrows (setQuickSnapArrows); this element survives
   only as an INVISIBLE click hit-target over each eligible square, so the marker itself paints nothing. */
.quicksnap-target {
  position: absolute;
  z-index: 15;
  transform: translate(-50%, -50%);
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
}
.kick-election-target {
  position: absolute; z-index: 46; transform: translate(-50%, -50%);
  width: 36px; height: 36px; padding: 0; border: 2px solid #22d3ee;
  border-radius: 7px; background: #082d36a8; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 4px;
  box-shadow: 0 0 10px #22d3eeb0;
}
.kick-election-target.reduced { border-color: #f5c542; background: #3b2d08c4; box-shadow: 0 0 10px #f5c542b0; }
.kick-election-target.icon { z-index: 48; width: 23px; height: 23px; border-radius: 50%; }
.kick-election-target.boundary { width: auto; min-width: 70px; height: 26px; padding: 0 7px; border-radius: 13px; }
.kick-election-target img { width: 19px; height: 19px; object-fit: contain; pointer-events: none; }
.kick-election-k { color: #171104; font-family: Nuffle, system-ui, sans-serif; font-size: max(var(--ui-min-primary-text-size, 16px), 15px); font-weight: 900; line-height: 1; pointer-events: none; }
.kick-election-label { color: #fff; font-family: system-ui, sans-serif; font-size: max(var(--ui-min-text-size, 12px), 11px); font-weight: 800; line-height: 1; pointer-events: none; }
/* #94: persistent blitz-used token badges (⚡ blitzer / 🎯 target) over the head, until the blitzUsed flag resets.
   Owner 08-18: .centered variants sit ON the token body (renderer.tokenBodyCenterToCanvas anchor);
   .grown is the deactivated blitzer's enlarged ⚡ (~1.8×). */
.blitz-token {
  position: absolute;
  z-index: 14;
  transform: translate(-50%, -100%);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem);
  line-height: 1;
  pointer-events: none;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.7));
}
.blitz-token .blitz-decoration { display: block; height: var(--deco-size, 1em); width: auto; max-width: none; } /* owner 09-07: camera-scaled like the renderer's action markers */
.blitz-token.centered { transform: translate(-50%, -50%); }
.blitz-token.grown { font-size: max(var(--ui-min-primary-text-size, 16px), 2rem); }
/* #132: transient negatrait cue toast over the token — the trait-naming layer over the feet-die. A PASS is subtle
   (muted chip); a FAIL is prominent (warning colour + heavier weight, so a stopped activation reads). visual only. */
.negatrait-cue {
  position: absolute;
  z-index: 15;
  transform: translate(-50%, -100%);
  padding: 2px 7px;
  border-radius: 6px;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem);
  font-weight: 600;
  line-height: 1.1;
  white-space: nowrap;
  pointer-events: none;
  color: #e8e8e8;
  background: rgba(20, 20, 24, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  opacity: 0.9;
}
.negatrait-cue.fail {
  color: #fff;
  font-weight: 800;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.92rem);
  background: rgba(150, 26, 26, 0.92);
  border-color: rgba(255, 120, 120, 0.6);
  box-shadow: 0 2px 10px rgba(120, 0, 0, 0.6);
  opacity: 1;
}
.negatrait-cue.opponent-reactive-pill {
  z-index: 54;
  top: 12px;
  left: 50%;
  width: max-content;
  max-width: calc(100% - 24px);
  transform: translateX(-50%);
  line-height: 1.2;
  text-align: center;
  white-space: normal;
}
/* #58 SYNCHRONOUS_MULTI_BLOCK pick-UI: a ring centred on each selectable (dice-decorated) target; the .selected
   variant is the bright ring on the 1-2 chosen. pointer-events:none — the click passes to the token below. */
.mb-target {
  position: absolute;
  z-index: 14;
  transform: translate(-50%, -50%);
  width: 42px;
  height: 42px;
  border-radius: 8px;
  border: 2px dashed color-mix(in srgb, var(--ui-accent) 65%, transparent);
  pointer-events: none;
}
.mb-target.selected {
  border-style: solid;
  border-color: var(--ui-accent);
  background: color-mix(in srgb, var(--ui-accent) 22%, transparent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--ui-accent) 55%, transparent);
}
/* Owner o66an: interactive kick-placement MODAL — a top-centre card instructing the kicking coach to aim. */
.kick-aim-modal {
  position: absolute;
  z-index: 14;
  left: 50%;
  /* Owner 08-19: under the scoreboard, clear of kick targets. */
  top: 76px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 22px;
  border-radius: 10px;
  background: rgba(16, 18, 22, 0.95);
  border: 2px solid var(--ui-accent);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.7);
  pointer-events: none;
  text-align: center;
}
.kick-aim-modal-title { color: var(--ui-heading); font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem); font-weight: 800; letter-spacing: 0.08em; }
.kick-aim-modal-text { color: #dfe4ee; font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); font-weight: 600; }
/* Owner o66ak: drag-to-setup ghost — a floating position chip pinned to the pointer (offset up-left of it). */
.setup-drag-ghost {
  position: fixed;
  z-index: 60;
  transform: translate(-50%, -140%);
  padding: 3px 9px;
  border-radius: 5px;
  background: rgba(20, 22, 26, 0.95);
  border: 1px solid #7aa2e0;
  color: #dfe8f7;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  font-weight: 700;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.7);
}
.setup-reserve-chip.dragging { opacity: 0.4; }
.player-pick-bar {
  position: absolute;
  z-index: 12;
  bottom: 86px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0.5rem 1rem;
  background: rgba(14, 18, 26, 0.92);
  border: 1px solid #b08a2e;
  border-radius: 6px;
  box-shadow: 0 4px 14px #000a;
}
.pick-prompt { font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem); color: var(--ui-heading); font-weight: 700; }
/* Owner audit 08-17 (P1): the roster-list fallback panel, opened via the pick bar's
   "Pick from roster" button — stacks above the bar so both stay visible together. */
.roster-pick-fallback-panel {
  position: absolute;
  z-index: 13;
  bottom: 150px;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.6rem;
  background: rgba(14, 18, 26, 0.96);
  border: 1px solid #b08a2e;
  border-radius: 6px;
  box-shadow: 0 4px 14px #000a;
}
/* Owner 2026-07-14 (#11 Pick-Me-Up, Change-1): splash title, stacks just above the pick bar
   (mirrors .player-pick-bar geometry so the two sit cleanly). */
.pickmeup-splash {
  position: absolute;
  z-index: 12;
  bottom: 132px;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.35rem 1.1rem;
  background: rgba(14, 18, 26, 0.92);
  border: 1px solid #b08a2e;
  border-radius: 6px;
  box-shadow: 0 4px 14px #000a;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  font-weight: 800;
  color: var(--ui-heading);
  letter-spacing: 0.3px;
  white-space: nowrap;
  text-align: center;
}
.pick-decline {
  padding: 6px 14px;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem);
  font-weight: 700;
  color: #fff;
  background: #a02020;
  border: 1px solid #e05050;
  border-radius: 6px;
  cursor: pointer;
}
.pick-decline:hover { background: #c02828; }
.pick-count { font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); color: var(--ui-text); opacity: 0.85; }
.quicksnap-confirm-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.pick-confirm {
  padding: 6px 14px;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem);
  font-weight: 700;
  color: #fff;
  background: #3a5f3f;
  border: 1px solid #5a8a60;
  border-radius: 6px;
  cursor: pointer;
}
.pick-confirm:hover:not(:disabled) { background: #47774e; }
.pick-confirm:disabled { background: var(--ui-surface); border-color: var(--ui-border); color: var(--ui-muted); cursor: default; }

/* Owner 2026-07-04c: foul/handoff/pass hover roll tip + confirm modal */
.action-roll-tip {
  position: absolute;
  z-index: 48;
  padding: 3px 8px;
  background: rgba(14, 18, 26, 0.94);
  border: 1px solid color-mix(in srgb, var(--ui-accent) 67%, transparent);
  border-radius: 5px;
  font-size: max(var(--ui-min-text-size, 12px), 12px);
  font-weight: 800;
  color: var(--ui-heading);
  pointer-events: none;
  white-space: nowrap;
}
/* Owner 2026-07-04d: compact (~67% of the yesno-card) + draggable body. */
.action-modal {
  top: 34%;
  padding: 11px 13px;
  gap: 8px;
  max-width: 280px;
  cursor: move;
  user-select: none;
}
.action-modal .yesno-text { font-size: max(var(--ui-min-text-size, 12px), 11px); }
.action-modal .yesno-actions { gap: 7px; }
.action-modal .sendoff-btn { padding: 6px 8px; font-size: max(var(--ui-min-text-size, 12px), 11px); min-width: 56px; }
/* Owner 2026-07-04f: movable + RESIZABLE (style requirement for all dialogs) */
.action-modal { resize: both; overflow: auto; min-width: 150px; min-height: 60px; }
.action-modal-roll { display: flex; align-items: center; justify-content: center; gap: 4px; margin-top: 4px; font-weight: 800; font-size: max(var(--ui-min-text-size, 12px), 12px); color: var(--ui-heading); }
.action-target-d6 { --d6-size: 1.5em; margin: -0.12em 0.08em; }
/* Owner 2026-07-04e: the FUMBBL block-die skull in the foul tip/modal */
.action-roll-die { width: 16px; height: 16px; image-rendering: pixelated; vertical-align: middle; margin-right: 3px; }
.action-roll-tip[data-mode='foul'] { display: inline-flex; align-items: center; }

/* Owner 2026-07-04 (interaction catalog 28, PRIORITY): follow-up chip card —
   anchored near (but offset from) the block square; gold-trimmed to match the
   activation halo. The shared passive variant carries no buttons. */
/* Triage #10 (owner 08-11): "Your opponent is deciding…" note anchored below the block dice. Console tokens. */
.opp-deciding-note {
  position: absolute;
  z-index: 30;
  transform: translateX(-50%);
  padding: 2px 9px;
  border-radius: 6px;
  font-size: max(var(--ui-min-text-size, 12px), 11px);
  font-weight: 600;
  white-space: nowrap;
  color: var(--ui-text);
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, .4);
  pointer-events: none;
}
.followup-chip {
  position: absolute;
  z-index: 46;
  width: 160px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  background: rgba(14, 18, 26, 0.94);
  border: 1px solid color-mix(in srgb, var(--ui-accent) 67%, transparent);
  border-radius: 9px;
  box-shadow: 0 6px 20px #000b, 0 0 12px color-mix(in srgb, var(--ui-accent) 20%, transparent);
  animation: sendoff-pop var(--p-200) ease-out;
}
.followup-chip.passive { pointer-events: none; width: auto; max-width: 220px; }
/* Owner 2026-07-06: head-mounted passive toast — centred over the player's head and
   sitting just above it. Its pop keeps the centring translate (the base sendoff-pop
   animates only scale and would otherwise drop the translate). */
/* Owner 2026-07-06: ~1/3 smaller + shifted DOWN (translate Y -100% -> -60%) so it sits
   closer to the head. */
.followup-chip.head-mounted { transform: translate(-50%, -60%); animation: fu-head-pop var(--p-200) ease-out; padding: 5px 7px; }
.followup-chip.head-mounted .fu-title { font-size: max(var(--ui-min-text-size, 12px), 10px); letter-spacing: 0.02em; }
.reactive-decision-pill {
  z-index: 54;
  max-width: 210px;
  border-color: color-mix(in srgb, #e0b44d 72%, transparent);
  background: rgba(15, 18, 24, 0.96);
  box-shadow: 0 4px 14px #000b, 0 0 9px rgba(224, 180, 77, 0.28);
}
.log-stat-down {
  display: inline-block;
  position: relative;
  width: 1.45em;
  height: 1.45em;
  margin: -0.3em 0.08em -0.25em;
  vertical-align: text-bottom;
}
.log-stat-down img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.8)) drop-shadow(0 1px 1px rgba(0, 0, 0, 0.9));
}
.log-stat-down-copy {
  position: absolute;
  inset: 0;
  color: transparent;
  overflow: hidden;
  white-space: nowrap;
  user-select: text;
}
@keyframes fu-head-pop {
  from { transform: translate(-50%, -60%) scale(0.7); opacity: 0; }
  to { transform: translate(-50%, -60%) scale(1); opacity: 1; }
}
.fu-title {
  font-family: 'Nuffle', sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 14px);
  font-weight: 800;
  color: var(--ui-heading);
  text-align: center;
  letter-spacing: 0.03em;
}
.fu-actions { display: flex; flex-direction: row; gap: 8px; }
.fu-btn {
  padding: 6px 10px;
  font-size: max(var(--ui-min-text-size, 12px), 12.5px);
  font-weight: 700;
  color: #f3f0e6;
  border-radius: 6px;
  cursor: pointer;
}
.fu-btn.follow { background: var(--ui-accent); border: 1px solid var(--ui-accent); }
.fu-btn.follow:hover { background: #a5822a; }
.fu-btn.stay { background: rgba(50, 64, 86, 0.95); border: 1px solid rgba(150, 175, 210, 0.55); }
.fu-btn.stay:hover { background: rgba(66, 84, 112, 0.95); }

/* B4-1/B6-1: BB3-style injury banner — full-width slash, team-tinted */
.injury-splash {
  position: absolute;
  z-index: 40;
  top: 34%;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: 18px;
  padding: 14px 0 16px;
  /* default (away/red); home overrides to blue below */
  /* #121 (owner, option (a)): widen the OPAQUE span 12→88% → 5→95% so a long casualty string can't spill into
     the transparent edge-fade (the "text overflows its shading window" report). Pairs with the .injury-text clamp
     below (belt-and-suspenders); preserves the owner's deliberate #28-era full-width band. */
  background: linear-gradient(100deg, #7a0d0d00 0%, #8a1010e8 5%, #a01414f2 50%, #8a1010e8 95%, #7a0d0d00 100%);
  border-top: 2px solid #e0303080;
  border-bottom: 2px solid #e0303080;
  transform: skewY(-1.5deg);
  pointer-events: none;
  animation: injury-in var(--p-280) ease-out;
}
/* When turnover/turn-start splashes coincide, lower the injury banner so the higher-z splash fully covers it. */
.injury-splash.inj-under-splash { top: 40%; }
.injury-splash[data-side='home'] {
  background: linear-gradient(100deg, #0d1a7a00 0%, #10218ae8 5%, #1430a0f2 50%, #10218ae8 95%, #0d1a7a00 100%); /* #121: widen opaque span (see away variant) */
  border-top-color: #3a5be080;
  border-bottom-color: #3a5be080;
}
/* Owner 2026-07-08 (queue 3): KNOCKOUT toast — a compact pill bound to the injured
   player's token (position driven by the RAF follow), replacing the banner for KOs. */
/* Owner 2026-07-08: the KO toast now reads by injury SEVERITY (not team side), matching the
   stun tag (amber) and casualty toast (red) — a neutral warm-dark plate with a severity-coloured
   type. KO = orange, sitting between stun-amber and casualty-red. */
.ko-toast {
  position: absolute;
  z-index: 40;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center; /* owner tweak 08-04 (#227): center the pill content */
  gap: 8px;
  padding: 6px 18px; /* owner tweak 08-04 (#227): background headroom past the text extents (was 4px 12px) */
  border-radius: 11px;
  overflow: hidden; /* #227: clip content to the rounded plate (no spill past the corners) */
  /* Owner 09-06: the modern black/red panel language (TurnToast) replaces the old amber plate. */
  background: linear-gradient(120deg, #7a0c0cf2, #300f0fe8);
  border: 2px solid #e03030cc;
  box-shadow: 0 6px 26px #000b, 0 0 22px #e0303044;
  pointer-events: none;
  animation: injury-in var(--p-280) ease-out;
  white-space: nowrap;
}
.ko-toast-type {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem);
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #ffd7d7;
  text-shadow: 0 2px 5px #000d;
}
/* owner 2026-07-08: a CASUALTY toast reads RED (style-guide A1 — injury markers are red); 09-06: same red panel */
.ko-toast.is-casualty { border-color: #e03030cc; }
.ko-toast.is-casualty .ko-toast-type { color: #ffd7d7; }
.ko-toast-player { font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); font-weight: 700; color: #ffd7d7; }
/* owner 2026-07-08: the casualty toast NAMES the injury ("X is Seriously Hurt!", etc.) */
.ko-toast-phrase {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem);
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #ffd7d7; /* owner 09-06: TurnToast red-panel text */
  text-shadow: 0 2px 5px #000d;
  text-align: center;
  max-width: 15rem;
  white-space: normal; /* owner 08-05: wrap long casualty phrases; pill grows vertically */
  overflow-wrap: break-word;
}
/* Owner 2026-07-08 (pipeline Phase 3b): STUN token TAG — a smaller, softer, amber
   variant of the KO toast (a stun is a mild result, so it doesn't interrupt hard). */
.stun-tag {
  position: absolute;
  z-index: 40;
  transform: translateX(-50%);
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 9px;
  overflow: hidden; /* #227: clip content to the rounded plate */
  background: #4a3a18e6;
  border: 1px solid #d7a53aaa;
  box-shadow: 0 3px 10px #0009;
  pointer-events: none;
  animation: injury-in var(--p-240) ease-out;
  white-space: nowrap;
}
.stun-tag-type {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem);
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #ffd97a;
  text-shadow: 0 1px 3px #000c;
}
.stun-tag-player { font-size: max(var(--ui-min-text-size, 12px), 0.72rem); font-weight: 600; color: #efe2c4; }
/* Owner 2026-07-08: FALLS OVER toast (failed Dodge/Rush) — token-anchored like the stun tag,
   a cooler slate palette so a fall reads distinct from an injury. */
.fall-toast {
  position: absolute;
  z-index: 40;
  transform: translateX(-50%);
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 9px;
  overflow: hidden; /* #227: clip content to the rounded plate */
  background: #2a3140e6;
  border: 1px solid #6a86b0aa;
  box-shadow: 0 3px 10px #0009;
  pointer-events: none;
  animation: injury-in var(--p-240) ease-out;
  white-space: nowrap;
}
.fall-toast-type {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem);
  font-weight: 800;
  letter-spacing: 0.04em;
  color: #cfe0ff;
  text-shadow: 0 1px 3px #000c;
}
.injury-team {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  transform: skewY(1.5deg);
}
.injury-logo {
  width: 62px;
  height: 62px;
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 2px 5px #000c);
}
.injury-teamname {
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem);
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px #000d;
  max-width: 140px;
  text-align: center;
  line-height: 1.05;
}
.injury-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  transform: skewY(1.5deg);
  /* #121 (owner, clamp): cap the casualty text column to 84% of the band so it always sits INSIDE the widened
     5→95% opaque zone (centred ⇒ 8→92%), regardless of string length; min-width:0 lets the flex item shrink so
     the ellipsis below can engage on a pathological string. */
  max-width: 84%;
  min-width: 0;
}
/* #64: the injury-roll result header (small, above the severity line) — STUNNED / KNOCKED OUT / CASUALTY. */
.injury-roll {
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.86rem);
  font-weight: 800;
  letter-spacing: 0.18em;
  color: #ffd9d9;
  text-shadow: 0 1px 3px #000c;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.injury-splash[data-side='home'] .injury-roll { color: #d9e2ff; }
/* #64: the Lasting-Injury D6 stat-reduction suffix (e.g. "(-MA)") — accent, slightly smaller than the severity. */
.injury-stat { font-size: max(var(--ui-min-text-size, 12px), 0.62em); font-weight: 800; color: #ffe08a; letter-spacing: 0.04em; }
.injury-type {
  font-size: max(var(--ui-min-primary-text-size, 16px), 2.6rem);
  font-weight: 900;
  letter-spacing: 0.12em;
  color: #fff;
  text-shadow: 0 2px 6px #000c;
  /* #121: last-resort guard — a string longer than the clamp truncates rather than spilling past the shading
     (realistic casualty strings are short, so this never triggers in practice). */
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.injury-player {
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem);
  max-width: 100%; /* #121: same overflow guard as .injury-type */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #ffe0e0;
  text-shadow: 0 1px 3px #000c;
}
.injury-splash[data-side='home'] .injury-player { color: #dfe6ff; }
@keyframes injury-in {
  from { opacity: 0; transform: skewY(-1.5deg) scaleX(0.6); }
  to { opacity: 1; transform: skewY(-1.5deg) scaleX(1); }
}

/* Owner 2026-07-03: turnover splash — big centred banner, team logo left of a
   coach line + "HAS TURNED OVER" in Nuffle. Side-tinted (home blue / away red)
   like the injury splash but heavier + darker so it reads as a "drive lost". */
.turn-boundary-stack {
  --turn-boundary-banner-height: 138px; /* 84px crest + 48px block padding + 6px border */
  --turn-boundary-toast-height: 64px;
  --turn-boundary-gap: 8px;
  --turn-boundary-stack-height: calc(var(--turn-boundary-banner-height) + var(--turn-boundary-gap) + var(--turn-boundary-toast-height));
  position: absolute;
  z-index: 42;
  left: 0;
  right: 0;
  /* Keep the complete two-row unit on-screen on short/zoomed viewports while retaining the established 40% rail. */
  top: max(8px, min(40%, calc(100% - var(--turn-boundary-stack-height) - 8px)));
  display: grid;
  grid-template-rows: var(--turn-boundary-banner-height) var(--turn-boundary-toast-height);
  row-gap: var(--turn-boundary-gap);
  pointer-events: none;
}
.turn-boundary-banner-slot {
  min-width: 0;
  height: 100%;
}
.turnover-splash {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: 26px;
  padding: 22px 0 26px;
  /* default (away/red) */
  background: linear-gradient(100deg, #5a060600 0%, #7a0c0cf2 12%, #300 50%, #7a0c0cf2 88%, #5a060600 100%);
  border-top: 3px solid #e03030aa;
  border-bottom: 3px solid #e03030aa;
  box-shadow: 0 0 40px #000a inset;
  transform: skewY(-1.2deg);
  /* Owner: swallow clicks over the banner band itself (splash intercepts, does
     nothing with them) so they can't fall through to the pitch beneath. */
  pointer-events: auto;
  animation: turnover-in var(--p-400) cubic-bezier(0.2, 0.9, 0.3, 1.3);
}
.turnover-splash[data-side='home'] {
  background: linear-gradient(100deg, #06105a00 0%, #0c1e7af2 12%, #001 50%, #0c1e7af2 88%, #06105a00 100%);
  border-top-color: #3a5be0aa;
  border-bottom-color: #3a5be0aa;
}
.turnover-logo {
  width: 84px;
  height: 84px;
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 3px 8px #000e);
  transform: skewY(1.2deg);
}
.turnover-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  transform: skewY(1.2deg);
}
.turnover-coach {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.5rem);
  font-weight: 700;
  color: #fff;
  text-shadow: 0 2px 5px #000d;
  line-height: 1;
  max-width: 320px;
}
.turnover-head {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 3.2rem);
  font-weight: 900;
  letter-spacing: 0.1em;
  color: #ffe0e0;
  text-shadow: 0 3px 10px #000c, 0 0 22px #e0303066;
  line-height: 1;
}
.turnover-splash[data-side='home'] .turnover-head {
  color: #e0e8ff;
  text-shadow: 0 3px 10px #000c, 0 0 22px #3a5be066;
}
@keyframes turnover-in {
  from { opacity: 0; transform: skewY(-1.2deg) scale(0.7); }
  to { opacity: 1; transform: skewY(-1.2deg) scale(1); }
}

/* #18a (owner tester): passive "opponent reviewing dice" indicator — a small caution line pinned just
   under the top-center scoreboard. Pointer-inert, existence-only; a soft pulsing dot marks the wait. */
.opp-reviewing-dice {
  position: absolute;
  z-index: 20;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 12px;
  border-radius: 9px;
  background: rgba(20, 22, 26, 0.82);
  border: 1px solid var(--ui-border);
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--ui-text-dim);
  white-space: nowrap;
  pointer-events: none;
}
.ord-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ui-accent);
  animation: ord-pulse 1s ease-in-out infinite;
}
@keyframes ord-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }

/* #51 + #43 (owner tester, P2): staller warning splash — amber caution banner, center-top, one-shot.
   #43's splash→pace→reveal IS this keyframe lifecycle: splash-in (scale bounce) → hold/pace → settle-out,
   timed to the 3.2s JS one-shot. Not side-tinted (a game-event warning, shows for every viewer). */
.staller-splash {
  position: absolute;
  z-index: 43;
  top: 26%;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 22px;
  border-radius: 10px;
  background: linear-gradient(120deg, #3a2a0cf2, #1a1305e8);
  border: 2px solid #e0a52fcc;
  box-shadow: 0 6px 26px #000b, 0 0 22px #e0a52f44;
  white-space: nowrap;
  pointer-events: none;
  animation: staller-life var(--p-3200) ease-in-out forwards;
}
.staller-icon { font-size: max(var(--ui-min-primary-text-size, 16px), 1.5rem); filter: drop-shadow(0 2px 4px #000c); }
.staller-text {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem);
  font-weight: 800;
  letter-spacing: 0.03em;
  color: #ffd98a;
  text-shadow: 0 2px 6px #000d;
}
.staller-text b { color: #fff; }
@keyframes staller-life {
  0% { opacity: 0; transform: translateX(-50%) scale(0.7); }    /* splash in */
  12% { opacity: 1; transform: translateX(-50%) scale(1.05); }
  20% { transform: translateX(-50%) scale(1); }                 /* pace / hold */
  82% { opacity: 1; transform: translateX(-50%) scale(1); }
  100% { opacity: 0; transform: translateX(-50%) scale(0.96); } /* settle out */
}

/* Owner 2026-07-05: turn-START splash — copied from the turnover splash rail, but
   reads "«Coach»'s turn" in BRIGHT WHITE and is home/away colour-coded. */
/* #162: an off-turn reactive prompt (Fend / Side Step / dump-off / pick-me-up …) is lifted above the surrounding
   chrome and given a visible ring, because the coach isn't watching for UI on the opponent's clock. Applied by the
   focus-snap watch; z-index sits above the log panel + overlays but BELOW the end-game screens (z-55). */
.prompt-front {
  z-index: 52 !important;
  outline: 2px solid var(--ui-accent);
  outline-offset: 3px;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ui-accent) 22%, transparent), 0 8px 26px rgba(0, 0, 0, 0.6);
}
.prompt-front:focus,
.prompt-front :focus-visible { outline-color: var(--ui-accent); }
/* #230: the `.action-lock` pill + `.action-lock-dot` + `actionLockPulse` keyframes are removed with the
   visual affordance (the #173 functional gate stays; "Opponent's Turn" reads off the End Turn button). */
.turnstart-splash {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  gap: 26px;
  padding: 22px 0 26px;
  /* default (away/red) */
  background: linear-gradient(100deg, #5a060600 0%, #7a0c0cf2 12%, #300 50%, #7a0c0cf2 88%, #5a060600 100%);
  border-top: 3px solid #e03030aa;
  border-bottom: 3px solid #e03030aa;
  box-shadow: 0 0 40px #000a inset;
  transform: skewY(-1.2deg);
  /* Owner: swallow clicks over the banner band itself, same as .turnover-splash. */
  pointer-events: auto;
  animation: turnover-in var(--p-400) cubic-bezier(0.2, 0.9, 0.3, 1.3);
}
.turnstart-splash[data-side='home'] {
  background: linear-gradient(100deg, #06105a00 0%, #0c1e7af2 12%, #001 50%, #0c1e7af2 88%, #06105a00 100%);
  border-top-color: #3a5be0aa;
  border-bottom-color: #3a5be0aa;
}
/* #139: Master Chef pregame splash — a center banner (gold flourish; team-NEUTRAL, it's a pregame re-roll steal). */
.masterchef-splash {
  position: absolute; z-index: 42; top: 40%; left: 0; right: 0;
  display: flex; flex-direction: row; justify-content: center; align-items: center; gap: 18px;
  padding: 20px 0 24px;
  background: linear-gradient(100deg, #3a2c0600 0%, #6a4e0cf2 12%, #201a02 50%, #6a4e0cf2 88%, #3a2c0600 100%);
  border-top: 3px solid #e0b040aa; border-bottom: 3px solid #e0b040aa;
  box-shadow: 0 0 40px #000a inset; transform: skewY(-1.2deg); pointer-events: none;
  animation: turnover-in var(--p-400) cubic-bezier(0.2, 0.9, 0.3, 1.3);
}
.masterchef-icon { font-size: max(var(--ui-min-primary-text-size, 16px), 2.6rem); line-height: 1; filter: drop-shadow(0 2px 4px #000c); }
.masterchef-head {
  font-family: 'Nuffle', system-ui, sans-serif; font-size: max(var(--ui-min-primary-text-size, 16px), 2rem); font-weight: 900; letter-spacing: 0.04em;
  color: #ffe8b0; text-shadow: 0 2px 6px #000d;
}
.turnstart-head {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 3rem);
  font-weight: 900;
  letter-spacing: 0.06em;
  color: #ffffff; /* bright white (owner) */
  text-shadow: 0 3px 10px #000d, 0 0 22px #ffffff55;
  line-height: 1;
}

/* B3-9: FUMBBL game browser dropdown */
/* owner 2026-07-03 r6f Option A: the game browser is the PRIMARY game-entry,
   shown as a centered modal opened from the header "Browse" button. */
.browse-backdrop {
  z-index: 80;
  align-items: flex-start;
  padding-top: 11vh;
}
.game-browser {
  width: min(680px, 92vw);
  max-height: 72vh;
  overflow-y: auto;
  background: color-mix(in srgb, var(--ui-surface) 97%, transparent);
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  padding: 12px 14px;
  box-shadow: 0 14px 44px #000d;
}
/* game-id (Spectate) / game-name (Play) entry row, moved off the connect bar */
/* owner 2026-07-08 (UI restructure): the entry is a COLUMN of branch-aware rows. */
.game-browser .gb-entry {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ui-border);
}
.game-browser .gb-entry-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
/* FUMBBL live-play lobby (owner 2026-07-09): highlight the token-join lobby + Join action. */
.game-browser .gb-fumbbl-lobby {
  border: 1px solid #b5732b;
  border-radius: 6px;
  padding: 10px;
  background: rgba(181, 115, 43, 0.08);
}
/* #210 (owner-endorsed): the "your games in progress" rejoin panel — a card above the create/browse entries. */
.gb-mygames {
  border: 1px solid var(--ui-accent);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
  background: color-mix(in srgb, var(--ui-accent) 8%, transparent);
}
.gb-mygames-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.gb-mygames-title { font-weight: 600; font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); letter-spacing: 0.02em; color: var(--ui-text); }
.gb-mygames-err { color: #e56a6a; }
.gb-mygames-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.gb-mygames-row { display: flex; align-items: center; gap: 8px; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); }
.gb-mygames-vs { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gb-mygames-vs em { color: #98a0ac; }
.gb-mygames-status {
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem); padding: 1px 6px; border-radius: 9px; white-space: nowrap;
  background: #2a2f38; color: #b7c0cc; border: 1px solid var(--ui-border);
}
.gb-mygames-status[data-inprogress='true'] { background: color-mix(in srgb, var(--ui-accent) 22%, #2a2f38); color: var(--ui-text); }
.gb-rejoin-btn { background: var(--ui-accent); color: #06121f; font-weight: 600; border: none; }
.gb-rejoin-btn:hover { filter: brightness(1.08); }
.game-browser .gb-join {
  background: #b5732b;
  color: #fff;
  font-weight: 600;
  margin-right: 6px;
}
.game-browser .gb-entry input {
  background: var(--ui-surface);
  color: inherit;
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  padding: 0.35rem 0.55rem;
}
.game-browser .gb-entry input[type='number'] { width: 100px; }
.game-browser .gb-entry input[type='text'] { min-width: 90px; }
.game-browser .gb-import { background: var(--ui-surface); border: 1px solid var(--ui-border); }
.game-browser .gb-import:hover { background: var(--ui-hover); }
.game-browser .gb-creategame[disabled] { opacity: 0.5; cursor: not-allowed; }
.game-browser .gb-testbed summary { cursor: pointer; color: #98a0ac; font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); padding: 2px 0; }
.game-browser .gb-entry .gb-demo { background: var(--ui-surface); border: 1px solid var(--ui-border); }
.game-browser .gb-entry .gb-demo:hover { background: var(--ui-hover); }
.gb-filter {
  flex: 1; min-width: 120px; max-width: 260px; margin-left: 8px;
  padding: 4px 9px; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: #e8ecf2;
  background: #14181f; border: 1px solid var(--ui-border); border-radius: 6px;
}
.gb-filter:focus { outline: none; border-color: var(--ui-accent); }
.game-browser table { width: 100%; border-collapse: collapse; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); }
.game-browser td { padding: 4px 8px; border-bottom: 1px solid var(--ui-border); }
.game-browser .gb-row { cursor: pointer; }
.game-browser .gb-row:hover td { background: #232833; }
.game-browser td em { color: var(--ui-muted); font-style: normal; font-size: max(var(--ui-min-text-size, 12px), 0.72rem); }
.game-browser .gb-id { color: var(--ui-text-dim); }
.game-browser .gb-score { font-weight: bold; color: var(--ui-accent); }
.game-browser .gb-half { color: var(--ui-text); white-space: nowrap; }
.game-browser button {
  background: #3a5f3f;
  color: inherit;
  border: none;
  border-radius: 4px;
  padding: 0.2rem 0.7rem;
  cursor: pointer;
}
/* owner 2026-07-03 r6f: game-browser toolbar — the FUMBBL / Super FUMBBL server toggle
   (a segmented switch) + a refresh button. */
.gb-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
/* owner 2026-07-09: server chosen in the header now; the browser shows the active server as a pill label. */
.game-browser .gb-server-label {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  padding: 0.22rem 0.9rem;
  font-size: max(var(--ui-min-text-size, 12px), 0.78rem);
  font-weight: 700;
  color: #eafbea;
  background: #3a5f3f; /* Super FUMBBL (fork) green */
}
.game-browser .gb-server-label[data-server='fumbbl'] {
  background: #2f4a70; /* FUMBBL blue */
  color: #e6eefb;
}
/* owner 2026-07-03: "live" indicator while the 30s in-place poll is active */
.game-browser .gb-live {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #6fb06f;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  font-weight: 700;
  letter-spacing: 0.02em;
  animation: gb-live-pulse 2s ease-in-out infinite;
}
@keyframes gb-live-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
.game-browser .gb-refresh { background: var(--ui-surface); color: var(--ui-text); padding: 0.22rem 0.55rem; }
.game-browser .gb-refresh:hover { background: var(--ui-hover); }
.game-browser .gb-close { background: #55282a; color: #f0d8d8; padding: 0.22rem 0.55rem; }
.game-browser .gb-close:hover { background: #703437; }
/* floating MMO-style panel, bottom left (owner 2026-07-02) */
.config-bar {
  position: absolute;
  z-index: 12;
  /* Owner 2026-07-03 r4: bottom-left of the screen (configBarStyle sets the
     coach-panel-matched width once measured). */
  left: 14px;
  bottom: 12px;
  box-sizing: border-box; /* so the measured coach-panel width matches exactly */
  display: flex;
  /* owner 2026-07-03 r6f: NEVER wrap — the bar stays on a single line. The
     coach-panel width is now a min (configBarStyle sets minWidth), so the bar
     grows to fit the buttons when the panel is narrower than the row. */
  flex-wrap: nowrap;
  /* Owner 08-23: every quick-bar dimension is 20% above the previous compact pass. */
  gap: 2.4px;
  background: linear-gradient(180deg,
    rgb(39 43 49 / var(--hud-quickbar-opacity, 0.9)),
    rgb(9 11 13 / var(--hud-quickbar-opacity, 0.9)));
  border: 2.4px solid #373d46;
  border-radius: 6px;
  padding: 3.6px;
  box-shadow: 0 4.8px 0 #050607, 0 8.4px 21.6px #000b, inset 0 1.2px 0 #68717d, inset 0 0 0 3.6px #14171b;
}
.config-bar { transform: scale(0.8); }
.config-bar.bar-left { transform-origin: bottom left; }
.config-bar.bar-right { transform-origin: bottom right; }
/* Owner 08-23: 36×33 / 1.02rem → exactly 43.2×39.6 / 1.224rem (+20%). */
.config-bar button {
  flex: none; /* owner 2026-07-03 r6f: don't shrink — keep the single-line row sized */
  width: 43.2px;
  height: 39.6px;
  background: linear-gradient(180deg, #2d3137, #111317);
  color: var(--ui-text);
  border: 1.2px solid var(--ui-border);
  border-radius: 2.4px;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.224rem);
  cursor: pointer;
  transition: filter 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease, transform 0.08s ease;
  padding: 2.4px;
  line-height: 1;
}
.config-bar button:hover:not(:disabled) { background: linear-gradient(180deg, #3a4048, #171a1f); border-color: #8994a1; filter: brightness(1.12); }
.config-bar button:focus-visible {
  outline: 3px solid #f3d36a;
  outline-offset: 2px;
  border-color: #fff1ad;
}
.config-bar button:disabled {
  opacity: 0.46;
  filter: grayscale(0.7);
  cursor: not-allowed;
}
/* All authoritative toggle/mode states share one illuminated treatment; actions never receive data-active. */
.pitch-host .config-bar button[data-active='true'] {
  color: #f4fff6;
  background: linear-gradient(180deg, #347344, #173f25 58%, #0a2012);
  border-color: #72d98b;
  box-shadow: inset 0 1.2px 0 #d1ffdc99, inset 0 -2.4px 0 #07160b, 0 0 9.6px #50d273aa;
}
.pitch-host .config-bar button[data-active='true']:hover:not(:disabled) {
  filter: brightness(1.18);
  border-color: #a4f7b7;
}
/* Report Issue: a wider labelled button, amber-accented */
.config-bar button.report-btn {
  width: auto;
  height: 39.6px;
  padding: 0 13.2px;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.828rem);
  font-weight: 700;
  letter-spacing: 0.036em;
  color: var(--ui-heading);
  border-color: var(--ui-accent);
}
.config-bar button.report-btn:hover { background: #3a2f14; border-color: #b0902f; }
/* owner 2026-07-03 r6f: enlarge + punch the ladybug WITHOUT widening the button —
   transform:scale is visual only (no reflow), and the filter brightens the red +
   adds a small red glow so the bug reads clearly at the tiny bar size. */
.report-bug {
  display: inline-block;
  transform: scale(2.04);
  transform-origin: center;
  margin: 0 2.4px; /* breathing room so the scaled glyph clears "REPORT" */
  filter: saturate(1.7) brightness(1.12) drop-shadow(0 0 1.8px #ff2a2a);
}
.quick-brand-menu {
  position: relative;
  flex: 0 0 43.2px;
  width: 43.2px;
  height: 39.6px;
}
.config-bar .quick-menu { width: 43.2px; height: 39.6px; font-size: max(var(--ui-min-primary-text-size, 16px), 1.38rem); }
.quick-super-logo {
  position: absolute;
  z-index: 2;
  right: 0;
  bottom: calc(100% + 8.4px);
  width: 110.4px;
  height: 38.4px;
  object-fit: contain;
  box-sizing: border-box;
  padding: 3.6px 8.4px;
  border: 2.4px solid #373d46;
  border-radius: 4.8px 4.8px 2.4px 2.4px;
  background: linear-gradient(180deg, #262a30, #0a0c0e);
  box-shadow: 0 3.6px 0 #050607, inset 0 1.2px 0 #626b77;
  image-rendering: auto;
}
.config-bar .quick-live {
  position: absolute;
  z-index: 3;
  right: 117.6px;
  bottom: calc(100% + 8.4px);
  width: auto;
  min-width: 52.8px;
  padding: 0 10.8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #ff5454;
  border-color: #8c272b;
  white-space: nowrap;
}
.config-bar .quick-live .quick-live-dot { font-size: max(var(--ui-min-primary-text-size, 16px), 0.864rem); animation: live-text-pulse 1.6s ease-in-out infinite; }
.quick-live-row { display: flex; align-items: center; gap: 6px; }
/* Owner 09-09: expanded badge stacks the spectator names over the count line. */
.config-bar .quick-live.expanded { flex-direction: column; gap: 4px; padding: 6px 10.8px; }
.quick-live-names { display: flex; flex-direction: column; align-items: center; gap: 2px; color: #d3d6db; font-size: max(var(--ui-min-text-size, 12px), 0.72rem); letter-spacing: 0.03em; }
.config-bar .quick-live b { color: #fff; font-size: max(var(--ui-min-primary-text-size, 16px), 0.864rem); }
.quick-live-detail { color: #d3d6db; font-size: max(var(--ui-min-text-size, 12px), 0.684rem); letter-spacing: 0.048em; }
.config-bar .quick-live[data-flash='true'] { animation: live-flash 0.4s ease-in-out 3; }
/* Report modal (owner 2026-08-18) — rides the .cg-menu shell, amber-accented like the button. */
.br-menu { max-width: 520px; border-color: var(--ui-accent); }
.br-text {
  width: 100%;
  resize: vertical;
  font: inherit;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem);
  line-height: 1.35;
}
.br-count { text-align: right; margin: 2px 0 6px; }
.br-attach {
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  padding: 6px 10px;
  margin-bottom: 8px;
  background: color-mix(in srgb, var(--ui-surface-2) 60%, transparent);
}
.br-attach ul { margin: 4px 0 0; padding-left: 16px; }
.br-attach li { font-size: max(var(--ui-min-text-size, 12px), 0.74rem); color: var(--ui-muted, #9aa); line-height: 1.5; }
.br-error {
  color: #ffb4b4;
  border: 1px solid #a44;
  border-radius: 5px;
  padding: 6px 10px;
  font-size: max(var(--ui-min-text-size, 12px), 0.76rem);
  margin: 0 0 8px;
}
.br-fallback { text-align: center; margin-top: 8px; }
.br-fallback a { color: var(--ui-accent); }
/* Skill display has exactly two local presentation states: Icons / Markings. */
.config-bar button.skill-mode-btn {
  font-family: Arial, Helvetica, sans-serif;
  font-size: max(var(--ui-min-text-size, 12px), 0.7rem);
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--ui-accent);
}
.config-bar button.skill-mode-btn[data-skill-mode='icons'] {
  font-family: "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.18rem);
  font-weight: 400;
  letter-spacing: 0;
}
/* Preserve the edge anchor and full-size hit targets on narrow windows by collapsing only
   the redundant REPORT word; the button retains its title and accessible action name. */
@media (max-width: 520px) {
  .config-bar button.report-btn { width: 43.2px; padding: 0; }
  .config-bar .report-label { display: none; }
}
/* incoming-chat toast, top-left under the coach panel (owner 2026-07-03) */
/* Owner 2026-07-07: the positioned STACK container — chatToastStyle owns its anchor.
   Toasts flow oldest→newest top-to-bottom, so the newest sits at the bottom and a
   new arrival pushes the older ones up (capped at 3). */
.chat-toast-stack {
  position: absolute;
  z-index: 13;
}
/* Owner 09-06: above the end-game result window (50) and the MVP nominate overlay (55), interactive. */
.chat-toast-stack.endgame-front, .log-panel.endgame-front { z-index: 57; pointer-events: auto; }
.chat-toast-stack.endgame-front {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: max-content;
  max-width: 390px;
}
.chat-toast {
  /* owner 2026-07-04: +50% size; a flex child of .chat-toast-stack (owner 2026-07-07) */
  max-width: 390px;
  background: linear-gradient(180deg,
    rgb(33 37 43 / var(--hud-toast-opacity, 0.92)),
    rgb(8 10 12 / var(--hud-toast-opacity, 0.92)));
  border: 2px solid #3b424c;
  border-left: 4px solid #3977c9;
  border-radius: 4px;
  padding: 8px 12px 9px;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.94rem);
  color: var(--ui-text);
  box-shadow: 0 4px 0 #050607, 0 7px 18px #000b, inset 0 1px 0 #626b77;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
  animation: chat-toast-in 0.18s ease-out;
}
.chat-toast:hover { border-color: #6f9ede; background: linear-gradient(180deg, #303640f0, #0d1014f0); }
.chat-toast-sender { font-weight: 800; color: #78a7ef; letter-spacing: 0.03em; }
.chat-toast-text {
  color: #e5e1d7;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
@keyframes chat-toast-in {
  /* owner 2026-07-05: fade only — the position/transform is owned by the inline
     chatToastStyle so left/right/edge placements don't snap to centre on entry. */
  from { opacity: 0; }
  to { opacity: 1; }
}
/* #136: opponent-left connection toast — top-centre, amber warning tone (distinct from the red turn-toast). */
.opponent-left-toast {
  position: absolute;
  z-index: 44;
  top: 50%; /* owner 08-18: center screen — was pinned top under the scorebar */
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 18px;
  border-radius: 10px;
  background: linear-gradient(120deg, #4a3a08f2, #2a2006e8);
  border: 1.5px solid #e0b040cc;
  box-shadow: 0 6px 22px #000b;
  pointer-events: none;
  white-space: nowrap;
  animation: injury-in var(--p-280) ease-out;
}
.opponent-left-icon { font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem); color: #ffcf5a; line-height: 1; }
.opponent-left-text { font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); color: #ffe8b0; }
/* Team-reroll cue — de-escalated from a full splash to an icon-scale toast (g314/g315,
   event-priority.md P2 tier: a routine in-turn event, not a match-level one). Owner 2026-08-05:
   surfaces CENTERED directly under the scoreboard (was right:9%/top:62% off to the side) —
   mirrors .hud-center's left:50% centering; its own drop-in keyframe keeps the -50% centre. */
.reroll-toast {
  position: absolute;
  z-index: 40;
  left: 50%;
  top: 76px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 6px 16px;
  border-radius: 9px;
  background: linear-gradient(120deg, #7a0c0cf2, #300f0fe8);
  border: 2px solid #e03030cc;
  box-shadow: 0 6px 20px #000b, 0 0 16px #e0303044;
  pointer-events: none;
  white-space: nowrap;
  animation: reroll-toast-drop var(--p-2000) ease-in-out forwards;
}
@keyframes reroll-toast-drop {
  0% { opacity: 0; transform: translate(-50%, -8px); }
  12% { opacity: 1; transform: translate(-50%, 0); }
  85% { opacity: 1; transform: translate(-50%, 0); }
  100% { opacity: 0; transform: translate(-50%, -4px); }
}
.reroll-toast[data-side='home'] {
  background: linear-gradient(120deg, #0c1e7af2, #0a1030e8);
  border-color: #3a5be0cc;
  box-shadow: 0 6px 20px #000b, 0 0 16px #3a5be044;
}
.reroll-toast-icon { width: 22px; height: 22px; object-fit: contain; image-rendering: pixelated; }
.reroll-toast-text {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem);
  font-weight: 700;
  color: #fff;
  text-shadow: 0 2px 6px #000c;
}
/* U5 (owner 08-11): live-Fumblerooski banner — centered directly under the scoreboard (mirrors .hud-center's
   left:50% centering + the reroll-toast top offset). Persistent while the election is live (no auto-hide); it
   clears with fumblerooskieActive. */
.fumblerooskie-banner {
  position: absolute;
  z-index: 42;
  left: 50%;
  top: 76px;
  transform: translateX(-50%);
  padding: 7px 22px;
  border-radius: 9px;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem);
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #fff;
  white-space: nowrap;
  pointer-events: none;
  background: linear-gradient(120deg, #7a4a0cf2, #3a2410e8);
  border: 2px solid #e0a030cc;
  box-shadow: 0 6px 22px #000b, 0 0 18px #e0a03044;
  text-shadow: 0 2px 6px #000c;
}
/* floating MMO-style log panel — DEFAULT docked bottom-RIGHT (owner 2026-07-03);
   a dragged/persisted position (settings.logPos) overrides this. */
.log-panel {
  position: absolute;
  z-index: 11;
  right: 14px;
  bottom: 56px;
  width: 360px;
  height: 250px;
  /* Owner 2026-07-08: swapped layout anchors the Log at the bottom-LEFT (the Quick
     bar takes the bottom-right). The mount anchor + persisted logPos still win. */
  /* B9-12 fix: border-box so el.offsetWidth == the width we persist back — with
     the default content-box, offsetWidth (content+border) != the CSS width we
     write, so the ResizeObserver kept re-writing a bigger size and the window
     grew ~60px per tick without clamping. */
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  border: 3px solid #353b44;
  border-radius: 5px;
  overflow: hidden;
  background: linear-gradient(180deg,
    rgb(28 31 36 / var(--log-panel-opacity, 0.79)),
    rgb(7 9 11 / var(--log-panel-opacity, 0.79)));
  box-shadow: 0 4px 0 #050607, 0 8px 22px #000c, inset 0 1px 0 #68717d, inset 0 0 0 2px #121519;
  backdrop-filter: blur(2px);
  /* One explicit grip owns resizing. Native resize plus a decorative pseudo-grip
     created two competing targets and could leave pointer state latched. */
  resize: none;
  min-width: 240px;
  min-height: 88px;
  max-width: 80vw;
  max-height: 80vh;
}
.log-resizer {
  position: absolute;
  z-index: 8;
  right: 1px;
  bottom: 1px;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1px solid #6f7885;
  border-radius: 3px 0 2px;
  background: linear-gradient(135deg, #12161c 20%, #303844 50%, #11151a 80%);
  color: #dbe7f5;
  cursor: nwse-resize;
  user-select: none;
  touch-action: none;
  box-shadow: inset 0 0 0 1px #050709, -1px -1px 3px #000b;
}
.log-resizer:hover,
.log-resizer:focus-visible {
  color: #fff;
  border-color: #b9c8da;
  filter: brightness(1.25);
}
/* The inducement phase is modal: keep the dock below the full-host shader (44) and
   the complete picker/summary/footer surface (47). The attribute makes this phase-only;
   ordinary log stacking stays at 11, while diagnostics at 52+ remain above the phase. */
.log-panel[data-induce-open='true'] { z-index: 43; }
/* Owner 2026-07-08 (default): swap the bottom bars — Log leads at the bottom-left. */
.log-panel[data-swapped='true'] {
  left: 14px;
  right: auto;
}
.log-panel .tabs { cursor: move; } /* B2-9: drag handle */
/* B9-12: explicit floating-window drag grip so it's always grabbable, even after
   a resize when the tab buttons fill the bar. */
.log-panel .drag-grip {
  cursor: move;
  padding: 0 6px;
  color: #9aa2ad;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem);
  letter-spacing: -2px;
  user-select: none;
  align-self: center;
  transition: font-size 0.12s ease, padding 0.12s ease, color 0.12s ease;
}
/* Owner: the grip EXPANDS on mouse-over so it's easier to grab */
.log-panel .drag-grip:hover {
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.4rem);
  padding: 0 12px;
  color: #f0c24e;
}
/* Owner 2026-07-08: the B5-5 blur-the-log-during-an-injury-cinematic effect is REMOVED
   (the log stays legible while a stun/injury/casualty plays). */
.panel-settings {
  display: flex;
  gap: 10px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--ui-border);
  font-size: max(var(--ui-min-text-size, 12px), 0.7rem);
  color: var(--ui-text);
  font-family: Arial, Helvetica, sans-serif;
}
.panel-settings label { display: flex; align-items: center; gap: 4px; }
.panel-settings input[type='range'] { width: 64px; }
.log-holder {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.log-holder .log { flex: 1; }
.new-events {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  background: #3a5f3f;
  color: var(--ui-text);
  border: 1px solid #5a8a60;
  border-radius: 10px;
  padding: 2px 12px;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  cursor: pointer;
  box-shadow: 0 2px 8px #000a;
}
.log-panel[data-collapsed='true'] { height: auto; }
.log-panel .collapse {
  flex: 0 0 34px;
  background: transparent;
  color: var(--ui-muted);
  border: none;
  cursor: pointer;
}
/* Pop-Out Chat control (08-18). Fixed, non-shrinking slot in the tab bar so it can never be
   squeezed to zero width by the tabs — an invisible control reads as "the button does nothing". */
.log-panel .popout-btn {
  flex: 0 0 26px;
  min-width: 26px;
  background: transparent;
  color: var(--ui-muted);
  border: none;
  cursor: pointer;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem);
  line-height: 1;
  padding: 0;
}
.log-panel .popout-btn:hover { color: var(--ui-text); }
/* Owner 08-19: no popped-out tab styling — the CHAT tab is absent from the row while popped. */
.subtabs {
  display: flex;
  gap: 4px;
  padding: 4px 6px 0;
}
.subtabs button {
  background: var(--ui-surface);
  color: var(--ui-muted);
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  padding: 0.15rem 0.7rem;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  cursor: pointer;
}
.subtabs button[data-active='true'] {
  color: var(--ui-text);
  background: var(--ui-surface);
  border-color: #5a8a60;
}
.tabs {
  display: flex;
  padding: 3px 3px 2px;
  gap: 2px;
  border-bottom: 2px solid #090b0d;
  background: linear-gradient(180deg, #282c32, #111317);
  box-shadow: inset 0 1px 0 #5e6671;
}
/* Owner: compact emoji bar; emojis +50% (0.62 → 0.93rem, 2026-07-03) */
.tabs button {
  flex: 1;
  background: linear-gradient(180deg, #25292f, #0d0f12);
  color: var(--ui-muted);
  border: 1px solid #3d444d;
  border-radius: 2px;
  padding: 3px 0;
  cursor: pointer;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.93rem);
  line-height: 1.1;
}
.tabs button:last-child { border-right: 1px solid #3d444d; }
.tabs button[data-active='true'] {
  color: #f4c444;
  background: linear-gradient(180deg, #1d2024, #070809);
  border-color: #b38218;
  box-shadow: inset 0 -2px 0 #d29b1c, 0 0 5px #d29b1c33;
}
.tabs button:disabled { opacity: 0.4; cursor: default; }
/* Stencil tabs (owner 2026-07-03 r6f): each tab is the word in the ALPHA-RELEASE
   stencil display — white-outlined for legibility, opposition-team RED. Log/Chat
   keep their emoji beside the word; Roster is the word alone. Tabs keep flex:1;
   the content shrinks to fit, centred. */
.tabs button.stencil-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  overflow: hidden;
  padding: 1px 0;
  position: relative; /* anchor for the unread chat badge */
}
/* owner 2026-07-08: unread-chat count badge on the CHAT tab (only shown when toasts
   are off). The tab lets it overflow so the pill can sit at the top-right corner. */
.tabs button.stencil-tab.has-badge { overflow: visible; }
.chat-badge {
  position: absolute;
  top: -2px;
  right: 0;
  min-width: 13px;
  height: 13px;
  padding: 0 3px;
  box-sizing: border-box;
  border-radius: 7px;
  background: #e5484d;
  color: #fff;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-weight: 800;
  font-size: max(var(--ui-min-text-size, 12px), 0.5rem);
  line-height: 13px;
  text-align: center;
  box-shadow: 0 0 3px #000a, 0 0 5px #e5484d80;
  pointer-events: none;
}
.tab-emoji { font-size: max(var(--ui-min-text-size, 12px), 0.72rem); line-height: 1; flex: none; }
/* Roster helmet icon (owner 2026-07-03): the football-helmet.png sized like the
   Log/Chat emoji (justicon / Flaticon — attribution on hover + in Settings). */
.tab-icon { width: 0.9rem; height: 0.9rem; object-fit: contain; flex: none; image-rendering: auto; }
.tab-stencil {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-weight: 800;
  font-size: max(var(--ui-min-text-size, 12px), 0.46rem);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  /* owner 2026-07-03: white stencil word (was opposition-red) — the "lifted" outline/
     shadow/bloom below are unchanged; only the letter colour shifts back to white. */
  color: #f4f2ec;
  /* owner 2026-07-03 r6f: "lifted" stencil — a crisp BLACK outline for definition,
     a soft dark drop-shadow underneath for depth, and a red bloom so the word
     glows off the dark tab. */
  text-shadow:
    0.4px 0.4px 0 #000, -0.4px -0.4px 0 #000, 0.4px -0.4px 0 #000, -0.4px 0.4px 0 #000,
    0 0.4px 0 #000, 0 -0.4px 0 #000, 0.4px 0 0 #000, -0.4px 0 0 #000,
    0 1.4px 1.6px #000e,
    0 0 4px #e56a6ab0, 0 0 7px #e56a6a70;
  white-space: nowrap;
  line-height: 1;
}
.tabs button.stencil-tab[data-active='true'] .tab-stencil {
  color: #ffffff;
  /* active tab: same lift, a brighter bloom */
  text-shadow:
    0.4px 0.4px 0 #000, -0.4px -0.4px 0 #000, 0.4px -0.4px 0 #000, -0.4px 0.4px 0 #000,
    0 0.4px 0 #000, 0 -0.4px 0 #000, 0.4px 0 0 #000, -0.4px 0 0 #000,
    0 1.4px 1.6px #000e,
    0 0 5px #ff8080d0, 0 0 9px #ff707090;
}
.log {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 0.4rem 0.6rem;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  /* 08-18: stated, not inherited. The reverted pop-out build (c692e68f) left the main LOG
     unselectable; selectability of both logs is now an explicit property of .log. */
  user-select: text;
}
/* Owner 08-19: chat message text is PLAIN (--ui-text); only the coach NAME carries the
   seat colour (inline, same logNameColor source as log names). The old full-line side
   colours are retired. */
.log [data-kind='talk'] { color: var(--ui-text); }
/* owner 08-19: chat typography — Nuffle names over sans-serif message text; spectator lines pale green (inline style). */
.chat-log { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; }
.chat-log .log-name { font-family: 'Nuffle', system-ui, sans-serif; }
/* (Owner 08-19: the 07-08 full-line side colours are retired — the seat colour rides the
   coach-name span only, spectators/unknown senders stay plain.) */
.log [data-kind='system'] { color: var(--ui-muted); }
.chat input {
  width: 100%;
  box-sizing: border-box;
  background: var(--ui-surface);
  color: inherit;
  border: none;
  border-top: 1px solid var(--ui-border);
  padding: 0.45rem 0.6rem;
}
.roster {
  overflow-y: auto;
  padding: 0.5rem;
  font-size: max(var(--ui-min-text-size, 12px), 0.75rem);
}
.roster h3 { margin: 0 0 0.4rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); }
.roster ul { list-style: none; margin: 0; padding: 0; }
.roster li { padding: 2px 0; display: flex; gap: 4px; align-items: baseline; }
/* Owner ruling 08-17: roster rows open the same stat card a pitch-token click does. */
.roster li.roster-row { cursor: pointer; }
.roster li.roster-row:hover { background: rgba(255, 255, 255, 0.06); }
.roster .nr { color: var(--ui-muted); width: 16px; text-align: right; flex: none; }
.roster .pname { flex: none; }
.roster .acquired {
  color: #e0c060;
  font-size: max(var(--ui-min-text-size, 12px), 0.68rem);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.roster .pos { color: var(--ui-muted); margin-left: auto; flex: none; }
/* Owner 2026-07-04f: status/location label — casualty types read red, KO amber */
.roster .loc { color: #6a7f6a; width: 74px; text-align: right; flex: none; }
.roster .loc[data-status="KO'd"] { color: #e0b040; }
.roster .loc[data-status='Badly Hurt'],
.roster .loc[data-status='Seriously Hurt'],
.roster .loc[data-status='Dead'],
.roster .loc[data-status='Sent off'] { color: #e06a6a; }
.roster .loc[data-status='Reserves'] { color: #8a9ac0; }
.pitch-host {
  flex: 1;
  min-width: 0;
  position: relative;
}
.hotbar {
  position: absolute;
  z-index: 11;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  background: color-mix(in srgb, var(--ui-surface) 90%, transparent);
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  padding: 5px;
  box-shadow: 0 4px 14px #000a;
}
.hotbar button {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  width: 58px;
  padding: 5px 0 3px;
  background: var(--ui-surface);
  color: var(--ui-text);
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
}
/* owner 2026-07-07: hotbar icons are now emojis (matching the on-pitch action token) */
.hotbar-emoji { font-size: max(var(--ui-min-primary-text-size, 16px), 20px); line-height: 22px; height: 22px; }
/* owner 2026-07-02: declared action highlights GOLD */
.hotbar button[data-active='true'] {
  background: #6a5518;
  color: var(--ui-heading);
  border-color: var(--ui-accent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--ui-accent) 40%, transparent) inset;
}
.hotbar-nr {
  position: absolute;
  top: 2px;
  left: 5px;
  font-size: max(var(--ui-min-text-size, 12px), 0.6rem);
  color: var(--ui-muted);
}
.hotbar-label { font-size: max(var(--ui-min-text-size, 12px), 0.62rem); }
.hotbar button[data-used='true'] {
  opacity: 0.45;
  cursor: default;
}
.hotbar-used {
  position: absolute;
  top: 45%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-14deg);
  font-size: max(var(--ui-min-text-size, 12px), 0.6rem);
  font-weight: bold;
  letter-spacing: 0.08em;
  color: #f0b0b0;
  background: #3a1d1dd9;
  border: 1px solid #8a3a3a;
  border-radius: 3px;
  padding: 0 4px;
}
/* Confirm bars are rendered by ConfirmActionButton so move, aggression and
   punt flows share the same console chrome, keyboard chip and focus states. */
/* The Block fist is a click target; other cues stay transparent unless explicitly armed above. */
.o66-target-cue.clickable { pointer-events: auto; cursor: pointer; }
.o66-target-cue.clickable:hover { border-color: #fff0a0; background: rgba(40, 42, 46, 0.95); }
/* Punt UX v2 (owner 08-12): the draggable cone-centre confirm card. */
.punt-confirm-card {
  position: absolute;
  z-index: 14;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 9px;
  background: rgba(20, 22, 26, 0.94);
  border: 1px solid var(--ui-accent);
  box-shadow: 0 6px 20px #000a;
  white-space: nowrap;
  cursor: grab;
  pointer-events: auto;
}
.punt-confirm-card .pc-title { color: var(--ui-heading); font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); font-weight: 700; text-align: center; }
/* Owner W26 (08-13): screen-space direction picker CENTERED over the punter token — the grid's
   center cell stays empty so the token sprite shows through, arrows ring it on all four sides. */
.punt-reaim-pad {
  position: absolute;
  z-index: 14;
  transform: translate(-50%, -50%);
  display: grid;
  grid-template-areas:
    ". up ."
    "left . right"
    ". down .";
  grid-template-columns: repeat(3, 30px);
  grid-template-rows: repeat(3, 30px);
  gap: 6px;
  pointer-events: none;
}
.punt-reaim-pad .prp-up { grid-area: up; }
.punt-reaim-pad .prp-down { grid-area: down; }
.punt-reaim-pad .prp-left { grid-area: left; }
.punt-reaim-pad .prp-right { grid-area: right; }
.punt-reaim-pad .prp-nudge {
  pointer-events: auto;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 8px;
  background: rgba(20, 22, 26, 0.94);
  border: 1px solid var(--ui-accent);
  color: var(--ui-heading);
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem);
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.55);
}
.punt-reaim-pad .prp-nudge:hover { background: color-mix(in srgb, var(--ui-accent) 24%, rgba(20, 22, 26, 0.94)); }
.action-toast {
  position: absolute;
  z-index: 22;
  transform: translate(-50%, -130%);
}
/* Owner 09-05: the skill-use pill hangs just under the token's shadow (the skill icon stays on the player). */
.action-toast.below { transform: translate(-50%, 0); }
.action-toast {
  background: #3a1d1d;
  color: #f0b0b0;
  border: 1px solid #8a3a3a;
  border-radius: 5px;
  padding: 0.35rem 0.7rem;
  font-size: max(var(--ui-min-text-size, 12px), 0.78rem);
  white-space: pre-line;
  pointer-events: none;
  box-shadow: 0 4px 12px #000a;
}
/* Guided tour (owner 2026-07-03 r6f): gold arrow + explanatory toast */
.tour-arrow {
  position: fixed;
  z-index: 210;
  width: 42px;
  height: 42px;
  fill: none;
  stroke: var(--ui-accent);
  stroke-width: 4;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--ui-accent) 53%, transparent)) drop-shadow(0 2px 3px #000a);
  pointer-events: none;
  /* opacity-only pulse — the inline transform carries the position + rotation */
  animation: tour-arrow-pulse 1s ease-in-out infinite;
}
@keyframes tour-arrow-pulse { 0%, 100% { opacity: 0.62; } 50% { opacity: 1; } }
.tour-toast {
  position: fixed;
  z-index: 211;
  max-width: 250px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: color-mix(in srgb, var(--ui-surface-2) 93%, transparent);
  color: #f5e6c8;
  border: 1px solid color-mix(in srgb, var(--ui-accent) 53%, transparent);
  border-radius: 8px;
  padding: 9px 12px;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem);
  line-height: 1.4;
  box-shadow: 0 8px 24px #000c, 0 0 16px color-mix(in srgb, var(--ui-accent) 13%, transparent);
  pointer-events: auto;
  animation: coin-caption-in 0.25s ease-out;
}
.tour-skip {
  align-self: flex-end;
  background: var(--ui-surface);
  color: var(--ui-text);
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  padding: 2px 10px;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  cursor: pointer;
}
.tour-skip:hover { background: var(--ui-hover); }
/* FUMBBL play blocked splash (owner 2026-07-03 r6f) */
.fumbbl-block {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4vh 4vw;
  background: radial-gradient(ellipse at center, #0b1220f2 0%, #05070cf8 75%);
  backdrop-filter: blur(2px);
  animation: coin-fade 0.3s ease-out;
}
.fumbbl-block-card {
  max-width: 440px;
  background: var(--ui-surface-2);
  border: 1px solid var(--ui-accent);
  border-radius: 12px;
  padding: 22px 26px;
  box-shadow: 0 16px 44px #000c;
  color: var(--ui-text);
}
.fumbbl-block-card h2 { margin: 0 0 0.6rem; font-family: 'Nuffle', system-ui, sans-serif; color: var(--ui-heading); font-size: max(var(--ui-min-primary-text-size, 16px), 1.25rem); }
.fumbbl-block-card p { margin: 0.5rem 0; font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem); line-height: 1.5; }
.fumbbl-block-card ul { margin: 0.4rem 0 0.2rem; padding-left: 1.2rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.88rem); line-height: 1.6; color: var(--ui-text); }
.fumbbl-block-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 1rem; }
.fumbbl-block-actions button { border: none; border-radius: 6px; padding: 0.45rem 1rem; cursor: pointer; font-weight: 600; }
.fb-switch { background: #3a5f3f; color: #eafbea; }
.fb-switch:hover { background: #4a7a52; }
.fb-close { background: var(--ui-surface); color: var(--ui-text); border: 1px solid var(--ui-border); }
.fb-close:hover { background: var(--ui-hover); }

/* Owner 2026-07-07: connection-dropped prompt */
.conn-closed-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4vh 4vw;
  background: radial-gradient(ellipse at center, #0b1220f2 0%, #05070cf8 75%);
  backdrop-filter: blur(2px);
  animation: coin-fade 0.3s ease-out;
}
.conn-closed-card {
  max-width: 380px;
  background: var(--ui-surface-2);
  border: 1px solid #6a2b2b;
  border-radius: 12px;
  padding: 22px 26px;
  box-shadow: 0 16px 44px #000c;
  color: var(--ui-text);
  text-align: center;
}
.conn-closed-card h2 { margin: 0 0 0.6rem; font-family: 'Nuffle', system-ui, sans-serif; color: #e8918c; font-size: max(var(--ui-min-primary-text-size, 16px), 1.3rem); }
.conn-closed-card p { margin: 0.5rem 0 0; font-size: max(var(--ui-min-primary-text-size, 16px), 0.92rem); line-height: 1.5; }
.conn-closed-status { display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
.conn-closed-actions { display: flex; gap: 10px; justify-content: center; margin-top: 1.1rem; }
.conn-closed-actions button { border: none; border-radius: 6px; padding: 0.5rem 1.2rem; cursor: pointer; font-weight: 600; background: var(--ui-surface); color: var(--ui-text); border: 1px solid var(--ui-border); }
.conn-closed-actions button:hover { background: var(--ui-hover); }
.conn-closed-actions button.primary { background: #3a5f8f; color: #eaf2fb; border-color: #4a72a8; }
.conn-closed-actions button.primary:hover { background: #4a72a8; }
.conn-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid #e8918c55; border-top-color: #e8918c;
  animation: conn-spin 0.8s linear infinite;
}
@keyframes conn-spin { to { transform: rotate(360deg); } }

/* Owner 2026-07-07: spectated-concede modal */
.concede-overlay {
  position: fixed;
  inset: 0;
  z-index: 210;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4vh 4vw;
  background: radial-gradient(ellipse at center, #0b1220f0 0%, #05070cf5 75%);
  backdrop-filter: blur(2px);
  animation: coin-fade 0.3s ease-out;
}
.concede-card {
  max-width: 400px;
  background: var(--ui-surface-2);
  border: 1px solid var(--ui-accent);
  border-radius: 12px;
  padding: 24px 28px;
  box-shadow: 0 16px 44px #000c;
  color: var(--ui-text);
  text-align: center;
}
.concede-card h2 { margin: 0 0 0.7rem; font-family: 'Nuffle', system-ui, sans-serif; color: var(--ui-heading); font-size: max(var(--ui-min-primary-text-size, 16px), 1.4rem); }
.concede-card p { margin: 0.35rem 0; font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); line-height: 1.5; }
.concede-card .concede-team { font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); color: #aeb4bf; margin-top: 0; }
.concede-card button {
  margin-top: 1.2rem; border: 1px solid #4a72a8; border-radius: 6px; padding: 0.5rem 1.3rem;
  cursor: pointer; font-weight: 600; background: #3a5f8f; color: #eaf2fb;
}
.concede-card button:hover { background: #4a72a8; }
/* C6 (owner 2026-07-09): terminal server-shutdown overlay — mirrors the concede card with a
   warning-red accent (this is an abnormal end, not a clean result). */
.shutdown-overlay {
  position: fixed;
  inset: 0;
  z-index: 210;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4vh 4vw;
  background: radial-gradient(ellipse at center, #0b1220f0 0%, #05070cf5 75%);
  backdrop-filter: blur(2px);
  animation: coin-fade 0.3s ease-out;
}
.shutdown-card {
  max-width: 420px;
  background: var(--ui-surface-2);
  border: 1px solid #6a2f2a;
  border-radius: 12px;
  padding: 24px 28px;
  box-shadow: 0 16px 44px #000c;
  color: var(--ui-text);
  text-align: center;
}
.shutdown-card h2 { margin: 0 0 0.7rem; font-family: 'Nuffle', system-ui, sans-serif; color: #e8918c; font-size: max(var(--ui-min-primary-text-size, 16px), 1.4rem); }
.shutdown-card p { margin: 0.35rem 0; font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); line-height: 1.5; }
.shutdown-card .shutdown-sub { font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); color: #aeb4bf; }
.shutdown-card button {
  margin-top: 1.2rem; border: 1px solid #4a72a8; border-radius: 6px; padding: 0.5rem 1.3rem;
  cursor: pointer; font-weight: 600; background: #3a5f8f; color: #eaf2fb;
}
.shutdown-card button:hover { background: #4a72a8; }
/* Interactive reroll cinematic (owner 2026-07-03 r6f): reuses the .skill-choice
   card (position/silhouette/die), with a wider slot for the reroll buttons. */
.reroll-cine { border-color: var(--ui-accent); }
/* Owner 2026-07-08 (rev 4/5): the action-reroll surface follows the skill
   reference source. ICONS mode → the block-partial cluster (.bp-*) with gold trim;
   MARKINGS mode → the text menu below, each row led by the user's marking glyph. */
.reroll-bar { border-color: var(--ui-accent); z-index: 30; }
.reroll-bar .bp-hint { color: var(--ui-heading); font-weight: 700; }
.rr-decline-chip { color: #e56a6a; font-weight: 900; min-width: 32px; }
.rr-decline-chip:hover { border-color: #e56a6a; }
/* Owner 2026-07-08 (rev 7): SPECTATOR view — the surface is read-only (inert
   cursor, no hover affordance); the coach's PICK glows activation-gold, the same
   read as a player becoming the active selection. */
.reroll-bar[data-spectator='true'] button,
.reroll-menu[data-spectator='true'] .reroll-menu-item { cursor: default; }
/* Owner 2026-07-08 (pipeline Phase 3c): KO/injury interaction gate — a medical-cross
   accent on the title so it reads distinctly from the reroll surface. */
.injury-gate .reroll-menu-title { color: #ffd0d0; border-bottom: 1px solid #e0404033; }
.injury-gate .reroll-menu-glyph { color: #e05050; }
.injury-gate[data-side='home'] .reroll-menu-title { color: #d0dcff; }
.reroll-bar[data-spectator='true'] .bp-opt:hover { border-color: var(--ui-border); }
.reroll-menu[data-spectator='true'] .reroll-menu-item:hover { background: transparent; }
/* #188/#205: acting coach's team-reroll count. `.rr-trr-num` is the numeral that rides the re-roll die
   (icon-bar Team ReRoll button + block chooser via .bp-trr-num); `.rr-trr-inline` is the icon+numeral used
   inline on the text-menu rows and the Mascot TRR option. The old standalone `.rr-trr-avail` chip is retired
   by the #205 unification (the count now rides the die, never a separate badge). */
.rr-trr-num { font-size: max(var(--ui-min-text-size, 12px), 0.72rem); font-variant-numeric: tabular-nums; color: var(--ui-text); }
.rr-trr-inline {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 6px;
  pointer-events: none;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
.rr-trr-inline img { height: 13px; width: auto; }
.bp-opt[data-chosen='true'],
.bp-team[data-chosen='true'] {
  border: 1px solid var(--ui-accent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--ui-accent) 16%, transparent);
  animation: reroll-chosen-pulse 0.7s ease-in-out infinite alternate;
}
.reroll-menu-item[data-chosen='true'] {
  background: #6a5518 !important;
  color: var(--ui-heading);
  animation: reroll-chosen-pulse 0.7s ease-in-out infinite alternate;
}
@keyframes reroll-chosen-pulse {
  from { box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent) 33%, transparent), 0 0 8px color-mix(in srgb, var(--ui-accent) 47%, transparent); }
  to { box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent) 67%, transparent), 0 0 18px color-mix(in srgb, var(--ui-accent) 93%, transparent); }
}
/* #246: the acting coach gets the five-line failed-action prompt; passive spectators retain the compact context.
   The roll/needed rows are independently optional because block/team variants may not carry either value. */
.rr-context, .rr-context-row { display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 4px 8px 2px; }
.rr-context-row { border-bottom: 1px solid var(--ui-border); margin-bottom: 4px; cursor: default; }
.rr-context-row:hover { background: transparent; }
.rr-prompt-line { display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 22px; color: var(--ui-text); }
.rr-loner-line { margin-top: 8px; margin-bottom: 8px; }
.rr-ctx-label { font-weight: 800; font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); color: var(--ui-text); }
.rr-question { color: var(--ui-heading); font-weight: 800; }
.rr-context-spectator { flex-direction: row; align-items: center; padding-bottom: 8px; }
.rr-ctx-die { width: 22px; height: 22px; padding: 3px; }
.rr-context .sc-needed, .rr-context-row .sc-needed { font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem); }
.reroll-bar .bp-actions { justify-content: center; width: 100%; }
.reroll-bar .bp-opt { position: relative; }
.reroll-bar .bp-trr-num {
  left: 50%; right: auto; transform: translateX(-50%);
}
.reroll-bar .rr-trr-inline {
  position: absolute; left: 50%; bottom: -4px; transform: translateX(-50%);
  margin-left: 0; padding: 0 3px; border-radius: 7px;
  background: #0b0b0bd9; border: 1px solid #ffffff33;
}
.reroll-menu[data-spectator='false'] { display: flex; flex-wrap: wrap; justify-content: center; max-width: 300px; }
.reroll-menu[data-spectator='false'] .rr-context-row { flex: 0 0 100%; }
.reroll-menu[data-spectator='false'] .reroll-menu-item,
.reroll-menu[data-spectator='false'] .reroll-menu-decline { flex: 0 0 auto; }
.reroll-menu {
  transform: translateX(-50%);
  border-color: var(--ui-accent);
  box-shadow: 0 6px 18px #000c, 0 0 10px color-mix(in srgb, var(--ui-accent) 27%, transparent);
  z-index: 30;
}
.reroll-menu .reroll-menu-title {
  font-weight: 800;
  color: var(--ui-heading);
  cursor: default;
  border-bottom: 1px solid var(--ui-border);
}
.reroll-menu .reroll-menu-title:hover { background: transparent; }
.reroll-menu .reroll-menu-item { color: var(--ui-text); display: flex; align-items: center; gap: 7px; }
.reroll-menu .reroll-menu-glyph {
  min-width: 24px;
  text-align: center;
  font-weight: 900;
  color: var(--ui-heading);
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  padding: 1px 3px;
}
.reroll-menu .reroll-menu-decline { color: #e56a6a; }
.rr-fail-tag {
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem);
  font-weight: 800;
  letter-spacing: 0.1em;
  color: #e56a6a;
  text-shadow: 0 2px 5px #000d;
}
.rr-options { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; max-width: 260px; }
.blitz-special-warning { margin-top: 5px; color: #ffcf55; font-size: max(var(--ui-min-text-size, 12px), .78rem); }
.rr-options button {
  border: none;
  border-radius: 5px;
  padding: 4px 12px;
  cursor: pointer;
  font-weight: 600;
  font-family: 'Nuffle', system-ui, sans-serif;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem);
}
.rr-use { background: var(--ui-accent); color: #1a1305; }
.rr-use:hover { background: #d4ad3a; }
.rr-decline { background: var(--ui-surface); color: var(--ui-text); border: 1px solid var(--ui-border); }
.rr-decline:hover { background: var(--ui-hover); }
/* The authoritative blockPartial choice surface shares the standard gold-trimmed cluster. */
.block-partial {
  position: absolute; z-index: 51; left: 50%; top: 55%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  /* Choice surfaces share the gold trim with the action-reroll bar. */
  background: color-mix(in srgb, var(--ui-surface-2) 93%, transparent); border: 1px solid var(--ui-accent); border-radius: 8px; padding: 8px 10px;
  box-shadow: 0 6px 18px #000a;
}
/* Owner 09-08: die buttons grown linearly 50 -> 60 px (gap 6 -> 7 px, art overscale and 3D cube fill unchanged). */
.bp-dice { position: relative; isolation: isolate; display: flex; gap: 7px; }
.bp-dice :deep(.bp-dice-3d-canvas) { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; }
.bp-die {
  position: relative; z-index: 1;
  background: #f4f1e8; color: #14161a; border: 2px solid #1a1a1a; border-radius: 5px;
  padding: 4px 8px; font-weight: 800; font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); cursor: pointer; min-width: 46px;
}
.bp-die[data-armed="true"] { border-color: #e0555a; box-shadow: 0 0 0 2px #e0555a55; }
/* Owner 09-05: dice tumble — the face art rocks while the random faces cycle underneath it. */
.bp-die.bp-die-tumbling { opacity: 1; cursor: default; }
.bp-die.bp-die-tumbling img { animation: bp-die-tumble 0.14s ease-in-out infinite alternate; }
@keyframes bp-die-tumble { from { transform: rotate(-9deg) scale(0.94); } to { transform: rotate(9deg) scale(1.04); } }
.bp-die.bp-die-selected { border-color: var(--ui-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent) 55%, transparent); }
.bp-die.bp-die-choice { border-color: #f5c542; box-shadow: 0 0 0 3px #f5c54299, 0 0 12px #f5c54288; opacity: 1; }
.bp-die:hover { border-color: #5a8ad0; }
/* Uphill phase-one and nonchooser dice are informational: dimmed with no hover affordance. */
.bp-die[data-readonly="true"]:not(.bp-die-choice) { opacity: 0.72; cursor: not-allowed; }
.bp-die[data-readonly="true"].bp-die-choice { cursor: default; }
.bp-die[data-readonly="true"]:hover:not(.bp-die-choice) { border-color: #1a1a1a; }
.bp-decline { border-color: #7a6a3a; color: #e6d9b0; }
/* Owner P2 (o66): FACE-ART die-pick — the block-die art in place of the POW!/Push text (matches the
   classic Block Roll dialog / on-pitch dice). Legacy .bp-die (text) unchanged. */
.bp-die-art {
  box-sizing: border-box; width: 60px; height: 60px; min-width: 0; overflow: hidden;
  padding: 0; line-height: 0;
}
.bp-die-art img {
  display: block; width: 100%; height: 100%; object-fit: contain;
  image-rendering: pixelated; transform: scale(1.16);
}
.bp-die.bp-die-3d { background: transparent; }
.bp-die.bp-die-3d img { opacity: 0; animation: none; }
.bp-actions { display: flex; align-items: center; gap: 6px; }
.bp-opt {
  display: flex; align-items: center; justify-content: center;
  background: var(--ui-surface); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 5px;
  padding: 4px 8px; font-weight: 700; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); cursor: pointer; min-height: 32px;
}
.bp-opt img { width: 30px; height: 30px; object-fit: contain; image-rendering: pixelated; filter: drop-shadow(0 4px 5px #000c) drop-shadow(0 1px 2px #0009); }
.bp-opt[data-active="true"] { border-color: var(--ui-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent) 33%, transparent); }
.bp-opt:hover { border-color: #6f9ede; }
/* Owner 09-07: the watcher's read-only team re-roll cue — the live button's art, no interaction. */
.bp-actions--watch { pointer-events: none; opacity: 0.92; }
.bp-team--watch { display: inline-flex; align-items: center; position: relative; }
.bp-team { background: transparent; border: none; cursor: pointer; padding: 2px; position: relative; }
.bp-team img { width: 37px; height: 37px; object-fit: contain; image-rendering: pixelated; filter: drop-shadow(0 5px 6px #000d) drop-shadow(0 1px 2px #0009); }
/* #205: the acting coach's team-reroll count, a compact numeral badge on the block chooser's team-RR die
   (owner idiom — numeral immediately beside the die icon). pointer-events:none ⇒ never intercepts the resolve click. */
.bp-trr-num {
  position: absolute; right: -2px; bottom: -2px;
  min-width: 13px; padding: 0 3px; border-radius: 7px;
  background: #0b0b0bd9; border: 1px solid #ffffff33;
  color: var(--ui-text); line-height: 1.3; text-align: center; pointer-events: none;
}
/* owner o66j #6: the Mascot-alone option carries a small "No TRR" caption so it reads distinctly from the
   Mascot + RR variant (which falls back to a team re-roll if the mascot fails). */
.bp-mascot { display: inline-flex; flex-direction: column; align-items: center; gap: 1px; }
.bp-sub { font-size: max(var(--ui-min-text-size, 12px), 0.6rem); line-height: 1; color: #cfd6e0; letter-spacing: 0.02em; text-shadow: 0 1px 2px #000; }
.bp-hint { font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: #cfd6e0; }
.bp-multi-select { display: flex; align-items: center; gap: 6px; }
.bp-multi-select .bp-opt:disabled { opacity: 0.5; cursor: not-allowed; }
/* #58 SYNCHRONOUS multi-block resolution surface — one dice row per target (mirrors .block-partial's gold-trim
   dialog; reuses .bp-die for the block-face art). Centred high so both target rows stay visible. */
.multi-block-resolution {
  position: absolute; z-index: 51; left: 50%; top: 14%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  background: color-mix(in srgb, var(--ui-surface-2) 93%, transparent);
  border: 1px solid var(--ui-accent); border-radius: 8px; padding: 10px 14px; box-shadow: 0 6px 18px #000a;
}
.mbr-title { font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); font-weight: 800; letter-spacing: 0.04em; color: var(--ui-heading); }
.mbr-row { display: flex; align-items: center; gap: 12px; }
.mbr-name { min-width: 118px; text-align: right; font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); font-weight: 700; color: var(--ui-text); }
.mbr-dice { display: flex; gap: 6px; }
.mbr-actions { display: flex; align-items: center; gap: 6px; }
/* Savage Blow reroll-ALL-dice button — a subtle accent + the "ALL" badge so it reads apart from the single-die stars. */
.bp-savage { outline: 1px solid color-mix(in srgb, var(--ui-accent) 55%, transparent); outline-offset: 1px; }
.bp-savage .bp-sub { color: var(--ui-accent); font-weight: 800; }
.mbr-picked { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
/* #38 (owner tester): uphill-block labels stacked above the dice (the .block-partial flex-column). */
.bp-uphill { display: flex; flex-direction: column; align-items: center; gap: 1px; margin-bottom: 2px; }
.bp-uphill-title { font-size: max(var(--ui-min-text-size, 12px), 0.7rem); font-weight: 800; letter-spacing: 0.08em; color: var(--ui-heading); }
.bp-uphill-wait { font-size: max(var(--ui-min-text-size, 12px), 0.6rem); font-weight: 600; letter-spacing: 0.04em; color: var(--ui-text-dim); margin-top: 2px; }
/* Owner 2026-07-08: the unified VAMPIRE BLOODLUST card — surfaces like the sidestep/stand-firm skill
   toast (compact, TOKEN-BOUND via bloodlustPos), with a blood-drop marker + compact option buttons. */
.bloodlust-card .bl-marker { font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); vertical-align: -1px; }
.bloodlust-card {
  min-width: min(300px, calc(100% - 24px));
  max-width: min(360px, calc(100% - 24px));
  gap: 7px;
  padding: 10px 12px 12px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--ui-surface-2) 97%, #421018 3%), color-mix(in srgb, var(--ui-surface) 96%, #16070a 4%));
  border: 1px solid var(--ui-accent);
  border-radius: 8px;
  box-shadow: 0 7px 20px #000c, inset 0 1px 0 color-mix(in srgb, var(--ui-accent) 28%, transparent);
}
.bloodlust-card .bl-title,
.bloodlust-card > .sc-title {
  width: 100%;
  box-sizing: border-box;
  padding-bottom: 6px;
  border-bottom: 1px solid color-mix(in srgb, var(--ui-accent) 46%, transparent);
  color: var(--ui-heading);
  text-align: center;
  letter-spacing: 0.055em;
  text-shadow: 0 2px 5px #000;
}
.bloodlust-card .rr-prompt-line { justify-content: center; }
.bloodlust-card .bl-special-available {
  width: 100%;
  color: #f2ce68;
  font-size: max(var(--ui-min-text-size, 12px), 0.76rem);
  font-weight: 900;
  letter-spacing: 0.035em;
  text-shadow: 0 1px 3px #000;
}
.bloodlust-card .bl-opts { display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; max-width: 240px; }
/* Owner W37 mock: line-3 "Reroll?" + source buttons + ✕ share one wrapping row (rr-prompt-line's flex
   center gives the text/buttons alignment; this adds the wrap + gap the button row needs). */
.bloodlust-card .bl-reroll-row { flex-wrap: wrap; gap: 6px; max-width: 240px; }
.bl-opt {
  display: flex; align-items: center; justify-content: center; gap: 4px;
  background: var(--ui-surface); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 5px;
  padding: 4px 8px; font-weight: 700; font-size: max(var(--ui-min-text-size, 12px), 0.72rem); cursor: pointer; min-height: 28px;
}
.bl-opt:hover { border-color: var(--ui-accent); }
.bl-opt img { width: 22px; height: 22px; object-fit: contain; image-rendering: pixelated; filter: drop-shadow(0 2px 3px #000a); }
.bl-opt.bl-feed { color: #f2d4d4; border-color: #8a1a2a; }
.bl-opt.bl-feed:hover { border-color: #e0555a; box-shadow: 0 0 0 2px #e0555a44; }
.bl-opt.bl-decline { color: #e56a6a; }
.bl-opt.bl-decline:hover { border-color: #e56a6a; }
/* right-click context menu (owner 2026-07-02 UI shortcuts).
   Owner 2026-07-03 round 2: reduced to ~50% (font, padding, min-width). */
.context-menu,
.submenu {
  list-style: none;
  margin: 0;
  padding: 2px;
  background: color-mix(in srgb, var(--ui-surface) 97%, transparent);
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  box-shadow: 0 6px 20px #000b;
  min-width: 100px;
  font-size: max(var(--ui-min-text-size, 12px), 0.52rem); /* owner 2026-07-04: +30% (was 0.4rem) — the menu text was too small */
}
.context-menu {
  position: absolute;
  /* Owner (2026-07-03): sits above the config-bar (12), log (11) and hotbar so
     the declare-action row is never occluded by the bottom control strip. */
  z-index: 30;
}
.context-menu li {
  position: relative;
  padding: 0.21rem 0.35rem;
  border-radius: 3px;
  cursor: pointer;
  color: var(--ui-text);
}
/* Owner: the hovered item shades BRIGHT so the active element is unmistakable (was --ui-surface,
   near-invisible against the menu ground). */
.context-menu li:hover { background: var(--ui-primary); color: var(--ui-text-on-primary); }
.context-menu li:hover > .submenu-arrow { color: var(--ui-text-on-primary); }
.context-menu li[data-disabled='true'] {
  color: var(--ui-text-dim);
  cursor: default;
}
.context-menu li[data-disabled='true']:hover { background: transparent; color: var(--ui-text-dim); }
/* #6 (owner ruling 08-17): Jump Up shows ONLY as an inline icon on the Move row — no text prefix. Sized to
   the row's line-box and baseline-aligned via vertical-align (matches row height, no layout shift). */
.ctx-item-icon { width: 0.6rem; height: 0.6rem; object-fit: contain; vertical-align: -0.05rem; margin-right: 3px; }
.submenu-arrow { float: right; color: var(--ui-muted); }
.submenu {
  display: none;
  position: absolute;
  left: calc(100% - 4px);
  top: -4px;
  z-index: 31;
}
.context-menu li:hover > .submenu { display: block; }

/* docked player card — owner 2026-07-03 r3: bound to the RIGHT EDGE and centred
   on the screen's X axis (vertically centred), and VIEWPORT-BOUND: the card and
   all its contents scale with the window. `font-size` is the single anchor
   (viewport-clamped); every inner dimension is expressed in `em`, so resizing
   the window resizes the whole card uniformly. Sized to ~the round-2 footprint
   at a mid viewport. A user drag/resize (cardStyle) overrides position + box. */
.player-card {
  position: absolute;
  z-index: 10;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  /* owner 2026-07-03 r5: default sized to the owner's screenshot (~345px, larger
     text) while staying viewport-bound + resizable.
     Owner o66aj (#6 clarifier): the whole PANEL is ~22% smaller now — the em-based
     font-size drives width/padding/text, so dropping it shrinks the panel; the
     portrait max-height is bumped by the inverse below to hold its pixel size. */
  /* Owner 09-09: zoom + size for every element (~+30% base), the dead space around the portrait removed. */
  font-size: max(var(--ui-min-text-size, 12px), clamp(0.6rem, 0.4rem + 0.5vw, 0.92rem));
  width: 24em;
  background: color-mix(in srgb, var(--ui-surface) 95%, transparent);
  border: 1px solid var(--ui-border);
  border-radius: 0.9em;
  padding: 0.7em 0.85em;
  box-shadow: 0 4px 18px #000a;
  /* Owner 2026-07-03: movable (top-left grip / name bar) + resizable via a
     custom TOP-RIGHT handle (see .card-resize) — native `resize` only offers a
     bottom-right handle, so it is intentionally NOT used here. */
  box-sizing: border-box;
  overflow: auto;
  min-width: 16em;
  min-height: 9em;
  max-width: 60vw;
  max-height: 80vh;
}
.player-card .card-name { cursor: move; user-select: none; padding: 0 34px 0 14px; }
/* top-left drag grip (owner 2026-07-03) */
.player-card .card-grip {
  position: absolute;
  top: 3px;
  left: 6px;
  cursor: move;
  color: var(--ui-muted);
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem);
  line-height: 1;
  user-select: none;
  z-index: 2;
}
.player-card .card-grip:hover { color: var(--ui-text); }
/* top-right resize handle (owner 2026-07-03): a NE-drag grabber (two diagonal
   grip lines). Drives startCardResize; anchors the card's bottom-left corner. */
.player-card .card-resize {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  cursor: nesw-resize;
  opacity: 0.7;
  z-index: 2;
  background: linear-gradient(
    45deg,
    transparent 0 42%,
    var(--ui-muted) 42% 52%,
    transparent 52% 66%,
    var(--ui-muted) 66% 76%,
    transparent 76%
  );
}
.player-card .card-resize:hover { opacity: 1; }
.player-card .close {
  position: absolute;
  top: 3px;
  right: 22px;
  background: none;
  border: none;
  color: var(--ui-muted);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  cursor: pointer;
  z-index: 2;
}
.card-name { font-weight: bold; font-size: max(var(--ui-min-text-size, 12px), 1.16em); }
.card-name[data-side='home'] { color: #a0b8e8; }
.card-name[data-side='away'] { color: #e8a0a0; }
/* owner 2026-07-03 r5: white text below the name; SPP bumped ~+2pt */
.card-position { color: #ffffff; margin-bottom: 0.35em; font-size: 1.05em; }
.card-spp { font-size: max(var(--ui-min-text-size, 12px), 1.2em); font-weight: 600; }
.card-spp-gain { color: var(--ui-success); font-size: max(var(--ui-min-text-size, 12px), 0.85em); font-weight: 600; }
/* Owner 2026-07-08: current injury/location status on the card (KO amber, casualties red). */
.card-status { font-weight: 700; font-size: max(var(--ui-min-text-size, 12px), 0.95em); margin: -0.2rem 0 0.35rem; color: #cbd4cb; }
.card-status[data-status="KO'd"] { color: #e0b040; }
.card-status[data-status='Badly Hurt'],
.card-status[data-status='Seriously Hurt'],
.card-status[data-status='Dead'] { color: #e07a7a; }
.card-injuries {
  color: #e07a7a;
  font-size: max(var(--ui-min-text-size, 12px), 0.95em);
  margin: -0.2rem 0 0.4rem;
}
.card-body {
  display: flex;
  gap: 0.55em;
  align-items: stretch;
}
.card-stats {
  display: flex;
  flex-direction: column;
  gap: 0.3em;
  min-width: 6em; /* owner 09-09: bigger stat cards */
}
.card-stat {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  padding: 0.22em 0.65em;
  font-size: 1.22em; /* owner 09-09: stat value size */
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.card-stat em {
  font-style: normal;
  color: var(--ui-muted);
  font-size: 0.82em;
  font-weight: 600;
  letter-spacing: 0.03em;
}
.card-stat span[data-reduced='true'] {
  color: #f05050;
  font-weight: bold;
}
/* owner 2026-07-04: an improved characteristic (advancement) shows green */
.card-stat span[data-increased='true'] {
  color: #4fce6a;
  font-weight: bold;
}
.card-portrait {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at center, #2a3a24 0%, #14161a 85%);
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  min-height: 0; /* owner 09-09: the box follows the stat column (was 10.2em of mostly empty green) */
  overflow: hidden;
}
.card-portrait img {
  /* owner 09-09: zoomed in — the frame fills the box and the transparent padding around the figure is cropped */
  height: 100%;
  max-height: 9.6em;
  max-width: 100%;
  object-fit: contain;
  object-position: center;
  transform: scale(1.35);
  transform-origin: center center; /* owner 09-09: centred in the box (was biased low) */
  image-rendering: pixelated;
}
.portrait-missing { color: var(--ui-text-dim); font-size: max(var(--ui-min-text-size, 12px), 0.9em); }
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: #0008;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
/* owner 2026-07-08: Create Game modal (team library + matchmaking) */
.cg-backdrop { z-index: 120; }
.cg-menu {
  background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 10px;
  padding: 1.1rem 1.3rem; width: min(360px, 92vw); max-height: 82vh; overflow-y: auto;
  display: flex; flex-direction: column; gap: 0.6rem; color: #cdd4dd;
}
.cg-head { display: flex; align-items: center; justify-content: space-between; }
.cg-head h2 { margin: 0; font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem); }
.cg-close { background: none; border: none; color: #8a919c; font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem); cursor: pointer; }
.cg-close:hover { color: #dfe6df; }
.cg-field, .cg-field-label { display: flex; flex-direction: column; gap: 3px; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: var(--ui-text); }
.cg-field input { background: var(--ui-surface); color: inherit; border: 1px solid var(--ui-border); border-radius: 5px; padding: 0.45rem 0.55rem; }
.cg-suggest { list-style: none; margin: -0.4rem 0 0; padding: 0; border: 1px solid var(--ui-border); border-radius: 5px; background: var(--ui-surface); max-height: 140px; overflow-y: auto; }
.cg-suggest li { padding: 0.35rem 0.55rem; cursor: pointer; font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); }
.cg-suggest li:hover { background: #2a3550; }
.cg-teambtn { text-align: left; background: var(--ui-surface); color: inherit; border: 1px solid var(--ui-border); border-radius: 5px; padding: 0.5rem 0.6rem; cursor: pointer; font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); }
.cg-teambtn:hover { border-color: #4a5570; }
.cg-library { border: 1px solid var(--ui-border); border-radius: 6px; padding: 0.5rem; background: #16191f; display: flex; flex-direction: column; gap: 0.5rem; }
.cg-library-head { display: flex; justify-content: space-between; align-items: center; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); color: #8a919c; }
.cg-refresh { background: none; border: none; color: #8a919c; cursor: pointer; }
.cg-teamlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; }
.cg-teamcard { display: flex; flex-direction: column; gap: 2px; padding: 0.45rem 0.6rem; border: 1px solid #2a3038; border-radius: 5px; cursor: pointer; background: #1b1f26; }
.cg-teamcard:hover { border-color: #4a5570; }
.cg-teamcard.selected { border-color: var(--ui-accent); background: #2a2717; }
.cg-teamname { font-weight: 600; font-size: max(var(--ui-min-primary-text-size, 16px), 0.88rem); color: #e4e9f0; }
.cg-warn { color: #ffb24a; }
.cg-teammeta { font-size: max(var(--ui-min-text-size, 12px), 0.75rem); color: #98a0ac; }
.cg-ingest { display: flex; gap: 0.4rem; }
.cg-ingest input { flex: 1; min-width: 0; background: var(--ui-surface); color: inherit; border: 1px solid var(--ui-border); border-radius: 5px; padding: 0.4rem 0.5rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); }
.cg-ingest button, .cg-create, .cg-cancel { border-radius: 6px; padding: 0.45rem 0.9rem; cursor: pointer; font-weight: 600; }
.cg-ingest button { background: #2c3a2c; color: #dfe6df; border: 1px solid #3f5a3f; white-space: nowrap; }
.cg-ingest button:hover:not(:disabled) { background: #375037; }
.cg-status { color: #cbd4cb; }
.cg-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.3rem; }
.cg-cancel { background: #2a302a; color: #b8c0b8; border: 1px solid #3a423a; }
.cg-cancel:hover { background: #343b34; }
.cg-create { background: var(--ui-accent); color: #1a1305; border: 1px solid #d4ad3a; }
.cg-create:hover:not(:disabled) { background: #d4ad3a; }
.cg-create:disabled, .cg-ingest button:disabled { opacity: 0.55; cursor: default; }
.cg-waiting { display: flex; flex-direction: column; align-items: center; gap: 0.8rem; padding: 1rem 0; text-align: center; }
.cg-spinner { font-size: max(var(--ui-min-primary-text-size, 16px), 1.8rem); }
.settings-pane {
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  padding: 1.1rem 1.3rem;
  width: 340px;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.settings-pane h3 { margin: 0 0 0.2rem; }
.settings-pane label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem);
  color: var(--ui-text);
}
.settings-pane label.row { flex-direction: row; align-items: center; gap: 0.4rem; }
.settings-pane input:not([type='checkbox']) {
  background: var(--ui-surface);
  color: inherit;
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  padding: 0.4rem 0.55rem;
}
.settings-pane .hint { margin: 0; color: var(--ui-text-dim); font-size: max(var(--ui-min-text-size, 12px), 0.72rem); }
.settings-pane .actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.3rem;
}
.settings-pane .actions button {
  background: var(--ui-surface);
  color: inherit;
  border: none;
  border-radius: 4px;
  padding: 0.4rem 0.9rem;
  cursor: pointer;
}
.settings-pane .actions .primary { background: #3a5f3f; }

/* Both Modern HUD styles use the same responsive coach-corner geometry. Minimalist keeps the
   flat material language above; Console Chrome repeats the geometry below while adding
   the deeper casing. The log/chat dock and center scoreboard are intentionally excluded. */
.pitch-host.hud-minimalist .coach-panel {
  gap: 3px;
  padding: 4px 6px;
}
.pitch-host.hud-minimalist .logo-col {
  width: var(--coach-crest-size);
  flex-basis: var(--coach-crest-size);
}
.pitch-host.hud-minimalist .coach-lines { gap: 1px; }
.pitch-host.hud-minimalist .coach-name {
  padding: 1px 4px;
  font-size: max(var(--ui-min-text-size, 12px), 0.62rem);
  line-height: 1.05;
}
.pitch-host.hud-minimalist .team-title {
  padding: 1px 5px;
  font-size: max(var(--ui-min-text-size, 12px), 0.78rem);
  line-height: 1.08;
}
.pitch-host.hud-minimalist .inducements {
  gap: var(--coach-resource-gap);
  min-height: 58px;
  padding: 2px 3px;
}
.pitch-host.hud-minimalist .inducement {
  width: 100%;
  height: auto;
}
.pitch-host.hud-minimalist .inducement-quantity {
  top: -5px;
  right: -5px;
  min-width: 16px;
  padding: 1px 2px;
  font-size: max(var(--ui-min-text-size, 12px), 0.54rem);
}
.pitch-host.hud-minimalist .scoreboard:not(.flat-hud) {
  gap: 2px 6px;
  padding: 4px 10px 5px;
}

/* Modern HUD style: Console Chrome. The unqualified rules above are deliberately the saved
   Minimalist option; this layer adds only casing and material detail, never new controls. */
.pitch-host.hud-chrome {
  --chrome-edge-dark: #15191e;
  --chrome-edge-mid: #48505a;
  --chrome-edge-light: #7c858f;
  --chrome-well: #07090c;
  --chrome-shell-top: #555c65;
  --chrome-shell-mid: #262b31;
  --chrome-shell-low: #0b0e12;
  --chrome-button-red: #9b2027;
}
.pitch-host.hud-chrome .coach-panel {
  gap: 3px;
  padding: 5px 7px;
  border: 3px solid var(--chrome-edge-dark);
  border-radius: 11px 5px 11px 5px;
  background:
    linear-gradient(135deg, #ffffff12 0 8%, transparent 8% 91%, #0008 91%),
    linear-gradient(180deg,
      rgb(85 92 101 / var(--hud-coach-opacity, 0.9)) 0,
      rgb(38 43 49 / var(--hud-coach-opacity, 0.9)) 16%,
      rgb(7 9 12 / var(--hud-coach-opacity, 0.9)) 100%);
  outline: 2px solid var(--chrome-edge-mid);
  outline-offset: -5px;
  box-shadow:
    0 6px 0 #030405,
    0 11px 24px #000d,
    inset 0 2px 0 var(--chrome-edge-light),
    inset 0 -4px 0 #11151a,
    inset 0 0 0 7px #171b20;
}
.pitch-host.hud-chrome .coach-panel > * { position: relative; z-index: 1; }
.pitch-host.hud-chrome .coach-panel > .active-indicator { position: absolute; z-index: 0; }
.pitch-host.hud-chrome .coach-panel > .prayer-tag { position: absolute; z-index: 0; } /* owner 09-06: docks like the Current Player drawer, takes no panel space */
.pitch-host.hud-chrome .coach-panel > .coach-decision-status { position: absolute; z-index: 3; }
.pitch-host.hud-chrome .coach-panel::before {
  content: '';
  position: absolute;
  inset: 5px;
  z-index: 0;
  pointer-events: none;
  border: 1px solid #747c8655;
  border-radius: 5px 2px 6px 2px;
  background:
    radial-gradient(circle at 6px 6px, #aab0b7 0 1px, #171a1f 1.5px 3px, transparent 3.5px),
    radial-gradient(circle at calc(100% - 6px) 6px, #aab0b7 0 1px, #171a1f 1.5px 3px, transparent 3.5px),
    radial-gradient(circle at 6px calc(100% - 6px), #aab0b7 0 1px, #171a1f 1.5px 3px, transparent 3.5px),
    radial-gradient(circle at calc(100% - 6px) calc(100% - 6px), #aab0b7 0 1px, #171a1f 1.5px 3px, transparent 3.5px);
}
.pitch-host.hud-chrome .coach-panel::after {
  content: '';
  position: absolute;
  top: 7px;
  bottom: 7px;
  z-index: 0;
  width: 4px;
  pointer-events: none;
  border: 1px solid #07090c;
  border-top-color: #717b86;
  border-bottom-color: #020304;
  border-radius: 5px 2px 5px 2px;
}
.pitch-host.hud-chrome .coach-panel.home::after {
  left: 2px;
  background:
    linear-gradient(90deg, #07111d, #d8efff 35%, #4c9de0 62%, #09131f),
    linear-gradient(180deg, #28598f, #7bb9ff 45%, #1d4779);
  box-shadow: inset 1px 0 0 #e7f6ffff, inset -1px 0 0 #06101b, 0 0 5px var(--seat-home-text), 0 0 11px var(--seat-home-bright);
}
.pitch-host.hud-chrome .coach-panel.away::after {
  right: 2px;
  background:
    linear-gradient(90deg, #1d080b, #ffe0e2 35%, #ed646d 62%, #1b070a),
    linear-gradient(180deg, #8f2b32, #ff7b82 45%, #791f27);
  box-shadow: inset 1px 0 0 #fff1f2ff, inset -1px 0 0 #1a0608, 0 0 5px var(--seat-away-text), 0 0 11px var(--seat-away-bright);
}
.pitch-host.hud-chrome .coach-panel.home {
  border-left-color: #315f9a;
  border-top-color: #4d5967;
}
.pitch-host.hud-chrome .coach-panel.away {
  border-right-color: #97343a;
  border-top-color: #4d5967;
}
.pitch-host.hud-chrome .logo-col {
  position: relative;
  box-sizing: border-box;
  width: var(--coach-crest-size);
  min-height: var(--coach-crest-size);
  height: auto;
  align-self: stretch;
  flex-basis: var(--coach-crest-size);
  padding: 0;
  border: 2px solid #343b44;
  border-radius: 5px 2px 5px 2px;
  background: #000;
  box-shadow: inset 0 2px 5px #000, inset 0 1px 0 #747d8755, 0 2px 0 #030405;
}
.pitch-host.hud-chrome .coach-panel.home .logo-col { border-color: var(--seat-home-mid); }
.pitch-host.hud-chrome .coach-panel.away .logo-col { border-color: var(--seat-away-mid); }
.pitch-host.hud-chrome .race-logo {
  width: 100%;
  height: 100%;
  max-height: none;
  box-sizing: border-box;
  padding: 0;
  border: 2px solid #080a0d;
  border-radius: 3px;
  background: transparent;
  box-shadow: 0 0 0 1px #4d555f, inset 0 0 7px #000, 0 2px 0 #020304;
}
.pitch-host.hud-chrome .coach-lines {
  box-sizing: border-box;
  gap: 1px;
  padding: 3px;
  border: 2px solid #252b32;
  border-radius: 4px;
  background:
    linear-gradient(180deg, #15191ee8, #05070ae8),
    repeating-linear-gradient(0deg, transparent 0 9px, #ffffff08 9px 10px);
  box-shadow: inset 0 4px 9px #000e, 0 1px 0 #6d768055;
}
.pitch-host.hud-chrome .coach-panel.home .coach-lines { border-right-color: color-mix(in srgb, var(--seat-home-mid) 60%, transparent); }
.pitch-host.hud-chrome .coach-panel.away .coach-lines { border-left-color: color-mix(in srgb, var(--seat-away-mid) 60%, transparent); }
.pitch-host.hud-chrome .coach-name,
.pitch-host.hud-chrome .team-title {
  width: 100%;
  box-sizing: border-box;
  border: 2px solid #303741;
  border-radius: 3px;
  background: linear-gradient(180deg, #05070a, #101419);
  box-shadow: inset 0 3px 7px #000, 0 1px 0 #69717b66;
}
.pitch-host.hud-chrome .coach-name {
  padding: 1px 4px;
  font-size: max(var(--ui-min-text-size, 12px), 0.62rem);
  line-height: 1.05;
}
.pitch-host.hud-chrome .team-title {
  padding: 1px 5px;
  font-size: max(var(--ui-min-text-size, 12px), 0.78rem);
  line-height: 1.08;
}
.pitch-host.hud-chrome .inducements {
  gap: var(--coach-resource-gap);
  min-height: 58px;
  padding: 2px 3px;
  border: 2px solid #343b44;
  border-radius: 4px;
  background: linear-gradient(180deg, #06080ae8, #11151ae8);
  box-shadow: inset 0 4px 8px #000e, 0 1px 0 #77808a66;
}
.pitch-host.hud-chrome .inducement {
  width: 100%;
  height: auto;
  border: 2px solid #424a54;
  border-radius: 4px;
  background: linear-gradient(145deg, #30363e 0 18%, #0b0e12 18% 82%, #242a31 82%);
  box-shadow: inset 0 2px 3px #000, inset 0 -1px 0 #727b8555, 0 2px 2px #000b;
}
.pitch-host.hud-chrome .inducement-quantity {
  top: -5px;
  right: -5px;
  min-width: 16px;
  padding: 1px 2px;
  font-size: max(var(--ui-min-text-size, 12px), 0.54rem);
}

.pitch-host.hud-chrome .hud-center.scoreboard {
  gap: 3px 7px;
  padding: 7px 12px 8px;
  border: 3px solid var(--chrome-edge-dark);
  border-radius: 9px 9px 13px 13px;
  background:
    linear-gradient(135deg, #ffffff12 0 7%, transparent 7% 93%, #0009 93%),
    linear-gradient(180deg,
      rgb(86 93 102 / var(--hud-scoreboard-opacity, 0.9)) 0,
      rgb(37 42 48 / var(--hud-scoreboard-opacity, 0.9)) 18%,
      rgb(6 8 11 / var(--hud-scoreboard-opacity, 0.9)) 100%);
  outline: 2px solid #4d555f;
  outline-offset: -5px;
  box-shadow: 0 4px 0 #080a0d, 0 9px 19px #000b, inset 0 2px 0 #9aa2ab, inset 0 -3px 0 #1a1f25;
}
.pitch-host.hud-chrome .hud-center.scoreboard > * { position: relative; z-index: 1; }
.pitch-host.hud-chrome .hud-center.scoreboard::before {
  content: '';
  position: absolute;
  inset: 6px;
  pointer-events: none;
  border: 1px solid #747d8755;
  border-radius: 3px 3px 7px 7px;
  background:
    radial-gradient(circle at 6px 6px, #aeb4bb 0 1px, #15191d 1.5px 3px, transparent 3.5px),
    radial-gradient(circle at calc(100% - 6px) 6px, #aeb4bb 0 1px, #15191d 1.5px 3px, transparent 3.5px),
    radial-gradient(circle at 6px calc(100% - 6px), #aeb4bb 0 1px, #15191d 1.5px 3px, transparent 3.5px),
    radial-gradient(circle at calc(100% - 6px) calc(100% - 6px), #aeb4bb 0 1px, #15191d 1.5px 3px, transparent 3.5px);
}
.pitch-host.hud-chrome .hud-center.scoreboard::after {
  content: '';
  position: absolute;
  left: 35%;
  right: 35%;
  bottom: -10px;
  height: 6px;
  pointer-events: none;
  border: 2px solid #080a0d;
  background: repeating-linear-gradient(90deg, #252a30 0 6px, #0a0c0f 6px 10px);
  box-shadow: 0 2px 0 #000;
}
.pitch-host.hud-chrome .scoreboard .sb-cell {
  min-height: 20px;
  box-sizing: border-box;
  padding: 2px 6px;
  border: 1px solid #59616b;
  border-radius: 3px;
  background: linear-gradient(180deg, #20262d, #0d1116);
  box-shadow: inset 0 2px 4px #000b, 0 1px 0 #8a939d66;
}
.pitch-host.hud-chrome .scoreboard .sb-weather { min-width: 52px; }
/* Scoreboard-only commit control. This rule deliberately follows Chrome's generic
   `.sb-cell` plate so both Modern themes keep the same red, fitted bevel. */
.pitch-host .hud-center.scoreboard .end-turn {
  appearance: none;
  align-self: center;
  justify-self: center;
  width: auto;
  min-width: clamp(112px, 9vw, 120px);
  min-height: 28px;
  box-sizing: border-box;
  padding: 4px 6px;
  color: #fff7f2;
  background:
    linear-gradient(135deg, #ffffff38 0 8%, transparent 8% 90%, #42040a 90%),
    linear-gradient(180deg, #ed5963 0, #bd2532 45%, #751019 100%);
  border: 2px solid #4b070d;
  border-top-color: #ff9aa1;
  border-left-color: #df515b;
  border-radius: 5px;
  box-shadow: inset 0 1px 0 #ffffff70, inset 0 -2px 0 #4b070d, 0 3px 0 #210306, 0 5px 8px #0009;
  font-family: inherit;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: 0.02em;
  text-shadow: 0 1px 1px #350207;
  white-space: nowrap;
  cursor: pointer;
  transition: filter 0.12s ease, transform 0.08s ease, box-shadow 0.08s ease;
}
.pitch-host .hud-center.scoreboard .end-turn:hover:not(:disabled) { filter: brightness(1.12); }
.pitch-host .hud-center.scoreboard .end-turn:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: inset 0 2px 2px #45050a, inset 0 -1px 0 #ff7b84, 0 1px 0 #210306, 0 2px 4px #0009;
}
.pitch-host .hud-center.scoreboard .end-turn:disabled {
  color: #aeb4bc;
  background: linear-gradient(180deg, #525860, #292e34 48%, #111419);
  border-color: #111419;
  border-top-color: #343a42;
  border-left-color: #2a3037;
  box-shadow: inset 0 3px 6px #000d, inset 0 -1px 0 #4b535c55, 0 1px 0 #626b7555;
  text-shadow: 0 1px 1px #000;
  opacity: 0.82;
  cursor: default;
}
.pitch-host .hud-center.scoreboard .end-turn[data-opponent='true'] { min-width: 142px; }
.pitch-host .hud-center.scoreboard .end-turn[data-setup='true'] {
  min-width: max(136px, calc(var(--ui-min-text-size, 12px) * 9));
}

.pitch-host.hud-chrome .config-bar {
  gap: 2.4px;
  padding: 4.8px;
  border: 3.6px solid var(--chrome-edge-dark);
  border-radius: 9.6px;
  background:
    linear-gradient(135deg, #ffffff10 0 8%, transparent 8% 92%, #0008 92%),
    linear-gradient(180deg,
      rgb(86 93 102 / var(--hud-quickbar-opacity, 0.9)) 0,
      rgb(38 43 49 / var(--hud-quickbar-opacity, 0.9)) 22%,
      rgb(6 8 11 / var(--hud-quickbar-opacity, 0.9)) 100%);
  outline: 2.4px solid #3f464f;
  outline-offset: -6px;
  box-shadow: 0 7.2px 0 #030405, 0 13.2px 28.8px #000d, inset 0 2.4px 0 #7e8792, inset 0 -4.8px 0 #15191e;
}
.pitch-host.hud-chrome .config-bar button {
  border: 2.4px solid #3f464f;
  border-radius: 6px 6px 3.6px 3.6px;
  background: linear-gradient(145deg, #555d67 0 15%, #1a1e23 15% 82%, #090b0e 82%);
  box-shadow: inset 2.4px 2.4px 0 #aeb5bd44, inset -2.4px -2.4px 0 #030405, 0 3.6px 0 #050607;
}
.pitch-host.hud-chrome .config-bar button:active:not(:disabled) {
  transform: translateY(2.4px);
  box-shadow: inset 2.4px 2.4px 4.8px #020304, 0 1.2px 0 #050607;
}
.pitch-host.hud-chrome .config-bar button.report-btn {
  background: linear-gradient(180deg, #bd3038, var(--chrome-button-red) 48%, #4b1015);
  border-color: #ec5d63;
  color: #fff;
}
.pitch-host.hud-chrome .config-bar button[data-active='true'] {
  color: #f4fff6;
  background: linear-gradient(145deg, #79b889 0 14%, #245c33 14% 78%, #0b2513 78%);
  border-color: #86e39b;
  box-shadow: inset 2.4px 2.4px 0 #e0ffe777, inset -2.4px -2.4px 0 #06140a, 0 3.6px 0 #050607, 0 0 12px #59df79aa;
}
.pitch-host.hud-chrome .config-bar button[data-active='true']:hover:not(:disabled) {
  border-color: #b2f6c0;
  filter: brightness(1.15);
}
.pitch-host.hud-chrome .quick-super-logo {
  padding: 2.4px 6px;
  border: 3.6px solid var(--chrome-edge-dark);
  outline: 2.4px solid #424951;
  outline-offset: -7.2px;
  background: linear-gradient(145deg, #343a42, #090b0e 66%);
  box-shadow: 0 6px 0 #030405, 0 9.6px 21.6px #000c, inset 0 2.4px 0 #7b848e;
}
.pitch-host.hud-chrome .config-bar .quick-live {
  border-color: #84282d;
  background: linear-gradient(180deg, #38161a, #0c090b);
  box-shadow: inset 0 1px 0 #ff6d7455, 0 3px 0 #050607, 0 0 9px #d2313866;
}

.pitch-host.hud-chrome .log-panel {
  border: 3px solid var(--chrome-edge-dark);
  border-radius: 10px 5px 11px 5px;
  outline: 2px solid #3f464f;
  outline-offset: -5px;
  background:
    linear-gradient(135deg, #ffffff0d 0 7%, transparent 7% 93%, #0009 93%),
    linear-gradient(180deg,
      rgb(80 87 96 / var(--log-panel-opacity, 0.79)) 0,
      rgb(31 36 42 / var(--log-panel-opacity, 0.79)) 13%,
      rgb(4 6 8 / var(--log-panel-opacity, 0.79)) 100%);
  box-shadow: 0 4px 0 #080a0d, 0 9px 19px #000c, inset 0 2px 0 #8a939d, inset 0 -3px 0 #1a1f25;
}
.pitch-host.hud-chrome .log-panel .tabs {
  min-height: 29px;
  padding: 2px 3px;
  border-bottom: 2px solid #20252b;
  background: linear-gradient(180deg, #444b54, #171b20);
  box-shadow: inset 0 1px 0 #737c8655, 0 2px 0 #363d45;
}
.pitch-host.hud-chrome .log-panel .stencil-tab {
  border: 2px solid #303741;
  border-radius: 4px 4px 1px 1px;
  background: linear-gradient(180deg, #252b32, #090b0e);
  box-shadow: inset 0 1px 0 #69727c55, 0 2px 0 #030405;
}
.pitch-host.hud-chrome .log-panel .collapse {
  flex: 0 0 25px;
  min-width: 25px;
  border: 1px solid #545c66;
  border-radius: 3px;
  background: linear-gradient(180deg, #434a53, #171b20);
  color: #d5d9de;
  box-shadow: inset 1px 1px 0 #a2a9b044, inset -1px -1px 0 #080a0d;
}
.pitch-host.hud-chrome .log-panel .collapse:hover {
  border-color: #7b858f;
  background: linear-gradient(180deg, #555e69, #20252b);
}
.pitch-host.hud-chrome .log-holder,
.pitch-host.hud-chrome .roster {
  margin: 3px;
  border: 2px solid #242a31;
  background: #030506aa;
  box-shadow: inset 0 4px 12px #000f, 0 1px 0 #6c747d55;
}
.pitch-host.hud-chrome .chat-toast {
  border: 3px solid #080a0d;
  border-radius: 7px 3px 7px 3px;
  outline: 1px solid #454c55;
  outline-offset: -5px;
  background: linear-gradient(145deg,
    rgb(44 49 56 / var(--hud-toast-opacity, 0.92)),
    rgb(5 7 9 / var(--hud-toast-opacity, 0.92)));
  box-shadow: 0 5px 0 #030405, 0 9px 19px #000d, inset 0 1px 0 #77808a;
}
</style>
