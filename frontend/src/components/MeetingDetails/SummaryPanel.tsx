"use client";

import { useEffect, useRef, useState, useCallback, RefObject } from 'react';
import { MeetingSummary, Summary, Transcript } from '@/types';
import { BlockNoteSummaryView, BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { EmptyStateSummary } from '@/components/EmptyStateSummary';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { SummaryGeneratorButtonGroup } from './SummaryGeneratorButtonGroup';
import { SummaryUpdaterButtonGroup } from './SummaryUpdaterButtonGroup';
import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Block } from '@blocknote/core';
import { FileText, Sparkles, Loader2, Languages, ChevronDown } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { toast } from 'sonner';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { LanguagePickerPopover } from '@/components/LanguagePickerPopover';
import { useRecentLanguages } from '@/hooks/useRecentLanguages';
import { labelForCode } from '@/lib/summary-languages';
import {
  readMeetingSummaryLanguage,
  saveMeetingSummaryLanguage,
  SummaryLanguageStorage,
} from '@/lib/summary-language-preferences';
import { hasVisibleSummaryContent } from '@/lib/summary-content';

// Dynamic import to avoid SSR issues - BlockNote requires `document`
const NotesEditor = dynamic(
  () => import('@/components/NotesEditor').then(mod => mod.NotesEditor),
  { ssr: false, loading: () => <div className="p-4 text-gray-400 text-sm">Loading editor...</div> }
);

