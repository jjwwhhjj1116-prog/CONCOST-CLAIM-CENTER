import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { calculateEs, newEsInput, type EsInput } from '../packages/document-engine/src/es-calculation';
import * as sourceTools from '../packages/document-engine/src/es-source-history';
import { esSourceDates, resolveEsSources, syncEsSourceDates, type EsSourceHistory } from '../packages/document-engine/src/es-source-history';

// Synthetic source tables only. The actual resolver and component handlers run;
// the controlled API promise is not evidence of live-server or browser rendering.
function sourceInput(): EsInput {
  const input = newEsInput(); input.title = '합성 날짜 연동 검수'; input.baseDate = '2024-01-15'; input.adjustmentDate = '2024-02-15'; input.contractAmount = '1000000';
  input.costs['11'] = '60000'; input.costs['18'] = '30000'; input.costs['35'] = '10000';
  input.contract!.employmentGrade = '1등급'; input.contract!.retirementTrade = '토목'; input.base.rates.safety = '2.5';
  const history: EsSourceHistory = {
    hash: 'a'.repeat(64),
    months: [['2023-12', '90'], ['2024-01', '100'], ['2024-02', '120'], ['2024-03', '130']].map(([month, wage]) => ({ month, wage, materials: [wage, wage, wage, wage], injury: '3' })),
    rates: [
      { kind: 'health', date: '2020-01-01', values: ['3'] }, { kind: 'pension', date: '2020-01-01', values: ['4'] }, { kind: 'care', date: '2020-01-01', values: ['10'] },
      { kind: 'employment', date: '2020-01-01', values: ['1', '2', '3', '4', '5', '6', '7'] }, { kind: 'retirement', date: '2020-01-01', values: ['2', '3'] },
    ],
    machinery: [{ year: '2024', rows: [['1', '100'], ['2', '200']] }],
    standards: ['토목표준', '건축표준', '기계표준', '전기표준', '통신표준'].map(label => ({ label, publications: [{ date: '2020-01-01', label: '합성 공표 A' }], pairs: [{ label, baseLabel: '합성 공표 A', comparisonLabel: '합성 공표 A', baseAverage: '100', comparisonAverage: '100', baseSum: '100', comparisonSum: '100', commonCount: '1', source: '합성 이력' }] })),
  };
  input.sourceHistory = history; return resolveEsSources(input).input;
}

test('CF129 local history refreshes all three dates and month-end materials without changing the caller', () => {
  const previous = sourceInput(), edited = structuredClone(previous); edited.adjustmentDate = '2024-03-01'; const before = JSON.stringify(edited);
  const next = syncEsSourceDates(edited, previous);
  assert.deepEqual(esSourceDates(next), ['2024-01-15', '2024-03-01', '2024-02-29']);
  assert.deepEqual([next.base.date, next.current.period.date, next.previous.period.date], esSourceDates(next));
  assert.deepEqual([next.base.wage, next.current.period.wage, next.previous.period.wage], ['100', '130', '120']);
  assert.deepEqual([next.base.materials[0], next.current.period.materials[0], next.previous.period.materials[0]], ['90', '120', '120']);
  assert.equal(JSON.stringify(edited), before); assert.equal(calculateEs(next).status, 'LEGACY_REPLAY');
  assert.notEqual(calculateEs(next).current!.k, calculateEs(previous).current!.k);
});

test('CF129 changing the base date reselects base and both comparison pairs; unrelated contract inputs survive', () => {
  const previous = sourceInput(), edited = structuredClone(previous); edited.baseDate = '2024-02-01'; edited.contract!.technicalManager = '합성 담당';
  const next = syncEsSourceDates(edited, previous);
  assert.equal(next.base.date, '2024-02-01'); assert.equal(next.base.wage, '120'); assert.equal(next.base.materials[0], '100');
  assert.equal(next.current.period.date, previous.current.period.date); assert.equal(next.previous.period.date, previous.previous.period.date);
  assert.equal(next.contract!.technicalManager, '합성 담당'); assert.deepEqual(next.costs, previous.costs);
});

test('CF129 aligned manual source corrections are preserved on ordinary mutation and save synchronization', () => {
  const previous = sourceInput(), edited = structuredClone(previous); edited.current.period.wage = '999'; edited.current.period.rates.health = '3.14'; edited.current.machinery.comparisonAverage = '555'; edited.note = '검수자가 고친 값';
  assert.deepEqual(syncEsSourceDates(edited, previous), edited); assert.deepEqual(syncEsSourceDates(edited), edited);
});

