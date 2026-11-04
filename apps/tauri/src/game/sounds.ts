import { settings } from './settings';
import builtinSounds from './builtinSounds.json';
import soundEventIds from './soundEventIds.json';
import { t } from '../i18n';

/**
 * FUMBBL sound playback (F-3, owner 2026-07-02): the wire's modelSync frames
 * carry a `sound` field (upstream SoundId name); files are the ffb-resources
 * originals served from /sounds/. EC-4 bundle-and-assume-goodwill applies.
 * Filenames mirror upstream's SoundEngine mapping (most are <name>.ogg; the
 * 44.wav clicks and td.ogg are upstream's own naming quirks).
 *
 * Owner 2026-07-03 r4: SOUND_CATALOG is the full set FUMBBL uses + the client
 * plays (from the server client.ini). Each entry can be overridden with a
 * owner pack target. `settings.soundOverrides` is a migration-only fallback for
 * older installs until native draft conversion succeeds.
 */
export interface SoundEntry {
  /** upstream SoundId (the wire `sound` value). */
  id: string;
  /** human label for the settings list. */
  label: string;
  /** Legacy filename retained for pack-builder/import compatibility. */
  file: string;
}

// The 39 FUMBBL sounds (client.ini `sound.<id>.file`) + breatheFire (our
// fireball variant). `touchdown` maps to td.ogg upstream.
export const SOUND_CATALOG: SoundEntry[] = [
  { id: 'block', get label() { return t('settings.sounds.soundCatalog.block'); }, file: 'block.ogg' },
  { id: 'blunder', get label() { return t('settings.sounds.soundCatalog.blunder'); }, file: 'blunder.ogg' },
  { id: 'bounce', get label() { return t('settings.sounds.soundCatalog.ballBounce'); }, file: 'bounce44.wav' },
  { id: 'catch', get label() { return t('settings.sounds.soundCatalog.catch'); }, file: 'catch44.wav' },
  { id: 'chainsaw', get label() { return t('settings.sounds.soundCatalog.chainsaw'); }, file: 'chainsaw.ogg' },
  { id: 'click', get label() { return t('settings.sounds.soundCatalog.click'); }, file: 'click44.wav' },
  { id: 'ding', get label() { return t('settings.sounds.soundCatalog.ding'); }, file: 'ding.ogg' },
  { id: 'dodge', get label() { return t('settings.sounds.soundCatalog.dodge'); }, file: 'dodge.ogg' },
  { id: 'duh', get label() { return t('settings.sounds.soundCatalog.duh'); }, file: 'duh.ogg' },
  { id: 'ew', get label() { return t('settings.sounds.soundCatalog.ew'); }, file: 'ew.ogg' },
  { id: 'explode', get label() { return t('settings.sounds.soundCatalog.explode'); }, file: 'explode.ogg' },
  { id: 'fall', get label() { return t('settings.sounds.soundCatalog.fall'); }, file: 'fall.ogg' },
  { id: 'fireball', get label() { return t('settings.sounds.soundCatalog.fireball'); }, file: 'fireball.ogg' },
  { id: 'breatheFire', get label() { return t('settings.sounds.soundCatalog.breatheFire'); }, file: 'breathe_fire.ogg' },
  { id: 'foul', get label() { return t('settings.sounds.soundCatalog.foul'); }, file: 'foul.ogg' },
  { id: 'hypno', get label() { return t('settings.sounds.soundCatalog.hypnoticGaze'); }, file: 'hypno.ogg' },
  { id: 'injury', get label() { return t('settings.sounds.soundCatalog.injury'); }, file: 'injury.ogg' },
  { id: 'kick', get label() { return t('settings.sounds.soundCatalog.kick'); }, file: 'kick.ogg' },
  { id: 'ko', get label() { return t('settings.sounds.soundCatalog.knockedOut'); }, file: 'ko.ogg' },
  { id: 'metal', get label() { return t('settings.sounds.soundCatalog.metal'); }, file: 'metal.ogg' },
  { id: 'nomnom', get label() { return t('settings.sounds.soundCatalog.nomNomEat'); }, file: 'nomnom.ogg' },
  { id: 'organ', get label() { return t('settings.sounds.soundCatalog.organ'); }, file: 'organ.ogg' },
  { id: 'pickup', get label() { return t('settings.sounds.soundCatalog.ballPickup'); }, file: 'pickup.ogg' },
  { id: 'pumpcrowd', get label() { return t('settings.sounds.soundCatalog.crowdPump'); }, file: 'pumpcrowd.ogg' },
  { id: 'question', get label() { return t('settings.sounds.soundCatalog.question'); }, file: 'question.ogg' },
  { id: 'rip', get label() { return t('settings.sounds.soundCatalog.ripKilled'); }, file: 'rip.ogg' },
  { id: 'roar', get label() { return t('settings.sounds.soundCatalog.roar'); }, file: 'roar.ogg' },
  { id: 'root', get label() { return t('settings.sounds.soundCatalog.takeRoot'); }, file: 'root.ogg' },
  { id: 'slurp', get label() { return t('settings.sounds.soundCatalog.slurp'); }, file: 'slurp.ogg' },
  { id: 'stab', get label() { return t('settings.sounds.soundCatalog.stab'); }, file: 'stab.ogg' },
  { id: 'step', get label() { return t('settings.sounds.soundCatalog.step'); }, file: 'step44.wav' },
  { id: 'swoop', get label() { return t('settings.sounds.soundCatalog.swoop'); }, file: 'swoop.ogg' },
  { id: 'throw', get label() { return t('settings.sounds.soundCatalog.throw'); }, file: 'throw44.wav' },
  { id: 'touchdown', get label() { return t('settings.sounds.soundCatalog.touchdown'); }, file: 'td.ogg' },
  { id: 'trapdoor', get label() { return t('settings.sounds.soundCatalog.trapDoor'); }, file: 'trapdoor.ogg' },
  { id: 'vomit', get label() { return t('settings.sounds.soundCatalog.vomit'); }, file: 'vomit.ogg' },
  { id: 'whistle', get label() { return t('settings.sounds.soundCatalog.whistle'); }, file: 'whistle.ogg' },
  { id: 'woooaaah', get label() { return t('settings.sounds.soundCatalog.woooAaahCrowd'); }, file: 'woooaaah.ogg' },
  { id: 'yoink', get label() { return t('settings.sounds.soundCatalog.yoink'); }, file: 'yoink.ogg' },
  { id: 'zap', get label() { return t('settings.sounds.soundCatalog.zap'); }, file: 'zap.ogg' },
  // Owner 2026-07-03: our own turnover sting — a synthesized (public-domain) sad
  // trombone, replacing FUMBBL's 'duh' for the turnover splash. Not a wire SoundId.
  { id: 'sad_trombone', get label() { return t('settings.sounds.soundCatalog.sadTromboneTurnover'); }, file: 'sad_trombone.wav' },
  // Owner 2026-07-06: a synthesized cartoon "boing" for a Jump/Leap — FUMBBL's
  // SoundId set has no leap/springboard sound, so this is our own sting (not a
  // wire SoundId), overridable like any other.
  { id: 'boing', get label() { return t('settings.sounds.soundCatalog.boingJumpLeap'); }, file: 'boing.wav' },
  // Owner 2026-07-08: an "angel" sting for a Steady Footing SAVE (a player who'd be
  // Knocked Down rolls a 6 and stays up). PLACEHOLDER — no bundled file yet, so it's
  // silent until the owner drops an angel.ogg into /sounds or sets a local override in
  // Settings › Sounds. Not a wire SoundId.
  { id: 'angel', get label() { return t('settings.sounds.soundCatalog.angelSteadyFootingSave'); }, file: 'angel.ogg' },
  { id: 'chatToast', get label() { return t('settings.sounds.soundCatalog.chatToast'); }, file: 'chatToast.ogg' },
  { id: 'setupPlace', get label() { return t('settings.sounds.soundCatalog.setupPlayerPlaced'); }, file: 'setupPlace.ogg' },
  // Owner 10-19: client-only UI cues (Cyberleaf Retro SFX, shipped unmodified inside the app: installer + app patches, owner 10-19). Each can be turned off
  // (or, for the waypoint, swapped) in Settings › Sound via settings.soundStyles.
  { id: 'plannerWaypoint', get label() { return t('settings.sounds.soundCatalog.plannerWaypointPlotted'); }, file: 'plannerWaypoint.wav' },
  { id: 'actionCancel', get label() { return t('settings.sounds.soundCatalog.actionCancelled'); }, file: 'actionCancel.wav' },
  { id: 'turnClockMinute', get label() { return t('settings.sounds.soundCatalog.turnClock1Minute'); }, file: 'turnClockMinute.wav' },
  { id: 'turnClockCountdown', get label() { return t('settings.sounds.soundCatalog.turnClockLast5'); }, file: 'turnClockCountdown.wav' },
  { id: 'rollFailed', get label() { return t('settings.sounds.soundCatalog.failedRoll'); }, file: 'rollFailed.wav' },
];

