use std::{
    collections::VecDeque,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, State};

mod asset_drafts;
mod asset_media;
mod asset_mods;

const MAX_JNLP_BYTES: usize = 128 * 1024;
const MAX_PENDING_JNLPS: usize = 4;
const ACCOUNT_SESSION_SERVICE: &str = "com.fumbbl40k.app";
const ACCOUNT_SESSION_USER: &str = "config-web-session";

fn valid_account_session_token(token: &str) -> bool {
    token.len() == 64 && token.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn account_session_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(ACCOUNT_SESSION_SERVICE, ACCOUNT_SESSION_USER)
        .map_err(|_| "Secure session storage is unavailable".into())
}

#[tauri::command]
fn save_account_session(token: String) -> Result<(), String> {
    if !valid_account_session_token(&token) {
        return Err("Invalid account session token".into());
    }
    account_session_entry()?
        .set_password(&token)
        .map_err(|_| "Account session could not be saved securely".into())
}

#[tauri::command]
fn load_account_session() -> Result<Option<String>, String> {
    match account_session_entry()?.get_password() {
        Ok(token) if valid_account_session_token(&token) => Ok(Some(token)),
        Ok(_) => Err("Stored account session is invalid".into()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Account session could not be read securely".into()),
    }
}

#[tauri::command]
fn clear_account_session() -> Result<(), String> {
    match account_session_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Account session could not be removed from secure storage".into()),
    }
}
/// Owner 2026-08-18 (bug-report feature): ceiling on how much of a verbose wire log rides along with
/// a report. Mirrors BUG_REPORT_LOG_MAX_BYTES in src/game/bugReport.ts.
const MAX_BUG_REPORT_LOG_BYTES: u64 = 12 * 1024 * 1024;

trait JnlpFileReader: Send + Sync + 'static {
    /// Returned errors must never contain the source path, arguments, XML, or
    /// platform error details.
    fn read_bounded_no_follow(&self, path: &Path, max: usize) -> Result<Vec<u8>, String>;
}

struct PlatformJnlpFileReader;

#[cfg(windows)]
impl JnlpFileReader for PlatformJnlpFileReader {
    fn read_bounded_no_follow(&self, path: &Path, max: usize) -> Result<Vec<u8>, String> {
        use std::{
            fs::OpenOptions,
            os::windows::fs::{MetadataExt, OpenOptionsExt},
        };

        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
        const READ_ERROR: &str = "JNLP file could not be read";

        let selected = std::fs::symlink_metadata(path).map_err(|_| READ_ERROR.to_string())?;
        if !selected.is_file() || selected.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(READ_ERROR.into());
        }

        let file = OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
            .map_err(|_| READ_ERROR.to_string())?;
        // This inspects the already-opened no-follow handle; the path check above
        // deliberately uses symlink_metadata so it never follows the selection.
        let opened = file.metadata().map_err(|_| READ_ERROR.to_string())?;
        if !opened.is_file() || opened.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(READ_ERROR.into());
        }

        let mut bytes = Vec::new();
        file.take(max as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| READ_ERROR.to_string())?;
        Ok(bytes)
    }
}

#[cfg(not(windows))]
impl JnlpFileReader for PlatformJnlpFileReader {
    fn read_bounded_no_follow(&self, _: &Path, _: usize) -> Result<Vec<u8>, String> {
        Err("JNLP intake is unsupported on this platform".into())
    }
}

#[derive(Default)]
struct PendingJnlp(Mutex<VecDeque<Result<String, String>>>);

impl PendingJnlp {
    fn push(&self, item: Result<String, String>) -> Result<(), String> {
        let mut queue = self.0.lock().map_err(|_| "JNLP state is unavailable")?;
        if let Ok(xml) = &item {
            if queue
                .iter()
                .any(|queued| matches!(queued, Ok(existing) if existing == xml))
            {
                return Ok(());
            }
        }
        if queue.len() >= MAX_PENDING_JNLPS {
            return Err("JNLP launch queue is full".into());
        }
        queue.push_back(item);
        Ok(())
    }

