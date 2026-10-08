//! Owner 2026-10-05: the Home blade - the FUMBBL website (https://fumbbl.com/) in a shell-owned CHILD WEBVIEW docked over
//! the Home pane of the main window. fumbbl.com refuses framing (X-Frame-Options sameorigin + frame-ancestors 'self'), so
//! an <iframe> cannot work; the shell owns a native webview instead and the page reports the pane rectangle to it.
//!
//! Ships in every build (owner 10-06): the live surface (child webview, handlers, tauri's `unstable` feature) compiles with
//! the `fumbbl-home` cargo feature, which is a DEFAULT feature; a `--no-default-features` shell keeps stub commands that
//! report "unavailable" (so shell-api.json is one list for every build).
//!
//! Trust model: the remote page gets NO access to our IPC. Tauri injects its IPC bridge into every webview, but every
//! command from a non-local origin is ACL-checked (tauri 2.11 webview/mod.rs `on_message`, the `!is_local` arm) and no
//! capability in capabilities/ grants anything to a remote URL, so every call - app commands and plugin commands alike -
//! is rejected before dispatch. The Home commands additionally refuse any caller webview other than "main".
//! ONE EXCEPTION in tauri 2.11.5 (webview/mod.rs ~1823): `plugin:__TAURI_CHANNEL__|fetch` skips the ACL check for every
//! origin. It hands out queued Channel payloads (> 8 KiB JSON / > 1 KiB raw) by a GLOBAL sequential id, so a remote page
//! that guesses ids could take a large Channel payload meant for the main page. Nothing of ours sends Channel payloads
//! that large today (tauri-plugin-http 2.5.9 does not use Channels); see dev/fumbbl-home-ipc-probe.js.
//!
//! Navigation: https on fumbbl.com or a subdomain, default port, no userinfo. http links to those hosts are upgraded;
//! any other http(s) link opens in the system browser; every other scheme is dropped. New-window requests follow the same
//! rule (fumbbl.com opens in the Home webview itself).
//!
//! What this is and is not: NAVIGATION FILTERING of the Home webview's MAIN FRAME, not network isolation. XHR/fetch,
//! WebSocket, subresource (img/script/style/beacon) and service-worker traffic from the page is NOT restricted, and
//! neither are navigations inside iframes (WebView2 reports those as FrameNavigationStarting, which tauri does not
//! expose): re-verified 10-05 over CDP, a POST form targeted at an iframe sent its body to an external host. The page
//! can send anything anywhere a browser tab on fumbbl.com could; what it cannot do is turn the docked pane itself into
//! another site.
//!
//! Layer 1, `on_navigation` (WebView2 NavigationStarting, synchronous `SetCancel`, which also fires for redirects).
//! Re-verified 10-05 (tauri 2.11.5 / wry 0.55.1, CDP-recorded): a top-level POST form submission to a refused URL is
//! cancelled BEFORE the request leaves (net::ERR_ABORTED, no request on the wire, body never sent); so is a scripted
//! location change. An earlier note here claimed a cancelled form submission still committed; that did not reproduce.
//! Known holes in layer 1: tauri-runtime-wry ALLOWS any URL it cannot parse (`unwrap_or(true)`), and a navigation the
//! engine starts without NavigationStarting would not be seen.
//! Layer 2, `on_page_load` Started (WebView2 ContentLoading - the earliest post-commit signal tauri exposes): a main-frame
//! document that is not on fumbbl.com sends the webview home. RESIDUAL WINDOW: by ContentLoading the request (with any
//! POST body) has already been sent and its response received; the foreign document can begin parsing and run script
//! until our deferred navigate lands (one event-loop turn). Layer 2 limits how long a foreign page stays docked; it
//! cannot un-send a request. Both layers count their re-navigations in a loop guard (BounceGuard): more than
//! BOUNCE_LIMIT within BOUNCE_WINDOW (e.g. https://fumbbl.com/ itself redirecting off-domain) stops re-navigating, blanks
//! the webview (about:blank), hides it and tells the page (`fumbbl-home-blocked`), which offers "Open in browser".
//!
//! OWN BROWSER PROFILE (P1 found on the owner's vetting run, 10-06): the Home webview must never share the main page's
//! WebView2 profile. Cookies are per HOST, not per port: with one shared profile, everything the site sets in the pane
//! (login session, Cloudflare and FUMBBL cookies) is sent on the MAIN page's game-socket upgrade to
//! ws://fumbbl.com:22223/command. FUMBBL's game server answers a handshake whose Cookie header is >= ~8 KB with HTTP 431
//! (proven with node: 1 KB / 4 KB open, 8 / 12 / 16 KB -> 431), which the page sees as an instant error + close 1006 -
//! every spectate/join fails. SECOND, and the one actually reproduced here (10-06, CDP on the poisoned dev profile): HSTS.
//! https://fumbbl.com sends Strict-Transport-Security (max-age 6-12 months) and HSTS is per host, not per port, so a
//! profile that ever loaded the site upgrades ws://fumbbl.com:22223 to wss://; the plain-TCP Java server cannot speak
//! TLS -> net::ERR_SSL_PROTOCOL_ERROR ~650 ms after connecting, close 1006, with NO cookie header involved. So the
//! child gets its own data directory, `<app local data>/fumbbl-home-profile`
//! (home_profile_dir; persistent, so the coach stays logged in - not incognito), i.e. a separate WebView2 environment and
//! browser process with its own cookie jar. The default profile is shared with the installed client (same identifier),
//! so an unfixed dev build left a fumbbl.com HSTS entry in it (the owner's profile: TransportSecurity rewritten at his
//! Home-pane session exit, 10-05 23:26). At startup (feature builds, Windows) purge_default_profile_fumbbl_hsts removes
//! that ONE entry from `EBWebView/Default/Network/TransportSecurity` BEFORE any webview exists. WebView2 has no HSTS API
//! (ClearBrowsingData(COOKIES) verified NOT to clear it). The file's host keys are hashed, but with a KNOWN hash -
//! base64(SHA-256(host in DNS wire format)), checked against the real poisoned file - so the fumbbl.com entry is removed
//! by key and every other site's HSTS state is kept; no whole-file deletion. Chromium holds this state in memory and
//! rewrites the file on exit, so the edit is skipped while another client runs on that profile (its `lockfile` is held)
//! and retried next start. The edit is idempotent (nothing to remove = no write), so it runs every start and also heals a
//! profile re-poisoned by an older dev build. Cookies were checked too: the owner's cookie DB was untouched, and with the
//! separate pane profile the main jar never receives site cookies (the 431 path), so no cookie purge is needed.
//! macOS: tauri ignores `data_directory` on WKWebView; the pane there would still share
//! the jar (unverified; macOS builds are owner-gated).
//!
//! Platforms (owner 10-06: the pane ships in all 7 hosted targets): everything WebView2-specific - the DownloadStarting
//! cancel hook (`wv2_downloads`, the webview2-com / windows-core crates, which are Windows-only target dependencies), the
//! HSTS purge of the default profile and the exclusive-open probes - is `cfg(windows)`. Elsewhere the pane uses tauri's
//! cross-platform child-webview API only (WKWebView / WebKitGTK): it boots and navigates without the cancel hook, a JNLP
//! download is still saved privately and handed to the JNLP queue, and a stalled one is cleaned up by the purge paths.
//!
//! A `.jnlp` download from fumbbl.com is saved to a private temp file, read once (bounded, same checks as a double-clicked
//! file), deleted, and offered to the EXISTING native JNLP queue (`crate::offer_launch_jnlp` -> PendingJnlp +
//! `jnlp-launch-available` -> the frontend's drain_launch_jnlps consumer). The file carries the site's session token,
//! so the private directory (one `<pid>` subdirectory per instance) is purged on webview creation, on pane hide (when no
//! download is in flight or completing), on app exit, and per download when its watcher gives up (the WebView2 download
//! is cancelled first). Off-site hand-offs to the system browser are rate-limited (EXTERNAL_OPEN_LIMIT).

#![cfg_attr(not(feature = "fumbbl-home"), allow(dead_code))]

use serde::Deserialize;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::Url;

/// The child webview's label. Nothing in capabilities/ names it; it sits in window "main" but only ever loads remote
/// content, which no capability covers.
pub const HOME_LABEL: &str = "fumbbl-home";
pub const HOME_URL: &str = "https://fumbbl.com/";
/// The registrable domain the Home webview may stay on.
const FUMBBL_DOMAIN: &str = "fumbbl.com";
/// Largest pane edge we accept from the page, in logical pixels.
const MAX_EDGE: f64 = 16_384.0;
/// The error `fumbbl_home_show` returns while the loop guard has stopped the pane (the page matches on it).
pub const BLOCKED_ERROR: &str = "fumbbl-home-blocked";
/// Loop guard: at most this many automatic re-navigations (bounce home / http upgrade) within BOUNCE_WINDOW.
pub const BOUNCE_LIMIT: usize = 3;
pub const BOUNCE_WINDOW: Duration = Duration::from_secs(10);

/// True when the live Home pane is compiled into this shell.
pub const AVAILABLE: bool = cfg!(feature = "fumbbl-home");


/// A URL the Home webview may load: https, a fumbbl.com host (the domain itself or a subdomain), no userinfo, default
/// port. `Url` has already lowercased the host and converted IDNs to punycode, so look-alikes cannot match by accident.
pub fn is_fumbbl_url(url: &Url) -> bool {
    url.scheme() == "https" && is_fumbbl_authority(url)
}