/** Owner 10-19: `settings.soundStyles[id] === SOUND_STYLE_OFF` silences that one event (Settings › Sound). */
export const SOUND_STYLE_OFF = 'off';
/** Settings reflow (Sol r1): the turn-clock warning tone answers to Settings > Audio "Turn clock warning" alone
 *  (settings.turnClockWarning; the view only plays it when the select allows). The retired "Turn clock 1 minute"
 *  toggle's soundStyles entry is never consulted, so a stale one can not silence the select. */
export const SELECT_OWNED_SOUND_IDS: ReadonlySet<string> = new Set(['turnClockMinute']);
function soundEventOff(soundId: string): boolean {
  if (SELECT_OWNED_SOUND_IDS.has(soundId)) return false;
  return settings.soundStyles[soundId] === SOUND_STYLE_OFF;
}

const SOUND_IDS = new Set(soundEventIds);
if (SOUND_CATALOG.length !== soundEventIds.length
  || SOUND_CATALOG.some((sound, index) => sound.id !== soundEventIds[index])) {
  throw new Error('Sound catalog does not match the shared native event registry');
}
let activeSoundEventUrls: ReadonlyMap<string, string> = new Map();

type BuiltinSoundLeaf = string | string[] | Record<string, string[]>;
interface BuiltinSoundStyles { styles: Record<string, BuiltinSoundLeaf>; default: string }
type BuiltinSoundManifestValue = BuiltinSoundLeaf | BuiltinSoundStyles;
type ResolvedBuiltinSoundLeaf = string | readonly string[] | Readonly<Record<string, readonly string[]>>;
interface ResolvedBuiltinSoundStyles {
  styles: Readonly<Record<string, ResolvedBuiltinSoundLeaf>>;
  default: string;
}
type ResolvedBuiltinSoundValue = ResolvedBuiltinSoundLeaf | ResolvedBuiltinSoundStyles;

