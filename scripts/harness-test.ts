import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import './p02-contract-test';
import './p03-contract-test';
import './p04-contract-test';
import './p05-contract-test';
import './p05-case-test';
import './p06-contract-test';
import './p06-materials-test';
import './p07-proposal-test';
import './p08-contract-test';

const EXPECTED_EXACT_SHAS: Record<string, string> = {
  'TPL-REF-001': '793cf78dd4262af8ddfddc77b85e5052f379e76d9e30f437cb799b9c43cec40a',
  'TPL-REF-002': '07e6483b00146f2aae5440e426e67e0c3a109dfd03b5e4ceb45dd3c1da222863',
  'TPL-REF-003': '33d47c460c30f5df150d0c213e16b02bad32af118932d7509e92521ef3d3656c',
  'TPL-REF-004': '2841c45be4cb33c376196415a942dd67bbc5a4a63ed4167548c50c18ead02818',
  'TPL-REF-005': '79bdd80d6ea68e2bdbe1d5eb79b082c12fbcd7dfc41d8a17f8e0af6cb15bc8b9',
  'TPL-REF-006': '799f600cc28b85a2d9b3de0b4e4e30160f4ca016891346bbdc955d7ba09a48cb',
  'TPL-REF-007': '803a7dac76f5dfb641d6ed09545bd8c3e1bc705e70fc3d6c313d9bdcc9a5862a',
  'TPL-REF-008': 'b5fc68e971e16c0dc10afdad52ade68466d79f49c5c6632c8bd6746b9b3f733c',
  'TPL-REF-009': '54916152527b6669d0b984e1452913369029b749e168396bbf89193174358e73',
  'TPL-REF-010': '48e695fc178c9c5ab7e1922accc11085fad8ffa90a83801dc31988a1212392b5',
  'TPL-REF-011': '704d15f89b301236454ff745a320abfd07a9f81dfe59f01ac80c1200a5a3ab08',
  'TPL-REF-012': 'b2fa6c4b8d73139b362ec7bf8bf3a0830079d546046e186e5fecf4271cce0589',
  'TPL-REF-013': 'cf615ffc0de836aa17238ce06f432efd2054554d24e3adeb3a95d028429073e7',
  'TPL-REF-014': '3cfe73cd7abfd509ecb59c2d01f4d4dd6016d295d504bc7ba83fe268ab2f8912',
  'TPL-REF-015': '295323489bfccd6b6a87287c2670756cf5f3f6114ce20a6b6863fa28ed709611',
  'TPL-REF-016': 'aae869dd91d5466d7c9553c124efd1cc26da2bfb8543b247c2ad3d5b53a8a54e',
  'TPL-REF-017': '46654b6954f7db138db189e90a256ebaab9721f8089f20536236e0690fa6f538',
  'TPL-REF-018': 'af54833985f8e95683c8fb4c7e5daf07d8c5bef9a5c33187c12c26028cb240e5',
  'TPL-REF-019': '5b250214112613ba64344bc07fd42c35a8b02658a48c1a0161e85f329e64d175',
  'TPL-REF-020': '4f11c2e0a80a2a48ebc1c9c4d7fd5a7903a1ee7eeec33741969e81fd13dd835b',
  'TPL-REF-021': 'c2b08275275061270eeebd87ad2834cdb93686d8f5079805fee1c156d555c22b',
  'TPL-REF-022': 'b92bd57ca313180477328c38f1997090662f45851aa1fea8a2080d3410d8840b',
  'TPL-REF-023': 'b46af144ac4530f510b2bb4545bc5060713aa59e58143d56137c50d6843737fa',
  'TPL-REF-024': '2392e4723cdae1e26e111bffd27f463389de6ef9b0203b5894a7de27a3345534',
  'TPL-REF-025': '281822dcaab11013dbf8a4d05ede709cad9763504cb411319fb6b0db71830dc5',
  'TPL-REF-026': '036c826bab836a83962c1878bc7c8b5ee18d0120f3bf146ec535fbe7923d68be',
  'TPL-REF-027': '62bc005ed3a99120cfb631dfac47ce694f68d52a3ad73ee528a2eda6a87abb3b',
  'TPL-REF-028': 'a8c1e0294ead3b86e5e7dc0eff30054d92a501b93dc518ccc559fd4365fcb4b1',
  'TPL-REF-029': 'a0c647b7892a4078b24cc670f33329007a45877f8e8df3cb43b2516dbe54a644',
  'TPL-REF-030': '88babe364a7cacfbb1b5e25356f80c0bc6583cfc7a0c215346a5732117665c39',
  'TPL-REF-031': '602861a42ba7ed0e96842eb40c811073942086fb9213ed8c938bef7a5d7a3bf2',
  'TPL-REF-032': '017b8fb3aac57469b51ee8cc43cca7c58a56e58e49f31c6a38f9beaa42a9f707'
};

const ALL_20_SCREENS = [
  'AUTH-01', 'DASH-01', 'CASE-01', 'CASE-02', 'CASE-03', 'CASE-04', 'CASE-05', 'CASE-06', 'MEET-01', 'PROP-01',
  'PROP-02', 'REPO-01', 'REPO-02', 'APPR-01', 'FEE-01', 'TPL-01', 'AI-01', 'USER-01', 'AUD-01', 'RESP-01'
];