fn is_fumbbl_authority(url: &Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return false;
    }
    // `domain()` is None for IP-literal hosts.
    match url.domain() {
        Some(host) => host == FUMBBL_DOMAIN || host.ends_with(".fumbbl.com"),
        None => false,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum NavDecision {
    /// Load it in the Home webview.
    Allow,
    /// An http fumbbl.com link: load the https URL instead.
    Upgrade(Url),
    /// Somewhere else on the web: hand it to the system browser.
    External,
    /// Anything else (javascript:, file:, data:, about:, custom schemes): drop it.
    Block,
}

pub fn navigation_decision(url: &Url) -> NavDecision {
    if is_fumbbl_url(url) {
        return NavDecision::Allow;
    }
    match url.scheme() {
        "http" if is_fumbbl_authority(url) => {
            let mut upgraded = url.clone();
            match upgraded.set_scheme("https") {
                Ok(()) if is_fumbbl_url(&upgraded) => NavDecision::Upgrade(upgraded),
                _ => NavDecision::Block,
            }
        }
        "http" | "https" if url.host().is_some() && url.username().is_empty() && url.password().is_none() => {
            NavDecision::External
        }
        _ => NavDecision::Block,
    }
}

/// While the loop guard has tripped, the only navigation the Home webview may make is our own blanking.
pub fn tripped_navigation_allowed(url: &Url) -> bool {
    url.as_str() == "about:blank"
}

#[derive(Debug, PartialEq, Eq)]
pub enum Bounce {
    /// Re-navigate (send it home / load the upgraded URL).
    Retry,
    /// This bounce crossed the limit: stop, blank and hide the webview, tell the page.
    GiveUp,
    /// Already stopped: do nothing.
    Stopped,
}

/// Loop guard for the automatic re-navigations of both navigation layers. Pure (the caller supplies the clock).
#[derive(Debug, Default)]
pub struct BounceGuard {
    recent: VecDeque<Instant>,
    tripped: bool,
}

impl BounceGuard {
    pub const fn new() -> Self {
        Self { recent: VecDeque::new(), tripped: false }
    }

    pub fn record(&mut self, now: Instant) -> Bounce {
        if self.tripped {
            return Bounce::Stopped;
        }
        while let Some(&oldest) = self.recent.front() {
            if now.saturating_duration_since(oldest) > BOUNCE_WINDOW {
                self.recent.pop_front();
            } else {
                break;
            }
        }
        if self.recent.len() >= BOUNCE_LIMIT {
            self.tripped = true;
            self.recent.clear();
            return Bounce::GiveUp;
        }
        self.recent.push_back(now);
        Bounce::Retry
    }

    pub fn is_tripped(&self) -> bool {
        self.tripped
    }

    /// The user asked to try again.
    pub fn reset(&mut self) {
        self.tripped = false;
        self.recent.clear();
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum DownloadDecision {
    /// A JNLP offered by fumbbl.com: save it privately and hand it to the native JNLP queue.
    Jnlp,
    /// Some other download: cancel it here and open the URL in the system browser.
    External,
    /// Not from an allowed origin: cancel it.
    Refuse,
}

/// `suggested` is the destination the webview proposed (it carries the server's file name on WebView2/WebKitGTK; it may be
/// empty on WKWebView). A JNLP is recognised by the URL path or the suggested file name, and ONLY from a fumbbl.com URL.
pub fn download_decision(url: &Url, suggested: &Path) -> DownloadDecision {
    if !is_fumbbl_url(url) {
        return DownloadDecision::Refuse;
    }
    let path_is_jnlp = url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .map(|last| last.to_ascii_lowercase().ends_with(".jnlp"))
        .unwrap_or(false);
    let name_is_jnlp = suggested
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("jnlp"))
        .unwrap_or(false);
    if path_is_jnlp || name_is_jnlp {
        DownloadDecision::Jnlp
    } else {
        DownloadDecision::External
    }
}

// --- the private JNLP directory -------------------------------------------------------------------------------------

/// `%TEMP%\super-fumbbl-home-jnlp`, shared by every fork instance (fork builds allow several at once). Each process
/// works only in its own `<pid>` subdirectory (`jnlp_temp_dir`) so one instance's purge never deletes another's download.
pub fn jnlp_root_dir() -> PathBuf {
    std::env::temp_dir().join("super-fumbbl-home-jnlp")
}

/// Where THIS process's Home JNLP downloads land: `%TEMP%\super-fumbbl-home-jnlp\<pid>`. Nothing else writes here.
pub fn jnlp_temp_dir() -> PathBuf {
    jnlp_root_dir().join(std::process::id().to_string())
}

/// Older than this, a file in ANOTHER instance's subdirectory is a leftover (a download gives up after 2 minutes).
pub const STALE_SIBLING_AFTER: Duration = Duration::from_secs(10 * 60);

/// Webview creation: clear leftovers of crashed/older instances without touching a live instance's download. Top-level
/// files (the pre-subdirectory layout) go; in other `<pid>` subdirectories only files older than `max_age` go, and a
/// subdirectory left empty is removed. `own` is purged by the caller.
pub fn purge_stale_siblings(root: &Path, own: &Path, max_age: Duration, now: std::time::SystemTime) {
    purge_matching(root, |_| true);
    let Ok(entries) = std::fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == own || !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Ok(files) = std::fs::read_dir(&path) else { continue };
        for file in files.flatten() {
            let Ok(kind) = file.file_type() else { continue };
            if !(kind.is_file() || kind.is_symlink()) {
                continue;
            }
            let old = std::fs::symlink_metadata(file.path())
                .and_then(|m| m.modified())
                .map(|modified| now.duration_since(modified).map(|age| age > max_age).unwrap_or(false))
                .unwrap_or(true);
            if old {
                let _ = std::fs::remove_file(file.path());
            }
        }
        let _ = std::fs::remove_dir(&path); // only succeeds when empty
    }
}

/// Sliding-window limiter (pure; the caller supplies the clock).
#[derive(Debug, Default)]
pub struct RateLimit {
    recent: VecDeque<Instant>,
}

impl RateLimit {
    pub const fn new() -> Self {
        Self { recent: VecDeque::new() }
    }

    pub fn allow(&mut self, now: Instant, limit: usize, window: Duration) -> bool {
        while let Some(&oldest) = self.recent.front() {
            if now.saturating_duration_since(oldest) > window {
                self.recent.pop_front();
            } else {
                break;
            }
        }
        if self.recent.len() >= limit {
            return false;
        }
        self.recent.push_back(now);
        true
    }
}

/// System-browser hand-offs from the Home webview: at most this many per window (a hostile page cannot spam tabs).
pub const EXTERNAL_OPEN_LIMIT: usize = 3;
pub const EXTERNAL_OPEN_WINDOW: Duration = Duration::from_secs(10);

/// Delete every entry of `dir` that is a file or a symlink (never followed), including the engine's intermediate names
/// (`*.crdownload`, `Unconfirmed *`). Subdirectories are left alone. A missing directory is fine.
pub fn purge_jnlp_dir(dir: &Path) {
    purge_matching(dir, |_| true);
}

/// Delete the files in `dir` whose name starts with `prefix` (a download's uuid: the final `<uuid>.jnlp` and any
/// intermediate `<uuid>.jnlp.crdownload`-style name).
pub fn purge_jnlp_prefix(dir: &Path, prefix: &str) {
    if prefix.is_empty() {
        return;
    }
    purge_matching(dir, |name| name.starts_with(prefix));
}

fn purge_matching(dir: &Path, pick: impl Fn(&str) -> bool) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        if !(kind.is_file() || kind.is_symlink()) {
            continue;
        }
        if entry.file_name().to_str().map(&pick).unwrap_or(false) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// The native surface as the main-thread show step sees it (a tauri Webview in the app, a fake in tests).
pub trait HomeSurface {
    fn set_bounds(&mut self, bounds: HomeBounds);
    fn show(&mut self);
    fn hide(&mut self);
    /// The coach's zoom (owner 10-06), re-applied on every show (navigation and re-creation keep it too, see `live`).
    fn set_zoom(&mut self, factor: f64);
}

/// The ONE place the Home webview is made visible. MUST run on the main thread: stop() (the loop guard tripping) also
/// runs there - navigation callbacks are main-thread - so the guard read here and stop()'s hide are totally ordered.
/// `tripped` is read at execution time, `wanted` is the page's latest request (`None` = hidden). A stop that ran before
/// this step leaves the surface hidden; a stop after it hides it. Either way a stopped pane ends hidden.
pub fn apply_show_on_main(
    tripped: bool,
    wanted: Option<HomeBounds>,
    zoom: f64,
    surface: &mut impl HomeSurface,
) -> Result<(), String> {
    if tripped {
        surface.hide();
        return Err(BLOCKED_ERROR.into());
    }
    match wanted {
        Some(bounds) => {
            surface.set_bounds(bounds);
            surface.show();
            surface.set_zoom(zoom);
        }
        None => surface.hide(),
    }
    Ok(())
}

/// Which in-flight download a finish event belongs to: ONLY the one whose private destination (`<uuid>.jnlp`, unique per
/// download, assigned by us at DownloadStarting) is the reported file. An event without a path, or for a file no longer
/// in flight (its watcher already finished it), matches nothing and is dropped - it must never take another entry.
pub fn finished_entry_index(targets: &[&Path], reported: Option<&Path>) -> Option<usize> {
    let name = reported?.file_name()?;
    targets.iter().position(|target| target.file_name().map(|t| t.eq_ignore_ascii_case(name)).unwrap_or(false))
}

/// Chromium's TransportSecurity key for a host: base64(SHA-256(the host in DNS wire format)).
pub fn hsts_host_key(host: &str) -> String {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let mut wire = Vec::new();
    for label in host.trim_end_matches('.').split('.') {
        wire.push(label.len() as u8);
        wire.extend_from_slice(label.to_ascii_lowercase().as_bytes());
    }
    wire.push(0);
    base64::engine::general_purpose::STANDARD.encode(Sha256::digest(&wire))
}

/// Remove the `sts` entries for `host` from a Chromium TransportSecurity JSON document. `None` = nothing to change (no
/// entry, or not a document we understand - never rewrite what we cannot parse).
pub fn strip_hsts_host(json: &str, host: &str) -> Option<String> {
    let mut doc: serde_json::Value = serde_json::from_str(json).ok()?;
    let key = hsts_host_key(host);
    let entries = doc.get_mut("sts")?.as_array_mut()?;
    let before = entries.len();
    entries.retain(|entry| entry.get("host").and_then(|h| h.as_str()) != Some(key.as_str()));
    if entries.len() == before {
        return None;
    }
    serde_json::to_string(&doc).ok()
}

/// The main (default) profile's HSTS store: `<app local data>/EBWebView/Default/Network/TransportSecurity`.
pub fn default_profile_hsts_file(app_local_data: &Path) -> PathBuf {
    app_local_data.join("EBWebView").join("Default").join("Network").join("TransportSecurity")
}

/// True while a WebView2 browser process runs on the default profile. Chromium keeps `EBWebView/lockfile` open for its
/// whole life (opened with FILE_SHARE_READ only and DELETE_ON_CLOSE), so our open asking for exclusive access (no
/// sharing) fails with a sharing violation while it runs; a missing or openable lockfile means nothing runs there. This
/// is a PROBE, not a lock: the caller holds its own lock (hsts_lock_file) and re-probes right before it commits.
pub fn default_profile_in_use(app_local_data: &Path) -> bool {
    let lockfile = app_local_data.join("EBWebView").join("lockfile");
    if !lockfile.exists() {
        return false;
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0); // exclusive: fails with a sharing violation while the browser holds it
    }
    options.open(&lockfile).is_err()
}

/// Our own lock for the HSTS edit, beside Chromium's: `EBWebView/super-fumbbl-hsts.lock`. Held exclusively (no sharing)
/// from the read to the rename, so two of our clients starting together never interleave their edits. Chromium's own
/// lockfile is not held (a client whose browser cannot open it would fail to start); it is probed before the read and
/// again right before the rename instead. The lock file stays on disk as a 0-byte file BY DESIGN: exclusion is by the
/// open handle, not by the file existing, so it is never cleaned up and a leftover one never blocks anything.
pub fn hsts_lock_file(app_local_data: &Path) -> PathBuf {
    app_local_data.join("EBWebView").join("super-fumbbl-hsts.lock")
}

/// Exclusive on Windows (share mode 0) - the only platform the HSTS edit runs on (lib.rs gates it on `windows`).
fn open_exclusive(path: &Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    options.open(path)
}

/// Startup, BEFORE any webview exists: drop fumbbl.com's HSTS entry from the main profile (see the module comment).
/// Returns whether an entry was removed. Skipped (retried next start) while another client runs on the profile or another
/// of ours is editing. Written to a unique temp file, fsynced, then renamed over the original (atomic replace), so the
/// file is never truncated or half-written.
///
/// RESIDUAL WINDOW (cannot be closed from our side - Chromium never takes our lock): a WebView2 client on this profile
/// that starts between the final probe and the rename can load the old file and later write the entry back from memory
/// (a lost update). The entry then survives that run and is removed again at our next start; the worst case is one more
/// failed game-socket connect in that run, never a corrupt file.
pub fn purge_default_profile_fumbbl_hsts(app_local_data: &Path) -> bool {
    purge_hsts_with_hook(app_local_data, || ())
}

/// `before_commit` runs after the temp file is durable and before the final probe + rename (tests use it to observe the
/// held lock and to race a second purge).
fn purge_hsts_with_hook(app_local_data: &Path, before_commit: impl FnOnce()) -> bool {
    let file = default_profile_hsts_file(app_local_data);
    if !file.exists() {
        return false;
    }
    let Ok(_lock) = open_exclusive(&hsts_lock_file(app_local_data)) else {
        return false; // another of our clients is doing this edit right now
    };
    if default_profile_in_use(app_local_data) {
        eprintln!("[fumbbl-home] main profile in use by another client: fumbbl.com HSTS check skipped until next start");
        return false;
    }
    let Ok(json) = std::fs::read_to_string(&file) else { return false };
    let Some(stripped) = strip_hsts_host(&json, FUMBBL_DOMAIN) else { return false };
    let temp = file.with_file_name(format!(
        "TransportSecurity.super-fumbbl-{}-{}.tmp",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ));
    // create_new: if it fails, the path is not ours (nothing was created) and is never removed.
    let mut out = match std::fs::OpenOptions::new().write(true).create_new(true).open(&temp) {
        Ok(out) => out,
        Err(error) => {
            eprintln!("[fumbbl-home] could not create the HSTS temp file: {error}");
            return false;
        }
    };
    let durable = {
        use std::io::Write;
        out.write_all(stripped.as_bytes()).and_then(|()| out.sync_all())
    };
    drop(out);
    if let Err(error) = durable {
        let _ = std::fs::remove_file(&temp); // ours: created above
        eprintln!("[fumbbl-home] could not write the HSTS temp file: {error}");
        return false;
    }
    before_commit();
    if default_profile_in_use(app_local_data) {
        // A client started while we were editing (seen by this probe): it has loaded the old state and would write it
        // back; try next start. A client starting AFTER this probe is the residual window in the doc comment above.
        let _ = std::fs::remove_file(&temp);
        eprintln!("[fumbbl-home] main profile opened during the HSTS edit: skipped until next start");
        return false;
    }
    match std::fs::rename(&temp, &file) {
        Ok(()) => {
            eprintln!(
                "[fumbbl-home] removed the fumbbl.com HSTS entry from the main profile (it upgrades ws://fumbbl.com:22223 to wss and breaks every game socket)"
            );
            true
        }
        Err(error) => {
            let _ = std::fs::remove_file(&temp);
            eprintln!("[fumbbl-home] could not replace {}: {error}", file.display());
            false
        }
    }
    // `_lock` is released here, after the rename.
}

/// The Home webview's OWN WebView2 data directory (cookie jar) under the app's local data dir. The main page's profile is
/// tauri's default, `<app local data>` itself (WebView2 keeps it in `<app local data>/EBWebView`), so this never overlaps it.
pub fn home_profile_dir(app_local_data: &Path) -> PathBuf {
    app_local_data.join("fumbbl-home-profile")
}

/// macOS: the pane's own persistent WKWebsiteDataStore (WebviewBuilder::data_store_identifier, macOS 14+) - WKWebView
/// ignores `data_directory`. A STABLE 16-byte identifier (the same store every launch, so the coach stays logged in),
/// derived from the profile name: SHA-256 truncated, with the RFC 9562 version (8) and variant bits set.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn home_data_store_id() -> [u8; 16] {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(b"super-fumbbl:fumbbl-home-profile");
    let mut id = [0u8; 16];
    id.copy_from_slice(&digest[..16]);
    id[6] = (id[6] & 0x0f) | 0x80; // version 8 (custom)
    id[8] = (id[8] & 0x3f) | 0x80; // RFC variant
    id
}

