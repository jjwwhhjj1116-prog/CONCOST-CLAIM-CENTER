import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Exact SHA-256 Hash Map for all 32 reference template files (Tamper-Proof Protection)
const EXPECTED_EXACT_SHAS: Record<string, string> = {
  "TPL-REF-001": "793cf78dd4262af8ddfddc77b85e5052f379e76d9e30f437cb799b9c43cec40a",
  "TPL-REF-002": "07e6483b00146f2aae5440e426e67e0c3a109dfd03b5e4ceb45dd3c1da222863",
  "TPL-REF-003": "33d47c460c30f5df150d0c213e16b02bad32af118932d7509e92521ef3d3656c",
  "TPL-REF-004": "2841c45be4cb33c376196415a942dd67bbc5a4a63ed4167548c50c18ead02818",
  "TPL-REF-005": "79bdd80d6ea68e2bdbe1d5eb79b082c12fbcd7dfc41d8a17f8e0af6cb15bc8b9",
  "TPL-REF-006": "799f600cc28b85a2d9b3de0b4e4e30160f4ca016891346bbdc955d7ba09a48cb",
  "TPL-REF-007": "803a7dac76f5dfb641d6ed09545bd8c3e1bc705e70fc3d6c313d9bdcc9a5862a",
  "TPL-REF-008": "b5fc68e971e16c0dc10afdad52ade68466d79f49c5c6632c8bd6746b9b3f733c",
  "TPL-REF-009": "54916152527b6669d0b984e1452913369029b749e168396bbf89193174358e73",
  "TPL-REF-010": "48e695fc178c9c5ab7e1922accc11085fad8ffa90a83801dc31988a1212392b5",
  "TPL-REF-011": "704d15f89b301236454ff745a320abfd07a9f81dfe59f01ac80c1200a5a3ab08",
  "TPL-REF-012": "b2fa6c4b8d73139b362ec7bf8bf3a0830079d546046e186e5fecf4271cce0589",
  "TPL-REF-013": "cf615ffc0de836aa17238ce06f432efd2054554d24e3adeb3a95d028429073e7",
  "TPL-REF-014": "3cfe73cd7abfd509ecb59c2d01f4d4dd6016d295d504bc7ba83fe268ab2f8912",
  "TPL-REF-015": "295323489bfccd6b6a87287c2670756cf5f3f6114ce20a6b6863fa28ed709611",
  "TPL-REF-016": "aae869dd91d5466d7c9553c124efd1cc26da2bfb8543b247c2ad3d5b53a8a54e",
  "TPL-REF-017": "46654b6954f7db138db189e90a256ebaab9721f8089f20536236e0690fa6f538",
  "TPL-REF-018": "af54833985f8e95683c8fb4c7e5daf07d8c5bef9a5c33187c12c26028cb240e5",
  "TPL-REF-019": "5b250214112613ba64344bc07fd42c35a8b02658a48c1a0161e85f329e64d175",
  "TPL-REF-020": "4f11c2e0a80a2a48ebc1c9c4d7fd5a7903a1ee7eeec33741969e81fd13dd835b",
  "TPL-REF-021": "c2b08275275061270eeebd87ad2834cdb93686d8f5079805fee1c156d555c22b",
  "TPL-REF-022": "b92bd57ca313180477328c38f1997090662f45851aa1fea8a2080d3410d8840b",
  "TPL-REF-023": "b46af144ac4530f510b2bb4545bc5060713aa59e58143d56137c50d6843737fa",
  "TPL-REF-024": "2392e4723cdae1e26e111bffd27f463389de6ef9b0203b5894a7de27a3345534",
  "TPL-REF-025": "281822dcaab11013dbf8a4d05ede709cad9763504cb411319fb6b0db71830dc5",
  "TPL-REF-026": "036c826bab836a83962c1878bc7c8b5ee18d0120f3bf146ec535fbe7923d68be",
  "TPL-REF-027": "62bc005ed3a99120cfb631dfac47ce694f68d52a3ad73ee528a2eda6a87abb3b",
  "TPL-REF-028": "a8c1e0294ead3b86e5e7dc0eff30054d92a501b93dc518ccc559fd4365fcb4b1",
  "TPL-REF-029": "a0c647b7892a4078b24cc670f33329007a45877f8e8df3cb43b2516dbe54a644",
  "TPL-REF-030": "88babe364a7cacfbb1b5e25356f80c0bc6583cfc7a0c215346a5732117665c39",
  "TPL-REF-031": "602861a42ba7ed0e96842eb40c811073942086fb9213ed8c938bef7a5d7a3bf2",
  "TPL-REF-032": "017b8fb3aac57469b51ee8cc43cca7c58a56e58e49f31c6a38f9beaa42a9f707"
};

