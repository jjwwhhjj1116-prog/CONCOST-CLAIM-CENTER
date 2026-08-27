export interface ProposalExcelValues {
  background: string;
  objective: string;
  method: string;
  expectedOutcome: string;
  exclusions: string;
}

export interface ProposalStudioExcelValues {
  clientName: string;
  projectTitle: string;
  subtitle: string;
  submissionDate: string;
  keyIssues: string;
  objective: string;
  planNotes: string;
  exclusions: string;
}

export interface ProposalDocxChapter {
  number: number;
  title: string;
  body: string;
}

export interface SentProposalExcelRow {
  caseNumber: string;
  caseTitle: string;
  proposalNumber: string;
  proposalTitle: string;
  revisionLabel: string;
  clientName: string;
  sentAt: string;
  responseDueOn: string | null;
  proposedAmountKrw: number | null;
  verificationStatus: string;
  awardStatus: string;
  documentUrl: string | null;
  documentSha256: string | null;
  createdByName: string;
  createdAt: string;
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
const studioFields: Array<{ code: keyof ProposalStudioExcelValues; label: string; guide: string }> = [
  { code:'clientName',label:'클라이언트명',guide:'제안서를 받는 법인·조합·발주처의 정확한 명칭' },
  { code:'projectTitle',label:'프로젝트 제목',guide:'갑지에 표시할 프로젝트 공식 명칭' },
  { code:'subtitle',label:'제안서 부제',guide:'예: 공사비 검증 및 협상 지원 용역' },
  { code:'submissionDate',label:'제출일',guide:'YYYY-MM-DD' },
  { code:'keyIssues',label:'핵심 쟁점',guide:'독소조항, 기준일, 물가변동, 단가조정 등 확인된 쟁점' },
  { code:'objective',label:'제안 목적',guide:'클라이언트 관점의 목표와 권익 보호 방향' },
  { code:'planNotes',label:'수행 계획 메모',guide:'Fact Finding, 법리·원가 검증, 협상, 총회·의결 지원 범위' },
  { code:'exclusions',label:'제외·확인 사항',guide:'제안 범위에서 제외하거나 추가 확인할 내용' }
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

export function proposalStudioWorkbook(values: ProposalStudioExcelValues, projectLabel: string, templateName: string): Uint8Array {
  const dataRows = studioFields.map((field,index)=>{const row=index+4;return `<row r="${row}" ht="48" customHeight="1">${cell(`A${row}`,field.code,'2')}${cell(`B${row}`,field.label,'2')}${cell(`C${row}`,values[field.code],'3')}${cell(`D${row}`,field.guide,'4')}</row>`;}).join('');
  const worksheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="22" customWidth="1" hidden="1"/><col min="2" max="2" width="24" customWidth="1"/><col min="3" max="3" width="80" customWidth="1"/><col min="4" max="4" width="54" customWidth="1"/></cols><sheetData><row r="1" ht="32" customHeight="1">${cell('A1','클레임센터 스튜디오 · 12챕터 제안서 입력 양식','1')}</row><row r="2">${cell('A2',`프로젝트: ${projectLabel} · 템플릿: ${templateName} · 금액은 저장 시 자동 비공개 처리됩니다.`,'4')}</row><row r="3">${cell('A3','FIELD_CODE','2')}${cell('B3','작성 항목','2')}${cell('C3','클라이언트별 수정 내용','2')}${cell('D3','작성 안내','2')}</row>${dataRows}</sheetData><mergeCells count="2"><mergeCell ref="A1:D1"/><mergeCell ref="A2:D2"/></mergeCells></worksheet>`;
  const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="16"/><color rgb="FF17326D"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3155B8"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF1FF"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom></border></borders><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>';
  return zipStore([
    {name:'[Content_Types].xml',content:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'},
    {name:'_rels/.rels',content:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {name:'xl/workbook.xml',content:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="제안서 입력" sheetId="1" r:id="rId1"/></sheets></workbook>'},
    {name:'xl/_rels/workbook.xml.rels',content:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
    {name:'xl/styles.xml',content:styles},{name:'xl/worksheets/sheet1.xml',content:worksheet}
  ]);
}

export function sentProposalArchiveWorkbook(rows: SentProposalExcelRow[]): Uint8Array {
  const columns: Array<{ key: keyof SentProposalExcelRow; label: string; width: number }> = [
    { key: 'caseNumber', label: '프로젝트 번호', width: 18 },
    { key: 'caseTitle', label: '프로젝트명', width: 34 },
    { key: 'proposalNumber', label: '제안서 번호', width: 20 },
    { key: 'proposalTitle', label: '제안서 제목', width: 42 },
    { key: 'revisionLabel', label: '연동 버전', width: 14 },
    { key: 'clientName', label: '클라이언트', width: 24 },
    { key: 'sentAt', label: '연동일시', width: 22 },
    { key: 'responseDueOn', label: '회신기한', width: 18 },
    { key: 'proposedAmountKrw', label: '제안금액(원)', width: 18 },
    { key: 'verificationStatus', label: '원문 검증', width: 16 },
    { key: 'awardStatus', label: '수주 상태', width: 16 },
    { key: 'documentUrl', label: '확정 원문 주소', width: 52 },
    { key: 'documentSha256', label: '원문 SHA-256', width: 68 },
    { key: 'createdByName', label: '등록자', width: 18 },
    { key: 'createdAt', label: 'DB 등록일시', width: 22 }
  ];
  const columnName = (index: number) => {
    let value = index + 1;
    let output = '';
    while (value > 0) { value -= 1; output = String.fromCharCode(65 + (value % 26)) + output; value = Math.floor(value / 26); }
    return output;
  };
  const widths = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`).join('');
  const headers = columns.map((column, index) => cell(`${columnName(index)}3`, column.label, '2')).join('');
  const dataRows = rows.map((row, rowIndex) => {
    const excelRow = rowIndex + 4;
    const values = columns.map((column, columnIndex) => {
      const raw = row[column.key];
      return cell(`${columnName(columnIndex)}${excelRow}`, raw === null ? '' : String(raw), '4');
    }).join('');
    return `<row r="${excelRow}" ht="32" customHeight="1">${values}</row>`;
  }).join('');
  const lastColumn = columnName(columns.length - 1);
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths}</cols><sheetData><row r="1" ht="30" customHeight="1">${cell('A1', '클레임센터 스튜디오 · 연동 제안서 DB 원장', '1')}</row><row r="2">${cell('A2', `내보낸 시각: ${new Date().toISOString()} · 총 ${rows.length}건`, '4')}</row><row r="3">${headers}</row>${dataRows}</sheetData><mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells><autoFilter ref="A3:${lastColumn}${Math.max(3, rows.length + 3)}"/></worksheet>`;
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="16"/><color rgb="FF17326D"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3155B8"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F7FB"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom></border></borders><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>';
  return zipStore([
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="연동 제안서 DB" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', content: styles },
    { name: 'xl/worksheets/sheet1.xml', content: worksheet }
  ]);
}

const read16 = (view: DataView, offset: number) => view.getUint16(offset, true);
const read32 = (view: DataView, offset: number) => view.getUint32(offset, true);

async function zipEntry(bytes: Uint8Array, wantedName: string, optional = false): Promise<string> {
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
  if (optional) return '';
  throw new Error('제안서 작성 시트를 찾지 못했습니다. 내보낸 양식을 사용하세요.');
}

const unescapeXml = (value: string) => value
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'")
  .replaceAll('&amp;', '&');

/**
 * Excel rewrites inline strings to a shared string table when a user opens and
 * saves an exported workbook.  Reading only `<t>` from the worksheet therefore
 * works for our freshly exported file, but reads the shared-string index (0, 1,
 * 2...) after a normal Excel edit.  Keep this parser dependency-free so it also
 * runs in Cloudflare Workers and in the browser.
 */
async function workbookSharedStrings(bytes: Uint8Array): Promise<string[]> {
  const sharedXml = await zipEntry(bytes, 'xl/sharedStrings.xml', true);
  if (!sharedXml) return [];
  return [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)].map((item) =>
    [...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)]
      .map((text) => unescapeXml(text[1]))
      .join(''),
  );
}

async function workbookFirstSheetPath(bytes: Uint8Array): Promise<string> {
  const [workbookXml, relationshipsXml] = await Promise.all([
    zipEntry(bytes, 'xl/workbook.xml', true),
    zipEntry(bytes, 'xl/_rels/workbook.xml.rels', true),
  ]);
  const relationshipId = workbookXml.match(/<sheet\b[^>]*\br:id="([^"]+)"/u)?.[1];
  if (!relationshipId || !relationshipsXml) return 'xl/worksheets/sheet1.xml';
  const escapedId = relationshipId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const target = relationshipsXml.match(new RegExp(`<Relationship\\b(?=[^>]*\\bId="${escapedId}")(?=[^>]*\\bTarget="([^"]+)")[^>]*/?>`, 'u'))?.[1];
  if (!target) return 'xl/worksheets/sheet1.xml';
  const decodedTarget = unescapeXml(target).replaceAll('\\', '/').replace(/^\//u, '');
  if (decodedTarget.startsWith('xl/')) return decodedTarget;
  return `xl/${decodedTarget.replace(/^\.\//u, '')}`;
}