    fn drain(&self) -> Result<Vec<Result<String, String>>, String> {
        let mut queue = self.0.lock().map_err(|_| "JNLP state is unavailable")?;
        Ok(queue.drain(..).collect())
    }
}

fn jnlp_path(args: &[String], cwd: &Path) -> Option<PathBuf> {
    args.iter().skip(1).find_map(|arg| {
        let path = PathBuf::from(arg);
        let is_jnlp = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("jnlp"))
            .unwrap_or(false);
        if !is_jnlp {
            return None;
        }
        Some(if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        })
    })
}

fn read_jnlp(reader: &dyn JnlpFileReader, path: &Path) -> Result<String, String> {
    let bytes = reader
        .read_bounded_no_follow(path, MAX_JNLP_BYTES)
        .map_err(|_| "JNLP file could not be read".to_string())?;
    if bytes.len() > MAX_JNLP_BYTES {
        return Err("JNLP file is too large".into());
    }
    String::from_utf8(bytes).map_err(|_| "JNLP file is not valid UTF-8".into())
}

#[tauri::command]
fn drain_launch_jnlps(
    pending: State<'_, PendingJnlp>,
) -> Result<Vec<Result<String, String>>, String> {
    pending.drain()
}

fn cold_start_jnlp(reader: &dyn JnlpFileReader) -> Option<Result<String, String>> {
    let args: Vec<String> = std::env::args().collect();
    let cwd = std::env::current_dir().ok()?;
    let path = jnlp_path(&args, &cwd)?;
    Some(read_jnlp(reader, &path))
}

/// Raw process launch arguments for the frontend (the `-dev` developer-panel unlock, see devMode.ts).
#[tauri::command]
fn launch_args() -> Vec<String> {
    std::env::args().collect()
}

/// Owner 2026-07-07: append one JSONL line to a per-game VERBOSE WIRE LOG in the
/// app's log dir (`%LOCALAPPDATA%\com.fumbbl40k.app\logs\` on Windows). The frontend
/// controls `file_name` (one file per observed game) and passes each wire frame
/// as a JSON line. Returns the absolute path so the UI can show it. `file_name`
/// is sanitized to a bare basename (no separators / parent refs) to prevent
/// path traversal. Errors are returned as strings; the frontend swallows them so
/// logging can never break the game.
/// The ONE gate on every caller-supplied log file name. A name is accepted only if it is a bare
/// basename: no separators (so it cannot escape the log dir), no parent refs, and — added with the
/// bug-report reader — no drive prefix and no leading dot, so `C:foo`, `\\?\...` and `.hidden` are all
/// refused too. Callers join the RESULT onto the app log dir themselves; no caller ever supplies a
/// directory, which is what confines both the writer and the reader to that one directory.
fn sanitized_log_name(file_name: &str) -> Result<&str, String> {
    const INVALID: &str = "invalid log file name";
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains("..")
        || file_name.contains(':')
        || file_name.starts_with('.')
    {
        return Err(INVALID.into());
    }
    // Belt and braces: after the character checks, the name must still parse as exactly one
    // normal path component. Anything Rust's own parser reads as a root/prefix/parent is refused.
    let path = Path::new(file_name);
    let mut components = path.components();
    match (components.next(), components.next()) {
        (Some(std::path::Component::Normal(_)), None) => Ok(file_name),
        _ => Err(INVALID.into()),
    }
}

