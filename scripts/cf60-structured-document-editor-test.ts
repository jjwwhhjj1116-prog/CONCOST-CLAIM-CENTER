import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('CF60 provides one shared Tiptap editor for report and proposal authoring', () => {
  const editor = read('apps/web/src/documents/StructuredDocumentEditor.tsx');
  const report = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const webPackage = read('apps/web/package.json');
  for (const marker of ['StarterKit', 'TableKit', 'CharacterCount', 'toggleBold', 'toggleBulletList', 'addColumnAfter', 'replaceAll', '전체화면', '미리보기']) {
    assert.ok(editor.includes(marker), `missing structured editor feature: ${marker}`);
  }
  assert.match(editor, /AI-CHAPTER:/u);
  assert.match(editor, /getSelection/u);
  assert.match(editor, /replaceRange/u);
  assert.match(report, /StructuredDocumentEditor/u);
  assert.match(report, /editorJson/u);
  assert.match(proposal, /StructuredDocumentEditor/u);
  assert.match(proposal, /Gemini 문장 개선/u);
  assert.match(webPackage, /"@tiptap\/react"/u);
  assert.match(webPackage, /"turndown-plugin-gfm"/u);
});

test('CF60 persists structured report JSON and protects proposal AI improvement with D1 versions', () => {
  const worker = read('apps/cloudflare/src/index.ts');
  const migration = read('apps/cloudflare/migrations/0043_cf60_structured_document_editor.sql');
  assert.match(migration, /ALTER TABLE preview_report_drafts ADD COLUMN editor_json TEXT/u);
  assert.match(migration, /ALTER TABLE preview_report_revisions ADD COLUMN editor_json TEXT/u);
  assert.match(worker, /editorJson/u);
  assert.match(worker, /2_000_000/u);
  assert.match(worker, /\/api\/proposal-studio\/improve/u);
  assert.match(worker, /expectedProposalVersion/u);
  assert.match(worker, /PROPOSAL_NOT_EDITABLE/u);
  assert.match(worker, /VERSION_CONFLICT/u);
  assert.match(worker, /사용자가 준 사실·숫자·날짜·인명·고유명사·근거를 추가하거나 삭제하지/u);
});

test('CF60 keeps server-only collaboration and memory bridges honest', () => {
  const editor = read('apps/web/src/documents/StructuredDocumentEditor.tsx');
  assert.doesNotMatch(editor, /hocuspocus|WebsocketProvider|mem0|langgraph/iu);
  assert.match(editor, /자동 저장 호환 편집기/u);
});

test('CF60 exposes an honest admin status and preserves the future server handoff contract', () => {
  const settings = read('apps/web/src/routes/PreviewSettings.tsx');
  const runbook = read('docs/runbooks/document-authoring-platform.md');
  for (const marker of ['문서 제작 플랫폼 연결 상태', 'Tiptap 구조화 편집기', 'D1 문서 원본 저장', 'HWP/HWPX · DOCX · PDF', 'Gotenberg PDF 변환', 'Yjs · Hocuspocus 협업', 'Mem0 · LangGraph Memory']) {
    assert.ok(settings.includes(marker), `missing admin platform status: ${marker}`);
  }
  assert.match(settings, /준비 중인 기능을 작동하는 것처럼 표시하지 않습니다/u);
  assert.match(runbook, /Tiptap JSON을 문서의 정본으로 유지/u);
  assert.match(runbook, /Bridge 장애가 문서 편집·D1 저장을 막아서는 안 됩니다/u);
  assert.match(runbook, /organizationId:caseId:documentKind:documentId/u);
});
