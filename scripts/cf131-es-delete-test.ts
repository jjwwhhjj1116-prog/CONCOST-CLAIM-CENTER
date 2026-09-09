import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs, { type Database } from 'sql.js';
import { newEsInput } from '../packages/document-engine/src/es-calculation';
import { handleEsRequest, type EsActor, type EsStatement, type EsStore } from '../packages/document-engine/src/es-service';

// Isolated synthetic SQLite only: no original workbooks, remote D1, keys or live records.
const owner: EsActor = { id: 'cf131-owner', organizationId: 'cf131-company', admin: false };
const peer: EsActor = { id: 'cf131-peer', organizationId: owner.organizationId, admin: false };
const admin: EsActor = { id: 'cf131-admin', organizationId: owner.organizationId, admin: true };
const foreign: EsActor = { id: 'cf131-foreign-admin', organizationId: 'cf131-foreign', admin: true };
const link = '13100000-0000-4000-8000-000000000001';
const base = '/api/es/documents';
const migrations = {
  d1: readFileSync('apps/cloudflare/migrations/0063_cf123_es_documents.sql', 'utf8'),
  node: readFileSync('packages/database/prisma/migrations/20260908090000_cf123_es_documents/migration.sql', 'utf8'),
};
const sqlReady = initSqlJs();
type Row = Record<string, any>;
const rows = (db: Database, sql: string, values: (string | number | null)[] = []) => {
  const statement = db.prepare(sql), result: Row[] = [];
  try { statement.bind(values); while (statement.step()) result.push(statement.getAsObject()); return result; }
  finally { statement.free(); }
};
const tables = ['es_documents', 'es_revisions', 'es_runs', 'es_outputs', 'es_audit_events'] as const;
const snapshot = (db: Database) => Object.fromEntries(tables.map(name => [name, rows(db, `SELECT * FROM ${name} ORDER BY rowid`)]));
const input = (title = 'CF131 합성 산출서') => {
  const value = newEsInput(); value.title = title; value.baseDate = '2024-06-15'; value.adjustmentDate = '2026-05-01';
  value.contractAmount = '123456789'; value.costs['11'] = '100000'; value.base.source = '합성 보존 원자료';
  return value;
};
class Store implements EsStore {
  beforeBatch?: () => Promise<void>;
  constructor(readonly db: Database) {}
  async all<T>(sql: string, values: (string | number | null)[]) { return rows(this.db, sql, values) as T[]; }
  async batch(statements: EsStatement[]) {
    const hook = this.beforeBatch; this.beforeBatch = undefined; if (hook) await hook();
    this.db.run('BEGIN IMMEDIATE');
    try { for (const statement of statements) this.db.run(statement.sql, statement.values); this.db.run('COMMIT'); }
    catch (error) { this.db.run('ROLLBACK'); throw error; }
  }
}
function result(response: { status: number; body: unknown }, expected = 200): any {
  assert.equal(response.status, expected, JSON.stringify(response.body)); return response.body;
}
function conflict(response: { status: number; body: unknown }) {
  assert.ok([404, 409].includes(response.status), `A stale/deleted operation cannot succeed: ${JSON.stringify(response)}`);
}
async function fixture(kind: keyof typeof migrations = 'd1') {
  const SQL = await sqlReady, db = new SQL.Database(); db.run('PRAGMA foreign_keys=ON'); db.exec(migrations[kind]);
  const store = new Store(db);
  const call = (path = base, method = 'GET', body?: unknown, actor = owner) => handleEsRequest({
    pathname: path, method, body, actor, store, canLink: async caseId => caseId === link,
  });
  const create = async (actor = owner, title?: string) => result(await call(base, 'POST', { input: input(title), caseId: link }, actor), 201);
  const provision = async () => {
    const saved = await create(), id = saved.document.id as string, path = `${base}/${id}`;
    const run = result(await call(`${path}/runs`, 'POST', { expectedRevision: 1 }), 201).run;
    const output = result(await call(`${path}/outputs`, 'POST', { runId: run.id, selection: ['cover'], format: 'REPORT_XLSX' }), 201).output;
    return { id, path, saved, run, output };
  };
  const verify = () => { assert.deepEqual(db.exec('PRAGMA integrity_check')[0].values, [['ok']]); assert.deepEqual(db.exec('PRAGMA foreign_key_check'), []); };
  return { db, store, call, create, provision, verify };
}
const ids = (payload: any) => payload.documents.map((document: any) => document.id).sort();

