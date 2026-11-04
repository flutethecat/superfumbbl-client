// Owner 10-21: a bug report carries a SETTINGS SNAPSHOT (`context.settings`) so a performance report is diagnosable
// at a glance: which display / animation / presentation options were on, plus the machine's pixel ratio, canvas size,
// core count, memory class and GPU string.
//
// EXPLICIT ALLOW-LIST, never a deny-list: a setting added to AppSettings tomorrow does NOT ride along until someone
// adds it here (and to the pinning test). Values pass only as booleans, finite numbers or short token strings (enum
// ids / pack hashes); anything else (objects, colours, URLs, coach names, free text) becomes null. No credentials,
// tokens, file paths or identity ever reach this object - the allow-list holds none of them and the test pins that.

import type { AppSettings } from './settings';
import { uiZoomState } from './uiZoomShell';

/** Display / performance / presentation settings copied into `context.settings.prefs`. Order = report order. */
export const BUG_REPORT_SETTINGS_KEYS = [
  // rendering / performance
  'renderScale', 'fpsCap', 'flatRender', 'castShadows', 'showStadium', 'stadiumStands', 'backdrop', 'turf', 'brightness',
  // figures / animation
  'spriteSet', 'walkAnimation', 'walkFps', 'walkFaceCamera', 'uniformFigures', 'uniformFiguresEw', 'oneSpritePerPosition',
  'moveStyle', 'moveSpeedMs', 'blockTumbleMs', 'bloodSplatters', 'actionDecorations', 'cinematicMode', 'casualtySplash',
  'clickDismissCinematics', 'skipArmourDiceOnCasualty',
  // dice
  'blockDice3d', 'showBlockDice', 'blockDiceFamily', 'blockDiceSurface', 'preClickBlockDice', 'd6FaceVariant',
  // pitch overlays / skills
  'pitchOrientation', 'pitchFlipped', 'tackleZoneMode', 'spectatorTackleZoneMode', 'skillDisplay', 'skillIconStyle',
  'skillBadgeFamily', 'showDefaultSkills', 'showPositionRings', 'showPlayerNumbers', 'gridLines', 'showRowMarkers',
  'showSweetSpot', 'showFieldLogos', 'activePlayerEcho', 'clickEcho', 'turnTrack', 'trailMarks', 'trailColor',
  'auraDisturbingPresence', 'auraPickMeUp', 'colorblindMode',
  // HUD / log / chat presentation
  'uiMode', 'modernHudStyle', 'classicEffects', 'uiTheme', 'uiStyle', 'uiColorScheme', 'uiGameStyle', 'uiFont', 'uiTextSize', 'uiCustomize', 'useFantasyCursor',
  'logStyle', 'chatStyle', 'logFont', 'logFontSize', 'chatToastsEnabled', 'chatDisabled', 'chatPoppedOut',
  'playerCardMode', 'spectatorView', 'spectatorClean', 'autoDirector',
  // input / audio / play mode / diagnostics switches
  'inputMethod', 'controllerSupportEnabled', 'soundVolume', 'order66', 'compression', 'wireLog', 'debugLog', 'devMode',
  'devWireCapture',
  // Settings reflow lane C (11-03): camera, telestrator and accessibility modes, and the REQUESTED UI zoom (a number;
  // Sol r1: the one zoom key the forbidden-key pin exempts). The applied factor and the shell's refusal ride in env.
  'uiZoom', 'edgePan', 'edgePanSpeed', 'telestratorMode', 'highContrast', 'reduceMotion', 'reduceFlashing', 'visualSoundCues',
  'largerTargets', 'turnClockWarning',
] as const satisfies readonly (keyof AppSettings)[];

/** Asset-pack slots: the assigned pack's install hash (or '' = built-in). */
export const BUG_REPORT_ASSET_PACK_SLOTS = [
  'skillIcons', 'playerSprites', 'walkSheets', 'soundEvents', 'teamLogos', 'blockDice',
] as const satisfies readonly (keyof AppSettings['assetPackAssignments'])[];

export type BugReportSettingValue = boolean | number | string | null;

/** What the client measures about the machine at Send time; every field optional (null = unavailable). */
export interface BugReportEnv {
  devicePixelRatio?: number | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
  canvasWidth?: number | null;
  canvasHeight?: number | null;
  canvasCssWidth?: number | null;
  canvasCssHeight?: number | null;
  hardwareConcurrency?: number | null;
  deviceMemory?: number | null;
  webglVendor?: string | null;
  webglRenderer?: string | null;
  /** Settings reflow (Sol r1): the UI zoom factor the shell CONFIRMED (game/uiZoom.ts), and whether it refused one. */
  uiZoomApplied?: number | null;
  uiZoomUnavailable?: boolean | null;
}

