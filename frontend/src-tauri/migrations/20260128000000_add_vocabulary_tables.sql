-- Create vocabulary_sets table for managing vocabulary collections
CREATE TABLE IF NOT EXISTS vocabulary_sets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Create vocabulary_entries table for individual vocabulary terms
CREATE TABLE IF NOT EXISTS vocabulary_entries (
    id TEXT PRIMARY KEY,
    vocabulary_set_id TEXT NOT NULL,
    term TEXT NOT NULL,
    alternatives TEXT,  -- JSON array of alternative spellings/misrecognitions
    category TEXT,
    pronunciation TEXT,
    enabled BOOLEAN DEFAULT 1,
    FOREIGN KEY (vocabulary_set_id) REFERENCES vocabulary_sets(id) ON DELETE CASCADE
);

-- Create index for faster lookups by vocabulary set
CREATE INDEX IF NOT EXISTS idx_vocabulary_entries_set_id ON vocabulary_entries(vocabulary_set_id);

-- Create index for enabled entries lookup
CREATE INDEX IF NOT EXISTS idx_vocabulary_entries_enabled ON vocabulary_entries(enabled);