for (const kind of ['d1', 'node'] as const) test(`CF131 ${kind} delete/restore append exact input snapshots, retain all prior evidence and require a fresh run`, async () => {
  const { db, call, create, provision, verify } = await fixture(kind);
  try {
    const { id, path, saved, run, output } = await provision(), second = await create(owner, '보존할 다른 산출서');
    const before = snapshot(db), firstRevision = rows(db, 'SELECT * FROM es_revisions WHERE documentId=?', [id])[0];
    result(await call(path, 'DELETE', { expectedRevision: 1, input: input('삭제 요청의 위조 입력'), caseId: null, ownerId: peer.id }));
    const deletedDocument = rows(db, 'SELECT * FROM es_documents WHERE id=?', [id])[0];
    assert.equal(deletedDocument.revision, 2);
    for (const key of ['id', 'title', 'ownerId', 'organizationId', 'caseId', 'createdAt']) assert.equal(deletedDocument[key], saved.document[key]);
    assert.equal(rows(db, 'SELECT * FROM es_documents').length, 2);
    assert.deepEqual(ids(result(await call())), [second.document.id]);
    const trash = result(await call(`${base}/trash`)); assert.deepEqual(ids(trash), [id]); assert.equal(trash.documents[0].revision, 2);
    assert.deepEqual(rows(db, 'SELECT * FROM es_runs'), before.es_runs);
    assert.deepEqual(rows(db, 'SELECT * FROM es_outputs'), before.es_outputs);
    assert.deepEqual(rows(db, 'SELECT * FROM es_revisions ORDER BY rowid').slice(0, before.es_revisions.length), before.es_revisions);
    assert.deepEqual(rows(db, 'SELECT * FROM es_audit_events ORDER BY rowid').slice(0, before.es_audit_events.length), before.es_audit_events);
    const deletedRevision = rows(db, 'SELECT * FROM es_revisions WHERE documentId=? AND revision=2', [id])[0];
    assert.equal(deletedRevision.inputJson, firstRevision.inputJson); assert.equal(deletedRevision.inputHash, firstRevision.inputHash);
    assert.deepEqual(rows(db, "SELECT action,revision,actorId FROM es_audit_events WHERE documentId=? AND action='DELETED'", [id]), [{ action: 'DELETED', revision: 2, actorId: owner.id }]);
    const deleted = snapshot(db);
    for (const [endpoint, method, body] of [
      [path, 'GET', undefined], [path, 'PUT', { expectedRevision: 2, input: input() }],
      [`${path}/runs`, 'POST', { expectedRevision: 2 }],
      [`${path}/outputs`, 'POST', { runId: run.id, selection: ['cover'], format: 'REPORT_XLSX' }],
      [`${path}/outputs`, 'PATCH', { outputId: output.id, status: 'RENDERED' }],
    ] as const) result(await call(endpoint, method, body), 404);
    assert.deepEqual(snapshot(db), deleted);
    result(await call(`${path}/restore`, 'POST', { expectedRevision: 2, input: input('복구 요청의 위조 입력') }, admin));
    const reopened = result(await call(path));
    assert.deepEqual(reopened.input, saved.input); assert.equal(reopened.inputHash, saved.inputHash);
    assert.equal(reopened.document.revision, 3); assert.equal(reopened.document.ownerId, owner.id); assert.equal(reopened.document.caseId, link);
    assert.equal(reopened.run, null); assert.deepEqual(ids(result(await call(`${base}/trash`))), []);
    assert.deepEqual(ids(result(await call())), [id, second.document.id].sort());
    const restoredRevision = rows(db, 'SELECT * FROM es_revisions WHERE documentId=? AND revision=3', [id])[0];
    assert.equal(restoredRevision.inputJson, firstRevision.inputJson); assert.equal(restoredRevision.inputHash, firstRevision.inputHash);
    assert.equal(restoredRevision.actorId, admin.id);
    assert.deepEqual(rows(db, "SELECT action,revision,actorId FROM es_audit_events WHERE documentId=? AND action='RESTORED'", [id]), [{ action: 'RESTORED', revision: 3, actorId: admin.id }]);
    const restored = snapshot(db);
    result(await call(`${path}/outputs`, 'POST', { runId: run.id, selection: ['cover'], format: 'REPORT_XLSX' }), 409);
    assert.deepEqual(snapshot(db), restored);
    const fresh = result(await call(`${path}/runs`, 'POST', { expectedRevision: 3 }), 201).run;
    assert.equal(fresh.revision, 3); assert.deepEqual(fresh.input, saved.input);
    result(await call(`${path}/outputs`, 'POST', { runId: fresh.id, selection: ['cover'], format: 'REPORT_XLSX' }), 201);
    assert.deepEqual(rows(db, 'SELECT * FROM es_runs WHERE id=?', [run.id]), before.es_runs);
    assert.deepEqual(rows(db, 'SELECT * FROM es_outputs WHERE id=?', [output.id]), before.es_outputs);
    assert.deepEqual(rows(db, 'SELECT * FROM es_documents WHERE id=?', [second.document.id]), before.es_documents.filter(row => row.id === second.document.id));
    verify();
  } finally { db.close(); }
});

