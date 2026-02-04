use log::{error as log_error, info as log_info};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::{
    database::{
        models::{VocabularyEntry, VocabularyEntryParsed, VocabularySet},
        repositories::vocabulary::VocabularyRepository,
    },
    state::AppState,
};

// ===== REQUEST/RESPONSE TYPES =====

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateVocabularySetRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateVocabularySetRequest {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AddVocabularyEntryRequest {
    pub set_id: String,
    pub term: String,
    pub alternatives: Vec<String>,
    pub category: Option<String>,
    pub pronunciation: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateVocabularyEntryRequest {
    pub id: String,
    pub term: String,
    pub alternatives: Vec<String>,
    pub category: Option<String>,
    pub pronunciation: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportVocabularyRequest {
    pub set_id: String,
    pub csv_content: String,
}

/// Response type for vocabulary sets with their entry counts
#[derive(Debug, Serialize, Deserialize)]
pub struct VocabularySetWithCount {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
    pub entry_count: usize,
}

// ===== TAURI COMMANDS =====

/// Get all vocabulary sets
#[tauri::command]
pub async fn get_vocabulary_sets<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<VocabularySetWithCount>, String> {
    log_info!("Getting all vocabulary sets");

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    let sets = VocabularyRepository::get_all_sets(pool)
        .await
        .map_err(|e| {
            log_error!("Failed to get vocabulary sets: {}", e);
            format!("Failed to get vocabulary sets: {}", e)
        })?;

    // Get entry count for each set
    let mut sets_with_counts = Vec::new();
    for set in sets {
        let entries = VocabularyRepository::get_entries_by_set_id(pool, &set.id)
            .await
            .unwrap_or_default();

        sets_with_counts.push(VocabularySetWithCount {
            id: set.id,
            name: set.name,
            description: set.description,
            is_default: set.is_default,
            created_at: set.created_at,
            updated_at: set.updated_at,
            entry_count: entries.len(),
        });
    }

    Ok(sets_with_counts)
}

/// Get a specific vocabulary set by ID
#[tauri::command]
pub async fn get_vocabulary_set<R: Runtime>(
    app: AppHandle<R>,
    set_id: String,
) -> Result<Option<VocabularySet>, String> {
    log_info!("Getting vocabulary set: {}", set_id);

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    VocabularyRepository::get_set_by_id(pool, &set_id)
        .await
        .map_err(|e| {
            log_error!("Failed to get vocabulary set: {}", e);
            format!("Failed to get vocabulary set: {}", e)
        })
}

/// Create a new vocabulary set
#[tauri::command]
pub async fn create_vocabulary_set<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    description: Option<String>,
) -> Result<String, String> {
    log_info!("Creating vocabulary set: {}", name);

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    VocabularyRepository::create_set(pool, &name, description.as_deref(), false)
        .await
        .map_err(|e| {
            log_error!("Failed to create vocabulary set: {}", e);
            format!("Failed to create vocabulary set: {}", e)
        })
}

/// Update an existing vocabulary set
#[tauri::command]
pub async fn update_vocabulary_set<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    name: String,
    description: Option<String>,
    is_default: bool,
) -> Result<(), String> {
    log_info!("Updating vocabulary set: {}", id);

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    VocabularyRepository::update_set(pool, &id, &name, description.as_deref(), is_default)
        .await
        .map_err(|e| {
            log_error!("Failed to update vocabulary set: {}", e);
            format!("Failed to update vocabulary set: {}", e)
        })
}

/// Delete a vocabulary set
#[tauri::command]
pub async fn delete_vocabulary_set<R: Runtime>(
    app: AppHandle<R>,
    set_id: String,
) -> Result<(), String> {
    log_info!("Deleting vocabulary set: {}", set_id);

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    VocabularyRepository::delete_set(pool, &set_id)
        .await
        .map_err(|e| {
            log_error!("Failed to delete vocabulary set: {}", e);
            format!("Failed to delete vocabulary set: {}", e)
        })
}

/// Get all entries for a vocabulary set
#[tauri::command]
pub async fn get_vocabulary_entries<R: Runtime>(
    app: AppHandle<R>,
    set_id: String,
) -> Result<Vec<VocabularyEntryParsed>, String> {
    log_info!("Getting vocabulary entries for set: {}", set_id);

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    let entries = VocabularyRepository::get_entries_by_set_id(pool, &set_id)
        .await
        .map_err(|e| {
            log_error!("Failed to get vocabulary entries: {}", e);
            format!("Failed to get vocabulary entries: {}", e)
        })?;

    // Convert to parsed entries with alternatives as Vec
    let parsed_entries: Vec<VocabularyEntryParsed> = entries.into_iter().map(|e| e.into()).collect();

    Ok(parsed_entries)
}

/// Add a new vocabulary entry
#[tauri::command]
pub async fn add_vocabulary_entry<R: Runtime>(
    app: AppHandle<R>,
    set_id: String,
    term: String,
    alternatives: Vec<String>,
    category: Option<String>,
    pronunciation: Option<String>,
) -> Result<String, String> {
    log_info!("Adding vocabulary entry: {} to set {}", term, set_id);

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    VocabularyRepository::add_entry(
        pool,
        &set_id,
        &term,
        &alternatives,
        category.as_deref(),
        pronunciation.as_deref(),
    )
    .await
    .map_err(|e| {
        log_error!("Failed to add vocabulary entry: {}", e);
        format!("Failed to add vocabulary entry: {}", e)
    })
}

/// Update an existing vocabulary entry
#[tauri::command]
pub async fn update_vocabulary_entry<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    term: String,
    alternatives: Vec<String>,
    category: Option<String>,
    pronunciation: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    log_info!("Updating vocabulary entry: {}", id);

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    VocabularyRepository::update_entry(
        pool,
        &id,
        &term,
        &alternatives,
        category.as_deref(),
        pronunciation.as_deref(),
        enabled,
    )
    .await
    .map_err(|e| {
        log_error!("Failed to update vocabulary entry: {}", e);
        format!("Failed to update vocabulary entry: {}", e)
    })
}

