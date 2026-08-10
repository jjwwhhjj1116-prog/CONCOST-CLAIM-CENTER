import * as zlib from 'node:zlib';

export interface DocxRenderOptions {
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

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipArchive(files: { name: string; content: Buffer }[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralDirs: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const content = file.content;
    const checksum = crc32(content);

    // Local file header (30 + nameLen)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Signature
    localHeader.writeUInt16LE(20, 4);        // Version needed
    localHeader.writeUInt16LE(0, 6);         // General flag
    localHeader.writeUInt16LE(0, 8);         // Compression method (0 = store)
    localHeader.writeUInt16LE(0, 10);        // Mod time
    localHeader.writeUInt16LE(0, 12);        // Mod date
    localHeader.writeUInt32LE(checksum, 14); // CRC32
    localHeader.writeUInt32LE(content.length, 18); // Compressed size
    localHeader.writeUInt32LE(content.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, content);

    // Central directory header (46 + nameLen)
    const centralDir = Buffer.alloc(46 + nameBuf.length);
    centralDir.writeUInt32LE(0x02014b50, 0); // Signature
    centralDir.writeUInt16LE(20, 4);         // Version made by
    centralDir.writeUInt16LE(20, 6);         // Version needed
    centralDir.writeUInt16LE(0, 8);          // General flag
    centralDir.writeUInt16LE(0, 10);         // Compression method
    centralDir.writeUInt16LE(0, 12);         // Mod time
    centralDir.writeUInt16LE(0, 14);         // Mod date
    centralDir.writeUInt32LE(checksum, 16);  // CRC32
    centralDir.writeUInt32LE(content.length, 20); // Compressed size
    centralDir.writeUInt32LE(content.length, 24); // Uncompressed size
    centralDir.writeUInt16LE(nameBuf.length, 28);
    centralDir.writeUInt16LE(0, 30);         // Extra len
    centralDir.writeUInt16LE(0, 32);         // Comment len
    centralDir.writeUInt16LE(0, 34);         // Disk start
    centralDir.writeUInt16LE(0, 36);         // Internal attr
    centralDir.writeUInt32LE(0, 38);         // External attr
    centralDir.writeUInt32LE(offset, 42);     // Offset of local header
    nameBuf.copy(centralDir, 46);

    centralDirs.push(centralDir);
    offset += localHeader.length + content.length;
  }

  const centralDirStart = offset;
  let centralDirSize = 0;
  for (const cd of centralDirs) centralDirSize += cd.length;

  // End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // Signature
  eocd.writeUInt16LE(0, 4);          // Disk number
  eocd.writeUInt16LE(0, 6);          // Start disk
  eocd.writeUInt16LE(files.length, 8); // Entries on disk
  eocd.writeUInt16LE(files.length, 10); // Total entries
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralDirs, eocd]);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateDocxBuffer(options: DocxRenderOptions): Buffer {
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const paragraphs = options.bodyText.split('\n').map((line) => {
    return `<w:p><w:r><w:t>${escapeXml(line)}</w:t></w:r></w:p>`;
  }).join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(options.title)}</w:t></w:r></w:p>
    <w:p><w:r><w:t>사건번호: ${escapeXml(options.caseNumber)} | 유형: ${escapeXml(options.claimType)}</w:t></w:r></w:p>
    <w:p><w:r><w:t>제안서 버전: v${String(options.versionNumber).padStart(2, '0')} | 승인자: ${escapeXml(options.approvedBy)} | 승인일: ${escapeXml(options.approvedAt)}</w:t></w:r></w:p>
    ${paragraphs}
    <w:p><w:r><w:rPr><w:i/></w:rPr><w:t>SHA-256: ${escapeXml(options.sha256)}</w:t></w:r></w:p>
  </w:body>
</w:document>`;

  const corePropsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
  <dc:title>${escapeXml(options.title)}</dc:title>
  <dc:subject>PROPOSAL_APPROVED_DOCUMENT</dc:subject>
  <dc:creator>${escapeXml(options.approvedBy)}</dc:creator>
  <cp:lastModifiedBy>${escapeXml(options.approvedBy)}</cp:lastModifiedBy>
  <cp:revision>${options.versionNumber}</cp:revision>
  <dcterms:created>${options.approvedAt}</dcterms:created>
  <cp:keywords>ProposalId:${escapeXml(options.proposalId)};VersionId:${escapeXml(options.versionId)};SHA256:${escapeXml(options.sha256)}</cp:keywords>
</cp:coreProperties>`;

  return createZipArchive([
    { name: '[Content_Types].xml', content: Buffer.from(contentTypesXml, 'utf8') },
    { name: '_rels/.rels', content: Buffer.from(rootRelsXml, 'utf8') },
    { name: 'word/document.xml', content: Buffer.from(documentXml, 'utf8') },
    { name: 'docProps/core.xml', content: Buffer.from(corePropsXml, 'utf8') }
  ]);
}

