import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix, resolve } from 'node:path';
import { test } from 'node:test';
import { calculateEs, newEsInput } from '../packages/document-engine/src/es-calculation';
import { buildEsSheets, ES_SHEETS } from '../packages/document-engine/src/es-output';
import { esCellPosition, esTemplateFooter, esTemplateGrids, esTemplateStyles, esTemplateValues, type EsTemplateGrid } from '../packages/document-engine/src/es-template';
import { esContentsDrawingSvg } from '../packages/document-engine/src/es-template-drawing';
import { esPrintNumber } from '../apps/web/src/es/es-template-print';
import { esTemplateSheetXml, esTemplateStylesXml } from '../apps/web/src/es/es-template-xlsx';
import { exportEsReport, exportEsWorking } from '../apps/web/src/es/es-xlsx';

// All document inputs are synthetic. Optional metadata contains structure/style only,
// independently extracted read-only by the mapper; no workbook or customer cache is loaded.
const metadataPath = process.env.CF128_ES_PRINT_METADATA ?? resolve('output/cf128/print-source-metadata.json');
const requireWeb = createRequire(resolve('apps/web/package.json'));
const { unzipSync, strFromU8 } = requireWeb('fflate') as typeof import('../apps/web/node_modules/fflate');
const xmlText = (text: string) => text.replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[entity]!));
const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], xmlText(m[2])]));
const tagAttributes = (xml: string, name: string) => attributes(xml.match(new RegExp(`<${name}\\b[^>]*>`))?.[0] ?? '');
const xmlFiles = (bytes: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([path, bytes]) => [path, strFromU8(bytes)]));
const gridFor = (name: string) => { const grid = esTemplateGrids.find(g => g.name === name); assert.ok(grid, name); return grid; };
const styleFor = (grid: EsTemplateGrid, address: string) => { const [row, col] = esCellPosition(address); return esTemplateStyles[new Map(grid.cellStyles).get(address) ?? grid.rowStyles?.[row] ?? grid.columns[col]?.style ?? 0]; };
const cellXml = (xml: string, address: string) => { const cell = xml.match(new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*>[\\s\\S]*?<\\/c>`)); assert.ok(cell, address); return cell[0]; };
const cellValue = (xml: string, address: string) => { const cell = cellXml(xml, address); return xmlText(cell.match(/<v>(.*?)<\/v>/)?.[1] ?? [...cell.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')); };
function fixture() {
  const input = newEsInput();
  input.title = '합성 출력 대조 공사'; input.client = '합성 발주자'; input.contractor = '합성 시공자';
  input.baseDate = '2024-01-01'; input.adjustmentDate = '2024-03-01'; input.contract!.contractDate = '2024-02-01'; input.contract!.bidRate = '87.745';
  input.contractAmount = '1234567890'; input.costs['11'] = '60000'; input.costs['18'] = '30000'; input.costs['35'] = '10000';
  for (const [period, date, wage] of [[input.base, input.baseDate, '100'], [input.current.period, input.adjustmentDate, '105'], [input.previous.period, '2024-02-29', '104']] as const) {
    period.date = date; period.wage = wage; period.materials = ['100', '100', '100', '100']; period.source = '비식별 합성 원자료';
    period.rates = { injury: '3', safety: '2', employment: '1', retirement: '2', health: '2', pension: '4', care: '10' };
  }
  for (const context of [input.current, input.previous]) for (const pair of [context.machinery, ...context.standards]) { pair.baseAverage = '100'; pair.comparisonAverage = '105'; pair.commonCount = '10'; pair.source = '합성 기간쌍'; }
  return input;
}
const dividerTitles = ['물가변동으로 인한 계약금액 조정에 대한 종합의견서', '물가변동으로 인한 계약금액조정내역 총괄표', '물가변동 조정율(지수조정율) 산출표', '물가변동에 적용한 각종지수의 산정표', '직하조정율'];

test('CF128 original print metadata retains A4 portrait, per-sheet scale and page numbering without fit override', () => {
  const scaled: Record<string, string> = { '1': '96', '3': '87', '3.': '87', '4': '90', '4.': '90' };
  assert.equal(esTemplateGrids.length, 17);
  for (const grid of esTemplateGrids) {
    const expected = { paperSize: '9', orientation: 'portrait', ...(scaled[grid.name] ? { scale: scaled[grid.name] } : {}), ...(grid.name === '1' ? { firstPageNumber: '5' } : {}), ...(grid.name === '붙1' ? { useFirstPageNumber: '1' } : {}) };
    assert.deepEqual(grid.pageSetup, expected, grid.name);
    const xml = esTemplateSheetXml(grid, {});
    assert.deepEqual(tagAttributes(xml, 'pageSetup'), expected, grid.name);
    assert.notEqual(tagAttributes(xml, 'pageSetUpPr').fitToPage, '1', grid.name);
    assert.deepEqual(tagAttributes(xml, 'pageMargins'), grid.margins, grid.name);
    assert.equal(tagAttributes(xml, 'printOptions').horizontalCentered, '1', grid.name);
  }
});

test('CF128 independently extracted original metadata matches all 17 runtime grids', { skip: !existsSync(metadataPath) ? 'Structure-only source metadata was not supplied; native/source comparison is not claimed.' : false }, () => {
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as { classification: string; sheets: Array<{ name: string; printArea: string; pageSetup: Record<string, string>; margins: Record<string, string>; printOptions: Record<string, string>; pageSetUpPr: Record<string, string>; printTitles: unknown; rowBreaks: unknown[]; colBreaks: unknown[]; shrinkToFitCells: string[]; fonts: Array<{ name: string; size: number; cells: number }>; merges: string[] }> };
  assert.equal(metadata.classification, 'STRUCTURE_AND_FORMAT_ONLY_NO_CUSTOMER_VALUES_OR_RAW_FORMULAS');
  assert.deepEqual(metadata.sheets.map(s => s.name), esTemplateGrids.map(s => s.name));
  for (const source of metadata.sheets) {
    const grid = gridFor(source.name), xml = esTemplateSheetXml(grid, {});
    assert.deepEqual(grid.pageSetup, source.pageSetup, `${source.name} source page setup`);
    assert.deepEqual(grid.margins, source.margins, `${source.name} source margins`);
    assert.equal(grid.printArea, source.printArea, `${source.name} print area`);
    assert.deepEqual(tagAttributes(xml, 'pageSetup'), source.pageSetup, `${source.name} XLSX page setup`);
    assert.deepEqual(tagAttributes(xml, 'pageSetUpPr'), source.pageSetUpPr, `${source.name} XLSX fit settings`);
    assert.deepEqual(tagAttributes(xml, 'printOptions'), source.printOptions, `${source.name} centering`);
    assert.equal(source.printTitles, null); assert.deepEqual(source.rowBreaks, []); assert.deepEqual(source.colBreaks, []);
    for (const address of source.shrinkToFitCells) assert.equal(styleFor(grid, address).alignment?.shrinkToFit, '1', `${source.name}!${address}`);
    const fontCounts: Record<string, number> = {};
    for (const [, index] of grid.cellStyles) { const font = esTemplateStyles[index].font, key = `${font.name}/${font.size}`; fontCounts[key] = (fontCounts[key] ?? 0) + 1; }
    assert.deepEqual(fontCounts, Object.fromEntries(source.fonts.map(font => [`${font.name}/${font.size}`, font.cells])), `${source.name} independently extracted font assignments`);
    const [lastRow, lastCol] = esCellPosition(grid.printArea.split(':').at(-1)!);
    const printableMerges = source.merges.filter(range => { const [row, col] = esCellPosition(range.split(':').at(-1)!); return row <= lastRow && col <= lastCol; });
    assert.deepEqual([...grid.merges].sort(), printableMerges.sort(), `${source.name} only in-area merges`);
  }
});

test('CF128 original won formats preserve unit suffix, grouping, signs, zero and exact integer precision', () => {
  for (const format of ['#,##0\\ "원"', '#,##0_ \\ "원"']) {
    for (const [value, expected] of [['1234567890', '1,234,567,890 원'], ['-1234567', '-1,234,567 원'], ['0', '0 원'], ['9007199254740993', '9,007,199,254,740,993 원']]) assert.equal(esPrintNumber(value, format).trim(), expected, `${format} / ${value}`);
  }
  assert.equal(esPrintNumber('—', '#,##0\\ "원"'), '—');
  assert.equal(esPrintNumber('', '#,##0\\ "원"'), '');
  assert.equal(esPrintNumber('1234567', '#,##0'), '1,234,567');
});

test('CF128 original day format prints contract-to-adjustment-minus-one with its literal day unit', () => {
  const input = fixture(), grid = gridFor('1'), result = calculateEs(input), values = esTemplateValues(input, result, grid);
  assert.equal(values.E19, '28'); // Leap-year February: March 1 minus February 1 minus one.
  assert.equal(esPrintNumber(values.E19, styleFor(grid, 'E19').numberFormat).trim(), '28 일');
  input.contract!.contractDate = '';
  assert.equal(esTemplateValues(input, calculateEs(input), grid).E19, '—');
});

test('CF128 percentages and decimal padding remain exact after adding literal formats', () => {
  assert.equal(esPrintNumber('0.87745', '0.00%'), '87.75%');
  assert.equal(esPrintNumber('0.03115', '0.00%'), '3.12%');
  assert.equal(esPrintNumber('-0.03115', '0.00%'), '-3.12%');
  assert.equal(esPrintNumber('1.2', '0.00000000_ '), '1.20000000');
  assert.equal(esPrintNumber('1000.125', '#,##0.00_ '), '1,000.13');
});

test('CF128 accounting negative/zero sections and literal dates do not leak Excel format tokens', () => {
  const accounting = '_-* #,##0_-;\\-* #,##0_-;_-* "-"_-;_-@_-';
  assert.equal(esPrintNumber('1234', accounting), '1,234');
  assert.equal(esPrintNumber('-1234', accounting), '-1,234');
  assert.equal(esPrintNumber('0', accounting), '-');
  assert.equal(esPrintNumber('-1234', '#,##0_);[Red]\\(#,##0\\)'), '(1,234)');
  assert.equal(esPrintNumber('45351', 'yyyy"년"\\ m"월"\\ d"일";@'), '2024년 2월 29일');
});

test('CF128 five divider titles map to the original generic contents headings, not rewritten labels', () => {
  const input = fixture(), result = calculateEs(input);
  dividerTitles.forEach((title, i) => {
    const grid = gridFor(`붙${i + 1}`), values = esTemplateValues(input, result, grid);
    assert.equal(values.B8, title, grid.name);
    assert.equal(cellValue(esTemplateSheetXml(grid, values), 'B8'), title, grid.name);
  });
});

test('CF128 summary attachment table retains original numeric sequence, titles and references', () => {
  const input = fixture(), grid = gridFor('1'), values = esTemplateValues(input, calculateEs(input), grid);
  const expected: Record<string, string> = {
    A29: '1', B29: '물가변동으로 인한 계약금액 조정 내역 총괄표 (프로그램 데이터 포함)', I29: '붙임 2 참조',
    A30: '2', B30: '물가변동으로 인한 계약금액 조정 산출근거 (프로그램 데이터 포함)', I30: '붙임 3~11 참조',
    A31: '3', B31: '물가변동으로 인한 계약금액 조정 참고자료 및 필수제출자료', I31: '붙임 12 참조',
  };
  const xml = esTemplateSheetXml(grid, values);
  for (const [address, value] of Object.entries(expected)) { assert.equal(values[address], value, address); assert.equal(cellValue(xml, address), value, address); }
});

test('CF128 dynamic values stay unformatted numeric data in XLSX while original display formats add units', () => {
  const input = fixture(), result = calculateEs(input), grid = gridFor('1'), values = esTemplateValues(input, result, grid), xml = esTemplateSheetXml(grid, values);
  assert.equal(values.D21, input.contractAmount);
  assert.equal(cellValue(xml, 'D21'), '1234567890'); assert.doesNotMatch(cellXml(xml, 'D21'), /inlineStr|원|,/);
  assert.equal(esPrintNumber(values.D21, styleFor(grid, 'D21').numberFormat).trim(), '1,234,567,890 원');
  assert.equal(cellValue(xml, 'E19'), '28'); assert.doesNotMatch(cellXml(xml, 'E19'), /inlineStr|일/);
  assert.equal(values.J6, '0.87745'); assert.equal(cellValue(xml, 'J6'), '0.87745');
});

test('CF128 XLSX retains every original font name/size, number format and shrink-to-fit style', () => {
  const xml = esTemplateStylesXml();
  const fonts = [...xml.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/)![1].matchAll(/<font>([\s\S]*?)<\/font>/g)].map(m => m[1]);
  const formats = [...xml.matchAll(/<numFmt\b[^>]*\/>/g)].map(m => attributes(m[0]));
  const xfs = [...xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)![1].matchAll(/<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(m => m[0]);
  assert.equal(fonts.length, esTemplateStyles.length + 2); assert.equal(formats.length, esTemplateStyles.length); assert.equal(xfs.length, esTemplateStyles.length + 2);
  esTemplateStyles.forEach((style, i) => {
    assert.equal(tagAttributes(fonts[i + 2], 'name').val, style.font.name, `font ${i}`);
    assert.equal(tagAttributes(fonts[i + 2], 'sz').val, String(style.font.size), `size ${i}`);
    assert.equal(formats[i].formatCode, style.numberFormat, `format ${i}`);
    assert.equal(formats[i].numFmtId, String(164 + i));
    assert.deepEqual(tagAttributes(xfs[i + 2], 'alignment'), style.alignment ?? {}, `alignment ${i}`);
  });
});

test('CF128 source footers keep original page token and size; cover/contents/dividers have no invented header/footer', () => {
  const sourceExtrasPath = resolve('output/cf128/es-original-print-extras.json');
  const source = existsSync(sourceExtrasPath) ? JSON.parse(readFileSync(sourceExtrasPath, 'utf8')) as { sheets: Record<string, { headerFooter: { attributes: Record<string, string>; oddFooter?: string } }> } : undefined;
  const numbered: Record<string, string> = { '1': '&C&9- &P -', '2': '&C&9- &P -', '2.1': '&C&9- &P -', '2.2(선금)': '&C&9- &P -', '3': '&C&10- &P -', '4': '&C&9- &P -', '2.': '&C&9- &P -', '2.1.': '&C&9- &P -', '3.': '&C&10- &P -', '4.': '&C&9- &P -' };
  for (const grid of esTemplateGrids) {
    const xml = esTemplateSheetXml(grid, {}), expected = numbered[grid.name] ?? '';
    assert.equal(esTemplateFooter(grid), expected, grid.name);
    assert.equal(xmlText(xml.match(/<oddFooter>(.*?)<\/oddFooter>/)?.[1] ?? ''), expected, grid.name);
    assert.deepEqual(tagAttributes(xml, 'headerFooter'), { alignWithMargins: '0' });
    assert.doesNotMatch(xml, /<oddHeader>|LEGACY_REPLAY|검토용 초안/);
    if (source) { assert.equal(source.sheets[grid.name].headerFooter.oddFooter ?? '', expected, `${grid.name} independent footer`); assert.deepEqual(source.sheets[grid.name].headerFooter.attributes, tagAttributes(xml, 'headerFooter')); }
  }
});

test('CF128 contents retains the original grid and lists only selected attachment groups, without mutating the shared template', () => {
  const input = fixture(), result = calculateEs(input), grid = gridFor('목록'), before = JSON.stringify(grid);
  const full = buildEsSheets(input, result, ES_SHEETS.map(s => s[0])).find(s => s.id === 'contents')!;
  assert.equal(full.grid, grid); dividerTitles.forEach((title, i) => assert.equal(full.values![`C${i + 5}`], title));
  for (const [id, group] of [['review_summary', 0], ['advance_deduction', 1], ['rate_details', 2], ['index_details', 3], ['previous_day_index_details', 4]] as const) {
    const contents = buildEsSheets(input, result, ['contents', id])[0]; assert.equal(contents.grid, grid);
    for (let index = 0; index < 5; index++) {
      assert.equal(contents.values![`C${index + 5}`], index === group ? dividerTitles[index] : '');
      if (index !== group) assert.equal(contents.values![`B${index + 5}`], '');
    }
    const zip = xmlFiles(exportEsReport(input, result, ['contents', id]));
    for (let index = 0; index < 5; index++) assert.equal(cellValue(zip['xl/worksheets/sheet1.xml'], `C${index + 5}`), index === group ? dividerTitles[index] : '');
  }
  assert.equal(JSON.stringify(grid), before);
});

test('CF128 both 443-row detail sheets retain every row, all merged ranges and text escaping', () => {
  for (const name of ['4', '4.']) {
    const grid = gridFor(name), xml = esTemplateSheetXml(grid, { A1: '합성 <script> & "텍스트"', M443: '합성 마지막 행' });
    assert.deepEqual([...xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)].map(m => Number(m[1])), Array.from({ length: 443 }, (_, i) => i + 1), name);
    assert.deepEqual([...xml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"/g)].map(m => m[1]), grid.merges, name);
    assert.equal(cellValue(xml, 'M443'), '합성 마지막 행'); assert.equal(cellValue(xml, 'A1'), '합성 <script> & "텍스트"'); assert.doesNotMatch(xml, /<script>/);
  }
});

test('CF128 real values-only workbook preserves all selected sheet settings without mutating the run', () => {
  const input = fixture(), result = calculateEs(input), before = JSON.stringify({ input, result });
  const selected = ES_SHEETS.filter(s => s[0] !== 'contents').map(s => s[0]);
  const zip = xmlFiles(exportEsReport(input, result, selected));
  const names = [...zip['xl/workbook.xml'].matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map(m => xmlText(m[1]));
  assert.deepEqual(names, ES_SHEETS.filter(s => s[0] !== 'contents').map(s => s[1]));
  names.forEach((name, index) => { const grid = gridFor(name), xml = zip[`xl/worksheets/sheet${index + 1}.xml`]; assert.deepEqual(tagAttributes(xml, 'pageSetup'), grid.pageSetup, name); assert.deepEqual(tagAttributes(xml, 'pageMargins'), grid.margins, name); });
  assert.doesNotMatch(Object.keys(zip).join('\n'), /externalLinks|vbaProject|ES_작업정보/);
  assert.doesNotMatch(Object.values(zip).join('\n'), /<f[ >]|Bearer|api[_-]?key|organizationId/);
  assert.equal(JSON.stringify({ input, result }), before);
  assert.equal(buildEsSheets(input, result, ['contents', 'divider_3', 'rate_details'])[0].rows.length, 2);
});

test('CF128 working workbook also retains all 17 output grids and original page setup', async () => {
  const zip = xmlFiles(await exportEsWorking(fixture()));
  const names = [...zip['xl/workbook.xml'].matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map(m => xmlText(m[1]));
  assert.equal(names.length, 20); assert.deepEqual(names.slice(3), esTemplateGrids.map(g => g.name));
  esTemplateGrids.forEach((grid, index) => { const xml = zip[`xl/worksheets/sheet${index + 4}.xml`]; assert.deepEqual(tagAttributes(xml, 'pageSetup'), grid.pageSetup, grid.name); assert.deepEqual(tagAttributes(xml, 'dimension'), { ref: grid.printArea }, grid.name); });
  assert.match(zip['xl/workbook.xml'], /name="ES_작업정보"[^>]*state="veryHidden"/);
  assert.match(zip['xl/worksheets/sheet2.xml'], /<f>/);
});

function verifyContentsDrawing(zip: Record<string, string>, hasContents: boolean): string | undefined {
  const names = [...zip['xl/workbook.xml'].matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map(m => xmlText(m[1]));
  const drawingParts = Object.keys(zip).filter(path => /^xl\/drawings\/[^/]+\.xml$/.test(path));
  assert.equal(drawingParts.length, hasContents ? 1 : 0, 'exact drawing part count');
  const drawingOverrides = [...zip['[Content_Types].xml'].matchAll(/<Override\b[^>]*\/>/g)].map(m => attributes(m[0])).filter(o => o.ContentType === 'application/vnd.openxmlformats-officedocument.drawing+xml');
  assert.equal(drawingOverrides.length, drawingParts.length, 'drawing content types cannot be missing or orphaned');
  let drawingXml: string | undefined;
  names.forEach((name, index) => {
    const sheetPath = `xl/worksheets/sheet${index + 1}.xml`, sheet = zip[sheetPath], drawing = tagAttributes(sheet, 'drawing');
    const relationshipsPath = `xl/worksheets/_rels/sheet${index + 1}.xml.rels`;
    const relationships = [...(zip[relationshipsPath] ?? '').matchAll(/<Relationship\b[^>]*\/>/g)].map(m => attributes(m[0]));
    const drawingRelationships = relationships.filter(r => r.Type === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing');
    if (name !== '목록') { assert.deepEqual(drawing, {}, `${name}: no invented drawing`); assert.deepEqual(drawingRelationships, [], `${name}: no orphan drawing relationship`); return; }
    assert.ok(hasContents); assert.ok(drawing['r:id'], 'worksheet drawing has a relationship ID');
    assert.equal(tagAttributes(sheet, 'worksheet')['xmlns:r'], 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');
    assert.equal(drawingRelationships.length, 1, 'contents has exactly one drawing relationship');
    const relation = drawingRelationships[0]; assert.equal(relation.Id, drawing['r:id']); assert.notEqual(relation.TargetMode, 'External');
    assert.doesNotMatch(relation.Target, /^\w+:|\\|[?#]/);
    const part = posix.normalize(posix.join(posix.dirname(sheetPath), relation.Target));
    assert.match(part, /^xl\/drawings\/[^/]+\.xml$/); assert.equal(part, drawingParts[0]);
    assert.equal(drawingOverrides[0].PartName, '/' + part); assert.ok(zip[part]); drawingXml = zip[part];
  });
  for (const [path, xml] of Object.entries(zip)) if (path.endsWith('.rels')) assert.doesNotMatch(xml, /TargetMode="External"|Target="(?:https?:|file:|javascript:|data:|\\)/i, path);
  assert.doesNotMatch(Object.keys(zip).join('\n'), /externalLinks|vbaProject|embeddings\/|xl\/media\//i);
  if (drawingXml) {
    assert.deepEqual([...drawingXml.matchAll(/<(?:[\w]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?t>/g)].map(m => xmlText(m[1])), ['붙임자료 목록']);
    assert.match(drawingXml, /typeface="HY헤드라인M"/); assert.match(drawingXml, /sz="1800"/);
    const guide = [...drawingXml.matchAll(/<(?:[\w]+:)?gd\b[^>]*\/>/g)].map(m => attributes(m[0]));
    assert.deepEqual(guide, [{ name: 'adj', fmla: 'val 3268' }], 'geometry guide identifier must survive privacy sanitization');
    assert.doesNotMatch(drawingXml, /(?:macro|textlink)="[^"]+"|<(?:[\w]+:)?(?:hlinkClick|hlinkHover|blip|oleObj|externalData|fld)\b|<!DOCTYPE|<!ENTITY|javascript:|WEBSERVICE|DDE\(/i);
    const ids = [...drawingXml.matchAll(/<(?:[\w]+:)?cNvPr\b[^>]*>/g)].map(m => attributes(m[0]).id);
    assert.equal(ids.length, 3); assert.equal(new Set(ids).size, 3);
  }
  return drawingXml;
}

test('CF128 actual all/selected/contents-only submission XLSX connects the original drawing without external relationships', () => {
  const input = fixture(), result = calculateEs(input);
  for (const selection of [ES_SHEETS.map(s => s[0]), ['contents'], ['contents', 'divider_3', 'rate_details']]) verifyContentsDrawing(xmlFiles(exportEsReport(input, result, selection)), true);
});

test('CF128 omitting contents omits its drawing and relationships; working XLSX preserves it after three support sheets', async () => {
  const input = fixture(), result = calculateEs(input);
  verifyContentsDrawing(xmlFiles(exportEsReport(input, result, ['cover', 'rate_details', 'previous_day_index_details'])), false);
  verifyContentsDrawing(xmlFiles(await exportEsWorking(input)), true);
});

test('CF128 contents drawing anchors retain the independently extracted source layout without copying customer text', { skip: !existsSync(resolve('output/cf128/original-drawing-metadata.json')) ? 'Source drawing metadata unavailable; original anchor comparison is not claimed.' : false }, () => {
  const metadata = JSON.parse(readFileSync(resolve('output/cf128/original-drawing-metadata.json'), 'utf8')) as { sourceUnchanged: boolean; sheets: Array<{ sheet: string; drawings: Array<{ text: string; textRedacted: boolean; hasImage: boolean; linkedCellRefs: string[]; from: Record<string, unknown>; to: Record<string, unknown> }> }> };
  assert.equal(metadata.sourceUnchanged, true);
  assert.deepEqual(metadata.sheets.filter(s => s.drawings.length).map(s => s.sheet), ['목록']);
  const drawing = metadata.sheets.find(s => s.sheet === '목록')!.drawings[0];
  assert.equal(drawing.text, '붙임자료 목록'); assert.equal(drawing.textRedacted, false); assert.equal(drawing.hasImage, false); assert.deepEqual(drawing.linkedCellRefs, []);
  const input = fixture(), xml = verifyContentsDrawing(xmlFiles(exportEsReport(input, calculateEs(input), ['contents'])), true)!;
  for (const end of ['from', 'to'] as const) {
    const anchor = xml.match(new RegExp(`<(?:[\\w]+:)?${end}>([\\s\\S]*?)<\\/(?:[\\w]+:)?${end}>`))?.[1]; assert.ok(anchor, end);
    for (const key of ['col', 'colOff', 'row', 'rowOff']) assert.equal(anchor.match(new RegExp(`<(?:[\\w]+:)?${key}>(\\d+)<\\/(?:[\\w]+:)?${key}>`))?.[1], drawing[end][key], `${end}.${key}`);
  }
});

test('CF128 contents SVG converts all EMU geometry into CSS-pixel coordinates and preserves an unclamped 24px title', () => {
  const svg = esContentsDrawingSvg([100, 200, 300, 40], () => 12), outer = tagAttributes(svg, 'svg'), text = tagAttributes(svg, 'text');
  assert.equal(text['font-size'], '24', '18pt title must not enter browser layout as 228600px');
  assert.deepEqual(outer.viewBox.split(' ').map(Number), [95250, 167204, 5943600, 7429263].map(emu => emu / 9525));
  assert.ok(outer.viewBox.split(' ').map(Number).every(value => value >= 0 && value < 1000), 'viewBox uses pixels, not millions of EMU');
  assert.match(outer.style, /left:8px;top:32px;width:614px;/);
  const rects = [...svg.matchAll(/<rect\b[^>]*\/>/g)].map(m => attributes(m[0])); assert.equal(rects.length, 2);
  for (const rect of rects) {
    assert.equal(Number(rect['stroke-width']), 25400 / 9525);
    for (const key of ['x', 'y', 'width', 'height', 'rx']) assert.ok(Number(rect[key]) > 0 && Number(rect[key]) < 1000, `pixel ${key}`);
  }
  assert.equal(Number(text.x), 3059225.5 / 9525); assert.equal(Number(text.y), 396928.5 / 9525);
  assert.equal(Number(text.x), Number(rects[1].x) + Number(rects[1].width) / 2);
  assert.equal(Number(text.y), Number(rects[1].y) + Number(rects[1].height) / 2);
  assert.equal(text['text-anchor'], 'middle'); assert.equal(text['dominant-baseline'], 'central');
  assert.match(svg, />붙임자료 목록<\/text>/);
  assert.doesNotMatch(svg, /<script|foreignObject|(?:href|onload|onclick)=|font-size="228600"/i);
});
