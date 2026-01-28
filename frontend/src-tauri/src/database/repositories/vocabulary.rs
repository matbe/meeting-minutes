use crate::database::models::{VocabularyEntry, VocabularyEntryParsed, VocabularySet};
use sqlx::SqlitePool;
use uuid::Uuid;

pub struct VocabularyRepository;

impl VocabularyRepository {
    // ===== VOCABULARY SET OPERATIONS =====

    /// Get all vocabulary sets
    pub async fn get_all_sets(
        pool: &SqlitePool,
    ) -> std::result::Result<Vec<VocabularySet>, sqlx::Error> {
        let sets = sqlx::query_as::<_, VocabularySet>(
            "SELECT id, name, description, is_default, created_at, updated_at FROM vocabulary_sets ORDER BY created_at DESC"
        )
        .fetch_all(pool)
        .await?;
        Ok(sets)
    }

    /// Get a specific vocabulary set by ID
    pub async fn get_set_by_id(
        pool: &SqlitePool,
        id: &str,
    ) -> std::result::Result<Option<VocabularySet>, sqlx::Error> {
        let set = sqlx::query_as::<_, VocabularySet>(
            "SELECT id, name, description, is_default, created_at, updated_at FROM vocabulary_sets WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;
        Ok(set)
    }

    /// Create a new vocabulary set
    pub async fn create_set(
        pool: &SqlitePool,
        name: &str,
        description: Option<&str>,
        is_default: bool,
    ) -> std::result::Result<String, sqlx::Error> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            INSERT INTO vocabulary_sets (id, name, description, is_default, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(name)
        .bind(description)
        .bind(is_default)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        Ok(id)
    }

    /// Update a vocabulary set
    pub async fn update_set(
        pool: &SqlitePool,
        id: &str,
        name: &str,
        description: Option<&str>,
        is_default: bool,
    ) -> std::result::Result<(), sqlx::Error> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            r#"
            UPDATE vocabulary_sets 
            SET name = ?, description = ?, is_default = ?, updated_at = ?
            WHERE id = ?
            "#,
        )
        .bind(name)
        .bind(description)
        .bind(is_default)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Delete a vocabulary set (cascade deletes entries)
    pub async fn delete_set(
        pool: &SqlitePool,
        id: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM vocabulary_sets WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;

        Ok(())
    }

    // ===== VOCABULARY ENTRY OPERATIONS =====

    /// Get all entries for a vocabulary set
    pub async fn get_entries_by_set_id(
        pool: &SqlitePool,
        set_id: &str,
    ) -> std::result::Result<Vec<VocabularyEntry>, sqlx::Error> {
        let entries = sqlx::query_as::<_, VocabularyEntry>(
            "SELECT id, vocabulary_set_id, term, alternatives, category, pronunciation, enabled FROM vocabulary_entries WHERE vocabulary_set_id = ? ORDER BY term ASC"
        )
        .bind(set_id)
        .fetch_all(pool)
        .await?;
        Ok(entries)
    }

    /// Get all enabled entries across all sets (for active vocabulary)
    pub async fn get_all_enabled_entries(
        pool: &SqlitePool,
    ) -> std::result::Result<Vec<VocabularyEntry>, sqlx::Error> {
        let entries = sqlx::query_as::<_, VocabularyEntry>(
            "SELECT id, vocabulary_set_id, term, alternatives, category, pronunciation, enabled FROM vocabulary_entries WHERE enabled = 1 ORDER BY term ASC"
        )
        .fetch_all(pool)
        .await?;
        Ok(entries)
    }

