"use client";

import { Transcript, TranscriptSegmentData } from '@/types';
import { TranscriptView } from '@/components/TranscriptView';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import { AudioPlayer, AudioPlayerRef } from '@/components/AudioPlayer';
import { useMemo, Ref } from 'react';

interface TranscriptPanelProps {
  transcripts: Transcript[];
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

  // Audio playback props
  onSegmentClick?: (audioStartTime: number) => void;
  currentPlaybackTime?: number;
  
  // Audio player props
  audioFilePath?: string | null;
  audioPlayerRef?: Ref<AudioPlayerRef>;
  onAudioTimeUpdate?: (time: number) => void;
  
  // Speaker enhancement props
  onFullEnhance?: () => void;
  onQuickLabel?: () => void;
  onTagClick?: () => void;
  isEnhancing?: boolean;

  // Retranscription props
  meetingId?: string;
  meetingFolderPath?: string | null;
  hasAudioFile?: boolean;
}

export function TranscriptPanel({
  transcripts,
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
  onSegmentClick,
  currentPlaybackTime,
  audioFilePath,
  audioPlayerRef,
  onAudioTimeUpdate,
  onFullEnhance,
  onQuickLabel,
  onTagClick,
  isEnhancing = false,
  meetingId,
  meetingFolderPath,
  hasAudioFile = true,
}: TranscriptPanelProps) {
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

  return (
    <div className="hidden md:flex md:w-1/4 lg:w-1/3 min-w-[250px] border-r border-gray-200 bg-white flex-col relative">
      {/* Title area */}
      <div className="p-3 border-b border-gray-200">
        <TranscriptButtonGroup
          transcriptCount={usePagination ? (totalCount ?? convertedSegments.length) : (transcripts?.length || 0)}
          onCopyTranscript={onCopyTranscript}
          onOpenMeetingFolder={onOpenMeetingFolder}
          meetingId={meetingId}
          hasAudioFile={hasAudioFile}
          meetingFolderPath={meetingFolderPath}
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
          onSegmentClick={onSegmentClick}
          currentPlaybackTime={currentPlaybackTime}
        />
      </div>

      {/* Audio Player - always shown when there are transcripts */}
      {!isRecording && convertedSegments.length > 0 && (
        <AudioPlayer
          ref={audioPlayerRef}
          audioFilePath={audioFilePath ?? null}
          onTimeUpdate={onAudioTimeUpdate}
          onFullEnhance={onFullEnhance}
          onQuickLabel={onQuickLabel}
          onTagClick={onTagClick}
          isEnhancing={isEnhancing}
        />
      )}
    </div>
  );
}
