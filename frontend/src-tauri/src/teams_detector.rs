use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::RwLock;

// ---------------------------------------------------------------------------
// Background task (copied from audio/system_detector.rs)
// ---------------------------------------------------------------------------

#[derive(Default)]
struct BackgroundTask {
    handle: Option<tokio::task::JoinHandle<()>>,
    stop_sender: Option<tokio::sync::oneshot::Sender<()>>,
}

impl BackgroundTask {
    fn start<F>(&mut self, task: F)
    where
        F: FnOnce(
                Arc<std::sync::atomic::AtomicBool>,
                tokio::sync::oneshot::Receiver<()>,
            ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>
            + Send
            + 'static,
    {
        if self.handle.is_some() {
            return;
        }

        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel();
        let running = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let running_clone = running.clone();

        let handle = tokio::spawn(async move {
            task(running_clone, stop_rx).await;
        });

        self.handle = Some(handle);
        self.stop_sender = Some(stop_tx);
    }

    fn stop(&mut self) {
        if let Some(sender) = self.stop_sender.take() {
            let _ = sender.send(());
        }
        if let Some(handle) = self.handle.take() {
            handle.abort();
        }
    }
}

impl Drop for BackgroundTask {
    fn drop(&mut self) {
        self.stop();
    }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TeamsDetectionState {
    Idle,
    MeetingDetected,
    InMeeting,
    MeetingEnding,
}

impl Default for TeamsDetectionState {
    fn default() -> Self {
        Self::Idle
    }
}

/// Managed Tauri state
pub struct TeamsDetectorState {
    inner: Arc<RwLock<DetectorInner>>,
}

impl Default for TeamsDetectorState {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(DetectorInner::default())),
        }
    }
}

impl TeamsDetectorState {
    /// Expose inner lock for tray menu (non-async, try_read).
    pub fn get_lock(&self) -> &RwLock<DetectorInner> {
        &self.inner
    }
}

pub struct DetectorInner {
    pub state: TeamsDetectionState,
    pub meeting_title: Option<String>,
    meeting_started_at: Option<chrono::DateTime<chrono::Utc>>,
    consecutive_detected: u32,
    consecutive_absent: u32,
    background: BackgroundTask,
}

impl Default for DetectorInner {
    fn default() -> Self {
        Self {
            state: TeamsDetectionState::Idle,
            meeting_title: None,
            meeting_started_at: None,
            consecutive_detected: 0,
            consecutive_absent: 0,
            background: BackgroundTask::default(),
        }
    }
}

// ---------------------------------------------------------------------------
// Platform-specific detection (Windows)
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
mod win {
    use std::collections::HashSet;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, TRUE};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        IsWindowVisible,
    };

    /// Patterns that indicate a regular (non-meeting) Teams window.
    const NON_MEETING_PATTERNS: &[&str] = &[
        "Microsoft Teams",
        "Chat |",
        "Activity |",
        "Calendar |",
        "Teams |",
        "Files |",
        "Apps |",
        "Calls |",
    ];

    /// Return `(is_meeting_window, title)` tuples for all visible windows belonging
    /// to the given set of PIDs.
    pub fn find_teams_meeting_windows(teams_pids: &HashSet<u32>) -> Vec<(bool, String)> {
        struct CallbackData {
            pids: HashSet<u32>,
            results: Vec<(bool, String)>,
        }

        let mut data = CallbackData {
            pids: teams_pids.clone(),
            results: Vec::new(),
        };

        unsafe {
            let _ = EnumWindows(
                Some(enum_windows_callback),
                LPARAM(&mut data as *mut CallbackData as isize),
            );
        }

        return data.results;

        unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let data = unsafe { &mut *(lparam.0 as *mut CallbackData) };

            // Check visibility
            if !IsWindowVisible(hwnd).as_bool() {
                return TRUE;
            }

            // Check PID
            let mut pid: u32 = 0;
            unsafe {
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
            }
            if !data.pids.contains(&pid) {
                return TRUE;
            }

            // Get window title
            let len = unsafe { GetWindowTextLengthW(hwnd) };
            if len == 0 {
                return TRUE;
            }

            let mut buf = vec![0u16; (len + 1) as usize];
            let copied = unsafe { GetWindowTextW(hwnd, &mut buf) };
            if copied == 0 {
                return TRUE;
            }
            buf.truncate(copied as usize);

            let title = OsString::from_wide(&buf).to_string_lossy().into_owned();
            if title.is_empty() {
                return TRUE;
            }

            let is_meeting = !NON_MEETING_PATTERNS
                .iter()
                .any(|p| title.starts_with(p) || title == *p);

            data.results.push((is_meeting, title));
            TRUE
        }
    }

    /// Extract a nice meeting name from a window title by stripping
    /// the " | Microsoft Teams" suffix.
    pub fn extract_meeting_title(raw_title: &str) -> String {
        if let Some(pos) = raw_title.find(" | Microsoft Teams") {
            raw_title[..pos].to_string()
        } else {
            raw_title.to_string()
        }
    }
}

