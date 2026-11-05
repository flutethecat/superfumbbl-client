// --- Bug report receipts (owner 11-04, spec-bug-report-updates-2026-11-04.md) ------------------------------------
// The reporter's own bug reports (src/game/bugReportUpdates.ts): one JSON file `{ version: 1, reports: [...] }` in the
// app data dir, one entry per report this client sent - the server's report id, the receipt it returned (the secret
// the status call proves ownership with), the submit time, a title, the last status seen. Local only: nothing here
// talks to a network, nothing here logs an entry, and the bug report never attaches this file.
//
// Mirrors coach_history.rs: every read and every read-merge-write runs under a process-wide mutex AND an OS lock on a
// lock file beside the store, so two client windows never lose each other's entries. The expiry is decided INSIDE that
// read-merge-write, on the content just read (Sol r1). A write is an atomic write (unique temp + fsync + rename) whose
// file is owner-only (0600) on Unix (Sol r1: the receipts are secrets). Read outcomes are kept apart:
//   - missing     no file yet;
//   - corrupt     the bytes are not a store (oversized, not UTF-8, not JSON, wrong shape / version): they are RENAMED
//                 to `bug-receipts.corrupt-<ms>-<n>.json` first; if that rename fails the call errors and the original
//                 stays where it is;
//   - unavailable any other read error: the call errors and nothing is written.
// Every error string starts with "bug-receipts:" so the page can tell it from an older shell's "command not found".
use std::path::Path;

const RECEIPTS_FILE: &str = "bug-receipts.json";
const RECEIPTS_LOCK: &str = "bug-receipts.lock";
const MAX_RECEIPTS_BYTES: u64 = 1024 * 1024;
/// Mirrors BUG_RECEIPTS_CAP in src/game/bugReportUpdates.ts.
const RECEIPTS_CAP: usize = 50;
/// Mirror BUG_RECEIPT_MAX_AGE_MS / BUG_RECEIPT_SEEN_DONE_MS in src/game/bugReportUpdates.ts.
const MAX_AGE_MS: f64 = 180.0 * 24.0 * 3600.0 * 1000.0;
const SEEN_DONE_MS: f64 = 30.0 * 24.0 * 3600.0 * 1000.0;
static RECEIPTS_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn receipts_err(what: impl std::fmt::Display) -> String {
    format!("bug-receipts: {what}")
}

struct ReceiptsLock(#[allow(dead_code)] std::fs::File);

fn lock_receipts(dir: &Path) -> Result<(std::sync::MutexGuard<'static, ()>, ReceiptsLock), String> {
    let guard = RECEIPTS_MUTEX.lock().unwrap_or_else(|p| p.into_inner());
    std::fs::create_dir_all(dir).map_err(|e| receipts_err(format!("mkdir failed: {e}")))?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(dir.join(RECEIPTS_LOCK))
        .map_err(|e| receipts_err(format!("lock open failed: {e}")))?;
    file.lock().map_err(|e| receipts_err(format!("lock failed: {e}")))?;
    Ok((guard, ReceiptsLock(file)))
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn quarantine_in(dir: &Path) -> Result<(), String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let target = dir.join(format!("bug-receipts.corrupt-{}-{}.json", now_ms(), N.fetch_add(1, Ordering::Relaxed)));
    std::fs::rename(dir.join(RECEIPTS_FILE), target).map_err(|e| receipts_err(format!("quarantine failed: {e}")))
}

enum Read {
    Missing,
    Quarantined,
    Ok(String, Vec<serde_json::Value>),
}

fn store_reports(value: &serde_json::Value) -> Option<Vec<serde_json::Value>> {
    let obj = value.as_object()?;
    if obj.get("version").and_then(|v| v.as_u64()) != Some(1) {
        return None;
    }
    obj.get("reports")?.as_array().cloned()
}

/// Call with the lock held.
fn read_locked(dir: &Path) -> Result<Read, String> {
    let path = dir.join(RECEIPTS_FILE);
    let meta = match std::fs::symlink_metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Read::Missing),
        Err(e) => return Err(receipts_err(format!("read failed: {e}"))),
    };
    if !meta.is_file() {
        return Err(receipts_err("the store path is not a file"));
    }
    if meta.len() > MAX_RECEIPTS_BYTES {
        quarantine_in(dir)?;
        return Ok(Read::Quarantined);
    }
    let bytes = std::fs::read(&path).map_err(|e| receipts_err(format!("read failed: {e}")))?;
    let parsed = String::from_utf8(bytes).ok().and_then(|text| {
        serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| store_reports(&v))
            .map(|reports| (text, reports))
    });
    match parsed {
        Some((text, reports)) => Ok(Read::Ok(text, reports)),
        None => {
            quarantine_in(dir)?;
            Ok(Read::Quarantined)
        }
    }
}

