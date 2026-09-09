import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ES_COSTS, ES_RATE_KEYS, calculateEs, newEsInput, type EsInput } from '../packages/document-engine/src/es-calculation';
import { syncEsSourceDates } from '../packages/document-engine/src/es-source-history';

// Real component expressions and handlers with isolated synthetic state.
// This is not React lifecycle/keyboard/layout evidence; the actual App browser suite covers those.
const source = readFileSync('apps/web/src/es/EsStudio.tsx', 'utf8');
const tree = ts.createSourceFile('EsStudio.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function nodes(root: ts.Node = tree): ts.Node[] { const all: ts.Node[] = []; const visit = (n: ts.Node) => { all.push(n); n.forEachChild(visit); }; visit(root); return all; }
const all = nodes();
function declaration(name: string, root: ts.Node = tree) {
  const found = nodes(root).find(n => ts.isVariableDeclaration(n) && n.name.getText(tree) === name) as ts.VariableDeclaration | undefined;
  assert.ok(found?.initializer, name); return found.initializer;
}
function evaluate(node: ts.Node, context: Record<string, any> = {}) {
  const code = ts.transpileModule(`globalThis.__value=(${node.getText(tree)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
  runInNewContext(code, context); return context.__value;
}
function attribute(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
  return node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(tree) === name) as ts.JsxAttribute | undefined;
}
function expression(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
  const value = attribute(node, name)?.initializer; assert.ok(value && ts.isJsxExpression(value) && value.expression, name); return value.expression;
}
function byClass(name: string) {
  const found = all.find(n => ts.isJsxElement(n) && attribute(n.openingElement, 'className')?.initializer?.getText(tree).replaceAll('"', '').split(' ').includes(name));
  assert.ok(found && ts.isJsxElement(found), name); return found;
}
function button(text: string, root: ts.Node = tree) {
  const found = nodes(root).find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(tree) === 'button' && n.children.some(c => ts.isJsxText(c) && c.text.trim() === text));
  assert.ok(found && ts.isJsxElement(found), text); return found.openingElement;
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
function inputFixture() {
  const input = newEsInput(); input.title = 'CF130 합성 산출서'; input.baseDate = '2024-01-01'; input.adjustmentDate = '2024-03-01'; input.contractAmount = '10000000';
  for (const [row] of ES_COSTS) input.costs[row] = String(row * 100);
  for (const [period, date, value] of [[input.base, input.baseDate, '100'], [input.previous.period, '2024-02-29', '105'], [input.current.period, input.adjustmentDate, '110']] as const) {
    period.date = date; period.wage = value; period.materials = [value, value, value, value]; period.source = '합성 출처 ' + date;
    period.rates = { injury: '3', safety: '2', employment: '1', retirement: '2', health: '3', pension: '4', care: '10' };
  }
  for (const period of [input.current, input.previous]) for (const pair of [period.machinery, ...period.standards]) Object.assign(pair, { baseAverage: '100', comparisonAverage: period.period.wage, commonCount: '3', source: '합성 기간쌍' });
  assert.deepEqual(calculateEs(input).fatal, []); return input;
}
function harness() {
  const state: Record<string, any> = { input: inputFixture(), document: { id: 'synthetic', revision: 4 }, run: { id: 'synthetic-run', revision: 4 }, caseId: 'synthetic-project', dirty: true, pending: { current: false }, dirtyRef: { current: true }, importOpenRef: { current: false }, history: { current: [] }, future: { current: [] }, selectedRow: 11, reviewPeriod: 'current', costQuery: '', tab: 'input', scrolls: [], focuses: [], navigations: [], requests: [], error: '', structuredClone, ES_COSTS, ES_RATE_KEYS, syncEsSourceDates };
  state.setInput = (value: EsInput) => { state.input = value; };
  for (const key of ['Tab', 'SelectedRow', 'ReviewPeriod', 'CostQuery', 'Error']) state['set' + key] = (value: unknown) => { state[key[0].toLowerCase() + key.slice(1)] = value; };
  state.editorScroll = { current: { scrollTo: (options: unknown) => state.scrolls.push(options) } };
  state.onNavigate = (path: string) => state.navigations.push(path);
  state.apiRequest = (...args: unknown[]) => { state.requests.push(args); throw new Error('Unexpected API write'); };
  state.window = { requestAnimationFrame: (callback: () => void) => callback(), document: { getElementById: (id: string) => ({ focus: () => state.focuses.push(id) }) } };
  state.goTab = evaluate(declaration('goTab'), state); state.mutate = evaluate(declaration('mutate'), state);
  return state;
}

test('CF130 editor is a named page region, without outer portal/inert/focus trap; both named native dialogs remain', () => {
  const editor = byClass('es-editor-workspace').openingElement;
  assert.equal(editor.tagName.getText(tree), 'section');
  assert.equal(attribute(editor, 'aria-labelledby')?.initializer?.getText(tree), '"es-editor-title"');
  assert.equal(attribute(editor, 'role'), undefined); assert.equal(attribute(editor, 'aria-modal'), undefined);
  assert.equal(all.filter(ts.isCallExpression).filter(n => n.expression.getText(tree) === 'createPortal').length, 0);
  const writes = all.filter(ts.isBinaryExpression).filter(n => n.operatorToken.kind === ts.SyntaxKind.EqualsToken).map(n => n.left.getText(tree));
  assert.ok(!writes.some(left => left.endsWith('.inert') || left.endsWith('body.style.overflow')));
  const globalKeys = all.filter(ts.isCallExpression).filter(n => n.expression.getText(tree).endsWith('.addEventListener') && n.arguments[0]?.getText(tree) === "'keydown'");
  assert.equal(globalKeys.length, 0);
  const dialogs = all.filter(ts.isJsxOpeningElement).filter(n => n.tagName.getText(tree) === 'dialog');
  assert.deepEqual(dialogs.map(n => attribute(n, 'aria-labelledby')?.initializer?.getText(tree)).sort(), ['"es-import-title"', '"es-source-title"']);
  for (const dialog of dialogs) assert.ok(attribute(dialog, 'onCancel'));
});

test('CF130 six local work steps retain original order, labels, help and decorative icons', () => {
  const steps = json(evaluate(declaration('ES_STEPS'))) as string[][];
  assert.deepEqual(steps.map(s => s[0]), ['input', 'costs', 'sources', 'deductions', 'result', 'output']);
  assert.equal(new Set(steps.map(s => s[1])).size, 6);
  assert.ok(steps.every(s => s.length === 4 && s[1].trim() && s[2].trim() && /^M\d/.test(s[3])));
  const icon = all.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'EsIcon'); assert.ok(icon);
  const svg = nodes(icon).find(n => ts.isJsxOpeningElement(n) && n.tagName.getText(tree) === 'svg') as ts.JsxOpeningElement;
  assert.equal(attribute(svg, 'aria-hidden')?.initializer?.getText(tree), '"true"');
  const state = harness(), before = JSON.stringify([state.input, state.document, state.run, state.history, state.future, state.dirty]);
  const tabButton = nodes(byClass('es-tabs')).find(n => ts.isJsxOpeningElement(n) && n.tagName.getText(tree) === 'button') as ts.JsxOpeningElement;
  for (const [tab] of steps) { state.key = tab; evaluate(expression(tabButton, 'onClick'), state)(); assert.equal(state.tab, tab); }
  assert.equal(state.scrolls.length, 6); assert.ok(state.scrolls.every((s: { top: number }) => s.top === 0));
  assert.equal(JSON.stringify([state.input, state.document, state.run, state.history, state.future, state.dirty]), before);
  assert.deepEqual(state.navigations, []); assert.deepEqual(state.requests, []);
});

test('CF130 actual navigation blocker preserves dirty/modal/pending state and only accepted nonpending exit proceeds', () => {
  const register = all.find(n => ts.isCallExpression(n) && n.expression.getText(tree) === 'registerNavigationBlocker') as ts.CallExpression;
  assert.ok(register);
  for (const [dirty, pending, modal, accept] of [[false, false, false, false], [true, false, false, false], [true, false, false, true], [false, true, false, true], [false, false, true, false], [false, false, true, true]]) {
    let prompts = 0, proceeded = 0;
    const state = { dirtyRef: { current: dirty }, pending: { current: pending }, importOpenRef: { current: modal }, window: { confirm: () => { prompts++; return accept; } } };
    const blocked = evaluate(register.arguments[0], state)({ proceed: () => { proceeded++; } });
    assert.equal(blocked, dirty || pending || modal);
    assert.equal(prompts, !pending && (dirty || modal) ? 1 : 0);
    assert.equal(proceeded, !pending && (dirty || modal) && accept ? 1 : 0);
    assert.equal(state.dirtyRef.current, proceeded ? false : dirty);
  }
});

test('CF130 original 28 stable row IDs select matching current and previous calculation evidence without changing input', () => {
  const table = byClass('es-cost-table'), choice = nodes(table).filter(ts.isJsxOpeningElement).find(n => n.tagName.getText(tree) === 'button' && attribute(n, 'aria-pressed'))!;
  const state = harness(), before = JSON.stringify([state.input, state.document, state.run, state.dirty]); state.result = calculateEs(state.input);
  assert.equal(ES_COSTS.length, 28); assert.equal(new Set(ES_COSTS.map(([row]) => row)).size, 28);
  assert.ok(new Set(ES_COSTS.map(([, code]) => code)).size < 28, 'Fixture exercises repeated codes such as Z');
  for (const [row, code, label] of ES_COSTS) for (const period of ['current', 'previous']) {
    state.r = row; state.reviewPeriod = period; evaluate(expression(choice, 'onClick'), state)();
    assert.equal(state.selectedRow, row);
    assert.deepEqual(json(evaluate(declaration('selectedCost'), state)), [row, code, label]);
    const selected = evaluate(declaration('selectedCalculation'), state);
    assert.equal(selected.row, row); assert.equal(selected.amount, state.input.costs[row]);
    assert.deepEqual(json(selected), json(state.result[period].rows.find((r: { row: number }) => r.row === row)));
  }
  assert.equal(JSON.stringify([state.input, state.document, state.run, state.dirty]), before);
  assert.deepEqual(state.requests, []); assert.deepEqual(state.navigations, []);
});

test('CF130 source comparison matrix preserves all 14 fields in each of three periods without cross-period writes', () => {
  const matrix = byClass('es-source-matrix'), change = declaration('change', matrix);
  const periods = nodes(matrix).find(n => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'map' && n.expression.expression.getText(tree).includes("['base', 'previous', 'current']")) as ts.CallExpression;
  assert.ok(periods && ts.isPropertyAccessExpression(periods.expression));
  assert.deepEqual(json(evaluate(periods.expression.expression)), ['base', 'previous', 'current']);
  for (const key of ['base', 'previous', 'current'] as const) for (let row = 0; row < 14; row++) {
    const state = harness(), before = structuredClone(state.input); state.key = key; state.row = row;
    const replacement = row === 0 ? '2025-07-08' : row === 13 ? '새 합성 출처' : '98765';
    evaluate(change, state)(replacement);
    const target = key === 'base' ? before.base : before[key].period;
    if (row === 0) target.date = replacement; else if (row === 1) target.wage = replacement; else if (row < 6) target.materials[row - 2] = replacement; else if (row < 13) target.rates[ES_RATE_KEYS[row - 6]] = replacement; else target.source = replacement;
    assert.deepEqual(state.input, before, `${key}, row ${row}`); assert.equal(state.history.current.length, 1);
    assert.deepEqual(state.requests, []);
  }
});

test('CF130 filtered cost paste still follows original contiguous row IDs and invalid columns never partially update', () => {
  const table = byClass('es-cost-table');
  const money = nodes(table).find(n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(tree) === 'EsMoneyInput') as ts.JsxSelfClosingElement;
  assert.ok(money);
  const state = harness(); state.index = ES_COSTS.findIndex(([row]) => row === 17); state.costQuery = '광산품';
  const paste = evaluate(expression(money, 'onPaste'), state), old42 = state.input.costs[42];
  let prevented = 0; paste({ clipboardData: { getData: () => '1,000\n2,000' }, preventDefault: () => prevented++ });
  assert.equal(prevented, 1); assert.equal(state.input.costs[17], '1000'); assert.equal(state.input.costs[18], '2000'); assert.equal(state.input.costs[42], old42);
  assert.equal(state.history.current.length, 1);
  const before = JSON.stringify(state.input); paste({ clipboardData: { getData: () => '3\t4\n5\t6' }, preventDefault: () => prevented++ });
  assert.equal(JSON.stringify(state.input), before); assert.equal(state.history.current.length, 1); assert.ok(state.error);
});

test('CF130 leaving filtered costs clears the search before edit-selected-amount returns and focuses the original row ID', () => {
  const state = harness(); state.tab = 'costs'; state.costQuery = '노무비'; state.selectedRow = 14;
  const before = JSON.stringify([state.input, state.document, state.run, state.dirty]);
  const effect = all.find(n => ts.isCallExpression(n) && n.expression.getText(tree) === 'useEffect' && nodes(n.arguments[0]).some(child => ts.isCallExpression(child) && child.expression.getText(tree) === 'setCostQuery')) as ts.CallExpression;
  assert.ok(effect, 'Leaving costs must reset a search that could hide the selected inspector row');
  evaluate(effect.arguments[0], state)(); assert.equal(state.costQuery, '노무비', 'Filtering stays active while using the cost table');
  state.goTab('result'); evaluate(effect.arguments[0], state)(); assert.equal(state.costQuery, '');
  evaluate(expression(button('금액 수정'), 'onClick'), state)();
  assert.equal(state.costQuery, '', 'The selected machinery row must not remain hidden by the prior labor search');
  assert.equal(state.tab, 'costs'); assert.deepEqual(state.focuses, ['es-cost-14']);
  assert.equal(JSON.stringify([state.input, state.document, state.run, state.dirty]), before); assert.deepEqual(state.requests, []);
});

test('CF130 saved status and output readiness distinguish pending, dirty, stale run and current saved revision', () => {
  const status = nodes(byClass('es-toolbar')).find(n => ts.isJsxElement(n) && attribute(n.openingElement, 'role')?.initializer?.getText(tree) === '"status"') as ts.JsxElement;
  assert.ok(status); const text = status.children.find(ts.isJsxExpression)?.expression; assert.ok(text);
  for (const [busy, dirty, doc, expected] of [[true, true, null, '처리 중…'], [false, true, null, '저장하지 않은 변경'], [false, false, null, '새 산출서'], [false, false, { revision: 4 }, '저장됨 · v4']] as const) assert.equal(evaluate(text, { busy, dirty, document: doc }), expected);
  for (const [run, dirty, doc, expected] of [[null, false, { revision: 4 }, false], [{ revision: 4 }, true, { revision: 4 }, false], [{ revision: 3 }, false, { revision: 4 }, false], [{ revision: 4 }, false, { revision: 4 }, true]] as const) {
    const context = { run, dirty, document: doc, selection: ['cover'] };
    assert.equal(evaluate(declaration('outputReady'), context), expected);
    for (const name of ['전체 17시트 Excel', '선택 시트 Excel']) {
      assert.equal(Boolean(evaluate(expression(button(name), 'disabled'), context)), !expected);
      assert.equal(Boolean(evaluate(expression(button(name), 'disabled'), { ...context, selection: [] })), true);
    }
  }
});

test('CF130 list action uses guarded navigation and the next-action status never presents incomplete data as output ready', () => {
  const state = harness(); evaluate(expression(button('산출서 목록'), 'onClick'), state)();
  assert.deepEqual(state.navigations, ['/es']); assert.deepEqual(state.requests, []);
  const next = byClass('es-next-action');
  const status = nodes(next).find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(tree) === 'small') as ts.JsxElement;
  const message = status.children.find(ts.isJsxExpression)?.expression; assert.ok(message);
  assert.equal(evaluate(message, { result: { status: 'INCOMPLETE' }, outputReady: true }), '자료 확인 필요');
  assert.equal(evaluate(message, { result: { status: 'COMPLETE' }, outputReady: false }), '화면 계산 · 저장·계산 필요');
  assert.equal(evaluate(message, { result: { status: 'COMPLETE' }, outputReady: true }), '저장·계산본 출력 가능');
});

test('CF130 Ctrl/Meta+S is page-scoped and cannot save while either nested confirmation dialog owns input', () => {
  const keydown = expression(byClass('es-editor-workspace').openingElement, 'onKeyDown');
  for (const [ctrlKey, metaKey, key, importOpen, sourceOpen, expected] of [[true, false, 's', false, false, 1], [false, true, 'S', false, false, 1], [false, false, 's', false, false, 0], [true, false, 'z', false, false, 0], [true, false, 's', true, false, 0], [false, true, 's', false, true, 0]] as const) {
    let saved = 0, prevented = 0;
    evaluate(keydown, { importOpen, sourceOpen, save: () => { saved++; } })({ ctrlKey, metaKey, key, preventDefault: () => { prevented++; } });
    assert.equal(saved, expected); assert.equal(prevented, expected);
  }
});

test('CF130 wide-work-area toggle changes display state only and leaves draft, selected evidence and stored revision untouched', () => {
  const state = harness(); state.wideMode = false; state.setWideMode = (next: (previous: boolean) => boolean) => { state.wideMode = next(state.wideMode); };
  const toggle = byClass('es-wide-toggle').openingElement;
  assert.equal(attribute(toggle, 'aria-pressed')?.initializer?.getText(tree), '{wideMode}');
  assert.equal(evaluate(expression(byClass('es-editor-workspace').openingElement, 'data-wide'), state), false);
  const before = JSON.stringify([state.input, state.document, state.run, state.dirty, state.selectedRow, state.reviewPeriod]);
  evaluate(expression(toggle, 'onClick'), state)(); assert.equal(state.wideMode, true);
  evaluate(expression(toggle, 'onClick'), state)(); assert.equal(state.wideMode, false);
  assert.equal(JSON.stringify([state.input, state.document, state.run, state.dirty, state.selectedRow, state.reviewPeriod]), before);
  assert.deepEqual(state.requests, []); assert.deepEqual(state.navigations, []);
});
