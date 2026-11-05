<script setup lang="ts">
// Owner feature request 2026-08-18: Report opens a MODAL. The tester writes a short description and the client attaches
// the diagnostics itself (wire log, in-app log, game id, coach names, build id) and POSTs the lot to config-web.
// Owner 2026-10-13: the same dialog is also on the console shell's blade ribbon ("The Bug report button should be
// visible on the FUMBBL.Com / Play / Spectate / Replay blade menus as well"). This component is the ONE dialog; the
// host (SpectateView in a game, App.vue on the shell) supplies only what differs (game/bugReportHost.ts).
//
// Zero game-wire impact: the send is HTTP to config-web, never the game websocket.
// Credentials: `passwordMd5` only (see bugReport.ts). The clear text never leaves this process.
import { computed, nextTick, ref, watch } from 'vue';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { FORK_EDITION } from '../game/edition';
import { bugReportBaseUrl, resolveJoinCreds, serializeSettingsForFile, settings } from '../game/settings';
import { coachPassword } from '../game/credentials';
import {
  BUG_REPORT_DESCRIPTION_MAX,
  buildBugReportPayload,
  formatAppLog,
  gameServiceLabel,
  sendBugReportWithScreenshotFallback,
  wireLogBasename,
  type BugReportLogRead,
} from '../game/bugReport';
import { captureClientWindowInBrowser, reportCaptureUnsettled, screenshotAttachment, type ReportCaptureResult } from '../game/bugReportScreenshot';
import type { BugReportHost } from '../game/bugReportHost';
import { bugReportSettingsSnapshot, collectBugReportEnv } from '../game/bugReportSettings';
import { focusReportDialogIn, onReportModalKeydown } from '../game/reportModalKeys';
import BugReportScreenshotPanel from './BugReportScreenshotPanel.vue';
import { rememberBugReport } from '../game/bugReportUpdates';
import { $t, useLiveSet } from '../i18n';
/** i18n live-switch registrations owned by this component (released on unmount; src/i18n LIVE-SWITCH POLICY). */
const liveSetHere = useLiveSet();
import { t } from '../i18n';

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

const props = defineProps<{
  /** v-model:open. The host owns it (it reads it elsewhere: overlays, key gates). */
  open: boolean;
  host: BugReportHost;
}>();
const emit = defineEmits<{
  'update:open': [open: boolean];
  /** v-model:busy: a send is in flight (the host's key gates read it). */
  'update:busy': [busy: boolean];
  /** The report went out and the dialog closed. */
  sent: [info: { wireLogAttached: boolean }];
}>();

const reportOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});
const reportText = ref('');
const reportBusy = ref(false);
watch(reportBusy, (busy) => emit('update:busy', busy));
const reportError = ref('');
const REPORT_MAX = BUG_REPORT_DESCRIPTION_MAX;

const reportGameId = computed(() => props.host.gameId());
const reportGameService = computed(() => props.host.gameService());
const reportWireLogPath = computed(() => props.host.wireLogPath());

/** The auto-attached summary the modal shows, so the tester can SEE what rides along before sending. */
const reportAttachments = computed(() => {
  const items = [
    reportGameId.value != null
      ? t('bugReport.reportAttachments.gameService', { service: gameServiceLabel(reportGameService.value), gameId: reportGameId.value })
      : t('bugReport.reportAttachments.gameNone'),
    t('bugReport.reportAttachments.buildAppVersion', { APP_VERSION }),
    t('bugReport.reportAttachments.coachP0', { p0: settings.coach40k || settings.coach || '(not set)' }),
  ];
  const wireLogName = wireLogBasename(reportWireLogPath.value);
  items.push(wireLogName
    ? (props.host.wireLogLine ? props.host.wireLogLine(wireLogName) : t('bugReport.reportAttachments.wireLog', { name: wireLogName }))
    : props.host.noWireLogLine);
  const logLines = props.host.logEntries().length;
  items.push(logLines ? t('bugReport.reportAttachments.clientLog', { count: Math.min(logLines, 200) }) : t('bugReport.reportAttachments.clientLogEmpty'));
  items.push(reportShotLine.value);
  return items;
});