    /// Get a specific entry by ID
    pub async fn get_entry_by_id(
        pool: &SqlitePool,
        id: &str,
    ) -> std::result::Result<Option<VocabularyEntry>, sqlx::Error> {
        let entry = sqlx::query_as::<_, VocabularyEntry>(
            "SELECT id, vocabulary_set_id, term, alternatives, category, pronunciation, enabled FROM vocabulary_entries WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;
        Ok(entry)
    }

    /// Add a new vocabulary entry
    pub async fn add_entry(
        pool: &SqlitePool,
        set_id: &str,
        term: &str,
        alternatives: &[String],
        category: Option<&str>,
        pronunciation: Option<&str>,
    ) -> std::result::Result<String, sqlx::Error> {
        let id = Uuid::new_v4().to_string();
        let alternatives_json = serde_json::to_string(alternatives)
            .map_err(|e| sqlx::Error::Protocol(format!("Failed to serialize alternatives: {}", e).into()))?;

        sqlx::query(
            r#"
            INSERT INTO vocabulary_entries (id, vocabulary_set_id, term, alternatives, category, pronunciation, enabled)
            VALUES (?, ?, ?, ?, ?, ?, 1)
            "#,
        )
        .bind(&id)
        .bind(set_id)
        .bind(term)
        .bind(&alternatives_json)
        .bind(category)
        .bind(pronunciation)
        .execute(pool)
        .await?;

        Ok(id)
    }

    /// Update an existing vocabulary entry
    pub async fn update_entry(
        pool: &SqlitePool,
        id: &str,
        term: &str,
        alternatives: &[String],
        category: Option<&str>,
        pronunciation: Option<&str>,
        enabled: bool,
    ) -> std::result::Result<(), sqlx::Error> {
        let alternatives_json = serde_json::to_string(alternatives)
            .map_err(|e| sqlx::Error::Protocol(format!("Failed to serialize alternatives: {}", e).into()))?;

        sqlx::query(
            r#"
            UPDATE vocabulary_entries 
            SET term = ?, alternatives = ?, category = ?, pronunciation = ?, enabled = ?
            WHERE id = ?
            "#,
        )
        .bind(term)
        .bind(&alternatives_json)
        .bind(category)
        .bind(pronunciation)
        .bind(enabled)
        .bind(id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Delete a vocabulary entry
    pub async fn delete_entry(
        pool: &SqlitePool,
        id: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM vocabulary_entries WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;

        Ok(())
    }

    /// Toggle entry enabled status
    pub async fn toggle_entry_enabled(
        pool: &SqlitePool,
        id: &str,
        enabled: bool,
    ) -> std::result::Result<(), sqlx::Error> {
        sqlx::query("UPDATE vocabulary_entries SET enabled = ? WHERE id = ?")
            .bind(enabled)
            .bind(id)
            .execute(pool)
            .await?;

        Ok(())
    }

    // ===== IMPORT/EXPORT OPERATIONS =====

    /// Parse a CSV line respecting quoted values that may contain commas
    fn parse_csv_line(line: &str) -> Vec<String> {
        let mut fields = Vec::new();
        let mut current_field = String::new();
        let mut in_quotes = false;
        let mut chars = line.chars().peekable();
        
        while let Some(c) = chars.next() {
            match c {
                '"' => {
                    if in_quotes {
                        // Check for escaped quote ("")
                        if chars.peek() == Some(&'"') {
                            chars.next(); // consume the second quote
                            current_field.push('"');
                        } else {
                            in_quotes = false;
                        }
                    } else {
                        in_quotes = true;
                    }
                }
                ',' if !in_quotes => {
                    fields.push(current_field.trim().to_string());
                    current_field = String::new();
                }
                _ => {
                    current_field.push(c);
                }
            }
        }
        
        // Don't forget the last field
        fields.push(current_field.trim().to_string());
        
        fields
    }

    /// Import vocabulary entries from CSV content
    /// CSV format: term,alternatives (semicolon-separated within field),category
    /// Properly handles quoted values that may contain commas
    pub async fn import_from_csv(
        pool: &SqlitePool,
        set_id: &str,
        csv_content: &str,
    ) -> std::result::Result<u32, sqlx::Error> {
        let mut count = 0;

        for line in csv_content.lines().skip(1) {
            // Skip header row and empty lines
            if line.trim().is_empty() {
                continue;
            }
            
            let parts = Self::parse_csv_line(line);
            if parts.is_empty() {
                continue;
            }

            let term = parts.first().unwrap_or(&String::new()).clone();
            if term.is_empty() {
                continue;
            }

            let alternatives: Vec<String> = if parts.len() > 1 {
                parts[1]
                    .split(';')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            } else {
                Vec::new()
            };

            let category = if parts.len() > 2 && !parts[2].is_empty() {
                Some(parts[2].as_str())
            } else {
                None
            };

            Self::add_entry(pool, set_id, &term, &alternatives, category, None).await?;
            count += 1;
        }

        Ok(count)
    }

    /// Export vocabulary entries to CSV format
    /// Uses semicolons to separate alternatives within the alternatives field
    /// Properly escapes quotes and handles special characters
    pub async fn export_to_csv(
        pool: &SqlitePool,
        set_id: &str,
    ) -> std::result::Result<String, sqlx::Error> {
        let entries = Self::get_entries_by_set_id(pool, set_id).await?;
        
        let mut csv = String::from("term,alternatives,category\n");
        
        for entry in entries {
            let parsed: VocabularyEntryParsed = entry.into();
            // Use semicolons to separate alternatives
            let alternatives = parsed.alternatives.join(";");
            let category = parsed.category.unwrap_or_default();
            
            // Escape quotes and remove newlines for CSV safety
            let term_escaped = parsed.term.replace('"', "\"\"").replace('\n', " ").replace('\r', "");
            let alts_escaped = alternatives.replace('"', "\"\"").replace('\n', " ").replace('\r', "");
            let cat_escaped = category.replace('"', "\"\"").replace('\n', " ").replace('\r', "");
            
            csv.push_str(&format!(
                "\"{}\",\"{}\",\"{}\"\n",
                term_escaped,
                alts_escaped,
                cat_escaped
            ));
        }

        Ok(csv)
    }

    /// Get all active vocabulary terms (enabled entries from all sets)
    /// Returns a list of terms to use as hints for transcription
    pub async fn get_active_vocabulary_terms(
        pool: &SqlitePool,
    ) -> std::result::Result<Vec<String>, sqlx::Error> {
        let entries = Self::get_all_enabled_entries(pool).await?;
        
        let terms: Vec<String> = entries
            .into_iter()
            .map(|e| e.term)
            .collect();

        Ok(terms)
    }
}
