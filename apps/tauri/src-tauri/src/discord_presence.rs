//! Owner 09-24: Discord Rich Presence. The client tells the LOCAL Discord desktop app what the coach is doing
//! ("vs <Coach>'s <Race> 2-1 · H2 T5", "Watching …", "Waiting for a game") over Discord's IPC socket — no server,
//! no bot. A spectate secret on the activity gives friends a Spectate button; Discord hands that secret to the
//! friend's own Super FUMBBL client (ACTIVITY_SPECTATE), which opens the game as a spectator.
//!
//! The Discord application id is a public identifier (not a secret): baked in at build time from
//! SUPER_FUMBBL_DISCORD_APP_ID, or the default below. Without an id every command is a no-op.
//! Discord rate-limits presence updates to one per 15 s; the worker coalesces to the latest state.
use std::{
    sync::{
        mpsc::{self, RecvTimeoutError, Sender},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use discord_presence::{models::EventData, Client, Event};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

/// Set by the owner on the Discord developer portal ("Super FUMBBL", 09-24); overridable per build.
const DEFAULT_APP_ID: &str = "1552724409523900468";

fn app_id() -> Option<u64> {
    option_env!("SUPER_FUMBBL_DISCORD_APP_ID")
        .unwrap_or(DEFAULT_APP_ID)
        .trim()
        .parse::<u64>()
        .ok()
        .filter(|id| *id > 0)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PresenceSpec {
    pub details: String,
    pub state: String,
    /// Unix seconds when the current game started (elapsed timer); None hides the timer.
    #[serde(default)]
    pub started_at: Option<u64>,
    /// "<server>|<gameId>" — enables Discord's Spectate button for friends.
    #[serde(default)]
    pub spectate_secret: Option<String>,
}

enum Msg {
    Set(PresenceSpec),
    Clear,
}

#[derive(Default)]
pub struct PresenceState {
    tx: Mutex<Option<Sender<Msg>>>,
}

const MIN_INTERVAL: Duration = Duration::from_secs(15);
const RETRY_INTERVAL: Duration = Duration::from_secs(30);

fn worker(app: AppHandle, id: u64, rx: mpsc::Receiver<Msg>) {
    let mut client = Client::new(id);
    let spectate_app = app.clone();
    // `.persist()`: the crate drops a listener whose handle is not kept — the Spectate hook must outlive this scope.
    client
        .on_event(Event::ActivitySpectate, move |ctx| {
            if let EventData::ActivitySpectate(ev) = ctx.event {
                let _ = spectate_app.emit("discord-spectate", ev.secret);
            }
        })
        .persist();
    client.start();
    let mut subscribed = false;
    let mut latest: Option<Msg> = None;
    let mut last_sent: Option<Instant> = None;
    loop {
        // Coalesce: wait for a message, or wake to flush a pending one once the interval has passed.
        let wait = match (&latest, last_sent) {
            (Some(_), Some(t)) => MIN_INTERVAL.saturating_sub(t.elapsed()).max(Duration::from_millis(50)),
            (Some(_), None) => Duration::from_millis(50),
            (None, _) => Duration::from_secs(3600),
        };
        match rx.recv_timeout(wait) {
            Ok(msg) => { latest = Some(msg); continue; }
            Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
        let Some(msg) = latest.take() else { continue };
        if let Some(t) = last_sent { if t.elapsed() < MIN_INTERVAL { latest = Some(msg); continue; } }
        if !subscribed {
            subscribed = client.subscribe(Event::ActivitySpectate, |s| s).is_ok();
        }
        let result = match &msg {
            Msg::Clear => client.clear_activity().map(|_| ()),
            Msg::Set(spec) => {
                let spec = spec.clone();
                client
                    .set_activity(move |act| {
                        let mut act = act
                            .details(spec.details.clone())
                            .state(spec.state.clone())
                            .assets(|a| a.large_image("superfumbbl").large_text("Super FUMBBL"));
                        if let Some(start) = spec.started_at { act = act.timestamps(|t| t.start(start)); }
                        if let Some(secret) = spec.spectate_secret.clone() {
                            let party = secret.clone();
                            act = act.party(|p| p.id(party).size((1, 2))).secrets(|s| s.spectate(secret));
                        }
                        act
                    })
                    .map(|_| ())
            }
        };
        match result {
            Ok(()) => last_sent = Some(Instant::now()),
            Err(_) => {
                // Discord not running / socket gone: keep the latest state and retry later.
                latest = Some(msg);
                last_sent = Some(Instant::now() + RETRY_INTERVAL - MIN_INTERVAL);
            }
        }
    }
}

fn sender(app: &AppHandle, state: &PresenceState) -> Option<Sender<Msg>> {
    let id = app_id()?;
    let mut guard = state.tx.lock().ok()?;
    if guard.is_none() {
        let (tx, rx) = mpsc::channel::<Msg>();
        let app = app.clone();
        thread::Builder::new()
            .name("discord-presence".into())
            .spawn(move || worker(app, id, rx))
            .ok()?;
        *guard = Some(tx);
    }
    guard.clone()
}

/// Whether a Discord application id is configured for this build.
#[tauri::command]
pub fn discord_presence_available() -> bool {
    app_id().is_some()
}

#[tauri::command]
pub fn discord_presence_set(app: AppHandle, state: State<'_, PresenceState>, spec: PresenceSpec) -> Result<bool, String> {
    match sender(&app, &state) {
        Some(tx) => tx.send(Msg::Set(spec)).map(|_| true).map_err(|e| e.to_string()),
        None => Ok(false),
    }
}

#[tauri::command]
pub fn discord_presence_clear(app: AppHandle, state: State<'_, PresenceState>) -> Result<bool, String> {
    let guard = state.tx.lock().map_err(|e| e.to_string())?;
    let _ = app;
    match guard.as_ref() {
        Some(tx) => tx.send(Msg::Clear).map(|_| true).map_err(|e| e.to_string()),
        None => Ok(false), // never connected: nothing to clear
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spec_round_trips_and_optional_fields_default() {
        let json = r#"{"details":"vs Chingis's Orc","state":"2-1 · H2 T5"}"#;
        let spec: PresenceSpec = serde_json::from_str(json).unwrap();
        assert_eq!(spec.started_at, None);
        assert_eq!(spec.spectate_secret, None);
        let back = serde_json::to_string(&spec).unwrap();
        assert!(back.contains("\"details\":\"vs Chingis's Orc\""));
    }
}
