// Local-only CF123 release check. No network, credential output, or populated-DB overwrite.
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const databaseId = '16d1f25b-60c8-4489-95ed-4fa7de161c9f';
const migration = '0063_cf123_es_documents.sql';
const addedTables = ['es_audit_events', 'es_documents', 'es_outputs', 'es_revisions', 'es_runs'];
const addedObjects = [...addedTables, 'es_documents_owner', 'es_revision_no_update', 'es_revision_no_delete', 'es_run_no_update', 'es_run_no_delete', 'es_audit_no_update', 'es_audit_no_delete', 'es_owner_immutable', 'es_run_revision_scope'].sort();
class CheckFailure extends Error {}
const check = (condition, code) => { if (!condition) throw new CheckFailure(code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? { integer: item.toString() } : item instanceof Uint8Array ? { blob: Buffer.from(item).toString('base64') } : item);
const equal = (a, b, code) => check(hash(json(a)) === hash(json(b)), code);
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const all = (db, sql) => { const stmt = db.prepare(sql); stmt.setReadBigInts(true); return stmt.all(); };
const load = path => {
  if (/\.sqlite$/i.test(path)) return new DatabaseSync(path, { readOnly: true });
  const db = new DatabaseSync(':memory:');
  try { db.exec(readFileSync(path, 'utf8')); db.exec('PRAGMA foreign_keys=ON'); return db; }
  catch (error) { db.close(); throw error; }
};
const tables = db => all(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").map(row => row.name);
const rows = (db, name) => all(db, 'SELECT * FROM ' + quote(name));
const sortedRows = (db, name) => rows(db, name).map(json).sort();
const inventory = db => Object.fromEntries(tables(db).map(name => { const values = sortedRows(db, name); return [name, { count: values.length, sha256: hash(json(values)) }]; }));
const schema = db => all(db, "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").map(row => ({ ...row, sql: row.sql?.replace(/\s+/g, ' ').trim() }));
const integrity = db => {
  check(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 'INTEGRITY_CHECK');
  check(all(db, 'PRAGMA foreign_key_check').length === 0, 'FOREIGN_KEY_CHECK');
};
const preserve = (before, after) => {
  equal(tables(after), [...tables(before), ...addedTables].sort(), 'EXACT_FIVE_NEW_TABLES');
  for (const name of addedTables) check(rows(after, name).length === 0, 'NEW_ES_TABLE_NOT_EMPTY');
  for (const name of tables(before)) {
    const previous = sortedRows(before, name), current = sortedRows(after, name);
    if (name === 'd1_migrations') check(previous.every(row => current.includes(row)), 'ORIGINAL_LEDGER_CHANGED');
    else equal(current, previous, 'EXISTING_VALUES_CHANGED');
  }
  const originalSchema = schema(before), nextSchema = schema(after);
  equal(nextSchema.filter(item => originalSchema.some(previous => previous.name === item.name)), originalSchema, 'EXISTING_SCHEMA_CHANGED');
  equal(nextSchema.filter(item => !originalSchema.some(previous => previous.name === item.name)).map(item => item.name).sort(), addedObjects, 'UNREVIEWED_SCHEMA_OBJECT');
};
const runPending = (db, sql) => {
  if (rows(db, 'd1_migrations').some(row => row.name === migration)) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run(migration);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  integrity(db);
  return true;
};

let before;
try {
  const [mode, database, beforePath, manifestPath, pin, afterPath, ...extra] = process.argv.slice(2);
  check(['sign', 'verify', 'preflight', 'restore', 'compare'].includes(mode) && !extra.length, 'USAGE_sign_verify_preflight_restore_compare');
  check(database === databaseId, 'DEVELOPMENT_DATABASE_ONLY');
  check(typeof beforePath === 'string' && /\.sql$/i.test(beforePath) && typeof manifestPath === 'string', 'SQL_BACKUP_AND_MANIFEST_REQUIRED');
  check(['restore', 'compare'].includes(mode) ? !!afterPath : !afterPath, 'UNEXPECTED_OR_MISSING_AFTER_PATH');
  check(mode !== 'sign' || !pin, 'SIGN_TAKES_NO_PIN');
  const sql = readFileSync('apps/cloudflare/migrations/' + migration, 'utf8');
  equal(sql.replaceAll('\r\n', '\n'), readFileSync('packages/database/prisma/migrations/20260908090000_cf123_es_documents/migration.sql', 'utf8').replaceAll('\r\n', '\n'), 'NODE_D1_MIGRATION_MISMATCH');
  let envelope;
  if (mode !== 'sign') {
    // Authenticate the exported SQL before executing it in the isolated SQLite connection.
    check(/^[0-9a-f]{64}$/.test(pin ?? ''), 'SEPARATELY_RECORDED_PUBLIC_KEY_PIN_REQUIRED');
    envelope = JSON.parse(readFileSync(manifestPath, 'utf8'));
    check(hash(envelope.publicKey) === pin, 'PUBLIC_KEY_PIN_MISMATCH');
    check(verify(null, Buffer.from(json(envelope.manifest)), envelope.publicKey, Buffer.from(envelope.signature, 'base64')), 'MANIFEST_SIGNATURE_INVALID');
    check(envelope.manifest.kind === 'CF123_DEVELOPMENT_D1_BACKUP' && envelope.manifest.database === database, 'SIGNED_BACKUP_SCOPE_MISMATCH');
    check(envelope.manifest.sqlSha256 === hash(readFileSync(beforePath)) && envelope.manifest.migration === migration && envelope.manifest.migrationSha256 === hash(sql), 'SIGNED_BACKUP_OR_MIGRATION_CHANGED');
  }
  before = load(beforePath);
  integrity(before);
  check(tables(before).includes('d1_migrations'), 'EXISTING_MIGRATION_LEDGER_REQUIRED');
  check(!tables(before).some(name => addedTables.includes(name)), 'BACKUP_MUST_PRECEDE_ES_MIGRATION');
  check(!rows(before, 'd1_migrations').some(row => row.name === migration), 'MIGRATION_ALREADY_APPLIED_IN_BACKUP');
  const state = { sqlSha256: hash(readFileSync(beforePath)), tables: inventory(before), schemaSha256: hash(json(schema(before))), migration, migrationSha256: hash(sql) };
  if (mode === 'sign') {
    const manifest = { kind: 'CF123_DEVELOPMENT_D1_BACKUP', database, createdAt: new Date().toISOString(), ...state };
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const envelope = { manifest, publicKey: publicKey.export({ type: 'spki', format: 'pem' }), signature: sign(null, Buffer.from(json(manifest)), privateKey).toString('base64') };
    writeFileSync(manifestPath, JSON.stringify(envelope, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ valid: true, mode, database, preservedTables: tables(before).length, ...Object.fromEntries(Object.entries(state).filter(([name]) => name !== 'tables')), publicKeySha256: hash(envelope.publicKey) }));
  } else {
    for (const [name, value] of Object.entries(state)) equal(envelope.manifest[name], value, 'SIGNED_BACKUP_OR_MIGRATION_CHANGED');
    if (mode === 'restore') {
      // Wrangler creates this isolated blank DB first; never overwrite an existing populated DB.
      const target = realpathSync(afterPath), temporaryRoot = realpathSync('tmp');
      const relative = path.relative(temporaryRoot, target);
      check(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && target.endsWith('.sqlite') && path.basename(target) !== 'metadata.sqlite', 'RESTORE_REQUIRES_ISOLATED_TMP_SQLITE');
      const restored = new DatabaseSync(target);
      try {
        check(schema(restored).length === 0, 'RESTORE_TARGET_MUST_BE_EMPTY');
        restored.exec(readFileSync(beforePath, 'utf8'));
        restored.exec('PRAGMA foreign_keys=ON');
        integrity(restored);
        equal(inventory(restored), state.tables, 'RESTORED_VALUES_DIFFER');
        equal(schema(restored), schema(before), 'RESTORED_SCHEMA_DIFFERS');
      } finally { restored.close(); }
    } else if (mode !== 'verify') {
      const expected = load(beforePath);
      try {
        check(runPending(expected, sql), 'EXACT_PENDING_MIGRATION_REQUIRED');
        preserve(before, expected);
        const snapshot = inventory(expected), expectedSchema = schema(expected);
        const oldLedger = rows(before, 'd1_migrations'), newLedger = rows(expected, 'd1_migrations');
        check(newLedger.length === oldLedger.length + 1 && newLedger.filter(row => row.name === migration).length === 1, 'EXACTLY_ONE_NEW_LEDGER_ENTRY');
        check(!runPending(expected, sql), 'SECOND_RUN_MUST_SKIP');
        equal(inventory(expected), snapshot, 'SECOND_RUN_CHANGED_VALUES');
        equal(schema(expected), expectedSchema, 'SECOND_RUN_CHANGED_SCHEMA');
        integrity(expected);
        if (mode === 'compare') {
          const actual = load(afterPath);
          try {
            integrity(actual);
            preserve(before, actual);
            equal(schema(actual), expectedSchema, 'ACTUAL_SCHEMA_DIFFERS_FROM_REHEARSAL');
            const withoutTime = db => rows(db, 'd1_migrations').map(({ applied_at, ...row }) => json(row)).sort();
            equal(withoutTime(actual), withoutTime(expected), 'ACTUAL_MIGRATION_LEDGER_DIFFERS');
          } finally { actual.close(); }
        }
      } finally { expected.close(); }
    }
    const rehearsed = ['preflight', 'compare'].includes(mode);
    console.log(JSON.stringify({ valid: true, mode, database, signatureVerified: true, restoreVerified: true, preservedTables: tables(before).length, addedEmptyTables: rehearsed ? addedTables.length : undefined, migration, migrationSha256: state.migrationSha256, secondRunNoOp: rehearsed ? true : undefined }));
  }
} catch (error) {
  // SQLite/assert diagnostics can contain company data. Never print exception details or raw rows.
  console.error(JSON.stringify({ valid: false, code: error instanceof CheckFailure ? error.message : 'BACKUP_CHECK_FAILED_NO_SENSITIVE_DETAIL' }));
  process.exitCode = 1;
} finally { before?.close(); }