// Owner 10-13: "attach a screenshot automatically when the user selects bug report". Pressing Report captures the
// client window FIRST (pitch extract + DOM snapshot, bugReportScreenshot.ts) and opens the dialog as soon as the live
// DOM has been read, so the dialog is never in the picture. The rest (encoding) finishes behind the open dialog.
// Only this entry captures; nothing runs in the background. The capture is dropped when the dialog closes.
const reportShot = ref<ReportCaptureResult | null>(null);
const reportShotInclude = ref(true);
/** Astra (10-13): Send waits for the capture to settle, so nothing is attached the coach has not seen. */
const reportSendBlocked = computed(() => reportCaptureUnsettled(reportShot.value));
/** Shown in the dialog when the report went out but the relay refused its screenshot (413, sent again without). */
const reportNotice = ref('');
let reportCaptureGeneration = 0;
/** The generation of the capture still reading the live DOM (0 = none). Generation-keyed so a closed dialog's late
 *  capture can never clear the flag a newer one set (Astra: the reopen race). */
let reportCaptureBusyGeneration = 0;
let reportCaptureAbort: AbortController | null = null;

/** The Report modal's attachment line for the picture, so the summary stays the truth about what is sent. */
const reportShotLine = computed(() => {
  const result = reportShot.value;
  if (!result) return t('bugReport.reportShotLine.screenshotCapturing');
  if (result.status !== 'ok') return t('bugReport.reportShotLine.screenshotNone');
  if (!reportShotInclude.value) return t('bugReport.reportShotLine.screenshotNotIncluded');
  const { width, height, mimeType } = result.shot;
  return t('bugReport.reportShotLine.screenshotWidthXHeight', { width, height, p2: mimeType === 'image/png' ? 'PNG' : 'JPEG' });
});

/** The host's Report entry: capture the window, then open the dialog (the host calls this through a template ref). */
/** Owner 10-15: `prefill` (the declaration watcher's Report button) is put in front of any draft the tester has. */
function openReport(prefill?: string) {
  if (reportOpen.value || reportCaptureBusyGeneration !== 0) return;
  if (prefill && !reportText.value.includes(prefill)) {
    reportText.value = reportText.value.trim() ? `${prefill}\n${reportText.value}` : prefill;
  }
  reportError.value = '';
  reportNotice.value = '';
  reportShot.value = null;
  reportShotInclude.value = true;
  const generation = ++reportCaptureGeneration;
  reportCaptureBusyGeneration = generation;
  const releaseBusy = () => { if (reportCaptureBusyGeneration === generation) reportCaptureBusyGeneration = 0; };
  const abort = new AbortController();
  reportCaptureAbort = abort;
  const pitch = props.host.pitch();
  const current = () => generation === reportCaptureGeneration && reportOpen.value;
  void captureClientWindowInBrowser({
    capturePitch: pitch ? pitch.capture : null,
    pitchElement: pitch ? pitch.element : null,
    signal: abort.signal,
    onSnapshotTaken: () => {
      releaseBusy();
      if (generation === reportCaptureGeneration) reportOpen.value = true;
    },
  }).then((result) => {
    if (current()) reportShot.value = result;
  }).catch(() => {
    if (current()) reportShot.value = { status: 'failed', notes: [] };
  }).finally(() => {
    releaseBusy();
    if (reportCaptureAbort === abort) reportCaptureAbort = null;
  });
}

/** The dialog's real DOM root (exposed: the hosts pull focus back into it for a key whose target is outside). */
const reportDialog = ref<HTMLElement | null>(null);

/** Drop a capture still in flight: it lands nowhere and never opens the dialog (also the host's escape hatch, e.g. the
 *  shell when a game takes the window while Report is still capturing, Astra P2). */
function cancelPending() {
  reportCaptureGeneration++;   // a capture still finishing lands nowhere
  reportCaptureAbort?.abort(); // ... and stops at its next step instead of finishing for nobody
  reportCaptureAbort = null;
  reportCaptureBusyGeneration = 0;
}

watch(() => props.open, (open) => {
  // Owner 10-13: the open report owns the keyboard; focus goes into it (the description) so no button behind it keeps it.
  if (open) { void nextTick(() => focusReportDialogIn(reportDialog.value)); return; }
  cancelPending();
  reportShot.value = null;     // never keep the picture once the dialog is gone
});

/** Owner 10-13: "Bug reports should swallow all keyboard entry." The modal root stops keydown/keyup from bubbling to the
 *  window handlers (the game's hotkeys, the shell's blade keys). Tab and Shift+Tab cycle inside the report; Escape
 *  closes it unless a send is in flight (game/reportModalKeys.ts). */
function onReportKeydown(event: KeyboardEvent) {
  onReportModalKeydown(event, reportDialog.value, reportBusy.value, () => { reportOpen.value = false; });
}

/** Read the current wire log back through the confined Tauri command. Any failure degrades to "no
 *  wire log attached": a missing attachment must never block the tester's actual words. */