const SOUND_ASSET_URLS = import.meta.glob('../assets/sounds/**/*.{ogg,wav}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const missingBuiltinSounds: string[] = [];

/** A built-in sound file that is not in this build. The public source tree ships without the
 *  licensed sound library (see .gitignore), so a self-build must boot with those events silent
 *  rather than fail at module evaluation and leave a blank window. */
function resolveAssetPath(relativePath: string): string | undefined {
  const url = SOUND_ASSET_URLS[`../assets/sounds/${relativePath}`];
  if (!url) missingBuiltinSounds.push(relativePath);
  return url;
}

function resolvePaths(paths: readonly string[]): string[] {
  return paths.map(resolveAssetPath).filter((url): url is string => url !== undefined);
}

function resolveManifestLeaf(value: BuiltinSoundLeaf): ResolvedBuiltinSoundLeaf | undefined {
  if (typeof value === 'string') return resolveAssetPath(value);
  if (Array.isArray(value)) return resolvePaths(value);
  return Object.fromEntries(Object.entries(value).map(([weather, paths]) => [weather, resolvePaths(paths)]));
}

function isBuiltinSoundStyles(value: BuiltinSoundManifestValue): value is BuiltinSoundStyles {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as { styles?: unknown; default?: unknown };
  return candidate.styles != null && typeof candidate.styles === 'object' && typeof candidate.default === 'string';
}

function resolveManifestValue(value: BuiltinSoundManifestValue): ResolvedBuiltinSoundValue | undefined {
  if (isBuiltinSoundStyles(value)) {
    const styles: Record<string, ResolvedBuiltinSoundLeaf> = {};
    for (const [style, leaf] of Object.entries(value.styles)) {
      const resolved = resolveManifestLeaf(leaf);
      if (resolved !== undefined) styles[style] = resolved;
    }
    return { styles, default: value.default };
  }
  return resolveManifestLeaf(value);
}

function isResolvedBuiltinSoundStyles(value: ResolvedBuiltinSoundValue): value is ResolvedBuiltinSoundStyles {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as { styles?: unknown; default?: unknown };
  return candidate.styles != null && typeof candidate.styles === 'object' && typeof candidate.default === 'string';
}

if (builtinSounds.sad_trombone !== 'sad_trombone.wav') {
  throw new Error('Built-in sad_trombone must resolve from sad_trombone.wav');
}

const BUILTIN_SOUND_URLS: ReadonlyMap<string, ResolvedBuiltinSoundValue> = new Map(
  Object.entries(builtinSounds as Record<string, BuiltinSoundManifestValue>)
    .flatMap(([soundId, value]) => {
      const resolved = resolveManifestValue(value);
      return resolved === undefined ? [] : [[soundId, resolved] as const];
    }),
);
if (missingBuiltinSounds.length > 0) {
  console.warn(
    `${missingBuiltinSounds.length} built-in sound file(s) are not in this build; those events stay silent `
    + `until an asset pack or a Settings › Sounds override supplies them: ${missingBuiltinSounds.join(', ')}`,
  );
}
const builtinRoundRobinCursors = new Map<string, number>();
let currentSoundWeather: string | null = null;

export function setSoundWeather(weather: string | null | undefined): void {
  if (weather == null) {
    currentSoundWeather = null;
    return;
  }
  const normalized = weather.toLowerCase().replace(/[^a-z]/g, '');
  currentSoundWeather = ({
    heat: 'heat',
    swelteringheat: 'heat',
    sunny: 'sunny',
    verysunny: 'sunny',
    nice: 'nice',
    niceweather: 'nice',
    rain: 'rain',
    pouringrain: 'rain',
    blizzard: 'blizzard',
    intro: 'intro',
  } as Record<string, string>)[normalized] ?? null;
}

function builtinVariants(soundId: string): readonly string[] | undefined {
  let value = BUILTIN_SOUND_URLS.get(soundId);
  if (!value) return undefined;
  if (isResolvedBuiltinSoundStyles(value)) {
    const selectedStyle = settings.soundStyles[soundId] ?? value.default;
    value = value.styles[selectedStyle] ?? value.styles[value.default];
    if (!value) return undefined;
  }
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value;
  const weatherValue = value as Readonly<Record<string, readonly string[]>>;
  const weather = currentSoundWeather;
  const key = weather && Object.hasOwn(weatherValue, weather) ? weather : 'nice';
  return weatherValue[key];
}

/** Pure built-in resolver; callers may supply a variant index without advancing playback state. */
export function resolveBuiltinSoundUrl(soundId: string, variantIndex = 0): string | undefined {
  const variants = builtinVariants(soundId);
  if (!variants?.length) return undefined;
  const index = ((variantIndex % variants.length) + variants.length) % variants.length;
  return variants[index];
}

function nextBuiltinSoundUrl(soundId: string): string | undefined {
  const cursor = builtinRoundRobinCursors.get(soundId) ?? 0;
  const url = resolveBuiltinSoundUrl(soundId, cursor);
  if (url) builtinRoundRobinCursors.set(soundId, cursor + 1);
  return url;
}

export function prepareSoundEventPack(bindings: readonly { eventId: string; url: string }[]): ReadonlyMap<string, string> {
  const next = new Map<string, string>();
  for (const binding of bindings) {
    if (!SOUND_IDS.has(binding.eventId) || next.has(binding.eventId)) {
      throw new Error('Invalid sound-event target in installed pack');
    }
    next.set(binding.eventId, binding.url);
  }
  return next;
}

/** Publish the next-event resolver without touching elements already playing. */
export function activateSoundEventPack(candidate: ReadonlyMap<string, string>): void {
  activeSoundEventUrls = candidate;
}

/** User files are merged ahead of the assigned pack during activation. */
function sourceFor(soundId: string): string | undefined {
  const packed = activeSoundEventUrls.get(soundId);
  if (packed) return packed;
  // Bundled Super FUMBBL sounds: round-robin per event; weather-keyed events use
  // the last applied wire weather and fall back to 'nice' before the first sync.
  return nextBuiltinSoundUrl(soundId);
}

const cache = new Map<string, HTMLAudioElement>();
const playingAudio = new Set<HTMLAudioElement>();
const audioSources = new WeakMap<HTMLAudioElement, string>();
const trackedAudio = new WeakSet<HTMLAudioElement>();
const retirementWaiters = new Set<() => void>();
/** Astra r1: each HTML play is an attempt; only the attempt that still owns playback may fall back to Web Audio
 *  (a late `error` after stop / settle / retirement still reports, but never starts a new sound). */
interface HtmlAttempt { active: boolean }
const htmlAttempts = new WeakMap<HTMLAudioElement, HtmlAttempt>();

function notifyAudioSettlement(): void {
  for (const notify of [...retirementWaiters]) notify();
}

function endHtmlAttempt(audio: HTMLAudioElement): void {
  const attempt = htmlAttempts.get(audio);
  if (attempt) attempt.active = false;
}

/** Starts a new attempt on `audio` (superseding any older one) and returns its token. */
function trackPlayback(audio: HTMLAudioElement, src: string): HtmlAttempt {
  const previous = htmlAttempts.get(audio);
  if (previous) previous.active = false;
  const attempt: HtmlAttempt = { active: true };
  htmlAttempts.set(audio, attempt);
  audioSources.set(audio, src);
  playingAudio.add(audio);
  if (trackedAudio.has(audio)) return attempt;
  trackedAudio.add(audio);
  // Astra r2: these listeners outlive attempts. A queued pause/ended from an OLDER play can arrive after a replay of
  // the same cached element; the element then reports it is playing again (`paused === false` for a pause,
  // `ended === false` for an ended), so the event is stale and must not settle the newer attempt.
  const settledByMediaEvent = (stale: () => boolean) => () => {
    if (stale()) return;
    endHtmlAttempt(audio);
    playingAudio.delete(audio);
    notifyAudioSettlement();
  };
  audio.addEventListener('ended', settledByMediaEvent(() => audio.ended === false));
  audio.addEventListener('pause', settledByMediaEvent(() => audio.paused === false));
  // 'error' settles tracking but leaves the attempt to onHtmlAudioError (it decides on the fallback, then ends it).
  audio.addEventListener('error', () => {
    playingAudio.delete(audio);
    notifyAudioSettlement();
  });
  return attempt;
}

/** play() rejected (autoplay block, abort): that attempt no longer owns playback. A rejection of an older play
 *  that arrives after a replay touches only its own (already superseded) token. */
function htmlPlayRejected(audio: HTMLAudioElement, attempt: HtmlAttempt): void {
  attempt.active = false;
  if (htmlAttempts.get(audio) !== attempt) return;
  playingAudio.delete(audio);
  notifyAudioSettlement();
}

/* Web Audio engine (owner 10-23, OP Train, Debian 13 / WebKitGTK).
 * WebKitGTK's media player cannot consume our bundled files from the tauri:// scheme (`loadingFailed: FormatError`
 * for every sound, while the same codecs play through GStreamer directly). fetch() + decodeAudioData() does not go
 * through that player, so Linux plays through Web Audio; elsewhere a src that fails in an <audio> element falls
 * back to it. One shared context, decoded buffers cached per src, every play is its own source -> gain -> out. */

/** A Web Audio play: `cleanup` is set once its nodes exist (disconnects source and gain, drops the handler). */
interface WebPlayback {
  src: string;
  cancelled: boolean;
  source: AudioBufferSourceNode | null;
  cleanup: (() => void) | null;
  /** The play's single bounded wait for a running context (one deadline per play), and its canceller. */
  runningWait: Promise<boolean> | null;
  abortWait: (() => void) | null;
}
const playingWeb = new Set<WebPlayback>();
/** Decoded buffers, least recently played first (a play re-inserts its src at the end). */
const decodedBuffers = new Map<string, AudioBuffer>();
const pendingBuffers = new Map<string, Promise<AudioBuffer | null>>();
/** Srcs whose fetch/decode failed: no refetch (no loop) until the cache is invalidated or the log is cleared. */
const failedWebSrcs = new Set<string>();
/** Srcs that failed in the HTML audio path: they play through Web Audio from then on. */
const webAudioFallbackSrcs = new Set<string>();
let audioContext: AudioContext | null = null;
let backgroundResume: Promise<void> | null = null;
let webAudioPreferenceOverride: boolean | null = null;

/** Astra r1 memory budget: the built-ins are ≈1.56 MiB encoded / ≈12.3 MiB decoded at 48 kHz and stay exempt;
 *  PACK sounds (any other src) keep at most 64 MiB of decoded PCM, evicting least-recently-played idle buffers. */
const PACK_DECODED_BUDGET_BYTES = 64 * 1024 * 1024;
const BUILTIN_SRCS: ReadonlySet<string> = new Set(Object.values(SOUND_ASSET_URLS));
function decodedBytes(buffer: AudioBuffer): number {
  const length = Number(buffer.length) || 0;
  const channels = Number(buffer.numberOfChannels) || 0;
  return length * channels * 4;
}
function packDecodedBytes(): number {
  let total = 0;
  for (const [src, buffer] of decodedBuffers) if (!BUILTIN_SRCS.has(src)) total += decodedBytes(buffer);
  return total;
}
/** Test hook: decoded PCM bytes currently cached for pack (non-built-in) sounds. */
export function decodedPackBufferBytes(): number { return packDecodedBytes(); }
function enforcePackBudget(): void {
  let total = packDecodedBytes();
  if (total <= PACK_DECODED_BUDGET_BYTES) return;
  const playingSrcs = new Set([...playingWeb].map((playback) => playback.src));
  for (const [src, buffer] of [...decodedBuffers]) {
    if (total <= PACK_DECODED_BUDGET_BYTES) break;
    if (BUILTIN_SRCS.has(src) || playingSrcs.has(src)) continue;
    decodedBuffers.delete(src);
    total -= decodedBytes(buffer);
  }
}
/** LRU touch: reorders only the buffer the cache already holds for `src`, so a stale decode that invalidation
 *  dropped is never re-inserted (Astra r2). */
function touchBuffer(src: string, buffer: AudioBuffer): void {
  if (decodedBuffers.get(src) !== buffer) return;
  decodedBuffers.delete(src);
  decodedBuffers.set(src, buffer);
}

type AudioContextCtor = new () => AudioContext;
function audioContextCtor(): AudioContextCtor | undefined {
  const g = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return g.AudioContext ?? g.webkitAudioContext;
}

/** Pure platform check: Linux (not Android) plays through Web Audio. */
export function isLinuxPlatform(nav: { userAgent?: string; platform?: string } | undefined): boolean {
  if (!nav) return false;
  const ua = nav.userAgent ?? '';
  if (ua.includes('Android')) return false;
  return ua.includes('Linux') || (nav.platform ?? '').startsWith('Linux');
}

/** True when sounds should play through Web Audio rather than <audio> elements (Linux / WebKitGTK). */
export function preferWebAudio(): boolean {
  if (webAudioPreferenceOverride !== null) return webAudioPreferenceOverride;
  return isLinuxPlatform((globalThis as { navigator?: { userAgent?: string; platform?: string } }).navigator);
}

/** Test hook: force the engine preference (null restores platform detection). */
export function setWebAudioPreferenceOverride(value: boolean | null): void {
  webAudioPreferenceOverride = value;
}

/** A user gesture always makes its own resume attempt (the one a blocked autoplay policy is waiting for). */
function resumeOnGesture(): void {
  const ctx = audioContext;
  if (!ctx || ctx.state === 'running') return;
  try { void ctx.resume().catch(() => { /* still blocked */ }); } catch { /* closed */ }
}

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try { audioContext = new Ctor(); } catch { return null; }
  const target = globalThis as { addEventListener?: (type: string, fn: () => void, opts?: unknown) => void };
  if (typeof target.addEventListener === 'function') {
    for (const type of ['pointerdown', 'keydown', 'touchstart']) target.addEventListener(type, resumeOnGesture, { capture: true, passive: true });
  }
  return audioContext;
}

