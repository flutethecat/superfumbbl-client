//! Owner 2026-10-06: the main window's launch size and position.
//!
//! Before this, the shell persisted NO window state: tauri.conf.json's "main" window (1280x800, min 800x600, centred by
//! the OS) was built the same way at every launch and every resize/move was forgotten.
//!
//! Now: the last NORMAL (not maximized / minimized) window geometry and the maximized flag are remembered in
//! `<app data>/window-state.json` (beside settings.json, but a separate file: the window is built in setup before the
//! page has loaded its settings, and settings.json has ONE writer - the page's persist path - which a shell-side write
//! would race). Everything is kept in PHYSICAL pixels of the virtual desktop (Astra 10-06: mixing each monitor's own
//! logical space picks the wrong monitor on mixed-DPI setups): the outer position, the inner size and the frame (outer
//! minus inner, so the decorations are inside the work area too). At launch the monitor is picked by the window's
//! centre in physical space, the geometry clamped to that monitor's work area, and the window - built hidden - is moved
//! and sized in physical pixels, then shown. Without a remembered geometry, a build with the FUMBBL.COM pane opens at
//! the site-fit size (FUMBBL's ~1000 px fixed layout plus our chrome, scaled by the pane zoom - settings.json
//! `homePaneZoom`, read only); other builds keep the configured size; both OS-centred. Never below the minimum.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const WINDOW_STATE_FILE: &str = "window-state.json";

/// tauri.conf.json's minimum window size in logical pixels (kept in step with "minWidth" / "minHeight").
pub const MIN_WIDTH: f64 = 800.0;
pub const MIN_HEIGHT: f64 = 600.0;
/// fumbbl.com's fixed-width layout (~1000 px content) plus the client's gutters / scrollbar around the pane.
pub const SITE_CONTENT_WIDTH: f64 = 1000.0;
pub const SITE_CHROME_WIDTH: f64 = 280.0;
/// Blade ribbon + a useful amount of the news page + the zoom strip.
pub const SITE_FIT_HEIGHT: f64 = 900.0;

/// The file's schema. 1 = physical pixels with the frame (Astra 10-06 N4: the first build wrote LOGICAL values with no
/// version; such a file is discarded, never misread as physical).
pub const STATE_VERSION: u32 = 1;

/// Decorations assumed around the inner size when no window exists yet to measure (the default-size path), logical
/// pixels: the Windows 11 frame (8 px each side + a 31 px title bar). Keeps the OUTER default window inside the work area.
pub const DEFAULT_FRAME: (f64, f64) = (16.0, 39.0);

/// The remembered window, physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WindowState {
    /// Schema; files without it (or another one) are discarded.
    #[serde(default)]
    pub version: u32,
    /// Outer (decorated) top-left.
    pub x: f64,
    pub y: f64,
    /// Inner (client-area) size.
    pub width: f64,
    pub height: f64,
    /// Decorations: outer size minus inner size.
    #[serde(default)]
    pub frame_width: f64,
    #[serde(default)]
    pub frame_height: f64,
    #[serde(default)]
    pub maximized: bool,
}

/// A monitor: its work area in physical pixels and its scale factor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Monitor {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

impl Monitor {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

/// A remembered window put back: physical inner size and outer position.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Restore {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub maximized: bool,
}

/// The pane zoom as the page stores it (0.75-2, 5 % steps); anything else is 100 %.
pub fn sanitize_zoom(value: Option<f64>) -> f64 {
    match value {
        Some(z) if z.is_finite() && (0.75..=2.0).contains(&z) => z,
        _ => 1.0,
    }
}

/// The site-fit window size (logical) for a pane zoom: wide enough for FUMBBL's layout at that zoom, never below the minimum.
pub fn site_fit_size(zoom: f64) -> (f64, f64) {
    let z = sanitize_zoom(Some(zoom));
    ((SITE_CONTENT_WIDTH * z + SITE_CHROME_WIDTH).round().max(MIN_WIDTH), SITE_FIT_HEIGHT.max(MIN_HEIGHT))
}

