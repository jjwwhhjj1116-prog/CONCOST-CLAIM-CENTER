export interface FinalReportDocument {
  caseNumber: string;
  caseTitle: string;
  reportTitle: string;
  reportVersion: number;
  content: string;
  contentSha256: string;
  approvedBy: string;
  approvedAt: string;
  finalizedBy: string;
  finalizedAt: string;
}

const encoder = new TextEncoder();

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array { return new Uint8Array([value & 255, (value >>> 8) & 255]); }
function u32(value: number): Uint8Array { return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]); }

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

function zipStore(files: Array<{ name: string; content: string }>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const header = concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name]);
    local.push(header, data);
    central.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += header.length + data.length;
  }
  const directory = concat(central);
  return concat([...local, directory, concat([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(directory.length), u32(offset), u16(0)])]);
}

export function generateFinalDocx(document: FinalReportDocument): Uint8Array {
  const lines = [`${document.caseNumber} · ${document.caseTitle}`, document.reportTitle, `확정 버전 v${document.reportVersion}`, '', ...document.content.split(/\r?\n/u), '', `본문 SHA-256: ${document.contentSha256}`, `승인: ${document.approvedBy} · ${document.approvedAt}`, `최종 확정: ${document.finalizedBy} · ${document.finalizedAt}`];
  const paragraphs = lines.map((line, index) => `<w:p><w:pPr>${index < 3 ? '<w:spacing w:after="160"/>' : ''}</w:pPr><w:r><w:rPr>${index === 1 ? '<w:b/><w:sz w:val="32"/>' : '<w:sz w:val="21"/>'}</w:rPr><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`).join('');
  return zipStore([
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'docProps/core.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(document.reportTitle)}</dc:title><dc:creator>${xml(document.finalizedBy)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${xml(document.finalizedAt)}</dcterms:created></cp:coreProperties>` },
    { name: 'word/document.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>` }
  ]);
}

function utf16Hex(value: string): string {
  let result = 'FEFF';
  for (let index = 0; index < value.length; index += 1) result += value.charCodeAt(index).toString(16).padStart(4, '0').toUpperCase();
  return result;
}

export function generateFinalPdf(document: FinalReportDocument): Uint8Array {
  const rawLines = [`${document.caseNumber} · ${document.caseTitle}`, document.reportTitle, `확정 버전 v${document.reportVersion}`, '', ...document.content.split(/\r?\n/u), '', `본문 SHA-256 ${document.contentSha256}`, `승인 ${document.approvedBy} · ${document.approvedAt}`, `최종 확정 ${document.finalizedBy} · ${document.finalizedAt}`];
  const lines = rawLines.flatMap((line) => line.length ? Array.from({ length: Math.ceil(line.length / 42) }, (_, index) => line.slice(index * 42, (index + 1) * 42)) : ['']);
  const pages = Array.from({ length: Math.max(1, Math.ceil(lines.length / 42)) }, (_, index) => lines.slice(index * 42, (index + 1) * 42));
  const objects = new Map<number, string>();
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objects.set(3, '<< /Type /Font /Subtype /Type0 /BaseFont /HYSMyeongJo-Medium /Encoding /UniKS-UCS2-H /DescendantFonts [4 0 R] >>');
  objects.set(4, '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYSMyeongJo-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> >>');
  pages.forEach((pageLines, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const commands = ['BT', '/F1 11 Tf', '50 790 Td', '15 TL', ...pageLines.flatMap((line, lineIndex) => [`<${utf16Hex(line)}> Tj`, lineIndex === pageLines.length - 1 ? '' : 'T*']).filter(Boolean), 'ET'].join('\n');
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.set(contentId, `<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}\nendstream`);
  });
  let output = '%PDF-1.7\n%CLAIM-CENTER\n';
  const offsets: number[] = [0];
  for (let id = 1; id <= objects.size; id += 1) { offsets[id] = output.length; output += `${id} 0 obj\n${objects.get(id)}\nendobj\n`; }
  const xref = output.length;
  output += `xref\n0 ${objects.size + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objects.size; id += 1) output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.size + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return encoder.encode(output);
}