#[tauri::command]
fn verbose_log_append(app: tauri::AppHandle, file_name: String, line: String) -> Result<String, String> {
    let file_name = sanitized_log_name(&file_name)?;
    let dir = app.path().app_log_dir().map_err(|e| format!("no log dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {e}"))?;
    let path = dir.join(file_name);
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open failed: {e}"))?;
    f.write_all(line.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
    f.write_all(b"\n").map_err(|e| format!("write failed: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// What `read_bug_report_log` hands the frontend. `truncated` cannot be inferred from `text` alone,
/// so it is stated: it means we started reading at an offset, and the text is the TAIL.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BugReportLog {
    text: String,
    truncated: bool,
    total_bytes: u64,
}

/// Owner 2026-08-18: read ONE verbose wire log back so the Report modal can attach it.
///
/// Confinement, deliberately narrow — this command can only ever read a file the app itself wrote:
///  * the directory is resolved HERE (`app_log_dir()`), never supplied by the caller — exactly the
///    same directory `verbose_log_append` writes to, and no other;
///  * `file_name` must pass `sanitized_log_name` (a bare basename, no separators / `..` / drive
///    prefix / leading dot), so no join can escape that directory;
///  * NO-FOLLOW: `symlink_metadata` plus (on Windows) a reparse-point check on the already-open
///    handle, so a symlink or junction planted in the log dir cannot redirect the read elsewhere;
///  * SIZE-CAPPED at MAX_BUG_REPORT_LOG_BYTES, and the cap is applied by SEEKING to the tail — a
///    300MB log is never read into memory, only its last 12MB;
///  * read-only, and errors are plain strings the caller shows verbatim.
///
/// Lossy UTF-8 decode: a log truncated mid-multibyte-character at the seek point must still produce a
/// report, so a replacement character at the very first byte is preferable to a failed send.
#[tauri::command]
fn read_bug_report_log(app: tauri::AppHandle, file_name: String) -> Result<BugReportLog, String> {
    const READ_ERROR: &str = "log file could not be read";
    let file_name = sanitized_log_name(&file_name)?;
    let dir = app.path().app_log_dir().map_err(|e| format!("no log dir: {e}"))?;
    let path = dir.join(file_name);

    let meta = std::fs::symlink_metadata(&path).map_err(|_| READ_ERROR.to_string())?;
    if !meta.is_file() {
        return Err(READ_ERROR.into());
    }
    let total_bytes = meta.len();

    let mut file = open_no_follow(&path).map_err(|_| READ_ERROR.to_string())?;
    let truncated = total_bytes > MAX_BUG_REPORT_LOG_BYTES;
    if truncated {
        // Tail, not head: a bug report is about what happened last.
        file.seek(SeekFrom::Start(total_bytes - MAX_BUG_REPORT_LOG_BYTES))
            .map_err(|_| READ_ERROR.to_string())?;
    }
    let mut bytes = Vec::new();
    file.take(MAX_BUG_REPORT_LOG_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|_| READ_ERROR.to_string())?;

    Ok(BugReportLog {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        truncated,
        total_bytes,
    })
}

#[cfg(windows)]
fn open_no_follow(path: &Path) -> std::io::Result<std::fs::File> {
    use std::{
        fs::OpenOptions,
        os::windows::fs::{MetadataExt, OpenOptionsExt},
    };
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

    let file = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    // Inspect the already-open no-follow handle, so the check cannot be raced by a swap after it.
    let opened = file.metadata()?;
    if !opened.is_file() || opened.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "reparse point"));
    }
    Ok(file)
}

#[cfg(not(windows))]
fn open_no_follow(path: &Path) -> std::io::Result<std::fs::File> {
    // The symlink_metadata check at the call site already refused a symlinked entry; opening the same
    // confined path afterwards is the closest portable equivalent to Windows' no-follow handle.
    std::fs::File::open(path)
}

