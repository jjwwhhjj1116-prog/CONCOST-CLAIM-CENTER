import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

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

test('Phase Status Machine Integration', () => {
  const phaseStatusPath: string = path.join(__dirname, '..', 'docs/harness/phase-status.json');
  const statusContent = JSON.parse(fs.readFileSync(phaseStatusPath, 'utf8'));
  assert.strictEqual(statusContent.project, 'claim-center-report-studio');
  assert.strictEqual(statusContent.currentPhase, 'P00');
  assert.ok(statusContent.phases.P00);
});