/// The fields the merge and the cap read (the page checks the rest: src/game/bugReportUpdates.ts isStoredReceipt).
fn valid_entry(v: &serde_json::Value) -> bool {
    let ne = |k: &str| v.get(k).and_then(|x| x.as_str()).map_or(false, |x| !x.is_empty());
    v.is_object()
        && ne("id")
        && ne("receipt")
        && v.get("submittedAt").and_then(|x| x.as_f64()).map_or(false, |x| x.is_finite())
        && v.get("title").map_or(false, |x| x.is_string())
}

fn id_of(v: &serde_json::Value) -> String {
    v.get("id").and_then(|x| x.as_str()).unwrap_or_default().to_string()
}

/// An RFC 3339 / ISO-8601 stamp (`2026-11-04T10:30:00Z`, `2026-11-04T11:00:00.123+01:00`) as epoch ms; None =
/// unparseable. Sol r1: stamps are compared as INSTANTS, never as text (as text a `+01:00` stamp can sort after a later
/// `Z` one).
fn stamp_ms(text: &str) -> Option<i64> {
    let b = text.trim().as_bytes();
    let num = |from: usize, len: usize| -> Option<i64> {
        let part = b.get(from..from + len)?;
        if !part.iter().all(u8::is_ascii_digit) {
            return None;
        }
        std::str::from_utf8(part).ok()?.parse().ok()
    };
    let at = |i: usize, c: u8| b.get(i) == Some(&c);
    if !(at(4, b'-') && at(7, b'-') && (at(10, b'T') || at(10, b't') || at(10, b' ')) && at(13, b':') && at(16, b':')) {
        return None;
    }
    let (y, mo, d, h, mi, sec) = (num(0, 4)?, num(5, 2)?, num(8, 2)?, num(11, 2)?, num(14, 2)?, num(17, 2)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || sec > 60 {
        return None;
    }
    let mut i = 19;
    let mut frac_ms = 0i64;
    if at(i, b'.') {
        i += 1;
        let digits = b[i..].iter().take_while(|c| c.is_ascii_digit()).count();
        if digits == 0 {
            return None;
        }
        let ms: String = b[i..i + digits].iter().take(3).map(|&c| c as char).collect();
        frac_ms = format!("{ms:0<3}").parse().ok()?;
        i += digits;
    }
    let offset_min = match b.get(i) {
        Some(b'Z') | Some(b'z') if i + 1 == b.len() => 0,
        Some(&sign) if (sign == b'+' || sign == b'-') && i + 6 == b.len() && at(i + 3, b':') => {
            let (oh, om) = (num(i + 1, 2)?, num(i + 4, 2)?);
            if oh > 23 || om > 59 {
                return None;
            }
            (oh * 60 + om) * if sign == b'-' { -1 } else { 1 }
        }
        _ => return None,
    };
    // days from the civil date (Howard Hinnant's days_from_civil)
    let yy = if mo <= 2 { y - 1 } else { y };
    let era = yy.div_euclid(400);
    let yoe = yy - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400 + h * 3600 + mi * 60 + sec) - offset_min * 60) * 1000 + frac_ms)
}

