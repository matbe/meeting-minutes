"use client";

import { useCallback, useRef, useEffect } from 'react';
import { Block, PartialBlock } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import "@blocknote/shadcn/style.css";

interface NotesEditorProps {
  /** Initial BlockNote blocks (from saved notes_json) */
  initialBlocks: Block[] | null;
  /** Initial markdown content (fallback if no blocks) */
  initialMarkdown: string;
  /** Called when content changes with markdown + blocks */
  onChange: (markdown: string, blocks: Block[]) => void;
  /** Whether the editor is read-only */
  readOnly?: boolean;
}

function buildContentSignature(markdown: string, blocks: Block[] | null): string {
  return JSON.stringify({
    markdown,
    blocks: blocks ?? null,
  });
}

export function NotesEditor({
  initialBlocks,
  initialMarkdown,
  onChange,
  readOnly = false,
}: NotesEditorProps) {
  const isContentLoaded = useRef(false);
  const lastExternalSignatureRef = useRef<string | null>(null);
  const lastEmittedSignatureRef = useRef<string | null>(null);

  // Create editor with initial blocks if available, and enable slash commands for heading formatting
  const editor = useCreateBlockNote({
    initialContent: initialBlocks && initialBlocks.length > 0
      ? (initialBlocks as PartialBlock[])
      : undefined,
    // Slash menu is enabled by default in BlockNote, providing /heading, /paragraph, etc. commands
  });

  // Keep the editor in sync when notes are loaded or refreshed externally.
  useEffect(() => {
    const syncEditorContent = async () => {
      const nextSignature = buildContentSignature(initialMarkdown, initialBlocks);

      if (!editor || lastExternalSignatureRef.current === nextSignature) {
        return;
      }

      lastExternalSignatureRef.current = nextSignature;

      if (lastEmittedSignatureRef.current === nextSignature) {
        isContentLoaded.current = true;
        return;
      }

      isContentLoaded.current = false;

      try {
        const blocksToApply = initialBlocks && initialBlocks.length > 0
          ? (initialBlocks as PartialBlock[])
          : await editor.tryParseMarkdownToBlocks(initialMarkdown || '');

        editor.replaceBlocks(editor.document, blocksToApply);
      } catch (err) {
        console.error('Failed to sync notes content:', err);
      } finally {
        isContentLoaded.current = true;
      }
    };

    syncEditorContent();
  }, [initialBlocks, initialMarkdown, editor]);

  // Handle editor changes
  const handleChange = useCallback(async () => {
    if (!isContentLoaded.current || !editor) return;
    const blocks = editor.document;
    try {
      const markdown = await editor.blocksToMarkdownLossy(blocks);
      lastEmittedSignatureRef.current = buildContentSignature(markdown, blocks);
      onChange(markdown, blocks);
    } catch {
      lastEmittedSignatureRef.current = buildContentSignature('', blocks);
      onChange('', blocks);
    }
  }, [editor, onChange]);

  return (
    <div className="flex flex-col w-full h-full overflow-y-auto notes-editor">
      <BlockNoteView
        editor={editor}
        editable={!readOnly}
        onChange={handleChange}
        theme="light"
      />
    </div>
  );
}