/// Delete a vocabulary entry
#[tauri::command]
pub async fn delete_vocabulary_entry<R: Runtime>(
    app: AppHandle<R>,
    entry_id: String,
) -> Result<(), String> {
    log_info!("Deleting vocabulary entry: {}", entry_id);

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    VocabularyRepository::delete_entry(pool, &entry_id)
        .await
        .map_err(|e| {
            log_error!("Failed to delete vocabulary entry: {}", e);
            format!("Failed to delete vocabulary entry: {}", e)
        })
}

/// Toggle entry enabled status
#[tauri::command]
pub async fn toggle_vocabulary_entry<R: Runtime>(
    app: AppHandle<R>,
    entry_id: String,
    enabled: bool,
) -> Result<(), String> {
    log_info!("Toggling vocabulary entry {} to {}", entry_id, enabled);

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    VocabularyRepository::toggle_entry_enabled(pool, &entry_id, enabled)
        .await
        .map_err(|e| {
            log_error!("Failed to toggle vocabulary entry: {}", e);
            format!("Failed to toggle vocabulary entry: {}", e)
        })
}

/// Get all active vocabulary terms for transcription hints
#[tauri::command]
pub async fn get_active_vocabulary<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<String>, String> {
    log_info!("Getting active vocabulary terms");

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    VocabularyRepository::get_active_vocabulary_terms(pool)
        .await
        .map_err(|e| {
            log_error!("Failed to get active vocabulary: {}", e);
            format!("Failed to get active vocabulary: {}", e)
        })
}

/// Get all enabled vocabulary entries with parsed alternatives (for text correction)
#[tauri::command]
pub async fn get_vocabulary_for_correction<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<VocabularyEntryParsed>, String> {
    log_info!("Getting vocabulary for correction");

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    let entries = VocabularyRepository::get_all_enabled_entries(pool)
        .await
        .map_err(|e| {
            log_error!("Failed to get vocabulary for correction: {}", e);
            format!("Failed to get vocabulary for correction: {}", e)
        })?;

    let parsed_entries: Vec<VocabularyEntryParsed> = entries.into_iter().map(|e| e.into()).collect();

    Ok(parsed_entries)
}

