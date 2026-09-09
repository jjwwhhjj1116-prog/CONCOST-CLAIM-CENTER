import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { ensureClaimCenterFolder } from '../apps/cloudflare/src/google-drive.js';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const migration = (name: string) => read(`apps/cloudflare/migrations/${name}`);

test('CF30 promotes the named yjw account to Admin and seeds six finished report references', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys=ON');
  db.exec(migration('0003_cf04_preview_auth.sql'));
  db.run('INSERT INTO preview_users VALUES (?,?,?,?,?,?,?,?,1,?)', [
    '00000000-0000-4000-8000-000000000099', 'yjw@con-cost.com', '1'.repeat(32), '2'.repeat(64),
    100000, '유종욱', 'yjw', '["pm"]', new Date().toISOString()
  ]);
  db.exec(migration('0022_cf30_settings_template_preview.sql'));
  const roles = JSON.parse(String(db.exec("SELECT roles_json FROM preview_users WHERE login_id='yjw@con-cost.com'")[0].values[0][0])) as string[];
  assert.deepEqual(new Set(roles), new Set(['pm', 'admin']));
  const result = db.exec('SELECT claim_type,template_name,length(finished_example_markdown) FROM preview_report_template_previews ORDER BY claim_type')[0].values;
  assert.equal(result.length, 6);
  assert.deepEqual(result.map((row) => row[0]), ['TYPE-01', 'TYPE-02', 'TYPE-03', 'TYPE-04', 'TYPE-05', 'TYPE-06']);
  assert.ok(result.every((row) => Number(row[2]) >= 300));
  assert.equal(db.exec("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('preview_google_case_operations','preview_google_case_evidence')")[0].values[0][0], 2);
  db.close();
});

