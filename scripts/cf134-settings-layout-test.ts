import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Actual component AST/handlers with isolated state, not browser-layout evidence.
// Existing Worker/Node tests separately cover permissions, encryption and storage.
const source = readFileSync('apps/web/src/routes/PreviewSettings.tsx', 'utf8');
const tree = ts.createSourceFile('PreviewSettings.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function nodes(root: ts.Node = tree): ts.Node[] { const result: ts.Node[] = []; const visit = (node: ts.Node) => { result.push(node); node.forEachChild(visit); }; visit(root); return result; }
const all = nodes();
function declaration(name: string) {
  const node = all.find(n => ts.isVariableDeclaration(n) && n.name.getText(tree) === name) as ts.VariableDeclaration | undefined;
  assert.ok(node?.initializer, name); return node.initializer;
}
function evaluate(node: ts.Node, context: Record<string, any> = {}): any {
  const code = ts.transpileModule(`globalThis.__result=(${node.getText(tree)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
  runInNewContext(code, context); return context.__result;
}
function attribute(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
  return node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(tree) === name) as ts.JsxAttribute | undefined;
}
function classElement(name: string) {
  const found = all.find(n => ts.isJsxElement(n) && attribute(n.openingElement, 'className')?.initializer?.getText(tree).replaceAll('"', '').split(' ').includes(name));
  assert.ok(found && ts.isJsxElement(found), name); return found;
}
function tagged(name: string, root: ts.Node = tree) {
  return nodes(root).filter(n => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(tree) === name) as Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement>;
}
function adminBranch() {
  const found = all.find(n => ts.isBinaryExpression(n) && ts.isJsxFragment(n.right) && n.left.getText(tree).includes("section === 'ADMIN'"));
  assert.ok(found && ts.isBinaryExpression(found) && ts.isJsxFragment(found.right)); return found;
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
function harness(isAdmin = true) {
  const state: Record<string, any> = { isAdmin, loading: false, error: '', notice: '', payload: null, aiConfig: null, aiGovernance: null, proposalPromptProfiles: [], selectedProposalPromptSourceId: '', requests: [], Error };
  for (const name of ['Loading', 'Error', 'Notice', 'Payload', 'AiConfig', 'AiGovernance', 'ProposalPromptProfiles', 'SelectedProposalPromptSourceId', 'SelectedModels', 'Busy']) {
    const key = name[0].toLowerCase() + name.slice(1); state['set' + name] = (value: any) => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  }
  state.MODEL_CHOICES = evaluate(declaration('MODEL_CHOICES')); state.PRIMARY_TASK = evaluate(declaration('PRIMARY_TASK'));
  state.apiRequest = async (path: string, init?: RequestInit) => {
    state.requests.push({ path, method: init?.method ?? 'GET' });
    if (state.fail === path) throw new Error('synthetic lookup failure');
    if (path === '/api/settings/ai-credentials') return { providers: [], masterKeyReady: true };
    if (path === '/api/settings/ai-governance') return { governance: { providerServiceTier: 'UNVERIFIED_OR_FREE', confidentialExternalAiEnabled: false } };
    if (path === '/api/proposal-studio/config') return { promptProfiles: [{ templateSourceId: 'CF134-SYNTHETIC', chapters: [] }] };
    if (path === '/api/admin/report-prompts') return { aiConfig: { providers: [{ providerKind: 'GEMINI', models: [{ code: 'gemini-3.7-flash' }] }], routes: [] } };
    throw new Error('Unexpected request: ' + path);
  };
  return state;
}

test('CF134 actual admin loading no longer depends on Hermes, memory or workspace policy and never writes them', async () => {
  const state = harness(); await evaluate(declaration('load'), state)();
  assert.deepEqual(state.requests, [
    { path: '/api/settings/ai-credentials', method: 'GET' },
    { path: '/api/settings/ai-governance', method: 'GET' },
    { path: '/api/proposal-studio/config', method: 'GET' },
    { path: '/api/admin/report-prompts', method: 'GET' }
  ]);
  assert.equal(state.loading, false); assert.equal(state.error, '');
  assert.equal(state.selectedProposalPromptSourceId, 'CF134-SYNTHETIC'); assert.equal(state.selectedModels.GEMINI, 'gemini-3.7-flash');
  assert.doesNotMatch(source, /Hermes|hermes|MemoryCandidate|memoryCandidates|saveWorkspace|decideMemory/);
});

test('CF134 non-admin loading cannot request admin configuration and the actual admin render guard rejects personal/staff states', async () => {
  const state = harness(false); await evaluate(declaration('load'), state)();
  assert.deepEqual(state.requests, [{ path: '/api/settings/ai-credentials', method: 'GET' }]);
  for (const [section, isAdmin, expected] of [['ADMIN', true, true], ['ADMIN', false, false], ['PERSONAL', true, false], ['PERSONAL', false, false]] as const) {
    assert.equal(Boolean(evaluate(adminBranch().left, { section, isAdmin })), expected);
  }
  const router = readFileSync('apps/web/src/routes/Router.tsx', 'utf8');
  assert.match(router, /path: '\/ai-config'[^\n]*allowedRoles: ADMIN_ONLY/);
  assert.match(router, /currentRoute\.id === 'AI-01'\) return <PreviewAiAdmin \/>/);
});

test('CF134 optional governance lookup failure does not discard usable settings; primary lookup failure ends loading without any write', async () => {
  const optional = harness(); optional.fail = '/api/settings/ai-governance'; await evaluate(declaration('load'), optional)();
  assert.equal(optional.error, ''); assert.equal(optional.aiGovernance, null); assert.ok(optional.aiConfig); assert.equal(optional.proposalPromptProfiles.length, 1); assert.equal(optional.loading, false);
  const failed = harness(); failed.fail = '/api/settings/ai-credentials'; await evaluate(declaration('load'), failed)();
  assert.equal(failed.loading, false); assert.equal(failed.payload, null); assert.equal(failed.error, 'synthetic lookup failure'); assert.equal(failed.requests.length, 1);
});

test('CF134 proposal and report instructions are adjacent collapsed native disclosures, with the existing report editor embedded once', () => {
  const proposal = classElement('proposal-prompt-settings-card'), report = classElement('report-prompt-settings-card');
  for (const disclosure of [proposal, report]) {
    assert.equal(disclosure.openingElement.tagName.getText(tree), 'details'); assert.equal(attribute(disclosure.openingElement, 'open'), undefined);
    assert.equal(tagged('summary', disclosure).length, 1);
  }
  const branch = adminBranch().right as ts.JsxFragment, children = branch.children.filter(n => !(ts.isJsxText(n) && !n.text.trim()));
  assert.equal(children[0], proposal); assert.equal(children[1], report);
  const embedded = tagged('PreviewAiAdmin', report); assert.equal(embedded.length, 1); assert.ok(attribute(embedded[0], 'embedded'));
  assert.equal(tagged('PreviewAiAdmin').length, 1); assert.ok(nodes(proposal).some(n => ts.isIdentifier(n) && n.text === 'saveProposalPromptProfile'));
  assert.ok(nodes(proposal).some(n => ts.isIdentifier(n) && n.text === 'saveProposalPrompt'));
});

test('CF134 one organization credential card contains both external API rows; personal credentials cannot render those rows', () => {
  const render = declaration('renderCredentials'), section = classElement('external-api-settings');
  assert.ok(nodes(render).includes(section));
  const condition = section.parent; assert.ok(ts.isBinaryExpression(condition));
  assert.equal(Boolean(evaluate(condition.left, { scope: 'USER' })), false); assert.equal(Boolean(evaluate(condition.left, { scope: 'ORGANIZATION' })), true);
  for (const tag of ['PreviewLawApiSettings', 'PreviewEcosApiSettings']) { assert.equal(tagged(tag).length, 1); assert.equal(tagged(tag, section).length, 1); }
  const credentialCalls = nodes(adminBranch().right).filter(ts.isCallExpression).filter(n => n.expression.getText(tree) === 'renderCredentials');
  assert.equal(credentialCalls.length, 1); assert.equal(credentialCalls[0].arguments[0].getText(tree), "'ORGANIZATION'");
  assert.equal(all.filter(n => ts.isJsxAttribute(n) && n.name.getText(tree) === 'id' && n.initializer?.getText(tree) === '"external-api-help"').length, 1);
});

test('CF134 keeps the single working Drive control and user navigation, with honest platform status last', () => {
  const branch = adminBranch().right as ts.JsxFragment;
  assert.equal(tagged('PreviewGoogleDriveSetup').length, 1); assert.equal(tagged('PreviewGoogleDriveSetup', branch).length, 1);
  assert.equal(attribute(tagged('PreviewGoogleDriveSetup')[0], 'onNavigate')?.initializer?.getText(tree), '{onNavigate}');
  assert.doesNotMatch(source, /onNavigate\('\/integrations\/google'\)/);
  const advanced = all.filter(ts.isCallExpression).filter(n => n.expression.getText(tree) === 'onNavigate' && n.arguments[0]?.getText(tree) === "'/ai-config'");
  assert.equal(advanced.length, 1); assert.ok(nodes(classElement('report-prompt-settings-card')).includes(advanced[0]));
  assert.match(source, /onNavigate\('\/users'\)/);
  const children = branch.children.filter(n => !(ts.isJsxText(n) && !n.text.trim())); assert.equal(children.at(-1), classElement('document-platform-status-card'));
  const platform = classElement('document-platform-status-card');
  assert.deepEqual(tagged('article', platform).map(n => attribute(n, 'data-platform-status')?.initializer?.getText(tree)), ['"active"', '"active"', '"active"', '"server"', '"server"']);
  assert.match(platform.getText(tree), /준비 중인 기능을 작동하는 것처럼 표시하지 않습니다/);
});

test('CF134 actual proposal common/chapter saves retain exact versions and unrelated template state', async () => {
  for (const kind of ['common', 'chapter'] as const) {
    const state = harness(), profile = { templateSourceId: 'CF134-SYNTHETIC', templateSourceName: '합성 템플릿', templateCategory: 'GENERAL_CLAIM', systemInstruction: '합성 공통 규칙', validationInstruction: '합성 검수 규칙', isActive: true, version: 7, chapters: [{ chapterNumber: 2, chapterTitle: '합성 쟁점', instructionText: '합성 챕터 규칙', isActive: true, version: 4 }] };
    const other = { templateSourceId: 'CF134-OTHER', version: 99 }; state.proposalPromptProfiles = [structuredClone(profile), structuredClone(other)];
    const updated = structuredClone(profile); if (kind === 'common') updated.version++; else updated.chapters[0].version++;
    const calls: any[] = []; state.apiRequest = async (path: string, init: RequestInit) => { calls.push({ path, method: init.method, body: JSON.parse(String(init.body)) }); return { profile: updated }; };
    state.replaceProposalPromptProfile = evaluate(declaration('replaceProposalPromptProfile'), state);
    const save = evaluate(declaration(kind === 'common' ? 'saveProposalPromptProfile' : 'saveProposalPrompt'), state); await save(profile, profile.chapters[0]);
    assert.deepEqual(json(state.proposalPromptProfiles), [updated, other]); assert.equal(state.busy, '');
    assert.deepEqual(calls, [{ path: '/api/proposal-studio/prompt-profiles/CF134-SYNTHETIC' + (kind === 'chapter' ? '/chapters/2' : ''), method: 'PUT', body: kind === 'common' ? { templateCategory: profile.templateCategory, systemInstruction: profile.systemInstruction, validationInstruction: profile.validationInstruction, isActive: true, version: 7 } : { chapterTitle: profile.chapters[0].chapterTitle, instructionText: profile.chapters[0].instructionText, isActive: true, version: 4 } }]);
  }
});

test('CF134 proposal save conflicts preserve unsaved template instructions and release the busy state', async () => {
  class SyntheticApiError extends Error { constructor(readonly status: number) { super('synthetic conflict'); } }
  for (const name of ['saveProposalPromptProfile', 'saveProposalPrompt']) {
    const state = harness(); state.ApiError = SyntheticApiError;
    const profile = { templateSourceId: 'CF134-SYNTHETIC', systemInstruction: 'unsaved', version: 5, chapters: [{ chapterNumber: 2, instructionText: 'unsaved chapter', version: 3 }] };
    state.proposalPromptProfiles = [profile]; const before = JSON.stringify(profile);
    state.apiRequest = async () => { throw new SyntheticApiError(409); }; state.replaceProposalPromptProfile = () => { assert.fail('failed save may not replace the draft'); };
    await evaluate(declaration(name), state)(profile, profile.chapters[0]);
    assert.equal(JSON.stringify(state.proposalPromptProfiles[0]), before); assert.equal(state.busy, ''); assert.match(state.error, /다른 관리자/); assert.equal(state.notice, '');
  }
});
