import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { newEsInput } from '../packages/document-engine/src/es-calculation';

// Execute the real component handler with synthetic state and a controlled API promise.
// This checks transaction order, not React rendering/native dialog focus (covered by browser QA).
const source = readFileSync('apps/web/src/es/EsStudio.tsx', 'utf8');
const tree = ts.createSourceFile('EsStudio.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const all: ts.Node[] = [];
const visit = (node: ts.Node) => { all.push(node); node.forEachChild(visit); };
visit(tree);
function expressionHandler(expression: ts.Expression, context: Record<string, any>): (...args: any[]) => any {
  // Hook setters schedule a new render; they do not change a running handler's captured values.
  const code = ts.transpileModule(`globalThis.__factory = (input, document, caseId) => (${expression.getText(tree)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  runInNewContext(code, context);
  return context.__factory(context.input, context.document, context.caseId);
}
function handler(name: string, context: Record<string, any>) {
  const declaration = all.find(node => ts.isVariableDeclaration(node) && node.name.getText(tree) === name) as ts.VariableDeclaration | undefined;
  assert.ok(declaration?.initializer, `${name} must be an explicit component handler`);
  return expressionHandler(declaration.initializer, context);
}
function button(text: string): ts.JsxOpeningElement {
  const element = all.find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'button' && node.children.some(child => child.getText(tree).includes(text))) as ts.JsxElement | undefined;
  assert.ok(element, `Button must exist: ${text}`); return element.openingElement;
}
function eventHandler(element: ts.JsxOpeningElement, name: string, context: Record<string, any>) {
  const attr = element.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(tree) === name) as ts.JsxAttribute | undefined;
  assert.ok(attr?.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression);
  return expressionHandler(attr.initializer.expression, context);
}
function fixture(existing = true) {
  const input = newEsInput(); input.title = 'Synthetic original'; input.costs['11'] = '123';
  const imported = newEsInput(); imported.title = 'Synthetic imported'; imported.costs['11'] = '456';
  const requests: Array<{ path: string; method: string; body: any }> = [];
  let resolve!: (value: unknown) => void, reject!: (reason: Error) => void;
  const response = new Promise((yes, no) => { resolve = yes; reject = no; });
  const context: Record<string, any> = {
    input, caseId: 'synthetic-case', document: existing ? { id: 'synthetic-doc', revision: 4, caseId: 'synthetic-case' } : null,
    importPreview: { input: imported, kind: 'WORKING', warnings: ['Synthetic warning'] },
    pending: { current: false }, dirtyRef: { current: true }, busy: false, loading: false, loadFailed: false,
    history: { current: [newEsInput()] }, future: { current: [newEsInput()] }, run: { id: 'old-run' },
    savedSignature: 'old-signature', tab: 'output', error: '', notice: '', importError: '', importOpen: true,
    structuredClone, JSON, Uint8Array, Error, encodeURIComponent,
    signature: (value: unknown, caseId: string) => JSON.stringify({ input: value, caseId }),
    message: (error: Error) => error.message,
    apiRequest: (path: string, init: RequestInit) => { requests.push({ path, method: init.method!, body: JSON.parse(String(init.body)) }); return response; },
    replacedUrls: [] as string[],
    editorScroll: { current: { scrollTo: () => undefined } },
  };
  context.window = { history: { replaceState: (_state: unknown, _title: string, url: string) => context.replacedUrls.push(url) } };
  for (const key of ['Input', 'CaseId', 'Document', 'ImportPreview', 'ImportOpen', 'ImportName', 'SavedSignature', 'Run', 'Tab', 'Error', 'Notice', 'ImportError', 'Busy']) {
    const stateKey = key[0].toLowerCase() + key.slice(1);
    context['set' + key] = (value: unknown) => { context[stateKey] = value; };
  }
  const save = handler('save', context);
  let saving = Promise.resolve();
  context.save = (...args: any[]) => { saving = save(...args); return saving; };
  const confirmClick = eventHandler(button('가져온 내용으로 저장'), 'onClick', context);
  const confirm = async () => { confirmClick(); await saving; };
  const stable = () => JSON.stringify(Object.fromEntries(['input', 'document', 'importPreview', 'importOpen', 'history', 'future', 'run', 'savedSignature', 'caseId', 'tab'].map(key => [key, context[key]])));
  const saved = { document: { id: 'synthetic-doc', revision: existing ? 5 : 1, caseId: 'synthetic-case' }, input: structuredClone(imported) };
  saved.input.title = 'Synthetic server normalized title';
  return { context, requests, confirm, stable, resolve, reject, saved, input, imported };
}

test('CF125 confirmation is a native named modal and import/export actions are separate', () => {
  const dialog = all.find(node => ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'dialog');
  assert.ok(dialog && dialog.getText(tree).includes('aria-labelledby='), 'Native dialog needs an accessible heading');
  assert.ok(source.includes('.showModal()'));
  assert.ok(!source.includes('>Excel 가져오기·내보내기<'));
  assert.ok(!source.includes('<section className="es-import-confirm"'));
  assert.ok(dialog.getText(tree).includes('onCancel='));
  button('Excel 가져오기'); button('Excel 내보내기');
});

test('CF125 existing import waits for the PUT response and suppresses duplicate confirmation', async () => {
  const f = fixture(), before = f.stable();
  const first = f.confirm();
  assert.equal(f.context.pending.current, true); assert.equal(f.context.busy, true);
  assert.equal(f.stable(), before, 'No input/history/output/preview mutation is allowed before saving');
  await f.confirm(); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].path, '/api/es/documents/synthetic-doc'); assert.equal(f.requests[0].method, 'PUT');
  assert.equal(f.requests[0].body.expectedRevision, 4); assert.equal(f.requests[0].body.caseId, 'synthetic-case');
  assert.deepEqual(f.requests[0].body.input, f.imported);
  f.resolve(f.saved); await first;
  assert.equal(f.context.input.title, f.saved.input.title); assert.equal(f.context.input.costs['11'], '456');
  assert.equal(f.context.document.revision, 5); assert.equal(f.context.importPreview, null);
  assert.equal(f.context.importOpen, false);
  assert.equal(f.context.run, null); assert.equal(f.context.tab, 'input');
  assert.equal(f.context.history.current.length, 2); assert.equal(f.context.history.current[1].title, f.input.title);
  assert.equal(f.context.future.current.length, 0); assert.equal(f.context.pending.current, false); assert.equal(f.context.busy, false);
  assert.equal(f.context.savedSignature, f.context.signature(f.context.input, 'synthetic-case'));
});

test('CF125 explicit cancel and native Escape preserve inputs and never save', () => {
  for (const native of [false, true]) {
    const f = fixture();
    const draftBefore = JSON.stringify([f.context.input, f.context.document, f.context.history, f.context.future, f.context.run]);
    const element = native ? all.find(node => ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'dialog') as ts.JsxOpeningElement : button('취소 · 기존 입력 유지');
    let prevented = false;
    eventHandler(element, native ? 'onCancel' : 'onClick', f.context)({ preventDefault: () => { prevented = true; } });
    assert.equal(f.context.importOpen, false); assert.equal(f.context.importPreview, null); assert.equal(f.requests.length, 0);
    assert.equal(JSON.stringify([f.context.input, f.context.document, f.context.history, f.context.future, f.context.run]), draftBefore);
    if (native) assert.equal(prevented, true);
  }
});

test('CF125 pending save cannot be canceled by button or native Escape', async () => {
  const f = fixture(), before = f.stable(), pending = f.confirm();
  const dialog = all.find(node => ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'dialog') as ts.JsxOpeningElement;
  eventHandler(button('취소 · 기존 입력 유지'), 'onClick', f.context)();
  eventHandler(dialog, 'onCancel', f.context)({ preventDefault: () => undefined });
  assert.equal(f.stable(), before); f.resolve(f.saved); await pending;
});

test('CF125 parsing only creates a preview and does not mutate the draft or issue an API write', async () => {
  const f = fixture(), oldInput = JSON.stringify(f.context.input), parsed = f.context.importPreview;
  let release!: (value: unknown) => void;
  let started!: () => void;
  const parsingStarted = new Promise<void>(resolve => { started = resolve; });
  f.context.importEsWorkbook = () => new Promise(resolve => { release = resolve; started(); });
  const parsing = handler('importFile', f.context)({ name: 'synthetic.xlsx', size: 2, arrayBuffer: async () => new ArrayBuffer(2) });
  await parsingStarted;
  assert.equal(f.context.pending.current, true); assert.equal(f.context.importOpen, true);
  assert.equal(JSON.stringify(f.context.input), oldInput); assert.equal(f.requests.length, 0);
  release(parsed); await parsing;
  assert.equal(JSON.stringify(f.context.input), oldInput); assert.equal(f.requests.length, 0);
  assert.equal(f.context.importPreview, parsed); assert.equal(f.context.pending.current, false);
});

test('CF125 wrong extension, excessive size and parser failure show errors without replacing input', async () => {
  for (const failure of ['extension', 'size', 'parse']) {
    const f = fixture(), oldInput = JSON.stringify(f.context.input);
    f.context.importEsWorkbook = () => Promise.reject(new Error('Synthetic parsing failure'));
    await handler('importFile', f.context)({ name: failure === 'extension' ? 'bad.xlsm' : 'synthetic.xlsx', size: failure === 'size' ? 25_000_001 : 2, arrayBuffer: async () => new ArrayBuffer(2) });
    assert.equal(JSON.stringify(f.context.input), oldInput); assert.equal(f.requests.length, 0);
    assert.equal(f.context.importOpen, true); assert.equal(f.context.importPreview, null);
    assert.ok(f.context.importError); assert.equal(f.context.pending.current, false);
  }
});

for (const reason of ['409 revision conflict', 'Network timeout', '403 forbidden']) test(`CF125 ${reason} preserves the old draft and import preview for retry`, async () => {
  const f = fixture(), before = f.stable(), pending = f.confirm();
  f.reject(new Error(reason)); await pending;
  assert.equal(f.stable(), before); assert.equal(f.requests.length, 1);
  assert.equal(f.context.pending.current, false); assert.equal(f.context.busy, false);
  assert.ok(`${f.context.error} ${f.context.importError}`.includes(reason));
  assert.equal(f.context.replacedUrls.length, 0);
});

test('CF125 new document uses POST without revision and changes URL only after save success', async () => {
  const f = fixture(false), pending = f.confirm();
  assert.equal(f.requests[0].method, 'POST'); assert.equal(f.requests[0].path, '/api/es/documents');
  assert.equal('expectedRevision' in f.requests[0].body, false); assert.equal(f.context.replacedUrls.length, 0);
  f.resolve(f.saved); await pending;
  assert.equal(f.context.document.revision, 1); assert.equal(f.context.importPreview, null);
  assert.deepEqual(f.context.replacedUrls, ['/es/editor?documentId=synthetic-doc']);
});

test('CF125 absent preview, load failure and pending operation never write a document', async () => {
  for (const state of ['absent', 'loading', 'loadFailed', 'pending']) {
    const f = fixture();
    if (state === 'absent') f.context.importPreview = null;
    else if (state === 'pending') f.context.pending.current = true;
    else f.context[state] = true;
    const before = f.stable(); await f.confirm();
    assert.equal(f.requests.length, 0, state); assert.equal(f.stable(), before, state);
  }
});
