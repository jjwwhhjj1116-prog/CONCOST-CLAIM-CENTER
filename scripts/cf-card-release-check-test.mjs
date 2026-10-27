import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const root=process.cwd(),dir=mkdtempSync(path.join(root,'tmp/cf-card-check-test-'));
const checker=path.join(root,'scripts/cf-card-release-check.mjs');
const dev='16d1f25b-60c8-4489-95ed-4fa7de161c9f',preview='78094a1c-abe0-451d-bc12-68d0d37166d8';
const migrations=readdirSync(path.join(root,'apps/cloudflare/migrations')).filter(name=>/^\d{4}_[a-z0-9_]+\.sql$/.test(name)&&!name.startsWith('0070_')&&!name.startsWith('0071_')).sort();
const sql=`PRAGMA foreign_keys=ON;
CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE NOT NULL,applied_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE preview_users(id TEXT PRIMARY KEY,display_name TEXT NOT NULL);
CREATE TABLE preview_business_card_analyses(id TEXT PRIMARY KEY);
CREATE TABLE preview_business_cards(id TEXT PRIMARY KEY,analysis_id TEXT NOT NULL);
CREATE TABLE preview_business_card_operations(id TEXT PRIMARY KEY);
CREATE TABLE old_settings(id TEXT PRIMARY KEY,setting TEXT NOT NULL);
CREATE TABLE qa_counter(id INTEGER PRIMARY KEY AUTOINCREMENT,marker TEXT);
CREATE INDEX old_settings_setting ON old_settings(setting);
CREATE TRIGGER old_settings_protect BEFORE DELETE ON old_settings BEGIN SELECT RAISE(ABORT,'preserve'); END;
INSERT INTO preview_users VALUES ('qa-person','synthetic only');
INSERT INTO old_settings VALUES ('qa-settings','synthetic value');
INSERT INTO qa_counter(id,marker) VALUES (100,'synthetic'); DELETE FROM qa_counter;
${migrations.map(name=>`INSERT INTO d1_migrations(name,applied_at) VALUES ('${name}','2026-10-26T00:00:00Z');`).join('\n')}`;
const backup=path.join(dir,'fixture.sql'),manifest=path.join(dir,'signed.json');writeFileSync(backup,sql,{flag:'wx'});
let independentPin='';
const run=(...args)=>spawnSync(process.execPath,[checker,...args],{cwd:root,encoding:'utf8',timeout:110000,maxBuffer:1024*1024,env:{...process.env,NODE_NO_WARNINGS:'1'}});
const parse=result=>JSON.parse((result.status===0?result.stdout:result.stderr).trim());

test('signed local D1 backup requires an independent pin, scope, and unmodified content',()=>{
  const signed=run('sign',dev,backup,manifest);assert.equal(signed.status,0,signed.stderr);const pin=independentPin=parse(signed).publicKeySha256;assert.match(pin,/^[0-9a-f]{64}$/);
  const verified=run('verify',dev,backup,manifest,pin);assert.equal(verified.status,0,verified.stderr);assert.equal(parse(verified).restoreVerified,false);assert.equal(parse(verified).runnerVerified,false);
  assert.notEqual(run('verify',dev,backup,manifest,'0'.repeat(64)).status,0);
  assert.notEqual(run('verify',preview,backup,manifest,pin).status,0);
  const changed=path.join(dir,'tampered.sql');writeFileSync(changed,sql+'\n-- modified', {flag:'wx'});
  assert.notEqual(run('verify',dev,changed,manifest,pin).status,0);
  const badManifest=path.join(dir,'tampered-manifest.json'),envelope=JSON.parse(readFileSync(manifest,'utf8'));envelope.manifest.database=preview;writeFileSync(badManifest,JSON.stringify(envelope),{flag:'wx'});
  assert.notEqual(run('verify',dev,backup,badManifest,pin).status,0);
  assert.notEqual(run('sign',dev,backup,manifest).status,0,'existing manifest must not be overwritten');
});

