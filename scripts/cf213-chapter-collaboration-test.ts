import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test, { after } from 'node:test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import initSqlJs, { type Database } from 'sql.js';
import currentWorker, { type CloudflareEnv } from '../apps/cloudflare/src/index';
import type { JSONContent as ReportNode } from '@tiptap/core';
import { reportNativeBodySha256 } from '../apps/web/src/documents/report-native-source';

// Only the real Worker against this process's owned, synthetic in-memory DB.
// Neither authenticated browser IO, a remote DB nor a real provider is allowed.
const ADMIN = '21300000-0000-4000-8000-000000000001', PM = '21300000-0000-4000-8000-000000000002';
const STAFF = '21300000-0000-4000-8000-000000000003', OTHER = '21300000-0000-4000-8000-000000000004';
const CASE = '21300000-0000-4000-8000-000000000010', OTHER_CASE = '21300000-0000-4000-8000-000000000011';
const token = (id: string) => `CF213_SYNTHETIC_SESSION_${id}`;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const originalFetch = globalThis.fetch;
let externalCalls = 0;
const blockedFetch: typeof fetch = async () => { externalCalls++; throw new Error('CF213 forbids external fetch'); };
globalThis.fetch = blockedFetch;
after(() => { globalThis.fetch = originalFetch; assert.equal(externalCalls, 0); });
const worker: typeof currentWorker = process.env.CF213_BEFORE === '1' ? (() => {
  const source = execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, 'show', 'a49b7a2:apps/cloudflare/src/index.ts'], { encoding: 'utf8' });
  assert.ok(source.includes('draft_editor_json=NULL'), 'Before must be the actual CF212 index, not an invented broken implementation');
  const output = transpileModule(source, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} as { default: typeof currentWorker } };
  const sharedSource = execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, 'show', 'a49b7a2:packages/document-engine/src/report-chapter.ts'], { encoding: 'utf8' });
  const sharedModule = { exports: {} };
  runInNewContext(transpileModule(sharedSource, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS } }).outputText, { module: sharedModule, exports: sharedModule.exports, Error }, { filename: 'cf213-actual-before-chapter.js' });
  const nativeRequire = createRequire(resolve('apps/cloudflare/src/index.ts'));
  const beforeRequire = (id: string) => id.endsWith('/report-chapter') ? sharedModule.exports : nativeRequire(id);
  runInNewContext(output, { module, exports: module.exports, require: beforeRequire, console, crypto, fetch: blockedFetch, Request, Response, Headers, URL, Blob, File, FormData, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, AbortController, AbortSignal, ReadableStream, TransformStream, DecompressionStream, btoa, atob, setTimeout, clearTimeout, Buffer, Error }, { filename: 'cf213-actual-before-index.js' });
  return module.exports.default;
})() : currentWorker;

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: Database, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { const s = this.db.prepare(this.sql); try { s.bind(this.values as never[]); return s.step() ? s.getAsObject() as T : null; } finally { s.free(); } }
  async all<T>() { const s = this.db.prepare(this.sql), results: T[] = []; try { s.bind(this.values as never[]); while (s.step()) results.push(s.getAsObject() as T); return { results }; } finally { s.free(); } }
  async run() { this.db.run(this.sql, this.values as never[]); return { success: true, meta: { changes: this.db.getRowsModified() } }; }
}
class D1 {
  constructor(readonly db: Database) {}
  prepare(sql: string) { return new Statement(this.db, sql); }
  async batch(statements: Statement[]) { this.db.run('BEGIN IMMEDIATE'); try { const results = []; for (const statement of statements) results.push(await statement.run()); this.db.run('COMMIT'); return results; } catch (reason) { this.db.run('ROLLBACK'); throw reason; } }
}
const marker = (code: string, edge: 'START' | 'END'): ReportNode => ({ type: 'aiChapterMarker', attrs: { marker: `MANUAL-CHAPTER:${code}:${edge}` } });
const paragraph = (text: string): ReportNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const image: ReportNode = { type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ioAAAAASUVORK5CYII=', alt: 'CF213 고객 없는 합성 사진', width: 120, height: 60, imageAlign: 'right', assetKey: 'CF213-SYNTHETIC-PHOTO' } };
const table: ReportNode = { type: 'table', attrs: { tableWidth: '80', tableAlign: 'center' }, content: [{ type: 'tableRow', content: [
  { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [180] }, content: [paragraph('CF213 <합성>\n원문')] },
  { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [120] }, content: [paragraph('0')] }
] }] };
const richChapter = (code: string, title: string): ReportNode => ({ type: 'doc', content: [marker(code, 'START'), { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `${code} ${title}` }] }, { type: 'paragraph', attrs: { textAlign: 'right' }, content: [{ type: 'text', text: 'CF213 합성 검수 원고', marks: [{ type: 'bold' }, { type: 'underline' }] }] }, image, table, marker(code, 'END')] });
const TEXT = 'CF213 합성 검수 원고';
type Chapter = { id: string; chapterCode: string; title: string };
const snapshot = (db: Database) => ['preview_report_drafts', 'preview_report_revisions', 'preview_report_chapter_assignments', 'preview_report_chapter_revisions', 'preview_case_activities'].map(name => db.exec(`SELECT * FROM ${name} ORDER BY rowid`));

