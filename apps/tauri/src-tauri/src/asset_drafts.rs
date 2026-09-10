use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Manager, Runtime};

use super::{asset_media, asset_mods};

const MAX_DRAFTS: usize = 16;
const MAX_DRAFT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_DRAFT_MANIFEST_BYTES: u64 = 2 * 1024 * 1024;
const MIGRATED_DRAFT_ID: &str = "4d69677261746564536f756e64730001";
pub(crate) const USER_FILES_DRAFT_ID: &str = "596f757246696c657300000000000001";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DraftTarget {
    SkillIcon {
        skill: String,
        #[serde(deserialize_with = "asset_mods::deserialize_required_option")]
        position_id: Option<String>,
        side: asset_mods::AssetSide,
    },
    PlayerSprite {
        team_id: String,
        position_id: String,
        #[serde(default)]
        side: asset_mods::AssetSide,
    },
    WalkSheet {
        team_id: String,
        position_id: String,
        #[serde(default)]
        side: asset_mods::AssetSide,
    },
    SoundEvent {
        event_id: String,
    },
    TeamLogo {
        race: String,
    },
    BlockDie {
        face: String,
    },
    PitchImage {
        theme_id: String,
        weather: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DraftRecord {
    binding_id: String,
    target: DraftTarget,
    sha256: String,
    extension: String,
    mime: String,
    size_bytes: usize,
    width: Option<u32>,
    height: Option<u32>,
    duration_ms: Option<u32>,
    channels: Option<u8>,
    sample_rate: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    walk_sheet_spec: Option<asset_mods::WalkSheetSpecV1>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DraftFile {
    draft_id: String,
    name: String,
    pack_id: String,
    version: String,
    items: BTreeMap<String, DraftRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSummary {
    draft_id: String,
    name: String,
    bindings: usize,
    size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftDetails {
    draft_id: String,
    name: String,
    pack_id: String,
    version: String,
    bindings: usize,
    size_bytes: u64,
    items: Vec<DraftItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftItem {
    binding_id: String,
    kind: &'static str,
    target: DraftTarget,
    preview_url: String,
    mime: String,
    sha256: String,
    size_bytes: usize,
    width: Option<u32>,
    height: Option<u32>,
    duration_ms: Option<u32>,
    channels: Option<u8>,
    sample_rate: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    walk_sheet_spec: Option<asset_mods::WalkSheetSpecV1>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DraftSection {
    SkillIcons,
    PlayerSprites,
    WalkSheets,
    SoundEvents,
    TeamLogos,
    BlockDice,
    PitchImages,
    Combined,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UserOverrideKind {
    Sprite,
    Sound,
    Logo,
    BlockDie,
}

fn draft_error() -> String {
    "Asset draft is invalid or unavailable".into()
}

fn storage_error() -> String {
    "Asset draft storage is unavailable".into()
}

fn valid_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_name(name: &str) -> bool {
    !name.trim().is_empty() && name.len() <= 120 && !name.chars().any(char::is_control)
}

fn root_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| storage_error())?
        .join("asset-drafts"))
}

fn ensure_plain_dir(path: &Path) -> Result<(), String> {
    match std::fs::create_dir(path) {
        Ok(()) => {
            if let Some(parent) = path.parent() {
                asset_mods::sync_directory(parent)?;
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(storage_error()),
    }
    let metadata = std::fs::symlink_metadata(path).map_err(|_| storage_error())?;
    if !metadata.is_dir() || asset_mods::metadata_is_reparse(&metadata) {
        return Err(storage_error());
    }
    Ok(())
}

fn draft_dir(root: &Path, draft_id: &str) -> Result<PathBuf, String> {
    if !valid_hex(draft_id, 32) {
        return Err(draft_error());
    }
    Ok(root.join(draft_id))
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| draft_error())?;
    if !metadata.is_file() || asset_mods::metadata_is_reparse(&metadata) || metadata.len() > limit {
        return Err(draft_error());
    }
    let file = asset_mods::open_read_no_follow(path).map_err(|_| draft_error())?;
    let opened = file.metadata().map_err(|_| draft_error())?;
    if opened.len() != metadata.len() || !opened.is_file() {
        return Err(draft_error());
    }
    let mut bytes = Vec::with_capacity(opened.len() as usize);
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| draft_error())?;
    if bytes.len() as u64 != opened.len() || bytes.len() as u64 > limit {
        return Err(draft_error());
    }
    Ok(bytes)
}

fn load_draft(root: &Path, draft_id: &str) -> Result<DraftFile, String> {
    let dir = draft_dir(root, draft_id)?;
    let metadata = std::fs::symlink_metadata(&dir).map_err(|_| draft_error())?;
    if !metadata.is_dir() || asset_mods::metadata_is_reparse(&metadata) {
        return Err(draft_error());
    }
    let draft: DraftFile = serde_json::from_slice(&read_bounded(
        &dir.join("draft.json"),
        MAX_DRAFT_MANIFEST_BYTES,
    )?)
    .map_err(|_| draft_error())?;
    if draft.draft_id != draft_id
        || !valid_name(&draft.name)
        || draft.pack_id != format!("local.user.{draft_id}")
        || draft.version != "1.0.0"
        || draft.items.len() > 4096
    {
        return Err(draft_error());
    }
    let blobs = dir.join("blobs");
    let blob_meta = std::fs::symlink_metadata(&blobs).map_err(|_| draft_error())?;
    if !blob_meta.is_dir() || asset_mods::metadata_is_reparse(&blob_meta) {
        return Err(draft_error());
    }
    for (binding_id, item) in &draft.items {
        if binding_id != &item.binding_id
            || !valid_hex(binding_id, 32)
            || !valid_hex(&item.sha256, 64)
            || !matches!(item.extension.as_str(), "png" | "gif" | "wav")
            || !matches!(item.mime.as_str(), "image/png" | "image/gif" | "audio/wav")
        {
            return Err(draft_error());
        }
        validate_target(&item.target)?;
        let path = blobs.join(format!("{}.{}", item.sha256, item.extension));
        let bytes = read_bounded(&path, 8 * 1024 * 1024)?;
        if bytes.len() != item.size_bytes || format!("{:x}", Sha256::digest(&bytes)) != item.sha256
        {
            return Err(draft_error());
        }
    }
    let stale = dir.join(".draft.json.tmp");
    if let Ok(metadata) = std::fs::symlink_metadata(&stale) {
        if !metadata.is_file() || asset_mods::metadata_is_reparse(&metadata) {
            return Err(storage_error());
        }
        std::fs::remove_file(stale).map_err(|_| storage_error())?;
    }
    cleanup_orphan_blobs(root, &draft)?;
    Ok(draft)
}

fn write_atomic(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    let temp = dir.join(format!(".{name}.tmp"));
    if temp.exists() {
        let metadata = std::fs::symlink_metadata(&temp).map_err(|_| storage_error())?;
        if !metadata.is_file() || asset_mods::metadata_is_reparse(&metadata) {
            return Err(storage_error());
        }
        std::fs::remove_file(&temp).map_err(|_| storage_error())?;
    }
    let mut file = asset_mods::open_write_no_follow(&temp, true).map_err(|_| storage_error())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| storage_error())?;
    drop(file);
    asset_mods::atomic_replace(&temp, &dir.join(name)).map_err(|_| storage_error())?;
    asset_mods::sync_directory(dir)
}

fn save_draft(root: &Path, draft: &DraftFile) -> Result<(), String> {
    let bytes = serde_json::to_vec(draft).map_err(|_| draft_error())?;
    if bytes.len() as u64 > MAX_DRAFT_MANIFEST_BYTES {
        return Err(draft_error());
    }
    write_atomic(&draft_dir(root, &draft.draft_id)?, "draft.json", &bytes)
}

fn root_usage(root: &Path) -> Result<(usize, u64), String> {
    cleanup_staging_dirs(root)?;
    let mut count = 0;
    let mut bytes = 0_u64;
    for entry in std::fs::read_dir(root).map_err(|_| storage_error())? {
        let entry = entry.map_err(|_| storage_error())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !valid_hex(&name, 32) {
            continue;
        }
        let metadata = std::fs::symlink_metadata(entry.path()).map_err(|_| storage_error())?;
        if !metadata.is_dir() || asset_mods::metadata_is_reparse(&metadata) {
            return Err(storage_error());
        }
        count += 1;
        for child in walk_plain_files(&entry.path())? {
            bytes = bytes
                .checked_add(child.metadata().map_err(|_| storage_error())?.len())
                .ok_or_else(storage_error)?;
        }
    }
    Ok((count, bytes))
}

fn staging_id(name: &str) -> Option<&str> {
    let id = name
        .strip_prefix(".create-")
        .or_else(|| name.strip_prefix(".delete-"))?
        .strip_suffix(".tmp")?;
    valid_hex(id, 32).then_some(id)
}

fn remove_plain_tree(root: &Path, path: &Path) -> Result<(), String> {
    let canonical_root = std::fs::canonicalize(root).map_err(|_| storage_error())?;
    let canonical_path = std::fs::canonicalize(path).map_err(|_| storage_error())?;
    if canonical_path.parent() != Some(canonical_root.as_path()) {
        return Err(storage_error());
    }
    fn remove_contents(dir: &Path) -> Result<(), String> {
        for entry in std::fs::read_dir(dir).map_err(|_| storage_error())? {
            let entry = entry.map_err(|_| storage_error())?;
            let path = entry.path();
            let metadata = std::fs::symlink_metadata(&path).map_err(|_| storage_error())?;
            if asset_mods::metadata_is_reparse(&metadata) {
                return Err(storage_error());
            }
            if metadata.is_dir() {
                remove_contents(&path)?;
                std::fs::remove_dir(path).map_err(|_| storage_error())?;
            } else if metadata.is_file() {
                std::fs::remove_file(path).map_err(|_| storage_error())?;
            } else {
                return Err(storage_error());
            }
        }
        Ok(())
    }
    remove_contents(&canonical_path)?;
    std::fs::remove_dir(canonical_path).map_err(|_| storage_error())?;
    asset_mods::sync_directory(root)
}

fn cleanup_staging_dirs(root: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(root).map_err(|_| storage_error())? {
        let entry = entry.map_err(|_| storage_error())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if staging_id(&name).is_none() {
            continue;
        }
        let metadata = std::fs::symlink_metadata(entry.path()).map_err(|_| storage_error())?;
        if !metadata.is_dir() || asset_mods::metadata_is_reparse(&metadata) {
            return Err(storage_error());
        }
        remove_plain_tree(root, &entry.path())?;
    }
    Ok(())
}

fn walk_plain_files(dir: &Path) -> Result<Vec<std::fs::DirEntry>, String> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|_| storage_error())? {
        let entry = entry.map_err(|_| storage_error())?;
        let metadata = std::fs::symlink_metadata(entry.path()).map_err(|_| storage_error())?;
        if asset_mods::metadata_is_reparse(&metadata) {
            return Err(storage_error());
        }
        if metadata.is_dir() {
            files.extend(walk_plain_files(&entry.path())?);
        } else if metadata.is_file() {
            files.push(entry);
        } else {
            return Err(storage_error());
        }
    }
    Ok(files)
}

fn validate_target(target: &DraftTarget) -> Result<(), String> {
    let valid_id = |value: &str| {
        !value.is_empty()
            && value.len() <= 96
            && value.is_ascii()
            && value.bytes().enumerate().all(|(index, byte)| {
                byte.is_ascii_alphanumeric() || (index > 0 && b"._:-".contains(&byte))
            })
    };
    match target {
        DraftTarget::SkillIcon {
            skill, position_id, ..
        } => {
            if asset_mods::canonical_skill_key(skill).is_none()
                || position_id.as_deref().is_some_and(|value| !valid_id(value))
            {
                return Err(draft_error());
            }
        }
        DraftTarget::PlayerSprite {
            team_id,
            position_id,
            ..
        }
        | DraftTarget::WalkSheet {
            team_id,
            position_id,
            ..
        } => {
            if !valid_id(team_id) || !valid_id(position_id) {
                return Err(draft_error());
            }
        }
        DraftTarget::SoundEvent { event_id } => {
            if !asset_mods::valid_sound_event_id(event_id) {
                return Err(draft_error());
            }
        }
        DraftTarget::TeamLogo { race } => {
            if !asset_mods::valid_team_logo_race(race) {
                return Err(draft_error());
            }
        }
        DraftTarget::BlockDie { face } => {
            if !asset_mods::valid_block_die_face(face) {
                return Err(draft_error());
            }
        }
        DraftTarget::PitchImage { theme_id, weather } => {
            if !asset_mods::valid_pitch_image_id(&format!("{theme_id}:{weather}")) {
                return Err(draft_error());
            }
        }
    }
    Ok(())
}

fn target_binding_id(target: &DraftTarget) -> Result<String, String> {
    validate_target(target)?;
    let value = match target {
        DraftTarget::SkillIcon {
            skill,
            position_id,
            side,
        } => serde_json::json!({
            "kind": "skillIcon",
            "skill": asset_mods::canonical_skill_key(skill).ok_or_else(draft_error)?,
            "positionId": position_id,
            "side": side,
        }),
        _ => serde_json::to_value(target).map_err(|_| draft_error())?,
    };
    let bytes = serde_json::to_vec(&value).map_err(|_| draft_error())?;
    Ok(format!("{:x}", Sha256::digest(bytes))[..32].to_owned())
}

fn store_blob(
    root: &Path,
    draft: &DraftFile,
    bytes: &[u8],
    extension: &str,
) -> Result<String, String> {
    let sha = format!("{:x}", Sha256::digest(bytes));
    let dir = draft_dir(root, &draft.draft_id)?.join("blobs");
    let name = format!("{sha}.{extension}");
    let target = dir.join(&name);
    if target.exists() {
        if read_bounded(&target, 8 * 1024 * 1024)? != bytes {
            return Err(storage_error());
        }
        return Ok(sha);
    }
    write_atomic(&dir, &name, bytes)?;
    Ok(sha)
}

fn ensure_blob_capacity(
    root: &Path,
    draft: &DraftFile,
    blobs: &[(&[u8], &str)],
) -> Result<(), String> {
    let (_, used) = root_usage(root)?;
    let dir = draft_dir(root, &draft.draft_id)?.join("blobs");
    let mut extra = 0_u64;
    let mut seen: HashSet<String> = draft
        .items
        .values()
        .map(|item| format!("{}.{}", item.sha256, item.extension))
        .collect();
    for (bytes, extension) in blobs {
        let sha = format!("{:x}", Sha256::digest(bytes));
        let name = format!("{sha}.{extension}");
        if seen.insert(name.clone()) && !dir.join(name).exists() {
            extra = extra
                .checked_add(bytes.len() as u64)
                .ok_or_else(storage_error)?;
        }
    }
    if seen.len() > 2048 {
        return Err("Asset draft file limit reached".into());
    }
    if used
        .checked_add(extra)
        .is_none_or(|total| total > MAX_DRAFT_BYTES)
    {
        return Err("Asset draft storage limit reached".into());
    }
    Ok(())
}

fn cleanup_orphan_blobs(root: &Path, draft: &DraftFile) -> Result<(), String> {
    let keep: HashSet<String> = draft
        .items
        .values()
        .map(|item| format!("{}.{}", item.sha256, item.extension))
        .collect();
    let dir = draft_dir(root, &draft.draft_id)?.join("blobs");
    for entry in std::fs::read_dir(&dir).map_err(|_| storage_error())? {
        let entry = entry.map_err(|_| storage_error())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let metadata = std::fs::symlink_metadata(entry.path()).map_err(|_| storage_error())?;
        if !metadata.is_file() || asset_mods::metadata_is_reparse(&metadata) {
            return Err(storage_error());
        }
        if !keep.contains(&name) {
            std::fs::remove_file(entry.path()).map_err(|_| storage_error())?;
        }
    }
    asset_mods::sync_directory(&dir)
}

fn details<R: Runtime>(
    app: &tauri::AppHandle<R>,
    root: &Path,
    draft: DraftFile,
) -> Result<DraftDetails, String> {
    let dir = draft_dir(root, &draft.draft_id)?;
    let assets = draft
        .items
        .values()
        .map(|item| {
            (
                item.binding_id.clone(),
                dir.join("blobs")
                    .join(format!("{}.{}", item.sha256, item.extension)),
                item.size_bytes,
                item.mime.clone(),
                item.sha256.clone(),
            )
        })
        .collect();
    let urls = asset_mods::register_draft_assets(app, &draft.draft_id, assets)?;
    let size_bytes = draft
        .items
        .values()
        .map(|item| item.size_bytes as u64)
        .sum();
    let items: Vec<DraftItem> = draft
        .items
        .values()
        .cloned()
        .map(|item| {
            let kind = match &item.target {
                DraftTarget::SkillIcon { .. } => "skillIcon",
                DraftTarget::PlayerSprite { .. } => "playerSprite",
                DraftTarget::WalkSheet { .. } => "walkSheet",
                DraftTarget::SoundEvent { .. } => "soundEvent",
                DraftTarget::TeamLogo { .. } => "teamLogo",
                DraftTarget::BlockDie { .. } => "blockDie",
                DraftTarget::PitchImage { .. } => "pitchImage",
            };
            DraftItem {
                preview_url: urls[&item.binding_id].clone(),
                binding_id: item.binding_id,
                kind,
                target: item.target,
                mime: item.mime,
                sha256: item.sha256,
                size_bytes: item.size_bytes,
                width: item.width,
                height: item.height,
                duration_ms: item.duration_ms,
                channels: item.channels,
                sample_rate: item.sample_rate,
                walk_sheet_spec: item.walk_sheet_spec,
            }
        })
        .collect();
    Ok(DraftDetails {
        draft_id: draft.draft_id,
        name: draft.name,
        pack_id: draft.pack_id,
        version: draft.version,
        bindings: items.len(),
        size_bytes,
        items,
    })
}

fn new_draft(root: &Path, draft_id: String, name: String) -> Result<DraftFile, String> {
    if !valid_name(&name) {
        return Err(draft_error());
    }
    let dir = draft_dir(root, &draft_id)?;
    if dir.exists() {
        return Err(draft_error());
    }
    cleanup_staging_dirs(root)?;
    let staging = root.join(format!(".create-{draft_id}.tmp"));
    ensure_plain_dir(&staging)?;
    ensure_plain_dir(&staging.join("blobs"))?;
    let draft = DraftFile {
        pack_id: format!("local.user.{draft_id}"),
        version: "1.0.0".into(),
        draft_id,
        name: name.trim().to_owned(),
        items: BTreeMap::new(),
    };
    let bytes = serde_json::to_vec(&draft).map_err(|_| draft_error())?;
    write_atomic(&staging, "draft.json", &bytes)?;
    std::fs::rename(&staging, &dir).map_err(|_| storage_error())?;
    asset_mods::sync_directory(root)?;
    Ok(draft)
}

#[tauri::command]
pub fn asset_draft_list(app: tauri::AppHandle) -> Result<Vec<DraftSummary>, String> {
    let root = root_dir(&app)?;
    let _lock = asset_mods::lock_storage(&root)?;
    cleanup_staging_dirs(&root)?;
    let mut summaries = Vec::new();
    for entry in std::fs::read_dir(&root).map_err(|_| storage_error())? {
        let entry = entry.map_err(|_| storage_error())?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if !valid_hex(&id, 32) {
            continue;
        }
        let draft = load_draft(&root, &id)?;
        summaries.push(DraftSummary {
            draft_id: draft.draft_id,
            name: draft.name,
            bindings: draft.items.len(),
            size_bytes: draft
                .items
                .values()
                .map(|item| item.size_bytes as u64)
                .sum(),
        });
    }
    summaries.sort_by(|a, b| a.name.cmp(&b.name).then(a.draft_id.cmp(&b.draft_id)));
    Ok(summaries)
}

#[tauri::command]
pub fn asset_draft_create(app: tauri::AppHandle, name: String) -> Result<DraftDetails, String> {
    let root = root_dir(&app)?;
    let _lock = asset_mods::lock_storage(&root)?;
    let (count, bytes) = root_usage(&root)?;
    if count >= MAX_DRAFTS || bytes > MAX_DRAFT_BYTES {
        return Err("Asset draft storage limit reached".into());
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    let draft = new_draft(&root, id, name)?;
    details(&app, &root, draft)
}

#[tauri::command]
pub fn asset_draft_update(
    app: tauri::AppHandle,
    draft_id: String,
    name: String,
) -> Result<DraftDetails, String> {
    if !valid_name(&name) {
        return Err(draft_error());
    }
    let root = root_dir(&app)?;
    let _lock = asset_mods::lock_storage(&root)?;
    let mut draft = load_draft(&root, &draft_id)?;
    draft.name = name.trim().to_owned();
    save_draft(&root, &draft)?;
    details(&app, &root, draft)
}

#[tauri::command]
pub fn asset_draft_inspect(
    app: tauri::AppHandle,
    draft_id: String,
) -> Result<DraftDetails, String> {
    let root = root_dir(&app)?;
    let _lock = asset_mods::lock_storage(&root)?;
    let draft = load_draft(&root, &draft_id)?;
    details(&app, &root, draft)
}

fn remove_tree_exact(root: &Path, draft_id: &str) -> Result<(), String> {
    let dir = draft_dir(root, draft_id)?;
    let staged = root.join(format!(".delete-{draft_id}.tmp"));
    cleanup_staging_dirs(root)?;
    let metadata = std::fs::symlink_metadata(&dir).map_err(|_| draft_error())?;
    if !metadata.is_dir() || asset_mods::metadata_is_reparse(&metadata) {
        return Err(draft_error());
    }
    std::fs::rename(&dir, &staged).map_err(|_| storage_error())?;
    asset_mods::sync_directory(root)?;
    remove_plain_tree(root, &staged)
}

#[tauri::command]
pub fn asset_draft_delete(app: tauri::AppHandle, draft_id: String) -> Result<(), String> {
    let root = root_dir(&app)?;
    let _lock = asset_mods::lock_storage(&root)?;
    remove_tree_exact(&root, &draft_id)?;
    asset_mods::unregister_draft_assets(&app, &draft_id);
    Ok(())
}

#[tauri::command]
pub fn asset_draft_put_image(
    app: tauri::AppHandle,
    draft_id: String,
    source_path: String,
    target: DraftTarget,
    scaling: asset_media::Scaling,
) -> Result<DraftDetails, String> {
    if !matches!(
        target,
        DraftTarget::SkillIcon { .. }
            | DraftTarget::PlayerSprite { .. }
            | DraftTarget::BlockDie { .. }
            | DraftTarget::PitchImage { .. }
    ) {
        return Err(draft_error());
    }
    validate_target(&target)?;
    let normalized = if matches!(target, DraftTarget::PitchImage { .. }) {
        asset_media::normalize_pitch_image_path(Path::new(&source_path))?
    } else if matches!(target, DraftTarget::BlockDie { .. }) {
        asset_media::normalize_block_die_image_path(Path::new(&source_path))?
    } else {
        asset_media::normalize_image_path(
            Path::new(&source_path),
            matches!(target, DraftTarget::PlayerSprite { .. }),
            scaling,
        )?
    };
    let root = root_dir(&app)?;
    let _lock = asset_mods::lock_storage(&root)?;
    let mut draft = load_draft(&root, &draft_id)?;
    put_image_record(&root, &mut draft, target, normalized)?;
    save_draft(&root, &draft)?;
    cleanup_orphan_blobs(&root, &draft)?;
    details(&app, &root, draft)
}

fn put_image_record(
    root: &Path,
    draft: &mut DraftFile,
    target: DraftTarget,
    normalized: asset_media::NormalizedImage,
) -> Result<(), String> {
    ensure_blob_capacity(root, draft, &[(&normalized.bytes, normalized.extension)])?;
    let binding_id = target_binding_id(&target)?;
    if !draft.items.contains_key(&binding_id) && draft.items.len() >= 4096 {
        return Err("Asset draft binding limit reached".into());
    }
    let sha = store_blob(root, draft, &normalized.bytes, normalized.extension)?;
    draft.items.insert(
        binding_id.clone(),
        DraftRecord {
            binding_id,
            target,
            sha256: sha,
            extension: normalized.extension.into(),
            mime: normalized.mime.into(),
            size_bytes: normalized.bytes.len(),
            width: Some(normalized.width),
            height: Some(normalized.height),
            duration_ms: None,
            channels: None,
            sample_rate: None,
            walk_sheet_spec: None,
        },
    );
    Ok(())
}

fn put_sound_record(
    root: &Path,
    draft: &mut DraftFile,
    event_id: String,
    normalized: asset_media::NormalizedSound,
) -> Result<(), String> {
    let target = DraftTarget::SoundEvent { event_id };
    let binding_id = target_binding_id(&target)?;
    if !draft.items.contains_key(&binding_id) && draft.items.len() >= 4096 {
        return Err("Asset draft binding limit reached".into());
    }
    let sha = store_blob(root, draft, &normalized.bytes, "wav")?;
    draft.items.insert(
        binding_id.clone(),
        DraftRecord {
            binding_id,
            target,
            sha256: sha,
            extension: "wav".into(),
            mime: "audio/wav".into(),
            size_bytes: normalized.bytes.len(),
            width: None,
            height: None,
            duration_ms: Some(normalized.duration_ms),
            channels: Some(normalized.channels),
            sample_rate: Some(normalized.sample_rate),
            walk_sheet_spec: None,
        },
    );
    Ok(())
}

fn read_walk_sheet_spec(source: &Path) -> Result<asset_mods::WalkSheetSpecV1, String> {
    let primary = source.with_extension("json");
    let sidecar = match std::fs::symlink_metadata(&primary) {
        Ok(_) => primary,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => source
            .parent()
            .ok_or_else(draft_error)?
            .join("walk-sheet-64.json"),
        Err(_) => return Err(draft_error()),
    };
    serde_json::from_slice(&read_bounded(&sidecar, 64 * 1024)?).map_err(|_| draft_error())
}

fn put_walk_sheet_record(
    root: &Path,
    draft: &mut DraftFile,
    source: &Path,
    target: DraftTarget,
    spec: Option<asset_mods::WalkSheetSpecV1>,
) -> Result<(), String> {
    let (team_id, position_id, side) = match &target {
        DraftTarget::WalkSheet {
            team_id,
            position_id,
            side,
        } => (team_id, position_id, *side),
        _ => return Err(draft_error()),
    };
    validate_target(&target)?;
    if source
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("png"))
    {
        return Err("walk sheets must be PNG".into());
    }
    let spec = match spec {
        Some(spec) => spec,
        None => read_walk_sheet_spec(source)?,
    };
    let bytes = read_bounded(source, 8 * 1024 * 1024)?;
    let width = u32::from(spec.columns)
        .checked_mul(64)
        .ok_or_else(draft_error)?;
    let height = 8_u32.checked_mul(64).ok_or_else(draft_error)?;
    let path = source.to_string_lossy().into_owned();
    let binding = asset_mods::WalkSheetBindingV2 {
        team_id: team_id.clone(),
        position_id: position_id.clone(),
        side,
        path: path.clone(),
        frame: spec.frame,
        rows: spec.rows.clone(),
        columns: spec.columns,
        idle_column: spec.idle_column,
        fps: spec.fps,
        foot_y: spec.foot_y,
    };
    let file = asset_mods::ManifestFileV2::Image(asset_mods::ManifestImageFileV2 {
        path,
        mime: "image/png".into(),
        offset: 0,
        length: bytes.len(),
        sha256: format!("{:x}", Sha256::digest(&bytes)),
        width,
        height,
    });
    asset_mods::validate_walk_sheet(&binding, &file, &bytes)?;

    ensure_blob_capacity(root, draft, &[(&bytes, "png")])?;
    let binding_id = target_binding_id(&target)?;
    if !draft.items.contains_key(&binding_id) && draft.items.len() >= 4096 {
        return Err("Asset draft binding limit reached".into());
    }
    let sha = store_blob(root, draft, &bytes, "png")?;
    draft.items.insert(
        binding_id.clone(),
        DraftRecord {
            binding_id,
            target,
            sha256: sha,
            extension: "png".into(),
            mime: "image/png".into(),
            size_bytes: bytes.len(),
            width: Some(width),
            height: Some(height),
            duration_ms: None,
            channels: None,
            sample_rate: None,
            walk_sheet_spec: Some(spec),
        },
    );
    Ok(())
}

#[tauri::command]
pub fn asset_draft_put_walk_sheet(
    app: tauri::AppHandle,
    draft_id: String,
    source_path: String,
    target: DraftTarget,
    spec: Option<asset_mods::WalkSheetSpecV1>,
) -> Result<DraftDetails, String> {
    let root = root_dir(&app)?;
    let _lock = asset_mods::lock_storage(&root)?;
    let mut draft = load_draft(&root, &draft_id)?;
    put_walk_sheet_record(&root, &mut draft, Path::new(&source_path), target, spec)?;
    save_draft(&root, &draft)?;
    cleanup_orphan_blobs(&root, &draft)?;
    details(&app, &root, draft)
}

#[tauri::command]
pub fn asset_draft_put_sound(
    app: tauri::AppHandle,
    draft_id: String,
    source_path: String,
    event_id: String,
) -> Result<DraftDetails, String> {
    if !asset_mods::valid_sound_event_id(&event_id) {
        return Err(draft_error());
    }
    let normalized = asset_media::normalize_sound_path(Path::new(&source_path))?;
    let root = root_dir(&app)?;
    let _lock = asset_mods::lock_storage(&root)?;
    let mut draft = load_draft(&root, &draft_id)?;
    ensure_blob_capacity(&root, &draft, &[(&normalized.bytes, "wav")])?;
    put_sound_record(&root, &mut draft, event_id, normalized)?;
    save_draft(&root, &draft)?;
    cleanup_orphan_blobs(&root, &draft)?;
    details(&app, &root, draft)
}

#[tauri::command]
pub fn asset_draft_remove_binding(
    app: tauri::AppHandle,
    draft_id: String,
    binding_id: String,
) -> Result<DraftDetails, String> {
    if !valid_hex(&binding_id, 32) {
        return Err(draft_error());
    }
    let root = root_dir(&app)?;
    let _lock = asset_mods::lock_storage(&root)?;
    let mut draft = load_draft(&root, &draft_id)?;
    draft.items.remove(&binding_id).ok_or_else(draft_error)?;
    save_draft(&root, &draft)?;
    cleanup_orphan_blobs(&root, &draft)?;
    details(&app, &root, draft)
}

fn included(section: DraftSection, target: &DraftTarget) -> bool {
    matches!(section, DraftSection::Combined)
        || matches!(
            (section, target),
            (DraftSection::SkillIcons, DraftTarget::SkillIcon { .. })
                | (
                    DraftSection::PlayerSprites,
                    DraftTarget::PlayerSprite { .. }
                )
                | (DraftSection::WalkSheets, DraftTarget::WalkSheet { .. })
                | (DraftSection::SoundEvents, DraftTarget::SoundEvent { .. })
                | (DraftSection::TeamLogos, DraftTarget::TeamLogo { .. })
                | (DraftSection::BlockDice, DraftTarget::BlockDie { .. })
                | (DraftSection::PitchImages, DraftTarget::PitchImage { .. })
        )
}

fn add_pack_payload_budget(offset: u64, length: usize) -> Result<u64, String> {
    let next = offset.checked_add(length as u64).ok_or_else(draft_error)?;
    if next > asset_mods::MAX_PACK_V2_BYTES as u64 {
        return Err("The selected asset section is too large".into());
    }
    Ok(next)
}

fn compile_pack(root: &Path, draft: &DraftFile, section: DraftSection) -> Result<Vec<u8>, String> {
    let selected: Vec<_> = draft
        .items
        .values()
        .filter(|item| included(section, &item.target))
        .collect();
    if selected.is_empty() {
        return Err("The selected asset section is empty".into());
    }
    let mut unique = BTreeMap::<String, &DraftRecord>::new();
    for item in &selected {
        unique
            .entry(format!("{}.{}", item.sha256, item.extension))
            .or_insert(item);
    }
    let mut files = Vec::new();
    let mut payloads = Vec::new();
    let mut offset = 0_u64;
    let mut path_by_blob = HashMap::new();
    for (blob, item) in unique {
        let path = format!("assets/{blob}");
        let bytes = read_bounded(
            &draft_dir(root, &draft.draft_id)?.join("blobs").join(&blob),
            8 * 1024 * 1024,
        )?;
        let file = if matches!(item.mime.as_str(), "image/png" | "image/gif") {
            asset_mods::ManifestFileV2::Image(asset_mods::ManifestImageFileV2 {
                path: path.clone(),
                mime: item.mime.clone(),
                offset,
                length: bytes.len(),
                sha256: item.sha256.clone(),
                width: item.width.ok_or_else(draft_error)?,
                height: item.height.ok_or_else(draft_error)?,
            })
        } else {
            asset_mods::ManifestFileV2::Audio(asset_mods::ManifestAudioFileV2 {
                path: path.clone(),
                mime: item.mime.clone(),
                offset,
                length: bytes.len(),
                sha256: item.sha256.clone(),
                duration_ms: item.duration_ms.ok_or_else(draft_error)?,
                channels: item.channels.ok_or_else(draft_error)?,
                sample_rate: item.sample_rate.ok_or_else(draft_error)?,
            })
        };
        offset = add_pack_payload_budget(offset, bytes.len())?;
        path_by_blob.insert(blob, path);
        files.push(file);
        payloads.push(bytes);
    }
    let mut capabilities = asset_mods::CapabilitiesV2::default();
    for item in selected {
        let path = path_by_blob[&format!("{}.{}", item.sha256, item.extension)].clone();
        match &item.target {
            DraftTarget::SkillIcon {
                skill,
                position_id,
                side,
            } => capabilities.skill_icons.push(asset_mods::SkillBindingV2 {
                skill: skill.clone(),
                position_id: position_id.clone(),
                side: *side,
                path,
            }),
            DraftTarget::PlayerSprite {
                team_id,
                position_id,
                side,
            } => capabilities
                .player_sprites
                .push(asset_mods::SpriteBindingV2 {
                    team_id: team_id.clone(),
                    position_id: position_id.clone(),
                    side: *side,
                    path,
                }),
            DraftTarget::WalkSheet {
                team_id,
                position_id,
                side,
            } => {
                let spec = item.walk_sheet_spec.as_ref().ok_or_else(draft_error)?;
                capabilities
                    .walk_sheets
                    .push(asset_mods::WalkSheetBindingV2 {
                        team_id: team_id.clone(),
                        position_id: position_id.clone(),
                        side: *side,
                        path,
                        frame: spec.frame,
                        rows: spec.rows.clone(),
                        columns: spec.columns,
                        idle_column: spec.idle_column,
                        fps: spec.fps,
                        foot_y: spec.foot_y,
                    });
            }
            DraftTarget::SoundEvent { event_id } => {
                capabilities.sound_events.push(asset_mods::SoundBindingV2 {
                    event_id: event_id.clone(),
                    path,
                })
            }
            DraftTarget::TeamLogo { race } => {
                capabilities.team_logos.push(asset_mods::LogoBindingV2 {
                    race: race.clone(),
                    path,
                })
            }
            DraftTarget::BlockDie { face } => {
                capabilities.block_dice.push(asset_mods::BlockDieBindingV2 {
                    face: face.clone(),
                    path,
                })
            }
            DraftTarget::PitchImage { theme_id, weather } => {
                capabilities.pitch_images.push(asset_mods::PitchBindingV2 {
                    theme_id: theme_id.clone(),
                    weather: weather.clone(),
                    path,
                })
            }
        }
    }
    capabilities.skill_icons.sort_by(|a, b| {
        a.skill
            .cmp(&b.skill)
            .then(a.position_id.cmp(&b.position_id))
            .then(format!("{:?}", a.side).cmp(&format!("{:?}", b.side)))
    });
    capabilities.player_sprites.sort_by(|a, b| {
        a.team_id
            .cmp(&b.team_id)
            .then(a.position_id.cmp(&b.position_id))
            .then(a.side.cmp(&b.side))
    });
    capabilities.walk_sheets.sort_by(|a, b| {
        a.team_id
            .cmp(&b.team_id)
            .then(a.position_id.cmp(&b.position_id))
            .then(a.side.cmp(&b.side))
    });
    capabilities
        .sound_events
        .sort_by(|a, b| a.event_id.cmp(&b.event_id));
    capabilities.team_logos.sort_by(|a, b| a.race.cmp(&b.race));
    capabilities.block_dice.sort_by(|a, b| a.face.cmp(&b.face));
    capabilities
        .pitch_images
        .sort_by(|a, b| a.theme_id.cmp(&b.theme_id).then(a.weather.cmp(&b.weather)));
    let mut versions = BTreeMap::new();
    if !capabilities.skill_icons.is_empty() {
        versions.insert("skill-icons".into(), 2);
    }
    if !capabilities.player_sprites.is_empty() {
        versions.insert("player-sprites".into(), 1);
    }
    if !capabilities.walk_sheets.is_empty() {
        versions.insert("walk-sheets".into(), 1);
    }
    if !capabilities.sound_events.is_empty() {
        versions.insert("sound-events".into(), 1);
    }
    if !capabilities.pitch_images.is_empty() {
        versions.insert("pitch-images".into(), 1);
    }
    if !capabilities.team_logos.is_empty() {
        versions.insert("team-logos".into(), 1);
    }
    if !capabilities.block_dice.is_empty() {
        versions.insert("block-dice".into(), 1);
    }
    let manifest = asset_mods::ManifestV2 {
        pack_format: "F40KMOD1".into(),
        schema_version: 2,
        pack_id: draft.pack_id.clone(),
        version: draft.version.clone(),
        client_api: asset_mods::ClientApi { min: 1, max: 1 },
        capability_versions: versions,
        name: draft.name.clone(),
        source: "User-created local assets".into(),
        redistribution: "local-unverified".into(),
        _ignored_precedence_metadata: None,
        capabilities,
        files,
        signature: serde_json::Value::Null,
    };
    asset_mods::encode_pack(&manifest, &payloads)
}

#[tauri::command]
pub fn asset_draft_export(
    app: tauri::AppHandle,
    draft_id: String,
    section: DraftSection,
    destination_path: String,
) -> Result<asset_mods::InspectedAssetPack, String> {
    let root = root_dir(&app)?;
    let _lock = asset_mods::lock_storage(&root)?;
    let draft = load_draft(&root, &draft_id)?;
    let bytes = compile_pack(&root, &draft, section)?;
    let destination = Path::new(&destination_path);
    asset_mods::export_pack_atomic(destination, &bytes)?;
    drop(bytes);
    asset_mods::inspect_asset_pack(destination_path)
}

#[tauri::command]
pub fn asset_draft_apply(
    app: tauri::AppHandle,
    draft_id: String,
    section: DraftSection,
) -> Result<asset_mods::InstalledAssetPack, String> {
    let root = root_dir(&app)?;
    let bytes = {
        let _lock = asset_mods::lock_storage(&root)?;
        let draft = load_draft(&root, &draft_id)?;
        compile_pack(&root, &draft, section)?
    };
    asset_mods::install_pack_bytes(&app, bytes)
}

fn user_override_target(kind: UserOverrideKind, key: &str) -> Result<DraftTarget, String> {
    match kind {
        UserOverrideKind::Sprite => {
            let parts: Vec<_> = key.split('/').collect();
            if parts.len() != 3 {
                return Err(draft_error());
            }
            let side = match parts[2] {
                "any" => asset_mods::AssetSide::Any,
                "home" => asset_mods::AssetSide::Home,
                "away" => asset_mods::AssetSide::Away,
                _ => return Err(draft_error()),
            };
            let target = DraftTarget::PlayerSprite {
                team_id: parts[0].into(),
                position_id: parts[1].into(),
                side,
            };
            validate_target(&target)?;
            Ok(target)
        }
        UserOverrideKind::Sound => {
            let target = DraftTarget::SoundEvent {
                event_id: key.into(),
            };
            validate_target(&target)?;
            Ok(target)
        }
        UserOverrideKind::Logo => {
            let target = DraftTarget::TeamLogo { race: key.into() };
            validate_target(&target)?;
            Ok(target)
        }
        UserOverrideKind::BlockDie => {
            let target = DraftTarget::BlockDie { face: key.into() };
            validate_target(&target)?;
            Ok(target)
        }
    }
}

fn normalize_user_override_bytes(
    kind: UserOverrideKind,
    bytes: Vec<u8>,
    extension: &str,
) -> Result<UserOverrideMedia, String> {
    let extension = extension.to_ascii_lowercase();
    match kind {
        UserOverrideKind::Sprite | UserOverrideKind::Logo if extension == "png" => {
            asset_media::normalize_image_bytes(
                bytes,
                matches!(kind, UserOverrideKind::Sprite),
                asset_media::Scaling::Nearest,
            )
            .map(UserOverrideMedia::Image)
        }
        UserOverrideKind::BlockDie if extension == "png" => {
            asset_media::normalize_block_die_image_bytes(bytes).map(UserOverrideMedia::Image)
        }
        UserOverrideKind::Sound if matches!(extension.as_str(), "ogg" | "wav" | "mp3") => {
            asset_media::normalize_sound_bytes(bytes, &extension).map(UserOverrideMedia::Sound)
        }
        _ => Err(draft_error()),
    }
}

enum UserOverrideMedia {
    Image(asset_media::NormalizedImage),
    Sound(asset_media::NormalizedSound),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserOverrideWriteResult {
    binding_id: String,
    pack: asset_mods::InstalledAssetPack,
}

fn load_or_create_user_files(root: &Path) -> Result<DraftFile, String> {
    let path = draft_dir(root, USER_FILES_DRAFT_ID)?;
    if path.exists() {
        load_draft(root, USER_FILES_DRAFT_ID)
    } else {
        if root_usage(root)?.0 >= MAX_DRAFTS {
            return Err("Asset draft storage limit reached".into());
        }
        new_draft(root, USER_FILES_DRAFT_ID.into(), "Your files".into())
    }
}

fn compile_optional_user_pack(root: &Path, draft: &DraftFile) -> Result<Option<Vec<u8>>, String> {
    if draft.items.is_empty() {
        Ok(None)
    } else {
        compile_pack(root, draft, DraftSection::Combined).map(Some)
    }
}

fn commit_user_files_draft(
    app: &tauri::AppHandle,
    root: &Path,
    previous: &DraftFile,
    next: &DraftFile,
) -> Result<Option<asset_mods::InstalledAssetPack>, String> {
    let previous_pack = compile_optional_user_pack(root, previous)?;
    let next_pack = match compile_optional_user_pack(root, next) {
        Ok(pack) => pack,
        Err(error) => {
            let _ = cleanup_orphan_blobs(root, previous);
            return Err(error);
        }
    };
    if let Err(error) = save_draft(root, next) {
        let _ = cleanup_orphan_blobs(root, previous);
        return Err(error);
    }
    let installed = match next_pack {
        Some(bytes) => asset_mods::install_pack_bytes(app, bytes).map(Some),
        None => asset_mods::remove_user_files_pack(app).map(|()| None),
    };
    match installed {
        Ok(pack) => {
            cleanup_orphan_blobs(root, next)?;
            Ok(pack)
        }
        Err(error) => {
            let _ = save_draft(root, previous);
            if let Some(bytes) = previous_pack {
                let _ = asset_mods::install_pack_bytes(app, bytes);
            } else {
                let _ = asset_mods::remove_user_files_pack(app);
            }
            let _ = cleanup_orphan_blobs(root, previous);
            Err(error)
        }
    }
}

#[tauri::command]
pub fn write_user_override(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
    kind: UserOverrideKind,
    target_key: String,
    extension: String,
) -> Result<UserOverrideWriteResult, String> {
    let target = user_override_target(kind, &target_key)?;
    let binding_id = target_binding_id(&target)?;
    let media = normalize_user_override_bytes(kind, bytes, &extension)?;
    let root = root_dir(&app)?;
    let _lock = asset_mods::lock_storage(&root)?;
    let mut draft = load_or_create_user_files(&root)?;
    let previous = draft.clone();
    match media {
        UserOverrideMedia::Image(image) => put_image_record(&root, &mut draft, target, image)?,
        UserOverrideMedia::Sound(sound) => {
            let DraftTarget::SoundEvent { event_id } = target else {
                return Err(draft_error());
            };
            ensure_blob_capacity(&root, &draft, &[(&sound.bytes, "wav")])?;
            put_sound_record(&root, &mut draft, event_id, sound)?;
        }
    }
    let pack = commit_user_files_draft(&app, &root, &previous, &draft)?.ok_or_else(draft_error)?;
    Ok(UserOverrideWriteResult { binding_id, pack })
}

#[tauri::command]
pub fn remove_user_override(
    app: tauri::AppHandle,
    kind: UserOverrideKind,
    target_key: String,
) -> Result<Option<asset_mods::InstalledAssetPack>, String> {
    let binding_id = target_binding_id(&user_override_target(kind, &target_key)?)?;
    let root = root_dir(&app)?;
    let _lock = asset_mods::lock_storage(&root)?;
    let mut draft = load_draft(&root, USER_FILES_DRAFT_ID)?;
    let previous = draft.clone();
    draft.items.remove(&binding_id).ok_or_else(draft_error)?;
    commit_user_files_draft(&app, &root, &previous, &draft)
}

fn decode_data_url(value: &str) -> Result<(Vec<u8>, &'static str), String> {
    if value.len() > 24 * 1024 * 1024 {
        return Err(draft_error());
    }
    let (header, encoded) = value.split_once(',').ok_or_else(draft_error)?;
    let extension = match header {
        "data:audio/ogg;base64" => "ogg",
        "data:audio/wav;base64" | "data:audio/x-wav;base64" => "wav",
        "data:audio/mpeg;base64" | "data:audio/mp3;base64" => "mp3",
        _ => return Err(draft_error()),
    };
    let decoded_len = encoded
        .len()
        .checked_mul(3)
        .and_then(|value| value.checked_div(4))
        .ok_or_else(draft_error)?;
    if decoded_len > 16 * 1024 * 1024 {
        return Err(draft_error());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| draft_error())?;
    Ok((bytes, extension))
}

#[tauri::command]
pub fn asset_draft_migrate_sound_overrides(
    app: tauri::AppHandle,
    overrides: HashMap<String, String>,
) -> Result<Option<DraftDetails>, String> {
    if overrides.is_empty() {
        return Ok(None);
    }
    if overrides.len() > 43
        || overrides
            .keys()
            .any(|key| !asset_mods::valid_sound_event_id(key))
    {
        return Err(draft_error());
    }
    let mut normalized = Vec::with_capacity(overrides.len());
    let mut ordered: Vec<_> = overrides.into_iter().collect();
    ordered.sort_by(|a, b| a.0.cmp(&b.0));
    for (event_id, value) in ordered {
        let (bytes, extension) = decode_data_url(&value)?;
        normalized.push((
            event_id,
            asset_media::normalize_sound_bytes(bytes, extension)?,
        ));
    }
    let root = root_dir(&app)?;
    let _lock = asset_mods::lock_storage(&root)?;
    let path = draft_dir(&root, MIGRATED_DRAFT_ID)?;
    let mut draft = if path.exists() {
        load_draft(&root, MIGRATED_DRAFT_ID)?
    } else {
        if root_usage(&root)?.0 >= MAX_DRAFTS {
            return Err("Asset draft storage limit reached".into());
        }
        new_draft(
            &root,
            MIGRATED_DRAFT_ID.into(),
            "Migrated custom sounds".into(),
        )?
    };
    let capacity: Vec<_> = normalized
        .iter()
        .map(|(_, sound)| (sound.bytes.as_slice(), "wav"))
        .collect();
    ensure_blob_capacity(&root, &draft, &capacity)?;
    let mut prospective: HashSet<String> = draft.items.keys().cloned().collect();
    for (event_id, _) in &normalized {
        prospective.insert(target_binding_id(&DraftTarget::SoundEvent {
            event_id: event_id.clone(),
        })?);
    }
    if prospective.len() > 4096 {
        return Err("Asset draft binding limit reached".into());
    }
    for (event_id, sound) in normalized {
        put_sound_record(&root, &mut draft, event_id, sound)?;
    }
    save_draft(&root, &draft)?;
    cleanup_orphan_blobs(&root, &draft)?;
    details(&app, &root, draft).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{Arc, Barrier},
        thread,
    };
    use tempfile::tempdir;

    fn png48() -> Vec<u8> {
        rgba_png(48, 48)
    }

    fn rgba_png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer
                .write_image_data(&vec![255; width as usize * height as usize * 4])
                .unwrap();
        }
        bytes
    }

    fn gif48() -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut bytes);
            encoder
                .encode_frame(image::Frame::new(image::RgbaImage::from_pixel(
                    48,
                    48,
                    image::Rgba([1, 2, 3, 255]),
                )))
                .unwrap();
        }
        bytes
    }

    fn walk_spec() -> asset_mods::WalkSheetSpecV1 {
        asset_mods::WalkSheetSpecV1 {
            frame: 64,
            rows: ["S", "SE", "E", "NE", "N", "NW", "W", "SW"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            columns: 9,
            idle_column: 0,
            fps: 10,
            foot_y: Some(58),
        }
    }

    fn walk_target() -> DraftTarget {
        DraftTarget::WalkSheet {
            team_id: "team-1".into(),
            position_id: "catcher".into(),
            side: asset_mods::AssetSide::Home,
        }
    }

    fn fixture_draft(root: &Path) -> DraftFile {
        let _lock = asset_mods::lock_storage(root).unwrap();
        let mut draft = new_draft(
            root,
            "00112233445566778899aabbccddeeff".into(),
            "Fixture".into(),
        )
        .unwrap();
        let bytes = png48();
        let target = DraftTarget::SkillIcon {
            skill: "Block".into(),
            position_id: None,
            side: asset_mods::AssetSide::Any,
        };
        let binding_id = target_binding_id(&target).unwrap();
        let sha = store_blob(root, &draft, &bytes, "png").unwrap();
        draft.items.insert(
            binding_id.clone(),
            DraftRecord {
                binding_id,
                target,
                sha256: sha,
                extension: "png".into(),
                mime: "image/png".into(),
                size_bytes: bytes.len(),
                width: Some(48),
                height: Some(48),
                duration_ms: None,
                channels: None,
                sample_rate: None,
                walk_sheet_spec: None,
            },
        );
        save_draft(root, &draft).unwrap();
        draft
    }

    #[test]
    fn binding_identity_is_target_not_file_content() {
        let target = DraftTarget::SoundEvent {
            event_id: "block".into(),
        };
        assert_eq!(
            target_binding_id(&target).unwrap(),
            target_binding_id(&target).unwrap()
        );
    }

    #[test]
    fn compile_payload_budget_fails_before_accumulating_an_oversize_pack() {
        assert_eq!(
            add_pack_payload_budget(0, asset_mods::MAX_PACK_V2_BYTES).unwrap(),
            asset_mods::MAX_PACK_V2_BYTES as u64
        );
        assert!(add_pack_payload_budget(asset_mods::MAX_PACK_V2_BYTES as u64, 1).is_err());
        assert!(add_pack_payload_budget(u64::MAX, 1).is_err());
    }

    #[test]
    fn draft_target_contract_is_camel_case_and_position_is_explicit() {
        let target: DraftTarget = serde_json::from_value(serde_json::json!({
            "kind":"skillIcon", "skill":"Block", "positionId":null, "side":"home"
        }))
        .unwrap();
        assert!(matches!(
            target,
            DraftTarget::SkillIcon {
                position_id: None,
                ..
            }
        ));
        assert!(serde_json::from_value::<DraftTarget>(serde_json::json!({
            "kind":"skillIcon", "skill":"Block", "side":"home"
        }))
        .is_err());
        let sprite: DraftTarget = serde_json::from_value(serde_json::json!({
            "kind":"playerSprite", "teamId":"42", "positionId":"7"
        }))
        .unwrap();
        assert!(
            matches!(sprite, DraftTarget::PlayerSprite { team_id, position_id, .. } if team_id == "42" && position_id == "7")
        );
        assert_eq!(
            serde_json::to_value(walk_target()).unwrap(),
            serde_json::json!({
                "kind":"walkSheet", "teamId":"team-1", "positionId":"catcher", "side":"home"
            })
        );
        assert!(matches!(
            serde_json::from_value::<DraftSection>(serde_json::json!("walk-sheets")).unwrap(),
            DraftSection::WalkSheets
        ));
        assert_eq!(
            serde_json::to_value(DraftSection::WalkSheets).unwrap(),
            serde_json::json!("walk-sheets")
        );
    }

    #[test]
    fn old_draft_record_json_roundtrips_byte_identically() {
        let old = br#"{"bindingId":"0123456789abcdef0123456789abcdef","target":{"kind":"skillIcon","skill":"Block","positionId":null,"side":"any"},"sha256":"0000000000000000000000000000000000000000000000000000000000000000","extension":"png","mime":"image/png","sizeBytes":1,"width":48,"height":48,"durationMs":null,"channels":null,"sampleRate":null}"#;
        let record: DraftRecord = serde_json::from_slice(old).unwrap();
        assert!(record.walk_sheet_spec.is_none());
        assert_eq!(serde_json::to_vec(&record).unwrap(), old);
    }

    #[test]
    fn walk_sheet_put_stores_exact_bytes_and_persists_spec() {
        let root = tempdir().unwrap();
        let _lock = asset_mods::lock_storage(root.path()).unwrap();
        let mut draft = new_draft(
            root.path(),
            "11112222333344445555666677778888".into(),
            "Walk fixture".into(),
        )
        .unwrap();
        let source = root.path().join("catcher.png");
        let bytes = rgba_png(576, 512);
        std::fs::write(&source, &bytes).unwrap();
        let spec = walk_spec();

        put_walk_sheet_record(
            root.path(),
            &mut draft,
            &source,
            walk_target(),
            Some(spec.clone()),
        )
        .unwrap();
        save_draft(root.path(), &draft).unwrap();

        let loaded = load_draft(root.path(), &draft.draft_id).unwrap();
        let record = loaded.items.values().next().unwrap();
        assert_eq!(record.walk_sheet_spec.as_ref(), Some(&spec));
        assert_eq!(record.width, Some(576));
        assert_eq!(record.height, Some(512));
        let stored = draft_dir(root.path(), &loaded.draft_id)
            .unwrap()
            .join("blobs")
            .join(format!("{}.png", record.sha256));
        assert_eq!(std::fs::read(stored).unwrap(), bytes);
    }

    #[test]
    fn walk_sheet_put_reads_fallback_sidecar() {
        let root = tempdir().unwrap();
        let _lock = asset_mods::lock_storage(root.path()).unwrap();
        let mut draft = new_draft(
            root.path(),
            "22223333444455556666777788889999".into(),
            "Sidecar fixture".into(),
        )
        .unwrap();
        let source = root.path().join("catcher.png");
        std::fs::write(&source, rgba_png(576, 512)).unwrap();
        let spec = walk_spec();
        std::fs::write(
            root.path().join("walk-sheet-64.json"),
            serde_json::to_vec(&spec).unwrap(),
        )
        .unwrap();

        put_walk_sheet_record(root.path(), &mut draft, &source, walk_target(), None).unwrap();
        assert_eq!(
            draft
                .items
                .values()
                .next()
                .unwrap()
                .walk_sheet_spec
                .as_ref(),
            Some(&spec)
        );
    }

    #[test]
    fn walk_sheet_put_rejects_gif_without_storing_a_blob() {
        let root = tempdir().unwrap();
        let _lock = asset_mods::lock_storage(root.path()).unwrap();
        let mut draft = new_draft(
            root.path(),
            "3333444455556666777788889999aaaa".into(),
            "Rejected GIF".into(),
        )
        .unwrap();
        let source = root.path().join("catcher.gif");
        std::fs::write(&source, gif48()).unwrap();

        let error = put_walk_sheet_record(
            root.path(),
            &mut draft,
            &source,
            walk_target(),
            Some(walk_spec()),
        )
        .unwrap_err();
        assert!(error.contains("walk sheets must be PNG"), "{error}");
        assert!(draft.items.is_empty());
        assert_eq!(
            std::fs::read_dir(
                draft_dir(root.path(), &draft.draft_id)
                    .unwrap()
                    .join("blobs")
            )
            .unwrap()
            .count(),
            0
        );
    }

    #[test]
    fn walk_sheet_compile_requires_spec_and_emits_flat_manifest_row() {
        let root = tempdir().unwrap();
        let _lock = asset_mods::lock_storage(root.path()).unwrap();
        let mut draft = new_draft(
            root.path(),
            "444455556666777788889999aaaabbbb".into(),
            "Compile fixture".into(),
        )
        .unwrap();
        let source = root.path().join("catcher.png");
        let bytes = rgba_png(576, 512);
        std::fs::write(&source, &bytes).unwrap();
        let spec = walk_spec();
        put_walk_sheet_record(
            root.path(),
            &mut draft,
            &source,
            walk_target(),
            Some(spec.clone()),
        )
        .unwrap();

        let binding_id = draft.items.keys().next().unwrap().clone();
        draft.items.get_mut(&binding_id).unwrap().walk_sheet_spec = None;
        assert!(compile_pack(root.path(), &draft, DraftSection::WalkSheets).is_err());
        draft.items.get_mut(&binding_id).unwrap().walk_sheet_spec = Some(spec);

        let packed = compile_pack(root.path(), &draft, DraftSection::WalkSheets).unwrap();
        assert!(asset_mods::inspect_pack_bytes(packed.clone()).is_ok());
        let manifest_len = u32::from_le_bytes(packed[8..12].try_into().unwrap()) as usize;
        let manifest: serde_json::Value =
            serde_json::from_slice(&packed[12..12 + manifest_len]).unwrap();
        let record = &draft.items[&binding_id];
        assert_eq!(manifest["capabilityVersions"]["walk-sheets"], 1);
        assert_eq!(
            manifest["capabilities"]["walk-sheets"][0],
            serde_json::json!({
                "teamId":"team-1",
                "positionId":"catcher",
                "side":"home",
                "path":format!("assets/{}.png", record.sha256),
                "frame":64,
                "rows":["S","SE","E","NE","N","NW","W","SW"],
                "columns":9,
                "idleColumn":0,
                "fps":10,
                "footY":58
            })
        );
    }

    #[test]
    fn data_url_gate_is_closed_and_bounded() {
        assert!(decode_data_url("data:text/plain;base64,AAAA").is_err());
        assert!(decode_data_url("data:audio/wav,AAAA").is_err());
        let (bytes, kind) = decode_data_url("data:audio/wav;base64,AAAA").unwrap();
        assert_eq!(bytes, [0, 0, 0]);
        assert_eq!(kind, "wav");
    }

    #[test]
    fn section_export_is_deterministic_and_production_validated() {
        let root = tempdir().unwrap();
        let draft = fixture_draft(root.path());
        let first = compile_pack(root.path(), &draft, DraftSection::SkillIcons).unwrap();
        let second = compile_pack(root.path(), &draft, DraftSection::SkillIcons).unwrap();
        assert_eq!(first, second);
        assert!(asset_mods::inspect_pack_bytes(first).is_ok());
        assert!(compile_pack(root.path(), &draft, DraftSection::SoundEvents).is_err());
    }

    #[test]
    fn draft_compiler_preserves_native_gif_payload_and_mime() {
        let root = tempdir().unwrap();
        let _lock = asset_mods::lock_storage(root.path()).unwrap();
        let mut draft = new_draft(
            root.path(),
            "ffeeddccbbaa99887766554433221100".into(),
            "GIF fixture".into(),
        )
        .unwrap();
        let bytes = gif48();
        let target = DraftTarget::SkillIcon {
            skill: "Block".into(),
            position_id: None,
            side: asset_mods::AssetSide::Any,
        };
        let binding_id = target_binding_id(&target).unwrap();
        let sha = store_blob(root.path(), &draft, &bytes, "gif").unwrap();
        draft.items.insert(
            binding_id.clone(),
            DraftRecord {
                binding_id,
                target,
                sha256: sha,
                extension: "gif".into(),
                mime: "image/gif".into(),
                size_bytes: bytes.len(),
                width: Some(48),
                height: Some(48),
                duration_ms: None,
                channels: None,
                sample_rate: None,
                walk_sheet_spec: None,
            },
        );
        let packed = compile_pack(root.path(), &draft, DraftSection::SkillIcons).unwrap();
        assert!(asset_mods::inspect_pack_bytes(packed).is_ok());
    }

    #[test]
    fn pitch_section_supports_weather_targets_and_combined_export() {
        let root = tempdir().unwrap();
        let _lock = asset_mods::lock_storage(root.path()).unwrap();
        let mut draft = new_draft(
            root.path(),
            "102132435465768798a9bacbdcedfe0f".into(),
            "Pitch fixture".into(),
        )
        .unwrap();
        let bytes = rgba_png(782, 452);
        let target = DraftTarget::PitchImage {
            theme_id: "fumbbl-default".into(),
            weather: "rain".into(),
        };
        let binding_id = target_binding_id(&target).unwrap();
        let sha = store_blob(root.path(), &draft, &bytes, "png").unwrap();
        draft.items.insert(
            binding_id.clone(),
            DraftRecord {
                binding_id,
                target,
                sha256: sha,
                extension: "png".into(),
                mime: "image/png".into(),
                size_bytes: bytes.len(),
                width: Some(782),
                height: Some(452),
                duration_ms: None,
                channels: None,
                sample_rate: None,
                walk_sheet_spec: None,
            },
        );
        let pitch = compile_pack(root.path(), &draft, DraftSection::PitchImages).unwrap();
        let combined = compile_pack(root.path(), &draft, DraftSection::Combined).unwrap();
        assert!(asset_mods::inspect_pack_bytes(pitch).is_ok());
        assert!(asset_mods::inspect_pack_bytes(combined).is_ok());
    }

    #[test]
    fn stale_manifest_temp_never_shadows_committed_draft() {
        let root = tempdir().unwrap();
        let draft = fixture_draft(root.path());
        let dir = draft_dir(root.path(), &draft.draft_id).unwrap();
        std::fs::write(dir.join(".draft.json.tmp"), b"{truncated").unwrap();
        let loaded = load_draft(root.path(), &draft.draft_id).unwrap();
        assert_eq!(loaded.items.len(), 1);
        save_draft(root.path(), &loaded).unwrap();
        assert!(!dir.join(".draft.json.tmp").exists());
    }

    #[test]
    fn interrupted_create_and_delete_staging_is_recovered_link_safely() {
        let root = tempdir().unwrap();
        let _lock = asset_mods::lock_storage(root.path()).unwrap();
        let create = root
            .path()
            .join(".create-11112222333344445555666677778888.tmp");
        std::fs::create_dir(&create).unwrap();
        std::fs::create_dir(create.join("blobs")).unwrap();
        std::fs::write(create.join("draft.json"), b"partial").unwrap();
        let delete = root
            .path()
            .join(".delete-99990000aaaabbbbccccddddeeeeffff.tmp");
        std::fs::create_dir(&delete).unwrap();
        std::fs::create_dir(delete.join("blobs")).unwrap();
        std::fs::write(delete.join("draft.json"), b"old").unwrap();
        assert_eq!(root_usage(root.path()).unwrap(), (0, 0));
        assert!(!create.exists());
        assert!(!delete.exists());
    }

    #[test]
    fn concurrent_draft_writes_are_serialized_and_remain_parseable() {
        let root = tempdir().unwrap();
        let draft = fixture_draft(root.path());
        let barrier = Arc::new(Barrier::new(4));
        let threads: Vec<_> = (0..4)
            .map(|index| {
                let root = root.path().to_path_buf();
                let id = draft.draft_id.clone();
                let barrier = barrier.clone();
                thread::spawn(move || {
                    barrier.wait();
                    let _lock = asset_mods::lock_storage(&root).unwrap();
                    let mut current = load_draft(&root, &id).unwrap();
                    current.name = format!("Writer {index}");
                    save_draft(&root, &current).unwrap();
                })
            })
            .collect();
        for handle in threads {
            handle.join().unwrap();
        }
        let loaded = load_draft(root.path(), &draft.draft_id).unwrap();
        assert!(loaded.name.starts_with("Writer "));
        assert_eq!(loaded.items.len(), 1);
    }

    #[test]
    fn user_override_bytes_reject_bad_magic_and_source_size_cap() {
        assert!(normalize_user_override_bytes(
            UserOverrideKind::Sprite,
            b"not a png".to_vec(),
            "png",
        )
        .is_err());
        assert!(normalize_user_override_bytes(
            UserOverrideKind::Sound,
            b"not an ogg".to_vec(),
            "ogg",
        )
        .is_err());
        assert!(normalize_user_override_bytes(
            UserOverrideKind::Logo,
            vec![0; asset_media::MAX_SOURCE_BYTES + 1],
            "png",
        )
        .is_err());
    }

    #[test]
    fn combined_export_contract_accepts_team_logo_binding() {
        let root = tempdir().unwrap();
        let mut draft = fixture_draft(root.path());
        let image =
            asset_media::normalize_image_bytes(png48(), false, asset_media::Scaling::Nearest)
                .unwrap();
        put_image_record(
            root.path(),
            &mut draft,
            DraftTarget::TeamLogo {
                race: "human".into(),
            },
            image,
        )
        .unwrap();
        let bytes = compile_pack(root.path(), &draft, DraftSection::Combined).unwrap();
        assert!(asset_mods::inspect_pack_bytes(bytes).is_ok());
    }

    #[test]
    fn block_die_draft_compiles_and_imports_as_a_valid_pack() {
        let root = tempdir().unwrap();
        let mut draft = fixture_draft(root.path());
        let image = asset_media::normalize_block_die_image_bytes(rgba_png(35, 35)).unwrap();
        put_image_record(
            root.path(),
            &mut draft,
            DraftTarget::BlockDie {
                face: "skull".into(),
            },
            image,
        )
        .unwrap();
        let bytes = compile_pack(root.path(), &draft, DraftSection::BlockDice).unwrap();
        assert!(asset_mods::inspect_pack_bytes(bytes).is_ok());
    }
}