/// Import vocabulary from CSV content
#[tauri::command]
pub async fn import_vocabulary<R: Runtime>(
    app: AppHandle<R>,
    set_id: String,
    csv_content: String,
) -> Result<u32, String> {
    log_info!("Importing vocabulary to set: {}", set_id);

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    VocabularyRepository::import_from_csv(pool, &set_id, &csv_content)
        .await
        .map_err(|e| {
            log_error!("Failed to import vocabulary: {}", e);
            format!("Failed to import vocabulary: {}", e)
        })
}

/// Export vocabulary to CSV format
#[tauri::command]
pub async fn export_vocabulary<R: Runtime>(
    app: AppHandle<R>,
    set_id: String,
) -> Result<String, String> {
    log_info!("Exporting vocabulary from set: {}", set_id);

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    VocabularyRepository::export_to_csv(pool, &set_id)
        .await
        .map_err(|e| {
            log_error!("Failed to export vocabulary: {}", e);
            format!("Failed to export vocabulary: {}", e)
        })
}

/// Apply vocabulary correction to all transcripts for a meeting and save to database
/// This applies the corrected text to the database transcripts so:
/// 1. The correction persists when the meeting is reopened
/// 2. AI Summary uses the corrected terminology
/// 3. No need to load vocabulary on every view mount
#[tauri::command]
pub async fn apply_vocabulary_correction_to_transcripts<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
) -> Result<u32, String> {
    use crate::vocabulary_correction::apply_vocabulary_corrections;
    use crate::database::repositories::meeting::MeetingsRepository;
    use crate::database::repositories::transcript::TranscriptsRepository;

    log_info!("Applying vocabulary correction to transcripts for meeting: {}", meeting_id);

    let state = app.state::<AppState>();
    let pool = state.db_manager.pool();

    // 1. Get all enabled vocabulary entries
    let vocab_entries = VocabularyRepository::get_all_enabled_entries(pool)
        .await
        .map_err(|e| {
            log_error!("Failed to get vocabulary entries: {}", e);
            format!("Failed to get vocabulary entries: {}", e)
        })?;

    if vocab_entries.is_empty() {
        log_info!("No vocabulary entries to apply");
        return Ok(0);
    }

    // 2. Get all transcripts for this meeting
    let meeting = MeetingsRepository::get_meeting(pool, &meeting_id)
        .await
        .map_err(|e| {
            log_error!("Failed to get meeting: {}", e);
            format!("Failed to get meeting: {}", e)
        })?
        .ok_or("Meeting not found")?;

    if meeting.transcripts.is_empty() {
        log_info!("No transcripts to correct");
        return Ok(0);
    }

    // 3. Apply vocabulary corrections to each transcript
    let mut corrections = Vec::new();
    for transcript in meeting.transcripts {
        let corrected_text = apply_vocabulary_corrections(&transcript.text, &vocab_entries);
        
        // Only store if text was actually corrected
        if corrected_text != transcript.text {
            let transcript_id = transcript.id.clone();
            corrections.push((transcript_id.clone(), corrected_text));
            log_info!("Vocabulary correction applied to transcript: {}", transcript_id);
        }
    }

    // 4. Update all corrected transcripts in the database
    if !corrections.is_empty() {
        let count = TranscriptsRepository::update_all_meeting_transcripts_text(pool, &meeting_id, corrections)
            .await
            .map_err(|e| {
                log_error!("Failed to update transcripts: {}", e);
                format!("Failed to update transcripts: {}", e)
            })?;
        
        log_info!("✅ Applied vocabulary correction to {} transcripts", count);
        Ok(count)
    } else {
        log_info!("No vocabulary corrections needed");
        Ok(0)
    }
}