// Settings > General "Associate .jnlp files with this app" button. Per-user (HKCU) only —
// never HKLM, never admin. Mirrors what the (now removed, see tauri.conf.json) installer-time
// `bundle.fileAssociations` used to register unconditionally, but opt-in and reversible.
#[cfg(windows)]
mod jnlp_assoc {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    const PROG_ID: &str = "FUMBBL40k.jnlp";
    const EXT_KEY: &str = "Software\\Classes\\.jnlp";
    const PROGID_KEY: &str = "Software\\Classes\\FUMBBL40k.jnlp";
    const ICON_KEY: &str = "Software\\Classes\\FUMBBL40k.jnlp\\DefaultIcon";
    const COMMAND_KEY: &str = "Software\\Classes\\FUMBBL40k.jnlp\\shell\\open\\command";

    fn exe_path() -> Result<String, String> {
        std::env::current_exe()
            .map_err(|_| "could not resolve the app path".to_string())
            .map(|p| p.to_string_lossy().into_owned())
    }

    pub fn is_associated() -> bool {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        hkcu.open_subkey_with_flags(EXT_KEY, KEY_READ)
            .ok()
            .and_then(|key| key.get_value::<String, _>("").ok())
            .map(|value| value == PROG_ID)
            .unwrap_or(false)
    }

    pub fn set_associated(enable: bool) -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if enable {
            let exe = exe_path()?;

            let (ext_key, _) = hkcu
                .create_subkey(EXT_KEY)
                .map_err(|e| format!("registry write failed: {e}"))?;
            ext_key
                .set_value("", &PROG_ID)
                .map_err(|e| format!("registry write failed: {e}"))?;

            let (progid_key, _) = hkcu
                .create_subkey(PROGID_KEY)
                .map_err(|e| format!("registry write failed: {e}"))?;
            progid_key
                .set_value("", &"FUMBBL join request")
                .map_err(|e| format!("registry write failed: {e}"))?;

            let (icon_key, _) = hkcu
                .create_subkey(ICON_KEY)
                .map_err(|e| format!("registry write failed: {e}"))?;
            icon_key
                .set_value("", &format!("{exe},0"))
                .map_err(|e| format!("registry write failed: {e}"))?;

            let (cmd_key, _) = hkcu
                .create_subkey(COMMAND_KEY)
                .map_err(|e| format!("registry write failed: {e}"))?;
            cmd_key
                .set_value("", &format!("\"{exe}\" \"%1\""))
                .map_err(|e| format!("registry write failed: {e}"))?;
        } else {
            // Only tear down the extension pointer if it is still ours — never clobber
            // another app that has since taken .jnlp over.
            if is_associated() {
                let _ = hkcu.delete_subkey_all(EXT_KEY);
            }
            let _ = hkcu.delete_subkey_all(PROGID_KEY);
        }
        notify_shell();
        Ok(())
    }

    fn notify_shell() {
        // SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, ...) — Explorer picks up the
        // association change immediately, no logoff/logon required.
        #[link(name = "shell32")]
        extern "system" {
            fn SHChangeNotify(
                event_id: i32,
                flags: u32,
                item1: *const std::ffi::c_void,
                item2: *const std::ffi::c_void,
            );
        }
        const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
        const SHCNF_IDLIST: u32 = 0x0000;
        unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, std::ptr::null(), std::ptr::null());
        }
    }
}

#[cfg(not(windows))]
mod jnlp_assoc {
    pub fn is_associated() -> bool {
        false
    }
    pub fn set_associated(_enable: bool) -> Result<(), String> {
        Err("JNLP association is only supported on Windows".into())
    }
}

#[tauri::command]
fn jnlp_association_supported() -> bool {
    cfg!(windows)
}

#[tauri::command]
fn jnlp_association_status() -> bool {
    jnlp_assoc::is_associated()
}

#[tauri::command]
fn set_jnlp_association(enable: bool) -> Result<(), String> {
    jnlp_assoc::set_associated(enable)
}