test('CF131 trash and delete/restore retain owner/company ACL and conceal inaccessible document IDs', async () => {
  const { db, call, create, verify } = await fixture();
  try {
    const mine = await create(), theirs = await create(peer), elsewhere = await create(foreign);
    const path = `${base}/${mine.document.id}`, before = snapshot(db);
    for (const actor of [peer, foreign]) {
      result(await call(path, 'DELETE', { expectedRevision: 1 }, actor), 404);
      result(await call(`${path}/restore`, 'POST', { expectedRevision: 1 }, actor), 404);
    }
    for (const actor of [{ ...owner, id: '' }, { ...owner, organizationId: '' }]) {
      result(await call(`${base}/trash`, 'GET', undefined, actor), 401);
      result(await call(path, 'DELETE', { expectedRevision: 1 }, actor), 401);
    }
    assert.deepEqual(snapshot(db), before);
    result(await call(path, 'DELETE', { expectedRevision: 1 }, admin));
    result(await call(`${base}/${theirs.document.id}`, 'DELETE', { expectedRevision: 1 }, peer));
    result(await call(`${base}/${elsewhere.document.id}`, 'DELETE', { expectedRevision: 1 }, foreign));
    assert.deepEqual(ids(result(await call(`${base}/trash`))), [mine.document.id]);
    assert.deepEqual(ids(result(await call(`${base}/trash`, 'GET', undefined, peer))), [theirs.document.id]);
    assert.deepEqual(ids(result(await call(`${base}/trash`, 'GET', undefined, admin))), [mine.document.id, theirs.document.id].sort());
    assert.deepEqual(ids(result(await call(`${base}/trash`, 'GET', undefined, foreign))), [elsewhere.document.id]);
    const deleted = snapshot(db);
    for (const actor of [peer, foreign]) result(await call(`${path}/restore`, 'POST', { expectedRevision: 2 }, actor), 404);
    assert.deepEqual(snapshot(db), deleted);
    result(await call(`${path}/restore`, 'POST', { expectedRevision: 2 })); verify();
  } finally { db.close(); }
});

