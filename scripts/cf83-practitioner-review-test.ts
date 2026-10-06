import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transpileModule, ScriptTarget } from 'typescript';
import { claimTypeLabel } from '../apps/web/src/claim-types.js';
import { generateProposalDocx, generateProposalPdf, type ProposalExportDocument } from '../apps/cloudflare/src/proposal-docx.js';
import { meetingMinutesWorkbook } from '../apps/web/src/proposals/proposal-excel.js';

const read = (path: string): string => readFileSync(path, 'utf8');

test('CF177 report type labels preserve all six codes and unknown values', () => {
  const labels = ['현장조사 및 수량산출 클레임', '분석 보고서 작성 클레임', '일반적인 클레임', '재건축·재개발 공사비 협상', '사감정보고서', '물가변동'];
  labels.forEach((label, index) => assert.equal(claimTypeLabel(`TYPE-0${index + 1}`), label));
  assert.equal(claimTypeLabel('TYPE-07'), 'TYPE-07');
  assert.equal(claimTypeLabel(''), '');
});

test('CF178 chapter selectors show titles and report missing body anchors without rewriting markers', () => {
  const source = read('apps/web/src/routes/PreviewReportStudio.tsx');
  assert.ok(!/label:\s*`\$\{chapter\.chapterCode\}/u.test(source), 'member-facing chapter selectors must show titles rather than internal CH codes');
  assert.ok(!source.includes('<b>{chapter.chapterCode}</b>'), 'assignment labels must not repeat an internal CH badge');
  assert.ok(!source.includes('<strong>{selectedChapterAssignment.chapterCode}'), 'the collaboration identity must show the actual title');
  assert.ok(source.includes('moved === false && activeStep === 4'), 'a failed body jump must not be silently presented as successful');
  assert.ok(source.includes("current === CHAPTER_JUMP_NOTICE ? '' : current"), 'a successful jump must clear only its own stale notice');
  assert.ok(source.includes('<!-- AI-CHAPTER:${chapter.chapterCode}:START -->'), 'stable internal chapter markers remain intact');
});

test('CF177 report lists, search, and authoring hints use the shared type labels', () => {
  const library = read('apps/web/src/reports/ReportLibraryView.tsx');
  const list = read('apps/web/src/reports/ReportList.tsx');
  const nativeStudio = read('apps/web/src/reports/ReportStudio.tsx');
  const inbox = read('apps/web/src/reports/ApprovalInbox.tsx');
  const previewStudio = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const delivery = read('apps/web/src/routes/PreviewDeliveryCenter.tsx');
  assert.ok(library.includes('workspace.claimType, claimTypeLabel(workspace.claimType)'), 'library search must accept both preserved type codes and visible Korean labels');
  assert.equal((library.match(/\{claimTypeLabel\(workspace\.claimType\)\}/gu) ?? []).length, 2, 'both project and database lists must show type names');
  assert.ok(list.includes('{claimTypeLabel(report.case.claimType)}'), 'native report list must show type names');
  assert.ok(nativeStudio.includes('{claimTypeLabel(report.case.claimType)}'), 'native report studio must show type names');
  assert.ok(inbox.includes('{claimTypeLabel(item.case.claimType)}'), 'native review inbox must show type names');
  assert.ok(delivery.includes('{claimTypeLabel(selected.claimType)}'), 'final delivery project must show the shared type name');
  assert.ok(previewStudio.includes('프로젝트 유형 {authoring.typeGuideline?.typeName || claimTypeLabel(authoring.claimType)}'), 'AI authoring hint must use the approved type name with the shared fallback');
  for (const source of [list, nativeStudio]) assert.ok(!source.includes('{report.case.claimType}'), 'raw stored type codes must not replace member-facing report labels');
});

test('CF178 explicit HWP sources use embedded mode without deleting recovery drafts', () => {
  const dialog = read('apps/web/src/documents/RhwpEditorDialog.tsx');
  assert.ok(dialog.includes("runtimeUrl.searchParams.set('chrome', 'embed')"), 'an explicitly linked document must not be replaced by startup recovery UI');
  assert.ok(dialog.includes('studioUrl: runtimeUrl.href'), 'the SDK must receive the embedded URL');
  assert.ok(!dialog.includes('indexedDB.deleteDatabase') && !dialog.includes('localStorage.clear'), 'recovery data must not be deleted to hide the prompt');
});

test('CF178 whole document application confirms report persistence before closing the editor', () => {
  const studio = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const apply = studio.slice(studio.indexOf('const applySourcePagesToReport ='), studio.indexOf('const applyHwpPagesToReport ='));
  const changed = apply.indexOf('setEditorJson(parsed)');
  const saved = apply.indexOf("if (!await saveNow('MANUAL', false, true))", changed);
  const closed = apply.indexOf('setHwpEditorOpen(false)', changed);
  assert.ok(changed >= 0 && saved > changed && closed > saved, 'closing an imported editor must wait for the exact new draft save');
  assert.ok(apply.includes('appliedToWorkspace ?'), 'a draft save failure must not falsely claim the local working body was unchanged');
});

test('CF178 actual application function waits for save and retains unsaved imports on failure', async () => {
  const studio = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const expression = studio.slice(studio.indexOf('const applySourcePagesToReport ='), studio.indexOf('const applyHwpPagesToReport =')).trim().replace(/^const applySourcePagesToReport = /u, '').replace(/;$/u, '');
  const compiled = transpileModule(`(${expression})`, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
  for (const succeeds of [true, false]) {
    let releaseSave!: (saved: boolean) => void;
    let savedRequest!: () => void;
    const requested = new Promise<void>(resolve => { savedRequest = resolve; });
    const response = new Promise<boolean>(resolve => { releaseSave = resolve; });
    const contentRef = { current: 'original body' };
    const editorJsonRef: { current: unknown } = { current: { type: 'doc', content: [] } };
    const frontRef = { current: { enabled: true } };
    const closed: boolean[] = [], errors: string[] = [];
    const noOp = () => undefined;
    const context = {
      AbortController, pageImportInFlight: { current: false }, pageImportAbort: { current: null }, editable: true, saving: false,
      chapterSaveInFlight: { current: false }, outlineSaveInFlight: { current: false }, generationInFlight: { current: false },
      selectedCaseId: 'synthetic-case', selectedCaseRef: { current: 'synthetic-case' }, dirty: false, contentRef, editorJsonRef, reportFrontMatterRef: frontRef,
      confirmReportPages: async () => true, setLinkingHwp: noOp, setError: (message: string) => errors.push(message), setMemoryNotice: noOp,
      reportUploads: { upload: async () => ({ downloadUrl: '/synthetic-page' }) },
      document: { createElement: () => ({ src: '', alt: '', dataset: { reportSourcePage: '' }, get outerHTML() { return '<img src="/synthetic-page" data-report-source-page="true">'; } }) },
      wholeReportDocument: (body: string) => `<!-- MANUAL-WHOLE-DOCUMENT:START -->${body}<!-- MANUAL-WHOLE-DOCUMENT:END -->`,
      parseStructuredDocumentMarkdown: () => ({ type: 'doc', content: [{ attrs: { reportSourcePage: true } }] }),
      setContent: noOp, setEditorJson: (value: unknown) => { editorJsonRef.current = value; },
      setReportFrontMatter: (value: { enabled: boolean }) => { frontRef.current = value; }, setDraftMethod: noOp, setDirty: noOp,
      saveNow: async (...args: unknown[]) => { assert.deepEqual(args, ['MANUAL', false, true]); savedRequest(); return response; },
      setHwpEditorOpen: (open: boolean) => closed.push(open), setHwpSourceFile: noOp, setShowTemplatePreview: noOp
    };
    const apply = runInNewContext(compiled, context) as (count: number, source: string, readPage: () => Promise<File>) => Promise<void>;
    const pending = apply(1, 'PDF', async () => new File(['synthetic'], 'page.jpg'));
    await requested;
    assert.deepEqual(closed, [], 'The editor must remain open while the report save is pending');
    assert.match(contentRef.current, /synthetic-page/u);
    releaseSave(succeeds);
    if (succeeds) { await pending; assert.deepEqual(closed, [false]); }
    else {
      await assert.rejects(pending, /저장 완료를 확인하지 못했습니다/u);
      assert.deepEqual(closed, [], 'Failed persistence must retain the source editor');
      assert.match(contentRef.current, /synthetic-page/u, 'The unsaved imported working body must remain available');
      assert.match(errors.at(-1) ?? '', /가져온 내용은 현재 작업 화면에 유지/u);
      assert.doesNotMatch(errors.at(-1) ?? '', /HWP 편집기/u, 'PDF import failures must not refer to a nonexistent HWP editor');
      assert.doesNotMatch(errors.at(-1) ?? '', /현재 원고는 변경하지 않습니다/u);
    }
  }
});

test('CF83 project lists, evidence, and authoring screens follow the practitioner access contract', () => {
  const worker = read('apps/cloudflare/src/index.ts');
  const evidence = read('apps/web/src/evidence/CaseEvidencePanel.tsx');
  const select = read('packages/ui/src/components/Select.tsx');
  const workflow = read('apps/web/src/workflow/WorkflowOperations.tsx');
  const report = read('apps/web/src/routes/PreviewReportStudio.tsx');
  const migration = read('apps/cloudflare/migrations/0053_cf83_practitioner_review.sql');

  assert.match(worker, /assignedOnly = url\.searchParams\.get\('assignedOnly'\) === 'true'/u);
  assert.match(worker, /const visibility = assignedOnly[\s\S]*?: '1 = 1'/u);
  assert.match(worker, /organizationPreviewCase\(env, caseId\)/u);
  assert.match(worker, /accessMode:\s*'STUDIO_SESSION_PROXY'/u);
  assert.doesNotMatch(worker, /googleFileId: row\.googleFileId/u);
  assert.match(evidence, /스튜디오 권한으로 다운로드/u);
  assert.doesNotMatch(evidence, /drive\.google\.com/u);
  assert.match(evidence, /upload\(event\.dataTransfer\.files, value\)/u);

  assert.match(select, /searchable\?: boolean/u);
  assert.match(select, /searchPlaceholder\?: string/u);
  assert.match(workflow, /stage=SITE_SURVEY/u);
  assert.match(worker, /requestedStage/u);
  assert.match(worker, /preview_project_stage_schedules stage_filter/u);
  assert.match(report, /dirty \|\| outlineDirty \|\| workspaceDirty/u);
  assert.match(migration, /ADD COLUMN client_name TEXT/u);
});

test('CF83 proposal review re-entry and project-specific printing remain available', () => {
  const proposal = read('apps/web/src/proposals/ProposalView.tsx');
  const schedule = read('apps/web/src/workflow/ProjectWorkflowSchedule.tsx');
  const print = read('apps/web/src/workflow/ProjectSchedulePrint.tsx');
  const claimTypes = read('apps/web/src/claim-types.ts');

  assert.doesNotMatch(proposal, /canResumeReviewerEdits/u);
  assert.match(proposal, /target>=3&&\(!firstThreeComplete\|\|\(dirty&&!currentVersion\)\)/u);
  assert.match(proposal, /target>=4&&\(!allChaptersComplete\|\|dirty\|\|!currentVersion\)/u);
  assert.match(proposal, /작성 기준/u);
  assert.match(proposal, /실명 제출이 원칙/u);
  assert.match(proposal, /downloadFinalDocument/u);
  assert.match(proposal, /orientation:'portrait'/u);
  assert.match(schedule, /이 프로젝트 상세 일정 출력/u);
  assert.match(print, /projectId/u);
  assert.match(print, /WORKFLOW_STAGES/u);
  assert.match(claimTypes, /TYPE-01/u);
  assert.match(claimTypes, /현장조사 및 수량산출 클레임/u);
});

test('CF83/CF95 approved proposal DOCX and PDF use editable A4 portrait output', () => {
  const document: ProposalExportDocument = {
    proposalId: 'proposal-cf83', versionId: 'version-cf83', versionNumber: 3,
    projectTitle: '실무자 검토 반영 제안서', clientName: '컨코스트 발주처', subtitle: '확정 출력 검수',
    submissionDate: '2026-09-01', caseNumber: 'CC-2026-00083', claimType: 'TYPE-03',
    preparedBy: '담당 PM', contentSha256: '8'.repeat(64),
    chapters: [{ number: 1, title: '제안 목적', body: '확인된 프로젝트 자료를 근거로 작성한 편집 가능한 본문입니다.' }]
  };
  const docxText = new TextDecoder().decode(generateProposalDocx(document));
  const pdfText = new TextDecoder().decode(generateProposalPdf(document));
  assert.match(docxText, /w:pgSz w:w="11906" w:h="16838"/u);
  assert.match(docxText, /편집 가능한 본문/u);
  assert.match(pdfText, /\/MediaBox \[0 0 595 842\]/u);
  assert.doesNotMatch(pdfText, /\/MediaBox \[0 0 842 595\]/u);
});

test('CF83 reviewed meeting minutes download as the company-form XLSX instead of plain text', () => {
  const bytes = meetingMinutesWorkbook({ author:'담당 PM', meetingDate:'2026. 09. 01', meetingTime:'10:00', location:'본사 회의실', participants:'담당 PM, 기술팀', meetingTitle:'착수회의', attachmentName:'회의자료.pdf', summary:'업무범위와 제출일정을 확정했습니다.', followUps:'1. 현장자료 목록 확인' });
  const packageText = new TextDecoder().decode(bytes);
  assert.match(packageText, /회 의 록/u);
  assert.match(packageText, /회의내용 및 지시사항/u);
  assert.match(packageText, /orientation="portrait"/u);
  const workflow = read('apps/web/src/workflow/WorkflowOperations.tsx');
  assert.match(workflow, /현재 회의록 XLSX 내려받기/u);
});
