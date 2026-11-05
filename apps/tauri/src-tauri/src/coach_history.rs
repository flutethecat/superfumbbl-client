// --- Coach game history (owner 11-03) -------------------------------------------
// The Play card's local stats (src/game/coachGameHistory.ts): one JSON file `{ version: 1, games: [...] }` in the app
// data dir. Local only: nothing here talks to a network, and the bug report never reads it.
//
// Every read and the read-merge-write of an append run under a process-wide mutex AND an OS lock on a lock file beside
// the history, so two client windows appending at once both keep their games (Sol r1 P1). A write is the settings
// file's atomic write (unique temp + fsync + rename). Read outcomes are kept apart (Sol r1 P3):
//   - missing     no file yet;
//   - corrupt     the bytes are not a history (oversized, not UTF-8, not JSON, wrong shape / version): they are RENAMED
//                 to `coach-history.corrupt-<secs>-<n>.json` first; if that rename fails the call errors and the
//                 original stays where it is;
//   - unavailable any other read error: the call errors and nothing is written.
// Entries failing the record schema are never capped away silently: append copies the original file aside first.
// Every error string starts with "coach-history:" so the page can tell it from an older shell's "command not found".
use std::path::Path;

const COACH_HISTORY_FILE: &str = "coach-history.json";
const COACH_HISTORY_LOCK: &str = "coach-history.lock";
const MAX_COACH_HISTORY_BYTES: u64 = 8 * 1024 * 1024;
const COACH_HISTORY_CAP: usize = 200;
static COACH_HISTORY_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn coach_err(what: impl std::fmt::Display) -> String {
    format!("coach-history: {what}")
}

struct CoachHistoryLock(#[allow(dead_code)] std::fs::File);

/// Held for the life of the value: the in-process mutex guard and the OS lock on the lock file.
fn lock_coach_history(dir: &Path) -> Result<(std::sync::MutexGuard<'static, ()>, CoachHistoryLock), String> {
    let guard = COACH_HISTORY_MUTEX.lock().unwrap_or_else(|p| p.into_inner());
    std::fs::create_dir_all(dir).map_err(|e| coach_err(format!("mkdir failed: {e}")))?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(dir.join(COACH_HISTORY_LOCK))
        .map_err(|e| coach_err(format!("lock open failed: {e}")))?;
    file.lock().map_err(|e| coach_err(format!("lock failed: {e}")))?;
    Ok((guard, CoachHistoryLock(file)))
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Moves the history aside (rename); a failure leaves it in place and errors.
fn quarantine_in(dir: &Path) -> Result<(), String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let target = dir.join(format!("coach-history.corrupt-{}-{}.json", now_ms(), N.fetch_add(1, Ordering::Relaxed)));
    std::fs::rename(dir.join(COACH_HISTORY_FILE), target).map_err(|e| coach_err(format!("quarantine failed: {e}")))
}

/// A COPY of the current bytes beside it (append, before it leaves out entries that fail valid_record). Errors when
/// the copy cannot be made, so the caller writes nothing.
fn quarantine_copy_in(dir: &Path) -> Result<(), String> {
    match std::fs::copy(dir.join(COACH_HISTORY_FILE), dir.join(format!("coach-history.invalid-{}.json", now_ms()))) {
        Ok(_) => Ok(()),
        Err(e) => Err(coach_err(format!("copy failed: {e}"))),
    }
}

enum Read {
    Missing,
    /// Was corrupt; moved aside.
    Quarantined,
    Ok(String, Vec<serde_json::Value>),
}

fn history_games(value: &serde_json::Value) -> Option<Vec<serde_json::Value>> {
    let obj = value.as_object()?;
    if obj.get("version").and_then(|v| v.as_u64()) != Some(1) {
        return None;
    }
    obj.get("games")?.as_array().cloned()
}

/// Call with the lock held.
fn read_locked(dir: &Path) -> Result<Read, String> {
    let path = dir.join(COACH_HISTORY_FILE);
    let meta = match std::fs::symlink_metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Read::Missing),
        Err(e) => return Err(coach_err(format!("read failed: {e}"))),
    };
    if !meta.is_file() {
        return Err(coach_err("the history path is not a file"));
    }
    if meta.len() > MAX_COACH_HISTORY_BYTES {
        quarantine_in(dir)?;
        return Ok(Read::Quarantined);
    }
    let bytes = std::fs::read(&path).map_err(|e| coach_err(format!("read failed: {e}")))?;
    let parsed = String::from_utf8(bytes).ok().and_then(|text| {
        serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| history_games(&v))
            .map(|games| (text, games))
    });
    match parsed {
        Some((text, games)) => Ok(Read::Ok(text, games)),
        None => {
            quarantine_in(dir)?;
            Ok(Read::Quarantined)
        }
    }
}

