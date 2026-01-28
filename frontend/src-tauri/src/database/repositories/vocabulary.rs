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
            "SELECT id, name, description, is_default, created_at, updated_at FROM vocabulary_sets WHERE id = $1"
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
            VALUES ($1, $2, $3, $4, $5, $6)
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
            SET name = $1, description = $2, is_default = $3, updated_at = $4
            WHERE id = $5
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
        sqlx::query("DELETE FROM vocabulary_sets WHERE id = $1")
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
            "SELECT id, vocabulary_set_id, term, alternatives, category, pronunciation, enabled FROM vocabulary_entries WHERE vocabulary_set_id = $1 ORDER BY term ASC"
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
            "SELECT id, vocabulary_set_id, term, alternatives, category, pronunciation, enabled FROM vocabulary_entries WHERE id = $1"
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
            VALUES ($1, $2, $3, $4, $5, $6, 1)
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
            SET term = $1, alternatives = $2, category = $3, pronunciation = $4, enabled = $5
            WHERE id = $6
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
        sqlx::query("DELETE FROM vocabulary_entries WHERE id = $1")
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
        sqlx::query("UPDATE vocabulary_entries SET enabled = $1 WHERE id = $2")
            .bind(enabled)
            .bind(id)
            .execute(pool)
            .await?;

        Ok(())
    }

    // ===== IMPORT/EXPORT OPERATIONS =====

    /// Import vocabulary entries from CSV content
    /// CSV format: term,alternatives (comma-separated within quotes),category
    pub async fn import_from_csv(
        pool: &SqlitePool,
        set_id: &str,
        csv_content: &str,
    ) -> std::result::Result<u32, sqlx::Error> {
        let mut count = 0;

        for line in csv_content.lines().skip(1) {
            // Skip header row
            let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
            if parts.is_empty() {
                continue;
            }

            let term = parts.first().unwrap_or(&"").trim_matches('"');
            if term.is_empty() {
                continue;
            }

            let alternatives: Vec<String> = if parts.len() > 1 {
                parts[1]
                    .trim_matches('"')
                    .split(';')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            } else {
                Vec::new()
            };

            let category = if parts.len() > 2 {
                let cat = parts[2].trim_matches('"');
                if cat.is_empty() { None } else { Some(cat) }
            } else {
                None
            };

            Self::add_entry(pool, set_id, term, &alternatives, category, None).await?;
            count += 1;
        }

        Ok(count)
    }

    /// Export vocabulary entries to CSV format
    pub async fn export_to_csv(
        pool: &SqlitePool,
        set_id: &str,
    ) -> std::result::Result<String, sqlx::Error> {
        let entries = Self::get_entries_by_set_id(pool, set_id).await?;
        
        let mut csv = String::from("term,alternatives,category\n");
        
        for entry in entries {
            let parsed: VocabularyEntryParsed = entry.into();
            let alternatives = parsed.alternatives.join(";");
            let category = parsed.category.unwrap_or_default();
            
            csv.push_str(&format!(
                "\"{}\",\"{}\",\"{}\"\n",
                parsed.term.replace('"', "\"\""),
                alternatives.replace('"', "\"\""),
                category.replace('"', "\"\"")
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
