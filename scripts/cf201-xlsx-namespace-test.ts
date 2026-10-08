import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { readSpreadsheetExcerpt } from '../apps/web/src/proposals/proposal-excel';

const webRequire = createRequire(resolve('apps/web/package.json'));
const { zipSync, strToU8 } = webRequire('fflate') as typeof import('../apps/web/node_modules/fflate');
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function parts(options: { mainPrefix?: string; mainBinding?: string; officePrefix?: string; officeBinding?: string; packagePrefix?: string; packageBinding?: string; legacy?: boolean; worksheet?: string } = {}): Record<string, Uint8Array> {
  const { mainPrefix = 'x', mainBinding = MAIN, officePrefix = 'o', officeBinding = OFFICE, packagePrefix = 'pkg', packageBinding = PACKAGE, legacy = false } = options;
  const q = (name: string) => mainPrefix ? `${mainPrefix}:${name}` : name;
  const p = (name: string) => packagePrefix ? `${packagePrefix}:${name}` : name;
  const mainDeclaration = mainPrefix ? ` xmlns:${mainPrefix}="${mainBinding}"` : legacy ? '' : ` xmlns="${mainBinding}"`;
  const packageDeclaration = packagePrefix ? ` xmlns:${packagePrefix}="${packageBinding}"` : legacy ? '' : ` xmlns="${packageBinding}"`;
  const worksheet = options.worksheet ?? `<${q('worksheet')}${mainDeclaration}><${q('sheetData')}><${q('row')} r="20"/><${q('row')} r="25"><${q('c')} r="A25" t="s"><${q('v')}>0</${q('v')}></${q('c')}><${q('c')} r="B25"><${q('v')}>123.45</${q('v')}></${q('c')}><${q('c')} r="C25"><${q('f')}>B25*2</${q('f')}><${q('v')}>246.90</${q('v')}></${q('c')}></${q('row')}><${q('row')} r="26"/><${q('row')} r="27"><${q('c')} r="A27" t="inlineStr"><${q('is')}><${q('t')}>다음 합성 항목 &amp;#10;</${q('t')}></${q('is')}></${q('c')}><${q('c')} r="B27"><${q('v')}>0</${q('v')}></${q('c')}><${q('c')} r="C27"/></${q('row')}></${q('sheetData')}></${q('worksheet')}>`;
  return {
    'xl/workbook.xml': strToU8(`<${q('workbook')}${mainDeclaration} xmlns:${officePrefix}="${officeBinding}"><${q('sheets')}><${q('sheet')} name="기본" ${officePrefix}:id="one"/><${q('sheet')} name="구조내역" ${officePrefix}:id="two"/></${q('sheets')}></${q('workbook')}>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<${p('Relationships')}${packageDeclaration}><${p('Relationship')} Id="one" Type="${OFFICE}/worksheet" Target="/xl/worksheets/sheet1.xml"/><${p('Relationship')} Id="two" Type="${OFFICE}/worksheet" Target="worksheets/sheet2.xml"/></${p('Relationships')}>`),
    'xl/worksheets/sheet1.xml': strToU8(`<${q('worksheet')}${mainDeclaration}><${q('sheetData')}><${q('row')} r="1"><${q('c')} r="A1" t="inlineStr"><${q('is')}><${q('t')}>CF201 합성 첫 시트</${q('t')}></${q('is')}></${q('c')}></${q('row')}></${q('sheetData')}></${q('worksheet')}>`),
    'xl/worksheets/sheet2.xml': strToU8(worksheet),
    'xl/sharedStrings.xml': strToU8(`<${q('sst')}${mainDeclaration}><${q('si')}><${q('r')}><${q('t')}>CF201 구조 | &lt;검수&gt;&#10;</${q('t')}></${q('r')}><${q('r')}><${q('t')}>원문</${q('t')}></${q('r')}></${q('si')}></${q('sst')}>`),
  };
}
const fileFrom = (xml: Record<string, Uint8Array>) => new File([Uint8Array.from(zipSync(xml, { level: 0 })).buffer], 'CF201_SYNTHETIC.xlsx');
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const excerpt = (xml: Record<string, Uint8Array>, range = 'A25:C27') => readSpreadsheetExcerpt(fileFrom(xml), range, '구조내역');
const expected = [['CF201 구조 | <검수>\n원문', '123.45', '246.90'], ['', '', ''], ['다음 합성 항목 &#10;', '0', '']];

