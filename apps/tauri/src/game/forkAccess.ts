/**
 * Owner 10-31: fork access at RUN time. Owner ruling 11-01 ("we cannot hide the address if it breaks bug reports"):
 * the fork server's default address is baked again (FORK_SERVER_HOST, re-exported by settings.ts); the launch flag
 * still GATES the fork surfaces ("Play on fork server", the Team Builder, fork sign-in) in the public build:
 *   - `--fork-server` (bare) turns them on against the baked default host; a value form turns nothing on (the flag
 *     never selects a host, Sol r14);
 *   - the plain browser/dev build takes a bare `?forkServer` the same way;
 *   - the FORK edition always has them, its host from settings.forkHost, VITE_FORK_SERVER_HOST, else the default.
 * A public run without the flag still knows the default host (bug reports go there) but shows no fork surface. The
 * PUBLIC build never reads (or writes) `settings.forkHost`.
 *
 * This module deliberately does NOT import settings (settings imports it at module init); settings registers its
 * `forkHost` reader with registerSettingsForkHostReader.
 */
import { ref, type Ref } from 'vue';
import { FORK_EDITION } from './edition';

/** Owner ruling 11-01: the Super FUMBBL fork server's default host (DDNS), baked again. */
export const FORK_SERVER_HOST = 'superfumbbltest.duckdns.org';

/** The host the launch flag selected (the default host for a bare `--fork-server`), set once at startup (cold start
 *  only). null = no flag (or not read yet). Non-null is what turns the fork surfaces on in the public build. */
export const forkHostFromLaunch: Ref<string | null> = ref(null);
/** True once the launch-flag read has settled (answered, failed, or timed out) - lets settings drop a deferred
 *  fork-target restore once it is known no flag is coming. */
export const launchFlagsSettled: Ref<boolean> = ref(false);

/** Official FUMBBL (fumbbl.com and every subdomain - which covers FUMBBL_WS_URL's host): never a fork host, and never
 *  exempted from the server-version gate as one. */
export function isOfficialFumbblHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.+$/, '');
  return h === 'fumbbl.com' || h.endsWith('.fumbbl.com');
}

/** Hosts whose config-web is plain HTTP on :4310 (the shell allows plain HTTP on that port only): loopback, any
 *  dotted-quad IPv4, `.local`. */
export function isLocalForkHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.endsWith('.local');
}

/** The config-web port for a local fork host: plain HTTP is allowed on 4310 only. */
export const LOCAL_CONFIG_WEB_PORT = 4310;

/** Record the bare launch flag (it only ever names the baked default host). Orchestrator decision 11-01 / Sol r14: the
 *  flag NEVER selects a host in either edition - any other value is ignored. First value wins. */
export function applyLaunchForkHost(raw: unknown): void {
  if (forkHostFromLaunch.value !== null) return;
  if (typeof raw !== 'string' || raw.trim().toLowerCase() !== FORK_SERVER_HOST) return;
  forkHostFromLaunch.value = FORK_SERVER_HOST;
}

/** The shell's answer: `enabled` = the bare `--fork-server` flag was given. Sol r14: any host value (`host` non-null,
 *  e.g. a page / older shell passing one) enables nothing in either edition, with a warning that names no host. */
export function applyLaunchForkFlag(enabled: unknown, host: unknown): void {
  if (enabled !== true) return;
  if (host !== null && host !== undefined) {
    try { console.warn('[launch] ignoring a --fork-server value: only the bare --fork-server flag is accepted'); } catch { /* ignore */ }
    return;
  }
  applyLaunchForkHost(FORK_SERVER_HOST);
}

/** Sol r13-r15: the run's fork destinations - ONE immutable pair {host, configWebBase} (both overrides included),
 *  captured the first time EITHER is resolved for real (effectiveForkHost() / forkConfigWebBase() once settings has
 *  registered its readers, i.e. the first fork operation after start-up configuration) and never changed afterwards:
 *  every fork request of the run talks to one host and one config-web. Bootstrap reads during settings hydration are
 *  never frozen. It does not depend on the launch-flag read (the flag never selects a host). */
let frozenPair: { host: string; configWebBase: string } | null = null;

export function markLaunchFlagsSettled(): void {
  launchFlagsSettled.value = true;
}

/** Has the run's fork host been frozen (see markLaunchFlagsSettled)? */
export function forkHostFrozen(): boolean {
  return frozenPair !== null;
}

let settingsForkHostReader: () => string = () => '';
let settingsReaderRegistered = false;
/** settings.ts hands over its `forkHost` reader (FORK edition only consults it). */
export function registerSettingsForkHostReader(reader: () => string): void {
  settingsForkHostReader = reader;
  settingsReaderRegistered = true;
}

