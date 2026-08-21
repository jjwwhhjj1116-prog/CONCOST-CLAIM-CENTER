export interface ProposalExportChapter {
  number: number;
  title: string;
  body: string;
}

export interface ProposalExportDocument {
  proposalId: string;
  versionId: string;
  versionNumber: number;
  projectTitle: string;
  clientName: string;
  subtitle: string;
  submissionDate: string;
  caseNumber: string;
  claimType: string;
  preparedBy: string;
  contentSha256: string;
  chapters: ProposalExportChapter[];
}

const encoder = new TextEncoder();

const xml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const u16 = (value: number): Uint8Array => new Uint8Array([value & 255, (value >>> 8) & 255]);
const u32 = (value: number): Uint8Array => new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);

const concat = (parts: Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};

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

const textRun = (value: string, properties = ''): string => `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(value)}</w:t></w:r>`;

const paragraph = (value: string, style = 'Normal', extraProperties = '', runProperties = ''): string =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extraProperties}</w:pPr>${textRun(value, runProperties)}</w:p>`;

function markdownParagraphs(body: string): string {
  const lines = body.replaceAll('\r\n', '\n').split('\n');
  const output: string[] = [];
  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    if (!line) {
      output.push('<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>');
      continue;
    }
    if (line.startsWith('### ')) {
      output.push(paragraph(line.slice(4), 'Heading3'));
      continue;
    }
    if (line.startsWith('## ')) {
      output.push(paragraph(line.slice(3), 'Heading2'));
      continue;
    }
    if (line.startsWith('# ')) {
      output.push(paragraph(line.slice(2), 'Heading1'));
      continue;
    }
    if (/^(?:[-*•ㅇ]|\d+[.)])\s+/u.test(line)) {
      const value = line.replace(/^(?:[-*•ㅇ]|\d+[.)])\s+/u, '');
      output.push(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${textRun(value)}</w:p>`);
      continue;
    }
    const strong = line.match(/^\*\*(.+)\*\*$/u);
    output.push(paragraph(strong?.[1] ?? line, 'Normal', '<w:jc w:val="both"/>', strong ? '<w:b/>' : ''));
  }
  return output.join('');
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="맑은 고딕"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="140" w:line="320" w:lineRule="auto"/><w:widowControl/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="맑은 고딕"/><w:sz w:val="21"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="2200" w:after="260"/><w:keepNext/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="맑은 고딕"/><w:b/><w:color w:val="17326D"/><w:sz w:val="40"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="180"/></w:pPr><w:rPr><w:color w:val="4A6386"/><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:pageBreakBefore/><w:spacing w:before="240" w:after="180"/><w:outlineLvl w:val="0"/><w:pBdr><w:bottom w:val="single" w:sz="16" w:space="8" w:color="31A6D8"/></w:pBdr></w:pPr><w:rPr><w:b/><w:color w:val="17326D"/><w:sz w:val="31"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="E36B2C"/><w:sz w:val="25"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="100"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="2C6A8A"/><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="80"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="8640"/></w:tabs><w:spacing w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="17326D"/><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="TOCTitle"><w:name w:val="TOC Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:keepNext/><w:spacing w:before="300" w:after="360"/></w:pPr><w:rPr><w:b/><w:color w:val="17326D"/><w:sz w:val="34"/></w:rPr></w:style>
</w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="맑은 고딕"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

export function generateProposalMarkdown(input: ProposalExportDocument): string {
  const heading = `# ${input.projectTitle}\n\n${input.subtitle}\n\n- 클라이언트: ${input.clientName}\n- 제출일: ${input.submissionDate}\n- 제안사: 주식회사 컨코스트 · 클레임센터\n- 프로젝트: ${input.caseNumber} · ${input.claimType}\n\n---\n\n## 목차\n\n${input.chapters.map((chapter) => `${chapter.number}. ${chapter.title}`).join('\n')}\n`;
  const body = input.chapters.map((chapter) => `\n---\n\n## ${chapter.number}. ${chapter.title}\n\n${chapter.body.trim()}\n`).join('');
  return `${heading}${body}\n---\n\n문서 무결성: ${input.contentSha256}\n제안서 ID: ${input.proposalId} · 버전 ID: ${input.versionId}\n`;
}

const proposalPdfHex = (value: string): string => Array.from(value)
  .map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0xffff) return codePoint.toString(16).padStart(4, '0');
    const adjusted = codePoint - 0x10000;
    const high = 0xd800 + (adjusted >> 10);
    const low = 0xdc00 + (adjusted & 0x3ff);
    return `${high.toString(16).padStart(4, '0')}${low.toString(16).padStart(4, '0')}`;
  })
  .join('')
  .toUpperCase();

