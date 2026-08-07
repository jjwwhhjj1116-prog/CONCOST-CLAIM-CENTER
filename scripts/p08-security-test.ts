import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import initSqlJs from 'sql.js';
import {
  createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase, type PrismaClient
} from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';

interface Session { cookie: string; csrf: string }
interface Result { status: number; body: Record<string, any>; headers: http.IncomingHttpHeaders }

const root = path.resolve(__dirname, '..');
const databasePath = path.join(root, 'packages/database/.data', `p08-security-${process.pid}.db`);
const databaseUrl = databaseUrlFor(databasePath);
const allowedOrigin = 'http://localhost:3000';

function request(origin: string, pathname: string, method = 'GET', body?: unknown, session?: Session): Promise<Result> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request(`${origin}${pathname}`, {
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
        ...(session ? { Cookie: session.cookie, Origin: allowedOrigin, 'X-CSRF-Token': session.csrf } : { Origin: allowedOrigin })
      }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        resolve({
          status: res.statusCode ?? 500,
          body: raw.length && String(res.headers['content-type']).includes('application/json') ? JSON.parse(raw.toString('utf8')) : {},
          headers: res.headers
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(origin: string, email: string): Promise<Session> {
  const response = await request(origin, '/auth/login', 'POST', { email, password: 'Password123!' });
  assert.strictEqual(response.status, 200);
  return {
    cookie: (response.headers['set-cookie'] ?? []).map((value) => value.split(';')[0]).join('; '),
    csrf: response.body.csrfToken
  };
}

function draftPayload(code: string, referenceFileIds: string[] = []) {
  return {
    code,
    name: `${code} synthetic template`,
    description: 'No customer data',
    companyForm: `${code} company form`,
    primaryType: 'TYPE-01',
    secondaryTypes: ['TYPE-02'],
    tocStructure: ['검토 개요', '결론'],
    requiredSections: ['검토 개요'],
    requiredEvidenceRules: ['계약서 사본 확인'],
    blockSchemas: {
      '검토 개요': { blockCode: 'executive-summary', config: {} },
      '결론': { blockCode: 'conclusion', config: {} }
    },
    referenceFileIds
  };
}

async function installAuditFailure(db: PrismaClient, action: string): Promise<void> {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "P08_test_force_audit_failure"');
  await db.$executeRawUnsafe(`CREATE TRIGGER "P08_test_force_audit_failure" BEFORE INSERT ON "AuditLog"
    FOR EACH ROW WHEN NEW."action" = '${action}' BEGIN SELECT RAISE(ABORT, 'P08_FORCED_AUDIT_FAILURE'); END`);
}

async function removeAuditFailure(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "P08_test_force_audit_failure"');
}

async function assertSqliteTrigger(sql: string, expected: RegExp): Promise<void> {
  const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
  const sqlite = new SQL.Database(fs.readFileSync(databasePath));
  let message = '';
  try {
    sqlite.run('PRAGMA foreign_keys = ON');
    sqlite.run(sql);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  } finally {
    sqlite.close();
  }
  assert.match(message, expected, `Expected trigger rejection for SQL: ${sql}`);
}

test('P08 security rejects role, tenant, provenance, lifecycle, and rollback attacks', async (t) => {
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db: PrismaClient = createPrismaClient(databaseUrl);
  const server: ManagedApiServer = createApiServer({ databaseUrl, allowedOrigins: [allowedOrigin], secureCookies: false });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const admin = await login(origin, 'admin@example.invalid');
  const director = await login(origin, 'director@example.invalid');
  const pm = await login(origin, 'pm@example.invalid');
  const staff = await login(origin, 'staff@example.invalid');
  const reviewer = await login(origin, 'reviewer@example.invalid');
  const orgB = await login(origin, 'pm_b@example.invalid');

  let templateId = '';
  let versionId = '';
  let instanceId = '';

  try {
    await t.test('only Admin creates drafts and forbidden raw-file/secret fields are rejected without orphans', async () => {
      for (const session of [director, pm, staff, reviewer]) {
        assert.strictEqual((await request(origin, '/api/report-templates', 'POST', draftPayload(`P08-RBAC-${Math.random()}`), session)).status, 403);
      }
      const before = await db.reportTemplate.count();
      for (const field of ['sourcePath', 'filename', 'contentBase64', 'apiKey', 'accessToken']) {
        const attacked = { ...draftPayload(`P08-FORBIDDEN-${field.toUpperCase()}`), [field]: 'must-not-enter-the-system' };
        assert.strictEqual((await request(origin, '/api/report-templates', 'POST', attacked, admin)).status, 400, field);
      }
      assert.strictEqual(await db.reportTemplate.count(), before);
      assert.strictEqual((await request(origin, '/api/report-templates', 'POST', { ...draftPayload('P08-TYPE05'), primaryType: 'TYPE-05' }, admin)).status, 400);
    });

    await t.test('UNSCANNED references cannot be approved; scanned approval is optimistic and auditable', async () => {
      const hwpBlocked = await request(origin, '/api/reference-inventories/TPL-REF-001/review', 'POST', {
        decision: 'HUMAN_APPROVE', expectedVersion: 1
      }, director);
      assert.strictEqual(hwpBlocked.status, 409);
      const approved = await request(origin, '/api/reference-inventories/TPL-REF-002/review', 'POST', {
        decision: 'HUMAN_APPROVE', expectedVersion: 1
      }, director);
      assert.strictEqual(approved.status, 200);
      assert.strictEqual(approved.body.reference.approvalStatus, 'HUMAN_APPROVED');
      assert.strictEqual(approved.body.reference.version, 2);
      assert.strictEqual((await request(origin, '/api/reference-inventories/TPL-REF-002/review', 'POST', {
        decision: 'HUMAN_APPROVE', expectedVersion: 1
      }, director)).status, 409);
      await assertSqliteTrigger(
        `UPDATE "ReferenceInventory" SET "sha256" = '${'0'.repeat(64)}' WHERE "fileId" = 'TPL-REF-002'`,
        /P08_REFERENCE_IDENTITY_IMMUTABLE/
      );
      await assertSqliteTrigger(
        'UPDATE "ReferenceInventory" SET "approvalStatus" = \'REVIEW_REQUIRED\', "version" = 3 WHERE "fileId" = \'TPL-REF-002\'',
        /P08_REFERENCE_APPROVAL_TRANSITION_INVALID/
      );
    });

    await t.test('template creation is atomic when audit insertion fails', async () => {
      await installAuditFailure(db, 'REPORT_TEMPLATE_DRAFT_CREATED');
      const before = {
        templates: await db.reportTemplate.count(),
        versions: await db.reportTemplateVersion.count(),
        mappings: await db.templateTypeMapping.count(),
        sections: await db.templateSection.count()
      };
      const response = await request(origin, '/api/report-templates', 'POST', draftPayload('P08-AUDIT-ROLLBACK'), admin);
      assert.strictEqual(response.status, 500);
      assert.deepStrictEqual({
        templates: await db.reportTemplate.count(),
        versions: await db.reportTemplateVersion.count(),
        mappings: await db.templateTypeMapping.count(),
        sections: await db.templateSection.count()
      }, before);
      await removeAuditFailure(db);
    });

    await t.test('DB rejects TYPE-05, duplicate PRIMARY, creator self-approval, and all draft child tampering', async () => {
      const created = await request(origin, '/api/report-templates', 'POST', draftPayload('P08-SECURE-BASE', ['TPL-REF-002']), admin);
      assert.strictEqual(created.status, 201);
      templateId = created.body.template.id;
      versionId = created.body.version.id;
      const primary = await db.templateTypeMapping.findFirstOrThrow({ where: { templateVersionId: versionId, kind: 'PRIMARY' } });
      const section = await db.templateSection.findFirstOrThrow({ where: { templateVersionId: versionId } });
      const sectionBlock = await db.templateSectionBlock.findFirstOrThrow({ where: { templateSectionId: section.id } });
      const reference = await db.templateReference.findFirstOrThrow({ where: { templateVersionId: versionId } });

      await assertSqliteTrigger(
        `INSERT INTO "TemplateTypeMapping" ("id","templateVersionId","typeId","kind","createdAt") VALUES ('P08-ATTACK-TYPE05','${versionId}','TYPE-05','SECONDARY',CURRENT_TIMESTAMP)`,
        /P08_TYPE05_TEMPLATE_MAPPING_FORBIDDEN/
      );
      await assertSqliteTrigger(
        `INSERT INTO "TemplateTypeMapping" ("id","templateVersionId","typeId","kind","createdAt") VALUES ('P08-ATTACK-PRIMARY2','${versionId}','TYPE-03','PRIMARY',CURRENT_TIMESTAMP)`,
        /UNIQUE constraint failed/
      );
      await assertSqliteTrigger(
        `UPDATE "ReportTemplateVersion" SET "status"='HUMAN_APPROVED',"approvedById"='USR-ADMIN',"approvedAt"=CURRENT_TIMESTAMP,"rowVersion"=2 WHERE "id"='${versionId}'`,
        /P08_CREATOR_SELF_APPROVAL_FORBIDDEN/
      );
      await assertSqliteTrigger(
        `UPDATE "ReportTemplateVersion" SET "companyForm"='tampered' WHERE "id"='${versionId}'`,
        /P08_TEMPLATE_VERSION_CONTENT_IMMUTABLE/
      );
      await assertSqliteTrigger(
        `DELETE FROM "ReportTemplateVersion" WHERE "id"='${versionId}'`,
        /P08_TEMPLATE_VERSION_DELETE_FORBIDDEN/
      );
      await assertSqliteTrigger(
        `UPDATE "TemplateTypeMapping" SET "typeId"='TYPE-04' WHERE "id"='${primary.id}'`,
        /P08_MAPPING_IMMUTABLE/
      );
      await assertSqliteTrigger(
        `DELETE FROM "TemplateTypeMapping" WHERE "id"='${primary.id}'`,
        /P08_MAPPING_DELETE_FORBIDDEN/
      );
      await assertSqliteTrigger(
        `UPDATE "TemplateSection" SET "title"='tampered' WHERE "id"='${section.id}'`,
        /P08_TEMPLATE_SECTION_IMMUTABLE/
      );
      await assertSqliteTrigger(
        `DELETE FROM "TemplateSection" WHERE "id"='${section.id}'`,
        /P08_TEMPLATE_SECTION_DELETE_FORBIDDEN/
      );
      await assertSqliteTrigger(
        `UPDATE "TemplateSectionBlock" SET "position"=2 WHERE "id"='${sectionBlock.id}'`,
        /P08_BLOCK_MAPPING_IMMUTABLE/
      );
      await assertSqliteTrigger(
        `DELETE FROM "TemplateSectionBlock" WHERE "id"='${sectionBlock.id}'`,
        /P08_BLOCK_MAPPING_DELETE_FORBIDDEN/
      );
      await assertSqliteTrigger(
        `UPDATE "TemplateReference" SET "fileSizeSnapshot"=${reference.fileSizeSnapshot + 1} WHERE "id"='${reference.id}'`,
        /P08_REFERENCE_MAPPING_IMMUTABLE/
      );
      await assertSqliteTrigger(
        `DELETE FROM "TemplateReference" WHERE "id"='${reference.id}'`,
        /P08_REFERENCE_MAPPING_DELETE_FORBIDDEN/
      );
      await assertSqliteTrigger(
        `UPDATE "BlockDefinition" SET "schemaJson"='{}' WHERE "id"='${sectionBlock.blockDefinitionId}'`,
        /P08_BLOCK_DEFINITION_IMMUTABLE/
      );
    });

    await t.test('approval audit failure rolls back lifecycle state, then independent Director approval and activation succeed', async () => {
      await installAuditFailure(db, 'REPORT_TEMPLATE_VERSION_APPROVED');
      assert.strictEqual((await request(origin, `/api/report-templates/${templateId}/versions/${versionId}/approve`, 'POST', {
        expectedRowVersion: 1
      }, director)).status, 500);
      const rolledBack = await db.reportTemplateVersion.findUniqueOrThrow({ where: { id: versionId } });
      assert.strictEqual(rolledBack.status, 'DRAFT');
      assert.strictEqual(rolledBack.rowVersion, 1);
      assert.strictEqual(rolledBack.approvedById, null);
      await removeAuditFailure(db);

      assert.strictEqual((await request(origin, `/api/report-templates/${templateId}/versions/${versionId}/approve`, 'POST', {
        expectedRowVersion: 1
      }, director)).status, 200);
      assert.strictEqual((await request(origin, `/api/report-templates/${templateId}/versions/${versionId}/activate`, 'POST', {
        expectedRowVersion: 2
      }, director)).status, 200);
      await assertSqliteTrigger(
        `UPDATE "ReportTemplateVersion" SET "status"='DRAFT' WHERE "id"='${versionId}'`,
        /P08_TEMPLATE_VERSION_TRANSITION_INVALID/
      );
    });

    await t.test('tenant and claim-type boundaries hide templates and block direct malicious instances', async () => {
      const orgBList = await request(origin, '/api/report-templates', 'GET', undefined, orgB);
      assert.strictEqual(orgBList.status, 200);
      assert.strictEqual(orgBList.body.templates.length, 0);
      assert.strictEqual((await request(origin, `/api/report-templates/${templateId}`, 'GET', undefined, orgB)).status, 404);
      assert.strictEqual((await request(origin, '/api/cases/CASE-SYN-001/report-instances', 'POST', {
        templateVersionId: versionId, expectedCaseVersion: 1
      }, orgB)).status, 403);

      await assertSqliteTrigger(
        `INSERT INTO "ReportInstance" (
          "id","organizationId","caseId","templateVersionId","createdById","version",
          "templateCodeSnapshot","templateNameSnapshot","templateVersionNumberSnapshot","companyFormSnapshot",
          "tocStructureSnapshotJson","requiredSectionsSnapshotJson","requiredEvidenceRulesSnapshotJson",
          "blockSchemasSnapshotJson","referenceProvenanceSnapshotJson","snapshotSha256","createdAt","updatedAt"
        ) VALUES (
          'P08-ATTACK-WRONG-TYPE','ORG-SYN-A','CASE-SYN-004','${versionId}','USR-PM',1,
          'attack','attack',1,'attack','[]','[]','[]','{}','[]','${'a'.repeat(64)}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
        )`,
        /P08_REPORT_INSTANCE_SCOPE_OR_TYPE_INVALID/
      );
    });

    await t.test('report instance audit failure rolls back instance, report, sections, and case version', async () => {
      const before = {
        instances: await db.reportInstance.count(),
        reports: await db.report.count(),
        sections: await db.reportSection.count(),
        caseVersion: (await db.caseItem.findUniqueOrThrow({ where: { id: 'CASE-SYN-001' } })).version
      };
      await installAuditFailure(db, 'REPORT_INSTANCE_CREATED');
      const response = await request(origin, '/api/cases/CASE-SYN-001/report-instances', 'POST', {
        templateVersionId: versionId,
        expectedCaseVersion: before.caseVersion
      }, pm);
      assert.strictEqual(response.status, 500);
      assert.deepStrictEqual({
        instances: await db.reportInstance.count(),
        reports: await db.report.count(),
        sections: await db.reportSection.count(),
        caseVersion: (await db.caseItem.findUniqueOrThrow({ where: { id: 'CASE-SYN-001' } })).version
      }, before);
      await removeAuditFailure(db);
    });

    await t.test('created report snapshots and structural sections reject update/delete attacks', async () => {
      const caseVersion = (await db.caseItem.findUniqueOrThrow({ where: { id: 'CASE-SYN-001' } })).version;
      assert.strictEqual((await request(origin, '/api/cases/CASE-SYN-001/report-instances', 'POST', {
        templateVersionId: versionId,
        expectedCaseVersion: caseVersion,
        sourcePath: 'forbidden'
      }, pm)).status, 400);
      const created = await request(origin, '/api/cases/CASE-SYN-001/report-instances', 'POST', {
        templateVersionId: versionId,
        expectedCaseVersion: caseVersion
      }, pm);
      assert.strictEqual(created.status, 201);
      instanceId = created.body.instance.id;
      const sectionId = created.body.sections[0].id;
      await assertSqliteTrigger(
        `UPDATE "ReportInstance" SET "companyFormSnapshot"='tampered' WHERE "id"='${instanceId}'`,
        /P08_REPORT_INSTANCE_SNAPSHOT_IMMUTABLE/
      );
      await assertSqliteTrigger(
        `DELETE FROM "ReportInstance" WHERE "id"='${instanceId}'`,
        /P08_REPORT_INSTANCE_DELETE_FORBIDDEN/
      );
      await assertSqliteTrigger(
        `UPDATE "ReportSection" SET "title"='tampered' WHERE "id"='${sectionId}'`,
        /P08_REPORT_SECTION_SNAPSHOT_IMMUTABLE/
      );
      await assertSqliteTrigger(
        `DELETE FROM "ReportSection" WHERE "id"='${sectionId}'`,
        /P08_REPORT_SECTION_DELETE_FORBIDDEN/
      );
      const detail = await request(origin, `/api/report-instances/${instanceId}`, 'GET', undefined, orgB);
      assert.strictEqual(detail.status, 404);
    });
  } finally {
    await removeAuditFailure(db).catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.waitForDatabaseClose();
    await db.$disconnect();
    for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});