test('CF201 qualified main tags, package relationships and office ID alias preserve shared text, sparse rows, zero and cached formula', async () => {
  const xml = parts();
  const before = Object.entries(xml).map(([path, bytes]) => [path, sha(bytes)]);
  const result = await excerpt(xml);
  assert.equal(result.sheetName, '구조내역'); assert.equal(result.range, 'A25:C27');
  assert.deepEqual(result.rows, expected);
  assert.deepEqual(Object.entries(xml).map(([path, bytes]) => [path, sha(bytes)]), before);
  assert.equal((await readSpreadsheetExcerpt(fileFrom(xml))).sheetName, '기본');
});

test('CF201 existing unqualified legacy workbook and default qualified namespace remain compatible', async () => {
  assert.deepEqual((await excerpt(parts({ mainPrefix: '', officePrefix: 'r', packagePrefix: '', legacy: true }))).rows, expected);
  assert.deepEqual((await excerpt(parts({ mainPrefix: '', officePrefix: 'rel', packagePrefix: '' }))).rows, expected);
});

test('CF201 wrong main, package and relationship attribute namespace cannot be accepted as spreadsheet data', async () => {
  for (const options of [{ mainBinding: 'urn:cf201-wrong-main' }, { packageBinding: 'urn:cf201-wrong-package' }, { officeBinding: 'urn:cf201-wrong-office' }]) await assert.rejects(excerpt(parts(options)));
});

test('CF201 unbound qualified prefixes in every consumed part are rejected', async () => {
  const cases = [
    ['xl/workbook.xml', ` xmlns:x="${MAIN}"`],
    ['xl/_rels/workbook.xml.rels', ` xmlns:pkg="${PACKAGE}"`],
    ['xl/workbook.xml', ` xmlns:o="${OFFICE}"`],
    ['xl/worksheets/sheet2.xml', ` xmlns:x="${MAIN}"`],
    ['xl/sharedStrings.xml', ` xmlns:x="${MAIN}"`],
  ];
  for (const [path, declaration] of cases) {
    const xml = parts(); const text = decode(xml[path]); assert.ok(text.includes(declaration));
    xml[path] = strToU8(text.replace(declaration, ''));
    await assert.rejects(excerpt(xml));
  }
});

test('CF201 descendant main or office prefix rebinding cannot shift selected sheet or cell provenance', async () => {
  for (const [path, token, replaced] of [
    ['xl/worksheets/sheet2.xml', '<x:sheetData>', '<x:sheetData xmlns:x="urn:cf201-rebound">'],
    ['xl/workbook.xml', '<x:sheets>', '<x:sheets xmlns:x="urn:cf201-rebound">'],
    ['xl/workbook.xml', '<x:sheet name="구조내역"', '<x:sheet xmlns:o="urn:cf201-rebound" name="구조내역"'],
    ['xl/sharedStrings.xml', '<x:si>', '<x:si xmlns:x="urn:cf201-rebound">'],
  ]) {
    const xml = parts(); const text = decode(xml[path]); assert.ok(text.includes(token));
    xml[path] = strToU8(text.replace(token, replaced)); await assert.rejects(excerpt(xml));
  }
});

test('CF201 qualified formula without cached result is rejected only when selected', async () => {
  const xml = parts(); const text = decode(xml['xl/worksheets/sheet2.xml']);
  assert.ok(text.includes('<x:v>246.90</x:v>'));
  xml['xl/worksheets/sheet2.xml'] = strToU8(text.replace('<x:v>246.90</x:v>', ''));
  await assert.rejects(excerpt(xml, 'A25:C25'), /계산 결과/u);
  assert.deepEqual((await excerpt(xml, 'A25:B25')).rows, [['CF201 구조 | <검수>\n원문', '123.45']]);
});

test('CF201 qualified self-closing rows/cells do not shift addresses, and mismatched or duplicate cells are rejected', async () => {
  assert.deepEqual((await excerpt(parts(), 'A20:C27')).rows, [...Array.from({ length: 5 }, () => ['', '', '']), ...expected]);
  for (const [token, replacement] of [
    ['r="B25"', 'r="B26"'],
    ['<x:c r="C25">', '<x:c r="B25">'],
  ]) {
    const xml = parts(); const text = decode(xml['xl/worksheets/sheet2.xml']); assert.ok(text.includes(token));
    xml['xl/worksheets/sheet2.xml'] = strToU8(text.replace(token, replacement));
    await assert.rejects(excerpt(xml), /주소|중복/u);
  }
});