/// No remembered window: the default LOGICAL inner size fitted so the OUTER window (inner + DEFAULT_FRAME) fits the
/// primary monitor's work area (OS-centred); never below the minimum.
pub fn default_size(primary: Option<Monitor>, default_logical: (f64, f64)) -> (f64, f64) {
    match primary {
        Some(m) => (
            // Floored (Astra 10-06): rounding up could put the fitted size half a pixel past the work area.
            default_logical.0.min(m.width / m.scale - DEFAULT_FRAME.0).max(MIN_WIDTH).floor(),
            default_logical.1.min(m.height / m.scale - DEFAULT_FRAME.1).max(MIN_HEIGHT).floor(),
        ),
        None => (default_logical.0.max(MIN_WIDTH), default_logical.1.max(MIN_HEIGHT)),
    }
}

/// Pure: where a remembered window comes back, all in physical pixels. The monitor is the one under the window's
/// centre (else under its top-left, else the primary); the OUTER rectangle (inner + frame) is kept inside that work
/// area; the inner size never goes below the minimum at that monitor's scale.
pub fn restore_geometry(saved: WindowState, monitors: &[Monitor], primary: Option<Monitor>) -> Option<Restore> {
    let outer_w = saved.width + saved.frame_width;
    let outer_h = saved.height + saved.frame_height;
    let centre = (saved.x + outer_w / 2.0, saved.y + outer_h / 2.0);
    let m = monitors
        .iter()
        .find(|m| m.contains(centre.0, centre.1))
        .or_else(|| monitors.iter().find(|m| m.contains(saved.x, saved.y)))
        .copied()
        .or(primary)
        .or_else(|| monitors.first().copied())?;
    let min_w = MIN_WIDTH * m.scale;
    let min_h = MIN_HEIGHT * m.scale;
    let width = saved.width.min(m.width - saved.frame_width).max(min_w).round();
    let height = saved.height.min(m.height - saved.frame_height).max(min_h).round();
    let (ow, oh) = (width + saved.frame_width, height + saved.frame_height);
    let x = saved.x.clamp(m.x, (m.x + m.width - ow).max(m.x)).round();
    let y = saved.y.clamp(m.y, (m.y + m.height - oh).max(m.y)).round();
    Some(Restore { x, y, width, height, maximized: saved.maximized })
}

/// A remembered geometry, or None when absent / not ours / nonsense.
pub fn parse_state(text: &str) -> Option<WindowState> {
    let s: WindowState = serde_json::from_str(text).ok()?;
    if s.version != STATE_VERSION {
        return None;
    }
    let finite = [s.x, s.y, s.width, s.height, s.frame_width, s.frame_height].iter().all(|v| v.is_finite());
    let sane = s.width >= 1.0 && s.height >= 1.0 && s.width <= 100_000.0 && s.height <= 100_000.0
        && (0.0..=1_000.0).contains(&s.frame_width) && (0.0..=1_000.0).contains(&s.frame_height);
    (finite && sane).then_some(s)
}

/// settings.json's `homePaneZoom` (read only; the page owns the file).
pub fn home_zoom_from_settings(text: &str) -> f64 {
    let value: serde_json::Value = serde_json::from_str(text).unwrap_or(serde_json::Value::Null);
    sanitize_zoom(value.get("homePaneZoom").and_then(|v| v.as_f64()))
}

/// What a resize / move event means for the remembered state: a minimized window is never recorded; a maximized one
/// keeps the last normal geometry and only sets the flag.
pub fn record(previous: Option<WindowState>, current: WindowState, minimized: bool) -> Option<WindowState> {
    if minimized {
        return previous;
    }
    if current.maximized {
        return Some(match previous {
            Some(p) => WindowState { maximized: true, ..p },
            None => current,
        });
    }
    Some(current)
}

// --- the shell side -------------------------------------------------------------------------------------------------

static CURRENT: Mutex<Option<WindowState>> = Mutex::new(None);

pub fn state_path(data_dir: &Path) -> PathBuf {
    data_dir.join(WINDOW_STATE_FILE)
}