/// Is `candidate` at least as new as `held`? Equal text is equal; unparseable on either side = yes (fail open: a date
/// format never drops a reply). Mirrors notOlder in src/game/bugReportUpdates.ts.
fn not_older(candidate: &str, held: &str) -> bool {
    if candidate == held {
        return true;
    }
    match (stamp_ms(candidate), stamp_ms(held)) {
        (Some(c), Some(h)) => c >= h,
        _ => true,
    }
}

fn str_of(v: &serde_json::Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(str::to_string)
}

fn latest_updated(v: &serde_json::Value) -> Option<String> {
    v.get("latest").and_then(|l| l.get("updatedAt")).and_then(|x| x.as_str()).map(str::to_string)
}

/// One report held twice (the file's copy and an incoming one): the file keeps its id / receipt / submit time / title;
/// "seen" only moves forward (the later lastSeenUpdatedAt and seenAt) and the newer server status wins.
fn merge_entry(stored: &serde_json::Value, incoming: &serde_json::Value) -> serde_json::Value {
    let mut out = stored.clone();
    let seen = match (str_of(stored, "lastSeenUpdatedAt"), str_of(incoming, "lastSeenUpdatedAt")) {
        (Some(a), Some(b)) => Some(if not_older(&b, &a) { b } else { a }),
        (a, b) => a.or(b),
    };
    out["lastSeenUpdatedAt"] = seen.map_or(serde_json::Value::Null, serde_json::Value::String);
    let seen_at = |v: &serde_json::Value| v.get("seenAt").and_then(|x| x.as_f64());
    out["seenAt"] = match (seen_at(stored), seen_at(incoming)) {
        (Some(a), Some(b)) => serde_json::json!(a.max(b)),
        (Some(a), None) | (None, Some(a)) => serde_json::json!(a),
        (None, None) => serde_json::Value::Null,
    };
    let take_incoming = match (latest_updated(stored), latest_updated(incoming)) {
        (_, None) => false,
        (None, Some(_)) => true,
        (Some(a), Some(b)) => not_older(&b, &a),
    };
    out["latest"] = if take_incoming { incoming["latest"].clone() } else { stored.get("latest").cloned().unwrap_or(serde_json::Value::Null) };
    out
}

/// Sol r2: "seen" is only ever the SERVER's updatedAt of what the list showed. Builds before that fix started a new
/// receipt seen at its client-clock submit time; such a baseline (never marked in the list - no seenAt - and equal to
/// submittedAt) becomes null. Mirrors withoutSyntheticBaseline in src/game/bugReportUpdates.ts.
fn without_synthetic_baseline(mut r: serde_json::Value) -> serde_json::Value {
    let never_marked = r.get("seenAt").map_or(true, |x| x.is_null());
    let submitted = r.get("submittedAt").and_then(|x| x.as_f64());
    let baseline = str_of(&r, "lastSeenUpdatedAt").and_then(|s| stamp_ms(&s));
    if never_marked && matches!((baseline, submitted), (Some(b), Some(s)) if b as f64 == s) {
        r["lastSeenUpdatedAt"] = serde_json::Value::Null;
    }
    r
}

/// CLOSED, and everything the server sent was shown (latest updatedAt not newer than lastSeenUpdatedAt, as instants).
fn closed_and_seen(r: &serde_json::Value) -> bool {
    let closed = r.get("latest").and_then(|l| l.get("status")).and_then(|s| s.as_str()) == Some("closed");
    let seen_all = match (str_of(r, "lastSeenUpdatedAt"), latest_updated(r)) {
        (Some(seen), Some(updated)) => seen == updated || matches!((stamp_ms(&seen), stamp_ms(&updated)), (Some(s), Some(u)) if s >= u),
        _ => false,
    };
    closed && seen_all && r.get("seenAt").and_then(|x| x.as_f64()).is_some()
}

