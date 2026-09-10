<script setup lang="ts">
/**
 * FUMBBL Classic view — FC0 shell + FC1 field (docs/fumbbl-classic-mode-plan.md).
 *
 * Second PRESENTATION of the shared state machine: imports the SAME `gameStore`,
 * settings and protocol as SpectateView — the store/wire/assets are NOT forked.
 * The classic icon pipeline (resolver + manifests) is registered at MODULE scope
 * in SpectateView.vue, which App.vue imports at startup, so it is already live
 * here without re-doing it.
 *
 * FC1 mounts the shared renderer with a CLASSIC preset (FC-D decisions 2026-07-08):
 *  - classic-in-spirit: flat 2D uniform grid, our type/polish (not pixel-exact);
 *  - FUMBBL pitch image underlay + classic iconsets;
 *  - decor (broadcast cameras / stadium props) OFF; static camera;
 *  - static camera keeps SpectateView's cinematic ZOOM off, BUT the pre-kickoff
 *    presentation cines (coin/weather/dodgy-snack/kickoff/fan-factor) ARE rendered
 *    (owner 2026-08-12, reversing the original FC-D3 no-cinematics call) — store-
 *    driven overlays; only the kickoff ball-hold touches the renderer.
 * The frame (scoreboard/sidebars/log/menu, 4 layouts) is FC2; dialogs are FC3.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type WatchStopHandle } from 'vue';
import { FORK_EDITION } from '../game/edition';
import { isOnPitch, PitchRenderer, skillIconUrl, presentationMs } from '@fumbbl40k/ffb-pitch';
import { effectiveArmour, effectiveMovement, type GameJson, type PlayerJson } from '@fumbbl40k/ffb-protocol';
import { gameStore } from '../game/store';
import { initPitchRendererMount } from '../game/pitchRendererMount';
import { hmpScatterSkillUseCardCopy, passSkillUseCardCopy } from '../game/skillUseCardPresentation';
import { swoopChoiceCopy } from '../game/logic/swoopPresentation';
import { visibleMatchLogEntries } from '../game/logVisibility';
import { selectedLocalFumbblAssetUrl } from '../game/fumbblAssetCache';

import { activeServerTarget, applyServerTarget, FUMBBL_SITE, resolveJoinCreds, settings } from '../game/settings';
import { ui } from '../game/ui';
import { computeConfigMarkings, anyMarkerConfigured, playerDetailSkills } from '../game/skillDisplay';
import { playerSkillCategoryClass } from '../game/skillCategory';
import { generateAllMarkings, type AutoMarkingConfig } from '../game/markings';
import { playSound } from '../game/sounds';
import { watchAssetModRendererRefresh } from '../game/assetModUi';
import { assetMods } from '../game/assetMods';
import {
  ClassicPortraitProjection,
  classicPortraitVisualRevision,
  watchClassicVideoOptions,
} from '../game/classicPortraitProjection';
import ClassicDialog, { type ClassicDialogButton } from './ClassicDialog.vue';
import D6Face from '../components/D6Face.vue';
import LogFontSelect from '../components/LogFontSelect.vue';
import BlockChooserCopy from '../components/BlockChooserCopy.vue';
import EligibleRosterPicker from '../components/EligibleRosterPicker.vue';
import WatchOutToast from '../components/WatchOutToast.vue';
import SppGainToast from '../components/SppGainToast.vue';
import TurnToast from '../components/TurnToast.vue';
import IntensiveTrainingChoice from '../components/IntensiveTrainingChoice.vue';
import PlayerDetailSkillList from '../components/PlayerDetailSkillList.vue';
import OnTheBallWaitingModal from '../components/OnTheBallWaitingModal.vue';
import SendOffWaitingModal from '../components/SendOffWaitingModal.vue';
import BlockAttackConfirmModal from '../components/BlockAttackConfirmModal.vue';
import { hasOffPitchCandidate, resolveRosterPickCandidates } from '../game/rosterPicker';
import { d6LogParts } from '../game/d6Log';
import { quickSnapExhaustedText } from '../game/quickSnapController';
import { deriveClientState, type ClientStateContext } from '../game/logic/clientStateMachine';
import { adjacentStandingEnemyIds, availableActions, BLOCK_KIND_LABEL, blockAlternativeOffers, blockAttackPreview, chompAvailable, boundingLeapOffer, furiousOutburstCoordinatePrompt, movesRandomly, normSquare, serverMoveSquares, type CoachAction, type BlockKind } from '../game/logic/availableActions';
import { isBlitzMovementState, requiresBlitzEndConfirmation, onPlayerClick as o66PlayerClick, onSquareClick as o66SquareClick, swoopCoordinateSquares } from '../game/logic/order66Interaction';
import { gazeConfirmRefusalReason, gazeTargetClick, isGazeMovementState } from '../game/logic/gazeMovementState';
import { installGazeVictimPresentation } from '../game/gazeVictimPresentation';
import type { WideRailPreActionRuleId } from '../game/logic/wideRailPreAction';
import { currentBlockChoosingTeamId, isCurrentBlockChoiceDialog, projectBlockChooser, type BlockChooserSide } from '../game/blockChooser';
import { classicTokenToastScreenPosition } from '../game/tokenToastFollower';

const props = withDefaults(defineProps<{ mode?: 'spectate' | 'play' }>(), { mode: 'spectate' });
// #234 (owner-fg 07-29): end-game Play/Spectate buttons return to the current service's lobby.
// Mirrors SpectateView's select-mode emit — App.vue routes it via @select-mode="selectMode".
const emit = defineEmits<{ (e: 'select-mode', mode: 'play' | 'spectate'): void }>();
function onPlayGame(): void { emit('select-mode', 'play'); }
function onSpectateGame(): void { emit('select-mode', 'spectate'); }

const CLASSIC_SKILL_MARKING_FONTS: Record<typeof settings.skillMarkingFont, string> = {
  arial: 'Arial, Helvetica, sans-serif',
  helvetica: 'Helvetica, Arial, sans-serif',
  system: 'system-ui, "Segoe UI", sans-serif',
  nuffle: 'Nuffle, Arial, sans-serif',
};
function classicSkillMarkingStyle() {
  const parsed = Number.parseInt(settings.skillMarkingColor.replace('#', ''), 16);
  return {
    fontFamily: CLASSIC_SKILL_MARKING_FONTS[settings.skillMarkingFont],
    fontSize: settings.skillMarkingSize,
    color: Number.isNaN(parsed) ? 0xf5c542 : parsed,
  };
}

const game = gameStore.game;
const hasGame = gameStore.hasGame;
const presentationCssVars = computed<Record<string, string>>(() => {
  void gameStore.isPlaying.value;
  return { '--p-classic-turnover': `${presentationMs(250)}ms` };
});
const CLASSIC_LOG_FONTS: Record<typeof settings.logFont, string> = {
  nuffle: 'Nuffle, Arial, sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
  mono: 'Consolas, "Courier New", monospace',
};
const classicLogTextStyle = computed(() => ({
  fontSize: `${settings.logFontSize}px`,
  fontFamily: CLASSIC_LOG_FONTS[settings.logFont],
}));
let unregisterApothecaryElection: (() => void) | null = null;

interface TeamLike { teamName?: string; coach?: string }
const home = computed(() => (game.value?.teamHome ?? {}) as TeamLike);
const away = computed(() => (game.value?.teamAway ?? {}) as TeamLike);

// --- Team crest resolver (FC2 team-banner backdrops) — a compact port of
// SpectateView's `fumbblAsset`/`teamLogo` so this VIEW fork stays self-contained
// (the plan treats ClassicView as a separate presentation, not a shared-helper
// consumer). Standalone servers send no logoUrl → a neutral gold crest fills the
// slot so the banner never collapses.
function fumbblAsset(rel?: string, base?: string): string | null {
  return selectedLocalFumbblAssetUrl(rel, base);
}
const GENERIC_TEAM_LOGO =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#4a5568"/><stop offset="1" stop-color="#232a36"/></linearGradient></defs>' +
      '<path d="M30 3 L54 11 V31 C54 44 44 53 30 58 C16 53 6 44 6 31 V11 Z" fill="url(#g)" stroke="#f5c542" stroke-width="2"/>' +
      '<path d="M30 17 l3.7 8.2 8.9 0.8 -6.7 5.9 2 8.8 -7.9 -4.7 -7.9 4.7 2 -8.8 -6.7 -5.9 8.9 -0.8 Z" fill="#f5c542" opacity="0.92"/>' +
      '</svg>',
  );
function teamLogo(team: unknown): string {
  const t = team as { roster?: { logoUrl?: string; baseIconPath?: string } } | undefined;
  return fumbblAsset(t?.roster?.logoUrl, t?.roster?.baseIconPath) ?? GENERIC_TEAM_LOGO;
}
const homeLogo = computed(() => teamLogo(game.value?.teamHome));
const awayLogo = computed(() => teamLogo(game.value?.teamAway));

// FC2 resource icons (re-roll tokens + apothecary red cross); the same bundled
// resource art SpectateView uses. The money bag is an emoji glyph (no bundled art).
function resourceIcon(name: string): string { return new URL(`../assets/resources/${name}.png`, import.meta.url).href; }
const rerollIcon = resourceIcon('re_roll');
const apoIcon = resourceIcon('apothecary');
function goldLabel(gp: number): string { return gp >= 1000 ? `${Math.round(gp / 1000)}k` : String(gp); }

// Whose turn it is (drives each sidebar's "Playing…" status button), plus the
// acting player's name for the sub-line.
const homePlaying = computed(() => !!(game.value as { homePlaying?: boolean } | null)?.homePlaying);
const actingName = computed(() => {
  const g = game.value as { actingPlayer?: { playerId?: string | null }; teamHome?: TeamLoose; teamAway?: TeamLoose } | null;
  const pid = g?.actingPlayer?.playerId;
  if (!pid) return null;
  for (const t of [g?.teamHome, g?.teamAway]) {
    const p = (t?.playerArray ?? []).find((q) => q.playerId === pid);
    if (p) return `#${p.playerNr} ${p.playerName}`;
  }
  return null;
});

const score = computed(() => {
  const r = (game.value as { gameResult?: { teamResultHome?: { score?: number }; teamResultAway?: { score?: number } } } | null)?.gameResult;
  return { home: r?.teamResultHome?.score ?? 0, away: r?.teamResultAway?.score ?? 0 };
});

const turn = computed(() => {
  const g = game.value as { half?: number; turnDataHome?: { turnNr?: number }; turnDataAway?: { turnNr?: number } } | null;
  const nr = Math.max(g?.turnDataHome?.turnNr ?? 0, g?.turnDataAway?.turnNr ?? 0);
  return { half: g?.half ?? 0, nr };
});

// Square mode stacks Log (top) + Scoreboard (middle) + Chat (bottom) on the right.
const logTail = computed(() => visibleMatchLogEntries(gameStore.state.log, settings.showServerSequencingEvents).slice(-40));
const chatTail = computed(() => gameStore.state.log.filter((e) => e.kind === 'talk').slice(-40));
const halfLabel = computed(() => {
  const h = turn.value.half;
  return h === 1 ? '1st half' : h === 2 ? '2nd half' : h > 2 ? 'overtime' : 'pre-game';
});
const spectators = computed(() => {
  const n = (gameStore.game.value as { spectators?: number } | null)?.spectators;
  return typeof n === 'number' ? n : null;
});

/** Per-side sidebar stats (FC2). Reserves = players in the RESERVE state; Out =
 *  players who left the pitch injured (KO / Badly Hurt / Serious / RIP) — the
 *  "all players who suffered a casualty" bucket. Re-rolls + inducements come from
 *  that team's turnData. Best-effort reads; the itemised panels land later. */
function teamStats(isHome: boolean) {
  const g = game.value as {
    teamHome?: { playerArray?: { playerId: string }[]; treasury?: number; reRolls?: number };
    teamAway?: { playerArray?: { playerId: string }[]; treasury?: number; reRolls?: number };
    turnDataHome?: { reRolls?: number; apothecaries?: number; turnStarted?: boolean; inducementSet?: { inducementArray?: unknown[] } };
    turnDataAway?: { reRolls?: number; apothecaries?: number; turnStarted?: boolean; inducementSet?: { inducementArray?: unknown[] } };
    fieldModel?: { playerDataArray?: { playerId: string; playerState: number }[] };
  } | null;
  if (!g) return { rsv: 0, out: 0, rerolls: 0, rerollTotal: 0, apo: 0, gold: 0, inducements: '—', inducementCount: 0 };
  const team = isHome ? g.teamHome : g.teamAway;
  const td = isHome ? g.turnDataHome : g.turnDataAway;
  const ids = new Set((team?.playerArray ?? []).map((p) => p.playerId));
  let rsv = 0;
  let out = 0;
  for (const d of g.fieldModel?.playerDataArray ?? []) {
    if (!ids.has(d.playerId)) continue;
    const base = d.playerState & 0xff;
    if (base === 0x09) rsv++; // RESERVE
    else if (base === 0x05 || base === 0x06 || base === 0x07 || base === 0x08 || base === 0x0d) out++; // KO / BH / SI / RIP / Banned
  }
  const indArr = td?.inducementSet?.inducementArray;
  const inducementCount = Array.isArray(indArr) ? indArr.length : 0;
  const inducements = inducementCount ? String(inducementCount) : '—';
  // Re-roll tokens: the team's TOTAL re-rolls are the token slots; turnData tracks
  // how many remain this half (used ones dim). Before the turn starts (and in the
  // demo, which leaves turnData.reRolls at 0), show them all as available.
  const rerollTotal = Number(team?.reRolls ?? 0);
  const rerolls = td?.turnStarted ? Number(td?.reRolls ?? 0) : rerollTotal;
  return {
    rsv,
    out,
    rerolls,
    rerollTotal,
    apo: Number(td?.apothecaries ?? 0),
    gold: Number(team?.treasury ?? 0),
    inducements,
    inducementCount,
  };
}
const homeStats = computed(() => teamStats(true));
const awayStats = computed(() => teamStats(false));

// --- Box views (owner 2026-07-08): the Reserves / Out buttons swap the Box panel
// to a dugout-style list of that team's off-pitch players, like our on-pitch
// dugout — Reserves, or the Out bucket (KO + casualties, each row tagged with the
// injury). 'detail' = the default player-detail placeholder.
type BoxView = 'detail' | 'reserves' | 'out';
const boxViewHome = ref<BoxView>('detail');
const boxViewAway = ref<BoxView>('detail');
function toggleBox(side: 'home' | 'away', view: 'reserves' | 'out') {
  const r = side === 'home' ? boxViewHome : boxViewAway;
  r.value = r.value === view ? 'detail' : view;
}
interface BoxPlayer { id: string; nr: number | null; name: string; pos: string; state: number }
interface BoxSection { key: string; header: string; players: BoxPlayer[] }
// One bounded projection serves every Classic portrait surface. The renderer game
// is published only after setGame(), preventing a reactive DOM render from caching
// a new-frame key against the previous renderer frame.
const portraitProjection = new ClassicPortraitProjection();
const portraitGame = shallowRef<GameJson | null>(null);
const portraitSurfaceRevision = ref(0);
let portraitMarkings = new Map<string, string>();
function classicPortrait(id: string): string | null {
  void portraitSurfaceRevision.value;
  const g = portraitGame.value;
  if (!g || !renderer) return null;
  const visualRevision = classicPortraitVisualRevision(g, id, {
    marking: portraitMarkings.get(id),
    showPlayerNumbers: settings.showPlayerNumbers,
  });
  if (!visualRevision) return null;
  return portraitProjection.resolve({
    gameId: g.gameId,
    playerId: id,
    visualRevision,
    assetPackRevision: assetMods.revision,
  }, () => renderer?.playerPortrait(id) ?? null);
}
function boxPortrait(id: string, _state: number): string | null {
  return classicPortrait(id);
}
/** FUMBBL's Out-box injury sections, in order — headers match the classic client
 *  ("Knocked Out / Badly Hurt / Seriously Injured / Killed / Banned"); all are
 *  shown even when empty, exactly like the dugout. */
const OUT_SECTIONS: { key: string; header: string; base: number }[] = [
  { key: 'ko', header: 'Knocked Out', base: 0x05 },
  { key: 'bh', header: 'Badly Hurt', base: 0x06 },
  { key: 'si', header: 'Seriously Injured', base: 0x07 },
  { key: 'rip', header: 'Killed', base: 0x08 },
  { key: 'ban', header: 'Banned', base: 0x0d },
];
function boxSections(isHome: boolean, view: 'reserves' | 'out'): BoxSection[] {
  const g = game.value as {
    teamHome?: { playerArray?: unknown[]; roster?: unknown };
    teamAway?: { playerArray?: unknown[]; roster?: unknown };
    fieldModel?: { playerDataArray?: { playerId: string; playerState: number }[] };
  } | null;
  if (!g) return [];
  const team = isHome ? g.teamHome : g.teamAway;
  const states = new Map((g.fieldModel?.playerDataArray ?? []).map((d) => [d.playerId, d.playerState]));
  const positionArray = (team?.roster as { positionArray?: { positionId: string; positionName?: string }[] } | undefined)?.positionArray ?? [];
  const byBase = new Map<number, BoxPlayer[]>();
  for (const raw of (team?.playerArray ?? []) as { playerId: string; playerNr?: number; playerName?: string; positionId?: string; positionName?: string }[]) {
    const st = states.get(raw.playerId);
    if (st == null) continue;
    const base = st & 0xff;
    const pos = raw.positionName ?? positionArray.find((q) => q.positionId === raw.positionId)?.positionName ?? '';
    const p: BoxPlayer = { id: raw.playerId, nr: raw.playerNr ?? null, name: raw.playerName ?? 'Player', pos, state: st };
    const arr = byBase.get(base);
    if (arr) arr.push(p);
    else byBase.set(base, [p]);
  }
  if (view === 'reserves') {
    return [{ key: 'rsv', header: 'Reserves', players: [...(byBase.get(0x09) ?? []), ...(byBase.get(0x0a) ?? [])] }];
  }
  return OUT_SECTIONS.map((s) => ({ key: s.key, header: s.header, players: byBase.get(s.base) ?? [] }));
}
const homeBoxSections = computed(() => (boxViewHome.value === 'detail' ? [] : boxSections(true, boxViewHome.value)));
const awayBoxSections = computed(() => (boxViewAway.value === 'detail' ? [] : boxSections(false, boxViewAway.value)));

// --- Player-detail card (owner 2026-07-08) — the annotated top-of-sidebar card:
// Name, Type/Pos #, Stats, Level (SPP + title), Skills (GREEN = added). Shown on
// the sidebar of the SELECTED player's team (click a player); falls back to the
// active player. Shared by the square + landscape layouts.
const selectedPlayerId = ref<string | null>(null);
// Owner 2026-07-08: the FUMBBL portrait/webcard — the player's rendered icon as an
// image (renderer.playerPortrait extracts the token to a data-URL), shown in the
// detail card. Recomputed when the selection / active player / frame changes.
const selectedPortrait = ref<string | null>(null);
function sppTitle(spp: number): string {
  if (spp >= 176) return 'Legend';
  if (spp >= 76) return 'Super Star';
  if (spp >= 51) return 'Star';
  if (spp >= 31) return 'Emerging Star';
  if (spp >= 16) return 'Veteran';
  if (spp >= 6) return 'Experienced';
  return 'Rookie';
}
interface DetailCard {
  name: string; nr: number; positionName: string; typeLine: string; side: 'home' | 'away';
  stats: { label: string; value: string }[]; skills: { name: string; label: string; added: boolean }[]; spp: number;
}
type TeamLoose = {
  race?: string;
  roster?: { positionArray?: { positionId: string; positionName?: string; skillArray?: string[] }[] };
  playerArray?: { playerId: string; playerNr: number; playerName: string; positionId: string; playerType?: string; movement: number; strength: number; agility: number; passing: number; armour: number; skillArray?: string[] }[];
};
function cardFor(isHome: boolean): DetailCard | null {
  const g = game.value as {
    teamHome?: TeamLoose; teamAway?: TeamLoose;
    actingPlayer?: { playerId?: string | null };
    gameResult?: { teamResultHome?: { playerResults?: { playerId: string; currentSpps?: number }[] }; teamResultAway?: { playerResults?: { playerId: string; currentSpps?: number }[] } };
  } | null;
  if (!g) return null;
  const pid = selectedPlayerId.value ?? g.actingPlayer?.playerId ?? null;
  if (!pid) return null;
  const team = isHome ? g.teamHome : g.teamAway;
  const player = (team?.playerArray ?? []).find((p) => p.playerId === pid);
  if (!player) return null; // the selected player is on the other side
  const posEntry = (team?.roster?.positionArray ?? []).find((p) => p.positionId === player.positionId);
  const rawPos = posEntry?.positionName ?? player.positionId.split('.').pop() ?? '';
  const race = (team?.race ?? '').trim();
  const baseSkills = new Set(posEntry?.skillArray ?? []);
  const results = (isHome ? g.gameResult?.teamResultHome : g.gameResult?.teamResultAway)?.playerResults ?? [];
  const spp = Number(results.find((r) => r.playerId === pid)?.currentSpps ?? 0);
  return {
    name: player.playerName,
    nr: player.playerNr,
    positionName: race ? `${race} ${rawPos}` : rawPos,
    typeLine: [race, player.playerType].filter(Boolean).join(', '),
    side: isHome ? 'home' : 'away',
    // EFFECTIVE MA/AV (Player.get*WithModifiers, Player.java:229-243) — prayer/card stat modifiers project
    // onto the card without ever mutating the base roster stat.
    stats: [
      { label: 'MA', value: String(effectiveMovement(player as unknown as PlayerJson)) },
      { label: 'ST', value: String(player.strength) },
      { label: 'AG', value: `${player.agility}+` },
      { label: 'PA', value: player.passing ? `${player.passing}+` : '–' },
      { label: 'AV', value: `${effectiveArmour(player as unknown as PlayerJson)}+` },
    ],
    // Shared with Modern: base + temporary skills, including valued Hatred keywords.
    skills: playerDetailSkills(player as unknown as PlayerJson, baseSkills),
    spp,
  };
}
const detailCardHome = computed(() => cardFor(true));
const detailCardAway = computed(() => cardFor(false));

function syncSelectedPortrait(): void {
  const g = portraitGame.value;
  const pid = selectedPlayerId.value ?? g?.actingPlayer?.playerId ?? null;
  selectedPortrait.value = pid ? classicPortrait(pid) : null;
}

watchAssetModRendererRefresh(() => {
  portraitProjection.clear();
  portraitSurfaceRevision.value++;
  renderer?.refreshSkillIconAssets();
  syncSelectedPortrait();
});

// --- FC1: the classic pitch --------------------------------------------------
const pitchHost = ref<HTMLDivElement | null>(null);
const classicView = ref<HTMLDivElement | null>(null);
let renderer: PitchRenderer | null = null;
const blitzTargetMarker = ref<{ x: number; y: number } | null>(null);
let blitzTargetRaf = 0;
function trackBlitzTarget(): void {
  cancelAnimationFrame(blitzTargetRaf);
  const step = () => {
    blitzTargetRaf = 0;
    const targetId = gameStore.state.blitzTokens?.targetId;
    const square = targetId ? playerSquare(targetId) : null;
    const pos = square && renderer ? renderer.tokenBodyCenterToCanvas(square) : null;
    blitzTargetMarker.value = pos ? { x: pos.x, y: pos.y } : null;
    if (targetId && renderer) blitzTargetRaf = requestAnimationFrame(step);
  };
  step();
}
watch(() => gameStore.state.blitzTokens?.seq, trackBlitzTarget);
let rendererMountActive = false;

/** Root-relative token coordinate for the shared Watch Out! toast. Classic deliberately
 * disables renderer dugouts, so an off-pitch player follows its currently visible Box tile;
 * an unopened Box has no invented anchor and fails soft until the tile is rendered. */
function classicWatchOutPlayerScreenPos(playerId: string): { x: number; y: number } | null {
  const root = classicView.value;
  if (!root) return null;
  const data = game.value?.fieldModel.playerDataArray.find((entry) => entry.playerId === playerId);
  const onPitch = isOnPitch(data?.playerCoordinate ?? null);
  return classicTokenToastScreenPosition({
    root,
    pitch: pitchHost.value,
    playerId,
    onPitch,
    canvasPosition: onPitch ? renderer?.playerScreenPos(playerId) : null,
  });
}
watch(
  () => gameStore.isPlaying.value,
  (playing) => renderer?.setPresentationMode(playing ? 'live' : 'spectator'),
);
watch(() => settings.useFantasyCursor, (enabled) => renderer?.setFantasyCursorEnabled(enabled));
let stopGameWatch: WatchStopHandle | null = null;
let stopLayoutWatch: WatchStopHandle | null = null;
let stopMarkingsWatch: WatchStopHandle | null = null;
let stopVideoOptionsWatch: WatchStopHandle | null = null;
let lastGameId: number | null = null;
// KICK-SQUARE ELECTION (Pellaeon 2026-08-12, re-authored from d50467b6 post kick-package merge). Classic
// installs the election capability EXPLICITLY against the shared controller — it never installs the Modern
// reroll interaction gate, which would silently auto-decline before a Classic coach could choose. Same
// candidate semantics / icon-K fallback / coincident split / off-pitch boundary markers as the Modern surface.
let unregisterKickElection: (() => void) | null = null;
let kickElectionRaf = 0;
const kickElectionIconFailed = ref(false);
const kickElectionIconUrl = skillIconUrl('Kick', 'bb3');
const kickElectionTargets = ref<Array<{
  key: string; choice: 'normal' | 'kick'; raw: [number, number]; x: number; y: number;
  onPitch: boolean; iconOnly: boolean; stackIndex: 0 | 1; label: string;
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
    const election = gameStore.kickElectionProjection('classic');
    const host = pitchHost.value;
    if (!election || !renderer || !host) { stopKickElectionTracking(); return; }
    kickElectionTargets.value = election.candidates.map((candidate) => {
      const pos = renderer!.squareToCanvas(candidate.anchor) ?? { x: host.clientWidth / 2, y: host.clientHeight / 2 };
      const iconOnly = candidate.primaryHitArea === 'icon';
      const stackDirection = pos.y > host.clientHeight / 2 ? -1 : 1;
      const stackOffset = candidate.stackIndex * (candidate.onPitch ? 0 : 28 * stackDirection);
      const marginX = candidate.onPitch ? 20 : 40;
      return {
        key: election.key, choice: candidate.choice, raw: candidate.raw,
        x: Math.min(Math.max(pos.x + (iconOnly ? 10 : 0), marginX), Math.max(host.clientWidth - marginX, marginX)),
        y: Math.min(Math.max(pos.y + stackOffset - (iconOnly ? 10 : 0), 20), Math.max(host.clientHeight - 20, 20)),
        onPitch: candidate.onPitch, iconOnly, stackIndex: candidate.stackIndex, label: candidate.label,
      };
    });
    kickElectionRaf = requestAnimationFrame(step);
  };
  step();
}

function chooseKickElection(target: (typeof kickElectionTargets.value)[number]): void {
  gameStore.resolveKickElection(target.key, target.choice, 'classic');
}

// Selection changes project immediately. Game-frame changes are projected only
// after renderer.setGame() in the mounted watcher below.
watch(
  selectedPlayerId,
  syncSelectedPortrait,
  { flush: 'post' },
);

// Keep the renderer's eligible-player crosshairs in sync with the active pick. Furious Outburst stages its
// confirm-mode victim locally: once selected, suppress the candidate crosshairs and show one arrow until
// right-click removes that selection.
watch(
  () => [gameStore.state.playerPick?.seq ?? 0, gameStore.state.playerPick?.picked.join('|') ?? '', gameStore.state.highKickPhase?.nomineeIds ?? null, gameStore.state.wizardTargetConfirm?.seq ?? 0] as const,
  () => {
    const pick = gameStore.state.playerPick;
    const ids = pick?.eligibleIds ?? null;
    const highKickIds = gameStore.state.highKickPhase?.nomineeIds ?? null;
    if (ids?.length) renderer?.setPlayerPick(ids);
    else renderer?.setPlayerPick(highKickIds?.length ? highKickIds : null);
    const furiousSelected = !!pick?.key.startsWith('pchoice:furiousOutburst:') && pick.picked.length > 0;
    renderer?.setPlayerPickShaded(furiousSelected);
    renderer?.setPlayerPickIneligible(null);
    renderer?.setPlayerPickArrows(furiousSelected ? pick!.picked : null);
    renderer?.setPlayerPickSelected(furiousSelected ? pick!.picked[0] ?? null : gameStore.state.wizardTargetConfirm?.playerId ?? null);
  },
  { flush: 'post' },
);

watch(
  () => gameStore.state.dodgySnackPlayers,
  (ids) => renderer?.setDodgySnackPlayers(ids ?? []),
  { flush: 'post', deep: true },
);

// Setup phase: shade the LOS/wide zones + route pitch taps through onSetupClick
// (select a placed player, or place the selected reserve on an own-half square).
// The explicit mount call also covers Classic mode switches/reconnects where the setup seq is already stable.
function syncClassicSetup(): void {
  if (!renderer) return;
  const sp = gameStore.state.setupPhase;
  if (!sp) {
    renderer.setSetup(false, null);
    renderer.onSetupClick = null;
    selectedSetupPlayerId.value = null;
    return;
  }
  const v = sp.validation;
  renderer.setSetup(true, { losOk: v.losOk, leftOk: v.leftOk, rightOk: v.rightOk });
  renderer.onSetupClick = (coord, playerId) => {
    // An inert player (Solid Defence non-selected / Dwarfen Wisdom non-placeable) is not selectable.
    if (playerId) { if (setupPlayerIsMovable(playerId)) selectedSetupPlayerId.value = playerId; return; }
    const pid = selectedSetupPlayerId.value;
    if (pid && coord[0] >= 0 && coord[0] <= 12 && coord[1] >= 0 && coord[1] <= 14) {
      gameStore.setupPlace(pid, coord);
      selectedSetupPlayerId.value = null;
    }
  };
  if (selectedSetupPlayerId.value
      && !sp.players.some((p) => p.playerId === selectedSetupPlayerId.value && p.inert !== true)) {
    selectedSetupPlayerId.value = null;
  }
}
watch(() => gameStore.state.setupPhase?.seq, syncClassicSetup, { flush: 'post' });

// --- Layout (FC-D2, owner 2026-07-08): pick the arrangement by WINDOW ASPECT.
// LANDSCAPE (§3b) = sidebars L/R + EW pitch + bottom scoreboard strip + bottom
// Log/Chat. SQUARE (§3c) = sidebars L/R + NS pitch + a far-right Log/Score/Chat
// column. The 4-name enum is tracked for the future portrait/wide bespoke specs;
// today wide maps to the landscape arrangement and portrait to the square one.
const viewportAspect = ref(1);
function measureAspect(): void {
  viewportAspect.value = window.innerWidth / Math.max(1, window.innerHeight);
}
const layoutName = computed<'wide' | 'landscape' | 'square' | 'portrait'>(() => {
  const a = viewportAspect.value;
  if (a >= 1.75) return 'wide';
  if (a >= 1.2) return 'landscape';
  if (a >= 0.8) return 'square';
  return 'portrait';
});
/** The arrangement actually rendered: landscape for wide|landscape, square else. */
const layout = computed<'landscape' | 'square'>(() =>
  layoutName.value === 'wide' || layoutName.value === 'landscape' ? 'landscape' : 'square',
);
/** Pitch orientation is FORCED by the NS/EW setting (owner 08-19) — never swaps with
 *  the viewport. The grid `layout` (sidebar arrangement) still adapts to aspect; only the
 *  pitch DIRECTION is pinned to settings.pitchOrientation. */
const pitchOrientation = computed<'ew' | 'ns'>(() => settings.pitchOrientation);

