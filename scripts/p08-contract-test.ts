import test from 'node:test';
import assert from 'node:assert';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
import {
  createPrismaClient, databaseUrlFor, resetDatabase, seedDatabase, type PrismaClient
} from '@claim-studio/database';
import { createApiServer, type ManagedApiServer } from '../apps/api/src/server';

interface InventoryFile {
  fileId: string;
  relativePath: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: string;
}
interface InventoryDocument { totalFiles: number; files: InventoryFile[] }
interface Session { cookie: string; csrf: string }
interface Result { status: number; body: Record<string, any>; headers: http.IncomingHttpHeaders }

const root = path.resolve(__dirname, '..');
const inventoryPath = path.join(root, 'docs/templates/reference-inventory.json');
const localReferenceRoot = path.join(root, 'docs/보고서 템플릿');
const migrationPath = path.join(root, 'packages/database/prisma/migrations/20260807100000_p08_report_template_catalog/migration.sql');
const schemaPath = path.join(root, 'packages/database/prisma/schema.prisma');
const databasePath = path.join(root, 'packages/database/.data', `p08-contract-${process.pid}.db`);
const databaseUrl = databaseUrlFor(databasePath);
const allowedOrigin = 'http://localhost:3000';

function readInventory(): InventoryDocument {
  const parsed = JSON.parse(fs.readFileSync(inventoryPath, 'utf8')) as InventoryDocument;
  assert.strictEqual(parsed.totalFiles, 32);
  assert.strictEqual(parsed.files.length, 32);
  assert.deepStrictEqual(parsed.files.map((item) => item.fileId), Array.from({ length: 32 }, (_, index) => `TPL-REF-${String(index + 1).padStart(3, '0')}`));
  assert.strictEqual(new Set(parsed.files.map((item) => item.sha256)).size, 32);
  for (const item of parsed.files) {
    assert.match(item.fileId, /^TPL-REF-\d{3}$/);
    assert.match(item.sha256, /^[0-9a-f]{64}$/);
    assert.ok(item.sizeBytes > 0);
    assert.strictEqual(item.filename.startsWith(`${item.fileId}_template_ref.`), true);
    assert.strictEqual(item.relativePath.includes(item.filename), true);
    assert.doesNotMatch(item.filename, /[가-힣]|CASE-|고객|사건/i);
  }
  return parsed;
}

function walkFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : entry.isFile() ? [fullPath] : [];
  });
}

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

