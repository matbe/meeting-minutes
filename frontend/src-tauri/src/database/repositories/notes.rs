use crate::database::models::MeetingNote;
use chrono::Utc;
use sqlx::SqlitePool;
use tracing::{error, info as log_info};

pub struct NotesRepository;

impl NotesRepository {
    /// Get notes for a meeting. Returns None if no notes exist yet.
    pub async fn get_notes(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<MeetingNote>, sqlx::Error> {
        sqlx::query_as::<_, MeetingNote>(
            "SELECT meeting_id, notes_markdown, notes_json, created_at, updated_at FROM meeting_notes WHERE meeting_id = ?"
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await
    }

    /// Save or update notes for a meeting (upsert).
    /// Creates a new row if none exists, updates if it does.
    pub async fn save_notes(
        pool: &SqlitePool,
        meeting_id: &str,
        notes_markdown: Option<&str>,
        notes_json: Option<&str>,
    ) -> Result<bool, sqlx::Error> {
        let now = Utc::now().to_rfc3339();

        // Check if the meeting exists
        let meeting_exists: bool =
            sqlx::query("SELECT 1 FROM meetings WHERE id = ?")
                .bind(meeting_id)
                .fetch_optional(pool)
                .await?
                .is_some();

        if !meeting_exists {
            error!(
                "Attempted to save notes for non-existent meeting_id: {}",
                meeting_id
            );
            return Ok(false);
        }

        // Upsert: INSERT OR REPLACE
        sqlx::query(
            "INSERT INTO meeting_notes (meeting_id, notes_markdown, notes_json, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT(meeting_id) DO UPDATE SET \
             notes_markdown = excluded.notes_markdown, \
             notes_json = excluded.notes_json, \
             updated_at = excluded.updated_at"
        )
        .bind(meeting_id)
        .bind(notes_markdown)
        .bind(notes_json)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        // Also touch meetings.updated_at
        sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
            .bind(&now)
            .bind(meeting_id)
            .execute(pool)
            .await?;

        log_info!("Successfully saved notes for meeting_id: {}", meeting_id);
        Ok(true)
    }
}
