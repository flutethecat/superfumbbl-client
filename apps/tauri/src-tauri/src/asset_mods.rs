use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{File, OpenOptions},
    io::{Cursor, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Manager, Runtime};

use crate::asset_media;

const MAGIC: &[u8; 8] = b"F40KMOD1";
const MAX_MANIFEST_BYTES: usize = 1024 * 1024;
const MAX_PACK_V1_BYTES: usize = 128 * 1024 * 1024 + MAX_MANIFEST_BYTES + 12;
pub(crate) const MAX_PACK_V2_BYTES: usize = 32 * 1024 * 1024;
const MAX_PACK_BYTES: usize = MAX_PACK_V1_BYTES;
const MAX_FILE_BYTES: usize = 4 * 1024 * 1024;
const MAX_AUDIO_FILE_BYTES: usize = 8 * 1024 * 1024;
const MAX_FILES: usize = 4096; // owner 09-05: the FUMBBL Original 1.7.0 tester pack (all Secret League iconsets + logos) carries 2306 files
const MAX_BINDINGS: usize = 4096;
const MAX_INSTALLED_PACKS: usize = 32;
const MAX_INSTALLED_BYTES: usize = 512 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 16_777_216;
const MAX_TOTAL_PIXELS: u64 = 134_217_728; // 09-05: headroom for the 2300-file tester pack (57.6 Mpx)
const MAX_TOTAL_DECODED_BYTES: usize = 512 * 1024 * 1024; // 09-05: 1.7.0 decodes to 230 MB
const MAX_GIF_FRAMES: usize = 128;
const CLIENT_API: u16 = 1;
const LOCK_FILE: &str = ".asset-pack-install.lock";
pub(crate) const USER_FILES_PACK_ID: &str = "local.user.596f757246696c657300000000000001";
pub(crate) const USER_FILES_INSTALL_ID: &str = "596f757246696c657300000000000001";
static TEMP_NONCE: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct AssetPackState {
    installed: Mutex<HashMap<String, AssetLocation>>,
    drafts: Mutex<HashMap<String, AssetLocation>>,
    known_installs: Mutex<HashSet<String>>,
    leases: Mutex<HashSet<String>>,
    lifecycle: Mutex<()>,
}