/** Apply the FUMBBL-Classic renderer preset (see file header / FC-D decisions). */
function applyClassicPreset(r: PitchRenderer): void {
  const turfs = r.turfOptions();
  const classicTurf = ['fumbbl-basic', 'fumbbl-default'].find((t) => turfs.includes(t)) ?? turfs[0] ?? 'grass1';
  r.setTurf(classicTurf); // FUMBBL pitch image underlay
  r.setSpriteSet('classic'); // classic iconsets
  r.setOneSpritePerPosition(settings.oneSpritePerPosition);
  r.setFlatMode(true); // flat 2D uniform grid
  r.decorEnabled = false; // no broadcast cameras / stadium props / corner flags
  r.dugoutsEnabled = false; // classic sidebars carry the box — no on-pitch dugouts
  r.turnTrackEnabled = false; // classic sidebars carry score/turn/re-rolls — no SW on-pitch turn track (explicit, not just via the dugoutsEnabled gate)
  r.autoDirector = false; // static classic camera
  r.showPositionRings = false; // classic has no position rings
  // Owner 2026-07-08: FUMBBL Classic defaults to SKILL MARKERS (text glyphs over
  // players), not skill icons — the markings themselves are applied per-frame below.
  r.showSkillIcons = false;
  r.setPlayerIconSkills(null);
  r.showPlayerNumbers = settings.showPlayerNumbers;
  r.setFieldMarkers({ rowMarkers: false, sweetSpot: false, fieldLogos: false, rowNumberRails: true });
  r.setGridOptions({ show: true, widthMul: 1, color: 0xe8e4d8 }); // classic yard grid
  r.setTackleZoneMode(settings.tackleZoneMode);
  r.setVideoOptions({ renderScale: settings.renderScale, fpsCap: settings.fpsCap });
  r.setFantasyCursorEnabled(settings.useFantasyCursor);
  r.setBrightness(100);
  r.setSkillMarkingStyle(classicSkillMarkingStyle());
  // Orientation follows the layout: NS (vertical) for square, EW (horizontal) for
  // landscape. Pan/zoom stay bound to the pitch edge (no zoom-out past fit).
  r.setPitchOrientation(pitchOrientation.value);
  r.clampToPitch = true;
  r.clampToPitchEdge = true; // owner 2026-07-08: bind pan/zoom to the pitch edge (no dugout margin)
}
watch(
  () => [settings.skillMarkingColor, settings.skillMarkingFont, settings.skillMarkingSize] as const,
  () => renderer?.setSkillMarkingStyle(classicSkillMarkingStyle()),
);
watch(() => settings.oneSpritePerPosition, (enabled) => renderer?.setOneSpritePerPosition(enabled));
watch(() => settings.d6FaceVariant, (variant) => renderer?.setD6FaceVariant(variant));

/** FUMBBL Classic skill MARKERS — recompute the marker-glyph map for the current
 *  game and push it to the renderer (skill icons are off in classic). */
function applyClassicMarkings(g: unknown): void {
  if (!renderer) return;
  // Three-tier fallback mirroring SpectateView (per-skill → FUMBBL JSON → none); every tier
  // ALSO refreshes `portraitMarkings` — the portrait projection (fba5b21e) reads that cache.
  if (!g) {
    portraitMarkings = new Map();
    renderer.setPlayerMarkings(portraitMarkings);
    return;
  }
  const game = g as Parameters<typeof computeConfigMarkings>[0];
  // Tier 1 — the per-skill MARKER config, if the user opted a skill in.
  if (anyMarkerConfigured()) {
    portraitMarkings = computeConfigMarkings(game);
    renderer.setPlayerMarkings(portraitMarkings);
    return;
  }
  // Tier 2 — the FUMBBL auto-marking JSON. This IS the upstream FUMBBL client's own
  // auto-markings feature; Classic ignoring it was a FUMBBL-parity gap + a silent
  // regression vs SpectateView (Yularen-ruled 2026-07-22).
  const raw = settings.markingsConfig.trim();
  if (!raw) {
    portraitMarkings = new Map();
    renderer.setPlayerMarkings(portraitMarkings);
    return;
  }
  try {
    const config = JSON.parse(raw) as AutoMarkingConfig;
    portraitMarkings = generateAllMarkings(game, config);
    renderer.setPlayerMarkings(portraitMarkings);
  } catch (err) {
    // Surface WHY (malformed JSON / bad record) rather than silently blanking markings.
    console.warn('[markings] classic: failed to generate from markingsConfig — markings off:', err);
    portraitMarkings = new Map();
    renderer.setPlayerMarkings(portraitMarkings);
  }
}

onMounted(async () => {
  rendererMountActive = true;
  // Spectators still need the read-only reroll/skill surfaces; ownership checks prevent answers.
  gameStore.setInteractiveReRolls(true);
  gameStore.setInteractiveSetup(props.mode === 'play');
  // Dedicated opt-in: Classic never installs the Modern reroll gate.
  unregisterKickElection = gameStore.registerKickElectionSurface('classic');
  unregisterApothecaryElection = gameStore.registerApothecaryElectionSurface('classic');
  measureAspect();
  window.addEventListener('resize', measureAspect);
  if (!pitchHost.value) return;
  const mountedRenderer = new PitchRenderer();
  renderer = mountedRenderer;
  mountedRenderer.setD6FaceVariant(settings.d6FaceVariant);
  mountedRenderer.setPresentationMode(gameStore.isPlaying.value ? 'live' : 'spectator');
  if (!await initPitchRendererMount(
    mountedRenderer,
    pitchHost.value,
    () => rendererMountActive && renderer === mountedRenderer,
  )) return;
  applyClassicPreset(renderer);
  renderer.setDodgySnackPlayers(gameStore.state.dodgySnackPlayers ?? []);
  const activePickIds = gameStore.state.playerPick?.eligibleIds;
  const activeHighKickIds = gameStore.state.highKickPhase?.nomineeIds;
  renderer.setPlayerPick(activePickIds?.length ? activePickIds : activeHighKickIds?.length ? activeHighKickIds : null);
  const activeFurious = !!gameStore.state.playerPick?.key.startsWith('pchoice:furiousOutburst:')
    && gameStore.state.playerPick.picked.length > 0;
  renderer.setPlayerPickShaded(activeFurious);
  renderer.setPlayerPickArrows(activeFurious ? gameStore.state.playerPick!.picked : null);
  renderer.setPlayerPickSelected(activeFurious
    ? gameStore.state.playerPick!.picked[0] ?? null
    : gameStore.state.wizardTargetConfirm?.playerId ?? null);
  // A mode switch/reconnect may mount Classic after the server-owned square election was already armed.
  // Rehydrate its exact candidate set, except while a locally staged Zap nominee owns the single arrow.
  const activeSquarePick = gameStore.state.squarePick;
  const activeZapNominee = !!gameStore.state.wizardTargetConfirm
    && activeSquarePick?.kind === 'wizard' && activeSquarePick.skill === 'Zap';
  if (activeSquarePick?.squares.length && !activeZapNominee) {
    renderer.setTilePick(true, activeSquarePick.squares);
  }
  syncClassicSetup();
  stopVideoOptionsWatch = watchClassicVideoOptions(
    () => ({ renderScale: settings.renderScale, fpsCap: settings.fpsCap }),
    (options) => renderer?.setVideoOptions(options),
  );
  renderer.onPortraitVisualRevision = () => {
    portraitProjection.clear();
    portraitSurfaceRevision.value++;
    syncSelectedPortrait();
  };
  renderer.onAnimDone = gameStore.onAnimDone;
  // A view can mount while an interception decision is already live; seed the preflight hold that the watcher
  // could not deliver before Pixi existed.
  renderer.setPassBallHold(gameStore.state.passBallHold?.square ?? null);
  renderer.setPassDestinationMarker(
    gameStore.state.passDestination?.square ?? null,
    gameStore.state.passDestination?.kind ?? 'ball',
  );
  trackBlitzTarget();
  // Re-orient the pitch when the NS/EW setting changes (owner 08-19: setting-forced, not viewport).
  stopLayoutWatch = watch(pitchOrientation, (o) => {
    if (!renderer) return;
    renderer.setPitchOrientation(o);
    renderer.resize();
    requestAnimationFrame(() => renderer?.resetCamera());
  });
  // Clicking a player surfaces their detail card on their team's sidebar.
  renderer.onPlayerClick = (id: string, clickX = 0, clickY = 0) => {
    selectedPlayerId.value = id; // detail card (unchanged)
    // The kickoff mini-turns own the click while they are live — they fire regardless of the normal
    // activation gate below (High Kick nomination / Quick Snap selection are kickoff-event states).
    if (nominateHighKick(id)) return;
    if (selectQuickSnapPlayer(id)) return;
    if (!settings.order66 || !gameStore.isPlaying.value) return;
    const g = game.value;
    if (!g) return;
    const gazeActing = o66ActingId.value;
    if (isGazeMovementState(o66State.value) && gazeActing && gameStore.iControl(gazeActing)) {
      const gazeClick = gazeTargetClick(gameStore.state.gazeIntent, classicPendingGaze.value, id);
      if (gazeClick === 'confirmDeclared') { confirmClassicGaze(); return; }
      if (gazeClick === 'confirmCandidate' && gameStore.hasGazeTargetDeclaration()) {
        confirmClassicGazeDeclaration();
        return;
      }
      if (gazeClick === 'nominate' && gameStore.hasGazeTargetDeclaration() && gameStore.nominateGazeTarget(id)) {
        classicPendingGaze.value = id;
        return;
      }
    }
    if (gameStore.requestKickEmBlitzBlock(id)) return;
    // G1c (FUMBBL-client ACT-ON-TARGET): after a declare (via the G1b context menu), a click on the TARGET
    // executes the action through the shared server-derived interaction rail — `o66PlayerClick` returns the
    // Interaction descriptor, dispatched via the EXISTING senders (upstream-wire-compliant, no new wire). This
    // takes precedence over the G1a MOVE-activation fallback below. ⚠ RIG-VERIFY OWED.
    const ix = o66PlayerClick(g, o66Ctx(), id, (pid: string) => gameStore.iControl(pid));
    const atk = o66ActingId.value;
    // Never let a self left-click become a Blitz terminator. The context-menu End Activation path remains available
    // and owns the explicit confirmation card.
    if (id === atk && requiresBlitzEndConfirmation(o66State.value)) return;
    if (ix.kind === 'switchFriendlyActivation') {
      if (requiresBlitzEndConfirmation(o66State.value)) { classicRequestEndActivation(); return; }
      if (settings.leftClickOpensContextMenu) {
        pendingClassicFriendlyMenu.value = { playerId: ix.playerId, x: clickX, y: clickY };
        gameStore.endActivation();
      } else {
        pendingClassicFriendlyMenu.value = null;
        gameStore.switchFriendlyActivation(ix.playerId, ix.disposition);
      }
      return;
    }
    if (ix.kind === 'swoopCoordinate' && atk) { gameStore.sendSwoop(atk, ix.square); return; }
    if (ix.kind === 'targetSelected') {
      gameStore.sendTargetSelected(ix.defenderId);
      return;
    }
    if (ix.kind === 'kickEmBlock') { gameStore.sendKickEmBlock(ix.defenderId); return; }
    if (ix.kind === 'blastinTarget') { gameStore.sendBlastinTarget(ix.targetId); return; }
    if (ix.kind === 'endMove') { classicRequestEndActivation(); return; } // N-01: confirm-gated (blitz/punt/gaze)
    if (ix.kind === 'block' && atk) {
      const attackState = deriveClientState(g, o66Ctx());
      if (attackState === 'BLOCK' || attackState === 'BLITZ') {
        const staged = classicAttackStage.value;
        if (!staged || staged.targetId !== ix.defenderId || staged.kind !== classicPendingBlockKind.value) {
          classicAttackStage.value = { targetId: ix.defenderId, kind: classicPendingBlockKind.value };
          if (classicPendingBlockKind.value == null) renderer?.showBlockTargets(atk, ix.defenderId);
          else renderer?.showBlockTargets(null);
          return;
        }
        gameStore.sendBlock(atk, ix.defenderId, classicBlockFlags(staged.kind));
        classicAttackStage.value = null;
        classicPendingBlockKind.value = null;
        renderer?.showBlockTargets(null);
        return;
      }
      // Commit the block on the clicked enemy. The interaction router only returns `block` when the target is
      // ADJACENT (BLOCK + BLITZ states both gate on adjacentStandingEnemyIds), so a non-adjacent blitz WALKS to
      // contact first (onTilePick blitz-walk, G1c-2) and only reaches here once in contact — no adjacency
      // re-check needed (router is the single gate; the server also validates the clientBlock). sendBlock carries
      // the block flavor remembered at the G1b declare (stab/chainsaw/… → classicBlockFlags).
      // S5 (Gored by the Bull etc.): if the server armed a blitz-block attack CHOICE, HOLD it — the card
      // commits via commitBlitzBlock instead of sending now (iControl-guarded; empty offers ⇒ false ⇒ plain send).
      if (gameStore.tryHoldBlitzBlockChoice(atk, ix.defenderId)) { classicPendingBlockKind.value = null; return; }
      gameStore.sendBlock(atk, ix.defenderId, classicBlockFlags(classicPendingBlockKind.value));
      classicPendingBlockKind.value = null;
      return;
    }
    if (ix.kind === 'foulTarget') { gameStore.sendFoulTarget(ix.defenderId); return; }
    if (ix.kind === 'handOverTarget') { gameStore.sendHandOverTarget(ix.catcherId); return; }
    if (ix.kind === 'passTarget') { gameStore.sendPassTarget(ix.square); return; }
    if (ix.kind === 'openActionMenu' && settings.leftClickOpensContextMenu) {
      ctxMenu.value = { x: clickX, y: clickY, playerId: ix.playerId };
      return;
    }
    // Not an act-on-target → G1a activation: left-clicking YOUR player on YOUR turn declares the default MOVE
    // (server-guarded: iControlPlayer + the #23 sticky gate → an opponent click is a safe no-op).
    gameStore.declareAction(id, 'move');
  };
  // Player-pick: clicking an eligible (crosshaired) player answers the pick.
  renderer.onPlayerPick = (id: string) => {
    if (nominateHighKick(id)) return;
    gameStore.resolvePlayerPick(id);
  };
  // Replay a pending server-armed square-pick (rejoin straight into Trickster/etc. — mirrors SpectateView:4664).
  renderer.setTargetSelectPick(gameStore.state.squarePick?.squares ?? null, gameStore.state.squarePick?.skill);
  const pendingKickSkill = gameStore.state.kickSkill;
  renderer.setKickSkillCandidates(pendingKickSkill?.ballCoordinate ?? null, pendingKickSkill?.ballCoordinateWithKick ?? null);
  trackKickElection();
  // LIVE-PLAYTEST FIX (finding #3): unknown-call coordinate pick — a clicked tile
  // answers it (mirrors SpectateView's renderer.onTilePick wiring).
  renderer.onTilePick = (coord) => {
    const c = coord as [number, number];
    // CLASSIC ALIGNMENT (Pellaeon 2026-08-12): server-armed square-pick rail (Trickster / Raiding
    // Party / Dump-Off / Safe Pair of Hands) takes precedence over the unknown-call pick — mirrors
    // SpectateView:5078. resolveSquarePick dispatches per `kind` on existing wire (no new channel).
    // (Mutually exclusive with the Quick Snap kickoff mini-turn below — ordering among these is safe.)
    if (gameStore.state.squarePick) { renderer?.setTilePick(false); gameStore.resolveSquarePick(c); return; }
    // Quick Snap: a click on a highlighted destination moves the selected candidate one square.
    if (quickSnapMoveTo(c)) return;
    // Unknown-call coordinate pick takes precedence (finding #3) — a server-armed coordinate answer.
    if (unknownPickingTile.value) {
      renderer?.setTilePick(false);
      unknownPickingTile.value = false;
      gameStore.resolveUnknownCoordinate(c);
      return;
    }
    // FUMBBL-client AUTOMOVE / WALK-TO-CONTACT (immediate-send, NO planner): a click on the acting player's
    // server-derived reach WALKS there — adjacent = one step; farther = the whole o66AutoPath in ONE command
    // (the server validates + aborts each step). G1a proved this for MOVE (Voss game 549); G1c-2 extends the
    // SAME reach/path to the other walk states, switching only the SENDER family:
    //   • MOVE + the DELEGATE walk states FOUL/PASS/HAND_OVER/PUNT/GAZE → clientMove (stepMove / o66Move);
    //   • BLITZ → the DEDICATED clientBlitzMove (sendBlitzMove / o66BlitzMove) — the trailing clientBlock only
    //     dispatches while playerAction == blitzMove, so the walk must NOT ride clientMove. Once in contact a
    //     click on the enemy fires sendBlock via onPlayerClick (the router gates that on adjacency).
    // Reach/path use renderer.o66Reach/o66AutoPath (the client-derived reach the server-authoritative move
    // overlay backs) exactly as the live-verified G1a MOVE path — no behavior change for MOVE. ⚠ RIG-VERIFY OWED.
    // (Automove is default-on; a classic SETTING_AUTOMOVE single-step toggle is a settings.ts follow-up.)
    if (settings.order66 && gameStore.isPlaying.value) {
      const g = game.value;
      const actingId = o66ActingId.value;
      const st = o66State.value;
      if (g && st === 'SWOOP' && actingId) {
        const ix = o66SquareClick(g, o66Ctx(), c);
        if (ix.kind === 'swoopCoordinate') gameStore.sendSwoop(actingId, ix.square);
        return;
      }
      if (g && st === 'SELECT_BLITZ_TARGET' && actingId && !blitzUsedActingSide(g)
          && (renderer?.o66Reach(actingId)?.squares ?? []).some((s) => s[0] === c[0] && s[1] === c[1])) {
        blitzMoveModalTile.value = c;
        return;
      }
      if (g && st === 'PUNT' && isPuntTargeting(g)) {
        if (actingId && serverMoveSquares(g).some((s) => s[0] === c[0] && s[1] === c[1])) o66PendingPunt.value = c;
        return;
      }
      if (g && st === 'FURIOUS_OUTBURST' && actingId) {
        if (serverMoveSquares(g).some((s) => s[0] === c[0] && s[1] === c[1])) gameStore.sendFieldCoordinate(actingId, c);
        return;
      }
      const isBlitz = isBlitzMovementState(st);
      const isGazeWalk = isGazeMovementState(st) && gameStore.hasLiveGazeIntent();
      const isWalk = st === 'MOVE' || st === 'FOUL' || st === 'PASS' || st === 'HAND_OVER'
        || (st === 'PUNT' && !!g && !isPuntTargeting(g)) || isGazeWalk;
      if (g && actingId && (isBlitz || isWalk) && !movesRandomly(g, actingId)) {
        const inReach = (renderer?.o66Reach(actingId)?.squares ?? []).some((s) => s[0] === c[0] && s[1] === c[1]);
        if (inReach) {
          const from = (g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: [number, number] | null }[])
            .find((d) => d.playerId === actingId)?.playerCoordinate;
          const adjacent = !!from && Math.max(Math.abs(from[0] - c[0]), Math.abs(from[1] - c[1])) <= 1;
          const route = adjacent ? null : (renderer?.o66AutoPath(actingId, c) ?? null);
          if (isBlitz) {
            if (route && route.length > 0) gameStore.o66BlitzMove(actingId, route);
            else gameStore.sendBlitzMove(actingId, c);
          } else {
            if (route && route.length > 0) gameStore.o66Move(actingId, route);
            else gameStore.stepMove(actingId, c);
          }
        } else if (st === 'PASS') {
          // A click on OPEN GROUND that is NOT a walk square is the PASS throw target (the server validates
          // range + resolves scatter/interception) — the router's onSquareClick PASS-open-ground semantics.
          gameStore.sendPassTarget(c);
        }
      }
    }
  };
  // Swoop shares the visible Ball & Chain cardinal-arrow presentation, but keeps its own exact command family.
  renderer.onBncAim = (coord) => {
    const g = game.value;
    const actingId = o66ActingId.value;
    if (!g || !actingId || o66State.value !== 'SWOOP') return;
    gameStore.sendSwoop(actingId, coord as [number, number]);
  };
  // Right-click a standing opponent during Block/Blitz → attack choices; otherwise retain the dice utility.
  renderer.onContextMenu = (target, cx, cy) => {
    if (blitzMoveModalTile.value) { dismissBlitzMoveModal(); return; }
    const pick = gameStore.state.playerPick;
    if (pick?.key.startsWith('pchoice:furiousOutburst:') && pick.picked.length > 0) {
      gameStore.undoLastPlayerPick();
      ctxMenu.value = null;
      return;
    }
    if (!target.playerId || target.emptySquare || target.isDown) { ctxMenu.value = null; return; }
    ctxMenu.value = { x: cx, y: cy, playerId: target.playerId };
  };
  // Mount-after-scatter/reconnect: seed the already-live server occurrence before the first model render.
  const kickoffScatter = gameStore.state.kickScatterPreview;
  renderer.setServerKickoffScatter(kickoffScatter ? {
    commandNr: kickoffScatter.commandNr, endpoint: kickoffScatter.unreducedEndpoint, seq: kickoffScatter.seq,
  } : null);
  // Mode switches and replay/spectator mounts may begin after a successful Gaze report.
  // Publish that durable occurrence before the first token is built from the model.
  gazeVictimPresentation.publish();
  renderer.setGame(gameStore.game.value);
  if (game.value && o66State.value === 'PUNT' && isPuntTargeting(game.value)) syncO66MoveSquares(o66MoveSquares.value);
  syncPuntPreview();
  if (gameStore.state.kickDescend) renderer.setKickDescend(gameStore.state.kickDescend);
  // Sync the mount-time values the watchers only fire ON CHANGE (push planner off
  // for spectate/demo → chosen-push-only; seed the active/acted state).
  renderer.plannerEnabled = plannerAllowed.value;
  renderer.setActivePlayer(gameStore.state.activePlayerId);
  renderer.setActedPlayers(gameStore.state.actedPlayers ?? []);
  applyClassicMarkings(gameStore.game.value);
  portraitGame.value = gameStore.game.value;
  syncSelectedPortrait();
  requestAnimationFrame(() => renderer?.resetCamera());
  lastGameId = (gameStore.game.value as { gameId?: number } | null)?.gameId ?? null;
  // Push every applied frame to the renderer (the store REPLACES game.value per
  // frame). Camera stays static; the pre-kickoff presentation cines ARE wired below
  // (owner 2026-08-12, reversing the original FC-D3 no-cinematics call).
  stopGameWatch = watch(
    gameStore.game,
    (g) => {
      const gid = (g as { gameId?: number } | null)?.gameId ?? null;
      if (gid !== lastGameId) portraitProjection.clear();
      renderer?.setGame(g);
      applyClassicMarkings(g);
      portraitGame.value = g;
      syncSelectedPortrait();
      if (renderer && gid != null && gid !== lastGameId) requestAnimationFrame(() => renderer?.resetCamera());
      lastGameId = gid;
    },
    { flush: 'post' },
  );
  // Re-apply markings when the FUMBBL auto-marking JSON changes (matches SpectateView's
  // markingsConfig watcher) — otherwise a live config edit wouldn't reflect until the
  // next game frame.
  stopMarkingsWatch = watch(
    () => settings.markingsConfig,
    () => applyClassicMarkings(gameStore.game.value),
  );
  if (import.meta.env.DEV) (window as unknown as { __classicRenderer?: PitchRenderer }).__classicRenderer = renderer;
});

onBeforeUnmount(() => {
  rendererMountActive = false;
  gameStore.setInteractiveReRolls(false);
  gameStore.setInteractiveSetup(false);
  unregisterApothecaryElection?.();
  unregisterApothecaryElection = null;
  window.removeEventListener('resize', measureAspect);
  cancelAnimationFrame(blitzTargetRaf);
  stopKickElectionTracking();
  unregisterKickElection?.();
  unregisterKickElection = null;
  clearInterval(tumbleInterval);
  clearTimeout(tumbleStop);
  stopGameWatch?.();
  stopGameWatch = null;
  stopLayoutWatch?.();
  stopLayoutWatch = null;
  stopMarkingsWatch?.();
  stopMarkingsWatch = null;
  stopVideoOptionsWatch?.();
  stopVideoOptionsWatch = null;
  portraitProjection.clear();
  portraitGame.value = null;
  selectedPortrait.value = null;
  renderer?.destroy();
  renderer = null;
});

function backToDefault() {
  settings.uiMode = 'fumbbl40k';
}

// End Turn (owner 2026-07-08) — mirrors SpectateView: play mode sends the wire
// End Turn, demo advances play. Each sidebar's button is only live for the side
// whose turn it currently is (and only in play/demo — spectators can't end turns).
function endTurn() {
  if (gameStore.isPlaying.value) gameStore.playerEndTurn();
  else gameStore.demoEndTurn();
}
const canEndTurn = computed(() => gameStore.isPlaying.value || gameStore.state.demoMode);

// Dialog positioning (FC4): project an action square → a VIEWPORT anchor so the
// dialog pops near the action (ClassicDialog offsets right/up + clamps); null →
// centred. Non-reactive to camera pans (the classic camera is near-static), and the
// dialog stays draggable.
function playerSquare(playerId: string | null | undefined): [number, number] | null {
  if (!playerId) return null;
  const g = game.value as { fieldModel?: { playerDataArray?: { playerId: string; playerCoordinate?: [number, number] | null }[] } } | null;
  return g?.fieldModel?.playerDataArray?.find((p) => p.playerId === playerId)?.playerCoordinate ?? null;
}
function anchorFor(square: [number, number] | null | undefined): { x: number; y: number } | null {
  if (!square || !renderer || !pitchHost.value) return null;
  const p = renderer.squareToCanvas(square);
  if (!p) return null;
  const rect = pitchHost.value.getBoundingClientRect();
  return { x: rect.left + p.x, y: rect.top + p.y };
}

// (#310 blitz-special election REMOVED 08-24: the seam moved to the shared wide-rail
// activation election — see classicWideRailPrompt; specials now elect at ACTIVATION,
// a target click sends targetSelected directly, matching Modern.)
// A walkable floor click can convert an unconsumed declaration to Move.
const blitzMoveModalTile = ref<[number, number] | null>(null);
const blitzMoveButtons: ClassicDialogButton[] = [
  { id: 'convert', label: 'Convert to Move', mnemonic: 'C', kind: 'confirm' },
  { id: 'keep', label: 'Keep Blitz', mnemonic: 'K', kind: 'decline' },
];
function blitzUsedActingSide(currentGame: { homePlaying?: boolean; turnDataHome?: { blitzUsed?: boolean } | null; turnDataAway?: { blitzUsed?: boolean } | null }): boolean {
  return !!(currentGame.homePlaying ? currentGame.turnDataHome?.blitzUsed : currentGame.turnDataAway?.blitzUsed);
}
function acceptBlitzMoveConvert(): void {
  const tile = blitzMoveModalTile.value;
  blitzMoveModalTile.value = null;
  if (tile) gameStore.convertBlitzToMove(tile);
}
function dismissBlitzMoveModal(): void { blitzMoveModalTile.value = null; }
function onBlitzMovePick(id: string): void {
  if (id === 'convert') acceptBlitzMoveConvert();
  else dismissBlitzMoveModal();
}

// --- FC3: classic dialogs — thin adapters off the SHARED store rails, rendered
// through ClassicDialog. First slice: the generic yes/no rail (concede / confirm-
// end-action / leave / information / three-way) and the re-roll prompt. More rails
// (block / skill / followup / coin / setup / send-off …) follow.

// Generic yes/no (askYesNo → resolveYesNo).
const yn = computed(() => gameStore.state.yesNo);
const ynButtons = computed<ClassicDialogButton[]>(() =>
  yn.value
    ? [
        { id: 'yes', label: yn.value.yesLabel, mnemonic: yn.value.yesLabel[0], kind: 'confirm' },
        { id: 'no', label: yn.value.noLabel, mnemonic: yn.value.noLabel[0], kind: 'decline' },
      ]
    : [],
);
function onYesNo(id: string): void { gameStore.resolveYesNo(id === 'yes'); }

// Re-roll prompt (reRollPrompt → resolveReRoll). FUMBBL mnemonics: T = Team
// Re-Roll, P = Pro, B = Brawler, C = Consummate Professional… (first letter else).
const RR_MNEMONICS: Record<string, string> = {
  'Team ReRoll': 'T', 'Team Re-Roll': 'T', Pro: 'P', Brawler: 'B',
  'Consummate Professional': 'C', Loner: 'L',
};
const rr = computed(() => gameStore.state.reRollPrompt);
const rrReadonly = computed(() => !rr.value?.mine);
const rrButtons = computed<ClassicDialogButton[]>(() => {
  const p = rr.value;
  if (!p) return [];
  const opts: ClassicDialogButton[] = p.options.map((o) => ({
    id: o.source,
    label: o.label,
    mnemonic: RR_MNEMONICS[o.source] ?? o.label[0],
    chosen: p.chosen === o.source,
  }));
  // The decline is only meaningful to the acting coach; read-only viewers see it inert.
  opts.push({ id: '__decline', label: 'Decline', mnemonic: 'D', kind: 'decline', chosen: p.chosen === '' });
  return opts;
});
function onReroll(id: string): void { gameStore.resolveReRoll(id === '__decline' ? null : id); }

// ── BB2025 HIGH KICK (Classic reachability) ─────────────────────────────────────────────────────
// Classic could previously only DECLINE. It now nominates through the same store projection Modern uses:
// the nominee set, the SERVER-SENT landing square, the local single-slot staging, and the exact ordered
// CLIENT_SETUP_PLAYER → CLIENT_END_TURN confirm all live in the store's High Kick controller.
const highKickPhase = computed(() => gameStore.state.highKickPhase);
function nominateHighKick(playerId: string): boolean {
  return gameStore.highKickNominate(playerId);
}

// ── BB2025 QUICK SNAP (Classic reachability) ────────────────────────────────────────────────────
// Same controller projection as Modern: candidates come from the store (own + on-pitch + received ACTIVE),
// legal squares from gameStore.quickSnapTargets, and every move goes through the one admission gate, so both
// views can only emit the identical CLIENT_SETUP_PLAYER / CLIENT_END_TURN wire.
function playerLabel(playerId: string): string {
  const g = game.value as { teamHome?: TeamLoose; teamAway?: TeamLoose } | null;
  for (const t of [g?.teamHome, g?.teamAway]) {
    const p = (t?.playerArray ?? []).find((q) => q.playerId === playerId);
    if (p) return `#${p.playerNr} ${p.playerName}`;
  }
  return playerId;
}
const quickSnapPhase = computed(() => gameStore.state.quickSnapPhase);
const selectedQuickSnap = ref<string | null>(null);
const quickSnapTargets = computed<[number, number][]>(() =>
  selectedQuickSnap.value ? gameStore.quickSnapTargets(selectedQuickSnap.value) : []);
const quickSnapStatus = computed(() => {
  const qs = quickSnapPhase.value;
  if (!qs || qs.allowed === null) return null;
  return {
    moved: qs.moved, allowed: qs.allowed, available: qs.available, remaining: qs.remaining,
    exhausted: qs.exhausted ? quickSnapExhaustedText(qs.exhausted.limitReached) : null,
  };
});
function selectQuickSnapPlayer(playerId: string): boolean {
  if (!quickSnapPhase.value?.players.some((p) => p.playerId === playerId)) return false;
  selectedQuickSnap.value = selectedQuickSnap.value === playerId ? null : playerId;
  return true;
}
function quickSnapMoveTo(coord: [number, number]): boolean {
  const id = selectedQuickSnap.value;
  if (!id) return false;
  if (!quickSnapTargets.value.some((square) => square[0] === coord[0] && square[1] === coord[1])) return false;
  if (!gameStore.sendQuickSnapMove(id, coord)) return false;
  selectedQuickSnap.value = null; // re-select to move another player
  return true;
}
// Draw the same destination crosshairs Modern uses, and drop a selection the model has spent.
watch([() => quickSnapPhase.value?.seq, selectedQuickSnap], () => {
  if (!renderer) return;
  const qs = quickSnapPhase.value;
  if (selectedQuickSnap.value && !qs?.players.some((p) => p.playerId === selectedQuickSnap.value)) {
    selectedQuickSnap.value = null;
  }
  const selected = qs?.players.find((p) => p.playerId === selectedQuickSnap.value) ?? null;
  renderer.setQuickSnapArrows(
    selected?.coord ?? null,
    selected ? quickSnapTargets.value : [],
    parseInt(settings.uiPrimary.slice(1), 16),
  );
}, { flush: 'post' });