/** Astra r1/r2: ONE outstanding background resume() per context with ONE completion handler; plays wait through
 *  removable entries in `resumeWaiters` (deleted on timeout / cancel), never by chaining onto the request. */
const resumeWaiters = new Set<() => void>();
/** Test hook: plays currently waiting on the shared resume request. */
export function pendingResumeWaiterCount(): number { return resumeWaiters.size; }
function requestSharedResume(ctx: AudioContext): void {
  if (backgroundResume) return;
  let request: unknown;
  try { request = ctx.resume(); } catch { request = undefined; }
  const marker: Promise<void> = Promise.resolve();
  backgroundResume = marker;
  const done = () => {
    if (backgroundResume === marker) backgroundResume = null;
    for (const waiter of [...resumeWaiters]) waiter();
  };
  if (request && typeof (request as PromiseLike<unknown>).then === 'function') (request as PromiseLike<unknown>).then(done, done);
  else done();
}

const RESUME_WAIT_MS = 300;
/** Bounded wait for a running context, one per play: a cue blocked longer than this is dropped, never queued into a
 *  burst for later (autoplay parity with the <audio> path). */
function waitForRunning(ctx: AudioContext, playback: WebPlayback): Promise<boolean> {
  if (playback.runningWait) return playback.runningWait;
  if (ctx.state === 'running') return Promise.resolve(true);
  playback.runningWait = new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      resumeWaiters.delete(finish);
      if (timer !== undefined) clearTimeout(timer);
      playback.abortWait = null;
      resolve(!playback.cancelled && ctx.state === 'running');
    };
    resumeWaiters.add(finish);
    timer = setTimeout(finish, RESUME_WAIT_MS);
    playback.abortWait = finish;
    requestSharedResume(ctx);
  });
  return playback.runningWait;
}