/// The Home pane rectangle in logical (CSS) pixels relative to the main window's client area.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct HomeBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Reject non-finite or absurd rectangles; clamp the origin to the client area. `None` = nothing sensible to show.
pub fn sanitize_bounds(bounds: HomeBounds) -> Option<HomeBounds> {
    let HomeBounds { x, y, width, height } = bounds;
    if ![x, y, width, height].iter().all(|v| v.is_finite()) {
        return None;
    }
    if width < 1.0 || height < 1.0 || width > MAX_EDGE || height > MAX_EDGE || x.abs() > MAX_EDGE || y.abs() > MAX_EDGE {
        return None;
    }
    let (x, width) = if x < 0.0 { (0.0, width + x) } else { (x, width) };
    let (y, height) = if y < 0.0 { (0.0, height + y) } else { (y, height) };
    if width < 1.0 || height < 1.0 {
        return None;
    }
    Some(HomeBounds { x: x.round(), y: y.round(), width: width.round(), height: height.round() })
}

// --- the Home pane walkthrough (owner 10-06, docs/artifact-orchestration/spec-home-pane-tour.md) ----------------------
//
// Same gates as the pane. NO IPC is exposed to fumbbl.com content for it either:
// - site -> host: the injected runtime (home_tour_runtime.js) navigates to `https://fumbbl.com/__sf-tour__#sf-tour:<event>`;
//   on_navigation recognises it (tour_navigation), DENIES it and emits `fumbbl-home:tour` {event} to the main window. A
//   reserved PATH is required, not just the fragment: a bare `location.hash = '#sf-tour:...'` is a same-document
//   navigation, for which WebView2 raises no NavigationStarting (learn.microsoft.com .../webview2/concepts/navigation-events:
//   "Same-document navigation events ... don't cause a NavigationStarting event to be fired"), so on_navigation would never
//   see it. Any page on fumbbl.com can forge these events; all they can do is move the walkthrough along.
// - host -> site: `fumbbl_home_tour(call)` evals ONLY `window.__sfTour.<show|clear|arm>(<json>)`, re-serialised by us
//   (tour_script), and the shell itself evals `report()` after a page load while a tour is armed.

/// The reserved path of the walkthrough's site->host channel (never a real fumbbl.com page; always denied).
pub const TOUR_EVENT_PATH: &str = "/__sf-tour__";
pub const TOUR_FRAGMENT_PREFIX: &str = "sf-tour:";

#[derive(Debug, PartialEq, Eq)]
pub enum TourNav {
    /// Not the walkthrough channel: the normal navigation rule applies.
    NotTour,
    /// A well-formed event (`<button>.<step>`, lowercase letters): deny and emit it.
    Event(String),
    /// The reserved path with anything else: deny, emit nothing.
    Malformed,
}

fn is_tour_token(s: &str) -> bool {
    !s.is_empty() && s.len() <= 24 && s.bytes().all(|b| b.is_ascii_lowercase())
}

/// Classify a main-frame navigation of the Home webview for the walkthrough channel.
pub fn tour_navigation(url: &Url) -> TourNav {
    if !is_fumbbl_url(url) || url.path() != TOUR_EVENT_PATH {
        return TourNav::NotTour;
    }
    if url.query().is_some() {
        return TourNav::Malformed;
    }
    let Some(event) = url.fragment().and_then(|f| f.strip_prefix(TOUR_FRAGMENT_PREFIX)) else {
        return TourNav::Malformed;
    };
    match event.split_once('.') {
        Some((button, step)) if is_tour_token(button) && is_tour_token(step) => TourNav::Event(event.to_string()),
        _ => TourNav::Malformed,
    }
}

/// The functions of the injected runtime the host may call through fumbbl_home_tour (`report` is the shell's own).
pub const TOUR_FUNCTIONS: [&str; 3] = ["show", "clear", "arm"];

/// Validate a host call `window.__sfTour.<fn>(<json>)` and return the script to eval (plus whether it arms the tour):
/// the SAME call with the argument re-serialised by serde_json (so nothing but one JSON value ever reaches the site) and
/// guarded against a page without the runtime. The argument must be a JSON object of at most 64 KiB.
pub fn tour_script(call: &str) -> Result<(String, bool), String> {
    const MAX: usize = 64 * 1024;
    if call.len() > MAX {
        return Err("walkthrough call too large".into());
    }
    let rest = call.trim().strip_prefix("window.__sfTour.").ok_or("not a walkthrough call")?;
    let open = rest.find('(').ok_or("not a walkthrough call")?;
    let name = &rest[..open];
    if !TOUR_FUNCTIONS.contains(&name) {
        return Err("unknown walkthrough function".into());
    }
    let arg = rest[open + 1..].strip_suffix(')').ok_or("not a walkthrough call")?;
    let value: serde_json::Value = serde_json::from_str(arg).map_err(|_| "walkthrough argument is not JSON")?;
    if !value.is_object() {
        return Err("walkthrough argument must be an object".into());
    }
    let json = serde_json::to_string(&value).map_err(|e| e.to_string())?;
    // Guarded: the runtime is absent on the about:blank boot page and on an error page.
    let script = format!("window.__sfTour&&window.__sfTour.{name}({json})");
    Ok((script, name != "clear"))
}

/// What the runtime's report() said about the loaded page.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TourPageLoad {
    pub url: String,
    pub logged_in: bool,
    pub coach: String,
}

/// Parse report()'s result (eval_with_callback hands it over JSON-serialised). Anything malformed reads as logged out
/// with no coach; a coach name outside FUMBBL's character set is dropped.
pub fn parse_tour_report(url: &Url, raw: &str) -> TourPageLoad {
    let value: serde_json::Value = serde_json::from_str(raw).unwrap_or(serde_json::Value::Null);
    let logged_in = value.get("loggedIn").and_then(|v| v.as_bool()).unwrap_or(false);
    let coach = value
        .get("coach")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|c| !c.is_empty() && c.len() <= 40 && c.bytes().all(|b| b.is_ascii_alphanumeric() || b" _.-".contains(&b)))
        .unwrap_or("")
        .to_string();
    TourPageLoad { url: url.to_string(), logged_in, coach }
}

// --- Home pane zoom (owner 10-06: "Text can be a bit small") ---------------------------------------------------------

/// The zoom range of the Home webview (the page's slider sends a factor; 1.0 = 100 %).
pub const ZOOM_MIN: f64 = 0.75;
pub const ZOOM_MAX: f64 = 2.0;

/// A finite factor clamped to ZOOM_MIN..=ZOOM_MAX and rounded to 0.05; `None` for NaN/infinity.
pub fn sanitize_zoom(factor: f64) -> Option<f64> {
    if !factor.is_finite() {
        return None;
    }
    let clamped = factor.clamp(ZOOM_MIN, ZOOM_MAX);
    Some(((clamped * 20.0).round() / 20.0).clamp(ZOOM_MIN, ZOOM_MAX))
}

// --- colorblind correction (owner 10-06: "Colorblind mode isn't being applied to this page") --------------------------
//
// The client shell filters itself with an SVG feColorMatrix (src/game/colorblindFilters.ts is the one source of the
// matrices). The page sends the SAME filter (id + matrix) here; the shell remembers it and evals it into the Home webview
// on every page load (and at once), through the injected runtime's `filter()` - which puts the <filter> into the page
// and `filter: url(#...)` on its root element, so the site AND the walkthrough's cards are corrected like the client.

/// A colorblind filter for the site: the shell's filter id (`cb-<mode>`) and its feColorMatrix values (20 numbers).
#[derive(Debug, Clone, PartialEq, Deserialize, serde::Serialize)]
pub struct HomeFilter {
    pub id: String,
    pub matrix: String,
}

/// Only a well-formed filter reaches the page: id `cb-<lowercase letters>`, exactly 20 finite numbers. The matrix is
/// re-joined from the parsed numbers, so nothing but numbers and spaces is ever sent.
pub fn sanitize_filter(filter: HomeFilter) -> Option<HomeFilter> {
    let mode = filter.id.strip_prefix("cb-")?;
    if mode.is_empty() || mode.len() > 24 || !mode.bytes().all(|b| b.is_ascii_lowercase()) {
        return None;
    }
    let numbers: Vec<f64> = filter.matrix.split_whitespace().map(|n| n.parse::<f64>()).collect::<Result<_, _>>().ok()?;
    if numbers.len() != 20 || !numbers.iter().all(|n| n.is_finite() && n.abs() <= 16.0) {
        return None;
    }
    let matrix = numbers.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(" ");
    Some(HomeFilter { id: filter.id, matrix })
}

/// The eval that applies (Some) or removes (None) the filter in the loaded page.
pub fn filter_script(filter: Option<&HomeFilter>) -> String {
    let arg = match filter {
        Some(f) => serde_json::to_string(f).unwrap_or_else(|_| "null".into()),
        None => "null".into(),
    };
    format!("window.__sfTour&&window.__sfTour.filter({arg})")
}

/// What a finished page load re-applies: the remembered filter, if any (a fresh document has none to remove).
pub fn page_load_filter_scripts(filter: Option<&HomeFilter>) -> Vec<String> {
    filter.map(|f| vec![filter_script(Some(f))]).unwrap_or_default()
}

// --- commands (registered in every build so shell-api.json is one list; the bodies are live only when AVAILABLE) -----

/// Feature detection for the page: false on a public build or a shell built without the `fumbbl-home` feature (and an
/// older shell has no such command at all, which the page treats the same way).
#[tauri::command]
pub fn fumbbl_home_available() -> bool {
    AVAILABLE
}

/// Show the Home webview over `bounds`, creating it the first time. Async: creating a webview from a synchronous command
/// deadlocks on Windows. While the loop guard has stopped the pane this fails with BLOCKED_ERROR unless `retry` is true
/// (the user pressed "Try again"), which resets the guard and reloads https://fumbbl.com/.
#[tauri::command]
pub async fn fumbbl_home_show(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    bounds: HomeBounds,
    retry: Option<bool>,
) -> Result<(), String> {
    caller_is_main(&webview)?;
    #[cfg(feature = "fumbbl-home")]
    {
        let bounds = sanitize_bounds(bounds).ok_or("invalid Home pane bounds")?;
        live::show(&app, bounds, retry.unwrap_or(false))
    }
    #[cfg(not(feature = "fumbbl-home"))]
    {
        let _ = (app, bounds, retry);
        Err("the Home pane is not available in this build".into())
    }
}

/// Hide the Home webview (kept alive, so the user's page and login survive). A no-op before it exists.
#[tauri::command]
pub async fn fumbbl_home_hide(app: tauri::AppHandle, webview: tauri::Webview) -> Result<(), String> {
    caller_is_main(&webview)?;
    #[cfg(feature = "fumbbl-home")]
    {
        live::hide(&app);
        Ok(())
    }
    #[cfg(not(feature = "fumbbl-home"))]
    {
        let _ = app;
        Ok(())
    }
}

/// Walkthrough: load `url` in the Home webview. Only https://fumbbl.com (or a subdomain) URLs are accepted.
#[tauri::command]
pub async fn fumbbl_home_navigate(app: tauri::AppHandle, webview: tauri::Webview, url: String) -> Result<(), String> {
    caller_is_main(&webview)?;
    let parsed = Url::parse(&url).map_err(|_| "invalid URL")?;
    if !is_fumbbl_url(&parsed) || tour_navigation(&parsed) != TourNav::NotTour {
        return Err("only fumbbl.com pages can be opened in the Home pane".into());
    }
    #[cfg(feature = "fumbbl-home")]
    {
        live::navigate(&app, parsed)
    }
    #[cfg(not(feature = "fumbbl-home"))]
    {
        let _ = (app, parsed);
        Err("the Home pane is not available in this build".into())
    }
}

/// Walkthrough: eval one validated `window.__sfTour.<show|clear|arm>(<json>)` call in the Home webview (tour_script).
#[tauri::command]
pub async fn fumbbl_home_tour(app: tauri::AppHandle, webview: tauri::Webview, call: String) -> Result<(), String> {
    caller_is_main(&webview)?;
    let (script, arms) = tour_script(&call)?;
    #[cfg(feature = "fumbbl-home")]
    {
        live::tour_eval(&app, script, arms)
    }
    #[cfg(not(feature = "fumbbl-home"))]
    {
        let _ = (app, script, arms);
        Err("the Home pane is not available in this build".into())
    }
}

/// Zoom the Home webview's content (`factor` 0.75-2.0, 1.0 = 100 %). Remembered by the shell and re-applied after every
/// page load and every show, so navigation keeps it.
#[tauri::command]
pub async fn fumbbl_home_set_zoom(app: tauri::AppHandle, webview: tauri::Webview, factor: f64) -> Result<(), String> {
    caller_is_main(&webview)?;
    let factor = sanitize_zoom(factor).ok_or("invalid zoom factor")?;
    #[cfg(feature = "fumbbl-home")]
    {
        live::set_zoom(&app, factor)
    }
    #[cfg(not(feature = "fumbbl-home"))]
    {
        let _ = (app, factor);
        Err("the Home pane is not available in this build".into())
    }
}

/// Colorblind correction for the Home webview (`filter` None = off). Remembered by the shell and re-applied after every
/// page load.
#[tauri::command]
pub async fn fumbbl_home_set_filter(app: tauri::AppHandle, webview: tauri::Webview, filter: Option<HomeFilter>) -> Result<(), String> {
    caller_is_main(&webview)?;
    let filter = match filter {
        Some(f) => Some(sanitize_filter(f).ok_or("invalid colorblind filter")?),
        None => None,
    };
    #[cfg(feature = "fumbbl-home")]
    {
        live::set_filter(&app, filter)
    }
    #[cfg(not(feature = "fumbbl-home"))]
    {
        let _ = (app, filter);
        Err("the Home pane is not available in this build".into())
    }
}