function worksheetRows(sheetXml: string, sharedStrings: readonly string[]): Array<Map<string, string>> {
  const rows: Array<Map<string, string>> = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)) {
    const cellValues = new Map<string, string>();
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)\br="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/gu)) {
      const attributes = `${cellMatch[1]} ${cellMatch[3]}`;
      const body = cellMatch[4];
      const type = attributes.match(/\bt="([^"]+)"/u)?.[1] ?? '';
      const inlineText = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)]
        .map((text) => unescapeXml(text[1]))
        .join('');
      const rawValue = unescapeXml(body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/u)?.[1] ?? '');
      const value = type === 's'
        ? sharedStrings[Number.parseInt(rawValue, 10)] ?? ''
        : inlineText || rawValue;
      cellValues.set(cellMatch[2], value);
    }
    rows.push(cellValues);
  }
  return rows;
}

function excelDateToIso(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  if (!/^\d+(?:\.\d+)?$/u.test(value)) return value;
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return value;
  // Excel's 1900 date system contains the historic, fictitious 1900-02-29.
  const utc = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  return new Date(utc).toISOString().slice(0, 10);
}

export async function readProposalWorkbook(file: File): Promise<ProposalExcelValues> {
  if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 5_000_000) throw new Error('5MB 이하의 XLSX 제안서 양식만 가져올 수 있습니다.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sheetPath = await workbookFirstSheetPath(bytes);
  const [sheetXml, sharedStrings] = await Promise.all([
    zipEntry(bytes, sheetPath),
    workbookSharedStrings(bytes),
  ]);
  const result = {} as ProposalExcelValues;
  for (const cellValues of worksheetRows(sheetXml, sharedStrings)) {
    const valueAt = (column: string) => cellValues.get(column) ?? '';
    const code = valueAt('A') as keyof ProposalExcelValues;
    if (fields.some((field) => field.code === code)) result[code] = valueAt('C').trim();
  }
  if (!fields.every((field) => typeof result[field.code] === 'string')) throw new Error('필수 제안서 항목이 없습니다. 내보낸 양식의 FIELD_CODE 열을 변경하지 마세요.');
  return result;
}

