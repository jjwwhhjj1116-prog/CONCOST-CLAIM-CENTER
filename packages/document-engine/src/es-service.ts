import { calculateEs, ES_ENGINE_VERSION, validateEsInput } from './es-calculation';
import { buildEsSheets, orderedEsSheets, parseEsPages } from './es-output';

export interface EsStatement { sql: string; values: (string | number | null)[] }
export interface EsStore {
  all<T>(sql: string, values: (string | number | null)[]): Promise<T[]>;
  batch(statements: EsStatement[]): Promise<void>;
}
export interface EsActor { id: string; organizationId: string; admin: boolean }
interface EsDocumentRow { id: string; organizationId: string; ownerId: string; caseId: string | null; title: string; revision: number; createdAt: string; updatedAt: string; deleted?: number }
interface EsRevisionRow { id: string; inputJson: string; inputHash: string; revision: number }
export const esHash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(v => v.toString(16).padStart(2, '0')).join('');
export async function handleEsRequest(args: {
  pathname: string; method: string; body?: unknown; store: EsStore; actor: EsActor; canLink: (caseId: string) => Promise<boolean>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { pathname, method, store, actor } = args;
  const reply = (status: number, body: Record<string, unknown>) => ({ status, body });
  const bad = (status: number, error: string) => reply(status, { error });
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const segments = pathname.slice('/api/es/documents'.length).split('/').filter(Boolean);
  if (!actor.id || !actor.organizationId) return bad(401, '로그인이 필요합니다.');
  const trash = segments.length === 1 && segments[0] === 'trash' && method === 'GET';
  if (segments.length > 2 || segments[0] && !uuid.test(segments[0]) && !trash) return bad(404, '산출서를 찾을 수 없습니다.');
  const documentId = segments[0];
  const accessSql = 'organizationId = ? AND (ownerId = ? OR ? = 1)';
  const accessValues = [actor.organizationId, actor.id, actor.admin ? 1 : 0];
  // Deletion is an immutable revision event. Advancing the revision also invalidates stale editors.
  const deletedSql = "EXISTS(SELECT 1 FROM es_audit_events a WHERE a.documentId = es_documents.id AND a.revision = es_documents.revision AND a.action = 'DELETED')";
  const activeSql = `NOT ${deletedSql}`;
  const body = args.body && typeof args.body === 'object' && !Array.isArray(args.body) ? args.body as Record<string, unknown> : {};
  try {
    if ((!documentId || trash) && method === 'GET') return reply(200, { documents: await store.all<EsDocumentRow>(`SELECT * FROM es_documents WHERE ${accessSql} AND ${trash ? deletedSql : activeSql} ORDER BY updatedAt DESC LIMIT 500`, accessValues) });
    const existing = documentId ? (await store.all<EsDocumentRow>(`SELECT *, ${deletedSql} AS deleted FROM es_documents WHERE id = ? AND ${accessSql}`, [documentId, ...accessValues]))[0] : undefined;
    if (documentId && !existing) return bad(404, '산출서를 찾을 수 없습니다.');
    const restoring = segments[1] === 'restore' && method === 'POST';
    if (existing?.deleted && !restoring) return bad(404, '산출서를 찾을 수 없습니다. 삭제한 산출서 목록을 확인하세요.');
    const latest = existing ? (await store.all<EsRevisionRow>('SELECT * FROM es_revisions WHERE documentId = ? AND revision = ?', [existing.id, existing.revision]))[0] : undefined;
    if (existing && !latest) return bad(503, '저장 이력을 확인할 수 없습니다. 새로 저장하지 말고 관리자에게 문의하세요.');
    if (existing && ((!segments[1] && method === 'DELETE') || restoring)) {
      if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== existing.revision || restoring && !existing.deleted) return bad(409, '산출서 상태가 변경되었습니다. 목록을 새로고침한 뒤 다시 확인하세요.');
      const revId = crypto.randomUUID(), revision = existing.revision + 1, now = new Date().toISOString();
      const stateSql = restoring ? deletedSql : activeSql;
      await store.batch([
        { sql: `INSERT INTO es_revisions(id,documentId,revision,inputJson,inputHash,actorId,createdAt) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM es_documents WHERE id = ? AND revision = ? AND ${stateSql})`, values: [revId, existing.id, revision, latest!.inputJson, latest!.inputHash, actor.id, now, existing.id, existing.revision] },
        { sql: `UPDATE es_documents SET revision = ?,updatedAt = ? WHERE id = ? AND revision = ? AND ${stateSql} AND EXISTS(SELECT 1 FROM es_revisions WHERE id = ?)`, values: [revision, now, existing.id, existing.revision, revId] },
        { sql: 'INSERT INTO es_audit_events(id,documentId,actorId,action,revision,createdAt) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM es_revisions WHERE id = ?)', values: [crypto.randomUUID(), existing.id, actor.id, restoring ? 'RESTORED' : 'DELETED', revision, now, revId] }
      ]);
      if (!(await store.all<EsRevisionRow>('SELECT id FROM es_revisions WHERE id = ?', [revId])).length) return bad(409, '산출서 상태가 변경되었습니다. 목록을 새로고침한 뒤 다시 확인하세요.');
      return reply(200, { document: { ...existing, revision, updatedAt: now, deleted: restoring ? 0 : 1 }, restored: restoring });
    }
    if (existing && !segments[1] && method === 'GET') {
      const input = JSON.parse(latest!.inputJson);
      const savedRun = (await store.all<{ id: string; resultJson: string; createdAt: string }>('SELECT id,resultJson,createdAt FROM es_runs WHERE documentId = ? AND revisionId = ? AND engineVersion = ? ORDER BY createdAt DESC,id DESC LIMIT 1', [existing.id, latest!.id, ES_ENGINE_VERSION]))[0];
      return reply(200, { document: existing, input, inputHash: latest!.inputHash, run: savedRun ? { id: savedRun.id, revision: existing.revision, inputHash: latest!.inputHash, createdAt: savedRun.createdAt, input, result: JSON.parse(savedRun.resultJson) } : null });
    }
    if ((!documentId && method === 'POST') || (existing && !segments[1] && method === 'PUT')) {
      let input;
      try { input = validateEsInput(body.input); } catch (error) { return bad(400, error instanceof Error ? error.message : '입력 형식을 확인하세요.'); }
      const inputJson = JSON.stringify(input);
      if (!input.title.trim()) return bad(400, '산출서 제목을 입력하세요.');
      const linkedCase = body.caseId == null || body.caseId === '' ? null : body.caseId;
      if (linkedCase !== null && (typeof linkedCase !== 'string' || linkedCase.length > 100 || !await args.canLink(linkedCase))) return bad(404, '연결할 프로젝트에 접근할 수 없습니다.');
      if (existing && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== existing.revision)) return bad(409, '다른 화면에서 저장되었습니다. 최신본을 확인한 후 변경 내용을 다시 적용하세요.');
      const id = existing?.id ?? crypto.randomUUID(), revId = crypto.randomUUID(), now = new Date().toISOString();
      const revision = existing ? existing.revision + 1 : 1, hash = await esHash(inputJson);
      const statements: EsStatement[] = [];
      if (!existing) statements.push({ sql: 'INSERT INTO es_documents(id,organizationId,ownerId,caseId,title,revision,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)', values: [id, actor.organizationId, actor.id, linkedCase as string | null, input.title, 1, now, now] });
      statements.push({ sql: `INSERT INTO es_revisions(id,documentId,revision,inputJson,inputHash,actorId,createdAt) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM es_documents WHERE id = ? AND revision = ? AND ${activeSql})`, values: [revId, id, revision, inputJson, hash, actor.id, now, id, existing?.revision ?? 1] });
      if (existing) statements.push({ sql: `UPDATE es_documents SET caseId = ?,title = ?,revision = ?,updatedAt = ? WHERE id = ? AND revision = ? AND ${activeSql} AND EXISTS(SELECT 1 FROM es_revisions WHERE id = ?)`, values: [linkedCase as string | null, input.title, revision, now, id, existing.revision, revId] });
      statements.push({ sql: 'INSERT INTO es_audit_events(id,documentId,actorId,action,revision,createdAt) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM es_revisions WHERE id = ?)', values: [crypto.randomUUID(), id, actor.id, existing ? 'SAVED' : 'CREATED', revision, now, revId] });
      await store.batch(statements);
      const saved = (await store.all<EsRevisionRow>('SELECT * FROM es_revisions WHERE id = ?', [revId]))[0];
      if (!saved) return bad(409, '저장 충돌입니다. 입력은 유지하고 최신본을 확인하세요.');
      return reply(existing ? 200 : 201, { document: { ...(existing ?? { id, organizationId: actor.organizationId, ownerId: actor.id, createdAt: now }), caseId: linkedCase, title: input.title, revision, updatedAt: now }, input, inputHash: hash });
    }
    if (existing && segments[1] === 'runs' && method === 'POST') {
      if (body.expectedRevision !== existing.revision) return bad(409, '현재 저장본이 변경되었습니다. 다시 계산하세요.');
      const result = calculateEs(JSON.parse(latest!.inputJson)), id = crypto.randomUUID(), now = new Date().toISOString();
      // The revision is immutable; later saves cannot change this run or its export.
      await store.batch([{ sql: `INSERT INTO es_runs(id,documentId,revisionId,engineVersion,resultJson,actorId,createdAt) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM es_documents WHERE id = ? AND revision = ? AND ${activeSql})`, values: [id, existing.id, latest!.id, ES_ENGINE_VERSION, JSON.stringify(result), actor.id, now, existing.id, existing.revision] },
        { sql: 'INSERT INTO es_audit_events(id,documentId,actorId,action,revision,createdAt) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM es_runs WHERE id = ?)', values: [crypto.randomUUID(), existing.id, actor.id, 'CALCULATED', existing.revision, now, id] }]);
      if (!(await store.all<{ id: string }>('SELECT id FROM es_runs WHERE id = ?', [id])).length) return bad(409, '산출서 상태가 변경되었습니다. 최신본을 확인한 뒤 다시 계산하세요.');
      return reply(201, { run: { id, revision: existing.revision, inputHash: latest!.inputHash, createdAt: now, result, input: JSON.parse(latest!.inputJson) } });
    }
    if (existing && segments[1] === 'outputs' && method === 'POST') {
      if (typeof body.runId !== 'string' || !uuid.test(body.runId) || !Array.isArray(body.selection) || body.selection.length > 17 || !body.selection.every(v => typeof v === 'string') || !['PRINT', 'REPORT_XLSX'].includes(String(body.format))) return bad(400, '출력 대상과 계산 실행을 확인하세요.');
      const run = (await store.all<{ id: string; inputJson: string; resultJson: string; revision: number }>('SELECT r.id,r.resultJson,v.inputJson,v.revision FROM es_runs r JOIN es_revisions v ON v.id = r.revisionId AND v.documentId = r.documentId WHERE r.id = ? AND r.documentId = ?', [body.runId, existing.id]))[0];
      if (!run) return bad(404, '계산 실행을 찾을 수 없습니다.');
      if ((await store.all<{ id: string }>("SELECT id FROM es_audit_events WHERE documentId = ? AND action = 'DELETED' AND revision >= ? LIMIT 1", [existing.id, run.revision])).length) return bad(409, '복구한 산출서는 저장·계산 후 새 출력 요청을 만드세요.');
      let selection: string[], pageRange = '';
      try {
        selection = orderedEsSheets(body.selection as string[]).map(sheet => sheet[0]);
        buildEsSheets(JSON.parse(run.inputJson), JSON.parse(run.resultJson), selection);
        if (body.format === 'PRINT') {
          if (typeof body.pageRange !== 'string' || !Number.isSafeInteger(body.pageCount) || Number(body.pageCount) > 10000) return bad(400, '페이지 미리보기 정보를 확인하세요.');
          parseEsPages(body.pageRange, Number(body.pageCount)); pageRange = body.pageRange;
        }
      } catch (error) { return bad(400, error instanceof Error ? error.message : '출력 범위를 확인하세요.'); }
      const outputId = crypto.randomUUID(), now = new Date().toISOString();
      await store.batch([{ sql: `INSERT INTO es_outputs(id,runId,selectionJson,pageRange,format,status,actorId,createdAt) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM es_documents WHERE id = ? AND revision = ? AND ${activeSql})`, values: [outputId, run.id, JSON.stringify(selection), pageRange, String(body.format), 'REQUESTED', actor.id, now, existing.id, existing.revision] }]);
      if (!(await store.all<{ id: string }>('SELECT id FROM es_outputs WHERE id = ?', [outputId])).length) return bad(409, '산출서 상태가 변경되었습니다. 새 출력 요청을 만드세요.');
      return reply(201, { output: { id: outputId, runId: run.id, status: 'REQUESTED' } });
    }
    if (existing && segments[1] === 'outputs' && method === 'PATCH') {
      if (typeof body.outputId !== 'string' || !uuid.test(body.outputId) || !['RENDERED', 'FAILED', 'DIALOG_CLOSED'].includes(String(body.status))) return bad(400, '출력 상태를 확인하세요.');
      const ownedOutput = (await store.all<{ id: string; revision: number }>('SELECT o.id,v.revision FROM es_outputs o JOIN es_runs r ON r.id=o.runId JOIN es_revisions v ON v.id=r.revisionId WHERE o.id=? AND r.documentId=? AND o.actorId=?', [body.outputId, existing.id, actor.id]))[0];
      if (!ownedOutput) return bad(404, '출력 요청을 찾을 수 없습니다.');
      if ((await store.all<{ id: string }>("SELECT id FROM es_audit_events WHERE documentId = ? AND action = 'DELETED' AND revision >= ? LIMIT 1", [existing.id, ownedOutput.revision])).length) return bad(409, '복구한 산출서는 저장·계산 후 새 출력 요청을 만드세요.');
      await store.batch([{ sql: `UPDATE es_outputs SET status=? WHERE id=? AND status IN ('REQUESTED','RENDERED') AND EXISTS(SELECT 1 FROM es_documents WHERE id = ? AND revision = ? AND ${activeSql})`, values: [String(body.status), ownedOutput.id, existing.id, existing.revision] }]);
      const persisted = (await store.all<{ status: string }>(`SELECT status FROM es_outputs WHERE id=? AND EXISTS(SELECT 1 FROM es_documents WHERE id = ? AND revision = ? AND ${activeSql})`, [ownedOutput.id, existing.id, existing.revision]))[0];
      if (persisted?.status !== body.status) return bad(409, '이미 종료된 출력 요청입니다. 새 출력 요청을 만드세요.');
      return reply(200, { outputId: ownedOutput.id, reportedStatus: body.status, printerSuccessVerified: false });
    }
    return bad(405, '지원하지 않는 ES 요청입니다.');
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE constraint failed.*es_revisions/i.test(message)) return bad(409, '저장 충돌입니다. 최신본을 확인하세요.');
    if (/no such table|database|SQLITE|D1_ERROR/i.test(message)) return bad(503, 'ES 저장소가 준비되지 않았습니다. 관리자에게 문의하세요.');
    return bad(503, 'ES 저장 요청을 완료하지 못했습니다. 입력을 유지하고 잠시 후 다시 확인하세요.');
  }
}