fn monitor(m: &tauri::Monitor) -> Monitor {
    let r = m.work_area();
    Monitor {
        x: r.position.x as f64,
        y: r.position.y as f64,
        width: r.size.width as f64,
        height: r.size.height as f64,
        scale: m.scale_factor(),
    }
}

/// What setup does after building "main" from the adjusted config.
pub struct Plan {
    restore: Option<Restore>,
}

/// Setup, before "main" is built: a remembered window is built HIDDEN (shown once it is in place); otherwise the
/// default size is set on the config and the OS centres it.
pub fn prepare(app: &tauri::AppHandle, config: &mut tauri::utils::config::WindowConfig, site_fit: bool) -> Plan {
    use tauri::Manager;
    let Ok(dir) = app.path().app_data_dir() else { return Plan { restore: None } };
    let saved = std::fs::read_to_string(state_path(&dir)).ok().as_deref().and_then(parse_state);
    if let Ok(mut current) = CURRENT.lock() {
        *current = saved;
    }
    let monitors: Vec<Monitor> = app.available_monitors().map(|ms| ms.iter().map(monitor).collect()).unwrap_or_default();
    let primary = app.primary_monitor().ok().flatten().map(|m| monitor(&m));
    if let Some(restore) = saved.and_then(|s| restore_geometry(s, &monitors, primary)) {
        config.visible = false;
        config.center = false;
        return Plan { restore: Some(restore) };
    }
    let default_logical = if site_fit {
        let zoom = std::fs::read_to_string(dir.join("settings.json")).map(|t| home_zoom_from_settings(&t)).unwrap_or(1.0);
        site_fit_size(zoom)
    } else {
        (config.width, config.height)
    };
    let (width, height) = default_size(primary, default_logical);
    config.width = width;
    config.height = height;
    config.center = true;
    Plan { restore: None }
}

/// After build: put a remembered window in place (physical pixels), then show it; then track it.
pub fn finish(window: &tauri::WebviewWindow, plan: Plan) {
    if let Some(r) = plan.restore {
        let _ = window.set_size(tauri::PhysicalSize::new(r.width as u32, r.height as u32));
        let _ = window.set_position(tauri::PhysicalPosition::new(r.x as i32, r.y as i32));
        if r.maximized {
            let _ = window.maximize();
        }
        let _ = window.show();
    }
    track(window);
}

