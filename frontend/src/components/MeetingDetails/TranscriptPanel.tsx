"use client";

import { Transcript, TranscriptSegmentData, Speaker } from '@/types';
import { TranscriptView } from '@/components/TranscriptView';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import { SpeakerTagModal } from '@/components/SpeakerTagModal';
import { useMemo, useState, useCallback } from 'react';

interface TranscriptPanelProps {
  transcripts: Transcript[];
  customPrompt: string;
  onPromptChange: (value: string) => void;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  disableAutoScroll?: boolean;

  // Optional pagination props (when using virtualization)
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;

  // Speaker recognition props
  onFullEnhance?: () => void;
  onSaveSpeakerLabel?: (speakerId: string, newLabel: string) => void;
  onPlaySpeakerSample?: (speakerId: string, startTime: number) => void;
  onStopPlayback?: () => void;
  isPlayingSpeaker?: string | null;
}

export function TranscriptPanel({
  transcripts,
  customPrompt,
  onPromptChange,
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording,
  disableAutoScroll = false,
  usePagination = false,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  onFullEnhance,
  onSaveSpeakerLabel,
  onPlaySpeakerSample,
  onStopPlayback,
  isPlayingSpeaker,
}: TranscriptPanelProps) {
  // State for speaker tag modal
  const [isSpeakerModalOpen, setIsSpeakerModalOpen] = useState(false);

  // Convert transcripts to segments if pagination is not used but we want virtualization
  const convertedSegments = useMemo(() => {
    if (usePagination && segments) {
      return segments;
    }
    // Convert transcripts to segments for virtualization
    return transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
      speaker_id: t.speaker_id,
      speaker_label: t.speaker_label,
    }));
  }, [transcripts, usePagination, segments]);

  // Extract unique speakers from segments
  const speakers = useMemo((): Speaker[] => {
    const speakerMap = new Map<string, { segments: number; totalDuration: number; firstTimestamp: number }>();
    
    const segs = usePagination && segments ? segments : convertedSegments;
    
    for (const segment of segs) {
      if (segment.speaker_id) {
        const existing = speakerMap.get(segment.speaker_id);
        // Calculate duration, using endTime if available, otherwise estimate 3s per segment
        const segmentDuration = segment.endTime !== undefined 
          ? Math.max(0, segment.endTime - segment.timestamp)
          : 3; // Default estimate of 3 seconds per segment
        
        if (existing) {
          existing.segments += 1;
          existing.totalDuration += segmentDuration;
        } else {
          speakerMap.set(segment.speaker_id, {
            segments: 1,
            totalDuration: segmentDuration,
            firstTimestamp: segment.timestamp,
          });
        }
      }
    }

    return Array.from(speakerMap.entries()).map(([id, data]) => ({
      id,
      label: segs.find(s => s.speaker_id === id)?.speaker_label || id,
      segments: data.segments,
      totalDuration: data.totalDuration,
      sampleAudioStart: data.firstTimestamp,
    }));
  }, [convertedSegments, segments, usePagination]);

  const handleQuickLabel = useCallback(() => {
    setIsSpeakerModalOpen(true);
  }, []);

  const handleCloseSpeakerModal = useCallback(() => {
    setIsSpeakerModalOpen(false);
  }, []);

  const handleSaveSpeakerLabel = useCallback((speakerId: string, newLabel: string) => {
    onSaveSpeakerLabel?.(speakerId, newLabel);
  }, [onSaveSpeakerLabel]);

  return (
    <div className="hidden md:flex md:w-1/4 lg:w-1/3 min-w-0 border-r border-gray-200 bg-white flex-col relative shrink-0">
      {/* Title area */}
      <div className="p-4 border-b border-gray-200">
        <TranscriptButtonGroup
          transcriptCount={usePagination ? (totalCount ?? convertedSegments.length) : (transcripts?.length || 0)}
          onCopyTranscript={onCopyTranscript}
          onOpenMeetingFolder={onOpenMeetingFolder}
          onFullEnhance={onFullEnhance}
          onQuickLabel={handleQuickLabel}
        />
      </div>

      {/* Transcript content - use virtualized view for better performance */}
      <div className="flex-1 overflow-hidden pb-4">
        <VirtualizedTranscriptView
          segments={convertedSegments}
          isRecording={isRecording}
          isPaused={false}
          isProcessing={false}
          isStopping={false}
          enableStreaming={false}
          showConfidence={true}
          disableAutoScroll={disableAutoScroll}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
        />
      </div>

      {/* Custom prompt input at bottom of transcript section */}
      {!isRecording && convertedSegments.length > 0 && (
        <div className="p-1 border-t border-gray-200">
          <textarea
            placeholder="Add context for AI summary. For example people involved, meeting overview, objective etc..."
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm min-h-[80px] resize-y"
            value={customPrompt}
            onChange={(e) => onPromptChange(e.target.value)}
          />
        </div>
      )}

      {/* Speaker Tag Modal */}
      <SpeakerTagModal
        isOpen={isSpeakerModalOpen}
        onClose={handleCloseSpeakerModal}
        speakers={speakers}
        onSaveSpeakerLabel={handleSaveSpeakerLabel}
        onPlaySample={onPlaySpeakerSample}
        onStopPlayback={onStopPlayback}
        isPlaying={isPlayingSpeaker}
      />
    </div>
  );
}
