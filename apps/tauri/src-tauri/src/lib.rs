use std::{
    collections::VecDeque,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, State};

mod app_patch;
mod art_pack;
mod coach_history;
mod bug_receipts;
// The edition.json grammar the build script enforces; only its shared-vector test is compiled here (cargo test).
#[cfg(test)]
#[path = "../edition_grammar.rs"]
mod edition_grammar;
mod discord_presence;
mod asset_drafts;
mod asset_media;
mod asset_mods;
// The FUMBBL.COM blade's docked website (owner 10-05; ships in every build since 10-06) - see the module.
mod fumbbl_home;
mod window_state;
mod second_client;

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

/// The one native JNLP intake seam: queue the item for the page's drain_launch_jnlps consumer and nudge it. Used by the
/// single-instance forward and by the Home pane's JNLP download (fumbbl_home.rs). No XML, path, or error payload crosses
/// the event boundary.
fn offer_launch_jnlp(app: &tauri::AppHandle, item: Result<String, String>) {
    if let Some(state) = app.try_state::<PendingJnlp>() {
        let event = if state.push(item).is_ok() {
            "jnlp-launch-available"
        } else {
            "jnlp-launch-failed"
        };
        let _ = app.emit_to("main", event, ());
    }
    focus_main_window(app);
}