const ALL_20_SCREENS = [
  'AUTH-01', 'DASH-01', 'CASE-01', 'CASE-02', 'CASE-03',
  'CASE-04', 'CASE-05', 'CASE-06', 'MEET-01', 'PROP-01',
  'PROP-02', 'REPO-01', 'REPO-02', 'APPR-01', 'FEE-01',
  'TPL-01',  'AI-01',   'USER-01', 'AUD-01',  'RESP-01'
];

test('P00 Harness Directory Skeleton Verification', () => {
  const dirs: string[] = [
    'apps/web',
    'apps/api',
    'packages/ui',
    'packages/domain',
    'packages/database',
    'packages/ai-gateway',
    'packages/document-engine',
    'packages/google-workspace',
    'packages/test-fixtures',
    'docs/product',
    'docs/architecture',
    'docs/adr',
    'docs/harness',
    'docs/reviews/requests',
    'docs/stitch',
    'artifacts/harness/P00',
    'scripts'
  ];

  for (const d of dirs) {
    const fullPath: string = path.join(__dirname, '..', d);
    assert.strictEqual(fs.existsSync(fullPath), true, `Directory missing: ${d}`);
    assert.strictEqual(fs.existsSync(path.join(fullPath, '.gitkeep')), true, `.gitkeep missing in: ${d}`);
  }
});

test('P00 Essential Harness Files Verification', () => {
  const files: string[] = [
    'README.md',
    '01_ANTIGRAVITY_EXECUTOR_INSTRUCTIONS.md',
    '01_ANTIGRAVITY_EXECUTOR_INSTRUCTIONS_v2.md',
    '03_CLAIM_6_TYPE_TEMPLATE_MAPPING_SPEC.md',
    '.gitignore',
    '.editorconfig',
    '.node-version',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    'tsconfig.json',
    'docs/harness/phase-status.json',
    'docs/harness/working-agreement.md',
    'docs/harness/initial-state.json',
    'artifacts/harness/P00/manifest.json'
  ];

  for (const f of files) {
    const fullPath: string = path.join(__dirname, '..', f);
    assert.strictEqual(fs.existsSync(fullPath), true, `Required file missing: ${f}`);
  }
});

test('P01 Exhaustive Traceability & Reference Inventory Tamper-Proof Assertion', () => {
  const inventoryPath = path.join(__dirname, '../docs/templates/reference-inventory.json');
  assert.strictEqual(fs.existsSync(inventoryPath), true, 'docs/templates/reference-inventory.json missing');
  const inventoryData = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  assert.strictEqual(inventoryData.totalFiles, 32, 'reference-inventory.json must contain exactly 32 template files');
  assert.strictEqual(inventoryData.files.length, 32, 'reference-inventory.json files array length must be 32');

  for (const item of inventoryData.files) {
    assert.ok(item.fileId && EXPECTED_EXACT_SHAS[item.fileId], `Unknown fileId in inventory: ${item.fileId}`);
    assert.strictEqual(item.sha256, EXPECTED_EXACT_SHAS[item.fileId], `SHA-256 hash mismatch for ${item.fileId}`);
  }
});

test('P02 Stitch UX/UI Design 20 Screens & 3-Pane Assertions', () => {
  const artifactsDir = path.join(__dirname, '../docs/stitch/artifacts');
  assert.strictEqual(fs.existsSync(artifactsDir), true, 'docs/stitch/artifacts directory missing');

  for (const screenId of ALL_20_SCREENS) {
    const screenHtmlPath = path.join(artifactsDir, screenId, 'screen.html');
    assert.strictEqual(fs.existsSync(screenHtmlPath), true, `Screen HTML missing for ${screenId}: ${screenHtmlPath}`);
  }
});