function errorSuffix(error: unknown): string {
  return error instanceof Error && error.message ? ` (${error.message})` : '';
}

function loadBuffer(ctx: AudioContext, soundId: string, src: string): Promise<AudioBuffer | null> {
  const ready = decodedBuffers.get(src);
  if (ready) return Promise.resolve(ready);
  if (failedWebSrcs.has(src)) return Promise.resolve(null);
  const inflight = pendingBuffers.get(src);
  if (inflight) return inflight;
  let loading: Promise<AudioBuffer | null> | null = null;
  const fail = (message: string): null => {
    if (pendingBuffers.get(src) === loading) {
      pendingBuffers.delete(src);
      loadTimeoutCooldownUntil.delete(src);
      failedWebSrcs.add(src);
      reportSoundFailure(soundId, src, null, sanitizeMediaMessage(message));
    }
    return null;
  };
  loading = (async () => {
    await Promise.resolve(); // let `loading` register before any failure path runs
    let bytes: ArrayBuffer;
    try {
      if (typeof fetch !== 'function') return fail('web audio: fetch unavailable');
      const response = await fetch(src);
      if (!response.ok) return fail(`web audio: fetch ${response.status}`);
      bytes = await response.arrayBuffer();
    } catch (error) {
      return fail(`web audio: fetch failed${errorSuffix(error)}`);
    }
    try {
      // Promise form, with the legacy callback form covered for older WebKit builds.
      const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
        const result = ctx.decodeAudioData(bytes, resolve, reject) as Promise<AudioBuffer> | undefined;
        if (result && typeof result.then === 'function') result.then(resolve, reject);
      });
      if (pendingBuffers.get(src) !== loading) return buffer; // invalidated mid-decode: do not repopulate
      pendingBuffers.delete(src);
      loadTimeoutCooldownUntil.delete(src);
      decodedBuffers.set(src, buffer);
      enforcePackBudget();
      return buffer;
    } catch (error) {
      return fail(`web audio: decode failed${errorSuffix(error)}`);
    }
  })();
  pendingBuffers.set(src, loading);
  return loading;
}

