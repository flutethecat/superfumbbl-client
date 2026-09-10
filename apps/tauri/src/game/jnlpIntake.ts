/**
 * Strict JNLP intake core.
 *
 * Upstream authority:
 *   ffb-client-logic/.../ClientParameters.java
 * Native file handling and UI routing remain separate trust boundaries.
 */

export type JnlpMode = 'player' | 'spectator' | 'replay';

export interface StrictJnlpRequest {
  mode: JnlpMode;
  coach?: string;
  gameId?: number;
  teamId?: string;
  teamName?: string;
  teamHome?: string;
  teamAway?: string;
  auth?: string;
  /** Untrusted declaration retained only for policy validation; never used to connect. */
  declaredPort?: number;
  /** Untrusted declaration retained only for policy validation; never used to connect. */
  declaredServer?: string;
  build?: string;
  layout?: 'LANDSCAPE' | 'PORTRAIT';
  /** Private-fork extension; never emitted by upstream FUMBBL. */
  fork: boolean;
  gameName?: string;
  password?: string;
  /** hex md5(pw) from a `-passwordMd5` fork JNLP — the pre-hashed credential carrier (owner
   *  security ruling 08-17). Preferred over `password`, which stays for JNLPs already in the
   *  field. Neither flag is upstream wire: upstream's ClientParameters has no password argument
   *  at all, so this pair is a fork-local convention (docs/credential-plaintext-audit.md §3). */
  passwordMd5?: string;
}

export type JnlpLaunchPlan =
  | { kind: 'fumbbl-player'; request: StrictJnlpRequest; endpoint: { kind: 'official'; host: 'fumbbl.com'; port: 22_223 } }
  | { kind: 'fork-player'; request: StrictJnlpRequest; endpoint: { kind: 'trusted-settings' } }
  | {
      kind: 'spectator';
      request: StrictJnlpRequest;
      endpoint: { kind: 'official'; host: 'fumbbl.com'; port: 22_223 } | { kind: 'trusted-settings' };
    }
  | { kind: 'replay'; request: StrictJnlpRequest };

export class JnlpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JnlpValidationError';
  }
}

export class JnlpHostPolicyError extends JnlpValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'JnlpHostPolicyError';
  }
}

const MODE_FLAGS = new Map<string, JnlpMode>([
  ['-player', 'player'],
  ['-spectator', 'spectator'],
  // Compatibility with the current Super FUMBBL private-file spelling only.
  ['-spectate', 'spectator'],
  ['-replay', 'replay'],
]);

const VALUE_FLAGS = new Map<string, keyof StrictJnlpRequest>([
  ['-coach', 'coach'],
  ['-gameid', 'gameId'],
  ['-teamid', 'teamId'],
  ['-teamname', 'teamName'],
  ['-teamhome', 'teamHome'],
  ['-teamaway', 'teamAway'],
  ['-auth', 'auth'],
  ['-port', 'declaredPort'],
  ['-server', 'declaredServer'],
  ['-build', 'build'],
  ['-layout', 'layout'],
  // Private-fork extensions.
  ['-gamename', 'gameName'],
  ['-password', 'password'],
  ['-passwordmd5', 'passwordMd5'],
]);

// Redacted wherever arguments are logged. The digest is listed too: it is bearer-equivalent
// (anyone holding it can join as that coach), so it deserves the same handling as the clear text.
const SENSITIVE_FLAGS = new Set(['-auth', '-password', '-passwordmd5']);

function nonEmpty(value: string | undefined, flag: string): string {
  if (!value?.trim()) throw new JnlpValidationError(`${flag} requires a value`);
  return value.trim();
}

function positiveInteger(value: string, flag: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!/^[0-9]+$/.test(value)) throw new JnlpValidationError(`${flag} must be numeric`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new JnlpValidationError(`${flag} is out of range`);
  }
  return parsed;
}

/** Parse and validate the ordered argument values from one application-desc. */
export function parseJnlpArguments(args: readonly string[]): StrictJnlpRequest {
  let mode: JnlpMode | undefined;
  let fork = false;
  const values = new Map<keyof StrictJnlpRequest, string | number>();
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const rawFlag = nonEmpty(args[index], 'argument');
    const flag = rawFlag.toLowerCase();

    const parsedMode = MODE_FLAGS.get(flag);
    if (parsedMode) {
      if (mode) throw new JnlpValidationError('exactly one client mode is allowed');
      mode = parsedMode;
      continue;
    }
    if (flag === '-fork') {
      if (fork) throw new JnlpValidationError('duplicate -fork');
      fork = true;
      continue;
    }

    const key = VALUE_FLAGS.get(flag);
    if (!key) throw new JnlpValidationError(`unknown argument at index ${index}`);
    if (seen.has(flag)) throw new JnlpValidationError(`duplicate argument at index ${index}`);
    seen.add(flag);

    const rawValue = args[index + 1];
    if (rawValue === undefined) throw new JnlpValidationError(`${rawFlag} requires a value`);
    index += 1;
    const value = nonEmpty(rawValue, rawFlag);
    if (key === 'gameId') {
      if (!/^-?[0-9]+$/.test(value)) throw new JnlpValidationError('-gameId must be numeric');
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) throw new JnlpValidationError('-gameId is out of range');
      values.set(key, parsed);
    }
    else if (key === 'declaredPort') values.set(key, positiveInteger(value, '-port', 65_535));
    else if (key === 'layout') {
      if (value !== 'LANDSCAPE' && value !== 'PORTRAIT') {
        throw new JnlpValidationError('-layout must be LANDSCAPE or PORTRAIT');
      }
      values.set(key, value);
    } else values.set(key, value);
  }

  if (!mode) throw new JnlpValidationError('missing client mode');
  const request = { mode, fork, ...Object.fromEntries(values) } as StrictJnlpRequest;
  validateModeContract(request);
  validateEndpointPolicy(request);
  return request;
}