export async function readProposalStudioWorkbook(file: File): Promise<ProposalStudioExcelValues> {
  if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 5_000_000) throw new Error('5MB 이하의 XLSX 제안서 양식만 가져올 수 있습니다.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const sheetPath=await workbookFirstSheetPath(bytes);
  const [sheetXml,sharedStrings]=await Promise.all([zipEntry(bytes,sheetPath),workbookSharedStrings(bytes)]);
  const result={} as ProposalStudioExcelValues;
  for(const cellValues of worksheetRows(sheetXml,sharedStrings)){
    const code=cellValues.get('A') as keyof ProposalStudioExcelValues;
    if(studioFields.some((field)=>field.code===code))result[code]=code==='submissionDate'?excelDateToIso((cellValues.get('C')??'').trim()):(cellValues.get('C')??'').trim();
  }
  if(!studioFields.every((field)=>typeof result[field.code]==='string'))throw new Error('12챕터 제안서 필수 항목이 없습니다. 내보낸 양식의 FIELD_CODE 열을 변경하지 마세요.');
  return result;
}

const proposalDocxChapterAliases: ReadonlyArray<ReadonlyArray<string>> = [
  ['제안의 목적','제안(용역)의 목적','용역의 목적'],
  ['핵심 쟁점','현장의 핵심 쟁점','쟁점 분석'],
  ['업무 수행','추진 계획','계약 방식'],
  ['전문가 현황','업무 수행 내용'],
  ['당사의 강점','전문가 현황'],
  ['조직도','당사의 강점'],
  ['도시정비','조직도'],
  ['부동산원','도시정비'],
  ['건설 클레임','부동산원'],
  ['자격 증명','소송','기술감정'],
  ['용역 조건','자격 증명','계약조건'],
  ['맺음말','맺 음 말'],
];

