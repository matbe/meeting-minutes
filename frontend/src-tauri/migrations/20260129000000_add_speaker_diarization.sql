-- Migration: Add speaker diarization fields
-- This adds speaker_id and speaker_label columns for voice-based speaker recognition

-- Add speaker_id column (the unique identifier from diarization, e.g., "SPEAKER_00")
ALTER TABLE transcripts ADD COLUMN speaker_id TEXT;

-- Add speaker_label column (human-readable name, e.g., "John", "Speaker 1")
ALTER TABLE transcripts ADD COLUMN speaker_label TEXT;

-- Create speaker_labels table for persisting speaker name mappings per meeting
CREATE TABLE IF NOT EXISTS speaker_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id TEXT NOT NULL,
    speaker_id TEXT NOT NULL,
    speaker_label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id),
    UNIQUE(meeting_id, speaker_id)
);

-- Create index for faster speaker label lookups
CREATE INDEX IF NOT EXISTS idx_speaker_labels_meeting ON speaker_labels(meeting_id);
