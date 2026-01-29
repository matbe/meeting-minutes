"use client";

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, FolderOpen } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { EnhanceButton } from '@/components/EnhanceButton';


interface TranscriptButtonGroupProps {
  transcriptCount: number;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  onFullEnhance?: () => void;
  onQuickLabel?: () => void;
}


export function TranscriptButtonGroup({
  transcriptCount,
  onCopyTranscript,
  onOpenMeetingFolder,
  onFullEnhance,
  onQuickLabel
}: TranscriptButtonGroupProps) {
  return (
    <div className="flex items-center justify-center w-full gap-2">
      <ButtonGroup>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            Analytics.trackButtonClick('copy_transcript', 'meeting_details');
            onCopyTranscript();
          }}
          disabled={transcriptCount === 0}
          title={transcriptCount === 0 ? 'No transcript available' : 'Copy Transcript'}
        >
          <Copy />
          <span className="hidden lg:inline">Copy</span>
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="xl:px-4"
          onClick={() => {
            Analytics.trackButtonClick('open_recording_folder', 'meeting_details');
            onOpenMeetingFolder();
          }}
          title="Open Recording Folder"
        >
          <FolderOpen className="xl:mr-2" size={18} />
          <span className="hidden lg:inline">Recording</span>
        </Button>

        {onFullEnhance && onQuickLabel && (
          <EnhanceButton
            onFullEnhance={() => {
              Analytics.trackButtonClick('full_enhance', 'meeting_details');
              onFullEnhance();
            }}
            onQuickLabel={() => {
              Analytics.trackButtonClick('quick_label', 'meeting_details');
              onQuickLabel();
            }}
            disabled={transcriptCount === 0}
          />
        )}
      </ButtonGroup>
    </div>
  );
}