/// The expiry (mirrors isExpiredReceipt in src/game/bugReportUpdates.ts), decided on the content just read under the
/// lock, never from an earlier read in another window (Sol r1): older than 180 days, or CLOSED (the contract's state; a
/// resolved report stays) and seen more than 30 days ago - the latter only for an id in `confirmed`, the ids a
/// successful status answer just returned with nothing newer than what was seen (Sol r2: never before polling, never
/// for an omitted id, never after a failed call).
fn expired(r: &serde_json::Value, now: f64, confirmed: &std::collections::HashSet<String>) -> bool {
    let num = |k: &str| r.get(k).and_then(|x| x.as_f64());
    if now - num("submittedAt").unwrap_or(now) > MAX_AGE_MS {
        return true;
    }
    confirmed.contains(&id_of(r)) && closed_and_seen(r) && num("seenAt").map_or(false, |at| now - at > SEEN_DONE_MS)
}

/// At most RECEIPTS_CAP, oldest submitted first: beyond the cap the closed-and-seen reports go first (the longest seen
/// first), then the oldest submitted. Mirrors settleReceipts in src/game/bugReportUpdates.ts.
fn cap(reports: &mut Vec<serde_json::Value>) {
    let at = |r: &serde_json::Value, k: &str| r.get(k).and_then(|v| v.as_f64()).unwrap_or(0.0);
    let by = |k: &'static str| move |a: &serde_json::Value, b: &serde_json::Value| at(a, k).partial_cmp(&at(b, k)).unwrap_or(std::cmp::Ordering::Equal);
    reports.sort_by(by("submittedAt"));
    if reports.len() <= RECEIPTS_CAP {
        return;
    }
    let over = reports.len() - RECEIPTS_CAP;
    let mut done: Vec<&serde_json::Value> = reports.iter().filter(|r| closed_and_seen(r)).collect();
    done.sort_by(|a, b| by("seenAt")(a, b));
    let evict: std::collections::HashSet<String> =
        done.into_iter().chain(reports.iter().filter(|r| !closed_and_seen(r))).take(over).map(id_of).collect();
    reports.retain(|r| !evict.contains(&id_of(r)));
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptsLoad {
    /// "missing" | "corrupt" (moved aside, now missing) | "ok"
    state: &'static str,
    text: Option<String>,
}

fn load_in(dir: &Path) -> Result<ReceiptsLoad, String> {
    let _lock = lock_receipts(dir)?;
    Ok(match read_locked(dir)? {
        Read::Missing => ReceiptsLoad { state: "missing", text: None },
        Read::Quarantined => ReceiptsLoad { state: "corrupt", text: None },
        Read::Ok(text, _) => ReceiptsLoad { state: "ok", text: Some(text) },
    })
}

/// Read -> merge `upsert` entries by id -> expire at `now` (ms) -> cap -> owner-only atomic write, all under the lock.
/// `upsert` = a JSON array of entries (empty = the expiry alone). Stored entries failing valid_entry are dropped (the
/// page never shows them either). Resolves the store as now written.
fn update_in(dir: &Path, upsert: &str, now: f64, confirmed: &str) -> Result<String, String> {
    let incoming: Vec<serde_json::Value> = serde_json::from_str::<serde_json::Value>(upsert)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .ok_or_else(|| receipts_err("upsert must be a JSON array"))?;
    if !incoming.iter().all(valid_entry) {
        return Err(receipts_err("every entry must be a valid receipt entry"));
    }
    if !now.is_finite() {
        return Err(receipts_err("now must be a finite time"));
    }
    let confirmed: std::collections::HashSet<String> = serde_json::from_str::<serde_json::Value>(confirmed)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .ok_or_else(|| receipts_err("confirmed must be a JSON array"))?
        .iter()
        .filter_map(|x| x.as_str().map(str::to_string))
        .collect();
    let _lock = lock_receipts(dir)?;
    let stored = match read_locked(dir)? {
        Read::Ok(_, reports) => reports,
        _ => Vec::new(),
    };
    let mut reports: Vec<serde_json::Value> = stored.into_iter().filter(valid_entry).map(without_synthetic_baseline).collect();
    for entry in incoming.into_iter().map(without_synthetic_baseline) {
        let id = id_of(&entry);
        match reports.iter_mut().find(|r| id_of(r) == id) {
            Some(held) => *held = merge_entry(held, &entry),
            None => reports.push(entry),
        }
    }
    reports.retain(|r| !expired(r, now, &confirmed));
    cap(&mut reports);
    let text = serde_json::json!({ "version": 1, "reports": reports }).to_string();
    if text.len() as u64 > MAX_RECEIPTS_BYTES {
        return Err(receipts_err("store too large"));
    }
    write_private(dir, &text)?;
    Ok(text)
}

/// The settings file's atomic write (unique temp + fsync + rename), owner-only for the secrets (Sol r1): on Unix the
/// temp is CREATED 0600, so the receipts are never readable by others even for a moment, and the final file is set 0600
/// again after the rename. Windows: unchanged (the per-user app data dir's ACL).
fn write_private(dir: &Path, text: &str) -> Result<(), String> {
    use std::io::Write;
    std::fs::create_dir_all(dir).map_err(|e| receipts_err(format!("mkdir failed: {e}")))?;
    let tmp = dir.join(super::unique_tmp_name(RECEIPTS_FILE));
    let target = dir.join(RECEIPTS_FILE);
    let staged = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut f = options.open(&tmp).map_err(|e| format!("write failed: {e}"))?;
        f.write_all(text.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
        f.sync_all().map_err(|e| format!("sync failed: {e}"))
    })();
    let result = staged.and_then(|()| std::fs::rename(&tmp, &target).map_err(|e| format!("rename failed: {e}")));
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result.map_err(receipts_err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| receipts_err(format!("chmod failed: {e}")))?;
    }
    Ok(())
}

