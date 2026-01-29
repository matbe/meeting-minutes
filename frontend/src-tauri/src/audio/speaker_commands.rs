//! Speaker diarization commands for tauri
//!
//! Provides speaker recognition and labeling functionality.
//! Uses a heuristic-based approach to detect speaker changes in transcripts.

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

/// Performs heuristic-based speaker diarization on transcript segments.
/// This analyzes the transcripts and assigns speakers based on:
/// - Gap timing between segments (large gaps suggest speaker change)
/// - Text patterns (questions, responses, etc.)
/// - Segment length and speaking patterns
fn assign_speakers_heuristic(
    segments: &[(String, String, Option<f64>, Option<f64>)], // (id, text, audio_start, audio_end)
) -> (Vec<SpeakerLabel>, Vec<Speaker>) {
    if segments.is_empty() {
        return (vec![], vec![]);
    }

    let mut speaker_labels = Vec::new();
    let mut speaker_stats: HashMap<String, SpeakerStats> = HashMap::new();

    // Simple heuristic: assign speakers based on timing gaps and patterns
    // A gap of more than 2 seconds suggests a potential speaker change
    const SPEAKER_CHANGE_GAP: f64 = 2.0;

    let mut current_speaker_idx = 1;
    let mut last_end_time: Option<f64> = None;
    let mut last_speaker_id = String::new();

    for (idx, (segment_id, text, audio_start, audio_end)) in segments.iter().enumerate() {
        let speaker_id: String;

        // Determine if this is a speaker change
        let is_speaker_change = if idx == 0 {
            true // First segment always starts with Speaker 1
        } else if let (Some(start), Some(last_end)) = (audio_start, last_end_time) {
            let gap = start - last_end;

            // Heuristics for speaker change:
            // 1. Large gap between segments
            // 2. Text starts with question indicators
            // 3. Text contains "I think", "I believe" after a statement
            let has_large_gap = gap > SPEAKER_CHANGE_GAP;
            let starts_with_question = text.trim().starts_with("How")
                || text.trim().starts_with("What")
                || text.trim().starts_with("Why")
                || text.trim().starts_with("When")
                || text.trim().starts_with("Where")
                || text.trim().starts_with("Do you")
                || text.trim().starts_with("Are you")
                || text.trim().starts_with("Is ");
            let is_response_pattern = text.trim().starts_with("Yeah")
                || text.trim().starts_with("Yes")
                || text.trim().starts_with("No,")
                || text.trim().starts_with("Well,")
                || text.trim().starts_with("So,")
                || text.trim().starts_with("I think")
                || text.trim().starts_with("I believe");

            // Change speaker if there's a significant gap OR if it looks like a new speaker pattern
            has_large_gap || (gap > 0.5 && (starts_with_question || is_response_pattern))
        } else {
            // No timing info, alternate speakers every few segments
            idx % 3 == 0
        };

        if is_speaker_change && !last_speaker_id.is_empty() {
            // Cycle through speakers (max 4 for simplicity)
            current_speaker_idx = if current_speaker_idx >= 4 {
                1
            } else {
                current_speaker_idx + 1
            };
        }

        speaker_id = format!("speaker_{}", current_speaker_idx);
        last_speaker_id = speaker_id.clone();

        // Calculate duration
        let duration = match (audio_start, audio_end) {
            (Some(start), Some(end)) => end - start,
            _ => 3.0, // Default 3 seconds if no timing
        };

        // Update speaker stats
        let stats = speaker_stats
            .entry(speaker_id.clone())
            .or_insert(SpeakerStats {
                id: speaker_id.clone(),
                label: format!("Speaker {}", speaker_id.chars().last().unwrap_or('1')),
                segment_count: 0,
                total_duration: 0.0,
                first_audio_start: *audio_start,
            });
        stats.segment_count += 1;
        stats.total_duration += duration;
        if stats.first_audio_start.is_none() {
            stats.first_audio_start = *audio_start;
        }

        // Create speaker label for this segment
        speaker_labels.push(SpeakerLabel {
            segment_id: segment_id.clone(),
            speaker_id: speaker_id.clone(),
            speaker_label: stats.label.clone(),
        });

        // Update last end time
        last_end_time = *audio_end;
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

// Store diarization results in memory (in production, this would be in the database)
use std::sync::LazyLock;
use std::sync::Mutex;

static DIARIZATION_CACHE: LazyLock<Mutex<HashMap<String, (Vec<SpeakerLabel>, Vec<Speaker>)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Re-transcribe the meeting audio with speaker diarization enabled.
/// This performs heuristic-based diarization on the existing transcripts.
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

    // Get transcripts for the meeting
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

    // Convert to format needed for diarization
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

    // Run speaker diarization
    let (speaker_labels, speakers) = assign_speakers_heuristic(&segments);

    log::info!(
        "Diarization complete: {} speakers detected, {} segments labeled",
        speakers.len(),
        speaker_labels.len()
    );

    // Cache the results
    {
        let mut cache = DIARIZATION_CACHE
            .lock()
            .map_err(|e| format!("Cache lock error: {}", e))?;
        cache.insert(meeting_id.clone(), (speaker_labels.clone(), speakers));
    }

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
) -> Result<Vec<SpeakerLabel>, String> {
    log::info!(
        "update_speaker_labels called for meeting: {} with {} speakers",
        meeting_id,
        speakers.len()
    );

    // Get existing labels and update them with new speaker names
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

        log::info!("Updated speaker labels for meeting {}", meeting_id);
        return Ok(labels.clone());
    }

    Err("No diarization results found. Run 'Full enhance' first.".to_string())
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