async function readWireLogForReport(): Promise<BugReportLogRead | null> {
  const fileName = wireLogBasename(reportWireLogPath.value);
  if (!fileName) return null;
  try {
    const core = await import('@tauri-apps/api/core');
    return (await core.invoke('read_bug_report_log', { fileName })) as BugReportLogRead;
  } catch {
    return null; // not in Tauri, or the file vanished: send the report without it
  }
}

async function submitReport() {
  const description = reportText.value.trim();
  if (!description || reportBusy.value || reportSendBlocked.value) return;
  // Astra (10-13, consent): the attachment decision (the image AND the checkbox) is frozen HERE, before the first
  // await, from what the coach is looking at; nothing that changes after the click can ride along.
  const screenshot = screenshotAttachment(reportShot.value, reportShotInclude.value);
  reportBusy.value = true;
  reportError.value = '';
  reportNotice.value = '';
  try {
    const wireLog = await readWireLogForReport();
    if (!wireLog && wireLogBasename(reportWireLogPath.value)) props.host.onWireLogUnreadable?.();
    // Fork account = the config-web credential (mirrors forkChallenge's forkCreds). When the tester
    // has no fork coach set we fall back to whatever the active target resolves, so an anonymous
    // spectator can still file something rather than being silently blocked.
    const creds = !FORK_EDITION
      ? { coach: settings.coach.trim() || 'anonymous', password: '' } // owner 09-10: public edition files under the FUMBBL coach
      : settings.coach40k.trim()
        ? { coach: settings.coach40k, password: coachPassword() }
        : resolveJoinCreds();
    const payload = buildBugReportPayload({
      description,
      publicEdition: !FORK_EDITION,
      gameId: reportGameId.value,
      gameService: reportGameService.value,
      clientVersion: APP_VERSION,
      creds,
      wireLog,
      appLog: formatAppLog(props.host.logEntries(), props.host.devLogEntries()),
      // Owner 08-19: triage sees settings instantly. Secret-free by the serializer's construction.
      settingsJson: serializeSettingsForFile(settings),
      // Owner 10-13: the picture taken when Report was opened, only while the coach left it ticked (frozen above).
      screenshot,
      // Owner 10-21: allow-listed display / performance settings + machine facts, so performance reports are diagnosable.
      context: { ...props.host.context(), settings: bugReportSettingsSnapshot(settings, collectBugReportEnv(props.host.pitch()?.element)) },
    });
    // Owner ruling 11-01: public reports go to the baked default host's config-web, flag or no flag (bugReportBaseUrl).
    const { screenshotDropped, response } = await sendBugReportWithScreenshotFallback(payload, tauriFetch, bugReportBaseUrl());
    // Owner 11-04: keep the server's { id, receipt } so the reporter sees its updates (nothing from an older server).
    void rememberBugReport(response, description);
    reportText.value = '';
    if (screenshotDropped) {
      // Astra: the relay refused the picture as too large (413) and the report went again without it. Say so in the
      // dialog (it stays open, text cleared so nothing is sent twice) instead of a toast the coach may miss.
      liveSetHere(reportNotice, 'value', () => t('bugReport.text.yourReportWasSent'));
      return;
    }
    reportOpen.value = false;
    emit('sent', { wireLogAttached: wireLog !== null });
  } catch (error) {
    // The report is NOT lost: the modal stays open with the tester's text intact. Losing someone's
    // carefully-written report is worse than the bug.
    reportError.value = error instanceof Error ? error.message : String(error);
  } finally {
    reportBusy.value = false;
  }
}

defineExpose({ openReport, cancelPending, root: reportDialog });
</script>

