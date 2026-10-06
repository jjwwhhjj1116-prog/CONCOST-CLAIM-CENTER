import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transpileModule, ScriptTarget } from 'typescript';
import { joinReportPresentation, splitReportPresentation } from '../packages/document-engine/src/report-presentation';

const source = readFileSync('apps/web/src/routes/PreviewReportStudio.tsx', 'utf8');
const start = source.indexOf('const qaCanReadSavedDraft =');
const end = source.indexOf('const importSavedReportTemplate =');
assert.ok(start > 0 && end > start);
const compiled = transpileModule(source.slice(start, end) + '\nglobalThis.qa = { loadQaSnapshot, downloadQaReport, qaDraftIsCurrent };', { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
const readyStart = source.indexOf('const qaReady =');
const readyEnd = source.indexOf('const qaReadyRef =');
const ready = transpileModule(source.slice(readyStart, readyEnd) + '\nglobalThis.ready = qaReady;', { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
const ref = <T>(current: T) => ({ current });

function fixture() {
  const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '검수용 합성 본문' }] }] };
  const header = { enabled: false, text: null }, frontMatter = { enabled: false, date: '', author: '' };
  const draft = { caseId: 'qa-case', title: '검수 제목', content: '검수용 합성 본문', editorJson: joinReportPresentation(json, header, frontMatter), version: 5, wizardStep: 4, selectedChapterId: null, updatedAt: '2026-10-06T04:11:19.766Z' };
  const requests: string[] = [], exports: any[] = [], downloads: string[] = [];
  let gate: Promise<void> | null = null, exportGate: Promise<void> | null = null;
  const context: any = {
    Number, Date, JSON, Error, encodeURIComponent, joinReportPresentation, splitReportPresentation,
    roles: ['admin'], selectedCaseId: 'qa-case', loadedCaseId: 'qa-case', version: 5, content: draft.content,
    loading: false, dirty: false, workspaceDirty: false, saveError: '', saving: false, outlineDirty: false, chaptersDirty: false, outlineSyncPending: false, generating: false, improving: false, linkingHwp: false, chapterBusy: '', submittingReview: false,
    selectedCase: { id: 'qa-case', caseNumber: 'QA-6', title: '시험 사건' },
    chapterCollaboration: { assignments: [{ chapterId: 'qa-chapter', canEdit: true }] }, chapterDraftsRef: ref({ 'qa-chapter': '' }), chapterSavedRef: ref({ 'qa-chapter': '' }),
    selectedCaseRef: ref('qa-case'), versionRef: ref(5), titleRef: ref('검수 제목'), contentRef: ref(draft.content),
    editorJsonRef: ref(json), reportHeaderRef: ref(header), reportFrontMatterRef: ref(frontMatter), loadSequence: ref(1), activeStepRef: ref(4), selectedChapterRef: ref(''),
    qaReadyRef: ref(true), qaSnapshotRef: ref(null), qaPreviewRef: ref({ isConnected: true, querySelector: () => null }), qaExportInFlight: ref(false),
    dirtyRef: ref(false), workspaceDirtyRef: ref(false), outlineDirtyRef: ref(false), saveErrorRef: ref(''),
    draftSaveInFlight: ref(false), outlineSaveInFlight: ref(false), outlineSyncPendingRef: ref(false), pageImportInFlight: ref(false), generationInFlight: ref(false), chapterSaveInFlight: ref(false), linkingHwpRef: ref(false),
    setQaSnapshot: (value: unknown) => { context.snapshot = value; }, setQaExportBusy: (value: boolean) => { context.busy = value; },
    setQaExportError: (value: string) => { context.error = value; }, setQaExportMessage: (value: string) => { context.message = value; },
    apiRequest: async (url: string, options?: unknown) => { assert.equal(options, undefined, 'QA must only read, never submit approval or save'); requests.push(url); if (gate) await gate; return { draft: structuredClone(draft) }; },
    downloadFinalDocument: async (options: any) => { exports.push(options); if (exportGate) await exportGate; if (!options.reportNativeSnapshot.isCurrent()) throw new Error('저장본 변경'); downloads.push(options.format); return { fileName: options.fileName + '.' + options.format, pageCount: 1 }; }
  };
  runInNewContext(compiled, context);
  return { context, draft, requests, exports, downloads, holdRead: (promise: Promise<void>) => { gate = promise; }, holdExport: (promise: Promise<void>) => { exportGate = promise; } };
}

