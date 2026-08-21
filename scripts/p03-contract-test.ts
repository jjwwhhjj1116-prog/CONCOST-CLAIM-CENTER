import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CLAIM_TYPES, ROUTES, canAccessRoute, isSafeReturnTo, reviewerCapabilities, routeByPath, type RouteConfig } from '../apps/web/src/routes/Router';

const root = path.join(__dirname, '..');
const requiredScreenIds = ['AUTH-01', 'DASH-01', 'CASE-01', 'CASE-02', 'CASE-03', 'CASE-04', 'CASE-05', 'CASE-06', 'MEET-01', 'PROP-01', 'PROP-02', 'REPO-01', 'REPO-02', 'APPR-01', 'FEE-01', 'TPL-01', 'AI-01', 'USER-01', 'AUD-01', 'RESP-01'];
const approvedExtensionIds = [
  'PROP-03', 'PROP-04',
  'PROJ-01', 'PROJ-02',
  'WF-01', 'WF-02', 'WF-03', 'WF-04', 'WF-05', 'WF-06',
  'POST-01', 'OUTCOME-01', 'INTEG-01', 'MY-01'
];

function validateRoutes(routes: RouteConfig[]): void {
  const routeIds = routes.map((route) => route.id);
  assert.deepStrictEqual(routeIds.filter((id) => !approvedExtensionIds.includes(id)), requiredScreenIds);
  assert.deepStrictEqual(routeIds.filter((id) => approvedExtensionIds.includes(id)), approvedExtensionIds);
  assert.strictEqual(new Set(routes.map((route) => route.path)).size, routes.length, 'Route paths must be unique');
}

function validateReviewer(capabilities: Record<string, boolean>): void {
  assert.deepStrictEqual(capabilities, {
    uploadEvidence: true,
    editReportBody: false,
    approveSection: true,
    mergeFinalDocument: false
  });
}

function validateDrawer(source: string): void {
  assert.match(source, /event\.key === 'Escape'/, 'Drawer Escape recovery missing');
  assert.match(source, /event\.key !== 'Tab'/, 'Drawer focus trap missing');
  assert.match(source, /returnFocusRef\.current\?\.focus\(\)/, 'Drawer focus return missing');
}

function validateHistory(source: string): void {
  assert.match(source, /history\.pushState/);
  assert.match(source, /history\.replaceState/);
  assert.match(source, /addEventListener\('popstate'/);
}

test('P03 required 20 routes remain intact with approved product workflow extensions', () => validateRoutes(ROUTES));

test('P03 adversarial: an unapproved route extension is rejected', () => {
  const changed = [...ROUTES, { id: 'EXTRA-01', path: '/extra', name: 'unauthorized' }];
  assert.throws(() => validateRoutes(changed));
});

test('P03 direct-path resolution, safe return target, and 404 boundary', () => {
  assert.strictEqual(routeByPath('/reports/studio')?.id, 'REPO-02');
  assert.strictEqual(routeByPath('/not-approved'), undefined);
  assert.strictEqual(isSafeReturnTo('/approval'), true);
  assert.strictEqual(isSafeReturnTo('//evil.example'), false);
  assert.strictEqual(isSafeReturnTo('/not-approved'), false);
});

test('P03 browser history implementation and adversarial removal', () => {
  const source = fs.readFileSync(path.join(root, 'apps/web/src/App.tsx'), 'utf8');
  validateHistory(source);
  assert.throws(() => validateHistory(source.replace("window.addEventListener('popstate', restoreFromHistory);", '')));
});

test('P03 Reviewer RBAC action matrix and adversarial permission drift', () => {
  validateReviewer({ ...reviewerCapabilities });
  assert.throws(() => validateReviewer({ ...reviewerCapabilities, editReportBody: true }));
  assert.strictEqual(canAccessRoute(routeByPath('/reports/studio')!, 'reviewer'), true, 'Reviewer must enter assigned report studio');
  assert.strictEqual(canAccessRoute(routeByPath('/ai-config')!, 'reviewer'), false, 'Reviewer must not enter admin AI configuration');
});

test('P03 exact six claim-type selector and TYPE-07/template-folder rejection', () => {
  assert.deepStrictEqual(CLAIM_TYPES.map((item) => item.value), ['TYPE-01', 'TYPE-02', 'TYPE-03', 'TYPE-04', 'TYPE-05', 'TYPE-06']);
  const mutated = [...CLAIM_TYPES.map((item) => ({ ...item })), { value: 'TYPE-07', label: '01. 감정보완 신청서' }];
  assert.notDeepStrictEqual(mutated.map((item) => item.value), ['TYPE-01', 'TYPE-02', 'TYPE-03', 'TYPE-04', 'TYPE-05', 'TYPE-06']);
  assert.ok(CLAIM_TYPES.every((item) => !/^\d{2}\./.test(item.label)));
});

test('P03 Drawer keyboard recovery and adversarial Escape removal', () => {
  const source = fs.readFileSync(path.join(root, 'packages/ui/src/components/Drawer.tsx'), 'utf8');
  validateDrawer(source);
  assert.throws(() => validateDrawer(source.replace("event.key === 'Escape'", "event.key === 'Removed'")));
});

test('P03 component catalog covers every shared component and UI state', () => {
  const source = fs.readFileSync(path.join(root, 'packages/ui/src/catalog/ComponentCatalog.tsx'), 'utf8');
  for (const component of ['Button', 'Input', 'Select', 'Dialog', 'Drawer', 'Table', 'Card', 'StatusBadge', 'DDay', 'Timeline', 'StateView']) {
    assert.ok(source.includes(component), `Catalog missing ${component}`);
  }
  for (const state of ['normal', 'loading', 'empty', 'error', 'forbidden']) assert.ok(source.includes(`state="${state}"`));
  assert.ok(source.includes('긴 콘텐츠'));
});

test('P03 quality gates execute production build and a distinct browser E2E', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.match(packageJson.scripts.build, /harness-check\.ts build/);
  assert.match(packageJson.scripts['test:e2e'], /p0[3567]-e2e\.ts/);
  assert.notStrictEqual(packageJson.scripts.test, packageJson.scripts['test:e2e']);
  const harness = fs.readFileSync(path.join(root, 'scripts/harness-check.ts'), 'utf8');
  assert.ok(harness.includes("'apps/web/tsconfig.json', '--noEmit'"));
  assert.ok(harness.includes("'packages/ui/tsconfig.json'"));
  assert.ok(harness.includes("runNode(viteCli, ['build']"));
});
