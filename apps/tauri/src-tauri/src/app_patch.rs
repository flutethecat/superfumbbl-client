//! Owner 09-30: the APP PATCH channel (UAT S51). The web app (`dist/`) ships as signed PARTS on the public
//! release, pulled by the shell the same way the art pack is (art_pack.rs): a minisign-signed `app-patch.json`
//! (signature checked against the updater pubkey in the Tauri config), parts size + sha256 checked against the
//! signed manifest only, flat basenames only. The page is served from the `sfapp` scheme: the ACTIVE patch when
//! it is newer than the embedded dist and lists the path, else the embedded dist, else 404.
//!
//! Store `<app data>/app-patch/`: `parts/<group>/<hash>/<name>`, `installed.json` (group -> hash),
//! `active.json` (the verified live manifest + activatedAt). The hash level keeps a pending install from
//! overwriting files the running patch still serves.
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};

use crate::art_pack::{extract_flat, safe_entry_name, valid_group};

pub const DEFAULT_MANIFEST_URL: &str =
    "https://github.com/flutethecat/superfumbbl-client/releases/latest/download/app-patch.json";
const MAX_PART_BYTES: u64 = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 2 * 1024 * 1024;
const MAX_SIG_BYTES: usize = 8 * 1024;
const MAX_FILES: usize = 4000;

