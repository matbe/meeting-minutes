// Speaker color definitions for consistent styling across components
// Used for visual distinction of different speakers in transcripts and modals

export const SPEAKER_COLORS = [
  { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-200" },
  { bg: "bg-green-100", text: "text-green-800", border: "border-green-200" },
  { bg: "bg-purple-100", text: "text-purple-800", border: "border-purple-200" },
  { bg: "bg-orange-100", text: "text-orange-800", border: "border-orange-200" },
  { bg: "bg-pink-100", text: "text-pink-800", border: "border-pink-200" },
  { bg: "bg-cyan-100", text: "text-cyan-800", border: "border-cyan-200" },
  { bg: "bg-yellow-100", text: "text-yellow-800", border: "border-yellow-200" },
  { bg: "bg-red-100", text: "text-red-800", border: "border-red-200" },
];

export function getSpeakerColorIndex(speakerId: string): number {
  // Extract numeric part from speaker ID (e.g., "speaker_1" -> 1)
  const match = speakerId.match(/\d+/);
  if (match) {
    return (parseInt(match[0], 10) - 1) % SPEAKER_COLORS.length;
  }
  // Fallback: hash the speaker ID to get a consistent color
  let hash = 0;
  for (let i = 0; i < speakerId.length; i++) {
    hash = speakerId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % SPEAKER_COLORS.length;
}

export function getSpeakerColor(speakerId: string) {
  return SPEAKER_COLORS[getSpeakerColorIndex(speakerId)];
}

// Combined class string for use in modal (backwards compatible)
export function getSpeakerColorClasses(index: number): string {
  const color = SPEAKER_COLORS[index % SPEAKER_COLORS.length];
  return `${color.bg} ${color.text} ${color.border}`;
}
