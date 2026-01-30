//! Speaker diarization commands for tauri
//!
//! Provides speaker recognition and labeling functionality.
//! Calls Python backend for pyannote.audio-based voice recognition.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{command, AppHandle, Runtime};

use crate::database::repositories::meeting::MeetingsRepository;
use crate::state::AppState;

/// Represents a detected speaker in the meeting
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Speaker {
    /// Unique identifier for the speaker
    pub id: String,
    /// Display label (e.g., "Speaker 1", "John")
    pub label: String,
    /// Number of transcript segments for this speaker
    pub segments: usize,
    /// Total speaking duration in seconds
    pub total_duration: f64,
    /// Start time of a sample audio clip for this speaker (in seconds)
    pub sample_audio_start: Option<f64>,
}

/// Represents speaker labels for transcript segments
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerLabel {
    /// Transcript segment ID
    pub segment_id: String,
    /// Speaker ID
    pub speaker_id: String,
    /// Speaker display label
    pub speaker_label: String,
}

/// Internal structure to track speaker statistics during diarization
struct SpeakerStats {
    id: String,
    label: String,
    segment_count: usize,
    total_duration: f64,
    first_audio_start: Option<f64>,
}

/// Response from the Python diarization API
#[derive(Debug, Clone, Deserialize)]
struct DiarizationApiResponse {
    status: String,
    result: Option<DiarizationResult>,
}

/// Diarization result from pyannote.audio
#[derive(Debug, Clone, Deserialize)]
struct DiarizationResult {
    segments: Vec<DiarizationSegment>,
    num_speakers: usize,
    duration: f64,
}

/// A speaker segment from diarization
#[derive(Debug, Clone, Deserialize)]
struct DiarizationSegment {
    speaker_id: String,
    start_time: f64,
    end_time: f64,
}

// Store diarization results in memory (in production, this would be in the database)
use std::sync::LazyLock;
use std::sync::Mutex;

static DIARIZATION_CACHE: LazyLock<Mutex<HashMap<String, (Vec<SpeakerLabel>, Vec<Speaker>)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Get the audio file path for a meeting
async fn get_audio_path_for_meeting(pool: &sqlx::SqlitePool, meeting_id: &str) -> Result<String, String> {
    // Get meeting metadata to find folder path
    let meeting = MeetingsRepository::get_meeting_metadata(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to get meeting: {}", e))?
        .ok_or_else(|| format!("Meeting not found: {}", meeting_id))?;
    
    let folder_path = meeting.folder_path
        .ok_or_else(|| "Meeting has no folder path".to_string())?;
    
    // Look for audio file in the folder
    let folder = std::path::Path::new(&folder_path);
    
    // Check for audio.mp4 first (default name)
    let audio_mp4 = folder.join("audio.mp4");
    if audio_mp4.exists() {
        return Ok(audio_mp4.to_string_lossy().to_string());
    }
    
    // Check for other audio formats
    const AUDIO_EXTENSIONS: &[&str] = &["mp4", "wav", "m4a", "webm", "ogg", "flac", "aac"];
    
    let entries = std::fs::read_dir(folder)
        .map_err(|e| format!("Failed to read folder: {}", e))?;
    
    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(ext) = path.extension() {
            if AUDIO_EXTENSIONS.contains(&ext.to_string_lossy().to_lowercase().as_str()) {
                return Ok(path.to_string_lossy().to_string());
            }
        }
    }
    
    Err("No audio file found for meeting".to_string())
}

