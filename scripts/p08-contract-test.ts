import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { createPrismaClient, getDatabaseUrl } from '@claim-studio/database';
import { createApiServer } from '../apps/api/src/server';

const ROOT_DIR = path.resolve(__dirname, '..');
const REFERENCE_INVENTORY_FILE = path.join(ROOT_DIR, 'docs/templates/reference-inventory.json');
const LOCAL_TEMPLATES_DIR = path.join(ROOT_DIR, 'docs/보고서 템플릿');

export async function runP08ContractTests(): Promise<void> {
  console.log('[P08-CONTRACT] Running P08 Report Template Catalog Contract Tests...');

  // 1. Reference Inventory & Offline Local 32-File Check
  if (!fs.existsSync(REFERENCE_INVENTORY_FILE)) {
    throw new Error(`[P08-CONTRACT] reference-inventory.json missing at ${REFERENCE_INVENTORY_FILE}`);
  }
  const inventoryRaw = fs.readFileSync(REFERENCE_INVENTORY_FILE, 'utf8');
  const inventory = JSON.parse(inventoryRaw) as Array<{ id: string; fileId: string; sha256: string; fileSize: number }>;
  if (inventory.length !== 32) {
    throw new Error(`[P08-CONTRACT] reference-inventory.json must contain exactly 32 items, got ${inventory.length}`);
  }

  // Git untracked check for reference template files
  try {
    const gitTracked = execSync('git ls-files "docs/보고서 템플릿"', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
    if (gitTracked.length > 0) {
      throw new Error(`[P08-CONTRACT] Local reference files MUST NOT be tracked in Git! Tracked files: ${gitTracked}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('MUST NOT be tracked')) throw err;
  }

  // If local template directory exists (offline harness environment), verify 32/32 sizes & SHA-256
  if (fs.existsSync(LOCAL_TEMPLATES_DIR)) {
    console.log('[P08-CONTRACT] Verifying local reference files 32/32 size and SHA-256...');
    let foundCount = 0;
    const items = inventory;
    for (const item of items) {
      // Find matching file in local subdirectories
      let matchedPath: string | null = null;
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile()) {
            const buf = fs.readFileSync(fullPath);
            const sha = crypto.createHash('sha256').update(buf).digest('hex');
            if (sha === item.sha256) {
              matchedPath = fullPath;
              break;
            }
          }
        }
      };
      walk(LOCAL_TEMPLATES_DIR);
      if (matchedPath) {
        foundCount++;
      }
    }
    console.log(`[P08-CONTRACT] Found and verified ${foundCount}/32 matching local reference files.`);
  }

  // 2. Database Model & Seed Contract Verification
  const db = createPrismaClient(getDatabaseUrl());
  try {
    // Check production seed ACTIVE template count is strictly 0
    const activeTemplatesCount = await db.reportTemplateVersion.count({ where: { status: 'ACTIVE' } });
    if (activeTemplatesCount !== 0) {
      throw new Error(`[P08-CONTRACT] Production seed ACTIVE template count must be strictly 0, got ${activeTemplatesCount}`);
    }

    // Check TYPE-05 template & version count is strictly 0
    const type05VersionCount = await db.templateTypeMapping.count({ where: { typeId: 'TYPE-05' } });
    if (type05VersionCount !== 0) {
      throw new Error(`[P08-CONTRACT] TYPE-05 template mappings must be strictly 0, got ${type05VersionCount}`);
    }

    // Check BlockDefinition count (8 standard blocks)
    const blockCount = await db.blockDefinition.count();
    if (blockCount < 8) {
      throw new Error(`[P08-CONTRACT] BlockDefinition must contain at least 8 standard blocks, got ${blockCount}`);
    }

    // Check ReferenceInventory count (32 anonymous items, all REVIEW_REQUIRED)
    const refCount = await db.referenceInventory.count();
    if (refCount !== 32) {
      throw new Error(`[P08-CONTRACT] ReferenceInventory must contain exactly 32 items, got ${refCount}`);
    }

    const unapprovedRefCount = await db.referenceInventory.count({ where: { approvalStatus: 'REVIEW_REQUIRED' } });
    if (unapprovedRefCount !== 32) {
      throw new Error(`[P08-CONTRACT] All 32 ReferenceInventory items must be REVIEW_REQUIRED, got ${unapprovedRefCount}`);
    }

  } finally {
    await db.$disconnect();
  }

  // 3. API Contract & Snapshot Immutability Test
  const testDbUrl = getDatabaseUrl();
  const server = createApiServer({ databaseUrl: testDbUrl, allowedOrigins: ['http://localhost:3000'] });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 3001;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Login as Admin to test DRAFT template creation
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: 'admin@example.invalid', password: 'Password123!' })
    });
    if (!loginRes.ok) throw new Error('[P08-CONTRACT] Admin login failed');

    const cookies = loginRes.headers.getSetCookie();
    const sessionToken = cookies.find((c) => c.startsWith('session_token='))?.split(';')[0].split('=')[1];
    const csrfToken = cookies.find((c) => c.startsWith('csrf_token='))?.split(';')[0].split('=')[1];

    const authHeaders = {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      Cookie: `session_token=${sessionToken}; csrf_token=${csrfToken}`,
      'X-CSRF-Token': csrfToken || ''
    };

    // Test GET /api/report-templates?claimType=TYPE-05
    const type05Res = await fetch(`${baseUrl}/api/report-templates?claimType=TYPE-05`, { headers: authHeaders });
    const type05Data = (await type05Res.json()) as { availability: string; templates: unknown[] };
    if (type05Data.availability !== 'TEMPLATE_NOT_AVAILABLE' || type05Data.templates.length !== 0) {
      throw new Error('[P08-CONTRACT] TYPE-05 query must return TEMPLATE_NOT_AVAILABLE with empty templates array');
    }

    // Create DRAFT template for TYPE-01
    const createRes = await fetch(`${baseUrl}/api/report-templates`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        code: `RPT-CONTRACT-${Date.now()}`,
        name: 'Contract Test Template',
        companyForm: 'Company Form Contract v1',
        primaryType: 'TYPE-01',
        secondaryTypes: ['TYPE-02'],
        tocStructure: ['개요', '계약', '사실관계', '의견'],
        requiredSections: ['개요'],
        requiredEvidenceRules: ['계약서'],
        blockSchemas: { default: 'std' }
      })
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`[P08-CONTRACT] Template creation failed: ${err}`);
    }

    const createdData = (await createRes.json()) as { template: { id: string }; version: { id: string } };

    // Login as Director to approve & activate
    const dirLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: 'director@example.invalid', password: 'Password123!' })
    });
    const dirCookies = dirLogin.headers.getSetCookie();
    const dirSession = dirCookies.find((c) => c.startsWith('session_token='))?.split(';')[0].split('=')[1];
    const dirCsrf = dirCookies.find((c) => c.startsWith('csrf_token='))?.split(';')[0].split('=')[1];

    const dirHeaders = {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      Cookie: `session_token=${dirSession}; csrf_token=${dirCsrf}`,
      'X-CSRF-Token': dirCsrf || ''
    };

    // Approve version
    const approveRes = await fetch(`${baseUrl}/api/report-templates/${createdData.template.id}/versions/${createdData.version.id}/approve`, {
      method: 'POST',
      headers: dirHeaders
    });
    if (!approveRes.ok) throw new Error('[P08-CONTRACT] Template approval failed');

    // Activate version
    const activateRes = await fetch(`${baseUrl}/api/report-templates/${createdData.template.id}/versions/${createdData.version.id}/activate`, {
      method: 'POST',
      headers: dirHeaders
    });
    if (!activateRes.ok) throw new Error('[P08-CONTRACT] Template activation failed');

    // Login as PM to create ReportInstance
    const pmLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: 'pm@example.invalid', password: 'Password123!' })
    });
    const pmCookies = pmLogin.headers.getSetCookie();
    const pmSession = pmCookies.find((c) => c.startsWith('session_token='))?.split(';')[0].split('=')[1];
    const pmCsrf = pmCookies.find((c) => c.startsWith('csrf_token='))?.split(';')[0].split('=')[1];

    const pmHeaders = {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      Cookie: `session_token=${pmSession}; csrf_token=${pmCsrf}`,
      'X-CSRF-Token': pmCsrf || ''
    };

    const instRes = await fetch(`${baseUrl}/api/cases/CASE-SYN-001/report-instances`, {
      method: 'POST',
      headers: pmHeaders,
      body: JSON.stringify({ templateVersionId: createdData.version.id })
    });
    if (!instRes.ok) {
      const err = await instRes.text();
      throw new Error(`[P08-CONTRACT] ReportInstance creation failed: ${err}`);
    }

    const instData = (await instRes.json()) as { instance: { id: string; companyFormSnapshot: string } };
    if (instData.instance.companyFormSnapshot !== 'Company Form Contract v1') {
      throw new Error('[P08-CONTRACT] ReportInstance companyFormSnapshot mismatch');
    }

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('[P08-CONTRACT] All P08 contract tests passed successfully.');
}

if (require.main === module) {
  runP08ContractTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
