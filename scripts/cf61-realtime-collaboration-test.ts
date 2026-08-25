import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('CF61 activates Yjs and Hocuspocus only when the private runtime URL exists', () => {
  const editor = read('apps/web/src/documents/StructuredDocumentEditor.tsx');
  const webPackage = read('apps/web/package.json');
  const index = read('apps/web/index.html');
  const runtime = read('apps/web/public/runtime-config.js');
  for (const marker of [
    'HocuspocusProvider',
    'Collaboration.configure',
    'CollaborationCaret.configure',
    'sessionAwareness: true',
    'flushDelay: 250',
    "'/api/collaboration/token'",
    'credentials: \'include\'',
    'Yjs + Hocuspocus CRDT'
  ]) assert.ok(editor.includes(marker), `missing collaboration bridge marker: ${marker}`);
  assert.match(editor, /if \(collaboration && collaborationUrl\)/u);
  assert.match(editor, /claim-center:\$\{runtime\.__CLAIM_CENTER_SESSION_USER__\?\.organizationId \?\? 'unknown'\}:\$\{implicitDocumentKey\}/u);
  assert.ok(editor.includes("replace(/^report-step(?:3|4)-/u, 'report-')"));
  for (const dependency of ['@hocuspocus/provider', '@tiptap/extension-collaboration', '@tiptap/extension-collaboration-caret', 'yjs']) {
    assert.ok(webPackage.includes(`"${dependency}"`), `missing collaboration dependency: ${dependency}`);
  }
  assert.match(index, /<script src="\/runtime-config\.js"><\/script>/u);
  assert.doesNotMatch(runtime, /eyJ[A-Za-z0-9_-]+\.|api[_-]?key\s*=|password\s*=/iu);
});

test('CF61 binds collaboration identity to the authenticated session', () => {
  const app = read('apps/web/src/App.tsx');
  const editor = read('apps/web/src/documents/StructuredDocumentEditor.tsx');
  assert.match(app, /__CLAIM_CENTER_SESSION_USER__/u);
  assert.match(app, /organizationId: session\.organizationId/u);
  assert.match(editor, /runtime\.__CLAIM_CENTER_SESSION_USER__\?\.name/u);
  assert.match(editor, /runtime\.__CLAIM_CENTER_SESSION_USER__\?\.email/u);
  assert.match(editor, /body: JSON\.stringify\(\{ documentName: collaboration\.documentId \}\)/u);
});

test('CF61 hands the Vietnam team an exact JWT, persistence, proxy, HWP and two-account acceptance contract', () => {
  const handoff = read('docs/runbooks/vietnam-yjs-hocuspocus-handoff.md');
  const tokenService = read('docs/vietnam-server-kit/api/collaboration-token-service.example.ts');
  const collaborationServer = read('docs/vietnam-server-kit/collaboration-server/src/server.ts');
  for (const marker of [
    'POST /api/collaboration/token',
    '5분',
    'documentName',
    'organizationId',
    'onAuthenticate',
    'onLoadDocument',
    'onStoreDocument',
    'Y.encodeStateAsUpdate',
    'collaboration_documents',
    'proxy_set_header Upgrade',
    '서로 다른 승인 계정 A/B',
    '__CLAIM_CENTER_RHWP_STUDIO_URL__',
    '빈 화면에서 새 HWP binary를 만드는 API는 rhwp v0.8.4에 없으므로'
  ]) assert.ok(handoff.includes(marker), `missing Vietnam collaboration handoff marker: ${marker}`);
  assert.match(tokenService, /authorization\.locked \? 'read' : authorization\.permission/u);
  assert.match(collaborationServer, /requestHeaders\.get\('origin'\) !== env\.APP_ORIGIN/u);
});

test('CF61 prevents a false HWP blank-document export path', () => {
  const dialog = read('apps/web/src/documents/RhwpEditorDialog.tsx');
  assert.match(dialog, /if \(!hasImportedTemplate\)/u);
  assert.match(dialog, /disabled=\{busy \|\| !hasImportedTemplate\}/u);
  assert.match(dialog, /빈 HWP 생성 API를 제공하지 않습니다/u);
  assert.match(dialog, /exportHwpVerify/u);
});
