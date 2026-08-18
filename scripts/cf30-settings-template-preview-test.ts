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

test('CF30 creates deterministic project/category/month Drive folders with server-owned provenance', async () => {
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  let ordinal = 0;
  const fetcher = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    if (method === 'GET') { calls.push({ url, method }); return new Response(JSON.stringify({ files: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, method, body });
    ordinal += 1;
    return new Response(JSON.stringify({ id: `folder-id-${ordinal}000`, name: body.name, mimeType: 'application/vnd.google-apps.folder', trashed: false, parents: body.parents, appProperties: body.appProperties }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const caseId = '40000000-0000-4000-8000-000000000010';
  const root = await ensureClaimCenterFolder(fetcher, { accessToken: 'server-access-token', caseId, kind: 'PROJECT_ROOT', period: '', name: 'CC-2026-001 Sample' });
  const category = await ensureClaimCenterFolder(fetcher, { accessToken: 'server-access-token', caseId, kind: 'TAKEOFF_SOURCE', period: '', name: '산출자료', parentId: root.id });
  const month = await ensureClaimCenterFolder(fetcher, { accessToken: 'server-access-token', caseId, kind: 'MONTH', period: '2026-08', name: '2026-08', parentId: category.id });
  assert.equal(month.id, 'folder-id-3000');
  assert.equal(calls.filter((call) => call.method === 'POST').length, 3);
  const monthBody = calls.at(-1)?.body as { parents?: string[]; appProperties?: Record<string, string> };
  assert.deepEqual(monthBody.parents, [category.id]);
  assert.deepEqual(monthBody.appProperties, { claimCenterCaseId: caseId, claimCenterFolderKind: 'MONTH', claimCenterPeriod: '2026-08' });
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
  assert.match(studio, /보고서 템플릿 선택·열람/u);
  assert.match(studio, /선택 템플릿 완제품 보기/u);
  assert.match(studio, /템플릿 다시 보기/u);
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
  assert.match(drive, /console\.cloud\.google\.com\/apis\/credentials/u);
  assert.match(drive, /승인된 리디렉션 URI/u);
  assert.match(theme, /:root:not\(\[data-theme='dark'\]\) \.preview-drive-card strong \{ color: #0f172a/u);
  assert.match(theme, /\.preview-drive-status strong \{ color: #881337/u);
});