test('real local Wrangler runner applies reviewed migrations once while preserving data and schema',()=>{
  const digest=independentPin;assert.match(digest,/^[0-9a-f]{64}$/);
  const result=run('rehearse',dev,backup,manifest,digest);assert.equal(result.status,0,result.stderr);
  const proof=parse(result);assert.equal(proof.runnerVerified,true);assert.equal(proof.restoreVerified,true);assert.equal(proof.runnerRuns,2);assert.equal(proof.secondRunNoOp,true);
  const sqlite=proof.sqlite;assert.ok(path.relative(path.join(root,'tmp'),sqlite)&&!path.relative(path.join(root,'tmp'),sqlite).startsWith('..'));
  assert.equal(run('compare',dev,backup,manifest,digest,sqlite).status,0);
  const db=new DatabaseSync(sqlite);db.prepare('UPDATE sqlite_sequence SET seq=101 WHERE name=?').run('qa_counter');db.close();
  const sequenceAltered=run('compare',dev,backup,manifest,digest,sqlite);assert.notEqual(sequenceAltered.status,0);assert.equal(parse(sequenceAltered).code,'EXISTING_SEQUENCE_CHANGED');
  const db2=new DatabaseSync(sqlite);db2.prepare('UPDATE sqlite_sequence SET seq=100 WHERE name=?').run('qa_counter');db2.prepare('UPDATE preview_users SET display_name=? WHERE id=?').run('synthetic mutation','qa-person');db2.close();
  const altered=run('compare',dev,backup,manifest,digest,sqlite);assert.notEqual(altered.status,0);assert.equal(parse(altered).code,'EXISTING_ROWS_CHANGED');
});

test('untrusted SQL cannot attach a filesystem database during isolated verification',()=>{
  const target=path.join(dir,'must-not-exist.sqlite');const malicious=path.join(dir,'malicious.sql');
  writeFileSync(malicious,`ATTACH DATABASE '${target.replaceAll("'","''")}' AS stolen;`,{flag:'wx'});
  assert.notEqual(run('sign',dev,malicious,path.join(dir,'malicious-manifest.json')).status,0);
  assert.equal(existsSync(target),false);
});

test('130 MiB synthetic export survives signed local runner rehearsal without collecting rows in JS arrays',{skip:process.env.CF_CARD_SCALE_TEST!=='1',timeout:200000},()=>{
  const large=path.join(dir,'scale-130m.sql'),signedFile=path.join(dir,'scale-130m-manifest.json');
  const fd=openSync(large,'wx');
  try {
    writeSync(fd,sql+'\nCREATE TABLE qa_large(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);\n');
    const body='x'.repeat(1024*1024);
    for(let index=0;index<130;index++)writeSync(fd,`INSERT INTO qa_large VALUES (${index},'${body}');\n`);
  } finally {closeSync(fd);}
  const bytes=statSync(large).size;assert.ok(bytes>=130*1024*1024);
  const started=Date.now();let persist;
  try {
    const signed=run('sign',dev,large,signedFile);assert.equal(signed.status,0,signed.stderr);const signing=parse(signed),pin=signing.publicKeySha256;
    const verified=run('verify',dev,large,signedFile,pin);assert.equal(verified.status,0,verified.stderr);
    const rehearsed=run('rehearse',dev,large,signedFile,pin);assert.equal(rehearsed.status,0,rehearsed.stderr);const proof=parse(rehearsed);persist=proof.persist;
    assert.equal(proof.runnerVerified,true);assert.equal(proof.secondRunNoOp,true);assert.equal(proof.existingRowsPreserved,true);
    console.log(JSON.stringify({scope:'SYNTHETIC_130_MIB',bytes,durationMs:Date.now()-started,signMemory:signing.memory,verifyMemory:parse(verified).memory,rehearseMemory:proof.memory,wranglerChildMemoryMeasured:false,customerRowsPrinted:false}));
  } finally {
    // Only synthetic files created by this test are cleaned; never touch user backups.
    if(existsSync(large))unlinkSync(large);if(existsSync(signedFile))unlinkSync(signedFile);
    if(persist){const parent=realpathSync(path.join(root,'tmp')),target=realpathSync(persist),relative=path.relative(parent,target);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(target).startsWith('cf-card-isolated-'));rmSync(target,{recursive:true});}
  }
});