/** Astra r2/r3 watchdog: a fetch/decode that has not settled within LOAD_WATCHDOG_MS releases the PLAY that waits on
 *  it (so a pack retirement cannot hang), reported once per src. A timeout is retryable, not a failure: the load
 *  stays in flight and a late success is cached for later cues. Once a src has timed out, its still-pending load is
 *  joined for LOAD_RETRY_COOLDOWN_MS; after that a new load replaces it (the old one can then no longer publish). */
const LOAD_WATCHDOG_MS = 10_000;
const LOAD_RETRY_COOLDOWN_MS = 30_000;
const loadTimeoutCooldownUntil = new Map<string, number>();
function loadForPlay(ctx: AudioContext, soundId: string, src: string): Promise<AudioBuffer | null> {
  const until = loadTimeoutCooldownUntil.get(src);
  if (until !== undefined && Date.now() >= until && pendingBuffers.has(src)) {
    pendingBuffers.delete(src); // cooldown over and still hung: retry with a fresh load
    loadTimeoutCooldownUntil.delete(src);
  }
  return loadBuffer(ctx, soundId, src);
}
function loadTimedOut(soundId: string, src: string): void {
  if (!loadTimeoutCooldownUntil.has(src)) loadTimeoutCooldownUntil.set(src, Date.now() + LOAD_RETRY_COOLDOWN_MS);
  reportSoundFailure(soundId, src, null, 'web audio: load timed out');
}

/** Ends a play however it ended (natural end, stop, cancel, timeout, failed start): nodes detached, its resume wait
 *  withdrawn, and the pack budget re-applied now that its buffer may be idle. */
function releaseWeb(playback: WebPlayback): boolean {
  playback.cancelled = true;
  playback.cleanup?.();
  playback.cleanup = null;
  playback.abortWait?.();
  return playingWeb.delete(playback);
}
function settleWeb(playback: WebPlayback): void {
  if (!releaseWeb(playback)) return;
  enforcePackBudget();
  notifyAudioSettlement();
}

