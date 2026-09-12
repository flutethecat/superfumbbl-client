import { settings } from './settings';
import builtinSounds from './builtinSounds.json';
import soundEventIds from './soundEventIds.json';

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
  { id: 'block', label: 'Block', file: 'block.ogg' },
  { id: 'blunder', label: 'Blunder', file: 'blunder.ogg' },
  { id: 'bounce', label: 'Ball bounce', file: 'bounce44.wav' },
  { id: 'catch', label: 'Catch', file: 'catch44.wav' },
  { id: 'chainsaw', label: 'Chainsaw', file: 'chainsaw.ogg' },
  { id: 'click', label: 'Click', file: 'click44.wav' },
  { id: 'ding', label: 'Ding', file: 'ding.ogg' },
  { id: 'dodge', label: 'Dodge', file: 'dodge.ogg' },
  { id: 'duh', label: 'Duh', file: 'duh.ogg' },
  { id: 'ew', label: 'Ew', file: 'ew.ogg' },
  { id: 'explode', label: 'Explode', file: 'explode.ogg' },
  { id: 'fall', label: 'Fall', file: 'fall.ogg' },
  { id: 'fireball', label: 'Fireball', file: 'fireball.ogg' },
  { id: 'breatheFire', label: 'Breathe Fire', file: 'breathe_fire.ogg' },
  { id: 'foul', label: 'Foul', file: 'foul.ogg' },
  { id: 'hypno', label: 'Hypnotic Gaze', file: 'hypno.ogg' },
  { id: 'injury', label: 'Injury', file: 'injury.ogg' },
  { id: 'kick', label: 'Kick', file: 'kick.ogg' },
  { id: 'ko', label: 'Knocked out', file: 'ko.ogg' },
  { id: 'metal', label: 'Metal', file: 'metal.ogg' },
  { id: 'nomnom', label: 'Nom nom (eat)', file: 'nomnom.ogg' },
  { id: 'organ', label: 'Organ', file: 'organ.ogg' },
  { id: 'pickup', label: 'Ball pickup', file: 'pickup.ogg' },
  { id: 'pumpcrowd', label: 'Crowd pump', file: 'pumpcrowd.ogg' },
  { id: 'question', label: 'Question', file: 'question.ogg' },
  { id: 'rip', label: 'RIP (killed)', file: 'rip.ogg' },
  { id: 'roar', label: 'Roar', file: 'roar.ogg' },
  { id: 'root', label: 'Take Root', file: 'root.ogg' },
  { id: 'slurp', label: 'Slurp', file: 'slurp.ogg' },
  { id: 'stab', label: 'Stab', file: 'stab.ogg' },
  { id: 'step', label: 'Step', file: 'step44.wav' },
  { id: 'swoop', label: 'Swoop', file: 'swoop.ogg' },
  { id: 'throw', label: 'Throw', file: 'throw44.wav' },
  { id: 'touchdown', label: 'Touchdown', file: 'td.ogg' },
  { id: 'trapdoor', label: 'Trap door', file: 'trapdoor.ogg' },
  { id: 'vomit', label: 'Vomit', file: 'vomit.ogg' },
  { id: 'whistle', label: 'Whistle', file: 'whistle.ogg' },
  { id: 'woooaaah', label: 'Wooo aaah (crowd)', file: 'woooaaah.ogg' },
  { id: 'yoink', label: 'Yoink', file: 'yoink.ogg' },
  { id: 'zap', label: 'Zap', file: 'zap.ogg' },
  // Owner 2026-07-03: our own turnover sting — a synthesized (public-domain) sad
  // trombone, replacing FUMBBL's 'duh' for the turnover splash. Not a wire SoundId.
  { id: 'sad_trombone', label: 'Sad trombone (turnover)', file: 'sad_trombone.wav' },
  // Owner 2026-07-06: a synthesized cartoon "boing" for a Jump/Leap — FUMBBL's
  // SoundId set has no leap/springboard sound, so this is our own sting (not a
  // wire SoundId), overridable like any other.
  { id: 'boing', label: 'Boing (jump / leap)', file: 'boing.wav' },
  // Owner 2026-07-08: an "angel" sting for a Steady Footing SAVE (a player who'd be
  // Knocked Down rolls a 6 and stays up). PLACEHOLDER — no bundled file yet, so it's
  // silent until the owner drops an angel.ogg into /sounds or sets a local override in
  // Settings › Sounds. Not a wire SoundId.
  { id: 'angel', label: 'Angel (Steady Footing save)', file: 'angel.ogg' },
  { id: 'chatToast', label: 'Chat toast', file: 'chatToast.ogg' },
  { id: 'setupPlace', label: 'Setup: player placed', file: 'setupPlace.ogg' },
];

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

function notifyAudioSettlement(): void {
  for (const notify of [...retirementWaiters]) notify();
}

function trackPlayback(audio: HTMLAudioElement, src: string): void {
  audioSources.set(audio, src);
  playingAudio.add(audio);
  if (trackedAudio.has(audio)) return;
  trackedAudio.add(audio);
  const settled = () => {
    playingAudio.delete(audio);
    notifyAudioSettlement();
  };
  audio.addEventListener('ended', settled);
  audio.addEventListener('error', settled);
  audio.addEventListener('pause', settled);
}

/** Keep native containers leased until every element that already resolved one
 * of these URLs has naturally finished (or failed/paused). */
export function waitForSoundUrlsRetirement(urls: ReadonlySet<string>): Promise<void> {
  const pending = () => [...playingAudio].some((audio) => urls.has(audioSources.get(audio) ?? ''));
  const releaseCache = () => { for (const url of urls) cache.delete(url); };
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

export function playSound(soundId: string | null | undefined): void {
  if (!soundId || suppressed) return;
  // Owner 08-17: replay's fast collapse path (2x/4x) now calls this from a plain model-fold — an
  // environment without a real Audio constructor (headless test runner, an embedding without media)
  // must not throw and abort the fold. Sound is presentation-only; missing playback is a silent no-op.
  if (typeof Audio === 'undefined') return;
  const volume = Math.max(0, Math.min(100, settings.soundVolume));
  if (volume === 0) return;
  const src = sourceFor(soundId);
  if (!src) return;
  let audio = cache.get(src);
  if (!audio) {
    audio = new Audio(src);
    audio.addEventListener('error', () => console.warn(`sound missing: ${src.slice(0, 60)}`));
    cache.set(src, audio);
  }
  audio.volume = volume / 100;
  audio.currentTime = 0;
  trackPlayback(audio, src);
  void audio.play().catch(() => {
    playingAudio.delete(audio);
    notifyAudioSettlement();
    /* autoplay may be blocked until first user gesture — fine */
  });
}

/** Settings preview: play a sound at (at least audible) volume, ignoring mute so
 *  the user can hear a candidate override. */
export function previewSound(soundId: string): void {
  const src = sourceFor(soundId);
  if (!src) return;
  const audio = new Audio(src);
  audio.volume = Math.max(0.4, Math.min(1, settings.soundVolume / 100));
  trackPlayback(audio, src);
  void audio.play().catch(() => { playingAudio.delete(audio); notifyAudioSettlement(); });
}

/** Drop the cached HTMLAudioElement for a sound (e.g. after its override changes
 *  or is cleared) so the next play re-resolves the source. */
export function invalidateSoundCache(): void {
  cache.clear();
}