function proposalDocxHeading(value: string): { number: number; title: string } | null {
  const normalized=value.replaceAll('\u00a0',' ').replace(/\s+/gu,' ').trim();
  const match=normalized.match(/^(?:제\s*)?(\d{1,2})\s*[.、):]\s*(.+)$/u)??normalized.match(/^(\d{1,2})\s+(.+)$/u);
  if(!match)return null;
  const number=Number(match[1]);
  if(number<1||number>12)return null;
  const title=match[2].trim();
  if(!proposalDocxChapterAliases[number-1].some((alias)=>title.includes(alias)))return null;
  return{number,title};
}

export async function readProposalDocx(file: File): Promise<ProposalDocxChapter[]> {
  if(!file.name.toLowerCase().endsWith('.docx')||file.size>15_000_000)throw new Error('15MB 이하의 Word DOCX 제안서만 가져올 수 있습니다. HWP는 Word에서 DOCX로 저장한 뒤 가져오세요.');
  const documentXml=await zipEntry(new Uint8Array(await file.arrayBuffer()),'word/document.xml');
  const unescapeXml=(value:string)=>value.replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&apos;',"'").replaceAll('&amp;','&');
  const paragraphs:string[]=[];
  for(const paragraph of documentXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gu)){
    const parts=[...paragraph[1].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gu)].map((match)=>unescapeXml(match[1]));
    const text=parts.join('').replace(/\s+/gu,' ').trim();
    if(text)paragraphs.push(text);
  }
  const candidates=new Map<number,Array<{title:string;body:string}>>();
  let current:{number:number;title:string;lines:string[]}|null=null;
  const flush=()=>{if(!current)return;const body=current.lines.join('\n\n').trim();const values=candidates.get(current.number)??[];values.push({title:current.title,body});candidates.set(current.number,values);};
  for(const paragraph of paragraphs){
    const heading=proposalDocxHeading(paragraph);
    if(heading){flush();current={...heading,lines:[]};continue;}
    if(current)current.lines.push(paragraph);
  }
  flush();
  const chapters=[...candidates.entries()].map(([number,values])=>{const selected=[...values].sort((left,right)=>right.body.length-left.body.length)[0];return{number,title:selected.title,body:selected.body};}).sort((left,right)=>left.number-right.number);
  if(chapters.length<3||![1,2,3].every((number)=>chapters.some((chapter)=>chapter.number===number)))throw new Error('12챕터 제안서 목차를 인식하지 못했습니다. 표준 제안서 DOCX 또는 이 화면에서 내려받은 DOCX를 사용하세요.');
  return chapters;
}
