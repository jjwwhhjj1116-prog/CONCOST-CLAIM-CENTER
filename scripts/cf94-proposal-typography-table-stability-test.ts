import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transpileModule, ScriptTarget } from 'typescript';
import { inferredTableColumnWeight, normalizeColumnWidths } from '../apps/web/src/documents/structured-document-layout';

const read = (path: string): string => readFileSync(path, 'utf8');

test('CF183 table migration aligns merged header logical columns and preserves explicit saved alignment', () => {
  const editor = read('apps/web/src/documents/StructuredDocumentEditor.tsx');
  const source = editor.slice(editor.indexOf('const rightAlignedTableHeader ='), editor.indexOf('export const normalizeStructuredDocumentHtml =')).replace('export const normalizeA4TableJson', 'const normalizeA4TableJson');
  const compiled = transpileModule(source + '\nnormalizeA4TableJson;', { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
  const normalize = runInNewContext(compiled, { inferredTableColumnWeight, normalizeColumnWidths });
  const cell = (text: string, attrs = {}) => ({ type: 'tableCell', attrs, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const row = (cells: unknown[]) => ({ type: 'tableRow', content: cells });
  const table = { type: 'table', attrs: { documentDefaultsVersion: 1 }, content: [row([cell('설명', { colspan: 2 }), cell('금액')]), row([cell('첫 설명'), cell('둘째 설명'), cell('미산정')])] };
  const before = JSON.stringify(table), result = normalize(table);
  assert.deepEqual(Array.from(result.content[1].content, (value: any) => value.attrs.horizontalAlignment), ['center', 'center', 'right']);
  assert.equal(JSON.stringify(table), before, 'Normalizing must not mutate the caller document');
  const spanning = { type: 'table', attrs: { documentDefaultsVersion: 1 }, content: [row([cell('구분', { rowspan: 2 }), cell('금액', { colspan: 2 })]), row([cell('미산정A'), cell('미산정B')]), row([cell('항목'), cell('미산정C'), cell('미산정D')])] };
  const aligned = normalize(spanning);
  assert.deepEqual(Array.from(aligned.content[1].content, (value: any) => value.attrs.horizontalAlignment), ['right', 'right']);
  assert.deepEqual(Array.from(aligned.content[2].content, (value: any) => value.attrs.horizontalAlignment), ['center', 'right', 'right']);
  const explicit = { ...table, attrs: { documentDefaultsVersion: 2 }, content: [table.content[0], row([cell('첫 설명', { horizontalAlignment: 'left' }), cell('둘째 설명', { horizontalAlignment: 'right' }), cell('미산정', { horizontalAlignment: 'center' })])] };
  assert.deepEqual(Array.from(normalize(explicit).content[1].content, (value: any) => value.attrs.horizontalAlignment), ['left', 'right', 'center']);
});

test('CF94 infers practical widths for an unmeasured chapter 9 result table', () => {
  const headers = ['No', '발주자·현장 법무법인', '현장명', '연면적(㎡)', '업무내용'];
  const longestValues = [2, 24, 20, 8, 34];
  const inferred = headers.map((header, index) => inferredTableColumnWeight(header, longestValues[index]));
  const result = normalizeColumnWidths([0, 0, 0, 0, 0], 100, inferred);
  assert.equal(result.repaired, true);
  assert.ok(result.widths[0] < 10, 'No 열은 좁게 유지해야 한다.');
  assert.ok(result.widths[3] >= 10 && result.widths[3] <= 18, '연면적 열은 숫자를 읽을 수 있는 폭이어야 한다.');
  assert.ok(result.widths[4] > 30, '업무내용 열이 가장 넓어야 한다.');
  assert.ok(Math.abs(result.widths.reduce((sum, width) => sum + width, 0) - 100) < 0.001);
});

test('CF94 does not rewrite healthy saved table proportions on selection', () => {
  const widths = [48, 160, 140, 95, 230];
  const result = normalizeColumnWidths(widths, widths.reduce((sum, width) => sum + width, 0));
  assert.equal(result.repaired, false);
  assert.deepEqual(result.widths, widths);
});

test('CF94 separates A4 prose and table type roles and exposes selection formatting', () => {
  const editor = read('apps/web/src/documents/StructuredDocumentEditor.tsx');
  const editorCss = read('apps/web/src/documents/StructuredDocumentEditor.css');
  const theme = read('apps/web/src/theme-system.css');
  assert.match(editorCss, /is-a4-portrait[^}]*font-size:16px/u);
  assert.match(editorCss, /is-a4-portrait[^}]*h2[^}]*font-size:24px/u);
  assert.match(editorCss, /tiptap th,.structured-editor \.tiptap td[^}]*font-size:12px/u);
  assert.match(theme, /proposal-final-chapter \.proposal-rich-content\{[^}]*font-size:16px/u);
  assert.match(theme, /proposal-final-chapter \.proposal-rich-content h1[^}]*font-size:24px/u);
  assert.match(editor, /aria-label="선택 영역 글꼴"/u);
  assert.match(editor, /aria-label="선택 영역 글자 크기"/u);
  assert.match(editor, /aria-label="선택 영역 글자 색상"/u);
  assert.match(editor, /현재 위치에 빈 줄 삽입/u);
});