/// `<serverId>|<gameId>`: one record per game on one server (never the FUMBBL / Super FUMBBL category).
fn record_key(entry: &serde_json::Value) -> Option<String> {
    Some(format!("{}|{}", entry.get("serverId")?.as_str()?, entry.get("gameId")?.as_str()?))
}

/// The page's record schema (src/game/coachGameHistory.ts isCoachGameRecord), checked here too: an entry failing it is
/// never merged, deduped against or capped away - append copies the ORIGINAL file aside before it drops such entries.
fn valid_record(v: &serde_json::Value) -> bool {
    use serde_json::Value;
    let s = |o: &Value, k: &str| o.get(k).map_or(false, |x| x.is_string());
    let ne = |o: &Value, k: &str| o.get(k).and_then(|x| x.as_str()).map_or(false, |x| !x.is_empty());
    let n = |o: &Value, k: &str| o.get(k).and_then(|x| x.as_f64()).map_or(false, |x| x.is_finite());
    let b = |o: &Value, k: &str| o.get(k).map_or(false, |x| x.is_boolean());
    let one_of = |o: &Value, k: &str, opts: &[&str]| o.get(k).and_then(|x| x.as_str()).map_or(false, |x| opts.contains(&x));
    let pair = |o: &Value, k: &str| o.get(k).map_or(false, |p| p.is_object() && n(p, "for") && n(p, "against"));
    let luck = |l: &Value| l.is_object() && b(l, "measured") && b(l, "average") && ["n", "score", "expected", "z", "zShown"].iter().all(|k| n(l, k));
    if !v.is_object() {
        return false;
    }
    let team = &v["myTeam"];
    let opp = &v["opponent"];
    let luck_ok = v["luck"].is_object() && ["all", "block", "armour", "action"].iter().all(|k| luck(&v["luck"][*k]));
    let breaks = &v["armourBreaks"];
    ne(v, "gameId") && ne(v, "serverId") && n(v, "savedAt")
        && (v.get("finished").map_or(false, |f| f.is_null() || f.is_string()))
        && s(v, "server") && one_of(v, "serverKind", &["fumbbl", "super"]) && s(v, "ruleset") && s(v, "coach")
        && team.is_object() && s(team, "name") && s(team, "race")
        && opp.is_object() && s(opp, "coach") && s(opp, "name") && s(opp, "race")
        && one_of(v, "result", &["W", "D", "L"])
        && (v.get("conceded").map_or(false, |c| c.is_null() || c.as_str().map_or(false, |c| c == "me" || c == "opponent")))
        && pair(v, "score") && pair(v, "tds") && pair(v, "cas") && luck_ok
        && (breaks.is_null() && v.get("armourBreaks").is_some()
            || breaks.is_object() && n(breaks, "actual") && n(breaks, "rolls") && n(breaks, "expected"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachHistoryLoad {
    /// "missing" | "corrupt" (moved aside, now missing) | "ok"
    state: &'static str,
    text: Option<String>,
}

fn load_in(dir: &Path) -> Result<CoachHistoryLoad, String> {
    let _lock = lock_coach_history(dir)?;
    Ok(match read_locked(dir)? {
        Read::Missing => CoachHistoryLoad { state: "missing", text: None },
        Read::Quarantined => CoachHistoryLoad { state: "corrupt", text: None },
        Read::Ok(text, _) => CoachHistoryLoad { state: "ok", text: Some(text) },
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachHistoryAppend {
    written: usize,
    text: String,
}

/// Read -> (copy aside if it holds invalid entries) -> dedupe -> merge -> cap -> atomic write, all under the lock.
/// `records` = a JSON array of valid records (one finished game, or migrated localStorage games). Before ANY mutation,
/// a file holding an entry that fails valid_record is copied aside whole (`coach-history.invalid-<ms>.json`); if that
/// copy fails the call errors and nothing is written. Only then are the invalid entries left out of the new file, and
/// the cap removes only the oldest VALID entries (Sol r2 P4).
fn append_in(dir: &Path, records: &str) -> Result<CoachHistoryAppend, String> {
    append_with(dir, records, quarantine_copy_in)
}

/// append_in with the quarantine copy injected (the tests make it fail).
fn append_with(dir: &Path, records: &str, copy_aside: impl Fn(&Path) -> Result<(), String>) -> Result<CoachHistoryAppend, String> {
    let incoming: Vec<serde_json::Value> = serde_json::from_str::<serde_json::Value>(records)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .ok_or_else(|| coach_err("records must be a JSON array"))?;
    if !incoming.iter().all(valid_record) {
        return Err(coach_err("every record must be a valid history record"));
    }
    let _lock = lock_coach_history(dir)?;
    let (current_text, stored) = match read_locked(dir)? {
        Read::Ok(text, games) => (Some(text), games),
        _ => (None, Vec::new()),
    };
    let (mut games, invalid): (Vec<serde_json::Value>, Vec<serde_json::Value>) = stored.into_iter().partition(valid_record);
    let mut keys: std::collections::HashSet<String> = games.iter().filter_map(record_key).collect();
    let new: Vec<serde_json::Value> = incoming.into_iter().filter(|r| keys.insert(record_key(r).unwrap_or_default())).collect();
    let written = new.len();
    if written == 0 {
        let text = current_text.unwrap_or_else(|| "{\"version\":1,\"games\":[]}".into());
        return Ok(CoachHistoryAppend { written, text });
    }
    if !invalid.is_empty() {
        copy_aside(dir)?; // the original bytes, before anything changes
    }
    games.extend(new);
    let saved_at = |g: &serde_json::Value| g.get("savedAt").and_then(|v| v.as_f64()).unwrap_or(0.0);
    games.sort_by(|a, b| saved_at(a).partial_cmp(&saved_at(b)).unwrap_or(std::cmp::Ordering::Equal));
    if games.len() > COACH_HISTORY_CAP {
        games.drain(0..games.len() - COACH_HISTORY_CAP);
    }
    let text = serde_json::json!({ "version": 1, "games": games }).to_string();
    if text.len() as u64 > MAX_COACH_HISTORY_BYTES {
        return Err(coach_err("history too large"));
    }
    super::atomic_write(dir, COACH_HISTORY_FILE, &text).map_err(coach_err)?;
    Ok(CoachHistoryAppend { written, text })
}

/// Owner 11-04 (Sol r1 P3): a CR that the rank bar's lookup returned AFTER its game's record was written. Under the
/// lock: read -> find the ONE valid record of `<server_id>|<game_id>` -> when it names `coach` as its opponent
/// (case-insensitive) and has no `opponentCr` yet, set ONLY `opponentCr` -> atomic write. Nothing else in the file
/// changes (no dedupe, merge, cap or quarantine). Ok(false) = nothing to patch (no such record, another opponent, a CR
/// already there, no history, or a non-finite CR).
fn patch_opponent_cr_in(dir: &Path, server_id: &str, game_id: &str, coach: &str, cr: f64) -> Result<bool, String> {
    if !cr.is_finite() {
        return Ok(false);
    }
    let _lock = lock_coach_history(dir)?;
    let mut games = match read_locked(dir)? {
        Read::Ok(_, games) => games,
        _ => return Ok(false),
    };
    let key = format!("{server_id}|{game_id}");
    let wanted = coach.trim().to_lowercase();
    let Some(entry) = games.iter_mut().find(|g| valid_record(g) && record_key(g).as_deref() == Some(key.as_str())) else {
        return Ok(false);
    };
    let opponent = entry["opponent"]["coach"].as_str().unwrap_or("").trim().to_lowercase();
    if opponent.is_empty() || opponent != wanted || entry.get("opponentCr").map_or(false, |v| v.as_f64().map_or(false, f64::is_finite)) {
        return Ok(false);
    }
    entry["opponentCr"] = serde_json::json!(cr);
    let text = serde_json::json!({ "version": 1, "games": games }).to_string();
    if text.len() as u64 > MAX_COACH_HISTORY_BYTES {
        return Err(coach_err("history too large"));
    }
    super::atomic_write(dir, COACH_HISTORY_FILE, &text).map_err(coach_err)?;
    Ok(true)
}

fn history_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    super::settings_dir(app).map_err(coach_err)
}

#[tauri::command]
pub fn coach_history_load(app: tauri::AppHandle) -> Result<CoachHistoryLoad, String> {
    load_in(&history_dir(&app)?)
}

#[tauri::command]
pub fn coach_history_append(app: tauri::AppHandle, records: String) -> Result<CoachHistoryAppend, String> {
    append_in(&history_dir(&app)?, &records)
}

#[tauri::command]
pub fn coach_history_patch_opponent_cr(app: tauri::AppHandle, server_id: String, game_id: String, coach: String, cr: f64) -> Result<bool, String> {
    patch_opponent_cr_in(&history_dir(&app)?, &server_id, &game_id, &coach, cr)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(server: &str, game: &str, saved_at: u64) -> String {
        let luck = r#"{"measured":true,"average":false,"n":10,"score":1,"expected":1,"z":0.5,"zShown":0.5}"#;
        format!(
            concat!(
                r#"{{"gameId":"{game}","serverId":"{server}|host","server":"{server}","serverKind":"super","finished":null,"savedAt":{saved_at},"#,
                r#""ruleset":"BB2025","coach":"me","myTeam":{{"name":"T","race":"Orc"}},"opponent":{{"coach":"o","name":"O","race":"Elf"}},"#,
                r#""result":"W","conceded":null,"score":{{"for":1,"against":0}},"tds":{{"for":1,"against":0}},"cas":{{"for":0,"against":0}},"#,
                r#""luck":{{"all":{luck},"block":{luck},"armour":{luck},"action":{luck}}},"armourBreaks":null}}"#
            ),
            game = game, server = server, saved_at = saved_at, luck = luck
        )
    }
    fn ids(text: &str) -> Vec<String> {
        let v: serde_json::Value = serde_json::from_str(text).unwrap();
        v["games"].as_array().unwrap().iter().map(|g| g["gameId"].as_str().unwrap().to_string()).collect()
    }
    fn count(dir: &Path, prefix: &str) -> usize {
        std::fs::read_dir(dir).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().starts_with(prefix)).count()
    }

    #[test]
    fn append_dedupes_by_server_identity_and_caps() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_in(dir.path()).unwrap().state, "missing");
        assert_eq!(append_in(dir.path(), &format!("[{}]", rec("fork", "1", 10))).unwrap().written, 1);
        // the same id on another server (local vs fork: both "Super FUMBBL") is another game; the same one is not
        let out = append_in(dir.path(), &format!("[{},{}]", rec("local", "1", 20), rec("fork", "1", 30))).unwrap();
        assert_eq!(out.written, 1);
        assert_eq!(ids(&out.text), vec!["1", "1"]);
        let many: Vec<String> = (0..250).map(|i| rec("fumbbl", &format!("g{i}"), 100 + i)).collect();
        let out = append_in(dir.path(), &format!("[{}]", many.join(","))).unwrap();
        let kept = ids(&out.text);
        assert_eq!(kept.len(), 200);
        assert_eq!(kept[0], "g50");
        assert!(append_in(dir.path(), "[{\"gameId\":\"5\"}]").is_err()); // not a valid record
    }

    #[test]
    fn concurrent_appends_keep_every_game() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_path_buf();
        let threads: Vec<_> = (0..8)
            .map(|i| {
                let p = path.clone();
                std::thread::spawn(move || append_in(&p, &format!("[{}]", rec("fumbbl", &format!("t{i}"), i))).unwrap())
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(ids(&load_in(&path).unwrap().text.unwrap()).len(), 8);
    }

    #[test]
    fn patch_opponent_cr_sets_only_that_field_on_the_matching_record() {
        let dir = tempfile::tempdir().unwrap();
        append_in(dir.path(), &format!("[{},{}]", rec("fumbbl", "1", 1), rec("fork", "1", 2))).unwrap();
        let before: serde_json::Value = serde_json::from_str(&load_in(dir.path()).unwrap().text.unwrap()).unwrap();
        // another opponent, another server's same game id, an unknown game: nothing
        assert!(!patch_opponent_cr_in(dir.path(), "fumbbl|host", "1", "someone", 1500.0).unwrap());
        assert!(!patch_opponent_cr_in(dir.path(), "fumbbl|other", "1", "o", 1500.0).unwrap());
        assert!(!patch_opponent_cr_in(dir.path(), "fumbbl|host", "9", "o", 1500.0).unwrap());
        assert!(!patch_opponent_cr_in(dir.path(), "fumbbl|host", "1", "o", f64::NAN).unwrap());
        assert!(patch_opponent_cr_in(dir.path(), "fumbbl|host", "1", "O", 1612.0).unwrap());
        assert!(!patch_opponent_cr_in(dir.path(), "fumbbl|host", "1", "o", 1700.0).unwrap()); // never overwritten
        let after: serde_json::Value = serde_json::from_str(&load_in(dir.path()).unwrap().text.unwrap()).unwrap();
        let (b, a) = (before["games"].as_array().unwrap(), after["games"].as_array().unwrap());
        assert_eq!(a.len(), 2);
        assert_eq!(a[0]["opponentCr"], serde_json::json!(1612.0));
        let mut patched = a[0].clone();
        patched.as_object_mut().unwrap().remove("opponentCr");
        assert_eq!(patched, b[0]); // nothing else changed
        assert_eq!(a[1], b[1]);
        assert!(a[1].get("opponentCr").is_none());
    }

    #[test]
    fn corrupt_bytes_are_moved_aside_before_anything_replaces_them() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(COACH_HISTORY_FILE), "{trunca").unwrap();
        assert_eq!(load_in(dir.path()).unwrap().state, "corrupt");
        assert_eq!(count(dir.path(), "coach-history.corrupt-"), 1);
        std::fs::write(dir.path().join(COACH_HISTORY_FILE), [0xffu8, 0xfe, 0x00]).unwrap(); // not UTF-8
        let out = append_in(dir.path(), &format!("[{}]", rec("fumbbl", "9", 1))).unwrap();
        assert_eq!(ids(&out.text), vec!["9"]);
        assert_eq!(count(dir.path(), "coach-history.corrupt-"), 2);
        std::fs::write(dir.path().join(COACH_HISTORY_FILE), "{\"version\":2,\"games\":[]}").unwrap(); // wrong version
        assert_eq!(load_in(dir.path()).unwrap().state, "corrupt");
        assert_eq!(count(dir.path(), "coach-history.corrupt-"), 3);
    }

    #[test]
    fn an_unreadable_path_errors_and_nothing_is_written() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(COACH_HISTORY_FILE)).unwrap(); // a directory where the file goes
        assert!(load_in(dir.path()).err().unwrap().starts_with("coach-history:"));
        assert!(append_in(dir.path(), &format!("[{}]", rec("fumbbl", "1", 1))).is_err());
        assert!(dir.path().join(COACH_HISTORY_FILE).is_dir());
    }

    #[test]
    fn quarantine_copy_keeps_the_original() {
        let dir = tempfile::tempdir().unwrap();
        append_in(dir.path(), &format!("[{}]", rec("fumbbl", "1", 1))).unwrap();
        quarantine_copy_in(dir.path()).unwrap();
        assert_eq!(load_in(dir.path()).unwrap().state, "ok");
        assert_eq!(count(dir.path(), "coach-history.invalid-"), 1);
    }

    #[test]
    fn invalid_entries_are_copied_aside_before_a_write_and_the_cap_drops_only_valid_ones() {
        let dir = tempfile::tempdir().unwrap();
        // a full history whose OLDEST entry is invalid (coach: 17), then one more game
        let mut games: Vec<String> = vec![rec("fumbbl", "bad", 0).replace("\"coach\":\"me\"", "\"coach\":17")];
        games.extend((1..200).map(|i| rec("fumbbl", &format!("g{i}"), 10 + i)));
        let original = format!("{{\"version\":1,\"games\":[{}]}}", games.join(","));
        std::fs::write(dir.path().join(COACH_HISTORY_FILE), &original).unwrap();
        let out = append_in(dir.path(), &format!("[{}]", rec("fumbbl", "new", 999))).unwrap();
        let kept = ids(&out.text);
        assert_eq!(kept.len(), 200); // 199 valid + the new one: no valid game was capped to make room for an invalid one
        assert!(!kept.contains(&"bad".to_string()));
        let copies: Vec<_> = std::fs::read_dir(dir.path()).unwrap().filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("coach-history.invalid-")).collect();
        assert_eq!(copies.len(), 1);
        assert_eq!(std::fs::read_to_string(copies[0].path()).unwrap(), original); // the ORIGINAL bytes, invalid entry included
    }

    #[test]
    fn a_failed_quarantine_copy_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let original = format!("{{\"version\":1,\"games\":[{},{}]}}", rec("fumbbl", "ok", 1), rec("fumbbl", "bad", 2).replace("\"savedAt\":2", "\"savedAt\":\"x\""));
        std::fs::write(dir.path().join(COACH_HISTORY_FILE), &original).unwrap();
        let err = append_with(dir.path(), &format!("[{}]", rec("fumbbl", "new", 3)), |_| Err(coach_err("copy failed: disk full"))).err().unwrap();
        assert!(err.starts_with("coach-history:"));
        assert_eq!(std::fs::read_to_string(dir.path().join(COACH_HISTORY_FILE)).unwrap(), original);
        // a history with no invalid entry never needs the copy
        let clean = tempfile::tempdir().unwrap();
        append_with(clean.path(), &format!("[{}]", rec("fumbbl", "a", 1)), |_| Err(coach_err("unused"))).unwrap();
        append_with(clean.path(), &format!("[{}]", rec("fumbbl", "b", 2)), |_| Err(coach_err("unused"))).unwrap();
    }
}