/** Starts only on a context that is running right now (checked here, not before the decode). */
function startWebSource(ctx: AudioContext, playback: WebPlayback, buffer: AudioBuffer, volume: number): void {
  if (playback.cancelled) return;
  if (ctx.state !== 'running') { settleWeb(playback); return; }
  let source: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = null;
  playback.cleanup = () => {
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* not started / already stopped */ }
      try { source.disconnect(); } catch { /* already detached */ }
    }
    if (gain) { try { gain.disconnect(); } catch { /* already detached */ } }
  };
  try {
    source = ctx.createBufferSource();
    source.buffer = buffer;
    gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.onended = () => settleWeb(playback);
    playback.source = source;
    touchBuffer(playback.src, buffer);
    source.start(0);
    enforcePackBudget();
  } catch {
    settleWeb(playback);
  }
}

/** Play `src` through Web Audio at `volume` (0..1). Returns false when no AudioContext is available. */
function playViaWebAudio(soundId: string, src: string, volume: number): boolean {
  const ctx = getAudioContext();
  if (!ctx) return false;
  if (failedWebSrcs.has(src)) return true; // already reported; stop (no loop)
  const playback: WebPlayback = { src, cancelled: false, source: null, cleanup: null, runningWait: null, abortWait: null };
  playingWeb.add(playback);
  // Blocked context: bounded wait in parallel with the load, so a timed-out cue settles even if the load stalls.
  if (ctx.state !== 'running') {
    void waitForRunning(ctx, playback).then((running) => { if (!running) settleWeb(playback); });
  }
  const begin = (buffer: AudioBuffer | null) => {
    if (playback.cancelled) return;
    if (!buffer) { settleWeb(playback); return; }
    if (ctx.state === 'running') { startWebSource(ctx, playback, buffer, volume); return; }
    // Suspended between play and decode: the same (single, per-play) bounded wait, re-checked right before the start.
    void waitForRunning(ctx, playback).then((running) => {
      if (running) startWebSource(ctx, playback, buffer, volume);
      else settleWeb(playback);
    });
  };
  const ready = decodedBuffers.get(src);
  if (ready) { begin(ready); return true; }
  const watchdog = setTimeout(() => {
    if (playback.cancelled || playback.source) return;
    loadTimedOut(soundId, src);
    settleWeb(playback);
  }, LOAD_WATCHDOG_MS);
  void loadForPlay(ctx, soundId, src).then(
    (buffer) => { clearTimeout(watchdog); begin(buffer); },
    () => { clearTimeout(watchdog); settleWeb(playback); },
  );
  return true;
}

function useWebAudioFor(src: string): boolean {
  if (!audioContextCtor()) return false;
  return preferWebAudio() || webAudioFallbackSrcs.has(src) || typeof Audio === 'undefined';
}

/** HTML <audio> error: report it; retry this play through Web Audio once per src, and only while this attempt
 *  still owns playback (not after stop, a rejected play(), a natural end or a pack retirement). */
function onHtmlAudioError(soundId: string, src: string, audio: HTMLAudioElement): void {
  reportSoundError(soundId, src, audio);
  const attempt = htmlAttempts.get(audio);
  const ownsPlayback = attempt?.active === true;
  if (attempt) attempt.active = false;
  if (webAudioFallbackSrcs.has(src)) return;
  webAudioFallbackSrcs.add(src);
  if (!ownsPlayback) return;
  const volume = typeof audio.volume === 'number' ? audio.volume : Math.max(0, Math.min(100, settings.soundVolume)) / 100;
  if (volume > 0) playViaWebAudio(soundId, src, volume);
}

/** Keep native containers leased until every element that already resolved one
 * of these URLs has naturally finished (or failed/paused). Web Audio plays (decoding or sounding) count too. */
export function waitForSoundUrlsRetirement(urls: ReadonlySet<string>): Promise<void> {
  const pending = () => [...playingAudio].some((audio) => urls.has(audioSources.get(audio) ?? ''))
    || [...playingWeb].some((playback) => urls.has(playback.src));
  const releaseCache = () => {
    for (const url of urls) {
      const audio = cache.get(url);
      if (audio) endHtmlAttempt(audio);
      cache.delete(url);
      decodedBuffers.delete(url);
      pendingBuffers.delete(url);
      failedWebSrcs.delete(url);
      loadTimeoutCooldownUntil.delete(url);
    }
  };
  if (!pending()) { releaseCache(); return Promise.resolve(); }
  return new Promise((resolve) => {
    const check = () => {
      if (pending()) return;
      retirementWaiters.delete(check);
      releaseCache();
      resolve();
    };
    retirementWaiters.add(check);
  });
}

// Owner 2026-07-08: while the spectator playback is FAST-FORWARDING a join/switch backlog,
// mute everything — otherwise the whole game's sounds replay in a burst as the board catches
// up. The store toggles this around the catch-up drain.
let suppressed = false;
export function setSoundsSuppressed(v: boolean): void { suppressed = v; }

/** Stop already-started cues when presentation ownership changes (HTML elements and Web Audio sources,
 *  including Web Audio plays still decoding). */
export function stopPresentationSounds(): void {
  for (const audio of [...playingAudio]) {
    endHtmlAttempt(audio);
    audio.pause();
    playingAudio.delete(audio);
  }
  for (const playback of [...playingWeb]) releaseWeb(playback);
  enforcePackBudget();
  notifyAudioSettlement();
}