/// Check whether Teams is currently in a meeting.
/// Returns `Some(meeting_title)` if yes, `None` otherwise.
#[cfg(target_os = "windows")]
fn detect_teams_meeting() -> Option<String> {
    use std::collections::HashSet;
    use sysinfo::System;

    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let teams_pids: HashSet<u32> = sys
        .processes()
        .iter()
        .filter(|(_, p)| {
            p.name()
                .to_str()
                .map(|n| n.eq_ignore_ascii_case("ms-teams.exe"))
                .unwrap_or(false)
        })
        .map(|(pid, _)| pid.as_u32())
        .collect();

    if teams_pids.is_empty() {
        return None;
    }

    let windows = win::find_teams_meeting_windows(&teams_pids);

    // Find the first window that looks like a meeting.
    for (is_meeting, title) in &windows {
        if *is_meeting && !title.is_empty() {
            return Some(win::extract_meeting_title(title));
        }
    }

    None
}

#[cfg(not(target_os = "windows"))]
fn detect_teams_meeting() -> Option<String> {
    None
}

// ---------------------------------------------------------------------------
// Background polling loop
// ---------------------------------------------------------------------------

const POLL_INTERVAL_SECS: u64 = 4;
const DEBOUNCE_THRESHOLD: u32 = 2;

