import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

test('CF168 preview retry migration verifies signed populated backup without authorizing an upload', async t => {
  mkdirSync('tmp', { recursive: true });
  const folder=mkdtempSync(path.resolve('tmp/cf168-backup-check-'));
  const backup=path.join(folder,'before.sql'), manifest=path.join(folder,'manifest.json');
  writeFileSync(backup, `
    CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE,applied_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO d1_migrations(name,applied_at) VALUES ('0065_cf148_finalization_metadata.sql','2026-01-01T00:00:00Z');
    CREATE TABLE preview_users(id TEXT PRIMARY KEY,is_active INTEGER,roles_json TEXT);
    CREATE TABLE preview_cases(id TEXT PRIMARY KEY,organization_id TEXT,deleted_at TEXT,case_number TEXT);
    CREATE TABLE preview_google_case_operations(id TEXT PRIMARY KEY,organization_id TEXT,case_id TEXT,category TEXT,workflow_category TEXT,idempotency_key TEXT,request_fingerprint TEXT,status TEXT,google_file_id TEXT,error_code TEXT,created_by TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE preview_google_case_evidence(id TEXT PRIMARY KEY,operation_id TEXT,case_id TEXT,workflow_category TEXT,original_name TEXT,mime_type TEXT,byte_size INTEGER,sha256 TEXT);
    CREATE TABLE preview_evidence_upload_locks(organization_id TEXT,case_id TEXT,category TEXT);
    CREATE TABLE schema_literals(value TEXT CHECK(value='A  B'));
    CREATE UNIQUE INDEX idx_preview_google_case_operation_active_fingerprint ON preview_google_case_operations(organization_id,case_id,category,request_fingerprint) WHERE status IN ('PENDING','RECONCILIATION_REQUIRED');
    INSERT INTO preview_users VALUES ('test-admin',1,'["admin"]');
    INSERT INTO preview_cases VALUES ('test-case','concost',NULL,'SYNTHETIC-ONLY');
    INSERT INTO preview_google_case_operations VALUES ('unknown-operation','concost','test-case','TAKEOFF_SOURCE','REPORT_REFERENCE','original-key','original-fingerprint','RECONCILIATION_REQUIRED',NULL,'UNKNOWN','test-admin','2026-01-01','2026-01-02');
  `,{flag:'wx'});
  const db='78094a1c-abe0-451d-bc12-68d0d37166d8';
  const run=(mode,pin,flag='--cf151-preview',database=db,manifestFile=manifest,afterFile)=>spawnSync(process.execPath,
    ['scripts/cf148-backup-check.mjs',mode,database,backup,manifestFile,...(pin?[pin]:[]),...(afterFile?[afterFile]:[]),flag],
    {encoding:'utf8'});
  const signed=run('sign'); assert.equal(signed.status,0,signed.stderr);
  const metadata=JSON.parse(signed.stdout);
  assert.equal(metadata.database,db); assert.equal(metadata.recoveryScopeVerified,undefined);
  assert.equal(metadata.migration,'0066_cf151_manual_evidence_retry.sql');
  assert.equal(metadata.sqlSha256,createHash('sha256').update(readFileSync(backup)).digest('hex'));
  const envelope=JSON.parse(readFileSync(manifest,'utf8'));
  assert.equal(envelope.manifest.kind,'CF151_PREVIEW_D1_BACKUP');
  assert.equal(envelope.manifest.database,db);
  assert.equal(Object.hasOwn(envelope.manifest,'recoveryScope'),false);
  assert.deepEqual(envelope.manifest.appliedMigrationChecksums,{
    '0065_cf148_finalization_metadata.sql':createHash('sha256').update(readFileSync('apps/cloudflare/migrations/0065_cf148_finalization_metadata.sql')).digest('hex')
  });
  const pin=metadata.publicKeySha256;
  const verified=run('verify',pin); assert.equal(verified.status,0,verified.stderr);
  const rehearsal=run('preflight',pin); assert.equal(rehearsal.status,0,rehearsal.stderr);
  assert.equal(JSON.parse(rehearsal.stdout).secondRunNoOp,true);
  assert.equal(run('verify','0'.repeat(64)).status,1);
  assert.equal(run('verify',pin,'--cf151').status,1);
  assert.equal(run('verify',pin,'--cf151-preview','16d1f25b-60c8-4489-95ed-4fa7de161c9f').status,1);
  const tampered=path.join(folder,'tampered-manifest.json');
  envelope.manifest.appliedMigrationChecksums['0065_cf148_finalization_metadata.sql']='0'.repeat(64);
  writeFileSync(tampered,JSON.stringify(envelope),{flag:'wx'});
  assert.equal(run('verify',pin,'--cf151-preview',db,tampered).status,1);

  await t.test('verification and in-memory preflight do not claim a file restore', () => {
    assert.equal(JSON.parse(verified.stdout).restoreVerified,false);
    assert.equal(JSON.parse(rehearsal.stdout).restoreVerified,false);
  });
  await t.test('restore rejects populated targets and compare detects literal whitespace changes', () => {
    const target=path.join(folder,'restored.sqlite');
    new DatabaseSync(target).close();
    const restored=run('restore',pin,'--cf151-preview',db,manifest,target);
    assert.equal(restored.status,0,restored.stderr);
    assert.equal(JSON.parse(restored.stdout).restoreVerified,true);
    const rejected=run('restore',pin,'--cf151-preview',db,manifest,target);
    assert.equal(rejected.status,1);
    assert.equal(JSON.parse(rejected.stderr.trim().split('\n').at(-1)).code,'RESTORE_TARGET_MUST_BE_EMPTY');
    const actual=new DatabaseSync(target);
    try {
      actual.exec(readFileSync('apps/cloudflare/migrations/0066_cf151_manual_evidence_retry.sql','utf8'));
      actual.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run('0066_cf151_manual_evidence_retry.sql');
    } finally { actual.close(); }
    const compared=run('compare',pin,'--cf151-preview',db,manifest,target);
    assert.equal(compared.status,0,compared.stderr);
    const changed=new DatabaseSync(target);
    try { changed.exec("DROP TABLE schema_literals; CREATE TABLE schema_literals(value TEXT CHECK(value='A B'));"); }
    finally { changed.close(); }
    const altered=run('compare',pin,'--cf151-preview',db,manifest,target);
    assert.equal(altered.status,1,'a literal whitespace change must not pass preservation');
    assert.equal(JSON.parse(altered.stderr.trim().split('\n').at(-1)).code,'EXISTING_SCHEMA_CHANGED');
  });
});
