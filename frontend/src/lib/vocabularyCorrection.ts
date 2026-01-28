import { VocabularyEntry } from '@/types';

/**
 * Escape special regex characters in a string
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Correct a transcript text using vocabulary entries.
 * Replaces known alternative spellings/misrecognitions with the correct term.
 * 
 * @param text - The transcript text to correct
 * @param vocabulary - Array of vocabulary entries with terms and alternatives
 * @returns Corrected text with misrecognitions replaced
 */
export function correctTranscript(
  text: string,
  vocabulary: VocabularyEntry[]
): string {
  if (!text || vocabulary.length === 0) {
    return text;
  }

  let corrected = text;

  for (const entry of vocabulary) {
    if (!entry.enabled || !entry.alternatives || entry.alternatives.length === 0) {
      continue;
    }

    for (const alt of entry.alternatives) {
      if (!alt.trim()) continue;
      
      // Create case-insensitive regex with word boundaries
      const regex = new RegExp(`\\b${escapeRegex(alt)}\\b`, 'gi');
      corrected = corrected.replace(regex, entry.term);
    }
  }

  return corrected;
}

/**
 * Build a vocabulary prompt string for Whisper transcription.
 * This provides context hints to the model about expected terminology.
 * 
 * @param terms - Array of vocabulary terms
 * @returns Formatted prompt string for Whisper
 */
export function buildVocabularyPrompt(terms: string[]): string {
  if (terms.length === 0) {
    return '';
  }

  // Limit to first 50 terms to avoid overly long prompts
  const limitedTerms = terms.slice(0, 50);
  
  // Format: "This meeting discusses Kubernetes, API, OAuth, and CI/CD."
  return `This meeting discusses ${limitedTerms.join(', ')}.`;
}

/**
 * Parse comma-separated alternatives string into an array
 * 
 * @param alternativesStr - Comma-separated string of alternatives
 * @returns Array of trimmed alternative strings
 */
export function parseAlternatives(alternativesStr: string): string[] {
  if (!alternativesStr) {
    return [];
  }

  return alternativesStr
    .split(',')
    .map(alt => alt.trim())
    .filter(alt => alt.length > 0);
}

/**
 * Format alternatives array back to comma-separated string
 * 
 * @param alternatives - Array of alternative strings
 * @returns Comma-separated string
 */
export function formatAlternatives(alternatives: string[]): string {
  return alternatives.join(', ');
}

/**
 * Default vocabulary categories for organizing terms
 */
export const VOCABULARY_CATEGORIES = [
  'Technology',
  'Product',
  'Person',
  'Company',
  'Acronym',
  'Industry Term',
  'Project',
  'Other',
] as const;

export type VocabularyCategory = typeof VOCABULARY_CATEGORIES[number];