test('CF129 legacy documents without history clear only changed-period inputs and affected pairs, preserving manual safety', () => {
  const previous = sourceInput(); delete previous.sourceHistory;
  const edited = structuredClone(previous); edited.adjustmentDate = '2024-03-01'; const next = syncEsSourceDates(edited, previous);
  assert.deepEqual(next.base, previous.base); assert.equal(next.current.period.date, '2024-03-01'); assert.equal(next.previous.period.date, '2024-02-29');
  for (const period of [next.current.period, next.previous.period]) { assert.equal(period.wage, ''); assert.deepEqual(period.materials, ['', '', '', '']); assert.equal(period.rates.safety, '2.5'); for (const [key, value] of Object.entries(period.rates)) if (key !== 'safety') assert.equal(value, '', key); assert.match(period.source, /원자료 확인/); }
  for (const context of [next.current, next.previous]) for (const pair of [context.machinery, ...context.standards]) for (const key of ['baseAverage', 'comparisonAverage', 'commonCount', 'source'] as const) assert.equal(pair[key], '');
  assert.equal(calculateEs(next).status, 'INCOMPLETE');
  const baseEdited = structuredClone(previous); baseEdited.baseDate = '2024-02-01'; const baseNext = syncEsSourceDates(baseEdited, previous);
  assert.equal(baseNext.base.wage, ''); assert.deepEqual(baseNext.current.period, previous.current.period); assert.equal(baseNext.current.machinery.commonCount, ''); assert.equal(baseNext.previous.machinery.commonCount, '');
});

test('CF129 missing history months and invalid/empty dates remain unresolved instead of reusing old values or zero', () => {
  const previous = sourceInput();
  for (const date of ['2025-03-01', '', '2024-02-30']) {
    const edited = structuredClone(previous); edited.adjustmentDate = date; const next = syncEsSourceDates(edited, previous);
    assert.equal(next.adjustmentDate, date); assert.equal(next.current.period.wage, ''); assert.equal(next.previous.period.wage, ''); assert.equal(calculateEs(next).status, 'INCOMPLETE');
    assert.equal(next.current.period.date, date === '2025-03-01' ? date : '');
  }
});

test('CF129 employment grade and retirement trade refresh from history, or clear only those rates for legacy input', () => {
  for (const withHistory of [true, false]) {
    const previous = sourceInput(); if (!withHistory) delete previous.sourceHistory;
    const edited = structuredClone(previous); edited.contract!.employmentGrade = '3등급'; edited.contract!.retirementTrade = '건축'; const next = syncEsSourceDates(edited, previous);
    for (const period of [next.base, next.current.period, next.previous.period]) { assert.equal(period.rates.employment, withHistory ? '3' : ''); assert.equal(period.rates.retirement, withHistory ? '3' : ''); assert.equal(period.rates.health, '3'); assert.equal(period.rates.safety, '2.5'); }
  }
});