async function fixture() {
  const SQL = await initSqlJs(), db = new SQL.Database(); db.run('PRAGMA foreign_keys=ON');
  const directory = resolve('apps/cloudflare/migrations');
  const read = (name: string) => readFileSync(resolve(directory, name), 'utf8');
  const initial = ['0001_cf_foundation.sql', '0001_cf02_preview_drafts.sql', '0002_cf03_preview_evidence.sql', '0003_cf04_preview_auth.sql'];
  for (const name of initial) db.exec(read(name));
  const now = new Date().toISOString();
  db.run('INSERT INTO preview_users VALUES (?,?,?,?,?,?,?,?,1,?)', [ADMIN, 'cf213-admin', '1'.repeat(32), '2'.repeat(64), 100000, 'CF213 합성 관리자', 'cf213-admin@example.invalid', '["admin"]', now]);
  for (const name of readdirSync(directory).filter(name => /^\d{4}_.*\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 59 && !initial.includes(name)).sort()) db.exec(read(name));
  for (const [id, role] of [[PM, 'pm'], [STAFF, 'staff'], [OTHER, 'staff']] as const) db.run('INSERT INTO preview_users (id,login_id,password_salt,password_hash,password_iterations,display_name,email,roles_json,is_active,created_at,version) VALUES (?,?,?,?,?,?,?,?,1,?,1)', [id, `cf213-${role}-${id.slice(-1)}`, '3'.repeat(32), '4'.repeat(64), 100000, id === PM ? '현동명' : `CF213 합성 ${role}`, `cf213-${id.slice(-1)}@example.invalid`, JSON.stringify([role]), now]);
  for (const id of [ADMIN, PM, STAFF, OTHER]) db.run('INSERT INTO preview_sessions VALUES (?,?,?,?)', [sha(token(id)), id, now, '2099-01-01T00:00:00.000Z']);
  for (const [id, number] of [[CASE, 'CF213-CASE'], [OTHER_CASE, 'CF213-OTHER-CASE']]) db.run('INSERT INTO preview_cases (id,organization_id,case_number,title,claim_type,status,version,category_major,category_middle,category_minor,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, 'concost', number, 'CF213 고객 없는 합성 협업 사건', 'TYPE-01', 'INQUIRY', 1, '클레임', '합성', '검수', ADMIN, now, now]);
  for (const id of [PM, STAFF, OTHER]) db.run('INSERT INTO preview_case_assignments VALUES (?,?,?,?)', [CASE, id, ADMIN, now]);
  db.run('INSERT INTO preview_project_schedule_profiles (case_id,organization_id,responsible_pm_id,version,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [CASE, 'concost', PM, 1, ADMIN, now, now]);
  const env: CloudflareEnv = { DB: new D1(db) as unknown as NonNullable<CloudflareEnv['DB']> };
  const call = (path: string, method = 'GET', body?: unknown, actor = PM) => worker.fetch(new Request(`https://cf213.example.invalid${path}`, { method, headers: { 'X-Session-Token': token(actor), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
  const configResponse = await call(`/api/report-authoring/config?caseId=${CASE}`); assert.equal(configResponse.status, 200, await configResponse.clone().text());
  const chapters = ((await configResponse.json()) as { chapters: Chapter[] }).chapters;
  assert.ok(chapters.length >= 2);
  const path = `/api/report-chapter-collaboration?caseId=${CASE}`, chapter = chapters[0], other = chapters[1];
  const assigned = await call(path, 'PUT', { chapterId: chapter.id, assigneeId: STAFF, expectedVersion: 0 }); assert.equal(assigned.status, 200, await assigned.clone().text());
  const original: ReportNode = { type: 'doc', attrs: { reportHeader: { enabled: true, text: 'CF213 머리말 원문' }, reportFrontMatter: { enabled: true, date: '2026-10-13', author: '합성 작성자' } }, content: [...richChapter(chapter.chapterCode, chapter.title).content!.map(node => node.type === 'paragraph' ? paragraph('기존 교체 대상') : node), ...richChapter(other.chapterCode, other.title).content!] };
  const saveReport = (doc = original, expectedVersion = 0, content = '기존 보고서 원문') => call(`/api/report-drafts?caseId=${CASE}`, 'PUT', { title: 'CF213 합성 보고서', content, editorJson: doc, expectedVersion, wizardStep: 4, selectedChapterId: chapter.id, saveKind: 'MANUAL' });
  const saved = await saveReport(); assert.equal(saved.status, 200, await saved.clone().text());
  const post = (action: string, expectedVersion: number, draftEditorJson: ReportNode | undefined = richChapter(chapter.chapterCode, chapter.title), actor = STAFF, expectedReportVersion = 1) => call(path, 'POST', { action, chapterId: chapter.id, draftText: TEXT, draftEditorJson, expectedVersion, expectedReportVersion }, actor);
  return { db, call, path, post, chapter, other, original, saveReport };
}

test('CF213 real Worker saves, reopens, submits and merges the exact own-chapter rich JSON; unrelated chapter and front matter are unchanged', async () => {
  const f = await fixture();
  try {
    const incoming = richChapter(f.chapter.chapterCode, f.chapter.title);
    incoming.content![1].attrs = {level:2,textAlign:'right'};
    assert.equal((await f.post('SAVE', 1, incoming)).status, 200);
    const read = await f.call(f.path, 'GET', undefined, STAFF); assert.equal(read.status, 200);
    const assignment = ((await read.json()) as { assignments: Array<{ draftEditorJson: ReportNode; version: number }> }).assignments[0];
    assert.deepEqual(assignment.draftEditorJson, incoming, 'Own rich text, image and table must survive SAVE→GET, not become NULL');
    assert.equal(assignment.version, 2);
    assert.equal((await f.post('MARK_READY', 2, incoming)).status, 200);
    const applied = await f.call(f.path, 'POST', { action: 'APPLY', chapterId: f.chapter.id, draftText: TEXT, expectedVersion: 3, expectedReportVersion: 1 }, PM);
    assert.equal(applied.status, 200, await applied.clone().text());
    const report = f.db.exec('SELECT editor_json,version FROM preview_report_drafts WHERE case_id=?', [CASE])[0].values[0];
    const merged = JSON.parse(String(report[0])) as ReportNode;
    assert.equal(report[1], 2);
    assert.deepEqual(merged.attrs, f.original.attrs);
    assert.deepEqual(merged.content, [incoming.content![0],f.original.content![1],...incoming.content!.slice(2), ...richChapter(f.other.chapterCode, f.other.title).content!], 'The submitted body is exact, while the official current heading is not silently reformatted');
    const reportRevision = f.db.exec('SELECT editor_json FROM preview_report_revisions WHERE case_id=? AND version=2', [CASE])[0].values[0][0];
    assert.deepEqual(JSON.parse(String(reportRevision)), merged);
    const chapters = f.db.exec('SELECT version,status,draft_editor_json FROM preview_report_chapter_revisions ORDER BY version')[0].values;
    assert.deepEqual(chapters.map(row => [row[0], row[1]]), [[2, 'IN_PROGRESS'], [3, 'READY'], [4, 'APPLIED']]);
    for (const row of chapters) assert.deepEqual(JSON.parse(String(row[2])), incoming);
    assert.deepEqual(f.db.exec('PRAGMA foreign_key_check'), []);
  } finally { f.db.close(); }
});

test('CF213 assigned staff edits only their chapter; missing assignment, other case and stale versions cannot write', async () => {
  const f = await fixture();
  try {
    const unchanged = snapshot(f.db);
    const otherRead = await f.call(f.path, 'GET', undefined, OTHER);
    assert.equal(otherRead.status, 200);
    const otherAssignment = ((await otherRead.json()) as { assignments: Array<{ canEdit: boolean; draftText: string; draftEditorJson: unknown }> }).assignments[0];
    assert.equal(otherAssignment.canEdit, false); assert.equal(otherAssignment.draftText, ''); assert.equal(otherAssignment.draftEditorJson, null);
    assert.equal((await f.post('SAVE', 1, undefined, OTHER)).status, 403);
    assert.equal((await f.call(f.path, 'PUT', { chapterId: f.other.id, assigneeId: OTHER, expectedVersion: 0 }, STAFF)).status, 403);
    assert.equal((await f.call(`/api/report-drafts?caseId=${CASE}`, 'PUT', { title: '금지', content: '금지', expectedVersion: 1 }, STAFF)).status, 403);
    assert.equal((await f.call(`/api/report-chapter-collaboration?caseId=${OTHER_CASE}`, 'GET', undefined, STAFF)).status, 404);
    assert.equal((await f.call(f.path, 'POST', { action: 'SAVE', chapterId: f.other.id, draftText: TEXT, expectedVersion: 0, expectedReportVersion: 1 }, STAFF)).status, 409);
    assert.equal((await f.post('SAVE', 0)).status, 409);
    assert.equal((await f.post('APPLY', 1, undefined, PM)).status, 409);
    const wrong = richChapter(f.other.chapterCode, f.other.title);
    assert.equal((await f.post('SAVE', 1, wrong)).status, 400, 'A staff member cannot embed another chapter boundary in their assigned rich draft');
    const duplicate = richChapter(f.chapter.chapterCode, f.chapter.title); duplicate.content!.splice(2, 0, marker(f.chapter.chapterCode, 'START'));
    assert.equal((await f.post('MARK_READY', 1, duplicate)).status, 400);
    for(const invalid of [
      {type:'doc',content:[{type:'blockquote',content:richChapter(f.chapter.chapterCode,f.chapter.title).content}]},
      {type:'doc',content:[paragraph('잘못된 외부 앞 원고'),...richChapter(f.chapter.chapterCode,f.chapter.title).content!]},
      {type:'doc',content:[...richChapter(f.chapter.chapterCode,f.chapter.title).content!,paragraph('잘못된 외부 뒤 원고')]}
    ])assert.equal((await f.post('SAVE',1,invalid)).status,400,'Boundary markers must be the unique first/last top-level nodes, not nested or surrounded by unowned text');
    assert.deepEqual(snapshot(f.db), unchanged);
    assert.equal((await f.post('SAVE', 1)).status, 200);
    const saved = snapshot(f.db);
    assert.equal((await f.post('MARK_READY', 1)).status, 409);
    assert.deepEqual(snapshot(f.db), saved);
  } finally { f.db.close(); }
});

test('CF213 submitted READY JSON is canonical: same-text formatting, image or table tampering at APPLY is refused atomically', async () => {
  const f = await fixture();
  try {
    const incoming = richChapter(f.chapter.chapterCode, f.chapter.title);
    assert.equal((await f.post('MARK_READY', 1, incoming)).status, 200);
    for (const field of ['formatting', 'image', 'table'] as const) {
      const altered = structuredClone(incoming);
      if (field === 'formatting') altered.content![2].attrs = { textAlign: 'left' };
      if (field === 'image') altered.content![3].attrs!.width = 121;
      if (field === 'table') altered.content![4].content![0].content![1].content = [paragraph('1')];
      const before = snapshot(f.db), response = await f.post('APPLY', 2, altered, PM);
      assert.ok([400, 409].includes(response.status), `${field}: ${response.status} ${await response.clone().text()}`);
      assert.deepEqual(snapshot(f.db), before, `${field} must not create any report/chapter revision or activity`);
    }
  } finally { f.db.close(); }
});

test('CF213 whole imports and bound native originals cannot gain an unlocated appended collaboration chapter', async () => {
  for (const native of [false, true]) {
    const f = await fixture();
    try {
      const doc: ReportNode = native ? { type: 'doc', attrs: { reportNativeSource: { caseId: CASE, evidenceId: '21300000-0000-4000-8000-000000000099', name: 'CF213-synthetic-original.hwp', downloadUrl: '/api/cases/evidence/21300000-0000-4000-8000-000000000099/download', byteSize: 128, sha256: 'a'.repeat(64), bindingVersion: 1 } }, content: [{ type: 'image', attrs: { src: '/cf213-original-page.svg', width: 794, height: 1123, reportSourcePage: true } }] } : { type: 'doc', content: [{ type: 'aiChapterMarker', attrs: { marker: 'MANUAL-WHOLE-DOCUMENT:START' } }, paragraph('CF213 원형 전체 원문'), { type: 'aiChapterMarker', attrs: { marker: 'MANUAL-WHOLE-DOCUMENT:END' } }] };
      if (native) doc.attrs!.reportNativeSource.bodySha256 = await reportNativeBodySha256(doc);
      assert.equal((await f.saveReport(doc, 1)).status, 200);
      assert.equal((await f.post('MARK_READY', 1, undefined, STAFF, 2)).status, 200);
      const before = snapshot(f.db), response = await f.post('APPLY', 2, richChapter(f.chapter.chapterCode, f.chapter.title), PM, 2);
      assert.equal(response.status, 409, `${native ? 'native' : 'whole'}: ${await response.clone().text()}`);
      assert.deepEqual(snapshot(f.db), before, 'No guessed chapter boundary may mutate the stored original or its proof');
    } finally { f.db.close(); }
  }
});

test('CF213 an ordinary whole import uses a unique real H2 range instead of appending; unrelated rich nodes and original heading stay exact', async () => {
  const f = await fixture();
  try {
    const firstHeading: ReportNode = { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: f.chapter.title, marks: [{ type: 'underline' }] }] };
    const otherHeading: ReportNode = { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: f.other.title }] };
    const start: ReportNode = { type: 'aiChapterMarker', attrs: { marker: 'MANUAL-WHOLE-DOCUMENT:START' } }, end: ReportNode = { type: 'aiChapterMarker', attrs: { marker: 'MANUAL-WHOLE-DOCUMENT:END' } };
    const doc: ReportNode = { type: 'doc', content: [start, firstHeading, paragraph('CF213 교체할 기존 원문'), otherHeading, paragraph('CF213 다른 장 원문 보존'), image, table, end] };
    const content = `<!-- MANUAL-WHOLE-DOCUMENT:START -->\n## ${f.chapter.title}\n\nCF213 교체할 기존 원문\n\n## ${f.other.title}\n\nCF213 다른 장 원문 보존\n<!-- MANUAL-WHOLE-DOCUMENT:END -->`;
    assert.equal((await f.saveReport(doc, 1, content)).status, 200);
    const incoming = richChapter(f.chapter.chapterCode, f.chapter.title);
    assert.equal((await f.post('MARK_READY', 1, incoming, STAFF, 2)).status, 200);
    const applied = await f.post('APPLY', 2, incoming, PM, 2);
    assert.equal(applied.status, 200, await applied.clone().text());
    const saved = f.db.exec('SELECT editor_json,content FROM preview_report_drafts WHERE case_id=?', [CASE])[0].values[0];
    const expected = [start, marker(f.chapter.chapterCode, 'START'), firstHeading, ...incoming.content!.slice(2), otherHeading, paragraph('CF213 다른 장 원문 보존'), image, table, end];
    assert.deepEqual((JSON.parse(String(saved[0])) as ReportNode).content, expected);
    assert.doesNotMatch(String(saved[1]), /CF213 교체할 기존 원문/u);
    assert.match(String(saved[1]), /CF213 다른 장 원문 보존/u);
    assert.equal((String(saved[1]).match(/MANUAL-CHAPTER:CH-01:START/gu) ?? []).length, 1);
    assert.equal((String(saved[1]).match(/MANUAL-WHOLE-DOCUMENT:END/gu) ?? []).length, 1);
  } finally { f.db.close(); }
});
