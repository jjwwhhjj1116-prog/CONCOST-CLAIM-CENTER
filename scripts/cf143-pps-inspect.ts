// Read-only official archive inspection. No Excel formulas/macros are executed.
import * as XLSX from 'xlsx';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readPublicFile } from '../apps/cloudflare/src/es-public-sources';

export function inspectPpsArchive(bytes: Uint8Array) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const cfb = bytes[0] === 0xd0 ? XLSX.CFB.read(bytes, { type: 'array' }) : undefined;
  const header = cfb && XLSX.CFB.find(cfb, 'FileHeader');
  if (!header) {
    const wb = XLSX.read(bytes, { type: 'array', cellFormula: false, cellHTML: false, sheetRows: 500 });
    return { sha256, format: 'excel', sheets: wb.SheetNames.map(name => ({ name, cells: Object.entries(wb.Sheets[name]).filter(([key]) => !key.startsWith('!')).map(([ref, cell]) => ({ ref, text: String(cell.v ?? '') })) })) };
  }
  const flags = Buffer.from(header.content).readUInt32LE(36);
  if (flags & 2) throw new Error('Encrypted HWP');
  const sections = cfb!.FileIndex.filter((file: { name: string }) => /^Section\d+$/.test(file.name));
  const result: { section: string; col: number; row: number; colSpan: number; rowSpan: number; text: string }[] = [];
  const paragraphs: string[] = [];
  for (const section of sections) {
    const data = flags & 1 ? inflateRawSync(Buffer.from(section.content), { maxOutputLength: 8_000_000 }) : Buffer.from(section.content);
    let offset = 0, cell: typeof result[number] | undefined;
    while (offset + 4 <= data.length) {
      const record = data.readUInt32LE(offset); offset += 4;
      const tag = record & 1023; let size = record >>> 20;
      if (size === 4095) { size = data.readUInt32LE(offset); offset += 4; }
      if (offset + size > data.length) throw new Error('Truncated HWP');
      const payload = data.subarray(offset, offset + size); offset += size;
      if (tag === 72 && size >= 30) {
        cell = { section: section.name, col: payload.readUInt16LE(8), row: payload.readUInt16LE(10), colSpan: payload.readUInt16LE(12), rowSpan: payload.readUInt16LE(14), text: '' };
        result.push(cell);
      }
      if (tag === 67) {
        let text = '';
        for (let at = 0; at + 1 < size; at += 2) {
          const char = payload.readUInt16LE(at);
          if ([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].includes(char)) { at += 14; text += ' '; }
          else if (char >= 32 || char === 10 || char === 13) text += String.fromCharCode(char);
        }
        paragraphs.push(text); if (cell) cell.text += text + '\n';
      }
    }
  }
  return { sha256, format: 'hwp', paragraphs, cells: result };
}

const compact = (s: string) => s.normalize('NFKC').replace(/\s+/gu, '');
export function hwpRateCandidates(doc: ReturnType<typeof inspectPpsArchive>) {
  const cells = doc.cells ?? [], rates: Record<string, { value: string; evidence: string }> = {};
  const set = (field: string, value: string, evidence: string) => {
    if (!(Number(value) > 0 && Number(value) < 100) || rates[field]) throw new Error('Ambiguous rate ' + field);
    rates[field] = { value: String(Number(value)), evidence };
  };
  for (const [field, label, denom] of [['injury','산재보험료','노'],['health','건강보험료','직노'],['pension','연금보험료','직노']] as const) {
    for (const c of cells) {
      const m = compact(c.text).match(new RegExp(`\\[${label === '건강보험료' ? '(?:건강보험료|건강)' : label === '연금보험료' ? '(?:연금보험료|연금)' : label}\\]:?(\\d+(?:\\.\\d+)?)`));
      if (m && cells.some(d => d.col === c.col && d.section === c.section && d.row < c.row && compact(d.text) === `(${denom})×율`)) set(field, m[1], `HWP ${c.section} R${c.row+1}C${c.col+1} ${c.text.trim()} / (${denom})×율`);
    }
  }
  for (const [field, label, denominator] of [['retirement','퇴직공제부금비','직노'],['care','노인장기요양보험료','건강보험료']] as const) {
    for (const h of cells.filter(c => compact(c.text) === label)) {
      const column = cells.filter(c => c.col === h.col && c.section === h.section && c.row > h.row).sort((a,b) => a.row-b.row);
      const denominatorCell = column[0], valueCell = column[1];
      const value = valueCell && compact(valueCell.text).replace(/^[ㅇᄋ]토목공사:/u,'');
      if (denominatorCell && valueCell && value && [`(${denominator})×율`,`(${denominator}×율)`].includes(compact(denominatorCell.text)) && /^\d+(?:\.\d+)?$/.test(value)) set(field, value, `HWP ${valueCell.section} R${valueCell.row+1}C${valueCell.col+1} ${label} / ${denominatorCell.text.trim()} / ${valueCell.text.trim()}`);
    }
  }
  for (const c of cells.filter(c => compact(c.text).includes('[고용보험료]'))) {
    if (!cells.some(d => d.col === c.col && d.section === c.section && d.row < c.row && compact(d.text) === '(노)×율')) continue;
    for (const m of compact(c.text).matchAll(/([1-7](?:,[1-7])*)등급(이하)?[:：](\d+(?:\.\d+)?)/gu)) {
      const grades = m[2] ? Array.from({length:8-Number(m[1])},(_,i)=>Number(m[1])+i) : m[1].split(',').map(Number);
      for (const g of grades) set('employment'+g,m[3],`HWP ${c.section} R${c.row+1}C${c.col+1} ${c.text.trim()} / (노)×율`);
    }
  }
  return rates;
}

if (process.argv[1]?.endsWith('cf143-pps-inspect.ts')) {
  void (async () => {
  const file = process.argv[2];
  const bytes = file.startsWith('https://www.pps.go.kr/common/fileDown.do?') ? await readPublicFile(file, fetch, 'https://www.pps.go.kr/kor/bbs/list.do?key=00038') : new Uint8Array(readFileSync(file));
  console.log(JSON.stringify(inspectPpsArchive(bytes), null, 2));
  })();
}