/** Controller support P2b: listeners told of every cue that would play (before the volume / mute check) — the pad
 *  rumble (game/haptics.ts) rides the same beat. Never told while suppressed (fast-forward catch-up). */
const soundCueListeners = new Set<(soundId: string) => void>();
export function onSoundCue(listener: (soundId: string) => void): () => void {
  soundCueListeners.add(listener);
  return () => { soundCueListeners.delete(listener); };
}

/** Owner 10-23 (OP Train, Debian): a sound that fails to LOAD or DECODE used to warn only on the web console,
 *  which a terminal run and the bug-report app log never see. Listeners (the store) route it into the client
 *  log so a report carries it. One line per source (across both engines): a missing codec fails every play of
 *  the same file. */
const soundErrorListeners = new Set<(detail: SoundErrorDetail) => void>();
export interface SoundErrorDetail { soundId: string; src: string; code: number | null; message: string }
export function onSoundError(listener: (detail: SoundErrorDetail) => void): () => void {
  soundErrorListeners.add(listener);
  return () => { soundErrorListeners.delete(listener); };
}
const reportedSoundErrors = new Set<string>();
/** The client log was cleared (new connection / left game): report failures again so the next report carries them.
 *  A Web Audio src that failed gets one fresh attempt (and so at most one fresh line). */
export function resetSoundErrorReports(): void { reportedSoundErrors.clear(); failedWebSrcs.clear(); }
/** Astra 10-23: the browser's MediaError text is unbounded and may carry a URL — one line, no query/fragment, capped. */
function sanitizeMediaMessage(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, ' ').replace(/([?#])[^\s)]*/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, 120);
}
const MEDIA_ERROR_NAMES: Record<number, string> = { 1: 'aborted', 2: 'network', 3: 'decode', 4: 'source not supported' };
function reportSoundFailure(soundId: string, src: string, code: number | null, message: string): void {
  if (reportedSoundErrors.has(src)) return;
  reportedSoundErrors.add(src);
  console.warn(`sound failed: ${src.slice(0, 60)} (${message})`);
  const detail: SoundErrorDetail = { soundId, src, code, message };
  for (const listener of [...soundErrorListeners]) {
    try { listener(detail); } catch { /* presentation-only */ }
  }
}
function reportSoundError(soundId: string, src: string, audio: HTMLAudioElement): void {
  const err = audio.error;
  const code = typeof err?.code === 'number' ? err.code : null;
  const browserText = err?.message ? sanitizeMediaMessage(err.message) : '';
  const message = browserText || (code !== null ? MEDIA_ERROR_NAMES[code] ?? `media error ${code}` : 'unknown');
  reportSoundFailure(soundId, src, code, message);
}

export function playSound(soundId: string | null | undefined): void {
  if (!soundId || suppressed || soundEventOff(soundId)) return;
  for (const listener of [...soundCueListeners]) {
    try { listener(soundId); } catch { /* presentation-only */ }
  }
  // Owner 08-17: replay's fast collapse path (2x/4x) now calls this from a plain model-fold — an
  // environment without a real Audio constructor (headless test runner, an embedding without media)
  // must not throw and abort the fold. Sound is presentation-only; missing playback is a silent no-op.
  if (typeof Audio === 'undefined' && !audioContextCtor()) return;
  const volume = Math.max(0, Math.min(100, settings.soundVolume));
  if (volume === 0) return;
  const src = sourceFor(soundId);
  if (!src) return;
  if (useWebAudioFor(src) && playViaWebAudio(soundId, src, volume / 100)) return;
  if (typeof Audio === 'undefined') return;
  let audio = cache.get(src);
  if (!audio) {
    audio = new Audio(src);
    const el = audio;
    audio.addEventListener('error', () => onHtmlAudioError(soundId, src, el));
    cache.set(src, audio);
  }
  audio.volume = volume / 100;
  audio.currentTime = 0;
  const attempt = trackPlayback(audio, src);
  const el = audio;
  void audio.play().catch(() => {
    htmlPlayRejected(el, attempt);
    /* autoplay may be blocked until first user gesture — fine */
  });
}

/** Settings preview: play a sound at (at least audible) volume, ignoring mute so
 *  the user can hear a candidate override. */
export function previewSound(soundId: string): void {
  if (soundEventOff(soundId)) return;
  const src = sourceFor(soundId);
  if (!src) return;
  const volume = Math.max(0.4, Math.min(1, settings.soundVolume / 100));
  if (useWebAudioFor(src) && playViaWebAudio(soundId, src, volume)) return;
  if (typeof Audio === 'undefined') return;
  const audio = new Audio(src);
  audio.addEventListener('error', () => onHtmlAudioError(soundId, src, audio));
  audio.volume = volume;
  const attempt = trackPlayback(audio, src);
  void audio.play().catch(() => { htmlPlayRejected(audio, attempt); });
}

/** Drop the cached HTMLAudioElements and decoded Web Audio buffers (e.g. after an override changes or is
 *  cleared) so the next play re-resolves and re-decodes the source. */
export function invalidateSoundCache(): void {
  cache.clear();
  decodedBuffers.clear();
  pendingBuffers.clear();
  failedWebSrcs.clear();
  loadTimeoutCooldownUntil.clear();
}