const source = readFileSync('apps/web/src/es/EsStudio.tsx', 'utf8');
const tree = ts.createSourceFile('EsStudio.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), nodes: ts.Node[] = [];
const visit = (node: ts.Node) => { nodes.push(node); node.forEachChild(visit); }; visit(tree);
function expressionHandler(expression: ts.Expression, context: Record<string, any>) {
  const code = ts.transpileModule(`globalThis.__factory=(input,document,caseId)=>(${expression.getText(tree)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  runInNewContext(code, context); return context.__factory(context.input, context.document, context.caseId) as (...args: any[]) => any;
}
function handler(name: string, context: Record<string, any>) {
  const declaration = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(tree) === name) as ts.VariableDeclaration | undefined;
  assert.ok(declaration?.initializer, name); return expressionHandler(declaration.initializer, context);
}
function harness(input = sourceInput()) {
  const requests: Array<{ path: string; method: string; body: any }> = [];
  let release!: (value: unknown) => void, reject!: (reason: Error) => void; const response = new Promise((resolve, no) => { release = resolve; reject = no; });
  const state: Record<string, any> = {
    ...sourceTools, input, document: { id: 'synthetic-es', revision: 4, caseId: 'synthetic-project' }, caseId: 'synthetic-project', pending: { current: false }, dirtyRef: { current: true }, loading: false, loadFailed: false,
    history: { current: [] }, future: { current: [] }, run: { id: 'old-run', revision: 4 }, busy: false, savedSignature: 'old', error: '', notice: '', importError: '', importOpen: false, importPreview: null, tab: 'input',
    structuredClone, JSON, Error, Date, encodeURIComponent, calculateEs, newEsInput,
    autoSourceTrigger: 0, handledAutoTrigger: { current: 0 }, setSourcePreview: () => undefined, setAutoSourceTrigger: () => undefined,
    message: (error: Error) => error.message, signature: (value: EsInput, caseId: string) => JSON.stringify({ input: value, caseId }),
    editorScroll: { current: { scrollTo: () => undefined } }, window: { history: { replaceState: () => undefined } },
    apiRequest: (path: string, init: RequestInit) => { const body = JSON.parse(String(init.body)); requests.push({ path, method: init.method!, body }); if (path.endsWith('/runs')) return Promise.resolve({ run: { id: 'new-run', revision: body.expectedRevision, input: state.input, result: calculateEs(state.input) } }); return response; },
  };
  for (const key of ['Input', 'Document', 'CaseId', 'Run', 'Busy', 'SavedSignature', 'Error', 'Notice', 'ImportError', 'ImportOpen', 'ImportPreview', 'Tab']) state['set' + key] = (value: any) => { const name = key[0].toLowerCase() + key.slice(1); state[name] = typeof value === 'function' ? value(state[name]) : value; };
  return { state, requests, release, reject };
}

test('CF129 actual input mutation synchronizes right-side dates immediately and undo restores the prior sources', () => {
  const f = harness(), previous = JSON.stringify(f.state.input);
  handler('mutate', f.state)((next: EsInput) => { next.adjustmentDate = '2024-03-01'; });
  assert.equal(f.state.input.current.period.date, '2024-03-01'); assert.equal(f.state.input.current.period.wage, '130');
  assert.equal(f.requests.length, 0); assert.equal(f.state.history.current.length, 1);
  assert.match(source, /calculateEs\(input\)/); assert.match(source, /input\.base, input\.previous\.period, input\.current\.period/);
  handler('undo', f.state)(); assert.equal(JSON.stringify(f.state.input), previous);
  handler('redo', f.state)(); assert.equal(f.state.input.current.period.wage, '130');
});

test('CF129 directly editing a source-period date does not immediately erase manual source entries', () => {
  const f = harness(), before = structuredClone(f.state.input.current.period);
  handler('mutate', f.state)((next: EsInput) => { next.current.period.date = '2024-02-01'; next.current.period.wage = '777'; });
  assert.equal(f.state.input.current.period.date, '2024-02-01'); assert.equal(f.state.input.current.period.wage, '777');
  assert.deepEqual(f.state.input.current.period.materials, before.materials); assert.deepEqual(f.state.input.current.period.rates, before.rates);
  assert.equal(f.requests.length, 0);
});

test('CF129 actual save sends synchronized local history and waits for the authoritative response before replacing the UI', async () => {
  const input = sourceInput(); input.adjustmentDate = '2024-03-01'; const f = harness(input), before = JSON.stringify(f.state.input);
  const pending = handler('save', f.state)();
  assert.equal(f.requests.length, 1); const sent = f.requests[0].body.input;
  assert.equal(sent.current.period.date, '2024-03-01'); assert.equal(sent.current.period.wage, '130'); assert.equal(f.requests[0].body.expectedRevision, 4);
  assert.equal(JSON.stringify(f.state.input), before, 'pending save cannot replace inputs');
  const saved = { document: { ...f.state.document, revision: 5 }, input: { ...sent, note: '합성 서버 정규화' } };
  f.release(saved); await pending;
  assert.deepEqual(f.state.input, saved.input); assert.equal(f.state.savedSignature, f.state.signature(saved.input, 'synthetic-project'));
  assert.ok(!f.state.run || f.state.run.revision !== f.state.document.revision, 'previous run cannot be exported as the new saved revision');
  assert.match(source, /run\.revision === document\?\.revision/);
  assert.equal(f.state.pending.current, false); assert.equal(f.requests.length, 1);
});

test('CF129 actual ordinary save preserves reviewed manual values and calculate runs only after the saved revision', async () => {
  const input = sourceInput(); input.current.period.wage = '999'; input.current.period.rates.health = '3.14'; const f = harness(input);
  const pending = handler('save', f.state)(true); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.input.current.period.wage, '999');
  f.release({ document: { ...f.state.document, revision: 5 }, input: structuredClone(input) }); await pending;
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].path, '/api/es/documents/synthetic-es/runs'); assert.equal(f.requests[1].body.expectedRevision, 5);
  assert.equal(f.state.input.current.period.wage, '999'); assert.equal(f.state.input.current.period.rates.health, '3.14'); assert.equal(f.state.run.id, 'new-run');
});

test('CF129 failed date-change save retains the caller input, old run and unsaved state without a calculation request', async () => {
  const input = sourceInput(); input.adjustmentDate = '2024-03-01'; const f = harness(input), before = JSON.stringify({ input: f.state.input, document: f.state.document, run: f.state.run, signature: f.state.savedSignature });
  const pending = handler('save', f.state)(true); f.reject(new Error('409 합성 버전 충돌')); await pending;
  assert.equal(JSON.stringify({ input: f.state.input, document: f.state.document, run: f.state.run, signature: f.state.savedSignature }), before);
  assert.equal(f.requests.length, 1); assert.match(f.state.error, /409/); assert.equal(f.state.pending.current, false); assert.equal(f.state.dirtyRef.current, true);
});

test('CF129 loading a stale saved document refreshes local sources but remains dirty until explicitly saved', () => {
  const input = sourceInput(); input.adjustmentDate = '2024-03-01'; const f = harness();
  const load = nodes.find(node => ts.isArrowFunction(node) && node.parameters[0]?.name.getText(tree) === 'payload' && node.body.getText(tree).includes('setDocument(payload.document)')) as ts.ArrowFunction | undefined;
  assert.ok(load); f.state.active = true;
  expressionHandler(load, f.state)({ input, document: f.state.document, run: { id: 'stale-run', revision: 4 } });
  assert.equal(f.state.input.current.period.date, '2024-03-01'); assert.equal(f.state.input.current.period.wage, '130');
  assert.equal(f.state.savedSignature, f.state.signature(input, f.state.caseId)); assert.notEqual(f.state.signature(f.state.input, f.state.caseId), f.state.savedSignature);
  assert.equal(f.requests.length, 0);
});