fn caller_is_main(webview: &tauri::Webview) -> Result<(), String> {
    if webview.label() == "main" {
        Ok(())
    } else {
        Err("not allowed".into())
    }
}

#[cfg(feature = "fumbbl-home")]
pub use live::{on_exit, on_page_load};

#[cfg(feature = "fumbbl-home")]
mod live {
    use super::*;
    use std::sync::Mutex;
    use tauri::webview::{DownloadEvent, NewWindowResponse, WebviewBuilder};
    use tauri::{LogicalPosition, LogicalSize, Manager, WebviewUrl};
    use tauri_plugin_opener::OpenerExt;

    /// What the page last asked for, applied once the webview exists (creation is async; a hide that lands while it is
    /// being created must win).
    #[derive(Default)]
    struct Wanted {
        creating: bool,
        visible: bool,
        bounds: Option<HomeBounds>,
    }

    static WANTED: Mutex<Wanted> = Mutex::new(Wanted { creating: false, visible: false, bounds: None });

    /// The navigation loop guard (both layers).
    static GUARD: Mutex<BounceGuard> = Mutex::new(BounceGuard::new());

    /// A JNLP download in flight, identified by our private destination `<uuid>.jnlp` (the identity the engine reports
    /// back as the result path); `id` is the uuid every file of this download starts with. Never matched by URL: two
    /// downloads can share one.
    struct InFlight {
        target: PathBuf,
        id: String,
    }

    static IN_FLIGHT: Mutex<Vec<InFlight>> = Mutex::new(Vec::new());

