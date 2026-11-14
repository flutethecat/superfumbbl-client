// Owner 11-13: "Can we also add an OS version to the bug reports? I'm realizing we need that information when
// triaging." A report carries `context.os`: the operating system in plain words (`label`) plus the raw inputs it came
// from, so a human can always check the reading.
//
// Page-side only (it ships in an app patch; no shell plugin). Two inputs:
//  - navigator.userAgentData.getHighEntropyValues (Chromium: WebView2 on Windows, Android System WebView). The only
//    page-side way to tell Windows 10 from 11 and to read an Android device model.
//  - navigator.userAgent, parsed, for WebKitGTK (Linux) and WKWebView (macOS), which have no userAgentData, and for an
//    older WebView without it.
// NEVER GUESS: what cannot be read says unknown (or "version not reported") and the raw strings stay in the object.
// Only the fields named below are read: no serial numbers, no full version lists, no device fingerprint.
// (navigator.maxTouchPoints is read only to tell an iPad from a Mac; it is never sent.)
//
// The `label` sent is canonical English for triage. The dialog shows the same reading in the coach's language
// (bugReportOsDisplayLabel), built from the structured parts kept beside each reading.

export type BugReportOsFamily = 'windows' | 'macos' | 'linux' | 'android' | 'chromeos' | 'ios' | 'unknown';

/**
 * Which input produced the label. 'userAgentData' = the high-entropy values answered; 'userAgentDataLowEntropy' =
 * they did not (refused / timed out / threw) and only navigator.userAgentData.platform / mobile were there;
 * 'userAgent' = the user agent string; 'none' = no navigator at all.
 */
export type BugReportOsSource = 'userAgentData' | 'userAgentDataLowEntropy' | 'userAgent' | 'none';

export interface BugReportOs {
  /** The OS family the label names. */
  family: BugReportOsFamily;
  /** For triage, e.g. "Windows 11", "Android 14 (SM-X230)", "Linux (Ubuntu) x86_64", "macOS (version not reported)". */
  label: string;
  source: BugReportOsSource;
  // ---- raw userAgentData fields (null = the API is missing, refused, timed out, or did not give that field) ----
  platform: string | null;
  platformVersion: string | null;
  architecture: string | null;
  bitness: string | null;
  model: string | null;
  mobile: boolean | null;
  // ---- what the user agent string says (kept raw beside the reading) ----
  /** The OS part of the user agent, e.g. "X11; Ubuntu; Linux x86_64" (null when there is none or it is not clean text). */
  uaOs: string | null;
  uaFamily: BugReportOsFamily;
  /** The OS version the user agent carries, as written ("10.0", "14", "10_15_7"), or null. May be a frozen value. */
  uaVersion: string | null;
}

/** The high-entropy hints asked for. Nothing else (no fullVersionList, no uaFullVersion, no formFactors). */
export const BUG_REPORT_OS_HINTS = ['platform', 'platformVersion', 'architecture', 'bitness', 'model', 'mobile'] as const;

/** How long Send waits for userAgentData before going with the user agent reading. */
export const BUG_REPORT_OS_TIMEOUT_MS = 500;

export interface UserAgentDataValues {
  platform?: unknown;
  platformVersion?: unknown;
  architecture?: unknown;
  bitness?: unknown;
  model?: unknown;
  mobile?: unknown;
}

interface UserAgentDataLike {
  platform?: unknown;
  mobile?: unknown;
  getHighEntropyValues?: (hints: string[]) => Promise<UserAgentDataValues>;
}

export interface NavigatorLike {
  userAgent?: unknown;
  userAgentData?: UserAgentDataLike | null;
  maxTouchPoints?: unknown;
}

/** By Unicode category: controls (Cc), format characters (Cf: bidi, zero-width, soft hyphen, BOM...), line and
 *  paragraph separators, private use, lone surrogates and unassigned code points. */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}\p{Cn}]/u;

/** Short printable text only; anything else is null. */
function text(value: unknown, max = 64): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || UNPRINTABLE.test(trimmed)) return null;
  return trimmed;
}

/** A dotted version number ("14.0.0", "10.0"), never free text. */
function versionText(value: string | null): string | null {
  return value && /^\d{1,6}(?:\.\d{1,6}){0,3}$/.test(value) ? value : null;
}

// ---- the label, structured ---------------------------------------------------------------------------------------