/// Remember the window's geometry on every move / resize; write it when the window closes.
fn track(window: &tauri::WebviewWindow) {
    use tauri::Manager;
    let handle = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
            let (Ok(pos), Ok(inner), Ok(outer)) = (handle.outer_position(), handle.inner_size(), handle.outer_size()) else { return };
            let current = WindowState {
                version: STATE_VERSION,
                x: pos.x as f64,
                y: pos.y as f64,
                width: inner.width as f64,
                height: inner.height as f64,
                frame_width: outer.width.saturating_sub(inner.width) as f64,
                frame_height: outer.height.saturating_sub(inner.height) as f64,
                maximized: handle.is_maximized().unwrap_or(false),
            };
            let minimized = handle.is_minimized().unwrap_or(false);
            if let Ok(mut state) = CURRENT.lock() {
                *state = record(*state, current, minimized);
            }
        }
        tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
            let state = CURRENT.lock().ok().and_then(|s| *s);
            if let (Some(state), Ok(dir)) = (state, handle.app_handle().path().app_data_dir()) {
                if let Ok(json) = serde_json::to_string(&state) {
                    let _ = std::fs::create_dir_all(&dir);
                    let _ = std::fs::write(state_path(&dir), json);
                }
            }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const FHD: Monitor = Monitor { x: 0.0, y: 0.0, width: 1920.0, height: 1040.0, scale: 1.0 };
    /// A 150 % monitor to the right of FHD (physical work area 2560x1400).
    const QHD150: Monitor = Monitor { x: 1920.0, y: 0.0, width: 2560.0, height: 1400.0, scale: 1.5 };
    const SMALL: Monitor = Monitor { x: 0.0, y: 0.0, width: 1366.0, height: 728.0, scale: 1.0 };

    fn win(x: f64, y: f64, w: f64, h: f64) -> WindowState {
        WindowState { version: STATE_VERSION, x, y, width: w, height: h, frame_width: 16.0, frame_height: 39.0, maximized: false }
    }

    #[test]
    fn site_fit_follows_the_pane_zoom_and_never_goes_below_the_minimum() {
        assert_eq!(site_fit_size(1.0), (1280.0, 900.0));
        assert_eq!(site_fit_size(1.5), (1780.0, 900.0));
        assert_eq!(site_fit_size(2.0), (2280.0, 900.0));
        assert_eq!(site_fit_size(0.75), (1030.0, 900.0));
        assert_eq!(site_fit_size(f64::NAN), (1280.0, 900.0));
        assert_eq!(site_fit_size(9.0), (1280.0, 900.0));
        assert_eq!(home_zoom_from_settings(r#"{"homePaneZoom":1.25,"coach":"x"}"#), 1.25);
        assert_eq!(home_zoom_from_settings(r#"{"homePaneZoom":"big"}"#), 1.0);
        assert_eq!(home_zoom_from_settings("not json"), 1.0);
    }

    #[test]
    fn without_a_remembered_window_the_default_size_fits_the_primary_work_area_in_logical_pixels() {
        assert_eq!(default_size(Some(FHD), (1280.0, 900.0)), (1280.0, 900.0));
        // The OUTER window (inner + the assumed frame) fits: 1920 - 16 wide.
        assert_eq!(default_size(Some(FHD), site_fit_size(2.0)), (1904.0, 900.0));
        // Astra F6: a 1366x728 work area - inner 1280 x (728 - 39) so the frame does not overhang.
        assert_eq!(default_size(Some(SMALL), (1280.0, 900.0)), (1280.0, 689.0));
        // A 150 % primary: its 2560x1400 physical work area is 1706.7x933.3 logical; the fitted inner size is floored,
        // so inner + frame never exceeds the work area once scaled back to physical pixels.
        let (w, h) = default_size(Some(QHD150), site_fit_size(2.0));
        assert_eq!((w, h), (1690.0, 894.0));
        assert!((w + DEFAULT_FRAME.0) * QHD150.scale <= QHD150.width);
        assert!((h + DEFAULT_FRAME.1) * QHD150.scale <= QHD150.height);
        let tiny = Monitor { x: 0.0, y: 0.0, width: 640.0, height: 480.0, scale: 1.0 };
        assert_eq!(default_size(Some(tiny), (1280.0, 900.0)), (800.0, 600.0));
        assert_eq!(default_size(None, (1280.0, 900.0)), (1280.0, 900.0));
    }

    #[test]
    fn mixed_dpi_picks_the_monitor_under_the_window_in_physical_pixels() {
        // Physically on the 150 % monitor. In per-monitor LOGICAL spaces its x (2100 / 1.5 = 1400) would fall inside
        // the FHD monitor's logical range and the wrong monitor would be picked.
        let saved = win(2100.0, 100.0, 1500.0, 1000.0);
        assert_eq!(
            restore_geometry(saved, &[FHD, QHD150], Some(FHD)),
            Some(Restore { x: 2100.0, y: 100.0, width: 1500.0, height: 1000.0, maximized: false })
        );
        // The minimum is applied at THAT monitor's scale: 800x600 logical = 1200x900 physical there.
        let small_on_hidpi = win(2000.0, 50.0, 900.0, 700.0);
        assert_eq!(restore_geometry(small_on_hidpi, &[FHD, QHD150], Some(FHD)).map(|r| (r.width, r.height)), Some((1200.0, 900.0)));
        // And on the 100 % monitor the same numbers stay as they are.
        let on_fhd = win(100.0, 50.0, 900.0, 700.0);
        assert_eq!(restore_geometry(on_fhd, &[FHD, QHD150], Some(FHD)).map(|r| (r.x, r.width, r.height)), Some((100.0, 900.0, 700.0)));
    }

    #[test]
    fn the_outer_frame_stays_inside_the_work_area() {
        // Inner 1910x1030 + a 16x39 frame would overhang the 1920x1040 work area: the inner size gives way.
        let big = win(0.0, 0.0, 1910.0, 1030.0);
        assert_eq!(restore_geometry(big, &[FHD], Some(FHD)), Some(Restore { x: 0.0, y: 0.0, width: 1904.0, height: 1001.0, maximized: false }));
        // Hanging off the bottom-right edge: pulled back so the OUTER rectangle fits.
        let off = win(1500.0, 700.0, 1000.0, 700.0);
        assert_eq!(restore_geometry(off, &[FHD], Some(FHD)).map(|r| (r.x, r.y)), Some((904.0, 301.0)));
    }

    #[test]
    fn a_window_on_a_monitor_that_is_gone_comes_back_on_the_primary() {
        let saved = win(3000.0, 100.0, 1500.0, 900.0);
        let r = restore_geometry(saved, &[FHD], Some(FHD)).unwrap();
        assert_eq!((r.width, r.height), (1500.0, 900.0));
        assert_eq!((r.x, r.y), (404.0, 100.0));
        let max = WindowState { maximized: true, ..win(10.0, 10.0, 300.0, 200.0) };
        assert_eq!(restore_geometry(max, &[FHD], Some(FHD)), Some(Restore { x: 10.0, y: 10.0, width: 800.0, height: 600.0, maximized: true }));
        assert_eq!(restore_geometry(saved, &[], None), None);
    }

    #[test]
    fn recording_skips_minimized_and_keeps_the_normal_geometry_under_maximized() {
        let normal = win(100.0, 50.0, 1300.0, 900.0);
        let maxed = WindowState { maximized: true, ..win(-8.0, -8.0, 1920.0, 1017.0) };
        let minimized = win(-32000.0, -32000.0, 160.0, 28.0);
        assert_eq!(record(None, normal, false), Some(normal));
        assert_eq!(record(Some(normal), maxed, false), Some(WindowState { maximized: true, ..normal }));
        assert_eq!(record(Some(normal), minimized, true), Some(normal));
        assert_eq!(record(None, maxed, false), Some(maxed));
        let moved = WindowState { x: 300.0, ..normal };
        assert_eq!(record(Some(WindowState { maximized: true, ..normal }), moved, false), Some(moved));
    }

    #[test]
    fn parses_only_sane_remembered_state() {
        assert_eq!(
            parse_state(r#"{"version":1,"x":1,"y":2,"width":1300,"height":900,"frame_width":16,"frame_height":39,"maximized":true}"#),
            Some(WindowState { version: 1, x: 1.0, y: 2.0, width: 1300.0, height: 900.0, frame_width: 16.0, frame_height: 39.0, maximized: true })
        );
        assert_eq!(parse_state(r#"{"version":1,"x":1,"y":2,"width":1300,"height":900}"#).map(|s| (s.maximized, s.frame_width)), Some((false, 0.0)));
        // Astra N4: the first build's file (logical values, no version) and any other version are discarded.
        assert_eq!(parse_state(r#"{"x":1,"y":2,"width":1300,"height":900,"maximized":false}"#), None);
        assert_eq!(parse_state(r#"{"version":2,"x":1,"y":2,"width":1300,"height":900}"#), None);
        // What the shell writes reads back.
        let w = win(5.0, 6.0, 1300.0, 900.0);
        assert_eq!(parse_state(&serde_json::to_string(&w).unwrap()), Some(w));
        for bad in [
            "",
            "null",
            "{}",
            r#"{"version":1,"x":1,"y":2,"width":0,"height":900}"#,
            r#"{"version":1,"x":1,"y":2,"width":1e9,"height":900}"#,
            r#"{"version":1,"x":"a","y":2,"width":1,"height":1}"#,
            r#"{"version":1,"x":1,"y":2,"width":1300,"height":900,"frame_width":-5}"#,
        ] {
            assert_eq!(parse_state(bad), None, "{bad}");
        }
    }
}
