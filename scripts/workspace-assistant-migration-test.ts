import assert from 'node:assert/strict';
import test from 'node:test';
import{createHash}from'node:crypto';
import{mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync}from'node:fs';
import{join,resolve}from'node:path';
import initSqlJs from 'sql.js';
import{databaseUrlFor,migrateDatabase}from'../packages/database/src/db-engine';
test('assistant quota actual SQLite migration runner preserves populated business rows and prior checksums twice',async()=>{
 const SQL=await initSqlJs(),db=new SQL.Database(),target='20261029090000_workspace_assistant_usage',directory=resolve('packages/database/prisma/migrations');
 db.run('CREATE TABLE _P04Migration(name TEXT PRIMARY KEY,checksum TEXT NOT NULL,appliedAt TEXT NOT NULL)');
 for(const name of readdirSync(directory).sort()){if(name===target)continue;let sql:string;try{sql=readFileSync(join(directory,name,'migration.sql'),'utf8');}catch{continue;}db.run(sql);db.run('INSERT INTO _P04Migration VALUES(?,?,?)',[name,createHash('sha256').update(sql).digest('hex'),'2026-10-29T00:00:00Z']);}
 db.run('INSERT INTO Organization(id,name,createdAt,updatedAt) VALUES(?,?,?,?)',['assistant-preserved-org','합성 보존 조직','2026-10-29','2026-10-29']);
 db.run('INSERT INTO User(id,email,passwordHash,name,organizationId,isActive,createdAt,updatedAt) VALUES(?,?,?,?,?,1,?,?)',['assistant-preserved-user','qa@invalid.test','synthetic-not-credential','합성 보존 직원','assistant-preserved-org','2026-10-29','2026-10-29']);
 const query='SELECT * FROM Organization;SELECT * FROM User;',before=JSON.stringify(db.exec(query)),ledger=JSON.stringify(db.exec('SELECT * FROM _P04Migration ORDER BY name'));
 const output=resolve('tmp/workspace-assistant-migration');mkdirSync(output,{recursive:true});const path=join(mkdtempSync(join(output,'isolated-')),'existing.db');writeFileSync(path,db.export());db.close();
 await migrateDatabase(databaseUrlFor(path));let migrated=new SQL.Database(readFileSync(path));assert.equal(JSON.stringify(migrated.exec(query)),before);assert.equal(JSON.stringify(migrated.exec(`SELECT * FROM _P04Migration WHERE name<>'${target}' ORDER BY name`)),ledger);assert.equal(migrated.exec('PRAGMA integrity_check')[0].values[0][0],'ok');assert.deepEqual(migrated.exec('PRAGMA foreign_key_check'),[]);assert.equal(migrated.exec('SELECT COUNT(*) FROM WorkspaceAssistantUsage')[0].values[0][0],0);const bytes=readFileSync(path);migrated.close();await migrateDatabase(databaseUrlFor(path));assert.deepEqual(readFileSync(path),bytes);
});