/** The few words in a label that are not proper nouns; the dialog translates them (BugReportModal). */
export interface BugReportOsPhrases {
  unknown(): string;
  windows10or11(): string;
  windowsBefore10(): string;
  versionNotReported(os: string): string;
  onChromeOs(os: string): string;
}

export const ENGLISH_OS_PHRASES: BugReportOsPhrases = {
  unknown: () => 'Unknown',
  windows10or11: () => 'Windows 10 or 11',
  windowsBefore10: () => 'Windows 7, 8 or 8.1',
  versionNotReported: (os) => `${os} (version not reported)`,
  onChromeOs: (os) => `${os} on ChromeOS`,
};

/** `base` holds proper nouns, numbers and tokens only; every English word is a phrase. */
interface LabelSpec {
  base: string;
  special?: 'unknown' | 'windows10or11' | 'windowsBefore10';
  versionMissing?: boolean;
  chromeOs?: boolean;
  model?: string | null;
}

function renderLabel(spec: LabelSpec, phrases: BugReportOsPhrases): string {
  let label = spec.special ? phrases[spec.special]() : spec.base;
  if (spec.versionMissing) label = phrases.versionNotReported(label);
  if (spec.chromeOs) label = phrases.onChromeOs(label);
  if (spec.model) label = `${label} (${spec.model})`;
  return label;
}

const specs = new WeakMap<BugReportOs, LabelSpec>();

/** The reading in the coach's language for the dialog (the payload keeps the English `label`). */
export function bugReportOsDisplayLabel(os: BugReportOs, phrases: BugReportOsPhrases): string {
  const spec = specs.get(os);
  return spec ? renderLabel(spec, phrases) : os.label;
}

// ---- the user agent ------------------------------------------------------------------------------------------------

export interface UserAgentOsReading {
  family: BugReportOsFamily;
  label: string;
  uaOs: string | null;
  uaVersion: string | null;
  /** False for a frozen placeholder version (reduced Android "10; K", macOS 10_15_7). */
  versionTrusted: boolean;
  model: string | null;
  spec: LabelSpec;
}

const WINDOWS_NT: Record<string, string> = { '6.1': 'Windows 7', '6.2': 'Windows 8', '6.3': 'Windows 8.1' };
const LOCALE = /^[a-z]{2,3}(?:[-_][a-z]{2,4})?$/i;

/** Tokens in the user agent's OS part that are never a distribution or a device model. */
function isNoiseToken(part: string): boolean {
  return !part || /^(?:U|I|N|K|wv|Mobile|Tablet)$/i.test(part) || /^rv:/i.test(part) || /^Build\//i.test(part) || LOCALE.test(part);
}

function reading(family: BugReportOsFamily, spec: LabelSpec, uaOs: string | null, uaVersion: string | null, versionTrusted: boolean, model: string | null = null): UserAgentOsReading {
  return { family, label: renderLabel(spec, ENGLISH_OS_PHRASES), uaOs, uaVersion, versionTrusted, model, spec };
}

