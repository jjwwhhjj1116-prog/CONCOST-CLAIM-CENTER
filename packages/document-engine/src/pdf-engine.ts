export interface PdfRenderOptions {
  title: string;
  caseNumber: string;
  claimType: string;
  proposalId: string;
  versionId: string;
  versionNumber: number;
  approvedBy: string;
  approvedAt: string;
  sha256: string;
  bodyText: string;
}

function escapePdfString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function utf16BeHex(value: string, includeBom = false): string {
  const littleEndian = Buffer.from(value, 'utf16le');
  const bigEndian = Buffer.alloc(littleEndian.length + (includeBom ? 2 : 0));
  let target = 0;
  if (includeBom) {
    bigEndian[0] = 0xfe;
    bigEndian[1] = 0xff;
    target = 2;
  }
  for (let index = 0; index < littleEndian.length; index += 2) {
    bigEndian[target + index] = littleEndian[index + 1];
    bigEndian[target + index + 1] = littleEndian[index];
  }
  return bigEndian.toString('hex').toUpperCase();
}

function decodeUtf16BeHex(value: string): string {
  const bigEndian = Buffer.from(value, 'hex');
  const offset = bigEndian.length >= 2 && bigEndian[0] === 0xfe && bigEndian[1] === 0xff ? 2 : 0;
  const littleEndian = Buffer.alloc(bigEndian.length - offset);
  for (let index = offset; index < bigEndian.length; index += 2) {
    if (index + 1 >= bigEndian.length) return '';
    littleEndian[index - offset] = bigEndian[index + 1];
    littleEndian[index - offset + 1] = bigEndian[index];
  }
  return littleEndian.toString('utf16le');
}

export function generatePdfBuffer(options: PdfRenderOptions): Buffer {
  const lines = [
    `TITLE: ${options.title}`,
    `CASE: ${options.caseNumber} | TYPE: ${options.claimType}`,
    `VERSION: v${String(options.versionNumber).padStart(2, '0')} | APPROVED_BY: ${options.approvedBy} | DATE: ${options.approvedAt}`,
    `SHA256: ${options.sha256}`,
    '----------------------------------------',
    ...options.bodyText.split('\n')
  ];

  let textStreamContent = 'BT\n/F1 10 Tf\n14 TL\n50 750 Td\n';
  for (const line of lines) textStreamContent += `<${utf16BeHex(line)}> Tj T*\n`;
  textStreamContent += 'ET\n';
  const streamLength = Buffer.byteLength(textStreamContent, 'ascii');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${streamLength} >>\nstream\n${textStreamContent}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /HYSMyeongJo-Medium /Encoding /UniKS-UCS2-H /DescendantFonts [6 0 R] >>\nendobj\n',
    '6 0 obj\n<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYSMyeongJo-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> /DW 1000 >>\nendobj\n',
    `7 0 obj\n<<\n  /Title <${utf16BeHex(options.title, true)}>\n  /Author <${utf16BeHex(options.approvedBy, true)}>\n  /Subject (PROPOSAL_APPROVED_PDF)\n  /Producer (ClaimCenterReportStudio/P07)\n  /CreationDate (${escapePdfString(options.approvedAt)})\n  /ProposalId (${escapePdfString(options.proposalId)})\n  /VersionId (${escapePdfString(options.versionId)})\n  /SHA256 (${escapePdfString(options.sha256)})\n>>\nendobj\n`
  ];

  let pdfString = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdfString, 'ascii'));
    pdfString += object;
  }

  const xrefStart = Buffer.byteLength(pdfString, 'ascii');
  pdfString += 'xref\n0 8\n0000000000 65535 f \n';
  for (const offset of offsets) pdfString += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdfString += `trailer\n<< /Size 8 /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdfString, 'ascii');
}

export function validatePdfBuffer(buffer: Buffer): { isValid: boolean; extractedText?: string; metadata?: Record<string, string> } {
  const value = buffer.toString('ascii');
  if (!value.startsWith('%PDF-1.4\n') || !value.endsWith('%%EOF\n')) return { isValid: false };
  const startXref = Number(value.match(/startxref\n(\d+)\n%%EOF\n$/)?.[1]);
  if (!Number.isInteger(startXref) || startXref <= 0 || buffer.subarray(startXref, startXref + 4).toString('ascii') !== 'xref') return { isValid: false };

  const xref = buffer.subarray(startXref).toString('ascii');
  const rows = xref.match(/^xref\n0 8\n0000000000 65535 f \n([\s\S]*?)trailer\n/)?.[1]?.trimEnd().split('\n');
  if (!rows || rows.length !== 7 || !xref.includes('/Root 1 0 R') || !xref.includes('/Info 7 0 R')) return { isValid: false };
  for (let objectNumber = 1; objectNumber <= 7; objectNumber++) {
    const offset = Number(rows[objectNumber - 1]?.match(/^(\d{10}) 00000 n\s*$/)?.[1]);
    const marker = `${objectNumber} 0 obj`;
    if (!Number.isInteger(offset) || buffer.subarray(offset, offset + marker.length).toString('ascii') !== marker) return { isValid: false };
  }

  if (!value.includes('/Subtype /Type0') || !value.includes('/Encoding /UniKS-UCS2-H') || !value.includes('/Ordering (Korea1)')) return { isValid: false };
  const streamMatch = value.match(/4 0 obj\n<< \/Length (\d+) >>\nstream\n([\s\S]*?)endstream\nendobj/);
  if (!streamMatch || Buffer.byteLength(streamMatch[2], 'ascii') !== Number(streamMatch[1])) return { isValid: false };

  const extractedLines: string[] = [];
  for (const match of streamMatch[2].matchAll(/<([0-9A-F]+)>\s*Tj/g)) {
    const decoded = decodeUtf16BeHex(match[1]);
    if (!decoded) return { isValid: false };
    extractedLines.push(decoded);
  }

  const metadata: Record<string, string> = {};
  const info = value.match(/7 0 obj[\s\S]*?endobj/)?.[0];
  if (info) {
    for (const key of ['Title', 'Author']) {
      const encoded = info.match(new RegExp(`/${key}\\s*<([0-9A-F]+)>`))?.[1];
      if (encoded) metadata[key] = decodeUtf16BeHex(encoded);
    }
    for (const key of ['ProposalId', 'VersionId', 'SHA256']) {
      const literal = info.match(new RegExp(`/${key}\\s*\\(((?:\\\\.|[^\\\\)])*)\\)`))?.[1];
      if (literal) metadata[key] = literal.replace(/\\([\\()])/g, '$1');
    }
  }

  if (!metadata.ProposalId || !metadata.VersionId || !/^[0-9a-f]{64}$/.test(metadata.SHA256 ?? '') || extractedLines.length < 6) {
    return { isValid: false };
  }
  return { isValid: true, extractedText: extractedLines.join('\n'), metadata };
}
