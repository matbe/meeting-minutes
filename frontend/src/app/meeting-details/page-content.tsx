"use client";
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { Summary, SummaryResponse, Speaker } from '@/types';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import Analytics from '@/lib/analytics';
import { TranscriptPanel } from '@/components/MeetingDetails/TranscriptPanel';
import { SummaryPanel } from '@/components/MeetingDetails/SummaryPanel';
import { AudioPlayer, AudioPlayerRef } from '@/components/AudioPlayer';
import { SpeakerTagModal } from '@/components/SpeakerTagModal';

// Custom hooks
import { useMeetingData } from '@/hooks/meeting-details/useMeetingData';
import { useSummaryGeneration } from '@/hooks/meeting-details/useSummaryGeneration';
import { useTemplates } from '@/hooks/meeting-details/useTemplates';
import { useCopyOperations } from '@/hooks/meeting-details/useCopyOperations';
import { useMeetingOperations } from '@/hooks/meeting-details/useMeetingOperations';
import { useConfig } from '@/contexts/ConfigContext';

export default function PageContent({
  meeting,
  summaryData,
  shouldAutoGenerate = false,
  onAutoGenerateComplete,
  onMeetingUpdated,
  // Pagination props for efficient transcript loading
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
}: {
  meeting: any;
  summaryData: Summary | null;
  shouldAutoGenerate?: boolean;
  onAutoGenerateComplete?: () => void;
  onMeetingUpdated?: () => Promise<void>;
  // Pagination props
  segments?: any[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}) {
  console.log('📄 PAGE CONTENT: Initializing with data:', {
    meetingId: meeting.id,
    summaryDataKeys: summaryData ? Object.keys(summaryData) : null,
    transcriptsCount: meeting.transcripts?.length
  });

  // State
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [isRecording] = useState(false);
  const [summaryResponse] = useState<SummaryResponse | null>(null);

  // Audio player state
  const [audioFilePath, setAudioFilePath] = useState<string | null>(null);
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState<number>(0);
  const audioPlayerRef = useRef<AudioPlayerRef>(null);

  // Speaker tag modal state
  const [isSpeakerModalOpen, setIsSpeakerModalOpen] = useState(false);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [playingSpeakerId, setPlayingSpeakerId] = useState<string | null>(null);
  const speakerSampleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Ref to store the modal open function from SummaryGeneratorButtonGroup
  const openModelSettingsRef = useRef<(() => void) | null>(null);

  // Sidebar context
  const { serverAddress } = useSidebar();

  // Get model config from ConfigContext
  const { modelConfig, setModelConfig } = useConfig();

  // Custom hooks
  const meetingData = useMeetingData({ meeting, summaryData, onMeetingUpdated });
  const templates = useTemplates();

  // Callback to register the modal open function
  const handleRegisterModalOpen = (openFn: () => void) => {
    console.log('📝 Registering modal open function in PageContent');
    openModelSettingsRef.current = openFn;
  };

  // Callback to trigger modal open (called from error handler)
  const handleOpenModelSettings = () => {
    console.log('🔔 Opening model settings from PageContent');
    if (openModelSettingsRef.current) {
      openModelSettingsRef.current();
    } else {
      console.warn('⚠️ Modal open function not yet registered');
    }
  };

  // Model config save handler (ConfigContext updates automatically via events)
  const handleSaveModelConfig = async (config?: any) => {
    // The actual save happens in the modal via api_save_model_config
    // ConfigContext will be updated via event listener
    console.log('[PageContent] Model config saved, context will update via event');
  };

  const summaryGeneration = useSummaryGeneration({
    meeting,
    transcripts: meetingData.transcripts,
    modelConfig: modelConfig,
    isModelConfigLoading: false, // ConfigContext loads on mount
    selectedTemplate: templates.selectedTemplate,
    onMeetingUpdated,
    updateMeetingTitle: meetingData.updateMeetingTitle,
    setAiSummary: meetingData.setAiSummary,
    onOpenModelSettings: handleOpenModelSettings,
  });

  const copyOperations = useCopyOperations({
    meeting,
    transcripts: meetingData.transcripts,
    meetingTitle: meetingData.meetingTitle,
    aiSummary: meetingData.aiSummary,
    blockNoteSummaryRef: meetingData.blockNoteSummaryRef,
  });

  const meetingOperations = useMeetingOperations({
    meeting,
  });

  // Track page view
  useEffect(() => {
    Analytics.trackPageView('meeting_details');
  }, []);

  // Load audio file path for the meeting
  useEffect(() => {
    const loadAudioPath = async () => {
      console.log('🎵 [AudioLoad] Starting audio path lookup...');
      console.log('🎵 [AudioLoad] Meeting folder_path:', meeting.folder_path);
      console.log('🎵 [AudioLoad] Meeting ID:', meeting.id);
      
      if (!meeting.folder_path) {
        console.warn('🎵 [AudioLoad] No folder_path available for meeting');
        setAudioFilePath(null);
        return;
      }
      
      try {
        console.log('🎵 [AudioLoad] Invoking get_meeting_audio_path with:', meeting.folder_path);
        const path = await invoke<string | null>('get_meeting_audio_path', {
          meetingFolder: meeting.folder_path
        });
        
        if (path) {
          console.log('🎵 [AudioLoad] ✅ Found audio file:', path);
        } else {
          console.log('🎵 [AudioLoad] ⚠️ No audio file found in folder');
        }
        
        setAudioFilePath(path);
      } catch (err) {
        console.error('🎵 [AudioLoad] ❌ Error getting audio path:', err);
        setAudioFilePath(null);
      }
    };

    loadAudioPath();
  }, [meeting.folder_path, meeting.id]);

  // Handle transcript segment click - seek audio to that time
  const handleSegmentClick = useCallback((audioStartTime: number) => {
    console.log('🎵 Seeking to:', audioStartTime);
    audioPlayerRef.current?.seekTo(audioStartTime);
  }, []);

  // Handle audio time update
  const handleAudioTimeUpdate = useCallback((time: number) => {
    setCurrentPlaybackTime(time);
  }, []);

  // Speaker enhancement handlers
  const handleFullEnhance = useCallback(async () => {
    console.log('🎤 Full enhance (re-transcribe with diarization) requested');
    try {
      // TODO: Call diarization API
      await invoke('retranscribe_with_diarization', { meetingId: meeting.id });
    } catch (err) {
      console.error('Failed to retranscribe with diarization:', err);
      // TODO: Show error notification
    }
  }, [meeting.id]);

  const handleQuickLabel = useCallback(async () => {
    console.log('🏷️ Quick label (open speaker tag modal) requested');
    try {
      // Fetch existing speakers from backend
      const existingSpeakers = await invoke<Speaker[]>('get_meeting_speakers', { meetingId: meeting.id });
      
      if (existingSpeakers.length === 0) {
        // Generate mock speakers for demo if none exist
        // In production, this would only show after diarization is run
        const mockSpeakers: Speaker[] = [
          { id: 'speaker_1', label: 'Speaker 1', segments: 12, totalDuration: 180 },
          { id: 'speaker_2', label: 'Speaker 2', segments: 8, totalDuration: 120 },
        ];
        setSpeakers(mockSpeakers);
      } else {
        setSpeakers(existingSpeakers);
      }
      
      setIsSpeakerModalOpen(true);
    } catch (err) {
      console.error('Failed to get meeting speakers:', err);
      // Open modal with empty speakers
      setSpeakers([]);
      setIsSpeakerModalOpen(true);
    }
  }, [meeting.id]);

  const handleTagClick = useCallback(() => {
    console.log('🏷️ Tag button clicked - opening speaker modal');
    handleQuickLabel();
  }, [handleQuickLabel]);

  const handleSaveSpeakers = useCallback(async (updatedSpeakers: Speaker[]) => {
    console.log('💾 Saving speaker labels:', updatedSpeakers);
    try {
      await invoke('update_speaker_labels', {
        meetingId: meeting.id,
        speakers: updatedSpeakers,
      });
      setSpeakers(updatedSpeakers);
      // TODO: Update transcripts with new speaker labels
    } catch (err) {
      console.error('Failed to save speaker labels:', err);
    }
  }, [meeting.id]);

  const handlePlaySpeakerSample = useCallback(async (speaker: Speaker) => {
    console.log('▶️ Playing sample for speaker:', speaker.label);
    
    // Clear any existing timeout
    if (speakerSampleTimeoutRef.current) {
      clearTimeout(speakerSampleTimeoutRef.current);
      speakerSampleTimeoutRef.current = null;
    }
    
    if (playingSpeakerId === speaker.id) {
      // Stop playback
      setPlayingSpeakerId(null);
      return;
    }
    
    // Get sample audio start time and seek to it
    const sampleStart = speaker.sampleAudioStart ?? 0;
    audioPlayerRef.current?.seekTo(sampleStart);
    setPlayingSpeakerId(speaker.id);
    
    // Auto-stop after 5 seconds
    speakerSampleTimeoutRef.current = setTimeout(() => {
      setPlayingSpeakerId(null);
      speakerSampleTimeoutRef.current = null;
    }, 5000);
  }, [playingSpeakerId]);

  // Cleanup speaker sample timeout on unmount
  useEffect(() => {
    return () => {
      if (speakerSampleTimeoutRef.current) {
        clearTimeout(speakerSampleTimeoutRef.current);
      }
    };
  }, []);

  // Auto-generate summary when flag is set
  useEffect(() => {
    let cancelled = false;

    const autoGenerate = async () => {
      if (shouldAutoGenerate && meetingData.transcripts.length > 0 && !cancelled) {
        console.log(`🤖 Auto-generating summary with ${modelConfig.provider}/${modelConfig.model}...`);
        await summaryGeneration.handleGenerateSummary('');

        // Notify parent that auto-generation is complete (only if not cancelled)
        if (onAutoGenerateComplete && !cancelled) {
          onAutoGenerateComplete();
        }
      }
    };

    autoGenerate();

    // Cleanup: cancel if component unmounts or meeting changes
    return () => {
      cancelled = true;
    };
  }, [shouldAutoGenerate, meeting.id]); // Re-run if meeting changes

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col h-screen bg-gray-50"
    >
      <div className="flex flex-1 overflow-hidden">
        <TranscriptPanel
          transcripts={meetingData.transcripts}
          customPrompt={customPrompt}
          onPromptChange={setCustomPrompt}
          onCopyTranscript={copyOperations.handleCopyTranscript}
          onOpenMeetingFolder={meetingOperations.handleOpenMeetingFolder}
          isRecording={isRecording}
          disableAutoScroll={true}
          // Pagination props for efficient loading
          usePagination={true}
          segments={segments}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
          // Audio playback props
          onSegmentClick={audioFilePath ? handleSegmentClick : undefined}
          currentPlaybackTime={currentPlaybackTime}
          // Audio player
          audioFilePath={audioFilePath}
          audioPlayerRef={audioPlayerRef}
          onAudioTimeUpdate={handleAudioTimeUpdate}
          // Speaker enhancement props
          onFullEnhance={handleFullEnhance}
          onQuickLabel={handleQuickLabel}
          onTagClick={handleTagClick}
        />
        <SummaryPanel
          meeting={meeting}
          meetingTitle={meetingData.meetingTitle}
          onTitleChange={meetingData.handleTitleChange}
          isEditingTitle={meetingData.isEditingTitle}
          onStartEditTitle={() => meetingData.setIsEditingTitle(true)}
          onFinishEditTitle={() => meetingData.setIsEditingTitle(false)}
          isTitleDirty={meetingData.isTitleDirty}
          summaryRef={meetingData.blockNoteSummaryRef}
          isSaving={meetingData.isSaving}
          onSaveAll={meetingData.saveAllChanges}
          onCopySummary={copyOperations.handleCopySummary}
          onOpenFolder={meetingOperations.handleOpenMeetingFolder}
          aiSummary={meetingData.aiSummary}
          summaryStatus={summaryGeneration.summaryStatus}
          transcripts={meetingData.transcripts}
          modelConfig={modelConfig}
          setModelConfig={setModelConfig}
          onSaveModelConfig={handleSaveModelConfig}
          onGenerateSummary={summaryGeneration.handleGenerateSummary}
          onStopGeneration={summaryGeneration.handleStopGeneration}
          customPrompt={customPrompt}
          summaryResponse={summaryResponse}
          onSaveSummary={meetingData.handleSaveSummary}
          onSummaryChange={meetingData.handleSummaryChange}
          onDirtyChange={meetingData.setIsSummaryDirty}
          summaryError={summaryGeneration.summaryError}
          onRegenerateSummary={summaryGeneration.handleRegenerateSummary}
          getSummaryStatusMessage={summaryGeneration.getSummaryStatusMessage}
          availableTemplates={templates.availableTemplates}
          selectedTemplate={templates.selectedTemplate}
          onTemplateSelect={templates.handleTemplateSelection}
          isModelConfigLoading={false}
          onOpenModelSettings={handleRegisterModalOpen}
        />
      </div>
      
      {/* Speaker Tag Modal */}
      <SpeakerTagModal
        isOpen={isSpeakerModalOpen}
        onClose={() => setIsSpeakerModalOpen(false)}
        speakers={speakers}
        onSaveSpeakers={handleSaveSpeakers}
        onPlaySample={handlePlaySpeakerSample}
        playingSpeakerId={playingSpeakerId}
      />
    </motion.div>
  );
}