function validateModeContract(request: StrictJnlpRequest): void {
  if (request.mode === 'replay') {
    if ((request.gameId ?? 0) <= 0) throw new JnlpValidationError('replay requires a positive -gameId');
    return;
  }
  if (!request.coach) throw new JnlpValidationError(`${request.mode} requires -coach`);

  // Upstream ignores team selector pairing in spectator mode.
  if (request.mode === 'spectator') return;
  if (request.fork) {
    if (
      (!request.gameName && (request.gameId ?? 0) <= 0)
      || !request.teamId
      || !(request.passwordMd5 || request.password)
    ) {
      throw new JnlpValidationError('fork player requires a game name/id, -teamId and -passwordMd5 (or -password)');
    }
    return;
  }
  // Exact upstream selector pairing: gameId>0 uses optional home/away names;
  // otherwise optional teamId/teamName is the team-entry shape.
  if ((request.gameId ?? 0) > 0) {
    if (Boolean(request.teamHome) !== Boolean(request.teamAway)) {
      throw new JnlpValidationError('-teamHome and -teamAway must be paired for a player game-id launch');
    }
  } else if (Boolean(request.teamId) !== Boolean(request.teamName)) {
    throw new JnlpValidationError('-teamId and -teamName must be paired for a player team-entry launch');
  }
}

/**
 * Never let downloaded XML select an arbitrary credential destination. Official
 * intake remains pinned to fumbbl.com; private-fork files use configured settings.
 */
function validateEndpointPolicy(request: StrictJnlpRequest): void {
  if (request.fork) return;
  // owner ruling 2026-08-17: official fumbbl.com replay+live permitted.
  if (request.declaredServer !== undefined && request.declaredServer.toLowerCase() !== 'fumbbl.com') {
    throw new JnlpHostPolicyError('unexpected official JNLP server declaration');
  }
  if (request.declaredPort !== undefined && request.declaredPort !== 22_223) {
    throw new JnlpHostPolicyError('unexpected official JNLP port');
  }
}

export function planJnlpLaunch(request: StrictJnlpRequest): JnlpLaunchPlan {
  if (request.mode === 'replay') return { kind: 'replay', request };
  if (request.mode === 'spectator') {
    return {
      kind: 'spectator',
      request,
      endpoint: request.fork
        ? { kind: 'trusted-settings' }
        : { kind: 'official', host: 'fumbbl.com', port: 22_223 },
    };
  }
  return request.fork
    ? { kind: 'fork-player', request, endpoint: { kind: 'trusted-settings' } }
    : { kind: 'fumbbl-player', request, endpoint: { kind: 'official', host: 'fumbbl.com', port: 22_223 } };
}

interface ParsedJnlpXml {
  args: string[];
  mainClass: string | null;
}

function readJnlpXml(xml: string): ParsedJnlpXml {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new JnlpValidationError('DTD and entity declarations are not allowed');
  }
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new JnlpValidationError('invalid XML');
  if (doc.documentElement.localName !== 'jnlp') throw new JnlpValidationError('root must be jnlp');
  const applications = doc.querySelectorAll('application-desc');
  if (applications.length !== 1) throw new JnlpValidationError('exactly one application-desc is required');
  const application = applications.item(0)!;
  const args = Array.from(application.children)
    .filter((node) => node.localName === 'argument')
    .map((node) => node.textContent?.trim() ?? '');
  return { args, mainClass: application.getAttribute('main-class') };
}

/** Read the exact ordered argument vocabulary before any game-entry decision. */
export function readJnlpArguments(xml: string): readonly string[] {
  return readJnlpXml(xml).args;
}

function parseJnlpEnvelope(xml: string, overrideArgs?: readonly string[]): StrictJnlpRequest {
  const { args: sourceArgs, mainClass } = readJnlpXml(xml);
  const args = overrideArgs ?? sourceArgs;
  const request = parseJnlpArguments(args);
  if (!request.fork && mainClass !== 'com.fumbbl.ffb.client.FantasyFootballClientAwt') {
    throw new JnlpValidationError('unexpected application main class');
  }
  if (request.fork && mainClass !== null && mainClass !== 'com.fumbbl.ffb.client.FantasyFootballClientAwt') {
    throw new JnlpValidationError('unexpected fork application main class');
  }
  return request;
}

/** DOM parsing belongs in the WebView; native code supplies only bounded UTF-8. */
export function parseJnlpXml(xml: string): StrictJnlpRequest {
  return parseJnlpEnvelope(xml);
}

/** Re-validate an ambiguous envelope after the user supplies the missing entry intent. */
export function parseJnlpXmlAs(xml: string, args: readonly string[]): StrictJnlpRequest {
  return parseJnlpEnvelope(xml, args);
}

/** Safe diagnostic shape: secrets never enter errors, telemetry, or UI logs. */
export function redactJnlpArguments(args: readonly string[]): string[] {
  return args.map((value, index) => {
    const previous = args[index - 1]?.toLowerCase();
    return previous && SENSITIVE_FLAGS.has(previous) ? '<redacted>' : value;
  });
}

export class OneTimeFumbblToken {
  private value: string | null;
  constructor(value: string) { this.value = nonEmpty(value, '-auth'); }
  take(): string {
    if (this.value === null) throw new JnlpValidationError('FUMBBL token was already consumed');
    const value = this.value;
    this.value = null;
    return value;
  }
  get consumed(): boolean { return this.value === null; }
}
