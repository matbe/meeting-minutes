use crate::database::models::VocabularyEntry;
use log::info as log_info;
use regex::Regex;
use std::collections::HashMap;

/// Applies vocabulary corrections to transcript text
/// Replaces known misrecognitions with the correct terms
pub fn apply_vocabulary_corrections(
    text: &str,
    vocabulary_entries: &[VocabularyEntry],
) -> String {
    if text.is_empty() || vocabulary_entries.is_empty() {
        return text.to_string();
    }

    let mut corrected = text.to_string();

    // Build a map of alternatives to terms for efficient lookup
    for entry in vocabulary_entries {
        if !entry.enabled {
            continue;
        }

        // Parse alternatives from JSON or comma-separated string
        let alternatives = parse_alternatives(&entry.alternatives);
        if alternatives.is_empty() {
            continue;
        }

        // Replace each alternative with the correct term (case-insensitive)
        for alt in alternatives {
            if alt.trim().is_empty() {
                continue;
            }

            // Create case-insensitive regex with word boundaries
            if let Ok(regex) = Regex::new(&format!(r"\b{}\b", regex::escape(&alt))) {
                corrected = regex.replace_all(&corrected, &entry.term).to_string();
            }
        }
    }

    corrected
}

/// Parse alternatives from JSON array string or comma-separated string
fn parse_alternatives(alternatives_str: Option<&str>) -> Vec<String> {
    if let Some(alt_str) = alternatives_str {
        // Try parsing as JSON array first
        if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(alt_str) {
            if let Some(array) = json_value.as_array() {
                return array
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect();
            }
        }

        // Fall back to comma-separated parsing
        alt_str
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    } else {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vocabulary_correction() {
        let entry = VocabularyEntry {
            id: "1".to_string(),
            vocabulary_set_id: "set1".to_string(),
            term: "Kubernetes".to_string(),
            alternatives: Some("Cooper Netties,Kuber Netties".to_string()),
            category: None,
            pronunciation: None,
            enabled: true,
        };

        let text = "We use Cooper Netties for orchestration and Kuber Netties in production.";
        let corrected = apply_vocabulary_corrections(text, &[entry]);

        assert_eq!(
            corrected,
            "We use Kubernetes for orchestration and Kubernetes in production."
        );
    }

    #[test]
    fn test_case_insensitive_correction() {
        let entry = VocabularyEntry {
            id: "1".to_string(),
            vocabulary_set_id: "set1".to_string(),
            term: "API".to_string(),
            alternatives: Some("A P I,api".to_string()),
            category: None,
            pronunciation: None,
            enabled: true,
        };

        let text = "The A P I is critical. Use the API endpoint.";
        let corrected = apply_vocabulary_corrections(text, &[entry]);

        assert_eq!(corrected, "The API is critical. Use the API endpoint.");
    }
}
