use crate::database::repositories::notes::NotesRepository;
use crate::state::AppState;
use log::{error as log_error, info as log_info};
use serde::{Deserialize, Serialize};
use tauri::Runtime;

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingNotesResponse {
    pub meeting_id: String,
    pub notes_markdown: Option<String>,
    pub notes_json: Option<String>,
}

/// Get notes for a meeting
#[tauri::command]
pub async fn api_get_meeting_notes<R: Runtime>(
    _app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<MeetingNotesResponse, String> {
    log_info!("api_get_meeting_notes called for meeting_id: {}", meeting_id);

    let pool = state.db_manager.pool();

    match NotesRepository::get_notes(pool, &meeting_id).await {
        Ok(Some(note)) => {
            log_info!("Found notes for meeting_id: {}", meeting_id);
            Ok(MeetingNotesResponse {
                meeting_id: note.meeting_id,
                notes_markdown: note.notes_markdown,
                notes_json: note.notes_json,
            })
        }
        Ok(None) => {
            log_info!("No notes found for meeting_id: {}", meeting_id);
            Ok(MeetingNotesResponse {
                meeting_id,
                notes_markdown: None,
                notes_json: None,
            })
        }
        Err(e) => {
            log_error!("Failed to get notes for meeting {}: {}", meeting_id, e);
            Err(format!("Failed to get notes: {}", e))
        }
    }
}

/// Save notes for a meeting (auto-save / manual save)
#[tauri::command]
pub async fn api_save_meeting_notes<R: Runtime>(
    _app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    notes_markdown: Option<String>,
    notes_json: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!("api_save_meeting_notes called for meeting_id: {}", meeting_id);

    let pool = state.db_manager.pool();

    match NotesRepository::save_notes(
        pool,
        &meeting_id,
        notes_markdown.as_deref(),
        notes_json.as_deref(),
    )
    .await
    {
        Ok(true) => {
            log_info!("Notes saved successfully for meeting_id: {}", meeting_id);
            Ok(serde_json::json!({
                "message": "Notes saved successfully"
            }))
        }
        Ok(false) => {
            log_error!("Meeting not found for notes save: {}", meeting_id);
            Err(format!("Meeting not found: {}", meeting_id))
        }
        Err(e) => {
            log_error!("Failed to save notes for meeting {}: {}", meeting_id, e);
            Err(format!("Failed to save notes: {}", e))
        }
    }
}