// ---------- manifest ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PatchFile {
    pub path: String,
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PatchPart {
    pub group: String,
    pub hash: String,
    pub size: u64,
    pub sha256: String,
    pub url: String,
    pub files: Vec<PatchFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ShellReq {
    pub min: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PatchManifest {
    pub version: String,
    pub edition: String,
    pub shell: ShellReq,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub parts: Vec<PatchPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveRecord {
    #[serde(flatten)]
    manifest: PatchManifest,
    manifest_sha: String,
    activated_at: u64,
}

pub type Version = (u64, u64, u64);

/// Strict bare `X.Y.Z` (manifest fields).
pub fn parse_version(text: &str) -> Option<Version> {
    let mut it = text.split('.');
    let mut n = || -> Option<u64> {
        let s = it.next()?;
        if s.is_empty() || s.len() > 9 || !s.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        s.parse().ok()
    };
    let v = (n()?, n()?, n()?);
    if it.next().is_some() {
        return None;
    }
    Some(v)
}

/// The leading `X.Y.Z` of a build version (`1.0.30`, `1.0.30o66kj`); a dev letter compares as its bare base.
pub fn bare_version(text: &str) -> Option<Version> {
    let end = text.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap_or(text.len());
    parse_version(text[..end].trim_end_matches('.'))
}

pub fn fmt_version(v: Version) -> String {
    format!("{}.{}.{}", v.0, v.1, v.2)
}

/// A served path: `/` + 1..4 segments of `[A-Za-z0-9._-]{1,120}`, no `.`/`..`, no leading `.`.
pub fn valid_path(path: &str) -> bool {
    let Some(rest) = path.strip_prefix('/') else { return false };
    let segs: Vec<&str> = rest.split('/').collect();
    (1..=4).contains(&segs.len())
        && segs.iter().all(|s| {
            (1..=120).contains(&s.len())
                && !s.starts_with('.')
                && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
        })
}

fn is_hex(s: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub fn github_url(url: &str) -> bool {
    url.starts_with("https://github.com/")
}

/// Structural checks on a parsed manifest (edition and version policy are checked by the caller).
pub fn validate_manifest(m: &PatchManifest) -> Result<(), String> {
    parse_version(&m.version).ok_or_else(|| format!("bad manifest version {:?}", m.version))?;
    parse_version(&m.shell.min).ok_or_else(|| format!("bad shell.min {:?}", m.shell.min))?;
    if m.parts.is_empty() {
        return Err("manifest lists no parts".into());
    }
    let mut groups = HashSet::new();
    let mut paths = HashSet::new();
    let mut total = 0usize;
    for p in &m.parts {
        if !valid_group(&p.group) || !groups.insert(p.group.as_str()) {
            return Err(format!("invalid or duplicate part group {:?}", p.group));
        }
        if !is_hex(&p.hash, 8, 64) || !is_hex(&p.sha256, 64, 64) {
            return Err(format!("part {}: bad hash/sha256", p.group));
        }
        if p.size == 0 || p.size > MAX_PART_BYTES {
            return Err(format!("part {}: size {} out of range", p.group, p.size));
        }
        if !github_url(&p.url) {
            return Err(format!("part {}: url must be a GitHub release asset", p.group));
        }
        let mut names = HashSet::new();
        for f in &p.files {
            total += 1;
            if !valid_path(&f.path) || !paths.insert(f.path.as_str()) {
                return Err(format!("part {}: invalid or duplicate path {:?}", p.group, f.path));
            }
            if safe_entry_name(&f.name).is_none()
                || f.path.rsplit('/').next() != Some(f.name.as_str())
                || !names.insert(f.name.as_str())
            {
                return Err(format!("part {}: invalid or duplicate name {:?}", p.group, f.name));
            }
        }
    }
    if total == 0 || total > MAX_FILES {
        return Err(format!("manifest lists {total} files"));
    }
    if !paths.contains("/index.html") {
        return Err("manifest does not carry /index.html".into());
    }
    Ok(())
}

/// Minisign check exactly as tauri-plugin-updater does it: `pubkey` and `sig` are base64 of the minisign text files.
pub fn verify_signature(data: &[u8], sig_b64: &str, pubkey_b64: &str) -> Result<(), String> {
    let b64 = |s: &str| -> Result<String, String> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(s.trim())
            .map_err(|_| "signature/pubkey is not base64".to_string())?;
        String::from_utf8(bytes).map_err(|_| "signature/pubkey is not UTF-8".to_string())
    };
    let pk = minisign_verify::PublicKey::decode(&b64(pubkey_b64)?).map_err(|e| format!("updater pubkey: {e}"))?;
    let sig = minisign_verify::Signature::decode(&b64(sig_b64)?).map_err(|e| format!("manifest signature: {e}"))?;
    pk.verify(data, &sig, true).map_err(|e| format!("manifest signature rejected: {e}"))
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OfferPart {
    pub group: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub up_to_date: bool,
    pub needs_shell: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shell_min: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub parts: Vec<OfferPart>,
    pub to_fetch: Vec<String>,
}

pub struct CheckInput<'a> {
    pub manifest: &'a [u8],
    pub sig: &'a str,
    pub pubkey: &'a str,
    pub shell: Version,
    pub embedded: Version,
    pub active: Option<Version>,
}

/// Verify + policy. `Ok((manifest, result))`; the manifest is returned only for an offer.
pub fn evaluate(
    input: CheckInput<'_>,
    is_installed: &dyn Fn(&PatchPart) -> bool,
) -> Result<(Option<PatchManifest>, CheckResult), String> {
    if input.manifest.len() > MAX_MANIFEST_BYTES {
        return Err("manifest too large".into());
    }
    verify_signature(input.manifest, input.sig, input.pubkey)?;
    let m: PatchManifest = serde_json::from_slice(input.manifest).map_err(|e| format!("manifest: {e}"))?;
    if m.edition != "public" {
        return Err(format!("manifest edition {:?} is not public", m.edition));
    }
    validate_manifest(&m)?;
    let version = parse_version(&m.version).unwrap();
    let shell_min = parse_version(&m.shell.min).unwrap();
    if shell_min > input.shell {
        return Ok((
            None,
            CheckResult { needs_shell: true, version: Some(m.version.clone()), shell_min: Some(m.shell.min.clone()), ..Default::default() },
        ));
    }
    let floor = input.active.map_or(input.embedded, |a| a.max(input.embedded));
    if version <= floor {
        return Ok((None, CheckResult { up_to_date: true, ..Default::default() }));
    }
    let result = CheckResult {
        version: Some(m.version.clone()),
        manifest_sha: Some(hex::encode(Sha256::digest(input.manifest))),
        notes: m.notes.clone(),
        parts: m.parts.iter().map(|p| OfferPart { group: p.group.clone(), size: p.size }).collect(),
        to_fetch: m.parts.iter().filter(|p| !is_installed(p)).map(|p| p.group.clone()).collect(),
        ..Default::default()
    };
    Ok((Some(m), result))
}

// ---------- store ----------

fn part_dir(root: &Path, group: &str, hash: &str) -> PathBuf {
    root.join("parts").join(group.replace('/', std::path::MAIN_SEPARATOR_STR)).join(hash)
}

fn read_installed(root: &Path) -> BTreeMap<String, String> {
    fs::read(root.join("installed.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn atomic_write(root: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    let tmp = root.join(format!("{name}.tmp"));
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, root.join(name)).map_err(|e| e.to_string())
}

fn part_complete(root: &Path, part: &PatchPart) -> bool {
    let dir = part_dir(root, &part.group, &part.hash);
    part.files.iter().all(|f| fs::metadata(dir.join(&f.name)).map(|m| m.is_file() && m.len() == f.size).unwrap_or(false))
}

fn is_installed_in(root: &Path, part: &PatchPart) -> bool {
    read_installed(root).get(&part.group) == Some(&part.hash) && part_complete(root, part)
}

/// Extract a verified part zip into `parts/<group>/<hash>/` and check it holds exactly the listed files.
pub fn install_part_bytes(root: &Path, part: &PatchPart, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 != part.size {
        return Err(format!("part {}: got {} bytes, expected {}", part.group, bytes.len(), part.size));
    }
    if !hex::encode(Sha256::digest(bytes)).eq_ignore_ascii_case(&part.sha256) {
        return Err(format!("part {}: sha256 mismatch", part.group));
    }
    let dir = part_dir(root, &part.group, &part.hash);
    let mut names = extract_flat(bytes, &dir)?;
    names.sort();
    let mut want: Vec<String> = part.files.iter().map(|f| f.name.clone()).collect();
    want.sort();
    if names != want || !part_complete(root, part) {
        let _ = fs::remove_dir_all(&dir);
        return Err(format!("part {}: contents differ from the manifest", part.group));
    }
    let mut state = read_installed(root);
    state.insert(part.group.clone(), part.hash.clone());
    atomic_write(root, "installed.json", &serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?)
}

/// Every part installed and every file present -> `active.json` (atomic).
pub fn activate_in(root: &Path, manifest: &PatchManifest, manifest_sha: &str, now: u64) -> Result<(), String> {
    for p in &manifest.parts {
        if !part_complete(root, p) {
            return Err(format!("part {} is not installed", p.group));
        }
    }
    let rec = ActiveRecord { manifest: manifest.clone(), manifest_sha: manifest_sha.into(), activated_at: now };
    atomic_write(root, "active.json", &serde_json::to_vec(&rec).map_err(|e| e.to_string())?)
}

/// Remove part dirs the active manifest does not name (no active manifest -> all of them).
pub fn prune_in(root: &Path) -> Result<usize, String> {
    let keep: HashSet<PathBuf> = read_active_record(root)
        .map(|r| r.manifest.parts.iter().map(|p| part_dir(root, &p.group, &p.hash)).collect())
        .unwrap_or_default();
    let mut removed = 0;
    let parts = root.join("parts");
    let Ok(groups) = fs::read_dir(&parts) else { return Ok(0) };
    for g in groups.flatten() {
        let Ok(hashes) = fs::read_dir(g.path()) else { continue };
        for h in hashes.flatten() {
            if !keep.contains(&h.path()) {
                let _ = fs::remove_dir_all(h.path()).or_else(|_| fs::remove_file(h.path()));
                removed += 1;
            }
        }
        let _ = fs::remove_dir(g.path()); // only succeeds when empty
    }
    let mut installed = read_installed(root);
    installed.retain(|g, h| part_dir(root, g, h).is_dir());
    atomic_write(root, "installed.json", &serde_json::to_vec_pretty(&installed).map_err(|e| e.to_string())?)?;
    Ok(removed)
}

fn read_active_record(root: &Path) -> Option<ActiveRecord> {
    let rec: ActiveRecord = serde_json::from_slice(&fs::read(root.join("active.json")).ok()?).ok()?;
    (rec.manifest.edition == "public" && validate_manifest(&rec.manifest).is_ok()).then_some(rec)
}

/// The live patch, indexed by path.
#[derive(Debug)]
pub struct ActiveIndex {
    pub version: Version,
    files: HashMap<String, PathBuf>,
}

/// Load `active.json`; an unreadable/invalid one, or one not newer than the embedded dist (E2), is dropped.
pub fn load_active(root: &Path, embedded: Version) -> Option<ActiveIndex> {
    let file = root.join("active.json");
    if !file.exists() {
        return None;
    }
    let Some(rec) = read_active_record(root) else {
        eprintln!("[app-patch] active.json unreadable, dropped");
        let _ = fs::remove_file(&file);
        return None;
    };
    let version = parse_version(&rec.manifest.version)?;
    if version <= embedded {
        let _ = fs::remove_file(&file);
        return None;
    }
    let mut files = HashMap::new();
    for p in &rec.manifest.parts {
        let dir = part_dir(root, &p.group, &p.hash);
        for f in &p.files {
            files.insert(f.path.clone(), dir.join(&f.name));
        }
    }
    Some(ActiveIndex { version, files })
}

#[derive(Debug, PartialEq)]
pub enum Served {
    Patch(Vec<u8>),
    Embedded(Vec<u8>),
    NotFound,
    /// The active patch lost a file: `active.json` was dropped, the embedded copy served.
    Healed(Option<Vec<u8>>),
}

/// Resolution order: active patch (newer than embedded, lists the path) > embedded > 404.
pub fn resolve(
    root: &Path,
    active: Option<&ActiveIndex>,
    embedded_version: Version,
    path: &str,
    embedded: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> Served {
    let path = if path == "/" || path.is_empty() { "/index.html" } else { path };
    if !valid_path(path) {
        return Served::NotFound;
    }
    if let Some(a) = active.filter(|a| a.version > embedded_version) {
        if let Some(file) = a.files.get(path) {
            match fs::read(file) {
                Ok(bytes) => return Served::Patch(bytes),
                Err(e) => {
                    eprintln!("[app-patch] {path}: {e}; dropping the active patch");
                    let _ = fs::remove_file(root.join("active.json"));
                    return Served::Healed(embedded(path));
                }
            }
        }
    }
    embedded(path).map_or(Served::NotFound, Served::Embedded)
}

pub fn mime_for(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "mp4" => "video/mp4",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "glb" => "model/gltf-binary",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "txt" => "text/plain; charset=utf-8",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

// ---------- shell state + commands ----------

#[derive(Default)]
pub struct AppPatchState {
    verified: Mutex<HashMap<String, PatchManifest>>,
    last_error: Mutex<Option<String>>,
    /// None = not loaded yet.
    active: Mutex<Option<Option<Arc<ActiveIndex>>>>,
    embedded_keys: OnceLock<HashSet<String>>,
    embedded_version: OnceLock<Version>,
}

fn store_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("app-patch");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn shell_version<R: Runtime>(app: &AppHandle<R>) -> Version {
    let v = &app.package_info().version;
    (v.major, v.minor, v.patch)
}

/// The embedded dist's version: `/app-version.json` (written by the build), else the shell version.
fn embedded_version<R: Runtime>(app: &AppHandle<R>) -> Version {
    *app.state::<AppPatchState>().embedded_version.get_or_init(|| {
        app.asset_resolver()
            .get("/app-version.json".into())
            .and_then(|a| serde_json::from_slice::<serde_json::Value>(&a.bytes).ok())
            .and_then(|v| v.get("version").and_then(|s| s.as_str()).and_then(bare_version))
            .unwrap_or_else(|| shell_version(app))
    })
}

fn embedded_bytes<R: Runtime>(app: &AppHandle<R>, path: &str) -> Option<Vec<u8>> {
    let keys = app
        .state::<AppPatchState>()
        .embedded_keys
        .get_or_init(|| app.asset_resolver().iter().map(|(k, _)| k.into_owned()).collect())
        .clone();
    // Tauri's resolver falls back to index.html for unknown paths; only real embedded files are served.
    // An empty key set is a dev build (no embedded assets): trust the resolver there.
    if !keys.is_empty() && !keys.contains(path) {
        return None;
    }
    app.asset_resolver().get(path.into()).map(|a| a.bytes)
}

fn active_index<R: Runtime>(app: &AppHandle<R>) -> Option<Arc<ActiveIndex>> {
    let state = app.state::<AppPatchState>();
    let mut slot = state.active.lock().ok()?;
    if slot.is_none() {
        let loaded = store_root(app).ok().and_then(|root| load_active(&root, embedded_version(app))).map(Arc::new);
        *slot = Some(loaded);
    }
    slot.clone().flatten()
}

fn forget_active<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(mut slot) = app.state::<AppPatchState>().active.lock() {
        *slot = None;
    }
}

fn set_error<R: Runtime>(app: &AppHandle<R>, e: &str) {
    if let Ok(mut slot) = app.state::<AppPatchState>().last_error.lock() {
        *slot = Some(e.to_string());
    }
}

fn updater_pubkey<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .map(str::to_string)
        .ok_or_else(|| "no updater pubkey in the Tauri config".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPatchStatus {
    shell_version: String,
    embedded_version: String,
    active_version: Option<String>,
    last_error: Option<String>,
}

#[tauri::command]
pub fn app_patch_status(app: AppHandle) -> AppPatchStatus {
    let active = active_index(&app).map(|a| fmt_version(a.version));
    AppPatchStatus {
        shell_version: fmt_version(shell_version(&app)),
        embedded_version: fmt_version(embedded_version(&app)),
        active_version: active,
        last_error: app.state::<AppPatchState>().last_error.lock().ok().and_then(|e| e.clone()),
    }
}

async fn http_get(url: &str, cap: u64) -> Result<Option<Vec<u8>>, String> {
    let client = tauri_plugin_http::reqwest::Client::builder()
        .user_agent("SuperFUMBBL app-patch")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if resp.status().as_u16() == 404 {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(format!("HTTP {} for {url}", resp.status()));
    }
    if resp.content_length().is_some_and(|n| n > cap) {
        return Err(format!("{url}: larger than {cap} bytes"));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() as u64 > cap {
        return Err(format!("{url}: larger than {cap} bytes"));
    }
    Ok(Some(bytes.to_vec()))
}

#[tauri::command]
pub async fn app_patch_check(app: AppHandle, url: Option<String>) -> Result<CheckResult, String> {
    let run = async {
        // Owner 09-30: FUMBBL_APP_PATCH_URL points the rig at a local manifest; the signature is still required.
        let manifest_url = match std::env::var("FUMBBL_APP_PATCH_URL").ok().filter(|u| !u.is_empty()) {
            Some(u) => u,
            None => {
                let u = url.unwrap_or_else(|| DEFAULT_MANIFEST_URL.into());
                if !github_url(&u) {
                    return Err("manifest url must be a GitHub release asset".to_string());
                }
                u
            }
        };
        // E3: no manifest on the Latest release yet = nothing to do.
        let Some(manifest) = http_get(&manifest_url, MAX_MANIFEST_BYTES as u64).await? else {
            return Ok(CheckResult { up_to_date: true, ..Default::default() });
        };
        let sig = http_get(&format!("{manifest_url}.sig"), MAX_SIG_BYTES as u64)
            .await?
            .ok_or("manifest signature missing")?;
        let sig = String::from_utf8(sig).map_err(|_| "manifest signature is not text")?;
        let root = store_root(&app)?;
        let input = CheckInput {
            manifest: &manifest,
            sig: &sig,
            pubkey: &updater_pubkey(&app)?,
            shell: shell_version(&app),
            embedded: embedded_version(&app),
            active: active_index(&app).map(|a| a.version),
        };
        let (verified, result) = evaluate(input, &|p| is_installed_in(&root, p))?;
        if let (Some(m), Some(sha)) = (verified, result.manifest_sha.clone()) {
            let state = app.state::<AppPatchState>();
            let mut map = state.verified.lock().map_err(|e| e.to_string())?;
            map.clear();
            map.insert(sha, m);
        }
        Ok(result)
    };
    run.await.inspect_err(|e| set_error(&app, e))
}

fn verified_manifest(app: &AppHandle, sha: &str) -> Result<PatchManifest, String> {
    app.state::<AppPatchState>()
        .verified
        .lock()
        .map_err(|e| e.to_string())?
        .get(sha)
        .cloned()
        .ok_or_else(|| "unknown manifest (check again)".into())
}

#[tauri::command]
pub async fn app_patch_install_part(app: AppHandle, manifest_sha: String, group: String) -> Result<(), String> {
    let run = async {
        let m = verified_manifest(&app, &manifest_sha)?;
        let part = m.parts.into_iter().find(|p| p.group == group).ok_or("group not in the manifest")?;
        let root = store_root(&app)?;
        if is_installed_in(&root, &part) {
            return Ok(());
        }
        // url, size and sha256 come from the verified manifest only.
        let bytes = http_get(&part.url, MAX_PART_BYTES).await?.ok_or_else(|| format!("part {group}: HTTP 404"))?;
        tauri::async_runtime::spawn_blocking(move || install_part_bytes(&root, &part, &bytes))
            .await
            .map_err(|e| e.to_string())?
    };
    run.await.inspect_err(|e| set_error(&app, e))
}

#[tauri::command]
pub fn app_patch_activate(app: AppHandle, manifest_sha: String) -> Result<(), String> {
    let run = || {
        let m = verified_manifest(&app, &manifest_sha)?;
        let version = parse_version(&m.version).ok_or("bad version")?;
        let floor = active_index(&app).map_or(embedded_version(&app), |a| a.version.max(embedded_version(&app)));
        if version <= floor {
            return Err("patch is not newer than the running app".to_string());
        }
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        activate_in(&store_root(&app)?, &m, &manifest_sha, now)?;
        forget_active(&app);
        Ok(())
    };
    run().inspect_err(|e| set_error(&app, e))
}

#[tauri::command]
pub fn app_patch_rollback(app: AppHandle) -> Result<(), String> {
    let file = store_root(&app)?.join("active.json");
    if file.exists() {
        fs::remove_file(&file).map_err(|e| e.to_string())?;
    }
    forget_active(&app);
    Ok(())
}

#[tauri::command]
pub fn app_patch_prune(app: AppHandle) -> Result<usize, String> {
    prune_in(&store_root(&app)?)
}

// ---------- the sfapp:// scheme ----------

pub fn serve<R: Runtime>(app: &AppHandle<R>, request: tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let empty = |status: u16| tauri::http::Response::builder().status(status).body(Vec::new()).unwrap();
    let is_head = request.method() == tauri::http::Method::HEAD;
    if request.method() != tauri::http::Method::GET && !is_head {
        return empty(405);
    }
    let path = request.uri().path().to_string();
    let path = if path == "/" || path.is_empty() { "/index.html".to_string() } else { path };
    let Ok(root) = store_root(app) else { return empty(500) };
    let active = active_index(app);
    let served = resolve(&root, active.as_deref(), embedded_version(app), &path, &|p| embedded_bytes(app, p));
    let bytes = match served {
        Served::Patch(b) | Served::Embedded(b) => b,
        Served::Healed(b) => {
            forget_active(app);
            set_error(app, &format!("the app patch lost {path}; using the built-in version"));
            match b {
                Some(b) => b,
                None => return empty(404),
            }
        }
        Served::NotFound => return empty(404),
    };
    let range = request.headers().get(tauri::http::header::RANGE).and_then(|v| v.to_str().ok());
    let parsed = range.and_then(|v| crate::asset_mods::parse_single_range(v, bytes.len()));
    if range.is_some() && parsed.is_none() {
        return tauri::http::Response::builder()
            .status(416)
            .header("Content-Range", format!("bytes */{}", bytes.len()))
            .body(Vec::new())
            .unwrap();
    }
    let (status, start, end) = parsed.map_or((200, 0, bytes.len()), |(s, e)| (206, s, e));
    let mut resp = tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", mime_for(&path))
        .header("Content-Length", (end - start).to_string())
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", "no-cache");
    if status == 206 {
        resp = resp.header("Content-Range", format!("bytes {start}-{}/{}", end - 1, bytes.len()));
    }
    let body = if is_head { Vec::new() } else if status == 206 { bytes[start..end].to_vec() } else { bytes };
    resp.body(body).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

    /// A throwaway minisign keypair (legacy `Ed` signatures, which the updater's verify accepts).
    struct TestKey {
        pair: Ed25519KeyPair,
        id: [u8; 8],
    }

    impl TestKey {
        fn new(seed: u8) -> Self {
            Self { pair: Ed25519KeyPair::from_seed_unchecked(&[seed; 32]).unwrap(), id: [seed; 8] }
        }
        fn pubkey_b64(&self) -> String {
            let mut bin = b"Ed".to_vec();
            bin.extend_from_slice(&self.id);
            bin.extend_from_slice(self.pair.public_key().as_ref());
            B64.encode(format!("untrusted comment: test key\n{}\n", B64.encode(bin)))
        }
        fn sign(&self, data: &[u8]) -> String {
            let sig = self.pair.sign(data);
            let mut bin = b"Ed".to_vec();
            bin.extend_from_slice(&self.id);
            bin.extend_from_slice(sig.as_ref());
            let trusted = "timestamp:1 file:app-patch.json";
            let mut global = sig.as_ref().to_vec();
            global.extend_from_slice(trusted.as_bytes());
            let g = self.pair.sign(&global);
            B64.encode(format!(
                "untrusted comment: sig\n{}\ntrusted comment: {trusted}\n{}\n",
                B64.encode(bin),
                B64.encode(g.as_ref())
            ))
        }
    }

    fn manifest(version: &str, edition: &str, shell_min: &str) -> PatchManifest {
        PatchManifest {
            version: version.into(),
            edition: edition.into(),
            shell: ShellReq { min: shell_min.into() },
            notes: None,
            parts: vec![PatchPart {
                group: "app".into(),
                hash: "0123456789abcdef".into(),
                size: 10,
                sha256: "a".repeat(64),
                url: "https://github.com/o/r/releases/download/v1.0.33/app-01234567.zip".into(),
                files: vec![
                    PatchFile { path: "/index.html".into(), name: "index.html".into(), size: 3 },
                    PatchFile { path: "/assets/index-abc.js".into(), name: "index-abc.js".into(), size: 2 },
                ],
            }],
        }
    }

    fn check(key: &TestKey, signer: &TestKey, m: &PatchManifest, shell: Version, active: Option<Version>) -> Result<CheckResult, String> {
        let bytes = serde_json::to_vec(m).unwrap();
        let sig = signer.sign(&bytes);
        let input = CheckInput { manifest: &bytes, sig: &sig, pubkey: &key.pubkey_b64(), shell, embedded: (1, 0, 31), active };
        evaluate(input, &|_| false).map(|(_, r)| r)
    }

    #[test]
    fn paths_names_and_versions_are_tightly_validated() {
        for ok in ["/index.html", "/assets/index-abc.js", "/super-fumbbl-assets/kickoff/x.png", "/a/b/c/d.png"] {
            assert!(valid_path(ok), "{ok}");
        }
        for bad in ["index.html", "/", "/a/b/c/d/e.png", "/../x", "/./x", "/.hidden", "/a//b", "/a\\b", "/a b", &format!("/{}", "x".repeat(121))] {
            assert!(!valid_path(bad), "{bad}");
        }
        assert_eq!(parse_version("1.0.33"), Some((1, 0, 33)));
        assert_eq!(parse_version("1.0.33a"), None);
        assert_eq!(parse_version("v1.0.33"), None);
        assert_eq!(bare_version("1.0.30o66kj"), Some((1, 0, 30)));
        let mut m = manifest("1.0.33", "public", "1.0.31");
        assert!(validate_manifest(&m).is_ok());
        m.parts[0].files[1].name = "other.js".into(); // name must be the path's basename
        assert!(validate_manifest(&m).is_err());
        let mut m = manifest("1.0.33", "public", "1.0.31");
        m.parts[0].url = "https://evil.example/app.zip".into();
        assert!(validate_manifest(&m).is_err());
        let mut m = manifest("1.0.33", "public", "1.0.31");
        m.parts[0].group = "../x".into();
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn signature_and_policy_gate_the_offer() {
        let key = TestKey::new(7);
        let other = TestKey::new(9);
        let good = manifest("1.0.33", "public", "1.0.31");
        let offer = check(&key, &key, &good, (1, 0, 31), None).unwrap();
        assert_eq!(offer.version.as_deref(), Some("1.0.33"));
        assert_eq!(offer.to_fetch, vec!["app".to_string()]);
        assert!(offer.manifest_sha.as_ref().is_some_and(|s| s.len() == 64));
        // bad signature: another key, and a tampered body
        assert!(check(&key, &other, &good, (1, 0, 31), None).is_err());
        let bytes = serde_json::to_vec(&good).unwrap();
        let sig = key.sign(&bytes);
        let tampered = String::from_utf8(bytes).unwrap().replace("1.0.33", "1.0.34");
        let input = CheckInput { manifest: tampered.as_bytes(), sig: &sig, pubkey: &key.pubkey_b64(), shell: (1, 0, 31), embedded: (1, 0, 31), active: None };
        assert!(evaluate(input, &|_| false).is_err());
        // edition fork
        assert!(check(&key, &key, &manifest("1.0.33", "fork", "1.0.31"), (1, 0, 31), None).unwrap_err().contains("edition"));
        // shell.min ahead
        let r = check(&key, &key, &manifest("1.0.33", "public", "1.0.34"), (1, 0, 31), None).unwrap();
        assert!(r.needs_shell && r.shell_min.as_deref() == Some("1.0.34") && r.manifest_sha.is_none());
        // not newer than embedded (1.0.31) or the active patch
        assert!(check(&key, &key, &manifest("1.0.31", "public", "1.0.31"), (1, 0, 31), None).unwrap().up_to_date);
        assert!(check(&key, &key, &good, (1, 0, 31), Some((1, 0, 33))).unwrap().up_to_date);
        assert!(!check(&key, &key, &good, (1, 0, 31), Some((1, 0, 32))).unwrap().up_to_date);
    }

    /// Output of the real `tauri signer sign` (prehashed `ED`) with a throwaway key generated for this test (the
    /// private half was discarded): the production verify accepts what the publisher's signer writes.
    #[test]
    fn verifies_real_tauri_signer_output() {
        const DATA: &[u8] = br#"{"version":"1.0.33","edition":"public"}"#;
        const PUB: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFEQTFBOUJDQjVBRTYxMTYKUldRV1lhNjF2S21ocmNoN0hSSDNNamtGYU9sTzVpaXEyOU9sL1llRHhGTkR6NWhTTzhlRjZ3cFoK";
        const SIG: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRV1lhNjF2S21oclhhVWw0RkxKc1p0bXVEaTNhbHJaOVNEZWhjYm9vUE5xNU43TzRrNnQ0TVUrRS82YkEzcmxYRHJZSUY4V3RoMlhudmRWNmg4cnAxTEt0WUFMZXA0WUFNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkwNzk1NzY3CWZpbGU6Zml4dHVyZS5qc29uCklQa2VydTliakxVeFlVa0tCbGVCY0laWFVKMUJSUzB3Zno1YlhGcmVyMjUzQnBSR0dzNkc0N0FwRFRxTDFrYklhRk5HOW1YL3NsbWNRaUJHZGJydUJnPT0K";
        assert!(verify_signature(DATA, SIG, PUB).is_ok());
        assert!(verify_signature(br#"{"version":"1.0.34","edition":"public"}"#, SIG, PUB).is_err());
        // the production key is a different key: this signature must not pass it
        let conf: serde_json::Value =
            serde_json::from_slice(&fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json")).unwrap()).unwrap();
        assert!(verify_signature(DATA, SIG, conf["plugins"]["updater"]["pubkey"].as_str().unwrap()).is_err());
    }

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sf-app-patch-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            for (n, b) in files {
                w.start_file(*n, zip::write::SimpleFileOptions::default()).unwrap();
                std::io::Write::write_all(&mut w, b).unwrap();
            }
            w.finish().unwrap();
        }
        buf.into_inner()
    }

    fn installed_manifest(root: &Path) -> PatchManifest {
        let zip = zip_of(&[("index.html", b"new"), ("index-abc.js", b"js")]);
        let mut m = manifest("1.0.33", "public", "1.0.31");
        m.parts[0].size = zip.len() as u64;
        m.parts[0].sha256 = hex::encode(Sha256::digest(&zip));
        install_part_bytes(root, &m.parts[0], &zip).unwrap();
        m
    }

    #[test]
    fn install_verifies_bytes_and_activate_refuses_a_missing_part() {
        let root = tmp("activate");
        let m = manifest("1.0.33", "public", "1.0.31");
        assert!(activate_in(&root, &m, "sha", 1).unwrap_err().contains("not installed"));
        assert!(!root.join("active.json").exists());
        // wrong sha256 is refused before anything is written
        let zip = zip_of(&[("index.html", b"new")]);
        let mut bad = m.clone();
        bad.parts[0].size = zip.len() as u64;
        assert!(install_part_bytes(&root, &bad.parts[0], &zip).unwrap_err().contains("sha256"));
        // a zip that does not match the listed files is refused
        bad.parts[0].sha256 = hex::encode(Sha256::digest(&zip));
        assert!(install_part_bytes(&root, &bad.parts[0], &zip).unwrap_err().contains("differ"));
        let m = installed_manifest(&root);
        assert!(is_installed_in(&root, &m.parts[0]));
        activate_in(&root, &m, "sha", 1).unwrap();
        assert!(load_active(&root, (1, 0, 31)).is_some());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolver_prefers_active_then_embedded_heals_and_404s() {
        let root = tmp("resolve");
        let m = installed_manifest(&root);
        activate_in(&root, &m, "sha", 1).unwrap();
        let embedded = |p: &str| match p {
            "/index.html" => Some(b"old".to_vec()),
            "/intro.mp4" => Some(b"mp4".to_vec()),
            _ => None,
        };
        let active = load_active(&root, (1, 0, 31)).unwrap();
        assert_eq!(resolve(&root, Some(&active), (1, 0, 31), "/", &embedded), Served::Patch(b"new".to_vec()));
        assert_eq!(resolve(&root, Some(&active), (1, 0, 31), "/intro.mp4", &embedded), Served::Embedded(b"mp4".to_vec()));
        assert_eq!(resolve(&root, Some(&active), (1, 0, 31), "/nope.js", &embedded), Served::NotFound);
        assert_eq!(resolve(&root, Some(&active), (1, 0, 31), "/../secret", &embedded), Served::NotFound);
        // a shell whose embedded dist caught up serves embedded (and load_active drops the stale patch: E2)
        assert_eq!(resolve(&root, Some(&active), (1, 0, 33), "/index.html", &embedded), Served::Embedded(b"old".to_vec()));
        // self-heal: a missing patch file drops active.json and serves the embedded copy
        fs::remove_file(part_dir(&root, "app", &m.parts[0].hash).join("index.html")).unwrap();
        assert_eq!(resolve(&root, Some(&active), (1, 0, 31), "/index.html", &embedded), Served::Healed(Some(b"old".to_vec())));
        assert!(!root.join("active.json").exists());
        assert!(load_active(&root, (1, 0, 31)).is_none());
        // E2
        let m2 = installed_manifest(&root);
        activate_in(&root, &m2, "sha", 1).unwrap();
        assert!(load_active(&root, (1, 0, 33)).is_none());
        assert!(!root.join("active.json").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn prune_keeps_only_the_active_parts() {
        let root = tmp("prune");
        let m = installed_manifest(&root);
        fs::create_dir_all(part_dir(&root, "app", "deadbeefdeadbeef")).unwrap();
        fs::create_dir_all(part_dir(&root, "stadium", "0000000011111111")).unwrap();
        activate_in(&root, &m, "sha", 1).unwrap();
        assert_eq!(prune_in(&root).unwrap(), 2);
        assert!(part_dir(&root, "app", &m.parts[0].hash).is_dir());
        assert!(!root.join("parts").join("stadium").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn mime_table() {
        assert_eq!(mime_for("/assets/x.js"), "text/javascript; charset=utf-8");
        assert_eq!(mime_for("/m.glb"), "model/gltf-binary");
        assert_eq!(mime_for("/intro.mp4"), "video/mp4");
        assert_eq!(mime_for("/fonts/a.woff2"), "font/woff2");
        assert_eq!(mime_for("/x.bin"), "application/octet-stream");
    }

    /// E1: the shell's command set is pinned in shell-api.json; adding/removing a command forces the file's update.
    #[test]
    fn shell_api_json_matches_generate_handler() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let lib = fs::read_to_string(dir.join("src/lib.rs")).unwrap();
        let start = lib.find("generate_handler![").expect("generate_handler!") + "generate_handler![".len();
        let body = &lib[start..start + lib[start..].find(']').unwrap()];
        let mut from_lib: Vec<String> = body
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.rsplit("::").next().unwrap().to_string())
            .collect();
        from_lib.sort();
        let api: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("shell-api.json")).unwrap()).unwrap();
        let api_version = parse_version(api["version"].as_str().unwrap()).expect("shell-api.json version must be X.Y.Z");
        assert!(
            api_version <= parse_version(env!("CARGO_PKG_VERSION")).unwrap(),
            "shell-api.json cannot name a shell newer than the one being built"
        );
        let mut from_file: Vec<String> =
            api["commands"].as_array().unwrap().iter().map(|c| c.as_str().unwrap().to_string()).collect();
        from_file.sort();
        assert_eq!(
            from_lib, from_file,
            "generate_handler! differs from shell-api.json: update the file's commands AND set its version to the version being built"
        );
    }
}