/// Call the Python backend diarization API
async fn call_diarization_api(audio_path: &str, meeting_id: &str) -> Result<DiarizationResult, String> {
    let client = reqwest::Client::new();
    
    let request_body = serde_json::json!({
        "audio_path": audio_path,
        "meeting_id": meeting_id
    });
    
    log::info!("Calling diarization API for audio: {}", audio_path);
    
    let response = client
        .post("http://localhost:5167/diarization/process")
        .json(&request_body)
        .timeout(std::time::Duration::from_secs(600)) // 10 minute timeout for long audio
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                "Backend server not running. Please start the Meetily backend service (port 5167).".to_string()
            } else if e.is_timeout() {
                "Diarization timed out. The audio file may be too long.".to_string()
            } else {
                format!("Failed to connect to diarization service: {}", e)
            }
        })?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        
        // Parse common error cases
        if status.as_u16() == 503 {
            return Err("Speaker diarization dependencies not installed. Please install pyannote.audio.".to_string());
        }
        if error_text.contains("HF_TOKEN") || error_text.contains("Hugging Face") || error_text.contains("token") {
            return Err("Hugging Face token not configured. Please set your token in Settings → Speakers.".to_string());
        }
        if error_text.contains("model") && error_text.contains("load") {
            return Err("Diarization model not loaded. Please load the model in Settings → Speakers.".to_string());
        }
        
        return Err(format!("Diarization failed: {}", error_text));
    }
    
    let api_response: DiarizationApiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse diarization response: {}", e))?;
    
    api_response.result
        .ok_or_else(|| "Diarization returned no result".to_string())
}

/// Fallback heuristic-based speaker assignment when backend is unavailable
fn assign_speakers_heuristic(
    transcripts: &[(String, String, Option<f64>, Option<f64>)], // (id, text, start, end)
) -> (Vec<SpeakerLabel>, Vec<Speaker>) {
    // Simple turn-based heuristic: assign speakers based on timing gaps
    const TURN_GAP_THRESHOLD: f64 = 1.5; // Gap suggesting speaker change
    
    let mut speaker_labels = Vec::new();
    let mut speaker_stats: HashMap<String, SpeakerStats> = HashMap::new();
    let mut current_speaker = 1;
    let mut last_end_time: Option<f64> = None;
    
    for (seg_id, _text, audio_start, audio_end) in transcripts {
        let t_start = audio_start.unwrap_or(0.0);
        let t_end = audio_end.unwrap_or(t_start + 3.0);
        
        // Check for speaker change based on gap
        if let Some(last_end) = last_end_time {
            let gap = t_start - last_end;
            if gap > TURN_GAP_THRESHOLD {
                // Alternate between 2 speakers
                current_speaker = if current_speaker == 1 { 2 } else { 1 };
            }
        }
        
        let speaker_id = format!("SPEAKER_0{}", current_speaker - 1);
        let speaker_label = format!("Speaker {}", current_speaker);
        let duration = t_end - t_start;
        
        // Update speaker stats
        let stats = speaker_stats.entry(speaker_id.clone()).or_insert(SpeakerStats {
            id: speaker_id.clone(),
            label: speaker_label.clone(),
            segment_count: 0,
            total_duration: 0.0,
            first_audio_start: Some(t_start),
        });
        stats.segment_count += 1;
        stats.total_duration += duration;
        
        speaker_labels.push(SpeakerLabel {
            segment_id: seg_id.clone(),
            speaker_id: speaker_id.clone(),
            speaker_label,
        });
        
        last_end_time = Some(t_end);
    }
    
    let speakers: Vec<Speaker> = speaker_stats
        .into_values()
        .map(|stats| Speaker {
            id: stats.id,
            label: stats.label,
            segments: stats.segment_count,
            total_duration: stats.total_duration,
            sample_audio_start: stats.first_audio_start,
        })
        .collect();
    
    (speaker_labels, speakers)
}

