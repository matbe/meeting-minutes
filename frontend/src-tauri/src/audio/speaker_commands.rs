//! Speaker diarization commands for tauri
//!
//! Provides speaker recognition and labeling functionality.
//! Uses timing-based turn detection for speaker assignment.

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

/// Represents a turn in the conversation (a continuous speaking segment by one speaker)
#[derive(Debug, Clone)]
struct ConversationTurn {
    start_time: f64,
    end_time: f64,
    segment_indices: Vec<usize>,
}

/// Performs turn-based speaker diarization on transcript segments.
///
/// This algorithm:
/// 1. Groups consecutive segments into "turns" based on timing gaps
/// 2. Assigns speakers to turns using an alternating model (common in conversations)
/// 3. Handles overlapping speech and short pauses within same speaker's turn
fn assign_speakers_turn_based(
    segments: &[(String, String, Option<f64>, Option<f64>)], // (id, text, audio_start, audio_end)
) -> (Vec<SpeakerLabel>, Vec<Speaker>) {
    if segments.is_empty() {
        return (vec![], vec![]);
    }

    // Step 1: Group segments into turns based on timing
    let turns = group_into_turns(segments);

    log::info!(
        "Detected {} conversation turns from {} segments",
        turns.len(),
        segments.len()
    );

    // Step 2: Assign speakers to turns using alternating model
    let turn_speakers = assign_speakers_to_turns(&turns, segments);

    // Step 3: Build speaker labels and statistics
    let mut speaker_stats: HashMap<String, SpeakerStats> = HashMap::new();
    let mut speaker_labels = Vec::new();

    for (turn_idx, turn) in turns.iter().enumerate() {
        let speaker_id = &turn_speakers[turn_idx];
        let speaker_num = speaker_id.chars().last().unwrap_or('1');

        for &seg_idx in &turn.segment_indices {
            let (segment_id, _text, audio_start, audio_end) = &segments[seg_idx];

            let duration = match (audio_start, audio_end) {
                (Some(start), Some(end)) => end - start,
                _ => 3.0,
            };

            let stats = speaker_stats
                .entry(speaker_id.clone())
                .or_insert(SpeakerStats {
                    id: speaker_id.clone(),
                    label: format!("Speaker {}", speaker_num),
                    segment_count: 0,
                    total_duration: 0.0,
                    first_audio_start: *audio_start,
                });

            stats.segment_count += 1;
            stats.total_duration += duration;
            if stats.first_audio_start.is_none() {
                stats.first_audio_start = *audio_start;
            }

            speaker_labels.push(SpeakerLabel {
                segment_id: segment_id.clone(),
                speaker_id: speaker_id.clone(),
                speaker_label: stats.label.clone(),
            });
        }
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

/// Groups consecutive segments into conversation turns based on timing gaps
fn group_into_turns(
    segments: &[(String, String, Option<f64>, Option<f64>)],
) -> Vec<ConversationTurn> {
    // Gap threshold for considering a speaker change (in seconds)
    // A pause longer than this suggests a new turn
    const TURN_GAP_THRESHOLD: f64 = 1.5;

    let mut turns: Vec<ConversationTurn> = Vec::new();
    let mut current_turn_segments: Vec<usize> = Vec::new();
    let mut current_turn_start: Option<f64> = None;
    let mut last_end_time: Option<f64> = None;

    for (idx, (_id, _text, audio_start, audio_end)) in segments.iter().enumerate() {
        let start = audio_start.unwrap_or(idx as f64 * 5.0); // Fallback timing
        let end = audio_end.unwrap_or(start + 3.0);

        // Check if this segment starts a new turn
        let is_new_turn = if let Some(last_end) = last_end_time {
            let gap = start - last_end;
            gap > TURN_GAP_THRESHOLD
        } else {
            true // First segment starts a new turn
        };

        if is_new_turn && !current_turn_segments.is_empty() {
            // Save the current turn
            turns.push(ConversationTurn {
                start_time: current_turn_start.unwrap_or(0.0),
                end_time: last_end_time.unwrap_or(0.0),
                segment_indices: current_turn_segments.clone(),
            });
            current_turn_segments.clear();
            current_turn_start = None;
        }

        // Add segment to current turn
        if current_turn_start.is_none() {
            current_turn_start = Some(start);
        }
        current_turn_segments.push(idx);
        last_end_time = Some(end);
    }

    // Don't forget the last turn
    if !current_turn_segments.is_empty() {
        turns.push(ConversationTurn {
            start_time: current_turn_start.unwrap_or(0.0),
            end_time: last_end_time.unwrap_or(0.0),
            segment_indices: current_turn_segments,
        });
    }

    turns
}

/// Assigns speakers to turns using conversation patterns
fn assign_speakers_to_turns(
    turns: &[ConversationTurn],
    segments: &[(String, String, Option<f64>, Option<f64>)],
) -> Vec<String> {
    if turns.is_empty() {
        return vec![];
    }

    // Analyze the conversation to estimate number of speakers
    let num_speakers = estimate_speaker_count(turns, segments);
    log::info!("Estimated {} speakers in conversation", num_speakers);

    let mut turn_speakers = Vec::with_capacity(turns.len());
    let mut current_speaker = 1;

    for (turn_idx, turn) in turns.iter().enumerate() {
        // For the first turn, always start with Speaker 1
        if turn_idx == 0 {
            turn_speakers.push(format!("speaker_{}", current_speaker));
            continue;
        }

        // Check if this turn should be a different speaker
        let prev_turn = &turns[turn_idx - 1];
        let gap_between_turns = turn.start_time - prev_turn.end_time;

        // Get text from the current turn for analysis
        let current_text = get_turn_text(turn, segments);

        // Determine if speaker changed based on multiple factors
        let should_change_speaker =
            analyze_speaker_change(gap_between_turns, &current_text, turn_idx, turns.len());

        if should_change_speaker {
            // Cycle to next speaker
            current_speaker = if current_speaker >= num_speakers {
                1
            } else {
                current_speaker + 1
            };
        }

        turn_speakers.push(format!("speaker_{}", current_speaker));
    }

    turn_speakers
}

/// Estimates the number of speakers based on conversation patterns
fn estimate_speaker_count(
    turns: &[ConversationTurn],
    _segments: &[(String, String, Option<f64>, Option<f64>)],
) -> usize {
    // Estimate based on turn patterns
    // Most conversations have 2-4 speakers

    // Count significant pauses (potential speaker changes)
    let mut significant_pauses = 0;
    for i in 1..turns.len() {
        let gap = turns[i].start_time - turns[i - 1].end_time;
        if gap > 1.0 {
            significant_pauses += 1;
        }
    }

    // Estimate speakers: for short meetings, likely 2; for longer ones, maybe 3-4
    if turns.len() <= 5 {
        2
    } else if significant_pauses > turns.len() / 2 {
        // Many pauses suggest more back-and-forth, likely 2 speakers
        2
    } else if turns.len() > 20 {
        // Longer meeting might have more speakers
        std::cmp::min(3, (turns.len() / 10) + 2)
    } else {
        2
    }
}

/// Gets the combined text from a turn
fn get_turn_text(
    turn: &ConversationTurn,
    segments: &[(String, String, Option<f64>, Option<f64>)],
) -> String {
    turn.segment_indices
        .iter()
        .map(|&idx| segments[idx].1.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Analyzes whether the speaker likely changed at this turn
fn analyze_speaker_change(gap: f64, text: &str, turn_idx: usize, total_turns: usize) -> bool {
    let text_lower = text.to_lowercase();
    let text_trimmed = text_lower.trim();

    // Strong indicators of speaker change
    let is_response = text_trimmed.starts_with("yeah")
        || text_trimmed.starts_with("yes")
        || text_trimmed.starts_with("right")
        || text_trimmed.starts_with("exactly")
        || text_trimmed.starts_with("absolutely")
        || text_trimmed.starts_with("no,")
        || text_trimmed.starts_with("no ")
        || text_trimmed.starts_with("well,")
        || text_trimmed.starts_with("so,")
        || text_trimmed.starts_with("okay")
        || text_trimmed.starts_with("i think")
        || text_trimmed.starts_with("i believe")
        || text_trimmed.starts_with("i agree")
        || text_trimmed.starts_with("i disagree");

    let is_question = text_trimmed.ends_with('?')
        || text_trimmed.starts_with("what")
        || text_trimmed.starts_with("how")
        || text_trimmed.starts_with("why")
        || text_trimmed.starts_with("when")
        || text_trimmed.starts_with("where")
        || text_trimmed.starts_with("do you")
        || text_trimmed.starts_with("are you")
        || text_trimmed.starts_with("can you")
        || text_trimmed.starts_with("would you");

    // Timing-based decision
    // Significant gap almost always means speaker change
    if gap > 2.0 {
        return true;
    }

    // Medium gap with linguistic indicator
    if gap > 1.0 && (is_response || is_question) {
        return true;
    }

    // For very short conversations, alternate more aggressively
    if total_turns <= 10 && turn_idx % 2 == 1 && gap > 0.5 {
        return true;
    }

    // For longer conversations, use more conservative approach
    // Change speaker on noticeable pauses
    if gap > 1.5 {
        return true;
    }

    false
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

    // Run speaker diarization using turn-based algorithm
    let (speaker_labels, speakers) = assign_speakers_turn_based(&segments);

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