test('CF131 delete/restore require exact integer revisions and reject invalid routes or repeated state transitions without writes', async () => {
  const { db, call, create, verify } = await fixture();
  try {
    const saved = await create(), path = `${base}/${saved.document.id}`, before = snapshot(db);
    for (const expectedRevision of [undefined, null, '1', 0, -1, 1.5, 2, Number.MAX_SAFE_INTEGER + 1]) result(await call(path, 'DELETE', { expectedRevision }), 409);
    result(await call(`${path}/restore`, 'POST', { expectedRevision: 1 }), 409);
    for (const path of [`${base}/not-a-uuid`, `${base}/trash/restore`, `${base}/13100000-0000-4000-8000-000000000099`]) result(await call(path, 'DELETE', { expectedRevision: 1 }), 404);
    assert.deepEqual(snapshot(db), before);
    result(await call(path, 'DELETE', { expectedRevision: 1 })); const deleted = snapshot(db);
    conflict(await call(path, 'DELETE', { expectedRevision: 2 }));
    for (const expectedRevision of [undefined, null, '2', 0, -1, 1.5, 1, 3]) result(await call(`${path}/restore`, 'POST', { expectedRevision }), 409);
    assert.deepEqual(snapshot(db), deleted);
    result(await call(`${path}/restore`, 'POST', { expectedRevision: 2 })); const restored = snapshot(db);
    result(await call(`${path}/restore`, 'POST', { expectedRevision: 3 }), 409);
    assert.deepEqual(snapshot(db), restored); verify();
  } finally { db.close(); }
});

for (const operation of ['save', 'calculate', 'output-create', 'output-status', 'delete'] as const) test(`CF131 beforeBatch deletion wins over an already-started ${operation} without extra revisions, jobs or false success`, async () => {
  const { db, store, call, provision, verify } = await fixture();
  try {
    const { path, run, output } = await provision(); let winner: ReturnType<typeof snapshot> | undefined;
    store.beforeBatch = async () => { result(await call(path, 'DELETE', { expectedRevision: 1 })); winner = snapshot(db); };
    const request = operation === 'save' ? call(path, 'PUT', { expectedRevision: 1, input: input('실패해야 할 후발 저장') })
      : operation === 'calculate' ? call(`${path}/runs`, 'POST', { expectedRevision: 1 })
        : operation === 'output-create' ? call(`${path}/outputs`, 'POST', { runId: run.id, selection: ['cover'], format: 'REPORT_XLSX' })
          : operation === 'output-status' ? call(`${path}/outputs`, 'PATCH', { outputId: output.id, status: 'RENDERED' })
            : call(path, 'DELETE', { expectedRevision: 1 });
    conflict(await request); assert.ok(winner, 'the mutation must reach the real beforeBatch boundary');
    assert.deepEqual(snapshot(db), winner); result(await call(path), 404); verify();
  } finally { db.close(); }
});

test('CF131 beforeBatch save wins over deletion and preserves the new active input', async () => {
  const { db, store, call, create, verify } = await fixture();
  try {
    const saved = await create(), path = `${base}/${saved.document.id}`; let winner: ReturnType<typeof snapshot> | undefined;
    store.beforeBatch = async () => { result(await call(path, 'PUT', { expectedRevision: 1, input: input('먼저 저장한 제목'), caseId: link })); winner = snapshot(db); };
    result(await call(path, 'DELETE', { expectedRevision: 1 }), 409);
    assert.ok(winner); assert.deepEqual(snapshot(db), winner);
    assert.equal(result(await call(path)).input.title, '먼저 저장한 제목');
    assert.deepEqual(ids(result(await call(`${base}/trash`))), []); verify();
  } finally { db.close(); }
});

for (const deleteAgain of [false, true]) test(`CF131 concurrent restore${deleteAgain ? ' followed by delete' : ''} prevents a stale restore from reopening or adding revisions`, async () => {
  const { db, store, call, create, verify } = await fixture();
  try {
    const saved = await create(), path = `${base}/${saved.document.id}`; result(await call(path, 'DELETE', { expectedRevision: 1 }));
    let winner: ReturnType<typeof snapshot> | undefined;
    store.beforeBatch = async () => {
      result(await call(`${path}/restore`, 'POST', { expectedRevision: 2 }, admin));
      if (deleteAgain) result(await call(path, 'DELETE', { expectedRevision: 3 }, admin));
      winner = snapshot(db);
    };
    result(await call(`${path}/restore`, 'POST', { expectedRevision: 2 }), 409);
    assert.ok(winner); assert.deepEqual(snapshot(db), winner);
    if (deleteAgain) { result(await call(path), 404); assert.deepEqual(ids(result(await call(`${base}/trash`))), [saved.document.id]); }
    else { assert.equal(result(await call(path)).document.revision, 3); assert.deepEqual(ids(result(await call(`${base}/trash`))), []); }
    verify();
  } finally { db.close(); }
});