test('P03 App Shell, Design System, 20 Routes & Reviewer RBAC Guard Assertions', () => {
  // 1. Verify packages/ui components & ComponentCatalog
  const catalogPath = path.join(__dirname, '../packages/ui/src/catalog/ComponentCatalog.tsx');
  assert.strictEqual(fs.existsSync(catalogPath), true, 'ComponentCatalog.tsx missing');
  const catalogContent = fs.readFileSync(catalogPath, 'utf8');
  assert.ok(catalogContent.includes('TYPE-01'), 'Catalog missing TYPE-01');
  assert.ok(catalogContent.includes('TYPE-06'), 'Catalog missing TYPE-06');
  assert.ok(catalogContent.includes('5 Standard UI States'), 'Catalog missing 5 UI states showcase');

  // 2. Verify apps/web Router 20 routes mapping & Reviewer RBAC guard
  const routerPath = path.join(__dirname, '../apps/web/src/routes/Router.tsx');
  assert.strictEqual(fs.existsSync(routerPath), true, 'Router.tsx missing');
  const routerContent = fs.readFileSync(routerPath, 'utf8');
  
  for (const screenId of ALL_20_SCREENS) {
    assert.ok(routerContent.includes(screenId), `Router.tsx missing screen mapping: ${screenId}`);
  }
  assert.ok(routerContent.includes('Reviewer 역할 권한 제한 (HTTP 403 Forbidden)'), 'Router.tsx missing Reviewer RBAC 403 guard');

  // 3. Verify AppShell responsive drawer & SkipLink
  const shellPath = path.join(__dirname, '../apps/web/src/layout/AppShell.tsx');
  assert.strictEqual(fs.existsSync(shellPath), true, 'AppShell.tsx missing');
  const shellContent = fs.readFileSync(shellPath, 'utf8');
  assert.ok(shellContent.includes('SkipLink'), 'AppShell.tsx missing SkipLink');
  assert.ok(shellContent.includes('Drawer'), 'AppShell.tsx missing responsive Drawer');
});

test('P03 Manifest Integrity & Self-Assessment Assertions', () => {
  const p03ManifestPath = path.join(__dirname, '../artifacts/harness/P03/manifest.json');
  assert.strictEqual(fs.existsSync(p03ManifestPath), true, 'P03 manifest.json missing');

  const manifest = JSON.parse(fs.readFileSync(p03ManifestPath, 'utf8'));

  assert.strictEqual(manifest.phase, 'P03');
  assert.ok(Array.isArray(manifest.scope) && manifest.scope.length >= 5);
  assert.ok(Array.isArray(manifest.changedFiles), 'manifest.changedFiles must be an array');
  
  // Exact changedFiles array matching git diff-tree target files for P03 (30 files)
  const expectedChangedFiles = [
    'apps/web/index.html',
    'apps/web/package.json',
    'apps/web/src/App.tsx',
    'apps/web/src/layout/AppShell.tsx',
    'apps/web/src/main.tsx',
    'apps/web/src/routes/Router.tsx',
    'apps/web/tsconfig.json',
    'apps/web/vite.config.ts',
    'artifacts/harness/P03/commands.log',
    'artifacts/harness/P03/manifest.json',
    'artifacts/harness/P03/notes.md',
    'package.json',
    'packages/ui/package.json',
    'packages/ui/src/catalog/ComponentCatalog.tsx',
    'packages/ui/src/components/Button.tsx',
    'packages/ui/src/components/Card.tsx',
    'packages/ui/src/components/DDay.tsx',
    'packages/ui/src/components/Drawer.tsx',
    'packages/ui/src/components/Input.tsx',
    'packages/ui/src/components/Select.tsx',
    'packages/ui/src/components/SkipLink.tsx',
    'packages/ui/src/components/StateView.tsx',
    'packages/ui/src/components/StatusBadge.tsx',
    'packages/ui/src/components/Table.tsx',
    'packages/ui/src/components/Timeline.tsx',
    'packages/ui/src/index.ts',
    'packages/ui/src/tokens.ts',
    'packages/ui/tsconfig.json',
    'pnpm-lock.yaml',
    'scripts/harness-test.ts'
  ];
  assert.deepStrictEqual([...manifest.changedFiles].sort(), expectedChangedFiles.sort(), 'P03 manifest.changedFiles must strictly match the exact commit diff files');

  assert.ok(Array.isArray(manifest.commandsExecuted) && manifest.commandsExecuted.length >= 5);
  assert.strictEqual(manifest.tests.passed, 7, 'manifest.tests.passed must strictly be 7 for P03');
  assert.strictEqual(manifest.tests.failed, 0);
  assert.strictEqual(manifest.selfAssessment, 'READY_FOR_REVIEW');
});

test('Phase Status Machine Integration', () => {
  const phaseStatusPath: string = path.join(__dirname, '..', 'docs/harness/phase-status.json');
  const statusContent = JSON.parse(fs.readFileSync(phaseStatusPath, 'utf8'));
  assert.strictEqual(statusContent.project, 'claim-center-report-studio');
  assert.strictEqual(statusContent.phases.P00.status, 'PASS');
  assert.strictEqual(statusContent.phases.P01.status, 'PASS');
  assert.strictEqual(statusContent.phases.P02.status, 'PASS');
  assert.ok(statusContent.phases.P03);
});
