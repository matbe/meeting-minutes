'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { RecordingControls } from '@/components/RecordingControls';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useConfig } from '@/contexts/ConfigContext';
import { StatusOverlays } from '@/app/_components/StatusOverlays';
import Analytics from '@/lib/analytics';
import { SettingsModals } from './_components/SettingsModal';
import { TranscriptPanel } from './_components/TranscriptPanel';
import { useModalState } from '@/hooks/useModalState';
import { useRecordingStateSync } from '@/hooks/useRecordingStateSync';
import { useRecordingStart } from '@/hooks/useRecordingStart';
import { useRecordingStop } from '@/hooks/useRecordingStop';
import { useTranscriptRecovery } from '@/hooks/useTranscriptRecovery';
import { useTeamsMeetingDetection } from '@/hooks/useTeamsMeetingDetection';
import { TranscriptRecovery } from '@/components/TranscriptRecovery';
import { indexedDBService } from '@/services/indexedDBService';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import dynamic from 'next/dynamic';
import { Block } from '@blocknote/core';
import { SummaryPanel } from '@/components/MeetingDetails/SummaryPanel';
import { ModelConfig } from '@/components/ModelSettingsModal';

export default function Home() {
  // Local page state (not moved to contexts)
  const [isRecording, setIsRecordingState] = useState(false);
  const [barHeights, setBarHeights] = useState(['58%', '76%', '58%']);
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);

  // Recording notes state - stored in memory, persisted after meeting save
  const [recordingNotesMarkdown, setRecordingNotesMarkdown] = useState<string>('');
  const [recordingNotesBlocks, setRecordingNotesBlocks] = useState<Block[] | null>(null);
  const [showNotesPanel, setShowNotesPanel] = useState(false);

  // Use contexts for state management
  const { meetingTitle } = useTranscripts();
  const { transcriptModelConfig, selectedDevices } = useConfig();
  const recordingState = useRecordingState();

  // Extract status from global state
  const { status, isStopping, isProcessing, isSaving } = recordingState;

  // Hooks
  const { hasMicrophone } = usePermissionCheck();
  const { setIsMeetingActive, isCollapsed: sidebarCollapsed, refetchMeetings } = useSidebar();
  const { modals, messages, showModal, hideModal } = useModalState(transcriptModelConfig);
  const { isRecordingDisabled, setIsRecordingDisabled } = useRecordingStateSync(isRecording, setIsRecordingState, setIsMeetingActive);
  const { handleRecordingStart } = useRecordingStart(isRecording, setIsRecordingState, showModal);

  // Get handleRecordingStop function and setIsStopping (state comes from global context)
  const { handleRecordingStop, setIsStopping } = useRecordingStop(
    setIsRecordingState,
    setIsRecordingDisabled
  );

  // Wrapper: sync notes React state from sessionStorage after recording starts
  const handleRecordingStartWithNotes = useCallback(async (meetingTitleOverride?: string) => {
    await handleRecordingStart(meetingTitleOverride);
    // Re-sync notes state from sessionStorage (useRecordingStart clears old + sets new template)
    const savedMarkdown = sessionStorage.getItem('recording_notes_markdown');
    setRecordingNotesMarkdown(savedMarkdown || '');
    const savedBlocksJson = sessionStorage.getItem('recording_notes_blocks');
    if (savedBlocksJson) {
      try {
        setRecordingNotesBlocks(JSON.parse(savedBlocksJson) as Block[]);
      } catch {
        setRecordingNotesBlocks(null);
      }
    } else {
      setRecordingNotesBlocks(null);
    }
  }, [handleRecordingStart]);

  // Wrapper: append Teams end time to notes before stop processing (preserves user notes)
  const handleRecordingStopWithNotes = useCallback(async (callApi: boolean = true) => {
    const teamsMeetingTitle = sessionStorage.getItem('teams_meeting_title');
    if (teamsMeetingTitle) {
      const endTime = new Date().toLocaleString();
      const currentNotes = recordingNotesMarkdown || sessionStorage.getItem('recording_notes_markdown') || '';

      // Insert "**Ended:**" right after the "**Started:**" line so the
      // timestamps stay together at the top, rather than appending at the
      // bottom where it gets buried under user notes.
      const startedPattern = /(\*\*Started:\*\*[^\n]*\n)/;
      let updatedNotes: string;
      if (startedPattern.test(currentNotes)) {
        updatedNotes = currentNotes.replace(
          startedPattern,
          `$1**Ended:** ${endTime}\n`
        );
      } else {
        // Fallback: append at the end if template wasn't found
        updatedNotes = currentNotes.trimEnd() + `\n\n**Ended:** ${endTime}\n`;
      }

      setRecordingNotesMarkdown(updatedNotes);
      sessionStorage.setItem('recording_notes_markdown', updatedNotes);
      sessionStorage.removeItem('teams_meeting_title');
      sessionStorage.removeItem('teams_meeting_start');
    }
    await handleRecordingStop(callApi);
  }, [handleRecordingStop, recordingNotesMarkdown]);

  // Teams stop: must invoke stop_recording (normally RecordingControls does this)
  const handleTeamsStopRecording = useCallback(async () => {
    try {
      const dataDir = await appDataDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const savePath = `${dataDir}/recording-${timestamp}.wav`;
      console.log('Teams stop: invoking stop_recording with path:', savePath);
      await invoke('stop_recording', { args: { save_path: savePath } });
    } catch (err) {
      console.error('Failed to stop recording from Teams detection:', err);
    }
    await handleRecordingStopWithNotes(true);
  }, [handleRecordingStopWithNotes]);

  // Teams meeting detection (Windows only, controlled by user preference)
  useTeamsMeetingDetection({
    isRecording: isRecording || recordingState.isRecording,
    onStartRecording: handleRecordingStartWithNotes,
    onStopRecording: handleTeamsStopRecording,
  });

  // Recovery hook
  const {
    recoverableMeetings,
    isLoading: isLoadingRecovery,
    isRecovering,
    checkForRecoverableTranscripts,
    recoverMeeting,
    loadMeetingTranscripts,
    deleteRecoverableMeeting
  } = useTranscriptRecovery();

  const router = useRouter();

  useEffect(() => {
    // Track page view
    Analytics.trackPageView('home');
  }, []);

  // Rehydrate recording notes when returning to this page
  useEffect(() => {
    const savedMarkdown = sessionStorage.getItem('recording_notes_markdown');
    const savedBlocksJson = sessionStorage.getItem('recording_notes_blocks');

    if (savedMarkdown !== null) {
      setRecordingNotesMarkdown(savedMarkdown);
    }

    if (savedBlocksJson) {
      try {
        const parsedBlocks = JSON.parse(savedBlocksJson) as Block[];
        setRecordingNotesBlocks(parsedBlocks);
      } catch {
        setRecordingNotesBlocks(null);
      }
    }
  }, []);

  // Startup recovery check
  useEffect(() => {
    const performStartupChecks = async () => {
      try {
        // Skip recovery check if currently recording or processing stop
        // This prevents the recovery dialog from showing when:
        if (recordingState.isRecording ||
          status === RecordingStatus.STOPPING ||
          status === RecordingStatus.PROCESSING_TRANSCRIPTS ||
          status === RecordingStatus.SAVING) {
          console.log('Skipping recovery check - recording in progress or processing');
          return;
        }

        // 1. Clean up old meetings (7+ days)
        try {
          await indexedDBService.deleteOldMeetings(7);
        } catch (error) {
          console.warn('⚠️ Failed to clean up old meetings:', error);
        }

        // 2. Clean up saved meetings (24+ hours after save)
        try {
          await indexedDBService.deleteSavedMeetings(24);
        } catch (error) {
          console.warn('⚠️ Failed to clean up saved meetings:', error);
        }

        // 3. Always check for recoverable meetings on startup
        // Don't skip based on sessionStorage - we need to check every time
        await checkForRecoverableTranscripts();
      } catch (error) {
        console.error('Failed to perform startup checks:', error);
      }
    };

    performStartupChecks();
  }, [checkForRecoverableTranscripts, recordingState.isRecording, status]);

  // Watch for recoverable meetings changes and show dialog once per session
  useEffect(() => {
    // Only show dialog if we have meetings and haven't shown it yet this session
    if (recoverableMeetings.length > 0) {
      const shownThisSession = sessionStorage.getItem('recovery_dialog_shown');
      if (!shownThisSession) {
        setShowRecoveryDialog(true);
        sessionStorage.setItem('recovery_dialog_shown', 'true');
      }
    }
  }, [recoverableMeetings]);

  // Handle recovery with toast notifications and navigation
  const handleRecovery = async (meetingId: string) => {
    try {
      const result = await recoverMeeting(meetingId);

      if (result.success) {
        toast.success('Meeting recovered successfully!', {
          description: result.audioRecoveryStatus?.status === 'success'
            ? 'Transcripts and audio recovered'
            : 'Transcripts recovered (no audio available)',
          action: result.meetingId ? {
            label: 'View Meeting',
            onClick: () => {
              router.push(`/meeting-details?id=${result.meetingId}`);
            }
          } : undefined,
          duration: 10000,
        });

        // Refresh sidebar to show the newly recovered meeting
        await refetchMeetings();

        // If no more recoverable meetings, clear session flag so dialog can show again
        if (recoverableMeetings.length === 0) {
          sessionStorage.removeItem('recovery_dialog_shown');
        }

        // Auto-navigate after a short delay
        if (result.meetingId) {
          setTimeout(() => {
            router.push(`/meeting-details?id=${result.meetingId}`);
          }, 2000);
        }
      }
    } catch (error) {
      toast.error('Failed to recover meeting', {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
      throw error;
    }
  };

  // Handle dialog close - clear session flag if no meetings left
  const handleDialogClose = () => {
    setShowRecoveryDialog(false);
    // If user closes dialog and there are no more meetings, clear the flag
    // This allows the dialog to show again next session if new meetings appear
    if (recoverableMeetings.length === 0) {
      sessionStorage.removeItem('recovery_dialog_shown');
    }
  };

  useEffect(() => {
    if (recordingState.isRecording) {
      const interval = setInterval(() => {
        setBarHeights(prev => {
          const newHeights = [...prev];
          newHeights[0] = Math.random() * 20 + 10 + 'px';
          newHeights[1] = Math.random() * 20 + 10 + 'px';
          newHeights[2] = Math.random() * 20 + 10 + 'px';
          return newHeights;
        });
      }, 300);

      return () => clearInterval(interval);
    }
  }, [recordingState.isRecording]);

  // Computed values using global status
  const isProcessingStop = status === RecordingStatus.PROCESSING_TRANSCRIPTS || isProcessing;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col h-screen bg-gray-50"
    >
      {/* All Modals supported*/}
      <SettingsModals
        modals={modals}
        messages={messages}
        onClose={hideModal}
      />

      {/* Recovery Dialog */}
      <TranscriptRecovery
        isOpen={showRecoveryDialog}
        onClose={handleDialogClose}
        recoverableMeetings={recoverableMeetings}
        onRecover={handleRecovery}
        onDelete={deleteRecoverableMeeting}
        onLoadPreview={loadMeetingTranscripts}
      />
      <div className="flex flex-1 overflow-hidden">
        <TranscriptPanel
          isProcessingStop={isProcessingStop}
          isStopping={isStopping}
          showModal={showModal}
        />

        {/* Notes Panel - unified interface for recording using SummaryPanel with controls disabled */}
        <div className="hidden md:flex md:w-1/3 lg:w-2/5 min-w-0 border-l border-gray-200 bg-white flex-col">
          <SummaryPanel
            meeting={{
              id: 'recording-session',
              title: meetingTitle || 'New Meeting',
              created_at: new Date().toISOString()
            }}
            meetingTitle={meetingTitle}
            onTitleChange={() => {}}
            isEditingTitle={false}
            onStartEditTitle={() => {}}
            onFinishEditTitle={() => {}}
            isTitleDirty={false}
            summaryRef={{ current: null } as any}
            isSaving={false}
            onSaveAll={async () => {}}
            onCopySummary={async () => {
              if (recordingNotesMarkdown) {
                await navigator.clipboard.writeText(recordingNotesMarkdown);
                toast.success('Notes copied to clipboard');
              }
            }}
            onOpenFolder={async () => {}}
            aiSummary={null}
            summaryStatus="idle"
            transcripts={[]}
            modelConfig={{ provider: 'ollama', model: '', ollamaEndpoint: '' } as ModelConfig}
            setModelConfig={() => {}}
            onSaveModelConfig={async () => {}}
            onGenerateSummary={async () => {}}
            onStopGeneration={() => {}}
            customPrompt=""
            summaryResponse={null}
            onSaveSummary={async () => {}}
            onSummaryChange={() => {}}
            onDirtyChange={() => {}}
            summaryError={null}
            onRegenerateSummary={async () => {}}
            getSummaryStatusMessage={() => ''}
            availableTemplates={[]}
            selectedTemplate=""
            onTemplateSelect={() => {}}
            isModelConfigLoading={false}
            onOpenModelSettings={() => {}}
            notesMarkdown={recordingNotesMarkdown}
            notesBlocks={recordingNotesBlocks}
            notesIsLoading={false}
            notesIsSaving={false}
            notesIsDirty={false}
            onNotesChange={(markdown, blocks) => {
              setRecordingNotesMarkdown(markdown);
              setRecordingNotesBlocks(blocks);
              sessionStorage.setItem('recording_notes_markdown', markdown);
              sessionStorage.setItem('recording_notes_blocks', JSON.stringify(blocks));
            }}
            summaryControlsDisabled={true}
          />
        </div>

        {/* Recording controls - only show when permissions are granted or already recording and not showing status messages */}
        {(hasMicrophone || isRecording) &&
          status !== RecordingStatus.PROCESSING_TRANSCRIPTS &&
          status !== RecordingStatus.SAVING && (
            <div className="fixed bottom-12 left-0 right-0 z-10 pointer-events-none">
              <div
                className="flex justify-center transition-[margin] duration-300 pointer-events-auto"
                style={{
                  marginLeft: sidebarCollapsed ? '4rem' : '16rem'
                }}
              >
                <div className="max-w-[750px] flex justify-center px-4">
                  <div className="bg-white rounded-full shadow-lg flex items-center">
                    <RecordingControls
                      isRecording={recordingState.isRecording}
                      onRecordingStop={(callApi = true) => handleRecordingStopWithNotes(callApi)}
                      onRecordingStart={handleRecordingStartWithNotes}
                      onStopInitiated={() => setIsStopping(true)}
                      barHeights={barHeights}
                      onTranscriptionError={(message) => {
                        showModal('errorAlert', message);
                      }}
                      isRecordingDisabled={isRecordingDisabled}
                      isParentProcessing={isProcessingStop}
                      selectedDevices={selectedDevices}
                      meetingName={meetingTitle}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

        {/* Status Overlays - Processing and Saving */}
        <StatusOverlays
          isProcessing={status === RecordingStatus.PROCESSING_TRANSCRIPTS && !recordingState.isRecording}
          isSaving={status === RecordingStatus.SAVING}
          sidebarCollapsed={sidebarCollapsed}
        />
      </div>
    </motion.div>
  );
}