/// Bring the main window forward. With tauri's `unstable` feature (the fumbbl-home build) the main window holds two
/// webviews and is no longer a "webview window", so it is looked up as a plain window there.
fn focus_main_window(app: &tauri::AppHandle) {
    #[cfg(feature = "fumbbl-home")]
    let window = app.get_window("main");
    #[cfg(not(feature = "fumbbl-home"))]
    let window = app.get_webview_window("main");
    if let Some(window) = window {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Read a JNLP the Home pane downloaded into its private temp file, with the same bound and UTF-8 checks as a launch
/// argument (`read_jnlp`). The caller deletes the file.
#[cfg_attr(not(feature = "fumbbl-home"), allow(dead_code))]
fn read_downloaded_jnlp(path: &Path) -> Result<String, String> {
    #[cfg(windows)]
    {
        read_jnlp(&PlatformJnlpFileReader, path)
    }
    #[cfg(not(windows))]
    {
        read_jnlp(&TempJnlpFileReader, path)
    }
}

/// Non-Windows reader for the Home pane's own temp file (the launch-argument reader is Windows-only): a regular file,
/// not a symlink, read with the same byte ceiling.
#[cfg(not(windows))]
struct TempJnlpFileReader;

#[cfg(not(windows))]
impl JnlpFileReader for TempJnlpFileReader {
    fn read_bounded_no_follow(&self, path: &Path, max: usize) -> Result<Vec<u8>, String> {
        const READ_ERROR: &str = "JNLP file could not be read";
        // Open FIRST (refusing a symlink as the final component, and never blocking on a FIFO), then check the handle we
        // actually hold: no window between a path check and the open for the file to be swapped.
        let mut options = std::fs::OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        let file = options.open(path).map_err(|_| READ_ERROR.to_string())?;
        let meta = file.metadata().map_err(|_| READ_ERROR.to_string())?;
        if !meta.is_file() {
            return Err(READ_ERROR.into());
        }
        let mut bytes = Vec::new();
        file.take(max as u64 + 1).read_to_end(&mut bytes).map_err(|_| READ_ERROR.to_string())?;
        Ok(bytes)
    }
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

// --- Launch flags (owner 10-14) ------------------------------------------------
// `--skip-intro` (also `--skipintro`) or SUPER_FUMBBL_SKIP_INTRO=1 skips the first-open intro VIDEO only (a Linux
// WebKitGTK without H.264 plugins can show a black frame); the legal acknowledgement is never skippable.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchFlags {
    skip_intro: bool,
    /// Owner 10-31 / ruling 11-01, orchestrator 11-01: the bare `--fork-server` flag turns on the fork-play + Team
    /// Builder surfaces in the public build. It NEVER selects a host (the page uses its baked default; the FORK edition
    /// its own override / env / default): any `--fork-server=<value>` turns nothing on, with a warning that names no
    /// host. SUPER_FUMBBL_FORK_SERVER=1/true/yes/on is the same bare flag. Read on COLD START only: a second launch
    /// forwarded into a running instance (single-instance) does not change it.
    fork_server_enabled: bool,
}

/// Parse the fork-server flag (argument wins over the env var; the last argument decides). Only the bare form counts.
fn fork_server_requested<I: IntoIterator<Item = String>>(args: I, env: Option<String>) -> bool {
    // Some(true) = bare flag; Some(false) = an `=value` form (ignored)
    let mut seen: Option<bool> = None;
    for a in args {
        if a == "--fork-server" {
            seen = Some(true);
        } else if a.starts_with("--fork-server=") {
            seen = Some(false);
        }
    }
    let bare = match seen {
        Some(bare) => bare,
        None => match env {
            Some(e) if !e.trim().is_empty() => {
                let v = e.trim().to_ascii_lowercase();
                v == "1" || v == "true" || v == "yes" || v == "on"
            }
            _ => return false,
        },
    };
    if !bare {
        eprintln!("[launch] ignoring a --fork-server value: only the bare --fork-server flag is accepted");
    }
    bare
}

fn skip_intro_requested<I: IntoIterator<Item = String>>(args: I, env: Option<String>) -> bool {
    let env_on = env
        .map(|v| {
            let v = v.trim().to_ascii_lowercase();
            !(v.is_empty() || v == "0" || v == "false" || v == "no" || v == "off")
        })
        .unwrap_or(false);
    env_on || args.into_iter().any(|a| a == "--skip-intro" || a == "--skipintro")
}

#[tauri::command]
fn launch_flags() -> LaunchFlags {
    LaunchFlags {
        skip_intro: skip_intro_requested(std::env::args(), std::env::var("SUPER_FUMBBL_SKIP_INTRO").ok()),
        fork_server_enabled: fork_server_requested(std::env::args(), std::env::var("SUPER_FUMBBL_FORK_SERVER").ok()),
    }
}

#[cfg(test)]
mod launch_flag_tests {
    use super::{fork_server_requested, skip_intro_requested};
    fn a(v: &[&str]) -> Vec<String> { v.iter().map(|s| s.to_string()).collect() }
    #[test]
    fn flag_and_env() {
        assert!(skip_intro_requested(a(&["app", "--skip-intro"]), None));
        assert!(skip_intro_requested(a(&["app", "--skipintro"]), None));
        assert!(skip_intro_requested(a(&["app"]), Some("1".into())));
        assert!(!skip_intro_requested(a(&["app"]), Some("0".into())));
        assert!(!skip_intro_requested(a(&["app"]), None));
    }
    #[test]
    fn fork_server_bare_flag_only() {
        let f = |args: &[&str], env: Option<&str>| fork_server_requested(a(args), env.map(String::from));
        assert!(f(&["app", "--fork-server"], None));
        assert!(f(&["app", "--fork-server", "C:/games/x.jnlp"], None)); // a following argument is not a host
        assert!(f(&["app"], Some("1")));
        assert!(f(&["app"], Some("ON")));
        // any value form turns nothing on - in every edition (the flag never selects a host)
        assert!(!f(&["app", "--fork-server=fork.example.test"], None));
        assert!(!f(&["app", "--fork-server=superfumbbltest.duckdns.org"], None));
        assert!(!f(&["app", "--fork-server="], None));
        assert!(!f(&["app"], Some("fork.example.test")));
        // the last argument decides; the argument wins over the env var
        assert!(!f(&["app", "--fork-server", "--fork-server=x.example.test"], None));
        assert!(f(&["app", "--fork-server=x.example.test", "--fork-server"], None));
        assert!(!f(&["app", "--fork-server=x.example.test"], Some("1")));
        // absent
        assert!(!f(&["app"], None));
        assert!(!f(&["app", "--skip-intro"], Some("  ")));
        assert!(!f(&["app"], Some("0")));
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

/// Cross-process advisory lock beside settings.json (owner 10-22, second client window): every save holds it around
/// the whole read-merge-write, so two clients can never interleave their renames.
const SETTINGS_LOCK: &str = "settings.lock";

/// A temp name no other process (or thread) uses: `<name>.<pid>-<nanos>-<counter>.tmp`. A shared `<name>.tmp` let a
/// shorter write leave another writer's tail behind and one rename commit invalid JSON (Astra P1, 10-22).
fn unique_tmp_name(name: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!("{name}.{}-{nanos:08x}-{}.tmp", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed))
}

/// Atomic replace: write a per-process unique temp, fsync, rename over `<name>`. A crash mid-write leaves the old
/// file intact plus a stray temp nothing ever reads; the rename is the commit point.
fn atomic_write(dir: &Path, name: &str, contents: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir failed: {e}"))?;
    let tmp = dir.join(unique_tmp_name(name));
    let staged = (|| {
        let mut f = std::fs::File::create(&tmp).map_err(|e| format!("write failed: {e}"))?;
        f.write_all(contents.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
        f.sync_all().map_err(|e| format!("sync failed: {e}"))
    })();
    let result = staged.and_then(|()| std::fs::rename(&tmp, dir.join(name)).map_err(|e| format!("rename failed: {e}")));
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Held for the life of the value; dropping the handle releases the OS lock.
struct SettingsLock(#[allow(dead_code)] std::fs::File);

/// Blocks until this process holds the exclusive settings lock (std File::lock: LockFileEx / flock).
fn lock_settings(dir: &Path) -> Result<SettingsLock, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir failed: {e}"))?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(dir.join(SETTINGS_LOCK))
        .map_err(|e| format!("lock open failed: {e}"))?;
    file.lock().map_err(|e| format!("lock failed: {e}"))?;
    Ok(SettingsLock(file))
}

/// Same denylist as the page's stripSecretFields (settings.ts SECRET_KEY_RE = /password|token|secret/i), at every
/// depth: a merged file can never carry a credential, whichever window put it on disk.
fn strip_secret_fields(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            map.retain(|key, _| {
                let k = key.to_ascii_lowercase();
                !(k.contains("password") || k.contains("token") || k.contains("secret"))
            });
            map.values_mut().for_each(strip_secret_fields);
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(strip_secret_fields),
        _ => {}
    }
}

/// Two-client save (owner 10-22): `patch` = the keys THIS window changed. Under the lock the merge starts from the
/// CURRENT disk object, sets the patched keys over it and removes only the keys named in `retire` (the page's explicit
/// list of fields its migration dropped); every other disk key - including one another window just added - is kept
/// (Astra round 2). Secret-named fields are stripped. An unreadable / non-object disk file -> the page's full blob
/// (`contents`), also stripped.
fn merge_settings_patch(contents: &str, patch: &str, retire: &[String], on_disk: Option<&str>) -> Result<String, String> {
    use serde_json::{Map, Value};
    let ours: Map<String, Value> = serde_json::from_str(contents).map_err(|e| format!("settings blob not an object: {e}"))?;
    let patch: Map<String, Value> = serde_json::from_str(patch).map_err(|e| format!("settings patch not an object: {e}"))?;
    let disk: Option<Map<String, Value>> = on_disk.and_then(|t| serde_json::from_str(t).ok());
    let mut merged = match disk {
        Some(mut disk) => {
            for (key, value) in patch {
                disk.insert(key, value);
            }
            for key in retire {
                disk.remove(key);
            }
            Value::Object(disk)
        }
        None => Value::Object(ours),
    };
    strip_secret_fields(&mut merged);
    serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())
}

/// The official FUMBBL game server (settings.ts FUMBBL_WS_URL): the only url a public build ever persists.
const FUMBBL_WS_URL: &str = "ws://fumbbl.com:22223/command";

/// Owner 10-31 (Sol r4): a PUBLIC build persists nothing about the fork, whatever the merge started from. Applied to
/// the FINAL text under the lock (patch merges keep unmentioned disk keys another edition wrote): target forced to
/// 'fumbbl', url to the official one, forkHost / botConfigUrl / forkUrlCustom removed. A non-object final value is refused.
fn public_sanitized_settings(text: &str) -> Result<String, String> {
    use serde_json::{Map, Value};
    let mut map: Map<String, Value> = serde_json::from_str(text).map_err(|e| format!("settings blob not an object: {e}"))?;
    map.insert("activeServerTarget".into(), Value::String("fumbbl".into()));
    map.insert("url".into(), Value::String(FUMBBL_WS_URL.into()));
    map.remove("forkHost");
    map.remove("botConfigUrl");
    map.remove("forkUrlCustom"); // Sol r22: the FORK edition's "typed fork url" flag never persists in a public build
    serde_json::to_string_pretty(&Value::Object(map)).map_err(|e| e.to_string())
}

/// The settings text at `path` when it parses as a JSON object; None = absent / unreadable / not an object.
fn read_settings_object_text(path: &Path) -> Option<String> {
    read_settings_text(path).filter(|t| serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(t).is_ok())
}

/// What a save achieved (Astra r6): the primary is always written when the call returns Ok; the .bak refresh is
/// reported separately so a partial save (primary ok, .bak failed) is never acknowledged as a complete repair.
#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsSaveOutcome {
    /// Always "ok" (a primary failure is an Err).
    primary: &'static str,
    /// "ok" | "failed" | "skipped" (no refresh asked, or the repaired-primary branch left it alone).
    backup: &'static str,
}

/// The whole save, under the cross-process lock. `patch` None = the single-client full replace.
/// A requested .bak refresh is written from the merged primary text (after the patch), in any branch but the
/// repaired-primary one; its failure is reported in the outcome, not as an Err (the primary did commit).
///
/// `restore` (Astra r4/r5, a window that loaded settings.json.bak because the primary was unreadable) = Some(the
/// RESTORE patch: the page's hydrated-minus-raw-backup migration diff, version key included, plus its own changes).
/// Decided HERE, under the lock, against the file as it is now. Primary still unreadable -> the backup + the restore
/// patch - `retire` (the legacy keys hydration dropped), written to the primary and the .bak, so the migration is
/// persisted. Primary readable again (another window repaired it, its migration already ran) -> only this window's own
/// `patch` merged onto it, no retirements, and the .bak is left alone.
fn save_settings_in(
    dir: &Path,
    contents: &str,
    refresh_backup: bool,
    patch: Option<&str>,
    retire: &[String],
    restore: Option<&str>,
) -> Result<SettingsSaveOutcome, String> {
    save_settings_with(dir, contents, refresh_backup, patch, retire, restore, cfg!(public_edition))
}

/// save_settings_in with the edition explicit (`public` = this shell is the public build: build.rs public_edition).
fn save_settings_with(
    dir: &Path,
    contents: &str,
    refresh_backup: bool,
    patch: Option<&str>,
    retire: &[String],
    restore: Option<&str>,
    public: bool,
) -> Result<SettingsSaveOutcome, String> {
    let too_big = |t: Option<&str>| t.is_some_and(|p| p.len() as u64 > MAX_SETTINGS_BYTES);
    if contents.len() as u64 > MAX_SETTINGS_BYTES || too_big(patch) || too_big(restore) {
        return Err("settings blob too large".into());
    }
    let _lock = lock_settings(dir)?;
    let mut refresh_backup = refresh_backup;
    let text = if let Some(restore_patch) = restore {
        match read_settings_object_text(&dir.join(SETTINGS_FILE)) {
            Some(primary) => {
                refresh_backup = false;
                merge_settings_patch(contents, patch.unwrap_or("{}"), &[], Some(&primary))?
            }
            None => {
                let base = read_settings_object_text(&dir.join(SETTINGS_BAK));
                refresh_backup = true;
                merge_settings_patch(contents, restore_patch, retire, base.as_deref())?
            }
        }
    } else {
        match patch {
            Some(patch) => merge_settings_patch(contents, patch, retire, read_settings_text(&dir.join(SETTINGS_FILE)).as_deref())?,
            None => contents.to_string(),
        }
    };
    // Sol r4: every branch (full replace, patch, both backup recoveries) ends here, so the primary AND the .bak written
    // below carry the sanitised value in a public build.
    let text = if public { public_sanitized_settings(&text)? } else { text };
    atomic_write(dir, SETTINGS_FILE, &text)?;
    let backup = if !refresh_backup {
        "skipped"
    } else if atomic_write(dir, SETTINGS_BAK, &text).is_ok() {
        "ok"
    } else {
        "failed"
    };
    // The pre-10-22 shared temp name: a leftover from an older shell is junk now.
    let _ = std::fs::remove_file(dir.join(format!("{SETTINGS_FILE}.tmp")));
    Ok(SettingsSaveOutcome { primary: "ok", backup })
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
/// the .bak must never be refreshed from bytes that were not proven loadable. `patch` (optional, owner 10-22): the
/// keys this window changed, as a JSON object - merged onto the CURRENT file under the lock; `retire` (optional, with
/// a patch only): keys to remove from the file; `restoreFromBackup` + `restorePatch` (optional): the conditional backup
/// recovery of save_settings_in (`restorePatch` absent -> `patch`). An older shell ignores all of them and writes
/// `contents` whole (the pre-10-22 behaviour).
#[tauri::command]
fn settings_save(
    app: tauri::AppHandle,
    contents: String,
    refresh_backup: bool,
    patch: Option<String>,
    retire: Option<Vec<String>>,
    restore_from_backup: Option<bool>,
    restore_patch: Option<String>,
) -> Result<SettingsSaveOutcome, String> {
    let dir = settings_dir(&app)?;
    let restore = restore_from_backup
        .unwrap_or(false)
        .then(|| restore_patch.as_deref().or(patch.as_deref()).unwrap_or("{}"));
    save_settings_in(&dir, &contents, refresh_backup, patch.as_deref(), retire.as_deref().unwrap_or(&[]), restore)
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
        .register_uri_scheme_protocol("f40kmod", asset_mods::asset_protocol)
        // Owner 09-30 (S51): the page itself — active app patch > embedded dist. Async so part reads stay off the
        // webview thread.
        .register_asynchronous_uri_scheme_protocol("sfapp", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || responder.respond(app_patch::serve(&app, request)));
        });
    // Single-instance forwarding is OPT-IN (FUMBBL_SINGLE_INSTANCE) on the FORK edition: a plain second launch
    // must stay a full independent client (owner two-coach testing, 08-11). Off = a double-clicked .jnlp opens
    // a NEW instance and joins via the cold-start argv path above; forward-into-running needs the env var.
    // Owner 09-21: the PUBLIC edition always enforces one instance — a second launch focuses the running
    // client (and hands it any .jnlp) instead of opening a second session against FUMBBL.
    // Owner 10-22 ("Option A"): Settings > General > "Allow a second client window" lifts the public edition's guard.
    // Read from settings.json on disk before anything is built (second_client.rs); any read failure, or the key saved
    // by the OTHER edition (shared identifier), keeps it ON. With it lifted, a .jnlp opens a NEW window (cold-start
    // argv path) instead of being forwarded - the Settings disclaimer says so.
    let context = tauri::generate_context!();
    let public_edition = cfg!(public_edition);
    let allow_second = public_edition && second_client::allow_at_boot(&context.config().identifier);
    let single_instance = second_client::single_instance_enforced(
        public_edition,
        std::env::var_os(second_client::FORCE_ENV).is_some(),
        allow_second,
    );
    if single_instance {
        // When enabled it must be registered before every other plugin.
        builder = builder.plugin(tauri_plugin_single_instance::init(move |app, args, cwd| {
            if let Some(path) = jnlp_path(&args, Path::new(&cwd)) {
                // offer_launch_jnlp also brings the main window forward.
                offer_launch_jnlp(app, read_jnlp(callback_reader.as_ref(), &path));
            } else {
                focus_main_window(app);
            }
        }));
    }
    // FUMBBL.COM pane: hide the docked FUMBBL webview whenever the main page (re)loads.
    #[cfg(feature = "fumbbl-home")]
    {
        builder = builder.on_page_load(fumbbl_home::on_page_load);
    }
    builder
        .manage(pending)
        .manage(asset_mods::AssetPackState::default())
        .manage(discord_presence::PresenceState::default())
        .manage(app_patch::AppPatchState::default())
        // Diagnostics: FUMBBL_DEVTOOLS=1 opens the web inspector at launch. The native
        // context menu is suppressed in the UI, so this is the only way to reach the
        // console in a release build (e.g. a blank window on a new platform).
        .setup(|app| {
            // FUMBBL.COM pane: before the main webview starts, drop a fumbbl.com HSTS entry an earlier dev build left
            // in the main profile (it turns the game socket into wss:// and every spectate/join fails).
            #[cfg(all(feature = "fumbbl-home", windows))]
            if let Ok(local_data) = app.path().app_local_data_dir() {
                fumbbl_home::purge_default_profile_fumbbl_hsts(&local_data);
            }
            // Owner 09-30 (S51): the main window is `create: false` in tauri.conf.json (url sfapp://localhost/) and
            // built here, so a dev run keeps loading the dev server (devUrl) instead of the scheme. A config that
            // auto-creates "main" (the asset-builder overlay) is left alone.
            if app.get_webview_window("main").is_none() {
                if let Some(mut config) = app.config().app.windows.iter().find(|w| w.label == "main" && !w.create).cloned() {
                    if cfg!(dev) {
                        config.url = tauri::WebviewUrl::App("index.html".into());
                    }
                    // Owner 10-06: the last window size/position (clamped to its monitor), else the FUMBBL.COM site-fit
                    // size in a build with the pane (window_state.rs).
                    let plan = window_state::prepare(app.handle(), &mut config, fumbbl_home::AVAILABLE);
                    let window = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?.build()?;
                    window_state::finish(&window, plan);
                }
            }
            if std::env::var_os("FUMBBL_DEVTOOLS").is_some() {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        // HTTP plugin: authenticated Config-Web/FUMBBL API traffic only. Media
        // assets are local-pack resolved and the CDN is absent from capabilities.
        .plugin(tauri_plugin_http::init())
        // Native file picker for Settings → UI → Asset packs. Only the chosen
        // path reaches the bounded native validator; the WebView never reads it.
        .plugin(tauri_plugin_dialog::init())
        // Opener: open external promo links (Twitch/Discord) in the system browser.
        .plugin(tauri_plugin_opener::init())
        // Owner 09-25: auto-updater — checks the public release's latest.json, verifies the minisign signature against
        // the pubkey in tauri.conf.json, installs, and the JS side relaunches (process plugin).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            launch_flags,
            app_patch::app_patch_status,
            app_patch::app_patch_check,
            app_patch::app_patch_install_part,
            app_patch::app_patch_activate,
            app_patch::app_patch_rollback,
            app_patch::app_patch_prune,
            art_pack::art_pack_dir,
            art_pack::art_pack_installed,
            art_pack::art_pack_install_part,
            art_pack::art_pack_read,
            discord_presence::discord_presence_available,
            discord_presence::discord_presence_set,
            discord_presence::discord_presence_clear,
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
            coach_history::coach_history_load,
            coach_history::coach_history_append,
            coach_history::coach_history_patch_opponent_cr,
            bug_receipts::bug_receipts_load,
            bug_receipts::bug_receipts_update,
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
            asset_drafts::remove_user_override,
            fumbbl_home::fumbbl_home_available,
            fumbbl_home::fumbbl_home_show,
            fumbbl_home::fumbbl_home_hide,
            fumbbl_home::fumbbl_home_navigate,
            fumbbl_home::fumbbl_home_tour,
            fumbbl_home::fumbbl_home_set_zoom,
            fumbbl_home::fumbbl_home_set_filter,
            fumbbl_home::fumbbl_home_focus_region,
            fumbbl_home::fumbbl_home_park,
            fumbbl_home::fumbbl_home_queue_watch,
            fumbbl_home::fumbbl_home_history,
            second_client::launch_second_instance
        ])
        .build(context)
        .expect("error while running tauri application")
        .run(|_app, _event| {
            // FUMBBL.COM pane: its private JNLP directory never outlives the app.
            #[cfg(feature = "fumbbl-home")]
            if let tauri::RunEvent::Exit = _event {
                fumbbl_home::on_exit();
            }
        });
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

    /// The non-Windows reader for the FUMBBL.COM pane's downloaded JNLP opens first and checks the handle.
    #[cfg(unix)]
    #[test]
    fn temp_jnlp_reader_refuses_symlinks_and_non_files_and_stays_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real.jnlp");
        std::fs::write(&real, b"<jnlp/>").unwrap();
        assert_eq!(read_jnlp(&TempJnlpFileReader, &real).unwrap(), "<jnlp/>");
        let link = dir.path().join("link.jnlp");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert!(read_jnlp(&TempJnlpFileReader, &link).is_err());
        assert!(read_jnlp(&TempJnlpFileReader, dir.path()).is_err());
        let big = dir.path().join("big.jnlp");
        std::fs::write(&big, vec![b'a'; MAX_JNLP_BYTES + 10]).unwrap();
        assert_eq!(read_jnlp(&TempJnlpFileReader, &big).unwrap_err(), "JNLP file is too large");
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

        // The next save commits over both: main replaced whole, the legacy shared tmp swept, no temp left behind.
        save_settings_in(&dir, "{\"coach\":\"new\"}", false, None, &[], None).unwrap();
        assert_eq!(read_settings_text(&dir.join(SETTINGS_FILE)).unwrap(), "{\"coach\":\"new\"}");
        assert!(!dir.join(format!("{SETTINGS_FILE}.tmp")).exists());
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "a committed save leaves no temp file");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn settings_temp_names_are_unique_per_writer() {
        let a = unique_tmp_name(SETTINGS_FILE);
        let b = unique_tmp_name(SETTINGS_FILE);
        assert_ne!(a, b);
        assert!(a.contains(&std::process::id().to_string()));
        assert_ne!(a, format!("{SETTINGS_FILE}.tmp"));
    }

    #[test]
    fn settings_lock_is_exclusive_across_handles() {
        // Simulates the second client: while one writer holds settings.lock, another handle cannot take it, so it
        // cannot reach its rename until the first has committed.
        let dir = tempfile::tempdir().unwrap();
        let held = lock_settings(dir.path()).unwrap();
        let other = std::fs::OpenOptions::new().read(true).write(true).open(dir.path().join(SETTINGS_LOCK)).unwrap();
        assert!(other.try_lock().is_err(), "a second writer must not get the lock while the first holds it");
        drop(held);
        assert!(other.try_lock().is_ok(), "released on drop");
    }

    #[test]
    fn concurrent_patch_saves_keep_every_window_change_and_valid_json() {
        // Eight writers each change ONE key ten times, and each also INTRODUCES a key of its own in round 1 that the
        // other writers' blobs never carry; every save goes through the lock + merge, so no change and no added key is
        // lost and the file always parses.
        let dir = tempfile::tempdir().unwrap();
        let base: serde_json::Map<String, serde_json::Value> =
            (0..8).map(|i| (format!("k{i}"), serde_json::json!(0))).collect();
        std::fs::write(dir.path().join(SETTINGS_FILE), serde_json::to_string(&base).unwrap()).unwrap();
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let dir = dir.path().to_path_buf();
                let base = base.clone();
                std::thread::spawn(move || {
                    for round in 1..=10 {
                        let key = format!("k{i}");
                        let mut ours = base.clone();
                        ours.insert(key.clone(), serde_json::json!(round));
                        let mut patch = serde_json::Map::new();
                        patch.insert(key, serde_json::json!(round));
                        if round == 1 {
                            ours.insert(format!("new{i}"), serde_json::json!(i));
                            patch.insert(format!("new{i}"), serde_json::json!(i));
                        }
                        let patch = serde_json::Value::Object(patch).to_string();
                        save_settings_in(&dir, &serde_json::to_string(&ours).unwrap(), false, Some(&patch), &[], None).unwrap();
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        let final_text = read_settings_text(&dir.path().join(SETTINGS_FILE)).unwrap();
        let final_value: serde_json::Value = serde_json::from_str(&final_text).unwrap();
        for i in 0..8 {
            assert_eq!(final_value[format!("k{i}")], serde_json::json!(10), "k{i} lost: {final_text}");
            assert_eq!(final_value[format!("new{i}")], serde_json::json!(i), "new{i} (added by writer {i}) lost: {final_text}");
        }
    }

    #[test]
    fn patch_merge_starts_from_disk_keeps_added_keys_retires_only_named_ones() {
        let parse = |t: &str| serde_json::from_str::<serde_json::Value>(t).unwrap();
        // A's blob lacks `added` (another window put it there) and `gone`; only the patch key and the retired key move.
        let merged = merge_settings_patch(
            "{\"a\":2,\"b\":\"x\",\"c\":true}",
            "{\"a\":2}",
            &["gone".to_string()],
            Some("{\"a\":1,\"b\":\"y\",\"c\":true,\"gone\":1,\"added\":7}"),
        )
        .unwrap();
        assert_eq!(parse(&merged), serde_json::json!({"a": 2, "b": "y", "c": true, "added": 7}));
        // secrets never survive a merge, from the patch or from disk, at any depth
        let merged = merge_settings_patch(
            "{}",
            "{\"password40k\":\"p\",\"n\":{\"apiToken\":\"t\",\"ok\":1}}",
            &[],
            Some("{\"clientSecret\":\"s\",\"keep\":1}"),
        )
        .unwrap();
        assert_eq!(parse(&merged), serde_json::json!({"keep": 1, "n": {"ok": 1}}));
        // unreadable disk: the page's blob (stripped)
        assert_eq!(parse(&merge_settings_patch("{\"a\":1,\"password\":\"x\"}", "{}", &[], Some("{trunc")).unwrap()), serde_json::json!({"a": 1}));
        assert_eq!(parse(&merge_settings_patch("{\"a\":1}", "{}", &[], None).unwrap()), serde_json::json!({"a": 1}));
        assert!(merge_settings_patch("[1]", "{}", &[], None).is_err());
    }

    #[test]
    fn writer_b_adds_a_key_then_writer_a_saves_an_unrelated_change_and_b_key_survives() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(SETTINGS_FILE), "{\"k\":0,\"z\":0}").unwrap();
        // B introduces `fresh`
        save_settings_in(dir.path(), "{\"k\":0,\"z\":0,\"fresh\":true}", false, Some("{\"fresh\":true}"), &[], None).unwrap();
        // A (whose blob never had `fresh`) changes k
        save_settings_in(dir.path(), "{\"k\":5,\"z\":0}", false, Some("{\"k\":5}"), &[], None).unwrap();
        let v: serde_json::Value = serde_json::from_str(&read_settings_text(&dir.path().join(SETTINGS_FILE)).unwrap()).unwrap();
        assert_eq!(v, serde_json::json!({"k": 5, "z": 0, "fresh": true}));
    }

    #[test]
    fn a_failed_bak_refresh_is_reported_and_the_next_refresh_rewrites_it_from_the_primary() {
        let dir = tempfile::tempdir().unwrap();
        let primary = dir.path().join(SETTINGS_FILE);
        let bak = dir.path().join(SETTINGS_BAK);
        // corrupt primary, and the .bak cannot be replaced (fault injection: a directory sits at its path, so the
        // rename between the two writes fails while the primary write succeeds)
        std::fs::write(&primary, "{\"vol").unwrap();
        std::fs::create_dir(&bak).unwrap();
        let out = save_settings_in(dir.path(), "{\"v\":1,\"b\":2}", true, Some("{}"), &[], Some("{}")).unwrap();
        assert_eq!(out, SettingsSaveOutcome { primary: "ok", backup: "failed" });
        assert!(read_settings_object_text(&primary).is_some(), "the primary committed");
        assert!(bak.is_dir());
        // fault clears; the page's backup-refresh retry is a plain (non-restore) save with refreshBackup + its patch
        std::fs::remove_dir(&bak).unwrap();
        let out = save_settings_in(dir.path(), "{\"v\":1,\"b\":3}", true, Some("{\"b\":3}"), &[], None).unwrap();
        assert_eq!(out, SettingsSaveOutcome { primary: "ok", backup: "ok" });
        assert_eq!(std::fs::read(&bak).unwrap(), std::fs::read(&primary).unwrap(), ".bak byte-equal to the primary");
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&primary).unwrap()).unwrap();
        assert_eq!(v, serde_json::json!({"v": 1, "b": 3}));
        // no refresh asked -> skipped
        let out = save_settings_in(dir.path(), "{\"v\":1,\"b\":4}", false, Some("{\"b\":4}"), &[], None).unwrap();
        assert_eq!(out.backup, "skipped");
    }

    #[test]
    fn backup_recovery_after_another_window_repaired_applies_only_own_patch_and_leaves_bak() {
        let dir = tempfile::tempdir().unwrap();
        let parse = |name: &str| serde_json::from_str::<serde_json::Value>(&read_settings_text(&dir.path().join(name)).unwrap()).unwrap();
        // A loaded the backup (volume 20) because the primary was corrupt; its repair failed.
        let bak = "{\"volume\":20,\"badge\":true}";
        std::fs::write(dir.path().join(SETTINGS_BAK), bak).unwrap();
        // B repaired the primary, saved volume 60 and added a key.
        std::fs::write(dir.path().join(SETTINGS_FILE), "{\"volume\":60,\"badge\":true,\"fromB\":1}").unwrap();
        // A's retry: restore-from-backup with A's own change only.
        save_settings_in(dir.path(), "{\"volume\":20,\"badge\":false}", true, Some("{\"badge\":false}"), &["legacy".to_string()], Some("{\"badge\":false,\"version\":35}")).unwrap();
        assert_eq!(parse(SETTINGS_FILE), serde_json::json!({"volume": 60, "badge": false, "fromB": 1}));
        assert_eq!(read_settings_text(&dir.path().join(SETTINGS_BAK)).unwrap(), bak, ".bak untouched");
    }

    #[test]
    fn backup_recovery_with_primary_still_corrupt_restores_backup_plus_own_patch() {
        let dir = tempfile::tempdir().unwrap();
        let parse = |name: &str| serde_json::from_str::<serde_json::Value>(&read_settings_text(&dir.path().join(name)).unwrap()).unwrap();
        std::fs::write(dir.path().join(SETTINGS_BAK), "{\"volume\":20,\"badge\":true}").unwrap();
        std::fs::write(dir.path().join(SETTINGS_FILE), "{\"volu").unwrap();
        // the raw backup is an older version carrying a legacy key hydration dropped; the restore patch carries the
        // migration (version + migrated key) plus this window's own change
        std::fs::write(dir.path().join(SETTINGS_BAK), "{\"version\":30,\"volume\":20,\"badge\":true,\"legacy\":1}").unwrap();
        save_settings_in(
            dir.path(),
            "{\"version\":35,\"volume\":20,\"badge\":false}",
            false,
            Some("{\"badge\":false}"),
            &["legacy".to_string()],
            Some("{\"version\":35,\"badge\":false}"),
        )
        .unwrap();
        assert_eq!(parse(SETTINGS_FILE), serde_json::json!({"version": 35, "volume": 20, "badge": false}));
        assert_eq!(parse(SETTINGS_BAK), serde_json::json!({"version": 35, "volume": 20, "badge": false}));
        // no backup either: the page's blob
        let dir2 = tempfile::tempdir().unwrap();
        save_settings_in(dir2.path(), "{\"volume\":5}", true, Some("{}"), &[], Some("{}")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&read_settings_text(&dir2.path().join(SETTINGS_FILE)).unwrap()).unwrap();
        assert_eq!(v, serde_json::json!({"volume": 5}));
    }

    /// A fork-edition window's values in the shared file (or backup).
    const FORK_FIELDS: &str = "\"activeServerTarget\":\"fork\",\"url\":\"ws://fork.example.test:22227/command\",\"forkHost\":\"fork.example.test\",\"botConfigUrl\":\"https://cfg.example.test\",\"forkUrlCustom\":true";

    fn assert_public_clean(v: &serde_json::Value) {
        assert_eq!(v["activeServerTarget"], "fumbbl", "{v}");
        assert_eq!(v["url"], FUMBBL_WS_URL, "{v}");
        assert!(v.get("forkHost").is_none(), "{v}");
        assert!(v.get("botConfigUrl").is_none(), "{v}");
        assert!(v.get("forkUrlCustom").is_none(), "{v}");
        assert!(!v.to_string().contains("example.test"), "{v}");
    }

    #[test]
    fn public_patch_save_never_keeps_another_editions_fork_fields() {
        let dir = tempfile::tempdir().unwrap();
        let parse = |name: &str| serde_json::from_str::<serde_json::Value>(&read_settings_text(&dir.path().join(name)).unwrap()).unwrap();
        // the fork-edition window updated the shared file; the public window then changes only logOpacity
        std::fs::write(dir.path().join(SETTINGS_FILE), format!("{{{FORK_FIELDS},\"volume\":60}}")).unwrap();
        let out = save_settings_with(dir.path(), "{\"logOpacity\":0.42}", true, Some("{\"logOpacity\":0.42}"), &[], None, true).unwrap();
        assert_eq!(out.backup, "ok");
        for name in [SETTINGS_FILE, SETTINGS_BAK] {
            let v = parse(name);
            assert_public_clean(&v);
            assert_eq!(v["logOpacity"], 0.42);
            assert_eq!(v["volume"], 60, "unrelated disk keys survive");
        }
        // a full replace carrying fork fields is sanitised too
        save_settings_with(dir.path(), &format!("{{{FORK_FIELDS}}}"), false, None, &[], None, true).unwrap();
        assert_public_clean(&parse(SETTINGS_FILE));
    }

    #[test]
    fn public_backup_recovery_sanitises_both_branches() {
        // primary still unreadable: the backup (fork fields) + restore patch -> primary and .bak, both clean
        let dir = tempfile::tempdir().unwrap();
        let parse = |d: &Path, name: &str| serde_json::from_str::<serde_json::Value>(&read_settings_text(&d.join(name)).unwrap()).unwrap();
        std::fs::write(dir.path().join(SETTINGS_BAK), format!("{{{FORK_FIELDS},\"volume\":20}}")).unwrap();
        std::fs::write(dir.path().join(SETTINGS_FILE), "{\"volu").unwrap();
        let out = save_settings_with(dir.path(), "{\"volume\":20}", false, Some("{}"), &[], Some("{\"version\":35}"), true).unwrap();
        assert_eq!(out.backup, "ok");
        for name in [SETTINGS_FILE, SETTINGS_BAK] {
            let v = parse(dir.path(), name);
            assert_public_clean(&v);
            assert_eq!(v["version"], 35);
        }
        // primary repaired by another window (with fork fields): own patch merged onto it, still clean; .bak untouched
        let dir2 = tempfile::tempdir().unwrap();
        std::fs::write(dir2.path().join(SETTINGS_BAK), "{\"volume\":20}").unwrap();
        std::fs::write(dir2.path().join(SETTINGS_FILE), format!("{{{FORK_FIELDS},\"fromB\":1}}")).unwrap();
        let out = save_settings_with(dir2.path(), "{\"badge\":false}", true, Some("{\"badge\":false}"), &[], Some("{\"badge\":false}"), true).unwrap();
        assert_eq!(out.backup, "skipped");
        let v = parse(dir2.path(), SETTINGS_FILE);
        assert_public_clean(&v);
        assert_eq!(v["fromB"], 1);
        assert_eq!(v["badge"], false);
        assert_eq!(read_settings_text(&dir2.path().join(SETTINGS_BAK)).unwrap(), "{\"volume\":20}");
    }

    #[test]
    fn fork_window_adds_fork_url_custom_then_a_public_patch_merge_drops_it() {
        // Sol r22: two windows sharing one file - a FORK-edition window's patch adds forkUrlCustom (and its fork url);
        // the PUBLIC window's later patch (an unrelated key) merges onto that file under the lock and drops it.
        let dir = tempfile::tempdir().unwrap();
        let parse = |name: &str| serde_json::from_str::<serde_json::Value>(&read_settings_text(&dir.path().join(name)).unwrap()).unwrap();
        std::fs::write(dir.path().join(SETTINGS_FILE), "{\"volume\":60}").unwrap();
        save_settings_with(dir.path(), &format!("{{{FORK_FIELDS},\"volume\":60}}"), false, Some(&format!("{{{FORK_FIELDS}}}")), &[], None, false).unwrap();
        assert_eq!(parse(SETTINGS_FILE)["forkUrlCustom"], true); // the fork window wrote it
        save_settings_with(dir.path(), "{\"logOpacity\":0.42}", true, Some("{\"logOpacity\":0.42}"), &[], None, true).unwrap();
        for name in [SETTINGS_FILE, SETTINGS_BAK] {
            let v = parse(name);
            assert_public_clean(&v);
            assert_eq!(v["volume"], 60);
            assert_eq!(v["logOpacity"], 0.42);
        }
    }

    #[test]
    fn fork_edition_save_keeps_its_fork_fields() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(SETTINGS_FILE), format!("{{{FORK_FIELDS}}}")).unwrap();
        save_settings_with(dir.path(), "{\"logOpacity\":0.5}", false, Some("{\"logOpacity\":0.5}"), &[], None, false).unwrap();
        let v: serde_json::Value = serde_json::from_str(&read_settings_text(&dir.path().join(SETTINGS_FILE)).unwrap()).unwrap();
        assert_eq!(v["activeServerTarget"], "fork");
        assert_eq!(v["forkHost"], "fork.example.test");
        assert_eq!(v["botConfigUrl"], "https://cfg.example.test");
        assert_eq!(v["forkUrlCustom"], true); // the FORK edition keeps its own flag
        // and a public build refuses a non-object final value rather than writing it
        assert!(save_settings_with(dir.path(), "[1]", false, None, &[], None, true).is_err());
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