#[derive(Clone)]
pub(crate) struct AssetLocation {
    container: PathBuf,
    offset: u64,
    length: usize,
    mime: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Manifest {
    pack_format: String,
    schema_version: u8,
    pack_id: String,
    version: String,
    client_api: ClientApi,
    capability_versions: HashMap<String, u8>,
    name: String,
    source: String,
    redistribution: String,
    // Compatibility-only input. Older pack builders emitted provider/precedence
    // claims here. The client deliberately neither validates nor publishes nor
    // acts on that metadata; activation is controlled by the user's selections.
    #[serde(default, rename = "upstreamPolicy")]
    _ignored_precedence_metadata: Option<serde_json::Value>,
    capabilities: HashMap<String, HashMap<String, String>>,
    files: Vec<ManifestFile>,
    signature: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ClientApi {
    pub min: u16,
    pub max: u16,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestFile {
    path: String,
    mime: String,
    offset: u64,
    length: usize,
    sha256: String,
    width: u32,
    height: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ManifestV2 {
    pub pack_format: String,
    pub schema_version: u8,
    pub pack_id: String,
    pub version: String,
    pub client_api: ClientApi,
    pub capability_versions: BTreeMap<String, u8>,
    pub name: String,
    pub source: String,
    pub redistribution: String,
    // Tolerate the retired field when importing an older pack, but never write
    // it into newly exported packs and never expose it to the runtime.
    #[serde(default, rename = "upstreamPolicy", skip_serializing)]
    pub _ignored_precedence_metadata: Option<serde_json::Value>,
    pub capabilities: CapabilitiesV2,
    pub files: Vec<ManifestFileV2>,
    pub signature: serde_json::Value,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub(crate) struct CapabilitiesV2 {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skill_icons: Vec<SkillBindingV2>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub player_sprites: Vec<SpriteBindingV2>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sound_events: Vec<SoundBindingV2>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pitch_images: Vec<PitchBindingV2>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub walk_sheets: Vec<WalkSheetBindingV2>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub team_logos: Vec<LogoBindingV2>,
    #[serde(default, rename = "block-dice", skip_serializing_if = "Vec::is_empty")]
    pub block_dice: Vec<BlockDieBindingV2>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct BlockDieBindingV2 {
    pub face: String,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct LogoBindingV2 {
    pub race: String,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SkillBindingV2 {
    pub skill: String,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub position_id: Option<String>,
    pub side: AssetSide,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SpriteBindingV2 {
    pub team_id: String,
    pub position_id: String,
    #[serde(default)]
    pub side: AssetSide,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct WalkSheetBindingV2 {
    pub team_id: String,
    pub position_id: String,
    pub side: AssetSide,
    pub path: String,
    pub frame: u8,
    pub rows: Vec<String>,
    pub columns: u8,
    pub idle_column: u8,
    pub fps: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub foot_y: Option<u8>,
}

impl WalkSheetBindingV2 {
    fn spec(&self) -> WalkSheetSpecV1 {
        WalkSheetSpecV1 {
            frame: self.frame,
            rows: self.rows.clone(),
            columns: self.columns,
            idle_column: self.idle_column,
            fps: self.fps,
            foot_y: self.foot_y,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct WalkSheetSpecV1 {
    pub frame: u8,
    pub rows: Vec<String>,
    pub columns: u8,
    pub idle_column: u8,
    pub fps: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub foot_y: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SoundBindingV2 {
    pub event_id: String,
    pub path: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AssetSide {
    Any,
    Home,
    Away,
}

impl Default for AssetSide {
    fn default() -> Self {
        Self::Any
    }
}

pub(crate) fn deserialize_required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub(crate) enum ManifestFileV2 {
    Image(ManifestImageFileV2),
    Audio(ManifestAudioFileV2),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ManifestImageFileV2 {
    pub path: String,
    pub mime: String,
    pub offset: u64,
    pub length: usize,
    pub sha256: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct ManifestAudioFileV2 {
    pub path: String,
    pub mime: String,
    pub offset: u64,
    pub length: usize,
    pub sha256: String,
    pub duration_ms: u32,
    pub channels: u8,
    pub sample_rate: u32,
}

struct ValidatedPack {
    manifest: Manifest,
    schema2: Option<ManifestV2>,
    payload_start: u64,
    bytes: Vec<u8>,
    digest: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAssetPack {
    install_id: String,
    pack_id: String,
    version: String,
    name: String,
    source: String,
    redistribution: String,
    verified_publisher: bool,
    size_bytes: usize,
    capabilities: Vec<String>,
    coverage: HashMap<String, usize>,
    skill_icons: HashMap<String, String>,
    classic_image_bindings: HashMap<String, String>,
    /// Owner 2026-09-05: the `fumbbl-id-images` subset (team logos) on its own, so the client can serve
    /// logos from ANY installed pack while player iconsheets stay bound to the selected sprite pack.
    logo_image_bindings: HashMap<String, String>,
    block_dice_bindings: HashMap<String, String>,
    pitch_image_bindings: HashMap<String, String>,
    capability_versions: BTreeMap<String, u8>,
    skill_icon_bindings: Vec<InstalledSkillBinding>,
    player_sprite_bindings: Vec<InstalledSpriteBinding>,
    sound_event_bindings: Vec<InstalledSoundBinding>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    walk_sheet_bindings: Vec<InstalledWalkSheetBinding>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkillBinding {
    skill: String,
    canonical_skill: String,
    position_id: Option<String>,
    side: AssetSide,
    url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSpriteBinding {
    team_id: String,
    position_id: String,
    side: AssetSide,
    url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSoundBinding {
    event_id: String,
    url: String,
}

#[derive(Clone, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InstalledWalkSheetBinding {
    team_id: String,
    position_id: String,
    side: AssetSide,
    url: String,
    frame: u8,
    rows: Vec<String>,
    columns: u8,
    idle_column: u8,
    fps: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    foot_y: Option<u8>,
}

impl InstalledWalkSheetBinding {
    #[allow(dead_code)]
    fn spec(&self) -> WalkSheetSpecV1 {
        WalkSheetSpecV1 {
            frame: self.frame,
            rows: self.rows.clone(),
            columns: self.columns,
            idle_column: self.idle_column,
            fps: self.fps,
            foot_y: self.foot_y,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectedAssetPack {
    schema_version: u8,
    pack_id: String,
    version: String,
    name: String,
    source: String,
    redistribution: String,
    size_bytes: usize,
    whole_pack_sha256: String,
    capabilities: Vec<String>,
    coverage: HashMap<String, usize>,
    capability_versions: BTreeMap<String, u8>,
}

fn generic_error() -> String {
    "Asset pack is invalid or unsupported".into()
}
fn storage_error() -> String {
    "Asset pack storage is unavailable".into()
}

fn normalize_key(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

const SKILL_ICON_ALIASES_JSON: &str =
    include_str!("../../../../packages/ffb-pitch/src/skillIconAliases.json");
const SOUND_EVENT_IDS_JSON: &str = include_str!("../../src/game/soundEventIds.json");

fn skill_icon_aliases() -> Option<&'static HashMap<String, String>> {
    static ALIASES: OnceLock<Option<HashMap<String, String>>> = OnceLock::new();
    ALIASES
        .get_or_init(|| {
            let aliases: HashMap<String, String> =
                serde_json::from_str(SKILL_ICON_ALIASES_JSON).ok()?;
            aliases
                .iter()
                .all(|(key, value)| {
                    !key.is_empty()
                        && key == &normalize_key(key)
                        && !value.is_empty()
                        && value == &normalize_key(value)
                })
                .then_some(aliases)
        })
        .as_ref()
}

pub(crate) fn canonical_skill_key(value: &str) -> Option<String> {
    if !valid_printable_label(value, 96) {
        return None;
    }
    let normalized = normalize_key(value);
    if normalized.is_empty() {
        return None;
    }
    let aliases = skill_icon_aliases()?;
    Some(aliases.get(&normalized).cloned().unwrap_or(normalized))
}

fn sound_event_ids() -> Option<&'static HashSet<String>> {
    static IDS: OnceLock<Option<HashSet<String>>> = OnceLock::new();
    IDS.get_or_init(|| {
        let values: Vec<String> = serde_json::from_str(SOUND_EVENT_IDS_JSON).ok()?;
        let ids: HashSet<_> = values.iter().cloned().collect();
        (ids.len() == 45
            && ids.len() == values.len()
            && values.iter().all(|value| valid_sound_event_syntax(value)))
        .then_some(ids)
    })
    .as_ref()
}

fn valid_printable_label(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && value.trim() == value
        && value.bytes().all(|byte| (0x20..=0x7e).contains(&byte))
}

fn safe_internal_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 240
        && value.is_ascii()
        && !value.starts_with('/')
        && !value.contains('\\')
        && !value.contains("//")
        && value.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
        })
}

fn valid_pack_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value.split(['.', '-']).all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        })
}

fn valid_semver(value: &str) -> bool {
    if value.is_empty() || value.len() > 48 || !value.is_ascii() {
        return false;
    }
    let (without_build, build) = value
        .split_once('+')
        .map_or((value, None), |(left, right)| (left, Some(right)));
    if without_build.contains('+') || build.is_some_and(|part| part.contains('+')) {
        return false;
    }
    let (core, prerelease) = without_build
        .split_once('-')
        .map_or((without_build, None), |(left, right)| (left, Some(right)));
    let core_parts: Vec<_> = core.split('.').collect();
    if core_parts.len() != 3
        || core_parts.iter().any(|part| {
            part.is_empty()
                || !part.bytes().all(|byte| byte.is_ascii_digit())
                || (part.len() > 1 && part.starts_with('0'))
                || part.parse::<u64>().is_err()
        })
    {
        return false;
    }
    let valid_identifier = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    };
    if prerelease.is_some_and(|value| {
        value.split('.').any(|part| {
            !valid_identifier(part)
                || (part.bytes().all(|byte| byte.is_ascii_digit())
                    && part.len() > 1
                    && part.starts_with('0'))
        })
    }) {
        return false;
    }
    !build.is_some_and(|value| value.split('.').any(|part| !valid_identifier(part)))
}

fn is_lower_hex(value: &str, len: usize) -> bool {
    value.len() == len
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[cfg(windows)]
pub(crate) fn metadata_is_reparse(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x0000_0400 != 0
}
#[cfg(not(windows))]
pub(crate) fn metadata_is_reparse(metadata: &std::fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(windows)]
pub(crate) fn open_read_no_follow(path: &Path) -> std::io::Result<File> {
    super::open_no_follow(path)
}
#[cfg(unix)]
pub(crate) fn open_read_no_follow(path: &Path) -> std::io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
}
#[cfg(not(any(windows, unix)))]
pub(crate) fn open_read_no_follow(path: &Path) -> std::io::Result<File> {
    File::open(path)
}

#[cfg(windows)]
pub(crate) fn open_write_no_follow(path: &Path, create_new: bool) -> std::io::Result<File> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(!create_new)
        .create_new(create_new)
        .custom_flags(0x0020_0000)
        .open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.file_attributes() & 0x0000_0400 != 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "reparse point",
        ));
    }
    Ok(file)
}
#[cfg(unix)]
pub(crate) fn open_write_no_follow(path: &Path, create_new: bool) -> std::io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(!create_new)
        .create_new(create_new)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
}
#[cfg(not(any(windows, unix)))]
pub(crate) fn open_write_no_follow(path: &Path, create_new: bool) -> std::io::Result<File> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(!create_new)
        .create_new(create_new)
        .open(path)
}

fn read_pack(path: &Path) -> Result<Vec<u8>, String> {
    if path
        .extension()
        .and_then(|x| x.to_str())
        .map(|x| !x.eq_ignore_ascii_case("f40kmod"))
        .unwrap_or(true)
    {
        return Err(generic_error());
    }
    let before = std::fs::symlink_metadata(path).map_err(|_| generic_error())?;
    if !before.is_file() || metadata_is_reparse(&before) {
        return Err(generic_error());
    }
    let mut file = open_read_no_follow(path).map_err(|_| generic_error())?;
    let opened = file.metadata().map_err(|_| generic_error())?;
    if !opened.is_file() || metadata_is_reparse(&opened) || opened.len() > MAX_PACK_BYTES as u64 {
        return Err(generic_error());
    }
    let mut header = [0_u8; 12];
    file.read_exact(&mut header).map_err(|_| generic_error())?;
    if &header[..8] != MAGIC {
        return Err(generic_error());
    }
    let manifest_len =
        u32::from_le_bytes(header[8..12].try_into().map_err(|_| generic_error())?) as usize;
    if manifest_len == 0 || manifest_len > MAX_MANIFEST_BYTES {
        return Err(generic_error());
    }
    let mut manifest = vec![0; manifest_len];
    file.read_exact(&mut manifest)
        .map_err(|_| generic_error())?;
    let header: serde_json::Value =
        serde_json::from_slice(&manifest).map_err(|_| generic_error())?;
    let limit = match header
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
    {
        Some(1) => MAX_PACK_V1_BYTES,
        Some(2) => MAX_PACK_V2_BYTES,
        _ => return Err(generic_error()),
    };
    if opened.len() > limit as u64 {
        return Err(generic_error());
    }
    file.seek(SeekFrom::Start(0)).map_err(|_| generic_error())?;
    let mut bytes = Vec::with_capacity(opened.len() as usize);
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| generic_error())?;
    if bytes.len() > limit || bytes.len() as u64 != opened.len() {
        return Err(generic_error());
    }
    Ok(bytes)
}

fn supported_png(info: &png::Info<'_>) -> bool {
    use png::{BitDepth as B, ColorType as C};
    matches!(
        (info.color_type, info.bit_depth),
        (C::Grayscale, B::One | B::Two | B::Four | B::Eight)
            | (C::Rgb, B::Eight)
            | (C::Indexed, B::One | B::Two | B::Four | B::Eight)
            | (C::GrayscaleAlpha, B::Eight)
            | (C::Rgba, B::Eight)
    )
}

pub(crate) fn static_png_framing_is_exact(bytes: &[u8]) -> bool {
    const PNG_MAGIC: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 20 || &bytes[..8] != PNG_MAGIC {
        return false;
    }
    let mut cursor = 8_usize;
    while cursor < bytes.len() {
        let Some(header_end) = cursor.checked_add(8) else {
            return false;
        };
        if header_end > bytes.len() {
            return false;
        }
        let length = u32::from_be_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as usize;
        let kind = &bytes[cursor + 4..cursor + 8];
        let Some(chunk_end) = header_end
            .checked_add(length)
            .and_then(|end| end.checked_add(4))
        else {
            return false;
        };
        if chunk_end > bytes.len() {
            return false;
        }
        // Presentation assets do not need compressed color profiles or text metadata. Reject
        // these before png::Decoder sees them: the decoder may inflate iCCP and compressed text
        // while reading headers, outside the decoded-pixel budget enforced below. Reject iTXt as
        // a class so acceptance never depends on parsing an attacker-controlled compression flag.
        if matches!(
            kind,
            b"acTL" | b"fcTL" | b"fdAT" | b"iCCP" | b"zTXt" | b"iTXt"
        ) {
            return false;
        }
        if kind == b"IEND" {
            return length == 0 && chunk_end == bytes.len();
        }
        cursor = chunk_end;
    }
    false
}

fn image_pixel_budget(files: &[ManifestFile]) -> Result<(), String> {
    let mut total = 0_u64;
    for file in files {
        if !matches!(file.mime.as_str(), "image/png" | "image/jpeg" | "image/gif") {
            continue;
        }
        let pixels = u64::from(file.width)
            .checked_mul(u64::from(file.height))
            .ok_or_else(generic_error)?;
        if file.width == 0 || file.height == 0 || pixels > MAX_IMAGE_PIXELS {
            return Err(generic_error());
        }
        total = total.checked_add(pixels).ok_or_else(generic_error)?;
        if total > MAX_TOTAL_PIXELS {
            return Err(generic_error());
        }
    }
    Ok(())
}

fn add_decoded_budget(total: &mut usize, next: usize) -> Result<(), String> {
    *total = total.checked_add(next).ok_or_else(generic_error)?;
    if next > MAX_IMAGE_PIXELS as usize * 4 || *total > MAX_TOTAL_DECODED_BYTES {
        return Err(generic_error());
    }
    Ok(())
}

pub(crate) fn validate_gif_file(
    bytes: &[u8],
    width: u32,
    height: u32,
    total_decoded: &mut usize,
) -> Result<(), String> {
    use image::{AnimationDecoder, ImageDecoder};

    if bytes.len() < 7
        || !matches!(&bytes[..6], b"GIF87a" | b"GIF89a")
        || bytes.last() != Some(&0x3b)
    {
        return Err(generic_error());
    }
    let decoder =
        image::codecs::gif::GifDecoder::new(Cursor::new(bytes)).map_err(|_| generic_error())?;
    if decoder.dimensions() != (width, height) {
        return Err(generic_error());
    }
    let expected_frame_bytes =
        usize::try_from(u64::from(width) * u64::from(height) * 4).map_err(|_| generic_error())?;
    let mut frames = 0_usize;
    for frame in decoder.into_frames() {
        let frame = frame.map_err(|_| generic_error())?;
        frames += 1;
        if frames > MAX_GIF_FRAMES || frame.buffer().as_raw().len() != expected_frame_bytes {
            return Err(generic_error());
        }
        add_decoded_budget(total_decoded, expected_frame_bytes)?;
    }
    if frames == 0 {
        return Err(generic_error());
    }
    Ok(())
}

fn manifest_slice(bytes: &[u8]) -> Result<(usize, &[u8]), String> {
    if bytes.len() < 13 || &bytes[..8] != MAGIC {
        return Err(generic_error());
    }
    let manifest_len =
        u32::from_le_bytes(bytes[8..12].try_into().map_err(|_| generic_error())?) as usize;
    let payload_start = 12_usize
        .checked_add(manifest_len)
        .ok_or_else(generic_error)?;
    if manifest_len == 0 || manifest_len > MAX_MANIFEST_BYTES || payload_start > bytes.len() {
        return Err(generic_error());
    }
    Ok((payload_start, &bytes[12..payload_start]))
}

fn validate_pack_v1(bytes: Vec<u8>) -> Result<ValidatedPack, String> {
    if bytes.len() > MAX_PACK_V1_BYTES {
        return Err(generic_error());
    }
    let (payload_start, manifest_bytes) = manifest_slice(&bytes)?;
    let manifest: Manifest = serde_json::from_slice(manifest_bytes).map_err(|_| generic_error())?;
    if manifest.pack_format != "F40KMOD1"
        || manifest.schema_version != 1
        || !valid_pack_id(&manifest.pack_id)
        || !valid_semver(&manifest.version)
        || manifest.name.trim().is_empty()
        || manifest.name.len() > 120
        || manifest.name.chars().any(char::is_control)
        || manifest.source.trim().is_empty()
        || manifest.source.len() > 240
        || manifest.source.chars().any(char::is_control)
        || manifest.client_api.min > manifest.client_api.max
        || !(manifest.client_api.min..=manifest.client_api.max).contains(&CLIENT_API)
        || manifest.files.is_empty()
        || manifest.files.len() > MAX_FILES
        || manifest.capabilities.is_empty()
        || manifest.capabilities.len() > 5
    {
        return Err(generic_error());
    }
    // Schema 1 remains import-compatible. Its retired precedence metadata is
    // ignored; these capabilities become usable only through explicit client
    // presentation choices (or, for pitches, an explicitly selected theme).
    // New packs are always emitted with the typed schema-2 contract below.
    let allowed = [
        "skill-icons",
        "player-iconsets",
        "fumbbl-id-images",
        "kickoff-art",
        "pitch-images",
        "sound-events",
    ];
    if manifest
        .capabilities
        .keys()
        .any(|key| !allowed.contains(&key.as_str()))
        || manifest.capability_versions.len() != manifest.capabilities.len()
        || manifest
            .capabilities
            .keys()
            .any(|key| manifest.capability_versions.get(key) != Some(&1))
    {
        return Err(generic_error());
    }
    if !manifest.signature.is_null()
        || !manifest.pack_id.starts_with("local.")
        || manifest.redistribution != "local-unverified"
    {
        return Err("This build accepts only explicitly unverified local asset packs".into());
    }
    image_pixel_budget(&manifest.files)?;
    let payload = &bytes[payload_start..];
    let mut expected_offset = 0_u64;
    let mut paths = HashSet::new();
    let mut folded_paths = HashSet::new();
    let mut total_pixels = 0_u64;
    let mut total_decoded = 0_usize;
    for file in &manifest.files {
        let is_image = matches!(file.mime.as_str(), "image/png" | "image/jpeg" | "image/gif");
        let is_audio = matches!(file.mime.as_str(), "audio/ogg" | "audio/wav");
        let pixels = if is_image {
            u64::from(file.width)
                .checked_mul(u64::from(file.height))
                .ok_or_else(generic_error)?
        } else {
            0
        };
        total_pixels = total_pixels.checked_add(pixels).ok_or_else(generic_error)?;
        let end = file
            .offset
            .checked_add(file.length as u64)
            .ok_or_else(generic_error)?;
        let start = usize::try_from(file.offset).map_err(|_| generic_error())?;
        let end_usize = usize::try_from(end).map_err(|_| generic_error())?;
        if !safe_internal_path(&file.path)
            || !paths.insert(file.path.clone())
            || !folded_paths.insert(file.path.to_ascii_lowercase())
            || (!is_image && !is_audio)
            || file.length == 0
            || (is_image && file.length > MAX_FILE_BYTES)
            || (is_audio && file.length > MAX_AUDIO_FILE_BYTES)
            || file.offset != expected_offset
            || end_usize > payload.len()
            || (is_image && (file.width == 0 || file.height == 0))
            || (is_audio && (file.width != 0 || file.height != 0))
            || pixels > MAX_IMAGE_PIXELS
            || total_pixels > MAX_TOTAL_PIXELS
            || !is_lower_hex(&file.sha256, 64)
        {
            return Err(generic_error());
        }
        let image = &payload[start..end_usize];
        if format!("{:x}", Sha256::digest(image)) != file.sha256 {
            return Err(generic_error());
        }
        match file.mime.as_str() {
            "image/png" => {
                if !static_png_framing_is_exact(image) {
                    return Err(generic_error());
                }
                let mut decode_options = png::DecodeOptions::default();
                decode_options.set_ignore_adler32(false);
                decode_options.set_ignore_crc(false);
                decode_options.set_skip_ancillary_crc_failures(false);
                let mut reader = png::Decoder::new_with_options(Cursor::new(image), decode_options)
                    .read_info()
                    .map_err(|_| generic_error())?;
                if reader.info().width != file.width
                    || reader.info().height != file.height
                    || !supported_png(reader.info())
                {
                    return Err(generic_error());
                }
                let output_len = reader.output_buffer_size();
                add_decoded_budget(&mut total_decoded, output_len)?;
                let mut decoded = vec![0; output_len];
                let output = reader
                    .next_frame(&mut decoded)
                    .map_err(|_| generic_error())?;
                if output.width != file.width
                    || output.height != file.height
                    || output.buffer_size() > output_len
                {
                    return Err(generic_error());
                }
                reader.finish().map_err(|_| generic_error())?;
            }
            "image/jpeg" => {
                use image::GenericImageView;
                let decoded = image::load_from_memory_with_format(image, image::ImageFormat::Jpeg)
                    .map_err(|_| generic_error())?;
                if decoded.dimensions() != (file.width, file.height) {
                    return Err(generic_error());
                }
                add_decoded_budget(&mut total_decoded, decoded.as_bytes().len())?;
            }
            "image/gif" => {
                validate_gif_file(image, file.width, file.height, &mut total_decoded)?;
            }
            "audio/ogg" | "audio/wav" => {
                let extension = if file.mime == "audio/ogg" {
                    "ogg"
                } else {
                    "wav"
                };
                asset_media::normalize_sound_bytes(image.to_vec(), extension)
                    .map_err(|_| generic_error())?;
            }
            _ => return Err(generic_error()),
        }
        expected_offset = end;
    }
    if usize::try_from(expected_offset).map_err(|_| generic_error())? != payload.len() {
        return Err(generic_error());
    }
    for (capability, bindings) in &manifest.capabilities {
        if bindings.is_empty() || bindings.len() > MAX_FILES {
            return Err(generic_error());
        }
        let mut normalized = HashSet::new();
        for (raw_key, path) in bindings {
            let key = normalize_key(raw_key);
            let bound_file = manifest
                .files
                .iter()
                .find(|file| file.path == path.as_str());
            let binding_type_valid = bound_file.is_some_and(|file| match capability.as_str() {
                "sound-events" => matches!(file.mime.as_str(), "audio/ogg" | "audio/wav"),
                "pitch-images" => {
                    matches!(file.mime.as_str(), "image/png" | "image/jpeg" | "image/gif")
                        && file.width == 782
                        && file.height == 452
                }
                _ => matches!(file.mime.as_str(), "image/png" | "image/gif"),
            });
            if key.is_empty()
                || !normalized.insert(key)
                || !paths.contains(path)
                || !safe_internal_path(path)
                || !binding_type_valid
                || (capability == "sound-events" && !valid_sound_event_id(raw_key))
                || (capability == "pitch-images" && !valid_pitch_image_id(raw_key))
            {
                return Err(generic_error());
            }
        }
        if manifest.capability_versions.get(capability) != Some(&1) {
            return Err(generic_error());
        }
    }
    let referenced: HashSet<&str> = manifest
        .capabilities
        .values()
        .flat_map(|bindings| bindings.values().map(String::as_str))
        .collect();
    if referenced.len() != manifest.files.len()
        || manifest
            .files
            .iter()
            .any(|file| !referenced.contains(file.path.as_str()))
    {
        return Err(generic_error());
    }
    let digest = format!("{:x}", Sha256::digest(&bytes));
    Ok(ValidatedPack {
        manifest,
        schema2: None,
        payload_start: payload_start as u64,
        bytes,
        digest,
    })
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct PitchBindingV2 {
    pub theme_id: String,
    pub weather: String,
    pub path: String,
}

pub(crate) fn valid_pitch_image_id(value: &str) -> bool {
    let Some((theme, weather)) = value.split_once(':') else {
        return false;
    };
    matches!(
        theme,
        "fumbbl-basic"
            | "fumbbl-default"
            | "fumbbl-blackbox"
            | "fumbbl-fumbblcup"
            | "fumbbl-chaos"
            | "fumbbl-darkelf"
            | "fumbbl-goblin"
            | "fumbbl-khorne"
            | "fumbbl-necromantic"
            | "fumbbl-norse"
            | "fumbbl-nurgle"
            | "fumbbl-skaven"
            | "fumbbl-slaanesh"
            | "fumbbl-tzeentch"
            | "fumbbl-vampire"
    ) && matches!(weather, "blizzard" | "heat" | "nice" | "rain" | "sunny")
}

impl ManifestFileV2 {
    fn path(&self) -> &str {
        match self {
            Self::Image(file) => &file.path,
            Self::Audio(file) => &file.path,
        }
    }
    fn mime(&self) -> &str {
        match self {
            Self::Image(file) => &file.mime,
            Self::Audio(file) => &file.mime,
        }
    }
    fn offset(&self) -> u64 {
        match self {
            Self::Image(file) => file.offset,
            Self::Audio(file) => file.offset,
        }
    }
    fn length(&self) -> usize {
        match self {
            Self::Image(file) => file.length,
            Self::Audio(file) => file.length,
        }
    }
    fn sha256(&self) -> &str {
        match self {
            Self::Image(file) => &file.sha256,
            Self::Audio(file) => &file.sha256,
        }
    }
}

fn valid_target_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value.is_ascii()
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && b"._:-".contains(&byte))
        })
}

pub(crate) fn valid_sound_event_id(value: &str) -> bool {
    valid_sound_event_syntax(value) && sound_event_ids().is_some_and(|ids| ids.contains(value))
}

pub(crate) fn valid_team_logo_race(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .skip(1)
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

pub(crate) fn valid_block_die_face(value: &str) -> bool {
    matches!(value, "skull" | "bothdown" | "push" | "powpush" | "pow")
}

fn valid_sound_event_syntax(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.is_ascii()
        && value.as_bytes()[0].is_ascii_alphabetic()
        && value
            .bytes()
            .skip(1)
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn validate_canonical_wav(bytes: &[u8], file: &ManifestAudioFileV2) -> bool {
    if bytes.len() < 44
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
        || &bytes[12..16] != b"fmt "
        || u32::from_le_bytes(bytes[16..20].try_into().unwrap()) != 16
        || u16::from_le_bytes(bytes[20..22].try_into().unwrap()) != 1
        || &bytes[36..40] != b"data"
    {
        return false;
    }
    let channels = u16::from_le_bytes(bytes[22..24].try_into().unwrap());
    let sample_rate = u32::from_le_bytes(bytes[24..28].try_into().unwrap());
    let byte_rate = u32::from_le_bytes(bytes[28..32].try_into().unwrap());
    let block_align = u16::from_le_bytes(bytes[32..34].try_into().unwrap());
    let bits = u16::from_le_bytes(bytes[34..36].try_into().unwrap());
    let data_len = u32::from_le_bytes(bytes[40..44].try_into().unwrap()) as usize;
    if channels != u16::from(file.channels)
        || sample_rate != file.sample_rate
        || !(1..=2).contains(&channels)
        || !(8_000..=96_000).contains(&sample_rate)
        || bits != 16
        || block_align != channels * 2
        || byte_rate != sample_rate * u32::from(block_align)
        || data_len != bytes.len() - 44
        || !data_len.is_multiple_of(usize::from(block_align))
        || u32::try_from(36 + data_len).ok()
            != Some(u32::from_le_bytes(bytes[4..8].try_into().unwrap()))
    {
        return false;
    }
    let frames = data_len / usize::from(block_align);
    let duration_ms = (frames as u64 * 1000 / u64::from(sample_rate)) as u32;
    duration_ms == file.duration_ms && duration_ms <= 20_000
}

fn validate_png_file(bytes: &[u8], width: u32, height: u32) -> Result<(), String> {
    if !static_png_framing_is_exact(bytes) {
        return Err(generic_error());
    }
    let mut options = png::DecodeOptions::default();
    options.set_ignore_adler32(false);
    options.set_ignore_crc(false);
    options.set_skip_ancillary_crc_failures(false);
    let mut reader = png::Decoder::new_with_options(Cursor::new(bytes), options)
        .read_info()
        .map_err(|_| generic_error())?;
    if reader.info().width != width
        || reader.info().height != height
        || reader.info().color_type != png::ColorType::Rgba
        || reader.info().bit_depth != png::BitDepth::Eight
    {
        return Err(generic_error());
    }
    let mut decoded = vec![0; reader.output_buffer_size()];
    reader
        .next_frame(&mut decoded)
        .map_err(|_| generic_error())?;
    reader.finish().map_err(|_| generic_error())?;
    Ok(())
}

fn side_domains_overlap(left: AssetSide, right: AssetSide) -> bool {
    left == right || left == AssetSide::Any || right == AssetSide::Any
}

pub(crate) fn validate_walk_sheet(
    binding: &WalkSheetBindingV2,
    file: &ManifestFileV2,
    bytes: &[u8],
) -> Result<(), String> {
    let target = format!(
        "{}/{}/{:?}",
        binding.team_id, binding.position_id, binding.side
    );
    if binding.frame != 64 {
        return Err(format!("walk sheet target {target} must use frame 64"));
    }

    const COMPASS_ROWS: [&str; 8] = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"];
    let rows: HashSet<&str> = binding.rows.iter().map(String::as_str).collect();
    if binding.rows.len() != COMPASS_ROWS.len()
        || rows.len() != COMPASS_ROWS.len()
        || !COMPASS_ROWS.iter().all(|row| rows.contains(row))
    {
        return Err(format!(
            "walk sheet target {target} rows must be a permutation of S,SE,E,NE,N,NW,W,SW"
        ));
    }
    if !(2..=16).contains(&binding.columns) {
        return Err(format!(
            "walk sheet target {target} columns must be between 2 and 16"
        ));
    }
    if binding.idle_column != 0 {
        return Err(format!("walk sheet target {target} idleColumn must be 0"));
    }
    if !(1..=30).contains(&binding.fps) {
        return Err(format!(
            "walk sheet target {target} fps must be between 1 and 30"
        ));
    }
    if binding
        .foot_y
        .is_some_and(|foot_y| !(1..=63).contains(&foot_y))
    {
        return Err(format!(
            "walk sheet target {target} footY must be between 1 and 63"
        ));
    }

    let expected_width = u32::from(binding.columns)
        .checked_mul(64)
        .ok_or_else(|| format!("walk sheet path {} has invalid dimensions", binding.path))?;
    let expected_height = 8_u32
        .checked_mul(64)
        .ok_or_else(|| format!("walk sheet path {} has invalid dimensions", binding.path))?;
    let image = match file {
        ManifestFileV2::Image(image) if image.mime == "image/png" => image,
        _ => {
            return Err(format!(
                "walk sheet path {} is invalid: walk sheets must be PNG",
                binding.path
            ));
        }
    };
    if image.width != expected_width || image.height != expected_height {
        return Err(format!(
            "walk sheet path {} must be {expected_width}x{expected_height}",
            binding.path
        ));
    }
    validate_png_file(bytes, expected_width, expected_height)
        .map_err(|_| format!("walk sheet path {} must be a valid RGBA8 PNG", binding.path))
}

fn validate_pack_v2(bytes: Vec<u8>) -> Result<ValidatedPack, String> {
    if bytes.len() > MAX_PACK_V2_BYTES {
        return Err(generic_error());
    }
    let (payload_start, manifest_bytes) = manifest_slice(&bytes)?;
    let manifest: ManifestV2 =
        serde_json::from_slice(manifest_bytes).map_err(|_| generic_error())?;
    let total_bindings = manifest.capabilities.skill_icons.len()
        + manifest.capabilities.player_sprites.len()
        + manifest.capabilities.sound_events.len()
        + manifest.capabilities.pitch_images.len()
        + manifest.capabilities.walk_sheets.len()
        + manifest.capabilities.team_logos.len()
        + manifest.capabilities.block_dice.len();
    if manifest.pack_format != "F40KMOD1"
        || manifest.schema_version != 2
        || !valid_pack_id(&manifest.pack_id)
        || !valid_semver(&manifest.version)
        || manifest.name.trim().is_empty()
        || manifest.name.len() > 120
        || manifest.name.chars().any(char::is_control)
        || manifest.source.trim().is_empty()
        || manifest.source.len() > 240
        || manifest.source.chars().any(char::is_control)
        || manifest.client_api.min > manifest.client_api.max
        || !(manifest.client_api.min..=manifest.client_api.max).contains(&CLIENT_API)
        || manifest.files.is_empty()
        || manifest.files.len() > MAX_FILES
        || total_bindings == 0
        || total_bindings > MAX_BINDINGS
        || !manifest.signature.is_null()
        || !manifest.pack_id.starts_with("local.")
        || manifest.redistribution != "local-unverified"
    {
        return Err(generic_error());
    }
    let expected_versions: BTreeMap<String, u8> = [
        (!manifest.capabilities.skill_icons.is_empty()).then_some(("skill-icons".into(), 2)),
        (!manifest.capabilities.player_sprites.is_empty()).then_some(("player-sprites".into(), 1)),
        (!manifest.capabilities.sound_events.is_empty()).then_some(("sound-events".into(), 1)),
        (!manifest.capabilities.pitch_images.is_empty()).then_some(("pitch-images".into(), 1)),
        (!manifest.capabilities.walk_sheets.is_empty()).then_some(("walk-sheets".into(), 1)),
        (!manifest.capabilities.team_logos.is_empty()).then_some(("team-logos".into(), 1)),
        (!manifest.capabilities.block_dice.is_empty()).then_some(("block-dice".into(), 1)),
    ]
    .into_iter()
    .flatten()
    .collect();
    if manifest.capability_versions != expected_versions {
        return Err(generic_error());
    }

    let payload = &bytes[payload_start..];
    let mut expected_offset = 0_u64;
    let mut paths = HashSet::new();
    let mut folded_paths = HashSet::new();
    let mut total_pixels = 0_u64;
    let mut total_decoded = 0_usize;
    let walk_paths: HashSet<&str> = manifest
        .capabilities
        .walk_sheets
        .iter()
        .map(|binding| binding.path.as_str())
        .collect();
    let non_walk_paths: HashSet<&str> = manifest
        .capabilities
        .skill_icons
        .iter()
        .map(|binding| binding.path.as_str())
        .chain(
            manifest
                .capabilities
                .player_sprites
                .iter()
                .map(|binding| binding.path.as_str()),
        )
        .chain(
            manifest
                .capabilities
                .sound_events
                .iter()
                .map(|binding| binding.path.as_str()),
        )
        .chain(
            manifest
                .capabilities
                .pitch_images
                .iter()
                .map(|binding| binding.path.as_str()),
        )
        .chain(
            manifest
                .capabilities
                .team_logos
                .iter()
                .map(|binding| binding.path.as_str()),
        )
        .chain(
            manifest
                .capabilities
                .block_dice
                .iter()
                .map(|binding| binding.path.as_str()),
        )
        .collect();
    let block_die_paths: HashSet<&str> = manifest
        .capabilities
        .block_dice
        .iter()
        .map(|binding| binding.path.as_str())
        .collect();
    if let Some(path) = walk_paths.intersection(&non_walk_paths).next() {
        return Err(format!(
            "walk sheet path {path} cannot be used by another capability"
        ));
    }
    for file in &manifest.files {
        let end = file
            .offset()
            .checked_add(file.length() as u64)
            .ok_or_else(generic_error)?;
        let start = usize::try_from(file.offset()).map_err(|_| generic_error())?;
        let end_usize = usize::try_from(end).map_err(|_| generic_error())?;
        if !safe_internal_path(file.path())
            || !paths.insert(file.path().to_owned())
            || !folded_paths.insert(file.path().to_ascii_lowercase())
            || file.length() == 0
            || file.offset() != expected_offset
            || end_usize > payload.len()
            || !is_lower_hex(file.sha256(), 64)
            || format!("{:x}", Sha256::digest(&payload[start..end_usize])) != file.sha256()
        {
            return Err(generic_error());
        }
        let is_walk_sheet = walk_paths.contains(file.path());
        let is_block_die = block_die_paths.contains(file.path());
        if is_walk_sheet && file.mime() != "image/png" {
            return Err(format!(
                "walk sheet path {} is invalid: walk sheets must be PNG",
                file.path()
            ));
        }
        match file {
            ManifestFileV2::Image(image) => {
                let pixels = u64::from(image.width)
                    .checked_mul(u64::from(image.height))
                    .ok_or_else(generic_error)?;
                total_pixels = total_pixels.checked_add(pixels).ok_or_else(generic_error)?;
                if !matches!(image.mime.as_str(), "image/png" | "image/gif")
                    || image.length > MAX_FILE_BYTES
                    || (!is_walk_sheet
                        && !is_block_die
                        && !matches!(
                            (image.width, image.height),
                            (48, 48) | (64, 64) | (782, 452)
                        ))
                    || pixels > MAX_IMAGE_PIXELS
                    || total_pixels > MAX_TOTAL_PIXELS
                {
                    return Err(generic_error());
                }
                if image.mime == "image/png" {
                    validate_png_file(&payload[start..end_usize], image.width, image.height)?;
                    add_decoded_budget(
                        &mut total_decoded,
                        usize::try_from(pixels.checked_mul(4).ok_or_else(generic_error)?)
                            .map_err(|_| generic_error())?,
                    )?;
                } else {
                    validate_gif_file(
                        &payload[start..end_usize],
                        image.width,
                        image.height,
                        &mut total_decoded,
                    )?;
                }
            }
            ManifestFileV2::Audio(audio) => {
                if audio.mime != "audio/wav"
                    || audio.length > MAX_AUDIO_FILE_BYTES
                    || !validate_canonical_wav(&payload[start..end_usize], audio)
                {
                    return Err(generic_error());
                }
            }
        }
        expected_offset = end;
    }
    if usize::try_from(expected_offset).map_err(|_| generic_error())? != payload.len() {
        return Err(generic_error());
    }

    let file_by_path: HashMap<&str, &ManifestFileV2> = manifest
        .files
        .iter()
        .map(|file| (file.path(), file))
        .collect();
    for binding in &manifest.capabilities.walk_sheets {
        let file = file_by_path
            .get(binding.path.as_str())
            .ok_or_else(|| format!("walk sheet path {} is missing", binding.path))?;
        let start = usize::try_from(file.offset()).map_err(|_| generic_error())?;
        let end = start.checked_add(file.length()).ok_or_else(generic_error)?;
        validate_walk_sheet(binding, file, &payload[start..end])?;
    }
    let mut referenced = HashSet::new();
    let mut skill_targets = HashSet::new();
    for binding in &manifest.capabilities.skill_icons {
        let normalized = canonical_skill_key(&binding.skill).ok_or_else(generic_error)?;
        let key = (
            normalized.clone(),
            binding.position_id.clone(),
            binding.side,
        );
        let file = file_by_path.get(binding.path.as_str());
        if binding
            .position_id
            .as_deref()
            .is_some_and(|value| !valid_target_id(value))
            || !skill_targets.insert(key)
            || !matches!(file, Some(ManifestFileV2::Image(file)) if file.width == 48 && file.height == 48)
        {
            return Err(generic_error());
        }
        referenced.insert(binding.path.as_str());
    }
    let mut sprite_targets = HashSet::new();
    for binding in &manifest.capabilities.player_sprites {
        let file = file_by_path.get(binding.path.as_str());
        if !valid_target_id(&binding.team_id)
            || !valid_target_id(&binding.position_id)
            || !sprite_targets.insert((
                binding.team_id.clone(),
                binding.position_id.clone(),
                binding.side,
            ))
            || !matches!(file, Some(ManifestFileV2::Image(file)) if file.width == 64 && file.height == 64)
        {
            return Err(generic_error());
        }
        referenced.insert(binding.path.as_str());
    }
    let mut walk_targets = HashSet::new();
    for binding in &manifest.capabilities.walk_sheets {
        if !valid_target_id(&binding.team_id)
            || !valid_target_id(&binding.position_id)
            || !walk_targets.insert((
                binding.team_id.clone(),
                binding.position_id.clone(),
                binding.side,
            ))
        {
            return Err(format!(
                "walk sheet target {}/{}/{:?} is invalid or duplicated",
                binding.team_id, binding.position_id, binding.side
            ));
        }
        if let Some(sprite) = manifest.capabilities.player_sprites.iter().find(|sprite| {
            sprite.team_id == binding.team_id
                && sprite.position_id == binding.position_id
                && side_domains_overlap(sprite.side, binding.side)
        }) {
            return Err(format!(
                "walk sheet target {}/{}/{:?} overlaps player sprite side {:?}",
                binding.team_id, binding.position_id, binding.side, sprite.side
            ));
        }
        referenced.insert(binding.path.as_str());
    }
    let mut sound_targets = HashSet::new();
    for binding in &manifest.capabilities.sound_events {
        if !valid_sound_event_id(&binding.event_id)
            || !sound_targets.insert(binding.event_id.clone())
            || !matches!(
                file_by_path.get(binding.path.as_str()),
                Some(ManifestFileV2::Audio(_))
            )
        {
            return Err(generic_error());
        }
        referenced.insert(binding.path.as_str());
    }
    let mut logo_targets = HashSet::new();
    for binding in &manifest.capabilities.team_logos {
        if !valid_team_logo_race(&binding.race)
            || !logo_targets.insert(binding.race.clone())
            || !matches!(
                file_by_path.get(binding.path.as_str()),
                Some(ManifestFileV2::Image(file)) if file.width == 48 && file.height == 48
            )
        {
            return Err(generic_error());
        }
        referenced.insert(binding.path.as_str());
    }
    let mut block_die_targets = HashSet::new();
    for binding in &manifest.capabilities.block_dice {
        if !valid_block_die_face(&binding.face)
            || !block_die_targets.insert(binding.face.clone())
            || !matches!(
                file_by_path.get(binding.path.as_str()),
                Some(ManifestFileV2::Image(file))
                    if file.mime == "image/png"
            )
        {
            return Err(generic_error());
        }
        referenced.insert(binding.path.as_str());
    }
    let mut pitch_targets = HashSet::new();
    for binding in &manifest.capabilities.pitch_images {
        let key = format!("{}:{}", binding.theme_id, binding.weather);
        if !valid_pitch_image_id(&key)
            || !pitch_targets.insert(key)
            || !matches!(
                file_by_path.get(binding.path.as_str()),
                Some(ManifestFileV2::Image(file)) if file.width == 782 && file.height == 452
            )
        {
            return Err(generic_error());
        }
        referenced.insert(binding.path.as_str());
    }
    if referenced.len() != manifest.files.len()
        || manifest
            .files
            .iter()
            .any(|file| !referenced.contains(file.path()))
    {
        return Err(generic_error());
    }

    let capabilities = expected_versions
        .keys()
        .map(|key| {
            let bindings = match key.as_str() {
                "skill-icons" => manifest
                    .capabilities
                    .skill_icons
                    .iter()
                    .map(|binding| {
                        (
                            format!(
                                "{}:{:?}:{:?}",
                                canonical_skill_key(&binding.skill).unwrap_or_default(),
                                binding.position_id,
                                binding.side
                            ),
                            binding.path.clone(),
                        )
                    })
                    .collect(),
                "player-sprites" => manifest
                    .capabilities
                    .player_sprites
                    .iter()
                    .map(|binding| {
                        (
                            format!(
                                "{}:{}:{:?}",
                                binding.team_id, binding.position_id, binding.side
                            ),
                            binding.path.clone(),
                        )
                    })
                    .collect(),
                "sound-events" => manifest
                    .capabilities
                    .sound_events
                    .iter()
                    .map(|binding| (binding.event_id.clone(), binding.path.clone()))
                    .collect(),
                "pitch-images" => manifest
                    .capabilities
                    .pitch_images
                    .iter()
                    .map(|binding| {
                        (
                            format!("{}:{}", binding.theme_id, binding.weather),
                            binding.path.clone(),
                        )
                    })
                    .collect(),
                "walk-sheets" => manifest
                    .capabilities
                    .walk_sheets
                    .iter()
                    .map(|binding| {
                        (
                            format!(
                                "{}:{}:{:?}",
                                binding.team_id, binding.position_id, binding.side
                            ),
                            binding.path.clone(),
                        )
                    })
                    .collect(),
                "team-logos" => manifest
                    .capabilities
                    .team_logos
                    .iter()
                    .map(|binding| (binding.race.clone(), binding.path.clone()))
                    .collect(),
                "block-dice" => manifest
                    .capabilities
                    .block_dice
                    .iter()
                    .map(|binding| (binding.face.clone(), binding.path.clone()))
                    .collect(),
                _ => HashMap::new(),
            };
            (key.clone(), bindings)
        })
        .collect();
    let synthetic_files = manifest
        .files
        .iter()
        .map(|file| match file {
            ManifestFileV2::Image(file) => ManifestFile {
                path: file.path.clone(),
                mime: file.mime.clone(),
                offset: file.offset,
                length: file.length,
                sha256: file.sha256.clone(),
                width: file.width,
                height: file.height,
            },
            ManifestFileV2::Audio(file) => ManifestFile {
                path: file.path.clone(),
                mime: file.mime.clone(),
                offset: file.offset,
                length: file.length,
                sha256: file.sha256.clone(),
                width: 0,
                height: 0,
            },
        })
        .collect();
    let legacy = Manifest {
        pack_format: manifest.pack_format.clone(),
        schema_version: 2,
        pack_id: manifest.pack_id.clone(),
        version: manifest.version.clone(),
        client_api: manifest.client_api.clone(),
        capability_versions: manifest
            .capability_versions
            .iter()
            .map(|(key, value)| (key.clone(), *value))
            .collect(),
        name: manifest.name.clone(),
        source: manifest.source.clone(),
        redistribution: manifest.redistribution.clone(),
        _ignored_precedence_metadata: None,
        capabilities,
        files: synthetic_files,
        signature: serde_json::Value::Null,
    };
    let digest = format!("{:x}", Sha256::digest(&bytes));
    Ok(ValidatedPack {
        manifest: legacy,
        schema2: Some(manifest),
        payload_start: payload_start as u64,
        bytes,
        digest,
    })
}

fn validate_pack(bytes: Vec<u8>) -> Result<ValidatedPack, String> {
    let (_, manifest_bytes) = manifest_slice(&bytes)?;
    let header: serde_json::Value =
        serde_json::from_slice(manifest_bytes).map_err(|_| generic_error())?;
    match header
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
    {
        Some(1) => validate_pack_v1(bytes),
        Some(2) => validate_pack_v2(bytes),
        _ => Err(generic_error()),
    }
}

fn asset_pack_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| storage_error())?
        .join("asset-packs"))
}

fn ensure_storage_dir(dir: &Path) -> Result<(), String> {
    let parent = dir.parent().ok_or_else(storage_error)?;
    std::fs::create_dir_all(parent).map_err(|_| storage_error())?;
    let parent_metadata = std::fs::symlink_metadata(parent).map_err(|_| storage_error())?;
    if !parent_metadata.is_dir() || metadata_is_reparse(&parent_metadata) {
        return Err(storage_error());
    }
    match std::fs::create_dir(dir) {
        Ok(()) => sync_directory(parent)?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(storage_error()),
    }
    let metadata = std::fs::symlink_metadata(dir).map_err(|_| storage_error())?;
    if !metadata.is_dir() || metadata_is_reparse(&metadata) {
        return Err(storage_error());
    }
    Ok(())
}

pub(crate) struct StorageLock {
    file: File,
    #[cfg(windows)]
    overlapped: Box<windows_sys::Win32::System::IO::OVERLAPPED>,
}

#[cfg(unix)]
impl Drop for StorageLock {
    fn drop(&mut self) {
        use std::os::fd::AsRawFd;
        unsafe {
            libc::flock(self.file.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

#[cfg(windows)]
impl Drop for StorageLock {
    fn drop(&mut self) {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::UnlockFileEx;
        unsafe {
            UnlockFileEx(
                self.file.as_raw_handle(),
                0,
                u32::MAX,
                u32::MAX,
                &mut *self.overlapped,
            );
        }
    }
}

#[cfg(not(any(windows, unix)))]
impl Drop for StorageLock {
    fn drop(&mut self) {}
}

pub(crate) fn lock_storage(dir: &Path) -> Result<StorageLock, String> {
    ensure_storage_dir(dir)?;
    let file = open_write_no_follow(&dir.join(LOCK_FILE), false).map_err(|_| storage_error())?;
    let metadata = file.metadata().map_err(|_| storage_error())?;
    if !metadata.is_file() || metadata_is_reparse(&metadata) {
        return Err(storage_error());
    }
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err(storage_error());
        }
        Ok(StorageLock { file })
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{LockFileEx, LOCKFILE_EXCLUSIVE_LOCK};
        let mut overlapped = Box::new(unsafe { std::mem::zeroed() });
        let ok = unsafe {
            LockFileEx(
                file.as_raw_handle(),
                LOCKFILE_EXCLUSIVE_LOCK,
                0,
                u32::MAX,
                u32::MAX,
                &mut *overlapped,
            )
        };
        if ok == 0 {
            return Err(storage_error());
        }
        Ok(StorageLock { file, overlapped })
    }
    #[cfg(not(any(windows, unix)))]
    {
        Ok(StorageLock { file })
    }
}

fn cleanup_stale_temps(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(".install-") || !name.ends_with(".tmp") {
            continue;
        }
        let path = entry.path();
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.is_file() && !metadata_is_reparse(&metadata) {
            let _ = std::fs::remove_file(path);
        }
    }
}

struct TempFileGuard {
    path: PathBuf,
    armed: bool,
}
impl Drop for TempFileGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

fn create_temp(dir: &Path, id: &str) -> Result<(File, TempFileGuard), String> {
    for _ in 0..128 {
        let nonce = TEMP_NONCE.fetch_add(1, Ordering::Relaxed);
        let path = dir.join(format!(".install-{id}-{}-{nonce}.tmp", std::process::id()));
        match open_write_no_follow(&path, true) {
            Ok(file) => return Ok((file, TempFileGuard { path, armed: true })),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("Asset pack could not be installed".into()),
        }
    }
    Err("Asset pack could not be installed".into())
}

#[cfg(windows)]
pub(crate) fn atomic_replace(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    fn wide(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    }
    let source = wide(source.as_os_str());
    let target = wide(target.as_os_str());
    let ok = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
pub(crate) fn atomic_replace(source: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::rename(source, target)
}

#[cfg(unix)]
pub(crate) fn sync_directory(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::OpenOptionsExt;
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| storage_error())
}
#[cfg(windows)]
pub(crate) fn sync_directory(path: &Path) -> Result<(), String> {
    use std::os::windows::fs::OpenOptionsExt;
    // MoveFileExW uses WRITE_THROUGH for the durable rename. Windows does not consistently allow
    // flushing a directory handle (notably on FAT and some redirected profile stores), so this is
    // a best-effort extra flush rather than turning a completed durable move into a false failure.
    let _ = OpenOptions::new()
        .read(true)
        .custom_flags(0x0200_0000)
        .open(path)
        .and_then(|directory| directory.sync_all());
    Ok(())
}
#[cfg(not(any(windows, unix)))]
pub(crate) fn sync_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn install_id(pack: &ValidatedPack) -> String {
    if pack.manifest.pack_id == USER_FILES_PACK_ID {
        USER_FILES_INSTALL_ID.into()
    } else {
        pack.digest[..32].to_string()
    }
}

fn asset_token(install_id: &str, path: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(install_id.as_bytes());
    hash.update([0]);
    hash.update(path.as_bytes());
    format!("{:x}", hash.finalize())[..32].to_string()
}

fn asset_url(install_id: &str, token: &str) -> String {
    #[cfg(any(target_os = "windows", target_os = "android"))]
    return format!("http://f40kmod.localhost/asset/{install_id}/{token}");
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    return format!("f40kmod://localhost/asset/{install_id}/{token}");
}

pub(crate) fn register_draft_assets<R: Runtime>(
    app: &tauri::AppHandle<R>,
    draft_id: &str,
    assets: Vec<(String, PathBuf, usize, String, String)>,
) -> Result<HashMap<String, String>, String> {
    if !is_lower_hex(draft_id, 32) {
        return Err(generic_error());
    }
    let mut urls = HashMap::new();
    let state = app.state::<AssetPackState>();
    let mut registry = state
        .drafts
        .lock()
        .map_err(|_| "Asset draft previews are unavailable")?;
    registry.retain(|key, _| !key.starts_with(&format!("{draft_id}/")));
    for (binding_id, path, length, mime, sha256) in assets {
        let token = asset_token(draft_id, &format!("{binding_id}:{sha256}"));
        registry.insert(
            format!("{draft_id}/{token}"),
            AssetLocation {
                container: path,
                offset: 0,
                length,
                mime,
                sha256,
            },
        );
        urls.insert(binding_id, asset_url(draft_id, &token));
    }
    Ok(urls)
}

pub(crate) fn unregister_draft_assets<R: Runtime>(app: &tauri::AppHandle<R>, draft_id: &str) {
    if let Ok(mut registry) = app.state::<AssetPackState>().drafts.lock() {
        registry.retain(|key, _| !key.starts_with(&format!("{draft_id}/")));
    }
}

fn descriptor(
    pack: &ValidatedPack,
    container: &Path,
    locations: &mut HashMap<String, AssetLocation>,
) -> InstalledAssetPack {
    let id = install_id(pack);
    let mut skill_icon_bindings = Vec::new();
    let mut player_sprite_bindings = Vec::new();
    let mut sound_event_bindings = Vec::new();
    let mut walk_sheet_bindings = Vec::new();
    let mut skill_icons = HashMap::new();
    let mut classic_image_bindings = HashMap::new();
    let mut logo_image_bindings = HashMap::new();
    let mut block_dice_bindings = HashMap::new();
    let mut pitch_image_bindings = HashMap::new();
    if let Some(manifest) = &pack.schema2 {
        let files: HashMap<&str, &ManifestFileV2> = manifest
            .files
            .iter()
            .map(|file| (file.path(), file))
            .collect();
        let mut register = |path: &str| {
            let token = asset_token(&id, path);
            let file = files[path];
            locations
                .entry(format!("{id}/{token}"))
                .or_insert_with(|| AssetLocation {
                    container: container.to_path_buf(),
                    offset: pack.payload_start + file.offset(),
                    length: file.length(),
                    mime: file.mime().to_owned(),
                    sha256: file.sha256().to_owned(),
                });
            asset_url(&id, &token)
        };
        skill_icon_bindings = manifest
            .capabilities
            .skill_icons
            .iter()
            .map(|binding| InstalledSkillBinding {
                skill: binding.skill.clone(),
                canonical_skill: canonical_skill_key(&binding.skill).unwrap_or_default(),
                position_id: binding.position_id.clone(),
                side: binding.side,
                url: register(&binding.path),
            })
            .collect();
        player_sprite_bindings = manifest
            .capabilities
            .player_sprites
            .iter()
            .map(|binding| InstalledSpriteBinding {
                team_id: binding.team_id.clone(),
                position_id: binding.position_id.clone(),
                side: binding.side,
                url: register(&binding.path),
            })
            .collect();
        sound_event_bindings = manifest
            .capabilities
            .sound_events
            .iter()
            .map(|binding| InstalledSoundBinding {
                event_id: binding.event_id.clone(),
                url: register(&binding.path),
            })
            .collect();
        walk_sheet_bindings = manifest
            .capabilities
            .walk_sheets
            .iter()
            .map(|binding| {
                let spec = binding.spec();
                InstalledWalkSheetBinding {
                    team_id: binding.team_id.clone(),
                    position_id: binding.position_id.clone(),
                    side: binding.side,
                    url: register(&binding.path),
                    frame: spec.frame,
                    rows: spec.rows,
                    columns: spec.columns,
                    idle_column: spec.idle_column,
                    fps: spec.fps,
                    foot_y: spec.foot_y,
                }
            })
            .collect();
        for binding in &manifest.capabilities.team_logos {
            logo_image_bindings.insert(binding.race.clone(), register(&binding.path));
        }
        for binding in &manifest.capabilities.block_dice {
            block_dice_bindings.insert(binding.face.clone(), register(&binding.path));
        }
        for binding in &manifest.capabilities.pitch_images {
            pitch_image_bindings.insert(
                format!("{}:{}", binding.theme_id, binding.weather),
                register(&binding.path),
            );
        }
    }
    let files: HashMap<&str, &ManifestFile> = pack
        .manifest
        .files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect();
    if pack.schema2.is_none() {
        let mut register = |path: &str| {
            let token = asset_token(&id, path);
            let file = files[path];
            locations
                .entry(format!("{id}/{token}"))
                .or_insert_with(|| AssetLocation {
                    container: container.to_path_buf(),
                    offset: pack.payload_start + file.offset,
                    length: file.length,
                    mime: file.mime.clone(),
                    sha256: file.sha256.clone(),
                });
            asset_url(&id, &token)
        };
        if let Some(bindings) = pack.manifest.capabilities.get("skill-icons") {
            for (key, path) in bindings {
                skill_icons.insert(normalize_key(key), register(path));
            }
        }
        for capability in ["player-iconsets", "fumbbl-id-images"] {
            if let Some(bindings) = pack.manifest.capabilities.get(capability) {
                for (key, path) in bindings {
                    let url = register(path);
                    if capability == "fumbbl-id-images" {
                        logo_image_bindings.insert(key.clone(), url.clone());
                    }
                    classic_image_bindings.insert(key.clone(), url);
                }
            }
        }
        if let Some(bindings) = pack.manifest.capabilities.get("sound-events") {
            for (event_id, path) in bindings {
                sound_event_bindings.push(InstalledSoundBinding {
                    event_id: event_id.clone(),
                    url: register(path),
                });
            }
        }
        if let Some(bindings) = pack.manifest.capabilities.get("pitch-images") {
            for (key, path) in bindings {
                pitch_image_bindings.insert(key.clone(), register(path));
            }
        }
    } else {
        for binding in &skill_icon_bindings {
            if binding.position_id.is_none() && binding.side == AssetSide::Any {
                skill_icons.insert(binding.canonical_skill.clone(), binding.url.clone());
            }
        }
    }
    let mut capabilities: Vec<_> = pack.manifest.capabilities.keys().cloned().collect();
    capabilities.sort();
    InstalledAssetPack {
        install_id: id,
        pack_id: pack.manifest.pack_id.clone(),
        version: pack.manifest.version.clone(),
        name: pack.manifest.name.clone(),
        source: pack.manifest.source.clone(),
        redistribution: pack.manifest.redistribution.clone(),
        verified_publisher: false,
        size_bytes: pack.bytes.len(),
        capabilities,
        coverage: pack
            .manifest
            .capabilities
            .iter()
            .map(|(key, bindings)| (key.clone(), bindings.len()))
            .collect(),
        skill_icons,
        classic_image_bindings,
        logo_image_bindings,
        block_dice_bindings,
        pitch_image_bindings,
        capability_versions: pack
            .manifest
            .capability_versions
            .iter()
            .map(|(key, value)| (key.clone(), *value))
            .collect(),
        skill_icon_bindings,
        player_sprite_bindings,
        sound_event_bindings,
        walk_sheet_bindings,
    }
}

fn scan_registry(
    dir: &Path,
) -> Result<(Vec<InstalledAssetPack>, HashMap<String, AssetLocation>), String> {
    let mut packs = Vec::new();
    let mut locations = HashMap::new();
    for entry in std::fs::read_dir(dir).map_err(|_| storage_error())? {
        let entry = entry.map_err(|_| storage_error())?;
        let path = entry.path();
        if path.extension().and_then(|x| x.to_str()) != Some("f40kmod") {
            continue;
        }
        let Ok(pack) = read_pack(&path).and_then(validate_pack) else {
            continue;
        };
        if path.file_stem().and_then(|x| x.to_str()) != Some(install_id(&pack).as_str()) {
            continue;
        }
        packs.push(descriptor(&pack, &path, &mut locations));
    }
    packs.sort_by(|a, b| a.name.cmp(&b.name).then(a.version.cmp(&b.version)));
    Ok((packs, locations))
}

fn publish_registry<R: Runtime>(
    app: &tauri::AppHandle<R>,
    packs: &[InstalledAssetPack],
    locations: HashMap<String, AssetLocation>,
) -> Result<(), String> {
    let state = app.state::<AssetPackState>();
    *state
        .known_installs
        .lock()
        .map_err(|_| "Asset pack registry is unavailable")? =
        packs.iter().map(|pack| pack.install_id.clone()).collect();
    *state
        .installed
        .lock()
        .map_err(|_| "Asset pack registry is unavailable")? = locations;
    Ok(())
}

fn rebuild_registry<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<InstalledAssetPack>, String> {
    let state = app.state::<AssetPackState>();
    let _lifecycle = state
        .lifecycle
        .lock()
        .map_err(|_| "Asset pack registry is unavailable")?;
    let dir = asset_pack_dir(app)?;
    let _lock = lock_storage(&dir)?;
    cleanup_stale_temps(&dir);
    let (packs, locations) = scan_registry(&dir)?;
    publish_registry(app, &packs, locations)?;
    Ok(packs)
}

fn install_validated(dir: &Path, pack: &ValidatedPack) -> Result<(), String> {
    cleanup_stale_temps(dir);
    let id = install_id(pack);
    let target = dir.join(format!("{id}.f40kmod"));
    if target.exists() {
        let metadata = std::fs::symlink_metadata(&target).map_err(|_| storage_error())?;
        if !metadata.is_file() || metadata_is_reparse(&metadata) {
            return Err(storage_error());
        }
        if read_pack(&target)
            .and_then(validate_pack)
            .is_ok_and(|existing| existing.digest == pack.digest && existing.bytes == pack.bytes)
        {
            return Ok(());
        }
    }
    let (mut file, mut guard) = create_temp(dir, &id)?;
    file.write_all(&pack.bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Asset pack could not be installed")?;
    drop(file);
    atomic_replace(&guard.path, &target).map_err(|_| "Asset pack could not be installed")?;
    guard.armed = false;
    sync_directory(dir)?;
    let installed = validate_pack(read_pack(&target)?)?;
    if installed.digest != pack.digest || installed.bytes != pack.bytes {
        return Err("Asset pack could not be installed".into());
    }
    Ok(())
}

fn remove_installed_file(dir: &Path, install_id: &str) -> Result<(), String> {
    let path = dir.join(format!("{install_id}.f40kmod"));
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_file() && !metadata_is_reparse(&metadata) => {
            std::fs::remove_file(path).map_err(|_| storage_error())?;
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        _ => Err(storage_error()),
    }
}

fn ensure_not_leased(leases: &HashSet<String>, install_id: &str) -> Result<(), String> {
    if leases.contains(install_id) {
        Err("Asset pack is active or still retiring".into())
    } else {
        Ok(())
    }
}

fn quota_gc_candidates(
    packs: &[InstalledAssetPack],
    incoming: &ValidatedPack,
    leases: &HashSet<String>,
) -> Result<HashSet<String>, String> {
    let incoming_id = install_id(incoming);
    let candidates: HashSet<_> = packs
        .iter()
        .filter(|pack| {
            pack.install_id != incoming_id
                && pack.pack_id == incoming.manifest.pack_id
                && pack.version == incoming.manifest.version
                && !leases.contains(&pack.install_id)
        })
        .map(|pack| pack.install_id.clone())
        .collect();
    let incoming_exists = packs.iter().any(|pack| pack.install_id == incoming_id);
    // Count the incoming file before any old revision is collected. This keeps the disk
    // ceiling true even if the process crashes in the narrow install-before-GC seam.
    let projected_count = packs.len() + usize::from(!incoming_exists);
    let projected_bytes = packs
        .iter()
        .try_fold(0_usize, |sum, pack| sum.checked_add(pack.size_bytes))
        .and_then(|sum| {
            sum.checked_add(if incoming_exists {
                0
            } else {
                incoming.bytes.len()
            })
        })
        .ok_or_else(storage_error)?;
    if projected_count > MAX_INSTALLED_PACKS || projected_bytes > MAX_INSTALLED_BYTES {
        return Err("Asset pack storage limit reached".into());
    }
    Ok(candidates)
}

fn install_with_policy<R: Runtime>(
    app: &tauri::AppHandle<R>,
    dir: &Path,
    pack: &ValidatedPack,
) -> Result<InstalledAssetPack, String> {
    let id = install_id(pack);
    let (existing, _) = scan_registry(dir)?;
    let leases = app
        .state::<AssetPackState>()
        .leases
        .lock()
        .map_err(|_| "Asset pack registry is unavailable")?
        .clone();
    let candidates = quota_gc_candidates(&existing, pack, &leases)?;
    let incoming_existed = existing.iter().any(|candidate| candidate.install_id == id);
    install_validated(dir, pack)?;
    for candidate in &candidates {
        if let Err(error) = remove_installed_file(dir, candidate) {
            if !incoming_existed {
                let _ = remove_installed_file(dir, &id);
                let _ = sync_directory(dir);
            }
            let (packs, locations) = scan_registry(dir)?;
            publish_registry(app, &packs, locations)?;
            return Err(error);
        }
    }
    sync_directory(dir)?;
    let (packs, locations) = scan_registry(dir)?;
    let total_bytes = packs
        .iter()
        .try_fold(0_usize, |sum, item| sum.checked_add(item.size_bytes))
        .ok_or_else(storage_error)?;
    if packs.len() > MAX_INSTALLED_PACKS || total_bytes > MAX_INSTALLED_BYTES {
        if !incoming_existed {
            let _ = remove_installed_file(dir, &id);
            let _ = sync_directory(dir);
        }
        let (packs, locations) = scan_registry(dir)?;
        publish_registry(app, &packs, locations)?;
        return Err("Asset pack storage limit reached".into());
    }
    let selected = packs
        .iter()
        .find(|candidate| candidate.install_id == id)
        .cloned()
        .ok_or_else(generic_error)?;
    publish_registry(app, &packs, locations)?;
    Ok(selected)
}

#[cfg(test)]
fn install_path_into_dir(
    dir: &Path,
    source: &Path,
    expected_digest: &str,
) -> Result<ValidatedPack, String> {
    if !is_lower_hex(expected_digest, 64) {
        return Err(generic_error());
    }
    let _lock = lock_storage(dir)?;
    let pack = validate_pack(read_pack(source)?)?;
    if pack.digest != expected_digest {
        return Err("The selected asset pack changed after inspection; inspect it again".into());
    }
    install_validated(dir, &pack)?;
    Ok(pack)
}

#[tauri::command]
pub fn list_asset_packs(app: tauri::AppHandle) -> Result<Vec<InstalledAssetPack>, String> {
    rebuild_registry(&app)
}

#[tauri::command]
pub fn inspect_asset_pack(path: String) -> Result<InspectedAssetPack, String> {
    let pack = validate_pack(read_pack(Path::new(&path))?)?;
    Ok(inspected_descriptor(&pack))
}

fn inspected_descriptor(pack: &ValidatedPack) -> InspectedAssetPack {
    let mut capabilities: Vec<_> = pack.manifest.capabilities.keys().cloned().collect();
    capabilities.sort();
    InspectedAssetPack {
        schema_version: pack.manifest.schema_version,
        pack_id: pack.manifest.pack_id.clone(),
        version: pack.manifest.version.clone(),
        name: pack.manifest.name.clone(),
        source: pack.manifest.source.clone(),
        redistribution: pack.manifest.redistribution.clone(),
        size_bytes: pack.bytes.len(),
        whole_pack_sha256: pack.digest.clone(),
        capabilities,
        coverage: pack
            .manifest
            .capabilities
            .iter()
            .map(|(key, bindings)| (key.clone(), bindings.len()))
            .collect(),
        capability_versions: pack
            .manifest
            .capability_versions
            .iter()
            .map(|(key, value)| (key.clone(), *value))
            .collect(),
    }
}

#[tauri::command]
pub fn install_asset_pack(
    app: tauri::AppHandle,
    path: String,
    expected_whole_pack_sha256: String,
) -> Result<InstalledAssetPack, String> {
    let state = app.state::<AssetPackState>();
    let _lifecycle = state
        .lifecycle
        .lock()
        .map_err(|_| "Asset pack registry is unavailable")?;
    let dir = asset_pack_dir(&app)?;
    if !is_lower_hex(&expected_whole_pack_sha256, 64) {
        return Err(generic_error());
    }
    let _lock = lock_storage(&dir)?;
    let pack = validate_pack(read_pack(Path::new(&path))?)?;
    if pack.manifest.pack_id == USER_FILES_PACK_ID {
        return Err("The managed Your files pack cannot be imported".into());
    }
    if pack.digest != expected_whole_pack_sha256 {
        return Err("The selected asset pack changed after inspection; inspect it again".into());
    }
    install_with_policy(&app, &dir, &pack)
}

pub(crate) fn install_pack_bytes(
    app: &tauri::AppHandle,
    bytes: Vec<u8>,
) -> Result<InstalledAssetPack, String> {
    let pack = validate_pack(bytes)?;
    let state = app.state::<AssetPackState>();
    let _lifecycle = state
        .lifecycle
        .lock()
        .map_err(|_| "Asset pack registry is unavailable")?;
    let dir = asset_pack_dir(app)?;
    let _lock = lock_storage(&dir)?;
    install_with_policy(app, &dir, &pack)
}

pub(crate) fn remove_user_files_pack(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AssetPackState>();
    let _lifecycle = state
        .lifecycle
        .lock()
        .map_err(|_| "Asset pack registry is unavailable")?;
    let dir = asset_pack_dir(app)?;
    let _lock = lock_storage(&dir)?;
    remove_installed_file(&dir, USER_FILES_INSTALL_ID)?;
    sync_directory(&dir)?;
    let (packs, locations) = scan_registry(&dir)?;
    publish_registry(app, &packs, locations)
}

#[cfg(test)]
pub(crate) fn inspect_pack_bytes(bytes: Vec<u8>) -> Result<InspectedAssetPack, String> {
    validate_pack(bytes).map(|pack| inspected_descriptor(&pack))
}

pub(crate) fn encode_pack(manifest: &ManifestV2, payloads: &[Vec<u8>]) -> Result<Vec<u8>, String> {
    let manifest = serde_json::to_vec(manifest).map_err(|_| generic_error())?;
    if manifest.is_empty() || manifest.len() > MAX_MANIFEST_BYTES {
        return Err(generic_error());
    }
    let total = 12_usize
        .checked_add(manifest.len())
        .and_then(|value| {
            payloads
                .iter()
                .try_fold(value, |sum, payload| sum.checked_add(payload.len()))
        })
        .ok_or_else(generic_error)?;
    if total > MAX_PACK_V2_BYTES {
        return Err(generic_error());
    }
    let mut output = Vec::with_capacity(total);
    output.extend_from_slice(MAGIC);
    output.extend_from_slice(&(manifest.len() as u32).to_le_bytes());
    output.extend_from_slice(&manifest);
    for payload in payloads {
        output.extend_from_slice(payload);
    }
    Ok(validate_pack(output)?.bytes)
}

pub(crate) fn export_pack_atomic(destination: &Path, bytes: &[u8]) -> Result<(), String> {
    if destination
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|value| !value.eq_ignore_ascii_case("f40kmod"))
        || bytes.len() > MAX_PACK_V2_BYTES
    {
        return Err("Asset pack destination is invalid".into());
    }
    let parent = destination.parent().ok_or_else(storage_error)?;
    let metadata = std::fs::symlink_metadata(parent).map_err(|_| storage_error())?;
    if !metadata.is_dir() || metadata_is_reparse(&metadata) {
        return Err(storage_error());
    }
    if let Ok(metadata) = std::fs::symlink_metadata(destination) {
        if !metadata.is_file() || metadata_is_reparse(&metadata) {
            return Err("Asset pack destination is invalid".into());
        }
    }
    let name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(storage_error)?;
    let temp = parent.join(format!(
        ".{name}.{}.tmp",
        TEMP_NONCE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = open_write_no_follow(&temp, true).map_err(|_| storage_error())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| storage_error())?;
    drop(file);
    if atomic_replace(&temp, destination).is_err() {
        let _ = std::fs::remove_file(&temp);
        return Err(storage_error());
    }
    sync_directory(parent)
}

#[tauri::command]
pub fn remove_asset_pack(app: tauri::AppHandle, install_id: String) -> Result<(), String> {
    if !is_lower_hex(&install_id, 32) {
        return Err(generic_error());
    }
    if install_id == USER_FILES_INSTALL_ID {
        return Err("Your files is managed from Configured assets".into());
    }
    let state = app.state::<AssetPackState>();
    let _lifecycle = state
        .lifecycle
        .lock()
        .map_err(|_| "Asset pack registry is unavailable")?;
    let leases = state
        .leases
        .lock()
        .map_err(|_| "Asset pack registry is unavailable")?;
    ensure_not_leased(&leases, &install_id)?;
    drop(leases);
    let dir = asset_pack_dir(&app)?;
    let _lock = lock_storage(&dir)?;
    remove_installed_file(&dir, &install_id)?;
    sync_directory(&dir)?;
    let (packs, locations) = scan_registry(&dir)?;
    publish_registry(&app, &packs, locations)?;
    Ok(())
}

#[tauri::command]
pub fn set_asset_pack_leases(
    app: tauri::AppHandle,
    install_ids: Vec<String>,
) -> Result<(), String> {
    if install_ids.len() > MAX_INSTALLED_PACKS || install_ids.iter().any(|id| !is_lower_hex(id, 32))
    {
        return Err(generic_error());
    }
    let requested: HashSet<_> = install_ids.into_iter().collect();
    let state = app.state::<AssetPackState>();
    let _lifecycle = state
        .lifecycle
        .lock()
        .map_err(|_| "Asset pack registry is unavailable")?;
    let known = state
        .known_installs
        .lock()
        .map_err(|_| "Asset pack registry is unavailable")?;
    if requested.iter().any(|id| !known.contains(id)) {
        return Err(generic_error());
    }
    *state
        .leases
        .lock()
        .map_err(|_| "Asset pack registry is unavailable")? = requested;
    Ok(())
}

fn read_asset(location: &AssetLocation) -> Option<Vec<u8>> {
    let mut file = open_read_no_follow(&location.container).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() || metadata_is_reparse(&metadata) {
        return None;
    }
    file.seek(SeekFrom::Start(location.offset)).ok()?;
    let mut bytes = vec![0; location.length];
    file.read_exact(&mut bytes).ok()?;
    if format!("{:x}", Sha256::digest(&bytes)) != location.sha256 {
        return None;
    }
    Some(bytes)
}

fn asset_response(
    location: &AssetLocation,
    bytes: Vec<u8>,
    is_head: bool,
    requested_range: Option<&str>,
) -> tauri::http::Response<Vec<u8>> {
    // Preserve the legacy schema-1 image GET response exactly; HEAD/range handling is an
    // additive media branch and cannot perturb ordinary icon loads.
    if !is_head && requested_range.is_none() {
        return tauri::http::Response::builder()
            .status(200)
            .header("Content-Type", &location.mime)
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", "private, max-age=31536000, immutable")
            .header("X-Content-Type-Options", "nosniff")
            .body(bytes)
            .unwrap();
    }
    let range = requested_range.and_then(|value| parse_single_range(value, bytes.len()));
    if requested_range.is_some() && range.is_none() {
        return tauri::http::Response::builder()
            .status(416)
            .header("Content-Range", format!("bytes */{}", bytes.len()))
            .body(Vec::new())
            .unwrap();
    }
    let (status, start, end) =
        range.map_or((200, 0, bytes.len()), |(start, end)| (206, start, end));
    let body = if is_head {
        Vec::new()
    } else {
        bytes[start..end].to_vec()
    };
    let mut response = tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", &location.mime)
        .header("Content-Length", (end - start).to_string())
        .header("Accept-Ranges", "bytes")
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "private, max-age=31536000, immutable")
        .header("X-Content-Type-Options", "nosniff");
    if status == 206 {
        response = response.header(
            "Content-Range",
            format!("bytes {start}-{}/{}", end - 1, bytes.len()),
        );
    }
    response.body(body).unwrap()
}

pub fn asset_protocol<R: Runtime>(
    context: tauri::UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let is_head = request.method() == tauri::http::Method::HEAD;
    if request.method() != tauri::http::Method::GET && !is_head {
        return tauri::http::Response::builder()
            .status(405)
            .body(Vec::new())
            .unwrap();
    }
    let parts: Vec<_> = request.uri().path().trim_matches('/').split('/').collect();
    let key = if parts.len() == 3
        && parts[0] == "asset"
        && is_lower_hex(parts[1], 32)
        && is_lower_hex(parts[2], 32)
    {
        format!("{}/{}", parts[1], parts[2])
    } else {
        String::new()
    };
    let state = context.app_handle().state::<AssetPackState>();
    let Ok(_lifecycle) = state.lifecycle.lock() else {
        return tauri::http::Response::builder()
            .status(503)
            .body(Vec::new())
            .unwrap();
    };
    let location = state
        .installed
        .lock()
        .ok()
        .and_then(|registry| registry.get(&key).cloned())
        .or_else(|| {
            state
                .drafts
                .lock()
                .ok()
                .and_then(|registry| registry.get(&key).cloned())
        });
    let Some(location) = location else {
        return tauri::http::Response::builder()
            .status(404)
            .body(Vec::new())
            .unwrap();
    };
    let Some(bytes) = read_asset(&location) else {
        return tauri::http::Response::builder()
            .status(404)
            .body(Vec::new())
            .unwrap();
    };
    let requested_range = request
        .headers()
        .get(tauri::http::header::RANGE)
        .and_then(|value| value.to_str().ok());
    asset_response(&location, bytes, is_head, requested_range)
}

fn parse_single_range(value: &str, length: usize) -> Option<(usize, usize)> {
    let spec = value.strip_prefix("bytes=")?;
    if length == 0 || spec.contains(',') {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    if start.is_empty() {
        let suffix = end.parse::<usize>().ok()?;
        if suffix == 0 {
            return None;
        }
        return Some((length.saturating_sub(suffix), length));
    }
    let start = start.parse::<usize>().ok()?;
    if start >= length {
        return None;
    }
    let end = if end.is_empty() {
        length
    } else {
        end.parse::<usize>().ok()?.checked_add(1)?.min(length)
    };
    (start < end).then_some((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{Arc, Barrier},
        thread,
    };
    use tempfile::tempdir;

    fn png_bytes(color: [u8; 4]) -> Vec<u8> {
        let mut image = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut image, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&color).unwrap();
        }
        image
    }

    fn gif_bytes(width: u32, height: u32, frame_count: usize) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut bytes);
            for index in 0..frame_count {
                let color = [index as u8, 25, 50, 255];
                let frame = image::Frame::new(image::RgbaImage::from_pixel(
                    width,
                    height,
                    image::Rgba(color),
                ));
                encoder.encode_frame(frame).unwrap();
            }
        }
        bytes
    }

    fn png_crc(kind: [u8; 4], data: &[u8]) -> u32 {
        let mut crc = u32::MAX;
        for byte in kind.iter().chain(data) {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb8_8320 & 0_u32.wrapping_sub(crc & 1));
            }
        }
        !crc
    }