/// Assign speakers to transcript segments based on diarization results
fn assign_speakers_from_diarization(
    diarization: &DiarizationResult,
    transcripts: &[(String, String, Option<f64>, Option<f64>)], // (id, text, start, end)
) -> (Vec<SpeakerLabel>, Vec<Speaker>) {
    let mut speaker_labels = Vec::new();
    let mut speaker_stats: HashMap<String, SpeakerStats> = HashMap::new();
    
    for (seg_id, _text, audio_start, audio_end) in transcripts {
        let t_start = audio_start.unwrap_or(0.0);
        let t_end = audio_end.unwrap_or(t_start + 3.0);
        
        // Find the speaker with most overlap for this transcript segment
        let mut best_speaker: Option<&str> = None;
        let mut best_overlap = 0.0f64;
        
        for diar_seg in &diarization.segments {
            let overlap_start = t_start.max(diar_seg.start_time);
            let overlap_end = t_end.min(diar_seg.end_time);
            let overlap = (overlap_end - overlap_start).max(0.0);
            
            if overlap > best_overlap {
                best_overlap = overlap;
                best_speaker = Some(&diar_seg.speaker_id);
            }
        }
        
        let speaker_id = best_speaker.unwrap_or("SPEAKER_00").to_string();
        let speaker_num = speaker_id.chars().last()
            .and_then(|c| c.to_digit(10))
            .unwrap_or(0) as usize + 1;
        let speaker_label = format!("Speaker {}", speaker_num);
        
        let duration = t_end - t_start;
        
        // Update speaker stats
        let stats = speaker_stats.entry(speaker_id.clone()).or_insert(SpeakerStats {
            id: speaker_id.clone(),
            label: speaker_label.clone(),
            segment_count: 0,
            total_duration: 0.0,
            first_audio_start: Some(t_start),
        });
        stats.segment_count += 1;
        stats.total_duration += duration;
        if stats.first_audio_start.is_none() {
            stats.first_audio_start = Some(t_start);
        }
        
        speaker_labels.push(SpeakerLabel {
            segment_id: seg_id.clone(),
            speaker_id: speaker_id.clone(),
            speaker_label,
        });
    }
    
    // Convert stats to Speaker objects
    let speakers: Vec<Speaker> = speaker_stats
        .into_values()
        .map(|stats| Speaker {
            id: stats.id,
            label: stats.label,
            segments: stats.segment_count,
            total_duration: stats.total_duration,
            sample_audio_start: stats.first_audio_start,
        })
        .collect();
    
    (speaker_labels, speakers)
}