test('CF201 actual official-tool XLSX stays byte-exact and preserves qualified sparse source cells', async () => {
  const path = process.env.CF201_FIXTURE;
  assert.ok(path, 'CF201_FIXTURE must point to the preserved official-tool synthetic workbook; this proof cannot be skipped');
  const bytes = readFileSync(path);
  assert.equal(bytes.length, 4728);
  assert.equal(sha(bytes), '50da2468df74cd40e962122d9364c13b323544ee30b97148fe6f09120f76b0f0');
  const result = await readSpreadsheetExcerpt(new File([Uint8Array.from(bytes).buffer], 'CF200_SYNTHETIC_구조내역.xlsx'), 'A25:C27', '구조내역');
  assert.equal(result.range, 'A25:C27'); assert.equal(result.sheetName, '구조내역');
  assert.deepEqual(result.rows, [['CF200 구조 | <합성>\n시험 원문', '123.45', '246.9'], ['', '', ''], ['CF200 다음 합성 항목', '0', '']]);
  assert.equal(sha(readFileSync(path)), sha(bytes), 'No namespace rewrite or mutation of the actual workbook is allowed');
});

test('CF201 comments cannot create cells, while CDATA markup remains literal source text', async () => {
  const xml = parts(); const path = 'xl/worksheets/sheet2.xml';
  const fake = '<!-- <!DOCTYPE comment literal> <x:row r="25"><x:c r="B25"><x:v>999999</x:v></x:c></x:row> -->';
  xml[path] = strToU8(decode(xml[path]).replace('<x:sheetData>', '<x:sheetData>' + fake));
  assert.deepEqual((await excerpt(xml)).rows, expected);
  const literal = 'CF201 <x:c r="B25">9 & 0</x:c> <!DOCTYPE literal> <!ENTITY literal>';
  xml[path] = strToU8(decode(xml[path]).replace('다음 합성 항목 &amp;#10;', `<![CDATA[${literal}]]>`));
  const result = await excerpt(xml);
  assert.deepEqual(result.rows[0], expected[0]);
  assert.deepEqual(result.rows[2], [literal, '0', '']);
  const encoded = parts();
  encoded[path] = strToU8(decode(encoded[path]).replace('다음 합성 항목 &amp;#10;', '&lt;!DOCTYPE text literal&gt; &lt;!ENTITY text literal&gt;'));
  assert.deepEqual((await excerpt(encoded)).rows[2], ['<!DOCTYPE text literal> <!ENTITY text literal>', '0', '']);
});

test('CF201 single-quoted attributes and quoted greater-than signs cannot spoof namespace declarations', async () => {
  const xml = parts();
  for (const [path, bytes] of Object.entries(xml)) xml[path] = strToU8(decode(bytes).replaceAll('"', "'"));
  xml['xl/worksheets/sheet2.xml'] = strToU8(decode(xml['xl/worksheets/sheet2.xml']).replace("<x:c r='B25'", `<x:c note="literal > xmlns:fake='${MAIN}'" r='B25'`));
  assert.deepEqual((await excerpt(xml)).rows, expected);
  const malformed = parts();
  malformed['xl/worksheets/sheet2.xml'] = strToU8(decode(malformed['xl/worksheets/sheet2.xml']).replace('<x:c r="B25">', `<fake:c note="literal xmlns:fake='${MAIN}'" r="B25">`).replace('<x:v>123.45</x:v></x:c>', '<x:v>123.45</x:v></fake:c>'));
  await assert.rejects(excerpt(malformed));
});

test('CF201 same-URI nested redeclarations and newly declared child office aliases remain valid', async () => {
  const xml = parts();
  xml['xl/worksheets/sheet2.xml'] = strToU8(decode(xml['xl/worksheets/sheet2.xml']).replace('<x:sheetData>', `<x:sheetData xmlns:x="${MAIN}">`));
  xml['xl/sharedStrings.xml'] = strToU8(decode(xml['xl/sharedStrings.xml']).replace('<x:si>', `<x:si xmlns:x="${MAIN}">`));
  xml['xl/workbook.xml'] = strToU8(decode(xml['xl/workbook.xml']).replace('<x:sheet name="구조내역" o:id="two"/>', `<x:sheet xmlns:local="${OFFICE}" name="구조내역" local:id="two"/>`));
  assert.deepEqual((await excerpt(xml)).rows, expected);
});