// --- Settings file (owner 08-19) ----------------------------------------------
// The durable settings store is a JSON FILE in the app data dir, not WebView2
// localStorage (the 08-18 runtime auto-update silently stopped committing the old
// profile's Local Storage to disk). Writes are ATOMIC: temp file, fsync, rename
// over. The .bak is refreshed only by the frontend from a blob that hydrated
// clean. Secrets never appear in the file — the frontend serializer strips them
// by construction (src/game/settings.ts).
const SETTINGS_FILE: &str = "settings.json";
const SETTINGS_BAK: &str = "settings.json.bak";
/// One-shot import source (owner's machine, 08-18 wipe): carries a cleartext
/// password40k the frontend routes to the keychain, never into settings.json.
const SETTINGS_RECOVERY: &str = "recovered-settings-2026-08-18-0138.json";
const MAX_SETTINGS_BYTES: u64 = 16 * 1024 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsFilePayload {
    primary: Option<String>,
    backup: Option<String>,
    recovery: Option<String>,
}

fn settings_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| format!("no data dir: {e}"))
}

/// None = absent OR unreadable/oversized — the frontend's load order treats both as "try the next
/// source"; it never destroys what it could not read (fileMode stays off on total failure).
fn read_settings_text(path: &Path) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_SETTINGS_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

/// Atomic replace: write `<name>.tmp`, fsync, rename over `<name>`. A crash mid-write leaves the
/// old file intact plus a stale .tmp the next write overwrites; the rename is the commit point.
fn atomic_write(dir: &Path, name: &str, contents: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir failed: {e}"))?;
    let tmp = dir.join(format!("{name}.tmp"));
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| format!("write failed: {e}"))?;
        f.write_all(contents.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
        f.sync_all().map_err(|e| format!("sync failed: {e}"))?;
    }
    std::fs::rename(&tmp, dir.join(name)).map_err(|e| format!("rename failed: {e}"))
}

#[tauri::command]
fn settings_load(app: tauri::AppHandle) -> Result<SettingsFilePayload, String> {
    let dir = settings_dir(&app)?;
    Ok(SettingsFilePayload {
        primary: read_settings_text(&dir.join(SETTINGS_FILE)),
        backup: read_settings_text(&dir.join(SETTINGS_BAK)),
        recovery: read_settings_text(&dir.join(SETTINGS_RECOVERY)),
    })
}

/// `refresh_backup` is set only when the caller just hydrated this exact blob clean —
/// the .bak must never be refreshed from bytes that were not proven loadable.
#[tauri::command]
fn settings_save(app: tauri::AppHandle, contents: String, refresh_backup: bool) -> Result<(), String> {
    if contents.len() as u64 > MAX_SETTINGS_BYTES {
        return Err("settings blob too large".into());
    }
    let dir = settings_dir(&app)?;
    atomic_write(&dir, SETTINGS_FILE, &contents)?;
    if refresh_backup {
        atomic_write(&dir, SETTINGS_BAK, &contents)?;
    }
    Ok(())
}

/// Deletes the one-shot recovery file. Called only after a CONFIRMED durable import
/// (file written + any cleartext password accepted by the keychain). Idempotent.
#[tauri::command]
fn settings_purge_recovery(app: tauri::AppHandle) -> Result<(), String> {
    let dir = settings_dir(&app)?;
    match std::fs::remove_file(dir.join(SETTINGS_RECOVERY)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("delete failed: {e}")),
    }
}

// --- OS credential store -----------------------------------------------------
// Windows Credential Manager / macOS Keychain / Secret Service, via the `keyring`
// crate (no plugin needed). The fork coach password lives HERE, never in
// localStorage. Errors surface as opaque strings; the caller degrades to
// session-memory rather than writing clear text back to disk.
const KEYCHAIN_SERVICE: &str = "FUMBBL40k";

fn keychain_entry(account: &str) -> Result<keyring::Entry, String> {
    if account.is_empty() {
        return Err("credential account must not be empty".into());
    }
    keyring::Entry::new(KEYCHAIN_SERVICE, account).map_err(|e| e.to_string())
}