    fn insert_png_chunk_before_iend(image: &[u8], kind: [u8; 4], data: &[u8]) -> Vec<u8> {
        assert!(image.len() >= 12 && &image[image.len() - 8..image.len() - 4] == b"IEND");
        let (before_iend, iend) = image.split_at(image.len() - 12);
        let mut output = Vec::with_capacity(image.len() + data.len() + 12);
        output.extend_from_slice(before_iend);
        output.extend_from_slice(&(data.len() as u32).to_be_bytes());
        output.extend_from_slice(&kind);
        output.extend_from_slice(data);
        output.extend_from_slice(&png_crc(kind, data).to_be_bytes());
        output.extend_from_slice(iend);
        output
    }

    fn insert_png_chunk_before_idat(image: &[u8], kind: [u8; 4], data: &[u8]) -> Vec<u8> {
        let mut cursor = 8_usize;
        while cursor + 12 <= image.len() {
            let length = u32::from_be_bytes(image[cursor..cursor + 4].try_into().unwrap()) as usize;
            let chunk_end = cursor + 12 + length;
            assert!(chunk_end <= image.len());
            if &image[cursor + 4..cursor + 8] == b"IDAT" {
                let mut output = Vec::with_capacity(image.len() + data.len() + 12);
                output.extend_from_slice(&image[..cursor]);
                output.extend_from_slice(&(data.len() as u32).to_be_bytes());
                output.extend_from_slice(&kind);
                output.extend_from_slice(data);
                output.extend_from_slice(&png_crc(kind, data).to_be_bytes());
                output.extend_from_slice(&image[cursor..]);
                return output;
            }
            cursor = chunk_end;
        }
        panic!("fixture PNG has no IDAT chunk");
    }