// Skill use (skillChoice → resolveSkillUse) — "Use <skill>?" (readonly for spectators).
const skillUse = computed(() => gameStore.state.skillChoice);
const skillUsePassCopy = computed(() => passSkillUseCardCopy(skillUse.value));
const skillUseHmpScatterCopy = computed(() => hmpScatterSkillUseCardCopy(skillUse.value));
const skillUseSwoopCopy = computed(() => swoopChoiceCopy(game.value, skillUse.value?.skill));
const skillUseButtons = computed<ClassicDialogButton[]>(() => skillUseSwoopCopy.value ? [
  { id: 'use', label: skillUseSwoopCopy.value.accept, mnemonic: 'S', kind: 'confirm' },
  { id: 'decline', label: skillUseSwoopCopy.value.decline, mnemonic: 'N', kind: 'decline' },
] : skillUsePassCopy.value ? [
  { id: 'use', label: 'Yes', mnemonic: 'Y', kind: 'confirm' },
  { id: 'decline', label: 'No', mnemonic: 'N', kind: 'decline' },
] : [
  { id: 'use', label: 'Use', mnemonic: 'U', kind: 'confirm' },
  { id: 'decline', label: 'Decline', mnemonic: 'D', kind: 'decline' },
]);
function onSkillUse(id: string): void { gameStore.resolveSkillUse(id === 'use'); }

// Bloodlust (re-roll → decision → bite).
const bloodlust = computed(() => gameStore.state.bloodlust);
const bloodlustButtons = computed<ClassicDialogButton[]>(() => {
  const b = bloodlust.value;
  if (!b) return [];
  if (b.stage === 'reroll') {
    return [
      ...(b.rerollOptions ?? []).map((o) => ({ id: `reroll:${o.source}`, label: o.label, mnemonic: o.label[0] })),
      { id: 'reroll:decline', label: 'Keep roll', mnemonic: 'K', kind: 'decline' },
    ];
  }
  if (b.stage === 'decision') {
    return [
      { id: 'decision:move', label: b.changeToMove ? 'Change to move' : 'Move first', mnemonic: 'M' },
      { id: 'decision:feed', label: `Feed & perform ${b.action}`, mnemonic: 'F', kind: 'confirm' },
    ];
  }
  return [
    ...(b.biteTargets ?? []).map((t) => ({ id: `bite:${t.playerId}`, label: `Bite ${t.name}`, mnemonic: 'B', kind: 'confirm' as const })),
    { id: 'bite:refuse', label: 'Refuse', mnemonic: 'R', kind: 'decline' },
  ];
});
function onBloodlust(id: string): void {
  const b = bloodlust.value;
  if (!b) return;
  if (b.stage === 'reroll') gameStore.resolveBloodlustReroll(id === 'reroll:decline' ? null : id.slice('reroll:'.length));
  else if (b.stage === 'decision') gameStore.resolveBloodlustDecision(id === 'decision:move');
  else gameStore.resolveBloodlustBite(id === 'bite:refuse' ? null : id.slice('bite:'.length));
}

// S5 blitz-block attack choice (Gored by the Bull etc.): the server-armed alternative-attack card —
// plain Block + each offered special, committed via commitBlitzBlock (mirrors SpectateView:10053).
const blitzBlockChoice = computed(() => gameStore.state.blitzBlockChoice);
const blitzBlockChoiceButtons = computed<ClassicDialogButton[]>(() => {
  const c = blitzBlockChoice.value;
  if (!c) return [];
  return [
    { id: '__block', label: 'Block', mnemonic: 'B', kind: 'confirm' },
    ...c.offers.map((o) => ({ id: `alt:${o.kind}`, label: o.label, mnemonic: o.label[0] })),
  ];
});
function onBlitzBlockChoice(id: string): void {
  if (!blitzBlockChoice.value) return;
  gameStore.commitBlitzBlock(id === '__block' ? null : id.slice('alt:'.length));
}

// Wizard/inducement choices use the shared store controller; Classic supplies only its presentation.
const inducementUse = computed(() => gameStore.state.inducementUse);
const inducementUseButtons = computed<ClassicDialogButton[]>(() => {
  const offer = inducementUse.value;
  if (!offer) return [];
  return [
    ...offer.options.map((option) => ({
      id: `${option.kind}:${option.value}`, label: option.label, mnemonic: option.label[0],
    })),
    { id: '__decline', label: offer.declineLabel, mnemonic: offer.declineLabel[0], kind: 'decline' as const },
  ];
});
function onInducementUse(id: string): void {
  if (id === '__decline') { gameStore.resolveUseInducement('decline'); return; }
  const separator = id.indexOf(':');
  if (separator < 0) return;
  const kind = id.slice(0, separator) as 'inducement' | 'card' | 'spell' | 'regeneration';
  gameStore.resolveUseInducement(kind, id.slice(separator + 1));
}
const wizardTargetConfirm = computed(() => gameStore.state.wizardTargetConfirm);
const wizardTargetButtons: ClassicDialogButton[] = [
  { id: 'confirm', label: 'Confirm', mnemonic: 'C', kind: 'confirm' },
  { id: 'cancel', label: 'Cancel', mnemonic: 'X', kind: 'decline' },
];
function onWizardTarget(id: string): void {
  if (id === 'confirm') gameStore.confirmWizardTarget();
  else gameStore.cancelWizardTarget();
}

// Follow-up choice (followupChoice → resolveFollowup).
const followup = computed(() => gameStore.state.followupChoice);
const followupButtons: ClassicDialogButton[] = [
  { id: 'follow', label: 'Follow up', mnemonic: 'F', kind: 'confirm' },
  { id: 'stay', label: 'Stay', mnemonic: 'S', kind: 'decline' },
];
function onFollowup(id: string): void { gameStore.resolveFollowup(id === 'follow'); }

// Coin toss (coinChoicePrompt → resolveCoinChoice).
const coin = computed(() => gameStore.state.coinChoicePrompt);
const coinButtons: ClassicDialogButton[] = [
  { id: 'heads', label: 'Heads', mnemonic: 'H' },
  { id: 'tails', label: 'Tails', mnemonic: 'T' },
];
function onCoin(id: string): void { gameStore.resolveCoinChoice(id === 'heads'); }

// Kick / receive (receiveChoicePrompt → resolveReceiveChoice).
const receive = computed(() => gameStore.state.receiveChoicePrompt);
const receiveButtons: ClassicDialogButton[] = [
  { id: 'receive', label: 'Receive', mnemonic: 'R', kind: 'confirm' },
  { id: 'kick', label: 'Kick', mnemonic: 'K' },
];
function onReceive(id: string): void { gameStore.resolveReceiveChoice(id === 'receive'); }

// Select-skill (selectSkill → resolveSelectSkill) — pick one offered skill.
const selectSkill = computed(() => gameStore.state.selectSkill);
const intensiveTrainingSelect = computed(() => String(selectSkill.value?.mode ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'intensivetraining');
const selectSkillPortrait = computed(() => selectSkill.value ? classicPortrait(selectSkill.value.playerId) : null);
const prayerRecipientPortrait = computed(() => {
  const playerId = gameStore.state.prayerAnnounce?.playerId;
  return playerId ? classicPortrait(playerId) : null;
});
const selectSkillButtons = computed<ClassicDialogButton[]>(() =>
  (selectSkill.value?.skills ?? []).map((sk) => ({ id: sk, label: sk, mnemonic: sk[0] })),
);

// Activation-time star elections are client-correlated only after the server echoes the declared actor/action.
// Classic must consume that same shared rail as Modern; otherwise an I'll Carry You offer is acknowledged in the
// store but has no visible control in this view. This watcher sends nothing: only the explicit button handlers do.
const classicWideRailPrompt = ref<{
  key: string; seq: number; playerId: string; playerAction: string;
  options: { ruleId: WideRailPreActionRuleId; label: string }[];
} | null>(null);
let classicWideRailAnsweredKey = '';
watch(
  [gameStore.game, gameStore.isPlaying, gameStore.myTurn],
  ([g]) => {
    if (!g || !gameStore.isPlaying.value || !gameStore.myTurn.value) {
      classicWideRailPrompt.value = null;
      return;
    }
    const election = gameStore.wideRailActivationElection();
    if (!election) {
      classicWideRailPrompt.value = null;
      return;
    }
    const gameId = String((g as { gameId?: string | number }).gameId ?? '');
    const turn = g.homePlaying ? g.turnDataHome?.turnNr : g.turnDataAway?.turnNr;
    const key = `${gameId}:${g.half}:${turn}:${election.seq}`;
    if (key === classicWideRailAnsweredKey) {
      classicWideRailPrompt.value = null;
      return;
    }
    classicWideRailPrompt.value = { key, ...election };
  },
  { deep: true, flush: 'sync', immediate: true },
);
const classicWideRailButtons = computed<ClassicDialogButton[]>(() => [
  ...(classicWideRailPrompt.value?.options ?? []).map((option) => ({
    id: option.ruleId, label: option.label, mnemonic: option.label[0],
  })),
  { id: 'continue', label: 'Continue without a special', mnemonic: 'N' },
]);
function onClassicWideRailPick(id: string): void {
  const prompt = classicWideRailPrompt.value;
  if (!prompt) return;
  if (id === 'continue') {
    gameStore.dismissWideRailActivationRules(prompt.playerId, prompt.playerAction, prompt.seq);
  } else if (!prompt.options.some((option) => option.ruleId === id)
      || !gameStore.useWideRailActivationRule(id as WideRailPreActionRuleId,
        prompt.playerId, prompt.playerAction, prompt.seq)) {
    return;
  }
  classicWideRailAnsweredKey = prompt.key;
  classicWideRailPrompt.value = null;
}
function onSelectSkill(id: string): void { gameStore.resolveSelectSkill(id); }

// Select-keyword (keywordChoice → resolveKeyword). Single-pick (max=1) commits on
// click; multi-select (min<max) toggles the keyword buttons (gold-glow chosen) and
// commits with a Confirm button gated to the min..max bounds.
const keyword = computed(() => gameStore.state.keywordChoice);
const keywordMulti = computed(() => (keyword.value?.max ?? 1) > 1);
const keywordSel = ref<Set<string>>(new Set());
watch(() => keyword.value?.seq, () => { keywordSel.value = new Set(); });
const keywordButtons = computed<ClassicDialogButton[]>(() => {
  const k = keyword.value;
  if (!k) return [];
  const opts: ClassicDialogButton[] = k.keywords.map((kw) => ({
    id: kw, label: kw, mnemonic: kw[0],
    chosen: keywordMulti.value && keywordSel.value.has(kw),
  }));
  if (keywordMulti.value) {
    const n = keywordSel.value.size;
    opts.push({ id: '__confirm', label: 'Confirm', mnemonic: 'C', kind: 'confirm', disabled: n < k.min || n > k.max });
  }
  return opts;
});
function onKeyword(id: string): void {
  const k = keyword.value;
  if (!k) return;
  if (!keywordMulti.value) { gameStore.resolveKeyword([id]); return; }
  if (id === '__confirm') {
    if (keywordSel.value.size >= k.min && keywordSel.value.size <= k.max) gameStore.resolveKeyword([...keywordSel.value]);
    return;
  }
  const sel = new Set(keywordSel.value);
  if (sel.has(id)) sel.delete(id);
  else if (sel.size < k.max) sel.add(id);
  keywordSel.value = sel;
}

// Referee send-off (sendOff → sendOffArgue/Bribe/Pass) — argue the call, spend a
// bribe (only when one is available), or accept the ejection.
const sendOff = computed(() => gameStore.state.sendOff);
const sendOffButtons = computed<ClassicDialogButton[]>(() => {
  const so = sendOff.value;
  if (!so) return [];
  const b: ClassicDialogButton[] = [];
  if (so.canArgue) b.push({ id: 'argue', label: 'Argue the Call', mnemonic: 'A', kind: 'confirm' });
  if (so.canBribe) b.push({ id: 'bribe', label: 'Bribe', mnemonic: 'B' });
  b.push({ id: 'pass', label: 'Pass', mnemonic: 'P', kind: 'decline' });
  return b;
});
function onSendOff(id: string): void {
  if (id === 'argue') gameStore.sendOffArgue();
  else if (id === 'bribe') gameStore.sendOffBribe();
  else gameStore.sendOffPass();
}

// Use apothecary? (apothecaryChoice → resolveApothecary) — read-only for spectators.
const apo = computed(() => gameStore.state.apothecaryChoice);
const apoSubject = computed(() => {
  const playerId = apo.value?.injuries[0]?.playerId;
  const g = game.value;
  if (!playerId || !g) return null;
  for (const [team, side] of [[g.teamHome, 'home'], [g.teamAway, 'away']] as const) {
    const player = team.playerArray.find((candidate) => candidate.playerId === playerId);
    if (player) return {
      player,
      side,
      portrait: classicPortrait(playerId),
      skills: playerDetailSkills(player),
    };
  }
  return null;
});
const apoSkillMode = computed<'icons' | 'markings'>(() => settings.skillDisplay === 'markings' ? 'markings' : 'icons');
const apoButtons = computed<ClassicDialogButton[]>(() => {
  const choice = apo.value;
  if (!choice) return [];
  const buttons: ClassicDialogButton[] = choice.injuries.flatMap((injury) => injury.options.map((option) => ({
    id: `${injury.index}|${option.type ?? '__legacy__'}`,
    label: choice.kind === 'multiple' ? `${injury.player} — ${option.label}` : option.label,
    mnemonic: option.type?.charAt(0) ?? 'U',
    kind: 'confirm' as const,
  })));
  buttons.push({
    id: 'none',
    label: choice.noneLabel,
    mnemonic: 'N',
    kind: 'decline',
  });
  return buttons;
});
function onApo(id: string): void {
  const choice = apo.value;
  if (!choice) return;
  if (id === 'none') {
    gameStore.resolveApothecary(choice.key, null);
    return;
  }
  const [rawIndex, rawType] = id.split('|');
  const injuryIndex = Number(rawIndex);
  const option = Number.isInteger(injuryIndex)
    ? choice.injuries[injuryIndex]?.options.find((candidate) => (candidate.type ?? '__legacy__') === rawType)
    : null;
  if (option) gameStore.resolveApothecary(choice.key, injuryIndex, option.type);
}

// Apothecary re-roll choice (apothecaryD16 → resolveApothecaryChoice) — keep the
// OLD casualty or take the NEW (re-rolled) one.
const apoD16 = computed(() => gameStore.state.apothecaryD16);
const apoD16Buttons = computed<ClassicDialogButton[]>(() => {
  const c = apoD16.value;
  if (!c) return [];
  const oldResult = c.oldInjury + (c.oldRoll != null ? ` (${c.oldRoll})` : '');
  const newResult = c.newInjury + (c.newRoll != null ? ` (${c.newRoll})` : '');
  return [
    { id: 'old', label: 'Keep ' + oldResult, mnemonic: 'K' },
    { id: 'new', label: 'Take ' + newResult, mnemonic: 'T', kind: 'confirm' },
  ];
});
function onApoD16(id: string): void { gameStore.resolveApothecaryChoice(id === 'new' ? 'new' : 'old'); }

// Upstream BB2025 auto-keeps a re-rolled Badly Hurt result. This card is a local
// acknowledgement only; its Continue button never answers a server dialog.
const apoAutoReturn = computed(() => gameStore.state.apothecaryAutoReturn);
const apoAutoReturnButtons: ClassicDialogButton[] = [];

// Buy-card menu (cardChoice → resolveCardChoice) — pick a card or Done.
const cardChoice = computed(() => gameStore.state.cardChoice);
const cardButtons = computed<ClassicDialogButton[]>(() => {
  const c = cardChoice.value;
  if (!c) return [];
  const b: ClassicDialogButton[] = c.options.map((o) => ({ id: o.selection, label: o.name, mnemonic: o.name[0] }));
  b.push({ id: '__done', label: 'Done', mnemonic: 'D', kind: 'decline' });
  return b;
});
function onCard(id: string): void { gameStore.resolveCardChoice(id === '__done' ? null : id); }

// KO/injury INTERACTION GATE (pipeline Phase 3c, 5c16db2 → injuryInteraction /
// resolveInjuryInteraction) — the generic surface for coach decisions on injury/KO
// results (regeneration / keyword / future). Modeled on the re-roll adapter: options
// + Decline, `mine` ownership (read-only for spectators/opposition), the picked
// option GLOWS gold (§A0). Apothecary stays its own two adapters (not folded in).
const injuryGate = computed(() => gameStore.state.injuryInteraction);
const injuryGateReadonly = computed(() => !injuryGate.value?.mine);
const injuryGateButtons = computed<ClassicDialogButton[]>(() => {
  const p = injuryGate.value;
  if (!p) return [];
  const opts: ClassicDialogButton[] = p.options.map((o) => ({
    id: o.key,
    label: o.label,
    mnemonic: o.label[0],
    chosen: p.chosen === o.key,
  }));
  opts.push({ id: '__decline', label: 'Decline', mnemonic: 'D', kind: 'decline' });
  return opts;
});
function onInjuryGate(id: string): void {
  gameStore.resolveInjuryInteraction(id === '__decline' ? null : id);
}

// Pitch-anchored PLAYER PICK (armPlayerPick / playerChoice → resolvePlayerPick /
// confirmPlayerPick). The shared renderer draws the eligible-player crosshairs
// (setPlayerPick, synced in onMounted's watch) and fires onPlayerPick on a click;
// this just adds the classic prompt bar with Confirm (confirm mode) / Decline.
const playerPick = computed(() => gameStore.state.playerPick);

// CLASSIC ALIGNMENT (Pellaeon 2026-07-16, audit G2a): MVP NOMINATION surface. The fork
// (MVP_NOMINATIONS>0) sends a `playerChoice` dialog mode 'mvp' → armed on the SHARED
// state.playerPick rail (key `pchoice:mvp:…`, confirm-mode, min===max===N, non-declinable;
// server PlayerChoiceMode.MVP = "mvp"). Classic's pitch-crosshair pick CAN'T select the
// candidates — MVP eligibility includes benched/KO'd players (server findPlayerIdsForMvp),
// which are OFF the pitch — so a roster LIST surface is required. Reuses the rail verbatim:
// resolvePlayerPick(id) toggles, confirmPlayerPick() commits (CLIENT_PLAYER_CHOICE). Without
// this a Classic coach can never complete nomination → the Classic-side "NO MVP AWARDED".
const mvpNomination = computed(() => {
  const pp = gameStore.state.playerPick;
  if (gameStore.state.endGame.phase !== 'mvp' || !pp || !pp.key.startsWith('pchoice:mvp')) return null;
  const g = game.value as {
    teamHome?: { playerArray?: { playerId: string; playerNr?: number; playerName?: string; positionId?: string; positionName?: string }[]; roster?: { positionArray?: { positionId: string; positionName?: string }[] } };
    teamAway?: { playerArray?: { playerId: string; playerNr?: number; playerName?: string; positionId?: string; positionName?: string }[]; roster?: { positionArray?: { positionId: string; positionName?: string }[] } };
  } | null;
  const resolve = (id: string) => {
    for (const team of [g?.teamHome, g?.teamAway]) {
      const raw = (team?.playerArray ?? []).find((p) => p.playerId === id);
      if (raw) {
        const pos = raw.positionName
          ?? (team?.roster?.positionArray ?? []).find((q) => q.positionId === raw.positionId)?.positionName ?? '';
        return { id, nr: raw.playerNr ?? null, name: raw.playerName ?? 'Player', pos };
      }
    }
    return { id, nr: null as number | null, name: 'Player', pos: '' };
  };
  return { max: pp.maxPicks, min: pp.minPicks, picked: pp.picked, candidates: pp.eligibleIds.map(resolve) };
});

// Owner audit 08-17 (P1 — Iron Man/Knuckle Dusters cannot reach every offered reserve): Classic
// has NO dugout click surface (renderer dugoutsEnabled=false — the sidebars carry the box), so a
// mandatory playerChoice offering a reserve displaced by Stars or beyond preSetupFormation's
// eleven synthetic placements (packages/ffb-pitch/src/preSetupFormation.ts) can have no pitch
// square to tap at all. Generic fallback beside the dedicated MVP modal above: any OTHER armed
// playerPick that offers at least one off-pitch candidate gets the same roster-list surface,
// resolving through the identical resolvePlayerPick/confirmPlayerPick rail — never a new wire.
const rosterPickModal = computed(() => {
  const pp = gameStore.state.playerPick;
  if (!pp || pp.key.startsWith('pchoice:mvp')) return null;
  if (!hasOffPitchCandidate(game.value, pp.eligibleIds)) return null;
  return {
    prompt: pp.prompt, min: pp.minPicks, max: pp.maxPicks, picked: pp.picked, declinable: pp.declinable,
    candidates: resolveRosterPickCandidates(game.value, pp.eligibleIds),
  };
});

// CLASSIC ALIGNMENT (Pellaeon 2026-07-16, audit G2b): END-GAME results + board clear.
// gameOver = the server's endGame turnMode / finished flag. On game-end: wipe the pitch
// (renderer.setBoardCleared — tokens/ball/dugouts) so the PERMANENT result panel sits over a
// clean field (owner 2026-07-15), and drop the stale active-player highlight. Data is off
// gameResult (server-authoritative). SPP-earned is DERIVED from the server's achievement
// fields via the server's exact bb2020 formula — the server COMPUTES this but does NOT
// serialize it (⚖ fidelity corollary: reproduce the canonical computation, cited, from
// server-authoritative inputs — never sum currentSpps, that's the LIFETIME total).
// endgame twin (Pellaeon 2026-08-12, re-authored from 6f779352 post shared-layer merge): the
// server-driven phase machine now owns endgame. gameOver = any non-idle phase (starts the
// sequence, no longer implies the final panel); the FINAL result panel + board-clear gate on
// finalPresentationReady — so the MVP overlay/final panel can't fire on a bare endGame frame.
const gameOver = computed(() => gameStore.state.endGame.phase !== 'idle');
const finalPresentationReady = computed(() => gameStore.state.endGame.finalPresentationReady);
const CLASSIC_END_GAME_PHASE_LABELS = {
  idle: '', initializing: 'End Game · Initializing', assignTouchdowns: 'End Game · Assign Touchdowns',
  penaltyShootout: 'End Game · Penalty Shootout', mvp: 'End Game · MVP', winnings: 'End Game · Winnings',
  dedicatedFans: 'End Game · Dedicated Fans', playerLoss: 'End Game · Player Loss',
  statistics: 'End Game · Statistics', complete: 'Final',
} as const;
const endGamePhaseLabel = computed(() => CLASSIC_END_GAME_PHASE_LABELS[gameStore.state.endGame.phase]);
watch(gameOver, (over) => {
  if (over) gameStore.state.activePlayerId = null;
});
watch(finalPresentationReady, (ready) => renderer?.setBoardCleared(ready));
function classicEndSide(side: 'home' | 'away') {
  const g = game.value as {
    teamHome?: TeamLoose; teamAway?: TeamLoose;
    gameResult?: { teamResultHome?: { score?: number; playerResults?: Record<string, unknown>[] }; teamResultAway?: { score?: number; playerResults?: Record<string, unknown>[] } };
  } | null;
  if (!g?.gameResult) return null;
  const team = side === 'home' ? g.teamHome : g.teamAway;
  const tr = side === 'home' ? g.gameResult.teamResultHome : g.gameResult.teamResultAway;
  if (!team || !tr) return null;
  const posArr = team.roster?.positionArray ?? [];
  const posName = (pid: string | undefined) => posArr.find((x) => x.positionId === pid)?.positionName ?? String(pid ?? '').split('.').pop() ?? '';
  const num = (r: Record<string, unknown>, k: string) => Number(r[k] ?? 0);
  const sppEarned = (r: Record<string, unknown>) =>
    num(r, 'playerAwards') * 4 + num(r, 'touchdowns') * 3 + num(r, 'casualties') * 2 +
    num(r, 'interceptions') * 2 + num(r, 'completions') + num(r, 'deflections') +
    num(r, 'completionsWithAdditionalSpp') + num(r, 'casualtiesWithAdditionalSpp') + num(r, 'catchesWithAdditionalSpp');
  const results = (tr.playerResults ?? []) as Record<string, unknown>[];
  const mvps = results.filter((r) => num(r, 'playerAwards') > 0).map((r) => {
    const p = (team.playerArray ?? []).find((pl) => pl.playerId === (r.playerId as string));
    return { name: p?.playerName ?? '(unknown)', position: posName(p?.positionId) };
  });
  const sum = (k: string) => results.reduce((a, r) => a + num(r, k), 0);
  return {
    team: (team as { teamName?: string }).teamName ?? '', coach: (team as { coach?: string }).coach ?? '', score: Number(tr.score ?? 0), mvps,
    td: sum('touchdowns'), cas: sum('casualties'), comp: sum('completions'),
    spp: results.reduce((a, r) => a + sppEarned(r), 0),
  };
}
const classicEndGame = computed(() => {
  if (!finalPresentationReady.value) return null;
  const home = classicEndSide('home');
  const away = classicEndSide('away');
  if (!home || !away) return null;
  return { home, away, draw: home.score === away.score, homeWon: home.score > away.score, awayWon: away.score > home.score };
});

// Interactive team SETUP (setupPhase → setupPlace/Remove/AutoFill/Submit/Concede).
// The renderer shades the LOS/wide zones + routes pitch taps (setSetup/onSetupClick,
// synced in the watch below); a classic panel lists the validation + reserves +
// actions. Mirrors SpectateView's setup rail (home-relative coords, own half x 0..12).
const setupPhase = computed(() => gameStore.state.setupPhase);
// An inert player (Solid Defence non-selected) is not a usable reserve — keep it out of the count/list.
const setupReserves = computed(() => (setupPhase.value?.players ?? []).filter((p) => !p.coord && p.inert !== true));
const selectedSetupPlayerId = ref<string | null>(null);
// BB2025 Solid Defence: the store marks every non-selected player inert. Classic must refuse those the
// same way the Modern drag rail does, so both views can only produce the same legal wire.
const setupPlayerIsMovable = (playerId: string): boolean =>
  setupPhase.value?.players.find((p) => p.playerId === playerId)?.inert !== true;
const solidDefenceSetup = computed(() => gameStore.game.value?.turnMode === 'solidDefence');
const solidDefenceMovableCount = computed(() =>
  (setupPhase.value?.players ?? []).filter((p) => !p.inert).length);
const solidDefenceError = computed(() => gameStore.state.solidDefenceError);
function selectSetupPlayer(playerId: string): void {
  if (!setupPlayerIsMovable(playerId)) return;
  selectedSetupPlayerId.value = selectedSetupPlayerId.value === playerId ? null : playerId;
}
function returnSelectedToReserve(): void {
  if (selectedSetupPlayerId.value) {
    gameStore.setupRemove(selectedSetupPlayerId.value);
    selectedSetupPlayerId.value = null;
  }
}

// FUMBBL BLOCK DICE (owner 2026-07-08: mirror the default UI; the legacy on-pitch block
// cine was ripped 09-06 — blockPartial is the only dice surface). The interactive blockPartial cluster
// (BB2025 partial re-roll: accept a die, or re-roll via Team RR / Brawler / Pro /
// Consummate). Mirrors SpectateView; classic keeps its static camera so the cinematic
// zoom is intentionally omitted. The gold-trimmed cluster is the §A0 selection surface.
const blockPartial = computed(() => gameStore.state.blockPartial);
const blockChooserSeat = computed<BlockChooserSide | null>(() => gameStore.blockPresentationSeat.value);
const blockChooserSpectator = computed(() => !gameStore.isPlaying.value);
const liveBlockChoiceDialog = computed(() => isCurrentBlockChoiceDialog(game.value));
const liveBlockChoosingTeamId = computed(() => currentBlockChoosingTeamId(game.value));
const liveBlockChooser = computed(() => projectBlockChooser(
  game.value, liveBlockChoosingTeamId.value, blockChooserSeat.value, blockChooserSpectator.value));
const blockDialogMine = computed(() => liveBlockChoiceDialog.value && liveBlockChooser.value.mine);
// Owner 2026-07-12 (bug, upstream-client-verified): uphill block phase-1 is a RE-ROLL decision, not a die pick.
// An uphill block WITH a re-roll available first asks the ATTACKER a re-roll decision (choosingTeamId=attacker,
// nrOfDice<0); only after it resolves does the server flip the pick to the DEFENDER. `pickable` (shared
// state.blockPartial field, added with the SpectateView o66 fix 864957b5/d4eea6ee) mirrors the authoritative
// upstream client gate VERBATIM — DialogBlockRollProperties.java:92 `ownChoice = nrOfDice>0 || !hasActualReRoll()`.
// It is FALSE only in that phase-1; Classic reads the same field, so it inherits the fix WITHOUT an order66 gate
// (the field self-scopes: it is true for every downhill/even block and the single-phase plain-uphill defender pick).
const bpPhase1ReRollOnly = computed(() => blockDialogMine.value && !!blockPartial.value
  && blockPartial.value.nrOfDice < 0 && !blockPartial.value.pickable);
const bpDieMode = ref<null | 'pro' | 'consummate'>(null);
function useBlockPartialOption(kind: 'brawler' | 'pro' | 'consummate'): void {
  if (!blockDialogMine.value) return;
  const bp = gameStore.state.blockPartial;
  if (!bp) return;
  if (kind === 'brawler') { gameStore.resolveBlockPartial('brawler'); return; }
  if (bp.dice.length <= 1) { gameStore.resolveBlockPartial(kind, 0); return; } // one die → no prompt
  bpDieMode.value = kind; // arm die-selection
}
function clickBlockPartialDie(i: number): void {
  if (!gameStore.state.blockPartial || !blockDialogMine.value) return;
  if (bpDieMode.value) { gameStore.resolveBlockPartial(bpDieMode.value, i); return; } // re-roll THAT die — always OK
  // uphill phase-1 (attacker still deciding a re-roll): the attacker must NOT commit the die — the pick is the
  // defender's. Ignore the click (the die buttons are also :disabled); Decline Re-Roll proceeds instead.
  if (bpPhase1ReRollOnly.value) return;
  gameStore.resolveBlockPartial('accept', i);
}
watch(() => gameStore.state.blockPartial, (bp) => { if (!bp) bpDieMode.value = null; });
// FIRST beat of a block (pipeline case 346): a target CROSSHAIR on the token, held
// ~550ms before the dice. Part of the block reveal classic already shows — ungated.
watch(
  () => gameStore.state.blockTargetCue?.seq,
  () => {
    const cue = gameStore.state.blockTargetCue;
    if (cue && renderer) renderer.showBlockTargetCrosshair(cue.square);
  },
);

// PRE-KICKOFF CINEMATICS (Pellaeon 2026-08-12, owner-ordered FC-D3 reversal). The five
// store-driven pre-kickoff cines (coin/weather/dodgy-snack/kickoff/fan-factor) render as
// HTML overlays, ported from SpectateView. The store owns set/clear + auto-dismiss timers
// (click-dismiss mode releases via dismissCine), so Classic only RENDERS the v-if blocks.
// Camera stays static (FC-D): the only renderer tie-in is the kickoff ball-hold below.
const coinSkullUrl = new URL('../assets/coin_skull.png', import.meta.url).href;
// d6/d3 pip layout → 9-cell on/off grid (mirrors SpectateView.pipPattern).
function pipPattern(n: number): boolean[] {
  const map: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const on = new Set(map[n] ?? []);
  return Array.from({ length: 9 }, (_, i) => on.has(i));
}
function weatherEmoji(weather: string): string {
  const w = weather.toLowerCase();
  if (w.includes('blizzard')) return '❄️';
  if (w.includes('rain') || w.includes('pour')) return '🌧️';
  if (w.includes('swelter') || w.includes('heat')) return '🥵';
  if (w.includes('sunny')) return '☀️';
  return '🌤️';
}
// Kickoff cine → hold the ball at its apex through the event window (renderer Z-hang only,
// no camera move). Store-side KICKOFF_CINE_MS is 5000; SpectateView keeps a local copy — mirror it.
const KICKOFF_CINE_MS = 5000;
watch(
  () => gameStore.state.kickoffCine,
  (cine) => {
    if (cine && renderer && !gameStore.playbackCatchingUp.value) renderer.holdBallKickIn(KICKOFF_CINE_MS);
  },
);

// "Block Roll" dialog (owner 2026-07-08: match the FUMBBL client). The interactive
// block choice is a proper dialog showing the block-die FACE ART — the dice TUMBLE
// (cycling the faces) for ~0.8s, then settle on the rolled values and become
// clickable to choose. Re-roll sources are the dialog's button row.
const blockFaceUrls = computed(() => {
  void assetMods.blockDiceRevision;
  return PitchRenderer.blockFaceUrls();
});
function blockFaceUrl(v: number): string {
  void assetMods.blockDiceRevision;
  return PitchRenderer.blockFaceUrl(v);
}
function blockFaceLabel(v: number): string { return PitchRenderer.blockFaceLabel(v); }
const blockTumbling = ref(false);
const tumbleIdx = ref(0);
let tumbleInterval = 0;
let tumbleStop = 0;
function startBlockTumble(): void {
  clearInterval(tumbleInterval);
  clearTimeout(tumbleStop);
  blockTumbling.value = true;
  tumbleInterval = window.setInterval(() => { tumbleIdx.value = (tumbleIdx.value + 1) % blockFaceUrls.value.length; }, presentationMs(80));
  tumbleStop = window.setTimeout(() => { clearInterval(tumbleInterval); blockTumbling.value = false; }, presentationMs(800));
}
watch(() => gameStore.state.blockPartial?.seq, (seq) => {
  bpDieMode.value = null;
  if (seq != null) startBlockTumble();
});
const blockRollButtons = computed<ClassicDialogButton[]>(() => {
  const bp = gameStore.state.blockPartial;
  if (!bp || !blockDialogMine.value) return [];
  const b: ClassicDialogButton[] = [];
  if (bp.brawler) b.push({ id: 'brawler', label: 'Brawler', mnemonic: 'B' });
  if (bp.pro) b.push({ id: 'pro', label: 'Pro', mnemonic: 'P', chosen: bpDieMode.value === 'pro' });
  if (bp.consummate) b.push({ id: 'consummate', label: bp.consummateLabel ?? 'Consummate', mnemonic: 'C', chosen: bpDieMode.value === 'consummate' });
  if (bp.teamRR) b.push({ id: 'team', label: 'Team Re-Roll', mnemonic: 'T' });
  // Owner 2026-07-12 (bug): uphill phase-1 — the attacker DECLINES the re-roll and proceeds; the server then
  // flips the pick to the defender. Upstream-verbatim decline = sendUseReRoll(BLOCK, null) (d4eea6ee's
  // resolveBlockPartial('declineReroll')), NOT an accept/CLIENT_BLOCK_CHOICE.
  if (!bp.pickable) b.push({ id: 'declineReroll', label: 'Decline Re-Roll', mnemonic: 'D' });
  return b;
});
function onBlockRollButton(id: string): void {
  if (!blockDialogMine.value) return;
  if (id === 'team') { gameStore.resolveBlockPartial('team'); return; }
  if (id === 'declineReroll') { gameStore.resolveBlockPartial('declineReroll'); return; }
  useBlockPartialOption(id as 'brawler' | 'pro' | 'consummate');
}

// Block/Blitz target context menu plus the legacy read-only "Show block dice" utility.
const ctxMenu = ref<{ x: number; y: number; playerId: string } | null>(null);
const pendingClassicFriendlyMenu = ref<{ playerId: string; x: number; y: number } | null>(null);
watch(() => o66ActingId.value, (actingId) => {
  const pending = pendingClassicFriendlyMenu.value;
  if (!pending || actingId) return;
  pendingClassicFriendlyMenu.value = null;
  if (game.value && gameStore.iControl(pending.playerId)) {
    ctxMenu.value = { x: pending.x, y: pending.y, playerId: pending.playerId };
  }
}, { flush: 'post' });
// CLASSIC ALIGNMENT (Pellaeon 2026-07-16, audit G1b — FUMBBL-client CONTEXT-MENU ACTION SET).
// Right-clicking a player surfaces the SERVER-DERIVED declarable set for that player via the shared
// `availableActions` (the pure companion to deriveClientState). Each CoachAction carries an EXISTING wire
// `action` string, so this is upstream-wire-compliant by construction — it runs through the existing senders
// (declareAction / endActivation / playerEndTurn), NO new wire. Mirrors SpectateView's runO66Action; the menu
// is presence-only (AWT parity — unavailable actions are absent). A Block declare's flavor (blockKind) is
// remembered for the target-click's sendBlock (G1c). "Show block dice" stays as the opponent-preview utility.
const classicPendingBlockKind = ref<BlockKind | null>(null);
const classicAttackStage = ref<{ targetId: string; kind: BlockKind | null } | null>(null);
const classicAttackConfirm = computed(() => {
  const g = game.value;
  const stage = classicAttackStage.value;
  if (!g || !stage?.kind) return null;
  const target = [...g.teamHome.playerArray, ...g.teamAway.playerArray].find((player) => player.playerId === stage.targetId);
  return { preview: blockAttackPreview(g, stage.targetId, stage.kind), targetName: target?.playerName ?? stage.targetId };
});
const classicPendingGaze = ref<string | null>(null);
// G1c: map the remembered block flavor → the clientBlock flags (mirrors SpectateView's o66BlockFlags).
function classicBlockFlags(k: BlockKind | null) {
  return k ? { usingStab: k === 'stab', usingChainsaw: k === 'chainsaw', usingVomit: k === 'vomit', usingBreatheFire: k === 'breatheFire', usingChomp: k === 'chomp' } : undefined;
}
type ClassicGazeConfirm = {
  stage: 'declaration' | 'target';
  victimId: string;
  canConfirm: boolean;
  refusal: string | null;
};
const classicGazeConfirm = computed<ClassicGazeConfirm | null>(() => {
  const intent = gameStore.state.gazeIntent;
  if (!intent) return null;
  if (intent.phase === 'targetSelected' && intent.pendingVictimId) {
    const canConfirm = gameStore.canConfirmGazeDeclaration(intent.pendingVictimId);
    return {
      stage: 'declaration', victimId: intent.pendingVictimId, canConfirm,
      refusal: canConfirm ? null : 'the nominated victim is no longer available',
    };
  }
  if (intent.phase !== 'active' || !intent.victimId) return null;
  const canConfirm = gameStore.canConfirmGazeTarget(intent.victimId);
  return {
    stage: 'target', victimId: intent.victimId, canConfirm,
    refusal: canConfirm || !game.value ? null : gazeConfirmRefusalReason(game.value, intent),
  };
});
const classicGazeButtons = computed<ClassicDialogButton[]>(() => {
  const confirm = classicGazeConfirm.value;
  if (!confirm) return [];
  const buttons: ClassicDialogButton[] = [{
    id: 'confirm',
    label: confirm.stage === 'declaration' ? 'Confirm Gaze Target' : 'Confirm Gaze',
    mnemonic: 'C', kind: 'confirm', disabled: !confirm.canConfirm,
  }];
  if (confirm.stage === 'declaration') buttons.push({ id: 'reselect', label: 'Reselect', mnemonic: 'R', kind: 'decline' });
  return buttons;
});
function confirmClassicGazeDeclaration(): boolean {
  const intent = gameStore.state.gazeIntent;
  const victimId = classicPendingGaze.value ?? (intent?.phase === 'targetSelected' ? intent.pendingVictimId : null);
  if (!victimId || !gameStore.confirmGazeDeclaration(victimId)) return false;
  classicPendingGaze.value = null;
  return true;
}
function confirmClassicGaze(): boolean {
  const intent = gameStore.state.gazeIntent;
  return intent?.phase === 'active' && !!intent.victimId && gameStore.confirmGazeTarget(intent.victimId);
}
function onClassicGaze(id: string): void {
  const confirm = classicGazeConfirm.value;
  if (!confirm) return;
  if (id === 'reselect') {
    gameStore.clearGazeVictim();
    classicPendingGaze.value = null;
  } else if (confirm.stage === 'declaration') confirmClassicGazeDeclaration();
  else confirmClassicGaze();
}
const ctxActions = computed<CoachAction[]>(() => {
  const cm = ctxMenu.value;
  if (!cm || !settings.order66 || !gameStore.isPlaying.value || !game.value) return [];
  const actions = availableActions(game.value, o66Ctx(), cm.playerId);
  if (cm.playerId === o66ActingId.value && boundingLeapSkillNow.value) {
    actions.push({ action: 'boundingLeapUse', label: 'Bounding Leap', kind: 'declare', enabled: true });
  }
  if (cm.playerId === o66ActingId.value && deriveClientState(game.value, o66Ctx()) === 'BLITZ') {
    for (const offer of blockAlternativeOffers(game.value, cm.playerId)) {
      actions.unshift({ action: 'block', label: offer.label, kind: 'declare', enabled: true, blockKind: offer.kind });
    }
  }
  return actions;
});
const classicTargetAttackChoices = computed<Array<{ kind: BlockKind | null; label: string }>>(() => {
  const cm = ctxMenu.value; const g = game.value; const actingId = o66ActingId.value;
  if (!cm || !g || !actingId || gameStore.iControl(cm.playerId)) return [];
  const state = deriveClientState(g, o66Ctx());
  if ((state !== 'BLOCK' && state !== 'BLITZ') || !adjacentStandingEnemyIds(g, actingId).includes(cm.playerId)) return [];
  const kinds = blockAlternativeOffers(g, actingId).map((offer) => offer.kind as BlockKind);
  if (chompAvailable(g, actingId)) kinds.push('chomp');
  return [{ kind: null, label: 'Block' }, ...[...new Set(kinds)].map((kind) => ({ kind, label: BLOCK_KIND_LABEL[kind] }))];
});
function armClassicTargetAttack(kind: BlockKind | null): void {
  classicPendingBlockKind.value = kind;
  classicAttackStage.value = null;
  ctxMenu.value = null;
}
function confirmClassicTargetAttack(): void {
  const stage = classicAttackStage.value; const actingId = o66ActingId.value; const g = game.value;
  if (!stage || !actingId || !g || !adjacentStandingEnemyIds(g, actingId).includes(stage.targetId)) return;
  gameStore.sendBlock(actingId, stage.targetId, classicBlockFlags(stage.kind));
  classicAttackStage.value = null;
  classicPendingBlockKind.value = null;
  renderer?.showBlockTargets(null);
}
// Wide-rail legacy rows are owned by the activation election while it shows (mirror of
// SpectateView's WIDE_RAIL_LEGACY_ACTIONS/localWideRailElectionOwnsAction; the store's
// WIDE_RAIL_RULE_IDS session guard backs this at the wire).
const CLASSIC_WIDE_RAIL_LEGACY_ACTIONS = new Set([
  'raidingParty', 'catchOfTheDay', 'frenziedRush', 'slashingNails', 'blackInk', 'wisdom',
  'starUseSkill', 'incorporeal', 'illCarryYou',
]);
function runClassicAction(a: CoachAction): void {
  const cm = ctxMenu.value;
  if (!cm || !a.enabled) return;
  if (a.action === 'block' && a.blockKind && game.value
      && deriveClientState(game.value, o66Ctx()) === 'BLITZ'
      && cm.playerId === o66ActingId.value) {
    classicPendingBlockKind.value = a.blockKind;
    ctxMenu.value = null;
    return;
  }
  if (classicWideRailPrompt.value && CLASSIC_WIDE_RAIL_LEGACY_ACTIONS.has(a.action)) { ctxMenu.value = null; return; }
  // G-02 (parity handoff 08-24): these derived actions are NOT PlayerAction declares — upstream routes each
  // pick to its dedicated sender (e.g. Fumblerooski: MoveLogicModule.java:133-136 → sendUseFumblerooskie), so
  // intercept them before the generic CLIENT_ACTING_PLAYER declare path. Mirrors runO66Action exactly.
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
  } else if (a.action === 'toggleHailMaryPass') {
    gameStore.toggleHailMaryPass();
  } else if (a.action === 'jump') {
    gameStore.chooseJump(cm.playerId);
  } else if (a.action === 'starUseSkill' && a.ruleId) {
    gameStore.useStarSkill(a.ruleId, true);
  } else if (a.action === 'boundingLeapUse') {
    gameStore.useBoundingLeap();
  } else if (a.action === 'incorporeal') {
    gameStore.toggleIncorporeal(); // S9: rail-local toggle (availableActions emits kind:'declare' → route explicitly)
  } else if (a.kind === 'declare') {
    classicPendingBlockKind.value = a.action === 'block' ? (a.blockKind ?? null) : null;
    if (a.action === 'gazeMove') gameStore.declareGazeIntent(cm.playerId);
    else gameStore.declareAction(cm.playerId, a.action);
  } else if (a.kind === 'endMove') {
    classicRequestEndActivation();
  } else if (a.kind === 'endTurn') {
    gameStore.playerEndTurn();
  }
  ctxMenu.value = null;
}

