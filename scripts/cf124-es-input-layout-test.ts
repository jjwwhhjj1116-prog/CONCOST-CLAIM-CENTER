import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { ES_CONTRACT_FIELDS, calculateEs, newEsInput } from '../packages/document-engine/src/es-calculation';

// Source-contract checks only. Real responsive/contrast/input interaction is verified in the browser suite.
const source = readFileSync('apps/web/src/es/EsStudio.tsx', 'utf8');
const css = readFileSync('apps/web/src/es/EsStudio.css', 'utf8');
const tree = ts.createSourceFile('EsStudio.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function nodes(root: ts.Node): ts.Node[] {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node) => { result.push(node); node.forEachChild(visit); };
  visit(root); return result;
}
const basic = nodes(tree).find(node => ts.isBinaryExpression(node)
  && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  && node.left.getText(tree) === "tab === 'input'");
assert.ok(basic, 'basic input tab must exist');
const calls = nodes(basic).filter(ts.isCallExpression);
const groups = calls.filter(node => node.expression.getText(tree) === 'contractFields');
const direct = calls.filter(node => node.expression.getText(tree) === 'field');

test('CF124 all 21 contract keys render exactly once across the basic groups', () => {
  const keys = groups.flatMap(call => {
    const list = call.arguments[0]; assert.ok(ts.isArrayLiteralExpression(list));
    return list.elements.map(item => { assert.ok(ts.isStringLiteral(item)); return item.text; });
  });
  assert.equal(keys.length, 21); assert.equal(new Set(keys).size, 21);
  assert.deepEqual([...keys].sort(), ES_CONTRACT_FIELDS.map(([key]) => key).sort());
});

test('CF124 six original main inputs and project selector preserve their write targets', () => {
  const keys = direct.map(call => {
    const value = call.arguments[1]; assert.ok(ts.isPropertyAccessExpression(value));
    assert.equal(value.expression.getText(tree), 'input');
    const key = value.name.text;
    assert.match(call.arguments[2].getText(tree), new RegExp(`mutate\\(n => \\{ n\\.${key} = v; \\}\\)`));
    return key;
  });
  assert.deepEqual(keys.sort(), ['title', 'client', 'contractor', 'baseDate', 'adjustmentDate', 'contractAmount'].sort());
  const selects = nodes(basic).filter(node => ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'select');
  assert.equal(selects.length, 1);
  assert.match(selects[0].getText(tree), /value=\{caseId\} onChange=\{e => setCaseId\(e\.target\.value\)\}/);
  assert.equal(direct.length + ES_CONTRACT_FIELDS.length + selects.length, 28);
});

test('CF124 native dates, empty strings and the existing contract mutation path are preserved', () => {
  const helper = nodes(tree).find(node => ts.isVariableDeclaration(node) && node.name.getText(tree) === 'contractFields');
  assert.ok(helper);
  assert.match(helper.getText(tree), /input\.contract\?\.\[key\] \?\? ''/);
  assert.match(helper.getText(tree), /mutate\(n => \{ n\.contract \?\?= newEsContract\(\); n\.contract\[key\] = v; \}\)/);
  assert.match(helper.getText(tree), /type === 'date' \? 'date' : 'text'/);
  const dates = direct.filter(call => call.arguments[3] && ts.isStringLiteral(call.arguments[3]) && call.arguments[3].text === 'date');
  assert.deepEqual(dates.map(call => call.arguments[1].getText(tree)).sort(), ['input.adjustmentDate', 'input.baseDate']);
  assert.equal(dates.length + ES_CONTRACT_FIELDS.filter(([, , type]) => type === 'date').length, 12);
});

