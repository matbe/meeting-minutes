"use client";

import { useState, useCallback, useEffect } from 'react';
import { Summary, SummaryResponse, Transcript } from '@/types';
import { EditableTitle } from '@/components/EditableTitle';
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

// Dynamic import to avoid SSR issues - BlockNote requires `document`
const NotesEditor = dynamic(
  () => import('@/components/NotesEditor').then(mod => mod.NotesEditor),
  { ssr: false, loading: () => <div className="p-4 text-gray-400 text-sm">Loading editor...</div> }
);
import { Block } from '@blocknote/core';
import { FileText, Sparkles, Loader2 } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { RefObject } from 'react';
import { toast } from 'sonner';

interface SummaryPanelProps {
  meeting: {
    id: string;
    title: string;
    created_at: string;
  };
  meetingTitle: string;
  onTitleChange: (title: string) => void;
  isEditingTitle: boolean;
  onStartEditTitle: () => void;
  onFinishEditTitle: () => void;
  isTitleDirty: boolean;
  summaryRef: RefObject<BlockNoteSummaryViewRef>;
  isSaving: boolean;
  onSaveAll: () => Promise<void>;
  onCopySummary: () => Promise<void>;
  onCopySummaryMarkdown?: () => Promise<void>;
  onCopySummaryHTML?: () => Promise<void>;
  onOpenFolder: () => Promise<void>;
  aiSummary: Summary | null;
  summaryStatus: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  transcripts: Transcript[];
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSaveModelConfig: (config?: ModelConfig) => Promise<void>;
  onGenerateSummary: (customPrompt: string) => Promise<void>;
  onStopGeneration: () => void;
  customPrompt: string;
  summaryResponse: SummaryResponse | null;
  onSaveSummary: (summary: Summary | { markdown?: string; summary_json?: any[] }) => Promise<void>;
  onSummaryChange: (summary: Summary) => void;
  onDirtyChange: (isDirty: boolean) => void;
  summaryError: string | null;
  onRegenerateSummary: () => Promise<void>;
  getSummaryStatusMessage: (status: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error') => string;
  availableTemplates: Array<{ id: string, name: string, description: string }>;
  selectedTemplate: string;
  onTemplateSelect: (templateId: string, templateName: string) => void;
  isModelConfigLoading?: boolean;
  onOpenModelSettings?: (openFn: () => void) => void;
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
  onTitleChange,
  isEditingTitle,
  onStartEditTitle,
  onFinishEditTitle,
  isTitleDirty,
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
  summaryResponse,
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
  notesMarkdown = '',
  notesBlocks = null,
  notesIsLoading = false,
  notesIsSaving = false,
  notesIsDirty = false,
  onNotesChange,
  summaryControlsDisabled = false,
}: SummaryPanelProps) {
  const isSummaryLoading = summaryStatus === 'processing' || summaryStatus === 'summarizing' || summaryStatus === 'regenerating';
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
    const summaryData = aiSummary as any;

    if (summaryData) {
      if (typeof summaryData.markdown === 'string' && summaryData.markdown.trim().length > 0) {
        return true;
      }

      if (Array.isArray(summaryData.summary_json) && summaryData.summary_json.length > 0) {
        return true;
      }

      const hasLegacySections = Object.entries(summaryData).some(([key, section]) => {
        if (key === '_section_order' || key === 'MeetingName') {
          return false;
        }

        if (!section || typeof section !== 'object') {
          return false;
        }

        const sectionData = section as { blocks?: unknown[] };
        return Array.isArray(sectionData.blocks) && sectionData.blocks.length > 0;
      });

      if (hasLegacySections) {
        return true;
      }
    }

    if (summaryRef.current?.isDirty) {
      return true;
    }

    const responseSummary = summaryResponse?.summary as Record<string, unknown> | undefined;
    return !!responseSummary && Object.keys(responseSummary).length > 0;
  }, [aiSummary, summaryRef, summaryResponse]);

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

      // For notes, also convert to HTML format
      const { generateRichHTML, copyHtmlToClipboard } = await import('@/lib/markdown-to-html');
      const htmlContent = generateRichHTML(notesMarkdown, 'Notes', {
        meetingId: meeting.id,
        date: new Date(meeting.created_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }),
        copiedOn: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
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

  // Shared button group for summary generator - always visible
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
      isModelConfigLoading={isModelConfigLoading}
      onOpenModelSettings={onOpenModelSettings}
    />
  );

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white overflow-hidden">
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
          <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-0">
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

            {/* Summary controls - always visible */}
            <div className="flex items-center gap-1 pb-2 flex-shrink min-w-0 flex-wrap justify-end">
              <div className="flex-shrink-0">
                <SummaryUpdaterButtonGroup
                  isSaving={isSaving}
                  isDirty={isTitleDirty || (summaryRef.current?.isDirty || false) || notesIsDirty}
                  onSave={onSaveAll}
                  onCopy={handleCopyActiveTab}
                  onCopyMarkdown={handleCopyActiveTabMarkdown}
                  onCopyHTML={handleCopyActiveTabHTML}
                  onFind={() => {
                    console.log('Find in summary clicked');
                  }}
                  onOpenFolder={onOpenFolder}
                  hasSummary={activeTab === 'notes' ? notesMarkdown.trim().length > 0 : !!aiSummary}
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
            <div className="flex flex-col h-full">
              {/* Loading spinner */}
              <div className="flex items-center justify-center flex-1">
                <div className="text-center">
                  <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
                  <p className="text-gray-600">Generating AI Summary...</p>
                </div>
              </div>
            </div>
          ) : !aiSummary ? (
            <div className="flex flex-col h-full">
              {/* Empty state message */}
              <EmptyStateSummary
                onGenerate={handleGenerateSummaryWithConfirm}
                hasModel={modelConfig.provider !== null && modelConfig.model !== null}
                isGenerating={isSummaryLoading}
              />
            </div>
          ) : transcripts?.length > 0 && (
            <div className="flex-1 h-full overflow-y-auto min-h-0 custom-scrollbar">
              {summaryResponse && (
                <div className="bg-gray-50 border-b border-gray-200 p-4 max-h-[33vh] overflow-y-auto">
                  <h3 className="text-lg font-semibold mb-2">Meeting Summary</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="bg-white p-4 rounded-lg shadow-sm">
                      <h4 className="font-medium mb-1">Key Points</h4>
                      <ul className="list-disc pl-4">
                        {summaryResponse.summary.key_points.blocks.map((block, i) => (
                          <li key={i} className="text-sm">{block.content}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="bg-white p-4 rounded-lg shadow-sm mt-4">
                      <h4 className="font-medium mb-1">Action Items</h4>
                      <ul className="list-disc pl-4">
                        {summaryResponse.summary.action_items.blocks.map((block, i) => (
                          <li key={i} className="text-sm">{block.content}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="bg-white p-4 rounded-lg shadow-sm mt-4">
                      <h4 className="font-medium mb-1">Decisions</h4>
                      <ul className="list-disc pl-4">
                        {summaryResponse.summary.decisions.blocks.map((block, i) => (
                          <li key={i} className="text-sm">{block.content}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="bg-white p-4 rounded-lg shadow-sm mt-4">
                      <h4 className="font-medium mb-1">Main Topics</h4>
                      <ul className="list-disc pl-4">
                        {summaryResponse.summary.main_topics.blocks.map((block, i) => (
                          <li key={i} className="text-sm">{block.content}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {summaryResponse.raw_summary ? (
                    <div className="mt-4">
                      <h4 className="font-medium mb-1">Full Summary</h4>
                      <p className="text-sm whitespace-pre-wrap">{summaryResponse.raw_summary}</p>
                    </div>
                  ) : null}
                </div>
              )}
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
                    created_at: meeting.created_at
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