// N-01 (parity handoff 08-24): END-ACTIVATION CONFIRM — a self-click/menu End Activation during a
// live BLITZ/PUNT (or an armed gaze intent) must confirm before silently burning the once-per-turn
// action (#231 / SR-244 RG-2; law 10g). Mirrors SpectateView's askEndActivation semantics: confirm
// ends the activation; declining a PUNT de-escalates targeting back to the walk (returnPuntToMove).
const classicEndActConfirm = ref<{ kind: 'blitz' | 'punt' | 'generic'; text: string; confirmLabel: string } | null>(null);
const CLASSIC_END_ACT_COPY = {
  blitz: { text: 'Are you sure you want to end your blitz?', confirmLabel: 'End blitz' },
  punt: { text: 'End your punt?', confirmLabel: 'End punt' },
  generic: { text: 'End activation?', confirmLabel: 'End activation' },
} as const;
function classicRequestEndActivation(): void {
  const g = game.value;
  const st = g ? deriveClientState(g, o66Ctx()) : '';
  if (requiresBlitzEndConfirmation(st)) classicEndActConfirm.value = { kind: 'blitz', ...CLASSIC_END_ACT_COPY.blitz };
  else if (st === 'PUNT') classicEndActConfirm.value = { kind: 'punt', ...CLASSIC_END_ACT_COPY.punt };
  else if (gameStore.state.gazeIntent) classicEndActConfirm.value = { kind: 'generic', ...CLASSIC_END_ACT_COPY.generic };
  else gameStore.endActivation();
}
const classicEndActButtons = computed<ClassicDialogButton[]>(() => [
  { id: 'confirm', label: classicEndActConfirm.value?.confirmLabel ?? 'End activation', mnemonic: 'E', kind: 'confirm' },
  { id: 'cancel', label: 'Cancel', mnemonic: 'C', kind: 'decline' },
]);
function onClassicEndAct(id: string): void {
  const kind = classicEndActConfirm.value?.kind;
  classicEndActConfirm.value = null;
  if (id === 'confirm') { gameStore.endActivation({ blitzConfirmed: kind === 'blitz' }); return; }
  if (kind === 'punt') gameStore.returnPuntToMove(); // decline de-escalates punt targeting, no wire otherwise
}
// A stale confirm dies with its activation (mirrors SpectateView's SELECT_PLAYER clear).
watch(() => o66ActingId.value, () => { classicEndActConfirm.value = null; });
function ctxShowBlockDice(): void {
  if (ctxMenu.value) renderer?.showBlockTargets(ctxMenu.value.playerId);
  ctxMenu.value = null; // dice persist; menu closes
}
function closeCtxMenu(): void {
  ctxMenu.value = null;
  renderer?.showBlockTargets(null);
}

// FC4 classic PROMPT SOUNDS (owner: parity with the FUMBBL client). When a NEW
// interactive prompt surfaces, play FUMBBL's dialog "question" sting — the referee
// "whistle" for a send-off. Keyed on state+seq so it fires once per prompt; gated
// by the global sound volume (playSound checks it). Read-only spectator surfaces
// (reRoll/skill/apo when !mine) don't sound.
const st = gameStore.state;
const activePrompt = computed<{ key: string; sound: string } | null>(() => {
  if (st.yesNo) return { key: 'yn:' + st.yesNo.key, sound: 'question' };
  if (st.blockPartial) return { key: 'bp:' + st.blockPartial.seq, sound: 'question' };
  if (st.reRollPrompt?.mine) return { key: 'rr:' + st.reRollPrompt.seq, sound: 'question' };
  if (st.skillChoice?.mine) return { key: 'su:' + st.skillChoice.seq, sound: 'question' };
  if (st.followupChoice) return { key: 'fu:' + st.followupChoice.seq, sound: 'question' };
  if (st.coinChoicePrompt) return { key: 'coin:' + st.coinChoicePrompt.seq, sound: 'question' };
  if (st.receiveChoicePrompt) return { key: 'rcv:' + st.receiveChoicePrompt.seq, sound: 'question' };
  if (st.selectSkill) return { key: 'ss:' + st.selectSkill.seq, sound: 'question' };
  if (st.keywordChoice) return { key: 'kw:' + st.keywordChoice.seq, sound: 'question' };
  if (st.sendOff) return { key: 'so:' + st.sendOff.seq, sound: 'whistle' };
  if (st.injuryInteraction?.mine) return { key: 'inj:' + st.injuryInteraction.seq, sound: 'question' };
  if (st.apothecaryChoice?.mine) return { key: 'apo:' + st.apothecaryChoice.seq, sound: 'question' };
  if (st.apothecaryD16?.mine) return { key: 'apd:' + st.apothecaryD16.seq, sound: 'question' };
  if (st.cardChoice) return { key: 'card:' + st.cardChoice.seq, sound: 'question' };
  if (st.playerPick) return { key: 'pick:' + st.playerPick.seq, sound: 'question' };
  return null;
});
watch(
  () => activePrompt.value?.key ?? null,
  (key, prev) => {
    if (key && key !== prev) playSound(activePrompt.value!.sound);
  },
);

// FC4 EFFECTS opt-in (settings.classicEffects — FC-D3: off by default). A BOUNDED
// first slice: view-level relays that DON'T entangle the block/injury pipeline the
// 40k track is re-plumbing — push arrows (state.pushArrows → playPushArrow) and the
// turnover splash. The store owns the state + its self-clearing; classic just
// renders it while the toggle is on. Heavier cinematics (dice/injury/knockdown/
// crowd-surf) are a follow-up once the pipeline stabilises + a fork pass can verify.
watch(
  () => gameStore.state.pushArrows,
  (arrows) => {
    if (!arrows || !renderer || !settings.classicEffects) return;
    for (const a of arrows) renderer.playPushArrow(a.from, a.to);
  },
);

// PUSH-FAN FIX (owner 2026-07-06): the renderer's interactive push PLANNER
// (drawPushOptions) defaults ON (renderer.plannerEnabled = true). Classic never
// overrode it, so a spectated/replayed push drew the FULL candidate fan — an arrow
// AND a click-crosshair over every pushback square — instead of the spectator's
// chosen-push-only arrow. That's the "pushes shown repeatedly everywhere" bug (the
// 40k SpectateView already gates this via plannerEnabled; classic was missing the
// wiring). Classic shows the interactive planner ONLY in a real interactive PLAY
// game; a live spectate or demo is chosen-push-only.
const plannerAllowed = computed(() => !settings.spectatorClean && gameStore.isPlaying.value);
watch(plannerAllowed, (allowed) => {
  if (!renderer) return;
  renderer.plannerEnabled = allowed;
  renderer.clearSelection();
});

