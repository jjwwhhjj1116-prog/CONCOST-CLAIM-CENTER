// Local-only signed D1 export verification and isolated Wrangler migration rehearsal.
// No customer rows, OAuth values, or SQL are printed. Never opens a remote database.
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync, constants } from 'node:sqlite';
import path from 'node:path';

const root=process.cwd();
const migrationDirectory=path.join(root,'apps/cloudflare/migrations');
const migrations=['0070_business_card_transfers.sql','0071_business_card_back_images.sql'];
const environments={
  '16d1f25b-60c8-4489-95ed-4fa7de161c9f':'wrangler.development.jsonc',
  '78094a1c-abe0-451d-bc12-68d0d37166d8':'wrangler.jsonc'
};
const addedTables=['preview_business_card_transfers','preview_business_card_transfer_images','preview_business_card_analysis_backs','preview_business_card_backs','preview_business_card_operation_files','preview_business_card_analysis_locks','preview_business_card_source_locks'].sort();
const addedObjects=[...addedTables,'idx_preview_business_card_transfers_actor','preview_business_card_backs_insert_guard','preview_business_card_backs_immutable_update','preview_business_card_backs_immutable_delete','preview_business_card_analysis_backs_immutable_update','preview_business_card_analysis_backs_immutable_delete','preview_business_card_operation_files_immutable_update','preview_business_card_operation_files_immutable_delete'].sort();
class CheckFailure extends Error {}
const check=(condition,code)=>{if(!condition)throw new CheckFailure(code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,(_key,item)=>typeof item==='bigint'?{integer:item.toString()}:item instanceof Uint8Array?{blob:Buffer.from(item).toString('base64')}:typeof item==='number'&&(!Number.isFinite(item)||Object.is(item,-0))?{number:Object.is(item,-0)?'-0':String(item)}:item);
const memory=()=>({residentBytes:process.memoryUsage().rss,peakResidentKiB:process.resourceUsage().maxRSS});
const equal=(a,b,code)=>check(hash(json(a))===hash(json(b)),code);
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const all=(db,sql)=>{const stmt=db.prepare(sql);stmt.setReadBigInts(true);return stmt.all();};
const authorizer=(action,arg1,arg2)=>{
  if(action===constants.SQLITE_ATTACH||action===constants.SQLITE_DETACH)return constants.SQLITE_DENY;
  if(action===constants.SQLITE_PRAGMA&&['writable_schema','temp_store_directory','data_store_directory'].includes(String(arg1).toLowerCase()))return constants.SQLITE_DENY;
  if(action===constants.SQLITE_FUNCTION&&String(arg2??arg1).toLowerCase()==='load_extension')return constants.SQLITE_DENY;
  return constants.SQLITE_OK;
};
const protect=db=>{db.setAuthorizer(authorizer);return db;};
const loadSql=file=>{const db=protect(new DatabaseSync(':memory:'));try{db.exec(readFileSync(file,'utf8'));db.exec('PRAGMA foreign_keys=ON');return db;}catch(error){db.close();throw error;}};
const loadActual=file=>{if(/\.sqlite$/i.test(file)){const db=protect(new DatabaseSync(file,{readOnly:true}));db.exec('PRAGMA foreign_keys=ON');return db;}return loadSql(file);};
// _cf_ and sqlite_ are Cloudflare/SQLite internal objects, not user-owned data.
const schema=db=>all(db,"SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").map(row=>({...row,sql:row.sql?.trim()}));
const tables=db=>schema(db).filter(row=>row.type==='table').map(row=>row.name).sort();
const rows=(db,name)=>all(db,'SELECT * FROM '+quote(name));
const sortedRows=(db,name)=>rows(db,name).map(json).sort();
// Sort in SQLite and hash one row at a time so the JS heap never materializes a
// whole table. typeof + explicit BINARY collation gives stable, exact ordering.
const tableDigest=(db,name)=>{
  const columns=db.prepare('SELECT * FROM '+quote(name)+' LIMIT 0').columns().map(column=>column.name);
  check(columns.length>0,'TABLE_WITHOUT_COLUMNS');
  const order=columns.flatMap(column=>[`typeof(${quote(column)})`,`${quote(column)} COLLATE BINARY`]).join(',');
  const statement=db.prepare('SELECT * FROM '+quote(name)+' ORDER BY '+order);statement.setReadBigInts(true);
  const digest=createHash('sha256');digest.update(json(columns));let count=0;
  for(const row of statement.iterate()){const serialized=json(row);digest.update(String(Buffer.byteLength(serialized))+':');digest.update(serialized);count++;}
  return {count,sha256:digest.digest('hex')};
};
const inventory=db=>Object.fromEntries(tables(db).map(name=>[name,tableDigest(db,name)]));
const sequenceRows=db=>db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").get().n ? all(db,'SELECT name,seq FROM sqlite_sequence').map(json).sort() : [];
const integrity=db=>{check(db.prepare('PRAGMA integrity_check').get().integrity_check==='ok','INTEGRITY_FAILED');check(all(db,'PRAGMA foreign_key_check').length===0,'FOREIGN_KEYS_FAILED');};
const localMigrations=()=>readdirSync(migrationDirectory).filter(name=>/^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
const migrationSql=()=>Object.fromEntries(migrations.map(name=>[name,readFileSync(path.join(migrationDirectory,name),'utf8')]));
const migrationHashes=names=>Object.fromEntries(names.map(name=>{check(/^\d{4}_[a-z0-9_]+\.sql$/.test(name),'INVALID_LEDGER_NAME');return[name,hash(readFileSync(path.join(migrationDirectory,name)))];}));
const validateBefore=db=>{
  integrity(db);check(tables(db).includes('d1_migrations'),'MIGRATION_LEDGER_REQUIRED');
  const applied=rows(db,'d1_migrations').map(row=>row.name);
  check(new Set(applied).size===applied.length,'DUPLICATE_LEDGER_NAME');
  check(!applied.some(name=>migrations.includes(name)),'BACKUP_MUST_PRECEDE_MIGRATIONS');
  check(!tables(db).some(name=>addedTables.includes(name)),'BACKUP_ALREADY_HAS_NEW_TABLES');
  const files=localMigrations();check(migrations.every(name=>files.includes(name)),'MIGRATION_FILE_MISSING');
  equal(files.filter(name=>!applied.includes(name)),migrations,'UNEXPECTED_PENDING_MIGRATIONS');
  check(applied.every(name=>files.includes(name)),'APPLIED_SOURCE_FILE_MISSING');
  return {tables:inventory(db),schemaSha256:hash(json(schema(db))),ledgerSha256:hash(json(sortedRows(db,'d1_migrations'))),sequenceSha256:hash(json(sequenceRows(db))),appliedSourceHashes:migrationHashes(applied.sort()),newMigrationHashes:migrationHashes(migrations)};
};
const authenticate=(database,backup,manifest,pin)=>{
  check(/^[0-9a-f]{64}$/.test(pin??''),'INDEPENDENT_PIN_REQUIRED');
  const envelope=JSON.parse(readFileSync(manifest,'utf8'));
  check(hash(envelope.publicKey)===pin,'PIN_MISMATCH');
  check(verify(null,Buffer.from(json(envelope.manifest)),envelope.publicKey,Buffer.from(envelope.signature,'base64')),'SIGNATURE_INVALID');
  check(envelope.manifest.kind==='CLAIM_CARD_D1_BACKUP_V1'&&envelope.manifest.database===database,'DATABASE_SCOPE_MISMATCH');
  check(envelope.manifest.sqlSha256===hash(readFileSync(backup)),'BACKUP_HASH_MISMATCH');
  const db=loadSql(backup);
  try{equal(validateBefore(db),envelope.manifest.state,'SIGNED_STATE_CHANGED');}catch(error){db.close();throw error;}
  return db;
};
const directExpected=backup=>{const expected=loadSql(backup);for(const sql of Object.values(migrationSql()))expected.exec(sql);integrity(expected);return expected;};
const compare=(before,actual,expected)=>{
  integrity(actual);const oldTables=tables(before),actualTables=tables(actual);
  equal(actualTables,[...oldTables,...addedTables].sort(),'TABLE_INVENTORY_CHANGED');
  const oldSchema=schema(before),actualSchema=schema(actual),expectedSchema=schema(expected);
  equal(actualSchema.filter(item=>!addedObjects.includes(item.name)),oldSchema,'EXISTING_SCHEMA_CHANGED');
  equal(actualSchema.filter(item=>addedObjects.includes(item.name)).map(item=>item.name).sort(),addedObjects,'ADDED_OBJECT_SET_CHANGED');
  equal(actualSchema,expectedSchema,'ACTUAL_SCHEMA_DIFFERS');
  for(const name of oldTables)if(name!=='d1_migrations')equal(tableDigest(actual,name),tableDigest(before,name),'EXISTING_ROWS_CHANGED');
  for(const name of addedTables)check(tableDigest(actual,name).count===0,'NEW_TABLE_NOT_EMPTY');
  const nonLedgerSequence=db=>sequenceRows(db).filter(row=>JSON.parse(row).name!=='d1_migrations');
  equal(nonLedgerSequence(actual),nonLedgerSequence(before),'EXISTING_SEQUENCE_CHANGED');
  const oldLedger=sortedRows(before,'d1_migrations'),newLedger=sortedRows(actual,'d1_migrations');
  check(oldLedger.every(row=>newLedger.includes(row)),'EXISTING_LEDGER_CHANGED');
  check(newLedger.length===oldLedger.length+migrations.length,'LEDGER_COUNT_MISMATCH');
  for(const name of migrations)check(rows(actual,'d1_migrations').filter(row=>row.name===name).length===1,'LEDGER_MIGRATION_MISSING');
};
const runnerEnv=()=>{const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION/i.test(name)));env.CI='true';env.WRANGLER_SEND_METRICS='false';return env;};
const runWrangler=(config,persist,args)=>{
  // Config and `--local` are fixed here. Never accept `--remote` from a caller.
  const started=Date.now();
  const output=execFileSync(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'d1',...args,'DB','--local','--config',config,'--persist-to',persist],{cwd:root,encoding:'utf8',env:runnerEnv(),timeout:50000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
  return {durationMs:Date.now()-started,outputSha256:hash(output)};
};
const findLocalDb=persist=>{
  const dir=path.join(persist,'v3/d1/miniflare-D1DatabaseObject');
  const files=readdirSync(dir).filter(name=>name.endsWith('.sqlite')&&name!=='metadata.sqlite');
  check(files.length===1,'ISOLATED_SQLITE_AMBIGUOUS');
  const file=realpathSync(path.join(dir,files[0])),rootPath=realpathSync(persist),relative=path.relative(rootPath,file);
  check(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'ISOLATED_SQLITE_OUTSIDE_ROOT');return file;
};

let before;
try{
  const [mode,database,backup,manifest,pin,actual,...extra]=process.argv.slice(2);
  check(['sign','verify','rehearse','compare'].includes(mode)&&!extra.length,'USAGE');
  check(Object.hasOwn(environments,database??''),'EXPLICIT_DATABASE_REQUIRED');
  check(typeof backup==='string'&&/\.sql$/i.test(backup)&&typeof manifest==='string','SQL_AND_MANIFEST_REQUIRED');
  check(mode==='sign'?!pin&&!actual:mode==='compare'?!!pin&&!!actual:!!pin&&!actual,'ARGUMENTS_INVALID');
  if(mode==='sign'){
    before=loadSql(backup);const state=validateBefore(before);
    const signed={kind:'CLAIM_CARD_D1_BACKUP_V1',database,createdAt:new Date().toISOString(),sqlSha256:hash(readFileSync(backup)),state};
    const {publicKey,privateKey}=generateKeyPairSync('ed25519');
    const envelope={manifest:signed,publicKey:publicKey.export({type:'spki',format:'pem'}),signature:sign(null,Buffer.from(json(signed)),privateKey).toString('base64')};
    writeFileSync(manifest,JSON.stringify(envelope,null,2),{flag:'wx',mode:0o600});
    console.log(JSON.stringify({valid:true,mode,database,tableCount:Object.keys(state.tables).length,sqlSha256:signed.sqlSha256,publicKeySha256:hash(envelope.publicKey),independentPinRequired:true,memory:memory(),customerRowsPrinted:false}));
  }else{
    before=authenticate(database,backup,manifest,pin);
    if(mode==='verify')console.log(JSON.stringify({valid:true,mode,database,signatureVerified:true,restoreVerified:false,runnerVerified:false,memory:memory(),customerRowsPrinted:false}));
    else {
      const expected=directExpected(backup);
      try{
        // Check direct SQL does not alter any old schema or data; it is not runner evidence.
        equal(tables(expected),[...tables(before),...addedTables].sort(),'MIGRATION_ADDS_UNEXPECTED_TABLES');
        equal(schema(expected).filter(item=>!addedObjects.includes(item.name)),schema(before),'MIGRATION_CHANGES_EXISTING_SCHEMA');
        equal(schema(expected).filter(item=>addedObjects.includes(item.name)).map(item=>item.name).sort(),addedObjects,'MIGRATION_ADDS_UNEXPECTED_OBJECTS');
        for(const name of tables(before))equal(tableDigest(expected,name),tableDigest(before,name),'MIGRATION_CHANGES_EXISTING_ROWS');
        equal(sequenceRows(expected),sequenceRows(before),'MIGRATION_CHANGES_EXISTING_SEQUENCES');
        if(mode==='compare'){
          const after=loadActual(actual);try{compare(before,after,expected);}finally{after.close();}
          console.log(JSON.stringify({valid:true,mode,database,signatureVerified:true,restoreVerified:false,runnerVerified:false,existingRowsPreserved:true,existingSchemaPreserved:true,exactMigrationLedger:true,memory:memory(),customerRowsPrinted:false}));
        }else{
          const tmpPath=path.join(root,'tmp');check(existsSync(tmpPath)&&statSync(tmpPath).isDirectory(),'TEMP_ROOT_REQUIRED');
          const temporaryRoot=realpathSync(tmpPath),repositoryRoot=realpathSync(root),relativeTemp=path.relative(repositoryRoot,temporaryRoot);
          check(relativeTemp&&!relativeTemp.startsWith('..')&&!path.isAbsolute(relativeTemp),'TEMP_ROOT_OUTSIDE_REPOSITORY');
          const persist=mkdtempSync(path.join(temporaryRoot,'cf-card-isolated-'));
          const init=runWrangler(environments[database],persist,['execute','--command','SELECT 1 AS ok','--json']);
          const sqlite=findLocalDb(persist);const restored=protect(new DatabaseSync(sqlite));
          try{
            check(schema(restored).length===0,'RESTORE_TARGET_NOT_EMPTY');
            restored.exec(readFileSync(backup,'utf8'));restored.exec('PRAGMA foreign_keys=ON');integrity(restored);
            equal(inventory(restored),inventory(before),'RESTORED_ROWS_DIFFER');equal(schema(restored),schema(before),'RESTORED_SCHEMA_DIFFERS');equal(sequenceRows(restored),sequenceRows(before),'RESTORED_SEQUENCES_DIFFER');
          }finally{restored.close();}
          const first=runWrangler(environments[database],persist,['migrations','apply']);
          const afterFirst=loadActual(sqlite);let firstInventory,firstSchema,firstSequences;
          try{compare(before,afterFirst,expected);firstInventory=inventory(afterFirst);firstSchema=schema(afterFirst);firstSequences=sequenceRows(afterFirst);}finally{afterFirst.close();}
          const second=runWrangler(environments[database],persist,['migrations','apply']);
          const afterSecond=loadActual(sqlite);
          try{compare(before,afterSecond,expected);equal(inventory(afterSecond),firstInventory,'SECOND_RUN_CHANGED_ROWS');equal(schema(afterSecond),firstSchema,'SECOND_RUN_CHANGED_SCHEMA');equal(sequenceRows(afterSecond),firstSequences,'SECOND_RUN_CHANGED_SEQUENCES');}finally{afterSecond.close();}
          console.log(JSON.stringify({valid:true,mode,database,signatureVerified:true,restoreVerified:true,runnerVerified:true,runner:'wrangler d1 migrations apply --local',runnerRuns:2,secondRunNoOp:true,existingRowsPreserved:true,existingSchemaPreserved:true,exactMigrationLedger:true,internalTablesExcluded:true,appliedSourceHashesAreLocalNotHistorical:true,persist,sqlite,init,first,second,memory:memory(),customerRowsPrinted:false}));
        }
      }finally{expected.close();}
    }
  }
}catch(error){console.error(JSON.stringify({valid:false,code:error instanceof CheckFailure?error.message:'BACKUP_CHECK_FAILED_NO_SENSITIVE_DETAIL'}));process.exitCode=1;}
finally{before?.close();}
