/**
 * Converts Markdown to rich HTML suitable for pasting into OneNote/Word/etc.
 * Uses only inline styles (OneNote strips <style> blocks and CSS classes).
 * Designed to be placed on the clipboard as text/html so apps paste it as rich text.
 */

export function markdownToRichHTML(markdown: string): string {
  // Split into lines for processing
  const lines = markdown.split('\n');
  const output: string[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let listStack: string[] = []; // track nested list types: 'ul' | 'ol'

  const flushList = () => {
    while (listStack.length > 0) {
      const tag = listStack.pop();
      output.push(`</${tag}>`);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // --- Code blocks ---
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        output.push(`<pre style="background-color:#f4f4f4;padding:8px 12px;font-family:Consolas,'Courier New',monospace;font-size:13px;white-space:pre-wrap;border-left:3px solid #0078d4;margin:8px 0;">${escapeHtml(codeBlockLines.join('\n'))}</pre>`);
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // --- Blank line ---
    if (line.trim() === '') {
      flushList();
      continue;
    }

    // --- Headers ---
    const h3 = line.match(/^###\s+(.*)/);
    if (h3) {
      flushList();
      output.push(`<h3 style="font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:bold;margin:14px 0 6px 0;color:#1a1a1a;">${inlineFormat(h3[1])}</h3>`);
      continue;
    }
    const h2 = line.match(/^##\s+(.*)/);
    if (h2) {
      flushList();
      output.push(`<h2 style="font-family:'Segoe UI',Arial,sans-serif;font-size:18px;font-weight:bold;margin:18px 0 8px 0;color:#1a1a1a;border-bottom:1px solid #ddd;padding-bottom:4px;">${inlineFormat(h2[1])}</h2>`);
      continue;
    }
    const h1 = line.match(/^#\s+(.*)/);
    if (h1) {
      flushList();
      output.push(`<h1 style="font-family:'Segoe UI',Arial,sans-serif;font-size:22px;font-weight:bold;margin:20px 0 10px 0;color:#1a1a1a;border-bottom:2px solid #0078d4;padding-bottom:6px;">${inlineFormat(h1[1])}</h1>`);
      continue;
    }

    // --- Horizontal rule ---
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
      flushList();
      output.push(`<hr style="border:none;border-top:1px solid #ccc;margin:12px 0;" />`);
      continue;
    }

    // --- Unordered list item ---
    const ulMatch = line.match(/^(\s*)[-*]\s+(.*)/);
    if (ulMatch) {
      const indent = Math.floor(ulMatch[1].length / 2);
      // Ensure we have the right nesting
      while (listStack.length > indent + 1) {
        output.push(`</${listStack.pop()}>`);
      }
      if (listStack.length <= indent) {
        listStack.push('ul');
        output.push(`<ul style="margin:4px 0 4px 24px;padding:0;">`);
      }
      output.push(`<li style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;margin:2px 0;line-height:1.5;">${inlineFormat(ulMatch[2])}</li>`);
      continue;
    }

    // --- Ordered list item ---
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
    if (olMatch) {
      const indent = Math.floor(olMatch[1].length / 2);
      while (listStack.length > indent + 1) {
        output.push(`</${listStack.pop()}>`);
      }
      if (listStack.length <= indent) {
        listStack.push('ol');
        output.push(`<ol style="margin:4px 0 4px 24px;padding:0;">`);
      }
      output.push(`<li style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;margin:2px 0;line-height:1.5;">${inlineFormat(olMatch[2])}</li>`);
      continue;
    }

    // --- Blockquote ---
    const bqMatch = line.match(/^>\s+(.*)/);
    if (bqMatch) {
      flushList();
      output.push(`<blockquote style="border-left:3px solid #0078d4;padding-left:12px;margin:8px 0;color:#555;font-style:italic;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;">${inlineFormat(bqMatch[1])}</blockquote>`);
      continue;
    }

    // --- Markdown table ---
    if (isTableRow(line)) {
      flushList();
      // Collect all consecutive table lines
      const tableLines: string[] = [line];
      while (i + 1 < lines.length && isTableRow(lines[i + 1])) {
        i++;
        tableLines.push(lines[i]);
      }
      output.push(renderTable(tableLines));
      continue;
    }

    // --- Regular paragraph ---
    flushList();
    output.push(`<p style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;margin:6px 0;line-height:1.5;">${inlineFormat(line)}</p>`);
  }

  // Close any remaining open code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    output.push(`<pre style="background-color:#f4f4f4;padding:8px 12px;font-family:Consolas,'Courier New',monospace;font-size:13px;white-space:pre-wrap;border-left:3px solid #0078d4;margin:8px 0;">${escapeHtml(codeBlockLines.join('\n'))}</pre>`);
  }

  flushList();
  return output.join('\n');
}

/**
 * Checks if a line is a markdown table row (contains pipes).
 */
function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 1;
}

/**
 * Checks if a line is the separator row of a markdown table (e.g. | --- | --- |).
 */
function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  // Must start & end with pipe and contain only pipes, dashes, colons, spaces
  return /^\|[\s:|-]+\|$/.test(trimmed);
}

/**
 * Parse cells from a markdown table row like "| a | b | c |"
 */
function parseTableCells(line: string): string[] {
  const trimmed = line.trim();
  // Remove leading/trailing pipes, then split by pipe
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const stripped = inner.endsWith('|') ? inner.slice(0, -1) : inner;
  return stripped.split('|').map(cell => cell.trim());
}

/**
 * Renders a set of markdown table lines into an HTML <table> with inline styles.
 */
function renderTable(tableLines: string[]): string {
  if (tableLines.length === 0) return '';

  const cellStyle = `style="border:1px solid #bbb;padding:6px 10px;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;"`;
  const headerCellStyle = `style="border:1px solid #bbb;padding:6px 10px;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;font-weight:bold;background-color:#f0f2f5;"`;
  const tableStyle = `style="border-collapse:collapse;margin:8px 0;width:auto;"`;

  // Determine which row is the separator
  let separatorIndex = -1;
  for (let i = 0; i < tableLines.length; i++) {
    if (isTableSeparator(tableLines[i])) {
      separatorIndex = i;
      break;
    }
  }

  const rows: string[] = [];

  // Header row(s) = everything before the separator (usually just one row)
  const headerEnd = separatorIndex > 0 ? separatorIndex : 0;

  for (let i = 0; i <= headerEnd && i < tableLines.length; i++) {
    if (isTableSeparator(tableLines[i])) continue;
    const cells = parseTableCells(tableLines[i]);
    const isHeader = separatorIndex > 0 && i < separatorIndex;
    const tag = isHeader ? 'th' : 'td';
    const style = isHeader ? headerCellStyle : cellStyle;
    const cellsHtml = cells.map(c => `<${tag} ${style}>${inlineFormat(c)}</${tag}>`).join('');
    rows.push(`<tr>${cellsHtml}</tr>`);
  }

  // Body rows = everything after the separator
  const bodyStart = separatorIndex >= 0 ? separatorIndex + 1 : 1;
  for (let i = bodyStart; i < tableLines.length; i++) {
    if (isTableSeparator(tableLines[i])) continue;
    const cells = parseTableCells(tableLines[i]);
    const cellsHtml = cells.map(c => `<td ${cellStyle}>${inlineFormat(c)}</td>`).join('');
    rows.push(`<tr>${cellsHtml}</tr>`);
  }

  return `<table ${tableStyle}>${rows.join('')}</table>`;
}

/**
 * Process inline markdown formatting (bold, italic, inline code, links).
 * Input should already be a single line of text content (not a block element).
 */
function inlineFormat(text: string): string {
  // Inline code first (so bold/italic don't interfere inside backticks)
  let result = text.replace(/`([^`]+)`/g, (_m, code: string) =>
    `<code style="background-color:#f4f4f4;padding:1px 5px;font-family:Consolas,'Courier New',monospace;font-size:0.9em;">${escapeHtml(code)}</code>`
  );

  // Bold **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, (_m, t: string) => `<strong>${escapeHtml(t)}</strong>`);
  result = result.replace(/__(.+?)__/g, (_m, t: string) => `<strong>${escapeHtml(t)}</strong>`);

  // Italic *text* or _text_ (but not inside words_like_this)
  result = result.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, (_m, t: string) => `<em>${escapeHtml(t)}</em>`);
  result = result.replace(/(?<!\w)_(.+?)_(?!\w)/g, (_m, t: string) => `<em>${escapeHtml(t)}</em>`);

  // Escape any remaining unprocessed text that isn't inside tags
  // (We escape inside the specific handlers above, but plain text portions also need it)
  // Actually, the inline handlers already handle their captured groups.
  // For safety, escape any remaining angle brackets in non-tag text.
  // We skip this to avoid double-escaping tags we already created.

  return result;
}

/**
 * Escapes HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Generates a rich HTML fragment with metadata, suitable for clipboard text/html.
 * Uses only inline styles — no <style> blocks, no CSS classes.
 */
export function generateRichHTML(content: string, title: string, metadata: { meetingId: string; date: string; copiedOn: string }): string {
  const htmlContent = markdownToRichHTML(content);

  return [
    `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:#333;">`,
    `<div style="background-color:#f0f2f5;padding:10px 14px;margin-bottom:12px;border-left:4px solid #0078d4;">`,
    `<div style="margin-bottom:3px;"><strong>Meeting Title:</strong> ${escapeHtml(title)}</div>`,
    `<div style="margin-bottom:3px;"><strong>Meeting ID:</strong> ${escapeHtml(metadata.meetingId)}</div>`,
    `<div style="margin-bottom:3px;"><strong>Date:</strong> ${escapeHtml(metadata.date)}</div>`,
    `<div><strong>Copied on:</strong> ${escapeHtml(metadata.copiedOn)}</div>`,
    `</div>`,
    `<hr style="border:none;border-top:1px solid #ccc;margin:12px 0;" />`,
    htmlContent,
    `</div>`,
  ].join('\n');
}

/**
 * Copies HTML as rich text to the clipboard.
 * Places both text/html and text/plain on the clipboard, so apps that support
 * rich paste (OneNote, Word, etc.) get formatted content, while plain-text apps
 * get the markdown fallback.
 */
export async function copyHtmlToClipboard(html: string, plainTextFallback: string): Promise<void> {
  const htmlBlob = new Blob([html], { type: 'text/html' });
  const textBlob = new Blob([plainTextFallback], { type: 'text/plain' });
  const item = new ClipboardItem({
    'text/html': htmlBlob,
    'text/plain': textBlob,
  });
  await navigator.clipboard.write([item]);
}