function draftPayload(name: string, primaryType = 'TYPE-01') {
  return {
    code: `P08-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
    name,
    description: 'Synthetic P08 contract template',
    companyForm: `${name} company form`,
    primaryType,
    secondaryTypes: primaryType === 'TYPE-01' ? ['TYPE-02'] : [],
    tocStructure: ['검토 개요', '결론'],
    requiredSections: ['검토 개요', '결론'],
    requiredEvidenceRules: ['계약서 사본 확인'],
    blockSchemas: {
      '검토 개요': { blockCode: 'executive-summary', config: { compact: false } },
      '결론': { blockCode: 'conclusion', config: { signoff: true } }
    },
    referenceFileIds: []
  };
}

test('P08 sanitized reference inventory is exact, anonymous, and raw templates stay outside Git', () => {
  const inventory = readInventory();
  const tracked = execFileSync('git', ['ls-files', '--', 'docs/보고서 템플릿', 'docs/보고서 템플릿/**'], {
    cwd: root,
    encoding: 'utf8'
  }).trim();
  assert.strictEqual(tracked, '');

  if (!fs.existsSync(localReferenceRoot)) {
    console.log('[P08-CONTRACT] local source mode: INVENTORY_ONLY (raw reference folder absent in clean checkout)');
    return;
  }

  const localFiles = walkFiles(localReferenceRoot);
  assert.strictEqual(localFiles.length, 32, 'Local source mode requires exactly 32 raw reference files');
  const actual = new Map(localFiles.map((filePath) => {
    const bytes = fs.readFileSync(filePath);
    return [crypto.createHash('sha256').update(bytes).digest('hex'), bytes.length] as const;
  }));
  assert.strictEqual(actual.size, 32);
  for (const item of inventory.files) assert.strictEqual(actual.get(item.sha256), item.sizeBytes, `Local reference mismatch: ${item.fileId}`);
  console.log('[P08-CONTRACT] local source mode: 32/32 SHA-256 and byte sizes verified');
});

test('P08 migration is additive and DB-enforces lifecycle, provenance, tenant, and snapshot guards', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  for (const model of [
    'ReferenceInventory', 'ReportTemplate', 'ReportTemplateVersion', 'TemplateTypeMapping',
    'TemplateSection', 'TemplateSectionBlock', 'TemplateReference', 'BlockDefinition', 'ReportInstance'
  ]) assert.match(schema, new RegExp(`model ${model} \\\{`));
  for (const guard of [
    'P08_reference_identity_immutable', 'P08_template_version_content_immutable',
    'P08_template_version_lifecycle_guard', 'P08_template_version_approval_guard',
    'P08_template_version_activation_guard', 'P08_mapping_insert_guard',
    'P08_section_update_guard', 'P08_section_block_update_guard',
    'P08_reference_mapping_insert_guard', 'P08_report_instance_insert_guard',
    'P08_report_instance_snapshot_immutable', 'P08_report_section_snapshot_immutable'
  ]) assert.ok(migration.includes(guard), `Missing P08 DB guard: ${guard}`);
  assert.doesNotMatch(migration, /DROP\s+TABLE|ALTER\s+TABLE\s+[^;]+\s+RENAME/i);
  assert.match(migration, /TYPE-05'\s+THEN RAISE\(ABORT, 'P08_TYPE05_TEMPLATE_MAPPING_FORBIDDEN'/);
  assert.match(migration, /CREATE UNIQUE INDEX "TemplateTypeMapping_one_primary"/);
});

test('P08 seed preserves 32 exact references, eight instruction-defined standard blocks, and zero pre-approved templates', async () => {
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const inventory = readInventory();
  const db = createPrismaClient(databaseUrl);
  try {
    const references = await db.referenceInventory.findMany({ orderBy: { fileId: 'asc' } });
    assert.strictEqual(references.length, 32);
    assert.deepStrictEqual(references.map((row) => [row.fileId, row.sha256, row.fileSize]), inventory.files.map((item) => [item.fileId, item.sha256, item.sizeBytes]));
    assert.strictEqual(references.every((row) => row.approvalStatus === 'REVIEW_REQUIRED'), true);
    assert.strictEqual(await db.reportTemplate.count(), 0);
    assert.strictEqual(await db.reportTemplateVersion.count({ where: { status: 'ACTIVE' } }), 0);
    assert.strictEqual(await db.templateTypeMapping.count({ where: { typeId: 'TYPE-05' } }), 0);
    assert.deepStrictEqual((await db.blockDefinition.findMany({ orderBy: { code: 'asc' } })).map((row) => row.code), [
      'calculation-basis', 'conclusion', 'contract-status', 'executive-summary', 'fact-relation', 'legal-review', 'opinion', 'photo-analysis'
    ]);
  } finally {
    await db.$disconnect();
  }
});

test('P08 API creates approved templates and immutable case snapshots without changing v1 after v2 activation', async (t) => {
  await resetDatabase(databaseUrl);
  await seedDatabase(databaseUrl);
  const db: PrismaClient = createPrismaClient(databaseUrl);
  const server: ManagedApiServer = createApiServer({ databaseUrl, allowedOrigins: [allowedOrigin], secureCookies: false });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const admin = await login(origin, 'admin@example.invalid');
  const director = await login(origin, 'director@example.invalid');
  const pm = await login(origin, 'pm@example.invalid');
  let templateId = '';
  let v1Id = '';
  let instanceId = '';
  let caseVersion = (await db.caseItem.findUniqueOrThrow({ where: { id: 'CASE-SYN-001' } })).version;

  try {
    await t.test('TYPE-05 remains an explicit empty state', async () => {
      const response = await request(origin, '/api/report-templates?claimType=TYPE-05', 'GET', undefined, pm);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.availability, 'TEMPLATE_NOT_FOUND');
      assert.deepStrictEqual(response.body.templates, []);
    });

    await t.test('Admin draft, independent Director approval, and activation use optimistic versions', async () => {
      const created = await request(origin, '/api/report-templates', 'POST', draftPayload('P08 v1'), admin);
      assert.strictEqual(created.status, 201);
      templateId = created.body.template.id;
      v1Id = created.body.version.id;
      assert.strictEqual(created.body.version.status, 'DRAFT');
      assert.match(created.body.version.contentSha256, /^[0-9a-f]{64}$/);

      const staleApproval = await request(origin, `/api/report-templates/${templateId}/versions/${v1Id}/approve`, 'POST', { expectedRowVersion: 2 }, director);
      assert.strictEqual(staleApproval.status, 409);
      const approved = await request(origin, `/api/report-templates/${templateId}/versions/${v1Id}/approve`, 'POST', { expectedRowVersion: 1 }, director);
      assert.strictEqual(approved.status, 200);
      assert.strictEqual(approved.body.version.status, 'HUMAN_APPROVED');
      assert.strictEqual(approved.body.version.rowVersion, 2);
      const activated = await request(origin, `/api/report-templates/${templateId}/versions/${v1Id}/activate`, 'POST', { expectedRowVersion: 2 }, director);
      assert.strictEqual(activated.status, 200);
      assert.strictEqual(activated.body.version.status, 'ACTIVE');
      assert.strictEqual(activated.body.version.rowVersion, 3);
    });

    let v1Snapshot = '';
    let v1Sections = '';
    await t.test('ACTIVE version creates a same-tenant, same-type immutable report snapshot', async () => {
      const created = await request(origin, '/api/cases/CASE-SYN-001/report-instances', 'POST', {
        templateVersionId: v1Id,
        expectedCaseVersion: caseVersion
      }, pm);
      assert.strictEqual(created.status, 201);
      instanceId = created.body.instance.id;
      caseVersion = created.body.caseVersion;
      assert.strictEqual(created.body.sections.length, 2);
      assert.strictEqual(created.body.sections.every((section: any) => section.isRequired), true);
      const instance = await db.reportInstance.findUniqueOrThrow({ where: { id: instanceId } });
      v1Snapshot = JSON.stringify(instance);
      v1Sections = JSON.stringify(await db.reportSection.findMany({ where: { report: { reportInstanceId: instanceId } }, orderBy: { sectionNumber: 'asc' } }));

      const stale = await request(origin, '/api/cases/CASE-SYN-001/report-instances', 'POST', {
        templateVersionId: v1Id,
        expectedCaseVersion: caseVersion - 1
      }, pm);
      assert.strictEqual(stale.status, 409);
    });

    await t.test('new v2 is a new immutable snapshot and activating it archives v1 only', async () => {
      const v2Payload = { ...draftPayload('P08 v2'), expectedTemplateVersion: 1 };
      v2Payload.companyForm = 'P08 v2 changed company form';
      const v2 = await request(origin, `/api/report-templates/${templateId}/versions`, 'POST', v2Payload, admin);
      assert.strictEqual(v2.status, 201);
      assert.strictEqual(v2.body.version.versionNumber, 2);
      const v2Id = v2.body.version.id;
      assert.notStrictEqual(v2.body.version.contentSha256, (await db.reportTemplateVersion.findUniqueOrThrow({ where: { id: v1Id } })).contentSha256);
      assert.strictEqual((await request(origin, `/api/report-templates/${templateId}/versions/${v2Id}/approve`, 'POST', { expectedRowVersion: 1 }, director)).status, 200);
      assert.strictEqual((await request(origin, `/api/report-templates/${templateId}/versions/${v2Id}/activate`, 'POST', { expectedRowVersion: 2 }, director)).status, 200);
      assert.strictEqual((await db.reportTemplateVersion.findUniqueOrThrow({ where: { id: v1Id } })).status, 'ARCHIVED');
      assert.strictEqual((await db.reportTemplateVersion.findUniqueOrThrow({ where: { id: v2Id } })).status, 'ACTIVE');
      assert.strictEqual(JSON.stringify(await db.reportInstance.findUniqueOrThrow({ where: { id: instanceId } })), v1Snapshot);
      assert.strictEqual(JSON.stringify(await db.reportSection.findMany({ where: { report: { reportInstanceId: instanceId } }, orderBy: { sectionNumber: 'asc' } })), v1Sections);
    });

    await t.test('a template for another claim type cannot instantiate a TYPE-01 case', async () => {
      const created = await request(origin, '/api/report-templates', 'POST', draftPayload('P08 type2', 'TYPE-02'), admin);
      assert.strictEqual(created.status, 201);
      assert.strictEqual((await request(origin, `/api/report-templates/${created.body.template.id}/versions/${created.body.version.id}/approve`, 'POST', { expectedRowVersion: 1 }, director)).status, 200);
      assert.strictEqual((await request(origin, `/api/report-templates/${created.body.template.id}/versions/${created.body.version.id}/activate`, 'POST', { expectedRowVersion: 2 }, director)).status, 200);
      const mismatch = await request(origin, '/api/cases/CASE-SYN-001/report-instances', 'POST', {
        templateVersionId: created.body.version.id,
        expectedCaseVersion: caseVersion
      }, pm);
      assert.strictEqual(mismatch.status, 409);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.waitForDatabaseClose();
    await db.$disconnect();
    for (const suffix of ['', '-journal', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});
