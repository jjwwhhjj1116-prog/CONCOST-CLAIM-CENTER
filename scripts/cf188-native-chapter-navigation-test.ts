import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import type { Editor, JSONContent } from '@tiptap/core';
import { joinReportPresentation, splitReportPresentation } from '../packages/document-engine/src/report-presentation';
import { readBoundReportNativeSource, readReportNativeSource, reportNativeBodySha256, reportNativeChapterPage, reportSourceNavigationKey, reportSourcePageCount, reportSourcePageUrls, syncReportNativeSource, updateReportNativeChapterPage } from '../apps/web/src/documents/report-native-source';

const caseId = '40000000-0000-4000-8000-000000000010';
const ids = ['PROMPT-TYPE-01-CH-01', '40000000-0000-4000-8000-000000000020'];
async function fixture(): Promise<JSONContent> {
  const evidenceId = '40000000-0000-4000-8000-000000000012';
  const source = { caseId, evidenceId, name: 'synthetic.hwp', downloadUrl: `/api/cases/evidence/${evidenceId}/download`, byteSize: 128, sha256: 'a'.repeat(64), bindingVersion: 1 as const,
    originalSource: { caseId, evidenceId: 'original', name: 'synthetic-first.hwp', downloadUrl: '/api/cases/evidence/original/download', byteSize: 256, sha256: 'b'.repeat(64) } };
  const doc: JSONContent = { type: 'doc', attrs: { reportNativeSource: source }, content: Array.from({ length: 17 }, (_, page) => ({ type: 'image', attrs: { reportSourcePage: true, src: `/synthetic-page-${page + 1}.svg`, width: 794, height: 1123 } })) };
  doc.attrs!.reportNativeSource.bodySha256 = await reportNativeBodySha256(doc);
  return doc;
}
test('CF188 confirmed navigation metadata preserves original body proof, source, pages and first original', async () => {
  const original = await fixture(), bytes = JSON.stringify(original), beforeHash = await reportNativeBodySha256(original);
  await readBoundReportNativeSource(original, caseId);
  const mapped = updateReportNativeChapterPage(original, caseId, ids[0], 9, ids);
  assert.equal(JSON.stringify(original), bytes);
  assert.deepEqual(mapped.content, original.content);
  assert.deepEqual(mapped.attrs!.reportNativeSource.originalSource, original.attrs!.reportNativeSource.originalSource);
  assert.equal(await reportNativeBodySha256(mapped), beforeHash);
  assert.equal((await readBoundReportNativeSource(mapped, caseId)).bodySha256, original.attrs!.reportNativeSource.bodySha256);
  assert.equal(reportSourcePageCount(mapped), 17);
  assert.deepEqual(reportSourcePageUrls(mapped), reportSourcePageUrls(original));
  assert.equal(reportSourceNavigationKey(mapped, 'doc'), reportSourceNavigationKey(original, 'doc'));
  assert.equal(reportNativeChapterPage(mapped, caseId, ids[0], ids), 9);
  const reopened = JSON.parse(JSON.stringify(mapped));
  assert.deepEqual(readReportNativeSource(reopened, caseId), readReportNativeSource(mapped, caseId));
  assert.equal(reportNativeChapterPage(reopened, caseId, ids[0], ids), 9);
  const presentation = splitReportPresentation(joinReportPresentation(mapped, {enabled: false, text: null}, {enabled: false, date: '', author: ''}));
  assert.equal(reportNativeChapterPage(presentation.body, caseId, ids[0], ids), 9);
  await readBoundReportNativeSource(presentation.body, caseId);
});
test('CF188 metadata-only synchronization creates no Undo event and preserves preceding body Undo', async () => {
  const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
  const { Schema } = webRequire('@tiptap/pm/model'), { EditorState } = webRequire('@tiptap/pm/state'), { history, undo, undoDepth } = webRequire('@tiptap/pm/history');
  const schema = new Schema({ nodes: { doc: {content: 'paragraph+', attrs: {reportNativeSource: {default: null}}}, paragraph: {content: 'text*'}, text: {} } });
  const mapped = updateReportNativeChapterPage(await fixture(), caseId, ids[0], 9, ids);
  let state = EditorState.create({schema, doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('확정 금액 123,456원')])]), plugins: [history()]});
  const dispatch = (transaction: any) => {state = state.apply(transaction);};
  const editor = {get state(){return state;}, view: {dispatch}} as unknown as Editor;
  syncReportNativeSource(editor, mapped);
  assert.equal(undoDepth(state), 0, 'Saved navigation must not become a body Undo event');
  assert.equal(undo(state, dispatch), false);
  dispatch(state.tr.insertText('검수', 1));
  const changed = updateReportNativeChapterPage(mapped, caseId, ids[0], 1, ids);
  syncReportNativeSource(editor, changed);
  assert.equal(undoDepth(state), 1);
  assert.equal(undo(state, dispatch), true);
  assert.equal(state.doc.textContent, '확정 금액 123,456원');
  assert.deepEqual(state.doc.attrs.reportNativeSource, changed.attrs!.reportNativeSource, 'Body Undo retains explicit saved navigation');
});
test('CF188 partial maps and several chapters on one physical page are valid; clearing removes only navigation', async () => {
  const original = await fixture(), first = updateReportNativeChapterPage(original, caseId, ids[0], 1, ids);
  assert.equal(reportNativeChapterPage(first, caseId, ids[1], ids), null);
  const both = updateReportNativeChapterPage(first, caseId, ids[1], 1, ids);
  assert.equal(reportNativeChapterPage(both, caseId, ids[0], ids), 1);
  assert.equal(reportNativeChapterPage(both, caseId, ids[1], ids), 1);
  const cleared = updateReportNativeChapterPage(both, caseId, ids[0], null, ids);
  assert.equal(reportNativeChapterPage(cleared, caseId, ids[0], ids), null);
  assert.equal(reportNativeChapterPage(cleared, caseId, ids[1], ids), 1);
  assert.deepEqual(updateReportNativeChapterPage(cleared, caseId, ids[1], null, ids), original);
  const currentOnly = updateReportNativeChapterPage(both, caseId, ids[0], 9, [ids[0]]);
  assert.deepEqual(readReportNativeSource(currentOnly, caseId)?.confirmedChapterPages?.entries, [{chapterId: ids[0], page: 9}], 'An explicit new registration cannot carry removed template/chapter IDs forward');
});
test('CF188 malformed, duplicate, foreign-source and repaginated maps are ignored without invalidating the unchanged original', async () => {
  const original = await fixture(), mapped = updateReportNativeChapterPage(original, caseId, ids[0], 9, ids);
  for (const patch of [{ version: 2 }, { caseId: 'other' }, { evidenceId: 'other' }, { sha256: 'c'.repeat(64) }, { byteSize: 129 }, { bodySha256: 'c'.repeat(64) }, { pageCount: 18 }, { entries: null }, { entries: [null] }, { entries: [{ chapterId: ids[0], page: 0 }] }, { entries: [{ chapterId: ids[0], page: 1.5 }] }, { entries: [{ chapterId: ids[0], page: 18 }] }, { entries: [{ chapterId: ids[0], page: 1 }, { chapterId: ids[0], page: 2 }] }]) {
    const candidate = structuredClone(mapped);
    Object.assign(candidate.attrs!.reportNativeSource.confirmedChapterPages, patch);
    assert.equal(reportNativeChapterPage(candidate, caseId, ids[0], ids), null);
    assert.equal(readReportNativeSource(candidate, caseId)?.confirmedChapterPages, undefined);
    await readBoundReportNativeSource(candidate, caseId);
  }
  assert.equal(reportNativeChapterPage(mapped, 'other', ids[0], ids), null);
  assert.equal(reportNativeChapterPage(mapped, caseId, ids[0], [ids[1]]), null);
  const repaginated = structuredClone(mapped); repaginated.content!.pop();
  assert.equal(reportNativeChapterPage(repaginated, caseId, ids[0], ids), null);
  await assert.rejects(readBoundReportNativeSource(repaginated, caseId));
});
test('CF188 registration rejects invalid pages, missing identifiers and mixed body; the original is not mutated', async () => {
  const original = await fixture(), before = JSON.stringify(original);
  for (const page of [-1, 0, 18, 1.5, NaN, Infinity]) assert.throws(() => updateReportNativeChapterPage(original, caseId, ids[0], page, ids));
  assert.throws(() => updateReportNativeChapterPage(original, 'other', ids[0], 1, ids));
  assert.throws(() => updateReportNativeChapterPage(original, caseId, 'unknown', 1, ids));
  const mixed = structuredClone(original); mixed.content!.push({ type: 'paragraph', content: [{ type: 'text', text: 'real body change' }] });
  assert.equal(reportSourcePageCount(mixed), 0);
  assert.throws(() => updateReportNativeChapterPage(mixed, caseId, ids[0], 1, ids));
  assert.equal(JSON.stringify(original), before);
});
test('CF188 source identity and document changes reset navigation keys, not mere metadata', async () => {
  const original = await fixture(), key = reportSourceNavigationKey(original, 'a');
  assert.notEqual(reportSourceNavigationKey(original, 'b'), key);
  for (const [field, value] of [['caseId', 'other'], ['evidenceId', 'other'], ['sha256', 'c'.repeat(64)], ['bodySha256', 'c'.repeat(64)]] as const) {
    const next = structuredClone(original); next.attrs!.reportNativeSource[field] = value;
    assert.notEqual(reportSourceNavigationKey(next, 'a'), key);
  }
  const geometry = structuredClone(original); geometry.content![0].attrs!.width = 600;
  assert.notEqual(reportSourceNavigationKey(geometry, 'a'), key);
  await assert.rejects(readBoundReportNativeSource(geometry, caseId));
});
test('CF188 menu and explicit save retain original proof, race guards, normal revision and no root hash exclusions', () => {
  const source = readFileSync('apps/web/src/routes/PreviewReportStudio.tsx', 'utf8');
  for (const fragment of ['await readBoundReportNativeSource(joinReportPresentation(document, header, front), caseId)', 'editorJsonRef.current !== document', "return saveNow('MANUAL', false, true)", 'goToSourcePage(page, source)', 'sourceChapterLinks={sourceChapterLinks}', 'nativeChapterIdsRef.current.includes(chapterId)']) assert.ok(source.includes(fragment));
  const native = readFileSync('apps/web/src/documents/report-native-source.ts', 'utf8');
  assert.match(native, /const \{ reportNativeSource: rawSource, \.\.\.attrs \} = document.attrs/u);
});
