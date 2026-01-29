'use client';

import React, { useState, useCallback } from 'react';
import { Play, Pause, Check, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Speaker } from '@/types';

interface SpeakerTagModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** List of detected speakers */
  speakers: Speaker[];
  /** Callback when speaker labels are saved */
  onSaveSpeakers: (speakers: Speaker[]) => void;
  /** Callback to play a speaker's audio sample */
  onPlaySample?: (speaker: Speaker) => void;
  /** Currently playing speaker ID (if any) */
  playingSpeakerId?: string | null;
}

// Helper function to format duration
function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

// Speaker color palette for visual distinction
export const SPEAKER_COLORS = [
  { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' },
  { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  { bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-300' },
  { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-300' },
  { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300' },
  { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' },
];

// Get consistent color for a speaker based on their ID
export function getSpeakerColor(speakerId: string): typeof SPEAKER_COLORS[0] {
  // Simple hash to get consistent index
  let hash = 0;
  for (let i = 0; i < speakerId.length; i++) {
    hash = ((hash << 5) - hash) + speakerId.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  const index = Math.abs(hash) % SPEAKER_COLORS.length;
  return SPEAKER_COLORS[index];
}

interface SpeakerRowProps {
  speaker: Speaker;
  index: number;
  isPlaying: boolean;
  onPlay: () => void;
  onLabelChange: (newLabel: string) => void;
}

function SpeakerRow({ speaker, index, isPlaying, onPlay, onLabelChange }: SpeakerRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(speaker.label);
  const color = SPEAKER_COLORS[index % SPEAKER_COLORS.length];

  const handleSave = useCallback(() => {
    if (editValue.trim()) {
      onLabelChange(editValue.trim());
    } else {
      setEditValue(speaker.label);
    }
    setIsEditing(false);
  }, [editValue, onLabelChange, speaker.label]);

  const handleCancel = useCallback(() => {
    setEditValue(speaker.label);
    setIsEditing(false);
  }, [speaker.label]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  }, [handleSave, handleCancel]);

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg ${color.bg} ${color.border} border`}>
      {/* Play Button */}
      <button
        onClick={onPlay}
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
          isPlaying 
            ? 'bg-white shadow-sm' 
            : 'bg-white/50 hover:bg-white'
        }`}
        type="button"
        aria-label={isPlaying ? 'Pause sample' : 'Play sample'}
      >
        {isPlaying ? (
          <Pause className={`w-4 h-4 ${color.text}`} />
        ) : (
          <Play className={`w-4 h-4 ${color.text}`} fill="currentColor" />
        )}
      </button>

      {/* Speaker Name */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className={`flex-1 px-2 py-1 text-sm rounded border ${color.border} bg-white focus:outline-none focus:ring-1 focus:ring-blue-500`}
              autoFocus
            />
            <button
              onClick={handleSave}
              className="p-1 rounded hover:bg-white/50 transition-colors"
              type="button"
              aria-label="Save"
            >
              <Check className="w-4 h-4 text-green-600" />
            </button>
            <button
              onClick={handleCancel}
              className="p-1 rounded hover:bg-white/50 transition-colors"
              type="button"
              aria-label="Cancel"
            >
              <X className="w-4 h-4 text-red-600" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className={`text-sm font-medium ${color.text} hover:underline cursor-pointer text-left`}
            type="button"
          >
            {speaker.label}
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="flex-shrink-0 text-right">
        <span className={`text-xs ${color.text} opacity-75`}>
          {speaker.segments} segment{speaker.segments !== 1 ? 's' : ''} · {formatDuration(speaker.totalDuration)}
        </span>
      </div>
    </div>
  );
}

export function SpeakerTagModal({
  isOpen,
  onClose,
  speakers,
  onSaveSpeakers,
  onPlaySample,
  playingSpeakerId,
}: SpeakerTagModalProps) {
  const [localSpeakers, setLocalSpeakers] = useState<Speaker[]>(speakers);

  // Update local state when speakers prop changes
  React.useEffect(() => {
    setLocalSpeakers(speakers);
  }, [speakers]);

  const handleLabelChange = useCallback((speakerId: string, newLabel: string) => {
    setLocalSpeakers(prev => 
      prev.map(s => s.id === speakerId ? { ...s, label: newLabel } : s)
    );
  }, []);

  const handleSave = useCallback(() => {
    onSaveSpeakers(localSpeakers);
    onClose();
  }, [localSpeakers, onSaveSpeakers, onClose]);

  const handlePlaySample = useCallback((speaker: Speaker) => {
    if (onPlaySample) {
      onPlaySample(speaker);
    }
  }, [onPlaySample]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tag Speakers</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-4 max-h-[400px] overflow-y-auto">
          {localSpeakers.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No speakers detected</p>
              <p className="text-sm mt-1">Try using "Full enhance" to detect speakers</p>
            </div>
          ) : (
            localSpeakers.map((speaker, index) => (
              <SpeakerRow
                key={speaker.id}
                speaker={speaker}
                index={index}
                isPlaying={playingSpeakerId === speaker.id}
                onPlay={() => handlePlaySample(speaker)}
                onLabelChange={(newLabel) => handleLabelChange(speaker.id, newLabel)}
              />
            ))
          )}
        </div>

        {localSpeakers.length > 0 && (
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
              type="button"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm bg-blue-500 text-white hover:bg-blue-600 rounded-md transition-colors"
              type="button"
            >
              Save Changes
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