    use std::sync::atomic::{AtomicBool, Ordering};
    /// The Home webview is on its about:blank boot page, before fumbbl.com is loaded (see create()).
    static BOOTING: AtomicBool = AtomicBool::new(false);
    /// Windows: our DownloadStarting cancel hook is installed. JNLP downloads are refused until it is, so no download
    /// is ever tracked that we could not cancel (a failed install keeps refusing them: fail closed).
    static CANCEL_HOOK_READY: AtomicBool = AtomicBool::new(false);
    /// The Home webview has been shown since it was last hidden (so it may hold keyboard focus).
    static PANE_SHOWN: AtomicBool = AtomicBool::new(false);
    /// The Home webview's zoom factor as f64 bits (1.0 until the page sends its setting).
    static ZOOM_BITS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0x3FF0_0000_0000_0000);

    fn zoom() -> f64 {
        f64::from_bits(ZOOM_BITS.load(Ordering::SeqCst))
    }

    pub fn set_zoom(app: &tauri::AppHandle, factor: f64) -> Result<(), String> {
        ZOOM_BITS.store(factor.to_bits(), Ordering::SeqCst);
        match app.get_webview(HOME_LABEL) {
            Some(webview) => webview.set_zoom(factor).map_err(|e| e.to_string()),
            None => Ok(()), // applied when the webview is created
        }
    }

    /// Re-apply the remembered zoom (after creation, a page load, a show).
    fn apply_zoom(webview: &tauri::Webview) {
        let _ = webview.set_zoom(zoom());
    }

    /// The colorblind filter the page asked for (None = off), re-applied on every page load.
    static FILTER: Mutex<Option<HomeFilter>> = Mutex::new(None);

    pub fn set_filter(app: &tauri::AppHandle, filter: Option<HomeFilter>) -> Result<(), String> {
        let script = filter_script(filter.as_ref());
        if let Ok(mut current) = FILTER.lock() {
            *current = filter;
        }
        match app.get_webview(HOME_LABEL) {
            Some(webview) => webview.eval(script).map_err(|e| e.to_string()),
            None => Ok(()), // applied on the first page load
        }
    }

    /// A walkthrough is running (fumbbl_home_tour armed it; `clear` disarms): page loads are then reported to the page.
    static TOUR_ARMED: AtomicBool = AtomicBool::new(false);
    /// The walkthrough overlay, injected into every main-frame document of the Home webview. Inert until called.
    const TOUR_RUNTIME: &str = include_str!("home_tour_runtime.js");

    pub fn navigate(app: &tauri::AppHandle, url: Url) -> Result<(), String> {
        if guard_tripped() {
            return Err(BLOCKED_ERROR.into());
        }
        if BOOTING.load(Ordering::SeqCst) || app.get_webview(HOME_LABEL).is_none() {
            return Err("Home webview unavailable".into());
        }
        navigate_home(app, url);
        Ok(())
    }

    pub fn tour_eval(app: &tauri::AppHandle, script: String, arms: bool) -> Result<(), String> {
        TOUR_ARMED.store(arms, Ordering::SeqCst);
        match app.get_webview(HOME_LABEL) {
            Some(webview) => webview.eval(script).map_err(|e| e.to_string()),
            // Nothing to draw on yet: arming still counts (the first page load reports), clearing is trivially done.
            None => Ok(()),
        }
    }

    /// A fumbbl.com document finished loading while a walkthrough runs: ask the runtime who is logged in and tell the page.
    fn report_page_load(app: &tauri::AppHandle, url: Url) {
        let app = app.clone();
        // Deferred: never re-enter the engine from inside its own load callback.
        tauri::async_runtime::spawn(async move {
            let Some(webview) = app.get_webview(HOME_LABEL) else { return };
            let emit_app = app.clone();
            let _ = webview.eval_with_callback("window.__sfTour?window.__sfTour.report():null", move |raw| {
                if !TOUR_ARMED.load(Ordering::SeqCst) {
                    return;
                }
                let _ = tauri::Emitter::emit_to(&emit_app, "main", "fumbbl-home:page-load", parse_tour_report(&url, &raw));
            });
        });
    }

    fn emit_tour_event(app: &tauri::AppHandle, event: String) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = tauri::Emitter::emit_to(&app, "main", "fumbbl-home:tour", serde_json::json!({ "event": event }));
        });
    }

    /// Live vetting 10-06: after a click inside the site (e.g. Play -> JNLP join) the child webview keeps WebView2 focus;
    /// hiding a controller does not move focus anywhere, so the main page stayed unfocused (document.hasFocus() false)
    /// and its focus-click guard swallowed the next press - "Stop waiting" on the waiting board did nothing. Every hide
    /// of a pane that was shown therefore hands focus back to the main webview. tauri's Webview::set_focus is wry's
    /// ICoreWebView2Controller::MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC) on Windows, i.e. exactly the
    /// WebView2 focus move between sibling webviews (wry-0.55.1 webview2/mod.rs `focus`). The pane itself never takes
    /// focus on show (`.focused(false)`); it gets focus only from the coach clicking into it.
    fn hand_focus_back_if_shown(app: &tauri::AppHandle) {
        if PANE_SHOWN.swap(false, Ordering::SeqCst) {
            if let Some(main) = app.get_webview("main") {
                let _ = main.set_focus();
            }
        }
    }

    fn rect(bounds: HomeBounds) -> tauri::Rect {
        tauri::Rect {
            position: LogicalPosition::new(bounds.x, bounds.y).into(),
            size: LogicalSize::new(bounds.width, bounds.height).into(),
        }
    }

    fn guard_tripped() -> bool {
        // A poisoned guard fails closed: treat it as stopped.
        GUARD.lock().map(|g| g.is_tripped()).unwrap_or(true)
    }

    pub fn show(app: &tauri::AppHandle, bounds: HomeBounds, retry: bool) -> Result<(), String> {
        {
            let mut guard = GUARD.lock().map_err(|_| BLOCKED_ERROR)?;
            if guard.is_tripped() {
                if !retry {
                    return Err(BLOCKED_ERROR.into());
                }
                guard.reset();
                if let Ok(home) = Url::parse(HOME_URL) {
                    navigate_home(app, home);
                }
            }
        }
        {
            let mut wanted = WANTED.lock().map_err(|_| "Home state unavailable")?;
            wanted.visible = true;
            wanted.bounds = Some(bounds);
            if wanted.creating {
                return Ok(());
            }
            if app.get_webview(HOME_LABEL).is_some() {
                drop(wanted);
                return show_on_main(app);
            }
            wanted.creating = true;
        }
        let created = create(app, bounds);
        if let Ok(mut wanted) = WANTED.lock() {
            wanted.creating = false;
        }
        created?;
        // add_child creates it visible: the main-thread step applies the latest request (or hides it if stopped / no
        // longer wanted).
        show_on_main(app)
    }

    struct TauriSurface(tauri::Webview);
    impl HomeSurface for TauriSurface {
        fn set_bounds(&mut self, bounds: HomeBounds) {
            let _ = self.0.set_bounds(rect(bounds));
        }
        fn show(&mut self) {
            if self.0.show().is_ok() {
                PANE_SHOWN.store(true, Ordering::SeqCst);
            }
        }
        fn hide(&mut self) {
            let _ = self.0.hide();
            hand_focus_back_if_shown(self.0.app_handle());
        }
        fn set_zoom(&mut self, factor: f64) {
            let _ = self.0.set_zoom(factor);
        }
    }

    /// Run apply_show_on_main ON THE MAIN THREAD (this command runs on an async-runtime thread, where webview calls
    /// are only queued and a main-thread stop() could slip between our guard check and the queued Show). On the main
    /// thread tauri executes webview calls synchronously, so guard read + show are one step w.r.t. stop().
    fn show_on_main(app: &tauri::AppHandle) -> Result<(), String> {
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let handle = app.clone();
        app.run_on_main_thread(move || {
            let result = match handle.get_webview(HOME_LABEL) {
                Some(webview) => {
                    let wanted = WANTED
                        .lock()
                        .map(|w| if w.visible { w.bounds } else { None })
                        .unwrap_or(None);
                    apply_show_on_main(guard_tripped(), wanted, zoom(), &mut TauriSurface(webview))
                }
                None => Err("Home webview unavailable".into()),
            };
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(5)).unwrap_or_else(|_| Err("Home show timed out".into()))
    }

    /// Builder-level page-load hook: when the MAIN page (re)loads - an app-patch Restart, a dev reload - the new page has no
    /// Home pane mounted yet, so nothing of ours would hide the site; hide it here.
    pub fn on_page_load(webview: &tauri::Webview, payload: &tauri::webview::PageLoadPayload<'_>) {
        if webview.label() == "main" && matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
            hide(webview.app_handle());
        }
    }

    pub fn hide(app: &tauri::AppHandle) {
        if let Ok(mut wanted) = WANTED.lock() {
            wanted.visible = false;
        }
        if let Some(webview) = app.get_webview(HOME_LABEL) {
            let _ = webview.hide();
        }
        // Every hide path (hide command, JNLP handoff, loop-guard stop, main-page reload hook) comes through here.
        hand_focus_back_if_shown(app);
        // Leaving the pane: nothing session-bearing stays in the private directory. A download still in flight keeps
        // its files (its watcher or the timeout cleans up; the next hide, creation or app exit purges anyway).
        purge_if_idle();
    }

    /// App exit (RunEvent::Exit): downloads die with the process; purge this process's whole directory.
    pub fn on_exit() {
        let dir = jnlp_temp_dir();
        purge_jnlp_dir(&dir);
        let _ = std::fs::remove_dir(&dir);
    }

    /// Downloads between leaving IN_FLIGHT and their file being read + deleted (complete_jnlp). Incremented BEFORE the
    /// entry is taken, so "IN_FLIGHT empty and nothing completing" really means no file of ours is wanted.
    static COMPLETING: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    /// Keeps the directory "busy" until dropped (after complete_jnlp has read and deleted the file).
    struct Completing;
    impl Drop for Completing {
        fn drop(&mut self) {
            COMPLETING.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        }
    }

    fn take_for_completion(pick: impl Fn(&InFlight) -> bool) -> Option<(InFlight, Completing)> {
        COMPLETING.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let token = Completing;
        take_in_flight(pick).map(|entry| (entry, token))
    }

    /// Purge this process's directory when no download is in flight or completing. Holds the IN_FLIGHT lock for the
    /// purge so a download cannot register (and start writing) between the check and the deletion.
    fn purge_if_idle() {
        let Ok(list) = IN_FLIGHT.lock() else { return };
        if list.is_empty() && COMPLETING.load(std::sync::atomic::Ordering::SeqCst) == 0 {
            purge_jnlp_dir(&jnlp_temp_dir());
        }
        drop(list);
    }

    static EXTERNAL_OPENS: Mutex<RateLimit> = Mutex::new(RateLimit::new());

    fn open_external(app: &tauri::AppHandle, url: &Url) {
        let allowed = EXTERNAL_OPENS
            .lock()
            .map(|mut limit| limit.allow(Instant::now(), EXTERNAL_OPEN_LIMIT, EXTERNAL_OPEN_WINDOW))
            .unwrap_or(false);
        if !allowed {
            return; // a burst of off-site links: drop the extras rather than open a tab storm
        }
        let app = app.clone();
        let url = url.to_string();
        // Off the webview callback: never block or re-enter the webview's event handler.
        tauri::async_runtime::spawn(async move {
            let _ = app.opener().open_url(url, None::<&str>);
        });
    }

    fn navigate_home(app: &tauri::AppHandle, url: Url) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Some(webview) = app.get_webview(HOME_LABEL) {
                let _ = webview.navigate(url);
            }
        });
    }

    /// An automatic re-navigation, through the loop guard.
    fn bounce(app: &tauri::AppHandle, url: Url) {
        let verdict = match GUARD.lock() {
            Ok(mut guard) => guard.record(Instant::now()),
            Err(_) => Bounce::Stopped,
        };
        match verdict {
            Bounce::Retry => navigate_home(app, url),
            Bounce::GiveUp => stop(app),
            Bounce::Stopped => {}
        }
    }

    /// The loop guard tripped: hide the native surface, blank it (no foreign document stays loaded), and tell the page
    /// so it shows its notice with "Open in browser" instead of an empty area.
    fn stop(app: &tauri::AppHandle) {
        hide(app);
        if let Ok(blank) = Url::parse("about:blank") {
            navigate_home(app, blank);
        }
        let _ = tauri::Emitter::emit_to(app, "main", "fumbbl-home-blocked", ());
    }

    fn create(app: &tauri::AppHandle, bounds: HomeBounds) -> Result<tauri::Webview, String> {
        let window = app.get_window("main").ok_or("main window unavailable")?;
        let home = Url::parse(HOME_URL).map_err(|e| e.to_string())?;
        let temp_dir = jnlp_temp_dir();
        // Leftovers from a crash or an earlier session. Nothing of ours is in flight before the webview exists; another
        // instance's live download is left alone (purge_stale_siblings).
        purge_jnlp_dir(&temp_dir);
        purge_stale_siblings(&jnlp_root_dir(), &temp_dir, STALE_SIBLING_AFTER, std::time::SystemTime::now());

        let nav_app = app.clone();
        let window_app = app.clone();
        let download_app = app.clone();
        // BOOT on about:blank, not fumbbl.com: the WebView2 cancel hook (wv2_downloads::install) can only be added after
        // add_child returns, so the site is loaded only once the hook exists (no download can start before it). The
        // boot page is also what a creation-time flash shows (add_child creates the webview visible).
        BOOTING.store(true, Ordering::SeqCst);
        CANCEL_HOOK_READY.store(false, Ordering::SeqCst); // a re-created webview needs its own hook first
        let boot = Url::parse("about:blank").map_err(|e| e.to_string())?;
        let mut builder = WebviewBuilder::new(HOME_LABEL, WebviewUrl::External(boot))
            // Layer 1 (see the module comment): synchronous cancel at NavigationStarting, redirects included.
            .on_navigation(move |url| {
                if BOOTING.load(Ordering::SeqCst) {
                    return tripped_navigation_allowed(url); // only the boot page
                }
                if guard_tripped() {
                    return tripped_navigation_allowed(url);
                }
                // The walkthrough's site->host channel: always denied (false = cancel the navigation).
                match tour_navigation(url) {
                    TourNav::Event(event) => {
                        emit_tour_event(&nav_app, event);
                        return false;
                    }
                    TourNav::Malformed => return false,
                    TourNav::NotTour => {}
                }
                match navigation_decision(url) {
                    NavDecision::Allow => true,
                    NavDecision::Upgrade(https) => {
                        // Counted: an https URL that redirects back to http would otherwise loop forever.
                        bounce(&nav_app, https);
                        false
                    }
                    NavDecision::External => {
                        open_external(&nav_app, url);
                        false
                    }
                    NavDecision::Block => false,
                }
            })
            .on_new_window(move |url, _features| {
                if !guard_tripped() {
                    match navigation_decision(&url) {
                        NavDecision::Allow => navigate_home(&window_app, url),
                        NavDecision::Upgrade(https) => navigate_home(&window_app, https),
                        NavDecision::External => open_external(&window_app, &url),
                        NavDecision::Block => {}
                    }
                }
                NewWindowResponse::Deny
            })
            .on_download(move |_webview, event| match event {
                DownloadEvent::Requested { url, destination } => match download_decision(&url, destination) {
                    DownloadDecision::Jnlp => {
                        if cfg!(windows) && !CANCEL_HOOK_READY.load(Ordering::SeqCst) {
                            return false;
                        }
                        if std::fs::create_dir_all(&temp_dir).is_err() {
                            return false;
                        }
                        let id = uuid::Uuid::new_v4().to_string();
                        let target = temp_dir.join(format!("{id}.jnlp"));
                        *destination = target.clone();
                        match IN_FLIGHT.lock() {
                            Ok(mut list) => list.push(InFlight { target: target.clone(), id }),
                            Err(_) => return false,
                        }
                        watch_download(download_app.clone(), target);
                        true
                    }
                    DownloadDecision::External => {
                        open_external(&download_app, &url);
                        false
                    }
                    DownloadDecision::Refuse => false,
                },
                DownloadEvent::Finished { path, success, .. } => {
                    // Matched ONLY by the reported file (finished_entry_index). No path (WKWebView; WebView2 on failure,
                    // e.g. the interruption our own Cancel causes) or a file already finished by its watcher: dropped,
                    // that download's watcher handles it.
                    let taken = path.as_deref().and_then(|reported| {
                        take_for_completion(|entry| finished_entry_index(&[entry.target.as_path()], Some(reported)).is_some())
                    });
                    if let Some((done, _busy)) = taken {
                        #[cfg(windows)]
                        wv2_downloads::forget(&download_app, &done.target);
                        complete_jnlp(&download_app, &done.target, success);
                    }
                    true
                }
                _ => true,
            })
            // Layer 2 (see the module comment): ContentLoading of a main-frame document that is not on fumbbl.com.
            // The earliest signal tauri gives after a commit; the request has already been sent by then.
            .on_page_load(move |webview, payload| {
                if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                    // Navigation keeps the coach's zoom and colorblind filter.
                    apply_zoom(&webview);
                    if is_fumbbl_url(payload.url()) {
                        let filter = FILTER.lock().ok().and_then(|f| f.clone());
                        for script in page_load_filter_scripts(filter.as_ref()) {
                            let _ = webview.eval(script);
                        }
                    }
                    // The walkthrough: who is logged in on this page (only while a tour is armed).
                    if TOUR_ARMED.load(Ordering::SeqCst)
                        && is_fumbbl_url(payload.url())
                        && tour_navigation(payload.url()) == TourNav::NotTour
                        && !guard_tripped()
                    {
                        report_page_load(webview.app_handle(), payload.url().clone());
                    }
                    return;
                }
                if is_fumbbl_url(payload.url()) {
                    return;
                }
                if tripped_navigation_allowed(payload.url()) {
                    // about:blank (boot page or our stop blanking) holds no foreign document; layer 1 refuses it otherwise.
                    return;
                }
                if guard_tripped() {
                    // Our own about:blank, or something slipping in while stopped: the surface is hidden either way.
                    return;
                }
                if let Ok(home) = Url::parse(HOME_URL) {
                    // Deferred: never re-enter the engine from inside its own load callback.
                    bounce(webview.app_handle(), home);
                }
            })
            // The developer tools never reach a release build of this webview (public builds do not compile it at all).
            // The walkthrough overlay (main frame only; inert until the host calls it).
            .initialization_script(TOUR_RUNTIME)
            .devtools(cfg!(debug_assertions))
            .focused(false);
        // Own profile (see the module comment: a shared profile's fumbbl.com HSTS entry - and its cookie jar - break every
        // game socket from the main page).
        // macOS (Astra 10-06): WKWebView ignores `data_directory`, which would leave the pane in the main page's cookie
        // jar + HSTS store; it gets its own persistent WKWebsiteDataStore instead (macOS 14+, a stable identifier).
        #[cfg(target_os = "macos")]
        {
            builder = builder.data_store_identifier(home_data_store_id());
        }
        #[cfg(not(target_os = "macos"))]
        {
            let local_data = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
            builder = builder.data_directory(home_profile_dir(&local_data));
        }
        // Same browser arguments as the main window (autoplay, disabled Edge UI features); WebView2 requires matching
        // arguments only within one user-data folder, so this is consistency, not a requirement, now.
        if let Some(args) = app
            .config()
            .app
            .windows
            .iter()
            .find(|w| w.label == "main")
            .and_then(|w| w.additional_browser_args.clone())
        {
            builder = builder.additional_browser_args(&args);
        }
        let webview = window
            .add_child(builder, LogicalPosition::new(bounds.x, bounds.y), LogicalSize::new(bounds.width, bounds.height))
            .map_err(|e| e.to_string())?;
        apply_zoom(&webview);
        // Windows: the hook is installed on the main thread and the SAME main-thread step then leaves boot mode and
        // navigates to fumbbl.com, so every download the site can start is one we can cancel.
        #[cfg(windows)]
        wv2_downloads::install(&webview, home);
        #[cfg(not(windows))]
        {
            BOOTING.store(false, Ordering::SeqCst);
            navigate_home(app, home);
        }
        Ok(webview)
    }

    /// Remove and return the first in-flight download matching `pick`. Whichever of the finish event and the file
    /// watcher gets here first handles the download; the other finds nothing.
    fn take_in_flight(pick: impl Fn(&InFlight) -> bool) -> Option<InFlight> {
        let mut list = IN_FLIGHT.lock().ok()?;
        let index = list.iter().position(|entry| pick(entry))?;
        Some(list.remove(index))
    }

    /// Read the finished file once, delete it, and offer it to the existing native JNLP queue.
    fn complete_jnlp(app: &tauri::AppHandle, target: &Path, success: bool) {
        let item = if success {
            crate::read_downloaded_jnlp(target)
        } else {
            Err("JNLP download did not complete".to_string())
        };
        let _ = std::fs::remove_file(target);
        if success {
            // The game view takes the window over: hide the site before the page switches views. The page re-shows it
            // if it stays on Home (e.g. the JNLP is refused); the event tells it to re-check.
            hide(app);
            let _ = tauri::Emitter::emit_to(app, "main", "fumbbl-home-hidden", ());
        }
        crate::offer_launch_jnlp(app, item);
    }

    /// Verified 10-05 on WebView2 (tauri 2.11.5 / wry 0.55.1): the download lands at our destination but
    /// DownloadEvent::Finished never fires. The engine writes to an intermediate file and renames it to the destination
    /// only when the download is complete, so the destination appearing with a stable size means "done". This watcher
    /// covers every engine; whichever of it and the finish event comes first wins (take_in_flight).
    ///
    /// Giving up (2 minutes): the WebView2 download is CANCELLED (so the engine never renames a late file into place),
    /// then every file of this download (`<uuid>*`, intermediates included) is deleted, and - when no other download is in
    /// flight - the whole directory, which also catches engine intermediates that do not carry our name. Other engines
    /// have no cancel handle in tauri's API: a late rename there survives until the next hide, creation or app exit.
    fn watch_download(app: tauri::AppHandle, target: PathBuf) {
        std::thread::spawn(move || {
            const POLL: Duration = Duration::from_millis(200);
            const GIVE_UP_AFTER: u32 = 600; // 2 minutes
            let mut last_len: Option<u64> = None;
            for _ in 0..GIVE_UP_AFTER {
                std::thread::sleep(POLL);
                let still_ours = IN_FLIGHT.lock().map(|l| l.iter().any(|e| e.target == target)).unwrap_or(false);
                if !still_ours {
                    return; // the finish event handled it
                }
                let len = std::fs::symlink_metadata(&target).ok().filter(|m| m.is_file()).map(|m| m.len());
                if len.is_some() && len == last_len && len != Some(0) {
                    if let Some((done, _busy)) = take_for_completion(|e| e.target == target) {
                        #[cfg(windows)]
                        wv2_downloads::forget(&app, &done.target);
                        complete_jnlp(&app, &done.target, true);
                    }
                    return;
                }
                last_len = len;
            }
            let Some(abandoned) = take_in_flight(|e| e.target == target) else { return };
            give_up(&app, &abandoned);
        });
    }

    /// The watcher gave up. Cancel first (Windows), THEN delete: the cancel runs on the main thread and this thread
    /// waits for it (bounded) before the first purge. Afterwards this download's names are swept every second for
    /// SWEEP_FOR seconds, so a rename that raced the cancel - or, on engines without a cancel handle, a late finish - is
    /// deleted as soon as it lands; anything later still dies at the next hide, creation or app exit.
    fn give_up(app: &tauri::AppHandle, abandoned: &InFlight) {
        const SWEEP_FOR: u32 = 30;
        crate::offer_launch_jnlp(app, Err("JNLP download did not complete".to_string()));
        #[cfg(windows)]
        {
            let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
            wv2_downloads::cancel(app, &abandoned.target, done_tx);
            let _ = done_rx.recv_timeout(Duration::from_secs(5));
        }
        let dir = jnlp_temp_dir();
        for _ in 0..SWEEP_FOR {
            purge_jnlp_prefix(&dir, &abandoned.id);
            purge_if_idle();
            std::thread::sleep(Duration::from_secs(1));
        }
        purge_jnlp_prefix(&dir, &abandoned.id);
    }

    /// WebView2 download cancellation. tauri's `on_download` gives no handle to the engine's download (wry answers
    /// DownloadStarting and drops the DownloadOperation), so we register our OWN DownloadStarting handler on the same
    /// ICoreWebView2 through tauri's public `with_webview`. WebView2 calls handlers in registration order, so ours runs
    /// after wry's and sees the destination wry set; we keep the DownloadOperation of every download that is headed for
    /// our private directory and can Cancel() it later. All of it lives on the main (WebView2 UI) thread.
    #[cfg(windows)]
    mod wv2_downloads {
        use super::*;
        use std::cell::RefCell;
        use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2DownloadOperation, ICoreWebView2_4};
        use webview2_com::{take_pwstr, DownloadStartingEventHandler};
        use windows_core::{Interface, BOOL, PWSTR};

        thread_local! {
            /// (destination file name, operation). File names are `<uuid>.jnlp`, unique per download.
            static OPS: RefCell<Vec<(String, ICoreWebView2DownloadOperation)>> = const { RefCell::new(Vec::new()) };
        }

        fn key(path: &Path) -> Option<String> {
            path.file_name().and_then(|n| n.to_str()).map(|n| n.to_ascii_lowercase())
        }

        /// Install the hook, then (same main-thread step) leave boot mode and load `home`. If the hook cannot be added
        /// the site still loads, but JNLP downloads stay refused (CANCEL_HOOK_READY false).
        pub fn install(webview: &tauri::Webview, home: Url) {
            let dir_key = jnlp_temp_dir();
            let app = webview.app_handle().clone();
            let fallback_app = app.clone();
            let fallback_home = home.clone();
            let queued = webview.with_webview(move |platform| unsafe {
                let installed = (|| -> windows_core::Result<()> {
                    let core = platform.controller().CoreWebView2()?;
                    let core4: ICoreWebView2_4 = core.cast()?;
                    let mut token: i64 = 0;
                    core4.add_DownloadStarting(
                        &DownloadStartingEventHandler::create(Box::new(move |_, args| {
                            let Some(args) = args else { return Ok(()) };
                            let mut cancelled = BOOL::default();
                            args.Cancel(&mut cancelled)?;
                            if cancelled.as_bool() {
                                return Ok(());
                            }
                            let mut raw = PWSTR::null();
                            args.ResultFilePath(&mut raw)?;
                            let path = PathBuf::from(take_pwstr(raw));
                            let in_our_dir = path
                                .parent()
                                .and_then(|p| p.file_name())
                                .zip(dir_key.file_name())
                                .map(|(a, b)| a.eq_ignore_ascii_case(b))
                                .unwrap_or(false);
                            if let (true, Some(name)) = (in_our_dir, key(&path)) {
                                let operation = args.DownloadOperation()?;
                                OPS.with(|ops| ops.borrow_mut().push((name, operation)));
                            }
                            Ok(())
                        })),
                        &mut token,
                    )?;
                    Ok(())
                })();
                CANCEL_HOOK_READY.store(installed.is_ok(), Ordering::SeqCst);
                BOOTING.store(false, Ordering::SeqCst);
                // Navigate through the engine directly, still inside this main-thread step: NavigationStarting (layer 1)
                // runs as usual. Falls back to tauri's navigate if that fails.
                let direct = platform.controller().CoreWebView2().and_then(|core| {
                    let url = windows_core::HSTRING::from(home.as_str());
                    core.Navigate(windows_core::PCWSTR(url.as_ptr()))
                });
                if direct.is_err() {
                    navigate_home(&app, home);
                }
            });
            if queued.is_err() {
                BOOTING.store(false, Ordering::SeqCst);
                navigate_home(&fallback_app, fallback_home);
            }
        }

        fn take(target: &Path) -> Option<ICoreWebView2DownloadOperation> {
            let name = key(target)?;
            OPS.with(|ops| {
                let mut ops = ops.borrow_mut();
                let index = ops.iter().position(|(n, _)| *n == name)?;
                Some(ops.remove(index).1)
            })
        }

        /// Cancel the engine's download (no-op when it already finished) and drop the handle; `done` is signalled once
        /// Cancel() has returned (or there was nothing to cancel).
        pub fn cancel(app: &tauri::AppHandle, target: &Path, done: std::sync::mpsc::Sender<()>) {
            let target = target.to_path_buf();
            let _ = app.run_on_main_thread(move || {
                if let Some(operation) = take(&target) {
                    unsafe {
                        let _ = operation.Cancel();
                    }
                }
                let _ = done.send(());
            });
        }

        /// The download completed: drop the handle.
        pub fn forget(app: &tauri::AppHandle, target: &Path) {
            let target = target.to_path_buf();
            let _ = app.run_on_main_thread(move || {
                let _ = take(&target);
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn allows_fumbbl_and_its_subdomains_over_https_only() {
        for ok in [
            "https://fumbbl.com/",
            "https://FUMBBL.com/p/home",
            "https://www.fumbbl.com/index.php?name=x",
            "https://a.b.fumbbl.com/",
            "https://fumbbl.com:443/x",
        ] {
            assert!(is_fumbbl_url(&u(ok)), "{ok} must be allowed");
        }
        for bad in [
            "http://fumbbl.com/",
            "https://fumbbl.com.evil.example/",
            "https://evilfumbbl.com/",
            "https://fumbbl.co/",
            "https://fumbbl.com@evil.example/",
            "https://user:pw@fumbbl.com/",
            "https://user@fumbbl.com/",
            "https://fumbbl.com:8443/",
            "https://fumbbl.com:22223/",
            "https://fumbbl.com./",
            "https://f\u{fc}mbbl.com/",
            "https://xn--fmbbl-kva.com/",
            "https://fumbbl.com\u{3002}evil.example/",
            "https://93.184.216.34/",
            "https://[::1]/",
            "wss://fumbbl.com/",
            "file:///C:/fumbbl.com/x",
            "javascript:alert(1)//fumbbl.com",
            "data:text/html,fumbbl.com",
            "about:blank",
        ] {
            assert!(!is_fumbbl_url(&u(bad)), "{bad} must be refused");
        }
    }

    #[test]
    fn navigation_rule_upgrades_externalises_or_blocks() {
        assert_eq!(navigation_decision(&u("https://fumbbl.com/p/games")), NavDecision::Allow);
        assert_eq!(
            navigation_decision(&u("http://www.fumbbl.com/x?y=1")),
            NavDecision::Upgrade(u("https://www.fumbbl.com/x?y=1"))
        );
        // A non-default port is not the site: never loaded in the Home webview, only ever handed to the browser.
        assert_eq!(navigation_decision(&u("http://fumbbl.com:8080/")), NavDecision::External);
        assert_eq!(navigation_decision(&u("https://fumbbl.com:8443/")), NavDecision::External);
        assert_eq!(navigation_decision(&u("http://user@fumbbl.com/")), NavDecision::Block);
        assert_eq!(navigation_decision(&u("https://discord.gg/abc")), NavDecision::External);
        assert_eq!(navigation_decision(&u("https://fumbbl.com.evil.example/")), NavDecision::External);
        assert_eq!(navigation_decision(&u("http://evilfumbbl.com/")), NavDecision::External);
        // Userinfo tricks never reach the system browser either.
        assert_eq!(navigation_decision(&u("https://fumbbl.com@evil.example/")), NavDecision::Block);
        for blocked in ["javascript:alert(1)", "file:///C:/x", "about:blank", "data:text/html,x", "ms-settings:", "mailto:a@b.c"] {
            assert_eq!(navigation_decision(&u(blocked)), NavDecision::Block, "{blocked}");
        }
    }

    #[test]
    fn tour_channel_is_the_reserved_path_with_an_sf_tour_fragment() {
        assert_eq!(tour_navigation(&u("https://fumbbl.com/__sf-tour__#sf-tour:next.home")), TourNav::Event("next.home".into()));
        assert_eq!(tour_navigation(&u("https://www.fumbbl.com/__sf-tour__#sf-tour:skip.overview")), TourNav::Event("skip.overview".into()));
        // The reserved path is always denied, even when the event is malformed.
        for malformed in [
            "https://fumbbl.com/__sf-tour__",
            "https://fumbbl.com/__sf-tour__#next.home",
            "https://fumbbl.com/__sf-tour__#sf-tour:",
            "https://fumbbl.com/__sf-tour__#sf-tour:next",
            "https://fumbbl.com/__sf-tour__#sf-tour:Next.home",
            "https://fumbbl.com/__sf-tour__#sf-tour:next.home.x",
            "https://fumbbl.com/__sf-tour__#sf-tour:next.ho%20me",
            "https://fumbbl.com/__sf-tour__#sf-tour:next.aaaaaaaaaaaaaaaaaaaaaaaaa",
            "https://fumbbl.com/__sf-tour__?x=1#sf-tour:next.home",
        ] {
            assert_eq!(tour_navigation(&u(malformed)), TourNav::Malformed, "{malformed}");
        }
        // Everything else takes the normal navigation rule - including a real page that merely carries the fragment.
        for normal in [
            "https://fumbbl.com/",
            "https://fumbbl.com/p/lfg2#sf-tour:next.home",
            "https://fumbbl.com/__sf-tour__x#sf-tour:next.home",
            "http://fumbbl.com/__sf-tour__#sf-tour:next.home",
            "https://evil.example/__sf-tour__#sf-tour:next.home",
            "https://fumbbl.com.evil.example/__sf-tour__#sf-tour:next.home",
        ] {
            assert_eq!(tour_navigation(&u(normal)), TourNav::NotTour, "{normal}");
        }
    }

    #[test]
    fn tour_calls_are_one_allow_listed_function_with_one_reserialised_object() {
        let (script, arms) = tour_script(r#"window.__sfTour.show({"step":"home","title":"Home"})"#).unwrap();
        assert_eq!(script, r#"window.__sfTour&&window.__sfTour.show({"step":"home","title":"Home"})"#);
        assert!(arms);
        let (script, arms) = tour_script("window.__sfTour.clear({})").unwrap();
        assert_eq!(script, "window.__sfTour&&window.__sfTour.clear({})");
        assert!(!arms);
        assert!(tour_script("window.__sfTour.arm({})").unwrap().1);
        // Whitespace inside the JSON is normalised away by the re-serialisation.
        assert_eq!(tour_script(r#"window.__sfTour.show({ "a" : [1, 2] })"#).unwrap().0, r#"window.__sfTour&&window.__sfTour.show({"a":[1,2]})"#);
        for bad in [
            "",
            "alert(1)",
            "window.__sfTour.report({})",
            "window.__sfTour.show",
            "window.__sfTour.show()",
            "window.__sfTour.show(1)",
            "window.__sfTour.show([])",
            "window.__sfTour.show(\"x\")",
            "window.__sfTour.show({});alert(1)",
            "window.__sfTour.show({}),alert(1)",
            "window.__sfTour.show({})//",
            "window.__sfTour.show({}) + alert(1)",
            "window.__sfTour.show(alert(1))",
            "window.__sfTour.show({\"a\":alert(1)})",
            "window.__sfTour['show']({})",
            "window.__sfTour.constructor({})",
            "x;window.__sfTour.show({})",
        ] {
            assert!(tour_script(bad).is_err(), "{bad}");
        }
        let huge = format!("window.__sfTour.show({{\"a\":\"{}\"}})", "x".repeat(70 * 1024));
        assert!(tour_script(&huge).is_err());
    }

    #[test]
    fn tour_report_parses_logged_in_and_a_safe_coach_name() {
        let url = u("https://fumbbl.com/p/lfg2");
        assert_eq!(
            parse_tour_report(&url, r#"{"loggedIn":true,"coach":"Flutethecat"}"#),
            TourPageLoad { url: "https://fumbbl.com/p/lfg2".into(), logged_in: true, coach: "Flutethecat".into() }
        );
        let odd = parse_tour_report(&url, r#"{"loggedIn":true,"coach":"a/../b?x"}"#);
        assert!(odd.logged_in);
        assert_eq!(odd.coach, "");
        for raw in ["null", "", "garbage", "[]", r#"{"loggedIn":"yes"}"#] {
            let r = parse_tour_report(&url, raw);
            assert!(!r.logged_in, "{raw}");
            assert_eq!(r.coach, "");
        }
        let json = serde_json::to_value(parse_tour_report(&url, r#"{"loggedIn":false,"coach":""}"#)).unwrap();
        assert_eq!(json, serde_json::json!({ "url": "https://fumbbl.com/p/lfg2", "loggedIn": false, "coach": "" }));
    }

    #[test]
    fn colorblind_filters_are_sanitized_and_reapplied_on_every_page_load() {
        let deut = HomeFilter { id: "cb-deuteranopia".into(), matrix: "1 0 0 0 0  0.163 0.725 0.112 0 0  0.455 -0.645 1.191 0 0  0 0 0 1 0".into() };
        let clean = sanitize_filter(deut.clone()).unwrap();
        assert_eq!(clean.id, "cb-deuteranopia");
        assert_eq!(clean.matrix, "1 0 0 0 0 0.163 0.725 0.112 0 0 0.455 -0.645 1.191 0 0 0 0 0 1 0");
        for bad in [
            HomeFilter { id: "deuteranopia".into(), ..deut.clone() },
            HomeFilter { id: "cb-".into(), ..deut.clone() },
            HomeFilter { id: "cb-x\"y".into(), ..deut.clone() },
            HomeFilter { id: "cb-Deut".into(), ..deut.clone() },
            HomeFilter { matrix: "1 0 0".into(), ..deut.clone() },
            HomeFilter { matrix: format!("{} 0", deut.matrix), ..deut.clone() },
            HomeFilter { matrix: deut.matrix.replace("0.163", "url(x)"), ..deut.clone() },
            HomeFilter { matrix: deut.matrix.replace("0.163", "NaN"), ..deut.clone() },
            HomeFilter { matrix: deut.matrix.replace("0.163", "1e9"), ..deut.clone() },
        ] {
            assert_eq!(sanitize_filter(bad.clone()), None, "{bad:?}");
        }
        assert_eq!(
            filter_script(Some(&clean)),
            r#"window.__sfTour&&window.__sfTour.filter({"id":"cb-deuteranopia","matrix":"1 0 0 0 0 0.163 0.725 0.112 0 0 0.455 -0.645 1.191 0 0 0 0 0 1 0"})"#
        );
        assert_eq!(filter_script(None), "window.__sfTour&&window.__sfTour.filter(null)");
        // Every page load re-applies a set filter; with none set there is nothing to do on a fresh document.
        assert_eq!(page_load_filter_scripts(Some(&clean)), vec![filter_script(Some(&clean))]);
        assert!(page_load_filter_scripts(None).is_empty());
    }

    #[test]
    fn the_macos_data_store_is_stable_and_well_formed() {
        let a = home_data_store_id();
        assert_eq!(a, home_data_store_id()); // the same store every launch
        assert_eq!(a[6] >> 4, 8);
        assert_eq!(a[8] & 0xc0, 0x80);
        assert_ne!(a, [0u8; 16]);
        // Source pin: macOS uses the data store identifier, every other platform the own data directory.
        let src = include_str!("fumbbl_home.rs").replace("\r\n", "\n");
        let mac = src.find("#[cfg(target_os = \"macos\")]
        {
            builder = builder.data_store_identifier(home_data_store_id());").expect("macOS branch");
        let rest = src.find("#[cfg(not(target_os = \"macos\"))]
        {
            let local_data = app.path().app_local_data_dir()").expect("other platforms");
        assert!(mac < rest);
    }

    #[test]
    fn zoom_is_clamped_to_the_slider_range_in_five_percent_steps() {
        assert_eq!(sanitize_zoom(1.0), Some(1.0));
        assert_eq!(sanitize_zoom(1.26), Some(1.25));
        assert_eq!(sanitize_zoom(0.5), Some(0.75));
        assert_eq!(sanitize_zoom(9.0), Some(2.0));
        // Half steps round up, exactly as the page's clampHomeZoom (fumbblHome.ts) does.
        assert_eq!(sanitize_zoom(1.275), Some(1.3));
        assert_eq!(sanitize_zoom(1.025), Some(1.05));
        assert_eq!(sanitize_zoom(0.775), Some(0.8));
        assert_eq!(sanitize_zoom(1.125), Some(1.15));
        assert_eq!(sanitize_zoom(1.975), Some(2.0));
        assert_eq!(sanitize_zoom(f64::NAN), None);
        assert_eq!(sanitize_zoom(f64::INFINITY), None);
    }

    #[test]
    fn a_stopped_pane_may_only_blank_itself() {
        assert!(tripped_navigation_allowed(&u("about:blank")));
        for refused in ["https://fumbbl.com/", "https://example.com/", "about:blank#x", "about:srcdoc", "data:text/html,x"] {
            assert!(!tripped_navigation_allowed(&u(refused)), "{refused}");
        }
    }

    #[test]
    fn loop_guard_stops_after_the_limit_within_the_window() {
        let t0 = Instant::now();
        let mut guard = BounceGuard::new();
        for i in 0..BOUNCE_LIMIT {
            assert_eq!(guard.record(t0 + Duration::from_millis(100 * i as u64)), Bounce::Retry, "bounce {i}");
        }
        assert!(!guard.is_tripped());
        assert_eq!(guard.record(t0 + Duration::from_millis(500)), Bounce::GiveUp);
        assert!(guard.is_tripped());
        // Once stopped nothing re-navigates, however long it waits, until the user retries.
        assert_eq!(guard.record(t0 + Duration::from_millis(600)), Bounce::Stopped);
        assert_eq!(guard.record(t0 + BOUNCE_WINDOW * 10), Bounce::Stopped);
        guard.reset();
        assert!(!guard.is_tripped());
        assert_eq!(guard.record(t0 + BOUNCE_WINDOW * 10), Bounce::Retry);
    }

    #[test]
    fn loop_guard_forgets_bounces_older_than_the_window() {
        let t0 = Instant::now();
        let mut guard = BounceGuard::new();
        // Occasional bounces (a user clicking http:// fumbbl links now and then) never trip it.
        for i in 0..20u64 {
            let now = t0 + (BOUNCE_WINDOW + Duration::from_millis(1)) * (i as u32) / (BOUNCE_LIMIT as u32);
            assert_eq!(guard.record(now), Bounce::Retry, "spaced bounce {i}");
        }
        // A burst right after still trips it.
        let later = t0 + BOUNCE_WINDOW * 30;
        for _ in 0..BOUNCE_LIMIT {
            assert_eq!(guard.record(later), Bounce::Retry);
        }
        assert_eq!(guard.record(later), Bounce::GiveUp);
    }

    #[test]
    fn purges_remove_session_bearing_files_only_in_our_directory() {
        let scratch = tempfile::tempdir().unwrap();
        let dir = scratch.path().join("super-fumbbl-home-jnlp");
        std::fs::create_dir_all(dir.join("subdir")).unwrap();
        let id = "0f6d7c1e-1111-4222-8333-444455556666";
        let other = "9a9a9a9a-1111-4222-8333-444455556666";
        let files = [
            format!("{id}.jnlp"),
            format!("{id}.jnlp.crdownload"),
            format!("{other}.jnlp"),
            "Unconfirmed 123456.crdownload".to_string(),
        ];
        for name in &files {
            std::fs::write(dir.join(name), b"<jnlp>session</jnlp>").unwrap();
        }
        let outside = scratch.path().join(format!("{id}.jnlp"));
        std::fs::write(&outside, b"not ours").unwrap();
        let names = || {
            let mut v: Vec<String> =
                std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
            v.sort();
            v
        };

        // The timeout path: only this download's names (final + intermediate).
        purge_jnlp_prefix(&dir, id);
        assert_eq!(names(), vec![format!("{other}.jnlp"), "Unconfirmed 123456.crdownload".to_string(), "subdir".to_string()]);
        purge_jnlp_prefix(&dir, ""); // an empty prefix never matches everything
        assert_eq!(names().len(), 3);

        // Hide / exit / creation: every file, any name; directories and anything outside the directory survive.
        purge_jnlp_dir(&dir);
        assert_eq!(names(), vec!["subdir".to_string()]);
        assert!(outside.exists());

        // A missing directory is not an error.
        purge_jnlp_dir(&scratch.path().join("missing"));
        purge_jnlp_prefix(&scratch.path().join("missing"), id);
    }

    #[derive(Default)]
    struct FakeSurface {
        visible: bool,
        bounds: Option<HomeBounds>,
        zoom: Option<f64>,
        log: Vec<&'static str>,
    }
    impl HomeSurface for FakeSurface {
        fn set_bounds(&mut self, bounds: HomeBounds) {
            self.bounds = Some(bounds);
            self.log.push("bounds");
        }
        fn show(&mut self) {
            self.visible = true;
            self.log.push("show");
        }
        fn hide(&mut self) {
            self.visible = false;
            self.log.push("hide");
        }
        fn set_zoom(&mut self, factor: f64) {
            self.zoom = Some(factor);
            self.log.push("zoom");
        }
    }

    #[test]
    fn every_show_reapplies_the_zoom_and_a_hide_or_a_stop_never_touches_it() {
        let bounds = HomeBounds { x: 0.0, y: 0.0, width: 800.0, height: 600.0 };
        let mut surface = FakeSurface::default();
        assert_eq!(apply_show_on_main(false, Some(bounds), 1.5, &mut surface), Ok(()));
        assert_eq!(surface.log, ["bounds", "show", "zoom"]);
        assert_eq!(surface.zoom, Some(1.5));
        // A later show (e.g. back to the Home blade after a navigation reset the engine's zoom) applies it again.
        assert_eq!(apply_show_on_main(false, Some(bounds), 1.25, &mut surface), Ok(()));
        assert_eq!(surface.zoom, Some(1.25));
        let mut hidden = FakeSurface::default();
        assert_eq!(apply_show_on_main(false, None, 2.0, &mut hidden), Ok(()));
        assert_eq!(hidden.log, ["hide"]);
        let mut stopped = FakeSurface::default();
        assert!(apply_show_on_main(true, Some(bounds), 2.0, &mut stopped).is_err());
        assert_eq!(stopped.log, ["hide"]);
        assert_eq!(stopped.zoom, None);
    }

    /// The main thread as a queue of steps: a show command enqueues its main-thread step; a navigation callback's
    /// stop() runs on the main thread BEFORE that step executes. The stopped pane must end hidden.
    #[test]
    fn a_stop_before_the_queued_show_runs_leaves_the_pane_hidden() {
        let bounds = HomeBounds { x: 0.0, y: 120.0, width: 1280.0, height: 640.0 };
        let mut guard = BounceGuard::new();
        let mut surface = FakeSurface::default();
        let mut main_queue: Vec<Box<dyn FnOnce(&BounceGuard, &mut FakeSurface) -> Result<(), String>>> = Vec::new();

        // show(): the guard is fine when the command checks it; the step is queued for the main thread.
        assert!(!guard.is_tripped());
        main_queue.push(Box::new(move |g, s| apply_show_on_main(g.is_tripped(), Some(bounds), 1.0, s)));

        // Before the queued step runs, bounces trip the guard on the main thread; stop() hides.
        let t0 = Instant::now();
        for _ in 0..BOUNCE_LIMIT {
            assert_eq!(guard.record(t0), Bounce::Retry);
        }
        assert_eq!(guard.record(t0), Bounce::GiveUp);
        surface.hide();

        // The queued show step finally runs: it reads the guard NOW and keeps the pane hidden.
        for step in main_queue.drain(..) {
            assert_eq!(step(&guard, &mut surface), Err(BLOCKED_ERROR.to_string()));
        }
        assert!(!surface.visible);

        // The other order (show ran, then stop): stop's hide wins too.
        let mut surface = FakeSurface::default();
        assert_eq!(apply_show_on_main(false, Some(bounds), 1.0, &mut surface), Ok(()));
        assert!(surface.visible);
        assert_eq!(surface.bounds, Some(bounds));
        surface.hide();
        assert!(!surface.visible);

        // Not wanted any more (page hid while creating): hidden, no error.
        let mut surface = FakeSurface { visible: true, ..Default::default() };
        assert_eq!(apply_show_on_main(false, None, 1.0, &mut surface), Ok(()));
        assert!(!surface.visible);
    }

    /// Two downloads A and B of the SAME URL: A finishes via its watcher, then A's late finish event arrives (with or
    /// without a path). Neither may take B's entry.
    #[test]
    fn a_late_finish_event_never_takes_another_download() {
        let a = Path::new("C:/t/super-fumbbl-home-jnlp/1/aaaa.jnlp");
        let b = Path::new("C:/t/super-fumbbl-home-jnlp/1/bbbb.jnlp");
        // Both in flight: each event finds its own entry.
        assert_eq!(finished_entry_index(&[a, b], Some(a)), Some(0));
        assert_eq!(finished_entry_index(&[a, b], Some(Path::new("C:/elsewhere/BBBB.JNLP"))), Some(1));
        // A already finished by its watcher; only B remains in flight.
        assert_eq!(finished_entry_index(&[b], Some(a)), None);
        assert_eq!(finished_entry_index(&[b], None), None); // no path (WKWebView / failure): dropped
        assert_eq!(finished_entry_index(&[b], Some(Path::new(""))), None);
        assert_eq!(finished_entry_index(&[], Some(b)), None);
    }

    /// The Home webview's profile (HSTS state, cookie jar) must never be the main page's (the game socket breaks otherwise).
    #[test]
    fn home_profile_is_its_own_directory_under_app_local_data() {
        let local = Path::new("C:/Users/x/AppData/Local/com.fumbbl40k.app");
        let profile = home_profile_dir(local);
        assert!(profile.starts_with(local));
        assert_ne!(profile, local); // tauri's default data directory for the main page
        assert_ne!(profile, local.join("EBWebView")); // where WebView2 keeps the default profile
        assert!(!local.join("EBWebView").starts_with(&profile));
        assert_eq!(profile, local.join("fumbbl-home-profile"));
    }

    /// The source wires that directory into the Home webview's builder (guards against the call being dropped).
    #[test]
    fn the_home_webview_builder_uses_the_own_profile() {
        let source = include_str!("fumbbl_home.rs").replace("\r\n", "\n");
        let builder_line = ["builder = builder.data_directory(", "home_profile_dir(&local_data));"].concat();
        assert!(source.contains(&builder_line));
        assert!(!source.contains([".incognito(", "true)"].concat().as_str()));
    }

    /// Real TransportSecurity content from the poisoned dev profile (10-06); the second entry is fumbbl.com.
    #[test]
    fn hsts_purge_removes_only_the_fumbbl_entry() {
        assert_eq!(hsts_host_key("fumbbl.com"), "6RX1bxNirdspIEyubkym/3zx83TQNbAFBUsYqdNVRDg=");
        assert_eq!(hsts_host_key("FUMBBL.com."), hsts_host_key("fumbbl.com"));
        let json = r#"{"sts":[{"expiry":1822806813.749241,"host":"OuKlWsMW1dkkbI1X/oi6o0Y95ZNSWnSoeaIXAEYPlv4=","mode":"force-https","sts_include_subdomains":true,"sts_observed":1791270813.749245},{"expiry":1807034840.553556,"host":"6RX1bxNirdspIEyubkym/3zx83TQNbAFBUsYqdNVRDg=","mode":"force-https","sts_include_subdomains":false,"sts_observed":1791266840.553559}],"version":2}"#;
        let stripped = strip_hsts_host(json, "fumbbl.com").expect("fumbbl.com entry removed");
        let doc: serde_json::Value = serde_json::from_str(&stripped).unwrap();
        let sts = doc["sts"].as_array().unwrap();
        assert_eq!(sts.len(), 1);
        assert_eq!(sts[0]["host"], "OuKlWsMW1dkkbI1X/oi6o0Y95ZNSWnSoeaIXAEYPlv4=");
        assert_eq!(doc["version"], 2);
        assert_eq!(strip_hsts_host(&stripped, "fumbbl.com"), None); // idempotent: nothing left to change
        assert_eq!(strip_hsts_host("not json", "fumbbl.com"), None);
        assert_eq!(strip_hsts_host(r#"{"version":2}"#, "fumbbl.com"), None);

        // File level: rewritten in place under <local>/EBWebView/Default/Network; a missing file is fine.
        let scratch = tempfile::tempdir().unwrap();
        let file = default_profile_hsts_file(scratch.path());
        assert!(!purge_default_profile_fumbbl_hsts(scratch.path()));
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, json).unwrap();
        assert!(purge_default_profile_fumbbl_hsts(scratch.path()));
        assert!(!std::fs::read_to_string(&file).unwrap().contains("6RX1bxNirdspIEyubkym"));
        // Runs every start: a second pass finds nothing and does not write.
        assert!(!purge_default_profile_fumbbl_hsts(scratch.path()));
    }

    /// Our lock is held from before the read until after the rename: a second purge (or anyone opening the lock) during
    /// the edit is refused, and nothing else is changed by it.
    #[cfg(windows)]
    #[test]
    fn hsts_edit_holds_its_lock_across_the_edit() {
        let json = r#"{"sts":[{"host":"6RX1bxNirdspIEyubkym/3zx83TQNbAFBUsYqdNVRDg=","mode":"force-https"},{"host":"keep","mode":"force-https"}],"version":2}"#;
        let scratch = tempfile::tempdir().unwrap();
        let root = scratch.path().to_path_buf();
        let file = default_profile_hsts_file(&root);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, json).unwrap();
        let mut observed = false;
        let committed = purge_hsts_with_hook(&root, || {
            assert!(open_exclusive(&hsts_lock_file(&root)).is_err(), "lock must be held during the edit");
            assert!(!purge_default_profile_fumbbl_hsts(&root), "a concurrent purge must be refused");
            assert_eq!(std::fs::read_to_string(&file).unwrap(), json, "original untouched before the commit");
            observed = true;
        });
        assert!(observed && committed);
        assert!(open_exclusive(&hsts_lock_file(&root)).is_ok(), "lock released after the rename");
        let doc: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(doc["sts"].as_array().unwrap().len(), 1);
        // No temp files left behind.
        let leftovers: Vec<_> = std::fs::read_dir(file.parent().unwrap())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    /// Two threads purging the same profile at once, over many rounds: the file is always complete, valid JSON with only
    /// the fumbbl.com entry removed - never truncated or half-written - and no temp file is left.
    #[cfg(windows)]
    #[test]
    fn concurrent_hsts_purges_never_leave_a_truncated_file() {
        let other = r#"{"expiry":1822806813.749241,"host":"OuKlWsMW1dkkbI1X/oi6o0Y95ZNSWnSoeaIXAEYPlv4=","mode":"force-https","sts_include_subdomains":true,"sts_observed":1791270813.749245}"#;
        let padding: String = (0..200).map(|i| format!(r#",{{"host":"pad{i}","mode":"force-https","expiry":1.0}}"#)).collect();
        let json = format!(
            r#"{{"sts":[{other},{{"host":"6RX1bxNirdspIEyubkym/3zx83TQNbAFBUsYqdNVRDg=","mode":"force-https"}}{padding}],"version":2}}"#
        );
        let scratch = tempfile::tempdir().unwrap();
        let root = scratch.path().to_path_buf();
        let file = default_profile_hsts_file(&root);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        for round in 0..40 {
            std::fs::write(&file, &json).unwrap();
            let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
            let handles: Vec<_> = (0..2)
                .map(|_| {
                    let (root, barrier) = (root.clone(), barrier.clone());
                    std::thread::spawn(move || {
                        barrier.wait();
                        purge_default_profile_fumbbl_hsts(&root)
                    })
                })
                .collect();
            let results: Vec<bool> = handles.into_iter().map(|h| h.join().unwrap()).collect();
            assert!(results.iter().filter(|r| **r).count() <= 1, "round {round}: at most one edit commits");
            let text = std::fs::read_to_string(&file).unwrap();
            let doc: serde_json::Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("round {round}: {e}: {text:.80}"));
            let sts = doc["sts"].as_array().unwrap();
            assert_eq!(doc["version"], 2);
            if results.contains(&true) {
                assert_eq!(sts.len(), 201, "round {round}");
                assert!(!text.contains("6RX1bxNirdspIEyubkym"));
            } else {
                assert_eq!(text, json, "round {round}: both skipped, file untouched");
            }
        }
        let leftovers: Vec<_> = std::fs::read_dir(file.parent().unwrap())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    /// Another client on the same profile holds EBWebView/lockfile: the file is left alone (it would be overwritten from
    /// that client's memory on exit) and the edit happens on a later start.
    #[cfg(windows)]
    #[test]
    fn hsts_purge_waits_while_another_client_holds_the_profile() {
        use std::os::windows::fs::OpenOptionsExt;
        let json = r#"{"sts":[{"host":"6RX1bxNirdspIEyubkym/3zx83TQNbAFBUsYqdNVRDg=","mode":"force-https"}],"version":2}"#;
        let scratch = tempfile::tempdir().unwrap();
        let file = default_profile_hsts_file(scratch.path());
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, json).unwrap();
        let lockfile = scratch.path().join("EBWebView").join("lockfile");
        std::fs::write(&lockfile, b"").unwrap();
        assert!(!default_profile_in_use(scratch.path())); // a stale lockfile nobody holds
        let held = std::fs::OpenOptions::new().read(true).write(true).share_mode(0).open(&lockfile).unwrap();
        assert!(default_profile_in_use(scratch.path()));
        assert!(!purge_default_profile_fumbbl_hsts(scratch.path()));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), json);
        drop(held);
        assert!(purge_default_profile_fumbbl_hsts(scratch.path()));
        assert!(!std::fs::read_to_string(&file).unwrap().contains("6RX1bx"));
    }

    /// Focus hand-back (live vetting 10-06): the webview APIs cannot run headless, so pin the wiring in the source.
    #[test]
    fn every_hide_hands_focus_back_to_the_main_webview() {
        // A Windows checkout (core.autocrlf) has CRLF line ends.
        let source = include_str!("fumbbl_home.rs").replace("\r\n", "\n");
        let source = source.as_str();
        let body = |name: &str| {
            let start = source.find(name).unwrap_or_else(|| panic!("{name} missing"));
            let rest = &source[start..];
            let end = rest.find("\n    }\n").unwrap_or_else(|| panic!("end of {name} not found"));
            &rest[..end]
        };
        // The shared hide (command, JNLP handoff, stop, main-page reload hook all call it) and the main-thread show
        // step's hide both hand focus back.
        assert!(body("    pub fn hide(app: &tauri::AppHandle) {").contains("hand_focus_back_if_shown(app);"));
        assert!(body("        fn hide(&mut self) {").contains("hand_focus_back_if_shown("));
        for caller in ["    fn stop(app: &tauri::AppHandle) {", "    pub fn on_page_load(", "    fn complete_jnlp("] {
            assert!(body(caller).contains("hide("), "{caller} must go through hide()");
        }
        // The hand-back focuses the MAIN webview (tauri set_focus = WebView2 MoveFocus(PROGRAMMATIC)).
        let hand_back = body("    fn hand_focus_back_if_shown(");
        assert!(hand_back.contains(r#"get_webview("main")"#) && hand_back.contains(".set_focus()"));
        // The pane never takes focus by itself.
        assert!(source.contains(".focused(false)"));
    }

    #[test]
    fn jnlp_temp_dir_is_private_to_this_process() {
        assert_eq!(jnlp_root_dir(), std::env::temp_dir().join("super-fumbbl-home-jnlp"));
        assert_eq!(jnlp_temp_dir(), jnlp_root_dir().join(std::process::id().to_string()));
    }

    #[test]
    fn creation_purge_spares_a_live_sibling_instance_but_clears_leftovers() {
        let scratch = tempfile::tempdir().unwrap();
        let root = scratch.path().join("super-fumbbl-home-jnlp");
        let own = root.join("100");
        let live = root.join("200");
        let dead = root.join("300");
        for d in [&own, &live, &dead] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(root.join("legacy.jnlp"), b"x").unwrap();
        std::fs::write(own.join("mine.jnlp"), b"x").unwrap();
        std::fs::write(live.join("fresh.jnlp"), b"x").unwrap();
        std::fs::write(dead.join("old.jnlp"), b"x").unwrap();
        let now = std::time::SystemTime::now();

        // Now: the other instances' files are fresh, so only the legacy top-level file goes; `own` is the caller's.
        purge_stale_siblings(&root, &own, STALE_SIBLING_AFTER, now);
        assert!(!root.join("legacy.jnlp").exists());
        assert!(own.join("mine.jnlp").exists());
        assert!(live.join("fresh.jnlp").exists());
        assert!(dead.join("old.jnlp").exists());

        // Much later: every sibling file is a leftover; emptied sibling directories are removed; `own` is untouched.
        purge_stale_siblings(&root, &own, STALE_SIBLING_AFTER, now + STALE_SIBLING_AFTER * 2);
        assert!(!live.exists());
        assert!(!dead.exists());
        assert!(own.join("mine.jnlp").exists());
        purge_stale_siblings(&scratch.path().join("missing"), &own, STALE_SIBLING_AFTER, now);
    }

    #[test]
    fn external_opens_are_rate_limited() {
        let t0 = Instant::now();
        let mut limit = RateLimit::new();
        for _ in 0..EXTERNAL_OPEN_LIMIT {
            assert!(limit.allow(t0, EXTERNAL_OPEN_LIMIT, EXTERNAL_OPEN_WINDOW));
        }
        assert!(!limit.allow(t0 + Duration::from_secs(1), EXTERNAL_OPEN_LIMIT, EXTERNAL_OPEN_WINDOW));
        assert!(limit.allow(t0 + EXTERNAL_OPEN_WINDOW + Duration::from_millis(1), EXTERNAL_OPEN_LIMIT, EXTERNAL_OPEN_WINDOW));
    }

    #[test]
    fn jnlp_downloads_are_accepted_only_from_fumbbl() {
        let none = Path::new("");
        assert_eq!(download_decision(&u("https://fumbbl.com/ffblive.jnlp?id=1"), none), DownloadDecision::Jnlp);
        // The shape FUMBBL actually serves (verified 10-05, logged out): /ffblive.jnlp, saved as "ffblive (N).jnlp".
        assert_eq!(
            download_decision(&u("https://fumbbl.com/ffblive.jnlp?spectate=1"), Path::new("C:/Users/x/Downloads/ffblive (19).jnlp")),
            DownloadDecision::Jnlp
        );
        assert_eq!(download_decision(&u("https://fumbbl.com/FFB.JNLP"), none), DownloadDecision::Jnlp);
        assert_eq!(
            download_decision(&u("https://fumbbl.com/play.php?op=launch"), Path::new("C:/Users/x/Downloads/game.jnlp")),
            DownloadDecision::Jnlp
        );
        assert_eq!(download_decision(&u("https://fumbbl.com/roster.pdf"), Path::new("C:/d/roster.pdf")), DownloadDecision::External);
        // .jnlp only in the query is not a JNLP path.
        assert_eq!(download_decision(&u("https://fumbbl.com/x?f=a.jnlp"), none), DownloadDecision::External);
        for bad in [
            "http://fumbbl.com/ffblive.jnlp",
            "https://fumbbl.com.evil.example/ffblive.jnlp",
            "https://evilfumbbl.com/ffblive.jnlp",
            "https://user@fumbbl.com/ffblive.jnlp",
            "https://fumbbl.com:8443/ffblive.jnlp",
            "https://xn--fmbbl-kva.com/ffblive.jnlp",
        ] {
            assert_eq!(download_decision(&u(bad), Path::new("C:/d/game.jnlp")), DownloadDecision::Refuse, "{bad}");
        }
    }

    #[test]
    fn bounds_are_sanitized() {
        let b = |x, y, width, height| HomeBounds { x, y, width, height };
        assert_eq!(sanitize_bounds(b(10.4, 50.6, 800.2, 600.0)), Some(b(10.0, 51.0, 800.0, 600.0)));
        assert_eq!(sanitize_bounds(b(-10.0, 0.0, 100.0, 100.0)), Some(b(0.0, 0.0, 90.0, 100.0)));
        assert_eq!(sanitize_bounds(b(0.0, 0.0, 0.0, 100.0)), None);
        assert_eq!(sanitize_bounds(b(-200.0, 0.0, 100.0, 100.0)), None);
        assert_eq!(sanitize_bounds(b(f64::NAN, 0.0, 100.0, 100.0)), None);
        assert_eq!(sanitize_bounds(b(0.0, 0.0, f64::INFINITY, 100.0)), None);
        assert_eq!(sanitize_bounds(b(0.0, 0.0, 1e9, 100.0)), None);
    }
}