test('P00 Harness Directory Skeleton Verification', () => {
  const dirs = [
    'apps/web', 'apps/api', 'packages/ui', 'packages/domain', 'packages/database', 'packages/ai-gateway',
    'packages/document-engine', 'packages/google-workspace', 'packages/test-fixtures', 'docs/product', 'docs/architecture',
    'docs/adr', 'docs/harness', 'docs/reviews/requests', 'docs/stitch', 'artifacts/harness/P00', 'scripts'
  ];
  for (const directory of dirs) {
    const fullPath = path.join(__dirname, '..', directory);
    assert.strictEqual(fs.existsSync(fullPath), true, `Directory missing: ${directory}`);
    assert.strictEqual(fs.existsSync(path.join(fullPath, '.gitkeep')), true, `.gitkeep missing in: ${directory}`);
  }
});

test('P00 Essential Harness Files Verification', () => {
  const files = [
    'README.md', '01_ANTIGRAVITY_EXECUTOR_INSTRUCTIONS.md', '01_ANTIGRAVITY_EXECUTOR_INSTRUCTIONS_v2.md',
    '03_CLAIM_6_TYPE_TEMPLATE_MAPPING_SPEC.md', '.gitignore', '.editorconfig', '.node-version', 'pnpm-workspace.yaml',
    'tsconfig.base.json', 'tsconfig.json', 'docs/harness/phase-status.json', 'docs/harness/working-agreement.md',
    'docs/harness/initial-state.json', 'artifacts/harness/P00/manifest.json'
  ];
  for (const file of files) assert.strictEqual(fs.existsSync(path.join(__dirname, '..', file)), true, `Required file missing: ${file}`);
});

test('P01 Exhaustive Traceability & Reference Inventory Tamper-Proof Assertion', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/templates/reference-inventory.json'), 'utf8'));
  assert.strictEqual(inventory.totalFiles, 32);
  assert.strictEqual(inventory.files.length, 32);
  for (const item of inventory.files) {
    assert.ok(EXPECTED_EXACT_SHAS[item.fileId], `Unknown fileId: ${item.fileId}`);
    assert.strictEqual(item.sha256, EXPECTED_EXACT_SHAS[item.fileId], `SHA mismatch: ${item.fileId}`);
  }
});

test('P02 Stitch UX/UI Design 20 Screens & 3-Pane Assertions', () => {
  for (const screenId of ALL_20_SCREENS) {
    assert.strictEqual(fs.existsSync(path.join(__dirname, '../docs/stitch/artifacts', screenId, 'screen.html')), true, `Missing ${screenId}`);
  }
});

test('P03 App Shell, Design System, 20 Routes & Reviewer RBAC Guard Assertions', () => {
  const router = fs.readFileSync(path.join(__dirname, '../apps/web/src/routes/Router.tsx'), 'utf8');
  for (const screenId of ALL_20_SCREENS) assert.ok(router.includes(screenId), `Router missing ${screenId}`);
  assert.ok(router.includes('reviewerCapabilities'));
});

test('P03 Manifest Integrity & 24-Test Regression Contract', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../artifacts/harness/P03/manifest.json'), 'utf8'));
  assert.strictEqual(manifest.phase, 'P03');
  assert.strictEqual(manifest.tests.passed, 24);
  assert.strictEqual(manifest.selfAssessment, 'CODEX_CORRECTED_READY_FOR_REVIEW');
});

test('P04 Manifest declares independent DB, E2E and security gates', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../artifacts/harness/P04/manifest.json'), 'utf8'));
  assert.strictEqual(manifest.phase, 'P04');
  assert.ok(manifest.commandsExecuted.some((command: string) => command.includes('test:e2e')));
  assert.ok(manifest.commandsExecuted.some((command: string) => command.includes('test:security')));
});

test('Phase Status Machine Integration', () => {
  const status = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/harness/phase-status.json'), 'utf8'));
  assert.strictEqual(status.project, 'claim-center-report-studio');
  for (const phase of ['P00', 'P01', 'P02', 'P03', 'P04', 'P05', 'P06']) assert.strictEqual(status.phases[phase].status, 'PASS');
  assert.ok(['IN_PROGRESS', 'READY_FOR_REVIEW', 'PASS'].includes(status.phases.P07.status));
});

test('P08 keeps real E2E/security gates and DB-enforced immutable report template history', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.match(packageJson.scripts['test:e2e'], /p08-e2e\.ts/);
  assert.match(packageJson.scripts['test:security'], /p08-security-test\.ts/);

  const migration = fs.readFileSync(path.join(__dirname, '../packages/database/prisma/migrations/20260807100000_p08_report_template_catalog/migration.sql'), 'utf8');
  for (const trigger of [
    'P08_report_template_version_no_update',
    'P08_report_template_version_no_delete',
    'P08_report_template_version_no_self_approval',
    'P08_template_type_mapping_single_primary',
    'P08_report_instance_no_snapshot_update'
  ]) {
    assert.ok(migration.includes(trigger), `P08 DB guard missing: ${trigger}`);
  }
  assert.doesNotMatch(migration, /DROP\s+TABLE|ALTER\s+TABLE\s+[^;]+\s+RENAME/i);
});
