import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { databaseUrlFor, migrateDatabase } from '../packages/database/src/db-engine';

test('CF221 actual SQLite migration runner preserves populated identities and checksums on repeat', async () => {
  const SQL=await initSqlJs();const db=new SQL.Database();db.exec('PRAGMA foreign_keys=ON');
  const migrationName='20261014090000_cf221_review_recipient_queue';
  const directory=resolve('packages/database/prisma/migrations');
  db.exec('CREATE TABLE "_P04Migration" (name TEXT PRIMARY KEY,checksum TEXT NOT NULL,appliedAt TEXT NOT NULL)');
  for(const name of readdirSync(directory).filter(name=>name!==migrationName).sort()){
    let sql:string;try{sql=readFileSync(join(directory,name,'migration.sql'),'utf8');}catch{continue;}
    db.exec(sql);db.run('INSERT INTO "_P04Migration" VALUES(?,?,?)',[name,createHash('sha256').update(sql).digest('hex'),'2026-09-03T00:00:00Z']);
  }
  db.run('INSERT INTO Organization(id,name,createdAt,updatedAt) VALUES(?,?,?,?)',['cf104-preserved-org','보존 검수 조직','2026-09-03T00:00:00Z','2026-09-03T00:00:00Z']);
  db.run('INSERT INTO User(id,email,passwordHash,name,organizationId,isActive,createdAt,updatedAt) VALUES(?,?,?,?,?,1,?,?)',['cf104-preserved-user','qa@example.invalid','synthetic-not-a-credential','보존 검수 회원','cf104-preserved-org','2026-09-03T00:00:00Z','2026-09-03T00:00:00Z']);
  db.run('INSERT INTO CaseItem(id,organizationId,caseNumber,title,claimType,updatedAt) VALUES(?,?,?,?,?,?)',['cf104-preserved-case','cf104-preserved-org','CF104-TEST','보존 검수 프로젝트','TYPE-01','2026-09-03T00:00:00Z']);
  db.run('INSERT INTO Document(id,caseId,title,source,updatedAt) VALUES(?,?,?,?,?)',['cf104-preserved-doc','cf104-preserved-case','보존 원본','RECEIVED','2026-09-03T00:00:00Z']);
  db.run('INSERT INTO DocumentVersion(id,documentId,versionNumber,originalName,displayName,storageKey,fileSize,mimeType,sha256,uploadedById) VALUES(?,?,1,?,?,?,?,?,?,?)',['cf104-preserved-version','cf104-preserved-doc','원본.txt','원본.txt','synthetic-original.txt',8,'text/plain',createHash('sha256').update('original').digest('hex'),'cf104-preserved-user']);
  db.run('INSERT INTO Report(id,caseId,title,updatedAt) VALUES(?,?,?,?)',['cf221-report','cf104-preserved-case','보존 보고서','2026-10-14T00:00:00Z']);
  db.run('INSERT INTO User(id,email,passwordHash,name,organizationId,isActive,createdAt,updatedAt) VALUES(?,?,?,?,?,1,?,?)',['cf221-reviewer','director@example.invalid','synthetic','지정 결재자','cf104-preserved-org','2026-10-14T00:00:00Z','2026-10-14T00:00:00Z']);
  db.run('INSERT INTO Role(id,name) VALUES(?,?)',['director','director']);db.run('INSERT INTO UserRole VALUES(?,?)',['cf221-reviewer','director']);
  db.run('INSERT INTO ReportReviewRequest(id,organizationId,caseId,reportId,requestedById,assignedReviewerId,status,comment,idempotencyKey,idempotencyFingerprint,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)',['cf221-review','cf104-preserved-org','cf104-preserved-case','cf221-report','cf104-preserved-user','cf221-reviewer','PENDING','줄바꿈\n0 123.45 246.9','cf221-preserved-key','a'.repeat(64),'2026-10-14T00:00:00Z']);
  const identityQuery='SELECT * FROM Organization;SELECT * FROM User;SELECT * FROM CaseItem;SELECT * FROM Document;SELECT * FROM DocumentVersion;SELECT * FROM Report;SELECT * FROM ReportReviewRequest;SELECT * FROM Role;SELECT * FROM UserRole;';
  const identities=JSON.stringify(db.exec(identityQuery));
  const ledger=JSON.stringify(db.exec('SELECT name,checksum FROM _P04Migration ORDER BY name'));
  const output=resolve('tmp/cf221-qa/approval-tests/sqlite');mkdirSync(output,{recursive:true});
  const path=join(mkdtempSync(join(output,'migration-')),'isolated.db');writeFileSync(path,db.export());db.close();
  await migrateDatabase(databaseUrlFor(path));
  let migrated=new SQL.Database(readFileSync(path));
  assert.equal(JSON.stringify(migrated.exec(identityQuery)),identities);
  assert.equal(JSON.stringify(migrated.exec(`SELECT name,checksum FROM _P04Migration WHERE name<>'${migrationName}' ORDER BY name`)),ledger);
  assert.equal(migrated.exec('PRAGMA integrity_check')[0].values[0][0],'ok');assert.equal(migrated.exec('PRAGMA foreign_key_check').length,0);
  assert.deepEqual(migrated.exec('PRAGMA index_info("ReportReviewRequest_assignedReviewerId_createdAt_idx")')[0].values.map(row=>row[2]),['assignedReviewerId','createdAt']);
  const checksum=createHash('sha256').update(readFileSync(join(directory,migrationName,'migration.sql'),'utf8')).digest('hex');
  assert.equal(migrated.exec(`SELECT checksum FROM _P04Migration WHERE name='${migrationName}'`)[0].values[0][0],checksum);
  const after=JSON.stringify(migrated.exec('SELECT name,checksum FROM _P04Migration ORDER BY name'));writeFileSync(path,migrated.export());migrated.close();
  await migrateDatabase(databaseUrlFor(path));migrated=new SQL.Database(readFileSync(path));
  assert.equal(JSON.stringify(migrated.exec('SELECT name,checksum FROM _P04Migration ORDER BY name')),after);

  assert.equal(JSON.stringify(migrated.exec(identityQuery)),identities);const completeLedger=JSON.stringify(migrated.exec('SELECT * FROM _P04Migration ORDER BY name'));migrated.close();
  await migrateDatabase(databaseUrlFor(path));migrated=new SQL.Database(readFileSync(path));assert.equal(JSON.stringify(migrated.exec('SELECT * FROM _P04Migration ORDER BY name')),completeLedger);
  const badPath=join(resolve(path,'..'),'checksum-negative.db');migrated.run('UPDATE _P04Migration SET checksum=? WHERE name=?',['0'.repeat(64),migrationName]);writeFileSync(badPath,migrated.export());migrated.close();const badBefore=readFileSync(badPath);await assert.rejects(migrateDatabase(databaseUrlFor(badPath)),/Migration checksum mismatch/);assert.deepEqual(readFileSync(badPath),badBefore);
  writeFileSync(join(resolve(path,'..'),'result.json'),JSON.stringify({passed:true,path,migrationName,checksum,originalRowsExact:true,existingLedgerExact:true,newIndexColumns:['assignedReviewerId','createdAt'],repeatFullLedgerIncludingAppliedAtExact:true,integrity:'ok',foreignKeyViolations:0,checksumMismatchRejectedWithoutFileWrite:true},null,2));
});
