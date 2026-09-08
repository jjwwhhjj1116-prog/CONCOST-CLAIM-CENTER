import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { ES_CONTRACT_FIELDS } from '../packages/document-engine/src/es-calculation';

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
  assert.match(source, /<fieldset disabled=\{busy\} className="es-workspace">/);
});

test('CF124 editable yellow token is ES-scoped and excludes non-editable/native special controls', () => {
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
});

test('CF124 compact columns are scoped to basic input, leaving the deductions grid unchanged', () => {
  assert.match(css, /\.es-basic-grid\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /\.es-grid\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.es-basic-input\s*\{\s*container-type:inline-size;/);
  assert.match(css, /@container\(max-width:1150px\)/);
  assert.match(css, /@container\(max-width:650px\)/);
  assert.match(css, /@container\(max-width:380px\)/);
});