test('CF201 child namespace aliases cannot leak into following siblings', async () => {
  const xml = parts();
  xml['xl/workbook.xml'] = strToU8(decode(xml['xl/workbook.xml'])
    .replace('<x:sheet name="기본" o:id="one"/>', `<x:sheet xmlns:local="${OFFICE}" name="기본" local:id="one"/>`)
    .replace('<x:sheet name="구조내역" o:id="two"/>', '<x:sheet name="구조내역" local:id="two"/>'));
  await assert.rejects(excerpt(xml));
  const rows = parts();
  rows['xl/worksheets/sheet2.xml'] = strToU8(decode(rows['xl/worksheets/sheet2.xml'])
    .replace('<x:row r="20"/>', `<local:row xmlns:local="${MAIN}" r="20"/>`)
    .replace('<x:row r="26"/>', '<local:row r="26"/>'));
  await assert.rejects(excerpt(rows));
});

test('CF201 foreign namespace cells and DTD/entity declarations cannot become selected data', async () => {
  const foreign = parts();
  foreign['xl/worksheets/sheet2.xml'] = strToU8(decode(foreign['xl/worksheets/sheet2.xml'])
    .replace('<x:c r="B25">', '<foreign:c xmlns:foreign="urn:cf201-foreign" r="B25">')
    .replace('<x:v>123.45</x:v></x:c>', '<x:v>123.45</x:v></foreign:c>'));
  await assert.rejects(excerpt(foreign));
  for (const declaration of ['<!DOCTYPE x:worksheet SYSTEM "https://invalid.example/never-fetch">', '<!DOCTYPE x:worksheet [<!ENTITY cf201 "999999">]>', '<!ENTITY cf201 "999999">']) {
    const xml = parts(); xml['xl/worksheets/sheet2.xml'] = strToU8(declaration + decode(xml['xl/worksheets/sheet2.xml']));
    await assert.rejects(excerpt(xml));
  }
});

test('CF201 worksheet relationships reject external, parent-path, non-worksheet and unknown TargetMode targets', async () => {
  const valid = parts(); const path = 'xl/_rels/workbook.xml.rels';
  valid[path] = strToU8(decode(valid[path]).replace('Id="two"', 'Id="two" TargetMode="Internal"'));
  assert.deepEqual((await excerpt(valid)).rows, expected);
  for (const [token, replacement] of [
    ['Target="worksheets/sheet2.xml"', 'Target="https://invalid.example/never-fetch"'],
    ['Target="worksheets/sheet2.xml"', 'Target="../worksheets/sheet2.xml"'],
    ['Id="two"', 'Id="two" TargetMode="External"'],
    ['Id="two"', 'Id="two" TargetMode="unknown"'],
    ['Id="two"', 'Id="two" TargetMode=""'],
    [`Type="${OFFICE}/worksheet" Target="worksheets/sheet2.xml"`, `Type="${OFFICE}/styles" Target="worksheets/sheet2.xml"`],
    [`Type="${OFFICE}/worksheet" Target="worksheets/sheet2.xml"`, 'Type="" Target="worksheets/sheet2.xml"'],
  ]) {
    const xml = parts(); const text = decode(xml[path]); assert.ok(text.includes(token));
    xml[path] = strToU8(text.replace(token, replacement)); await assert.rejects(excerpt(xml), { name: 'Error' }, replacement);
  }
});

