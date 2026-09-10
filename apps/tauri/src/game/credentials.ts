import { computed, reactive, ref, watch, type WritableComputedRef } from 'vue';
import {
  installCoachPassword40kReader,
  installForkPasswordFallbackReader,
  purgeStoredPassword,
  purgeStoredPassword40k,
  settings,
  stampStoredPassword,
  stampStoredPassword40k,
  takeLegacyPassword40k,
} from './settings';

/**
 * The FUMBBL40k (fork) coach password — the ONE holder in the client.
 *
 * At rest it lives in the OS credential store (Windows Credential Manager / macOS Keychain /
 * Secret Service) behind the `keychain_*` Tauri commands, NOT in localStorage: settings.ts
 * serializes its whole object to disk in clear, which is why `password40k` was removed from it.
 *
 * Reads are sync (`coachPassword()`), because every consumer — resolveJoinCreds, the config-web
 * helpers, the challenge/JNLP wires — is sync. The value is pulled into memory once by
 * initCredentials(), awaited before mount.
 *
 * Failure honesty: if the store is unreachable (a Linux box with no Secret Service, the browser
 * preview) the password falls back to a clear-text copy in the settings blob and
 * `credentialStore.notice` says so. Losing it instead reads to the user as "it didn't save" —
 * the reported P1 — so the fallback is deliberate, announced, and retired by
 * purgeStoredPassword40k() the moment the OS store accepts a write.
 */

/** keyring service is "FUMBBL40k"; one account row per credential. Owner 08-19: the FUMBBL
 *  (official) password moved here too — the settings FILE never holds a secret. */
const ACCOUNT = 'coach40k';
const ACCOUNT_FUMBBL = 'fumbbl';

const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

async function keychain<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/** Non-blocking UI state: `notice` non-empty = the OS store is unusable this session.
 *  `fumbblMemoryOnly` mirrors `memoryOnly` for the FUMBBL-side password row. */
export const credentialStore = reactive({ notice: '', memoryOnly: false, fumbblMemoryOnly: false });

/** Session copy. A ref so the settings inputs can v-model it. */
const password = ref('');

let ready: Promise<void> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function degrade(reason: string): void {
  credentialStore.memoryOnly = true;
  credentialStore.notice =
    `Your fork password couldn't be saved to the OS credential store (${reason}). ` +
    'It has been kept in this app\'s settings file in clear text instead, so it still survives a restart.';
}

function healthy(): void {
  credentialStore.memoryOnly = false;
  credentialStore.notice = '';
}

/** The fork coach password. Sync; '' before initCredentials() resolves. */
export function coachPassword(): string {
  return password.value;
}

installCoachPassword40kReader(coachPassword);

// While the OS store is unusable the clear-text blob copy is the ONLY place the password can
// survive a restart, so the settings persist path must keep stamping it. '' the rest of the time:
// a healthy keychain means no clear-text copy is written, which is the whole point of the move.
installForkPasswordFallbackReader(() => (credentialStore.memoryOnly ? password.value : ''));

/** Write-through: OS store first, and a localStorage copy ONLY when that store refused. */
export async function setCoachPassword(value: string): Promise<void> {
  password.value = value;
  if (!inTauri) {
    // Browser preview: no OS store exists, so the blob is the only place this can live.
    stampStoredPassword40k(value);
    return;
  }
  try {
    if (value) await keychain('keychain_set', { account: ACCOUNT, secret: value });
    else await keychain('keychain_delete', { account: ACCOUNT });
    healthy();
    purgeStoredPassword40k(); // the legacy clear-text copy is now redundant
  } catch (e) {
    degrade((e as Error)?.message ?? String(e));
    // The store rejected the write, so nothing else holds this password. Losing it silently is
    // the reported P1; the notice above tells the user it is stored in the clear as a fallback.
    stampStoredPassword40k(value);
  }
}

/** v-model target for the settings password inputs; debounced write-through (per-keystroke
 *  keychain writes would be pointless churn). */
export const coachPasswordModel: WritableComputedRef<string> = computed({
  get: () => password.value,
  set: (value) => {
    password.value = value;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => { writeTimer = null; void setCoachPassword(value); }, 400);
  },
});

/**
 * Write any debounced edit through NOW. The 400ms window is invisible to the user, so every way
 * of LEAVING a password field has to close it: dismissing the dialog and quitting the app both
 * beat the timer, and a lost write looks exactly like "it didn't save" — silently, because the
 * degrade notice only fires on a keychain error, and a timer that never ran raises none.
 * No-op when nothing is pending, so it is safe to call on every close path.
 */