    fn high_ratio_zlib_stream() -> Vec<u8> {
        let pixels = vec![0_u8; 1024 * 1024];
        let mut encoded = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut encoded, 4096, 256);
            encoder.set_color(png::ColorType::Grayscale);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&pixels).unwrap();
        }

        let mut compressed = Vec::new();
        let mut cursor = 8_usize;
        while cursor + 12 <= encoded.len() {
            let length =
                u32::from_be_bytes(encoded[cursor..cursor + 4].try_into().unwrap()) as usize;
            let data_start = cursor + 8;
            let chunk_end = data_start + length + 4;
            assert!(chunk_end <= encoded.len());
            if &encoded[cursor + 4..cursor + 8] == b"IDAT" {
                compressed.extend_from_slice(&encoded[data_start..data_start + length]);
            }
            cursor = chunk_end;
        }
        assert!(compressed.len() < pixels.len() / 100);
        compressed
    }

    fn manifest(images: &[(&str, &[u8])]) -> serde_json::Value {
        let mut offset = 0_u64;
        let files: Vec<_> = images.iter().map(|(path, image)| {
            let item = serde_json::json!({"path":path,"mime":"image/png","offset":offset,
                "length":image.len(),"sha256":format!("{:x}", Sha256::digest(image)),"width":1,"height":1});
            offset += image.len() as u64;
            item
        }).collect();
        let bindings: serde_json::Map<String, serde_json::Value> = images
            .iter()
            .enumerate()
            .map(|(i, (path, _))| (format!("Skill {i}"), serde_json::json!(path)))
            .collect();
        serde_json::json!({"packFormat":"F40KMOD1","schemaVersion":1,"packId":"local.test.skill-icons",
            "version":"1.0.0","clientApi":{"min":1,"max":1},"capabilityVersions":{"skill-icons":1},
            "name":"Fixture icons","source":"generated test fixture","redistribution":"local-unverified",
            "capabilities":{"skill-icons":bindings},"files":files,"signature":null})
    }

    fn container(manifest: &serde_json::Value, payloads: &[&[u8]]) -> Vec<u8> {
        let manifest = serde_json::to_vec(manifest).unwrap();
        let mut out = Vec::new();
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&(manifest.len() as u32).to_le_bytes());
        out.extend_from_slice(&manifest);
        for payload in payloads {
            out.extend_from_slice(payload);
        }
        out
    }

    fn fixture(color: [u8; 4]) -> Vec<u8> {
        let image = png_bytes(color);
        container(&manifest(&[("skill-icons/block.img", &image)]), &[&image])
    }

    fn rgba_png(width: u32, height: u32) -> Vec<u8> {
        let mut image = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut image, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer
                .write_image_data(&vec![255; width as usize * height as usize * 4])
                .unwrap();
        }
        image
    }

    fn schema2_skill_manifest(image: &[u8]) -> ManifestV2 {
        ManifestV2 {
            pack_format: "F40KMOD1".into(),
            schema_version: 2,
            pack_id: "local.test.creator".into(),
            version: "1.0.0".into(),
            client_api: ClientApi { min: 1, max: 1 },
            capability_versions: [("skill-icons".into(), 2)].into_iter().collect(),
            name: "Creator fixture".into(),
            source: "test fixture".into(),
            redistribution: "local-unverified".into(),
            _ignored_precedence_metadata: None,
            capabilities: CapabilitiesV2 {
                skill_icons: vec![
                    SkillBindingV2 {
                        skill: "Block".into(),
                        position_id: None,
                        side: AssetSide::Any,
                        path: "assets/shared.png".into(),
                    },
                    SkillBindingV2 {
                        skill: "Dodge".into(),
                        position_id: Some("blitzer".into()),
                        side: AssetSide::Home,
                        path: "assets/shared.png".into(),
                    },
                ],
                ..Default::default()
            },
            files: vec![ManifestFileV2::Image(ManifestImageFileV2 {
                path: "assets/shared.png".into(),
                mime: "image/png".into(),
                offset: 0,
                length: image.len(),
                sha256: format!("{:x}", Sha256::digest(image)),
                width: 48,
                height: 48,
            })],
            signature: serde_json::Value::Null,
        }
    }

    fn schema2_block_dice_manifest(image: &[u8]) -> ManifestV2 {
        let path = "block-dice/skull.png";
        ManifestV2 {
            pack_format: "F40KMOD1".into(),
            schema_version: 2,
            pack_id: "local.test.block-dice".into(),
            version: "1.0.0".into(),
            client_api: ClientApi { min: 1, max: 1 },
            capability_versions: [("block-dice".into(), 1)].into_iter().collect(),
            name: "Block dice fixture".into(),
            source: "test fixture".into(),
            redistribution: "local-unverified".into(),
            _ignored_precedence_metadata: None,
            capabilities: CapabilitiesV2 {
                block_dice: vec![BlockDieBindingV2 {
                    face: "skull".into(),
                    path: path.into(),
                }],
                ..Default::default()
            },
            files: vec![ManifestFileV2::Image(ManifestImageFileV2 {
                path: path.into(),
                mime: "image/png".into(),
                offset: 0,
                length: image.len(),
                sha256: format!("{:x}", Sha256::digest(image)),
                width: 35,
                height: 35,
            })],
            signature: serde_json::Value::Null,
        }
    }

    #[test]
    fn block_dice_manifest_roundtrips_and_omits_an_empty_section() {
        let image = rgba_png(35, 35);
        let manifest = schema2_block_dice_manifest(&image);
        let value = serde_json::to_value(&manifest).unwrap();
        assert_eq!(value["capabilities"]["block-dice"][0]["face"], "skull");
        assert!(serde_json::from_value::<ManifestV2>(value).is_ok());

        let empty = serde_json::to_value(CapabilitiesV2::default()).unwrap();
        assert!(empty.get("block-dice").is_none());
    }

    #[test]
    fn block_dice_manifest_rejects_unknown_and_duplicate_faces() {
        let image = rgba_png(35, 35);
        let mut manifest = schema2_block_dice_manifest(&image);
        manifest.capabilities.block_dice[0].face = "explode".into();
        assert!(encode_pack(&manifest, &[image.clone()]).is_err());

        let mut manifest = schema2_block_dice_manifest(&image);
        manifest
            .capabilities
            .block_dice
            .push(manifest.capabilities.block_dice[0].clone());
        assert!(encode_pack(&manifest, &[image]).is_err());
    }

    fn walk_rows() -> Vec<String> {
        ["S", "SE", "E", "NE", "N", "NW", "W", "SW"]
            .into_iter()
            .map(str::to_owned)
            .collect()
    }

    fn walk_binding(path: &str) -> WalkSheetBindingV2 {
        WalkSheetBindingV2 {
            team_id: "team-1".into(),
            position_id: "catcher".into(),
            side: AssetSide::Home,
            path: path.into(),
            frame: 64,
            rows: walk_rows(),
            columns: 9,
            idle_column: 0,
            fps: 10,
            foot_y: Some(58),
        }
    }

    fn schema2_walk_manifest(image: &[u8], mime: &str, width: u32, height: u32) -> ManifestV2 {
        let path = "assets/catcher-walk.png";
        ManifestV2 {
            pack_format: "F40KMOD1".into(),
            schema_version: 2,
            pack_id: "local.test.walker".into(),
            version: "1.0.0".into(),
            client_api: ClientApi { min: 1, max: 1 },
            capability_versions: [("walk-sheets".into(), 1)].into_iter().collect(),
            name: "Walk fixture".into(),
            source: "generated test fixture".into(),
            redistribution: "local-unverified".into(),
            _ignored_precedence_metadata: None,
            capabilities: CapabilitiesV2 {
                walk_sheets: vec![walk_binding(path)],
                ..Default::default()
            },
            files: vec![ManifestFileV2::Image(ManifestImageFileV2 {
                path: path.into(),
                mime: mime.into(),
                offset: 0,
                length: image.len(),
                sha256: format!("{:x}", Sha256::digest(image)),
                width,
                height,
            })],
            signature: serde_json::Value::Null,
        }
    }

    fn add_static_sprite(
        manifest: &mut ManifestV2,
        walk_len: usize,
        image: &[u8],
        team_id: &str,
        side: AssetSide,
    ) {
        let path = "assets/catcher-static.png";
        manifest
            .capability_versions
            .insert("player-sprites".into(), 1);
        manifest.capabilities.player_sprites.push(SpriteBindingV2 {
            team_id: team_id.into(),
            position_id: "catcher".into(),
            side,
            path: path.into(),
        });
        manifest
            .files
            .push(ManifestFileV2::Image(ManifestImageFileV2 {
                path: path.into(),
                mime: "image/png".into(),
                offset: walk_len as u64,
                length: image.len(),
                sha256: format!("{:x}", Sha256::digest(image)),
                width: 64,
                height: 64,
            }));
    }

    #[test]
    fn schema1_container_bytes_remain_unchanged() {
        let bytes = fixture([1, 2, 3, 255]);
        let parsed = validate_pack(bytes.clone()).unwrap();
        assert_eq!(parsed.manifest.schema_version, 1);
        assert_eq!(parsed.bytes, bytes);
    }

    #[test]
    fn schema1_accepts_native_gif_and_rejects_trailing_or_excess_frames() {
        let image = gif_bytes(1, 1, 1);
        let mut value = manifest(&[("skill-icons/block.gif", &image)]);
        value["files"][0]["mime"] = serde_json::json!("image/gif");
        let parsed = validate_pack(container(&value, &[&image])).unwrap();
        let mut locations = HashMap::new();
        descriptor(&parsed, Path::new("fixture.f40kmod"), &mut locations);
        assert_eq!(locations.values().next().unwrap().mime, "image/gif");

        let mut trailing = image.clone();
        trailing.extend_from_slice(b"junk");
        value["files"][0]["length"] = serde_json::json!(trailing.len());
        value["files"][0]["sha256"] = serde_json::json!(format!("{:x}", Sha256::digest(&trailing)));
        assert!(validate_pack(container(&value, &[&trailing])).is_err());

        let many_frames = gif_bytes(1, 1, MAX_GIF_FRAMES + 1);
        value["files"][0]["length"] = serde_json::json!(many_frames.len());
        value["files"][0]["sha256"] =
            serde_json::json!(format!("{:x}", Sha256::digest(&many_frames)));
        assert!(validate_pack(container(&value, &[&many_frames])).is_err());
    }

    #[test]
    fn retired_precedence_metadata_is_accepted_but_has_no_runtime_identity() {
        let image = png_bytes([4, 3, 2, 255]);
        let mut value = manifest(&[("player-iconsets/lineman.png", &image)]);
        value["capabilityVersions"] = serde_json::json!({"player-iconsets": 1});
        value["capabilities"] = serde_json::json!({
            "player-iconsets": {
                "https://cdn.fumbbl.com/i/436254.png": "player-iconsets/lineman.png"
            }
        });
        value["upstreamPolicy"] = serde_json::json!({
            "provider": "fumbbl",
            "precedence": "upstream-first"
        });
        let parsed = validate_pack(container(&value, &[&image])).unwrap();
        let mut locations = HashMap::new();
        let installed = descriptor(&parsed, Path::new("fixture.f40kmod"), &mut locations);
        assert_eq!(installed.classic_image_bindings.len(), 1);
        assert_eq!(locations.len(), 1);
        let installed_json = serde_json::to_value(installed).unwrap();
        assert!(installed_json.get("upstreamPolicy").is_none());
        assert!(installed_json.get("provider").is_none());
        assert!(installed_json.get("precedence").is_none());

        let schema2_image = rgba_png(48, 48);
        let mut schema2 = serde_json::to_value(schema2_skill_manifest(&schema2_image)).unwrap();
        schema2["upstreamPolicy"] = serde_json::json!({
            "provider": "arbitrary-retired-value",
            "precedence": "arbitrary-retired-value"
        });
        let parsed = validate_pack(container(&schema2, &[&schema2_image])).unwrap();
        assert!(parsed.manifest._ignored_precedence_metadata.is_none());
        assert!(parsed
            .schema2
            .as_ref()
            .and_then(|manifest| manifest._ignored_precedence_metadata.as_ref())
            .is_some());
    }

    #[test]
    fn schema1_local_image_ids_need_no_remote_endpoint() {
        let image = png_bytes([4, 3, 2, 255]);
        let mut value = manifest(&[("player-iconsets/lineman.png", &image)]);
        value["capabilityVersions"] = serde_json::json!({"player-iconsets": 1});
        value["capabilities"] = serde_json::json!({
            "player-iconsets": {"436254": "player-iconsets/lineman.png"}
        });
        let parsed = validate_pack(container(&value, &[&image])).unwrap();
        let mut locations = HashMap::new();
        let installed = descriptor(&parsed, Path::new("fixture.f40kmod"), &mut locations);
        assert!(installed.classic_image_bindings.contains_key("436254"));
        assert_eq!(locations.len(), 1);
    }

    #[test]
    fn schema1_rejects_mistyped_pitch_and_sound_bindings() {
        let image = png_bytes([4, 3, 2, 255]);
        let mut pitch = manifest(&[("pitches/basic/nice.png", &image)]);
        pitch["capabilityVersions"] = serde_json::json!({"pitch-images": 1});
        pitch["capabilities"] = serde_json::json!({
            "pitch-images": {"fumbbl-basic:nice": "pitches/basic/nice.png"}
        });
        assert!(validate_pack(container(&pitch, &[&image])).is_err());

        let mut sound = manifest(&[("sounds/block.png", &image)]);
        sound["capabilityVersions"] = serde_json::json!({"sound-events": 1});
        sound["capabilities"] = serde_json::json!({
            "sound-events": {"block": "sounds/block.png"}
        });
        assert!(validate_pack(container(&sound, &[&image])).is_err());
    }

    #[test]
    fn schema1_frozen_edge_pack_preserves_legacy_raw_binding_key_acceptance() {
        const RAW_KEY: &str =
            "  Legacy Ł skill AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA  ";
        assert!(RAW_KEY.len() > 96);
        assert_ne!(RAW_KEY.trim(), RAW_KEY);
        assert!(!RAW_KEY.is_ascii());

        let image = png_bytes([12, 34, 56, 255]);
        let mut edge_manifest = manifest(&[("skill-icons/legacy-edge.img", &image)]);
        let mut bindings = serde_json::Map::new();
        bindings.insert(
            RAW_KEY.into(),
            serde_json::json!("skill-icons/legacy-edge.img"),
        );
        edge_manifest["capabilities"]["skill-icons"] = serde_json::Value::Object(bindings);
        let bytes = container(&edge_manifest, &[&image]);
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            "9bcf85dd230ccdcc635d4037f579523b39e137ce633d1d8f348e06cf0b1a9302"
        );

        let parsed = validate_pack(bytes.clone()).unwrap();
        assert_eq!(parsed.manifest.schema_version, 1);
        assert_eq!(parsed.bytes, bytes);
        assert_eq!(
            parsed.manifest.capabilities["skill-icons"].get(RAW_KEY),
            Some(&"skill-icons/legacy-edge.img".into())
        );
    }

    #[test]
    fn schema2_roundtrip_is_deterministic_and_allows_shared_files() {
        let image = rgba_png(48, 48);
        let manifest = schema2_skill_manifest(&image);
        let first = encode_pack(&manifest, std::slice::from_ref(&image)).unwrap();
        let second = encode_pack(&manifest, &[image]).unwrap();
        assert_eq!(first, second);
        let parsed = validate_pack(first).unwrap();
        assert_eq!(parsed.manifest.schema_version, 2);
        assert_eq!(parsed.manifest.capabilities["skill-icons"].len(), 2);
        assert_eq!(parsed.manifest.files.len(), 1);
    }

    #[test]
    fn schema2_accepts_walk_sheet_and_descriptor_is_flat_and_complete() {
        let image = rgba_png(576, 512);
        let mut manifest = schema2_walk_manifest(&image, "image/png", 576, 512);
        let mut without_foot_y = walk_binding("assets/catcher-walk.png");
        without_foot_y.team_id = "team-2".into();
        without_foot_y.foot_y = None;
        manifest.capabilities.walk_sheets.push(without_foot_y);

        let packed = encode_pack(&manifest, std::slice::from_ref(&image)).unwrap();
        let parsed = validate_pack(packed).unwrap();
        let mut locations = HashMap::new();
        let installed = descriptor(&parsed, Path::new("fixture.f40kmod"), &mut locations);
        assert_eq!(installed.walk_sheet_bindings.len(), 2);
        assert_eq!(installed.walk_sheet_bindings[0].spec().frame, 64);
        let value = serde_json::to_value(&installed).unwrap();
        let rows = value["walkSheetBindings"].as_array().unwrap();
        assert_eq!(rows[0]["url"], installed.walk_sheet_bindings[0].url);
        assert_eq!(rows[0]["frame"], 64);
        assert_eq!(rows[0]["rows"], serde_json::json!(walk_rows()));
        assert_eq!(rows[0]["columns"], 9);
        assert_eq!(rows[0]["idleColumn"], 0);
        assert_eq!(rows[0]["fps"], 10);
        assert_eq!(rows[0]["footY"], 58);
        assert!(rows[0].get("spec").is_none());
        assert!(rows[1].get("footY").is_none());
        assert!(rows[1].get("spec").is_none());
    }

    #[test]
    fn installed_pack_without_walk_sheets_is_byte_identical_to_pre_change_shape() {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct PreWalkInstalledAssetPack<'a> {
            install_id: &'a String,
            pack_id: &'a String,
            version: &'a String,
            name: &'a String,
            source: &'a String,
            redistribution: &'a String,
            verified_publisher: bool,
            size_bytes: usize,
            capabilities: &'a Vec<String>,
            coverage: &'a HashMap<String, usize>,
            skill_icons: &'a HashMap<String, String>,
            classic_image_bindings: &'a HashMap<String, String>,
            logo_image_bindings: &'a HashMap<String, String>,
            block_dice_bindings: &'a HashMap<String, String>,
            pitch_image_bindings: &'a HashMap<String, String>,
            capability_versions: &'a BTreeMap<String, u8>,
            skill_icon_bindings: &'a Vec<InstalledSkillBinding>,
            player_sprite_bindings: &'a Vec<InstalledSpriteBinding>,
            sound_event_bindings: &'a Vec<InstalledSoundBinding>,
        }

        let image = rgba_png(48, 48);
        let packed = encode_pack(&schema2_skill_manifest(&image), &[image]).unwrap();
        let parsed = validate_pack(packed).unwrap();
        let mut locations = HashMap::new();
        let installed = descriptor(&parsed, Path::new("fixture.f40kmod"), &mut locations);
        let baseline = PreWalkInstalledAssetPack {
            install_id: &installed.install_id,
            pack_id: &installed.pack_id,
            version: &installed.version,
            name: &installed.name,
            source: &installed.source,
            redistribution: &installed.redistribution,
            verified_publisher: installed.verified_publisher,
            size_bytes: installed.size_bytes,
            capabilities: &installed.capabilities,
            coverage: &installed.coverage,
            skill_icons: &installed.skill_icons,
            classic_image_bindings: &installed.classic_image_bindings,
            logo_image_bindings: &installed.logo_image_bindings,
            block_dice_bindings: &installed.block_dice_bindings,
            pitch_image_bindings: &installed.pitch_image_bindings,
            capability_versions: &installed.capability_versions,
            skill_icon_bindings: &installed.skill_icon_bindings,
            player_sprite_bindings: &installed.player_sprite_bindings,
            sound_event_bindings: &installed.sound_event_bindings,
        };
        // This mirror is the exact pre-walk field order and shape from InstalledAssetPack
        // (+ logo_image_bindings, owner 2026-09-05: team logos from any installed pack).
        assert_eq!(
            serde_json::to_vec(&installed).unwrap(),
            serde_json::to_vec(&baseline).unwrap()
        );
    }

    #[test]
    fn walk_sheet_rejects_non_64_frame_wrong_dimensions_and_gif() {
        let large = rgba_png(1152, 1024);
        let mut manifest = schema2_walk_manifest(&large, "image/png", 1152, 1024);
        manifest.capabilities.walk_sheets[0].frame = 128;
        let error = validate_pack(container(
            &serde_json::to_value(&manifest).unwrap(),
            &[&large],
        ))
        .err()
        .unwrap();
        assert!(error.contains("frame 64"), "{error}");

        let wrong = rgba_png(575, 512);
        let manifest = schema2_walk_manifest(&wrong, "image/png", 575, 512);
        let error = validate_pack(container(
            &serde_json::to_value(&manifest).unwrap(),
            &[&wrong],
        ))
        .err()
        .unwrap();
        assert!(error.contains("576x512"), "{error}");

        let gif = gif_bytes(576, 512, 1);
        let manifest = schema2_walk_manifest(&gif, "image/gif", 576, 512);
        let error = validate_pack(container(
            &serde_json::to_value(&manifest).unwrap(),
            &[&gif],
        ))
        .err()
        .unwrap();
        assert!(error.contains("walk sheets must be PNG"), "{error}");
    }

    #[test]
    fn walk_sheet_rejects_bad_rows_and_invalid_scalar_spec_fields() {
        let image = rgba_png(576, 512);
        for rows in [
            vec!["S", "SE", "E", "NE", "N", "NW", "W"],
            vec!["S", "SE", "E", "NE", "N", "NW", "W", "W"],
            vec!["S", "SE", "E", "NE", "N", "NW", "W", "X"],
        ] {
            let mut manifest = schema2_walk_manifest(&image, "image/png", 576, 512);
            manifest.capabilities.walk_sheets[0].rows =
                rows.into_iter().map(str::to_owned).collect();
            assert!(encode_pack(&manifest, std::slice::from_ref(&image)).is_err());
        }

        let mutations: [fn(&mut WalkSheetBindingV2); 4] = [
            |binding: &mut WalkSheetBindingV2| binding.idle_column = 1,
            |binding: &mut WalkSheetBindingV2| binding.columns = 1,
            |binding: &mut WalkSheetBindingV2| binding.fps = 31,
            |binding: &mut WalkSheetBindingV2| binding.foot_y = Some(0),
        ];
        for mutate in mutations {
            let mut manifest = schema2_walk_manifest(&image, "image/png", 576, 512);
            mutate(&mut manifest.capabilities.walk_sheets[0]);
            assert!(encode_pack(&manifest, std::slice::from_ref(&image)).is_err());
        }
    }

    #[test]
    fn walk_sheet_rejects_exact_side_overlap_but_allows_race_static_key() {
        let walk = rgba_png(576, 512);
        let sprite = rgba_png(64, 64);
        for (walk_side, sprite_side) in [
            (AssetSide::Home, AssetSide::Home),
            (AssetSide::Any, AssetSide::Away),
            (AssetSide::Away, AssetSide::Any),
        ] {
            let mut manifest = schema2_walk_manifest(&walk, "image/png", 576, 512);
            manifest.capabilities.walk_sheets[0].side = walk_side;
            add_static_sprite(&mut manifest, walk.len(), &sprite, "team-1", sprite_side);
            let error = encode_pack(&manifest, &[walk.clone(), sprite.clone()])
                .err()
                .unwrap();
            assert!(error.contains("team-1/catcher"), "{error}");
        }

        let mut allowed = schema2_walk_manifest(&walk, "image/png", 576, 512);
        add_static_sprite(
            &mut allowed,
            walk.len(),
            &sprite,
            "race:human",
            AssetSide::Home,
        );
        assert!(encode_pack(&allowed, &[walk, sprite]).is_ok());
    }

    #[test]
    fn walk_sheet_rejects_duplicate_targets_and_dual_use_paths() {
        let image = rgba_png(576, 512);
        let mut duplicate = schema2_walk_manifest(&image, "image/png", 576, 512);
        duplicate
            .capabilities
            .walk_sheets
            .push(walk_binding("assets/catcher-walk.png"));
        let error = encode_pack(&duplicate, std::slice::from_ref(&image))
            .err()
            .unwrap();
        assert!(
            error.contains("team-1/catcher") && error.contains("duplicated"),
            "{error}"
        );

        let mut dual = schema2_walk_manifest(&image, "image/png", 576, 512);
        dual.capability_versions.insert("skill-icons".into(), 2);
        dual.capabilities.skill_icons.push(SkillBindingV2 {
            skill: "Block".into(),
            position_id: None,
            side: AssetSide::Any,
            path: "assets/catcher-walk.png".into(),
        });
        let error = encode_pack(&dual, &[image]).err().unwrap();
        assert!(
            error.contains("assets/catcher-walk.png") && error.contains("another capability"),
            "{error}"
        );
    }

    #[test]
    fn walk_sheet_manifest_row_rejects_unknown_keys() {
        let image = rgba_png(576, 512);
        let manifest = schema2_walk_manifest(&image, "image/png", 576, 512);
        let mut value = serde_json::to_value(manifest).unwrap();
        value["capabilities"]["walk-sheets"][0]["futureField"] = serde_json::json!(true);
        assert!(validate_pack(container(&value, &[&image])).is_err());
    }

    #[test]
    fn schema2_accepts_native_gif_images() {
        let image = gif_bytes(48, 48, 2);
        let mut manifest = schema2_skill_manifest(&image);
        manifest.files = vec![ManifestFileV2::Image(ManifestImageFileV2 {
            path: "assets/shared.gif".into(),
            mime: "image/gif".into(),
            offset: 0,
            length: image.len(),
            sha256: format!("{:x}", Sha256::digest(&image)),
            width: 48,
            height: 48,
        })];
        for binding in &mut manifest.capabilities.skill_icons {
            binding.path = "assets/shared.gif".into();
        }
        let packed = encode_pack(&manifest, std::slice::from_ref(&image)).unwrap();
        let parsed = validate_pack(packed).unwrap();
        assert_eq!(parsed.schema2.unwrap().files[0].mime(), "image/gif");
    }

    #[test]
    fn externally_built_pack_is_production_valid_when_requested() {
        let Ok(path) = std::env::var("F40KMOD_TEST_PACK") else {
            return;
        };
        let bytes = std::fs::read(path).unwrap();
        let parsed = validate_pack(bytes).unwrap();
        assert!(!parsed.manifest.files.is_empty());
    }

    #[test]
    fn schema2_rejects_normalized_targets_spoofed_audio_and_unreferenced_files() {
        let image = rgba_png(48, 48);
        let mut manifest = schema2_skill_manifest(&image);
        manifest.capabilities.skill_icons.push(SkillBindingV2 {
            skill: "b-lock".into(),
            position_id: None,
            side: AssetSide::Any,
            path: "assets/shared.png".into(),
        });
        assert!(encode_pack(&manifest, std::slice::from_ref(&image)).is_err());

        let mut manifest = schema2_skill_manifest(&image);
        manifest.capabilities.skill_icons[0].skill = "Foul Appearance".into();
        manifest.capabilities.skill_icons.push(SkillBindingV2 {
            skill: "foulappearence".into(),
            position_id: None,
            side: AssetSide::Any,
            path: "assets/shared.png".into(),
        });
        assert!(encode_pack(&manifest, std::slice::from_ref(&image)).is_err());

        let mut manifest = schema2_skill_manifest(&image);
        manifest
            .files
            .push(ManifestFileV2::Audio(ManifestAudioFileV2 {
                path: "assets/fake.wav".into(),
                mime: "audio/wav".into(),
                offset: image.len() as u64,
                length: image.len(),
                sha256: format!("{:x}", Sha256::digest(&image)),
                duration_ms: 1,
                channels: 1,
                sample_rate: 8_000,
            }));
        assert!(encode_pack(&manifest, &[image.clone(), image]).is_err());
    }

    #[test]
    fn single_range_parser_rejects_multi_and_out_of_bounds() {
        assert_eq!(parse_single_range("bytes=0-3", 10), Some((0, 4)));
        assert_eq!(parse_single_range("bytes=-3", 10), Some((7, 10)));
        assert_eq!(parse_single_range("bytes=7-", 10), Some((7, 10)));
        assert_eq!(parse_single_range("bytes=10-", 10), None);
        assert_eq!(parse_single_range("bytes=0-1,3-4", 10), None);
    }

    #[test]
    fn protocol_head_and_audio_ranges_are_exact_and_bounded() {
        let location = AssetLocation {
            container: PathBuf::new(),
            offset: 0,
            length: 8,
            mime: "audio/wav".into(),
            sha256: "0".repeat(64),
        };
        let head = asset_response(&location, b"abcdefgh".to_vec(), true, None);
        assert_eq!(head.status(), 200);
        assert!(head.body().is_empty());
        assert_eq!(head.headers()["Content-Length"], "8");
        assert_eq!(head.headers()["Accept-Ranges"], "bytes");

        let partial = asset_response(&location, b"abcdefgh".to_vec(), false, Some("bytes=2-4"));
        assert_eq!(partial.status(), 206);
        assert_eq!(partial.body(), b"cde");
        assert_eq!(partial.headers()["Content-Range"], "bytes 2-4/8");
        assert_eq!(partial.headers()["Content-Length"], "3");

        let rejected = asset_response(&location, b"abcdefgh".to_vec(), false, Some("bytes=9-"));
        assert_eq!(rejected.status(), 416);
        assert!(rejected.body().is_empty());
        assert_eq!(rejected.headers()["Content-Range"], "bytes */8");
    }

    #[test]
    fn semver_labels_aliases_and_sound_catalog_are_closed() {
        for accepted in ["0.0.0", "1.2.3-alpha.1", "1.2.3+win-x64", "1.2.3-rc.1+7"] {
            assert!(valid_semver(accepted), "{accepted}");
        }
        for rejected in [
            "1.2",
            "01.2.3",
            "1.02.3",
            "1.2.03",
            "1.2.3-01",
            "1.2.3-",
            "1.2.3+",
            "1.2.3+ok+bad",
            "1.2.3\n",
            "18446744073709551616.0.0",
        ] {
            assert!(!valid_semver(rejected), "{rejected}");
        }
        assert_eq!(
            canonical_skill_key("Foul Appearance").as_deref(),
            Some("foulappearence")
        );
        assert_eq!(canonical_skill_key("Claws").as_deref(), Some("claw"));
        assert!(canonical_skill_key(" Block\n").is_none());
        assert!(valid_sound_event_id("sad_trombone"));
        assert!(valid_sound_event_id("breatheFire"));
        assert!(!valid_sound_event_id("futureUnknownEvent"));
        for theme in [
            "fumbbl-basic",
            "fumbbl-default",
            "fumbbl-blackbox",
            "fumbbl-fumbblcup",
            "fumbbl-chaos",
            "fumbbl-darkelf",
            "fumbbl-goblin",
            "fumbbl-khorne",
            "fumbbl-necromantic",
            "fumbbl-norse",
            "fumbbl-nurgle",
            "fumbbl-skaven",
            "fumbbl-slaanesh",
            "fumbbl-tzeentch",
            "fumbbl-vampire",
        ] {
            assert!(valid_pitch_image_id(&format!("{theme}:nice")), "{theme}");
        }
        assert!(!valid_pitch_image_id("fumbbl-chaos:snow"));
    }

    #[test]
    fn quota_gc_only_replaces_unleased_exact_revisions() {
        let first = validate_pack(fixture([1, 2, 3, 255])).unwrap();
        let second = validate_pack(fixture([4, 5, 6, 255])).unwrap();
        let mut locations = HashMap::new();
        let old = descriptor(&first, Path::new("old.f40kmod"), &mut locations);
        let old_id = old.install_id.clone();
        let candidates =
            quota_gc_candidates(std::slice::from_ref(&old), &second, &HashSet::new()).unwrap();
        assert_eq!(candidates, HashSet::from([old_id.clone()]));
        assert!(
            quota_gc_candidates(&[old], &second, &HashSet::from([old_id]))
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            ensure_not_leased(&HashSet::from(["a".repeat(32)]), &"a".repeat(32)).unwrap_err(),
            "Asset pack is active or still retiring"
        );
    }

    #[test]
    fn quota_rejects_a_new_identity_after_thirty_two_retained_packs() {
        let first = validate_pack(fixture([1, 2, 3, 255])).unwrap();
        let mut incoming = validate_pack(fixture([4, 5, 6, 255])).unwrap();
        incoming.manifest.pack_id = "local.other.creator".into();
        let mut locations = HashMap::new();
        let template = descriptor(&first, Path::new("old.f40kmod"), &mut locations);
        let packs: Vec<_> = (0..MAX_INSTALLED_PACKS)
            .map(|index| {
                let mut pack = template.clone();
                pack.install_id = format!("{index:032x}");
                pack.pack_id = format!("local.retained.{index}");
                pack
            })
            .collect();
        assert_eq!(
            quota_gc_candidates(&packs, &incoming, &HashSet::new()).unwrap_err(),
            "Asset pack storage limit reached"
        );
        let same_revision: Vec<_> = packs
            .iter()
            .cloned()
            .map(|mut pack| {
                pack.pack_id = template.pack_id.clone();
                pack
            })
            .collect();
        incoming.manifest.pack_id = template.pack_id;
        assert_eq!(
            quota_gc_candidates(&same_revision, &incoming, &HashSet::new()).unwrap_err(),
            "Asset pack storage limit reached"
        );
    }

    #[test]
    fn rejects_unsafe_paths_and_normalized_binding_collisions() {
        assert!(safe_internal_path("skill-icons/block.img"));
        for bad in ["", "/x", "../x", "a/../x", "C:\\x", "\\\\host\\x", "a//b"] {
            assert!(!safe_internal_path(bad), "{bad}");
        }
        let image = png_bytes([0, 0, 0, 255]);
        let mut value = manifest(&[("a.png", &image)]);
        value["capabilities"]["skill-icons"] =
            serde_json::json!({"Foul Appearance":"a.png","foul-appearance":"a.png"});
        assert!(validate_pack(container(&value, &[&image])).is_err());

        let mut injected = manifest(&[("a.png", &image)]);
        injected["version"] = serde_json::json!("01.0.0");
        assert!(validate_pack(container(&injected, &[&image])).is_err());
    }

    #[test]
    fn rejects_bad_framing_and_an_oversize_source_before_allocation() {
        assert!(validate_pack(b"not-a-pack".to_vec()).is_err());
        let root = tempdir().unwrap();
        let path = root.path().join("huge.f40kmod");
        let file = File::create(&path).unwrap();
        file.set_len(MAX_PACK_BYTES as u64 + 1).unwrap();
        drop(file);
        assert!(read_pack(&path).is_err());
    }

    #[test]
    fn rejects_file_collisions_gaps_overlaps_trailing_and_unreferenced_payloads() {
        let a = png_bytes([1, 2, 3, 255]);
        let b = png_bytes([4, 5, 6, 255]);
        let folded = manifest(&[("A.png", &a), ("a.png", &b)]);
        assert!(validate_pack(container(&folded, &[&a, &b])).is_err());
        let mut offsets = manifest(&[("a.png", &a), ("b.png", &b)]);
        offsets["files"][1]["offset"] = serde_json::json!(a.len() + 1);
        assert!(validate_pack(container(&offsets, &[&a, &b])).is_err());
        offsets["files"][1]["offset"] = serde_json::json!(a.len() - 1);
        assert!(validate_pack(container(&offsets, &[&a, &b])).is_err());
        let one = manifest(&[("a.png", &a)]);
        assert!(validate_pack(container(&one, &[&a, &[0]])).is_err());
        let mut unreferenced = manifest(&[("a.png", &a), ("b.png", &b)]);
        unreferenced["capabilities"]["skill-icons"] = serde_json::json!({"Only":"a.png"});
        assert!(validate_pack(container(&unreferenced, &[&a, &b])).is_err());
    }

    #[test]
    fn rejects_hash_signature_malformed_png_dimensions_and_size_bombs() {
        let image = png_bytes([1, 2, 3, 255]);
        let mut value = manifest(&[("a.png", &image)]);
        value["files"][0]["sha256"] = serde_json::json!("0".repeat(64));
        assert!(validate_pack(container(&value, &[&image])).is_err());
        value = manifest(&[("a.png", &image)]);
        value["signature"] = serde_json::json!({"algorithm":"none"});
        assert!(validate_pack(container(&value, &[&image])).is_err());
        let malformed = b"not a png";
        value = manifest(&[("a.png", malformed)]);
        assert!(validate_pack(container(&value, &[malformed])).is_err());
        value = manifest(&[("a.png", &image)]);
        value["files"][0]["width"] = serde_json::json!(2);
        assert!(validate_pack(container(&value, &[&image])).is_err());
        value = manifest(&[("a.png", &image)]);
        value["files"][0]["width"] = serde_json::json!(MAX_IMAGE_PIXELS + 1);
        assert!(validate_pack(container(&value, &[&image])).is_err());
        value = manifest(&[("a.png", &image)]);
        value["files"][0]["length"] = serde_json::json!(MAX_FILE_BYTES + 1);
        assert!(validate_pack(container(&value, &[&image])).is_err());

        let mut png_with_junk = image.clone();
        png_with_junk.extend_from_slice(b"junk");
        value = manifest(&[("a.png", &png_with_junk)]);
        assert!(validate_pack(container(&value, &[&png_with_junk])).is_err());
    }

    #[test]
    fn rejects_corrupt_iend_and_ancillary_chunk_crcs() {
        let image = png_bytes([1, 2, 3, 255]);

        let mut corrupt_iend = image.clone();
        *corrupt_iend.last_mut().unwrap() ^= 0xff;
        let value = manifest(&[("a.png", &corrupt_iend)]);
        assert!(validate_pack(container(&value, &[&corrupt_iend])).is_err());

        let valid_text = insert_png_chunk_before_iend(&image, *b"tEXt", b"author\0fixture");
        let value = manifest(&[("a.png", &valid_text)]);
        assert!(validate_pack(container(&value, &[&valid_text])).is_ok());

        let mut corrupt_text = valid_text;
        let chunk_crc_last = corrupt_text.len() - 13;
        corrupt_text[chunk_crc_last] ^= 0xff;
        let value = manifest(&[("a.png", &corrupt_text)]);
        assert!(validate_pack(container(&value, &[&corrupt_text])).is_err());
    }

    #[test]
    fn rejects_apng_animation_chunks() {
        let image = png_bytes([1, 2, 3, 255]);
        let animation_chunks: [([u8; 4], &[u8]); 3] = [
            (*b"acTL", &[0, 0, 0, 1, 0, 0, 0, 0]),
            (
                *b"fcTL",
                &[
                    0, 0, 0, 0, // sequence number
                    0, 0, 0, 1, // width
                    0, 0, 0, 1, // height
                    0, 0, 0, 0, // x offset
                    0, 0, 0, 0, // y offset
                    0, 1, 0, 10, 0, 0, // delay, dispose, blend
                ],
            ),
            (*b"fdAT", &[0, 0, 0, 1]),
        ];
        for (kind, data) in animation_chunks {
            let animated = insert_png_chunk_before_iend(&image, kind, data);
            let value = manifest(&[("a.png", &animated)]);
            assert!(
                validate_pack(container(&value, &[&animated])).is_err(),
                "accepted animation chunk {}",
                String::from_utf8_lossy(&kind)
            );
        }
    }

    #[test]
    fn rejects_compressed_png_metadata_before_idat() {
        let image = png_bytes([1, 2, 3, 255]);
        let compressed = high_ratio_zlib_stream();
        let mut bad_adler = compressed.clone();
        *bad_adler.last_mut().unwrap() ^= 0xff;

        let mut iccp = b"profile\0\0".to_vec();
        iccp.extend_from_slice(&compressed);
        let mut ztxt = b"comment\0\0".to_vec();
        ztxt.extend_from_slice(&compressed);
        let mut bad_ztxt = b"comment\0\0".to_vec();
        bad_ztxt.extend_from_slice(&bad_adler);
        let mut itxt = b"comment\0\x01\0\0\0".to_vec();
        itxt.extend_from_slice(&compressed);

        for (kind, data) in [
            (*b"iCCP", iccp),
            (*b"zTXt", ztxt),
            (*b"zTXt", bad_ztxt),
            (*b"iTXt", itxt),
        ] {
            let hostile = insert_png_chunk_before_idat(&image, kind, &data);
            let value = manifest(&[("a.png", &hostile)]);
            assert!(
                validate_pack(container(&value, &[&hostile])).is_err(),
                "accepted compressed metadata chunk {}",
                String::from_utf8_lossy(&kind)
            );
        }
    }

    #[test]
    fn compressed_png_metadata_leaves_no_install_or_registry_residue() {
        let root = tempdir().unwrap();
        let storage = root.path().join("asset-packs");
        let source = root.path().join("selected.f40kmod");
        let image = png_bytes([1, 2, 3, 255]);
        let mut profile = b"profile\0\0".to_vec();
        profile.extend_from_slice(&high_ratio_zlib_stream());
        let hostile = insert_png_chunk_before_idat(&image, *b"iCCP", &profile);
        let bytes = container(&manifest(&[("a.png", &hostile)]), &[&hostile]);
        let digest = format!("{:x}", Sha256::digest(&bytes));
        std::fs::write(&source, &bytes).unwrap();

        assert!(install_path_into_dir(&storage, &source, &digest).is_err());
        assert!(
            !std::fs::read_dir(&storage).unwrap().flatten().any(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                name.ends_with(".f40kmod") || name.ends_with(".tmp")
            })
        );

        let invalid_target = storage.join(format!("{}.f40kmod", &digest[..32]));
        std::fs::write(invalid_target, bytes).unwrap();
        let (packs, locations) = scan_registry(&storage).unwrap();
        assert!(packs.is_empty());
        assert!(locations.is_empty());
    }

    #[test]
    fn rejects_aggregate_pixel_and_decoded_output_budgets() {
        // 9 x 16.8 Mpx = 151 Mpx > MAX_TOTAL_PIXELS (128 Mpx since 09-05)
        let files: Vec<_> = (0..9)
            .map(|index| ManifestFile {
                path: format!("{index}.png"),
                mime: "image/png".into(),
                offset: 0,
                length: 1,
                sha256: "0".repeat(64),
                width: 4096,
                height: 4096,
            })
            .collect();
        assert!(image_pixel_budget(&files).is_err());
        let mut decoded = MAX_TOTAL_DECODED_BYTES;
        assert!(add_decoded_budget(&mut decoded, 1).is_err());
        let mut overflow = usize::MAX;
        assert!(add_decoded_budget(&mut overflow, 1).is_err());
    }

    #[test]
    fn inspected_digest_rejects_source_swap_without_residue() {
        let root = tempdir().unwrap();
        let storage = root.path().join("asset-packs");
        let source = root.path().join("selected.f40kmod");
        let first = fixture([1, 2, 3, 255]);
        std::fs::write(&source, &first).unwrap();
        let expected = validate_pack(read_pack(&source).unwrap()).unwrap().digest;
        std::fs::write(&source, fixture([4, 5, 6, 255])).unwrap();
        assert!(install_path_into_dir(&storage, &source, &expected).is_err());
        assert!(scan_registry(&storage).unwrap().0.is_empty());
    }

    #[test]
    fn concurrent_same_id_install_is_serialized_and_exact() {
        let root = tempdir().unwrap();
        let storage = root.path().join("asset-packs");
        let source = root.path().join("selected.f40kmod");
        let bytes = fixture([1, 2, 3, 255]);
        std::fs::write(&source, &bytes).unwrap();
        let digest = validate_pack(bytes.clone()).unwrap().digest;
        let barrier = Arc::new(Barrier::new(8));
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let (storage, source, digest, barrier) = (
                    storage.clone(),
                    source.clone(),
                    digest.clone(),
                    barrier.clone(),
                );
                thread::spawn(move || {
                    barrier.wait();
                    install_path_into_dir(&storage, &source, &digest).map(|p| install_id(&p))
                })
            })
            .collect();
        let ids: Vec<_> = threads
            .into_iter()
            .map(|t| t.join().unwrap().unwrap())
            .collect();
        assert!(ids.windows(2).all(|pair| pair[0] == pair[1]));
        assert_eq!(scan_registry(&storage).unwrap().0.len(), 1);
        assert_eq!(
            std::fs::read(storage.join(format!("{}.f40kmod", ids[0]))).unwrap(),
            bytes
        );
    }

    #[test]
    fn process_install_worker() {
        let Ok(storage) = std::env::var("F40KMOD_PROCESS_STORAGE") else {
            return;
        };
        let source = std::env::var("F40KMOD_PROCESS_SOURCE").unwrap();
        let digest = std::env::var("F40KMOD_PROCESS_DIGEST").unwrap();
        install_path_into_dir(Path::new(&storage), Path::new(&source), &digest).unwrap();
    }

    #[test]
    fn concurrent_processes_share_the_filesystem_lock() {
        let root = tempdir().unwrap();
        let storage = root.path().join("asset-packs");
        let source = root.path().join("selected.f40kmod");
        let bytes = fixture([7, 8, 9, 255]);
        std::fs::write(&source, &bytes).unwrap();
        let pack = validate_pack(bytes.clone()).unwrap();
        let executable = std::env::current_exe().unwrap();
        let mut children: Vec<_> = (0..4)
            .map(|_| {
                std::process::Command::new(&executable)
                    .arg("asset_mods::tests::process_install_worker")
                    .arg("--exact")
                    .env("F40KMOD_PROCESS_STORAGE", &storage)
                    .env("F40KMOD_PROCESS_SOURCE", &source)
                    .env("F40KMOD_PROCESS_DIGEST", &pack.digest)
                    .spawn()
                    .unwrap()
            })
            .collect();
        for child in &mut children {
            assert!(child.wait().unwrap().success());
        }
        let (packs, _) = scan_registry(&storage).unwrap();
        assert_eq!(packs.len(), 1);
        assert_eq!(
            std::fs::read(storage.join(format!("{}.f40kmod", install_id(&pack)))).unwrap(),
            bytes
        );
    }

    #[test]
    fn corrupt_target_is_repaired_and_stale_temp_is_removed() {
        let root = tempdir().unwrap();
        let storage = root.path().join("asset-packs");
        let source = root.path().join("selected.f40kmod");
        let bytes = fixture([1, 2, 3, 255]);
        std::fs::write(&source, &bytes).unwrap();
        let pack = validate_pack(bytes.clone()).unwrap();
        ensure_storage_dir(&storage).unwrap();
        let target = storage.join(format!("{}.f40kmod", install_id(&pack)));
        std::fs::write(&target, b"corrupt").unwrap();
        std::fs::write(storage.join(".install-stale.tmp"), b"residue").unwrap();
        install_path_into_dir(&storage, &source, &pack.digest).unwrap();
        assert_eq!(std::fs::read(target).unwrap(), bytes);
        assert!(!storage.join(".install-stale.tmp").exists());
    }

    #[test]
    fn failed_temp_lifecycle_leaves_no_install_residue() {
        let root = tempdir().unwrap();
        let storage = root.path().join("asset-packs");
        ensure_storage_dir(&storage).unwrap();
        let (file, guard) = create_temp(&storage, "deadbeef").unwrap();
        let path = guard.path.clone();
        drop(file);
        drop(guard);
        assert!(!path.exists());
    }

    #[test]
    fn serving_fails_closed_after_installed_file_mutation() {
        let root = tempdir().unwrap();
        let path = root.path().join("pack.f40kmod");
        let bytes = fixture([1, 2, 3, 255]);
        let pack = validate_pack(bytes.clone()).unwrap();
        std::fs::write(&path, &bytes).unwrap();
        let file = &pack.manifest.files[0];
        let location = AssetLocation {
            container: path.clone(),
            offset: pack.payload_start + file.offset,
            length: file.length,
            mime: file.mime.clone(),
            sha256: file.sha256.clone(),
        };
        assert!(read_asset(&location).is_some());
        let mut changed = bytes;
        *changed.last_mut().unwrap() ^= 0xff;
        std::fs::write(path, changed).unwrap();
        assert!(read_asset(&location).is_none());
    }

    #[test]
    fn prepared_schema1_packs_keep_frozen_bytes_and_metadata_when_available() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(4)
            .unwrap()
            .join("asset-mod-packs");
        let expected = [
            (
                "Super-FUMBBL-BB2-skill-icons-1.0.0.f40kmod",
                1_045_956_usize,
                "57c9e5400fa62ea1167eb261ad9950ddf35de77a8430b1ec2f1b10ae78efc496",
                62_usize,
            ),
            (
                "Super-FUMBBL-BB3-skill-icons-1.0.0.f40kmod",
                1_501_468_usize,
                "d02910813a0d4a7d17e3c5a4924e2395fd204cfc2c257ef96db88e9420b0f1ee",
                96_usize,
            ),
        ];
        if !root.join(expected[0].0).exists() {
            return;
        }
        for (name, size, digest, coverage) in expected {
            let bytes = read_pack(&root.join(name)).unwrap();
            assert_eq!(bytes.len(), size);
            assert_eq!(format!("{:x}", Sha256::digest(&bytes)), digest);
            let pack = validate_pack(bytes).unwrap();
            assert_eq!(pack.manifest.schema_version, 1);
            assert_eq!(pack.manifest.capabilities["skill-icons"].len(), coverage);
            assert_eq!(pack.manifest.capability_versions["skill-icons"], 1);
        }
    }

    #[test]
    fn validates_external_pack_when_gate_path_is_supplied() {
        let Ok(path) = std::env::var("F40KMOD_TEST_PACK") else {
            return;
        };
        validate_pack(read_pack(Path::new(&path)).unwrap()).unwrap();
    }
}
