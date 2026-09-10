// Owner feature request 2026-08-18: "clicking Report should let the user write a brief description
// and send it WITH diagnostics". The old Report button copied a template to the clipboard and opened
// Discord — the tester still had to find and attach their own wire log, which nobody ever did. This
// module is the CLIENT half: it assembles the report payload (description + the diagnostics the
// owner asked for) and POSTs it to config-web's `/api/bug-reports`.
//
// ZERO game-wire impact by construction: this is an HTTP call to config-web, the same host the
// team-builder / fork-JNLP routes already use. Nothing here touches the game websocket, and a failed
// send can only surface a toast.
//
// CREDENTIALS (owner security ruling 08-17, same rule as the fork routes): the report carries
// `passwordMd5` — hex md5 of the coach's fork password — and NEVER the clear text. `ffb_coaches.password`
// IS that digest, so config-web can authenticate the reporter with it and the coach's (probably reused)
// secret stays off the wire, out of proxy logs, and out of whatever store the reports land in.
//
// The diagnostics ride as plain strings so the server can file them verbatim: the per-game VERBOSE WIRE
// LOG (see verbose_log_append / read_bug_report_log in src-tauri/src/lib.rs) and the client's in-app log
// buffer. Both are capped — a wire log for a long game can reach hundreds of MB, and a report that OOMs
// the client helps nobody. When we cap, we keep the TAIL: the interesting frames are the ones just
// before the thing the tester is reporting, never the kickoff.

import { md5Hex } from '@fumbbl40k/ffb-protocol';
import { configWebUnreachableMessage, stripSecretFields } from './settings';

/** Owner cap on the free-text field. The textarea enforces it too; this is the authority. */
export const BUG_REPORT_DESCRIPTION_MAX = 4000;

/** Hard ceiling on each attached log. Mirrors MAX_BUG_REPORT_LOG_BYTES in src-tauri/src/lib.rs. */
export const BUG_REPORT_LOG_MAX_BYTES = 12 * 1024 * 1024;

/** How many trailing entries of the in-app log buffer ride along. The buffer itself caps at 400. */
export const BUG_REPORT_APP_LOG_ENTRIES = 200;

export type BugReportTransport = (input: string, init?: RequestInit) => Promise<Response>;

/** Owner 08-18: which SERVICE the reported game id belongs to — a FUMBBL id and a fork id live in
 *  different number spaces, so a bare id is ambiguous. Server-derived: the active server target. */
export type BugReportGameService = 'fumbbl' | 'fork';

/** Map the settings server-target id to the report's service. Only the 'fumbbl' preset is the
 *  official service; 'fork' AND 'local' both speak to a fork server (local = the dev fork). */
export function gameServiceFromTarget(targetId: string): BugReportGameService {
  return targetId === 'fumbbl' ? 'fumbbl' : 'fork';
}

/** Human label for the modal's attachment summary ("GAME: FUMBBL 1932766" / "GAME: SUPER FUMBBL 868"). */
export function gameServiceLabel(service: BugReportGameService): string {
  return service === 'fumbbl' ? 'FUMBBL' : 'SUPER FUMBBL';
}

/**
 * The game id embedded in the wire-log file name (`wire-g<ID>-<timestamp>.jsonl` — see the roll
 * logic in store.ts verboseTee). The wire log knows the game even when the live model no longer
 * does, so this is the report's fallback id source. Returns a number when the id is numeric.
 */
export function wireLogGameId(wireLogPath: string): number | string | null {
  const name = wireLogBasename(wireLogPath);
  const match = /^wire-g(.+?)-\d{4}-\d{2}-\d{2}T/.exec(name);
  if (!match || !match[1]) return null;
  const id = match[1];
  return /^\d+$/.test(id) ? Number(id) : id;
}

/**
 * The id the report carries: the LIVE game's id when the model has one, else the id the wire-log
 * file name carries (owner 08-18: a FUMBBL-official spectate reported `gameId: null` while the wire
 * log knew the game). Null only when genuinely no game has been observed.
 */
export function resolveReportGameId(
  liveGameId: number | string | null | undefined,
  wireLogPath: string,
): number | string | null {
  return liveGameId ?? wireLogGameId(wireLogPath);
}

/** What `read_bug_report_log` hands back. `truncated` is the Rust side telling us it started at an
 *  offset rather than at byte 0 — we cannot infer that from the text. */
export interface BugReportLogRead {
  text: string;
  truncated: boolean;
  totalBytes: number;
}

/** One entry of the client's in-app log (store `state.log`), structurally duplicated here so this
 *  module never imports the store — the modal reads state and passes it in. */
export interface BugReportLogEntry {
  time: string;
  kind: string;
  text: string;
}

/** One entry of the Developer-panel stream (store `state.devLog`). Empty unless dev mode is on. */
export interface BugReportDevLogEntry {
  t: string;
  cat: string;
  label: string;
  detail?: string;
}

export interface BugReportCreds {
  coach: string;
  password: string;
}

export interface BugReportInput {
  description: string;
  /** The observed game, or null when the tester reports from a session with no game. */
  gameId: number | string | null;
  /** Which service that id belongs to — the active server target, never guessed (owner 08-18). */
  gameService: BugReportGameService;
  /** `__APP_VERSION__` — the same stamp the corner build badge and the wire-log header carry. */
  clientVersion: string;
  /** Fork account (the config-web credential) — coach name + CLEAR password, hashed here, never sent. */
  creds: BugReportCreds;
  wireLog: BugReportLogRead | null;
  appLog: string | null;
  /** The current settings JSON (owner 08-19: triage sees settings instantly). Already secret-free
   *  (serializeSettingsForFile), and re-stripped here anyway — belt and braces. */
  settingsJson?: string | null;
  context?: Record<string, unknown>;
}

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function byteLength(text: string): number {
  if (encoder) return encoder.encode(text).length;
  return text.length; // no TextEncoder (ancient runtime): chars are a safe over-approximation for ASCII logs
}