/// `None` = no stored credential (a first run), distinct from an error.
#[tauri::command]
fn keychain_get(account: String) -> Result<Option<String>, String> {
    match keychain_entry(&account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn keychain_set(account: String, secret: String) -> Result<(), String> {
    keychain_entry(&account)?
        .set_password(&secret)
        .map_err(|e| e.to_string())
}

/// Idempotent: deleting an absent credential is success.
#[tauri::command]
fn keychain_delete(account: String) -> Result<(), String> {
    match keychain_entry(&account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let reader: Arc<dyn JnlpFileReader> = Arc::new(PlatformJnlpFileReader);
    let pending = PendingJnlp::default();
    if let Some(item) = cold_start_jnlp(reader.as_ref()) {
        pending
            .push(item)
            .expect("an empty cold-start JNLP queue must accept one item");
    }
    let callback_reader = reader.clone();

    let mut builder = tauri::Builder::default()
        .register_uri_scheme_protocol("f40kmod", asset_mods::asset_protocol);
    // Single-instance forwarding is OPT-IN (FUMBBL_SINGLE_INSTANCE): a plain second launch must stay a
    // full independent client (owner two-coach testing, 08-11). Off = a double-clicked .jnlp opens a NEW
    // instance and joins via the cold-start argv path above; forward-into-running needs the env var.
    if std::env::var_os("FUMBBL_SINGLE_INSTANCE").is_some() {
        // When enabled it must be registered before every other plugin.
        builder = builder.plugin(tauri_plugin_single_instance::init(move |app, args, cwd| {
            if let Some(path) = jnlp_path(&args, Path::new(&cwd)) {
                let item = read_jnlp(callback_reader.as_ref(), &path);
                if let Some(state) = app.try_state::<PendingJnlp>() {
                    let event = if state.push(item).is_ok() {
                        // No XML, path, or error payload crosses the event boundary.
                        "jnlp-launch-available"
                    } else {
                        "jnlp-launch-failed"
                    };
                    let _ = app.emit_to("main", event, ());
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .manage(pending)
        .manage(asset_mods::AssetPackState::default())
        // HTTP plugin: authenticated Config-Web/FUMBBL API traffic only. Media
        // assets are local-pack resolved and the CDN is absent from capabilities.
        .plugin(tauri_plugin_http::init())
        // Native file picker for Settings → UI → Asset packs. Only the chosen
        // path reaches the bounded native validator; the WebView never reads it.
        .plugin(tauri_plugin_dialog::init())
        // Opener: open external promo links (Twitch/Discord) in the system browser.
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_account_session,
            load_account_session,
            clear_account_session,
            launch_args,
            verbose_log_append,
            read_bug_report_log,
            drain_launch_jnlps,
            jnlp_association_supported,
            jnlp_association_status,
            set_jnlp_association,
            keychain_get,
            keychain_set,
            keychain_delete,
            settings_load,
            settings_save,
            settings_purge_recovery,
            asset_mods::list_asset_packs,
            asset_mods::inspect_asset_pack,
            asset_mods::install_asset_pack,
            asset_mods::remove_asset_pack,
            asset_mods::set_asset_pack_leases,
            asset_drafts::asset_draft_list,
            asset_drafts::asset_draft_create,
            asset_drafts::asset_draft_update,
            asset_drafts::asset_draft_inspect,
            asset_drafts::asset_draft_delete,
            asset_drafts::asset_draft_put_image,
            asset_drafts::asset_draft_put_walk_sheet,
            asset_drafts::asset_draft_put_sound,
            asset_drafts::asset_draft_remove_binding,
            asset_drafts::asset_draft_export,
            asset_drafts::asset_draft_apply,
            asset_drafts::asset_draft_migrate_sound_overrides,
            asset_drafts::write_user_override,
            asset_drafts::remove_user_override
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_session_tokens_are_strict_hex_bearers() {
        assert!(valid_account_session_token(&"a".repeat(64)));
        assert!(!valid_account_session_token(&"a".repeat(63)));
        assert!(!valid_account_session_token(&format!("{}g", "a".repeat(63))));
    }

    #[test]
    fn selects_case_insensitive_jnlp_path() {
        let args = vec!["app".into(), "match.JNLP".into()];
        assert_eq!(
            jnlp_path(&args, Path::new("C:/tmp")),
            Some(PathBuf::from("C:/tmp/match.JNLP"))
        );
    }

    #[test]
    fn queue_survives_a_missed_event_and_drains_fifo() {
        let pending = PendingJnlp::default();
        pending.push(Ok("one".into())).unwrap();
        pending.push(Ok("two".into())).unwrap();
        let drained = pending.drain().unwrap();
        assert!(matches!(drained.as_slice(), [Ok(one), Ok(two)] if one == "one" && two == "two"));
        assert!(pending.drain().unwrap().is_empty());
    }

    #[test]
    fn queue_deduplicates_and_reports_capacity() {
        let pending = PendingJnlp::default();
        for index in 0..MAX_PENDING_JNLPS {
            pending.push(Ok(format!("launch-{index}"))).unwrap();
        }
        pending.push(Ok("launch-0".into())).unwrap();
        assert!(pending.push(Ok("overflow".into())).is_err());
        assert_eq!(pending.drain().unwrap().len(), MAX_PENDING_JNLPS);
    }

    struct FailingReader;

    impl JnlpFileReader for FailingReader {
        fn read_bounded_no_follow(&self, _: &Path, _: usize) -> Result<Vec<u8>, String> {
            Err("C:/secret/path and platform details".into())
        }
    }

    #[test]
    fn log_name_gate_refuses_everything_that_could_leave_the_log_dir() {
        assert_eq!(sanitized_log_name("wire-g1-2026.jsonl").unwrap(), "wire-g1-2026.jsonl");
        for bad in [
            "",
            "..",
            "../secret",
            "..\\secret",
            "sub/dir.jsonl",
            "sub\\dir.jsonl",
            "C:secret.jsonl",
            "\\\\?\\C:\\secret",
            ".hidden",
        ] {
            assert!(sanitized_log_name(bad).is_err(), "{bad} must be refused");
        }
    }

    #[test]
    fn settings_atomic_write_survives_a_stale_tmp_and_replaces_in_place() {
        let dir = std::env::temp_dir().join(format!("fumbbl40k-settings-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Crash window: a previous write died after the tmp stage — main file intact, tmp is junk.
        std::fs::write(dir.join(SETTINGS_FILE), "{\"coach\":\"old\"}").unwrap();
        std::fs::write(dir.join(format!("{SETTINGS_FILE}.tmp")), "{trunca").unwrap();
        assert_eq!(
            read_settings_text(&dir.join(SETTINGS_FILE)).unwrap(),
            "{\"coach\":\"old\"}",
            "a stale tmp must never shadow the intact main file"
        );

        // The next write commits over both: tmp consumed by the rename, main replaced whole.
        atomic_write(&dir, SETTINGS_FILE, "{\"coach\":\"new\"}").unwrap();
        assert_eq!(read_settings_text(&dir.join(SETTINGS_FILE)).unwrap(), "{\"coach\":\"new\"}");
        assert!(!dir.join(format!("{SETTINGS_FILE}.tmp")).exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn oversized_or_missing_settings_reads_are_none_not_errors() {
        let dir = std::env::temp_dir().join(format!("fumbbl40k-settings-size-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(read_settings_text(&dir.join("absent.json")).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reader_errors_are_collapsed_before_queue_or_ui() {
        assert_eq!(
            read_jnlp(&FailingReader, Path::new("C:/secret/match.jnlp")).unwrap_err(),
            "JNLP file could not be read"
        );
    }
}
