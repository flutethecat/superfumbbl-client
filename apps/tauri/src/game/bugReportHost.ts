/**
 * Owner 2026-10-13: "The Bug report button should be visible on the FUMBBL.Com / Play / Spectate / Replay blade menus as
 * well." The Report dialog (components/BugReportModal.vue) is shared by two hosts: the in-game view (SpectateView) and
 * the console shell's blade ribbon (App.vue). This is what differs between them; everything else (the screenshot-first
 * flow, the payload builder, the transport, the copy) lives once in the component.
 */
import { gameServiceFromTarget, wireLogBasename, type BugReportDevLogEntry, type BugReportGameService, type BugReportLogEntry } from './bugReport';
import { ref } from 'vue';
import { WIRE_LOG_INSTANCE_TAG } from './wireLogName';
import type { PitchFrame } from './bugReportScreenshot';
import { t } from '../i18n';

export interface BugReportPitch {
  /** The mounted renderer's frame capture (PitchRenderer.captureFrame). */
  capture: () => PitchFrame | null;
  /** The pitch's live canvas, punched out of the DOM snapshot. */
  element: Element | null;
}

export interface BugReportHost {
  /** Read once, when Report is pressed: the live pitch, or null (the shell has no pitch). */
  pitch: () => BugReportPitch | null;
  /** The game the report is about, or null (no game: the shell). */
  gameId: () => number | string | null;
  gameService: () => BugReportGameService;
  /** Path (or bare name) of the wire log to attach; '' = none. Only its basename crosses to the Tauri reader. */
  wireLogPath: () => string;
  /** The attachments-list line when there is no wire log. */
  noWireLogLine: string;
  /** The attachments-list line for the wire log (default `Wire log: <name>`). */
  wireLogLine?: (fileName: string) => string;
  logEntries: () => readonly BugReportLogEntry[];
  devLogEntries: () => readonly BugReportDevLogEntry[];
  /** The payload's `context` object, read when Send is pressed. */
  context: () => Record<string, unknown>;
  /** The named wire log could not be read when Send was pressed (the report went without it). */
  onWireLogUnreadable?: () => void;
}

// ---- the last game's wire log of THIS app run, for a report filed from the shell ----------------------------------
// The store clears `state.wireLogFile` when a game is left, so the shell (shown only with no game loaded) would never
// see one. App.vue watches the store's path and remembers the last non-empty one here, IN MEMORY ONLY (owner 11-14,
// report "nogame": a copy kept in localStorage attached a five-day-old game's log to a report about no game at all). A
// coach whose game just dropped and who reports from the lobby still sends that game's log. Retention ends on a page
// reload as well as an app restart (the memory is the page's), and a game played with logging off leaves nothing. The Tauri reader (read_bug_report_log) takes the basename and refuses anything else, so a remembered name can
// only ever read a log the app itself wrote. A file that has since gone is sent without (the read degrades to null) and
// forgotten.

/** The storage key older builds wrote (localStorage and sessionStorage). Removed at start, never read. */
const LAST_WIRE_LOG_KEY = 'sf.lastWireLogFile';
function removeOldStoredWireLog(): void {
  try { globalThis.localStorage?.removeItem(LAST_WIRE_LOG_KEY); } catch { /* storage blocked */ }
  try { globalThis.sessionStorage?.removeItem(LAST_WIRE_LOG_KEY); } catch { /* storage blocked */ }
}
removeOldStoredWireLog();
/** A ref, so the dialog's attachments list follows it. '' = none (no logged game since this page loaded). */
const lastWireLog = ref('');

// Owner 10-22 (second client window): with the second-client setting on, a window offers only a log carrying its own
// instance tag (wireLogName.ts), never the other window's. (Memory is per window anyway; the check stays as a guard.)

/** Whether the second-client setting is effectively on. settings.ts registers it at load (this module stays free of
 *  the settings import); unregistered = off, the single-window behaviour. */