async fn poll_loop<R: Runtime>(app: AppHandle<R>, state: Arc<RwLock<DetectorInner>>) {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(POLL_INTERVAL_SECS)).await;

        let meeting = tokio::task::spawn_blocking(detect_teams_meeting)
            .await
            .unwrap_or(None);

        let mut inner = state.write().await;

        match (&inner.state, meeting.as_ref()) {
            // Currently idle and we see a meeting → start debouncing
            (TeamsDetectionState::Idle, Some(title)) => {
                inner.consecutive_detected += 1;
                inner.consecutive_absent = 0;
                inner.meeting_title = Some(title.clone());
                if inner.consecutive_detected >= DEBOUNCE_THRESHOLD {
                    inner.state = TeamsDetectionState::InMeeting;
                    inner.meeting_started_at = Some(chrono::Utc::now());
                    let title_clone = title.clone();
                    log::info!("Teams meeting confirmed: {}", title_clone);
                    let _ = app.emit(
                        "teams-meeting-detected",
                        serde_json::json!({
                            "meeting_title": title_clone,
                            "detected_at": chrono::Utc::now().to_rfc3339(),
                        }),
                    );
                } else {
                    inner.state = TeamsDetectionState::MeetingDetected;
                }
            }
            // Debouncing detection and still see it
            (TeamsDetectionState::MeetingDetected, Some(title)) => {
                inner.consecutive_detected += 1;
                inner.consecutive_absent = 0;
                inner.meeting_title = Some(title.clone());
                if inner.consecutive_detected >= DEBOUNCE_THRESHOLD {
                    inner.state = TeamsDetectionState::InMeeting;
                    inner.meeting_started_at = Some(chrono::Utc::now());
                    let title_clone = title.clone();
                    log::info!("Teams meeting confirmed: {}", title_clone);
                    let _ = app.emit(
                        "teams-meeting-detected",
                        serde_json::json!({
                            "meeting_title": title_clone,
                            "detected_at": chrono::Utc::now().to_rfc3339(),
                        }),
                    );
                }
            }
            // In a meeting and still active
            (TeamsDetectionState::InMeeting, Some(title)) => {
                inner.consecutive_absent = 0;
                // Update title if it changed
                inner.meeting_title = Some(title.clone());
            }
            // In a meeting but meeting window gone → start ending debounce
            (TeamsDetectionState::InMeeting, None) => {
                inner.consecutive_absent += 1;
                inner.consecutive_detected = 0;
                if inner.consecutive_absent >= DEBOUNCE_THRESHOLD {
                    let duration = inner
                        .meeting_started_at
                        .map(|t| (chrono::Utc::now() - t).num_seconds())
                        .unwrap_or(0);
                    log::info!(
                        "Teams meeting ended (duration: {}s)",
                        duration
                    );
                    let _ = app.emit(
                        "teams-meeting-ended",
                        serde_json::json!({
                            "ended_at": chrono::Utc::now().to_rfc3339(),
                            "duration_seconds": duration,
                        }),
                    );
                    inner.state = TeamsDetectionState::Idle;
                    inner.meeting_title = None;
                    inner.meeting_started_at = None;
                    inner.consecutive_detected = 0;
                    inner.consecutive_absent = 0;
                } else {
                    inner.state = TeamsDetectionState::MeetingEnding;
                }
            }
            // Ending debounce and still gone
            (TeamsDetectionState::MeetingEnding, None) => {
                inner.consecutive_absent += 1;
                if inner.consecutive_absent >= DEBOUNCE_THRESHOLD {
                    let duration = inner
                        .meeting_started_at
                        .map(|t| (chrono::Utc::now() - t).num_seconds())
                        .unwrap_or(0);
                    log::info!(
                        "Teams meeting ended (duration: {}s)",
                        duration
                    );
                    let _ = app.emit(
                        "teams-meeting-ended",
                        serde_json::json!({
                            "ended_at": chrono::Utc::now().to_rfc3339(),
                            "duration_seconds": duration,
                        }),
                    );
                    inner.state = TeamsDetectionState::Idle;
                    inner.meeting_title = None;
                    inner.meeting_started_at = None;
                    inner.consecutive_detected = 0;
                    inner.consecutive_absent = 0;
                }
            }
            // Ending but meeting came back
            (TeamsDetectionState::MeetingEnding, Some(_title)) => {
                inner.consecutive_absent = 0;
                inner.state = TeamsDetectionState::InMeeting;
            }
            // Debouncing detection but it disappeared → reset
            (TeamsDetectionState::MeetingDetected, None) => {
                inner.state = TeamsDetectionState::Idle;
                inner.consecutive_detected = 0;
                inner.consecutive_absent = 0;
                inner.meeting_title = None;
            }
            // Idle and no meeting
            (TeamsDetectionState::Idle, None) => {
                inner.consecutive_detected = 0;
                inner.consecutive_absent = 0;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn start_teams_detection<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return Err("Teams meeting detection is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let state = app.state::<TeamsDetectorState>();
        let inner = state.inner.clone();

        let mut guard = inner.write().await;
        if guard.background.handle.is_some() {
            return Ok(()); // already running
        }

        let app_clone = app.clone();
        let inner_clone = state.inner.clone();
        guard.background.start(move |_running, _stop_rx| {
            Box::pin(poll_loop(app_clone, inner_clone))
        });

        log::info!("Teams meeting detection started");
        Ok(())
    }
}

#[tauri::command]
pub async fn stop_teams_detection<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let state = app.state::<TeamsDetectorState>();
        let mut guard = state.inner.write().await;
        guard.background.stop();
        guard.state = TeamsDetectionState::Idle;
        guard.meeting_title = None;
        guard.meeting_started_at = None;
        guard.consecutive_detected = 0;
        guard.consecutive_absent = 0;
        log::info!("Teams meeting detection stopped");
        Ok(())
    }
}

#[tauri::command]
pub async fn get_teams_detection_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<serde_json::Value, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return Ok(serde_json::json!({
            "state": "Idle",
            "meeting_title": null,
            "supported": false,
        }));
    }

    #[cfg(target_os = "windows")]
    {
        let state = app.state::<TeamsDetectorState>();
        let guard = state.inner.read().await;
        Ok(serde_json::json!({
            "state": guard.state,
            "meeting_title": guard.meeting_title,
            "supported": true,
        }))
    }
}
