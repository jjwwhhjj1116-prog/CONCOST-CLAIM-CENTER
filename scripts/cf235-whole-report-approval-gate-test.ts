import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule, ScriptTarget } from 'typescript';

// Execute the actual route gates: a valid imported report must reach review,
// while an empty import, unsaved work and incomplete chapter workflow must not.
const source = readFileSync('apps/web/src/routes/PreviewReportStudio.tsx', 'utf8');
const bodyStart = source.indexOf('function reportBodyHasContent(');
const bodyEnd = source.indexOf('\n}', bodyStart) + 2;
const gateStart = source.indexOf('  const projectStepComplete =');
const gateEnd = source.indexOf('  const activeStepGuide =', gateStart);
assert.ok(bodyStart > 0 && bodyEnd > bodyStart && gateEnd > gateStart);
const js = transpileModule(source.slice(bodyStart, bodyEnd) + '\n' + source.slice(gateStart, gateEnd)
  + '\nglobalThis.result = { stepComplete, stepUnlocked };', { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
const markerStart = '<!-- MANUAL-WHOLE-DOCUMENT:START -->';
const markerEnd = '<!-- MANUAL-WHOLE-DOCUMENT:END -->';
const base = {
  selectedCaseId: 'qa', loadedCaseId: 'qa', authoring: { available: true, chapters: [{ id: 'one' }] },
  outlineStatus: 'DRAFT', outlineDirty: false, outlineSyncPending: false, savingOutline: false,
  content: `${markerStart}\nimported body\n${markerEnd}`,
  editorJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Imported report' }] }] },
  authoredChapterCodes: new Set(), version: 9, title: 'QA report', dirty: false, saving: false,
  currentFinalization: null, WHOLE_DOCUMENT_START: markerStart, WHOLE_DOCUMENT_END: markerEnd,
  parseStructuredDocumentMarkdown: () => { throw new Error('Unexpected fallback'); }
};
function canReview(changes: Record<string, unknown> = {}) {
  const context = { ...base, ...changes, result: null as any };
  runInNewContext(js, context);
  return context.result.stepUnlocked[5];
}
assert.equal(canReview(), true, 'Saved whole report must not require a separate outline');
for (const changes of [
  { loadedCaseId: 'other' }, { authoring: { available: false } },
  { content: markerStart }, { editorJson: { type: 'doc', content: [{ type: 'paragraph' }] } },
  { dirty: true }, { saving: true }, { version: 0 }, { title: '' },
  { outlineDirty: true }, { outlineSyncPending: true }, { savingOutline: true },
  { content: 'chapter text', outlineStatus: 'DRAFT' },
  { content: 'chapter text', outlineStatus: 'CONFIRMED' }
]) assert.equal(canReview(changes), false, JSON.stringify(changes));
assert.equal(canReview({ content: 'chapter text', outlineStatus: 'CONFIRMED', authoredChapterCodes: new Set(['one']) }), true);
console.log('CF235 whole report review gates: 15 checks PASS');