export function validateDocxBuffer(buffer: Buffer): { isValid: boolean; documentXmlText?: string; corePropsText?: string; metadata?: Record<string, string> } {
  const entries = new Map<string, Buffer>();
  try {
    let offset = 0;
    while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
      if (offset + 30 > buffer.length) return { isValid: false };
      const flags = buffer.readUInt16LE(offset + 6);
      const method = buffer.readUInt16LE(offset + 8);
      const expectedCrc = buffer.readUInt32LE(offset + 14);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const uncompressedSize = buffer.readUInt32LE(offset + 22);
      const nameLength = buffer.readUInt16LE(offset + 26);
      const extraLength = buffer.readUInt16LE(offset + 28);
      if ((flags & 0x08) !== 0 || ![0, 8].includes(method)) return { isValid: false };
      const nameStart = offset + 30;
      const dataStart = nameStart + nameLength + extraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > buffer.length) return { isValid: false };
      const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
      if (!name || name.includes('..') || name.startsWith('/') || entries.has(name)) return { isValid: false };
      const compressed = buffer.subarray(dataStart, dataEnd);
      const content = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed);
      if (content.length !== uncompressedSize || crc32(content) !== expectedCrc) return { isValid: false };
      entries.set(name, content);
      offset = dataEnd;
    }
    if (offset === 0 || buffer.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]), offset) < 0) return { isValid: false };
  } catch {
    return { isValid: false };
  }

  const contentTypes = entries.get('[Content_Types].xml')?.toString('utf8');
  const documentXml = entries.get('word/document.xml')?.toString('utf8');
  const coreProps = entries.get('docProps/core.xml')?.toString('utf8');
  const relationships = entries.get('_rels/.rels')?.toString('utf8');
  if (!contentTypes || !documentXml || !coreProps || !relationships) return { isValid: false };
  if (!contentTypes.includes('/word/document.xml') || !relationships.includes('word/document.xml')) return { isValid: false };
  if (!/^<\?xml[\s\S]*<w:document\b[\s\S]*<w:body>[\s\S]*<\/w:body>[\s\S]*<\/w:document>\s*$/.test(documentXml)) return { isValid: false };
  if (!/<cp:coreProperties\b[\s\S]*<\/cp:coreProperties>\s*$/.test(coreProps)) return { isValid: false };

  const metadata: Record<string, string> = {};
  const keywords = coreProps.match(/<cp:keywords>([\s\S]*?)<\/cp:keywords>/)?.[1];
  if (keywords) {
    for (const pair of keywords.split(';')) {
      const separator = pair.indexOf(':');
      if (separator > 0) metadata[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
    }
  }

  return {
    isValid: true,
    documentXmlText: documentXml,
    corePropsText: coreProps,
    metadata
  };
}

// ----------------------------------------------------
// P12 Report Finalization DOCX Engine
// ----------------------------------------------------

export interface ReportFinalizationSectionInput {
  sectionId: string;
  sectionNumber: number;
  title: string;
  content: string;
  approvedRevisionId: string;
  approvedRevisionHash: string;
  approvedByUserId: string;
  approvedAt: string;
}

export interface ReportDocxRenderOptions {
  finalizationId: string;
  canonicalSnapshotHash: string;
  title: string;
  caseNumber: string;
  claimType: string;
  companyForm?: string;
  templateCode?: string;
  templateName?: string;
  templateVersion?: number;
  finalizedBy: string;
  finalizedAt: string;
  sections: ReportFinalizationSectionInput[];
}

function dateToDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, Math.min(2099, date.getUTCFullYear()));
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  return { dosTime, dosDate };
}