for (const operation of ['DELETED', 'RESTORED'] as const) test(`CF131 failed ${operation} audit rolls back copied revision and document CAS without exposing storage details`, async () => {
  const { db, call, create, verify } = await fixture();
  try {
    const saved = await create(), path = `${base}/${saved.document.id}`;
    if (operation === 'RESTORED') result(await call(path, 'DELETE', { expectedRevision: 1 }));
    const before = snapshot(db);
    db.run(`CREATE TRIGGER cf131_fail_audit BEFORE INSERT ON es_audit_events WHEN NEW.action='${operation}' BEGIN SELECT RAISE(ABORT,'CF131 private secret adapter SQL detail'); END`);
    const response = operation === 'DELETED' ? await call(path, 'DELETE', { expectedRevision: 1 }) : await call(`${path}/restore`, 'POST', { expectedRevision: 2 });
    result(response, 503); assert.doesNotMatch(JSON.stringify(response.body), /CF131 private|secret|adapter SQL|TRIGGER|INSERT/i);
    assert.deepEqual(snapshot(db), before); verify();
  } finally { db.close(); }
});

test('CF131 ordinary saved revisions still support immutable past runs, but every delete/restore boundary invalidates older runs', async () => {
  const { db, call, provision, verify } = await fixture();
  try {
    const { path, run } = await provision();
    result(await call(path, 'PUT', { expectedRevision: 1, input: input('일반 후속 저장'), caseId: link }));
    result(await call(`${path}/outputs`, 'POST', { runId: run.id, selection: ['cover'], format: 'REPORT_XLSX' }), 201);
    result(await call(path, 'DELETE', { expectedRevision: 2 }));
    result(await call(`${path}/restore`, 'POST', { expectedRevision: 3 }));
    const newer = result(await call(`${path}/runs`, 'POST', { expectedRevision: 4 }), 201).run;
    result(await call(`${path}/outputs`, 'POST', { runId: newer.id, selection: ['cover'], format: 'REPORT_XLSX' }), 201);
    result(await call(path, 'DELETE', { expectedRevision: 4 })); result(await call(`${path}/restore`, 'POST', { expectedRevision: 5 }));
    const before = snapshot(db);
    for (const runId of [run.id, newer.id]) result(await call(`${path}/outputs`, 'POST', { runId, selection: ['cover'], format: 'REPORT_XLSX' }), 409);
    assert.deepEqual(snapshot(db), before); assert.equal(result(await call(path)).run, null); verify();
  } finally { db.close(); }
});

test('CF131 restoring cannot resume pre-deletion REQUESTED or RENDERED output jobs through late lifecycle PATCH requests', async () => {
  const { db, call, provision, verify } = await fixture();
  try {
    const { path, run, output } = await provision();
    const rendered = result(await call(`${path}/outputs`, 'POST', { runId: run.id, selection: ['cover'], format: 'REPORT_XLSX' }), 201).output;
    result(await call(path, 'PUT', { expectedRevision: 1, input: input('일반 저장 이후 출력 상태'), caseId: link }));
    result(await call(`${path}/outputs`, 'PATCH', { outputId: rendered.id, status: 'RENDERED' }));
    result(await call(path, 'DELETE', { expectedRevision: 2 })); result(await call(`${path}/restore`, 'POST', { expectedRevision: 3 }));
    const before = snapshot(db);
    for (const outputId of [output.id, rendered.id]) for (const status of ['RENDERED', 'FAILED', 'DIALOG_CLOSED']) {
      result(await call(`${path}/outputs`, 'PATCH', { outputId, status }), 409);
    }
    result(await call(`${path}/outputs`, 'POST', { runId: run.id, selection: ['cover'], format: 'REPORT_XLSX' }), 409);
    assert.deepEqual(snapshot(db), before);
    assert.equal(rows(db, 'SELECT status FROM es_outputs WHERE id=?', [output.id])[0].status, 'REQUESTED');
    assert.equal(rows(db, 'SELECT status FROM es_outputs WHERE id=?', [rendered.id])[0].status, 'RENDERED'); verify();
  } finally { db.close(); }
});