export function flushCoachPassword(): Promise<void> {
  if (!writeTimer) return Promise.resolve();
  clearTimeout(writeTimer);
  writeTimer = null;
  return setCoachPassword(password.value);
}

// Quit is the one close path with no Vue handler to hang off: the window can go away between the
// last keystroke and the timer. `pagehide` fires on webview teardown where `beforeunload` may not.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => { void flushCoachPassword(); void flushFumbblPassword(); });
}

/**
 * Load the password into memory, migrating a legacy clear-text copy on first run:
 * keychain hit wins; otherwise the localStorage value is written to the keychain and only THEN
 * purged from disk. Idempotent.
 */
export function initCredentials(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    await initForkPassword();
    await initFumbblPassword();
    armFumbblWatcher();
  })();
  return ready;
}

async function initForkPassword(): Promise<void> {
  const legacy = takeLegacyPassword40k();
  if (!inTauri) {
    password.value = legacy;
    // memoryOnly drives the persist fallback, so it must be true whether or not a password
    // exists yet — the NEXT edit is the one that needs the blob to keep holding it.
    credentialStore.memoryOnly = true;
    if (legacy) degrade('browser preview — no OS credential store');
    return;
  }
  try {
    const stored = await keychain<string | null>('keychain_get', { account: ACCOUNT });
    // ABSENT (null, keyring's NoEntry) is the only state that may migrate. An entry that exists
    // but is EMPTY is a password the user deliberately cleared: treating it as "nothing stored"
    // would resurrect the legacy clear-text copy the clearing was meant to retire.
    if (stored !== null) {
      password.value = stored;
      purgeStoredPassword40k(); // a stale clear-text copy alongside the keychain entry
      return;
    }
    if (!legacy) return;
    await keychain('keychain_set', { account: ACCOUNT, secret: legacy });
    password.value = legacy;
    purgeStoredPassword40k();
  } catch (e) {
    password.value = legacy; // keep the session usable; disk copy stays untouched
    degrade((e as Error)?.message ?? String(e));
  }
}

/**
 * FUMBBL (official) password (owner 08-19): same doctrine as the fork row. `settings.password`
 * stays the in-memory/v-model field, but its DURABLE home is the keychain — the settings file
 * strips every secret by construction, so without this row the password would die at app close.
 * Loss-safe migration: the blob/recovery copy is only purged after the keychain CONFIRMS.
 */
async function initFumbblPassword(): Promise<void> {
  if (!inTauri) return; // browser preview: the localStorage blob keeps holding it, as today
  try {
    const stored = await keychain<string | null>('keychain_get', { account: ACCOUNT_FUMBBL });
    if (stored !== null) {
      settings.password = stored;
      purgeStoredPassword(); // a stale clear-text copy alongside the keychain entry
      return;
    }
    const legacy = settings.password; // captured from the localStorage/recovery blob at load
    if (!legacy) return;
    await keychain('keychain_set', { account: ACCOUNT_FUMBBL, secret: legacy });
    purgeStoredPassword();
  } catch {
    // Session stays usable on the in-memory copy; the clear-text blob copy stays untouched.
    credentialStore.fumbblMemoryOnly = true;
  }
}

let fumbblTimer: ReturnType<typeof setTimeout> | null = null;
let fumbblWatcherArmed = false;

/** Armed AFTER init so the keychain hydrate above cannot echo a write back into the keychain. */
function armFumbblWatcher(): void {
  if (fumbblWatcherArmed || !inTauri) return;
  fumbblWatcherArmed = true;
  watch(() => settings.password, (value) => {
    if (fumbblTimer) clearTimeout(fumbblTimer);
    fumbblTimer = setTimeout(() => { fumbblTimer = null; void writeFumbblPassword(value); }, 400);
  });
}

async function writeFumbblPassword(value: string): Promise<void> {
  try {
    if (value) await keychain('keychain_set', { account: ACCOUNT_FUMBBL, secret: value });
    else await keychain('keychain_delete', { account: ACCOUNT_FUMBBL });
    credentialStore.fumbblMemoryOnly = false;
    purgeStoredPassword();
  } catch {
    // Degraded store: the localStorage blob is the fallback — NEVER the settings file.
    credentialStore.fumbblMemoryOnly = true;
    stampStoredPassword(value);
  }
}

/** Close-path flush for the FUMBBL row; no-op when nothing is pending. */
export function flushFumbblPassword(): Promise<void> {
  if (!fumbblTimer) return Promise.resolve();
  clearTimeout(fumbblTimer);
  fumbblTimer = null;
  return writeFumbblPassword(settings.password);
}
