import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Block } from '@blocknote/core';

interface MeetingNotesResponse {
  meeting_id: string;
  notes_markdown: string | null;
  notes_json: string | null;
}

interface UseNotesProps {
  meetingId: string | null;
  autoSaveDelay?: number; // debounce ms, default 1500
}

interface UseNotesReturn {
  notesMarkdown: string;
  notesBlocks: Block[] | null;
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  saveNotes: (markdown: string, blocks?: Block[], targetMeetingId?: string) => Promise<boolean>;
  updateNotes: (markdown: string, blocks?: Block[]) => void;
  getNotesForPrompt: () => string;
}

export function useNotes({ meetingId, autoSaveDelay = 1500 }: UseNotesProps): UseNotesReturn {
  const [notesMarkdown, setNotesMarkdown] = useState<string>('');
  const [notesBlocks, setNotesBlocks] = useState<Block[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentMeetingIdRef = useRef<string | null>(null);
  const latestMarkdownRef = useRef<string>('');
  const latestBlocksRef = useRef<Block[] | null>(null);

  // Load notes when meetingId changes
  useEffect(() => {
    if (!meetingId) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      setNotesMarkdown('');
      setNotesBlocks(null);
      setIsDirty(false);
      currentMeetingIdRef.current = null;
      return;
    }

    // Don't reload if same meeting
    if (currentMeetingIdRef.current === meetingId) return;
    currentMeetingIdRef.current = meetingId;

    const loadNotes = async () => {
      setIsLoading(true);
      try {
        const response = await invoke<MeetingNotesResponse>('api_get_meeting_notes', {
          meetingId,
        });

        if (response.notes_json) {
          try {
            const blocks = JSON.parse(response.notes_json) as Block[];
            setNotesBlocks(blocks);
            latestBlocksRef.current = blocks;
          } catch {
            setNotesBlocks(null);
            latestBlocksRef.current = null;
          }
        } else {
          setNotesBlocks(null);
          latestBlocksRef.current = null;
        }

        setNotesMarkdown(response.notes_markdown ?? '');
        latestMarkdownRef.current = response.notes_markdown ?? '';
        setIsDirty(false);
      } catch (error) {
        console.error('Failed to load meeting notes:', error);
        // Not a fatal error - just means no notes yet
        setNotesMarkdown('');
        setNotesBlocks(null);
        latestMarkdownRef.current = '';
        latestBlocksRef.current = null;
      } finally {
        setIsLoading(false);
      }
    };

    loadNotes();
  }, [meetingId]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // Save notes to database
  const saveNotes = useCallback(async (markdown: string, blocks?: Block[], targetMeetingId?: string) => {
    // Allow saving to a specific meeting ID (for recording notes that need to go to a specific meeting)
    // Falls back to the hook's meetingId if no target is specified
    const idToSaveTo = targetMeetingId || meetingId;
    if (!idToSaveTo) return false;

    setIsSaving(true);
    try {
      await invoke('api_save_meeting_notes', {
        meetingId: idToSaveTo,
        notesMarkdown: markdown || null,
        notesJson: blocks ? JSON.stringify(blocks) : null,
      });
      setIsDirty(false);
      console.log('📝 Notes saved for meeting:', idToSaveTo);
      return true;
    } catch (error) {
      console.error('Failed to save meeting notes:', error);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [meetingId]);

  // Update notes with debounced auto-save
  const updateNotes = useCallback((markdown: string, blocks?: Block[]) => {
    setNotesMarkdown(markdown);
    latestMarkdownRef.current = markdown;
    if (blocks) {
      setNotesBlocks(blocks);
      latestBlocksRef.current = blocks;
    }
    setIsDirty(true);

    // Debounced auto-save
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      saveNotes(latestMarkdownRef.current, latestBlocksRef.current ?? undefined);
    }, autoSaveDelay);
  }, [saveNotes, autoSaveDelay]);

  // Get notes content for use as customPrompt in summarization
  const getNotesForPrompt = useCallback((): string => {
    return latestMarkdownRef.current || '';
  }, []);

  return {
    notesMarkdown,
    notesBlocks,
    isLoading,
    isSaving,
    isDirty,
    saveNotes,
    updateNotes,
    getNotesForPrompt,
  };
}
