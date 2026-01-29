"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Check, X, Pause } from "lucide-react";
import { Speaker } from "@/types";
import { getSpeakerColorClasses } from "@/lib/speakerColors";

interface SpeakerTagModalProps {
  isOpen: boolean;
  onClose: () => void;
  speakers: Speaker[];
  onSaveSpeakerLabel: (speakerId: string, newLabel: string) => void;
  onPlaySample?: (speakerId: string, startTime: number) => void;
  onStopPlayback?: () => void;
  isPlaying?: string | null; // ID of currently playing speaker, or null
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds)) return "0s";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

export function SpeakerTagModal({
  isOpen,
  onClose,
  speakers,
  onSaveSpeakerLabel,
  onPlaySample,
  onStopPlayback,
  isPlaying = null,
}: SpeakerTagModalProps) {
  // Track which speaker is being edited
  const [editingSpeakerId, setEditingSpeakerId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleStartEdit = useCallback((speaker: Speaker) => {
    setEditingSpeakerId(speaker.id);
    setEditValue(speaker.label);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingSpeakerId(null);
    setEditValue("");
  }, []);

  const handleSaveEdit = useCallback((speakerId: string, originalLabel: string) => {
    const trimmedValue = editValue.trim();
    // Only save if there's a non-empty value that's different from original
    if (trimmedValue && trimmedValue !== originalLabel) {
      onSaveSpeakerLabel(speakerId, trimmedValue);
    }
    setEditingSpeakerId(null);
    setEditValue("");
  }, [editValue, onSaveSpeakerLabel]);

  const handlePlayClick = useCallback((speaker: Speaker) => {
    if (isPlaying === speaker.id) {
      // Stop playback
      onStopPlayback?.();
    } else {
      // Start playback
      if (speaker.sampleAudioStart !== undefined) {
        onPlaySample?.(speaker.id, speaker.sampleAudioStart);
      }
    }
  }, [isPlaying, onPlaySample, onStopPlayback]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tag Speakers</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-4">
          {speakers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No speakers detected. Try running &quot;Full enhance&quot; first.
            </p>
          ) : (
            speakers.map((speaker, index) => {
              const colorClass = getSpeakerColorClasses(index);
              const isEditing = editingSpeakerId === speaker.id;
              const isCurrentlyPlaying = isPlaying === speaker.id;

              return (
                <div
                  key={speaker.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${colorClass}`}
                >
                  {/* Play button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full shrink-0"
                    onClick={() => handlePlayClick(speaker)}
                    disabled={speaker.sampleAudioStart === undefined}
                    title={isCurrentlyPlaying ? "Stop playback" : "Play voice sample"}
                  >
                    {isCurrentlyPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>

                  {/* Speaker name */}
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="h-8 text-sm"
                          autoFocus
                          aria-label={`Edit name for ${speaker.label}`}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleSaveEdit(speaker.id, speaker.label);
                            } else if (e.key === "Escape") {
                              handleCancelEdit();
                            }
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => handleSaveEdit(speaker.id, speaker.label)}
                          disabled={!editValue.trim()}
                          aria-label="Save speaker name"
                        >
                          <Check className="h-4 w-4 text-green-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={handleCancelEdit}
                          aria-label="Cancel editing"
                        >
                          <X className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        className="text-left w-full truncate font-medium hover:underline cursor-pointer"
                        aria-label={`Edit speaker name: ${speaker.label}`}
                        onClick={() => handleStartEdit(speaker)}
                        title="Click to edit speaker name"
                      >
                        {speaker.label}
                      </button>
                    )}
                  </div>

                  {/* Segment info */}
                  {!isEditing && (
                    <div className="text-xs opacity-70 shrink-0">
                      {speaker.segments} segments · {formatDuration(speaker.totalDuration)}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