interface SummaryPanelProps {
  meeting: {
    id: string;
    title: string;
    created_at: string;
  };
  meetingTitle: string;
  isSummaryDirty?: boolean;
  summaryRef: RefObject<BlockNoteSummaryViewRef>;
  isSaving: boolean;
  onSaveAll: () => Promise<void>;
  onCopySummary: () => Promise<void>;
  onCopySummaryMarkdown?: () => Promise<void>;
  onCopySummaryHTML?: () => Promise<void>;
  onOpenFolder?: () => Promise<void>;
  aiSummary: MeetingSummary | null;
  summaryStatus: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  transcripts: Transcript[];
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSaveModelConfig: (config?: ModelConfig) => Promise<void>;
  onGenerateSummary: (customPrompt: string) => Promise<void>;
  onStopGeneration: () => void;
  customPrompt: string;
  onSaveSummary: (summary: MeetingSummary) => Promise<void>;
  onSummaryChange: (summary: MeetingSummary) => void;
  onDirtyChange: (isDirty: boolean) => void;
  summaryError: string | null;
  onRegenerateSummary: () => Promise<void>;
  getSummaryStatusMessage: (status: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error') => string;
  availableTemplates: Array<{ id: string; name: string; description: string }>;
  selectedTemplate: string;
  onTemplateSelect: (templateId: string, templateName: string) => void;
  isModelConfigLoading?: boolean;
  onOpenModelSettings?: (openFn: () => void) => void;
  // Title editing & dirty state props (optional)
  onTitleChange?: (title: string) => void;
  isEditingTitle?: boolean;
  onStartEditTitle?: () => void;
  onFinishEditTitle?: () => void;
  isTitleDirty?: boolean;

  // Notes props
  notesMarkdown?: string;
  notesBlocks?: Block[] | null;
  notesIsLoading?: boolean;
  notesIsSaving?: boolean;
  notesIsDirty?: boolean;
  onNotesChange?: (markdown: string, blocks: Block[]) => void;
  /** Whether summary controls (Generate, AI Model) should be disabled */
  summaryControlsDisabled?: boolean;
}

export function SummaryPanel({
  meeting,
  meetingTitle,
  isSummaryDirty = false,
  summaryRef,
  isSaving,
  onSaveAll,
  onCopySummary,
  onCopySummaryMarkdown,
  onCopySummaryHTML,
  onOpenFolder,
  aiSummary,
  summaryStatus,
  transcripts,
  modelConfig,
  setModelConfig,
  onSaveModelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
  onSaveSummary,
  onSummaryChange,
  onDirtyChange,
  summaryError,
  onRegenerateSummary,
  getSummaryStatusMessage,
  availableTemplates,
  selectedTemplate,
  onTemplateSelect,
  isModelConfigLoading = false,
  onOpenModelSettings,
  isTitleDirty = false,
  notesMarkdown = '',
  notesBlocks = null,
  notesIsLoading = false,
  notesIsSaving = false,
  notesIsDirty = false,
  onNotesChange,
  summaryControlsDisabled = false,
}: SummaryPanelProps) {
  const [summaryLang, setSummaryLang] = useState<string | null>(null);
  const [summaryLangStorage, setSummaryLangStorage] = useState<SummaryLanguageStorage>('metadata');
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const languageLoadVersionRef = useRef(0);
  const activeMeetingIdRef = useRef(meeting.id);
  const languageSaveVersionRef = useRef(0);
  const languageSaveLoopRunningRef = useRef(false);
  const latestLanguageSaveRequestRef = useRef<{
    version: number;
    meetingId: string;
    language: string | null;
    rollback: {
      language: string | null;
      storage: SummaryLanguageStorage;
    };
  } | null>(null);
  activeMeetingIdRef.current = meeting.id;
  const { addRecent } = useRecentLanguages();

  const effectiveLangLabel = summaryLang ? labelForCode(summaryLang) : 'Auto';
  const isLocalFallbackLanguage = summaryLangStorage === 'local_fallback';
  const autoSubtitle = isLocalFallbackLanguage
    ? 'Saved on this device for folderless meetings'
    : 'Uses dominant transcript language';

  useEffect(() => {
    if (summaryControlsDisabled || !meeting.id || meeting.id === 'recording-session') {
      setSummaryLang(null);
      return;
    }

    let cancelled = false;
    const loadVersion = languageLoadVersionRef.current + 1;
    languageLoadVersionRef.current = loadVersion;

    const loadSummaryLanguage = async () => {
      try {
        const stored = await readMeetingSummaryLanguage(meeting.id);
        if (!cancelled && languageLoadVersionRef.current === loadVersion) {
          setSummaryLang(stored.language);
          setSummaryLangStorage(stored.storage);
        }
      } catch (err) {
        console.error('Failed to load summary language:', err);
        toast.warning('Could not load saved summary language', {
          description: 'Using Auto until meeting metadata can be read.',
        });
        if (!cancelled && languageLoadVersionRef.current === loadVersion) setSummaryLang(null);
      }
    };

    loadSummaryLanguage();

    return () => {
      cancelled = true;
    };
  }, [meeting.id, summaryControlsDisabled]);

  const persistLatestLanguageSelection = async () => {
    if (languageSaveLoopRunningRef.current) return;
    languageSaveLoopRunningRef.current = true;

    try {
      while (true) {
        const request = latestLanguageSaveRequestRef.current;
        if (!request) return;

        try {
          const saved = await saveMeetingSummaryLanguage(request.meetingId, request.language);
          const latest = latestLanguageSaveRequestRef.current;
          if (
            latest?.version === request.version &&
            activeMeetingIdRef.current === request.meetingId
          ) {
            setSummaryLang(saved.language);
            setSummaryLangStorage(saved.storage);
            if (saved.storage === 'local_fallback') {
              toast.info('Summary language saved on this device', {
                description: 'This meeting has no recording folder, so the preference cannot be written to meeting metadata.',
              });
            }
            if (request.language) {
              addRecent(request.language);
            }
            return;
          }

          if (latest?.version === request.version) return;
        } catch (err) {
          const latest = latestLanguageSaveRequestRef.current;
          if (
            latest?.version === request.version &&
            activeMeetingIdRef.current === request.meetingId
          ) {
            console.error('Failed to persist summary language:', err);
            toast.error('Failed to save summary language');
            setSummaryLang(request.rollback.language);
            setSummaryLangStorage(request.rollback.storage);
            return;
          }

          console.warn('Ignoring failed stale summary language save:', err);
          if (latest?.version === request.version) return;
        }
      }
    } finally {
      languageSaveLoopRunningRef.current = false;
    }
  };

  const handleLangChange = (code: string | null) => {
    const previous = summaryLang;
    const previousStorage = summaryLangStorage;
    const nextStored = code;
    languageLoadVersionRef.current += 1;
    latestLanguageSaveRequestRef.current = {
      version: languageSaveVersionRef.current + 1,
      meetingId: meeting.id,
      language: nextStored,
      rollback: {
        language: previous,
        storage: previousStorage,
      },
    };
    languageSaveVersionRef.current += 1;
    setSummaryLang(nextStored);
    setLangPickerOpen(false);
    void persistLatestLanguageSelection();
  };

  const isSummaryLoading = summaryStatus === 'processing' || summaryStatus === 'summarizing' || summaryStatus === 'regenerating';
  const hasSummary = hasVisibleSummaryContent(aiSummary);

  const [activeTab, setActiveTab] = useState<string>('notes');
  const [isOverwriteConfirmOpen, setIsOverwriteConfirmOpen] = useState(false);
  const [isGeneratePendingConfirm, setIsGeneratePendingConfirm] = useState(false);

  // Keep Summary tab inaccessible while controls are disabled (recording flow)
  useEffect(() => {
    if (summaryControlsDisabled && activeTab === 'summary') {
      setActiveTab('notes');
    }
  }, [summaryControlsDisabled, activeTab]);

  const handleTabChange = (value: string) => {
    if (summaryControlsDisabled && value === 'summary') {
      toast.info('Summary is available after recording is complete');
      setActiveTab('notes');
      return;
    }

    setActiveTab(value);
  };

  const hasExistingSummaryContent = useCallback(() => {
    return hasVisibleSummaryContent(aiSummary) || (summaryRef.current?.isDirty ?? false);
  }, [aiSummary, summaryRef]);

  const runGenerateSummary = useCallback(async () => {
    await onGenerateSummary(customPrompt);
  }, [onGenerateSummary, customPrompt]);

  const handleGenerateSummaryWithConfirm = useCallback(async () => {
    if (hasExistingSummaryContent()) {
      setIsGeneratePendingConfirm(true);
      setIsOverwriteConfirmOpen(true);
      return;
    }

    await runGenerateSummary();
  }, [hasExistingSummaryContent, runGenerateSummary]);

  const handleConfirmOverwriteGenerate = useCallback(async () => {
    setIsOverwriteConfirmOpen(false);

    if (!isGeneratePendingConfirm) {
      return;
    }

    setIsGeneratePendingConfirm(false);
    await runGenerateSummary();
  }, [isGeneratePendingConfirm, runGenerateSummary]);

  const handleCancelOverwriteGenerate = useCallback(() => {
    setIsOverwriteConfirmOpen(false);
    setIsGeneratePendingConfirm(false);
    toast.info('Summary generation cancelled');
  }, []);

  const handleOverwriteDialogOpenChange = useCallback((open: boolean) => {
    setIsOverwriteConfirmOpen(open);
    if (!open) {
      setIsGeneratePendingConfirm(false);
    }
  }, []);

  const handleCopyActiveTab = useCallback(async () => {
    if (activeTab === 'notes') {
      if (!notesMarkdown.trim()) {
        toast.error('No notes content available to copy');
        return;
      }

      await navigator.clipboard.writeText(notesMarkdown);
      toast.success('Notes copied to clipboard');
      return;
    }

    await onCopySummary();
  }, [activeTab, notesMarkdown, onCopySummary]);

  const handleCopyActiveTabMarkdown = useCallback(async () => {
    if (activeTab === 'notes') {
      if (!notesMarkdown.trim()) {
        toast.error('No notes content available to copy');
        return;
      }

      await navigator.clipboard.writeText(notesMarkdown);
      toast.success('Notes copied to clipboard as Markdown');
      return;
    }

    if (onCopySummaryMarkdown) {
      await onCopySummaryMarkdown();
    } else {
      await onCopySummary();
    }
  }, [activeTab, notesMarkdown, onCopySummary, onCopySummaryMarkdown]);

  const handleCopyActiveTabHTML = useCallback(async () => {
    if (activeTab === 'notes') {
      if (!notesMarkdown.trim()) {
        toast.error('No notes content available to copy');
        return;
      }

      // For notes, convert to rich HTML format
      const { generateRichHTML, copyHtmlToClipboard } = await import('@/lib/markdown-to-html');
      const htmlContent = generateRichHTML(notesMarkdown, 'Notes', {
        meetingId: meeting.id,
        date: new Date(meeting.created_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        copiedOn: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      });

      await copyHtmlToClipboard(htmlContent, notesMarkdown);
      toast.success('Notes copied to clipboard as HTML');
      return;
    }

    if (onCopySummaryHTML) {
      await onCopySummaryHTML();
    } else {
      await onCopySummary();
    }
  }, [activeTab, notesMarkdown, meeting, onCopySummary, onCopySummaryHTML]);

  const languageSlot = (
    <Popover open={langPickerOpen} onOpenChange={setLangPickerOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          title={`Summary language: ${effectiveLangLabel}${isLocalFallbackLanguage ? ' (saved on this device)' : ''}`}
          aria-label="Set summary language"
        >
          <Languages size={18} />
          <span className="hidden @[40rem]:inline">{effectiveLangLabel}</span>
          <ChevronDown size={14} className="text-gray-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto p-0 border-0 shadow-none bg-transparent"
      >
        <LanguagePickerPopover
          value={summaryLang}
          onChange={handleLangChange}
          onClose={() => setLangPickerOpen(false)}
          autoSubtitle={autoSubtitle}
        />
      </PopoverContent>
    </Popover>
  );

  const summaryButtonGroup = (
    <SummaryGeneratorButtonGroup
      modelConfig={modelConfig}
      setModelConfig={setModelConfig}
      onSaveModelConfig={onSaveModelConfig}
      onGenerateSummary={handleGenerateSummaryWithConfirm}
      onStopGeneration={onStopGeneration}
      customPrompt={customPrompt}
      summaryStatus={summaryStatus}
      availableTemplates={availableTemplates}
      selectedTemplate={selectedTemplate}
      onTemplateSelect={onTemplateSelect}
      hasTranscripts={!summaryControlsDisabled && transcripts.length > 0}
      hasSummary={hasSummary}
      isModelConfigLoading={isModelConfigLoading}
      onOpenModelSettings={onOpenModelSettings}
      languageSlot={transcripts.length > 0 || hasSummary ? languageSlot : undefined}
    />
  );

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white overflow-hidden h-full w-full @container">
      <Dialog open={isOverwriteConfirmOpen} onOpenChange={handleOverwriteDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Overwrite existing summary?</DialogTitle>
            <DialogDescription>
              A summary already exists. Generating again will overwrite the current summary.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelOverwriteGenerate}>
              Cancel
            </Button>
            <Button onClick={handleConfirmOverwriteGenerate}>
              Overwrite & Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col h-full">
        {/* Tab header area with controls */}
        <div className="border-b border-gray-200">
          <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2 flex-wrap">
            <TabsList className="bg-gray-100/80 flex-shrink-0">
              <TabsTrigger value="notes" className="flex items-center gap-1.5 text-sm">
                <FileText size={14} />
                Notes
                {notesIsSaving && <Loader2 size={12} className="animate-spin text-gray-400" />}
                {notesIsDirty && !notesIsSaving && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
              </TabsTrigger>
              <TabsTrigger
                value="summary"
                className="flex items-center gap-1.5 text-sm"
                disabled={summaryControlsDisabled}
              >
                <Sparkles size={14} />
                Summary
                {isSummaryLoading && <Loader2 size={12} className="animate-spin text-blue-500" />}
              </TabsTrigger>
            </TabsList>

            {/* Summary & updater controls */}
            <div className="flex items-center gap-1 flex-shrink min-w-0 flex-wrap justify-end">
              <div className="flex-shrink-0">
                <SummaryUpdaterButtonGroup
                  isSaving={isSaving}
                  isDirty={isTitleDirty || isSummaryDirty || (summaryRef.current?.isDirty || false) || notesIsDirty}
                  onSave={onSaveAll}
                  onCopy={handleCopyActiveTab}
                  onCopyMarkdown={handleCopyActiveTabMarkdown}
                  onCopyHTML={handleCopyActiveTabHTML}
                  onFind={() => {
                    console.log('Find in summary clicked');
                  }}
                  onOpenFolder={onOpenFolder}
                  hasSummary={activeTab === 'notes' ? notesMarkdown.trim().length > 0 : hasSummary}
                />
              </div>
              <div className="flex-shrink-0">
                {summaryButtonGroup}
              </div>
            </div>
          </div>
        </div>

        {/* Notes Tab Content */}
        <TabsContent value="notes" className="flex-1 overflow-hidden m-0 data-[state=inactive]:hidden">
          <div className="flex flex-col h-full">
            {notesIsLoading ? (
              <div className="flex items-center justify-center flex-1">
                <div className="text-center">
                  <Loader2 className="animate-spin h-8 w-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-400 text-sm">Loading notes...</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-6">
                <NotesEditor
                  initialBlocks={notesBlocks}
                  initialMarkdown={notesMarkdown}
                  onChange={onNotesChange || (() => {})}
                />
              </div>
            )}
          </div>
        </TabsContent>

        {/* Summary Tab Content */}
        <TabsContent value="summary" className="flex-1 overflow-hidden min-h-0 m-0 data-[state=inactive]:hidden">
          {isSummaryLoading ? (
            <div className="flex items-center justify-center flex-1 h-full">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
                <p className="text-gray-600">Generating AI Summary...</p>
              </div>
            </div>
          ) : !hasSummary ? (
            <div className="flex flex-col h-full">
              <EmptyStateSummary
                onGenerate={handleGenerateSummaryWithConfirm}
                hasModel={modelConfig.provider !== null && modelConfig.model !== null}
                isGenerating={isSummaryLoading}
                error={summaryError}
              />
            </div>
          ) : (
            <div className="flex-1 h-full overflow-y-auto min-h-0 custom-scrollbar">
              <div className="p-6 w-full">
                <BlockNoteSummaryView
                  ref={summaryRef}
                  summaryData={aiSummary}
                  onSave={onSaveSummary}
                  onSummaryChange={onSummaryChange}
                  onDirtyChange={onDirtyChange}
                  status={summaryStatus}
                  error={summaryError}
                  onRegenerateSummary={() => {
                    Analytics.trackButtonClick('regenerate_summary', 'meeting_details');
                    onRegenerateSummary();
                  }}
                  meeting={{
                    id: meeting.id,
                    title: meetingTitle,
                    created_at: meeting.created_at,
                  }}
                />
              </div>
              {summaryStatus !== 'idle' && (
                <div className={`mt-4 p-4 rounded-lg ${summaryStatus === 'error' ? 'bg-red-100 text-red-700' :
                  summaryStatus === 'completed' ? 'bg-green-100 text-green-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                  <p className="text-sm font-medium">{getSummaryStatusMessage(summaryStatus)}</p>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