function createReportZipArchive(files: { name: string; content: Buffer }[], fixedDate: Date): Buffer {
  const { dosTime, dosDate } = dateToDosDateTime(fixedDate);
  const localHeaders: Buffer[] = [];
  const centralDirs: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const content = file.content;
    const checksum = crc32(content);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8); // Store
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, content);

    const centralDir = Buffer.alloc(46 + nameBuf.length);
    centralDir.writeUInt32LE(0x02014b50, 0);
    centralDir.writeUInt16LE(20, 4);
    centralDir.writeUInt16LE(20, 6);
    centralDir.writeUInt16LE(0, 8);
    centralDir.writeUInt16LE(0, 10);
    centralDir.writeUInt16LE(dosTime, 12);
    centralDir.writeUInt16LE(dosDate, 14);
    centralDir.writeUInt32LE(checksum, 16);
    centralDir.writeUInt32LE(content.length, 20);
    centralDir.writeUInt32LE(content.length, 24);
    centralDir.writeUInt16LE(nameBuf.length, 28);
    centralDir.writeUInt16LE(0, 30);
    centralDir.writeUInt16LE(0, 32);
    centralDir.writeUInt16LE(0, 34);
    centralDir.writeUInt16LE(0, 36);
    centralDir.writeUInt32LE(0, 38);
    centralDir.writeUInt32LE(offset, 42);
    nameBuf.copy(centralDir, 46);

    centralDirs.push(centralDir);
    offset += localHeader.length + content.length;
  }

  const centralDirStart = offset;
  let centralDirSize = 0;
  for (const cd of centralDirs) centralDirSize += cd.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralDirs, eocd]);
}

export function generateReportDocxBuffer(options: ReportDocxRenderOptions): Buffer {
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const documentRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>`;

  const header1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>${escapeXml(options.title)} | ${escapeXml(options.caseNumber)}</w:t></w:r></w:p>
</w:hdr>`;

  const footer1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldSimple w:instr="PAGE"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t> / </w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldSimple w:instr="NUMPAGES"/></w:r></w:p>
</w:ftr>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
</w:styles>`;

  const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:defaultTabStop w:val="720"/>
</w:settings>`;

  // Cover & TOC
  let bodyXml = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>${escapeXml(options.title)}</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>사건번호: ${escapeXml(options.caseNumber)} | 유형: ${escapeXml(options.claimType)}</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>최종확정자: ${escapeXml(options.finalizedBy)} | 확정일: ${escapeXml(options.finalizedAt)}</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;

  // Table of Contents Header
  bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>목 차 (Table of Contents)</w:t></w:r></w:p>`;
  for (const sec of options.sections) {
    bodyXml += `<w:p><w:r><w:t>제 ${sec.sectionNumber} 장. ${escapeXml(sec.title)}</w:t></w:r></w:p>`;
  }
  bodyXml += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;

  // Sections
  for (const sec of options.sections) {
    bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>제 ${sec.sectionNumber} 장. ${escapeXml(sec.title)}</w:t></w:r></w:p>`;
    bodyXml += `<w:p><w:r><w:rPr><w:i/><w:sz w:val="18"/></w:rPr><w:t>[승인 revision: ${escapeXml(sec.approvedRevisionId)} | Hash: ${escapeXml(sec.approvedRevisionHash.slice(0, 8))}... | 승인자: ${escapeXml(sec.approvedByUserId)}]</w:t></w:r></w:p>`;
    
    const paragraphs = sec.content.split('\n');
    for (const line of paragraphs) {
      bodyXml += `<w:p><w:r><w:t>${escapeXml(line)}</w:t></w:r></w:p>`;
    }
    bodyXml += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  }

  bodyXml += `<w:p><w:r><w:rPr><w:i/><w:sz w:val="16"/></w:rPr><w:t>Canonical Snapshot Hash: ${escapeXml(options.canonicalSnapshotHash)}</w:t></w:r></w:p>`;
  bodyXml += `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/><w:footerReference w:type="default" r:id="rIdFooter1"/></w:sectPr>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${bodyXml}
  </w:body>
</w:document>`;

  const corePropsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
  <dc:title>${escapeXml(options.title)}</dc:title>
  <dc:subject>REPORT_FINALIZED_DOCUMENT</dc:subject>
  <dc:creator>${escapeXml(options.finalizedBy)}</dc:creator>
  <cp:lastModifiedBy>${escapeXml(options.finalizedBy)}</cp:lastModifiedBy>
  <cp:revision>1</cp:revision>
  <dcterms:created>${options.finalizedAt}</dcterms:created>
  <cp:keywords>FinalizationId:${escapeXml(options.finalizationId)};SnapshotHash:${escapeXml(options.canonicalSnapshotHash)}</cp:keywords>