fn receipts_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    super::settings_dir(app).map_err(receipts_err)
}

#[tauri::command]
pub fn bug_receipts_load(app: tauri::AppHandle) -> Result<ReceiptsLoad, String> {
    load_in(&receipts_dir(&app)?)
}

/// `now` = the page's clock (ms epoch): the expiry is decided here, on the freshly read file.
#[tauri::command]
/// `confirmed` = a JSON array of the ids the status answer just returned with nothing newer than what was seen (the
/// only ids the closed-and-seen expiry may drop).
pub fn bug_receipts_update(app: tauri::AppHandle, upsert: String, now: f64, confirmed: String) -> Result<String, String> {
    update_in(&receipts_dir(&app)?, &upsert, now, &confirmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: f64 = 1_000_000.0;
    const DAY: f64 = 24.0 * 3600.0 * 1000.0;

    fn entry(id: &str, at: u64) -> String {
        format!(r#"{{"id":"{id}","receipt":"r-{id}","submittedAt":{at},"title":"t","lastSeenUpdatedAt":null,"seenAt":null,"latest":null}}"#)
    }
    fn with_status(id: &str, submitted: f64, status: &str, seen: Option<&str>, seen_at: Option<f64>, updated: &str) -> String {
        let seen = seen.map_or("null".to_string(), |s| format!("\"{s}\""));
        let seen_at = seen_at.map_or("null".to_string(), |s| s.to_string());
        format!(
            r#"{{"id":"{id}","receipt":"r","submittedAt":{submitted},"title":"t","lastSeenUpdatedAt":{seen},"seenAt":{seen_at},"latest":{{"status":"{status}","reply":"hi","replyAt":null,"fixedIn":null,"updatedAt":"{updated}"}}}}"#
        )
    }
    fn ids(text: &str) -> Vec<String> {
        let v: serde_json::Value = serde_json::from_str(text).unwrap();
        v["reports"].as_array().unwrap().iter().map(|r| r["id"].as_str().unwrap().to_string()).collect()
    }
    fn count(dir: &Path, prefix: &str) -> usize {
        std::fs::read_dir(dir).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().starts_with(prefix)).count()
    }

    #[test]
    fn update_merges_by_id_and_caps() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_in(dir.path()).unwrap().state, "missing");
        update_in(dir.path(), &format!("[{},{}]", entry("a", 1), entry("b", 2)), NOW, "[]").unwrap();
        let out = update_in(dir.path(), &format!("[{}]", entry("a", 99)), NOW, "[]").unwrap();
        assert_eq!(ids(&out), vec!["a", "b"]);
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["reports"][0]["submittedAt"], 1); // the file's copy keeps its own fields
        let many: Vec<String> = (0..60).map(|i| entry(&format!("m{i}"), 100 + i)).collect();
        let kept = ids(&update_in(dir.path(), &format!("[{}]", many.join(",")), NOW, "[]").unwrap());
        assert_eq!(kept.len(), 50);
        assert_eq!(kept[0], "m10");
        assert!(update_in(dir.path(), r#"[{"id":"x"}]"#, NOW, "[]").is_err());
        assert!(update_in(dir.path(), "nope", NOW, "[]").is_err());
        assert!(update_in(dir.path(), "[]", f64::NAN, "[]").is_err());
    }

    #[test]
    fn seen_only_moves_forward_and_the_newer_status_wins() {
        let dir = tempfile::tempdir().unwrap();
        let with = |seen: &str, seen_at: f64, updated: &str| format!("[{}]", with_status("a", 1.0, "triaged", Some(seen), Some(seen_at), updated));
        update_in(dir.path(), &with("2026-11-05T00:00:00.000Z", 50.0, "2026-11-05T00:00:00.000Z"), NOW, "[]").unwrap();
        let out = update_in(dir.path(), &with("2026-11-04T00:00:00.000Z", 10.0, "2026-11-06T00:00:00.000Z"), NOW, "[]").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["reports"][0]["lastSeenUpdatedAt"], "2026-11-05T00:00:00.000Z");
        assert_eq!(v["reports"][0]["seenAt"], 50.0);
        assert_eq!(v["reports"][0]["latest"]["updatedAt"], "2026-11-06T00:00:00.000Z");
        let out = update_in(dir.path(), &with("2026-11-04T00:00:00.000Z", 10.0, "2026-11-01T00:00:00.000Z"), NOW, "[]").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["reports"][0]["latest"]["updatedAt"], "2026-11-06T00:00:00.000Z");
    }

    #[test]
    fn stamps_compare_as_instants_and_an_unparseable_one_is_newer() {
        assert_eq!(stamp_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(stamp_ms("1970-01-01T01:00:00.5+01:00"), Some(500));
        assert_eq!(stamp_ms("2026-11-04T10:30:00Z").unwrap() - stamp_ms("2026-11-04T11:00:00+01:00").unwrap(), 30 * 60 * 1000);
        assert_eq!(stamp_ms("2000-03-01T00:00:00Z"), Some(951_868_800_000));
        assert_eq!(stamp_ms("yesterday"), None);
        // as text "11:00:00+01:00" > "10:30:00Z", but 10:30Z is the later instant
        assert!(not_older("2026-11-04T10:30:00Z", "2026-11-04T11:00:00+01:00"));
        assert!(!not_older("2026-11-04T11:00:00+01:00", "2026-11-04T10:30:00Z"));
        assert!(not_older("garbled", "2026-11-04T10:30:00Z"));
        assert!(not_older("2026-11-04T10:30:00Z", "garbled"));

        let dir = tempfile::tempdir().unwrap();
        let one = |updated: &str| format!("[{}]", with_status("a", 1.0, "triaged", None, None, updated));
        update_in(dir.path(), &one("2026-11-04T11:00:00+01:00"), NOW, "[]").unwrap();
        let out = update_in(dir.path(), &one("2026-11-04T10:30:00Z"), NOW, "[]").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["reports"][0]["latest"]["updatedAt"], "2026-11-04T10:30:00Z");
        let out = update_in(dir.path(), &one("not a date"), NOW, "[]").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["reports"][0]["latest"]["updatedAt"], "not a date");
    }

    #[test]
    fn expiry_is_decided_on_the_file_read_under_the_lock() {
        let dir = tempfile::tempdir().unwrap();
        let now = 400.0 * DAY;
        let seen = "2026-09-01T00:00:00.000Z";
        let entries = [
            with_status("old", now - 181.0 * DAY, "triaged", None, None, seen),
            with_status("closed-done", now - 60.0 * DAY, "closed", Some(seen), Some(now - 31.0 * DAY), seen),
            with_status("closed-recent", now - 60.0 * DAY, "closed", Some(seen), Some(now - 29.0 * DAY), seen),
            with_status("resolved-done", now - 60.0 * DAY, "resolved", Some(seen), Some(now - 31.0 * DAY), seen),
            with_status("closed-unseen", now - 60.0 * DAY, "closed", Some("2026-08-01T00:00:00.000Z"), Some(now - 31.0 * DAY), seen),
        ];
        // before any status answer only the age expires (Sol r2: closed-and-seen waits for a confirming answer)
        let out = update_in(dir.path(), &format!("[{}]", entries.join(",")), now, "[]").unwrap();
        assert_eq!(ids(&out), vec!["closed-done", "closed-recent", "resolved-done", "closed-unseen"]);
        // an answer that confirmed every id: only the closed one seen > 30 days ago with nothing newer goes
        let all = r#"["closed-done","closed-recent","resolved-done","closed-unseen"]"#;
        assert_eq!(ids(&update_in(dir.path(), "[]", now, all).unwrap()), vec!["closed-recent", "resolved-done", "closed-unseen"]);
        // another window's newer status on a seen closed report (now unseen again) is kept even when confirmed
        let dir = tempfile::tempdir().unwrap();
        update_in(dir.path(), &format!("[{}]", with_status("c", now - 60.0 * DAY, "closed", Some(seen), Some(now - 31.0 * DAY), "2026-10-01T00:00:00.000Z")), now - 40.0 * DAY, "[]").unwrap();
        assert_eq!(ids(&update_in(dir.path(), "[]", now, r#"["c"]"#).unwrap()), vec!["c"]);
        assert!(update_in(dir.path(), "[]", now, "nope").is_err());
    }

    #[test]
    fn closed_and_seen_waits_for_a_confirming_answer_and_the_cap_evicts_it_first() {
        let dir = tempfile::tempdir().unwrap();
        let now = 400.0 * DAY;
        let seen = "2026-09-01T00:00:00.000Z";
        let done = with_status("done", now - 60.0 * DAY, "closed", Some(seen), Some(now - 31.0 * DAY), seen);
        update_in(dir.path(), &format!("[{done}]"), now, "[]").unwrap();
        // an answer that omitted it (or a failure: no call at all) keeps it
        assert_eq!(ids(&update_in(dir.path(), "[]", now, r#"["other"]"#).unwrap()), vec!["done"]);
        // the cap: 50 older open reports + 2 NEWER closed-and-seen (seen recently, not expired): the closed ones go first,
        // the longest seen first, though oldest-submitted alone would have evicted open ones
        let dir = tempfile::tempdir().unwrap();
        let base = (now - 10.0 * DAY) as u64;
        let mut all: Vec<String> = (0..50).map(|i| entry(&format!("open{i}"), base + i)).collect();
        all.push(with_status("seen-early", now - DAY, "closed", Some(seen), Some(now - 10.0 * DAY), seen));
        all.push(with_status("seen-late", now - DAY + 1.0, "closed", Some(seen), Some(now - 2.0 * DAY), seen));
        let kept = ids(&update_in(dir.path(), &format!("[{}]", all.join(",")), now, "[]").unwrap());
        assert_eq!(kept.len(), 50);
        assert!(!kept.contains(&"seen-early".to_string()) && !kept.contains(&"seen-late".to_string()));
        assert!(kept.contains(&"open0".to_string()));
        let mut one_more: Vec<String> = (0..50).map(|i| entry(&format!("o{i}"), base + i)).collect();
        one_more.push(with_status("seen-early", now - DAY, "closed", Some(seen), Some(now - 10.0 * DAY), seen));
        one_more.push(with_status("seen-late", now - DAY + 1.0, "closed", Some(seen), Some(now - 2.0 * DAY), seen));
        one_more.remove(0);
        let dir = tempfile::tempdir().unwrap();
        let kept = ids(&update_in(dir.path(), &format!("[{}]", one_more.join(",")), now, "[]").unwrap());
        assert_eq!(kept.len(), 50);
        assert!(!kept.contains(&"seen-early".to_string()));
        assert!(kept.contains(&"seen-late".to_string()));
    }

    #[test]
    fn a_client_clock_baseline_is_replaced_with_null() {
        let dir = tempfile::tempdir().unwrap();
        // a pre-fix entry: lastSeenUpdatedAt = its submit time, never marked
        let at = stamp_ms("2026-11-04T12:00:00.000Z").unwrap();
        let synthetic = format!(r#"{{"id":"s","receipt":"r","submittedAt":{at},"title":"t","lastSeenUpdatedAt":"2026-11-04T12:00:00.000Z","seenAt":null,"latest":null}}"#);
        let marked = format!(r#"{{"id":"m","receipt":"r","submittedAt":{at},"title":"t","lastSeenUpdatedAt":"2026-11-04T12:00:00.000Z","seenAt":5,"latest":null}}"#);
        std::fs::write(dir.path().join(RECEIPTS_FILE), format!(r#"{{"version":1,"reports":[{synthetic},{marked}]}}"#)).unwrap();
        let out = update_in(dir.path(), "[]", at as f64, "[]").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["reports"][0]["lastSeenUpdatedAt"], serde_json::Value::Null);
        assert_eq!(v["reports"][1]["lastSeenUpdatedAt"], "2026-11-04T12:00:00.000Z"); // seen in the list: the server's time
        // an incoming synthetic baseline is dropped too
        let dir = tempfile::tempdir().unwrap();
        let out = update_in(dir.path(), &format!("[{synthetic}]"), at as f64, "[]").unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["reports"][0]["lastSeenUpdatedAt"], serde_json::Value::Null);
    }

    #[cfg(unix)]
    #[test]
    fn the_store_is_owner_only_on_unix() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(RECEIPTS_FILE), r#"{"version":1,"reports":[]}"#).unwrap();
        std::fs::set_permissions(dir.path().join(RECEIPTS_FILE), std::fs::Permissions::from_mode(0o644)).unwrap();
        update_in(dir.path(), &format!("[{}]", entry("a", 1)), NOW, "[]").unwrap();
        let mode = std::fs::metadata(dir.path().join(RECEIPTS_FILE)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn concurrent_updates_keep_every_entry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_path_buf();
        let threads: Vec<_> = (0..8)
            .map(|i| {
                let p = path.clone();
                std::thread::spawn(move || update_in(&p, &format!("[{}]", entry(&format!("t{i}"), i)), NOW, "[]").unwrap())
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(ids(&load_in(&path).unwrap().text.unwrap()).len(), 8);
    }

    #[test]
    fn corrupt_bytes_are_moved_aside_before_anything_replaces_them() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(RECEIPTS_FILE), "{trunca").unwrap();
        assert_eq!(load_in(dir.path()).unwrap().state, "corrupt");
        assert_eq!(count(dir.path(), "bug-receipts.corrupt-"), 1);
        std::fs::write(dir.path().join(RECEIPTS_FILE), [0xffu8, 0xfe, 0x00]).unwrap();
        assert_eq!(ids(&update_in(dir.path(), &format!("[{}]", entry("n", 1)), NOW, "[]").unwrap()), vec!["n"]);
        assert_eq!(count(dir.path(), "bug-receipts.corrupt-"), 2);
        std::fs::write(dir.path().join(RECEIPTS_FILE), r#"{"version":2,"reports":[]}"#).unwrap();
        assert_eq!(load_in(dir.path()).unwrap().state, "corrupt");
        assert_eq!(count(dir.path(), "bug-receipts.corrupt-"), 3);
    }

    #[test]
    fn an_unreadable_path_errors_and_nothing_is_written() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(RECEIPTS_FILE)).unwrap();
        assert!(load_in(dir.path()).err().unwrap().starts_with("bug-receipts:"));
        assert!(update_in(dir.path(), &format!("[{}]", entry("a", 1)), NOW, "[]").is_err());
        assert!(dir.path().join(RECEIPTS_FILE).is_dir());
    }
}