test('CF30 creates and reuses company/department/project/category/month and uploader-dated Drive folders with server-owned provenance', async () => {
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  const folders: Array<{ id: string; name: string; mimeType: string; trashed: boolean; parents: string[]; appProperties: Record<string, string> }> = [];
  const fetcher = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    assert.equal(new URL(url).origin, 'https://www.googleapis.com');
    if (method === 'GET') {
      calls.push({ url, method });
      const query = new URL(url).searchParams.get('q') ?? '';
      const properties = [...query.matchAll(/appProperties has \{ key='([^']+)' and value='([^']*)' \}/g)];
      const parent = query.match(/'([^']+)' in parents/)?.[1];
      assert.ok(properties.length, 'folder lookup must use server-owned provenance');
      assert.match(query, /trashed = false/);
      return Response.json({ files: folders.filter(folder => !folder.trashed && properties.every(([, key, value]) => folder.appProperties[key] === value) && (!parent || folder.parents.includes(parent))) });
    }
    assert.equal(method, 'POST', 'fresh/reused folders must not move or delete existing files');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, method, body });
    const folder = { id: `folder-id-${folders.length + 1}000`, name: String(body.name), mimeType: String(body.mimeType), trashed: false, parents: (body.parents ?? []) as string[], appProperties: body.appProperties as Record<string, string> };
    folders.push(folder);
    return Response.json(folder);
  };
  const caseId = '40000000-0000-4000-8000-000000000010';
  const root = await ensureClaimCenterFolder(fetcher, { accessToken: 'server-access-token', caseId, kind: 'PROJECT_ROOT', period: '', name: 'CC-2026-001 Sample' });
  const category = await ensureClaimCenterFolder(fetcher, { accessToken: 'server-access-token', caseId, kind: 'TAKEOFF_SOURCE', period: '', name: '산출자료', parentId: root.id });
  const month = await ensureClaimCenterFolder(fetcher, { accessToken: 'server-access-token', caseId, kind: 'MONTH', period: '2026-08', name: '2026-08', parentId: category.id });
  const attributed = await ensureClaimCenterFolder(fetcher, { accessToken: 'server-access-token', caseId, kind: 'MEETING_MINUTES', period: '2026-08-24_00000000-0000-4000-8000-000000000042', name: '회의록(유종욱_2026.08.24)', parentId: root.id });
  const organization = folders.find(folder => folder.appProperties.concostFolderKind === 'ORGANIZATION_ROOT');
  const department = folders.find(folder => folder.appProperties.concostFolderKind === 'DEPARTMENT_ROOT');
  assert.ok(organization && department);
  assert.equal(organization.name, 'CONCOST 자료실');
  assert.deepEqual(organization.parents, []);
  assert.equal(department.name, '20_클레임센터');
  assert.deepEqual(department.parents, [organization.id]);
  assert.deepEqual(folders.find(folder => folder.id === root.id)?.parents, [department.id]);
  assert.deepEqual(folders.find(folder => folder.id === category.id)?.parents, [root.id]);
  assert.equal(new Set([organization.id, department.id, root.id, category.id, month.id, attributed.id]).size, 6);
  assert.equal(calls.filter((call) => call.method === 'POST').length, 6);
  const monthBody = calls.find((call) => call.body?.name === '2026-08')?.body as { parents?: string[]; appProperties?: Record<string, string> };
  assert.deepEqual(monthBody.parents, [category.id]);
  assert.deepEqual(monthBody.appProperties, { claimCenterCaseId: caseId, claimCenterFolderKind: 'MONTH', claimCenterPeriod: '2026-08', concostDepartment: 'CLAIM_CENTER' });
  const attributedBody = calls.at(-1)?.body as { name?: string; parents?: string[]; appProperties?: Record<string, string> };
  assert.equal(attributedBody.name, '회의록(유종욱_2026.08.24)');
  assert.deepEqual(attributedBody.parents, [root.id]);
  assert.equal(attributedBody.appProperties?.claimCenterPeriod, '2026-08-24_00000000-0000-4000-8000-000000000042');
  for (const [expected, kind, period, name, parentId] of [
    [root, 'PROJECT_ROOT', '', 'CC-2026-001 Sample', undefined],
    [category, 'TAKEOFF_SOURCE', '', '산출자료', root.id],
    [month, 'MONTH', '2026-08', '2026-08', category.id],
    [attributed, 'MEETING_MINUTES', '2026-08-24_00000000-0000-4000-8000-000000000042', '회의록(유종욱_2026.08.24)', root.id]
  ] as const) {
    const reused = await ensureClaimCenterFolder(fetcher, { accessToken: 'server-access-token', caseId, kind, period, name, parentId });
    assert.equal(reused.id, expected.id);
    assert.equal(reused.created, false);
  }
  assert.equal(calls.filter(call => call.method === 'POST').length, 6, 'retry must reuse all six folders');
  assert.ok(calls.every((call) => call.url.startsWith('https://www.googleapis.com/drive/v3/files')));
});

test('CF30 exposes one Settings entry with nested Admin Drive controls and no screen-customization card', () => {
  const shell = read('apps/web/src/layout/AppShell.tsx');
  const settings = read('apps/web/src/routes/PreviewSettings.tsx');
  const drive = read('apps/web/src/routes/PreviewEvidenceHub.tsx');
  assert.match(shell, /label:\s*'설정'[\s\S]*?routeIds:\s*\['MY-01'\]/u);
  assert.match(shell, /navigation-single-action/u);
  assert.doesNotMatch(shell, /label:'내 설정'/u);
  assert.doesNotMatch(settings, /내 화면 맞춤 설정/u);
  assert.match(settings, /개인 Gemini 연결 설정/u);
  assert.match(settings, /provider\.providerKind === 'GEMINI'/u);
  assert.match(settings, /관리자 설정/u);
  assert.match(settings, /<PreviewGoogleDriveSetup/u);
  assert.match(drive, /연결 계정 변경/u);
  assert.match(settings, /API KEY 발급 ↗/u);
  assert.match(settings, /API KEY 발급방법/u);
  assert.match(settings, /aistudio\.google\.com\/apikey/u);
});