test('CF124 semantic groups retain unique headings and the existing busy fieldset', () => {
  const basicText = basic.getText(tree);
  const ids = [...basicText.matchAll(/<h2 id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 5); assert.equal(new Set(ids).size, 5);
  for (const id of ids) assert.ok(basicText.includes(`<section aria-labelledby="${id}">`));
  const headings = nodes(basic).filter(ts.isJsxElement).filter(node => node.openingElement.tagName.getText(tree) === 'h2');
  assert.deepEqual(headings.map(node => node.children.map(child => child.getText(tree)).join('').trim().match(/^[1-5]\./)?.[0]), ['1.', '2.', '3.', '4.', '5.']);
  assert.match(source, /<fieldset disabled=\{busy\} className="es-workspace">/);
});

test('CF124/126 yellow stays ES-scoped while optional basic fields use the neutral theme surface', () => {
  const rule = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/([^{}]+)\{[^{}]*--field-bg:\s*#fff5cc;[^{}]*\}/);
  assert.ok(rule, 'editable field token must be defined, not only a background fallback');
  assert.ok(rule[1].trim().startsWith('.es-studio '));
  for (const guard of [':not([type=checkbox])', ':not([type=file])', ':not(:disabled)', ':not([readonly])']) assert.ok(rule[1].includes(guard), guard);
  assert.match(rule[0], /color:\s*#183049/);
  assert.match(rule[0], /color-scheme:\s*light/);
  const studio = css.match(/\.es-studio\s*\{([^}]+)\}/)?.[1] ?? '';
  assert.match(studio, /--surface:var\(--surface-raised,#fff\)/);
  assert.match(studio, /--surface-muted:var\(--surface-soft,#eef4f9\)/);
  assert.match(css, /\.es-tabs \[aria-current=page\]\s*\{[^}]*color:#183049/);
  const optional = css.match(/\.es-studio \.es-basic-input :is\(input,select\):not\(\[aria-required=true\]\):not\(:disabled\):not\(\[readonly\]\)\s*\{([^}]+)\}/);
  assert.ok(optional, 'Only optional basic inputs/selects override yellow, not all ES fields');
  assert.match(optional[1], /--field-bg:var\(--surface,#fff\)/);
  assert.match(optional[1], /background-color:var\(--field-bg\)/);
  assert.match(optional[1], /color:var\(--text-primary,#183049\)/);
  assert.match(optional[1], /color-scheme:normal/);
});

test('CF124 compact columns are scoped to basic input, leaving the deductions grid unchanged', () => {
  assert.match(css, /\.es-basic-grid\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /\.es-grid\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.es-basic-input\s*\{\s*container-type:inline-size;/);
  assert.match(css, /@container\(max-width:1150px\)/);
  assert.match(css, /@container\(max-width:650px\)/);
  assert.match(css, /@container\(max-width:380px\)/);
});

test('CF126 exactly four basic fields are marked by save/calculation purpose; 24 remain optional', () => {
  const required = direct.filter(call => call.arguments[4]).map(call => {
    const value = call.arguments[1], requirement = call.arguments[4];
    assert.ok(ts.isPropertyAccessExpression(value)); assert.ok(ts.isStringLiteral(requirement));
    return [value.name.text, requirement.text];
  });
  assert.deepEqual(required, [['title', '저장 필수'], ['baseDate', '계산 필수'], ['adjustmentDate', '계산 필수'], ['contractAmount', '계산 필수']]);
  assert.equal(28 - required.length, 24);
  const field = nodes(tree).find(node => ts.isVariableDeclaration(node) && node.name.getText(tree) === 'field') as ts.VariableDeclaration;
  assert.ok(field.initializer && ts.isArrowFunction(field.initializer));
  assert.equal(field.initializer.parameters[4].name.getText(tree), 'requirement');
  assert.equal(field.initializer.parameters[4].initializer?.getText(tree), "''");
  assert.match(field.getText(tree), /aria-required=\{requirement \? true : undefined\}/);
  const control = nodes(field).find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'input') as ts.JsxSelfClosingElement;
  assert.ok(control);
  assert.equal(control.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(tree) === 'required'), false, 'ARIA hints must not introduce native form gating for incomplete draft saves');
  const contract = nodes(tree).find(node => ts.isVariableDeclaration(node) && node.name.getText(tree) === 'contractFields');
  assert.ok(contract);
  for (const call of nodes(contract).filter(ts.isCallExpression).filter(call => call.expression.getText(tree) === 'field')) assert.equal(call.arguments.length, 4);
  const project = nodes(basic).find(node => ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'select')!;
  assert.equal(project.getText(tree).includes('aria-required'), false);
});

test('CF126 project link remains optional, describes save semantics, and requests assigned projects', () => {
  const basicText = basic.getText(tree);
  assert.match(basicText, /aria-describedby="es-project-help"/);
  assert.match(basicText, /<p id="es-project-help"/);
  assert.ok(basicText.includes('선택한 뒤 저장하면 연결됩니다'));
  assert.ok(basicText.includes('연결만으로 계약정보가 자동 입력되지는 않으며'));
  assert.ok(basicText.includes('<option value="">연결 없이 독립 산출서</option>'));
  assert.ok(basicText.includes('현재 연결 프로젝트 (목록 확인 필요)'));
  const projectRequests = nodes(tree).filter(ts.isCallExpression).filter(call => call.expression.getText(tree) === 'apiRequest' && call.arguments[0] && ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text.startsWith('/api/cases?'));
  assert.equal(projectRequests.length, 1);
  assert.equal((projectRequests[0].arguments[0] as ts.StringLiteral).text, '/api/cases?limit=100&assignedOnly=true');
});

test('CF126 required calculation fields block missing values while blank contract metadata remains optional', () => {
  const input = newEsInput(); input.baseDate = '2026-01-01'; input.adjustmentDate = '2026-02-01'; input.contractAmount = '1000000'; input.costs['11'] = '100000';
  for (const [period, date] of [[input.base, input.baseDate], [input.current.period, input.adjustmentDate], [input.previous.period, '2026-01-31']] as const) {
    period.date = date; period.wage = '100'; period.materials = ['100', '100', '100', '100'];
    for (const key of Object.keys(period.rates) as Array<keyof typeof period.rates>) period.rates[key] = '1';
  }
  for (const comparison of [input.current, input.previous]) for (const pair of [comparison.machinery, ...comparison.standards]) Object.assign(pair, { baseAverage: '100', comparisonAverage: '100', commonCount: '1' });
  assert.equal(calculateEs(input).status, 'LEGACY_REPLAY');
  assert.ok(ES_CONTRACT_FIELDS.every(([key]) => input.contract?.[key] === ''));
  const noMetadata = structuredClone(input); delete noMetadata.contract;
  assert.equal(calculateEs(noMetadata).status, 'LEGACY_REPLAY');
  for (const key of ['baseDate', 'adjustmentDate', 'contractAmount'] as const) {
    const missing = structuredClone(input); missing[key] = '';
    assert.equal(calculateEs(missing).status, 'INCOMPLETE', key);
  }
  // Title is a save requirement enforced in es-service; the calculation itself does not require identity metadata.
  const noIdentity = structuredClone(input); noIdentity.title = ''; noIdentity.client = ''; noIdentity.contractor = '';
  assert.equal(calculateEs(noIdentity).status, 'LEGACY_REPLAY');
});