test('CF201 qualified reserved attributes and multi-colon names cannot spoof ordinary cells or sheet relationships', async () => {
  const cases = [
    ['xl/worksheets/sheet2.xml', 'r="B25"', 'xmlns:foreign="urn:cf201-foreign" foreign:r="B25"'],
    ['xl/worksheets/sheet2.xml', 't="s"', 'xmlns:foreign="urn:cf201-foreign" foreign:t="s"'],
    ['xl/workbook.xml', 'name="구조내역"', 'xmlns:foreign="urn:cf201-foreign" foreign:name="구조내역"'],
    ['xl/_rels/workbook.xml.rels', 'Id="two"', 'xmlns:foreign="urn:cf201-foreign" foreign:Id="two"'],
    ['xl/_rels/workbook.xml.rels', 'Target="worksheets/sheet2.xml"', 'xmlns:foreign="urn:cf201-foreign" foreign:Target="worksheets/sheet2.xml"'],
    ['xl/_rels/workbook.xml.rels', `Type="${OFFICE}/worksheet" Target="worksheets/sheet2.xml"`, `xmlns:foreign="urn:cf201-foreign" foreign:Type="${OFFICE}/worksheet" Target="worksheets/sheet2.xml"`],
    ['xl/_rels/workbook.xml.rels', 'Id="two"', 'Id="two" xmlns:foreign="urn:cf201-foreign" foreign:TargetMode="External"'],
    ['xl/workbook.xml', 'o:id="two"', 'o:another:id="two"'],
  ];
  for (const [path, token, replacement] of cases) {
    const xml = parts(); const text = decode(xml[path]); assert.ok(text.includes(token));
    xml[path] = strToU8(text.replace(token, replacement)); await assert.rejects(excerpt(xml), { name: 'Error' }, replacement);
  }
});

test('CF201 hyphen-suffixed attributes are not substitutes for exact cell, sheet or relationship attributes', async () => {
  for (const [path, token, replacement, range] of [
    ['xl/worksheets/sheet2.xml', 'r="A25"', 'data-r="A25"', 'A25:A25'],
    ['xl/workbook.xml', 'name="구조내역"', 'data-name="구조내역"', 'A25:C27'],
    ['xl/_rels/workbook.xml.rels', 'Target="worksheets/sheet2.xml"', 'data-Target="worksheets/sheet2.xml"', 'A25:C27'],
    ['xl/_rels/workbook.xml.rels', 'Id="two"', 'data-Id="two"', 'A25:C27'],
  ]) {
    const xml = parts(); const text = decode(xml[path]); assert.ok(text.includes(token));
    xml[path] = strToU8(text.replace(token, replacement));
    await assert.rejects(excerpt(xml, range), { name: 'Error' }, replacement);
  }
});

test('CF201 fake row data-r does not override the existing fallback to real cell addresses', async () => {
  const xml = parts(); const path = 'xl/worksheets/sheet2.xml';
  const text = decode(xml[path]); assert.ok(text.includes('<x:row r="25">'));
  xml[path] = strToU8(text.replace('<x:row r="25">', '<x:row data-r="99">'));
  assert.deepEqual((await excerpt(xml)).rows, expected, 'The actual A25/B25/C25 addresses identify row 25; data-r=99 is not an address');
  await assert.rejects(excerpt(xml, 'A99:C99'), /값이 없습니다/u);
});

test('CF201 duplicate plain r and duplicate expanded office ID aliases are rejected', async () => {
  for (const [path, token, replacement] of [
    ['xl/worksheets/sheet2.xml', '<x:row r="25">', '<x:row r="25" r="99">'],
    ['xl/worksheets/sheet2.xml', 'r="A25"', 'r="A25" r="B25"'],
    ['xl/workbook.xml', '<x:sheet name="구조내역" o:id="two"/>', `<x:sheet xmlns:local="${OFFICE}" name="구조내역" o:id="two" local:id="one"/>`],
  ]) {
    const xml = parts(); const text = decode(xml[path]); assert.ok(text.includes(token));
    xml[path] = strToU8(text.replace(token, replacement)); await assert.rejects(excerpt(xml), { name: 'Error' }, replacement);
  }
});

test('CF201 sheet-foo and c-data names cannot be consumed as sheet and cell tags', async () => {
  const sheets = parts();
  sheets['xl/workbook.xml'] = strToU8(decode(sheets['xl/workbook.xml']).replace('<x:sheet name="구조내역"', '<x:sheet-foo name="구조내역"'));
  await assert.rejects(excerpt(sheets), /시트/u);
  const cells = parts();
  cells['xl/worksheets/sheet2.xml'] = strToU8(decode(cells['xl/worksheets/sheet2.xml'])
    .replace('<x:c r="A25" t="s">', '<x:c-data r="A25" t="s">')
    .replace('<x:v>0</x:v></x:c>', '<x:v>0</x:v></x:c-data>'));
  await assert.rejects(excerpt(cells, 'A25:A25'), /값이 없습니다/u);
});