test('CF30 report studio opens a finished type template before writing and during revision', () => {
  const worker = read('apps/cloudflare/src/index.ts');
  const studio = read('apps/web/src/routes/PreviewReportStudio.tsx');
  assert.match(worker, /preview_report_template_previews/u);
  assert.match(worker, /finished_example_markdown AS finishedExample/u);
  assert.match(studio, /onClick=\{\(\) => setShowTemplatePreview\(true\)\}>완제품 템플릿 열람/u);
  assert.match(studio, /disabled=\{!selectedTemplateCategory\} onClick=\{\(\)=>setShowTemplatePreview\(true\)\}>원본 템플릿/u);
  assert.match(studio, /<Dialog isOpen=\{showTemplatePreview && Boolean\(selectedTemplateCategory\)\}[^\n]*onClose=\{\(\) => setShowTemplatePreview\(false\)\}/u);
  assert.match(studio, /onClick=\{\(\) => void openTemplateSource\(file\)\}/u);
  assert.match(studio, /selectedTemplatePreview\.finishedExample/u);
  assert.match(studio, /FINISHED REPORT REFERENCE/u);
  assert.match(studio, /참고 열람 전용/u);
});

test('CF31 lets only an active Admin persist encrypted Google OAuth app settings', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys=ON');
  db.exec(migration('0003_cf04_preview_auth.sql'));
  const now = new Date().toISOString();
  db.run('INSERT INTO preview_users VALUES (?,?,?,?,?,?,?,?,1,?)', ['00000000-0000-4000-8000-000000000090', 'admin@con-cost.com', '1'.repeat(32), '2'.repeat(64), 100000, 'Admin', 'adm', '["admin"]', now]);
  db.run('INSERT INTO preview_users VALUES (?,?,?,?,?,?,?,?,1,?)', ['00000000-0000-4000-8000-000000000091', 'staff@con-cost.com', '1'.repeat(32), '2'.repeat(64), 100000, 'Staff', 'stf', '["staff"]', now]);
  db.exec(migration('0023_cf31_google_oauth_app_settings.sql'));
  const values = ['concost', '1234567890-claimcenter.apps.googleusercontent.com', 'a'.repeat(64), 'b'.repeat(24), 1, '00000000-0000-4000-8000-000000000090', now, now];
  db.run('INSERT INTO preview_google_oauth_app_settings VALUES (?,?,?,?,?,?,?,?)', values);
  assert.equal(db.exec('SELECT version,length(encrypted_client_secret) FROM preview_google_oauth_app_settings')[0].values[0][0], 1);
  assert.throws(() => db.run('UPDATE preview_google_oauth_app_settings SET version=3 WHERE organization_id="concost"'), /version must increment/u);
  assert.throws(() => db.run('UPDATE preview_google_oauth_app_settings SET version=2,updated_by="00000000-0000-4000-8000-000000000091" WHERE organization_id="concost"'), /active Admin/u);
  assert.throws(() => db.run('DELETE FROM preview_google_oauth_app_settings'), /cannot be deleted/u);
  db.close();
});

test('CF31 exposes OAuth app onboarding and high-contrast light Drive controls', () => {
  const worker = read('apps/cloudflare/src/index.ts');
  const drive = read('apps/web/src/routes/PreviewEvidenceHub.tsx');
  const theme = read('apps/web/src/preview-theme.css');
  assert.match(worker, /\/api\/google\/oauth-app/u);
  assert.match(worker, /encryptSecret\(body\.clientSecret\.trim\(\)/u);
  assert.match(drive, /Google OAuth 앱을 한 번만 등록하세요/u);
  assert.match(drive, /Google Drive 연결·계정 교체 따라하기/u);
  assert.match(drive, /console\.cloud\.google\.com\/auth\/branding/u);
  assert.match(drive, /console\.cloud\.google\.com\/auth\/audience/u);
  assert.match(drive, /console\.cloud\.google\.com\/auth\/scopes/u);
  assert.match(drive, /console\.cloud\.google\.com\/auth\/clients/u);
  assert.match(drive, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/u);
  assert.match(drive, /403 access_denied/u);
  assert.match(drive, /redirect_uri_mismatch/u);
  assert.match(drive, /기존 Drive 파일은 자동 이동되지 않으므로/u);
  assert.match(drive, /승인된 리디렉션 URI/u);
  assert.match(theme, /:root:not\(\[data-theme='dark'\]\) \.preview-drive-card strong \{ color: #0f172a/u);
  assert.match(theme, /\.preview-drive-status strong \{ color: #881337/u);
  assert.match(theme, /\.preview-drive-guide-grid/u);
});
