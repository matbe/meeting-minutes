"use client";

import { useCallback, useRef, useEffect, useState } from 'react';
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

export function NotesEditor({
  initialBlocks,
  initialMarkdown,
  onChange,
  readOnly = false,
}: NotesEditorProps) {
  const isContentLoaded = useRef(false);
  const [editorReady, setEditorReady] = useState(false);

  // Create editor with initial blocks if available, and enable slash commands for heading formatting
  const editor = useCreateBlockNote({
    initialContent: initialBlocks && initialBlocks.length > 0
      ? (initialBlocks as PartialBlock[])
      : undefined,
    // Slash menu is enabled by default in BlockNote, providing /heading, /paragraph, etc. commands
  });

  // Parse markdown to blocks when only markdown is available (no blocks)
  useEffect(() => {
    if (!initialBlocks && initialMarkdown && editor && !editorReady) {
      const loadMarkdown = async () => {
        try {
          const blocks = await editor.tryParseMarkdownToBlocks(initialMarkdown);
          editor.replaceBlocks(editor.document, blocks);
          setTimeout(() => {
            isContentLoaded.current = true;
            setEditorReady(true);
          }, 100);
        } catch (err) {
          console.error('Failed to parse notes markdown:', err);
          isContentLoaded.current = true;
          setEditorReady(true);
        }
      };
      loadMarkdown();
    } else {
      // Either has blocks or is empty - mark as loaded
      setTimeout(() => {
        isContentLoaded.current = true;
        setEditorReady(true);
      }, 100);
    }
  }, [initialBlocks, initialMarkdown, editor, editorReady]);

  // Handle editor changes
  const handleChange = useCallback(async () => {
    if (!isContentLoaded.current || !editor) return;
    const blocks = editor.document;
    try {
      const markdown = await editor.blocksToMarkdownLossy(blocks);
      onChange(markdown, blocks);
    } catch {
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
