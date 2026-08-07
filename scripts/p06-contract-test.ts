import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.join(__dirname, '..');
const read = (relativePath: string): string => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('P06 migration is additive and enforces document, version, meeting and action-item invariants in SQLite', () => {
  const migration = read('packages/database/prisma/migrations/20260806090000_p06_materials_meetings/migration.sql');
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|UPDATE "(?:CaseItem|Report|ReportSection|AuditLog)"/i);
  for (const table of ['Document', 'DocumentVersion', 'Meeting', 'MeetingActionItem']) assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  for (const guard of [
    'DocumentVersion_one_final_per_document', 'P06_document_links_insert', 'P06_document_version_pointers',
    'P06_final_version_content_immutable', 'P06_meeting_raw_text_immutable', 'P06_prevent_final_meeting_update',
    'P06_action_item_insert_guard', 'P06_action_item_update_guard', 'P06_action_item_delete_guard'
  ]) assert.ok(migration.includes(guard), `Missing DB guard ${guard}`);
});

test('P06 Prisma contract models latest/final pointers, source metadata, case links and transcript provenance', () => {
  const schema = read('packages/database/prisma/schema.prisma');
  for (const field of ['currentVersionId String?', 'finalVersionId   String?', 'scheduleId       String?', 'reportSectionId  String?', 'version          Int']) {
    assert.ok(schema.includes(field), `Document contract missing ${field}`);
  }
  for (const field of ['originalName  String', 'storageKey    String', 'fileSize      Int', 'mimeType      String', 'sha256        String', 'isFinal       Boolean']) {
    assert.ok(schema.includes(field), `DocumentVersion contract missing ${field}`);
  }
  assert.match(schema, /rawTextSha256\s+String\?/);
  assert.match(schema, /actionItems\s+MeetingActionItem\[\]/);
});

test('P06 API uses canonical Base64, exact MIME/signature mapping, safe containment, integrity verification and optimistic locks', () => {
  const server = read('apps/api/src/server.ts');
  for (const marker of [
    'decodeStrictBase64', 'validateFileSecurity', 'MIME type does not match the file extension', 'safeStoragePath',
    'Stored file integrity check failed', "'X-Content-Type-Options': 'nosniff'", 'Document version conflict',
    'Document finalization conflict', 'Meeting finalization conflict', 'Original meeting transcript cannot be changed'
  ]) assert.ok(server.includes(marker), `P06 API safety contract missing ${marker}`);
  assert.doesNotMatch(server, /storageKey:\s*versionRow\.storageKey/);
});

test('P06 web performs browser-native upload/download and exposes version, metadata, link and meeting workflows', () => {
  const ui = read('apps/web/src/case-management/CaseManagement.tsx');
  assert.match(ui, /new FileReader\(\)/);
  assert.doesNotMatch(ui, /Buffer\.from\(/);
  for (const marker of [
    '새 버전 업로드', '최종본 지정', '다운로드', 'SHA-256', '연결 기일 ID', '연결 보고서 장 ID',
    '회의 원문 TXT 업로드', '요약·결정사항 저장', '회의록 확정 (FINAL)', '회의 할 일 연결'
  ]) assert.ok(ui.includes(marker), `P06 UI workflow missing ${marker}`);
  const api = read('apps/web/src/api.ts');
  assert.match(api, /export async function apiDownload/);
  assert.match(api, /response\.blob\(\)/);
});

test('P06 has phase-specific integration, browser E2E and security suites without replacing prior security regressions', () => {
  const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.match(packageJson.scripts['test:e2e'], /p06-e2e\.ts/);
  assert.match(packageJson.scripts['test:e2e'], /p07-e2e\.ts/);
  for (const file of ['p04-security-test.ts', 'p05-security-test.ts', 'p06-security-test.ts']) assert.ok(packageJson.scripts['test:security'].includes(file));
  const harness = read('scripts/harness-test.ts');
  assert.ok(harness.includes("import './p06-contract-test'"));
  assert.ok(harness.includes("import './p06-materials-test'"));
});

test('P06 adversarial contract rejects loss of storage rollback, download verification and FINAL child guards', () => {
  const server = read('apps/api/src/server.ts');
  const migration = read('packages/database/prisma/migrations/20260806090000_p06_materials_meetings/migration.sql');
  const validate = (apiSource: string, migrationSource: string): void => {
    assert.match(apiSource, /fs\.rmSync\(diskPath, \{ force: true \}\)/);
    assert.match(apiSource, /storedSha !== versionRow\.sha256/);
    assert.match(migrationSource, /NEW\."meetingId" AND m\."status" = 'FINAL'/);
  };
  validate(server, migration);
  assert.throws(() => validate(server.replace(/fs\.rmSync\(diskPath, \{ force: true \}\)/g, ''), migration));
  assert.throws(() => validate(server.replace('storedSha !== versionRow.sha256', 'false'), migration));
  assert.throws(() => validate(server, migration.replace(/NEW\."meetingId" AND m\."status" = 'FINAL'/g, 'REMOVED')));
});
