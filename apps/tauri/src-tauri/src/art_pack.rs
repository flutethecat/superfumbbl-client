//! Owner 09-23: the ART PACK installer. The public client fetches its bundled art (≈280 MB of sprite sheets,
//! badges, decorations, weather, stadium) as zipped PARTS from the public GitHub release instead of shipping
//! them inside the installer; only parts whose hash changed are downloaded again. Parts live under
//! `<app data>/art-pack/<group>/<file>` and `installed.json` records the part hash per group. Extraction only
//! ever writes plain basenames (no directories, no `..`), and every download is size + sha256 checked.
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InstalledArtPack {
    /// group (e.g. "walk/human") → part hash
    #[serde(default)]
    pub parts: std::collections::BTreeMap<String, String>,
}

fn pack_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("art-pack");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn installed_path(root: &Path) -> PathBuf {
    root.join("installed.json")
}

fn read_installed(root: &Path) -> InstalledArtPack {
    fs::read(installed_path(root))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_installed(root: &Path, state: &InstalledArtPack) -> Result<(), String> {
    let tmp = root.join("installed.json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, installed_path(root)).map_err(|e| e.to_string())
}

/// A group is one or two path segments of [a-z0-9_-]; nothing else reaches the filesystem.
pub fn valid_group(group: &str) -> bool {
    let segs: Vec<&str> = group.split('/').collect();
    (1..=2).contains(&segs.len())
        && segs.iter().all(|s| {
            !s.is_empty()
                && s.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
        })
}

/// A zip entry is accepted only as a plain basename: no separators, no `..`, printable ASCII, an extension.
pub fn safe_entry_name(name: &str) -> Option<&str> {
    if name.is_empty()
        || name.len() > 200
        || name.contains('/')
        || name.contains('\\')
        || name == "."
        || name == ".."
        || name.starts_with('.')
    {
        return None;
    }
    if !name
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
    {
        return None;
    }
    if !name.contains('.') {
        return None;
    }
    Some(name)
}

const MAX_PART_BYTES: u64 = 512 * 1024 * 1024;

#[tauri::command]
pub fn art_pack_dir(app: AppHandle) -> Result<String, String> {
    Ok(pack_root(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn art_pack_installed(app: AppHandle) -> Result<InstalledArtPack, String> {
    Ok(read_installed(&pack_root(&app)?))
}

/// Download one part (a zip of plain files), verify size + sha256, extract into `<root>/<group>/`, record it.
/// Returns the file names now present for the group.
#[tauri::command]
pub async fn art_pack_install_part(
    app: AppHandle,
    url: String,
    group: String,
    hash: String,
    size: u64,
    sha256: String,
) -> Result<Vec<String>, String> {
    if !valid_group(&group) {
        return Err(format!("invalid part group {group:?}"));
    }
    if !(url.starts_with("https://github.com/") || url.starts_with("https://objects.githubusercontent.com/")) {
        return Err("part url must be a GitHub release asset".into());
    }
    if size == 0 || size > MAX_PART_BYTES {
        return Err(format!("part size {size} out of range"));
    }
    let root = pack_root(&app)?;
    let client = tauri_plugin_http::reqwest::Client::builder()
        .user_agent("SuperFUMBBL art-pack")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} for {url}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() as u64 != size {
        return Err(format!("part {group}: got {} bytes, expected {size}", bytes.len()));
    }
    let digest = hex::encode(Sha256::digest(&bytes));
    if !digest.eq_ignore_ascii_case(&sha256) {
        return Err(format!("part {group}: sha256 mismatch"));
    }
    let group_dir = root.join(group.replace('/', std::path::MAIN_SEPARATOR_STR));
    let names = tauri::async_runtime::spawn_blocking(move || extract_flat(&bytes, &group_dir))
        .await
        .map_err(|e| e.to_string())??;
    let mut state = read_installed(&root);
    state.parts.insert(group, hash);
    write_installed(&root, &state)?;
    Ok(names)
}

/// Replace the group directory with the zip's files (plain basenames only), atomically via a staging dir.
fn extract_flat(bytes: &[u8], group_dir: &Path) -> Result<Vec<String>, String> {
    let staging = group_dir.with_extension("staging");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let mut names = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let name = safe_entry_name(entry.name())
            .ok_or_else(|| format!("unsafe zip entry {:?}", entry.name()))?
            .to_string();
        let mut out = Vec::with_capacity(entry.size() as usize);
        entry.take(MAX_PART_BYTES).read_to_end(&mut out).map_err(|e| e.to_string())?;
        fs::write(staging.join(&name), out).map_err(|e| e.to_string())?;
        names.push(name);
    }
    let _ = fs::remove_dir_all(group_dir);
    if let Some(parent) = group_dir.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&staging, group_dir).map_err(|e| e.to_string())?;
    names.sort();
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_and_entry_names_are_tightly_validated() {
        assert!(valid_group("status"));
        assert!(valid_group("walk/human"));
        assert!(!valid_group("walk/human/x"));
        assert!(!valid_group("../x"));
        assert!(!valid_group("Walk/Human"));
        assert!(safe_entry_name("lineman-a1b2c3d4.png").is_some());
        assert!(safe_entry_name("../x.png").is_none());
        assert!(safe_entry_name("a/b.png").is_none());
        assert!(safe_entry_name("a\\b.png").is_none());
        assert!(safe_entry_name(".hidden").is_none());
        assert!(safe_entry_name("noext").is_none());
    }

    #[test]
    fn extract_flat_writes_only_plain_files() {
        let dir = std::env::temp_dir().join(format!("sf-art-pack-{}", std::process::id()));
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            let opts = zip::write::SimpleFileOptions::default();
            w.start_file("a-1.png", opts).unwrap();
            std::io::Write::write_all(&mut w, b"png").unwrap();
            w.finish().unwrap();
        }
        let names = extract_flat(buf.get_ref(), &dir.join("status")).unwrap();
        assert_eq!(names, vec!["a-1.png".to_string()]);
        assert_eq!(fs::read(dir.join("status").join("a-1.png")).unwrap(), b"png");
        let _ = fs::remove_dir_all(&dir);
    }
}
