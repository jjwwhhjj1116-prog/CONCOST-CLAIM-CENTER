export type NormalizedDocumentBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'list'; text: string }
  | { kind: 'asset'; key: string }
  | { kind: 'table'; header: string[]; rows: string[][] };

const decodeHtmlEntities = (value: string): string => value
  .replace(/&#x([0-9a-f]+);/giu, (_match, hexadecimal: string) => String.fromCodePoint(Number.parseInt(hexadecimal, 16)))
  .replace(/&#([0-9]+);/gu, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
  .replace(/&nbsp;/giu, ' ')
  .replace(/&amp;/giu, '&')
  .replace(/&lt;/giu, '<')
  .replace(/&gt;/giu, '>')
  .replace(/&quot;/giu, '"')
  .replace(/&(?:apos|#39);/giu, "'");

const stripInlineMarkup = (value: string): string => decodeHtmlEntities(value)
  .replace(/<br\s*\/?\s*>/giu, ' ')
  .replace(/<\/(?:p|div|li|h[1-6])\s*>/giu, ' ')
  .replace(/<[^>]+>/gu, '')
  .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
  .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
  .replace(/(?:\*\*|__)(.*?)(?:\*\*|__)/gu, '$1')
  .replace(/(?:\*|_)(.*?)(?:\*|_)/gu, '$1')
  .replace(/`([^`]+)`/gu, '$1')
  .replace(/\s+/gu, ' ')
  .trim();

function htmlTable(source: string): { header: string[]; rows: string[][] } {
  const parsedRows = Array.from(source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/giu), (match) => {
    const cells = Array.from(match[1].matchAll(/<t([hd])\b[^>]*>([\s\S]*?)<\/t[hd]\s*>/giu), (cell) => ({
      heading: cell[1].toLowerCase() === 'h',
      text: stripInlineMarkup(cell[2])
    }));
    return cells;
  }).filter((row) => row.length > 0);
  if (parsedRows.length === 0) return { header: [], rows: [] };
  const firstIsHeader = parsedRows[0].some((cell) => cell.heading);
  return {
    header: firstIsHeader ? parsedRows[0].map((cell) => cell.text) : [],
    rows: parsedRows.slice(firstIsHeader ? 1 : 0).map((row) => row.map((cell) => cell.text))
  };
}

const markdownCells = (line: string): string[] => line.trim()
  .replace(/^\|/u, '')
  .replace(/\|$/u, '')
  .split('|')
  .map(stripInlineMarkup);

/**
 * Converts the editor's mixed Markdown/HTML persistence format into a small,
 * runtime-neutral block model. The Worker renderers consume this model so
 * raw table, span and image tags can never be emitted as visible text.
 */
export function normalizeMixedDocumentBlocks(value: string): NormalizedDocumentBlock[] {
  const tables: Array<{ header: string[]; rows: string[][] }> = [];
  const decoded = decodeHtmlEntities(value).replace(/<table\b[^>]*>[\s\S]*?<\/table\s*>/giu, (table) => {
    const index = tables.push(htmlTable(table)) - 1;
    return `\n[DOCUMENT_TABLE:${index}]\n`;
  });
  const normalized = decoded
    .replace(/<!--[\s\S]*?-->/gu, '\n')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, '\n')
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/giu, (_match, level: string, content: string) => `\n${'#'.repeat(Number(level))} ${stripInlineMarkup(content)}\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/giu, (_match, content: string) => `\n- ${stripInlineMarkup(content)}\n`)
    .replace(/<\/(?:p|div|section|article|header|footer|blockquote)\s*>/giu, '\n')
    .replace(/<(?:p|div|section|article|header|footer|blockquote)\b[^>]*>/giu, '\n')
    .replace(/<img\b[^>]*\balt\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/giu, (_match, doubleQuoted: string, singleQuoted: string) => `\n${doubleQuoted ?? singleQuoted ?? ''}\n`)
    .replace(/<[^>]+>/gu, '');
  const lines = normalized.replaceAll('\r\n', '\n').split('\n');
  const blocks: NormalizedDocumentBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const tableMarker = line.match(/^\[DOCUMENT_TABLE:(\d+)\]$/u);
    if (tableMarker) {
      const table = tables[Number(tableMarker[1])];
      if (table && (table.header.length > 0 || table.rows.length > 0)) blocks.push({ kind: 'table', ...table });
      continue;
    }
    const assetMarker = line.match(/^\[PROPOSAL_ASSET:([A-Za-z0-9_-]+)\]$/u);
    if (assetMarker) {
      blocks.push({ kind: 'asset', key: assetMarker[1] });
      continue;
    }
    if (line.includes('|') && lines[index + 1] && /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/u.test(lines[index + 1])) {
      const header = markdownCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(markdownCells(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, text: stripInlineMarkup(heading[2]) });
      continue;
    }
    if (/^(?:[-*+•ㅇ]|\d+[.)])\s+/u.test(line)) {
      blocks.push({ kind: 'list', text: stripInlineMarkup(line.replace(/^(?:[-*+•ㅇ]|\d+[.)])\s+/u, '')) });
      continue;
    }
    const text = stripInlineMarkup(line);
    if (text) blocks.push({ kind: 'paragraph', text });
  }
  return blocks;
}

export function normalizedDocumentTextLines(value: string): string[] {
  return normalizeMixedDocumentBlocks(value).flatMap((block) => {
    if (block.kind === 'asset') return [];
    if (block.kind === 'table') return [
      ...(block.header.length ? [block.header.join(' | ')] : []),
      ...block.rows.map((row) => row.join(' | '))
    ];
    return [block.text];
  });
}