/** Pure: read the OS out of a user agent string. `maxTouchPoints` tells an iPad's desktop-mode Mac agent from a Mac. */
export function osFromUserAgent(userAgent: unknown, maxTouchPoints = 0): UserAgentOsReading {
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, 512) : '';
  const os = (/\(([^)]*)\)/.exec(ua)?.[1] ?? '').slice(0, 200);
  const uaOs = text(os, 200);
  const parts = os.split(';').map((p) => p.trim());

  // Android first: an Android UA also says "Linux". Under ChromeOS (ARC) the WebView is plain Android.
  const android = /\bAndroid(?:\s+([\d.]+))?/.exec(os);
  if (android) {
    const version = versionText(android[1] ?? null);
    const at = parts.findIndex((p) => /^Android\b/.test(p));
    // Reduced user agent: "Android 10; K" is a frozen placeholder, neither the version nor the model.
    const frozen = parts[at + 1] === 'K';
    const modelPart = frozen || at < 0 ? undefined : parts.slice(at + 1).find((p) => !isNoiseToken(p));
    const model = modelPart ? text(modelPart.replace(/\s*Build\/.*$/, '')) : null;
    const trusted = !!version && !frozen;
    const spec: LabelSpec = { base: trusted ? `Android ${version}` : 'Android', versionMissing: !trusted, chromeOs: chromeOsHint(os, model), model };
    return reading('android', spec, uaOs, android[1] ?? null, trusted, model);
  }
  if (/\bCrOS\b/.test(os)) {
    // The CrOS build number in a modern Chromium UA is frozen (14541.0.0): not a version.
    const arch = /\bCrOS\s+([\w.-]{1,16})(?:\s|$)/.exec(os)?.[1] ?? null;
    return reading('chromeos', { base: arch ? `ChromeOS ${arch}` : 'ChromeOS' }, uaOs, null, false);
  }
  const ios = /\b(?:iPhone|iPad|iPod)\b.*?\bOS\s+(\d+(?:_\d+){0,2})/.exec(os);
  if (ios) {
    const version = ios[1]!;
    return reading('ios', { base: `iOS ${version.replace(/_/g, '.')}` }, uaOs, version, true);
  }
  const windows = /Windows NT\s+(\d+\.\d+)/.exec(os);
  if (windows) {
    const nt = windows[1]!;
    // NT 10.0 is both Windows 10 and Windows 11: the user agent cannot tell them apart.
    const spec: LabelSpec = nt === '10.0' ? { base: '', special: 'windows10or11' } : { base: WINDOWS_NT[nt] ?? `Windows NT ${nt}` };
    return reading('windows', spec, uaOs, nt, nt !== '10.0');
  }
  if (/\bWindows\b/.test(os)) return reading('windows', { base: 'Windows', versionMissing: true }, uaOs, null, false);
  const mac = /Mac OS X(?:\s+(\d+(?:[_.]\d+){0,2}))?/.exec(os);
  if (mac) {
    const version = mac[1] ?? null;
    // iPadOS in desktop mode sends the Mac user agent; a Mac has no touch points.
    if (/\bMacintosh\b/.test(os) && maxTouchPoints > 1) return reading('ios', { base: 'iPadOS', versionMissing: true }, uaOs, version, false);
    // Modern WebKit freezes the macOS version at 10_15_7: that value says nothing.
    const frozen = !version || version === '10_15_7' || version === '10.15.7';
    const spec: LabelSpec = frozen ? { base: 'macOS', versionMissing: true } : { base: `macOS ${version.replace(/_/g, '.')}` };
    return reading('macos', spec, uaOs, version, !frozen);
  }
  const linux = /\bLinux\b(?:\s+([\w.-]{1,16}))?(?:;|$)/.exec(os) ?? /\bLinux\b/.exec(os);
  if (linux) {
    // "X11; Ubuntu; Linux x86_64": the token between X11 and Linux names the distribution when there is one.
    const distro = parts.find((p) => !/^(?:X11|Wayland)$/i.test(p) && !/\bLinux\b/.test(p) && !isNoiseToken(p) && text(p, 32) !== null) ?? null;
    const arch = linux[1] ?? null;
    const base = ['Linux', distro ? `(${distro})` : null, arch].filter(Boolean).join(' ');
    return reading('linux', { base }, uaOs, null, false);
  }
  return reading('unknown', { base: '', special: 'unknown' }, uaOs, null, false);
}

/** Android running on a Chromebook (ARC), only when the user agent or the model says so. */
function chromeOsHint(...values: (string | null | undefined)[]): boolean {
  return values.some((v) => !!v && /chromebook|\bcheets\b|chromeos|chrome os|\bcros\b/i.test(v));
}

// ---- userAgentData -------------------------------------------------------------------------------------------------

/** "14.0.0" -> "14", "10.15.7" -> "10.15.7", "13.1.0" -> "13.1". */
function shortVersion(version: string): string {
  return version.replace(/(\.0)+$/, '');
}

function archLabel(architecture: string | null, bitness: string | null): string | null {
  if (!architecture || !/^[\w-]{1,16}$/.test(architecture)) return null;
  if (architecture === 'x86') return bitness === '64' ? 'x86_64' : 'x86';
  if (architecture === 'arm') return bitness === '64' ? 'arm64' : 'arm';
  return architecture;
}

type RawFields = Pick<BugReportOs, 'platform' | 'platformVersion' | 'architecture' | 'bitness' | 'model' | 'mobile'>;