export interface BugReportSettingsSnapshot {
  prefs: Record<(typeof BUG_REPORT_SETTINGS_KEYS)[number], BugReportSettingValue>;
  assetPacks: Record<(typeof BUG_REPORT_ASSET_PACK_SLOTS)[number], string | null>;
  env: { [K in keyof BugReportEnv]-?: Exclude<BugReportEnv[K], undefined> };
}

/** Enum ids and pack hashes only: short, no spaces, no slashes, no '@' - a path, URL, email or sentence never passes. */
const TOKEN = /^[A-Za-z0-9._-]{0,48}$/;
/** GPU strings are descriptive ("ANGLE (NVIDIA, ... Direct3D11 ...)"): a strict character set only - no '/', '\',
 *  ':', '@', '~' or quotes - capped at 160. */
const GPU = /^[A-Za-z0-9 ()_.,-]{1,160}$/;
/** ...and no whitespace-delimited token that looks like a file (library/exe name, relative/absolute path, drive). */
const FILELIKE_TOKEN = /\.(so|dll|dylib|exe)[),]*$|^[(]*[./\\~]|^[(]*[A-Za-z]:/i;

function prefValue(value: unknown): BugReportSettingValue {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return TOKEN.test(value) ? value : null;
  return null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function gpu(value: unknown): string | null {
  if (typeof value !== 'string' || !GPU.test(value)) return null;
  return value.split(/\s+/).some((token) => FILELIKE_TOKEN.test(token)) ? null : value;
}

/** Pure: the allow-listed snapshot. Never copies a key that is not named above. */
export function bugReportSettingsSnapshot(
  settings: Partial<AppSettings> | Record<string, unknown>,
  env: BugReportEnv = {},
): BugReportSettingsSnapshot {
  const source = settings as Record<string, unknown>;
  const prefs = {} as BugReportSettingsSnapshot['prefs'];
  for (const key of BUG_REPORT_SETTINGS_KEYS) prefs[key] = prefValue(source[key]);
  const rawAssignments = source.assetPackAssignments;
  const assignments = (rawAssignments && typeof rawAssignments === 'object' ? rawAssignments : {}) as Record<string, unknown>;
  const assetPacks = {} as BugReportSettingsSnapshot['assetPacks'];
  for (const slot of BUG_REPORT_ASSET_PACK_SLOTS) {
    const id = assignments[slot];
    assetPacks[slot] = typeof id === 'string' && TOKEN.test(id) ? id : null;
  }
  return {
    prefs,
    assetPacks,
    env: {
      devicePixelRatio: num(env.devicePixelRatio),
      viewportWidth: num(env.viewportWidth),
      viewportHeight: num(env.viewportHeight),
      canvasWidth: num(env.canvasWidth),
      canvasHeight: num(env.canvasHeight),
      canvasCssWidth: num(env.canvasCssWidth),
      canvasCssHeight: num(env.canvasCssHeight),
      hardwareConcurrency: num(env.hardwareConcurrency),
      deviceMemory: num(env.deviceMemory),
      webglVendor: gpu(env.webglVendor),
      webglRenderer: gpu(env.webglRenderer),
      uiZoomApplied: num(env.uiZoomApplied),
      uiZoomUnavailable: typeof env.uiZoomUnavailable === 'boolean' ? env.uiZoomUnavailable : null,
    },
  };
}

let gpuCache: { vendor: string | null; renderer: string | null } | null = null;

/** One throwaway WebGL context, once per session (the GPU does not change under a running client). */
function readGpu(): { vendor: string | null; renderer: string | null } {
  if (gpuCache) return gpuCache;
  gpuCache = { vendor: null, renderer: null };
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      gpuCache = {
        vendor: String(gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR) ?? '') || null,
        renderer: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '') || null,
      };
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* no WebGL: nulls */ }
  return gpuCache;
}

/** Impure: measure the machine now. `canvas` = the live pitch canvas when a game is open, else null. */
export function collectBugReportEnv(canvas: Element | null | undefined): BugReportEnv {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Partial<Navigator> & { deviceMemory?: number };
  const win = typeof window !== 'undefined' ? window : null;
  const pitch = canvas && typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement ? canvas : null;
  const rect = pitch?.getBoundingClientRect();
  const { vendor, renderer } = readGpu();
  return {
    devicePixelRatio: win?.devicePixelRatio ?? null,
    viewportWidth: win?.innerWidth ?? null,
    viewportHeight: win?.innerHeight ?? null,
    canvasWidth: pitch?.width ?? null,
    canvasHeight: pitch?.height ?? null,
    canvasCssWidth: rect ? Math.round(rect.width) : null,
    canvasCssHeight: rect ? Math.round(rect.height) : null,
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemory: nav.deviceMemory ?? null,
    webglVendor: vendor,
    webglRenderer: renderer,
    uiZoomApplied: uiZoomState.applied,
    uiZoomUnavailable: uiZoomState.unavailable,
  };
}