/// Re-transcribe the meeting audio with speaker diarization enabled.
/// This calls the Python backend which uses pyannote.audio for voice-based speaker recognition.
/// Falls back to heuristic-based diarization if the backend is unavailable.
#[command]
pub async fn retranscribe_with_diarization<R: Runtime>(
    _app: AppHandle<R>,
    meeting_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SpeakerLabel>, String> {
    log::info!(
        "retranscribe_with_diarization called for meeting: {}",
        meeting_id
    );

    let pool = state.db_manager.pool();

    // Get transcripts for the meeting (needed for mapping speakers to segments)
    let transcripts =
        MeetingsRepository::get_meeting_transcripts_paginated(pool, &meeting_id, 1000, 0)
            .await
            .map_err(|e| format!("Failed to get transcripts: {}", e))?;

    if transcripts.0.is_empty() {
        return Err("No transcripts found for this meeting".to_string());
    }

    log::info!(
        "Processing {} transcripts for speaker diarization",
        transcripts.0.len()
    );

    // Convert to format needed for speaker assignment
    let segments: Vec<(String, String, Option<f64>, Option<f64>)> = transcripts
        .0
        .iter()
        .map(|t| {
            (
                t.id.clone(),
                t.transcript.clone(),
                t.audio_start_time,
                t.audio_end_time,
            )
        })
        .collect();

    // Try to get audio file path for pyannote.audio diarization
    let audio_path_result = get_audio_path_for_meeting(pool, &meeting_id).await;
    
    let (speaker_labels, speakers, use_fallback) = match audio_path_result {
        Ok(audio_path) => {
            log::info!("Found audio file: {}", audio_path);
            
            // Try Python backend for actual diarization using pyannote.audio
            log::info!("Calling pyannote.audio diarization via Python backend...");
            match call_diarization_api(&audio_path, &meeting_id).await {
                Ok(diarization_result) => {
                    log::info!(
                        "pyannote.audio detected {} speakers in {:.1}s of audio",
                        diarization_result.num_speakers,
                        diarization_result.duration
                    );
                    
                    // Assign speakers to transcript segments based on diarization results
                    let (labels, spks) = assign_speakers_from_diarization(&diarization_result, &segments);
                    (labels, spks, false)
                }
                Err(e) => {
                    log::warn!("pyannote.audio diarization failed: {}. Using heuristic fallback.", e);
                    // Return the specific error to the user instead of silently falling back
                    return Err(e);
                }
            }
        }
        Err(e) => {
            log::warn!("Could not find audio file: {}. Using heuristic fallback.", e);
            // Use heuristic fallback when no audio file is available
            let (labels, spks) = assign_speakers_heuristic(&segments);
            (labels, spks, true)
        }
    };

    if use_fallback {
        log::info!(
            "Heuristic fallback: assigned {} speakers to {} segments",
            speakers.len(),
            speaker_labels.len()
        );
    } else {
        log::info!(
            "Speaker assignment complete: {} speakers, {} segments labeled",
            speakers.len(),
            speaker_labels.len()
        );
    }

    // Cache the results
    {
        let mut cache = DIARIZATION_CACHE
            .lock()
            .map_err(|e| format!("Cache lock error: {}", e))?;
        cache.insert(meeting_id.clone(), (speaker_labels.clone(), speakers.clone()));
    }

    // Persist speaker labels and update transcripts in database
    for label in &speaker_labels {
        if let Err(e) = update_transcript_speaker_label(
            pool,
            &meeting_id,
            &label.segment_id,
            &label.speaker_id,
            &label.speaker_label,
        )
        .await
        {
            log::error!("Failed to persist speaker label for segment {}: {}", label.segment_id, e);
        }
    }

    // Save initial speaker labels
    for speaker in &speakers {
        if let Err(e) = save_speaker_label_to_db(pool, &meeting_id, &speaker.id, &speaker.label).await {
            log::error!("Failed to save speaker label: {}", e);
        }
    }

    log::info!("Persisted {} speaker labels to database for meeting {}", speaker_labels.len(), meeting_id);

    Ok(speaker_labels)
}

/// Get detected speakers from an existing diarized transcript
#[command]
pub async fn get_meeting_speakers(meeting_id: String) -> Result<Vec<Speaker>, String> {
    log::info!("get_meeting_speakers called for meeting: {}", meeting_id);

    // Check cache for diarization results
    let cache = DIARIZATION_CACHE
        .lock()
        .map_err(|e| format!("Cache lock error: {}", e))?;

    if let Some((_, speakers)) = cache.get(&meeting_id) {
        log::info!(
            "Found {} speakers in cache for meeting {}",
            speakers.len(),
            meeting_id
        );
        return Ok(speakers.clone());
    }

    // No diarization results yet
    log::info!("No diarization results found for meeting {}", meeting_id);
    Ok(vec![])
}

/// Get speaker labels for transcript segments
#[command]
pub async fn get_speaker_labels(meeting_id: String) -> Result<Vec<SpeakerLabel>, String> {
    log::info!("get_speaker_labels called for meeting: {}", meeting_id);

    // Check cache for diarization results
    let cache = DIARIZATION_CACHE
        .lock()
        .map_err(|e| format!("Cache lock error: {}", e))?;

    if let Some((labels, _)) = cache.get(&meeting_id) {
        log::info!(
            "Found {} speaker labels in cache for meeting {}",
            labels.len(),
            meeting_id
        );
        return Ok(labels.clone());
    }

    // No diarization results yet
    log::info!("No speaker labels found for meeting {}", meeting_id);
    Ok(vec![])
}

/// Update speaker labels for a meeting (rename speakers)
#[command]
pub async fn update_speaker_labels(
    meeting_id: String,
    speakers: Vec<Speaker>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SpeakerLabel>, String> {
    log::info!(
        "update_speaker_labels called for meeting: {} with {} speakers",
        meeting_id,
        speakers.len()
    );

    // Collect data from cache within a limited scope (so MutexGuard is dropped before await)
    let updated_labels = {
        let mut cache = DIARIZATION_CACHE
            .lock()
            .map_err(|e| format!("Cache lock error: {}", e))?;

        if let Some((labels, cached_speakers)) = cache.get_mut(&meeting_id) {
            // Create a mapping of speaker_id to new label
            let label_map: HashMap<String, String> = speakers
                .iter()
                .map(|s| (s.id.clone(), s.label.clone()))
                .collect();

            // Update labels
            for label in labels.iter_mut() {
                if let Some(new_label) = label_map.get(&label.speaker_id) {
                    label.speaker_label = new_label.clone();
                }
            }

            // Update cached speakers
            for cached_speaker in cached_speakers.iter_mut() {
                if let Some(new_label) = label_map.get(&cached_speaker.id) {
                    cached_speaker.label = new_label.clone();
                }
            }

            Some(labels.clone())
        } else {
            None
        }
    }; // MutexGuard is dropped here

    // Check if we found the meeting in cache
    let updated_labels = updated_labels.ok_or_else(|| {
        "No diarization results found. Run 'Full enhance' first.".to_string()
    })?;

    // Now perform async database operations without holding the lock
    let pool = state.db_manager.pool();
    for speaker in &speakers {
        if let Err(e) = save_speaker_label_to_db(pool, &meeting_id, &speaker.id, &speaker.label).await {
            log::error!("Failed to persist speaker label: {}", e);
        }
    }

    // Update transcript records with speaker labels
    for label in &updated_labels {
        if let Err(e) = update_transcript_speaker_label(pool, &meeting_id, &label.segment_id, &label.speaker_id, &label.speaker_label).await {
            log::error!("Failed to update transcript speaker label: {}", e);
        }
    }

    log::info!("Updated and persisted speaker labels for meeting {}", meeting_id);
    Ok(updated_labels)
}

/// Save a speaker label mapping to the database
async fn save_speaker_label_to_db(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
    speaker_id: &str,
    speaker_label: &str,
) -> Result<(), sqlx::Error> {
    let now = chrono::Utc::now().to_rfc3339();
    
    sqlx::query(
        r#"
        INSERT INTO speaker_labels (meeting_id, speaker_id, speaker_label, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(meeting_id, speaker_id) DO UPDATE SET
            speaker_label = excluded.speaker_label,
            updated_at = excluded.updated_at
        "#
    )
    .bind(meeting_id)
    .bind(speaker_id)
    .bind(speaker_label)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;
    
    Ok(())
}

/// Update a transcript record with speaker information
async fn update_transcript_speaker_label(
    pool: &sqlx::SqlitePool,
    meeting_id: &str,
    segment_id: &str,
    speaker_id: &str,
    speaker_label: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE transcripts SET speaker_id = ?, speaker_label = ? WHERE meeting_id = ? AND id = ?"
    )
    .bind(speaker_id)
    .bind(speaker_label)
    .bind(meeting_id)
    .bind(segment_id)
    .execute(pool)
    .await?;
    
    Ok(())
}

/// Get a speaker's audio sample start time for playback
#[command]
pub async fn get_speaker_audio_sample(
    meeting_id: String,
    speaker_id: String,
) -> Result<Option<f64>, String> {
    log::info!(
        "get_speaker_audio_sample called for meeting: {}, speaker: {}",
        meeting_id,
        speaker_id
    );

    // Check cache for speaker info
    let cache = DIARIZATION_CACHE
        .lock()
        .map_err(|e| format!("Cache lock error: {}", e))?;

    if let Some((_, speakers)) = cache.get(&meeting_id) {
        if let Some(speaker) = speakers.iter().find(|s| s.id == speaker_id) {
            return Ok(speaker.sample_audio_start);
        }
    }

    Ok(None)
}

/// Load persisted speaker labels from database into cache
#[command]
pub async fn load_persisted_speaker_labels(
    meeting_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SpeakerLabel>, String> {
    log::info!("load_persisted_speaker_labels called for meeting: {}", meeting_id);

    let pool = state.db_manager.pool();

    // Load speaker labels from database
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT speaker_id, speaker_label, meeting_id FROM speaker_labels WHERE meeting_id = ?"
    )
    .bind(&meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load speaker labels: {}", e))?;

    // Load transcripts with speaker info
    let transcripts: Vec<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id, speaker_id, speaker_label FROM transcripts WHERE meeting_id = ? AND speaker_id IS NOT NULL"
    )
    .bind(&meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load transcripts: {}", e))?;

    // Build speaker labels from persisted data
    let speaker_labels: Vec<SpeakerLabel> = transcripts
        .iter()
        .filter_map(|(id, speaker_id, speaker_label)| {
            speaker_id.as_ref().map(|sid| SpeakerLabel {
                segment_id: id.clone(),
                speaker_id: sid.clone(),
                speaker_label: speaker_label.clone().unwrap_or_else(|| format!("Speaker {}", &sid[sid.len().saturating_sub(1)..])),
            })
        })
        .collect();

    log::info!("Loaded {} persisted speaker labels for meeting {}", speaker_labels.len(), meeting_id);
    Ok(speaker_labels)
}