const proposalPdfLines = (input: ProposalExportDocument): string[] => {
  const raw = [
    'CONCOST CLAIM CENTER · APPROVED PROPOSAL',
    input.projectTitle,
    input.subtitle,
    `클라이언트 ${input.clientName} · 제출일 ${input.submissionDate}`,
    `프로젝트 ${input.caseNumber} · ${input.claimType} · v${input.versionNumber}`,
    '',
    ...generateProposalMarkdown(input).split(/\r?\n/u)
  ];
  return raw.flatMap((line) => line.length > 42
    ? Array.from({ length: Math.ceil(line.length / 42) }, (_, index) => line.slice(index * 42, (index + 1) * 42))
    : [line]);
};

export function generateProposalPdf(input: ProposalExportDocument): Uint8Array {
  const lines = proposalPdfLines(input);
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
    const commands = ['BT', '/F1 10 Tf', '45 794 Td', '16 TL', ...pageLines.flatMap((line, lineIndex) => [`<${proposalPdfHex(line)}> Tj`, lineIndex === pageLines.length - 1 ? '' : 'T*']).filter(Boolean), 'ET'].join('\n');
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.set(contentId, `<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}\nendstream`);
  });
  let output = '%PDF-1.7\n%CONCOST-PROPOSAL\n';
  const offsets: number[] = [0];
  for (let id = 1; id <= objects.size; id += 1) {
    offsets[id] = encoder.encode(output).length;
    output += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }
  const xref = encoder.encode(output).length;
  output += `xref\n0 ${objects.size + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objects.size; id += 1) output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.size + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return encoder.encode(output);
}

export function generateProposalDocx(input: ProposalExportDocument): Uint8Array {
  const cover = [
    paragraph('CONCOST CLAIM CENTER', 'Subtitle', '', '<w:b/><w:color w:val="E36B2C"/>'),
    paragraph(input.projectTitle, 'Title'),
    paragraph(input.subtitle, 'Subtitle'),
    paragraph(input.clientName, 'Subtitle', '<w:spacing w:before="240" w:after="120"/>', '<w:b/>'),
    paragraph(input.submissionDate, 'Subtitle'),
    paragraph('주식회사 컨코스트 · 클레임센터', 'Subtitle', '<w:spacing w:before="1100" w:after="0"/>', '<w:b/><w:color w:val="17326D"/>'),
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
  ].join('');
  const toc = [
    paragraph('목 차', 'TOCTitle'),
    ...input.chapters.map((chapter) => paragraph(`${chapter.number}. ${chapter.title}`, 'TOC1')),
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
  ].join('');
  const chapters = input.chapters.map((chapter) => `${paragraph(`${chapter.number}. ${chapter.title}`, 'Heading1')}${markdownParagraphs(chapter.body)}`).join('');
  const metadata = paragraph(`문서 무결성 SHA-256 ${input.contentSha256} · 제안서 ${input.proposalId} · 버전 ${input.versionNumber}`, 'Normal', '<w:spacing w:before="360"/><w:jc w:val="center"/>', '<w:i/><w:color w:val="64748B"/><w:sz w:val="16"/>');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${cover}${toc}${chapters}${metadata}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567"/><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const documentRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/><w:defaultTabStop w:val="720"/></w:settings>`;
  const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="4" w:color="31A6D8"/></w:pBdr></w:pPr>${textRun(`CONCOST CLAIM CENTER · ${input.caseNumber}`, '<w:b/><w:color w:val="17326D"/><w:sz w:val="16"/>')}</w:p></w:hdr>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/><w:instrText xml:space="preserve"> PAGE </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>${xml(input.projectTitle)}</dc:title><dc:subject>CONCOST PROPOSAL</dc:subject><dc:creator>${xml(input.preparedBy)}</dc:creator><cp:lastModifiedBy>${xml(input.preparedBy)}</cp:lastModifiedBy><cp:revision>${input.versionNumber}</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${new Date().toISOString()}</dcterms:created><cp:keywords>ProposalId:${xml(input.proposalId)};VersionId:${xml(input.versionId)};SHA256:${xml(input.contentSha256)}</cp:keywords></cp:coreProperties>`;
  return zipStore([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRelationships },
    { name: 'word/document.xml', content: documentXml },
    { name: 'word/_rels/document.xml.rels', content: documentRelationships },
    { name: 'word/styles.xml', content: stylesXml },
    { name: 'word/numbering.xml', content: numberingXml },
    { name: 'word/settings.xml', content: settings },
    { name: 'word/header1.xml', content: header },
    { name: 'word/footer1.xml', content: footer },
    { name: 'docProps/core.xml', content: core }
  ]);
}