</cp:coreProperties>`;

  const fixedDate = new Date(options.finalizedAt || '2026-01-01T00:00:00.000Z');

  return createReportZipArchive([
    { name: '[Content_Types].xml', content: Buffer.from(contentTypesXml, 'utf8') },
    { name: '_rels/.rels', content: Buffer.from(rootRelsXml, 'utf8') },
    { name: 'word/_rels/document.xml.rels', content: Buffer.from(documentRelsXml, 'utf8') },
    { name: 'word/document.xml', content: Buffer.from(documentXml, 'utf8') },
    { name: 'word/header1.xml', content: Buffer.from(header1Xml, 'utf8') },
    { name: 'word/footer1.xml', content: Buffer.from(footer1Xml, 'utf8') },
    { name: 'word/styles.xml', content: Buffer.from(stylesXml, 'utf8') },
    { name: 'word/settings.xml', content: Buffer.from(settingsXml, 'utf8') },
    { name: 'docProps/core.xml', content: Buffer.from(corePropsXml, 'utf8') }
  ], fixedDate);
}

export interface DocxValidationResult {
  isValid: boolean;
  error?: string;
  entryCount?: number;
  documentXmlText?: string;
  corePropsText?: string;
  sectionCount?: number;
  sectionsFound?: string[];
  canonicalSnapshotHash?: string;
  metadata?: Record<string, string>;
}

export function validateReportDocxBuffer(buffer: Buffer): DocxValidationResult {
  const entries = new Map<string, Buffer>();
  try {
    let offset = 0;
    while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
      if (offset + 30 > buffer.length) return { isValid: false };
      const flags = buffer.readUInt16LE(offset + 6);
      const method = buffer.readUInt16LE(offset + 8);
      const expectedCrc = buffer.readUInt32LE(offset + 14);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const uncompressedSize = buffer.readUInt32LE(offset + 22);
      const nameLength = buffer.readUInt16LE(offset + 26);
      const extraLength = buffer.readUInt16LE(offset + 28);
      if ((flags & 0x08) !== 0 || ![0, 8].includes(method)) return { isValid: false };
      const nameStart = offset + 30;
      const dataStart = nameStart + nameLength + extraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > buffer.length) return { isValid: false };
      const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
      if (!name || name.includes('..') || name.startsWith('/') || entries.has(name)) return { isValid: false };
      const compressed = buffer.subarray(dataStart, dataEnd);
      const content = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed);
      if (content.length !== uncompressedSize || crc32(content) !== expectedCrc) return { isValid: false };
      entries.set(name, content);
      offset = dataEnd;
    }
    if (offset === 0 || buffer.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]), offset) < 0) return { isValid: false };
  } catch {
    return { isValid: false };
  }

  const contentTypes = entries.get('[Content_Types].xml')?.toString('utf8');
  const documentXml = entries.get('word/document.xml')?.toString('utf8');
  const docRels = entries.get('word/_rels/document.xml.rels')?.toString('utf8');
  const header1 = entries.get('word/header1.xml')?.toString('utf8');
  const footer1 = entries.get('word/footer1.xml')?.toString('utf8');
  const coreProps = entries.get('docProps/core.xml')?.toString('utf8');

  if (!contentTypes || !documentXml || !docRels || !header1 || !footer1 || !coreProps) {
    return { isValid: false };
  }

  if (!contentTypes.includes('/word/header1.xml') || !contentTypes.includes('/word/footer1.xml')) return { isValid: false };
  if (!docRels.includes('header1.xml') || !docRels.includes('footer1.xml')) return { isValid: false };
  if (!footer1.includes('PAGE') || !footer1.includes('NUMPAGES')) return { isValid: false };
  if (!documentXml.includes('w:headerReference') || !documentXml.includes('w:footerReference')) return { isValid: false };

  const sectionsFound: string[] = [];
  const sectionMatches = documentXml.matchAll(/제 (\d+) 장\.\s*([\s\S]*?)<\/w:t>/g);
  for (const m of sectionMatches) {
    sectionsFound.push(`Section ${m[1]}: ${m[2]}`);
  }

  const snapshotHashMatch = documentXml.match(/Canonical Snapshot Hash:\s*([0-9a-fA-F]{64})/);
  const canonicalSnapshotHash = snapshotHashMatch?.[1];

  const metadata: Record<string, string> = {};
  const keywords = coreProps.match(/<cp:keywords>([\s\S]*?)<\/cp:keywords>/)?.[1];
  if (keywords) {
    for (const pair of keywords.split(';')) {
      const separator = pair.indexOf(':');
      if (separator > 0) metadata[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
    }
  }

  return {
    isValid: true,
    entryCount: entries.size,
    documentXmlText: documentXml,
    corePropsText: coreProps,
    sectionCount: sectionsFound.length / 2, // Matches appear in TOC and in Section Heading
    sectionsFound,
    canonicalSnapshotHash,
    metadata
  };
}

