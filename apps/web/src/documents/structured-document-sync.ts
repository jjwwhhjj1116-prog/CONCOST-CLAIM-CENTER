import type { JSONContent } from '@tiptap/core';

export const structuredDocumentContentSignature = (
  markdown: string,
  editorJson?: JSONContent | null,
): string => `${editorJson ? `json:${JSON.stringify(editorJson)}` : 'markdown'}\u001f${markdown}`;
