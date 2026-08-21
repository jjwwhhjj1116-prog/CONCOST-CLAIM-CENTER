export interface ProposalExcelValues {
  background: string;
  objective: string;
  method: string;
  expectedOutcome: string;
  exclusions: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const fields: Array<{ code: keyof ProposalExcelValues; label: string; guide: string }> = [
  { code: 'background', label: '의뢰 배경', guide: '클라이언트가 제안서를 요청한 배경과 현재 상황' },
  { code: 'objective', label: '수행 목적', guide: '당사가 제안하는 과업의 목적' },
  { code: 'method', label: '수행 방법 및 범위', guide: '조사·검토·산출 방법과 포함 범위' },
  { code: 'expectedOutcome', label: '예상 성과물', guide: '클라이언트에게 제공할 결과물과 제출 형태' },
  { code: 'exclusions', label: '제외 사항', guide: '제안 범위에 포함하지 않는 업무' }
];

const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const u16 = (value: number) => new Uint8Array([value & 255, (value >>> 8) & 255]);
const u32 = (value: number) => new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
const concat = (parts: Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return output;
};
const crc32 = (bytes: Uint8Array) => {
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

const cell = (reference: string, value: string, style = '') => `<c r="${reference}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;

export function proposalWorkbook(values: ProposalExcelValues, projectLabel: string, templateName: string): Uint8Array {
  const dataRows = fields.map((field, index) => {
    const row = index + 4;
    return `<row r="${row}" ht="42" customHeight="1">${cell(`A${row}`, field.code, '2')}${cell(`B${row}`, field.label, '2')}${cell(`C${row}`, values[field.code], '3')}${cell(`D${row}`, field.guide, '4')}</row>`;
  }).join('');
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="22" customWidth="1" hidden="1"/><col min="2" max="2" width="24" customWidth="1"/><col min="3" max="3" width="80" customWidth="1"/><col min="4" max="4" width="48" customWidth="1"/></cols><sheetData><row r="1" ht="30" customHeight="1">${cell('A1', '클레임센터 스튜디오 · 클라이언트 제안서 작성 양식', '1')}</row><row r="2">${cell('A2', `프로젝트: ${projectLabel} · 템플릿: ${templateName}`, '4')}</row><row r="3">${cell('A3', 'FIELD_CODE', '2')}${cell('B3', '작성 항목', '2')}${cell('C3', '클라이언트별 수정 내용', '2')}${cell('D3', '작성 안내', '2')}</row>${dataRows}</sheetData><mergeCells count="2"><mergeCell ref="A1:D1"/><mergeCell ref="A2:D2"/></mergeCells></worksheet>`;
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="16"/><color rgb="FF17326D"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3155B8"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF1FF"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom></border></borders><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>';
  return zipStore([
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="제안서 작성" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', content: styles },
    { name: 'xl/worksheets/sheet1.xml', content: worksheet }
  ]);
}

const read16 = (view: DataView, offset: number) => view.getUint16(offset, true);
const read32 = (view: DataView, offset: number) => view.getUint32(offset, true);

async function zipEntry(bytes: Uint8Array, wantedName: string): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && read32(view, eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error('올바른 XLSX 파일이 아닙니다. 내보낸 양식을 사용하세요.');
  const entries = read16(view, eocd + 10);
  let cursor = read32(view, eocd + 16);
  for (let index = 0; index < entries; index += 1) {
    if (read32(view, cursor) !== 0x02014b50) break;
    const method = read16(view, cursor + 10);
    const compressedSize = read32(view, cursor + 20);
    const nameLength = read16(view, cursor + 28);
    const extraLength = read16(view, cursor + 30);
    const commentLength = read16(view, cursor + 32);
    const localOffset = read32(view, cursor + 42);
    const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    if (name === wantedName) {
      const localNameLength = read16(view, localOffset + 26);
      const localExtraLength = read16(view, localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(start, start + compressedSize);
      if (method === 0) return decoder.decode(compressed);
      if (method === 8 && typeof DecompressionStream !== 'undefined') {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return decoder.decode(new Uint8Array(await new Response(stream).arrayBuffer()));
      }
      throw new Error('이 XLSX 압축 방식은 현재 브라우저에서 읽을 수 없습니다. Chrome 최신 버전을 사용하세요.');
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('제안서 작성 시트를 찾지 못했습니다. 내보낸 양식을 사용하세요.');
}

export async function readProposalWorkbook(file: File): Promise<ProposalExcelValues> {
  if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 5_000_000) throw new Error('5MB 이하의 XLSX 제안서 양식만 가져올 수 있습니다.');
  const sheetXml = await zipEntry(new Uint8Array(await file.arrayBuffer()), 'xl/worksheets/sheet1.xml');
  const result = {} as ProposalExcelValues;
  const unescapeXml = (value: string) => value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)) {
    const cellValues = new Map<string, string>();
    for (const cellMatch of rowMatch[1].matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*>([\s\S]*?)<\/c>/gu)) {
      const textMatch = cellMatch[2].match(/<t\b[^>]*>([\s\S]*?)<\/t>/u) ?? cellMatch[2].match(/<v>([\s\S]*?)<\/v>/u);
      cellValues.set(cellMatch[1], unescapeXml(textMatch?.[1] ?? ''));
    }
    const valueAt = (column: string) => cellValues.get(column) ?? '';
    const code = valueAt('A') as keyof ProposalExcelValues;
    if (fields.some((field) => field.code === code)) result[code] = valueAt('C').trim();
  }
  if (!fields.every((field) => typeof result[field.code] === 'string')) throw new Error('필수 제안서 항목이 없습니다. 내보낸 양식의 FIELD_CODE 열을 변경하지 마세요.');
  return result;
}