let configWebResolver: ((host: string) => string) | null = null;
/** settings.ts hands over how a config-web base derives from a host (its botConfigUrl override + configWebBaseFor). */
export function registerConfigWebResolver(resolver: (host: string) => string): void {
  configWebResolver = resolver;
}

/** The frozen pair, captured now if this is the first real lookup (null while settings has not registered yet). */
function forkDestinations(): { host: string; configWebBase: string } | null {
  if (frozenPair) return frozenPair;
  if (!settingsReaderRegistered || !configWebResolver) return null;
  const host = resolveForkHost(settingsForkHostReader);
  frozenPair = { host, configWebBase: configWebResolver(host) };
  return frozenPair;
}

/** The run's config-web base (frozen with the host; see frozenPair). */
export function forkConfigWebBase(): string {
  const pair = forkDestinations();
  if (pair) return pair.configWebBase;
  return configWebResolver ? configWebResolver(resolveForkHost(settingsForkHostReader)) : '';
}

function envForkHost(): string {
  const v = (import.meta.env.VITE_FORK_SERVER_HOST as string | undefined) ?? '';
  return typeof v === 'string' ? v.trim() : '';
}

/** The fork host this run uses: in the FORK edition the explicit `settings.forkHost` override, then
 *  VITE_FORK_SERVER_HOST, else the baked default; the PUBLIC build always the baked default (owner ruling 11-01). Frozen
 *  at its first real resolution (see frozenForkHost). `readSettingsForkHost` lets settings pass the blob it is still
 *  hydrating - such a bootstrap read is never frozen. Never empty. */
export function effectiveForkHost(readSettingsForkHost?: () => string): string {
  if (frozenPair) return frozenPair.host;
  if (readSettingsForkHost) return resolveForkHost(readSettingsForkHost);
  return forkDestinations()?.host ?? resolveForkHost(settingsForkHostReader);
}

function resolveForkHost(readSettingsForkHost: () => string): string {
  if (FORK_EDITION) {
    const override = (readSettingsForkHost() || '').trim();
    if (override) return override;
    const env = envForkHost();
    if (env) return env;
  }
  return FORK_SERVER_HOST;
}

/** May this run show the fork-play + Team Builder surfaces? Reactive wherever it is read (it reads a ref). */
export function forkFeaturesEnabled(): boolean {
  return FORK_EDITION || forkHostFromLaunch.value !== null;
}

/** Does this ws/http URL point at the effective fork host (port ignored)? false with no fork features or no host. */
export function isForkServerUrl(url: string | null | undefined): boolean {
  if (!url || !forkFeaturesEnabled()) return false;
  const host = effectiveForkHost();
  try {
    const target = new URL(url).hostname.toLowerCase();
    // Official endpoints are never the fork, whatever the configured host says (the gate must hold for FUMBBL).
    if (isOfficialFumbblHost(target)) return false;
    return target === host.replace(/:\d+$/, '').toLowerCase();
  } catch {
    return false;
  }
}

/** Sol r9: the config-web ORIGIN (scheme + host + port) of a URL, '' when it is not an absolute http(s) URL. */
export function configWebOrigin(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : '';
  } catch {
    return '';
  }
}

/** The default fork host's config-web origin (a public hostname: https on 443). */
export const DEFAULT_CONFIG_WEB_ORIGIN = `https://${FORK_SERVER_HOST}`;

export function isDefaultConfigWebOrigin(url: string): boolean {
  return configWebOrigin(url) === DEFAULT_CONFIG_WEB_ORIGIN;
}

/** The browser/dev stand-in for the flag: `?forkServer` (no `=`) is the bare form; any `?forkServer=<value>` enables
 *  nothing (Sol r14: the flag never selects a host). */
export function applyBrowserForkQuery(search: string): void {
  for (const part of search.replace(/^\?/, '').split('&')) {
    if (part === 'forkServer') { applyLaunchForkFlag(true, null); return; }
    if (part.startsWith('forkServer=')) {
      let value = '';
      try { value = decodeURIComponent(part.slice('forkServer='.length).replace(/\+/g, ' ')); } catch { return; }
      applyLaunchForkFlag(true, value);
      return;
    }
  }
}

const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
// The plain browser/dev build has no shell flags: `?forkServer=<host>` stands in (read synchronously, here).
if (!inTauri && typeof location !== 'undefined') {
  try { applyBrowserForkQuery(location.search); } catch { /* ignore */ }
}

/** @internal test seam. */
export function __resetForkAccessForTests(): void {
  forkHostFromLaunch.value = null;
  launchFlagsSettled.value = false;
  frozenPair = null;
  settingsForkHostReader = () => '';
  settingsReaderRegistered = false;
  configWebResolver = null;
}