// `var`, not `let`: settings.ts registers during an import cycle (bugReport -> settings), before this module body has
// run; a `let` would still be in its temporal dead zone there. Unset = off.
// eslint-disable-next-line no-var
var secondClientProbe: (() => boolean) | undefined;
function secondClientEnabled(): boolean { return secondClientProbe?.() === true; }
export function setWireLogSecondClientProbe(probe: () => boolean): void { secondClientProbe = probe; }

/** True when this window may attach `path`: always with the setting off; with it on, only its own tagged file. */
export function isOwnWindowWireLog(path: string): boolean {
  if (!secondClientEnabled()) return true;
  return wireLogBasename(path).endsWith(`-${WIRE_LOG_INSTANCE_TAG}.jsonl`);
}

export function rememberWireLogFile(path: string): void {
  const value = (path || '').trim();
  if (value) lastWireLog.value = value;
}

/** The last game's wire log of this app run; '' = none. */
export function lastWireLogFile(): string {
  return lastWireLog.value && isOwnWindowWireLog(lastWireLog.value) ? lastWireLog.value : '';
}

/** The remembered log could not be read (deleted, or never there): stop offering it. */
export function forgetWireLogFile(): void {
  lastWireLog.value = '';
}

/** Test seam. */
export function resetLastWireLogFile(): void {
  lastWireLog.value = '';
  removeOldStoredWireLog();
}

/** Owner 11-14: which wire log a report attached (context.wireLogSource), for triage. */
export type ReportWireLogSource = 'currentGame' | 'lastGameThisRun' | 'none';

/** The blade names the coach sees on the ribbon, for the attachments list (context.blade carries the raw view id). */
const BLADE_LABELS: Record<string, string> = {
  home: 'FUMBBL.COM', play: 'Play', spectate: 'Spectate', replay: 'Replay', team: 'Team', console: 'Protocol console',
};
export function bladeLabel(view: string): string {
  return BLADE_LABELS[view] ?? view;
}

/** What the shell's host reads (App.vue passes the live `settings` and `gameStore.state`). */
export interface ShellReportDeps {
  /** The current console view (App.vue `view`): rides as context.blade. */
  blade: () => string;
  settings: { activeServerTarget: string; coach40k: string; coach: string; wireLog?: boolean };
  state: { log: readonly BugReportLogEntry[]; devLog: readonly BugReportDevLogEntry[]; sessionState: unknown };
}

/**
 * Owner 2026-10-13: the Report host for the console shell's blade ribbon. No game is loaded there, so: no pitch (the
 * window screenshot is the DOM alone), gameId null, the last game's wire log of this app run (else none),
 * and context.blade = which blade the coach reported from. The service is the active server target, as in a game.
 */
export function createShellReportHost(deps: ShellReportDeps): BugReportHost {
  return {
    pitch: () => null,
    gameId: () => null,
    gameService: () => gameServiceFromTarget(deps.settings.activeServerTarget),
    wireLogPath: () => lastWireLogFile(),
    wireLogLine: (fileName) => t('bugReport.text.wireLogFilenameYour', { fileName }),
    // Owner 11-14: "verbose wire logging is off" only when it is; otherwise no log is available from this session.
    get noWireLogLine() { return deps.settings.wireLog === false ? t('hud.noWireLogLine') : t('bugReport.text.noGameLog'); },
    onWireLogUnreadable: forgetWireLogFile,
    logEntries: () => deps.state.log,
    devLogEntries: () => deps.state.devLog,
    context: () => ({
      blade: deps.blade(),
      coach40k: deps.settings.coach40k || null,
      fumbblCoach: deps.settings.coach || null,
      wireLogFile: wireLogBasename(lastWireLogFile()) || null,
      wireLogSource: (lastWireLogFile() ? 'lastGameThisRun' : 'none') satisfies ReportWireLogSource,
      serverTarget: deps.settings.activeServerTarget,
      sessionState: deps.state.sessionState,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    }),
  };
}