/**
 * Cap `text` at `maxBytes`, KEEPING THE TAIL and prefixing a note that says so.
 *
 * Tail, not head: a bug report is about what just happened. Cutting from the front would hand the
 * owner the kickoff of a game whose 14th-turn crash is the whole point of the report.
 *
 * The cut is made on a LINE boundary where one is available inside the kept window, so the attached
 * log never opens mid-JSON — the wire log is JSONL and a half line is an unparseable line.
 */
export function truncateKeepingTail(text: string, maxBytes: number = BUG_REPORT_LOG_MAX_BYTES): string {
  const total = byteLength(text);
  if (total <= maxBytes) return text;
  // Byte budget is an upper bound on characters for any UTF-8 text, so slicing by character count
  // from the tail can only ever keep FEWER bytes than the budget — never more.
  let kept = text.slice(text.length - maxBytes);
  const firstNewline = kept.indexOf('\n');
  if (firstNewline >= 0 && firstNewline < kept.length - 1) kept = kept.slice(firstNewline + 1);
  return `[truncated — the first ${total - byteLength(kept)} of ${total} bytes were dropped; `
    + `this is the TAIL of the log, i.e. what happened most recently]\n${kept}`;
}

/** The basename of the absolute wire-log path the store exposes as `state.wireLogFile`. The Tauri
 *  read command takes a bare file name (it resolves the directory itself — see its confinement note),
 *  so the absolute path is deliberately NOT what crosses that boundary. */
export function wireLogBasename(absolutePath: string): string {
  const trimmed = (absolutePath || '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

/**
 * Render the tail of the in-app log buffers as text. Returns null when there is genuinely nothing to
 * attach — the client has no dedicated app-log ring beyond these, and an empty `appLog` field is a
 * truthful "we have nothing" rather than an invented file.
 */
export function formatAppLog(
  entries: readonly BugReportLogEntry[] = [],
  devEntries: readonly BugReportDevLogEntry[] = [],
  limit = BUG_REPORT_APP_LOG_ENTRIES,
): string | null {
  const sections: string[] = [];
  const tail = entries.slice(-limit);
  if (tail.length) {
    sections.push(`--- client log (last ${tail.length} of ${entries.length}) ---`);
    for (const e of tail) sections.push(`${e.time} [${e.kind}] ${e.text}`);
  }
  // Dev-panel stream: populated only when the tester has dev mode on, so usually absent. When it IS
  // there it is the richest lane we have, so it rides along.
  const devTail = devEntries.slice(-limit);
  if (devTail.length) {
    sections.push('', `--- dev log (last ${devTail.length} of ${devEntries.length}) ---`);
    for (const e of devTail) sections.push(`${e.t} [${e.cat}] ${e.label}${e.detail ? ` ${e.detail}` : ''}`);
  }
  if (!sections.length) return null;
  return truncateKeepingTail(sections.join('\n'));
}

/**
 * The wire body. The ONLY place the credential is turned into a digest, so it is impossible for a
 * caller to hand the transport a clear-text password by mistake: the input takes `creds.password` and
 * the output has no `password` key at all.
 */
/** Belt-and-braces on the attached settings copy: parse + strip every secret-named key again.
 *  Unparseable input attaches nothing — a malformed blob must never ride a report raw. */
export function sanitizeSettingsJsonForReport(json: string | null | undefined): string | null {
  if (!json) return null;
  try {
    return JSON.stringify(stripSecretFields(JSON.parse(json) as Record<string, unknown>), null, 2);
  } catch {
    return null;
  }
}

export function buildBugReportPayload(input: BugReportInput): Record<string, unknown> {
  const description = input.description.slice(0, BUG_REPORT_DESCRIPTION_MAX);
  const wireLogText = input.wireLog ? truncateKeepingTail(input.wireLog.text) : null;
  const payload: Record<string, unknown> = {
    coach: input.creds.coach.trim(),
    // Pre-hashed. The clear text never reaches the wire — see the module header.
    passwordMd5: md5Hex(input.creds.password),
    description,
    // Explicit null (not omitted) so the server can tell "no game" from "an old client that never sent it".
    gameId: input.gameId ?? null,
    gameService: input.gameService,
    clientVersion: input.clientVersion,
    context: {
      ...(input.context ?? {}),
      wireLogBytes: input.wireLog?.totalBytes ?? 0,
      wireLogTruncated: Boolean(input.wireLog?.truncated) || wireLogText !== (input.wireLog?.text ?? null),
      submittedAt: new Date().toISOString(),
    },
  };
  // Optional attachments are omitted when unavailable. Older config-web deployments rejected explicit null even
  // though the client intentionally used it to mean "wire logging was off"; omission is compatible everywhere.
  if (wireLogText !== null) payload.wireLog = wireLogText;
  if (input.appLog !== null) payload.appLog = input.appLog;
  const settings = sanitizeSettingsJsonForReport(input.settingsJson);
  if (settings !== null) payload.settings = settings;
  return payload;
}

/**
 * POST the report. Throws with a tester-readable message on any failure — the caller keeps the
 * tester's text on screen so a failed send never eats the report they just wrote.
 */
export async function sendBugReport(
  payload: Record<string, unknown>,
  transport: BugReportTransport,
  baseUrl: string,
): Promise<void> {
  const url = `${baseUrl}/api/bug-reports`;
  let response: Response;
  try {
    response = await transport(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(configWebUnreachableMessage(baseUrl, error instanceof Error ? error.message : String(error)));
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(String(data.error ?? `The server rejected the report (HTTP ${response.status}).`));
  }
}