/** The reading from userAgentData, or null when it does not name a platform this knows. */
function osFromUserAgentData(raw: RawFields, ua: UserAgentOsReading): { family: BugReportOsFamily; spec: LabelSpec } | null {
  const { platform, model } = raw;
  const platformVersion = versionText(raw.platformVersion);
  const arch = archLabel(raw.architecture, raw.bitness);
  const major = platformVersion ? Number.parseInt(platformVersion, 10) : Number.NaN;
  switch ((platform ?? '').toLowerCase()) {
    case 'windows': {
      // Microsoft's documented mapping: platformVersion 13+ = Windows 11, 1..10 = Windows 10, 0 = before Windows 10.
      if (!Number.isFinite(major)) return { family: 'windows', spec: { base: '', special: 'windows10or11' } };
      if (major >= 13) return { family: 'windows', spec: { base: 'Windows 11' } };
      if (major >= 1 && major <= 10) return { family: 'windows', spec: { base: 'Windows 10' } };
      if (major === 0) return { family: 'windows', spec: { base: '', special: 'windowsBefore10' } };
      return { family: 'windows', spec: { base: `Windows (${platformVersion})` } };
    }
    case 'android': {
      // Never the frozen "10" of a reduced user agent.
      const version = platformVersion ? shortVersion(platformVersion) : (ua.family === 'android' && ua.versionTrusted ? ua.uaVersion : null);
      const shownModel = model ?? (ua.family === 'android' ? ua.model : null);
      return { family: 'android', spec: { base: version ? `Android ${version}` : 'Android', versionMissing: !version, chromeOs: chromeOsHint(shownModel, ua.uaOs), model: shownModel } };
    }
    case 'chrome os':
    case 'chromeos':
      return { family: 'chromeos', spec: { base: ['ChromeOS', platformVersion ? shortVersion(platformVersion) : null, arch].filter(Boolean).join(' ') } };
    case 'macos':
      return { family: 'macos', spec: platformVersion ? { base: `macOS ${shortVersion(platformVersion)}` } : { base: 'macOS', versionMissing: true } };
    case 'linux':
      // userAgentData has no distribution: keep what the user agent says about it.
      if (ua.family === 'linux') return { family: 'linux', spec: ua.spec };
      return { family: 'linux', spec: { base: arch ? `Linux ${arch}` : 'Linux' } };
    default:
      return null;
  }
}

export interface BuildBugReportOsOptions {
  /** `values` are only the low-entropy platform / mobile (the high-entropy request failed). */
  lowEntropyOnly?: boolean;
  /** navigator.maxTouchPoints (iPad vs Mac). Read, never sent. */
  maxTouchPoints?: number;
}

/** Pure: the report's `os` object from a user agent and (optionally) the userAgentData values. */
export function buildBugReportOs(userAgent: unknown, values: UserAgentDataValues | null, options: BuildBugReportOsOptions = {}): BugReportOs {
  const ua = osFromUserAgent(userAgent, options.maxTouchPoints ?? 0);
  const raw: RawFields = {
    platform: text(values?.platform),
    platformVersion: text(values?.platformVersion),
    architecture: text(values?.architecture, 16),
    bitness: text(values?.bitness, 8),
    model: text(values?.model),
    mobile: typeof values?.mobile === 'boolean' ? values.mobile : null,
  };
  const fromUad = values ? osFromUserAgentData(raw, ua) : null;
  const family = fromUad?.family ?? ua.family;
  const spec = fromUad?.spec ?? ua.spec;
  const os: BugReportOs = {
    family,
    label: renderLabel(spec, ENGLISH_OS_PHRASES),
    source: fromUad ? (options.lowEntropyOnly ? 'userAgentDataLowEntropy' : 'userAgentData') : (typeof userAgent === 'string' ? 'userAgent' : 'none'),
    ...raw,
    uaOs: ua.uaOs,
    uaFamily: ua.family,
    uaVersion: ua.uaVersion,
  };
  specs.set(os, spec);
  return os;
}

// ---- collection ----------------------------------------------------------------------------------------------------

function liveNavigator(): NavigatorLike | null {
  return typeof navigator !== 'undefined' ? (navigator as unknown as NavigatorLike) : null;
}

/** Read one navigator property; a throwing getter (or anything else) gives undefined. */
function safeGet<T>(read: () => T): T | undefined {
  try { return read(); } catch { return undefined; }
}