<template>
  <!-- Owner 2026-08-18: the Report modal. The tester writes what happened and the client attaches the diagnostics
       itself. The attachment list is shown, not implied, so nobody sends a log they didn't know they were sending.
       Backdrop click does NOT close it: losing a half-written report to a stray click is exactly the failure this
       feature exists to remove. Owner 10-13: the root owns the keyboard (keydown/keyup stop here; Escape closes). -->
  <div v-if="reportOpen" ref="reportDialog" class="modal-backdrop cg-backdrop" tabindex="-1" @keydown.stop="onReportKeydown" @keyup.stop>
    <div class="cg-menu br-menu">
      <div class="cg-head">
        <h2>{{ $t('bugReport.cgMenu.reportAnIssue') }}</h2>
        <button class="cg-close" :disabled="reportBusy" @click="reportOpen = false">✕</button>
      </div>

      <!-- Owner 10-13: the automatic screenshot sits ABOVE the description, first thing under the title. -->
      <BugReportScreenshotPanel v-model="reportShotInclude" :result="reportShot" :disabled="reportBusy" />

      <label class="cg-field">{{ $t('bugReport.cgMenu.whatHappened') }}
        <textarea v-model="reportText" class="br-text" rows="7" :maxlength="REPORT_MAX"
          :placeholder="$t('bugReport.cgMenu.whatDidYouDo')"></textarea>
      </label>
      <p class="hint br-count">{{ reportText.length }} / {{ REPORT_MAX }}</p>

      <div class="br-attach">
        <span class="cg-field-label">{{ $t('bugReport.cgMenu.sentWithYourReport') }}</span>
        <ul>
          <li v-for="line in reportAttachments" :key="line">{{ line }}</li>
        </ul>
      </div>

      <p v-if="reportError" class="br-error">{{ reportError }}</p>
      <p v-if="reportNotice" class="br-notice" data-testid="br-notice">{{ reportNotice }}</p>

      <div class="cg-actions">
        <button type="button" class="cg-cancel" :disabled="reportBusy" @click="reportOpen = false">{{ reportNotice ? $t('bugReport.cgMenu.close') : $t('bugReport.cgMenu.cancel') }}</button>
        <button type="button" class="cg-create" data-testid="br-send" :disabled="reportBusy || reportSendBlocked || !reportText.trim()"
          :title="reportSendBlocked ? $t('bugReport.cgMenu.waitingForTheScreenshot') : undefined"
          @click="submitReport">{{ reportBusy ? $t('bugReport.cgMenu.sending') : $t('bugReport.cgMenu.sendReport') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The modal shell the dialog used to borrow from SpectateView's (scoped) Create Game styles, carried here so it looks
   the same in a game and on the console shell. */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: #0008;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal-backdrop:focus { outline: none; }
.cg-backdrop { z-index: 120; }
.cg-menu {
  background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: 10px;
  padding: 1.1rem 1.3rem; width: min(360px, 92vw); max-height: 82vh; overflow-y: auto;
  display: flex; flex-direction: column; gap: 0.6rem; color: #cdd4dd;
}
.cg-head { display: flex; align-items: center; justify-content: space-between; }
.cg-head h2 { margin: 0; font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem); }
.cg-close { background: none; border: none; color: #8a919c; font-size: max(var(--ui-min-primary-text-size, 16px), 1.1rem); cursor: pointer; }
.cg-close:hover { color: #dfe6df; }
.cg-field, .cg-field-label { display: flex; flex-direction: column; gap: 3px; font-size: max(var(--ui-min-primary-text-size, 16px), 0.8rem); color: var(--ui-text); }
.cg-create, .cg-cancel { border-radius: 6px; padding: 0.45rem 0.9rem; cursor: pointer; font-weight: 600; }
.cg-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.3rem; }
.cg-cancel { background: #2a302a; color: #b8c0b8; border: 1px solid #3a423a; }
.cg-cancel:hover { background: #343b34; }
.cg-create { background: var(--ui-accent); color: #1a1305; border: 1px solid #d4ad3a; }
.cg-create:hover:not(:disabled) { background: #d4ad3a; }
.cg-create:disabled { opacity: 0.55; cursor: default; }
/* Report modal (owner 2026-08-18): rides the .cg-menu shell, amber-accented like the button. */
.br-menu { max-width: 520px; border-color: var(--ui-accent); }
.br-text {
  width: 100%;
  resize: vertical;
  font: inherit;
  font-size: max(var(--ui-min-primary-text-size, 16px), 0.82rem);
  line-height: 1.35;
}
.br-count { text-align: right; margin: 2px 0 6px; }
.br-attach {
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  padding: 6px 10px;
  margin-bottom: 8px;
  background: color-mix(in srgb, var(--ui-surface-2) 60%, transparent);
}
.br-attach ul { margin: 4px 0 0; padding-left: 16px; }
.br-attach li { font-size: max(var(--ui-min-text-size, 12px), 0.74rem); color: var(--ui-muted, #9aa); line-height: 1.5; }
.br-error {
  color: #ffb4b4;
  border: 1px solid #a44;
  border-radius: 5px;
  padding: 6px 10px;
  font-size: max(var(--ui-min-text-size, 12px), 0.76rem);
  margin: 0 0 8px;
}
.br-notice {
  color: #ffe2a8;
  border: 1px solid #a8843a;
  border-radius: 5px;
  padding: 6px 10px;
  font-size: max(var(--ui-min-text-size, 12px), 0.76rem);
  margin: 0 0 8px;
}
</style>