test('CF182 production QA readiness refuses non-admin, unsaved and busy states', async () => {
  for (const [key, value] of [['roles', ['pm']], ['version', 0], ['loadedCaseId', 'another'], ['content', ''], ...['loading','dirty','workspaceDirty','saving','outlineDirty','chaptersDirty','outlineSyncPending','generating','improving','linkingHwp','submittingReview'].map(key => [key, true]), ['saveError','오류'], ['chapterBusy','busy']] as const) {
    const { context, requests } = fixture(); context[key as string] = value;
    runInNewContext(ready, context); assert.equal(context.ready, false, String(key)); context.qaReadyRef.current = context.ready;
    await context.qa.loadQaSnapshot(); assert.equal(requests.length, 0, String(key));
  }
  for (const key of ['dirtyRef','workspaceDirtyRef','outlineDirtyRef','saveErrorRef','draftSaveInFlight','outlineSaveInFlight','outlineSyncPendingRef','pageImportInFlight','generationInFlight','chapterSaveInFlight','linkingHwpRef']) {
    const { context, requests } = fixture(); context[key].current = true;
    await context.qa.loadQaSnapshot(); assert.equal(requests.length, 0, key + ' must guard before the next React render');
  }
  const pendingChapter = fixture(); pendingChapter.context.chapterDraftsRef.current['qa-chapter'] = '미저장 협업 원고';
  await pendingChapter.context.qa.loadQaSnapshot(); assert.equal(pendingChapter.requests.length, 0, 'Pending collaboration text must block before React rerenders');
});

test('CF182 production QA rejects malformed or mismatched saved responses', async () => {
  for (const [key, value] of [['caseId','another'],['version',6],['version',0],['version',5.5],['updatedAt',0],['updatedAt','invalid'],['title',null],['title','changed'],['content',null],['content','changed'],['editorJson',[]],['editorJson','bad'],['editorJson',undefined],['editorJson',{type:'doc',content:[]}],['wizardStep',5],['selectedChapterId','another']] as const) {
    const { context, draft, exports } = fixture(); (draft as any)[key] = value;
    await context.qa.loadQaSnapshot(); assert.equal(context.qaSnapshotRef.current, null, String(key)); assert.ok(context.error, String(key)); assert.equal(exports.length, 0); assert.equal(context.qaExportInFlight.current, false);
  }
});

test('CF182 production QA keeps saved data separate and exports three unapproved formats without approval writes', async () => {
  const { context, draft, requests, exports, downloads } = fixture();
  await context.qa.loadQaSnapshot(); const snapshot = context.qaSnapshotRef.current;
  assert.notEqual(snapshot.document.editorJson, draft.editorJson); assert.deepEqual(snapshot.document.editorJson, draft.editorJson);
  const before = JSON.stringify(snapshot);
  for (const format of ['docx','pdf','hwp']) await context.qa.downloadQaReport(format);
  assert.deepEqual(downloads, ['docx','pdf','hwp']); assert.equal(requests.length, 1); assert.match(requests[0], /^\/api\/report-drafts\?caseId=qa-case$/);
  for (const options of exports) { assert.equal(options.purpose, 'ADMIN_QA'); assert.equal(options.orientation, 'portrait'); assert.match(options.fileName, /미승인_관리자검수용_v5/); assert.equal(options.reportNativeSnapshot.document, snapshot.document.editorJson); }
  assert.equal(JSON.stringify(snapshot), before); assert.equal(JSON.stringify(draft.editorJson), JSON.stringify(snapshot.document.editorJson));
  assert.equal(context.qaExportInFlight.current, false); assert.match(context.message, /제출·납품용이 아닙니다/);
});

test('CF182 production QA rejects races during GET and before all-format download completion', async () => {
  for (const [key, value] of [['selectedCaseRef','another'],['versionRef',6],['titleRef','changed'],['contentRef','changed'],['editorJsonRef',{type:'doc',content:[]}],['reportFrontMatterRef',{enabled:true,date:'',author:''}],['activeStepRef',5],['selectedChapterRef','changed'],['loadSequence',2],['dirtyRef',true],['outlineDirtyRef',true]] as const) {
    const f = fixture(); let release = () => {}; f.holdRead(new Promise<void>(resolve => { release = resolve; }));
    const reading = f.context.qa.loadQaSnapshot(); f.context[key].current = value; release(); await reading;
    assert.equal(f.context.qaSnapshotRef.current, null, key + ' while GET');
  }
  for (const format of ['docx','pdf','hwp']) for (const [key, value] of [['versionRef',6],['contentRef','changed'],['editorJsonRef',{type:'doc',content:[]}],['dirtyRef',true],['workspaceDirtyRef',true],['outlineSyncPendingRef',true],['loadSequence',2]] as const) {
    const f = fixture(); await f.context.qa.loadQaSnapshot(); let release = () => {}; f.holdExport(new Promise<void>(resolve => { release = resolve; }));
    const exporting = f.context.qa.downloadQaReport(format); f.context[key].current = value; release(); await exporting;
    assert.equal(f.downloads.length, 0, format + ' / ' + key); assert.ok(f.context.error); assert.equal(f.context.qaExportInFlight.current, false);
  }
});