function touchPoints(nav: NavigatorLike | null): number {
  const value = safeGet(() => nav?.maxTouchPoints);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function userAgentOf(nav: NavigatorLike | null): string | undefined {
  const value = safeGet(() => nav?.userAgent);
  return typeof value === 'string' ? value : undefined;
}

/** The plain fields of a userAgentData answer, each read under a guard (a getter may throw). */
function plainValues(source: UserAgentDataValues | null | undefined): UserAgentDataValues {
  const out: UserAgentDataValues = {};
  for (const key of BUG_REPORT_OS_HINTS) out[key] = safeGet(() => source?.[key]);
  return out;
}

/** An answer carrying a usable high-entropy field. A policy-denied request resolves with only brands / platform /
 *  mobile: that is not one. */
function hasHighEntropy(values: UserAgentDataValues): boolean {
  return versionText(text(values.platformVersion)) !== null
    || text(values.architecture, 16) !== null || text(values.bitness, 8) !== null || text(values.model) !== null;
}

/** The user agent reading alone, at once (the dialog's first line before userAgentData answers). Never throws. */
export function bugReportOsNow(nav: NavigatorLike | null = liveNavigator()): BugReportOs {
  try {
    return buildBugReportOs(userAgentOf(nav), null, { maxTouchPoints: touchPoints(nav) });
  } catch {
    return buildBugReportOs(undefined, null);
  }
}

/**
 * Impure: read the OS. Resolves within `timeoutMs` and never rejects, whatever the navigator does: a missing,
 * refused, throwing or hanging userAgentData falls back to its low-entropy platform, else the user agent reading.
 * Only a reading with source 'userAgentData' means a high-entropy value answered.
 */
export async function collectBugReportOs(
  nav: NavigatorLike | null = liveNavigator(),
  timeoutMs: number = BUG_REPORT_OS_TIMEOUT_MS,
): Promise<BugReportOs> {
  try {
    const maxTouchPoints = touchPoints(nav);
    const userAgent = userAgentOf(nav);
    let values: UserAgentDataValues | null = null;
    let lowEntropyOnly = false;
    try {
      const uad = safeGet(() => nav?.userAgentData);
      const ask = safeGet(() => uad?.getHighEntropyValues);
      if (uad && typeof ask === 'function') {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
        try {
          const asked = new Promise<UserAgentDataValues | null>((resolve) => {
            try {
              Promise.resolve(ask.call(uad, [...BUG_REPORT_OS_HINTS])).then(resolve, () => resolve(null));
            } catch {
              resolve(null); // a synchronous throw: the low-entropy fields below may still answer
            }
          });
          const answer = await Promise.race([asked, timeout]);
          if (answer && typeof answer === 'object') {
            values = plainValues(answer);
            lowEntropyOnly = !hasHighEntropy(values);
          }
        } finally {
          clearTimeout(timer);
        }
      }
      // A refusal or timeout may still leave the low-entropy platform / mobile on the object itself.
      if (!values && uad) {
        const platform = safeGet(() => uad.platform);
        const mobile = safeGet(() => uad.mobile);
        if (typeof platform === 'string' || typeof mobile === 'boolean') {
          values = { platform, mobile };
          lowEntropyOnly = true;
        }
      }
    } catch {
      values = null;
      lowEntropyOnly = false;
    }
    return buildBugReportOs(userAgent, values, { lowEntropyOnly, maxTouchPoints });
  } catch {
    return bugReportOsNow(null);
  }
}

// The OS does not change under a running client: read once per session, warmed when the Report dialog opens.
let cached: Promise<BugReportOs> | null = null;

/** The session's reading (started on first call; the dialog calls it on open so Send finds it ready). Never rejects. */
export function loadBugReportOs(): Promise<BugReportOs> {
  if (!cached) {
    let pending: Promise<BugReportOs>;
    try {
      pending = collectBugReportOs().catch(() => bugReportOsNow(null));
    } catch {
      pending = Promise.resolve(bugReportOsNow(null));
    }
    cached = pending;
    // Only a high-entropy answer is kept: a refusal, timeout or user agent reading is asked again by the next report.
    const forget = () => { if (cached === pending) cached = null; };
    pending.then((os) => { if (os.source !== 'userAgentData') forget(); }, forget);
  }
  return cached;
}

/** Test seam. */
export function resetBugReportOsCache(): void {
  cached = null;
}
