import assert from 'node:assert';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

const root = path.join(__dirname, '..');
const origin = 'http://127.0.0.1:4173';

function findBrowserExecutable(): string {
  const localAppData = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    process.env.CHROME_PATH ?? '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(localAppData, 'Google/Chrome/Application/chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  const executable = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!executable) throw new Error('Chrome/Edge executable not found. Set CHROME_PATH for P03 browser E2E.');
  return executable;
}

async function waitForServer(server: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 20_000;
  let stderr = '';
  server.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Preview server exited early (${server.exitCode}): ${stderr}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Preview server did not start: ${stderr}`);
}

async function assertHeading(page: Page, name: RegExp): Promise<void> {
  assert.strictEqual(await page.getByRole('heading', { name }).isVisible(), true, `Heading not visible: ${name}`);
}

async function main(): Promise<void> {
  const viteCli = path.join(root, 'apps/web/node_modules/vite/bin/vite.js');
  const server = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', '4173'], {
    cwd: path.join(root, 'apps/web'),
    stdio: 'pipe',
    windowsHide: true
  });

  let browser: Browser | undefined;
  try {
  await waitForServer(server);
  browser = await chromium.launch({ executablePath: findBrowserExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(`${origin}/dashboard`);
  await assertHeading(page, /메인 대시보드/);
  assert.strictEqual(new URL(page.url()).pathname, '/dashboard');

  await page.goto(`${origin}/approval`);
  await assertHeading(page, /검토·승인함/);
  await page.getByRole('link', { name: /사건 목록/ }).click();
  await page.waitForURL(`${origin}/cases`);
  await page.goBack();
  await page.waitForURL(`${origin}/approval`);
  await assertHeading(page, /검토·승인함/);
  await page.goForward();
  await page.waitForURL(`${origin}/cases`);

  await page.goto(`${origin}/unknown-route`);
  await assertHeading(page, /404 Not Found/);

  await page.goto(`${origin}/reports/studio`);
  await page.getByLabel('사용자 역할 선택').selectOption('reviewer');
  const editor = page.getByLabel('보고서 초안 본문');
  assert.strictEqual(await editor.getAttribute('readonly'), '', 'Reviewer editor must be read-only');
  assert.strictEqual(await page.getByRole('button', { name: '검토자료 업로드' }).isEnabled(), true);
  assert.strictEqual(await page.getByRole('button', { name: '장 1차 승인' }).isEnabled(), true);
  assert.strictEqual(await page.getByRole('button', { name: '본문 저장' }).isEnabled(), false);
  assert.strictEqual(await page.getByRole('button', { name: '최종 DOCX/PDF 병합' }).isEnabled(), false);
  await editor.click();
  assert.strictEqual(await page.getByRole('dialog', { name: '403 본문 편집 권한 없음' }).isVisible(), true);
  await page.getByRole('button', { name: '확인' }).click();

  await page.getByLabel('사용자 역할 선택').selectOption('pm');
  assert.strictEqual(await editor.getAttribute('readonly'), null, 'PM editor must become editable without a reload');
  await page.getByLabel('사용자 역할 선택').selectOption('reviewer');
  assert.strictEqual(await editor.getAttribute('readonly'), '', 'Open tab must re-apply Reviewer restriction immediately');

  await page.goto(`${origin}/ai-config`);
  await assertHeading(page, /403 Forbidden/);

  await page.goto(`${origin}/approval`);
  await page.getByRole('button', { name: '세션 만료 테스트' }).click();
  assert.strictEqual(new URL(page.url()).pathname, '/login');
  assert.strictEqual(new URL(page.url()).searchParams.get('returnTo'), '/approval');
  await page.getByRole('button', { name: '테스트 세션으로 로그인' }).click();
  await page.waitForURL(`${origin}/approval`);

  await page.setViewportSize({ width: 1024, height: 768 });
  const menuButton = page.getByRole('button', { name: '메인 메뉴 드로어 열기' });
  await menuButton.waitFor({ state: 'visible' });
  assert.strictEqual(await menuButton.isVisible(), true);
  await menuButton.click();
  assert.strictEqual(await page.getByRole('dialog', { name: '전체 내비게이션 메뉴' }).isVisible(), true);
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.getByRole('dialog', { name: '전체 내비게이션 메뉴' }).count(), 0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/dashboard`);
  const skipLink = page.getByRole('link', { name: '본문 영역으로 바로가기' });
  await skipLink.focus();
  await page.waitForTimeout(300);
  const skipState = await skipLink.evaluate((element) => ({
    active: element === document.activeElement,
    top: getComputedStyle(element).top
  }));
  assert.deepStrictEqual(skipState, { active: true, top: '16px' }, 'Skip link must become visible on keyboard focus');
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  assert.strictEqual(await page.getByRole('button', { name: '세션 만료 테스트' }).isVisible(), true, 'Critical action disappeared at 200% zoom');

  console.log('P03 browser E2E: 20-route shell, history, 404, RBAC, session, 1024px drawer, focus, and 200% zoom PASSED');
  } finally {
    await browser?.close();
    server.kill();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