// CLASSIC ALIGNMENT (Pellaeon 2026-07-16, audit G1a — FUMBBL-CLIENT AUTOMOVE, keystone).
// ⚠ RIG-VERIFY OWED: this is an INTERACTION rail (click→send→token moves) — built against the stable
// shared helpers per Yularen's GO, but its acceptance is a live-fork playing-seat pass (a spectator can't
// drive it). Mirrors upstream `MoveLogicModule.fieldInteraction` on the shared o66 server-derived rails —
// NOT SpectateView's planner command-queue (owner ruling: Classic automove reflects the FUMBBL client).
// deriveClientState/o66Ctx/o66Reach/o66AutoPath/stepMove/o66Move are all reused verbatim; the ONLY behaviour
// swap is immediate-send (no 2-click confirm / waypoint / preview trail). settings.order66 is default-true
// on 0.3.0, so it's on in classic mode too.
function o66Ctx(): ClientStateContext {
  return {
    mode: 'player', loggedIn: true, myIsHome: gameStore.myTeamIsHome.value ?? true,
    friendlyPlayerSwitch: settings.friendlyPlayerSwitch,
  };
}
const o66ActingId = computed(() => String((game.value?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? ''));
const o66State = computed(() => {
  const g = game.value;
  if (!g || !settings.order66 || !gameStore.isPlaying.value) return '';
  return deriveClientState(g, o66Ctx());
});
watch(o66State, (state) => {
  if (state === 'BLOCK' || state === 'BLITZ') return;
  classicAttackStage.value = null;
  classicPendingBlockKind.value = null;
  renderer?.showBlockTargets(null);
});
const boundingLeapSkillNow = computed(() => {
  const g = game.value;
  if (!g || !settings.order66 || !gameStore.isPlaying.value) return null;
  return boundingLeapOffer(g, o66Ctx());
});
const o66PendingPunt = ref<[number, number] | null>(null);
function isPuntTargeting(g: { actingPlayer?: unknown }): boolean {
  return String((g.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? '') === 'punt';
}
function puntActingFrom(g: GameJson): { actingId: string; from: [number, number] } | null {
  const actingId = String((g.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
  if (!actingId) return null;
  const from = normSquare((g.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
    .find((d) => d.playerId === actingId)?.playerCoordinate);
  return from ? { actingId, from } : null;
}
function defaultPuntAim(g: GameJson, from: [number, number]): [number, number] | null {
  const targets = serverMoveSquares(g);
  const oppEndzoneX = gameStore.myTeamIsHome.value ? 25 : 0;
  return targets.slice().sort((a, b) => {
    const endzoneA = Math.abs(a[0] - oppEndzoneX), endzoneB = Math.abs(b[0] - oppEndzoneX);
    return endzoneA - endzoneB || Math.abs(a[1] - from[1]) - Math.abs(b[1] - from[1]);
  })[0] ?? null;
}
function puntScatterPreview(from: [number, number], aim: [number, number]): [number, number][] {
  const dx = aim[0] - from[0], dy = aim[1] - from[1];
  if (Math.abs(dx) + Math.abs(dy) !== 1) return [];
  const directions: [number, number][] = [[dx + dy, dy - dx], [dx, dy], [dx - dy, dy + dx]];
  const squares: [number, number][] = [];
  const seen = new Set<string>();
  for (const [sx, sy] of directions) {
    for (let distance = 1; distance <= 6; distance++) {
      const x = from[0] + sx * distance, y = from[1] + sy * distance;
      if (x < 0 || x > 25 || y < 0 || y > 14) break;
      const key = `${x},${y}`;
      if (!seen.has(key)) { seen.add(key); squares.push([x, y]); }
    }
  }
  return squares;
}
watch(() => {
  const g = game.value;
  if (!g || !settings.order66 || !gameStore.isPlaying.value
      || deriveClientState(g, o66Ctx()) !== 'PUNT' || !isPuntTargeting(g)) return null;
  const af = puntActingFrom(g);
  return af ? defaultPuntAim(g, af.from) : null;
}, (aim) => { if (aim && !o66PendingPunt.value) o66PendingPunt.value = aim; }, { immediate: true });
// The acting player's MOVE/Gaze reach, armed as clickable tiles. Gaze stays inert until its target is locked.
const o66MoveSquares = computed<[number, number][]>(() => {
  const g = game.value;
  const st = o66State.value;
  if (!g) return [];
  const swoopSquares = swoopCoordinateSquares(g, o66Ctx());
  if (swoopSquares !== null) return swoopSquares;
  if (st === 'PUNT' && isPuntTargeting(g)) return serverMoveSquares(g);
  if (st === 'FURIOUS_OUTBURST') return serverMoveSquares(g);
  if (st !== 'MOVE' && st !== 'SELECT_BLITZ_TARGET' && !isBlitzMovementState(st) && !isGazeMovementState(st)) return [];
  if (st === 'SELECT_BLITZ_TARGET' && blitzUsedActingSide(g)) return [];
  if (isGazeMovementState(st) && !gameStore.hasLiveGazeIntent()) return [];
  const actingId = o66ActingId.value;
  if (!actingId || !renderer || movesRandomly(g, actingId)) return [];
  return renderer.o66Reach(actingId)?.squares ?? [];
});
// Merged tile-pick sync: kept as a NAMED fn (Punt preview re-syncs it from onMounted), with order-66's
// squarePick/Zap precedence + order66-off passthrough + Furious rush-suppression folded into the body.
let swoopAimArmed = false;
function syncO66MoveSquares(squares: [number, number][]): void {
  if (!renderer) return;
  const squarePick = gameStore.state.squarePick;
  const zapSelected = !!gameStore.state.wizardTargetConfirm && squarePick?.kind === 'wizard' && squarePick.skill === 'Zap';
  const serverPickSquares = zapSelected ? [] : squarePick?.squares ?? [];
  // Punt: drop a staged aim the server no longer offers (aim stays server-derived end to end).
  const g = game.value;
  const swoopTargeting = settings.order66 && !!g && o66State.value === 'SWOOP';
  if (swoopTargeting && squares.length > 0) {
    const actingId = o66ActingId.value;
    const from = actingId ? normSquare((g!.fieldModel.playerDataArray as { playerId: string; playerCoordinate?: unknown }[])
      .find((data) => data.playerId === actingId)?.playerCoordinate) : null;
    renderer.setBncAim(from, squares);
    renderer.setTilePick(false);
    swoopAimArmed = true;
    return;
  }
  if (swoopAimArmed) {
    renderer.setBncAim(null, []);
    swoopAimArmed = false;
  }
  const puntTargeting = settings.order66 && !!g && o66State.value === 'PUNT' && isPuntTargeting(g);
  const pendingPunt = o66PendingPunt.value;
  const puntStillOffered = puntTargeting && !!pendingPunt
    && squares.some((s) => s[0] === pendingPunt[0] && s[1] === pendingPunt[1]);
  if (pendingPunt && !puntStillOffered) o66PendingPunt.value = null;
  if (serverPickSquares.length > 0) {
    renderer.setTilePick(true, serverPickSquares);
  } else if (!settings.order66) {
    // Server-owned coordinate choices (above) remain visible even when Order 66 is disabled.
    // Once that phase ends, clear its marker rather than leaving a stale placement affordance.
    if (!unknownPickingTile.value) renderer.setTilePick(false);
  } else if (squares.length > 0) {
    const actingId = o66ActingId.value;
    const serverCoordinatePick = o66State.value === 'FURIOUS_OUTBURST'
      || (!!g && swoopCoordinateSquares(g, o66Ctx()) !== null);
    const rush = !puntTargeting && !serverCoordinatePick && actingId ? (renderer.o66Reach(actingId)?.rush ?? []) : [];
    renderer.setTilePick(true, squares, serverCoordinatePick ? undefined : 'order66-move', rush, null);
  } else if (!unknownPickingTile.value) {
    // don't stomp the unknown-call coordinate pick — that flow owns the tile-pick while it's armed.
    renderer.setTilePick(false);
  }
}
watch(
  [o66MoveSquares, () => gameStore.state.squarePick?.seq, () => gameStore.state.wizardTargetConfirm?.seq],
  ([squares]) => syncO66MoveSquares(squares),
);

let puntPreviewArmed = false;
function syncPuntPreview(): void {
  if (!renderer) return;
  const g = game.value;
  const aim = o66PendingPunt.value;
  const af = g && o66State.value === 'PUNT' && isPuntTargeting(g) && aim ? puntActingFrom(g) : null;
  if (g && af && aim && serverMoveSquares(g).some((s) => s[0] === aim[0] && s[1] === aim[1])) {
    renderer.setBncAim(af.from, puntScatterPreview(af.from, aim), 'punt');
    puntPreviewArmed = true;
  } else if (puntPreviewArmed) {
    renderer.setBncAim(null, []);
    puntPreviewArmed = false;
  }
}
watch([game, o66State, o66PendingPunt], syncPuntPreview);

const puntConfirm = computed(() => {
  const g = game.value;
  const aim = o66PendingPunt.value;
  if (!g || o66State.value !== 'PUNT' || !isPuntTargeting(g) || !aim
      || !serverMoveSquares(g).some((s) => s[0] === aim[0] && s[1] === aim[1])) return null;
  const af = puntActingFrom(g);
  return af ? { ...af, aim } : null;
});
const puntConfirmButtons: ClassicDialogButton[] = [
  { id: 'confirm', label: 'Confirm Punt', mnemonic: 'P', kind: 'confirm' },
];
function confirmPuntV2(): void {
  const g = game.value;
  if (!g || !isPuntTargeting(g) || !o66PendingPunt.value) return;
  const af = puntActingFrom(g);
  if (!af) return;
  gameStore.sendFieldCoordinate(af.actingId, o66PendingPunt.value);
  o66PendingPunt.value = null;
}
function onPuntConfirm(id: string): void { if (id === 'confirm') confirmPuntV2(); }

const furiousOutburstInstruction = computed(() => {
  const g = game.value;
  if (!g || !gameStore.isPlaying.value || !gameStore.myTurn.value) return null;
  return furiousOutburstCoordinatePrompt(g);
});

// ACTIVE-PLAYER TRACKING (owner 2026-07-06): mirror SpectateView so the renderer
// learns who the active player is (gold §A0 marker/halo) and who has acted this
// turn. The store owns the state (activePlayerId / actedPlayers, incl. the ACTIVE-bit
// + per-turn flush from the 40k fixes); classic was reading NEITHER, so the active
// marker never appeared and push attribution/trail logic had no active player. No
// camera focus (classic's camera is static, autoDirector off).
watch(
  () => gameStore.state.activePlayerId,
  (id) => renderer?.setActivePlayer(id),
);
watch(
  () => gameStore.state.actedPlayers,
  (ids) => renderer?.setActedPlayers(ids ?? []),
  { deep: true },
);

// CLASSIC ALIGNMENT (Pellaeon 2026-07-16, audit G3): CORE render effects SpectateView
// drives via watchers on one-shot store cues — NOT setGame-inherited, so ClassicView
// rendered NOTHING for them (a thrown ball/bomb/team-mate teleported to its landing;
// gaze victims went unmarked). These are always-on CORE rendering (a projectile in
// flight / a confused player must show regardless), so — unlike the OPTIONAL push-arrow
// and turnover flourishes above — they are NOT gated by settings.classicEffects. Each
// calls a shared PitchRenderer method (the same instance + methods SpectateView uses).
// Mirrors SpectateView's throwAnim/bombBlast/ttmHeld/gazeVictims watchers verbatim.
watch(
  () => gameStore.state.passBallHold?.seq ?? 0,
  () => renderer?.setPassBallHold(gameStore.state.passBallHold?.square ?? null),
  { flush: 'sync' },
);
watch(
  () => gameStore.state.throwAnim?.seq,
  () => {
    const t = gameStore.state.throwAnim;
    if (t && renderer) renderer.playThrow(t.kind, t.from, t.to, t.thrownId);
  },
);
watch(
  () => gameStore.state.bombBlast?.seq,
  () => { const b = gameStore.state.bombBlast; if (b && renderer) renderer.playExplosion(b.square); },
);
watch(
  () => gameStore.state.fireballAnim?.seq,
  () => { const f = gameStore.state.fireballAnim; if (f && renderer) renderer.playFireball(f.square, f.sound); },
);
watch(
  () => gameStore.state.ttmHeld?.seq ?? 0,
  () => {
    const h = gameStore.state.ttmHeld;
    if (!renderer) return;
    if (h) renderer.markTtmHeld(h.thrownId, h.throwerId, h.fromSquare);
    else renderer.clearTtmHeld();
  },
);
watch(
  () => gameStore.state.passDestination?.seq ?? 0,
  () => renderer?.setPassDestinationMarker(
    gameStore.state.passDestination?.square ?? null,
    gameStore.state.passDestination?.kind ?? 'ball',
  ),
  { flush: 'sync' },
);
const gazeVictimPresentation = installGazeVictimPresentation(
  () => gameStore.state.gazeVictims,
  () => renderer,
);

// Kickoff ball presentation is core wire parity, so Classic consumes the same server-owned occurrence as Modern.
watch(
  () => gameStore.state.kickScatterPreview?.seq,
  () => {
    const scatter = gameStore.state.kickScatterPreview;
    renderer?.setServerKickoffScatter(scatter ? {
      commandNr: scatter.commandNr, endpoint: scatter.unreducedEndpoint, seq: scatter.seq,
    } : null);
  },
  { flush: 'sync' },
);
watch(
  () => gameStore.state.kickAim?.seq,
  () => {
    const aim = gameStore.state.kickAim;
    if (!aim || !renderer) return;
    renderer.setPendingKickAim(aim.square);
    renderer.showKickTargetPersistent(aim.square, false);
  },
  { flush: 'sync' },
);
watch(() => gameStore.state.kickDescend?.seq, () => renderer?.setKickDescend(gameStore.state.kickDescend));
watch(() => gameStore.state.kickClearSeq, () => renderer?.clearKickAnimation());
watch(
  () => gameStore.state.scatterAnim?.seq,
  () => {
    const scatter = gameStore.state.scatterAnim;
    if (!scatter || !renderer) return;
    renderer.markScatter(scatter.playerId, scatter.path);
    if (scatter.refreshAfterArm) renderer.refresh();
  },
);
watch(
  () => gameStore.state.gazeIntent,
  (intent) => {
    renderer?.setGazeTarget(intent?.phase === 'active' ? intent.victimId : null);
    if (!intent || intent.phase !== 'targetSelected') classicPendingGaze.value = null;
  },
  { deep: true },
);
watch(
  () => gameStore.state.ballDirection?.seq,
  () => renderer?.setBallDirection(gameStore.state.ballDirection ?? null),
);
// CLASSIC ALIGNMENT (Pellaeon 2026-08-12): the server-armed SQUARE-PICK rail. (a) pick-render —
// state.squarePick → crosshair overlay, generic across Trickster/RaidingParty/DumpOff/SafeHands;
// (b) Trickster relocate slide-anim — state.trickster, presentational, plays for any watcher. The
// interaction resolves through onTilePick's squarePick branch above (resolveSquarePick, existing wire).
watch(
  () => gameStore.state.squarePick?.seq,
  () => { const sp = gameStore.state.squarePick; if (renderer) renderer.setTargetSelectPick(sp?.squares ?? null, sp?.skill); },
);
watch(
  () => gameStore.state.trickster?.seq,
  () => { const t = gameStore.state.trickster; if (t && renderer) renderer.markTrickster(t.playerId, t.from, t.to); },
);
// KICK-SQUARE ELECTION + kick animation (re-authored from d50467b6). kickSkill drives the election
// candidates; kickAim/kickDescend/kickClearSeq drive the fly-in→apex→descend arc. Store owns the SR-119
// lockstep (aim→descend same pass, barrier after the pair); the view only renders each cue.
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
const CLASSIC_KICK_HOLD_MS = 1800 + 5000;
watch(
  () => gameStore.state.kickAim?.seq,
  () => {
    const kick = gameStore.state.kickAim;
    if (!kick || !renderer) return;
    renderer.setPendingKickAim(kick.square);
    renderer.showKickTargetPersistent(kick.square);
    if (!gameStore.playbackCatchingUp.value) renderer.holdBallKickIn(CLASSIC_KICK_HOLD_MS);
  },
  { flush: 'sync' },
);
watch(
  () => gameStore.state.kickDescend?.seq,
  () => renderer?.setKickDescend(gameStore.state.kickDescend),
);
watch(
  () => gameStore.state.kickClearSeq,
  () => renderer?.clearKickAnimation(),
);

const turnover = computed(() => (settings.classicEffects ? gameStore.state.turnover : null));

// LIVE-PLAYTEST FIX (owner 2026-07-08, classic-live-playtest-findings.md #3): the
// unknown-call diagnostic panel (an unrecognized server dialog — exactly what a live
// playtest surfaces). ClassicView read none of `state.unknownCall`; classic's log tail
// DOES show the "⚠ UNKNOWN CALL" line the store already logs, so a classic coach wasn't
// COMPLETELY blind, but had no way to describe/export/copy details for a bug report, or
// (in play mode) answer a coordinate-shaped call — the game would just sit stalled with
// no recovery path beyond the log line. Ported a trimmed version of SpectateView's panel
// (no drag-to-move, no screenshot button — those are nice-to-haves; kept copy/export/
// describe/dismiss + the coordinate-pick flow via the same generic renderer.onTilePick).
const unknownPickingTile = ref(false);
const unknownCopyStatus = ref('');
async function copyUnknownDetails() {
  try {
    await navigator.clipboard.writeText(gameStore.unknownCallDetails());
    unknownCopyStatus.value = 'Copied ✓';
  } catch {
    unknownCopyStatus.value = 'Copy failed';
  }
}
function exportUnknownLog() {
  const blob = new Blob([gameStore.exportUnknownCallLog()], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fumbbl40k-unknown-${gameStore.state.unknownCall?.id ?? 'call'}-${Date.now()}.log`;
  a.click();
  URL.revokeObjectURL(url);
}
function armUnknownTilePick() {
  const u = gameStore.state.unknownCall;
  if (!u || !renderer) return;
  unknownPickingTile.value = true;
  renderer.setTilePick(true, u.eligible);
}
watch(() => gameStore.state.unknownCall, (u) => { if (!u) unknownPickingTile.value = false; });

// LIVE-PLAYTEST FIX (owner 2026-07-08, classic-live-playtest-findings.md #1): the store's
// `informationOkay` (case 409) and `defenderAction` (case 359) dialogs surface as passive,
// non-blocking NOTICES (`state.infoNotice` / `state.defenderNotice`) — SpectateView renders
// them on its chat-toast stack, but ClassicView read NEITHER, so a classic coach in a live
// play/spectate game silently never saw a weather-event message or "defender choosing a
// reaction" notice (the game still proceeds fine — the store auto-CLIENT_CONFIRMs
// informationOkay regardless of view — the coach just never sees WHY). These are
// information, not opt-in cinematic flair, so unlike `turnover` they are NOT gated behind
// `settings.classicEffects`. Minimal ephemeral toast stack mirroring SpectateView's 6s
// chat-toast (sender-less, auto-dismiss) rather than the ClassicDialog framework (no user
// action to take).
interface ClassicToast { id: number; text: string }
const classicToasts = ref<ClassicToast[]>([]);
let classicToastId = 0;
const CLASSIC_TOAST_MS = 6000;
function pushClassicToast(text: string) {
  if (!text) return;
  const id = ++classicToastId;
  classicToasts.value.push({ id, text });
  setTimeout(() => {
    classicToasts.value = classicToasts.value.filter((t) => t.id !== id);
  }, CLASSIC_TOAST_MS);
}
watch(
  () => gameStore.state.infoNotice?.seq,
  (seq) => { if (seq) pushClassicToast(gameStore.state.infoNotice?.text ?? ''); },
);
watch(
  () => gameStore.state.defenderNotice?.seq,
  (seq) => { if (seq) pushClassicToast(gameStore.state.defenderNotice?.text ?? ''); },
);

// GAME BROWSER (owner 2026-07-08 fix): the shell Browse button (App.vue) toggles the
// shared `ui.browserOpen`, but the browser MODAL only lived in SpectateView — so
// Browse did nothing in classic. Classic renders its own classic-styled browser here,
// reusing the shared joins (gameStore.connect / connectAsPlayer / loadDemo) + the
// FUMBBL match list. A fetch-on-open + manual refresh (no auto-poll, kept lean).
interface BrowserMatch { id: number; half: number; turn: number; teams: { side: string; name: string; coach: string; race: string; score: number }[] }
const browserMatches = ref<BrowserMatch[]>([]);
const browserStatus = ref('');
const browserFilter = ref('');
const gameId = ref<number | null>(null);
const gameName = ref('');
const isPlayMode = computed(() => props.mode === 'play');
const fumbblPlayBlocked = ref(false);
const filteredMatches = computed(() => {
  const q = browserFilter.value.trim().toLowerCase();
  if (!q) return browserMatches.value;
  return browserMatches.value.filter(
    (m) => String(m.id).includes(q) || m.teams.some((t) => `${t.name} ${t.coach} ${t.race}`.toLowerCase().includes(q)),
  );
});
async function refreshBrowser(): Promise<void> {
  if (settings.activeServerTarget !== 'fumbbl') {
    browserMatches.value = [];
    browserStatus.value = 'The local Super FUMBBL server has no live-game list — enter a Game id and Spectate, or Load demo.';
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
function setBrowserServer(id: string): void {
  if (settings.activeServerTarget === id) return;
  applyServerTarget(id);
  fumbblPlayBlocked.value = false;
  void refreshBrowser();
}
function connectSpectate(): void {
  if (!gameId.value) return;
  ui.browserOpen = false;
  gameStore.connect({ url: settings.url, compression: settings.compression, ...resolveJoinCreds(), gameId: Number(gameId.value) });
}
function joinPlay(): void {
  // owner ruling 2026-08-17: official fumbbl.com replay+live permitted.
  const name = gameName.value.trim();
  if (!name) return;
  ui.browserOpen = false;
  const target = activeServerTarget();
  const creds = resolveJoinCreds();
  void gameStore.connectAsPlayer({ url: target.url, compression: target.compression, coach: creds.coach, password: creds.password, gameName: name, teamId: '' });
}
function spectateMatch(id: number): void { gameId.value = id; connectSpectate(); }
watch(() => ui.browserOpen, (open) => { if (open) void refreshBrowser(); });
</script>

<template>
  <div ref="classicView" class="classic-view" :style="presentationCssVars">
    <!-- Classic GameMenuBar equivalent (FC2 fills this in) -->
    <header class="cv-menubar">
      <span class="cv-title">FUMBBL Classic</span>
      <span class="cv-badge">preview — {{ layoutName }} layout</span>
      <span class="cv-spacer" />
      <button class="cv-menu-btn" title="Switch back to the Super FUMBBL UI" @click="backToDefault">Exit Classic mode</button>
    </header>

    <div v-if="gameStore.state.opponentChoicePending" class="cv-opponent-decision-pill"
      role="status" aria-live="polite">{{ gameStore.state.opponentChoicePending }}</div>

    <div class="cv-body" :data-layout="layout">
      <!-- LEFT SIDEBAR = HOME. Owner order (2026-07-08): player-detail/box (~1/3),
           then Reserves/Out + End Turn buttons + turn/dice, then re-rolls with
           inducements alongside at the bottom. -->
      <aside class="cv-sidebar" data-side="home">
        <div class="cv-banner" data-side="home">
          <img class="cv-banner-crest" :src="homeLogo" alt="" />
          <div class="cv-banner-txt">
            <div class="cv-banner-name">{{ home.teamName || 'Home' }}</div>
            <div class="cv-banner-coach">{{ home.coach || '' }}</div>
          </div>
        </div>
        <div class="cv-detail">
          <div v-if="boxViewHome !== 'detail'" class="cv-dugout">
            <div v-for="sec in homeBoxSections" :key="sec.key" class="cv-dg-block" :data-view="boxViewHome">
              <div class="cv-dg-sec">{{ sec.header }}</div>
              <div class="cv-dg-grid">
                <span v-for="p in sec.players" :key="p.id" class="cv-dg-tile" :data-player-id="p.id"
                  :title="(p.nr != null ? '#' + p.nr + ' ' : '') + p.name + (p.pos ? ' — ' + p.pos : '')">
                  <img v-if="boxPortrait(p.id, p.state)" :src="boxPortrait(p.id, p.state)!" alt="" class="cv-dg-sprite" />
                  <span v-else class="cv-dg-nr">{{ p.nr != null ? p.nr : '•' }}</span>
                </span>
              </div>
            </div>
          </div>
          <div v-else-if="detailCardHome" class="cv-card" :data-side="detailCardHome.side">
            <div class="cv-card-name">{{ detailCardHome.name }}</div>
            <div class="cv-card-portrait">
              <img v-if="selectedPortrait" :src="selectedPortrait" alt="" />
              <span v-else class="cv-card-noportrait">no portrait</span>
            </div>
            <div class="cv-card-pos">{{ detailCardHome.positionName }} #{{ detailCardHome.nr }}</div>
            <div class="cv-card-type">{{ detailCardHome.typeLine }}</div>
            <div class="cv-card-stats">
              <span v-for="s in detailCardHome.stats" :key="s.label" class="cv-card-stat"><b>{{ s.label }}</b>{{ s.value }}</span>
            </div>
            <div class="cv-card-level">{{ detailCardHome.spp }} {{ sppTitle(detailCardHome.spp) }}</div>
            <div class="cv-card-skills" role="list" aria-label="Player skills">
              <span v-for="sk in detailCardHome.skills" :key="`${sk.name}:${sk.label}`" class="cv-card-skill"
                :class="settings.skillDisplay === 'markings' ? playerSkillCategoryClass(sk.name) : undefined"
                :data-added="sk.added" :title="sk.label" role="listitem">{{ sk.label }}</span>
              <span v-if="!detailCardHome.skills.length" class="cv-card-noskill">No skills</span>
            </div>
          </div>
          <div v-else class="cv-detail-empty">Click a player</div>
        </div>
        <div class="cv-mid">
          <div class="cv-boxbtns">
            <button class="cv-btn" type="button" :data-active="boxViewHome === 'reserves'" @click="toggleBox('home', 'reserves')">Reserves ({{ homeStats.rsv }})</button>
            <button class="cv-btn" type="button" :data-active="boxViewHome === 'out'" @click="toggleBox('home', 'out')">Out ({{ homeStats.out }})</button>
          </div>
          <button class="cv-btn cv-endturn" type="button" :disabled="!canEndTurn || !homePlaying"
            :title="!canEndTurn ? 'Spectators cannot end turns' : homePlaying ? 'End the current turn' : 'Not this team\'s turn'"
            @click="endTurn()">End Turn</button>
          <button class="cv-status" type="button" :data-playing="homePlaying"
            :title="homePlaying ? 'Home is playing' : 'Waiting for the opponent'">
            <span class="cv-status-lead">{{ homePlaying ? '▸ Playing…' : 'Waiting' }}</span>
            <span class="cv-status-sub">{{ homePlaying && actingName ? actingName : (turn.nr ? 'Turn ' + turn.nr : '—') }}</span>
          </button>
        </div>
        <div class="cv-resbar">
          <div class="cv-res-tokens" :title="'Team re-rolls: ' + homeStats.rerolls + ' of ' + homeStats.rerollTotal">
            <img v-for="i in Math.min(homeStats.rerollTotal, 8)" :key="i" class="cv-res-tok" :src="rerollIcon" alt="" :data-used="i > homeStats.rerolls" />
            <span v-if="!homeStats.rerollTotal" class="cv-res-none">no re-rolls</span>
            <span v-else-if="homeStats.rerollTotal > 8" class="cv-res-x">×{{ homeStats.rerollTotal }}</span>
          </div>
          <div class="cv-res-icons">
            <span class="cv-res-item" :data-empty="!homeStats.apo" :title="'Apothecaries: ' + homeStats.apo">
              <img class="cv-res-tok" :src="apoIcon" alt="apothecary" /><b>{{ homeStats.apo }}</b>
            </span>
            <span class="cv-res-item cv-res-gold" :title="'Treasury: ' + homeStats.gold + ' gp'">💰<b>{{ goldLabel(homeStats.gold) }}</b></span>
            <span v-if="homeStats.inducementCount" class="cv-res-item" :title="'Active inducements: ' + homeStats.inducementCount">🎲<b>{{ homeStats.inducementCount }}</b></span>
          </div>
        </div>
      </aside>

      <!-- FIELD (FC1): the shared renderer with the classic preset -->
      <main class="cv-field">
        <div ref="pitchHost" class="cv-field-canvas" />
        <div v-if="blitzTargetMarker" class="cv-blitz-target"
          :style="{ left: blitzTargetMarker.x + 'px', top: blitzTargetMarker.y + 'px' }">🎯</div>
        <!-- KICK-SQUARE ELECTION (re-authored from d50467b6): server-square candidates; the coach
             elects normal vs Kick-skill landing. Off-pitch candidates get boundary markers. -->
        <button v-for="target in kickElectionTargets" :key="`${target.key}:${target.choice}`"
          class="cv-kick-election"
          :class="{ reduced: target.choice === 'kick', boundary: !target.onPitch, icon: target.iconOnly }"
          :style="{ left: target.x + 'px', top: target.y + 'px' }"
          :aria-label="`${target.label} landing at ${target.raw[0]}, ${target.raw[1]}`"
          :title="`${target.label} landing [${target.raw[0]},${target.raw[1]}]`"
          @click.stop="chooseKickElection(target)">
          <template v-if="target.choice === 'kick'">
            <img v-if="kickElectionIconUrl && !kickElectionIconFailed" :src="kickElectionIconUrl" alt="Kick"
              @error="kickElectionIconFailed = true" />
            <span v-else class="cv-kick-k">K</span>
            <span v-if="!target.onPitch">Kick</span>
          </template>
          <span v-else-if="!target.onPitch">Normal</span>
        </button>
        <!-- PRE-KICKOFF CINES (Pellaeon 2026-08-12, owner FC-D3 reversal): store-driven,
             self-clearing overlays ported from SpectateView; static camera (no zoom).
             z-index band 45-47 is free in Classic (existing overlays top out at 41). -->
        <div v-if="gameStore.state.coinToss" class="coin-toss" :class="{ 'cine-hold': settings.clickDismissCinematics }">
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
        <div v-if="gameStore.state.weatherCine" class="weather-cine" :class="{ 'cine-hold': settings.clickDismissCinematics }">
          <div class="wc-title">Weather Roll</div>
          <div class="wc-dice">
            <div class="wc-die from-north">
              <span v-for="(on, i) in pipPattern(gameStore.state.weatherCine.roll[0] ?? 0)" :key="i" class="pip" :data-on="on"></span>
            </div>
            <div class="wc-die from-south">
              <span v-for="(on, i) in pipPattern(gameStore.state.weatherCine.roll[1] ?? 0)" :key="i" class="pip" :data-on="on"></span>
            </div>
          </div>
          <div class="wc-caption">
            <span class="wc-icon">{{ weatherEmoji(gameStore.state.weatherCine.weather) }}</span>
            <span class="wc-weather">{{ gameStore.state.weatherCine.weather }}</span>
          </div>
        </div>
        <div v-if="gameStore.state.dodgySnackCine" class="weather-cine" :class="{ 'cine-hold': settings.clickDismissCinematics }">
          <div class="wc-title">Dodgy Snack</div>
          <div class="wc-dice">
            <div class="wc-die from-north">
              <span v-for="(on, i) in pipPattern(gameStore.state.dodgySnackCine.rollHome)" :key="i" class="pip" :data-on="on"></span>
            </div>
            <div class="wc-die from-south">
              <span v-for="(on, i) in pipPattern(gameStore.state.dodgySnackCine.rollAway)" :key="i" class="pip" :data-on="on"></span>
            </div>
          </div>
          <div class="wc-caption"><span class="wc-icon">🤢</span><span class="wc-weather">Dodgy Snack</span></div>
        </div>
        <div v-if="gameStore.state.kickoffCine" class="kickoff-cine" :class="{ 'cine-hold': settings.clickDismissCinematics }">
          <div class="ko-dice">
            <div class="ko-die">
              <span v-for="(on, i) in pipPattern(gameStore.state.kickoffCine.roll[0] ?? 0)" :key="i" class="pip" :data-on="on"></span>
            </div>
            <div class="ko-die">
              <span v-for="(on, i) in pipPattern(gameStore.state.kickoffCine.roll[1] ?? 0)" :key="i" class="pip" :data-on="on"></span>
            </div>
          </div>
          <img v-if="gameStore.state.kickoffCine.img" :src="gameStore.state.kickoffCine.img" class="ko-splash" alt="" />
          <div v-else class="ko-name-big">{{ gameStore.state.kickoffCine.result }}</div>
        </div>
        <div v-if="gameStore.state.fanFactorCine" class="fan-cine" :class="{ 'cine-hold': settings.clickDismissCinematics }">
          <div class="fan-rolls">
            <div class="fan-side home" :data-leader="gameStore.state.fanFactorCine.leader === 'home'">
              <div class="fan-coach">{{ gameStore.state.fanFactorCine.homeCoach }}</div>
              <div class="wc-die d3">
                <span v-for="(on, i) in pipPattern(gameStore.state.fanFactorCine.home.roll)" :key="i" class="pip" :data-on="on"></span>
              </div>
              <div class="fan-math">{{ gameStore.state.fanFactorCine.home.fans }} fans + {{ gameStore.state.fanFactorCine.home.roll }}
                = <b>{{ gameStore.state.fanFactorCine.home.total }}</b></div>
            </div>
            <div class="fan-side away" :data-leader="gameStore.state.fanFactorCine.leader === 'away'">
              <div class="fan-coach">{{ gameStore.state.fanFactorCine.awayCoach }}</div>
              <div class="wc-die d3">
                <span v-for="(on, i) in pipPattern(gameStore.state.fanFactorCine.away.roll)" :key="i" class="pip" :data-on="on"></span>
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
        <!-- Click-to-skip catcher (click-dismiss mode; dodgySnack self-times, excluded by cineShowing). -->
        <div v-if="gameStore.cineShowing.value" class="cine-dismiss" @click="gameStore.dismissCine()">
          <span class="cine-dismiss-hint">Click to Skip</span>
        </div>
        <div v-if="!hasGame" class="cv-field-overlay">
          <p>Not connected — open <b>Browse</b> to spectate a game.</p>
          <p class="cv-hint">FUMBBL Classic shares the same game state as the default UI.</p>
        </div>
        <!-- Right-click Block context menu (block-dice preview over opponents). -->
        <div v-if="ctxMenu" class="cv-ctx-backdrop" @click="closeCtxMenu" @contextmenu.prevent="closeCtxMenu" />
        <div v-if="ctxMenu" class="cv-ctxmenu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
          <button v-for="choice in classicTargetAttackChoices" :key="choice.kind ?? 'block'" class="cv-ctx-item"
            type="button" @click="armClassicTargetAttack(choice.kind)">{{ choice.label }}</button>
          <!-- G1b: the server-derived declare set for this player (availableActions) — existing-wire senders. -->
          <button v-for="(a, i) in (classicTargetAttackChoices.length ? [] : ctxActions)" :key="i" class="cv-ctx-item" type="button"
            :disabled="!a.enabled" :title="!a.enabled && a.reason ? a.reason : ''" @click="runClassicAction(a)">{{ a.label }}</button>
          <!-- Opponent block-dice preview utility (kept; shown when the clicked player has no declare set). -->
          <button v-if="!classicTargetAttackChoices.length && !ctxActions.length" class="cv-ctx-item" type="button" @click="ctxShowBlockDice">Show block dice</button>
        </div>
        <BlockAttackConfirmModal v-if="classicAttackConfirm" :preview="classicAttackConfirm.preview"
          :target-name="classicAttackConfirm.targetName"
          @confirm="confirmClassicTargetAttack()"
          @cancel="classicAttackStage = null; renderer?.showBlockTargets(null)" />
      </main>

      <!-- RIGHT SIDEBAR = AWAY. Same order as the home side. -->
      <aside class="cv-sidebar" data-side="away">
        <div class="cv-banner" data-side="away">
          <img class="cv-banner-crest" :src="awayLogo" alt="" />
          <div class="cv-banner-txt">
            <div class="cv-banner-name">{{ away.teamName || 'Away' }}</div>
            <div class="cv-banner-coach">{{ away.coach || '' }}</div>
          </div>
        </div>
        <div class="cv-detail">
          <div v-if="boxViewAway !== 'detail'" class="cv-dugout">
            <div v-for="sec in awayBoxSections" :key="sec.key" class="cv-dg-block" :data-view="boxViewAway">
              <div class="cv-dg-sec">{{ sec.header }}</div>
              <div class="cv-dg-grid">
                <span v-for="p in sec.players" :key="p.id" class="cv-dg-tile" :data-player-id="p.id"
                  :title="(p.nr != null ? '#' + p.nr + ' ' : '') + p.name + (p.pos ? ' — ' + p.pos : '')">
                  <img v-if="boxPortrait(p.id, p.state)" :src="boxPortrait(p.id, p.state)!" alt="" class="cv-dg-sprite" />
                  <span v-else class="cv-dg-nr">{{ p.nr != null ? p.nr : '•' }}</span>
                </span>
              </div>
            </div>
          </div>
          <div v-else-if="detailCardAway" class="cv-card" :data-side="detailCardAway.side">
            <div class="cv-card-name">{{ detailCardAway.name }}</div>
            <div class="cv-card-portrait">
              <img v-if="selectedPortrait" :src="selectedPortrait" alt="" />
              <span v-else class="cv-card-noportrait">no portrait</span>
            </div>
            <div class="cv-card-pos">{{ detailCardAway.positionName }} #{{ detailCardAway.nr }}</div>
            <div class="cv-card-type">{{ detailCardAway.typeLine }}</div>
            <div class="cv-card-stats">
              <span v-for="s in detailCardAway.stats" :key="s.label" class="cv-card-stat"><b>{{ s.label }}</b>{{ s.value }}</span>
            </div>
            <div class="cv-card-level">{{ detailCardAway.spp }} {{ sppTitle(detailCardAway.spp) }}</div>
            <div class="cv-card-skills" role="list" aria-label="Player skills">
              <span v-for="sk in detailCardAway.skills" :key="`${sk.name}:${sk.label}`" class="cv-card-skill"
                :class="settings.skillDisplay === 'markings' ? playerSkillCategoryClass(sk.name) : undefined"
                :data-added="sk.added" :title="sk.label" role="listitem">{{ sk.label }}</span>
              <span v-if="!detailCardAway.skills.length" class="cv-card-noskill">No skills</span>
            </div>
          </div>
          <div v-else class="cv-detail-empty">Click a player</div>
        </div>
        <div class="cv-mid">
          <div class="cv-boxbtns">
            <button class="cv-btn" type="button" :data-active="boxViewAway === 'reserves'" @click="toggleBox('away', 'reserves')">Reserves ({{ awayStats.rsv }})</button>
            <button class="cv-btn" type="button" :data-active="boxViewAway === 'out'" @click="toggleBox('away', 'out')">Out ({{ awayStats.out }})</button>
          </div>
          <button class="cv-btn cv-endturn" type="button" :disabled="!canEndTurn || homePlaying"
            :title="!canEndTurn ? 'Spectators cannot end turns' : !homePlaying ? 'End the current turn' : 'Not this team\'s turn'"
            @click="endTurn()">End Turn</button>
          <button class="cv-status" type="button" :data-playing="!homePlaying"
            :title="!homePlaying ? 'Away is playing' : 'Waiting for the opponent'">
            <span class="cv-status-lead">{{ !homePlaying ? '▸ Playing…' : 'Waiting' }}</span>
            <span class="cv-status-sub">{{ !homePlaying && actingName ? actingName : (turn.nr ? 'Turn ' + turn.nr : '—') }}</span>
          </button>
        </div>
        <div class="cv-resbar">
          <div class="cv-res-tokens" :title="'Team re-rolls: ' + awayStats.rerolls + ' of ' + awayStats.rerollTotal">
            <img v-for="i in Math.min(awayStats.rerollTotal, 8)" :key="i" class="cv-res-tok" :src="rerollIcon" alt="" :data-used="i > awayStats.rerolls" />
            <span v-if="!awayStats.rerollTotal" class="cv-res-none">no re-rolls</span>
            <span v-else-if="awayStats.rerollTotal > 8" class="cv-res-x">×{{ awayStats.rerollTotal }}</span>
          </div>
          <div class="cv-res-icons">
            <span class="cv-res-item" :data-empty="!awayStats.apo" :title="'Apothecaries: ' + awayStats.apo">
              <img class="cv-res-tok" :src="apoIcon" alt="apothecary" /><b>{{ awayStats.apo }}</b>
            </span>
            <span class="cv-res-item cv-res-gold" :title="'Treasury: ' + awayStats.gold + ' gp'">💰<b>{{ goldLabel(awayStats.gold) }}</b></span>
            <span v-if="awayStats.inducementCount" class="cv-res-item" :title="'Active inducements: ' + awayStats.inducementCount">🎲<b>{{ awayStats.inducementCount }}</b></span>
          </div>
        </div>
      </aside>

      <!-- Log · Scoreboard · Chat. SQUARE stacks them in a far-right column;
           LANDSCAPE puts the scoreboard as a bottom strip with Log/Chat below the
           field. Same DOM, re-placed by the grid-area template per layout. -->
      <div class="cv-log">
        <div class="cv-log-head"><span>Game log</span><LogFontSelect /></div>
        <div class="cv-log-body" :style="classicLogTextStyle">
          <div v-for="(e, i) in logTail" :key="i" class="cv-log-line" :data-kind="e.kind"><template v-for="(part, j) in d6LogParts(e)" :key="j"><D6Face v-if="part.face" class="cv-log-d6" :value="part.face" variant="black" :label="`${part.kind === 'target' ? 'Needed' : 'Rolled'} ${part.face}`" /><template v-else>{{ part.text }}</template></template></div>
          <div v-if="!logTail.length" class="cv-log-empty">No events yet.</div>
        </div>
      </div>
      <div class="cv-scoreboard">
        <div class="cv-sb-turn" v-if="turn.nr">Turn {{ turn.nr }} of {{ halfLabel }}</div>
        <div class="cv-sb-score">
          <span class="home">HOME {{ score.home }}</span>
          <span class="away">{{ score.away }} AWAY</span>
        </div>
        <div class="cv-sb-spec" v-if="spectators != null">👁 {{ spectators }}</div>
      </div>
      <div class="cv-chat">
        <div class="cv-log-head"><span>Chat</span><LogFontSelect /></div>
        <div class="cv-log-body" :style="classicLogTextStyle">
          <div v-for="(e, i) in chatTail" :key="i" class="cv-chat-line">{{ e.text }}</div>
          <div v-if="!chatTail.length" class="cv-log-empty">No chat yet.</div>
        </div>
      </div>
    </div>

    <!-- FC4 replay-control strip STUB (FC-D5: real replay is scoped separately;
         these mirror the classic client's REPLAY_CONTROL row, inert for now). -->
    <footer class="cv-replay">
      <button class="cv-rp-btn" type="button" disabled title="Jump to start">⏮</button>
      <button class="cv-rp-btn" type="button" disabled title="Step back">◀</button>
      <button class="cv-rp-btn" type="button" disabled title="Play / pause">▶</button>
      <button class="cv-rp-btn" type="button" disabled title="Step forward">▶</button>
      <button class="cv-rp-btn" type="button" disabled title="Jump to end">⏭</button>
      <span class="cv-rp-note">Replay controls — coming soon</span>
    </footer>

    <!-- BB2025 High Kick (Classic): every server-offered nominee is reachable as a chip (and by clicking the
         player on the pitch); Confirm flushes the staged CLIENT_SETUP_PLAYER then CLIENT_END_TURN, Decline
         sends the bare End Turn. Nothing goes on the wire while a nominee is merely staged. -->
    <div v-if="highKickPhase" class="cv-setup" aria-label="High Kick">
      <div class="cv-setup-title">High Kick</div>
      <div class="cv-setup-note">
        <span v-if="highKickPhase.landing">Ball lands at {{ highKickPhase.landing[0] }},{{ highKickPhase.landing[1] }} — nominate one open player to move under it.</span>
        <span v-else>Waiting for the ball to land…</span>
      </div>
      <div class="cv-setup-reslabel">Eligible ({{ highKickPhase.nomineeIds.length }})</div>
      <div class="cv-setup-reserves">
        <button v-for="id in highKickPhase.nomineeIds" :key="id" class="cv-setup-chip" type="button"
          :data-sel="highKickPhase.pendingId === id" @click="nominateHighKick(id)">{{ playerLabel(id) }}</button>
        <span v-if="!highKickPhase.nomineeIds.length" class="cv-setup-empty">— no eligible player —</span>
      </div>
      <div class="cv-setup-actions">
        <button class="cv-setup-btn done" type="button" :disabled="!highKickPhase.pendingId"
          @click="gameStore.highKickConfirm()">Confirm</button>
        <button class="cv-setup-btn" type="button" @click="gameStore.highKickDecline()">Decline</button>
      </div>
    </div>

    <!-- BB2025 Quick Snap (Classic): candidate chips + the same legal-square crosshairs Modern draws, then the
         explicit clientEndTurn{quickSnap} close. Controls differ from Modern; the wire is identical. -->
    <div v-if="quickSnapPhase" class="cv-setup" aria-label="Quick Snap">
      <div class="cv-setup-title">Quick Snap</div>
      <div v-if="quickSnapStatus" class="cv-setup-note">
        Moved {{ quickSnapStatus.moved }} / {{ quickSnapStatus.allowed }}<span
          v-if="quickSnapStatus.available !== null"> · {{ quickSnapStatus.available }} open</span>
      </div>
      <div v-if="quickSnapStatus?.exhausted" class="cv-setup-note" data-quick-snap-exhausted>{{ quickSnapStatus.exhausted }}</div>
      <div class="cv-setup-reslabel">Open players ({{ quickSnapPhase.players.length }}) — click one, then a highlighted square</div>
      <div class="cv-setup-reserves">
        <button v-for="p in quickSnapPhase.players" :key="p.playerId" class="cv-setup-chip" type="button"
          :data-sel="selectedQuickSnap === p.playerId" @click="selectQuickSnapPlayer(p.playerId)">{{ playerLabel(p.playerId) }}</button>
        <span v-if="!quickSnapPhase.players.length" class="cv-setup-empty">— no open players —</span>
      </div>
      <div class="cv-setup-actions">
        <button class="cv-setup-btn done" type="button" @click="gameStore.quickSnapConfirm()">Done</button>
      </div>
    </div>

    <!-- FC3 interactive team setup — validation + reserves + actions; the pitch
         shows the zone shading and takes the placements (renderer). -->
    <div v-if="setupPhase" class="cv-setup">
      <div class="cv-setup-title">{{ solidDefenceSetup ? 'Solid Defence — re-set up' : 'Set up your team' }}</div>
      <!-- StepApplyKickoffResult.handleSolidDefense: only the server-selected players may move. -->
      <div v-if="solidDefenceSetup" class="cv-setup-note" data-solid-defence>
        Only your {{ solidDefenceMovableCount }} selected player<span v-if="solidDefenceMovableCount !== 1">s</span> may be moved.
      </div>
      <div v-if="solidDefenceError" class="cv-setup-note" data-solid-defence-error role="alert">
        Rejected: you moved {{ solidDefenceError.amount }} rather than the allowed {{ solidDefenceError.limit }}.
        <button class="cv-setup-btn" type="button" @click="gameStore.dismissSolidDefenceError()">Dismiss</button>
      </div>
      <div v-if="setupPhase.setupErrors.length" class="cv-setup-note" data-setup-error role="alert">
        <b>Setup rejected.</b> Correct the formation and press Done again.
        <ul>
          <li v-for="message in setupPhase.setupErrors" :key="message">{{ message }}</li>
        </ul>
      </div>
      <ul class="cv-setup-cond">
        <li :data-ok="setupPhase.validation.losOk">{{ setupPhase.validation.losOk ? '✓' : '✗' }} At least 3 on the line ({{ setupPhase.validation.onLos }}/3)</li>
        <li :data-ok="setupPhase.validation.leftOk">{{ setupPhase.validation.leftOk ? '✓' : '✗' }} ≤2 in the left wide zone ({{ setupPhase.validation.leftWide }})</li>
        <li :data-ok="setupPhase.validation.rightOk">{{ setupPhase.validation.rightOk ? '✓' : '✗' }} ≤2 in the right wide zone ({{ setupPhase.validation.rightWide }})</li>
        <li :data-ok="setupPhase.validation.countOk">{{ setupPhase.validation.countOk ? '✓' : '✗' }} Placed {{ setupPhase.validation.placed }}/{{ setupPhase.validation.required }}</li>
      </ul>
      <div class="cv-setup-reslabel">Reserves ({{ setupReserves.length }}) — click, then a square</div>
      <div class="cv-setup-reserves">
        <button v-for="p in setupReserves" :key="p.playerId" class="cv-setup-chip" type="button"
          :data-sel="selectedSetupPlayerId === p.playerId" @click="selectSetupPlayer(p.playerId)"><b>{{ p.nr }}</b> {{ p.posName || p.name }}</button>
        <span v-if="!setupReserves.length" class="cv-setup-empty">— all placed —</span>
      </div>
      <div class="cv-setup-actions">
        <button class="cv-setup-btn" type="button" :disabled="!selectedSetupPlayerId" @click="returnSelectedToReserve">↩ Reserve</button>
        <!-- Auto-fill deprecated (owner 08-13; SpectateView twin 184dc1ba) — templates + Saved Setups are the fill path. store.setupAutoFill retained for template apply. -->
        <button class="cv-setup-btn done" type="button" :disabled="!setupPhase.validation.valid" @click="gameStore.setupSubmit()">Done</button>
        <button v-if="setupPhase.validation.canConcede" class="cv-setup-btn concede" type="button" @click="gameStore.setupConcede()">Concede</button>
      </div>
    </div>

    <!-- FC3 pitch-anchored player-pick bar (crosshairs are drawn on the pitch by
         the renderer; this is the prompt + confirm/decline). Suppressed for MVP
         nomination — that routes to the dedicated roster-list modal below (its
         candidates are often off-pitch, which the crosshair pick can't reach). -->
    <div v-if="playerPick && !mvpNomination && !rosterPickModal" class="cv-pickbar">
      <span class="cv-pick-prompt">{{ playerPick.prompt }}</span>
      <span v-if="playerPick.confirm && playerPick.maxPicks > 1" class="cv-pick-count">{{ playerPick.picked.length }}/{{ playerPick.maxPicks }}</span>
      <button v-if="playerPick.confirm" class="cv-pick-btn confirm" type="button"
        :disabled="playerPick.picked.length < playerPick.minPicks || playerPick.picked.length === 0"
        @click="gameStore.confirmPlayerPick()">Confirm</button>
      <button v-if="playerPick.declinable" class="cv-pick-btn decline" type="button"
        @click="gameStore.resolvePlayerPick(null)">Decline</button>
    </div>

    <div v-if="furiousOutburstInstruction" class="cv-pickbar" role="status" aria-label="Furious Outburst square selection">
      <b>Furious Outburst</b>
      <span class="cv-pick-prompt">{{ furiousOutburstInstruction }}</span>
      <button class="cv-pick-btn decline" type="button" @click="gameStore.endActivation()">Finish</button>
    </div>

    <!-- Owner audit 08-17 (P1): generic off-pitch roster picker — Iron Man/Knuckle Dusters (and
         any future off-pitch playerChoice) get a guaranteed-reachable list surface here, since
         Classic's renderer has no dugout tokens to tap. Same wire as the MVP modal above. -->
    <div v-if="rosterPickModal" class="cv-browse-backdrop" role="dialog" aria-modal="true">
      <EligibleRosterPicker theme="classic" :prompt="rosterPickModal.prompt" :candidates="rosterPickModal.candidates"
        :picked="rosterPickModal.picked" :min="rosterPickModal.min" :max="rosterPickModal.max"
        :declinable="rosterPickModal.declinable" @pick="gameStore.resolvePlayerPick($event)"
        @confirm="gameStore.confirmPlayerPick()" @decline="gameStore.resolvePlayerPick(null)" />
    </div>

    <!-- CLASSIC ALIGNMENT (Pellaeon 2026-07-16, audit G2a): MVP nomination roster modal.
         The server drives it on the shared state.playerPick rail (mode 'mvp'); candidates
         are often off-pitch, so this LIST (not pitch crosshairs) is the surface. Click a
         candidate to toggle (resolvePlayerPick), Confirm commits (confirmPlayerPick →
         CLIENT_PLAYER_CHOICE). Non-declinable. Copy mirrors the FUMBBL client. -->
    <div v-if="mvpNomination" class="cv-browse-backdrop" role="dialog" aria-modal="true">
      <div class="cv-mvp">
        <div class="cv-mvp-title">Nominate {{ mvpNomination.max }} for the MVP</div>
        <div class="cv-mvp-sub">Choose {{ mvpNomination.max }} of your players — one is awarded the MVP.</div>
        <ul class="cv-mvp-list">
          <li v-for="c in mvpNomination.candidates" :key="c.id">
            <button type="button" class="cv-mvp-cand" :data-sel="mvpNomination.picked.includes(c.id)"
              @click="gameStore.resolvePlayerPick(c.id)">
              <b class="cv-mvp-nr">{{ c.nr == null ? '—' : c.nr }}</b>
              <span class="cv-mvp-name">{{ c.name }}</span>
              <span class="cv-mvp-pos">{{ c.pos }}</span>
              <span class="cv-mvp-check">{{ mvpNomination.picked.includes(c.id) ? '✓' : '' }}</span>
            </button>
          </li>
        </ul>
        <div class="cv-mvp-foot">
          <span class="cv-mvp-count">{{ mvpNomination.picked.length }}/{{ mvpNomination.max }} nominated</span>
          <button type="button" class="cv-conn-btn primary cv-mvp-confirm"
            :disabled="mvpNomination.picked.length < mvpNomination.min"
            @click="gameStore.confirmPlayerPick()">Confirm</button>
        </div>
      </div>
    </div>

    <!-- endgame twin (re-authored from 6f779352): phase status banner during the endGame
         sequence, before the final panel authorizes (finalPresentationReady). -->
    <div v-if="gameOver && !finalPresentationReady" class="cv-endgame-phase" role="status">
      {{ endGamePhaseLabel }}
    </div>

    <!-- CLASSIC ALIGNMENT (Pellaeon 2026-07-16, audit G3): BB2025 extra-time PENALTY
         SHOOTOUT summary. The server auto-rolls the whole best-of-5 roll-off (the client
         makes ZERO inputs) — display-only + a single Confirm (mutual dismiss; the server
         waits for BOTH coaches). home* = MY team (per-recipient mirror). ClassicView read
         NONE of state.penaltyShootout, so extra-time showed nothing in classic. Classic-
         styled modal reusing the cv-browse-backdrop; mirrors SpectateView's panel. -->
    <div v-if="gameStore.state.penaltyShootout" class="cv-browse-backdrop" role="dialog" aria-modal="true">
      <div class="cv-ps">
        <div class="cv-ps-title">Penalty Shootout</div>
        <div class="cv-ps-score">
          <span class="cv-ps-team" :data-win="gameStore.state.penaltyShootout.homeWins">{{ gameStore.state.penaltyShootout.homeName }}</span>
          <span class="cv-ps-tally">{{ gameStore.state.penaltyShootout.scoreHome }} – {{ gameStore.state.penaltyShootout.scoreAway }}</span>
          <span class="cv-ps-team" :data-win="!gameStore.state.penaltyShootout.homeWins">{{ gameStore.state.penaltyShootout.awayName }}</span>
        </div>
        <ol class="cv-ps-rounds">
          <li v-for="(r, i) in gameStore.state.penaltyShootout.rounds" :key="i" class="cv-ps-round">
            <span class="cv-ps-round-label">{{ r.label }}</span>
            <D6Face class="cv-ps-roll" :data-win="r.homeWon" :value="r.home" :label="`${gameStore.state.penaltyShootout.homeName} rolled ${r.home}`" />
            <span class="cv-ps-vs">vs</span>
            <D6Face class="cv-ps-roll" :data-win="!r.homeWon" :value="r.away" :label="`${gameStore.state.penaltyShootout.awayName} rolled ${r.away}`" />
            <span class="cv-ps-round-win">{{ r.homeWon ? gameStore.state.penaltyShootout.homeName : gameStore.state.penaltyShootout.awayName }}</span>
          </li>
        </ol>
        <div class="cv-ps-result">
          {{ gameStore.state.penaltyShootout.homeWins ? gameStore.state.penaltyShootout.homeName : gameStore.state.penaltyShootout.awayName }} wins the shootout
        </div>
        <button class="cv-conn-btn primary cv-ps-confirm" type="button" @click="gameStore.confirmPenaltyShootout()">{{ gameStore.isPlaying.value ? 'Proceed to MVPs and upload' : 'Close' }}</button>
      </div>
    </div>

    <!-- CLASSIC ALIGNMENT (Pellaeon 2026-07-16, audit G2b): PERMANENT end-game result panel
         over the cleared board (owner 2026-07-15). Server-authoritative off gameResult;
         gated on the server's endGame/finished + endGameSettled (all rolls/anims rendered),
         and shown only AFTER any MVP nomination/pick completes. No auto-dismiss — it clears
         when a fresh game starts (gameOver→false). Copy/layout follow the FUMBBL client. -->
    <div v-if="classicEndGame && !playerPick && !mvpNomination && gameStore.state.endGameSettled"
      class="cv-endgame" role="dialog" aria-label="Final result">
      <div class="cv-eg-title">Final Result</div>
      <div class="cv-eg-score">
        <div class="cv-eg-team" :data-win="classicEndGame.homeWon">
          <div class="cv-eg-name">{{ classicEndGame.home.team || 'Home' }}</div>
          <div class="cv-eg-coach">{{ classicEndGame.home.coach }}</div>
        </div>
        <div class="cv-eg-tally">{{ classicEndGame.home.score }}<span class="cv-eg-dash">–</span>{{ classicEndGame.away.score }}</div>
        <div class="cv-eg-team" :data-win="classicEndGame.awayWon">
          <div class="cv-eg-name">{{ classicEndGame.away.team || 'Away' }}</div>
          <div class="cv-eg-coach">{{ classicEndGame.away.coach }}</div>
        </div>
      </div>
      <div class="cv-eg-verdict">
        {{ classicEndGame.draw ? 'Draw' : ((classicEndGame.homeWon ? classicEndGame.home.team : classicEndGame.away.team) || 'Winner') + ' wins' }}
      </div>
      <div class="cv-eg-cols">
        <div v-for="s in [classicEndGame.home, classicEndGame.away]" :key="s.team" class="cv-eg-col">
          <div class="cv-eg-col-team">{{ s.team }}</div>
          <div class="cv-eg-mvp">
            <span class="cv-eg-mvp-label">MVP</span>
            <template v-if="s.mvps.length">
              <span v-for="(m, i) in s.mvps" :key="i" class="cv-eg-mvp-name">{{ m.name }}<span v-if="m.position" class="cv-eg-mvp-pos"> · {{ m.position }}</span></span>
            </template>
            <span v-else class="cv-eg-mvp-none">—</span>
          </div>
          <ul class="cv-eg-stats">
            <li><span>Touchdowns</span><b>{{ s.td }}</b></li>
            <li><span>Casualties</span><b>{{ s.cas }}</b></li>
            <li><span>Completions</span><b>{{ s.comp }}</b></li>
            <li><span>SPP earned</span><b>{{ s.spp }}</b></li>
          </ul>
        </div>
      </div>
      <!-- #234 (owner-fg 07-29): return to the current service's lobby in play/spectate mode
           (mirrors SpectateView's end-screen buttons; emits select-mode → App.vue selectMode). -->
      <div class="cv-eg-actions">
        <button type="button" class="cv-conn-btn primary" @click="onPlayGame">Play Game</button>
        <button type="button" class="cv-conn-btn" @click="onSpectateGame">Spectate Game</button>
      </div>
    </div>

    <!-- LIVE-PLAYTEST FIX (owner 2026-07-08, classic-live-playtest-findings.md #2):
         connection dropped mid-game (not a user Disconnect) — SpectateView shows a
         blocking "Connection closed" alertdialog with Reconnect/Disconnect; ClassicView
         read NEITHER `state.connectionClosed` (a classic coach mid-live-game would see
         NOTHING on a drop — no reconnect action, nothing). Ported as a classic-styled
         modal reusing the browse-backdrop pattern. Blocking (unlike the notice toasts —
         a dropped connection genuinely needs a decision), not gated by classicEffects. -->
    <div v-if="gameStore.state.connectionClosed" class="cv-browse-backdrop" role="alertdialog" aria-modal="true">
      <div class="cv-conn-closed">
        <h2 class="cv-conn-closed-title">Connection closed</h2>
        <p v-if="gameStore.state.connectionClosed.reconnecting" class="cv-conn-closed-status">
          <span class="cv-conn-spinner" aria-hidden="true"></span>
          Reconnecting to {{ gameStore.state.connectionClosed.label }}…
        </p>
        <p v-else class="cv-conn-closed-status">
          Lost connection to {{ gameStore.state.connectionClosed.label }}<span v-if="gameStore.state.connectionClosed.code"> (code {{ gameStore.state.connectionClosed.code }})</span>.
        </p>
        <div class="cv-conn-closed-actions">
          <button v-if="!gameStore.state.connectionClosed.reconnecting" type="button" class="cv-conn-btn primary" @click="gameStore.reconnect()">Reconnect</button>
          <button type="button" class="cv-conn-btn" @click="gameStore.disconnect()">{{ gameStore.state.connectionClosed.reconnecting ? 'Cancel' : 'Disconnect' }}</button>
        </div>
      </div>
    </div>

    <!-- LIVE-PLAYTEST FIX (owner 2026-07-08, classic-live-playtest-findings.md #3):
         unknown-call diagnostic panel (a server dialog with no wired invocation point —
         exactly what a live playtest hunts for). Trimmed port of SpectateView's panel:
         no drag/screenshot, keeps copy/export/describe/dismiss + the coordinate-pick
         flow (renderer.onTilePick, wired in onMounted above). -->
    <div v-if="gameStore.state.unknownCall" class="cv-unknown-call">
      <div class="cv-uc-head">⚠ Unrecognized server call</div>
      <div class="cv-uc-body">
        <p>We received the dialog <b>"{{ gameStore.state.unknownCall.id }}"</b> but have no wired
          invocation point for it. Please help us wire it:</p>
        <div class="cv-uc-args">
          <span class="cv-uc-args-label">Arguments present:</span>
          <code>{{ gameStore.state.unknownCall.payloadKeys.join(', ') || '(none)' }}</code>
        </div>
        <div v-if="gameStore.state.unknownCall.catalogArgs" class="cv-uc-args">
          <span class="cv-uc-args-label">Catalog expects:</span>
          <code>{{ gameStore.state.unknownCall.catalogArgs }}</code>
        </div>
        <div class="cv-uc-actions">
          <button class="cv-uc-btn" @click="copyUnknownDetails()">📋 Copy details</button>
          <button class="cv-uc-btn" @click="exportUnknownLog()">📄 Export log</button>
        </div>
        <span v-if="unknownCopyStatus" class="cv-uc-status">{{ unknownCopyStatus }}</span>
        <label class="cv-uc-describe">
          <span>What happened when this occurred?</span>
          <textarea rows="2" :value="gameStore.state.unknownCall.description"
            @input="gameStore.setUnknownCallDescription(($event.target as HTMLTextAreaElement).value)"
            placeholder="Describe the action you took…"></textarea>
        </label>
        <div v-if="gameStore.state.unknownCall.expectsCoordinate" class="cv-uc-coord">
          <template v-if="unknownPickingTile">
            <span class="cv-uc-coord-prompt">
              {{ gameStore.state.unknownCall.eligible
                ? 'Select one of the highlighted squares.'
                : 'Click any tile on the pitch to return its coordinate.' }}
            </span>
          </template>
          <button v-else class="cv-uc-btn coord" @click="armUnknownTilePick()">
            🎯 This call wants a coordinate — pick a tile
          </button>
        </div>
        <div class="cv-uc-foot">
          <button class="cv-uc-btn dismiss" @click="gameStore.dismissUnknownCall()">Dismiss</button>
        </div>
      </div>
    </div>

    <!-- GAME BROWSER (shell Browse button → ui.browserOpen) — classic-styled; the
         modal only lived in SpectateView, so classic renders its own. -->
    <div v-if="ui.browserOpen" class="cv-browse-backdrop" @click.self="ui.browserOpen = false">
      <div class="cv-browse">
        <div class="cv-browse-bar">
          <div class="cv-browse-servers" role="group" aria-label="Browse server">
            <button type="button" :data-active="settings.activeServerTarget === 'fumbbl'" @click="setBrowserServer('fumbbl')">FUMBBL</button>
            <button v-if="FORK_EDITION" type="button" :data-active="settings.activeServerTarget === 'local'" @click="setBrowserServer('local')">Super FUMBBL</button>
          </div>
          <input v-model="browserFilter" type="search" class="cv-browse-filter" placeholder="Filter (coach / team / id…)" />
          <button type="button" class="cv-browse-x" title="Refresh the list" @click="refreshBrowser()">↻</button>
          <button type="button" class="cv-browse-x" title="Close (back to the pitch)" @click="ui.browserOpen = false">✕</button>
        </div>
        <form class="cv-browse-entry" @submit.prevent="isPlayMode ? joinPlay() : connectSpectate()">
          <template v-if="!isPlayMode">
            <input v-model.number="gameId" type="number" placeholder="Game id" />
            <button type="submit">Spectate</button>
          </template>
          <template v-else>
            <input v-model="gameName" type="text" placeholder="Game name" />
            <button type="submit">Play</button>
          </template>
          <button type="button" class="cv-browse-demo" @click="gameStore.loadDemo(); ui.browserOpen = false">Load demo</button>
          <button type="button" class="cv-browse-demo" @click="gameStore.demoReplayBlock(); ui.browserOpen = false">Replay block</button>
        </form>
        <!-- owner ruling 2026-08-17: official fumbbl.com replay+live permitted; refusal hint removed. -->
        <p v-if="browserStatus" class="cv-browse-hint">{{ browserStatus }}</p>
        <p v-else-if="!filteredMatches.length" class="cv-browse-hint">No games match “{{ browserFilter }}”.</p>
        <table v-else class="cv-browse-list">
          <tbody>
            <tr v-for="m in filteredMatches" :key="m.id" class="cv-browse-row" title="Double-click to spectate" @dblclick="spectateMatch(m.id)">
              <td class="cv-browse-id">{{ m.id }}</td>
              <td>{{ m.teams[0]?.name }} <em>({{ m.teams[0]?.coach }})</em></td>
              <td class="cv-browse-score">{{ m.teams[0]?.score }}–{{ m.teams[1]?.score }}</td>
              <td>{{ m.teams[1]?.name }} <em>({{ m.teams[1]?.coach }})</em></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Shared turn-boundary cue. The fixed banner occupancy row keeps Classic's optional
         turnover effect and the always-on incoming-coach notifier from ever overlapping. -->
    <div v-if="turnover || gameStore.state.turnToast" class="cv-turn-boundary-stack">
      <div class="cv-turn-boundary-banner-slot">
        <div v-if="turnover" class="cv-turnover" :data-side="turnover.side">
          <span class="cv-turnover-txt">TURNOVER</span>
          <span class="cv-turnover-sub">{{ turnover.teamName || turnover.coach }}</span>
        </div>
      </div>
      <TurnToast v-if="gameStore.state.turnToast" :key="'classic-tt-' + gameStore.state.turnToast.seq"
        :toast="gameStore.state.turnToast" />
    </div>

    <!-- informationOkay / defenderAction notices (live-playtest fix — always on, not an
         opt-in effect; informational only, no user action). -->
    <div class="cv-toast-stack">
      <div v-for="t in classicToasts" :key="t.id" class="cv-toast">{{ t.text }}</div>
    </div>

    <WatchOutToast :occurrence="gameStore.state.watchOutToast"
      :player-screen-pos="classicWatchOutPlayerScreenPos" />
    <SppGainToast v-for="occurrence in gameStore.state.sppToasts" :key="occurrence.seq"
      :occurrence="occurrence" :player-screen-pos="classicWatchOutPlayerScreenPos" />

    <!-- FC3 classic dialogs (float over the frame; non-blocking). -->
    <OnTheBallWaitingModal v-if="gameStore.state.onTheBallWaiting"
      :message="gameStore.state.onTheBallWaiting.message" />
    <SendOffWaitingModal v-if="gameStore.state.sendOffWaiting"
      :progress="gameStore.state.sendOffWaiting" />
    <ClassicDialog v-if="gameStore.state.prayerAnnounce" title="Prayers to Nuffle" :buttons="[]" readonly :width="360">
      <div class="cv-prayer-announcement">
        <img v-if="prayerRecipientPortrait" class="cv-prayer-portrait" :src="prayerRecipientPortrait" alt="Prayer recipient sprite" />
        <div class="cv-prayer-announcement-head">{{ gameStore.state.prayerAnnounce.icon }} {{ gameStore.state.prayerAnnounce.text }}</div>
        <div v-for="line in gameStore.state.prayerAnnounce.lines" :key="line" class="cv-prayer-announcement-effect">{{ line }}</div>
      </div>
    </ClassicDialog>
    <ClassicDialog v-if="gameStore.state.prayerChoiceWait" title="Prayers to Nuffle" :buttons="[]" readonly :width="340">
      {{ gameStore.state.prayerChoiceWait.coach }} is making a Prayers to Nuffle choice…
    </ClassicDialog>
    <ClassicDialog v-if="classicWideRailPrompt" title="Special Ability" :buttons="classicWideRailButtons" :width="380"
      :anchor="anchorFor(playerSquare(classicWideRailPrompt.playerId))" @pick="onClassicWideRailPick">
      Use a special before continuing {{ classicWideRailPrompt.playerAction }}?
    </ClassicDialog>
    <ClassicDialog v-if="yn" :key="'yn-' + yn.key" title="Confirm" :buttons="ynButtons" :width="300" @pick="onYesNo">
      {{ yn.text }}
    </ClassicDialog>
    <ClassicDialog v-if="rr" :title="rr.label || 'Re-roll?'" :buttons="rrButtons" :readonly="rrReadonly" :width="300" :anchor="anchorFor(playerSquare(rr.playerId))" @pick="onReroll">
      <div v-if="rr.roll" class="cv-dlg-roll">Rolled <D6Face :value="rr.roll" :label="`Rolled ${rr.roll}`" /><span v-if="rr.needed"> — needed <D6Face :value="rr.needed" :label="`Needed ${rr.needed}`" />+</span>.</div>
      <div>{{ rrReadonly ? 'Waiting for the coach to choose…' : rr.question }}</div>
    </ClassicDialog>
    <ClassicDialog v-if="classicEndActConfirm" title="End activation" :buttons="classicEndActButtons" :width="300" @pick="onClassicEndAct">
      {{ classicEndActConfirm.text }}
    </ClassicDialog>
    <ClassicDialog v-if="puntConfirm" title="Punt" :buttons="puntConfirmButtons" :width="300"
      :anchor="anchorFor(puntConfirm.from)" @pick="onPuntConfirm">
      Aim at square {{ puntConfirm.aim[0] }}, {{ puntConfirm.aim[1] }} and confirm the Punt.
    </ClassicDialog>
    <ClassicDialog v-if="inducementUse && !wizardTargetConfirm" title="Use Inducement" :buttons="inducementUseButtons"
      :width="320" @pick="onInducementUse">
      {{ inducementUse.prompt }}
    </ClassicDialog>
    <ClassicDialog v-if="wizardTargetConfirm" title="Cast Zap?" :buttons="wizardTargetButtons" :width="300"
      :anchor="anchorFor(wizardTargetConfirm.square)" @pick="onWizardTarget">
      <div>{{ wizardTargetConfirm.playerName }}</div>
      <div class="cv-dlg-roll">Zap requires <D6Face :value="wizardTargetConfirm.requiredRoll"
        :label="`Zap needs ${wizardTargetConfirm.requiredRoll}`" />+.</div>
    </ClassicDialog>
    <ClassicDialog v-if="skillUse" :title="skillUseHmpScatterCopy?.title ?? skillUsePassCopy?.title ?? skillUseSwoopCopy?.title ?? ('Use ' + skillUse.skill + '?')" :buttons="skillUseButtons" :readonly="!skillUse.mine" :width="280" :anchor="anchorFor(playerSquare(skillUse.playerId))" @pick="onSkillUse">
      <template v-if="skillUseHmpScatterCopy">
        <div>{{ skillUseHmpScatterCopy.contextLine }}</div>
      </template>
      <template v-if="skillUsePassCopy">
        <div>{{ skillUsePassCopy.rollLine }}</div>
        <div>{{ skillUsePassCopy.needLine }}</div>
      </template>
      <template v-else-if="skillUseSwoopCopy">
        <div>{{ skillUse.mine ? skillUseSwoopCopy.body : 'Waiting for the coach to choose…' }}</div>
      </template>
      <template v-else>
        <div v-if="skillUse.injuryResult">Current injury: {{ skillUse.injuryResult }}</div>
        <div v-if="skillUse.armorDice" class="cv-dlg-roll">Armour: <D6Face v-for="(die, index) in skillUse.armorDice" :key="index" :value="die" :label="`Armour die ${die}`" /></div>
        <div v-if="skillUse.minimumRoll" class="cv-dlg-roll"><D6Face :value="skillUse.minimumRoll" :label="`Needed ${skillUse.minimumRoll}`" />+ needed.</div>
        <div>{{ skillUse.mine ? 'Use ' + skillUse.skill + '?' : 'Waiting for the coach to choose…' }}</div>
      </template>
    </ClassicDialog>
    <ClassicDialog v-if="bloodlust" :key="'bloodlust-' + bloodlust.seq"
      :title="bloodlust.stage === 'reroll' ? bloodlust.vampire + ' failed bloodlust' : 'Bloodlust — ' + bloodlust.vampire"
      :buttons="bloodlustButtons" :width="340" :anchor="anchorFor(playerSquare(bloodlust.playerId))" @pick="onBloodlust">
      <template v-if="bloodlust.stage === 'reroll'">
        <div v-if="bloodlust.roll != null" class="cv-dlg-roll">Rolled <D6Face :value="bloodlust.roll" :label="`Rolled ${bloodlust.roll}`" />.</div>
        <div>Reroll?</div>
      </template>
      <template v-else-if="bloodlust.stage === 'decision'">
        Choose whether to {{ bloodlust.changeToMove ? 'change to Move' : 'move first' }} or feed and perform {{ bloodlust.action }}.
      </template>
      <template v-else-if="bloodlust.stage === 'bite'">
        Choose a Thrall to bite, or refuse.
      </template>
    </ClassicDialog>
    <ClassicDialog v-if="blitzBlockChoice" :key="'blitzblock-' + blitzBlockChoice.targetId + ':' + blitzBlockChoice.origin"
      :title="'Choose the ' + (blitzBlockChoice.origin === 'blitz' ? 'blitz' : 'block') + ' attack'"
      :buttons="blitzBlockChoiceButtons" :width="320"
      :anchor="anchorFor(playerSquare(blitzBlockChoice.targetId))" @pick="onBlitzBlockChoice">
      Choose your attack against {{ playerLabel(blitzBlockChoice.targetId) }}.
    </ClassicDialog>
    <ClassicDialog v-if="classicGazeConfirm" :key="'gaze-' + gameStore.state.gazeIntent?.seq"
      title="Hypnotic Gaze" :buttons="classicGazeButtons" :width="300"
      :anchor="anchorFor(playerSquare(classicGazeConfirm.victimId))" @pick="onClassicGaze">
      <div>{{ classicGazeConfirm.stage === 'declaration' ? 'Lock target' : 'Use Hypnotic Gaze on' }} {{ playerLabel(classicGazeConfirm.victimId) }}?</div>
      <div v-if="classicGazeConfirm.refusal">Cannot confirm yet: {{ classicGazeConfirm.refusal }}.</div>
    </ClassicDialog>
    <ClassicDialog v-if="blitzMoveModalTile" title="Declared Blitz" :buttons="blitzMoveButtons" :width="340"
      :anchor="anchorFor(blitzMoveModalTile)" @pick="onBlitzMovePick" @contextmenu.prevent="dismissBlitzMoveModal">
      You've declared a Blitz. Convert to a plain Move instead?
    </ClassicDialog>
    <ClassicDialog v-if="followup" title="Follow up?" :buttons="followupButtons" :width="280" :anchor="anchorFor(followup.square)" @pick="onFollowup">
      Follow up into the vacated square?
    </ClassicDialog>
    <ClassicDialog v-if="coin" title="Coin toss" :buttons="coinButtons" :width="280" @pick="onCoin">
      Call the coin.
    </ClassicDialog>
    <ClassicDialog v-if="receive" title="Kick or Receive" :buttons="receiveButtons" :width="280" @pick="onReceive">
      You won the toss — kick or receive?
    </ClassicDialog>
    <ClassicDialog v-if="selectSkill" :title="intensiveTrainingSelect ? 'Intensive Training — Primary Skill' : 'Choose a skill'"
      :buttons="selectSkillButtons" :width="intensiveTrainingSelect ? 360 : 300"
      :anchor="anchorFor(playerSquare(selectSkill.playerId))" @pick="onSelectSkill">
      <IntensiveTrainingChoice v-if="intensiveTrainingSelect" :player-name="selectSkill.playerName"
        :portrait="selectSkillPortrait" :skills="selectSkill.skills" />
      <template v-else>{{ selectSkill.playerName }} — choose a skill:</template>
    </ClassicDialog>
    <ClassicDialog v-if="keyword" :title="keyword.mode || 'Choose a keyword'" :buttons="keywordButtons" :width="300" :anchor="anchorFor(playerSquare(keyword.playerId))" @pick="onKeyword">
      {{ keyword.playerName }} — choose {{ keywordMulti ? (keyword.min === keyword.max ? keyword.min : keyword.min + '–' + keyword.max) : 'one' }}:
    </ClassicDialog>
    <ClassicDialog v-if="sendOff" title="Referee!" :buttons="sendOffButtons" :width="320" :anchor="anchorFor(sendOff.square)" @pick="onSendOff">
      {{ sendOff.playerName }} has been spotted. Argue the call{{ sendOff.canBribe ? ', bribe the ref,' : '' }} or accept the send-off?
    </ClassicDialog>
    <ClassicDialog v-if="apo" class="cv-apo-dialog" :class="apo.mine ? 'seat-local' : 'seat-opposition'" title="Apothecary" :buttons="apoButtons" :readonly="!apo.mine" :width="390" :anchor="anchorFor(apo.square)" @pick="onApo">
      <div class="cv-apo-head"><img :src="apoSubject?.portrait || apoIcon" alt="" /><span><b>{{ apo.kind === 'single' ? apo.player : 'Multiple injuries' }}</b><small>{{ apo.mine ? 'Choose treatment or decline.' : 'Waiting for the injured coach to choose…' }}</small></span></div>
      <PlayerDetailSkillList v-if="apoSubject?.skills.length" class="cv-apo-skills"
        :skills="apoSubject.skills" :mode="apoSkillMode" :icon-style="settings.skillIconStyle"
        :position-id="apoSubject.player.positionId" :side="apoSubject.side" />
      <div class="cv-apo-injuries">
        <div v-for="injury in apo.injuries" :key="injury.playerId" class="cv-apo-injury" :class="{ ko: injury.base === 5 }">
          <b>{{ injury.player }}</b><span>{{ injury.injury }}</span>
        </div>
      </div>
    </ClassicDialog>
    <ClassicDialog v-if="apoD16" class="cv-apo-dialog cv-apo-results-dialog" :class="apoD16.mine ? 'seat-local' : 'seat-opposition'" title="Apothecary — Choose Injury Result" :buttons="apoD16Buttons" :readonly="!apoD16.mine" :width="390" :anchor="anchorFor(apoD16.square)" @pick="onApoD16">
      <div class="cv-apo-head"><img :src="apoIcon" alt="" /><span><b>{{ apoD16.player }}</b><small>{{ apoD16.mine ? 'Choose which injury result to keep.' : 'Waiting for the injured coach to choose…' }}</small></span></div>
      <div class="cv-apo-result-grid">
        <div><small>Original</small><b>{{ apoD16.oldInjury }}</b><span v-if="apoD16.oldRoll != null">D16 · {{ apoD16.oldRoll }}</span></div>
        <div><small>Re-Rolled</small><b>{{ apoD16.newInjury }}</b><span v-if="apoD16.newRoll != null">D16 · {{ apoD16.newRoll }}</span></div>
      </div>
    </ClassicDialog>
    <ClassicDialog v-if="apoAutoReturn" class="cv-apo-dialog cv-apo-auto-dialog"
      :class="`seat-${apoAutoReturn.side}`" title="Apothecary Treatment"
      :buttons="apoAutoReturnButtons" :readonly="true" :width="390" :anchor="anchorFor(apoAutoReturn.square)">
      <div class="cv-apo-head"><img :src="classicPortrait(apoAutoReturn.playerId) || apoIcon" alt="" /><span><b>{{ apoAutoReturn.player }}</b><small>Treatment resolved</small></span></div>
      <div class="cv-apo-result-grid">
        <div :class="{ selected: apoAutoReturn.selected === 'old' }"><small>Original</small><b>{{ apoAutoReturn.oldInjury }}</b><span v-if="apoAutoReturn.oldRoll != null">D16 · {{ apoAutoReturn.oldRoll }}</span></div>
        <div :class="{ selected: apoAutoReturn.selected === 'new' }"><small>Re-Rolled</small><b>{{ apoAutoReturn.newInjury }}</b><span v-if="apoAutoReturn.newRoll != null">D16 · {{ apoAutoReturn.newRoll }}</span><span v-if="apoAutoReturn.newInjuryDie != null">Injury D6 · {{ apoAutoReturn.newInjuryDie }}</span></div>
      </div>
      <div class="cv-apo-auto-bench">{{ apoAutoReturn.outcome }}</div>
    </ClassicDialog>
    <ClassicDialog v-if="injuryGate" :title="injuryGate.label || 'Injury decision'" :buttons="injuryGateButtons"
      :readonly="injuryGateReadonly" :width="320" :anchor="anchorFor(injuryGate.square)" @pick="onInjuryGate">
      {{ injuryGateReadonly ? 'Waiting for the coach to choose…' : injuryGate.player + ' — ' + injuryGate.kind }}
    </ClassicDialog>
    <ClassicDialog v-if="cardChoice" title="Buy a card" :buttons="cardButtons" :width="320" @pick="onCard">
      Available gold: {{ goldLabel(cardChoice.availableGold) }}
    </ClassicDialog>
    <!-- Block Roll — the FUMBBL block-die faces tumble then become selectable. -->
    <ClassicDialog v-if="blockPartial" title="Block Roll" :buttons="blockRollButtons" :readonly="!blockDialogMine"
      :width="Math.max(210, blockPartial.dice.length * 74 + 44)" :anchor="null" @pick="onBlockRollButton">
      <BlockChooserCopy v-if="liveBlockChoiceDialog" :game="game" :choosing-team-id="liveBlockChoosingTeamId"
        :local-seat="blockChooserSeat" :spectator="blockChooserSpectator" />
      <div class="cv-block-dice">
        <button v-for="(d, i) in blockPartial.dice" :key="i" class="cv-block-die" :class="{ 'cv-block-die-choice': blockPartial.choiceIndex === i }" type="button"
          :data-armed="!!bpDieMode" :data-readonly="!blockDialogMine || (bpPhase1ReRollOnly && !bpDieMode)"
          :disabled="!blockDialogMine || blockTumbling || (bpPhase1ReRollOnly && !bpDieMode)"
          :title="blockTumbling ? 'Rolling…' : (bpDieMode ? 'Re-roll this die' : (bpPhase1ReRollOnly ? blockFaceLabel(d) + ' — awaiting the chooser' : blockFaceLabel(d)))"
          @click="clickBlockPartialDie(i)">
          <img :src="blockTumbling ? blockFaceUrls[tumbleIdx] : blockFaceUrl(d)" alt="" />
        </button>
      </div>
      <div v-if="blockDialogMine" class="cv-block-hint">{{ blockTumbling ? 'Rolling…' : (bpDieMode ? 'Click a die to re-roll it (' + bpDieMode + ')' : (bpPhase1ReRollOnly ? 'Uphill block — re-roll or decline; the chooser picks the die.' : 'Click a die to choose it')) }}</div>
    </ClassicDialog>
  </div>
</template>

<style scoped>
.classic-view {
  /* Classic client is fixed-pixel; FC2 wraps this in a uniform scale factor. */
  font-family: Arial, Helvetica, sans-serif;
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #2b2b2b;
  color: #dcdcd2;
}
.cv-opponent-decision-pill {
  position: absolute; z-index: 120; top: 38px; left: 50%; transform: translateX(-50%);
  width: max-content; max-width: calc(100% - 24px); padding: 0.38rem 0.75rem;
  color: #fff; background: rgba(150, 26, 26, 0.94); border: 1px solid #e47878; border-radius: 6px;
  box-shadow: 0 3px 12px #0009; font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem);
  font-weight: 800; line-height: 1.2; text-align: center; pointer-events: none;
}
.cv-menubar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.7rem;
  background: #3a3a3a;
  border-bottom: 1px solid #555;
}
.cv-title { font-weight: 700; letter-spacing: 0.03em; }
.cv-badge { font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: #c9a24b; }
.cv-spacer { flex: 1; }
.cv-menu-btn {
  background: #4a4a4a; color: #e6e2d8; border: 1px solid #666;
  border-radius: 3px; padding: 0.25rem 0.6rem; cursor: pointer; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem);
}
.cv-menu-btn:hover { background: #565656; }
/* Layout grid (FC-D2): one DOM, two arrangements placed by grid-area templates. */
.cv-body { flex: 1; min-height: 0; display: grid; gap: 0; }
/* SQUARE (§3c): HOME | NS-pitch | AWAY | far-right Log/Score/Chat column. */
.cv-body[data-layout='square'] {
  grid-template-columns: 150px minmax(0, 1fr) 150px minmax(220px, 24%);
  grid-template-rows: minmax(0, 1fr) auto minmax(0, 1fr);
  grid-template-areas:
    "hs fld as log"
    "hs fld as sb"
    "hs fld as chat";
}
/* LANDSCAPE (§3b): HOME | EW-pitch | AWAY full height; scoreboard strip + Log/Chat
   stacked beneath the field between the sidebars. */
.cv-body[data-layout='landscape'] {
  grid-template-columns: 172px minmax(0, 1fr) minmax(0, 1fr) 172px;
  grid-template-rows: minmax(0, 1fr) auto 140px;
  grid-template-areas:
    "hs fld  fld  as"
    "hs sb   sb   as"
    "hs log  chat as";
}
.cv-sidebar[data-side='home'] { grid-area: hs; }
.cv-sidebar[data-side='away'] { grid-area: as; }
.cv-field { grid-area: fld; min-height: 0; }
.cv-log { grid-area: log; }
.cv-scoreboard { grid-area: sb; }
.cv-chat { grid-area: chat; }
/* Log / Chat panes (shared shell; the dividers depend on which edge they sit on). */
.cv-log, .cv-chat { min-height: 0; min-width: 0; display: flex; flex-direction: column; background: #1c1c1c; }
.cv-body[data-layout='square'] .cv-log,
.cv-body[data-layout='square'] .cv-chat { border-left: 1px solid #555; }
.cv-body[data-layout='square'] .cv-chat { border-top: 1px solid #555; }
.cv-body[data-layout='landscape'] .cv-log,
.cv-body[data-layout='landscape'] .cv-chat { border-top: 1px solid #555; }
.cv-body[data-layout='landscape'] .cv-chat { border-left: 1px solid #555; }
/* Scoreboard: a stacked block in the square right column, a horizontal strip in
   landscape (bottom-centre under the field). */
.cv-scoreboard {
  display: flex; align-items: center; justify-content: center; gap: 0.15rem;
  padding: 0.35rem 0.6rem; background: #14161a; border-top: 1px solid #555; border-bottom: 1px solid #555;
}
.cv-body[data-layout='square'] .cv-scoreboard { flex-direction: column; border-left: 1px solid #555; }
.cv-body[data-layout='landscape'] .cv-scoreboard { flex-direction: row; gap: 1.6rem; }
.cv-sb-turn { font-size: max(var(--ui-min-text-size, 12px), 0.78rem); color: #d8d3c6; }
.cv-sb-score { display: flex; gap: 1.2rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.92rem); font-weight: 700; }
.cv-sb-score .home { color: #cf5a5a; }
.cv-sb-score .away { color: #6f8fd6; }
.cv-sb-spec { font-size: max(var(--ui-min-text-size, 12px), 0.68rem); color: #9a9a90; }
.cv-chat-line { font-size: inherit; line-height: 1.35; color: #8fb0e0; }
.cv-sidebar {
  display: flex; flex-direction: column; gap: 0.4rem;
  padding: 0.5rem; background: #262626; border: 1px solid #444; border-top: none; border-bottom: none;
}
/* Team-banner backdrop (owner 2026-07-08): a faint team tint behind each sidebar
   + a tinted crest banner at the top. Home = red, Away = blue (team identity). */
.cv-sidebar[data-side='home'] { background: linear-gradient(180deg, #2c2222, #262626 42%); }
.cv-sidebar[data-side='away'] { background: linear-gradient(180deg, #22262f, #262626 42%); }
.cv-banner {
  flex: 0 0 auto; display: flex; align-items: center; gap: 0.4rem;
  padding: 0.28rem 0.4rem; border-radius: 3px; border: 1px solid #000;
}
.cv-banner[data-side='home'] { background: linear-gradient(90deg, #7a2a2a, #431c1c); }
.cv-banner[data-side='away'] { background: linear-gradient(90deg, #2a3f7a, #1c2743); }
.cv-banner-crest { width: 2.3rem; height: 2.3rem; object-fit: contain; flex: 0 0 auto; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.5)); }
.cv-banner-txt { min-width: 0; }
.cv-banner-name { font-size: max(var(--ui-min-text-size, 12px), 0.72rem); font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cv-banner-coach { font-size: max(var(--ui-min-text-size, 12px), 0.58rem); color: #e6e0d4; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* owner 2026-07-08: three roughly-equal thirds — detail/box, mid (buttons +
   turn/dice), resources (re-rolls + inducements) pinned to the bottom. */
.cv-detail {
  flex: 1;
  border: 1px solid #4a4a4a; border-radius: 3px; background: #2f2f2f;
  display: flex; flex-direction: column; overflow: hidden; min-height: 0;
}
.cv-detail-empty {
  flex: 1; display: flex; align-items: center; justify-content: center;
  font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: #b7b7ad; text-align: center;
}
/* Player-detail card (annotated top-of-sidebar): name, portrait, type/pos, stats,
   level, skills (green = added). */
.cv-card { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
.cv-card-name {
  padding: 0.22rem 0.4rem; font-weight: 700; font-size: max(var(--ui-min-text-size, 12px), 0.74rem); color: #fff;
  background: #7a2a2a; border-bottom: 1px solid #000;
}
.cv-card[data-side='away'] .cv-card-name { background: #2a3f7a; }
.cv-card-portrait {
  height: 5.6rem; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 50% 38%, #27272c, #141416); border-bottom: 1px solid #444; overflow: hidden;
}
.cv-card-portrait img { max-height: 100%; max-width: 100%; image-rendering: pixelated; }
/* Owner 2026-07-08: portrait = the larger token extract (playerPortrait rasterises
   the token at 3× — already high-res). Landscape gives the sidebar full height and
   §3b puts the portrait up top as the card's hero art, so let it grow there. */
.cv-body[data-layout='landscape'] .cv-card-portrait { height: 8.6rem; }
.cv-card-noportrait { font-size: max(var(--ui-min-text-size, 12px), 0.62rem); color: #6a6a60; }
.cv-card-pos { padding: 0.2rem 0.4rem 0; font-size: max(var(--ui-min-text-size, 12px), 0.68rem); color: #e0ddd2; }
.cv-card-type { padding: 0 0.4rem 0.15rem; font-size: max(var(--ui-min-text-size, 12px), 0.6rem); color: #9a9a90; }
.cv-card-stats { display: flex; gap: 0.15rem; padding: 0.1rem 0.35rem 0.2rem; }
.cv-card-stat {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  border: 1px solid #4a4a4a; border-radius: 2px; background: #f2ede0; color: #1c1c1c;
  font-size: max(var(--ui-min-text-size, 12px), 0.62rem); padding: 0.05rem 0;
}
.cv-card-stat b { font-size: max(var(--ui-min-text-size, 12px), 0.52rem); color: #555; }
.cv-card-level { padding: 0.1rem 0.4rem; font-size: max(var(--ui-min-text-size, 12px), 0.62rem); color: #b7b7ad; border-top: 1px solid #3a3a3a; }
.cv-card-skills { display: flex; flex-wrap: wrap; gap: 0.15rem 0.3rem; padding: 0.2rem 0.4rem; }
.cv-card-skill { max-width: 100%; overflow-wrap: anywhere; font-size: max(var(--ui-min-text-size, 12px), 0.64rem); color: #d8d3c6; }
.cv-card-skill[data-added='true'] { color: #56d364; } /* green = added */
.cv-card-skill.skill-general { color: var(--ui-skill-general); }
.cv-card-skill.skill-agility { color: var(--ui-skill-agility); }
.cv-card-skill.skill-strength { color: var(--ui-skill-strength); }
.cv-card-skill.skill-passing { color: var(--ui-skill-passing); }
.cv-card-skill.skill-mutation { color: var(--ui-skill-mutation); }
.cv-card-skill.skill-trait { color: var(--ui-skill-trait); }
.cv-card-noskill { font-size: max(var(--ui-min-text-size, 12px), 0.62rem); color: #6a6a60; }
/* Reserves / Out dugout view inside the Box panel — sections by injury type,
   each header flanked by rules ("—— Badly Hurt ——"), players gridded below. */
.cv-dugout { flex: 1; overflow-y: auto; padding: 0.25rem; }
.cv-dg-block { margin-bottom: 0.15rem; }
.cv-dg-sec {
  display: flex; align-items: center; gap: 0.35rem;
  font-size: max(var(--ui-min-text-size, 12px), 0.62rem); color: #d0cabe; margin: 0.25rem 0 0.18rem;
}
.cv-dg-sec::before, .cv-dg-sec::after { content: ''; flex: 1; height: 1px; background: #4a4a4a; }
.cv-dg-grid { display: flex; flex-wrap: wrap; gap: 0.22rem; padding: 0 0.1rem; }
.cv-dg-tile {
  width: 2.1rem; height: 2.1rem; display: flex; align-items: center; justify-content: center;
  font-size: max(var(--ui-min-text-size, 12px), 0.62rem); border-radius: 3px; overflow: hidden; padding: 1px;
}
.cv-dg-sprite { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
.cv-dg-block[data-view='out'] .cv-dg-tile { background: #3a2020; border: 1px solid #6a2c2c; color: #f0b4b4; }
.cv-dg-block[data-view='reserves'] .cv-dg-tile { background: #2f353d; border: 1px solid #47525f; color: #c7d4e2; }
.cv-mid { flex: 1; display: flex; flex-direction: column; gap: 0.35rem; }
.cv-boxbtns { display: flex; gap: 0.3rem; }
.cv-boxbtns .cv-btn { flex: 1; }
.cv-btn {
  background: #3d3d3d; color: #e6e2d8; border: 1px solid #5a5a5a; border-radius: 3px;
  padding: 0.35rem 0.4rem; font-size: max(var(--ui-min-text-size, 12px), 0.7rem); cursor: pointer; text-align: center;
}
.cv-btn:hover { background: #474747; }
.cv-btn[data-active='true'] { background: #4a5a3a; border-color: #74904a; color: #f0ede4; }
.cv-endturn { background: #4a3d2a; border-color: #6a5636; }
.cv-endturn:hover:not(:disabled) { background: #574733; }
.cv-endturn:disabled { opacity: 0.4; cursor: not-allowed; }
/* Current-player status button. Playing side GLOWS activation-gold (§A0 selection
   language); the waiting side stays inert grey. */
.cv-status {
  flex: 1; margin-top: 0.1rem;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.12rem;
  border: 1px solid #4a4a4a; border-radius: 3px; background: #2b2b2b; color: #9a9a90;
  font-size: max(var(--ui-min-text-size, 12px), 0.7rem); cursor: default;
}
.cv-status[data-playing='true'] {
  border-color: #b8942f; background: #37301d; color: #f2e6c2;
  box-shadow: 0 0 0 1px rgba(184, 148, 47, 0.4) inset;
}
.cv-status-lead { font-weight: 700; }
.cv-status[data-playing='true'] .cv-status-lead { color: #f5c542; }
.cv-status-sub { font-size: max(var(--ui-min-text-size, 12px), 0.62rem); color: #b7b7ad; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Resource strip: re-roll tokens (repeated), apothecary red-cross + count, money bag. */
.cv-resbar {
  flex: 1;
  border: 1px solid #4a4a4a; border-radius: 3px; background: #2f2f2f;
  display: flex; flex-direction: column; justify-content: flex-end; gap: 0.4rem;
  padding: 0.5rem;
}
.cv-res-tokens { display: flex; flex-wrap: wrap; align-items: center; gap: 0.15rem; }
.cv-res-tok { width: 1.15rem; height: 1.15rem; object-fit: contain; image-rendering: pixelated; }
.cv-res-tok[data-used='true'] { opacity: 0.28; filter: grayscale(1); } /* re-roll used this half */
.cv-res-none { font-size: max(var(--ui-min-text-size, 12px), 0.62rem); color: #6a6a60; }
.cv-res-x { font-size: max(var(--ui-min-text-size, 12px), 0.66rem); color: #cdb36a; margin-left: 0.15rem; }
.cv-res-icons { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.cv-res-item { display: inline-flex; align-items: center; gap: 0.2rem; font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: #d8d3c6; }
.cv-res-item[data-empty='true'] { opacity: 0.4; }
.cv-res-gold b { color: #cdb36a; }
.cv-field {
  position: relative;
  flex: 1; min-width: 0;
  background: #14401b; /* under the canvas while it loads */
  border: 1px solid #444; border-top: none; border-bottom: none;
  overflow: hidden;
}
.cv-field-canvas { position: absolute; inset: 0; }
.cv-field-canvas :deep(canvas) { display: block; width: 100%; height: 100%; }
.cv-blitz-target {
  position: absolute; z-index: 14; transform: translate(-50%, -50%);
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem); line-height: 1; pointer-events: none;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.7));
}
.cv-kick-election {
  position: absolute; z-index: 52; transform: translate(-50%, -50%);
  width: 34px; height: 34px; padding: 0; border: 2px solid #22a8bd; border-radius: 3px;
  background: #d8d4ccdd; color: #111; cursor: pointer; font: 700 11px/1 Arial, sans-serif;
  display: flex; align-items: center; justify-content: center; gap: 3px; box-shadow: 0 2px 7px #0009;
}
.cv-kick-election.reduced { border-color: #b8942f; background: #efe1a7ee; }
.cv-kick-election.icon { z-index: 54; width: 22px; height: 22px; border-radius: 50%; }
.cv-kick-election.boundary { width: auto; min-width: 66px; height: 25px; padding: 0 6px; border-radius: 3px; }
.cv-kick-election img { width: 18px; height: 18px; object-fit: contain; pointer-events: none; }
.cv-kick-k { font-weight: 900; pointer-events: none; }
.cv-field-overlay {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; color: #d8e6d2; pointer-events: none;
}
.cv-hint { margin-top: 0.6rem; font-size: max(var(--ui-min-text-size, 12px), 0.74rem); color: #9fb79a; }
.cv-log-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 0.35rem; padding: 0.25rem 0.7rem; font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: #9a9a90; background: #262626; }
/* App.vue's global .shell { user-select:none } carve-out lists .log-panel, not Classic's .cv-log-body — re-enable text selection so log/chat stays copyable (owner UX; Fives twin note 902eeb74). */
.cv-log-body { flex: 1 1 0; min-height: 0; overflow-y: auto; padding: 0.3rem 0.7rem; user-select: text; -webkit-user-select: text; }
.cv-log-line { font-size: inherit; line-height: 1.35; color: #cfcfc4; }
.cv-log-line[data-kind='system'] { color: #9a9a90; }
.cv-log-empty { font-size: inherit; color: #6a6a60; }
/* FC3 player-pick bar — a classic grey Swing strip at the bottom-centre; the
   eligible-player crosshairs live on the pitch (renderer), this carries the prompt. */
.cv-pickbar {
  position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 115;
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.4rem 0.7rem; max-width: 90vw;
  background: #d8d4cc; color: #000; border: 2px solid #3a3a36; border-radius: 3px;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.5); font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem);
}
.cv-pick-prompt { font-weight: 700; }
.cv-pick-count { font-size: max(var(--ui-min-text-size, 12px), 0.76rem); color: #333; }
.cv-pick-btn {
  padding: 0.28rem 0.7rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: #000; cursor: pointer;
  background: linear-gradient(180deg, #f4f1ea, #ddd8ce); border: 1px solid #8a857b; border-radius: 3px;
}
.cv-pick-btn:hover:not(:disabled) { background: linear-gradient(180deg, #fffdf7, #e6e1d7); }
.cv-pick-btn:disabled { opacity: 0.5; cursor: default; }
.cv-pick-btn.confirm { border-color: #4c7a4c; }
.cv-pick-btn.decline { border-color: #9a4141; }
/* FC3 interactive setup panel — classic grey Swing panel, bottom-left. */
.cv-setup {
  position: fixed; left: 14px; bottom: 14px; z-index: 116; width: 232px;
  background: #d8d4cc; color: #000; border: 2px solid #3a3a36; border-radius: 3px;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.5); padding: 0.5rem 0.6rem; font-size: max(var(--ui-min-text-size, 12px), 0.78rem);
}
.cv-setup-title { font-weight: 700; margin-bottom: 0.35rem; }
.cv-setup-cond { list-style: none; margin: 0 0 0.4rem; padding: 0; }
.cv-setup-cond li { font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: #7a1c1c; line-height: 1.5; }
.cv-setup-cond li[data-ok='true'] { color: #1d431d; }
.cv-setup-note { font-size: max(var(--ui-min-text-size, 12px), 0.68rem); color: #333; margin-bottom: 0.35rem; line-height: 1.4; }
.cv-setup-note[data-solid-defence-error] { color: #7a1c1c; font-weight: 700; }
.cv-setup-note[data-setup-error] { color: #7a1c1c; font-weight: 700; }
.cv-setup-note[data-setup-error] ul { margin: 0.25rem 0 0; padding-left: 1.1rem; }
.cv-setup-reslabel { font-size: max(var(--ui-min-text-size, 12px), 0.68rem); color: #333; margin-bottom: 0.25rem; }
.cv-setup-reserves { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-bottom: 0.45rem; max-height: 8rem; overflow-y: auto; }
.cv-setup-chip {
  font-size: max(var(--ui-min-text-size, 12px), 0.68rem); padding: 0.2rem 0.36rem; color: #000; cursor: pointer;
  background: #efeae0; border: 1px solid #8a857b; border-radius: 3px;
}
.cv-setup-chip b { margin-right: 0.22rem; }
.cv-setup-chip[data-sel='true'] { border-color: #b8942f; background: linear-gradient(180deg, #fbeec2, #f0d98f); }
.cv-setup-empty { font-size: max(var(--ui-min-text-size, 12px), 0.68rem); color: #6a6a60; }
.cv-setup-actions { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.cv-setup-btn {
  padding: 0.28rem 0.5rem; font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: #000; cursor: pointer;
  background: linear-gradient(180deg, #f4f1ea, #ddd8ce); border: 1px solid #8a857b; border-radius: 3px;
}
.cv-setup-btn:hover:not(:disabled) { background: linear-gradient(180deg, #fffdf7, #e6e1d7); }
.cv-setup-btn:disabled { opacity: 0.5; cursor: default; }
.cv-setup-btn.done { border-color: #4c7a4c; }
.cv-setup-btn.concede { border-color: #9a4141; }
/* Block Roll dialog — the FUMBBL block-die face art (tumble then select). */
.cv-block-dice { display: flex; gap: 10px; justify-content: center; padding: 2px 0 4px; }
.cv-block-die {
  box-sizing: border-box; width: 58px; height: 58px; overflow: hidden; padding: 0;
  background: #f0ece2; border: 2px solid #8a857b; border-radius: 6px; cursor: pointer;
  line-height: 0;
}
.cv-block-die:hover:not(:disabled) { border-color: #b8942f; background: #fbf6ea; }
.cv-block-die[data-armed='true'] { border-color: #e0555a; box-shadow: 0 0 0 2px #e0555a44; }
.cv-block-die.cv-block-die-choice { border-color: #f5c542; box-shadow: 0 0 0 3px #f5c54299, 0 0 12px #f5c54288; opacity: 1; }
.cv-block-die:disabled { cursor: default; }
/* Uphill phase-one and nonchooser dice are informational, so read-only: dimmed, not-allowed cursor. */
.cv-block-die[data-readonly='true']:not(.cv-block-die-choice) { opacity: 0.72; cursor: not-allowed; }
.cv-block-die[data-readonly='true'].cv-block-die-choice { cursor: default; }
.cv-block-die img {
  display: block; width: 100%; height: 100%; object-fit: contain;
  image-rendering: pixelated; transform: scale(1.16);
}
.cv-block-hint { text-align: center; font-size: max(var(--ui-min-text-size, 12px), 0.72rem); color: #333; margin-top: 2px; }
/* Right-click Block context menu (block-dice preview). */
.cv-ctx-backdrop { position: absolute; inset: 0; z-index: 40; }
.cv-ctxmenu {
  position: absolute; z-index: 41; min-width: 118px;
  background: #d8d4cc; color: #000; border: 1px solid #3a3a36; border-radius: 3px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5); padding: 2px;
  font-family: Arial, Helvetica, sans-serif; font-size: max(var(--ui-min-text-size, 12px), 0.76rem);
}
.cv-ctx-item {
  display: block; width: 100%; text-align: left; padding: 0.3rem 0.6rem;
  background: transparent; border: none; color: #000; cursor: pointer; border-radius: 2px;
}
.cv-ctx-item:hover:not(:disabled) { background: #c2beb4; }
.cv-ctx-item:disabled { opacity: 0.42; cursor: default; }
/* Game browser modal (classic-styled) — the shell Browse entry. */
.cv-browse-backdrop {
  position: fixed; inset: 0; z-index: 130; background: rgba(6, 8, 12, 0.55);
  display: flex; align-items: flex-start; justify-content: center; padding-top: 8vh;
}
.cv-browse {
  width: min(760px, 92vw); max-height: 80vh; display: flex; flex-direction: column;
  background: #26262a; color: #e6e2d8; border: 1px solid #555; border-radius: 5px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6); font-family: Arial, Helvetica, sans-serif;
}
/* LIVE-PLAYTEST FIX: connection-closed modal (classic-styled, reuses cv-browse-backdrop). */
.cv-conn-closed {
  width: min(380px, 90vw); background: #26262a; color: #e6e2d8; border: 1px solid #6a5a2a;
  border-radius: 6px; padding: 1.3rem 1.5rem; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  font-family: Arial, Helvetica, sans-serif; text-align: center; margin-top: 4vh;
}
.cv-conn-closed-title { margin: 0 0 0.6rem; font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem); color: #cdb36a; }
.cv-conn-closed-status { display: flex; align-items: center; justify-content: center; gap: 0.5rem; margin: 0.5rem 0 0; font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); line-height: 1.5; }
.cv-conn-closed-actions { display: flex; gap: 0.6rem; justify-content: center; margin-top: 1rem; }
.cv-conn-btn { padding: 0.4rem 1rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); background: #3d3d3d; color: #e6e2d8; border: 1px solid #5a5a5a; border-radius: 3px; cursor: pointer; }
.cv-conn-btn:hover { background: #474747; }
.cv-conn-btn.primary { background: #6a5a2a; border-color: #cdb36a; color: #fff; }
.cv-conn-btn.primary:hover { background: #7a682f; }
.cv-endgame-phase {
  position: fixed; top: 0.75rem; left: 50%; transform: translateX(-50%); z-index: 70;
  padding: 0.35rem 0.8rem; border: 1px solid #6a5a2a; border-radius: 3px;
  background: #26262a; color: #cdb36a; font: 700 0.78rem Arial, Helvetica, sans-serif;
  letter-spacing: 0.04em;
}
/* CLASSIC ALIGNMENT (audit G3): BB2025 penalty-shootout summary — classic grey-Swing skin. */
.cv-ps {
  width: min(420px, 92vw); background: #26262a; color: #e6e2d8; border: 1px solid #6a5a2a;
  border-radius: 6px; padding: 1.2rem 1.4rem; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  font-family: Arial, Helvetica, sans-serif; text-align: center; margin-top: 4vh;
  display: flex; flex-direction: column; align-items: center; gap: 0.7rem;
}
.cv-ps-title { font-size: max(var(--ui-min-primary-text-size, 16px), 1.2rem); font-weight: 800; letter-spacing: 0.03em; color: #cdb36a; }
.cv-ps-score { display: flex; align-items: baseline; gap: 0.8rem; font-weight: 700; }
.cv-ps-team { font-size: max(var(--ui-min-primary-text-size, 16px), 1rem); opacity: 0.65; }
.cv-ps-team[data-win="true"] { opacity: 1; color: #cdb36a; }
.cv-ps-tally { font-size: max(var(--ui-min-primary-text-size, 16px), 1.5rem); color: #fff; }
.cv-ps-rounds {
  list-style: none; margin: 0; padding: 0.5rem 0.9rem; width: 100%;
  display: flex; flex-direction: column; gap: 0.35rem;
  background: #1e1e22; border: 1px solid #4a4436; border-radius: 5px;
}
.cv-ps-round {
  display: grid; grid-template-columns: 3.2rem 1.6rem 1.4rem 1.6rem 1fr;
  align-items: center; gap: 0.5rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); color: #d8d0bc;
}
.cv-ps-round-label { color: #a99f7e; font-size: max(var(--ui-min-text-size, 12px), 0.72rem); text-transform: uppercase; letter-spacing: 0.04em; text-align: left; }
.cv-ps-roll { text-align: center; font-weight: 800; color: #cfc6ab; }
.cv-ps-roll[data-win="true"] { color: #7fe07f; }
.cv-ps-roll { --d6-size: 1.7rem; justify-self: center; }
.cv-log-d6 { --d6-size: 1.65em; margin: -0.26em 0.06em -0.18em; }
.cv-dlg-roll { --d6-size: 1.8em; }
.cv-ps-vs { text-align: center; color: #7a7258; font-size: max(var(--ui-min-text-size, 12px), 0.72rem); }
.cv-ps-round-win { color: #cdb36a; text-align: right; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); }
.cv-ps-result { font-size: max(var(--ui-min-primary-text-size, 16px), 1.02rem); font-weight: 700; color: #cdb36a; }
.cv-ps-confirm { margin-top: 0.2rem; }
/* CLASSIC ALIGNMENT (audit G2a): MVP nomination roster modal — classic grey-Swing skin. */
.cv-mvp {
  width: min(440px, 92vw); max-height: 80vh; background: #26262a; color: #e6e2d8;
  border: 1px solid #6a5a2a; border-radius: 6px; padding: 1.1rem 1.2rem;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6); font-family: Arial, Helvetica, sans-serif;
  display: flex; flex-direction: column; gap: 0.6rem; margin-top: 4vh;
}
.cv-mvp-title { font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem); font-weight: 800; color: #cdb36a; text-align: center; }
.cv-mvp-sub { font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: #a99f7e; text-align: center; margin-top: -0.2rem; }
.cv-mvp-list {
  list-style: none; margin: 0; padding: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 0.25rem;
  border: 1px solid #4a4436; border-radius: 5px; background: #1e1e22; padding: 0.4rem;
}
.cv-mvp-cand {
  width: 100%; display: grid; grid-template-columns: 2rem 1fr auto 1.2rem;
  align-items: center; gap: 0.5rem; padding: 0.35rem 0.5rem; text-align: left;
  background: #2c2c31; color: #e6e2d8; border: 1px solid #45454c; border-radius: 4px;
  cursor: pointer; font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem);
}
.cv-mvp-cand:hover { background: #34343a; }
.cv-mvp-cand[data-sel="true"] { background: #4a3f1c; border-color: #cdb36a; box-shadow: 0 0 0 1px #cdb36a inset; }
.cv-mvp-nr { color: #cfc6ab; text-align: center; }
.cv-mvp-name { color: #f0ece0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-mvp-pos { color: #a99f7e; font-size: max(var(--ui-min-text-size, 12px), 0.72rem); }
.cv-mvp-check { color: #7fe07f; font-weight: 800; text-align: center; }
.cv-mvp-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 0.2rem; }
.cv-mvp-count { font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); color: #cfc6ab; }
.cv-mvp-confirm:disabled { opacity: 0.45; cursor: not-allowed; }
/* CLASSIC ALIGNMENT (audit G2b): permanent end-game result panel — classic grey-Swing skin. */
.cv-endgame {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 120;
  width: min(520px, 94vw); background: #26262a; color: #e6e2d8; border: 1px solid #6a5a2a;
  border-radius: 7px; padding: 1.3rem 1.5rem; box-shadow: 0 14px 46px rgba(0, 0, 0, 0.7);
  font-family: Arial, Helvetica, sans-serif; display: flex; flex-direction: column; gap: 0.8rem;
}
.cv-eg-title { font-size: max(var(--ui-min-primary-text-size, 16px), 0.85rem); letter-spacing: 0.14em; text-transform: uppercase; color: #a99f7e; text-align: center; }
.cv-eg-score { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 0.8rem; }
.cv-eg-team { text-align: center; opacity: 0.7; }
.cv-eg-team[data-win="true"] { opacity: 1; }
.cv-eg-name { font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem); font-weight: 800; color: #e6e2d8; }
.cv-eg-team[data-win="true"] .cv-eg-name { color: #cdb36a; }
.cv-eg-coach { font-size: max(var(--ui-min-text-size, 12px), 0.75rem); color: #a99f7e; }
.cv-eg-tally { font-size: max(var(--ui-min-primary-text-size, 16px), 2rem); font-weight: 900; color: #fff; white-space: nowrap; }
.cv-eg-dash { color: #7a7258; margin: 0 0.4rem; }
.cv-eg-verdict { text-align: center; font-size: max(var(--ui-min-primary-text-size, 16px), 1.05rem); font-weight: 700; color: #cdb36a; }
.cv-eg-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0.7rem; }
.cv-eg-actions { display: flex; gap: 10px; justify-content: center; margin-top: 0.7rem; }
.cv-eg-col { background: #1e1e22; border: 1px solid #4a4436; border-radius: 5px; padding: 0.6rem 0.7rem; display: flex; flex-direction: column; gap: 0.4rem; }
.cv-eg-col-team { font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); font-weight: 700; color: #d8d0bc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-eg-mvp { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.3rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); }
.cv-eg-mvp-label { font-size: max(var(--ui-min-text-size, 12px), 0.68rem); text-transform: uppercase; letter-spacing: 0.06em; color: #a99f7e; }
.cv-eg-mvp-name { color: #7fe07f; font-weight: 700; }
.cv-eg-mvp-pos { color: #a99f7e; font-weight: 400; }
.cv-eg-mvp-none { color: #7a7258; }
.cv-eg-stats { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.2rem; }
.cv-eg-stats li { display: flex; justify-content: space-between; font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem); color: #cfc6ab; }
.cv-eg-stats li b { color: #f0ece0; }
.cv-conn-spinner {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid #cdb36a55; border-top-color: #cdb36a;
  animation: cv-conn-spin 0.8s linear infinite;
}
@keyframes cv-conn-spin { to { transform: rotate(360deg); } }
/* LIVE-PLAYTEST FIX: unknown-call diagnostic panel (classic-styled port of SpectateView's
   .unknown-call — fixed position, no drag/resize, same content). */
.cv-unknown-call {
  position: fixed; z-index: 119; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 360px; max-height: 80vh; overflow: auto;
  background: #26262a; border: 1px solid #b06a2e; border-radius: 6px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6); font-family: Arial, Helvetica, sans-serif;
}
.cv-uc-head { padding: 0.5rem 0.8rem; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); font-weight: 800; color: #ffcf6a; background: #3a2410; border-radius: 5px 5px 0 0; }
.cv-uc-body { padding: 0.7rem 0.8rem; display: flex; flex-direction: column; gap: 0.5rem; }
.cv-uc-body p { margin: 0; font-size: max(var(--ui-min-text-size, 12px), 0.76rem); color: #e6e2d8; line-height: 1.4; }
.cv-uc-args { font-size: max(var(--ui-min-text-size, 12px), 0.7rem); color: #c8c2b6; }
.cv-uc-args-label { font-weight: 700; color: #ffcf6a; margin-right: 0.25rem; }
.cv-uc-args code { color: #9fd0ff; word-break: break-word; }
.cv-uc-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.cv-uc-btn {
  padding: 0.3rem 0.6rem; font-size: max(var(--ui-min-text-size, 12px), 0.7rem); font-weight: 700; color: #e6e2d8;
  background: #3d3d3d; border: 1px solid #5a5a5a; border-radius: 4px; cursor: pointer;
}
.cv-uc-btn:hover { background: #474747; }
.cv-uc-btn.coord { background: #6a5a2a; border-color: #cdb36a; }
.cv-uc-btn.dismiss { background: #7a2a2a; border-color: #b04040; }
.cv-uc-status { font-size: max(var(--ui-min-text-size, 12px), 0.68rem); color: #7ee59a; }
.cv-uc-describe { display: flex; flex-direction: column; gap: 0.2rem; font-size: max(var(--ui-min-text-size, 12px), 0.7rem); color: #c8c2b6; }
.cv-uc-describe textarea {
  width: 100%; box-sizing: border-box; resize: vertical; font-size: max(var(--ui-min-text-size, 12px), 0.74rem);
  background: #1c1c1c; color: #e6e2d8; border: 1px solid #555; border-radius: 3px; padding: 0.3rem;
}
.cv-uc-coord-prompt { font-size: max(var(--ui-min-text-size, 12px), 0.74rem); font-weight: 700; color: #ffd76a; }
.cv-uc-foot { display: flex; justify-content: flex-end; }
.cv-browse-bar { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.7rem; border-bottom: 1px solid #444; }
.cv-browse-servers { display: flex; }
.cv-browse-servers button {
  padding: 0.3rem 0.7rem; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); background: #333; color: #cfcac0; border: 1px solid #555; cursor: pointer;
}
.cv-browse-servers button:first-child { border-radius: 3px 0 0 3px; }
.cv-browse-servers button:last-child { border-radius: 0 3px 3px 0; border-left: none; }
.cv-browse-servers button[data-active='true'] { background: #3a5a3a; color: #eaf5ea; border-color: #4c7a4c; }
.cv-browse-filter { flex: 1; padding: 0.32rem 0.5rem; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); background: #1c1c1c; color: #e6e2d8; border: 1px solid #555; border-radius: 3px; }
.cv-browse-x { width: 1.8rem; height: 1.7rem; background: #3a3a3a; color: #e6e2d8; border: 1px solid #555; border-radius: 3px; cursor: pointer; }
.cv-browse-x:hover { background: #474747; }
.cv-browse-entry { display: flex; flex-wrap: wrap; gap: 0.4rem; padding: 0.5rem 0.7rem; border-bottom: 1px solid #444; }
.cv-browse-entry input { padding: 0.32rem 0.5rem; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); background: #1c1c1c; color: #e6e2d8; border: 1px solid #555; border-radius: 3px; }
.cv-browse-entry input[type='number'] { width: 110px; }
.cv-browse-entry button {
  padding: 0.32rem 0.7rem; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); background: #3d3d3d; color: #e6e2d8; border: 1px solid #5a5a5a; border-radius: 3px; cursor: pointer;
}
.cv-browse-entry button:hover { background: #474747; }
.cv-browse-demo { background: #3a4a2a !important; border-color: #6a7c4a !important; }
.cv-browse-hint { padding: 0.6rem 0.8rem; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); color: #b7b7ad; }
.cv-browse-list { width: 100%; overflow-y: auto; border-collapse: collapse; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); }
.cv-browse-list { display: block; overflow-y: auto; }
.cv-browse-row { cursor: pointer; border-bottom: 1px solid #383838; }
.cv-browse-row:hover { background: #30343c; }
.cv-browse-row td { padding: 0.3rem 0.6rem; }
.cv-browse-id { color: #cdb36a; font-variant-numeric: tabular-nums; }
.cv-browse-score { color: #9fb79a; font-weight: 700; }
.cv-browse-row em { color: #9a9a90; font-style: normal; }
/* FC4 effects (opt-in): turnover splash — team-tinted centred band. */
.cv-turn-boundary-stack {
  --turn-boundary-banner-height: 74px;
  --turn-boundary-toast-height: 64px;
  --turn-boundary-gap: 8px;
  --turn-boundary-stack-height: calc(var(--turn-boundary-banner-height) + var(--turn-boundary-gap) + var(--turn-boundary-toast-height));
  --turn-toast-inset: clamp(12px, 6vw, 72px);
  --turn-toast-side-room: clamp(24px, 12vw, 144px);
  position: fixed;
  z-index: 118;
  left: 0;
  right: 0;
  top: max(8px, min(26%, calc(100% - var(--turn-boundary-stack-height) - 8px)));
  display: grid;
  grid-template-rows: var(--turn-boundary-banner-height) var(--turn-boundary-toast-height);
  row-gap: var(--turn-boundary-gap);
  pointer-events: none;
}
.cv-turn-boundary-banner-slot {
  height: 100%;
  display: grid;
  place-items: center;
}
.cv-turnover {
  height: 100%;
  box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center; gap: 0.05rem;
  padding: 0.5rem 2.4rem; color: #fff; font-family: Nuffle, Arial, sans-serif;
  border-radius: 4px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5); pointer-events: none;
  animation: cv-turnover-in var(--p-classic-turnover) ease-out;
}
.cv-turnover[data-side='home'] { background: linear-gradient(180deg, #a02020, #6a1010); }
.cv-turnover[data-side='away'] { background: linear-gradient(180deg, #2040a0, #10206a); }
.cv-turnover-txt { font-size: max(var(--ui-min-primary-text-size, 16px), 1.6rem); font-weight: 800; letter-spacing: 0.06em; text-shadow: 0 2px 3px rgba(0, 0, 0, 0.6); }
.cv-turnover-sub { font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); opacity: 0.9; }
@keyframes cv-turnover-in { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
/* informationOkay / defenderAction notices (live-playtest fix) — a small ephemeral
   toast stack, top-centre, non-blocking (mirrors SpectateView's chat-toast styling). */
.cv-toast-stack {
  position: fixed; left: 50%; top: 3.2rem; transform: translateX(-50%); z-index: 117;
  display: flex; flex-direction: column; align-items: center; gap: 0.3rem; pointer-events: none;
}
.cv-toast {
  background: rgba(28, 28, 28, 0.92); color: #e6e2d8; border: 1px solid #6a6a5a;
  border-radius: 4px; padding: 0.35rem 0.8rem; font-size: max(var(--ui-min-text-size, 12px), 0.78rem); text-align: center;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.4); animation: cv-toast-in 0.2s ease-out;
}
.cv-prayer-portrait {
  width: 64px; height: 64px; object-fit: contain; image-rendering: pixelated;
  border: 1px solid #d9ae43; border-radius: 5px; background: #101217;
}
.cv-prayer-announcement { display: grid; gap: 7px; min-width: 0; }
.cv-prayer-announcement-head {
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.2rem);
  font-weight: 700;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.cv-prayer-announcement-effect {
  font-size: max(var(--ui-min-primary-text-size, 16px), 1rem);
  line-height: 1.3;
  overflow-wrap: anywhere;
}
/* Apothecary retains Classic's Swing shell while carrying the same medical hierarchy and
   home/away semantics as Modern. Wire controls remain ClassicDialog-owned. */
.cv-apo-head { display: flex; align-items: center; gap: 0.55rem; margin-bottom: 0.5rem; }
.cv-apo-head img { width: 42px; height: 42px; object-fit: contain; image-rendering: pixelated; border: 1px solid #718075; background: #e7e4dc; }
.cv-apo-head > span { display: flex; min-width: 0; flex-direction: column; }
.cv-apo-head b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-apo-head small { color: #3e4840; }
.cv-apo-skills { margin: -0.15rem 0 0.5rem; padding-top: 0.35rem; }
.cv-apo-skills :deep(.skill-chip) { font-size: max(var(--ui-min-text-size, 12px), 0.7rem); }
.cv-apo-injuries { display: flex; flex-direction: column; gap: 0.3rem; }
.cv-apo-injury { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.32rem 0.45rem; border: 1px solid #9b817c; background: #eee9e1; }
.cv-apo-injury span { color: #8a2222; font-size: max(var(--ui-min-text-size, 12px), 0.72rem); font-weight: 800; text-transform: uppercase; }
.cv-apo-injury.ko span { color: #8a5b13; }
.cv-apo-result-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.45rem; }
.cv-apo-result-grid > div { display: flex; min-width: 0; flex-direction: column; align-items: center; gap: 0.15rem; padding: 0.45rem; border: 1px solid #978b71; background: #eee9e1; text-align: center; }
.cv-apo-result-grid > div:last-child { border-color: #668269; }
.cv-apo-result-grid > div.selected { outline: 2px solid #a37510; outline-offset: 1px; box-shadow: 0 0 8px #d4aa42; }
.cv-apo-result-grid small { color: #59564e; font-weight: 800; text-transform: uppercase; }
.cv-apo-result-grid span { color: #59564e; font-size: max(var(--ui-min-text-size, 12px), 0.68rem); }
:deep(.cv-apo-dialog.seat-local .cd-panel) { border-left: 4px solid #496fdd; }
:deep(.cv-apo-dialog.seat-opposition .cd-panel) { border-left: 4px solid #cf4545; }
:deep(.cv-apo-dialog.seat-home .cd-panel) { border-left: 4px solid var(--seat-home-mid, #003eb3); }
:deep(.cv-apo-dialog.seat-away .cd-panel) { border-left: 4px solid var(--seat-away-mid, #b30000); }
.cv-apo-auto-bench { margin-top: 0.5rem; padding: 0.38rem 0.5rem; color: #164d26; border: 1px solid #6b8d72; background: #e1efe4; text-align: center; }
@keyframes cv-toast-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
.cv-kickoff-cine {
  position: absolute; z-index: 116; top: 8%; left: 50%; transform: translateX(-50%);
  min-width: 250px; display: flex; align-items: center; justify-content: center; gap: 0.7rem;
  padding: 0.65rem 1rem; color: #f0ece0; background: rgba(30, 30, 34, 0.96);
  border: 1px solid #cdb36a; border-radius: 5px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.65);
}
.cv-kickoff-cine img { max-height: 48px; max-width: 150px; object-fit: contain; }
.cv-cine-dice { display: flex; gap: 0.3rem; --d6-size: 1.8rem; }
/* FC4 replay-control strip stub — thin bottom row mirroring the classic client's
   REPLAY_CONTROL; inert until real replay lands (FC-D5). */
.cv-replay {
  flex: 0 0 auto; display: flex; align-items: center; gap: 0.3rem;
  padding: 0.15rem 0.6rem; background: #1c1c1c; border-top: 1px solid #444;
}
.cv-rp-btn {
  width: 1.5rem; height: 1.2rem; display: flex; align-items: center; justify-content: center;
  background: #333; color: #9a9a90; border: 1px solid #4a4a4a; border-radius: 2px;
  font-size: max(var(--ui-min-text-size, 12px), 0.68rem); cursor: default;
}
.cv-rp-btn:disabled { opacity: 0.5; }
.cv-rp-note { font-size: max(var(--ui-min-text-size, 12px), 0.64rem); color: #6a6a60; margin-left: 0.3rem; }
/* PRE-KICKOFF CINEMATICS (Pellaeon 2026-08-12, owner FC-D3 reversal). Markup + CSS ported
   verbatim from SpectateView; the shared UI vars it references are supplied here from
   Classic's own literal palette (Classic has no --ui-* tokens). Static camera — no zoom. */
.coin-toss, .weather-cine, .kickoff-cine, .fan-cine, .cine-dismiss {
  --ui-accent: #f0cf6a;   /* bright gold, harmonizes with coin #e8b84a/#b8892a */
  --ui-heading: #ece7db;  /* Classic light heading (cf. cv text #e6e2d8) */
  --ui-surface: #2b2b2b;  /* Classic panel surface */
}
.coin-toss {
  position: absolute; z-index: 45; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px;
  background: radial-gradient(ellipse at center, #0008 0%, #0000 60%);
  pointer-events: none; animation: coin-fade 6.2s ease-out forwards;
}
.coin-lift { animation: coin-toss-move 2.4s cubic-bezier(0.3, -0.5, 0.4, 1) forwards; }
.coin { width: 96px; height: 96px; position: relative; transform-style: preserve-3d; animation: coin-flip-heads 2.4s ease-out forwards; }
.coin[data-result='tails'] { animation-name: coin-flip-tails; }
.coin-face {
  position: absolute; inset: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: max(var(--ui-min-primary-text-size, 16px), 3.2rem); font-weight: 900; color: #4a3a10; backface-visibility: hidden;
  background: radial-gradient(circle at 38% 34%, var(--ui-accent) 0%, #e8b84a 55%, #b8892a 100%);
  border: 4px solid #a6791f; box-shadow: 0 8px 22px #000a;
}
.coin-face.tails { transform: rotateX(180deg); }
.coin-skull { width: 62px; height: 62px; image-rendering: pixelated; filter: invert(1); mix-blend-mode: multiply; opacity: 0.9; }
.coin-call {
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem); font-weight: 800; letter-spacing: 0.02em; color: var(--ui-heading);
  text-shadow: 0 2px 6px #000d; display: flex; align-items: center; gap: 8px;
  animation: coin-caption-in 0.3s ease-out forwards;
}
.coin-call-side { display: inline-flex; align-items: center; gap: 6px; color: var(--ui-heading); }
.coin-call-skull { width: 22px; height: 22px; image-rendering: pixelated; background: var(--ui-surface); border-radius: 4px; padding: 1px; }
.coin-caption {
  font-size: max(var(--ui-min-primary-text-size, 16px), 1.4rem); font-weight: 800; color: var(--ui-heading); text-shadow: 0 2px 6px #000d;
  opacity: 0; animation: coin-caption-in 0.4s ease-out 2.5s forwards;
}
@keyframes coin-toss-move { 0% { transform: translateY(60px) scale(0.7); } 45% { transform: translateY(-150px) scale(1.05); } 100% { transform: translateY(0) scale(1); } }
@keyframes coin-flip-heads { 0% { transform: rotateX(0deg); } 100% { transform: rotateX(1800deg); } }
@keyframes coin-flip-tails { 0% { transform: rotateX(0deg); } 100% { transform: rotateX(1980deg); } }
@keyframes coin-caption-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes coin-fade { 0%, 90% { opacity: 1; } 100% { opacity: 0; } }

/* shared dice face (weather / dodgy-snack / fan-factor) */
.wc-die {
  width: 84px; height: 84px; display: grid;
  grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr);
  gap: 4px; padding: 12px; border-radius: 16px;
  background: linear-gradient(150deg, #f4efe4 0%, #d9cfb8 100%);
  border: 3px solid #b8ac90; box-shadow: 0 10px 26px #000a, inset 0 2px 6px #fff8;
}
.wc-die.d3 { width: 68px; height: 68px; padding: 10px; }
.wc-die .pip { border-radius: 50%; background: transparent; align-self: center; justify-self: center; width: 82%; height: 82%; }
.wc-die .pip[data-on='true'] { background: radial-gradient(circle at 38% 34%, #4a4a52 0%, #14141a 80%); box-shadow: inset 0 1px 2px #0008; }
.weather-cine {
  position: absolute; z-index: 45; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px;
  background: radial-gradient(ellipse at center, #0008 0%, #0000 62%);
  pointer-events: none; animation: coin-fade 5.6s ease-out forwards;
}
.wc-dice { display: flex; gap: 30px; }
.wc-die.from-north { animation: wc-drop-north 1s cubic-bezier(0.25, 0.6, 0.3, 1) forwards; }
.wc-die.from-south { animation: wc-drop-south 1s cubic-bezier(0.25, 0.6, 0.3, 1) forwards; }
@keyframes wc-drop-north { 0% { transform: translateY(-60vh) rotate(-220deg) scale(0.6); opacity: 0; } 70% { opacity: 1; } 100% { transform: translateY(0) rotate(0) scale(1); opacity: 1; } }
@keyframes wc-drop-south { 0% { transform: translateY(60vh) rotate(220deg) scale(0.6); opacity: 0; } 70% { opacity: 1; } 100% { transform: translateY(0) rotate(0) scale(1); opacity: 1; } }
.wc-caption { display: flex; align-items: center; gap: 16px; opacity: 0; animation: coin-caption-in 0.4s ease-out 1s forwards; }
.wc-title {
  font-family: 'Nuffle', system-ui, sans-serif; font-size: max(var(--ui-min-primary-text-size, 16px), 1.15rem); font-weight: 800; letter-spacing: 0.18em;
  color: var(--ui-heading); text-shadow: 0 2px 6px #000d; opacity: 0; animation: coin-caption-in 0.4s ease-out 0.15s forwards;
}
.wc-icon { font-size: max(var(--ui-min-primary-text-size, 16px), 2.2rem); line-height: 1; filter: drop-shadow(0 2px 5px #000b); }
.wc-weather { font-size: max(var(--ui-min-primary-text-size, 16px), 1.7rem); font-weight: 800; color: var(--ui-heading); text-shadow: 0 2px 6px #000d; }

.kickoff-cine {
  position: absolute; z-index: 46; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
  background: radial-gradient(ellipse at center, #000a 0%, #0000 66%);
  pointer-events: none; animation: coin-fade 5s ease-out forwards;
}
.ko-splash {
  width: min(64%, 600px); height: auto; filter: drop-shadow(0 12px 30px #000c);
  transform: scale(0.8); opacity: 0; animation: ko-splash-in 0.55s cubic-bezier(0.2, 0.9, 0.3, 1.2) 0.15s forwards;
}
@keyframes ko-splash-in { 0% { transform: scale(0.8) translateY(18px); opacity: 0; } 100% { transform: scale(1) translateY(0); opacity: 1; } }
.ko-name-big {
  font-size: max(var(--ui-min-primary-text-size, 16px), 3.4rem); font-weight: 900; letter-spacing: 0.01em; color: var(--ui-heading);
  text-shadow: 0 3px 14px #000f, 0 0 26px #e8b84a55; transform: scale(0.85); opacity: 0;
  animation: ko-splash-in 0.55s cubic-bezier(0.2, 0.9, 0.3, 1.2) 0.15s forwards;
}
.ko-dice {
  position: absolute; top: 22%; left: 50%; transform: translateX(-50%); z-index: 2;
  display: flex; align-items: center; gap: 16px; opacity: 0; animation: coin-caption-in 0.4s ease-out 0.3s forwards;
}
.ko-die {
  width: 58px; height: 58px; display: grid;
  grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr);
  gap: 3px; padding: 8px; border-radius: 12px;
  background: linear-gradient(150deg, #f4efe4 0%, #d9cfb8 100%);
  border: 3px solid #b8ac90; box-shadow: 0 8px 20px #000a, inset 0 2px 6px #fff8;
}
.ko-die .pip { border-radius: 50%; background: transparent; align-self: center; justify-self: center; width: 82%; height: 82%; }
.ko-die .pip[data-on='true'] { background: radial-gradient(circle at 38% 34%, #4a4a52 0%, #14141a 80%); box-shadow: inset 0 1px 2px #0008; }

.fan-cine {
  position: absolute; z-index: 45; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px;
  background: radial-gradient(ellipse at center, #0008 0%, #0000 62%);
  pointer-events: none; animation: coin-fade 6.4s ease-out forwards;
}
.fan-rolls { display: flex; gap: 60px; }
.fan-side { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px 20px; border-radius: 12px; border: 2px solid #ffffff20; }
.fan-side.home { animation: wc-drop-south 0.9s cubic-bezier(0.25, 0.6, 0.3, 1) forwards; }
.fan-side.away { animation: wc-drop-north 0.9s cubic-bezier(0.25, 0.6, 0.3, 1) forwards; }
.fan-side[data-leader='true'] { background: color-mix(in srgb, var(--ui-accent) 13%, transparent); border-color: color-mix(in srgb, var(--ui-accent) 67%, transparent); box-shadow: 0 0 20px color-mix(in srgb, var(--ui-accent) 27%, transparent); }
.fan-coach { font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem); font-weight: 800; color: var(--ui-heading); text-shadow: 0 2px 5px #000d; }
.fan-math { font-size: max(var(--ui-min-primary-text-size, 16px), 0.95rem); color: #e8e2d0; text-shadow: 0 1px 4px #000d; }
.fan-math b { color: var(--ui-heading); font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem); }
.fan-splash { font-size: max(var(--ui-min-primary-text-size, 16px), 1.5rem); font-weight: 800; color: var(--ui-heading); text-shadow: 0 2px 6px #000d; opacity: 0; animation: coin-caption-in 0.4s ease-out 0.95s forwards; }
.fan-splash b { color: #ffd24a; font-size: max(var(--ui-min-primary-text-size, 16px), 1.8rem); }

.cine-hold { animation: cine-hold-in 0.45s ease-out forwards !important; }
@keyframes cine-hold-in { from { opacity: 0; } to { opacity: 1; } }
.cine-dismiss { position: absolute; inset: 0; z-index: 47; cursor: pointer; }
.cine-dismiss-hint {
  position: absolute; bottom: 7%; left: 50%; transform: translateX(-50%);
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.9rem); font-weight: 700; letter-spacing: 0.14em; color: var(--ui-heading);
  text-shadow: 0 2px 6px #000e; pointer-events: none; animation: cine-hint-pulse 1.4s ease-in-out infinite;
}
@keyframes cine-hint-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
</style>
