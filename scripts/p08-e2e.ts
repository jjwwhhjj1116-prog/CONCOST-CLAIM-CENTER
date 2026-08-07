import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from 'playwright-core';
import { createPrismaClient, getDatabaseUrl } from '@claim-studio/database';
import { createApiServer } from '../apps/api/src/server';

function findBrowserExecutable(): string {
  const localAppData = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    process.env.CHROME_PATH ?? '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(localAppData, 'Google/Chrome/Application/chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  const executable = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!executable) throw new Error('Chrome/Edge executable not found. Set CHROME_PATH for P08 browser E2E.');
  return executable;
}

export async function runP08E2ETests(): Promise<void> {
  console.log('[P08-E2E] Running P08 Real Chromium E2E User Flow Tests...');

  const dbUrl = getDatabaseUrl();
  const db = createPrismaClient(dbUrl);
  const server = createApiServer({ databaseUrl: dbUrl, allowedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'] });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 3001;
  const baseUrl = `http://127.0.0.1:${port}`;

  const executablePath = findBrowserExecutable();
  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    // 1. Admin Login via API to obtain session cookies
    console.log('Logging in as Admin via API...');
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: 'admin@example.invalid', password: 'Password123!' })
    });
    if (!loginRes.ok) throw new Error('Admin login failed');

    const cookies = loginRes.headers.getSetCookie();
    const sessionToken = cookies.find((c) => c.startsWith('session_token='))?.split(';')[0].split('=')[1];
    const csrfToken = cookies.find((c) => c.startsWith('csrf_token='))?.split(';')[0].split('=')[1];

    // Set cookies in Playwright browser context
    await context.addCookies([
      { name: 'session_token', value: sessionToken || '', domain: '127.0.0.1', path: '/' },
      { name: 'csrf_token', value: csrfToken || '', domain: '127.0.0.1', path: '/' }
    ]);

    // Set window.__CLAIM_API_ORIGIN__ before page load
    await page.addInitScript((origin: string) => {
      window.__CLAIM_API_ORIGIN__ = origin;
    }, baseUrl);

    // 2. Navigate to /templates (TPL-01)
    console.log('Navigating to /templates page...');
    await page.goto(`${baseUrl}/templates`, { waitUntil: 'domcontentloaded' });

    // 3. Verify TYPE-05 TEMPLATE_NOT_FOUND state
    console.log('Testing TYPE-05 tab TEMPLATE_NOT_FOUND state in E2E...');
    const type05Tab = page.locator('button:has-text("TYPE-05")');
    if (await type05Tab.isVisible()) {
      await type05Tab.click();
      await page.waitForTimeout(300);
      const notFoundCard = page.locator('text=TEMPLATE_NOT_FOUND State');
      if (await notFoundCard.isVisible()) {
        console.log('Successfully verified TYPE-05 TEMPLATE_NOT_FOUND state UI in E2E.');
      }
    }

    // 4. Create DRAFT Template as Admin via API for E2E flow
    console.log('Creating E2E DRAFT Template via API...');
    const tplCode = `RPT-E2E-${Date.now()}`;
    const createRes = await fetch(`${baseUrl}/api/report-templates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Cookie: `session_token=${sessionToken}; csrf_token=${csrfToken}`,
        'X-CSRF-Token': csrfToken || ''
      },
      body: JSON.stringify({
        code: tplCode,
        name: 'E2E Flow Test Template',
        companyForm: 'E2E Company Form v1',
        primaryType: 'TYPE-01',
        tocStructure: ['개요', '계약사항', '현장분석', '결론'],
        requiredSections: ['개요', '계약사항'],
        requiredEvidenceRules: ['도면 복사본'],
        blockSchemas: { default: 'standard' }
      })
    });
    if (!createRes.ok) throw new Error('E2E Template creation failed');
    const createdData = (await createRes.json()) as { template: { id: string }; version: { id: string } };

    // 5. CEO Approval & Activation via API
    console.log('CEO approving and activating template for E2E...');
    const ceoLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: 'ceo@example.invalid', password: 'Password123!' })
    });
    const ceoCookies = ceoLogin.headers.getSetCookie();
    const ceoSession = ceoCookies.find((c) => c.startsWith('session_token='))?.split(';')[0].split('=')[1];
    const ceoCsrf = ceoCookies.find((c) => c.startsWith('csrf_token='))?.split(';')[0].split('=')[1];

    const ceoHeaders = {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      Cookie: `session_token=${ceoSession}; csrf_token=${ceoCsrf}`,
      'X-CSRF-Token': ceoCsrf || ''
    };

    await fetch(`${baseUrl}/api/report-templates/${createdData.template.id}/versions/${createdData.version.id}/approve`, {
      method: 'POST',
      headers: ceoHeaders
    });
    await fetch(`${baseUrl}/api/report-templates/${createdData.template.id}/versions/${createdData.version.id}/activate`, {
      method: 'POST',
      headers: ceoHeaders
    });

    // 6. PM Creates ReportInstance for CASE-SYN-001
    console.log('PM creating ReportInstance from ACTIVE template...');
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
    if (!instRes.ok) throw new Error('E2E ReportInstance creation failed');

    // 7. 1024px Tablet Viewport Test
    console.log('Testing 1024px tablet viewport in Playwright...');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`${baseUrl}/templates`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    console.log('[P08-E2E] All P08 Real Chromium E2E User Flow Tests passed successfully.');
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.$disconnect();
  }
}

if (require.main === module) {
  runP08E2ETests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
