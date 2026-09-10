import { Application, Assets, Container, Graphics, Matrix, Mesh, MeshGeometry, Rectangle, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import 'pixi.js/gif';
import type { GifSource } from 'pixi.js/gif';
import { acquireClassicIcons, classicIconFor, resetIconCaches, type ClassicIconLease } from './classicIcons';
import { PIPELINE_TIMINGS } from './blockPipeline';
import { RING_TYPE_COLORS, ringTypeForName } from './positionTypes';
import { SETUP_LOS_X, SETUP_OWN_HALF_MAX_X, WIDE_ZONE_WIDTH } from './setup';
import { loadSprites, spriteFor } from './sprites';
import {
  loadSkillIcons,
  playerSpriteAsset,
  retainPlayerSpriteAsset,
  setBundledSkillBadgeFamily,
  skillBadgePresentation,
  skillIcon,
  type BundledSkillBadgeFamily,
  type SkillIconStyle,
} from './skillIcons';
import { AURA_RADIUS, auraEmitters, bombCells, catchTarget, foulTarget, interceptors, passTargetRoll } from './actions';
import type { GameJson, PlayerDataJson, PlayerJson, TeamJson } from '@fumbbl40k/ffb-protocol';
import { effectiveMovement, playerHasSkill, playerSkillNames, pushedPlayerId } from '@fumbbl40k/ffb-protocol';
import {
  PITCH_COLS,
  PITCH_ROWS,
  TILE_H,
  TILE_W,
  depthScale,
  depthZKey,
  extPoint,
  getOrientation,
  isFieldFlip,
  isFlat,
  isOnPitch,
  type Orientation,
  setFieldFlip,
  setFlat,
  setOrientation,
  setUniformFigures,
  squareAnchor,
  squareEdge,
  squareQuad,
  pitchTextRotation,
  worldHeight,
  worldToSquare,
  worldWidth,
} from './geometry';
import { baseState, blockedDecoration, hasFlag, hasTackleZones, isDown, rendersOnPitch, PlayerStateBase, PlayerStateFlag } from './playerState';
import { APOTHECARY_STATION_LAYOUT, apoBoxState, apothecaryTokenScale, projectedApothecaryLabelPlacement } from './apothecaryBox';
import { budgetAfterPlannedSteps, planPath, reachableSquares, squareKey, type Square } from './movement';

export type PassDestinationKind = 'ball' | 'bomb' | 'stunty';
import { passRange, type PassRange } from './passing';
import { blockDicePreview, type BlockPreview } from './blocks';
import { preSetupPlacements } from './preSetupFormation';
import {
  bundledWalkSheetFor,
  buildWalkerToken,
  isWalkerToken,
  walkerChildScale,
  setWalkCastWeather,
  walkerDecorScale,
  walkerDecorLocalY,
  walkerDrawnFigureHeight,
  walkerFigureRatio,
  placeWalkerDecor,
  WALKER_REFERENCE_FIGURE_PX,
  walkerShadowRadii,
  WALKER_FEET_Y_PX,
  loadBundledWalkSheets,
  refreshWalkerFacing,
  registerLiveWalker,
  resetWalkerFacing,
  setActiveWalkerPlayer,
  settleWalkersIdle,
  setWalkSheetSampling,
  setWalkDisplaySheets,
  setWalkSpriteSnap,
  WALKER_SPRITE_SCALE,
  releaseWalkersOwnedBy,
  tickWalkers,
  walkersNeedTick,
  markWalkersDirty,
  walkSheetFor,
  type FacingGeometry,
  type WalkerHelpers,
  WALKER_TARGET_FIGURE_PX,
} from './walkers';
import { bundledWalkEntriesForRaces, bundledWalkManifest, isBundledStarRole } from './bundledWalk';
import { renderStadiumPack, type RenderedStadium, type StadiumPackManifest } from './stadiumModel';
import {
  DEFAULT_D6_FACE_VARIANT,
  D6_FACE_VALUES,
  d6FaceUrl,
  d6FaceVisualScale,
  isD6FaceValue,
  type D6FaceVariant,
} from './d6';
import { presentationMs, setPresentationMode as configurePresentationMode, type PresentationMode } from './presentationTiming';
import { SPIKE_CURSOR, SPIKE_CURSOR_PRIMED } from './cursors';
import { shadedPlayerPickArrowIds } from './playerPickPresentation';
import { rushTargetForPlayer } from './rushTarget';
import { stadiumStandTileColumn, stadiumStandTileTransform, type StadiumStandSide } from './stadiumTiles';
import { broadcastCameraPlacements } from './stadiumProps';


/** O4/O5: declared-action modes gating what clicks do for the selected player. */
export type ActionMode = 'auto' | 'move' | 'blitz' | 'foul' | 'pass' | 'handoff' | 'bomb';

function isMovingPlayerAction(action: string | null | undefined): boolean {
  return action === 'move' || action === 'blitzMove' || action === 'handOverMove'
    || action === 'passMove' || action === 'foulMove' || action === 'throwTeamMateMove'
    || action === 'kickTeamMateMove' || action === 'gazeMove' || action === 'putridRegurgitationMove'
    || action === 'kickEmBlitz' || action === 'secureTheBall' || action === 'puntMove';
}
/**
 * A server movement is commonly published as two frames: reservation/roll offers first, physical coordinate
 * second. Rebuilding every Pixi token for the first frame adds no visual truth and interrupts the live tween.
 * This predicate is intentionally conservative: it permits a projection-only redraw only while the same moving
 * actor and every physical pitch primitive are unchanged. Any uncertain board mutation falls back to refresh().
 */
export function movementTokenGenerationSignature(game: GameJson | null): string | null {
  if (!game) return null;
  const acting = game.actingPlayer as { playerId?: unknown; playerAction?: unknown } | null | undefined;
  const action = String(acting?.playerAction ?? '');
  if (!isMovingPlayerAction(action)) return null;
  const field = game.fieldModel;
  return JSON.stringify({
    game: [String(game.gameId), game.turnMode, game.homePlaying, game.half],
    acting: [String(acting?.playerId ?? ''), action],
    defenderId: String((game as { defenderId?: unknown }).defenderId ?? ''),
    throwerId: String((game as { throwerId?: unknown }).throwerId ?? ''),
    passCoordinate: game.passCoordinate ?? null,
    weather: field.weather,
    ball: [field.ballCoordinate, field.ballInPlay, field.ballMoving, field.outOfBounds],
    bomb: [field.bombCoordinate, field.bombMoving],
    players: field.playerDataArray.map((data) => [
      data.playerId, data.playerCoordinate, data.playerState, data.cards ?? [], data.cardEffects ?? [],
    ]),
    bloodspots: field.bloodspotArray ?? [],
    trapDoors: field.trapDoors ?? [],
    chomped: field.chomped ?? {},
    fieldMarkers: field.fieldMarkerArray ?? [],
    playerMarkers: field.playerMarkerArray ?? [],
    diceDecorations: field.diceDecorationArray ?? [],
  });
}

export function canReuseMovementTokenGeneration(previous: GameJson | null, next: GameJson | null): boolean {
  const previousSignature = movementTokenGenerationSignature(previous);
  return previousSignature !== null && previousSignature === movementTokenGenerationSignature(next);
}
/** Projectile-throw kinds handled by the single `playThrow` entry (owner 2026-07-14 consolidation;
 *  mirrors upstream AnimationSequenceThrowing). `pass` covers pass + hail-mary-pass; `punt` is a presentation-
 *  only specialization of the wire PASS animation; the bomb kind covers throwBomb + hailMaryBomb. */
export type ThrowKind = 'pass' | 'punt' | 'throwTeamMate' | 'throwBomb' | 'throwARock' | 'throwKeg';

type PresentationStep = {
  playerId: string;
  from: [number, number];
  to: [number, number];
  style: 'walk' | 'hop' | 'trail' | 'slide' | 'hoptrail';
  stepIndex: number;
  stepCount: number;
  /** Authoritative movement spent immediately before/after this confirmed server step. */
  movementUsedBefore?: number;
  movementUsedAfter?: number;
  /** Frozen per-tile duration + whether another confirmed contiguous tile is already buffered. */
  segMs?: number;
  flowToNext?: boolean;
  /** Server confirmed the coordinate, but the entering roll report has not arrived yet. Hold at `from`. */
  rollPending?: boolean;
  occurrenceId?: number;
  sound?: string;
  number?: number | null;
  seq: number;
};

export type MovementIntent = {
  playerId: string;
  from: [number, number];
  to: [number, number];
  /** Authoritative movement already spent when the command was accepted. Null means the wire model omitted it. */
  movementUsedBefore: number | null;
  awaitsRoll: boolean;
  failureConfirmed: boolean;
  latencyObserved: boolean;
  sentAt: number;
  expectedRttMs: number;
  occurrenceId: number;
  seq: number;
};

export type MovementPresentationFence = {
  playerId: string;
  coordinate: [number, number] | null;
  occurrenceId: number;
  phase: 'failed' | 'resolved';
  expectedRttMs: number;
  seq: number;
};

export type MovementPresentationRecovery = {
  gameId: string;
  playerId: string;
  occurrenceId: number;
  expectedRttMs: number;
  seq: number;
};

export type BoardPresentationFence = {
  players: { playerId: string; coordinate: [number, number] | null; playerState: number }[];
  expectedRttMs: number;
  seq: number;
};

type PlayerPresentationCompartment = 'pitch' | 'reserve' | 'ko' | 'cas' | 'banned' | 'removed';

type MovementOverlayLayer = 'reach' | 'path';
type MovementOverlayEntry = {
  node: Container;
  layer: MovementOverlayLayer;
  signature: string;
};

/** Uncommitted Rush costs on reachable squares should inform without competing with players or a queued path. */
const REACHABLE_RUSH_DIE_ALPHA = 1; // owner 09-09: the rest die keeps the moving die's opacity (was 0.6) // owner 09-08: 0.3 read too faint on the board
/** Owner 2026-07-06 / 09-09: a Jump/Leap/Pogo lifts the sprite in one whole-flight arc, paced a touch slower than a
 *  step so it reads as a spring; a pending flag older than the TTL is dropped rather than arcing a later move. */
const LEAP_ARC_PX = 26;
const leapSegmentMs = (): number => presentationMs(210); // read per use: the spectator pacing factor is live
const LEAP_PENDING_TTL_MS = 2500;
/** Owner 09-07: the chest target ring's drawn height in decor-1 units (target-ring-thick-v5 visible bounds). */
const TARGET_H = 18;
/** Owner 09-08: world units (at depth 1) the block dice preview keeps between its bottom edge and the ring top. */
const BLOCK_PREVIEW_RING_GAP = 3;

/** #36 (Yularen 07-16): why a walk-to-contact can/can't be plotted — the reason-returning companion result to
 *  `o66PathToContact`, so callers (SpectateView foul/blitz UX, Classic G1a automove) can distinguish
 *  "victim is surrounded" from "too far this turn" instead of a bare null. `path` is [] unless status==='PATH'
 *  (and even then [] means "already adjacent — no walk needed"). Correct-null CATALOGUE lives on `o66ContactReach`. */
export type O66ContactStatus = 'PATH' | 'SURROUNDED' | 'OUT_OF_RANGE';
export interface O66ContactResult {
  status: O66ContactStatus;
  path: Square[];
}

/** Whether a scatter endpoint is a legal kick landing square. A null set preserves legacy on-pitch-only behavior.
 *  [SOURCE] upstream ffb-server StepKickoffScatterRoll (bb2020) lines ~152-166: the scatter end coordinate is a
 *  TOUCHBACK unless it is in the RECEIVING half — FieldCoordinateBounds.HALF_AWAY when home is playing (kicking),
 *  HALF_HOME when away is; FieldCoordinateBounds.HALF_HOME = (0,0)-(12,14), HALF_AWAY = (13,0)-(25,14),
 *  FIELD = (0,0)-(25,14). In client SEND frame that is always x 13..25, which is exactly the set the store offers
 *  as kickPickSquares. */
export function isLegalKickLandingSquare(x: number, y: number, legal: ReadonlySet<string> | null): boolean {
  const onPitch = x >= 0 && x < PITCH_COLS && y >= 0 && y < PITCH_ROWS;
  return onPitch && (legal === null || legal.has(`${x},${y}`));
}

// Optional FUMBBL pitch-pack ids. No upstream pitch image is compiled into the
// client. These ids become usable only when an explicitly installed asset pack
// supplies the corresponding weather bindings.
const FUMBBL_PITCHES: Record<string, string> = {
  'fumbbl-basic': 'basic',
  'fumbbl-default': 'default',
  'fumbbl-blackbox': 'blackbox',
  'fumbbl-fumbblcup': 'fumbblcup',
  'fumbbl-chaos': 'chaos',
  'fumbbl-darkelf': 'darkelf',
  'fumbbl-goblin': 'goblin',
  'fumbbl-khorne': 'khorne',
  'fumbbl-necromantic': 'necromantic',
  'fumbbl-norse': 'norse',
  'fumbbl-nurgle': 'nurgle',
  'fumbbl-skaven': 'skaven',
  'fumbbl-slaanesh': 'slaanesh',
  'fumbbl-tzeentch': 'tzeentch',
  'fumbbl-vampire': 'vampire',
};
const DEFAULT_WEATHER_TURF = 'default-weather';
/** Bundled weather-responsive pitch families (owner 2026-09-05): the photographic default pack and the
 *  pixel-art pack drawn in the sprite style (PixelLab tiles composed stochastically, mown grass). Both
 *  are local assets — no upstream lookup — keyed `theme` → `weather` → url. */
/** Acasas - Weather pack (owner 2026-09-05): quilted from / referenced on the GameDev Market Licence A grass tile
 *  (docs/licenses/textures.md), so `assets/acasas-weather/` sits on public-export.exclude and is ABSENT from a public
 *  checkout. Globbed rather than literal URLs so a missing folder is an empty map, not a build error; the family is
 *  offered only when all five weathers are present. Installer builds from the private tree carry it. */
const ACASAS_WEATHER_URLS = import.meta.glob<string>('../assets/acasas-weather/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
function optionalWeatherFamily(urls: Record<string, string>): Record<string, string> | null {
  const family: Record<string, string> = {};
  for (const [path, url] of Object.entries(urls)) {
    const match = /\/(blizzard|heat|nice|rain|sunny)\.png$/.exec(path);
    if (match) family[match[1]!] = url;
  }
  return Object.keys(family).length === 5 ? family : null;
}
const ACASAS_WEATHER = optionalWeatherFamily(ACASAS_WEATHER_URLS);
/** Acasas - Weather pack (strong) (owner 2026-09-07): same nice/rain, but sunny/heat/blizzard carry stronger weather
 *  language (yellow-palette sunny with dry patches, cracked earth, snow drifts). Same licence, same glob treatment. */
const ACASAS_WEATHER_FX_URLS = import.meta.glob<string>('../assets/acasas-weather-fx/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
const ACASAS_WEATHER_FX = optionalWeatherFamily(ACASAS_WEATHER_FX_URLS);
/** Owner 09-05: pitch-image families that take the tile turf's team-shaded END ZONES (south x=0 blue, north x=25
 *  red, 90%) drawn over the field image — the Acasas pack ships untinted and gets the same overlay 'Basic' has. */
const END_ZONE_TINT_PITCH_THEMES = new Set(['acasas-weather', 'acasas-weather-fx']);

const BUNDLED_WEATHER_PITCHES: Record<string, Record<string, string>> = {
  [DEFAULT_WEATHER_TURF]: {
    blizzard: new URL('../assets/default-weather/blizzard.png', import.meta.url).href,
    heat: new URL('../assets/default-weather/heat.png', import.meta.url).href,
    nice: new URL('../assets/default-weather/nice.png', import.meta.url).href,
    rain: new URL('../assets/default-weather/rain.png', import.meta.url).href,
    sunny: new URL('../assets/default-weather/sunny.png', import.meta.url).href,
  },
  'pixel-weather': {
    blizzard: new URL('../assets/pixel-weather/blizzard.png', import.meta.url).href,
    heat: new URL('../assets/pixel-weather/heat.png', import.meta.url).href,
    nice: new URL('../assets/pixel-weather/nice.png', import.meta.url).href,
    rain: new URL('../assets/pixel-weather/rain.png', import.meta.url).href,
    sunny: new URL('../assets/pixel-weather/sunny.png', import.meta.url).href,
  },
  ...(ACASAS_WEATHER ? { 'acasas-weather': ACASAS_WEATHER } : {}),
  ...(ACASAS_WEATHER_FX ? { 'acasas-weather-fx': ACASAS_WEATHER_FX } : {}),
  // Owner 09-05: 'Basic' (grass1) = the NEW Acasas grass (the pack's 'nice' field, 64 px per square) in every
  // weather, with NO end-zone tint. Installer builds only — a public checkout keeps the 64 px leafy tile.
  ...(ACASAS_WEATHER ? { grass1: { blizzard: ACASAS_WEATHER.nice!, heat: ACASAS_WEATHER.nice!, nice: ACASAS_WEATHER.nice!, rain: ACASAS_WEATHER.nice!, sunny: ACASAS_WEATHER.nice! } } : {}),
};

/** Owner 09-10: the turf families this BUILD bundles, known before any pitch mounts — the Settings picker seeds its
 *  catalog from this so an installer shows Acasas/Basic from the console (previously a static two-entry list until
 *  the pitch view refreshed it). Pack-bound FUMBBL pitches are added at mount by `turfOptions()`. */
export function bundledTurfOptions(): string[] {
  return [...Object.keys(BUNDLED_WEATHER_PITCHES), ...(BUNDLED_WEATHER_PITCHES.grass1 ? [] : ['grass1'])];
}
function isWeatherPitchTheme(theme: string): boolean {
  return theme in BUNDLED_WEATHER_PITCHES || theme in FUMBBL_PITCHES;
}
let fumbblPitchFallbacks: ReadonlyMap<string, string> = new Map();

/** Register optional pitch fallbacks from an installed local asset pack. */
export function setFumbblPitchFallbacks(bindings: ReadonlyMap<string, string>): void {
  const accepted = new Map<string, string>();
  for (const [key, url] of bindings) {
    const parts = key.split(':');
    if (parts.length !== 2) continue;
    const theme = parts[0]!;
    const weather = parts[1]!;
    if (!(theme in FUMBBL_PITCHES)
      || !['blizzard', 'heat', 'nice', 'rain', 'sunny'].includes(weather) || !url) continue;
    accepted.set(`${theme}:${weather}`, url);
  }
  fumbblPitchFallbacks = accepted;
}
/** Mean perceived luminance (0..1) of RGBA pixels — used to pick grid-line contrast over a pitch image. */
export function meanLuminance(rgba: ArrayLike<number>): number {
  let sum = 0; let n = 0;
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    sum += (0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!) / 255; n++;
  }
  return n ? sum / n : 0.35;
}

/** Contrast-aware grid stroke plan over a pitch image (owner 2026-09-05: the bright core + dark halo
 *  vanished on the snow and sun-bleached pitches). Bright pitches (luminance above the threshold) get a
 *  dark core with a light halo; dark pitches keep the bright core with a dark halo. Alphas are lifted
 *  on bright pitches so the fine across-lines still read. */
export const GRID_BRIGHT_PITCH_LUMINANCE = 0.55;
export function gridStrokePlan(luminance: number, gridColor: number): { halo: number; core: number; haloAlpha: (a: number) => number; coreAlpha: (a: number) => number } {
  if (luminance > GRID_BRIGHT_PITCH_LUMINANCE) {
    return {
      halo: 0xf4f6f0, core: 0x16221a,
      haloAlpha: (a) => Math.min(0.8, a + 0.3),
      coreAlpha: (a) => Math.min(1, a + 0.45),
    };
  }
  return {
    halo: 0x0b0f0b, core: gridColor,
    haloAlpha: (a) => Math.min(0.85, a + 0.35),
    coreAlpha: (a) => Math.min(1, a + 0.3),
  };
}

/** Map an FFB weather string to a pitch-pack weather file key (default nice). */
export function pitchWeatherKey(weather: string | undefined | null): string {
  const w = (weather ?? '').toLowerCase();
  if (w.includes('blizzard')) return 'blizzard';
  if (w.includes('sweltering') || w.includes('heat')) return 'heat';
  if (w.includes('sunny')) return 'sunny';
  if (w.includes('rain') || w.includes('pour')) return 'rain';
  return 'nice';
}

/** Payload for right-click context menus (owner 2026-07-02 UI shortcuts). */
export interface ContextTarget {
  playerId: string;
  square: Square;
  /** relative to the selected player's team (home = "own" when nothing is selected) */
  isOpposition: boolean;
  isHomeTeam: boolean;
  isDown: boolean;
  activationSpent: boolean;
  /** distracted states matter for context-sensitive menu entries */
  isConfused: boolean;
  isHypnotized: boolean;
  /** owner 2026-07-04f: right-clicked an EMPTY square (playerId is '') — the host
   *  shows the Mark… submenu without any player-specific entries. */
  emptySquare?: boolean;
}

/** Kick flight: peak lift (world px) of the ball's high arc when it comes into
 *  play from off-pitch. */
const KICK_ARC_PX = 120;
/** Kick flight: pitch edge -> aimed square. Lineage: 680 (kicker-hop) -> 1150 -> 1800 (owner 2026-07-08 queue 8 /
 *  07-13 "insanely fast") -> 1100 (owner W9 2026-08-13: "the kicks take too long to resolve" — the whole chain
 *  halved, stagger/order untouched). cinematicZoom + crosshair-clear timeouts derive from this, so they scale. */
export const KICK_FLYIN_MS = 1100;
// 900ms keeps a pass clearly readable as a kickoff-style flight while remaining snappier than the 1100ms punt.
export const PASS_BALL_ARC_MS = 900;
// punt/pass ball arc paces off the kick fly-in so a kick-feel tune carries the punt.
export const PUNT_BALL_ARC_MS = KICK_FLYIN_MS;
export function ballThrowArcMs(kind: 'pass' | 'punt'): number {
  return presentationMs(kind === 'punt' ? PUNT_BALL_ARC_MS : PASS_BALL_ARC_MS);
}
/** BB2025 TTM: the thrown player's single flight-arc duration (kick fly-in style). Shared by
 *  playThrow's arm-time merge and the consumption tween in setGame's per-token loop so the two
 *  stay in lockstep (item row29-ttm-anim). */
export const TTM_THROW_MS = 640;

/** Shared server-derived active-player signal; intentionally independent of seat. */
export function activePlayerAuraVisible(activePlayerId: string | null): boolean {
  return activePlayerId !== null;
}

/** Auto Director policy (owner 2026-08-24): a projected, screen-aligned 1-square
 *  dead box around the viewport centre. Ordinary player/ball motion uses a finite
 *  nudge at 2 squares and active tracking at 3+; active-player switches and ball
 *  hand-offs also focus smoothly outside the dead box. Distances are divided by the local
 *  projected tile size, so zoom, orientation and the spectator field flip do not
 *  change the thresholds. */
export const AD_FOLLOW_DEAD_SQ = 1;
export const AD_NUDGE_START_SQ = 2;
export const AD_TRACK_START_SQ = 3;
export const AD_FOLLOW_TAU_MS = 180; // exp time-constant
export const AD_NUDGE_MS = 420;
export const AD_MANUAL_HOLD_MS = 1500;
export const AD_IDLE_DELAY_MS = 10_000;
export const AD_IDLE_MAX_ZOOM_OUT = 0.15;
/** Owner 09-06: the auto director's idle ZOOM-OUT (pull back to fit the central group) is DISABLED — it pans and
 *  follows only; the coach's zoom rung stays where they left it. The pure autoDirectorIdleZoomTarget stays for tests. */
export const AD_IDLE_ZOOM_OUT_ENABLED = false;
export const AD_IDLE_ZOOM_TAU_MS = 1600;
const AD_THRESHOLD_EPSILON_SQ = 0.000001;
const AD_FOLLOW_RELEASE_PX = 0.5; // close enough to centred — disengage
/** Pure per-frame follow step. `offsetPx` = active player's signed screen distance
 *  from a centre axis. `deadPx` is exactly one projected square. The initial
 *  continuous-track threshold is three projected squares; hysteresis still glides
 *  to centre once engaged. Returns the camera correction for this frame and the
 *  next engaged state. */
export function adFollowStep(
  offsetPx: number,
  deadPx: number,
  engaged: boolean,
  dtMs: number,
): { engaged: boolean; correctionPx: number } {
  const trackPx = deadPx * AD_TRACK_START_SQ;
  if (!engaged && Math.abs(offsetPx) < trackPx) return { engaged: false, correctionPx: 0 };
  if (engaged && Math.abs(offsetPx) <= AD_FOLLOW_RELEASE_PX) return { engaged: false, correctionPx: 0 }; // re-centred
  // A throttled/backgrounded frame must not turn an ease into a teleport.
  const alpha = 1 - Math.exp(-Math.min(50, Math.max(0, dtMs)) / AD_FOLLOW_TAU_MS);
  return { engaged: true, correctionPx: offsetPx * alpha };
}

export type AutoDirectorFocusMode = 'idle' | 'nudge' | 'track';

/** Chebyshev distance from the viewport centre in local projected square units.
 *  A value of 1 means the target is on the edge of the 3x3 focus box. */
export function autoDirectorDistanceSquares(
  offsetX: number,
  offsetY: number,
  tileWidthPx: number,
  tileHeightPx: number,
): number {
  return Math.max(
    Math.abs(offsetX) / Math.max(0.001, tileWidthPx),
    Math.abs(offsetY) / Math.max(0.001, tileHeightPx),
  );
}

/** Pure policy transition. A forced nudge is reserved for an active-player switch,
 *  a ball-to-player hand-off, or an explicit event focus request. */
export function autoDirectorFocusMode(
  current: AutoDirectorFocusMode,
  distanceSquares: number,
  moving: boolean,
  forceNudge = false,
  nudgeElapsedMs = 0,
): AutoDirectorFocusMode {
  const atLeast = (threshold: number) => distanceSquares + AD_THRESHOLD_EPSILON_SQ >= threshold;
  if (current === 'track') return distanceSquares <= 0.01 ? 'idle' : 'track';
  if (current === 'nudge') {
    if (moving && atLeast(AD_TRACK_START_SQ)) return 'track';
    if (distanceSquares <= 0.01) return 'idle';
    if (nudgeElapsedMs >= AD_NUDGE_MS) {
      // A new/continued 2-square movement packet seamlessly re-arms the finite
      // nudge. There is no idle frame between bursts and no escalation below 3.
      return moving && atLeast(AD_NUDGE_START_SQ) ? 'nudge' : 'idle';
    }
    return 'nudge';
  }
  if (forceNudge && distanceSquares > AD_FOLLOW_DEAD_SQ + AD_THRESHOLD_EPSILON_SQ) {
    return atLeast(AD_TRACK_START_SQ) ? 'track' : 'nudge';
  }
  if (moving && atLeast(AD_TRACK_START_SQ)) return 'track';
  if (moving && atLeast(AD_NUDGE_START_SQ)) return 'nudge';
  return 'idle';
}

export interface AutoDirectorIdleZoomInput {
  /** Player anchors in renderer-local/world coordinates. */
  points: { x: number; y: number }[];
  worldX: number;
  worldY: number;
  scale: number;
  minScale: number;
  viewportWidth: number;
  viewportHeight: number;
  tilePadding: number;
}

/** Robust central envelope: trim 10% from both tails on each axis. Each axis
 *  retains 80%, so their intersection contains at least 60% of players (a true
 *  majority), while isolated outliers cannot demand a giant zoom change. */
export function autoDirectorCentralEnvelope(points: { x: number; y: number }[]): {
  minX: number; maxX: number; minY: number; maxY: number;
} | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x).sort((a, b) => a - b);
  const ys = points.map((p) => p.y).sort((a, b) => a - b);
  const trim = Math.floor(points.length * 0.1);
  const hi = Math.max(trim, points.length - 1 - trim);
  return { minX: xs[trim]!, maxX: xs[hi]!, minY: ys[trim]!, maxY: ys[hi]! };
}

/** Compute the one-shot idle zoom target. The viewport-centre world point is the
 *  anchor, so applying the returned scale cannot introduce a pan jump. A single
 *  idle episode can reduce scale by at most 15%, and never below camera fit. */
export function autoDirectorIdleZoomTarget(input: AutoDirectorIdleZoomInput): number | null {
  const envelope = autoDirectorCentralEnvelope(input.points);
  if (!envelope || input.scale <= input.minScale + 0.0001) return null;
  const marginX = input.viewportWidth * 0.1;
  const marginY = input.viewportHeight * 0.1;
  const left = input.worldX + (envelope.minX - input.tilePadding) * input.scale;
  const right = input.worldX + (envelope.maxX + input.tilePadding) * input.scale;
  const top = input.worldY + (envelope.minY - input.tilePadding) * input.scale;
  const bottom = input.worldY + (envelope.maxY + input.tilePadding) * input.scale;
  if (left >= marginX && right <= input.viewportWidth - marginX
    && top >= marginY && bottom <= input.viewportHeight - marginY) return null;

  const cx = input.viewportWidth / 2;
  const cy = input.viewportHeight / 2;
  const worldCx = (cx - input.worldX) / input.scale;
  const worldCy = (cy - input.worldY) / input.scale;
  const extentX = Math.max(Math.abs(envelope.minX - worldCx), Math.abs(envelope.maxX - worldCx)) + input.tilePadding;
  const extentY = Math.max(Math.abs(envelope.minY - worldCy), Math.abs(envelope.maxY - worldCy)) + input.tilePadding;
  const desired = Math.min(
    extentX > 0 ? (cx - marginX) / extentX : input.scale,
    extentY > 0 ? (cy - marginY) / extentY : input.scale,
  );
  const capped = Math.max(input.minScale, input.scale * (1 - AD_IDLE_MAX_ZOOM_OUT), desired);
  return capped < input.scale - 0.0001 ? capped : null;
}

export function autoDirectorIdleZoomStep(current: number, target: number, dtMs: number): number {
  const alpha = 1 - Math.exp(-Math.min(50, Math.max(0, dtMs)) / AD_IDLE_ZOOM_TAU_MS);
  return current + (target - current) * alpha;
}

export function staticSelectionHaloVisible(selectedPlayerId: string | null, activePlayerId: string | null): boolean {
  return selectedPlayerId !== null && selectedPlayerId !== activePlayerId;
}

/** Map equality for renderer presentation projections. Map insertion order is not
 * visual state, so compare by key/value membership rather than iteration order. */
function equalStringMap(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value || !b.has(key)) return false;
  return true;
}

/** Skill order is visual state (badge order), while Map insertion order is not. */
function equalStringArrayMap(
  a: ReadonlyMap<string, readonly string[]> | null,
  b: ReadonlyMap<string, readonly string[]> | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.size !== b.size) return false;
  for (const [key, values] of a) {
    const other = b.get(key);
    if (!other || values.length !== other.length) return false;
    for (let i = 0; i < values.length; i++) if (values[i] !== other[i]) return false;
  }
  return true;
}

function equalStringSet(a: ReadonlySet<string> | null, b: ReadonlySet<string> | null): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function equalMoveRollMap(
  a: ReadonlyMap<string, { gfi: number; dodge: number }> | null,
  b: ReadonlyMap<string, { gfi: number; dodge: number }> | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (!other || other.gfi !== value.gfi || other.dodge !== value.dodge) return false;
  }
  return true;
}

function equalPassRollMap(
  a: ReadonlyMap<string, number | { pass?: number; catch?: number }> | null,
  b: ReadonlyMap<string, number | { pass?: number; catch?: number }> | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (typeof value === 'number' || typeof other === 'number') {
      if (value !== other) return false;
    } else if (!other || value.pass !== other.pass || value.catch !== other.catch) return false;
  }
  return true;
}

/** Shared kick-lineage slide position: eased travel plus one sinusoidal whole-flight arc. */
export function kickArcTweenPosition(
  from: { x: number; y: number },
  to: { x: number; y: number },
  easedT: number,
  flightT: number,
  arcPx = KICK_ARC_PX,
): { x: number; y: number } {
  return {
    x: from.x + (to.x - from.x) * easedT,
    y: from.y + (to.y - from.y) * easedT - Math.sin(flightT * Math.PI) * arcPx,
  };
}
/** Kickoff result card display duration AND the apex-hold extension it arms. Owner W9 2026-08-13: 5000 -> 2200
 *  (the two 5000ms holds dominated the 14230ms worst case). Owner 2026-08-17 (gate-bounce-back ruling): 2200 -> 900
 *  — the apex-hold ball-hang was the actual dominant contributor to the "bounce waits too long" report, not the
 *  post-descent settle beat (KICK_BOUNCE_DELAY_MS, left at 120). Conservative first step; further tuning on owner
 *  feel. Owner 2026-09-03: double the readable banner hold from 900 -> 1800ms. Single source
 *  for store.ts + SpectateView.vue — SpectateView.vue:1715 and :4023 both read this same export, so the base hold
 *  and the conditional re-arm stay synchronized automatically. */
export const KICKOFF_CINE_MS = 1800;
// Owner 2026-07-06 (pacing 2): while the kick-off EVENT plays, the ball holds at an
// apex this many px above the aim square, then descends to land after the event.
const KICK_APEX_RISE = 150;
/** Descent: held apex -> aimed square. Owner 2026-07-08 made it slow enough to read as FALLING and HITTING
 *  (440 -> 750), 07-13 took it to 1200; owner W9 2026-08-13: 1200 -> 800 with the rest of the chain. */
const KICK_DESCENT_MS = 800;
// Distinct LANDING beat before the ball scatters, i.e. the wait between the kick arc's descent
// completing (ball touches the aim square) and the bounce hops starting (owner 2026-07-08);
// W9 2026-08-13: 170 -> 120. 2026-08-17: renamed from KICK_LAND_SETTLE_MS for clarity; value held at
// 120 pending owner ruling — see the coordinator gate-bounce-back inventory (this is NOT the dominant
// contributor to the owner's "bounce waits too long" report; the apex-hold/cine window ahead of
// descent is far larger and is the likelier culprit, but touching it risks SR-119).
const KICK_BOUNCE_DELAY_MS = 120;
// Per-square duration for each post-kick scatter hop.
const KICK_HOP_SEGMENT_MS = 100;
// Delay between fly-in completion and the first producerless scatter hop.
const KICK_FLY_HOP_DELAY_MS = 40;
// Tail after the final hop before the kick target and arc gate clear.
const KICK_CLEAR_TAIL_MS = 100;
// Refresh delay after an apex hold expires so descent is guaranteed to start.
const KICK_RELEASE_REFRESH_MS = 100;
/** #174/SR-276: the kickArc barrier's OWN fail-open ceiling -- never the normal release.
 *  Voss found the two renderer paths; Meero verified the signal split (SR-116); owner SR-276 ruled that the cap
 *  must EXCEED the complete legitimate presentation, not compete with it. Re-derived from current tune sources
 *  (owner 2026-09-03: KICKOFF_CINE_MS 900 -> 1800, re-derive below follows automatically):
 *    - producerless `animateKickIn`: 1100 + 40 + 6*100 + 100 = 1840ms;
 *    - held apex/descent: 1100 + 1800 = 2900ms apex window, then the 100ms release refresh and
 *      800 + 120 + 6*100 + 100 = 1620ms descent, hence 4620ms on the normal max-scatter path;
 *    - the same kickoff may legitimately re-arm the 1800ms cine hold once, as late as the first hold's boundary:
 *      2900 + 1800 + 100 + 1620 = 6420ms longest legitimate path.
 *  The true scatter maximum is 6: fumbbl40k-server upstream/master StepKickoffScatterRoll.java:132-136 calls
 *  DiceRoller.rollScatterDistance(), whose DiceRoller.java:215-220 is D6 (Kick reduces it to D3). A 25% diagnostic
 *  margin makes an 8025ms cap, explicitly greater than the 6420ms longest-legit path. Normal release remains
 *  matching onAnimDone('kickDescend','__ball__'); if this fires,
 *  log it as a regression and fail OPEN exactly once. Re-derive every term when any cited tune changes. */
export const KICK_ARC_LONGEST_LEGIT_MS = (KICK_FLYIN_MS + KICKOFF_CINE_MS)
  + KICKOFF_CINE_MS
  + KICK_RELEASE_REFRESH_MS
  + (KICK_DESCENT_MS + KICK_BOUNCE_DELAY_MS + 6 * KICK_HOP_SEGMENT_MS + KICK_CLEAR_TAIL_MS);
export const KICK_ARC_GATE_CAP_MS = Math.ceil(KICK_ARC_LONGEST_LEGIT_MS * 1.25);
export function kickArcLongestLegitMs(): number {
  return (presentationMs(KICK_FLYIN_MS) + presentationMs(KICKOFF_CINE_MS))
    + presentationMs(KICKOFF_CINE_MS)
    + presentationMs(KICK_RELEASE_REFRESH_MS)
    + (presentationMs(KICK_DESCENT_MS) + presentationMs(KICK_BOUNCE_DELAY_MS)
      + 6 * presentationMs(KICK_HOP_SEGMENT_MS) + presentationMs(KICK_CLEAR_TAIL_MS));
}
export function kickArcGateCapMs(): number {
  return Math.ceil(kickArcLongestLegitMs() * 1.25);
}
// The store barrier cap and renderer arc-in-flight cap both read this one value, so they can never diverge again.
// #185 KA-4 (Meero SR-182): fail-open ONLY — this must EXCEED the complete legitimate presentation and never
// compete with it. The value is derived from KICK_ARC_LONGEST_LEGIT_MS; real release stays onAnimDone (A-6).
const arcInFlightCapMs = (): number => kickArcGateCapMs();

/** #185 F-1/KA-1 (Meero SR-182): the kickoff arc-in-flight predicate as a PURE, exported, testable function.
 *  The renderer's inline `arcActive` flag reads its VALUE from here so the branch-priority decision is unit-
 *  testable outside the WebGL renderer — Echo tooth ① (arc-in-flight ⇒ the ground-slide branch must NOT capture
 *  '__ball__', the anti-condition that was silently dead once) and A-2 (branch-decision invariance on spectate
 *  fixtures). True while the fly-in→apex→descend arc owns '__ball__': a descend snapshot is armed, OR the apex
 *  aim / fly-in clock is set, OR the apex-hold wall-clock is unexpired. KA-4 fail-open: once `armedAt` is stamped
 *  the arc self-releases after `capMs` of wall-clock (this fn is called on the refresh path). Pure — `now`/`armedAt`
 *  are passed in (no performance.now() inside), so a tooth drives it with fixed values. */
export function arcInFlight(s: {
  descendArmed: boolean;
  apexAimed: boolean;
  flyStarted: boolean;
  holdUntil: number;
  armedAt: number | null;
  now: number;
  capMs: number;
}): boolean {
  const active = s.descendArmed || s.apexAimed || s.flyStarted || s.now < s.holdUntil;
  if (!active) return false;
  if (s.armedAt != null && s.now - s.armedAt > s.capMs) return false; // KA-4 fail-open cap
  return true;
}

export function presentedBallCoordinate(
  modelBall: [number, number] | null | undefined,
  descend: { landing: [number, number] } | null,
  arcActive: boolean,
): [number, number] | null | undefined {
  return descend && arcActive ? descend.landing : modelBall;
}

/** StepKickoffAnimation.java:81-90 makes its exact fallback origin and model endpoint wire-observable. */
export function authoritativeKickPath(
  origin: readonly [number, number],
  landing: readonly [number, number],
): { origin: [number, number]; landing: [number, number] } {
  return { origin: [origin[0], origin[1]], landing: [landing[0], landing[1]] };
}

export interface ServerKickoffScatterOccurrence {
  kind: 'serverKickoffScatter';
  commandNr: number;
  endpoint: readonly [number, number];
}

/** A kickoffScatter model update publishes the eventual landing but is not a ball-flight command. */
export function isServerKickoffScatterTransition(
  occurrence: ServerKickoffScatterOccurrence | null,
  modelBall: readonly [number, number] | null | undefined,
): boolean {
  return occurrence != null
    && Array.isArray(modelBall)
    && modelBall[0] === occurrence.endpoint[0]
    && modelBall[1] === occurrence.endpoint[1];
}
// ORDER 66 movement interpolation (M1 target 5, Yularen GO 11:3x): per-square token travel cadence. Per the
// contract §4 the MODEL moves instantly at receive time; only the TOKEN animates through the step list — this
// is that tween's speed, and per buffer-plan §57 a per-square tween speed is a RENDERER parameter (sub-beat),
// NOT a buffer count, so it lives here rather than routing through the presentation cursor. Spec-of-record for
// the beat count = apps/tauri/.../beats.ts (STEP_BEAT); the cross-package copy is the documented layering
// (packages/ffb-pitch can't import from apps/tauri). ⚑ M4 FEEL-PASS (owner 2026-07-13): the walk read "super
// quick" NOT because 300 was too fast but because refresh() WIPED in-flight tweens on every model sync — a
// walk tween rarely survived to animate in play (see carriedTweenPos preservation in refresh()). With the
// tween now surviving syncs, the owner set this to 200ms; then (2026-07-14, batch #2 #3) the owner arbitrated
// the ⚑ feel-pass row UP to 400ms (STEP_BEAT 4 × BEAT_MS 100) — a slower, more readable per-square glide.
// ⚑ SYNC-COLLAPSE FIX (batch #3 #5/#15, 2026-07-14 — see order66-buffer-beat-plan.md §6 for the full write-up):
// the single-segment tween still snapped in play. THE COUNT (live wire, game 509): the server DOES send a per-
// square coordinate sync (6 clientMove → 6 deltas) — the deltas EXIST; the collapse is TIMING: immediate-apply
// applies every returning sync in one JS tick, faster than the ticker renders a frame, so each per-square tween
// is set-and-replaced and never animates. THE PRINCIPLE: a complete wire can still present as a collapse — when
// the apply is receive-time-immediate (law), animation MUST be driven from confirmed presentation snapshots,
// never raw inter-sync deltas. The store-paced cursor now owns the acting token one acknowledged square at a
// time; o66MovePath remains only as the no-confirmed-step/passive compatibility fallback.
// owner 2026-07-15: 400ms/square read WAY too slow in the validation build; later live passes settled the
// default at 150ms so the ball/aura remains readable without returning to the 200ms stutter. Per-square segment
// duration of the walk tween.
const STEP_BEAT_MS = 150;
const ACTION_DIE_IN_MS = 180;
const ACTION_DIE_HOLD_MS = 1150;
const ACTION_DIE_OUT_MS = 300;
/** Accepted local movement gets a visible first stride promptly while its authoritative echo is in flight.
 * It may approach, but never complete, the destination square before confirmation. */
// A successful first stride starts from the token's exact live pixels on the next task. The ticker supplies the
// first visible frame; inserting a fixed delay or pixel jump here is the 0→1 "muddy" seam this bridge removes.
const MOVEMENT_INTENT_INITIAL_PROGRESS = 0.06;
const MOVEMENT_INTENT_HOLD_PROGRESS = 0.45;
const MOVEMENT_INTENT_ROLLBACK_MS = 500;
// item3 (owner 08-18): base duration of the acted/activation dim CROSS-FADE. Rides the presentationMs
// family, so spectate/replay lands at ~350ms (260 × 1.33) — the owner's "even transition between the
// two players" — while live keeps the untrimmed 260ms base.
const ACTIVATION_FADE_MS = 260;
const REACH_FADE_OUT_MS = 150;
// item1 scope-add (owner 08-18): both trail marks live in effectsLayer, which paints in INSERTION order —
// so a later step's echo landed ON TOP of an earlier step's number and swallowed the digit. Give the pair
// explicit, adjacent zIndexes with number > echo. Both stay NEGATIVE so every other effectsLayer node (roll
// modals, action dice, signs, flashes — all default zIndex 0) keeps its current position ABOVE the trail, and
// equal-zIndex siblings still sort stably by insertion. The trail's depth relative to TOKENS is unchanged:
// effectsLayer is a whole layer above tokenLayer, and a digit under a piece is hidden by the #194 ② occupancy
// toggle (updateTrailNumberVisibility), not by z.
const TRAIL_ECHO_Z = -2;
const TRAIL_NUMBER_Z = -1;
/** Owner 09-07: the server's EYE_GOUGED player-state bit (view constant moved here with the marker). */
const EYE_GOUGED_BIT = 0x20000;
/** Per-channel mix between two tints (0 = a, 1 = b). */
function mixTint(a: number, b: number, k: number): number {
  const t = Math.min(1, Math.max(0, k));
  const ch = (s: number) => {
    const av = (a >> s) & 0xff;
    const bv = (b >> s) & 0xff;
    return Math.round(av + (bv - av) * t) << s;
  };
  return ch(16) | ch(8) | ch(0);
}
// #153 (owner 07-23, fg-g759): the loose-ball bounce read too fast — add 100ms to each bounce hop so
// the eye can track it. Scoped to the PLAIN ball bounce tween (a single-square loose-ball hop through
// startMoveTween, segmentMsOverride==null) — the tuned kick fly-in/descent parabolas (which pass their
// own segmentMs) and the weather SCATTER_SEG path are left EXACTLY as-is.
const BALL_BOUNCE_EXTRA_MS = 100;
// Owner 2026-07-07: the kick ball GROWS to this scale multiple at its apex, then shrinks
// back to 1× as it descends — a sense of the ball rising high then dropping to the pitch.
const KICK_BALL_GROW = 1.5;
// Owner 08-13 (W31), adjusted 09-02 and 09-03: the projected-square token correction
// (tokenPos) — 10px max at the width edges, falling off linearly to 0 at the pitch's
// width-center. This binds a token's visual centre to the centre of its perspective-
// distorted wing square instead of leaving it riding the outer perimeter.
/** Owner 2026-09-04 (supersedes W31's constant 10 px nudge): an upright sprite is centred on the projected
 *  square by following the trapezoid's slanted midline up to the sprite's visual mid-height. At the wings the
 *  midline drifts ~4.7 px across a 38 px band, so a 31 px figure needs ~2 px — the old fixed 10 px pulled
 *  wing tokens visibly off their squares (probe 09-04: true centre vs nudged position). */
const TOKEN_CENTRE_HEIGHT_PX = WALKER_TARGET_FIGURE_PX / 2;

/** Base player-sprite size (classic set) at Strength 3. Other strengths scale off
 *  this; the ball is sized as a fraction of it. */
const PLAYER_SPRITE_BASE = TILE_W * 0.82;
/** The shared frog sheet carries intentionally generous transparent padding. Compensate at render time so its
 * visible body lands near the footprint of a Strength-1/Snotling token while preserving the sheet and model. */
const FROG_ART_SCALE = 3;
/** Ball sprite = 60% of the base player sprite (owner). */
const BALL_SPRITE_SIZE = PLAYER_SPRITE_BASE * 0.6;
/** Owner 2026-07-08: a CARRIED ball is drawn at this fraction of the loose-ball size and
 *  then multiplied by the CARRIER'S strengthScale, so it stays proportionate on big players
 *  (was a flat 0.6, which read tiny on a Str5 big guy). Tune here. */
const CARRIED_BALL_BASE = 0.8;
/** Owner 09-05: every player token sits with its base toward the BOTTOM of the square — the classic icon,
 *  its checker disc / position letter / number / base ring / prone shadow and the placeholder pair all move down
 *  by this many token-local px (walkers use the same value via WALKER_FEET_Y_PX). +12 read too aggressive.
 *  Owner 09-05 (later): REVERTED for the classic FUMBBL icons — they sat wrong on the square; 0 restores their
 *  original centred placement. Walkers keep their own feet offset (WALKER_FEET_Y_PX). */
const TOKEN_BASE_SHIFT_PX = 0;
/** Per-Strength sprite scale relative to Str 3 (owner spec): 1 −24%, 2 −12%,
 *  3 default, 4 +12%, 5 +24%, 6 +28%. Clamped outside 1..6. */
const STRENGTH_SCALE: Record<number, number> = { 1: 0.76, 2: 0.88, 3: 1, 4: 1.12, 5: 1.24, 6: 1.28 };
function strengthScale(strength: number | undefined): number {
  return STRENGTH_SCALE[Math.max(1, Math.min(6, Math.round(strength ?? 3)))] ?? 1;
}
/** Owner 09-05: walk-sheet tokens carry NO Strength factor for ST 1-4 (the art tiers size them), but the big
 *  guys (treeman, troll, ogre… ST 5+) still read too small at the 60 px art tier — bring the table back for
 *  ST >= 5 only. */
function walkerStrengthScale(strength: number | undefined): number {
  // Owner 09-05 (round 11): NO renderer Strength factor on walkers at all — every non-integer scale destroys the
  // pixel art (the 1.24 ogres read mangled at native). Size tiers live in the ART (big guys are ~60 px, goblins ~47).
  void strength;
  return 1;
}
/** Owner 09-05: ST 7 goblins on a ball-and-chain (the Fanatic positional, Fungus the Loon) are NOT big guys —
 *  their art is goblin-sized, so they are excluded from the walker Strength scaler. */
const WALKER_STRENGTH_SCALE_EXCLUDED = /fanatic|fungus/i;
function walkerStrengthScaleFor(player: PlayerJson, team: TeamJson): number {
  const position = positionNameOf(player, team) ?? '';
  if (WALKER_STRENGTH_SCALE_EXCLUDED.test(position) || WALKER_STRENGTH_SCALE_EXCLUDED.test(String(player.playerName ?? ''))) return 1;
  return walkerStrengthScale(player.strength);
}

const COLORS = {
  grassA: 0x6f7d43, // weathered olive turf (App19 painterly look)
  grassB: 0x67753e,
  endZone: 0x5d6a38,
  line: 0xe8e4d8,
  accent: 0xb03028, // end-zone checkers / markings
  // Owner 2026-07-02: colors follow the END a team defends, matching the
  // end-zone shading — home defends south/near (x=0) = BLUE, away defends
  // north/far (x=25) = RED.
  // UAT 08-23: sampled from the primary blue/red uniform ramps in the live
  // sprite sheet screenshot. Trim lifts the same hue for small log text.
  homeBody: 0x003eb3,
  homeTrim: 0x4a86fe,
  awayBody: 0xb30000,
  awayTrim: 0xfe6666,
  skin: 0xe0b088,
  ball: 0x8a5a2a,
  badge: 0x14161a,
  badgeText: 0xe6e2d8,
  activeRing: 0x80e080,
  // Upstream FieldLayerRangeRuler._COLOR_BY_PASSING_DISTANCE: green/yellow/red/black.
  // Owner palette deliberately uses a four-band green/yellow/orange/red ramp instead of black for Long Bomb.
  passQuick: 0x58d858,
  passShort: 0xf2d230,
  passLong: 0xe88924,
  passBomb: 0xc83232,
};

const PASS_RANGE_COLORS: Record<PassRange, number> = {
  T: 0,
  Q: COLORS.passQuick,
  S: COLORS.passShort,
  L: COLORS.passLong,
  B: COLORS.passBomb,
};

export type PassRulerBand = 'Q' | 'S' | 'L' | 'B' | 'B+';

/** Pure passing-template geometry for the informational hover ruler. B+ extends the terminal Long Bomb colour
 *  beyond the ordinary template so an HMP ruler still reaches every on-pitch square without implying legality. */
export function passRulerBand(from: Square, to: Square): PassRulerBand | null {
  const range = passRange(to[0] - from[0], to[1] - from[1]);
  if (range === 'T') return null;
  return range ?? 'B+';
}

// player numbers: full opacity, dark stroke shadow for legibility over sprites
const NAME_STYLE = new TextStyle({
  fontFamily: 'Nuffle, sans-serif',
  fontSize: 9,
  fontWeight: 'bold',
  fill: 0xffffff,
  stroke: { color: 0x14161a, width: 3 },
});
const BADGE_STYLE = new TextStyle({ fontFamily: 'sans-serif', fontSize: 8, fontWeight: 'bold', fill: COLORS.badgeText });
// owner 08-13: skill badges dim when they'd occlude the player standing behind them, instead of going opaque.
// owner 08-19: full opacity when clear; drop only when a token sits behind the icon.
// owner 08-27: occluded opacity raised 0.5 → 0.8 (badges were dimming too far over tokens).
// owner 09-05: 0.8 → 0.7 (still too opaque over a token).
const BADGE_OCCLUDED_ALPHA = 0.7;
const DISTANCE_STYLE = new TextStyle({
  fontFamily: 'Nuffle, sans-serif',
  fontSize: 22,
  fontWeight: 'bold',
  fill: 0xffffff,
  // owner 2026-07-03 r3: black outline so the on-pitch row markers read over any turf/pitch photo;
  // owner 09-07: 1.25 -> 3 px, a proper outline.
  stroke: { color: 0x000000, width: 3 },
});
/** FUMBBL Classic coloured row-number rails (showRowNumberRails): red = home half,
 *  blue = away half. Heavier outline than DISTANCE_STYLE so the small edge numbers
 *  read over any turf photo. */
const RAIL_HOME_STYLE = new TextStyle({
  fontFamily: 'Nuffle, sans-serif', fontSize: 18, fontWeight: 'bold',
  fill: 0xe8524b, stroke: { color: 0x180404, width: 2 },
});
const RAIL_AWAY_STYLE = new TextStyle({
  fontFamily: 'Nuffle, sans-serif', fontSize: 18, fontWeight: 'bold',
  fill: 0x5a8fe0, stroke: { color: 0x04101c, width: 2 },
});
const DODGE_STYLE = new TextStyle({ fontFamily: 'sans-serif', fontSize: 11, fontWeight: 'bold', fill: 0x1a1a1a });
/** CROWD QUIP / SIGN font. Owner 2026-09-02: system monospace (MXSQUAD retired — its
 *  desktop license does not cover redistributing the .otf in a public source tree). */
const CROWD_FONT = 'ui-monospace, Consolas, "Courier New", monospace';
/** Crowd sign PLACARD text (dark on the white placard — the "I ♥ name" shout-out). */
const CROWD_QUIP_STYLE = new TextStyle({
  fontFamily: CROWD_FONT, fontSize: 15, fontWeight: 'bold', fill: 0x181818, align: 'center',
});
/** Owner 2026-07-08: placard sign lines in a TERMINAL (monospace) font — the emoji
 *  fallback carries the ❤️. Line 1 "I ❤️", line 2 the sized-to-fit name. */
const SIGN_TERMINAL_STYLE = new TextStyle({
  fontFamily: "'Consolas', 'Courier New', 'Segoe UI Emoji', monospace",
  fontSize: 15, fontWeight: 'bold', fill: 0x181818, align: 'center',
});
/** Crowd QUIP text (owner liked this) — WHITE on the Final-Fantasy navy window. */
const CROWD_SIGN_STYLE = new TextStyle({
  fontFamily: CROWD_FONT, fontSize: 15, fontWeight: 'bold', fill: 0xffffff, align: 'center',
  stroke: { color: 0x0a1024, width: 3 },
});
/** Owner 2026-07-04c: armed-action roll chips (PASS 4+ / CATCH 3+ / SKULL 10+). */
const ACTION_CHIP_STYLE = new TextStyle({
  fontFamily: 'sans-serif', fontSize: 12, fontWeight: 'bold', fill: 0xffffff,
  stroke: { color: 0x101418, width: 3 },
});
/** Interceptor tip glyph (a hand with the prohibited slash drawn over it). */
const INTERCEPT_GLYPH_STYLE = new TextStyle({ fontFamily: 'sans-serif', fontSize: 15 });
// Owner 2026-07-09: the 🥾 foul-target boot — larger than the intercept glyph, with a drop shadow
// so it reads over a busy scrum. Scaled by depth at draw time.
const FOUL_CUE_STYLE = new TextStyle({ fontFamily: 'sans-serif', fontSize: 26, dropShadow: { color: 0x000000, alpha: 0.6, blur: 3, distance: 1 } });
// Owner 2026-08-17: the roster-row attention arrow — a bouncing YELLOW ▼ over a token picked from
// the ROSTER panel (not the pitch), same cue family as the foul boot/block crosshair above.
const ROSTER_CUE_STYLE = new TextStyle({ fontFamily: 'sans-serif', fontSize: 22, fill: 0xffd23f, dropShadow: { color: 0x000000, alpha: 0.6, blur: 3, distance: 1 } });
const DUGOUT_LABEL_STYLE = new TextStyle({
  fontFamily: 'Nuffle, sans-serif',
  fontSize: 11,
  fontWeight: 'bold',
  letterSpacing: 2,
  fill: 0xffffff, // owner 2026-07-02: bold white
});
/** Owner 2026-07-07: the SW turn/score/re-roll track — outlined so the numbers read on stone. */
const TURN_TRACK_STYLE = new TextStyle({
  fontFamily: 'Nuffle, sans-serif',
  fontSize: 12,
  fontWeight: 'bold',
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 3, join: 'round' },
});
/** Owner 2026-07-07: emoji header glyphs (clock = turn timer, football = score) — an
 *  emoji-capable font, no stroke. */
const TURN_TRACK_EMOJI_STYLE = new TextStyle({
  fontFamily: '"Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", sans-serif',
  fontSize: 15,
});
const KO_STYLE = new TextStyle({
  fontFamily: 'Nuffle, sans-serif',
  fontSize: 14,
  fontWeight: 'bold',
  fontStyle: 'italic',
  fill: 0xff3030,
  stroke: { color: 0x14161a, width: 3 },
});
// FUMBBL auto-marking tag (UI-6): use a screen-optimized sans face rather than
// the decorative UI font. The lighter outline keeps counters open at pitch scale;
// addMarkingText renders this at high resolution with linear downsampling.
const DEFAULT_MARKING_STYLE = {
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: 12,
  color: 0xf5c542,
} as const;
/** Marker rails may overhang a standard token by a small amount, but never
 * spill into neighbouring squares. Long glyph sequences are horizontally
 * compressed inside this boundary while retaining their selected height. */
const SKILL_MARKING_MAX_WIDTH = PLAYER_SPRITE_BASE * 1.1;
// ball-carrier marker (owner 2026-07-02, queue item 9): KO styling, but the
// text is BLUE and carries no shadow disc
// Owner 2026-07-03: the ball-carrier marker inherits the ball's CYAN aura, so
// the ▼/"BALL" label is cyan (0x22d3ee) to match the halo + the ball's column.
const BALL_MARKER_STYLE = new TextStyle({
  fontFamily: 'Nuffle, sans-serif',
  fontSize: 14,
  fontWeight: 'bold',
  fontStyle: 'italic',
  fill: 0x22d3ee,
  // Owner 2026-07-03: black outline so the "BALL" label reads over any sprite.
  stroke: { color: 0x000000, width: 3 },
});
// Owner 2026-07-06: the bouncing ▼/"BALL" token is drawn 33% smaller.
const BALL_TOKEN_SCALE = 0.67;

export type OffscreenIndicator = { x: number; y: number; angle: number };

/** Project an off-screen point onto its closest point on the inset viewport boundary. The resulting arrow is
 * the shortest screen-edge path back to the exact target; null means the target is already visible. */
export function offscreenIndicatorForTarget(
  target: { x: number; y: number },
  viewport: { width: number; height: number },
  inset = 28,
): OffscreenIndicator | null {
  const width = Number(viewport.width);
  const height = Number(viewport.height);
  if (![target.x, target.y, width, height, inset].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  if (target.x >= 0 && target.x <= width && target.y >= 0 && target.y <= height) return null;
  const left = Math.min(Math.max(0, inset), width / 2);
  const right = Math.max(left, width - left);
  const top = Math.min(Math.max(0, inset), height / 2);
  const bottom = Math.max(top, height - top);
  const x = Math.min(right, Math.max(left, target.x));
  const y = Math.min(bottom, Math.max(top, target.y));
  return {
    x,
    y,
    angle: Math.atan2(target.y - y, target.x - x),
  };
}
// B9-2: gold active-player arrow, matching the HUD current-player arrow
const ACTIVE_MARKER_STYLE = new TextStyle({
  fontFamily: 'Nuffle, sans-serif',
  fontSize: 20,
  fontWeight: 'bold',
  fill: 0xf5c542,
  stroke: { color: 0x14161a, width: 3 },
});
// red skull, styled to match the K.O. text (owner 2026-07-02)
const SKULL_STYLE = new TextStyle({
  fontFamily: 'Nuffle, sans-serif',
  fontSize: 18,
  fontWeight: 'bold',
  fill: 0xff3030,
  stroke: { color: 0x14161a, width: 3 },
});
// Owner 2026-07-04: the on-die CAUSE tag glyph — bold, white, small (readable
// against the badge fill). fontSize is set per-die from the die size.
const DIE_TAG_STYLE = new TextStyle({ fontFamily: 'Arial, sans-serif', fontSize: 12, fontWeight: '900', fill: 0xffffff });
/** Dark glyph for a light badge (the yellow dodge D). */
const DIE_TAG_STYLE_DARK = new TextStyle({ fontFamily: 'Arial, sans-serif', fontSize: 13, fontWeight: '900', fill: 0x14161a });
/** Owner 2026-07-04: where a die cause has an existing SKILL ICON in our set, use
 *  that art as the tag base instead of a hand-drawn glyph. Dodge and Pass remain separate:
 *  their rolls use bundled cause badges, while a skill reroll continues
 *  to resolve the active pack's official skill icon through buildRerollLabel(). */
const DIE_CAUSE_SKILL: Record<string, string> = {
  breatheFire: 'BreatheFire', // owner 08-18: Breathe Fire roll die, tagged with the skill's own icon
  dauntless: 'Dauntless',
  pickup: 'PickUp',
  gfi: 'GFI',
  leap: 'Leap',
  gaze: 'HypnoticGaze',
  // owner 09-09: NO shared 'trait' entry — a confusion roll arrives as `trait:<skill>` and wears that skill's icon
  // (Animal Savagery popped as Really Stupid); a bare 'trait' falls to the '!' glyph below.
};
/** Fallback [badge colour, glyph] for causes with no skill icon (+ the dodge D if its bundled art fails).
 *  owner 09-08: `catch` also left the skill map — the Catch roll wears its own bundled badge (status/catch.png);
 *  the Catch SKILL badge and reroll icons keep their separate rules. */
const DIE_CAUSE_TAG: Record<string, [number, string]> = {
  dodge: [0xf5c518, 'D'], // owner: a YELLOW D
  breakTackle: [0xd06a28, 'BREAK TACKLE'],
  dauntless: [0x3f79b7, 'D'], // compact fallback only while the configured Dauntless icon is unavailable
  timmber: [0x5aa0c0, 'TIMM-BER!'],
  pickup: [0x7a4a1e, '●'], // football fallback if the dedicated pickup icon is unavailable
  gfi: [0x8a5cff, '»'],
  catch: [0x22b07a, 'C'],
  pass: [0x2a9ad0, 'P'],
  intercept: [0xd04545, 'I'],
  leap: [0x8a5cff, 'L'],
  ttm: [0xd08030, 'T'], // (kick/throw) team-mate
  trait: [0xd0a820, '!'],
  standup: [0x5aa0c0, '↑'], // owner 2026-07-08: stand-up roll (incl. Timmm-ber! assist) — slate-blue ↑ badge
  gaze: [0xb046d0, '◉'],
  reroll: [0x35a045, '↻'], // team or skill re-roll
  bloodlust: [0x8a1a2a, '🩸'], // owner 2026-07-08: vampire Bloodlust — blood-drop badge
  breatheFire: [0xd06a28, 'F'], // owner 08-18: fire-orange F fallback if the BreatheFire icon isn't loaded
};
/** Owner 2026-07-08 (case 422): glyph fallback [badge colour, glyph] for a SKILL-based square-pick
 *  badge when the skill has no icon art (keyed by the normalized skill name). Matches the die-marking
 *  language (buildDieCauseTag). Skills WITH icon art (SideStep, …) render the icon instead. */
const SKILL_BADGE_GLYPH: Record<string, [number, string]> = {
  trickster: [0xb046d0, '✦'], // Gnome Illusionist — no icon art; magenta ✦
};
const OPP_CHOICE_STYLE = new TextStyle({
  fontFamily: 'Nuffle, sans-serif',
  fontSize: 11,
  fontWeight: 'bold',
  fill: 0xff5050,
  stroke: { color: 0x14161a, width: 3 },
});
// B9-7: gold "<player> chooses <RESULT>" caption above the chosen block die,
// matching the gold-arrow convention (ACTIVE_MARKER_STYLE colour).
const BLOCK_CHOICE_STYLE = new TextStyle({
  fontFamily: 'Nuffle, sans-serif',
  fontSize: 13,
  fontWeight: 'bold',
  fill: 0xf5c542,
  stroke: { color: 0x14161a, width: 3 },
  align: 'center',
});
const ROLL_DIE_STYLE = new TextStyle({ fontFamily: 'sans-serif', fontSize: 11, fontWeight: 'bold', fill: 0x8a2a2a });
// Owner 2026-07-07: the spectator-reach rush "2+" label — styled to MATCH the rush die
// (cream 0xf2efe6 plate, dark-red 0x8a2a2a border). Dark-red fill + a soft
// CREAM outline (not stark white) so it reads like part of the die, not a separate label.
const RUSH_LABEL_STYLE = new TextStyle({ fontFamily: 'sans-serif', fontSize: 11, fontWeight: 'bold', fill: 0x8a2a2a, stroke: { color: 0xf2efe6, width: 2.5, join: 'round' } });
const TZ_OPPOSITION_STYLE = new TextStyle({ fontFamily: 'sans-serif', fontSize: 9, fontWeight: 'bold', fill: 0xff8a8a });
const TZ_FRIENDLY_STYLE = new TextStyle({ fontFamily: 'sans-serif', fontSize: 9, fontWeight: 'bold', fill: 0x9ab8ff });
// B2-16/UI11: Nuffle display font, heavier weight; sized at render time so
// the word spans the full end-zone length
const ENDZONE_STYLE = new TextStyle({
  fontFamily: 'Nuffle, sans-serif',
  fontSize: 28,
  fontWeight: '900',
  letterSpacing: 6,
  fill: 0xf0ece0,
});

/**
 * App19: base ring colors denote the player's position on the team
 * (owner-specified): Blitzer red, Thrower white, Blocker green, Catcher
 * yellow, Lineman grey; big guys orange, anything else purple.
 */
// FOLLOW-UP (owner, 2026-07-02): full per-race positional validation of this
// mapping is pending — equivalences get added as they are ruled (so far:
// Gutter Runner = catcher, Wardancer = blitzer; Vampire team 2026-07-08:
// Vargheist = big guy, Thrower = thrower, Blitzer = blitzer, Runner = catcher,
// Thrall = lineman). Order matters: role equivalences must precede the generic
// keys they'd otherwise miss.
const POSITION_RING_COLORS: [string, number][] = [
  ['gutterrunner', 0xe0c832], // = catcher
  ['wardancer', 0xd03030], // = blitzer
  ['squire', 0x9a9aa2],        // Bretonnian Squire = lineman (grey)
  ['grailknight', 0xd03030],   // Bretonnian Grail Knight = blitzer (red)
  ['grailcatcher', 0xe0c832],  // Bretonnian Grail Catcher = catcher (yellow)
  ['bomma', 0xf0f0ea],         // Goblin Bomma = thrower (white)
  ['pogoer', 0xe0c832],        // Goblin Pogoer = catcher (yellow)
  ['doomdiver', 0xe0c832],     // Goblin Doom Diver = catcher (yellow)
  ['ooligan', 0x22e05a],       // Goblin 'Ooligan = blocker (green)
  ['beastmaster', 0x22e05a],   // Gnome Beastmaster = blocker (green)
  ['illusionist', 0xf0f0ea],   // Gnome Illusionist = thrower (white)
  ['woodlandfox', 0xe0c832],   // Gnome Woodland Fox = catcher (yellow)
  ['blitzer', 0xd03030],
  ['thrower', 0xf0f0ea],
  ['blocker', 0x22e05a], // bright green — reads against the grass pitch (owner 2026-07-04)
  ['catcher', 0xe0c832],
  ['runner', 0xe0c832], // Vampire Runner = catcher (owner 2026-07-08); gutterrunner already above
  ['thrall', 0x9a9aa2], // Vampire Thrall = lineman (owner 2026-07-08)
  ['lineman', 0x9a9aa2],
  ['ratogre', 0xe08a2a],
  ['ogre', 0xe08a2a],
  ['troll', 0xe08a2a],
  ['minotaur', 0xe08a2a],
  ['kroxigor', 0xe08a2a],
  ['treeman', 0xe08a2a],
  ['mummy', 0xe08a2a],
];

/** Big-guy detection: roster position type when present, name keywords otherwise. */
const BIG_GUY_KEYWORDS = ['ogre', 'troll', 'minotaur', 'kroxigor', 'treeman', 'mummy', 'ratogre', 'bigun', 'deathroller', 'vargheist'];

function isBigGuy(player: PlayerJson, team: TeamJson): boolean {
  const positions = (team.roster as { positionArray?: { positionId: string; positionName?: string; playerType?: string }[] })
    .positionArray;
  const position = positions?.find((p) => p.positionId === player.positionId);
  if (position?.playerType && position.playerType.toLowerCase().replace(/[^a-z]/g, '') === 'bigguy') return true;
  const name = `${position?.positionName ?? ''} ${player.positionId}`.toLowerCase().replace(/[^a-z]/g, '');
  return BIG_GUY_KEYWORDS.some((k) => name.includes(k));
}

function positionNameOf(player: PlayerJson, team: TeamJson): string | undefined {
  const positions = (team.roster as { positionArray?: { positionId: string; positionName?: string }[] }).positionArray;
  return positions?.find((position) => position.positionId === player.positionId)?.positionName;
}

/** Owner: checker discs carry the POSITION letter — B blitzer, T thrower,
 *  C catcher, L lineman, BG big guy, … — instead of the shirt number. */
function positionLetter(player: PlayerJson, team: TeamJson): string {
  if (isBigGuy(player, team)) return 'BG';
  const pos = String(player.positionId ?? '').split('.').pop() ?? '';
  const key = pos.toLowerCase().replace(/[^a-z]/g, '');
  const MAP: Record<string, string> = {
    blitzer: 'B', thrower: 'T', catcher: 'C', lineman: 'L', blocker: 'BK',
    runner: 'R', passer: 'P', gutterrunner: 'GR', wardancer: 'WD', witchelf: 'WE',
    thrall: 'L', // Vampire Thrall = lineman (owner 2026-07-08)
  };
  return MAP[key] ?? (pos.charAt(0) || '?').toUpperCase();
}

/** Owner 2026-07-04: the positional-ring colour comes from the player's POSITION
 *  NAME (blitzer→red, catcher→yellow, thrower→white, blocker→green, lineman→grey,
 *  big guys→orange), falling back to PURPLE for special/team-specific types
 *  (Halflings, Snotlings, Flesh Golems, …). Live FUMBBL positionIds are NUMERIC, so
 *  the NAME (from the roster) is the reliable signal — matching on positionId alone
 *  always missed. The owner can refine edge cases via the exported position CSV. */
function positionRingColor(player: PlayerJson, team: TeamJson): number {
  const positions = (team.roster as { positionArray?: { positionId: string; positionName?: string; playerType?: string }[] }).positionArray;
  const position = positions?.find((p) => p.positionId === player.positionId);
  // Owner-curated CSV override by position NAME wins (docs/position-rings.csv).
  const curated = ringTypeForName(position?.positionName);
  if (curated) return RING_TYPE_COLORS[curated];
  const name = `${position?.positionName ?? ''} ${player.positionId}`.toLowerCase().replace(/[^a-z]/g, '');
  const type = (position?.playerType ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (type === 'bigguy' || BIG_GUY_KEYWORDS.some((k) => name.includes(k))) return RING_TYPE_COLORS.bigguy; // orange
  for (const [key, color] of POSITION_RING_COLORS) {
    if (name.includes(key)) return color;
  }
  return RING_TYPE_COLORS.special; // purple: special / unmatched (Halflings, Snotlings, …)
}

/** Owner 2026-07-04: Star Players get a GOLD STAR silhouette on the ground
 *  beneath their feet INSTEAD of a position ring. Detected from the roster
 *  position playerType === 'Star' (live FUMBBL flags stars this way). */
function isStarPlayer(player: PlayerJson, team: TeamJson): boolean {
  const positions = (team.roster as { positionArray?: { positionId: string; positionName?: string; playerType?: string }[] }).positionArray;
  const position = positions?.find((p) => p.positionId === player.positionId);
  // Owner-curated CSV override by name wins (some 'Star' art positions are typed
  // 'Regular' on the wire); otherwise trust the wire playerType.
  if (ringTypeForName(position?.positionName) === 'star') return true;
  return (position?.playerType ?? '').toLowerCase().replace(/[^a-z]/g, '') === 'star';
}

/** Deterministic pseudo-random for stable turf texture. */
function turfNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

// Owner-tunable aura hatch opacity.
const AURA_HATCH_OPACITY = 0.28;
// Owner ruling 08-17: DP aura opacity no longer scales with overlap count. Every DP-covered
// square (1, 2, 3+ overlapping auras) renders flat at the STAGE-2 look — the compounded alpha
// exactly two overlapping auras used to produce via overdraw (1 - (1-alpha)^2 normal-blend stack).
const AURA_HATCH_STAGE2_OPACITY = 1 - (1 - AURA_HATCH_OPACITY) ** 2;
// Owner-tunable aura hatch slant in pitch space; 0 keeps strokes parallel to pitch rows.
const AURA_HATCH_SLANT = 0;
// Owner-tunable aura hatch wobble as a fraction of one pitch square.
const AURA_HATCH_WOBBLE = 0.025;

/** A group of token decorations pinned to a moving token's live tweened position (owner 2026-07-15, `1b9a8120`).
 *  `carrierId` is the token/player id to follow; each node shifts by the delta from its rest layout. */
type TokenDecoFollow = {
  carrierId: string;
  restX: number;
  restY: number;
  nodes: { node: Container; baseX: number; baseY: number; kind: 'plain' | 'marker' }[];
};

type BlockFace = 'skull' | 'bothdown' | 'push' | 'powpush' | 'pow';

/**
 * SNES-style 3/4-view pitch renderer (App15/App16). Placeholder token art
 * drawn with Graphics until the AI-generated sprite sets land (EC-7); the
 * token container API is shaped so texture sprites can replace the Graphics
 * without touching the scene logic.
 */
export class PitchRenderer {
  /** ms per block-die face — UI-7 study Option A (700ms, recommended);
   *  Option B = 1000ms. See docs/dice-timing-study.md. */
  static DICE_FACE_MS = 700;

  /** B8-1: wire d6 value (1..6) → block-face texture index. FFB block die:
   *  1 Skull, 2 Both Down, 3/4 Push, 5 Defender Stumbles, 6 POW.
   *  blockFaceTextures order = [skull, bothdown, push, powpush, pow]. */
  private static readonly BLOCK_VALUE_TO_FACE = [0, 0, 1, 2, 2, 3, 4];
  private static readonly BLOCK_FACE_NAMES = ['face_skull', 'face_bothdown', 'face_push', 'face_powpush', 'face_pow'];
  private static readonly BLOCK_FACE_IDS: BlockFace[] = ['skull', 'bothdown', 'push', 'powpush', 'pow'];
  private static blockFaceSources: Partial<Record<BlockFace, string>> = {};
  private static readonly instances = new Set<PitchRenderer>();
  // #16 (owner 07-22, BB2025 unification): the official source-verified block-face names, matching Tarkin's
  // reportFormatter.blockResultFaceName (log/cine result) so a result and its dice preview never split-name.
  // Face order [skull, bothdown, push, powpush(=defender-stumbles), pow].
  private static readonly BLOCK_FACE_LABELS = ['Player Down!', 'Both Down', 'Push Back', 'Stumble!', 'POW!'];
  /** FUMBBL block-die FACE-ART url for a die value (1..6) — for DOM surfaces (the
   *  classic Block Roll dialog). Same art the on-pitch dice tumble through. */
  static blockFaceUrl(value: number): string {
    const idx = PitchRenderer.BLOCK_VALUE_TO_FACE[Math.max(1, Math.min(6, value | 0))]!;
    return PitchRenderer.blockFaceUrls()[idx]!;
  }
  /** All five face-art urls in tumble order (skull→bothdown→push→powpush→pow). */
  static blockFaceUrls(): string[] {
    return PitchRenderer.BLOCK_FACE_NAMES.map((name, index) =>
      PitchRenderer.blockFaceSources[PitchRenderer.BLOCK_FACE_IDS[index]!]
        ?? new URL(`../assets/blockdice/${name}.png`, import.meta.url).href);
  }
  static setBlockFaceSources(sources: Partial<Record<BlockFace, string>> | null): void {
    const next = sources ? { ...sources } : {};
    if (PitchRenderer.BLOCK_FACE_IDS.every((face) =>
      PitchRenderer.blockFaceSources[face] === next[face])) return;
    PitchRenderer.blockFaceSources = next;
    if (typeof document === 'undefined') return;
    for (const instance of PitchRenderer.instances) void instance.loadBlockFaceTextures();
  }
  /** Human label for a die value (1..6). */
  static blockFaceLabel(value: number): string {
    return PitchRenderer.BLOCK_FACE_LABELS[PitchRenderer.BLOCK_VALUE_TO_FACE[Math.max(1, Math.min(6, value | 0))]!]!;
  }

  private app: Application | null = null;
  /** Renderer lifecycle is instance-owned. A view unmount can race either Pixi's own async init or any of the
   * best-effort asset waits below; generation checks make every continuation fail closed without touching the
   * GameSession/store that owns the wire. Destroyed instances are deliberately not reusable. */
  private initGeneration = 0;
  private initPromise: Promise<void> | null = null;
  private initializingApp: Application | null = null;
  private destroyed = false;
  private destroyedApplications = new WeakSet<Application>();
  private readonly walkerOwnerId = Symbol('PitchRenderer');
  private walkerHelperBindings: WalkerHelpers | null = null;
  /** High-frequency display projections (skill markings and the movement target/roll surface) arrive as
   * several setters in one Vue flush. Their state applies synchronously, while the expensive token rebuild is
   * coalesced to one microtask. `setGame` invalidates the opaque token and refreshes immediately, so an older
   * queued callback can never repaint a newer authoritative generation. */
  private queuedProjectionRefresh: object | null = null;
  /** Movement reach/roll art now lives on overlay/path layers, so it can update without destroying tokens. */
  private queuedOverlayRedraw: object | null = null;
  /** Snapshot—not a prior GameJson reference, because the protocol applier mutates that object in place. */
  private lastMovementTokenGenerationSignature: string | null = null;
  /** Suppress repeated console noise while a deterministic token builder keeps
   * failing. A subsequent complete frame re-arms one diagnostic for a future,
   * distinct failure sequence. */
  private refreshFailureLogged = false;
  /** Every renderer-owned wall-clock callback lives here, including kickoff descend's completion fail-open. */
  private ownedTimers = new Set<ReturnType<typeof setTimeout>>();
  private canvasListenerCleanup: (() => void)[] = [];

  private initActive(generation: number, app: Application): boolean {
    return !this.destroyed && this.initGeneration === generation
      && (this.initializingApp === app || this.app === app);
  }

  private async loadBlockFaceTextures(): Promise<void> {
    const app = this.app ?? this.initializingApp;
    if (!app || this.destroyed) return;
    const generation = this.initGeneration;
    const loadGeneration = ++this.blockFaceLoadGeneration;
    try {
      const textures = await Promise.all(
        PitchRenderer.blockFaceUrls().map((url) => Assets.load<Texture>(url)),
      );
      if (!this.initActive(generation, app) || loadGeneration !== this.blockFaceLoadGeneration) return;
      this.blockFaceTextures = textures;
      for (const sprite of this.blockDiceSprites) sprite.texture = textures[0]!;
      for (const sprite of this.blockFaceStaticSprites) {
        if (sprite.destroyed) this.blockFaceStaticSprites.delete(sprite);
        else sprite.texture = textures[0]!;
      }
    } catch (error) {
      if (!this.initActive(generation, app) || loadGeneration !== this.blockFaceLoadGeneration) return;
      console.warn('ffb-pitch: block die faces failed to load, keeping the previous faces', error);
    }
  }

  private destroyApplication(app: Application): void {
    if (this.destroyedApplications.has(app)) return;
    this.destroyedApplications.add(app);
    try { app.destroy(true, { children: true }); }
    catch { /* Pixi may not have created a renderer when its own init rejected. */ }
  }

  private destroyGeneratedCrowdTexture(): void {
    const texture = this.generatedCrowdTexture;
    if (!texture) return;
    this.generatedCrowdTexture = null;
    this.crowdTextures = this.crowdTextures.filter((candidate) => candidate !== texture);
    texture.destroy(true);
  }

  private scheduleTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    if (this.destroyed) {
      const cancelled = setTimeout(() => undefined, 0);
      clearTimeout(cancelled);
      return cancelled;
    }
    let timer: ReturnType<typeof setTimeout>;
    timer = setTimeout(() => {
      this.ownedTimers.delete(timer);
      if (!this.destroyed) callback();
    }, delayMs);
    this.ownedTimers.add(timer);
    return timer;
  }

  private cancelTimer(timer: ReturnType<typeof setTimeout> | null): void {
    if (timer == null) return;
    clearTimeout(timer);
    this.ownedTimers.delete(timer);
  }

  private cancelAllTimers(): void {
    for (const timer of this.ownedTimers) clearTimeout(timer);
    this.ownedTimers.clear();
  }

  private queueProjectionRefresh(): void {
    if (this.destroyed || this.queuedProjectionRefresh) return;
    const request = {};
    this.queuedProjectionRefresh = request;
    queueMicrotask(() => {
      if (this.queuedProjectionRefresh !== request) return;
      this.queuedProjectionRefresh = null;
      if (!this.destroyed) this.refresh();
    });
  }

  private queueOverlayRedraw(): void {
    if (this.destroyed || this.queuedOverlayRedraw) return;
    const request = {};
    this.queuedOverlayRedraw = request;
    queueMicrotask(() => {
      if (this.queuedOverlayRedraw !== request) return;
      this.queuedOverlayRedraw = null;
      if (!this.destroyed && this.app) this.redrawOverlays();
    });
  }

  private absorbQueuedProjectionRefresh(): void {
    this.queuedProjectionRefresh = null;
  }

  private absorbQueuedOverlayRedraw(): void {
    this.queuedOverlayRedraw = null;
  }

  private listenCanvas<K extends keyof HTMLElementEventMap>(
    canvas: HTMLCanvasElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ): void {
    canvas.addEventListener(type, listener as EventListener);
    this.canvasListenerCleanup.push(() => canvas.removeEventListener(type, listener as EventListener));
  }

  private clearCanvasInteractionState(canvas: HTMLCanvasElement | null = null): void {
    if (canvas) {
      for (const pointerId of this.pointers.keys()) {
        try {
          if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
        } catch { /* the canvas may already be detached */ }
      }
      canvas.style.cursor = '';
    }
    this.pointers.clear();
    this.dragging = false;
    this.dragDistance = 0;
    this.pinchDistance = 0;
    this.lastPointer = { x: 0, y: 0 };
    this.squareHoverLast = null;
    this.actionHoverActive = false;
  }
  /** Bobbing BALL marker over the ball carrier (queue item 9). */
  private ballMarker: { node: Container; baseY: number; bob?: number } | null = null;
  /** Screen-space BALL pointer used only while the authoritative on-pitch ball is outside the viewport. */
  private ballEdgeMarker: { node: Container; arrow: Graphics } | null = null;
  /** Screen-space ACTIVE pointer, paired with BALL on the renderer's topmost HUD layer. */
  private activeEdgeMarker: { node: Container; arrow: Graphics } | null = null;
  /** Owner 2026-07-15 (live test): the carrier's ball + cyan aura + "BALL" marker are drawn at the ball's MODEL
   *  square (the move DESTINATION), but the carrier token TWEENS there over STEP_BEAT — so the ball/aura visibly
   *  teleported ahead and the token "caught up". This pins those decorations to the carrier token's LIVE tweened
   *  position each frame (offsets captured from their rest layout), so they ride WITH the carrier. Rebuilt every
   *  refresh (nodes are destroyed + recreated); the ticker no-ops when the carrier has no active move tween. */
  private carrierFollow: TokenDecoFollow | null = null;
  /** #3 (owner tester): the ACTIVE-player gold halo + action badge are ALSO drawn at the player's MODEL square,
   *  so on a move (esp. the OPPONENT's, whose token the client tweens from received syncs) they teleport ahead of
   *  the token — the same decoration-follow lag `1b9a8120` fixed for the carried ball. Same mechanism, keyed on the
   *  ACTIVE player's id (perspective-invariant, so seat-safe): pin the halo + badge to the active token's live
   *  tweened position. Rebuilt every refresh; the ticker no-ops when the active player has no active move tween. */
  private activeFollow: TokenDecoFollow | null = null;
  /** B9-15: blue glow behind the ball — STATIC when the ball is at rest on the
   *  ground (owner), pulses only while it is in flight/moving. */
  private ballGlow: Graphics | null = null;
  /** Owner 09-05: the carrier's cyan glow ring, wrapped so the ticker can breathe it (slight scale pulse). */
  private ballHalo: Container | null = null;
  /** Current model-derived ball token. Hidden while the dedicated pass-flight token owns presentation. */
  private renderedBall: Container | null = null;
  private ballAtRest = false;
  /** Optional bundled ball sprite (a spiked Blood Bowl ball); falls back to a
   *  drawn dot when absent. Loaded best-effort in init(). */
  private ballTexture: Texture | null = null;
  /** Shared live-play-adopted ACTIVE player signal — gold halo + action badge. */
  private activePlayerId: string | null = null;
  /** Opposition blitzer whose persistent #94 DOM badge is currently visible. */
  private oppositionBlitzBadgePlayerId: string | null = null;
  private activeMarker: { node: Container; baseY: number; baseScale: number } | null = null;
  /** Owner 09-08: decor-scale x overlay-zoom key of the active token when the marker was last placed (null = not
   *  yet sampled); a zoom rung re-snaps the skill row / state markers, so the marker re-measures its dodge. */
  private activeMarkerDecorKey: string | null = null;
  /** Owner 2026-07-06: the gold halo under the active token, wrapped in a Container
   *  so the ticker can SCALE it. On an active-player change it does a one-shot
   *  "selection pop" (grow ~1.25x then settle) — the selection-juice indicator that
   *  replaces the gold echo (which is now opt-in, `activePlayerEcho`). */
  private activeHalo: Container | null = null;
  /** The walker token the active halo was drawn for (its decor scale drives the halo scale each frame). */
  private activeHaloToken: Container | null = null;
  /** performance.now() when the halo pop began (0 = idle). */
  private haloPulseStart = 0;
  /** Owner 2026-07-06: DEPRECATED gold-echo pop on active-player change — kept as an
   *  opt-in setting (default off); the halo selection-pop is the default indicator. */
  private activePlayerEcho = false;
  /** Live push-OPTION arrows (owner 2026-07-03): rebuilt each refresh from
   *  fieldModel.pushbackSquareArray; the CHOSEN one alpha-pulses via the ticker. */
  private pushOptionPulse: Graphics[] = [];
  /** Owner 2026-07-03: pulsing crosshair reticles at each push-option square (the
   *  arrow tips) — the "click here" target. Scale + alpha pulse via the ticker.
   *  Shown for players AND spectators (drawn straight off the model). */
  private pushCrosshairs: { node: Graphics; base: number }[] = [];
  private world = new Container();
  /** Stadium bowl surrounding everything (owner 2026-07-02, SoFi reference). */
  private stadiumLayer = new Container();
  /** Owner 09-05: a stadium GLB pack rendered once to a plan-view texture (stadiumModel.ts); drawn on the pitch quad
   *  in place of the procedural stands while present. */
  private stadiumModel: RenderedStadium | null = null;
  private stadiumModelGeneration = 0;
  private pitchLayer = new Container();
  /** B7-5: faded team logos at the sweet spots, under players. */
  private sweetSpotLayer = new Container();
  /** B8-8: last sweet-spot URLs, so an orientation toggle can re-place them. */
  private lastSweetSpotUrls: { home: string | null; away: string | null } = { home: null, away: null };
  private sweetSpotLogoRequestGeneration = 0;
  /** Arena dressing over the pitch surface: corner pennants, bunting. */
  private dressingLayer = new Container();
  /** Range shading + selection halo, under the tokens. */
  private overlayLayer = new Container();
  private movementReachLayer = new Container();
  private tokenLayer = new Container();
  /** Queued path: line, step numbers, rush dice, dodge chips — over the tokens. */
  private pathLayer = new Container();
  private movementPathCostLayer = new Container();
  private movementOverlayNodes = new Map<string, MovementOverlayEntry>();
  private movementOverlayFades = new Map<string, { entry: MovementOverlayEntry; from: number; start: number }>();
  private movementOverlaySeen = new Set<string>();
  private movementOverlayOwner: string | null = null;
  /** BB2-style dugouts flanking the pitch (owner 2026-07-02). */
  private dugoutLayer = new Container();
  /** Live rendered dugout token anchors, rebuilt with the dugout generation. Presentation
   *  followers use these instead of a player's stale last on-pitch square after a removal. */
  private dugoutTokensById = new Map<string, Container>();
  /** Actual rendered dugout compartment, independent of the model's requested state. A turn fence uses this to
   * repair a token stranded in the wrong box even when the server state itself did not transition this frame. */
  private dugoutCompartmentById = new Map<string, Exclude<PlayerPresentationCompartment, 'pitch' | 'removed'>>();
  /** Owner 2026-07-07: the SW off-pitch SCORE / TURN-TIMER / RE-ROLL track. */
  private turnTrackLayer = new Container();
  /** Show the on-pitch turn-timer track (also gated by dugoutsEnabled → off in Classic). */
  turnTrackEnabled = true;
  /** Modern HUD presentation option. The chrome variant renders these as physical,
   *  weathered sideline fixtures; Classic never opts in and keeps its existing renderer. */
  private modernPitchPresentation = false;
  private chromePitchPresentation = false;
  private game: GameJson | null = null;
  /** Game 834: owner-approved pre-setup presentation only; never written into the model or sent. */
  private preSetupCoords = new Map<string, [number, number]>();
  private spritesReady = false;
  /** Owner-supplied block-result cards (skull/bothdown/push/powpush/pow). */
  private blockFaceTextures: Texture[] = [];
  private blockFaceLoadGeneration = 0;
  /** Owner-supplied skull used only for the RIP/casualty marker. */
  private casualtySkullTexture: Texture | null = null;
  private d6FaceTextures: Array<Texture | undefined> = [];
  private d6FaceVariant: D6FaceVariant = DEFAULT_D6_FACE_VARIANT;
  private d6FaceLoadGeneration = 0;
  /** Dedicated Go For It roll marker. An installed GFI icon pack target may override it. */
  private gfiDieTagTexture: Texture | null = null;
  /** Dedicated pickup roll marker. An installed `pickup` icon target may override it. */
  private pickupDieTagTexture: Texture | null = null;
  /** Dedicated Dodge roll marker. Dodge-skill rerolls still use the active pack icon. */
  private dodgeDieTagTexture: Texture | null = null;
  /** Dedicated Pass roll marker; skill rerolls retain the active pack icon. */
  private passDieTagTexture: Texture | null = null;
  /** Owner 09-08: dedicated Catch roll badge (spiked-rings art). */
  private catchDieTagTexture: Texture | null = null;
  /** Owner 09-06: block decorations — the block TARGET (front fist + red Pow burst, replaces the 💥 glyph) and the
   *  ATTACKER (fist only). Null until loaded / when missing: the 💥 glyph stays as the fallback. */
  private blockTargetDecoTexture: Texture | null = null;
  private blockAttackerDecoTexture: Texture | null = null;
  /** Owner 09-07: Eye Gouge chest marker (was a DOM overlay) — applied like the Hypnotic Gaze eye. */
  private eyeGougeDecoTexture: Texture | null = null;
  private blitzerDecoTexture: Texture | null = null;
  /** Owner 09-07: the persistent blitz badges (⚡ on the blitzer, 🎯 on the target) draw HERE, on the state-marker row
   *  (chest), fed by the store's per-turn blitzTokens — under the effects layer, so the block-result stamp lands over
   *  them. The old DOM overlay sat above the whole canvas. */
  private blitzTokens: { blitzerId: string; targetId: string } | null = null;
  private blitzTargetDecoTexture: Texture | null = null;
  /** Owner 09-07: the ROOTED word (yellow wood lettering on roots) drawn at the rooted player's feet. */
  private rootedDecoTexture: Texture | null = null;
  /** Owner 09-06: Move / Pass / Foul player-action decorations (approved art) — same path as the Blitz marker. */
  private actionMoveDecoTexture: Texture | null = null;
  private actionPassDecoTexture: Texture | null = null;
  private actionFoulDecoTexture: Texture | null = null;
  private actionHandoffDecoTexture: Texture | null = null; // owner 09-08: Hand-off action decoration
  /** Owner 09-06: Settings > Appearance — 'art' (default) draws the decorations, 'emoji' keeps the glyph markers. */
  actionDecorationStyle: 'art' | 'emoji' = 'art';
  /** Live die sprites of the armed preview; the ticker animates them in sync. */
  private blockDiceSprites: Sprite[] = [];
  /** Owner 09-08: squares whose block dice / dots were drawn this overlay pass, and the decor-scale key of their
   *  tokens at draw time (null = not yet sampled). The dice clear the chest target ring, which is a WALKER
   *  decoration re-snapped on every zoom rung — when a rung changes the ring's world size, the overlays redraw. */
  private blockPreviewSquares: Square[] = [];
  private blockPreviewDecorKey: string | null = null;
  private blockFaceStaticSprites = new Set<Sprite>();
  /** Owner-supplied explosion animation, shared by Fireball and bomb bursts and
   *  replayed from the GIF's embedded frame timing. */
  private fireballExplosionGif: GifSource | null = null;
  /** One-shot effects-layer ticker ownership. A game reset clears the layer while
   * the Pixi application remains alive, so every callback that can outlive its
   * node must be removed before that node is destroyed. */
  private effectTickerCleanups = new Set<() => void>();
  /** Owner 2026-07-07: transparent turn-track tokens (die = re-rolls, hourglass = turn
   *  timer, skull = score) — background-keyed from the owner's art, ride the track columns. */
  private tokenDie: Texture | null = null;
  private tokenHourglass: Texture | null = null;
  private tokenScore: Texture | null = null; // owner 2026-07-13: SCORE token — chess ROOK (replaced the skull pawn)
  /** Owner 2026-07-07: the TRR (team re-roll) inducement icon for the re-roll column header. */
  private tokenRerollIcon: Texture | null = null;
  /** Turf themes (owner-curated): per-square textures, alternated per row. */
  private turfThemes = new Map<string, Texture[]>();
  /** FUMBBL preloaded pitch images (owner 2026-07-03 r2): full top-down field
   *  photos warped over the playable area. Keyed `theme:weather`. */
  private pitchTextures = new Map<string, Texture>();
  /** Mean luminance of each loaded pitch image (keyed like pitchTextures) for contrast-aware grid lines. */
  private pitchLuminance = new Map<string, number>();
  /** Weather used for the currently drawn pitch image (redraw on change). */
  private lastPitchWeather: string | null = null;
  private pitchDrawRequestGeneration = 0;
  /** Grid-line accessibility (owner 2026-07-03 r3): show/hide, width multiplier,
   *  and colour of the pitch grid/yard lines. */
  private gridShow = true;
  private gridWidthMul = 1;
  private gridColor = COLORS.line;
  /** Owner 09-05: user opacity multiplier over the per-line grid alphas (accessibility slider). */
  private gridAlphaMul = 1;
  /** Acasas cobblestone: the dugouts tile with this, terrain-style. */
  private stoneTexture: Texture | null = null;
  /** Apothecary/doctor sprite (owner 2026-07-03 r6f) for the treatment cinematic. */
  private apothecaryTexture: Texture | null = null;
  /** #135 (owner 07-23): frog sprite for a Wizard-ZAPPED player (playerKind==='zappedPlayer').
   *  A persistent icon SWAP mirroring upstream PlayerIconFactory (the whole sprite becomes a frog
   *  until the server un-zaps); NOT the transient strike VFX (that's playZap). Null → normal sprite. */
  private frogTexture: Texture | null = null;
  /** Owner o66ab: STUNNED board-game token texture + its gameplay toggle ("Render Stun tokens"). */
  /** FUMBBL prone (slash) / stunned (X) decoration overlays. */
  private downDecorations = new Map<string, Texture>();
  /** FUMBBL checker discs (upstream abstract icon mode, UI-5). */
  private checkerTextures = new Map<string, Texture>();
  /** Stadium pack (Sprites/Stadium): seat-stand modules + crowd spectators. */
  private standTextures = new Map<string, Texture>();
  private crowdTextures: Texture[] = [];
  /** The single crowd texture produced by renderer.generateTexture. Assets-owned
   * textures in crowdTextures are borrowed and must never be destroyed here. */
  private generatedCrowdTexture: Texture | null = null;
  /** Owner 2026-07-06: world-space positions of every rendered crowd sprite (set in
   *  drawStadium), so crowd quips / signs / thrown rocks can anchor to a real fan. */
  private crowdMembers: { x: number; y: number; h: number; stand: 'home' | 'away' | 'end' }[] = [];
  /** Owner 2026-07-06: sign-holding spectator sprites + their seeded FRONT-row slots
   *  (world position of each blank placard) so an "I ♥ name" shout-out can be written
   *  on a placard that is currently on-camera. */
  private signFanTextures: Texture[] = [];
  private signFanSlots: { signCX: number; signCY: number; signW: number; signH: number }[] = [];
  /** Owner 2026-07-08: the "I ♥ name" names assigned to the sign-holders at game
   *  start (proclaimed during pre-game), rendered persistently on their placards. */
  private pregameSignNames: string[] = [];
  private signTextNodes: Container[] = [];
  /** Owner 2026-07-04: a broadcast CAMERA (sheet 17) + a stadium LIGHT tower (sheet
   *  16), sliced from their sprite sheets — cameras flank the LOS, lights the corners. */
  private cameraTexture: Texture | null = null;
  private lightTexture: Texture | null = null;
  /** Corner pennants + bunting (owner 2026-07-02 arena dressing). */
  private dressingTextures = new Map<string, Texture>();
  private turfTheme = 'grass1';
  /**
   * 'classic' (FUMBBL iconsets supplied by an installed local pack) is the
   * standard; 'new' = original placeholder manifest sprites.
   */
  private spriteSet: 'new' | 'classic' | 'checkers' | 'walk' = 'classic';
  /** Match7 hook: when false (default), baseline positional skills are hidden. */
  showDefaultSkills = false;
  /** Skill-badge legibility style (owner 2026-07-02 study, queue item 10). */
  skillBadgeStyle: 'compact' | 'large' | 'plate' | 'large-plate' = 'compact';
  /** B2-17: false while skill MARKINGS are the active display mode. */
  showSkillIcons = true;
  /** Where skill ICONS draw (owner 2026-07-03 r6f): 'head' (default, above the
   *  token) or 'feet' (below, like the markers). */
  iconPosition: 'head' | 'feet' = 'head';
  /** Where skill MARKERS draw: 'feet' (default, foot text) or 'head' (above). */
  markerPosition: 'feet' | 'head' = 'feet';
  /** Which skill-icon set to draw on badges — BB3 (default) or BB2 (owner). */
  skillIconStyle: SkillIconStyle = 'bb3';
  /** Badge/marking groups that rescale with zoom (B2-4/B2-20). Pickup/GFI
   *  action-die cause tags join this same registry so their detailed art keeps
   *  the established skill-icon screen footprint at the wide pitch view. */
  private overlayScaleGroups: Container[] = [];
  /** Owner 2026-07-13 (#3): per-overlay EXTRA scale factor, multiplied onto overlayZoomFactor in
   *  updateOverlayScales. Default (absent) = 1. The activation ✓ badge stores 1/strengthScale here so it
   *  stays a constant on-pitch size instead of GROWING with a big-guy token (it's a token child, so it
   *  otherwise inherits the token's strengthScale). WeakMap → entries GC with their destroyed containers. */
  private overlayBaseScale = new WeakMap<Container, number>();
  /** Marking-only width guards. The wrapper retains the shared inverse-zoom
   * scale; its text child is squeezed on x when that scale would breach the
   * token-width boundary. */
  private markingFit = new WeakMap<Container, { tag: Text; maxWidth: number }>();
  /** The camera-fit scale — the 100% reference for overlayZoomFactor. */
  private cameraFitScale = 1;
  /** Owner 09-05 (round 12): PIXEL ZOOM — every camera zoom target lands on a whole number of PHYSICAL pixels per art
   *  pixel (canvas resolution x zoom = 1, 2, 3 ...; half steps below 1 so a small window still fits). Fit-to-window
   *  floors (never overflows), wheel steps go up/down one whole ratio, the auto director and cinematics take the
   *  nearest. This is what keeps the walk art on the pixel grid at rest; the per-token snap covers the easing. */
  /** Pixel zoom on by default; the camera-geometry tests switch it off to assert the raw fit maths. */
  pixelZoom = true;
  /** Owner 09-06: physical-px-per-world-px rungs where the walker snap is EXEMPT (true fractional size). */
  /** Owner 09-06: was 4 — one more rung (9/8) past the old top. */
  private static readonly MAX_WHEEL_ZOOM = 4.5;
  private static readonly FREE_ZOOM_RUNGS = [2.25, 4.5, 9]; // owner 09-06: 9/8 over fit, and 9/8 over the old top at DPR 1 / DPR 2
  private walkerSnapExempt(): boolean {
    const r = this.world.scale.x * (globalThis.devicePixelRatio ?? 1);
    return PitchRenderer.FREE_ZOOM_RUNGS.some((v) => Math.abs(v - r) < 1e-3);
  }
  /** Re-land a diverged (zoomed) camera on the nearest whole physical ratio about the viewport centre. */
  private requantizeZoom(): void {
    if (!this.app || !this.pixelZoom) return;
    const oldScale = this.world.scale.x;
    const newScale = this.quantizeZoom(oldScale, 'nearest');
    if (Math.abs(newScale - oldScale) < 1e-6) return;
    const cx = this.app.screen.width / 2;
    const cy = this.app.screen.height / 2;
    const worldCx = (cx - this.world.position.x) / oldScale;
    const worldCy = (cy - this.world.position.y) / oldScale;
    this.world.scale.set(newScale);
    this.world.position.set(cx - worldCx * newScale, cy - worldCy * newScale);
    this.updateOverlayScales();
  }
  private quantizeZoom(scale: number, mode: 'floor' | 'nearest' | 'up' | 'down'): number {
    if (!this.pixelZoom) return scale;
    // Owner 09-05 (round 13, native capture): quantize in PHYSICAL screen pixels (devicePixelRatio), NOT canvas
    // resolution. At Resolution scale 200% the canvas backing is 2x the screen: a whole backing ratio (7) is 3.5
    // physical px per art px, and the compositor's bilinear half-scale smeared every other row. A whole PHYSICAL
    // ratio makes the backing ratio 2n, and the 2x2 identical blocks collapse exactly.
    const res = globalThis.devicePixelRatio ?? 1;
    const r = scale * res;
    // Owner 09-05 (round 14): the art is 128 px per 64-unit frame (half a world px per art px), so the ladder is
    // EVEN world scales above 2 (2 -> 1:1, 4 -> 2:1, 6 -> 3:1 ...) and the exact box-average steps below: 1 (a
    // 2x2 block per screen px, mip level 1) and 0.5 (4x4, mip level 2). Coarser steps, every one pixel-perfect.
    // Owner 09-06: ONE free rung, 2.25 (= 9/8 over the fit zoom) — the walkers draw at their true 1.125 art ratio
    // there (every 8th art pixel doubled, the mildest fractional case) instead of snapping; see FREE_ZOOM_RUNGS.
    // Owner 09-06 (r2): the wheel cap rose from 4 to 4.5 world so there is one rung PAST the old top — 4.5 physical
    // at DPR 1 (9/8 over 4) and 9 at DPR 2 (9/8 over 8); both free rungs, walkers draw at 1.125 there.
    const ladder = [0.5, 1, 2, 2.25, 4, 4.5, 6, 8, 9, 10, 12, 16];
    const eps = 1e-6;
    let q: number;
    if (mode === 'floor') q = [...ladder].reverse().find((v) => v <= r + eps) ?? ladder[0]!;
    else if (mode === 'up') q = ladder.find((v) => v > r + eps) ?? ladder[ladder.length - 1]!;
    else if (mode === 'down') q = [...ladder].reverse().find((v) => v < r - eps) ?? ladder[0]!;
    else q = ladder.reduce((best, v) => (Math.abs(v - r) < Math.abs(best - r) ? v : best), ladder[0]!);
    return q / res;
  }
  /** FUMBBL auto-markings per playerId (UI-6); empty map = markings off. */
  private playerMarkings = new Map<string, string>();
  private skillMarkingFontFamily: string = DEFAULT_MARKING_STYLE.fontFamily;
  private skillMarkingFontSize: number = DEFAULT_MARKING_STYLE.fontSize;
  private skillMarkingColor: number = DEFAULT_MARKING_STYLE.color;
  /** Per-skill-config icon-skill lists per playerId (owner 2026-07-03 r6f). When
   *  set, addSkillBadges draws exactly this player's list (already filtered by the
   *  MY TEAM / OPPOSITION behaviour + baseline); null = the legacy baseline filter. */
  private playerIconSkills: Map<string, string[]> | null = null;
  /** Previous square per playerId — feeds move interpolation (item 12). */
  private lastSquares = new Map<string, [number, number]>();
  /** Owner 2026-07-06: playerIds whose NEXT move is a Jump/Leap — that move arcs
   *  the sprite over the jumped square(s) instead of the flat glide. Set by the
   *  store's leapRoll cue (renderer.markLeap); consumed by the next startMoveTween.
   *  #92 Inc-2: the value carries the leap 'boing' sound name (or undefined) — fired
   *  via onCue at the leap-arc LAUNCH (the visual beat), not at markLeap time. */
  /** Owner 09-09: `at` lets a flag that was kept alive for the presentation drain expire instead of arcing an
   *  unrelated later move (LEAP_PENDING_TTL_MS). */
  private pendingLeaps = new Map<string, { sound?: string; at: number }>();
  /** Presentation steps that were armed as a leap — a refresh re-arm of the SAME step keeps its arc (no re-cue). */
  private leapSteps = new WeakSet<PresentationStep>();
  /** Owner 2026-07-07: playerIds whose leap FAILED with no move (server destination ==
   *  origin) — the sprite hops STRAIGHT UP and lands back in the same square. Set by the
   *  store's leapFail cue (markLeapInPlace); consumed once by the next setGame token pass. */
  private pendingLeapInPlace = new Set<string>();
  /** Owner 2026-07-07 (TTM): the EXPLICIT scatter path for a thrown/kicked player whose
   *  next move should HOP square-to-square along these squares (random directions), not
   *  glide straight to the end. Set by the store's scatterPlayer report; consumed once by
   *  the next startMoveTween for that player. */
  private pendingScatter = new Map<string, { path: [number, number][]; start: number }>();
  /** Owner 2026-07-07 (LIVE TTM): the thrown player's FLIGHT — arc its token from→to (kick-arc
   *  style) over one clock, re-armed each setGame so it survives token rebuilds. Set by markTtmThrow
   *  from the wire's `throwTeamMate` animation; consumed when the flight duration elapses. */
  private pendingTtmThrow = new Map<string, { from: [number, number]; to: [number, number]; start: number }>();
  /** Owner 2026-07-08 (case 419): TRICKSTER relocate — slide the token from→to as a LOW step (no
   *  throw-arc), the FFB built-in Trickster animation. Set by markTrickster from the wire's
   *  `trickster` animation; re-armed each setGame like the TTM flight. */
  private pendingTrickster = new Map<string, { from: [number, number]; to: [number, number]; start: number }>();
  /** TTM increment 1 (owner 2026-07-07): the thrown team-mate is HELD, JOINED with the thrower
   *  IN its square (co-located at ground level — NOT hopped onto its shoulders; owner correction
   *  2026-07-07). The thrower STAYS in its own square; the MATE is the one that moves — it RUNS
   *  from its own square INTO the thrower's square, then stands there shrunk (carried), mirroring
   *  FFB `updateThrownPlayer` (draws game.defender AT the thrower's coordinate). `start`/`fromSquare`
   *  drive the one-time run-up (re-armed each refresh with one clock). Set via markTtmHeld, cleared
   *  at the throw / game change. */
  private ttmHeld: { thrownId: string; throwerId: string; start: number; fromSquare: [number, number] | null } | null = null;
  /** #251 (owner): last server-declared action for the active player's marker. */
  private declaredActionCache: { playerId: string; action: string } | null = null;
  /** Owner 2026-07-07 (queue #1): playerIds whose move this setGame must be WITHHELD
   *  — a batched follow/stay frame carries both the follow-up move AND the dialog, so
   *  the store defers the attacker's move until the follow/stay indicator has read.
   *  A deferred player's token is pinned at its previous anchor and its move tween is
   *  suppressed (lastSquares is NOT advanced) until releaseMove() fires. Spectator-only;
   *  an empty set is a total no-op (default). Mirrors the markLeap cue. */
  private deferredMoves = new Set<string>();
  /** B3-3 movement depiction study: how tokens travel between squares.
   *  slide = single ease (item 12 baseline); walk = tile-by-tile stepping
   *  with a step bob (Fire Emblem/Shining Force register); hop = per-tile
   *  arc (board-game piece); trail = slide + fading path echoes (Into the
   *  Breach clarity register). */
  moveStyle: 'slide' | 'walk' | 'hop' | 'trail' | 'hoptrail' = 'walk'; // owner pick (B4-2)
  /** Owner 2026-07-15: per-square walk-tween duration (ms), user-tunable via Settings → the "Movement speed"
   *  picker (50/100/150/200/300/400; default STEP_BEAT_MS=150). Scales every move tween — the full-path o66 walk,
   *  the incremental defender walk, and the demo/generic paths. Set from settings.moveSpeedMs (setMoveStepMs). */
  private moveStepBaseMs = STEP_BEAT_MS;
  moveStepMs: number = presentationMs(STEP_BEAT_MS);
  setMoveStepMs(ms: number): void {
    this.moveStepBaseMs = Math.max(1, ms);
    this.moveStepMs = presentationMs(this.moveStepBaseMs);
  }
  setPresentationMode(mode: PresentationMode): void {
    if (mode !== this.presentationMode) this.resetAutoDirectorCamera(true);
    this.presentationMode = mode;
    configurePresentationMode(mode);
    this.moveStepMs = presentationMs(this.moveStepBaseMs);
  }

  /** Historical replay catch-up applies many authoritative snapshots without their
   *  real presentation cadence. The director stays completely passive until the
   *  live replay tail resumes. */
  setAutoDirectorSuspended(suspended: boolean): void {
    if (this.adSuspended === suspended) return;
    this.adSuspended = suspended;
    this.resetAutoDirectorCamera(true);
  }

  /** Settings entry point: disabling immediately retires every automatic camera
   *  transition; re-enabling starts a fresh idle/activity window. */
  setAutoDirectorEnabled(enabled: boolean): void {
    this.autoDirector = enabled;
    this.resetAutoDirectorCamera(true);
  }
  /** Owner 2026-07-15: at END OF GAME, wipe the pitch so the permanent end-game modal sits over a clean field —
   *  skips the on-pitch player tokens, the ball, and the dugouts in refresh(). Set on gameOver, cleared on a new
   *  game (SpectateView's gameOver watch). A one-shot refresh() applies it immediately. */
  boardCleared = false;
  setBoardCleared(v: boolean): void { if (this.boardCleared === v) return; this.boardCleared = v; this.refresh(); }
  /** Owner 2026-07-04: draw the player number on the token (home team). Off by default. */
  showPlayerNumbers = false;
  /** Local-only icon-sheet override: row 0 for every team+position. */
  private oneSpritePerPosition = false;
  /** Owner 2026-07-08: end-zone label — 'team' (default, mirrors FUMBBL: each end
   *  bears its team's name — home south, away north) or 'touchdown' (the word). */
  endZoneLabel: 'team' | 'touchdown' = 'team';
  /** Owner 2026-07-06: players suffering the Dodgy Snack debuff this drive → a 🤮
   *  token marker. Fed from the store; cleared at the next kickoff. */
  private dodgySnackPlayers = new Set<string>();
  setDodgySnackPlayers(ids: string[]): void {
    const next = new Set(ids);
    if (next.size === this.dodgySnackPlayers.size && [...next].every((id) => this.dodgySnackPlayers.has(id))) return;
    this.dodgySnackPlayers = next;
    this.refresh();
  }
  /** Owner 2026-07-08: players CONFUSED by a successful Hypnotic Gaze → a 👁 token marker
   *  (instead of the generic '?'). Fed from the store; pruned there to those still confused. */
  private gazeVictims = new Set<string>();
  setGazeVictims(ids: string[]): void {
    const next = new Set(ids);
    if (next.size === this.gazeVictims.size && [...next].every((id) => this.gazeVictims.has(id))) return;
    this.gazeVictims = next;
    this.refresh();
  }
  /** Client-declared Gaze target; cleared before CLIENT_GAZE is sent. */
  private gazeTarget: string | null = null;
  setGazeTarget(playerId: string | null): void {
    if (this.gazeTarget === playerId) return;
    this.gazeTarget = playerId;
    this.refresh();
  }
  /** Owner 2026-07-04: path-trail echo colour. 'auto' → white on a dark background,
   *  black on a light one (from the app background luminance). */
  trailColorMode: 'auto' | 'white' | 'black' | 'gold' = 'auto';
  /** Owner 2026-07-08: what the movement trail leaves at each departed square —
   *  'echo' (fading footprint, default) or 'numbers' (1,2,3… counting squares
   *  moved this activation). Only applies to the trail / hoptrail styles. */
  trailMarkStyle: 'echo' | 'numbers' = 'echo';
  /** Per-player squares-moved counter for the 'numbers' trail; reset on activation. */
  private moveTrailCount = new Map<string, number>();
  /** Owner 2026-07-08: the 'numbers' trail labels are PERSISTENT (not echoed/faded) —
   *  they stay for the whole activation and are cleared when it ends (setActivePlayer)
   *  or on a game change (clearEffects). */
  private trailNumberNodes: { label: Text; sq: [number, number] }[] = []; // #194: sq kept so the per-frame occupancy toggle can hide the digit under a piece
  /** Owner 09-05: trail NUMBERS for squares ENTERED are stamped when the token's move tween reaches its visual
   *  end (finishPresentationStepTween), never at tween start — otherwise the digit led the piece by a full
   *  step. Queued per mover; flushed on completion, or when a newer move for that mover is stamped. */
  private pendingTrailNumbers = new Map<string, { sq: [number, number]; n: number; color: number; outline: number }[]>();
  /** App background colour (set at init) — used for the 'auto' trail contrast. */
  private bgColor = 0x14161a;
  private resolveTrailColor(): number {
    switch (this.trailColorMode) {
      case 'white': return 0xffffff;
      case 'black': return 0x000000;
      case 'gold': return 0xf5c542;
      default: {
        // relative luminance of the background — light bg → black trail, else white
        const r = ((this.bgColor >> 16) & 0xff) / 255;
        const g = ((this.bgColor >> 8) & 0xff) / 255;
        const b = (this.bgColor & 0xff) / 255;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return lum > 0.55 ? 0x000000 : 0xffffff;
      }
    }
  }
  /** B5-2: false = spectator-clean (no halo/range/path/dice previews). */
  plannerEnabled = true;
  /** Owner 2026-07-03: "Auto Director" — when false, the automatic camera work is
   *  suppressed: `cinematicZoom` no-ops (no zoom-in on the action) and the active-
   *  player nudge/track is skipped by the app. Dice/splashes still play; only the
   *  camera stays put. */
  autoDirector = true;
  /** Unified Auto Director camera authority. A single state prevents active-switch,
   *  packet-follow and ball-focus tweens from stacking or fighting each other. */
  private adFocusSubject: string | null = null;
  private adFocusMode: AutoDirectorFocusMode = 'idle';
  private adFocusElapsedMs = 0;
  private adForceNudgeSubject: string | null = null;
  private adRequestedNudge: { subject: string; point: { x: number; y: number } } | null = null;
  private adSuspended = false;
  private adManualUntil = 0;
  private adIdleSince: number | null = null;
  private adIdleZoomTargetScale: number | null = null;
  private adIdleZoomEvaluated = false;
  private presentationMode: PresentationMode = 'spectator';
  /** B5-5: cinematic camera state — user input is ignored while active. */
  private cinematic: {
    savedScale: number;
    savedX: number;
    savedY: number;
    target: { x: number; y: number };
    start: number;
    holdMs: number;
    /** Zoom multiplier over cameraFitScale (default 2.4 = the block zoom). */
    zoom?: number;
    /** When set, the camera follows this live point (e.g. the kicked ball). */
    track?: () => { x: number; y: number };
    /** Owner 2026-07-04: Auto Director event priority — a HIGHER-priority request
     *  (e.g. ball in flight) preempts a lower one already on screen. Default 1. */
    priority?: number;
  } | null = null;
  /** Owner 2026-07-14 (#5/#15 interpolation fix (a), Yularen-ruled): the FULL computed move path for a player,
   *  so ONE tween steps through each square at STEP_BEAT even when the o66 immediate-apply collapses the per-
   *  square syncs into one frame (which denied refresh() the deltas the single-segment tween needed). Persists
   *  across the frequent token rebuilds (re-applied in refresh() with the ORIGINAL start), presentation-only,
   *  and the token always lands on the model square (fail-safe — a dropped tween just snaps to correct). */
  private o66MovePath = new Map<string, { squares: [number, number][]; start: number; occurrenceId?: number }>();
  /** #67 phase-1 (Tarkin store-paced presentation-drain): the CURRENT movement step the store's drain wants
   *  drawn — a DD-1 SNAPSHOT ({from,to} frozen in the store, NEVER a live-model read). Set by the view watch
   *  (state.presentationStep → setPresentationStep()); consumed in refresh() to draw the acting player one
   *  paced tile at a time instead of the burst-prone live playerCoordinate (which immediate-apply already
   *  advanced to the FINAL square). null ⇒ no step presenting ⇒ fall back to the model draw (D3 §4a). */
  private presentationStep: PresentationStep | null = null;
  /** ONE cursor shared by the moving token's reach/d6 art. It advances only at visual tile completion. */
  private movementPresentationCursor: {
    playerId: string;
    coordinate: Square;
    movementUsed: number;
    step: PresentationStep;
  } | null = null;
  /** #67: the first-draw clock for the CURRENT presentation tile. setPresentationStep marks it pending whenever
   *  a NEW step OBJECT arrives — each store presentStep is a fresh object literal, so
   *  keying on identity is immune to the store's per-run seq RESET to 1 (a seq-VALUE key would collide a
   *  1-tile run's seq=1 with the next run's seq=1 → reuse a stale clock → the tween instant-completes = a
   *  snap + early onAnimDone = a speedup). Re-arming across a model-sync token rebuild reuses this ONE clock
   *  so the tile tween never restarts mid-tile; a pre-draw main-thread stall cannot consume its duration. */
  private presentationTileStart = 0;
  /** True from delivery until the current tile's tween is processed for its first drawable frame. */
  private presentationTileStartPending = false;
  /** Latest accepted local movement command. The renderer may show a bounded first stride in the next frame;
   * matching PresentationStep can finish the square. */
  private movementIntent: MovementIntent | null = null;
  private movementIntentTimer: ReturnType<typeof setTimeout> | null = null;
  private movementIntentRollbackTimer: ReturnType<typeof setTimeout> | null = null;
  private movementIntentStartedSeq = -1;
  /** step-stutter (owner 08-18, live): the presentation step OBJECT whose tile tween has already reached its
   *  visual end. Since 72b2d3c5 the store retires `presentationStep` only at a genuine activation end, so the
   *  snapshot now PERSISTS through the inter-tile gap the wire cadence opens after every tile — and a refresh
   *  landing in that gap used to re-run armPresentationStepTween on the ALREADY-ANIMATED step: it re-stamped the
   *  token back to `step.from` (a whole tile backwards) and re-inserted a tween whose `start` was fully elapsed,
   *  so the very next ticker pass snapped it to `to` and re-fired onAnimDone('walk', id) — one 1-frame teleport
   *  per tile at the wire cadence, and a spare gate-release the store's (kind,id)-keyed `presenting` cannot tell
   *  from the real one. That is the c38c309a/E12 step-seam class (P1 08-12, reverted `6d66b057`) coming back
   *  through the same door. Identity-keyed (never seq: the store restarts seq at 1 each run). */
  private presentationStepConsumed: PresentationStep | null = null;
  /** Active move tweens, keyed by playerId. */
  private moveTweens = new Map<
    string,
    {
      token: Container;
      waypoints: { x: number; y: number }[];
      style: 'slide' | 'walk' | 'hop' | 'trail' | 'hoptrail';
      start: number;
      segmentMs: number;
      /** False at a confirmed buffered seam, keeping constant velocity into the next tile. */
      easeOut?: boolean;
      /** Peak lift (px) of a single arc across the whole tween — the kick flight. */
      arc?: number;
      /** Owner 2026-07-07: kick-ball SCALE effect — the ball grows toward its apex then
       *  shrinks back. `baseScale` = the token's resting scale; the live scale is
       *  `baseScale * (1 + (growTo−1) * h)` where h∈[0,1] follows `growMode`: 'up' (0→1,
       *  the fly-in rising to the apex), 'down' (1→0, the descent), 'arc' (sin peak at mid,
       *  a single edge→aim flight). Absent ⇒ no scale animation. */
      baseScale?: number;
      growTo?: number;
      growMode?: 'up' | 'down' | 'arc';
      /** step-stutter: the presentation step this tile tween presents (armPresentationStepTween only). Tagged so
       *  the ticker can mark exactly THAT step consumed at its visual end — never a neighbouring tween for the
       *  same player (a leap arc, a coalesced-jump path) that happens to finish first. */
      psStep?: PresentationStep;
      /** A bounded local first-stride anticipation. It never signals onAnimDone; only an authoritative failed
       * Dodge/Rush report may let the visual token reach the attempted square while its reroll is offered. */
      movementIntent?: MovementIntent;
      /** Short server-coordinate correction across an authoritative reconciliation boundary. It never releases a walk gate. */
      reconcileKey?: string;
      /** Post-step rendered-anchor repair. It is not a presentation step and never emits onAnimDone/trail/sound. */
      postStepCorrectionKey?: string;
    }
  >();
  private movementReconcileFence: MovementPresentationFence | null = null;
  private movementPresentationRecoverySeqSeen = -1;
  private reconciliationTimers = new Map<string, { key: string; timer: ReturnType<typeof setTimeout> }>();
  private postStepConvergenceById = new Map<string, {
    key: string;
    step: PresentationStep;
    gameId: string | null;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private boardReconcileSeqSeen = -1;
  private boardReconciliationTimer: ReturnType<typeof setTimeout> | null = null;
  /** A turn fence must not flatten a legitimate leap/throw/scatter arc. Recheck that exact tween after its
   * remaining duration (bounded to 750ms); object identity prevents an older fence from retiring a newer owner. */
  private boardProtectedRechecks = new Map<string, {
    key: string;
    timer: ReturnType<typeof setTimeout>;
    tween: object;
    gameId: string | null;
    fenceSeq: number;
  }>();
  /** One-frame completion latch. The movement ticker deletes a finished tween
   *  before the director ticker runs; retaining its presented endpoint for that
   *  one frame makes exact two-/three-square boundaries observable. */
  private adCompletedMotionTargets = new Map<string, { x: number; y: number }>();
  private activeVisualEffects = 0;

  /** Replay completion probe; presentation-only and never influences the model. */
  isReplayPresentationIdle(): boolean {
    return this.moveTweens.size === 0 && this.activeVisualEffects === 0;
  }

  /** item4 (owner 08-18): is the BALL still in visual flight? A loose-ball bounce/scatter hop is a pure
   *  renderer tween keyed '__ball__' (BALL_BOUNCE_EXTRA_MS / SCATTER_SEG pacing) with no store mirror, so the
   *  turnover-splash settle gate had nothing to hold on. Presentation-only probe: it reports what is on screen
   *  and never touches the model. Deliberately the TWEEN only — NOT the model's `ballAtRest`, which is false
   *  for an off-pitch ball (throw-in pending) and would make every such turnover wait out the settle cap. */
  ballAnimating(): boolean {
    return this.moveTweens.has('__ball__');
  }

  private beginVisualEffect(): () => void {
    this.noteAutoDirectorActivity();
    this.activeVisualEffects += 1;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.activeVisualEffects = Math.max(0, this.activeVisualEffects - 1);
    };
  }

  /** Register a ticker-backed effects-layer visual and return its idempotent
   * cleanup. The exact application is captured so a late cleanup can never
   * remove the callback from a newer renderer application. */
  private registerEffectTicker(
    app: Application,
    tick: () => void,
    nodes: readonly Container[],
    onSettled?: () => void,
  ): () => void {
    let settled = false;
    const guardedTick = () => {
      if (settled) return;
      tick();
    };
    const cleanup = () => {
      if (settled) return;
      settled = true;
      app.ticker.remove(guardedTick);
      this.effectTickerCleanups.delete(cleanup);
      for (const node of new Set(nodes)) {
        if (node.destroyed) continue;
        node.parent?.removeChild(node);
        node.destroy({ children: true });
      }
      onSettled?.();
    };
    this.effectTickerCleanups.add(cleanup);
    app.ticker.add(guardedTick);
    return cleanup;
  }

  private cancelEffectTickers(): void {
    for (const cleanup of [...this.effectTickerCleanups]) cleanup();
  }

  private resetAutoDirectorCamera(clearSubject = false): void {
    this.adFocusMode = 'idle';
    this.adFocusElapsedMs = 0;
    this.adCompletedMotionTargets.clear();
    this.adIdleSince = null;
    this.adIdleZoomTargetScale = null;
    this.adIdleZoomEvaluated = false;
    if (clearSubject) {
      this.adFocusSubject = null;
      this.adForceNudgeSubject = null;
      this.adRequestedNudge = null;
    }
  }

  /** Presentation-only activity latch used by effects which do not own a move
   *  tween. It never writes the game model or emits a command. */
  noteAutoDirectorActivity(now = performance.now()): void {
    this.adIdleSince = now;
    this.adIdleZoomTargetScale = null;
    this.adIdleZoomEvaluated = false;
  }

  private noteManualCameraInput(now = performance.now()): void {
    this.adManualUntil = now + AD_MANUAL_HOLD_MS;
    this.resetAutoDirectorCamera(true);
    this.adIdleSince = now;
  }

  private autoDirectorPresentationBusy(): boolean {
    return this.activeVisualEffects > 0
      || this.moveTweens.size > 0
      || this.actionDice.length > 0
      || this.rollModals.length > 0
      || this.flashRings.length > 0;
  }

  /** Resolve the player the renderer is actually presenting, rather than the
   *  player the immediate-apply server model has already advanced to. During
   *  streamed/catch-up movement those identities can differ for a tile (or an
   *  activation hand-off), even though both tokens already exist in the scene.
   *
   *  `tokensById` is deliberately re-read for every sample: refresh() may
   *  replace a Container while preserving presentation ownership, so a tween's
   *  captured token is not a safe long-lived camera authority. Missing or
   *  destroyed presentation tokens fail open to the next visual owner and,
   *  finally, the model-selected active token. */
  private autoDirectorVisualPlayer(): { playerId: string; token: Container } | null {
    const candidates = [
      this.presentationStep?.playerId,
      this.movementIntent?.playerId,
      this.movementPresentationCursor?.playerId,
      this.activePlayerId,
    ];
    const visited = new Set<string>();
    for (const playerId of candidates) {
      if (!playerId || visited.has(playerId)) continue;
      visited.add(playerId);
      const token = this.tokensById.get(playerId);
      if (token && !token.destroyed) return { playerId, token };
    }
    return null;
  }

  private autoDirectorTarget(): {
    subject: string;
    kind: 'ball' | 'active' | 'event';
    point: { x: number; y: number };
    moving: boolean;
  } | null {
    // A visually moving/airborne ball temporarily owns camera authority. The
    // renderer presentation token is authoritative here: it is the thing the
    // viewer can actually see, including paced replay and immediate-apply play.
    const ballTween = this.moveTweens.get('__ball__');
    if (ballTween && !ballTween.token.destroyed) {
      return { subject: '__ball__', kind: 'ball', point: ballTween.token.position, moving: true };
    }
    const completedBall = this.adCompletedMotionTargets.get('__ball__');
    if (completedBall) return { subject: '__ball__', kind: 'ball', point: completedBall, moving: true };
    const passBall = this.passBallFlight?.token;
    if (passBall && !passBall.destroyed) {
      return { subject: '__ball__', kind: 'ball', point: passBall.position, moving: true };
    }
    const ballPresentationActive = this.kickApexAim != null
      || this.kickDescendSnapshot != null
      || this.pendingBallThrow != null
      || this.pendingScatter.has('__ball__');
    if (ballPresentationActive && this.renderedBall && !this.renderedBall.destroyed) {
      return { subject: '__ball__', kind: 'ball', point: this.renderedBall.position, moving: true };
    }

    if (this.adRequestedNudge) {
      return {
        subject: this.adRequestedNudge.subject,
        kind: 'event',
        point: this.adRequestedNudge.point,
        moving: false,
      };
    }

    const visualPlayer = this.autoDirectorVisualPlayer();
    if (!visualPlayer) return null;
    const completedActive = this.adCompletedMotionTargets.get(visualPlayer.playerId);
    return {
      subject: visualPlayer.playerId,
      kind: 'active',
      point: completedActive ?? visualPlayer.token.position,
      moving: this.moveTweens.has(visualPlayer.playerId) || completedActive != null,
    };
  }

  private autoDirectorTileSize(point: { x: number; y: number }): { width: number; height: number } {
    const [sx, sy] = worldToSquare(point.x, point.y);
    // Clamp extrapolated arc/apron points to a sane projected tile range. The
    // active projection and field flip are already reflected by depthScale.
    const localDepth = Math.min(1.25, Math.max(0.45, depthScale(sx, sy)));
    const scale = this.world.scale.x;
    // Owner 09-08: both orientations project a square as TILE_W across x TILE_H along the depth (geometry.ts).
    return {
      width: TILE_W * localDepth * scale,
      height: TILE_H * localDepth * scale,
    };
  }

  private tickAutoDirector(dtMs: number, now: number): void {
    if (!this.app || !this.autoDirector || this.adSuspended || this.destroyed) {
      if (this.adFocusMode !== 'idle' || this.adIdleZoomTargetScale != null) this.resetAutoDirectorCamera(true);
      return;
    }
    // Cinematics retain their established priority and saved-camera return. The
    // idle clock is re-anchored for their entire visible lifetime.
    if (this.cinematic) {
      this.resetAutoDirectorCamera(true);
      this.adIdleSince = now;
      return;
    }
    if (now < this.adManualUntil || this.dragging || this.pointers.size > 1
      || this.panDir.x !== 0 || this.panDir.y !== 0 || this.panVel.x !== 0 || this.panVel.y !== 0) {
      this.adIdleSince = now;
      return;
    }

    const target = this.autoDirectorTarget();
    const previousSubject = this.adFocusSubject;
    const nextSubject = target?.subject ?? null;
    const subjectChanged = nextSubject !== previousSubject;
    const ballHandoff = previousSubject === '__ball__' && target?.kind === 'active';
    if (subjectChanged) {
      this.adFocusSubject = nextSubject;
      this.adFocusMode = 'idle';
      this.adFocusElapsedMs = 0;
      this.noteAutoDirectorActivity(now);
    }

    if (target) {
      const scale = this.world.scale.x;
      const offsetX = this.world.position.x + target.point.x * scale - this.app.screen.width / 2;
      const offsetY = this.world.position.y + target.point.y * scale - this.app.screen.height / 2;
      const tile = this.autoDirectorTileSize(target.point);
      const distance = autoDirectorDistanceSquares(offsetX, offsetY, tile.width, tile.height);
      const forceNudge = target.kind === 'event'
        || ballHandoff
        || this.adForceNudgeSubject === target.subject;
      const priorMode = this.adFocusMode;
      const nudgeNeedsRearm = priorMode === 'nudge' && this.adFocusElapsedMs >= AD_NUDGE_MS;
      const nextMode = autoDirectorFocusMode(
        priorMode,
        distance,
        target.moving,
        forceNudge,
        this.adFocusElapsedMs,
      );
      if (forceNudge) this.adForceNudgeSubject = null;
      if (forceNudge && nextMode === 'idle' && target.kind === 'event') this.adRequestedNudge = null;
      if (nextMode !== priorMode) {
        this.adFocusMode = nextMode;
        this.adFocusElapsedMs = 0;
        if (nextMode === 'idle' && target.kind === 'event') this.adRequestedNudge = null;
      } else if (nudgeNeedsRearm && nextMode === 'nudge') {
        this.adFocusElapsedMs = 0;
      }
      if (this.adFocusMode !== 'idle') {
        const frameMs = Math.min(50, Math.max(0, dtMs));
        const alpha = 1 - Math.exp(-frameMs / AD_FOLLOW_TAU_MS);
        this.world.position.x -= offsetX * alpha;
        this.world.position.y -= offsetY * alpha;
        this.adFocusElapsedMs += frameMs;
        this.noteAutoDirectorActivity(now);
      } else if (target.moving) {
        // Movement inside the dead box holds the camera but is not "idle".
        this.noteAutoDirectorActivity(now);
      }
    }

    if (this.autoDirectorPresentationBusy()) {
      this.noteAutoDirectorActivity(now);
      return;
    }
    if (this.adFocusMode !== 'idle') return;
    if (this.adIdleSince == null) this.adIdleSince = now;
    if (now - this.adIdleSince < AD_IDLE_DELAY_MS) return;

    if (!this.adIdleZoomEvaluated) {
      this.adIdleZoomEvaluated = true;
      const points = (this.game?.fieldModel.playerDataArray ?? [])
        .filter((data) => isOnPitch(data.playerCoordinate))
        .map((data) => squareAnchor(data.playerCoordinate![0], data.playerCoordinate![1]));
      this.adIdleZoomTargetScale = !AD_IDLE_ZOOM_OUT_ENABLED ? null : autoDirectorIdleZoomTarget({
        points,
        worldX: this.world.position.x,
        worldY: this.world.position.y,
        scale: this.world.scale.x,
        minScale: this.cameraFitScale,
        viewportWidth: this.app.screen.width,
        viewportHeight: this.app.screen.height,
        tilePadding: Math.max(TILE_W, TILE_H) * 1.25,
      });
    }
    const zoomTarget = this.adIdleZoomTargetScale == null ? null : this.quantizeZoom(this.adIdleZoomTargetScale, 'nearest');
    if (zoomTarget == null) return;
    const oldScale = this.world.scale.x;
    const newScale = autoDirectorIdleZoomStep(oldScale, zoomTarget, dtMs);
    const cx = this.app.screen.width / 2;
    const cy = this.app.screen.height / 2;
    const worldCx = (cx - this.world.position.x) / oldScale;
    const worldCy = (cy - this.world.position.y) / oldScale;
    this.world.scale.set(newScale);
    this.world.position.set(cx - worldCx * newScale, cy - worldCy * newScale);
    this.updateOverlayScales();
    if (Math.abs(newScale - zoomTarget) <= 0.0001) this.adIdleZoomTargetScale = null;
  }
  /** Previous ball square — feeds the ball-flight tween (F-5). */
  private lastBallSquare: [number, number] | null = null;
  /** Ball on-pitch last render + whether we've rendered a ball at all — an
   *  off→on transition (kickoff / touchback / throw-in) triggers the kick arc,
   *  but never on the first render (initial spectate mid-game). */
  private lastBallOnPitch = false;
  private ballEverRendered = false;
  /** Explicit receive occurrence for the report-only kickoffScatter coordinate transition. */
  private pendingServerKickoffScatter: ServerKickoffScatterOccurrence | null = null;
  /** While present, the server model ball is intentionally masked: kickoffScatter revealed a destination, not flight. */
  private serverKickoffScatterReveal: [number, number] | null = null;
  private suppressGenericBallInThisRefresh = false;
  private kickoffScatterSeqSeen = -1;
  /** Owner 2026-07-12: track whether the kick has RESOLVED so the kick TRAVEL-ARC trail clears the
   *  moment the ball settles — on any of the three settle signals: in play (fieldModelSetBallInPlay),
   *  out of bounds (fieldModelOutOfBounds → throw-in), or CAUGHT (a carrier now holds it). Cleared on
   *  the false→true transition so a still-true value from prior play never wipes a fresh kick's trail. */
  private lastBallResolved = false;
  /** Previous base state per playerId — feeds the knockdown flash (F-5). */
  private lastBaseStates = new Map<string, number>();
  /** Expanding knockdown/injury flash rings (F-5), self-removing. */
  private flashRings: { g: Container; x: number; y: number; scale: number; start: number; grow?: number; durationMs?: number }[] = [];
  /** Owner o66 #7: over-head PASS/CATCH roll modals — a labelled pill above the passer/catcher, pop-in then fade. */
  private rollModals: { node: Container; start: number; baseY: number }[] = [];
  /** On-pitch action d6 (owner 2026-07-03 r3): a rolled die pops next to the
   *  action square, holds, then fades. Self-removing via the ticker. */
  private actionDice: { node: Container; baseScale: number; start: number; holdForOpponentReroll?: boolean; holdUntilTurnover?: boolean; square?: [number, number] }[] = [];
  /** Live skill surfaces that must change representation when a mod pack adds/removes a target. */
  private liveSkillAssets = new Map<Container, () => void>();
  /** Native asset URLs held by mounted custom-player tokens. Most tokens release
   * during the revision refresh; a preserved movement token holds through tween retirement. */
  private assetPresentationTokenReleases = new Map<Container, () => void>();
  /** Owns Classic sheet refs for the currently mounted game. */
  private classicIconLease: ClassicIconLease | null = null;
  private classicIconLeaseGeneration = 0;
  private classicIconAcquireAbort: AbortController | null = null;

  private retainPlayerAssetOnToken(token: Container, teamId: string, positionId: string, side: 'home' | 'away', race?: string): void {
    const release = retainPlayerSpriteAsset(teamId, positionId, side, race);
    this.assetPresentationTokenReleases.set(token, release);
    const destroy = token.destroy.bind(token);
    token.destroy = ((options?: Parameters<Container['destroy']>[0]) => {
      this.assetPresentationTokenReleases.delete(token);
      release();
      destroy(options);
    }) as Container['destroy'];
  }

  private trackLiveSkillAsset(node: Container, redraw: () => void): Container {
    redraw();
    this.liveSkillAssets.set(node, redraw);
    return node;
  }

  private pruneLiveSkillAssets(): void {
    for (const node of this.liveSkillAssets.keys()) {
      if (node.destroyed) this.liveSkillAssets.delete(node);
    }
  }

  /** Atomic pack-swap hook: persistent nodes rebuild; active effects redraw in place. */
  refreshSkillIconAssets(): void {
    if (this.app) this.refresh();
    for (const [node, redraw] of this.liveSkillAssets) {
      if (node.destroyed || !node.parent) {
        this.liveSkillAssets.delete(node);
        continue;
      }
      redraw();
    }
  }
  /** Owner 2026-07-04: where the die-roll-CAUSE tag sits on the on-pitch d6.
   *  'corner' (default) = top-right corner, offset to the die edge; 'top' = top
   *  centre; 'side' = right centre; 'bottom' = bottom centre; 'off' hides it. */
  private dieTagPosition: 'corner' | 'top' | 'side' | 'bottom' | 'off' = 'corner';
  /** Transient effect sprites (F-5) — survives token-layer rebuilds. */
  private effectsLayer = new Container();
  /** Owner 2026-07-04f: persistent square MARKS (gold light columns). Toggled via
   *  the context menu / Shift-click family; redrawn on every refresh. */
  private marksLayer = new Container();
  private marks = new Set<string>();
  /** Owner 2026-07-04f: mark light-column colour (accessibility; default red). */
  markColor = 0xe03030;
  setMarkColor(color: number): void { this.markColor = color; this.drawMarks(); }
  /** B2-11: screen-space night-sky backdrop behind the stadium bowl. */
  private backdropLayer = new Container();
  /** Owner 2026-07-06: painted night parking-lot/skyline backdrop image. When loaded
   *  it replaces the procedural night-sky gradient (cover-fitted, screen-space). */
  private backdropTexture: Texture | null = null;
  /** Settings→Markings toggle (owner 2026-07-02): position rings under players. */
  showPositionRings = true;
  /** Accessibility (owner 2026-07-03 r4): field-marker toggles + ring styling. */
  showRowMarkers = true;
  showSweetSpot = true;
  showFieldLogos = true;
  /** FUMBBL Classic (owner 2026-07-08): number every length-row 1..26 down BOTH
   *  side rails, coloured by half — red on the home half (x 0..12), blue on the
   *  away half. Off by default; the classic preset turns it on. */
  showRowNumberRails = false;
  /** Position-ring density (alpha multiplier) + optional colour override. */
  private ringDensity = 1;
  private ringColorOverride: number | null = null;
  /** Owner 2026-07-04: players who have already acted this turn — their ring greys
   *  (white = still to act). Fed from the store's per-turn tracking. */
  private actedPlayers = new Set<string>();
  /** item3 (owner 08-18, video): the acted-dim used to FLIP in one frame at a turnover — the whole
   *  pitch re-shaded between two 12fps frames. Each player's dim level now EASES between 0 (bright)
   *  and 1 (fully dimmed) over ACTIVATION_FADE_MS; both directions run off the SAME clock stamp, so a
   *  turnover reads as one even cross-fade. Same o66MovePath idiom: the clock lives here (not on the
   *  token) so it survives the per-frame token destroy/rebuild, and applyActivationShading re-arms the
   *  paint closure on every rebuild with the ORIGINAL start. */
  private activationFades = new Map<string, { from: number; to: number; start: number }>();
  /** playerId -> paint(k), re-armed at each token build; cleared with the tokens in refresh(). */
  private activationFadePaint = new Map<string, (k: number) => void>();
  /** Clock injection point for the deterministic easing test (defaults to the real clock). */
  activationClock: () => number = () => performance.now();
  setActedPlayers(ids: string[]): void {
    const next = new Set(ids);
    if (next.size === this.actedPlayers.size && [...next].every((id) => this.actedPlayers.has(id))) return;
    const ms = this.activationFadeMs();
    if (ms > 0) {
      const now = this.activationClock();
      for (const id of new Set([...this.actedPlayers, ...next])) {
        const to = next.has(id) ? 1 : 0;
        // start from the CURRENT visual level so a re-flip mid-fade never jumps
        const from = this.activationDimLevel(id, this.actedPlayers.has(id) ? 1 : 0);
        if (from === to) { this.activationFades.delete(id); this.activationFadePaint.delete(id); continue; }
        this.activationFades.set(id, { from, to, start: now });
      }
    }
    this.actedPlayers = next;
    this.refresh();
  }
  /** Cross-fade duration. presentationMs-family, so passive spectating gets the slower beat (~350ms)
   *  while live and real-time replay use the untrimmed base; no documented "live is intentionally instant" choice exists —
   *  the flip was simply never eased (regressions.md §activation shading is silent on timing). */
  private activationFadeMs(): number { return presentationMs(ACTIVATION_FADE_MS); }
  /** Current dim level in [0,1] for a player: the in-flight eased value, else `fallback`. */
  private activationDimLevel(playerId: string, fallback: number): number {
    const f = this.activationFades.get(playerId);
    if (!f) return fallback;
    const ms = this.activationFadeMs();
    const t = ms <= 0 ? 1 : Math.min(1, Math.max(0, (this.activationClock() - f.start) / ms));
    const e = t * t * (3 - 2 * t); // smoothstep — even in, even out
    return f.from + (f.to - f.from) * e;
  }
  /** item3 follow-up (owner, build p): the position ring/glow/star-base view of the SAME fade. Level
   *  keys on ACTED ONLY (pick-ineligibility dims the token but never hides the ring), same clock +
   *  easing as the dim. Owner 08-19: an activated ring DIMS but never vanishes — the ring always
   *  builds; ringDimAlpha maps this level to its floor. */
  private activationRingLevel(playerId: string): number {
    return this.activationDimLevel(playerId, this.actedPlayers.has(playerId) ? 1 : 0);
  }
  /** Owner 08-19: ring alpha for dim level k — same curve/constant as the token dim (1→0.765),
   *  so an acted player's ring dims with the token but stays in its position color. */
  private ringDimAlpha(k: number): number {
    return 1 - k * (1 - 0.715);
  }
  /** Owner 2026-07-14 (#10 part 2): players the store has latched "recovering" — the server's STUNNED→PRONE
   *  (+inactive) missed-turn flip. The stun X rides this (showStunMark) so they don't look recovered a turn
   *  early. Transition-latched by the store (not a snapshot), so a wrestled-down PRONE+inactive player is not
   *  false-marked. */
  private recoveringPlayers = new Set<string>();
  setRecoveringPlayers(ids: string[]): void {
    const next = new Set(ids);
    if (next.size === this.recoveringPlayers.size && [...next].every((id) => this.recoveringPlayers.has(id))) return;
    this.recoveringPlayers = next;
    this.refresh();
  }
  /**
   * Player click hook (UI5-adjacent): fired with the clicked player and the
   * pointer position in CANVAS pixels, so the host can place a popup there.
   */
  onPlayerClick: ((playerId: string, canvasX: number, canvasY: number) => void) | null = null;

  /** #67 phase-1 (Tarkin): the renderer calls this at the VISUAL COMPLETION of a presentation animation so
   *  the store's presentation drain releases that step's gate and advances to the next tile. Injected by the
   *  view (= gameStore.onAnimDone). Contract (D3 §2 / DD-3): fired at the tween's visual END only (ticker
   *  elapsed ≥ total), NEVER at start/mid — an early call wins the store's race(waitFor, cap) and advances the
   *  drain before the animation finishes (the burst by another route). Keyed by id; a spurious/non-gated call
   *  safely no-ops store-side. Walk completions also carry the exact presentation-step sequence so a late
   *  callback from a preceding tile cannot release its neighbour. Phase-1 fires 'walk'; 'throw' is phase-2. */
  onAnimDone: ((kind: 'walk' | 'throw' | 'kickDescend', id: string, seq?: number) => void) | null = null;

  /** Classic portrait hosts cache expensive GPU readbacks. This fires only when
   * an asynchronous Classic icon-sheet acquisition has refreshed token visuals,
   * allowing those hosts to replace a temporary fallback exactly once. */
  onPortraitVisualRevision: (() => void) | null = null;

  /**
   * ORDER 66 (2026-07-11, P1): the o66 interaction owns clicks. DEFAULTS OFF; set true ONLY by the o66 PLAY
   * path (SpectateView, `settings.order66 && play.active`) — spectate mode and ClassicView must never flip it,
   * so their passes stay byte-valid. When on, the two legacy click interceptors below are bypassed so every
   * click reaches `onPlayerClick`/`onTilePick` (the o66 router → store senders): (1) the `cinematic` click-
   * freeze (:handlePointerUp) no longer swallows clicks while a cine holds, and (2) the `handleOpponentClick`
   * legacy block-preview routing is skipped. Grep `o66-dispatch` for both gate sites.
   */
  order66 = false;

  /**
   * Modern's server-confirmed per-square movement drain owns acting-player
   * movement in play, spectate, and the live tail of replay. This is separate
   * from `order66`: that flag is an interaction/click-routing capability and is
   * intentionally false outside live play. Classic leaves this disabled.
   */
  private confirmedMovementPresentationEnabled = false;
  setConfirmedMovementPresentation(enabled: boolean): void {
    // Exact PresentationStep snapshots establish animation ownership. This capability bounds projection-only
    // fast paths to legacy/no-drain surfaces while Modern's mounted rail is active.
    this.confirmedMovementPresentationEnabled = enabled;
  }

  /** Owner 2026-07-13: while MY player is selected/active in o66 play, render the configured tackle
   *  zones — decoupled from arming the move overlay (they appear ON SELECT, not only after a waypoint is
   *  plotted). Set by SpectateView (which knows the viewer's side; renderer.activePlayerId tracks the acting
   *  player on BOTH turns, so the my-turn gate lives in the host). The legacy property name is retained for
   *  host compatibility; tackleZoneMode chooses opposition, friendly, or both. */
  o66OppTzActive = false;

  /**
   * o66-dispatch guard surface (unit-tested in renderer.test.ts — the PERMANENT regression tooth for the
   * g469 click-swallow class): a holding cinematic freezes clicks ONLY when o66 is OFF. With o66 on, a
   * click must reach `onPlayerClick` even mid-cine (that was the block-confirm bug). Extracted so the
   * `!this.order66` half can never be silently dropped without failing a test.
   */
  clickFrozenByCinematic(): boolean {
    return !!this.cinematic && !this.order66;
  }

  /** Owner o66 automove PREVIEW: the pending route (server squares) shown as a trail + a highlighted
   *  destination while the coach confirms (2nd click). Drawn OUTSIDE the legacy plannerEnabled gate (that
   *  gate is off in o66). Set via setO66Path; cleared on confirm / re-plan / a fresh overlay. */
  private o66PathSquares: [number, number][] = [];
  /** owner o66m+: the mover whose reach this path belongs to — lets the preview stamp per-step dodge/rush
   *  chips (client geometry), so #9/#10 "Dodge N+" reads on the exact squares along the auto-path. */
  private o66PathMover: string | null = null;
  setO66Path(squares: [number, number][], moverId?: string | null): void {
    this.o66PathSquares = squares.slice();
    this.o66PathMover = squares.length > 1 ? (moverId ?? null) : null;
    this.redrawOverlays();
  }
  /** #77 (owner batch §N): the authoritative bb2025 pickup difficulty for the ACTING mover's ball
   *  square, supplied by the view from availableActions.pickupTargetAtBall (the cited minimumRollPickup
   *  + full modifier set). The renderer no longer computes it locally — that local formula was the
   *  leak class (missed Extra Arms + the Big-Hand/weather limb). null = no settled ball / no pickup. */
  private pickupTarget: { square: [number, number]; target: number } | null = null;
  setPickupTarget(square: [number, number] | null, target: number): void {
    this.pickupTarget = square && target > 0 ? { square: [square[0], square[1]], target } : null;
    this.redrawOverlays();
  }
  /** #73 (owner batch §N): the authoritative bb2025 foul armour-break target for a DOWN victim,
   *  supplied by the view from availableActions.foulArmourTargetAt (cited: victim AV + net foul
   *  assists + Dirty-Player/foul-bonus opts). Preferred over the renderer's local foulTarget
   *  (leak class) in actionRollText → drives both the hover tip and the armed "SKULL n+" chip.
   *  null = not a down opponent / not supplied (falls back to local). */
  private foulArmourTarget: { square: [number, number]; target: number } | null = null;
  setFoulTarget(square: [number, number] | null, target: number): void {
    this.foulArmourTarget = square && target > 0 ? { square: [square[0], square[1]], target } : null;
    this.redrawOverlays();
  }
  /** #151 (owner 07-23): bring the pass to the block flow — the rolls-required surface over the
   *  PASSER's head (THROW target) + over the destination square (CATCH target). Both values are
   *  SERVER-derived, supplied by the view: THROW = availableActions.passThrowTargetAt (⚖ cited
   *  PassMechanic.minimumRoll — NOT the ffb-pitch local passTargetRoll leak class), CATCH =
   *  availableActions.catchTargetAt. null clears each independently. Drawn as over-head "N+" plates
   *  (throwRoll amber, catchRoll a distinct hue) in redrawOverlays. */
  private throwRollCue: { square: [number, number]; target: number } | null = null;
  private catchRollCue: { square: [number, number]; target: number } | null = null;
  private passRollResolver: ((throwerId: string, from: Square, to: Square) => number | null) | null = null;
  /** Pending Monstrous Mouth target + authoritative needed roll. This is deliberately
   *  separate from PlayerStateFlag.CHOMPED: the latter means the bite already landed. */
  private chompCue: { square: [number, number]; target: number } | null = null;
  setThrowRoll(square: [number, number] | null, target: number): void {
    this.throwRollCue = square && target > 0 ? { square: [square[0], square[1]], target } : null;
    this.redrawOverlays();
  }
  setCatchRoll(square: [number, number] | null, target: number): void {
    this.catchRollCue = square && target > 0 ? { square: [square[0], square[1]], target } : null;
    this.redrawOverlays();
  }
  /** Modern hosts inject their shared authoritative pass-preview calculator here. Classic and standalone pitch
   *  consumers retain the bundled fallback, so this presentation seam changes no selection or wire behavior. */
  setPassRollResolver(resolver: ((throwerId: string, from: Square, to: Square) => number | null) | null): void {
    this.passRollResolver = resolver;
  }
  private resolvedPassRoll(throwerId: string, from: Square, to: Square): number | null {
    if (this.passRollResolver) return this.passRollResolver(throwerId, from, to);
    return passTargetRoll(this.game!, throwerId, from, to)?.roll ?? null;
  }
  setChompCue(square: [number, number] | null, target: number): void {
    this.chompCue = square && target > 0 ? { square: [square[0], square[1]], target } : null;
    // The roll chip lives on overlayLayer, while the pending-target token is a
    // token-local child like CONFUSED, so rebuild both surfaces together.
    this.refresh();
  }

  /**
   * Owner 2026-07-03: interactive push-direction hook. While a live push choice is
   * on-screen (every candidate square drawn as a gold arrow by drawPushOptions),
   * clicking a candidate square fires this with its game coordinate so the host can
   * send the pushback. Only the currently choosable (unlocked, unselected) squares
   * are live; empty when there's no push choice.
   */
  onPushChoice: ((coord: [number, number]) => void) | null = null;
  private pushOptionCoords: [number, number][] = [];

  /** Owner 2026-07-13: BALL & CHAIN AIM. A movesRandomly (Fanatic) activation picks a FACING, not a
   *  destination — so instead of walk tiles the overlay draws a gold PUSH ARROW toward each of the ≤4 orthogonal
   *  aim squares (fieldModel.moveSquareArray, server-verbatim), with a clickable crosshair at each tip. A tap
   *  fires onBncAim with that square (the host sends the aim CLIENT_MOVE; the server then scatters). Reuses the
   *  pushArrow/pushCrosshair primitives; modifies no frozen push-rail shape. Armed via setBncAim, cleared with
   *  null. Drawn in redrawOverlays; click hit-tested alongside the push options. */
  onBncAim: ((coord: [number, number]) => void) | null = null;
  private bncAimFrom: Square | null = null;
  private bncAimSquares: Square[] = [];
  private bncAimKind: 'bnc' | 'punt' = 'bnc';
  private bncAimCoords: [number, number][] = [];
  onPuntReaim: ((dir: 'ccw' | 'cw') => void) | null = null;
  private puntConeCenterWorld: { x: number; y: number } | null = null;
  private puntReaimHits: { dir: 'ccw' | 'cw'; ax: number; ay: number; bx: number; by: number; radius: number }[] = [];
  private jumpCrosshairSquares: Square[] = [];
  setBncAim(from: Square | null, squares: Square[], kind?: 'bnc' | 'punt'): void {
    this.bncAimFrom = from;
    this.bncAimSquares = from ? squares : [];
    // Owner regress 08-12: kind is EXPLICIT-ONLY — punt passes 'punt' (v2 caller); everything else is B&C.
    // The old shape heuristic misread B&C's declared-direction fan (diagonal boxes are legal) as a punt
    // and drew the cone over the B&C prompt.
    this.bncAimKind = from ? (kind ?? 'bnc') : 'bnc';
    if (from) {
      this.bncScatterDest = null;
      this.bncScatterFrom = null; // a fresh aim clears the prior step's scatter marker
    }
    this.redrawOverlays();
  }

  /** #249 (owner): view-fed jump-target crosshairs. Armed with the server's eligible jump squares
   *  (serverMoveSquares while actingPlayer.leaping); [] clears. Visual-only — the leaping click routing
   *  stays in the host. Mirrors setBncAim. */
  setJumpCrosshairs(squares: Square[]): void {
    this.jumpCrosshairSquares = squares;
    this.redrawOverlays();
  }

  /** Owner 2026-07-13 (B&C phase 2): the SCATTER destination square — a crosshair marks where the Fanatic
   *  actually landed (the server's throw-in result), shown alongside the d6 while the reroll is offered. Drawn
   *  on overlayLayer; cleared when the next aim arms or via setBncScatterDest(null). */
  private bncScatterDest: Square | null = null;
  private bncScatterFrom: Square | null = null;
  setBncScatterDest(square: Square | null, from?: Square): void {
    this.bncScatterDest = square;
    this.bncScatterFrom = square && from ? from : null;
    // A server scatter result advances Ball & Chain from AIM to RESULT. The resolved destination arrow and
    // crosshair replace the cardinal input fan; keeping both made the old aim squares look selectable while a
    // Direction/Whirling Dervish decision was pending. A subsequent genuine aim calls setBncAim(from, ...),
    // which already retires this result cue and arms the next fan.
    if (square) {
      this.bncAimFrom = null;
      this.bncAimSquares = [];
    }
    this.redrawOverlays();
  }

  /** Owner 2026-07-04 (interaction catalog 0.1): generic interactive player-pick.
   *  While armed via setPlayerPick, each eligible player carries the side-classified
   *  arrow/crosshair affordance and a tap on one reports that playerId; all other taps are
   *  swallowed so the pick can't accidentally select/move a player. Decline lives
   *  in the host UI (a button), not here. */
  onPlayerPick: ((playerId: string) => void) | null = null;
  /** Owner o66j #14: a DOUBLE-CLICK on a player token. The host (SpectateView, o66 path) uses it to Stand Up a
   *  prone own player (prone-gating lives in the host via the router's declare set). Legacy hosts leave it null
   *  → the dblclick keeps its old empty-square reset-camera behaviour. */
  onPlayerDoubleClick: ((playerId: string) => void) | null = null;
  private playerPickIds: Set<string> | null = null;
  /** FIX 7: client-rendering split carried on the same eligible-id array the host already passes. */
  private playerPickFriendlyIds: Set<string> | null = null;
  private playerPickOppositionIds: Set<string> | null = null;
  private pickCrosshairs: { node: Graphics; base: number }[] = [];
  /** Owner o66 #20 (generalized): a bobbing over-head arrow on friendly players in a server player-pick set
   *  (charge / feed / solidDefence / pickMeUp / mvp / tentacles / shadowing / …). Bobbed by the ticker;
   *  rebuilt in drawPlayerPick, cleared with the crosshairs. */
  private pickArrows: { node: Container; baseY: number; scale: number }[] = [];
  /** Client-local player annotations. Shift+left-click toggles an arrow for a rendered player token; the
   *  ids survive ordinary model refreshes/turns and clear only with the renderer's game-change teardown.
   *  Kept separate from server player-pick arrows so dialog lifecycle can never dismiss a user's marker. */
  private persistentPlayerArrowIds = new Set<string>();
  private persistentPlayerArrows: { playerId: string; node: Container; offsetY: number; scale: number }[] = [];
  /** Owner ruling 08-17 (touchback confirm-flow): optional override narrowing the bobbing arrow to a
   *  subset of friendly playerPickIds (the nominee) — hit-testing stays the FULL eligible set and opposition
   *  crosshairs are unaffected. null = no override, arrows mirror every friendly eligible player. */
  private pickArrowIds: Set<string> | null = null;
  /** Owner ruling (Charge/High Kick shading unification, live): when armed, a shaded pick draws NO
   *  crosshair/bobbing-arrow on the eligible set — eligibility reads via the ordinary active/inactive
   *  token language instead (see pickIneligibleIds). Only the persistent selection arrow (pickSelectedId)
   *  still renders. setPlayerPick's hit-testing is unaffected — this is presentation-only. */
  private pickShaded = false;
  /** The on-pitch candidate pool EXCLUDED from a shaded pick's eligible set (e.g. my on-pitch players not
   *  offered by the server for Charge/High Kick) — dimmed with the exact applyActivationShading alpha/tint,
   *  never a new color. Server-derived: callers pass the complement of the server's own eligible set. */
  private pickIneligibleIds: Set<string> | null = null;
  /** The user's CURRENT selection for a shaded pick — a persistent over-head arrow (reuses buildPickArrow)
   *  that stays set while selected, independent of the per-refresh bobbing arrows the crosshair mode uses. */
  private pickSelectedId: string | null = null;

  /** Arm (ids) or clear (null/empty) the player-pick affordances. Unclassified ids use crosshair-only fallback. */
  setPlayerPick(eligibleIds: (string[] & Partial<{ friendlyIds: readonly string[]; oppositionIds: readonly string[] }>) | null): void {
    this.playerPickIds = eligibleIds && eligibleIds.length > 0 ? new Set(eligibleIds) : null;
    this.playerPickFriendlyIds = this.playerPickIds && eligibleIds?.friendlyIds ? new Set(eligibleIds.friendlyIds) : null;
    this.playerPickOppositionIds = this.playerPickIds && eligibleIds?.oppositionIds ? new Set(eligibleIds.oppositionIds) : null;
    if (!this.playerPickIds) {
      this.pickArrowIds = null; // no armed pick ⇒ no stale arrow override either
      this.playerPickFriendlyIds = null;
      this.playerPickOppositionIds = null;
    }
    this.refresh();
  }

  /** Owner 2026-08-17 (P1 audit — "Iron Man/Knuckle Dusters cannot reach every offered
   *  reserve"): resolve a world-space tap against an ARMED player-pick (setPlayerPick), pitch
   *  square first then dugout token, gated on playerPickIds either way — the server's exact
   *  eligible set, never re-derived. Extracted from the pointerup tap handler so the resolution
   *  order is unit-testable without a WebGL/canvas harness (see renderer-o66-swallow.test.ts).
   *  Returns the picked playerId, or null when nothing eligible was hit. */
  resolveArmedPlayerPick(worldX: number, worldY: number): string | null {
    if (!this.playerPickIds) return null;
    const [sx, sy] = worldToSquare(worldX, worldY);
    const pid = this.playersBySquare.get(`${sx},${sy}`);
    if (pid && this.playerPickIds.has(pid)) return pid;
    const dh = this.dugoutHits.find((h) => Math.hypot(h.x - worldX, h.y - worldY) <= h.r);
    if (dh && this.playerPickIds.has(dh.playerId)) return dh.playerId;
    return null;
  }

  /** Owner ruling (Charge/High Kick, live): toggle the shaded-pick presentation for the currently armed
   *  player-pick. Turning it off also drops the ineligible-dim set and the persistent selection arrow so a
   *  stale override can't survive into the next (crosshair-mode) pick. */
  setPlayerPickShaded(shaded: boolean): void {
    this.pickShaded = shaded;
    if (!shaded) { this.pickIneligibleIds = null; this.pickSelectedId = null; }
    this.refresh();
  }

  /** Owner ruling (Charge/High Kick, live): the on-pitch ids to dim (activation-shading idiom) while a
   *  shaded pick is armed — the server's eligible set stays whatever setPlayerPick carries; this is purely
   *  the complement for presentation. Pass null/empty to clear. */
  setPlayerPickIneligible(ids: string[] | null): void {
    this.pickIneligibleIds = ids && ids.length > 0 ? new Set(ids) : null;
    this.refresh();
  }

  /** Owner ruling (Charge/High Kick, live): arm/clear the persistent over-head arrow marking the current
   *  selection for a shaded pick. Independent of setPlayerPickArrows (the touchback nominee-narrowing path,
   *  which still drives the crosshair-mode bobbing arrows for every other player-pick consumer). */
  setPlayerPickSelected(id: string | null): void {
    this.pickSelectedId = id;
    this.refresh();
  }

  /** Owner ruling 08-17: restrict the bobbing pick-arrow to an explicit id set (the current nominee)
   *  instead of every eligible player; the crosshair/click surface (setPlayerPick) is unaffected. Pass
   *  null to clear the override and go back to mirroring the full eligible set. */
  setPlayerPickArrows(ids: string[] | null): void {
    this.pickArrowIds = ids === null ? null : new Set(ids);
    this.refresh();
  }

  /** #161 → #216 QS-4/QS-5 (owner 07-23, AMENDED 08-04): Quick-Snap eligible-square markers. The owner's
   *  08-04 capture replaces the push-arrow fan with SMALL crosshair reticles (the buildPushCrosshair idiom
   *  at a reduced scale) at each server-sent destination, drawn in the UI PRIMARY colour — NOT the seat
   *  colour. `color` is fed by the view as settings.uiPrimary as a number (⚖ #16 boundary — the renderer
   *  never reads settings); no brighten (uiPrimary is already the chosen theme hue). `from` is retained for
   *  call-site stability but is no longer drawn (reticles mark the destinations, no fan origin). Clear with
   *  empty targets. Purely visual (⚖ renders the view's server-derived eligible set); the click surface is
   *  the host's — Fives keeps his hit target. */
  private quickSnapArrows: { from: [number, number]; targets: [number, number][]; color: number } | null = null;
  setQuickSnapArrows(from: [number, number] | null, targets: [number, number][], color: number): void {
    this.quickSnapArrows = from && targets.length > 0 ? { from, targets, color } : null;
    this.refresh();
  }

  /** #146 (owner 07-23): Pick-Me-Up eligibility cue — each eligible player carries a small bobbing arrow
   *  over the head + a "Pick-me-up?" label, so the coach sees who can be picked up at a glance. ⚖ purely
   *  the server-derived offer: Tarkin feeds the eligible playerIds off the pickMeUp playerChoice, Fives
   *  wires setPickMeUpCue on the offer's seq. INERT (null) until wired. Distinct from the generic
   *  player-pick arrow so the labelled cue reads on its own. */
  private pickMeUpCueIds: Set<string> | null = null;
  setPickMeUpCue(eligibleIds: string[] | null): void {
    this.pickMeUpCueIds = eligibleIds && eligibleIds.length > 0 ? new Set(eligibleIds) : null;
    this.refresh();
  }

  /** Owner 2026-07-04e (unknown-call handler): arm a raw TILE pick — any square
   *  click reports its coordinate via onTilePick. `eligible` (optional) draws
   *  gold crosshairs on those squares and restricts the pick to them; null =
   *  any on-pitch tile. Clear with setTilePick(false). */
  private tilePickActive = false;
  private tilePickEligible: Set<string> | null = null;
  /** Upstream Kick-after-scatter comparison: two server-sent landing candidates, presentation-only and inert. */
  private kickSkillCandidates: { ballCoordinate: [number, number]; ballCoordinateWithKick: [number, number] } | null = null;
  /** Owner 2026-07-08 (case 422): optional skill for the unified square-pick — draws a die-marking
   *  skill badge below each crosshair (Trickster, …) so the pick's meaning is self-describing. */
  private tilePickSkill: string | undefined;
  /** Owner o66 (automove/GFI): the subset of eligible tiles that are GO-FOR-IT squares (server minimumRollGfi>0)
   *  — they get a small rush-die marker so the coach sees which steps need a rush. Server-derived (⚖). */
  private tilePickGfi: Set<string> | null = null;
  /** Owner o66j (#9/#10/#11): the SERVER'S per-square minimum rolls for the eligible move tiles
   *  (`x,y`→{gfi,dodge}, 0 = not required). Drives the "D N+" dodge chip + the rush die drawn on each reachable
   *  square, so the coach sees the dodge/GFI cost of every step BEFORE committing. Server-derived (⚖). */
  private tilePickRolls: Map<string, { gfi: number; dodge: number }> | null = null;
  setO66MoveRolls(rolls: Map<string, { gfi: number; dodge: number }> | null): void {
    const next = rolls && rolls.size > 0
      ? new Map(Array.from(rolls, ([key, value]) => [key, { gfi: value.gfi, dodge: value.dodge }]))
      : null;
    if (equalMoveRollMap(this.tilePickRolls, next)) return;
    this.tilePickRolls = next;
    this.queueOverlayRedraw();
  }
  /** Owner o66 #14 / W29: per-square PASS rolls for the throw RANGE template. A number preserves the original
   *  normal-template "N+" chip byte-for-byte; free-select may supply already-filtered `{pass,catch}` values for
   *  labeled "Pass N+" / "Catch M+" plates from the same chip primitive. The renderer performs no roll math. */
  private tilePickPassRolls: Map<string, number | { pass?: number; catch?: number }> | null = null;
  setO66PassRolls(rolls: Map<string, number | { pass?: number; catch?: number }> | null): void {
    const next = rolls && rolls.size > 0
      ? new Map(Array.from(rolls, ([key, value]) => [
        key,
        typeof value === 'number' ? value : { pass: value.pass, catch: value.catch },
      ] as const))
      : null;
    if (equalPassRollMap(this.tilePickPassRolls, next)) return;
    this.tilePickPassRolls = next;
    this.queueProjectionRefresh();
  }
  /** Owner 2026-07-08 (case 422): the same skill badge for the PUSHBACK crosshairs (Sidestep) — set
   *  by the store when the defender's push choice is a Sidestep. Sidestep keeps its pushback wiring;
   *  this only shares the badge language. Cleared (undefined) when the push isn't skill-driven. */
  private pushCrosshairSkill: string | undefined;
  setPushSkill(skill?: string): void {
    if (this.pushCrosshairSkill === skill) return;
    this.pushCrosshairSkill = skill;
    this.refresh();
  }
  /** Owner 09-06: in o66 the candidate push fan (arrows + crosshairs) draws ONLY while the store has armed the
   *  direction pick for THIS coach (state.pushChoice) — the model carries pushbackSquareArray from the moment the
   *  block resolves, while a Stand Firm / Side Step reaction may still be pending on the other side, and those
   *  squares may never become anyone's choice. Unarmed = the chosen square only, like a spectator. */
  private pushOptionsArmed = false;
  setPushOptionsArmed(on: boolean): void {
    if (this.pushOptionsArmed === on) return;
    this.pushOptionsArmed = on;
    this.refresh();
  }
  onTilePick: ((coord: [number, number]) => void) | null = null;
  /** owner o66 (complete pass): an EXTRA set of clickable squares beyond `eligible` — clicks on them fire
   *  onTilePick, but they are NOT drawn as walkable move-dots. Used in PASS for the throwing-RANGE template
   *  (the reach dots show where the passer can WALK; the range squares show where it can THROW). Drawn as a
   *  faint target marker so the template reads. */
  private tilePickExtra: Set<string> | null = null;
  setTilePick(active: boolean, eligible?: [number, number][] | null, skill?: string, gfi?: [number, number][] | null, extra?: [number, number][] | null): void {
    const nextEligible = active && eligible && eligible.length > 0
      ? new Set(eligible.map((c) => `${c[0]},${c[1]}`))
      : null;
    const nextSkill = active ? skill : undefined;
    const nextGfi = active && gfi && gfi.length > 0 ? new Set(gfi.map((c) => `${c[0]},${c[1]}`)) : null;
    const nextExtra = active && extra && extra.length > 0 ? new Set(extra.map((c) => `${c[0]},${c[1]}`)) : null;
    const changed = this.tilePickActive !== active
      || !equalStringSet(this.tilePickEligible, nextEligible)
      || this.tilePickSkill !== nextSkill
      || !equalStringSet(this.tilePickGfi, nextGfi)
      || !equalStringSet(this.tilePickExtra, nextExtra);
    if (!changed) return;
    const movementOverlayOnly = !this.tilePickExtra
      && (this.tilePickSkill === 'order66-move' || !this.tilePickActive)
      && !nextExtra
      && (nextSkill === 'order66-move' || !active);
    this.tilePickActive = active;
    this.tilePickEligible = nextEligible;
    this.tilePickSkill = nextSkill;
    this.tilePickGfi = nextGfi;
    this.tilePickExtra = nextExtra;
    if (movementOverlayOnly) this.queueOverlayRedraw();
    else this.queueProjectionRefresh();
  }

  /** The sole square-pick permission predicate. Presentation/fade layers are deliberately absent. */
  private tilePickAllows(sx: number, sy: number): boolean {
    const onPitch = sx >= 0 && sx < PITCH_COLS && sy >= 0 && sy < PITCH_ROWS;
    const key = `${sx},${sy}`;
    return onPitch && (!this.tilePickEligible || this.tilePickEligible.has(key) || (this.tilePickExtra?.has(key) ?? false));
  }

  /** Server-owned square target-select rail (push/jump crosshair idiom). Passing null/empty clears the
   *  reticles and their skill badge through the same state that armed them; clicks continue through
   *  onTilePick, so callers keep their existing wire answer unchanged. */
  setTargetSelectPick(eligible: [number, number][] | null, skill?: string): void {
    this.setTilePick(Boolean(eligible?.length), eligible, skill);
  }

  /** Shade both server-sent Kick landing candidates; only the Kick-reduced square receives the K marker. */
  setKickSkillCandidates(ballCoordinate: [number, number] | null, ballCoordinateWithKick: [number, number] | null): void {
    this.kickSkillCandidates = ballCoordinate && ballCoordinateWithKick
      ? {
          ballCoordinate: [ballCoordinate[0], ballCoordinate[1]],
          ballCoordinateWithKick: [ballCoordinateWithKick[0], ballCoordinateWithKick[1]],
        }
      : null;
    this.refresh();
  }

  /** Owner 2026-07-04: interactive team-setup hook. While setup is active, a tap
   *  reports the square + any player on it so the host can place/remove/select. */
  onSetupClick: ((coord: [number, number], playerId: string | null) => void) | null = null;
  /** Owner 2026-07-14 (setup overhaul cond-b): fired on a pointerdown over a DUGOUT reserve token during setup
   *  (screen/client coords). The host begins the drag-to-pitch ghost and enforces reserve-only (KO/CAS inert). */
  onDugoutSetupDragStart: ((playerId: string, clientX: number, clientY: number) => void) | null = null;
  private setupActive = false;
  /** Owner 09-09: the last legality zones handed to setSetup — a geometry toggle (orientation / flat / flip)
   *  re-shades them at the new square quads (the old shading stayed drawn at the previous orientation). */
  private lastSetupZones: { losOk: boolean; leftOk: boolean; rightOk: boolean } | null = null;
  /** View-local setup picker selection. Presentation-only; never implies placement legality. */
  private setupSelectedPlayerId: string | null = null;
  /** Green/red zone-shading overlay for the setup phase (LOS + wide zones). */
  private setupZoneLayer = new Container();

  private dragging = false;
  private dragDistance = 0;
  private lastPointer = { x: 0, y: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  /** "x,y" square → playerId, rebuilt each refresh (click hit-testing). */
  private playersBySquare = new Map<string, string>();
  /** Live on-pitch player token generation, rebuilt alongside playersBySquare. */
  private tokensById = new Map<string, Container>();
  /** Owner 2026-07-08: dugout tokens sit OUTSIDE the pitch's worldToSquare bands (half-square
   *  columns beyond the sidelines), so a square lookup can't reach them. Their world anchor +
   *  hit radius is registered here (rebuilt in drawDugouts) for a direct proximity hit-test. */
  private dugoutHits: { x: number; y: number; r: number; playerId: string }[] = [];

  // --- selection & path planning (Match10 / activation_logic.md O1+O8) ---
  private selectedPlayerId: string | null = null;
  private plannedPath: Square[] = [];
  /** Match11/O9: which side's tackle zones render while a player is selected. */
  private tackleZoneMode: 'off' | 'opposition' | 'friendly' | 'both' = 'opposition';
  /** Fired when the selection changes (null = cleared). */
  onSelectionChange: ((playerId: string | null) => void) | null = null;
  /** Fired when the queued path changes (O8 confirm gate: the host shows Confirm). */
  onPathChange: ((path: Square[], playerId: string | null) => void) | null = null;
  /** O4/O5: declared action for the selected player; resets to auto on selection. */
  private actionMode: ActionMode = 'auto';
  /** Fired when the action mode changes (hotbar highlight sync). */
  onActionModeChange: ((mode: ActionMode) => void) | null = null;
  /** Fired on right-clicking a player (canvas pixels for menu placement). */
  onContextMenu: ((target: ContextTarget, canvasX: number, canvasY: number) => void) | null = null;
  /** Fired after a right-click consumes an open waypoint plan. The host retires its matching planner refs. */
  onWaypointPlanCancel: (() => void) | null = null;
  /** Path indices that are JUMPS (over a downed player) rather than steps. */
  private jumpSteps = new Set<number>();
  /** Double right-click window (B2-1): two quick right-clicks = full reset. */
  static DOUBLE_RCLICK_MS = 400;
  private lastRightClickAt = -Infinity;
  /** O2/O3: armed block preview; the second click on the defender confirms. */
  private pendingBlock: { defenderId: string; square: Square; preview: BlockPreview } | null = null;
  /** Owner 2026-07-08: FUMBBL block-target preview — while set, draw the block-dice
   *  COUNT over every adjacent standing opponent of this attacker (from the classic
   *  Block context menu). null = off. */
  private blockTargetsAttacker: string | null = null;
  /** Owner 2026-07-07: when set, the block-target preview shows ONLY this player (the
   *  declared blitz target) rather than every adjacent opponent. */
  private blockTargetsOnly: string | null = null;
  /** In the 40k play view, the remote coach's block decorations are model-owned:
   *  draw fieldModel.diceDecorationArray verbatim and let only its removal clear them.
   *  Off by default so other renderer hosts keep their existing preview behaviour. */
  private modelBlockDecorations = false;
  /** Host-confirmed Maximum Carnage target phase; legal squares remain the server's dice decorations. */
  private maximumCarnageTargeting = false;
  /** Server-projected Fury of the Blood God second-block pause. */
  private furySecondBlockTargeting = false;
  /** #181/KG-6 (owner, Meero SR-158/SR-161): the Beer Barrel Bash! keg-throw affordance. Meero SR-161: this is
   *  TWO affordances, not one — (a) the RANGE box (chebyshev-3 around the thrower, drawn REGARDLESS of whether
   *  any target is legal, so an empty set reads as "throw is SHORT", not "keg is BROKEN" = the actual KG-6 fix),
   *  and (b) per-target LEGALITY rings. `kegThrowerSquare` drives (a); `kegTargetSet` drives (b).
   *  ⚖ SPLIT OF CONCERNS: (a) is PURE GEOMETRY the renderer computes (a chebyshev box, field-bounded — no rule,
   *  like drawPassTemplate's ruler); (b) is the RULE `availableActions.kegTargetIds` (Tarkin `2095e3dd`, ported
   *  from ThrowKegLogicModule.isValidTarget) which lives in the APP layer — ffb-pitch cannot import it (#16 /
   *  item-74 boundary) and must not re-derive it (SR-160 dup class), so the VIEW feeds the legal ids. Fed via
   *  TWO independent setters (so the box survives a zero-legal set): `setKegRange(from)` for (a), `setKegTargets(ids)`
   *  for (b); each null-clears its own half. Server emits no keg move-squares (SR-160), so client-computed range
   *  + client-derived-then-fed legality is correct + parity-faithful; server still validates. */
  private kegThrowerSquare: [number, number] | null = null;
  private kegTargetSet: Set<string> | null = null;
  /** Owner 2026-07-06: how far above the head the block-dice preview dots sit
   *  (× TILE_H). Classic default 1.62 (shifted higher); FUMBBL40k sets it lower so
   *  the dots sit closer to the sprite's head. */
  blockDotsHeadFactor = 1.62;
  /** Fired when a block is confirmed via the O3 double-click convention. */
  onBlockConfirm: ((attackerId: string, defenderId: string, preview: BlockPreview) => void) | null = null;
  /** Q4 Option B: rejected actions surface a tooltip at the click point. */
  onActionRejected: ((message: string, canvasX: number, canvasY: number) => void) | null = null;
  /** #92 (owner, supersedes #60): sound-cue sink. The view binds this to gameStore.playSound so the
   *  renderer can fire an animation-tied sound AT THE RENDERED movement beat (setPresentationStep) rather
   *  than at model-apply. ffb-pitch stays sound-AGNOSTIC (no sounds import); null = no sink (silent). */
  onCue: ((name: string) => void) | null = null;

  // --- Owner 2026-07-04c: interactive FOUL / HAND-OFF / PASS -----------------
  /** Roll tip while hovering an eligible target in foul/handoff/pass mode
   *  (host renders the DOM tip beside the cursor); null clears it. */
  onActionHover: ((tip: { mode: 'foul' | 'handoff' | 'pass'; text: string; canvasX: number; canvasY: number } | null) => void) | null = null;
  /** Pass/bomb targeting surface (Fives contract 08-12): the hovered on-pitch square while
   *  pass/bomb free-select is armed (null off-pitch / on leave). The host drives the throw+catch
   *  tooltip and intercept feed off this; additive — the internal cursor/tip paths are unchanged. */
  onSquareHover: ((coord: [number, number] | null) => void) | null = null;
  private squareHoverLast: string | null = null;
  /** Informational pass ruler state. A non-null from with null to is armed but has no current hover target. */
  private passRulerFrom: Square | null = null;
  private passRulerTo: Square | null = null;
  private passTemplateMaxRange: 'S' | null = null;
  /** Authoritative server passCoordinate for Pass/Bomb/TTM/Swoop decisions.
   *  Presentation-only: it owns no hit area and cannot emit a field command. */
  private passDestinationMarker: Square | null = null;
  private passDestinationKind: PassDestinationKind = 'ball';
  /** PASS/BOMB use the full chart; a held Throw Team-Mate uses the same chart capped after Short. */
  setPassTemplateMaxRange(range: 'S' | null): void {
    if (this.passTemplateMaxRange === range) return;
    this.passTemplateMaxRange = range;
    this.queueProjectionRefresh();
  }
  setPassRuler(from: Square | null, to: Square | null): void {
    this.passRulerFrom = from && isOnPitch(from) ? [from[0], from[1]] : null;
    this.passRulerTo = this.passRulerFrom && to && isOnPitch(to) ? [to[0], to[1]] : null;
    if (!this.passRulerTo) this.squareHoverLast = null;
    this.redrawOverlays();
  }
  setPassDestinationMarker(square: Square | null, kind: PassDestinationKind = 'ball'): void {
    const next = square && isOnPitch(square) ? [square[0], square[1]] as Square : null;
    if (this.passDestinationMarker?.[0] === next?.[0]
        && this.passDestinationMarker?.[1] === next?.[1]
        && (!next || this.passDestinationKind === kind)) return;
    this.passDestinationMarker = next;
    this.passDestinationKind = kind;
    this.redrawOverlays();
  }
  /** A target was CLICKED (path auto-planned where needed) — the host shows the
   *  "Perform foul?/Hand off?/Pass?" modal. null = the arming was cancelled. */
  onActionTarget: ((req: { seq: number; mode: 'foul' | 'handoff' | 'pass'; targetId: string; targetSquare: Square; path: Square[]; rollText: string } | null) => void) | null = null;
  /** The armed action was CONFIRMED (second click on the target / modal button /
   *  the movement confirm bar) — the host commits the path + wire command. */
  onActionConfirm: ((req: { mode: 'foul' | 'handoff' | 'pass'; actorId: string; targetId: string; targetSquare: Square; path: Square[] }) => void) | null = null;
  private armedAction: { seq: number; mode: 'foul' | 'handoff' | 'pass'; targetId: string; square: Square; rollText: string } | null = null;
  /** Monotonic DOM occurrence for the host confirmation card. A cancelled target selected again is a new card. */
  private armedActionSeq = 0;
  private actionHoverActive = false;
  /** Plain square-hover feedback: four subtle corner brackets, kept independent of action-specific overlays. */
  private hoverSquareMarker: Container | null = null;
  /** Owner o66an: INTERACTIVE KICK PLACEMENT — the eligible aim squares (single hover crosshair, not a grid) and
   *  the live hover marker. A tap on an eligible square fires onKickPick. */
  private kickPickSquares: Set<string> | null = null;
  private kickHoverMarker: Container | null = null;
  /** Owner o66 #13: the SCATTER-DEVIATION grid that rides the kick cursor — every square the ball could deviate to
   *  (D8 direction × D6 distance from the aimed square, per upstream StepKickoffScatterRoll). On-pitch candidates
   *  render as amber tiles; off-pitch ones render as X marks into the skirt (touchback). Rebuilt each pointermove. */
  private kickScatterMarker: Container | null = null;
  onKickPick: ((coord: [number, number]) => void) | null = null;
  /** Owner 2026-07-06: per-aura shading modes ('always' every emitter, 'selected'
   *  only the selected player's, 'off' none). Each aura is surfaced independently;
   *  colours are friendly/opposition (see drawAuras + friendlyIsHome). */
  auraDPMode: 'always' | 'selected' | 'off' = 'selected';
  auraPMUMode: 'always' | 'selected' | 'off' = 'selected';
  /** #152 (owner 07-23): while a pass is PLANNED or DECLARED, reveal every Disturbing Presence aura
   *  regardless of auraDPMode (the passer needs to see the enemy DP coverage that will modify the throw).
   *  Fives sets this from the pass-plan/declare state; cleared when the pass resolves/cancels. INERT
   *  (default false) until wired — the DP aura keeps its normal mode behaviour. */
  private passRevealDP = false;
  setPassRevealDP(active: boolean): void {
    if (this.passRevealDP === active) return;
    this.passRevealDP = active;
    this.refresh();
  }
  /** Which side counts as "friendly" for aura colouring. Owner 2026-07-06: bound
   *  to HOME/AWAY (home = friendly) — the spectator default; play mode may later
   *  set this to the local coach's side. */
  friendlyIsHome = true;
  /** Owner 2026-07-08 (FC1): pitch decor — broadcast cameras + stadium light
   *  towers. On by default; FUMBBL-Classic mode turns it OFF for a plain pitch. */
  decorEnabled = true;
  /** Stadium bowl and dressing. On by default; Classic disables it. */
  stadiumEnabled = true;
  /** Owner 2026-07-08 (FUMBBL Classic): draw the on-pitch dugout boxes
   *  (reserves/KO/casualties beside the sidelines). Classic turns this OFF — the
   *  classic sidebars carry the box info, so the on-pitch dugouts are redundant. */
  dugoutsEnabled = true;
  /** Owner 2026-07-07: the faint cyan KICK TRAVEL-ARC trail (showKickTrail). Default on;
   *  a gate so a mode can suppress it. Owner: LEAVE ON in FUMBBL Classic (classic keeps
   *  the trail), so nothing sets it false today — it exists for future toggling. */
  kickTrailEnabled = true;
  /** Owner 2026-07-08: keep the camera bound to the rendered content — pan can't
   *  push the FURTHEST rendered asset (pitch + dugouts + decor) past the viewport
   *  edge, and zoom-out stops at the fit scale. On for BOTH the 40k and classic
   *  views. Cinematics bypass this (they set the camera directly). */
  clampToPitch = true;
  /** Owner 2026-07-08 (FUMBBL Classic): clamp STRICTLY to the pitch rectangle —
   *  the fit + pan + zoom-out bounds are the pitch itself (`worldWidth×worldHeight`),
   *  excluding the dugout margin (X) and the full rendered-content extent (Y) that
   *  the default `clampToPitch` allows. Requires `clampToPitch`; classic sets both. */
  clampToPitchEdge = false;
  /** Additional screen pixels the camera may travel toward the southern edge. Modern enables this only while
   * the app is fullscreen so bottom HUD chrome cannot make the endzone unreachable. */
  private southernPanExtension = 0;

  setSouthernPanExtension(pixels: number): void {
    const next = Number.isFinite(pixels) ? Math.max(0, Math.round(pixels)) : 0;
    if (next === this.southernPanExtension) return;
    this.southernPanExtension = next;
    this.clampCamera();
  }
  /** World-local bounds of all rendered content, refreshed on layout (resetCamera).
   *  The clamp works against this so it tracks the furthest asset on each axis. */
  private contentBounds: { x: number; y: number; width: number; height: number } | null = null;
  /** Re-centre the camera when the renderer/viewport resizes (owner 2026-07-08).
   *  Bound to the renderer's own 'resize' event, which fires AFTER app.screen is
   *  updated, so resetCamera reads the correct new size. */
  private onRendererResize: (() => void) | null = null;
  /** Owner 2026-07-04d: bomb/Throw-Keg target — the 3×3 blast centre (or null).
   *  Set via setBombTarget while in 'bomb' action mode; drawn by drawBombTarget. */
  private bombTarget: Square | null = null;
  /** Fired when the coach clicks a bomb target square (host confirms + wires). */
  onBombTarget: ((centre: Square) => void) | null = null;
  setBombTarget(centre: Square | null): void {
    this.bombTarget = centre;
    this.redrawOverlays();
  }

  /** This renderer's OWN drive-north flip. `fieldFlip` lives in geometry.ts as MODULE state shared by every
   *  renderer instance, so a flip left true by a previous view (spectate) survived into the next mount and
   *  mirrored the board 180 degrees for the whole session — the "seat transform is not applying" P1 (g868).
   *  A fresh renderer owns the projection: adopt this instance's value at init instead of inheriting. */
  private fieldFlipMode = false;
  /** @internal init seam (also the unit-test hook): stamp THIS renderer's flip onto the shared projection. */
  private adoptFieldFlipState(): void {
    setFieldFlip(this.fieldFlipMode);
  }

  init(host: HTMLElement): Promise<void> {
    if (this.initPromise) return this.initPromise;
    if (this.destroyed) return Promise.resolve();
    const generation = ++this.initGeneration;
    PitchRenderer.instances.add(this);
    this.initPromise = this.initRenderer(host, generation);
    return this.initPromise;
  }

  private async initRenderer(host: HTMLElement, generation: number): Promise<void> {
    this.adoptFieldFlipState(); // before any draw: never inherit a stale module-global flip
    const app = new Application();
    this.initializingApp = app;
    try {
      await app.init({
        background: 0x14161a,
        resizeTo: host,
        antialias: true,
        // Owner 09-05: pixel art — every sprite lands on a whole device pixel (no sub-pixel placement).
        roundPixels: true,
        // B9-18: keep the canvas CSS size = host size while rendering at higher
        // resolution. Without this, setVideoOptions raising the resolution to the
        // devicePixelRatio blew the canvas CSS up by that factor (2.5× on hi-DPI),
        // overflowing the page and making the UI look duplicated.
        autoDensity: true,
      });
    } catch (error) {
      if (!this.initActive(generation, app)) {
        this.destroyApplication(app);
        return;
      }
      this.initializingApp = null;
      throw error;
    }
    if (!this.initActive(generation, app)) {
      this.destroyApplication(app);
      if (this.initializingApp === app) this.initializingApp = null;
      return;
    }
    this.app = app;
    this.initializingApp = null;
    host.appendChild(app.canvas);

    // Owner 2026-07-08: on any host/viewport resize, re-centre the camera on the
    // pitch. Pixi's resizeTo resizes the canvas and emits 'resize' once app.screen
    // is current; recentre then. Applies to both the 40k + classic views (shared).
    // Owner 2026-07-13 (#6): a mid-play canvas resize (a HUD panel/dialog toggling, or a window resize) used to
    // auto-refit the camera — yanking any zoom/pan the coach had set (the "camera resets its zoom, can't tell
    // why"). Only refit when the view is still AT THE FIT (untouched — world.scale ≈ the fit reference). Once
    // the coach has zoomed in (scale diverged), PRESERVE their zoom/pan on resize: just redraw the backdrop +
    // rescale overlays. Explicit refits (first layout, new game, orientation/flat/flip toggles) still reset.
    this.onRendererResize = () => {
      if (!this.app) return;
      this.resetAutoDirectorCamera(true);
      const fit = this.cameraFitScale || this.world.scale.x;
      const atFit = Math.abs(this.world.scale.x - fit) <= fit * 0.02;
      if (atFit) this.resetCamera();
      else {
        this.drawBackdrop();
        this.updateOverlayScales();
        // owner 08-27 (1080p-maximize bug): a diverged camera keeps its zoom/pan on resize, but the
        // held POSITION was legal for the OLD screen — on a grown window it left the southern content
        // cropped until an orientation swap forced a refit. Re-legalize against the new bounds: a
        // fit-sized axis recentres, a zoomed-in pan is pulled inside the new legal range.
        this.clampCamera();
      }
    };
    app.renderer.on('resize', this.onRendererResize);

    try {
      await loadSprites();
      if (!this.initActive(generation, app)) return;
      this.spritesReady = true;
    } catch (error) {
      console.warn('ffb-pitch: sprite load failed, using vector tokens', error);
    }
    if (!this.initActive(generation, app)) return;
    try {
      await loadSkillIcons();
      if (!this.initActive(generation, app)) return;
    } catch (error) {
      console.warn('ffb-pitch: skill icons failed to load, using initials badges', error);
    }
    if (!this.initActive(generation, app)) return;
    await this.loadBlockFaceTextures();
    if (!this.initActive(generation, app)) return;
    try {
      const texture = await Assets.load<Texture>(new URL('../assets/status/casualty_skull.png', import.meta.url).href);
      if (!this.initActive(generation, app)) return;
      texture.source.scaleMode = 'nearest';
      this.casualtySkullTexture = texture;
    } catch {
      this.casualtySkullTexture = null;
    }
    if (!this.initActive(generation, app)) return;
    try {
      await this.loadD6FaceTextures(this.d6FaceVariant);
      if (!this.initActive(generation, app)) return;
    } catch (error) {
      console.warn('ffb-pitch: d6 faces failed to load, using vector dice', error);
    }
    if (!this.initActive(generation, app)) return;
    try {
      const texture = await Assets.load<Texture>(new URL('../assets/status/gfi.png', import.meta.url).href);
      if (!this.initActive(generation, app)) return;
      texture.source.scaleMode = 'nearest';
      this.gfiDieTagTexture = texture;
    } catch {
      this.gfiDieTagTexture = null;
    }
    if (!this.initActive(generation, app)) return;
    try {
      const texture = await Assets.load<Texture>(new URL('../assets/status/pickup.png', import.meta.url).href);
      if (!this.initActive(generation, app)) return;
      texture.source.scaleMode = 'nearest';
      this.pickupDieTagTexture = texture;
    } catch {
      this.pickupDieTagTexture = null;
    }
    if (!this.initActive(generation, app)) return;
    try {
      const texture = await Assets.load<Texture>(new URL('../assets/status/dodge.png', import.meta.url).href);
      if (!this.initActive(generation, app)) return;
      texture.source.scaleMode = 'nearest';
      this.dodgeDieTagTexture = texture;
    } catch {
      this.dodgeDieTagTexture = null;
    }
    if (!this.initActive(generation, app)) return;
    try {
      const texture = await Assets.load<Texture>(new URL('../assets/status/pass.png', import.meta.url).href);
      if (!this.initActive(generation, app)) return;
      texture.source.scaleMode = 'nearest';
      this.passDieTagTexture = texture;
    } catch {
      this.passDieTagTexture = null;
    }
    if (!this.initActive(generation, app)) return;
    try {
      // owner 09-08: 1254px master — linear + mipmaps so the badge downsamples cleanly at every zoom.
      const texture = await Assets.load<Texture>(new URL('../assets/status/catch.png', import.meta.url).href);
      if (!this.initActive(generation, app)) return;
      texture.source.autoGenerateMipmaps = true;
      this.catchDieTagTexture = texture;
    } catch {
      this.catchDieTagTexture = null;
    }
    if (!this.initActive(generation, app)) return;
    // Owner 09-06: block decorations (transparent PNGs, drawn ~20 token units tall — linear sampling on purpose).
    try {
      const texture = await Assets.load<Texture>(new URL('../assets/decorations/block-target-front.png', import.meta.url).href);
      if (!this.initActive(generation, app)) return;
      texture.source.autoGenerateMipmaps = true; // 09-07: crisp 1254 -> ~18 unit downscale
      this.blockTargetDecoTexture = texture;
    } catch {
      this.blockTargetDecoTexture = null;
    }
    if (!this.initActive(generation, app)) return;
    try {
      const texture = await Assets.load<Texture>(new URL('../assets/decorations/block-attacker-fist.png', import.meta.url).href);
      if (!this.initActive(generation, app)) return;
      this.blockAttackerDecoTexture = texture;
    } catch {
      this.blockAttackerDecoTexture = null;
    }
    if (!this.initActive(generation, app)) return;
    try {
      const texture = await Assets.load<Texture>(new URL('../assets/status/eye-gouge.png', import.meta.url).href);
      if (!this.initActive(generation, app)) return;
      texture.source.scaleMode = 'nearest';
      this.eyeGougeDecoTexture = texture;
    } catch {
      this.eyeGougeDecoTexture = null;
    }
    if (!this.initActive(generation, app)) return;
    try {
      const texture = await Assets.load<Texture>(new URL('../assets/decorations/blitzer.png', import.meta.url).href);
      if (!this.initActive(generation, app)) return;
      this.blitzerDecoTexture = texture;
    } catch {
      this.blitzerDecoTexture = null;
    }
    if (!this.initActive(generation, app)) return;
    try {
      const texture = await Assets.load<Texture>(new URL('../assets/decorations/rooted.png', import.meta.url).href);
      if (!this.initActive(generation, app)) return;
      texture.source.autoGenerateMipmaps = true; // 1942 px word drawn ~23 units wide
      this.rootedDecoTexture = texture;
    } catch {
      this.rootedDecoTexture = null;
    }
    if (!this.initActive(generation, app)) return;
    try {
      const texture = await Assets.load<Texture>(new URL('../assets/decorations/blitz-target.png', import.meta.url).href);
      if (!this.initActive(generation, app)) return;
      texture.source.autoGenerateMipmaps = true;
      this.blitzTargetDecoTexture = texture;
    } catch {
      this.blitzTargetDecoTexture = null;
    }
    if (!this.initActive(generation, app)) return;
    // Owner 09-06: Move / Pass / Foul action decorations (transparent PNGs, drawn ~40 units tall).
    for (const [file, key] of [
      ['action-move.png', 'actionMoveDecoTexture'],
      ['action-pass.png', 'actionPassDecoTexture'],
      ['action-foul.png', 'actionFoulDecoTexture'],
      ['action-handoff.png', 'actionHandoffDecoTexture'], // owner 09-08
    ] as const) {
      try {
        const texture = await Assets.load<Texture>(new URL(`../assets/decorations/${file}`, import.meta.url).href);
        if (!this.initActive(generation, app)) return;
        this[key] = texture;
      } catch {
        this[key] = null;
      }
      if (!this.initActive(generation, app)) return;
    }
    try {
      const source = await Assets.load<GifSource>(
        new URL('../assets/fireball-snes/explosion.gif', import.meta.url).href,
      );
      if (!this.initActive(generation, app)) return;
      for (const frame of source.frames) frame.texture.source.scaleMode = 'nearest';
      this.fireballExplosionGif = source;
    } catch (error) {
      this.fireballExplosionGif = null;
      console.warn('ffb-pitch: explosion GIF failed to load, using procedural blast', error);
    }
    if (!this.initActive(generation, app)) return;
    try {
      // Owner 2026-07-07: the SW turn-track tokens (background-keyed from the owner's art).
      const tok = (name: string) =>
        Assets.load<Texture>(new URL(`../assets/tokens/${name}.png`, import.meta.url).href);
      [this.tokenDie, this.tokenHourglass, this.tokenScore, this.tokenRerollIcon] = await Promise.all([
        tok('die'),
        tok('hourglass'),
        tok('score'),
        tok('reroll_icon'),
      ]);
      if (!this.initActive(generation, app)) return;
    } catch (error) {
      console.warn('ffb-pitch: turn-track tokens failed to load', error);
    }

    if (!this.initActive(generation, app)) return;

    // synced face animation: the face index derives from the wall clock, so
    // every die (and every armed preview) shows the same face simultaneously.
    // Owner 2026-07-02: slowed from 450ms; final value pending the UI-7
    // timing study (owner reviews 2 options once per-action pacing lands).
    // Owner 2026-07-04: smooth WASD camera GLIDE. The world eases toward the held
    // pan direction's velocity and decelerates to a stop on release — replacing the
    // old instant 45px tile-shift per keypress.
    app.ticker.add(() => {
      const targetX = this.panDir.x * this.panSpeedPx; // px/frame at full glide (Settings > Controls, 09-05)
      const targetY = this.panDir.y * this.panSpeedPx;
      this.panVel.x += (targetX - this.panVel.x) * 0.18; // ease-in / decelerate
      this.panVel.y += (targetY - this.panVel.y) * 0.18;
      if (Math.abs(this.panVel.x) < 0.05) this.panVel.x = 0;
      if (Math.abs(this.panVel.y) < 0.05) this.panVel.y = 0;
      if (this.panVel.x !== 0 || this.panVel.y !== 0) {
        this.world.position.x += this.panVel.x;
        this.world.position.y += this.panVel.y;
        this.clampCamera(); // FC: WASD glide also blocks at the pitch edge
      }
    });
    // item3: activation-dim cross-fade. Repaints ONLY the alpha/tint of the fading tokens (no rebuild),
    // off the same clock the rebuild path reads, so a turnover eases evenly in both directions.
    app.ticker.add(() => {
      if (this.activationFades.size === 0) return;
      const now = this.activationClock();
      const ms = this.activationFadeMs();
      for (const [id, f] of [...this.activationFades]) {
        const done = now - f.start >= ms;
        this.activationFadePaint.get(id)?.(done ? f.to : this.activationDimLevel(id, f.to));
        if (done) { this.activationFades.delete(id); this.activationFadePaint.delete(id); }
      }
    });
    app.ticker.add(() => {
      if (this.movementOverlayFades.size === 0) return;
      const now = performance.now();
      const ms = this.movementOverlayFadeMs();
      for (const [key, fade] of [...this.movementOverlayFades]) {
        const node = fade.entry.node;
        if (node.destroyed) { this.movementOverlayFades.delete(key); continue; }
        const t = ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - fade.start) / ms));
        const eased = t * t * (3 - 2 * t);
        node.alpha = fade.from * (1 - eased);
        if (t >= 1) {
          node.parent?.removeChild(node);
          node.destroy({ children: true });
          this.movementOverlayFades.delete(key);
        }
      }
    });
    // move interpolation (item 12 + B3-3 styles): waypoint-driven travel
    app.ticker.add(() => {
      // Owner 09-06: a zoom change wakes the walkers BEFORE the idle early-return, so the integer snap and the
      // decoration scale land on the same frame the camera moved (they used to wait for the next wake-up).
      if (Math.abs(app.renderer.resolution * this.world.scale.x - this.lastWalkerDeviceScale) > 1e-4) markWalkersDirty();
      if (this.moveTweens.size === 0 && !walkersNeedTick(this.walkerOwnerId)) return;
      const now = performance.now();
      for (const [id, tween] of this.moveTweens) {
        this.anchorPresentationTileOnFirstTweenPass(id, tween, now);
        const segments = tween.waypoints.length - 1;
        const total = segments * tween.segmentMs;
        const elapsed = now - tween.start;
        if (elapsed >= total || segments <= 0) {
          const end = tween.waypoints[tween.waypoints.length - 1]!;
          tween.token.position.set(end.x, end.y);
          this.followTokenDecorations(id, end.x, end.y);
          // kick grow: 'up' ends BIG (the ball hangs at the apex); the rest end at base.
          if (tween.baseScale != null && tween.growTo)
            tween.token.scale.set(tween.growMode === 'up' ? tween.baseScale * tween.growTo : tween.baseScale);
          if (tween.movementIntent) {
            // The bounded first stride is not a presented server step: hold short of the destination and never
            // release the authoritative movement gate. Confirmation or rollback owns the next transition.
            this.moveTweens.delete(id);
            continue;
          }
          if (tween.reconcileKey) {
            this.completeAuthoritativeReconciliation(id, tween.reconcileKey);
            continue;
          }
          if (tween.postStepCorrectionKey) {
            this.completePostStepCorrection(id, tween.postStepCorrectionKey);
            continue;
          }
          this.finishPresentationStepTween(id, tween, end);
          continue;
        }
        const segment = Math.min(segments - 1, Math.floor(elapsed / tween.segmentMs));
        const t = (elapsed - segment * tween.segmentMs) / tween.segmentMs;
        const ease = (tween.style === 'slide' || tween.style === 'trail') && tween.easeOut !== false
          ? 1 - (1 - t) * (1 - t)
          : t;
        const a = tween.waypoints[segment]!;
        const b = tween.waypoints[segment + 1]!;
        let x = a.x + (b.x - a.x) * ease;
        let y = a.y + (b.y - a.y) * ease;
        if (tween.arc) {
          ({ x, y } = kickArcTweenPosition(a, b, ease, elapsed / total, tween.arc)); // one big arc over the whole flight (kick)
        } else if (tween.style === 'hop' || tween.style === 'hoptrail') {
          y -= Math.sin(t * Math.PI) * 9; // per-tile arc (hop / bob-with-echo)
        } else if (tween.style === 'walk') {
          y -= Math.abs(Math.sin(t * Math.PI * 2)) * 1.6; // step bob
        }
        tween.token.position.set(x, y);
        this.followTokenDecorations(id, x, y);
        // kick grow/shrink: h∈[0,1] rises with the flight ('up'), falls on descent
        // ('down'), or peaks mid-flight ('arc'). Scale = baseScale·(1+(growTo−1)·h).
        if (tween.baseScale != null && tween.growTo) {
          const h = tween.growMode === 'down' ? 1 - ease : tween.growMode === 'arc' ? Math.sin((elapsed / total) * Math.PI) : ease;
          tween.token.scale.set(tween.baseScale * (1 + (tween.growTo - 1) * h));
        }
      }
      // Owner 09-05: pick the walk-sheet sampling for the CURRENT effective scale (canvas resolution x camera zoom x
      // sheet scale): >= 1 device px per art px -> nearest (crisp), else linear (minified, no pixel dropout).
      // Owner 09-05 (round 8): the snap is PER TOKEN inside tickWalkers (depth x Strength folded in) — the renderer
      // only supplies the device scale and keeps both sheets on nearest sampling.
      const deviceScale = app.renderer.resolution * this.world.scale.x;
      if (Math.abs(deviceScale - this.lastWalkerDeviceScale) > 1e-4) { this.lastWalkerDeviceScale = deviceScale; this.walkerZoomSettleAt = now + 250; }
      const zoomSettled = now >= this.walkerZoomSettleAt;
      // Owner 09-05 (round 10): pixel art samples NEAREST always — the linear-while-zooming pass read as a blur veil.
      setWalkSheetSampling('nearest');
      tickWalkers(this.walkerOwnerId, now, this.moveTweens, deviceScale, zoomSettled, this.walkerSnapExempt());
      this.redrawBlockPreviewOnDecorChange();
      this.replaceActiveMarkerOnDecorChange();
    });
    // Unified Auto Director runs after visual movement advances, so it follows the
    // presented token/ball rather than an immediate-apply model endpoint.
    app.ticker.add(() => {
      this.tickAutoDirector(this.app?.ticker.deltaMS ?? 0, performance.now());
      this.adCompletedMotionTargets.clear();
    });
    // knockdown/injury flash rings (F-5): expand + fade over 600ms.
    // Rings may carry a FUTURE start (B5-7 staggered stomps) — hidden until due.
    app.ticker.add(() => {
      if (this.flashRings.length === 0) return;
      const now = performance.now();
      this.flashRings = this.flashRings.filter((flash) => {
        const t = (now - flash.start) / (flash.durationMs ?? presentationMs(600));
        if (t < 0) return true; // not started yet
        flash.g.visible = true;
        if (t >= 1) {
          flash.g.parent?.removeChild(flash.g);
          flash.g.destroy();
          return false;
        }
        flash.g.scale.set(flash.scale * (1 + t * (flash.grow ?? 0.9)));
        flash.g.alpha = 1 - t;
        return true;
      });
    });
    // Owner o66 #7: over-head pass/catch roll modals — a quick pop-in (back-out), a hold, then rise + fade (~1.9s).
    const RM_IN = presentationMs(160), RM_HOLD = presentationMs(1400), RM_OUT = presentationMs(340);
    app.ticker.add(() => {
      if (this.rollModals.length === 0) return;
      const now = performance.now();
      this.rollModals = this.rollModals.filter((m) => {
        if (m.node.destroyed) return false;
        const e = now - m.start;
        if (e >= RM_IN + RM_HOLD + RM_OUT) { m.node.parent?.removeChild(m.node); m.node.destroy({ children: true }); return false; }
        if (e < RM_IN) { const p = e / RM_IN; m.node.scale.set(1.15 - 0.15 * (1 - (1 - p) * (1 - p))); m.node.alpha = p; }
        else if (e < RM_IN + RM_HOLD) { m.node.scale.set(1); m.node.alpha = 1; }
        else { const p = (e - RM_IN - RM_HOLD) / RM_OUT; m.node.alpha = 1 - p; m.node.position.y = m.baseY - p * 10; }
        return true;
      });
    });
    // On-pitch action d6 (owner 2026-07-03 r3): a quick back-out pop-in, a hold,
    // then a fade. ~1.6s total; self-removing.
    const DIE_IN = presentationMs(ACTION_DIE_IN_MS);
    const DIE_HOLD = presentationMs(ACTION_DIE_HOLD_MS);
    const DIE_OUT = presentationMs(ACTION_DIE_OUT_MS);
    app.ticker.add(() => {
      if (this.actionDice.length === 0) return;
      const now = performance.now();
      this.actionDice = this.actionDice.filter((die) => {
        const rawElapsed = now - die.start;
        // Owner 09-06: a FAILED re-rolled die is held until the turnover tears it down (backstop 6 s so it can
        // never stick); the opponent-reroll hold ends when the reroll dialog closes.
        if (die.holdUntilTurnover && rawElapsed > presentationMs(6000)) die.holdUntilTurnover = false;
        const e = die.holdForOpponentReroll || die.holdUntilTurnover
          ? Math.min(rawElapsed, DIE_IN + DIE_HOLD)
          : rawElapsed;
        if (e >= DIE_IN + DIE_HOLD + DIE_OUT) {
          die.node.parent?.removeChild(die.node);
          die.node.destroy({ children: true });
          return false;
        }
        if (e < DIE_IN) {
          const t = e / DIE_IN;
          const back = 1 + 2.2 * (t - 1) * (t - 1) * (t - 1) + 1.2 * (t - 1) * (t - 1); // ease-out-back-ish
          die.node.scale.set(die.baseScale * Math.max(0.05, back));
          die.node.alpha = Math.min(1, t * 1.6);
        } else if (e < DIE_IN + DIE_HOLD) {
          die.node.scale.set(die.baseScale);
          die.node.alpha = 1;
        } else {
          const t = (e - DIE_IN - DIE_HOLD) / DIE_OUT;
          die.node.alpha = 1 - t;
          die.node.scale.set(die.baseScale * (1 + t * 0.15));
        }
        return true;
      });
    });

    // Owner 09-08: log double-click camera focus — an eased pan (+ zoom-in from the whole-pitch fit) onto one
    // square; the cinematic camera and the auto-director both outrank it (see focusOnSquare).
    app.ticker.add(() => {
      const focus = this.cameraFocus;
      if (!focus || !this.app || this.cinematic) { if (focus && this.cinematic) this.cameraFocus = null; return; }
      const t = Math.min(1, (performance.now() - focus.start) / focus.ms);
      const e = 1 - (1 - t) * (1 - t);
      const scale = focus.fromScale + (focus.toScale - focus.fromScale) * e;
      const cx = this.app.screen.width / 2 - focus.target.x * focus.toScale;
      const cy = this.app.screen.height / 2 - focus.target.y * focus.toScale;
      this.world.scale.set(scale);
      this.world.position.set(focus.fromX + (cx - focus.fromX) * e, focus.fromY + (cy - focus.fromY) * e);
      this.updateOverlayScales();
      if (t >= 1) this.cameraFocus = null;
    });

    // B5-5 cinematic camera: 400ms ease in → hold → 450ms ease out
    const CINE_IN = 400;
    const CINE_OUT = 450;
    app.ticker.add(() => {
      const cine = this.cinematic;
      if (!cine || !this.app) return;
      // owner 2026-07-04: calmer default zoom (was 2.4×) — the auto director is
      // less intense/distracting for general spectating.
      // Owner 2026-07-08: NEVER zoom OUT below the viewer's current zoom. If the user has
      // manually zoomed IN past the cinematic target, the cinematic used to yank them back
      // to 1.7× (read as "the auto-director resets to full zoom"). Clamp to their saved
      // scale so a cinematic CENTERS at their zoom; it still zooms in for un-zoomed viewers.
      const zoomScale = this.quantizeZoom(Math.max(cine.savedScale, this.cameraFitScale * (cine.zoom ?? 1.7)), 'nearest');
      // Kick tracking: follow the live point (the ball in flight) instead of a
      // fixed square.
      const target = cine.track ? cine.track() : cine.target;
      const centerFor = (scale: number) => ({
        x: this.app!.screen.width / 2 - target.x * scale,
        y: this.app!.screen.height / 2 - target.y * scale,
      });
      const elapsed = performance.now() - cine.start;
      const ease = (t: number) => 1 - (1 - t) * (1 - t);
      if (elapsed < CINE_IN) {
        const t = ease(elapsed / CINE_IN);
        const scale = cine.savedScale + (zoomScale - cine.savedScale) * t;
        const c = centerFor(zoomScale);
        this.world.scale.set(scale);
        this.world.position.set(cine.savedX + (c.x - cine.savedX) * t, cine.savedY + (c.y - cine.savedY) * t);
      } else if (elapsed < CINE_IN + cine.holdMs) {
        const c = centerFor(zoomScale);
        this.world.scale.set(zoomScale);
        this.world.position.set(c.x, c.y);
      } else if (elapsed < CINE_IN + cine.holdMs + CINE_OUT) {
        const t = ease((elapsed - CINE_IN - cine.holdMs) / CINE_OUT);
        const c = centerFor(zoomScale);
        this.world.scale.set(zoomScale + (cine.savedScale - zoomScale) * t);
        this.world.position.set(c.x + (cine.savedX - c.x) * t, c.y + (cine.savedY - c.y) * t);
      } else {
        this.world.scale.set(cine.savedScale);
        this.world.position.set(cine.savedX, cine.savedY);
        this.cinematic = null;
      }
      this.updateOverlayScales();
    });
    // ball-carrier marker bob (queue item 9) + active-player marker bob (B9-2)
    app.ticker.add(() => {
      if (this.activeMarker) {
        // Owner: the current-player badge pulses in size (grows/shrinks).
        const p = 0.5 + 0.5 * Math.sin(performance.now() / presentationMs(360));
        this.activeMarker.node.scale.set(this.activeMarker.baseScale * (0.86 + 0.28 * p));
      }
      // Shared live-play-adopted active-player pop — on an active-player change
      // the gold halo grows to ~1.25x then settles back over ~380ms (one shot),
      // the "selected unit" juice used by 2D sprite/tactics games. Idle = 1x.
      // Owner 09-05: the carrier's cyan glow ring breathes slightly (~8% over a ~1.3 s cycle, alpha 0.34-0.46).
      if (this.ballHalo && !this.ballHalo.destroyed) {
        const w = Math.sin(performance.now() / presentationMs(205));
        this.ballHalo.scale.set(1 + 0.08 * w);
        this.ballHalo.alpha = 0.4 + 0.06 * w;
      }
      if (this.activeHalo && !this.activeHalo.destroyed) {
        const haloDecor = (this.activeHaloToken && !this.activeHaloToken.destroyed ? walkerDecorScale(this.activeHaloToken) : null) ?? 1;
        if (this.haloPulseStart) {
          const dt = performance.now() - this.haloPulseStart;
          const dur = presentationMs(380);
          if (dt >= dur) this.haloPulseStart = 0; // pop done → fall through to the idle breathe
          else { const k = dt / dur; this.activeHalo.scale.set(haloDecor * (1 + 0.25 * Math.sin(Math.PI * k))); }
        }
        // Owner 2026-07-07: after the selection pop, the active-player glow BREATHES — grows
        // slightly and shrinks on a ~1s cycle (never fully static while a player is active).
        if (!this.haloPulseStart) {
          this.activeHalo.scale.set(haloDecor * (1 + 0.06 * Math.sin(performance.now() / presentationMs(159))));
        }
      }
      // Owner: the CHOSEN push option pulses while the others sit faded.
      for (const arrow of this.pushOptionPulse) {
        if (!arrow.destroyed) arrow.alpha = 0.55 + 0.45 * Math.sin(performance.now() / 170);
      }
      // Owner 2026-07-03: the push-target crosshairs pulse (scale + alpha) to draw
      // the eye to where to click.
      if (this.pushCrosshairs.length > 0 || this.pickCrosshairs.length > 0) {
        const p = 0.5 + 0.5 * Math.sin(performance.now() / 200);
        for (const ch of [...this.pushCrosshairs, ...this.pickCrosshairs]) {
          if (ch.node.destroyed) continue;
          // Owner 2026-07-08: a subtler pulse — a small 0.94→1.06 breathe (was 0.82→1.14, too big).
          ch.node.scale.set(ch.base * (0.94 + 0.12 * p));
          ch.node.alpha = 0.7 + 0.3 * p;
        }
      }
      // Owner o66 #20: the over-head pick arrows bob down toward the player (a gentle 350ms hop, scaled by depth).
      for (const a of this.pickArrows) {
        if (a.node.destroyed) continue;
        a.node.position.y = a.baseY + Math.abs(Math.sin(performance.now() / 350)) * 6 * a.scale;
      }
      this.updatePersistentPlayerArrows(performance.now());
      if (this.ballMarker) {
        this.ballMarker.node.position.y =
          this.ballMarker.baseY - Math.abs(Math.sin(performance.now() / presentationMs(350))) * (this.ballMarker.bob ?? 6);
      }
      this.updateOffscreenBallIndicator();
      this.updateOffscreenActivePlayerIndicator();
      if (this.ballGlow) {
        // Owner 2026-07-06: the cyan GLOWING CIRCLE breathes — brightness + a gentle UNIFORM scale.
        // #26 (owner 07-16): a LOOSE ball IN MOTION (bouncing / scattering — `!ballAtRest`) pulses HARDER +
        // faster — a bigger ATTENTION beat so the eye tracks where the ball is heading; a settled loose ball
        // keeps the calm breathe. ⚠ Magnitudes are a first pass — flagged for the owner's eyeball to tune.
        const bouncing = !this.ballAtRest;
        const t = 0.5 + 0.5 * Math.sin(performance.now() / presentationMs(bouncing ? 240 : 420));
        const aLo = bouncing ? 0.4 : 0.55;
        const sLo = bouncing ? 0.8 : 0.9;
        const sHi = bouncing ? 1.34 : 1.08;
        this.ballGlow.alpha = aLo + (1 - aLo) * t;
        this.ballGlow.scale.set(sLo + (sHi - sLo) * t);
      }
    });
    app.ticker.add(() => {
      if (this.blockDiceSprites.length === 0 || this.blockFaceTextures.length === 0) return;
      const face =
        this.blockFaceTextures[Math.floor(performance.now() / presentationMs(PitchRenderer.DICE_FACE_MS)) % this.blockFaceTextures.length]!;
      for (const sprite of this.blockDiceSprites) {
        if (sprite.texture !== face) sprite.texture = face;
      }
    });
    try {
      // Turf themes: grass1 = Acasas 64px leafy tile (uniform);
      // grass2 = unTied world-map 16px pair, alternating per row
      const load = async (name: string) => {
        const texture = await Assets.load<Texture>(new URL(`../assets/textures/${name}.png`, import.meta.url).href);
        if (!this.initActive(generation, app)) return null;
        texture.source.scaleMode = 'nearest';
        texture.source.addressMode = 'repeat';
        return texture;
      };
      const grass = await load('grass');
      if (!grass || !this.initActive(generation, app)) return;
      this.turfThemes.set('grass1', [grass]);
      // grass2 (unTied world-map pair) removed from tile options (owner
      // 2026-07-02, UI-4); assets stay staged under assets/textures
      // Owner 2026-09-05: dugout cobble is the owner-original PixelLab tile (assets/ground/, Tier D). The Acasas
      // textures/stone.png is installer-only (GDM licence forbids raw redistribution) and no longer referenced.
      this.stoneTexture = await Assets.load<Texture>(new URL('../assets/ground/cobble.png', import.meta.url).href);
      if (!this.initActive(generation, app)) return;
      this.stoneTexture.source.scaleMode = 'nearest';
      this.stoneTexture.source.addressMode = 'repeat';
      if (!this.stoneTexture || !this.initActive(generation, app)) return;
      // FUMBBL's own prone/stunned notation (slash / X overlays) + the
      // treacherous-trapdoor field icon (B7-6; TrapDoor decorations)
      for (const name of ['prone', 'stunned', 'trapdoor', 'breastplate']) {
        const texture = await Assets.load<Texture>(new URL(`../assets/decorations/${name}.png`, import.meta.url).href);
        if (!this.initActive(generation, app)) return;
        texture.source.scaleMode = 'nearest';
        this.downDecorations.set(name, texture);
      }
      // Apothecary/doctor sprite for the treatment cinematic (owner 2026-07-03 r6f).
      try {
        const apoTex = await Assets.load<Texture>(new URL(`../assets/resources/apothecary.png`, import.meta.url).href);
        if (!this.initActive(generation, app)) return;
        apoTex.source.scaleMode = 'nearest';
        this.apothecaryTexture = apoTex;
      } catch {
        this.apothecaryTexture = null; // drawn medic fallback
      }
      if (!this.initActive(generation, app)) return;
      // #135 (owner 07-23): frog sprite for a zapped player (pixel art → nearest). Falls back to the
      // normal position sprite if it can't load (the gate in buildPlayerToken checks frogTexture).
      try {
        const frogTex = await Assets.load<Texture>(new URL(`../assets/resources/frog.png`, import.meta.url).href);
        if (!this.initActive(generation, app)) return;
        frogTex.source.scaleMode = 'nearest';
        this.frogTexture = frogTex;
      } catch {
        this.frogTexture = null;
      }
      if (!this.initActive(generation, app)) return;
      // Spiked skull Blood Bowl ball sprite (owner 2026-07-06: extracted from the
      // Blood Bowl sprite sheet, 128px, transparent); 'linear' so the painterly art
      // stays smooth. Falls back to the drawn dot.
      try {
        const ballTex = await Assets.load<Texture>(new URL(`../assets/ball.png`, import.meta.url).href);
        if (!this.initActive(generation, app)) return;
        ballTex.source.scaleMode = 'linear';
        this.ballTexture = ballTex;
      } catch {
        /* no bundled ball sprite — the drawn dot is used */
      }
      if (!this.initActive(generation, app)) return;
      // Original fantasy-sports skybox behind the stadium bowl (replaces the
      // procedural night sky when present).
      try {
        const bd = await Assets.load<Texture>(new URL(`../assets/fantasy-skybox.png`, import.meta.url).href);
        if (!this.initActive(generation, app)) return;
        bd.source.scaleMode = 'linear';
        this.backdropTexture = bd;
        this.drawBackdrop(); // redraw now that the image is available
      } catch {
        /* no bundled backdrop — the procedural night sky is used */
      }
      if (!this.initActive(generation, app)) return;
      // FUMBBL checker discs (upstream "abstract" icon mode — UI-5): team
      // counters with the player number, normal/large/small variants
      for (const name of ['normalHome', 'normalAway', 'largeHome', 'largeAway', 'smallHome', 'smallAway']) {
        const texture = await Assets.load<Texture>(new URL(`../assets/checkers/${name}.png`, import.meta.url).href);
        if (!this.initActive(generation, app)) return;
        texture.source.scaleMode = 'nearest';
        this.checkerTextures.set(name, texture);
      }
      // stadium pack: seat-stand modules (tile horizontally; stairs read as
      // aisles) + crowd spectators for the sprinkle pass
      for (const name of ['stand_blue', 'stand_red', 'stand_yellow', 'stand_green']) {
        const texture = await Assets.load<Texture>(new URL(`../assets/stadium/${name}.png`, import.meta.url).href);
        if (!this.initActive(generation, app)) return;
        texture.source.scaleMode = 'nearest';
        texture.source.addressMode = 'repeat';
        this.standTextures.set(name, texture);
      }
      // Owner 2026-07-04: a broadcast CAMERA + a stadium LIGHT tower. Owner 09-10: the two cells are now their own
      // files (camera.png 196x197, light_tower.png 153x361) — the full SakPix pack sheets no longer ship.
      try {
        const bc = await Assets.load<Texture>(new URL(`../assets/stadium/camera.png`, import.meta.url).href);
        if (!this.initActive(generation, app)) return;
        bc.source.scaleMode = 'nearest';
        this.cameraTexture = bc;
      } catch { this.cameraTexture = null; }
      if (!this.initActive(generation, app)) return;
      try {
        const lt = await Assets.load<Texture>(new URL(`../assets/stadium/light_tower.png`, import.meta.url).href);
        if (!this.initActive(generation, app)) return;
        lt.source.scaleMode = 'nearest';
        this.lightTexture = lt;
      } catch { this.lightTexture = null; }
      if (!this.initActive(generation, app)) return;
      // fan pool: humans + fantasy creatures (owner 2026-07-02) — all
      // height-normalized at render time so every fan reads the same size.
      // B9-16: fan_zombie is dropped here — its shipped art is a ground-emerging
      // pose that distorts badly when height-normalized among standing fans; a
      // standing "risen corpse" is baked in below instead.
      for (const name of [
        'crowd_1', 'crowd_2', 'crowd_3', 'crowd_4',
        'fan_skeleton', 'fan_lizardman', 'fan_mummy', 'fan_wolfman', 'fan_orc',
      ]) {
        const texture = await Assets.load<Texture>(new URL(`../assets/stadium/${name}.png`, import.meta.url).href);
        if (!this.initActive(generation, app)) return;
        texture.source.scaleMode = 'nearest';
        this.crowdTextures.push(texture);
      }
      // B9-16 (owner): swap the unnatural zombie for a STANDING risen corpse — a
      // sickly-green tint of a standing human crowd sprite, baked to a texture so
      // it height-normalizes like every other fan.
      {
        const tinted = new Sprite(this.crowdTextures[0]!); // crowd_1, a standing human
        tinted.tint = 0x7d9a5c; // sickly zombie green
        const zombieTex = app.renderer.generateTexture(tinted);
        zombieTex.source.scaleMode = 'nearest';
        this.generatedCrowdTexture = zombieTex;
        this.crowdTextures.push(zombieTex);
        tinted.destroy();
      }
      // arena dressing: corner pennants + bunting strips
      for (const name of ['corner_flag_red', 'corner_flag_blue', 'bunting_red', 'bunting_blue']) {
        const texture = await Assets.load<Texture>(new URL(`../assets/stadium/${name}.png`, import.meta.url).href);
        if (!this.initActive(generation, app)) return;
        texture.source.scaleMode = 'nearest';
        this.dressingTextures.set(name, texture);
      }
      // Owner 2026-07-06: sign-holding spectators (extracted from the sprite sheet)
      // — seeded into the front stands, their blank placards get an "I ♥ name"
      // shout-out written on them (crowdSign).
      for (let i = 1; i <= 8; i++) {
        try {
          const t = await Assets.load<Texture>(new URL(`../assets/signfans/signfan_${i}.png`, import.meta.url).href);
          if (!this.initActive(generation, app)) return;
          t.source.scaleMode = 'nearest';
          this.signFanTextures.push(t);
        } catch { /* a missing sign-fan just shrinks the pool */ }
        if (!this.initActive(generation, app)) return;
      }
    } catch (error) {
      console.warn('ffb-pitch: grass textures failed to load, using flat fills', error);
    }

    if (!this.initActive(generation, app)) return;

    this.tokenLayer.sortableChildren = true;
    this.movementReachLayer.eventMode = 'none';
    this.movementPathCostLayer.eventMode = 'none';
    // item1 scope-add: needed for TRAIL_ECHO_Z / TRAIL_NUMBER_Z to order the trail pair. Pixi's sort is
    // stable, and every other effectsLayer node keeps the default zIndex 0, so insertion order is preserved
    // among them — only the (negative) trail marks are re-seated, and only relative to each other.
    this.effectsLayer.sortableChildren = true;
    // owner 2026-07-02 (revised): ground UI (shading, TZ labels, row numbers)
    // stays under the players, but the PATH — lines, step numbers, rush dice,
    // dodge chips — renders with priority over them
    this.world.addChild(
      this.stadiumLayer,
      this.pitchLayer,
      this.sweetSpotLayer, // B7-5: over turf, under players
      this.dressingLayer,
      this.setupZoneLayer, // owner 2026-07-04: setup zone shading, under players
      this.overlayLayer,
      this.marksLayer, // owner 2026-07-04f: persistent square marks (under tokens)
      this.tokenLayer,
      this.pathLayer,
      this.dugoutLayer,
      this.turnTrackLayer, // owner 2026-07-07: SW turn/score/re-roll track
      this.effectsLayer, // F-5 transient effects — never cleared by refresh
    );
    app.stage.addChild(this.backdropLayer); // B2-11: behind everything
    app.stage.addChild(this.world);
    const screenIndicatorLayer = new Container();
    screenIndicatorLayer.eventMode = 'none';
    screenIndicatorLayer.zIndex = Number.MAX_SAFE_INTEGER;
    const ballEdgeMarker = new Container();
    ballEdgeMarker.eventMode = 'none';
    ballEdgeMarker.visible = false;
    const ballEdgeArrow = new Graphics()
      .moveTo(-12, -9).lineTo(13, 0).lineTo(-12, 9).closePath()
      .fill({ color: 0x22a7ff, alpha: 0.98 })
      .stroke({ color: 0x001b35, width: 3, alpha: 1 });
    const ballEdgeLabel = new Text({ text: 'BALL', style: BALL_MARKER_STYLE });
    ballEdgeLabel.anchor.set(0.5, 1);
    ballEdgeLabel.position.set(0, -14);
    ballEdgeMarker.addChild(ballEdgeArrow, ballEdgeLabel);
    const activeEdgeMarker = new Container();
    activeEdgeMarker.eventMode = 'none';
    activeEdgeMarker.visible = false;
    const activeEdgeArrow = new Graphics()
      .moveTo(-12, -9).lineTo(13, 0).lineTo(-12, 9).closePath()
      .fill({ color: 0xf5c542, alpha: 0.98 })
      .stroke({ color: 0x332400, width: 3, alpha: 1 });
    const activeEdgeLabel = new Text({ text: 'ACTIVE', style: ACTIVE_MARKER_STYLE });
    activeEdgeLabel.anchor.set(0.5, 1);
    activeEdgeLabel.position.set(0, -14);
    activeEdgeMarker.addChild(activeEdgeArrow, activeEdgeLabel);
    screenIndicatorLayer.addChild(ballEdgeMarker, activeEdgeMarker);
    app.stage.sortableChildren = true;
    app.stage.addChild(screenIndicatorLayer); // shared screen-space top layer above every pitch/render element
    this.ballEdgeMarker = { node: ballEdgeMarker, arrow: ballEdgeArrow };
    this.activeEdgeMarker = { node: activeEdgeMarker, arrow: activeEdgeArrow };
    this.drawBackdrop();

    this.drawStadium();
    this.drawPitch();
    this.attachCamera(app.canvas);
    this.resetCamera();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    PitchRenderer.instances.delete(this);
    this.blockFaceLoadGeneration++;
    this.blockFaceStaticSprites.clear();
    this.pitchDrawRequestGeneration++;
    this.sweetSpotLogoRequestGeneration++;
    this.absorbQueuedProjectionRefresh();
    this.absorbQueuedOverlayRedraw();
    this.resetAutoDirectorCamera(true);
    this.classicIconLeaseGeneration++;
    this.classicIconAcquireAbort?.abort();
    this.classicIconAcquireAbort = null;
    this.classicIconLease?.release();
    this.classicIconLease = null;
    this.initGeneration++;
    const app = this.app;
    this.clearCanvasInteractionState(app?.canvas ?? null);
    for (const cleanup of this.canvasListenerCleanup.splice(0)) cleanup();
    this.retirePassBallFlight(undefined, false);
    this.cancelAllTimers();
    this.clearEffects();
    if (this.onRendererResize) this.app?.renderer?.off('resize', this.onRendererResize);
    this.onRendererResize = null;
    this.clearHoverSquareMarker();
    this.bncAimFrom = null;
    this.bncAimSquares = [];
    this.bncAimCoords = [];
    this.puntConeCenterWorld = null;
    this.puntReaimHits = [];
    for (const release of this.assetPresentationTokenReleases.values()) release();
    this.assetPresentationTokenReleases.clear();
    this.dugoutTokensById.clear();
    this.dugoutCompartmentById.clear();
    // Break every view/store closure immediately. Async visual completions are cancelled above, so teardown never
    // releases a presentation gate from a renderer that no longer owns a mounted surface; the remount seeds it.
    this.onPlayerClick = null;
    this.onAnimDone = null;
    this.onPortraitVisualRevision = null;
    this.onPushChoice = null;
    this.onBncAim = null;
    this.onPuntReaim = null;
    this.onPlayerPick = null;
    this.onPlayerDoubleClick = null;
    this.onTilePick = null;
    this.onSetupClick = null;
    this.onDugoutSetupDragStart = null;
    this.onSelectionChange = null;
    this.onPathChange = null;
    this.onActionModeChange = null;
    this.onContextMenu = null;
    this.onWaypointPlanCancel = null;
    this.onBlockConfirm = null;
    this.onActionRejected = null;
    this.onCue = null;
    this.onActionHover = null;
    this.onSquareHover = null;
    this.onActionTarget = null;
    this.onActionConfirm = null;
    this.onKickPick = null;
    this.onBombTarget = null;
    if (app) this.destroyApplication(app);
    releaseWalkersOwnedBy(this.walkerOwnerId);
    this.destroyGeneratedCrowdTexture();
    this.app = null;
    this.ballEdgeMarker = null;
    this.activeEdgeMarker = null;
  }

  setGame(game: GameJson | null): void {
    // Authoritative model paint always wins the current turn. Any display-only
    // refresh queued before it is already represented by the synchronous state
    // below and must not rebuild the just-painted token generation afterward.
    this.absorbQueuedProjectionRefresh();
    this.absorbQueuedOverlayRedraw();
    const dialogId = String((game?.dialogParameter as { dialogId?: unknown } | null | undefined)?.dialogId ?? '')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!dialogId.includes('reroll')) this.releaseOpponentRerollDice();
    const nextMovementSignature = movementTokenGenerationSignature(game);
    const reuseMovementTokens = !!this.app && this.confirmedMovementPresentationEnabled
      && nextMovementSignature !== null && nextMovementSignature === this.lastMovementTokenGenerationSignature;
    this.lastMovementTokenGenerationSignature = nextMovementSignature;
    // Owner 2026-07-04: on a GAME CHANGE, flush the transient effect/animation
    // buffer so the previous game's queued echoes / flash rings / on-pitch dice /
    // push markers / kick-in state don't leak onto the new game. (The effectsLayer
    // is intentionally NOT cleared by refresh(), so it must be cleared here.)
    const gid = (game as { gameId?: string | number } | null)?.gameId != null ? String((game as { gameId?: string | number }).gameId) : null;
    let priorClassicLeaseToRelease: ClassicIconLease | null = null;
    if (gid !== this.lastGameId) {
      priorClassicLeaseToRelease = this.classicIconLease;
      this.classicIconLease = null;
      const leaseGeneration = ++this.classicIconLeaseGeneration;
      this.classicIconAcquireAbort?.abort();
      this.classicIconAcquireAbort = null;
      // A freshly-mounted view seeds the already-received kickoff occurrence before its
      // first setGame, so the first paint is marker-only. Preserve that explicit seed
      // through the normal game-change transient reset; everything not re-seeded is
      // still discarded by clearEffects below.
      const seededKickoffScatter = this.pendingServerKickoffScatter;
      const seededKickoffReveal = this.serverKickoffScatterReveal;
      const seededKickoffSeq = this.kickoffScatterSeqSeen;
      this.presentationStep = null;
      this.presentationStepConsumed = null;
      this.movementPresentationCursor = null;
      this.flushMovementOverlay();
      this.clearHoverSquareMarker();
      this.clearEffects();
      if (seededKickoffScatter && seededKickoffReveal) {
        this.pendingServerKickoffScatter = seededKickoffScatter;
        this.serverKickoffScatterReveal = seededKickoffReveal;
        this.kickoffScatterSeqSeen = seededKickoffSeq;
        this.showKickTargetPersistent(seededKickoffReveal, false);
      }
      // Owner 2026-07-06: drop the previous game's icon LOAD-STATE caches so a
      // game→game switch starts fresh — clears any stale in-flight load / failure-
      // backoff from an aborted load (the "assets don't switch quickly game→game"
      // hang). Mounted sheets are lease-owned; released sheets stay in the bounded
      // warm cache so shared iconsets still switch instantly.
      resetIconCaches();
      this.lastGameId = gid;
      if (game && this.spriteSet !== 'checkers') {
        this.game = game; // preload reads the rosters
        this.preloadBundledWalkSheets();
      }
      if (game && this.spriteSet !== 'checkers') {
        const acquireAbort = new AbortController();
        this.classicIconAcquireAbort = acquireAbort;
        void acquireClassicIcons(game, acquireAbort.signal, (team, positionId) => this.modTierIconNeeded(team, positionId)).then((lease) => {
          if (leaseGeneration !== this.classicIconLeaseGeneration || this.spriteSet === 'checkers' || this.destroyed) {
            lease.release();
            return;
          }
          this.classicIconAcquireAbort = null;
          this.classicIconLease = lease;
          this.refresh();
          this.onPortraitVisualRevision?.();
        });
      }
    }
    this.game = game;
    const modelBall = game?.fieldModel.ballCoordinate as [number, number] | null | undefined;
    this.suppressGenericBallInThisRefresh = isServerKickoffScatterTransition(this.pendingServerKickoffScatter, modelBall);
    if (this.suppressGenericBallInThisRefresh) this.pendingServerKickoffScatter = null;
    // Owner 2026-07-12: the kick TRAVEL-ARC trail is a pre-landing flight cue — clear it the instant the
    // kick RESOLVES. Three settle signals (all server-derived): the ball comes INTO PLAY
    // (fieldModel.ballInPlay), goes OUT OF BOUNDS (fieldModel.outOfBounds → crowd throw-in), or is CAUGHT
    // (a carrier now holds it: in play, not moving, a player on the ball square). Cleared on the
    // false→true transition (ballInPlay stays true through the flight's END only, per the kickoff wire —
    // ballMoving during flight, ballInPlay at settle — so this never wipes the trail mid-flight).
    const fm = game?.fieldModel;
    const ballSq = fm?.ballCoordinate;
    const caught = !!fm?.ballInPlay && !fm?.ballMoving && Array.isArray(ballSq)
      && (fm.playerDataArray ?? []).some((d) => d.playerCoordinate?.[0] === ballSq[0] && d.playerCoordinate?.[1] === ballSq[1]);
    const ballResolved = !!fm?.ballInPlay || !!fm?.outOfBounds || caught;
    if (ballResolved && !this.lastBallResolved) this.clearKickTrail();
    this.lastBallResolved = ballResolved;
    // Weather pitch family: swap the pitch photo to the matching local weather
    // variant whenever the authoritative match weather changes.
    if (isWeatherPitchTheme(this.turfTheme) && pitchWeatherKey(game?.fieldModel.weather) !== this.lastPitchWeather) {
      void this.ensureAndDrawPitch();
    }
    setWalkCastWeather(pitchWeatherKey(game?.fieldModel.weather)); // owner 09-06: weather scales the walker casts
    if (reuseMovementTokens) {
      // The authoritative object still replaces this.game before reaching here. Only reach/cost/path surfaces
      // changed, so repaint those against the latest model and leave every token/tween/container untouched.
      this.redrawOverlays();
      this.suppressGenericBallInThisRefresh = false;
      priorClassicLeaseToRelease?.release();
      return;
    }
    this.drawStadium(); // fan attendance (dedicatedFans) shapes the crowd
    try { this.refresh(); }
    finally {
      this.suppressGenericBallInThisRefresh = false;
      // refresh destroyed every prior-game token, so no mounted texture remains.
      priorClassicLeaseToRelease?.release();
    }
  }

  private effectiveCoordinate(data: PlayerDataJson): [number, number] | null {
    if (isOnPitch(data.playerCoordinate)) return data.playerCoordinate!;
    return this.preSetupCoords.get(data.playerId) ?? null;
  }

  /** Owner 2026-07-04: flush ALL transient effect/animation buffers — called on a
   *  game change so nothing from the previous game plays on the new one. */
  private lastGameId: string | null = null;
  /** Owner 2026-07-04: hold the ball KICK-IN animation for `ms` so the kickoff-EVENT
   *  splash plays FIRST (it was occluding the ball flight). Called by the view when a
   *  kickoff-event cinematic starts. */
  private kickInHoldUntil = 0;
  /** #59a (owner D5): wall-clock deadline for the kick-in VISUAL (flight/descent → landing), = when the
   *  flight/descent clear setTimeout (the `clearKickTarget` timers in `animateKickIn`/`animateKickDescent`)
   *  fires. While `now < kickInVisualUntil` a caught kickoff's carrier-clear (the `carrier && this.kickTarget`
   *  guard in the ball block) is SUPPRESSED so the reticle rides the descent to visual-landing, cleared there by
   *  that setTimeout (throttle-resistant). Keyed on WALL-CLOCK, never the model carrier (the 26d84398 hazard). */
  private kickInVisualUntil = 0;
  /** #124 (DD-1 snapshot): a kickoff DESCEND owed to `landing`, armed by the store's presentation-only
   *  `state.kickDescend` via setKickDescend. Drives the fly-in→apex→descend arc from this SNAPSHOT landing,
   *  decoupled from the ball MODEL that immediate-apply may have already raced to CAUGHT (bypassing the
   *  !lastBallOnPitch trigger). ⚖ presentation-only (the model is untouched). Cleared on descend-complete
   *  (onAnimDone('kickDescend')) or — the KD-4 fail-open — when the animateKickDescent setTimeout fires (a
   *  WALL-CLOCK cap, throttle-resistant like #59a/#31 SB-2), so a lost done-signal never hides the ball
   *  forever: the snapshot clears at the cap and the ball reconciles to the model. */
  private kickDescendSnapshot: { origin: [number, number]; landing: [number, number]; seq: number } | null = null;
  private kickDescendSeqSeen = -1;
  /** #185 KA-4 (Meero SR-182): wall-clock stamp of when the current kickoff arc first went in-flight (null = no
   *  arc). Bounds the arc-in-flight freeze via ARC_INFLIGHT_CAP_MS on the refresh path (fail-open). */
  private arcArmedAt: number | null = null;
  /** #185 F-2: a turnEnd-driven setKickDescend(null) arriving mid-arc is DEFERRED (the arc self-clears its own
   *  snapshot on completion); this records that a clear was requested so it isn't silently lost. */
  private pendingKickDescendClear = false;
  /** #131 (owner): dedup key for the kickoff-event VICTIM splash — the store surfaces the report's victim
   *  playerIds (ReportOfficiousRefRoll / ReportKickoffPitchInvasion) as a seq'd, kind-tagged signal. The pops
   *  flow ONE-SHOT through flashRings (self-fade), so no snapshot field is retained — only the last-seen seq
   *  for dedup (Kallus item-193 nit: the former write-only field is dropped). */
  private kickoffVictimSeqSeen = -1;
  /** #141 (owner): dedup key for the ball-DIRECTION arrow (punt/swoop/place-ball/pass-deviate direction roll). */
  private ballDirectionSeqSeen = -1;
  private kickInReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  holdBallKickIn(ms: number): void {
    this.kickInHoldUntil = Math.max(this.kickInHoldUntil, performance.now() + ms);
    // Owner 2026-07-09 (game 1920486 stuck kickoff): the ball hangs at the apex during the hold
    // and only DESCENDS inside refresh(), which is driven by model-sync frames — NOT the ticker.
    // On a Weather Change the follow-on gust/scatter frame lands DURING the hold (consumed by the
    // held branch), then the game pauses for the next turn → no post-hold refresh ever fires and
    // the ball freezes in the air. Guarantee a refresh just past the hold so the descent runs.
    this.cancelTimer(this.kickInReleaseTimer);
    this.kickInReleaseTimer = this.scheduleTimer(
      () => { this.kickInReleaseTimer = null; this.refresh(); },
      ms + presentationMs(KICK_RELEASE_REFRESH_MS),
    );
  }

  clearEffects(): void {
    this.resetAutoDirectorCamera(true);
    this.cancelTimer(this.movementIntentTimer);
    this.cancelTimer(this.movementIntentRollbackTimer);
    this.movementIntentTimer = null;
    this.movementIntentRollbackTimer = null;
    this.movementIntent = null;
    this.movementIntentStartedSeq = -1;
    for (const pending of this.reconciliationTimers.values()) this.cancelTimer(pending.timer);
    this.reconciliationTimers.clear();
    this.cancelAllPostStepConvergence();
    this.movementReconcileFence = null;
    this.cancelTimer(this.boardReconciliationTimer);
    this.boardReconciliationTimer = null;
    this.cancelAllBoardProtectedRechecks();
    this.boardReconcileSeqSeen = -1;
    this.cancelEffectTickers();
    this.movementPresentationCursor = null;
    this.flushMovementOverlay();
    this.retirePassBallFlight(undefined, false);
    for (const f of this.flashRings) { f.g.parent?.removeChild(f.g); f.g.destroy(); }
    this.flashRings = [];
    for (const m of this.rollModals) { m.node.parent?.removeChild(m.node); m.node.destroy({ children: true }); }
    this.rollModals = [];
    for (const d of this.actionDice) { d.node.parent?.removeChild(d.node); d.node.destroy({ children: true }); }
    this.actionDice = [];
    this.liveSkillAssets.clear();
    for (const c of this.effectsLayer.removeChildren()) c.destroy({ children: true });
    this.signTextNodes = []; // the persistent pre-game sign texts live in effectsLayer
    this.trailNumberNodes = []; // persistent trail numbers live in effectsLayer too
    this.moveTweens.clear();
    this.activationFades.clear(); this.activationFadePaint.clear(); // item3
    this.pushOptionPulse = []; this.pushCrosshairs = []; this.pushOptionCoords = []; this.pickCrosshairs = []; this.pickArrows = [];
    this.persistentPlayerArrowIds.clear(); this.persistentPlayerArrows = [];
    this.marks.clear(); for (const c of this.marksLayer.removeChildren()) c.destroy({ children: true });
    // reset movement/ball baselines so the new game doesn't tween from stale squares
    this.lastSquares.clear();
    this.lastBallSquare = null; this.lastBallOnPitch = false; this.ballEverRendered = false;
    this.lastBallResolved = false; // owner 2026-07-12: fresh game re-arms the kick-trail settle detector
    this.kickApexAim = null; this.pendingKickAim = null; this.kickInHoldUntil = 0; this.kickInVisualUntil = 0; this.kickInFlyStart = null;
    this.kickDescendSnapshot = null; this.kickDescendSeqSeen = -1; // #124: a stale kickoff-descend snapshot must not leak games
    this.arcArmedAt = null; this.pendingKickDescendClear = false; // #185: a fresh game re-arms the arc-in-flight cap clock / clears any deferred snapshot-clear
    this.kickoffVictimSeqSeen = -1; // #131: a stale victim-splash dedup-seq must not leak games
    this.kegThrowerSquare = null; this.kegTargetSet = null; this.jumpCrosshairSquares = []; // #181/KG-6: a stale keg range/target set must not leak games
    this.ballDirectionSeqSeen = -1; // #141: a stale ball-direction dedup-seq must not leak games
    if (this.kickInReleaseTimer != null) { this.cancelTimer(this.kickInReleaseTimer); this.kickInReleaseTimer = null; }
    this.clearKickTarget(); // B0: drop the persistent target crosshair on a game change
    this.clearBlockTargetCue(); // drop a pending block-target crosshair on a game change
    this.clearFoulTargetCue(); // drop a pending foul-target boot on a game change
    this.clearRosterAttentionCue(); // drop a pending roster-panel attention arrow on a game change
    this.clearUnactivatedCues(); // owner 09-08: End-Turn idle-player cues never survive a game change
    this.deferredMoves.clear(); // queue #1: a stale follow/stay defer must not leak games
    this.pendingScatter.clear(); // TTM: a stale scatter cue must not leak games
    this.pendingServerKickoffScatter = null;
    this.serverKickoffScatterReveal = null;
    this.suppressGenericBallInThisRefresh = false;
    this.kickoffScatterSeqSeen = -1;
    this.pendingTtmThrow.clear(); // LIVE TTM: a stale throw-flight cue must not leak games
    this.retirePassBallFlight(undefined, false);
    this.pendingBallThrow = null; // pass/punt: a stale ball throw-arc must not leak games
    this.passBallHold = null;
    this.presentationStep = null; this.presentationTileStart = 0; this.presentationTileStartPending = false; this.presentationStepConsumed = null; // #67: no stale step/clock across games
    this.holdBallDuringInjury = false; // a stale ball-bounce freeze must not leak games
    this.pendingTrickster.clear(); // case 419: a stale trickster slide must not leak games
    this.ttmHeld = null; // TTM: a stale held-mate cue must not leak games
    this.declaredActionCache = null;
    this.activePlayerId = null;
    if (this.ballEdgeMarker) this.ballEdgeMarker.node.visible = false;
    if (this.activeEdgeMarker) this.activeEdgeMarker.node.visible = false;
  }

  /** Snap one non-presented replay render without erasing persistent same-game projections. */
  snapReplayFrame(): void {
    this.resetAutoDirectorCamera(true);
    this.cancelTimer(this.movementIntentTimer);
    this.cancelTimer(this.movementIntentRollbackTimer);
    this.movementIntentTimer = null;
    this.movementIntentRollbackTimer = null;
    this.movementIntent = null;
    this.movementIntentStartedSeq = -1;
    for (const pending of this.reconciliationTimers.values()) this.cancelTimer(pending.timer);
    this.reconciliationTimers.clear();
    this.cancelAllPostStepConvergence();
    this.movementReconcileFence = null;
    this.cancelTimer(this.boardReconciliationTimer);
    this.boardReconciliationTimer = null;
    this.cancelAllBoardProtectedRechecks();
    this.moveTweens.clear();
    this.movementPresentationCursor = null;
    this.flushMovementOverlay();
    this.activationFades.clear(); this.activationFadePaint.clear(); // item3: a replay snap lands instantly, no fade carry
    this.lastSquares.clear();
    this.lastBallSquare = null;
    this.lastBallOnPitch = false;
    this.ballEverRendered = false;
    this.o66MovePath.clear();
    this.pendingLeaps.clear();
    this.pendingLeapInPlace.clear();
    this.pendingScatter.clear();
    this.pendingServerKickoffScatter = null;
    this.serverKickoffScatterReveal = null;
    this.suppressGenericBallInThisRefresh = false;
    this.kickoffScatterSeqSeen = -1;
    this.pendingTtmThrow.clear();
    this.pendingTrickster.clear();
    this.retirePassBallFlight(undefined, false);
    this.pendingBallThrow = null;
    this.passBallHold = null;
    this.deferredMoves.clear();
    this.clearMoveTrail();
    this.presentationStep = null;
    this.presentationTileStart = 0;
    this.presentationTileStartPending = false;
    this.presentationStepConsumed = null;
    this.kickApexAim = null;
    this.pendingKickAim = null;
    this.kickInHoldUntil = 0;
    this.kickInVisualUntil = 0;
    this.kickInFlyStart = null;
    this.kickDescendSnapshot = null;
    this.kickDescendSeqSeen = -1;
    this.arcArmedAt = null;
    this.pendingKickDescendClear = false;
    if (this.kickInReleaseTimer != null) {
      this.cancelTimer(this.kickInReleaseTimer);
      this.kickInReleaseTimer = null;
    }
    this.clearKickTarget();
  }

  /** Detach every reference read by the persistent Pixi tickers before their
   * token-layer nodes are destroyed. A builder exception must never leave a
   * ticker pointing at a destroyed Graphics/Text transform. */
  private clearTokenTickerPointers(): void {
    this.ballMarker = null;
    this.ballGlow = null;
    this.ballHalo = null;
    this.renderedBall = null;
    this.carrierFollow = null;
    if (this.activeMarker && !this.activeMarker.node.destroyed) this.activeMarker.node.destroy({ children: true }); // 09-06: effects-layer node
    this.activeMarker = null;
    this.activeHalo = null;
    this.activeFollow = null;
    this.pushOptionPulse = [];
    this.pushCrosshairs = [];
    this.pushOptionCoords = [];
    this.pickCrosshairs = [];
    this.pickArrows = [];
    this.blockDiceSprites = [];
    this.blockPreviewSquares = [];
    this.blockPreviewDecorKey = null;
  }

  private purgeFailedRefresh(error: unknown): void {
    this.clearTokenTickerPointers();
    for (const child of this.tokenLayer.removeChildren()) {
      if (!child.destroyed) child.destroy({ children: true });
    }
    for (const child of this.dugoutLayer.removeChildren()) {
      if (!child.destroyed) child.destroy({ children: true });
    }
    this.playersBySquare.clear();
    this.tokensById.clear();
    this.dugoutTokensById.clear();
    this.dugoutCompartmentById.clear();
    this.dugoutHits = [];
    this.lastSquares.clear();
    for (const [id, tween] of [...this.moveTweens]) {
      if (tween.token.destroyed || tween.token.parent == null) this.moveTweens.delete(id);
    }
    this.activationFades.clear();
    this.activationFadePaint.clear();
    this.overlayScaleGroups = this.overlayScaleGroups.filter((group) => !group.destroyed && group.parent != null);
    this.cancelAllPostStepConvergence();
    if (!this.refreshFailureLogged) {
      this.refreshFailureLogged = true;
      console.error('ffb-pitch: renderer refresh failed; cleared partial token generation', error);
    }
  }

  /** Re-renders tokens from the current game state (call after model sync). */
  refresh(): void {
    if (!this.app || this.destroyed) return;
    this.absorbQueuedOverlayRedraw();
    const suspendedPostStep = this.suspendPostStepConvergenceForRefresh();
    let refreshCompleted = false;
    let preservedPresentationToken: Container | undefined;
    try {
    this.pruneLiveSkillAssets();
    // Preserve the actively-presented actor itself (and its live tween) across same-game model refreshes. The
    // authoritative model may already be several squares ahead; rebuilding this container would visibly restamp
    // the frozen step at `from` until the next ticker pass.
    const refreshStep = this.presentationStep;
    const refreshToken = refreshStep ? this.tokensById.get(refreshStep.playerId) : undefined;
    const refreshTween = refreshStep ? this.moveTweens.get(refreshStep.playerId) : undefined;
    const preservedPresentationTween = refreshTween?.psStep === refreshStep ? refreshTween : undefined;
    preservedPresentationToken = preservedPresentationTween && refreshToken && !refreshToken.destroyed
      ? refreshToken
      : undefined;
    const preservedPresentationScaleGroups = preservedPresentationToken
      ? this.overlayScaleGroups.filter((group) => group.parent === preservedPresentationToken && !group.destroyed)
      : [];
    // Pickup/GFI roll tags live below effectsLayer rather than below a token. They can still be on screen
    // when the next authoritative model refresh arrives, so retain those live transient groups too. Without
    // this, refresh() silently dropped their zoom registration halfway through the action-die hold.
    const preservedEffectScaleGroups = this.overlayScaleGroups.filter((group) => {
      if (group.destroyed) return false;
      let parent = group.parent;
      while (parent) {
        if (parent === this.effectsLayer) return true;
        parent = parent.parent;
      }
      return false;
    });
    const preservedActivationFadePaint = refreshStep && preservedPresentationToken
      ? this.activationFadePaint.get(refreshStep.playerId)
      : undefined;
    this.clearTokenTickerPointers();
    // Owner 2026-07-13 (interpolation preservation): refresh() destroys every token + clears moveTweens on
    // EVERY model sync. In play, syncs land frequently (next move-square array, acting player, tackle zones…),
    // so a walk tween was wiped a frame after it started → the token snapped to its destination ("super quick"
    // walk). CAPTURE each live PLAIN-walk tween's current interpolated pixel position (read BEFORE the tokens
    // are destroyed) so the rebuilt token can EASE from there to the latest model square instead of snapping.
    // Skip the ball + any special animation (arc'd leaps/throws, hop scatters) — those re-arm from their own
    // pending* maps and must not be flattened into a plain ease.
    const carriedTweenPos = new Map<string, { x: number; y: number }>();
    const carryNow = performance.now();
    for (const [id, tw] of this.moveTweens) {
      if (tw === preservedPresentationTween) continue;
      if (id === '__ball__' || tw.token.destroyed || tw.arc) continue;
      if (tw.style !== 'walk' && tw.style !== 'slide') continue;
      const total = Math.max(1, (tw.waypoints.length - 1) * tw.segmentMs);
      if (carryNow - tw.start < total) carriedTweenPos.set(id, { x: tw.token.position.x, y: tw.token.position.y });
    }
    // destroy (not just detach) the old generation — Text canvases and
    // Graphics buffers otherwise accumulate ~MBs per live model sync
    // (838MB heap after ~20min of live spectating; W-3 checkpoint 4).
    // Shared textures (iconsets, skill icons, checkers) are NOT destroyed —
    // texture destruction stays opt-in in Pixi's destroy().
    for (const child of this.tokenLayer.removeChildren()) {
      if (child !== preservedPresentationToken) child.destroy({ children: true });
    }
    this.playersBySquare.clear();
    this.tokensById.clear();
    // The presented token survives this refresh, so its direct zoom-counter-scaled badge/check groups survive
    // too and must remain registered. Every rebuilt token re-registers its own groups below.
    this.overlayScaleGroups = [...new Set([...preservedPresentationScaleGroups, ...preservedEffectScaleGroups])];
    for (const [id, tween] of [...this.moveTweens]) {
      if (tween !== preservedPresentationTween) this.moveTweens.delete(id);
    }
    this.activationFadePaint.clear(); // item3: closures hold destroyed tokens; rebuilt tokens re-arm below
    if (refreshStep && preservedActivationFadePaint && this.activationFades.has(refreshStep.playerId)) {
      this.activationFadePaint.set(refreshStep.playerId, preservedActivationFadePaint);
    }
    this.preSetupCoords = this.game ? preSetupPlacements(this.game) : new Map();
    if (!this.game) { refreshCompleted = true; return; }
    // Owner 2026-07-08: expire a ball throw arc unconditionally after its flight — the per-frame
    // clear lives inside the on-pitch ball branch, so a throw that ends OFF-pitch (incomplete /
    // out of bounds) would otherwise leave `pendingBallThrow` armed and fire a stale arc later.
    if (this.pendingBallThrow && performance.now() - this.pendingBallThrow.start >= this.pendingBallThrow.durationMs) {
      if (this.passBallFlight?.throwState === this.pendingBallThrow) this.retirePassBallFlight(this.pendingBallThrow);
      else this.pendingBallThrow = null;
    }

    const playersById = new Map<string, PlayerJson>();
    for (const p of this.game.teamHome.playerArray) playersById.set(p.playerId, p);
    for (const p of this.game.teamAway.playerArray) playersById.set(p.playerId, p);
    const homeIds = new Set(this.game.teamHome.playerArray.map((p) => p.playerId));

    // Positional baseline skills from the roster — hidden on badges by
    // default so only advancements show (Match6/Match7).
    const baselines = new Map<string, Set<string>>();
    for (const team of [this.game.teamHome, this.game.teamAway]) {
      const positions = (team.roster as { positionArray?: { positionId: string; skillArray?: string[] }[] })
        .positionArray ?? [];
      for (const position of positions) {
        baselines.set(position.positionId, new Set(position.skillArray ?? []));
      }
    }

    const seenOnPitch = new Set<string>();
    // Owner 2026-07-15: END OF GAME clears the board — skip the on-pitch player tokens (the ball + dugouts are
    // skipped below) so the permanent end-game modal sits over an empty pitch.
    if (!this.boardCleared) for (const data of this.game.fieldModel.playerDataArray) {
      const coordinate = this.effectiveCoordinate(data);
      if (!coordinate) continue;
      const synthetic = !isOnPitch(data.playerCoordinate);
      // The real-coordinate path keeps the original RESERVE/on-pitch guard unchanged.
      if (!synthetic && (baseState(data.playerState) === PlayerStateBase.RESERVE || !isOnPitch(data.playerCoordinate))) continue;
      const player = playersById.get(data.playerId);
      if (!player) continue;
      const isHome = homeIds.has(data.playerId);
      const team = isHome ? this.game.teamHome : this.game.teamAway;
      const renderData = synthetic ? { ...data, playerCoordinate: coordinate } : data;
      const tokenWasPreserved = data.playerId === refreshStep?.playerId && preservedPresentationToken !== undefined;
      let token: Container;
      try {
      token = tokenWasPreserved
        ? preservedPresentationToken!
        : this.buildPlayerToken(player, renderData, isHome, team, baselines.get(player.positionId));
      // #229 (owner): while the keg is armed, mute non-targets but keep the thrower at full opacity.
      const kegThrower = this.kegThrowerSquare;
      if (this.kegTargetSet && !this.kegTargetSet.has(data.playerId)
        && !(kegThrower && coordinate[0] === kegThrower[0] && coordinate[1] === kegThrower[1])) {
        token.alpha = 0.35;
      }
      // Owner 2026-07-06: unified over-token STATE markers (CONFUSED "?", CHOMPED
      // 🦷, bloodlust 🩸). Bloodlust is an ACTING-player property, not a state flag,
      // so it's passed in for the acting vampire; the flag-based states read off
      // data.playerState like CONFUSED always did.
      const acting = this.game.actingPlayer as { playerId?: string | null; sufferingBloodlust?: boolean } | undefined;
      const bloodlust = !!acting?.sufferingBloodlust && acting.playerId === data.playerId;
      if (!tokenWasPreserved) this.addStateMarkers(token, data.playerState, bloodlust, data.playerId, coordinate);
      // Owner 08-18 (bullseye unify): the blitz target's ONLY mark is SpectateView's persistent
      // #94 DOM 🎯 badge (token-centred via tokenBodyCenterToCanvas). The renderer's transient
      // SELECTED_BLITZ_TARGET 🎯 (addBlitzTargetCrosshair) doubled it and is retired; the flag
      // still suppresses the block-target cue (showBlockTargetCrosshair).
      this.tokenLayer.addChild(token);
      registerLiveWalker(token);
      } catch (error) {
        if (!tokenWasPreserved && token! && !token.destroyed) token.destroy({ children: true });
        throw error;
      }
      this.tokensById.set(data.playerId, token);
      // UAT-2026-08-04 F: the setup picker is view-local, so crown its selected ON-PITCH
      // token with the existing player-pick arrow. Reserves remain DOM/dugout-only and
      // intentionally receive no marker here.
      if (this.setupActive && data.playerId === this.setupSelectedPlayerId) {
        const arrow = this.buildPickArrow(coordinate);
        // UAT-08-04 F owner eyeball: the crown floated ~a tile high + read small. Sit it TIGHTER to the
        // token head + slightly LARGER. Applied at the CALL SITE (not inside buildPickArrow) so the
        // server-pick arrow callers (:5666/:5783) stay byte-identical. arrow.scale === the square depth.
        arrow.node.scale.set(1.25); // ~25% larger than the depth baseline
        arrow.node.y += TILE_H * arrow.scale * 0.35; // 1.15 → ~0.80 tile offset — nearer the head
        this.tokenLayer.addChild(arrow.node);
      }
      this.playersBySquare.set(coordinate.join(','), data.playerId);
      // Synthetic squares exist solely for pre-setup drawing/playerChoice hit-testing; no movement code sees them.
      if (synthetic) continue;
      // Playback interpolation (queue item 12): a player whose square changed
      // since the previous render eases from the old anchor to the new one.
      // First render and dugout entries/exits don't tween.
      seenOnPitch.add(data.playerId);
      // TTM increment 1 (owner 2026-07-07): the thrown mate RUNS UP to the thrower and JOINS
      // it IN its square — the two share the one square at GROUND level (NOT hopped onto the
      // thrower's shoulders; owner correction 2026-07-07). Mirrors FFB updateThrownPlayer,
      // which draws game.defender AT the thrower's coordinate. The THROWER stays put; the MATE
      // is the mover — it walks from its own square into the thrower's square, then stands there
      // shrunk (carried) + drawn in front, offset slightly forward so both read as two players
      // sharing the square. The run glide is re-armed each refresh with ONE clock
      // (scatter/kick-in pattern) so it survives token rebuilds; after the pickup lands it pins
      // joined. lastSquares pinned at the thrower square so no stray straight-tween fires. The
      // mate's real coordinate is unchanged.
      if (this.ttmHeld && this.ttmHeld.thrownId === data.playerId) {
        const carrier = this.game.fieldModel.playerDataArray.find(
          (d) => d.playerId === this.ttmHeld!.throwerId,
        );
        const tc = carrier?.playerCoordinate;
        if (isOnPitch(tc ?? null)) {
          const [tx, ty] = tc!;
          const dest = this.tokenPos(tx, ty);
          const joinX = dest.x;
          const joinY = dest.y + TILE_H * 0.16; // stand IN the square, in FRONT of the thrower (no lift)
          if (!isWalkerToken(token)) token.scale.set(token.scale.x * 0.8); // carried: a touch smaller (classic icons only)
          token.zIndex = this.depthZ(tx, ty) + 1; // draw in front of the thrower
          const PICKUP_MS = presentationMs(300);
          const from = this.ttmHeld.fromSquare;
          const el = performance.now() - this.ttmHeld.start;
          if (from && el < PICKUP_MS && (from[0] !== tx || from[1] !== ty)) {
            // RUN up: the mate walks from its own square into the thrower's square (ground-level
            // step-bob, no hop-onto).
            const p0 = this.tokenPos(from[0], from[1]);
            this.moveTweens.set(data.playerId, {
              token, waypoints: [{ x: p0.x, y: p0.y }, { x: joinX, y: joinY }],
              style: 'walk', start: this.ttmHeld.start, segmentMs: PICKUP_MS,
            });
          } else {
            token.position.set(joinX, joinY); // pinned: joined in the thrower's square
          }
          this.lastSquares.set(data.playerId, [tx, ty]);
          continue; // held: no straight tween, no scatter this frame
        }
      }
      const [nx, ny] = data.playerCoordinate!;
      const previous = this.lastSquares.get(data.playerId);
      const deferred = this.deferredMoves.has(data.playerId);
      const carried = carriedTweenPos.get(data.playerId);
      // Owner 2026-07-07 (queue #1): a DEFERRED player's move is withheld until the follow/stay indicator
      // reads — pin the (freshly rebuilt) token at its previous square and do NOT advance lastSquares, so
      // releaseMove()'s redraw still sees the previous→new delta and tweens then.
      if (previous && (previous[0] !== nx || previous[1] !== ny) && deferred) {
        const p = this.tokenPos(previous[0], previous[1]);
        token.position.set(p.x, p.y);
        continue; // leave lastSquares at `previous`
      }
      // #67 phase-1 (Tarkin store-paced presentation-drain): if the store is presenting a movement step for
      // THIS player, draw it from the store's FROZEN snapshot {from,to} one paced tile at a time — NOT the
      // live playerCoordinate (immediate-apply already advanced it to the FINAL square = the burst root, DD-1).
      // The ticker fires seq-correlated onAnimDone('walk', id, seq) at the tile's VISUAL end → the store advances
      // to the next tile
      // (gapless, Tarkin's invariant). Priority over the o66MovePath / live-coord paths below FOR the acting
      // player while a step presents; those still own the coalesced-jump + passive-client cases (no step).
      // Motion only in phase-1; trail number/echo overlays are emitted from each confirmed step below. Re-armed each rebuild on ONE
      // per-seq clock so it survives the per-frame token destroy/rebuild (like o66MovePath); a fresh seq starts a
      // fresh tile clock.
      // row-teleport (owner 08-18 P1): gated on the SNAPSHOT's presence, NOT on `this.order66`. The store's drain
      // is settings.order66-scoped (enqueueMoveStep), so a non-null presentationStep already means the per-tile
      // drain owns this mover — in SPECTATE too, where `this.order66` is false (it tracks
      // `settings.order66 && isPlaying`). With the flag in the gate, a spectate refresh mid-tile fell through to
      // the live-coordinate paths below and tweened the token toward the MODEL square (immediate-apply already put
      // it at the run's FINAL square) = a forward race, which the next step's armPresentationStepTween then
      // snapped back from (`token.position.set(from)`) = the owner's backward-teleport-mid-walk. Classic/non-o66
      // stays byte-unaffected: with the drain off, `ps` is always null there and the branch is unreachable.
      const ps = this.presentationStep;
      if (!deferred && ps && ps.playerId === data.playerId) {
        // Object identity selects the tile, but the first ticker pass anchors its clock — never this rebuild path.
        // The first ticker pass owns the clock stamp; a rebuild must never restart it mid-tile.
        // Owner 08-12 (drain ease-in, co-land w/ Tarkin's 50% store gate): step 2 (stepIndex 1) tweens over HALF
        // moveStepMs so the token LANDS exactly when the gate releases early — else it would jump at the release.
        // Steps 0 and >=2 unchanged. Same moveStepMs constant (from moveSpeedMs) — no second knob.
        // step-stutter (owner 08-18): ONLY while the tile is still in flight. A COMPLETED step is held at its
        // presented square instead — see redrawPresentationStep.
        if (preservedPresentationTween?.psStep !== ps || preservedPresentationTween.token !== token) {
          this.redrawPresentationStep(ps, token);
        } else {
          this.lastSquares.set(ps.playerId, [ps.to[0], ps.to[1]]);
        }
        continue;
      }
      // Owner 2026-07-14 (#5/#15 fix (a), Yularen-ruled): a FULL-PATH walk drives ONE tween through every square
      // at STEP_BEAT, re-applied each rebuild with the ORIGINAL start so the o66 immediate-apply sync-collapse
      // (all squares land in one frame) can't truncate it into a snap. Waypoints run from the path start up to
      // the CURRENT model square, so a server abort/divergence lands the token on the real position (fail-safe).
      // Cleared after the full path duration (bounded); a new move overwrites it.
      const anim = this.o66MovePath.get(data.playerId);
      if (anim && !deferred) {
        let cut = anim.squares.findIndex(([x, y]) => x === nx && y === ny);
        if (cut < 0) cut = anim.squares.length - 1; // model diverged from the plan — step to the plan end
        const pts = anim.squares.slice(0, cut + 1).map(([x, y]) => this.tokenPos(x, y));
        if (pts.length >= 2) {
          // owner 2026-07-15: honour the user's movement style (was hardcoded 'walk', so slide/hop/trail/hoptrail
          // never applied in o66 play). this.moveStyle is set from settings.moveStyle (SpectateView).
          const leap = this.consumePendingLeap(data.playerId); // owner 09-09: a confirmed jump arcs the whole route
          this.moveTweens.set(data.playerId, {
            token, waypoints: pts, style: this.moveStyle, start: anim.start,
            segmentMs: leap ? leap.segmentMs : this.moveStepMs, ...(leap ? { arc: leap.arc } : {}),
          });
          token.position.set(pts[0]!.x, pts[0]!.y);
        } else {
          const p = this.tokenPos(nx, ny); token.position.set(p.x, p.y);
        }
        if (performance.now() - anim.start >= Math.max(1, anim.squares.length - 1) * this.moveStepMs) this.o66MovePath.delete(data.playerId);
        this.lastSquares.set(data.playerId, [nx, ny]);
        continue;
      }
      // row29-ttm-anim (owner sighting g866 2026-08-17): a thrown player's landing can trail the
      // flight/scatter cues by a bare coordinate-only sync a few ms later — no report, no
      // animation (e.g. g866 cmd2184: fieldModelSetPlayerCoordinate only, one square from the
      // arc's last stop). Left alone, THAT reads as an ordinary opponent one-square step below
      // and hijacks the token with a plain walk tween before the TTM arc/scatter blocks further
      // down ever run for this frame. Defer to an in-flight TTM cue for this exact player instead.
      const ttmFlightActive = this.pendingTtmThrow.has(data.playerId) || this.pendingScatter.has(data.playerId);
      // A concrete presentationStep above owns a confirmed edge. Do not pin merely because the confirmed drain
      // capability is enabled: if Vue delivery is delayed/missed, that broad hold has no occurrence identity or
      // recovery clock and can freeze the actor indefinitely. The generic authoritative interpolation below is
      // the fail-open path until an exact step snapshot arrives.
      if (carried && !deferred) {
        // Owner 2026-07-13: CONTINUE an in-flight walk across the token rebuild — ease from the token's
        // current visual position to the CURRENT model square (a follow-up sync with the same coord, OR a
        // coord that advanced this sync). This is what lets the walk actually animate under frequent syncs.
        this.continueMoveTween(data.playerId, token, carried, [nx, ny]);
      } else if (!ttmFlightActive && previous && (previous[0] !== nx || previous[1] !== ny)) {
        this.startMoveTween(data.playerId, token, previous, [nx, ny]);
      }
      this.lastSquares.set(data.playerId, [nx, ny]);
      // Owner 2026-07-07: a FAILED leap (destination == origin, no coordinate change) —
      // hop the sprite STRAIGHT UP and back down in the SAME square. A same-point tween
      // with the leap arc: no horizontal travel, sin-lift up at mid, back at the end.
      if (this.pendingLeapInPlace.delete(data.playerId)) {
        const p = this.tokenPos(nx, ny);
        this.moveTweens.set(data.playerId, {
          token, waypoints: [{ x: p.x, y: p.y }, { x: p.x, y: p.y }],
          style: 'slide', start: performance.now(), segmentMs: presentationMs(260), arc: 30,
        });
      }
      // Owner 2026-07-07 (TTM): a SCATTERED thrown player hops along its explicit path
      // (random directions). RE-ARMED on the live token each setGame with the SAME start
      // clock (like the kick fly-in), so the hop progresses smoothly across the per-frame
      // token rebuilds instead of orphaning; cleared when the hop duration elapses.
      const sc = this.pendingScatter.get(data.playerId);
      // Owner 2026-07-07 (LIVE TTM), reordered 2026-08-17 (row29-ttm-anim, owner sighting g866
      // "thrown player teleports"): the ARC now runs FIRST and wins over a same-frame scatter for
      // the SAME player, not the other way round. playThrow's arm-time merge (above) extends an
      // in-flight arc's `to` when a second throwTeamMate event lands for the same thrownId, so by
      // the time a landing-settle scatterPlayer report arrives a few ms later, the arc's own
      // destination already covers it — consuming (deleting) that now-redundant scatter cue here
      // so it can't steal a later frame once the arc itself retires. A genuine non-TTM scatter
      // (B&C throw-in, weather gust) never has a `tt` entry, so it is unaffected.
      const tt = this.pendingTtmThrow.get(data.playerId);
      let ttConsumedScatter = false;
      if (tt) {
        const THROW_MS = presentationMs(TTM_THROW_MS);
        if (performance.now() - tt.start >= THROW_MS) {
          this.pendingTtmThrow.delete(data.playerId);
        } else {
          const p0 = this.tokenPos(tt.from[0], tt.from[1]);
          const p1 = this.tokenPos(tt.to[0], tt.to[1]);
          this.moveTweens.set(data.playerId, { token, waypoints: [p0, p1], style: 'slide', start: tt.start, segmentMs: THROW_MS, arc: KICK_ARC_PX });
          if (sc) { this.pendingScatter.delete(data.playerId); ttConsumedScatter = true; }
        }
        this.lastSquares.set(data.playerId, [tt.to[0], tt.to[1]]);
      }
      if (sc && sc.path.length > 1 && !ttConsumedScatter) {
        const SCATTER_SEG = presentationMs(150);
        const total = (sc.path.length - 1) * SCATTER_SEG;
        if (performance.now() - sc.start >= total) {
          this.pendingScatter.delete(data.playerId);
        } else {
          const pts = sc.path.map(([sx, sy]) => this.tokenPos(sx, sy));
          this.moveTweens.set(data.playerId, { token, waypoints: pts, style: 'hop', start: sc.start, segmentMs: SCATTER_SEG });
        }
        this.lastSquares.set(data.playerId, sc.path[sc.path.length - 1]!);
      }
      // Owner 2026-07-08 (case 419): TRICKSTER — a LOW step-slide from→to (no arc), quicker than a
      // throw. Same one-clock/moveTweens mechanism as the TTM flight above, arc:0.
      const tk = this.pendingTrickster.get(data.playerId);
      if (tk && !sc) {
        const TRICKSTER_MS = presentationMs(320);
        if (performance.now() - tk.start >= TRICKSTER_MS) {
          this.pendingTrickster.delete(data.playerId);
        } else {
          const p0 = this.tokenPos(tk.from[0], tk.from[1]);
          const p1 = this.tokenPos(tk.to[0], tk.to[1]);
          this.moveTweens.set(data.playerId, { token, waypoints: [p0, p1], style: 'slide', start: tk.start, segmentMs: TRICKSTER_MS, arc: 0 });
        }
        this.lastSquares.set(data.playerId, [tk.to[0], tk.to[1]]);
      }
    }
    if (preservedPresentationToken && refreshStep && !seenOnPitch.has(refreshStep.playerId)) {
      this.moveTweens.delete(refreshStep.playerId);
      preservedPresentationToken.destroy({ children: true });
    }
    for (const id of [...this.lastSquares.keys()]) {
      if (!seenOnPitch.has(id)) {
        this.lastSquares.delete(id);
        this.moveTweens.delete(id);
      }
    }
    // Owner 2026-07-06: markLeap runs immediately before this setGame (same tick),
    // so a real leap move is consumed by the tween loop above. Drop any leftover
    // flag — the report arrived without the coordinate move this frame — so it can
    // never arc an unrelated later move.
    // Owner 09-09: EXCEPT the acting player's own drained walk — the confirmed-movement drain builds that tween
    // later (armPresentationStepTween), so the flag must survive this setGame; consumePendingLeap expires it.
    for (const id of [...this.pendingLeaps.keys()]) {
      if (!(this.confirmedMovementPresentationEnabled && id === this.activePlayerId)) this.pendingLeaps.delete(id);
    }
    this.pendingLeapInPlace.clear(); // consumed above (or dropped if the token wasn't rebuilt)

    // App19: Classic/default keeps the upstream blood decals. Modern deliberately suppresses
    // only their presentation; the protocol/model bloodspotArray remains untouched.
    if (!this.modernPitchPresentation) {
      for (const spot of this.game.fieldModel.bloodspotArray as { coordinate?: [number, number] }[]) {
        if (!isOnPitch(spot?.coordinate ?? null)) continue;
        const [bx, by] = spot.coordinate!;
        const anchor = squareAnchor(bx, by);
        const seed = turfNoise(bx * 13 + 5, by * 17 + 3);
        const decal = new Graphics();
        for (let i = 0; i < 4; i++) {
          const angle = seed * 6.28 + i * 1.7;
          decal
            .ellipse(Math.cos(angle) * 8 * seed + (i - 1.5) * 3, Math.sin(angle) * 5, 5 - i, 3.5 - i * 0.5)
            .fill({ color: 0x7a1414, alpha: 0.55 });
        }
        decal.position.set(anchor.x, anchor.y); // anchor is the square center
        decal.zIndex = 0; // under all tokens
        this.tokenLayer.addChild(decal);
      }
    }

    // B7-6: treacherous-trapdoor field icons. Rendered ONLY from the server's
    // fieldModel.trapDoors — a trapdoor exists only once Treacherous Trapdoor has been
    // rolled (Moles Under the Pitch places NONE: it is a prayerState rush penalty), so an
    // ordinary pitch shows none (owner: no fixed stadium trapdoors).
    const trapTexture = this.downDecorations.get('trapdoor');
    if (trapTexture) {
      const trapSquares = new Map<string, [number, number]>();
      for (const trap of this.game.fieldModel.trapDoors as { coordinate?: [number, number] }[]) {
        if (!isOnPitch(trap?.coordinate ?? null)) continue;
        const [tx, ty] = trap.coordinate!;
        trapSquares.set(`${tx},${ty}`, [tx, ty]);
      }
      const ew = getOrientation() === 'ew';
      for (const [tx, ty] of trapSquares.values()) {
        const anchor = squareAnchor(tx, ty);
        const trapScale = depthScale(tx, ty);
        const icon = new Sprite(trapTexture);
        icon.anchor.set(0.5, 0.5);
        // Keep the door's footprint proportional to its projected square. A
        // fixed world size made the far/away door look larger than the home one.
        icon.width = TILE_W * 0.72 * trapScale;
        icon.height = TILE_W * 0.72 * trapScale;
        // B9-16 (owner): mirror the trapdoor on the AWAY half so its perspective
        // faces that end (like the 180° away logo). N-S mirrors horizontally,
        // E-W mirrors vertically. Home half keeps the native art.
        if (tx >= PITCH_COLS / 2) {
          if (ew) icon.scale.y = -Math.abs(icon.scale.y);
          else icon.scale.x = -Math.abs(icon.scale.x);
        }
        icon.position.set(anchor.x, anchor.y);
        icon.zIndex = 0.5; // over turf/blood, under tokens
        this.tokenLayer.addChild(icon);
      }
    }

    // A failed Dodge/Rush report commits the attempted square for presentation even though the server keeps its
    // transient model coordinate at the origin while the reroll dialog is open. Re-apply that projection after
    // any same-dialog model refresh rebuilds the token generation.
    this.projectFailedMovementDestination();
    this.drawPushOptions();
    this.drawPlayerPick();
    this.drawPersistentPlayerArrows();
    this.drawPickMeUpCue();
    this.drawQuickSnapArrows();
    this.drawMarks(); // owner 2026-07-04f: persistent square marks (orientation-aware)

    // #194 (owner v3): SUPPRESS an executed-trail number on the square a player currently OCCUPIES in the model —
    // the digit under the moving piece hides and reappears once it has left (so the origin's 0 shows only after
    // the player leaves it). Keyed on `playersBySquare` (the MODEL coordinate, rebuilt above from fieldModel), NOT
    // the tween/animated position — server-derived, per Meero's binding condition. The trail nodes are persistent,
    // so this runs every refresh to track the moving occupancy (the planner suppression is inline, per-frame).
    this.updateTrailNumberVisibility();

    this.revalidatePath();
    this.redrawOverlays();
    this.drawDugouts();
    this.drawDugoutPlayerPickArrows();
    this.drawTurnTrack();

    // F-5: knockdown/injury flash — players newly transitioned to a
    // down/removed state pulse a red ring at their last known square
    const DOWN_STATES = new Set<number>([
      PlayerStateBase.STUNNED,
      PlayerStateBase.KNOCKED_OUT,
      PlayerStateBase.BADLY_HURT,
      PlayerStateBase.SERIOUS_INJURY,
      PlayerStateBase.RIP,
    ]);
    for (const data of this.game.fieldModel.playerDataArray) {
      const base = baseState(data.playerState);
      const previous = this.lastBaseStates.get(data.playerId);
      if (previous !== undefined && previous !== base && DOWN_STATES.has(base) && !DOWN_STATES.has(previous)) {
        const failedSquare = this.movementIntent?.failureConfirmed && this.movementIntent.playerId === data.playerId
          ? this.movementIntent.to : null;
        const square = failedSquare ?? (isOnPitch(data.playerCoordinate)
          ? data.playerCoordinate!
          : this.lastSquares.get(data.playerId));
        if (square) {
          const anchor = squareAnchor(square[0], square[1]);
          const ring = new Graphics()
            .ellipse(0, -3, TILE_W * 0.45, TILE_H * 0.34)
            .stroke({ color: 0xe03030, width: 3, alpha: 0.9 });
          ring.position.set(anchor.x, anchor.y);
          this.effectsLayer.addChild(ring);
          this.flashRings.push({ g: ring, x: anchor.x, y: anchor.y, scale: depthScale(square[0], square[1]), start: performance.now() });
        }
      }
      this.lastBaseStates.set(data.playerId, base);
    }

    // #185 F-1/KA-1/KA-4 (Meero SR-182): is the kickoff fly-in→apex→descend arc currently presenting '__ball__'?
    // The predicate + fail-open cap live in the pure exported arcInFlight(); the inline `arcActive` flag reads
    // its value. While true it (F-1a) suppresses the ground-slide branch below and (F-1b) freezes the
    // lastBallSquare/lastBallOnPitch latches so the off-pitch precondition survives play's immediate-apply race
    // — MIRRORING the heldBounce freeze (`:2518-2526`), the same "hold presentation while the model runs ahead"
    // idiom (not a new one). arcArmedAt is stamped on the first active frame and reset only when the arc GENUINELY
    // ends (not on the cap fail-open), so a capped release stays released until the underlying state clears.
    const arcState = {
      descendArmed: this.kickDescendSnapshot != null,
      apexAimed: this.kickApexAim != null,
      flyStarted: this.kickInFlyStart != null,
      holdUntil: this.kickInHoldUntil,
      now: performance.now(),
    };
    const arcRawActive = arcInFlight({ ...arcState, armedAt: null, capMs: 0 });
    if (arcRawActive && this.arcArmedAt == null) this.arcArmedAt = arcState.now;
    else if (!arcRawActive) this.arcArmedAt = null;
    const arcActive = arcInFlight({ ...arcState, armedAt: this.arcArmedAt, capMs: arcInFlightCapMs() });
    // #185 F-2: a turnEnd clear deferred during the arc still applies on REFRESH, and the same unconditional
    // retirement releases a stale authoritative snapshot when KA-4's fail-open cap expires.
    if (!arcActive && this.kickDescendSnapshot) {
      this.kickDescendSnapshot = null;
      this.pendingKickDescendClear = false;
    }

    const modelBall = this.game.fieldModel.ballCoordinate as [number, number] | null | undefined;
    // During final KICK presentation draw one dedicated flight ball at the authoritative landing identity;
    // the already-applied model ball (caught, touchback, loose, or off pitch) stays hidden until reconcile.
    const ball = this.passBallHold ?? (this.serverKickoffScatterReveal
      ? null
      : presentedBallCoordinate(modelBall, this.kickDescendSnapshot, arcActive));
    this.ballMarker = null;
    this.ballGlow = null;
    this.ballHalo = null;
    this.renderedBall = null;
    this.carrierFollow = null; // rebuilt below if a carrier holds the ball (nodes destroyed each refresh)
    // Ball is at rest on the ground (loose, not in flight) → the halo is static;
    // it only pulses while the ball is moving (owner).
    this.ballAtRest = !this.kickDescendSnapshot && isOnPitch(ball) && !this.game.fieldModel.ballMoving;
    if (!this.boardCleared && ball && (this.kickDescendSnapshot != null || isOnPitch(ball))) {
      const anchor = squareAnchor(ball[0], ball[1]);
      const scale = depthScale(ball[0], ball[1]);
      // Owner: a vertical CYAN COLUMN of light rising from the ball — opacity 80%
      // around the ball, fading to 0% at half-a-square tall; visibly pulses.
      const br = BALL_SPRITE_SIZE * 0.5; // ball radius
      const g = new Graphics(); // container: light column (behind) + ball (front)
      const glow = this.buildBallGlow();
      const ballDot = this.ballTexture
        ? this.sizedBallSprite(BALL_SPRITE_SIZE)
        : new Graphics().ellipse(0, 0, br, br * 0.78).fill(COLORS.ball).stroke({ color: 0x5a3a1a, width: 1 });
      g.addChild(glow, ballDot);
      this.ballGlow = glow;
      // Owner 2026-07-03: a LOOSE ball sits CENTRED in its square; only a
      // carried ball keeps the corner offset so it reads beside the carrier.
      const carrier =
        !this.kickDescendSnapshot && this.game.fieldModel.ballInPlay && !this.game.fieldModel.ballMoving
          ? this.game.fieldModel.playerDataArray.find(
              (d) => d.playerCoordinate?.[0] === ball[0] && d.playerCoordinate?.[1] === ball[1],
            )
          : undefined;
      // #59a (owner D5, Meero SR-12 — revises the SR-3 line): a CAUGHT kickoff now KEEPS the reticle THROUGH the
      // descent to VISUAL landing. SR-3 dropped the guard here so carrier-presence cleared INSTANTLY (owner then
      // wanted no reticle on catches); D5 reverses that for the descent. So the carrier-clear is SUPPRESSED while
      // a kick-in VISUAL is in flight (`now < kickInVisualUntil`) — the reticle then clears at the visual landing
      // via the flight/descent clear setTimeout (the `clearKickTarget` timers in `animateKickIn`/
      // `animateKickDescent`, throttle-resistant). ⚠ N59-1: the guard keys on the
      // WALL-CLOCK visual window, NEVER the model carrier (carrier-from-frame-1 is exactly the 26d84398 revert
      // hazard) — and on the FULL visual window (kickInVisualUntil), not just the apex-hold (kickInHoldUntil, whose
      // gap let the pre-SR-3 clear fire mid-descent). N59-2: bounded — kickInVisualUntil is finite (the descend
      // clear timer in `animateKickDescent` fires at
      // it) + the 6s TTL backstop remains, so it can't linger. After landing this fires as the defensive clear on a
      // genuine post-kickoff possession. Loose kickoffs have no carrier so never hit this. (#59b catch-fail =
      // no carrier here → clears via that same descend clear timer; TK stage-5 confirms it doesn't ride the TTL.)
      if (carrier && this.kickTarget && performance.now() >= this.kickInVisualUntil) this.clearKickTarget();
      // Owner 2026-07-07: a CARRIED ball is drawn SMALL (60%) ON the carrier's sprite (anchored
      // to its square — the ball token tweens with the carrier on a move), on top, instead of
      // being hidden. The cyan halo + "BALL" marker still cue possession; the light column is
      // dropped so it doesn't wash over the player.
      if (carrier) {
        // Owner 2026-07-08: the carried ball rides DEAD-CENTRE on the token (was pinned to
        // the head) and SCALES with the carrier's Strength so it stays proportionate on big
        // players (was a fixed 60%, which looked tiny on a Str5 big guy).
        const tp = this.tokenPos(ball[0], ball[1]);
        const carrierToken = this.tokensById.get(carrier.playerId);
        const carrierIsWalker = !!carrierToken && isWalkerToken(carrierToken);
        // Owner 09-05: walker tokens carry no renderer Strength factor (the art tiers size them), so neither does
        // the ball they hold; classic icons keep the table.
        const carrierScale = carrierIsWalker ? this.walkerStrengthFor(carrier.playerId) : strengthScale(playersById.get(carrier.playerId)?.strength);
        // Owner 09-05: on a walker the ball mounts at the CHEST (~58% up the figure), in the token's own scale
        // (depth x Strength), and is drawn smaller than on the wide classic canvas so a Str 1-2 carrier is not
        // wearing it as a hat. Strength scaling applies to both the lift and the ball size.
        // Owner 09-05 (round 22): on a walker the chest is measured from the MODEL as drawn (figure height at the
        // current decor scale, 48% up from the feet line) and the ball is sized to the model (ring width) — the
        // fixed 31 px chest put the ball on an ST 1-2 carrier's head.
        const drawnH = carrierIsWalker && carrierToken ? walkerDrawnFigureHeight(carrierToken) : null;
        // Owner 09-06: sized to the figure HEIGHT (lineman = 1, floor 0.9, big guys capped 1.3) — the ring/feet width
        // shrank the ball on carriers standing feet-together (a Str 4 carrier's ball all but vanished).
        const figureRatio = carrierIsWalker && carrierToken ? walkerFigureRatio(carrierToken) : null;
        const ballModelK = figureRatio ? Math.min(1.3, Math.max(0.9, figureRatio)) : 1;
        const chestLift = carrierIsWalker
          ? (drawnH ?? WALKER_TARGET_FIGURE_PX) * 0.48 - WALKER_FEET_Y_PX
          : 3 - TOKEN_BASE_SHIFT_PX; // bases sit +11 below the anchor
        g.position.set(tp.x, anchor.y - chestLift * scale * carrierScale);
        g.scale.set(scale * (carrierIsWalker ? CARRIED_BALL_BASE * 0.6 * ballModelK : CARRIED_BALL_BASE) * carrierScale);
        if (this.ballGlow) this.ballGlow.visible = false;
        // Owner 2026-07-15 (live test): pin the carried ball to the carrier token's live tweened position.
        this.carrierFollow = {
          carrierId: carrier.playerId,
          restX: this.tokenPos(ball[0], ball[1]).x,
          restY: anchor.y,
          nodes: [{ node: g, baseX: g.position.x, baseY: g.position.y, kind: 'plain' }],
        };
      } else {
        g.position.set(anchor.x, anchor.y - 3);
        g.scale.set(scale);
      }
      g.zIndex = this.depthZ(ball[0], ball[1]) + (carrier ? 2 : 1); // over the carrier's sprite
      this.tokenLayer.addChild(g);
      this.renderedBall = g;
      if (this.passBallFlight?.throwState === this.pendingBallThrow) g.visible = false;
      // F-5: ball flight — tween from the previous square on change
      let heldKickIn = false;
      let heldBounce = false;
      const prevBall = this.lastBallSquare;
      const ballScatter = this.pendingScatter.get('__ball__');
      if (ballScatter && ballScatter.path.length > 1) {
        // Owner 2026-07-07: the ball SCATTERS (changing-weather gust) — hop it along the
        // explicit path exactly like a thrown player, re-armed on the live ball token each
        // setGame (one clock) so it survives rebuilds. Keep the ball's render offset at the end.
        const SCATTER_SEG = presentationMs(200); // #55 (owner 07-16): ball-bounce hop cadence 150→200ms — every bounce beats on the STEP_BEAT_MS standard so the eye can track it (ball-only; player scatter const unchanged).
        const total = (ballScatter.path.length - 1) * SCATTER_SEG;
        if (performance.now() - ballScatter.start >= total) {
          this.pendingScatter.delete('__ball__');
        } else {
          const target = { x: g.position.x, y: g.position.y };
          const pts = ballScatter.path.map(([sx, sy]) => squareAnchor(sx, sy));
          pts[pts.length - 1] = target;
          this.moveTweens.set('__ball__', { token: g, waypoints: pts, style: 'hop', start: ballScatter.start, segmentMs: SCATTER_SEG });
        }
        if (!carrier) this.addTrailEcho(ball[0], ball[1], 0x22d3ee, 0x0a2a30);
      } else if (this.pendingBallThrow) {
        const pt = this.pendingBallThrow;
        if (this.passBallFlight?.throwState === pt) {
          // Pass/Hail Mary owns a dedicated token+ticker; retain branch priority so no ground tween competes.
        } else if (performance.now() - pt.start >= pt.durationMs) {
          this.pendingBallThrow = null;
        } else {
          // Owner 2026-07-08: punt stays on its byte-preserved refresh-driven ball-token path.
          const p0 = squareAnchor(pt.from[0], pt.from[1]);
          const target = { x: g.position.x, y: g.position.y }; // current landing anchor (keeps ball offset)
          this.moveTweens.set('__ball__', { token: g, waypoints: [p0, target], style: 'slide', start: pt.start, segmentMs: pt.durationMs, arc: KICK_ARC_PX });
          if (!carrier) this.addTrailEcho(ball[0], ball[1], 0x22d3ee, 0x0a2a30);
        }
      } else if (this.holdBallDuringInjury && !carrier && prevBall && (prevBall[0] !== ball[0] || prevBall[1] !== ball[1])) {
        // Owner 2026-07-08: a ball CARRIER was knocked down — FREEZE the now-loose ball at its
        // pre-bounce square until the armour/injury cine resolves, THEN let it bounce. This is a
        // render-side freeze keyed on the injury splash, so it holds in BOTH spectate AND play
        // mode (unlike the spectator drain, which no-ops in play). lastBallSquare is pinned at
        // prevBall below (heldBounce), so the freeze→bounce delta tweens on release.
        const p = squareAnchor(prevBall[0], prevBall[1]);
        g.position.set(p.x, p.y - 3);
        heldBounce = true;
      } else if (!this.suppressGenericBallInThisRefresh && !arcActive && prevBall && (prevBall[0] !== ball[0] || prevBall[1] !== ball[1])) {
        // #185 F-1a: the ground-slide branch must NOT capture '__ball__' while the kickoff arc is in flight —
        // this is THE branch that stole the arc in play (the immediate-apply post-landing frame matched here
        // first and overwrote the fly-in tween). arcInFlight now gates it, arc-scoped; the arc's own descent
        // tween owns the ball's motion until it completes, then normal sliding resumes (arcActive false).
        const target = { x: g.position.x, y: g.position.y };
        this.startMoveTween('__ball__', g, prevBall, [ball[0], ball[1]]);
        const tween = this.moveTweens.get('__ball__')!;
        tween.waypoints[tween.waypoints.length - 1] = target; // keep ball offset
        // Owner 2026-07-04: a LOOSE ball (bouncing / scattering — no carrier at the
        // landing square) leaves a cyan echo footprint at each square it lands in,
        // so you can see where it travels (off the ground and off a standing player
        // that fails a catch). A CARRIED/caught ball (carrier defined) leaves none.
        if (!carrier) this.addTrailEcho(ball[0], ball[1], 0x22d3ee, 0x0a2a30);
      } else if (!this.suppressGenericBallInThisRefresh && this.ballEverRendered && !this.lastBallOnPitch) {
        // The ball just came into play from off-pitch (kickoff / touchback /
        // throw-in): animate it flying in on a high arc from the far end and mark
        // where it lands.
        const aim = this.pendingKickAim ?? [ball[0], ball[1]];
        if (performance.now() < this.kickInHoldUntil) {
          // Owner 2026-07-06 (pacing 2) + 2026-07-07 (queue): a KICK-OFF EVENT is playing.
          // The ball FLIES IN from beyond the kicking team's end (the half opposite the
          // aim) on a traveling arc up to an apex over the aim, then HANGS there (visible)
          // while the event displays; it DESCENDS on a later frame (after the event).
          // lastBallOnPitch stays false so the descent still fires. Because refresh()
          // rebuilds the ball token every frame, the flight is re-armed on the SAME clock
          // (kickInFlyStart) each held frame so it progresses smoothly across rebuilds
          // instead of restarting from the edge (the old code teleported straight to the
          // apex — no visible travel, owner: "haven't seen the ball travel like FUMBBL").
          const a = squareAnchor(aim[0], aim[1]);
          const apex = { x: a.x, y: a.y - KICK_APEX_RISE };
          const [ex, ey] = this.kickInEdge(aim); // corner of the kicking end (curved arc)
          const edge = squareAnchor(ex, ey);
          if (this.kickInFlyStart == null) {
            this.kickInFlyStart = performance.now();
            this.showKickTrail(edge, a, apex); // travel arc: edge → apex → destination
          }
          if (performance.now() - this.kickInFlyStart < presentationMs(KICK_FLYIN_MS)) {
            g.position.set(edge.x, edge.y);
            this.moveTweens.set('__ball__', {
              token: g, waypoints: [edge, apex], style: 'slide',
              start: this.kickInFlyStart, segmentMs: presentationMs(KICK_FLYIN_MS), arc: KICK_ARC_PX,
              baseScale: g.scale.x, growTo: KICK_BALL_GROW, growMode: 'up', // grow toward the apex
            });
          } else {
            g.position.set(apex.x, apex.y); // flight complete — hang at the apex
            g.scale.set(g.scale.x * KICK_BALL_GROW); // hold at full apex size while it hangs
            this.moveTweens.delete('__ball__');
          }
          g.visible = true;
          this.showKickTarget(aim[0], aim[1]);
          this.kickApexAim = [aim[0], aim[1]];
          heldKickIn = true;
        } else if (this.kickApexAim) {
          // The event is over: DESCEND from the apex to the landing (+ bounce). Lift the
          // freshly-rebuilt token (placed at ground level above) back to the apex so the
          // fall starts from where the ball was hanging, then reset the flight clock.
          // #124 DD-1: descend to the SNAPSHOT scatter-landing when armed (the model ball may have raced to
          // CAUGHT under immediate-apply, so `[ball…]` / g.position would be the catcher's square = a wrong
          // snap). With a snapshot, both the bounce-dest and the render target are the snapshot landing.
          const descLanding = this.kickDescendSnapshot?.landing ?? [ball[0], ball[1]];
          const targetPos = this.kickDescendSnapshot
            ? squareAnchor(descLanding[0], descLanding[1])
            : { x: g.position.x, y: g.position.y };
          const apx = squareAnchor(this.kickApexAim[0], this.kickApexAim[1]);
          g.position.set(apx.x, apx.y - KICK_APEX_RISE);
          g.scale.set(g.scale.x * KICK_BALL_GROW); // start the descent at full apex size, shrink as it falls
          this.animateKickDescent(g, descLanding, targetPos, this.kickApexAim);
          this.kickApexAim = null;
          this.pendingKickAim = null;
          this.kickInFlyStart = null;
        } else {
          this.animateKickIn(g, [ball[0], ball[1]], { x: g.position.x, y: g.position.y });
          // #27 (owner): the kick-target crosshair is a KICKOFF-EVENT cue only. This branch ALSO handles
          // non-kickoff ball-ins (throw-in / touchback / re-scatter, which have no armed kick reticle), so
          // gate the emphasis flash on an active kickoff reticle — no crosshair flash on an ordinary ball-in.
          if (this.kickTarget) this.showKickTarget(ball[0], ball[1]);
        }
      }
      // heldBounce pins lastBallSquare at the pre-bounce square so the bounce tweens on release.
      // #185 F-1b (Meero SR-182): while the kickoff arc is in flight, FREEZE both latches too — lastBallSquare
      // stays put (the off-pitch precondition the arc branch needs) and lastBallOnPitch stays false (heldKickIn
      // alone only covers the APEX HOLD, not the descent, so the descent would otherwise flip it on and disqualify
      // the arc mid-flight). Mirrors the heldBounce pin. The arc's completion reconciliation (animateKickDescent's
      // cap timer) restores both to the landed truth so normal rendering resumes with no spurious slide.
      if (!heldBounce && !arcActive) this.lastBallSquare = [ball[0], ball[1]];
      if (!heldKickIn && !arcActive) this.lastBallOnPitch = true;
      this.ballEverRendered = true;

      // Ball-carrier marker (owner 2026-07-02, queue item 9): halo under the
      // carrier + bobbing down-arrow with "BALL" above the head, KO-marker
      // styling with no shadow disc; whole element 40% opacity so the pitch
      // stays legible. (carrier hoisted above for the position choice)
      // Owner 2026-07-03: the carrier INHERITS the ball's cyan aura — the halo
      // is the same cyan (0x22d3ee) as the ball's light column, not the old blue.
      if (carrier) {
        // Owner 2026-07-06: the carrier GLOW (+ BALL token) sit on the token's ACTUAL
        // on-screen column — apply the same perspective nudge the player token gets
        // (tokenPos.x), so an off-centre carrier's glow doesn't detach to the side.
        const tp = this.tokenPos(ball[0], ball[1]);
        // Owner 09-05: ellipses at the origin inside a Container placed at the carrier's ground point, so the
        // ticker can scale-breathe the ring about its own centre (same construction as the active-player halo).
        const halo = new Container();
        const haloGfx = new Graphics();
        for (const [radius, alpha] of [[0.62, 0.4], [0.5, 0.7], [0.4, 1]] as [number, number][]) {
          haloGfx
            .ellipse(0, 0, TILE_W * radius * scale, TILE_H * radius * 0.72 * scale)
            .fill({ color: 0x22d3ee, alpha });
        }
        halo.addChild(haloGfx);
        halo.position.set(tp.x, anchor.y - 3);
        halo.zIndex = this.depthZ(ball[0], ball[1]) - 1; // under the carrier's token
        halo.alpha = 0.4; // owner: entire element at 40%
        this.tokenLayer.addChild(halo);
        this.ballHalo = halo;
        // Owner 2026-07-15 (live test): the cyan aura also rode the destination square — pin it to the token.
        this.carrierFollow?.nodes.push({ node: halo, baseX: halo.position.x, baseY: halo.position.y, kind: 'plain' });
        // Owner 09-05 (round 3): the carrier's BALL marker sits at the FEET (small bounce, no arrow) — unless the
        // feet are already busy (skill ICONS set to the feet, or skill MARKINGS at the feet on this carrier), in
        // which case it swaps to OVER THE HEAD (above any over-head badge row).
        const carrierTokenForLabel = this.tokensById.get(carrier.playerId);
        const iconsAtFeet = this.iconPosition === 'feet'
          && !!carrierTokenForLabel?.getChildByLabel?.('skillBadges', false);
        const markingsAtFeet = this.markerPosition === 'feet'
          && !!carrierTokenForLabel?.getChildByLabel?.('skillMarkings', false);
        const atHead = iconsAtFeet || markingsAtFeet;
        const marker = this.buildBallToken(atHead ? 'label-bottom' : 'label-centre');
        const tokenBoundsForLabel = carrierTokenForLabel?.getLocalBounds() as { minY: number; maxY: number } | undefined;
        if (atHead) {
          const headTopY = carrierTokenForLabel && tokenBoundsForLabel
            ? anchor.y + tokenBoundsForLabel.minY * carrierTokenForLabel.scale.y
            : anchor.y - 22 * scale;
          const defaultLabelY = Math.min(anchor.y - 30 * scale + 8, headTopY - 4 * scale);
          marker.position.set(tp.x, this.ballMarkerYAboveSkillBadges(carrier.playerId, defaultLabelY, scale));
          marker.scale.set(scale * BALL_TOKEN_SCALE); // owner 2026-07-06: token 33% smaller
        } else {
          // Owner 09-05 (round 4): the word sits ON the shadow — centred on the base/shadow footprint (walker
          // ground shadow at WALKER_FEET_Y_PX-2 in token space; classic disc at -3 + the base shift) — and
          // scales WITH the token (depth x Strength), shrunk to ~70% of the over-head size.
          const tokenScale = carrierTokenForLabel?.scale.y ?? scale;
          // Owner 09-05: on a classic/flat icon the word sits at the FEET (the icon's bottom edge), not its centre.
          const shadowY = carrierTokenForLabel && isWalkerToken(carrierTokenForLabel)
            ? anchor.y + (WALKER_FEET_Y_PX - 2) * tokenScale
            : anchor.y + (TOKEN_BASE_SHIFT_PX - 3 + PLAYER_SPRITE_BASE * 0.4) * tokenScale;
          marker.position.set(tp.x, shadowY);
          // Owner 09-05 (round 21): the word is sized to the MODEL — from its ring width (lineman = 1, gnome ~0.76,
          // snotling ~0.62, big guys capped at 1.3) — so it no longer swallows an ST 1-2 figure.
          const ringRx = carrierTokenForLabel && isWalkerToken(carrierTokenForLabel) ? walkerShadowRadii(carrierTokenForLabel)?.rx : undefined;
          const modelK = ringRx ? Math.min(1.3, ringRx / 15.2) : 1;
          marker.scale.set(tokenScale * BALL_TOKEN_SCALE * 0.7 * modelK);
        }
        marker.zIndex = this.depthZ(ball[0], ball[1]) + 0.5; // owner 09-07: over its own row's tokens, under the nearer row (and their skill icons)
        // Owner 2026-07-04: if a player stands just BEHIND the carrier (an adjacent
        // square that renders ABOVE it, i.e. further from the camera), the "BALL"
        // label above the carrier's head overlaps them — drop it to 20% so they stay
        // visible. Otherwise keep it readable. (Square-adjacency avoids fragile
        // perspective maths.)
        const behindLabel = this.game.fieldModel.playerDataArray.some((d) => {
          const c = d.playerCoordinate;
          if (!c || !isOnPitch(c) || (c[0] === ball[0] && c[1] === ball[1])) return false;
          if (Math.abs(c[0] - ball[0]) > 1 || Math.abs(c[1] - ball[1]) > 1) return false; // adjacent only
          return squareAnchor(c[0], c[1]).y < anchor.y - TILE_H * 0.15 * scale; // rendered above the carrier
        });
        marker.alpha = atHead && behindLabel ? 0.2 : 0.92;
        this.tokenLayer.addChild(marker);
        this.ballMarker = { node: marker, baseY: marker.position.y, bob: atHead ? 3 : 2 * (carrierTokenForLabel?.scale.y ?? scale) }; // owner 09-05: a SMALL bounce
        // Owner 2026-07-15 (live test): the "BALL" marker follows the carrier too. kind:'marker' → the follow
        // updates ballMarker.baseY (the bob ticker reads it) + the x, so the bob composes cleanly on top.
        this.carrierFollow?.nodes.push({ node: marker, baseX: marker.position.x, baseY: marker.position.y, kind: 'marker' });
      } else if (this.game.fieldModel.ballInPlay && !this.game.fieldModel.ballMoving) {
        // Owner 2026-07-06 (task 2): a LOOSE ball at rest on the field also gets the
        // bouncing ▼/"BALL" token so it reads at a glance (same token as the carrier).
        const marker = this.buildBallToken();
        marker.position.set(anchor.x, anchor.y - 30 * scale + 8);
        marker.scale.set(scale * BALL_TOKEN_SCALE);
        marker.zIndex = this.depthZ(ball[0], ball[1]) + 0.5; // owner 09-07: see the carrier marker
        marker.alpha = 0.92;
        this.tokenLayer.addChild(marker);
        this.ballMarker = { node: marker, baseY: marker.position.y };
      }
    } else {
      this.lastBallSquare = null; // off pitch — don't tween the throw-in
      this.lastBallOnPitch = false;
      this.ballEverRendered = true;
    }

    // Shared live-play-adopted signal: highlight the ACTIVE player with a subtle gold halo
    // under the token + a beveled, drop-shadowed gold BADGE over the head that
    // visibly pulses (grows/shrinks) — replacing the old bobbing arrow.
    // Owner 2026-07-05 FIX: both the halo and the badge must sit on the token's
    // ACTUAL on-screen column (tokenPos, which applies the perspective nudgeX),
    // not the raw squareAnchor. Off-centre players are nudged horizontally, so the
    // old squareAnchor.x left the gold star floating to the SIDE of the player —
    // the "detached ball" the owner reported. Aligning to tokenPos.x makes the
    // badge crown the head; the vertical offset drops to sit just over the head
    // (was -52, up in the skill-badge band).
    if (this.activeMarker && !this.activeMarker.node.destroyed) this.activeMarker.node.destroy({ children: true }); // 09-06: effects-layer node
    this.activeMarker = null;
    this.activeHalo = null;
    this.activeFollow = null; // #3: rebuilt below if an active player is on-pitch (nodes destroyed each refresh)
    if (activePlayerAuraVisible(this.activePlayerId)) {
      const ad = this.game.fieldModel.playerDataArray.find((d) => d.playerId === this.activePlayerId);
      if (ad && isOnPitch(ad.playerCoordinate)) {
        const [ax, ay] = ad.playerCoordinate;
        const anchor = squareAnchor(ax, ay);
        const tp = this.tokenPos(ax, ay); // the token's real screen position (perspective-nudged)
        const scale = depthScale(ax, ay);
        // Owner 2026-07-06: wrap the halo in a Container centred on the token's
        // ground point, so the ticker can scale-pop it around its own centre
        // (ellipses drawn at the origin, container positioned at the foot).
        const halo = new Container();
        const haloGfx = new Graphics();
        // Owner 09-05 (round 16): on a walker the glow is drawn from the PLAYER MODEL's ground shadow (outer ring
        // ~1.7x the shadow) instead of the square, and the ticker scales it with the figure's decor scale — so an
        // ST 1-3 model no longer sits in a square-sized halo. Classic icons keep the square-based halo.
        const haloWalkerToken = this.tokensById.get(this.activePlayerId ?? '');
        const shadow = haloWalkerToken ? walkerShadowRadii(haloWalkerToken) : null;
        // Owner 09-06: the position ring shrank to the feet, and the halo (1.75x the ring) shrank with it into a
        // sliver — size the glow pool from the ring but ~2.6x wider, half as tall, with a tile-based floor so an
        // ST 1 figure still reads as active.
        const haloRx = shadow ? Math.max(shadow.rx * 2.9, TILE_W * 0.32 * scale) : 0; // owner 09-06: 3.9/0.42 -> 2.9/0.32, read too large
        const haloRy = haloRx * 0.5;
        for (const [radius, alpha] of [[0.66, 0.35], [0.52, 0.6], [0.4, 0.95]] as [number, number][]) {
          if (shadow) haloGfx.ellipse(0, 0, haloRx * radius / 0.66, haloRy * radius / 0.66).fill({ color: 0xf5c542, alpha });
          else haloGfx.ellipse(0, 0, TILE_W * radius * scale, TILE_H * radius * 0.72 * scale).fill({ color: 0xf5c542, alpha });
        }
        this.activeHaloToken = shadow ? haloWalkerToken ?? null : null;
        halo.addChild(haloGfx);
        halo.position.set(tp.x, anchor.y - 3);
        halo.zIndex = this.depthZ(ax, ay) - 1; // under the token
        halo.alpha = 0.4;
        this.tokenLayer.addChild(halo);
        this.activeHalo = halo;
        const marker = new Container();
        // the marker depicts the acting player's DECLARED ACTION (task 4). Only
        // trust the action when actingPlayer IS this active player; else default.
        const raw = (this.game.actingPlayer as { playerId?: string; playerAction?: string | null } | undefined)?.playerId === this.activePlayerId
          ? ((this.game.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? null)
          : null;
        const apid = this.activePlayerId;
        let glyphAction: string | null;
        // #251 (owner): retain only server-declared actions across transient mid-activation nulls.
        if (apid == null) {
          this.declaredActionCache = null;
          glyphAction = null;
        } else if (this.declaredActionCache?.playerId === apid) {
          if (raw != null && !(raw === 'move' && this.declaredActionCache.action.endsWith('Move'))) {
            this.declaredActionCache.action = raw;
          }
          glyphAction = this.declaredActionCache.action;
        } else if (raw != null) {
          this.declaredActionCache = { playerId: apid, action: raw };
          glyphAction = raw;
        } else {
          this.declaredActionCache = null;
          glyphAction = null;
        }
        const normalizedGlyphAction = (glyphAction ?? '').toLowerCase().replace(/[^a-z]/g, '');
        // Opposition-only dedupe: SpectateView's persistent #94 blitzer badge already draws ⚡
        // for this player, so suppress the transient actionEmoji/buildActionMarker blitz glyph.
        // SpectateView never sets this id for MY-side blitzers, leaving that render path byte-identical.
        // Owner 09-07: once the blitz is INITIATED the blitzer's ⚡ rests on the chest (state-marker row) — no over-head
        // ⚡ on top of it (was opposition-only via oppositionBlitzBadgePlayerId; now any blitzer carrying the badge).
        const blitzBadged = apid === this.oppositionBlitzBadgePlayerId || (!!apid && apid === this.blitzTokens?.blitzerId);
        if (!(blitzBadged && normalizedGlyphAction.includes('blitz'))) {
          marker.addChild(this.buildActionMarker(glyphAction));
        }
        // Owner 08-18: the declared-action decoration family (MOVE 🏃, blitz ⚡, pass 🏈, … — every
        // glyph buildActionMarker mounts here) sat ~a tile above the head. Generalized rule: the
        // marker sits HEAD-TIGHT by default, and dodges UP past ANY element occupying the token's
        // over-head stack. Implemented at this single mount point via the token's local-bounds top —
        // the token is the parent of all its decorations (skill-icon row, state markers, gaze eye,
        // activation ✓, marking text), so getLocalBounds().minY IS the over-head occupancy measure:
        // the head when the stack is empty, the topmost decoration when it isn't. No per-marker cases.
        // Fallback to the old fixed lift if the token can't be resolved. Glyph is centre-anchored
        // (~20px tall at marker scale), so back off half its height + a small gap.
        // decoration-shift (owner 08-19): anchor on the MODEL square's rest y (anchor.y — the token's
        // rest position, tokenPos().y ≡ squareAnchor().y), never token.position.y: mid-move refreshes
        // re-arm the tween with token.position at the path start / carried mid-tween pixel, and
        // activeFollow adds the tween delta on top of the base — a live-position base double-counts
        // the move and the marker wanders step to step. Local bounds stay: position-independent.
        const activeToken = this.activePlayerId ? this.tokensById.get(this.activePlayerId) : undefined;
        // Owner 09-08: measured through tokenOverheadTop — a walker's getLocalBounds() is its boundsArea, the FIGURE
        // alone, so the fist sat on the skill badges; the helper folds every decoration child in.
        const markerY = activeToken
          ? anchor.y + this.tokenOverheadTop(activeToken) * activeToken.scale.y - 6 * scale // owner 09-07: 13 -> 6, tighter to the body (all decorations)
          : anchor.y - 34 * scale;
        marker.position.set(tp.x, markerY); // just over the head/icon row, on the token's column
        marker.scale.set(scale);
        marker.zIndex = this.depthZ(ax, ay) + 3;
        // Owner 2026-07-05: the marker floats up ~a tile and can sit ON TOP of the
        // player standing behind. When that square is occupied by ANOTHER player,
        // drop the marker to 20% opacity so it doesn't hide them.
        const [msx, msy] = worldToSquare(tp.x, markerY);
        const behindId = this.playersBySquare.get(`${msx},${msy}`);
        if (behindId && behindId !== this.activePlayerId) marker.alpha = 0.2;
        // Owner 09-06: the marker lives in the EFFECTS layer just above the trail-number band — a trail digit on the
        // square behind the mover (one row up, i.e. right where the head-tight marker sits) drew over the Move art.
        // The digit stays visible around the marker. effectsLayer is not wiped by refresh(), so the previous node is
        // destroyed at each reset (below) instead.
        marker.zIndex = TRAIL_NUMBER_Z + 1;
        this.effectsLayer.addChild(marker);
        this.activeMarker = { node: marker, baseY: marker.position.y, baseScale: scale };
        this.activeMarkerDecorKey = null;
        // #3 (owner tester): pin the gold halo + action badge to the active token's live tweened position so they
        // ride WITH the token instead of teleporting to its model square (the OPPONENT-move lag; mirror of the
        // carried-ball follow). Both nodes are position-static after draw (their tickers only SCALE-pulse — halo
        // and badge tickers in the auto-director block), so 'plain' follow (set position) composes cleanly
        // under the pulse. rest = the
        // token's model-square screen position (tp.x / anchor.y), matching where the decorations were drawn.
        this.activeFollow = {
          carrierId: this.activePlayerId!,
          restX: tp.x,
          restY: anchor.y,
          nodes: [
            { node: halo, baseX: halo.position.x, baseY: halo.position.y, kind: 'plain' },
            { node: marker, baseX: marker.position.x, baseY: marker.position.y, kind: 'plain' },
          ],
        };
      }
    }
    refreshCompleted = true;
    } catch (error) {
      if (preservedPresentationToken && !preservedPresentationToken.destroyed && preservedPresentationToken.parent == null) {
        preservedPresentationToken.destroy({ children: true });
      }
      this.purgeFailedRefresh(error);
    } finally {
      if (refreshCompleted) this.refreshFailureLogged = false;
      if (refreshCompleted && this.game) {
        this.resumePostStepConvergenceAfterRefresh(suspendedPostStep);
      } else {
        // suspendPostStepConvergenceForRefresh already removed the old timers;
        // make the failure/null path explicit and keep no correction tied to a
        // partially destroyed token generation.
        this.cancelAllPostStepConvergence();
      }
    }
  }

  /**
   * B9-2: set the active player (server actingPlayer). Redraws the highlight;
   * the camera nudge is driven separately by the app so it can respect the
   * follow-active setting.
   */
  /** Owner 09-05: stamp a block-result symbol (the app supplies the texture URL — its plain block symbols, no die
   *  art) over each affected token: pops in at the chest, holds, then rises + fades. ~1.1 s total (viewer rule:
   *  ≥450 ms visible). Lives on the effects layer so a token rebuild cannot wipe it. */
  playBlockResultStamp(playerIds: readonly string[], textureUrl: string): void {
    if (!this.app || !this.game) return;
    const app = this.app;
    void Assets.load<Texture>(textureUrl).then((texture) => {
      if (this.app !== app || !this.game) return;
      const nodes: Container[] = [];
      for (const playerId of playerIds) {
        const data = this.game.fieldModel.playerDataArray.find((d) => d.playerId === playerId);
        if (!data || !isOnPitch(data.playerCoordinate)) continue;
        const [x, y] = data.playerCoordinate;
        const tp = this.tokenPos(x, y);
        const s = depthScale(x, y);
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5, 0.5);
        const size = TILE_W * 0.5 * s; // owner 09-06: 0.62 -> 0.5 (20% smaller)
        sprite.width = size;
        sprite.height = size;
        sprite.position.set(tp.x, squareAnchor(x, y).y - 6 * s); // over the body, not the head
        sprite.zIndex = this.depthZ(x, y) + 3;
        sprite.label = 'blockResultStamp';
        this.effectsLayer.addChild(sprite);
        nodes.push(sprite);
      }
      if (nodes.length === 0) return;
      const start = performance.now();
      const popMs = presentationMs(140), holdMs = presentationMs(700), fadeMs = presentationMs(260);
      const doneAt = start + popMs + holdMs + fadeMs;
      const bases = nodes.map((n) => ({ y: n.position.y, w: (n as Sprite).width }));
      let cleanup: () => void = () => {};
      const tick = () => {
        const now = performance.now();
        if (now >= doneAt || this.app !== app) { cleanup(); return; }
        const t = now - start;
        nodes.forEach((n, i) => {
          const sp = n as Sprite;
          if (t < popMs) { const k = t / popMs; const w = bases[i]!.w * (0.6 + 0.4 * Math.sin(Math.PI * k * 0.5)) * (1 + 0.25 * Math.sin(Math.PI * k)); sp.width = w; sp.height = w; sp.alpha = 1; }
          else if (t < popMs + holdMs) { sp.width = bases[i]!.w; sp.height = bases[i]!.w; sp.alpha = 1; }
          else { const k = (t - popMs - holdMs) / fadeMs; sp.alpha = 1 - k; sp.position.y = bases[i]!.y - 10 * k; }
        });
      };
      cleanup = this.registerEffectTicker(app, tick, nodes, () => undefined);
    }).catch(() => undefined);
  }

  /** Owner 09-05: one-shot gold pulse ring under `playerId`'s token (setup placement by another seat). Same ink
   *  and shape as the active-player halo; pops 1x -> 1.35x -> 1x over ~1.1 s while fading, then destroys itself.
   *  Lives on the effects layer so a token rebuild in the same frame cannot wipe it. */
  pulsePlacementRing(playerId: string): void {
    if (!this.game || !this.app) return;
    const data = this.game.fieldModel.playerDataArray.find((d) => d.playerId === playerId);
    if (!data || !isOnPitch(data.playerCoordinate)) return;
    const [ax, ay] = data.playerCoordinate;
    const anchor = squareAnchor(ax, ay);
    const tp = this.tokenPos(ax, ay);
    const scale = depthScale(ax, ay);
    const ring = new Container();
    const gfx = new Graphics();
    for (const [radius, alpha] of [[0.66, 0.35], [0.52, 0.6], [0.4, 0.95]] as [number, number][]) {
      gfx.ellipse(0, 0, TILE_W * radius * scale, TILE_H * radius * 0.72 * scale).fill({ color: 0xf5c542, alpha });
    }
    ring.addChild(gfx);
    ring.position.set(tp.x, anchor.y - 3);
    ring.label = 'placementPulse';
    this.effectsLayer.addChild(ring);
    const start = performance.now();
    const dur = presentationMs(1100);
    const ticker = this.app.ticker;
    const tick = () => {
      if (ring.destroyed) { ticker.remove(tick); return; }
      const k = Math.min(1, (performance.now() - start) / dur);
      ring.scale.set(1 + 0.35 * Math.sin(Math.PI * Math.min(1, k * 1.6)));
      ring.alpha = 0.55 * (1 - k * k);
      if (k >= 1) { ticker.remove(tick); ring.parent?.removeChild(ring); ring.destroy({ children: true }); }
    };
    ticker.add(tick);
  }

  /** Owner 09-05: a FAILED action (turnover) leaves the acting player's token as the server left it — the
   *  activation may not end for another frame or two, so the idle/facing reset on setActivePlayer does not fire
   *  yet. Settle every walker now: idle frame, motion window cleared, facing back to the camera default. */
  settleWalkersAfterTurnover(): void {
    settleWalkersIdle(this.walkerOwnerId, this.moveTweens);
    resetWalkerFacing(null);
  }

  setActivePlayer(playerId: string | null): void {
    if (playerId === this.activePlayerId) return;
    this.noteAutoDirectorActivity();
    if (playerId && this.autoDirector && !this.adSuspended) this.adForceNudgeSubject = playerId;
    this.flushMovementOverlay();
    this.declaredActionCache = null; // #251 (owner): active-player change or activation end
    if (this.activePlayerId) resetWalkerFacing(this.activePlayerId); // owner 09-05: idle facing resets when the activation ends
    // Owner 09-06: this reset lands at the wire signal, but the previous actor's last tile / follow-up / hit-and-run
    // tween may still be moving its token — the walker module now re-lands the idle facing when that motion
    // settles, for any walker that is not the (new) active player.
    setActiveWalkerPlayer(this.walkerOwnerId, playerId);
    // Owner 09-05 (round 2): BOTH signals — the server ending the activation (id -> null) and another player
    // committing an action (id -> other id, the blitz signal) — force every walker back to its idle frame.
    settleWalkersIdle(this.walkerOwnerId, this.moveTweens);
    this.activePlayerId = playerId;
    this.moveTrailCount.clear(); // owner 2026-07-08: fresh activation → restart the square count
    this.clearTrailNumbers(); // owner 2026-07-08: the previous activation's numbers vanish

    this.refresh();
    // Owner 2026-07-06: on an active-player change the halo does a one-shot
    // SELECTION POP (grow→settle) — refresh() just rebuilt this.activeHalo, so
    // arm the pop here. The old gold ECHO is now opt-in (activePlayerEcho) and
    // reduced to a single ring.
    if (playerId) {
      this.haloPulseStart = performance.now();
      if (this.activePlayerEcho) {
        const d = this.game?.fieldModel.playerDataArray.find((p) => p.playerId === playerId);
        if (d && isOnPitch(d.playerCoordinate)) this.flashGoldAura([d.playerCoordinate[0], d.playerCoordinate[1]]);
      }
    }
  }

  /** Identify an opposition blitzer already carrying SpectateView's persistent #94 badge. */
  setOppositionBlitzBadgePlayer(playerId: string | null): void {
    if (playerId === this.oppositionBlitzBadgePlayerId) return;
    this.oppositionBlitzBadgePlayerId = playerId;
    this.refresh();
  }

  /** Owner 09-07: this turn's blitz occurrence (store.blitzTokens) — the ⚡ / 🎯 chest badges follow it. */
  setBlitzTokens(tokens: { blitzerId: string; targetId: string } | null): void {
    const same = (!tokens && !this.blitzTokens)
      || (!!tokens && !!this.blitzTokens && tokens.blitzerId === this.blitzTokens.blitzerId && tokens.targetId === this.blitzTokens.targetId);
    if (same) return;
    const newTarget = tokens?.targetId && tokens.targetId !== this.blitzTokens?.targetId ? tokens.targetId : null;
    this.blitzTokens = tokens ? { blitzerId: tokens.blitzerId, targetId: tokens.targetId } : null;
    this.refresh();
    if (newTarget) this.pulseBlitzTarget(newTarget);
  }

  /** Owner 09-07: a RED pulse from the target ring the moment the blitz target is selected — one-shot via
   *  flashRings (self-fading), centred on the ring's chest mount. */
  private pulseBlitzTarget(playerId: string): void {
    if (!this.app || !this.game) return;
    const data = this.game.fieldModel.playerDataArray.find((d) => d.playerId === playerId);
    if (!data || !isOnPitch(data.playerCoordinate)) return;
    const [x, y] = data.playerCoordinate;
    const anchor = squareAnchor(x, y);
    const scale = depthScale(x, y);
    const chestY = anchor.y - (isDown(data.playerState) ? 0 : 16 * scale);
    const ring = new Graphics();
    ring.circle(0, 0, TILE_W * 0.3).stroke({ color: 0xe03030, width: 3, alpha: 0.95 });
    ring.circle(0, 0, TILE_W * 0.22).fill({ color: 0xe03030, alpha: 0.28 });
    ring.position.set(anchor.x, chestY);
    ring.zIndex = this.depthZ(x, y) + 4;
    this.effectsLayer.addChild(ring);
    this.flashRings.push({ g: ring, x: anchor.x, y: chestY, scale, start: performance.now(), grow: 1.1, durationMs: presentationMs(650) });
  }

  /** Owner 2026-07-06: opt into the DEPRECATED gold-echo pop on active-player
   *  change (default off; the halo selection-pop is the primary indicator). */
  setActivePlayerEcho(on: boolean): void { this.activePlayerEcho = on; }

  /** B9-2: nudge the camera to the active player's square (if on pitch). */
  focusActivePlayer(): void {
    if (!this.game || !this.activePlayerId) return;
    const d = this.game.fieldModel.playerDataArray.find((p) => p.playerId === this.activePlayerId);
    if (d && isOnPitch(d.playerCoordinate)) {
      this.adForceNudgeSubject = this.activePlayerId;
      this.noteAutoDirectorActivity();
    }
  }

  /**
   * B9-2: gently pan the camera toward a square if it is not already near the
   * viewport centre (no zoom — respects the current scale). Skipped while a
   * cinematic owns the camera.
   */
  nudgeToSquare(square: [number, number]): void {
    if (!this.app || this.cinematic || !this.autoDirector || this.adSuspended) return;
    const anchor = squareAnchor(square[0], square[1]);
    this.adRequestedNudge = { subject: `event:${square[0]},${square[1]}`, point: anchor };
    this.adForceNudgeSubject = this.adRequestedNudge.subject;
    this.noteAutoDirectorActivity();
  }

  /** Owner 09-08: log double-click — centre the camera on a square. With the auto-director on, the director's
   *  own nudge glides there (it keeps ownership); otherwise an eased manual pan. Zoom only comes IN, and only from
   *  the whole-pitch fit (a coach's closer zoom is never yanked); a live cinematic owns the camera and wins. */
  private cameraFocus: { target: { x: number; y: number }; fromX: number; fromY: number; fromScale: number; toScale: number; start: number; ms: number } | null = null;
  static readonly FOCUS_MS = 420;
  static readonly FOCUS_ZOOM_FROM_FIT = 1.6;
  focusOnSquare(square: [number, number], ms = PitchRenderer.FOCUS_MS): void {
    if (!this.app || this.cinematic) return;
    if (this.autoDirector && !this.adSuspended) { this.nudgeToSquare(square); return; }
    const anchor = squareAnchor(square[0], square[1]);
    const current = this.world.scale.x;
    const atFit = Math.abs(current - this.cameraFitScale) < 1e-6;
    const toScale = atFit ? this.quantizeZoom(this.cameraFitScale * PitchRenderer.FOCUS_ZOOM_FROM_FIT, 'nearest') : current;
    this.cameraFocus = {
      target: anchor, fromX: this.world.position.x, fromY: this.world.position.y,
      fromScale: current, toScale, start: performance.now(), ms: Math.max(1, ms),
    };
  }

  /** Focus the camera on where a player's token rendered (pitch square, or its dugout box). */
  focusOnPlayer(playerId: string): boolean {
    const square = this.cueAnchorForPlayer(playerId);
    if (!square) return false;
    this.focusOnSquare(square);
    return true;
  }

  /** Owner 2026-07-06: is a square inside the visible viewport (with a margin)? Used
   *  to decide whether an off-camera event needs a camera nudge before it renders. */
  isOnCamera(square: [number, number], margin = 0.12): boolean {
    if (!this.app) return true;
    const p = this.squareToCanvas(square);
    if (!p) return true;
    const mw = this.app.screen.width * margin;
    const mh = this.app.screen.height * margin;
    return p.x >= mw && p.x <= this.app.screen.width - mw && p.y >= mh && p.y <= this.app.screen.height - mh;
  }

  /** Owner 2026-07-06 (event pacing): if the auto-director is on and the event square
   *  is OFF camera, nudge the camera to it so the event isn't missed. Returns the
   *  approx ms the pan needs (so the caller can DELAY rendering until the camera has
   *  arrived), or 0 when no nudge was needed (already on screen / cinematic owns the
   *  camera / director off). */
  ensureOnCamera(square: [number, number]): number {
    if (!this.autoDirector || this.cinematic || this.isOnCamera(square)) return 0;
    this.nudgeToSquare(square);
    return presentationMs(420); // matches the nudge ease duration
  }

  // --- selection & movement planning (Match10 / O8) ---

  /** Selects a player for planning (golden halo, O1); resets any queued path. */
  selectPlayer(playerId: string | null): void {
    if (playerId === this.selectedPlayerId) return;
    this.selectedPlayerId = playerId;
    this.blockTargetsAttacker = null; // a selection change ends the block-target preview
    // Owner 2026-07-04c: a selection change drops any armed foul/handoff/pass
    if (this.armedAction) {
      this.armedAction = null;
      this.onActionTarget?.(null);
    }
    this.setActionMode('auto'); // O5: each activation starts in Auto
    this.onSelectionChange?.(playerId);
    this.setPath([]);
    this.drawDugouts(); // dugout selection halo tracks the selection
  }

  /** O4: declares the action mode for the selected player (hotbar buttons). */
  setActionMode(mode: ActionMode): void {
    if (mode === this.actionMode) return;
    this.actionMode = mode;
    this.clearHoverSquareMarker();
    this.pendingBlock = null;
    if (mode !== 'bomb') this.bombTarget = null;
    if (this.armedAction) {
      this.armedAction = null;
      this.onActionTarget?.(null);
    }
    this.onActionModeChange?.(mode);
    this.redrawOverlays();
  }

  getActionMode(): ActionMode {
    return this.actionMode;
  }

  clearSelection(): void {
    this.selectPlayer(null);
  }

  getSelectedPlayerId(): string | null {
    return this.selectedPlayerId;
  }

  getPlannedPath(): Square[] {
    return this.plannedPath.map(([x, y]) => [x, y]);
  }

  /** Right-click is exclusively a waypoint-cancel gesture while either planner owns a plotted route. It clears
   * the complete route in one action and returns true so the canvas handler cannot surface any context menu. */
  dismissWaypointPlanForContextMenu(): boolean {
    const hasOrder66Waypoints = this.o66PathSquares.length > 1;
    if (this.plannedPath.length === 0 && !hasOrder66Waypoints) return false;
    if (this.plannedPath.length > 0) this.setPath([]);
    if (hasOrder66Waypoints) this.setO66Path([]);
    this.onWaypointPlanCancel?.();
    return true;
  }

  /** Single funnel for path mutations so the host's confirm gate stays in sync. */
  private setPath(path: Square[]): void {
    this.plannedPath = path;
    this.jumpSteps = new Set([...this.jumpSteps].filter((i) => i < path.length));
    this.pendingBlock = null; // path changes re-arm the preview
    this.onPathChange?.(this.getPlannedPath(), this.selectedPlayerId);
    this.redrawOverlays();
  }

  /** Current path end (or the selected player's square); null without selection. */
  getPathEnd(): Square | null {
    const info = this.selectionInfo();
    if (!info) return null;
    if (this.plannedPath.length > 0) {
      const [x, y] = this.plannedPath[this.plannedPath.length - 1]!;
      return [x, y];
    }
    const [px, py] = info.data.playerCoordinate!;
    return [px, py];
  }

  /**
   * Jump over a downed player adjacent to the path end, landing on the square
   * directly opposite (owner 2026-07-02 RC4). Prototype: the jump occupies one
   * path index; MA cost of the second square is a TODO for M4 accounting.
   */
  canJumpOver(downed: Square): boolean {
    return this.jumpLanding(downed) !== null;
  }

  planJumpOver(downed: Square): boolean {
    const landing = this.jumpLanding(downed);
    if (!landing) return false;
    this.jumpSteps.add(this.plannedPath.length);
    this.setPath([...this.plannedPath, landing]);
    return true;
  }

  private jumpLanding(downed: Square): Square | null {
    const info = this.selectionInfo();
    if (!info) return null;
    const start = this.getPathEnd()!;
    const dx = downed[0] - start[0];
    const dy = downed[1] - start[1];
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return null; // must be adjacent
    const landing: Square = [downed[0] + dx, downed[1] + dy];
    if (landing[0] < 0 || landing[0] >= PITCH_COLS || landing[1] < 0 || landing[1] >= PITCH_ROWS) return null;
    if (this.occupiedForPathing().has(squareKey(landing[0], landing[1]))) return null;
    if (this.plannedPath.length + 1 > info.normal + info.rushes) return null;
    return landing;
  }

  private selectedIsHome(): boolean {
    return (
      !!this.game &&
      !!this.selectedPlayerId &&
      this.game.teamHome.playerArray.some((p) => p.playerId === this.selectedPlayerId)
    );
  }

  /** Owner 2026-07-04d: the selected player is a legal ACTOR — on the team whose
   *  turn it is (home iff homePlaying). Only an actor can arm a block/foul/pass/
   *  move plan; selecting an OPPOSITION player is view-only (its stats card), so
   *  clicking opp→own no longer arms a "reverse" block preview. */
  private selectedIsActor(): boolean {
    return !!this.game && !!this.selectedPlayerId && this.selectedIsHome() === !!this.game.homePlaying;
  }
  /** Owner 09-08: spectate/replay are INSPECTION-ONLY surfaces (no planner, no o66 play): every selection is a
   *  read-only reach/tackle-zone inspect, and any click away — empty square or right-click — must clear it.
   *  selectedIsActor() alone is not enough there: an acting-side player still counts as "the actor". */
  private inspectionOnly(): boolean {
    return !this.plannerEnabled && !this.order66;
  }

  /** Squares marked by opposition tackle zones — dodges roll when leaving them. */
  private markedSquares(): Set<string> {
    return new Set(this.tackleZoneCounts(this.selectedIsHome()).opposition.keys());
  }

  /** Owner 2026-07-08 (queue 9): a player's MA, SANITIZED. Some wire players arrive
   *  without a numeric `movement` (star/merc stat variants) — the raw read fed NaN
   *  into the reach BFS, whose bound check then never fired and the planner flooded
   *  the whole pitch ("distance wildly off"). Clamp to [0, 9] (the BB MA cap) and
   *  fall back to 6 with a diagnostic warn so the offending player is identifiable. */
  private safeMovement(player: PlayerJson): number {
    // EFFECTIVE MA (Player.getMovementWithModifiers, Player.java:229-231): base roster MA plus every
    // temporaryModifiersMap MA modifier, ruleset-clamped. Greasy Cleats' temporary -1 must shrink the planned
    // reach/preview; the base roster stat is never mutated.
    const ma = Number(effectiveMovement(player));
    if (Number.isFinite(ma) && ma >= 0) return Math.min(ma, 9);
    if (!this.badMovementWarned.has(player.playerId)) {
      this.badMovementWarned.add(player.playerId);
      console.warn('ffb-pitch: player has no numeric movement — planner falls back to MA 6', player.playerId, player.playerName, player.movement);
    }
    return 6;
  }
  private badMovementWarned = new Set<string>();

  private selectionInfo(): {
    player: PlayerJson;
    data: PlayerDataJson;
    /** squares movable without a Rush (stand-up cost already deducted, C6) */
    normal: number;
    /** additional Rush squares (2, or 3 with Sprint) */
    rushes: number;
    /** squares already stepped this activation */
    used: number;
  } | null {
    if (!this.game || !this.selectedPlayerId) return null;
    const data = this.game.fieldModel.playerDataArray.find((d) => d.playerId === this.selectedPlayerId);
    if (!data || !isOnPitch(data.playerCoordinate)) return null;
    const player = [...this.game.teamHome.playerArray, ...this.game.teamAway.playerArray].find(
      (p) => p.playerId === this.selectedPlayerId,
    );
    if (!player) return null;
    let normal = this.safeMovement(player); // queue 9: NaN-proof MA
    if (isDown(data.playerState)) normal = Math.max(0, normal - 3); // stand up costs 3 (C6)
    // Owner 09-06: a STUNNED player has NO movement this turn — inspecting one must not shade a range.
    if (baseState(data.playerState) === PlayerStateBase.STUNNED) return { player, data, normal: 0, rushes: 0, used: 0 };
    const baseNormal = normal; // MA after stand-up, BEFORE subtracting steps taken (drives the rush-used count)
    // Owner 2026-07-09 (C3 — move allowance): the interactive PLANNER must subtract squares ALREADY
    // stepped this activation (actingPlayer.currentMove), exactly like drawActiveReach does — otherwise
    // after a partial move the planner offered a FRESH full-MA path from the new square, letting the
    // player exceed their movement allowance (the "players can exceed their move allowance" bug).
    const acting = this.game.actingPlayer as { playerId?: string; currentMove?: number } | undefined;
    const usedRaw = Number(acting?.currentMove);
    const used = acting?.playerId === this.selectedPlayerId && Number.isFinite(usedRaw) ? Math.max(0, usedRaw) : 0;
    normal = Math.max(0, baseNormal - used);
    // Owner 2026-07-14 (#10/#23): rushes ALREADY SPENT (steps beyond normal MA) reduce the remaining rush allotment
    // — the reach must key off the actingPlayer's REMAINING movement, not a fixed 2 (each rush used → one fewer GFI).
    const totalRushes = playerHasSkill(player, 'Sprint') ? 3 : 2;
    const rushes = Math.max(0, totalRushes - Math.max(0, used - baseNormal));
    return { player, data, normal, rushes, used };
  }

  /** Occupied squares for pathing: every player except the selected one. */
  private occupiedForPathing(): Set<string> {
    const occupied = new Set(this.playersBySquare.keys());
    const info = this.selectionInfo();
    if (info) occupied.delete(squareKey(info.data.playerCoordinate![0], info.data.playerCoordinate![1]));
    return occupied;
  }

  // ---- ORDER 66 client-reach movement (owner o66m+: the server sends only the NEXT step, not the reach — so
  //      the CLIENT computes the full reach + path, exactly as upstream FFB does; the server validates each step
  //      and aborts on a failed dodge/rush. Reuses the same selectionInfo/reachableSquares/planPath machinery
  //      the legacy planner uses, keyed on the o66 acting player instead of the renderer's selection.) ---------

  /** The moving player's budget: MA less stand-up and the squares already stepped this activation
   *  (actingPlayer.currentMove), plus its rush allotment. Mirrors selectionInfo(), keyed on an explicit id. */
  private o66MovementBudget(playerId: string): { from: Square; normal: number; rushes: number; used: number } | null {
    if (!this.game) return null;
    const data = this.game.fieldModel.playerDataArray.find((d) => d.playerId === playerId);
    if (!data || !isOnPitch(data.playerCoordinate)) return null;
    const acting = this.game.actingPlayer as { playerId?: string; currentMove?: number } | undefined;
    const usedRaw = Number(acting?.currentMove);
    const used = acting?.playerId === playerId && Number.isFinite(usedRaw) ? Math.max(0, usedRaw) : 0;
    return this.o66MovementBudgetAt(playerId, [data.playerCoordinate[0], data.playerCoordinate[1]], used);
  }

  /** Presentation companion to o66MovementBudget: same rules, but from one frozen visual cursor. */
  private o66MovementBudgetAt(
    playerId: string,
    from: Square,
    used: number,
  ): { from: Square; normal: number; rushes: number; used: number } | null {
    if (!this.game) return null;
    const data = this.game.fieldModel.playerDataArray.find((d) => d.playerId === playerId);
    if (!data) return null;
    const player = [...this.game.teamHome.playerArray, ...this.game.teamAway.playerArray].find((p) => p.playerId === playerId);
    if (!player) return null;
    let normal = this.safeMovement(player);
    if (isDown(data.playerState)) normal = Math.max(0, normal - 3); // stand up costs 3
    const baseNormal = normal; // MA after stand-up, BEFORE subtracting steps taken (drives the rush-used count)
    used = Number.isFinite(used) ? Math.max(0, used) : 0;
    // W27: On-the-Ball reactions have their own fixed allowance. Upstream UtilPlayer.hasMoveLeft uses
    // currentMove < 3 for PASS_BLOCK/KICKOFF_RETURN and isNextMoveGoingForIt returns false in both modes.
    // Keep this branch after the shared player/from/used reads but before every regular MA/rush calculation:
    // regular MOVE/BLITZ/PASS/FOUL/HAND_OVER budgets below remain byte-for-byte unchanged.
    const turnMode = String(this.game.turnMode ?? '');
    if (turnMode === 'kickoffReturn' || turnMode === 'passBlock') {
      return { from: [from[0], from[1]], normal: Math.max(0, 3 - used), rushes: 0, used };
    }
    normal = Math.max(0, baseNormal - used);
    // Owner 2026-07-14 (#10/#23): rushes already spent (steps beyond normal MA) reduce the remaining rush allotment.
    const totalRushes = playerHasSkill(player, 'Sprint') ? 3 : 2;
    const rushes = Math.max(0, totalRushes - Math.max(0, used - baseNormal));
    return { from: [from[0], from[1]], normal, rushes, used };
  }

  /** KICKOFF_RETURN is capped not just by MP but by the playing side's half (upstream
   *  UtilServerPlayerMove.updateMoveSquares). Treat the other half as occupied for this mode only, so the
   *  existing reach and path algorithms cannot paint or route through a square the window will never admit. */
  private blockIllegalO66WindowSquares(occupied: Set<string>): void {
    if (!this.game || String(this.game.turnMode ?? '') !== 'kickoffReturn') return;
    const homePlaying = !!this.game.homePlaying;
    for (let x = 0; x < PITCH_COLS; x++) {
      if ((homePlaying && x <= 12) || (!homePlaying && x >= 13)) continue;
      for (let y = 0; y < PITCH_ROWS; y++) occupied.add(squareKey(x, y));
    }
  }

  /** Opposition tackle-zone squares (dodge-from) for the given mover's side. */
  private markedSquaresFor(playerId: string): Set<string> {
    const isHome = this.game?.teamHome.playerArray.some((p) => p.playerId === playerId) ?? false;
    return new Set(this.tackleZoneCounts(isHome).opposition.keys());
  }

  /** The full CLIENT-computed reach for `playerId` + the subset needing a rush (cost beyond normal MA).
   *  `plannedRoute` = the squares already PLOTTED in the planner (excl. the start square, as o66PendingMove
   *  holds them). Owner 08-18: with a plot in place the overlay must re-derive FROM THE WAYPOINT on the
   *  REMAINING budget — upstream gets this for free because each click commits (see budgetAfterPlannedSteps),
   *  while our deferred plan kept painting the origin ring. The plotted squares stay in `squares` (they remain
   *  clickable: the last confirms, an earlier one truncates) and never read as rush. */
  o66Reach(playerId: string, plannedRoute: readonly Square[] = []): { from: Square; squares: Square[]; rush: Square[]; normal: number } | null {
    const b = this.o66MovementBudget(playerId);
    if (!b) return null;
    return this.o66ReachFromBudget(playerId, b, plannedRoute);
  }

  private o66ReachFromBudget(
    playerId: string,
    b: { from: Square; normal: number; rushes: number },
    plannedRoute: readonly Square[] = [],
  ): { from: Square; squares: Square[]; rush: Square[]; normal: number } {
    const from: Square = plannedRoute.length ? plannedRoute[plannedRoute.length - 1]! : b.from;
    const budget = budgetAfterPlannedSteps(b.normal, b.rushes, plannedRoute.length);
    const occupied = new Set(this.playersBySquare.keys());
    occupied.delete(squareKey(b.from[0], b.from[1]));
    const modelCoordinate = this.game?.fieldModel.playerDataArray.find((d) => d.playerId === playerId)?.playerCoordinate;
    if (isOnPitch(modelCoordinate ?? null)) occupied.delete(squareKey(modelCoordinate![0], modelCoordinate![1]));
    // plotted squares are empties the mover walks THROUGH — never blockers (mirrors o66ExtendPath)
    for (const s of plannedRoute) occupied.delete(squareKey(s[0], s[1]));
    this.blockIllegalO66WindowSquares(occupied);
    const reach = reachableSquares(occupied, from, budget.normal + budget.rushes);
    const routeKeys = new Set(plannedRoute.map((s) => squareKey(s[0], s[1])));
    const squares: Square[] = [];
    const rush: Square[] = [];
    for (const [key, cost] of reach.costs) {
      const [sx, sy] = key.split(',').map(Number) as Square;
      squares.push([sx, sy]);
      if (cost > budget.normal && !routeKeys.has(key)) rush.push([sx, sy]);
    }
    for (const s of plannedRoute) if (!reach.costs.has(squareKey(s[0], s[1]))) squares.push([s[0], s[1]]);
    return { from, squares, rush, normal: budget.normal };
  }

  /** Display-only reach. Click/path APIs continue to call public o66Reach(), which reads the live model. */
  private movementPresentationReach(): ReturnType<PitchRenderer['o66Reach']> {
    const cursor = this.movementPresentationCursor;
    if (!cursor) return null;
    const budget = this.o66MovementBudgetAt(cursor.playerId, cursor.coordinate, cursor.movementUsed);
    return budget ? this.o66ReachFromBudget(cursor.playerId, budget) : null;
  }

  /** Auto-path `playerId` to `to` (fewest dice rolls, then fewest steps) through the client reach; the whole
   *  path rides one clientMove (o66Move) and the server validates each step. Excludes the start square. */
  /** Owner 09-06: a LOOSE ball on the pitch is a square the auto-pather must not step through — stepping on it is a
   *  pickup attempt (a roll, and a turnover on failure), never an incidental waypoint. The ball square stays open
   *  only when it IS the destination. Carried balls sit on an occupied square already. */
  private blockLooseBallSquare(occupied: Set<string>, to: Square): void {
    const fm = this.game?.fieldModel;
    const ball = fm?.ballCoordinate as [number, number] | null | undefined;
    if (!ball || !fm?.ballInPlay || !isOnPitch(ball)) return;
    if (ball[0] === to[0] && ball[1] === to[1]) return;
    occupied.add(squareKey(ball[0], ball[1]));
  }

  o66AutoPath(playerId: string, to: Square): Square[] | null {
    const b = this.o66MovementBudget(playerId);
    if (!b) return null;
    const occupied = new Set(this.playersBySquare.keys());
    occupied.delete(squareKey(b.from[0], b.from[1]));
    this.blockIllegalO66WindowSquares(occupied);
    this.blockLooseBallSquare(occupied, to); // owner 09-06: never path THROUGH the ball
    return planPath(occupied, this.markedSquaresFor(playerId), b.from, to, 0, b.normal, b.normal + b.rushes);
  }

  /** Waypoint routing (owner o66ad, FUMBBL planner): EXTEND an existing planned route by pathing from its LAST
   *  square to `to`, keeping rush/dodge accounting GLOBAL (stepsUsed = priorRoute.length so rushes count from the
   *  player's whole budget, not fresh from the waypoint). If `to` already lies ON the prior route, TRUNCATE back to
   *  it (click a visited square to shorten the plan). Returns the full combined route (excl. the start square) or
   *  null if the extension can't be reached within the remaining budget. */
  o66ExtendPath(playerId: string, priorRoute: Square[], to: Square): Square[] | null {
    const b = this.o66MovementBudget(playerId);
    if (!b) return null;
    const toKey = squareKey(to[0], to[1]);
    // backtrack: clicking a square already on the plan trims it there (no re-route)
    const hit = priorRoute.findIndex((s) => squareKey(s[0], s[1]) === toKey);
    if (hit >= 0) return priorRoute.slice(0, hit + 1);
    const start: Square = priorRoute.length ? priorRoute[priorRoute.length - 1]! : b.from;
    const occupied = new Set(this.playersBySquare.keys());
    occupied.delete(squareKey(b.from[0], b.from[1]));
    this.blockIllegalO66WindowSquares(occupied);
    // the already-planned squares are empties the player walks THROUGH — never treat them as blockers
    for (const s of priorRoute) occupied.delete(squareKey(s[0], s[1]));
    const seg = planPath(occupied, this.markedSquaresFor(playerId), start, to, priorRoute.length, b.normal, b.normal + b.rushes);
    if (!seg || seg.length === 0) return null;
    return [...priorRoute, ...seg];
  }

  /** Owner o66ah (click-to-act blitz/foul walk-to-contact): the best auto-path to a square ADJACENT to `target`.
   *  Returns [] when the actor is ALREADY adjacent (no walk), the fewest-steps auto-path to the best reachable
   *  neighbour otherwise, or null if no adjacent square is reachable within budget. Reuses o66AutoPath (which
   *  routes through dodges/rushes), so a contact that needs a dodge still plans (fixes the "planner didn't plot
   *  the path over to the player" foul case). */
  o66PathToContact(attackerId: string, target: Square): Square[] | null {
    const b = this.o66MovementBudget(attackerId);
    if (!b) return null;
    const cheby = (a: Square, c: Square) => Math.max(Math.abs(a[0] - c[0]), Math.abs(a[1] - c[1]));
    if (cheby(b.from, target) <= 1) return []; // already adjacent — no walk needed
    let best: Square[] | null = null;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const sq: Square = [target[0] + dx, target[1] + dy];
      if (sq[0] < 0 || sq[1] < 0) continue;
      const path = this.o66AutoPath(attackerId, sq);
      if (path && path.length > 0 && (!best || path.length < best.length)) best = path;
    }
    return best;
  }

  /** #36 (Yularen 07-16 RATIFIED): reason-returning companion to o66PathToContact. Same walk-to-contact plot,
   *  but reports WHY when no walk exists so the UX (SpectateView foul/blitz + Classic G1a) can say "victim is
   *  surrounded" vs "too far this turn" instead of a bare null. o66PathToContact stays UNTOUCHED for its other
   *  callers; the PATH this returns is identical to o66PathToContact's non-null result (same occupancy source).
   *  CORRECT-NULL CATALOGUE (the genuinely-unreachable cases — none is an algorithm gap):
   *  - PATH: `path` = fewest-steps walk to the best reachable neighbour of `target`, or [] if already adjacent.
   *  - SURROUNDED: every on-pitch neighbour of `target` is occupied → no empty square to stand on → contact
   *    impossible (in-rules there is no foul/block to declare). `path: []`.
   *  - OUT_OF_RANGE: open neighbour(s) exist but none is reachable within the mover's budget this activation
   *    (normal MA − stand-up − steps-used, + rushes); also covers a mover with no budget / off-pitch. `path: []`.
   *  Note: tackle zones NEVER produce a non-PATH status — planPath routes THROUGH a TZ, counting a dodge roll;
   *  reachability is unaffected. Classification reads the SAME `playersBySquare` the search uses, so the status
   *  can never disagree with the path result. */
  o66ContactReach(attackerId: string, target: Square): O66ContactResult {
    const b = this.o66MovementBudget(attackerId);
    if (!b) return { status: 'OUT_OF_RANGE', path: [] };
    const cheby = (a: Square, c: Square) => Math.max(Math.abs(a[0] - c[0]), Math.abs(a[1] - c[1]));
    if (cheby(b.from, target) <= 1) return { status: 'PATH', path: [] }; // already adjacent — no walk needed
    let best: Square[] | null = null;
    let anyOpenNeighbour = false;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const sq: Square = [target[0] + dx, target[1] + dy];
        if (sq[0] < 0 || sq[1] < 0 || sq[0] >= PITCH_COLS || sq[1] >= PITCH_ROWS) continue; // off-pitch: not a stance
        if (this.playersBySquare.has(squareKey(sq[0], sq[1]))) continue; // occupied — can't stand here
        anyOpenNeighbour = true;
        const path = this.o66AutoPath(attackerId, sq);
        if (path && path.length > 0 && (!best || path.length < best.length)) best = path;
      }
    if (best) return { status: 'PATH', path: best };
    return { status: anyOpenNeighbour ? 'OUT_OF_RANGE' : 'SURROUNDED', path: [] };
  }

  /** Owner o66ak: convert a CLIENT (screen) coordinate to a pitch square — for DRAG-AND-DROP setup placement,
   *  where a drop's clientX/clientY must map to a tile (the tap handlers use event.offsetX; a drop only carries
   *  client coords). Mirrors that projection: (client − canvasRect) − world.position, ÷ world.scale, worldToSquare.
   *  Returns null off the pitch. */
  clientToSquare(clientX: number, clientY: number): [number, number] | null {
    const canvas = this.app?.canvas as HTMLCanvasElement | undefined;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const worldX = ((clientX - rect.left) - this.world.position.x) / this.world.scale.x;
    const worldY = ((clientY - rect.top) - this.world.position.y) / this.world.scale.y;
    const [sx, sy] = worldToSquare(worldX, worldY);
    if (sx < 0 || sx >= PITCH_COLS || sy < 0 || sy >= PITCH_ROWS) return null;
    return [sx, sy];
  }

  /** Owner 08-17 (telestrator placement fix): CANVAS-LOCAL pixel (offsetX/Y-style — relative to
   *  the canvas element's own box, NOT the viewport) → WORLD pixel coordinate (continuous, not
   *  snapped to a square). Same projection as clientToSquare minus the final worldToSquare step
   *  and the client-rect subtraction (callers whose overlay shares the canvas's exact box —
   *  `position:absolute;inset:0` on `.pitch-host`, e.g. ReplayTelestrator — already have a
   *  canvas-local offset). Freehand annotations store WORLD points so they track the pitch
   *  itself (pan/zoom, orientation, flat/iso) instead of assuming a fixed unrotated 26×15 grid
   *  stretched over the host box, which is what actually placed shapes wrong at any zoom/pan or
   *  in the default NS projection (game x is the DEPTH axis there, not a flat horizontal one). */
  localToWorld(localX: number, localY: number): { x: number; y: number } {
    return {
      x: (localX - this.world.position.x) / this.world.scale.x,
      y: (localY - this.world.position.y) / this.world.scale.y,
    };
  }

  /** Inverse of localToWorld — a WORLD pixel coordinate → CANVAS-LOCAL pixel, for reprojecting a
   *  stored world-space annotation point onto the current camera pan/zoom every frame. */
  worldToLocal(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: this.world.position.x + worldX * this.world.scale.x,
      y: this.world.position.y + worldY * this.world.scale.y,
    };
  }

  /** Current camera scale (world → local pixels). Lets a WORLD-space stroke width (telestrator)
   *  track zoom the same way the points themselves do. */
  cameraScale(): number {
    return this.world.scale.x;
  }

  /**
   * Square click while a player is selected: extend the queued path (via the
   * shortest route), truncate it when clicking an existing step or the player's
   * own square, or clear the selection when clicking out of range.
   */
  private handleSquareClick(square: Square): void {
    if (!this.plannerEnabled) return; // B5-2: spectator-clean
    const info = this.selectionInfo();
    if (!info) return;
    const [px, py] = info.data.playerCoordinate!;
    if (square[0] === px && square[1] === py) {
      this.setPath([]);
      return;
    }
    const stepIndex = this.plannedPath.findIndex(([x, y]) => x === square[0] && y === square[1]);
    if (stepIndex >= 0) {
      this.setPath(this.plannedPath.slice(0, stepIndex + 1));
      return;
    }
    // O8 auto-pathing: extend from the last clicked square, avoiding dice
    const start: Square = this.plannedPath.length > 0 ? this.plannedPath[this.plannedPath.length - 1]! : [px, py];
    const extension = planPath(
      this.occupiedForPathing(),
      this.markedSquares(),
      start,
      square,
      this.plannedPath.length,
      info.normal,
      info.normal + info.rushes,
    );
    if (extension) {
      this.setPath([...this.plannedPath, ...extension]);
    } else {
      this.clearSelection();
    }
  }

  /**
   * O2/O3/O5 opponent-click routing (Q6: no dedicated Block button — the
   * preview raises contextually):
   * - adjacent standing defender, attacker standing + unmoved in Auto, or in
   *   Blitz mode → block dice preview; second click confirms (O3)
   * - moved without Blitz / Move declared → Q4 rejection tooltip
   * - otherwise → approach planning per mode (Q8: no-op when out of range)
   */
  private handleOpponentClick(defenderId: string, square: Square, canvasX: number, canvasY: number): void {
    if (!this.plannerEnabled) {
      // B5-2: spectator-clean — plain selection/card only, no dice preview
      this.selectPlayer(defenderId);
      this.onPlayerClick?.(defenderId, canvasX, canvasY);
      return;
    }
    const info = this.selectionInfo();
    if (!info || !this.game) return;
    // Owner 2026-07-04d: defense-in-depth — a block/approach needs a legal ACTOR
    // as the attacker (the acting team). If an opposition player is selected
    // (view-only), route the click as a fresh selection instead of a block.
    if (!this.selectedIsActor()) {
      this.selectPlayer(defenderId);
      this.onPlayerClick?.(defenderId, canvasX, canvasY);
      return;
    }
    // O3: the second click on the same defender confirms the armed block
    if (this.pendingBlock && this.pendingBlock.defenderId === defenderId) {
      const pending = this.pendingBlock;
      this.pendingBlock = null;
      this.redrawOverlays();
      this.onBlockConfirm?.(this.selectedPlayerId!, defenderId, pending.preview);
      return;
    }
    const mode = this.actionMode;
    if (mode === 'pass' || mode === 'handoff') return; // action doesn't involve opponents

    const end = this.getPathEnd()!;
    const adjacentToEnd = Math.max(Math.abs(end[0] - square[0]), Math.abs(end[1] - square[1])) === 1;
    const defenderData = this.game.fieldModel.playerDataArray.find((d) => d.playerId === defenderId);
    const defenderStanding = defenderData ? !isDown(defenderData.playerState) : false;
    const moved = this.plannedPath.length > 0;

    if (adjacentToEnd && defenderStanding && mode !== 'foul') {
      if (isDown(info.data.playerState) && mode !== 'blitz') {
        this.onActionRejected?.('Prone players must Blitz to block', canvasX, canvasY);
        return;
      }
      if (mode === 'blitz' || (mode === 'auto' && !moved)) {
        const preview = blockDicePreview(this.game, this.selectedPlayerId!, defenderId, moved ? end : undefined);
        if (preview) {
          this.pendingBlock = { defenderId, square, preview };
          this.redrawOverlays();
        }
        return;
      }
      // Q4 Option B: movement performed means Move was declared — no block
      const turnData = (this.selectedIsHome() ? this.game.turnDataHome : this.game.turnDataAway) as {
        blitzUsed?: boolean;
      };
      this.onActionRejected?.(turnData.blitzUsed ? 'Blitz already used' : 'Blitz was not declared', canvasX, canvasY);
      return;
    }
    // Owner 2026-07-04c: a clicked PRONE opponent in Foul mode arms the action
    // (auto-path to contact + the "Perform foul?" modal via onActionTarget).
    if (mode === 'foul' && !defenderStanding) {
      if (!this.armActionTarget(defenderId, square)) this.onActionRejected?.('Out of reach', canvasX, canvasY);
      return;
    }
    if (mode === 'auto' || mode === 'blitz' || mode === 'foul') this.pathTowardOpponent(square);
  }

  // --- Owner 2026-07-04c: FOUL / HAND-OFF / PASS interaction ---------------

  /** The roll-preview text for hovering/arming `targetId` in the given mode,
   *  or null when the target is not eligible (docs/passing-fouling-auras.md). */
  private actionRollText(mode: 'foul' | 'handoff' | 'pass', targetId: string): string | null {
    const g = this.game;
    if (!g || !this.selectedPlayerId || targetId === this.selectedPlayerId) return null;
    const data = g.fieldModel.playerDataArray.find((d) => d.playerId === targetId);
    if (!data || !isOnPitch(data.playerCoordinate)) return null;
    const targetIsHome = g.teamHome.playerArray.some((p) => p.playerId === targetId);
    const selIsHome = this.selectedIsHome();
    if (mode === 'foul') {
      if (targetIsHome === selIsHome || !isDown(data.playerState)) return null;
      // #73: prefer the view's authoritative foulArmourTargetAt for THIS victim over the local
      // foulTarget (leak class); fall back to local when the view hasn't wired setFoulTarget.
      const vc = data.playerCoordinate;
      const auth = this.foulArmourTarget;
      if (auth && vc && auth.square[0] === vc[0] && auth.square[1] === vc[1]) return `SKULL ${auth.target}+`;
      const end = this.getPathEnd() ?? undefined;
      const t = foulTarget(g, this.selectedPlayerId, targetId, end ?? undefined);
      return t == null ? null : `SKULL ${t}+`;
    }
    if (targetIsHome !== selIsHome || !hasTackleZones(data.playerState)) return null;
    const c = catchTarget(g, targetId);
    if (mode === 'handoff') return c == null ? null : `HAND ${c}+`;
    // pass: rolled from the path END (the thrower throws after moving)
    const from = this.getPathEnd();
    if (!from) return null;
    const passRoll = this.resolvedPassRoll(this.selectedPlayerId, from, [data.playerCoordinate![0], data.playerCoordinate![1]]);
    if (passRoll == null) return null;
    return `PASS ${passRoll}+ · CATCH ${c ?? '?'}+`;
  }

  /** Arm `targetId` for the current foul/handoff/pass action: auto-path to
   *  contact where the action needs adjacency, redraw the preview overlays
   *  (arrow / chips / interceptor tips) and notify the host modal. */
  private armActionTarget(targetId: string, square: Square): boolean {
    const mode = this.actionMode;
    if (mode !== 'foul' && mode !== 'handoff' && mode !== 'pass') return false;
    let rollText = this.actionRollText(mode, targetId);
    if (!rollText) return false;
    if (mode === 'foul' || mode === 'handoff') {
      const end = this.getPathEnd()!;
      if (Math.max(Math.abs(end[0] - square[0]), Math.abs(end[1] - square[1])) !== 1) {
        this.pathTowardOpponent(square); // owner: auto calculate the path to the player
        const arrived = this.getPathEnd()!;
        if (Math.max(Math.abs(arrived[0] - square[0]), Math.abs(arrived[1] - square[1])) !== 1) return false;
        rollText = this.actionRollText(mode, targetId) ?? rollText; // assists shift with the new square
      }
    }
    const seq = ++this.armedActionSeq;
    this.armedAction = { seq, mode, targetId, square: [square[0], square[1]], rollText };
    this.redrawOverlays();
    this.onActionTarget?.({ seq, mode, targetId, targetSquare: [square[0], square[1]], path: this.getPlannedPath(), rollText });
    return true;
  }

  /** True while a foul/handoff/pass target is armed (the confirm bar commits it). */
  hasArmedAction(): boolean {
    return this.armedAction !== null;
  }

  /** Commit the armed action (second click / modal Confirm / confirm bar). */
  confirmArmedAction(): void {
    const a = this.armedAction;
    if (!a) return;
    this.armedAction = null;
    const path = this.getPlannedPath();
    const selected = this.selectedPlayerId;
    this.clearSelection();
    if (selected) this.onActionConfirm?.({ mode: a.mode, actorId: selected, targetId: a.targetId, targetSquare: a.square, path });
  }

  /** Cancel the armed action (modal Cancel); keeps the selection + path. */
  cancelArmedAction(): void {
    // Always retire the host surface. A model/action-mode refresh may already have retired the renderer arm;
    // leaving the callback conditional made the still-mounted DOM card impossible to cancel or re-arm.
    this.armedAction = null;
    this.redrawOverlays();
    this.onActionTarget?.(null);
  }

  /** Cursor art while hovering an eligible action target. */
  private static SKULL_CURSOR = `url("${new URL('../assets/blockdice/face_skull.png', import.meta.url).href}") 12 12, crosshair`;
  private static HAND_CURSOR =
    'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'26\' height=\'26\'><text x=\'2\' y=\'20\' font-size=\'18\'>✋</text></svg>") 12 12, pointer';
  private actionCursorFor(mode: 'foul' | 'handoff' | 'pass'): string {
    if (mode === 'foul') return PitchRenderer.SKULL_CURSOR;
    if (mode === 'handoff') return PitchRenderer.HAND_CURSOR;
    return 'crosshair';
  }

  /**
   * O8: clicking an opposition player auto-paths to the best adjacent square
   * (fewest dice, then fewest steps), continuing from the path end. The
   * selection is kept — this is approach planning, not a selection switch.
   * Public: the right-click menus (Blitz/Foul/Special) plan through this too.
   */
  planApproach(opponentSquare: Square): void {
    this.pathTowardOpponent(opponentSquare);
  }

  /** Owner 2026-07-08 (FUMBBL Classic): show the block-dice COUNT over every
   *  adjacent standing opponent of `attackerId` — the block-target preview surfaced
   *  from the classic Block context menu. Pass null to clear. */
  showBlockTargets(attackerId: string | null, onlyTargetId: string | null = null): void {
    this.blockTargetsAttacker = attackerId;
    this.blockTargetsOnly = attackerId ? onlyTargetId : null;
    this.redrawOverlays();
  }

  setModelBlockDecorations(enabled: boolean): void {
    if (this.modelBlockDecorations === enabled) return;
    this.modelBlockDecorations = enabled;
    this.redrawOverlays();
  }

  setMaximumCarnageTargeting(enabled: boolean): void {
    if (this.maximumCarnageTargeting === enabled) return;
    this.maximumCarnageTargeting = enabled;
    this.redrawOverlays();
  }

  setFurySecondBlockTargeting(enabled: boolean): void {
    if (this.furySecondBlockTargeting === enabled) return;
    this.furySecondBlockTargeting = enabled;
    this.redrawOverlays();
  }

  /** #181/KG-6 (owner, Meero SR-161) — (a) RANGE box: arm the keg-throw REACH from the thrower's square. Drawn
   *  REGARDLESS of whether any target is legal, so an empty legal set reads as "throw is SHORT" not "keg is
   *  BROKEN" (the actual KG-6 fix). Deliberately SEPARATE from setKegTargets so the box survives a zero-legal
   *  set. ⚖ pure geometry (chebyshev-3, field-bounded), no rule, no app import. null = off. */
  setKegRange(from: [number, number] | null): void {
    this.kegThrowerSquare = from ? [from[0], from[1]] : null;
    this.redrawOverlays();
  }

  /** #181/KG-6 (owner, Meero SR-158) — (b) LEGALITY rings: `ids` = the legal targets the VIEW computed via
   *  `availableActions.kegTargetIds(game, throwerId)`. The renderer stays rule-free — it rings exactly the ids
   *  it's fed (⚖: no local distance/standing derivation, no app import — the #16/item-74 boundary; kegTargetIds
   *  lives in the app layer). null / empty clears the rings only (the range box is setKegRange's, independent).
   *  Rings, not squares — upstream reuses the walk-reach MoveSquare for keg range, which invites a stray
   *  clientMove misclick (Fives' KG catch); rings can't. */
  setKegTargets(ids: string[] | null): void {
    this.kegTargetSet = ids && ids.length ? new Set(ids) : null;
    this.redrawOverlays();
  }

  /** Arms the block preview for a defender (context-menu path into O2). */
  previewBlock(defenderId: string, canvasX = 0, canvasY = 0): boolean {
    if (!this.game || !this.selectedPlayerId) return false;
    const data = this.game.fieldModel.playerDataArray.find((d) => d.playerId === defenderId);
    if (!data || !isOnPitch(data.playerCoordinate)) return false;
    this.handleOpponentClick(defenderId, [data.playerCoordinate[0], data.playerCoordinate[1]], canvasX, canvasY);
    return this.pendingBlock !== null;
  }

  /** Q8: an approach (e.g. Blitz) is only offered when contact is reachable. */
  canApproach(opponentSquare: Square): boolean {
    const info = this.selectionInfo();
    if (!info) return false;
    const start = this.getPathEnd()!;
    if (Math.max(Math.abs(start[0] - opponentSquare[0]), Math.abs(start[1] - opponentSquare[1])) === 1) return true;
    const occupied = this.occupiedForPathing();
    const marked = this.markedSquares();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const target: Square = [opponentSquare[0] + dx, opponentSquare[1] + dy];
        if (target[0] < 0 || target[0] >= PITCH_COLS || target[1] < 0 || target[1] >= PITCH_ROWS) continue;
        if (occupied.has(squareKey(target[0], target[1]))) continue;
        if (planPath(occupied, marked, start, target, this.plannedPath.length, info.normal, info.normal + info.rushes)) {
          return true;
        }
      }
    }
    return false;
  }

  private pathTowardOpponent(opponentSquare: Square): void {
    const info = this.selectionInfo();
    if (!info) return;
    const [px, py] = info.data.playerCoordinate!;
    const start: Square = this.plannedPath.length > 0 ? this.plannedPath[this.plannedPath.length - 1]! : [px, py];
    if (Math.max(Math.abs(start[0] - opponentSquare[0]), Math.abs(start[1] - opponentSquare[1])) === 1) return;
    const occupied = this.occupiedForPathing();
    const marked = this.markedSquares();
    let best: { path: Square[]; rolls: number } | null = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const target: Square = [opponentSquare[0] + dx, opponentSquare[1] + dy];
        if (target[0] < 0 || target[0] >= PITCH_COLS || target[1] < 0 || target[1] >= PITCH_ROWS) continue;
        if (occupied.has(squareKey(target[0], target[1]))) continue;
        const path = planPath(occupied, marked, start, target, this.plannedPath.length, info.normal, info.normal + info.rushes);
        if (!path) continue;
        const rolls = this.countRolls(path, start, marked, info.normal, this.plannedPath.length);
        if (!best || rolls < best.rolls || (rolls === best.rolls && path.length < best.path.length)) {
          best = { path, rolls };
        }
      }
    }
    if (best) this.setPath([...this.plannedPath, ...best.path]);
  }

  /** Dice rolls (dodges + rushes) a path extension would cost. */
  private countRolls(path: Square[], start: Square, marked: ReadonlySet<string>, normal: number, stepsUsed: number): number {
    let rolls = 0;
    let from = start;
    path.forEach((square, i) => {
      if (marked.has(squareKey(from[0], from[1]))) rolls++;
      if (stepsUsed + i + 1 > normal) rolls++;
      from = square;
    });
    return rolls;
  }

  /** After a model refresh, drop path steps that became occupied. */
  private revalidatePath(): void {
    for (let i = 0; i < this.plannedPath.length; i++) {
      const [x, y] = this.plannedPath[i]!;
      if (this.playersBySquare.has(squareKey(x, y))) {
        this.plannedPath = this.plannedPath.slice(0, i);
        this.onPathChange?.(this.getPlannedPath(), this.selectedPlayerId);
        return;
      }
    }
  }

  /**
   * Upstream DialogKickSkillHandler.java:25-58 supplies both candidate landing squares. Draw them with the
   * crosshair reticle idiom and mark the Kick-reduced one with its skill glyph; the model ball stays untouched.
   */
  private drawKickSkillCandidates(): void {
    const candidates = this.kickSkillCandidates;
    if (!candidates) return;
    if (isOnPitch(candidates.ballCoordinate)) {
      const natural = this.buildPushCrosshair(candidates.ballCoordinate, 0x22d3ee, 0.8);
      natural.zIndex = 30;
      this.pathLayer.addChild(natural);
    }
    if (isOnPitch(candidates.ballCoordinateWithKick)) {
      const kick = this.buildPushCrosshair(candidates.ballCoordinateWithKick, 0xf5c542);
      const badge = this.buildSkillBadge('Kick', candidates.ballCoordinateWithKick);
      kick.zIndex = 30;
      badge.zIndex = 31;
      this.pathLayer.addChild(kick, badge); // above tokens so both candidates stay readable
    }
  }

  /** Paint the display-only cursor through the one keyed/fading movement-overlay registry. */
  private drawMovementPresentationOverlay(): void {
    const cursor = this.movementPresentationCursor;
    const acting = this.game?.actingPlayer as { playerId?: string | null; playerAction?: string | null } | undefined;
    if (cursor && acting?.playerId === cursor.playerId && isMovingPlayerAction(acting.playerAction)) {
      const reach = this.movementPresentationReach();
      const rushTarget = rushTargetForPlayer(this.game, cursor.playerId);
      for (const [sx, sy] of reach?.rush ?? []) {
        const key = squareKey(sx, sy);
        const quad = squareQuad(sx, sy);
        this.syncMovementOverlayNode(
          `reach:rush-shade:${key}`,
          'reach',
          `10132122:0.3:${quad.points.flat().join(',')}`,
          0,
          0,
          1,
          () => new Graphics().poly(quad.points.flat()).fill({ color: 0x9a9a9a, alpha: 0.3 }),
        );
        const a = this.tokenPos(sx, sy);
        const dieScale = depthScale(sx, sy) * 0.8; // owner 09-09: one rush die everywhere — 0.8 x depth, fully opaque
        this.syncMovementOverlayNode(
          `reach:rush-die:${key}`,
          'reach',
          `${dieScale}:${rushTarget}`,
          a.x,
          a.y,
          1,
          () => this.buildReachableRushDie(0, 0, dieScale, rushTarget),
          1,
        );
      }
      if (this.movementReachLayer.children.length > 0) this.overlayLayer.addChild(this.movementReachLayer);
    }
  }

  /** Golden halo + range shading + queued path with rush dice (O1/O8). */
  private movementOverlayFadeMs(): number { return presentationMs(REACH_FADE_OUT_MS); }

  private beginMovementOverlayFrame(): void {
    const acting = this.game?.actingPlayer as { playerId?: string | null; playerAction?: string | null } | undefined;
    const owner = acting?.playerId === this.activePlayerId && isMovingPlayerAction(acting.playerAction)
      ? acting.playerId
      : null;
    if (owner !== this.movementOverlayOwner) {
      this.flushMovementOverlay();
      this.movementOverlayOwner = owner;
    }
    this.movementOverlaySeen.clear();
  }

  private syncMovementOverlayNode(
    key: string,
    layer: MovementOverlayLayer,
    signature: string,
    x: number,
    y: number,
    alpha: number,
    build: () => Container,
    zIndex = 0,
  ): void {
    this.movementOverlaySeen.add(key);
    let entry = this.movementOverlayNodes.get(key);
    const fading = this.movementOverlayFades.get(key);
    if (!entry && fading && !fading.entry.node.destroyed) {
      entry = fading.entry;
      this.movementOverlayFades.delete(key);
      this.movementOverlayNodes.set(key, entry);
    }
    if (entry && entry.layer !== layer) {
      entry.node.parent?.removeChild(entry.node);
      entry.node.destroy({ children: true });
      this.movementOverlayNodes.delete(key);
      entry = undefined;
    }
    const parent = layer === 'reach' ? this.movementReachLayer : this.movementPathCostLayer;
    if (layer === 'reach') parent.sortableChildren = true;
    if (!entry) {
      const node = new Container();
      node.eventMode = 'none';
      node.addChild(build());
      entry = { node, layer, signature };
      this.movementOverlayNodes.set(key, entry);
      parent.addChild(node);
    } else if (entry.signature !== signature) {
      for (const child of entry.node.removeChildren()) child.destroy({ children: true });
      entry.node.addChild(build());
      entry.signature = signature;
    }
    if (entry.node.parent !== parent) parent.addChild(entry.node);
    if (entry.node.zIndex !== zIndex) entry.node.zIndex = zIndex;
    if (entry.node.x !== x || entry.node.y !== y) entry.node.position.set(x, y);
    if (entry.node.alpha !== alpha) entry.node.alpha = alpha;
  }

  private finishMovementOverlayFrame(): void {
    const now = performance.now();
    const fadeMs = this.movementOverlayFadeMs();
    for (const [key, entry] of [...this.movementOverlayNodes]) {
      if (this.movementOverlaySeen.has(key)) continue;
      this.movementOverlayNodes.delete(key);
      entry.node.eventMode = 'none';
      if (fadeMs <= 0 || entry.node.destroyed) {
        entry.node.parent?.removeChild(entry.node);
        if (!entry.node.destroyed) entry.node.destroy({ children: true });
      } else {
        this.movementOverlayFades.set(key, { entry, from: entry.node.alpha, start: now });
      }
    }
    this.movementOverlaySeen.clear();
  }

  private flushMovementOverlay(): void {
    for (const layer of [this.movementReachLayer, this.movementPathCostLayer]) {
      for (const child of layer.removeChildren()) child.destroy({ children: true });
    }
    this.movementOverlayNodes.clear();
    this.movementOverlayFades.clear();
    this.movementOverlaySeen.clear();
    this.movementOverlayOwner = null;
  }

  /** Modern reachable-square costs are projection art, not token generation. Keeping them on pathLayer lets
   * every offer/roll frame redraw cheaply while a long route's live token tween remains completely untouched. */
  private drawO66MovementReachCosts(): void {
    if (this.tilePickSkill !== 'order66-move' || !this.tilePickEligible) return;
    const actorId = String(
      (this.game?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? this.selectedPlayerId ?? '',
    );
    const presentationOwnsMoveArt = this.movementPresentationCursor?.playerId === actorId;
    if (presentationOwnsMoveArt) return;
    const fallbackRushTarget = rushTargetForPlayer(this.game, actorId);
    for (const key of this.tilePickEligible) {
      const rolls = this.tilePickRolls?.get(key);
      const legacyRush = this.tilePickGfi?.has(key) ?? false;
      if (!rolls && !legacyRush) continue;
      const [sx, sy] = key.split(',').map(Number) as [number, number];
      const a = this.tokenPos(sx, sy);
      const ds = depthScale(sx, sy);
      if (rolls) {
        const both = rolls.dodge > 0 && rolls.gfi > 0;
        if (rolls.dodge > 0) {
          const chip = this.buildDodgeChip(a.x + (both ? -9 * ds : 0), a.y, ds * 0.5, rolls.dodge);
          chip.alpha = 0.9;
          this.pathLayer.addChild(chip);
        }
        if (rolls.gfi > 0) {
          this.pathLayer.addChild(
            this.buildReachableRushDie(a.x + (both ? 10 * ds : 0), a.y, ds * 0.8, rolls.gfi || fallbackRushTarget),
          );
        }
      } else if (legacyRush) {
        this.pathLayer.addChild(this.buildReachableRushDie(a.x, a.y, ds * 0.8, fallbackRushTarget));
      }
    }
  }

  private redrawOverlays(): void {
    this.beginMovementOverlayFrame();
    try {
    // destroy, don't detach — leaked Text/Graphics were the W-3 heap finding
    const hoverSquareMarker = this.hoverSquareMarker;
    if (hoverSquareMarker && !hoverSquareMarker.destroyed) this.overlayLayer.removeChild(hoverSquareMarker);
    this.movementReachLayer.parent?.removeChild(this.movementReachLayer);
    this.movementPathCostLayer.parent?.removeChild(this.movementPathCostLayer);
    for (const child of this.overlayLayer.removeChildren()) child.destroy({ children: true });
    this.blockDiceSprites = []; // clear ticker-visible references before destruction
    this.blockPreviewSquares = [];
    this.blockPreviewDecorKey = null;
    for (const child of this.pathLayer.removeChildren()) child.destroy({ children: true });
    if (hoverSquareMarker && !hoverSquareMarker.destroyed) this.overlayLayer.addChild(hoverSquareMarker);
    if (this.movementReachLayer.children.length > 0) this.overlayLayer.addChild(this.movementReachLayer);
    if (this.movementPathCostLayer.children.length > 0) this.pathLayer.addChild(this.movementPathCostLayer);
    this.drawMovementPresentationOverlay();
    this.drawO66MovementReachCosts();
    this.drawKickSkillCandidates();
    // Block-target preview (classic context-menu Block): dice-count over adjacent
    // opponents — drawn regardless of the planner gate below (spectator-safe).
    this.drawBlockTargets();
    // Owner o66ah #9 FIX: the o66 COACH's configured tackle zones are drawn HERE (inside redrawOverlays, AFTER
    // the overlayLayer clear above) — NOT in drawPlayerPick, which runs BEFORE this clear in refresh(), so a shade
    // added there was destroyed every frame. Owner 2026-07-13: decoupled from the move overlay (tilePickSkill/
    // eligible) — the zones now show ON SELECT (o66OppTzActive, set by the host on my-turn selection), not only
    // once the move overlay is armed / a waypoint plotted. selectedIsHome from the ACTING player (server-absolute
    // teamHome, not viewer).
    this.drawO66TackleZones();
    // Owner 2026-07-13: BALL & CHAIN aim arrows (drawn on overlayLayer, cleared with it each redraw).
    this.drawBncAim();
    this.drawJumpCrosshairs();
    this.drawPassDestinationMarker();
    this.drawPassRuler();
    // #151: pass rolls-required cues (throw over passer / catch over target) — server-fed, cleared with the layer.
    this.drawPassRollCues();
    this.drawChompCue();
    // Owner o66 automove PREVIEW: draw the pending route (a trail through the square centres + a dot per step,
    // a brighter ring on the destination) BEFORE the legacy planner gate — plannerEnabled is off in o66. The
    // host passes [from, ...route]; the start square gets no dot. Minimal by design (owner tunes on return).
    if (this.o66PathSquares.length > 1) {
      const pts = this.o66PathSquares.map(([sx, sy]) => this.tokenPos(sx, sy));
      const line = new Graphics();
      pts.forEach((p, i) => (i === 0 ? line.moveTo(p.x, p.y) : line.lineTo(p.x, p.y)));
      line.stroke({ color: 0x66ccff, alpha: 0.7, width: 3 });
      // Intermediate steps: small dots. The route START gets none. The DESTINATION carries the
      // confirm crosshair below (owner g478: crosshair = the confirm marker), so no dot there.
      pts.forEach((p, i) => {
        if (i === 0 || i === pts.length - 1) return;
        line.circle(p.x, p.y, 4).fill({ color: 0x66ccff, alpha: 0.72 });
      });
      this.overlayLayer.addChild(line);
      // Owner o66m+ (#9/#10/#11): stamp the per-step COST along the auto-path — a "D N+" dodge chip on each step
      // that LEAVES an opposition tackle zone, and a rush die on each step beyond normal MA. Client geometry
      // (the server sends no reach); the server still validates each step. Needs the mover for budget + marks.
      if (this.o66PathMover) {
        const b = this.o66MovementBudget(this.o66PathMover);
        const moverIsHome = this.game?.teamHome.playerArray.some((p) => p.playerId === this.o66PathMover) ?? false;
        const moverPlayer = [...(this.game?.teamHome.playerArray ?? []), ...(this.game?.teamAway.playerArray ?? [])].find((p) => p.playerId === this.o66PathMover);
        const oppCounts = this.tackleZoneCounts(moverIsHome).opposition; // key → # opponents marking
        const rushTarget = rushTargetForPlayer(this.game, this.o66PathMover);
        if (b && moverPlayer) {
          const persistentPath = this.movementOverlayOwner === this.o66PathMover;
          if (persistentPath) this.pathLayer.addChild(this.movementPathCostLayer);
          const agility = Number((moverPlayer as { agility?: number }).agility) || 3;
          // base + TEMPORARY skills (shared protocol decoder) — a prayer/card grant answers rules checks too
          const moverHasSkill = (name: string) => playerHasSkill(moverPlayer, name);
          const moverHasStunty = moverHasSkill('stunty');
          const moverHasTitchy = moverHasSkill('titchy');
          // #77 (owner batch §N): a pickup is required whenever a move step LANDS ON the loose ball
          // (ballInPlay && !ballMoving — a carrier's square is occupied so can't be a move target). We only
          // DETECT that square here for chip placement; the difficulty NUMBER comes from the view's
          // authoritative pickupTargetAtBall (setPickupTarget), never a local formula (the leak class).
          const fm = this.game?.fieldModel;
          const ballSq = fm?.ballInPlay && !fm?.ballMoving ? (fm?.ballCoordinate as [number, number] | undefined) : undefined;
          const ballKey = ballSq ? `${ballSq[0]},${ballSq[1]}` : null;
          // path is [from, ...route]; step k (1..n) lands on o66PathSquares[k], leaving o66PathSquares[k-1].
          // ⚑ SR-108 cross-ref: the #150 plot-number loop below walks this SAME array anchored on the square
          // DEPARTED (k=0..n-1, label k+1) — the opposite anchor, and deliberately so. A COST chip belongs on
          // the square entered (the roll is owed for moving in); a move NUMBER rides the square left. Don't
          // reconcile the two indexings.
          for (let k = 1; k < this.o66PathSquares.length; k++) {
            const [dx, dy] = this.o66PathSquares[k]!;
            const [fx, fy] = this.o66PathSquares[k - 1]!;
            const dodge = oppCounts.has(`${fx},${fy}`); // leaving a marked square rolls a dodge
            const rush = k > b.normal; // steps beyond normal MA need a Go-For-It (2+, 3+ blizzard)
            const stepKey = `${dx},${dy}`;
            const pickup = ballKey === stepKey; // this step lands on the loose ball → pickup roll
            if (!dodge && !rush && !pickup) continue;
            const a = this.tokenPos(dx, dy);
            const ds = depthScale(dx, dy);
            const both = dodge && rush;
            // Owner o66p #8: lift the cost chips ABOVE the square's top edge (were sitting ON the square).
            const cy = a.y - TILE_H * 0.5 * ds;
            if (dodge) {
              // Upstream BB2025 citations:
              // ffb-common/src/main/java/com/fumbbl/ffb/factory/DodgeModifierFactory.java
              // (DodgeModifierFactory#numberOfTacklezones/#isAffectedByTackleZones) counts destination marks
              // and drops them for an uncancelled Stunty property;
              // ffb-common/src/main/java/com/fumbbl/ffb/skill/mixed/Stunty.java (Stunty#postConstruct)
              // supplies it. ffb-common/src/main/java/com/fumbbl/ffb/skill/mixed/Titchy.java
              // (Titchy#postConstruct) registers the mover's -1 DodgeModifier.
              const destMarks = oppCounts.get(`${dx},${dy}`) ?? 0;
              const target = Math.min(
                6,
                Math.max(2, agility + (moverHasStunty ? 0 : destMarks) - (moverHasTitchy ? 1 : 0)),
              );
              // Owner o66aq: the path COST chips (dodge / rush) belong ABOVE the tokens (pathLayer), not overlayLayer
              // (which sits UNDER tokenLayer — the chips were being occluded by players/shading; "rushes don't
              // surface"). pathLayer is the same over-tokens layer the block-dice dots already use, cleared each frame.
              if (persistentPath) {
                this.syncMovementOverlayNode(
                  `o66-path:dodge:${stepKey}`,
                  'path',
                  `${target}:${ds}`,
                  a.x + (both ? -9 * ds : 0),
                  cy,
                  0.95,
                  () => this.buildDodgeChip(0, 0, ds * 0.5, target),
                );
              } else {
                const chip = this.buildDodgeChip(a.x + (both ? -9 * ds : 0), cy, ds * 0.5, target);
                chip.alpha = 0.95; this.pathLayer.addChild(chip);
              }
            }
            if (rush) {
              const target = rushTarget;
              if (persistentPath) {
                this.syncMovementOverlayNode(
                  `o66-path:rush:${stepKey}`,
                  'path',
                  `${target}:${ds}`,
                  a.x + (both ? 10 * ds : 0),
                  cy,
                  1,
                  () => this.buildRollDie(0, 0, ds * 0.8, target), // owner 09-09: 0.8 x depth like the reach dice
                );
              } else {
                const die = this.buildRollDie(a.x + (both ? 10 * ds : 0), cy, ds * 0.8, target);
                die.alpha = 1; this.pathLayer.addChild(die); // owner 09-08: planned rush die fully opaque
              }
            }
            if (pickup) {
              // #77: draw the pickup chip using the view's authoritative pickupTargetAtBall (setPickupTarget),
              // not a local calc — and only when it matches THIS ball square (the mover is planning this pickup).
              const pt = this.pickupTarget;
              if (pt && pt.square[0] === dx && pt.square[1] === dy) {
                // sits below the square (opposite the dodge/rush chips above) so a ball-square with both reads clearly.
                const py2 = a.y + TILE_H * 0.5 * ds;
                const chip = this.buildPickupChip(a.x, py2, ds * 0.5, pt.target);
                chip.alpha = 0.95; this.pathLayer.addChild(chip);
              }
            }
          }
        }
      }
      // #150 (owner g759): stamp a 1-based MOVE NUMBER in the bottom-right corner of each traveled
      // square. VIEW-DERIVED ordinal along the ordered plot per Tarkin's #150 contract (a plot not yet
      // SENT has no server frame stream, so this labels the user's own plot, not predicted state).
      // Drawn to pathLayer (above tokens, like the cost chips) so the corner glyph isn't occluded.
      // ⚑ #186 (owner live-test, RULED = ENTERED-anchored; MN-1 EXPLICITLY REVERSED — owner: "I recognize
      // this and was wrong"): anchor on the square ENTERED, not departed — the ORIGIN carries NO number and
      // the FIRST square traveled reads 1, counting up along the path (walk S→A→B→C reads A=1,B=2,C=3, S bare).
      // This restores the pre-MN-1 (`1fb9eca0`) shape. The #119 EXECUTED trail is flipped to entered in the SAME
      // change (setPresentationStep's `addTrailNumber(step.to…)` Path A + the Path-B `moveTrailCount` site below),
      // so preview and executed trail agree tile-for-tile and digit-for-digit on the ENTERED anchor. The
      // DESTINATION is now numbered (it is a traveled square) and ALSO carries the confirm crosshair below —
      // both coexist, exactly as they did pre-MN-1. The loop runs k=1..length-1 and never reads element 0.
      // ⚑ SR-108 cross-ref: the dodge/rush/pickup COST-CHIP loop above walks this SAME array and shares the
      // ENTERED anchor (k=1..n on `o66PathSquares[k]`, reading [k-1] only for the leaving-a-TZ dodge check). They
      // remain SEPARATE concerns — a chip is the roll owed for moving INTO a square, a number is the path ordinal —
      // so do NOT fold them even though the anchor now matches.
      // ⚑ #194 (owner spectate-check v3): TWO changes over #186 — ① the ORIGIN is now numbered `0` (loop starts at
      // k=0, each square's number = movement already used + its 0-based index) · ② SUPPRESS the digit on the square a player currently
      // OCCUPIES in the model (`playersBySquare`, server truth, not the tween) — so the number under the piece
      // hides and the origin's total count shows only once the player has left it. Planner is redrawn per-frame, so the skip
      // is naturally dynamic; the executed trail mirrors it via the per-frame visibility toggle in refresh().
      const used = this.o66PathMover ? (this.o66MovementBudget(this.o66PathMover)?.used ?? 0) : 0;
      for (let k = 0; k < this.o66PathSquares.length; k++) {
        const [nx, ny] = this.o66PathSquares[k]!;
        if (this.playersBySquare.has(`${nx},${ny}`)) continue; // occupied in the model → no digit under the piece
        const num = this.buildPlotStepNumber(nx, ny, used + k);
        this.pathLayer.addChild(num);
      }
      // Owner g478: the plotted destination is the CONFIRM target — mark it with the crosshair reticle
      // (a 2nd click on this square commits the move). This is the only crosshair in o66 automove.
      const dest = this.o66PathSquares[this.o66PathSquares.length - 1]!;
      const cross = this.buildPushCrosshair(dest);
      cross.scale.set(cross.scale.x * 0.8); // owner o66p #9: destination crosshair 20% smaller
      cross.zIndex = 5; // above the trail
      this.overlayLayer.addChild(cross);
    }
    // #181/KG-6 (owner, Meero SR-158/SR-161): the keg-throw affordance — TWO parts. Drawn HERE (before the
    // plannerEnabled gate) so it shows in o66 PLAY (plannerEnabled is off there; the classic foul/handoff
    // rings below the gate never run in play).
    // #181/KG-6 (owner, Meero SR-158/SR-161): the keg-throw affordance — TWO INDEPENDENT parts (SR-161).
    // (a) RANGE BOX — chebyshev-3 around the thrower, EXCLUDING his own square, drawn whenever the thrower is
    // armed REGARDLESS of legal targets (an empty legal set must still show the reach, so a coach reads "throw
    // is short" not "keg is broken"). ⚖ pure geometry, no rule. The 0..PITCH_COLS/0..PITCH_ROWS loop is the
    // explicit field bound (KT-2: the dugout is inside chebyshev range of the pitch edge — it sits at negative
    // x, so iterating only on-field squares excludes it). Shaded quad, mirrors drawPassTemplate.
    if (this.kegThrowerSquare) {
      const [fx, fy] = this.kegThrowerSquare;
      const box = new Graphics();
      for (let sx = 0; sx < PITCH_COLS; sx++) {
        for (let sy = 0; sy < PITCH_ROWS; sy++) {
          if (sx === fx && sy === fy) continue; // KT-1: exclude the thrower's own square
          if (Math.max(Math.abs(sx - fx), Math.abs(sy - fy)) > 3) continue; // chebyshev-3 reach
          box.poly(squareQuad(sx, sy).points.flat()).fill({ color: 0xffb020, alpha: 0.12 });
        }
      }
      this.overlayLayer.addChild(box);
    }
    // (b) LEGALITY RINGS — over the view-fed legal targets (kegTargetIds). INDEPENDENT of the box: present iff
    // there are legal targets. Amber, distinct from foul (purple) / handoff (green). Drawn before the
    // plannerEnabled gate so both show in o66 PLAY (the classic foul/handoff rings below the gate never run there).
    if (this.kegTargetSet) {
      const keg = this.kegTargetSet;
      this.drawTargetRings((data) => keg.has(data.playerId), 0xffb020);
      // #229 (owner): reuse the push-arrow primitive to point from the thrower to every legal keg target.
      if (this.kegThrowerSquare) {
        const kegThrower = this.kegThrowerSquare;
        const eligibleTargets = new Map<string, [number, number]>();
        for (const data of this.game!.fieldModel.playerDataArray) {
          if (keg.has(data.playerId) && data.playerCoordinate) eligibleTargets.set(data.playerId, data.playerCoordinate);
        }
        for (const targetCoord of eligibleTargets.values()) {
          const arrow = this.pushArrowGraphic(kegThrower, targetCoord, { color: 0xffb020 });
          arrow.alpha = 0.9;
          this.overlayLayer.addChild(arrow);
        }
      }
    }
    // Owner 2026-07-04c: aura shading draws in 'always' mode even with nothing
    // selected (the 'selected' mode filters to the selection inside drawAuras).
    this.drawAuras();
    const info = this.selectionInfo();
    if (!info) return;
    // Order 66 disables the command planner in live play, but selecting an opposing player is a
    // read-only inspection surface. Let that selection reuse the ordinary full movement overlay;
    // it remains non-interactive because selectedIsActor() is false and the host owns all sends.
    // Owner 09-06: SPECTATORS (planner off, o66 flag off) inspect the same way — a click reveals the player's
    // movement reach. Only the acting player's own o66 selection in play keeps the host-owned surface.
    if (!this.plannerEnabled && this.order66 && this.selectedIsActor()) return;
    const [px, py] = info.data.playerCoordinate!;

    // Static click-selection yields to the shared active aura on identity overlap; otherwise both semantics layer.
    const anchor = squareAnchor(px, py);
    const scale = depthScale(px, py);
    if (staticSelectionHaloVisible(this.selectedPlayerId, this.activePlayerId)) {
      const halo = new Graphics();
      for (const [radius, alpha] of [[0.62, 0.16], [0.5, 0.28], [0.4, 0.5]] as [number, number][]) {
        halo.ellipse(anchor.x, anchor.y - 3, TILE_W * radius * scale, TILE_H * radius * 0.72 * scale)
          .fill({ color: 0xf5c542, alpha });
      }
      this.overlayLayer.addChild(halo);
    }

    // O5 mode overlays: Pass shows the range template instead of movement
    // range; Foul/Handoff ring their legal target players
    if (this.actionMode === 'pass') {
      this.drawPassTemplate([px, py]);
      const selectedIsHomePass = this.selectedIsHome();
      this.drawTackleZones(selectedIsHomePass);
      this.drawArmedAction(); // owner 2026-07-04c: pass arrow + chips + interceptor tips
      return;
    }
    if (this.actionMode === 'bomb') {
      this.drawPassTemplate([px, py]); // bombs use the pass range ruler
      this.drawBombTarget(); // owner 2026-07-04d: the 3×3 blast preview
      return;
    }
    if (this.actionMode === 'foul') {
      this.drawTargetRings((data, isOpposition) => isOpposition && isDown(data.playerState), 0xb04ad0);
    } else if (this.actionMode === 'handoff') {
      this.drawTargetRings((data, isOpposition) => !isOpposition && hasTackleZones(data.playerState), 0x40c060);
    }
    // Owner 2026-07-04c: armed foul/handoff/pass preview (arrow, roll chips,
    // interceptor tips) draws over the mode overlays.
    this.drawArmedAction();

    // Owner 2026-07-04e: range shading recalculated from the END of the queued
    // path (each plot re-derives it). For MY player (a legal ACTOR) we DON'T
    // shade every reachable square — only the RUSH squares are shaded (the
    // opposition tackle zones carry the rest of the read). For an OPPOSITION
    // player being INSPECTED (view-only), we shade the FULL movement range so
    // the coach can see how far that enemy can reach.
    const isActor = this.selectedIsActor();
    // Owner 09-06: with the planner OFF (spectate, replay, o66 play) every selection is an INSPECTION — the
    // "actor: rush squares only" read below is the command planner's, and it left a spectator's click on the
    // acting side's players showing nothing at all (no declared move phase => no squares).
    const actorRushOnly = isActor && this.plannerEnabled;
    const action = (this.game!.actingPlayer as { playerId?: string; playerAction?: string | null } | undefined)?.playerId === this.activePlayerId
      ? ((this.game!.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? null)
      : null;
    // #215 (owner) + MG-1 (Meero): only declared MOVE phases surface an actor's rush overlay.
    // Mirror upstream PlayerAction.isMoving() EXACTLY (ffb-common PlayerAction.java:68) — the earlier
    // endsWith('Move') heuristic under-covered kickEmBlitz + secureTheBall (moving, no 'Move' suffix).
    const actorHasMovePhase = isMovingPlayerAction(action);
    const presentationOwnsActorReach = isActor && actorHasMovePhase
      && this.movementPresentationCursor?.playerId === this.selectedPlayerId;
    const used = this.plannedPath.length;
    const start: Square = used > 0 ? this.plannedPath[used - 1]! : [px, py];
    const remaining = info.normal + info.rushes - used;
    // Owner 09-06: a NON-actor selection shows its reach only while NO activation is live — picking a block target
    // selects the opposition player, and its move squares surfaced under the attacker's action.
    // owner 09-06: spectators/replays reveal the move distance on ANY click — the guard is for the playing seat only
    const selectionReachAllowed = isActor || this.activePlayerId == null || this.presentationMode !== 'live';
    const reach = presentationOwnsActorReach || !selectionReachAllowed || remaining <= 0
      ? { costs: new Map<string, number>() }
      : reachableSquares(this.occupiedForPathing(), start, remaining);
    const persistentReach = isActor && actorHasMovePhase && this.movementOverlayOwner === this.selectedPlayerId;
    const shade = persistentReach ? null : new Graphics();
    if (persistentReach) this.overlayLayer.addChild(this.movementReachLayer);
    for (const [key, cost] of reach.costs) {
      const [sx, sy] = key.split(',').map(Number) as [number, number];
      const total = used + cost;
      const rush = total > info.normal;
      if (actorRushOnly && (!rush || !actorHasMovePhase)) continue; // actor (planner on): rush squares only
      const quad = squareQuad(sx, sy);
      // Owner 2026-07-08: rush squares read NEUTRAL grey (matches the spectator reach); the
      // inspection full-range pale-yellow (non-rush) is unchanged.
      const color = rush ? 0x9a9a9a : 0xf5e6a0;
      const tileAlpha = rush ? 0.3 : 0.28;
      if (persistentReach) {
        this.syncMovementOverlayNode(
          `reach:${rush ? 'rush-shade' : 'tile'}:${key}`,
          'reach',
          `${color}:${tileAlpha}:${quad.points.flat().join(',')}`,
          0,
          0,
          1,
          () => new Graphics().poly(quad.points.flat()).fill({ color, alpha: tileAlpha }),
        );
      } else {
        shade!.poly(quad.points.flat()).fill({ color, alpha: tileAlpha });
      }
    }
    if (shade) this.overlayLayer.addChild(shade);

    // rush dice on the range squares beyond MA (BB3 convention)
    const reachRushTarget = rushTargetForPlayer(this.game, this.selectedPlayerId);
    for (const [key, cost] of reach.costs) {
      if (actorRushOnly && !actorHasMovePhase) continue;
      if (used + cost <= info.normal) continue;
      const [sx, sy] = key.split(',').map(Number) as [number, number];
      const a = squareAnchor(sx, sy);
      const dieScale = depthScale(sx, sy) * 0.8; // owner 09-09: one rush die everywhere — 0.8 x depth, fully opaque
      if (persistentReach) {
        this.syncMovementOverlayNode(
          `reach:rush-die:${key}`,
          'reach',
          `${dieScale}:${reachRushTarget}`,
          a.x,
          a.y,
          1,
          () => this.buildReachableRushDie(0, 0, dieScale, reachRushTarget),
          1,
        );
      } else {
        this.overlayLayer.addChild(this.buildReachableRushDie(a.x, a.y, dieScale, reachRushTarget));
      }
    }

    // tackle zones (Match11/O9). Owner 2026-07-04e: MY player shows the zones
    // that threaten it (the setting, default opposition); an INSPECTED opposition
    // player shows its FRIENDLY zones (its own team's control).
    const selectedIsHome = this.game!.teamHome.playerArray.some((p) => p.playerId === this.selectedPlayerId);
    this.drawTackleZones(selectedIsHome, isActor ? undefined : 'friendly');

    // armed block preview (O2), drawn over everything
    this.drawBlockPreview();
    this.drawPlannedBlitzRushChip();

    // queued path: connecting line + numbered steps; rush dice and dodge
    // chips render with PRIORITY over the players (owner 2026-07-02)
    if (this.plannedPath.length > 0) {
      const persistentPlannedPath = this.movementOverlayOwner === this.selectedPlayerId;
      const oppositionCounts = this.tackleZoneCounts(this.selectedIsHome()).opposition;
      const line = new Graphics();
      let prev = squareAnchor(px, py);
      line.moveTo(prev.x, prev.y - 3);
      for (const [sx, sy] of this.plannedPath) {
        const a = squareAnchor(sx, sy);
        line.lineTo(a.x, a.y - 3);
        prev = a;
      }
      line.stroke({ color: 0xf5c542, width: 2.5, alpha: 0.85 });
      this.pathLayer.addChild(line);
      if (persistentPlannedPath) this.pathLayer.addChild(this.movementPathCostLayer);

      let fromSquare: Square = [px, py];
      this.plannedPath.forEach(([sx, sy], i) => {
        const a = squareAnchor(sx, sy);
        const stepScale = depthScale(sx, sy);
        const rush = i + 1 > info.normal;
        // BB2025: leaving a marked square is a dodge; the modifier is −1 per
        // opponent marking the DESTINATION square
        const dodge = oppositionCounts.has(squareKey(fromSquare[0], fromSquare[1]));
        const destMarks = oppositionCounts.get(squareKey(sx, sy)) ?? 0;
        if (this.jumpSteps.has(i)) {
          // jump over a downed player: AG test, modified by markers of the
          // square jumped from AND the landing square (FGUR p.23)
          const sourceMarks = oppositionCounts.get(squareKey(fromSquare[0], fromSquare[1])) ?? 0;
          const target = Math.min(6, Math.max(2, info.player.agility + sourceMarks + destMarks));
          this.pathLayer.addChild(this.buildJumpChip(a.x, a.y - 3, stepScale, target));
          fromSquare = [sx, sy];
          return;
        }
        if (rush) {
          const target = rushTargetForPlayer(this.game, this.selectedPlayerId);
          if (persistentPlannedPath) {
            this.syncMovementOverlayNode(
              `planned-path:rush:${sx},${sy}`,
              'path',
              `${target}:${stepScale}`,
              a.x + (dodge ? -11 * stepScale : 0),
              a.y - 3,
              1,
              () => this.buildRollDie(0, 0, stepScale, target),
            );
          } else {
            this.pathLayer.addChild(
              this.buildRollDie(a.x + (dodge ? -11 * stepScale : 0), a.y - 3, stepScale, target),
            );
          }
        } else if (!dodge) {
          const marker = new Graphics()
            .circle(a.x, a.y - 3, 8 * stepScale)
            .fill({ color: 0x14161a, alpha: 0.85 })
            .circle(a.x, a.y - 3, 8 * stepScale)
            .stroke({ color: 0xf5c542, width: 1.5 });
          this.pathLayer.addChild(marker);
          const nr = new Text({ text: String(info.used + i + 1), style: BADGE_STYLE });
          nr.anchor.set(0.5, 0.5);
          nr.scale.set(stepScale);
          nr.position.set(a.x, a.y - 3);
          this.pathLayer.addChild(nr);
        }
        if (dodge) {
          // dodge target = AG + 1 per opponent marking the DESTINATION
          // square (BB2025); natural 1 fails / 6 succeeds → clamp 2+..6+
          const target = (() => {
            // #232 (owner): step 1 is server-verbatim; later steps assume worst-case Diving Tackle.
            if (i === 0) {
              // ⚖ normalize the coordinate the way the proven server readers do (availableActions.normSquare):
              // moveSquareArray.coordinate is `unknown` — a [x,y] tuple OR an {x,y} object per wire format —
              // so a raw index would silently miss (and drop the DT-correct server value) on the {x,y} variant.
              const serverSquare = (
                this.game!.fieldModel.moveSquareArray as { coordinate: unknown; minimumRollDodge: number }[]
              ).find((entry) => {
                const c = entry.coordinate;
                const ex = Array.isArray(c) ? Number(c[0]) : Number((c as { x?: number } | null)?.x);
                const ey = Array.isArray(c) ? Number(c[1]) : Number((c as { y?: number } | null)?.y);
                return ex === sx && ey === sy;
              });
              return serverSquare && serverSquare.minimumRollDodge > 0
                ? serverSquare.minimumRollDodge
                : Math.min(6, Math.max(2, info.player.agility + destMarks));
            }
            const selectedIsHome = this.selectedIsHome();
            const homeIds = new Set(this.game!.teamHome.playerArray.map((p) => p.playerId));
            const skillsById = new Map<string, string[]>();
            for (const p of [...this.game!.teamHome.playerArray, ...this.game!.teamAway.playerArray]) {
              skillsById.set(p.playerId, playerSkillNames(p)); // base + temporary
            }
            const hasAdjacentDivingTackle = this.game!.fieldModel.playerDataArray.some((d) => {
              if (!isOnPitch(d.playerCoordinate) || isDown(d.playerState)) return false;
              if (homeIds.has(d.playerId) === selectedIsHome) return false;
              const [dx, dy] = d.playerCoordinate;
              if (Math.max(Math.abs(dx - fromSquare[0]), Math.abs(dy - fromSquare[1])) > 1) return false;
              return (skillsById.get(d.playerId) ?? []).some(
                (s) => s.toLowerCase().replace(/[^a-z]/g, '') === 'divingtackle',
              );
            });
            const dtAdj = hasAdjacentDivingTackle ? 2 : 0;
            const moverHasSkill = (name: string) => playerHasSkill(info.player, name);
            // Upstream BB2025 citations:
            // ffb-common/src/main/java/com/fumbbl/ffb/factory/DodgeModifierFactory.java
            // (DodgeModifierFactory#numberOfTacklezones/#isAffectedByTackleZones) counts destination marks
            // and drops them for an uncancelled Stunty property;
            // ffb-common/src/main/java/com/fumbbl/ffb/skill/mixed/Stunty.java (Stunty#postConstruct)
            // supplies it. ffb-common/src/main/java/com/fumbbl/ffb/skill/mixed/Titchy.java
            // (Titchy#postConstruct) registers the mover's -1 DodgeModifier.
            const stuntyDestMarks = moverHasSkill('stunty') ? 0 : destMarks;
            const titchyAdj = moverHasSkill('titchy') ? -1 : 0;
            return Math.min(6, Math.max(2, info.player.agility + stuntyDestMarks + titchyAdj) + dtAdj);
          })();
          if (persistentPlannedPath) {
            this.syncMovementOverlayNode(
              `planned-path:dodge:${sx},${sy}`,
              'path',
              `${target}:${stepScale}`,
              a.x + (rush ? 12 * stepScale : 0),
              a.y - 3,
              1,
              () => this.buildDodgeChip(0, 0, stepScale, target),
            );
          } else {
            this.pathLayer.addChild(
              this.buildDodgeChip(a.x + (rush ? 12 * stepScale : 0), a.y - 3, stepScale, target),
            );
          }
        }
        fromSquare = [sx, sy];
      });
    }
    } finally {
      this.finishMovementOverlayFrame();
    }
  }

  /**
   * O7: BB2025 passing template shaded by range tier from the thrower's
   * square (Quick 0 / Short −1 / Long −2 / Bomb −3); Long+Bomb drop out in a
   * blizzard (C9). Modifier labels run along the thrower's own row.
   */
  private drawPassTemplate(from: Square): void {
    const blizzard = String(this.game?.fieldModel.weather ?? '').toLowerCase().includes('blizzard');
    const TIER_MODIFIERS: Record<PassRange, string> = { T: '', Q: '0', S: '−1', L: '−2', B: '−3' };
    const shade = new Graphics();
    for (let sx = 0; sx < PITCH_COLS; sx++) {
      for (let sy = 0; sy < PITCH_ROWS; sy++) {
        const range = passRange(sx - from[0], sy - from[1]);
        if (!range || range === 'T') continue;
        if ((blizzard || this.passTemplateMaxRange === 'S') && (range === 'L' || range === 'B')) continue;
        const quad = squareQuad(sx, sy);
        shade.poly(quad.points.flat()).fill({ color: PASS_RANGE_COLORS[range], alpha: 0.24 });
      }
    }
    this.overlayLayer.addChild(shade);
    // modifier ruler along the thrower's row, one label per band edge
    let previous: PassRange | 'T' | null = 'T';
    for (let sx = from[0] + 1; sx < PITCH_COLS; sx++) {
      const range = passRange(sx - from[0], 0);
      if (!range || ((blizzard || this.passTemplateMaxRange === 'S') && (range === 'L' || range === 'B'))) break;
      if (range !== previous) {
        const a = squareAnchor(sx, from[1]);
        const label = new Text({ text: TIER_MODIFIERS[range], style: DISTANCE_STYLE });
        label.anchor.set(0.5, 0.5);
        label.alpha = 0.75;
        label.scale.set(depthScale(sx, from[1]) * 0.55);
        label.position.set(a.x, a.y);
        this.overlayLayer.addChild(label);
        previous = range;
      }
    }
  }

  /** Hover-following passing-distance ruler. It is presentation-only: click eligibility remains entirely owned by
   *  tilePickEligible/tilePickExtra. No throw-roll arithmetic belongs in this renderer primitive. */
  private drawPassRuler(): void {
    const from = this.passRulerFrom;
    const to = this.passRulerTo;
    if (!from || !to) return;
    const band = passRulerBand(from, to);
    if (!band) return;

    const start = squareAnchor(from[0], from[1]);
    const end = squareAnchor(to[0], to[1]);
    const startScale = depthScale(from[0], from[1]);
    const endScale = depthScale(to[0], to[1]);
    const lineScale = (startScale + endScale) / 2;
    const colour = PASS_RANGE_COLORS[band === 'B+' ? 'B' : band];
    const labels: Record<PassRulerBand, string> = {
      Q: 'QUICK', S: 'SHORT', L: 'LONG', B: 'LONG BOMB', 'B+': 'BEYOND LB',
    };

    const line = new Graphics()
      .moveTo(start.x, start.y)
      .lineTo(end.x, end.y)
      .stroke({ color: colour, alpha: 0.92, width: 3.5 * lineScale })
      .circle(end.x, end.y, 4.5 * endScale)
      .fill({ color: colour, alpha: 0.95 });
    this.overlayLayer.addChild(line);

    const label = new Text({
      text: labels[band],
      style: { fontFamily: 'sans-serif', fontSize: 11, fontWeight: 'bold', fill: colour, stroke: { color: 0x101418, width: 3 } },
    });
    label.anchor.set(0.5, 1);
    label.position.set(end.x, end.y - 6 * endScale);
    label.scale.set(endScale);
    this.overlayLayer.addChild(label);
  }

  /** Rings players that are legal targets for the declared action (O5). */
  private drawTargetRings(
    isTarget: (data: PlayerDataJson, isOpposition: boolean) => boolean,
    color: number,
  ): void {
    if (!this.game) return;
    const homeIds = new Set(this.game.teamHome.playerArray.map((p) => p.playerId));
    const selectedIsHome = this.selectedIsHome();
    const rings = new Graphics();
    for (const data of this.game.fieldModel.playerDataArray) {
      if (!isOnPitch(data.playerCoordinate) || data.playerId === this.selectedPlayerId) continue;
      const isOpposition = homeIds.has(data.playerId) !== selectedIsHome;
      if (!isTarget(data, isOpposition)) continue;
      const [tx, ty] = data.playerCoordinate;
      const a = squareAnchor(tx, ty);
      const scale = depthScale(tx, ty);
      rings.ellipse(a.x, a.y - 3, TILE_W * 0.4 * scale, TILE_H * 0.3 * scale).stroke({ color, width: 2.5, alpha: 0.9 });
    }
    this.overlayLayer.addChild(rings);
  }

  /** Owner 2026-07-04c: the ARMED foul/handoff/pass preview — a gold reticle on
   *  the target, the roll chip(s), and for a pass the connecting arrow plus an
   *  interceptor tip (✋ + prohibited slash + the interference roll) over every
   *  opponent within 1.5 squares of the trajectory. */
  private drawArmedAction(): void {
    const a = this.armedAction;
    if (!a || !this.game || !this.selectedPlayerId) return;
    const from = this.getPathEnd();
    if (!from) return;
    const chip = (text: string, sq: Square, dy: number) => {
      const p = squareAnchor(sq[0], sq[1]);
      const s = depthScale(sq[0], sq[1]);
      const t = new Text({ text, style: ACTION_CHIP_STYLE });
      t.anchor.set(0.5, 1);
      t.scale.set(Math.max(0.7, s));
      t.position.set(p.x, p.y - TILE_H * dy * s);
      t.zIndex = 20;
      this.overlayLayer.addChild(t);
    };
    const targetChip = (prefix: string, target: number, sq: Square, dy: number, color: number) => {
      const p = squareAnchor(sq[0], sq[1]);
      const s = Math.max(0.7, depthScale(sq[0], sq[1]));
      const node = this.buildPassRollChip(p.x, p.y - TILE_H * dy * s, s, target, color, prefix);
      node.zIndex = 20;
      this.overlayLayer.addChild(node);
    };
    // target reticle (the push-crosshair art, static)
    const cross = this.buildPushCrosshair(a.square);
    this.overlayLayer.addChild(cross);
    if (a.mode === 'pass') {
      // arrow thrower → receiver + PASS chip at the midpoint + CATCH at the receiver (tip reaches the target).
      const arrow = this.pushArrowGraphic(from, a.square, { tipInsetFrac: 0 });
      arrow.alpha = 0.9;
      this.overlayLayer.addChild(arrow);
      const pass = this.resolvedPassRoll(this.selectedPlayerId, from, a.square);
      const catchRoll = catchTarget(this.game, a.targetId);
      if (pass != null) {
        const mid: Square = [Math.round((from[0] + a.square[0]) / 2), Math.round((from[1] + a.square[1]) / 2)];
        targetChip('Pass', pass, mid, 1.0, 0xffb020);
      }
      if (catchRoll != null) targetChip('Catch', catchRoll, a.square, 1.35, 0x2ec24f);
      // interceptor tips: ✋ with a prohibited slash + the interference roll
      for (const it of interceptors(this.game, this.selectedPlayerId, from, a.square)) {
        const p = squareAnchor(it.square[0], it.square[1]);
        const s = depthScale(it.square[0], it.square[1]);
        const tip = new Container();
        const glyph = new Text({ text: '✋', style: INTERCEPT_GLYPH_STYLE });
        glyph.anchor.set(0.5, 0.5);
        tip.addChild(glyph);
        const slash = new Graphics();
        slash.circle(0, 0, 9).stroke({ color: 0xe03030, width: 2.5, alpha: 0.95 });
        slash.moveTo(-6.4, -6.4).lineTo(6.4, 6.4).stroke({ color: 0xe03030, width: 2.5, alpha: 0.95 });
        tip.addChild(slash);
        const roll = this.buildPassRollChip(0, 18, 1, it.roll);
        tip.addChild(roll);
        tip.scale.set(Math.max(0.7, s));
        tip.position.set(p.x, p.y - TILE_H * 1.2 * s);
        tip.zIndex = 21;
        this.overlayLayer.addChild(tip);
      }
    } else if (a.mode === 'handoff') {
      const target = catchTarget(this.game, a.targetId);
      if (target != null) targetChip('Hand', target, a.square, 1.2, 0x2ec24f);
    } else {
      chip(a.rollText, a.square, 1.2); // Armour is a 2D6 total, not a D6 face.
    }
  }

  /** Owner 2026-07-06: per-aura shading — a light-opacity fill over every square
   *  within AURA_RADIUS of an emitter. Each aura has its OWN mode + friendly/
   *  opposition colours (friendly = home side by default, see friendlyIsHome):
   *   Pick-Me-Up      → friendly GREEN / opposition BEIGE
   *   Disturbing Pres → friendly BLUE  / opposition RED
   *  Owner ruling 08-17: overlapping auras of the same colour no longer STACK opacity by
   *  count — each (square, colour) is drawn exactly once at the flat STAGE-2 look
   *  (AURA_HATCH_STAGE2_OPACITY), whether covered by 1, 2, or 3+ auras. Mode per aura:
   *  'always' shades every emitter, 'selected' only the selected player's, 'off' hides that aura. */
  private drawAuras(): void {
    if (!this.game) return;
    const modeFor = (skill: string) => (skill === 'Disturbing Presence' ? this.auraDPMode : this.auraPMUMode);
    const colorFor = (skill: string, isHome: boolean): number => {
      const friendly = isHome === this.friendlyIsHome;
      if (skill === 'Disturbing Presence') return friendly ? 0x4a8cff : 0xe0402f; // blue / red
      return friendly ? 0x2ec24f : 0xd8c9a0; // Pick-Me-Up: green / beige
    };
    const emitters = auraEmitters(this.game).filter((e) => {
      // #152 (owner 07-23): a PLANNED/DECLARED pass reveals every Disturbing Presence aura regardless of
      // the user's DP mode, so the passer sees the enemy DP coverage before committing. Fives sets the flag.
      if (e.skill === 'Disturbing Presence' && this.passRevealDP) return true;
      const mode = modeFor(e.skill);
      return mode !== 'off' && (mode === 'always' || e.playerId === this.selectedPlayerId);
    });
    if (emitters.length === 0) return;
    // Owner ruling 08-17: dedupe by (square, colour) BEFORE drawing so overlapping auras of the
    // same colour no longer overdraw-stack — each covered square gets exactly one scratch pass.
    const covered = new Map<string, { sx: number; sy: number; color: number }>();
    for (const e of emitters) {
      const color = colorFor(e.skill, e.isHome);
      for (let dx = -AURA_RADIUS; dx <= AURA_RADIUS; dx++) {
        for (let dy = -AURA_RADIUS; dy <= AURA_RADIUS; dy++) {
          const sx = e.square[0] + dx;
          const sy = e.square[1] + dy;
          if (sx < 0 || sx >= PITCH_COLS || sy < 0 || sy >= PITCH_ROWS) continue;
          const key = `${sx},${sy},${color}`;
          if (!covered.has(key)) covered.set(key, { sx, sy, color });
        }
      }
    }
    const g = new Graphics();
    for (const { sx, sy, color } of covered.values()) {
      const quad = squareQuad(sx, sy);
      // Owner 08-12: draw the aura as PENCIL-SCRATCH diagonal strokes (annotation ON the pitch), not a flat
      // turf tint — categorically distinct from tackle-zone shading. Owner 08-17: flat STAGE-2 opacity,
      // count-based stacking removed (see drawAuraScratch).
      this.drawAuraScratch(g, quad.points, color);
    }
    g.zIndex = -1; // under the range shading / rings
    this.overlayLayer.addChild(g);
    // Owner 08-12 ③: during a planned/declared pass (the #152 reveal window) each square inside an OPPOSITION
    // Disturbing Presence aura surfaces its "−N" pass MODIFIER chip (N = stacking opposition-DP count over the
    // square — the actual pass penalty). ⚖ Friendly DP does NOT penalize the passer (opposing-only, BB2025), so
    // only opposition (red) auras carry a chip; blue friendly scratches stay chip-less.
    if (this.passRevealDP) {
      const dp = new Map<string, [number, number, number]>(); // key → [sx, sy, count]
      for (const e of emitters) {
        if (e.skill !== 'Disturbing Presence' || (e.isHome === this.friendlyIsHome)) continue;
        for (let dx = -AURA_RADIUS; dx <= AURA_RADIUS; dx++) {
          for (let dy = -AURA_RADIUS; dy <= AURA_RADIUS; dy++) {
            const sx = e.square[0] + dx, sy = e.square[1] + dy;
            if (sx < 0 || sx >= PITCH_COLS || sy < 0 || sy >= PITCH_ROWS) continue;
            const key = `${sx},${sy}`;
            dp.set(key, [sx, sy, (dp.get(key)?.[2] ?? 0) + 1]);
          }
        }
      }
      for (const [sx, sy, n] of dp.values()) {
        const a = squareAnchor(sx, sy);
        const chip = new Text({
          text: `−${n}`,
          style: { fontFamily: 'sans-serif', fontSize: 12, fontWeight: 'bold', fill: 0xe0402f, stroke: { color: 0xf2efe6, width: 2.5, join: 'round' } },
        });
        chip.anchor.set(0.5, 0.5);
        chip.scale.set(depthScale(sx, sy));
        chip.position.set(a.x, a.y);
        chip.zIndex = 2; // over the scratch hatch
        this.overlayLayer.addChild(chip);
      }
    }
  }

  /** Owner 08-12: a square of the aura zone rendered as sketchy pitch-row "pencil scratches" in the skill colour,
   *  projected-quad-aware (bilinear over the trapezoid corners so the hatch follows the perspective). Deterministic
   *  (no per-frame jitter). Owner ruling 08-17: called at most once per (square, colour) — see drawAuras — so
   *  opacity no longer densifies with overlap count; every covered square renders at the flat STAGE-2 look.
   *  Strokes flushed per-call so each square keeps its own colour. */
  private drawAuraScratch(g: Graphics, pts: [number, number][], color: number): void {
    // bilinear corner interp: u = left→right (0..1) along the bottom/top edges, v = bottom→top (0..1)
    const at = (u: number, v: number): [number, number] => {
      const bx = pts[0]![0] + (pts[1]![0] - pts[0]![0]) * u, by = pts[0]![1] + (pts[1]![1] - pts[0]![1]) * u;
      const tx = pts[3]![0] + (pts[2]![0] - pts[3]![0]) * u, ty = pts[3]![1] + (pts[2]![1] - pts[3]![1]) * u;
      return [bx + (tx - bx) * v, by + (ty - by) * v];
    };
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    const wobble = (stroke: number, channel: number) =>
      (turfNoise(pts[0]![0] + stroke * 17 + channel * 101, pts[0]![1] - stroke * 29 + channel * 53) * 2 - 1) *
      AURA_HATCH_WOBBLE;
    const N = 5;
    for (let i = 0; i < N; i++) {
      const v = (i + 0.5) / N;
      const [x0, y0] = at(clamp(0.1 + wobble(i, 0)), clamp(v - AURA_HATCH_SLANT / 2 + wobble(i, 2)));
      const [x1, y1] = at(clamp(0.9 + wobble(i, 1)), clamp(v + AURA_HATCH_SLANT / 2 + wobble(i, 3)));
      g.moveTo(x0, y0).lineTo(x1, y1);
    }
    g.stroke({ color, width: 1.1, alpha: AURA_HATCH_STAGE2_OPACITY, cap: 'round' });
  }

  /** Owner 2026-07-04d: the 3×3 BOMB blast preview centred on `this.bombTarget`
   *  (bomb 💣 at the centre; 💥 + roll on each affected square; centre shows the
   *  CATCH target if a player can catch, else the explosion). Drawn in bomb mode. */
  private drawBombTarget(): void {
    if (!this.bombTarget || !this.game) return;
    const chip = (target: number, sq: Square, prefix?: string) => {
      const p = squareAnchor(sq[0], sq[1]);
      const s = Math.max(0.7, depthScale(sq[0], sq[1]));
      const node = this.buildPassRollChip(p.x, p.y + 10 * s, s, target, 0xffb020, prefix);
      node.zIndex = 22;
      this.overlayLayer.addChild(node);
    };
    const glyph = (emoji: string, sq: Square, dy: number) => {
      const p = squareAnchor(sq[0], sq[1]);
      const s = depthScale(sq[0], sq[1]);
      const g = new Text({ text: emoji, style: INTERCEPT_GLYPH_STYLE });
      g.anchor.set(0.5, 0.5);
      g.scale.set(Math.max(0.8, s) * 1.2);
      g.position.set(p.x, p.y - TILE_H * dy * s);
      g.zIndex = 22;
      this.overlayLayer.addChild(g);
    };
    for (const cell of bombCells(this.game, this.bombTarget)) {
      const q = squareQuad(cell.square[0], cell.square[1]);
      const fill = new Graphics()
        .poly(q.points.flat())
        .fill({ color: cell.centre ? 0xff8a2a : 0xe0402a, alpha: cell.kind === 'empty' ? 0.12 : 0.26 });
      fill.zIndex = 0.5;
      this.overlayLayer.addChild(fill);
      if (cell.centre) glyph('💣', cell.square, 0.5);
      else if (cell.kind === 'explode') glyph('💥', cell.square, 0.5);
      if (cell.roll != null) chip(cell.roll, cell.square, cell.kind === 'catch' ? 'Catch' : undefined);
    }
  }

  private playExplosionGif(centre: Square, sound?: string, yOffset = 0): boolean {
    if (!this.app || !isOnPitch(centre)) return false;
    const gif = this.fireballExplosionGif;
    if (!gif?.frames.length) return false;
    if (sound) this.onCue?.(sound);
    const app = this.app;
    const anchor = squareAnchor(centre[0], centre[1]);
    const depth = depthScale(centre[0], centre[1]);
    const size = TILE_W * 2.4 * depth;
    const explosion = new Sprite(gif.frames[0]!.texture);
    explosion.anchor.set(0.5, 0.5);
    explosion.position.set(anchor.x, anchor.y + yOffset * depth);
    explosion.width = size;
    explosion.height = size;
    explosion.zIndex = 100000;
    this.effectsLayer.addChild(explosion);

    const finishEffect = this.beginVisualEffect();
    const start = performance.now();
    const life = Math.max(1, presentationMs(gif.duration));
    let cleanup: () => void = () => {};
    const tick = () => {
      const elapsed = performance.now() - start;
      if (elapsed >= life || this.app !== app) { cleanup(); return; }
      const sourceTime = Math.min(gif.duration - 1, (elapsed / life) * gif.duration);
      const frame = gif.frames.find((candidate) => sourceTime < candidate.end) ?? gif.frames.at(-1)!;
      if (explosion.texture !== frame.texture) explosion.texture = frame.texture;
    };
    tick();
    cleanup = this.registerEffectTicker(app, tick, [explosion], finishEffect);
    return true;
  }

  /** Owner 2026-07-04d: a BOMB explosion over the 3×3 area — the supplied
   *  explosion animation, with a procedural flash + smoke fallback. */
  playExplosion(centre: Square, sound?: string): void {
    if (!this.app || !isOnPitch(centre)) return;
    if (this.playExplosionGif(centre, sound, -TILE_H * 0.3)) return;
    // #92 Inc-2: fire the explosion sound at the BURST beat (the frame-0 flash below). Name relayed from the view.
    if (sound) this.onCue?.(sound);
    const a = squareAnchor(centre[0], centre[1]);
    const depth = depthScale(centre[0], centre[1]);
    // Fallback: procedural flash + 3×3 smoke.
    const flash = new Graphics().circle(a.x, a.y - 4, TILE_W * 1.6 * depth).fill({ color: 0xffd08a, alpha: 0.9 });
    flash.zIndex = 100000;
    this.effectsLayer.addChild(flash);
    const start = performance.now();
    const life = presentationMs(480);
    const app = this.app;
    let cleanup: () => void = () => {};
    const tick = () => {
      const t = (performance.now() - start) / life;
      if (t >= 1 || this.app !== app) { cleanup(); return; }
      flash.alpha = 0.9 * (1 - t);
      flash.scale.set(0.6 + t * 0.8);
    };
    cleanup = this.registerEffectTicker(app, tick, [flash]);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const sq: [number, number] = [centre[0] + dx, centre[1] + dy];
        if (!isOnPitch(sq)) continue;
        const p = squareAnchor(sq[0], sq[1]);
        this.spawnSmokePuff(p.x, p.y, depthScale(sq[0], sq[1]));
      }
    }
  }

  /** Plays the owner-supplied animated Fireball explosion. */
  playFireball(centre: Square, sound?: string): void {
    if (!this.app || !isOnPitch(centre)) return;
    if (this.playExplosionGif(centre, sound)) return;
    this.playExplosion(centre, sound);
  }

  /** Supplied D6 face showing the roll needed. */
  private buildRollDie(x: number, y: number, scale: number, target: number): Container {
    const die = new Container();
    if (isD6FaceValue(target)) {
      const face = this.buildD6(target);
      face.scale.set(0.62 * scale);
      die.addChild(face);
      const plus = new Text({ text: '+', style: ROLL_DIE_STYLE });
      plus.anchor.set(0, 0.5);
      plus.scale.set(scale);
      plus.position.set(9 * scale, 0);
      die.addChild(plus);
    } else {
      const label = new Text({ text: `${target}+`, style: ROLL_DIE_STYLE });
      label.anchor.set(0.5, 0.5);
      label.scale.set(scale);
      die.addChild(label);
    }
    die.position.set(x, y);
    return die;
  }

  /** A reachable/unselected Rush cost. Owner 09-09: the SAME die as the planned path (buildRollDie face + '+',
   *  target 2+ when the caller has none) at the shared 60% — a token at rest and a token mid-plan showed two
   *  different rush markers. Planned and resolved dice intentionally use their brighter surfaces. */
  private buildReachableRushDie(x: number, y: number, scale: number, target?: number): Container {
    const die = this.buildRollDie(x, y, scale, target ?? 2);
    die.alpha = REACHABLE_RUSH_DIE_ALPHA;
    return die;
  }

  /** O2: block dice above the defender — real die faces animating through
   *  each result state in sync; red-shaded + "OPPONENT'S CHOICE" when Uphill
   *  (O2.4–O2.7). */
  private drawBlockPreview(): void {
    if (!this.pendingBlock) return;
    this.drawBlockDiceAt(this.pendingBlock.square, this.pendingBlock.preview.dice, this.pendingBlock.preview.opponentChoice);
  }

  /** Acting-coach blitz aid: if the queued walk reaches contact through a SERVER-marked GFI square,
   *  repeat that square's authoritative target on the blocked player's token. Derived on every overlay redraw so
   *  changing/clearing the path, target, or server roll map cannot leave a stale chip behind. */
  private drawPlannedBlitzRushChip(): void {
    if (!this.game || !this.selectedIsActor() || this.plannedPath.length === 0 || !this.tilePickRolls) return;

    const action = String((this.game.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? '');
    const pendingTarget = this.actionMode === 'blitz' ? this.pendingBlock?.defenderId : null;
    const declaredTarget = action === 'blitz' || action === 'blitzMove' ? this.blockTargetsOnly : null;
    const targetId = pendingTarget ?? declaredTarget;
    if (!targetId) return;

    const rushTarget = this.plannedPath
      .map(([x, y]) => this.tilePickRolls!.get(squareKey(x, y))?.gfi ?? 0)
      .find((target) => target > 0);
    if (!rushTarget) return;

    const square = this.game.fieldModel.playerDataArray.find((data) => data.playerId === targetId)?.playerCoordinate;
    if (!isOnPitch(square ?? null)) return;
    const [x, y] = square!;
    const anchor = squareAnchor(x, y);
    const scale = depthScale(x, y);
    const die = this.buildRollDie(anchor.x, anchor.y - TILE_H * 0.18 * scale, scale * 0.5, rushTarget);
    die.alpha = 1; // owner 09-08
    this.pathLayer.addChild(die);
  }

  /** Owner 2026-07-08: block-target preview — the block-dice COUNT over every
   *  adjacent STANDING opponent of `blockTargetsAttacker` (FUMBBL context-menu
   *  Block). Reuses the over-the-head dice render; drawn in redrawOverlays.
   *  Row #334: Maximum Carnage is server-driven by bb2025 StepEndBlocking:430-441; ServerUtilBlock
   *  updateDiceDecorations broadcasts the exact legal second targets and signed dice counts. Render those
   *  decorations directly in that state instead of applying the ordinary block/blitz action gate. */
  private drawBlockTargets(): void {
    if (!this.game) return;
    const decorations = this.game.fieldModel.diceDecorationArray ?? [];
    const drawModelDecorations = () => {
      for (const raw of decorations) {
        const decoration = raw as { coordinate?: unknown; nrOfDice?: unknown };
        const coordinate = decoration.coordinate;
        const signedDice = Number(decoration.nrOfDice);
        if (!Array.isArray(coordinate) || coordinate.length !== 2 || !Number.isFinite(signedDice) || signedDice === 0) continue;
        this.drawBlockDotsAt([Number(coordinate[0]), Number(coordinate[1])], Math.abs(signedDice), signedDice < 0);
      }
    };
    const action = String((this.game.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? '');
    if (action === 'block' && this.furySecondBlockTargeting) {
      drawModelDecorations();
      for (const raw of decorations) {
        const coordinate = (raw as { coordinate?: unknown }).coordinate;
        if (!Array.isArray(coordinate) || coordinate.length !== 2) continue;
        const target: [number, number] = [Number(coordinate[0]), Number(coordinate[1])];
        if (isOnPitch(target)) this.overlayLayer.addChild(this.buildPushCrosshair(target, 0xffe066, 0.8));
      }
      return;
    }
    if (action === 'maximumCarnage') {
      drawModelDecorations();
      if (this.maximumCarnageTargeting) {
        for (const raw of decorations) {
          const coordinate = (raw as { coordinate?: unknown }).coordinate;
          if (!Array.isArray(coordinate) || coordinate.length !== 2) continue;
          const square: [number, number] = [Number(coordinate[0]), Number(coordinate[1])];
          if (isOnPitch(square)) this.overlayLayer.addChild(this.buildPushCrosshair(square, 0xffe066, 0.8));
        }
      }
      return;
    }

    // The passive coach has no local o66 arm of their own. A later local-arm clear used to erase the
    // path layer even though these server decorations remained in the model. For a remote attacker,
    // the model array is the entire render contract: a non-empty array draws verbatim; an empty array
    // deliberately returns without falling back to a client-computed lifetime. My-side previews retain
    // the existing blockDicePreview path below.
    // aae14454 regression fix (owner 08-12, flash-then-vanish): pre-empt the my-side preview ONLY when
    // ① there ARE server decorations (empty ⇒ a my-side pre-declare — fall through, never return-on-nothing)
    // AND ② the attacker is genuinely remote, tested on the STABLE `blockTargetsAttacker` side (the my-side arm)
    // rather than the volatile LIVE actingPlayer read that flips mid-declare and killed the preview. The
    // remote-flash intent survives: a real remote attacker (no local arm) WITH decorations still draws verbatim
    // (blockTargetsAttacker null there ⇒ falls back to actingPlayer to identify the remote side).
    if (this.modelBlockDecorations && decorations.length > 0) {
      const attackerId = this.blockTargetsAttacker ?? String((this.game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
      const attackerIsHome = !!attackerId && this.game.teamHome.playerArray.some((p) => p.playerId === attackerId);
      if (attackerId && attackerIsHome !== this.friendlyIsHome) {
        drawModelDecorations();
        return;
      }
    }

    const id = this.blockTargetsAttacker;
    if (!id) return;
    const ac = this.game.fieldModel.playerDataArray.find((d) => d.playerId === id)?.playerCoordinate;
    if (!ac) return;
    const homeIds = new Set(this.game.teamHome.playerArray.map((p) => p.playerId));
    const attackerHome = homeIds.has(id);
    for (const d of this.game.fieldModel.playerDataArray) {
      const c = d.playerCoordinate;
      if (!c || homeIds.has(d.playerId) === attackerHome || isDown(d.playerState)) continue;
      if (this.blockTargetsOnly && d.playerId !== this.blockTargetsOnly) continue; // owner 2026-07-07: declared blitz target only
      if (Math.max(Math.abs(c[0] - ac[0]), Math.abs(c[1] - ac[1])) !== 1) continue; // adjacent only
      const preview = blockDicePreview(this.game, id, d.playerId);
      if (preview) this.drawBlockDotsAt([c[0], c[1]], preview.dice, preview.opponentChoice);
    }
  }

  /** Owner 2026-07-08: the FUMBBL block-target indicator — small coloured DOTS over
   *  the opponent's head (NOT the big dice faces). Count = block dice; colour =
   *  RED (opponent's choice / uphill), GREEN (attacker's choice, ≥2 dice), YELLOW
   *  (1 die, even). */
  /** Owner 09-08: world y of the TOP of the chest target ring / state-marker row on the token at `square` (the row
   *  placeWalkerDecor lays out at -16 standing / 0 prone, TARGET_H tall) at its LIVE decor scale, or null when no
   *  token stands there. The block dice preview keeps its bottom edge above this at every zoom rung. */
  private blockDecorTopWorld(square: Square): number | null {
    const d = this.game?.fieldModel.playerDataArray.find((p) => p.playerCoordinate?.[0] === square[0] && p.playerCoordinate?.[1] === square[1]);
    const token = d ? this.tokensById.get(d.playerId) : undefined;
    if (!d || !token || token.destroyed) return null;
    const topUnits = (isDown(d.playerState) ? 0 : -16) - TARGET_H / 2;
    const local = walkerDecorLocalY(token, topUnits) ?? topUnits; // classic icon: plain placement
    return token.position.y + local * token.scale.y;
  }

  /** The preview's centre y: the view's tuned lift above the square, pushed higher whenever the live ring top would
   *  otherwise sit inside the dice (`halfH` = half the dice height, world units). Records the square for the
   *  zoom-rung redraw. */
  private blockPreviewY(square: Square, tunedY: number, halfH: number, scale: number): number {
    this.blockPreviewSquares.push([square[0], square[1]]);
    const top = this.blockDecorTopWorld(square);
    return top == null ? tunedY : Math.min(tunedY, top - halfH - BLOCK_PREVIEW_RING_GAP * scale);
  }

  private blockPreviewDecorKeyNow(): string {
    return this.blockPreviewSquares.map((s) => {
      const d = this.game?.fieldModel.playerDataArray.find((p) => p.playerCoordinate?.[0] === s[0] && p.playerCoordinate?.[1] === s[1]);
      const token = d ? this.tokensById.get(d.playerId) : undefined;
      return token && !token.destroyed ? (walkerDecorScale(token) ?? 1).toFixed(4) : '-';
    }).join('|');
  }

  /** Owner 09-08: the topmost occupied LOCAL y over a token — the figure (a walker's boundsArea covers only the
   *  figure) or any decoration child (skill row, state markers, gaze eye, activation tick…), whichever reaches
   *  higher. getLocalBounds() alone answered the figure for walkers, so the declared-action fist sat on the
   *  skill badges. A child whose bounds cannot be measured (headless Text) is skipped. */
  private tokenOverheadTop(token: Container): number {
    let top = token.getLocalBounds().minY;
    for (const child of token.children) {
      if (!child.visible || child.label === 'castShadow') continue;
      try {
        const b = child.getLocalBounds();
        if (!Number.isFinite(b.minY) || (b.width === 0 && b.height === 0)) continue;
        top = Math.min(top, child.position.y + b.minY * child.scale.y);
      } catch { /* unmeasurable child (headless text) — the figure bound stands */ }
    }
    return Number.isFinite(top) ? top : 0;
  }

  /** Ticker hook (after tickWalkers): a zoom rung re-snapped the active token's decorations (skill row grows in
   *  world units) → re-measure the declared-action marker's dodge. The first tick after a mount only records the
   *  baseline; the follow node's rest y moves with it so a tween keeps riding the new height. */
  private replaceActiveMarkerOnDecorChange(): void {
    const m = this.activeMarker;
    const token = this.activePlayerId ? this.tokensById.get(this.activePlayerId) : undefined;
    if (!m || m.node.destroyed || !token || token.destroyed) return;
    const key = `${(walkerDecorScale(token) ?? 1).toFixed(4)}:${this.overlayZoomFactor().toFixed(4)}`;
    if (this.activeMarkerDecorKey == null) { this.activeMarkerDecorKey = key; return; }
    if (key === this.activeMarkerDecorKey) return;
    this.activeMarkerDecorKey = key;
    const restY = this.activeFollow?.restY;
    if (restY == null) return;
    const y = restY + this.tokenOverheadTop(token) * token.scale.y - 6 * m.baseScale;
    const dy = y - m.baseY;
    m.baseY = y;
    m.node.position.y += dy;
    const follow = this.activeFollow?.nodes.find((n) => n.node === m.node);
    if (follow) follow.baseY = y;
  }

  /** Ticker hook (after tickWalkers): a zoom rung re-snapped a previewed token's decorations → redraw so the dice
   *  clear the ring again. The first tick after a redraw only records the baseline. */
  private redrawBlockPreviewOnDecorChange(): void {
    if (this.blockPreviewSquares.length === 0) return;
    const key = this.blockPreviewDecorKeyNow();
    if (this.blockPreviewDecorKey == null) { this.blockPreviewDecorKey = key; return; }
    if (key === this.blockPreviewDecorKey) return;
    this.redrawOverlays();
  }

  private drawBlockDotsAt(square: Square, dice: number, opponentChoice: boolean): void {
    const [bx, by] = square;
    const anchor = squareAnchor(bx, by);
    const scale = depthScale(bx, by);
    // Owner 2026-07-06: the raise above the head is configurable per view —
    // FUMBBL Classic keeps them shifted higher (1.62); FUMBBL40k sits them closer to
    // the head (SpectateView sets a smaller factor).
    const s = 8 * scale; // small SQUARE (owner 2026-07-08)
    const y = this.blockPreviewY(square, anchor.y - TILE_H * this.blockDotsHeadFactor * scale, s / 2, scale);
    const gap = 11 * scale;
    const color = opponentChoice ? 0xe0433a : dice > 1 ? 0x3ac04a : 0xf0c020; // red / green / yellow
    const g = new Graphics();
    for (let i = 0; i < dice; i++) {
      const x = anchor.x + (i - (dice - 1) / 2) * gap - s / 2;
      g.rect(x, y - s / 2, s, s).fill({ color });
      g.rect(x, y - s / 2, s, s).stroke({ color: 0x14161a, width: 1 * scale });
    }
    this.pathLayer.addChild(g);
  }

  /** Draw `dice` block-result cards above a square (the armed block preview
   *  and the block-target counts). Uphill shades the dice red + labels. */
  private drawBlockDiceAt(square: Square, dice: number, opponentChoice: boolean): void {
    const [bx, by] = square;
    const anchor = squareAnchor(bx, by);
    const scale = depthScale(bx, by);
    // Owner 09-08: lifted from 1.5 to 1.85 so the chest target ring no longer covers the dice — and pushed higher
    // still whenever the ring (a walker decoration, re-snapped per zoom rung) would reach into them.
    const dieH = (this.blockFaceTextures.length > 0 ? 27 : 18) * scale;
    const y = this.blockPreviewY(square, anchor.y - TILE_H * 1.85 * scale, dieH / 2, scale);
    const spacing = 30 * scale;
    if (this.blockFaceTextures.length > 0) {
      for (let i = 0; i < dice; i++) {
        const sprite = new Sprite(this.blockFaceTextures[0]);
        sprite.anchor.set(0.5, 0.5);
        sprite.width = 27 * scale;
        sprite.height = 27 * scale;
        sprite.position.set(anchor.x + (i - (dice - 1) / 2) * spacing, y);
        if (opponentChoice) sprite.tint = 0xff7070; // O2.4/O2.5: uphill dice shade red
        this.pathLayer.addChild(sprite);
        this.blockDiceSprites.push(sprite);
      }
    } else {
      for (let i = 0; i < dice; i++) {
        const x = anchor.x + (i - (dice - 1) / 2) * (21 * scale);
        this.pathLayer.addChild(this.buildBlockDie(x, y, scale, opponentChoice));
      }
    }
    if (opponentChoice) {
      const warning = new Text({ text: "OPPONENT'S CHOICE", style: OPP_CHOICE_STYLE });
      warning.anchor.set(0.5, 1);
      warning.scale.set(scale);
      warning.position.set(anchor.x, y - 17 * scale);
      this.pathLayer.addChild(warning);
    }
  }

  /** A block die: white face, red-shaded for Uphill Blocks (O2.4/O2.5). */
  private buildBlockDie(x: number, y: number, scale: number, uphill: boolean): Container {
    const die = new Container();
    const size = 18 * scale;
    die.addChild(
      new Graphics()
        .roundRect(-size / 2, -size / 2, size, size, 4 * scale)
        .fill({ color: uphill ? 0xc03030 : 0xf2efe6 })
        .roundRect(-size / 2, -size / 2, size, size, 4 * scale)
        .stroke({ color: uphill ? 0x5a1010 : 0x2a2a30, width: 1.6 * scale }),
    );
    // stylized "block" pips: two fists colliding (diagonal pair)
    const pip = uphill ? 0xf2e6e6 : 0x1a1a1a;
    die.addChild(
      new Graphics()
        .circle(-size * 0.18, -size * 0.18, 2.4 * scale)
        .fill(pip)
        .circle(size * 0.18, size * 0.18, 2.4 * scale)
        .fill(pip),
    );
    die.position.set(x, y);
    return die;
  }

  /** A label plus the D6 face required for a single-D6 target. */
  private buildD6Requirement(target: number, prefix?: string): Container {
    const content = new Container();
    const gap = 2;
    let cursor = 0;
    const addText = (value: string) => {
      const text = new Text({ text: value, style: DODGE_STYLE });
      text.anchor.set(0, 0.5);
      text.position.set(cursor, 0);
      content.addChild(text);
      cursor += text.width + gap;
    };
    if (prefix) addText(prefix);
    if (isD6FaceValue(target)) {
      const face = this.buildD6(target);
      face.scale.set(0.48);
      face.position.set(cursor + 6.7, 0);
      content.addChild(face);
      cursor += 13.4 + gap;
    } else {
      addText(String(target));
    }
    addText('+');
    content.pivot.set(cursor / 2, 0);
    return content;
  }

  /** Orange jump chip: "J" plus the modified agility face needed (RC4). */
  private buildJumpChip(x: number, y: number, scale: number, target: number): Container {
    const chip = new Container();
    const content = this.buildD6Requirement(target, 'J');
    const w = Math.max(30, content.width + 8) * scale;
    const h = 17 * scale;
    chip.addChild(
      new Graphics()
        .roundRect(-w / 2, -h / 2, w, h, 4 * scale)
        .fill({ color: 0xe08a2a })
        .roundRect(-w / 2, -h / 2, w, h, 4 * scale)
        .stroke({ color: 0x6a3c10, width: 1.4 * scale }),
    );
    content.scale.set(scale);
    chip.addChild(content);
    chip.position.set(x, y);
    return chip;
  }

  /** Yellow dodge chip: big "D" plus the modified D6 face needed. */
  private buildDodgeChip(x: number, y: number, scale: number, target: number): Container {
    const chip = new Container();
    const content = this.buildD6Requirement(target, 'D');
    const w = Math.max(30, content.width + 8) * scale;
    const h = 17 * scale;
    chip.addChild(
      new Graphics()
        .roundRect(-w / 2, -h / 2, w, h, 4 * scale)
        .fill({ color: 0xe0c832 })
        .roundRect(-w / 2, -h / 2, w, h, 4 * scale)
        .stroke({ color: 0x6a5a10, width: 1.4 * scale }),
    );
    content.scale.set(scale);
    chip.addChild(content);
    chip.position.set(x, y);
    return chip;
  }

  /** Owner o66 #14 (canonical parity): a PICKUP chip — an orange plate with a small ball glyph and the
   *  minimum roll to pick the loose ball up on this square. Distinct from the yellow "D N+" dodge chip so the
   *  coach reads pickup vs dodge at a glance. The target is computed client-side from the SAME bb2025 server
   *  formula (AgilityMechanic.minimumRollPickup: max(2, AG + Pouring-Rain + opposing tackle zones on the ball
   *  square); Big Hand ignores TZ) — a state READ, not a prediction of the die (like the block-dice preview). */
  private buildPickupChip(x: number, y: number, scale: number, target: number): Container {
    const chip = new Container();
    const content = this.buildD6Requirement(target);
    const w = Math.max(38, content.width + 20) * scale;
    const h = 17 * scale;
    chip.addChild(
      new Graphics()
        .roundRect(-w / 2, -h / 2, w, h, 4 * scale)
        .fill({ color: 0xd98836 })
        .roundRect(-w / 2, -h / 2, w, h, 4 * scale)
        .stroke({ color: 0x6a3a10, width: 1.4 * scale }),
    );
    // small ball glyph on the left
    chip.addChild(
      new Graphics()
        .circle(-w / 2 + 6 * scale, 0, 4 * scale)
        .fill({ color: 0x8a5a20 })
        .circle(-w / 2 + 6 * scale, 0, 4 * scale)
        .stroke({ color: 0x3a2408, width: 1 * scale }),
    );
    content.scale.set(scale);
    content.position.set(4 * scale, 0);
    chip.addChild(content);
    chip.position.set(x, y);
    return chip;
  }

  /** Owner o66 #14 (canonical parity): a small PASS-roll face for a throw range tile. Amber like the
   *  range rings, distinct from the yellow dodge chip and orange pickup chip. Target is host-computed from the
   *  exact bb2025 PassMechanic formula (a state read, not a die prediction). */
  private buildPassRollChip(x: number, y: number, scale: number, target: number, color = 0xffb020, prefix?: string): Container {
    const chip = new Container();
    const content = this.buildD6Requirement(target, prefix);
    const w = Math.max(prefix ? 54 : 24, content.width + 8) * scale;
    const h = 17 * scale;
    chip.addChild(
      new Graphics()
        .roundRect(-w / 2, -h / 2, w, h, 3 * scale)
        .fill({ color, alpha: 0.92 })
        .roundRect(-w / 2, -h / 2, w, h, 3 * scale)
        .stroke({ color: 0x6a4a08, width: 1.1 * scale }),
    );
    content.scale.set(scale);
    chip.addChild(content);
    chip.position.set(x, y);
    return chip;
  }

  /** #151: draw the pass rolls-required cues — a THROW "N+" plate over the passer's head (amber) and a
   *  CATCH "N+" plate over the destination square (green). Both fed server-derived by the view
   *  (setThrowRoll / setCatchRoll); positioned via tokenPos so they carry the wing nudge (#164). */
  private drawPassRollCues(): void {
    const draw = (cue: { square: [number, number]; target: number } | null, color: number, label: string) => {
      if (!cue || !isOnPitch(cue.square)) return;
      const [sx, sy] = cue.square;
      const a = this.tokenPos(sx, sy);
      const depth = depthScale(sx, sy);
      const chip = this.buildPassRollChip(a.x, a.y - TILE_H * depth * 1.25, depth, cue.target, color, label);
      chip.zIndex = 7; // above the tokens/crosshair
      this.overlayLayer.addChild(chip);
    };
    draw(this.throwRollCue, 0xffb020, 'Pass'); // THROW over the passer — amber
    draw(this.catchRollCue, 0x2ec24f, 'Catch'); // CATCH over the target — green (the friendly catch language)
  }

  /** Pending Monstrous Mouth roll, using the same projected, depth-scaled plate as pass/catch cues. */
  private drawChompCue(): void {
    const cue = this.chompCue;
    if (!cue || !isOnPitch(cue.square)) return;
    const [sx, sy] = cue.square;
    const a = this.tokenPos(sx, sy);
    const depth = depthScale(sx, sy);
    const chip = this.buildPassRollChip(a.x, a.y - TILE_H * depth * 1.25, depth, cue.target, 0xffb020, 'Chomp');
    chip.zIndex = 7;
    this.overlayLayer.addChild(chip);
  }

  /** Match11: cycle order for the toolbar toggle. */
  tackleZoneModeOptions(): string[] {
    return ['opposition', 'friendly', 'both', 'off'];
  }

  setTackleZoneMode(mode: string): void {
    if (mode !== 'off' && mode !== 'opposition' && mode !== 'friendly' && mode !== 'both') return;
    this.tackleZoneMode = mode;
    this.redrawOverlays();
  }

  /**
   * Match11/O9: tackle-zone shading + stacked-malus markers ("−n") on
   * unoccupied squares, relative to the selected player's team. In 'both'
   * mode, opposition zones win overlapping squares (O9.2.2).
   */
  /** squareKey → count of adjacent tackle zones per side, relative to selection. */
  private tackleZoneCounts(selectedIsHome: boolean): { opposition: Map<string, number>; friendly: Map<string, number> } {
    const opposition = new Map<string, number>();
    const friendly = new Map<string, number>();
    if (!this.game) return { opposition, friendly };
    const homeIds = new Set(this.game.teamHome.playerArray.map((p) => p.playerId));
    for (const data of this.game.fieldModel.playerDataArray) {
      if (!isOnPitch(data.playerCoordinate) || !hasTackleZones(data.playerState)) continue;
      const zoneIsFriendly = homeIds.has(data.playerId) === selectedIsHome;
      const target = zoneIsFriendly ? friendly : opposition;
      const [px, py] = data.playerCoordinate;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const sx = px + dx;
          const sy = py + dy;
          if (sx < 0 || sx >= PITCH_COLS || sy < 0 || sy >= PITCH_ROWS) continue;
          const key = squareKey(sx, sy);
          target.set(key, (target.get(key) ?? 0) + 1);
        }
      }
    }
    return { opposition, friendly };
  }

  private drawTackleZones(selectedIsHome: boolean, modeOverride?: 'off' | 'opposition' | 'friendly' | 'both'): void {
    if (!this.game) return;
    const mode = modeOverride ?? this.tackleZoneMode;
    if (mode === 'off') return;
    const { opposition, friendly } = this.tackleZoneCounts(selectedIsHome);

    const shade = new Graphics();
    const labels: Container[] = [];
    const drawSide = (counts: Map<string, number>, color: number, style: TextStyle, danger = false) => {
      for (const [key, count] of counts) {
        if (this.playersBySquare.has(key)) continue; // O9.2.3: occupied squares stay clean
        const [sx, sy] = key.split(',').map(Number) as [number, number];
        const quad = squareQuad(sx, sy);
        // Owner 2026-07-08: OVERLAP reads darker — a square in N tackle zones shades deeper
        // (each extra zone +0.12α over the 0.2 base, capped) so contested squares stand out.
        // A SINGLE opposition tackle zone reads as the (old rush) amber; 2+ ramps into red.
        const single = danger && count === 1;
        const fillColor = single ? 0xe08a2a : color;
        const alpha = single ? 0.26 : Math.min(0.2 + (count - 1) * 0.12, 0.56);
        shade.poly(quad.points.flat()).fill({ color: fillColor, alpha });
        const label = new Text({ text: `−${count}`, style });
        label.anchor.set(1, 0);
        const scale = depthScale(sx, sy);
        label.scale.set(scale);
        label.position.set(quad.points[2]![0] - 2 * scale, quad.yTop + 1.5 * scale);
        labels.push(label);
      }
    };

    if (mode === 'friendly' || mode === 'both') {
      const shown = new Map(friendly);
      if (mode === 'both') {
        for (const key of opposition.keys()) shown.delete(key); // opposition precedence
      }
      drawSide(shown, 0x3a6ac0, TZ_FRIENDLY_STYLE);
    }
    if (mode === 'opposition' || mode === 'both') {
      drawSide(opposition, 0xc03030, TZ_OPPOSITION_STYLE, true); // danger ramp: 1 = amber, 2+ = red
    }
    this.overlayLayer.addChild(shade);
    // TZ labels are ground UI: under the players (unlike the path markers)
    for (const label of labels) this.overlayLayer.addChild(label);
  }

  /** Order66 disables the legacy planner below, so its active-player tackle zones must be mounted before that
   *  gate. The toolbar mode is authoritative presentation state: friendly is the exact team-side mirror of
   *  opposition, and both retains drawTackleZones' opposition-on-overlap precedence. Team membership remains
   *  server-absolute (home/away); viewer seat and field flip affect only the downstream projection. */
  private drawO66TackleZones(): void {
    if (!this.order66 || !this.o66OppTzActive || !this.game) return;
    const actId = String((this.game.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? '');
    if (!actId) return;
    const selectedIsHome = this.game.teamHome.playerArray.some((player) => player.playerId === actId);
    this.drawTackleZones(selectedIsHome, this.tackleZoneMode);
  }

  /**
   * Close-up of a player exactly as rendered on the pitch (owner 2026-07-02:
   * the docked player card's portrait): rebuilds the token at full size and
   * rasterizes it. Returns a data URL, or null when unavailable.
   */
  playerPortrait(playerId: string): string | null {
    if (!this.app || !this.game) return null;
    let data = this.game.fieldModel.playerDataArray.find((d) => d.playerId === playerId);
    if (!data) return null;
    // dugout players (selectable since 2026-07-02) render from a stub square
    if (!isOnPitch(data.playerCoordinate)) data = { ...data, playerCoordinate: [0, 0] };
    const isHome = this.game.teamHome.playerArray.some((p) => p.playerId === playerId);
    const team = isHome ? this.game.teamHome : this.game.teamAway;
    const player = team.playerArray.find((p) => p.playerId === playerId);
    if (!player) return null;
    // owner 2026-07-02: the portrait excludes skill badges (the card's own
    // skill row covers them, with ALL skills including positional defaults)
    const token = this.buildPlayerToken(player, data, isHome, team, undefined, false);
    token.scale.set(1); // portrait ignores depth scaling
    // Owner 09-09: the position ring and the (sheared) shadows widened the extract's bounds asymmetrically, so
    // the figure sat off-centre in the card's portrait box — the portrait is the FIGURE plus its state markers.
    for (const child of [...token.children]) {
      if (child.label === 'positionRing' || child.label === 'castShadow' || child.label === 'groundShadow') { token.removeChild(child); child.destroy({ children: true }); }
    }
    // Owner 09-05: walker tokens pin `boundsArea` to the standing FIGURE (badge/marker placement); the extract
    // would crop the portrait to that box (a prone figure lies across it) — rasterize the real content bounds.
    (token as { boundsArea: Rectangle | null }).boundsArea = null;
    try {
      const canvas = this.app.renderer.extract.canvas({ target: token, resolution: 3 }) as HTMLCanvasElement;
      return canvas.toDataURL?.() ?? null;
    } catch (error) {
      console.warn('ffb-pitch: portrait extract failed', error);
      return null;
    } finally {
      token.destroy({ children: true });
    }
  }

  // --- dugouts (owner 2026-07-02, BB2 reference): reserves/KO/casualty boxes ---

  /**
   * Off-pitch players render in team dugouts BESIDE the sidelines, drawn in
   * the same Madden projection as the pitch — stone-tiled squares (owner
   * 2026-07-02, BB2 reference), one gutter column between sideline and
   * dugout. BB3-style injury markers hover over heads: "K.O." red text, red
   * cross for casualties, red skull for the dead.
   */
  private drawDugouts(): void {
    for (const child of this.dugoutLayer.removeChildren()) child.destroy({ children: true });
    this.dugoutTokensById.clear();
    this.dugoutCompartmentById.clear();
    this.dugoutLayer.sortableChildren = true;
    this.dugoutHits = []; // owner 2026-07-08: rebuilt below for the direct dugout click hit-test
    if (!this.game || !this.dugoutsEnabled || this.boardCleared) return; // owner 2026-07-15: clear the board at end of game
    // Sections run from each team's OWN end zone toward the line of
    // scrimmage (owner 2026-07-02): CAS at the end-zone edge, KO in the middle,
    // RESERVES nearest midfield/opposition (owner 2026-07-07, case 353 — CAS and
    // RESERVES swapped so reserves sit closest to the opposing players). Four rows/section.
    const SECTION_DEFS: { label: string; states: number[] }[] = [
      {
        label: 'CAS',
        states: [PlayerStateBase.BADLY_HURT, PlayerStateBase.SERIOUS_INJURY, PlayerStateBase.RIP], // #133: BANNED split out → free-standing corner apron (owner)
      },
      { label: 'KO', states: [PlayerStateBase.KNOCKED_OUT] },
      { label: 'RESERVES', states: [PlayerStateBase.RESERVE, PlayerStateBase.MISSING] },
    ];
    // States explicitly claimed by the KO + CAS boxes; RESERVES is the catch-all for
    // everything else off-pitch. Built BY LABEL (order-independent) so reordering the
    // sections above can never misroute casualties into the RESERVES catch-all.
    const claimedDugoutStates = new Set<number>(
      SECTION_DEFS.filter((d) => d.label !== 'RESERVES').flatMap((d) => d.states),
    );
    // #133 (owner): BANNED is CLAIMED (kept out of the RESERVES catch-all) but has NO section — the sent-off
    // players are rendered free-standing in the corner apron below, not in a boxed section.
    claimedDugoutStates.add(PlayerStateBase.BANNED);
    for (const isHome of [true, false]) {
      const team = isHome ? this.game.teamHome : this.game.teamAway;
      // home flanks the RIGHT sideline (owner 2026-07-02; SWAPPED right 2026-07-07 case 352).
      // Owner 2026-07-07 (case 356 → 357): a HALF-square gap from the pitch — the columns sit
      // half a square out (home 15.5-17.5 / away −3.5..−1.5). A full square (case 356) read as
      // too far; half keeps a slim gap beside the touchline.
      const columns = isHome
        ? [PITCH_ROWS + 0.5, PITCH_ROWS + 1.5, PITCH_ROWS + 2.5]
        : [-3.5, -2.5, -1.5];
      const trim = isHome ? 0x3a5bb0 : 0xb03a3a;
      const physicalChrome = this.chromePitchPresentation;
      // home defends x=0 (south), away x=25 (north). Owner 2026-07-07 (case 356): the
      // end-zone-side edge now aligns to the END-ZONE ROW (home x0 / away x25), so each
      // dugout's corner sits at the end-zone corner.
      // Owner 2026-07-07: per-section row-spans (end-zone → midfield). The dugout is 2 rows
      // SHORTER (12→10) so its bottom (midfield) line lands at the row-10 marker, reclaiming
      // visual space. The 2 rows come off CAS + KO (which hold only a few tokens); RESERVES
      // keeps its 4 rows so a full bench still fits.
      // C12-B3 (2026-07-10): RESERVES still felt cramped on a big-roster/mid-match bench (a full
      // 16-man team's unused reserves + accumulated KO/casualty churn can exceed the 9-slot (3×3)
      // capacity, forcing the pack/scale-down compression from case 378 more than felt comfortable).
      // Took 1 more row from CAS (badly-hurt-and-worse rarely fills 3 full rows in practice).
      // Owner 2026-07-14 (setup overhaul #1b): extend the RESERVES box back one row — dugoutRows 10→11 (ends
      // at row 11). RIPPLE AUDIT (Yularen CWY cond-a): X0 away (26-dugoutRows) 16→15, X1 home (dugoutRows-1)
      // 9→10 — home dugout x0..10, away x15..25, gap x11..14 (no overlap); ground/trim/separators/tokens all
      // key off X0/X1 (auto); dugoutHits rebuilt from token anchors (auto); Classic dugoutsEnabled=false
      // (unaffected); worldToSquare bands exclude dugout tokens — dugoutHits handles them (unaffected);
      // camera-fit + pan-clamp use dugoutW=4*TILE_W on the ACROSS axis, not dugoutRows — the along-axis stays
      // within pitch x0..25 (unaffected); turn-track is on the opposite flank (unaffected). The extra row goes
      // to RESERVES so a full 16-man bench packs less. Voss dugout acceptance pass owed post-land.
      // #22 (owner 07-22): RESERVES +1 more row (6→7, dugoutRows 11→12) so a full bench keeps FULL token
      // scale — the `packScale` overfull-shrink (`const packScale = overfull ? step : 1`, in drawDugouts)
      // was the on-pitch-vs-dugout SIZE delta the owner
      // perceived. Ripple (same audit as #1b): home dugout x0..11, away x14..25, gap x12..13 (no overlap);
      // along-axis within pitch 0..25; ground/trim/separators/tokens/dugoutHits all key off X0/X1 (auto);
      // camera-fit uses dugoutW on the across-axis, not dugoutRows (unaffected).
      const SECTION_ROWS = [2, 3, 7]; // CAS, KO, RESERVES (RESERVES +1 #1b, +1 more #22)
      const dugoutRows = SECTION_ROWS.reduce((a, b) => a + b, 0); // 12 (owner #22; was 11 #1b, 10 orig)
      let racc = 0;
      const sections = SECTION_DEFS.map((def, i) => {
        const rows = SECTION_ROWS[i]!;
        const s = isHome
          ? { ...def, x0: racc, x1: racc + rows - 1 } // 0-2, 3-5, 6-9
          : { ...def, x0: 25 - (racc + rows - 1), x1: 25 - racc }; // 23-25, 20-22, 16-19
        racc += rows;
        return s;
      });
      const X0 = isHome ? 0 : 26 - dugoutRows; // away 16
      const X1 = isHome ? dugoutRows - 1 : 25; // home 9

      // stone-tiled squares in the pitch projection
      const ground = new Graphics();
      ground.label = 'dugoutGround'; // 09-06: named so the headless acceptance rig can find it
      // 09-06 (stadium-3d-dugouts handoff): a rendered `dugouts.provided` stadium plan carries the floors + box
      // chrome at these exact rectangles, so the procedural ground, team trim and separators are skipped while
      // that plan is on screen (planDugoutsActive) — labels, tokens, markers and hit areas below stay as they are.
      if (!this.planDugoutsActive()) {
        for (let x = X0; x <= X1; x++) {
          for (const y of columns) {
            const quad = squareQuad(x, y);
            if (this.stoneTexture) {
              const matrix = this.tileTexMatrix(x, y, this.stoneTexture.width, this.stoneTexture.height);
              ground.poly(quad.points.flat()).fill({ texture: this.stoneTexture, matrix });
              ground.poly(quad.points.flat()).fill({ color: 0x0a0c10, alpha: 0.22 });
            } else {
              ground.poly(quad.points.flat()).fill({ color: 0x2a2d34 });
            }
            if (physicalChrome) {
              // Recess the playable dugout tile into a weathered sideline fixture. This deliberately
              // stays in world projection rather than imitating a floating DOM panel.
              ground.poly(quad.points.flat()).fill({ color: 0x080b0e, alpha: 0.46 });
              ground.poly(quad.points.flat()).stroke({ color: 0x707780, width: 0.75, alpha: 0.48 });
            }
          }
        }
        // team-color trim around the dugout, projected
        const yMin = Math.min(...columns);
        const yMax = Math.max(...columns);
        // B9-21: dugout trim rectangle from game corners (extPoint) — no E-W shear
        const dt = [
          extPoint(X0, yMin),
          extPoint(X0, yMax + 1),
          extPoint(X1 + 1, yMax + 1),
          extPoint(X1 + 1, yMin),
        ];
        const dugoutOutline = dt.flatMap((p) => [p.x, p.y]);
        if (physicalChrome) {
          ground.poly(dugoutOutline).stroke({ color: 0x090b0e, width: 6, alpha: 0.95 });
          ground.poly(dugoutOutline).stroke({ color: 0x727983, width: 3.5, alpha: 0.9 });
        }
        ground.poly(dugoutOutline).stroke({ color: trim, width: physicalChrome ? 2.2 : 2, alpha: physicalChrome ? 0.98 : 0.75 });
        if (physicalChrome) {
          for (const corner of dt) {
            ground.circle(corner.x, corner.y, 2.3).fill({ color: 0x15191e }).stroke({ color: 0xaeb4bb, width: 0.9, alpha: 0.9 });
          }
        }
        // section separators styled like the end-zone lines (owner 2026-07-02): a major
        // white line on each INTERNAL section boundary. The boundary that coincides with
        // the dugout's outer edge (=== X0) is SKIPPED so the team-colour trim shows through
        // there — otherwise this white line overdraws the trim on the LOS-facing edge
        // (owner 2026-07-07, case 353: "the south line of the away dugout should be red").
        for (const section of sections) {
          const boundary = section.x0; // bottom (near) edge of the section
          if (boundary === X0) continue; // dugout outer edge — leave it to the team trim
          const a = extPoint(boundary, yMin);
          const c = extPoint(boundary, yMax + 1);
          if (physicalChrome) ground.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: 0x080a0d, width: 4.5, alpha: 0.9 });
          ground.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: physicalChrome ? 0x8d949c : COLORS.line, width: physicalChrome ? 1.4 : 2.5, alpha: 0.85 });
        }
      } // end of the procedural ground + chrome (skipped under a dugouts-provided plan)
      // Owner 2026-07-06: the cosmetic dugout dressing — the stand-textured back WALL +
      // roof lip and the brown BENCH LINE (B2-21) — is REMOVED. They read as "random
      // decor that isn't doing anything" cluttering the dugout. The functional dugout
      // (stone ground, team trim, section separators, labels, player tokens) stays.
      ground.zIndex = -1;
      this.dugoutLayer.addChild(ground);

      const offPitch = this.game.fieldModel.playerDataArray.filter(
        (d) => team.playerArray.some((p) => p.playerId === d.playerId)
          // Formation-presented players leave the dugout visually; overflow/unfieldable players stay pickable here.
          && !this.preSetupCoords.has(d.playerId)
          && (baseState(d.playerState) === PlayerStateBase.RESERVE || !isOnPitch(d.playerCoordinate)),
      );
      for (const section of sections) {
        // label sits on the section row nearest the team's own end zone, on
        // a band shaded like that side's end zone (owner 2026-07-02); text
        // reads upright — legible to the home coach
        const labelRow = isHome ? section.x0 : section.x1;
        const band = new Graphics();
        for (const y of columns) {
          const quad = squareQuad(labelRow, y);
          if (physicalChrome) band.poly(quad.points.flat()).fill({ color: 0x0a0d11, alpha: 0.88 });
          band.poly(quad.points.flat()).fill({ color: isHome ? 0x1a3a9a : 0x9a1a1a, alpha: physicalChrome ? 0.64 : 0.9 });
          if (physicalChrome) band.poly(quad.points.flat()).stroke({ color: trim, width: 1.3, alpha: 0.9 });
        }
        band.zIndex = -0.5;
        this.dugoutLayer.addChild(band);

        const label = new Text({ text: section.label, style: DUGOUT_LABEL_STYLE });
        label.anchor.set(0.5, 0.5);
        label.scale.set(depthScale(labelRow, columns[1]!));
        label.rotation = pitchTextRotation(labelRow, columns[1]!); // owner 09-10: E-W turns the band text with the pitch
        const mid = squareAnchor(labelRow, columns[1]!);
        label.position.set(mid.x, mid.y);
        label.zIndex = 0;
        this.dugoutLayer.addChild(label);

        // #129/#331 (owner 08-17, superseded): the standalone bench sprite is replaced by the
        // labeled APOTHECARY box on the turn-track margin (drawApothecaryBox) — the token now
        // "initiates from" that box instead of floating on the RESERVES row.

        // Owner 2026-07-07: RESERVES is a CATCH-ALL — any off-pitch player NOT in the
        // KO or CAS sections lands here (rather than matching no section and silently
        // vanishing). Covers transient/unmapped off-pitch states (e.g. SETUP_PREVENTED,
        // or an on-pitch-type state that briefly carries an off-pitch coordinate).
        const members =
          section.label === 'RESERVES'
            ? offPitch.filter((d) => {
                const b = baseState(d.playerState);
                return !claimedDugoutStates.has(b);
              })
            : offPitch.filter((d) => section.states.includes(baseState(d.playerState)));
        // Owner 2026-07-07: HARD-BOUNDED zones — every player that belongs in a section
        // stays VISIBLE inside it (no clipping/occlusion). When the count exceeds the slots
        // (rows below the label × columns), the rows PACK tighter into the section and the
        // tokens SCALE DOWN by the same factor. `step` < 1 compresses the row spacing;
        // `packScale` shrinks the tokens to match so they don't overlap.
        const cols = columns.length;
        const playerRows = section.x1 - section.x0; // rows available below the label row
        const rowsNeeded = Math.max(1, Math.ceil(members.length / cols));
        const overfull = rowsNeeded > playerRows;
        const step = overfull ? (playerRows - 1) / (rowsNeeded - 1) : 1; // <1 packs more rows in
        const packScale = overfull ? step : 1; // token shrink factor when overfull
        const placements = members.map((data, i) => {
          const column = columns[i % cols]!;
          const row = Math.floor(i / cols);
          const offset = 1 + row * step;
          const x = isHome ? section.x0 + offset : section.x1 - offset;
          return { data, column, x };
        });
        const renderedReservePlacements = section.label === 'RESERVES'
          ? placements.filter(({ data }) => team.playerArray.some((p) => p.playerId === data.playerId))
          : [];
        placements.forEach(({ data, column, x }) => {
          let token: Container | undefined;
          // Owner 2026-07-07: harden each token so a single failure (a bad coordinate,
          // a missing roster/texture) can't abort the forEach and drop EVERY casualty
          // after it — the reported "occasionally casualties disappear" symptom.
          try {
          const player = team.playerArray.find((p) => p.playerId === data.playerId);
          if (!player) throw new Error('dugout player is missing from its team roster');
          const anchor = squareAnchor(x, column);
          this.playersBySquare.set(squareKey(x, column), data.playerId);
          if (data.playerId === this.selectedPlayerId) {
            const halo = new Graphics();
            const haloScale = depthScale(x, column);
            for (const [radius, alpha] of [[0.62, 0.16], [0.5, 0.28], [0.4, 0.5]] as [number, number][]) {
              halo
                .ellipse(anchor.x, anchor.y - 3, TILE_W * radius * haloScale, TILE_H * radius * 0.72 * haloScale)
                .fill({ color: 0xf5c542, alpha });
            }
            halo.zIndex = this.depthZ(x, column) - 1;
            this.dugoutLayer.addChild(halo);
          }
          // owner 2026-07-02: KO'd and casualtied players lie in the dugout
          // like stunned players (banned/reserves stay on their feet)
          const base = baseState(data.playerState);
          const renderDown =
            base === PlayerStateBase.KNOCKED_OUT ||
            base === PlayerStateBase.BADLY_HURT ||
            base === PlayerStateBase.SERIOUS_INJURY ||
            base === PlayerStateBase.RIP;
          const stub: PlayerDataJson = {
            ...data,
            playerCoordinate: [0, 0],
            playerState: renderDown ? PlayerStateBase.STUNNED : data.playerState,
          };
          // owner 2026-07-02: dugout players render as active — no shading.
          // Owner 2026-07-14 (#2): reserve-box players show skill icons MATCHING the on-pitch style — enable
          // badges (includeBadges) + pass the position's baseline skill set so the same default-skill filter
          // applies (a positional's default skills stay hidden unless showDefaultSkills, exactly like on-pitch).
          const posDef = (team.roster as { positionArray?: { positionId: string; skillArray?: string[] }[] })
            .positionArray?.find((q) => q.positionId === player.positionId);
          const dugoutBaseline = new Set(posDef?.skillArray ?? []);
          // #95: stunCaption=false — the stub fakes STUNNED for the lying pose, but KO/casualty
          // players must NOT get the "STUNNED" caption (the X still renders as the down mark).
          token = this.buildPlayerToken(
            player, stub, isHome, team, dugoutBaseline, true, false, false,
            section.label === 'RESERVES'
              ? renderedReservePlacements.some((other) => other.column === column && other.x > x)
              : undefined,
          );
          // Dwarfen Wisdom re-setup gate (SR-119-adjacent, 58062c45): the server flips an
          // ineligible reserve's base state RESERVE→PRONE while it sits in the box (self-restores
          // on leave()). Key strictly off that server-sent base — reusing the same inactive
          // treatment as applyActivationShading (alpha + grey desaturation) rather than drawing
          // them lying down, since the dugout lying-pose stub above is reserved for KO/BH/SI/RIP.
          if (base === PlayerStateBase.PRONE) {
            token.alpha = 0.765;
            for (const child of token.children) {
              if (child instanceof Sprite && child.label !== 'castShadow') child.tint = 0xaeb0b1; // 09-06: shadow stays black
            }
          }
          const scale = depthScale(x, column) * strengthScale(player.strength) * packScale;
          token.position.set(anchor.x, anchor.y);
          token.scale.set(isWalkerToken(token) ? 1 : scale); // 09-05: pixel art never takes a fractional token scale
          token.zIndex = this.depthZ(x, column);
          this.dugoutLayer.addChild(token);
          if (isWalkerToken(token)) registerLiveWalker(token); // 09-05 (round 20): the snap lands dugout walkers on a clean ratio too
          this.dugoutTokensById.set(data.playerId, token);
          this.dugoutCompartmentById.set(
            data.playerId,
            section.label === 'KO' ? 'ko' : section.label === 'CAS' ? 'cas' : 'reserve',
          );
          // #22-b (owner 07-22): KO + CASUALTY box entries carry the same over-token STATE markers as
          // on-pitch (confused/rooted/chomped/dodgy-snack/gaze) — reserves never have one, so skip them.
          // Pass the REAL playerState (not the faked-STUNNED lying stub); bloodlust is an acting-player
          // property → false. Markers are token children so they ride the dugout token's scale.
          if (section.label !== 'RESERVES') this.addStateMarkers(token, data.playerState, false, data.playerId);
          // owner 2026-07-08: register this dugout token for the direct proximity hit-test
          // (it's outside the pitch bands, so the square lookup can't select it → no card).
          this.dugoutHits.push({ x: anchor.x, y: anchor.y, r: TILE_W * 0.55 * scale, playerId: data.playerId });
          const marker = this.buildInjuryMarker(baseState(data.playerState));
          if (marker) {
            // ~6px gap above the head (classic icon tops out ~21px over the anchor; walkers report figure bounds)
            marker.position.set(anchor.x, Math.min(anchor.y - 27 * scale, anchor.y + token.getLocalBounds().minY * token.scale.y - 6 * scale));
            marker.scale.set(scale);
            marker.zIndex = this.depthZ(x, column) + 1;
            this.dugoutLayer.addChild(marker);
          }
          } catch (err) {
            if (token && !token.destroyed && token.parent == null) token.destroy({ children: true });
            console.warn('ffb-pitch: dugout token render failed', data.playerId, err);
          }
        });
      }

      // #133 (owner 07-22): SENT-OFF (BANNED) players stand FREE in the corner apron BESIDE the CAS box,
      // toward the end-zone corner — NO boxed section, no label; rowed left-to-right as they accumulate, each
      // topped with a ref send-off card (🟥) instead of the CAS red-cross. They're claimed out of the RESERVES
      // catch-all above but have no section, so they're drawn here. ⚠ exact spot = owner-fg (#89, not rig-visible).
      const banned = offPitch.filter((d) => baseState(d.playerState) === PlayerStateBase.BANNED);
      banned.forEach((data, i) => {
        let token: Container | undefined;
        try {
          const player = team.playerArray.find((p) => p.playerId === data.playerId);
          if (!player) return;
          // Owner 09-06: the apron square directly BEYOND the CAS box on the end-zone side — below it for home
          // (x -1 under CAS x0..2), above it for away (x 26 over CAS x23..25) — filling the box's own columns from
          // the pitch side outward, then the next apron row out for overflow.
          const casCols = isHome ? columns : [...columns].reverse();
          const cornerX = (isHome ? -1 : 26) + (isHome ? -1 : 1) * Math.floor(i / casCols.length);
          const bCol = casCols[i % casCols.length]!;
          const anchor = squareAnchor(cornerX, bCol);
          const scale = depthScale(cornerX, bCol) * strengthScale(player.strength);
          const stub: PlayerDataJson = { ...data, playerCoordinate: [cornerX, bCol] }; // stand at the apron square (banned aren't a down/lying pose)
          token = this.buildPlayerToken(player, stub, isHome, team, undefined, true, false, false);
          token.position.set(anchor.x, anchor.y);
          token.scale.set(isWalkerToken(token) ? 1 : scale);
          if (isWalkerToken(token)) registerLiveWalker(token);
          token.zIndex = this.depthZ(cornerX, bCol);
          this.dugoutLayer.addChild(token);
          this.dugoutTokensById.set(data.playerId, token);
          this.dugoutCompartmentById.set(data.playerId, 'banned');
          this.dugoutHits.push({ x: anchor.x, y: anchor.y, r: TILE_W * 0.55 * scale, playerId: data.playerId });
          const card = new Text({
            text: '🟥',
            style: { fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif', fontSize: 16 },
          });
          card.anchor.set(0.5, 0.5);
          card.position.set(anchor.x, Math.min(anchor.y - 27 * scale, anchor.y + token.getLocalBounds().minY * token.scale.y - 6 * scale));
          card.scale.set(scale);
          card.zIndex = this.depthZ(cornerX, bCol) + 1;
          this.dugoutLayer.addChild(card);
        } catch (err) {
          if (token && !token.destroyed && token.parent == null) token.destroy({ children: true });
          console.warn('ffb-pitch: banned token render failed', data.playerId, err);
        }
      });
    }
  }

  /** Owner 2026-07-07: the SCORE / TURN-TIMER / RE-ROLL tracks. Two MIRRORED 3-column × 9-row
   *  grids (owner: "mirrored sides") — HOME on the SW margin (opposite the home dugout), AWAY
   *  on the NE margin (opposite the away dugout). Each: stone ground, gold trim, white cell
   *  separators, outlined numbers; a header nearest the LOS then 1..8 with 8 nearest that team's
   *  end zone. Columns L→R: #Re-rolls / Turn timer / Score, with the die / hourglass / skull
   *  tokens riding the columns on that team's live values. */
  private drawTurnTrack(): void {
    for (const child of this.turnTrackLayer.removeChildren()) child.destroy({ children: true });
    this.turnTrackLayer.sortableChildren = true;
    // gated on dugoutsEnabled so FUMBBL-Classic (which disables the on-pitch dugouts) also
    // hides the on-pitch tracks — classic carries the info in its sidebars.
    if (!this.game || !this.dugoutsEnabled || !this.turnTrackEnabled) return;
    this.drawOneTrack(true); // home — SW (west margin, south rows)
    this.drawOneTrack(false); // away — NE (east margin, north rows), mirrored
  }

  /** Owner 2026-07-07: toggle the on-pitch turn/score/re-roll tracks (Settings › UI) + redraw. */
  setTurnTrackEnabled(on: boolean): void {
    this.turnTrackEnabled = on;
    this.drawTurnTrack();
  }

  private fantasyCursorEnabled = true;

  private restingCursor(): string {
    return this.fantasyCursorEnabled ? SPIKE_CURSOR : 'default';
  }

  private primedCursor(): string {
    return this.fantasyCursorEnabled ? SPIKE_CURSOR_PRIMED : 'pointer';
  }

  /** Toggle generic cursor art while retaining semantic action cursors. */
  setFantasyCursorEnabled(enabled: boolean): void {
    if (this.fantasyCursorEnabled === enabled) return;
    this.fantasyCursorEnabled = enabled;
    const canvas = this.app?.canvas;
    if (!canvas) return;
    if (canvas.style.cursor === SPIKE_CURSOR || canvas.style.cursor === 'default') {
      canvas.style.cursor = this.restingCursor();
    } else if (canvas.style.cursor === SPIKE_CURSOR_PRIMED || canvas.style.cursor === 'pointer') {
      canvas.style.cursor = this.primedCursor();
    }
  }

  /** Match Modern's HUD style while preserving an on-field material vocabulary. Chrome uses
   *  bolted sideline metal and recessed stone; Minimalist is byte-for-byte the former drawing. */
  setOnPitchPresentationStyle(style: 'chrome' | 'minimalist'): void {
    const chrome = style === 'chrome';
    const changed = !this.modernPitchPresentation || this.chromePitchPresentation !== chrome;
    this.modernPitchPresentation = true;
    this.chromePitchPresentation = chrome;
    if (!changed) return;
    this.drawDugouts();
    this.drawTurnTrack();
  }

  /** One team's turn/score/re-roll grid. Home: west margin (columns −3.5..−1.5, a half-square gap
   *  from the pitch), south rows x0..x8 with the header at x8 (LOS) and 8 at x0 (south end zone).
   *  Away mirrors: east margin (PITCH_ROWS+0.5..+2.5), north rows x17..x25, header at x17, 8 at x25. */
  private drawOneTrack(isHome: boolean): void {
    const columns = isHome
      ? [-3.5, -2.5, -1.5]
      // #197 (owner): the SCORE column (ci 2) must sit on the INSIDE (pitch-facing) edge for BOTH teams.
      // Home's west margin already puts ci 2 at -1.5 (nearest the pitch). The away east margin was a straight
      // copy (ci 2 → +2.5, the OUTSIDE edge), so REVERSE the away column order — ci 0(RR)/1(turn)/2(score)
      // now map to +2.5/+1.5/+0.5, mirroring home so the score piece faces the pitch. columns[ci] drives the
      // header, the numbered cells, and placeToken alike, so all three columns mirror together as units.
      : [PITCH_ROWS + 2.5, PITCH_ROWS + 1.5, PITCH_ROWS + 0.5];
    const headerX = isHome ? 8 : 17; // header row, nearest the LOS
    const dir = isHome ? -1 : 1; // step toward this team's end zone (home south, away north)
    const rowOf = (v: number) => headerX + dir * v; // v=0 → header; v=1..8 → number cells
    // #213-b (owner 08-04 — REVERSES #213's screen-direction mirror): the away numbers must TRAVEL
    // TOWARD the away end zone the way home's do toward its own — 1 nearest the LOS (header), 8 nearest
    // the end zone. That is exactly rowOf(v) for BOTH teams (away's dir=+1 already steps north to x25);
    // the former `9-v` away mirror made them read home's SCREEN direction, which the owner overruled.
    // cellOf is now identity-with-rowOf but kept as the single value→cell seam (header at v=0).
    const cellOf = (v: number) => rowOf(v);
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(rowOf);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...columns);
    const yMax = Math.max(...columns);
    const physicalChrome = this.chromePitchPresentation;
    const trim = physicalChrome ? (isHome ? 0x3a6fc0 : 0xb83a40) : 0xc9a23a;
    // E-W token vanish (owner 08-19): depthZKey is a raw SCREEN Y, and beyond the FAR boundary
    // (the E-W far-margin track — home when fieldFlip, away otherwise) it extrapolates NEGATIVE
    // (≈ −71). The tokens' depthZ+5 then sorted UNDER the ground's constant zIndex −1 and the
    // opaque stone painted over them. Anchor EVERY layer of this track off the same depthZ
    // family: ground below the track's minimum cell depthZ, cell content at its own depthZ.
    const groundZ = Math.min(...xs.flatMap((x) => columns.map((y) => this.depthZ(x, y)))) - 10;

    // --- stone ground (same recipe as the dugout) ---
    const ground = new Graphics();
    for (let x = xMin; x <= xMax; x++) {
      for (const y of columns) {
        const quad = squareQuad(x, y);
        if (this.stoneTexture) {
          const matrix = this.tileTexMatrix(x, y, this.stoneTexture.width, this.stoneTexture.height);
          ground.poly(quad.points.flat()).fill({ texture: this.stoneTexture, matrix });
          ground.poly(quad.points.flat()).fill({ color: 0x0a0c10, alpha: 0.22 });
        } else {
          ground.poly(quad.points.flat()).fill({ color: 0x2a2d34 });
        }
        if (physicalChrome) {
          ground.poly(quad.points.flat()).fill({ color: 0x070a0d, alpha: 0.58 });
          ground.poly(quad.points.flat()).stroke({ color: 0x747b84, width: 0.8, alpha: 0.58 });
        }
      }
    }
    // trim rectangle from grid corners (extPoint — no E-W shear), like the dugout
    const dt = [extPoint(xMin, yMin), extPoint(xMin, yMax + 1), extPoint(xMax + 1, yMax + 1), extPoint(xMax + 1, yMin)];
    const trackOutline = dt.flatMap((p) => [p.x, p.y]);
    if (physicalChrome) {
      ground.poly(trackOutline).stroke({ color: 0x080a0d, width: 6, alpha: 0.96 });
      ground.poly(trackOutline).stroke({ color: 0x7a818a, width: 3.4, alpha: 0.9 });
    }
    ground.poly(trackOutline).stroke({ color: trim, width: physicalChrome ? 2 : 2, alpha: physicalChrome ? 1 : 0.8 });
    if (physicalChrome) {
      for (const corner of dt) {
        ground.circle(corner.x, corner.y, 2.2).fill({ color: 0x171b20 }).stroke({ color: 0xb7bcc2, width: 0.8, alpha: 0.92 });
      }
    }
    // white cell separators on every internal row + column boundary → reads as a grid
    for (let x = xMin + 1; x <= xMax; x++) {
      const a = extPoint(x, yMin);
      const c = extPoint(x, yMax + 1);
      ground.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: COLORS.line, width: 1.5, alpha: 0.55 });
    }
    for (const y of [yMin + 1, yMax]) {
      const a = extPoint(xMin, y);
      const c = extPoint(xMax + 1, y);
      ground.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: COLORS.line, width: 1.5, alpha: 0.55 });
    }
    ground.zIndex = groundZ;
    this.turnTrackLayer.addChild(ground);

    // --- header row + numbered cells ---
    const headers = ['RR', '🕐', '🏈']; // left=re-rolls (icon), centre=turn timer (clock), right=score (owner emoji)
    columns.forEach((y, ci) => {
      const hquad = squareQuad(headerX, y);
      const hband = new Graphics();
      if (physicalChrome) hband.poly(hquad.points.flat()).fill({ color: 0x080b0f, alpha: 0.9 });
      hband.poly(hquad.points.flat()).fill({ color: trim, alpha: physicalChrome ? 0.48 : 0.28 });
      if (physicalChrome) hband.poly(hquad.points.flat()).stroke({ color: trim, width: 1.2, alpha: 0.9 });
      hband.zIndex = this.depthZ(headerX, y) + 0.25; // over the ground, under the header icon/label
      this.turnTrackLayer.addChild(hband);
      const hMid = squareAnchor(headerX, y);
      const hsc = depthScale(headerX, y);
      // owner 2026-07-07: the re-roll column (ci 0) carries the TRR inducement icon (else text).
      if (ci === 0 && this.tokenRerollIcon) {
        const icon = new Sprite(this.tokenRerollIcon);
        icon.anchor.set(0.5);
        icon.scale.set((TILE_W * 0.62 * hsc) / this.tokenRerollIcon.width);
        icon.position.set(hMid.x, hMid.y);
        icon.zIndex = this.depthZ(headerX, y) + 0.5;
        this.turnTrackLayer.addChild(icon);
      } else {
        const hLabel = new Text({ text: headers[ci]!, style: TURN_TRACK_EMOJI_STYLE });
        hLabel.anchor.set(0.5);
        hLabel.scale.set(hsc);
        hLabel.position.set(hMid.x, hMid.y);
        hLabel.zIndex = this.depthZ(headerX, y) + 0.5;
        this.turnTrackLayer.addChild(hLabel);
      }
      for (let v = 1; v <= 8; v++) {
        const x = cellOf(v);
        const mid = squareAnchor(x, y);
        const t = new Text({ text: String(v), style: TURN_TRACK_STYLE });
        t.anchor.set(0.5);
        t.scale.set(depthScale(x, y));
        t.position.set(mid.x, mid.y);
        t.zIndex = this.depthZ(x, y) + 1; // under the tokens (+5) at the same cell
        this.turnTrackLayer.addChild(t);
      }
    });

    // --- data-driven tokens: die = re-rolls (left), hourglass = turn (centre), skull = score
    // (right), read from THIS team's live state; a value V rides the cell showing V (0 → header). ---
    const gr = this.game!.gameResult as { teamResultHome?: { score?: number }; teamResultAway?: { score?: number } } | undefined;
    const td = (isHome ? this.game!.turnDataHome : this.game!.turnDataAway) as { turnNr?: number; reRolls?: number } | undefined;
    const score = (isHome ? gr?.teamResultHome?.score : gr?.teamResultAway?.score) ?? 0;
    const placeToken = (tex: Texture | null, colIdx: number, value: number) => {
      if (!tex) return;
      const x = cellOf(Math.max(0, Math.min(8, value))); // value 0 → header row; 1..8 ride the numbered cells (cellOf = rowOf both teams, #213-b)
      const y = columns[colIdx]!;
      const mid = squareAnchor(x, y);
      const sc = depthScale(x, y);
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 0.82); // stand the token's base in the cell, piece rising out of it
      sp.scale.set((TILE_W * 0.576 * sc) / tex.width); // owner 2026-07-07: −20% (was 0.72)
      sp.position.set(mid.x, mid.y);
      sp.zIndex = this.depthZ(x, y) + 5; // above the ground + numbers
      this.turnTrackLayer.addChild(sp);
    };
    placeToken(this.tokenDie, 0, td?.reRolls ?? 0); // left column = re-rolls remaining (#TRR ↓)
    placeToken(this.tokenHourglass, 1, td?.turnNr ?? 0); // centre column = turn number
    placeToken(this.tokenScore, 2, score); // right column = score (TD ↑)
    this.drawApothecaryBox(isHome, columns, headerX, dir, trim);
  }

  /** A detached, single-cell apothecary station on the midfield side of the turn track. A full
   *  projected cell remains empty between it and the tracker, so this reads as a physical sideline
   *  object rather than a fourth tracker row. The compact label sits below the token socket.
   *  State is SERVER-DERIVED only, via apoBoxState (team.apothecaries = game-START roster
   *  count, never mutated post-load; turnData.apothecaries = live count, decremented by
   *  TURN_DATA_SET_APOTHECARIES on use):
   *   - absent  → team never rostered one: nothing renders.
   *   - empty   → rostered but used up: label + stone/gold frame, no token.
   *   - token   → available: the apothecary sprite stands inside the box.
   *  Team apothecaries only — wanderingApothecaries (a separate TurnDataJson field) is not
   *  represented by this box. */
  private drawApothecaryBox(isHome: boolean, columns: number[], headerX: number, dir: number, trim: number): void {
    const team = isHome ? this.game!.teamHome : this.game!.teamAway;
    const td = (isHome ? this.game!.turnDataHome : this.game!.turnDataAway) as { apothecaries?: number } | undefined;
    const state = apoBoxState(team?.apothecaries, td?.apothecaries);
    if (state === 'absent') return;

    const apoX = headerX - dir * APOTHECARY_STATION_LAYOUT.stationRowOffset;
    const boxY = columns[APOTHECARY_STATION_LAYOUT.columnIndex]!; // aligned over the RR (outer) column

    // --- one token-sized stone socket with the same physical sideline materials as the track ---
    const ground = new Graphics();
    const quad = squareQuad(apoX, boxY);
    if (this.stoneTexture) {
      const matrix = this.tileTexMatrix(apoX, boxY, this.stoneTexture.width, this.stoneTexture.height);
      ground.poly(quad.points.flat()).fill({ texture: this.stoneTexture, matrix });
      ground.poly(quad.points.flat()).fill({ color: 0x0a0c10, alpha: 0.22 });
    } else {
      ground.poly(quad.points.flat()).fill({ color: 0x2a2d34 });
    }
    if (this.chromePitchPresentation) {
      ground.poly(quad.points.flat()).fill({ color: 0x080b0e, alpha: 0.55 });
      ground.poly(quad.points.flat()).stroke({ color: 0x707780, width: 0.8, alpha: 0.62 });
    }
    const dt = [extPoint(apoX, boxY), extPoint(apoX + 1, boxY), extPoint(apoX + 1, boxY + 1), extPoint(apoX, boxY + 1)];
    const apoOutline = dt.flatMap((p) => [p.x, p.y]);
    if (this.chromePitchPresentation) {
      ground.poly(apoOutline).stroke({ color: 0x080a0d, width: 5, alpha: 0.95 });
      ground.poly(apoOutline).stroke({ color: 0x747b84, width: 3, alpha: 0.9 });
    }
    ground.poly(apoOutline).stroke({ color: trim, width: 2, alpha: this.chromePitchPresentation ? 1 : 0.8 });
    // depthZ-anchored like drawOneTrack (E-W far-margin depthZ is NEGATIVE — constants sank the token).
    ground.zIndex = this.depthZ(apoX, boxY) - 10;
    this.turnTrackLayer.addChild(ground);

    // Compact ground-plane caption at the near side of the station; the socket itself is
    // reserved for the token. Its position and non-uniform scale come from the same projected
    // quad as the box, avoiding the old screen-Y offset/perspective mismatch.
    const label = new Text({ text: 'APOTHECARY', style: DUGOUT_LABEL_STYLE });
    label.anchor.set(0.5);
    const stationScale = depthScale(apoX, boxY);
    const labelBounds = label.getLocalBounds();
    const labelPlacement = projectedApothecaryLabelPlacement(quad, labelBounds.width, labelBounds.height);
    label.scale.set(labelPlacement.scaleX, labelPlacement.scaleY);
    label.position.set(labelPlacement.x, labelPlacement.y);
    label.zIndex = this.depthZ(apoX, boxY) + 6;
    this.turnTrackLayer.addChild(label);

    if (state === 'token' && this.apothecaryTexture) {
      const ds = stationScale;
      const mid = squareAnchor(apoX, boxY);
      const apo = new Sprite(this.apothecaryTexture);
      apo.anchor.set(0.5, 0.82); // stand the token's base in the cell, matching placeToken's convention
      const scale = apothecaryTokenScale(
        isHome,
        (TILE_W * APOTHECARY_STATION_LAYOUT.tokenSizeTiles * ds) / Math.max(this.apothecaryTexture.width, this.apothecaryTexture.height),
        this.fieldFlipMode,
      );
      apo.scale.set(scale.x, scale.y);
      apo.position.set(mid.x, mid.y);
      apo.zIndex = this.depthZ(apoX, boxY) + 5;
      this.turnTrackLayer.addChild(apo);
    }
  }

  /** BB3-style status marker: K.O. text / red cross (casualty) / red skull
   *  (dead), each on a soft dark shadow disc for readability over the stone. */
  private buildInjuryMarker(base: number): Container | null {
    const withShadow = (content: Container | Text, w: number, h: number): Container => {
      const marker = new Container();
      marker.addChild(
        new Graphics()
          .ellipse(0, 0, w / 2 + 4, h / 2 + 3)
          .fill({ color: 0x000000, alpha: 0.3 }),
      );
      marker.addChild(content);
      return marker;
    };
    if (base === PlayerStateBase.KNOCKED_OUT) {
      const ko = new Text({ text: 'K.O.', style: KO_STYLE });
      ko.anchor.set(0.5, 0.5);
      ko.angle = -12; // old-Batman-cartoon slant
      return withShadow(ko, 34, 16);
    }
    if (base === PlayerStateBase.RIP) {
      // Owner: the dedicated casualty skull with the existing red death treatment.
      const skullTex = this.casualtySkullTexture;
      if (skullTex) {
        const skull = new Sprite(skullTex);
        skull.anchor.set(0.5, 0.5);
        skull.width = 20;
        skull.height = 20;
        skull.tint = 0xff2a2a; // red shader
        return withShadow(skull, 20, 20);
      }
      const skull = new Text({ text: '☠', style: SKULL_STYLE });
      skull.anchor.set(0.5, 0.5);
      return withShadow(skull, 18, 18);
    }
    if (
      base === PlayerStateBase.BADLY_HURT ||
      base === PlayerStateBase.SERIOUS_INJURY ||
      base === PlayerStateBase.BANNED
    ) {
      const cross = new Graphics()
        .roundRect(-2.5, -9, 5, 18, 1.5)
        .fill(0xd82020)
        .roundRect(-9, -2.5, 18, 5, 1.5)
        .fill(0xd82020);
      return withShadow(cross, 18, 18);
    }
    return null;
  }

  /** Available turf theme names for UI pickers (tiles + weather pitch packs). */
  /** Owner 2026-09-04: the local Super FUMBBL weather family is always first. Optional mod families are
   *  listed only while an installed asset pack supplies at least one weather binding. */
  turfOptions(): string[] {
    const bound = new Set<string>();
    for (const key of fumbblPitchFallbacks.keys()) bound.add(key.split(':')[0]!);
    return [...new Set([...Object.keys(BUNDLED_WEATHER_PITCHES), ...this.turfThemes.keys(), ...Object.keys(FUMBBL_PITCHES).filter((id) => bound.has(id))])];
  }

  /** #157 (owner 07-23): the RESOLVED home/away seat colours — the SAME source the pitch tokens use
   *  for their body colour (home defends south = blue, away north = red). Exposed read-only so the log
   *  can tint player NAMES by seat from a single source of truth (no second palette); reading it live
   *  means any future theming of these colours propagates to the log automatically. `body` is the strong
   *  seat-identity colour (use this for name tint); `trim` is the lighter accent, offered for completeness.
   *  Values are 0xRRGGBB ints — a consumer formats to CSS as `#${n.toString(16).padStart(6,'0')}`. */
  seatColors(): { home: { body: number; trim: number }; away: { body: number; trim: number } } {
    return {
      home: { body: COLORS.homeBody, trim: COLORS.homeTrim },
      away: { body: COLORS.awayBody, trim: COLORS.awayTrim },
    };
  }

  /** Switches the turf theme (tile theme or a FUMBBL pitch pack) and redraws. */
  setTurf(theme: string): void {
    const isPitch = isWeatherPitchTheme(theme);
    if (!isPitch && !this.turfThemes.has(theme)) return;
    this.turfTheme = theme;
    for (const child of this.pitchLayer.removeChildren()) child.destroy({ children: true });
    if (isPitch) {
      // Draw a plain fallback immediately, then replace it once the selected
      // family's authoritative-weather image has loaded.
      this.drawPitch();
      void this.ensureAndDrawPitch();
    } else {
      this.drawPitch();
    }
  }

  /** Retry the current turf after the installed pitch registry changes.
   *  A prior miss must not stay sticky merely because the theme/weather key did
   *  not change, and a replaced pack must not reuse its predecessor's texture. */
  refreshPitchAssets(): void {
    this.pitchDrawRequestGeneration++;
    this.pitchTextures.clear();
    this.pitchLuminance.clear();
    this.lastPitchWeather = null;
    this.setTurf(this.turfTheme);
  }

  /** Sample the decoded pitch image at low resolution for its mean luminance (0.35 when it cannot be read). */
  private measurePitchLuminance(tex: Texture): number {
    try {
      const resource = (tex.source as { resource?: CanvasImageSource }).resource;
      if (!resource || typeof document === 'undefined') return 0.35;
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 0.35;
      ctx.drawImage(resource, 0, 0, 32, 32);
      return meanLuminance(ctx.getImageData(0, 0, 32, 32).data);
    } catch {
      return 0.35;
    }
  }

  /** Load (once) the pitch image for a pack + weather; returns null on failure. */
  private async ensurePitchLoaded(
    theme: string,
    weather: string,
    requestActive: () => boolean,
  ): Promise<Texture | null> {
    const key = `${theme}:${weather}`;
    const cached = this.pitchTextures.get(key);
    if (cached) return cached;
    const bundledUrl = BUNDLED_WEATHER_PITCHES[theme]?.[weather];
    const modUrl = theme in FUMBBL_PITCHES ? fumbblPitchFallbacks.get(key) : undefined;
    if (!bundledUrl && !modUrl) return null;
    for (const url of [bundledUrl, modUrl]) {
      if (!url) continue;
      try {
        // Installed asset URLs end in an opaque integrity token rather than a
        // filename. Select the image parser explicitly: Pixi cannot infer it
        // from an extensionless f40kmod URL and otherwise resolves no texture.
        const tex = await Assets.load<Texture>({ src: url, parser: 'loadTextures' });
        if (!(tex instanceof Texture) || !tex.source) {
          throw new Error('Installed pitch texture could not be decoded');
        }
        if (!requestActive()) return null;
        tex.source.scaleMode = 'linear';
        this.pitchTextures.set(key, tex);
        this.pitchLuminance.set(key, this.measurePitchLuminance(tex));
        return tex;
      } catch {
        // A broken optional pack falls back to the original procedural turf.
      }
    }
    return null;
  }

  /** Resolve the pitch weather from the model, load it, and redraw the pitch. */
  private async ensureAndDrawPitch(): Promise<void> {
    const app = this.app;
    if (!app || this.destroyed) return;
    const initGeneration = this.initGeneration;
    const requestGeneration = ++this.pitchDrawRequestGeneration;
    const theme = this.turfTheme;
    const weather = pitchWeatherKey(this.game?.fieldModel.weather);
    const requestActive = () => !this.destroyed
      && this.app === app
      && this.initGeneration === initGeneration
      && this.pitchDrawRequestGeneration === requestGeneration
      && this.turfTheme === theme;
    await this.ensurePitchLoaded(theme, weather, requestActive);
    if (requestActive() && isWeatherPitchTheme(theme)) this.drawPitch();
  }

  /** Accessibility (owner 2026-07-03 r3): toggle the pitch grid, and set its
   *  line-width multiplier + colour. Re-runs drawPitch so it takes effect live. */
  setGridOptions(opts: { show?: boolean; widthMul?: number; color?: number; alphaMul?: number }): void {
    if (opts.show !== undefined) this.gridShow = opts.show;
    if (opts.widthMul !== undefined) this.gridWidthMul = Math.max(0.1, opts.widthMul); // owner 09-05: sub-1x widths
    if (opts.color !== undefined) this.gridColor = opts.color;
    if (opts.alphaMul !== undefined) this.gridAlphaMul = Math.min(1, Math.max(0.05, opts.alphaMul));
    if (this.app) this.drawPitch();
  }

  /** Owner 2026-07-08: end-zone label — team name (FUMBBL) or "TOUCHDOWN". */
  setEndZoneLabel(mode: 'team' | 'touchdown'): void {
    this.endZoneLabel = mode;
    if (this.app) this.drawPitch();
  }
  /** Owner 09-05: the red/blue team shading over the end zones (tile turf + Acasas pack) can be switched off. */
  private endZoneTint = true;
  setEndZoneTint(on: boolean): void {
    if (this.endZoneTint === on) return;
    this.endZoneTint = on;
    if (this.app) this.drawPitch();
  }

  /** WASD camera pan (owner 2026-07-03 r3): shift the world by screen pixels. */
  panCamera(dx: number, dy: number): void {
    if (!this.app) return;
    if (dx !== 0 || dy !== 0) this.noteManualCameraInput();
    this.world.position.x += dx;
    this.world.position.y += dy;
  }

  /** Owner 2026-07-04: smooth WASD camera glide. `dx`/`dy` are the held-key pan
   *  DIRECTION on each axis (-1 / 0 / +1); the ticker eases the world toward that
   *  velocity and glides to a stop when the direction returns to 0 (key release). */
  private panDir = { x: 0, y: 0 };
  private panVel = { x: 0, y: 0 };
  /** Owner 09-05: WASD glide speed in screen px per frame (Settings > Controls; 9 = the original). */
  private panSpeedPx = 9;
  setPanSpeed(pxPerFrame: number): void { this.panSpeedPx = Math.min(30, Math.max(2, pxPerFrame || 9)); }
  setPanDirection(dx: number, dy: number): void {
    if (dx !== 0 || dy !== 0) this.noteManualCameraInput();
    this.panDir.x = Math.sign(dx);
    this.panDir.y = Math.sign(dy);
  }

  /** Accessibility (owner 2026-07-03 r4): toggle the on-field row markers, the
   *  sweet-spot crosshairs, and the faded on-field team logos. */
  setFieldMarkers(opts: { rowMarkers?: boolean; sweetSpot?: boolean; fieldLogos?: boolean; rowNumberRails?: boolean }): void {
    if (opts.rowMarkers !== undefined) this.showRowMarkers = opts.rowMarkers;
    if (opts.sweetSpot !== undefined) this.showSweetSpot = opts.sweetSpot;
    if (opts.fieldLogos !== undefined) this.showFieldLogos = opts.fieldLogos;
    if (opts.rowNumberRails !== undefined) this.showRowNumberRails = opts.rowNumberRails;
    if (!this.app) return;
    this.drawPitch(); // row markers
    void this.setSweetSpotLogos(this.lastSweetSpotUrls.home, this.lastSweetSpotUrls.away); // sweet spot + logos
  }

  /** Position-ring styling (owner 2026-07-03 r4): density (alpha multiplier) and
   *  an optional colour override (null = the per-position palette). Refreshes. */
  setPositionRingOptions(opts: { density?: number; color?: number | null }): void {
    if (opts.density !== undefined) this.ringDensity = Math.max(0.2, opts.density);
    if (opts.color !== undefined) this.ringColorOverride = opts.color;
    if (this.app) this.refresh();
  }

  /** Owner 2026-07-04: where the on-pitch die-roll-CAUSE tag sits — 'bottom'
   *  (default, half-on/half-off the die), 'top', 'side' (the old to-the-side
   *  rendering), or 'off'. Applies to dice popped after the change. */
  setDieTagPosition(pos: 'corner' | 'top' | 'side' | 'bottom' | 'off'): void {
    this.dieTagPosition = pos;
  }

  /** Hot-swap every HTML and Pixi D6 surface without touching authoritative dice state. */
  setD6FaceVariant(variant: D6FaceVariant): void {
    if (variant === this.d6FaceVariant) return;
    this.d6FaceVariant = variant;
    // Before init, the normal asset-loading pass will consume the selected variant.
    if (!this.app || this.d6FaceTextures.length === 0) return;
    void this.loadD6FaceTextures(variant).then(() => {
      if (this.app && this.d6FaceVariant === variant) this.refresh();
    }).catch((error) => {
      console.warn(`ffb-pitch: ${variant} d6 faces failed to load, retaining the previous set`, error);
    });
  }

  private async loadD6FaceTextures(variant: D6FaceVariant): Promise<void> {
    const generation = ++this.d6FaceLoadGeneration;
    const textures = await Promise.all(D6_FACE_VALUES.map(async (value) => {
      try { return await Assets.load<Texture>(d6FaceUrl(value, variant)); }
      catch { return undefined; }
    }));
    if (generation !== this.d6FaceLoadGeneration || variant !== this.d6FaceVariant) return;
    this.d6FaceTextures = textures;
  }

  /** Owner 2026-07-04: enter/leave interactive setup. When active, taps route to
   *  onSetupClick and the LOS + wide zones shade green (legal) / red (illegal).
   *  Home-relative: own half x 0..12, LOS x=12, wide columns y 0..3 & 11..14. */
  setSetup(active: boolean, zones: { losOk: boolean; leftOk: boolean; rightOk: boolean } | null): void {
    this.setupActive = active;
    this.lastSetupZones = active ? zones : null;
    if (!active) this.setupSelectedPlayerId = null;
    for (const c of this.setupZoneLayer.removeChildren()) c.destroy();
    if (!active) {
      if (this.app) this.refresh();
      return;
    }
    if (!zones || !this.app) return;
    const shade = (squares: [number, number][], ok: boolean) => {
      const g = new Graphics();
      const color = ok ? 0x22c04a : 0xd83a3a;
      for (const [x, y] of squares) {
        const q = squareQuad(x, y);
        g.poly(q.points.flat()).fill({ color, alpha: 0.2 });
      }
      // outline the zone edge for definition
      for (const [x, y] of squares) {
        const q = squareQuad(x, y);
        g.poly(q.points.flat()).stroke({ color, width: 1, alpha: 0.5 });
      }
      this.setupZoneLayer.addChild(g);
    };
    const ownX: number[] = [];
    for (let x = 0; x <= SETUP_OWN_HALF_MAX_X; x++) ownX.push(x);
    const losSquares: [number, number][] = [];
    for (let y = 0; y < PITCH_ROWS; y++) losSquares.push([SETUP_LOS_X, y]);
    const leftSquares: [number, number][] = [];
    const rightSquares: [number, number][] = [];
    for (const x of ownX) {
      for (let y = 0; y < WIDE_ZONE_WIDTH; y++) leftSquares.push([x, y]);
      for (let y = PITCH_ROWS - WIDE_ZONE_WIDTH; y < PITCH_ROWS; y++) rightSquares.push([x, y]);
    }
    shade(leftSquares, zones.leftOk);
    shade(rightSquares, zones.rightOk);
    shade(losSquares, zones.losOk); // LOS drawn last so its row reads over the wide overlap
  }

  /** Owner 09-09: re-shade the setup legality zones at the CURRENT geometry (after an orientation / flat / flip
   *  toggle); a no-op outside interactive setup. */
  private redrawSetupZones(): void {
    if (!this.setupActive) return;
    const zones = this.lastSetupZones;
    for (const c of this.setupZoneLayer.removeChildren()) c.destroy();
    if (zones) this.setSetup(true, zones);
  }

  /** Presentation-only feed for the view-local setup placement picker. */
  setSetupSelectedPlayer(playerId: string | null): void {
    if (playerId === this.setupSelectedPlayerId) return;
    this.setupSelectedPlayerId = playerId;
    if (this.app) this.refresh();
  }

  /** Available sprite sets for UI pickers; the standard set lists first. */
  spriteSetOptions(): string[] {
    return ['classic', 'checkers', 'walk'];
  }

  /** Switches between FUMBBL Classic iconsets and checker discs (UI-5;
   *  'new' HD-2D stays accepted programmatically but is out of the UI). */
  setSpriteSet(set: string): void {
    if ((set !== 'new' && set !== 'classic' && set !== 'checkers' && set !== 'walk') || set === this.spriteSet) return;
    const priorClassicLease = this.classicIconLease;
    this.classicIconLease = null;
    const leaseGeneration = ++this.classicIconLeaseGeneration;
    this.classicIconAcquireAbort?.abort();
    this.classicIconAcquireAbort = null;
    // Owner 09-05: there is no separate 'classic' path any more — the value is accepted from old settings and
    // behaves as the chain (user-selected > installed mods (incl. FUMBBL upstream) > placeholder).
    this.spriteSet = set === 'classic' ? 'walk' : set;
    if (this.spriteSet !== 'checkers' && this.game) {
      const acquireAbort = new AbortController();
      this.classicIconAcquireAbort = acquireAbort;
      void acquireClassicIcons(this.game, acquireAbort.signal, (team, positionId) => this.modTierIconNeeded(team, positionId)).then((lease) => {
        if (leaseGeneration !== this.classicIconLeaseGeneration || this.spriteSet === 'checkers') {
          lease.release();
          return;
        }
        this.classicIconAcquireAbort = null;
        this.classicIconLease = lease;
        priorClassicLease?.release();
        this.refresh();
        this.onPortraitVisualRevision?.();
      });
    } else {
      priorClassicLease?.release();
    }
    if (this.spriteSet === 'walk') this.preloadBundledWalkSheets();
    this.refresh();
  }

  /** Owner 09-05 (round 15): every sprite source a roster can draw from is loaded at GAME LOAD (the bundled Super
   *  FUMBBL walkers for both teams here; pack icons ride the classic-icon lease) so a hot swap never waits or fails.
   *  Only the current game's rosters load — never the whole 326-sheet manifest. */
  private preloadBundledWalkSheets(): void {
    const races = [this.game?.teamHome?.race, this.game?.teamAway?.race].filter((race): race is string => !!race);
    if (races.length === 0) return;
    // Owner 09-09: star players ride the 'stars' pseudo-race — preload only the stars these two rosters carry.
    const starNames: string[] = [];
    for (const team of [this.game?.teamHome, this.game?.teamAway]) {
      const positions = (team?.roster as { positionArray?: { positionName?: string }[] } | undefined)?.positionArray ?? [];
      for (const position of positions) if (isBundledStarRole(position.positionName)) starNames.push(position.positionName!);
    }
    void loadBundledWalkSheets(bundledWalkEntriesForRaces(races, starNames)).then(() => {
      if (!this.destroyed && this.spriteSet === 'walk') this.refresh();
    });
  }

  /** Use the first variant from each position's active icon sheet for every
   * player in that position. Model fields and custom asset-pack bindings stay intact. */
  setOneSpritePerPosition(enabled: boolean): void {
    if (enabled === this.oneSpritePerPosition) return;
    this.oneSpritePerPosition = enabled;
    if (this.app) this.refresh();
    this.onPortraitVisualRevision?.();
  }

  /**
   * Standard video options (F-2, owner 2026-07-02): render resolution scale
   * (0 = match devicePixelRatio) and FPS cap (0 = uncapped).
   */
  setVideoOptions(options: { renderScale?: number; fpsCap?: number }): void {
    if (!this.app) return;
    // Owner 09-05: the scale is a MULTIPLIER of the display's device pixel ratio — 100% = one canvas pixel per
    // PHYSICAL pixel (the OS no longer resamples the canvas: Windows 125/150/250% scaling made every 'native' sprite
    // blur), 200% = supersampled 2x. Auto (0) = 100%.
    const dpr = globalThis.devicePixelRatio ?? 1;
    const scale = (options.renderScale && options.renderScale > 0 ? options.renderScale : 1) * dpr;
    if (this.app.renderer.resolution !== scale) {
      this.app.renderer.resolution = scale;
      this.resize();
      this.requantizeZoom();
    }
    this.app.ticker.maxFPS = options.fpsCap ?? 0;
  }

  /**
   * B5-5 (owner): cinematic injury focus — interrupts whatever the user is
   * doing, takes camera control, zooms to the square where the armor broke,
   * holds while the animations play, then eases back. Input is ignored for
   * the duration (guards in the pointer/wheel/contextmenu handlers).
   */
  cinematicZoom(
    square: [number, number],
    holdMs: number,
    opts?: { zoom?: number; track?: () => { x: number; y: number }; priority?: number },
  ): void {
    // Owner 2026-07-03: Auto Director off → no automatic zoom (the dice/splashes
    // still play at their square; the camera just doesn't move).
    if (!this.app || !this.autoDirector) return;
    this.noteAutoDirectorActivity();
    const priority = opts?.priority ?? 1;
    // Owner 2026-07-04: a cinematic is already on screen — only a HIGHER-priority
    // event (e.g. the ball in flight) may preempt it; otherwise leave it be. The
    // preemption keeps the SAVED (pre-zoom) camera so we still ease back cleanly.
    if (this.cinematic) {
      if (priority <= (this.cinematic.priority ?? 1)) return;
      this.cinematic = { ...this.cinematic, target: squareAnchor(square[0], square[1]), start: performance.now(), holdMs, zoom: opts?.zoom, track: opts?.track, priority };
      return;
    }
    this.clearSelection(); // interrupt the user's current action
    const anchor = squareAnchor(square[0], square[1]);
    this.cinematic = {
      savedScale: this.world.scale.x,
      savedX: this.world.position.x,
      savedY: this.world.position.y,
      target: anchor,
      start: performance.now(),
      holdMs,
      zoom: opts?.zoom,
      track: opts?.track,
      priority,
    };
  }

  /** Owner 2026-07-03: brightness/gamma control — a CSS brightness filter on
   *  the render canvas (percent, 100 = neutral). Settings-driven. */
  setBrightness(percent: number): void {
    const canvas = this.app?.canvas as HTMLCanvasElement | undefined;
    if (!canvas) return;
    const clamped = Math.max(50, Math.min(150, percent || 100));
    canvas.style.filter = clamped === 100 ? '' : `brightness(${clamped / 100})`;
  }

  /** Owner 2026-07-03: while a pushback choice is live, EVERY candidate square
   *  renders as a gold arrow from the defender; once one is chosen (`selected`
   *  on the wire) the others fade out and the chosen one pulses (ticker). */
  /** Owner 2026-07-13: draw the BALL & CHAIN aim arrows on overlayLayer — a gold push arrow from the Fanatic to
   *  each orthogonal aim square + a clickable crosshair at each tip, populating bncAimCoords for the hit-test.
   *  Reuses the push-rail primitives (pushArrowGraphic / buildPushCrosshair) without touching their state; drawn
   *  and cleared with overlayLayer each redrawOverlays. The aim is a FACING, not a walk — the server scatters. */
  private drawBncAim(): void {
    this.bncAimCoords = [];
    this.puntConeCenterWorld = null;
    this.puntReaimHits = [];
    let rushTarget = 0;
    if (this.bncAimKind === 'bnc') {
      // UtilServerPlayerMove.addMoveSquare:159 gives every one-step B&C aim its server GFI target.
      // StepMoveBallAndChain:189 appends a colliding zero placeholder; max preserves the real aim value.
      for (const moveSquare of (this.game?.fieldModel.moveSquareArray ?? []) as { minimumRollGfi?: number }[]) {
        rushTarget = Math.max(rushTarget, Number(moveSquare.minimumRollGfi ?? 0));
      }
    }
    const addRushChip = (square: Square, layer: Container): void => {
      if (rushTarget <= 0) return;
      const origin = this.tokenPos(square[0], square[1]);
      let upRight: Square | null = null;
      let rightmostX = origin.x;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const neighbour: Square = [square[0] + dx, square[1] + dy];
          const projected = this.tokenPos(neighbour[0], neighbour[1]);
          if (projected.y < origin.y && projected.x > rightmostX) {
            upRight = neighbour;
            rightmostX = projected.x;
          }
        }
      }
      if (!upRight) return;
      const anchor = this.tokenPos(upRight[0], upRight[1]);
      const die = this.buildRollDie(anchor.x, anchor.y, depthScale(upRight[0], upRight[1]) * 0.5, rushTarget);
      die.alpha = 0.9;
      layer.addChild(die);
    };
    // Phase 2: the SCATTER destination crosshair (where the Fanatic actually landed) — shown while the reroll
    // is offered, independent of the aim arrows (they're mutually exclusive: aim precedes the scatter).
    const scatterDest = this.bncScatterDest;
    const scatterFrom = this.bncScatterFrom;
    if (scatterDest && isOnPitch(scatterDest)) {
      if (scatterFrom && isOnPitch(scatterFrom)) {
        // Owner 08-17 (row17): the reroll-dialog arrow was getting dimmed to 30% whenever the
        // scatter tip landed on a player — on a crowded pitch that read as invisible. This arrow
        // is the reroll decision's whole payload (which direction did it go), so it stays full
        // opacity regardless of occupancy; it already renders on pathLayer, over every token.
        const arrow = this.pushArrowGraphic(scatterFrom, scatterDest);
        arrow.alpha = 1;
        this.pathLayer.addChild(arrow);
      }
      this.overlayLayer.addChild(this.buildPushCrosshair(scatterDest));
      addRushChip(scatterDest, this.overlayLayer);
    }
    const from = this.bncAimFrom;
    if (!from || this.bncAimSquares.length === 0) return;
    if (this.bncAimKind === 'punt') {
      this.drawPuntAim(from, this.bncAimSquares);
      return;
    }
    for (const sq of this.bncAimSquares) {
      if (!isOnPitch(sq)) continue;
      // B&C readability (owner 08-12 ③): direction arrows ride ABOVE the tokens (pathLayer, the kick z-precedent),
      // dimmed to 30% where the tip lands on a player so the arrow reads without occluding them. Occupancy is
      // model-truth (playerDataArray) so it's independent of the token-draw pass order. Crosshair (click target)
      // stays full-alpha.
      const occupied = this.game?.fieldModel.playerDataArray.some(
        (d) => d.playerCoordinate?.[0] === sq[0] && d.playerCoordinate?.[1] === sq[1],
      ) ?? false;
      const arrow = this.pushArrowGraphic(from, sq);
      if (occupied) arrow.alpha = 0.3;
      this.pathLayer.addChild(arrow);
      this.pathLayer.addChild(this.buildPushCrosshair(sq));
      addRushChip(sq, this.pathLayer);
      this.bncAimCoords.push([sq[0], sq[1]]);
    }
  }

  /** Draw the Punt d6 spread in projected grid space. The supplied preview squares stop at the pitch edge, so
   *  recover the cardinal aim ray and rebuild all three directions to distance six for this visual only. */
  private drawPuntAim(from: Square, squares: Square[]): void {
    const seen = new Set<string>();
    const suppliedDirections: [number, number][] = [];
    for (const [x, y] of squares) {
      const direction: [number, number] = [Math.sign(x - from[0]), Math.sign(y - from[1])];
      if (direction[0] === 0 && direction[1] === 0) continue;
      const key = `${direction[0]},${direction[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suppliedDirections.push(direction);
    }

    const straight = suppliedDirections.find(([dx, dy]) => (dx === 0) !== (dy === 0));
    const directions: [number, number][] = straight
      ? [
          [straight[0] + straight[1], straight[1] - straight[0]],
          straight,
          [straight[0] - straight[1], straight[1] + straight[0]],
        ]
      : suppliedDirections.slice(0, 3);
    if (directions.length === 0) return;

    // Begin at the punter's facing edge, then include every projected corner of the three distance-six squares.
    // Their screen-space convex hull is one cone in both orientations/field flips and remains projected even
    // where the rebuilt endpoints lie beyond a sideline or endzone.
    const facing = straight ?? directions[0]!;
    const facingEdge = Math.abs(facing[0]) >= Math.abs(facing[1])
      ? (facing[0] < 0 ? 'xMin' : 'xMax')
      : (facing[1] < 0 ? 'yMin' : 'yMax');
    const projectedPoints: [number, number][] = [...squareEdge(from[0], from[1], facingEdge)];
    for (const [dx, dy] of directions) {
      projectedPoints.push(...squareQuad(from[0] + dx * 6, from[1] + dy * 6).points);
    }
    const hull = this.projectedConvexHull(projectedPoints);
    const centre = this.projectedPolygonCentroid(hull);
    if (centre) {
      const cone = new Graphics();
      cone.poly(hull.flat()).fill({ color: 0xffe066, alpha: 0.3 });
      this.overlayLayer.addChild(cone);
      this.puntConeCenterWorld = centre;
      // Owner 08-12 punt-②: the aim surface is ONE cone fill + the center crosshair only. The outer-ray
      // re-aim arrows AND the short per-direction arrows are RETIRED — re-aim now rides Fives' at-punter
      // ◄► nudges (onPuntReaim). puntReaimHits stays empty so the ray hit-test in pointerup is inert.
    }
  }

  /** Monotone-chain hull over already-projected points; no flat-grid angles enter the overlay geometry. */
  private projectedConvexHull(points: [number, number][]): [number, number][] {
    const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const unique = sorted.filter((point, index) => index === 0
      || point[0] !== sorted[index - 1]![0]
      || point[1] !== sorted[index - 1]![1]);
    if (unique.length <= 2) return unique;
    const cross = (a: [number, number], b: [number, number], c: [number, number]) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const half = (ordered: [number, number][]) => {
      const result: [number, number][] = [];
      for (const point of ordered) {
        while (result.length >= 2 && cross(result[result.length - 2]!, result[result.length - 1]!, point) <= 0) {
          result.pop();
        }
        result.push(point);
      }
      return result;
    };
    const lower = half(unique);
    const upper = half([...unique].reverse());
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
  }

  private projectedPolygonCentroid(points: [number, number][]): { x: number; y: number } | null {
    if (points.length < 3) return null;
    let twiceArea = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      const cross = a[0] * b[1] - b[0] * a[1];
      twiceArea += cross;
      x += (a[0] + b[0]) * cross;
      y += (a[1] + b[1]) * cross;
    }
    if (Math.abs(twiceArea) < 1e-6) return null;
    return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
  }

  private puntReaimDirectionAt(worldX: number, worldY: number): 'ccw' | 'cw' | null {
    for (const hit of this.puntReaimHits) {
      const dx = hit.bx - hit.ax;
      const dy = hit.by - hit.ay;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
        ((worldX - hit.ax) * dx + (worldY - hit.ay) * dy) / lengthSquared,
      ));
      if (Math.hypot(worldX - (hit.ax + dx * t), worldY - (hit.ay + dy * t)) <= hit.radius) return hit.dir;
    }
    return null;
  }

  private drawJumpCrosshairs(): void {
    for (const sq of this.jumpCrosshairSquares) {
      if (isOnPitch(sq)) this.overlayLayer.addChild(this.buildPushCrosshair(sq));
    }
  }

  /** #146: draw the Pick-Me-Up cue (over-head bobbing arrow + "Pick-me-up?" label) on each eligible
   *  player. Reuses the player-pick arrow (bobbed by the ticker via pickArrows) + an ACTION_CHIP label.
   *  Called in refresh() after drawPlayerPick so it appends to pickArrows (which that method resets). */
  private drawPickMeUpCue(): void {
    if (!this.game || !this.pickMeUpCueIds) return;
    for (const d of this.game.fieldModel.playerDataArray) {
      if (!this.pickMeUpCueIds.has(d.playerId) || !isOnPitch(d.playerCoordinate)) continue;
      const coord: [number, number] = [d.playerCoordinate![0], d.playerCoordinate![1]];
      const arrow = this.buildPickArrow(coord);
      this.pickArrows.push({ node: arrow.node, baseY: arrow.node.position.y, scale: arrow.scale });
      this.tokenLayer.addChild(arrow.node);
      // "Pick-me-up?" label just above the arrow (scaled by depth, dark-stroked to read over the pitch).
      // #164: tokenPos so the label tracks the token's wing nudge, like the arrow above.
      const a = this.tokenPos(coord[0], coord[1]);
      const label = new Text({ text: 'Pick-me-up?', style: ACTION_CHIP_STYLE });
      label.anchor.set(0.5, 1);
      label.scale.set(arrow.scale);
      label.position.set(a.x, a.y - TILE_H * arrow.scale * 1.95);
      label.zIndex = this.depthZ(coord[0], coord[1]) + 81; // owner 08-05: above its arrow
      this.tokenLayer.addChild(label);
    }
  }

  /** #161: fan a brightened themed push-arrow from the selected Quick-Snap player to each eligible
   *  destination square (replaces the old boxes). Drawn on tokenLayer inside refresh() so it survives
   *  the per-sync rebuild and rides the camera, like the push-option arrows. */
  private drawQuickSnapArrows(): void {
    const qs = this.quickSnapArrows;
    if (!qs || !this.game) return;
    // #216 QS-4 (owner 08-04): mark each eligible destination with a SMALL crosshair reticle (buildPushCrosshair
    // at 0.6 scale — visibly smaller than the push/jump reticles) in the UI-primary colour (QS-5, view-fed),
    // replacing the former push-arrow fan. `from` is unused by the reticle.
    for (const to of qs.targets) {
      if (!isOnPitch(to)) continue;
      this.tokenLayer.addChild(this.buildPushCrosshair(to, qs.color, 0.6));
    }
  }

  private drawPushOptions(): void {
    this.pushOptionPulse = [];
    this.pushCrosshairs = [];
    this.pushOptionCoords = [];
    if (!this.game) return;
    const squares = (this.game.fieldModel.pushbackSquareArray ?? []) as {
      coordinate?: [number, number];
      direction?: string;
      selected?: boolean;
      locked?: boolean;
    }[];
    if (squares.length === 0) return;
    // arrows originate at the player being pushed (game.defenderId)
    const defenderId = (this.game as { defenderId?: string | null }).defenderId;
    const dd = defenderId
      ? this.game.fieldModel.playerDataArray.find((d) => d.playerId === defenderId)
      : undefined;
    const origin = dd && isOnPitch(dd.playerCoordinate) ? dd.playerCoordinate! : null;
    // Owner 2026-07-04: in SPECTATOR mode (no interactive planner) show ONLY the
    // CHOSEN push direction (the selected square) — never the full candidate fan
    // of arrows + click-crosshairs. Those are the interactive coach's targets and
    // just clutter a spectated scrum (they were appearing scattered over the
    // active player during a blitz). The chosen direction also animates via
    // playPushArrow (state.pushArrows), so nothing is lost for the spectator.
    // o66-dispatch (P1, owner o66c dead-pushback): o66 play turns the PLANNER off, but the push-direction
    // candidates are gated on `!plannerEnabled` as the "spectator" flag — so the o66 PLAYER was mis-classified
    // a spectator and got NO candidate arrows / click targets, killing the pushback pick. In o66 play the coach
    // IS choosing → not a spectator. (deriveClientState→PUSHBACK + state.pushChoice already gate the AUTHORITY;
    // this is purely the visual/click surface.) Off-flag: identical `!plannerEnabled`.
    const spectator = (!this.plannerEnabled && !this.order66) || (this.order66 && !this.pushOptionsArmed); // owner 09-06: unarmed o66 = chosen square only
    for (const sq of squares) {
      if (!sq.coordinate || !isOnPitch(sq.coordinate)) continue;
      if (spectator && !sq.selected) continue; // spectators: chosen square only
      // A LIVE candidate is a square that is neither the chosen (selected) nor a resolved (locked) one —
      // it's the currently-choosable direction. Owner o66d (chain push dead): a CHAIN push leaves the FIRST
      // push's square selected+locked in the array alongside the NEW unlocked candidates; gating the clickable
      // set on the GLOBAL `anySelected` wrongly suppressed every new candidate (the locked square made
      // anySelected true) → the second push couldn't be clicked. Per-square `isLive` fixes it (both modes).
      const isLive = !sq.selected && !sq.locked;
      const active = sq.selected || isLive; // the live/chosen options
      // #147 (owner 07-23): a push arrow must END at the NEXT step's square — i.e. start ONE square back
      // along THIS push's direction, not at the original defender for every link. A CHAIN push leaves the
      // first push's square in the array beside the new candidates, each with its OWN direction: the pushed
      // player standing on the from-square differs per link. Resolve it via the server-faithful
      // pushedPlayerId (reverses the direction to the occupant) → their square is the arrow origin; fall
      // back to the defender origin only when the direction/occupant can't be resolved (prior behaviour).
      const pushedId = pushedPlayerId(this.game, sq);
      const pushedData = pushedId
        ? this.game.fieldModel.playerDataArray.find((d) => d.playerId === pushedId)
        : undefined;
      const arrowFrom =
        pushedData && isOnPitch(pushedData.playerCoordinate)
          ? pushedData.playerCoordinate!
          : origin ?? sq.coordinate;
      const arrow = this.pushArrowGraphic(arrowFrom, sq.coordinate);
      arrow.alpha = sq.selected ? 1 : isLive ? 0.85 : 0.22; // fade only the resolved non-chosen
      if (sq.selected) this.pushOptionPulse.push(arrow);
      this.tokenLayer.addChild(arrow);
      if (spectator) continue; // spectators: no crosshairs / click targets
      // Owner 2026-07-03: a pulsing crosshair reticle at the arrow tip marks where
      // to click (interactive play only).
      const cross = this.buildPushCrosshair(sq.coordinate);
      cross.alpha = active ? 1 : 0.22;
      if (active) this.pushCrosshairs.push({ node: cross, base: cross.scale.x });
      this.tokenLayer.addChild(cross);
      // case 422: shared skill badge (Side Step; owner 09-06: Grab too). Owner 09-06: with a skill ICON available it
      // mounts at the CENTRE of the arrow; without one the glyph badge keeps nesting on the crosshair.
      if (this.pushCrosshairSkill && !sq.locked) {
        const badge = this.buildPushArrowSkillIcon(this.pushCrosshairSkill, arrowFrom, sq.coordinate)
          ?? this.buildSkillBadge(this.pushCrosshairSkill, sq.coordinate);
        badge.alpha = active ? 1 : 0.22;
        this.tokenLayer.addChild(badge);
      }
      // Each unlocked, unchosen candidate is a clickable push-direction target (chain pushes included).
      if (isLive) this.pushOptionCoords.push([sq.coordinate[0], sq.coordinate[1]]);
    }
  }

  /** FIX 7: while a player-pick is armed, friendly on-pitch eligibles carry the existing overhead arrow;
   *  opposition and unknown eligibles carry the existing pulsing crosshair. */
  private drawPlayerPick(): void {
    this.pickCrosshairs = [];
    this.pickArrows = [];
    if (this.game && this.playerPickIds && !this.pickShaded) {
      for (const d of this.game.fieldModel.playerDataArray) {
        const coordinate = this.effectiveCoordinate(d);
        if (!this.playerPickIds.has(d.playerId) || !coordinate) continue;
        const friendly = this.playerPickFriendlyIds?.has(d.playerId) ?? false;
        const opposition = this.playerPickOppositionIds?.has(d.playerId) ?? false;
        // FIX 7: opposition gets the existing reticle. A target absent from both classified sets is deliberately
        // unknown and uses this same crosshair-only fallback, never a guessed friendly arrow.
        if (opposition || !friendly) {
          const cross = this.buildPushCrosshair(coordinate);
          // owner 08-19: lift above the targeted token — default zIndex 0 sat BEHIND the depth-sorted players.
          cross.zIndex = this.depthZ(coordinate[0], coordinate[1]) + 4;
          this.pickCrosshairs.push({ node: cross, base: cross.scale.x });
          this.tokenLayer.addChild(cross);
        }
        // Friendly targets get the existing overhead arrow. Touchback's nominee override still narrows this set.
        if (friendly && (!this.pickArrowIds || this.pickArrowIds.has(d.playerId))) {
          const arrow = this.buildPickArrow(coordinate);
          this.pickArrows.push({ node: arrow.node, baseY: arrow.node.position.y, scale: arrow.scale });
          this.tokenLayer.addChild(arrow.node);
        }
      }
    }
    // Charge keeps the shaded eligible/ineligible language but may nominate several players. The explicit
    // pickArrowIds set is the complete current selection, so every selected on-pitch token retains an arrow;
    // clicks that toggle one id or LIFO-undo the last naturally remove only that marker. Dugout selections use
    // the same set in drawDugoutPlayerPickArrows below.
    if (this.game) {
      for (const playerId of shadedPlayerPickArrowIds(
        this.pickShaded,
        this.playerPickIds,
        this.pickArrowIds,
        this.pickSelectedId,
      )) {
        const selected = this.game.fieldModel.playerDataArray.find((d) => d.playerId === playerId);
        const coordinate = selected ? this.effectiveCoordinate(selected) : undefined;
        if (!coordinate) continue;
        const arrow = this.buildPickArrow(coordinate);
        this.pickArrows.push({ node: arrow.node, baseY: arrow.node.position.y, scale: arrow.scale });
        this.tokenLayer.addChild(arrow.node);
      }
    }
    // High Kick remains a single local staged nominee. Independent of pickShaded so it still renders if the
    // eligible set momentarily narrows.
    if (this.game && this.pickSelectedId && !this.pickShaded) {
      const sel = this.game.fieldModel.playerDataArray.find((d) => d.playerId === this.pickSelectedId);
      const coordinate = sel ? this.effectiveCoordinate(sel) : undefined;
      if (coordinate) {
        const arrow = this.buildPickArrow(coordinate);
        this.pickArrows.push({ node: arrow.node, baseY: arrow.node.position.y, scale: arrow.scale });
        this.tokenLayer.addChild(arrow.node);
      }
    }
    // Owner 2026-07-04e: eligible TILE crosshairs (unified square-pick: Trickster, unknown-call, …).
    if (this.tilePickEligible) {
      // Dump-Off is a distinct off-turn square-pick (`tilePickSkill === 'Dump-Off'`), not the ordinary
      // handoff action mode. Give only that reaction its Quick Pass-style green target wash while retaining
      // the generic gold pick reticle at a quieter scale; every other square-pick remains byte-identical.
      const dumpOff = this.tilePickSkill === 'Dump-Off';
      const dumpOffTints = dumpOff ? new Graphics() : null;
      // Owner g478: in o66 automove the crosshair is a CONFIRM element ONLY (the plotted-path
      // destination, drawn by setO66Path). Plain reachable move squares render SUBTLER — a small
      // dim dot — not a full crosshair (and no 'order66-move' sentinel badge). Skill picks keep the
      // crosshair + badge (they're meaningful individual targets).
      const o66Move = this.tilePickSkill === 'order66-move';
      // HIT_AND_RUN has no client reach/auto-path preview: its server moveSquareArray is the complete affordance
      // predicate (ClientStateHitAndRun + HitAndRunLogicModule), so draw the existing target reticle without a
      // skill badge. The sentinel also supplies its eligible-only hover cursor in the pointermove handler.
      const o66HitAndRun = this.tilePickSkill === 'order66-hit-and-run';
      // Owner o66s #9 → o66ah #9: the o66 OPPOSITION tackle zones are now drawn in redrawOverlays (AFTER its
      // overlayLayer clear) — drawing them here (before that clear) wiped them every frame. See redrawOverlays.
      for (const key of this.tilePickEligible) {
        const [sx, sy] = key.split(',').map(Number) as [number, number];
        if (o66Move) {
          // Reach remains clickable, but its cost art is now drawn by drawO66MovementReachCosts on pathLayer.
          // Keeping it out of tokenLayer is what lets an offer-only server frame avoid rebuilding every player.
          continue;
        } else {
          if (dumpOffTints) {
            dumpOffTints.poly(squareQuad(sx, sy).points.flat()).fill({ color: 0x40c060, alpha: 0.24 });
          }
          const cross = dumpOff
            ? this.buildPushCrosshair([sx, sy], 0xffe066, 0.7)
            : this.buildPushCrosshair([sx, sy]);
          this.pickCrosshairs.push({ node: cross, base: cross.scale.x });
          this.tokenLayer.addChild(cross);
          // case 422: a die-marking skill badge below the crosshair says WHICH skill this pick is for.
          if (this.tilePickSkill && !o66HitAndRun) this.tokenLayer.addChild(this.buildSkillBadge(this.tilePickSkill, [sx, sy]));
        }
      }
      if (dumpOffTints) {
        dumpOffTints.zIndex = 0.5;
        this.tokenLayer.addChildAt(dumpOffTints, 0);
      }
    }
    // Owner throwing-ranges chart: tint every server-offered throw square by its BB2025 range band. tilePickExtra
    // remains the unchanged click surface; passRange only chooses the visual colour. The selected thrower's own
    // square is never in tilePickExtra and is also explicitly excluded here.
    if (this.tilePickExtra) {
      const from = this.selectionInfo()?.data.playerCoordinate;
      const rangeTints = new Graphics();
      for (const key of this.tilePickExtra) {
        const [sx, sy] = key.split(',').map(Number) as [number, number];
        const a = this.tokenPos(sx, sy);
        const ds = depthScale(sx, sy);
        if (from && (sx !== from[0] || sy !== from[1])) {
          const range = passRange(sx - from[0], sy - from[1]);
          if (range && range !== 'T') {
            rangeTints.poly(squareQuad(sx, sy).points.flat()).fill({ color: PASS_RANGE_COLORS[range], alpha: 0.24 });
          }
        }
        // Owner o66 #14 (canonical parity): stamp the PASS minimum roll on each range tile (host-computed from the
        // bb2025 formula). Subtle amber "N+" plate so the coach reads the throw difficulty per band before picking.
        const pr = this.tilePickPassRolls?.get(key);
        if (typeof pr === 'number' && pr) {
          const chip = this.buildPassRollChip(a.x, a.y - TILE_H * 0.28 * ds, ds * 0.44, pr);
          chip.zIndex = 0.6;
          this.tokenLayer.addChild(chip);
        } else if (pr && typeof pr !== 'number') {
          // W29 free-select tags reuse buildPassRollChip exactly; values are calculated and 2+-filtered by the host.
          const y = a.y - TILE_H * 0.28 * ds;
          const both = pr.pass != null && pr.catch != null;
          if (pr.pass != null) {
            const chip = this.buildPassRollChip(a.x, y - (both ? 4 * ds : 0), ds * 0.44, pr.pass, 0xffb020, 'Pass');
            chip.zIndex = 0.6;
            this.tokenLayer.addChild(chip);
          }
          if (pr.catch != null) {
            const chip = this.buildPassRollChip(a.x, y + (both ? 4 * ds : 0), ds * 0.44, pr.catch, 0x2ec24f, 'Catch');
            chip.zIndex = 0.6;
            this.tokenLayer.addChild(chip);
          }
        }
      }
      rangeTints.zIndex = 0.5;
      this.tokenLayer.addChildAt(rangeTints, 0);
    }
    // The roll-chip sink also accepts display-only maps outside the clickable range surface.
    for (const [key, pr] of this.tilePickPassRolls ?? []) {
      if (this.tilePickExtra?.has(key) || typeof pr !== 'number' || !pr) continue;
      const [sx, sy] = key.split(',').map(Number) as [number, number];
      if (!isOnPitch([sx, sy])) continue;
      const a = this.tokenPos(sx, sy);
      const ds = depthScale(sx, sy);
      const chip = this.buildPassRollChip(a.x, a.y - TILE_H * 0.28 * ds, ds * 0.44, pr);
      chip.zIndex = 0.6;
      this.tokenLayer.addChild(chip);
    }
  }

  /** Another renderer-owned arrow and a local persistent arrow may name the same player. Render one arrow while
   *  that cue is visible; the persistent marker automatically returns on the next refresh after it clears. */
  private hasOwnedPlayerArrow(playerId: string): boolean {
    if (this.pickSelectedId === playerId) return true;
    if (this.pickShaded && this.playerPickIds?.has(playerId) && this.pickArrowIds?.has(playerId)) return true;
    if (this.setupActive && this.setupSelectedPlayerId === playerId) return true;
    const data = this.game?.fieldModel.playerDataArray.find((entry) => entry.playerId === playerId);
    if (this.pickMeUpCueIds?.has(playerId) && data && isOnPitch(data.playerCoordinate)) return true;
    return !this.pickShaded
      && !!this.playerPickIds?.has(playerId)
      && !!this.playerPickFriendlyIds?.has(playerId)
      && (!this.pickArrowIds || this.pickArrowIds.has(playerId));
  }

  /** Rebuild local arrows from the stable id set. Their position follows the live token in the ticker rather
   *  than the model square, so a marker remains bound to a walking/tweening player instead of jumping ahead. */
  private drawPersistentPlayerArrows(): void {
    this.persistentPlayerArrows = [];
    if (!this.game) return;
    for (const playerId of this.persistentPlayerArrowIds) {
      if (this.hasOwnedPlayerArrow(playerId)) continue;
      const token = this.tokensById.get(playerId);
      const data = this.game.fieldModel.playerDataArray.find((entry) => entry.playerId === playerId);
      const coordinate = data ? this.effectiveCoordinate(data) : null;
      if (!token || token.destroyed || !coordinate) continue;
      const arrow = this.buildPickArrow(coordinate);
      const offsetY = -TILE_H * arrow.scale * 1.15;
      arrow.node.position.set(token.position.x, token.position.y + offsetY);
      arrow.node.zIndex = token.zIndex + 80;
      this.persistentPlayerArrows.push({ playerId, node: arrow.node, offsetY, scale: arrow.scale });
      this.tokenLayer.addChild(arrow.node);
    }
  }

  private updatePersistentPlayerArrows(now: number): void {
    for (const arrow of this.persistentPlayerArrows) {
      if (arrow.node.destroyed) continue;
      const token = this.tokensById.get(arrow.playerId);
      if (!token || token.destroyed) {
        arrow.node.visible = false;
        continue;
      }
      arrow.node.visible = true;
      arrow.node.position.x = token.position.x;
      arrow.node.position.y = token.position.y + arrow.offsetY + Math.abs(Math.sin(now / 350)) * 6 * arrow.scale;
      arrow.node.zIndex = token.zIndex + 80;
    }
  }

  /** Resolve only rendered pitch/setup tokens from their LIVE geometry. During a movement tween, playersBySquare
   *  already names the model-ahead destination, so it is only a fallback when the token itself occupies that square. */
  private playerTokenAtWorld(worldX: number, worldY: number): string | null {
    const [sx, sy] = worldToSquare(worldX, worldY);
    let nearest: { playerId: string; distance: number } | null = null;
    for (const [playerId, token] of this.tokensById) {
      if (token.destroyed || !token.visible) continue;
      const scale = Math.max(0.1, Math.abs(token.scale.x));
      const centerY = token.position.y - 18 * scale;
      const dx = (worldX - token.position.x) / (TILE_W * 0.48 * scale);
      const dy = (worldY - centerY) / (TILE_H * 0.78 * scale);
      const distance = dx * dx + dy * dy;
      if (distance <= 1 && (!nearest || distance < nearest.distance)) nearest = { playerId, distance };
    }
    if (nearest) return nearest.playerId;

    const squarePlayer = this.playersBySquare.get(`${sx},${sy}`);
    const squareToken = squarePlayer ? this.tokensById.get(squarePlayer) : undefined;
    if (!squarePlayer || !squareToken || squareToken.destroyed || !squareToken.visible) return null;
    const [tokenSx, tokenSy] = worldToSquare(squareToken.position.x, squareToken.position.y);
    return tokenSx === sx && tokenSy === sy ? squarePlayer : null;
  }

  private togglePersistentPlayerArrow(playerId: string): void {
    if (this.persistentPlayerArrowIds.has(playerId)) this.persistentPlayerArrowIds.delete(playerId);
    else this.persistentPlayerArrowIds.add(playerId);
    this.refresh();
  }

  /** A small gold crosshair reticle centred in a square (fits inside the tile),
   *  used to mark a push-option target (the arrow tip). */
  private buildPushCrosshair(coord: [number, number], color = 0xffe066, sizeScale = 1): Graphics {
    // #164 (owner 07-23): position the crosshair through tokenPos (the SAME projection source the player
    // tokens use), so it gets the off-centre-column perspective nudge and stays centred on wing squares
    // (A-B / N-O) instead of drifting off the token — no second offset table (nudge now applies in FLAT too).
    // #216 QS-4/QS-5 (owner 08-04): optional `color` + `sizeScale` let Quick-Snap reuse this idiom in the UI
    // primary colour at a SMALLER scale; every existing caller omits both ⇒ byte-identical (gold, full size).
    const a = this.tokenPos(coord[0], coord[1]);
    const depth = depthScale(coord[0], coord[1]);
    const r = TILE_W * 0.26 * depth * sizeScale; // fits inside the square
    const gap = r * 0.42;
    const w = Math.max(1.4, 2.2 * depth);
    const g = new Graphics();
    g.moveTo(-r, 0).lineTo(-gap, 0).moveTo(gap, 0).lineTo(r, 0) // horizontal ticks
      .moveTo(0, -r).lineTo(0, -gap).moveTo(0, gap).lineTo(0, r) // vertical ticks
      .stroke({ color, width: w, alpha: 0.95 });
    g.circle(0, 0, r * 0.5).stroke({ color, width: w, alpha: 0.95 }); // ring
    g.circle(0, 0, Math.max(1, 1.4 * depth)).fill({ color }); // centre dot
    g.position.set(a.x, a.y);
    g.zIndex = 0.7; // just above the push arrow
    return g;
  }

  /** Read-only destination projected directly from game.passCoordinate.
   *  Deliberately separate from tilePick: the marker cannot consume clicks or send a command. */
  private drawPassDestinationMarker(): void {
    if (!this.passDestinationMarker) return;
    const crosshair = this.buildPushCrosshair(this.passDestinationMarker, 0x22d3ee, 1.08);
    const marker = new Container();
    marker.position.copyFrom(crosshair.position);
    crosshair.position.set(0, 0);
    marker.alpha = 0.95;
    marker.label = 'pass-destination-marker';
    const glyph = this.passDestinationKind === 'bomb' ? '💣' : this.passDestinationKind === 'stunty' ? '🤡' : '🏈';
    const icon = new Text({
      text: glyph,
      style: new TextStyle({
        fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif',
        fontSize: Math.max(14, Math.round(TILE_W * 0.3)),
        align: 'center',
        stroke: { color: 0x081218, width: 3 },
      }),
    });
    icon.anchor.set(0.5);
    icon.label = `pass-destination-kind-${this.passDestinationKind}`;
    marker.addChild(crosshair, icon);
    this.overlayLayer.addChild(marker);
  }

  /** Owner o66 #20: a chunky gold arrow that hovers ABOVE a player's head, pointing down at them — the pick marker
   *  for every server player-pick state. Tip sits just over the head; the ticker bobs it gently. Dark outline for
   *  contrast against tokens. Returns the container + its depth scale (for the ticker's per-depth bob amplitude). */
  private buildPickArrow(coord: [number, number]): { node: Container; scale: number } {
    // #164 (owner 07-23): hover over the TOKEN's projected position (tokenPos), so the over-head arrow
    // stays over the player's head on wing columns instead of the raw square anchor.
    const a = this.tokenPos(coord[0], coord[1]);
    const depth = depthScale(coord[0], coord[1]);
    const w = TILE_W * 0.34 * depth;      // arrowhead width
    const h = TILE_W * 0.30 * depth;      // arrowhead height
    const stemW = w * 0.4;
    const stemH = h * 0.75;
    const g = new Graphics();
    // stem (top) + downward arrowhead (tip at y=0)
    g.rect(-stemW / 2, -h - stemH, stemW, stemH).fill({ color: 0xffe066 });
    g.moveTo(-w / 2, -h).lineTo(w / 2, -h).lineTo(0, 0).closePath().fill({ color: 0xffe066 });
    g.stroke({ color: 0x6a5a10, width: Math.max(1, 1.3 * depth), alpha: 0.9 });
    const node = new Container();
    node.addChild(g);
    node.position.set(a.x, a.y - TILE_H * depth * 1.15); // hover above the head; tip points down at the player
    node.zIndex = this.depthZ(coord[0], coord[1]) + 80; // owner 08-05: tokenLayer sorts by depthZ (screen-Y px) — a small constant sank the arrow under the tokens
    return { node, scale: depth };
  }

  /** Owner o66an / #2 rework: the BALL CROSSHAIR (crosshair + ball sprite) for KICK placement. `coord` supplies the
   *  depth scale of the square under the pointer; the caller repositions the wrapper to the free pointer world
   *  coord (#2 free-follow), so the internal square-anchor position is overridden by the caller. */
  private buildKickBallCrosshair(coord: [number, number]): Container {
    const a = squareAnchor(coord[0], coord[1]);
    const depth = depthScale(coord[0], coord[1]);
    const c = new Container();
    const cross = this.buildPushCrosshair(coord);
    cross.position.set(0, 0); // the wrapper carries the square position
    c.addChild(cross);
    if (this.ballTexture) {
      const ball = new Sprite(this.ballTexture);
      ball.anchor.set(0.5, 0.5);
      ball.width = ball.height = TILE_W * 0.34 * depth;
      c.addChild(ball);
    }
    c.position.set(a.x, a.y);
    c.zIndex = 60;
    return c;
  }

  private clearHoverSquareMarker(): void {
    if (this.hoverSquareMarker && !this.hoverSquareMarker.destroyed) {
      this.hoverSquareMarker.destroy({ children: true });
    }
    this.hoverSquareMarker = null;
  }

  /** Four open L-shaped corner marks following the hovered square's perspective footprint. */
  private buildHoverSquareMarker(coord: [number, number]): Container {
    const marker = new Container();
    const wash = new Graphics();
    const outline = new Graphics();
    const corners = new Graphics();
    const points = squareQuad(coord[0], coord[1]).points;
    const bracketLength = 0.3;
    const drawBrackets = (graphics: Graphics) => {
      for (let i = 0; i < points.length; i++) {
        const corner = points[i]!;
        const previous = points[(i + points.length - 1) % points.length]!;
        const next = points[(i + 1) % points.length]!;
        graphics
          .moveTo(
            corner[0] + (previous[0] - corner[0]) * bracketLength,
            corner[1] + (previous[1] - corner[1]) * bracketLength,
          )
          .lineTo(corner[0], corner[1])
          .lineTo(
            corner[0] + (next[0] - corner[0]) * bracketLength,
            corner[1] + (next[1] - corner[1]) * bracketLength,
          );
      }
    };
    const depth = depthScale(coord[0], coord[1]);
    wash.poly(points.flat()).fill({ color: 0xffe57a, alpha: 0.1 });
    drawBrackets(outline);
    outline.stroke({ color: 0x10141c, width: Math.max(3, 4 * depth), alpha: 0.82 });
    drawBrackets(corners);
    corners.stroke({ color: 0xffffff, width: Math.max(1.8, 2.25 * depth), alpha: 1 });
    marker.addChild(wash, outline, corners);
    return marker;
  }

  /** Selected prayer/setup-style nominations remain visible when the offered player is in a dugout box. */
  private drawDugoutPlayerPickArrows(): void {
    if (!this.playerPickIds || !this.playerPickFriendlyIds) return;
    for (const playerId of this.playerPickIds) {
      if (!this.playerPickFriendlyIds.has(playerId)) continue;
      if (this.pickArrowIds && !this.pickArrowIds.has(playerId)) continue;
      const token = this.dugoutTokensById.get(playerId);
      if (!token || token.destroyed || !token.parent) continue;
      const arrow = this.buildPickArrow([12, 7]);
      const scale = Math.max(0.58, Math.min(0.9, Math.abs(token.scale.x) || 0.7));
      arrow.node.scale.set(scale);
      arrow.node.position.set(token.position.x, token.position.y - TILE_H * scale * 1.25);
      arrow.node.zIndex = token.zIndex + 80;
      this.pickArrows.push({ node: arrow.node, baseY: arrow.node.position.y, scale });
      this.dugoutLayer.addChild(arrow.node);
    }
  }

  private showHoverSquareMarker(coord: [number, number]): void {
    this.clearHoverSquareMarker();
    this.hoverSquareMarker = this.buildHoverSquareMarker(coord);
    this.overlayLayer.addChild(this.hoverSquareMarker);
  }

  /** Owner o66an / #2 rework: arm INTERACTIVE KICK PLACEMENT. `squares` = the eligible aim tiles (click-validated).
   *  The pointermove handler FREE-FOLLOWS the pointer with the ball crosshair (no snap) and keeps the OS cursor
   *  VISIBLE ('crosshair'); a click on an eligible square routes to onKickPick. null clears the marker + restores
   *  the default cursor (the robust teardown for #16 — the crosshair can no longer stick on). */
  setKickPick(squares: [number, number][] | null): void {
    this.kickPickSquares = squares && squares.length ? new Set(squares.map(([x, y]) => `${x},${y}`)) : null;
    this.clearHoverSquareMarker();
    if (!this.kickPickSquares) {
      if (this.kickHoverMarker && !this.kickHoverMarker.destroyed) this.kickHoverMarker.destroy({ children: true });
      this.kickHoverMarker = null;
      if (this.kickScatterMarker && !this.kickScatterMarker.destroyed) this.kickScatterMarker.destroy({ children: true });
      this.kickScatterMarker = null;
      if (this.app) this.app.canvas.style.cursor = this.restingCursor();
    }
  }

  /** Owner o66 #13: build the kick SCATTER-DEVIATION grid anchored on the aimed square (cx,cy). The ball deviates
   *  D8 direction × D6 distance (upstream bb2025 StepKickoffScatterRoll), so every square 1..6 out along the 8
   *  compass rays is a possible landing. Legal landing squares draw as amber perspective tiles; illegal squares
   *  render as an X so the coach sees every touchback risk, including the kicking team's half and the pitch skirt.
   *  A deterministic geometry preview of the roll's footprint (⚖ — it shows what COULD happen, the server rolls the
   *  actual direction/distance). Distance stays D6 (the max envelope); a Kick-skill kicker rolls D3 in practice. */
  private buildKickScatterGrid(cx: number, cy: number): Container {
    const grid = new Container();
    const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    const AMBER = 0xf0a828;
    for (const [dx, dy] of DIRS) {
      for (let k = 1; k <= 6; k++) {
        const nx = cx + dx * k, ny = cy + dy * k;
        const ds = depthScale(Math.min(Math.max(nx, 0), PITCH_COLS - 1), Math.min(Math.max(ny, 0), PITCH_ROWS - 1));
        if (isLegalKickLandingSquare(nx, ny, this.kickPickSquares)) {
          const q = squareQuad(nx, ny);
          const g = new Graphics();
          g.poly(q.points.flat()).fill({ color: AMBER, alpha: 0.26 }).stroke({ color: AMBER, width: Math.max(1, 1.3 * ds), alpha: 0.85 });
          grid.addChild(g);
        } else {
          // ILLEGAL: an X at the landing square (touchback if the ball lands here).
          const a = squareAnchor(nx, ny);
          const r = TILE_W * 0.22 * ds;
          const x = new Graphics();
          x.moveTo(a.x - r, a.y - r).lineTo(a.x + r, a.y + r)
            .moveTo(a.x + r, a.y - r).lineTo(a.x - r, a.y + r)
            .stroke({ color: AMBER, width: Math.max(1.4, 2.2 * ds), alpha: 0.8 });
          grid.addChild(x);
        }
      }
    }
    return grid;
  }

  /** Owner 2026-07-08 (case 422): a small SKILL BADGE for a square-pick crosshair — the die-marking
   *  language: the skill's icon art on a black @60% shade, or a coloured glyph badge fallback
   *  (SKILL_BADGE_GLYPH) for skills with no icon (e.g. Trickster ✦). Nested at the crosshair's top-right
   *  (with a gap) to tell the user which skill this pick belongs to. */
  private buildSkillBadge(skillName: string, coord: [number, number]): Container {
    const depth = depthScale(coord[0], coord[1]);
    const R = TILE_W * 0.10 * depth; // small — reads as a tag, not a token (owner: −a bit)
    const c = new Container();
    this.trackLiveSkillAsset(c, () => {
      for (const child of c.removeChildren()) child.destroy({ children: true });
      const icon = skillIcon(skillName, this.skillIconStyle);
      if (icon) {
        c.addChild(new Graphics().circle(0, 0, R).fill({ color: 0x000000, alpha: 0.6 }));
        const s = new Sprite(icon);
        s.anchor.set(0.5, 0.5);
        s.width = R * 1.7; s.height = R * 1.7;
        c.addChild(s);
      } else {
        const norm = skillName.toLowerCase().replace(/[^a-z]/g, '');
        const [color, glyph] = SKILL_BADGE_GLYPH[norm] ?? [0x777777, (skillName[0] ?? '?').toUpperCase()];
        c.addChild(new Graphics().circle(0, 0, R).fill({ color }).circle(0, 0, R).stroke({ color: 0x14161a, width: Math.max(1, 1.5 * depth) }));
        const t = new Text({ text: glyph, style: DIE_TAG_STYLE });
        t.anchor.set(0.5, 0.5);
        t.scale.set(depth);
        t.position.set(0, -R * 0.06);
        c.addChild(t);
      }
    });
    // Owner 2026-07-08 (case 422): NEST just outside the TOP-RIGHT of the crosshair (centred on the square)
    // with a small gap — sits at 45° up-right, clear of the crosshair's reticle by `gap`.
    // #164: tokenPos so the badge stays pinned to the (now wing-nudged) crosshair it nests on.
    const centre = this.tokenPos(coord[0], coord[1]);
    const crossR = TILE_W * 0.26 * depth;                 // buildPushCrosshair radius
    const dist = crossR + TILE_W * 0.05 * depth + R;      // crosshair edge + gap + badge radius
    const k = Math.SQRT1_2;                                // 45° top-right
    // Owner 2026-07-08: nudge DOWN slightly on Y (X unchanged) so it tucks a touch lower.
    c.position.set(centre.x + dist * k, centre.y - dist * k + TILE_H * 0.14 * depth);
    c.zIndex = 0.8; // above the crosshair
    return c;
  }

  /** BB-style gold push arrow path from `from` toward `to` (shared by the
   *  post-hoc push arrow and the live push-OPTION markers). */
  /** Owner 09-06: the push-modifying skill's ICON (Side Step / Grab) mounted at the centre of a candidate arrow —
   *  null when the active icon set has no art for it (the caller falls back to the crosshair glyph badge). The
   *  span matches pushArrowGraphic (0.25 tile out of the origin, tip 0.28 tile short of the target centre). */
  private buildPushArrowSkillIcon(skillName: string, from: [number, number], to: [number, number]): Container | null {
    if (!skillIcon(skillName, this.skillIconStyle)) return null;
    const a = this.tokenPos(from[0], from[1]);
    const b = this.tokenPos(to[0], to[1]);
    const depth = depthScale(to[0], to[1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const sx = a.x + ux * TILE_W * 0.25 * depth;
    const sy = a.y + uy * TILE_H * 0.25 * depth;
    const tx = b.x - ux * TILE_W * 0.28 * depth;
    const ty = b.y - uy * TILE_H * 0.28 * depth;
    const R = TILE_W * 0.11 * depth;
    const c = new Container();
    this.trackLiveSkillAsset(c, () => {
      for (const child of c.removeChildren()) child.destroy({ children: true });
      const icon = skillIcon(skillName, this.skillIconStyle);
      if (!icon) return;
      c.addChild(new Graphics().circle(0, 0, R).fill({ color: 0x000000, alpha: 0.6 }));
      const s = new Sprite(icon);
      s.anchor.set(0.5, 0.5);
      s.width = R * 1.7; s.height = R * 1.7;
      c.addChild(s);
    });
    c.position.set((sx + tx) / 2, (sy + ty) / 2);
    c.zIndex = 0.7; // over the arrow, under tokens
    return c;
  }

  private pushArrowGraphic(from: [number, number], to: [number, number], opts?: { tipInsetFrac?: number; color?: number }): Graphics {
    // #164 (owner 07-23): endpoints through tokenPos (the token projection source) so the arrow stays
    // aligned with the tokens AND with the crosshair it's drawn beside on wing columns (both nudged).
    const a = this.tokenPos(from[0], from[1]);
    const b = this.tokenPos(to[0], to[1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const depth = depthScale(to[0], to[1]);
    // Owner 2026-07-12: thinner push arrows — reduced shaft width + head (was 0.08 / 0.26).
    const w = TILE_W * 0.05 * depth; // half shaft width
    const head = TILE_W * 0.22 * depth; // arrowhead length
    const px = -uy;
    const py = ux; // unit perpendicular
    // start a little out from the defender centre.
    const sx = a.x + ux * TILE_W * 0.25 * depth;
    const sy = a.y + uy * TILE_H * 0.25 * depth;
    // Owner 2026-07-12: the tip ENTERS the destination square but stops SHORT of its centre (push arrows) —
    // inset back from the centre along the travel direction. A pass arrow passes 0 so it still reaches the target.
    const inset = opts?.tipInsetFrac ?? 0.28;
    const tipX = b.x - ux * TILE_W * inset * depth;
    const tipY = b.y - uy * TILE_H * inset * depth;
    const baseX = tipX - ux * head;
    const baseY = tipY - uy * head;
    const arrow = new Graphics();
    arrow
      // shaft
      .moveTo(sx + px * w, sy + py * w)
      .lineTo(baseX + px * w, baseY + py * w)
      .lineTo(baseX + px * w * 2, baseY + py * w * 2)
      .lineTo(tipX, tipY)
      .lineTo(baseX - px * w * 2, baseY - py * w * 2)
      .lineTo(baseX - px * w, baseY - py * w)
      .lineTo(sx - px * w, sy - py * w)
      .closePath()
      // an optional themed variant passes its own colour via opts.color; the default is the BB gold.
      .fill({ color: opts?.color ?? 0xffe066, alpha: 0.85 })
      .stroke({ color: 0x14161a, width: 1, alpha: 0.7 });
    arrow.zIndex = 0.6; // over turf/trapdoor, under tokens
    return arrow;
  }

  playPushArrow(from: [number, number], to: [number, number]): void {
    if (!this.app) return;
    const arrow = this.pushArrowGraphic(from, to);
    // Owner 2026-07-08 BUGFIX: the arrow used to go in tokenLayer, which refresh() WIPES
    // every model sync — in spectate (frequent syncs during a push) the arrow was destroyed
    // a frame after it appeared, so push arrows never seemed to render. effectsLayer is the
    // transient layer that refresh() never clears; the arrow self-fades/destroys via its tick.
    this.effectsLayer.addChild(arrow);
    const now0 = performance.now();
    const inMs = presentationMs(140);
    const fadeMs = presentationMs(350);
    const inAt = now0 + inMs;
    const fadeAt = inAt + presentationMs(1060);
    const doneAt = fadeAt + fadeMs;
    const app = this.app;
    let cleanup: () => void = () => {};
    const tick = () => {
      const now = performance.now();
      if (now >= doneAt || this.app !== app) { cleanup(); return; }
      if (now < inAt) arrow.alpha = (now - now0) / inMs;
      else if (now > fadeAt) arrow.alpha = (doneAt - now) / fadeMs;
      else arrow.alpha = 1;
    };
    cleanup = this.registerEffectTicker(app, tick, [arrow]);
  }

  /** Owner 2026-07-04: a cartoon PUFF OF SMOKE — a cluster of pale grey clouds
   *  that expand, rise, and fade. Punctuates the injury-symbol animation. */
  private spawnSmokePuff(cx: number, cy: number, depth: number): void {
    if (!this.app) return;
    const finishEffect = this.beginVisualEffect();
    const blobs: { g: Graphics; dx: number; dy: number; r0: number; tint: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const g = new Graphics();
      const ang = (i / 8) * Math.PI * 2;
      const spread = TILE_W * 0.36 * depth;
      blobs.push({
        g,
        dx: Math.cos(ang) * spread * (0.4 + 0.6 * ((i * 7) % 5) / 5),
        dy: -TILE_H * (0.2 + 0.5 * ((i * 3) % 4) / 4) * depth, // billow upward
        r0: TILE_W * (0.13 + 0.06 * (i % 3)) * depth,
        tint: i % 2 ? 0xe4e4ea : 0xc4c4cc,
      });
      g.position.set(cx, cy);
      this.effectsLayer.addChild(g);
    }
    const start = performance.now();
    const life = presentationMs(620);
    const app = this.app;
    let cleanup: () => void = () => {};
    const tick = () => {
      const t = (performance.now() - start) / life;
      if (t >= 1 || this.app !== app) { cleanup(); return; }
      const ease = 1 - (1 - t) * (1 - t);
      for (const b of blobs) {
        b.g.clear();
        const r = b.r0 * (0.5 + t * 1.9);
        b.g.ellipse(b.dx * ease, b.dy * ease, r, r * 0.92).fill({ color: b.tint, alpha: 0.62 * (1 - t) });
      }
    };
    cleanup = this.registerEffectTicker(app, tick, blobs.map((blob) => blob.g), finishEffect);
  }

  /** Owner 2026-07-04d: a smoke puff at a game square (may be off-pitch, e.g. the
   *  reserves box) — used when a player appears on the bench (serverAddPlayer).
   *  Shared live-authoritative injury entry. Puff-only = `spawnSmokePuff` alone at the square. */
  puffAtSquare(square: [number, number]): void {
    if (!this.app) return;
    const a = squareAnchor(square[0], square[1]);
    this.spawnSmokePuff(a.x, a.y, depthScale(square[0], square[1]));
  }

  /** Owner 2026-07-04d: a ZAP strike at a square — a jagged lightning bolt from
   *  the sky + a white flash. Non-interactive (driven by serverZapPlayer, the
   *  opponent's wizard Zap). Shared with the future interactive wizard Zap (6.3). */
  playZap(square: [number, number]): void {
    if (!this.app || !isOnPitch(square)) return;
    const [x, y] = square;
    const a = squareAnchor(x, y);
    const depth = depthScale(x, y);
    const bolt = new Graphics();
    const finishEffect = this.beginVisualEffect();
    // jagged bolt from above the square down to the player
    const topY = a.y - TILE_H * 6 * depth;
    let px = a.x, py = topY;
    const pts: [number, number][] = [[px, py]];
    const segs = 6;
    for (let i = 1; i <= segs; i++) {
      py = topY + ((a.y - topY) * i) / segs;
      px = a.x + (i === segs ? 0 : (Math.random() - 0.5) * TILE_W * 0.5 * depth);
      pts.push([px, py]);
    }
    for (let w = 0; w < 2; w++) {
      bolt.moveTo(pts[0]![0], pts[0]![1]);
      for (const [qx, qy] of pts.slice(1)) bolt.lineTo(qx, qy);
      bolt.stroke({ color: w === 0 ? 0xffffff : 0x9fd0ff, width: (w === 0 ? 4 : 8) * depth, alpha: w === 0 ? 1 : 0.5 });
    }
    bolt.zIndex = 100000;
    this.effectsLayer.addChild(bolt);
    const flash = new Graphics().circle(a.x, a.y, TILE_W * 0.7 * depth).fill({ color: 0xffffff, alpha: 0.85 });
    flash.zIndex = 99999;
    this.effectsLayer.addChild(flash);
    const start = performance.now();
    const life = presentationMs(520);
    const app = this.app;
    let cleanup: () => void = () => {};
    const tick = () => {
      const t = (performance.now() - start) / life;
      if (t >= 1 || this.app !== app) { cleanup(); return; }
      bolt.alpha = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7;
      flash.alpha = 0.85 * (1 - t);
      flash.scale.set(1 + t * 0.6);
    };
    cleanup = this.registerEffectTicker(app, tick, [bolt, flash], finishEffect);
    this.spawnSmokePuff(a.x, a.y, depth);
  }

  /** Kick aim square from the kickoffScatter report (where the kick comes down
   *  BEFORE any bounce/touchback) — set synchronously by the view before the
   *  model change renders, consumed one-shot by animateKickIn. */
  /** Owner 2026-07-08: in-flight pass/punt, keyed to the authoritative wire destination. */
  private pendingBallThrow: {
    from: [number, number]; to?: [number, number]; start: number; durationMs: number;
  } | null = null;
  /** Inaccurate-pass preflight: model truth has already advanced to the computed landing, but interception has
   *  not resolved. Render the loose ball at the authoritative throw origin until playThrow('pass') releases it. */
  private passBallHold: [number, number] | null = null;
  /** Self-driving pass/punt visual, independent of later model refreshes. */
  private passBallFlight: {
    throwState: { from: [number, number]; to: [number, number]; start: number; durationMs: number };
    app: Application | null;
    token: Container | null;
    tick: (() => void) | null;
    retireTimer: ReturnType<typeof setTimeout>;
  } | null = null;
  // (the ball-arc engine `pendingBallThrow` is armed by playThrow('pass' | 'punt', …) — see the single throw entry.)
  /** Owner 2026-07-08: while true, a loose ball that just came free (carrier knocked down) is
   *  FROZEN at its pre-bounce square — the bounce plays only once this clears (the armour/injury
   *  cine resolves). Set from the store's injurySplash so it holds in both spectate + play mode. */
  private holdBallDuringInjury = false;
  setPassBallHold(square: [number, number] | null): void {
    this.passBallHold = square ? [square[0], square[1]] : null;
    this.refresh();
  }
  setHoldBallDuringInjury(hold: boolean): void {
    this.holdBallDuringInjury = hold;
  }
  private pendingKickAim: [number, number] | null = null;
  /** Reveal the server's kickoffScatter result without arming motion. The matching setGame consumes it once. */
  setServerKickoffScatter(snap: { commandNr: number; endpoint: [number, number]; seq: number } | null): void {
    if (!snap) { this.pendingServerKickoffScatter = null; this.serverKickoffScatterReveal = null; return; }
    if (snap.seq === this.kickoffScatterSeqSeen) return;
    this.kickoffScatterSeqSeen = snap.seq;
    this.pendingServerKickoffScatter = {
      kind: 'serverKickoffScatter',
      commandNr: snap.commandNr,
      endpoint: [snap.endpoint[0], snap.endpoint[1]],
    };
    this.serverKickoffScatterReveal = [snap.endpoint[0], snap.endpoint[1]];
    this.showKickTargetPersistent(snap.endpoint, false);
  }
  /** @internal Behavioral probe for the server kickoff occurrence; presentation-only state, never model state. */
  kickoffPresentationProbe(): { modelBallMasked: boolean; ballTweenActive: boolean; authoritativeFlightArmed: boolean } {
    return {
      modelBallMasked: this.serverKickoffScatterReveal != null,
      ballTweenActive: this.moveTweens.has('__ball__'),
      authoritativeFlightArmed: this.kickDescendSnapshot != null,
    };
  }
  setPendingKickAim(square: [number, number]): void {
    this.pendingKickAim = square;
    // Owner 2026-07-08: FORCE the "ball is arriving from off-pitch" transition so the
    // kick FLY-IN fires. The fly-in is gated on off-pitch→on-pitch (!lastBallOnPitch +
    // null lastBallSquare). At halftime the wire nulls the ball (which resets these),
    // BUT in paced spectate playback that null frame can be coalesced away, leaving the
    // 1st-half on-pitch state — so the 2nd-half kickoff took the "ball moved on pitch"
    // branch (a ground slide) instead of flying in. A kick aim is only ever set at a real
    // kickoff, so forcing it here is safe and makes the fly-in fire in BOTH halves.
    this.lastBallOnPitch = false;
    this.lastBallSquare = null;
  }
  /** Owner 2026-07-06 (pacing 2): the aim square while the ball is parked at its
   *  apex during the kick-off event (null = not parked). On release the ball
   *  descends from the apex to the landing instead of re-flying from the kicker. */
  private kickApexAim: [number, number] | null = null;
  /** Owner 2026-07-07: wall-clock start of the kick-in FLIGHT (edge→apex) during the
   *  event hold. Kept across the per-frame token rebuilds (refresh) so the fly-in
   *  progresses on ONE clock instead of restarting each frame; null when not flying. */
  private kickInFlyStart: number | null = null;

  /** Owner 2026-07-07: pick the KICKING player the ball arcs in FROM — a random eligible
   *  player of the kicking team (the side defending the end OPPOSITE the aim). Eligible =
   *  on-pitch, in their OWN half, NOT on the line of scrimmage, and in the CENTRAL zone
   *  (not a wide zone). A player with the "Kick" skill that meets the criteria is preferred.
   *  Returns null when none qualify (→ corner fallback). */
  private pickKickOrigin(aim: [number, number]): [number, number] | null {
    if (!this.game) return null;
    const kickingIsHome = aim[0] > 12; // aim lands in the away half ⇒ HOME kicks
    const team = kickingIsHome ? this.game.teamHome : this.game.teamAway;
    const skillsById = new Map<string, string[]>();
    for (const p of team.playerArray) skillsById.set(p.playerId, playerSkillNames(p)); // base + temporary
    const losX = kickingIsHome ? SETUP_LOS_X : PITCH_COLS - 1 - SETUP_LOS_X; // home 12 / away 13
    const eligible: { sq: [number, number]; kick: boolean }[] = [];
    for (const d of this.game.fieldModel.playerDataArray) {
      const skills = skillsById.get(d.playerId);
      if (!skills) continue; // not on the kicking team
      if (!isOnPitch(d.playerCoordinate)) continue;
      const [x, y] = d.playerCoordinate!;
      if (kickingIsHome ? x > SETUP_OWN_HALF_MAX_X : x <= SETUP_OWN_HALF_MAX_X) continue; // own half only
      if (x === losX) continue; // (1) not on the LOS
      if (y < WIDE_ZONE_WIDTH || y >= PITCH_ROWS - WIDE_ZONE_WIDTH) continue; // (2) central columns only
      const kick = skills.some((s) => s.toLowerCase().replace(/[^a-z]/g, '') === 'kick');
      eligible.push({ sq: [x, y], kick });
    }
    if (!eligible.length) return null;
    const kickers = eligible.filter((e) => e.kick); // (3) prefer a Kick-skill player
    const pool = kickers.length ? kickers : eligible;
    return pool[Math.floor(Math.random() * pool.length)]!.sq;
  }

  /** Owner 2026-07-07: the square the kick FLIES IN from. Prefer a random eligible KICKING
   *  player in the central zone (pickKickOrigin); fall back to a CORNER of the kicking end
   *  (a curved arc) when none qualify. Cached per flight (`kickOrigin`) so every re-armed
   *  frame AND the trail use the SAME origin; cleared at landing / game change (clearKickTarget). */
  private kickOrigin: [number, number] | null = null;
  private kickInEdge(aim: [number, number]): [number, number] {
    if (this.kickOrigin) return this.kickOrigin;
    const player = this.pickKickOrigin(aim);
    if (player) { this.kickOrigin = player; return player; }
    const endX = aim[0] > 12.5 ? -3 : PITCH_COLS + 2; // beyond the kicking team's end zone
    const farCornerY = aim[1] <= (PITCH_ROWS - 1) / 2 ? PITCH_ROWS + 1 : -2; // opposite sideline corner
    this.kickOrigin = [endX, farCornerY];
    return this.kickOrigin;
  }

  /** #124: the view feeds the store's presentation-only `state.kickDescend` here (a watch on `.seq`). A FRESH
   *  seq arms the snapshot-driven kickoff descend — it resurrects the off-pitch kick-in condition that
   *  immediate-apply erased (the model ball may already be CAUGHT), so the fly-in→apex→descend arc plays to
   *  the SNAPSHOT `landing` regardless of the live model. null clears it. ⚖ presentation-only: the model is
   *  never read or written here; ffb-pitch just draws the arc it's told to. */
  setKickDescend(snap: { origin: [number, number]; landing: [number, number]; seq: number } | null): void {
    if (!snap) {
      // #185 F-2 (Meero SR-182): a turnEnd-driven clear that lands MID-ARC must NOT drop the snapshot early —
      // that degrades the descent target to the live model square (spec §1 secondary defect). Defer while the arc
      // is in flight; the arc self-clears its own snapshot on completion (animateKickDescent's cap timer). The
      // store/model clear (store.ts turnEnd) is untouched — this defers only the presentation drop.
      if (arcInFlight({
        descendArmed: this.kickDescendSnapshot != null, apexAimed: this.kickApexAim != null,
        flyStarted: this.kickInFlyStart != null, holdUntil: this.kickInHoldUntil,
        armedAt: this.arcArmedAt, now: performance.now(), capMs: arcInFlightCapMs(),
      })) { this.pendingKickDescendClear = true; return; }
      this.kickDescendSnapshot = null; this.pendingKickDescendClear = false; return;
    }
    if (snap.seq === this.kickDescendSeqSeen) return; // dedup Vue re-renders (object-seq identity, #92 MSC-2)
    this.kickDescendSeqSeen = snap.seq;
    const exact = authoritativeKickPath(snap.origin, snap.landing);
    this.kickDescendSnapshot = { ...exact, seq: snap.seq };
    this.serverKickoffScatterReveal = null;
    this.pendingKickDescendClear = false; // a fresh arm supersedes any pending deferred clear
    // Arm the kick-in state from the snapshot: aim = the scatter landing, and force the off-pitch condition
    // false→ so the refresh() kick-in block runs even though immediate-apply may have already put the ball
    // on-pitch/caught. kickInHoldUntil (the apex dwell) is armed separately by holdBallKickIn (the kickoff
    // event); if it's already elapsed the arc descends straight away.
    this.pendingKickAim = [exact.landing[0], exact.landing[1]];
    this.kickOrigin = [exact.origin[0], exact.origin[1]];
    this.lastBallOnPitch = false;
    // #185 KA-3 (Meero SR-182): #160's one-shot `this.lastBallSquare = null` here is RETIRED. Its job — stop the
    // ground-slide branch (`renderer.ts ~:2537`) from stealing the arc because a stale on-pitch `lastBallSquare`
    // (`prevBall`) made that branch match first — is now owned by F-1a's arcInFlight guard on that branch,
    // ARC-SCOPED for the whole flight rather than nulled once at arm (two half-alive mechanisms for one latch was
    // the drift shape). `lastBallOnPitch = false` above still arms the arc branch; F-1b keeps it false through the
    // arc; the completion reconciliation restores both latches to the landed truth. ⚖ presentation-only; the
    // completion signal `onAnimDone('kickDescend','__ball__')` is unchanged.
    this.arcArmedAt = performance.now(); // KA-4: stamp the fail-open cap clock at the arm point
    this.kickInFlyStart = null;
    this.refresh();
  }

  /** Teardown/watchdog path: discard transient art and snap exactly once to the current server model. */
  clearKickAnimation(): void {
    this.pendingServerKickoffScatter = null;
    this.serverKickoffScatterReveal = null;
    this.suppressGenericBallInThisRefresh = false;
    this.kickDescendSnapshot = null;
    this.pendingKickDescendClear = false;
    this.pendingKickAim = null;
    this.kickApexAim = null;
    this.kickInFlyStart = null;
    this.kickInHoldUntil = 0;
    this.kickInVisualUntil = 0;
    this.arcArmedAt = null;
    this.moveTweens.delete('__ball__');
    this.clearKickTarget();
    const modelBall = this.game?.fieldModel.ballCoordinate as [number, number] | null | undefined;
    this.lastBallSquare = modelBall ? [modelBall[0], modelBall[1]] : null;
    this.lastBallOnPitch = isOnPitch(modelBall ?? null);
    this.refresh();
  }

  /** #131 (owner): the view feeds the store's `state.kickoffVictimSplash` here (a watch on `.seq`). A FRESH seq
   *  fires a one-shot over-token pop at each victim square — officiousRef reuses the dodgy-snack glow shape
   *  (owner ruling: same visual, only the downstream STATUS differs — the ref-ban is server-side); pitchInvasion
   *  a crowd/fan splash. Instance-dedup on seq (#124/#31 pattern) so one event pops ONCE across re-renders. The
   *  pops are transient (flashRings self-fade), so nothing persists once the banned/stunned victims move off the
   *  model. ⚖ presentation-only: reads victim coords off the model, never writes it. null just clears the field. */
  setKickoffVictimSplash(snap: { kind: 'officiousRef' | 'pitchInvasion'; victimIds: string[]; seq: number } | null): void {
    if (!snap) return; // nothing to clear on our side — the pops self-fade; the store's null just resets its state
    if (snap.seq === this.kickoffVictimSeqSeen) return; // dedup Vue re-renders (seq identity, #92 MSC-2 / #124)
    this.kickoffVictimSeqSeen = snap.seq;
    if (!this.game) return;
    for (const id of snap.victimIds) {
      const c = this.game.fieldModel.playerDataArray.find((d) => d.playerId === id)?.playerCoordinate;
      if (c && isOnPitch(c)) this.spawnKickoffVictimSplash([c[0], c[1]], snap.kind);
    }
  }

  /** #131: the one-shot victim pop for setKickoffVictimSplash — a self-fading effect at the victim square
   *  (flashRings lifecycle). officiousRef = the dodgy-snack putrid-glow stack (owner: reuse verbatim) + a
   *  sent-off glyph; pitchInvasion = a warm crowd glow + a fans glyph. Exact glyph rides the owner's eyeball
   *  (rig can't render); the mechanism/placement is the load-bearing part. */
  private spawnKickoffVictimSplash(square: [number, number], kind: 'officiousRef' | 'pitchInvasion'): void {
    if (!this.app) return;
    const anchor = squareAnchor(square[0], square[1]);
    const scale = depthScale(square[0], square[1]);
    const node = new Container();
    const emojiStyle = { fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif', fontSize: 20 };
    if (kind === 'officiousRef') {
      const putrid = 0x8fc31f; // dodgy-snack bilious green, reused verbatim (owner ruling)
      const glow = new Graphics();
      for (const [rx, ry, alpha] of [[0.5, 0.58, 0.16], [0.4, 0.46, 0.26], [0.3, 0.34, 0.42]] as [number, number, number][]) {
        glow.ellipse(0, -6, TILE_W * rx, TILE_H * ry).fill({ color: putrid, alpha });
      }
      node.addChild(glow);
      const glyph = new Text({ text: '🚫', style: emojiStyle }); // sent off (owner tunes glyph)
      glyph.anchor.set(0.5, 0.5);
      glyph.position.set(0, -16);
      node.addChild(glyph);
    } else {
      const crowd = 0xf5c542; // warm fan/crowd tone
      const glow = new Graphics();
      for (const [rx, ry, alpha] of [[0.55, 0.6, 0.18], [0.42, 0.48, 0.28]] as [number, number, number][]) {
        glow.ellipse(0, -6, TILE_W * rx, TILE_H * ry).fill({ color: crowd, alpha });
      }
      node.addChild(glow);
      const glyph = new Text({ text: '👥', style: emojiStyle }); // pitch invasion / fans (owner tunes glyph)
      glyph.anchor.set(0.5, 0.5);
      glyph.position.set(0, -16);
      node.addChild(glyph);
    }
    node.position.set(anchor.x, anchor.y);
    node.visible = false; // the flashRings ticker un-hides at t>=0
    node.zIndex = 60;
    this.effectsLayer.addChild(node);
    this.flashRings.push({ g: node, x: anchor.x, y: anchor.y, scale, start: performance.now(), grow: 0.3 });
  }

  /** #141 (owner): the view feeds the store's `state.ballDirection` here (a watch on `.seq`). A punt/swoop/
   *  place-ball direction roll (ReportPuntDirection / ReportSwoopDirection, or a deviated pass' scatterDirection)
   *  draws a DIRECTION ARROW from the player's square toward the rolled compass direction — reusing the #122
   *  push-arrow (`playPushArrow`). ⚖ presentation-only: the Direction NAME is the SERVER's and is already
   *  seat-transformed by the server (`ReportPuntDirection.transform()` → `Direction.transform()`, [SOURCE]), so
   *  the standard compass→(dx,dy) below is correct in EVERY seat frame — no client transform (BD-1 resolved).
   *  seq-dedup (#124/#131 pattern). null just clears the dedup gate. */
  setBallDirection(snap: { playerId: string; direction: string; seq: number } | null): void {
    if (!snap) return;
    if (snap.seq === this.ballDirectionSeqSeen) return; // dedup Vue re-renders (seq identity)
    this.ballDirectionSeqSeen = snap.seq;
    if (!this.game) return;
    const from = this.game.fieldModel.playerDataArray.find((d) => d.playerId === snap.playerId)?.playerCoordinate;
    if (!from || !isOnPitch(from)) return;
    // compass NAME → (dx,dy) — the inverse of upstream FieldCoordinate.getDirection (dx=to.x−from.x, dy=to.y−from.y).
    const DELTA: Record<string, [number, number]> = {
      North: [0, -1], Northeast: [1, -1], East: [1, 0], Southeast: [1, 1],
      South: [0, 1], Southwest: [-1, 1], West: [-1, 0], Northwest: [-1, -1],
    };
    const d = DELTA[snap.direction];
    if (!d) return; // unknown Direction name → no arrow (defensive; server sends one of the 8)
    this.playPushArrow([from[0], from[1]], [from[0] + d[0], from[1] + d[1]]);
  }

  /** Owner 2026-07-08 (queue 8): the kick FLIES IN like the throw-a-rock animation —
   *  from OFF-PITCH beyond the KICKING team's end zone (a CORNER of it, so the arc
   *  curves — owner 2026-07-07), arcing to the aimed square (kickoffScatter's
   *  ballCoordinateEnd), then BOUNCES (per-tile hops) to wherever it finally lands.
   *  The off-pitch start goes through the active projection, so "the appropriate
   *  edge" is automatic in every orientation (N-S top/bottom, E-W left/right, flat).
   *  The moving visual ball temporarily becomes the unified Auto Director target;
   *  it uses the same 1/2/3-square policy as a moving player. */
  private animateKickIn(g: Container, landing: [number, number], targetPos: { x: number; y: number }): void {
    const aim = this.pendingKickAim ?? landing;
    this.pendingKickAim = null;
    // fly in from a CORNER beyond the kicking side's end zone (curved trail, owner)
    const edge: [number, number] = this.kickInEdge(aim);
    this.showKickTarget(aim[0], aim[1]);
    this.showKickTrail(squareAnchor(edge[0], edge[1]), squareAnchor(aim[0], aim[1])); // travel arc (edge → aim)
    const bounceSteps = Math.max(Math.abs(landing[0] - aim[0]), Math.abs(landing[1] - aim[1]));
    const bounceMs = bounceSteps * presentationMs(KICK_HOP_SEGMENT_MS);
    // phase 1: edge → aim, one big arc. Longer flight than the old kicker→aim hop —
    // the ball crosses the whole kicking half, so the flight reads as a real kick
    // (owner: the old pacing was off — target shows, THEN the flight, THEN the bounce).
    this.startMoveTween('__ball__', g, edge, aim, KICK_ARC_PX, presentationMs(KICK_FLYIN_MS));
    const tween = this.moveTweens.get('__ball__');
    // grow to the apex (mid-flight) then shrink back as it drops to the aim
    if (tween) { tween.baseScale = g.scale.x; tween.growTo = KICK_BALL_GROW; tween.growMode = 'arc'; }
    // B0: the persistent target crosshair clears once the ball has LANDED
    const flyClearMs = presentationMs(KICK_FLYIN_MS) + presentationMs(KICK_FLY_HOP_DELAY_MS) + bounceMs + presentationMs(KICK_CLEAR_TAIL_MS);
    this.kickInVisualUntil = performance.now() + flyClearMs; // #59a: suppress the carrier-clear until this landing
    this.scheduleTimer(() => {
      this.clearKickTarget();
      // Owner 09-10 (game 947): the store's kickArc barrier waits for a kickDescend landing signal; when the
      // snapshot descent did not arm (whatever the reason) this plain fly-in is the only landing there is, so it
      // signals too. Inert when nothing waits (the store ignores a signal with no barrier / no kickDescend).
      if (!this.kickDescendSnapshot) this.onAnimDone?.('kickDescend', '__ball__');
    }, flyClearMs);
    if (bounceSteps === 0) {
      if (tween) tween.waypoints[tween.waypoints.length - 1] = targetPos;
      return;
    }
    // phase 2: bounce aim → final landing with small per-tile hops
    this.scheduleTimer(() => {
      if (g.destroyed) return;
      const waypoints: { x: number; y: number }[] = [];
      for (let i = 0; i <= bounceSteps; i++) {
        const sx = Math.round(aim[0] + ((landing[0] - aim[0]) * i) / bounceSteps);
        const sy = Math.round(aim[1] + ((landing[1] - aim[1]) * i) / bounceSteps);
        const p = squareAnchor(sx, sy);
        waypoints.push({ x: p.x, y: p.y });
      }
      waypoints[waypoints.length - 1] = targetPos; // keep the ball's render offset
      this.moveTweens.set('__ball__', { token: g, waypoints, style: 'hop', start: performance.now(), segmentMs: presentationMs(KICK_HOP_SEGMENT_MS) });
    }, presentationMs(KICK_FLYIN_MS) + presentationMs(KICK_FLY_HOP_DELAY_MS));
  }

  /** Owner 2026-07-06 (pacing 2): the ball DESCENDS from its parked apex to the aim,
   *  then bounces (per-tile hops) to the final landing — the second half of the kick
   *  after the kick-off event has played. Mirrors animateKickIn's bounce phase. */
  private animateKickDescent(
    g: Container,
    landing: [number, number],
    targetPos: { x: number; y: number },
    aim: [number, number],
  ): void {
    this.showKickTarget(aim[0], aim[1]);
    const bounceSteps = Math.max(Math.abs(landing[0] - aim[0]), Math.abs(landing[1] - aim[1]));
    const bounceMs = bounceSteps * presentationMs(KICK_HOP_SEGMENT_MS);
    // B0: the persistent target crosshair clears once the ball has LANDED
    const descClearMs = presentationMs(KICK_DESCENT_MS) + presentationMs(KICK_BOUNCE_DELAY_MS) + bounceMs + presentationMs(KICK_CLEAR_TAIL_MS);
    this.kickInVisualUntil = performance.now() + descClearMs; // #59a: suppress the carrier-clear until this landing
    // #124 KD-3 (Meero SR-48): scope the cleanup to THIS descend's snapshot. A touchback/re-kick mid-descend
    // arms a NEW snapshot (seq++, its own animateKickDescent + timer); if THIS (earlier) timer fired an
    // unconditional `if (this.kickDescendSnapshot)` it would null the NEWER snapshot and cut its descend short.
    // Capture our seq at arm and only clear/reconcile if it's still the one we armed for (the newer descend's
    // own wall-clock timer stays the KD-4 fail-open for it). undefined seq (inert, no snapshot) → never fires.
    const mySeq = this.kickDescendSnapshot?.seq;
    this.scheduleTimer(() => {
      this.clearKickTarget();
      // #124 KD-4/KD-2: this setTimeout is the WALL-CLOCK cap (throttle-resistant; fires late but always,
      // unlike rAF). It is the fail-open for the snapshot descend: fire the visual-complete signal so the
      // store clears `state.kickDescend` and the presented ball reconciles to the model (chaining any
      // catch/bounce), and drop our own snapshot so the ball can never stay hidden past the cap.
      if (this.kickDescendSnapshot && this.kickDescendSnapshot.seq === mySeq) {
        this.kickDescendSnapshot = null;
        // Java's completion restores the already-applied CURRENT model, not the preliminary/report endpoint.
        const modelBall = this.game?.fieldModel.ballCoordinate as [number, number] | null | undefined;
        this.lastBallSquare = modelBall ? [modelBall[0], modelBall[1]] : null;
        this.lastBallOnPitch = isOnPitch(modelBall ?? null);
        this.arcArmedAt = null;
        this.pendingKickDescendClear = false;
        this.onAnimDone?.('kickDescend', '__ball__');
        this.refresh();
      }
    }, descClearMs);
    // phase 1: apex (current pos) → aim, a straight fall (eased) to the ground
    const apexPos = { x: g.position.x, y: g.position.y };
    const aimPos = squareAnchor(aim[0], aim[1]);
    this.moveTweens.set('__ball__', {
      token: g,
      waypoints: [apexPos, bounceSteps === 0 ? targetPos : aimPos],
      style: 'slide',
      start: performance.now(),
      segmentMs: presentationMs(KICK_DESCENT_MS),
      // shrink from the apex size back to 1× as the ball falls (g starts at base·grow here)
      baseScale: g.scale.x / KICK_BALL_GROW, growTo: KICK_BALL_GROW, growMode: 'down',
    });
    if (bounceSteps === 0) return;
    // phase 2: the ball has REACHED the target (descent done + a landing beat) — NOW it
    // bounces aim → final landing with small per-tile hops. Owner 2026-07-08: the bounce
    // starts only after the ball has visibly hit the target square (KICK_BOUNCE_DELAY_MS).
    this.scheduleTimer(() => {
      if (g.destroyed) return;
      const waypoints: { x: number; y: number }[] = [];
      for (let i = 0; i <= bounceSteps; i++) {
        const sx = Math.round(aim[0] + ((landing[0] - aim[0]) * i) / bounceSteps);
        const sy = Math.round(aim[1] + ((landing[1] - aim[1]) * i) / bounceSteps);
        const p = squareAnchor(sx, sy);
        waypoints.push({ x: p.x, y: p.y });
      }
      waypoints[waypoints.length - 1] = targetPos; // keep the ball's render offset
      this.moveTweens.set('__ball__', { token: g, waypoints, style: 'hop', start: performance.now(), segmentMs: presentationMs(KICK_HOP_SEGMENT_MS) });
    }, presentationMs(KICK_DESCENT_MS) + presentationMs(KICK_BOUNCE_DELAY_MS));
  }

  /** Owner 2026-07-08 (event-priority B0): the PERSISTENT target-ball crosshair —
   *  shown the moment the kick AIM is known (kickoffScatter), BEFORE the kick-off
   *  event splash, and held (gently pulsing) through the splash + flight until the
   *  ball lands. Replaces any prior target; cleared by clearKickTarget()/landing/
   *  clearEffects. The one-shot showKickTarget flash still fires at flight start
   *  as an emphasis pulse on top. */
  private kickTarget: { g: Graphics; tick: () => void } | null = null;
  /** #25 (owner 07-16): guaranteed-clear backstop. The reticle is normally cleared by a setTimeout scheduled
   *  INSIDE the kick-in flight; skip-paths (immediate catch / carrier-less touchback / re-scatter) never schedule
   *  it, so the reticle can stick forever. This TTL fires from ARM time — a fixed timer with no model/animation
   *  timing hazard — so the reticle can never outlive any legitimate kick-in visual (~6s > hold 2600 + descent
   *  1200 + settle + max bounce). The state-derived carrier-clear (guarded past the apex-hold) clears the common
   *  immediate-catch faster; this catches the rest. */
  private kickTargetTtl: ReturnType<typeof setTimeout> | null = null;
  showKickTargetPersistent(square: [number, number], ttl = true): void {
    if (!this.app) return;
    this.clearKickTarget();
    const [x, y] = square;
    const anchor = squareAnchor(x, y);
    // Owner 2026-07-08: ball-related cues are CYAN (style-guide A1) — the target-ball
    // crosshair reads as a BALL cue, not a selection (which is gold).
    const reticle = new Graphics();
    // Owner 2026-07-07: TWO concentric cyan circles. (1) the central CROSSHAIR marks the
    // target square; (2) the BOUNCE RING extends out so its edge lands on the CENTRE of each
    // of the 8 adjacent squares — the possible bounce destinations. The projection is
    // axis-aligned (measured: +x ≈ 0.83·TILE_H up, +y ≈ 0.84·TILE_W across), so those radii
    // put the ring edge on the orthogonal neighbour centres.
    reticle.ellipse(0, -3, TILE_W * 0.84, TILE_H * 0.83).stroke({ color: 0x22d3ee, width: 2, alpha: 0.6 }); // (2) bounce ring
    reticle.ellipse(0, -3, TILE_W * 0.5, TILE_H * 0.38).stroke({ color: 0x22d3ee, width: 2.5, alpha: 0.95 }); // (1) central crosshair
    reticle.ellipse(0, -3, TILE_W * 0.26, TILE_H * 0.2).stroke({ color: 0x22d3ee, width: 2, alpha: 0.85 });
    reticle.moveTo(0, -3 - TILE_H * 0.5).lineTo(0, -3 + TILE_H * 0.44).stroke({ color: 0x22d3ee, width: 1.5, alpha: 0.7 });
    reticle.moveTo(-TILE_W * 0.6, -3).lineTo(TILE_W * 0.6, -3).stroke({ color: 0x22d3ee, width: 1.5, alpha: 0.7 });
    reticle.position.set(anchor.x, anchor.y);
    reticle.zIndex = 0.55; // over turf, under tokens
    this.effectsLayer.addChild(reticle);
    const tick = () => {
      if (reticle.destroyed) { this.app?.ticker.remove(tick); return; }
      reticle.alpha = 0.75 + 0.25 * Math.sin(performance.now() / presentationMs(260)); // gentle pulse
    };
    this.app.ticker.add(tick);
    this.kickTarget = { g: reticle, tick };
    // #25: arm the guaranteed-clear TTL from arm-time (replaces any prior). setTimeout (not rAF) so it fires even
    // when a spectator tab throttles the render ticker.
    this.cancelTimer(this.kickTargetTtl);
    this.kickTargetTtl = ttl ? this.scheduleTimer(() => this.clearKickTarget(), presentationMs(6000)) : null;
  }
  clearKickTarget(): void {
    this.clearKickTrail(); // the travel-arc trail clears together with the target crosshair
    this.kickOrigin = null; // next kick re-picks its origin player
    if (this.kickTargetTtl != null) { this.cancelTimer(this.kickTargetTtl); this.kickTargetTtl = null; }
    if (!this.kickTarget) return;
    this.app?.ticker.remove(this.kickTarget.tick);
    if (!this.kickTarget.g.destroyed) {
      this.kickTarget.g.parent?.removeChild(this.kickTarget.g);
      this.kickTarget.g.destroy();
    }
    this.kickTarget = null;
  }

  /** Owner 2026-07-07: the faint CYAN TRAVEL-ARC trail — the kick's path from the fly-in
   *  edge, up through the apex (the ball in the air), down to the destination square. Drawn
   *  once at flight start, cleared with the target crosshair when the ball lands. Ball cues
   *  are cyan (style-guide §A1); ~15% opacity. Samples the SAME interpolation the ticker
   *  uses (slide ease + sin arc) so the trail overlays the ball's actual travel.
   *  `apex` present ⇒ two-phase (edge→apex arc, then apex→dest fall); absent ⇒ one arc. */
  private kickTrail: Graphics | null = null;
  private showKickTrail(edge: { x: number; y: number }, dest: { x: number; y: number }, apex?: { x: number; y: number }): void {
    if (!this.app || !this.kickTrailEnabled) return;
    this.clearKickTrail();
    const pts: { x: number; y: number }[] = [];
    const seg = (from: { x: number; y: number }, to: { x: number; y: number }, arc: number, n: number) => {
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const ease = 1 - (1 - t) * (1 - t); // slide ease (matches the ball tween)
        const y = from.y + (to.y - from.y) * ease - (arc ? Math.sin(t * Math.PI) * arc : 0);
        pts.push({ x: from.x + (to.x - from.x) * ease, y });
      }
    };
    if (apex) { seg(edge, apex, KICK_ARC_PX, 18); seg(apex, dest, 0, 10); }
    else seg(edge, dest, KICK_ARC_PX, 22);
    const g = new Graphics();
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
    g.stroke({ color: 0x22d3ee, width: 5, alpha: 0.25 }); // cyan ball cue — owner 2026-07-07: wider + 25%
    g.zIndex = 0.5; // over turf, under the crosshair (0.55) + tokens
    this.effectsLayer.addChild(g);
    this.kickTrail = g;
  }
  private clearKickTrail(): void {
    if (!this.kickTrail) return;
    if (!this.kickTrail.destroyed) {
      this.kickTrail.parent?.removeChild(this.kickTrail);
      this.kickTrail.destroy();
    }
    this.kickTrail = null;
  }

  /** Owner 2026-07-06: a small RED target crosshair over the TARGET token's centre,
   *  raised as the FIRST beat of a block/blitz (before the dice) to call out who's
   *  being hit. Auto-clears after `lifeMs`. RED (not the CYAN ball cue or GOLD
   *  selection) — a target/aggression read. */
  private blockTargetCue: { g: Graphics; tick: () => void; clear: ReturnType<typeof setTimeout> } | null = null;
  showBlockTargetCrosshair(square: [number, number] | null, lifeMs = presentationMs(1500)): void {
    this.clearBlockTargetCue();
    if (!square || !this.app || !isOnPitch(square)) return;
    const [x, y] = square;
    // Owner 2026-07-08 (08-18: 🎯 now lives on SpectateView's #94 DOM badge): on a BLITZ the
    // target already wears the 🎯 (SELECTED_BLITZ_TARGET) — don't stack a block-target crosshair.
    const occ = this.game?.fieldModel?.playerDataArray?.find(
      (d) => d.playerCoordinate?.[0] === x && d.playerCoordinate?.[1] === y,
    );
    if (occ && hasFlag(occ.playerState, PlayerStateFlag.SELECTED_BLITZ_TARGET)) return;
    // Owner 08-18: same doubling class via the gaze rail — a gaze victim already wears the
    // magenta victim marker; don't stack the block reticle on it (blitz precedent above).
    if (occ && (this.gazeTarget === occ.playerId || this.gazeVictims.has(occ.playerId))) return;
    const tp = this.tokenPos(x, y);
    const anchor = squareAnchor(x, y);
    const scale = depthScale(x, y);
    const g = new Graphics();
    const r = 9 * scale;
    g.circle(0, 0, r).stroke({ color: 0xff5a3c, width: 2 * scale, alpha: 0.95 });
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][]) {
      g.moveTo(dx * (r - scale), dy * (r - scale)).lineTo(dx * (r + 5 * scale), dy * (r + 5 * scale)).stroke({ color: 0xff5a3c, width: 2 * scale, alpha: 0.9 });
    }
    g.circle(0, 0, 1.6 * scale).fill({ color: 0xff5a3c });
    g.position.set(tp.x, anchor.y - TILE_H * 0.55 * scale); // token body/centre
    g.zIndex = this.depthZ(x, y) + 70;
    this.effectsLayer.addChild(g);
    const t0 = performance.now();
    const tick = () => {
      if (g.destroyed) { this.app?.ticker.remove(tick); return; }
      g.scale.set(1 + 0.12 * Math.sin((performance.now() - t0) / presentationMs(130))); // quick pulse
    };
    this.app.ticker.add(tick);
    const clear = this.scheduleTimer(() => this.clearBlockTargetCue(), lifeMs);
    this.blockTargetCue = { g, tick, clear };
  }
  // Owner 2026-07-09: the FOUL target cue — a 🥾 boot floating over the fouled player, popped a
  // beat before the armour roll (the foul analogue of showBlockTargetCrosshair). Bobs + pulses,
  // then clears after `lifeMs`. Positioned + depth-sorted like the crosshair.
  private foulTargetCue: { node: Text; tick: () => void; clear: ReturnType<typeof setTimeout> } | null = null;
  showFoulTargetCue(square: [number, number] | null, lifeMs = presentationMs(1100)): void {
    this.clearFoulTargetCue();
    if (!square || !this.app || !isOnPitch(square)) return;
    const [x, y] = square;
    const tp = this.tokenPos(x, y);
    const anchor = squareAnchor(x, y);
    const scale = depthScale(x, y);
    const node = new Text({ text: '🥾', style: FOUL_CUE_STYLE });
    node.anchor.set(0.5);
    node.scale.set(scale);
    const baseY = anchor.y - TILE_H * 0.62 * scale; // float above the token body
    node.position.set(tp.x, baseY);
    node.zIndex = this.depthZ(x, y) + 72;
    this.effectsLayer.addChild(node);
    const t0 = performance.now();
    const tick = () => {
      if (node.destroyed) { this.app?.ticker.remove(tick); return; }
      const t = performance.now() - t0;
      node.scale.set(scale * (1 + 0.12 * Math.sin(t / presentationMs(130)))); // quick pulse
      node.y = baseY - 3 * scale * Math.max(0, Math.sin(t / presentationMs(260))); // gentle bob
    };
    this.app.ticker.add(tick);
    const clear = this.scheduleTimer(() => this.clearFoulTargetCue(), lifeMs);
    this.foulTargetCue = { node, tick, clear };
  }
  private clearFoulTargetCue(): void {
    if (!this.foulTargetCue) return;
    this.cancelTimer(this.foulTargetCue.clear);
    this.app?.ticker.remove(this.foulTargetCue.tick);
    if (!this.foulTargetCue.node.destroyed) {
      this.foulTargetCue.node.parent?.removeChild(this.foulTargetCue.node);
      this.foulTargetCue.node.destroy();
    }
    this.foulTargetCue = null;
  }
  private clearBlockTargetCue(): void {
    if (!this.blockTargetCue) return;
    this.cancelTimer(this.blockTargetCue.clear);
    this.app?.ticker.remove(this.blockTargetCue.tick);
    if (!this.blockTargetCue.g.destroyed) {
      this.blockTargetCue.g.parent?.removeChild(this.blockTargetCue.g);
      this.blockTargetCue.g.destroy();
    }
    this.blockTargetCue = null;
  }
  // Owner 2026-08-17: ROSTER-panel attention cue — clicking a player row in the side roster
  // highlights their pitch token with a bouncing yellow ▼, same cue family/lifecycle as the foul
  // boot above (anchored to the square, ticker bob, timeout auto-clear). Anchored to the SQUARE
  // (not the playerId) like the sibling cues — the caller re-resolves the square on move.
  // Owner 08-19 (locate-cue reveal): the cue is now a two-beat sequence — ① a gold circle
  // PULSE at the square (flashRings one-shot) ② THEN the bouncing ▼ arrow. `node`/`tick` are
  // null until the arrow spawns; `arm` is the pending arrow timer. Roster-row and log-name
  // clicks share this one call, so the reveal is identical from both.
  private rosterAttentionCue: { node: Text | null; tick: (() => void) | null; arm: ReturnType<typeof setTimeout> | null; clear: ReturnType<typeof setTimeout> } | null = null;
  /** Owner 08-18: resolve a player's cue anchor — the pitch square when on-pitch, else the DUGOUT
   *  projected square (KO/CAS/reserves boxes register in playersBySquare for hit-testing, so the
   *  reverse lookup is authoritative for where the token actually rendered). */
  private cueAnchorForPlayer(playerId: string): [number, number] | null {
    const d = this.game?.fieldModel?.playerDataArray?.find((p) => p.playerId === playerId);
    const sq = d?.playerCoordinate;
    if (sq && isOnPitch(sq as [number, number])) return sq as [number, number];
    for (const [key, id] of this.playersBySquare) {
      if (id === playerId) {
        const parts = key.split(',');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
      }
    }
    return null;
  }
  showRosterAttentionCue(playerId: string | null, lifeMs = 3000): void {
    this.clearRosterAttentionCue();
    if (!playerId || !this.app) return;
    // Owner 08-18: dugout players (KO/CAS/reserves) get the arrow too — anchor to wherever the
    // token rendered, on-pitch OR dugout box (was square-anchored + isOnPitch-gated, card-only off-pitch).
    const square = this.cueAnchorForPlayer(playerId);
    if (!square) return;
    const [x, y] = square;
    const tp = this.tokenPos(x, y);
    const anchor = squareAnchor(x, y);
    const scale = depthScale(x, y);
    // Owner 08-19 (reveal beat ①): a gold circle PULSE at the square — the flashGoldAura ring
    // shape, inlined because that helper is isOnPitch-gated and this anchor may be a dugout
    // box. One-shot via flashRings (self-fading); deliberately NOT cleared with the arrow.
    const pulseMs = 600;
    const ring = new Graphics();
    ring.ellipse(0, 0, TILE_W * 0.5, TILE_H * 0.4).stroke({ color: 0xffd166, width: 4, alpha: 0.95 });
    ring.ellipse(0, 0, TILE_W * 0.34, TILE_H * 0.26).fill({ color: 0xffd166, alpha: 0.22 });
    ring.position.set(anchor.x, anchor.y);
    ring.zIndex = this.depthZ(x, y) + 3;
    this.effectsLayer.addChild(ring);
    this.flashRings.push({ g: ring, x: anchor.x, y: anchor.y, scale, start: performance.now(), grow: 0.35, durationMs: pulseMs });
    // Reveal beat ②: THEN the bouncing ▼ arrow (existing bob/timeout lifecycle), armed after
    // the pulse. The record exists from call time so clear() can cancel the pending arrow.
    const arm = this.scheduleTimer(() => {
      const cue = this.rosterAttentionCue;
      if (!cue || cue.arm !== arm || !this.app) return; // superseded or cleared
      cue.arm = null;
      const node = new Text({ text: '▼', style: ROSTER_CUE_STYLE });
      node.anchor.set(0.5);
      node.scale.set(scale);
      // Owner 08-23: the locate/highlight arrow floated too far above the player's head. This cue is
      // independent of buildPickArrow (selection/nomination arrows), so tighten only its pitch+dugout gap.
      const baseY = anchor.y - TILE_H * 0.5 * scale;
      node.position.set(tp.x, baseY);
      node.zIndex = this.depthZ(x, y) + 72;
      this.effectsLayer.addChild(node);
      const t0 = performance.now();
      const tick = () => {
        if (node.destroyed) { this.app?.ticker.remove(tick); return; }
        const t = performance.now() - t0;
        node.y = baseY - 5 * scale * Math.max(0, Math.sin(t / 220)); // bounce
      };
      this.app.ticker.add(tick);
      cue.node = node;
      cue.tick = tick;
    }, pulseMs);
    const clear = this.scheduleTimer(() => this.clearRosterAttentionCue(), lifeMs);
    this.rosterAttentionCue = { node: null, tick: null, arm, clear };
  }
  clearRosterAttentionCue(): void {
    if (!this.rosterAttentionCue) return;
    if (this.rosterAttentionCue.arm) this.cancelTimer(this.rosterAttentionCue.arm);
    this.cancelTimer(this.rosterAttentionCue.clear);
    if (this.rosterAttentionCue.tick) this.app?.ticker.remove(this.rosterAttentionCue.tick);
    const node = this.rosterAttentionCue.node;
    if (node && !node.destroyed) {
      node.parent?.removeChild(node);
      node.destroy();
    }
    this.rosterAttentionCue = null;
  }

  // Owner 09-08: END TURN with idle players — a bouncing ▼ over EVERY unactivated own player plus a repeating gold
  // ring pulse on each, so the coach sees who has not acted before confirming. The host owns the lifecycle:
  // "End turn" clears at once; "Go back" arms a 2 s expiry; any player click clears (SpectateView).
  private unactivatedCues: {
    nodes: { node: Text; tick: () => void }[];
    squares: [number, number][];
    pulse: ReturnType<typeof setTimeout> | null;
    clear: ReturnType<typeof setTimeout> | null;
  } | null = null;
  private static readonly UNACTIVATED_PULSE_MS = 900;

  showUnactivatedCues(playerIds: readonly string[], lifeMs?: number): void {
    this.clearUnactivatedCues();
    if (!this.app || playerIds.length === 0) return;
    const nodes: { node: Text; tick: () => void }[] = [];
    const squares: [number, number][] = [];
    for (const playerId of playerIds) {
      const square = this.cueAnchorForPlayer(playerId);
      if (!square) continue;
      const [x, y] = square;
      const tp = this.tokenPos(x, y);
      const anchor = squareAnchor(x, y);
      const scale = depthScale(x, y);
      const node = new Text({ text: '▼', style: ROSTER_CUE_STYLE });
      node.anchor.set(0.5);
      node.scale.set(scale);
      const baseY = anchor.y - TILE_H * 0.5 * scale;
      node.position.set(tp.x, baseY);
      node.zIndex = this.depthZ(x, y) + 72;
      this.effectsLayer.addChild(node);
      const t0 = performance.now();
      const tick = () => {
        if (node.destroyed) { this.app?.ticker.remove(tick); return; }
        const t = performance.now() - t0;
        node.y = baseY - 5 * scale * Math.max(0, Math.sin(t / 220)); // same bounce as the roster cue
      };
      this.app.ticker.add(tick);
      nodes.push({ node, tick });
      squares.push([x, y]);
    }
    if (nodes.length === 0) return;
    this.unactivatedCues = { nodes, squares, pulse: null, clear: null };
    this.pulseUnactivatedCues();
    if (lifeMs !== undefined) this.armUnactivatedCuesExpiry(lifeMs);
  }

  /** One gold ring pulse on every cued token, re-armed while the cue lives. */
  private pulseUnactivatedCues(): void {
    const cue = this.unactivatedCues;
    if (!cue || !this.app) return;
    for (const [x, y] of cue.squares) {
      const anchor = squareAnchor(x, y);
      const ring = new Graphics();
      ring.ellipse(0, 0, TILE_W * 0.5, TILE_H * 0.4).stroke({ color: 0xffd166, width: 4, alpha: 0.95 });
      ring.ellipse(0, 0, TILE_W * 0.34, TILE_H * 0.26).fill({ color: 0xffd166, alpha: 0.22 });
      ring.position.set(anchor.x, anchor.y);
      ring.zIndex = this.depthZ(x, y) + 3;
      this.effectsLayer.addChild(ring);
      this.flashRings.push({ g: ring, x: anchor.x, y: anchor.y, scale: depthScale(x, y), start: performance.now(), grow: 0.35, durationMs: 600 });
    }
    cue.pulse = this.scheduleTimer(() => { if (this.unactivatedCues === cue) { cue.pulse = null; this.pulseUnactivatedCues(); } }, PitchRenderer.UNACTIVATED_PULSE_MS);
  }

  /** Let the live cue expire after `ms` (the "Go back" grace); a later show/clear supersedes it. */
  armUnactivatedCuesExpiry(ms: number): void {
    const cue = this.unactivatedCues;
    if (!cue) return;
    if (cue.clear) this.cancelTimer(cue.clear);
    cue.clear = this.scheduleTimer(() => { if (this.unactivatedCues === cue) this.clearUnactivatedCues(); }, ms);
  }

  clearUnactivatedCues(): void {
    const cue = this.unactivatedCues;
    if (!cue) return;
    this.unactivatedCues = null;
    if (cue.pulse) this.cancelTimer(cue.pulse);
    if (cue.clear) this.cancelTimer(cue.clear);
    for (const { node, tick } of cue.nodes) {
      this.app?.ticker.remove(tick);
      if (!node.destroyed) { node.parent?.removeChild(node); node.destroy(); }
    }
  }

  /** A CYAN landing reticle where the kick comes down — expands + fades over the
   *  ball flight so the eye is drawn to where the ball is headed. Owner 2026-07-08:
   *  ball cues are cyan (style-guide A1), matching the persistent target crosshair. */
  private showKickTarget(x: number, y: number): void {
    const anchor = squareAnchor(x, y);
    const scale = depthScale(x, y);
    const reticle = new Graphics();
    reticle.ellipse(0, -3, TILE_W * 0.5, TILE_H * 0.38).stroke({ color: 0x22d3ee, width: 2.5, alpha: 0.95 });
    reticle.ellipse(0, -3, TILE_W * 0.26, TILE_H * 0.2).stroke({ color: 0x22d3ee, width: 2, alpha: 0.85 });
    reticle.moveTo(0, -3 - TILE_H * 0.5).lineTo(0, -3 + TILE_H * 0.44).stroke({ color: 0x22d3ee, width: 1.5, alpha: 0.7 });
    reticle.moveTo(-TILE_W * 0.6, -3).lineTo(TILE_W * 0.6, -3).stroke({ color: 0x22d3ee, width: 1.5, alpha: 0.7 });
    reticle.position.set(anchor.x, anchor.y);
    reticle.zIndex = 0.55; // over turf, under tokens
    this.effectsLayer.addChild(reticle);
    this.flashRings.push({ g: reticle, x: anchor.x, y: anchor.y, scale, start: performance.now() });
  }

  /** Owner 2026-07-05 (from `docs/action-icons.csv`, authoritative): the active-player
   *  marker depicts the DECLARED ACTION, collapsed by FAMILY (all variants of an action
   *  → one icon). move/stand-up/etc → runner; block → fist; blitz → lightning; foul (and
   *  Kick 'Em) → foot; pass/hail-mary/dump-off → ball; hand-over → hand; throw-team-mate
   *  → 💪; gaze → 👁; bomb → 💣; kick-team-mate/punt → 🦵; vomit → 🤮; breathe-fire → 🔥;
   *  chainsaw → 🪚; stab → 🗡; chomp → 🦷; swoop → 🪂; star-player specials → ⭐. Order
   *  matters: Kick 'Em is a foul (not a block/blitz) and Hail-Mary Bomb keeps the ball. */
  private static readonly STAR_ACTIONS = new Set([
    'treacherous', 'wisdomofthewhitedwarf', 'throwkey', 'raidingparty', 'maximumcarnage',
    'lookintomyeyes', 'balefulhex', 'blackink', 'catchoftheday', 'thenistartedblastin',
    'theflashingblade', 'viciousvines', 'furiousoutburst', 'incorporeal',
  ]);
  private actionEmoji(action: string | null): string {
    const a = (action ?? '').toLowerCase().replace(/[^a-z]/g, '');
    if (a.includes('kickem')) return '🦶';                                                    // Kick 'Em → foul (before block/blitz)
    if (a.includes('pass') || a.includes('hailmary') || a.includes('dumpoff')) return '🏈';    // incl. Hail-Mary Bomb (before bomb)
    if (a.includes('bomb')) return '💣';
    if (a.includes('blitz')) return '⚡';
    if (a.includes('block')) return '👊';
    if (a.includes('foul')) return '🦶';
    if (a.includes('handover')) return '✋';
    if (a.includes('gaze')) return '👁️';
    if (a.includes('throwteammate')) return '💪';                                              // strong
    if (a.includes('kickteammate') || a.includes('punt')) return '🦵';                         // kick
    if (a.includes('vomit') || a.includes('putridregurgitation')) return '🤮';
    if (a.includes('breathefire')) return '🔥';
    if (a.includes('chainsaw')) return '🪚';
    if (a.includes('stab')) return '🗡️';
    if (a.includes('chomp')) return '🦷';
    if (a.includes('swoop')) return '🪂';                                                      // hang glider (closest emoji)
    if (PitchRenderer.STAR_ACTIONS.has(a)) return '⭐';
    return '🏃'; // move / stand-up / remove-confusion / secure-ball / forgo / undeclared
  }
  /** Owner 2026-07-05: actions that ARE skills we have icon art for — when skill
   *  icons are enabled, the marker uses the SKILL ICON instead of the emoji. */
  private actionSkill(action: string | null): string | undefined {
    const a = (action ?? '').toLowerCase().replace(/[^a-z]/g, '');
    if (a.includes('chainsaw')) return 'Chainsaw';
    if (a.includes('stab')) return 'Stab';
    if (a.includes('chomp')) return 'Chomp';
    if (a.includes('breathefire')) return 'Breathe Fire';
    if (a.includes('vomit') || a.includes('putridregurgitation')) return 'Projectile Vomit';
    if (a.includes('gaze') || a.includes('lookintomyeyes')) return 'Hypnotic Gaze';
    if (a.includes('throwteammate')) return 'Throw Team-Mate';
    if (a.includes('kickteammate')) return 'Kick Team-Mate';
    return undefined;
  }
  /** Owner 09-06: the decoration art for an action FAMILY (keyed on the same actionEmoji resolver as the glyph
   *  fallback, so special-action precedence is untouched) and the sprite height that puts every figure's CONTENT at
   *  the Blitz marker's apparent size (Blitz: 40 units tall with its art 973/1024 opaque = 38 units of figure).
   *  Null = no art for the family, or the asset has not loaded, or the emoji style is selected. */
  private actionDecorationArt(emoji: string): { texture: Texture; height: number } | null {
    if (this.actionDecorationStyle !== 'art') return null;
    const FIGURE_H = 20 * 973 / 1024; // owner 09-06: halved again (40 -> 20 for the Blitz marker)
    switch (emoji) {
      case '⚡': return this.blitzerDecoTexture ? { texture: this.blitzerDecoTexture, height: 20 } : null;
      case '🏃': return this.actionMoveDecoTexture ? { texture: this.actionMoveDecoTexture, height: FIGURE_H * 1024 / 1003 } : null; // move-v2 content 1003/1024
      case '🏈': return this.actionPassDecoTexture ? { texture: this.actionPassDecoTexture, height: FIGURE_H * 1024 / 961 } : null; // pass-v2 content 961/1024
      case '🦶': return this.actionFoulDecoTexture ? { texture: this.actionFoulDecoTexture, height: FIGURE_H * 1195 / 1181 } : null; // foul-v3 content 1181/1195
      case '✋': return this.actionHandoffDecoTexture ? { texture: this.actionHandoffDecoTexture, height: FIGURE_H * 1024 / 1003 } : null; // owner 09-08: hand-off-level-v3 content 1003/1024
      // owner 09-06: a declared BLOCK wears the attacker fist (the same art as the block decoration), not the 👊 glyph
      case '👊': return this.blockAttackerDecoTexture ? { texture: this.blockAttackerDecoTexture, height: FIGURE_H * 1024 / 968 * 0.7 } : null; // fist content 968/1024; owner 09-07: x0.7, read too large
      default: return null;
    }
  }

  private buildActionMarker(action: string | null): Container {
    const c = new Container();
    return this.trackLiveSkillAsset(c, () => {
      for (const child of c.removeChildren()) child.destroy({ children: true });
      // Use the same action-family resolver as the fallback, preserving special-action precedence.
      const art = this.actionDecorationArt(this.actionEmoji(action));
      if (art) {
        const icon = new Sprite(art.texture);
        icon.anchor.set(0.5, 0.5);
        icon.height = art.height; // Blitz 20 (owner 09-06: 2x then halved); Move/Pass/Foul matched by content height
        icon.width = art.height * art.texture.width / art.texture.height;
        c.addChild(icon);
        return;
      }
      const skill = this.showSkillIcons ? this.actionSkill(action) : undefined;
      const tex = skill ? skillIcon(skill, this.skillIconStyle) : undefined;
      if (tex) {
        const shadow = new Sprite(tex);
        shadow.anchor.set(0.5, 0.5);
        shadow.width = 21;
        shadow.height = 21;
        shadow.tint = 0x000000;
        shadow.alpha = 0.55;
        shadow.position.set(1.5, 2.5);
        c.addChild(shadow);
        const s = new Sprite(tex);
        s.anchor.set(0.5, 0.5);
        s.width = 20;
        s.height = 20;
        c.addChild(s);
      } else {
        const glyph = new Text({
          text: this.actionEmoji(action),
          style: {
            fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif',
            fontSize: 17,
            dropShadow: { color: 0x000000, alpha: 0.9, blur: 3, distance: 2.5, angle: Math.PI / 2 },
          },
        });
        glyph.anchor.set(0.5, 0.5);
        c.addChild(glyph);
      }
    });
  }

  /** Owner 2026-07-06: a soft cyan GLOWING CIRCLE around the ball (radial halo) —
   *  replaces the old vertical column of light. Concentric iso-ellipses accumulate
   *  from a faint outer rim to a bright core so it reads as a radial glow on the
   *  pitch plane; the ticker breathes the whole glow (brightness + a gentle scale). */
  private buildBallGlow(): Graphics {
    const glow = new Graphics();
    const rBase = BALL_SPRITE_SIZE * 1.13; // owner 2026-07-06: radius -1/3 (was 1.7) — confined to the square
    const rings = 8;
    for (let i = 0; i < rings; i++) {
      const t = i / (rings - 1); // 0 = outer rim, 1 = bright core
      const r = rBase * (1 - t * 0.9); // large (rim) → small (core)
      const alpha = 0.1 + 0.42 * t; // layers accumulate: faint rim → bright core
      glow.ellipse(0, 0, r, r * 0.72).fill({ color: 0x22d3ee, alpha }); // iso-circle on the pitch plane
    }
    return glow;
  }

  /** Owner 2026-07-06: the bouncing ▼/"BALL" token — shown over the ball CARRIER and
   *  over a loose ball on the field. Caller positions + scales it (BALL_TOKEN_SCALE)
   *  and stores it as this.ballMarker so the ticker bobs it. */
  private buildBallToken(shape: 'arrow' | 'label-top' | 'label-bottom' | 'label-centre' = 'arrow'): Container {
    const marker = new Container();
    const label = new Text({ text: 'BALL', style: BALL_MARKER_STYLE });
    if (shape === 'arrow') {
      const arrow = new Text({ text: '▼', style: BALL_MARKER_STYLE });
      arrow.anchor.set(0.5, 1);
      label.anchor.set(0.5, 1);
      label.position.set(0, -14);
      marker.addChild(arrow, label);
    } else {
      // Owner 09-05 (round 3): the carrier's marker is the bare word — no arrow. 'label-top' hangs the word
      // below the marker origin (feet placement); 'label-bottom' sits it above (over-head placement).
      label.anchor.set(0.5, shape === 'label-top' ? 0 : shape === 'label-centre' ? 0.5 : 1);
      marker.addChild(label);
    }
    return marker;
  }

  /** Place the carried-ball marker above any over-head skill badges on the carrier. */
  private ballMarkerYAboveSkillBadges(playerId: string, defaultY: number, depth: number): number {
    const token = this.tokensById.get(playerId);
    const badges = token?.getChildByLabel?.('skillBadges', false) as Container | null | undefined;
    if (!token || !badges) return defaultY;
    const bounds = badges.getLocalBounds() as unknown as { minY: number };
    const badgeTopY = token.position.y
      + (badges.position.y + bounds.minY * badges.scale.y) * token.scale.y;
    return Number.isFinite(badgeTopY) ? Math.min(defaultY, badgeTopY - 3 * depth) : defaultY;
  }

  /** Keep the BALL label attached to a blue edge arrow while the ball's authoritative square is off camera. */
  private updateOffscreenBallIndicator(): void {
    const marker = this.ballEdgeMarker;
    const coordinate = this.game?.fieldModel.ballCoordinate as [number, number] | null | undefined;
    if (!marker || !this.app || !this.game?.fieldModel.ballInPlay || !isOnPitch(coordinate ?? null)
      || this.moveTweens.has('__ball__') || this.passBallFlight != null || this.kickDescendSnapshot != null) {
      if (marker) marker.node.visible = false;
      return;
    }
    const target = this.squareToCanvas(coordinate!);
    const projected = target ? offscreenIndicatorForTarget(target, this.app.screen, 30) : null;
    if (!projected) {
      marker.node.visible = false;
      return;
    }
    marker.node.position.set(projected.x, projected.y);
    marker.arrow.rotation = projected.angle;
    marker.node.visible = true;
  }

  /** Keep ACTIVE attached to a gold edge arrow while the active player's rendered token is off camera. */
  private updateOffscreenActivePlayerIndicator(): void {
    const marker = this.activeEdgeMarker;
    const playerId = this.activePlayerId;
    const data = playerId
      ? this.game?.fieldModel.playerDataArray.find((player) => player.playerId === playerId)
      : undefined;
    if (!marker || !this.app || !playerId || !data || !isOnPitch(data.playerCoordinate)) {
      if (marker) marker.node.visible = false;
      return;
    }
    const token = this.tokensById.get(playerId);
    const target = token
      ? {
          x: token.position.x * this.world.scale.x + this.world.position.x,
          y: token.position.y * this.world.scale.y + this.world.position.y,
        }
      : this.squareToCanvas(data.playerCoordinate!);
    // A deeper inset keeps ACTIVE and BALL readable when the active player carries an off-screen ball.
    const projected = target ? offscreenIndicatorForTarget(target, this.app.screen, 58) : null;
    if (!projected) {
      marker.node.visible = false;
      return;
    }
    marker.node.position.set(projected.x, projected.y);
    marker.arrow.rotation = projected.angle;
    marker.node.visible = true;
  }

  /** A Sprite of the bundled ball texture at the given world size. */
  private sizedBallSprite(size: number): Sprite {
    const s = new Sprite(this.ballTexture!);
    s.anchor.set(0.5, 0.5);
    s.width = size;
    s.height = size;
    return s;
  }

  /** A player attempts to catch the ball (catchRoll): a cyan ring pulses at the
   *  catcher. Public — driven from the report stream. */
  playCatchAttempt(playerId: string): void {
    const d = this.game?.fieldModel.playerDataArray.find((p) => p.playerId === playerId);
    if (!d || !isOnPitch(d.playerCoordinate)) return;
    const [x, y] = d.playerCoordinate!;
    const anchor = squareAnchor(x, y);
    const scale = depthScale(x, y);
    const ring = new Graphics().ellipse(0, -6, TILE_W * 0.52, TILE_H * 0.42).stroke({ color: 0x66e0ff, width: 3, alpha: 0.95 });
    ring.position.set(anchor.x, anchor.y);
    ring.zIndex = this.depthZ(x, y) + 3;
    this.effectsLayer.addChild(ring);
    this.flashRings.push({ g: ring, x: anchor.x, y: anchor.y, scale, start: performance.now() });
  }

  /** Owner 2026-07-04 (followupChoice 1.1): project a game square to CANVAS pixel
   *  coordinates — for DOM overlays (chip cards) anchored to a pitch square. Returns
   *  null before the app exists. Re-query while the camera moves (zoom/pan/glide). */
  squareToCanvas(square: [number, number]): { x: number; y: number } | null {
    if (!this.app) return null;
    const a = squareAnchor(square[0], square[1]);
    return {
      x: a.x * this.world.scale.x + this.world.position.x,
      y: a.y * this.world.scale.y + this.world.position.y,
    };
  }

  /** Owner 08-18 (bullseye unify): project a square's TOKEN BODY CENTRE to canvas px — the
   *  block-crosshair anchor convention (tokenPos x-nudge, anchor.y − TILE_H·0.55·depth). For
   *  DOM badges that must sit ON the occupant's torso (the #94 blitz-target 🎯 / spent-blitzer ⚡)
   *  rather than floating over the square. Re-query while the camera moves, like squareToCanvas. */
  tokenBodyCenterToCanvas(square: [number, number]): { x: number; y: number } | null {
    if (!this.app) return null;
    const tp = this.tokenPos(square[0], square[1]);
    const a = squareAnchor(square[0], square[1]);
    const y = a.y - TILE_H * 0.55 * depthScale(square[0], square[1]);
    return {
      x: tp.x * this.world.scale.x + this.world.position.x,
      y: y * this.world.scale.y + this.world.position.y,
    };
  }

  /** Resolve a player's torso from its live rendered token, not merely from the model coordinate.
   *  Persistent DOM decorations use this during push/crowd-surf split frames: an off-pitch state or
   *  a missing token has no valid anchor, even when upstream leaves a historical/sentinel coordinate. */
  playerTokenBodyCenterToCanvas(playerId: string): { x: number; y: number } | null {
    return this.playerTokenAnchorToCanvas(playerId, 'body');
  }

  /** Validated live-token anchor for persistent player decorations. `head` preserves the legacy
   *  40px-over-token lightning placement; `body` matches the block-crosshair torso convention. */
  playerTokenAnchorToCanvas(playerId: string, anchor: 'head' | 'body'): { x: number; y: number } | null {
    if (!this.app || !this.game || !playerId) return null;
    const data = this.game.fieldModel.playerDataArray.find((entry) => entry.playerId === playerId);
    if (!data || !rendersOnPitch(data.playerState) || !isOnPitch(data.playerCoordinate)) return null;
    const token = this.tokensById.get(playerId);
    if (!token || token.destroyed || !token.visible) return null;
    const depth = depthScale(data.playerCoordinate[0], data.playerCoordinate[1]);
    // Owner 09-07: a PRONE figure lies centred on its square — its chest IS the token origin, so the body anchor
    // stays on the body instead of floating a standing-chest height above it. Standing keeps the block-crosshair
    // convention (TILE_H x 0.55 x depth) the remaining DOM badges pin to; the blitz badges themselves moved into
    // the renderer's chest row (setBlitzTokens).
    const worldY = anchor === 'body' && !isDown(data.playerState) ? token.position.y - TILE_H * 0.55 * depth : token.position.y;
    return {
      x: token.position.x * this.world.scale.x + this.world.position.x,
      y: worldY * this.world.scale.y + this.world.position.y - (anchor === 'head' ? 40 : 0),
    };
  }

  /** Canvas-space centre of the live Punt cone. Re-query while the camera moves. */
  puntConeCenter(): { x: number; y: number } | null {
    if (!this.app || !this.puntConeCenterWorld || this.bncAimKind !== 'punt') return null;
    return {
      x: this.puntConeCenterWorld.x * this.world.scale.x + this.world.position.x,
      y: this.puntConeCenterWorld.y * this.world.scale.y + this.world.position.y,
    };
  }

  /** Owner 2026-07-06: screen position of a token's HEAD at the given square — for
   *  DOM overlays that should mount ON the player (e.g. the passive "stays/follows"
   *  toast). Accounts for perspective (depthScale) AND the world zoom/pan, so it
   *  tracks the head at any zoom. */
  headToCanvas(square: [number, number], bumpAway = false, headOffsetPx = 42): { x: number; y: number } | null {
    if (!this.app) return null;
    const s = depthScale(square[0], square[1]);
    const a = squareAnchor(square[0], square[1]);
    // Owner 2026-07-07: the DEFENDER block-reaction toast is anchored to the block square
    // (the token was pushed off), and sat right on it. `bumpAway` nudges it ~half a square
    // up-and-to-the-side (world space, so it scales with zoom) so it clears the token/dice.
    // Owner 08-18: headOffsetPx lets a caller sit tighter to the head (the stay/follow pill rides 22).
    const ax = a.x + (bumpAway ? TILE_W * 0.5 * s : 0);
    const headY = a.y - headOffsetPx * s - (bumpAway ? TILE_H * 0.4 * s : 0); // just above the head
    return {
      x: ax * this.world.scale.x + this.world.position.x,
      y: headY * this.world.scale.y + this.world.position.y,
    };
  }

  /** Owner 09-05: the FEET-side counterpart of headToCanvas — a screen point just under the token's base/shadow
   *  on `square` (the skill-use pill sits BELOW the token now). `bumpAway` keeps the sideways nudge only. */
  feetToCanvas(square: [number, number], bumpAway = false, feetOffsetPx = WALKER_FEET_Y_PX + 4): { x: number; y: number } | null {
    if (!this.app) return null;
    const s = depthScale(square[0], square[1]);
    const a = this.tokenPos(square[0], square[1]);
    return {
      x: (a.x + (bumpAway ? TILE_W * 0.5 * s : 0)) * this.world.scale.x + this.world.position.x,
      y: (a.y + feetOffsetPx * s) * this.world.scale.y + this.world.position.y,
    };
  }

  /** Owner 09-05: playerScreenPos lifted to the TOP OF THE HEAD of the player's rendered token (walker figure or
   *  classic icon), so over-head banners (SPP) clear the taller walk-sheet figures. */
  playerHeadScreenPos(playerId: string, fallback?: [number, number] | null): { x: number; y: number } | null {
    const p = this.playerScreenPos(playerId, fallback);
    if (!p) return null;
    const token = this.tokensById.get(playerId);
    if (!token || token.destroyed) return { x: p.x, y: p.y - 22 * this.world.scale.y };
    const headLocal = (token.getLocalBounds() as { minY: number }).minY * token.scale.y; // token-local head top
    return { x: p.x, y: p.y + headLocal * this.world.scale.y };
  }

  /** Owner 09-05: playerScreenPos shifted to just under the player's base/shadow (walker feet or classic disc). */
  playerFeetScreenPos(playerId: string, fallback?: [number, number] | null): { x: number; y: number } | null {
    const p = this.playerScreenPos(playerId, fallback);
    if (!p) return null;
    const data = this.game?.fieldModel.playerDataArray.find((d) => d.playerId === playerId);
    const sq = isOnPitch(data?.playerCoordinate ?? null) ? (data!.playerCoordinate as [number, number]) : fallback ?? null;
    const depth = sq ? depthScale(sq[0], sq[1]) : 1;
    const token = this.tokensById.get(playerId);
    const feet = token && isWalkerToken(token) ? WALKER_FEET_Y_PX + 4 : TOKEN_BASE_SHIFT_PX + 14;
    return { x: p.x, y: p.y + feet * depth * this.world.scale.y };
  }

  /** Owner 2026-07-04 (followupChoice 1.1): a GOLD aura pulse at a square — the
   *  activation-gold styling used to highlight a chosen square (follow-up pick,
   *  arrival flash). Three staggered rings give ~1.2s of pulsing. */
  flashGoldAura(square: [number, number]): void {
    if (!this.app || !isOnPitch(square)) return;
    const [x, y] = square;
    const anchor = squareAnchor(x, y);
    const scale = depthScale(x, y);
    // Owner 2026-07-06: DEPRECATED echo — reduced from 3 staggered rings to a
    // single ring (the halo selection-pop is now the primary indicator).
    const ring = new Graphics();
    ring.ellipse(0, 0, TILE_W * 0.5, TILE_H * 0.4).stroke({ color: 0xffd166, width: 4, alpha: 0.95 });
    ring.ellipse(0, 0, TILE_W * 0.34, TILE_H * 0.26).fill({ color: 0xffd166, alpha: 0.22 });
    ring.position.set(anchor.x, anchor.y);
    ring.zIndex = this.depthZ(x, y) + 3;
    this.effectsLayer.addChild(ring);
    this.flashRings.push({ g: ring, x: anchor.x, y: anchor.y, scale, start: performance.now(), grow: 0.35, durationMs: 600 });
  }

  /** Owner 2026-07-08 (queue 5, revised): a SINGLE red pulse at the square where an
   *  injury occurs, fired WITH the injury animation (not the raw state change).
   *  (Was three staggered rings — owner: one pulse.) Rides the flashRings lifecycle. */
  playInjuryPulse(square: [number, number]): void {
    if (!this.app || !isOnPitch(square)) return;
    const [x, y] = square;
    const anchor = squareAnchor(x, y);
    const scale = depthScale(x, y);
    const ring = new Graphics();
    ring.ellipse(0, 0, TILE_W * 0.5, TILE_H * 0.4).stroke({ color: 0xe03030, width: 4, alpha: 0.95 });
    ring.ellipse(0, 0, TILE_W * 0.34, TILE_H * 0.26).fill({ color: 0xe03030, alpha: 0.2 });
    ring.position.set(anchor.x, anchor.y);
    ring.zIndex = this.depthZ(x, y) + 3;
    this.effectsLayer.addChild(ring);
    this.flashRings.push({ g: ring, x: anchor.x, y: anchor.y, scale, start: performance.now(), grow: 0.6 });
  }

  /** Owner 2026-07-08 (queues 3+7): the LIVE canvas position of a player's TOKEN —
   *  the reliable anchor for toasts that must sit on the player (KO toast, skill-use
   *  toast). Mid-tween uses the moving token's real position; an on-pitch model square
   *  remains authoritative; then a rendered dugout token wins over the historical pitch
   *  square. `fallback` still covers presentation surfaces with no rendered dugout. */
  playerScreenPos(playerId: string, fallback?: [number, number] | null): { x: number; y: number } | null {
    if (!this.app) return null;
    const tween = this.moveTweens.get(playerId);
    if (tween && !tween.token.destroyed) {
      return {
        x: this.world.position.x + tween.token.position.x * this.world.scale.x,
        y: this.world.position.y + tween.token.position.y * this.world.scale.y,
      };
    }
    const data = this.game?.fieldModel.playerDataArray.find((d) => d.playerId === playerId);
    if (isOnPitch(data?.playerCoordinate ?? null)) return this.screenPosOf(data!.playerCoordinate as [number, number]);
    const dugoutToken = this.dugoutTokensById.get(playerId);
    if (dugoutToken && !dugoutToken.destroyed && dugoutToken.parent) {
      return {
        x: this.world.position.x + dugoutToken.position.x * this.world.scale.x,
        y: this.world.position.y + dugoutToken.position.y * this.world.scale.y,
      };
    }
    const sq = this.lastSquares.get(playerId) ?? fallback ?? null;
    return sq && isOnPitch(sq) ? this.screenPosOf(sq) : null;
  }

  // --- Owner 2026-07-04f: square MARKS (static gold light columns) -----------
  private markKey(x: number, y: number) { return `${x},${y}`; }
  /** Depth/width coordinate of a square in the ACTIVE orientation (for row/col). */
  private depthOf(sq: [number, number]) { return getOrientation() === 'ns' ? sq[0] : sq[1]; }
  private widthOf(sq: [number, number]) { return getOrientation() === 'ns' ? sq[1] : sq[0]; }
  /** All on-pitch squares sharing the target's DEPTH (a visual east-west "row"). */
  private rowSquares(target: [number, number]): [number, number][] {
    const out: [number, number][] = [];
    const d = this.depthOf(target);
    for (let x = 0; x < PITCH_COLS; x++) for (let y = 0; y < PITCH_ROWS; y++) if (this.depthOf([x, y]) === d) out.push([x, y]);
    return out;
  }
  /** All on-pitch squares sharing the target's WIDTH (a visual north-south "column"). */
  private colSquares(target: [number, number]): [number, number][] {
    const out: [number, number][] = [];
    const w = this.widthOf(target);
    for (let x = 0; x < PITCH_COLS; x++) for (let y = 0; y < PITCH_ROWS; y++) if (this.widthOf([x, y]) === w) out.push([x, y]);
    return out;
  }
  /** Toggle a single square mark (owner: Mark Square / Shift-click). */
  toggleMarkSquare(square: [number, number]): void {
    const k = this.markKey(square[0], square[1]);
    if (this.marks.has(k)) this.marks.delete(k); else this.marks.add(k);
    this.drawMarks();
  }
  /** Owner 2026-07-08: toggle a mark, tolerating a click on the MARK'S LIGHT COLUMN.
   *  The column rises ~1.6 tiles ABOVE the square's ground anchor, so a shift-click on
   *  the visible mark maps (via worldToSquare) to a square a row or two farther up the
   *  pitch — the old exact-square toggle then couldn't find the mark and ADDED a new one
   *  ("shift-click a marked square doesn't clear it"). So: exact square marked → clear it;
   *  else a click inside any existing mark's column → clear THAT mark; else add here. */
  toggleMarkNear(worldX: number, worldY: number, square: [number, number]): void {
    const exact = this.markKey(square[0], square[1]);
    if (this.marks.has(exact)) { this.marks.delete(exact); this.drawMarks(); return; }
    for (const key of this.marks) {
      const [mx, my] = key.split(',').map(Number) as [number, number];
      const a = squareAnchor(mx, my);
      const s = depthScale(mx, my);
      const height = TILE_H * 1.6 * s; // matches buildMarkColumn
      const halfW = TILE_W * 0.3 * s; // a touch wider than the column base for an easy hit
      if (worldX >= a.x - halfW && worldX <= a.x + halfW && worldY <= a.y + halfW && worldY >= a.y - height) {
        this.marks.delete(key);
        this.drawMarks();
        return;
      }
    }
    this.marks.add(exact);
    this.drawMarks();
  }
  /** Owner 09-05: row/column marks TOGGLE — a second Ctrl+Shift / Alt+Shift click on a fully marked line clears
   *  it; a partially marked line fills in. */
  private toggleMarkLine(squares: [number, number][]): void {
    const keys = squares.map(([x, y]) => this.markKey(x, y));
    const allMarked = keys.length > 0 && keys.every((k) => this.marks.has(k));
    for (const k of keys) { if (allMarked) this.marks.delete(k); else this.marks.add(k); }
    this.drawMarks();
  }
  /** Mark (or, when already fully marked, CLEAR) the visual ROW through `target` (Mark Row / Ctrl+Shift-click). */
  markRow(target: [number, number]): void { this.toggleMarkLine(this.rowSquares(target)); }
  /** Mark (or clear) the visual COLUMN through `target` (Mark Column / Alt+Shift-click). */
  markColumn(target: [number, number]): void { this.toggleMarkLine(this.colSquares(target)); }
  clearMarks(): void { this.marks.clear(); this.drawMarks(); }
  hasMarks(): boolean { return this.marks.size > 0; }
  /** Redraw the mark light columns (persistent; re-run on refresh/orientation). */
  private drawMarks(): void {
    for (const c of this.marksLayer.removeChildren()) c.destroy({ children: true });
    for (const key of this.marks) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      if (!isOnPitch([x, y])) continue;
      const a = squareAnchor(x, y);
      const s = depthScale(x, y);
      const col = this.buildMarkColumn(s);
      col.position.set(a.x, a.y);
      col.zIndex = this.depthZ(x, y);
      this.marksLayer.addChild(col);
    }
  }
  /** A static GOLD light column marking a square (mirrors the ball's cyan column). */
  private buildMarkColumn(scale: number): Graphics {
    const col = new Graphics();
    const height = TILE_H * 1.6 * scale;
    const baseW = TILE_W * 0.5 * scale;
    const slices = 14;
    for (let i = 0; i < slices; i++) {
      const t0 = i / slices;
      const t1 = (i + 1) / slices;
      const alpha = 0.5 * (1 - t0);
      const w = baseW * (1 - t0 * 0.35);
      col.rect(-w / 2, -height * t1, w, height * (t1 - t0)).fill({ color: this.markColor, alpha });
    }
    // a soft disc on the ground under the column
    col.ellipse(0, 0, baseW * 0.6, baseW * 0.34).fill({ color: this.markColor, alpha: 0.35 });
    return col;
  }

  /** On-pitch action d6 (owner 2026-07-03 r3): pop a die showing `value` (1–6)
   *  NEXT TO the given square (upper-right corner), animated in/hold/out. Driven
   *  from the report stream on skill/agility rolls (pickup, dodge, GFI, catch…). */
  showActionDie(square: [number, number], value: number, cause?: string, failed?: boolean, needed?: number, rerollSkill?: string, rerollTeam?: boolean, opponentRerollPending?: boolean): void {
    if (!this.app || !isOnPitch(square) || !isD6FaceValue(value)) return;
    const [x, y] = square;
    const anchor = squareAnchor(x, y);
    const scale = depthScale(x, y);
    // Owner 09-06: a RE-ROLLED die replaces the held original ('REROLLING?') at the same square at once — the two
    // dice stacked ('USED!' over 'REROLLING?') on the opponent's view.
    if (rerollSkill) {
      this.actionDice = this.actionDice.filter((d) => {
        const same = d.holdForOpponentReroll && d.square && d.square[0] === x && d.square[1] === y;
        if (same) { d.node.parent?.removeChild(d.node); d.node.destroy({ children: true }); }
        return !same;
      });
    }
    const die = this.buildD6(value, cause);
    // Owner 2026-07-05 / 2026-07-08: a FAILED roll gets a stenciled tag beside the
    // die (play mode included, rev 3); the roll NEEDED is folded in: "FAILED (3+)".
    if (failed) die.addChild(this.buildFailedStencil(needed, opponentRerollPending));
    // Owner 2026-07-08: EVERY reroll captions the re-rolled die in soft gold — a SKILL reroll
    // (Dodge, Sure Hands, Pro…) reads "<skill icon/glyph> reroll"; a TEAM reroll reads
    // "<TRR inducement icon> used!".
    if (rerollSkill) die.addChild(this.buildRerollLabel(rerollSkill, rerollTeam));
    // sit at the square's upper-right so it reads "next to" the action, not on it
    die.position.set(anchor.x + TILE_W * 0.5 * scale, anchor.y - TILE_H * 0.7 * scale);
    die.scale.set(0.05);
    die.alpha = 0;
    die.zIndex = this.depthZ(x, y) + 60; // above tokens + markers
    this.effectsLayer.addChild(die);
    this.actionDice.push({
      node: die,
      baseScale: scale,
      start: performance.now(),
      holdForOpponentReroll: opponentRerollPending,
      // owner 09-06: a failed RE-ROLL stays up until the turnover splash (releaseDiceAtTurnover), not one tick
      holdUntilTurnover: !!(rerollSkill && failed),
      square: [x, y],
    });
  }

  /** Owner 09-06: the turnover tears down the dice held for it (a failed re-roll's result). */
  releaseDiceAtTurnover(): void {
    const now = performance.now();
    const holdBoundary = presentationMs(ACTION_DIE_IN_MS + ACTION_DIE_HOLD_MS);
    for (const die of this.actionDice) {
      if (!die.holdUntilTurnover) continue;
      if (now - die.start > holdBoundary) die.start = now - holdBoundary;
      die.holdUntilTurnover = false;
    }
  }

  /** Keep the opponent's original failed die readable for as long as the server-owned
   * reroll offer is live. Once that dialog closes, resume at the normal fade boundary. */
  private releaseOpponentRerollDice(): void {
    const now = performance.now();
    const holdBoundary = presentationMs(ACTION_DIE_IN_MS + ACTION_DIE_HOLD_MS);
    for (const die of this.actionDice) {
      if (!die.holdForOpponentReroll) continue;
      if (now - die.start > holdBoundary) die.start = now - holdBoundary;
      die.holdForOpponentReroll = false;
    }
  }

  /** Owner o66 #7: a labelled PASS/CATCH roll MODAL over the passer's / catcher's head, using D6 faces, on a
   *  green (success) or red (fail) pill. Screen-constant size (a UI modal, always readable); pops in, holds, then
   *  rises + fades (rollModals ticker). Replaces the generic feet-die for these two rolls (owner-requested). */
  showRollModal(square: [number, number], kind: 'pass' | 'catch', roll: number, needed: number | undefined, ok: boolean, reRolled?: boolean): void {
    if (!this.app || !isOnPitch(square) || roll < 1 || roll > 6) return;
    const [x, y] = square;
    const anchor = squareAnchor(x, y);
    const scale = depthScale(x, y);
    const content = new Container();
    const style = new TextStyle({ fontFamily: 'sans-serif', fontSize: 13, fontWeight: 'bold', fill: 0xffffff });
    let cursor = 0;
    const addText = (label: string) => {
      const text = new Text({ text: label, style });
      text.anchor.set(0, 0.5);
      text.position.set(cursor, 0);
      content.addChild(text);
      cursor += text.width + 4;
    };
    const addFace = (value: number) => {
      const face = this.buildD6(value);
      face.scale.set(0.64);
      face.position.set(cursor + 9, 0);
      content.addChild(face);
      cursor += 22;
    };
    addText(kind === 'pass' ? 'Pass' : 'Catch');
    addFace(roll);
    if (needed && isD6FaceValue(needed)) {
      addText('/');
      addFace(needed);
      addText('+');
    }
    addText(ok ? '✓' : '✗');
    if (reRolled) {
      // Owner 09-05: the re-roll marker is the TRR token icon (the old ↻ arrow only as a texture-less fallback).
      if (this.tokenRerollIcon) {
        const icon = new Sprite(this.tokenRerollIcon);
        icon.anchor.set(0, 0.5);
        const size = 16;
        icon.scale.set(size / Math.max(1, this.tokenRerollIcon.width));
        icon.position.set(cursor + 3, 0);
        content.addChild(icon);
        cursor += size + 5;
      } else {
        addText(' ↻');
      }
    }
    content.pivot.set(cursor / 2, 0);
    const w = cursor + 18, h = 30;
    const pill = new Graphics()
      .roundRect(-w / 2, -h / 2, w, h, 6).fill({ color: ok ? 0x2f9e44 : 0xc0392b, alpha: 0.94 })
      .roundRect(-w / 2, -h / 2, w, h, 6).stroke({ color: 0x10160f, width: 1.6, alpha: 0.9 });
    const node = new Container();
    node.addChild(pill);
    node.addChild(content);
    const baseY = anchor.y - TILE_H * scale * 1.3; // over the head (depth-aware offset, constant on-screen size)
    node.position.set(anchor.x, baseY);
    node.alpha = 0;
    node.zIndex = this.depthZ(x, y) + 70; // above the action die
    this.effectsLayer.addChild(node);
    this.rollModals.push({ node, start: performance.now(), baseY });
  }

  /** Stenciled failure label with the required D6 face. */
  private buildFailedStencil(needed?: number, opponentRerollPending?: boolean): Container {
    const c = new Container();
    const failed = this.buildStencilTag('FAILED');
    c.addChild(failed);
    if (!opponentRerollPending && isD6FaceValue(needed)) {
      const face = this.buildD6(needed);
      face.scale.set(0.52);
      face.position.set(failed.width / 2 + 9, 0);
      const plus = new Text({ text: '+', style: DODGE_STYLE });
      plus.anchor.set(0, 0.5);
      plus.position.set(failed.width / 2 + 17, 0);
      c.addChild(face, plus);
    }
    if (opponentRerollPending) {
      const pending = new Text({
        text: 'Rerolling?',
        style: {
          fontFamily: 'Nuffle, system-ui, sans-serif', fontSize: 9, fontWeight: 'bold',
          fill: 0xe9dcc0, stroke: { color: 0x14161a, width: 3 },
        },
      });
      pending.anchor.set(0.5, 0);
      pending.position.set(0, 14);
      // Owner 09-06: the question only appears after ~2 s of waiting on the opponent — a prompt reroll replaces
      // the held die first and the text never shows (the timer finds it destroyed).
      pending.visible = false;
      this.scheduleTimer(() => { if (!pending.destroyed && !c.destroyed) pending.visible = true; }, presentationMs(2000));
      c.addChild(pending);
    }
    c.position.set(0, 26); // below the 28px die
    return c;
  }

  /** Owner 2026-07-08: a soft-gold caption under a re-rolled action die. A SKILL reroll reads
   *  "<skill icon/glyph> reroll" (Dodge, Sure Hands, Pro…); a TEAM reroll reads "<TRR icon>
   *  used!". Uses the icon art when available, else a gold glyph plate of the initials. */
  private buildRerollLabel(skillName: string, isTeam?: boolean): Container {
    const c = new Container();
    return this.trackLiveSkillAsset(c, () => {
      for (const child of c.removeChildren()) child.destroy({ children: true });
      const gold = 0xf0d488;
      const gap = 3;
      let iconNode: Sprite | Container;
      let iconW = 0;
      const teamTex = isTeam ? this.tokenRerollIcon : null;
      const tex = teamTex ?? skillIcon(skillName, this.skillIconStyle);
      if (tex) {
        const s = new Sprite(tex);
        s.anchor.set(0, 0.5);
        s.width = 13; s.height = 13;
        iconNode = s; iconW = 13;
      } else {
        const label = isTeam ? 'TRR' : (skillName.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 3).toUpperCase() || '★');
        const g = new Container();
        const t = new Text({ text: label, style: { fontFamily: 'Arial Black, sans-serif', fontSize: 10, fontWeight: 'bold', fill: gold } });
        t.anchor.set(0, 0.5);
        const plate = new Graphics().roundRect(-2, -8, t.width + 4, 16, 4).fill({ color: 0x14161a, alpha: 0.85 }).stroke({ color: gold, width: 1 });
        g.addChild(plate, t);
        iconNode = g; iconW = t.width + 2;
      }
      const word = new Text({
        text: isTeam ? 'used!' : 'reroll',
        style: { fontFamily: 'Nuffle, system-ui, sans-serif', fontSize: 11, fontWeight: 'bold', fill: gold, stroke: { color: 0x14161a, width: 3 } },
      });
      word.anchor.set(0, 0.5);
      iconNode.position.set(0, 0);
      word.position.set(iconW + gap, 0);
      c.addChild(iconNode, word);
      c.position.set(-(iconW + gap + word.width) / 2, 28);
    });
  }

  /** Owner 2026-07-08: a generic red military-stencil tag (the FAILED look) — red fill,
   *  dark outline, uppercase, on a faint dark plate. Reused for the armour-break callout. */
  private buildStencilTag(label: string): Container {
    const c = new Container();
    const text = new Text({
      text: label,
      style: {
        fontFamily: '"Arial Black", Impact, sans-serif',
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 1.5,
        fill: 0xe23b3b, // red
        stroke: { color: 0x14161a, width: 3 }, // dark stencil outline
      },
      // Owner 09-06: the 11 px raster was stretched by the camera zoom (up to 4x) and the die scale — 'FAILED' /
      // 'REROLLING?' read blurry. A 4x canvas + linear filtering/mipmaps stays crisp at every rung (marking-text rule).
      resolution: 4,
      textureStyle: { scaleMode: 'linear' },
      autoGenerateMipmaps: true,
    });
    text.anchor.set(0.5, 0.5);
    const w = text.width + 8;
    const plate = new Graphics().roundRect(-w / 2, -9, w, 18, 4).fill({ color: 0x14161a, alpha: 0.44 });
    c.addChild(plate, text);
    return c;
  }

  /** Owner 2026-07-05: a player USED a skill — pop the skill's icon (or a glyph
   *  plate fallback) over their head and let it fade. Replaces the distracting
   *  skill-use spotlight; reuses the action-die pop-in/hold/fade lifecycle so it
   *  self-removes. Positioned on the token's real column (tokenPos, perspective-
   *  nudged) so it reads as "this player, right here". */
  playSkillIconFade(square: [number, number], skillName: string): void {
    if (!this.app || !isOnPitch(square)) return;
    const [x, y] = square;
    const anchor = squareAnchor(x, y);
    const tp = this.tokenPos(x, y);
    const scale = depthScale(x, y);
    const node = new Container();
    this.trackLiveSkillAsset(node, () => {
      for (const child of node.removeChildren()) child.destroy({ children: true });
      const tex = skillName ? skillIcon(skillName, this.skillIconStyle) : undefined;
      if (tex) {
        const s = new Sprite(tex);
        s.anchor.set(0.5, 0.5);
        s.width = TILE_W * 0.62;
        s.height = TILE_W * 0.62;
        const back = new Graphics().circle(0, 0, TILE_W * 0.4).fill({ color: 0x14161a, alpha: 0.55 });
        node.addChild(back, s);
      } else {
        const label = skillName.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 3).toUpperCase() || '★';
        const plate = new Graphics().roundRect(-18, -11, 36, 22, 5).fill({ color: 0x14161a, alpha: 0.92 }).stroke({ color: 0xe8b23a, width: 1.5 });
        const t = new Text({ text: label, style: { fontFamily: 'sans-serif', fontSize: 12, fontWeight: 'bold', fill: 0xe8b23a } });
        t.anchor.set(0.5, 0.5);
        node.addChild(plate, t);
      }
    });
    node.position.set(tp.x, anchor.y - TILE_H * 0.9 * scale); // over the head
    node.scale.set(0.05);
    node.alpha = 0;
    node.zIndex = this.depthZ(x, y) + 60;
    this.effectsLayer.addChild(node);
    this.actionDice.push({ node, baseScale: scale * 0.67, start: performance.now() }); // owner 09-07: skill-use pop -33%
  }

  /** Owner 2026-07-08: VAMPIRE FEED — pop a 🧛 over a bitten Thrall's head just before the
   *  "bitten" injury plays, so the feed reads first. Reuses the action-die pop/hold/fade
   *  lifecycle (self-removing). `playerId` accepted for parity with the store call. */
  armVampireBite(_playerId: string, square: [number, number]): void {
    if (!this.app || !isOnPitch(square)) return;
    const [x, y] = square;
    const anchor = squareAnchor(x, y);
    const tp = this.tokenPos(x, y);
    const scale = depthScale(x, y);
    const node = new Text({
      text: '🧛',
      style: { fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif', fontSize: 22 },
    });
    node.anchor.set(0.5, 0.5);
    node.position.set(tp.x, anchor.y - TILE_H * 0.98 * scale); // over the head
    node.scale.set(0.05);
    node.alpha = 0;
    node.zIndex = this.depthZ(x, y) + 62;
    this.effectsLayer.addChild(node);
    this.actionDice.push({ node, baseScale: scale, start: performance.now() });
  }

  /** Owner 2026-07-05: world→screen position of a pitch square's token, for
   *  anchoring DOM overlays (e.g. the skill-use toast) right at the action.
   *  Returns null when off-pitch or before the stage exists. */
  screenPosOf(square: [number, number]): { x: number; y: number } | null {
    if (!this.app || !isOnPitch(square)) return null;
    const tp = this.tokenPos(square[0], square[1]);
    const scale = this.world.scale.x;
    return {
      x: this.world.position.x + tp.x * scale,
      y: this.world.position.y + tp.y * scale,
    };
  }

  /** Owner 2026-07-05: the ARMOUR roll (2d6) pops above a fallen player, prefixed
   *  with a breastplate glyph 🛡. A broken armour gets a red underline. Reuses the
   *  action-die pop/hold/fade lifecycle so it self-removes. Positioned on the
   *  square's column, above the head, so it reads "this player's armour". */
  showArmorRoll(square: [number, number], rolls: [number, number], broken: boolean): void {
    if (!this.app || !isOnPitch(square) || rolls.length !== 2) return;
    const [x, y] = square;
    const tp = this.tokenPos(x, y);
    const anchor = squareAnchor(x, y);
    const scale = depthScale(x, y);
    const node = new Container();
    // Owner 2026-07-08: the armour glyph is a KNIGHT BREASTPLATE sprite (assets/decorations/
    // breastplate.png), sized to match the old 🛡 emoji (~15px); the emoji stays as a fallback
    // if the texture didn't load.
    const plateTex = this.downDecorations.get('breastplate');
    const plate: Sprite | Text = plateTex
      ? Object.assign(new Sprite(plateTex), { height: 16, width: 16 * (plateTex.width / plateTex.height) })
      : new Text({
          text: '🛡',
          style: { fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif', fontSize: 15 },
        });
    plate.anchor.set(0.5, 0.5);
    plate.position.set(-18, 0);
    node.addChild(plate);
    const d1 = this.buildD6(rolls[0]); d1.scale.set(0.6); d1.position.set(2, 0);
    const d2 = this.buildD6(rolls[1]); d2.scale.set(0.6); d2.position.set(18, 0);
    node.addChild(d1, d2);
    if (broken) {
      node.addChild(new Graphics().roundRect(-27, 12, 54, 3, 1.5).fill({ color: 0xff5555, alpha: 0.95 }));
      // Owner 2026-07-08: a broken armour gets a red "ARMOR BREAKS!" stencil (the FAILED look),
      // sat below the dice, so the break reads loud — not just the subtle underline.
      const tag = this.buildStencilTag('ARMOR BREAKS!');
      tag.position.set(0, 26);
      node.addChild(tag);
    }
    node.position.set(tp.x, anchor.y - TILE_H * 0.95 * scale);
    node.scale.set(0.05);
    node.alpha = 0;
    node.zIndex = this.depthZ(x, y) + 60;
    this.effectsLayer.addChild(node);
    this.actionDice.push({ node, baseScale: scale, start: performance.now() });
  }

  /** A doctor/apothecary figure — the bundled sprite, else a drawn medic (white
   *  coat + red cross). Centred on its own origin, ~a player tall. */
  private buildDoctor(): Container {
    const c = new Container();
    if (this.apothecaryTexture) {
      const s = new Sprite(this.apothecaryTexture);
      s.anchor.set(0.5, 0.9);
      // #88 (owner): the bouncing character IS the Apothecary.png sprite, sized ≈ a standard
      // player token (PLAYER_SPRITE_BASE) with aspect PRESERVED — the art is portrait (928×1373),
      // so forcing a square width==height squashed it.
      s.scale.set(PLAYER_SPRITE_BASE / Math.max(this.apothecaryTexture.width, this.apothecaryTexture.height));
      c.addChild(s);
      return c;
    }
    // drawn fallback: white coat body, head, and a red cross
    const g = new Graphics();
    g.roundRect(-6, -18, 12, 18, 3).fill({ color: 0xf4f1e8 }).stroke({ color: 0x2a2a2a, width: 1 });
    g.circle(0, -22, 4).fill({ color: 0xe8c9a0 }).stroke({ color: 0x2a2a2a, width: 1 });
    g.rect(-3, -13, 6, 2).fill({ color: 0xd11 });
    g.rect(-1, -15, 2, 6).fill({ color: 0xd11 });
    c.addChild(g);
    return c;
  }

  /**
   * Apothecary treatment cinematic (owner 2026-07-03 r6f): a doctor runs in from
   * the team's sideline to the injured player's square, BOUNCES on them, then
   * exits per the outcome:
   *   - 'stay'    (KO → stun): treats and jogs back to the sideline, fading.
   *   - 'reserves' (Badly Hurt): escorts the player off to the RESERVES box.
   *   - 'building' (worse casualty): escorts the player off toward the nearest
   *     stadium building, scaling down as they "disappear into the door".
   * Play-mode flourish only — the real state change rides the wire (the store
   * sends clientUseApothecary / clientApothecaryChoice); this just animates it.
   */
  playApothecary(square: [number, number], outcome: 'stay' | 'reserves' | 'building', isHome: boolean, medic = true, playerId?: string): void {
    if (!this.app || !isOnPitch(square)) return;
    const [px, py] = square;
    const scale = depthScale(px, py);
    const player = squareAnchor(px, py);
    // sideline start: the team's touchline row beside the player (home = HIGH y edge,
    // right — dugouts swapped 2026-07-07, case 352)
    const sideY = isHome ? PITCH_ROWS : -1;
    const start = squareAnchor(Math.max(0, Math.min(PITCH_COLS - 1, px)), sideY);
    // exit target
    const reservesX = isHome ? 2 : 23;
    const reservesY = isHome ? PITCH_ROWS + 1 : -2; // home dugout on the right (case 352)
    const casX = isHome ? 11 : 14; // CAS box nearest midfield
    const exit =
      outcome === 'reserves'
        ? squareAnchor(reservesX, reservesY)
        : outcome === 'building'
          ? squareAnchor(casX, isHome ? PITCH_ROWS + 2 : -3) // toward the corner buildings (home = right, case 352)
          : start; // 'stay' jogs back to the sideline

    // #75 (owner batch §N): a DECLINED apothecary (medic=false) still needs the token escorted off
    // (C7: no vanishing player) but must NOT read as "apo used" — so no doctor runs in. Play a
    // doctor-less escort of the ghost to the exit; 'stay' (nothing leaves the pitch) is a no-op.
    if (!medic) {
      if (outcome === 'stay') return;
      // #154 (owner 07-23): escort the REAL injured player's token off (via playerId), not the generic
      // disc — falls back to the disc when the snapshot can't build (legacy / player not found).
      const ghost = (playerId ? this.buildInjuredSnapshot(playerId, isHome) : null) ?? this.buildDoctorGhost(isHome);
      ghost.position.set(player.x, player.y);
      ghost.scale.set(scale);
      ghost.zIndex = 99999;
      try {
        this.effectsLayer.addChild(ghost);
        const ESCORT_MS = presentationMs(1150);
        const e0 = performance.now();
        const mix = (a: number, b: number, t: number) => a + (b - a) * t;
        const app = this.app;
        let cleanup: () => void = () => {};
        const step = () => {
          const e = performance.now() - e0;
          if (e >= ESCORT_MS || ghost.destroyed || this.app !== app) { cleanup(); return; }
          const t = e / ESCORT_MS;
          ghost.position.set(mix(player.x, exit.x, t), mix(player.y, exit.y, t));
          if (outcome === 'building') ghost.scale.set(scale * (1 - 0.85 * t)); // shrink into the door
          ghost.alpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
        };
        cleanup = this.registerEffectTicker(app, step, [ghost]);
      } catch (error) {
        ghost.parent?.removeChild(ghost);
        if (!ghost.destroyed) ghost.destroy({ children: true });
        throw error;
      }
      return;
    }

    const doctor = this.buildDoctor();
    doctor.position.set(start.x, start.y);
    doctor.scale.set(scale);
    doctor.zIndex = 100000; // above everything
    doctor.alpha = 0;
    this.effectsLayer.addChild(doctor);
    // #154 (owner 07-23): the injured player's REAL token stays visible UNDER the doctor bounce until the
    // escort resolves (the removal beat = my escort end; the model already removed the player per g469, so
    // nothing re-appears). Snapshot it off playerId; fall back to the faint disc (legacy / player not found).
    const realSnap = outcome === 'stay' ? null : playerId ? this.buildInjuredSnapshot(playerId, isHome) : null;
    const ghost = outcome === 'stay' ? null : realSnap ?? this.buildDoctorGhost(isHome);
    if (ghost) {
      ghost.position.set(player.x, player.y);
      ghost.scale.set(scale);
      // the REAL token holds visible from the start (no vanish-then-reappear); the legacy disc keeps its
      // bounce-time reveal (alpha 0 until the doctor arrives).
      ghost.alpha = realSnap ? 1 : 0;
      ghost.zIndex = 99999;
      try {
        this.effectsLayer.addChild(ghost);
      } catch (error) {
        if (realSnap && !realSnap.destroyed) realSnap.destroy({ children: true });
        throw error;
      }
    }

    const RUN_MS = presentationMs(700);
    const BOUNCE_MS = presentationMs(950);
    const EXIT_MS = presentationMs(outcome === 'stay' ? 650 : 1150);
    const total = RUN_MS + BOUNCE_MS + EXIT_MS;
    const t0 = performance.now();
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const app = this.app;
    let cleanup: () => void = () => {};
    const tick = () => {
      const e = performance.now() - t0;
      if (e >= total || doctor.destroyed || this.app !== app) { cleanup(); return; }
      if (e < RUN_MS) {
        // run in from the sideline to the player
        const t = e / RUN_MS;
        doctor.alpha = Math.min(1, t * 2);
        doctor.position.set(lerp(start.x, player.x, t), lerp(start.y, player.y, t));
      } else if (e < RUN_MS + BOUNCE_MS) {
        // bounce on the prone player
        const t = (e - RUN_MS) / BOUNCE_MS;
        doctor.alpha = 1;
        const hop = Math.abs(Math.sin(t * Math.PI * 3)) * TILE_H * 0.5 * scale;
        doctor.position.set(player.x, player.y - hop);
        if (ghost) ghost.alpha = 1;
      } else {
        // exit per the outcome
        const t = (e - RUN_MS - BOUNCE_MS) / EXIT_MS;
        doctor.position.set(lerp(player.x, exit.x, t), lerp(player.y, exit.y, t));
        if (ghost) ghost.position.set(lerp(player.x, exit.x, t), lerp(player.y, exit.y, t));
        if (outcome === 'building') {
          const s = scale * (1 - 0.85 * t); // shrink into the door
          doctor.scale.set(s);
          if (ghost) ghost.scale.set(s);
        }
        const fade = outcome === 'stay' ? 1 - t : t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
        doctor.alpha = fade;
        if (ghost) ghost.alpha = fade;
      }
    };
    try {
      cleanup = this.registerEffectTicker(app, tick, ghost ? [doctor, ghost] : [doctor]);
    } catch (error) {
      if (realSnap && !realSnap.destroyed) {
        realSnap.parent?.removeChild(realSnap);
        realSnap.destroy({ children: true });
      }
      throw error;
    }
  }

  /** #154 (owner 07-23): the injured player's REAL token for the apothecary escort — the sprite the
   *  doctor bounces on / carries off, in place of the generic disc. Sourced off playerId: the roster
   *  identity (team.playerArray) + the field data (playerDataArray, still present in its down/CAS state
   *  when the apo resolves) → buildPlayerToken with no rings/badges/shading (a clean escorted sprite).
   *  Returns null if the player can't be resolved → the caller falls back to buildDoctorGhost. */
  private buildInjuredSnapshot(playerId: string, isHome: boolean): Container | null {
    if (!this.game) return null;
    const team = isHome ? this.game.teamHome : this.game.teamAway;
    const player = team.playerArray.find((p) => p.playerId === playerId);
    const data = this.game.fieldModel.playerDataArray.find((d) => d.playerId === playerId);
    if (!player || !data) return null;
    return this.buildPlayerToken(player, data, isHome, team, undefined, false, false, false);
  }

  /** A faint team-coloured disc standing in for the escorted player. */
  private buildDoctorGhost(isHome: boolean): Container {
    const c = new Container();
    const color = isHome ? COLORS.homeBody : COLORS.awayBody;
    c.addChild(new Graphics().circle(0, -4, TILE_W * 0.26).fill({ color, alpha: 0.85 }).stroke({ color: 0xffffff, width: 1, alpha: 0.6 }));
    return c;
  }

  /**
   * Owner 2026-07-03: crowd-surf cinematic — a player was pushed OUT OF BOUNDS.
   * A handful of angry fans leave the nearest stand, RUSH onto the field to the
   * player's last (edge) square, BOUNCE on them, then RUN BACK to the stands and
   * fade. The injury animation (casualty/KO) follows once this clears (the store
   * sequences it after CROWD_SURF_MS). Play-mode/live flourish only — the real
   * state change (removal + injury) rides the wire; this just animates it.
   */
  playCrowdSurf(square: [number, number]): void {
    if (!this.app || !isOnPitch(square)) return;
    const [px, py] = square;
    const scale = depthScale(px, py);
    const player = squareAnchor(px, py);
    // nearest sideline → the crowd rushes from that edge
    const dLeft = px, dRight = PITCH_COLS - 1 - px, dTop = py, dBottom = PITCH_ROWS - 1 - py;
    const nearest = Math.min(dLeft, dRight, dTop, dBottom);
    // a point `d` squares beyond the nearest edge, aligned with the player's column/row
    const beyond = (d: number) => {
      if (nearest === dTop) return squareAnchor(px, -1 - d);
      if (nearest === dBottom) return squareAnchor(px, PITCH_ROWS + d);
      if (nearest === dLeft) return squareAnchor(-1 - d, py);
      return squareAnchor(PITCH_COLS + d, py);
    };
    const stand = beyond(2); // fans start from / return to the stand front

    const N = 4;
    const fans: { c: Container; ox: number; delay: number }[] = [];
    for (let i = 0; i < N; i++) {
      const f = this.buildFan();
      const spread = i - (N - 1) / 2;
      const ox = spread * TILE_W * 0.5 * scale; // stagger across the stand front
      f.position.set(stand.x + ox, stand.y);
      f.scale.set(scale * 0.9);
      f.zIndex = 100000; // above everything
      f.alpha = 0;
      this.effectsLayer.addChild(f);
      fans.push({ c: f, ox, delay: i * presentationMs(90) });
    }

    const RUN_MS = presentationMs(620);
    const BOUNCE_MS = presentationMs(900);
    const EXIT_MS = presentationMs(700);
    const total = RUN_MS + BOUNCE_MS + EXIT_MS + (N - 1) * presentationMs(90);
    const t0 = performance.now();
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const app = this.app;
    let cleanup: () => void = () => {};
    const tick = () => {
      const now = performance.now() - t0;
      if (now >= total || this.app !== app) { cleanup(); return; }
      for (const fan of fans) {
        const e = now - fan.delay;
        if (e < 0) continue;
        const targetX = player.x + fan.ox * 0.4;
        const targetY = player.y;
        if (e < RUN_MS) {
          const t = e / RUN_MS;
          fan.c.alpha = Math.min(1, t * 2);
          fan.c.position.set(lerp(stand.x + fan.ox, targetX, t), lerp(stand.y, targetY, t));
        } else if (e < RUN_MS + BOUNCE_MS) {
          const t = (e - RUN_MS) / BOUNCE_MS;
          fan.c.alpha = 1;
          const hop = Math.abs(Math.sin(t * Math.PI * 3 + fan.delay)) * TILE_H * 0.4 * scale;
          fan.c.position.set(targetX, targetY - hop);
        } else if (e < RUN_MS + BOUNCE_MS + EXIT_MS) {
          const t = (e - RUN_MS - BOUNCE_MS) / EXIT_MS;
          fan.c.position.set(lerp(targetX, stand.x + fan.ox, t), lerp(targetY, stand.y, t));
          fan.c.alpha = 1 - t;
        } else {
          fan.c.alpha = 0;
        }
      }
    };
    cleanup = this.registerEffectTicker(app, tick, fans.map((fan) => fan.c));
  }

  /** A lumpy grey stone, drawn procedurally (no asset). Origin-centred. */
  private buildRock(): Graphics {
    const r = TILE_W * 0.2;
    const g = new Graphics();
    const sides = 7;
    const pts: number[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const rr = r * (0.78 + 0.32 * ((i * 5) % 3) / 3);
      pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.poly(pts).fill({ color: 0x7a736b }).stroke({ color: 0x322e29, width: 1.5 });
    g.poly([-r * 0.35, -r * 0.25, r * 0.05, -r * 0.45, r * 0.2, r * 0.02]).fill({ color: 0x968d82, alpha: 0.75 }); // lit facet
    g.circle(r * 0.28, r * 0.22, r * 0.14).fill({ color: 0x50483f, alpha: 0.6 }); // pit
    return g;
  }

  /**
   * Owner 2026-07-04: THROW A ROCK (kickoff event / Throw-a-Rock prayer) — a rock
   * hurled from the crowd arcs in over the NEAREST sideline, tumbling, and STRIKES
   * the target player's square with a dust puff + impact flash. The injury
   * animation follows after the store receives the impact callback and holds the
   * shared impact beat.
   * Play-mode/live flourish only — the state change (knockdown/injury) rides the wire.
   */
  playRockThrow(square: [number, number], onImpact?: () => void, miss = false): void {
    if (!this.app || !isOnPitch(square)) return;
    const [px, py] = square;
    const scale = depthScale(px, py);
    const target = squareAnchor(px, py);
    // nearest sideline → the rock comes from that edge's crowd
    const dLeft = px, dRight = PITCH_COLS - 1 - px, dTop = py, dBottom = PITCH_ROWS - 1 - py;
    const nearest = Math.min(dLeft, dRight, dTop, dBottom);
    const edge =
      nearest === dTop ? squareAnchor(px, -3)
      : nearest === dBottom ? squareAnchor(px, PITCH_ROWS + 2)
      : nearest === dLeft ? squareAnchor(-3, py)
      : squareAnchor(PITCH_COLS + 2, py);
    // Owner 2026-07-06: surface the rock FROM a real spectator on that side's crowd
    // (a different fan each throw), falling back to the bare edge point.
    const from = this.pickCrowdNear(edge) ?? edge;
    const rock = this.buildRock();
    rock.position.set(from.x, from.y);
    rock.scale.set(scale);
    rock.zIndex = 100000; // above everything
    this.effectsLayer.addChild(rock);
    const FLY_MS = PIPELINE_TIMINGS.rockThrow.flightMs;
    const ARC = TILE_H * 2.4 * scale;
    const t0 = performance.now();
    let struck = false;
    const app = this.app;
    let cleanup: () => void = () => {};
    const tick = () => {
      const e = performance.now() - t0;
      if (e >= FLY_MS + presentationMs(60) || this.app !== app || rock.destroyed) { cleanup(); return; }
      const t = Math.min(1, e / FLY_MS);
      rock.position.x = from.x + (target.x - from.x) * t;
      rock.position.y = from.y + (target.y - from.y) * t - Math.sin(t * Math.PI) * ARC; // lob
      rock.rotation = t * Math.PI * 6; // tumbling
      rock.scale.set(scale * (1 + 0.35 * Math.sin(t * Math.PI))); // bigger at apex, back to size on land
      if (t >= 1 && !struck) {
        struck = true;
        if (miss) {
          const label = new Text({
            text: 'MISS',
            style: new TextStyle({
              fontFamily: 'Arial Black, sans-serif', fontSize: 18, fontWeight: '900', fill: 0xff3838,
              stroke: { color: 0x250000, width: 4, join: 'round' },
              dropShadow: { color: 0x000000, alpha: 0.8, blur: 2, distance: 2 },
            }),
          });
          label.anchor.set(0.5, 1);
          label.position.set(target.x, target.y - TILE_H * 0.32 * scale);
          label.scale.set(scale);
          label.zIndex = 100001;
          this.effectsLayer.addChild(label);
          this.scheduleTimer(() => { if (!label.destroyed) label.destroy(); }, presentationMs(1000));
        } else {
          this.spawnSmokePuff(target.x, target.y, scale); // impact dust
          const ring = new Graphics()
            .ellipse(0, -3, TILE_W * 0.4, TILE_H * 0.3)
            .stroke({ color: 0xffffff, width: 4, alpha: 0.95 });
          ring.position.set(target.x, target.y);
          this.effectsLayer.addChild(ring);
          this.flashRings.push({ g: ring, x: target.x, y: target.y, scale, start: performance.now() });
        }
        if (!this.destroyed) onImpact?.();
      }
    };
    cleanup = this.registerEffectTicker(app, tick, [rock]);
  }

  /** A single angry spectator for the crowd-surf cinematic — a real crowd sprite
   *  when the stadium pack is loaded, else a small drawn figure with a raised fist. */
  private buildFan(): Container {
    const c = new Container();
    if (this.crowdTextures.length > 0) {
      const tex = this.crowdTextures[Math.floor(Math.random() * this.crowdTextures.length)]!;
      const s = new Sprite(tex);
      s.anchor.set(0.5, 0.9);
      s.width = TILE_W * 0.6;
      s.height = TILE_W * 0.6;
      c.addChild(s);
      return c;
    }
    const g = new Graphics();
    g.roundRect(-5, -16, 10, 16, 3).fill({ color: 0x7a5a3a }).stroke({ color: 0x2a2a2a, width: 1 }); // body
    g.circle(0, -20, 4).fill({ color: 0xe8c9a0 }).stroke({ color: 0x2a2a2a, width: 1 }); // head
    g.circle(6, -14, 2.4).fill({ color: 0xe8c9a0 }).stroke({ color: 0x2a2a2a, width: 1 }); // raised fist
    c.addChild(g);
    return c;
  }

  // --- Crowd reactions (owner 2026-07-06): QUIPS (FF speech bubbles) fire from a
  //     fan on a TEAM's SIDE stand (team-attached); the skull-dice cheer likewise;
  //     "I ♥ name" SIGNS ride sign-holders on the END stands. All world-space
  //     (effectsLayer) so they track the camera; auto-expire; flushed by
  //     clearEffects on a game change. -----------------------------------------

  /** A random fan on a given SIDE's stand (home/away sideline), preferring the more
   *  visible front rows. Quips are team-attached — a home-side fan heckles when the
   *  AWAY team suffers, and vice-versa. Falls back to any fan if that stand is empty. */
  private randomFanOn(side: 'home' | 'away' | 'end' | 'any'): { x: number; y: number } | null {
    if (this.crowdMembers.length === 0) return null;
    let pool = side === 'any' ? this.crowdMembers : this.crowdMembers.filter((f) => f.stand === side);
    if (pool.length === 0) pool = this.crowdMembers;
    const sorted = [...pool].sort((a, b) => b.h - a.h); // largest = front = most visible
    const front = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.5)));
    return front[Math.floor(Math.random() * front.length)] ?? null;
  }

  /** A random fan among the few nearest a point (so a thrown rock comes from the
   *  correct side's crowd, but a different spectator each time). */
  private pickCrowdNear(pt: { x: number; y: number }): { x: number; y: number } | null {
    if (this.crowdMembers.length === 0) return null;
    const near = [...this.crowdMembers]
      .sort((a, b) => (a.x - pt.x) ** 2 + (a.y - pt.y) ** 2 - ((b.x - pt.x) ** 2 + (b.y - pt.y) ** 2))
      .slice(0, 6);
    return near[Math.floor(Math.random() * near.length)] ?? null;
  }

  /** Pop-in → hold → fade-out lifecycle for a crowd overlay in world space. */
  private spawnCrowdOverlay(node: Container, atX: number, atY: number, holdMs: number): void {
    if (!this.app) return;
    node.position.set(atX, atY);
    node.alpha = 0;
    node.scale.set(0.4);
    this.effectsLayer.addChild(node);
    const t0 = performance.now();
    const POP = presentationMs(220), FADE = presentationMs(360), HOLD = presentationMs(holdMs);
    const ease = (p: number) => 1 - (1 - p) * (1 - p);
    const app = this.app;
    let cleanup: () => void = () => {};
    const tick = () => {
      if (node.destroyed || this.app !== app) { cleanup(); return; }
      const e = performance.now() - t0;
      if (e < POP) { const p = ease(e / POP); node.alpha = p; node.scale.set(0.4 + 0.6 * p); node.position.y = atY - 6 * p; }
      else if (e < HOLD) { node.alpha = 1; node.scale.set(1); node.position.y = atY - 6; }
      else if (e < HOLD + FADE) { const p = (e - HOLD) / FADE; node.alpha = 1 - p; node.position.y = atY - 6 - 10 * p; }
      else cleanup();
    };
    cleanup = this.registerEffectTicker(app, tick, [node]);
  }

  /** A FINAL-FANTASY window speech bubble: light frame, dark navy fill, top sheen,
   *  downward tail — holding either text or a child node. */
  private buildFFBubble(inner: Container, padX: number, padY: number): Container {
    const c = new Container();
    const iw = inner.width, ih = inner.height;
    const w = iw + padX * 2, h = ih + padY * 2, r = 7;
    const g = new Graphics();
    g.roundRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, r + 2).fill({ color: 0xdfe7ff }); // outer light frame
    g.roundRect(-w / 2, -h / 2, w, h, r).fill({ color: 0x142a5c }).stroke({ color: 0x3a5aa0, width: 1 }); // navy window
    g.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, (h - 4) * 0.42, r * 0.7).fill({ color: 0x24468a, alpha: 0.65 }); // top sheen
    g.poly([-8, h / 2 + 2, 8, h / 2 + 2, 0, h / 2 + 12]).fill({ color: 0xdfe7ff }); // tail frame
    g.poly([-6, h / 2, 6, h / 2, 0, h / 2 + 9]).fill({ color: 0x142a5c }); // tail fill
    c.addChild(g, inner);
    return c;
  }

  /** Crowd QUIP: a spectator on `side`'s stand shouts a short line in an FF speech
   *  bubble. Team-attached — pass the side whose fans would cheer (see SpectateView). */
  crowdQuip(text: string, side: 'home' | 'away' | 'any' = 'any'): void {
    const fan = this.randomFanOn(side);
    if (!fan) return;
    const label = new Text({ text, style: CROWD_SIGN_STYLE });
    label.anchor.set(0.5);
    this.spawnCrowdOverlay(this.buildFFBubble(label, 10, 6), fan.x, fan.y - 22, 2400);
  }

  /** Crowd SKULL-DICE cheer: the attacker-down skull in an FF bubble (a death). */
  crowdSkullQuip(side: 'home' | 'away' | 'any' = 'any'): void {
    const fan = this.randomFanOn(side);
    if (!fan) return;
    let inner: Container;
    const skull = this.blockFaceTextures[0];
    if (skull) {
      const s = new Sprite(skull);
      s.anchor.set(0.5);
      s.width = s.height = 30;
      this.blockFaceStaticSprites.add(s);
      inner = s;
    }
    else { const t = new Text({ text: '💀', style: CROWD_SIGN_STYLE }); t.anchor.set(0.5); inner = t; }
    this.spawnCrowdOverlay(this.buildFFBubble(inner, 8, 7), fan.x, fan.y - 22, 2600);
  }

  /** Owner 2026-07-08: assign the "I ♥ name" shout-outs to the sign-holders at game
   *  start — each placard proclaims its name PERSISTENTLY (rendered during pre-game
   *  and held through the game). Fed from the store (givethanks.csv). */
  setPregameSigns(names: string[]): void {
    this.pregameSignNames = names.slice();
    this.renderPregameSigns();
  }

  /** (Re)draw the persistent name on every sign-holder placard. Called on
   *  setPregameSigns AND after drawStadium rebuilds the slots (turf/orientation). */
  private renderPregameSigns(): void {
    for (const n of this.signTextNodes) { n.parent?.removeChild(n); n.destroy({ children: true }); }
    this.signTextNodes = [];
    if (!this.app || this.signFanSlots.length === 0 || this.pregameSignNames.length === 0) return;
    this.signFanSlots.forEach((slot, i) => {
      const name = this.pregameSignNames[i % this.pregameSignNames.length];
      if (!name) return;
      // Two lines in a terminal font: "I ❤️" over the sized-to-fit name.
      const top = new Text({ text: 'I ❤️', style: SIGN_TERMINAL_STYLE });
      top.anchor.set(0.5);
      const bottom = new Text({ text: name, style: SIGN_TERMINAL_STYLE });
      bottom.anchor.set(0.5);
      const topFit = Math.min((slot.signW * 0.6) / top.width, (slot.signH * 0.42) / top.height, 1.2);
      const nameFit = Math.min((slot.signW * 0.9) / bottom.width, (slot.signH * 0.42) / bottom.height, 1.5);
      top.scale.set(topFit);
      bottom.scale.set(nameFit);
      top.position.set(0, -slot.signH * 0.2);
      bottom.position.set(0, slot.signH * 0.2);
      const node = new Container();
      node.addChild(top, bottom);
      node.position.set(slot.signCX, slot.signCY);
      this.effectsLayer.addChild(node);
      this.signTextNodes.push(node);
    });
  }

  /** Supplied D6 art, with a vector fallback while assets load. */
  private buildD6(value: number, cause?: string): Container {
    const c = new Container();
    const S = 28; // die size
    const r = S * 0.18;
    const texture = this.d6FaceTextures[value - 1];
    if (texture) {
      const face = new Sprite(texture);
      face.anchor.set(0.5);
      // The original black files carry a wide transparent border; brushed metal is canvas-filling.
      const visualScale = d6FaceVisualScale(this.d6FaceVariant);
      face.width = S * visualScale;
      face.height = S * visualScale;
      c.addChild(face);
    } else {
      const body = new Graphics()
        .roundRect(-S / 2, -S / 2, S, S, r)
        .fill({ color: 0xf4f1e8 })
        .stroke({ color: 0x1a1a1a, width: 2 });
      body.roundRect(-S / 2 + 2, -S / 2 + 2, S - 4, (S - 4) * 0.42, r * 0.8).fill({ color: 0xffffff, alpha: 0.35 });
      c.addChild(body);
      const o = S * 0.26;
      const pips: Record<number, [number, number][]> = {
        1: [[0, 0]],
        2: [[-o, -o], [o, o]],
        3: [[-o, -o], [0, 0], [o, o]],
        4: [[-o, -o], [o, -o], [-o, o], [o, o]],
        5: [[-o, -o], [o, -o], [0, 0], [-o, o], [o, o]],
        6: [[-o, -o], [o, -o], [-o, 0], [o, 0], [-o, o], [o, o]],
      };
      const dots = new Graphics();
      for (const [px, py] of pips[value] ?? []) dots.circle(px, py, S * 0.09).fill({ color: 0x1a1a1a });
      c.addChild(dots);
    }
    // Owner 2026-07-04: the ROLL-CAUSE tag (dodge D, pickup ball, reroll ↻…).
    // Drawn AFTER the pips so its opaque badge occludes any pip it overlaps
    // ("no pip renders there"). Placement per settings; 'off' hides it.
    if (cause && this.dieTagPosition !== 'off') {
      const tag = this.buildDieCauseTag(cause, S);
      // Owner 2026-07-05: nudged further RIGHT (was S*0.5) so the badge clears the
      // top-right pip instead of sitting on it.
      if (this.dieTagPosition === 'corner') tag.position.set(S * 0.72, -S * 0.5); // top-right, clear of the pip
      else if (this.dieTagPosition === 'top') tag.position.set(0, -S / 2);
      else if (this.dieTagPosition === 'side') tag.position.set(S / 2 + S * 0.22, 0);
      else tag.position.set(0, S / 2); // bottom: half-on/half-off the die
      c.addChild(tag);
    }
    return c;
  }

  /** Owner 2026-07-04: a small round badge naming what CAUSED the die roll —
   *  a stylized D for dodges, a football for pickups, a ↻ for re-rolls, etc.
   *  Smaller than the die but readable; sits half-on/half-off the die edge. */
  private buildDieCauseTag(cause: string, S: number): Container {
    const c = new Container();
    const tracked = this.trackLiveSkillAsset(c, () => {
      for (const child of c.removeChildren()) child.destroy({ children: true });
      this.drawDieCauseTag(c, cause, S);
    });
    // The bundled, detail-heavy action glyphs otherwise inherit the pitch zoom and become illegible at
    // the wide view. Enrol the complete cause tag (disc + installed/bundled/fallback art) in the exact same
    // 1×..2× inverse-zoom policy as player skill icons. The parent action die, pips, FAILED/needed readout,
    // and reroll label deliberately keep their existing geometry.
    if (cause === 'gfi' || cause === 'pickup' || cause === 'dodge' || cause === 'pass' || cause === 'catch') { // owner 09-08: + catch
      this.overlayScaleGroups.push(c);
      c.scale.set(this.overlayZoomFactor());
    }
    return tracked;
  }

  private drawDieCauseTag(c: Container, cause: string, S: number): Container {
    const R = S * 0.32; // readable, clearly smaller than the die
    // Owner 2026-07-04: reuse the EXISTING skill-icon art where the cause maps to
    // a skill/cause target we have an icon for (pickup→PickUp, catch→Catch,
    // gaze→Hypnotic Gaze, …), on a neutral dark disc. Installed packs may
    // override GFI/PickUp only by explicitly providing those canonical targets.
    // Dodge and Pass are deliberately not DIE_CAUSE_SKILL entries: rolls keep bundled
    // cause badges, while buildRerollLabel('Dodge') and buildRerollLabel('Pass') resolve active pack icons.
    const traitSkill = cause.startsWith('trait:') ? cause.slice('trait:'.length) : undefined;
    const skillName = traitSkill || DIE_CAUSE_SKILL[cause];
    const bundledCauseIcon = cause === 'gfi'
      ? this.gfiDieTagTexture ?? undefined
      : cause === 'pickup'
        ? this.pickupDieTagTexture ?? undefined
        : cause === 'dodge'
          ? this.dodgeDieTagTexture ?? undefined
          : cause === 'pass'
            ? this.passDieTagTexture ?? undefined
            : cause === 'catch'
              ? this.catchDieTagTexture ?? undefined
              : undefined;
    // Owner 09-05: a re-roll cause wears the TRR (team re-roll) token icon instead of the old ↻ arrow glyph.
    const rerollIcon = cause === 'reroll' ? this.tokenRerollIcon ?? undefined : undefined;
    const icon = rerollIcon ?? (skillName
      ? skillIcon(skillName, this.skillIconStyle) ?? bundledCauseIcon
      : bundledCauseIcon);
    if (icon) {
      c.addChild(
        new Graphics()
          .circle(0, 0, R)
          .fill({ color: 0x14161a })
          .circle(0, 0, R)
          .stroke({ color: 0xffffff, width: 1.4 }),
      );
      const s = new Sprite(icon);
      s.anchor.set(0.5, 0.5);
      // PICK UP, DODGE, and PASS carry fine lettering and silhouette detail that disappeared at
      // the former generic badge footprint even after inverse-zoom scaling.
      // Give that canonical target a larger intrinsic face while leaving the
      // shared tag disc, GFI sizing, override precedence, and fallbacks alone.
      const iconScale = cause === 'pickup' || cause === 'dodge' || cause === 'pass' || cause === 'catch' ? 2.15 : 1.7;
      s.width = R * iconScale;
      s.height = R * iconScale;
      c.addChild(s);
      return c;
    }
    const [color, glyph] = DIE_CAUSE_TAG[traitSkill ? 'trait' : cause] ?? [0x777777, '?'];
    if (cause === 'breakTackle' || cause === 'timmber') {
      const t = new Text({ text: glyph, style: DIE_TAG_STYLE });
      const width = t.width + S * 0.28;
      const height = Math.max(t.height + S * 0.1, S * 0.42);
      c.addChild(
        new Graphics()
          .roundRect(-width / 2, -height / 2, width, height, height / 2)
          .fill({ color, alpha: 0.97 })
          .roundRect(-width / 2, -height / 2, width, height, height / 2)
          .stroke({ color: 0xffffff, width: 1.4 }),
      );
      t.anchor.set(0.5, 0.5);
      t.position.set(0, -height * 0.04);
      c.addChild(t);
      return c;
    }
    if (cause === 'dodge') {
      // Last-resort yellow D if the bundled DODGE asset cannot load.
      c.addChild(
        new Graphics()
          .circle(0, 0, R)
          .fill({ color })
          .circle(0, 0, R)
          .stroke({ color: 0x14161a, width: 1.6 }),
      );
      const t = new Text({ text: 'D', style: DIE_TAG_STYLE_DARK });
      t.anchor.set(0.5, 0.5);
      t.position.set(0, -R * 0.06);
      c.addChild(t);
      return c;
    }
    c.addChild(
      new Graphics()
        .circle(0, 0, R)
        .fill({ color: 0x14161a })
        .circle(0, 0, R)
        .fill({ color, alpha: 0.95 })
        .circle(0, 0, R)
        .stroke({ color: 0xffffff, width: 1.4 }),
    );
    if (cause === 'pickup') {
      // Last-resort football fallback if neither an explicit pack target nor the bundled icon loaded.
      const ball = new Graphics()
        .ellipse(0, 0, R * 0.66, R * 0.44)
        .fill({ color: 0x8a4a1e })
        .stroke({ color: 0xffffff, width: 1.2 });
      ball.moveTo(-R * 0.3, 0).lineTo(R * 0.3, 0).stroke({ color: 0xffffff, width: 1.2 });
      for (let i = -1; i <= 1; i++) ball.moveTo(i * R * 0.16, -R * 0.13).lineTo(i * R * 0.16, R * 0.13).stroke({ color: 0xffffff, width: 0.9 });
      c.addChild(ball);
    } else {
      const t = new Text({ text: glyph, style: DIE_TAG_STYLE });
      t.anchor.set(0.5, 0.5);
      t.position.set(0, cause === 'gaze' ? -R * 0.05 : -R * 0.08);
      c.addChild(t);
    }
    return c;
  }

  /**
   * B7-5 (owner): faded team logos at the "sweet spots" — 6 squares from the
   * end zone and 6 from the LOS in the centre column: home (6,7), away (19,7)
   * on the 26×15 pitch. Rendered under players (sweetSpotLayer sits below the
   * token layer). URLs must already be proxied by the caller (fumbblAsset).
   */
  async setSweetSpotLogos(homeUrl: string | null, awayUrl: string | null): Promise<void> {
    this.lastSweetSpotUrls = { home: homeUrl, away: awayUrl }; // B8-8: remember for re-place on toggle
    const app = this.app;
    const initGeneration = this.initGeneration;
    const requestGeneration = ++this.sweetSpotLogoRequestGeneration;
    if (!app || this.destroyed) return;
    const requestActive = () => !this.destroyed
      && this.app === app
      && this.initGeneration === initGeneration
      && this.sweetSpotLogoRequestGeneration === requestGeneration;
    const load = async (url: string | null): Promise<Texture | null> => {
      if (!url || !this.showFieldLogos) return null;
      try { return await Assets.load<Texture>({ src: url, parser: 'loadTextures' }); }
      catch { return null; }
    };
    const [homeTexture, awayTexture] = await Promise.all([load(homeUrl), load(awayUrl)]);
    if (!requestActive()) return;
    for (const child of this.sweetSpotLayer.removeChildren()) child.destroy();
    const place = (texture: Texture | null, sx: number, sy: number, away: boolean) => {
      const anchor = squareAnchor(sx, sy);
      // B8-6/B9-4: the faded logo goes down FIRST so the crosshair sits on top.
      // Accessibility (owner 2026-07-03 r4): the on-field logo + the sweet-spot
      // crosshair are independently togglable.
      if (texture && this.showFieldLogos) {
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5, 0.5);
        const target = TILE_W * 2.6;
        sprite.scale.set(target / Math.max(texture.width, texture.height));
        sprite.position.set(anchor.x, anchor.y - 3);
        sprite.alpha = 0.35; // B9-4: 0.26 -> 0.41; owner 09-05: -15% -> 0.35, faded into the turf
        // B8-6: the away logo sits on the north end zone (upside-down from the
        // home-camera perspective) — rotate it 180° to match its side.
        if (away) sprite.rotation = Math.PI;
        this.sweetSpotLayer.addChild(sprite);
      }
      // B8-4/B9-4: crosshair mark ON TOP of the logo at 90% opacity (drawn even
      // when the logo is missing, so the spot is always visible to the owner).
      if (!this.showSweetSpot) return;
      const r = TILE_W * 0.5;
      const cross = new Graphics();
      cross
        .moveTo(anchor.x - r, anchor.y)
        .lineTo(anchor.x + r, anchor.y)
        .moveTo(anchor.x, anchor.y - r)
        .lineTo(anchor.x, anchor.y + r)
        .stroke({ color: 0xffffff, width: 1.4, alpha: 0.9 })
        .circle(anchor.x, anchor.y, r * 0.5)
        .stroke({ color: 0xffffff, width: 1.2, alpha: 0.85 });
      this.sweetSpotLayer.addChild(cross);
    };
    place(homeTexture, 6, 7, false);
    place(awayTexture, 19, 7, true);
  }

  /** Replaces the auto-marking texts (UI-6) and re-renders players. */
  setPlayerMarkings(markings: Map<string, string>): void {
    if (equalStringMap(this.playerMarkings, markings)) return;
    // Snapshot caller-owned maps so an in-place mutation remains observable on
    // the next call and cannot alter renderer state without invalidation.
    this.playerMarkings = new Map(markings);
    this.queueProjectionRefresh();
  }

  /** Shared Modern/Classic appearance control for on-token skill markings. */
  setSkillMarkingStyle(options: { fontFamily: string; fontSize: number; color: number }): void {
    this.skillMarkingFontFamily = options.fontFamily || DEFAULT_MARKING_STYLE.fontFamily;
    this.skillMarkingFontSize = Math.min(24, Math.max(6, Math.round(options.fontSize)));
    this.skillMarkingColor = Number.isFinite(options.color) ? options.color : DEFAULT_MARKING_STYLE.color;
    this.refresh();
  }

  /** Per-skill-config icon lists (owner 2026-07-03 r6f). Pass null to fall back to
   *  the legacy baseline filter; a map makes addSkillBadges draw exactly the given
   *  per-player skills. Re-renders players. */
  setPlayerIconSkills(iconSkills: Map<string, string[]> | null): void {
    if (equalStringArrayMap(this.playerIconSkills, iconSkills)) return;
    this.playerIconSkills = iconSkills === null
      ? null
      : new Map(Array.from(iconSkills, ([playerId, skills]) => [playerId, [...skills]]));
    this.queueProjectionRefresh();
  }

  /** Switch the skill-badge icon set (BB3 ↔ BB2) and re-render players. */
  setSkillIconStyle(style: SkillIconStyle): void {
    if (this.skillIconStyle === style) return;
    this.skillIconStyle = style;
    this.refresh();
  }

  /** Owner 09-09: switch the BUNDLED badge family ('default' flat badges | 'illustrated') and re-render players once
   *  the family's textures are in. No-op when already active. Installed-pack targets keep precedence. */
  async setBundledSkillBadgeFamily(family: BundledSkillBadgeFamily): Promise<void> {
    if (await setBundledSkillBadgeFamily(family)) this.refresh();
  }

  /** Re-measures the host (layout changes don't fire window resize) and refits. */
  resize(): void {
    this.app?.resize();
    this.drawBackdrop(); // B2-11: screen-space, re-fit to the new viewport
    this.resetCamera();
  }

  /** B8-8/B9-V3: zIndex depth key — the square's near-depth boundary screen Y
   *  (nearer = larger). Delegates to the orientation-native geometry. */
  private depthZ(x: number, y = 0): number {
    return depthZKey(x, y);
  }

  /** Texture matrix for a square tile in the active orientation's native quad. */
  private tileTexMatrix(x: number, y: number, texW: number, texH: number): Matrix {
    const q = squareQuad(x, y);
    const width = q.points[1]![0] - q.points[0]![0];
    const height = q.yBottom - q.yTop;
    // #69: map the quad edges to the outer texel centres so filtering cannot wrap across the texture.
    const sx = width / (texW > 1 ? texW - 1 : 1);
    const sy = height / (texH > 1 ? texH - 1 : 1);
    const tx = q.points[3]![0] - (texW > 1 ? 0.5 * sx : 0);
    const ty = q.yTop - (texH > 1 ? 0.5 * sy : 0);
    return new Matrix(sx, 0, 0, sy, tx, ty);
  }

  /** Warp a full top-down pitch photo across the perspective playable area
   *  (owner 2026-07-03 r2). One mesh with a (COLS+1)×(ROWS+1) vertex grid whose
   *  (i,j) vertex sits at the projected game corner extPoint(i,j) and samples UV
   *  (i/COLS, j/ROWS) — so the image bends with the pitch and fits its boundary
   *  exactly, in either orientation. */
  private buildPitchMesh(texture: Texture): Mesh {
    const cols = PITCH_COLS;
    const rows = PITCH_ROWS;
    const stride = cols + 1;
    const count = stride * (rows + 1);
    const positions = new Float32Array(count * 2);
    const uvs = new Float32Array(count * 2);
    let v = 0;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const p = extPoint(i, j);
        positions[v * 2] = p.x;
        positions[v * 2 + 1] = p.y;
        uvs[v * 2] = i / cols;
        uvs[v * 2 + 1] = j / rows;
        v++;
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * stride + i;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    const geometry = new MeshGeometry({ positions, uvs, indices: new Uint32Array(indices) });
    const mesh = new Mesh({ geometry, texture });
    mesh.zIndex = -1; // under the grid lines drawn in the same layer
    return mesh;
  }

  /** B8-8 (owner): switch the pitch between N-S and E-W orientation. */
  setPitchOrientation(o: Orientation): void {
    if (getOrientation() === o) return;
    setOrientation(o);
    if (!this.app) return;
    this.drawStadium();
    this.drawPitch();
    this.redrawSetupZones();
    this.refresh();
    // sweet-spot logos + crosshairs are positioned via squareAnchor, so they go
    // stale on a toggle — re-place them at the new orientation (B8-8)
    void this.setSweetSpotLogos(this.lastSweetSpotUrls.home, this.lastSweetSpotUrls.away);
    this.resetCamera();
    refreshWalkerFacing(this.walkerOwnerId, this.facingGeometry());
  }

  /** Owner 2026-07-04f: toggle the FLAT (non-isometric) projection — far=1 (no
   *  perspective taper) + the off-centre token nudge is dropped (see tokenPos). */
  setFlatMode(flat: boolean): void {
    if (isFlat() === flat) return;
    setFlat(flat);
    if (!this.app) return;
    this.drawStadium();
    this.drawPitch();
    this.redrawSetupZones();
    this.refresh();
    void this.setSweetSpotLogos(this.lastSweetSpotUrls.home, this.lastSweetSpotUrls.away);
    this.resetCamera();
    refreshWalkerFacing(this.walkerOwnerId, this.facingGeometry());
  }

  /** Owner 09-09 ("option 3"): uniform figure scale + the softer N-S far edge; same redraw as a flat toggle. */
  setUniformFigures(on: boolean): void {
    setUniformFigures(on);
    if (!this.app) return;
    this.drawStadium();
    this.drawPitch();
    this.redrawSetupZones();
    this.refresh();
    void this.setSweetSpotLogos(this.lastSweetSpotUrls.home, this.lastSweetSpotUrls.away);
    this.resetCamera();
    refreshWalkerFacing(this.walkerOwnerId, this.facingGeometry());
  }

  /** Owner 2026-07-06: SPECTATOR drive-north side-swap. Mirrors the whole field
   *  180° so the driving team attacks the far (north) end. Gated on spectator mode
   *  by the caller — play mode NEVER flips (the active player stays Home/bottom).
   *  Same redraw path as the flat/orientation toggles. */
  setFieldFlipMode(flip: boolean): void {
    this.fieldFlipMode = flip;
    if (isFieldFlip() === flip) return;
    setFieldFlip(flip);
    if (!this.app) return;
    this.drawStadium();
    this.drawPitch();
    this.redrawSetupZones();
    this.refresh();
    void this.setSweetSpotLogos(this.lastSweetSpotUrls.home, this.lastSweetSpotUrls.away);
    this.resetCamera();
    refreshWalkerFacing(this.walkerOwnerId, this.facingGeometry());
  }

  private facingGeometry(): FacingGeometry {
    const home = squareAnchor(0, Math.floor(PITCH_ROWS / 2));
    const away = squareAnchor(PITCH_COLS - 1, Math.floor(PITCH_ROWS / 2));
    const dx = away.x - home.x;
    const dy = away.y - home.y;
    const length = Math.hypot(dx, dy) || 1;
    const homeForward = { dx: dx / length, dy: dy / length };
    return { homeForward, awayForward: { dx: -homeForward.dx, dy: -homeForward.dy } };
  }

  resetCamera(): void {
    if (!this.app) return;
    this.resetAutoDirectorCamera(true);
    const margin = 24;
    // B9-V2 (owner): two viewport factors. The dugouts flank the ACROSS (y)
    // axis, which is HORIZONTAL in N-S (adds to width) and VERTICAL in E-W (adds
    // to height). N-S fit reproduces the original pre-E-W behaviour exactly; E-W
    // has its own fit, and because the native E-W projection keeps tiles at the
    // same physical size the on-screen element sizing matches N-S.
    const ew = getOrientation() === 'ew';
    const dugoutW = 4 * TILE_W; // N-S: dugout span along the horizontal
    const dugoutH = 4 * TILE_H; // E-W: dugout span along the vertical
    // Classic (clampToPitchEdge): fit the PITCH only — drop the dugout margin so
    // the pitch fills the view and zoom-out can't reveal past its edge.
    const edge = this.clampToPitchEdge;
    const padW = edge ? 0 : ew ? 0 : 2 * dugoutW;
    const padH = edge ? 0 : ew ? 2 * dugoutH : 0;
    const offX = edge ? 0 : ew ? 0 : dugoutW;
    const offY = edge ? 0 : ew ? dugoutH : 0;
    const worldW = worldWidth() + padW;
    const worldH = worldHeight() + padH;
    const scale = this.quantizeZoom(Math.min((this.app.screen.width - margin) / worldW, (this.app.screen.height - margin) / worldH), 'floor');
    this.world.scale.set(scale);
    this.cameraFitScale = scale; // 100% reference for badge zoom scaling
    this.updateOverlayScales();
    this.world.position.set(
      (this.app.screen.width - worldW * scale) / 2 + offX * scale,
      (this.app.screen.height - worldH * scale) / 2 + offY * scale,
    );
    // Refresh the clamp bounds to the freshly-laid-out content (keep the last good
    // box if the content isn't drawn yet, e.g. resetCamera during init).
    this.contentBounds = this.readContentBounds() ?? this.contentBounds;
  }

  /** World-local bounds of everything rendered in `world` (pitch, dugouts, decor,
   *  tokens…) — the furthest rendered asset on each axis. The screen-space backdrop
   *  is a separate layer, so it doesn't inflate this. Null if nothing is drawn. */
  private readContentBounds(): { x: number; y: number; width: number; height: number } | null {
    try {
      const b = this.world.getLocalBounds() as unknown as { minX: number; minY: number; maxX: number; maxY: number };
      const width = b.maxX - b.minX;
      const height = b.maxY - b.minY;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
      return { x: b.minX, y: b.minY, width, height };
    } catch {
      return null;
    }
  }

  /** Owner 2026-07-08: with clampToPitch on, keep world.position so the camera
   *  can't be panned past the edge. Content smaller than the viewport (zoomed to
   *  fit) locks to centre on that axis; zoomed in, pan reaches the edge.
   *  X axis is bound to the pitch + DUGOUTS only (owner: no need to pan out to the
   *  furthest rendered asset — i.e. the crowd/stadium — on X); Y keeps the full
   *  rendered-content extent (`contentBounds`). */
  private clampCamera(): void {
    if (!this.app || !this.clampToPitch) return;
    const scale = this.world.scale.x;
    const clampAxis = (pos: number, bMin: number, bSize: number, screen: number, endExtension = 0): number => {
      const size = bSize * scale;
      if (size <= screen) {
        const centre = (screen - size) / 2 - bMin * scale;
        // Normally a fit-size axis locks to centre. Fullscreen's southern extension deliberately permits only
        // additional travel toward the far/end edge while retaining the existing centred reset position.
        return Math.min(centre, Math.max(centre - endExtension, pos));
      }
      const hi = -bMin * scale; // min edge pinned to the viewport start
      const lo = screen - (bMin + bSize) * scale - endExtension; // max edge + optional HUD clearance
      return Math.min(hi, Math.max(lo, pos));
    };
    const ew = getOrientation() === 'ew';
    // Classic (clampToPitchEdge): bind BOTH axes to the pitch rectangle itself.
    if (this.clampToPitchEdge) {
      this.world.position.x = clampAxis(this.world.position.x, 0, worldWidth(), this.app.screen.width);
      this.world.position.y = clampAxis(this.world.position.y, 0, worldHeight(), this.app.screen.height);
      return;
    }
    // X → pitch + dugout box (dugouts flank the horizontal in N-S). Excludes the crowd.
    // Pull both camera limits inward by one rendered column so a zoomed/panned
    // view stays inside the arena instead of riding its outermost edge.
    const dugoutW = 4 * TILE_W;
    const sideInset = TILE_W;
    const xMin = (ew ? 0 : -dugoutW) + sideInset;
    const xSize = worldWidth() + (ew ? 0 : 2 * dugoutW) - sideInset * 2;
    this.world.position.x = clampAxis(this.world.position.x, xMin, xSize, this.app.screen.width);
    // Y → full rendered-content extent.
    if (this.contentBounds) {
      this.world.position.y = clampAxis(
        this.world.position.y,
        this.contentBounds.y,
        this.contentBounds.height,
        this.app.screen.height,
        this.southernPanExtension,
      );
    }
  }

  /**
   * B2-11 (owner): backdrop rendered behind the stadium — a daylight-sky
   * gradient with soft cloud wisps and a distant forest silhouette,
   * screen-space so it stays put while the camera moves.
   */
  private drawBackdrop(): void {
    if (!this.app) return;
    for (const child of this.backdropLayer.removeChildren()) child.destroy({ children: true });
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    // Original fantasy-sports skybox, cover-fitted to the
    // viewport (fills the screen, preserves aspect, centered) behind the stadium.
    if (this.backdropTexture) {
      const tex = this.backdropTexture;
      const sprite = new Sprite(tex);
      const scale = Math.max(w / tex.width, h / tex.height);
      sprite.scale.set(scale);
      sprite.anchor.set(0.5);
      sprite.position.set(w / 2, h / 2);
      this.backdropLayer.addChild(sprite);
      return;
    }
    const g = new Graphics();
    // vertical gradient in bands (clear blue overhead → warm horizon haze)
    const bands = [0x4d9bd1, 0x68add8, 0x83bfe0, 0xa8d2e7, 0xd7e5d2];
    bands.forEach((color, i) => {
      g.rect(0, (h / bands.length) * i, w, h / bands.length + 1).fill(color);
    });
    // deterministic soft cloud wisps across the upper sky
    for (let i = 0; i < 36; i++) {
      const sx = turfNoise(i * 13 + 7, i * 29 + 3) * w;
      const sy = turfNoise(i * 17 + 11, i * 5 + 1) * h * 0.5;
      const size = 12 + turfNoise(i * 3, i * 7) * 38;
      g.ellipse(sx, sy, size * 1.8, size * 0.62)
        .fill({ color: 0xf7fbff, alpha: 0.12 + turfNoise(i, i * 2) * 0.2 });
    }
    // distant forest silhouette along the horizon band
    const horizon = h * 0.62;
    for (let x = 0; x < w; ) {
      const bw = 18 + turfNoise(x, 5) * 46;
      const bh = 12 + turfNoise(x, 11) * 46;
      const trunkW = Math.max(3, bw * 0.12);
      g.rect(x + bw / 2 - trunkW / 2, horizon - bh * 0.7, trunkW, bh * 0.7)
        .fill({ color: 0x090f13, alpha: 0.95 });
      g.circle(x + bw / 2, horizon - bh * 0.72, bw * 0.42)
        .fill({ color: 0x07120f, alpha: 0.95 });
      g.circle(x + bw * 0.32, horizon - bh * 0.57, bw * 0.28)
        .fill({ color: 0x091711, alpha: 0.9 });
      g.circle(x + bw * 0.7, horizon - bh * 0.55, bw * 0.3)
        .fill({ color: 0x091711, alpha: 0.9 });
      if (turfNoise(x, 23) > 0.55) {
        g.circle(x + bw * 0.55, horizon - bh * 0.35, 1.8)
          .fill({ color: 0xf4d77c, alpha: 0.55 });
      }
      x += bw + 2;
    }
    this.backdropLayer.addChild(g);
  }

  // --- stadium bowl (owner 2026-07-02, SoFi Stadium reference) ---

  /**
   * Stands wrap the pitch on all four sides in the same Madden projection:
   * seat-stand modules tile each extended-grid square (stairs land as
   * aisles), rows darken as they rise away from the field, spectators
   * sprinkle deterministically, and a cobblestone concourse rings the
   * field+dugout area. Geometry extends past the pitch by extrapolating the
   * linear boundary math.
   */
  /** Owner 09-05: load a stadium GLB pack (null = back to the procedural stands). Renders the model once, top-down,
   *  then redraws the stadium layer with the plan laid onto the pitch quad. */
  setStadiumPack(pack: { manifest: StadiumPackManifest; modelUrl: string } | null): void {
    const generation = ++this.stadiumModelGeneration;
    const prior = this.stadiumModel;
    this.stadiumModel = null;
    if (prior) { if (this.app) { this.drawStadium(); this.drawDugouts(); } prior.texture.destroy(true); } // 09-06: procedural dugouts return with the pack gone
    if (!pack) return;
    void renderStadiumPack(pack.manifest, pack.modelUrl).then((rendered) => {
      if (generation !== this.stadiumModelGeneration || this.destroyed) { rendered.texture.destroy(true); return; }
      this.stadiumModel = rendered;
      if (this.app) { this.drawStadium(); this.drawDugouts(); } // 09-06: a `dugouts.provided` pack takes over the dugout ground
    }).catch((error: unknown) => {
      console.warn(`Stadium pack ${pack.manifest.id} failed to render`, error);
    });
  }

  /** 09-06 (stadium-3d-dugouts handoff): true while a SUCCESSFULLY rendered pack whose manifest says
   *  `dugouts.provided` is actually on screen — the stadium toggle is on and the plan is what drawStadium draws.
   *  A requested-but-unrendered, failed or unloaded pack, or "No Stadium", all leave the procedural dugouts in. */
  private planDugoutsActive(): boolean {
    return this.stadiumEnabled && this.stadiumModel !== null && this.stadiumModel.dugoutsProvided;
  }

  /** The GLB plan on the pitch quad: the IMAGE's four corners (RenderedStadium.corners — each carried through the
   *  pack registration, so a north = +Z model lands south-edge-up) are projected through the pitch geometry
   *  (extPoint takes off-pitch and fractional square coordinates), perspective-correct. 09-06: the footprint's
   *  axis-aligned corners were used before, which laid a north = +Z model on the quad vertically mirrored. */
  private drawStadiumModel(model: RenderedStadium): void {
    // 09-06 (engine acceptance): the pitch projection is a per-row LINEAR taper (geometry.ts boundaryScaleD), not a
    // homography — a single 4-corner PerspectiveMesh reproduced the corners but bent everything in between (the
    // away dugout floor smeared into a diagonal band down the flank). So the plan rides the same construction as
    // the turf (buildPitchMesh): a one-square vertex grid over the image, every vertex at extPoint(u, v) of the
    // square coordinate it samples, walking the image's rows/columns between its registered corners.
    const c = model.corners;
    const cols = Math.max(1, Math.ceil(model.footprint.x1 - model.footprint.x0));
    const rows = Math.max(1, Math.ceil(model.footprint.y1 - model.footprint.y0));
    const stride = cols + 1;
    const count = stride * (rows + 1);
    const positions = new Float32Array(count * 2);
    const uvs = new Float32Array(count * 2);
    let n = 0;
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      for (let i = 0; i <= cols; i++) {
        const s = i / cols;
        // bilinear over the four registered image corners (an affine rect in square space, so exact)
        const u = c.tl.u + (c.tr.u - c.tl.u) * s + (c.bl.u - c.tl.u) * t;
        const v = c.tl.v + (c.tr.v - c.tl.v) * s + (c.bl.v - c.tl.v) * t;
        const p = extPoint(u, v);
        positions[n * 2] = p.x;
        positions[n * 2 + 1] = p.y;
        uvs[n * 2] = s;
        uvs[n * 2 + 1] = t;
        n++;
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * stride + i, b = a + 1, d = a + stride, e = d + 1;
        indices.push(a, b, d, b, e, d);
      }
    }
    const mesh = new Mesh({ geometry: new MeshGeometry({ positions, uvs, indices: new Uint32Array(indices) }), texture: model.texture });
    mesh.label = 'stadiumModel';
    this.stadiumLayer.addChild(mesh);
    this.crowdMembers = [];
  }

  /** Settings > UI "Stadium" toggle (owner 08-19): live set + redraw; camera refit keeps the pitch filling.
   *  09-06: "No Stadium" keeps its established meaning (the stone apron, no stands) — and with a plan pack
   *  hidden by it the procedural dugout ground returns, since the pack's 3D dugouts went with the plan. */
  setStadiumEnabled(on: boolean): void {
    if (this.stadiumEnabled === on) return;
    this.stadiumEnabled = on;
    if (!this.app) return;
    this.drawStadium();
    if (this.stadiumModel?.dugoutsProvided) this.drawDugouts();
    this.resetCamera();
  }

  private drawStadium(): void {
    for (const child of this.stadiumLayer.removeChildren()) child.destroy({ children: true });
    for (const child of this.dressingLayer.removeChildren()) child.destroy({ children: true });
    this.crowdMembers = [];
    this.signFanSlots = [];

    // B9-V3: the arena is built in the ACTIVE orientation's native frame via
    // per-corner projection (extPoint), so the stadium follows the pitch whether
    // the depth axis is x (N-S) or y (E-W).
    const cellCorners = (x: number, y: number) => [
      extPoint(x, y),
      extPoint(x, y + 1),
      extPoint(x + 1, y + 1),
      extPoint(x + 1, y),
    ];
    const cellPoly = (x: number, y: number): number[] => cellCorners(x, y).flatMap((p) => [p.x, p.y]);
    /** near (largest screen Y), far (smallest) and vertical extent of a cell. */
    const cellSpan = (corners: { x: number; y: number }[]) => {
      const ys = corners.map((p) => p.y);
      const xs = corners.map((p) => p.x);
      const yB = Math.max(...ys);
      const yT = Math.min(...ys);
      const xMin = Math.min(...xs);
      const xMax = Math.max(...xs);
      return { yB, yT, height: yB - yT, width: xMax - xMin, xMin };
    };

    const graphics = new Graphics();
    const crowd: { x: number; y: number; h: number; index: number; stand: 'home' | 'away' | 'end' }[] = [];

    // "No Stadium" removes stands, crowd, fencing and props—not the physical
    // pitch surround. Keep a compact stone apron so the field remains grounded
    // against the skybox instead of floating over the background.
    const drawStoneApron = () => {
      for (let x = -1; x <= 26; x++) {
        for (let y = -4; y <= 18; y++) {
          if (x >= 0 && x <= 25 && y >= 0 && y <= 14) continue;
          const corners = cellCorners(x, y);
          const { yT, height, xMin } = cellSpan(corners);
          const points = corners.flatMap((p) => [p.x, p.y]);
          if (this.stoneTexture) {
            const fit = height / this.stoneTexture.height;
            graphics.poly(points).fill({ texture: this.stoneTexture, matrix: new Matrix(fit, 0, 0, fit, xMin, yT) });
            graphics.poly(points).fill({ color: 0x0a0c10, alpha: 0.18 });
          } else {
            graphics.poly(points).fill({ color: 0x24272e, alpha: 1 });
          }
        }
      }
      this.stadiumLayer.addChild(graphics);
    };
    if (!this.stadiumEnabled) {
      drawStoneApron();
      return;
    }
    if (this.stadiumModel) {
      // owner 09-05: GLB plan replaces the procedural stands. 09-06 (engine acceptance): the fantasy-stadium pack has
      // no ground between the pitch/dugouts and its stands (transparent texels there), so the same stone apron sits
      // UNDER the plan — anything the model does draw covers it, and the field never floats over the skybox.
      drawStoneApron();
      this.drawStadiumModel(this.stadiumModel);
      return;
    }
    if (this.standTextures.size === 0) return;

    // Fan attendance (owner 2026-07-02): stand occupancy is proportional to
    // each team's Dedicated Fans — 7 fans fills that team's side completely.
    const fanDensity = (side: 'home' | 'away' | 'mixed'): number => {
      const fans = (team?: { dedicatedFans?: unknown }) => {
        const value = Number(team?.dedicatedFans);
        return Number.isFinite(value) && value > 0 ? value : 3;
      };
      const home = fans(this.game?.teamHome as { dedicatedFans?: unknown } | undefined);
      const away = fans(this.game?.teamAway as { dedicatedFans?: unknown } | undefined);
      const value = side === 'home' ? home : side === 'away' ? away : (home + away) / 2;
      return Math.min(1, value / 7);
    };

    // Stands are ELEVATED (owner 2026-07-02, queue item 8): each seating ring
    // rises above the one in front, so the bowl reads as higher than the
    // pitch. Cells draw back-to-front (highest ring first) so nearer rows
    // overlap the lifted bottoms of the rows behind; each cell also gets a
    // dark riser face under its front edge.
    const RING_RISE = 0.3; // vertical lift per ring, in cell heights
    const drawBand = (
      x0: number,
      x1: number,
      y0: number,
      y1: number,
      textureName: string,
      ringOf: (x: number, y: number) => number,
      density: number,
      stand: StadiumStandSide,
    ) => {
      const texture = this.standTextures.get(textureName);
      if (!texture) return;
      const cells: { x: number; y: number; ring: number }[] = [];
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) cells.push({ x, y, ring: ringOf(x, y) });
      }
      cells.sort((a, b) => b.ring - a.ring);
      for (const { x, y, ring } of cells) {
        const corners = cellCorners(x, y);
        const { yB, height } = cellSpan(corners);
        const lift = ring * height * RING_RISE;
        const raisedCorners = corners.map((p) => ({ x: p.x, y: p.y - lift })) as [
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
        ];
        const points = raisedCorners.flatMap((p) => [p.x, p.y]);
        // riser face: the vertical drop under this cell's FRONT edge (the two
        // corners nearest the camera = largest screen Y). Skipped on ring 0.
        if (ring > 0) {
          const front = [...corners].sort((a, b) => b.y - a.y).slice(0, 2);
          const drop = height * RING_RISE;
          graphics
            .poly([
              front[0]!.x, front[0]!.y - lift + drop,
              front[1]!.x, front[1]!.y - lift + drop,
              front[1]!.x, front[1]!.y - lift,
              front[0]!.x, front[0]!.y - lift,
            ])
            .fill({ color: 0x14161c });
        }
        // The stand PNG is a four-cell atlas (three seat modules plus an aisle),
        // not one icon to restart from pixel zero in every square. Select one
        // atlas cell per projected stadium square and advance it continuously
        // along the tier so the seats and stairs form a coherent tileset.
        const tileColumn = stadiumStandTileColumn(stand, x, y);
        const tile = stadiumStandTileTransform({
          stand,
          textureWidth: texture.width,
          textureHeight: texture.height,
          tileColumn,
          corners: raisedCorners,
        });
        graphics.poly(points).fill({
          texture,
          matrix: new Matrix(tile.a, tile.b, tile.c, tile.d, tile.translateX, tile.translateY),
        });
        graphics.poly(points).fill({ color: 0x0a0c10, alpha: Math.min(0.55, 0.12 + ring * 0.07) });
        const noise = turfNoise(x * 13 + y * 7 + 3, x * 5 - y * 11 + 1);
        if (noise < density && this.crowdTextures.length > 0) {
          crowd.push({
            x: (corners[0]!.x + corners[1]!.x) / 2,
            y: yB - lift - height * 0.08,
            h: height * 0.72,
            index: Math.floor(noise * 97) % this.crowdTextures.length,
            stand: stand === 'home' || stand === 'away' ? stand : 'end',
          });
        }
      }
    };

    // stone apron fills every surround square between pitch and stands
    // (owner 2026-07-02): dugouts overdraw their own cells on a layer above.
    // Owner 2026-07-03 ("black squares"): the apron previously stopped at
    // x -1..26 / y -4..18, so the cells between its edge and the stand bands
    // fell through to the black backdrop; and the 0.35 darkening read as black.
    // Cover the FULL stand footprint (the stands overdraw their own bands) and
    // lighten the shade so the concourse reads as stone.
    if (this.stoneTexture) {
      const stone = this.stoneTexture;
      for (let x = -7; x <= 32; x++) {
        for (let y = -10; y <= 24; y++) {
          if (x >= 0 && x <= 25 && y >= 0 && y <= 14) continue; // the pitch itself
          const corners = cellCorners(x, y);
          const { yT, height, xMin } = cellSpan(corners);
          const points = corners.flatMap((p) => [p.x, p.y]);
          const fit = height / stone.height;
          graphics.poly(points).fill({ texture: stone, matrix: new Matrix(fit, 0, 0, fit, xMin, yT) });
          graphics.poly(points).fill({ color: 0x0a0c10, alpha: 0.18 });
        }
      }
    }

    // B9-9 (owner): dark bowl-interior underfill behind the stands. The stand
    // rings are ELEVATED (lifted up by ring*RING_RISE), so at the seams between
    // rows and where the side/end bands meet at the corners the black backdrop
    // showed through. Fill each band's footprint — and a couple of extra rows so
    // the lifted rings still have backing above them — with a dark stadium
    // interior BEFORE the stands draw over it. Drawn tall (from the ground up
    // past the highest ring) so no lifted-row seam exposes the sky.
    const underfillBand = (x0: number, x1: number, y0: number, y1: number) => {
      const RISE = 6 * 0.3; // max ring (5) * RING_RISE, +margin, in cell heights
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const corners = cellCorners(x, y);
          const { height } = cellSpan(corners);
          const lift = height * RISE;
          // raise the FAR corners (smaller screen Y) so the fill extends up past
          // the highest lifted ring; near corners stay on the ground
          const sorted = [...corners].sort((a, b) => a.y - b.y);
          const raised = corners.map((p) => ({ x: p.x, y: p.y - (p === sorted[0] || p === sorted[1] ? lift : 0) }));
          graphics.poly(raised.flatMap((p) => [p.x, p.y])).fill({ color: 0x0a0c11 });
        }
      }
    };
    underfillBand(-1, 26, -10, -5); // home side (blue)
    underfillBand(-1, 26, 19, 24); // away side (red)
    underfillBand(-7, -2, -10, 24); // near end (yellow)
    underfillBand(27, 32, -10, 24); // far end (green)

    // Owner 2026-07-03 ("empty tiles on the south end"): the far-end underfill's
    // RAISED quads spill toward the pitch and paint the x=26 concourse row dark.
    // Repaint the visible concourse (the non-stand ring) with stone AFTER the
    // underfills so ground level always reads as stone; the stands still draw
    // over their own bands afterwards.
    if (this.stoneTexture) {
      const stone = this.stoneTexture;
      for (let x = -1; x <= 26; x++) {
        for (let y = -4; y <= 18; y++) {
          if (x >= 0 && x <= 25 && y >= 0 && y <= 14) continue; // the pitch itself
          const corners = cellCorners(x, y);
          const { yT, height, xMin } = cellSpan(corners);
          const points = corners.flatMap((p) => [p.x, p.y]);
          const fit = height / stone.height;
          graphics.poly(points).fill({ texture: stone, matrix: new Matrix(fit, 0, 0, fit, xMin, yT) });
          graphics.poly(points).fill({ color: 0x0a0c10, alpha: 0.18 });
        }
      }
    }

    // Owner 2026-07-04: the pitch-level (apron/concourse) fan sprinkle is REMOVED
    // to declutter the field edges — fans now live only in the tiered stands
    // (drawBand below). The former concourse sprinkle wandered the empty apron
    // cells at pitch level; that block is gone intentionally.

    // side stands one column off the dugouts (owner 2026-07-02): home blue,
    // away red; end stands wrap the corners (yellow near, green far).
    // B8-5: side bands run x=-1..26 (not 0..25) so the corner columns just off
    // each end line are covered — the stone apron only reaches y=-4..18, so
    // without this those two columns (x=-1, x=26) inside the stand y-bands fell
    // through to the black backdrop, leaving dark slivers at the pitch corners.
    drawBand(-1, 26, -10, -5, 'stand_blue', (_x, y) => -5 - y, fanDensity('home'), 'home');
    drawBand(-1, 26, 19, 24, 'stand_red', (_x, y) => y - 19, fanDensity('away'), 'away');
    drawBand(-7, -2, -10, 24, 'stand_yellow', (x) => -2 - x, fanDensity('mixed'), 'nearEnd');
    drawBand(27, 32, -10, 24, 'stand_green', (x) => x - 27, fanDensity('mixed'), 'farEnd');

    // B9-V3: the stadium graphics are built directly in the active orientation's
    // native frame (per-corner extPoint), so no post-transform is needed.
    this.stadiumLayer.addChild(graphics);
    for (const person of crowd) {
      const sprite = new Sprite(this.crowdTextures[person.index]);
      sprite.anchor.set(0.5, 1);
      const scale = person.h / sprite.texture.height;
      sprite.scale.set(scale);
      sprite.position.set(person.x, person.y); // already native; spectators stay upright
      this.stadiumLayer.addChild(sprite);
    }
    // Owner 2026-07-06: remember the fan positions (top of each sprite = head) +
    // which stand they sit in, so crowd quips (side-attached to a team) / signs (ends
    // only) / thrown rocks can surface FROM the right real spectator.
    this.crowdMembers = crowd.map((p) => ({ x: p.x, y: p.y - p.h, h: p.h, stand: p.stand }));

    // Owner 2026-07-06: seed SIGN-HOLDING fans into the END stands ONLY (behind the
    // end zones — owner: not the sidelines), biggest/most-visible cells first, and
    // record each blank placard's world rect so an "I ♥ name" shout-out (crowdSign)
    // can be written on one that is on-camera.
    this.signFanSlots = [];
    const endCrowd = crowd.filter((p) => p.stand === 'end');
    if (this.signFanTextures.length > 0 && endCrowd.length > 0) {
      const frontFirst = [...endCrowd].sort((a, b) => b.h - a.h); // largest = nearest = most visible
      const wanted = Math.min(4, frontFirst.length); // owner 2026-07-08: 4 sign-holders
      const step = Math.max(1, Math.floor(frontFirst.length / wanted));
      for (let i = 0, n = 0; i < frontFirst.length && n < wanted; i += step, n++) {
        const p = frontFirst[i]!;
        const tex = this.signFanTextures[n % this.signFanTextures.length]!;
        const Hs = p.h * 1.5; // a touch taller than the ambient crowd so the sign reads
        const scale = Hs / tex.height;
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5, 1);
        sprite.scale.set(scale);
        sprite.position.set(p.x, p.y);
        sprite.zIndex = 5; // over the baked crowd behind it
        this.stadiumLayer.addChild(sprite);
        const Ws = tex.width * scale;
        // sign box ≈ full width, top ~18% centre / ~30% tall of the sprite.
        this.signFanSlots.push({ signCX: p.x, signCY: p.y - Hs * 0.82, signW: Ws * 0.8, signH: Hs * 0.3 });
      }
    }
    // Owner 2026-07-08: (re)draw the persistent pre-game names on the new placards.
    this.renderPregameSigns();

    // B2-22 (owner): perimeter fencing between concourse and stands, with
    // gate openings at midfield (x 12–13) and behind each end zone
    const fence = new Graphics();
    const postEvery = 1;
    const drawSideFence = (yBoundary: number) => {
      const tops: [number, number][] = [];
      const bases: number[] = [];
      for (let x = 0; x <= 25; x += postEvery) {
        if (x >= 12 && x <= 13) {
          tops.push([NaN, NaN]);
          bases.push(NaN);
          continue;
        } // gate
        const base = extPoint(x, yBoundary);
        const height = TILE_H * depthScale(x, yBoundary) * 0.5;
        fence.moveTo(base.x, base.y).lineTo(base.x, base.y - height).stroke({ color: 0x4a4f5c, width: 2 });
        tops.push([base.x, base.y - height]);
        bases.push(base.y);
      }
      // top rail + mid rail connect post tops (skipping the gate gap)
      for (let i = 1; i < tops.length; i++) {
        const [x1, y1] = tops[i - 1]!;
        const [x2, y2] = tops[i]!;
        if (Number.isNaN(x1) || Number.isNaN(x2)) continue;
        fence.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: 0x5a6070, width: 1.4 });
        fence
          .moveTo(x1, (y1 + bases[i - 1]!) / 2)
          .lineTo(x2, (y2 + bases[i]!) / 2)
          .stroke({ color: 0x5a6070, width: 1.2 });
      }
    };
    drawSideFence(-4); // home side, between concourse and blue stand
    drawSideFence(19); // away side
    this.stadiumLayer.addChild(fence);

    // corner pennants at the four pitch corners, team-colored per the
    // end-color convention (blue south / red north). Arena dressing → OFF when
    // decor is disabled (FUMBBL Classic: owner 2026-07-08, no corner flags).
    if (this.decorEnabled) {
      const flagBlue = this.dressingTextures.get('corner_flag_blue');
      const flagRed = this.dressingTextures.get('corner_flag_red');
      // Owner 2026-07-06: the flags sat on an INNER corner of their corner square. Place
      // them on the actual OUTER FIELD corners via extPoint (the grid-boundary mapper the
      // dugout trim uses) — extPoint(0/COLS, 0/ROWS) are the four field corners. Blue =
      // the x=0 (home) end, red = the x=COLS (away) end.
      const corners: { point: { x: number; y: number }; texture: Texture | undefined; scale: number }[] = [
        { point: extPoint(0, 0), texture: flagBlue, scale: depthScale(0, 0) },
        { point: extPoint(0, PITCH_ROWS), texture: flagBlue, scale: depthScale(0, PITCH_ROWS - 1) },
        { point: extPoint(PITCH_COLS, 0), texture: flagRed, scale: depthScale(PITCH_COLS - 1, 0) },
        { point: extPoint(PITCH_COLS, PITCH_ROWS), texture: flagRed, scale: depthScale(PITCH_COLS - 1, PITCH_ROWS - 1) },
      ];
      for (const corner of corners) {
        if (!corner.texture) continue;
        const flag = new Sprite(corner.texture);
        flag.anchor.set(0.5, 1);
        flag.height = TILE_H * 1.1 * corner.scale;
        flag.scale.x = flag.scale.y;
        flag.position.set(corner.point.x, corner.point.y);
        this.dressingLayer.addChild(flag); // over the pitch surface
      }
    }

    // bunting along the stand fronts every third row: home side blue, away red
    for (const [column, name] of [[-5, 'bunting_blue'], [19, 'bunting_red']] as [number, string][]) {
      const texture = this.dressingTextures.get(name);
      if (!texture) continue;
      for (let x = 1; x <= 24; x += 3) {
        const a = extPoint(x, column);
        const b = extPoint(x, column + 1);
        const strip = new Sprite(texture);
        strip.anchor.set(0.5, 0);
        strip.width = Math.abs(b.x - a.x) * 0.95;
        strip.scale.y = strip.scale.x;
        strip.position.set((a.x + b.x) / 2, Math.max(a.y, b.y) - 4);
        this.stadiumLayer.addChild(strip);
      }
    }

    if (this.decorEnabled) this.drawStadiumProps();
  }

  /**
   * Owner 2026-07-04: replaced the on-apron merchant buildings/carts with real
   * broadcast props — two CAMERAS flanking the line of scrimmage on opposite
   * sidelines (facing the pitch), and four STADIUM LIGHT towers just OUTSIDE each
   * pitch corner (near A1/A26/O1/O26). Sprites sliced from the stadium sheets; if
   * a sheet is missing the pitch just renders bare (no procedural fallback).
   */
  private drawStadiumProps(): void {
    if (!this.game) return;
    // Owner 09-09: the broadcast cameras and the light towers are placed for the N-S apron; in EAST-WEST mode they
    // land on the wrong aprons, so the E-W pitch renders without them (the bunting/pennant dressing stays).
    if (getOrientation() === 'ew') return;
    // Broadcast camera on the RIGHT (O) sideline apron near the LOS (owner 2026-07-07:
    // SWAPPED from the A/west side to outside O12). A single camera facing the pitch from
    // the east (flip=true); it sits in the east-margin gap between the home dugout (x0-11)
    // and the away track (x17-25), clear of both.
    if (this.cameraTexture) {
      const place = (x: number, y: number, flip: boolean) => {
        const a = squareAnchor(x, y);
        const s = depthScale(x, y);
        // Owner 09-05: cameras cast a ground shadow like the players do (same ink, flattened into the ground plane,
        // scaled with depth), so the tripod reads as standing on the apron rather than floating.
        const shadow = new Graphics()
          .ellipse(a.x, a.y - 1, TILE_W * 0.42 * s, TILE_H * 0.17 * s)
          .fill({ color: 0x000000, alpha: 0.55 });
        this.stadiumLayer.addChild(shadow);
        const cam = new Sprite(this.cameraTexture!);
        cam.anchor.set(0.5, 0.9); // base of the tripod
        cam.scale.set((TILE_W * 1.3 * s) / cam.texture.width * (flip ? -1 : 1), (TILE_W * 1.3 * s) / cam.texture.width);
        cam.position.set(a.x, a.y);
        this.stadiumLayer.addChild(cam);
      };
      // Owner 2026-07-08: XOR the horizontal flip with the drive-north field flip. When the
      // AWAY team is on its offensive drive the whole field mirrors 180° (isFieldFlip), so the
      // fixed-facing cameras pointed the WRONG way — invert their asset flip while flipped so
      // they keep facing the pitch. (Normal drive: unchanged.)
      for (const camera of broadcastCameraPlacements(isFieldFlip())) {
        place(camera.x, camera.y, camera.flip);
      }
    }
    // Owner 2026-07-07 (queue #3): stadium LIGHT TOWERS moved IN to the far-N pitch
    // corners — up in the stone apron just outside the corner flags (extPoint(COLS,0)/
    // (COLS,ROWS)), not way out in the crowd. Nudged one row north (x=26, into the end
    // apron) and pulled toward the sidelines (y=-1 west / y=16 east).
    if (this.lightTexture) {
      const light = (x: number, y: number) => {
        const a = squareAnchor(x, y);
        const s = depthScale(x, y);
        const sp = new Sprite(this.lightTexture!);
        sp.anchor.set(0.5, 0.94); // base of the tower
        sp.scale.set((TILE_W * 1.5 * s) / sp.texture.width);
        sp.position.set(a.x, a.y);
        this.stadiumLayer.addChild(sp);
      };
      // Owner 2026-07-08: the AWAY-side (north-end) light towers must ALWAYS render at the
      // VISUAL north, even during the away drive when the whole field mirrors 180° (isFieldFlip).
      // Placed at the logical MIRROR of their north-apron squares when flipped ((26,15)→(-1,-1),
      // (26,-1)→(-1,15)) so they stay put at the top of the arena instead of flipping south.
      const ff = isFieldFlip();
      const lx = ff ? -1 : 26; // north-apron long-axis square, mirrored under the flip
      light(lx, ff ? -1 : 15); // NE corner — one square outside the east sideline
      light(lx, ff ? 15 : -1); // NW corner — one square outside the west sideline
    }
  }

  // --- static pitch ---

  private drawPitch(): void {
    // self-clearing so it can be re-run on turf/orientation changes without
    // stacking a second pitch (B8-8 toggle left stale E-W TOUCHDOWN + lines)
    for (const child of this.pitchLayer.removeChildren()) child.destroy({ children: true });
    const g = new Graphics();

    // A weather pitch pack? Draw the full top-down field
    // photo warped over the playable area (a perspective mesh), instead of the
    // per-square turf tiles. The grid/yard lines below then get a dark-haloed
    // bright treatment so they stay legible over the photo.
    const pitchThemeActive = isWeatherPitchTheme(this.turfTheme);
    const pitchTex = pitchThemeActive
      ? this.pitchTextures.get(`${this.turfTheme}:${pitchWeatherKey(this.game?.fieldModel.weather)}`) ?? null
      : null;

    if (pitchThemeActive) {
      this.lastPitchWeather = pitchWeatherKey(this.game?.fieldModel.weather);
      if (pitchTex) {
        this.pitchLayer.addChild(this.buildPitchMesh(pitchTex));
        if (this.endZoneTint && END_ZONE_TINT_PITCH_THEMES.has(this.turfTheme)) {
          for (const x of [0, PITCH_COLS - 1]) {
            const bc = [extPoint(x, 0), extPoint(x + 1, 0), extPoint(x + 1, PITCH_ROWS), extPoint(x, PITCH_ROWS)];
            g.poly(bc.flatMap((p) => [p.x, p.y])).fill({ color: x === 0 ? 0x1a3a9a : 0x9a1a1a, alpha: 0.9 }); // same ink as the tile turf
          }
        }
      } else {
        // image still loading — a plain green fill so the field isn't blank
        for (let x = 0; x < PITCH_COLS; x++) {
          const bc = [extPoint(x, 0), extPoint(x + 1, 0), extPoint(x + 1, PITCH_ROWS), extPoint(x, PITCH_ROWS)];
          g.poly(bc.flatMap((p) => [p.x, p.y])).fill(x % 2 === 0 ? COLORS.grassA : COLORS.grassB);
        }
      }
    } else {
      // Madden pseudo-3D: each square renders the turf tile mapped to its
      // projected trapezoid. Themes with multiple tiles alternate per ROW
      // (every square in a row carries the same tile).
      const tiles = this.turfThemes.get(this.turfTheme);
      for (let x = 0; x < PITCH_COLS; x++) {
        const isEndZone = x === 0 || x === PITCH_COLS - 1;
        const texture = tiles?.[x % tiles.length];
        for (let y = 0; y < PITCH_ROWS; y++) {
          const quad = squareQuad(x, y);
          if (texture) {
            const matrix = this.tileTexMatrix(x, y, texture.width, texture.height);
            g.poly(quad.points.flat()).fill({ texture, matrix });
          } else {
            g.poly(quad.points.flat()).fill(isEndZone ? COLORS.endZone : x % 2 === 0 ? COLORS.grassA : COLORS.grassB);
          }
        }
        // Overall pitch dimming (owner-tuned) + mowing bands. End zones are
        // team-shaded over the texture: south (near, x=0) blue, north (far,
        // x=25) red.
        if (texture) {
          const overlay = isEndZone && this.endZoneTint && this.turfTheme !== 'grass1' // owner 09-05: Basic carries no tint
            ? { color: x === 0 ? 0x1a3a9a : 0x9a1a1a, alpha: 0.9 } // owner 2026-07-02: 90% (settings.endZoneTint, 09-05)
            : { color: 0x102a0c, alpha: x % 2 === 1 ? 0.36 : 0.15 };
          // B9-21: full long-axis column x spanning the whole across range, built
          // from game grid corners via extPoint so it isn't sheared in E-W (the
          // old squareQuad(x,0)/squareQuad(x,14) "left/right" assumed y=horizontal).
          const bc = [extPoint(x, 0), extPoint(x + 1, 0), extPoint(x + 1, PITCH_ROWS), extPoint(x, PITCH_ROWS)];
          g.poly(bc.flatMap((p) => [p.x, p.y])).fill(overlay);
        }
      }
    }

    // Grid/yard/side lines. Over a FUMBBL pitch photo they get a dark halo +
    // bright core to stay legible (owner 2026-07-03 r2: "contrast the grid lines
    // against the turf images"); over the tile turf they keep the muted look.
    // Accessibility (owner 2026-07-03 r3): the grid can be hidden, and its width
    // (multiplier) + colour are user-adjustable via setGridOptions.
    const gridColor = this.gridColor;
    const gridMul = this.gridWidthMul;
    // Owner 2026-09-05: contrast-aware — dark lines over bright pitch images (snow, sun-bleached turf).
    const pitchLum = pitchThemeActive
      ? this.pitchLuminance.get(`${this.turfTheme}:${pitchWeatherKey(this.game?.fieldModel.weather)}`) ?? 0.35
      : 0.35;
    const gridPlan = gridStrokePlan(pitchLum, gridColor);
    const drawSegments = (segments: ReturnType<typeof squareEdge>[], width: number, baseAlpha: number) => {
      if (!this.gridShow) return;
      const alpha = baseAlpha * this.gridAlphaMul; // owner 09-05: grid opacity slider
      const w = width * gridMul;
      const strokeSegments = (color: number, strokeWidth: number, strokeAlpha: number) => {
        for (const [a, c] of segments) g.moveTo(a[0], a[1]).lineTo(c[0], c[1]);
        g.stroke({ color, width: strokeWidth, alpha: strokeAlpha });
      };
      if (pitchThemeActive) {
        // Owner 09-05: no halo/outline stroke — the contrast-aware CORE colour alone (dark over bright turf,
        // bright over dark); the black outline read as a heavy black grid.
        strokeSegments(gridPlan.core, w, gridPlan.coreAlpha(alpha));
      } else {
        strokeSegments(gridColor, w, alpha);
      }
    };

    // Build every pitch boundary from squareQuad edges. A single endpoint chord
    // cuts across the compressed depth rows instead of following their projection.
    const xBoundary = (boundary: number): ReturnType<typeof squareEdge>[] => {
      const x = Math.min(boundary, PITCH_COLS - 1);
      const edge = boundary === PITCH_COLS ? 'xMax' : 'xMin';
      return Array.from({ length: PITCH_ROWS }, (_, y) => squareEdge(x, y, edge));
    };
    const yBoundary = (boundary: number): ReturnType<typeof squareEdge>[] => {
      const y = Math.min(boundary, PITCH_ROWS - 1);
      const edge = boundary === PITCH_ROWS ? 'yMax' : 'yMin';
      return Array.from({ length: PITCH_COLS }, (_, x) => squareEdge(x, y, edge));
    };
    // owner W21: interior across-the-length lines skip the end-zone columns
    // (x=0, x=PITCH_COLS-1 in PITCH coords) so the end zone reads as clean
    // turf under the TOUCHDOWN lettering. The end-zone boundary (xBoundary
    // b=1/PITCH_COLS-1) and outer pitch border (sidelines, xBoundary b=0/
    // PITCH_COLS) are untouched — only lines that cross THROUGH an end-zone
    // cell are trimmed here.
    const yBoundaryField = (boundary: number): ReturnType<typeof squareEdge>[] =>
      yBoundary(boundary).filter((_, x) => x !== 0 && x !== PITCH_COLS - 1);

    // Yard lines at each long-axis boundary b span the full across range.
    // Outer boundaries (0 near, PITCH_COLS far) are majors.
    const MAJOR_LINE_W = 3; // owner 09-07: line of scrimmage + wide-zone lines (was 2.5)
    const EDGE_LINE_W = 2.25; // owner 09-08: end-zone lines, outer border, sidelines sit midway between the 1.5 yard grid and the LoS
    for (let b = 0; b <= PITCH_COLS; b++) {
      const major = b === 0 || b === 1 || b === PITCH_COLS - 1 || b === PITCH_COLS || b === PITCH_COLS / 2;
      drawSegments(xBoundary(b), b === PITCH_COLS / 2 ? MAJOR_LINE_W : major ? EDGE_LINE_W : 1.5, major ? 0.85 : 0.3);
    }
    // Low-opacity grid lines along the long axis at each across boundary y so
    // individual squares read (sidelines/wide-zone lines drawn stronger below).
    for (let y = 1; y < PITCH_ROWS; y++) {
      if (y === 4 || y === PITCH_ROWS - 4) continue; // wide-zone lines below
      drawSegments(yBoundaryField(y), 1.2, 0.16);
    }

    // Sidelines + wide-zone lines: across boundaries spanning the full long axis.
    // Sidelines (y=0/PITCH_ROWS) are the outer pitch border and stay full-length
    // through the end zones; wide-zone lines are interior and get trimmed there.
    for (const y of [0, 4, PITCH_ROWS - 4, PITCH_ROWS]) {
      const isEdge = y === 0 || y === PITCH_ROWS;
      drawSegments(isEdge ? yBoundary(y) : yBoundaryField(y), isEdge ? EDGE_LINE_W : MAJOR_LINE_W, isEdge ? 0.9 : 0.85); // owner 09-07: wide-zone lines = line-of-scrimmage weight; 09-08: sidelines = edge weight
    }
    this.pitchLayer.addChild(g);

    // (crowd stands removed — owner 2026-07-02)

    // TOUCHDOWN end zones (owner 2026-07-02: red checker marks removed;
    // the 90% team shading above carries the zone)
    const ew = getOrientation() === 'ew';
    for (const endX of [0, PITCH_COLS - 1]) {
      // Owner 2026-07-08: FUMBBL writes the TEAM NAME on its own end zone (home
      // south = endX 0, away north). 'touchdown' keeps the plain word. Fall back to
      // "TOUCHDOWN" when a team name is missing (standalone/unnamed teams).
      const teamName = endX === 0 ? this.game?.teamHome.teamName : this.game?.teamAway.teamName;
      const label = this.endZoneLabel === 'touchdown' ? 'TOUCHDOWN' : (teamName?.trim() || 'TOUCHDOWN');
      const td = new Text({ text: label.toUpperCase(), style: ENDZONE_STYLE });
      td.anchor.set(0.5, 0.5);
      td.alpha = 0.8;
      if (ew) {
        // E-W TD fix: the end zone is a column that RECEDES up the sideline, so
        // its long edge is a slanted perspective line, NOT screen-vertical. Build
        // the text ALONG that centerline (slanted with the field) and size its
        // thickness to a SINGLE x-column. The old ±90° version was axis-aligned
        // and sized to the leaning band's bounding-box WIDTH (~3× the real column
        // thickness), so the letters overflowed the end zone into the stands.
        const A = extPoint(endX + 0.5, 0); // near (bottom) end of the centerline
        const B = extPoint(endX + 0.5, PITCH_ROWS); // far (top) end
        const lenDx = B.x - A.x;
        const lenDy = B.y - A.y;
        const length = Math.hypot(lenDx, lenDy) || 1;
        const ux = lenDx / length;
        const uy = lenDy / length;
        // perpendicular thickness of the 1-wide column, sampled at mid-depth
        // (|edge × û|). NOTE: extPoint's depthBoundaryY array-indexes boundaryY[d],
        // so the depth MUST be an integer — a fractional gy yields y=undefined.
        const midY = Math.round(PITCH_ROWS / 2);
        const e0 = extPoint(endX, midY);
        const e1 = extPoint(endX + 1, midY);
        const thickness = Math.abs((e1.x - e0.x) * uy - (e1.y - e0.y) * ux) || 1;
        td.scale.set(Math.min((length * 0.95) / td.width, (thickness * 0.85) / td.height));
        // read up the field: left end zone top→bottom, right end zone bottom→top
        let ang = Math.atan2(lenDy, lenDx);
        if (endX === 0) ang += Math.PI;
        td.rotation = ang;
        td.position.set((A.x + B.x) / 2, (A.y + B.y) / 2);
      } else {
        // N-S (byte-identical): horizontal end-zone strip; text spans its width.
        // B9-21: screen bounding box of the whole end-zone band from game corners.
        const corners = [
          extPoint(endX, 0),
          extPoint(endX + 1, 0),
          extPoint(endX + 1, PITCH_ROWS),
          extPoint(endX, PITCH_ROWS),
        ];
        const bx = corners.map((p) => p.x);
        const by = corners.map((p) => p.y);
        const bandW = Math.max(...bx) - Math.min(...bx);
        const bandH = Math.max(...by) - Math.min(...by);
        td.scale.set(Math.min((bandW * 0.95) / td.width, (bandH * 0.85) / td.height));
        // owner 2026-07-02: south text rotated 180° (reads from the far LOS).
        if (endX === 0) td.angle = 180;
        const c = squareAnchor(endX, Math.floor(PITCH_ROWS / 2));
        td.position.set(c.x, c.y);
      }
      this.pitchLayer.addChild(td);
    }

    // (no center circle — American football; the midfield line above suffices)

    // Match5: on-field row numbers in the outermost rows, hugging the
    // sidelines — identical on both halves (owner 2026-07-02): 2-step
    // increments, 12 at midfield down to 2 near each end zone.
    // Accessibility (owner 2026-07-03 r4): togglable.
    if (this.showRowMarkers) for (const distance of [2, 4, 6, 8, 10, 12]) {
      for (const x of [distance, PITCH_COLS - 1 - distance]) {
        for (const gameY of [0, PITCH_ROWS - 1]) {
          const scale = depthScale(x, gameY);
          // Owner 09-07: rasterised at 4x + linear/mipmaps — the default 1x canvas read soft next to the other text.
          const label = new Text({ text: String(distance), style: DISTANCE_STYLE, resolution: 4, textureStyle: { scaleMode: 'linear' }, autoGenerateMipmaps: true });
          label.anchor.set(0.5, 0.5);
          label.alpha = 0.45; // owner 09-05: 0.55 -> 0.45
          label.scale.set(scale);
          // Owner 09-05: centred on the SQUARE (centroid of its projected quad) — the ground anchor + a sideline
          // nudge left the digits off-centre both ways.
          const quad = squareQuad(x, gameY).points;
          const cx = quad.reduce((sum, p) => sum + p[0], 0) / quad.length;
          const cy = quad.reduce((sum, p) => sum + p[1], 0) / quad.length;
          // Owner 09-07 (r2): the Nuffle digits sit a little high-left inside their text box — keep the centred anchor
          // (a fresh Text has EMPTY local bounds before its first render, so a pivot built from them landed the
          // digits down-right by half a glyph) and nudge by a fraction of the measured, depth-scaled box instead.
          label.position.set(cx + label.width * 0.04, cy + label.height * 0.08);
          this.pitchLayer.addChild(label);
        }
      }
    }

    // FUMBBL Classic coloured row-number rails (owner 2026-07-08): each HALF counts
    // 1..12 down both side rails, starting at that team's END ZONE and terminating
    // at the LINE OF SCRIMMAGE. The pitch is 26 long = 1 end zone + 12 + 12 + 1 end
    // zone, so the two end-zone columns (x=0, x=25) are skipped; home field x=1..12
    // → 1..12 (red), away field x=13..24 → 12..1 (blue), both reaching 12 at the LOS.
    if (this.showRowNumberRails) for (let x = 1; x < PITCH_COLS - 1; x++) {
      const home = x <= PITCH_COLS / 2 - 1; // x 1..12 home, 13..24 away
      const num = home ? x : PITCH_COLS - 1 - x; // end zone = 1 → LOS = 12, per half
      const style = home ? RAIL_HOME_STYLE : RAIL_AWAY_STYLE;
      for (const gameY of [0, PITCH_ROWS - 1]) {
        const scale = depthScale(x, gameY);
        const label = new Text({ text: String(num), style, resolution: 4, textureStyle: { scaleMode: 'linear' }, autoGenerateMipmaps: true }); // owner 09-07: 4x raster
        label.anchor.set(0.5, 0.5);
        label.alpha = 0.92;
        label.scale.set(scale);
        // hug the sideline: nudge a hair INWARD (toward the row centre) so the
        // number sits on the outermost square, not off-pitch. Same screen-vector
        // trick as the accessibility row markers above.
        const a = squareAnchor(x, gameY);
        const center = squareAnchor(x, Math.floor(PITCH_ROWS / 2));
        const dx = center.x - a.x;
        const dy = center.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nud = 4 * scale;
        label.position.set(a.x + (dx / len) * nud, a.y + (dy / len) * nud);
        this.pitchLayer.addChild(label);
      }
    }
  }

  // --- player tokens (placeholder art, EC-7) ---

  /**
   * World position a player token sits at: the tile centroid (squareAnchor)
   * nudged toward the CENTRE COLUMN by 1.25px per column of offset (depth-scaled).
   * Upright sprites otherwise stick out toward the sideline in the converging
   * perspective, so off-centre players read as shifted to their side; the nudge
   * pulls them back. Centre column → 0. Orientation-aware: N-S width axis = y,
   * E-W width axis = x — both map to the horizontal (screen-x) convergence.
   */
  /** Owner 2026-07-15 (live test): while a carrier token tweens, drag its ball + cyan aura + "BALL" marker along
   *  with it (they're drawn at the destination square, so without this they teleport ahead of the token). `tx,ty`
   *  is the token's live tweened position; each follower shifts by the same delta from its rest layout. The marker
   *  updates ballMarker.baseY (not its y directly) so the bob ticker composes on top; guards destroyed nodes. */
  private followTokenDecorations(playerId: string, tx: number, ty: number): void {
    // #3: process BOTH the carried-ball group and the active-halo group — a moving token can be a carrier, the
    // active player, or both (same id in both groups → each set of decorations rides independently).
    for (const cf of [this.carrierFollow, this.activeFollow]) {
      if (!cf || cf.carrierId !== playerId) continue;
      const dx = tx - cf.restX;
      const dy = ty - cf.restY;
      for (const f of cf.nodes) {
        if (f.node.destroyed) continue;
        if (f.kind === 'marker') {
          f.node.position.x = f.baseX + dx;
          if (this.ballMarker && this.ballMarker.node === f.node) this.ballMarker.baseY = f.baseY + dy;
          else f.node.position.y = f.baseY + dy;
        } else {
          f.node.position.set(f.baseX + dx, f.baseY + dy);
        }
      }
    }
  }

  private tokenPos(x: number, y: number): { x: number; y: number } {
    const anchor = squareAnchor(x, y);
    const quad = squareQuad(x, y);
    const [nearL, nearR, farR, farL] = quad.points as [[number, number], [number, number], [number, number], [number, number]];
    const band = quad.yBottom - quad.yTop;
    const slantPerPx = band > 0 ? (((farL[0] + farR[0]) - (nearL[0] + nearR[0])) / 2) / band : 0;
    // The anchor sits at the square's centre; the sprite's visual centre is TOKEN_CENTRE_HEIGHT_PX above its feet,
    // so shift by the midline's drift over that height. Zero in FLAT mode (no slant); flip-aware via the quad.
    return { x: anchor.x + slantPerPx * TOKEN_CENTRE_HEIGHT_PX, y: anchor.y };
  }

  /** @deprecated W31 constant nudge — retained only for the historical note above; no callers. */
  private legacyTokenPosNudge(x: number, y: number): { x: number; y: number } {
    const anchor = squareAnchor(x, y);
    const ew = getOrientation() === 'ew';
    const widthCol = ew ? x : y;
    const widthCenter = ew ? (PITCH_COLS - 1) / 2 : (PITCH_ROWS - 1) / 2;
    // Owner 08-13 (W31, restoring prior behaviour): tokens nudge toward the pitch's width-
    // center as they sit further out — TOKEN_EDGE_NUDGE_MAX_PX at the furthest column,
    // falling off LINEARLY to 0 at center. Previously this dropped to zero entirely in FLAT
    // mode (isFlat() early-return, ff08de70) — that was the missing-path bug: FLAT/Classic
    // spectate lost the nudge outright. depthScale (≡1 in FLAT, since far=1 there) keeps the
    // existing Madden depth taper in isometric mode instead of a bare linear cheat, so the
    // near rows read the full 8px and far rows taper with the same perspective the tiles use
    // — in FLAT it collapses to a uniform 10px-at-edge linear falloff, matching the spec exactly.
    const nudgeFrac = widthCenter > 0 ? (widthCol - widthCenter) / widthCenter : 0;
    // Owner 2026-07-06: the spectator drive-north flip mirrors the width axis, so the
    // off-centre nudge must point the other way (a token on the flipped-left of centre
    // is nudged the opposite screen direction). depthScale is already flip-aware.
    const nudgeX = -nudgeFrac * 10 * depthScale(x, y) * (isFieldFlip() ? -1 : 1);
    return { x: anchor.x + nudgeX, y: anchor.y };
  }

  private buildPlayerToken(
    player: PlayerJson,
    data: PlayerDataJson,
    isHome: boolean,
    team: TeamJson,
    baselineSkills?: Set<string>,
    includeBadges = true,
    shading = true,
    // #95 (owner): the "STUNNED" caption must ride the REAL server STUNNED state only. The dugout
    // renders KO'd/casualtied players with a FAKED STUNNED stub (for the lying pose) — pass false
    // there so the caption doesn't fire on every downed/injured player (the X still draws).
    stunCaption = true,
    badgeOccluded?: boolean,
  ): Container {
    const [x, y] = data.playerCoordinate!;
    const pos = this.tokenPos(x, y);
    const token = new Container();
    token.position.set(pos.x, pos.y);
    // Madden depth scaling × per-Strength scale (owner spec, STRENGTH_SCALE:
    // Str3 = 1.0, big guys land ~Str5/6 ≈ the old 1.25 big-guy bump). The token
    // origin IS the square anchor, so scaling keeps them centered.
    token.scale.set(depthScale(x, y) * strengthScale(player.strength));
    token.zIndex = this.depthZ(x, y);

    const body = isHome ? COLORS.homeBody : COLORS.awayBody;
    const trim = isHome ? COLORS.homeTrim : COLORS.awayTrim;
    const down = isDown(data.playerState);

    // #135 (owner 07-23): a Wizard-ZAPPED player is polymorphed into a FROG — a persistent icon SWAP
    // (mirrors upstream PlayerIconFactory's ZappedPlayer branch: the whole sprite becomes the shared
    // frog sheet, sprite-set-agnostic). Pure model read on playerKind (server restores it on un-zap →
    // the gate falls through to the normal sprite automatically). The number / down pose / markings /
    // shading still paint over the frog, as upstream does; no position ring or skill badges on a frog.
    // Falls through to the normal render if the asset didn't load (frogTexture null).
    if (player.playerKind === 'zappedPlayer' && this.frogTexture) {
      if (down) token.addChild(this.buildProneShadow());
      const frog = new Sprite(this.frogTexture);
      frog.label = 'zappedFrog';
      frog.anchor.set(0.5, 0.5);
      // Aspect-preserved and compensated for the transparent sheet margins; strength scale remains at the token
      // level, so overlays and the center/ground anchor keep exactly the same geometry as every other player.
      frog.scale.set(FROG_ART_SCALE * PLAYER_SPRITE_BASE / Math.max(this.frogTexture.width, this.frogTexture.height));
      frog.position.set(0, -3 + TOKEN_BASE_SHIFT_PX);
      if (down) frog.rotation = Math.PI / 2;
      token.addChild(frog);
      if (down) this.addDownDecoration(token, this.showStunMark(data), stunCaption);
      if (isHome && this.showPlayerNumbers) {
        const nr = new Text({ text: String(player.playerNr), style: NAME_STYLE });
        nr.anchor.set(0.5, 0.5);
        nr.position.set(8, 11);
        token.addChild(nr);
      }
      this.addMarkingText(token, player, down);
      if (shading) this.applyActivationShading(token, data, isHome, player.strength);
      return token;
    }

    // Optional owner-authored art is an O(1) exact stable-id branch. It precedes
    // Modern and Classic/checker selection; absent targets preserve every branch.
    const playerSide = isHome ? 'home' : 'away';
    const customPlayerAsset = playerSpriteAsset(team.teamId, player.positionId, playerSide, team.race);
    const customPlayerSprite = customPlayerAsset?.texture;
    if (customPlayerAsset) this.retainPlayerAssetOnToken(token, team.teamId, player.positionId, playerSide, team.race);

    // FUMBBL checker discs (upstream abstract icon mode, UI-5): team-colored
    // counters carrying the player number; big guys use the large disc.
    // Prone/stunned keep FUMBBL's slash/X decorations over the disc.
    if (!customPlayerSprite && this.spriteSet === 'checkers') {
      const big = isBigGuy(player, team);
      // colorway flipped like the classic iconsets: upstream home = RED, but
      // the end-color convention puts BLUE on the south/home side
      const texture = this.checkerTextures.get(`${big ? 'large' : 'normal'}${isHome ? 'Away' : 'Home'}`);
      if (texture) {
        if (down) token.addChild(this.buildProneShadow());
        const disc = new Sprite(texture);
        disc.anchor.set(0.5, 0.5);
        const size = TILE_W * (big ? 0.8 : 0.64);
        disc.width = size;
        disc.height = size;
        disc.position.set(0, -3 + TOKEN_BASE_SHIFT_PX);
        token.addChild(disc);
        if (down) this.addDownDecoration(token, this.showStunMark(data), stunCaption);
        // owner: the disc carries the POSITION letter (B/T/C/BG…), not the number
        const nr = new Text({ text: positionLetter(player, team), style: NAME_STYLE });
        nr.anchor.set(0.5, 0.5);
        nr.position.set(0, -3 + TOKEN_BASE_SHIFT_PX);
        token.addChild(nr);
        if (includeBadges) this.addSkillBadges(token, player, data, trim, team, baselineSkills, badgeOccluded);
        this.addMarkingText(token, player, down);
        if (shading) this.applyActivationShading(token, data, isHome, player.strength);
        return token;
      }
    }

    // Owner 09-05: the SPRITE CHAIN — user-selected (slot pack: owner-authored sprite above, then its walk
    // sheet) > installed mods (any pack's iconset for the position, FUMBBL upstream included — the flat
    // square icon) > placeholder (the bundled Super FUMBBL walkers when they are NOT the selection, then the
    // generic human pair). With Super FUMBBL selected (no slot pack) its walkers ARE the selection.
    const slotWalker = customPlayerSprite ? undefined : walkSheetFor(team.teamId, player.positionId, playerSide, team.race);
    const slotPackSelected = !!this.selectedSpritePack;
    const bundledWalker = customPlayerSprite || slotWalker ? undefined
      : this.spriteSet === 'walk' ? bundledWalkSheetFor(team.race, positionNameOf(player, team), playerSide) : undefined;
    const selectedWalker = slotWalker ?? (slotPackSelected ? undefined : bundledWalker);
    if (!customPlayerSprite && !selectedWalker && this.spriteSet !== 'checkers') {
      const moving = baseState(data.playerState) === PlayerStateBase.MOVING;
      // colorway flipped: FUMBBL "away" columns (usually the blue/light
      // variant) go to the south/home side per the end-color convention above.
      // B2-10: lying players get the shadow-stripped art; standing keep shadows
      const icon = classicIconFor(player, team, !isHome, moving, down, this.oneSpritePerPosition);
      if (icon) {
        // Position ring under the classic icon (owner 2026-07-02: a shaded
        // base beneath the FUMBBL character; 4/5 of the original size)
        // Owner 08-19 (supersedes 07-04g "gone once activated"): the ring/glow/
        // star base ALWAYS render; activated players' rings dim with the token
        // (ringDimAlpha floor) but stay in their position color. Mid-fade the
        // 'positionRing' wrapper alpha rides the same clock as the dim (item3).
        const ringK = this.showPositionRings ? this.activationRingLevel(player.playerId) : null;
        if (ringK !== null) {
          // owner 2026-07-04: the ring shows the player's POSITION (blitzer red /
          // catcher yellow / thrower white / blocker green / lineman grey / big guy
          // orange / special purple). An explicit colour override still wins.
          const d = this.ringDensity;
          const ringNode = new Container();
          ringNode.label = 'positionRing';
          ringNode.alpha = this.ringDimAlpha(ringK);
          if (isStarPlayer(player, team)) {
            // Star Player: gold star silhouette beneath the feet, not a ring.
            ringNode.addChild(this.buildStarBase(TILE_H * 0.32, TILE_W * 0.34, Math.min(1, d)));
          } else {
            const ringColor = this.ringColorOverride ?? positionRingColor(player, team);
            ringNode.addChild(this.buildRingGlow(TILE_H * 0.32, TILE_W * 0.3, TILE_H * 0.18, ringColor, Math.min(1, d), d));
            ringNode.addChild(
              new Graphics()
                .ellipse(0, TILE_H * 0.32, TILE_W * 0.3, TILE_H * 0.18)
                .fill({ color: ringColor, alpha: Math.min(1, 0.3 * d) })
                .ellipse(0, TILE_H * 0.32, TILE_W * 0.3, TILE_H * 0.18)
                .stroke({ color: ringColor, width: 2 * d, alpha: Math.min(1, 0.95 * d) }) // owner 09-10: density also scales the stroke
                .ellipse(0, TILE_H * 0.32, TILE_W * 0.23, TILE_H * 0.13)
                .stroke({ color: body, width: 1.2, alpha: Math.min(1, 0.8 * d) }),
            );
          }
          token.addChild(ringNode);
        }
        // Owner 2026-07-02 (revised): down players lie flat (rotated,
        // centered to the square); stunned ones carry the X overlay on top
        if (down) token.addChild(this.buildProneShadow());
        const sprite = new Sprite(icon);
        sprite.anchor.set(0.5, 0.5);
        const size = PLAYER_SPRITE_BASE; // Strength scaling is applied at the token level
        sprite.width = size;
        sprite.height = size;
        sprite.position.set(0, -3 + TOKEN_BASE_SHIFT_PX);
        if (down) sprite.rotation = Math.PI / 2;
        token.addChild(sprite);
        if (down && this.showStunMark(data)) this.addDownDecoration(token, true, stunCaption);
        // number on the right foot, home team only (owner 2026-07-02) — off by default (owner 2026-07-04)
        if (isHome && this.showPlayerNumbers) {
          const nr = new Text({ text: String(player.playerNr), style: NAME_STYLE });
          nr.anchor.set(0.5, 0.5);
          nr.position.set(8, 11);
          token.addChild(nr);
        }
        if (includeBadges) this.addSkillBadges(token, player, data, trim, team, baselineSkills, badgeOccluded);
        this.addMarkingText(token, player, down);
        if (shading) this.applyActivationShading(token, data, isHome, player.strength);
        return token;
      }
      // Mod-tier icon unavailable (no pack owns the id / still loading) → the placeholder tier below.
    }

    if (!customPlayerSprite) {
      const walker = selectedWalker ?? bundledWalker;
      if (walker) {
        // Owner 09-05: the walk sheets already encode size by Strength tier (goblin ~45 px, lineman 53, big guy
        // ~60 in the 64 px art), so the renderer's STRENGTH_SCALE would double it — walkers keep depth scale
        // only… except ST 5+ (treeman/troll still read too small): walkerStrengthScale brings the table back.
        // Owner 09-05 (round 11): walkers draw at token scale 1 — no depth scale, no Strength factor. Any non-integer
        // multiplier breaks the pixel grid; the art tiers carry size, the per-token snap handles zoom/DPR.
        void walkerStrengthScaleFor;
        token.scale.set(1);
      }
      if (walker) return buildWalkerToken({
        token, walker, player, team, isHome, down, data, includeBadges, shading,
        baselineSkills, badgeOccluded, stunCaption, trim, body,
        ownerId: this.walkerOwnerId, facing: this.facingGeometry(), helpers: this.walkerHelpers(),
      });
    }

    const pair = customPlayerSprite
      ? { base: customPlayerSprite }
      : this.spritesReady
        ? (this.spriteSet === 'classic' || this.spriteSet === 'walk')
          ? spriteFor('lineman', 'human') // classic fallback: the default 2.5D human
          : spriteFor(player.positionId, team.race)
        : undefined;

    // App19: position-colored base ring (Blitzer red, Thrower white, Blocker
    // green, Catcher yellow, Lineman grey, big guy orange, special purple); thin
    // inner ring = team color. Owner 08-19 (supersedes 07-04g "gone once
    // activated"): the ring always renders; an acted player's ring dims to the
    // ringDimAlpha floor with the token but never vanishes. Cross-fade rides the
    // same clock as the activation dim (item3).
    this.addPositionRing(token, player, team, body);

    // Owner 2026-07-02 (revised): down players lie flat, centered to their
    // square; stunned ones additionally carry the X overlay
    if (down) token.addChild(this.buildProneShadow());
    if (pair && !down) {
      // sprite layers: base (+ team-tinted jersey overlay when present),
      // nearest-neighbor, normalized to the FUMBBL classic on-screen figure height (owner 09-04; was 48 px)
      const scale = WALKER_TARGET_FIGURE_PX / pair.base.height;
      const layers: [typeof pair.base, number][] = [[pair.base, 0xffffff]];
      if (pair.jersey) layers.push([pair.jersey, body]);
      for (const [texture, tint] of layers) {
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5, 1);
        sprite.scale.set(scale);
        sprite.position.set(0, -2 + TOKEN_BASE_SHIFT_PX);
        sprite.tint = tint;
        token.addChild(sprite);
      }
    } else if (pair && down) {
      // lying flat: rotated around the square center (same 40:48 ratio as before, on the new height)
      const scale = (WALKER_TARGET_FIGURE_PX * 40 / 48) / pair.base.height;
      const layers: [typeof pair.base, number][] = [[pair.base, 0xffffff]];
      if (pair.jersey) layers.push([pair.jersey, body]);
      for (const [texture, tint] of layers) {
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5, 0.5);
        sprite.scale.set(scale, scale * 0.8);
        sprite.rotation = -Math.PI / 2;
        sprite.position.set(0, -3 + TOKEN_BASE_SHIFT_PX);
        sprite.tint = tint;
        token.addChild(sprite);
      }
    } else {
      // vector fallback (sprites unavailable)
      const g = new Graphics();
      if (down) {
        g.roundRect(-14, -7, 28, 9, 4).fill(body).stroke({ color: trim, width: 1 });
        g.circle(16, -4, 5).fill(COLORS.skin);
      } else {
        g.rect(-6, -14, 4, 10).fill(0x2a2a30);
        g.rect(2, -14, 4, 10).fill(0x2a2a30);
        g.roundRect(-9, -34, 18, 22, 5).fill(body).stroke({ color: trim, width: 1.5 });
        g.circle(0, -38, 6.5).fill(COLORS.skin).stroke({ color: 0x40301c, width: 1 });
      }
      token.addChild(g);
    }

    if (down && this.showStunMark(data)) this.addDownDecoration(token, true, stunCaption);

    // number centered on the right foot, home team only (owner 2026-07-02) — off by default (owner 2026-07-04)
    this.addPlayerNumber(token, player, isHome, down);

    if (includeBadges) this.addSkillBadges(token, player, data, trim, team, baselineSkills, badgeOccluded);

    this.addMarkingText(token, player, down);
    if (shading) this.applyActivationShading(token, data, isHome, player.strength);
    return token;
  }

  private walkerHelpers(): WalkerHelpers {
    if (!this.walkerHelperBindings) {
      this.walkerHelperBindings = {
        addPositionRing: this.addPositionRing.bind(this),
        buildProneShadow: this.buildProneShadow.bind(this),
        showStunMark: this.showStunMark.bind(this),
        addDownDecoration: this.addDownDecoration.bind(this),
        addSkillBadges: this.addSkillBadges.bind(this),
        addMarkingText: this.addMarkingText.bind(this),
        applyActivationShading: this.applyActivationShading.bind(this),
        addPlayerNumber: this.addPlayerNumber.bind(this),
      };
    }
    return this.walkerHelperBindings;
  }

  /** Owner 09-05 (round 9): zoom-settle tracking for the walker integer snap (no snapping while the camera zooms). */
  private lastWalkerDeviceScale = 0;
  private walkerZoomSettleAt = 0;
  /** Owner 09-05: set by the app when a pack occupies the player-sprite / walk-sheet slot (the USER SELECTION).
   *  With a pack selected, the bundled Super FUMBBL walkers drop to the placeholder tier. */
  selectedSpritePack = false;
  /** Owner 09-05: a mod-tier icon is worth loading only for positions the tiers above do not cover. */
  private modTierIconNeeded(team: TeamJson, positionId: string): boolean {
    if (this.spriteSet === 'checkers') return false;
    for (const side of ['home', 'away'] as const) {
      if (walkSheetFor(team.teamId, positionId, side, team.race)) return false;
    }
    if (this.selectedSpritePack || this.spriteSet !== 'walk') return true;
    const player = team.playerArray.find((p) => p.positionId === positionId);
    const positionName = player ? positionNameOf(player, team) : undefined;
    return !bundledWalkSheetFor(team.race, positionName, 'home') && !bundledWalkSheetFor(team.race, positionName, 'away');
  }

  /** The walker Strength factor for a player id (1 when unknown) — see walkerStrengthScaleFor. */
  private walkerStrengthFor(playerId: string): number {
    if (!this.game) return 1;
    for (const team of [this.game.teamHome, this.game.teamAway]) {
      const player = team.playerArray.find((p) => p.playerId === playerId);
      if (player) return walkerStrengthScaleFor(player, team);
    }
    return 1;
  }

  /** Owner 09-05: `opts.centreY` = token-local ground centre of the ring (classic icons: -3 + base shift; walkers:
   *  their feet); `opts.bodyRing` = the inner body-colour ellipse (classic only — on walkers it cut the waist,
   *  and the kits already carry the team colour). The POSITION ring itself stays on every token. */
  private addPositionRing(token: Container, player: PlayerJson, team: TeamJson, body: number,
    opts: { centreY?: number; bodyRing?: boolean; rx?: number; ry?: number } = {}): void {
    const cy = opts.centreY ?? -3 + TOKEN_BASE_SHIFT_PX;
    const bodyRing = opts.bodyRing ?? true;
    // Owner 09-05: walkers pass their SHADOW's radii so the ring outlines the shadow exactly (same diameter).
    const rx = opts.rx ?? TILE_W * 0.27;
    const ry = opts.ry ?? TILE_H * 0.21;
    const ringK = this.showPositionRings ? this.activationRingLevel(player.playerId) : null;
    if (ringK !== null) {
      const d = this.ringDensity;
      const ringNode = new Container();
      ringNode.label = 'positionRing';
      ringNode.alpha = this.ringDimAlpha(ringK);
      if (isStarPlayer(player, team)) {
        // Star Player: gold star silhouette beneath the feet, not a ring.
        ringNode.addChild(this.buildStarBase(cy, rx * 1.1, Math.min(1, d)));
      } else {
        const rc = this.ringColorOverride ?? positionRingColor(player, team);
        ringNode.addChild(this.buildRingGlow(cy, rx, ry, rc, Math.min(1, d), d));
        // Owner 09-05: on walkers (bodyRing false) the ring now outlines the SHADOW exactly, so its dark fill stacked
        // under the 0.7 shadow and read too dark — the fill stays classic-only; the shadow alone carries the 70%.
        const ring = new Graphics();
        if (bodyRing) ring.ellipse(0, cy, rx, ry).fill({ color: 0x000000, alpha: Math.min(1, 0.3 * d) });
        // Owner 09-10: density scales the stroke WIDTH and the glow spread too — alpha alone was capped at 1 and sat under
        // the 70% ground shadow, so the slider read as doing nothing on walkers.
        ring.ellipse(0, cy, rx, ry).stroke({ color: rc, width: 3.6 * d, alpha: Math.min(1, 0.95 * d) }); // owner 09-06: heavier ring stroke (2.4 -> 3.6)
        if (bodyRing) {
          ring.ellipse(0, cy, TILE_W * 0.21, TILE_H * 0.15)
            .stroke({ color: body, width: 1.2, alpha: Math.min(1, 0.8 * d) });
        }
        ringNode.addChild(ring);
      }
      token.addChild(ringNode);
    }
  }

  private addPlayerNumber(token: Container, player: PlayerJson, isHome: boolean, down: boolean): void {
    if (isHome && this.showPlayerNumbers) {
      const nr = new Text({ text: String(player.playerNr), style: NAME_STYLE });
      nr.anchor.set(0.5, 0.5);
      nr.position.set(down ? 12 : 6, (down ? -4 : -3) + TOKEN_BASE_SHIFT_PX);
      token.addChild(nr);
    }
  }

  /** Owner 2026-07-06: UNIFIED over-token player-STATE markers (replaces the old
   *  per-state addDistractedMarker). One glyph per active state, drawn on the torso
   *  (off the head, where it collided with skill/active badges) and stacked
   *  horizontally so several states don't overlap. Rebuilt each refresh from the
   *  live state — no separate lifecycle, exactly like the original CONFUSED "?":
   *   • CONFUSED (still standing) → red "?"  (Really Stupid / Bone-head / etc.)
   *   • CHOMPED (Monstrous Mouth, BB2025) → 👄
   *   • bloodlust (acting vampire) → 🩸  (passed in; not a state flag)
   *  Add new player-states HERE rather than sprinkling per-state calls. */
  private addStateMarkers(
    token: Container,
    playerState: number,
    bloodlust: boolean,
    playerId: string,
    coordinate?: [number, number],
  ): void {
    const markers: { text: string; emoji: boolean; deco: string; scale?: number; art?: 'target' | 'attacker' | 'blitzer' | 'blitzTarget'; icon?: string }[] = [];
    // A confirmed declaration and a successfully confused victim share the token-local eye.
    const confused = !isDown(playerState) && hasFlag(playerState, PlayerStateFlag.CONFUSED);
    const gazeMarked = this.gazeTarget === playerId || (confused && this.gazeVictims.has(playerId));
    if (gazeMarked) this.addGazeVictimMarker(token);
    // Owner 09-07: EYE GOUGE rides the same chest mount as the gaze eye while the server's EYE_GOUGED bit is set
    // (it clears on the victim's activation) — was a DOM overlay floating over the head.
    if (!isDown(playerState) && (playerState & EYE_GOUGED_BIT) !== 0) this.addEyeGougeMarker(token);
    if (confused && !gazeMarked) markers.push({ text: '?', emoji: false, deco: 'confused' });
    // Owner 2026-07-07: TAKE ROOT (the ROOTED state flag) → a roots/sprout emoji, surfaced
    // the same way as CONFUSED.
    // Owner 09-07: ROOTED wears the approved word art at the FEET (addRootedMarker); the 🌱 row glyph is only the
    // unloaded-art fallback. Same server flag drives both (set on Take Root, cleared with the state; replay follows).
    if (hasFlag(playerState, PlayerStateFlag.ROOTED)) {
      if (this.rootedDecoTexture) this.addRootedMarker(token);
      else markers.push({ text: '🌱', emoji: true, deco: 'rooted' });
    }
    // Owner 09-07: TEMPORARY stat decrements — Greasy Cleats (-MA), Dodgy Snack (-MA/-AV) and any other enhancement
    // the server writes into player.temporaryModifiersMap as `<STAT>-…TemporaryStatDecrementer` — surface the
    // stat-down marker on the state row for as long as the source is active (the server removes it with the drive).
    // (owner 09-07: they ride the SKILL BADGE row — see addSkillBadges — not this torso row)
    if (hasFlag(playerState, PlayerStateFlag.CHOMPED)) markers.push({ text: '👄', emoji: true, deco: 'chomped' });
    if (bloodlust) markers.push({ text: '🩸', emoji: true, deco: 'bloodlust' });
    // ⚖ SERVER-DERIVED (owner 08-19): upstream decorates the DEFENDER while a block result
    // applies — PlayerIconFactory draws DECORATION_BLOCK_HOME/_AWAY on base BLOCKED/FALLING/
    // HIT_ON_GROUND (set by StepInitBlocking, cleared by removePlayerBlockStates; pure model
    // state, no latch). The modern marker uses a 💥 glyph.
    // Owner 09-07: NO block decorations during a BLITZ — the blitzer's own ⚡ art and the persistent blitz badges
    // already carry it; the fist + burst stay for plain blocks (blitzing = the acting player's declared action).
    const blitzing = /blitz/i.test(String((this.game?.actingPlayer as { playerAction?: string | null } | undefined)?.playerAction ?? ''));
    const blockDeco = blitzing ? null : blockedDecoration(playerState, !!this.game?.homePlaying, String(this.game?.turnMode ?? ''));
    // Owner 09-06: the target wears the front fist + red Pow burst art (💥 glyph = fallback while the art loads).
    if (blockDeco) markers.push({ text: '💥', emoji: true, deco: blockDeco, art: 'target' });
    // Owner 09-07: the ATTACKER wears NO chest fist — its over-head action marker (buildActionMarker '👊' -> the
    // attacker-fist art) already shows the block; only the target keeps its decoration.
    // Owner 09-07: the persistent BLITZ badges ride this row too — ⚡ on the blitzer's chest from the moment the blitz
    // is initiated, 🎯 (the matching thick ring) on the target's chest exactly where the block target sits; both for
    // the rest of the turn (store: blitzTokens is per-turn-key) and under the effects layer (stamps land over them).
    if (this.blitzTokens?.targetId === playerId) markers.push({ text: '🎯', emoji: true, deco: 'blitz_target', art: 'blitzTarget' });
    if (this.blitzTokens?.blitzerId === playerId) markers.push({ text: '⚡', emoji: true, deco: 'blitzer', art: 'blitzer' });
    // A pending chomp uses the action's tooth glyph (not the post-state mouth), in the
    // same token-local torso row as CONFUSED. Slightly larger so the imminent attack reads.
    if (coordinate && this.chompCue?.square[0] === coordinate[0] && this.chompCue.square[1] === coordinate[1]) {
      markers.push({ text: '🦷', emoji: true, deco: 'chompCue', scale: 1.3 });
    }
    // Owner 2026-07-08: Dodgy Snack (-MA/-AV for the drive, ate BB_Nut's cooking) now reads as
    // a PUTRID-GREEN glow on the player + a SMALL vomiting marker centred on the token — no
    // longer the oversized torso emoji it shared with the state-marker row.
    if (this.dodgySnackPlayers.has(playerId)) {
      this.addDodgySnackGlow(token);
      const vom = new Text({
        text: '🤮',
        style: { fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif', fontSize: 11 }, // owner 08-12: match the skill/status badge scale (was 13, oversized)
      });
      vom.anchor.set(0.5, 0.5);
      placeWalkerDecor(token, vom, 0, -4); // token centre (sprite body is anchored at y=-3); walkers: decor-1 units
      vom.zIndex = 51;
      token.addChild(vom);
    }
    if (markers.length === 0) return;
    const spacing = 16;
    const x0 = -((markers.length - 1) * spacing) / 2; // centre the row on the torso
    markers.forEach((m, i) => {
      // Owner 09-07: a sprite marker's size rides the decor-1 SCALE (placeWalkerDecor owns a child's scale) — the
      // stat-down icon set its height directly and drew at the full 1254 px texture (the giant AV plate).
      const art = m.art ? this.buildBlockDecorationNode(m.art) : (m.icon ? this.buildStatDownMarkerNode(m.icon) : null);
      const node = art?.node ?? this.buildStateMarkerNode(m);
      if (art) node.label = m.art === 'attacker' ? 'blockAttackerDeco' : m.art === 'blitzer' ? 'blitzerDeco' : m.art === 'blitzTarget' ? 'blitzTargetDeco' : 'blockTargetDeco';
      // torso centre (feet at y=0, head ~ -30); owner 09-06: walkers place it in decor-1 units (was ballooning zoomed).
      // Owner 09-07: a PRONE figure lies centred on its square — the row sits on the token origin (its chest), not
      // the standing torso offset (the blitz ring floated above a lying player).
      placeWalkerDecor(token, node, x0 + i * spacing, isDown(playerState) ? 0 : -16, art?.scale ?? m.scale ?? 1);
      node.zIndex = 50;
      token.addChild(node);
    });
  }

  /** Owner 09-07: the stats a player is temporarily DOWN on (MA / AV / AG / ST / PA order), read off the model's
   *  temporaryModifiersMap — every source's `<STAT>-<class>` entries ending in StatDecrementer. */
  private temporaryStatDecrements(playerId: string): string[] {
    const g = this.game;
    if (!g) return [];
    const player = [...(g.teamHome?.playerArray ?? []), ...(g.teamAway?.playerArray ?? [])].find((p) => p.playerId === playerId) as
      | { temporaryModifiersMap?: Record<string, unknown> } | undefined;
    const map = player?.temporaryModifiersMap;
    if (!map || typeof map !== 'object') return [];
    const found = new Set<string>();
    for (const v of Object.values(map)) {
      const entries = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v as Record<string, unknown>) : [];
      for (const e of entries) {
        const m = /^(MA|AV|AG|ST|PA)-.*StatDecrementer$/i.exec(String(e));
        if (m) found.add(m[1]!.toUpperCase());
      }
    }
    return ['MA', 'AV', 'AG', 'ST', 'PA'].filter((st) => found.has(st));
  }

  /** Owner 09-07: the bundled stat-down icon (assets/status/stat-down) as a 14-unit marker; null when the set has no
   *  art for that stat (AV today) — the caller falls back to the red "-AV" glyph. */
  private buildStatDownMarkerNode(icon: string | undefined): { node: Sprite; scale: number } | null {
    if (!icon) return null;
    const tex = skillIcon(icon, this.skillIconStyle);
    if (!tex) return null;
    const node = new Sprite(tex);
    node.anchor.set(0.5, 0.5);
    return { node, scale: 14 / tex.height }; // 14 units tall, aspect kept, applied through the decor scale
  }

  /** Owner 09-06: a block decoration sprite in the state-marker row. Both fists draw FIST_H units tall (the 💥
   *  glyph's height) — each scale keys to its own fist's content height and the anchor sits on the fist's centre,
   *  so the transparent padding and the target's burst (above-right, kept as drawn) never shift the fist. Null
   *  (💥 fallback) until the art has loaded. */
  private buildBlockDecorationNode(art: 'target' | 'attacker' | 'blitzer' | 'blitzTarget'): { node: Sprite; scale: number } | null { // 'attacker' kept for the action marker's texture; the chest fist is gone (09-07)
    const FIST_H = 14; // owner 09-06: 20 -> 14, read too large
    // Owner 09-07: the blitz badges honour the Appearance option — the emoji style keeps the ⚡ / 🎯 glyphs.
    if ((art === 'blitzer' || art === 'blitzTarget') && this.actionDecorationStyle !== 'art') return null;
    const tex = art === 'target' ? this.blockTargetDecoTexture
      : art === 'blitzer' ? this.blitzerDecoTexture
        : art === 'blitzTarget' ? this.blitzTargetDecoTexture
          : this.blockAttackerDecoTexture;
    if (!tex) return null;
    const node = new Sprite(tex);
    if (art === 'blitzTarget') {
      // target-ring-thick-v5 (1254x1254): visible 1114x1159 centred at (629.5, 583) — same 18 units as the block ring
      node.anchor.set(629.5 / 1254, 583 / 1254);
      return { node, scale: 18 / 1159 };
    }
    if (art === 'blitzer') {
      // blitzer.png (1536x1024): visible 1291x973 centred at (793, 512) — the action marker's 20-unit figure height
      node.anchor.set(793 / 1536, 512 / 1024);
      return { node, scale: 20 / 973 };
    }
    if (art === 'target') {
      // Owner 09-07: target-ring-thick-v5 (1312x1199): gold fist behind a THICK red reticle (reads when scaled down);
      // visible bounds 1089x1133 centred at (655, 566). Drawn TARGET_H units tall on the chest; the Blitz target
      // badge (DOM, the matching bolt ring) is sized to the same visible height.
      node.anchor.set(655 / 1312, 566 / 1199);
      return { node, scale: TARGET_H / 1133 };
    }
    // 1536x1024: fist content x 152-1380, y 22-989 (968 px)
    node.anchor.set(766 / 1536, 505.5 / 1024);
    return { node, scale: FIST_H / 968 };
  }

  /** Owner 09-07: the ROOTED word at the player's feet — rooted-yellow-wood-v4 (1942x809, visible 1924x741 centred
   *  at 969.5, 393) drawn ROOTED_H units tall by its visible bounds (~23 wide: half a tile, so it never covers the
   *  body or the neighbours). Walkers: decor-1 units 4 under the feet line through the decor scale; classic icons:
   *  under the token's local bottom. Label 'rootedMarker'; above the ring/shadow, under the state row. */
  private addRootedMarker(token: Container): void {
    const tex = this.rootedDecoTexture;
    if (!tex) return;
    const ROOTED_H = 20; // owner 09-07: decor-1 units (halved at the fit zoom) — ~10 world units tall, a touch over the BALL label
    const node = new Sprite(tex);
    node.anchor.set(969.5 / 1942, 393 / 809);
    node.label = 'rootedMarker';
    const scale = ROOTED_H / 741;
    if (isWalkerToken(token)) {
      placeWalkerDecor(token, node, 0, WALKER_FEET_Y_PX + 4, scale);
    } else {
      const bounds = token.getLocalBounds();
      node.position.set(0, bounds.maxY + 4);
      node.scale.set(scale);
    }
    node.zIndex = 49;
    token.sortableChildren = true;
    token.addChild(node);
  }

  /** Owner 09-07: the Eye Gouge marker — the status PNG (96x64) drawn 14 units tall on the chest, placed exactly
   *  like the gaze eye and kept fully lit through activation shading (label 'eyeGougeMarker'). */
  private addEyeGougeMarker(token: Container): void {
    const tex = this.eyeGougeDecoTexture;
    const node: Container = tex ? new Sprite(tex) : this.buildStateMarkerNode({ text: '👁️', emoji: true, deco: 'eyeGouge' });
    // Owner 09-07: 14 units tall like the other state markers — the size rides the decor-1 SCALE (placeWalkerDecor
    // owns a child's scale; setting height beforehand was overwritten and the 96 px texture drew full size).
    let scale = 1;
    if (node instanceof Sprite && tex) { node.anchor.set(0.5, 0.5); scale = 14 / tex.height; }
    node.label = 'eyeGougeMarker';
    this.placeChestMarker(token, node, 60, scale);
    token.sortableChildren = true;
    token.addChild(node);
  }

  /** Owner 09-07: shared chest mount for the gaze eye / eye gouge — walkers at 55% up the measured figure, classic
   *  icons just under the head envelope. */
  private placeChestMarker(token: Container, node: Container, zIndex: number, scale = 1): void {
    const body = token.children
      .filter((child): child is Sprite => child instanceof Sprite && child.label !== 'castShadow')
      .sort((a, b) => b.height - a.height)[0];
    const walkerRatio = isWalkerToken(token) ? walkerFigureRatio(token) : null;
    if (walkerRatio) {
      placeWalkerDecor(token, node, 0, WALKER_FEET_Y_PX - walkerRatio * WALKER_REFERENCE_FIGURE_PX * 0.55, scale);
    } else {
      const bodyTop = body ? body.position.y - body.height * body.anchor.y : -44.5;
      const foreheadInset = body ? Math.min(9, body.height * 0.18) : 6.5;
      node.position.set(0, bodyTop + foreheadInset);
      node.scale.set(scale);
    }
    node.zIndex = zIndex;
  }

  /** Hypnotic Gaze's eye sits up toward the head so it follows the victim without being
   *  covered by the ball when the gazed player is the carrier (owner 08-20; was -3 chest). */
  private addGazeVictimMarker(token: Container): void {
    const node = this.buildStateMarkerNode({ text: '👁️', emoji: true, deco: 'gaze' });
    node.label = 'gazeVictimMarker';
    // Follow the actual rendered body rather than a square-relative magic number. Custom
    // sprites are normalized but may have a different visible height, while Classic/checker
    // tokens are centred instead of foot-anchored. At this point the direct Sprite children
    // are the live body layers (rings/badges are containers), so the tallest one is the
    // authoritative head envelope. The fallback matches the vector player's head.
    const body = token.children
      .filter((child): child is Sprite => child instanceof Sprite && child.label !== 'castShadow') // 09-06: not the shadow
      .sort((a, b) => b.height - a.height)[0];
    // Owner 09-06: on a WALKER the sprite's height is the whole 64-unit frame (transparent padding included), which
    // floated the eye above the head — mount it on the CHEST of the measured figure instead (55% up from the feet
    // line at the current decor scale; applyDecorScale keeps it there through the zoom snap).
    // Owner 09-06 (r2): laid out in DECOR-1 units through placeWalkerDecor (the raw placement ballooned when zoomed).
    const walkerRatio = isWalkerToken(token) ? walkerFigureRatio(token) : null;
    if (walkerRatio) {
      placeWalkerDecor(token, node, 0, WALKER_FEET_Y_PX - walkerRatio * WALKER_REFERENCE_FIGURE_PX * 0.55);
    } else {
      const bodyTop = body ? body.position.y - body.height * body.anchor.y : -44.5;
      const foreheadInset = body ? Math.min(9, body.height * 0.18) : 6.5;
      node.position.set(0, bodyTop + foreheadInset);
    }
    node.zIndex = 60;
    token.sortableChildren = true;
    token.addChild(node);
  }

  /** Build the single supported emoji/glyph state-marker treatment. */
  private buildStateMarkerNode(marker: { text: string; emoji: boolean; deco: string }): Text {
    const node = new Text({
      text: marker.text,
      style: marker.emoji
        ? { fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif', fontSize: 17 }
        : { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: 20, fontWeight: 'bold', fill: 0xff5555, stroke: { color: 0x14161a, width: 3 } },
    });
    node.anchor.set(0.5, 0.5);
    return node;
  }

  /** Owner 2026-07-08: a PUTRID-GREEN glow behind a Dodgy-Snack player (they ate BB_Nut's
   *  cooking — sick for the drive). A soft body halo + a base puddle, added BEHIND the sprite
   *  so the player reads as ill at a glance. Local token space (feet ~0, body centre ~ -3). */
  private addDodgySnackGlow(token: Container): void {
    const putrid = 0x8fc31f; // bilious green
    const glow = new Graphics();
    for (const [rx, ry, alpha] of [[0.5, 0.58, 0.16], [0.4, 0.46, 0.26], [0.3, 0.34, 0.42]] as [number, number, number][]) {
      glow.ellipse(0, -6, TILE_W * rx, TILE_H * ry).fill({ color: putrid, alpha });
    }
    glow.ellipse(0, TILE_H * 0.3, TILE_W * 0.32, TILE_H * 0.15).fill({ color: putrid, alpha: 0.3 }); // base puddle
    glow.zIndex = -5;
    token.addChildAt(glow, 0); // behind everything on the token
  }

  /** FUMBBL auto-marking text (UI-6): small gold tag at the token's feet,
   *  mirroring upstream's marker text drawn onto the player icon. B2-20:
   *  zoom-relative sizing rides the same group mechanism as skill icons. */
  private addMarkingText(token: Container, player: PlayerJson, down: boolean): void {
    // Markings are compact skill glyphs. Strip separators/newlines from both
    // current per-skill settings and legacy/imported FUMBBL marking payloads.
    const marking = this.playerMarkings.get(player.playerId)?.replace(/\s+/g, '');
    if (!marking) return;
    const group = new Container();
    const tag = new Text({
      text: marking,
      style: new TextStyle({
        fontFamily: this.skillMarkingFontFamily,
        fontSize: this.skillMarkingFontSize,
        fontWeight: 'bold',
        fill: this.skillMarkingColor,
        stroke: { color: 0x14161a, width: 2 },
        wordWrap: false,
        breakWords: false,
      }),
      // Markings are routinely displayed smaller than their source texture.
      // A 2x canvas plus linear filtering/mipmaps preserves antialiased edges at
      // fit, zoomed-out, and depth-scaled pitch sizes.
      resolution: 2,
      textureStyle: { scaleMode: 'linear' },
      autoGenerateMipmaps: true,
    });
    // owner 2026-07-03 r6f: markers default to the FEET (text hangs below), but can
    // render OVER THE HEAD (text sits above) like the icons.
    if (this.markerPosition === 'head') {
      group.position.set(0, down ? -30 : -46);
      tag.anchor.set(0.5, 1);
    } else {
      group.position.set(0, down ? 6 : 2);
      tag.anchor.set(0.5, 0);
    }
    group.label = 'skillMarkings'; // owner 09-05: the BALL marker checks for feet markings by label
    group.addChild(tag);
    token.addChild(group);
    this.overlayScaleGroups.push(group);
    this.markingFit.set(group, { tag, maxWidth: SKILL_MARKING_MAX_WIDTH });
    this.applyOverlayScale(group, this.overlayZoomFactor());
  }

  /** Owner 2026-07-04: a single fading path-echo footprint at a square — sized to
   *  the tile and held at that size (grow:0), fading in place over ~600ms. Shared
   *  by the player Slide+Trail movement style and the LOOSE-BALL bounce trail. */
  private addTrailEcho(sx: number, sy: number, color: number, outline: number): void {
    const anchor = squareAnchor(sx, sy);
    // Owner 2026-07-05: half-size footprint (was 0.46×0.32 of the tile).
    const echo = new Graphics()
      .ellipse(0, -3, TILE_W * 0.23, TILE_H * 0.16)
      .fill({ color, alpha: 0.55 })
      .ellipse(0, -3, TILE_W * 0.23, TILE_H * 0.16)
      .stroke({ color: outline, width: 1.25, alpha: 0.35 });
    echo.position.set(anchor.x, anchor.y);
    echo.zIndex = TRAIL_ECHO_Z; // item1 scope-add: strictly BELOW the trail number (see TRAIL_NUMBER_Z)
    this.effectsLayer.addChild(echo);
    this.flashRings.push({ g: echo, x: anchor.x, y: anchor.y, scale: depthScale(sx, sy), start: performance.now(), grow: 0 });
  }

  /** Owner 2026-07-08: the 'numbers' movement trail — the running square count `n` at
   *  each departed square. PERSISTENT (owner): the number stays at full opacity for the
   *  whole activation (no echo/fade) and is cleared when the activation ends. */
  private addTrailNumber(sx: number, sy: number, n: number, color: number, outline: number): void {
    const anchor = squareAnchor(sx, sy);
    const label = new Text({
      text: String(n),
      style: { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: 15, fontWeight: 'bold', fill: color, stroke: { color: outline, width: 3 } },
    });
    label.anchor.set(0.5, 0.5);
    label.position.set(anchor.x, anchor.y - 3);
    label.scale.set(depthScale(sx, sy));
    label.zIndex = TRAIL_NUMBER_Z; // item1 scope-add: the digit is never occluded by a later step's echo
    this.effectsLayer.addChild(label);
    this.trailNumberNodes.push({ label, sq: [sx, sy] }); // persistent — NOT flashRings (no fade); sq drives the #194 toggle
  }

  /** Remove the persistent 'numbers' trail — the activation ended (setActivePlayer) or
   *  the game changed (clearEffects). */
  private deferTrailNumber(playerId: string, sq: [number, number], n: number, color: number, outline: number): void {
    const queue = this.pendingTrailNumbers.get(playerId) ?? [];
    queue.push({ sq: [sq[0], sq[1]], n, color, outline });
    this.pendingTrailNumbers.set(playerId, queue);
  }

  /** Stamp every queued number for `playerId` — the token has arrived (or a newer move supersedes the wait). */
  private flushTrailNumbers(playerId: string): void {
    const queue = this.pendingTrailNumbers.get(playerId);
    if (!queue) return;
    this.pendingTrailNumbers.delete(playerId);
    for (const { sq, n, color, outline } of queue) this.addTrailNumber(sq[0], sq[1], n, color, outline);
  }

  private clearTrailNumbers(): void {
    this.pendingTrailNumbers.clear();
    for (const { label } of this.trailNumberNodes) { label.parent?.removeChild(label); label.destroy(); }
    this.trailNumberNodes = [];
  }

  private updateTrailNumberVisibility(): void {
    for (const { label, sq } of this.trailNumberNodes) {
      label.visible = !this.playersBySquare.has(`${sq[0]},${sq[1]}`);
    }
  }

  /** #150 (owner g759): the PLOTTED-PREVIEW move number — the total movement count in the BOTTOM-RIGHT
   *  corner of a traveled square on the o66 automove plan. Unlike addTrailNumber (centred,
   *  PERSISTENT, on effectsLayer — the server-frame trail of EXECUTED moves), this is a per-frame
   *  plot affordance: the caller draws it each redrawOverlays into pathLayer (cleared each pass),
   *  so no clear bookkeeping is owed. Coloured to the plot trail (0x66ccff) with a dark stroke for
   *  contrast on any tile; corner offset is depth-scaled so it tracks the tile size in perspective. */
  private buildPlotStepNumber(sx: number, sy: number, n: number): Text {
    const a = this.tokenPos(sx, sy);
    const ds = depthScale(sx, sy);
    const label = new Text({
      text: String(n),
      style: { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: 13, fontWeight: 'bold', fill: 0x66ccff, stroke: { color: 0x08233a, width: 3 } },
    });
    label.anchor.set(0.5, 0.5);
    // bottom-right corner of the tile, pulled slightly inward (0.4) so the glyph stays on the square
    label.position.set(a.x + TILE_W * 0.4 * ds, a.y + TILE_H * 0.4 * ds);
    label.scale.set(ds);
    label.alpha = 0.95;
    return label;
  }

  /** #107 (owner v0.3.7): drop the persistent movement-trail numbers at TURN END.
   *  The 'numbers' trail is otherwise cleared only when the NEXT activation begins
   *  (setActivePlayer) or on a game change (clearEffects), so the last mover's numbers
   *  LINGER past their own turn into the between-turns / opponent view. The VIEW calls
   *  this when it consumes the RECEIVED server `turnEnd` report — ⚖ server-derived, NO
   *  local timer; ffb-pitch stays game-logic-free (it has no concept of a "turn"). */
  clearMoveTrail(): void {
    this.moveTrailCount.clear();
    this.clearTrailNumbers();
  }

  /** B3-3: builds the movement tween for the active moveStyle. slide/trail
   *  take one segment; walk/hop step through each intermediate square
   *  (straight-line raster between the two squares — live per-square moves
   *  arrive one square at a time anyway). */
  /** Owner 2026-07-06: flag a player's NEXT move as a Jump/Leap — it arcs the
   *  sprite over the intervening square(s) rather than sliding flat. Consumed once. */
  markLeap(playerId: string, sound?: string): void {
    this.pendingLeaps.set(playerId, { sound, at: performance.now() }); // #92 Inc-2: stash the boing sound; fired at the leap-arc launch
  }
  /** Owner 2026-07-07: flag a FAILED leap (server destination == origin) — the next
   *  setGame hops the sprite straight up and back down in the same square. Consumed once. */
  /** Owner 09-09: the one-shot leap flag → the arc + pacing every move-tween builder applies (startMoveTween, the
   *  o66 whole-route tween, the presentation drain's per-tile tween). The 'boing' fires HERE at the LAUNCH (#92
   *  Inc-2). A flag older than LEAP_PENDING_TTL_MS is dropped, never applied. */
  private consumePendingLeap(playerId: string): { arc: number; segmentMs: number } | null {
    const pending = this.pendingLeaps.get(playerId);
    if (!pending) return null;
    this.pendingLeaps.delete(playerId);
    if (performance.now() - pending.at > LEAP_PENDING_TTL_MS) return null;
    if (pending.sound) this.onCue?.(pending.sound);
    return { arc: LEAP_ARC_PX, segmentMs: leapSegmentMs() };
  }

  markLeapInPlace(playerId: string): void {
    this.pendingLeapInPlace.add(playerId);
  }
  /** Owner 2026-07-07 (TTM): flag a thrown/kicked player's next move to HOP along this
   *  explicit scatter path (square list incl. start + end). Consumed once. */
  markScatter(playerId: string, path: [number, number][]): void {
    this.pendingScatter.set(playerId, { path, start: performance.now() }); // re-armed each setGame
  }

  /** Single projectile-throw entry (owner 2026-07-14 — folds the pass / Throw-Team-Mate / bomb rails into
   *  ONE path, mirroring upstream AnimationSequenceThrowing's per-type factory). Class-D presentation: pure
   *  visual, driven from the wire Animation's from→to on an OWN clock, fail-safe (the model already placed
   *  the ball/player at the destination). Dispatch by kind:
   *   - `pass` / `punt` → arc the live BALL token to where the model now sits (pendingBallThrow ball-arc engine).
   *   - `throwTeamMate` → arc the THROWN player's token from→to (pendingTtmThrow, keyed by thrownId).
   *   - `throwBomb` / `throwARock` / `throwKeg` → arc a CREATED projectile sprite from→to (no field token
   *     exists for these) via a self-contained ticker (like playExplosion). The terminal bombExplosion is a
   *     separate wire animation and fires on its own. */
  playThrow(kind: ThrowKind, from: [number, number], to: [number, number], thrownId?: string, sound?: string): void {
    // #92 Inc-2: fire the throw sound at the RELEASE beat — every kind launches its arc from this call. Name
    // relayed from the store/view (ffb-pitch stays sound-agnostic; I play the name I'm given, not a mapping).
    if (sound) this.onCue?.(sound);
    switch (kind) {
      case 'pass':
        this.retirePassBallFlight(undefined, false);
        {
          const throwState = { from, to, start: performance.now(), durationMs: ballThrowArcMs(kind) };
          this.pendingBallThrow = throwState;
          this.startPassBallFlight(throwState);
        }
        break;
      case 'punt':
        this.retirePassBallFlight(undefined, false);
        {
          const throwState = { from, to, start: performance.now(), durationMs: ballThrowArcMs(kind) };
          this.pendingBallThrow = throwState;
          this.startPassBallFlight(throwState);
        }
        break;
      case 'throwTeamMate':
        if (thrownId) {
          // BB2025 sends TWO wire throwTeamMate Animations for one throw: the long flight, then
          // (same or next command) a short landing-settle hop for the SAME thrownId. Restarting
          // the arc for the second event truncated the visible flight to a sliver — the owner
          // sighting (g866 2026-08-17, throws at 22:29:33/22:30:36): "the thrown player teleports",
          // no flight ever visibly plays. EXTEND the existing arc's destination instead, keeping
          // the ORIGINAL origin + clock, so the token flies one continuous arc from pickup to the
          // true final landing square.
          const now = performance.now();
          const active = this.pendingTtmThrow.get(thrownId);
          if (active && now - active.start < presentationMs(TTM_THROW_MS)) {
            this.pendingTtmThrow.set(thrownId, { from: active.from, to, start: active.start });
          } else {
            this.pendingTtmThrow.set(thrownId, { from, to, start: now });
          }
        }
        break;
      case 'throwBomb':
      case 'throwARock':
      case 'throwKeg':
        this.arcProjectileSprite(kind, from, to);
        break;
    }
  }

  /**
   * Pass/Hail Mary/Punt presentation is independent of refresh(): a dedicated effects-layer ball advances on the
   * Pixi ticker, while a wall-clock timer unconditionally retires it even if rendering is throttled or the
   * authoritative destination is off-pitch. The model/store has already advanced and is never gated here.
   */
  private startPassBallFlight(
    throwState: { from: [number, number]; to: [number, number]; start: number; durationMs: number },
  ): void {
    const app = this.app;
    let token: Container | null = null;
    let tick: (() => void) | null = null;

    if (app) {
      const p0 = squareAnchor(throwState.from[0], throwState.from[1]);
      const p1 = squareAnchor(throwState.to[0], throwState.to[1]);
      const ball = new Container();
      const br = BALL_SPRITE_SIZE * 0.5;
      const ballDot = this.ballTexture
        ? this.sizedBallSprite(BALL_SPRITE_SIZE)
        : new Graphics().ellipse(0, 0, br, br * 0.78).fill(COLORS.ball).stroke({ color: 0x5a3a1a, width: 1 });
      ball.addChild(this.buildBallGlow(), ballDot);
      ball.position.set(p0.x, p0.y);
      ball.scale.set(depthScale(throwState.to[0], throwState.to[1]));
      ball.zIndex = 99000;
      this.effectsLayer.addChild(ball);
      if (this.renderedBall) this.renderedBall.visible = false;
      token = ball;

      tick = () => {
        if (this.passBallFlight?.throwState !== throwState || ball.destroyed) return;
        const flightT = (performance.now() - throwState.start) / throwState.durationMs;
        if (flightT >= 1) { this.retirePassBallFlight(throwState); return; }
        const easedT = 1 - (1 - flightT) * (1 - flightT); // same `slide` ease as the kickoff move tween
        const pos = kickArcTweenPosition(p0, p1, easedT, flightT);
        ball.position.set(pos.x, pos.y);
      };
    }

    const retireTimer = this.scheduleTimer(() => this.retirePassBallFlight(throwState), throwState.durationMs);
    this.passBallFlight = { throwState, app, token, tick, retireTimer };
    if (tick) app!.ticker.add(tick);
  }

  /** kickDescend-style wall-clock cleanup, scoped so an older timer cannot retire a newer pass. */
  private retirePassBallFlight(
    expected?: NonNullable<PitchRenderer['pendingBallThrow']>,
    notifyComplete = true,
  ): void {
    const flight = this.passBallFlight;
    if (!flight || (expected && flight.throwState !== expected)) return;
    this.cancelTimer(flight.retireTimer);
    if (flight.tick) flight.app?.ticker.remove(flight.tick);
    if (flight.token && !flight.token.destroyed) {
      flight.token.parent?.removeChild(flight.token);
      flight.token.destroy({ children: true });
    }
    this.passBallFlight = null;
    if (this.pendingBallThrow === flight.throwState) this.pendingBallThrow = null;
    if (this.renderedBall && !this.renderedBall.destroyed) this.renderedBall.visible = true;
    if (notifyComplete) this.onAnimDone?.('throw', '__ball__');
  }

  /** Arc a CREATED projectile sprite from→to on its own clock (bomb/rock/keg — no field token to move).
   *  Self-contained like playExplosion: a procedural sprite on effectsLayer + a ticker that flies it along a
   *  parabolic arc, tumbling, then removes it. Collapse-proof by construction (model-independent). */
  private arcProjectileSprite(kind: 'throwBomb' | 'throwARock' | 'throwKeg', from: [number, number], to: [number, number]): void {
    if (!this.app || !isOnPitch(from) || !isOnPitch(to)) return;
    const p0 = squareAnchor(from[0], from[1]);
    const p1 = squareAnchor(to[0], to[1]);
    const d0 = depthScale(from[0], from[1]);
    const d1 = depthScale(to[0], to[1]);
    const gfx = this.makeProjectile(kind);
    gfx.zIndex = 99000;
    this.effectsLayer.addChild(gfx);
    const start = performance.now();
    // Bomb/keg retain their local 700ms flight; only throw-a-rock shares the
    // owner-tunable cinematic timing used by playRockThrow and the injury gate.
    const FLIGHT_MS = kind === 'throwARock' ? PIPELINE_TIMINGS.rockThrow.flightMs : presentationMs(700);
    const app = this.app;
    let cleanup: () => void = () => {};
    const tick = (): void => {
      const t = (performance.now() - start) / FLIGHT_MS;
      if (t >= 1 || this.app !== app || gfx.destroyed) { cleanup(); return; }
      const depth = d0 + (d1 - d0) * t;
      const x = p0.x + (p1.x - p0.x) * t;
      const y = (p0.y + (p1.y - p0.y) * t) - KICK_ARC_PX * Math.sin(Math.PI * t) * depth;
      gfx.position.set(x, y);
      gfx.scale.set(depth);
      gfx.rotation += 0.35;
    };
    cleanup = this.registerEffectTicker(app, tick, [gfx]);
  }

  /** Procedural projectile icon (no bundled asset): bomb = dark sphere + lit fuse spark; rock = grey
   *  boulder; keg = brown barrel. Anchored at centre so it tumbles about itself while flying. */
  private makeProjectile(kind: 'throwBomb' | 'throwARock' | 'throwKeg'): Graphics {
    const g = new Graphics();
    const r = TILE_W * 0.26;
    if (kind === 'throwARock') {
      g.circle(0, 0, r).fill({ color: 0x8a8a8a }).stroke({ color: 0x5a5a5a, width: 1.5 });
      g.circle(-r * 0.3, -r * 0.3, r * 0.28).fill({ color: 0xb0b0b0, alpha: 0.6 });
    } else if (kind === 'throwKeg') {
      g.roundRect(-r * 0.8, -r, r * 1.6, r * 2, r * 0.4).fill({ color: 0x7a4a1e }).stroke({ color: 0x4a2c10, width: 1.5 });
      g.rect(-r * 0.8, -r * 0.35, r * 1.6, r * 0.2).fill({ color: 0xcfcfcf, alpha: 0.8 });
      g.rect(-r * 0.8, r * 0.15, r * 1.6, r * 0.2).fill({ color: 0xcfcfcf, alpha: 0.8 });
    } else { // throwBomb
      g.circle(0, 0, r).fill({ color: 0x1a1a1a }).stroke({ color: 0x000000, width: 1 });
      g.circle(-r * 0.35, -r * 0.35, r * 0.28).fill({ color: 0x4a4a4a, alpha: 0.7 }); // sheen
      g.moveTo(0, -r).lineTo(r * 0.35, -r * 1.5).stroke({ color: 0x6b4a2a, width: 2 }); // fuse
      g.circle(r * 0.35, -r * 1.5, r * 0.18).fill({ color: 0xffb020 }); // spark
    }
    return g;
  }
  /** Owner 2026-07-08 (case 419): TRICKSTER relocate — slide the player's token from→to as a low
   *  step (no arc). Re-armed each setGame like markTtmThrow; consumed when the step duration elapses. */
  markTrickster(playerId: string, from: [number, number], to: [number, number]): void {
    this.pendingTrickster.set(playerId, { from, to, start: performance.now() });
  }

  /** TTM increment 1 (owner 2026-07-07): HOLD a thrown mate JOINED with the thrower in its square.
   *  refresh() then RUNS the held mate from its own square into the thrower's square (ground level,
   *  shrunk — NOT a piggyback), mirroring FFB updateThrownPlayer, until clearTtmHeld() (the throw)
   *  or a game change. The run + hold are re-armed each setGame with one clock, so they survive the
   *  per-frame token rebuilds. `fromSquare` = the mate's square at pickup (the run origin). */
  markTtmHeld(thrownId: string, throwerId: string, fromSquare?: [number, number] | null): void {
    // #247: prefer the caller's PRE-pickup square. Under o66 immediate-apply the mate's MODEL
    // coordinate is already the thrower's square by watcher time, so a self-read collapses the
    // run to a snap; the live arm passes the mate's pre-pickup coord (preCoords). Fallback to the
    // model read for the demo/paced path (backward-compatible — old 2-arg callers unchanged).
    let from = fromSquare && isOnPitch(fromSquare) ? ([fromSquare[0], fromSquare[1]] as [number, number]) : null;
    if (!from) {
      const mate = this.game?.fieldModel.playerDataArray.find((d) => d.playerId === thrownId);
      const mc = mate?.playerCoordinate;
      from = isOnPitch(mc ?? null) ? ([mc![0], mc![1]] as [number, number]) : null;
    }
    this.ttmHeld = { thrownId, throwerId, start: performance.now(), fromSquare: from };
    this.refresh(); // arm the pickup glide onto the thrower immediately
  }

  /** TTM (owner 2026-07-07): release the held mate — the throw. refresh() then renders it at
   *  its own coordinate again (the caller starts the throw arc / places it at the aim). */
  clearTtmHeld(): void {
    if (!this.ttmHeld) return;
    this.ttmHeld = null;
    this.refresh();
  }

  /** Owner 2026-07-07 (queue #1): WITHHOLD a player's move on the next/current setGame
   *  — a batched follow/stay frame carries the follow-up move AND the dialog together,
   *  so the store defers the attacker's move until the follow/stay indicator reads. The
   *  token stays pinned at its previous square (tween suppressed) until releaseMove().
   *  Spectator-only; idempotent. */
  deferMove(playerId: string): void {
    this.deferredMoves.add(playerId);
  }

  /** Release a deferred move: clear the flag and re-render so the withheld previous→new
   *  delta tweens NOW (refresh keeps in-flight tweens; lastSquares was held at previous).
   *  No-op if the player wasn't deferred. */
  releaseMove(playerId: string): void {
    if (!this.deferredMoves.delete(playerId)) return;
    this.refresh();
  }

  /** Begin a bounded visual first stride for an accepted local movement command. The authoritative model is not
   * touched. A matching confirmed PresentationStep completes the square; an unanswered intent rolls the token
   * back to the model after a short fail-safe window. */
  setMovementIntent(intent: MovementIntent | null): void {
    if (intent) this.cancelPostStepConvergence(intent.playerId);
    if (intent && this.movementReconcileFence?.playerId === intent.playerId) {
      if (intent.occurrenceId <= this.movementReconcileFence.occurrenceId) return;
      const pending = this.reconciliationTimers.get(intent.playerId);
      if (pending) { this.cancelTimer(pending.timer); this.reconciliationTimers.delete(intent.playerId); }
      if (this.moveTweens.get(intent.playerId)?.reconcileKey) this.moveTweens.delete(intent.playerId);
      this.movementReconcileFence = null;
    }
    if (intent?.seq === this.movementIntent?.seq
        && intent?.playerId === this.movementIntent?.playerId
        && intent?.from[0] === this.movementIntent?.from[0] && intent?.from[1] === this.movementIntent?.from[1]
        && intent?.to[0] === this.movementIntent?.to[0] && intent?.to[1] === this.movementIntent?.to[1]) return;
    const prior = this.movementIntent;
    if (prior) {
      const priorTween = this.moveTweens.get(prior.playerId);
      if (priorTween?.movementIntent?.seq === prior.seq) this.moveTweens.delete(prior.playerId);
    }
    this.cancelTimer(this.movementIntentTimer);
    this.cancelTimer(this.movementIntentRollbackTimer);
    this.movementIntentTimer = null;
    this.movementIntentRollbackTimer = null;
    if (!intent && this.movementIntent) {
      // A failed roll is authoritative presentation ownership of the attempted square. Clearing that settled
      // occurrence (reroll success/failure, turn end, or reconnect teardown) must retire the local tween without
      // snapping the token back through its origin. The next authoritative model refresh remains free to place it.
      if (this.movementIntent.failureConfirmed) this.retireConfirmedMovementIntent();
      else this.rollbackMovementIntent();
      return;
    }
    this.movementIntent = intent ? {
      playerId: intent.playerId,
      from: [intent.from[0], intent.from[1]],
      to: [intent.to[0], intent.to[1]],
      movementUsedBefore: intent.movementUsedBefore,
      awaitsRoll: intent.awaitsRoll,
      failureConfirmed: intent.failureConfirmed,
      latencyObserved: intent.latencyObserved,
      sentAt: intent.sentAt,
      expectedRttMs: intent.expectedRttMs,
      occurrenceId: intent.occurrenceId,
      seq: intent.seq,
    } : null;
    this.movementIntentStartedSeq = -1;
    if (!this.movementIntent) return;
    // Only the accepted, roll-free 0→1 edge gets latency masking. Later edges already have a paced presentation
    // cursor and must not jump ahead of it. Dodge/Rush/Pickup keep waiting for server authority; a confirmed failure
    // projects only on the legacy/no-drain path, where it remains the sole mover for the attempted tile.
    const anticipatesFirstStep = this.movementIntent.movementUsedBefore === 0
      && !this.movementIntent.awaitsRoll && !this.movementIntent.failureConfirmed;
    if (anticipatesFirstStep || this.movementIntent.failureConfirmed) {
      this.movementIntentTimer = this.scheduleTimer(() => {
        this.movementIntentTimer = null;
        this.armMovementIntentIfReady();
      }, 0);
    }
    if (!this.movementIntent.failureConfirmed) {
      const seq = this.movementIntent.seq;
      this.movementIntentRollbackTimer = this.scheduleTimer(() => {
        this.movementIntentRollbackTimer = null;
        if (this.movementIntent?.seq !== seq) return;
        this.rollbackMovementIntent();
      }, Math.min(2000, Math.max(MOVEMENT_INTENT_ROLLBACK_MS, this.movementIntent.expectedRttMs * 4)));
    }
  }

  /** A movement reroll boundary is stronger than the generic walk gate. The store has already applied the server
   * coordinate, so retire only owners carrying this occurrence and bridge the token's current pixels to truth.
   * This is presentation-only: no model field, planner state, or outbound command is touched. */
  reconcileMovementPresentation(fence: MovementPresentationFence): void {
    const { playerId, coordinate } = fence;
    const currentIntentOccurrence = this.movementIntent?.playerId === playerId
      ? this.movementIntent.occurrenceId : undefined;
    const currentStepOccurrence = this.presentationStep?.playerId === playerId
      ? this.presentationStep.occurrenceId : undefined;
    const currentTween = this.moveTweens.get(playerId);
    const currentTweenOccurrence = currentTween?.movementIntent?.occurrenceId
      ?? currentTween?.psStep?.occurrenceId;
    const newerOwner = [currentIntentOccurrence, currentStepOccurrence, currentTweenOccurrence]
      .some((occurrence) => occurrence !== undefined && occurrence > fence.occurrenceId);
    if (newerOwner) return; // a late pulse from occurrence N must never retire N+1
    this.cancelPostStepConvergence(playerId);

    if (currentIntentOccurrence !== undefined && currentIntentOccurrence <= fence.occurrenceId) {
      this.cancelTimer(this.movementIntentTimer);
      this.cancelTimer(this.movementIntentRollbackTimer);
      this.movementIntentTimer = null;
      this.movementIntentRollbackTimer = null;
      this.movementIntent = null;
      this.movementIntentStartedSeq = -1;
    }
    if (currentTweenOccurrence !== undefined && currentTweenOccurrence <= fence.occurrenceId) this.moveTweens.delete(playerId);
    const route = this.o66MovePath.get(playerId);
    if (route?.occurrenceId !== undefined && route.occurrenceId <= fence.occurrenceId) this.o66MovePath.delete(playerId);
    if (currentStepOccurrence !== undefined && currentStepOccurrence <= fence.occurrenceId) {
      this.presentationStep = null;
      this.presentationTileStart = 0;
      this.presentationTileStartPending = false;
      this.presentationStepConsumed = null;
    }
    if (this.movementPresentationCursor?.playerId === playerId
        && this.movementPresentationCursor.step.occurrenceId !== undefined
        && this.movementPresentationCursor.step.occurrenceId <= fence.occurrenceId) {
      this.movementPresentationCursor = null;
    }
    this.movementReconcileFence = fence;
    if (coordinate) this.lastSquares.set(playerId, [coordinate[0], coordinate[1]]);
    if (coordinate) this.scheduleAuthoritativeReconciliation(
      playerId,
      coordinate,
      `movement:${fence.occurrenceId}:${fence.seq}`,
      fence.expectedRttMs,
    );
    else this.scheduleTimer(() => this.refresh(), 0); // post-flush compartment renderer owns placement
    this.redrawOverlays();
  }

  /** Fail-open recovery for a walk gate whose renderer acknowledgement was lost. The payload identifies only the
   * stale owner; coordinate/compartment truth is read from the latest setGame model at consumption time. */
  reconcileMovementPresentationRecovery(recovery: MovementPresentationRecovery): void {
    if (recovery.seq <= this.movementPresentationRecoverySeqSeen) return;
    if (this.currentPostStepGameId() !== recovery.gameId) {
      this.movementPresentationRecoverySeqSeen = recovery.seq;
      return;
    }
    const data = this.game?.fieldModel.playerDataArray.find(({ playerId }) => playerId === recovery.playerId);
    const raw = data?.playerCoordinate;
    const coordinate = data && raw && isOnPitch(raw) && rendersOnPitch(data.playerState)
      ? [raw[0], raw[1]] as [number, number]
      : null;
    this.reconcileMovementPresentation({
      playerId: recovery.playerId,
      coordinate,
      occurrenceId: recovery.occurrenceId,
      phase: 'resolved',
      expectedRttMs: recovery.expectedRttMs,
      seq: recovery.seq,
    });
    this.movementPresentationRecoverySeqSeen = recovery.seq;
  }

  /** Turn end is a board-wide presentation fence. The authoritative model is already committed, but Vue's
   * post-flush setGame still has to rebuild pitch/dugout tokens. Capture the visible generation now, retire only
   * movement-presentation ownership, then reconcile after that rebuild. A player never glides across the stadium:
   * pitch↔dugout and removed/ejected transitions remain owned by the normal injury/send-off refresh path. */
  reconcileBoardPresentation(fence: BoardPresentationFence): void {
    if (fence.seq <= this.boardReconcileSeqSeen) return;
    this.boardReconcileSeqSeen = fence.seq;
    this.cancelTimer(this.boardReconciliationTimer);
    this.boardReconciliationTimer = null;
    this.cancelAllBoardProtectedRechecks();
    const gameId = this.currentPostStepGameId();

    const snapshots = new Map<string, {
      x: number;
      y: number;
      compartment: PlayerPresentationCompartment;
      protectedTween: object | null;
    }>();
    for (const player of fence.players) {
      const pitchToken = this.tokensById.get(player.playerId);
      const dugoutToken = this.dugoutTokensById.get(player.playerId);
      const token = pitchToken ?? dugoutToken;
      if (!token || token.destroyed) continue;
      const tween = this.moveTweens.get(player.playerId);
      snapshots.set(player.playerId, {
        x: token.position.x,
        y: token.position.y,
        compartment: this.renderedPlayerCompartment(player.playerId),
        // Leap/throw/hop and deferred escort presentations are authoritative effects, not stale walking owners.
        protectedTween: tween && !tween.psStep && !tween.movementIntent && !tween.reconcileKey
          && !tween.postStepCorrectionKey
          && (tween.arc != null || tween.style === 'hop' || tween.style === 'hoptrail')
          ? tween
          : null,
      });
    }

    // A turn boundary ends the prior activation even if a walk gate missed its renderer completion callback.
    this.cancelTimer(this.movementIntentTimer);
    this.cancelTimer(this.movementIntentRollbackTimer);
    this.movementIntentTimer = null;
    this.movementIntentRollbackTimer = null;
    this.movementIntent = null;
    this.movementIntentStartedSeq = -1;
    this.presentationStep = null;
    this.presentationTileStart = 0;
    this.presentationTileStartPending = false;
    this.presentationStepConsumed = null;
    this.movementPresentationCursor = null;
    this.pendingTrailNumbers.clear();
    this.o66MovePath.clear();
    for (const [playerId, tween] of [...this.moveTweens]) {
      if (tween.psStep || tween.movementIntent || tween.reconcileKey || tween.postStepCorrectionKey) this.moveTweens.delete(playerId);
    }
    for (const [playerId, pending] of [...this.reconciliationTimers]) {
      this.cancelTimer(pending.timer);
      this.reconciliationTimers.delete(playerId);
    }
    this.cancelAllPostStepConvergence();

    // setGame is a post-flush watcher. A zero-delay owned timer therefore observes the newly-built token and its
    // resolved dugout slot, while retaining the exact pixels the user saw at the boundary.
    this.boardReconciliationTimer = this.scheduleTimer(() => {
      this.boardReconciliationTimer = null;
      if (!this.boardFenceStillCurrent(fence.seq, gameId)) return;
      let needsRebuild = false;
      for (const player of fence.players) {
        const prior = snapshots.get(player.playerId);
        const current = this.currentPlayerPresentation(player.playerId);
        const targetCompartment = current
          ? this.playerPresentationCompartment(current.coordinate, current.playerState)
          : 'removed';
        if (prior?.protectedTween && this.moveTweens.get(player.playerId) === prior.protectedTween) {
          this.scheduleBoardProtectedRecheck(
            player.playerId,
            prior.protectedTween,
            fence.seq,
            gameId,
            fence.expectedRttMs,
          );
          continue;
        }
        const expectedRenderedCompartment = this.expectedRenderedCompartment(targetCompartment);
        const renderedNow = this.renderedPlayerCompartment(player.playerId);
        const tokenMissing = expectedRenderedCompartment === 'pitch'
          ? !this.tokensById.get(player.playerId)
          : expectedRenderedCompartment !== 'removed' && !this.dugoutTokensById.get(player.playerId);
        if (renderedNow !== expectedRenderedCompartment || tokenMissing) {
          needsRebuild = true;
          continue;
        }
      }

      // Compartment transitions are discontinuities. One authoritative rebuild repairs pitch↔dugout, dugout box,
      // removed/ejected, and missing-token drift without ever gliding a player through the stadium.
      if (needsRebuild) this.refresh();
      if (!this.boardFenceStillCurrent(fence.seq, gameId)) return;

      for (const player of fence.players) {
        const prior = snapshots.get(player.playerId);
        if (!prior || prior.protectedTween) continue;
        const current = this.currentPlayerPresentation(player.playerId);
        const targetCompartment = current
          ? this.playerPresentationCompartment(current.coordinate, current.playerState)
          : 'removed';
        const expectedRenderedCompartment = this.expectedRenderedCompartment(targetCompartment);
        if (expectedRenderedCompartment !== targetCompartment) continue;
        const renderedNow = this.renderedPlayerCompartment(player.playerId);
        if (prior.compartment !== targetCompartment || renderedNow !== targetCompartment) continue;
        if (targetCompartment === 'removed' || targetCompartment === 'banned') continue;
        const token = targetCompartment === 'pitch'
          ? this.tokensById.get(player.playerId)
          : this.dugoutTokensById.get(player.playerId);
        if (!token || token.destroyed) continue;
        const target = targetCompartment === 'pitch' && current?.coordinate
          ? this.tokenPos(current.coordinate[0], current.coordinate[1])
          : { x: token.position.x, y: token.position.y }; // refresh resolved this compartment's current slot
        if (Math.hypot(target.x - prior.x, target.y - prior.y) <= 0.5) continue;
        token.position.set(prior.x, prior.y);
        this.startTokenReconciliation(
          player.playerId,
          token,
          target,
          `board:${fence.seq}:${player.playerId}`,
          fence.expectedRttMs,
        );
      }
      this.redrawOverlays();
    }, 0);
  }

  private cancelAllBoardProtectedRechecks(): void {
    for (const pending of this.boardProtectedRechecks.values()) this.cancelTimer(pending.timer);
    this.boardProtectedRechecks.clear();
  }

  private boardFenceStillCurrent(fenceSeq: number, gameId: string | null): boolean {
    return !this.destroyed
      && this.boardReconcileSeqSeen === fenceSeq
      && this.currentPostStepGameId() === gameId;
  }

  private currentPlayerPresentation(playerId: string): {
    coordinate: [number, number] | null;
    playerState: number;
  } | null {
    const data = this.game?.fieldModel.playerDataArray.find((player) => player.playerId === playerId);
    if (!data) return null;
    return {
      coordinate: data.playerCoordinate ? [data.playerCoordinate[0], data.playerCoordinate[1]] : null,
      playerState: data.playerState,
    };
  }

  private expectedRenderedCompartment(
    targetCompartment: PlayerPresentationCompartment,
  ): PlayerPresentationCompartment {
    return !this.dugoutsEnabled && targetCompartment !== 'pitch' ? 'removed' : targetCompartment;
  }

  private scheduleBoardProtectedRecheck(
    playerId: string,
    protectedTween: object,
    fenceSeq: number,
    gameId: string | null,
    expectedRttMs: number,
  ): void {
    const tween = this.moveTweens.get(playerId);
    if (!tween || tween !== protectedTween) return;
    const totalMs = Math.max(0, (tween.waypoints.length - 1) * tween.segmentMs);
    const remainingMs = Math.max(0, totalMs - (performance.now() - tween.start));
    // One frame after expected completion lets the ticker retire healthy animation first. Background throttling or
    // a lost ticker can never hold the board beyond the 750ms recovery boundary.
    const delayMs = Math.min(750, Math.max(16, Math.ceil(remainingMs) + 16));
    const key = `${gameId ?? 'none'}:${fenceSeq}:${playerId}`;
    const prior = this.boardProtectedRechecks.get(playerId);
    if (prior) this.cancelTimer(prior.timer);
    const timer = this.scheduleTimer(() => {
      const pending = this.boardProtectedRechecks.get(playerId);
      if (pending?.key !== key || pending.tween !== protectedTween) return;
      this.boardProtectedRechecks.delete(playerId);
      if (!this.boardFenceStillCurrent(fenceSeq, gameId)) return;
      const currentTween = this.moveTweens.get(playerId);
      if (currentTween !== protectedTween) return; // a newer animation owns the token

      const current = this.currentPlayerPresentation(playerId);
      const targetCompartment = current
        ? this.playerPresentationCompartment(current.coordinate, current.playerState)
        : 'removed';
      const expectedRenderedCompartment = this.expectedRenderedCompartment(targetCompartment);
      const renderedNow = this.renderedPlayerCompartment(playerId);
      const token = expectedRenderedCompartment === 'pitch'
        ? this.tokensById.get(playerId)
        : this.dugoutTokensById.get(playerId);
      const tokenMissing = expectedRenderedCompartment !== 'removed' && (!token || token.destroyed);

      // Retire only the exact stale tween captured by this fence. A rebuild owns discontinuous transitions.
      this.moveTweens.delete(playerId);
      if (renderedNow !== expectedRenderedCompartment || tokenMissing) {
        this.refresh();
        this.redrawOverlays();
        return;
      }
      if (expectedRenderedCompartment !== 'pitch' || !current?.coordinate || !token || token.destroyed) return;
      const target = this.tokenPos(current.coordinate[0], current.coordinate[1]);
      this.startTokenReconciliation(
        playerId,
        token,
        target,
        `board-cap:${fenceSeq}:${playerId}`,
        expectedRttMs,
      );
      this.redrawOverlays();
    }, delayMs);
    this.boardProtectedRechecks.set(playerId, { key, timer, tween: protectedTween, gameId, fenceSeq });
  }

  private renderedPlayerCompartment(playerId: string): PlayerPresentationCompartment {
    const pitch = this.tokensById.get(playerId);
    if (pitch && !pitch.destroyed) return 'pitch';
    const dugout = this.dugoutTokensById.get(playerId);
    if (!dugout || dugout.destroyed) return 'removed';
    return this.dugoutCompartmentById.get(playerId) ?? 'removed';
  }

  private playerPresentationCompartment(
    coordinate: [number, number] | null,
    playerState: number,
  ): PlayerPresentationCompartment {
    if (coordinate && isOnPitch(coordinate) && rendersOnPitch(playerState)) return 'pitch';
    switch (baseState(playerState)) {
      case PlayerStateBase.KNOCKED_OUT: return 'ko';
      case PlayerStateBase.BADLY_HURT:
      case PlayerStateBase.SERIOUS_INJURY:
      case PlayerStateBase.RIP: return 'cas';
      case PlayerStateBase.RESERVE:
      case PlayerStateBase.MISSING:
      case PlayerStateBase.PRONE:
      case PlayerStateBase.SETUP_PREVENTED: return 'reserve';
      case PlayerStateBase.BANNED: return 'banned';
      default: return coordinate ? 'pitch' : 'removed';
    }
  }

  private currentPostStepGameId(): string | null {
    const gameId = (this.game as { gameId?: string | number } | null)?.gameId;
    return gameId == null ? null : String(gameId);
  }

  private postStepConvergenceKey(step: PresentationStep): string {
    return `${this.currentPostStepGameId() ?? 'none'}:${step.playerId}:${step.seq}:${step.occurrenceId ?? 'none'}`;
  }

  private authoritativePostStepStillCurrent(step: PresentationStep, gameId: string | null): boolean {
    if (this.currentPostStepGameId() !== gameId) return false;
    const data = this.game?.fieldModel.playerDataArray.find(({ playerId }) => playerId === step.playerId);
    const coordinate = data?.playerCoordinate;
    if (!data || !coordinate || !isOnPitch(coordinate) || !rendersOnPitch(data.playerState)) return false;
    return coordinate[0] === step.to[0]
      && coordinate[1] === step.to[1];
  }

  /** Complete the ordinary psStep branch after the ticker has written its final waypoint. Keeping the deferred
   * endpoint check here makes the production completion seam directly testable without duplicating ticker state. */
  private finishPresentationStepTween(
    playerId: string,
    tween: { psStep?: PresentationStep },
    end: { x: number; y: number },
  ): void {
    // #67 phase-1 (Tarkin, DD-3): the tile tween reached its VISUAL end → release exactly this step's gate.
    this.flushTrailNumbers(playerId); // owner 09-05: the piece has arrived — NOW the square's number appears
    const completedStep = tween.psStep;
    this.notePresentationTweenComplete(tween); // step-stutter: this tile is animated OUT — never replay it
    this.adCompletedMotionTargets.set(playerId, { x: end.x, y: end.y });
    if (playerId !== '__ball__') this.onAnimDone?.('walk', playerId, completedStep?.seq);
    this.moveTweens.delete(playerId);
    if (completedStep) this.schedulePostStepConvergence(completedStep);
    this.armMovementIntentIfReady();
  }

  private hasNewerPostStepOwner(step: PresentationStep, key: string): boolean {
    const currentStep = this.presentationStep;
    if (currentStep?.playerId === step.playerId) {
      const sameOccurrence = step.occurrenceId !== undefined && currentStep.occurrenceId !== undefined
        ? this.postStepConvergenceKey(currentStep) === key
        : currentStep === step;
      if (!sameOccurrence) return true;
    }
    if (this.movementIntent?.playerId === step.playerId) return true;
    if (this.reconciliationTimers.has(step.playerId)) return true;
    const tween = this.moveTweens.get(step.playerId);
    if (tween && tween.postStepCorrectionKey !== key) return true;
    if (this.o66MovePath.has(step.playerId)) return true;
    return false;
  }

  /** Verify the live Pixi anchor one task after a completed server step. The authoritative target here is the
   * delivered tile, not the possibly-ahead final model coordinate. This is a presentation-only fail-open and never
   * emits a movement completion, trail, sound, counter, or outbound command. */
  private schedulePostStepConvergence(step: PresentationStep): void {
    this.cancelPostStepConvergence(step.playerId);
    const key = this.postStepConvergenceKey(step);
    const gameId = this.currentPostStepGameId();
    const timer = this.scheduleTimer(() => {
      const pending = this.postStepConvergenceById.get(step.playerId);
      if (!pending || pending.key !== key) return;
      this.postStepConvergenceById.delete(step.playerId);
      if (!this.authoritativePostStepStillCurrent(step, gameId) || this.hasNewerPostStepOwner(step, key)) return;
      const token = this.tokensById.get(step.playerId);
      if (!token || token.destroyed) return;
      const target = this.tokenPos(step.to[0], step.to[1]);
      const distance = Math.hypot(target.x - token.position.x, target.y - token.position.y);
      if (distance <= 1) return;
      const segmentMs = Math.min(120, Math.max(45, Math.round(45 + distance * 0.35)));
      this.moveTweens.set(step.playerId, {
        token,
        waypoints: [{ x: token.position.x, y: token.position.y }, target],
        style: 'slide',
        start: performance.now(),
        segmentMs,
        easeOut: false,
        postStepCorrectionKey: key,
      });
      const cap = this.scheduleTimer(() => this.completePostStepCorrection(step.playerId, key), segmentMs + 32);
      this.postStepConvergenceById.set(step.playerId, { key, step, gameId, timer: cap });
    }, 0);
    this.postStepConvergenceById.set(step.playerId, { key, step, gameId, timer });
  }

  private completePostStepCorrection(playerId: string, key: string): void {
    const pending = this.postStepConvergenceById.get(playerId);
    if (pending?.key === key) {
      this.cancelTimer(pending.timer);
      this.postStepConvergenceById.delete(playerId);
    }
    const tween = this.moveTweens.get(playerId);
    if (tween?.postStepCorrectionKey !== key) return;
    const end = tween.waypoints.at(-1);
    if (end && !tween.token.destroyed) {
      tween.token.position.set(end.x, end.y);
      this.followTokenDecorations(playerId, end.x, end.y);
    }
    this.moveTweens.delete(playerId);
  }

  private cancelPostStepConvergence(playerId: string): void {
    const pending = this.postStepConvergenceById.get(playerId);
    if (pending) {
      this.cancelTimer(pending.timer);
      this.postStepConvergenceById.delete(playerId);
      const tween = this.moveTweens.get(playerId);
      if (tween?.postStepCorrectionKey === pending.key) this.moveTweens.delete(playerId);
    }
  }

  private cancelAllPostStepConvergence(): void {
    for (const playerId of [...this.postStepConvergenceById.keys()]) this.cancelPostStepConvergence(playerId);
  }

  private suspendPostStepConvergenceForRefresh(): Array<{
    key: string;
    step: PresentationStep;
    gameId: string | null;
  }> {
    const pending = [...this.postStepConvergenceById.values()].map(({ key, step, gameId }) => ({ key, step, gameId }));
    this.cancelAllPostStepConvergence();
    return pending;
  }

  private resumePostStepConvergenceAfterRefresh(pendingSteps: Array<{
    key: string;
    step: PresentationStep;
    gameId: string | null;
  }>): void {
    for (const pending of pendingSteps) {
      if (this.authoritativePostStepStillCurrent(pending.step, pending.gameId)
          && !this.hasNewerPostStepOwner(pending.step, pending.key)) {
        this.schedulePostStepConvergence(pending.step);
      }
    }
  }

  private scheduleAuthoritativeReconciliation(
    playerId: string,
    coordinate: [number, number],
    key: string,
    expectedRttMs: number,
  ): void {
    const visible = this.tokensById.get(playerId);
    const start = visible && !visible.destroyed
      ? { x: visible.position.x, y: visible.position.y }
      : null;
    const prior = this.reconciliationTimers.get(playerId);
    if (prior) this.cancelTimer(prior.timer);
    const timer = this.scheduleTimer(() => {
      const pending = this.reconciliationTimers.get(playerId);
      if (pending?.key !== key) return;
      this.reconciliationTimers.delete(playerId);
      const token = this.tokensById.get(playerId);
      if (!token || token.destroyed) { this.refresh(); return; }
      const target = this.tokenPos(coordinate[0], coordinate[1]);
      // Vue's post-flush model rebuild may already have placed a fresh token at truth. Restore only the exact
      // pixels visible when the fence arrived, then bridge forward; never revisit the movement origin.
      if (start && Math.hypot(target.x - start.x, target.y - start.y) > 0.5) {
        token.position.set(start.x, start.y);
        this.followTokenDecorations(playerId, start.x, start.y);
      }
      this.startTokenReconciliation(playerId, token, target, key, expectedRttMs);
    }, 0);
    this.reconciliationTimers.set(playerId, { key, timer });
  }

  private startTokenReconciliation(
    playerId: string,
    token: Container,
    target: { x: number; y: number },
    key: string,
    expectedRttMs: number,
  ): void {
    const prior = this.reconciliationTimers.get(playerId);
    if (prior) { this.cancelTimer(prior.timer); this.reconciliationTimers.delete(playerId); }
    const start = { x: token.position.x, y: token.position.y };
    const distance = Math.hypot(target.x - start.x, target.y - start.y);
    if (distance <= 0.5) return; // already authoritative: do not touch the token or manufacture a tween
    const tileA = this.tokenPos(0, 0);
    const tileB = this.tokenPos(1, 0);
    const tileDistance = Math.max(1, Math.hypot(tileB.x - tileA.x, tileB.y - tileA.y));
    const distanceFactor = Math.min(2, Math.max(0.25, distance / tileDistance));
    const segmentMs = Math.min(180, Math.max(45, Math.round(expectedRttMs * 0.55 + distanceFactor * 35)));
    this.moveTweens.set(playerId, {
      token,
      waypoints: [start, target],
      style: 'slide',
      start: performance.now(),
      segmentMs,
      easeOut: false,
      reconcileKey: key,
    });
    const timer = this.scheduleTimer(
      () => this.completeAuthoritativeReconciliation(playerId, key),
      segmentMs + 32,
    );
    this.reconciliationTimers.set(playerId, { key, timer });
  }

  private completeAuthoritativeReconciliation(playerId: string, key: string): void {
    const pending = this.reconciliationTimers.get(playerId);
    if (pending?.key === key) {
      this.cancelTimer(pending.timer);
      this.reconciliationTimers.delete(playerId);
    }
    const tween = this.moveTweens.get(playerId);
    if (tween?.reconcileKey === key) {
      const end = tween.waypoints.at(-1);
      if (end && !tween.token.destroyed) {
        tween.token.position.set(end.x, end.y);
        this.followTokenDecorations(playerId, end.x, end.y);
      }
      this.moveTweens.delete(playerId);
    }
  }

  private armMovementIntentIfReady(): void {
    const intent = this.movementIntent;
    const anticipatesFirstStep = intent?.movementUsedBefore === 0 && !intent.awaitsRoll && !intent.failureConfirmed;
    if (!intent || (!anticipatesFirstStep && !intent.failureConfirmed)
        || this.movementIntentStartedSeq === intent.seq) return;
    if (intent.failureConfirmed && this.confirmedMovementPresentationEnabled) return;
    const confirmed = this.moveTweens.get(intent.playerId);
    if (confirmed?.psStep) return;
    const currentStep = this.presentationStep;
    if (currentStep?.playerId === intent.playerId && this.presentationStepConsumed !== currentStep) return;
    const token = this.tokensById.get(intent.playerId);
    if (!token || token.destroyed) return;
    const from = this.tokenPos(intent.from[0], intent.from[1]);
    const to = this.tokenPos(intent.to[0], intent.to[1]);
    const tileDistance = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    // A later command can be accepted while the prior confirmed tile is still on screen. Never jump across that
    // visual seam; completion calls this method again once the token actually reaches the new intent's origin.
    if (Math.hypot(token.position.x - from.x, token.position.y - from.y) > tileDistance * 0.12) return;
    // Successful anticipation begins at the exact live token position so accepting a plan never produces a small
    // launch jump. Legacy failed-roll projection retains its prompt response and moves toward the attempted square.
    const initial = intent.failureConfirmed ? {
      x: from.x + (to.x - from.x) * MOVEMENT_INTENT_INITIAL_PROGRESS,
      y: from.y + (to.y - from.y) * MOVEMENT_INTENT_INITIAL_PROGRESS,
    } : { x: token.position.x, y: token.position.y };
    const hold = {
      x: from.x + (to.x - from.x) * (intent.failureConfirmed ? 1 : MOVEMENT_INTENT_HOLD_PROGRESS),
      y: from.y + (to.y - from.y) * (intent.failureConfirmed ? 1 : MOVEMENT_INTENT_HOLD_PROGRESS),
    };
    token.position.set(initial.x, initial.y);
    this.followTokenDecorations(intent.playerId, initial.x, initial.y);
    this.moveTweens.set(intent.playerId, {
      token,
      waypoints: [initial, hold],
      style: 'slide',
      start: performance.now(),
      // Fill the measured wire interval instead of racing to the hold point and visibly waiting there. The
      // authoritative confirmation can pre-empt this tween at any time.
      segmentMs: Math.min(180, Math.max(30, Math.round(intent.expectedRttMs))),
      easeOut: false,
      movementIntent: intent,
    });
    this.movementIntentStartedSeq = intent.seq;
  }

  private projectFailedMovementDestination(): void {
    const intent = this.movementIntent;
    if (!intent?.failureConfirmed) return;
    if (this.confirmedMovementPresentationEnabled) return;
    const token = this.tokensById.get(intent.playerId);
    if (!token || token.destroyed) return;
    const to = this.tokenPos(intent.to[0], intent.to[1]);
    token.position.set(to.x, to.y);
    this.followTokenDecorations(intent.playerId, to.x, to.y);
  }

  private rollbackMovementIntent(): void {
    const intent = this.movementIntent;
    if (!intent) return;
    const tween = this.moveTweens.get(intent.playerId);
    if (tween?.movementIntent?.seq === intent.seq) this.moveTweens.delete(intent.playerId);
    const token = this.tokensById.get(intent.playerId);
    const data = this.game?.fieldModel.playerDataArray.find((entry) => entry.playerId === intent.playerId);
    const model = data?.playerCoordinate as [number, number] | undefined;
    const square = model && model[0] >= 0 && model[0] < 26 && model[1] >= 0 && model[1] < 15
      ? model : intent.from;
    if (token && !token.destroyed) {
      const p = this.tokenPos(square[0], square[1]);
      token.position.set(p.x, p.y);
      this.followTokenDecorations(intent.playerId, p.x, p.y);
    }
    this.movementIntent = null;
    this.movementIntentStartedSeq = -1;
  }

  /** Retire a server-confirmed failed-roll projection in place. Unlike an unanswered local intent this is not a
   * rollback: the destination is the visual site of the reroll/fall, and model refresh owns every later move. */
  private retireConfirmedMovementIntent(): void {
    const intent = this.movementIntent;
    if (!intent) return;
    const tween = this.moveTweens.get(intent.playerId);
    if (tween?.movementIntent?.occurrenceId === intent.occurrenceId) this.moveTweens.delete(intent.playerId);
    const token = this.tokensById.get(intent.playerId);
    if (token && !token.destroyed) {
      const to = this.tokenPos(intent.to[0], intent.to[1]);
      token.position.set(to.x, to.y);
      this.followTokenDecorations(intent.playerId, to.x, to.y);
    }
    this.movementIntent = null;
    this.movementIntentStartedSeq = -1;
  }

  /** #67 phase-1 (Tarkin): the view feeds the store's CURRENT presentation step here — a watch on
   *  gameStore.state.presentationStep(.seq) calls setPresentationStep(gameStore.state.presentationStep). We
   *  stash it and arm an existing live token directly: the store's per-tile advance doesn't change the
   *  (already immediate-applied) model, so nothing else would trigger the redraw. null clears the drive → the
   *  next refresh falls back to the model draw (the model already sits on the final square, so no snap). */
  setPresentationStep(step: PresentationStep | null): void {
    if (step) {
      const pending = this.postStepConvergenceById.get(step.playerId);
      const sameOccurrence = pending && step.occurrenceId !== undefined && pending.step.occurrenceId !== undefined
        ? pending.key === this.postStepConvergenceKey(step)
        : pending?.step === step;
      if (pending && !sameOccurrence) {
        this.cancelPostStepConvergence(step.playerId);
      }
    }
    if (step && this.movementReconcileFence?.playerId === step.playerId
        && step.occurrenceId !== undefined) {
      if (step.occurrenceId <= this.movementReconcileFence.occurrenceId) return;
      const pending = this.reconciliationTimers.get(step.playerId);
      if (pending) { this.cancelTimer(pending.timer); this.reconciliationTimers.delete(step.playerId); }
      if (this.moveTweens.get(step.playerId)?.reconcileKey) this.moveTweens.delete(step.playerId);
      this.movementReconcileFence = null;
    }
    if (step === this.presentationStep) {
      if (!step) return;
      const token = this.tokensById.get(step.playerId);
      if (!token || token.destroyed) {
        this.refresh();
        return;
      }
      if (this.presentationStepConsumed === step) {
        this.redrawPresentationStep(step, token);
        return;
      }
      if (this.moveTweens.get(step.playerId)?.psStep !== step) this.armPresentationStepTween(step, token);
      return;
    }
    if (step?.rollPending) {
      this.o66MovePath.delete(step.playerId);
      this.cancelTimer(this.movementIntentTimer);
      this.cancelTimer(this.movementIntentRollbackTimer);
      this.movementIntentTimer = null;
      this.movementIntentRollbackTimer = null;
      this.movementIntent = null;
      this.movementIntentStartedSeq = -1;
      this.moveTweens.delete(step.playerId);
      this.presentationTileStart = 0;
      this.presentationTileStartPending = false;
      this.presentationStepConsumed = null;
      this.presentationStep = step;
      this.movementPresentationCursor = {
        playerId: step.playerId,
        coordinate: [step.from[0], step.from[1]],
        movementUsed: Math.max(0, Number(step.movementUsedBefore) || 0),
        step,
      };
      const token = this.tokensById.get(step.playerId);
      if (token && !token.destroyed) {
        const from = this.tokenPos(step.from[0], step.from[1]);
        token.position.set(from.x, from.y);
        this.followTokenDecorations(step.playerId, from.x, from.y);
        this.lastSquares.set(step.playerId, [step.from[0], step.from[1]]);
        this.redrawOverlays();
        return;
      }
      this.refresh();
      return;
    }
    // Fresh tile clock whenever a NEW step object arrives (object identity, NOT seq value — the store resets
    // seq to 1 each run, so a seq key collides across runs and reuses a stale clock = instant-snap speedup).
    // The first tween-processing pass supplies the only clock stamp, so a pre-draw stall cannot consume it.
    if (step && step !== this.presentationStep) {
      // A confirmed store step is the sole driver for this actor. Retire any locally predicted whole-route path
      // so setPresentationStep(null) cannot fall back to it and yank the token to the route origin.
      this.o66MovePath.delete(step.playerId);
      this.presentationTileStart = 0;
      this.presentationTileStartPending = true;
      // #67-r1 (owner 07-17): the number/echo movement trail must ride EACH presented step (paced WITH the
      // stagger), because the #67 snapshot-draw path replaced beginO66MoveAnim's whole-route emit and dropped
      // it (the #65 keep-requirement). Once per delivered tile, using the store's running stepIndex for the
      // number — so the count survives the feeder swap without moveTrailCount. Acting player only (phase-1
      // presentationStep is the acting mover) → no pushed-player number artifacting.
      // ⚑ #186 (owner RULED = ENTERED-anchored, MN-1 reversed): the ECHO (fading footprint) stays on the square
      // DEPARTED (step.from) — a footprint is left BEHIND — but the NUMBER now rides the square ENTERED (step.to),
      // so the origin is bare and the first traveled square reads 1 (matching the planner preview above). On the
      // intermediate squares the number still visually coincides with an echo (a square's echo arrives on the
      // NEXT tile, when it is departed); only the origin (echo, no number) and destination (number, no echo)
      // differ. Non-trail styles + the ball emit nothing.
      if (step.playerId !== '__ball__' && (step.style === 'trail' || step.style === 'hoptrail')) {
        const trailColor = this.resolveTrailColor();
        const outline = trailColor === 0xffffff ? 0x000000 : 0xffffff;
        this.addTrailEcho(step.from[0], step.from[1], trailColor, outline);
        if (this.trailMarkStyle === 'numbers') {
          // #119 (owner), amended owner 08-17: the trail NUMBER is fed by the store's `step.number`. Originally
          // gated to OWN-SIDE moves only (opponent walks got `null`); the owner flagged that an opponent's
          // echoed move shows no step numbers, so the store now sources `step.number` from the server-sent
          // actingPlayerSetCurrentMove value for WHICHEVER side is presented (still side-agnostic here — the
          // renderer just draws what it's fed). `undefined` (store field not present yet) → legacy stepIndex so
          // there's NO regression before the store feed lands; `null` → draw no number (still possible if the
          // store withholds one, e.g. mid-transition).
          // #107 clearMoveTrail() drops these at the received turnEnd frame (same trail window).
          const n = step.number === undefined ? step.stepIndex : step.number;
          // #186: paint the number on the square ENTERED (step.to), not the square departed (step.from).
          if (n !== null) {
            this.flushTrailNumbers(step.playerId); // a newer step: whatever was still queued has visibly landed
            this.deferTrailNumber(step.playerId, step.to, n, trailColor, outline); // stamped when the tween ends
            // #194 ①: the ORIGIN square is numbered 0. In the streamed trail the origin is the FIRST step's
            // `from` (its count is 1); stamp 0 there once. The per-frame occupancy toggle hides it while the
            // player still stands on it, so the 0 only appears after the mover has left the origin.
            // item1 (owner 08-18, spectate): the gate was literally `n === 1`, which ONLY ever matches an
            // ordinary walk's first square. A block FOLLOW-UP is a FREE step — upstream does not increment
            // actingPlayer.currentMove for it (StepFollowUp never calls setCurrentMove), so the store feeds
            // `number = currentMove` = 0 after a plain block (or the unchanged blitz count after a blitz).
            // n was therefore never 1, the origin never got stamped, and the follow-up's ONLY visible square
            // — the one it VACATED — carried the echo alone while every walk square carries echo + number.
            // That is exactly the owner's "follow-up shows the echo pulse instead of the trail number".
            // Gate instead on "nothing stamped yet this activation" (moveTrailCount is cleared per activation
            // by setActivePlayer/clearMoveTrail), and stamp the movement ALREADY USED on arriving (n-1, floored
            // at 0 — same `used + index` scheme as the planner preview). An ordinary walk is byte-identical:
            // its first step has n === 1 and an empty count, so it still stamps 0.
            if ((this.moveTrailCount.get(step.playerId) ?? 0) === 0) {
              this.addTrailNumber(step.from[0], step.from[1], Math.max(0, n - 1), trailColor, outline);
            }
            this.moveTrailCount.set(step.playerId, Math.max(n, 1)); // origin stamped for this activation
          }
        }
      }
      // #92 (owner, supersedes #60): fire the animation-tied sound AT THE RENDERED movement beat, not at
      // model-apply. The server-derived sound NAME rides the presentation snapshot (step.sound) and we play it
      // here — inside the object-identity gate, so it fires ONCE per delivered tile (Meero MSC-2 per-instance
      // dedup, the 33e15c8f anchor), and TERMINAL-ONLY on a collapsed run (collapse delivers only the terminal
      // step) (MSC-3). ffb-pitch stays sound-AGNOSTIC: onCue is bound to gameStore.playSound by the view.
      // GROUP A only (MSC-1) — the movement/arc beats we actually render in o66 play; block/injury/casualty
      // sounds have no renderer beat here (cines gated off in play) and ride the store display beat instead.
      if (step.sound) this.onCue?.(step.sound);
      // effectsLayer survives refresh; retain the one per-tile refresh side effect needed by numbered trails.
      this.updateTrailNumberVisibility();
    }
    const priorCursor = this.movementPresentationCursor;
    this.presentationStep = step;
    if (step) {
      const before = Number(step.movementUsedBefore);
      const carriedBefore = priorCursor?.playerId === step.playerId
        && priorCursor.coordinate[0] === step.from[0] && priorCursor.coordinate[1] === step.from[1]
        ? priorCursor.movementUsed
        : 0;
      this.movementPresentationCursor = {
        playerId: step.playerId,
        coordinate: [step.from[0], step.from[1]],
        movementUsed: Number.isFinite(before) ? Math.max(0, before) : carriedBefore,
        step,
      };
      this.redrawOverlays();
    } else {
      this.movementPresentationCursor = null;
      this.redrawOverlays();
    }
    if (!step) {
      this.presentationTileStart = 0;
      this.presentationTileStartPending = false;
      this.presentationStepConsumed = null; // step-stutter: the drive is retired — drop the consumed marker with it
    }
    const token = step ? this.tokensById.get(step.playerId) : null;
    if (step && token && !token.destroyed) {
      this.armPresentationStepTween(step, token);
      return;
    }
    this.refresh();
  }

  /** step-stutter (owner 08-18, live 0.3.20n): draw the acting mover from the store's frozen step during a scene
   *  rebuild. TWO cases, and conflating them is the whole defect:
   *   • IN FLIGHT — re-arm the tile on its ORIGINAL clock (the 72b2d3c5 recovery path, unchanged).
   *   • ALREADY ANIMATED OUT — HOLD the token on the square the tile actually delivered (`step.to`). It must not
   *     re-arm (`token.position.set(from)` + an already-elapsed tween = a 1-frame backward yank then a snap, plus
   *     a duplicate onAnimDone the store's (kind,id)-keyed gate cannot distinguish), and it must not fall through
   *     to the model draw either — o66 immediate-apply already sits at the run's FINAL square, which is the
   *     forward race 72b2d3c5 was landed to kill. Holding at `to` is a no-op against what the tween just drew, so
   *     a refresh in the inter-tile gap becomes invisible for the mover, which is the point. */
  private redrawPresentationStep(step: PresentationStep, token: Container): void {
    if (step.rollPending) {
      this.moveTweens.delete(step.playerId);
      const p = this.tokenPos(step.from[0], step.from[1]);
      token.position.set(p.x, p.y);
      this.lastSquares.set(step.playerId, [step.from[0], step.from[1]]);
      return;
    }
    if (this.presentationStepConsumed !== step) { this.armPresentationStepTween(step, token); return; }
    const p = this.tokenPos(step.to[0], step.to[1]);
    token.position.set(p.x, p.y);
    this.lastSquares.set(step.playerId, [step.to[0], step.to[1]]);
  }

  /** step-stutter: mark a tile tween's step consumed at its VISUAL end (ticker completion branch only). */
  private notePresentationTweenComplete(tween: { psStep?: PresentationStep }): void {
    const step = tween.psStep;
    if (!step) return;
    this.presentationStepConsumed = step;
    if (this.presentationStep !== step) return;
    const after = Number(step.movementUsedAfter);
    const before = this.movementPresentationCursor?.step === step
      ? this.movementPresentationCursor.movementUsed
      : Math.max(0, Number(step.movementUsedBefore) || 0);
    this.movementPresentationCursor = {
      playerId: step.playerId,
      coordinate: [step.to[0], step.to[1]],
      movementUsed: Number.isFinite(after) ? Math.max(0, after) : before + 1,
      step,
    };
    // Same synchronous completion branch that has already snapped the token to `to`: commit reach/d6 now,
    // begin fading removed squares, then let onAnimDone release the store gate.
    this.redrawOverlays();
  }

  /** Arm one store-paced tile without rebuilding the scene. Shared with refresh's rebuild recovery path. */
  private armPresentationStepTween(step: PresentationStep, token: Container): void {
    if (step.rollPending) {
      this.moveTweens.delete(step.playerId);
      const p = this.tokenPos(step.from[0], step.from[1]);
      token.position.set(p.x, p.y);
      this.lastSquares.set(step.playerId, [step.from[0], step.from[1]]);
      return;
    }
    const p0 = this.tokenPos(step.from[0], step.from[1]);
    const p1 = this.tokenPos(step.to[0], step.to[1]);
    const intent = this.movementIntent;
    const matchingIntent = intent?.playerId === step.playerId
      && intent.from[0] === step.from[0] && intent.from[1] === step.from[1]
      && intent.to[0] === step.to[0] && intent.to[1] === step.to[1];
    let start = p0;
    let segmentMs = Math.max(1, step.segMs ?? this.moveStepMs);
    if (matchingIntent) {
      // Continue from the visual stride already shown instead of snapping back to the square origin. Scale the
      // confirmed remainder so anticipation makes the tile faster, never slower.
      start = { x: token.position.x, y: token.position.y };
      const fullDistance = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
      const remaining = Math.min(1, Math.max(0, Math.hypot(p1.x - start.x, p1.y - start.y) / fullDistance));
      segmentMs = Math.max(20, Math.round(segmentMs * remaining));
      this.cancelTimer(this.movementIntentTimer);
      this.cancelTimer(this.movementIntentRollbackTimer);
      this.movementIntentTimer = null;
      this.movementIntentRollbackTimer = null;
      this.movementIntent = null;
      this.movementIntentStartedSeq = -1;
    }
    // Owner 09-09: a Jump / Leap / Pogo tile arcs over the crossed square(s) with the 'boing' at launch — the
    // drain used to build a flat walk tween here, so the arc and the sound were lost in o66 play.
    const leap = this.leapSteps.has(step)
      ? { arc: LEAP_ARC_PX, segmentMs: leapSegmentMs() }
      : this.consumePendingLeap(step.playerId);
    if (leap) this.leapSteps.add(step);
    this.moveTweens.set(step.playerId, {
      token,
      waypoints: [start, p1],
      style: step.style,
      start: this.presentationTileStart,
      segmentMs: leap ? leap.segmentMs : segmentMs,
      easeOut: !step.flowToNext,
      ...(leap ? { arc: leap.arc } : {}),
      psStep: step, // step-stutter: the ticker marks THIS step consumed at its visual end
    });
    token.position.set(start.x, start.y);
    this.lastSquares.set(step.playerId, [step.to[0], step.to[1]]);
  }

  /** Stamp a presentation tile on its first actual tween-processing pass, never at delivery. */
  private anchorPresentationTileOnFirstTweenPass(
    id: string,
    tween: { start: number },
    now: number,
  ): void {
    const step = this.presentationStep;
    if (!this.presentationTileStartPending || !step || id !== step.playerId) return;
    this.presentationTileStart = now;
    this.presentationTileStartPending = false;
    tween.start = now;
  }

  /** Legacy no-confirmed-step fallback: begin a full-path walk animation for `playerId`. A confirmed
   *  presentation step synchronously retires this path before taking ownership of the token. */
  beginO66MoveAnim(playerId: string, route: [number, number][]): void {
    if (!route || route.length < 1) { this.o66MovePath.delete(playerId); return; }
    const cur = this.lastSquares.get(playerId);
    const first = route[0]!;
    const full = cur && (first[0] !== cur[0] || first[1] !== cur[1]) ? [cur, ...route] : route.slice();
    if (full.length < 2) { this.o66MovePath.delete(playerId); return; }
    const occurrenceId = this.movementIntent?.playerId === playerId ? this.movementIntent.occurrenceId : undefined;
    this.o66MovePath.set(playerId, {
      squares: full.map(([x, y]) => [x, y] as [number, number]),
      start: performance.now(),
      occurrenceId,
    });
    // #67-r1 (owner 07-17): the whole-route trail echo/number emit that ONCE lived here (#3 move-styles) is
    // REMOVED — under #67 the acting player's o66-play walk is presented tile-by-tile through the drain, and
    // the trail is now emitted PER PRESENTED STEP in setPresentationStep (paced WITH the stagger, the owner's
    // design). Keeping it here too would DOUBLE the marks on a Space-confirmed walk (this whole-route emit at
    // confirm + the per-step emit during the drain). The o66MovePath set above stays as the coalesced-jump /
    // pre-#67 motion fallback; its (rare) trail is a follow-up if that path ever bites in practice.
  }

  private startMoveTween(
    playerId: string,
    token: Container,
    from: [number, number],
    to: [number, number],
    arc?: number,
    segmentMsOverride?: number,
  ): void {
    // Owner 2026-07-06: a flagged Jump/Leap arcs the sprite over the jumped
    // square(s). We lift with a single whole-flight arc (the kick's `arc` path,
    // not the per-tile hop) and pace it a touch slower so the jump reads as a
    // deliberate spring rather than a normal step. Consumes the one-shot flag.
    const leap = playerId !== '__ball__' ? this.consumePendingLeap(playerId) : null;
    if (leap) {
      arc = leap.arc;
      segmentMsOverride ??= leap.segmentMs;
    }
    const style = playerId === '__ball__' ? 'slide' : this.moveStyle;
    const waypoints: { x: number; y: number }[] = [];
    const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
    const perTile = style === 'walk' || style === 'hop' || style === 'hoptrail';
    const isPlayer = playerId !== '__ball__';
    // Owner 2026-07-06: a PLAYER move that jumps >1 square in a SINGLE frame (frames
    // coalesced / fast-forwarded under backlog) still animates THROUGH each square,
    // not a single straight glide — otherwise it reads as a teleport. Reconstruct a
    // per-tile stepped path (the model only carries the final square, so the path is
    // the straight run of intervening tiles) and pace it per-tile.
    // #55 (owner 07-16): the BALL gets the same per-tile stepping so every hop BEATS (STEP_BEAT_MS) and the eye
    // can track a scatter / coalesced ball move instead of a single fast slide. GATED per Meero stage-2:
    // (C-1) ONLY arc-less PLAIN slides — `arc==null && segmentMsOverride==null` — so the tuned kick fly-in /
    //       leap / throw parabolas (which pass an arc + their own segmentMs) are left EXACTLY as-is;
    // (C-2) ONLY a COLLINEAR straight run (horizontal / vertical / diagonal) so a non-traversed placement or
    //       award jump isn't beat through a FABRICATED straight path — it keeps the single slide (⚖: never
    //       invent geometry the server didn't state).
    const dxB = to[0] - from[0], dyB = to[1] - from[1];
    const ballStraightRun =
      !isPlayer && arc == null && segmentMsOverride == null && steps > 1 &&
      (dxB === 0 || dyB === 0 || Math.abs(dxB) === Math.abs(dyB));
    const stepThrough = perTile || (isPlayer && steps > 1) || ballStraightRun;
    const count = stepThrough ? steps : 1;
    for (let i = 0; i <= count; i++) {
      const sx = Math.round(from[0] + ((to[0] - from[0]) * i) / count);
      const sy = Math.round(from[1] + ((to[1] - from[1]) * i) / count);
      // players ease to their nudged token position; the ball keeps the raw anchor
      const p = isPlayer ? this.tokenPos(sx, sy) : squareAnchor(sx, sy);
      waypoints.push({ x: p.x, y: p.y });
    }
    if (style === 'trail' || style === 'hoptrail') {
      // path echoes: fading dots along the traversed squares (effects layer).
      // Owner 2026-07-04: white by default (flips to black on a light background,
      // configurable), 3× bigger + a contrasting outline so the trail reads clearly.
      const trailColor = this.resolveTrailColor();
      const outline = trailColor === 0xffffff ? 0x000000 : 0xffffff;
      // Leave an echo at every DEPARTED square (origin + intermediates, i=0..steps-1).
      // Live/paced moves arrive one square at a time (steps===1) — starting at i=1
      // produced ZERO echoes for those, so the trail never showed in normal play;
      // i=0 leaves an echo at the square the player just left even for a 1-step move.
      // Owner 2026-07-04: sized to the SQUARE it occurred in (tile footprint) and
      // held at that size (grow:0) — a footprint that fades in place, not a ring
      // that balloons past the tile.
      const numbers = this.trailMarkStyle === 'numbers' && isPlayer;
      // Owner 2026-07-08: movement NUMBERS count the ACTIVE player's own move only —
      // a PUSHED (non-active) player leaving a square must not drop a number
      // (artifacting). In numbers mode a non-active mover leaves NOTHING.
      // W45 (owner, spectate numbers fix): this.activePlayerId is fed by a SEPARATE
      // store-derived watch (B9-2's ACTIVE-bit/movingId/acting fallback chain) that can
      // legitimately sit null while the model's own actingPlayer already identifies the
      // mover (this path — vanilla startMoveTween — is ONLY reachable when order66 is
      // OFF, i.e. spectate/Classic; o66 play numbers ride the separate store-gated
      // setPresentationStep path and never touch this code, so this fallback cannot
      // regress play-mode's own-side-only numbering). Fall back to the live model field
      // so a not-yet-derived activePlayerId doesn't blank every square's number.
      const liveActingId = (this.game?.actingPlayer as { playerId?: string | null } | undefined)?.playerId ?? null;
      const activeId = this.activePlayerId ?? liveActingId;
      const skipForPush = numbers && playerId !== activeId;
      if (!skipForPush) {
        if (numbers) {
          // ⚑ #186 (ENTERED-anchored, 1-based) + ⚑ #194 (owner v3): number the square ENTERED (i=1..steps), and
          // additionally number the ORIGIN `0`. moveTrailCount persists across paced 1-step tweens (cleared per
          // activation), so an unset count marks THIS activation's first tween — stamp 0 at its `from` (the origin)
          // once. The per-frame occupancy toggle (refresh) hides any digit under the piece, so the 0 shows only
          // after the mover leaves the origin. Both surfaces agree (planner + this trail).
          if ((this.moveTrailCount.get(playerId) ?? 0) === 0) {
            this.addTrailNumber(from[0], from[1], 0, trailColor, outline); // #194 ①: origin = 0
          }
          for (let i = 1; i <= steps; i++) {
            const sx = Math.round(from[0] + ((to[0] - from[0]) * i) / steps);
            const sy = Math.round(from[1] + ((to[1] - from[1]) * i) / steps);
            const n = (this.moveTrailCount.get(playerId) ?? 0) + 1;
            this.moveTrailCount.set(playerId, n);
            this.deferTrailNumber(playerId, [sx, sy], n, trailColor, outline); // owner 09-05: stamped at the tween's end
          }
        } else {
          // Echoes stay on every DEPARTED square (origin + intermediates, i=0..steps-1) — a footprint is left
          // BEHIND. i=0 leaves an echo even for a paced 1-step move (steps===1), so the trail shows in normal play.
          for (let i = 0; i < steps; i++) {
            const sx = Math.round(from[0] + ((to[0] - from[0]) * i) / steps);
            const sy = Math.round(from[1] + ((to[1] - from[1]) * i) / steps);
            this.addTrailEcho(sx, sy, trailColor, outline);
          }
        }
      }
    }
    // #153 (owner 07-23): the loose-ball bounce gets +100ms so each hop reads slower. Scoped to the
    // plain ball tween (segmentMsOverride==null) — the kick fly-in / descent (which pass their own
    // segmentMs) keep their tuned pace; player moves are untouched.
    const ballBounceExtra = playerId === '__ball__' && segmentMsOverride == null ? presentationMs(BALL_BOUNCE_EXTRA_MS) : 0;
    this.moveTweens.set(playerId, {
      token,
      waypoints,
      style,
      start: performance.now(),
      // per-tile pace for stepped moves (incl. the reconstructed >1-square path). ORDER 66 M1 target 5: the
      // beat-standard STEP_BEAT_MS (300 = 3 beats) replaces the o66w 250 (fractional 2.5 beats). See the
      // STEP_BEAT_MS declaration for the §4/§57 layering + the ⚑ M4 feel-pass note.
      segmentMs: (segmentMsOverride ?? this.moveStepMs) + ballBounceExtra,
      arc,
    });
    token.position.set(waypoints[0]!.x, waypoints[0]!.y);
  }

  /** Owner 2026-07-13: continue an in-flight walk after refresh() rebuilt the token — ease from the token's
   *  CAPTURED pixel position (its visual spot mid-tween) to the CURRENT model square, so a walk survives the
   *  frequent per-sync token rebuilds instead of snapping to its destination. Paced ~STEP_BEAT_MS per tile of
   *  pixel travel (clamped) so a coord that advanced several tiles in one sync still reads as movement, not a
   *  jump. Single-segment ease; the ticker's 'walk' step-bob still applies. */
  private continueMoveTween(
    playerId: string,
    token: Container,
    fromPixel: { x: number; y: number },
    to: [number, number],
  ): void {
    const dest = this.tokenPos(to[0], to[1]);
    if (Math.abs(fromPixel.x - dest.x) < 0.5 && Math.abs(fromPixel.y - dest.y) < 0.5) {
      token.position.set(dest.x, dest.y); // already there — no tween needed
      return;
    }
    const tiles = Math.max(1, Math.hypot(dest.x - fromPixel.x, dest.y - fromPixel.y) / Math.max(1, TILE_W));
    const segmentMs = Math.min(this.moveStepMs * 3, Math.max(this.moveStepMs * 0.5, tiles * this.moveStepMs));
    this.moveTweens.set(playerId, {
      token,
      waypoints: [{ x: fromPixel.x, y: fromPixel.y }, { x: dest.x, y: dest.y }],
      style: this.moveStyle === 'slide' ? 'slide' : 'walk',
      start: performance.now(),
      segmentMs,
    });
    token.position.set(fromPixel.x, fromPixel.y);
  }

  /** B2-4/B2-20: skill icons + marking tags counter-scale with zoom so they stay
   *  legible: enlarged up to 2× when zoomed OUT, but NEVER shrunk below their base
   *  size when zoomed IN (min clamp 1, not 0.5) — otherwise the detailed icon art
   *  stayed a tiny constant screen size and was unreadable even zoomed in (owner). */
  private overlayZoomFactor(): number {
    const current = this.world.scale.x || 1;
    return Math.min(2, Math.max(1, this.cameraFitScale / current));
  }

  private updateOverlayScales(): void {
    const factor = this.overlayZoomFactor();
    for (const group of this.overlayScaleGroups) {
      if (!group.destroyed) this.applyOverlayScale(group, factor);
    }
  }

  private applyOverlayScale(group: Container, factor: number): void {
    // Owner 09-06: a walker token's decorations have ONE scale authority (walkers.ts decor scale) — the camera factor
    // must not overwrite it (it did, and badges ballooned on a wheel attempt at max zoom).
    const walkerScale = group.parent ? walkerChildScale(group.parent, group) : null;
    const groupScale = walkerScale ? walkerScale.x : factor * (this.overlayBaseScale.get(group) ?? 1);
    if (walkerScale) group.scale.set(walkerScale.x, walkerScale.y); else group.scale.set(groupScale);
    const fit = this.markingFit.get(group);
    if (!fit || fit.tag.destroyed) return;
    fit.tag.scale.x = 1;
    // Pixi's exact text bounds need a browser canvas. Renderer unit tests and
    // non-mounted fail-soft paths run without `document`, so retain a
    // conservative glyph-width estimate there instead of making presentation
    // setup depend on a DOM. Mounted clients use the exact antialiased bounds.
    const sourceWidth = typeof document === 'undefined'
      ? fit.tag.text.length * Number(fit.tag.style.fontSize) * 0.85 + 4
      : fit.tag.getLocalBounds().width;
    const naturalWidth = sourceWidth * groupScale;
    fit.tag.scale.x = naturalWidth > 0 ? Math.min(1, fit.maxWidth / naturalWidth) : 1;
  }

  /** True when an on-pitch player occupies square (x, y). */
  private squareOccupiedByPlayer(x: number, y: number): boolean {
    return !!this.game?.fieldModel.playerDataArray.some(
      (d) => d.playerCoordinate?.[0] === x && d.playerCoordinate?.[1] === y && isOnPitch(d.playerCoordinate),
    );
  }

  /** Soft ground shadow rendered behind prone/stunned players (owner
   *  2026-07-02, revised B2-10): drawn BENEATH THE BODY of the lying player
   *  — wide and flat along the lying axis, not a foot-contact disc. */
  private buildProneShadow(): Graphics {
    return new Graphics()
      .ellipse(0, -1 + TOKEN_BASE_SHIFT_PX, TILE_W * 0.46, TILE_H * 0.16)
      .fill({ color: 0x000000, alpha: 0.28 });
  }

  /** Owner 2026-07-04: a gold 5-point STAR silhouette laid into the ground plane
   *  beneath a Star Player's feet (replaces the position ring). `cy` = vertical
   *  centre, `r` = outer radius; the star is flattened into the 3/4 view. */
  private buildStarBase(cy: number, r: number, alpha: number): Graphics {
    const yScale = 0.58; // flatten into the receding ground plane, like the rings
    const inner = r * 0.42;
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : inner;
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push(Math.cos(ang) * rad, cy + Math.sin(ang) * rad * yScale);
    }
    return new Graphics()
      .ellipse(0, cy, r * 1.05, r * yScale * 1.05) // soft dark backing so gold reads on grass
      .fill({ color: 0x000000, alpha: 0.32 * alpha })
      .poly(pts)
      .fill({ color: 0xf5c518, alpha: 0.9 * alpha })
      .poly(pts)
      .stroke({ color: 0x7a5200, width: 1.4, alpha: 0.95 * alpha });
  }

  /** Owner 2026-07-04: a soft ADDITIVE "colour-dodge" glow behind a position ring
   *  so it pops off the grass (the deep/green rings were hard to read). Additive
   *  blend brightens whatever's beneath, tuned low so light rings don't blow out. */
  /** `spread` (owner 09-10) = the ring-density factor: >1 widens the glow halo, <1 tightens it. */
  private buildRingGlow(cy: number, rx: number, ry: number, color: number, alpha: number, spread = 1): Graphics {
    const outer = 1 + 0.42 * spread;
    const inner = 1 + 0.2 * spread;
    const g = new Graphics()
      .ellipse(0, cy, rx * outer, ry * outer)
      .fill({ color, alpha: 0.16 * alpha })
      .ellipse(0, cy, rx * inner, ry * inner)
      .fill({ color, alpha: 0.22 * alpha });
    g.blendMode = 'add';
    return g;
  }

  /**
   * FUMBBL's decoration overlays (upstream art): a white X for Stunned (the
   * lying pose alone means Prone — owner revision 2026-07-02); the slash
   * remains available should Prone ever need explicit marking again.
   */
  /** Owner 2026-07-14 (#10 part 2): should the STUN mark (the X) be drawn? True when the player is STUNNED,
   *  OR when the store has LATCHED them "recovering" — the server flipped them STUNNED→PRONE(+inactive) at the
   *  start of their own turn to ENFORCE the missed turn. Base is now PRONE, so the plain stun-base check would
   *  drop the X a turn early ("un-stunned troll"); the latch keeps the SAME X up through the missed turn until
   *  the server re-activates them. A receive-time TRANSITION latch (not a PRONE+inactive snapshot) — otherwise an
   *  acted-then-WRESTLED player (also PRONE+inactive on their own turn) would be false-marked (owner clarifier).
   *  Display-only; the store maintains the latch (setRecoveringPlayers). */
  private showStunMark(data: PlayerDataJson): boolean {
    if (baseState(data.playerState) === PlayerStateBase.STUNNED) return true;
    return this.recoveringPlayers.has(data.playerId);
  }

  /** `centreY`: token-local centre of the downed figure — classic icons lie about y=-10; a walker's prone sprite
   *  sits at WALKER_FEET_Y_PX-9 (owner 09-05: the stun X must land ON the prone token). */
  private addDownDecoration(token: Container, stunned: boolean, withCaption = true, centreY = -10): void {
    // Owner batch §N #80: a STUNNED player reads distinctly — the sprite art is muted and a
    // small gold letter-spaced "STUNNED" caption sits below the X. Gated on the SAME STUNNED
    // predicate as the X (the callers pass stunned = showStunMark(data)), so caption + X never
    // desync through the STUNNED→PRONE recovering-latch (missed-turn) window. Render-only, keyed
    // on server playerState (no client inference). Prone/other-down players are untouched.
    // (a) shade FIRST, over the existing sprite art only, so the white X + gold caption below
    //     stay full-strength. A cool desaturated slate, distinct from the acted-grey applied by
    //     applyActivationShading (which runs later — if a stunned player has ALSO acted, that
    //     grey simply wins, same as today).
    if (stunned) {
      for (const child of token.children) {
        if (child instanceof Sprite && child.label !== 'castShadow') child.tint = 0x7f8a99; // 09-06: shadow stays black
      }
    }
    const texture = this.downDecorations.get(stunned ? 'stunned' : 'prone');
    if (texture) {
      const overlay = new Sprite(texture);
      overlay.anchor.set(0.5, 0.5);
      overlay.width = TILE_W * 0.68;
      overlay.height = TILE_W * 0.68;
      overlay.position.set(0, centreY);
      token.addChild(overlay);
    } else {
      // vector fallback matching the upstream art
      const g = new Graphics().moveTo(-9, 9).lineTo(9, -9).stroke({ color: 0xffffff, width: 3 });
      if (stunned) g.moveTo(-9, -9).lineTo(9, 9).stroke({ color: 0xffffff, width: 3 });
      g.position.set(0, centreY);
      token.addChild(g);
    }
    // (b) gold "S T U N N E D" caption below the X (X is centred at y=-10, ~30px tall). Added
    //     AFTER the X so it paints above it; not a Sprite, so activation-shading won't grey it.
    // #95 (owner): caption ONLY on the REAL server STUNNED state — suppressed for the dugout's
    // faked-STUNNED KO/casualty stubs (withCaption=false) so it stops showing on every downed player.
    if (stunned && withCaption) {
      const label = new Text({
        text: 'STUNNED',
        style: {
          fontFamily: 'Arial Black, Arial, sans-serif',
          fontSize: 8,
          fontWeight: 'bold',
          letterSpacing: 1,
          fill: 0xf2c245,
          stroke: { color: 0x14161a, width: 2 },
        },
      });
      label.anchor.set(0.5, 0.5);
      // #90 (owner): the caption must fit INSIDE one tile. Per the owner's "drop letter-spacing
      // before legibility": spacing 2→1 first, then scale-to-fit against the tile width so it can
      // never overflow. Token-local space (so it tracks the token's depth/camera scale = fits at
      // ALL zoom levels).
      const maxW = TILE_W * 0.92;
      if (label.width > maxW) label.scale.set(maxW / label.width);
      label.position.set(0, centreY + 19); // clears the X's lower edge; sits over the feet
      label.zIndex = 52;
      token.addChild(label);
    }
  }

  /**
   * O1: a player AFTER they have ACTIVATED this turn shades grey/desaturated.
   * Owner 2026-07-04g CORRECTION: keyed on `actedPlayers` (the player HAS
   * activated this turn) — NOT merely "inactive" (any non-current-active player).
   * A player who hasn't activated yet stays full-colour with its position ring;
   * once they activate they lose the ring/glow (see the token build) and get this
   * deeper shading. Consistent with the ring removal.
   */
  private applyActivationShading(token: Container, data: PlayerDataJson, _isHome: boolean, strength?: number): void {
    const acted = this.actedPlayers.has(data.playerId);
    // Owner ruling (Charge/High Kick shading unification, live): a player excluded from a shaded pick's
    // eligible set (pickIneligibleIds) gets the exact same dim treatment as "already activated" — no new
    // color, no checkmark badge (that badge means activation specifically, not mere pick-ineligibility).
    const pickIneligible = !acted && !!this.pickIneligibleIds?.has(data.playerId);
    // A successful Hypnotic Gaze is report-authoritative in gazeVictims and remains
    // gated by the server's live CONFUSED flag. Reuse the inactive/acted paint path
    // exactly, but do not add an activation checkmark merely for being gazed.
    const gazeInactive = !acted && !pickIneligible
      && this.gazeVictims.has(data.playerId)
      && hasFlag(data.playerState, PlayerStateFlag.CONFUSED);
    // item3: `k` is the dim LEVEL, not a boolean — mid-turnover it is the eased in-flight value, so a
    // player fading OUT (acted → not, the turnover case) still paints here even though acted is false.
    const k = gazeInactive ? 1 : this.activationDimLevel(data.playerId, acted || pickIneligible ? 1 : 0);
    const fading = this.activationFades.has(data.playerId);
    if (k <= 0.001 && !fading) return;
    // Owner 2026-07-04g: activated players shade ~15% MORE — a lower alpha
    // (0.9 → 0.765) and a 15%-darker grey tint (0xcccdd0 → 0xaeb0b1) so a spent
    // player recedes clearly from the still-to-act ones.
    // item3: the SAME endpoints, now reached by lerp from each sprite's BASE tint (captured before we
    // touch it, so the stunned slate / other per-sprite tints still compose exactly as before at k=1).
    // owner 09-06: the walker's cast shadow stays black (its tint is the shadow ink, not a body layer)
    const sprites = token.children.filter((c): c is Sprite => c instanceof Sprite && c.label !== 'castShadow');
    const baseTints = sprites.map((s) => Number(s.tint));
    const paint = (kk: number): void => {
      if (token.destroyed) return;
      const alpha = 1 - kk * (1 - 0.715); // owner 09-07: +5 points of shading (was 0.765)
      token.alpha = alpha;
      for (let i = 0; i < sprites.length; i += 1) {
        const s = sprites[i]!;
        if (!s.destroyed) s.tint = mixTint(baseTints[i]!, 0xa5a7a8, kk); // owner 09-07: 5% darker grey (was 0xaeb0b1)
      }
      const badge = token.getChildByLabel?.('activatedCheck', false);
      // badge stays full-strength above the desaturated token, so its alpha is on
      // the child container (not inherited from token.alpha, which we've dropped);
      // it fades in/out WITH the shading so the ✓ never pops.
      if (badge) badge.alpha = Math.min(1, kk) / alpha;
      // Owner 09-07: the Hypnotic Gaze eye stays FULLY LIT on a shaded (inactive / gazed) player — compensate the
      // token alpha on the marker itself (the eye is a Text child, never tinted; only the alpha reached it).
      const eye = token.getChildByLabel?.('gazeVictimMarker', false);
      if (eye) eye.alpha = Math.min(1, 1 / alpha);
      const gouge = token.getChildByLabel?.('eyeGougeMarker', false); // 09-07: same treatment
      if (gouge) gouge.alpha = Math.min(1, 1 / alpha);
      // item3 follow-up: the position ring/glow/star base rides the SAME kk — but only
      // when kk is the acted-driven level (a pick-ineligible dim never dims the ring).
      // Owner 08-19: floored via ringDimAlpha — the acted ring dims, never vanishes.
      if (fading || !pickIneligible) {
        const ring = token.getChildByLabel?.('positionRing', false);
        if (ring) ring.alpha = this.ringDimAlpha(Math.min(1, kk));
      }
    };
    if (pickIneligible || gazeInactive) { paint(k); if (fading) this.activationFadePaint.set(data.playerId, paint); return; } // dim only — no activation checkmark
    // Owner 2026-07-12 (o66j): in ADDITION to the shading, a small green ✓ badge
    // on an activated player. Belt-and-braces with the desaturation so "spent"
    // reads at a glance even when the shading is subtle at zoom. The three token-
    // build paths all funnel through here; guard so the badge is drawn once.
    if (token.getChildByLabel?.('activatedCheck', false)) {
      paint(k);
      if (fading) this.activationFadePaint.set(data.playerId, paint);
      return;
    }
    const check = new Container();
    check.label = 'activatedCheck';
    // top-right shoulder of the token; token origin ≈ feet/square anchor.
    check.position.set(TILE_W * 0.30, -TILE_H * 0.62);
    const r = 6;
    check.addChild(new Graphics().circle(0, 0, r).fill({ color: 0x1f9d3a }).circle(0, 0, r).stroke({ color: 0xffffff, width: 1.2, alpha: 0.95 }));
    check.addChild(new Graphics().moveTo(-3, 0).lineTo(-0.8, 2.6).lineTo(3.4, -2.8).stroke({ color: 0xffffff, width: 1.8, alpha: 1 }));
    token.addChild(check);
    paint(k);
    if (fading) this.activationFadePaint.set(data.playerId, paint);
    // Owner 2026-07-13 (#3): counter the token's strengthScale so the ✓ is a constant on-pitch size
    // regardless of the model's build (a big guy's token scales up; the badge must not). Depth + zoom
    // still apply. base is re-applied by updateOverlayScales on every zoom change.
    const base = 1 / (isWalkerToken(token) ? this.walkerStrengthFor(data.playerId) : strengthScale(strength)); // walkers: ST 5+ only (09-05)
    this.overlayBaseScale.set(check, base);
    this.overlayScaleGroups.push(check);
    check.scale.set(this.overlayZoomFactor() * base);
  }

  /**
   * Skill badges ABOVE the player, rendered over the sprite (owner revision
   * 2026-07-02, supersedes below-player placement). Baseline positional
   * skills are hidden unless showDefaultSkills (Match7 toggle).
   */
  private addSkillBadges(
    token: Container,
    player: PlayerJson,
    data: PlayerDataJson,
    trim: number,
    team: TeamJson,
    baselineSkills?: Set<string>,
    badgeOccluded?: boolean,
  ): void {
    if (!this.showSkillIcons) return; // B2-17: markings mode disables icons
    // Per-skill config (owner 2026-07-03 r6f): when set, the app precomputes exactly
    // which skills to draw (MY TEAM / OPPOSITION behaviour + baseline already applied);
    // else fall back to the legacy showDefaultSkills baseline filter.
    const configured = this.playerIconSkills?.get(player.playerId);
    const base = configured ?? playerSkillNames(player).filter(
      (skill) => this.showDefaultSkills || !baselineSkills?.has(skill),
    );
    // Owner 09-07: TEMPORARY stat decrements (Greasy Cleats -MA, Dodgy Snack -MA/-AV, any TemporaryStatDecrementer in
    // player.temporaryModifiersMap) join the badge row as '-MA' / '-AV' — the stat-down art (or the red glyph plate)
    // resolves through the same skill-icon chain; they leave when the server drops the source.
    const decrements = this.temporaryStatDecrements(player.playerId).map((stat) => `-${stat}`);
    const skills = [...base, ...decrements.filter((d) => !base.includes(d))];
    // Owner 09-07: up to EIGHT skills in TWO rows of four — the second row sits below the first (over the head the
    // cluster grows upward from the head: first row on top; at the feet it grows downward).
    const PER_ROW = 4;
    const shown = skills.slice(0, PER_ROW * 2);
    // legibility study (owner 2026-07-02, queue item 10): icon size and an
    // optional dark backing plate are style-driven
    const large = this.skillBadgeStyle === 'large' || this.skillBadgeStyle === 'large-plate';
    const plate = this.skillBadgeStyle === 'plate' || this.skillBadgeStyle === 'large-plate';
    // owner: bumped base sizes (was 11/16) — the detailed BB2/BB3 icon art needs
    // more pixels to read at the default fit zoom.
    const iconSize = large ? 19 : 14;
    const badgeW = iconSize; // owner 09-06: icon edges may touch (no gap) — the row is capped to one tile width
    const rowCount = Math.ceil(shown.length / PER_ROW);
    const totalW = Math.min(shown.length, PER_ROW) * badgeW;
    if (shown.length === 0) return;
    // owner 2026-07-03 r6f: icons default OVER THE HEAD, but can render AT THE
    // FEET (below the token) like the markers. Anchor against the token's actual
    // local visual bounds: fixed offsets drift when the sprite path changes, and
    // the old feet offsets (7/11) sat inside centered classic/checker tokens.
    // The group remains a token child, so this local offset already inherits the
    // token's depthScale exactly once (as well as its movement/dugout transform).
    const atFeet = this.iconPosition === 'feet';
    const tokenBounds = token.getLocalBounds() as unknown as { minY: number; maxY: number };
    const badgeAnchorY = (atFeet ? tokenBounds.maxY : tokenBounds.minY) + (atFeet ? 2 : -2);
    // B2-3/B2-4: badges live in a group; the group scales inversely with zoom.
    const group = new Container();
    group.label = 'skillBadges';
    group.position.set(0, badgeAnchorY);
    const [cx, cy] = data.playerCoordinate ?? [NaN, NaN];
    // owner 08-13: pitch-space heuristic — badges sit one square "behind" the
    // token in screen space (over the head), so a token occupying that square
    // is the one a badge cluster would occlude. Reversal of the pre-08-13
    // behaviour: occluding badges now DIM instead of going opaque, so the
    // player underneath stays readable.
    // RESERVES passes an explicit result from its actual (possibly fractionally packed,
    // direction-reversed) placements. Ordinary pitch and KO/CAS callers retain this heuristic.
    const overlapping = badgeOccluded ?? (Number.isFinite(cx) && this.squareOccupiedByPlayer(cx + 1, cy));
    // Owner 08-19: skill icons render at FULL opacity unless the icon sits over a token behind it
    // (the square to the right is occupied) — then drop to 0.5 so the occluded token stays visible.
    // Supersedes FIX17's global 0.5 cap: non-occluding icons are no longer dimmed.
    group.alpha = overlapping ? BADGE_OCCLUDED_ALPHA : 1;
    this.trackLiveSkillAsset(group, () => {
      for (const child of group.removeChildren()) child.destroy({ children: true });
      if (plate) {
        group.addChild(
          new Graphics()
            .roundRect(-totalW / 2 - 2, atFeet ? -2 : -iconSize * rowCount - 2, totalW + 4, iconSize * rowCount + 4, 3)
            .fill({ color: 0x14161a, alpha: 0.72 }),
        );
      }
      shown.forEach((skill, i) => {
        const row = Math.floor(i / PER_ROW);
        const col = i % PER_ROW;
        const rowLen = Math.min(PER_ROW, shown.length - row * PER_ROW);
        const rowW = rowLen * badgeW;
        const bx = -rowW / 2 + col * badgeW + badgeW / 2;
        // over the head: row 0 highest, the last row rests on the anchor; at the feet: rows step downward
        const rowY = atFeet ? row * iconSize : -(rowCount - 1 - row) * iconSize;
        const side = this.game?.teamHome.teamId === team.teamId
          ? 'home'
          : this.game?.teamAway.teamId === team.teamId ? 'away' : undefined;
        const icon = skillIcon(skill, this.skillIconStyle, { positionId: player.positionId, side });
        if (icon) {
          const chip = new Sprite(icon);
          chip.anchor.set(0.5, atFeet ? 0 : 1);
          chip.width = iconSize;
          chip.height = iconSize;
          chip.position.set(bx, rowY);
          group.addChild(chip);
        } else {
          const by = (atFeet ? 0 : -10) + rowY;
          const presentation = skillBadgePresentation(skill);
          const isCharacteristic = /^[-+](?:AG|MA|MV|AV|ST|PA)$/i.test(skill.trim());
          const badge = new Graphics()
            .roundRect(bx - 5, by, 10, 10, 2)
            .fill(isCharacteristic ? presentation.fill : COLORS.badge)
            .stroke({ color: isCharacteristic ? presentation.stroke : trim, width: 1 });
          group.addChild(badge);
          const letter = new Text({ text: presentation.label, style: BADGE_STYLE });
          letter.anchor.set(0.5, 0.5);
          letter.position.set(bx, by + 5);
          group.addChild(letter);
        }
      });
    });
    token.addChild(group);
    this.overlayScaleGroups.push(group);
    group.scale.set(this.overlayZoomFactor());
  }

  // --- camera: wheel zoom, drag pan, two-pointer pinch (App3) ---

  private attachCamera(canvas: HTMLCanvasElement): void {
    this.listenCanvas(canvas, 'wheel', (event) => {
      event.preventDefault();
      if (this.cinematic) return;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.zoomAt(event.offsetX, event.offsetY, factor);
    });
    this.listenCanvas(canvas, 'pointerdown', (event) => {
      // B5-5: cinematic owns the camera. #125/g469: the pointerUP dispatch consults
      // clickFrozenByCinematic() (= !!this.cinematic && !this.order66 — see its definition and the
      // pointerup consult of the same name); this
      // pointerDOWN bail used to be a SEPARATE inline `if (this.cinematic) return` that never
      // got the o66 exemption — the drift that caused #108-①: a press whose DOWN starts mid-cine
      // was swallowed (pointers.set below skipped → the pointers.size===1 tap gate at pointerup
      // false → the tap never fired; the coach had to re-click after the cine). Consolidate onto
      // the SAME predicate so the two ends can never drift again — the existing g469 regression
      // tooth now locks both. In o66 it returns false → the press registers for TAP; during the
      // hold the cinematic tween owns world.position so no visible pan starts, and a stationary
      // tap keeps dragDistance≈0. Bounded to Auto-Director-ON (this.cinematic is only set in
      // cinematicZoom, whose `if (!this.app || !this.autoDirector) return` gate bounds it).
      // button-2/pinch/pan below unchanged.
      if (this.clickFrozenByCinematic()) return;
      // B2-5: right-button presses belong to the contextmenu handler ONLY —
      // without this they also started camera drags and fired the tap logic
      // (double-handling = the reported right-click inconsistency)
      if (event.button === 2) return;
      this.clearHoverSquareMarker();
      // Owner 2026-07-14 (setup overhaul cond-b): during setup, a pointerdown on a DUGOUT reserve token starts a
      // drag-to-pitch instead of a camera pan. Hit-test dugoutHits by world proximity BEFORE registering a pan
      // pointer; the host (SpectateView) begins the setup-drag ghost and enforces reserve-only / KO-CAS-inert.
      if (this.setupActive && this.onDugoutSetupDragStart && this.pointers.size === 0) {
        const wx = (event.offsetX - this.world.position.x) / this.world.scale.x;
        const wy = (event.offsetY - this.world.position.y) / this.world.scale.y;
        const [sx, sy] = worldToSquare(wx, wy);
        const shiftAnnotation = event.shiftKey
          && sx >= 0 && sx < PITCH_COLS && sy >= 0 && sy < PITCH_ROWS;
        // Shift annotations own on-pitch presses, including those over a placed token. Register the pointer
        // below so pointerup can toggle the player arrow / square row / square column without beginning setup.
        // Off-pitch reserve drags and every unmodified setup drag retain their existing callback path.
        if (!shiftAnnotation) {
          const dh = this.dugoutHits.find((h) => Math.hypot(h.x - wx, h.y - wy) <= h.r);
          if (dh) { this.onDugoutSetupDragStart(dh.playerId, event.clientX, event.clientY); return; }
          // Owner 2026-07-14 (setup overhaul #3): a pointerdown on a PLACED on-pitch player also starts a
          // drag-to-move (same callback); a stationary release is routed back to select/swap by the host.
          const pid = this.playersBySquare.get(`${sx},${sy}`);
          if (pid) { this.onDugoutSetupDragStart(pid, event.clientX, event.clientY); return; }
        }
      }
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 1) {
        this.dragging = true;
        this.dragDistance = 0;
        this.lastPointer = { x: event.clientX, y: event.clientY };
      } else if (this.pointers.size === 2) {
        this.dragging = false;
        this.pinchDistance = this.currentPinchDistance();
      }
      canvas.setPointerCapture(event.pointerId);
    });
    this.listenCanvas(canvas, 'pointermove', (event) => {
      if (this.pointers.size === 0) {
        // hover feedback: pointer cursor over occupied squares
        const worldX = (event.offsetX - this.world.position.x) / this.world.scale.x;
        const worldY = (event.offsetY - this.world.position.y) / this.world.scale.y;
        const [sx, sy] = worldToSquare(worldX, worldY);
        // Pass/bomb targeting surface (Fives contract 08-12): emit the hovered square so the host can
        // drive the throw/catch tooltip + intercept feed. Fires ahead of the mode-specific handlers
        // below (which early-return) and is purely additive — dedup by key, null off-pitch / on mode-exit.
        if (this.passRulerFrom || (this.plannerEnabled && (this.actionMode === 'pass' || this.actionMode === 'bomb'))) {
          const onPitch = sx >= 0 && sx < PITCH_COLS && sy >= 0 && sy < PITCH_ROWS;
          const key = onPitch ? `${sx},${sy}` : null;
          if (key !== this.squareHoverLast) {
            this.squareHoverLast = key;
            this.onSquareHover?.(onPitch ? [sx, sy] : null);
          }
        } else if (this.squareHoverLast !== null) {
          this.squareHoverLast = null;
          this.onSquareHover?.(null);
        }
        // Owner 2026-07-14 (#2, REWORK of o66an): KICK PLACEMENT — the ball crosshair FREE-FOLLOWS the pointer's
        // world position (NO snap-to-square) and the OS cursor STAYS VISIBLE (a 'crosshair' aim cursor, never
        // hidden). The ball lands on whichever square the crosshair sits over at click time (validated against
        // kickPickSquares in the tap handler). Over an ineligible square the crosshair dims for feedback without
        // moving. Keeping the cursor visible also structurally kills #16 (the old `cursor:'none'` could stick on
        // when the placement cleared without a fresh pointermove).
        if (this.kickPickSquares) {
          this.clearHoverSquareMarker();
          if (this.kickHoverMarker && !this.kickHoverMarker.destroyed) this.kickHoverMarker.destroy({ children: true });
          // Owner o66 #13: the SCATTER-DEVIATION grid rides the cursor, anchored on the SNAPPED aimed square (the
          // ball's landing square if clicked here) even though the crosshair itself free-follows the raw pointer.
          if (this.kickScatterMarker && !this.kickScatterMarker.destroyed) this.kickScatterMarker.destroy({ children: true });
          this.kickScatterMarker = this.buildKickScatterGrid(sx, sy);
          this.kickScatterMarker.alpha = this.kickPickSquares.has(`${sx},${sy}`) ? 1 : 0.45;
          this.overlayLayer.addChild(this.kickScatterMarker);
          this.kickHoverMarker = this.buildKickBallCrosshair([sx, sy]);
          this.kickHoverMarker.position.set(worldX, worldY); // free-follow: override the square anchor
          this.kickHoverMarker.alpha = this.kickPickSquares.has(`${sx},${sy}`) ? 1 : 0.4;
          this.overlayLayer.addChild(this.kickHoverMarker);
          canvas.style.cursor = 'crosshair';
          return;
        }
        const overPush = this.pushOptionCoords.some((c) => c[0] === sx && c[1] === sy);
        // Upstream HIT_AND_RUN exposes its valid cursor on exactly the server moveSquareArray membership test.
        const overHitAndRun = this.tilePickSkill === 'order66-hit-and-run' && this.tilePickEligible?.has(`${sx},${sy}`);
        // Owner 2026-07-04d: in bomb mode, hovering previews the 3×3 blast.
        if (this.actionMode === 'bomb' && this.plannerEnabled) {
          this.clearHoverSquareMarker();
          if (sx >= 0 && sx < PITCH_COLS && sy >= 0 && sy < PITCH_ROWS &&
            (this.bombTarget?.[0] !== sx || this.bombTarget?.[1] !== sy)) {
            this.setBombTarget([sx, sy]);
          }
          canvas.style.cursor = 'crosshair';
          return;
        }
        // Owner 2026-07-04c: foul/handoff/pass — hovering an ELIGIBLE target
        // swaps the cursor (skull / hand) and raises the roll tip beside it.
        const mode = this.actionMode;
        const hoverId = this.playersBySquare.get(`${sx},${sy}`);
        let actionTip: string | null = null;
        if (this.plannerEnabled && hoverId && (mode === 'foul' || mode === 'handoff' || mode === 'pass')) {
          actionTip = this.actionRollText(mode, hoverId);
        }
        if (actionTip) {
          this.clearHoverSquareMarker();
          canvas.style.cursor = this.actionCursorFor(mode as 'foul' | 'handoff' | 'pass');
          this.actionHoverActive = true;
          this.onActionHover?.({ mode: mode as 'foul' | 'handoff' | 'pass', text: actionTip, canvasX: event.offsetX, canvasY: event.offsetY });
        } else {
          if (this.actionHoverActive) {
            this.actionHoverActive = false;
            this.onActionHover?.(null);
          }
          canvas.style.cursor = overHitAndRun
            ? 'crosshair'
            : overPush || this.playersBySquare.has(`${sx},${sy}`)
              ? this.primedCursor()
              : this.restingCursor();
          if (sx >= 0 && sx < PITCH_COLS && sy >= 0 && sy < PITCH_ROWS) {
            this.showHoverSquareMarker([sx, sy]);
          } else {
            this.clearHoverSquareMarker();
          }
        }
      }
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 2) {
        const distance = this.currentPinchDistance();
        if (this.pinchDistance > 0) {
          const rect = canvas.getBoundingClientRect();
          const points = [...this.pointers.values()];
          const cx = (points[0]!.x + points[1]!.x) / 2 - rect.left;
          const cy = (points[0]!.y + points[1]!.y) / 2 - rect.top;
          this.zoomAt(cx, cy, distance / this.pinchDistance);
        }
        this.pinchDistance = distance;
      } else if (this.dragging) {
        this.noteManualCameraInput();
        this.dragDistance += Math.hypot(event.clientX - this.lastPointer.x, event.clientY - this.lastPointer.y);
        this.world.position.x += event.clientX - this.lastPointer.x;
        this.world.position.y += event.clientY - this.lastPointer.y;
        this.clampCamera(); // FC: block drag at the pitch edge
        this.lastPointer = { x: event.clientX, y: event.clientY };
      }
    });
    // A press that barely moved is a tap: hit-test the square under the
    // pointer (worldToSquare inverts the projection) and report the player.
    this.listenCanvas(canvas, 'pointerup', (event) => {
      if (event.button === 2) return; // B2-5: right-clicks never tap-select
      // Shift-click annotations take priority over every gameplay surface and never select, plan, or send.
      // Plain Shift on a rendered player toggles its persistent overhead arrow; an empty square keeps the
      // original single-square mark. Ctrl/Alt variants remain row/column marks even over a token.
      if (event.shiftKey && this.pointers.size === 1 && this.dragDistance < 5) {
        const worldX = (event.offsetX - this.world.position.x) / this.world.scale.x;
        const worldY = (event.offsetY - this.world.position.y) / this.world.scale.y;
        const [sx, sy] = worldToSquare(worldX, worldY);
        if (sx >= 0 && sx < PITCH_COLS && sy >= 0 && sy < PITCH_ROWS) {
          if (event.ctrlKey) this.markRow([sx, sy]); // Ctrl+Shift = row
          else if (event.altKey) this.markColumn([sx, sy]); // Alt+Shift = column
          else {
            const playerId = this.playerTokenAtWorld(worldX, worldY);
            if (playerId) this.togglePersistentPlayerArrow(playerId);
            else this.toggleMarkNear(worldX, worldY, [sx, sy]); // empty Shift = single square (column-aware clear)
          }
          return;
        }
      }
      // PUNT UX v2: cone-side re-aim owns its pixels before pitch-square interaction.
      if (this.puntReaimHits.length > 0 && this.pointers.size === 1 && this.dragDistance < 5) {
        const worldX = (event.offsetX - this.world.position.x) / this.world.scale.x;
        const worldY = (event.offsetY - this.world.position.y) / this.world.scale.y;
        const dir = this.puntReaimDirectionAt(worldX, worldY);
        if (dir) {
          this.onPuntReaim?.(dir);
          return;
        }
      }
      // Owner 2026-07-04: an interactive push-direction choice takes priority and
      // works even during a block cinematic (which owns the camera). A tap on a
      // candidate square sends the pushback; anything else falls through.
      if (this.pushOptionCoords.length > 0 && this.pointers.size === 1 && this.dragDistance < 5) {
        const worldX = (event.offsetX - this.world.position.x) / this.world.scale.x;
        const worldY = (event.offsetY - this.world.position.y) / this.world.scale.y;
        const [sx, sy] = worldToSquare(worldX, worldY);
        const hit = this.pushOptionCoords.find((c) => c[0] === sx && c[1] === sy);
        if (hit) {
          this.onPushChoice?.([hit[0], hit[1]]);
          return;
        }
      }
      // Owner 2026-07-13: BALL & CHAIN aim — a tap on an orthogonal aim square (arrow tip) fires onBncAim (the
      // host sends the aim CLIENT_MOVE; the server scatters). Same one-pointer/no-drag gate as the push options.
      if (this.bncAimCoords.length > 0 && this.pointers.size === 1 && this.dragDistance < 5) {
        const worldX = (event.offsetX - this.world.position.x) / this.world.scale.x;
        const worldY = (event.offsetY - this.world.position.y) / this.world.scale.y;
        const [sx, sy] = worldToSquare(worldX, worldY);
        const hit = this.bncAimCoords.find((c) => c[0] === sx && c[1] === sy);
        if (hit) {
          this.onBncAim?.([hit[0], hit[1]]);
          return;
        }
      }
      // Owner 2026-07-04e: an armed raw TILE pick owns taps (unknown-call
      // coordinate response) — a click on any (eligible) square reports it.
      if (this.tilePickActive && this.pointers.size === 1 && this.dragDistance < 5) {
        const worldX = (event.offsetX - this.world.position.x) / this.world.scale.x;
        const worldY = (event.offsetY - this.world.position.y) / this.world.scale.y;
        const [sx, sy] = worldToSquare(worldX, worldY);
        const onPitch = sx >= 0 && sx < PITCH_COLS && sy >= 0 && sy < PITCH_ROWS;
        const eligible = this.tilePickAllows(sx, sy);
        if (eligible) { this.onTilePick?.([sx, sy]); return; }
        // o66-dispatch (owner o66d: blitz block uninitiable + switch-player mid-move): the MOVE/BLITZ move
        // overlay is armed, but a click on a PLAYER-occupied square that is NOT a move target — the blitz block
        // target, or another own player to switch to — must reach onPlayerClick (the o66 router → sendBlock /
        // menu). Let it fall through instead of swallowing. Off-flag: unchanged (always swallowed when armed).
        if (!(this.order66 && onPitch && this.playersBySquare.get(`${sx},${sy}`))) return;
        // else fall through to the player-click dispatch below
      }
      // Owner 2026-07-04d: bomb/Throw-Keg targeting owns taps — a click on any
      // square (the 3×3 blast centre) confirms the target via onBombTarget.
      if (this.actionMode === 'bomb' && this.plannerEnabled && this.pointers.size === 1 && this.dragDistance < 5) {
        const worldX = (event.offsetX - this.world.position.x) / this.world.scale.x;
        const worldY = (event.offsetY - this.world.position.y) / this.world.scale.y;
        const [sx, sy] = worldToSquare(worldX, worldY);
        if (sx >= 0 && sx < PITCH_COLS && sy >= 0 && sy < PITCH_ROWS) this.onBombTarget?.([sx, sy]);
        return;
      }
      // Owner o66an: KICK PLACEMENT owns taps — a tap on an eligible aim square fires onKickPick (→ CLIENT_KICKOFF).
      if (this.kickPickSquares && this.pointers.size === 1 && this.dragDistance < 5) {
        const worldX = (event.offsetX - this.world.position.x) / this.world.scale.x;
        const worldY = (event.offsetY - this.world.position.y) / this.world.scale.y;
        const [sx, sy] = worldToSquare(worldX, worldY);
        if (this.kickPickSquares.has(`${sx},${sy}`)) this.onKickPick?.([sx, sy]);
        return;
      }
      // Owner 2026-07-04 (interaction catalog 0.1): an armed player-pick owns taps —
      // a tap on an eligible player reports it; everything else is swallowed so the
      // pick can't accidentally select/move a player (decline is a host-UI button).
      // Owner 2026-08-17 (P1 audit — "Iron Man/Knuckle Dusters cannot reach every offered
      // reserve"): this used to resolve ONLY via playersBySquare (the pitch), so a candidate
      // displaced by Stars or beyond preSetupFormation's eleven synthetic placements — which
      // gets no pitch square, only a dugout token (drawDugouts' offPitch catch-all) — could
      // never be tapped. Fall through to a dugout hit-test alongside the pitch lookup before
      // giving up; both routes still gate on playerPickIds (the server's exact eligible set).
      if (this.playerPickIds && this.pointers.size === 1 && this.dragDistance < 5) {
        const worldX = (event.offsetX - this.world.position.x) / this.world.scale.x;
        const worldY = (event.offsetY - this.world.position.y) / this.world.scale.y;
        const pid = this.resolveArmedPlayerPick(worldX, worldY);
        if (pid) this.onPlayerPick?.(pid);
        return;
      }
      // Presentation-only formation tokens are inert outside the player-pick branch above.
      if (this.preSetupCoords.size > 0 && this.pointers.size === 1 && this.dragDistance < 5) {
        const worldX = (event.offsetX - this.world.position.x) / this.world.scale.x;
        const worldY = (event.offsetY - this.world.position.y) / this.world.scale.y;
        const [sx, sy] = worldToSquare(worldX, worldY);
        const pid = this.playersBySquare.get(`${sx},${sy}`);
        if (pid && this.preSetupCoords.has(pid)) return;
      }
      // Owner 2026-07-04: interactive team setup owns taps while active — report
      // the tapped square + any player on it (place / move / remove / select).
      if (this.setupActive && this.pointers.size === 1 && this.dragDistance < 5) {
        const worldX = (event.offsetX - this.world.position.x) / this.world.scale.x;
        const worldY = (event.offsetY - this.world.position.y) / this.world.scale.y;
        const [sx, sy] = worldToSquare(worldX, worldY);
        this.onSetupClick?.([sx, sy], this.playersBySquare.get(`${sx},${sy}`) ?? null);
        return;
      }
      // o66-dispatch (P1): in o66 play the state machine owns interaction — a holding cine must NOT swallow
      // the click (that froze the block-confirm click in g469). Off-flag: byte-identical B5-5 freeze.
      if (this.clickFrozenByCinematic()) return; // B5-5 (o66-dispatch: off-flag identical, on-flag never freezes)
      if (this.pointers.size === 1 && this.dragDistance < 5) {
        const worldX = (event.offsetX - this.world.position.x) / this.world.scale.x;
        const worldY = (event.offsetY - this.world.position.y) / this.world.scale.y;
        // Owner 2026-07-08: DUGOUT players sit outside the pitch's worldToSquare bands, so a
        // click there can't resolve to a square (and used to fall through to a deselect). Hit-
        // test the dugout tokens directly by world proximity → select them so their card
        // (portrait + injury) surfaces, exactly like an on-pitch player.
        const dh = this.dugoutHits.find((h) => Math.hypot(h.x - worldX, h.y - worldY) <= h.r);
        if (dh) {
          this.selectPlayer(dh.playerId);
          this.onPlayerClick?.(dh.playerId, event.offsetX, event.offsetY);
          return;
        }
        const [sx, sy] = worldToSquare(worldX, worldY);
        const playerId = this.playersBySquare.get(`${sx},${sy}`);
        if (playerId) {
          // Owner 2026-07-04c: a SECOND click on the armed action target confirms
          // it (foul/handoff/pass) — "on a further click, commit the path".
          if (this.armedAction && this.armedAction.targetId === playerId) {
            this.confirmArmedAction();
            return;
          }
          const clickedIsHome = !!this.game?.teamHome.playerArray.some((p) => p.playerId === playerId);
          // Owner 2026-07-04d: only route to the block/approach handler when the
          // SELECTED player is a legal actor (the acting team). If an opposition
          // player is selected (view-only), clicking another player just RE-selects
          // it — so clicking opp→own never arms a reverse block preview.
          if (
            // o66-dispatch (P1): in o66 play, an enemy click must NOT enter the legacy block-PREVIEW routing
            // (handleOpponentClick → pendingBlock/onBlockConfirm) — it falls through to onPlayerClick below,
            // where the o66 router turns it into sendBlock. Off-flag: unchanged legacy routing.
            !this.order66 &&
            this.selectedPlayerId &&
            playerId !== this.selectedPlayerId &&
            clickedIsHome !== this.selectedIsHome() &&
            this.selectedIsActor()
          ) {
            this.handleOpponentClick(playerId, [sx, sy], event.offsetX, event.offsetY);
          } else if (
            // Owner 2026-07-04c: in handoff/pass mode a TEAMMATE click targets the
            // action instead of switching the selection.
            this.selectedPlayerId &&
            playerId !== this.selectedPlayerId &&
            (this.actionMode === 'handoff' || this.actionMode === 'pass') &&
            this.armActionTarget(playerId, [sx, sy])
          ) {
            return;
          } else {
            this.selectPlayer(playerId);
            this.onPlayerClick?.(playerId, event.offsetX, event.offsetY);
          }
        } else if (this.selectedPlayerId && this.inspectionOnly()) {
          this.clearSelection(); // owner 09-08: spectator/replay inspect — any empty-square click dismisses, acting side included
        } else if (this.selectedPlayerId && this.actionMode !== 'pass' && this.selectedIsActor()) {
          this.handleSquareClick([sx, sy]);
        } else if (this.selectedPlayerId && !this.selectedIsActor()) {
          // Owner 2026-07-06 (B): spectator/view-only inspect — tapping an empty square
          // DESELECTS, shutting down the reach + tackle-zone read (an actor keeps their
          // pathing via handleSquareClick above).
          this.clearSelection(); // the host re-selects the actor itself when its inspection latch is set (o66 play)
        }
      }
    });
    const release = (event: PointerEvent) => {
      try {
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      } catch { /* capture may already have been released by the browser */ }
      this.pointers.delete(event.pointerId);
      this.dragging = this.pointers.size === 1;
      if (this.dragging) {
        const p = [...this.pointers.values()][0]!;
        this.lastPointer = { x: p.x, y: p.y };
      }
    };
    this.listenCanvas(canvas, 'pointerup', release);
    const clearPointerHover = () => {
      this.clearHoverSquareMarker();
      if (this.squareHoverLast !== null) {
        this.squareHoverLast = null;
        this.onSquareHover?.(null);
      }
    };
    this.listenCanvas(canvas, 'pointerleave', clearPointerHover);
    this.listenCanvas(canvas, 'pointercancel', (event) => {
      release(event);
      clearPointerHover();
    });
    // B2-19: double-clicks on a PLAYER are the block-confirm gesture (O3) —
    // resetting the camera on them yanked the view mid-confirm and made the
    // double-click confirm feel unavailable. Camera reset = empty squares only.
    this.listenCanvas(canvas, 'dblclick', (event) => {
      const worldX = (event.offsetX - this.world.position.x) / this.world.scale.x;
      const worldY = (event.offsetY - this.world.position.y) / this.world.scale.y;
      const [sx, sy] = worldToSquare(worldX, worldY);
      // Owner o66j #14: a double-click ON a player token → onPlayerDoubleClick (host stands up a prone own
      // player). Owner 2026-07-13: the legacy empty-square reset-camera behaviour is REMOVED — a stray
      // double-click on the pitch was yanking the zoom mid-play (one of the #6 zoom-reset offenders).
      const dblPid = this.playersBySquare.get(`${sx},${sy}`);
      if (dblPid && this.preSetupCoords.has(dblPid)) return;
      if (dblPid) { this.onPlayerDoubleClick?.(dblPid); return; }
    });

    // Right-click shortcuts (owner 2026-07-02, revised 08-25): any open waypoint plan owns the entire gesture.
    // One right-click anywhere clears the full plan and is swallowed; context menus exist only without waypoints.
    this.listenCanvas(canvas, 'contextmenu', (event) => {
      event.preventDefault();
      // Match the primary click rail: Order 66 cinematics are presentation-only and cannot swallow
      // an activation-cancel gesture. Legacy/spectator camera cinematics retain the B5-5 freeze.
      if (this.cinematic && !this.order66) return;
      const worldX = (event.offsetX - this.world.position.x) / this.world.scale.x;
      const worldY = (event.offsetY - this.world.position.y) / this.world.scale.y;
      const [sx, sy] = worldToSquare(worldX, worldY);
      const playerId = this.playersBySquare.get(`${sx},${sy}`);
      // The selected token is the authoritative activation-cancel gesture. Do not let a plotted
      // waypoint swallow that right-click before the host can send CLIENT_ACTING_PLAYER(null)
      // (or surface the required Blitz/Punt confirmation). Other right-clicks retain the one-shot
      // waypoint cancel contract.
      if (playerId !== this.selectedPlayerId && this.dismissWaypointPlanForContextMenu()) return;
      if (playerId && this.preSetupCoords.has(playerId)) return;
      // Owner 09-08: on an inspection-only surface a right-click clears the inspect read first; an empty square then
      // needs no menu, a player still gets its context menu (card) below.
      if (this.selectedPlayerId && this.inspectionOnly()) {
        this.setPath([]);
        this.clearSelection();
        if (!playerId) return;
      }
      if (!playerId) {
        const now = performance.now();
        const quickSecond = now - this.lastRightClickAt < PitchRenderer.DOUBLE_RCLICK_MS;
        this.lastRightClickAt = now;
        if (quickSecond) {
          this.setPath([]);
          this.clearSelection(); // full reset
          return;
        }
        // Owner 2026-07-04f: an empty square with no plotted path → the Mark… menu.
        if (sx >= 0 && sx < PITCH_COLS && sy >= 0 && sy < PITCH_ROWS) {
          this.onContextMenu?.(
            {
              playerId: '', square: [sx, sy], emptySquare: true,
              isOpposition: false, isHomeTeam: false, isDown: false,
              activationSpent: false, isConfused: false, isHypnotized: false,
            },
            event.offsetX, event.offsetY,
          );
        }
        return;
      }
      const data = this.game?.fieldModel.playerDataArray.find((d) => d.playerId === playerId);
      if (!data) return;
      const isHome = !!this.game?.teamHome.playerArray.some((p) => p.playerId === playerId);
      // perspective: the selected player's team, or home = "own" without one
      const ownSide = this.selectedPlayerId ? this.selectedIsHome() : true;
      const base = baseState(data.playerState);
      const shadeable =
        base === PlayerStateBase.STANDING || base === PlayerStateBase.MOVING || base === PlayerStateBase.PRONE;
      this.onContextMenu?.(
        {
          playerId,
          square: [sx, sy],
          isOpposition: isHome !== ownSide,
          isHomeTeam: isHome,
          isDown: isDown(data.playerState),
          activationSpent: shadeable && !hasFlag(data.playerState, PlayerStateFlag.ACTIVE),
          isConfused: hasFlag(data.playerState, PlayerStateFlag.CONFUSED),
          isHypnotized: hasFlag(data.playerState, PlayerStateFlag.HYPNOTIZED),
        },
        event.offsetX,
        event.offsetY,
      );
    });
  }

  private currentPinchDistance(): number {
    const points = [...this.pointers.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
  }

  private zoomAt(screenX: number, screenY: number, factor: number): void {
    this.noteManualCameraInput();
    const oldScale = this.world.scale.x;
    // Owner 2026-07-08 (FC): clamp-to-pitch stops zoom-out at the fit scale.
    const minScale = this.clampToPitch ? this.cameraFitScale : 0.3;
    // Owner 09-05: wheel steps move one whole physical-pixel ratio at a time (pixel zoom).
    const newScale = Math.min(PitchRenderer.MAX_WHEEL_ZOOM, Math.max(minScale, this.quantizeZoom(oldScale, factor > 1 ? 'up' : 'down')));
    const applied = newScale / oldScale;
    this.world.position.x = screenX - (screenX - this.world.position.x) * applied;
    this.world.position.y = screenY - (screenY - this.world.position.y) * applied;
    this.world.scale.set(newScale);
    this.clampCamera();
    this.updateOverlayScales(); // B2-4/B2-20: badges counter-scale with zoom
  }
}
